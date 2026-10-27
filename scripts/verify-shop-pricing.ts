#!/usr/bin/env tsx
/**
 * Headless gate on the shop pricing engine (`src/economy/`). It checks
 * behaviour, never balance: no price is held to a band, so retuning a base,
 * a markup or a curve keeps it green as long as the rules below still hold.
 *
 *  - No round trip at a counter gains coins: selling a unit and buying it
 *    straight back, or buying one and selling it straight back, at several
 *    stock levels, for every catalog line and every sellable item a shop
 *    does not list.
 *  - Scarcity never makes a unit cheaper as stock falls; glut never makes it
 *    dearer as stock rises, and never takes it below the curve's floor.
 *  - Every catalog line costs at least `MIN_PRICE_COINS`.
 *  - A breakdown's steps, multiplied onto its base, reproduce its total.
 *  - Restock moves every line toward normal by the global step, never past
 *    it, on one clock shared by every shop, and only while it is ticked.
 *  - A checkpoint snapshot round-trips and shares no state with the record.
 *
 * Run: npm run verify:shop-pricing
 */

import { canSellItemId, isItemId, type ItemId } from '../src/core/items/defs/ItemDefs';
import { ITEM_PRICES } from '../src/economy/itemPrices';
import {
  MIN_PRICE_COINS,
  lineBreakdown,
  priceBreakdown,
  stockCurveFor,
  type PriceBreakdown,
  type PriceSide,
} from '../src/economy/pricing';
import {
  SHOPS,
  catalogLineUnits,
  isShopId,
  shopDef,
  type CatalogLine,
  type ShopId,
} from '../src/economy/shops';
import {
  RESTOCK_FRACTION_PER_INTERVAL,
  RESTOCK_INTERVAL_TICKS,
  buyFromShop,
  captureShopStock,
  createShopStock,
  normalStockOf,
  parseShopStockSnapshot,
  restockStep,
  restoreShopStock,
  sellToShop,
  shopStockKey,
  stockOffset,
  tickShopStock,
  type ShopStock,
  type ShopStockSnapshot,
} from '../src/economy/shopStock';

let checksRun = 0;
let checksFailed = 0;

/** Logs only a failing check, so a full run stays readable; each section prints its count. */
function check(condition: boolean, description: string): void {
  checksRun++;
  if (condition) return;
  checksFailed++;
  console.log(`  FAIL ${description}`);
}

let sectionStartRun = 0;
let sectionStartFailed = 0;
function section(title: string): void {
  sectionStartRun = checksRun;
  sectionStartFailed = checksFailed;
  console.log(`\n${title}`);
}
function endSection(): void {
  if (checksFailed > sectionStartFailed) return;
  console.log(`  ok   ${checksRun - sectionStartRun} checks`);
}

/** Relative slack for comparing products of a handful of float multipliers. */
const FLOAT_EPSILON = 1e-9;
function approxLessOrEqual(a: number, b: number): boolean {
  return a <= b + FLOAT_EPSILON * Math.max(1, Math.abs(b));
}
function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= FLOAT_EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

const SOLD_IN_ONE = 1;
const SOLD_IN_HANDFUL = 5;
const SOLD_IN_DUMP = 20;
const SOLD_IN_OFFSETS = [SOLD_IN_ONE, SOLD_IN_HANDFUL, SOLD_IN_DUMP] as const;
/** How far past the point a curve reaches its floor the glut walk keeps going. */
const GLUT_PAST_FLOOR_UNITS = 5;

const SHOP_IDS: readonly ShopId[] = Object.keys(SHOPS).filter(isShopId);
const ITEM_IDS: readonly ItemId[] = Object.keys(ITEM_PRICES).filter(isItemId);

function catalogItems(shop: ShopId): ReadonlySet<ItemId> {
  return new Set(shopDef(shop).catalog.map((line) => line.item));
}

/** Every sellable item a shop does not list: what a player can walk in and sell it. */
function unlistedSellableItems(shop: ShopId): ItemId[] {
  const listed = catalogItems(shop);
  return ITEM_IDS.filter((item) => canSellItemId(item) && !listed.has(item));
}

/** A stock record with one line set `offset` units away from normal. */
function stockAt(shop: ShopId, item: ItemId, offset: number): ShopStock {
  const stock = createShopStock();
  if (offset !== 0) stock.offsets[shopStockKey(shop, item)] = offset;
  return stock;
}

