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
 * `addItem` is silent about a full bag — it stacks the whole quantity, drops the
 * whole quantity into an empty slot, or does nothing — so the count is taken
 * either side of it. That is the same guard the market stalls and the General
 * Store use, and it is the reason a purchase can return `ok: false` and leave
 * the buyer's coins alone.
 *
 * Because `addItem` is all-or-nothing, a partial delivery cannot happen and
 * there is nothing to roll back; the count is still compared against the full
 * quantity rather than against zero, so the day that stops being true this
 * refuses the sale instead of silently short-changing the buyer.
 */
export function giveInventoryItem(buyer: Player, id: ItemId, quantity = 1): boolean {
  const before = buyer.inventory.countOf(id);
  buyer.inventory.addItem(id, quantity);
  return buyer.inventory.countOf(id) - before === quantity;
}
