/**
 * Baked frames for procedurally painted creatures.
 *
 * A creature's art used to ship as a PNG sheet: every row of every animation,
 * decoded into memory the moment its floor loaded and resident whether or not
 * the creature was ever on screen. The art code that produced those pixels was
 * an offline generator, so the runtime had no way to make one.
 *
 * Here the painter ships instead of the pixels, and this cache stands where the
 * sheet stood. A `(figure, state, frame)` is painted once into an offscreen
 * cell and blitted from then on, so the steady-state cost per draw is a
 * `drawImage` — the same cost the sheet path paid — while the resident set is
 * the rows actually being played rather than every row the floor could show.
 *
 * Four decisions carry that:
 *
 *  - **Rows, not sheets, are the unit of memory.** Admission, eviction and the
 *    idle sweep all work on one animation row of one figure, because a fight is
 *    a walk row and an attack row, not a sheet.
 *  - **Cells are shared across instances.** Eight tusklings play the same
 *    quantized frame indices, so they blit the same eight cells; a pack costs
 *    what one of it costs.
 *  - **A refusal paints rather than blanks.** The painter is present at
 *    runtime, so a cell the budget will not admit is drawn straight into the
 *    target. Full means slower, never invisible.
 *  - **The bake budget is milliseconds.** Cell area varies by two orders of
 *    magnitude across the fleet, so a cell count would let one figure spike a
 *    frame and hold another back for no reason.
 *
 * Cells are baked supersampled and downsampled into place, exactly as the
 * offline generators did, so a cached cell is the sheet cell it replaces. The
 * direct-paint fallback skips the supersample — it costs a quarter as much, and
 * one softer frame before the bake lands is not a thing a player can see.
 *
 * Both paths composite off screen and blit once. A painter is hundreds of
 * canvas operations, and a caller that has set `filter`, `globalAlpha`,
 * `shadowBlur` or a compositing mode — a damage flash is exactly that — would
 * otherwise have that state applied to every one of them individually on the
 * fallback path and once to a finished image on the cached one. A brightness
 * filter over each layer in turn, over layers already brightened, is not a
 * dimmer version of the right answer; it is a blown-out blob. So the fallback
 * paints into a surface of its own and hands the caller a single `drawImage`,
 * which also gives it the cell's hard crop for free.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { shouldDownscaleForLowEndDevice } from '../../core/SpriteLoader';
import type { DrawSpriteOpts } from '../../core/SpriteRenderer';
import { EMPTY_ALPHA_CUTOFF, type FrameInkBounds } from '../../core/spriteFrames';
import { figureFrameCount, type FigureDef, type FigureId } from './figureDef';
import {
  BYTES_PER_MEGABYTE,
  beginFigureCacheStatsFrame,
  recordFigureCacheBake,
  recordFigureCacheDirectDraw,
  recordFigureCacheEviction,
  recordFigureCacheHit,
  recordFigureCacheMiss,
  recordFigureCacheOccupancy,
  recordFigureCachePrewarmBake,
  recordFigureCacheRelease,
} from './figureCacheStats';

/**
 * Density each cell is painted at before being downsampled into place. Two is
 * what every offline generator baked at, and matching it is what makes a cached
 * cell pixel-equivalent to the sheet cell it replaces.
 */
const SUPERSAMPLE = 2;

/**
 * A sheet the loader decides this display is too poor for is resampled to half
 * size; a painted figure answers the same question by painting its cells half
 * as dense, so a blit stays 1:1 on a DPR-1 screen instead of being squeezed.
 */
const LOW_END_BAKE_SCALE = 0.5;
const FULL_BAKE_SCALE = 1;

/**
 * Ceiling on the pixel data the cache holds across every figure, the scratch
 * surfaces included.
 *
 * Four times the per-figure ceiling below: one boss with every row it declares
 * warm at once, alongside three packs' worth of walk and attack rows. It stays
 * an order of magnitude under what it replaces — the full sheet set decodes to
 * roughly 807 MB and level 3 alone holds about 370 MB resident — so the trade
 * the cache exists to make holds even with the cache completely full.
 */
const CACHE_BUDGET_MEGABYTES = 96;
const CACHE_BYTE_BUDGET = CACHE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;

/**
 * Ceiling on one figure's cells.
 *
 * Sized from the pilot conversion, which is the fleet's shape for a boss: the
 * Juicer declares 182 cells of 176×176, which is 21.5 MB with every row of
 * every facing warm at once. Its heaviest row is 1.9 MB, and the three views of
 * its punch — prewarmed together when the telegraph fires — are 4.3 MB. A
 * ceiling below the declared total is one a boss reaches mid-fight, and reaching
 * it evicts the row it is about to play again; above it, the only figure that
 * can reach the ceiling is one holding every row it has, which is the leak the
 * ceiling is there to catch. For the fleet's other extremes this is six of the
 * Ball of Swine's ~3.8 MB rows, or about fifty of the Grotesque Spider's
 * ~480 KB cells.
 */
