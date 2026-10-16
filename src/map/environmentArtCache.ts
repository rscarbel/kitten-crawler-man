/**
 * Runtime-painted environment art: the sheets the game paints for itself rather
 * than shipping as PNGs, one floor at a time, from that floor's art seed.
 *
 * A sheet is requested as a *plan* — its geometry plus an ordered list of steps
 * that each paint one piece into it — and the cache drains those steps a few
 * milliseconds at a time across render frames. Nothing is published to
 * `SpriteLoader` until the steps a plan calls *ready* have run, which is all of
 * them unless the plan says otherwise: until then the ground renderer falls back
 * to each material's mean colour exactly as it does for a sheet still in flight
 * over the network. A plan that names fewer is one whose first rows are the ones
 * anything actually draws — a forest's idle trees, a facade before its lit
 * windows — and the rest fills in behind art the player can already see.
 *
 * The pacing follows `figureFrameCache`'s prewarm queue, including the rule that
 * makes it a budget at all: a step's expected cost is checked *before* it starts,
 * because a step cannot be stopped half way, and what is honoured is the mean —
 * an over-budget step is repaid out of the frames after it.
 */

import {
  allocCanvas,
  CanvasContextUnavailableError,
  surfaceContext,
  type CanvasSurface,
} from '../core/canvasSurface';
import { onCanvasRecovery, reportCanvasAllocationFailure } from '../core/canvasRecovery';
import { floorArtSeed } from './ground/floorArtSeed';
import {
  registerPaintedSprite,
  shouldDownscaleForLowEndDevice,
  unregisterPaintedSprite,
  DOWNSCALE_FACTOR,
  type SpriteKey,
} from '../core/SpriteLoader';

/**
 * Milliseconds of painting the cache may spend on a render frame, on average.
 *
 * Read as an average rather than a ceiling for the same reason the figure cache
 * does: the most expensive single ground patch costs tens of milliseconds and
 * cannot be split, so a strictly-honoured per-frame ceiling would refuse it
 * forever. An overspend is booked as debt and paid back by skipping the frames
 * that follow, so what a frame actually sees is a bounded spike rather than a
 * stall, and the queue's throughput is this number per frame however the work
 * happens to be lumped.
 *
 * Much larger than the figure cache's share, because the two are paying for
 * different things. A figure the cache has not warmed yet still draws — the
 * painter runs straight into the frame — so prewarming can afford to trickle. A
 * sheet that has not landed does not draw at all: a floor sits in flat fallback
 * colour with nothing standing on it, which is the most visible surface in the
 * game. A floor's ground is 350–450 ms of painting and the town's facades add
 * two seconds; at this budget the ground arrives inside a second of entering a
 * floor rather than after twenty, and the buildings fill in from the street the
 * player is standing in outward. Half a frame at 60 Hz, spent while a floor is
 * fading in and nothing else is competing for it.
 */
export const ENVIRONMENT_PAINT_BUDGET_MS = 8;

/**
 * Weight the newest measurement carries in a step class's cost estimate. Low,
 * because the estimate answers "will this fit in what is left of the allowance"
 * and the steps it matters for cost the same every time; a high weight would let
 * one step that landed beside a garbage collection set the next frames' pacing.
 */
const PAINT_COST_SMOOTHING = 0.25;

const BYTES_PER_PIXEL = 4;

/**
 * How long a sheet the browser refused a surface for waits before it is asked
 * for again. Canvas memory comes back only as other caches give theirs up, so
 * asking on every frame would fail on every frame; a few seconds lets the
 * memory-pressure recovery the refusal sets off run first.
 */
const DEFERRED_SHEET_RETRY_MS = 5000;

/** One piece of a sheet: a material's patch, a prop's frame row, a facade. */
export interface PaintStep {
  /**
   * Steps sharing a class are assumed to cost the same, so the first of a class
   * teaches the queue what the rest will cost. Two ground patches of the same
   * material are one class; two different materials are not.
   */
  readonly costClass: string;
  paint(ctx: CanvasRenderingContext2D): void;
}

