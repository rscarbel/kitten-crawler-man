/**
 * Soft light baked once and stretched into place.
 *
 * Every glow, pool, shaft, fan, ring and bloom on screen is a falloff shape
 * in a tint. A `CanvasGradient` bakes its coordinates in, so a light that
 * moves or resizes would need a fresh one every frame; baking the shape into
 * a small surface instead makes it position-free, and a frame pays one
 * `drawImage` per light. This module holds the one cache those surfaces live
 * in (dropped whole when the canvas is lost and painted again on next use),
 * the per-pixel alpha-map bake the shaped lights are made with, and the one
 * round pool painter.
 *
 * It also holds the small shared maths every light painter leans on: the full
 * turn, smoothstep and the repeatable scatter particles are placed with.
 */

import {
  allocCanvas,
  freshSurfaceContext,
  releaseSurface,
  SURFACE_BYTES_PER_PIXEL,
  type CanvasSurface,
  type SurfaceOwner,
} from '../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../core/rendering/canvasRecovery';
import { rgbOf } from '../ui/theme/color';

type Ctx = CanvasRenderingContext2D;

export const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

const SMOOTHSTEP_SQUARE = 3;
const SMOOTHSTEP_CUBE = 2;

/** 0 at or below `from`, 1 at or above `to`, eased between with no slope at either end. */
export function smoothstep(from: number, to: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - from) / (to - from)));
  return t * t * (SMOOTHSTEP_SQUARE - SMOOTHSTEP_CUBE * t);
}

/** The classic shader hash's multipliers: large and incommensurate, so neighbouring seeds land far apart. */
const HASH_SEED_SCALE = 12.9898;
const HASH_SALT_SCALE = 78.233;
const HASH_SPREAD = 43758.5453;

/**
 * A repeatable value in [0, 1) for `seed`, and for its `salt`th property when
 * one particle needs several unrelated values.
 */
export function scatter(seed: number, salt = 0): number {
  const value = Math.sin(seed * HASH_SEED_SCALE + salt * HASH_SALT_SCALE) * HASH_SPREAD;
  return value - Math.floor(value);
}

const surfaces = new Map<string, CanvasSurface>();
onCanvasRecovery(() => {
  for (const surface of surfaces.values()) releaseSurface(surface);
  surfaces.clear();
});

/**
 * The surface baked under `key`, painting it with `paint` the first time it
 * is asked for. Null when the browser refuses the surface a context.
 */
export function bakedSurface(
  key: string,
  owner: SurfaceOwner,
  w: number,
  h: number,
  paint: (ctx: Ctx) => void,
): CanvasSurface | null {
  const known = surfaces.get(key);
  if (known !== undefined) return known;
  const surface = allocCanvas(owner, w, h);
  let ctx: Ctx;
  try {
    ctx = freshSurfaceContext(surface);
  } catch {
    return null;
  }
  paint(ctx);
  surfaces.set(key, surface);
  return surface;
}

/** Bytes held by every baked surface whose key starts with `prefix`, for memory gates. */
export function bakedBytes(prefix: string): number {
  let bytes = 0;
  for (const [key, surface] of surfaces) {
    if (key.startsWith(prefix)) bytes += surface.width * surface.height * SURFACE_BYTES_PER_PIXEL;
  }
  return bytes;
}

const RGBA_STRIDE = 4;
const GREEN = 1;
const BLUE = 2;
const ALPHA = 3;
const OPAQUE = 255;

/**
 * A `w`×`h` map in `tint` whose alpha (0..1) at each pixel is `alphaAt(u, v)`,
 * with `u` and `v` running -1..1 across and down through the pixel centres.
 */
export function alphaMap(
  key: string,
  w: number,
  h: number,
  tint: string,
  alphaAt: (u: number, v: number) => number,
): CanvasSurface | null {
  return bakedSurface(`map|${key}|${tint}`, 'ui', w, h, (ctx) => {
    const image = ctx.createImageData(w, h);
    const { r, g, b } = rgbOf(tint);
    for (let y = 0; y < h; y++) {
      const v = ((y + HALF) / h) * 2 - 1;
      for (let x = 0; x < w; x++) {
        const u = ((x + HALF) / w) * 2 - 1;
        const offset = (y * w + x) * RGBA_STRIDE;
        image.data[offset] = r;
        image.data[offset + GREEN] = g;
        image.data[offset + BLUE] = b;
        image.data[offset + ALPHA] = Math.round(Math.max(0, Math.min(1, alphaAt(u, v))) * OPAQUE);
      }
    }
    ctx.putImageData(image, 0, 0);
  });
}

