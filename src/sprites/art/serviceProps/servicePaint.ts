/**
 * The service level's shared paint: its cold palette, and the one box every
 * piece of its furniture is built from.
 *
 * Floor 2 is institutional — painted steel, plastic, laminate, concrete dust —
 * so every ramp here is cool and a little desaturated, and the only warm
 * colours are the safety yellows and the boiler's fire. Every box takes the
 * same key light as the cellar props: a lit top, a front in mid-tone that
 * darkens towards the floor, and a crisp highlight on the front-top edge.
 */

import { type Ctx, verticalRamp } from '../propPaint';

/** One painted surface's values, lit top to shadowed foot. */
export interface SurfaceRamp {
  /** The top face, which takes the key light square on. */
  readonly top: string;
  /** The front face just under its lit edge. */
  readonly frontHigh: string;
  /** The front face at the floor. */
  readonly frontLow: string;
  /** The highlight along the front-top edge. */
  readonly edge: string;
  /** The silhouette line round the whole box. */
  readonly outline: string;
}

export const LOCKER_STEEL: SurfaceRamp = {
  top: '#8d9ea2',
  frontHigh: '#647a80',
  frontLow: '#3f4f55',
  edge: '#a9babd',
  outline: '#1c2427',
};

export const CABINET_STEEL: SurfaceRamp = {
  top: '#a39f92',
  frontHigh: '#878275',
  frontLow: '#5d5a51',
  edge: '#bdb8aa',
  outline: '#26241f',
};

export const VENDING_SHELL: SurfaceRamp = {
  top: '#7a3a36',
  frontHigh: '#5e2a28',
  frontLow: '#3c1a19',
  edge: '#9a5650',
  outline: '#1a0b0a',
};

export const DESK_STEEL: SurfaceRamp = {
  top: '#8a8a82',
  frontHigh: '#6a6c66',
  frontLow: '#474a46',
  edge: '#a3a49b',
  outline: '#1f211f',
};

export const DESK_LAMINATE: SurfaceRamp = {
  top: '#a39b86',
  frontHigh: '#7f7867',
  frontLow: '#615b4d',
  edge: '#bdb59e',
  outline: '#26231c',
};

export const MONITOR_PLASTIC: SurfaceRamp = {
  top: '#b9b3a0',
  frontHigh: '#a29c89',
  frontLow: '#7a7566',
  edge: '#d0cab6',
  outline: '#2a2820',
};

export const BOILER_IRON: SurfaceRamp = {
  top: '#5e6a62',
  frontHigh: '#4a5650',
  frontLow: '#2c3430',
  edge: '#7d8a80',
  outline: '#121614',
};

export const PALLET_WOOD: SurfaceRamp = {
  top: '#b39a72',
  frontHigh: '#8e7754',
  frontLow: '#6a5639',
  edge: '#c9b28a',
  outline: '#2e2416',
};

export const BENCH_WOOD: SurfaceRamp = {
  top: '#a3825a',
  frontHigh: '#7d613f',
  frontLow: '#5b452b',
  edge: '#bf9c6e',
  outline: '#2a1e12',
};

export const SAFETY_YELLOW: SurfaceRamp = {
  top: '#d8b843',
  frontHigh: '#bf9d2c',
  frontLow: '#8d711b',
  edge: '#ead27a',
  outline: '#2e250a',
};

export const CYLINDER_PAINT: SurfaceRamp = {
  top: '#9a4a3c',
  frontHigh: '#7f3a2f',
  frontLow: '#55241d',
  edge: '#b9685a',
  outline: '#1f0c09',
};

/** Unlit steel for handles, legs, hinges and frames. */
export const BARE_STEEL = { dark: '#2e3438', mid: '#5c656b', light: '#9aa3a8' } as const;
/** An opening into the dark inside a box. */
export const CAVITY = '#0f1214';
/** Rust, as a streak or a bloom; always laid on at partial alpha. */
export const RUST = '#7a4a2a';
/** Concrete dust thrown up by a break, as an rgb triple for `puff`. */
export const CONCRETE_DUST_RGB = [150, 152, 148] as const;

