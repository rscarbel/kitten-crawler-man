/**
 * Point arithmetic Carl's painter shares between its part files. Figure space
 * is tile units with the origin between the feet and +Y down the screen.
 */

import { lerp, type Pt } from '../carlArt';

export const TWO_PI = Math.PI * 2;
export const HALF_PI = Math.PI / 2;

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

/**
 * The shorter way round from angle `a` to angle `b`, `t` of the way. A plain
 * `lerp` of two `atan2` results goes the long way whenever they straddle the
 * ±π seam (a limb pointing back along −X), and its answer then depends on
 * which side of that seam each direction happened to land.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  const turn = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + turn * t;
}
