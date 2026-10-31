/**
 * The light every celebration screen throws: a soft pool of glow, fans of
 * god rays, a column of light with the shock ring it throws off, bursts of
 * four-pointed sparkles, motes drifting up and the screen-wide flash.
 *
 * The shafts, rays and rings are volumetric light, not flat shapes: every
 * edge is feathered and a shaft holds faint streaks and drifting dust. Pools,
 * shafts, rays and dust are baked once per tint into small alpha maps
 * stretched into place with additive blending, so a frame pays a few
 * `drawImage` calls for them; only a shock ring, alive for under a second,
 * builds its gradient as it draws.
 *
 * Each painter is a closed-form function of its arguments, a particle's
 * scatter included, so a skipped reveal and a gallery fixture paint exactly
 * what the live screen would. Sizes are in pixels; the screens that call
 * these scale them from their own stage.
 */

import type { CanvasSurface } from '../../../core/rendering/canvasSurface';
import { alphaMap, FULL_TURN, scatter, smoothstep } from '../../../sprites/lightMaps';
import type { Rect } from '../../core/geom';
import { withAlpha } from '../../theme/color';

type Ctx = CanvasRenderingContext2D;

const HALF = 0.5;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Strides that give each property of a particle its own run of scatter, so
 * a particle's angle never predicts its speed.
 */
export const SCATTER_STREAM = {
  angle: 3,
  swing: 5,
  speed: 7,
  spin: 9,
  kind: 11,
  rise: 13,
} as const;

const STAR_WAIST = 0.28;

/** A filled four-pointed star of radius `size` at (`x`, `y`). */
function fillStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const waist = size * STAR_WAIST;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + waist, y - waist);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x + waist, y + waist);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - waist, y + waist);
  ctx.lineTo(x - size, y);
  ctx.lineTo(x - waist, y - waist);
  ctx.closePath();
  ctx.fill();
}

export interface RayFan {
  readonly count: number;
  /** Radians either side of each ray's centre line. */
  readonly halfAngle: number;
  readonly reach: number;
  /** The fan's turn, in radians. */
  readonly turn: number;
}

export interface LightColumn {
  /** The middle of the column's foot. */
  readonly base: Point;
  readonly halfBase: number;
  /** How much wider the column is at its top than at its foot. */
  readonly widen: number;
  /** How far the column reaches above its foot. */
  readonly height: number;
}

export interface ShockRing {
  readonly at: Point;
  /** How far out the ring has travelled. */
  readonly radius: number;
  /** Its height over its width: below 1 for a ring lying on the ground. */
  readonly squash: number;
  readonly lineWidth: number;
}

export interface SparkleBurst {
  readonly at: Point;
  /** How far through the burst it is, 0 to 1. */
  readonly progress: number;
  readonly count: number;
  /** How far the farthest sparkle flies. */
  readonly reach: number;
  /** A sparkle's radius as it leaves the middle. */
  readonly size: number;
  /** Tells one burst's scatter from another's. */
  readonly seed: number;
}

const SEED_SPARKLE = 900;

/** Four-pointed sparkles flying out of `burst.at` and fading as they go, every other one in `accent`. */
export function paintSparkleBurst(
  ctx: CanvasRenderingContext2D,
  burst: SparkleBurst,
  tint: string,
  accent: string,
): void {
  const p = burst.progress;
  if (p <= 0 || p >= 1) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < burst.count; i++) {
    const a = (i / burst.count) * FULL_TURN + scatter(SEED_SPARKLE + burst.seed * burst.count + i);
    const reach =
      burst.reach * (HALF + HALF * scatter(SEED_SPARKLE + i * SCATTER_STREAM.speed)) * p;
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = i % 2 === 0 ? tint : accent;
    fillStar(
      ctx,
      burst.at.x + Math.cos(a) * reach,
      burst.at.y + Math.sin(a) * reach,
      burst.size * (1 - p * HALF),
    );
  }
  ctx.restore();
}

export interface MoteDrift {
  /** The middle of the band the motes rise from. */
  readonly origin: Point;
  /** How wide that band is. */
  readonly spread: number;
  /** How far a mote climbs before it fades. */
  readonly rise: number;
  /** How far a mote sways either side of its line. */
  readonly sway: number;
  readonly count: number;
  readonly size: number;
  /** Frames since the motes started. */
  readonly age: number;
  /** Frames one mote takes to climb and fade. */
  readonly period: number;
  /** Radians of sway per frame. */
  readonly swayPerFrame: number;
  readonly seed: number;
}