const FIGURE_BUDGET_MEGABYTES = 24;
export const FIGURE_BYTE_BUDGET = FIGURE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;

/** RGBA. */
const BYTES_PER_PIXEL = 4;

/**
 * Milliseconds of painting the cache may spend on a frame. Small enough to
 * disappear into one frame's slack, which means a cheap figure warms a whole
 * row in two or three frames while an expensive one lands a cell per frame and
 * paints directly in the meantime.
 */
const FRAME_BAKE_BUDGET_MS = 2;

/**
 * The share of that budget prewarming may take. Prewarm runs at the frame
 * boundary, before anything asks to be drawn, so it has to leave room for the
 * misses this frame's rendering will actually raise.
 *
 * Read as an average rather than as a per-frame ceiling, because a cell cannot
 * be painted half way: the fleet's larger figures cost several milliseconds a
 * cell, so a budget honoured strictly would refuse them forever. What is
 * honoured instead is the mean — an over-budget cell is repaid out of the
 * frames that follow it, which is what turns a burst into an occasional spike.
 *
 * Exported so the gate that holds prewarming to this average states the claim
 * against the number itself rather than against a copy of it.
 */
export const PREWARM_BAKE_BUDGET_MS = 1;

/**
 * Weight the newest measurement carries in a figure's per-cell bake estimate.
 *
 * Low, because the estimate exists to answer "will this cell fit in what is
 * left of the allowance" and the figures it matters for cost the same few
 * milliseconds every time. A high weight would let one cell that happened to
 * land beside a garbage collection decide the next few frames' pacing.
 */
const BAKE_COST_SMOOTHING = 0.25;

/**
 * Frames a prewarm request the cache had no room for is re-attempted on before
 * it is abandoned.
 *
 * Dropping a refused request outright loses the row for good, and the thing
 * that refused it is usually transient: another figure's rows go idle, a fight
 * ends, a wave dies. Retrying forever is the other failure — a row larger than
 * the per-figure ceiling can never be admitted, and an unbounded retry would
 * spend the whole prewarm allowance every frame proving that. A handful of
 * frames is long enough for pressure to clear and short enough that an
 * impossible request is abandoned before anybody sees it.
 *
 * Exported so the gate that proves a refused request is retried can also prove
 * it is eventually let go of.
 */
export const PREWARM_CAPACITY_RETRIES = 4;

/**
 * How long a row may go undrawn before the cache lets go of it, counted in
 * rendered frames: ten seconds on a 60 Hz display, and proportionally less on a
 * faster one.
 *
 * Deliberately still a frame count rather than wall-clock milliseconds. The
 * same counter answers "was this row drawn on the frame now being rendered",
 * which is what keeps eviction from dropping the working set, so a row would
 * need a second clock to be released on a wall-clock deadline. And the deadline
 * in frames is the one that tracks the cost it trades against: a display
 * running twice as fast rebuilds a released row in half the wall time.
 *
 * Exported because it is the deadline every prewarm lead has to fit inside: a
 * row warmed further ahead of its first draw than this is swept before anything
 * plays it, and the warming is thrown away. Callers that need to reason about
 * that window import this rather than restating the number, which is a copy
 * that can only ever go stale.
 */
export const IDLE_FRAMES_BEFORE_RELEASE = 600;

/**
 * How much larger than the cell it must hold a reused scratch surface may be.
 *
 * The surface is kept between bakes because a per-bake allocation of several
 * megabytes is the one cost this path cannot afford to repeat, and taking the
 * union of each axis is what lets a slightly larger figure reuse it. Taken
 * unconditionally, though, that union ratchets: a wide figure followed by a tall
 * one leaves a surface neither of them needs and nothing ever gives it back. So
 * the union is only taken while it stays near the size actually asked for.
 */
const SCRATCH_UNION_AREA_SLACK = 1.5;

/** Tile-relative mirror axis, matching `drawSprite`'s flip. */
const TILE_CENTER_OFFSET = 0.5;

/** Default alpha for full opacity, matching `drawSprite`. */
const DEFAULT_ALPHA = 1;

const RGBA_STRIDE = 4;
const ALPHA_CHANNEL_OFFSET = 3;
/** Half of a pixel, so a bounding box spans whole pixels rather than their corners. */
const HALF_PIXEL = 0.5;

/** One animation row's baked cells, keyed by frame index. */
interface FigureRow {
  cells: Map<number, CanvasSurface>;
  bytes: number;
  /** The frame this row was last drawn on, so idle rows can be reclaimed. */
  lastFrame: number;
}

interface FigureEntry {
  readonly def: FigureDef;
  /** Cell pixels per declared frame pixel; a change rebuilds every cell. */
  bakeScale: number;
  cellPixelWidth: number;
  cellPixelHeight: number;
  bytes: number;
  /** Insertion-ordered by last use, so the first row is the coldest. */
  rows: Map<string, FigureRow>;
}

