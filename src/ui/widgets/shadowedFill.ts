/**
 * Rounded fills under a soft drop shadow, baked once and blitted.
 *
 * A canvas shadow is a blur run over the shape every time it is drawn: on the
 * GPU a separate filter pass per panel, in software a full Gaussian. The HUD
 * draws a dozen glass panels a frame whose size, radius and skin almost never
 * change, so each distinct one is painted once, shadow and all, into a surface
 * that already sits at device resolution, and every later frame is one
 * unscaled `drawImage`.
 *
 * The bake is drawn under the target's own scale, so the shadow comes out the
 * same whether a renderer applies the transform to the blur or not; only the
 * translation is moved into the bake, as a quantised sub-pixel phase.
 */

import type { Rect } from '../core/geom';
import type { Elevation } from '../theme/tokens';
import {
  allocCanvas,
  BYTES_PER_MEGABYTE,
  freshSurfaceContext,
} from '../../core/rendering/canvasSurface';
import type { CanvasSurface } from '../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../core/rendering/canvasRecovery';
import { RecentSurfaceCache } from '../../core/rendering/recentSurfaceCache';
import { renderFrameNumber } from '../../core/rendering/renderFrameClock';
import { roundRectPath, type CornerRadii } from './roundRect';

/** How far past the shape a shadow's blur still shows, in multiples of `shadowBlur`. */
const BLUR_REACH_PER_UNIT = 2;
/** Sub-pixel phases a bake is kept for, per axis: a quarter pixel is below what an edge's antialiasing shows. */
const SUBPIXEL_PHASES = 4;
/**
 * The bakes' byte budget. A screen's panels come to a few megabytes at a
 * phone's density; the rest is room for the screens recently left.
 */
const SHADOW_BAKE_BUDGET_MEGABYTES = 16;
/** A bake drawn this frame or the one before is on screen and never let go. */
const SHADOW_BAKE_PROTECTED_FRAMES = 1;
/**
 * A shape is baked only once it has been drawn in the same place for this
 * many consecutive frames. A panel fading or sliding in changes key every
 * frame, or crawls through every sub-pixel phase in turn, and baking those
 * would cost more than drawing them live and pin a bake per phase.
 */
const STATIONARY_FRAMES_BEFORE_BAKE = 8;
/**
 * Shapes being watched for stillness. Past this many, runs not drawn last
 * frame are dropped; only if every one is live is the watch list cleared.
 */
const MAX_WATCHED_PLACEMENTS = 256;
/**
 * A bake may cover no more device pixels than a square this many on a side;
 * a larger sheet is drawn live, being drawn rarely and costly to pin.
 */
const MAX_BAKE_SIDE_PX = 1024;
const MAX_BAKE_PIXELS = MAX_BAKE_SIDE_PX * MAX_BAKE_SIDE_PX;

interface Bake {
  readonly surface: CanvasSurface;
  readonly pad: number;
}

/** The render frames over which one placement of a shape has been drawn without a break. */
interface StillRun {
  readonly firstFrame: number;
  readonly lastFrame: number;
}

const bakes = new RecentSurfaceCache<Bake>(
  SHADOW_BAKE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE,
  SHADOW_BAKE_PROTECTED_FRAMES,
  (bake) => bake.surface,
);

const stillRuns = new Map<string, StillRun>();

// The bakes are a cache: dropped on canvas loss and painted again on the next draw.
onCanvasRecovery(() => bakes.clear());

function pruneStillRuns(frame: number): void {
  for (const [key, run] of stillRuns) {
    const brokenOff = run.lastFrame < frame - 1;
    if (brokenOff) stillRuns.delete(key);
  }
  if (stillRuns.size >= MAX_WATCHED_PLACEMENTS) stillRuns.clear();
}

/** Whether the shape at `placementKey` has now been drawn there long enough to bake. */
function heldStill(placementKey: string): boolean {
  const frame = renderFrameNumber();
  const run = stillRuns.get(placementKey);
  const unbroken = run !== undefined && run.lastFrame >= frame - 1;
  const firstFrame = unbroken ? run.firstFrame : frame;
  if (!unbroken && stillRuns.size >= MAX_WATCHED_PLACEMENTS) pruneStillRuns(frame);
  stillRuns.set(placementKey, { firstFrame, lastFrame: frame });
  return frame - firstFrame >= STATIONARY_FRAMES_BEFORE_BAKE;
}