/** Star motes climbing up out of a band and fading in and out on the way, in `tints` by turn. */
export function paintMoteDrift(
  ctx: CanvasRenderingContext2D,
  drift: MoteDrift,
  tints: readonly [string, ...string[]],
): void {
  if (drift.age < 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < drift.count; i++) {
    const phase =
      ((drift.age + scatter(drift.seed + i) * drift.period) % drift.period) / drift.period;
    const x =
      drift.origin.x +
      (scatter(drift.seed + i * SCATTER_STREAM.swing) - HALF) * drift.spread +
      Math.sin(drift.age * drift.swayPerFrame + i) * drift.sway;
    const y = drift.origin.y - phase * drift.rise;
    ctx.globalAlpha = Math.sin(phase * Math.PI);
    ctx.fillStyle = tints[i % tints.length] ?? tints[0];
    fillStar(ctx, x, y, drift.size);
  }
  ctx.restore();
}

/** The whole of `screen` washed with `tint` at `alpha`, added onto what is under it. */
export function paintScreenFlash(
  ctx: CanvasRenderingContext2D,
  screen: Rect,
  tint: string,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = withAlpha(tint, Math.min(1, alpha));
  ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
  ctx.restore();
}

// ── Volumetric light: shafts, ray fans and rings, soft on every edge ──────────

/** A shaft's alpha map: narrow, since it is only ever stretched, and tall enough for smooth fades. */
const SHAFT_MAP = { w: 64, h: 256 } as const;
/** How far past the shaft's nominal edge its glow is let fall away, as a share of its half-width. */
const SHAFT_SPREAD = 1.5;
/** How quickly the light falls off across the shaft: higher is a tighter core. */
const SHAFT_FALLOFF = 1.6;
/** The shaft fades in over this share of its height above its foot, and out toward its top by this power. */
const SHAFT_FOOT_FADE = 0.08;
const SHAFT_TOP_FADE_POWER = 0.8;
/** Faint streaks running up the shaft, fanning with it: their strength and their spatial frequencies. */
const STREAK_DEPTH = 0.32;
/** The streaks' waves across the shaft: how many per beam width, where each starts, and its share of the pattern. */
const STREAK_WAVES: ReadonlyArray<{
  readonly frequency: number;
  readonly phase: number;
  readonly weight: number;
}> = [
  { frequency: 5.3, phase: 0.4, weight: 0.55 },
  { frequency: 9.1, phase: 2.1, weight: 0.3 },
  { frequency: 14.7, phase: 4.4, weight: 0.15 },
];
/** A slow breathing of the shaft's brightness, as two out-of-step waves. */
const FLICKER_DEPTH = 0.08;
const FLICKER_RATE_A = 0.19;
const FLICKER_RATE_B = 0.31;
const FLICKER_OFFSET_B = 1.3;

/** Dust drifting through a shaft, catching its light. */
const DUST_COUNT = 14;
const DUST_PERIOD_FRAMES = 240;
const DUST_SIZE = 0.12;
const DUST_ALPHA = 0.55;
const DUST_SWAY = 0.15;
const DUST_SWAY_PER_FRAME = 0.02;
const DUST_SEED = 5200;
/** A dust mote's soft dot, baked once per tint. */
const DOT_MAP_SIZE = 24;

/** A fan of rays' alpha map: rays are blurred light, so a small map stretched wide holds them. */
const FAN_MAP_SIZE = 256;
const RAY_FALLOFF = 1.6;
/** Rays fade in from the fan's centre over this share of its reach, and out toward its rim by this power. */
const RAY_CENTRE_FADE = 0.06;
const RAY_RIM_FADE_POWER = 1.7;
/** Each ray is a little brighter or dimmer than its neighbours. */
const RAY_VARIATION = 0.4;
const RAY_SEED = 6100;

/** A ring's soft band reaches this many of its line widths either side of its radius. */
const RING_FEATHER = 2.5;

function streaks(across: number): number {
  let sum = 0;
  for (const wave of STREAK_WAVES)
    sum += wave.weight * Math.sin(across * wave.frequency + wave.phase);
  return 1 - STREAK_DEPTH * HALF * (1 - sum);
}

function shaftMap(tint: string, widen: number): CanvasSurface | null {
  const { w, h } = SHAFT_MAP;
  return alphaMap(`shaft|${widen}`, w, h, tint, (u, v) => {
    const up = (1 - v) * HALF;
    const halfWidth = (1 + (widen - 1) * up) / widen;
    const across = u * SHAFT_SPREAD;
    const inBeam = across / halfWidth;
    const falloff = Math.exp(-inBeam * inBeam * SHAFT_FALLOFF);
    const edge = 1 - smoothstep(SHAFT_SPREAD * HALF, SHAFT_SPREAD, Math.abs(inBeam));
    const foot = smoothstep(0, SHAFT_FOOT_FADE, up);
    const top = (1 - up) ** SHAFT_TOP_FADE_POWER;
    return falloff * edge * foot * top * streaks(inBeam);
  });
}

function dotMap(tint: string): CanvasSurface | null {
  const size = DOT_MAP_SIZE;
  return alphaMap('dust-dot', size, size, tint, (u, v) => {
    const r = Math.sqrt(u * u + v * v);
    return (1 - smoothstep(0, 1, r)) ** 2;
  });
}