/** A cell ready to blit, with the destination extent it must be blitted at. */
interface PlacedCell {
  readonly surface: CanvasSurface;
  readonly destWidth: number;
  readonly destHeight: number;
}

/** Insertion-ordered by last use, so the first entry is the coldest figure. */
const entries = new Map<FigureId, FigureEntry>();

let cachedBytes = 0;
let cachedRows = 0;
let frameCounter = 0;
let msBakedThisFrame = 0;

interface PrewarmRequest {
  readonly def: FigureDef;
  readonly state: string;
  /** Frames this request has been refused for want of room. */
  capacityRefusals: number;
}

/** Figure/state pairs asked for ahead of their first draw, in request order. */
const prewarmQueue: PrewarmRequest[] = [];

/**
 * What one cell of a figure has been costing to bake.
 *
 * Kept per figure because that is the granularity cost actually varies at: a
 * cell's size is declared by the figure, and across the fleet cell areas span
 * two orders of magnitude, so one figure's measurement says nothing about
 * another's. Held outside `entries` so that a figure whose rows were all
 * released does not have to relearn the answer the next time it is warmed —
 * this is a property of the painter, not of any cell it produced.
 */
interface BakeCostEstimate {
  /** The density it was measured at; a cell baked half-dense costs a quarter. */
  readonly bakeScale: number;
  readonly msPerCell: number;
}
const bakeCostByFigure = new Map<FigureId, BakeCostEstimate>();

/**
 * Milliseconds prewarming has spent beyond its allowance and has yet to repay,
 * drained one allowance per frame.
 *
 * The queue used to be pumped once per frame with the allowance checked only
 * *before* a bake started, so a figure whose cells cost six milliseconds spent
 * six every frame for as long as it took to drain — a burst of dozens of
 * consecutive over-budget frames, each of which also left the rendering that
 * followed it with no bake allowance at all. Carrying the overspend forward
 * makes the allowance mean what it says over any window longer than one cell,
 * while the queue still moves: the debt shrinks by a fixed amount every frame,
 * so prewarming always resumes, and a large figure is warmed a cell every few
 * frames instead of a cell every frame.
 */
let prewarmDebtMs = 0;

/**
 * Scratch surfaces the paint lands on before being composited into place, one
 * per level of nesting.
 *
 * A painter may compose another figure — a boss holding a painted prop, a
 * creature with an appendage of its own — which re-enters this module while its
 * caller is halfway through a paint. One shared surface makes that silent total
 * corruption: the inner bake clears and re-blits the very pixels the outer bake
 * is about to read back. A stack costs one surface per level of nesting, which
 * in practice is two.
 */
const scratchStack: Array<CanvasSurface | null> = [];
let scratchDepth = 0;
let scratchBytes = 0;

const missedStates = new Set<string>();
const abandonedPrewarms = new Set<string>();

function bakeScaleNow(): number {
  return shouldDownscaleForLowEndDevice() ? LOW_END_BAKE_SCALE : FULL_BAKE_SCALE;
}

/** Everything the cache is holding: baked cells plus the scratch surfaces. */
function residentBytes(): number {
  return cachedBytes + scratchBytes;
}

function publishOccupancy(): void {
  recordFigureCacheOccupancy(entries.size, cachedRows, residentBytes());
}

/**
 * Starts a new render frame: refreshes the bake budget, releases rows nobody
 * has drawn in a while, and spends what prewarm is allowed on requested rows.
 */
export function beginFigureFrame(): void {
  frameCounter++;
  msBakedThisFrame = 0;
  beginFigureCacheStatsFrame();
  releaseIdleRows();
  runPrewarmQueue();
}

/**
 * Drops rows nobody has drawn in a long time, whether or not the cache is under
 * pressure. This is what makes a pack's footprint track the fight rather than
 * the sheet: the walk row a wave arrived on is gone a few seconds after the
 * wave is.
 */
function releaseIdleRows(): void {
  for (const [id, entry] of entries) {
    for (const [state, row] of entry.rows) {
      if (frameCounter - row.lastFrame <= IDLE_FRAMES_BEFORE_RELEASE) break;
      dropRow(entry, state, row);
      recordFigureCacheRelease();
    }
    if (entry.rows.size === 0) entries.delete(id);
  }
  // Nothing is left to paint into it, and it is megabytes. A cache holding no
  // cells at all must report no bytes at all, or a finished fight looks like a
  // leak in the readout it is measured by.
  if (entries.size === 0) releaseScratchSurfaces();
  publishOccupancy();
}

function dropRow(entry: FigureEntry, state: string, row: FigureRow): void {
  entry.rows.delete(state);
  entry.bytes -= row.bytes;
  cachedBytes -= row.bytes;
  cachedRows -= 1;
}

/**
 * Drops a row that was created for a bake the budget then refused. Left in
 * place it is an empty row counted against the occupancy readout until the idle
 * sweep happens to reach it.
 */
