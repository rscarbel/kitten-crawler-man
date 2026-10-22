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
 * cleared under it. At most one recovery runs per frame.
 *
 * A GPU context loss is answered once. `contextlost` holds every check and
 * recovery until `contextrestored` (or {@link CONTEXT_RESTORE_TIMEOUT_MS}),
 * because anything repainted while the context is lost is painted into nothing
 * and has to be painted again. Each loss begun while the page is visible also
 * lowers what the game asks of the device — one variety tier, and as a last
 * resort the cache budgets — so the repaint does not climb straight back to the
 * memory that was just lost. A purge found on returning from the background, a
 * context lost while the page is hidden, and a page thawed from the back-forward
 * cache are the exception: mobile browsers drop a hidden tab's canvases and
 * Android Chrome a backgrounded app's GPU context as a matter of course, and a
 * thawed page's surfaces are only suspected lost, so each repaints without
 * asking for less.
 *
 * What a recovery repaints and what it lowers demand for are kept apart: the
 * pending recovery owes a count of purge steps, one per loss or purge that asked
 * for less, and separately whether memory pressure asked. A repaint that asks
 * for no less can still carry a memory-pressure request that arrived beside it,
 * and that lowers as memory pressure — one tier, never a purge toward the budget
 * cut.
 */

import {
  allocCanvas,
  CanvasContextUnavailableError,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
} from './canvasSurface';
import { cutMemoryBudgetsForSession } from './deviceMemoryBudget';
import { MINIMAL_VARIETY_TIER, stepVarietyTierDown, varietyTier } from './varietyTier';

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
 * The longest a repeating purge may stretch the check interval to. A browser
 * that perturbs readbacks for privacy could flag a purge on every check, and a
 * context that stays lost behind a refused sentinel is found lost at every
 * other one; doubling the interval after each purge found keeps either from
 * repainting the world at every {@link CANVAS_PURGE_CHECK_INTERVAL_MS}.
 */
export const MAX_PURGE_CHECK_INTERVAL_MS = 64000;

/**
 * Least time between two memory-pressure recoveries. Dropping caches frees
 * memory only for as long as it takes to rebuild them, so a device that is
 * genuinely out of canvas memory would otherwise flush every frame.
 */
export const MEMORY_PRESSURE_RECOVERY_SPACING_MS = 30000;

/**
 * Longest a lost context is waited on before recovering without it. Chrome
 * restores a lost context within a frame or two when it can; a browser that
 * never fires `contextrestored` must not leave the world blank for good.
 */
export const CONTEXT_RESTORE_TIMEOUT_MS = 2000;

/**
 * Purges answered at the minimal variety tier before the cache budgets are cut
 * for the session. One can be a backgrounded tab or a driver hiccup; a second
 * says even the fewest looks are more than this device can hold.
 */
export const PURGES_AT_MINIMAL_TIER_BEFORE_BUDGET_CUT = 2;

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
/** What the next frame's recovery repaints, or null when none is pending. */
let pendingCause: CanvasRecoveryCause | null = null;
/**
 * Tier steps the pending recovery owes for purges: one per loss or purge that
 * asked for less, so two losses restored before one frame step twice.
 */
let purgeStepsOwed = 0;
/**
 * Whether memory pressure asked the pending recovery for less. Never set while
 * a purge step is owed: a purge already asks for less, and memory pressure
 * beside it is the same shortage.
 */
let memoryPressureStepOwed = false;
let nextCheckAtMs = 0;
let checkIntervalMs = CANVAS_PURGE_CHECK_INTERVAL_MS;
let lastMemoryPressureRecoveryMs = Number.NEGATIVE_INFINITY;
let sentinel: CanvasSurface | null = null;
let recoveriesRun = 0;
let purgesAtMinimalTier = 0;
/**
 * Whether the next purge check is the first since the page became visible
 * again. A mobile browser purges a backgrounded tab's canvases as routine, so
 * a purge that check finds says nothing about this device's load.
 */
let checkFollowsReturnToForeground = false;
let readPageHidden: () => boolean = () => false;

/**
 * Where a GPU context loss stands.
 *
 * `none` — no loss is open.
 * `awaitingRestore` — lost; frames are held until restore or the timeout.
 * `deadlineMs` is set on the first held frame, so the wait is measured on the
 * frame clock. `owesStep` is whether the loss will ask for less when it is
 * answered: false for one begun while the page was hidden.
 * `restoreOverdue` — the timeout passed and the world was repainted without a
 * restore, which answered the loss; a restore arriving now still means
 * everything painted since was lost.
 * `closedUnconfirmed` — an overdue loss closed on a refused sentinel, with
 * nothing showing the context back. Frames are not held, but a purge found is
 * taken for that same loss still open rather than a new one, so one loss cannot
 * step the tier again at every check.
 */