export interface EnvironmentSheetPlan {
  /** Manifest key the finished sheet is published under. */
  readonly key: SpriteKey;
  /** Sheet size at full density, before any low-end-device downscale. */
  readonly widthPx: number;
  readonly heightPx: number;
  readonly steps: ReadonlyArray<PaintStep>;
  /**
   * Steps that must land before the sheet may be drawn at all. Defaults to every
   * one of them.
   *
   * A sheet whose first rows are the ones a scene actually shows can be published
   * early and keep painting into the same surface: a forest's idle trees arrive
   * in the first second of a floor, and its burning and felling rows — twenty-four
   * frames per tree that most trees never play — fill in behind them. A row drawn
   * before it is painted is transparent for a frame or two, which is what the
   * animation rows can afford and the idle row cannot.
   */
  readonly readySteps?: number;
  /**
   * Whether this sheet's art is derived from the floor's art seed, and so must
   * be repainted when the floor changes. False for the pieces that are the same
   * on every floor — the corner masks, whose geometry is proved safe as a set
   * rather than per floor — which is what lets them survive the stairs.
   */
  readonly variesWithFloorSeed: boolean;
  /**
   * Run once the sheet is first drawable — after `readySteps`, which is every
   * step unless the plan says otherwise. A sheet with rows still owed fires this
   * while it is still painting, which is the point: what the callback exists for
   * is re-baking tile chunks that took a fallback colour, and the rows those
   * chunks draw are the ready ones.
   */
  onReady?: () => void;
  /**
   * Run once when the sheet leaves the queue, whether its last step landed or a
   * painter threw and it was abandoned.
   *
   * `onReady` is about drawing — it fires when there is something to draw. This
   * is about *sequencing*: a caller that queues its sheets one at a time needs a
   * signal that cannot be skipped, or one bad sheet stops every sheet behind it.
   */
  onSettled?: () => void;
  /**
   * Builds a fresh plan for this sheet, without callbacks, for repainting it
   * after the browser discards its pixels. Omit it when the steps are pure and
   * can simply run again; a plan whose steps consume what they paint from must
   * supply one.
   */
  readonly replan?: () => EnvironmentSheetPlan;
  /**
   * Gives back whatever the plan allocated up front to paint from, for a sheet
   * dropped before its steps used it up. Omit it when the steps allocate
   * nothing ahead of themselves.
   */
  readonly release?: () => void;
}

interface PendingSheet {
  readonly plan: EnvironmentSheetPlan;
  readonly surface: CanvasSurface;
  readonly ctx: CanvasRenderingContext2D;
  readonly scale: number;
  readonly artSeed: number;
  nextStep: number;
  published: boolean;
  /** Painted again after a purge, so landing bumps {@link repaintedSheetRevision}. */
  replayed: boolean;
  /**
   * No step is painted before this wall-clock time: set when a step of a
   * published sheet was refused a surface, so the rows it still owes are
   * painted later rather than retried on every frame.
   */
  retryAtMs: number;
}

/**
 * How to paint a sheet again: its own `replan`, or else the same steps, which
 * are then pure. Never the callbacks — a sheet that outlives its floor would
 * hold that floor's scene alive through them — so a repainted sheet announces
 * itself through {@link repaintedSheetRevision} instead.
 */
function replanOf(plan: EnvironmentSheetPlan): () => EnvironmentSheetPlan {
  const ownReplan = plan.replan;
  if (ownReplan !== undefined) return ownReplan;
  const bare: EnvironmentSheetPlan = {
    key: plan.key,
    widthPx: plan.widthPx,
    heightPx: plan.heightPx,
    steps: plan.steps,
    readySteps: plan.readySteps,
    variesWithFloorSeed: plan.variesWithFloorSeed,
  };
  return () => bare;
}

interface ResidentSheet {
  /** Builds the sheet's plan again, if the browser discards its pixels. */
  readonly replan: () => EnvironmentSheetPlan;
  readonly surface: CanvasSurface;
  readonly bytes: number;
  readonly variesWithFloorSeed: boolean;
  /** The floor art seed this sheet's pixels were painted under. */
  readonly artSeed: number;
}

const resident = new Map<string, ResidentSheet>();
const pending = new Map<string, PendingSheet>();
/** Drained in request order, so a floor's ground arrives before its scenery. */
const queue: string[] = [];
const costByClass = new Map<string, number>();

