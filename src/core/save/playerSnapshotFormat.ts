/**
 * A crawler's snapshot as it is stored, and the check that a stored one is
 * something this build writes. Data shapes only: taking and restoring a
 * snapshot is `PlayerSnapshot.ts`, which needs the live crawler.
 */

import { ALL_STATS, zeroStats, type StatId } from '../party/stats';
import {
  STATUS_DEFS,
  isStatusId,
  isSurvivingShare,
  type StatusEffect,
} from '../combat/StatusEffect';
import { isGroundHazard } from '../combat/groundHazard';
import { isSkillId, type CrawlerKind, type SkillId, type SkillState } from '../skills/SkillManager';
import { isStatTattooId, type StatTattooId } from '../skills/tattoos';
import { HOTBAR_COUNT, isItemId, mayEquipUnder, type ItemId } from '../items/defs/ItemDefs';
import { parseSavedGearState, type SavedGearItemState } from '../../gear/gearState';
import { parseCraftSkillsSnapshot, type CraftSkillsSnapshot } from '../labour/CraftSkills';
import { isFiniteNumber, isNonNegativeFinite, isRecord, parseEvery } from '../util/guards';

/**
 * One held stack as a snapshot stores it. A stack carries nothing of its own
 * beyond its item and count, so everything else is rebuilt from `ITEM_DEF` on
 * restore; storing only these two keeps a save of a deep bag small enough for
 * the server to accept.
 */
export interface SavedStack {
  readonly id: ItemId;
  readonly quantity: number;
}

/** The length of a saved `[subSlotKey, itemId]` equipment entry. */
const EQUIPPED_ENTRY_LENGTH = 2;

/** The lowest level a crawler can be. */
const MIN_PLAYER_LEVEL = 1;

/** Serialisable snapshot of a single player's state, used when transitioning
 *  between scenes (e.g. entering/exiting a building interior) and in a save. */
export interface PlayerSnapshot {
  hp: number;
  /** Effective max HP at snapshot time; a restore re-derives it. */
  maxHp: number;
  level: number;
  xp: number;
  unspentPoints: number;
  /** Stored stat values, excluding equipment and temporary modifiers. */
  baseStats: Record<StatId, number>;
  coins: number;
  facingX: number;
  facingY: number;
  inventorySlots: (SavedStack | null)[];
  inventoryHotbar: (SavedStack | null)[];
  equippedEntries: [string, ItemId][];
  /** The Quiet Needle's stat mark. */
  tattoo: StatTattooId | null;
  /** Skill taught by the Quiet Needle's brass mark. */
  skillTattoo: SkillId | null;
  /** Each piece of gear's own memory. */
  gearState: SavedGearItemState[];
  /**
   * Frames left before the slingshot can fire again; the human's alone.
   * Without this, every scene transition zeroed the human's cooldown and
   * granted a free instant shot on arrival.
   */
  slingshotCooldown?: number;
  /** Stat points bought on the garrison's sand. */
  drillTraining: number;
  /**
   * Active buffs and DoTs, so a drink or a poison survives a building
   * round-trip. Never holds a `transient` status (see `StatusDef.persistence`).
   */
  statusEffects: StatusEffect[];
  /** Max-HP loaned by an active Jugg Juice, so it is still repaid on the far side. */
  juggJuiceHpBoost: number;
  /** Which crawler the player was controlling. */
  isActive: boolean;
  /**
   * Downed state and its clocks. Without these a knocked-out companion crosses a
   * scene boundary as a plain 0-HP corpse, which reads as an instant game over.
   */
  isKnockedOut: boolean;
  knockedOutFrames: number;
  reviveProgress: number;
  /** Discovered skills and their progress. */
  skillStates: SkillState[];
  /**
   * Resourcing and Construction levels, saved and restored per crawler like
   * `skillStates` — the two crawlers' craft progress never mixes.
   */
  craftSkillStates: CraftSkillsSnapshot;
  /**
   * Wall-clock deadline for 9 Lives' recharge. Absolute epoch-ms is the point:
   * a save opened tomorrow should find the skill ready, not still counting down.
   */
  nineLivesReadyAt: number | null;
  /** Wall-clock deadline for the Third Eye's foresight, kept for the same reason as 9 Lives'. */
  thirdEyeReadyAt: number | null;
  /** Unseen "new upgrade" item ids, so the bag badge survives a scene round-trip. */
  unseenUpgrades: ItemId[];
}

