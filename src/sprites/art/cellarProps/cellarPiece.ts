/**
 * What every cellar piece's painter provides, so the sheet plan can lay any of
 * them out the same way.
 */

import type { Ctx, ShatterSpec } from './cellarPaint';

/** Where a piece is painted: the top-left corner of its anchor tile, and the tile size. */
export interface PieceOrigin {
  readonly ox: number;
  readonly oy: number;
  readonly ts: number;
}

/** A piece that only ever stands: one pose per variant. */
export interface CellarFixedPainter {
  /** Tiles across the piece covers, its anchor the left-most. */
  readonly tilesWide: number;
  /** Seeded variants of the one silhouette; the sheet holds one frame per variant. */
  readonly variants: number;
  paint(ctx: Ctx, at: PieceOrigin, variant: number): void;
}

/** A piece a crawler can break: whole, cracked, bursting, and what it leaves. */
export interface CellarPiecePainter {
  readonly tilesWide: number;
  readonly variants: number;
  /** The piece standing, whole or (when `damaged`) cracked. */
  paint(ctx: Ctx, at: PieceOrigin, variant: number, damaged: boolean): void;
  /** What is left on the floor once it is broken. Walkable, flat, and low in contrast. */
  paintRemains(ctx: Ctx, at: PieceOrigin, variant: number): void;
  /** What flies off it as it breaks. */
  readonly shatter: ShatterSpec;
  /** Where the break bursts from, as a fraction of a tile down from the anchor's top edge. */
  readonly burstHeightTiles: number;
}
