import type { Rect } from './core/geom';
import { roundRectPath } from './widgets/paint';
import { withAlpha } from './theme/color';
import { worldPalette } from './theme/worldInk';
import { TILE_SIZE } from '../core/constants';
import { viewportHeight, viewportWidth } from '../core/Viewport';

/**
 * A highlight that hugs a rectangle of any size — one tile, a whole grain
 * field, a building's footprint — instead of standing a beam of light on it.
 *
 * Split into two passes because the thing being marked is usually a sprite
 * drawn between them:
 *
 * - {@link drawAreaHighlightGround}, under every body: a wash that is clear in
 *   the middle and brightens toward the edges, a glowing rounded outline with
 *   two sparks running round it, and motes rising off the ground. All of it is
 *   drawn before the marked thing — wheat, a machine, a rock — so that thing
 *   stands in front of its own light and is never washed out.
 * - {@link drawAreaHighlightFrame}, over every body: four corner brackets, so a
 *   tall sprite that hides the ground outline is still visibly framed.
 *
 * Both take the rectangle in screen pixels and cull themselves off screen.
 * A `pending` highlight is the same shape in a quieter voice — a marching
 * dashed outline and thin brackets, no sparks or motes — for a target the
 * player cannot act on yet, so "ready" reads at a glance as the brighter one.
 *
 * Never paired with a light beam: the outline already says "here", and a beam
 * stacked on a wide area lights the ground under it into a glare. Beams are
 * for targets with no outline — a quest NPC, a doorway.
 */

/** `ready`: the player can act on it now. `pending`: still waiting on something. */
export type AreaHighlightMood = 'ready' | 'pending';

export interface AreaHighlightOptions {
  /** `#rrggbb`. */
  readonly color: string;
  /** Monotonic clock driving the pulse, the sparks and the motes. */
  readonly nowMs: number;
  /** Defaults to `ready`. */
  readonly mood?: AreaHighlightMood;
}

const FULL_TURN_RADIANS = Math.PI * 2;
const HALF = 0.5;

/** How far past the viewport a rectangle may sit and still be drawn — its glow and motes reach past its edge. */
const OFFSCREEN_MARGIN_PX = 40;

const PULSE_PERIOD_MS: Readonly<Record<AreaHighlightMood, number>> = {
  ready: 1400,
  pending: 2400,
};
/** The pulse swings between this fraction of full strength and full strength. */
const PULSE_FLOOR = 0.65;

/** How much a mood's whole highlight is turned down; pending sits well under ready. */
const MOOD_STRENGTH: Readonly<Record<AreaHighlightMood, number>> = {
  ready: 1,
  pending: 0.6,
};

// ── Edge wash ────────────────────────────────────────────────────────────
/**
 * The wash is a radial gradient stretched to the rectangle, so it follows the
 * shape at any aspect ratio. It is clear out to this fraction of the way to
 * the edge, then brightens to the edge.
 */
const WASH_CLEAR_RADIUS = 0.55;
/** The unit circle's reach at the rectangle's corners, so the corners are washed too. */
const WASH_CORNER_RADIUS = Math.SQRT2;
const WASH_EDGE_ALPHA = 0.13;

// ── Outline ──────────────────────────────────────────────────────────────
const CORNER_RADIUS_PX = 6;
/** A radius past a quarter of the short side turns a tile into a circle. */
const MAX_CORNER_RADIUS_FRACTION = 0.25;
/**
 * A dark hairline under the glow: 'lighter' alone vanishes into anything
 * already bright — sunlit wheat, pale paving — so the outline carries its own contrast.
 */
const OUTLINE_SHADOW_COLOR = worldPalette.areaHighlight.outlineShadow;
const OUTLINE_SHADOW_WIDTH_PX = 3.5;
const OUTLINE_GLOW_WIDTH_PX = 6;
const OUTLINE_GLOW_ALPHA = 0.22;
const OUTLINE_CORE_WIDTH_PX = 1.5;
const OUTLINE_CORE_ALPHA = 0.75;
const PENDING_DASH_PX = 5;
const PENDING_GAP_PX = 4;
const PENDING_MARCH_PX_PER_SECOND = 8;
const MS_PER_SECOND = 1000;

