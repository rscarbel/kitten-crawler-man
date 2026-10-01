/**
 * The shared paint box for the cellars' furniture: one warm palette, one key
 * light and the handful of strokes every piece is built from.
 *
 * Every piece is lit the same way — from above and slightly in front — so tops
 * take the light, fronts sit in mid-tone and a short soft shadow pools under
 * the foot. No piece paints torchlight into itself: the lighting pass adds the
 * room's light over the sprite, and only a piece's own flame or glow is bright.
 */

import type { Rng } from '../../person/rng';

export type Ctx = CanvasRenderingContext2D;

export const TWO_PI = Math.PI * 2;
/** The middle of anything: a centred random offset is `rng() - HALF`. */
export const HALF = 0.5;

/** Four values of one material, darkest first. */
export interface Ramp {
  readonly deep: string;
  readonly shade: string;
  readonly mid: string;
  readonly lit: string;
  readonly rim: string;
}

/** Fired terracotta, gone dull with cellar damp. */
export const CLAY: Ramp = {
  deep: '#3a2219',
  shade: '#5f3a29',
  mid: '#7c5038',
  lit: '#966a4c',
  rim: '#b08566',
};

/** Coarse hessian sacking. */
export const BURLAP: Ramp = {
  deep: '#3a2e1e',
  shade: '#5c4a30',
  mid: '#7a6443',
  lit: '#987f58',
  rim: '#b29a6e',
};

/** Old oak, the same family of browns as the crates and barrels. */
export const OAK: Ramp = {
  deep: '#2a1a0d',
  shade: '#43291a',
  mid: '#62401f',
  lit: '#82592f',
  rim: '#a37542',
};

/** Rotten, grey-weathered timber for a beam that came down with the ceiling. */
export const OLD_TIMBER: Ramp = {
  deep: '#261d16',
  shade: '#3d3027',
  mid: '#56463a',
  lit: '#6f5d4d',
  rim: '#887563',
};

/** Pitted iron going to rust. */
export const RUST_IRON: Ramp = {
  deep: '#211a17',
  shade: '#3b2d26',
  mid: '#5a4031',
  lit: '#7d5537',
  rim: '#9c6b45',
};

/** Pale limestone, the cellars' own stone. */
export const LIMESTONE: Ramp = {
  deep: '#2e2a24',
  shade: '#4e483e',
  mid: '#6c6555',
  lit: '#8a826e',
  rim: '#a59c85',
};

/** Tallow wax, yellowed. */
export const TALLOW: Ramp = {
  deep: '#5e5236',
  shade: '#8a7a52',
  mid: '#b4a272',
  lit: '#d4c493',
  rim: '#ebdfb4',
};

/** Dark bottle glass, green and brown. */
export const BOTTLE_GREEN = '#1f3a26';
export const BOTTLE_BROWN = '#3a2614';
export const GLASS_GLINT = '#b9d6c0';

/** Spilled red wine soaked into stone: a stain, not a puddle of paint. */
export const WINE_STAIN = '#3a0f14';

/** Grain spilled from a split sack or urn. */
export const GRAIN = '#b39a5c';
export const GRAIN_SHADE = '#7f6a3c';

/** The near-black of a hollow: the inside of an urn, under a lid, behind a rack. */
export const HOLLOW = '#120b08';

/** Contact shadow under every piece. */
const CONTACT_SHADOW_ALPHA = 0.42;
const CONTACT_SHADOW_MID_STOP = 0.55;
const CONTACT_SHADOW_MID_ALPHA_FRACTION = 0.6;

/**
 * A short, soft shadow pooled under a piece's foot. Without it a prop floats
 * over the floor instead of standing on it.
 */
export function contactShadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  grad.addColorStop(0, `rgba(0,0,0,${CONTACT_SHADOW_ALPHA})`);
  grad.addColorStop(
    CONTACT_SHADOW_MID_STOP,
    `rgba(0,0,0,${CONTACT_SHADOW_ALPHA * CONTACT_SHADOW_MID_ALPHA_FRACTION})`,
  );
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** A wash keeps most of its strength out to the middle of its radius. */
const WASH_MID_ALPHA_FRACTION = 0.8;

