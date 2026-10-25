/**
 * The paint primitives every part of the Trash Gremlin is built from: shapes
 * as re-traceable paths, the one lighting model they are all shaded with, and
 * the slab — a group of shapes outlined as one silhouette before any of them is
 * filled, so parts that belong together read as one body rather than as
 * stickers stacked on each other.
 *
 * The lighting is form-following by construction: a shape is shaded by filling
 * it again shifted along the light, so the terminator is the shape's own edge
 * displaced, a line that tracks the form, never a ring around its centre.
 */

import { type Pt, clamp01, rgba } from '../bipedArt';
import { OUTLINE, type Ramp } from './palette';

export type Ctx = CanvasRenderingContext2D;

/** Appends one closed loop to the current path, without beginning a new one. */
export type Trace = (ctx: Ctx) => void;

/**
 * Lit pieces take a key light from the upper left; a severed piece spins, so
 * any one light direction is wrong most of the time and it is shaded from its
 * own edge inward instead.
 */
export type Lighting = 'lit' | 'ambient';

/** Unit vector toward the key light, in screen space. */
const LIGHT: Pt = { x: -0.6, y: -0.8 };

/** The outline every silhouette is ringed with, outside its fill. */
const OUTLINE_GROW = 0.028;

/** How far the lit and shaded crescents reach in, as shares of the form's size. */
const LIT_REACH = 0.22;
const SHADE_REACH = 0.3;
const DEEP_REACH = 0.55;
const DEEP_ALPHA = 0.55;
/** Ambient pieces darken their rim inward by this share of their size. */
const AMBIENT_RIM_SHARE = 0.32;
const AMBIENT_RIM_ALPHA = 0.7;

/** A rectangle big enough to cover any cell in figure units, for even-odd cut-outs. */
const COVER = 40;

export interface Form {
  readonly trace: Trace;
  readonly ramp: Ramp;
  /** The form's thickness across its narrow axis, which sizes its shading. */
  readonly size: number;
  /** Texture and markings, painted clipped to the form after its shading. */
  readonly detail?: (ctx: Ctx) => void;
}

export function form(trace: Trace, ramp: Ramp, size: number, detail?: (ctx: Ctx) => void): Form {
  return detail === undefined ? { trace, ramp, size } : { trace, ramp, size, detail };
}

function fillTraced(ctx: Ctx, trace: Trace, colour: string, dx = 0, dy = 0): void {
  ctx.save();
  ctx.translate(dx, dy);
  ctx.beginPath();
  trace(ctx);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.restore();
}

/** Fills everything inside the clip *except* the shape shifted by (dx, dy). */
function fillOutsideShifted(ctx: Ctx, trace: Trace, colour: string, dx: number, dy: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-COVER, -COVER, COVER * 2, COVER * 2);
  ctx.translate(dx, dy);
  trace(ctx);
  ctx.fillStyle = colour;
  ctx.fill('evenodd');
  ctx.restore();
}

function clipTo(ctx: Ctx, trace: Trace): void {
  ctx.beginPath();
  trace(ctx);
  ctx.clip();
}

/** Shades and details one form, assuming its outline has already been laid. */
function paintForm(ctx: Ctx, shape: Form, lighting: Lighting): void {
  const { trace, ramp, size } = shape;
  ctx.save();
  clipTo(ctx, trace);
  if (lighting === 'lit') {
    fillTraced(ctx, trace, ramp.light);
    fillTraced(ctx, trace, ramp.mid, -LIGHT.x * size * LIT_REACH, -LIGHT.y * size * LIT_REACH);
    fillOutsideShifted(
      ctx,
      trace,
      ramp.dark,
      LIGHT.x * size * SHADE_REACH,
      LIGHT.y * size * SHADE_REACH,
    );
    fillOutsideShifted(
      ctx,
      trace,
      rgba(ramp.deep, DEEP_ALPHA),
      LIGHT.x * size * DEEP_REACH,
      LIGHT.y * size * DEEP_REACH,
    );
  } else {
    fillTraced(ctx, trace, ramp.mid);
    ctx.beginPath();
    trace(ctx);
    ctx.strokeStyle = rgba(ramp.dark, AMBIENT_RIM_ALPHA);
    ctx.lineWidth = size * AMBIENT_RIM_SHARE;
    ctx.stroke();
  }
  shape.detail?.(ctx);
  ctx.restore();
}

