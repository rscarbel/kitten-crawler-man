/**
 * The pricing engine: one function computes every price a shop quotes, and
 * returns its working so a person can see why a shop charges what it does.
 *
 * Every price is built in the same fixed order, each step a multiplier on the
 * running total:
 *
 *  1. **Base**: the item's `ITEM_PRICES` entry (`itemPrices.ts`).
 *  2. **Shop markup**: the shop's `itemMarkup` for this item if it has one,
 *     else its `categoryMarkup` for the item's category, else its shop-wide
 *     `markup` (`shops.ts`). The step's label says which one won.
 *  3. **Stock**: the shop's stock curve (`stockCurves.ts`) at the line's
 *     current stock (`shopStock.ts`). A limited line below normal is scarce
 *     and dearer; anything above normal is overstocked and cheaper. A bundle
 *     drains several units, so its stock step is the average multiplier over
 *     every shelf level the purchase walks through (current, current − 1, …):
 *     a bundle costs exactly what buying its units one by one would, before
 *     the discount, so it can never undercut reselling those units singly.
 *  4. **Bundle**, buying a bundle line only: × quantity × (1 − discount).
 *  5. **Adjustment**, buying only: a temporary sale or surge
 *     (`setPriceAdjustment`) while one is running. A sale never goes below
 *     the most any shop pays back for the item.
 *  6. **Buyback**, selling only: the shop pays `DEFAULT_BUYBACK` of its own
 *     price, or `SPECIALTY_BUYBACK` for a category in its `specialties`.
 *  7. **Round and clamp**: a buy price rounds to nearest, a sell price rounds
 *     up, and neither goes below `MIN_PRICE_COINS`.
 *
 * A sell price is quoted at the stock the shop will hold after taking the
 * unit (current + 1), so each unit sold quotes the next one lower. A shop
 * also never pays more for a unit than it would charge to sell that same unit
 * straight back, so selling and rebuying (or buying and reselling) never
 * gains coins; at a 1-coin price both sides can be 1, which is break-even.
 *
 * Steps whose multiplier is exactly 1 are left out, so a breakdown only lists
 * what actually moved the price.
 *
 * Edit numbers in `itemPrices.ts`, `shops.ts` and `stockCurves.ts`, never
 * here; `npm run report:prices` prints the resulting price sheet.
 */

import { ITEM_DEF, type ItemId } from '../core/items/defs/ItemDefs';
import { ITEM_PRICES, type ItemCategory } from './itemPrices';
import {
  SHOPS,
  isShopId,
  shopDef,
  type CatalogBundle,
  type CatalogLine,
  type ShopDef,
  type ShopId,
} from './shops';
import {
  buyFromShop,
  createShopStock,
  currentStock,
  normalStockOf,
  type ShopStock,
} from './shopStock';
import type { StockCurve } from './stockCurves';

/** What a shop pays for an item outside its specialties, as a fraction of its own buy price. */
export const DEFAULT_BUYBACK = 0.5;
/** What a shop pays for an item in one of its `specialties`. */
export const SPECIALTY_BUYBACK = 0.75;
/** No price, buying or selling, is ever below this. */
export const MIN_PRICE_COINS = 1;

const PERCENT = 100;
/**
 * Absorbs float error in a product of several multipliers, so a price that is
 * a whole number on paper (10 × 0.5 = 5) never rounds up to the next coin
 * because it came out as 5.000000000000001.
 */
const FLOAT_TOLERANCE = 1e-9;

/** Which side of the counter a price is for: the player buying from the shop, or selling to it. */
export type PriceSide = 'buy' | 'sell';

export interface PriceStep {
  /** Human-readable reason, e.g. "Club bar markup", "Low stock (2 of 5)", "Overstocked (+4)", "Pays 50%". */
  readonly label: string;
  readonly multiplier: number;
  /** Running total after this step, unrounded. */
  readonly runningTotal: number;
}

export interface PriceBreakdown {
  readonly base: number;
  /** Only the steps that moved the price, in the fixed order above. */
  readonly steps: readonly PriceStep[];
  /** Base times every step's multiplier: the last step's running total, or the base when there are none. */
  readonly unrounded: number;
  /** Rounded, never below MIN_PRICE_COINS, and on the sell side never above the shop's own price for the unit. */
  readonly final: number;
}

/**
 * A temporary, shop-wide change to what every shop charges: a sale or a surge
 * the AI director calls. It moves buy prices only. A sale also caps what a
 * shop pays, through the rule that a shop never pays more for a unit than it
 * charges for it, so a discount cannot be bought cheap and sold back dear.
 */
export interface PriceAdjustment {
  /** Shown as the step's label in the price working, e.g. "System sale". */
  readonly label: string;
  readonly multiplier: number;
}

/** Units walked off a shelf when measuring the most a shop pays; past any line's normal stock. */
const RESALE_SHELF_WALK_UNITS = 64;

