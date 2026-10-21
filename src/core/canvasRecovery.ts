/**
 * Rebuilds the game's off-screen canvas caches when the browser has thrown
 * their pixels away.
 *
 * Almost everything the world draws is baked once into an off-screen surface
 * and blitted forever after — the floor's tile chunks, the runtime-painted
 * ground and environment sheets, figure cells, light cookies. A mobile browser
 * is free to discard the GPU backing of those surfaces while the page is in the
 * background, or after a GPU context loss, and hand them back blank. Nothing in
 * a cache can tell: the surface object is still there, so the floor keeps
 * blitting transparent chunks and simply vanishes.
 *
 * Two kinds of state answer that here. Module caches register a handler with
 * {@link onCanvasRecovery}. Instance caches — one per map or lighting pass —
 * compare {@link canvasGeneration} against the generation they were built in
 * and drop themselves when it moves, so a cache never has to be unregistered
 * and a dead floor's cache is never kept alive by this module.
 *
 * Recovery runs at a frame boundary ({@link beginCanvasRecoveryFrame}), never
 * from inside an event, so no bake is ever half way through when its cache is
 * cleared under it.
 */

import {
  allocCanvas,
  CanvasContextUnavailableError,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
} from './canvasSurface';

/**
 * Why the caches are being rebuilt.
 *
 * `purged` — pixels were lost, so everything painted must be painted again.
 * `memoryPressure` — a surface could not be allocated; what can be rebuilt on
 * demand is dropped to give its memory back, but art that is correct and costly
 * to repaint is kept.
 */
export type CanvasRecoveryCause = 'purged' | 'memoryPressure';

type RecoveryHandler = (cause: CanvasRecoveryCause) => void;

/**
 * Answers whether some cache's pixels look purged. True means purged.
 * Registered by a cache that knows a surface which must not be transparent.
 */
type PurgeProbe = () => boolean;

/**
 * How often the sentinel and the probes are read back while the game runs.
 *
 * The check exists for purges that arrive with no event at all, which is the
 * mobile case. A handful of seconds bounds how long a vanished floor stays
 * vanished, while a one-pixel readback this rarely costs nothing a frame shows.
 */
export const CANVAS_PURGE_CHECK_INTERVAL_MS = 4000;

/**
 * The longest a repeating false alarm may stretch the check interval to. A
 * browser that perturbs readbacks for privacy could flag a purge on every
 * check; doubling the interval after each one keeps that from repainting the
 * world every four seconds.
 */
const MAX_PURGE_CHECK_INTERVAL_MS = 64000;

/**
 * Least time between two memory-pressure recoveries. Dropping caches frees
 * memory only for as long as it takes to rebuild them, so a device that is
 * genuinely out of canvas memory would otherwise flush every frame.
 */
const MEMORY_PRESSURE_RECOVERY_SPACING_MS = 30000;

/**
 * Sentinel edge. Large enough that a browser accelerates it the way it
 * accelerates the caches — Chrome keeps very small canvases in software, where
 * nothing is ever purged — and small enough to cost nothing to hold.
 */
const SENTINEL_SIZE_PX = 256;
const SENTINEL_FILL = 'rgb(255, 0, 255)';
/**
 * The sentinel is painted fully opaque; anything under half alpha means its
 * pixels are gone. Not an exact test, because some browsers add noise to
 * readbacks to frustrate fingerprinting.
 */
const SENTINEL_MIN_ALPHA = 128;
const ALPHA_CHANNEL = 3;

const handlers: RecoveryHandler[] = [];
const probes: PurgeProbe[] = [];

let generation = 0;
let pendingCause: CanvasRecoveryCause | null = null;
let nextCheckAtMs = 0;
let checkIntervalMs = CANVAS_PURGE_CHECK_INTERVAL_MS;
let lastMemoryPressureRecoveryMs = Number.NEGATIVE_INFINITY;
let sentinel: CanvasSurface | null = null;
let recoveriesRun = 0;

/**
 * Bumped on every recovery. An instance cache records it when built and drops
 * its surfaces when it no longer matches.
 */
export function canvasGeneration(): number {
  return generation;
}

/** Recoveries run since the module loaded; for gates and the perf readout. */
export function canvasRecoveryCount(): number {
  return recoveriesRun;
}

/**
 * Registers a module cache's rebuild. Permanent: a module cache lives as long
 * as the page does.
 */
export function onCanvasRecovery(handler: RecoveryHandler): void {
  handlers.push(handler);
}

/** Registers a check that reads one of a cache's own surfaces for lost pixels. */
export function registerPurgeProbe(probe: PurgeProbe): void {
  probes.push(probe);
}

/** Asks for a recovery at the next frame boundary. A purge outranks memory pressure. */
export function requestCanvasRecovery(cause: CanvasRecoveryCause): void {
  if (pendingCause === 'purged') return;
  pendingCause = cause;
}

/**
 * For a cache that failed to allocate or acquire a surface: the browser's canvas
 * memory is exhausted, and dropping what can be rebuilt is the only way back.
 */
