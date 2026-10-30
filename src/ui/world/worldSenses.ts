/**
 * Painters for what only some crawlers perceive: a scent drifting along a
 * trail as soft wisps, and a ward line as a spell wall lit on its pulse.
 * Ground paint, drawn before the Y-sorted pass so every body stands over it,
 * in world pixels offset by the camera. A ward that hurts is a ground warning,
 * so its footprint is drawn with the red painters in `dangerTelegraph.ts` and
 * the wall standing on it (`wardWallArt.ts`) keeps to the same reds; a ward
 * resting between burns, or out for good, keeps no red at all.
 */

import { drawDangerLane } from '../../sprites/dangerTelegraph';
import { drawWardWall } from '../../sprites/wardWallArt';
import { worldPalette } from '../theme/worldInk';
import type { WorldPx } from '../../core/rendering/camera';

/** A point in world pixels. */
export interface SensePoint {
  readonly x: number;
  readonly y: number;
}

/** A polyline with its running lengths, measured once so a wisp can be placed by distance along it. */
export interface MeasuredPath {
  readonly points: readonly SensePoint[];
  /** The distance from the first point to each point, in pixels. */
  readonly along: readonly number[];
  readonly length: number;
}

export function measurePath(points: readonly SensePoint[]): MeasuredPath {
  const along: number[] = [];
  let length = 0;
  points.forEach((point, index) => {
    const previous = index === 0 ? point : points[index - 1];
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    along.push(length);
  });
  return { points, along, length };
}

function pointAlong(path: MeasuredPath, distance: number, out: { x: number; y: number }): void {
  const { points, along } = path;
  if (points.length === 0) return;
  const first = points[0];
  for (let index = 1; index < points.length; index++) {
    const end = along[index] ?? 0;
    if (distance > end) continue;
    const start = along[index - 1] ?? 0;
    const from = points[index - 1] ?? first;
    const to = points[index] ?? first;
    const span = end - start;
    const t = span === 0 ? 0 : (distance - start) / span;
    out.x = from.x + (to.x - from.x) * t;
    out.y = from.y + (to.y - from.y) * t;
    return;
  }
  const last = points[points.length - 1] ?? first;
  out.x = last.x;
  out.y = last.y;
}

/** Distance between wisps along a trail. */
const WISP_SPACING_PX = 34;
/** How fast the wisps drift along the trail, toward its far end. */
const WISP_DRIFT_PX_PER_SECOND = 9;
/** How far a wisp sways either side of the trail. */
const WISP_SWAY_PX = 5;
const WISP_SWAY_PERIOD_MS = 2600;
/** How high a wisp lifts off the ground over one breath. */
const WISP_RISE_PX = 7;
const WISP_BREATH_PERIOD_MS = 3400;
const WISP_HAZE_RADIUS_PX = 13;
const WISP_CORE_RADIUS_PX = 2.8;
const WISP_PEAK_ALPHA = 0.9;
/** Off-screen slack before a wisp is skipped. */
const WISP_CULL_PX = WISP_HAZE_RADIUS_PX + WISP_SWAY_PX;
/**
 * A wisp fades in over this much trail after it rises at the start, and out
 * over as much before the end, so none pops into or out of sight.
 */
const WISP_END_FADE_PX = WISP_SPACING_PX;
/**
 * Each wisp's breath starts this far round from the one before it, so they
 * never pulse in step. A wisp keeps its own number from where it rises to
 * where it fades, so its breath and sway never jump while it drifts.
 */
const WISP_PHASE_STEP = 0.37;
const MS_PER_SECOND = 1000;
const TAU = Math.PI * 2;
const HALF = 0.5;

export interface SensePaintView {
  readonly camX: number;
  readonly camY: number;
  readonly width: WorldPx;
  readonly height: WorldPx;
  readonly nowMs: number;
}

function offScreen(view: SensePaintView, x: number, y: number, margin: number): boolean {
  return x < -margin || y < -margin || x > view.width + margin || y > view.height + margin;
}

