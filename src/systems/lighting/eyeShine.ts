/**
 * The two glints a creature's eyes throw back out of the dark, shared by every
 * scene that darkens its world: the dungeon's lighting and the prison's.
 */

import { TILE_SIZE } from '../../core/constants';
import { drawRadialGlow } from '../../sprites/radialGlow';
import { EYE_COLOR, EYE_GLOW_STOPS } from '../../sprites/nurserySprites';

const EYE_SHINE_DOT_RADIUS = 0.035;
const EYE_SHINE_GLOW_RADIUS = 0.22;
const EYE_BLINK_PERIOD_MS = 3700;
/** The share of each blink period the eyes are shut. */
const EYE_BLINK_SHUT_SHARE = 0.06;
/** Spreads blink phases so a pack does not blink in unison. */
const EYE_BLINK_SEED_STEP = 0.37;
const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

/** An eye's glint at full strength. */
const EYE_SHINE_FILL = `${EYE_COLOR}1)`;

/** Whether eyes with blink seed `seed` are open at `nowMs`; any small integer per creature. */
export function eyesOpenAt(nowMs: number, seed: number): boolean {
  const blink = (((nowMs / EYE_BLINK_PERIOD_MS + seed * EYE_BLINK_SEED_STEP) % 1) + 1) % 1;
  return blink >= EYE_BLINK_SHUT_SHARE;
}

/** Paints a pair of eye glints centred on (`cx`, `cy`), `spacingPx` apart, in screen pixels. */
export function drawEyePair(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spacingPx: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawRadialGlow(ctx, cx, cy, TILE_SIZE * EYE_SHINE_GLOW_RADIUS, EYE_GLOW_STOPS);
  ctx.restore();
  ctx.fillStyle = EYE_SHINE_FILL;
  const radius = TILE_SIZE * EYE_SHINE_DOT_RADIUS;
  const halfSpacing = spacingPx * HALF;
  ctx.beginPath();
  ctx.arc(cx - halfSpacing, cy, radius, 0, FULL_TURN);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + halfSpacing, cy, radius, 0, FULL_TURN);
  ctx.fill();
}
