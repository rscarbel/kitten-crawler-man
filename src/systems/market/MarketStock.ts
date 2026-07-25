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
