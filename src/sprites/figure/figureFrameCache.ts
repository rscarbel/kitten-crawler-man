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
 *  - **A busy frame borrows rather than paints.** A miss past the frame's bake
 *    allowance draws the figure's nearest baked frame and asks for its own
 *    urgently, so a crowd's misses cost blits, not painters.
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
  BYTES_PER_MEGABYTE,
  CanvasContextUnavailableError,
  freshSurfaceContext,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/canvasSurface';
import { onCanvasRecovery, reportCanvasAllocationFailure } from '../../core/canvasRecovery';
import { shouldDownscaleForLowEndDevice } from '../../core/SpriteLoader';
import { memoryBudgetScale } from '../../core/deviceMemoryBudget';
import type { DrawSpriteOpts } from '../../core/SpriteRenderer';
import { EMPTY_ALPHA_CUTOFF, type FrameInkBounds } from '../../core/spriteFrames';
import {
  figureBakeDensity,
  type FigureDef,
  figureFrameCount,
  type FigureId,
  type DrawnFigureRow,
  drawnFigureRow,
} from './figureDef';
import { perfMonitor } from '../../core/PerfMonitor';
import {
  beginFigureCacheStatsFrame,
  type FigureDirectDrawCause,
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
 * population this size statistically touches, held resident while the party
 * is near the crowd rather than released and re-baked — measures a
 * consistent ~122 MB across world seeds. A pinned row is exempt from active
 * eviction (see `pinFigureState`), so the rest of the cache cannot borrow it
 * under pressure.
 *
 * The per-figure budgets — the active player's 67 MB
 * (`HUMAN_FIGURE_BUDGET_MEGABYTES` in `humanFigure.ts`) among them — are
 * ceilings on what one figure may hold, not residency that sits on top of the
 * crowd's: adding the two would overstate the need, since a town draws fewer
 * of his rows than a fight. What sizes this ceiling is the two measured
 * together: in the plaza with the crowd pinned and Carl carrying the weapon
 * whose rows take the most room, drawing and stowing it, the cache peaked at
 * 133.0, 139.9 and 142.5 MB across three runs, with no eviction and no
 * direct paint. While he carries a weapon his empty-handed figure stays
 * resident beside the carrying one, but none of its rows is drawn while the
 * other is, so they are the first a full cache gives up.
 *
 * Arriving on level 3 is the tightest moment: behind the loading screen the
 * town's crowd, the fairies, Carl and Donut — her side views in both facings —
 * are warmed together. Uncapped that asks for 200.6 MB; stale-row eviction
 * carries it home with no figure baked or painted on the render path from
 * 184 MB up, and this ceiling keeps a few megabytes over that. It stays well
 * under what it replaces — the full sheet set decodes to roughly 807 MB and
 * level 3 alone holds about 370 MB resident.
 *
 * This is the full budget; {@link figureCacheByteBudget} is what a device is
 * held to.
 */
export const CACHE_BUDGET_MEGABYTES = 188;

/**
 * The ceiling this device's cache is held to: the full budget, scaled down
 * only on a device that bakes its cells at half density (see
 * `memoryBudgetScale`). Read live, since that density follows the
 * display's pixel ratio, which zoom or a move to another monitor changes.
 */
export function figureCacheByteBudget(): number {
  return CACHE_BUDGET_MEGABYTES * memoryBudgetScale() * BYTES_PER_MEGABYTE;
}

/**
 * Default ceiling on one figure's cells.
 *
 * Sized from a boss-shaped figure, the shelved Iron Iggy: he declares 182 cells of 176×176, which is 21.5 MB with every row of
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
 * Not scaled for the device as {@link figureCacheByteBudget} is: on a device
 * that bakes at half density a figure's rows take a quarter of the bytes, so
 * the same ceiling only leaves it more of its own rows, and the global ceiling
 * still bounds the whole cache.
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
 * borrows a neighbouring baked frame in the meantime.
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
 * How long bakes stay off after the browser refuses one a surface. Canvas
 * memory comes back only as caches give theirs up, so a bake tried on every
 * frame would fail on every frame, each attempt paying for an allocation and a
 * paint first; bodies draw directly in the meantime.
 */
const BAKE_ALLOCATION_RETRY_MS = 2000;

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

/** Scratch nesting levels a bake paints on: one for a whole cell, a back and a front for a layered one. */
const WHOLE_BAKE_SCRATCH_LEVELS = 1;
const LAYERED_BAKE_SCRATCH_LEVELS = 2;

/** Tile-relative mirror axis, matching `drawSprite`'s flip. */
export const TILE_CENTER_OFFSET = 0.5;

/** Default alpha for full opacity, matching `drawSprite`. */
const DEFAULT_ALPHA = 1;

const RGBA_STRIDE = 4;
const ALPHA_CHANNEL_OFFSET = 3;
/** Half of a pixel, so a bounding box spans whole pixels rather than their corners. */
const HALF_PIXEL = 0.5;

/**
 * A layered frame's front layer: the part of the figure in front of whatever
 * it holds, cropped to its ink, and where the crop sits in the cell, in the
 * cell's baked pixels.
 */
interface FrontLayerCell {
  readonly surface: CanvasSurface;
  readonly x: number;
  readonly y: number;
}

/** One animation row's baked cells, keyed by frame index. */
interface FigureRow {
  cells: Map<number, CanvasSurface>;
  /** The front layers of the row's layered frames, keyed by frame index. */
  fronts: Map<number, FrontLayerCell>;
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
  /** Destination units per baked cell pixel. */
  readonly densityRatio: number;
  readonly front: FrontLayerCell | null;
}

/**
 * Where a cell landed on the destination: its top-left and how many
 * destination units one of the figure's declared cell pixels covers.
 */
export interface FigureCellPlacement {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/**
 * Draws a held item between a layered cell's two layers, in the destination's
 * space as the cell was placed in it — inside the cell's own mirroring, so an
 * item placed at an unmirrored socket mirrors with the figure.
 */
export type FigureBetween = (ctx: CanvasRenderingContext2D, place: FigureCellPlacement) => void;

/** Insertion-ordered by last use, so the first entry is the coldest figure. */
const entries = new Map<FigureId, FigureEntry>();

// ── Cell identity, for caches built from a blitted cell ─────────────────────

/** One cell as {@link drawFigureCached} blitted it. */
export interface FigureCellBlit {
  /** The baked cell itself: the same object for as long as the cell is held. */
  readonly surface: CanvasSurface;
  readonly destX: number;
  readonly destY: number;
  readonly destWidth: number;
  readonly destHeight: number;
  /** The destination's transform at the blit, mirroring included. */
  readonly transform: DOMMatrix;
  /**
   * Blitted alone and unaltered: nothing drawn between its layers, at full
   * opacity, plain source-over and no filter. Only then is the cell's own
   * alpha exactly what landed.
   */
  readonly plain: boolean;
}

/** What one recording has seen: how many figure draws, and the last cell blitted. */
interface CellBlitRecord {
  draws: number;
  blit: FigureCellBlit | null;
}

let cellBlitRecord: CellBlitRecord | null = null;
const cellDropListeners: Array<(cell: CanvasSurface) => void> = [];

/**
 * Starts recording the figure draws made until {@link takeRecordedFigureCell}:
 * a caller that wants to know whether something it drew was exactly one
 * cached cell, and which.
 */
export function recordFigureCellBlits(): void {
  cellBlitRecord = { draws: 0, blit: null };
}

/**
 * Stops recording, and returns the cell when exactly one figure draw was made
 * since {@link recordFigureCellBlits} and it was a blit of a cached cell;
 * null for none, several, or a frame painted directly rather than blitted.
 */
export function takeRecordedFigureCell(): FigureCellBlit | null {
  const record = cellBlitRecord;
  cellBlitRecord = null;
  if (record?.draws !== 1) return null;
  return record.blit;
}

/**
 * Calls `listener` with every cell surface the cache lets go of — a row swept,
 * evicted or released, or the whole cache flushed — so a cache keyed by cell
 * can drop what it built from one. A cell is never repainted in place, so a
 * surface still held is still the picture it was.
 */
export function onFigureCellDropped(listener: (cell: CanvasSurface) => void): void {
  cellDropListeners.push(listener);
}

/** How a cell that was not baked reached the screen: painted live, or as a nearby baked cell. */
export type UnbakedDraw = 'live' | 'standIn';

const unbakedDrawListeners: Array<(def: FigureDef, state: string, drawn: UnbakedDraw) => void> = [];

/**
 * Hears every cell drawn without its own baked cell — painted straight into
 * the frame, or stood in for by another — with the figure and row it belongs
 * to: for a harness counting whose cells went unbaked on screen, which the
 * stats' totals cannot say.
 */
export function onFigureUnbakedDraw(
  listener: (def: FigureDef, state: string, drawn: UnbakedDraw) => void,
): void {
  unbakedDrawListeners.push(listener);
}

function noteUnbakedDraw(def: FigureDef, state: string, drawn: UnbakedDraw): void {
  for (const listener of unbakedDrawListeners) listener(def, state, drawn);
}

function noteDirectPaint(def: FigureDef, state: string): void {
  recordFigureCacheDirectDraw(directPaintCause);
  perfMonitor.count('figureDirectPaints', 1);
  noteUnbakedDraw(def, state, 'live');
}

/**
 * Cell and front-layer surfaces the cache has let go of this frame, given back
 * when the next frame begins rather than on the spot. A row can be dropped
 * while a draw is still holding one of its surfaces: a placed cell whose front
 * layer goes on after a held item that itself baked and evicted, a stand-in
 * picked from a cold row. A released surface is zero-sized and draws as
 * nothing, so it waits until no draw of the frame can still reach it.
 */
const surfacesAwaitingRelease: CanvasSurface[] = [];

function queueRowSurfacesForRelease(row: FigureRow): void {
  for (const cell of row.cells.values()) surfacesAwaitingRelease.push(cell);
  for (const front of row.fronts.values()) surfacesAwaitingRelease.push(front.surface);
}

function releaseDroppedSurfaces(): void {
  for (const surface of surfacesAwaitingRelease) releaseSurface(surface);
  surfacesAwaitingRelease.length = 0;
}

function notifyCellsDropped(row: FigureRow): void {
  if (cellDropListeners.length === 0) return;
  for (const cell of row.cells.values()) {
    for (const listener of cellDropListeners) listener(cell);
  }
}

function noteFigureDraw(): void {
  if (cellBlitRecord !== null) cellBlitRecord.draws++;
}

function noteCellBlit(
  ctx: CanvasRenderingContext2D,
  cell: PlacedCell,
  destX: number,
  destY: number,
  alone: boolean,
): void {
  const record = cellBlitRecord;
  if (record === null) return;
  record.blit = {
    surface: cell.surface,
    destX,
    destY,
    destWidth: cell.destWidth,
    destHeight: cell.destHeight,
    transform: ctx.getTransform(),
    plain:
      alone &&
      ctx.globalAlpha === 1 &&
      ctx.globalCompositeOperation === 'source-over' &&
      ctx.filter === 'none',
  };
}

/** What refused the last bake {@link bakeCell} gave up on. */
let lastBakeRefusal: FigureDirectDrawCause = 'frameAllowance';
/**
 * Why the cell about to be painted directly had no baked surface: set by the
 * lookup that came back empty, read by the direct paint that follows it.
 */
let directPaintCause: FigureDirectDrawCause = 'frameAllowance';

let cachedBytes = 0;
let cachedRows = 0;
let frameCounter = 0;
let msBakedThisFrame = 0;
/** No cell is baked before this wall-clock time; set when a bake was refused memory. */
let bakesRefusedUntilMs = 0;

/** Whether bakes are held off after the browser refused one a surface. */
function bakesHeldForMemory(): boolean {
  return performance.now() < bakesRefusedUntilMs;
}

function noteBakeRefusedMemory(): void {
  bakesRefusedUntilMs = performance.now() + BAKE_ALLOCATION_RETRY_MS;
  reportCanvasAllocationFailure();
}

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
  /** The cache frame it was last asked for — see {@link dropLapsedPrewarms}. */
  askedAtFrame: number;
  /**
   * The frame its bakes start from, wrapping round to the rest. A row drawn
   * cold is being played as it bakes, and a looping row's playhead is picked
   * by the clock rather than by what is warm: baked from its first frame, its
   * cells land behind the playhead and every frame it reaches is drawn cold.
   */
  bakeFrom: number;
}

/** Figure/state pairs asked for ahead of their first draw, in request order. */
const prewarmQueue: PrewarmRequest[] = [];

/** The cache frame each figure was last drawn on — see {@link dropLapsedPrewarms}. */
const lastDrawnFrameByFigure = new Map<FigureId, number>();

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
 * For a cast that may be drawn at any moment while the party is near it — a
 * town's strolling crowd — where the idle sweep's ten-second window is a false
 * signal: a look worn by only one or two of the crowd can go that long
 * between draws of its rarer facing and still be squarely part of the
 * working set, not a row that fell out of use. Pinning is metadata over
 * rows the cache already holds; it grants no admission of its own, so a
 * pin on a row nothing has baked yet does nothing until something bakes it.
 */
const pinnedRows = new Set<string>();

/**
 * Frames after the cache last had to drop a row, or refuse a bake, for want of
 * room overall during which its room counts as contested: the idle window,
 * because a row dropped for room within it was still part of something's
 * working set.
 */
const ROOM_CONTESTED_FRAMES = IDLE_FRAMES_BEFORE_RELEASE;
/** The frame the cache last ran short of room overall, or never. */
let lastRoomShortageFrame = Number.NEGATIVE_INFINITY;

function pinKey(figureId: FigureId, state: string): string {
  return `${figureId}|${state}`;
}

function bakeScaleNow(): number {
  return shouldDownscaleForLowEndDevice() ? LOW_END_BAKE_SCALE : FULL_BAKE_SCALE;
}

const performanceClock = (): number => performance.now();

/** The clock every bake cost and the frame's bake allowance are measured against. */
let bakeClock: () => number = performanceClock;

/**
 * Replaces the clock bake costs are measured with, or restores `performance.now`
 * given null.
 *
 * For gates: the allowance is wall-clock, so on a loaded machine a cell's
 * measured cost is whatever the scheduler made it, and a pacing claim checked
 * against real time passes or fails with the load rather than with the code. A
 * gate's synthetic painter advances its own clock by the cost it declares.
 */
export function setFigureBakeClock(clock: (() => number) | null): void {
  bakeClock = clock ?? performanceClock;
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
  releaseDroppedSurfaces();
  frameCounter++;
  msBakedThisFrame = 0;
  beginFigureCacheStatsFrame();
  if (!idleSweepHeld) releaseIdleRows();
  runPrewarmQueue();
}

/** Milliseconds spent baking figure cells since {@link beginFigureFrame}. */
export function figureBakeMsThisFrame(): number {
  return msBakedThisFrame;
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
  for (const pending of prewarmQueue) pending.askedAtFrame = frameCounter;
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
  notifyCellsDropped(row);
  queueRowSurfacesForRelease(row);
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
    // pinned it says so — a crowd near the party, kept warm while it may walk
    // into view rather than released and re-baked. Active eviction breaking
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
  lastRoomShortageFrame = frameCounter;
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
  const row: FigureRow = { cells: new Map(), fronts: new Map(), bytes: 0, lastFrame: frameCounter };
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
  return bytes <= figureByteBudgetFor(entry.def) && bytes <= figureCacheByteBudget();
}

function admitsGlobally(bytes: number): boolean {
  return residentBytes() + bytes <= figureCacheByteBudget();
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

interface SurfaceSize {
  readonly width: number;
  readonly height: number;
}

/** The size of the scratch surface a paint of this size leaves at a level now holding `current`. */
function fittedScratchSize(
  current: SurfaceSize | null,
  width: number,
  height: number,
): SurfaceSize {
  if (current === null) return { width, height };
  if (current.width >= width && current.height >= height) return current;
  const unionWidth = Math.max(width, current.width);
  const unionHeight = Math.max(height, current.height);
  if (unionWidth * unionHeight <= width * height * SCRATCH_UNION_AREA_SLACK) {
    return { width: unionWidth, height: unionHeight };
  }
  return { width, height };
}

function fittedScratch(
  current: CanvasSurface | null,
  width: number,
  height: number,
): CanvasSurface {
  const fitted = fittedScratchSize(current, width, height);
  if (current !== null && fitted === current) return current;
  return allocCanvas('figureScratch', fitted.width, fitted.height);
}

/**
 * Bytes the scratch surfaces would grow by if the next `levels` nesting levels
 * each held a paint of this size.
 */
function scratchGrowthBytes(levels: number, width: number, height: number): number {
  let growth = 0;
  for (let level = scratchDepth; level < scratchDepth + levels; level++) {
    const current = scratchStack[level] ?? null;
    const fitted = fittedScratchSize(current, width, height);
    const currentBytes = current === null ? 0 : surfaceBytes(current);
    growth += fitted.width * fitted.height * BYTES_PER_PIXEL - currentBytes;
  }
  return growth;
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
    if (current !== null) {
      scratchBytes -= surfaceBytes(current);
      releaseSurface(current);
    }
    scratchBytes += surfaceBytes(surface);
    scratchStack[level] = surface;
    publishOccupancy();
  }
  let ctx: CanvasRenderingContext2D;
  try {
    ctx = surfaceContext(surface);
  } catch (error) {
    // Unwound here because no caller's `finally` is reached yet: the level
    // would otherwise stay claimed, and the surface that has no context with it.
    discardInnermostScratch();
    releaseScratch();
    throw error;
  }
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
  releaseSurface(poisoned);
  publishOccupancy();
}

function releaseScratchSurfaces(): void {
  // A level still claimed belongs to a paint under way, which goes on drawing
  // into its surface after the stack has forgotten it.
  scratchStack.forEach((surface, level) => {
    if (surface !== null && level >= scratchDepth) releaseSurface(surface);
  });
  scratchStack.length = 0;
  scratchBytes = 0;
  if (frontScratch !== null && scratchDepth === 0) releaseSurface(frontScratch);
  frontScratch = null;
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
  const layers = entry.def.heldLayers;
  const layered = layers?.layered(state, frame) === true;
  // A layered cell's front is cropped out of a cell-sized surface, so a cell
  // that may carry one is admitted with room for both.
  const reservedBytes = layered ? bytes * 2 : bytes;
  // The supersampled scratch the paint borrows counts against the whole
  // cache's ceiling, and growing it for this cell is a cost of this bake.
  const supersample = figureBakeDensity(entry.def);
  const scratchLevels = layered ? LAYERED_BAKE_SCRATCH_LEVELS : WHOLE_BAKE_SCRATCH_LEVELS;
  const globallyReservedBytes =
    reservedBytes +
    scratchGrowthBytes(
      scratchLevels,
      entry.cellPixelWidth * supersample,
      entry.cellPixelHeight * supersample,
    );
  // No eviction can free room for a cell that does not fit an empty cache, and
  // sweeping for one only destroys rows that were serving somebody.
  if (!cellCanEverFit(entry)) {
    lastBakeRefusal = 'tooLarge';
    return null;
  }
  if (bakesHeldForMemory()) {
    lastBakeRefusal = 'memoryHeld';
    return null;
  }
  if (!admitsForFigure(entry, reservedBytes)) {
    evictStaleForFigureBytes(entry, reservedBytes, eviction.figureCeilingMinIdleFrames);
    if (!admitsForFigure(entry, reservedBytes)) {
      lastBakeRefusal = 'figureBudget';
      return null;
    }
  }
  if (!admitsGlobally(globallyReservedBytes)) {
    evictStaleForGlobalBytes(globallyReservedBytes, eviction.globalCeilingMinIdleFrames);
    if (!admitsGlobally(globallyReservedBytes)) {
      lastBakeRefusal = 'cacheBudget';
      return null;
    }
  }

  const perfStartedAt = perfMonitor.begin();
  const startedAt = bakeClock();
  const msBakedBefore = msBakedThisFrame;
  let baked: BakedCell;
  try {
    baked = layered
      ? bakeLayeredCell(entry, layers, state, frame)
      : bakeWholeCell(entry, state, frame);
  } catch (error) {
    if (!(error instanceof CanvasContextUnavailableError)) throw error;
    noteBakeRefusedMemory();
    lastBakeRefusal = 'memoryHeld';
    perfMonitor.end('figureBake', perfStartedAt);
    return null;
  }
  const { cell, front } = baked;
  const frontBytes = front === null ? 0 : surfaceBytes(front.surface);
  row.cells.set(frame, cell);
  if (front !== null) row.fronts.set(frame, front);
  row.bytes += bytes + frontBytes;
  entry.bytes += bytes + frontBytes;
  cachedBytes += bytes + frontBytes;
  const paintedMs = bakeClock() - startedAt;
  // The figure's cost estimate is the paint alone; a sweep's drop listeners
  // would skew it, though the frame still pays for both below.
  recordBakeCost(entry, paintedMs);
  recordFigureCacheBakeMs(paintedMs);
  // A painter that composes another figure bakes or paints it on deeper scratch
  // levels this cell's admission did not size, and that nested figure's own
  // cells are admitted before this cell's bytes are counted. Either can carry a
  // cache admitted right up to its ceiling past it.
  // The clock is read again only when that sweep runs. A bake that swept nothing
  // has cost the frame its paint alone, and a clock that advances on every read
  // (`setFigureBakeClock`) would otherwise charge each bake a second interval,
  // enough to push it past the prewarm allowance into a frame of repaid debt.
  const overCeilingAfterBake = !admitsGlobally(0);
  if (overCeilingAfterBake) evictStaleForGlobalBytes(0, eviction.globalCeilingMinIdleFrames);
  const elapsedMs = overCeilingAfterBake ? bakeClock() - startedAt : paintedMs;
  // Assigned rather than accumulated: a painter that composed another figure
  // has already charged its nested bakes to this frame, and the elapsed time
  // measured here contains them.
  msBakedThisFrame = msBakedBefore + elapsedMs;
  perfMonitor.end('figureBake', perfStartedAt);
  perfMonitor.count('figureBakes', 1);
  publishOccupancy();
  return cell;
}

/** A front-layer pixel whose alpha is at or under this holds no ink, and the crop leaves it out. */
const FRONT_INK_ALPHA_FLOOR = 0;

/** The ink box of a surface's alpha, in its own pixels, or null for no ink at all. */
function alphaInkBox(
  surface: CanvasSurface,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } | null {
  const data = surfaceContext(surface).getImageData(0, 0, width, height).data;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * RGBA_STRIDE + ALPHA_CHANNEL_OFFSET] <= FRONT_INK_ALPHA_FLOOR)
        continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