/** Draws `map` stretched to `halfW`×`halfH` either side of (`cx`, `cy`), at `alpha`. */
export function drawStretched(
  ctx: Ctx,
  map: CanvasSurface | null,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  alpha: number,
): void {
  if (map === null || alpha <= 0 || halfW <= 0 || halfH <= 0) return;
  ctx.save();
  try {
    ctx.globalAlpha *= Math.min(1, alpha);
    ctx.drawImage(map, cx - halfW, cy - halfH, halfW * 2, halfH * 2);
  } finally {
    ctx.restore();
  }
}

/** A pool's map: only ever stretched, and big enough that its falloff never bands. */
const POOL_MAP_SIZE = 128;
/** How tightly an eased pool's light gathers at its source: higher is a smaller, hotter middle. */
const EASED_POOL_FALLOFF = 3.2;

/**
 * How a pool's light falls away from its middle: `eased` gathers it toward
 * the centre and eases to nothing with no slope left at the rim, so a
 * stretched pool shows no ellipse; `linear` falls in a straight line, a
 * broad wash.
 */
export type PoolProfile = 'eased' | 'linear';

/** Bright at `distance` 0 and easing to exactly nothing, with no slope left, at 1. */
export function easedFalloff(distance: number, tightness: number): number {
  if (distance >= 1) return 0;
  return Math.exp(-distance * distance * tightness) * (1 - smoothstep(HALF, 1, distance));
}

const POOL_PROFILES: Record<PoolProfile, (distance: number) => number> = {
  eased: (distance) => easedFalloff(distance, EASED_POOL_FALLOFF),
  linear: (distance) => Math.max(0, 1 - distance),
};

/**
 * A soft pool of `tint` centred on (`cx`, `cy`), reaching `reachX` across and
 * `reachY` up and down, at `alpha` in its middle. Drawn over what is there;
 * the caller picks the blend.
 */
export function paintSoftPool(
  ctx: Ctx,
  cx: number,
  cy: number,
  reachX: number,
  reachY: number,
  tint: string,
  alpha: number,
  profile: PoolProfile = 'eased',
): void {
  if (alpha <= 0) return;
  const shape = POOL_PROFILES[profile];
  const map = alphaMap(`pool-${profile}`, POOL_MAP_SIZE, POOL_MAP_SIZE, tint, (u, v) =>
    shape(Math.sqrt(u * u + v * v)),
  );
  drawStretched(ctx, map, cx, cy, reachX, reachY, alpha);
}

/** A vertical ramp's map: one pixel wide, since it only ever varies down its height. */
const RAMP_MAP_HEIGHT = 256;

/** One stop of a {@link paintVerticalRamp}: a colour (any CSS colour) held at `at`, 0 top to 1 bottom. */
export interface RampStop {
  readonly at: number;
  readonly color: string;
}

/**
 * Fills `rect` with a top-to-bottom blend through `stops`, baked once per set
 * of stops and stretched, so a full-screen backdrop costs one `drawImage`.
 */
export function paintVerticalRamp(
  ctx: Ctx,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  stops: readonly RampStop[],
): void {
  if (rect.w <= 0 || rect.h <= 0) return;
  const key = `ramp|${stops.map((stop) => `${stop.at}:${stop.color}`).join('|')}`;
  const map = bakedSurface(key, 'ui', 1, RAMP_MAP_HEIGHT, (bake) => {
    const ramp = bake.createLinearGradient(0, 0, 0, RAMP_MAP_HEIGHT);
    for (const stop of stops) ramp.addColorStop(stop.at, stop.color);
    bake.fillStyle = ramp;
    bake.fillRect(0, 0, 1, RAMP_MAP_HEIGHT);
  });
  if (map === null) return;
  ctx.drawImage(map, rect.x, rect.y, rect.w, rect.h);
}

/** A soft band's map: its light only varies across it, so it is a few rows tall and stretched along. */
const BAND_MAP = { w: 64, h: 4 } as const;

/**
 * A straight band of `tint` through `at`, brightest along its middle and
 * falling in straight ramps to nothing `halfWidth` either side, `halfLength`
 * long each way, turned `angle` radians from upright. Drawn with whatever
 * blend `ctx` is set to, so it can light or mask what is under it.
 */
export function paintSoftBand(
  ctx: Ctx,
  at: { readonly x: number; readonly y: number },
  halfWidth: number,
  halfLength: number,
  angle: number,
  tint: string,
  alpha: number,
): void {
  if (alpha <= 0 || halfWidth <= 0 || halfLength <= 0) return;
  const map = alphaMap('soft-band', BAND_MAP.w, BAND_MAP.h, tint, (u) => 1 - Math.abs(u));
  if (map === null) return;
  ctx.save();
  try {
    ctx.translate(at.x, at.y);
    ctx.rotate(angle);
    ctx.globalAlpha *= Math.min(1, alpha);
    ctx.drawImage(map, -halfWidth, -halfLength, halfWidth * 2, halfLength * 2);
  } finally {
    ctx.restore();
  }
}
