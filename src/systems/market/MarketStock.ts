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

/** Remaining units per vendor line, keyed `${vendorId}:${itemId}`. Absent ⇒ never bought / unlimited. */
export interface MarketStock {
  remaining: Map<string, number>;
}

export function createMarketStock(): MarketStock {
  return { remaining: new Map() };
}

/** A point-in-time copy of every vendor line's remaining units. */
export interface MarketStockCheckpoint {
  remaining: Map<string, number>;
}

/**
 * Snapshots stock so a death rewinds what the market sold. The coins spent come
 * back with the player snapshot, so a stall left sold-out would burn the limited
 * line for nothing — and one left restocked past what was actually paid for
 * would hand out the goods twice.
 */
export function captureMarketStock(stock: MarketStock): MarketStockCheckpoint {
  return { remaining: new Map(stock.remaining) };
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
