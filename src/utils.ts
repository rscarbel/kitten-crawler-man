import { TILE_SIZE } from './core/constants';

/** Tile center offset as a fraction of tile size. */
const TILE_CENTER_OFFSET = 0.5;

/** Milliseconds per second. */
const MS_PER_SECOND = 1000;

/** Return a random integer in the inclusive range [min, max]. */
export const randomInt = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1));

/** Pick a uniformly random element from a non-empty array. */
export const randomFromArray = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const GOLDEN_RATIO_RADICAND = 5;
const GOLDEN_RATIO_CONJUGATE = (Math.sqrt(GOLDEN_RATIO_RADICAND) - 1) / 2;
/**
 * The golden angle: a full turn times φ⁻¹.
 *
 * Stepping a phase by this is how you spread N repeats of the same animation
 * without any two of them landing together, for every N. A round-looking stride
 * does not do that — 0.7 rad puts the 1st and 10th of a series within 0.3% of a
 * period of each other, close enough that the two render identically.
 */
export const GOLDEN_ANGLE_RAD = Math.PI * 2 * GOLDEN_RATIO_CONJUGATE;

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
export const pixelToTile = (px: number) =>
  Math.floor((px + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);

/** Convert a tile index to the pixel coordinate of its left/top edge. */
export const tileToPixel = (tx: number) => tx * TILE_SIZE;

/**
 * Shared frame timestamp (seconds). Call `updateFrameTime()` once per frame
 * at the start of the render loop; read `frameTime` anywhere to avoid
 * redundant `performance.now()` calls in hot paths.
 */
export let frameTime = performance.now() / MS_PER_SECOND;
export function updateFrameTime(): void {
  frameTime = performance.now() / MS_PER_SECOND;
}