function parseSavedStack(value: unknown): SavedStack | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { id, quantity } = value;
  if (typeof id !== 'string' || !isItemId(id)) return undefined;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) return undefined;
  return { id, quantity };
}

/** Every slot of a saved bag or hotbar, or undefined when one holds what this build cannot rebuild. */
function parseSavedSlots(value: unknown): (SavedStack | null)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const slots: (SavedStack | null)[] = [];
  for (const entry of value) {
    const slot = parseSavedStack(entry);
    if (slot === undefined) return undefined;
    slots.push(slot);
  }
  return slots;
}

function parseEquippedEntry(kind: CrawlerKind, value: unknown): [string, ItemId] | undefined {
  if (!Array.isArray(value) || value.length !== EQUIPPED_ENTRY_LENGTH) return undefined;
  const key: unknown = value[0];
  const id: unknown = value[1];
  if (typeof key !== 'string' || typeof id !== 'string' || !isItemId(id)) return undefined;
  return mayEquipUnder(kind, key, id) ? [key, id] : undefined;
}

function parseEquippedEntries(kind: CrawlerKind, value: unknown): [string, ItemId][] | undefined {
  const entries = parseEvery(value, (entry) => parseEquippedEntry(kind, entry));
  if (entries === undefined) return undefined;
  const distinctIds = new Set(entries.map(([, id]) => id));
  return distinctIds.size === entries.length ? entries : undefined;
}

function parseBaseStats(value: unknown): Record<StatId, number> | undefined {
  if (!isRecord(value)) return undefined;
  const stats = zeroStats();
  for (const stat of ALL_STATS) {
    const stored = value[stat];
    if (!isNonNegativeFinite(stored)) return undefined;
    stats[stat] = stored;
  }
  return stats;
}

/**
 * A saved status, or undefined for one this build does not define, one it
 * never saves, or one with a damaged clock, share or ward pool.
 */
function parseStatusEffect(value: unknown): StatusEffect | undefined {
  if (!isRecord(value)) return undefined;
  const {
    type,
    ticksRemaining,
    totalTicks,
    survivingShare,
    absorbRemaining,
    absorbTotal,
    groundHazard,
  } = value;
  if (typeof type !== 'string' || !isStatusId(type)) return undefined;
  if (STATUS_DEFS[type].persistence === 'transient') return undefined;
  if (!isNonNegativeFinite(ticksRemaining) || !isNonNegativeFinite(totalTicks)) return undefined;
  if (!isSurvivingShare(survivingShare)) return undefined;
  const effect: StatusEffect = { type, ticksRemaining, totalTicks, survivingShare, applier: null };
  if (absorbRemaining !== undefined) {
    if (!isNonNegativeFinite(absorbRemaining)) return undefined;
    effect.absorbRemaining = absorbRemaining;
  }
  if (absorbTotal !== undefined) {
    if (!isNonNegativeFinite(absorbTotal)) return undefined;
    effect.absorbTotal = absorbTotal;
  }
  if (groundHazard !== undefined) {
    if (!isGroundHazard(groundHazard)) return undefined;
    effect.groundHazard = groundHazard;
  }
  return effect;
}

function parseSkillState(value: unknown): SkillState | undefined {
  if (!isRecord(value)) return undefined;
  const { id, level, usesTowardNext } = value;
  if (typeof id !== 'string' || !isSkillId(id)) return undefined;
  if (!isFiniteNumber(level) || level < MIN_PLAYER_LEVEL) return undefined;
  if (!isNonNegativeFinite(usesTowardNext)) return undefined;
  return { id, level, usesTowardNext };
}

function parseNullableTattoo(value: unknown): StatTattooId | null | undefined {
  if (value === null) return null;
  return isStatTattooId(value) ? value : undefined;
}

function parseNullableSkillId(value: unknown): SkillId | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && isSkillId(value) ? value : undefined;
}

