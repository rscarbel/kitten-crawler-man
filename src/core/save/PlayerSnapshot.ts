import type { Player } from '../../Player';
import { ALL_STATS, zeroStats, type StatId } from '../party/stats';
import {
  INCURABLE_STATUSES,
  STATUS_DEFS,
  isStatusId,
  type StatusEffect,
} from '../combat/StatusEffect';
import { isSkillId, type CrawlerKind, type SkillId, type SkillState } from '../skills/SkillManager';
import { isStatTattooId, type StatTattooId } from '../skills/tattoos';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import { HOTBAR_COUNT, ITEM_DEF, isItemId } from '../items/defs/ItemDefs';
import { parseSavedGearState, type SavedGearItemState } from '../../gear/gearState';
import { REVIVE_HP_FRACTION } from '../party/reviveRules';
import type { InventoryItem, ItemId } from '../items/defs/ItemDefs';
import type { CraftSkillsSnapshot } from '../labour/CraftSkills';
import { parseCraftSkillsSnapshot } from '../labour/CraftSkills';
import { mayEquipUnder } from '../items/equipment/EquipmentManager';
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

function savedStack(slot: InventoryItem | null): SavedStack | null {
  return slot === null ? null : { id: slot.id, quantity: slot.quantity };
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

export function snapPlayer(p: Player): PlayerSnapshot {
  const baseStats = zeroStats();
  for (const stat of ALL_STATS) baseStats[stat] = p.getBaseStat(stat);
  const snap: PlayerSnapshot = {
    hp: p.hp,
    maxHp: p.maxHp,
    level: p.level,
    xp: p.xp,
    unspentPoints: p.unspentPoints,
    baseStats,
    coins: p.coins,
    facingX: p.facingX,
    facingY: p.facingY,
    inventorySlots: p.inventory.bag.slots.map(savedStack),
    inventoryHotbar: p.inventory.actionBar.slots.map(savedStack),
    equippedEntries: p.inventory.equipment.entries(),
    tattoo: p.tattoo,
    skillTattoo: p.skillTattoo,
    drillTraining: p.drillTraining,
    // The applier is dropped rather than copied: a snapshot is how a crawler
    // crosses into another scene, and that scene builds its own crawlers, so a
    // retained reference would credit a Player object nothing on the new map
    // has ever heard of. A transient status lasts only as long as its moment
    // on screen, so it is left behind rather than replayed on arrival.
    statusEffects: p.statusEffects
      .filter((effect) => STATUS_DEFS[effect.type].persistence !== 'transient')
      .map((effect) => ({ ...effect, applier: null })),
    juggJuiceHpBoost: p.juggJuiceHpBoost,
    isActive: p.isActive,
    isKnockedOut: p.isKnockedOut,
    knockedOutFrames: p.knockedOutFrames,
    reviveProgress: p.reviveProgress,
    skillStates: p.skills.snapshotStates(),
    craftSkillStates: p.craftSkills.snapshot(),
    nineLivesReadyAt: p.nineLivesReadyAt,
    thirdEyeReadyAt: p.thirdEyeReadyAt,
    unseenUpgrades: [...p.inventory.unseenUpgrades],
    gearState: p.gear.snapshot(),
  };
  if (p instanceof HumanPlayer) {
    snap.slingshotCooldown = p.slingshotCooldown;
  }
  return snap;
}

/**
 * Copy of a snapshot with the downed state cleared and at least a sliver of HP.
 *
 * Checkpoints (floor entry, saved progress, the next floor's arrival state) must
 * never describe a crawler who is already dead: restoring one would trip the
 * game-over check on the first frame, and — because the same checkpoint is
 * reused on every retry — would keep tripping it forever.
 */
export function revivedSnapshot(snap: PlayerSnapshot): PlayerSnapshot {
  return {
    ...snap,
    hp: Math.max(snap.hp, Math.ceil(snap.maxHp * REVIVE_HP_FRACTION)),
    isKnockedOut: false,
    knockedOutFrames: 0,
    reviveProgress: 0,
  };
}

/**
 * A snapshot with every temporary effect already stripped, so a restored crawler
 * cannot inherit a potion, a poison, or Jugg Juice's max-HP loan from the run that
 * killed them. HP is left as-is; the caller sets it to max once max HP has been
 * re-derived (status effects — including Jugg Juice's loan — affect max HP).
 *
 * The {@link INCURABLE_STATUSES} go too: this is only ever restored after a
 * death, and a death is the one thing that clears them.
 */
export function checkpointSnapshot(snap: PlayerSnapshot): PlayerSnapshot {
  return {
    ...snap,
    statusEffects: [],
    juggJuiceHpBoost: 0,
    isKnockedOut: false,
    knockedOutFrames: 0,
    reviveProgress: 0,
  };
}

/** The snapshot with the {@link INCURABLE_STATUSES} a death clears taken off it. */
export function withoutIncurableStatuses(snap: PlayerSnapshot): PlayerSnapshot {
  return {
    ...snap,
    statusEffects: snap.statusEffects.filter((effect) => !INCURABLE_STATUSES.includes(effect.type)),
  };
}

/**
 * A bag or hotbar slot as it is restored: its stack rebuilt from the item's
 * current definition, keeping only the quantity from the save. Always a fresh
 * object: a checkpoint snapshot is restored again on every death until the
 * next safe room, and the bag must never share an object with the snapshot it
 * came from.
 */
function restoredSlot(slot: SavedStack | null): InventoryItem | null {
  return slot === null ? null : { ...ITEM_DEF[slot.id], quantity: slot.quantity };
}

export function restorePlayer(p: Player, snap: PlayerSnapshot): void {
  p.level = snap.level;
  p.xp = snap.xp;
  p.unspentPoints = snap.unspentPoints;
  p.coins = snap.coins;
  p.facingX = snap.facingX;
  p.facingY = snap.facingY;
  p.tattoo = snap.tattoo;
  p.skillTattoo = snap.skillTattoo;
  p.drillTraining = snap.drillTraining;
  p.isActive = snap.isActive;
  p.isKnockedOut = snap.isKnockedOut;
  p.knockedOutFrames = snap.knockedOutFrames;
  p.reviveProgress = snap.reviveProgress;
  p.skills.restoreStates(snap.skillStates);
  p.craftSkills.restore(snap.craftSkillStates);
  p.nineLivesReadyAt = snap.nineLivesReadyAt;
  p.thirdEyeReadyAt = snap.thirdEyeReadyAt;
  if (p instanceof HumanPlayer) {
    p.slingshotCooldown = snap.slingshotCooldown ?? 0;
  }

  p.inventory.bag.replaceAll(snap.inventorySlots.map(restoredSlot));
  for (let i = 0; i < snap.inventoryHotbar.length; i++) {
    p.inventory.actionBar.slots[i] = restoredSlot(snap.inventoryHotbar[i] ?? null);
  }
  p.inventory.restoreUnseenUpgrades(snap.unseenUpgrades);
  // Equipment first: the stat getters — and therefore max HP — read from it.
  p.inventory.equipment.replaceAll(snap.equippedEntries);
  p.gear.restore(snap.gearState);

  for (const stat of ALL_STATS) p.setBaseStat(stat, snap.baseStats[stat]);

  // Status effects before HP: Jugg Juice's loan is part of max HP.
  p.restoreStatusEffects(snap.statusEffects, snap.juggJuiceHpBoost);
  p.restoreHp(Math.min(snap.hp, p.maxHp));
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
 * never saves, or one with a damaged clock or ward pool.
 */
function parseStatusEffect(value: unknown): StatusEffect | undefined {
  if (!isRecord(value)) return undefined;
  const { type, ticksRemaining, totalTicks, absorbRemaining, absorbTotal } = value;
  if (typeof type !== 'string' || !isStatusId(type)) return undefined;
  if (STATUS_DEFS[type].persistence === 'transient') return undefined;
  if (!isNonNegativeFinite(ticksRemaining) || !isNonNegativeFinite(totalTicks)) return undefined;
  const effect: StatusEffect = { type, ticksRemaining, totalTicks, applier: null };
  if (absorbRemaining !== undefined) {
    if (!isNonNegativeFinite(absorbRemaining)) return undefined;
    effect.absorbRemaining = absorbRemaining;
  }
  if (absorbTotal !== undefined) {
    if (!isNonNegativeFinite(absorbTotal)) return undefined;
    effect.absorbTotal = absorbTotal;
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
