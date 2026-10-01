/**
 * Shared primitives for the dungeon's painted props: the contact shadow every
 * prop sits on, soft puffs, flat shards, and the burst and wreckage engines a
 * breakable prop comes apart through.
 *
 * Each prop family keeps its own painter module and decides what its pieces
 * look like; this module decides how pieces fly and settle, so a crate, a steel
 * drum and a heap of bones all break with the same weight and timing.
 *
 * Every prop shares one light: a key light from above and slightly in front.
 * Tops are lit, fronts sit in mid-tone, and a short soft contact shadow falls
 * below the object. Local torchlight is the lighting pass's job, so nothing
 * here paints a glow onto the surroundings.
 */

import { mulberry32 } from '../person/rng';

export type Ctx = CanvasRenderingContext2D;

export const TWO_PI = Math.PI * 2;

/**
 * How many seeded looks a static prop's idle, damaged and remains rows carry,
 * one per frame. The silhouette is identical across them; only the passes
 * allowed to vary (stains, contents, lean, wear) take the variant's seed.
 */
export const PROP_VARIANT_COUNT = 3;

/** Frames in a breakable prop's shatter row. */
export const SHATTER_FRAMES = 6;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A uniform value in [-1, 1] from a seeded stream. */
export const signedUnit = (rng: () => number) => (rng() - 0.5) * 2;

/** Picks one entry of a non-empty list with a seeded stream. */
export function pick<T>(rng: () => number, list: readonly [T, ...T[]]): T {
  return list[Math.floor(rng() * list.length)] ?? list[0];
}

const CONTACT_SHADOW_ALPHA = 0.35;
const CONTACT_SHADOW_MID_STOP = 0.6;
const CONTACT_SHADOW_MID_ALPHA_FRACTION = 0.6;
const CONTACT_SHADOW_WIDTH_FRACTION = 0.7;
const CONTACT_SHADOW_HEIGHT_FRACTION = 0.11;

/**
 * The short soft ellipse under a prop. Without it a prop floats over the floor
 * instead of standing on it.
 */
export function contactShadow(ctx: Ctx, cx: number, baseY: number, ts: number, scale = 1): void {
  const rx = (ts * CONTACT_SHADOW_WIDTH_FRACTION * scale) / 2;
  const ry = ts * CONTACT_SHADOW_HEIGHT_FRACTION * scale;
  const grad = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, rx);
  grad.addColorStop(0, `rgba(0,0,0,${CONTACT_SHADOW_ALPHA})`);
  grad.addColorStop(
    CONTACT_SHADOW_MID_STOP,
    `rgba(0,0,0,${CONTACT_SHADOW_ALPHA * CONTACT_SHADOW_MID_ALPHA_FRACTION})`,
  );
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

const PUFF_MID_STOP = 0.55;
const PUFF_MID_ALPHA_FRACTION = 0.45;

