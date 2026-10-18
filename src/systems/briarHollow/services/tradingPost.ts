/**
 * Vetch's Nibnose Trading Post: a little of everything, in limited supply.
 *
 * What the shelf carries and how it prices live on `SHOPS.trading_post`; the
 * stock lives in `BriarHollowState.shopStock`, so a door visit never refills
 * the shelves and a save keeps what was bought. Each floor's village has its
 * own state, so a new floor's village opens fully stocked.
 *
 * Construction materials are on the shelf, dearer than making them, so a
 * party with coin to spare can skip some of the gathering.
 */

import { ITEM_DEF, type ItemId } from '../../../core/ItemDefs';
import type { BriarHollowState } from '../../../core/briarHollowState';
import type { Player } from '../../../Player';
import { SOLD_OUT_LABEL, catalogLinePricing } from '../../market/vendorMenu';
import { SHOPS, type CatalogLine, type ShopId } from '../../../economy/shops';
import {
  buyFromShop,
  currentStock,
  isLimitedLine,
  isSoldOut,
  normalStockOf,
} from '../../../economy/shopStock';
import type {
  ShopMenu,
  ShopRow,
  ShopPurchaseResult,
  ShopSellConfig,
} from '../../../ui/screens/shop/shopSession';
import type { TopicProvider } from '../villagerTopics';
import { SPEAKERS } from '../../../dialog/speakers';
import { VETCH } from '../../../dialog/scripts/briarHollow';
import { LOW_SUPPLIES_THRESHOLD } from '../villagerCircumstances';
import {
  type ShopCounter,
  type ShopDefinition,
  sellerLine,
  shopTopic,
  shopTrades,
} from './serviceContext';

const TRADING_POST_SHOP = 'trading_post' as const satisfies ShopId;
const TRADING_POST_TITLE = 'Nibnose Trading Post';
export const MERCHANT = 'vetch';

export function remainingStock(state: BriarHollowState, item: ItemId): number {
  return currentStock(state.shopStock, TRADING_POST_SHOP, item);
}

/**
 * Running low means bought down to the threshold. A line that starts at or
 * under it (Pipkin sends over only a few burgers) is not "low" until one sells.
 */
export function isRunningLow(state: BriarHollowState, item: ItemId): boolean {
  const normal = normalStockOf(TRADING_POST_SHOP, item);
  if (normal === 'unlimited') return false;
  const remaining = remainingStock(state, item);
  return remaining <= LOW_SUPPLIES_THRESHOLD && remaining < normal;
}

/** Whether any line on Vetch's shelf is running low, which is what sets him worrying about supplies. */
export function tradingPostRunningLow(state: BriarHollowState): boolean {
  return SHOPS.trading_post.catalog.some((line) => isRunningLow(state, line.item));
}

/** Machine-processed goods the shelf carries only once Fenna has let the crawlers run the mill. */
const PROCESSED_GOODS: ReadonlySet<ItemId> = new Set<ItemId>(['rope', 'wood_board']);

function tradingPostLinesFor(state: BriarHollowState): readonly CatalogLine[] {
  const lines: readonly CatalogLine[] = SHOPS.trading_post.catalog;
  if (state.unlocks.processingStations) return lines;
  return lines.filter((line) => !PROCESSED_GOODS.has(line.item));
}

export function buildTradingPostMenu(state: BriarHollowState): ShopMenu {
  const options = tradingPostLinesFor(state).map((line): ShopRow => {
    const remaining = remainingStock(state, line.item);
    const description = line.desc ?? ITEM_DEF[line.item].description ?? '';
    const option: ShopRow = {
      key: line.item,
      label: line.label ?? ITEM_DEF[line.item].name,
      ...catalogLinePricing(TRADING_POST_SHOP, line, state.shopStock),
      desc: isLimitedLine(TRADING_POST_SHOP, line.item)
        ? `${description} (${remaining} left)`
        : description,
    };
    if (isSoldOut(state.shopStock, TRADING_POST_SHOP, line.item)) {
      option.unavailable = SOLD_OUT_LABEL;
    }
    return option;
  });
  return {
    title: TRADING_POST_TITLE,
    bark: sellerLine(VETCH.shopOpen),
    byline: SPEAKERS.vetch.name,
    options,
  };
}

export function tradingPostPurchase(
  state: BriarHollowState,
  option: ShopRow,
  buyer: Player,
): ShopPurchaseResult {
  const line = tradingPostLinesFor(state).find((candidate) => candidate.item === option.key);
  if (line === undefined) return { ok: false, line: '' };
  if (!buyFromShop(state.shopStock, TRADING_POST_SHOP, line.item)) {
    return { ok: false, line: SOLD_OUT_LABEL };
  }
  buyer.inventory.addItem(line.item, 1);
  const left = remainingStock(state, line.item);
  return { ok: true, line: `${ITEM_DEF[line.item].name} — ${left} left.` };
}

function tradingPostSellConfig(state: BriarHollowState): ShopSellConfig {
  return { shop: TRADING_POST_SHOP, stock: state.shopStock };
}

export function tradingPostShop(state: BriarHollowState): ShopDefinition {
  return {
    build: () => buildTradingPostMenu(state),
    purchase: (option, buyer) => tradingPostPurchase(state, option, buyer),
    blockedLine: (option) => option.unavailable ?? null,
    sell: tradingPostSellConfig(state),
  };
}

/** "Browse" under Vetch's conversation, while the shop is open. */
export function tradingPostTopics(state: BriarHollowState, counter: ShopCounter): TopicProvider {
  return {
    topics(villager, ctx, flow) {
      if (villager !== MERCHANT || !shopTrades(ctx.quest.phase)) return [];
      return [shopTopic('browse', 'Browse', counter, () => tradingPostShop(state), flow)];
    },
  };
}
