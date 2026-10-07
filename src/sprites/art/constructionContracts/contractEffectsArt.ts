/**
 * The two live, uncached contract effects: the glow under the spot in reach, and
 * the dust puff and timber sheen when a spot is finished. Both are stateless
 * painters driven by a clock the caller owns.
 */

import { fillSoftEllipse } from '../softShade';
import { worldPalette } from '../../../ui/theme/worldInk';
import { rgba } from '../town/townArt';
import type { RGB } from '../town/townPalette';

type Ctx = CanvasRenderingContext2D;

/** A spot's rectangle on screen, in pixels. */
export interface ContractRectPx {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// ── Reach glow ────────────────────────────────────────────────────────────────

/** The pasture fence's and the sawmill's reach glow, so every build job in the village marks itself the same way. */
const REACH_GLOW_COLOR = worldPalette.village.reachGlow;
/** Matches `PastureFenceWork`'s pulse: `sin(ms / 700)`. */
const REACH_GLOW_PULSE_PERIOD_SECONDS = 0.7;
const REACH_GLOW_PULSE_MIN = 0.35;
const REACH_GLOW_PULSE_RANGE = 0.4;
const REACH_GLOW_LINE_WIDTH = 2;
const REACH_GLOW_FILL_ALPHA = 0.22;
const REACH_GLOW_EDGE_ALPHA = 0.55;
/** The ellipse runs this share of the spot's smaller side past its edges, so a one-tile spot still gets a readable ring. */
const GLOW_PAD_SHARE = 0.18;
/** Ground-plane perspective: the vertical pad is squashed like the fence's ellipse. */
const GLOW_GROUND_SQUASH = 0.55;
const SINE_TO_UNIT_SCALE = 0.5;
const SINE_TO_UNIT_OFFSET = 0.5;

/** Draws the pulsing glow under the contract spot a press would work. */
export function drawContractSpotGlow(ctx: Ctx, rectPx: ContractRectPx, timeSeconds: number): void {
  const wave =
    SINE_TO_UNIT_OFFSET +
    SINE_TO_UNIT_SCALE * Math.sin(timeSeconds / REACH_GLOW_PULSE_PERIOD_SECONDS);
  const pulse = REACH_GLOW_PULSE_MIN + REACH_GLOW_PULSE_RANGE * wave;
  const pad = Math.min(rectPx.w, rectPx.h) * GLOW_PAD_SHARE;
  const radiusX = rectPx.w / 2 + pad;
  const radiusY = rectPx.h / 2 + pad * GLOW_GROUND_SQUASH;
  ctx.save();
  ctx.fillStyle = REACH_GLOW_COLOR;
  ctx.strokeStyle = REACH_GLOW_COLOR;
  ctx.lineWidth = REACH_GLOW_LINE_WIDTH;
  ctx.beginPath();
  ctx.ellipse(
    rectPx.x + rectPx.w / 2,
    rectPx.y + rectPx.h / 2,
    radiusX,
    radiusY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.globalAlpha = pulse * REACH_GLOW_FILL_ALPHA;
  ctx.fill();
  ctx.globalAlpha = pulse * REACH_GLOW_EDGE_ALPHA;
  ctx.stroke();
  ctx.restore();
}

// ── Finish puff ───────────────────────────────────────────────────────────────

/** How long a finished spot's dust and sheen last. */
export const CONTRACT_FINISH_PUFF_SECONDS = 0.5;

const DUST: RGB = [214, 200, 170];
/** Warm, pale new-timber light. */
const SHEEN: RGB = [255, 236, 190];

/**
 * Where the dust clouds sit, as shares of the spot's rectangle, and which
 * way each drifts. Fixed rather than seeded: the painter is stateless and a
 * puff lasts half a second, too short for its layout to repeat noticeably.
 */
const PUFFS = [
  { x: 0.12, y: 0.92, driftX: -0.5 },
  { x: 0.34, y: 1, driftX: -0.2 },
  { x: 0.58, y: 0.96, driftX: 0.15 },
  { x: 0.84, y: 0.94, driftX: 0.5 },
  { x: 0.48, y: 0.7, driftX: 0 },
] as const;
const PUFF_START_RADIUS_SHARE = 0.3;
const PUFF_GROWTH_SHARE = 0.3;
/** Dust billows up over the first part of the puff rather than appearing at full strength. */
const PUFF_RAMP_IN_SHARE = 0.15;
/** Puff radius is a share of the rectangle's smaller side, capped so a long wall run does not raise clouds a tile wide. */
const PUFF_RADIUS_CAP_PX = 22;
const PUFF_RISE_SHARE = 0.25;
const PUFF_DRIFT_SHARE = 0.3;
const PUFF_ALPHA = 0.6;
const PUFF_FADE_POWER = 1.6;
const PUFF_SQUASH = 0.75;
const SHEEN_PEAK_ALPHA = 0.42;
/** The sheen's band sweeps across the rectangle in the first part of the puff and is gone well before the dust. */
const SHEEN_SWEEP_SHARE = 0.75;
const SHEEN_BAND_SHARE = 0.35;
/** The sheen leans like light through a window: upper left to lower right. */
const SHEEN_LEAN_SHARE = 0.5;

/**
 * Draws a finished spot's dust puff and fresh-timber sheen `ageSeconds` after
 * it finished. Draws nothing once the puff is over. `standingHeightPx` is how
 * far the finished thing rises above its footprint — a prop's height — so the
 * sheen crosses the prop and not just the floor it stands on; leave it 0 for
 * a floor.
 */
export function drawContractFinishPuff(
  ctx: Ctx,
  rectPx: ContractRectPx,
  ageSeconds: number,
  standingHeightPx = 0,
): void {
  if (ageSeconds < 0 || ageSeconds >= CONTRACT_FINISH_PUFF_SECONDS) return;
  const t = ageSeconds / CONTRACT_FINISH_PUFF_SECONDS;
  drawSheen(
    ctx,
    { x: rectPx.x, y: rectPx.y - standingHeightPx, w: rectPx.w, h: rectPx.h + standingHeightPx },
    t,
  );
  const fade = Math.min(1, t / PUFF_RAMP_IN_SHARE) * Math.pow(1 - t, PUFF_FADE_POWER);
  const base = Math.min(PUFF_RADIUS_CAP_PX, Math.min(rectPx.w, rectPx.h));
  const radius = base * (PUFF_START_RADIUS_SHARE + PUFF_GROWTH_SHARE * t);
  for (const puff of PUFFS) {
    const cx = rectPx.x + rectPx.w * puff.x + puff.driftX * base * PUFF_DRIFT_SHARE * t;
    const cy = rectPx.y + rectPx.h * puff.y - base * PUFF_RISE_SHARE * t;
    fillSoftEllipse(ctx, cx, cy, radius, radius * PUFF_SQUASH, rgba(DUST, 1), PUFF_ALPHA * fade);
  }
}

function drawSheen(ctx: Ctx, rectPx: ContractRectPx, t: number): void {
  if (t >= SHEEN_SWEEP_SHARE) return;
  const progress = t / SHEEN_SWEEP_SHARE;
  const strength = SHEEN_PEAK_ALPHA * Math.sin(progress * Math.PI);
  const band = rectPx.w * SHEEN_BAND_SHARE;
  const lean = rectPx.h * SHEEN_LEAN_SHARE;
  const travel = rectPx.w + band * 2 + lean;
  const centre = rectPx.x - band - lean + travel * progress;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rectPx.x, rectPx.y, rectPx.w, rectPx.h);
  ctx.clip();
  const gradient = ctx.createLinearGradient(
    centre - band,
    rectPx.y,
    centre + band + lean,
    rectPx.y + rectPx.h,
  );
  gradient.addColorStop(0, rgba(SHEEN, 0));
  gradient.addColorStop(1 / 2, rgba(SHEEN, strength));
  gradient.addColorStop(1, rgba(SHEEN, 0));
  ctx.fillStyle = gradient;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillRect(rectPx.x, rectPx.y, rectPx.w, rectPx.h);
  ctx.restore();
}
