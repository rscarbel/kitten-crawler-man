/**
 * Pipkin's Cookhouse: burgers for a quick bite, stew for a proper heal.
 *
 * The menu and its pricing live on `SHOPS.cookhouse`. Hollow Stew heals
 * exactly like a health potion and shares its cooldown, so its base price is a
 * potion's; a burger heals about half as much but feeds a strength bonus and
 * has no cooldown at all, so it is worth a little over half a potion.
 */

import { ITEM_DEF } from '../../../core/ItemDefs';
import type { BriarHollowState } from '../../../core/briarHollowState';
import type { Player } from '../../../Player';
import { SHOPS, type ShopId } from '../../../economy/shops';
import { buyFromShop } from '../../../economy/shopStock';
import { SOLD_OUT_LABEL, catalogLinePricing } from '../../market/vendorMenu';
import type { ShopMenu, ShopRow, ShopPurchaseResult } from '../../../ui/screens/shop/shopSession';
import type { TopicProvider } from '../villagerTopics';
import { SPEAKERS } from '../../../dialog/speakers';
import { PIPKIN } from '../../../dialog/scripts/briarHollow';
import {
  type ShopCounter,
  type ShopDefinition,
  sellerLine,
  shopTopic,
  shopTrades,
} from './serviceContext';

const COOKHOUSE_SHOP = 'cookhouse' as const satisfies ShopId;
const COOKHOUSE_TITLE = "Pipkin's Cookhouse";
export const COOK = 'pipkin';

export function buildCookMenu(state: BriarHollowState): ShopMenu {
  const options = SHOPS.cookhouse.catalog.map((line): ShopRow => ({
    key: line.item,
    label: ITEM_DEF[line.item].name,
    ...catalogLinePricing(COOKHOUSE_SHOP, line, state.shopStock),
    desc: ITEM_DEF[line.item].description ?? '',
  }));
  return {
    title: COOKHOUSE_TITLE,
    bark: sellerLine(PIPKIN.shopOpen),
    byline: SPEAKERS.pipkin.name,
    options,
  };
}

/**
 * Hands the dish over. Stew bought while the buyer's potion cooldown is still running still sells
 * — it keeps — but Pipkin says why it can't be eaten yet.
 */
export function cookPurchase(
  state: BriarHollowState,
  option: ShopRow,
  buyer: Player,
): ShopPurchaseResult {
  const dish = SHOPS.cookhouse.catalog.find((line) => line.item === option.key);
  if (dish === undefined) return { ok: false, line: '' };
  if (!buyFromShop(state.shopStock, COOKHOUSE_SHOP, dish.item)) {
    return { ok: false, line: SOLD_OUT_LABEL };
  }
  buyer.inventory.addItem(dish.item, 1);
  if (dish.item === 'hamburger') return { ok: true, line: sellerLine(PIPKIN.buyBurger) };
  const stewCannotBeEatenYet = buyer.potionCooldownFrames > 0;
  return {
    ok: true,
    line: sellerLine(stewCannotBeEatenYet ? PIPKIN.stewCooldownActive : PIPKIN.buyStew),
  };
}

export function cookShop(state: BriarHollowState): ShopDefinition {
  return {
    build: () => buildCookMenu(state),
    purchase: (option, buyer) => cookPurchase(state, option, buyer),
    blockedLine: () => sellerLine(PIPKIN.cannotAfford),
    sell: { shop: COOKHOUSE_SHOP, stock: state.shopStock },
  };
}

/** "Buy food" under Pipkin's conversation, while the kitchen is open. */
export function cookhouseTopics(counter: ShopCounter, state: BriarHollowState): TopicProvider {
  return {
    topics(villager, ctx, flow) {
      if (villager !== COOK || !shopTrades(ctx.quest.phase)) return [];
      return [shopTopic('buy_food', 'Buy food', counter, () => cookShop(state), flow)];
    },
  };
}
