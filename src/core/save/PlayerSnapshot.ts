import type { StatName, Player } from '../../Player';
import { ALL_STATS } from '../../Player';
import { INCURABLE_STATUSES, type StatusEffect } from '../combat/StatusEffect';
import type { SkillId, SkillState } from '../skills/SkillManager';
import { isStatTattooId, type StatTattooId } from '../skills/tattoos';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import { ITEM_DEF, isItemId } from '../items/defs/ItemDefs';
import type { SavedGearItemState } from '../../gear/gearState';
import { REVIVE_HP_FRACTION } from '../party/reviveRules';
import type { InventoryItem, ItemId } from '../items/defs/ItemDefs';
import type { CraftSkillsSnapshot } from '../labour/CraftSkills';
import { parseCraftSkillsSnapshot } from '../labour/CraftSkills';

/**
 * One held stack as a snapshot stores it. A stack carries nothing of its own
 * beyond its item and count, so everything else is rebuilt from `ITEM_DEF` on
 * restore; storing only these two keeps a save of a deep bag small enough for
 * the server to accept. Older saves stored the whole def and still read as this.
 */
export interface SavedStack {
  readonly id: string;
  readonly quantity: number;
}

function savedStack(slot: InventoryItem | null): SavedStack | null {
  return slot === null ? null : { id: slot.id, quantity: slot.quantity };
}

/**
 * Snapshot format version.
 *
 * v1 (unversioned) stored the *summed* stat values — base plus equipment — so a
 * naive restore would double-count every worn item once stats became derived.
 * v2 stores {@link PlayerSnapshot.baseStats} instead; {@link restorePlayer}
 * reconstructs base stats for v1 saves by subtracting the equipment bonuses back
 * out. v3 is the first version written after the cat's constitution lock, which
 * is what tells a one-time refund apart from a lawful potion or tattoo gain.
 * v4 keeps the human's weapon as equipment.
 * v5 adds {@link PlayerSnapshot.gearState}, each piece of gear's own memory.
 * v6 stores no drawn flag: a weapon equipped in the main hand is drawn.
 */
export const PLAYER_SNAPSHOT_VERSION = 6;

/** Version assumed for a snapshot that predates the field. */
const LEGACY_SNAPSHOT_VERSION = 1;

/** First version that stores `baseStats` rather than summed stat totals. */
const BASE_STATS_SNAPSHOT_VERSION = 2;

/**
 * First version written after the cat's constitution lock existed.
 *
 * Below this, a cat's stored constitution may include points she bought before
 * the lock, and those are refunded once on load. At or above it her stored value
 * is already lawful, so the refund must *not* run again — potions and tattoos
 * legitimately raise base constitution past the floor and would otherwise be
 * confiscated on the next doorway she walked through.
 */
export const CONSTITUTION_LOCK_SNAPSHOT_VERSION = 3;

/** Serialisable snapshot of a single player's state, used when transitioning
 *  between scenes (e.g. entering/exiting a building interior). */