/**
 * A shaft of light standing on `column.base`, soft on every side, brightest
 * near its foot and fading out by its top, with faint streaks and dust in
 * it. `clock` (frames) moves the dust and breathes the light; leave it out
 * for a shaft held still.
 */
export function paintLightColumn(
  ctx: Ctx,
  column: LightColumn,
  tint: string,
  alpha: number,
  clock = 0,
): void {
  if (alpha <= 0 || column.halfBase <= 0 || column.height <= 0) return;
  const map = shaftMap(tint, column.widen);
  if (map === null) return;
  const halfTop = column.halfBase * column.widen;
  const spanW = halfTop * SHAFT_SPREAD * 2;
  const top = column.base.y - column.height;
  const flicker =
    1 +
    FLICKER_DEPTH *
      HALF *
      (Math.sin(clock * FLICKER_RATE_A) + Math.sin(clock * FLICKER_RATE_B + FLICKER_OFFSET_B));
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= Math.min(1, alpha * flicker);
    ctx.drawImage(map, column.base.x - spanW * HALF, top, spanW, column.height);
    paintDust(ctx, column, tint, clock);
  } finally {
    ctx.restore();
  }
}

function paintDust(ctx: Ctx, column: LightColumn, tint: string, clock: number): void {
  const dot = dotMap(tint);
  if (dot === null) return;
  const baseAlpha = ctx.globalAlpha;
  const size = column.halfBase * DUST_SIZE * 2;
  for (let i = 0; i < DUST_COUNT; i++) {
    const phase =
      ((clock + scatter(DUST_SEED + i) * DUST_PERIOD_FRAMES) % DUST_PERIOD_FRAMES) /
      DUST_PERIOD_FRAMES;
    const up = 1 - phase;
    const halfWidth = column.halfBase * (1 + (column.widen - 1) * up);
    const lane = scatter(DUST_SEED + i * SCATTER_STREAM.swing) * 2 - 1;
    const sway = Math.sin(clock * DUST_SWAY_PER_FRAME + i) * DUST_SWAY;
    const x = column.base.x + (lane + sway) * halfWidth * HALF;
    const y = column.base.y - up * column.height;
    const twinkle = Math.sin(phase * Math.PI);
    ctx.globalAlpha = baseAlpha * DUST_ALPHA * twinkle;
    ctx.drawImage(dot, x - size * HALF, y - size * HALF, size, size);
  }
  ctx.globalAlpha = baseAlpha;
}

function fanMap(tint: string, count: number, halfAngle: number): CanvasSurface | null {
  const size = FAN_MAP_SIZE;
  const step = FULL_TURN / count;
  return alphaMap(`fan|${count}|${halfAngle}`, size, size, tint, (u, v) => {
    const reach = Math.sqrt(u * u + v * v);
    if (reach >= 1) return 0;
    const angle = Math.atan2(v, u);
    const ray = Math.round(angle / step);
    const off = (angle - ray * step) / halfAngle;
    const across = Math.exp(-off * off * RAY_FALLOFF);
    const strength = 1 - RAY_VARIATION * scatter(RAY_SEED + ((ray % count) + count));
    const centre = smoothstep(0, RAY_CENTRE_FADE, reach);
    const rim = (1 - reach) ** RAY_RIM_FADE_POWER;
    return across * strength * centre * rim;
  });
}

/** God rays fanned round `at`, soft along and across every ray, added onto what is under them. */
export function paintRayFan(ctx: Ctx, at: Point, fan: RayFan, tint: string, alpha: number): void {
  if (alpha <= 0 || fan.reach <= 0 || fan.count <= 0) return;
  const map = fanMap(tint, fan.count, fan.halfAngle);
  if (map === null) return;
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= Math.min(1, alpha);
    ctx.translate(at.x, at.y);
    ctx.rotate(fan.turn);
    ctx.drawImage(map, -fan.reach, -fan.reach, fan.reach * 2, fan.reach * 2);
  } finally {
    ctx.restore();
  }
}

/** A ring of light thrown out from `ring.at`, its band feathered on both sides, added onto what is under it. */
export function paintShockRing(ctx: Ctx, ring: ShockRing, tint: string, alpha: number): void {
  if (alpha <= 0 || ring.radius <= 0 || ring.lineWidth <= 0) return;
  const feather = ring.lineWidth * RING_FEATHER;
  const outer = ring.radius + feather;
  const inner = Math.max(0, ring.radius - feather);
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(ring.at.x, ring.at.y);
    ctx.scale(1, ring.squash);
    // Built per frame rather than baked: a ring's band is a few pixels on a ring hundreds wide,
    // which no stretched map small enough to keep holds without thinning out.
    const band = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
    band.addColorStop(0, withAlpha(tint, 0));
    band.addColorStop((ring.radius - inner) / (outer - inner), withAlpha(tint, Math.min(1, alpha)));
    band.addColorStop(1, withAlpha(tint, 0));
    ctx.fillStyle = band;
    ctx.fillRect(-outer, -outer, outer * 2, outer * 2);
  } finally {
    ctx.restore();
  }
}