let msPaintedThisFrame = 0;
let paintDebtMs = 0;
/** Every step ever painted, so a loading screen can measure progress as a difference. */
let stepsPaintedTotal = 0;

/**
 * Density the sheets are painted at. The generated tiles are authored at 64px
 * for a 32px tile — already supersampled — so full density is 1:1 with the
 * sheets they replace, and a low-end device halves them exactly as
 * `downscaleSheet` halves a fetched sheet.
 */
function paintScaleNow(): number {
  return shouldDownscaleForLowEndDevice() ? DOWNSCALE_FACTOR : 1;
}

/**
 * Drops a sheet that was painted under a different floor art seed than the one
 * now in force.
 *
 * The invariant this defends — a floor's art matches the floor's seed — cannot
 * be left to the release call sites, because a new `GameMap` is built by more
 * paths than the stairs: a death restart and the dev level jump each draw a
 * fresh seed without a floor transition to hang an eviction on. Checked where
 * the staleness would actually bite instead, so a path that forgets to release
 * repaints rather than showing the last floor's grain.
 */
function dropIfStale(key: string): void {
  const current = floorArtSeed();
  const residentSheet = resident.get(key);
  if (
    residentSheet !== undefined &&
    residentSheet.variesWithFloorSeed &&
    residentSheet.artSeed !== current
  ) {
    drop(key, residentSheet.surface);
    resident.delete(key);
  }
  const pendingSheet = pending.get(key);
  if (
    pendingSheet !== undefined &&
    pendingSheet.plan.variesWithFloorSeed &&
    pendingSheet.artSeed !== current
  ) {
    if (!pendingSheet.published) pendingSheet.plan.release?.();
    drop(key, pendingSheet.surface);
    pending.delete(key);
    const queued = queue.indexOf(key);
    if (queued >= 0) queue.splice(queued, 1);
  }
}

/**
 * What a request did, for a caller that queues its sheets one at a time.
 *
 * `alreadyPainted` is not a failure — re-entering a floor from a building asks
 * for everything again — but it is the one outcome that fires no `onSettled`,
 * because there is nothing left to settle.
 *
 * `deferred` means the browser refused the sheet a surface. It is settled at
 * once, so a caller queueing one sheet at a time carries on with the next, and
 * the cache asks for it again itself once memory may have come back.
 */
export type SheetRequestOutcome = 'queued' | 'alreadyQueued' | 'alreadyPainted' | 'deferred';

/** A sheet the browser refused a surface for, waiting to be asked for again. */
interface DeferredSheet {
  readonly replan: () => EnvironmentSheetPlan;
  readonly variesWithFloorSeed: boolean;
  /** The floor art seed it was asked for under; one for another floor is let go. */
  readonly artSeed: number;
}

const deferred = new Map<string, DeferredSheet>();
let deferredRetryAtMs = 0;

/**
 * Holds a sheet that could not be given a surface, to be asked for again after
 * {@link DEFERRED_SHEET_RETRY_MS} or the next canvas recovery, whichever is
 * first. For a caller whose own planning was refused a surface, as well as for
 * a refused request: either way the sheet must not be silently lost.
 */
export function deferEnvironmentSheet(
  key: string,
  variesWithFloorSeed: boolean,
  replan: () => EnvironmentSheetPlan,
): void {
  deferred.set(key, { replan, variesWithFloorSeed, artSeed: floorArtSeed() });
  deferredRetryAtMs = performance.now() + DEFERRED_SHEET_RETRY_MS;
  reportCanvasAllocationFailure();
}

/** Moves the deferred sheets onto the repaint queue once their wait is over. */
function retryDeferredSheets(): void {
  if (deferred.size === 0 || performance.now() < deferredRetryAtMs) return;
  const current = floorArtSeed();
  for (const [key, sheet] of deferred) {
    if (sheet.variesWithFloorSeed && sheet.artSeed !== current) continue;
    replays.push({ key, replan: sheet.replan, variesWithFloorSeed: sheet.variesWithFloorSeed });
  }
  deferred.clear();
}

