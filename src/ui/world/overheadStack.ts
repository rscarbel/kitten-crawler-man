/**
 * The overhead stack: the highest pixel a character's draw puts over its head —
 * its art, its quest marker or shop badge, its health bar — read back as one
 * answer.
 *
 * Every painter that hangs something over a body reports its own top here as
 * it paints, so anything stacked over a character later (an interaction
 * prompt above all) asks one question and clears all of them, and a new
 * overhead painter only has to report to be cleared too. Painters report
 * before they defer themselves past the dungeon's darkness, so a part painted
 * later still counts for the draw that raised it.
 *
 * Reports run inside every character's draw, so nothing here allocates per
 * report: captures are pooled and transforms are read as plain numbers.
 */

/**
 * What a measurement counts: `figure` only cached figures' whole-row ink,
 * `art` every body's own drawn art (figures, sheet sprites, painted props),
 * `all` that art and everything hung over it.
 */
export type OverheadReach = 'figure' | 'art' | 'all';

/** What a report stands for: a cached figure's ink, other drawn art, or chrome hung over a body. */
type OverheadReportKind = 'figure' | 'art' | 'chrome';

const REACH_HEARS = {
  figure: { figure: true, art: false, chrome: false },
  art: { figure: true, art: true, chrome: false },
  all: { figure: true, art: true, chrome: true },
} as const satisfies Record<OverheadReach, Record<OverheadReportKind, boolean>>;

/**
 * One running measurement. The caller's space is kept as the second row of
 * the inverse of `ctx`'s transform when it began, the only row a top needs.
 */
interface OverheadCapture {
  ctx: CanvasRenderingContext2D | null;
  reach: OverheadReach;
  toCallerB: number;
  toCallerD: number;
  toCallerF: number;
  topY: number;
  reported: boolean;
}

/** Captures by nesting depth; a nested measurement also counts toward the outer one. */
const capturePool: OverheadCapture[] = [];
let depth = 0;

function captureAt(index: number): OverheadCapture {
  if (index < capturePool.length) return capturePool[index];
  const fresh: OverheadCapture = {
    ctx: null,
    reach: 'all',
    toCallerB: 0,
    toCallerD: 1,
    toCallerF: 0,
    topY: 0,
    reported: false,
  };
  capturePool.push(fresh);
  return fresh;
}

/**
 * Starts measuring everything reported on `ctx` until the matching
 * {@link endOverheadMeasure}. Pair the two in a `try`/`finally`.
 */
export function beginOverheadMeasure(ctx: CanvasRenderingContext2D, reach: OverheadReach): void {
  const capture = captureAt(depth);
  depth++;
  const m = ctx.getTransform();
  const determinant = m.a * m.d - m.b * m.c;
  capture.ctx = ctx;
  capture.reach = reach;
  capture.toCallerB = -m.b / determinant;
  capture.toCallerD = m.a / determinant;
  capture.toCallerF = (m.b * m.e - m.a * m.f) / determinant;
  capture.reported = false;
}

/**
 * Ends the innermost measurement and returns the highest top reported in it,
 * in the space `ctx` was in when it began, or `null` when nothing reported.
 */
export function endOverheadMeasure(): number | null {
  if (depth === 0) return null;
  depth--;
  const capture = captureAt(depth);
  capture.ctx = null;
  return capture.reported ? capture.topY : null;
}

/** Runs `paint` inside one measurement; see {@link beginOverheadMeasure}. */
export function measureOverheadTop(
  ctx: CanvasRenderingContext2D,
  reach: OverheadReach,
  paint: () => void,
): number | null {
  beginOverheadMeasure(ctx, reach);
  let topY: number | null;
  try {
    paint();
  } finally {
    topY = endOverheadMeasure();
  }
  return topY;
}

/** Nested pauses; while any is open, nothing reports. */
let pauseDepth = 0;

/**
 * Stops every running measurement from hearing reports until the matching
 * {@link resumeOverheadMeasure}, for world-space effects a character paints
 * from inside its own draw (a projectile in flight, an explosion) that are
 * not part of anything stacked over its head. Pair the two in a
 * `try`/`finally`.
 */
export function pauseOverheadMeasure(): void {
  pauseDepth++;
}

/** Ends the innermost {@link pauseOverheadMeasure}. */
export function resumeOverheadMeasure(): void {
  if (pauseDepth > 0) pauseDepth--;
}

/** Whether a measurement is listening on `ctx`, for a painter whose top costs something to work out. */
export function overheadMeasuringOn(ctx: CanvasRenderingContext2D): boolean {
  if (pauseDepth > 0) return false;
  for (let i = 0; i < depth; i++) {
    if (captureAt(i).ctx === ctx) return true;
  }
  return false;
}

function report(
  ctx: CanvasRenderingContext2D,
  kind: OverheadReportKind,
  leftX: number,
  rightX: number,
  topY: number,
): void {
  if (!overheadMeasuringOn(ctx)) return;
  const m = ctx.getTransform();
  const leftCanvasX = m.a * leftX + m.c * topY + m.e;
  const leftCanvasY = m.b * leftX + m.d * topY + m.f;
  const rightCanvasX = m.a * rightX + m.c * topY + m.e;
  const rightCanvasY = m.b * rightX + m.d * topY + m.f;
  for (let i = 0; i < depth; i++) {
    const capture = captureAt(i);
    if (capture.ctx !== ctx) continue;
    if (!REACH_HEARS[capture.reach][kind]) continue;
    const leftCallerY =
      capture.toCallerB * leftCanvasX + capture.toCallerD * leftCanvasY + capture.toCallerF;
    const rightCallerY =
      capture.toCallerB * rightCanvasX + capture.toCallerD * rightCanvasY + capture.toCallerF;
    const callerTopY = Math.min(leftCallerY, rightCallerY);
    capture.topY = capture.reported ? Math.min(capture.topY, callerTopY) : callerTopY;
    capture.reported = true;
  }
}

/**
 * Reports that something painted over a body reaches up to (`x`, `topY`) in
 * `ctx`'s current space. Free when no measurement is running on `ctx`.
 */
export function reportOverheadTop(ctx: CanvasRenderingContext2D, x: number, topY: number): void {
  report(ctx, 'chrome', x, x, topY);
}

/**
 * Reports a cached figure's whole-row ink reaching up to `topY` across
 * `leftX`..`rightX` in `ctx`'s current space. Both corners count, since a
 * mirror or rotation can lift either one.
 */
export function reportFigureTop(
  ctx: CanvasRenderingContext2D,
  leftX: number,
  rightX: number,
  topY: number,
): void {
  report(ctx, 'figure', leftX, rightX, topY);
}

/**
 * Reports a body's own drawn art — a sheet sprite, a painted prop — reaching
 * up to `topY` across `leftX`..`rightX` in `ctx`'s current space. Both
 * corners count, since a mirror or rotation can lift either one.
 */
export function reportArtTop(
  ctx: CanvasRenderingContext2D,
  leftX: number,
  rightX: number,
  topY: number,
): void {
  report(ctx, 'art', leftX, rightX, topY);
}