/** The furthest a price adjustment can move a price, either way. */
export const PRICE_ADJUSTMENT_MIN_MULTIPLIER = 0.5;
export const PRICE_ADJUSTMENT_MAX_MULTIPLIER = 1.5;

let activeAdjustment: {
  readonly adjustment: PriceAdjustment;
  readonly expiresAtMs: number;
} | null = null;

/** Starts a price adjustment for `durationMs`, replacing any already running. */
export function setPriceAdjustment(
  adjustment: PriceAdjustment,
  durationMs: number,
  nowMs: number = Date.now(),
): void {
  const multiplier = Math.min(
    PRICE_ADJUSTMENT_MAX_MULTIPLIER,
    Math.max(PRICE_ADJUSTMENT_MIN_MULTIPLIER, adjustment.multiplier),
  );
  activeAdjustment = {
    adjustment: { label: adjustment.label, multiplier },
    expiresAtMs: nowMs + Math.max(0, durationMs),
  };
}

/** The adjustment in force at `nowMs`, or null. */
export function activePriceAdjustment(nowMs: number = Date.now()): PriceAdjustment | null {
  if (activeAdjustment === null) return null;
  if (nowMs >= activeAdjustment.expiresAtMs) {
    activeAdjustment = null;
    return null;
  }
  return activeAdjustment.adjustment;
}

export function clearPriceAdjustment(): void {
  activeAdjustment = null;
}

/** A step before its running total is known. */
interface PriceFactor {
  readonly label: string;
  readonly multiplier: number;
}

/** Which of the shop's markups applies to this item, labelled with the one that won. */
function markupFactor(def: ShopDef, item: ItemId, category: ItemCategory): PriceFactor {
  const itemMarkup = def.itemMarkup[item];
  if (itemMarkup !== undefined) {
    return { label: `${def.name}: ${ITEM_DEF[item].name} markup`, multiplier: itemMarkup };
  }
  const categoryMarkup = def.categoryMarkup[category];
  if (categoryMarkup !== undefined) {
    return { label: `${def.name}: ${category} markup`, multiplier: categoryMarkup };
  }
  return { label: `${def.name} markup`, multiplier: def.markup };
}

/** The stock curve a shop applies to this item: its category override, else its own. */
export function stockCurveFor(shop: ShopId, item: ItemId): StockCurve {
  const def = shopDef(shop);
  return def.categoryStockCurve[ITEM_PRICES[item].category] ?? def.stockCurve;
}

/**
 * The stock multiplier on its own: scarcity below a limited normal, glut
 * above normal (0 for an unlimited line), exactly 1 at normal.
 */
function stockMultiplier(curve: StockCurve, current: number, normal: number | 'unlimited'): number {
  const normalCount = normal === 'unlimited' ? 0 : normal;
  if (normal !== 'unlimited' && current < normal) {
    const fractionGone = 1 - current / normal;
    return 1 + curve.scarcityMarkup * fractionGone;
  }
  if (current > normalCount) {
    const unitsOver = current - normalCount;
    return Math.max(curve.glutFloor, 1 - curve.glutDropPerUnit * unitsOver);
  }
  return 1;
}

/** The stock the price is quoted at: the shelf as it is when buying, with the unit added when selling. */
function quotedStock(stock: ShopStock, shop: ShopId, item: ItemId, side: PriceSide): number {
  const current = currentStock(stock, shop, item);
  return side === 'sell' ? current + 1 : current;
}

function signedOffset(units: number): string {
  return units > 0 ? `+${units}` : `${units}`;
}

/**
 * The stock step for a bundle: the mean of the per-unit multipliers at each
 * shelf level the purchase drains, which is what makes the bundle's
 * undiscounted price the sum of buying its units one at a time. The shelf
 * never quotes below empty, and an unlimited line never drops below normal,
 * matching what `buyFromShop` does to the record.
 */
function bundleStockFactor(
  shop: ShopId,
  item: ItemId,
  current: number,
  bundle: CatalogBundle,
): PriceFactor {
  const normal = normalStockOf(shop, item);
  const normalCount = normal === 'unlimited' ? 0 : normal;
  const curve = stockCurveFor(shop, item);
  const lowestLevel = normal === 'unlimited' ? normalCount : 0;
  let multiplierSum = 0;
  let lastLevel = current;
  for (let unitIndex = 0; unitIndex < bundle.quantity; unitIndex++) {
    lastLevel = Math.max(lowestLevel, current - unitIndex);
    multiplierSum += stockMultiplier(curve, lastLevel, normal);
  }
  const multiplier = multiplierSum / bundle.quantity;
  const label =
    multiplier > 1
      ? `Low stock (${current}→${lastLevel} of ${normalCount})`
      : `Overstocked (${signedOffset(current - normalCount)}→${signedOffset(lastLevel - normalCount)})`;
  return { label, multiplier };
}