/**
 * Sheets owed but not yet queued: repaints waiting their turn after a purge,
 * and sheets the browser refused a surface for. For the `?perf` readout, which
 * would otherwise show nothing owed while they are missing from the world.
 */
export function environmentSheetsAwaiting(): number {
  return replays.length + deferred.size;
}

/** Sheets queued for painting now. For the `?perf` readout. */
export function environmentSheetsQueued(): number {
  return pending.size;
}

/**
 * Queues a sheet to be painted, unless it is already resident or already
 * queued. Cheap to call on every floor entry.
 */
export function requestEnvironmentSheet(plan: EnvironmentSheetPlan): SheetRequestOutcome {
  dropIfStale(plan.key);
  if (resident.has(plan.key) && !pending.has(plan.key)) return 'alreadyPainted';
  if (pending.has(plan.key)) return 'alreadyQueued';
  const scale = paintScaleNow();
  const surface = allocCanvas(Math.round(plan.widthPx * scale), Math.round(plan.heightPx * scale));
  let ctx: CanvasRenderingContext2D;
  try {
    ctx = surfaceContext(surface);
  } catch (error) {
    surface.width = 0;
    surface.height = 0;
    if (!(error instanceof CanvasContextUnavailableError)) throw error;
    deferEnvironmentSheet(plan.key, plan.variesWithFloorSeed, replanOf(plan));
    // A bare replan reuses these steps and the surfaces they paint into.
    if (plan.replan !== undefined) plan.release?.();
    plan.onSettled?.();
    return 'deferred';
  }
  deferred.delete(plan.key);
  ctx.scale(scale, scale);
  pending.set(plan.key, {
    plan,
    surface,
    ctx,
    scale,
    artSeed: floorArtSeed(),
    nextStep: 0,
    published: false,
    replayed: false,
    retryAtMs: 0,
  });
  queue.push(plan.key);
  return 'queued';
}

/** Whether a sheet has been painted and published. */
export function hasEnvironmentSheet(key: string): boolean {
  return resident.has(key);
}

/** Steps still waiting to be painted, across every queued sheet. For gates and readouts. */
export function environmentPaintDepth(): number {
  let depth = 0;
  for (const sheet of pending.values()) depth += sheet.plan.steps.length - sheet.nextStep;
  return depth;
}

/** Bytes the painted sheets currently hold. For the `?perf` readout. */
export function environmentArtBytes(): number {
  let bytes = 0;
  for (const sheet of resident.values()) bytes += sheet.bytes;
  for (const sheet of pending.values()) {
    // A published sheet is still owed steps and is counted once, as resident:
    // both entries point at the same surface.
    if (sheet.published) continue;
    bytes += sheet.surface.width * sheet.surface.height * BYTES_PER_PIXEL;
  }
  return bytes;
}

/** Sheets painted and published, for the `?perf` readout. */
export function environmentArtSheetCount(): number {
  return resident.size;
}

function estimatedPaintMs(costClass: string): number | null {
  return costByClass.get(costClass) ?? null;
}

function recordPaintCost(costClass: string, elapsedMs: number): void {
  const previous = estimatedPaintMs(costClass);
  const smoothed =
    previous === null ? elapsedMs : previous + (elapsedMs - previous) * PAINT_COST_SMOOTHING;
  costByClass.set(costClass, smoothed);
}

/**
 * Whether a step may start with `spentMs` of a `budgetMs` allowance already
 * gone, once the frame's owed first step has run.
 *
 * The first step of a frame always runs (the callers see to that): a step whose
 * estimate exceeds the whole allowance would otherwise be refused on every frame
 * there will ever be, and the queue would never drain. A class nothing has been
 * painted of yet has no estimate to test, which costs one unavoidable overspend
 * per class rather than one per frame.
 */
function fitsPaintAllowance(costClass: string, spentMs: number, budgetMs: number): boolean {
  if (spentMs >= budgetMs) return false;
  const estimate = estimatedPaintMs(costClass);
  if (estimate === null) return true;
  return spentMs + estimate <= budgetMs;
}

/** Steps that must land before a plan's sheet may be drawn. */
function readyStepsOf(plan: EnvironmentSheetPlan): number {
  return Math.min(plan.readySteps ?? plan.steps.length, plan.steps.length);
}

