/**
 * The two things every town service module was writing for itself: rotating a
 * line pool by how many times the player has talked to someone, and putting an
 * item in their bag without lying about whether it fitted.
 */

import type { ItemId } from '../core/ItemDefs';
import type { Player } from '../Player';

/**
 * Deterministically pick from a pool, advancing with each conversation so
 * repeats vary. Negative-safe, so a caller may pass any turn count, and
 * empty-safe, so a pool that loses its last line degrades to silence rather
 * than to the word "undefined".
 */
export function rotateLine(pool: ReadonlyArray<string>, turn: number): string {
  // An empty pool would make the modulo NaN and hand back `undefined` under a
  // `string` signature — which surfaces as the literal word "undefined" in an
  // NPC's mouth rather than as an error anybody would notice.
  if (pool.length === 0) return '';
  const index = ((turn % pool.length) + pool.length) % pool.length;
  return pool[index] ?? '';
}

/**
 * Adds `quantity` of `id` to `buyer`'s bag, reporting whether it landed.
 *
 * Room is asked for first, so a full bag refuses the purchase (`ok: false`,
 * coins untouched) rather than losing the item and reporting a full bag.
 * `addItem` is all-or-nothing, so a partial delivery cannot happen and there
 * is nothing to roll back.
 */
export function giveInventoryItem(buyer: Player, id: ItemId, quantity = 1): boolean {
  if (!buyer.inventory.hasRoomFor(id)) return false;
  return buyer.inventory.addItem(id, quantity);
}
