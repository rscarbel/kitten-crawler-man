/**
 * Vetch's Nibnose Trading Post: a little of everything, in limited supply.
 *
 * Stock lives in `BriarHollowState.merchantStock`, so a door visit never
 * refills the shelves and a save keeps what was bought. A line with no entry
 * there is fully stocked — a new floor's village starts with nothing recorded,
 * which is what restocks it — and an entry is only ever written by a sale.
 * That also keeps Vetch's "running low" opening honest: the lowest recorded
 * count is always something the party actually bought down.
 *
 * Construction materials are on the shelf, dearer than making them, so a
 * party with coin to spare can skip some of the gathering.
 */

import { ITEM_DEF, type ItemId } from '../../../core/ItemDefs';
import type { BriarHollowState } from '../../../core/briarHollowState';
import type { Player } from '../../../Player';
import { giveInventoryItem } from '../../townServiceUtil';
import { HEALTH_POTION_PRICE } from '../../market/vendorDefs';
import { GOBLIN_DYNAMITE_PRICE } from '../../ShopSystem';
import { SOLD_OUT_LABEL } from '../../market/vendorMenu';
import { TRADING_POST_PRICING } from '../../market/shopProfiles';
import type {
  PricedMenu,
  PricedOption,
  PricedPurchaseResult,
  SellConfig,
} from '../../../ui/PricedMenuPanel';
import type { TopicProvider } from '../villagerTopics';
import { SPEAKERS } from '../../../dialog/speakers';
import { VETCH } from '../../../dialog/scripts/briarHollow';
import { LOW_SUPPLIES_THRESHOLD } from '../villagerCircumstances';
import { HAMBURGER_PRICE } from './cookhouse';
import {
  BAG_FULL_LINE,
  type ShopCounter,
  type ShopDefinition,
  sellerLine,
  shopTopic,
  shopTrades,
} from './serviceContext';

/** A village shop carries its goods a long way; everything the town also sells costs a tenth more. */
const VILLAGE_MARKUP = 1.1;
/** Burgers resold from Pipkin's kitchen, cold, at a quarter over his price. */
const RESOLD_BURGER_MARKUP = 1.25;
/** "Prices may become less friendly": what a line costs once it is running out. */
export const LOW_STOCK_MARKUP = 1.5;

/** Each is dearer than Fenna turning a party's own wood into it, so gathering stays the cheap way. */
export const ROPE_PRICE = 6;
export const BOARD_PRICE = 4;
export const STONE_PRICE = 3;

const TRADING_POST_TITLE = 'Nibnose Trading Post';
export const MERCHANT = 'vetch';

export interface TradingPostLine {
  readonly id: ItemId;
  readonly basePrice: number;
  readonly baseStock: number;
}

export const TRADING_POST_LINES: readonly TradingPostLine[] = [
  {
    id: 'health_potion',
    basePrice: Math.round(HEALTH_POTION_PRICE * VILLAGE_MARKUP),
    baseStock: 5,
  },
  {
    id: 'goblin_dynamite',
    basePrice: Math.round(GOBLIN_DYNAMITE_PRICE * VILLAGE_MARKUP),
    baseStock: 4,
  },
  { id: 'rope', basePrice: ROPE_PRICE, baseStock: 10 },
  { id: 'wood_board', basePrice: BOARD_PRICE, baseStock: 20 },
  { id: 'stone', basePrice: STONE_PRICE, baseStock: 20 },
  { id: 'hamburger', basePrice: Math.round(HAMBURGER_PRICE * RESOLD_BURGER_MARKUP), baseStock: 3 },
];

export function remainingStock(state: BriarHollowState, entry: TradingPostLine): number {
  return state.merchantStock[entry.id] ?? entry.baseStock;
}

/**
 * Running low means bought down to the threshold. A line that starts at or
 * under it (Pipkin sends over only a few burgers) is not "low" until one sells.
 */
export function isRunningLow(state: BriarHollowState, entry: TradingPostLine): boolean {
  const remaining = remainingStock(state, entry);
  return remaining <= LOW_SUPPLIES_THRESHOLD && remaining < entry.baseStock;
}

export function linePrice(state: BriarHollowState, entry: TradingPostLine): number {
  return isRunningLow(state, entry)
    ? Math.ceil(entry.basePrice * LOW_STOCK_MARKUP)
    : entry.basePrice;
}

/** Every shelf back to its full count. A new floor's village starts this way. */
export function restockTradingPost(state: BriarHollowState): void {
  state.merchantStock = {};
}

/** Machine-processed goods the shelf carries only once Fenna has let the crawlers run the mill. */
const PROCESSED_GOODS: ReadonlySet<ItemId> = new Set<ItemId>(['rope', 'wood_board']);

function tradingPostLinesFor(state: BriarHollowState): readonly TradingPostLine[] {
  if (state.unlocks.processingStations) return TRADING_POST_LINES;
  return TRADING_POST_LINES.filter((entry) => !PROCESSED_GOODS.has(entry.id));
}

export function buildTradingPostMenu(state: BriarHollowState): PricedMenu {
  const options = tradingPostLinesFor(state).map((entry): PricedOption => {
    const remaining = remainingStock(state, entry);
    const option: PricedOption = {
      key: entry.id,
      label: ITEM_DEF[entry.id].name,
      price: linePrice(state, entry),
      desc: `${ITEM_DEF[entry.id].description ?? ''} (${remaining} left)`,
    };
    if (remaining <= 0) option.unavailable = SOLD_OUT_LABEL;
    return option;
  });
  return {
    title: TRADING_POST_TITLE,
    bark: sellerLine(VETCH.shopOpen),
    byline: SPEAKERS.vetch.name ?? undefined,
    options,
  };
}

export function tradingPostPurchase(
  state: BriarHollowState,
  option: PricedOption,
  buyer: Player,
  announce: (message: string) => void,
): PricedPurchaseResult {
  const entry = tradingPostLinesFor(state).find((candidate) => candidate.id === option.key);
  if (entry === undefined) return { ok: false, line: '' };
  const remaining = remainingStock(state, entry);
  if (remaining <= 0) return { ok: false, line: SOLD_OUT_LABEL };
  if (!giveInventoryItem(buyer, entry.id)) {
    announce(BAG_FULL_LINE);
    return { ok: false, line: BAG_FULL_LINE };
  }
  const left = remaining - 1;
  state.merchantStock[entry.id] = left;
  return { ok: true, line: `${ITEM_DEF[entry.id].name} — ${left} left.` };
}

function tradingPostSellConfig(state: BriarHollowState): SellConfig {
  return { pricing: TRADING_POST_PRICING, heldStock: state.merchantHeld, vendorId: MERCHANT };
}

export function tradingPostShop(
  state: BriarHollowState,
  announce: (message: string) => void,
): ShopDefinition {
  return {
    build: () => buildTradingPostMenu(state),
    purchase: (option, buyer) => tradingPostPurchase(state, option, buyer, announce),
    blockedLine: (option) => option.unavailable ?? null,
    sell: tradingPostSellConfig(state),
  };
}

/** "Browse" under Vetch's conversation, while the shop is open. */
export function tradingPostTopics(
  state: BriarHollowState,
  counter: ShopCounter,
  announce: (message: string) => void,
): TopicProvider {
  return {
    topics(villager, ctx, flow) {
      if (villager !== MERCHANT || !shopTrades(ctx.quest.phase)) return [];
      return [shopTopic('browse', 'Browse', counter, () => tradingPostShop(state, announce), flow)];
    },
  };
}
