import type { Player } from '../../Player';
import { ALL_STATS, zeroStats } from '../party/stats';
import { INCURABLE_STATUSES, STATUS_DEFS } from '../combat/StatusEffect';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import { ITEM_DEF } from '../items/defs/ItemDefs';
import { REVIVE_HP_FRACTION } from '../party/reviveRules';
import type { InventoryItem } from '../items/defs/ItemDefs';
import type { PlayerSnapshot, SavedStack } from './playerSnapshotFormat';

function savedStack(slot: InventoryItem | null): SavedStack | null {
  return slot === null ? null : { id: slot.id, quantity: slot.quantity };
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