function parseNullableDeadline(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isFiniteNumber(value) ? value : undefined;
}

/**
 * A saved crawler snapshot, or undefined when any field is missing or is not
 * something this build writes for a crawler of `kind`. Input is unvalidated
 * JSON from storage or the server.
 */
export function parsePlayerSnapshot(value: unknown, kind: CrawlerKind): PlayerSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const {
    hp,
    maxHp,
    level,
    xp,
    unspentPoints,
    coins,
    facingX,
    facingY,
    slingshotCooldown,
    drillTraining,
    juggJuiceHpBoost,
    isActive,
    isKnockedOut,
    knockedOutFrames,
    reviveProgress,
  } = value;
  const baseStats = parseBaseStats(value.baseStats);
  const inventorySlots = parseSavedSlots(value.inventorySlots);
  const inventoryHotbar = parseSavedSlots(value.inventoryHotbar);
  const equippedEntries = parseEquippedEntries(kind, value.equippedEntries);
  const tattoo = parseNullableTattoo(value.tattoo);
  const skillTattoo = parseNullableSkillId(value.skillTattoo);
  const gearState = parseSavedGearState(value.gearState);
  const statusEffects = parseEvery(value.statusEffects, parseStatusEffect);
  const skillStates = parseEvery(value.skillStates, parseSkillState);
  const craftSkillStates = parseCraftSkillsSnapshot(value.craftSkillStates);
  const nineLivesReadyAt = parseNullableDeadline(value.nineLivesReadyAt);
  const thirdEyeReadyAt = parseNullableDeadline(value.thirdEyeReadyAt);
  const unseenUpgrades = parseEvery(value.unseenUpgrades, (id) =>
    typeof id === 'string' && isItemId(id) ? id : undefined,
  );
  const isHuman = kind === 'human';
  const humanOnlyFieldsValid = isHuman
    ? isNonNegativeFinite(slingshotCooldown)
    : slingshotCooldown === undefined;
  if (
    !isNonNegativeFinite(hp) ||
    !isNonNegativeFinite(maxHp) ||
    !isFiniteNumber(level) ||
    level < MIN_PLAYER_LEVEL ||
    !isNonNegativeFinite(xp) ||
    !isNonNegativeFinite(unspentPoints) ||
    !isNonNegativeFinite(coins) ||
    !isFiniteNumber(facingX) ||
    !isFiniteNumber(facingY) ||
    !isNonNegativeFinite(drillTraining) ||
    !isNonNegativeFinite(juggJuiceHpBoost) ||
    typeof isActive !== 'boolean' ||
    typeof isKnockedOut !== 'boolean' ||
    !isNonNegativeFinite(knockedOutFrames) ||
    !isNonNegativeFinite(reviveProgress) ||
    !humanOnlyFieldsValid ||
    baseStats === undefined ||
    inventorySlots === undefined ||
    inventoryHotbar === undefined ||
    inventoryHotbar.length > HOTBAR_COUNT ||
    equippedEntries === undefined ||
    tattoo === undefined ||
    skillTattoo === undefined ||
    gearState === undefined ||
    statusEffects === undefined ||
    skillStates === undefined ||
    craftSkillStates === undefined ||
    nineLivesReadyAt === undefined ||
    thirdEyeReadyAt === undefined ||
    unseenUpgrades === undefined
  ) {
    return undefined;
  }
  const snap: PlayerSnapshot = {
    hp,
    maxHp,
    level,
    xp,
    unspentPoints,
    baseStats,
    coins,
    facingX,
    facingY,
    inventorySlots,
    inventoryHotbar,
    equippedEntries,
    tattoo,
    skillTattoo,
    gearState,
    drillTraining,
    statusEffects,
    juggJuiceHpBoost,
    isActive,
    isKnockedOut,
    knockedOutFrames,
    reviveProgress,
    skillStates,
    craftSkillStates,
    nineLivesReadyAt,
    thirdEyeReadyAt,
    unseenUpgrades,
  };
  if (isNonNegativeFinite(slingshotCooldown)) snap.slingshotCooldown = slingshotCooldown;
  return snap;
}
