/**
 * Runtime-painted environment art: the sheets the game used to ship as PNGs and
 * now paints for itself, one floor at a time, from that floor's art seed.
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

import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';
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
}

interface PendingSheet {
  readonly plan: EnvironmentSheetPlan;
  readonly surface: CanvasSurface;
  readonly ctx: CanvasRenderingContext2D;
  readonly scale: number;
  readonly artSeed: number;
  nextStep: number;
  published: boolean;
}

interface ResidentSheet {
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
 */
export type SheetRequestOutcome = 'queued' | 'alreadyQueued' | 'alreadyPainted';

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
  const ctx = surfaceContext(surface);
  ctx.scale(scale, scale);
  pending.set(plan.key, {
    plan,
    surface,
    ctx,
    scale,
    artSeed: floorArtSeed(),
    nextStep: 0,
    published: false,
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
 * Whether a step may start with `spentMs` of the allowance already gone.
 *
 * The first step of a frame always runs: a step whose estimate exceeds the whole
 * allowance would otherwise be refused on every frame there will ever be, and
 * the queue would never drain. A class nothing has been painted of yet has no
 * estimate to test, which costs one unavoidable overspend per class rather than
 * one per frame.
 */
function fitsPaintAllowance(costClass: string, spentMs: number): boolean {
  if (spentMs <= 0) return true;
  if (spentMs >= ENVIRONMENT_PAINT_BUDGET_MS) return false;
  const estimate = estimatedPaintMs(costClass);
  if (estimate === null) return true;
  return spentMs + estimate <= ENVIRONMENT_PAINT_BUDGET_MS;
}

/** Steps that must land before a plan's sheet may be drawn. */
function readyStepsOf(plan: EnvironmentSheetPlan): number {
  return Math.min(plan.readySteps ?? plan.steps.length, plan.steps.length);
}

function publish(sheet: PendingSheet): void {
  sheet.published = true;
  registerPaintedSprite(sheet.plan.key, sheet.surface, sheet.scale);
  resident.set(sheet.plan.key, {
    surface: sheet.surface,
    bytes: sheet.surface.width * sheet.surface.height * BYTES_PER_PIXEL,
    variesWithFloorSeed: sheet.plan.variesWithFloorSeed,
    artSeed: sheet.artSeed,
  });
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
  }
  pending.delete(key);
  dequeue(key);
  // Told last, and told at all: a caller sequencing its sheets one at a time
  // would otherwise stop here and leave every sheet behind this one unqueued.
  sheet.plan.onSettled?.();
}

function dequeue(key: string): void {
  const queued = queue.indexOf(key);
  if (queued >= 0) queue.splice(queued, 1);
}

function drainQueue(): void {
  while (queue.length > 0 && msPaintedThisFrame < ENVIRONMENT_PAINT_BUDGET_MS) {
    const key = queue[0];
    const sheet = pending.get(key);
    if (sheet === undefined) {
      queue.shift();
      continue;
    }
    const step = sheet.plan.steps[sheet.nextStep];
    if (!fitsPaintAllowance(step.costClass, msPaintedThisFrame)) return;
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
      // a floor with a gap in it.
      abandon(key, sheet, error);
    } finally {
      const elapsed = performance.now() - startedAt;
      msPaintedThisFrame += elapsed;
      recordPaintCost(step.costClass, elapsed);
      if (painted) sheet.nextStep += 1;
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
}

/**
 * Starts a render frame: spends this frame's share of the paint allowance on
 * whatever sheets are still owed, after paying back any earlier overspend.
 */
export function beginEnvironmentArtFrame(): void {
  msPaintedThisFrame = 0;
  if (paintDebtMs > 0) {
    paintDebtMs = Math.max(0, paintDebtMs - ENVIRONMENT_PAINT_BUDGET_MS);
    return;
  }
  try {
    drainQueue();
  } finally {
    // However the frame ended, what it ran over by is owed back — a painter
    // that threw has still spent the time.
    paintDebtMs += Math.max(0, msPaintedThisFrame - ENVIRONMENT_PAINT_BUDGET_MS);
  }
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
    }
    sheet.nextStep = sheet.plan.steps.length;
    dequeue(key);
    if (!sheet.published) publish(sheet);
    pending.delete(key);
    sheet.plan.onSettled?.();
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
  for (const [key, sheet] of resident) {
    if (!shouldRelease(key, sheet.variesWithFloorSeed)) continue;
    drop(key, sheet.surface);
    resident.delete(key);
  }
  for (const [key, sheet] of pending) {
    if (!shouldRelease(key, sheet.plan.variesWithFloorSeed)) continue;
    drop(key, sheet.surface);
    pending.delete(key);
  }
  for (let index = queue.length - 1; index >= 0; index--) {
    if (!pending.has(queue[index])) queue.splice(index, 1);
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
