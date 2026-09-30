/**
 * Baked frames for procedurally painted creatures.
 *
 * A PNG sheet holds every row of every animation, decoded into memory the
 * moment its floor loads and resident whether or not the creature is ever on
 * screen, and the runtime cannot make one of its own.
 *
 * A figure ships its painter instead of its pixels, and this cache stands
 * where a sheet would. A `(figure, state, frame)` is painted once into an
 * offscreen cell and blitted from then on, so the steady-state cost per draw
 * is a `drawImage` — what a sheet's draw costs — while the resident set is the
 * rows actually being played rather than every row the floor could show.
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
 * offline generators bake a sheet, so a cached cell matches the sheet cell a
 * generator would write — all but a figure declaring `skipSupersample`, which
 * composes its own antialiased surface at the bake's density. The direct-paint
 * fallback skips the supersample — it costs a quarter as much, and one softer
 * frame before the bake lands is not a thing a player can see.
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

import {
  allocCanvas,
  allocReadableCanvas,
  surfaceContext,
  type CanvasSurface,
} from '../../core/canvasSurface';
import { shouldDownscaleForLowEndDevice } from '../../core/SpriteLoader';
import type { DrawSpriteOpts } from '../../core/SpriteRenderer';
import { EMPTY_ALPHA_CUTOFF, type FrameInkBounds } from '../../core/spriteFrames';
import {
  figureBakeDensity,
  type FigureDef,
  figureFrameCount,
  type FigureId,
  type DrawnFigureRow,
} from './figureDef';
import {
  BYTES_PER_MEGABYTE,
  beginFigureCacheStatsFrame,
  recordFigureCacheApproxDraw,
  recordFigureCacheBake,
  recordFigureCacheBakeMs,
  recordFigureCacheDirectDraw,
  recordFigureCacheEviction,
  recordFigureCacheHit,
  recordFigureCacheMiss,
  recordFigureCacheOccupancy,
  recordFigureCachePrewarmBake,
  recordFigureCacheRelease,
} from './figureCacheStats';

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
 * Sized to hold a town plaza's own crowd, not just a fight: a crowd of forty
 * strangers drawn from a few dozen looks needs its idle and walk rows warm in
 * every facing at once (a citizen a player is looking at may be facing any of
 * three ways), and the whole crowd's own pinned working set — every look a
 * population this size statistically touches, held resident for as long as
 * the town scene stays open rather than released and re-baked — measures a
 * consistent ~122 MB across world seeds. A pinned row is exempt from active
 * eviction (see `pinFigureState`), so that 122 MB is not headroom the rest of
 * the cache can borrow under pressure: on top of it sits the active player's
 * own per-figure ceiling (56 MB, `HUMAN_FIGURE_BUDGET_MEGABYTES` in
 * `humanFigure.ts`) so a town visit never leaves Carl's own new gear or
 * actions with nowhere to bake. It stays well under what it replaces — the
 * full sheet set decodes to roughly 807 MB and level 3 alone holds about
 * 370 MB resident.
 */
export const CACHE_BUDGET_MEGABYTES = 180;
export const CACHE_BYTE_BUDGET = CACHE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;

/**
 * Default ceiling on one figure's cells.
 *
 * Sized from the pilot conversion, which is the fleet's shape for a boss: the
 * Juicer declares 182 cells of 176×176, which is 21.5 MB with every row of
 * every facing warm at once. Its heaviest row is 1.9 MB, and the three views of
 * its punch — prewarmed together when the telegraph fires — are 4.3 MB. A
 * ceiling below the declared total is one a boss reaches mid-fight, and reaching
 * it evicts the row it is about to play again; above it, the only figure that
 * can reach the ceiling is one holding every row it has, which is the leak the
 * ceiling is there to catch. For the fleet's other extremes this is six of the
 * Ball of Swine's ~3.8 MB rows, or about forty-two of the Grotesque Spider's
 * 384×384 cells of ~576 KB each.
 *
 * A figure whose `FigureDef.budgetMegabytes` is set is measured against that
 * number instead — see {@link figureByteBudgetFor} — but the number here is
 * still what every other figure in the fleet is held to, and it is what the
 * global ceiling below is sized as a multiple of.
 */
const FIGURE_BUDGET_MEGABYTES = 24;
export const FIGURE_BYTE_BUDGET = FIGURE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;

/**
 * The byte ceiling one figure's cells are held to: its own
 * `FigureDef.budgetMegabytes` when it declares one, or the fleet default
 * otherwise.
 *
 * Every admission check in this module goes through this rather than reading
 * {@link FIGURE_BYTE_BUDGET} directly, so a figure that declares an override
 * is honoured wherever the default would otherwise have been assumed —
 * including by the gates that size a real figure's rows, which import this
 * instead of restating the fallback. Only the cache's own gates read
 * {@link FIGURE_BYTE_BUDGET} directly, because the synthetic figures they
 * build to probe the default declare no override.
 */
export function figureByteBudgetFor(def: FigureDef): number {
  return (def.budgetMegabytes ?? FIGURE_BUDGET_MEGABYTES) * BYTES_PER_MEGABYTE;
}

/** RGBA. */
const BYTES_PER_PIXEL = 4;

/**
 * Milliseconds of painting the cache may spend on a frame. Small enough to
 * disappear into one frame's slack, which means a cheap figure warms a whole
 * row in two or three frames while an expensive one lands a cell per frame and
 * paints directly in the meantime.
 *
 * Sized against a town crowd's own closed set, not just one creature: a
 * plaza's worth of citizen looks needing their idle and walk rows warm in
 * every facing is several hundred cells, and a budget too small to clear that
 * queue in a human-scale warm-up window just means every citizen keeps
 * cold-baking whatever pose it currently needs, forever, on the render path
 * this budget exists to keep off. Four milliseconds still disappears into a
 * frame at 60 Hz.
 */
export const FRAME_BAKE_BUDGET_MS = 4;

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
export const PREWARM_BAKE_BUDGET_MS = 3;

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
 * How long a row must have gone undrawn before a bake on the render path may
 * evict it: only the rows drawn on this very frame are the working set it
 * protects, because that bake is for something on screen now.
 */
const RENDER_EVICTION_MIN_IDLE_FRAMES = 1;

