import type { PermanentStat, Player } from '../Player';
import type { StatusEffect } from './StatusEffect';
import { HumanPlayer } from '../creatures/HumanPlayer';
import type { InventoryItem, ItemId } from './ItemDefs';

/** Serialisable snapshot of a single player's state, used when transitioning
 *  between scenes (e.g. entering/exiting a building interior). */
export interface PlayerSnapshot {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  unspentPoints: number;
  strength: number;
  intelligence: number;
  constitution: number;
  coins: number;
  facingX: number;
  facingY: number;
  inventorySlots: (InventoryItem | null)[];
  inventoryHotbar: (InventoryItem | null)[];
  equippedEntries: [string, ItemId][];
  explosivesHandling?: number;
  tattooStat: PermanentStat | null;
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
}

/** HP a revived crawler comes back with, as a fraction of their max. */
export const REVIVE_HP_FRACTION = 0.01;

export function snapPlayer(p: Player): PlayerSnapshot {
  const snap: PlayerSnapshot = {
    hp: p.hp,
    maxHp: p.maxHp,
    level: p.level,
    xp: p.xp,
    unspentPoints: p.unspentPoints,
    strength: p.strength,
    intelligence: p.intelligence,
    constitution: p.constitution,
    coins: p.coins,
    facingX: p.facingX,
    facingY: p.facingY,
    inventorySlots: p.inventory.bag.slots.map((s) => (s ? { ...s } : null)),
    inventoryHotbar: p.inventory.actionBar.slots.map((s) => (s ? { ...s } : null)),
    equippedEntries: [...p.inventory.equipment.equipped.entries()],
    tattooStat: p.tattooStat,
    statusEffects: p.statusEffects.map((e) => ({ ...e })),
    juggJuiceHpBoost: p.juggJuiceHpBoost,
    isActive: p.isActive,
    isKnockedOut: p.isKnockedOut,
    knockedOutFrames: p.knockedOutFrames,
    reviveProgress: p.reviveProgress,
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

export function restorePlayer(p: Player, snap: PlayerSnapshot): void {
  p.hp = snap.hp;
  p.maxHp = snap.maxHp;
  p.level = snap.level;
  p.xp = snap.xp;
  p.unspentPoints = snap.unspentPoints;
  p.strength = snap.strength;
  p.intelligence = snap.intelligence;
  p.constitution = snap.constitution;
  p.coins = snap.coins;
  p.facingX = snap.facingX;
  p.facingY = snap.facingY;
  p.tattooStat = snap.tattooStat;
  p.isActive = snap.isActive ?? p.isActive;
  p.isKnockedOut = snap.isKnockedOut ?? false;
  p.knockedOutFrames = snap.knockedOutFrames ?? 0;
  p.reviveProgress = snap.reviveProgress ?? 0;
  p.restoreStatusEffects(snap.statusEffects, snap.juggJuiceHpBoost);
  if (p instanceof HumanPlayer && snap.explosivesHandling !== undefined) {
    p.explosivesHandling = snap.explosivesHandling;
  }

  // Restore inventory slots
  for (let i = 0; i < snap.inventorySlots.length; i++) {
    p.inventory.bag.slots[i] = snap.inventorySlots[i];
  }
  for (let i = 0; i < snap.inventoryHotbar.length; i++) {
    p.inventory.actionBar.slots[i] = snap.inventoryHotbar[i];
  }
  p.inventory.equipment.equipped.clear();
  for (const [k, v] of snap.equippedEntries) {
    p.inventory.equipment.equipped.set(k, v);
  }
}