/** A scent as soft wisps drifting along its trail, at `strength` (0 to 1) of full. */
export function paintScentTrail(
  ctx: CanvasRenderingContext2D,
  path: MeasuredPath,
  strength: number,
  view: SensePaintView,
): void {
  if (strength <= 0 || path.length <= 0) return;
  const ink = worldPalette.senses;
  const travelled = (view.nowMs / MS_PER_SECOND) * WISP_DRIFT_PX_PER_SECOND;
  const newestWisp = Math.floor(travelled / WISP_SPACING_PX);
  const oldestWisp = Math.ceil((travelled - path.length) / WISP_SPACING_PX);
  const at = { x: 0, y: 0 };
  ctx.save();
  for (let wisp = newestWisp; wisp >= oldestWisp; wisp--) {
    const distance = travelled - wisp * WISP_SPACING_PX;
    pointAlong(path, distance, at);
    const phase = wisp * WISP_PHASE_STEP;
    const breath = HALF - HALF * Math.cos(TAU * (view.nowMs / WISP_BREATH_PERIOD_MS + phase));
    const sway = Math.sin(TAU * (view.nowMs / WISP_SWAY_PERIOD_MS + phase)) * WISP_SWAY_PX;
    const x = at.x - view.camX + sway;
    const y = at.y - view.camY - breath * WISP_RISE_PX;
    if (offScreen(view, x, y, WISP_CULL_PX)) continue;
    const endFade = Math.min(distance, path.length - distance) / WISP_END_FADE_PX;
    const presence = Math.max(0, Math.min(1, endFade));
    const alpha = strength * presence * WISP_PEAK_ALPHA * (HALF + HALF * breath);
    const haze = ctx.createRadialGradient(x, y, 0, x, y, WISP_HAZE_RADIUS_PX);
    haze.addColorStop(0, ink.scentHaze);
    haze.addColorStop(1, ink.scentFade);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(x, y, WISP_HAZE_RADIUS_PX, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ink.scentCore;
    ctx.beginPath();
    ctx.arc(x, y, WISP_CORE_RADIUS_PX, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** One straight run of a ward line, in world pixels. */
export interface WardSegment {
  readonly from: SensePoint;
  readonly to: SensePoint;
}

/** Half the width of the ground warning either side of a ward's run: narrow enough that the wall standing on it covers its edges. */
const WARD_HALF_WIDTH_PX = 5;
/**
 * The fade a harmful ward is drawn at for a crawler who cannot perceive it:
 * enough to say the ground is dangerous, too faint and too steady to show
 * the ward's rhythm.
 */
export const WARD_UNPERCEIVED_WARNING_FADE = 0.35;

/** A ward that is out and cannot hurt: its floor runes gone cold and a few dead embers, at `strength` of full. */
export function paintWardDormant(
  ctx: CanvasRenderingContext2D,
  segments: readonly WardSegment[],
  wardSeed: number,
  strength: number,
  view: SensePaintView,
): void {
  drawWardWall(ctx, segments, wardSeed, { kind: 'dormant', strength }, view);
}

/**
 * A ward line that hurts: its red ground warning with the spell wall standing
 * on it, lit to `fade`. For a crawler who perceives it, `fade` follows the
 * ward's pulse so its rhythm shows; for one who does not, the caller passes
 * {@link WARD_UNPERCEIVED_WARNING_FADE}.
 */
export function paintWardWarning(
  ctx: CanvasRenderingContext2D,
  segments: readonly WardSegment[],
  wardSeed: number,
  fade: number,
  view: SensePaintView,
): void {
  if (fade <= 0) return;
  for (const segment of segments) {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    drawDangerLane(
      ctx,
      segment.from.x - view.camX,
      segment.from.y - view.camY,
      dx / length,
      dy / length,
      length,
      WARD_HALF_WIDTH_PX,
      fade,
    );
  }
  drawWardWall(ctx, segments, wardSeed, { kind: 'lit', intensity: fade }, view);
}

/**
 * A harmful ward as its perceiver sees it on `pulse` (0 to 1), at `strength`
 * of full. At rest, between burns, it is only a few sparks on its line and
 * no red at all, since the floor is safe to cross then; the red warning and
 * the curtain rise with the pulse and the sparks give way to them.
 */
export function paintWardPerceived(
  ctx: CanvasRenderingContext2D,
  segments: readonly WardSegment[],
  wardSeed: number,
  pulse: number,
  strength: number,
  view: SensePaintView,
): void {
  const lit = Math.max(0, Math.min(1, pulse));
  drawWardWall(ctx, segments, wardSeed, { kind: 'resting', strength: strength * (1 - lit) }, view);
  paintWardWarning(ctx, segments, wardSeed, strength * lit, view);
}

/** The cue ring's ground ellipse round the feet: wide and flat, as if laid on the floor. */
const CUE_RING_RADIUS_X_PX = 17;
const CUE_RING_RADIUS_Y_PX = 7;
const CUE_RING_LINE_WIDTH_PX = 1.6;
const CUE_RING_BREATH_PERIOD_MS = 1400;
const CUE_RING_MIN_ALPHA = 0.45;
/** A ripple swells out of the ring and fades, once per period. */
const CUE_RIPPLE_PERIOD_MS = 1800;
const CUE_RIPPLE_GROWTH = 0.9;
const CUE_HALO_RADIUS_PX = 22;
/** The halo is squashed like the ring, so it lies on the floor with it. */
const CUE_HALO_RADIUS_Y_PX = CUE_HALO_RADIUS_PX * (CUE_RING_RADIUS_Y_PX / CUE_RING_RADIUS_X_PX);
const CUE_HALO_ALPHA = 0.55;
/** Specks of shimmer rising off the ring, like whiskers catching the light. */
const CUE_MOTE_COUNT = 3;
const CUE_MOTE_RISE_PX = 18;
const CUE_MOTE_PERIOD_MS = 2200;
const CUE_MOTE_RADIUS_PX = 1.4;
const CUE_CULL_PX = CUE_HALO_RADIUS_PX + CUE_MOTE_RISE_PX;

/**
 * The ring round a crawler's feet while something only they perceive is in
 * reach, at `strength` (0 to 1) of full: a breathing ground ellipse, a ripple
 * swelling out of it and a few motes of shimmer rising. Ground paint, under
 * the body.
 */
export function paintSenseCueRing(
  ctx: CanvasRenderingContext2D,
  feet: SensePoint,
  strength: number,
  view: SensePaintView,
): void {
  if (strength <= 0) return;
  const x = feet.x - view.camX;
  const y = feet.y - view.camY;
  if (offScreen(view, x, y, CUE_CULL_PX)) return;
  const ink = worldPalette.senses;
  const breath = HALF - HALF * Math.cos((TAU * view.nowMs) / CUE_RING_BREATH_PERIOD_MS);
  const ripple = (view.nowMs % CUE_RIPPLE_PERIOD_MS) / CUE_RIPPLE_PERIOD_MS;
  ctx.save();
  const halo = ctx.createRadialGradient(x, y, 0, x, y, CUE_HALO_RADIUS_PX);
  halo.addColorStop(0, ink.cueHalo);
  halo.addColorStop(1, ink.cueFade);
  ctx.globalAlpha = strength * CUE_HALO_ALPHA * (HALF + HALF * breath);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(x, y, CUE_HALO_RADIUS_PX, CUE_HALO_RADIUS_Y_PX, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = ink.cueRing;
  ctx.lineWidth = CUE_RING_LINE_WIDTH_PX;
  ctx.globalAlpha = strength * (CUE_RING_MIN_ALPHA + (1 - CUE_RING_MIN_ALPHA) * breath);
  ctx.beginPath();
  ctx.ellipse(x, y, CUE_RING_RADIUS_X_PX, CUE_RING_RADIUS_Y_PX, 0, 0, TAU);
  ctx.stroke();
  const swell = 1 + ripple * CUE_RIPPLE_GROWTH;
  ctx.globalAlpha = strength * (1 - ripple);
  ctx.beginPath();
  ctx.ellipse(x, y, CUE_RING_RADIUS_X_PX * swell, CUE_RING_RADIUS_Y_PX * swell, 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = ink.cueRing;
  for (let mote = 0; mote < CUE_MOTE_COUNT; mote++) {
    const share = mote / CUE_MOTE_COUNT;
    const life = (view.nowMs / CUE_MOTE_PERIOD_MS + share) % 1;
    const angle = TAU * share;
    const moteX = x + Math.cos(angle) * CUE_RING_RADIUS_X_PX;
    const moteY = y + Math.sin(angle) * CUE_RING_RADIUS_Y_PX - life * CUE_MOTE_RISE_PX;
    ctx.globalAlpha = strength * (1 - life);
    ctx.beginPath();
    ctx.arc(moteX, moteY, CUE_MOTE_RADIUS_PX, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