function publish(sheet: PendingSheet): void {
  sheet.published = true;
  registerPaintedSprite(sheet.plan.key, sheet.surface, sheet.scale);
  resident.set(sheet.plan.key, {
    replan: replanOf(sheet.plan),
    surface: sheet.surface,
    bytes: sheet.surface.width * sheet.surface.height * BYTES_PER_PIXEL,
    variesWithFloorSeed: sheet.plan.variesWithFloorSeed,
    artSeed: sheet.artSeed,
  });
  if (sheet.replayed) repaintedRevision += 1;
  sheet.plan.onReady?.();
}

/** Sheets a painter has already thrown on, so the warning is logged once. */
const abandoned = new Set<string>();

/**
 * Stops painting a sheet whose painter threw, and decides what to do with what
 * it had already painted.
 *
 * A sheet that was never published is dropped: nothing has drawn it, and a
 * half-painted surface published later would be a hole in the world. One that
 * was already published is *kept* — it is drawable and correct as far as it got,
 * and for the family that publishes early that is a building with its walls and
 * without its lit windows, which is far better than a building that vanishes.
 * Either way the painting stops here and the caller is told.
 */
function abandon(key: string, sheet: PendingSheet, error: unknown): void {
  if (!abandoned.has(key)) {
    abandoned.add(key);
    console.warn(`[environmentArtCache] "${key}" was abandoned mid-paint`, error);
  }
  if (!sheet.published) {
    drop(key, sheet.surface);
    resident.delete(key);
    sheet.plan.release?.();
  }
  pending.delete(key);
  dequeue(key);
  // Told last, and told at all: a caller sequencing its sheets one at a time
  // would otherwise stop here and leave every sheet behind this one unqueued.
  sheet.plan.onSettled?.();
}

/**
 * Stops painting a sheet a step of which the browser refused a surface. Unlike
 * a painter's own failure this is no fault of the sheet: memory may be back in
 * a moment. An unpublished sheet is held to be painted again from the start
 * rather than lost for the floor; one already published stays queued with the
 * rows it still owes, held off until the wait is over or the next recovery.
 */
function deferMidPaint(key: string, sheet: PendingSheet): void {
  if (sheet.published) {
    // Kept painting where it stopped, on the surface already drawn from: its
    // remaining rows are owed, and `onSettled` waits until they are painted.
    sheet.retryAtMs = performance.now() + DEFERRED_SHEET_RETRY_MS;
    reportCanvasAllocationFailure();
    return;
  }
  drop(key, sheet.surface);
  resident.delete(key);
  sheet.plan.release?.();
  deferEnvironmentSheet(key, sheet.plan.variesWithFloorSeed, replanOf(sheet.plan));
  pending.delete(key);
  dequeue(key);
  sheet.plan.onSettled?.();
}

/** The first queued sheet not held off by {@link PendingSheet.retryAtMs}, or null. */
function nextPaintableKey(): string | null {
  const now = performance.now();
  for (let index = 0; index < queue.length;) {
    const key = queue[index];
    const sheet = pending.get(key);
    if (sheet === undefined) {
      queue.splice(index, 1);
      continue;
    }
    if (sheet.retryAtMs <= now) return key;
    index++;
  }
  return null;
}

function dequeue(key: string): void {
  const queued = queue.indexOf(key);
  if (queued >= 0) queue.splice(queued, 1);
}

/**
 * Paints queued steps until the next one would not fit `budgetMs`, and returns
 * the milliseconds spent. With `mustProgress`, the first step runs whatever it
 * is expected to cost.
 */
