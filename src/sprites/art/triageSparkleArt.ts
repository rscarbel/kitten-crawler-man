/**
 * Triage landing: a burst of green light on whoever Bucket Boy patches up.
 *
 * Painted in figure units about the target's ground point — one unit a tile,
 * +Y down — so it sits on the healed creature's own tile whoever that is. A
 * ring blooms on the floor, a soft column of light rises through the body, and
 * a handful of plus-shaped motes float up and wink out. The plus is the read:
 * at tile size a round mote is a firefly, a cross is a heal.
 *
 * `t` runs 0 → 1 across the effect's one play. Every mote's path is a fixed
 * table rather than a random draw, so every cell paints the same pixels.
 */

import { type Pt, clamp01, easeOut, hump, lerp, rgba } from './carlArt';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;
const MIN_VISIBLE_ALPHA = 1e-4;

const CORE = '#f2ffe6';
const BRIGHT = '#7cf58a';
const DEEP = '#1f9e48';
const OUTLINE = '#0d3a1c';

/** The floor ring: how wide it blooms and how flat it lies. */
const RING_MAX_RX = 0.46;
const RING_FLATTEN = 0.32;
const RING_WIDTH = 0.035;
const RING_START_RX = 0.12;
/** The ring's stroke thins by this share as it spreads. */
const RING_THINNING = 0.5;
/** The share of the effect the ring lives for; it fades out with the last of the motes. */
const RING_LIFE = 0.8;
/** The floor ring's opacity as it blooms. */
const RING_ALPHA = 0.8;
/** The column of light: centred a little above the knee, most of a body tall. */
const COLUMN_CENTRE_Y = -0.5;
const COLUMN_RX = 0.28;
const COLUMN_RY = 0.62;
const COLUMN_ALPHA = 0.42;
const COLUMN_LEAD_IN = 0.25;
const COLUMN_RATE = 1.2;
/** Where the column's bright core gives way to its deep-green edge, and how strong that edge is. */
const COLUMN_EDGE_AT = 0.55;
const COLUMN_EDGE_ALPHA = 0.5;

interface Mote {
  /** Start x, in tiles either side of the target's centre. */
  readonly x: number;
  /** Height it starts at, and how far it rises over its life. */
  readonly y: number;
  readonly rise: number;
  /** When in the effect it appears and how long it lives, as shares of `t`. */
  readonly start: number;
  readonly life: number;
  /** Arm length of the plus, in tiles. */
  readonly size: number;
  readonly drift: number;
}

const MOTES: readonly Mote[] = [
  { x: -0.2, y: -0.25, rise: 0.55, start: -0.12, life: 0.75, size: 0.07, drift: -0.04 },
  { x: 0.18, y: -0.45, rise: 0.6, start: -0.06, life: 0.8, size: 0.085, drift: 0.05 },
  { x: -0.05, y: -0.7, rise: 0.55, start: 0.18, life: 0.7, size: 0.06, drift: 0.02 },
  { x: 0.28, y: -0.2, rise: 0.5, start: 0.25, life: 0.65, size: 0.055, drift: 0.03 },
  { x: -0.3, y: -0.55, rise: 0.45, start: 0.3, life: 0.65, size: 0.065, drift: -0.03 },
  { x: 0.06, y: -0.35, rise: 0.7, start: 0.35, life: 0.72, size: 0.075, drift: -0.02 },
];

/** Tiny four-point twinkles between the crosses. */
const TWINKLES: readonly Pt[] = [
  { x: -0.12, y: -0.95 },
  { x: 0.22, y: -0.82 },
  { x: -0.26, y: -0.35 },
  { x: 0.12, y: -0.15 },
];
const TWINKLE_SIZE = 0.04;
const TWINKLE_WINDOW = 0.35;

function traceCross(ctx: Ctx, at: Pt, arm: number, thickness: number): void {
  const h = thickness / 2;
  ctx.beginPath();
  ctx.moveTo(at.x - h, at.y - arm);
  ctx.lineTo(at.x + h, at.y - arm);
  ctx.lineTo(at.x + h, at.y - h);
  ctx.lineTo(at.x + arm, at.y - h);
  ctx.lineTo(at.x + arm, at.y + h);
  ctx.lineTo(at.x + h, at.y + h);
  ctx.lineTo(at.x + h, at.y + arm);
  ctx.lineTo(at.x - h, at.y + arm);
  ctx.lineTo(at.x - h, at.y + h);
  ctx.lineTo(at.x - arm, at.y + h);
  ctx.lineTo(at.x - arm, at.y - h);
  ctx.lineTo(at.x - h, at.y - h);
  ctx.closePath();
}