type ContextLoss =
  | { readonly phase: 'none' }
  | {
      readonly phase: 'awaitingRestore';
      readonly deadlineMs: number | null;
      readonly owesStep: boolean;
    }
  | { readonly phase: 'restoreOverdue' }
  | { readonly phase: 'closedUnconfirmed' };

const NO_LOSS = { phase: 'none' } as const satisfies ContextLoss;
const RESTORE_OVERDUE = { phase: 'restoreOverdue' } as const satisfies ContextLoss;
const CLOSED_UNCONFIRMED = { phase: 'closedUnconfirmed' } as const satisfies ContextLoss;

let contextLoss: ContextLoss = NO_LOSS;

/**
 * Bumped on every recovery. An instance cache records it when built and drops
 * its surfaces when it no longer matches.
 */
export function canvasGeneration(): number {
  return generation;
}

/** Recoveries run since the module loaded, for a harness to count. */
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

/**
 * Whether the open loss has already asked for less, or never will: memory
 * pressure now is that loss's shortage, not news of another.
 */
function openLossAnswered(): boolean {
  switch (contextLoss.phase) {
    case 'awaitingRestore':
      return !contextLoss.owesStep;
    case 'restoreOverdue':
      return true;
    case 'none':
    case 'closedUnconfirmed':
      return false;
  }
}

/** Asks for a full repaint at the next frame boundary that steps the tier for a purge. */
function requestPurgeStep(): void {
  pendingCause = 'purged';
  purgeStepsOwed += 1;
  memoryPressureStepOwed = false;
}

/**
 * Asks for a full repaint at the next frame boundary that leaves the variety
 * tier and the cache budgets where they are: for pixels that may have been lost
 * but were not seen to be, or for a loss whose lowered demand is already taken.
 */
function requestRepaintWithoutLoweringDemand(): void {
  pendingCause = 'purged';
}

/**
 * For a cache that failed to allocate or acquire a surface: the browser's canvas
 * memory is exhausted, and dropping what can be rebuilt is the only way back.
 *
 * Whether it asks for less is judged now and only now: a surface refused during
 * a loss is that loss even when the recovery waits until the loss has closed,
 * and one refused before a loss began is not, however that loss ends.
 */
export function reportCanvasAllocationFailure(): void {
  pendingCause ??= 'memoryPressure';
  if (purgeStepsOwed === 0 && !openLossAnswered()) memoryPressureStepOwed = true;
}

/** Brings the next purge check forward to the coming frame. */
export function checkCanvasesSoon(): void {
  nextCheckAtMs = 0;
}

function noteReturnToForeground(): void {
  checkFollowsReturnToForeground = true;
  checkCanvasesSoon();
}

/** Which canvas reported a context loss. */
type LossSource = 'main' | 'sentinel';

function openFreshLoss(): void {
  contextLoss = { phase: 'awaitingRestore', deadlineMs: null, owesStep: !readPageHidden() };
}

/**
 * A context lost while a loss is open — the main canvas after the sentinel, or
 * a sentinel painted while still lost — is the same loss, and does not start
 * the wait over: once overdue, waiting again would only repaint into a lost
 * context every timeout.
 *
 * The main canvas is the exception once a loss is overdue or closed
 * unconfirmed. Its context cannot be lost twice without a restore between, and
 * its restore always ends the loss, so its loss now is either a fresh one or
 * one the open loss never reached: either way a new loss, answered on its own.
 */
function noteContextLost(source: LossSource): void {
  switch (contextLoss.phase) {
    case 'none':
      openFreshLoss();
      return;
    case 'awaitingRestore':
      return;
    case 'restoreOverdue':
      if (source === 'main') openFreshLoss();
      return;
    case 'closedUnconfirmed':
      if (source === 'main') openFreshLoss();
      else contextLoss = RESTORE_OVERDUE;
      return;
  }
}

/**
 * The first restore after a loss closes it with one recovery, which asks for
 * less only if the loss still owes its step. Every other restore — another
 * canvas restoring in the same loss, or any canvas's after the loss closed —
 * finds no loss open and does nothing.
 */
function noteContextRestored(): void {
  const closing = contextLoss;
  if (closing.phase === 'none') return;
  contextLoss = NO_LOSS;
  if (closing.phase === 'awaitingRestore' && closing.owesStep) requestPurgeStep();
  else requestRepaintWithoutLoweringDemand();
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
      surface.addEventListener('contextlost', () => noteContextLost('sentinel'));
      surface.addEventListener('contextrestored', noteContextRestored);
    }
    return surface;
  } catch {
    releaseSurface(surface);
    return null;
  }
}