function normalCount(shop: ShopId, item: ItemId): number {
  const normal = normalStockOf(shop, item);
  return normal === 'unlimited' ? 0 : normal;
}

/**
 * The stock offsets worth testing a line at: normal, sold in, and for a
 * limited line bought down by one, by half, to its last unit and to empty.
 * An unlimited line or unlisted item cannot go below normal.
 */
function stockOffsets(shop: ShopId, item: ItemId): number[] {
  const normal = normalCount(shop, item);
  const boughtDown = normal === 0 ? [] : [-1, -Math.floor(normal / 2), -(normal - 1), -normal];
  return [...new Set([0, ...boughtDown, ...SOLD_IN_OFFSETS])];
}

function describe(shop: ShopId, item: ItemId, offset: number): string {
  const sign = offset > 0 ? '+' : '';
  return `${shop}/${item} at stock ${sign}${offset}`;
}

/** Every breakdown the gate reads also has its arithmetic checked. */
function checkBreakdownArithmetic(working: PriceBreakdown, context: string): void {
  let product = working.base;
  for (const step of working.steps) {
    product *= step.multiplier;
    check(
      approxEqual(step.runningTotal, product),
      `${context}: step "${step.label}" running total ${step.runningTotal} != base × multipliers so far ${product}`,
    );
    check(step.multiplier !== 1, `${context}: step "${step.label}" has multiplier 1 but is listed`);
  }
  check(
    approxEqual(working.unrounded, product),
    `${context}: unrounded ${working.unrounded} != base ${working.base} × step multipliers ${product}`,
  );
  check(
    working.final >= MIN_PRICE_COINS,
    `${context}: final ${working.final} < MIN_PRICE_COINS ${MIN_PRICE_COINS}`,
  );
}

function breakdownOf(
  shop: ShopId,
  item: ItemId,
  stock: ShopStock,
  side: PriceSide,
  context: string,
): PriceBreakdown {
  const working = priceBreakdown(shop, item, stock, side);
  checkBreakdownArithmetic(working, `${context} ${side}`);
  return working;
}

/**
 * Sells one unit, then buys it straight back. Checked twice: on the coins
 * the player sees, and on the unrounded working. The engine caps a sell
 * quote at the shop's own price for the unit, so the coin check alone would
 * stay green even with a buyback fraction above 1; the working shows
 * whether the curve and buyback hold the line on their own, leaving the cap
 * to absorb nothing but rounding.
 */
function checkSellThenBuy(shop: ShopId, item: ItemId, offset: number): void {
  const context = describe(shop, item, offset);
  const stock = stockAt(shop, item, offset);
  const sold = breakdownOf(shop, item, stock, 'sell', context);
  sellToShop(stock, shop, item);
  const boughtBack = breakdownOf(shop, item, stock, 'buy', `${context} after selling one`);
  check(
    boughtBack.final >= sold.final,
    `${context}: sold for ${sold.final}, bought back for ${boughtBack.final} (gains coins)`,
  );
  check(
    approxLessOrEqual(sold.unrounded, boughtBack.unrounded),
    `${context}: sell working ${sold.unrounded} exceeds buy-back working ${boughtBack.unrounded} (arbitrage)`,
  );
}

/**
 * Buys one row (a whole bundle for a bundle line, a single unit when `line`
 * is undefined), then sells every unit back one at a time, each quoted at the
 * stock the shop holds by then.
 */
function checkLineBuyThenSell(
  shop: ShopId,
  item: ItemId,
  line: CatalogLine | undefined,
  offset: number,
): void {
  const units = line === undefined ? 1 : catalogLineUnits(line);
  const context = `${describe(shop, item, offset)}${units > 1 ? ` (bundle of ${units})` : ''}`;
  const stock = stockAt(shop, item, offset);
  const bought =
    line === undefined
      ? breakdownOf(shop, item, stock, 'buy', context)
      : lineBreakdown(shop, line, stock, 'buy');
  checkBreakdownArithmetic(bought, `${context} buy`);
  if (!buyFromShop(stock, shop, item, units)) return;
  let soldFinal = 0;
  let soldUnrounded = 0;
  for (let unit = 0; unit < units; unit++) {
    const sold = breakdownOf(shop, item, stock, 'sell', `${context} selling back`);
    soldFinal += sold.final;
    soldUnrounded += sold.unrounded;
    sellToShop(stock, shop, item);
  }
  check(
    soldFinal <= bought.final,
    `${context}: bought for ${bought.final}, sold back for ${soldFinal} (gains coins)`,
  );
  check(
    approxLessOrEqual(soldUnrounded, bought.unrounded),
    `${context}: sell-back working ${soldUnrounded} exceeds buy working ${bought.unrounded} (arbitrage)`,
  );
}

