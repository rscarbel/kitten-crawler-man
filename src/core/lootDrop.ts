import type { LootDrop } from '../creatures/Mob';

/**
 * Deep copy of a loot drop, including its `items` array.
 *
 * Checkpoint snapshots are restored repeatedly against the same stored object,
 * so both the capture and the restore side must copy — handing the live array
 * back would let the next run's mutations rewrite the snapshot.
 */
export function cloneLootDrop(loot: LootDrop): LootDrop {
  return {
    coins: loot.coins,
    items: loot.items.map((entry) => ({ id: entry.id, quantity: entry.quantity })),
    goldDoubled: loot.goldDoubled,
  };
}
