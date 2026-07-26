/**
 * Packing conventions for tile coordinates. Written once here so every grid
 * array and every numeric tile set in the game agrees on the layout.
 */

/**
 * Row-major index of a tile inside an array covering a `gridWidth`-wide grid.
 * The caller is responsible for bounds — this is the innermost step of the
 * walkability hot path and deliberately does no checking.
 */
export function tileIndex(tileX: number, tileY: number, gridWidth: number): number {
  return tileY * gridWidth + tileX;
}

/**
 * Row stride for `tileCoordKey`. Larger than any map dimension the game
 * generates, so a key stays valid even after the grid it came from is resized.
 */
export const TILE_KEY_STRIDE = 4096;

/**
 * Packs a tile coordinate into a single number that does not depend on any
 * grid's width. Use for sets that must outlive a grid — a `GameMap` replaces
 * its structure when it generates a building interior — and use `tileIndex`
 * for anything indexing a fixed-size array.
 */
export function tileCoordKey(tileX: number, tileY: number): number {
  return tileY * TILE_KEY_STRIDE + tileX;
}

/** X coordinate packed into a `tileCoordKey`. */
export function tileKeyX(key: number): number {
  return key % TILE_KEY_STRIDE;
}

/** Y coordinate packed into a `tileCoordKey`. */
export function tileKeyY(key: number): number {
  return Math.floor(key / TILE_KEY_STRIDE);
}