/**
 * How long a row must have gone undrawn before a prewarm may evict it.
 *
 * The prewarm queue runs at the top of a frame, before anything has drawn, so
 * the working set it must protect is what the previous frame drew: a row drawn
 * then is one frame idle, and is in use.
 */
const PREWARM_IN_USE_FRAMES = 2;

/**
 * How long a row must have gone undrawn before a speculative prewarm — a row
 * warmed ahead of a use that may never come — may evict it to make room in the
 * whole cache: as long as the idle sweep waits before releasing it anyway. A
 * speculative bake therefore only ever takes free room in the cache, or room
 * the sweep was about to free.
 *
 * Otherwise a full cache turns a queue of speculative rows into a treadmill.
 * A town keeps the cache at its global ceiling, and every walk out of a
 * building rebuilds the town scene, whose wild mobs and party queue their rows
 * again; each would evict whatever was warmed but not drawn lately, to be
 * queued and baked again in turn.
 *
 * A figure at its own ceiling is another matter: it can only make room from
 * its own rows, and a boss whose staged sets together exceed that ceiling is
 * built to trade the set it has finished with for the one it is about to play.
 * So against its own ceiling a speculative prewarm may take its figure's rows
 * once they are out of use, {@link PREWARM_IN_USE_FRAMES}.
 */
const SPECULATIVE_EVICTION_MIN_IDLE_FRAMES = IDLE_FRAMES_BEFORE_RELEASE;

/**
 * How long a row must have gone undrawn before a bake may evict it: to fit the
 * baking figure's own ceiling, and to fit the whole cache's.
 */
interface EvictionPolicy {
  readonly figureCeilingMinIdleFrames: number;
  readonly globalCeilingMinIdleFrames: number;
}

const RENDER_EVICTION: EvictionPolicy = {
  figureCeilingMinIdleFrames: RENDER_EVICTION_MIN_IDLE_FRAMES,
  globalCeilingMinIdleFrames: RENDER_EVICTION_MIN_IDLE_FRAMES,
};

/** For a row about to be drawn, which may take any row out of use. */
const URGENT_PREWARM_EVICTION: EvictionPolicy = {
  figureCeilingMinIdleFrames: PREWARM_IN_USE_FRAMES,
  globalCeilingMinIdleFrames: PREWARM_IN_USE_FRAMES,
};

const SPECULATIVE_PREWARM_EVICTION: EvictionPolicy = {
  figureCeilingMinIdleFrames: PREWARM_IN_USE_FRAMES,
  globalCeilingMinIdleFrames: SPECULATIVE_EVICTION_MIN_IDLE_FRAMES,
};

/**
 * While the idle sweep is held nothing is drawn, so every row reads as out of
 * use and none of them is: behind a loading screen a speculative prewarm takes
 * free room only.
 */
const HELD_SPECULATIVE_PREWARM_EVICTION: EvictionPolicy = {
  figureCeilingMinIdleFrames: Number.POSITIVE_INFINITY,
  globalCeilingMinIdleFrames: Number.POSITIVE_INFINITY,
};

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
  /** How many of the row's frames, from its first, the request covers. */
  frames: number;
  /** Frames this request has been refused for want of room. */
  capacityRefusals: number;
  /**
   * Asked for by something about to draw the row, rather than warmed ahead of
   * a use that may never come — see {@link SPECULATIVE_EVICTION_MIN_IDLE_FRAMES}.
   */
  urgent: boolean;
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
 * The allowance can only be checked *before* a bake starts, so without a debt
 * a figure whose cells cost six milliseconds would spend six every frame for
 * as long as its queue took to drain — a burst of dozens of consecutive
 * over-budget frames, each of which would also leave the rendering that
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
/** Abandoned rows already warned about, so the console hears of each once. */
const warnedAbandonedPrewarms = new Set<string>();

/** When a row was given up on, and whether what was given up was urgent. */
interface AbandonedPrewarm {
  readonly frame: number;
  readonly urgent: boolean;
}

/**
 * Rows the prewarm queue gave up on, by `${figureId}|${state}`.
 *
 * A row nothing has room for is still drawn — each draw paints it directly and
 * asks for it again, urgently. Taken back every time, it would reach the
 * front of the queue with a fresh retry count every frame, be refused there
 * every frame, and keep costing the allowance the rows behind it are waiting
 * on. Refused instead for {@link IDLE_FRAMES_BEFORE_RELEASE}, the window in
 * which the rows crowding it out are themselves released if nothing draws them
 * — the transient pressure that refused it has had its chance to clear.
 *
 * A speculative give-up bars only further speculation. It was refused under
 * {@link SPECULATIVE_PREWARM_EVICTION}, which may take free room alone, so it
 * says nothing about whether the row fits once it is on screen and allowed to
 * displace rows out of use; barring the draw's urgent request on its strength
 * would leave a row that has just come on screen unwarmed for the whole window.
 */
const abandonedPrewarms = new Map<string, AbandonedPrewarm>();

/**
 * Speculative requests let go of for want of free room, since the module
 * loaded — see {@link figurePrewarmGiveUps}.
 */
let speculativePrewarmYields = 0;
/** Requests let go of that a draw was waiting on, or that no cache could ever hold. */
let drawnPrewarmAbandons = 0;

/**
 * Rows the idle sweep must never release, by `${figureId}|${state}`.
 *
 * For a cast that stays on screen for as long as a scene does — a town's
 * strolling crowd — where the idle sweep's ten-second window is a false
 * signal: a look worn by only one or two of the crowd can go that long
 * between draws of its rarer facing and still be squarely part of the
 * working set, not a row that fell out of use. Pinning is metadata over
 * rows the cache already holds; it grants no admission of its own, so a
 * pin on a row nothing has baked yet does nothing until something bakes it.
 */
const pinnedRows = new Set<string>();

function pinKey(figureId: FigureId, state: string): string {
  return `${figureId}|${state}`;
}

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
  if (!idleSweepHeld) releaseIdleRows();
  runPrewarmQueue();
}

/**
 * Whether the idle sweep is suspended — see {@link holdFigureIdleSweep}.
 */
let idleSweepHeld = false;

