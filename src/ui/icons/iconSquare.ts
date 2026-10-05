import type { Rect } from '../core/geom';

/** The largest square centred in `rect`, as the origin and side every icon painter draws from. */
export function iconSquare(rect: Rect): { x: number; y: number; size: number } {
  const size = Math.min(rect.w, rect.h);
  return { x: rect.x + (rect.w - size) / 2, y: rect.y + (rect.h - size) / 2, size };
}