export function reportCanvasAllocationFailure(): void {
  requestCanvasRecovery('memoryPressure');
}

/** Brings the next purge check forward to the coming frame. */
export function checkCanvasesSoon(): void {
  nextCheckAtMs = 0;
}

function releaseSentinel(): void {
  if (sentinel === null) return;
  releaseSurface(sentinel);
  sentinel = null;
}

/** A fresh sentinel, or null when the browser will not give a context for one. */
function paintSentinel(): CanvasSurface | null {
  const surface = allocCanvas('misc', SENTINEL_SIZE_PX, SENTINEL_SIZE_PX);
  try {
    const ctx = surfaceContext(surface);
    ctx.fillStyle = SENTINEL_FILL;
    ctx.fillRect(0, 0, SENTINEL_SIZE_PX, SENTINEL_SIZE_PX);
    // Absent on the canvas stand-ins the offline harnesses run on.
    if ('addEventListener' in surface) {
      surface.addEventListener('contextlost', () => checkCanvasesSoon());
      surface.addEventListener('contextrestored', () => requestCanvasRecovery('purged'));
    }
    return surface;
  } catch {
    releaseSurface(surface);
    return null;
  }
}

/**
 * Whether the sentinel painted at the last check has lost its pixels.
 *
 * Each sentinel is read exactly once and then replaced. A browser moves a canvas
 * it sees read back repeatedly out of GPU memory, where it would never be purged
 * and would stop standing in for the caches.
 */
function sentinelPurged(): boolean {
  const previous = sentinel;
  if (previous === null) return false;
  try {
    const alpha = surfaceContext(previous).getImageData(0, 0, 1, 1).data[ALPHA_CHANNEL];
    return alpha < SENTINEL_MIN_ALPHA;
  } catch {
    return true;
  }
}

function anyProbePurged(): boolean {
  for (const probe of probes) {
    try {
      if (probe()) return true;
    } catch (error) {
      // A probe that cannot get a context has found memory exhausted, not
      // pixels lost; repainting everything would only make that worse.
      if (error instanceof CanvasContextUnavailableError) {
        reportCanvasAllocationFailure();
        continue;
      }
      return true;
    }
  }
  return false;
}

function runPurgeCheck(nowMs: number): void {
  const purged = sentinelPurged() || anyProbePurged();
  releaseSentinel();
  sentinel = paintSentinel();
  if (purged) {
    requestCanvasRecovery('purged');
    checkIntervalMs = Math.min(checkIntervalMs * 2, MAX_PURGE_CHECK_INTERVAL_MS);
  } else {
    checkIntervalMs = CANVAS_PURGE_CHECK_INTERVAL_MS;
    if (sentinel === null) reportCanvasAllocationFailure();
  }
  nextCheckAtMs = nowMs + checkIntervalMs;
}

/**
 * Runs every registered rebuild now. Exposed for a harness; the game goes
 * through {@link beginCanvasRecoveryFrame}.
 */
export function runCanvasRecovery(cause: CanvasRecoveryCause): void {
  pendingCause = null;
  generation += 1;
  recoveriesRun += 1;
  for (const handler of handlers) {
    // One cache that cannot rebuild must not stop the others from trying.
    try {
      handler(cause);
    } catch (error) {
      console.warn('[canvasRecovery] a cache failed to rebuild', error);
    }
  }
}

/**
 * Starts a render frame: runs a requested recovery, or the periodic purge check
 * when it is due. Called once per frame before anything is drawn.
 */
export function beginCanvasRecoveryFrame(nowMs: number): void {
  if (pendingCause === null && nowMs >= nextCheckAtMs) runPurgeCheck(nowMs);
  const cause = pendingCause;
  if (cause === null) return;
  if (cause === 'memoryPressure') {
    if (nowMs - lastMemoryPressureRecoveryMs < MEMORY_PRESSURE_RECOVERY_SPACING_MS) {
      pendingCause = null;
      return;
    }
    lastMemoryPressureRecoveryMs = nowMs;
  }
  runCanvasRecovery(cause);
}

/**
 * Listens for the events that mean the canvases may have been lost: the page
 * coming back from the background, and the visible canvas's own context loss.
 *
 * `onMainContextRestored` re-establishes whatever state the visible canvas's
 * context held, which a restored context has forgotten along with its pixels.
 */
export function watchForCanvasLoss(
  mainCanvas: HTMLCanvasElement,
  onMainContextRestored: () => void,
): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkCanvasesSoon();
  });
  window.addEventListener('pageshow', (event) => {
    // A page restored from the back-forward cache has been frozen whole, and
    // nothing promises its GPU surfaces survived the freeze.
    if (event.persisted) requestCanvasRecovery('purged');
    else checkCanvasesSoon();
  });
  mainCanvas.addEventListener('contextlost', () => checkCanvasesSoon());
  mainCanvas.addEventListener('contextrestored', () => {
    onMainContextRestored();
    requestCanvasRecovery('purged');
  });
}
