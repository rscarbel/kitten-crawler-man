/**
 * Containment for one entry of a draw pass that throws: the Y-sorted world
 * pass, the decoration overlay. An entry that throws is left out rather than
 * allowed to abort the pass, because every decoration and body drawn after it
 * would vanish with it, on every frame until the cause cleared.
 *
 * Leaving it out is only half the job. A painter that throws part way leaves
 * the context as it had it — a mirrored transform, a faded alpha, a clip, a
 * `save()` never matched — and every later entry would draw under that. So
 * the pass resets the drawing state it relies on to the baseline it captured
 * before its loop, and asks the scene manager to empty the save stack once the
 * frame's render is over, which it does with nothing of the frame left to draw.
 */

import { CanvasContextUnavailableError } from './canvasSurface';
import { reportCanvasAllocationFailure } from './canvasRecovery';

/**
 * Distinct failures logged before the rest go quiet, so a painter that fails
 * in many different ways cannot flood the console or grow the set without
 * bound.
 */
const MAX_REPORTED_DRAW_FAILURES = 16;
const reportedDrawFailures = new Set<string>();

let saveStackDrainRequested = false;

/**
 * What identifies a failure for logging: its kind and where it was thrown,
 * not its message, which may name a position or a frame and differ every time.
 *
 * V8 opens a stack with the error's own `Name: message` line and the throw
 * site follows it; Firefox and Safari open with the throw site itself.
 */
export function errorIdentity(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const lines = error.stack?.split('\n') ?? [];
  const first = lines.length > 0 ? lines[0].trim() : '';
  const opensWithMessage = first.startsWith(error.name) || first === String(error);
  const throwSiteLine = opensWithMessage ? 1 : 0;
  const throwSite = throwSiteLine < lines.length ? lines[throwSiteLine].trim() : error.message;
  return `${error.name}|${throwSite}`;
}

/**
 * Logs an entry that failed to draw, once per distinct failure: the same one
 * repeats on every frame the entry is on screen, and a different one is a
 * different bug that must not hide behind the first. A refused canvas context
 * also asks for a memory-pressure recovery, as any other refused surface does.
 */
export function noteDrawFailure(pass: string, error: unknown): void {
  if (error instanceof CanvasContextUnavailableError) reportCanvasAllocationFailure();
  const key = `${pass}|${errorIdentity(error)}`;
  if (reportedDrawFailures.has(key)) return;
  if (reportedDrawFailures.size >= MAX_REPORTED_DRAW_FAILURES) return;
  reportedDrawFailures.add(key);
  console.error(`[${pass}] an entry failed to draw and was left out`, error);
}

/**
 * Puts back the drawing state a pass's entries rely on after one of them threw,
 * and asks for the save stack to be emptied at the end of the frame.
 *
 * A clip the failed entry left cannot be lifted without the `restore()` its
 * `save()` was owed, so it holds for the rest of this frame only.
 */
export function recoverDrawState(ctx: CanvasRenderingContext2D, baseline: DOMMatrix): void {
  ctx.setTransform(baseline);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  saveStackDrainRequested = true;
}

/** Whether a contained failure asked for the save stack to be emptied; clears the request. */
export function takeSaveStackDrainRequest(): boolean {
  const requested = saveStackDrainRequested;
  saveStackDrainRequested = false;
  return requested;
}