/** Buys each row the shop sells the item on (or one unit of an unlisted item), then sells it all back. */
function checkBuyThenSell(shop: ShopId, item: ItemId, offset: number): void {
  const lines = shopDef(shop).catalog.filter((line) => line.item === item);
  if (lines.length === 0) {
    checkLineBuyThenSell(shop, item, undefined, offset);
    return;
  }
  for (const line of lines) checkLineBuyThenSell(shop, item, line, offset);
}

section('No round trip gains coins: catalog lines, at normal, bought down and sold in');
for (const shop of SHOP_IDS) {
  if (!shopDef(shop).buysFromPlayer) continue;
  for (const item of catalogItems(shop)) {
    for (const offset of stockOffsets(shop, item)) {
      checkSellThenBuy(shop, item, offset);
      checkBuyThenSell(shop, item, offset);
    }
  }
}
endSection();

section('No round trip gains coins: every sellable item a shop does not list');
for (const shop of SHOP_IDS) {
  if (!shopDef(shop).buysFromPlayer) continue;
  for (const item of unlistedSellableItems(shop)) {
    for (const offset of stockOffsets(shop, item)) {
      checkSellThenBuy(shop, item, offset);
      checkBuyThenSell(shop, item, offset);
    }
  }
}
endSection();

/**
 * The cheapest price any stocking shop charges for the item at normal stock,
 * or undefined when no shop stocks it.
 */
function cheapestStockedBuy(item: ItemId): { shop: ShopId; price: number } | undefined {
  let cheapest: { shop: ShopId; price: number } | undefined;
  for (const shop of SHOP_IDS) {
    if (!catalogItems(shop).has(item)) continue;
    const price = breakdownOf(shop, item, createShopStock(), 'buy', describe(shop, item, 0)).final;
    if (cheapest === undefined || price < cheapest.price) cheapest = { shop, price };
  }
  return cheapest;
}

section('No shop pays more for an item than the cheapest shop stocking it charges');
for (const item of ITEM_IDS) {
  if (!canSellItemId(item)) continue;
  const cheapest = cheapestStockedBuy(item);
  if (cheapest === undefined) continue;
  for (const shop of SHOP_IDS) {
    if (!shopDef(shop).buysFromPlayer) continue;
    const pays = breakdownOf(shop, item, createShopStock(), 'sell', describe(shop, item, 0)).final;
    check(
      pays <= cheapest.price,
      `${item}: ${shop} pays ${pays}, but ${cheapest.shop} sells it for ${cheapest.price} (buy there, sell here)`,
    );
  }
}
endSection();

section('Bundles never gain coins: every real bundle row, at every stock level');
for (const shop of SHOP_IDS) {
  if (!shopDef(shop).buysFromPlayer) continue;
  for (const line of shopDef(shop).catalog) {
    if (line.bundle === null) continue;
    for (const offset of stockOffsets(shop, line.item)) {
      checkLineBuyThenSell(shop, line.item, line, offset);
    }
  }
}
endSection();

const PAIR_BUNDLE = 2;
const TRIPLE_BUNDLE = 3;
const SYNTHETIC_BUNDLE_SIZES = [PAIR_BUNDLE, TRIPLE_BUNDLE] as const;

/**
 * The smallest discount any real bundle row offers. A synthetic bundle with
 * less discount than that is not a row anyone would write, and a zero-discount
 * bundle over a cheap line always has a coin of rounding slack.
 */
function smallestRealBundleDiscount(): number | undefined {
  const discounts = SHOP_IDS.flatMap((shop) =>
    shopDef(shop).catalog.flatMap((line) =>
      line.bundle === null ? [] : [line.bundle.bundleDiscount],
    ),
  );
  return discounts.length === 0 ? undefined : Math.min(...discounts);
}