export interface PlayerSnapshot {
  /** Absent on saves written before the base/effective stat split. */
  snapshotVersion?: number;
  hp: number;
  /** Effective max HP at snapshot time. Informational — v2 restores derive it. */
  maxHp: number;
  level: number;
  xp: number;
  unspentPoints: number;
  /** Effective stat totals. Informational for v2; authoritative for v1 saves. */
  strength: number;
  intelligence: number;
  constitution: number;
  /** Stored stat values, excluding equipment and temporary modifiers. v2+. */
  baseStats?: Partial<Record<StatName, number>>;
  coins: number;
  facingX: number;
  facingY: number;
  inventorySlots: (SavedStack | null)[];
  inventoryHotbar: (SavedStack | null)[];
  equippedEntries: [string, ItemId][];
  explosivesHandling?: number;
  /** The Quiet Needle's stat mark. Validated on restore, so anything unrecognised reads as unmarked. */
  tattoo?: StatTattooId | null;
  /** Skill taught by the Quiet Needle's brass mark. Absent on saves predating it. */
  skillTattoo?: SkillId | null;
  /** Big Rooster's Desperado Pass ink. Absent on saves predating it. */
  desperadoPassTattoo?: boolean;
  /** Each piece of gear's own memory. Absent on saves predating it, which read as fresh gear. */
  gearState?: SavedGearItemState[];
  /**
   * Frames left before the slingshot can fire again. Absent on saves predating
   * it, and on the cat. Without this, every scene transition zeroed the human's
   * cooldown and granted a free instant shot on arrival.
   */
  slingshotCooldown?: number;
  /** Stat points bought on the garrison's sand. Absent on saves predating the drill yard. */
  drillTraining?: number;
  /** Active buffs and DoTs, so a drink or a poison survives a building round-trip. */
  statusEffects: StatusEffect[];
  /** Max-HP loaned by an active Jugg Juice, so it is still repaid on the far side. */
  juggJuiceHpBoost: number;
  /**
   * Which crawler the player was controlling. Optional because saves written
   * before this field existed are still loaded verbatim from the server.
   */
  isActive?: boolean;
  /**
   * Downed state and its clocks. Without these a knocked-out companion crosses a
   * scene boundary as a plain 0-HP corpse, which reads as an instant game over.
   */
  isKnockedOut?: boolean;
  knockedOutFrames?: number;
  reviveProgress?: number;
  /** Discovered skills and their progress. Absent on saves predating the skill system. */
  skillStates?: SkillState[];
  /**
   * Resourcing and Construction levels, saved and restored per crawler like
   * `skillStates` — the two crawlers' craft progress never mixes. Absent on
   * saves predating craft skills.
   */
  craftSkillStates?: CraftSkillsSnapshot;
  /**
   * Wall-clock deadline for Cockroach's recharge. Absolute epoch-ms is the point:
   * a save opened tomorrow should find the skill ready, not still counting down.
   */
  cockroachReadyAt?: number | null;
  /** Wall-clock deadline for the Third Eye's foresight, kept for the same reason as Cockroach's. */
  thirdEyeReadyAt?: number | null;
  /** Unseen "new upgrade" item ids, so the bag badge survives a scene round-trip. Absent on saves predating it. */
  unseenUpgrades?: ItemId[];
}

/**
 * A finite number from a snapshot, or `fallback`.
 *
 * Saves arrive as unvalidated server JSON. The ids are already screened, but a
 * `NaN` or `Infinity` in a numeric field is worse than a bad id: it propagates
 * silently through the derived stats — `NaN` max HP, `NaN` HP — and leaves an
 * unplayable character with no error anywhere.
 */