// ── Sparks ───────────────────────────────────────────────────────────────
/** Two sparks, opposite each other, so a big rectangle never looks half-lit. */
const SPARK_COUNT = 2;
/** Every spark laps the outline in this long, whatever its size, so a field's sparks are no slower to read than a tile's. */
const SPARK_LAP_MS = 2600;
/** A spark's length as a fraction of the outline's perimeter, clamped to a sane pixel range. */
const SPARK_LENGTH_FRACTION = 0.07;
const SPARK_MIN_LENGTH_PX = 8;
const SPARK_MAX_LENGTH_PX = 40;
/** Layers from head to tail: each shorter, brighter and thinner than the last, so the spark has a hot head and a fading tail. */
const SPARK_LAYERS: ReadonlyArray<{
  readonly lengthFraction: number;
  readonly width: number;
  readonly alpha: number;
}> = [
  { lengthFraction: 1, width: 7, alpha: 0.2 },
  { lengthFraction: 0.6, width: 4, alpha: 0.5 },
  { lengthFraction: 0.3, width: 2.5, alpha: 1 },
];
/** The spark is lightened toward white so it reads as a glint of the outline, not a second colour. */
const SPARK_COLOR = worldPalette.areaHighlight.spark;

// ── Motes ────────────────────────────────────────────────────────────────
const TILE_AREA_PX = TILE_SIZE * TILE_SIZE;
const MOTES_PER_TILE = 0.7;
const MIN_MOTES = 3;
const MAX_MOTES = 28;
const MOTE_RISE_PX = 26;
const MOTE_PERIOD_MS = 2200;
const MOTE_RADIUS_PX = 1.3;
/** A soft halo round each mote's core, so it reads as a spark of light rather than a speck of paint. */
const MOTE_HALO_RADIUS_PX = 3.5;
const MOTE_HALO_ALPHA_FRACTION = 0.3;
const MOTE_ALPHA = 0.85;
/** Motes drift sideways a little as they rise, so a field's worth of them does not read as a grid of vertical dashes. */
const MOTE_SWAY_PX = 2.5;
const MOTE_SWAY_CYCLES = 1.5;

// Three independent low-discrepancy sequences, so a mote's start column, its
// start row and its phase are uncorrelated without keeping any state.
const GOLDEN_RATIO_FRACTION = 0.618033988749895;
const PLASTIC_RATIO_FRACTION = 0.7548776662466927;
const SILVER_RATIO_FRACTION = 0.41421356237309503;

// ── Corner brackets ──────────────────────────────────────────────────────
const BRACKET_ARM_FRACTION = 0.28;
const BRACKET_MIN_ARM_PX = 6;
const BRACKET_MAX_ARM_PX = 20;
/** How far the brackets breathe outward at the pulse's peak. */
const BRACKET_BREATHE_PX = 2;
/** A dark stroke under the bright one, so the bracket reads on sunlit wheat as well as on dark mud. */
const BRACKET_SHADOW_COLOR = worldPalette.areaHighlight.bracketShadow;
const BRACKET_WIDTH_PX: Readonly<Record<AreaHighlightMood, number>> = { ready: 2.5, pending: 1.5 };
const BRACKET_SHADOW_EXTRA_PX = 2;
const BRACKET_GLOW_WIDTH_PX = 6;
const BRACKET_GLOW_ALPHA = 0.3;

function isOffScreen(rect: Rect): boolean {
  return (
    rect.x + rect.w < -OFFSCREEN_MARGIN_PX ||
    rect.x > viewportWidth() + OFFSCREEN_MARGIN_PX ||
    rect.y + rect.h < -OFFSCREEN_MARGIN_PX ||
    rect.y > viewportHeight() + OFFSCREEN_MARGIN_PX
  );
}

/** 0 at the pulse's trough to 1 at its peak. */
function pulsePhase(nowMs: number, mood: AreaHighlightMood): number {
  const wave = Math.sin((nowMs / PULSE_PERIOD_MS[mood]) * FULL_TURN_RADIANS);
  return (wave + 1) * HALF;
}

function pulseStrength(nowMs: number, mood: AreaHighlightMood): number {
  const swing = 1 - PULSE_FLOOR;
  return (PULSE_FLOOR + swing * pulsePhase(nowMs, mood)) * MOOD_STRENGTH[mood];
}

function cornerRadius(rect: Rect): number {
  const shortSide = Math.min(rect.w, rect.h);
  return Math.min(CORNER_RADIUS_PX, shortSide * MAX_CORNER_RADIUS_FRACTION);
}

/**
 * The ground half: edge wash, outline, sparks and motes. Draw it under every body, before the Y-sorted pass, so the
 * thing it marks stands in front of it.
 */