function dropRowIfEmpty(entry: FigureEntry, state: string, row: FigureRow): void {
  if (row.cells.size > 0) return;
  dropRow(entry, state, row);
  if (entry.rows.size === 0) entries.delete(entry.def.id);
  publishOccupancy();
}

/**
 * Reclaims rows of one figure that nobody drew this frame, coldest first, until
 * `hasRoom` is satisfied. Rows drawn this frame are the working set; dropping
 * one of them is what turns an over-budget cache into a treadmill that rebuilds
 * everything every frame.
 */
function evictStaleRowsOf(id: FigureId, entry: FigureEntry, hasRoom: () => boolean): void {
  for (const [state, row] of entry.rows) {
    if (hasRoom()) return;
    if (row.lastFrame === frameCounter) continue;
    dropRow(entry, state, row);
    recordFigureCacheEviction();
  }
  if (entry.rows.size === 0) entries.delete(id);
}

/**
 * The two pressures are freed separately, for the reason the person cache
 * separates its own two: a figure that has hit its own ceiling has no use for
 * another figure's memory, and freeing it cannot satisfy the term that refused
 * the bake. Sweeping the whole cache for a per-figure refusal destroys an
 * unrelated creature's warm rows, reports the loss as cache pressure, and then
 * refuses the bake anyway.
 */
function evictStaleForGlobalBytes(bytes: number): void {
  if (admitsGlobally(bytes)) return;
  for (const [id, entry] of entries) {
    evictStaleRowsOf(id, entry, () => admitsGlobally(bytes));
    if (admitsGlobally(bytes)) break;
  }
  publishOccupancy();
}

function evictStaleForFigureBytes(entry: FigureEntry, bytes: number): void {
  if (admitsForFigure(entry, bytes)) return;
  evictStaleRowsOf(entry.def.id, entry, () => admitsForFigure(entry, bytes));
  publishOccupancy();
}

function entryFor(def: FigureDef): FigureEntry {
  const bakeScale = bakeScaleNow();
  const existing = entries.get(def.id);
  if (existing?.bakeScale === bakeScale) {
    entries.delete(def.id);
    entries.set(def.id, existing);
    return existing;
  }
  if (existing !== undefined) {
    for (const [state, row] of existing.rows) dropRow(existing, state, row);
    entries.delete(def.id);
  }

  const entry: FigureEntry = {
    def,
    bakeScale,
    cellPixelWidth: Math.max(1, Math.ceil(def.frameWidth * bakeScale)),
    cellPixelHeight: Math.max(1, Math.ceil(def.frameHeight * bakeScale)),
    bytes: 0,
    rows: new Map(),
  };
  entries.set(def.id, entry);
  return entry;
}

function rowFor(entry: FigureEntry, state: string): FigureRow {
  const existing = entry.rows.get(state);
  if (existing !== undefined) {
    entry.rows.delete(state);
    entry.rows.set(state, existing);
    existing.lastFrame = frameCounter;
    return existing;
  }
  const row: FigureRow = { cells: new Map(), bytes: 0, lastFrame: frameCounter };
  entry.rows.set(state, row);
  cachedRows += 1;
  // Published here rather than only once a cell lands: a row the budget then
  // refuses every cell of is a row the cache is holding, and a readout that
  // cannot see it cannot show it being cleaned up either.
  publishOccupancy();
  return row;
}

function cellBytes(entry: FigureEntry): number {
  return entry.cellPixelWidth * entry.cellPixelHeight * BYTES_PER_PIXEL;
}

function admitsGlobally(bytes: number): boolean {
  return residentBytes() + bytes <= CACHE_BYTE_BUDGET;
}

function admitsForFigure(entry: FigureEntry, bytes: number): boolean {
  return entry.bytes + bytes <= FIGURE_BYTE_BUDGET;
}

/** What a cell of this figure is expected to cost, or null if none has been baked. */
function estimatedBakeMs(entry: FigureEntry): number | null {
  const estimate = bakeCostByFigure.get(entry.def.id);
  if (estimate?.bakeScale !== entry.bakeScale) return null;
  return estimate.msPerCell;
}

function recordBakeCost(entry: FigureEntry, elapsedMs: number): void {
  const previous = estimatedBakeMs(entry);
  const smoothed =
    previous === null ? elapsedMs : previous + (elapsedMs - previous) * BAKE_COST_SMOOTHING;
  bakeCostByFigure.set(entry.def.id, { bakeScale: entry.bakeScale, msPerCell: smoothed });
}

/**
 * Whether a bake of this figure may start with `spentMs` of a `budgetMs`
 * allowance already gone.
 *
 * The allowance is checked against what the cell is expected to cost rather
 * than only against what has been spent so far, because a bake cannot be
 * stopped part way: a check that asks whether anything at all is left lets a
 * six-millisecond cell start on the strength of a tenth of a millisecond of
 * headroom.
 *
 * Two escapes keep it from being a stall. The first bake of a frame always
 * runs, because an estimate larger than the whole allowance would otherwise
 * refuse every bake there will ever be — a queue that never drains, and rows
 * baked on the frame they are played on instead. And a figure no cell has ever
 * been baked of has no estimate to test, which costs one unavoidable overspend
 * per figure rather than one per frame.
 */
