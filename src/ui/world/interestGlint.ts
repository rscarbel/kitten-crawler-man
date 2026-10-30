/**
 * The quiet tells that something in a room can be worked: a sheen that
 * catches the light now and then on a thing that can be batted off or rung,
 * and a soft pool of light on a floor fitting that can be weighed down. Never
 * a marker or a glyph: the room looks lived in, and the eye still goes there.
 * One family for every such thing, so the player learns it once.
 */

import { worldPalette } from '../theme/worldInk';

/** One twinkle every this many milliseconds, lasting this share of it. */
const GLINT_PERIOD_MS = 2600;
const GLINT_FLASH_SHARE = 0.18;
/** The star's arm length at the height of a twinkle, and the halo's radius, in pixels. */
const GLINT_ARM_PX = 7;
const GLINT_ARM_WIDTH_PX = 1.4;
const GLINT_HALO_PX = 6;
/** The speck of light it keeps between twinkles, so it can be found by looking. */
const GLINT_REST_RADIUS_PX = 1.6;
const GLINT_REST_ALPHA = 0.6;
/** How far apart two glints' twinkles fall, as a share of the period, per step of `seed`. */
const GLINT_SEED_PHASE_STEP = 0.37;

/** The pool of light breathes once every this many milliseconds, between these strengths. */
const POOL_BREATH_PERIOD_MS = 3200;
const POOL_MIN_ALPHA = 0.7;
/** How far out the pool holds its full light before it fades, as a share of its radius. */
const POOL_PLATEAU_SHARE = 0.5;
/** A pool is an ellipse on the floor this much flatter than it is wide. */
const POOL_FLATTEN = 0.55;

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
/** A diagonal arm of the star, as a share of a straight one. */
const DIAGONAL_ARM_SHARE = 0.45;

interface InterestGlintOptions {
  /** The point the sheen sits on, in canvas pixels. */
  readonly x: number;
  readonly y: number;
  readonly nowMs: number;
  /** Staggers this glint's twinkle against its neighbours'. */
  readonly seed: number;
}

/** How far through its twinkle a glint is: 0 at rest, rising to 1 and back. */
function twinkle(nowMs: number, seed: number): number {
  const share = (nowMs / GLINT_PERIOD_MS + seed * GLINT_SEED_PHASE_STEP) % 1;
  if (share >= GLINT_FLASH_SHARE) return 0;
  return Math.sin((share / GLINT_FLASH_SHARE) * Math.PI);
}

/** Paints a sheen that rests as a speck and now and then flares into a small four-point star. */
export function drawInterestGlint(ctx: CanvasRenderingContext2D, opts: InterestGlintOptions): void {
  const ink = worldPalette.mechanism;
  const flare = twinkle(opts.nowMs, opts.seed);
  ctx.save();
  if (flare > 0) {
    const halo = ctx.createRadialGradient(opts.x, opts.y, 0, opts.x, opts.y, GLINT_HALO_PX);
    halo.addColorStop(0, ink.glintHalo);
    halo.addColorStop(1, ink.glintFade);
    ctx.globalAlpha = flare;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(opts.x, opts.y, GLINT_HALO_PX, 0, FULL_TURN);
    ctx.fill();
    const arm = GLINT_ARM_PX * flare;
    const diagonal = arm * DIAGONAL_ARM_SHARE;
    ctx.strokeStyle = ink.glintCore;
    ctx.lineWidth = GLINT_ARM_WIDTH_PX;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(opts.x - arm, opts.y);
    ctx.lineTo(opts.x + arm, opts.y);
    ctx.moveTo(opts.x, opts.y - arm);
    ctx.lineTo(opts.x, opts.y + arm);
    ctx.moveTo(opts.x - diagonal, opts.y - diagonal);
    ctx.lineTo(opts.x + diagonal, opts.y + diagonal);
    ctx.moveTo(opts.x - diagonal, opts.y + diagonal);
    ctx.lineTo(opts.x + diagonal, opts.y - diagonal);
    ctx.stroke();
  }
  ctx.globalAlpha = Math.max(GLINT_REST_ALPHA, flare);
  ctx.fillStyle = ink.glintCore;
  ctx.beginPath();
  ctx.arc(opts.x, opts.y, GLINT_REST_RADIUS_PX, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

interface InterestPoolOptions {
  /** The pool's centre on the floor, in canvas pixels. */
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  readonly nowMs: number;
}

/** Paints a soft, slowly breathing pool of light on the floor. */
export function drawInterestPool(ctx: CanvasRenderingContext2D, opts: InterestPoolOptions): void {
  const ink = worldPalette.mechanism;
  const breath = HALF - HALF * Math.cos((opts.nowMs / POOL_BREATH_PERIOD_MS) * FULL_TURN);
  ctx.save();
  ctx.translate(opts.x, opts.y);
  ctx.scale(1, POOL_FLATTEN);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, opts.radiusPx);
  pool.addColorStop(0, ink.poolCore);
  pool.addColorStop(POOL_PLATEAU_SHARE, ink.poolCore);
  pool.addColorStop(1, ink.poolFade);
  ctx.globalAlpha = POOL_MIN_ALPHA + (1 - POOL_MIN_ALPHA) * breath;
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(0, 0, opts.radiusPx, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}
