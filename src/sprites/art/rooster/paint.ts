/**
 * The primitives every rooster part is built from: capsule and ellipse traces,
 * form shading laid along a form's own axis, and feather strokes.
 *
 * No primitive here draws an outline. The parts are composed on a surface of
 * the painter's own and the outline is the finished silhouette's (see
 * `roosterArt.ts`); a ring drawn per part gives every arm over the chest an ink
 * line and the figure reads as a paper doll.
 */

import { rgba } from '../carlArt';
import type { Ramp } from './builds';
import { type Pt, add, angleOf, mixPt, pt } from './rig';

export type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;
const HALF_TURN = Math.PI / 2;
const MIDPOINT = 0.5;
/** Below this a soft spot has no extent, and scaling by it would collapse the transform. */
const DEGENERATE_RADIUS = 1e-4;
/** A quill narrows a little faster than linearly, so its point is sharp rather than blunt. */
const QUILL_TAPER = 0.8;
/** How far past the form's own radius a round gradient runs, so its darkest step lands on the rim. */
const ROUND_FALLOFF_REACH = 1.45;

/** The key light, upper left, as a unit direction in figure space. */
export const LIGHT: Pt = { x: -0.6, y: -0.8 };

/** Adds a capsule as a fresh subpath, wound the same way as every other so unions fill. */
export function appendCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const angle = angleOf(a, b);
  const nx = Math.cos(angle + HALF_TURN);
  const ny = Math.sin(angle + HALF_TURN);
  ctx.moveTo(a.x + nx * wa, a.y + ny * wa);
  ctx.arc(a.x, a.y, wa, angle + HALF_TURN, angle - HALF_TURN);
  ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
  ctx.arc(b.x, b.y, wb, angle - HALF_TURN, angle + HALF_TURN);
  ctx.closePath();
}

export function appendEllipse(
  ctx: Ctx,
  centre: Pt,
  rx: number,
  ry: number,
  rotation: number,
): void {
  ctx.moveTo(centre.x + Math.cos(rotation) * rx, centre.y + Math.sin(rotation) * rx);
  ctx.ellipse(centre.x, centre.y, Math.max(rx, 0), Math.max(ry, 0), rotation, 0, TWO_PI);
}

