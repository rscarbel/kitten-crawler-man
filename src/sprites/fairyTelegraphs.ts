/**
 * The fire fairy's ground warnings: the red circle over everything a fireball,
 * a burning fuse or a dying fairy's flames will reach, and the reticle that
 * marks where a ball is still coming down.
 *
 * Kept apart from the fairies' effect art (`art/fairyEffectsArt.ts`) because
 * every ground warning is red: this file is held to the theme by
 * `check:ui-style`, and its only ink is `GROUND_WARNING_INK`. The fire itself
 * keeps its own colours over the warning.
 */

import { GROUND_WARNING_INK } from '../ui/theme/worldInk';
import { withAlpha } from '../ui/theme/color';
import { drawDangerCircle } from './dangerTelegraph';

const TAU = Math.PI * 2;
const HALF = 0.5;

/** Each warning is fixed the moment it appears, so it is drawn at full strength. */
const WARNING_FADE = 1;

/**
 * Where a blast will land, or where the flames will burst: the shared red
 * circle at the full reach, locked because nothing moves it once it is down,
 * its fill growing to the outline as `progress` runs 0 → 1 to the hit.
 */
export function drawFireBlastWarning(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  progress: number,
): void {
  drawDangerCircle(ctx, cx, cy, radiusPx, WARNING_FADE, { fillProgress: progress, locked: true });
}

/** The reticle lies flat on the floor, seen at a slight tilt. */
const RETICLE_GROUND_SQUASH = 0.62;
/** The brackets start this much wider than the landing radius and close in as the lock completes. */
const RETICLE_BRACKET_START_SCALE = 1.35;
const RETICLE_BRACKET_CLOSE_SCALE = 0.35;
const RETICLE_SPIN_SPEED = 0.03;
const RETICLE_PULSE_SPEED_BASE = 0.2;
const RETICLE_PULSE_SPEED_LOCK = 0.4;
const RETICLE_FILL_ALPHA_BASE = 0.08;
const RETICLE_FILL_ALPHA_LOCK = 0.12;
const RETICLE_BRACKET_COUNT = 4;
/** Each bracket's own arc length, radians, and the gap that opens it from the last one's end. */
const RETICLE_BRACKET_SWEEP = 0.7;
const RETICLE_BRACKET_GAP = 0.35;
const RETICLE_BRACKET_WIDTH_PX = 2;
const RETICLE_BRACKET_ALPHA_BASE = 0.55;
const RETICLE_BRACKET_ALPHA_LOCK = 0.35;
const RETICLE_CROSS_ALPHA_BASE = 0.4;
const RETICLE_CROSS_ALPHA_LOCK = 0.5;
const RETICLE_CROSS_WIDTH_PX = 1;
const RETICLE_CROSS_REACH_SHARE = 0.35;

/**
 * The small reticle on the ground where a fire fairy has locked its throw.
 * Four brackets close in and spin slowly as `progress` (0 → 1 through the lock
 * and the flight) nears the landing, so the time left is readable at a glance.
 */
export function drawLandingReticle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  progress: number,
  frame: number,
): void {
  const p = Math.min(1, Math.max(0, progress));
  const radius = radiusPx * (RETICLE_BRACKET_START_SCALE - RETICLE_BRACKET_CLOSE_SCALE * p);
  const spin = frame * RETICLE_SPIN_SPEED;
  const pulse =
    HALF + HALF * Math.sin(frame * (RETICLE_PULSE_SPEED_BASE + RETICLE_PULSE_SPEED_LOCK * p));
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, radiusPx, radiusPx * RETICLE_GROUND_SQUASH, 0, 0, TAU);
  ctx.fillStyle = withAlpha(
    GROUND_WARNING_INK.fill,
    RETICLE_FILL_ALPHA_BASE + RETICLE_FILL_ALPHA_LOCK * p,
  );
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineWidth = RETICLE_BRACKET_WIDTH_PX;
  ctx.strokeStyle = withAlpha(
    GROUND_WARNING_INK.outline,
    RETICLE_BRACKET_ALPHA_BASE + RETICLE_BRACKET_ALPHA_LOCK * pulse,
  );
  for (let i = 0; i < RETICLE_BRACKET_COUNT; i++) {
    const start = spin + (i / RETICLE_BRACKET_COUNT) * TAU - RETICLE_BRACKET_GAP;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy,
      radius,
      radius * RETICLE_GROUND_SQUASH,
      0,
      start,
      start + RETICLE_BRACKET_SWEEP,
    );
    ctx.stroke();
  }
  ctx.strokeStyle = withAlpha(
    GROUND_WARNING_INK.lockedCore,
    RETICLE_CROSS_ALPHA_BASE + RETICLE_CROSS_ALPHA_LOCK * p,
  );
  ctx.lineWidth = RETICLE_CROSS_WIDTH_PX;
  const cross = radiusPx * RETICLE_CROSS_REACH_SHARE;
  ctx.beginPath();
  ctx.moveTo(cx - cross, cy);
  ctx.lineTo(cx + cross, cy);
  ctx.moveTo(cx, cy - cross * RETICLE_GROUND_SQUASH);
  ctx.lineTo(cx, cy + cross * RETICLE_GROUND_SQUASH);
  ctx.stroke();
  ctx.restore();
}