/**
 * No real bundle row is limited, so a bundle draining a scarce shelf is tried
 * as a synthetic row over every limited line whose curve has scarcity.
 * `lineBreakdown` takes the row itself while normal stock, curve, markup and
 * buyback all come from the real shop. Only the scarce range (normal and
 * below) is walked: overstocked, a 1–3 coin unit's rounded-up sell-backs carry
 * more slack than a bundle discount takes off, which is rounding on a row
 * nobody stocks rather than the averaged scarcity pricing this guards.
 */
section('Bundles never gain coins: synthetic bundles over scarce limited lines');
{
  const discount = smallestRealBundleDiscount();
  if (discount === undefined) {
    console.log('  ..   skipped: no shop sells a bundle row to take a realistic discount from');
  } else {
    for (const shop of SHOP_IDS) {
      if (!shopDef(shop).buysFromPlayer) continue;
      for (const line of shopDef(shop).catalog) {
        if (line.normalStock === 'unlimited' || line.bundle !== null) continue;
        if (stockCurveFor(shop, line.item).scarcityMarkup <= 0) continue;
        const normal = line.normalStock;
        for (const quantity of SYNTHETIC_BUNDLE_SIZES) {
          if (quantity > normal) continue;
          const row: CatalogLine = { ...line, bundle: { quantity, bundleDiscount: discount } };
          for (const offset of stockOffsets(shop, line.item)) {
            if (offset > 0) continue;
            checkLineBuyThenSell(shop, line.item, row, offset);
          }
        }
      }
    }
  }
}
endSection();

section('Scarcity: a limited line never gets cheaper as its stock falls');
for (const shop of SHOP_IDS) {
  for (const item of catalogItems(shop)) {
    const normal = normalCount(shop, item);
    if (normal === 0) continue;
    let previous = breakdownOf(shop, item, createShopStock(), 'buy', describe(shop, item, 0));
    for (let left = normal - 1; left >= 1; left--) {
      const offset = left - normal;
      const context = describe(shop, item, offset);
      const current = breakdownOf(shop, item, stockAt(shop, item, offset), 'buy', context);
      check(
        current.final >= previous.final,
        `${context}: ${current.final} with ${left} left < ${previous.final} with one more`,
      );
      check(
        approxLessOrEqual(previous.unrounded, current.unrounded),
        `${context}: working ${current.unrounded} with ${left} left < ${previous.unrounded} with one more`,
      );
      previous = current;
    }
  }
}
endSection();

/** Units over normal at which a curve has certainly reached its floor, plus some. */
function glutWalkLength(shop: ShopId, item: ItemId): number {
  const curve = stockCurveFor(shop, item);
  if (curve.glutDropPerUnit <= 0) return GLUT_PAST_FLOOR_UNITS;
  return Math.ceil((1 - curve.glutFloor) / curve.glutDropPerUnit) + GLUT_PAST_FLOOR_UNITS;
}

/**
 * The floor is checked twice. On the working, the glut multiplier is a plain
 * product, so `unrounded ≥ glutFloor × the at-normal unrounded` holds exactly.
 * On coins, the at-normal price is already rounded, so `glutFloor × final`
 * can sit a fraction above a correctly rounded glut price; rounding is
 * monotonic, though, so the glut price can never round below the floored
 * working rounded the same way.
 */
function checkGlut(shop: ShopId, item: ItemId): void {
  const floor = stockCurveFor(shop, item).glutFloor;
  const atNormal = breakdownOf(shop, item, createShopStock(), 'buy', describe(shop, item, 0));
  const flooredWorking = floor * atNormal.unrounded;
  const flooredCoins = Math.max(MIN_PRICE_COINS, Math.round(flooredWorking));
  let previous = atNormal;
  for (let over = 1; over <= glutWalkLength(shop, item); over++) {
    const context = describe(shop, item, over);
    const current = breakdownOf(shop, item, stockAt(shop, item, over), 'buy', context);
    check(
      current.final <= previous.final,
      `${context}: ${current.final} > ${previous.final} with one fewer held`,
    );
    check(
      approxLessOrEqual(current.unrounded, previous.unrounded),
      `${context}: working ${current.unrounded} > ${previous.unrounded} with one fewer held`,
    );
    check(
      approxLessOrEqual(flooredWorking, current.unrounded),
      `${context}: working ${current.unrounded} below glutFloor ${floor} × at-normal ${atNormal.unrounded}`,
    );
    check(
      current.final >= flooredCoins,
      `${context}: ${current.final} below the floored price ${flooredCoins}`,
    );
    previous = current;
  }
}