let frontScratch: CanvasSurface | null = null;

/**
 * The cell-sized surface a front layer is read back from. Readable, because
 * its ink box is measured; kept across bakes, because a fight bakes dozens.
 */
function frontScratchOf(width: number, height: number): CanvasSurface {
  if (frontScratch === null || frontScratch.width < width || frontScratch.height < height) {
    if (frontScratch !== null) releaseSurface(frontScratch);
    frontScratch = allocReadableCanvas('figureScratch', width, height);
  }
  const ctx = surfaceContext(frontScratch);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, frontScratch.width, frontScratch.height);
  return frontScratch;
}

interface BakedCell {
  readonly cell: CanvasSurface;
  readonly front: FrontLayerCell | null;
}

/** Paints one ordinary frame into a cell of its own: supersampled, then downsampled into place. */
function bakeWholeCell(entry: FigureEntry, state: string, frame: number): BakedCell {
  const supersample = figureBakeDensity(entry.def);
  const superWidth = entry.cellPixelWidth * supersample;
  const superHeight = entry.cellPixelHeight * supersample;
  const cell = cellSurface(entry);
  let surface: CanvasSurface;
  try {
    surface = acquireScratch(superWidth, superHeight);
  } catch (error) {
    releaseSurface(cell);
    throw error;
  }
  try {
    paintInto(surfaceContext(surface), entry.def, state, frame, entry.bakeScale * supersample);
    downsampleInto(cell, surface, entry);
  } catch (error) {
    discardInnermostScratch();
    releaseSurface(cell);
    throw error;
  } finally {
    releaseScratch();
  }
  return { cell, front: null };
}

