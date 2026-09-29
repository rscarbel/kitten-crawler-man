/**
 * Runs one painter so that if it throws, the throw costs only that painter's
 * own drawing — not the rest of the frame, and not the canvas state every
 * later frame starts from.
 *
 * A painter that throws stops between some `save()` and its `restore()`, and
 * the canvas offers no way to ask how deep its stack is. So before the painter
 * runs, a sentinel is written into a state field no painter here sets
 * (`miterLimit`) right after a `save()`: every level the painter pushes
 * inherits the sentinel, and the level this function pushed holds whatever the
 * caller had. Restoring until the sentinel is gone therefore pops exactly the
 * painter's levels and this one, and leaves the caller's own saves alone.
 *
 * The sentinel is the caller's miter limit nudged by a few millionths — exact
 * in a double, distinct per nesting level, and far too small a change to move
 * a single miter join.
 */

/**
 * One step of the nudge: a power of two, so every sum stays exact, and the
 * spacing between single-precision floats around the default limit of 10, so
 * it survives a canvas that stores the limit as a float.
 */
const SENTINEL_STEP_EXPONENT = -20;
const SENTINEL_STEP = 2 ** SENTINEL_STEP_EXPONENT;
/** Nudges cycle through this many steps, so a nested call never reuses its caller's. */
const SENTINEL_SPAN = 64;
/** The deepest a painter's own saves are unwound; only a runaway loop could need more. */
const MAX_UNWIND_DEPTH = 64;

let sentinelCounter = 0;
const reportedFailures = new Set<string>();

/**
 * Paints with `paint`, isolating a throw inside it.
 *
 * @param label Names the painter in the console the first time it throws, so a
 *   broken icon is still loud without flooding the console at frame rate.
 * @returns false when `paint` threw; nothing it drew before the throw is undone.
 */
export function paintIsolated(
  ctx: CanvasRenderingContext2D,
  label: string,
  paint: () => void,
): boolean {
  ctx.save();
  sentinelCounter = (sentinelCounter % SENTINEL_SPAN) + 1;
  const sentinel = ctx.miterLimit + sentinelCounter * SENTINEL_STEP;
  ctx.miterLimit = sentinel;
  try {
    paint();
  } catch (error) {
    // At least once, for this function's own save, even if the painter set
    // its own miter limit at the top level and so hid the sentinel.
    let unwound = 0;
    do {
      ctx.restore();
      unwound++;
    } while (unwound < MAX_UNWIND_DEPTH && ctx.miterLimit === sentinel);
    if (!reportedFailures.has(label)) {
      reportedFailures.add(label);
      console.error(`[paintIsolated] ${label} threw; drawing it is skipped`, error);
    }
    return false;
  }
  ctx.restore();
  return true;
}
