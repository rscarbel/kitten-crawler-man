/**
 * Facade-space texture: the passes that stop a wall reading as computed.
 *
 * The rule these all exist to serve is that **features must cross element
 * boundaries**. A stain that stops at a stone's edge, a tonal sweep that
 * respects a plank, moss that fills exactly one course — each of those tells the
 * viewer that the wall was assembled by a loop rather than weathered by rain.
 * So every helper here works over a whole plane in the plane's own coordinates,
 * after the material has laid out its elements and with no knowledge of where
 * they were.
 *
 * Amplitudes are bounded on purpose. These passes sit on top of a material that
 * already varies per element, and run hard enough to be read as layers in their
 * own right they stop being weather and start being noise: a facade tuned up
 * until it satisfied a contrast measurement came out as a cellular net with the
 * courses dissolved inside it. The number to trust is the picture.
 */

import { NoiseField } from '../tilegen/noise.js';
import type { Plane } from './projection.js';
import {
  isOpaque,
  multiplyPixel,
  offsetPixel,
  pixelIndex,
  readPixels,
  tintPixel,
  writePixels,
} from './pixels.js';
import type { RGB } from './ramps.js';

/**
 * `NoiseField` wraps on a torus at its construction size. A facade never tiles
 * against itself, so the wrap is harmless — but the field is built at the
 * plane's longest side so the wrap period is never *shorter* than the plane,
 * which would repeat a stain visibly across a wide wall.
 */
export function planeNoise(plane: Plane): NoiseField {
  return new NoiseField(Math.max(plane.width, plane.height));
}

export interface GrainOptions {
  readonly seed: number;
  /** Peak fractional change in value, e.g. 0.06 for ±6%. */
  readonly amplitude: number;
  /** Lattice cells across the noise field's wrap size. Higher is finer. */
  readonly period: number;
  readonly octaves: number;
  /**
   * How far the sampling coordinates are squashed along each axis before the
   * field is read, which stretches the grain's features along the other one.
   *
   * Isotropic grain at the strength a painterly surface needs reads as film
   * noise; the same amount of variation stretched along the material's own
   * direction — down a thatch strand, along a trowel stroke, down a wall the
   * rain runs off — reads as brushwork instead. Both default to 1.
   */
  readonly stretchX?: number;
  readonly stretchY?: number;
  /**
   * Peak change in absolute luminance, applied alongside the multiply.
   *
   * A multiply alone cannot texture a dark material: ±30% of a stained-timber
   * wall whose mid value is 40 is ±12, and the wall stays a flat near-black
   * smudge at the display tile while a cream plaster wall beside it reads as
   * richly worked. The additive term is the pigment in the brush rather than the
   * light on the surface, and it is what gives every material the same amount of
   * *visible* variation whatever value it is painted at.
   */
  readonly additive?: number;
}

/**
 * Per-pixel value grain over the whole plane.
 *
 * Runs as a multiply so it modulates whatever the material laid down rather than
 * washing it toward a single colour, which is what an alpha-blended noise
 * overlay would do.
 */
export function applyGrain(plane: Plane, noise: NoiseField, options: GrainOptions): void {
  const buffer = readPixels(plane.ctx, plane.width, plane.height);
  const HALF = 0.5;
  for (let y = 0; y < plane.height; y++) {
    for (let x = 0; x < plane.width; x++) {
      const index = pixelIndex(buffer, x, y);
      if (!isOpaque(buffer, index)) continue;
      const value = noise.fbm(
        x * (options.stretchX ?? 1),
        y * (options.stretchY ?? 1),
        options.seed,
        options.octaves,
        options.period,
      );
      const signed = (value - HALF) * 2;
      multiplyPixel(buffer, index, 1 + signed * options.amplitude);
      const additive = options.additive ?? 0;
      if (additive !== 0) offsetPixel(buffer, index, signed * additive);
    }
  }
  writePixels(plane.ctx, buffer);
}

export interface TonalWashOptions {
  readonly seed: number;
  /** Peak fractional change in value across the whole plane. */
  readonly amplitude: number;
  /** Cells across the plane — low, so the sweep is broad rather than blotchy. */
  readonly period: number;
  /** How far the noise coordinates are dragged before sampling, in pixels. */
  readonly warp: number;
}

/**
 * Broad light-to-dark drift across the wall, the layer that reads as "this wall
 * has been rained on for forty years".
 *
 * Domain-warped so the drift's own boundaries are not smooth ellipses; smooth
 * ellipses at low frequency are the single most recognisable signature of
 * procedural art.
 */
export function applyTonalWash(plane: Plane, noise: NoiseField, options: TonalWashOptions): void {
  const buffer = readPixels(plane.ctx, plane.width, plane.height);
  const WARP_PERIOD = 3;
  const WASH_OCTAVES = 2;
  const HALF = 0.5;
  for (let y = 0; y < plane.height; y++) {
    for (let x = 0; x < plane.width; x++) {
      const index = pixelIndex(buffer, x, y);
      if (!isOpaque(buffer, index)) continue;
      const warped = noise.warp(x, y, options.seed, options.warp, WARP_PERIOD);
      const value = noise.fbm(warped.x, warped.y, options.seed, WASH_OCTAVES, options.period);
      multiplyPixel(buffer, index, 1 + (value - HALF) * 2 * options.amplitude);
    }
  }
  writePixels(plane.ctx, buffer);
}

