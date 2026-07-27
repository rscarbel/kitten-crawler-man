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

/**
 * `value mod modulus`, always non-negative.
 *
 * JavaScript's `%` keeps the sign of the dividend, which flips pattern parity
 * exactly at zero — so anything indexing a repeating lattice by a coordinate
 * that can go negative (tile phases inside a ground patch, masonry courses)
 * needs this rather than the operator.
 */
export function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

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

export type CardinalDirection =
  'North' | 'North East' | 'East' | 'South East' | 'South' | 'South West' | 'West' | 'North West';

/**
 * The eight sectors in the order `Math.atan2(dy, dx)` visits them, starting at
 * due east and turning the way screen coordinates turn.
 *
 * **The project's convention is `-y = north`** — the same one the dungeon
 * generator's entrance-wall test uses — so a negative `dy` lands in the northern
 * half of this list rather than the southern one.
 */
const DIRECTIONS_BY_SECTOR: ReadonlyArray<CardinalDirection> = [
  'East',
  'South East',
  'South',
  'South West',
  'West',
  'North West',
  'North',
  'North East',
];

const SECTOR_ARC_RAD = (Math.PI * 2) / DIRECTIONS_BY_SECTOR.length;

/**
 * The eight-way bearing from one point to another, both in the same coordinate
 * space (tiles or pixels — only the difference matters).
 *
 * Two identical points have no bearing; `atan2(0, 0)` is 0, so they read as
 * `'East'`. Callers that can produce a degenerate pair should test for it rather
 * than relying on that.
 */
export function cardinalDirection(
  from: { x: number; y: number },
  to: { x: number; y: number },
): CardinalDirection {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const sector = positiveMod(Math.round(angle / SECTOR_ARC_RAD), DIRECTIONS_BY_SECTOR.length);
  return DIRECTIONS_BY_SECTOR[sector];
}

/**
 * Shared frame timestamp (seconds). Call `updateFrameTime()` once per frame
 * at the start of the render loop; read `frameTime` anywhere to avoid
 * redundant `performance.now()` calls in hot paths.
 */
export let frameTime = performance.now() / MS_PER_SECOND;
export function updateFrameTime(): void {
  frameTime = performance.now() / MS_PER_SECOND;
}