/** Where the front face of a box ends: the fraction of the front height its lit band holds. */
const FRONT_LIT_STOP = 0.12;
const OUTLINE_WIDTH = 1.2;
const EDGE_HIGHLIGHT_WIDTH = 1.4;
/** How much of a box's top face, from its back edge, falls into the wall's shade. */
const TOP_BACK_SHADE_FRACTION = 0.35;
const TOP_BACK_SHADE_ALPHA = 0.18;

/** A box in the floor's three-quarter view: its front face, and its top face straight above it. */
export interface BoxGeometry {
  readonly left: number;
  readonly right: number;
  /** The front face's foot, where it meets the floor. */
  readonly baseY: number;
  /** Front face height. */
  readonly height: number;
  /** Top face depth, drawn straight up from the front face's top edge. */
  readonly depth: number;
}

/** The front face's top edge. */
export function boxFrontTop(box: BoxGeometry): number {
  return box.baseY - box.height;
}

/** The top face's back edge. */
export function boxBackTop(box: BoxGeometry): number {
  return box.baseY - box.height - box.depth;
}

/** Paints a lit box: the top, the front ramp, the lit front-top edge and the outline. */
export function paintBox(ctx: Ctx, box: BoxGeometry, ramp: SurfaceRamp): void {
  const frontTop = boxFrontTop(box);
  const backTop = boxBackTop(box);
  const width = box.right - box.left;

  ctx.save();
  ctx.fillStyle = ramp.top;
  ctx.fillRect(box.left, backTop, width, box.depth);
  ctx.globalAlpha = TOP_BACK_SHADE_ALPHA;
  ctx.fillStyle = ramp.outline;
  ctx.fillRect(box.left, backTop, width, box.depth * TOP_BACK_SHADE_FRACTION);
  ctx.restore();

  ctx.fillStyle = verticalRamp(ctx, box.left, frontTop, box.baseY, [
    [0, ramp.frontHigh],
    [FRONT_LIT_STOP, ramp.frontHigh],
    [1, ramp.frontLow],
  ]);
  ctx.fillRect(box.left, frontTop, width, box.height);

  ctx.save();
  ctx.strokeStyle = ramp.edge;
  ctx.lineWidth = EDGE_HIGHLIGHT_WIDTH;
  ctx.beginPath();
  ctx.moveTo(box.left + 1, frontTop);
  ctx.lineTo(box.right - 1, frontTop);
  ctx.stroke();
  ctx.strokeStyle = ramp.outline;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.strokeRect(box.left, backTop, width, box.baseY - backTop);
  ctx.restore();
}

/** A filled rectangle at partial alpha: a stain, a shadow, a scuff. */
export function wash(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** A short straight line. */
export function line(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: string,
  width: number,
): void {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

const DENT_HIGHLIGHT_ALPHA = 0.35;
const DENT_SHADOW_ALPHA = 0.4;
const DENT_SHADOW_OFFSET_FRACTION = 0.35;
/** The lit crescent is smaller than the shadowed one: the dent's lower lip catches less of it. */
const DENT_HIGHLIGHT_RX_FRACTION = 0.8;
const DENT_HIGHLIGHT_RY_FRACTION = 0.6;

/**
 * A dent pressed into a steel face: a crescent of shadow on its upper side,
 * where the key light no longer reaches, and a lit crescent below it.
 */
export function dent(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.save();
  ctx.globalAlpha = DENT_SHADOW_ALPHA;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * DENT_SHADOW_OFFSET_FRACTION, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = DENT_HIGHLIGHT_ALPHA;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + ry * DENT_SHADOW_OFFSET_FRACTION,
    rx * DENT_HIGHLIGHT_RX_FRACTION,
    ry * DENT_HIGHLIGHT_RY_FRACTION,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

const RUST_STREAK_ALPHA = 0.32;
const RUST_STREAK_WIDTH = 2;

/** A run of rust down a face from a seam or a vent. */
export function rustStreak(ctx: Ctx, x: number, y0: number, length: number): void {
  ctx.save();
  const g = ctx.createLinearGradient(x, y0, x, y0 + length);
  g.addColorStop(0, RUST);
  g.addColorStop(1, 'rgba(122,74,42,0)');
  ctx.globalAlpha = RUST_STREAK_ALPHA;
  ctx.fillStyle = g;
  ctx.fillRect(x - RUST_STREAK_WIDTH / 2, y0, RUST_STREAK_WIDTH, length);
  ctx.restore();
}