/** A soft, flat-edged tonal wash: a stain, a spill, a dust shadow. */
export function wash(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rgb: string,
  alpha: number,
): void {
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  grad.addColorStop(0, `rgba(${rgb},${alpha})`);
  grad.addColorStop(CONTACT_SHADOW_MID_STOP, `rgba(${rgb},${alpha * WASH_MID_ALPHA_FRACTION})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Where the light band sits across a side-lit form, left to right. */
const SIDE_LIT_STOPS = { litFrom: 0.22, litTo: 0.42, mid: 0.75 } as const;
/** How far down a front face the lit top edge gives way to mid-tone. */
const FRONT_MID_STOP = 0.3;

/** A linear gradient across a form, lit on its upper-left and falling into shade on the right. */
export function sideLitGradient(ctx: Ctx, x0: number, x1: number, y: number, ramp: Ramp) {
  const g = ctx.createLinearGradient(x0, y, x1, y);
  g.addColorStop(0, ramp.shade);
  g.addColorStop(SIDE_LIT_STOPS.litFrom, ramp.lit);
  g.addColorStop(SIDE_LIT_STOPS.litTo, ramp.lit);
  g.addColorStop(SIDE_LIT_STOPS.mid, ramp.mid);
  g.addColorStop(1, ramp.deep);
  return g;
}

/** A gradient down a front face: lit along the top edge, mid-tone below, darker at the foot. */
export function frontGradient(ctx: Ctx, x: number, y0: number, y1: number, ramp: Ramp) {
  const g = ctx.createLinearGradient(x, y0, x, y1);
  g.addColorStop(0, ramp.lit);
  g.addColorStop(FRONT_MID_STOP, ramp.mid);
  g.addColorStop(1, ramp.shade);
  return g;
}

/** A top face: lit, a touch brighter toward the front edge where the key light lands. */
export function topGradient(ctx: Ctx, x: number, y0: number, y1: number, ramp: Ramp) {
  const g = ctx.createLinearGradient(x, y0, x, y1);
  g.addColorStop(0, ramp.lit);
  g.addColorStop(1, ramp.rim);
  return g;
}

/** A closed polygon through `points`. */
export function polygon(ctx: Ctx, points: ReadonlyArray<readonly [number, number]>): void {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** A straight stroke. */
export function line(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

/** A jagged split, its line wandering by up to `wobble` either side. */
export function crackLine(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  wobble: number,
  rng: Rng,
  color = HOLLOW,
  width = 2,
): void {
  const steps = 5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const jitter = step === steps ? 0 : (rng() - HALF) * 2 * wobble;
    ctx.lineTo(x0 + (x1 - x0) * t + jitter, y0 + (y1 - y0) * t);
  }
  ctx.stroke();
  ctx.restore();
}

/** A shard tapers to a narrower tip, a little off its centre line, as shares of its width. */
const SHARD_TIP = { upper: 0.2, lower: 0.3 } as const;

/** One flat shard, a tapered quad turned to `angle`, edged a step darker. */
export function shard(
  ctx: Ctx,
  cx: number,
  cy: number,
  length: number,
  width: number,
  angle: number,
  fill: string,
  edge: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = fill;
  polygon(ctx, [
    [-length / 2, -width / 2],
    [length / 2, -width * SHARD_TIP.upper],
    [length / 2, width * SHARD_TIP.lower],
    [-length / 2, width / 2],
  ]);
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** A dust cloud is a little wider than it is tall. */
const DUST_FLATTEN = 0.8;

/** A puff of dust thrown off by a break, tinted to what came apart. */
export function dustPuff(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  rgb: string,
  alpha: number,
) {
  wash(ctx, cx, cy, radius, radius * DUST_FLATTEN, rgb, alpha);
}

/** Frames in every breakable piece's break. */
export const SHATTER_FRAMES = 6;

/** What flies off a piece as it breaks. */
export interface ShatterSpec {
  /** Shard colours, chosen at random per shard. */
  readonly shades: ReadonlyArray<string>;
  readonly edge: string;
  /** The dust's colour as `r,g,b`. */
  readonly dustRgb: string;
  readonly shardCount: number;
  readonly shardLength: number;
  readonly shardWidth: number;
  /** How far the shards travel by the last frame, in source pixels. */
  readonly spread: number;
  /** Horizontal reach of the burst's origin either side of `cx`, for a two-tile piece. */
  readonly halfWidth: number;
}

const SHATTER_RISE = 18;
/** Each shard's speed, as a share of the spec's spread. */
const SHATTER_SPEED = { min: 0.45, spread: 0.55 } as const;
/** Shards fly over the floor, so their travel down the screen is foreshortened. */
const SHATTER_FLATTEN = 0.55;
/** Each shard's length, as a share of the spec's. */
const SHATTER_SHARD_SIZE = { min: 0.6, spread: 0.6 } as const;
const SHATTER_DUST_RADIUS = 20;
const SHATTER_DUST_GROWTH = 14;
const SHATTER_DUST_ALPHA = 0.5;
const SHATTER_FADE_START = 0.6;

/**
 * The break: shards thrown up and out from the piece's mass and falling back,
 * over a dust cloud that swells and thins. `progress` runs 0 to 1 across the
 * frames; the remains are drawn underneath by the caller.
 */
export function paintShatter(
  ctx: Ctx,
  cx: number,
  cy: number,
  progress: number,
  spec: ShatterSpec,
  rng: Rng,
): void {
  const dustAlpha = SHATTER_DUST_ALPHA * (1 - progress);
  dustPuff(
    ctx,
    cx,
    cy,
    SHATTER_DUST_RADIUS + spec.halfWidth + SHATTER_DUST_GROWTH * progress,
    spec.dustRgb,
    dustAlpha,
  );
  const fade =
    progress < SHATTER_FADE_START
      ? 1
      : 1 - (progress - SHATTER_FADE_START) / (1 - SHATTER_FADE_START);
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  for (let index = 0; index < spec.shardCount; index++) {
    const angle = rng() * TWO_PI;
    const speed = SHATTER_SPEED.min + rng() * SHATTER_SPEED.spread;
    const originX = cx + (rng() - HALF) * 2 * spec.halfWidth;
    const distance = spec.spread * speed * progress;
    const lift = SHATTER_RISE * Math.sin(progress * Math.PI) * speed;
    const x = originX + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * SHATTER_FLATTEN - lift;
    const shade = spec.shades[Math.floor(rng() * spec.shades.length)] ?? spec.edge;
    shard(
      ctx,
      x,
      y,
      spec.shardLength * (SHATTER_SHARD_SIZE.min + rng() * SHATTER_SHARD_SIZE.spread),
      spec.shardWidth,
      angle + progress * (rng() - HALF) * TWO_PI,
      shade,
      spec.edge,
    );
  }
  ctx.restore();
}