/** Plus thickness as a share of its arm, and the outline round it. */
const CROSS_THICKNESS = 0.8;
const CROSS_OUTLINE = 0.018;
const CROSS_GLOW = 2.2;
/** A mote swells from this share of its size to full at mid-life and shrinks back. */
const MOTE_MIN_SIZE = 0.7;
/** The white core of each cross, as shares of the cross's arm and thickness. */
const CORE_ARM_SHARE = 0.55;
const CORE_THICKNESS_SHARE = 0.45;
/** Where `hump` reaches 1. */
const HUMP_PEAK = 0.5;
/**
 * A mote snaps on over its first quarter-life and fades over its last two
 * fifths: it arrives as a spark and leaves as a glow.
 */
const MOTE_FADE_IN_RATE = 4;
const MOTE_FADE_OUT_RATE = 2.5;
/** The halo behind each cross, as a share of the cross's own opacity. */
const MOTE_GLOW_ALPHA = 0.55;

function drawMote(ctx: Ctx, mote: Mote, t: number): void {
  const local = (t - mote.start) / mote.life;
  if (local <= 0 || local >= 1) return;
  const alpha = clamp01(Math.min(local * MOTE_FADE_IN_RATE, (1 - local) * MOTE_FADE_OUT_RATE));
  if (alpha < MIN_VISIBLE_ALPHA) return;
  const at = { x: mote.x + mote.drift * local, y: mote.y - mote.rise * easeOut(local) };
  const arm = mote.size * (MOTE_MIN_SIZE + (1 - MOTE_MIN_SIZE) * hump(local));
  const baseAlpha = ctx.globalAlpha;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, arm * CROSS_GLOW);
  glow.addColorStop(0, rgba(BRIGHT, MOTE_GLOW_ALPHA * alpha));
  glow.addColorStop(1, rgba(DEEP, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(at.x, at.y, arm * CROSS_GLOW, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = baseAlpha * alpha;
  traceCross(ctx, at, arm, arm * CROSS_THICKNESS);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = CROSS_OUTLINE;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = BRIGHT;
  ctx.fill();
  traceCross(ctx, at, arm * CORE_ARM_SHARE, arm * CROSS_THICKNESS * CORE_THICKNESS_SHARE);
  ctx.fillStyle = CORE;
  ctx.fill();
  ctx.restore();
}

function drawTwinkle(ctx: Ctx, at: Pt, strength: number): void {
  if (strength < MIN_VISIBLE_ALPHA) return;
  const s = TWINKLE_SIZE * strength;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(CORE, strength);
  ctx.beginPath();
  ctx.moveTo(at.x, at.y - s);
  ctx.quadraticCurveTo(at.x, at.y, at.x + s, at.y);
  ctx.quadraticCurveTo(at.x, at.y, at.x, at.y + s);
  ctx.quadraticCurveTo(at.x, at.y, at.x - s, at.y);
  ctx.quadraticCurveTo(at.x, at.y, at.x, at.y - s);
  ctx.fill();
  ctx.restore();
}

/** One cell of the sparkle, `t` from 0 (the heal lands) to 1 (gone). */
export function drawTriageSparkle(ctx: Ctx, t: number): void {
  const ringT = clamp01(t / RING_LIFE);
  const ringAlpha = (1 - ringT) * RING_ALPHA;
  if (ringAlpha > MIN_VISIBLE_ALPHA) {
    const rx = lerp(RING_START_RX, RING_MAX_RX, easeOut(ringT));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(BRIGHT, ringAlpha);
    ctx.lineWidth = RING_WIDTH * (1 - ringT * RING_THINNING);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, rx * RING_FLATTEN, 0, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  // Already lit on the first frame: that frame is the moment the heal lands.
  const columnAlpha = COLUMN_ALPHA * hump(clamp01(COLUMN_LEAD_IN + t * COLUMN_RATE));
  if (columnAlpha > MIN_VISIBLE_ALPHA) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(0, COLUMN_CENTRE_Y);
    ctx.scale(COLUMN_RX, COLUMN_RY);
    const column = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    column.addColorStop(0, rgba(BRIGHT, columnAlpha));
    column.addColorStop(COLUMN_EDGE_AT, rgba(DEEP, columnAlpha * COLUMN_EDGE_ALPHA));
    column.addColorStop(1, rgba(DEEP, 0));
    ctx.fillStyle = column;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  TWINKLES.forEach((at, i) => {
    const centre = (i + 1) / (TWINKLES.length + 1);
    const distance = Math.abs(t - centre);
    drawTwinkle(
      ctx,
      at,
      distance > TWINKLE_WINDOW / 2 ? 0 : hump(HUMP_PEAK - distance / TWINKLE_WINDOW),
    );
  });

  for (const mote of MOTES) drawMote(ctx, mote, t);
}