function downsampleInto(target: CanvasSurface, source: CanvasSurface, entry: FigureEntry): void {
  const supersample = figureBakeDensity(entry.def);
  surfaceContext(target).drawImage(
    source,
    0,
    0,
    entry.cellPixelWidth * supersample,
    entry.cellPixelHeight * supersample,
    0,
    0,
    entry.cellPixelWidth,
    entry.cellPixelHeight,
  );
}

/**
 * Paints a layered frame in its one pass and keeps both halves: the whole
 * figure as the cell, and the part in front of the held thing cropped to its
 * ink.
 */
function bakeLayeredCell(
  entry: FigureEntry,
  layers: NonNullable<FigureDef['heldLayers']>,
  state: string,
  frame: number,
): BakedCell {
  const supersample = figureBakeDensity(entry.def);
  const superWidth = entry.cellPixelWidth * supersample;
  const superHeight = entry.cellPixelHeight * supersample;
  const cell = cellSurface(entry);
  let back: CanvasSurface;
  try {
    back = acquireScratch(superWidth, superHeight);
  } catch (error) {
    releaseSurface(cell);
    throw error;
  }
  try {
    const front = acquireScratch(superWidth, superHeight);
    try {
      const density = entry.bakeScale * supersample;
      paintLayersInto(surfaceContext(back), surfaceContext(front), layers, state, frame, density);
      downsampleInto(cell, back, entry);
      const readable = frontScratchOf(entry.cellPixelWidth, entry.cellPixelHeight);
      downsampleInto(readable, front, entry);
      return { cell, front: croppedFront(readable, entry) };
    } catch (error) {
      discardInnermostScratch();
      throw error;
    } finally {
      releaseScratch();
    }
  } catch (error) {
    discardInnermostScratch();
    releaseSurface(cell);
    throw error;
  } finally {
    releaseScratch();
  }
}