function drainQueue(budgetMs: number, mustProgress: boolean): number {
  let spentMs = 0;
  let startedAny = false;
  for (let key = nextPaintableKey(); key !== null; key = nextPaintableKey()) {
    const sheet = pending.get(key);
    if (sheet === undefined) continue;
    const step = sheet.plan.steps[sheet.nextStep];
    const owedFirstStep = mustProgress && !startedAny;
    if (!owedFirstStep && !fitsPaintAllowance(step.costClass, spentMs, budgetMs)) return spentMs;
    startedAny = true;
    const startedAt = performance.now();
    let painted = false;
    try {
      sheet.ctx.save();
      try {
        step.paint(sheet.ctx);
        painted = true;
      } finally {
        // A painter that throws must not leave the sheet holding its transform
        // and its half-applied state for the next step to paint under.
        sheet.ctx.restore();
      }
    } catch (error) {
      // Contained here rather than allowed out: this runs from the render loop's
      // frame boundary, so an escaping throw takes the whole game down over one
      // unpaintable sheet. The sheet is abandoned instead of published with a
      // hole in it — an abandoned sheet draws as the fallback colour every
      // material already declares, which is a floor that looks flat rather than
      // a floor with a gap in it. A refused surface is the browser's doing,
      // not the painter's, and is waited out instead.
      if (error instanceof CanvasContextUnavailableError) deferMidPaint(key, sheet);
      else abandon(key, sheet, error);
    } finally {
      const elapsed = performance.now() - startedAt;
      spentMs += elapsed;
      msPaintedThisFrame += elapsed;
      recordPaintCost(step.costClass, elapsed);
      if (painted) {
        sheet.nextStep += 1;
        stepsPaintedTotal += 1;
      }
    }
    if (!painted) continue;
    if (!sheet.published && sheet.nextStep >= readyStepsOf(sheet.plan)) publish(sheet);
    if (sheet.nextStep >= sheet.plan.steps.length) {
      // By key rather than by shifting the head: a settled sheet's callback may
      // queue the next one, and the head is only still this sheet by accident.
      dequeue(key);
      pending.delete(key);
      sheet.plan.onSettled?.();
    }
  }
  return spentMs;
}

/**
 * Starts a render frame: spends this frame's share of the paint allowance on
 * whatever sheets are still owed, after paying back any earlier overspend.
 */
export function beginEnvironmentArtFrame(): void {
  msPaintedThisFrame = 0;
  retryDeferredSheets();
  requestNextReplay();
  if (paintDebtMs > 0) {
    paintDebtMs = Math.max(0, paintDebtMs - ENVIRONMENT_PAINT_BUDGET_MS);
    return;
  }
  try {
    drainQueue(ENVIRONMENT_PAINT_BUDGET_MS, true);
  } finally {
    // However the frame ended, what it ran over by is owed back — a painter
    // that threw has still spent the time.
    paintDebtMs += Math.max(0, msPaintedThisFrame - ENVIRONMENT_PAINT_BUDGET_MS);
  }
}

/**
 * Paints owed steps for up to `budgetMs`, on top of the frame's own paced share.
 *
 * For a caller that owns the whole frame — a loading screen with nothing of the
 * world on screen behind it — and so can afford to drain faster than a floor
 * that is already being played. Honours `budgetMs` as a ceiling rather than a
 * mean: a step is started only if its class's measured cost fits what is left,
 * except the first when `mustProgress` says nothing else has run this frame.
 * Books no debt, since the caller is the one pacing itself.
 */
export function paintEnvironmentArtFor(budgetMs: number, mustProgress: boolean): void {
  retryDeferredSheets();
  requestNextReplay();
  drainQueue(budgetMs, mustProgress);
}

/** Steps painted since the module loaded; a caller measures progress as a difference. */
export function environmentPaintedStepCount(): number {
  return stepsPaintedTotal;
}

/**
 * Paints every owed step of every queued sheet now, ignoring the frame budget.
 *
 * For the offline harnesses, which have no render loop to tick the queue and no
 * frame time to protect. The shipped game must never call this: the whole point
 * of the queue is that a floor's sheets arrive across a fade-in rather than in
 * one stall.
 */
export function paintEnvironmentArtNow(): void {
  requestNextReplay();
  while (queue.length > 0) {
    const key = queue[0];
    const sheet = pending.get(key);
    if (sheet === undefined) {
      queue.shift();
      continue;
    }
    for (let index = sheet.nextStep; index < sheet.plan.steps.length; index++) {
      sheet.ctx.save();
      try {
        sheet.plan.steps[index].paint(sheet.ctx);
      } finally {
        sheet.ctx.restore();
      }
      stepsPaintedTotal += 1;
    }
    sheet.nextStep = sheet.plan.steps.length;
    dequeue(key);
    if (!sheet.published) publish(sheet);
    pending.delete(key);
    sheet.plan.onSettled?.();
    requestNextReplay();
  }
}