function fitsBakeAllowance(entry: FigureEntry, spentMs: number, budgetMs: number): boolean {
  if (spentMs <= 0) return true;
  if (spentMs >= budgetMs) return false;
  const estimate = estimatedBakeMs(entry);
  if (estimate === null) return true;
  return spentMs + estimate <= budgetMs;
}

/**
 * Paints one frame at the given density into a surface of that size.
 *
 * Everything the painter draws is expressed in the figure's own declared cell
 * pixels; density is the caller's transform, so a bake and a direct draw run
 * the identical painter.
 */
function paintInto(
  ctx: CanvasRenderingContext2D,
  def: FigureDef,
  state: string,
  frame: number,
  density: number,
): void {
  ctx.save();
  try {
    ctx.scale(density, density);
    def.paintFrame(ctx, state, frame);
  } finally {
    // A painter that throws must not leave a pooled surface holding its
    // transform and its half-applied state for the next thing to paint on it.
    ctx.restore();
  }
}

function surfaceBytes(surface: CanvasSurface): number {
  return surface.width * surface.height * BYTES_PER_PIXEL;
}

function fittedScratch(
  current: CanvasSurface | null,
  width: number,
  height: number,
): CanvasSurface {
  if (current === null) return allocCanvas(width, height);
  if (current.width >= width && current.height >= height) return current;
  const unionWidth = Math.max(width, current.width);
  const unionHeight = Math.max(height, current.height);
  if (unionWidth * unionHeight <= width * height * SCRATCH_UNION_AREA_SLACK) {
    return allocCanvas(unionWidth, unionHeight);
  }
  return allocCanvas(width, height);
}

/**
 * Takes the scratch surface for the current nesting level, cleared and ready to
 * paint on. Every caller must `releaseScratch` in a `finally`.
 */
function acquireScratch(width: number, height: number): CanvasSurface {
  const level = scratchDepth;
  scratchDepth += 1;
  const current = scratchStack[level] ?? null;
  const surface = fittedScratch(current, width, height);
  if (surface !== current) {
    if (current !== null) scratchBytes -= surfaceBytes(current);
    scratchBytes += surfaceBytes(surface);
    scratchStack[level] = surface;
    publishOccupancy();
  }
  const ctx = surfaceContext(surface);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return surface;
}

function releaseScratch(): void {
  scratchDepth -= 1;
}

function releaseScratchSurfaces(): void {
  scratchStack.length = 0;
  scratchBytes = 0;
}

/** Bakes one cell, or returns null when a budget refused it. */
function bakeCell(
  entry: FigureEntry,
  row: FigureRow,
  state: string,
  frame: number,
): CanvasSurface | null {
  const bytes = cellBytes(entry);
  // No eviction can free room for a cell that does not fit an empty cache, and
  // sweeping for one only destroys rows that were serving somebody.
  if (bytes > FIGURE_BYTE_BUDGET || bytes > CACHE_BYTE_BUDGET) return null;
  if (!admitsForFigure(entry, bytes)) {
    evictStaleForFigureBytes(entry, bytes);
    if (!admitsForFigure(entry, bytes)) return null;
  }
  if (!admitsGlobally(bytes)) {
    evictStaleForGlobalBytes(bytes);
    if (!admitsGlobally(bytes)) return null;
  }

  const startedAt = performance.now();
  const msBakedBefore = msBakedThisFrame;
  const superWidth = entry.cellPixelWidth * SUPERSAMPLE;
  const superHeight = entry.cellPixelHeight * SUPERSAMPLE;
  const cell = allocCanvas(entry.cellPixelWidth, entry.cellPixelHeight);
  const surface = acquireScratch(superWidth, superHeight);
  try {
    paintInto(surfaceContext(surface), entry.def, state, frame, entry.bakeScale * SUPERSAMPLE);
    surfaceContext(cell).drawImage(
      surface,
      0,
      0,
      superWidth,
      superHeight,
      0,
      0,
      entry.cellPixelWidth,
      entry.cellPixelHeight,
    );
  } finally {
    releaseScratch();
  }

  row.cells.set(frame, cell);
  row.bytes += bytes;
  entry.bytes += bytes;
  cachedBytes += bytes;
  const elapsedMs = performance.now() - startedAt;
  recordBakeCost(entry, elapsedMs);
  // Assigned rather than accumulated: a painter that composed another figure
  // has already charged its nested bakes to this frame, and the elapsed time
  // measured here contains them.
  msBakedThisFrame = msBakedBefore + elapsedMs;
  publishOccupancy();
  return cell;
}

/**
 * Asks the cache to paint a whole animation row ahead of its first use.
 *
 * The callers are spawners and telegraphs — code that knows frames in advance
 * that a creature is about to walk, or that a boss is about to swing. Requests
 * are drained a few cells per frame under their own slice of the bake budget,
 * which is what keeps a wave of eight arriving at once from being eight cold
 * misses on the frame they appear.
 */
