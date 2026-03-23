import { TILE_SIZE } from './core/constants';

/** Return a random integer in the inclusive range [min, max]. */
export const randomInt = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1));

/** Pick a uniformly random element from a non-empty array. */
export const randomFromArray = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Clamp `v` to the range [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Return true if the point (x, y) lies inside the rectangle (inclusive edges). */
export const pointInRect = (
  x: number,
  y: number,
  r: { x: number; y: number; w: number; h: number },
) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Return the unit vector for (dx, dy). Returns (0, 0) if the input is zero-length. */
export const normalize = (dx: number, dy: number) => {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
};

/** Convert a pixel coordinate to a tile index (using the tile center). */
export const pixelToTile = (px: number) => Math.floor((px + TILE_SIZE * 0.5) / TILE_SIZE);

/** Convert a tile index to the pixel coordinate of its left/top edge. */
export const tileToPixel = (tx: number) => tx * TILE_SIZE;