function stockFactor(shop: ShopId, item: ItemId, quoted: number): PriceFactor {
  const normal = normalStockOf(shop, item);
  const multiplier = stockMultiplier(stockCurveFor(shop, item), quoted, normal);
  const normalCount = normal === 'unlimited' ? 0 : normal;
  const label =
    quoted < normalCount
      ? `Low stock (${quoted} of ${normalCount})`
      : `Overstocked (+${quoted - normalCount})`;
  return { label, multiplier };
}

function bundleFactor(bundle: CatalogBundle): PriceFactor {
  const percentOff = Math.round(bundle.bundleDiscount * PERCENT);
  return {
    label: `Bundle of ${bundle.quantity} (${percentOff}% off)`,
    multiplier: bundle.quantity * (1 - bundle.bundleDiscount),
  };
}

/** Whether this shop buys the item back at its specialty rate. */
function isSpecialtySale(shop: ShopId, item: ItemId): boolean {
  return shopDef(shop).specialties.includes(ITEM_PRICES[item].category);
}

function buybackFactor(shop: ShopId, item: ItemId): PriceFactor {
  if (isSpecialtySale(shop, item)) {
    return {
      label: `Specialty: pays ${Math.round(SPECIALTY_BUYBACK * PERCENT)}%`,
      multiplier: SPECIALTY_BUYBACK,
    };
  }
  return { label: `Pays ${Math.round(DEFAULT_BUYBACK * PERCENT)}%`, multiplier: DEFAULT_BUYBACK };
}

function applyFactors(
  base: number,
  factors: readonly PriceFactor[],
): { steps: PriceStep[]; unrounded: number } {
  const steps: PriceStep[] = [];
  let runningTotal = base;
  for (const factor of factors) {
    if (factor.multiplier === 1) continue;
    runningTotal *= factor.multiplier;
    steps.push({ label: factor.label, multiplier: factor.multiplier, runningTotal });
  }
  return { steps, unrounded: runningTotal };
}

function roundBuy(unrounded: number): number {
  return Math.max(MIN_PRICE_COINS, Math.round(unrounded + FLOAT_TOLERANCE));
}

function roundSell(unrounded: number): number {
  return Math.max(MIN_PRICE_COINS, Math.ceil(unrounded - FLOAT_TOLERANCE));
}

/**
 * The most any shop pays for one unit of `item` at any shelf level from full
 * to bare, with no adjustment running. A sale held at or above it can never be
 * bought and sold back anywhere, during the sale or after it, for a gain.
 */
function highestResalePrice(item: ItemId): number {
  const cached = highestResaleCache.get(item);
  if (cached !== undefined) return cached;
  let highest = 0;
  for (const shop of Object.keys(SHOPS)) {
    if (!isShopId(shop)) continue;
    const shelf = createShopStock();
    highest = Math.max(highest, breakdown(shop, item, null, shelf, 'sell', null).final);
    // Scarcity raises what a shop pays, so walk its shelf down to bare.
    for (let unit = 0; unit < RESALE_SHELF_WALK_UNITS; unit++) {
      if (!buyFromShop(shelf, shop, item)) break;
      highest = Math.max(highest, breakdown(shop, item, null, shelf, 'sell', null).final);
    }
  }
  highestResaleCache.set(item, highest);
  return highest;
}
const highestResaleCache = new Map<ItemId, number>();

/**
 * A buy price under a sale: the discount applied, then held at the item's
 * {@link highestResalePrice} so the sale is never an arbitrage, and never
 * above what the line costs without the sale.
 */
function saleBreakdown(
  shop: ShopId,
  item: ItemId,
  bundle: CatalogBundle | null,
  quoted: number,
  markup: PriceFactor,
  adjustment: PriceAdjustment,
): PriceBreakdown {
  const { base } = ITEM_PRICES[item];
  const regularFactors =
    bundle === null
      ? [markup, stockFactor(shop, item, quoted)]
      : [markup, bundleStockFactor(shop, item, quoted, bundle), bundleFactor(bundle)];
  const regular = applyFactors(base, regularFactors);
  const units = bundle === null ? 1 : bundle.quantity;
  const resaleFloor = highestResalePrice(item) * units;
  const regularFinal = roundBuy(regular.unrounded);
  const discounted = regular.unrounded * adjustment.multiplier;
  const heldUnrounded = Math.min(regular.unrounded, Math.max(discounted, resaleFloor));
  const multiplier = regular.unrounded > 0 ? heldUnrounded / regular.unrounded : 1;
  const { steps, unrounded } = applyFactors(base, [
    ...regularFactors,
    { label: adjustment.label, multiplier },
  ]);
  return { base, steps, unrounded, final: Math.min(regularFinal, roundBuy(unrounded)) };
}

