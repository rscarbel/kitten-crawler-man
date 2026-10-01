import { frameTime } from '../../utils';
import { drawRadialGlow, type GlowStop } from '../../sprites/radialGlow';
import { paintSoulCrystalBody, soulCrystalHeartbeat } from '../../sprites/soulCrystalArt';

/**
 * Carl's Doomsday Scenario: the city's soul crystal, sealed under an enchanted
 * glass dome on a brass plinth.
 *
 * The crystal is painted by the same body painter as the one hovering in the
 * magistrate's office, so the thing in the bag is visibly the thing the party
 * walked to. It dominates the cell — it is a city-levelling relic, and a small
 * gem in a big box read as a trinket — and the dome is only a rim of light and
 * one reflection, enough to say "contained" without hiding what is inside.
 */

const FULL_CIRCLE = Math.PI * 2;
const MIN_LINE_WIDTH = 1;

const HALO_STOPS: readonly GlowStop[] = [
  { offset: 0, color: 'rgba(235, 150, 255, 0.95)' },
  { offset: 0.5, color: 'rgba(168, 70, 240, 0.4)' },
  { offset: 1, color: 'rgba(110, 30, 200, 0)' },
];
const HALO_CX = 0.5;
const HALO_CY = 0.46;
const HALO_RADIUS = 0.46;
const HALO_ALPHA_BASE = 0.6;
const HALO_ALPHA_SWING = 0.4;

const CRYSTAL_CX = 0.5;
const CRYSTAL_CY = 0.44;
const CRYSTAL_HEIGHT = 0.72;
const CRYSTAL_BOB = 0.02;
const CRYSTAL_BOB_HZ = 0.5;

// Plinth: a brass drum the dome sits in.
const PLINTH_TOP_Y = 0.83;
const PLINTH_BOTTOM_Y = 0.93;
const PLINTH_HALF_WIDTH = 0.33;
const PLINTH_FOOT_HALF_WIDTH = 0.4;
const PLINTH_RIM_RY = 0.04;
const PLINTH_FACE = '#a16207';
const PLINTH_LIT = '#facc15';
const PLINTH_SHADE = '#713f12';
const PLINTH_OUTLINE = '#2b1505';
/** Where the plinth's shaded right side begins, as a fraction of its half-width. */
const PLINTH_SHADE_START = 0.35;

// Dome: a bell jar rising from the plinth's rim.
const DOME_HALF_WIDTH = 0.3;
const DOME_SHOULDER_Y = 0.3;
const DOME_TOP_Y = 0.0;
const DOME_EDGE_COLOR = 'rgba(224, 242, 254, 0.55)';
const DOME_FILL_COLOR = 'rgba(120, 40, 200, 0.18)';
const DOME_REFLECTION_COLOR = 'rgba(255, 255, 255, 0.6)';
const DOME_REFLECTION_X = 0.25;
const DOME_REFLECTION_TOP_Y = 0.3;
const DOME_REFLECTION_BOTTOM_Y = 0.62;
const DOME_REFLECTION_WIDTH = 0.04;
const DOME_EDGE_WIDTH = 0.03;
const PLINTH_OUTLINE_WIDTH = 0.035;

function traceDome(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const left = x + size * (HALO_CX - DOME_HALF_WIDTH);
  const right = x + size * (HALO_CX + DOME_HALF_WIDTH);
  const base = y + size * PLINTH_TOP_Y;
  const shoulder = y + size * DOME_SHOULDER_Y;
  const top = y + size * DOME_TOP_Y;
  ctx.beginPath();
  ctx.moveTo(left, base);
  ctx.lineTo(left, shoulder);
  ctx.bezierCurveTo(left, top, right, top, right, shoulder);
  ctx.lineTo(right, base);
}

function drawPlinth(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size * HALO_CX;
  const top = y + size * PLINTH_TOP_Y;
  const bottom = y + size * PLINTH_BOTTOM_Y;
  const topHalf = size * PLINTH_HALF_WIDTH;
  const footHalf = size * PLINTH_FOOT_HALF_WIDTH;
  const rimRy = size * PLINTH_RIM_RY;

  ctx.beginPath();
  ctx.moveTo(cx - topHalf, top);
  ctx.lineTo(cx - footHalf, bottom);
  ctx.lineTo(cx + footHalf, bottom);
  ctx.lineTo(cx + topHalf, top);
  ctx.closePath();
  ctx.strokeStyle = PLINTH_OUTLINE;
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH, size * PLINTH_OUTLINE_WIDTH) * 2;
  ctx.stroke();
  ctx.fillStyle = PLINTH_FACE;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx + topHalf * PLINTH_SHADE_START, top);
  ctx.lineTo(cx + footHalf * PLINTH_SHADE_START, bottom);
  ctx.lineTo(cx + footHalf, bottom);
  ctx.lineTo(cx + topHalf, top);
  ctx.closePath();
  ctx.fillStyle = PLINTH_SHADE;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx, top, topHalf, rimRy, 0, 0, FULL_CIRCLE);
  ctx.fillStyle = PLINTH_LIT;
  ctx.fill();
  ctx.strokeStyle = PLINTH_OUTLINE;
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH, size * PLINTH_OUTLINE_WIDTH);
  ctx.stroke();
}

/**
 * Paints the icon at an explicit time, for harnesses that sample the animation.
 * The game calls {@link drawSoulCrystalIcon}, which reads the shared frame clock.
 */
export function paintSoulCrystalIconAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  timeS: number,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha *= alpha;

  const beat = soulCrystalHeartbeat(timeS);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha *= HALO_ALPHA_BASE + HALO_ALPHA_SWING * beat;
  drawRadialGlow(ctx, x + size * HALO_CX, y + size * HALO_CY, size * HALO_RADIUS, HALO_STOPS);
  ctx.restore();

  traceDome(ctx, x, y, size);
  ctx.closePath();
  ctx.fillStyle = DOME_FILL_COLOR;
  ctx.fill();

  const bob = Math.sin(timeS * FULL_CIRCLE * CRYSTAL_BOB_HZ) * CRYSTAL_BOB;
  paintSoulCrystalBody(
    ctx,
    x + size * CRYSTAL_CX,
    y + size * (CRYSTAL_CY + bob),
    size * CRYSTAL_HEIGHT,
    timeS,
  );

  traceDome(ctx, x, y, size);
  ctx.strokeStyle = DOME_EDGE_COLOR;
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH, size * DOME_EDGE_WIDTH);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + size * DOME_REFLECTION_X, y + size * DOME_REFLECTION_TOP_Y);
  ctx.lineTo(x + size * DOME_REFLECTION_X, y + size * DOME_REFLECTION_BOTTOM_Y);
  ctx.strokeStyle = DOME_REFLECTION_COLOR;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH, size * DOME_REFLECTION_WIDTH);
  ctx.stroke();

  drawPlinth(ctx, x, y, size);
  ctx.restore();
}

/** Draws Carl's Doomsday Scenario in an inventory or hotbar cell. */
export function drawSoulCrystalIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha = 1,
): void {
  paintSoulCrystalIconAt(ctx, x, y, size, frameTime, alpha);
}