function drop(key: string, surface: CanvasSurface): void {
  // Shrinking the backing store is what actually gives the pixels back; dropping
  // the map entry alone only frees the wrapper object. The `SpriteLoader` def
  // has to go with it, or the next lookup hands back a def pointing at a
  // zero-sized surface and the sheet never repaints.
  surface.width = 0;
  surface.height = 0;
  unregisterPaintedSprite(key);
}

function release(shouldRelease: (key: string, variesWithFloorSeed: boolean) => boolean): void {
  // Owed to the floor whose sheets are going; the next floor requests its own.
  replays.length = 0;
  for (const [key, sheet] of resident) {
    if (!shouldRelease(key, sheet.variesWithFloorSeed)) continue;
    drop(key, sheet.surface);
    resident.delete(key);
  }
  for (const [key, sheet] of pending) {
    if (!shouldRelease(key, sheet.plan.variesWithFloorSeed)) continue;
    drop(key, sheet.surface);
    if (!sheet.published) sheet.plan.release?.();
    pending.delete(key);
  }
  for (let index = queue.length - 1; index >= 0; index--) {
    if (!pending.has(queue[index])) queue.splice(index, 1);
  }
  for (const [key, sheet] of deferred) {
    if (shouldRelease(key, sheet.variesWithFloorSeed)) deferred.delete(key);
  }
  // The queue the debt was owed against is gone, so the next floor's first frame
  // must not open paused. The cost estimates stay: they are a property of the
  // painters rather than of any sheet, and re-learning one is exactly the
  // over-budget step they exist to keep off a frame anybody is watching.
  if (pending.size === 0) paintDebtMs = 0;
}

/**
 * Gives back everything the floor being left had painted for itself.
 *
 * Two criteria, and both are needed. A sheet whose art carries the floor's seed
 * goes whatever `keep` says, because the next floor draws its own seed and a
 * sheet painted from the old one is art of a floor that no longer exists — even
 * when the two floors happen to share the key. A sheet that carries no seed goes
 * only when the next floor no longer needs it, which is the same question
 * `releaseSpritesExcept` asks of a fetched sheet, so the two are given the same
 * keep set and can never disagree about what is live.
 *
 * What survives both is the art every floor uses and no floor varies — the
 * corner masks each floor composites its materials through.
 */
export function releaseEnvironmentArt(keep: ReadonlySet<string>): void {
  release((key, variesWithFloorSeed) => variesWithFloorSeed || !keep.has(key));
}

/**
 * The one surface painters stage pixels through on their way into a sheet.
 *
 * `putImageData` ignores the context transform, and a sheet's context carries
 * the low-end-device downscale as one — so raw pixels have to be written to an
 * untransformed surface and drawn from there. Kept between uses rather than
 * allocated per piece: a ground sheet stages forty patches, and this is the one
 * code path whose frame cost is being budgeted around. It grows to fit the
 * largest thing asked of it and is given back with everything else on a flush.
 */
let staging: CanvasSurface | null = null;

export function stagingSurfaceOfAtLeast(width: number, height: number): CanvasSurface {
  const existing = staging;
  if (existing !== null && existing.width >= width && existing.height >= height) return existing;
  const grown = allocCanvas(
    Math.max(width, existing?.width ?? 0),
    Math.max(height, existing?.height ?? 0),
  );
  if (existing !== null) {
    existing.width = 0;
    existing.height = 0;
  }
  staging = grown;
  return grown;
}

interface SheetReplay {
  readonly key: string;
  readonly replan: () => EnvironmentSheetPlan;
  readonly variesWithFloorSeed: boolean;
}

/**
 * Sheets waiting to be painted again after a purge, requested one at a time.
 *
 * Not all at once, because planning a sheet can allocate everything it is
 * composed from up front — a town facade is megabytes before its first step —
 * and a purge on a phone is exactly when that memory is scarcest.
 */
const replays: SheetReplay[] = [];
/** Bumped each time a repainted sheet lands; see {@link repaintedSheetRevision}. */
let repaintedRevision = 0;