/**
 * Suspends the idle sweep until {@link releaseFigureIdleSweep}.
 *
 * For a loading screen, which draws no figure at all: the sweep reads "not
 * drawn for ten seconds" as "no longer wanted", and behind a long enough load
 * that would throw away the very rows the load was warming before a single one
 * of them reached the screen.
 */
export function holdFigureIdleSweep(): void {
  idleSweepHeld = true;
}

/**
 * Resumes the idle sweep, counting every held row as drawn now, so the rows a
 * loading screen warmed get the full idle window from the first frame of play
 * rather than from when they were baked.
 */
export function releaseFigureIdleSweep(): void {
  if (!idleSweepHeld) return;
  idleSweepHeld = false;
  for (const entry of entries.values()) {
    for (const row of entry.rows.values()) row.lastFrame = frameCounter;
  }
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
      // A pinned row keeps its place in the least-recently-touched order
      // (pinning does not touch it), so it can sit ahead of rows that are
      // genuinely due for release. Skipped rather than treated as the
      // youngest row, or the scan below would stop at it and leave every
      // older, unpinned row beside it unswept.
      if (pinnedRows.has(pinKey(id, state))) continue;
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
 * Reclaims rows of one figure undrawn for at least `minIdleFrames`, coldest
 * first, until `hasRoom` is satisfied. Rows drawn more recently are the working
 * set; dropping one of them is what turns an over-budget cache into a treadmill
 * that rebuilds everything every frame.
 */
function evictStaleRowsOf(
  id: FigureId,
  entry: FigureEntry,
  hasRoom: () => boolean,
  minIdleFrames: number,
): void {
  for (const [state, row] of entry.rows) {
    if (hasRoom()) return;
    if (frameCounter - row.lastFrame < minIdleFrames) continue;
    // A pin is a promise the row stays resident for as long as whatever
    // pinned it says so — a town scene's own crowd, kept warm for the scene's
    // whole life rather than released and re-baked. Active eviction breaking
    // that promise under byte pressure is exactly the bug pinning exists to
    // prevent, so a pinned row is skipped here the same way `releaseIdleRows`
    // skips it, never dropped as the cache's last resort for room.
    if (pinnedRows.has(pinKey(id, state))) continue;
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
function evictStaleForGlobalBytes(bytes: number, minIdleFrames: number): void {
  if (admitsGlobally(bytes)) return;
  for (const [id, entry] of entries) {
    evictStaleRowsOf(id, entry, () => admitsGlobally(bytes), minIdleFrames);
    if (admitsGlobally(bytes)) break;
  }
  publishOccupancy();
}

function evictStaleForFigureBytes(entry: FigureEntry, bytes: number, minIdleFrames: number): void {
  if (admitsForFigure(entry, bytes)) return;
  evictStaleRowsOf(entry.def.id, entry, () => admitsForFigure(entry, bytes), minIdleFrames);
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

/** Whether a cell of this figure fits its own ceiling and the whole cache's, both empty. */
function cellCanEverFit(entry: FigureEntry): boolean {
  const bytes = cellBytes(entry);
  return bytes <= figureByteBudgetFor(entry.def) && bytes <= CACHE_BYTE_BUDGET;
}

function admitsGlobally(bytes: number): boolean {
  return residentBytes() + bytes <= CACHE_BYTE_BUDGET;
}

function admitsForFigure(entry: FigureEntry, bytes: number): boolean {
  return entry.bytes + bytes <= figureByteBudgetFor(entry.def);
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
    // Pops the density transform however the painter ended. It cannot pop a
    // save the painter itself made and then threw past; the pooled callers
    // discard their surface for that case.
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

/**
 * Throws away the scratch surface the innermost paint is using.
 *
 * `paintInto`'s save/restore pops one level of the context's state stack, but
 * a painter that throws between a `save()` of its own and the matching
 * `restore()` leaves its clip, `globalAlpha` and whatever else it set sitting
 * beneath that level, where no reset `acquireScratch` performs can reach them —
 * so every later cell painted on the pooled surface is clipped and faded by a
 * paint that no longer exists. `ctx.reset()` would unwind it but is not
 * available on every canvas this runs on; a fresh surface always is, and a
 * throwing painter is rare enough that reallocating after one costs nothing.
 */
function discardInnermostScratch(): void {
  const level = scratchDepth - 1;
  const poisoned = scratchStack[level] ?? null;
  if (poisoned === null) return;
  scratchBytes -= surfaceBytes(poisoned);
  scratchStack[level] = null;
  publishOccupancy();
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
  eviction: EvictionPolicy,
): CanvasSurface | null {
  const bytes = cellBytes(entry);
  // No eviction can free room for a cell that does not fit an empty cache, and
  // sweeping for one only destroys rows that were serving somebody.
  if (!cellCanEverFit(entry)) return null;
  if (!admitsForFigure(entry, bytes)) {
    evictStaleForFigureBytes(entry, bytes, eviction.figureCeilingMinIdleFrames);
    if (!admitsForFigure(entry, bytes)) return null;
  }
  if (!admitsGlobally(bytes)) {
    evictStaleForGlobalBytes(bytes, eviction.globalCeilingMinIdleFrames);
    if (!admitsGlobally(bytes)) return null;
  }

  const startedAt = performance.now();
  const msBakedBefore = msBakedThisFrame;
  const supersample = figureBakeDensity(entry.def);
  const superWidth = entry.cellPixelWidth * supersample;
  const superHeight = entry.cellPixelHeight * supersample;
  const cell = allocCanvas(entry.cellPixelWidth, entry.cellPixelHeight);
  const surface = acquireScratch(superWidth, superHeight);
  try {
    paintInto(surfaceContext(surface), entry.def, state, frame, entry.bakeScale * supersample);
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
  } catch (error) {
    discardInnermostScratch();
    throw error;
  } finally {
    releaseScratch();
  }

  row.cells.set(frame, cell);
  row.bytes += bytes;
  entry.bytes += bytes;
  cachedBytes += bytes;
  const elapsedMs = performance.now() - startedAt;
  recordBakeCost(entry, elapsedMs);
  recordFigureCacheBakeMs(elapsedMs);
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
 *
 * `frameLimit` warms only the row's first frames — a blow's wind-up up to the
 * frame it lands on, say, where the rest can bake while the first frames play.
 *
 * `urgent` puts the request at the front of the queue instead of the back —
 * for a row about to be drawn this frame or the next, not merely warmed
 * ahead of an eventual use, where waiting behind whatever speculative
 * backlog already queued (a player's own figure warming rows for a fight
 * that has not started, say) would mean the thing on screen right now stays
 * an approximation for however long that backlog takes to drain.
 */
export function prewarmFigureState(
  def: FigureDef,
  state: string,
  frameLimit?: number,
  urgent = false,
): void {
  const declared = figureFrameCount(def, state);
  if (declared === 0) {
    warnMissingState(def, state);
    return;
  }
  if (isPrewarmAbandoned(def.id, state, urgent)) return;
  const frames = Math.min(declared, frameLimit ?? declared);
  const queuedIndex = prewarmQueue.findIndex(
    (pending) => pending.def.id === def.id && pending.state === state,
  );
  if (queuedIndex !== -1) {
    const queued = prewarmQueue[queuedIndex];
    queued.frames = Math.max(queued.frames, frames);
    // Already-queued work moves to the front the same way newly-queued work
    // does — a row already waiting behind a large speculative backlog is
    // exactly the row `urgent` exists to rescue.
    if (urgent) queued.urgent = true;
    if (urgent && queuedIndex > 0) {
      prewarmQueue.splice(queuedIndex, 1);
      prewarmQueue.unshift(queued);
    }
    return;
  }
  const request: PrewarmRequest = { def, state, frames, capacityRefusals: 0, urgent };
  if (urgent) prewarmQueue.unshift(request);
  else prewarmQueue.push(request);
}

/**
 * The cache's own frame clock: one tick per rendered frame, the clock
 * {@link IDLE_FRAMES_BEFORE_RELEASE} is counted on. A caller keeping rows warm
 * has to pace itself by this rather than by gameplay updates, which run at a
 * fixed rate however fast the screen refreshes, and not at all while paused.
 */
export function figureCacheFrame(): number {
  return frameCounter;
}

/** Frames still waiting to be prewarmed. For gates and dev readouts. */
export function figurePrewarmDepth(): number {
  return prewarmQueue.length;
}

/**
 * Marks a row as wanted without drawing it: its last-use frame moves to now,
 * so the idle sweep passes it over, and it moves to the fresh end of its own
 * figure's rows. Nothing is baked or queued. Returns whether every frame of
 * the row is warm at the scale the cache bakes at now — a row baked before a
 * quality change is dropped at the next draw — so a caller keeping rows alive
 * knows which to ask for again.
 *
 * Less than a hit: the figure keeps its place in the cache's least-recently-
 * used order, which only draws and bakes move. Under pressure a row that is
 * only touched therefore goes before the rows of a figure drawn since — a
 * touch is a hope that a row will be drawn, and must never cost a row that is
 * on screen its place.
 *
 * For keeping rows warm ahead of a moment they will certainly be drawn in — an
 * assault wave through its countdown — without re-queuing them behind cold
 * bakes. A re-queued warm row waits its turn behind every cell ahead of it,
 * and a row that waits past the idle window is swept before it is refreshed.
 */
export function touchFigureState(def: FigureDef, state: string): boolean {
  const entry = entries.get(def.id);
  if (entry === undefined) return false;
  const row = entry.rows.get(state);
  if (row === undefined) return false;
  entry.rows.delete(state);
  entry.rows.set(state, row);
  row.lastFrame = frameCounter;
  const bakedAtCurrentScale = entry.bakeScale === bakeScaleNow();
  return bakedAtCurrentScale && row.cells.size >= figureFrameCount(def, state);
}

/**
 * Does to the cache what drawing a warm row does, without the blit: the figure
 * and the row move to the fresh end of the least-recently-used order and the
 * row is marked drawn this frame. A row that is not held is left alone, not
 * baked. For headless gates holding a scene's worth of rows on screen through
 * thousands of frames, where the blits, not the cache, would be the cost.
 */
export function markFigureStateDrawn(def: FigureDef, state: string): void {
  const entry = entries.get(def.id);
  const heldAtCurrentScale = entry?.bakeScale === bakeScaleNow() && entry.rows.has(state);
  if (!heldAtCurrentScale) return;
  rowFor(entryFor(def), state);
}

/**
 * Exempts one row from the idle sweep until {@link unpinFigureState} undoes it.
 *
 * A pin outlives the row it names: pinning ahead of a bake that has not
 * landed yet is fine (the sweep has nothing to release either way), and a
 * released or evicted row can be re-baked and is still exempt once it lands
 * again, without pinning it a second time.
 */
export function pinFigureState(def: FigureDef, state: string): void {
  pinnedRows.add(pinKey(def.id, state));
}

/** How many rows are pinned right now, for a harness watching the pin set stay bounded. */
export function pinnedFigureRowCount(): number {
  return pinnedRows.size;
}

/**
 * What the pin set holds right now: how many pinned rows have at least one
 * cell baked, and their bytes. A pin set whose bytes approach the whole
 * budget leaves nothing for any unpinned figure to bake into.
 */
export function pinnedFigureFootprint(): { bakedRows: number; bytes: number } {
  let bakedRows = 0;
  let bytes = 0;
  for (const [id, entry] of entries) {
    for (const [state, row] of entry.rows) {
      if (!pinnedRows.has(pinKey(id, state)) || row.cells.size === 0) continue;
      bakedRows++;
      bytes += row.bytes;
    }
  }
  return { bakedRows, bytes };
}

/** Whether {@link holdFigureIdleSweep} is in force. */
export function isFigureIdleSweepHeld(): boolean {
  return idleSweepHeld;
}

/** Undoes {@link pinFigureState}. A row that was never pinned is left alone. */
export function unpinFigureState(def: FigureDef, state: string): void {
  pinnedRows.delete(pinKey(def.id, state));
}

/**
 * Releases every pin at once, for a scene giving up the working set it
 * pinned rather than naming each row it pinned one at a time.
 */
export function unpinAllFigureStates(): void {
  pinnedRows.clear();
}

/** Bytes still to bake for the first `frames` frames of a row, at the scale the cache bakes at now. */
function unbakedBytes(def: FigureDef, state: string, frames: number): number {
  const scale = bakeScaleNow();
  const cellBytesAtScale =
    Math.max(1, Math.ceil(def.frameWidth * scale)) *
    Math.max(1, Math.ceil(def.frameHeight * scale)) *
    BYTES_PER_PIXEL;
  const entry = entries.get(def.id);
  const cells = entry?.bakeScale === scale ? entry.rows.get(state)?.cells : undefined;
  let missing = 0;
  for (let frame = 0; frame < frames; frame++) {
    if (cells?.has(frame) !== true) missing++;
  }
  return missing * cellBytesAtScale;
}

/**
 * Whether the rest of a row can be baked without evicting anything, once
 * every request already in the prewarm queue has baked ahead of it: its
 * missing cells fit under the global ceiling and the figure's own budget.
 *
 * For a caller warming rows ahead of need that must never push the rows on
 * screen out. The prewarm queue drains at the start of a frame, before
 * anything is drawn in it, so to its eviction every row is stale, and the rows
 * drawn a frame ago are as likely to go as any — whose rebake on the draw then
 * evicts the warmed row in turn, every frame. The queue ahead is counted
 * because it spends the same room first.
 */
export function figureRowFitsWithoutEviction(def: FigureDef, state: string): boolean {
  const neededBytes = unbakedBytes(def, state, figureFrameCount(def, state));
  if (neededBytes <= 0) return true;
  let queuedBytes = 0;
  let queuedFigureBytes = 0;
  for (const pending of prewarmQueue) {
    if (pending.def.id === def.id && pending.state === state) continue;
    const bytes = unbakedBytes(pending.def, pending.state, pending.frames);
    queuedBytes += bytes;
    if (pending.def.id === def.id) queuedFigureBytes += bytes;
  }
  const entry = entries.get(def.id);
  const figureBytes = entry?.bakeScale === bakeScaleNow() ? entry.bytes : 0;
  const fitsFigure = figureBytes + queuedFigureBytes + neededBytes <= figureByteBudgetFor(def);
  return admitsGlobally(queuedBytes + neededBytes) && fitsFigure;
}

/**
 * Frames remaining of an elevated prewarm budget, and the budget itself —
 * see {@link boostPrewarmBudget}. Zero frames remaining means the ordinary
 * {@link PREWARM_BAKE_BUDGET_MS} applies.
 */
let boostedPrewarmBudgetMs = 0;
let boostedPrewarmFramesRemaining = 0;

function effectivePrewarmBudgetMs(): number {
  return boostedPrewarmFramesRemaining > 0 ? boostedPrewarmBudgetMs : PREWARM_BAKE_BUDGET_MS;
}

/**
 * Raises the prewarm queue's per-frame budget for a bounded number of frames,
 * still paced one frame at a time rather than run to completion.
 *
 * For a scene arriving with a closed set larger than the ordinary budget can
 * clear before a player notices — a town's whole crowd, say — behind
 * whatever transition already exists (a level-arrival fade, a loading
 * screen) rather than blocking the thread outright: every frame still
 * renders, at up to `ms` of baking instead of {@link PREWARM_BAKE_BUDGET_MS},
 * so the cost is spread and bounded rather than paid as one freeze. A second
 * call while frames remain from the first extends rather than stacks, taking
 * the larger of the two budgets and the later of the two expiries.
 */
export function boostPrewarmBudget(ms: number, frames: number): void {
  boostedPrewarmBudgetMs = Math.max(boostedPrewarmBudgetMs, ms);
  boostedPrewarmFramesRemaining = Math.max(boostedPrewarmFramesRemaining, frames);
}

function runPrewarmQueue(): void {
  const budgetMs = effectivePrewarmBudgetMs();
  if (boostedPrewarmFramesRemaining > 0) boostedPrewarmFramesRemaining--;
  if (prewarmDebtMs > 0) {
    prewarmDebtMs = Math.max(0, prewarmDebtMs - budgetMs);
    return;
  }
  try {
    // Ahead of the bakes: a queued row is an overhead marker waiting on screen
    // now, where a prewarm is a pose that may be wanted later.
    measureQueuedRowInk(budgetMs);
    drainPrewarmQueue(budgetMs);
  } finally {
    // Whatever this frame's prewarming ran over by is owed back, however it
    // ended — a painter that threw has still spent the time.
    prewarmDebtMs += Math.max(0, msBakedThisFrame - budgetMs);
  }
}

/**
 * Bakes from the front of the queue until the allowance is spent.
 *
 * A row refused for want of room goes to the back and the drain carries on
 * with the next one: whatever refused that row says nothing about a smaller
 * figure behind it. The drain stops once it comes back round to a row it has
 * already had refused this frame, since everything still queued then has been.
 */
function drainPrewarmQueue(budgetMs: number): void {
  const refusedThisFrame = new Set<PrewarmRequest>();
  while (prewarmQueue.length > 0 && msBakedThisFrame < budgetMs) {
    const pending = prewarmQueue[0];
    if (refusedThisFrame.has(pending)) return;
    const entry = entryFor(pending.def);
    if (!fitsBakeAllowance(entry, msBakedThisFrame, budgetMs)) return;
    const row = rowFor(entry, pending.state);
    let baked = false;
    let refused = false;
    for (let frame = 0; frame < pending.frames; frame++) {
      if (row.cells.has(frame)) continue;
      if (!fitsBakeAllowance(entry, msBakedThisFrame, budgetMs)) return;
      if (bakeCell(entry, row, pending.state, frame, prewarmEviction(pending)) === null) {
        dropRowIfEmpty(entry, pending.state, row);
        deferRefusedPrewarm(pending);
        refusedThisFrame.add(pending);
        refused = true;
        break;
      }
      recordFigureCachePrewarmBake();
      baked = true;
      if (msBakedThisFrame >= budgetMs) return;
    }
    if (!baked && !refused) prewarmQueue.shift();
  }
}

/**
 * Bakes queued prewarm rows for up to `budgetMs`, on top of the frame's own
 * paced prewarm share.
 *
 * For a caller that owns the whole frame — a loading screen, with no figure on
 * screen that could be waiting on a bake — and so can drain the queue at the
 * rate it chooses rather than trickle it. Honours `budgetMs` as a ceiling rather
 * than a mean: a cell starts only if the figure's measured cost fits what is
 * left, except the first when `mustProgress` says nothing else has run this
 * frame. Books no debt, since the caller is the one pacing itself.
 */
export function bakeFigurePrewarmFor(budgetMs: number, mustProgress: boolean): void {
  const spentBefore = msBakedThisFrame;
  const spentMs = (): number => msBakedThisFrame - spentBefore;
  // Stricter than `fitsBakeAllowance`: a figure with no estimate yet is let
  // through only as the frame's owed first unit, never on top of other work,
  // because its first cell is the one bake whose cost nobody can predict.
  const fitsCeiling = (entry: FigureEntry): boolean => {
    const estimate = estimatedBakeMs(entry);
    return estimate !== null && spentMs() + estimate <= budgetMs;
  };
  let startedAny = false;
  // A refused row goes to the back of the queue; meeting it again at the front
  // means every row still queued has been refused this call.
  const refusedThisCall = new Set<PrewarmRequest>();
  while (prewarmQueue.length > 0) {
    const pending = prewarmQueue[0];
    if (refusedThisCall.has(pending)) return;
    const entry = entryFor(pending.def);
    const row = rowFor(entry, pending.state);
    let refused = false;
    for (let frame = 0; frame < pending.frames; frame++) {
      if (row.cells.has(frame)) continue;
      const owedFirstCell = mustProgress && !startedAny;
      if (!owedFirstCell && !fitsCeiling(entry)) {
        dropRowIfEmpty(entry, pending.state, row);
        return;
      }
      startedAny = true;
      if (bakeCell(entry, row, pending.state, frame, prewarmEviction(pending)) === null) {
        dropRowIfEmpty(entry, pending.state, row);
        deferRefusedPrewarm(pending);
        refusedThisCall.add(pending);
        refused = true;
        break;
      }
      recordFigureCachePrewarmBake();
    }
    if (!refused) prewarmQueue.shift();
  }
}

/**
 * Cells the prewarm queue still owes, and what they are expected to cost.
 *
 * A figure no cell has been baked of yet has no estimate, and is costed at
 * `unmeasuredCellMs` — the caller's guess, since the honest answer is "one bake
 * will tell". For deciding whether a wait is worth a loading screen, not for
 * pacing.
 */
export function figurePrewarmOwed(unmeasuredCellMs: number): { cells: number; ms: number } {
  const scale = bakeScaleNow();
  let cells = 0;
  let ms = 0;
  for (const pending of prewarmQueue) {
    const entry = entries.get(pending.def.id);
    const heldCells = entry?.bakeScale === scale ? entry.rows.get(pending.state)?.cells : undefined;
    let missing = 0;
    for (let frame = 0; frame < pending.frames; frame++) {
      if (heldCells?.has(frame) !== true) missing++;
    }
    const estimate = bakeCostByFigure.get(pending.def.id);
    const perCellMs = estimate?.bakeScale === scale ? estimate.msPerCell : unmeasuredCellMs;
    cells += missing;
    ms += missing * perCellMs;
  }
  return { cells, ms };
}

function prewarmEviction(pending: PrewarmRequest): EvictionPolicy {
  if (pending.urgent) return URGENT_PREWARM_EVICTION;
  return idleSweepHeld ? HELD_SPECULATIVE_PREWARM_EVICTION : SPECULATIVE_PREWARM_EVICTION;
}

/**
 * Puts a request the cache had no room for back at the end of the queue, so the
 * frames it went unwarmed cost it its place rather than its existence. Past
 * {@link PREWARM_CAPACITY_RETRIES} it is abandoned instead — see
 * {@link abandonedPrewarms}.
 */
function deferRefusedPrewarm(pending: PrewarmRequest): void {
  prewarmQueue.shift();
  pending.capacityRefusals += 1;
  if (pending.capacityRefusals < PREWARM_CAPACITY_RETRIES) {
    prewarmQueue.push(pending);
    return;
  }
  abandonedPrewarms.set(pinKey(pending.def.id, pending.state), {
    frame: frameCounter,
    urgent: pending.urgent,
  });
  // A speculative row yielding to a cache that is full of rows in use is the
  // eviction policy working as intended: a town arrival or a building exit
  // queues rows for every wild mob on the map, and most of them are never on
  // screen. What is worth a warning is a row something is drawing, or one
  // that no amount of room could ever admit — a figure declared too big for
  // its own budget.
  if (pending.urgent || !cellCanEverFit(entryFor(pending.def))) {
    drawnPrewarmAbandons++;
    warnPrewarmAbandoned(pending);
    return;
  }
  speculativePrewarmYields++;
}

/**
 * Prewarm requests given up on since the module loaded: speculative ones that
 * yielded to a full cache, which is the eviction policy doing its job, and
 * ones that were for a row on screen or that could never fit, which are the
 * ones worth a warning. Cumulative, for a harness to take the difference
 * across whatever it is measuring.
 */
export function figurePrewarmGiveUps(): { speculativeYields: number; drawnAbandons: number } {
  return { speculativeYields: speculativePrewarmYields, drawnAbandons: drawnPrewarmAbandons };
}

/** Whether the row was abandoned recently enough that this request for it is refused. */
function isPrewarmAbandoned(figureId: FigureId, state: string, urgent: boolean): boolean {
  const key = pinKey(figureId, state);
  const abandoned = abandonedPrewarms.get(key);
  if (abandoned === undefined) return false;
  const withinWindow = frameCounter - abandoned.frame < IDLE_FRAMES_BEFORE_RELEASE;
  const urgentAfterSpeculation = urgent && !abandoned.urgent;
  if (withinWindow && !urgentAfterSpeculation) return true;
  abandonedPrewarms.delete(key);
  return false;
}

/**
 * Drops every cell of one figure and every prewarm queued for it, at once.
 *
 * For a figure that has been replaced rather than merely left undrawn — Carl
 * changing outfit, say — where waiting on the idle release would hold the old
 * figure's rows beside the new one's for {@link IDLE_FRAMES_BEFORE_RELEASE}
 * frames, and a figure whose working set alone nearly fills its budget has no
 * room for two.
 */
export function releaseFigure(def: FigureDef): void {
  const entry = entries.get(def.id);
  if (entry !== undefined) {
    for (const [state, row] of entry.rows) {
      dropRow(entry, state, row);
      recordFigureCacheRelease();
    }
    entries.delete(def.id);
  }
  for (let i = prewarmQueue.length - 1; i >= 0; i--) {
    if (prewarmQueue[i].def.id === def.id) prewarmQueue.splice(i, 1);
  }
  // Freeing this figure's rows is exactly the room an abandoned row was refused for.
  abandonedPrewarms.clear();
  if (entries.size === 0) releaseScratchSurfaces();
  publishOccupancy();
}

/** Bytes of baked cells one figure is holding right now. For gates and dev readouts. */
export function figureResidentBytes(def: FigureDef): number {
  return entries.get(def.id)?.bytes ?? 0;
}

/** Prewarm requests queued for one figure. For gates and dev readouts. */
export function figurePrewarmRequests(def: FigureDef): number {
  return prewarmQueue.filter((pending) => pending.def.id === def.id).length;
}

function warnMissingState(def: FigureDef, state: string): void {
  const signature = `${def.id}:${state}`;
  if (missedStates.has(signature)) return;
  missedStates.add(signature);
  console.warn(`[figureFrameCache] "${def.id}" declares no state "${state}"`);
}

function warnPrewarmAbandoned(pending: PrewarmRequest): void {
  const signature = `${pending.def.id}:${pending.state}`;
  if (warnedAbandonedPrewarms.has(signature)) return;
  warnedAbandonedPrewarms.add(signature);
  const reason = pending.urgent ? 'while it was on screen' : 'which no empty cache could hold';
  console.warn(
    `[figureFrameCache] gave up prewarming "${pending.def.id}" state "${pending.state}" ${reason}, ` +
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
  // A direct paint is the one path that pays a painter's full price every
  // frame it recurs, and nothing else asks for a row that is only ever missed
  // here: the frame's bake budget went to the prewarm queue, say, before the
  // render reached it. Asked for urgently, it is baked at the front of the
  // next frame's queue instead of being painted again, and again.
  prewarmFigureState(def, state, undefined, true);
  const width = Math.max(1, Math.ceil(def.frameWidth * scale));
  const height = Math.max(1, Math.ceil(def.frameHeight * scale));
  const surface = acquireScratch(width, height);
  try {
    paintInto(surfaceContext(surface), def, state, frame, scale);
    // A pooled surface may be larger than this figure needs, so the source rect
    // is stated rather than left to default to the whole surface.
    ctx.drawImage(surface, 0, 0, width, height, destX, destY, width, height);
  } catch (error) {
    discardInnermostScratch();
    throw error;
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
  const baked = bakeCell(entry, row, state, frame, RENDER_EVICTION);
  if (baked === null) {
    dropRowIfEmpty(entry, state, row);
    return null;
  }
  recordFigureCacheBake();
  return placed(entry, baked, scale);
}

/** The already-baked cell of a row closest to the frame actually wanted. */
function nearestBakedCell(row: FigureRow, wantedFrame: number): CanvasSurface | null {
  let best: CanvasSurface | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [cellFrame, surface] of row.cells) {
    const distance = Math.abs(cellFrame - wantedFrame);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = surface;
    }
  }
  return best;
}

/** Any already-baked cell of the figure, for a row that has nothing of its own yet. */
function anyBakedCell(entry: FigureEntry): CanvasSurface | null {
  for (const row of entry.rows.values()) {
    const cell = nearestBakedCell(row, 0);
    if (cell !== null) return cell;
  }
  return null;
}

/**
 * Re-queues a pinned row that has nothing to show at all — the safety net for
 * a pin whose row went missing some way {@link evictStaleRowsOf}'s own pin
 * check does not cover (a bake-scale change drops every row of a figure
 * outright, `entryFor`'s own rebuild path, regardless of what was pinned).
 * Without this a citizen whose pinned row vanished would fall to a
 * `directPaint` every single frame forever rather than getting baked back and
 * pinned again within the next few; harmless to call repeatedly while the row
 * is still missing, since `prewarmFigureState` already dedupes against its
 * own queue.
 */
function requeuePinnedRowIfMissing(def: FigureDef, state: string): void {
  // Urgent: whatever is missing is being asked for on the render path this
  // very frame, not warmed ahead of an eventual need.
  if (pinnedRows.has(pinKey(def.id, state))) prewarmFigureState(def, state, undefined, true);
}

/**
 * The exact cell when it is warm, or a stand-in already-baked cell when it is
 * not — the nearest frame of the same row, or failing that any warm row of
 * the same figure. Never bakes: a caller that reaches this function has
 * already decided a slightly-wrong pose this frame costs less than a bake on
 * the render path, so the only two outcomes are a cell (exact or borrowed)
 * or `null` when the figure has nothing baked at all yet.
 */
function approxCellFor(
  def: FigureDef,
  state: string,
  frame: number,
  scale: number,
): PlacedCell | null {
  const entry = entries.get(def.id);
  if (entry?.bakeScale !== bakeScaleNow()) {
    recordFigureCacheMiss();
    requeuePinnedRowIfMissing(def, state);
    return null;
  }
  const row = entry.rows.get(state);
  const exact = row?.cells.get(frame);
  if (exact !== undefined) {
    recordFigureCacheHit();
    return placed(entry, exact, scale);
  }
  recordFigureCacheMiss();
  const standIn = (row !== undefined ? nearestBakedCell(row, frame) : null) ?? anyBakedCell(entry);
  if (standIn === null) {
    requeuePinnedRowIfMissing(def, state);
    return null;
  }
  recordFigureCacheApproxDraw();
  // The stand-in covers this frame; the exact row is now wanted on screen, not
  // on speculation, so it is asked for as such — a speculative request for it
  // may be waiting behind a full cache that only an urgent one can make room in.
  prewarmFigureState(def, state, undefined, true);
  return placed(entry, standIn, scale);
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
 * {@link drawFigureCached}'s contract, but never bakes on the render path: a
 * miss draws the nearest already-baked frame of the same row, or any
 * already-baked row of the same figure, instead of paying for the exact one.
 *
 * For a crowd of many near-identical figures sharing one prewarm queue,
 * where the exact frame not being warm yet is a beat of the wrong pose for
 * one figure in a crowd — invisible at a glance, and gone once the row this
 * frame actually wanted finishes warming on the paced queue — rather than a
 * bake the render path pays for on the spot. Only a figure with nothing
 * baked at all yet falls back to a direct paint, the one case a stand-in
 * cannot help with.
 */
export function drawFigureCachedApprox(
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
  const cell = approxCellFor(def, state, clamped, scale);
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
function figureInkBounds(def: FigureDef, state: string, frame: number): FrameInkBounds {
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

const rowInkTopByRow = new Map<DrawnFigureRow, number>();

/** A row whose frames are being measured a few at a time, and what they have shown so far. */
interface PendingRowInk {
  readonly row: DrawnFigureRow;
  nextFrame: number;
  topCellPx: number;
}

const rowInkQueue: PendingRowInk[] = [];
const queuedRowInk = new Set<DrawnFigureRow>();

/**
 * The screen y of the highest pixel a row ever paints, across every one of its
 * frames, for a figure whose tile's top-left is at screen y `sy`.
 *
 * Every frame rather than the one on screen, so anything hung over the art —
 * a quest marker above all — stays put while an idle loop bobs or flicks an
 * ear underneath it, instead of riding the bob.
 *
 * Never measures on the caller's frame: painting every frame of a row to read
 * it back costs tens of milliseconds. A row not yet measured is queued onto
 * the prewarm budget, and until it lands the answer is the top of the
 * figure's cell. No painted pixel can stand above that, so the stand-in only
 * ever errs high. Another row of the same figure is no stand-in: a head toss
 * or a raised arm stands taller than the idle it would be borrowed from.
 */
export function figureRowInkTop(row: DrawnFigureRow, sy: number, tileSize: number): number {
  const scale = tileSize / row.def.tileScale;
  const measured = rowInkTopByRow.get(row);
  if (measured !== undefined) return sy - (row.def.tileY - measured) * scale;
  if (!queuedRowInk.has(row)) {
    queuedRowInk.add(row);
    rowInkQueue.push({ row, nextFrame: 0, topCellPx: row.def.frameHeight });
  }
  return sy - row.def.tileY * scale;
}

/** Rows {@link figureRowInkTop} has queued and not yet finished measuring. */
export function figureRowInkPending(): number {
  return rowInkQueue.length;
}

/**
 * Measures queued rows one frame at a time until this frame's prewarm spend
 * reaches `budgetMs`. The time is booked against the same spend the bakes
 * are, so an overrun is owed back out of later frames like any other.
 */
function measureQueuedRowInk(budgetMs: number): void {
  while (rowInkQueue.length > 0 && msBakedThisFrame < budgetMs) {
    const pending = rowInkQueue[0];
    const { def, state } = pending.row;
    const startedAt = performance.now();
    const bounds = figureInkBounds(def, state, pending.nextFrame);
    msBakedThisFrame += performance.now() - startedAt;
    pending.topCellPx = Math.min(pending.topCellPx, bounds.top);
    pending.nextFrame++;
    if (pending.nextFrame < figureFrameCount(def, state)) continue;
    rowInkQueue.shift();
    queuedRowInk.delete(pending.row);
    rowInkTopByRow.set(pending.row, pending.topCellPx);
  }
}

/**
 * The one surface every ink measurement paints into and reads back. Kept
 * rather than allocated per frame measured, and declared read-heavy so the
 * readback is not a GPU round trip each time.
 */
let inkScratch: CanvasSurface | null = null;

function inkScratchFitting(width: number, height: number): CanvasSurface {
  if (inkScratch !== null && inkScratch.width >= width && inkScratch.height >= height) {
    return inkScratch;
  }
  const grownWidth = Math.max(width, inkScratch?.width ?? 0);
  const grownHeight = Math.max(height, inkScratch?.height ?? 0);
  inkScratch = allocReadableCanvas(grownWidth, grownHeight);
  return inkScratch;
}

function measureFigureInk(def: FigureDef, state: string, frame: number): FrameInkBounds {
  const wholeCell: FrameInkBounds = {
    centerX: def.frameWidth / 2,
    centerY: def.frameHeight / 2,
    radius: Math.hypot(def.frameWidth, def.frameHeight) / 2,
    top: 0,
  };

  const width = Math.ceil(def.frameWidth);
  const height = Math.ceil(def.frameHeight);
  const ctx = surfaceContext(inkScratchFitting(width, height));
  ctx.clearRect(0, 0, width, height);
  try {
    paintInto(ctx, def, state, frame, 1);
  } catch (error) {
    // A painter that threw past its own save leaves the context's state stack
    // unbalanced; the surface is dropped rather than handed to the next frame.
    inkScratch = null;
    throw error;
  }

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
  return { centerX, centerY, radius: Math.sqrt(radiusSq), top: minY };
}

/**
 * Drops every baked cell and every pending prewarm.
 *
 * Called when the render quality changes — cells are density-specific — and at
 * a floor change, where the sheet path evicts its sheets for the same reason:
 * whatever the next floor still needs is rebuilt lazily and nothing else is
 * paid for.
 */
export function flushFigureFrameCache(): void {
  entries.clear();
  prewarmQueue.length = 0;
  abandonedPrewarms.clear();
  // A pin naming a row that no longer exists is dead weight, not a leak on
  // its own, but nothing keeps it meaningful once every cell it could have
  // named is gone.
  pinnedRows.clear();
  // The queue it was owed against is gone, so the next floor's first prewarm
  // must not open paused. What a painter costs survives, though: the estimates
  // are a property of the painter rather than of any cell, and re-learning them
  // is exactly the over-budget bake they exist to prevent.
  prewarmDebtMs = 0;
  // A boost is a promise about the arrival that queued it; a flush means that
  // arrival's own queue is gone too, so the promise has nothing left to keep.
  boostedPrewarmBudgetMs = 0;
  boostedPrewarmFramesRemaining = 0;
  // Held for a loading screen whose scene is being left along with everything
  // it warmed; nothing is left for the hold to protect.
  idleSweepHeld = false;
  // The measured ink stays: a few numbers per frame, a property of the painter
  // rather than of the bake, and remeasuring them is the cost they exist to
  // save. Rows still queued are dropped with the floor that asked for them.
  rowInkQueue.length = 0;
  queuedRowInk.clear();
  cachedBytes = 0;
  cachedRows = 0;
  releaseScratchSurfaces();
  publishOccupancy();
}
