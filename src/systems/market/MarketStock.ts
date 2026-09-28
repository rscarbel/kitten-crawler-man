/**
 * Cross-scene stock state for the market stalls.
 *
 * Like `ClubMembership` and the questline progress objects, this is a plain
 * mutable object threaded by reference through the `DungeonScene` ↔
 * `BuildingInteriorScene` constructors. The overworld scene is rebuilt on every
 * building round-trip, so without threading it a player could restock a limited
 * line just by stepping into the inn and back out.
 */

import type { ItemId } from '../../core/ItemDefs';
import type { VendorStockLine } from './vendorDefs';

/** How much of a shop's held stock a seller currently carries, keyed `${vendorId}:${itemId}`. */
export type HeldStock = Record<string, number>;

/**
 * Remaining units per vendor line, keyed `${vendorId}:${itemId}`. Absent ⇒
 * never bought / unlimited.
 *
 * `held` is the companion counter a shop's sell price reads: units the shop
 * currently holds *because the player sold it some*, on top of whatever it
 * always stocks. It only ever moves by a sale (up) or a buyback (down) or the
 * slow decay in `decayHeldStock` — it has nothing to do with `remaining`,
 * which counts down a scarce line toward zero and never recovers. It's a
 * plain record, not a `Map`, so any counter's own state object (Briar
 * Hollow's `BriarHollowState`, which keeps its own stock the same way) can
 * hold one of these and feed it to the same functions below without needing
 * a whole `MarketStock` of its own.
 */
export interface MarketStock {
  remaining: Map<string, number>;
  held: HeldStock;
}

export function createMarketStock(): MarketStock {
  return { remaining: new Map(), held: {} };
}

/** A point-in-time copy of every vendor line's remaining units and held stock. */
export interface MarketStockCheckpoint {
  remaining: Map<string, number>;
  held: HeldStock;
}

/**
 * Snapshots stock so a death rewinds what the market sold. The coins spent come
 * back with the player snapshot, so a stall left sold-out would burn the limited
 * line for nothing — and one left restocked past what was actually paid for
 * would hand out the goods twice.
 */
export function captureMarketStock(stock: MarketStock): MarketStockCheckpoint {
  return { remaining: new Map(stock.remaining), held: { ...stock.held } };
}

/**
 * Mutates in place: this object is threaded by reference through every scene, so
 * rebinding a fresh one would strand every holder.
 *
 * The map is copied again here because one snapshot is restored once per death —
 * assigning the stored map straight across would let the next purchase mutate
 * the snapshot itself.
 */
export function restoreMarketStock(stock: MarketStock, snapshot: MarketStockCheckpoint): void {
  stock.remaining = new Map(snapshot.remaining);
  stock.held = { ...snapshot.held };
}

export function stockKey(vendorId: string, itemId: ItemId): string {
  return `${vendorId}:${itemId}`;
}

/** Units left for a line, or `null` when the line is unlimited. */
export function remainingFor(
  stock: MarketStock,
  vendorId: string,
  line: VendorStockLine,
): number | null {
  const limit = line.stock;
  if (limit === undefined) return null;
  return stock.remaining.get(stockKey(vendorId, line.id)) ?? limit;
}

/** Books one unit off a limited line. A no-op for unlimited lines and for sold-out ones. */
export function consumeStock(stock: MarketStock, vendorId: string, line: VendorStockLine): void {
  const left = remainingFor(stock, vendorId, line);
  if (left === null || left <= 0) return;
  stock.remaining.set(stockKey(vendorId, line.id), left - 1);
}

/**
 * Units of `itemId` a shop currently holds because the player sold it some, on
 * top of whatever it always carries. Takes the bare `held` record rather than
 * a whole `MarketStock`, so a counter with its own stock state (Briar
 * Hollow's shops) can pass its own record straight in.
 */
export function heldFor(held: HeldStock, vendorId: string, itemId: ItemId): number {
  return held[stockKey(vendorId, itemId)] ?? 0;
}

/** One more unit lands on the shop's shelf — a player sale. Drives the item's price down. */
export function addHeldStock(held: HeldStock, vendorId: string, itemId: ItemId): void {
  const key = stockKey(vendorId, itemId);
  held[key] = (held[key] ?? 0) + 1;
}

/**
 * One unit leaves the shelf — the player buying a previously-sold unit back.
 * Never goes negative. Left at `0` rather than removed once it hits the
 * floor — a dynamically-keyed delete on a plain record is the one thing this
 * file avoids, and a stray `0` entry costs nothing: every reader already
 * treats "absent" and "0" the same way.
 */
export function removeHeldStock(held: HeldStock, vendorId: string, itemId: ItemId): void {
  const key = stockKey(vendorId, itemId);
  held[key] = Math.max(0, (held[key] ?? 0) - 1);
}

/**
 * Walks every held line down toward zero — a shop works off what the player
 * dumped on it over time rather than carrying the depressed price forever.
 * Chosen over real-time decay (the way `remaining` never recovers) because the
 * held counter should visibly climb back while a player keeps shopping there,
 * and simulating offline elapsed time would need a wall-clock timestamp
 * nothing else here carries. Called once per counter's own update tick, so it
 * only progresses while that counter's screen is actually the active scene.
 */
export function decayHeldStock(held: HeldStock, unitsPerTick: number): void {
  if (unitsPerTick <= 0) return;
  for (const key of Object.keys(held)) {
    held[key] = Math.max(0, held[key] - unitsPerTick);
  }
}
