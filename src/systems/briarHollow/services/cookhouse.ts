/**
 * Pipkin's Cookhouse: burgers for a quick bite, stew for a proper heal.
 *
 * The stew heals exactly like a health potion and shares its cooldown, so it
 * costs what a potion does. A burger heals about half as much, but it feeds a
 * strength bonus and has no cooldown at all, so it is priced a little over
 * half a potion rather than at half.
 */

import { ITEM_DEF, type ItemId } from '../../../core/ItemDefs';
import type { Player } from '../../../Player';
import { giveInventoryItem } from '../../townServiceUtil';
import { HEALTH_POTION_PRICE } from '../../market/vendorDefs';
import type { PricedMenu, PricedOption, PricedPurchaseResult } from '../../../ui/PricedMenuPanel';
import type { TopicProvider } from '../villagerTopics';
import { villagerEntry } from '../ratkinDialogue';
import {
  BAG_FULL_LINE,
  type ShopCounter,
  type ShopDefinition,
  sellerLine,
  shopTopic,
  shopTrades,
} from './serviceContext';

/** A burger's price as a share of a potion's: half the heal, plus a buff and no cooldown. */
const HAMBURGER_PRICE_SHARE_OF_POTION = 0.6;

/** Hollow Stew is a potion in a bowl, and costs one. */
export const HOLLOW_STEW_PRICE = HEALTH_POTION_PRICE;
export const HAMBURGER_PRICE = Math.round(HEALTH_POTION_PRICE * HAMBURGER_PRICE_SHARE_OF_POTION);

const COOKHOUSE_TITLE = "Pipkin's Cookhouse";
export const COOK = 'pipkin';

const MENU_ITEMS: ReadonlyArray<{ readonly id: ItemId; readonly price: number }> = [
  { id: 'hamburger', price: HAMBURGER_PRICE },
  { id: 'hollow_stew', price: HOLLOW_STEW_PRICE },
];

export function buildCookMenu(): PricedMenu {
  const options: PricedOption[] = MENU_ITEMS.map(({ id, price }) => ({
    key: id,
    label: ITEM_DEF[id].name,
    price,
    desc: ITEM_DEF[id].description ?? '',
  }));
  return {
    title: COOKHOUSE_TITLE,
    bark: sellerLine(COOK, 'shop_open'),
    byline: villagerEntry(COOK).name,
    options,
  };
}

/**
 * Hands the dish over, or refuses the sale when there is nowhere to put it.
 * Stew bought while the buyer's potion cooldown is still running still sells
 * — it keeps — but Pipkin says why it can't be eaten yet.
 */
export function cookPurchase(
  option: PricedOption,
  buyer: Player,
  announce: (message: string) => void,
): PricedPurchaseResult {
  const dish = MENU_ITEMS.find((item) => item.id === option.key);
  if (dish === undefined) return { ok: false, line: '' };
  if (!giveInventoryItem(buyer, dish.id)) {
    announce(BAG_FULL_LINE);
    return { ok: false, line: BAG_FULL_LINE };
  }
  if (dish.id === 'hamburger') return { ok: true, line: sellerLine(COOK, 'buy_burger') };
  const stewCannotBeEatenYet = buyer.potionCooldownFrames > 0;
  return {
    ok: true,
    line: sellerLine(COOK, stewCannotBeEatenYet ? 'stew_cooldown_active' : 'buy_stew'),
  };
}

export function cookShop(announce: (message: string) => void): ShopDefinition {
  return {
    build: buildCookMenu,
    purchase: (option, buyer) => cookPurchase(option, buyer, announce),
    blockedLine: () => sellerLine(COOK, 'cannot_afford'),
  };
}

/** "Buy food" under Pipkin's conversation, while the kitchen is open. */
export function cookhouseTopics(
  counter: ShopCounter,
  announce: (message: string) => void,
): TopicProvider {
  return {
    topics(villager, ctx) {
      if (villager !== COOK || !shopTrades(ctx.quest.phase)) return [];
      return [shopTopic('buy_food', 'Buy food', counter, () => cookShop(announce))];
    },
  };
}