/** A soft round cloud: sawdust, ash, bone dust or smoke, tinted by the caller. */
export function puff(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  alpha: number,
  rgb: readonly [number, number, number],
): void {
  const [r, g, b] = rgb;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
  grad.addColorStop(PUFF_MID_STOP, `rgba(${r},${g},${b},${alpha * PUFF_MID_ALPHA_FRACTION})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

const SHARD_TIP_NARROW_FRACTION = 0.25;
const SHARD_TIP_WIDE_FRACTION = 0.3;
const SHARD_EDGE_WIDTH = 0.6;

/** One flat tapered piece — a plank end, a steel scrap, a bone shard — rotated about its middle. */
export function shard(
  ctx: Ctx,
  cx: number,
  cy: number,
  length: number,
  width: number,
  angle: number,
  shade: string,
  edge: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(-length / 2, -width / 2);
  ctx.lineTo(length / 2, -width * SHARD_TIP_NARROW_FRACTION);
  ctx.lineTo(length / 2, width * SHARD_TIP_WIDE_FRACTION);
  ctx.lineTo(-length / 2, width / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = SHARD_EDGE_WIDTH;
  ctx.stroke();
  ctx.restore();
}

const SPECKLE_COUNT = 26;
const SPECKLE_LIGHT_SHADE_CHANCE = 0.4;
const SPECKLE_ALPHA_MIN = 0.25;
const SPECKLE_ALPHA_SPREAD = 0.35;
/** Top-down foreshortening of a dusting lying on the floor. */
const SPECKLE_VERTICAL_SQUASH = 0.55;

/**
 * Fine dust settled over wreckage. Confined to the wreckage itself — a floor is
 * never speckled — and the caller picks two shades so the dusting matches what
 * came apart.
 */
export function speckle(
  ctx: Ctx,
  cx: number,
  cy: number,
  spread: number,
  rng: () => number,
  lightShade: string,
  darkShade: string,
): void {
  ctx.save();
  for (let i = 0; i < SPECKLE_COUNT; i++) {
    const a = rng() * TWO_PI;
    const r = Math.sqrt(rng()) * spread;
    ctx.globalAlpha = SPECKLE_ALPHA_MIN + rng() * SPECKLE_ALPHA_SPREAD;
    ctx.fillStyle = rng() < SPECKLE_LIGHT_SHADE_CHANCE ? lightShade : darkShade;
    ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * SPECKLE_VERTICAL_SQUASH, 1, 1);
  }
  ctx.restore();
}

// ── Burst ─────────────────────────────────────────────────────────────────────

/**
 * One piece thrown by a break. A `shard` is a flat tapered piece; a `curl` is a
 * bent strip of metal, drawn as an open arc so it reads as a hoop or a strap
 * rather than a plank.
 */
export interface DebrisPiece {
  readonly angle: number;
  readonly distance: number;
  /** Where along the prop the piece came off, in tile heights from the burst centre. */
  readonly originY: number;
  /** Orientation the piece starts at, before its tumble is added. */
  readonly restAngle: number;
  readonly length: number;
  readonly width: number;
  readonly spin: number;
  readonly shade: string;
  readonly edge: string;
  readonly form: 'shard' | 'curl';
}

/** The cloud the pieces burst out of, at `radius` and `alpha`. */
export type BurstCloud = (ctx: Ctx, cx: number, cy: number, radius: number, alpha: number) => void;

/** Top-down foreshortening: debris spreads less vertically than horizontally. */
const DEBRIS_VERTICAL_SQUASH = 0.6;
/**
 * Rise and fall are near-balanced on purpose: a fall much larger than the rise
 * walks the whole cloud off the bottom of the tile by the last frame, and the
 * break reads as debris landing a tile south of the prop.
 */
const DEBRIS_RISE_PX = 11;
const DEBRIS_FALL_PX = 9;
/**
 * Frame 0 is the instant the prop gives way, not the instant before it, so the
 * pieces already have this much of their travel.
 */
const DEBRIS_INITIAL_TRAVEL = 0.3;
const DEBRIS_EASE_POWER = 2.2;
const debrisEase = (t: number) => 1 - Math.pow(1 - t, DEBRIS_EASE_POWER);
const DEBRIS_FADE_START = 0.55;
/** Alpha the last shatter frame lands on, handing off to the wreckage decal. */
const DEBRIS_FINAL_ALPHA = 0.22;
/** The impact flash lives only in the first two frames. */
const IMPACT_FLASH_PROGRESS_END = 0.3;
const IMPACT_FLASH_RADIUS_FRACTION = 0.3;
const IMPACT_FLASH_MAX_ALPHA = 0.75;
const DUST_PROGRESS_RATE = 1.6;
const DUST_MAX_ALPHA = 0.5;
const DUST_MIN_ALPHA = 0.01;
const DUST_RADIUS_START_FRACTION = 0.28;
const DUST_RADIUS_GROWTH_FRACTION = 0.42;
const CURL_RADIUS_FRACTION = 0.6;
const CURL_ARC_START = 0.4;
const CURL_ARC_END = 2.6;

/**
 * One frame of a break, `progress` running 0→1 across the shatter row: the
 * pieces burst outward from (`cx`, `cy`), tumble, then fall and fade.
 */
export function drawDebrisBurst(
  ctx: Ctx,
  pieces: ReadonlyArray<DebrisPiece>,
  cloud: BurstCloud,
  cx: number,
  cy: number,
  ts: number,
  progress: number,
): void {
  const travel = lerp(DEBRIS_INITIAL_TRAVEL, 1, debrisEase(progress));

  const dustAlpha = Math.sin(Math.min(1, progress * DUST_PROGRESS_RATE) * Math.PI) * DUST_MAX_ALPHA;
  if (dustAlpha > DUST_MIN_ALPHA) {
    const radius = ts * (DUST_RADIUS_START_FRACTION + travel * DUST_RADIUS_GROWTH_FRACTION);
    cloud(ctx, cx, cy, radius, dustAlpha);
  }
  if (progress < IMPACT_FLASH_PROGRESS_END) {
    const flash = 1 - progress / IMPACT_FLASH_PROGRESS_END;
    cloud(ctx, cx, cy, ts * IMPACT_FLASH_RADIUS_FRACTION, flash * IMPACT_FLASH_MAX_ALPHA);
  }

  const fadeProgress = (progress - DEBRIS_FADE_START) / (1 - DEBRIS_FADE_START);
  const alpha = progress <= DEBRIS_FADE_START ? 1 : lerp(1, DEBRIS_FINAL_ALPHA, fadeProgress);

  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  for (const piece of pieces) {
    const dist = piece.distance * travel;
    const px = cx + Math.cos(piece.angle) * dist;
    const py =
      cy +
      piece.originY * ts +
      Math.sin(piece.angle) * dist * DEBRIS_VERTICAL_SQUASH -
      DEBRIS_RISE_PX * Math.sin(progress * Math.PI) +
      DEBRIS_FALL_PX * progress * progress;
    const angle = piece.restAngle + piece.spin * progress;
    if (piece.form === 'curl') {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.strokeStyle = piece.shade;
      ctx.lineWidth = piece.width;
      ctx.beginPath();
      ctx.arc(0, 0, piece.length * CURL_RADIUS_FRACTION, CURL_ARC_START, CURL_ARC_END);
      ctx.stroke();
      ctx.restore();
    } else {
      shard(ctx, px, py, piece.length, piece.width, angle, piece.shade, piece.edge);
    }
  }
  ctx.restore();
}

/** How a radial ring of debris is shaped. Every range is a minimum plus a spread. */
export interface RadialDebrisSpec {
  readonly count: number;
  readonly spreadPx: number;
  /** Shades a shard is picked from. */
  readonly shades: readonly [string, ...string[]];
  readonly edge: string;
  /** Every `curlPeriod`th piece is a curl of `curlShade`; zero for none. */
  readonly curlPeriod: number;
  readonly curlShade: string;
  readonly lengthMin: number;
  readonly lengthSpread: number;
  readonly widthMin: number;
  readonly widthSpread: number;
}

const RADIAL_ANGLE_JITTER = 0.5;
const RADIAL_DISTANCE_MIN_FRACTION = 0.45;
const RADIAL_DISTANCE_SPREAD_FRACTION = 0.75;
const RADIAL_SPIN_RANGE = 7;
const CURL_LENGTH_MIN = 9;
const CURL_LENGTH_SPREAD = 5;
const CURL_WIDTH = 2.5;

/** A ring of pieces thrown evenly round a boxy prop. */
export function radialDebris(seed: number, spec: RadialDebrisSpec): DebrisPiece[] {
  const rng = mulberry32(seed);
  const out: DebrisPiece[] = [];
  for (let i = 0; i < spec.count; i++) {
    const isCurl = spec.curlPeriod > 0 && i % spec.curlPeriod === spec.curlPeriod - 1;
    out.push({
      angle: (i / spec.count) * TWO_PI + rng() * RADIAL_ANGLE_JITTER,
      distance:
        spec.spreadPx * (RADIAL_DISTANCE_MIN_FRACTION + rng() * RADIAL_DISTANCE_SPREAD_FRACTION),
      originY: 0,
      restAngle: rng() * Math.PI,
      length: isCurl
        ? CURL_LENGTH_MIN + rng() * CURL_LENGTH_SPREAD
        : spec.lengthMin + rng() * spec.lengthSpread,
      width: isCurl ? CURL_WIDTH : spec.widthMin + rng() * spec.widthSpread,
      spin: signedUnit(rng) * (RADIAL_SPIN_RANGE / 2),
      shade: isCurl ? spec.curlShade : pick(rng, spec.shades),
      edge: spec.edge,
      form: isCurl ? 'curl' : 'shard',
    });
  }
  return out;
}

// ── Wreckage ──────────────────────────────────────────────────────────────────

/** One flat piece lying in the wreckage, offset from the wreckage centre. */
export interface WreckagePiece {
  readonly dx: number;
  readonly dy: number;
  readonly length: number;
  readonly width: number;
  readonly angle: number;
  readonly shade: string;
}

const WRECKAGE_ANGLE_JITTER = 0.8;
const WRECKAGE_REACH_MIN = 4;
const WRECKAGE_REACH_SPREAD = 12;
const WRECKAGE_VERTICAL_SQUASH = 0.5;

/** A field of flat pieces lying round a centre, each `length` and `width` a minimum plus a spread. */
export function wreckageField(
  seed: number,
  count: number,
  shades: readonly [string, ...string[]],
  size: {
    readonly lengthMin: number;
    readonly lengthSpread: number;
    readonly widthMin: number;
    readonly widthSpread: number;
  },
): WreckagePiece[] {
  const rng = mulberry32(seed);
  const out: WreckagePiece[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TWO_PI + rng() * WRECKAGE_ANGLE_JITTER;
    const r = WRECKAGE_REACH_MIN + rng() * WRECKAGE_REACH_SPREAD;
    out.push({
      dx: Math.cos(a) * r,
      dy: Math.sin(a) * r * WRECKAGE_VERTICAL_SQUASH,
      length: size.lengthMin + rng() * size.lengthSpread,
      width: size.widthMin + rng() * size.widthSpread,
      angle: rng() * Math.PI,
      shade: pick(rng, shades),
    });
  }
  return out;
}

const WRECKAGE_SHADOW_ALPHA = 0.28;
const WRECKAGE_SHADOW_RX_FRACTION = 0.34;
const WRECKAGE_SHADOW_RY_FRACTION = 0.17;
const WRECKAGE_SHADOW_DROP_PX = 2;

/** The dark bed wreckage lies in, so a flat pile still reads as sitting on the floor. */
export function wreckageShadow(ctx: Ctx, cx: number, cy: number, ts: number): void {
  ctx.save();
  ctx.globalAlpha = WRECKAGE_SHADOW_ALPHA;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + WRECKAGE_SHADOW_DROP_PX,
    ts * WRECKAGE_SHADOW_RX_FRACTION,
    ts * WRECKAGE_SHADOW_RY_FRACTION,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
}

/** Paints a wreckage field round (`cx`, `cy`). */
export function drawWreckageField(
  ctx: Ctx,
  pieces: ReadonlyArray<WreckagePiece>,
  cx: number,
  cy: number,
  edge: string,
): void {
  for (const p of pieces)
    shard(ctx, cx + p.dx, cy + p.dy, p.length, p.width, p.angle, p.shade, edge);
}

/** Runs `paint` rotated by `angle` about (`px`, `py`). */
export function withRotation(
  ctx: Ctx,
  px: number,
  py: number,
  angle: number,
  paint: () => void,
): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.translate(-px, -py);
  paint();
  ctx.restore();
}

/** A vertical gradient, lit at the top: the key light's falloff down a front face. */
export function verticalRamp(
  ctx: Ctx,
  x: number,
  y0: number,
  y1: number,
  stops: ReadonlyArray<readonly [number, string]>,
): CanvasGradient {
  const g = ctx.createLinearGradient(x, y0, x, y1);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  return g;
}

/** A horizontal gradient across a rounded body: lit just left of centre, falling off to both edges. */
export function cylinderRamp(
  ctx: Ctx,
  x0: number,
  x1: number,
  y: number,
  stops: ReadonlyArray<readonly [number, string]>,
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y, x1, y);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  return g;
}
