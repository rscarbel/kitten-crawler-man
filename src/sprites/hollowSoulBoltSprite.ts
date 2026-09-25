/**
 * The necromancer's soul bolt and its burst, in the hollow-blue ramp.
 *
 * Drawn at runtime from `hollowSoulPalette` rather than baked: a volley is
 * three small glows on screen for a second or two, and the lich's green bolt
 * figure cannot be recoloured without a filter pass per draw. Built the way
 * the green bolt reads — a near-white core inside a saturated body with no
 * hard edge — so the two are one substance in two colours, and a player can
 * tell which caster loosed a bolt from its colour alone.
 */

import { hollowSoulPalette, soulRgba } from './soulPalette';

const TWO_PI = Math.PI * 2;
const { core, mid, deep } = hollowSoulPalette;

/** The bolt's glow radius, as a share of the tile. */
const BOLT_GLOW_RADIUS = 0.3;
/** Its bright core, as a share of the glow. */
const BOLT_CORE_SHARE = 0.35;
/** How far the glow breathes in and out, as a share of its radius, and how fast (radians per frame). */
const BOLT_PULSE_DEPTH = 0.12;
const BOLT_PULSE_RATE = 0.35;
const BOLT_GLOW_ALPHA = 0.85;
const BOLT_MID_STOP = 0.45;

/** The burst's reach at its widest, as a share of the tile, and the share it opens at. */
const BURST_RADIUS = 0.7;
const BURST_START = 0.3;
const BURST_ALPHA = 0.8;

/** A hollow soul bolt in flight, centred on (sx, sy). `age` is its age in game frames. */
export function drawHollowSoulBolt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  age: number,
): void {
  const breathe = 1 + Math.sin(age * BOLT_PULSE_RATE) * BOLT_PULSE_DEPTH;
  const radius = tileSize * BOLT_GLOW_RADIUS * breathe;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
  glow.addColorStop(0, soulRgba(core, 1));
  glow.addColorStop(BOLT_CORE_SHARE, soulRgba(mid, BOLT_GLOW_ALPHA));
  glow.addColorStop(
    BOLT_MID_STOP + BOLT_CORE_SHARE,
    soulRgba(deep, BOLT_GLOW_ALPHA * BOLT_MID_STOP),
  );
  glow.addColorStop(1, soulRgba(deep, 0));
  ctx.save();
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** The burst where one lands, centred on (sx, sy). `progress` runs 0 → 1 over its life. */
export function drawHollowSoulBurst(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  const t = Math.max(0, Math.min(1, progress));
  const radius = tileSize * BURST_RADIUS * (BURST_START + (1 - BURST_START) * t);
  const fade = 1 - t;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
  glow.addColorStop(0, soulRgba(core, BURST_ALPHA * fade));
  glow.addColorStop(BOLT_MID_STOP, soulRgba(mid, BURST_ALPHA * fade * BOLT_MID_STOP));
  glow.addColorStop(1, soulRgba(deep, 0));
  ctx.save();
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}