/**
 * Bumped whenever a sheet repainted after a purge becomes drawable. A cache that
 * baked from the sheets compares it against the revision it baked under and
 * drops what it baked against the fallback colours, because the plan that would
 * have told it so through `onReady` was not kept.
 */
export function repaintedSheetRevision(): number {
  return repaintedRevision;
}

function replayInFlight(): boolean {
  for (const sheet of pending.values()) if (sheet.replayed) return true;
  return false;
}

/** Queues the next owed repaint once the one before it has landed. */
function requestNextReplay(): void {
  while (!replayInFlight()) {
    const next = replays.shift();
    if (next === undefined) return;
    if (resident.has(next.key) || pending.has(next.key)) continue;
    let plan: EnvironmentSheetPlan;
    try {
      plan = next.replan();
    } catch (error) {
      // Planning can allocate everything a sheet is composed from up front.
      // Refused memory waits its turn again; any other failure is the
      // painter's, which no retry would mend.
      if (error instanceof CanvasContextUnavailableError) {
        deferEnvironmentSheet(next.key, next.variesWithFloorSeed, next.replan);
      } else {
        console.warn(`[environmentArtCache] "${next.key}" could not be planned again`, error);
      }
      continue;
    }
    const outcome = requestEnvironmentSheet(plan);
    const replayed = pending.get(next.key);
    if (outcome === 'queued' && replayed !== undefined) replayed.replayed = true;
  }
}

/**
 * Paints every sheet again after the browser discarded the pixels of every
 * canvas. A sheet painted under another floor's seed is dropped instead: it is
 * art of a floor that no longer exists.
 *
 * Each sheet is withdrawn from `SpriteLoader` until it lands again, so the
 * ground falls back to each material's mean colour rather than drawing blank.
 */
function repaintAllEnvironmentArt(): void {
  const current = floorArtSeed();
  const owed = new Map<string, SheetReplay>();
  const interruptedChains: Array<() => void> = [];
  for (const [key, sheet] of resident) {
    if (sheet.variesWithFloorSeed && sheet.artSeed !== current) continue;
    owed.set(key, {
      key,
      replan: sheet.replan,
      variesWithFloorSeed: sheet.variesWithFloorSeed,
    });
  }
  for (const key of queue) {
    const sheet = pending.get(key);
    if (sheet === undefined) continue;
    if (sheet.plan.variesWithFloorSeed && sheet.artSeed !== current) continue;
    if (!owed.has(key)) {
      owed.set(key, {
        key,
        replan: replanOf(sheet.plan),
        variesWithFloorSeed: sheet.plan.variesWithFloorSeed,
      });
    }
    const settled = sheet.plan.onSettled;
    if (settled !== undefined) interruptedChains.push(settled);
  }
  for (const [key, sheet] of deferred) {
    if (sheet.variesWithFloorSeed && sheet.artSeed !== current) continue;
    if (!owed.has(key)) {
      owed.set(key, {
        key,
        replan: sheet.replan,
        variesWithFloorSeed: sheet.variesWithFloorSeed,
      });
    }
  }
  release(() => true);
  if (staging !== null) {
    staging.width = 0;
    staging.height = 0;
    staging = null;
  }
  replays.push(...owed.values());
  requestNextReplay();
  // A caller queueing its sheets one at a time waits on `onSettled` to queue the
  // next, and a released sheet never settles; told now, its chain carries on.
  // After the first repaint is queued, so the chain's next sheet goes behind it.
  for (const settled of interruptedChains) settled();
}

onCanvasRecovery((cause) => {
  // Under memory pressure the sheets are correct and the costliest art there is
  // to repaint; only lost pixels justify painting them again.
  if (cause === 'purged') repaintAllEnvironmentArt();
  // A recovery gives memory back, so a refused sheet is worth asking for now.
  deferredRetryAtMs = 0;
  for (const sheet of pending.values()) sheet.retryAtMs = 0;
});

/** Drops everything, for the `?tiles` reroll and for a harness between runs. */
export function flushEnvironmentArtCache(): void {
  release(() => true);
  costByClass.clear();
  abandoned.clear();
  if (staging !== null) {
    staging.width = 0;
    staging.height = 0;
    staging = null;
  }
  paintDebtMs = 0;
}
