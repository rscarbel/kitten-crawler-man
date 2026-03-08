import type { Player } from '../Player';
import type { InventoryItem } from './Inventory';

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
  equippedEntries: [string, string][]; // Map entries as [key, ItemId]
  explosivesHandling?: number;
}

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
    inventorySlots: p.inventory.slots.map((s) => (s ? { ...s } : null)),
    inventoryHotbar: p.inventory.hotbar.map((s) => (s ? { ...s } : null)),
    equippedEntries: [...p.inventory.equipped.entries()],
  };
  if ('explosivesHandling' in p) {
    snap.explosivesHandling = (p as { explosivesHandling: number }).explosivesHandling;
  }
  return snap;
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
  if ('explosivesHandling' in p && snap.explosivesHandling !== undefined) {
    (p as { explosivesHandling: number }).explosivesHandling = snap.explosivesHandling;
  }

  // Restore inventory slots
  for (let i = 0; i < snap.inventorySlots.length; i++) {
    p.inventory.slots[i] = snap.inventorySlots[i];
  }
  for (let i = 0; i < snap.inventoryHotbar.length; i++) {
    p.inventory.hotbar[i] = snap.inventoryHotbar[i];
  }
  p.inventory.equipped.clear();
  for (const [k, v] of snap.equippedEntries) {
    p.inventory.equipped.set(k, v as import('./Inventory').ItemId);
  }
}