function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export function snapPlayer(p: Player): PlayerSnapshot {
  const baseStats: Partial<Record<StatName, number>> = {};
  for (const stat of ALL_STATS) baseStats[stat] = p.getBaseStat(stat);
  const snap: PlayerSnapshot = {
    snapshotVersion: PLAYER_SNAPSHOT_VERSION,
    hp: p.hp,
    maxHp: p.maxHp,
    level: p.level,
    xp: p.xp,
    unspentPoints: p.unspentPoints,
    strength: p.strength,
    intelligence: p.intelligence,
    constitution: p.constitution,
    baseStats,
    coins: p.coins,
    facingX: p.facingX,
    facingY: p.facingY,
    inventorySlots: p.inventory.bag.slots.map(savedStack),
    inventoryHotbar: p.inventory.actionBar.slots.map(savedStack),
    equippedEntries: p.inventory.equipment.entries(),
    tattoo: p.tattoo,
    skillTattoo: p.skillTattoo,
    desperadoPassTattoo: p.hasDesperadoPassTattoo,
    drillTraining: p.drillTraining,
    // The applier is dropped rather than copied: a snapshot is how a crawler
    // crosses into another scene, and that scene builds its own crawlers, so a
    // retained reference would credit a Player object nothing on the new map
    // has ever heard of.
    statusEffects: p.statusEffects.map((e) => ({ ...e, applier: null })),
    juggJuiceHpBoost: p.juggJuiceHpBoost,
    isActive: p.isActive,
    isKnockedOut: p.isKnockedOut,
    knockedOutFrames: p.knockedOutFrames,
    reviveProgress: p.reviveProgress,
    skillStates: p.skills.snapshotStates(),
    craftSkillStates: p.craftSkills.snapshot(),
    cockroachReadyAt: p.cockroachReadyAt,
    thirdEyeReadyAt: p.thirdEyeReadyAt,
    unseenUpgrades: [...p.inventory.unseenUpgrades],
    gearState: p.gear.snapshot(),
  };
  if (p instanceof HumanPlayer) {
    snap.explosivesHandling = p.explosivesHandling;
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

/** What a crawler's craft skills read as when a snapshot has none: neither skill taught yet. */
const UNLEARNED_CRAFT_SKILLS: CraftSkillsSnapshot = {
  resourcing: { learned: false, level: 0, xp: 0 },
  construction: { learned: false, level: 0, xp: 0 },
};

/** The snapshot's format version, defaulting to v1 for saves predating the field. */
function snapshotVersionOf(snap: PlayerSnapshot): number {
  return snap.snapshotVersion ?? LEGACY_SNAPSHOT_VERSION;
}

/**
 * A bag or hotbar slot as it is restored: its stack rebuilt from the item's
 * current definition, keeping only the quantity from the save.
 *
 * Some saves hold the whole def as it stood when the item was picked up; a
 * field the def has gained since — a weapon's equip address and stat block —
 * would be missing from that copy, and the item could never be put in a slot.
 * A retired id has no definition to rebuild it from, so its slot comes back
 * empty.
 *
 * Always a fresh object: a checkpoint snapshot is restored again on every
 * death until the next safe room, and the bag must never share an object with
 * the snapshot it came from.
 */
function restoredSlot(slot: SavedStack | null | undefined): InventoryItem | null {
  if (slot === null || slot === undefined) return null;
  if (!isItemId(slot.id)) return null;
  return { ...ITEM_DEF[slot.id], quantity: slot.quantity };
}

/** Total stat bonus the snapshot's equipped items contribute, by stat. */
function equipmentBonusesOf(snap: PlayerSnapshot): Record<StatName, number> {
  const totals: Record<StatName, number> = {
    strength: 0,
    intelligence: 0,
    constitution: 0,
    dexterity: 0,
  };
  for (const [, itemId] of snap.equippedEntries) {
    // Snapshots arrive as unvalidated server JSON, and this is the legacy path —
    // the one most likely to name an item that has since been renamed or removed.
    if (!isItemId(itemId)) continue;
    const bonus = ITEM_DEF[itemId].statBonus;
    if (!bonus) continue;
    for (const stat of ALL_STATS) totals[stat] += bonus[stat] ?? 0;
  }
  return totals;
}

/**
 * Stored stat values to restore from a snapshot.
 *
 * v2 saves carry them directly. v1 saves stored the summed totals, so the worn
 * equipment's contribution is subtracted back out — without that, re-deriving
 * effective stats from the restored base would count every worn item twice.
 * Dexterity did not exist in v1; the player's species default is kept.
 */
function baseStatsFrom(p: Player, snap: PlayerSnapshot): Record<StatName, number> {
  const speciesDefaults: Record<StatName, number> = {
    strength: p.getBaseStat('strength'),
    intelligence: p.getBaseStat('intelligence'),
    constitution: p.getBaseStat('constitution'),
    dexterity: p.getBaseStat('dexterity'),
  };

  const stored = snap.baseStats;
  if (snapshotVersionOf(snap) >= BASE_STATS_SNAPSHOT_VERSION && stored) {
    const resolved: Record<StatName, number> = { ...speciesDefaults };
    for (const stat of ALL_STATS) {
      resolved[stat] = finiteOr(stored[stat], speciesDefaults[stat]);
    }
    return resolved;
  }

  // Legacy: floored at the species default rather than at 1, because the cat's
  // guaranteed base constitution of 2 postdates v1 — restoring her at the old
  // stored 1 would cost her max HP she can no longer buy back.
  const equipment = equipmentBonusesOf(snap);
  const recovered = (storedTotal: number, stat: StatName): number =>
    Math.max(speciesDefaults[stat], finiteOr(storedTotal, speciesDefaults[stat]) - equipment[stat]);
  return {
    strength: recovered(snap.strength, 'strength'),
    intelligence: recovered(snap.intelligence, 'intelligence'),
    constitution: recovered(snap.constitution, 'constitution'),
    dexterity: speciesDefaults.dexterity,
  };
}

function validDeadline(readyAt: number | null | undefined): number | null {
  return readyAt !== null && readyAt !== undefined && Number.isFinite(readyAt) ? readyAt : null;
}

export function restorePlayer(p: Player, snap: PlayerSnapshot): void {
  p.level = Math.max(1, finiteOr(snap.level, p.level));
  p.xp = Math.max(0, finiteOr(snap.xp, 0));
  p.unspentPoints = Math.max(0, finiteOr(snap.unspentPoints, 0));
  p.coins = Math.max(0, finiteOr(snap.coins, 0));
  p.facingX = finiteOr(snap.facingX, p.facingX);
  p.facingY = finiteOr(snap.facingY, p.facingY);
  p.tattoo = isStatTattooId(snap.tattoo) ? snap.tattoo : null;
  p.skillTattoo = snap.skillTattoo ?? null;
  p.hasDesperadoPassTattoo = snap.desperadoPassTattoo ?? false;
  p.drillTraining = Math.max(0, finiteOr(snap.drillTraining, 0));
  p.isActive = snap.isActive ?? p.isActive;
  p.isKnockedOut = snap.isKnockedOut ?? false;
  p.knockedOutFrames = snap.knockedOutFrames ?? 0;
  p.reviveProgress = snap.reviveProgress ?? 0;
  p.skills.restoreStates(snap.skillStates ?? []);
  p.craftSkills.restore(parseCraftSkillsSnapshot(snap.craftSkillStates) ?? UNLEARNED_CRAFT_SKILLS);
  p.cockroachReadyAt = validDeadline(snap.cockroachReadyAt);
  p.thirdEyeReadyAt = validDeadline(snap.thirdEyeReadyAt);
  if (p instanceof HumanPlayer) {
    if (snap.explosivesHandling !== undefined) {
      p.explosivesHandling = Math.max(1, finiteOr(snap.explosivesHandling, p.explosivesHandling));
    }
    p.slingshotCooldown = Math.max(0, finiteOr(snap.slingshotCooldown, 0));
  }

  p.inventory.bag.replaceAll(snap.inventorySlots.map(restoredSlot));
  for (let i = 0; i < snap.inventoryHotbar.length; i++) {
    p.inventory.actionBar.slots[i] = restoredSlot(snap.inventoryHotbar[i]);
  }
  // Snapshots are copied slot-for-slot, so a save written before stacks were
  // kept unified still carries a split one. Folding here catches every restore
  // path at once rather than at each of the scenes that call this.
  p.inventory.consolidateStacks();
  p.inventory.restoreUnseenUpgrades(snap.unseenUpgrades ?? []);
  // Equipment first: the stat getters — and therefore max HP — read from it.
  p.inventory.equipment.replaceAll(snap.equippedEntries);
  p.gear.restore(snap.gearState);

  const baseStats = baseStatsFrom(p, snap);
  for (const stat of ALL_STATS) p.setBaseStat(stat, baseStats[stat]);

  p.migrateRestoredStats(snapshotVersionOf(snap));

  // Status effects before HP: Jugg Juice's loan is part of max HP.
  p.restoreStatusEffects(snap.statusEffects, snap.juggJuiceHpBoost);
  p.hp = Math.min(Math.max(0, finiteOr(snap.hp, p.maxHp)), p.maxHp);
}