function breakdown(
  shop: ShopId,
  item: ItemId,
  bundle: CatalogBundle | null,
  stock: ShopStock,
  side: PriceSide,
  adjustment: PriceAdjustment | null = activePriceAdjustment(),
): PriceBreakdown {
  const { base, category } = ITEM_PRICES[item];
  const quoted = quotedStock(stock, shop, item, side);
  const markup = markupFactor(shopDef(shop), item, category);
  const unitFactors = [markup, stockFactor(shop, item, quoted)];
  const adjustmentFactors: PriceFactor[] = adjustment === null ? [] : [adjustment];

  if (side === 'buy') {
    if (adjustment !== null && adjustment.multiplier < 1) {
      return saleBreakdown(shop, item, bundle, quoted, markup, adjustment);
    }
    const factors =
      bundle === null
        ? [...unitFactors, ...adjustmentFactors]
        : [
            markup,
            bundleStockFactor(shop, item, quoted, bundle),
            bundleFactor(bundle),
            ...adjustmentFactors,
          ];
    const { steps, unrounded } = applyFactors(base, factors);
    return { base, steps, unrounded, final: roundBuy(unrounded) };
  }

  const { steps, unrounded } = applyFactors(base, [...unitFactors, buybackFactor(shop, item)]);
  const shopsOwnPriceForTheUnit = roundBuy(
    applyFactors(base, [...unitFactors, ...adjustmentFactors]).unrounded,
  );
  const final = Math.min(roundSell(unrounded), shopsOwnPriceForTheUnit);
  return { base, steps, unrounded, final };
}

/**
 * The full working for one unit of `item` at `shop`. Buying, it prices the
 * item's single-unit line (a bundle line is priced with {@link lineBreakdown});
 * selling, it prices one unit whether or not the shop lists the item.
 */
export function priceBreakdown(
  shop: ShopId,
  item: ItemId,
  stock: ShopStock,
  side: PriceSide,
): PriceBreakdown {
  return breakdown(shop, item, null, stock, side);
}

/**
 * The working for one catalog row, including a bundle row's discount on the
 * buy side. Selling is always one unit, so a bundle row's sell side is the
 * same as {@link priceBreakdown}'s.
 */
export function lineBreakdown(
  shop: ShopId,
  line: CatalogLine,
  stock: ShopStock,
  side: PriceSide,
): PriceBreakdown {
  const bundle = side === 'buy' ? line.bundle : null;
  return breakdown(shop, line.item, bundle, stock, side);
}

/** What the shop charges for one unit right now. */
export function buyPrice(shop: ShopId, item: ItemId, stock: ShopStock): number {
  return priceBreakdown(shop, item, stock, 'buy').final;
}

/** What the shop pays for one unit right now. */
export function sellPrice(shop: ShopId, item: ItemId, stock: ShopStock): number {
  return priceBreakdown(shop, item, stock, 'sell').final;
}

/** Why stock is moving a row's price, for the tag beside it. */
export type StockTag = 'low_stock' | 'overstocked';

/**
 * The tag for the shelf as it stands, on both sides of the counter: null at
 * normal stock. It reads the shelf rather than the sell quote's stock because
 * a sell quote is always one unit above the shelf, which on an unlimited line
 * is already over normal; tagging that would mark every Sell row overstocked
 * before the player had sold a thing.
 */
export function stockTag(shop: ShopId, item: ItemId, stock: ShopStock): StockTag | null {
  const { multiplier } = stockFactor(shop, item, currentStock(stock, shop, item));
  if (multiplier > 1) return 'low_stock';
  if (multiplier < 1) return 'overstocked';
  return null;
}

/**
 * Everything a shop row shows about its price: the working behind it, why
 * stock is moving it, and whether the shop is buying it at its specialty rate
 * (always false on the buy side).
 */
export interface PriceQuote {
  readonly breakdown: PriceBreakdown;
  readonly stockTag: StockTag | null;
  readonly specialty: boolean;
}

/** One catalog row's quote; a bundle row's tag reads the same shelf as its single-unit row. */
export function lineQuote(
  shop: ShopId,
  line: CatalogLine,
  stock: ShopStock,
  side: PriceSide,
): PriceQuote {
  return {
    breakdown: lineBreakdown(shop, line, stock, side),
    stockTag: stockTag(shop, line.item, stock),
    specialty: side === 'sell' && isSpecialtySale(shop, line.item),
  };
}

/** One unit's quote, whether or not the shop lists the item. */
export function itemQuote(
  shop: ShopId,
  item: ItemId,
  stock: ShopStock,
  side: PriceSide,
): PriceQuote {
  return {
    breakdown: priceBreakdown(shop, item, stock, side),
    stockTag: stockTag(shop, item, stock),
    specialty: side === 'sell' && isSpecialtySale(shop, item),
  };
}