section('Glut: a line never gets dearer as stock rises, and never drops below its floor');
for (const shop of SHOP_IDS) {
  for (const item of catalogItems(shop)) checkGlut(shop, item);
  if (!shopDef(shop).buysFromPlayer) continue;
  for (const item of unlistedSellableItems(shop)) checkGlut(shop, item);
}
endSection();

section('Every catalog line costs at least MIN_PRICE_COINS, at every stock level');
for (const shop of SHOP_IDS) {
  for (const line of shopDef(shop).catalog) {
    for (const offset of stockOffsets(shop, line.item)) {
      const context = describe(shop, line.item, offset);
      const working = lineBreakdown(shop, line, stockAt(shop, line.item, offset), 'buy');
      checkBreakdownArithmetic(working, `${context} line buy`);
    }
  }
}
endSection();

/** Advances the restock clock by exactly one interval. */
function tickOneInterval(stock: ShopStock): void {
  for (let tick = 0; tick < RESTOCK_INTERVAL_TICKS; tick++) tickShopStock(stock);
}

/** The first real catalog line whose normal stock passes `matches`, so restock can be watched through the real record. */
function findLine(
  matches: (normal: number | 'unlimited') => boolean,
): { shop: ShopId; item: ItemId } | undefined {
  for (const shop of SHOP_IDS) {
    for (const line of shopDef(shop).catalog) {
      if (matches(line.normalStock)) return { shop, item: line.item };
    }
  }
  return undefined;
}

/** The limited line with the deepest normal stock, so it can be bought furthest down. */
function deepestLimitedLine(): { shop: ShopId; item: ItemId; normal: number } | undefined {
  let deepest: { shop: ShopId; item: ItemId; normal: number } | undefined;
  for (const shop of SHOP_IDS) {
    for (const line of shopDef(shop).catalog) {
      if (line.normalStock === 'unlimited') continue;
      if (deepest === undefined || line.normalStock > deepest.normal) {
        deepest = { shop, item: line.item, normal: line.normalStock };
      }
    }
  }
  return deepest;
}

/** An offset after one restock step: moved `step` toward normal, never past it. */
function afterOneStep(offset: number, step: number): number {
  return offset - Math.sign(offset) * Math.min(step, Math.abs(offset));
}

/** How far below normal the single-line restock walk starts, when the line is that deep. */
const WALK_UNITS_BELOW = 3;
const SOLD_IN_TWO = 2;
const ONE_BELOW = -1;
/** A normal stock larger than any shop lists, to check the step scales with normal rather than staying at one unit. */
const LARGE_NORMAL = 500;
const LARGE_NORMAL_UNITS_BELOW = 20;

