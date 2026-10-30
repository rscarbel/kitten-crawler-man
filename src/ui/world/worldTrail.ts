/**
 * A route painted on the ground: soft chevrons spaced evenly along a shaped
 * trail ({@link TrailShape}), flowing toward the far end. Ground paint, drawn
 * before the Y-sorted pass so every body stands over it.
 *
 * The chevrons are pinned to the ground rather than to the trail's head: as
 * the body walks, the head's progress along the trail is taken off their
 * phase, so they stay put underfoot and only the slow flow moves them. They
 * fade in a short way ahead of the feet, so nothing is painted under or
 * behind the body, and fade out toward the far end.
 *
 * When the route ahead takes a different way, the old trail fades out while
 * the new one draws itself outward from the head, rather than snapping.
 */

import { trailPointAt, type TrailShape } from '../../systems/questRoute/trailShape';
import { worldPalette } from '../theme/worldInk';
import type { WorldPx } from '../../core/rendering/camera';

/** Distance between chevrons along the trail, in pixels. */
const CHEVRON_SPACING_PX = 26;
/** A chevron's depth along the trail, tip to wings, in pixels. */
const CHEVRON_DEPTH_PX = 5;
/** A chevron's span across the trail, wing to wing, in pixels. */
const CHEVRON_SPAN_PX = 11;
const CHEVRON_STROKE_PX = 1.6;
/** The dark edge round each chevron, beyond its stroke on either side, so it reads on pale paving. */
const CHEVRON_EDGE_PX = 0.75;
/** The soft halo under each chevron, beyond its stroke on either side. */
const CHEVRON_HALO_PX = 1.5;
/** How far ahead of the feet the first chevron may stand, in pixels: clear of the body's own shadow. */
const HEAD_LEAD_PX = 20;
/** Over how far outside the led body's sprite box a chevron fades in, in pixels. */
const BODY_FADE_PX = 14;
/** Over how far past the lead the chevrons fade in, in pixels. */
const FADE_IN_PX = 44;
/** Over how far before the trail's end the chevrons fade out, in pixels. */
const FADE_OUT_PX = 120;
/** The nearest chevron's opacity once faded in; the trail eases toward the far value along its length. */
const NEAR_ALPHA = 0.62;
const FAR_ALPHA = 0.4;
/** How fast the chevrons drift toward the goal, in pixels a second. */
const FLOW_PX_PER_SECOND = 22;
/** How long a new trail takes to draw out from the head, and an old one to fade, in milliseconds. */
const REVEAL_MS = 380;
/** How far the reveal's soft front reaches ahead of the drawn part, in pixels. */
const REVEAL_EDGE_PX = 60;
/** A gap longer than this between paints means the trail was gone, and it appears afresh. */
const RESUME_GAP_MS = 250;
/** Frame steps longer than this are treated as this long, so a hitch does not jump the flow. */
const MAX_FRAME_STEP_MS = 100;
/** A head that moved further than this in one frame was set down elsewhere, not walked. */
const HEAD_TELEPORT_PX = 64;
/** How far ahead of the head its direction of travel is read from, in pixels. */
const HEAD_HEADING_PX = 24;
/** Either side of a chevron, how far its direction along the trail is read across, in pixels. */
const TANGENT_REACH_PX = 4;
const MS_PER_SECOND = 1000;
const HALF = 0.5;
/** Off-screen slack before a chevron is culled: its halo's whole reach. */
const CULL_MARGIN_PX = CHEVRON_SPAN_PX + CHEVRON_HALO_PX;
const XY = 2;

export interface WorldTrailOptions {
  /** The visible area in the caller's pixels; chevrons outside it are skipped. Omitted, none are. */
  readonly view?: { readonly width: WorldPx; readonly height: WorldPx };
  /**
   * The sprite box of the body the trail leads, in world pixels. A trail
   * heading north runs up under the body's own sprite, so chevrons fade out
   * as they near it rather than only by distance along the trail.
   */
  readonly body?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** A copy of a painted trail, kept to fade out once the route has moved on. */
class TrailCopy implements TrailShape {
  points = new Float32Array(0);
  count = 0;
  length = 0;
  routeId = 0;