export function prewarmFigureState(def: FigureDef, state: string): void {
  if (figureFrameCount(def, state) === 0) {
    warnMissingState(def, state);
    return;
  }
  const alreadyQueued = prewarmQueue.some(
    (pending) => pending.def.id === def.id && pending.state === state,
  );
  if (alreadyQueued) return;
  prewarmQueue.push({ def, state, capacityRefusals: 0 });
}

/** Frames still waiting to be prewarmed. For gates and dev readouts. */
export function figurePrewarmDepth(): number {
  return prewarmQueue.length;
}

function runPrewarmQueue(): void {
  if (prewarmDebtMs > 0) {
    prewarmDebtMs = Math.max(0, prewarmDebtMs - PREWARM_BAKE_BUDGET_MS);
    return;
  }
  try {
    drainPrewarmQueue();
  } finally {
    // Whatever this frame's prewarming ran over by is owed back, however it
    // ended — a painter that threw has still spent the time.
    prewarmDebtMs += Math.max(0, msBakedThisFrame - PREWARM_BAKE_BUDGET_MS);
  }
}

function drainPrewarmQueue(): void {
  while (prewarmQueue.length > 0 && msBakedThisFrame < PREWARM_BAKE_BUDGET_MS) {
    const pending = prewarmQueue[0];
    const entry = entryFor(pending.def);
    if (!fitsBakeAllowance(entry, msBakedThisFrame, PREWARM_BAKE_BUDGET_MS)) return;
    const row = rowFor(entry, pending.state);
    const frames = figureFrameCount(pending.def, pending.state);
    let baked = false;
    for (let frame = 0; frame < frames; frame++) {
      if (row.cells.has(frame)) continue;
      if (!fitsBakeAllowance(entry, msBakedThisFrame, PREWARM_BAKE_BUDGET_MS)) return;
      if (bakeCell(entry, row, pending.state, frame) === null) {
        dropRowIfEmpty(entry, pending.state, row);
        deferRefusedPrewarm(pending);
        return;
      }
      recordFigureCachePrewarmBake();
      baked = true;
      if (msBakedThisFrame >= PREWARM_BAKE_BUDGET_MS) return;
    }
    if (!baked) prewarmQueue.shift();
  }
}

/**
 * Puts a request the cache had no room for back at the end of the queue, so the
 * frames it went unwarmed cost it its place rather than its existence.
 */
function deferRefusedPrewarm(pending: PrewarmRequest): void {
  prewarmQueue.shift();
  pending.capacityRefusals += 1;
  if (pending.capacityRefusals < PREWARM_CAPACITY_RETRIES) {
    prewarmQueue.push(pending);
    return;
  }
  warnPrewarmAbandoned(pending);
}

/** Drops a figure's prewarm request, e.g. when its spawn was cancelled. */
export function cancelFigurePrewarm(def: FigureDef, state: string): void {
  const index = prewarmQueue.findIndex(
    (pending) => pending.def.id === def.id && pending.state === state,
  );
  if (index >= 0) prewarmQueue.splice(index, 1);
}

function warnMissingState(def: FigureDef, state: string): void {
  const signature = `${def.id}:${state}`;
  if (missedStates.has(signature)) return;
  missedStates.add(signature);
  console.warn(`[figureFrameCache] "${def.id}" declares no state "${state}"`);
}

function warnPrewarmAbandoned(pending: PrewarmRequest): void {
  const signature = `${pending.def.id}:${pending.state}`;
  if (abandonedPrewarms.has(signature)) return;
  abandonedPrewarms.add(signature);
  console.warn(
    `[figureFrameCache] gave up prewarming "${pending.def.id}" state "${pending.state}" ` +
      `after ${PREWARM_CAPACITY_RETRIES} frames with no room for it`,
  );
}

/**
 * Runs `place` with the context transformed exactly the way `drawSprite`
 * transforms it, and hands it the top-left a sheet cell would have landed at.
 * Blit and direct paint share it so the two paths cannot drift.
 */
function withFigurePlacement(
  ctx: CanvasRenderingContext2D,
  def: FigureDef,
  x: number,
  y: number,
  tileSize: number,
  scale: number,
  opts: DrawSpriteOpts,
  place: (destX: number, destY: number) => void,
): void {
  const { flipX = false, alpha, rotation } = opts;

  const needsSave =
    flipX || rotation !== undefined || (alpha !== undefined && alpha !== DEFAULT_ALPHA);
  if (needsSave) ctx.save();
  if (alpha !== undefined && alpha !== DEFAULT_ALPHA) ctx.globalAlpha = alpha;

  if (rotation !== undefined) {
    ctx.translate(x, y);
    ctx.rotate(rotation);
    if (flipX) ctx.scale(-1, 1);
    place(-def.tileX * scale, -def.tileY * scale);
  } else {
    if (flipX) {
      const mirrorAxis = x + tileSize * TILE_CENTER_OFFSET;
      ctx.translate(mirrorAxis, 0);
      ctx.scale(-1, 1);
      ctx.translate(-mirrorAxis, 0);
    }
    place(x - def.tileX * scale, y - def.tileY * scale);
  }

  if (needsSave) ctx.restore();
}