export function drawAreaHighlightGround(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  options: AreaHighlightOptions,
): void {
  if (isOffScreen(rect)) return;
  const mood = options.mood ?? 'ready';
  const strength = pulseStrength(options.nowMs, mood);

  ctx.save();
  drawOutlineShadow(ctx, rect, mood, options.nowMs);
  ctx.globalCompositeOperation = 'lighter';
  drawEdgeWash(ctx, rect, options.color, strength);
  drawOutline(ctx, rect, options.color, strength, mood, options.nowMs);
  if (mood === 'ready') {
    drawSparks(ctx, rect, options.nowMs);
    drawMotes(ctx, rect, options.color, options.nowMs);
  }
  ctx.restore();
}

/**
 * The frame half: corner brackets round `rect`. Draw it over every body, so a
 * sprite standing on the ground half still reads as marked. `rect` may be
 * taller than the ground rectangle — a machine's whole art, say, rather than
 * the footprint it stands on.
 */
export function drawAreaHighlightFrame(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  options: AreaHighlightOptions,
): void {
  if (isOffScreen(rect)) return;
  const mood = options.mood ?? 'ready';
  const strength = pulseStrength(options.nowMs, mood);
  const breathe = BRACKET_BREATHE_PX * pulsePhase(options.nowMs, mood);
  const shortSide = Math.min(rect.w, rect.h);
  const arm = Math.max(
    BRACKET_MIN_ARM_PX,
    Math.min(BRACKET_MAX_ARM_PX, shortSide * BRACKET_ARM_FRACTION),
  );
  const left = rect.x - breathe;
  const right = rect.x + rect.w + breathe;
  const top = rect.y - breathe;
  const bottom = rect.y + rect.h + breathe;
  const width = BRACKET_WIDTH_PX[mood];

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  traceBrackets(ctx, left, top, right, bottom, arm);
  ctx.strokeStyle = BRACKET_SHADOW_COLOR;
  ctx.lineWidth = width + BRACKET_SHADOW_EXTRA_PX;
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = withAlpha(options.color, BRACKET_GLOW_ALPHA * strength);
  ctx.lineWidth = BRACKET_GLOW_WIDTH_PX;
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = withAlpha(options.color, Math.min(1, strength + (1 - PULSE_FLOOR)));
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

/** Both halves at once, for a caller with no sprite between them. */
export function drawAreaHighlight(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  options: AreaHighlightOptions,
): void {
  drawAreaHighlightGround(ctx, rect, options);
  drawAreaHighlightFrame(ctx, rect, options);
}

function drawEdgeWash(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  color: string,
  strength: number,
): void {
  const centreX = rect.x + rect.w * HALF;
  const centreY = rect.y + rect.h * HALF;
  ctx.save();
  roundRectPath(ctx, rect, cornerRadius(rect));
  ctx.clip();
  ctx.translate(centreX, centreY);
  ctx.scale(rect.w * HALF, rect.h * HALF);
  const edgeAlpha = WASH_EDGE_ALPHA * strength;
  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, WASH_CORNER_RADIUS);
  wash.addColorStop(0, withAlpha(color, 0));
  wash.addColorStop(WASH_CLEAR_RADIUS / WASH_CORNER_RADIUS, withAlpha(color, 0));
  wash.addColorStop(1 / WASH_CORNER_RADIUS, withAlpha(color, edgeAlpha));
  wash.addColorStop(1, withAlpha(color, edgeAlpha));
  ctx.fillStyle = wash;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

/** The outline's path, dashed and marching when `pending`. */
function traceOutline(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  mood: AreaHighlightMood,
  nowMs: number,
): void {
  roundRectPath(ctx, rect, cornerRadius(rect));
  if (mood === 'pending') {
    ctx.setLineDash([PENDING_DASH_PX, PENDING_GAP_PX]);
    ctx.lineDashOffset = -(nowMs / MS_PER_SECOND) * PENDING_MARCH_PX_PER_SECOND;
  }
}

function drawOutlineShadow(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  mood: AreaHighlightMood,
  nowMs: number,
): void {
  ctx.save();
  traceOutline(ctx, rect, mood, nowMs);
  ctx.strokeStyle = OUTLINE_SHADOW_COLOR;
  ctx.lineWidth = OUTLINE_SHADOW_WIDTH_PX;
  ctx.stroke();
  ctx.restore();
}

function drawOutline(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  color: string,
  strength: number,
  mood: AreaHighlightMood,
  nowMs: number,
): void {
  ctx.save();
  traceOutline(ctx, rect, mood, nowMs);
  ctx.strokeStyle = withAlpha(color, OUTLINE_GLOW_ALPHA * strength);
  ctx.lineWidth = OUTLINE_GLOW_WIDTH_PX;
  ctx.stroke();
  ctx.strokeStyle = withAlpha(color, OUTLINE_CORE_ALPHA * strength);
  ctx.lineWidth = OUTLINE_CORE_WIDTH_PX;
  ctx.stroke();
  ctx.restore();
}

/** Each of the four corners trims one radius off each of its two sides' straight runs. */
const CORNER_RADII_CUT_FROM_STRAIGHTS = 8;

/** The rounded outline's length: the straight runs, plus a quarter circle per corner. */
function outlinePerimeter(rect: Rect): number {
  const radius = cornerRadius(rect);
  const straight = 2 * (rect.w + rect.h) - CORNER_RADII_CUT_FROM_STRAIGHTS * radius;
  return straight + FULL_TURN_RADIANS * radius;
}

/**
 * Sparks run round the outline by dashing it: one dash per spark, the rest of
 * the lap a gap, the dash offset advanced with the clock.
 */
function drawSparks(ctx: CanvasRenderingContext2D, rect: Rect, nowMs: number): void {
  const perimeter = outlinePerimeter(rect);
  const lap = perimeter / SPARK_COUNT;
  const sparkLength = Math.max(
    SPARK_MIN_LENGTH_PX,
    Math.min(SPARK_MAX_LENGTH_PX, perimeter * SPARK_LENGTH_FRACTION),
  );
  const travelled = ((nowMs % SPARK_LAP_MS) / SPARK_LAP_MS) * perimeter;
  ctx.save();
  ctx.lineCap = 'round';
  roundRectPath(ctx, rect, cornerRadius(rect));
  for (const layer of SPARK_LAYERS) {
    const length = Math.min(lap, sparkLength * layer.lengthFraction);
    // The head stays put across layers; only the tail shortens, so the offset
    // shifts each shorter layer forward by what it lost.
    const headShift = sparkLength - length;
    ctx.setLineDash([length, lap - length]);
    ctx.lineDashOffset = -(travelled + headShift);
    ctx.strokeStyle = withAlpha(SPARK_COLOR, layer.alpha);
    ctx.lineWidth = layer.width;
    ctx.stroke();
  }
  ctx.restore();
}

function fractionalPart(value: number): number {
  return value - Math.floor(value);
}

function drawMotes(ctx: CanvasRenderingContext2D, rect: Rect, color: string, nowMs: number): void {
  const areaTiles = (rect.w * rect.h) / TILE_AREA_PX;
  const count = Math.max(MIN_MOTES, Math.min(MAX_MOTES, Math.round(areaTiles * MOTES_PER_TILE)));
  const cycle = nowMs / MOTE_PERIOD_MS;
  for (let index = 1; index <= count; index++) {
    const column = fractionalPart(index * GOLDEN_RATIO_FRACTION);
    const row = fractionalPart(index * PLASTIC_RATIO_FRACTION);
    const age = fractionalPart(cycle + index * SILVER_RATIO_FRACTION);
    const sway = Math.sin((age * MOTE_SWAY_CYCLES + column) * FULL_TURN_RADIANS) * MOTE_SWAY_PX;
    const x = rect.x + column * rect.w + sway;
    const y = rect.y + row * rect.h - age * MOTE_RISE_PX;
    // Fades in off the ground and out at the top of its rise, never popping.
    const alpha = Math.sin(age * Math.PI) * MOTE_ALPHA;
    ctx.fillStyle = withAlpha(color, alpha * MOTE_HALO_ALPHA_FRACTION);
    ctx.beginPath();
    ctx.arc(x, y, MOTE_HALO_RADIUS_PX, 0, FULL_TURN_RADIANS);
    ctx.fill();
    ctx.fillStyle = withAlpha(SPARK_COLOR, alpha);
    ctx.beginPath();
    ctx.arc(x, y, MOTE_RADIUS_PX, 0, FULL_TURN_RADIANS);
    ctx.fill();
  }
}

/** Four L-shaped corner brackets as one path, each arm running `arm` pixels in from its corner. */
function traceBrackets(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  right: number,
  bottom: number,
  arm: number,
): void {
  const armX = Math.min(arm, (right - left) * HALF);
  const armY = Math.min(arm, (bottom - top) * HALF);
  ctx.beginPath();
  ctx.moveTo(left, top + armY);
  ctx.lineTo(left, top);
  ctx.lineTo(left + armX, top);
  ctx.moveTo(right - armX, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, top + armY);
  ctx.moveTo(right, bottom - armY);
  ctx.lineTo(right, bottom);
  ctx.lineTo(right - armX, bottom);
  ctx.moveTo(left + armX, bottom);
  ctx.lineTo(left, bottom);
  ctx.lineTo(left, bottom - armY);
}
