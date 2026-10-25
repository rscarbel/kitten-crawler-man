/**
 * The handful of painting primitives every part of Deuce is built from.
 *
 * Forms are shaded by **crescents**, never by gradients: a form is filled with
 * its shadow value, then refilled in its base value with the same outline
 * shifted toward the light, which leaves a hard-edged terminator hugging the
 * side turned away. A highlight crescent is cut the same way on the lit side.
 * That keeps one decisive light/shadow line per form, which is what survives at
 * twelve pixels a head, where a soft blend reads as airbrushed plastic.
 */

import { type Pt } from '../bipedArt';
import { LIGHT_DIR, OUTLINE, type Ramp } from './palette';

export type Ctx = CanvasRenderingContext2D;

/** Appends one closed shape to the current path. Never calls `beginPath`. */
export type Trace = (ctx: Ctx) => void;

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
/**
 * Half the side, in device pixels, of the square used to invert a shape with
 * an even-odd fill. Kept modest: Cairo's fixed-point coordinates overflow on a
 * rectangle millions of pixels wide and silently fill everything.
 */
const INVERT_HALF_PIXELS = 4096;

export function pt(x: number, y: number): Pt {
  return { x, y };
}

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * How many current-space units one device pixel spans. Line weights are set in
 * device pixels through this, so an outline is one crisp pixel whether the
 * portrait is drawn at 36 px or 300.
 */
export function devicePixel(ctx: Ctx): number {
  const m = ctx.getTransform();
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  return scale > 0 ? 1 / scale : 1;
}

/**
 * The key light's direction in the current space. Parts are drawn in rotated
 * and mirrored local frames; mapping the screen-space light back through the
 * transform keeps a mirrored hand lit from the same side as everything else.
 */
export function localLight(ctx: Ctx): Pt {
  const m = ctx.getTransform();
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return { x: LIGHT_DIR.x, y: LIGHT_DIR.y };
  const x = (m.d * LIGHT_DIR.x - m.c * LIGHT_DIR.y) / det;
  const y = (-m.b * LIGHT_DIR.x + m.a * LIGHT_DIR.y) / det;
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : { x: LIGHT_DIR.x, y: LIGHT_DIR.y };
}

export function fillTrace(ctx: Ctx, trace: Trace, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  trace(ctx);
  ctx.fill();
}

/** The silhouette rim: stroked before the fill so only its outer half shows. */
export function outlineTrace(ctx: Ctx, trace: Trace, pixels: number): void {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = devicePixel(ctx) * pixels;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  trace(ctx);
  ctx.stroke();
}

export interface FormShading {
  /** How far, in current units, the lit fill is shifted: the shadow crescent's width. */
  shadow: number;
  /** Width of the lit-side highlight crescent; omitted for matte forms. */
  highlight?: number;
}

/**
 * Fills a form with a hard terminator: shadow everywhere, base shifted toward
 * the light, and an optional highlight crescent on the lit edge.
 */
export function paintForm(ctx: Ctx, trace: Trace, ramp: Ramp, shading: FormShading): void {
  const light = localLight(ctx);
  ctx.save();
  ctx.beginPath();
  trace(ctx);
  ctx.clip();
  fillTrace(ctx, trace, ramp.shade);

  ctx.save();
  ctx.translate(light.x * shading.shadow, light.y * shading.shadow);
  fillTrace(ctx, trace, ramp.base);
  ctx.restore();

  const highlight = shading.highlight;
  if (highlight !== undefined && ramp.light !== undefined) {
    const half = INVERT_HALF_PIXELS * devicePixel(ctx);
    ctx.fillStyle = ramp.light;
    ctx.beginPath();
    ctx.rect(-half, -half, half * 2, half * 2);
    ctx.save();
    ctx.translate(-light.x * highlight, -light.y * highlight);
    trace(ctx);
    ctx.restore();
    ctx.fill('evenodd');
  }
  ctx.restore();
}

/** Clips to `trace` for the duration of `paint`. */
export function withinTrace(ctx: Ctx, trace: Trace, paint: () => void): void {
  ctx.save();
  ctx.beginPath();
  trace(ctx);
  ctx.clip();
  try {
    paint();
  } finally {
    ctx.restore();
  }
}

/**
 * A limb segment: two circles of radius `ra` at `a` and `rb` at `b` joined by
 * their outer tangents (approximated by the perpendiculars, which is exact for
 * equal radii and invisible at the tapers we use).
 */
export function traceCapsule(ctx: Ctx, a: Pt, b: Pt, ra: number, rb: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
  ctx.arc(a.x, a.y, ra, angle + HALF_PI, angle + HALF_PI + Math.PI);
  ctx.lineTo(b.x - nx * rb, b.y - ny * rb);
  ctx.arc(b.x, b.y, rb, angle - HALF_PI, angle + HALF_PI);
  ctx.closePath();
}

export function traceEllipse(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot = 0,
): void {
  ctx.moveTo(cx + rx * Math.cos(rot), cy + rx * Math.sin(rot));
  ctx.ellipse(cx, cy, rx, ry, rot, 0, TWO_PI);
}

/** A closed shape through `points` with every corner rounded by quadratic midpoints. */
export function traceSmoothLoop(ctx: Ctx, points: readonly Pt[]): void {
  const count = points.length;
  if (count < 3) return;
  const first = points[0];
  const last = points[count - 1];
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < count; i++) {
    const corner = points[i];
    const next = points[(i + 1) % count];
    ctx.quadraticCurveTo(corner.x, corner.y, (corner.x + next.x) / 2, (corner.y + next.y) / 2);
  }
  ctx.closePath();
}

/** A polygon with hard corners. */
export function tracePolygon(ctx: Ctx, points: readonly Pt[]): void {
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/** A stroked line in device pixels — creases, seams, lids. */
export function strokeLine(
  ctx: Ctx,
  points: readonly Pt[],
  color: string,
  pixels: number,
  smooth = false,
): void {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = devicePixel(ctx) * pixels;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (smooth && points.length > 2) {
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const next = points[i + 1];
      const isLast = i === points.length - 2;
      ctx.quadraticCurveTo(
        p.x,
        p.y,
        isLast ? next.x : (p.x + next.x) / 2,
        isLast ? next.y : (p.y + next.y) / 2,
      );
    }
  } else {
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

/**
 * A stroke whose width is in *current units* rather than device pixels, for
 * features that must scale with the face (brows, a moustache) but never thin
 * below `minPixels`.
 */
export function strokeScaled(
  ctx: Ctx,
  points: readonly Pt[],
  color: string,
  width: number,
  minPixels: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(width, devicePixel(ctx) * minPixels);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}