  copyFrom(shape: TrailShape): void {
    const used = shape.count * XY;
    if (this.points.length < used) this.points = new Float32Array(used);
    for (let index = 0; index < used; index++) this.points[index] = shape.points[index];
    this.count = shape.count;
    this.length = shape.length;
    this.routeId = shape.routeId;
  }
}

/** The weight on t² in the cubic Hermite ease `3t² − 2t³`. */
const HERMITE_SQUARE_WEIGHT = 3;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (HERMITE_SQUARE_WEIGHT - 2 * t);
}

/** How far `point` lies outside `box`, in pixels; 0 inside it. */
function distanceOutside(
  box: NonNullable<WorldTrailOptions['body']>,
  point: { readonly x: number; readonly y: number },
): number {
  const outsideX = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const outsideY = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.hypot(outsideX, outsideY);
}

function easeOut(t: number): number {
  const inverse = 1 - Math.max(0, Math.min(1, t));
  return 1 - inverse * inverse * inverse;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * One trail on screen. Keep one per thing that paints a trail and call
 * {@link paint} each frame it shows; it keeps the flow, the ground pinning
 * and the crossfade between frames.
 */
export class WorldTrail {
  private lastPaintMs: number | null = null;
  private phasePx = 0;
  private headX = 0;
  private headY = 0;
  private routeId: number | null = null;
  private revealStartMs = 0;
  private lastFrame = new TrailCopy();
  private outgoing = new TrailCopy();
  private outgoingVisible = false;
  private readonly point = { x: 0, y: 0 };
  private readonly before = { x: 0, y: 0 };
  private readonly after = { x: 0, y: 0 };

  /**
   * Paints `shape` with the camera at (`camX`, `camY`). A null shape paints
   * nothing, and the next shape after a pause appears afresh.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    shape: TrailShape | null,
    camX: number,
    camY: number,
    nowMs: number,
    opts: WorldTrailOptions = {},
  ): void {
    if (shape === null || shape.count < 2) {
      this.lastPaintMs = null;
      return;
    }
    const last = this.lastPaintMs;
    const fresh = last === null || nowMs - last > RESUME_GAP_MS;
    if (fresh) {
      this.revealStartMs = nowMs;
      this.outgoingVisible = false;
      this.phasePx = 0;
    } else {
      this.followHead(shape, Math.max(0, Math.min(MAX_FRAME_STEP_MS, nowMs - last)));
      if (shape.routeId !== this.routeId) {
        const retired = this.outgoing;
        this.outgoing = this.lastFrame;
        this.lastFrame = retired;
        this.outgoingVisible = true;
        this.revealStartMs = nowMs;
      }
    }
    this.lastPaintMs = nowMs;
    this.routeId = shape.routeId;
    this.headX = shape.points[0];
    this.headY = shape.points[1];

    const revealed = easeOut((nowMs - this.revealStartMs) / REVEAL_MS);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (this.outgoingVisible) {
      if (revealed >= 1 || this.outgoing.count < 2) this.outgoingVisible = false;
      else this.paintMarks(ctx, this.outgoing, 1 - revealed, Infinity, camX, camY, opts);
    }
    const reach = revealed >= 1 ? Infinity : HEAD_LEAD_PX + shape.length * revealed;
    this.paintMarks(ctx, shape, 1, reach, camX, camY, opts);
    ctx.restore();
    this.lastFrame.copyFrom(shape);
  }

  /**
   * Takes the head's walk along the trail since the last paint off the
   * phase, so chevrons stay where they lie on the ground, and adds the flow.
   */
  private followHead(shape: TrailShape, stepMs: number): void {
    const movedX = shape.points[0] - this.headX;
    const movedY = shape.points[1] - this.headY;
    let walked = 0;
    if (Math.hypot(movedX, movedY) < HEAD_TELEPORT_PX) {
      trailPointAt(shape, Math.min(HEAD_HEADING_PX, shape.length), this.point);
      const headingX = this.point.x - shape.points[0];
      const headingY = this.point.y - shape.points[1];
      const headingLength = Math.hypot(headingX, headingY);
      if (headingLength > 0) walked = (movedX * headingX + movedY * headingY) / headingLength;
    }
    const flowed = (FLOW_PX_PER_SECOND * stepMs) / MS_PER_SECOND;
    this.phasePx = positiveModulo(this.phasePx - walked + flowed, CHEVRON_SPACING_PX);
  }

  private paintMarks(
    ctx: CanvasRenderingContext2D,
    shape: TrailShape,
    opacity: number,
    reachPx: number,
    camX: number,
    camY: number,
    opts: WorldTrailOptions,
  ): void {
    const view = opts.view;
    const length = shape.length;
    const firstSteps = Math.ceil((HEAD_LEAD_PX - this.phasePx) / CHEVRON_SPACING_PX);
    for (
      let along = this.phasePx + firstSteps * CHEVRON_SPACING_PX;
      along <= length;
      along += CHEVRON_SPACING_PX
    ) {
      const fullyRevealed = reachPx === Infinity;
      const revealFade = fullyRevealed
        ? 1
        : 1 - smoothstep(reachPx - REVEAL_EDGE_PX, reachPx, along);
      const nearFade = smoothstep(HEAD_LEAD_PX, HEAD_LEAD_PX + FADE_IN_PX, along);
      const farFade = 1 - smoothstep(length - FADE_OUT_PX, length, along);
      const depth = length === 0 ? 0 : along / length;
      const alpha =
        opacity * revealFade * nearFade * farFade * (NEAR_ALPHA + (FAR_ALPHA - NEAR_ALPHA) * depth);
      if (alpha <= 0) continue;
      trailPointAt(shape, along, this.point);
      const body = opts.body;
      const bodyFade =
        body === undefined ? 1 : smoothstep(0, BODY_FADE_PX, distanceOutside(body, this.point));
      if (bodyFade <= 0) continue;
      const x = this.point.x - camX;
      const y = this.point.y - camY;
      const offScreen =
        view !== undefined &&
        (x < -CULL_MARGIN_PX ||
          y < -CULL_MARGIN_PX ||
          x > view.width + CULL_MARGIN_PX ||
          y > view.height + CULL_MARGIN_PX);
      if (offScreen) continue;
      trailPointAt(shape, along - TANGENT_REACH_PX, this.before);
      trailPointAt(shape, along + TANGENT_REACH_PX, this.after);
      const tangentX = this.after.x - this.before.x;
      const tangentY = this.after.y - this.before.y;
      const tangentLength = Math.hypot(tangentX, tangentY);
      if (tangentLength === 0) continue;
      this.paintChevron(
        ctx,
        x,
        y,
        tangentX / tangentLength,
        tangentY / tangentLength,
        alpha * bodyFade,
      );
    }
  }

  private paintChevron(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    unitX: number,
    unitY: number,
    alpha: number,
  ): void {
    const halfDepth = CHEVRON_DEPTH_PX * HALF;
    const halfSpan = CHEVRON_SPAN_PX * HALF;
    const tipX = x + unitX * halfDepth;
    const tipY = y + unitY * halfDepth;
    const backX = x - unitX * halfDepth;
    const backY = y - unitY * halfDepth;
    const acrossX = -unitY * halfSpan;
    const acrossY = unitX * halfSpan;
    ctx.beginPath();
    ctx.moveTo(backX + acrossX, backY + acrossY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(backX - acrossX, backY - acrossY);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = worldPalette.objective.trailHalo;
    ctx.lineWidth = CHEVRON_STROKE_PX + CHEVRON_HALO_PX * 2;
    ctx.stroke();
    ctx.strokeStyle = worldPalette.objective.trailOutline;
    ctx.lineWidth = CHEVRON_STROKE_PX + CHEVRON_EDGE_PX * 2;
    ctx.stroke();
    ctx.strokeStyle = worldPalette.objective.trail;
    ctx.lineWidth = CHEVRON_STROKE_PX;
    ctx.stroke();
  }
}
