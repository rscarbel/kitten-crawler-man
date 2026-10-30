/** Rounded-rectangle paths, kept apart from `paint.ts` so the shadow bake can trace them without importing it back. */

import type { Rect } from '../core/geom';

/** Per-corner radii, for shapes that round only some corners (a bottom sheet's top edge). */
export interface CornerRadii {
  readonly tl: number;
  readonly tr: number;
  readonly br: number;
  readonly bl: number;
}

export function corners(radius: number): CornerRadii {
  return { tl: radius, tr: radius, br: radius, bl: radius };
}

const HALF = 0.5;

/** Traces a rounded rectangle; each radius is clamped to half the shorter side. */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number | CornerRadii,
): void {
  const radii = typeof radius === 'number' ? corners(radius) : radius;
  const limit = Math.max(0, Math.min(r.w, r.h) * HALF);
  const tl = Math.min(radii.tl, limit);
  const tr = Math.min(radii.tr, limit);
  const br = Math.min(radii.br, limit);
  const bl = Math.min(radii.bl, limit);
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  ctx.beginPath();
  ctx.moveTo(r.x + tl, r.y);
  ctx.lineTo(right - tr, r.y);
  ctx.arcTo(right, r.y, right, r.y + tr, tr);
  ctx.lineTo(right, bottom - br);
  ctx.arcTo(right, bottom, right - br, bottom, br);
  ctx.lineTo(r.x + bl, bottom);
  ctx.arcTo(r.x, bottom, r.x, bottom - bl, bl);
  ctx.lineTo(r.x, r.y + tl);
  ctx.arcTo(r.x, r.y, r.x + tl, r.y, tl);
  ctx.closePath();
}
