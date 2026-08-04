import type { StatName, Player } from '../Player';
import { ALL_STATS } from '../Player';
import type { StatusEffect } from './StatusEffect';
import type { SkillId, SkillState } from './SkillManager';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { ITEM_DEF, isItemId } from './ItemDefs';
import type { InventoryItem, ItemId } from './ItemDefs';

/**
 * Snapshot format version.
 *
 * v1 (unversioned) stored the *summed* stat values — base plus equipment — so a
 * naive restore would double-count every worn item once stats became derived.
 * v2 stores {@link PlayerSnapshot.baseStats} instead; {@link restorePlayer}
 * reconstructs base stats for v1 saves by subtracting the equipment bonuses back
 * out. v3 is the first version written after the cat's constitution lock, which
 * is what tells a one-time refund apart from a lawful potion or tattoo gain.
 */
export const PLAYER_SNAPSHOT_VERSION = 3;

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
  inventorySlots: (InventoryItem | null)[];
  inventoryHotbar: (InventoryItem | null)[];
  equippedEntries: [string, ItemId][];
  explosivesHandling?: number;
  tattooStat: StatName | null;
  /** Skill taught by Signet's brass mark. Absent on saves predating it. */
  skillTattoo?: SkillId | null;
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
   * Wall-clock deadline for Cockroach's recharge. Absolute epoch-ms is the point:
   * a save opened tomorrow should find the skill ready, not still counting down.
   */
  cockroachReadyAt?: number | null;
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

/** HP a revived crawler comes back with, as a fraction of their max. */
export const REVIVE_HP_FRACTION = 0.01;

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
    inventorySlots: p.inventory.bag.slots.map((s) => (s ? { ...s } : null)),
    inventoryHotbar: p.inventory.actionBar.slots.map((s) => (s ? { ...s } : null)),
    equippedEntries: p.inventory.equipment.entries(),
    tattooStat: p.tattooStat,
    skillTattoo: p.skillTattoo,
    statusEffects: p.statusEffects.map((e) => ({ ...e })),
    juggJuiceHpBoost: p.juggJuiceHpBoost,
    isActive: p.isActive,
    isKnockedOut: p.isKnockedOut,
    knockedOutFrames: p.knockedOutFrames,
    reviveProgress: p.reviveProgress,
    skillStates: p.skills.snapshotStates(),
    cockroachReadyAt: p.cockroachReadyAt,
  };
  if (p instanceof HumanPlayer) {
    snap.explosivesHandling = p.explosivesHandling;
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

/** The snapshot's format version, defaulting to v1 for saves predating the field. */
function snapshotVersionOf(snap: PlayerSnapshot): number {
  return snap.snapshotVersion ?? LEGACY_SNAPSHOT_VERSION;
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

export function restorePlayer(p: Player, snap: PlayerSnapshot): void {
  p.level = Math.max(1, finiteOr(snap.level, p.level));
  p.xp = Math.max(0, finiteOr(snap.xp, 0));
  p.unspentPoints = Math.max(0, finiteOr(snap.unspentPoints, 0));
  p.coins = Math.max(0, finiteOr(snap.coins, 0));
  p.facingX = finiteOr(snap.facingX, p.facingX);
  p.facingY = finiteOr(snap.facingY, p.facingY);
  p.tattooStat = snap.tattooStat;
  p.skillTattoo = snap.skillTattoo ?? null;
  p.isActive = snap.isActive ?? p.isActive;
  p.isKnockedOut = snap.isKnockedOut ?? false;
  p.knockedOutFrames = snap.knockedOutFrames ?? 0;
  p.reviveProgress = snap.reviveProgress ?? 0;
  p.skills.restoreStates(snap.skillStates ?? []);
  const readyAt = snap.cockroachReadyAt;
  p.cockroachReadyAt =
    readyAt !== null && readyAt !== undefined && Number.isFinite(readyAt) ? readyAt : null;
  if (p instanceof HumanPlayer && snap.explosivesHandling !== undefined) {
    p.explosivesHandling = Math.max(1, finiteOr(snap.explosivesHandling, p.explosivesHandling));
  }

  // Copied rather than aliased: a checkpoint snapshot is restored again on
  // every death until the next safe room, so handing the stored slot objects
  // straight to the bag would let the first restored run edit the snapshot it
  // came from. Today's bag and hotbar happen to be copy-on-write, which is the
  // only reason aliasing them has not already corrupted a checkpoint.
  for (let i = 0; i < snap.inventorySlots.length; i++) {
    const slot = snap.inventorySlots[i];
    p.inventory.bag.slots[i] = slot === null ? null : { ...slot };
  }
  for (let i = 0; i < snap.inventoryHotbar.length; i++) {
    const slot = snap.inventoryHotbar[i];
    p.inventory.actionBar.slots[i] = slot === null ? null : { ...slot };
  }
  // Equipment first: the stat getters — and therefore max HP — read from it.
  p.inventory.equipment.replaceAll(snap.equippedEntries);

  const baseStats = baseStatsFrom(p, snap);
  for (const stat of ALL_STATS) p.setBaseStat(stat, baseStats[stat]);

  p.migrateRestoredStats(snapshotVersionOf(snap));

  // Status effects before HP: Jugg Juice's loan is part of max HP.
  p.restoreStatusEffects(snap.statusEffects, snap.juggJuiceHpBoost);
  p.hp = Math.min(Math.max(0, finiteOr(snap.hp, p.maxHp)), p.maxHp);
}
