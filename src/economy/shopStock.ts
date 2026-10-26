/**
 * The one stock record every shop reads and writes.
 *
 * Every (shop, item) pair has a current stock. For a catalog line it starts at
 * the line's `normalStock`; for an `'unlimited'` line or an item the shop does
 * not list, normal is 0. A purchase takes units off, a sale puts one on, and
 * every `RESTOCK_INTERVAL_SECONDS` of game time every line away from normal
 * moves back toward it, in both directions.
 *
 * The record stores each line's offset from normal rather than its absolute
 * count, so a rebalanced `normalStock` takes effect on an existing save
 * without surprises, and "absent or 0" means "at normal".
 *
 * Like the questline progress objects, a `ShopStock` is a plain mutable object
 * threaded by reference through the scenes that hold it, so leaving a
 * building and coming back never restocks a shelf, and it is captured and
 * restored on checkpoints with {@link captureShopStock} / {@link restoreShopStock}.
 */

import { isRecord } from '../core/util/guards';
import { isItemId, type ItemId } from '../core/items/defs/ItemDefs';
import { isShopId, primaryCatalogLine, type ShopId } from './shops';

/**
 * Units each shop holds away from normal, plus the game-time clock that
 * drives restocking. An object rather than a bare record so the clock travels
 * with the stock it restocks: a scene that holds the record ticks it, and a
 * checkpoint captures both together.
 */
export interface ShopStock {
  /** Keyed `${shopId}:${itemId}`. Negative = bought down, positive = sold in, absent or 0 = at normal. */
  offsets: Record<string, number>;
  /** World updates since the last restock step. */
  ticksSinceRestock: number;
}

/** A point-in-time copy of a {@link ShopStock}, for a checkpoint. */
export interface ShopStockSnapshot {
  readonly offsets: Readonly<Record<string, number>>;
  readonly ticksSinceRestock: number;
}

/** Seconds of game time between restock steps. */
export const RESTOCK_INTERVAL_SECONDS = 10;
/** How far a line moves back toward normal per restock step, as a fraction of its normal stock. */
export const RESTOCK_FRACTION_PER_INTERVAL = 0.01;
/** A line away from normal always moves by at least this, so an unlimited line (normal 0) still drains. */
const MIN_RESTOCK_UNITS = 1;
/** Scenes run `update()` on a fixed 60-per-second timestep (`Scene`'s `FRAME_RATE`). */
const WORLD_TICKS_PER_SECOND = 60;
/** World updates in one restock step. */
export const RESTOCK_INTERVAL_TICKS = RESTOCK_INTERVAL_SECONDS * WORLD_TICKS_PER_SECOND;

const KEY_SEPARATOR = ':';
/** Absorbs float error in a product like 0.01 × 700 = 7.000000000000001, which would otherwise round up a whole unit. */
const FLOAT_TOLERANCE = 1e-9;

/** Every shop at normal stock. */
export function createShopStock(): ShopStock {
  return { offsets: {}, ticksSinceRestock: 0 };
}

export function shopStockKey(shop: ShopId, item: ItemId): string {
  return `${shop}${KEY_SEPARATOR}${item}`;
}

/** A line's normal stock, or 'unlimited' for an unlimited line or an item the shop does not list. */
export function normalStockOf(shop: ShopId, item: ItemId): number | 'unlimited' {
  return primaryCatalogLine(shop, item)?.normalStock ?? 'unlimited';
}

/** The count stock is measured against: a limited line's normal stock, 0 for everything else. */
function normalCount(normal: number | 'unlimited'): number {
  return normal === 'unlimited' ? 0 : normal;
}

/** Whether the line can run out, which is also whether it can get scarce. */
export function isLimitedLine(shop: ShopId, item: ItemId): boolean {
  return normalStockOf(shop, item) !== 'unlimited';
}

export function stockOffset(stock: ShopStock, shop: ShopId, item: ItemId): number {
  return stock.offsets[shopStockKey(shop, item)] ?? 0;
}

/** Units the shop holds right now: normal plus the offset. Never negative. */
export function currentStock(stock: ShopStock, shop: ShopId, item: ItemId): number {
  return normalCount(normalStockOf(shop, item)) + stockOffset(stock, shop, item);
}

/** Whether a purchase of `units` would find the shelf short. Only a limited line can sell out. */
export function isSoldOut(stock: ShopStock, shop: ShopId, item: ItemId, units = 1): boolean {
  return isLimitedLine(shop, item) && currentStock(stock, shop, item) < units;
}

/**
 * Takes `units` off the shelf for a purchase. Refuses (returning false, the
 * record untouched) when a limited line is short. An unlimited line never
 * refuses; it only works off units the player sold in, never going below
 * normal, because an unlimited line has no scarcity to fall into.
 */