/**
 * Paints one frame into a surface of its own at the size it will be drawn, and
 * blits that.
 *
 * Compositing off screen is the whole point: the caller's `filter`,
 * `globalAlpha`, `shadowBlur` and compositing mode then apply once to a
 * finished image, exactly as they apply to a cached cell's blit, instead of
 * once per operation inside a painter that draws its subject in layers. The
 * surface is also the crop the cell would have imposed, so a painter that
 * reaches past its declared frame is clipped on both paths alike.
 */
function directPaint(
  ctx: CanvasRenderingContext2D,
  def: FigureDef,
  state: string,
  frame: number,
  destX: number,
  destY: number,
  scale: number,
): void {
  recordFigureCacheDirectDraw();
  const width = Math.max(1, Math.ceil(def.frameWidth * scale));
  const height = Math.max(1, Math.ceil(def.frameHeight * scale));
  const surface = acquireScratch(width, height);
  try {
    paintInto(surfaceContext(surface), def, state, frame, scale);
    // A pooled surface may be larger than this figure needs, so the source rect
    // is stated rather than left to default to the whole surface.
    ctx.drawImage(surface, 0, 0, width, height, destX, destY, width, height);
  } finally {
    releaseScratch();
  }
}

/** The clamped frame index, matching `drawSprite`'s tolerance of a stale index. */
function clampFrame(def: FigureDef, state: string, frame: number): number {
  return Math.max(0, Math.min(Math.floor(frame), figureFrameCount(def, state) - 1));
}

/**
 * The baked cell for this frame, or null when a budget or the frame's bake
 * allowance refused it. A refusal is the caller's cue to paint directly.
 */
function cellFor(def: FigureDef, state: string, frame: number, scale: number): PlacedCell | null {
  const entry = entryFor(def);
  const row = rowFor(entry, state);
  const cached = row.cells.get(frame);
  if (cached !== undefined) {
    recordFigureCacheHit();
    return placed(entry, cached, scale);
  }
  recordFigureCacheMiss();
  if (!fitsBakeAllowance(entry, msBakedThisFrame, FRAME_BAKE_BUDGET_MS)) {
    dropRowIfEmpty(entry, state, row);
    return null;
  }
  const baked = bakeCell(entry, row, state, frame);
  if (baked === null) {
    dropRowIfEmpty(entry, state, row);
    return null;
  }
  recordFigureCacheBake();
  return placed(entry, baked, scale);
}

/**
 * A cell's destination extent.
 *
 * The cell was rounded *up* to whole pixels, so blitting it at the un-rounded
 * `frameWidth * scale` asks the canvas to squeeze the transparent surplus into
 * the destination — which shrinks the whole image by a fraction of a pixel and
 * drags the tile anchor with it. Dividing the allocated width by the density it
 * was allocated at puts the surplus back outside the figure, where it is the
 * padding it was meant to be.
 */
function placed(entry: FigureEntry, surface: CanvasSurface, scale: number): PlacedCell {
  const densityRatio = scale / entry.bakeScale;
  return {
    surface,
    destWidth: entry.cellPixelWidth * densityRatio,
    destHeight: entry.cellPixelHeight * densityRatio,
  };
}

/**
 * Draws one frame of a painted figure, through the cache.
 *
 * Argument-for-argument the sheet path's `drawSpriteKey`, with a `FigureDef`
 * where the `SpriteKey` was: (x, y) is the creature's tile top-left in screen
 * coordinates, or the anchor point when `opts.rotation` is set.
 */
export function drawFigureCached(
  ctx: CanvasRenderingContext2D,
  def: FigureDef,
  state: string,
  frame: number,
  x: number,
  y: number,
  tileSize: number,
  opts: DrawSpriteOpts = {},
): void {
  if (figureFrameCount(def, state) === 0) {
    warnMissingState(def, state);
    return;
  }
  const clamped = clampFrame(def, state, frame);
  const scale = tileSize / def.tileScale;
  const cell = cellFor(def, state, clamped, scale);
  withFigurePlacement(ctx, def, x, y, tileSize, scale, opts, (destX, destY) => {
    if (cell === null) {
      directPaint(ctx, def, state, clamped, destX, destY, scale);
      return;
    }
    ctx.drawImage(cell.surface, destX, destY, cell.destWidth, cell.destHeight);
  });
}

/**
 * Draws a figure's frame spinning about its own visible pixels, centred on
 * (sx, sy) — the gore path's `drawSpriteRotatedCenter`, for painted figures.
 *
 * The pivot is the frame's measured ink centre for the same reason it is on the
 * sheet path: a cell is as large as the creature's widest pose, so its centre
 * is nowhere near a severed forearm parked in the corner of one.
 */