export interface StreakOptions {
  readonly seed: number;
  /** Darkening at a streak's core, 0..1. */
  readonly strength: number;
  /** Streaks per plane width. */
  readonly density: number;
  /** How far a streak runs downhill before it fades out, in pixels. */
  readonly length: number;
  /** Where streaks start, as a fraction of plane height. */
  readonly originY: number;
}

/**
 * Grime running downhill: under sills, off the eaves, out of every joint that
 * ever held water.
 *
 * Each streak wanders horizontally as it descends rather than falling plumb —
 * a column of darker pixels at a fixed x is a scratch, not a stain — and fades
 * out over its length so nothing ends in a hard stop.
 */
export function applyStreaks(plane: Plane, noise: NoiseField, options: StreakOptions): void {
  const buffer = readPixels(plane.ctx, plane.width, plane.height);
  const streakCount = Math.max(1, Math.round(options.density * plane.width));
  const WANDER_PERIOD = 6;
  const WANDER_PIXELS = 2.5;
  const STREAK_HALF_WIDTH = 1.6;
  const SEED_STRIDE = 977;

  for (let streak = 0; streak < streakCount; streak++) {
    const streakSeed = options.seed + streak * SEED_STRIDE;
    const originX = noise.value(streak * WANDER_PERIOD, 0, plane.width, streakSeed) * plane.width;
    const startY = options.originY * plane.height;
    const length = options.length * (0.5 + noise.value(0, streak * WANDER_PERIOD, 8, streakSeed));
    for (let step = 0; step < length; step++) {
      const y = Math.round(startY + step);
      if (y < 0 || y >= plane.height) continue;
      const wander = (noise.value(originX, y, WANDER_PERIOD, streakSeed) - 0.5) * 2 * WANDER_PIXELS;
      const fade = 1 - step / length;
      const core = options.strength * fade * fade;
      for (let offset = -STREAK_HALF_WIDTH; offset <= STREAK_HALF_WIDTH; offset += 1) {
        const x = Math.round(originX + wander + offset);
        if (x < 0 || x >= plane.width) continue;
        const falloff = 1 - Math.abs(offset) / (STREAK_HALF_WIDTH + 1);
        const index = pixelIndex(buffer, x, y);
        if (!isOpaque(buffer, index)) continue;
        multiplyPixel(buffer, index, 1 - core * falloff);
      }
    }
  }
  writePixels(plane.ctx, buffer);
}

export interface MossOptions {
  readonly seed: number;
  readonly color: RGB;
  /** Peak tint toward `color`, 0..1. */
  readonly strength: number;
  /** Fraction of the plane's height, measured from the bottom, moss may reach. */
  readonly reach: number;
  /** Cells across the plane. Low values grow one big mat; high values speckle. */
  readonly period: number;
}

/**
 * Moss and algae, densest at ground contact and thinning upward.
 *
 * Painted as a tint rather than a fill so the stone's own value variation still
 * shows through the growth — moss on a wall is a stain in the surface, not a
 * layer on top of it.
 */
export function applyMoss(plane: Plane, noise: NoiseField, options: MossOptions): void {
  const buffer = readPixels(plane.ctx, plane.width, plane.height);
  const MOSS_OCTAVES = 3;
  const MOSS_THRESHOLD = 0.5;
  const reachPx = Math.max(1, options.reach * plane.height);
  for (let y = 0; y < plane.height; y++) {
    const heightAboveBase = plane.height - y;
    if (heightAboveBase > reachPx) continue;
    const verticalFade = 1 - heightAboveBase / reachPx;
    for (let x = 0; x < plane.width; x++) {
      const index = pixelIndex(buffer, x, y);
      if (!isOpaque(buffer, index)) continue;
      const value = noise.fbm(x, y, options.seed, MOSS_OCTAVES, options.period);
      if (value < MOSS_THRESHOLD) continue;
      const density = (value - MOSS_THRESHOLD) / (1 - MOSS_THRESHOLD);
      tintPixel(buffer, index, options.color, options.strength * density * verticalFade);
    }
  }
  writePixels(plane.ctx, buffer);
}

/**
 * Wandering offset for anything that must not be ruler-straight: a mortar
 * course, a plank gap, the edge of a thatch bundle.
 *
 * Materials call this rather than adding their own random jitter per element,
 * because per-element jitter makes a joint that steps and a shared field makes
 * one that wanders — and only the second reads as hand-laid.
 */
export function jointWander(
  noise: NoiseField,
  x: number,
  y: number,
  seed: number,
  amplitude: number,
  period: number,
): number {
  return (noise.value(x, y, period, seed) - 0.5) * 2 * amplitude;
}