export function buyFromShop(stock: ShopStock, shop: ShopId, item: ItemId, units = 1): boolean {
  if (isSoldOut(stock, shop, item, units)) return false;
  const key = shopStockKey(shop, item);
  const offset = stock.offsets[key] ?? 0;
  stock.offsets[key] = isLimitedLine(shop, item) ? offset - units : Math.max(0, offset - units);
  return true;
}

/** Puts one unit the player sold on the shelf. A shop never refuses on stock grounds; it just pays less. */
export function sellToShop(stock: ShopStock, shop: ShopId, item: ItemId): void {
  const key = shopStockKey(shop, item);
  stock.offsets[key] = (stock.offsets[key] ?? 0) + 1;
}

/** Units a line moves back toward normal per restock step. */
export function restockStep(normal: number | 'unlimited'): number {
  return Math.max(
    MIN_RESTOCK_UNITS,
    Math.ceil(RESTOCK_FRACTION_PER_INTERVAL * normalCount(normal) - FLOAT_TOLERANCE),
  );
}

/**
 * The normal stock a stored key restocks toward. A key whose shop or item no
 * longer exists (a save from before a catalog edit) is treated as an
 * unlisted item, so it simply drains to 0.
 */
function normalForKey(key: string): number | 'unlimited' {
  const separatorAt = key.indexOf(KEY_SEPARATOR);
  if (separatorAt < 0) return 'unlimited';
  const shop = key.slice(0, separatorAt);
  const item = key.slice(separatorAt + KEY_SEPARATOR.length);
  if (!isShopId(shop) || !isItemId(item)) return 'unlimited';
  return normalStockOf(shop, item);
}

/** Moves every line one restock step toward normal, never past it. */
function restockAll(stock: ShopStock): void {
  for (const [key, offset] of Object.entries(stock.offsets)) {
    if (offset === 0) continue;
    const step = Math.min(restockStep(normalForKey(key)), Math.abs(offset));
    stock.offsets[key] = offset - Math.sign(offset) * step;
  }
}

/**
 * Advances the restock clock by one world update. Call it once per `update()`
 * from whichever scene holds the record, and not while the world is halted,
 * so restocking runs on game time like every other clock. Every shop restocks
 * on the same clock whether or not the player is in its scene.
 */
export function tickShopStock(stock: ShopStock): void {
  stock.ticksSinceRestock++;
  if (stock.ticksSinceRestock < RESTOCK_INTERVAL_TICKS) return;
  stock.ticksSinceRestock -= RESTOCK_INTERVAL_TICKS;
  restockAll(stock);
}

/** An independent copy, for quoting a run of sales without touching the real shelf. */
export function cloneShopStock(stock: ShopStock): ShopStock {
  return { offsets: { ...stock.offsets }, ticksSinceRestock: stock.ticksSinceRestock };
}

/**
 * Snapshots stock so a death rewinds what was bought and sold. The coins come
 * back with the player snapshot, so a shelf left bought down would burn a
 * limited line for nothing, and one left restored past what was paid for
 * would hand the goods out twice.
 */
export function captureShopStock(stock: ShopStock): ShopStockSnapshot {
  return { offsets: { ...stock.offsets }, ticksSinceRestock: stock.ticksSinceRestock };
}

/**
 * Mutates in place: the record is threaded by reference through every scene,
 * so rebinding a fresh one would strand every holder. The offsets are copied
 * again because one snapshot is restored once per death; assigning the stored
 * record across would let the next purchase mutate the snapshot itself.
 */
export function restoreShopStock(stock: ShopStock, snapshot: ShopStockSnapshot): void {
  stock.offsets = { ...snapshot.offsets };
  stock.ticksSinceRestock = snapshot.ticksSinceRestock;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Reads a saved {@link ShopStockSnapshot} back from untrusted JSON. Anything
 * missing or malformed reads as normal stock: an offset that is not a whole
 * finite number is dropped, and a bad clock starts from 0.
 */
export function parseShopStockSnapshot(value: unknown): ShopStockSnapshot {
  if (!isRecord(value)) return captureShopStock(createShopStock());
  const offsets: Record<string, number> = {};
  if (isRecord(value.offsets)) {
    for (const [key, offset] of Object.entries(value.offsets)) {
      if (isFiniteNumber(offset) && Number.isInteger(offset)) offsets[key] = offset;
    }
  }
  const clock = value.ticksSinceRestock;
  const ticksSinceRestock = isFiniteNumber(clock) && clock >= 0 ? clock : 0;
  return { offsets, ticksSinceRestock };
}