/**
 * A surface for a new cell, its context taken before anything is painted: a
 * browser out of canvas memory refuses here, before the pooled scratch is
 * touched, so a refusal costs no paint and leaves the scratch for the body
 * drawn directly in the cell's place.
 */
function cellSurface(entry: FigureEntry): CanvasSurface {
  const cell = allocCanvas('figureCells', entry.cellPixelWidth, entry.cellPixelHeight);
  freshSurfaceContext(cell);
  return cell;
}

/** Runs a figure's two-layer painter at `density`, popping the density however it ends. */
function paintLayersInto(
  back: CanvasRenderingContext2D,
  front: CanvasRenderingContext2D,
  layers: NonNullable<FigureDef['heldLayers']>,
  state: string,
  frame: number,
  density: number,
): void {
  back.save();
  front.save();
  try {
    back.scale(density, density);
    front.scale(density, density);
    layers.paintLayers(back, front, state, frame);
  } finally {
    back.restore();
    front.restore();
  }
}

/** The ink of a cell-sized front layer on its own surface, or null when it has none. */
function croppedFront(readable: CanvasSurface, entry: FigureEntry): FrontLayerCell | null {
  const box = alphaInkBox(readable, entry.cellPixelWidth, entry.cellPixelHeight);
  if (box === null) return null;
  const crop = allocCanvas('figureCells', box.width, box.height);
  surfaceContext(crop).drawImage(
    readable,
    box.left,
    box.top,
    box.width,
    box.height,
    0,
    0,
    box.width,
    box.height,
  );
  return { surface: crop, x: box.left, y: box.top };
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
 * `urgent` puts the request ahead of every speculative one, behind the
 * urgent ones asked for before it — for a row about to be drawn this frame or
 * the next, not merely warmed ahead of an eventual use, where waiting behind
 * whatever speculative backlog already queued (a player's own figure warming rows for a fight
 * that has not started, say) would mean the thing on screen right now stays
 * an approximation for however long that backlog takes to drain.
 */
export function prewarmFigureState(
  def: FigureDef,
  state: string,
  frameLimit?: number,
  urgent = false,
): void {
  queuePrewarm(def, state, frameLimit, urgent, FIRST_FRAME);
}

/** The first frame of every row, where a bake starts unless it is chasing a playhead. */
const FIRST_FRAME = 0;

/** Asks for a row a draw has just found cold, its bakes starting at the frame drawn. */
function prewarmDrawnRow(def: FigureDef, state: string, drawnFrame: number): void {
  queuePrewarm(def, state, undefined, true, drawnFrame);
}

function queuePrewarm(
  def: FigureDef,
  state: string,
  frameLimit: number | undefined,
  urgent: boolean,
  bakeFrom: number,
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
    queued.askedAtFrame = frameCounter;
    if (bakeFrom !== FIRST_FRAME) queued.bakeFrom = bakeFrom;
    // Already-queued work moves ahead the same way newly-queued work does — a
    // row already waiting behind a large speculative backlog is exactly the
    // row `urgent` exists to rescue. A row already among the urgent ones
    // keeps its place, so a caller re-asking every tick cannot push a row
    // drawn cold since then back behind it.
    if (urgent && queuedIndex > urgentQueueLength()) {
      prewarmQueue.splice(queuedIndex, 1);
      prewarmQueue.splice(urgentQueueLength(), 0, queued);
    }
    if (urgent) queued.urgent = true;
    return;
  }
  const request: PrewarmRequest = {
    def,
    state,
    frames,
    capacityRefusals: 0,
    urgent,
    askedAtFrame: frameCounter,
    bakeFrom,
  };
  if (urgent) prewarmQueue.splice(urgentQueueLength(), 0, request);
  else prewarmQueue.push(request);
}