export function drawFigureCachedRotatedCenter(
  ctx: CanvasRenderingContext2D,
  def: FigureDef,
  state: string,
  frame: number,
  sx: number,
  sy: number,
  angle: number,
  tileSize: number,
  alpha: number,
): void {
  if (figureFrameCount(def, state) === 0) {
    warnMissingState(def, state);
    return;
  }
  const clamped = clampFrame(def, state, frame);
  const ink = figureInkBounds(def, state, clamped);
  const scale = tileSize / def.tileScale;
  const cell = cellFor(def, state, clamped, scale);

  ctx.save();
  if (alpha !== DEFAULT_ALPHA) ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  const destX = -ink.centerX * scale;
  const destY = -ink.centerY * scale;
  if (cell === null) directPaint(ctx, def, state, clamped, destX, destY, scale);
  else ctx.drawImage(cell.surface, destX, destY, cell.destWidth, cell.destHeight);
  ctx.restore();
}

const inkBoundsByFrame = new Map<string, FrameInkBounds>();

/**
 * Where a frame's ink actually sits inside its cell, in declared cell pixels.
 *
 * Measured off a one-off unsupersampled paint rather than off a cached cell:
 * the answer has to exist whether or not the cache admitted that frame, and a
 * bounding box is not a thing supersampling moves.
 */
export function figureInkBounds(def: FigureDef, state: string, frame: number): FrameInkBounds {
  const key = `${def.id}|${state}|${frame}`;
  const cached = inkBoundsByFrame.get(key);
  if (cached !== undefined) return cached;
  const measured = measureFigureInk(def, state, frame);
  inkBoundsByFrame.set(key, measured);
  return measured;
}

/**
 * How far a frame's drawn pixels reach from its own ink centre, in world pixels
 * at the given tile size — the cell size is the wrong answer for anything that
 * has to know where a frame's art really ends, because a cell is sized for the
 * figure's widest pose.
 */
export function figureInkRadiusPx(
  def: FigureDef,
  state: string,
  frame: number,
  tileSize: number,
): number {
  return figureInkBounds(def, state, frame).radius * (tileSize / def.tileScale);
}

function measureFigureInk(def: FigureDef, state: string, frame: number): FrameInkBounds {
  const wholeCell: FrameInkBounds = {
    centerX: def.frameWidth / 2,
    centerY: def.frameHeight / 2,
    radius: Math.hypot(def.frameWidth, def.frameHeight) / 2,
  };

  const surface = allocCanvas(Math.ceil(def.frameWidth), Math.ceil(def.frameHeight));
  const ctx = surfaceContext(surface);
  const width = surface.width;
  const height = surface.height;
  paintInto(ctx, def, state, frame, 1);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, width, height).data;
  } catch (error) {
    // The cell centre is the answer this function exists to avoid giving: a
    // gore piece parked in a corner spins about a point it does not occupy. If
    // the pixels cannot be read at all it is still the only answer left, but it
    // is a fault and has to say so.
    console.warn(
      `[figureFrameCache] could not measure ink for "${def.id}" state "${state}" ` +
        `frame ${frame}; falling back to the cell centre`,
      error,
    );
    return wholeCell;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels[(y * width + x) * RGBA_STRIDE + ALPHA_CHANNEL_OFFSET];
      if (alpha <= EMPTY_ALPHA_CUTOFF) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return wholeCell;

  const centerX = (minX + maxX + 1) / 2;
  const centerY = (minY + maxY + 1) / 2;
  let radiusSq = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const alpha = pixels[(y * width + x) * RGBA_STRIDE + ALPHA_CHANNEL_OFFSET];
      if (alpha <= EMPTY_ALPHA_CUTOFF) continue;
      const dx = x + HALF_PIXEL - centerX;
      const dy = y + HALF_PIXEL - centerY;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) radiusSq = distSq;
    }
  }
  return { centerX, centerY, radius: Math.sqrt(radiusSq) };
}

/**
 * Drops every baked cell and every pending prewarm.
 *
 * Called when the render quality changes — cells are density-specific — and at
 * a floor change, where the sheet path evicts its sheets for the same reason:
 * whatever the next floor still needs is rebuilt lazily and nothing else is
 * paid for. The measured ink bounds go too: they are a property of the painter
 * rather than of the bake, so they are dropped for their memory and remeasured
 * on demand.
 */
export function flushFigureFrameCache(): void {
  entries.clear();
  prewarmQueue.length = 0;
  // The queue it was owed against is gone, so the next floor's first prewarm
  // must not open paused. What a painter costs survives, though: the estimates
  // are a property of the painter rather than of any cell, and re-learning them
  // is exactly the over-budget bake they exist to prevent.
  prewarmDebtMs = 0;
  inkBoundsByFrame.clear();
  cachedBytes = 0;
  cachedRows = 0;
  releaseScratchSurfaces();
  publishOccupancy();
}