function replaceSentinel(): void {
  releaseSentinel();
  sentinel = paintSentinel();
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

/** Reads the sentinel and the probes for a purge, then paints the next sentinel. */
function readForPurge(): { purged: boolean; sentinelHeld: boolean } {
  const sentinelWasPainted = sentinel !== null;
  const sentinelLost = sentinelPurged();
  const purged = sentinelLost || anyProbePurged();
  replaceSentinel();
  return { purged, sentinelHeld: sentinelWasPainted && !sentinelLost };
}

function scheduleNextCheck(nowMs: number, purgeFound: boolean): void {
  checkIntervalMs = purgeFound
    ? Math.min(checkIntervalMs * 2, MAX_PURGE_CHECK_INTERVAL_MS)
    : CANVAS_PURGE_CHECK_INTERVAL_MS;
  nextCheckAtMs = nowMs + checkIntervalMs;
}

/** Answers what a check with no loss open found. */
function settleRegularCheck(nowMs: number, purged: boolean, asksForNoLess: boolean): void {
  if (purged && asksForNoLess) requestRepaintWithoutLoweringDemand();
  else if (purged) requestPurgeStep();
  else if (sentinel === null) reportCanvasAllocationFailure();
  scheduleNextCheck(nowMs, purged);
}

/**
 * The check while a restore is overdue. The context is still lost while the
 * sentinel painted at the last check reads blank, and repainting into it would
 * only be lost again. The first sentinel that holds its pixels says the context
 * came back without telling anyone, so everything painted since the loss is
 * repainted once, at the demand the loss already lowered.
 *
 * A sentinel the browser refused says memory is short, not that the context is
 * still lost, and the probes cannot settle it: what they read was repainted
 * into the lost context on the timeout, so it reads blank either way. Holding
 * the loss open on that would hold it open for as long as memory stays short,
 * so the loss closes, unconfirmed.
 */
function runOverdueCheck(nowMs: number): void {
  const sentinelRefused = sentinel === null;
  if (sentinelRefused) reportCanvasAllocationFailure();
  const stillLost = !sentinelRefused && sentinelPurged();
  replaceSentinel();
  // An overdue check reads one pixel and repaints nothing while the context
  // stays lost, so backing it off would only leave the world blank for longer
  // after a silent return.
  nextCheckAtMs = nowMs + CANVAS_PURGE_CHECK_INTERVAL_MS;
  if (stillLost) return;
  contextLoss = sentinelRefused ? CLOSED_UNCONFIRMED : NO_LOSS;
  requestRepaintWithoutLoweringDemand();
}

/**
 * The check after a loss closed unconfirmed. A sentinel holding says the
 * context is back, so a purge found beside it is what the loss left blank, not
 * news of a new one. A purge found with no sentinel holding is the loss still
 * open: it reopens overdue and answered, so the next check waits on its
 * sentinel rather than repainting into the lost context or asking for less a
 * second time. A sentinel refused here is reported before the loss reopens, so
 * it asks for less as the memory pressure it is.
 */
function runUnconfirmedCheck(nowMs: number): void {
  const { purged, sentinelHeld } = readForPurge();
  if (sentinelHeld) {
    contextLoss = NO_LOSS;
    settleRegularCheck(nowMs, purged, true);
    return;
  }
  if (!purged) {
    settleRegularCheck(nowMs, purged, false);
    return;
  }
  if (sentinel === null) reportCanvasAllocationFailure();
  contextLoss = RESTORE_OVERDUE;
  scheduleNextCheck(nowMs, true);
}

function runPurgeCheck(nowMs: number): void {
  const followsReturnToForeground = checkFollowsReturnToForeground;
  checkFollowsReturnToForeground = false;
  switch (contextLoss.phase) {
    case 'none': {
      const { purged } = readForPurge();
      settleRegularCheck(nowMs, purged, followsReturnToForeground);
      return;
    }
    case 'awaitingRestore':
      // Unreachable: a frame that is held runs no check.
      return;
    case 'restoreOverdue':
      runOverdueCheck(nowMs);
      return;
    case 'closedUnconfirmed':
      runUnconfirmedCheck(nowMs);
      return;
  }
}

/**
 * Runs every registered rebuild now. Exposed for a harness; the game goes
 * through {@link beginCanvasRecoveryFrame}. `lowerFor` is what demand is lowered
 * for, which may differ from the `cause` repainted; null for a repaint that asks
 * the device for no less. Left out, it is judged as a request made now would
 * be: memory pressure during an answered loss lowers nothing.
 */
export function runCanvasRecovery(
  cause: CanvasRecoveryCause,
  lowerFor: CanvasRecoveryCause | null = cause === 'memoryPressure' && openLossAnswered()
    ? null
    : cause,
): void {
  recoverNow(cause, lowerFor === 'purged' ? 1 : 0, lowerFor === 'memoryPressure');
}

/**
 * The recovery itself. What it lowers is final here: whether a memory-pressure
 * request lowers anything was settled when it was requested, and is not judged
 * again against a loss that may have opened or closed since.
 */
function recoverNow(
  cause: CanvasRecoveryCause,
  purgeSteps: number,
  memoryPressureStep: boolean,
): void {
  pendingCause = null;
  purgeStepsOwed = 0;
  memoryPressureStepOwed = false;
  generation += 1;
  recoveriesRun += 1;
  // Before the handlers, so whatever they rebuild is built at the lowered demand.
  for (let step = 0; step < purgeSteps; step++) lowerDemandForPurge();
  if (memoryPressureStep) stepVarietyTierDown();
  // The sentinel may have been painted before the pixels went; read later, it
  // would report this same purge again. A return to the foreground pending its
  // check is answered by this repaint too, so the next purge found is news.
  if (cause === 'purged') {
    checkFollowsReturnToForeground = false;
    replaceSentinel();
  }
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
 * Asks the device for less after a purge: one variety tier, and once purges
 * keep coming at the minimal tier, smaller caches for the rest of the session.
 */
function lowerDemandForPurge(): void {
  if (varietyTier() !== MINIMAL_VARIETY_TIER) {
    stepVarietyTierDown();
    return;
  }
  purgesAtMinimalTier += 1;
  if (purgesAtMinimalTier >= PURGES_AT_MINIMAL_TIER_BEFORE_BUDGET_CUT) {
    cutMemoryBudgetsForSession();
  }
}

/**
 * Holds the frame's checks and recoveries while a lost context is awaited.
 * Returns whether they are still held; once the timeout passes, the wait ends
 * with the one recovery it owes.
 */
function holdingForRestore(nowMs: number): boolean {
  if (contextLoss.phase !== 'awaitingRestore') return false;
  const deadlineMs = contextLoss.deadlineMs ?? nowMs + CONTEXT_RESTORE_TIMEOUT_MS;
  if (nowMs < deadlineMs) {
    contextLoss = { ...contextLoss, deadlineMs };
    return true;
  }
  const owesStep = contextLoss.owesStep;
  contextLoss = RESTORE_OVERDUE;
  if (owesStep) requestPurgeStep();
  else requestRepaintWithoutLoweringDemand();
  return false;
}

/**
 * Starts a render frame: runs a requested recovery, or the periodic purge check
 * when it is due. Called once per frame before anything is drawn.
 */
export function beginCanvasRecoveryFrame(nowMs: number): void {
  if (holdingForRestore(nowMs)) return;
  // A pending repaint would only be found again, as a purge asking for less. A
  // memory-pressure request must not hold the check off: a surface refused every
  // frame would otherwise keep it from ever running.
  const repaintPending = pendingCause === 'purged';
  if (!repaintPending && nowMs >= nextCheckAtMs) runPurgeCheck(nowMs);
  const cause = pendingCause;
  if (cause === null) return;
  // A memory-pressure request is spaced out whether it runs alone or rides on a
  // repaint: inside the spacing a repaint still runs but lowers nothing for it.
  let memoryPressureStep = memoryPressureStepOwed;
  const memoryPressureInvolved = cause === 'memoryPressure' || memoryPressureStep;
  if (memoryPressureInvolved) {
    const tooSoon = nowMs - lastMemoryPressureRecoveryMs < MEMORY_PRESSURE_RECOVERY_SPACING_MS;
    if (tooSoon && cause === 'memoryPressure') {
      pendingCause = null;
      memoryPressureStepOwed = false;
      return;
    }
    if (tooSoon) memoryPressureStep = false;
    else lastMemoryPressureRecoveryMs = nowMs;
  }
  recoverNow(cause, purgeStepsOwed, memoryPressureStep);
}

/**
 * Listens for the events that mean the canvases may have been lost: the page
 * coming back from the background, and the visible canvas's own context loss.
 *
 * `onMainContextRestored` re-establishes whatever state the visible canvas's
 * context held, which a restored context has forgotten along with its pixels.
 * `pageHidden` is read when a loss begins; a harness passes its own.
 */
export function watchForCanvasLoss(
  mainCanvas: EventTarget,
  onMainContextRestored: () => void,
  pageHidden: () => boolean = () => document.visibilityState === 'hidden',
): void {
  readPageHidden = pageHidden;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') noteReturnToForeground();
  });
  window.addEventListener('pageshow', (event) => {
    // A page restored from the back-forward cache has been frozen whole, and
    // nothing promises its GPU surfaces survived the freeze. Nothing says they
    // did not either, so the device is not taken to be struggling.
    if (event.persisted) requestRepaintWithoutLoweringDemand();
    else checkCanvasesSoon();
  });
  mainCanvas.addEventListener('contextlost', () => noteContextLost('main'));
  mainCanvas.addEventListener('contextrestored', () => {
    onMainContextRestored();
    noteContextRestored();
  });
}