function removeQueued(pending: PrewarmRequest): void {
  const index = prewarmQueue.indexOf(pending);
  if (index !== -1) prewarmQueue.splice(index, 1);
}

/**
 * How many requests at the front of the queue are urgent: where the next
 * urgent one goes, behind those asked for before it and ahead of every
 * speculative one.
 */
function urgentQueueLength(): number {
  const firstSpeculative = prewarmQueue.findIndex((pending) => !pending.urgent);
  return firstSpeculative === -1 ? prewarmQueue.length : firstSpeculative;
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
  lastDrawnFrameByFigure.set(def.id, frameCounter);
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
 * Whether the cache has run short of room overall lately: something drawn
 * needed more than it had, so a row baked now for anything not drawn would
 * only be dropped again.
 */
export function figureCacheRoomContested(): boolean {
  return frameCounter - lastRoomShortageFrame < ROOM_CONTESTED_FRAMES;
}

/**
 * Whether every cell of a row is baked at this device's density. Touches
 * nothing: asking does not make the row look drawn.
 */
export function isFigureStateWarm(def: FigureDef, state: string): boolean {
  const entry = entries.get(def.id);
  if (entry?.bakeScale !== bakeScaleNow()) return false;
  const cells = entry.rows.get(state)?.cells;
  if (cells === undefined) return false;
  return cells.size >= figureFrameCount(def, state);
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

/** What the prewarm queue may spend on the next frame, boosted or not. For gates and dev readouts. */
export function figurePrewarmBudgetMs(): number {
  return effectivePrewarmBudgetMs();
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

/**
 * Lets go of speculative requests for a figure nothing has drawn, and nothing
 * has asked for the row again, within {@link IDLE_FRAMES_BEFORE_RELEASE}.
 *
 * A row baked for a figure that is off screen is swept unused once the idle
 * window passes, so a figure that queued its whole working set and was then
 * never drawn — a crawler built for a scene that does not show him — would
 * otherwise bake that set cell by cell, each cell a frame's overspend repaid
 * out of the frames after it, only for the sweep to throw each away. A figure
 * that is being drawn keeps every request however long its backlog takes,
 * because its speculation is about a use that can come at any moment; and
 * whatever still wants a row of an undrawn figure re-asks it well inside the
 * window, as every stand-by refresh does.
 */
function dropLapsedPrewarms(): void {
  for (let i = prewarmQueue.length - 1; i >= 0; i--) {
    const pending = prewarmQueue[i];
    if (pending.urgent) continue;
    const unaskedTooLong = frameCounter - pending.askedAtFrame > IDLE_FRAMES_BEFORE_RELEASE;
    const drawnAt = lastDrawnFrameByFigure.get(pending.def.id);
    const undrawnTooLong =
      drawnAt === undefined || frameCounter - drawnAt > IDLE_FRAMES_BEFORE_RELEASE;
    if (unaskedTooLong && undrawnTooLong) prewarmQueue.splice(i, 1);
  }
}

function runPrewarmQueue(): void {
  if (!idleSweepHeld) dropLapsedPrewarms();
  // Not drained into refusals: each would count against its request's retries
  // and give up on rows for want of memory that may be back in a moment.
  if (bakesHeldForMemory()) return;
  const budgetMs = effectivePrewarmBudgetMs();
  if (boostedPrewarmFramesRemaining > 0) boostedPrewarmFramesRemaining--;
  if (prewarmDebtMs > 0) {
    prewarmDebtMs = Math.max(0, prewarmDebtMs - budgetMs);
    return;
  }
  try {
    // An urgent row is a figure on screen being painted live every frame
    // until it lands, the dearest thing this budget can leave undone. An
    // unmeasured overhead marker only sits at the top of its figure's cell
    // meanwhile, so it goes next, and a pose that may be wanted later last.
    // A town's crowd walking into view queues enough rows of ink to take the
    // whole budget for tens of seconds, so ink first would leave every figure
    // that missed in that time painted live.
    const refusedThisFrame = new Set<PrewarmRequest>();
    drainPrewarmQueue(budgetMs, 'urgent', refusedThisFrame);
    measureQueuedRowInk(budgetMs);
    drainPrewarmQueue(budgetMs, 'all', refusedThisFrame);
  } finally {
    // Whatever this frame's prewarming ran over by is owed back, however it
    // ended — a painter that threw has still spent the time.
    prewarmDebtMs += Math.max(0, msBakedThisFrame - budgetMs);
  }
}

/** Which requests one pass of {@link drainPrewarmQueue} may bake. */
type PrewarmDrainScope = 'urgent' | 'all';

/**
 * Bakes from the front of the queue until the allowance is spent, taking
 * only urgent requests when `scope` says so.
 *
 * A row refused for want of room is passed over for the rest of the frame
 * and the drain carries on with the next one: whatever refused that row says
 * nothing about a smaller figure behind it. The drain stops once every row
 * still queued has been refused this frame. `refusedThisFrame` is shared by
 * every pass of one frame, so a row refused in one is not charged a second
 * retry by the next.
 */
function drainPrewarmQueue(
  budgetMs: number,
  scope: PrewarmDrainScope,
  refusedThisFrame: Set<PrewarmRequest>,
): void {
  const inScope = (queued: PrewarmRequest): boolean =>
    !refusedThisFrame.has(queued) && (scope === 'all' || queued.urgent);
  while (prewarmQueue.length > 0 && msBakedThisFrame < budgetMs) {
    const pending = prewarmQueue.find(inScope);
    if (pending === undefined) return;
    const entry = entryFor(pending.def);
    if (!fitsPrewarmAllowance(entry, pending, budgetMs)) return;
    const row = rowFor(entry, pending.state);
    let baked = false;
    let refused = false;
    for (const frame of bakeOrder(pending)) {
      if (row.cells.has(frame)) continue;
      if (!fitsPrewarmAllowance(entry, pending, budgetMs)) return;
      if (bakeCell(entry, row, pending.state, frame, prewarmEviction(pending)) === null) {
        dropRowIfEmpty(entry, pending.state, row);
        // Refused for memory rather than for room: no request is at fault, and
        // charging each would give up on rows on screen within a few frames.
        if (bakesHeldForMemory()) return;
        deferRefusedPrewarm(pending);
        refusedThisFrame.add(pending);
        refused = true;
        break;
      }
      recordFigureCachePrewarmBake();
      baked = true;
      if (msBakedThisFrame >= budgetMs) return;
    }
    if (!baked && !refused) removeQueued(pending);
  }
}

/** The frames a request covers, in the order they are baked — see {@link PrewarmRequest.bakeFrom}. */
function bakeOrder(pending: PrewarmRequest): number[] {
  const start = pending.bakeFrom < pending.frames ? pending.bakeFrom : FIRST_FRAME;
  return Array.from({ length: pending.frames }, (_, offset) => (start + offset) % pending.frames);
}

/**
 * {@link fitsBakeAllowance} for the paced queue, except that a speculative
 * cell of a figure with no cost estimate yet may only open a frame, never
 * follow other baking in it. Its cost is unknown and may be many times the
 * allowance, and a speculative row has no draw waiting on it that would
 * justify stacking that unknown on top of what the frame has already spent.
 */
function fitsPrewarmAllowance(
  entry: FigureEntry,
  pending: PrewarmRequest,
  budgetMs: number,
): boolean {
  const unmeasuredFollower =
    !pending.urgent && msBakedThisFrame > 0 && estimatedBakeMs(entry) === null;
  if (unmeasuredFollower) return false;
  return fitsBakeAllowance(entry, msBakedThisFrame, budgetMs);
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
  if (bakesHeldForMemory()) return;
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
  // A refused row is passed over for the rest of the call, which ends once
  // every row still queued has been refused.
  const refusedThisCall = new Set<PrewarmRequest>();
  while (prewarmQueue.length > 0) {
    const pending = prewarmQueue.find((queued) => !refusedThisCall.has(queued));
    if (pending === undefined) return;
    const entry = entryFor(pending.def);
    const row = rowFor(entry, pending.state);
    let refused = false;
    for (const frame of bakeOrder(pending)) {
      if (row.cells.has(frame)) continue;
      const owedFirstCell = mustProgress && !startedAny;
      if (!owedFirstCell && !fitsCeiling(entry)) {
        dropRowIfEmpty(entry, pending.state, row);
        return;
      }
      startedAny = true;
      if (bakeCell(entry, row, pending.state, frame, prewarmEviction(pending)) === null) {
        dropRowIfEmpty(entry, pending.state, row);
        // Refused for memory rather than for room: no request is at fault, and
        // charging each would give up on rows on screen within a few frames.
        if (bakesHeldForMemory()) return;
        deferRefusedPrewarm(pending);
        refusedThisCall.add(pending);
        refused = true;
        break;
      }
      recordFigureCachePrewarmBake();
    }
    if (!refused) removeQueued(pending);
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
 * frames it went unwarmed cost it its place rather than its existence — the
 * end of the urgent ones for an urgent request, which is on screen and must
 * not wait behind speculation. Past
 * {@link PREWARM_CAPACITY_RETRIES} it is abandoned instead — see
 * {@link abandonedPrewarms}.
 */
function deferRefusedPrewarm(pending: PrewarmRequest): void {
  removeQueued(pending);
  pending.capacityRefusals += 1;
  if (pending.capacityRefusals < PREWARM_CAPACITY_RETRIES) {
    if (pending.urgent) prewarmQueue.splice(urgentQueueLength(), 0, pending);
    else prewarmQueue.push(pending);
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

/**
 * Forgets that the queue gave up on a row, so the next request for it is
 * taken. For a caller that has just made the room that was missing — a
 * loading screen, under which nothing else is drawn and every row out of use
 * may be evicted — where the give-up's reason no longer holds.
 */
export function forgiveFigurePrewarmGiveUp(def: FigureDef, state: string): void {
  abandonedPrewarms.delete(pinKey(def.id, state));
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

/** One resident figure's baked surfaces: its cells and its layered frames' front layers. */
interface ResidentFigureCells {
  readonly figureId: FigureId;
  readonly cells: readonly CanvasSurface[];
  /** What the cache's own bookkeeping charges the figure, to check a readout against. */
  readonly bytes: number;
}

/**
 * Every surface the cache holds for a figure right now, figure by figure,
 * pinned rows included. For dev readouts.
 */
export function residentFigureCells(): ResidentFigureCells[] {
  const resident: ResidentFigureCells[] = [];
  for (const [figureId, entry] of entries) {
    const cells: CanvasSurface[] = [];
    for (const row of entry.rows.values()) {
      cells.push(...row.cells.values());
      for (const front of row.fronts.values()) cells.push(front.surface);
    }
    resident.push({ figureId, cells, bytes: entry.bytes });
  }
  return resident;
}

/** Whether a row of one figure is waiting in the prewarm queue. For gates and dev readouts. */
export function isFigureStateQueued(def: FigureDef, state: string): boolean {
  return prewarmQueue.some((pending) => pending.def.id === def.id && pending.state === state);
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
 * Runs `draw` placed exactly as {@link drawFigureCached} places a cell of
 * `def` — the same mirroring about the tile — for something drawn with the
 * figure but not in its cell: a thing resting on him outside his outline.
 */
export function withFigureCellPlacement(
  ctx: CanvasRenderingContext2D,
  def: FigureDef,
  x: number,
  y: number,
  tileSize: number,
  opts: DrawSpriteOpts,
  draw: FigureBetween,
): void {
  const scale = tileSize / def.tileScale;
  withFigurePlacement(ctx, def, x, y, tileSize, scale, opts, (destX, destY) => {
    draw(ctx, { x: destX, y: destY, scale });
  });
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
  // Restored however `place` ends: a draw that throws must not leave every
  // later draw on this context mirrored or faded.
  try {
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
  } finally {
    if (needsSave) ctx.restore();
  }
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
  between?: FigureBetween,
): void {
  const layers = def.heldLayers;
  if (between !== undefined && layers?.layered(state, frame) === true) {
    directPaintLayered(ctx, def, layers, state, frame, destX, destY, scale, between);
    return;
  }
  noteDirectPaint(def, state);
  // A direct paint is the one path that pays a painter's full price every
  // frame it recurs, and nothing else asks for a row that is only ever missed
  // here: the frame's bake budget went to the prewarm queue, say, before the
  // render reached it. Asked for urgently, it is baked at the front of the
  // next frame's queue instead of being painted again, and again.
  prewarmDrawnRow(def, state, frame);
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
  between?.(ctx, { x: destX, y: destY, scale });
}

/** {@link directPaint} for a layered frame: both layers painted, the held item drawn between. */
function directPaintLayered(
  ctx: CanvasRenderingContext2D,
  def: FigureDef,
  layers: NonNullable<FigureDef['heldLayers']>,
  state: string,
  frame: number,
  destX: number,
  destY: number,
  scale: number,
  between: FigureBetween,
): void {
  noteDirectPaint(def, state);
  prewarmDrawnRow(def, state, frame);
  const width = Math.max(1, Math.ceil(def.frameWidth * scale));
  const height = Math.max(1, Math.ceil(def.frameHeight * scale));
  const back = acquireScratch(width, height);
  try {
    const front = acquireScratch(width, height);
    try {
      paintLayersInto(surfaceContext(back), surfaceContext(front), layers, state, frame, scale);
      ctx.drawImage(back, 0, 0, width, height, destX, destY, width, height);
      between(ctx, { x: destX, y: destY, scale });
      ctx.drawImage(front, 0, 0, width, height, destX, destY, width, height);
    } catch (error) {
      discardInnermostScratch();
      throw error;
    } finally {
      releaseScratch();
    }
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
 * The baked cell for this frame, a neighbouring one when the frame's bake
 * allowance is spent, or null when a budget refused it or there was nothing
 * of the figure to borrow. Null is the caller's cue to paint directly.
 */
function cellFor(def: FigureDef, state: string, frame: number, scale: number): PlacedCell | null {
  lastDrawnFrameByFigure.set(def.id, frameCounter);
  const entry = entryFor(def);
  const row = rowFor(entry, state);
  const cached = row.cells.get(frame);
  if (cached !== undefined) {
    recordFigureCacheHit();
    return placed(entry, cached, scale, row.fronts.get(frame) ?? null);
  }
  recordFigureCacheMiss();
  return bakeForDraw(entry, row, state, frame, scale);
}

/**
 * Bakes a missed cell on the render path, within what is left of the frame's
 * allowance. Past the allowance it borrows the nearest baked frame of the
 * figure while the exact row warms on the queue, and returns null — having
 * noted why — only when there is nothing to borrow or the cell can never be
 * baked, and the caller must paint directly.
 */
function bakeForDraw(
  entry: FigureEntry,
  row: FigureRow,
  state: string,
  frame: number,
  scale: number,
): PlacedCell | null {
  if (!fitsBakeAllowance(entry, msBakedThisFrame, FRAME_BAKE_BUDGET_MS)) {
    // A live paint costs what a bake would and is thrown away, so a crowd
    // missing more cells than one frame can bake would pay the painter for
    // every one of them, every frame, until the queue caught up. A frame of a
    // neighbouring pose costs one blit, and the urgent request lands the
    // exact row within a few frames.
    const standIn = nearestBakedCell(row, frame) ?? anyBakedCell(entry);
    dropRowIfEmpty(entry, state, row);
    if (standIn !== null) {
      recordFigureCacheApproxDraw();
      noteUnbakedDraw(entry.def, state, 'standIn');
      prewarmDrawnRow(entry.def, state, frame);
      return placed(entry, standIn, scale, null);
    }
    directPaintCause = 'frameAllowance';
    return null;
  }
  const baked = bakeCell(entry, row, state, frame, RENDER_EVICTION);
  if (baked === null) {
    directPaintCause = lastBakeRefusal;
    dropRowIfEmpty(entry, state, row);
    return null;
  }
  recordFigureCacheBake();
  return placed(entry, baked, scale, row.fronts.get(frame) ?? null);
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
 * the same figure. A caller that reaches this function has already decided a
 * slightly-wrong pose this frame costs less than a bake on the render path,
 * so it bakes only for a figure with nothing baked at all: there is no
 * stand-in to borrow, and the direct paint it would fall back to costs a
 * bake's paint on every frame until the queue reaches the row, where the bake
 * pays it once. Null when the frame's allowance or the budgets refuse that
 * bake too.
 */
function approxCellFor(
  def: FigureDef,
  state: string,
  frame: number,
  scale: number,
): PlacedCell | null {
  lastDrawnFrameByFigure.set(def.id, frameCounter);
  const entry = entries.get(def.id);
  if (entry?.bakeScale !== bakeScaleNow()) {
    recordFigureCacheMiss();
    requeuePinnedRowIfMissing(def, state);
    return bakeWithNothingToBorrow(def, state, frame, scale);
  }
  const row = entry.rows.get(state);
  const exact = row?.cells.get(frame);
  if (exact !== undefined) {
    recordFigureCacheHit();
    return placed(entry, exact, scale, row?.fronts.get(frame) ?? null);
  }
  recordFigureCacheMiss();
  const standIn = (row !== undefined ? nearestBakedCell(row, frame) : null) ?? anyBakedCell(entry);
  if (standIn === null) {
    requeuePinnedRowIfMissing(def, state);
    return bakeWithNothingToBorrow(def, state, frame, scale);
  }
  recordFigureCacheApproxDraw();
  noteUnbakedDraw(def, state, 'standIn');
  // The stand-in covers this frame; the exact row is now wanted on screen, not
  // on speculation, so it is asked for as such — a speculative request for it
  // may be waiting behind a full cache that only an urgent one can make room in.
  prewarmDrawnRow(def, state, frame);
  return placed(entry, standIn, scale, null);
}

/**
 * {@link bakeForDraw} for a figure {@link approxCellFor} found nothing of: the
 * entry is taken the way an exact draw takes it, rebuilt if it was baked at
 * another density.
 */
function bakeWithNothingToBorrow(
  def: FigureDef,
  state: string,
  frame: number,
  scale: number,
): PlacedCell | null {
  const entry = entryFor(def);
  return bakeForDraw(entry, rowFor(entry, state), state, frame, scale);
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
function placed(
  entry: FigureEntry,
  surface: CanvasSurface,
  scale: number,
  front: FrontLayerCell | null,
): PlacedCell {
  const densityRatio = scale / entry.bakeScale;
  return {
    surface,
    destWidth: entry.cellPixelWidth * densityRatio,
    destHeight: entry.cellPixelHeight * densityRatio,
    densityRatio,
    front,
  };
}

/** Blits a placed cell, and — around `between` — its front layer. */
function blitPlaced(
  ctx: CanvasRenderingContext2D,
  cell: PlacedCell,
  destX: number,
  destY: number,
  scale: number,
  between: FigureBetween | undefined,
): void {
  noteCellBlit(ctx, cell, destX, destY, between === undefined);
  ctx.drawImage(cell.surface, destX, destY, cell.destWidth, cell.destHeight);
  if (between === undefined) return;
  between(ctx, { x: destX, y: destY, scale });
  const front = cell.front;
  if (front === null) return;
  ctx.drawImage(
    front.surface,
    destX + front.x * cell.densityRatio,
    destY + front.y * cell.densityRatio,
    front.surface.width * cell.densityRatio,
    front.surface.height * cell.densityRatio,
  );
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
  between?: FigureBetween,
): void {
  noteFigureDraw();
  if (figureFrameCount(def, state) === 0) {
    warnMissingState(def, state);
    return;
  }
  const clamped = clampFrame(def, state, frame);
  const scale = tileSize / def.tileScale;
  const cell = cellFor(def, state, clamped, scale);
  withFigurePlacement(ctx, def, x, y, tileSize, scale, opts, (destX, destY) => {
    recordInkTop(ctx, def, state, destX, destY, scale);
    if (cell === null) {
      directPaint(ctx, def, state, clamped, destX, destY, scale, between);
      return;
    }
    blitPlaced(ctx, cell, destX, destY, scale, between);
  });
}

/**
 * {@link drawFigureCached}'s contract, but a miss draws the nearest
 * already-baked frame of the same row, or any already-baked row of the same
 * figure, instead of paying for the exact one on the render path.
 *
 * For a crowd of many near-identical figures sharing one prewarm queue,
 * where the exact frame not being warm yet is a beat of the wrong pose for
 * one figure in a crowd — invisible at a glance, and gone once the row this
 * frame actually wanted finishes warming on the paced queue — rather than a
 * bake the render path pays for on the spot. Only a figure with nothing
 * baked at all yet, the one case a stand-in cannot help with, is baked as
 * {@link drawFigureCached} would bake it, and painted directly if that bake
 * is refused.
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
  noteFigureDraw();
  if (figureFrameCount(def, state) === 0) {
    warnMissingState(def, state);
    return;
  }
  const clamped = clampFrame(def, state, frame);
  const scale = tileSize / def.tileScale;
  const cell = approxCellFor(def, state, clamped, scale);
  withFigurePlacement(ctx, def, x, y, tileSize, scale, opts, (destX, destY) => {
    recordInkTop(ctx, def, state, destX, destY, scale);
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
  noteFigureDraw();
  if (figureFrameCount(def, state) === 0) {
    warnMissingState(def, state);
    return;
  }
  const clamped = clampFrame(def, state, frame);
  const ink = figureInkBounds(def, state, clamped);
  const scale = tileSize / def.tileScale;
  const cell = cellFor(def, state, clamped, scale);

  ctx.save();
  try {
    if (alpha !== DEFAULT_ALPHA) ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.rotate(angle);
    const destX = -ink.centerX * scale;
    const destY = -ink.centerY * scale;
    if (cell === null) directPaint(ctx, def, state, clamped, destX, destY, scale);
    else ctx.drawImage(cell.surface, destX, destY, cell.destWidth, cell.destHeight);
  } finally {
    ctx.restore();
  }
}

/** {@link FrameInkBounds} plus the ink's full bounding box, in declared cell pixels. */
interface FigureInkBounds extends FrameInkBounds {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

const inkBoundsByFrame = new Map<string, FigureInkBounds>();

/**
 * Where a frame's ink actually sits inside its cell, in declared cell pixels.
 *
 * Measured off a one-off unsupersampled paint rather than off a cached cell:
 * the answer has to exist whether or not the cache admitted that frame, and a
 * bounding box is not a thing supersampling moves.
 */
function figureInkBounds(def: FigureDef, state: string, frame: number): FigureInkBounds {
  const key = `${def.id}|${state}|${frame}`;
  const cached = inkBoundsByFrame.get(key);
  if (cached !== undefined) return cached;
  const measured = measureFigureInk(def, state, frame);
  inkBoundsByFrame.set(key, measured);
  return measured;
}

/**
 * Draws one frame as an icon: scaled so its painted pixels fill as much of
 * the box as they can without leaving it, and centred on them.
 *
 * Sizing by tile would not do: a cell is sized for the figure's widest pose
 * and a large creature's art reaches well past its tile, so a tile-sized draw
 * spills out of whatever button holds it.
 */
export function drawFigureFitted(
  ctx: CanvasRenderingContext2D,
  def: FigureDef,
  state: string,
  frame: number,
  box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): void {
  noteFigureDraw();
  if (figureFrameCount(def, state) === 0) {
    warnMissingState(def, state);
    return;
  }
  const clamped = clampFrame(def, state, frame);
  const ink = figureInkBounds(def, state, clamped);
  const inkWidth = ink.right - ink.left;
  const inkHeight = ink.bottom - ink.top;
  if (inkWidth <= 0 || inkHeight <= 0) return;
  const scale = Math.min(box.w / inkWidth, box.h / inkHeight);
  const inkMidX = ink.left + inkWidth / 2;
  const inkMidY = ink.top + inkHeight / 2;
  const destX = box.x + box.w / 2 - inkMidX * scale;
  const destY = box.y + box.h / 2 - inkMidY * scale;
  const cell = cellFor(def, state, clamped, scale);
  if (cell === null) directPaint(ctx, def, state, clamped, destX, destY, scale);
  else blitPlaced(ctx, cell, destX, destY, scale, undefined);
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
  return sy - (row.def.tileY - rowInkTopCellPx(row)) * scale;
}

/** In declared cell pixels; 0, the cell's top, until the row has been measured. */
function rowInkTopCellPx(row: DrawnFigureRow): number {
  const measured = rowInkTopByRow.get(row);
  if (measured !== undefined) return measured;
  if (!queuedRowInk.has(row)) {
    queuedRowInk.add(row);
    rowInkQueue.push({ row, nextFrame: 0, topCellPx: row.def.frameHeight });
  }
  return 0;
}

interface InkTopCapture {
  readonly ctx: CanvasRenderingContext2D;
  readonly toCallerSpace: DOMMatrix;
  topY: number | null;
}

/** A stack, so a nested measurement also counts toward the outer one. */
const inkTopCaptures: InkTopCapture[] = [];

/**
 * Runs `paint` and returns the highest whole-row ink y of every figure it drew
 * on `ctx`, in `ctx`'s current space, or `null` when it drew none.
 */
export function measureFiguresInkTop(
  ctx: CanvasRenderingContext2D,
  paint: () => void,
): number | null {
  const capture: InkTopCapture = {
    ctx,
    toCallerSpace: ctx.getTransform().invertSelf(),
    topY: null,
  };
  inkTopCaptures.push(capture);
  try {
    paint();
  } finally {
    inkTopCaptures.pop();
  }
  return capture.topY;
}

/** Both top corners go through the transform: a mirror or rotation can lift either one. */
function recordInkTop(
  ctx: CanvasRenderingContext2D,
  def: FigureDef,
  state: string,
  destX: number,
  destY: number,
  scale: number,
): void {
  if (inkTopCaptures.length === 0) return;
  const inkTopY = destY + rowInkTopCellPx(drawnFigureRow(def, state)) * scale;
  const rightX = destX + def.frameWidth * scale;
  const placement = ctx.getTransform();
  for (const capture of inkTopCaptures) {
    if (capture.ctx !== ctx) continue;
    const toCaller = capture.toCallerSpace.multiply(placement);
    const leftTopY = toCaller.b * destX + toCaller.d * inkTopY + toCaller.f;
    const rightTopY = toCaller.b * rightX + toCaller.d * inkTopY + toCaller.f;
    const placedTopY = Math.min(leftTopY, rightTopY);
    capture.topY = Math.min(capture.topY ?? placedTopY, placedTopY);
  }
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
    const startedAt = bakeClock();
    const bounds = figureInkBounds(def, state, pending.nextFrame);
    msBakedThisFrame += bakeClock() - startedAt;
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
/**
 * Ink measurements under way. A painter that measures another figure while
 * its own measurement is painting can outgrow the shared surface, and the
 * outer measurement still reads back the one it started on.
 */
let inkMeasureDepth = 0;

function inkScratchFitting(width: number, height: number): CanvasSurface {
  if (inkScratch !== null && inkScratch.width >= width && inkScratch.height >= height) {
    return inkScratch;
  }
  const grownWidth = Math.max(width, inkScratch?.width ?? 0);
  const grownHeight = Math.max(height, inkScratch?.height ?? 0);
  if (inkScratch !== null && inkMeasureDepth === 0) releaseSurface(inkScratch);
  inkScratch = allocReadableCanvas('figureScratch', grownWidth, grownHeight);
  return inkScratch;
}

function measureFigureInk(def: FigureDef, state: string, frame: number): FigureInkBounds {
  const wholeCell: FigureInkBounds = {
    centerX: def.frameWidth / 2,
    centerY: def.frameHeight / 2,
    radius: Math.hypot(def.frameWidth, def.frameHeight) / 2,
    top: 0,
    left: 0,
    right: def.frameWidth,
    bottom: def.frameHeight,
  };

  const width = Math.ceil(def.frameWidth);
  const height = Math.ceil(def.frameHeight);
  const measuring = inkScratchFitting(width, height);
  const ctx = surfaceContext(measuring);
  ctx.clearRect(0, 0, width, height);
  inkMeasureDepth++;
  try {
    paintInto(ctx, def, state, frame, 1);
  } catch (error) {
    // A painter that threw past its own save leaves the context's state stack
    // unbalanced; the surface is dropped rather than handed to the next frame.
    if (inkScratch === measuring) inkScratch = null;
    if (inkMeasureDepth === 1) releaseSurface(measuring);
    throw error;
  } finally {
    inkMeasureDepth--;
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
  return {
    centerX,
    centerY,
    radius: Math.sqrt(radiusSq),
    top: minY,
    left: minX,
    right: maxX + 1,
    bottom: maxY + 1,
  };
}

let flushCount = 0;

/**
 * How many times {@link flushFigureFrameCache} has run. A caller pacing its
 * own re-asks compares it to see that everything it asked for is gone.
 */
export function figureCacheFlushCount(): number {
  return flushCount;
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
  flushCount++;
  for (const entry of entries.values()) {
    for (const row of entry.rows.values()) {
      notifyCellsDropped(row);
      queueRowSurfacesForRelease(row);
    }
  }
  entries.clear();
  prewarmQueue.length = 0;
  lastDrawnFrameByFigure.clear();
  abandonedPrewarms.clear();
  // Pins outlive the flush: a canvas recovery or a render-scale change
  // flushes cells while whoever pinned them still holds them, and re-bakes
  // them pinned. Each owner unpins its own rows when it lets them go.
  lastRoomShortageFrame = Number.NEGATIVE_INFINITY;
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

// Every baked cell may have lost its pixels, and a cell is never re-baked while
// it is resident; under memory pressure the cells are what can be rebuilt most
// cheaply, a figure at a time as it is next drawn.
onCanvasRecovery(() => {
  flushFigureFrameCache();
  // The flush has just given back every cell, so a refused bake may fit now.
  bakesRefusedUntilMs = 0;
});