section('Restock: one interval of ticks moves a line one step toward normal');
{
  const walked = deepestLimitedLine();
  check(walked !== undefined, 'no limited catalog line to watch restock');
  if (walked !== undefined) {
    const { shop, item, normal } = walked;
    const step = restockStep(normal);
    const startOffset = -Math.min(WALK_UNITS_BELOW, normal);
    const expectedOffset = afterOneStep(startOffset, step);
    const stock = stockAt(shop, item, startOffset);
    tickShopStock(stock);
    check(
      stockOffset(stock, shop, item) === startOffset,
      `${shop}/${item}: restocked after a single tick`,
    );
    for (let tick = 1; tick < RESTOCK_INTERVAL_TICKS - 1; tick++) tickShopStock(stock);
    check(
      stockOffset(stock, shop, item) === startOffset,
      `${shop}/${item}: restocked one tick before the interval of ${RESTOCK_INTERVAL_TICKS} ticks`,
    );
    tickShopStock(stock);
    check(
      stockOffset(stock, shop, item) === expectedOffset,
      `${shop}/${item} (normal ${normal}, step ${step}): ${-startOffset} below became ${-stockOffset(stock, shop, item)} below, not ${-expectedOffset}`,
    );

    const oneBelow = stockAt(shop, item, ONE_BELOW);
    tickOneInterval(oneBelow);
    check(
      stockOffset(oneBelow, shop, item) === 0,
      `${shop}/${item}: 1 below did not end at normal (${stockOffset(oneBelow, shop, item)})`,
    );
  }

  const unlimitedLine = findLine((normal) => normal === 'unlimited');
  check(unlimitedLine !== undefined, 'no unlimited catalog line to test');
  if (unlimitedLine !== undefined) {
    const { shop, item } = unlimitedLine;
    const stock = stockAt(shop, item, SOLD_IN_TWO);
    tickOneInterval(stock);
    const expectedOffset = afterOneStep(SOLD_IN_TWO, restockStep('unlimited'));
    check(
      stockOffset(stock, shop, item) === expectedOffset,
      `${shop}/${item} (unlimited): ${SOLD_IN_TWO} over became ${stockOffset(stock, shop, item)} over, not ${expectedOffset}`,
    );
  }

  // The record only knows the normals in SHOPS, so a normal larger than any
  // shop lists is checked on the step itself. The record-level walk below
  // applies the same step to every real line, so a large-normal line added
  // later is covered end to end automatically.
  const largeStep = restockStep(LARGE_NORMAL);
  const largeExpected = Math.max(
    1,
    Math.ceil(RESTOCK_FRACTION_PER_INTERVAL * LARGE_NORMAL - FLOAT_EPSILON),
  );
  check(
    largeStep === largeExpected,
    `normal ${LARGE_NORMAL}: one step is ${largeStep} units, not the rounded-up fraction ${largeExpected}, so ${LARGE_NORMAL_UNITS_BELOW} below would become ${LARGE_NORMAL_UNITS_BELOW - largeStep} below`,
  );
  check(
    restockStep('unlimited') >= 1,
    `an unlimited line steps ${restockStep('unlimited')} units, so a sold-in unlimited line never drains`,
  );
}
endSection();

section('Restock: every real line moves exactly one step toward normal and never crosses it');
for (const shop of SHOP_IDS) {
  const items = [...catalogItems(shop), ...unlistedSellableItems(shop).slice(0, 1)];
  for (const item of items) {
    const normal = normalStockOf(shop, item);
    const step = restockStep(normal);
    const offsets = [...stockOffsets(shop, item), step, -step, step + 1, -(step + 1)].filter(
      (offset) => offset >= -normalCount(shop, item) && (normal !== 'unlimited' || offset >= 0),
    );
    for (const offset of new Set(offsets)) {
      const stock = stockAt(shop, item, offset);
      tickOneInterval(stock);
      const after = stockOffset(stock, shop, item);
      const expectedDistance = Math.max(0, Math.abs(offset) - step);
      const context = describe(shop, item, offset);
      check(
        Math.abs(after) === expectedDistance,
        `${context}: after one interval ${after} from normal, expected ${expectedDistance} away`,
      );
      check(Math.sign(after) * Math.sign(offset) >= 0, `${context}: crossed normal to ${after}`);
    }
  }
}
endSection();

/**
 * Up to `count` catalog lines from different shops that pass `matches`, so a
 * shared-clock check spans counters rather than one shop's shelf.
 */
function linesFromDistinctShops(
  count: number,
  matches: (line: CatalogLine) => boolean,
  excludeShops: ReadonlySet<ShopId> = new Set(),
): { shop: ShopId; item: ItemId }[] {
  const picked: { shop: ShopId; item: ItemId }[] = [];
  for (const shop of SHOP_IDS) {
    if (picked.length >= count) break;
    if (excludeShops.has(shop)) continue;
    const line = shopDef(shop).catalog.find(matches);
    if (line !== undefined) picked.push({ shop, item: line.item });
  }
  return picked;
}

const SHARED_CLOCK_SOLD_IN_SHOPS = 2;