/** A closed polygon, as a fresh subpath. */
export function appendPolygon(ctx: Ctx, points: readonly Pt[]): void {
  if (points.length === 0) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

/** A closed loop through `points` smoothed by quadratic midpoints, as a fresh subpath. */
export function appendSmoothLoop(ctx: Ctx, points: readonly Pt[]): void {
  if (points.length < 2) return;
  const last = points[points.length - 1];
  ctx.moveTo((last.x + points[0].x) / 2, (last.y + points[0].y) / 2);
  for (let i = 0; i < points.length; i++) {
    const here = points[i];
    const next = points[(i + 1) % points.length];
    ctx.quadraticCurveTo(here.x, here.y, (here.x + next.x) / 2, (here.y + next.y) / 2);
  }
  ctx.closePath();
}

/** Clips to `trace`, runs `paint`, and restores however `paint` ends. */
export function clipped(ctx: Ctx, trace: () => void, paint: () => void): void {
  ctx.save();
  try {
    ctx.beginPath();
    trace();
    ctx.clip();
    paint();
  } finally {
    ctx.restore();
  }
}

export function fillTrace(ctx: Ctx, trace: () => void, fill: string | CanvasGradient): void {
  ctx.beginPath();
  trace();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Where the lit edge of a form sits, as the step the terminator takes from its axis. */
const LIT_EDGE_STOP = 0.12;
const BASE_STOP = 0.42;
const TERMINATOR_STOP = 0.66;
const CORE_SHADOW_STOP = 0.86;
/**
 * The bounce at the far edge: the shadow side lifts a little where light comes
 * back off the floor, which is what keeps a shadowed limb round rather than flat.
 */
const BOUNCE_STOP = 1;

/**
 * Shades a limb segment like a cylinder: a gradient laid square to its axis,
 * lit edge toward the key light, terminator along the axis, core shadow on the
 * far side and a lift of bounce at the very edge. A gradient keyed to the axis
 * is what makes the terminator follow the form; concentric soft shapes put it
 * on a circle and read as airbrush.
 */
export function cylinderGradient(
  ctx: Ctx,
  a: Pt,
  b: Pt,
  halfWidth: number,
  ramp: Ramp,
): CanvasGradient {
  const angle = angleOf(a, b);
  let nx = Math.cos(angle + HALF_TURN);
  let ny = Math.sin(angle + HALF_TURN);
  if (nx * LIGHT.x + ny * LIGHT.y < 0) {
    nx = -nx;
    ny = -ny;
  }
  const mid = mixPt(a, b, MIDPOINT);
  const lit = add(mid, nx * halfWidth, ny * halfWidth);
  const dark = add(mid, -nx * halfWidth, -ny * halfWidth);
  const gradient = ctx.createLinearGradient(lit.x, lit.y, dark.x, dark.y);
  gradient.addColorStop(0, ramp.light);
  gradient.addColorStop(LIT_EDGE_STOP, ramp.light);
  gradient.addColorStop(BASE_STOP, ramp.mid);
  gradient.addColorStop(TERMINATOR_STOP, ramp.dark);
  gradient.addColorStop(CORE_SHADOW_STOP, ramp.deep);
  gradient.addColorStop(BOUNCE_STOP, ramp.dark);
  return gradient;
}

/** How far toward the light the bright core of a round form is pushed, as a share of its radius. */
const ROUND_LIGHT_OFFSET = 0.45;
const ROUND_LIGHT_STOP = 0.18;
const ROUND_MID_STOP = 0.5;
const ROUND_DARK_STOP = 0.82;

/**
 * Shades a round mass: a radial gradient whose bright core is pushed toward the
 * light and whose outer ring falls into the core shadow. The core sits off the
 * form's centre, so light and shadow are not concentric.
 */
export function roundGradient(ctx: Ctx, centre: Pt, radius: number, ramp: Ramp): CanvasGradient {
  const core = add(
    centre,
    LIGHT.x * radius * ROUND_LIGHT_OFFSET,
    LIGHT.y * radius * ROUND_LIGHT_OFFSET,
  );
  const gradient = ctx.createRadialGradient(
    core.x,
    core.y,
    0,
    core.x,
    core.y,
    radius * ROUND_FALLOFF_REACH,
  );
  gradient.addColorStop(0, ramp.light);
  gradient.addColorStop(ROUND_LIGHT_STOP, ramp.light);
  gradient.addColorStop(ROUND_MID_STOP, ramp.mid);
  gradient.addColorStop(ROUND_DARK_STOP, ramp.dark);
  gradient.addColorStop(1, ramp.deep);
  return gradient;
}

/**
 * A tapered stroke along a quadratic spine, filled as a closed ribbon: wide at
 * its root, a point at its tip. Every feather is one of these; a lower `taper`
 * keeps the feather broad along its length and narrows it only near the tip.
 */
export function appendQuill(
  ctx: Ctx,
  root: Pt,
  control: Pt,
  tip: Pt,
  rootHalf: number,
  steps: number,
  taper = QUILL_TAPER,
): void {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const inv = 1 - t;
    const here = pt(
      inv * inv * root.x + 2 * inv * t * control.x + t * t * tip.x,
      inv * inv * root.y + 2 * inv * t * control.y + t * t * tip.y,
    );
    const tangent = pt(
      2 * inv * (control.x - root.x) + 2 * t * (tip.x - control.x),
      2 * inv * (control.y - root.y) + 2 * t * (tip.y - control.y),
    );
    const length = Math.hypot(tangent.x, tangent.y) || 1;
    const half = rootHalf * (1 - t) ** taper;
    left.push(add(here, (-tangent.y / length) * half, (tangent.x / length) * half));
    right.push(add(here, (tangent.y / length) * half, (-tangent.x / length) * half));
  }
  appendPolygon(ctx, [...left, ...right.reverse()]);
}

/** A point on a quadratic spine. */
export function quadAt(root: Pt, control: Pt, tip: Pt, t: number): Pt {
  const inv = 1 - t;
  return pt(
    inv * inv * root.x + 2 * inv * t * control.x + t * t * tip.x,
    inv * inv * root.y + 2 * inv * t * control.y + t * t * tip.y,
  );
}

/**
 * Strokes a soft band along a line: wide and faint first, narrow and stronger
 * last, so a crease or a terminator line has no hard edge at tile size.
 */
export function softLine(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  width: number,
  colour: string,
  alpha: number,
): void {
  const LAYERS = [
    { scale: 2.2, share: 0.25 },
    { scale: 1.4, share: 0.45 },
    { scale: 0.8, share: 1 },
  ] as const;
  ctx.lineCap = 'round';
  for (const layer of LAYERS) {
    ctx.strokeStyle = rgba(colour, alpha * layer.share);
    ctx.lineWidth = width * layer.scale;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

/** Fills a soft round spot: a radial fade from `colour` to its own transparent twin. */
export function softSpot(
  ctx: Ctx,
  centre: Pt,
  rx: number,
  ry: number,
  rotation: number,
  colour: string,
  alpha: number,
): void {
  ctx.save();
  try {
    ctx.translate(centre.x, centre.y);
    ctx.rotate(rotation);
    ctx.scale(Math.max(rx, DEGENERATE_RADIUS), Math.max(ry, DEGENERATE_RADIUS));
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, rgba(colour, alpha));
    gradient.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TWO_PI);
    ctx.fill();
  } finally {
    ctx.restore();
  }
}
