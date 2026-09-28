/**
 * What a player can sell back at any counter, goods-shop or priced-menu alike.
 * One list, shared by `ShopSystem` and `PricedMenuPanel`'s Sell tab, so the two
 * UIs can never disagree about which items are on offer.
 */

import { ITEM_DEF, canSellItemId, type ItemId } from '../../core/ItemDefs';
import type { Player } from '../../Player';

/**
 * The player's sellable holdings, one row per distinct item id, counted across
 * both the bag and the hotbar. Equipped gear is left off the list — selling
 * armour still on your back would be a strange thing for a counter to allow,
 * and the player can always unequip it first.
 */
export function sellableHoldings(player: Player): Array<{ id: ItemId; qty: number }> {
  const counts = new Map<ItemId, number>();
  for (const slots of [player.inventory.bag.slots, player.inventory.actionBar.slots]) {
    for (const item of slots) {
      if (item === null) continue;
      if (!canSellItemId(item.id)) continue;
      if (player.inventory.hasEquipped(item.id)) continue;
      counts.set(item.id, (counts.get(item.id) ?? 0) + item.quantity);
    }
  }
  return [...counts.entries()]
    .map(([id, qty]) => ({ id, qty }))
    .sort((a, b) => ITEM_DEF[a.id].name.localeCompare(ITEM_DEF[b.id].name));
}