/** Lays the outline of every form at once, so the group shares one silhouette. */
function outlineForms(ctx: Ctx, shapes: readonly Form[]): void {
  ctx.save();
  ctx.fillStyle = OUTLINE;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_GROW * 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const shape of shapes) {
    ctx.beginPath();
    shape.trace(ctx);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** One slab: the outline of the whole group, then each form shaded in order. */
export function paintSlab(ctx: Ctx, shapes: readonly Form[], lighting: Lighting): void {
  outlineForms(ctx, shapes);
  for (const shape of shapes) paintForm(ctx, shape, lighting);
}

// ── Traces ───────────────────────────────────────────────────────────────────

export function traceEllipse(c: Pt, rx: number, ry: number, rotation = 0): Trace {
  return (ctx) => {
    ctx.moveTo(c.x + Math.cos(rotation) * rx, c.y + Math.sin(rotation) * rx);
    ctx.ellipse(c.x, c.y, Math.max(rx, 0), Math.max(ry, 0), rotation, 0, Math.PI * 2);
    ctx.closePath();
  };
}

/**
 * A limb segment: two end circles joined by their outer tangents. Exact
 * tangents rather than a quad between two diameters, so a segment that tapers
 * hard does not show a step where the straight sides meet the caps.
 */
export function traceTaper(a: Pt, b: Pt, ra: number, rb: number): Trace {
  return (ctx) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= Math.abs(ra - rb)) {
      const big = ra >= rb ? a : b;
      const radius = Math.max(ra, rb);
      ctx.moveTo(big.x + radius, big.y);
      ctx.arc(big.x, big.y, radius, 0, Math.PI * 2);
      ctx.closePath();
      return;
    }
    const heading = Math.atan2(dy, dx);
    const spread = Math.acos((ra - rb) / distance);
    ctx.moveTo(a.x + Math.cos(heading + spread) * ra, a.y + Math.sin(heading + spread) * ra);
    ctx.arc(a.x, a.y, ra, heading + spread, heading - spread + Math.PI * 2);
    ctx.arc(b.x, b.y, rb, heading - spread, heading + spread);
    ctx.closePath();
  };
}

/**
 * A closed curve through every point, as a centripetal-style Catmull–Rom
 * spline turned into Béziers, so a silhouette has no corners where its stations
 * meet.
 */
export function traceSmooth(points: readonly Pt[]): Trace {
  return (ctx) => {
    const n = points.length;
    if (n < 3) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < n; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const { c1, c2 } = smoothSpanHandles(points[(i - 1 + n) % n], p1, p2, points[(i + 2) % n]);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
    }
    ctx.closePath();
  };
}

/** Catmull–Rom handles at a sixth of the chord: the uniform spline's own tangents. */
const SMOOTH_TENSION = 6;

/**
 * The two Bézier handles of the smooth curve's span from `p1` to `p2`, given
 * the points either side. Shared with anything that samples the curve, so what
 * is measured is what is drawn.
 */
export function smoothSpanHandles(p0: Pt, p1: Pt, p2: Pt, p3: Pt): { c1: Pt; c2: Pt } {
  return {
    c1: { x: p1.x + (p2.x - p0.x) / SMOOTH_TENSION, y: p1.y + (p2.y - p0.y) / SMOOTH_TENSION },
    c2: { x: p2.x - (p3.x - p1.x) / SMOOTH_TENSION, y: p2.y - (p3.y - p1.y) / SMOOTH_TENSION },
  };
}

export function tracePolygon(points: readonly Pt[]): Trace {
  return (ctx) => {
    if (points.length === 0) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  };
}

/** A smooth open stroke through the points, drawn with the current stroke style. */
export function strokeCurve(ctx: Ctx, points: readonly Pt[]): void {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/** Points on the convex hull of a set, counter-clockwise, by Andrew's monotone chain. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (sorted.length < 3) return sorted;
  const turn = (o: Pt, a: Pt, b: Pt): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** A soft round glow, for light the sac casts rather than a surface. */
export function glow(ctx: Ctx, c: Pt, radius: number, colour: string, strength: number): void {
  const amount = clamp01(strength);
  if (amount <= 0 || radius <= 0) return;
  const gradient = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
  gradient.addColorStop(0, rgba(colour, amount));
  gradient.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** A deterministic 0–1 hash of a number, for seeded variety that never advances a counter. */
export function hash1(seed: number): number {
  const s = Math.sin(seed * HASH_A + HASH_B) * HASH_C;
  return s - Math.floor(s);
}

const HASH_A = 12.9898;
const HASH_B = 78.233;
const HASH_C = 43758.5453;
