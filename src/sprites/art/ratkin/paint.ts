/**
 * The paint primitives every ratkin layer is built from: capsules, outlined
 * fills, sheen strokes and fur edges.
 *
 * Shared by the body painter, the garment layers and the held props so that a
 * coat's outline and a leg's outline are the same stroke — a garment drawn with
 * its own copy of the outline weight reads as pasted on at tile size.
 */

import { type Pt, lerp } from '../carlArt';

type Ctx = CanvasRenderingContext2D;

export const TWO_PI = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
/** Midpoint of a span, for shapes built symmetrically about their centre. */
export const MIDPOINT = 0.5;

export function pt(x: number, y: number): Pt {
  return { x, y };
}

export function offset(base: Pt, dx: number, dy: number): Pt {
  return { x: base.x + dx, y: base.y + dy };
}

export function mixPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function rotate(p: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

export function angleBetween(from: Pt, to: Pt): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** A three-stop value ramp for one material. */
export interface Ramp {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
}

export const OUTLINE = '#160f0a';

export const SHEEN_ALPHA = 0.28;

/** Unit vector the key light arrives from, in figure space. */
export const LIGHT: Pt = { x: -0.6, y: -0.8 };

/** Traces a capsule: a quad between two circles, with both caps rounded. */
export function traceCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const normal = angleBetween(a, b) + HALF_PI;
  const nx = Math.cos(normal);
  const ny = Math.sin(normal);
  ctx.beginPath();
  ctx.arc(a.x, a.y, wa, normal, normal + Math.PI);
  ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
  ctx.arc(b.x, b.y, wb, normal + Math.PI, normal + TWO_PI);
  ctx.lineTo(a.x + nx * wa, a.y + ny * wa);
  ctx.closePath();
}

export function fillCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number, fill: string): void {
  traceCapsule(ctx, a, b, wa, wb);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Dark silhouette laid under a form so it separates from what is behind it. */
export const OUTLINE_BLEED = 0.013;

export function outlineCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  fillCapsule(ctx, a, b, wa + OUTLINE_BLEED, wb + OUTLINE_BLEED, OUTLINE);
}

export const SHEEN_OFFSET = 0.45;
export const SHEEN_WIDTH = 0.34;
export const SHEEN_TAPER = 0.7;

/** Runs a light stroke down the lit side of a segment. */
export function sheenSegment(
  ctx: Ctx,
  a: Pt,
  b: Pt,
  width: number,
  colour: string,
  alpha: number,
): void {
  const normal = angleBetween(a, b) + HALF_PI;
  const facing = Math.cos(normal) * LIGHT.x + Math.sin(normal) * LIGHT.y;
  const push = width * SHEEN_OFFSET * (facing >= 0 ? 1 : -1);
  const nx = Math.cos(normal) * push;
  const ny = Math.sin(normal) * push;
  ctx.save();
  ctx.globalAlpha = alpha;
  fillCapsule(
    ctx,
    offset(a, nx, ny),
    offset(b, nx, ny),
    width * SHEEN_WIDTH,
    width * SHEEN_WIDTH * SHEEN_TAPER,
    colour,
  );
  ctx.restore();
}

/**
 * Strokes then fills a closed path, so the outline shows only where the fill
 * does not cover it — half the stroke width, all the way round the silhouette.
 */
export function fillOutlined(
  ctx: Ctx,
  trace: () => void,
  fill: string,
  outlineWidth: number,
): void {
  ctx.save();
  trace();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = outlineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

export const BODY_OUTLINE_WIDTH = 0.026;
export const DETAIL_OUTLINE_WIDTH = 0.016;

/**
 * Below this an alpha serialises in exponent notation (`5e-17`), which
 * node-canvas silently discards along with the whole `rgba()` — baking a solid
 * black smear where a shadow should have faded out.
 */
export const MIN_VISIBLE_ALPHA = 1e-4;

/**
 * Walks a fur edge from `a` to `b`, bowed out by `bulge` and broken into
 * `tufts` shallow scallops. `outward` is +1 to bow toward the *right* of the
 * a→b direction and −1 toward its left — screen space has +Y down, so adding a
 * quarter turn rotates clockwise on screen, not anticlockwise.
 *
 * Fur is one soft mass with an uneven edge, not a ring of spikes: many shallow
 * scallops read as fur, few tall ones read as a crown of thorns. The path must
 * already sit on `a`.
 */
export function traceFurEdge(
  ctx: Ctx,
  a: Pt,
  b: Pt,
  bulge: number,
  tufts: number,
  tuft: number,
  outward: number,
): void {
  const along = angleBetween(a, b);
  const outX = Math.cos(along + HALF_PI) * outward;
  const outY = Math.sin(along + HALF_PI) * outward;
  const swell = (t: number): number => bulge * Math.sin(t * Math.PI);
  for (let i = 1; i <= tufts; i++) {
    const t = i / tufts;
    const midT = (i - MIDPOINT) / tufts;
    const anchor = mixPt(a, b, t);
    const control = mixPt(a, b, midT);
    ctx.quadraticCurveTo(
      control.x + outX * (swell(midT) + tuft),
      control.y + outY * (swell(midT) + tuft),
      anchor.x + outX * swell(t),
      anchor.y + outY * swell(t),
    );
  }
}

/** Traces a rounded rectangle; `roundRect` is not on node-canvas' context. */
export function traceRoundRect(
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
