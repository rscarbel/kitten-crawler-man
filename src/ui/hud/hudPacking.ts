/**
 * Places HUD pieces into whatever room a small screen leaves them.
 *
 * A phone's HUD cannot hang a fixed stack under the minimap: in landscape the
 * minimap, the HUD panel and the hotbar leave a band a few buttons tall, and a
 * stack sized for portrait runs off the bottom. So each piece is placed in
 * turn at the clear spot its owner's `cost` likes best, among spots flush
 * against the screen edges and against every edge already on screen. Pure in
 * its inputs, so a layout check can ask about any window.
 */

import { overlaps, type Rect } from '../core/geom';

export interface PackSize {
  readonly w: number;
  readonly h: number;
}

export interface PackOptions {
  /** Every piece stays wholly inside this. */
  readonly bounds: Rect;
  /** Never overlapped: other buttons, and what the player must always see. */
  readonly blocked: readonly Rect[];
  /**
   * Kept clear of while any clear spot remains, tier by tier: the first tier's
   * rects are given up first, then the next, until only `blocked` is left.
   */
  readonly avoid: readonly (readonly Rect[])[];
  /** Clear space kept round every piece. */
  readonly gap: number;
  /** Lower is better; picks among the clear spots. */
  readonly cost: (rect: Rect) => number;
  /** Extra left edges and top edges worth trying, such as a column's own anchor. */
  readonly seedXs: readonly number[];
  readonly seedYs: readonly number[];
}

function inside(rect: Rect, bounds: Rect): boolean {
  return (
    rect.x >= bounds.x &&
    rect.y >= bounds.y &&
    rect.x + rect.w <= bounds.x + bounds.w &&
    rect.y + rect.h <= bounds.y + bounds.h
  );
}

function grown(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

/** The best clear spot for one `size` among `obstacles`, or null when there is none. */
export function bestSpot(
  size: PackSize,
  obstacles: readonly Rect[],
  options: PackOptions,
): Rect | null {
  const { bounds, gap } = options;
  const xs = new Set<number>([bounds.x, bounds.x + bounds.w - size.w]);
  const ys = new Set<number>([bounds.y, bounds.y + bounds.h - size.h]);
  for (const x of options.seedXs) xs.add(x);
  for (const y of options.seedYs) ys.add(y);
  for (const r of obstacles) {
    xs.add(r.x - gap - size.w);
    xs.add(r.x + r.w + gap);
    ys.add(r.y - gap - size.h);
    ys.add(r.y + r.h + gap);
  }
  const keepOut = obstacles.map((r) => grown(r, gap));
  let best: Rect | null = null;
  let bestCost = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const rect = { x, y, w: size.w, h: size.h };
      if (!inside(rect, bounds)) continue;
      if (keepOut.some((r) => overlaps(rect, r))) continue;
      const cost = options.cost(rect);
      const better =
        cost < bestCost ||
        (best !== null && cost === bestCost && (y < best.y || (y === best.y && x > best.x)));
      if (better) {
        best = rect;
        bestCost = cost;
      }
    }
  }
  return best;
}

/** A stack's members laid out top to bottom, right-aligned, inside `outer`. */
function splitStack(outer: Rect, members: readonly PackSize[], gap: number): Rect[] {
  const rects: Rect[] = [];
  let y = outer.y;
  for (const member of members) {
    rects.push({ x: outer.x + outer.w - member.w, y, w: member.w, h: member.h });
    y += member.h + gap;
  }
  return rects;
}

/**
 * Places `stack` — pieces that belong together, such as Pause over Bag — clear
 * of everything in `options` and of `placed`, and returns one rect per member.
 *
 * In order of preference: the whole stack clear of `blocked` and every
 * `avoid` tier, then its members one by one; then the same with the first
 * tier given up, and so on down to `blocked` alone. On a screen with no room
 * even for that, a member goes where `cost` likes best inside the bounds,
 * overlapping whatever is there.
 */
export function packStack(
  stack: readonly PackSize[],
  placed: readonly Rect[],
  options: PackOptions,
): Rect[] {
  const { gap } = options;
  const stackSize: PackSize = {
    w: Math.max(0, ...stack.map((member) => member.w)),
    h: stack.reduce((sum, member) => sum + member.h, 0) + gap * Math.max(0, stack.length - 1),
  };
  const tiers = options.avoid.map((_, from) => [
    ...options.blocked,
    ...options.avoid.slice(from).flat(),
  ]);
  for (const obstacles of [...tiers, [...options.blocked]]) {
    const whole = bestSpot(stackSize, [...obstacles, ...placed], options);
    if (whole !== null) return splitStack(whole, stack, gap);
    const oneByOne: Rect[] = [];
    for (const member of stack) {
      const spot = bestSpot(member, [...obstacles, ...placed, ...oneByOne], options);
      if (spot === null) break;
      oneByOne.push(spot);
    }
    if (oneByOne.length === stack.length) return oneByOne;
  }
  return stack.map((member) => {
    const cornered = bestSpot(member, [], options);
    return cornered ?? { x: options.bounds.x, y: options.bounds.y, w: member.w, h: member.h };
  });
}
