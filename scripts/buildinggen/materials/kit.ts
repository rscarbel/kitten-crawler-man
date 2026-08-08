/**
 * What every material is handed, and the common law they all obey.
 *
 * A material paints into a **flat plane** in that plane's own coordinates: y
 * grows downhill, x grows left to right, and nothing in a material knows that
 * its plane will be sheared onto a quad afterwards. That is what lets one thatch
 * routine serve the front slope and the hip end, and one stone routine serve the
 * front wall and the side return.
 *
 * ## The rules, restated where they will be read
 *
 * 1. **Never one flat colour.** Sample the ramp continuously. Every element gets
 *    its own value from the seeded noise; every pixel gets a little more from a
 *    finer octave.
 * 2. **The material does not light itself.** No plane shade, no eaves shadow, no
 *    silhouette ink — `paint.ts` applies those in an order the material cannot
 *    see. A material may light *its own relief*: the lit top edge of a course,
 *    the shadow a beam drops on the plaster behind it.
 * 3. **Joints are a budget.** Mortar and plank gaps at reduced contrast, and
 *    wandering — a ruler-straight joint is the loudest tell in procedural art.
 * 4. **Nothing repeats on the tile grid.** Course heights, block widths and bond
 *    offsets are derived from the plane's size and the seed, never from
 *    `scale`. A feature whose period divides 48 px paints a visible grid at
 *    in-game scale even though every individual element is varied.
 */

import { hashLattice } from '../../tilegen/noise.js';
import type { NoiseField } from '../../tilegen/noise.js';
import type { Plane } from '../projection.js';
import type { RoofSpec, WallSpec } from '../spec.js';

/** Plane-space vertical range a pass is confined to. */
export interface Band {
  readonly top: number;
  readonly bottom: number;
}

export interface WallPaintOptions {
  readonly plane: Plane;
  readonly noise: NoiseField;
  readonly seed: number;
  /** Pixels per tile at bake scale, for measures that are genuinely architectural. */
  readonly scale: number;
  readonly wall: WallSpec;
  /** The story this call paints. A two-story facade calls once per story. */
  readonly band: Band;
  readonly quoins: boolean;
  /** Height of the taller, darker base course. Zero for an upper story. */
  readonly foundationPx: number;
}

export interface RoofPaintOptions {
  readonly plane: Plane;
  readonly noise: NoiseField;
  readonly seed: number;
  readonly scale: number;
  readonly roof: RoofSpec;
  /**
   * True for the hip end over the side return. It carries the same material at
   * the same course pitch but gets no ridge cap of its own — the ridge cap is
   * one object and belongs to the front slope, which draws over this plane.
   */
  readonly isReturn: boolean;
}

/**
 * Per-element value jitter, in ramp-`t` units.
 *
 * Applied to every stone, plank, tile and thatch bundle. Tuned against the
 * measured local contrast of the art this kit replaces rather than by eye: the
 * painterly originals carry far more value variation inside an eight-pixel
 * window than a first pass at "subtle" jitter produces, and a facade that is
 * subtle at bake scale is flat at the 32px display tile.
 */
export const ELEMENT_TONE_JITTER = 0.26;

/** Per-element hue rotation, in degrees. Enough to break a monotone, not to read as colour. */
export const ELEMENT_HUE_JITTER = 3;

/** Contrast of a joint against the elements it separates. Never 1. */
export const JOINT_STRENGTH = 0.38;

/** How far a joint wanders off true, in pixels, and over what period. */
export const JOINT_WANDER_PX = 1.1;
export const JOINT_WANDER_PERIOD = 14;

/** Lit top edge and shadowed bottom edge of an element, in pixels. */
export const ELEMENT_EDGE_PX = 1;
export const ELEMENT_TOP_LIGHT = 0.34;
export const ELEMENT_BOTTOM_SHADOW = 0.36;

/**
 * A deterministic value in [0, 1) for element `index` in stream `stream`.
 *
 * Materials index their elements rather than pulling from a sequential RNG, so
 * adding a course at the top of a wall does not reshuffle every stone below it —
 * which would make every tuning pass a full re-review of art that was already
 * approved.
 */
export function elementValue(seed: number, stream: number, index: number): number {
  const STREAM_STRIDE = 8191;
  return hashLattice(index, stream, seed + stream * STREAM_STRIDE);
}
