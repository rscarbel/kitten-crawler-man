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

import { NoiseField } from '../../map/tilegen/noise';
import { elementValue } from './materials/kit';
import type { Plane } from './projection';
import { isOpaque, multiplyPixel, pixelIndex, readPixels, writePixels } from './pixels';
import { rgba, type RGB } from './ramps';

/**
 * `NoiseField` wraps on a torus at its construction size. A facade never tiles
 * against itself, so the wrap is harmless — but the field is built at the
 * plane's longest side so the wrap period is never *shorter* than the plane,
 * which would repeat a stain visibly across a wide wall.
 */
export function planeNoise(plane: Plane): NoiseField {
  return new NoiseField(Math.max(plane.width, plane.height));
}

/**
 * A single irregular blob outline, shared by every patch-shaped weathering
 * pass below: an N-gon whose vertices wander off a circle, keyed on the
 * patch's own index so two properties of one patch never share a number.
 */
function tracePatchBlob(
  ctx: Plane['ctx'],
  seed: number,
  vertexStream: number,
  patchIndex: number,
  centreX: number,
  centreY: number,
  radius: number,
): void {
  const VERTICES = 7;
  const VERTEX_RADIUS_JITTER = 0.35;
  const VERTEX_KEY_STRIDE = 11;
  ctx.beginPath();
  for (let vertex = 0; vertex < VERTICES; vertex++) {
    const angle = (vertex / VERTICES) * Math.PI * 2;
    const key = patchIndex * VERTEX_KEY_STRIDE + vertex;
    const stretch = 1 + (elementValue(seed, vertexStream, key) - 0.5) * 2 * VERTEX_RADIUS_JITTER;
    const x = centreX + Math.cos(angle) * radius * stretch;
    const y = centreY + Math.sin(angle) * radius * stretch;
    if (vertex === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export interface WeatherPatchOptions {
  readonly seed: number;
  /** Pixels per tile, so a patch is sized architecturally rather than per-pixel. */
  readonly scale: number;
  /** Peak alpha a patch is stained at, 0..1. */
  readonly amplitude: number;
}

/** Roughly one patch per this many tiles of plane area — few and broad, not a field. */
const WEATHER_PATCH_AREA_PER_TILE = 2.6;
const WEATHER_PATCH_RADIUS_TILES = 0.55;
const WEATHER_PATCH_RADIUS_JITTER = 0.4;
/** A dark rain-stain reads much more than a bleached patch of the same alpha. */
const WEATHER_PATCH_LIGHT_ALPHA_FACTOR = 0.55;
const STREAM_PATCH_X = 41;
const STREAM_PATCH_Y = 42;
const STREAM_PATCH_RADIUS = 43;
const STREAM_PATCH_SIGN = 44;
const STREAM_PATCH_ALPHA = 45;
const STREAM_PATCH_VERTEX = 46;

/**
 * A handful of broad, soft-edged stains of lifted or dropped value, standing
 * in for decades of uneven weather.
 *
 * Each one is a drawn shape rather than a sampled noise field, per pixel
 * value — it reads as a mark laid on the wall (a rain streak's shadow, a
 * sun-bleached patch) instead of a texture woven into it, and it crosses
 * whatever course or plank boundary it lands on, which is what actually
 * makes it read as weather rather than as part of the material.
 */
export function applyWeatherPatches(plane: Plane, options: WeatherPatchOptions): void {
  const ctx = plane.ctx;
  const planeTiles = (plane.width * plane.height) / (options.scale * options.scale);
  const count = Math.max(1, Math.round(planeTiles / WEATHER_PATCH_AREA_PER_TILE));
  const baseRadius = WEATHER_PATCH_RADIUS_TILES * options.scale;

  ctx.save();
  // Only darkens or lightens pixels the material already painted, never the
  // transparent margin a sheared plane can carry outside the building itself.
  ctx.globalCompositeOperation = 'source-atop';
  for (let patch = 0; patch < count; patch++) {
    const centreX = elementValue(options.seed, STREAM_PATCH_X, patch) * plane.width;
    const centreY = elementValue(options.seed, STREAM_PATCH_Y, patch) * plane.height;
    const radius =
      baseRadius *
      (1 +
        (elementValue(options.seed, STREAM_PATCH_RADIUS, patch) - 0.5) *
          2 *
          WEATHER_PATCH_RADIUS_JITTER);
    const darker = elementValue(options.seed, STREAM_PATCH_SIGN, patch) < 0.5;
    const alphaFactor = darker ? 1 : WEATHER_PATCH_LIGHT_ALPHA_FACTOR;
    const alpha =
      options.amplitude *
      alphaFactor *
      (0.6 + elementValue(options.seed, STREAM_PATCH_ALPHA, patch) * 0.4);
    const color: RGB = darker ? [0, 0, 0] : [255, 255, 255];
    ctx.fillStyle = rgba(color, alpha);
    tracePatchBlob(ctx, options.seed, STREAM_PATCH_VERTEX, patch, centreX, centreY, radius);
    ctx.fill();
  }
  ctx.restore();
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

export interface MossPatchOptions {
  readonly seed: number;
  /** Pixels per tile, so a clump is sized architecturally rather than per-pixel. */
  readonly scale: number;
  readonly color: RGB;
  /** Peak tint toward `color`, 0..1 — also gates how many clumps take root. */
  readonly strength: number;
  /** Fraction of the plane's height, measured from the bottom, moss may reach. */
  readonly reach: number;
}

/** Nominal spacing between candidate moss clumps, in tiles. */
const MOSS_CLUMP_SPACING_TILES = 0.85;
const MOSS_CLUMP_RADIUS_TILES = 0.4;
const MOSS_CLUMP_RADIUS_JITTER = 0.5;
const MOSS_CLUMP_ALPHA = 0.55;
const STREAM_MOSS_X = 51;
const STREAM_MOSS_Y = 52;
const STREAM_MOSS_RADIUS = 53;
const STREAM_MOSS_ALPHA = 54;
const STREAM_MOSS_VERTEX = 55;
const STREAM_MOSS_PRESENT = 56;

/**
 * Moss clumps, densest at ground contact and thinning upward.
 *
 * Drawn as individual blobs rather than a thresholded noise field, so each
 * clump reads as a growth sitting on the wall — the same kind of shape a
 * lichen patch or a damp stain actually is — instead of a mottled texture.
 * `strength` both tints each clump and gates how many of the candidate spots
 * along the wall take root at all, so a lightly mossy wall gets a few small
 * clumps rather than one faint wash over the whole surface.
 */
export function applyMossPatches(plane: Plane, options: MossPatchOptions): void {
  if (options.strength <= 0) return;
  const ctx = plane.ctx;
  const reachPx = Math.max(1, options.reach * plane.height);
  const spacing = MOSS_CLUMP_SPACING_TILES * options.scale;
  const candidateCount = Math.max(1, Math.round(plane.width / spacing));
  const radius = MOSS_CLUMP_RADIUS_TILES * options.scale;

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  for (let clump = 0; clump < candidateCount; clump++) {
    if (elementValue(options.seed, STREAM_MOSS_PRESENT, clump) > options.strength) continue;
    const centreX = (clump + elementValue(options.seed, STREAM_MOSS_X, clump)) * spacing;
    const heightAboveBase = elementValue(options.seed, STREAM_MOSS_Y, clump) * reachPx;
    const centreY = plane.height - heightAboveBase;
    const verticalFade = 1 - heightAboveBase / reachPx;
    const clumpRadius =
      radius *
      (1 +
        (elementValue(options.seed, STREAM_MOSS_RADIUS, clump) - 0.5) *
          2 *
          MOSS_CLUMP_RADIUS_JITTER);
    const alpha =
      MOSS_CLUMP_ALPHA *
      options.strength *
      verticalFade *
      (0.6 + elementValue(options.seed, STREAM_MOSS_ALPHA, clump) * 0.4);
    ctx.fillStyle = rgba(options.color, alpha);
    tracePatchBlob(ctx, options.seed, STREAM_MOSS_VERTEX, clump, centreX, centreY, clumpRadius);
    ctx.fill();
  }
  ctx.restore();
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