function radiiKey(radius: number | CornerRadii): string {
  if (typeof radius === 'number') return `${radius}`;
  return `${radius.tl},${radius.tr},${radius.br},${radius.bl}`;
}

/** A device coordinate split into the whole pixel a bake is blitted at and the phase painted into it. */
function snapToPhase(devicePx: number): { readonly whole: number; readonly phase: number } {
  const snapped = Math.round(devicePx * SUBPIXEL_PHASES) / SUBPIXEL_PHASES;
  const whole = Math.floor(snapped);
  return { whole, phase: snapped - whole };
}

function paintShadowed(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number | CornerRadii,
  fill: string,
  shadow: Elevation,
): void {
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = shadow.offsetY;
  ctx.fillStyle = fill;
  roundRectPath(ctx, r, radius);
  ctx.fill();
}

function bakeFor(
  key: string,
  placementKey: string,
  r: Rect,
  radius: number | CornerRadii,
  fill: string,
  shadow: Elevation,
  scale: { readonly x: number; readonly y: number },
  phase: { readonly x: number; readonly y: number },
  alpha: number,
): Bake | null {
  const cached = bakes.get(key);
  if (cached !== undefined) return cached;
  const largestScale = Math.max(1, scale.x, scale.y);
  const reach = shadow.blur * BLUR_REACH_PER_UNIT + Math.abs(shadow.offsetY);
  const pad = Math.ceil(reach * largestScale);
  const width = Math.ceil(r.w * scale.x + phase.x) + pad * 2;
  const height = Math.ceil(r.h * scale.y + phase.y) + pad * 2;
  if (width * height > MAX_BAKE_PIXELS || !heldStill(placementKey)) return null;
  stillRuns.delete(placementKey);
  const surface = allocCanvas('ui', width, height);
  let bakeCtx: CanvasRenderingContext2D;
  try {
    bakeCtx = freshSurfaceContext(surface);
  } catch {
    return null;
  }
  bakeCtx.setTransform(scale.x, 0, 0, scale.y, pad + phase.x, pad + phase.y);
  bakeCtx.globalAlpha = alpha;
  paintShadowed(bakeCtx, { x: 0, y: 0, w: r.w, h: r.h }, radius, fill, shadow);
  const bake = { surface, pad };
  bakes.set(key, bake);
  return bake;
}

/**
 * Fills the rounded rectangle `r` under `shadow`, as
 * `ctx.fill()` with the shadow set would, from a cached bake when the
 * context's state lets one stand in for it exactly: an axis-aligned
 * transform, plain source-over and no filter. The opacity is painted into the
 * bake, so a panel held at a steady fade is cached too. Any other state is
 * drawn live.
 */
export function fillShadowedRounded(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number | CornerRadii,
  fill: string,
  shadow: Elevation,
): void {
  const transform = ctx.getTransform();
  const axisAligned = transform.b === 0 && transform.c === 0;
  // A headless UI harness draws into a stand-in context with no document to
  // allocate a bake from; there the shape is drawn live.
  const canAllocate = typeof document !== 'undefined';
  // A browser without canvas filters has no `filter` to set.
  const unfiltered = !('filter' in ctx) || ctx.filter === 'none';
  const bakeable =
    canAllocate &&
    unfiltered &&
    axisAligned &&
    transform.a > 0 &&
    transform.d > 0 &&
    ctx.globalCompositeOperation === 'source-over' &&
    r.w > 0 &&
    r.h > 0;
  const snappedX = snapToPhase(transform.a * r.x + transform.e);
  const snappedY = snapToPhase(transform.d * r.y + transform.f);
  const scale = { x: transform.a, y: transform.d };
  const phase = { x: snappedX.phase, y: snappedY.phase };
  const key = [
    fill,
    shadow.color,
    shadow.blur,
    shadow.offsetY,
    radiiKey(radius),
    r.w,
    r.h,
    scale.x,
    scale.y,
    phase.x,
    phase.y,
    ctx.globalAlpha,
  ].join('|');
  const placementKey = `${key}|${snappedX.whole},${snappedY.whole}`;
  const bake = bakeable
    ? bakeFor(key, placementKey, r, radius, fill, shadow, scale, phase, ctx.globalAlpha)
    : null;
  ctx.save();
  if (bake === null) {
    paintShadowed(ctx, r, radius, fill, shadow);
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    // The bake carries its own shadow; the caller's would be cast a second time under it.
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(bake.surface, snappedX.whole - bake.pad, snappedY.whole - bake.pad);
  }
  ctx.restore();
}