section('One tickShopStock call restocks every shop line together');
{
  const boughtDownLine = linesFromDistinctShops(
    1,
    (line) => line.normalStock !== 'unlimited' && line.normalStock > 1,
  )[0];
  check(boughtDownLine !== undefined, 'no limited catalog line to test restocking across shops');
  const soldInLines = linesFromDistinctShops(
    SHARED_CLOCK_SOLD_IN_SHOPS,
    () => true,
    new Set(boughtDownLine === undefined ? [] : [boughtDownLine.shop]),
  );
  check(
    soldInLines.length === SHARED_CLOCK_SOLD_IN_SHOPS,
    `fewer than ${SHARED_CLOCK_SOLD_IN_SHOPS} other shops have a catalog line to sell into`,
  );
  const [twiceSold, onceSold] = soldInLines;
  if (boughtDownLine !== undefined && twiceSold !== undefined && onceSold !== undefined) {
    const shared = createShopStock();
    sellToShop(shared, twiceSold.shop, twiceSold.item);
    sellToShop(shared, twiceSold.shop, twiceSold.item);
    sellToShop(shared, onceSold.shop, onceSold.item);
    buyFromShop(shared, boughtDownLine.shop, boughtDownLine.item);

    const halted = captureShopStock(shared);
    const untickedCopy = createShopStock();
    restoreShopStock(untickedCopy, halted);
    tickOneInterval(shared);

    const expectAfterOneStep = (line: { shop: ShopId; item: ItemId }, offset: number): void => {
      const expected = afterOneStep(offset, restockStep(normalStockOf(line.shop, line.item)));
      const actual = stockOffset(shared, line.shop, line.item);
      check(
        actual === expected,
        `${line.shop}/${line.item} did not restock from the shared clock (${actual}, expected ${expected})`,
      );
    };
    expectAfterOneStep(twiceSold, SOLD_IN_TWO);
    expectAfterOneStep(onceSold, SOLD_IN_ONE);
    expectAfterOneStep(boughtDownLine, ONE_BELOW);
    check(
      stockOffset(untickedCopy, twiceSold.shop, twiceSold.item) === SOLD_IN_TWO &&
        stockOffset(untickedCopy, boughtDownLine.shop, boughtDownLine.item) === ONE_BELOW,
      'a record that was never ticked (a halted world) moved anyway',
    );
  }
}
endSection();

function snapshotsEqual(a: ShopStockSnapshot, b: ShopStockSnapshot): boolean {
  const aKeys = Object.keys(a.offsets).filter((key) => (a.offsets[key] ?? 0) !== 0);
  const bKeys = Object.keys(b.offsets).filter((key) => (b.offsets[key] ?? 0) !== 0);
  return (
    a.ticksSinceRestock === b.ticksSinceRestock &&
    aKeys.length === bKeys.length &&
    aKeys.every((key) => a.offsets[key] === b.offsets[key])
  );
}

const PARTIAL_INTERVAL_TICKS = 7;

section('Checkpoints round-trip and never alias the live record');
{
  const live = createShopStock();
  sellToShop(live, 'club_bar', 'speed_fizz');
  buyFromShop(live, 'general_store', 'health_potion');
  for (let tick = 0; tick < PARTIAL_INTERVAL_TICKS; tick++) tickShopStock(live);

  const snapshot = captureShopStock(live);
  const expected = captureShopStock(live);
  sellToShop(live, 'club_bar', 'speed_fizz');
  sellToShop(live, 'general_store', 'jugg_juice');
  tickShopStock(live);
  check(
    snapshotsEqual(snapshot, expected),
    'mutating the live record after capture changed the snapshot',
  );

  restoreShopStock(live, snapshot);
  check(
    snapshotsEqual(captureShopStock(live), expected),
    'restore did not bring back the captured stock',
  );

  sellToShop(live, 'club_bar', 'speed_fizz');
  tickShopStock(live);
  check(
    snapshotsEqual(snapshot, expected),
    'mutating the record after restore changed the snapshot',
  );

  restoreShopStock(live, snapshot);
  check(
    snapshotsEqual(captureShopStock(live), expected),
    'restoring the same snapshot a second time did not bring back the captured stock',
  );

  const reloaded = parseShopStockSnapshot(JSON.parse(JSON.stringify(snapshot)));
  check(
    reloaded !== undefined && snapshotsEqual(reloaded, expected),
    'a snapshot did not survive a JSON save and load',
  );
}
endSection();

if (checksFailed > 0) {
  console.log(`\nFAIL ${checksFailed} of ${checksRun} checks`);
  process.exitCode = 1;
} else {
  console.log(`\n${checksRun} checks passed`);
}
