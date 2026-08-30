/**
 * Gates for the figure frame cache.
 *
 * The cache's whole value is in behaviour nothing on screen shows: that
 * instances share cells, that a full cache paints instead of blanking, that a
 * frame's painting is bounded, and that a finished fight gives its memory back.
 * Each of those is asserted here against a synthetic figure whose painter costs
 * whatever the gate needs it to.
 *
 *   npm run gates:figure-cache
 */

import { EMPTY_ALPHA_CUTOFF } from '../src/core/spriteFrames.js';
import {
  getFigureCacheStats,
  setFigureCacheStatsRecording,
} from '../src/sprites/figure/figureCacheStats.js';
import { figureStates, type FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  beginFigureFrame,
  drawFigureCached,
  figurePrewarmDepth,
  flushFigureFrameCache,
  prewarmFigureState,
  FIGURE_BYTE_BUDGET,
  IDLE_FRAMES_BEFORE_RELEASE,
  PREWARM_BAKE_BUDGET_MS,
  PREWARM_CAPACITY_RETRIES,
} from '../src/sprites/figure/figureFrameCache.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';

installCanvasGlobals();

/** Cell size chosen so a megabyte of RGBA is a round number of cells. */
const CELL_SIZE = 512;
const TILE_SCALE = 64;
const TILE_SIZE = 32;
const FRAMES_PER_STATE = 12;

/** The scratch surface the gates draw onto; nothing reads its pixels. */
const TARGET_SIZE_PX = 256;

/** Milliseconds a deliberately slow painter burns, well past the frame budget. */
const SLOW_PAINT_MS = 4;

/**
 * Cells in the row the prewarm-pacing gate drains — enough that the pacing is
 * measured over a run of frames rather than off one bake.
 */
const PREWARM_BURST_FRAMES = 12;

/**
 * How far over its stated allowance prewarming's mean spend may come out.
 *
 * Not one, because a cell cannot be painted half way: a row of cells each
 * several times the allowance overshoots by whatever the last one costs, and
 * the timing includes the idle sweep and the harness's own clock reads. Well
 * under the ratio the unpaced pump produced, which spent a whole cell's cost on
 * every frame of the drain.
 */
const PREWARM_MEAN_SLACK = 2;

/** Frames the pacing gate pumps before it calls a queue stalled rather than paced. */
const PREWARM_BURST_FRAME_LIMIT = 600;

/**
 * A painter cheap enough to fit the prewarm allowance and still leave headroom
 * — the headroom a slow figure must not be allowed to start a bake on.
 */
const CHEAP_PAINT_MS = 0.5;

/**
 * The most idle frames a row may take to be released before this gate calls it
 * held too long.
 *
 * Frozen here rather than taken from the cache, and deliberately not derived
 * from `IDLE_FRAMES_BEFORE_RELEASE`: this is the independent claim that the
 * window itself has not drifted — a row nobody plays comes back inside about
 * fifteen seconds of play, whatever the cache declares. The gate below makes the
 * other, separate claim against the imported window: that the sweep releases on
 * the frame the window says it will.
 */
const MAX_IDLE_FRAMES_TO_RELEASE = 900;

/**
 * The idle frame the sweep is expected to release on.
 *
 * The sweep runs at the start of a frame and releases a row whose gap has grown
 * *past* the window, so the release lands on the frame after it.
 */
const RELEASE_FRAME_AFTER_WINDOW = IDLE_FRAMES_BEFORE_RELEASE + 1;

/** Enough headroom past the expected release to tell "late" from "never". */
const IDLE_POLL_SLACK_FRAMES = 60;

/** RGBA. */
const BYTES_PER_PIXEL = 4;

/**
 * A cell big enough that a handful of them reach the per-figure ceiling, so the
 * gates that have to fill a figure up cost a handful of bakes rather than
 * dozens.
 */
const BIG_CELL_SIZE = 1024;

function cellsToFillFigureCeiling(cellSize: number): number {
  return Math.ceil(FIGURE_BYTE_BUDGET / (cellSize * cellSize * BYTES_PER_PIXEL));
}

let failures = 0;

function check(name: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures++;
  console.error(`  FAIL ${name}: ${detail}`);
}

function makeFigure(
  id: string,
  paintMs: number,
  cellSize = CELL_SIZE,
  frames = FRAMES_PER_STATE,
): FigureDef {
  return {
    id,
    frameWidth: cellSize,
    frameHeight: cellSize,
    tileX: (cellSize - TILE_SCALE) / 2,
    tileY: cellSize - TILE_SCALE,
    tileScale: TILE_SCALE,
    states: figureStates({ walk: frames, attack: frames }),
    paintFrame: (ctx, _state, frame) => {
      const startedAt = performance.now();
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(frame, frame, cellSize / 2, cellSize / 2);
      while (performance.now() - startedAt < paintMs) {
        ctx.fillRect(0, 0, 1, 1);
      }
    },
  };
}

function reset(): void {
  flushFigureFrameCache();
  setFigureCacheStatsRecording(false);
  setFigureCacheStatsRecording(true);
  beginFigureFrame();
}

// ── Cached-versus-direct parity ──────────────────────────────────────────────

/** A figure whose cells are small enough that its rows cost the cache nothing. */
const BYSTANDER_CELL_SIZE = 128;

/** A cell small enough to compare pixel by pixel in a gate. */
const PARITY_CELL_SIZE = 64;
/**
 * Tile scale equal to the cell, so the figure is drawn at 1:1 and the only
 * resampling in the comparison is the bake's own supersample round trip.
 */
const PARITY_TILE_SIZE = PARITY_CELL_SIZE;
/** How far past its declared frame the parity painter deliberately reaches. */
const PARITY_OVERHANG_PX = 20;
const PARITY_TARGET_PX = PARITY_CELL_SIZE + PARITY_OVERHANG_PX;
/** Even, so the mark's edges land on whole pixels at the supersampled density. */
const PARITY_MARK_INSET = 12;
const PARITY_BASE_COLOR = '#3b7dd8';
const PARITY_MARK_COLOR = '#e0c341';
const PARITY_OVERHANG_COLOR = '#ff2d2d';

/** Caller state a damage flash or a fade would have set before drawing. */
const CALLER_ALPHA = 0.5;
const CALLER_SHADOW_BLUR = 8;
const CALLER_SHADOW_COLOR = 'rgba(0, 0, 0, 1)';

/** Channel difference tolerated between the two paths, out of 255. */
const PARITY_CHANNEL_TOLERANCE = 1;

/** Far enough that the budget burner lands nowhere near the compared pixels. */
const OFFSCREEN_X = 10000;

const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
const RGBA_STRIDE = 4;
const OPAQUE = 255;

function makeParityFigure(): FigureDef {
  return {
    id: 'parity',
    frameWidth: PARITY_CELL_SIZE,
    frameHeight: PARITY_CELL_SIZE,
    tileX: 0,
    tileY: 0,
    tileScale: PARITY_TILE_SIZE,
    states: figureStates({ pose: 1 }),
    paintFrame: (target) => {
      target.fillStyle = PARITY_BASE_COLOR;
      target.fillRect(0, 0, PARITY_CELL_SIZE, PARITY_CELL_SIZE);
      target.fillStyle = PARITY_MARK_COLOR;
      target.fillRect(
        PARITY_MARK_INSET,
        PARITY_MARK_INSET,
        PARITY_CELL_SIZE - PARITY_MARK_INSET * 2,
        PARITY_CELL_SIZE - PARITY_MARK_INSET * 2,
      );
      // Deliberately outside the declared frame: a baked cell crops this, and
      // the fallback has to crop it identically or a figure grows a smear that
      // only ever appears when the cache is full.
      target.fillStyle = PARITY_OVERHANG_COLOR;
      target.fillRect(PARITY_CELL_SIZE, 0, PARITY_OVERHANG_PX, PARITY_CELL_SIZE);
    },
  };
}

interface CallerState {
  readonly alpha?: number;
  readonly shadowBlur?: number;
}

interface ParityResult {
  /** Whether the second pass genuinely took the fallback path. */
  readonly forcedDirect: boolean;
  readonly differing: number;
  readonly compared: number;
  readonly cachedOverhangInk: number;
  readonly directOverhangInk: number;
}

function applyCallerState(target: CanvasRenderingContext2D, state: CallerState): void {
  if (state.alpha !== undefined) target.globalAlpha = state.alpha;
  if (state.shadowBlur !== undefined) {
    target.shadowBlur = state.shadowBlur;
    target.shadowColor = CALLER_SHADOW_COLOR;
  }
}

function overhangInk(pixels: Uint8ClampedArray, width: number, height: number): number {
  let inked = 0;
  for (let y = 0; y < height; y++) {
    for (let x = PARITY_CELL_SIZE; x < width; x++) {
      if (pixels[(y * width + x) * RGBA_STRIDE + ALPHA_OFFSET] > EMPTY_ALPHA_CUTOFF) inked++;
    }
  }
  return inked;
}

/**
 * Draws one frame twice — once warm from a cell, once forced onto the fallback
 * — and reports how far apart the two came out.
 *
 * The fallback is forced by burning the frame's bake allowance on an unrelated
 * figure first, which is the same refusal a busy frame produces in play.
 */
function parityDiff(state: CallerState): ParityResult {
  const figure = makeParityFigure();
  const cachedTarget = gameContext(PARITY_TARGET_PX, PARITY_TARGET_PX);
  const directTarget = gameContext(PARITY_TARGET_PX, PARITY_TARGET_PX);

  reset();
  applyCallerState(cachedTarget, state);
  drawFigureCached(cachedTarget, figure, 'pose', 0, 0, 0, PARITY_TILE_SIZE);
  const cachedStats = getFigureCacheStats();

  reset();
  const burner = makeFigure('parity_burner', SLOW_PAINT_MS);
  drawFigureCached(directTarget, burner, 'walk', 0, OFFSCREEN_X, 0, TILE_SIZE);
  applyCallerState(directTarget, state);
  drawFigureCached(directTarget, figure, 'pose', 0, 0, 0, PARITY_TILE_SIZE);
  const directStats = getFigureCacheStats();

  const cached = cachedTarget.getImageData(0, 0, PARITY_TARGET_PX, PARITY_TARGET_PX).data;
  const direct = directTarget.getImageData(0, 0, PARITY_TARGET_PX, PARITY_TARGET_PX).data;
  let differing = 0;
  for (let index = 0; index < cached.length; index += RGBA_STRIDE) {
    for (let channel = 0; channel < RGBA_STRIDE; channel++) {
      if (Math.abs(cached[index + channel] - direct[index + channel]) > PARITY_CHANNEL_TOLERANCE) {
        differing++;
        break;
      }
    }
  }

  return {
    forcedDirect: cachedStats.directDraws === 0 && directStats.directDraws === 1,
    differing,
    compared: cached.length / RGBA_STRIDE,
    cachedOverhangInk: overhangInk(cached, PARITY_TARGET_PX, PARITY_TARGET_PX),
    directOverhangInk: overhangInk(direct, PARITY_TARGET_PX, PARITY_TARGET_PX),
  };
}

// ── Nested paint ─────────────────────────────────────────────────────────────

const NESTED_CELL_SIZE = 64;
/** Where the inner figure sits, leaving the outer's corner to itself. */
const NESTED_INNER_OFFSET = 16;
const NESTED_CORNER_PX = 2;
const OUTER_COLOR = '#c0392b';
const INNER_COLOR = '#27ae60';
const OUTER_RGB = { red: 0xc0, green: 0x39, blue: 0x2b };

// ── Destination extent ───────────────────────────────────────────────────────

/** A cell whose half-density bake needs rounding up, and one that does not. */
const ODD_FRAME_WIDTH = 33;
const EVEN_FRAME_WIDTH = 32;
/** The mark's declared width, even so it survives the half-density bake whole. */
const EXTENT_INK_WIDTH = 32;
const EXTENT_TILE_SCALE = 4;
const EXTENT_TILE_SIZE = 32;
const EXTENT_TARGET_PX = 320;
const EXTENT_TOLERANCE_PX = 1;
/** A display the sprite loader halves its sheets for, so cells bake half-dense. */
const LOW_END_DEVICE_PIXEL_RATIO = 1;
const RETINA_DEVICE_PIXEL_RATIO = 2;

interface ShimmedWindow {
  devicePixelRatio: number;
}
interface ShimmedGlobals {
  window?: ShimmedWindow;
}
const shimmedGlobals: ShimmedGlobals = globalThis;

function setDevicePixelRatio(ratio: number): void {
  const shim = shimmedGlobals.window;
  if (shim === undefined) throw new Error('the canvas globals shim installed no window');
  shim.devicePixelRatio = ratio;
}

/**
 * How wide the figure's mark actually lands, drawn at half bake density.
 *
 * The mark is declared as a fixed number of cell pixels, so its drawn width is
 * a fixed multiple of that whatever the declared frame width is — unless the
 * rounding surplus a half-density cell is allocated with gets squeezed into the
 * destination, which drags the whole image and its tile anchor in with it.
 */
function inkExtentAtHalfBake(frameWidth: number): number {
  const figure: FigureDef = {
    id: `extent_${frameWidth}`,
    frameWidth,
    frameHeight: frameWidth,
    tileX: 0,
    tileY: 0,
    tileScale: EXTENT_TILE_SCALE,
    states: figureStates({ pose: 1 }),
    paintFrame: (target) => {
      target.fillStyle = PARITY_BASE_COLOR;
      target.fillRect(0, 0, EXTENT_INK_WIDTH, EXTENT_INK_WIDTH);
    },
  };

  setDevicePixelRatio(LOW_END_DEVICE_PIXEL_RATIO);
  reset();
  const target = gameContext(EXTENT_TARGET_PX, EXTENT_TARGET_PX);
  // Nearest-neighbour, so the mark's edge is where the blit put it rather than
  // half a cell pixel of interpolation either side of it — the whole error
  // being measured here is smaller than that ramp.
  target.imageSmoothingEnabled = false;
  drawFigureCached(target, figure, 'pose', 0, 0, 0, EXTENT_TILE_SIZE);
  const pixels = target.getImageData(0, 0, EXTENT_TARGET_PX, EXTENT_TARGET_PX).data;
  setDevicePixelRatio(RETINA_DEVICE_PIXEL_RATIO);
  flushFigureFrameCache();

  let minX = EXTENT_TARGET_PX;
  let maxX = -1;
  for (let y = 0; y < EXTENT_TARGET_PX; y++) {
    for (let x = 0; x < EXTENT_TARGET_PX; x++) {
      if (pixels[(y * EXTENT_TARGET_PX + x) * RGBA_STRIDE + ALPHA_OFFSET] <= EMPTY_ALPHA_CUTOFF) {
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (maxX < 0) throw new Error(`the ${frameWidth}px extent figure painted nothing at all`);
  return maxX - minX + 1;
}

setFigureCacheStatsRecording(true);
const ctx = gameContext(TARGET_SIZE_PX, TARGET_SIZE_PX);

console.log('figure frame cache gates');

// Two instances of one figure playing the same frame must blit one cell.
{
  reset();
  const figure = makeFigure('shared_cell', 0);
  drawFigureCached(ctx, figure, 'walk', 0, 0, 0, TILE_SIZE);
  drawFigureCached(ctx, figure, 'walk', 0, TILE_SIZE * 2, 0, TILE_SIZE);
  const stats = getFigureCacheStats();
  check(
    'instances share one cell',
    stats.bakes === 1 && stats.hits === 1,
    `baked ${stats.bakes}, hit ${stats.hits} — expected one of each`,
  );
}

// A frame's painting is bounded: past the budget a miss paints straight out.
{
  reset();
  const figure = makeFigure('slow_paint', SLOW_PAINT_MS);
  drawFigureCached(ctx, figure, 'walk', 0, 0, 0, TILE_SIZE);
  drawFigureCached(ctx, figure, 'walk', 1, 0, 0, TILE_SIZE);
  const stats = getFigureCacheStats();
  check(
    'bake budget stops further bakes in a frame',
    stats.bakes === 1 && stats.directDraws === 1,
    `baked ${stats.bakes}, direct-drew ${stats.directDraws} — expected one of each`,
  );
}

// A per-figure ceiling refuses rather than blanks.
{
  reset();
  const cellsPastCeiling = cellsToFillFigureCeiling(BIG_CELL_SIZE) + 1;
  const figure = makeFigure('big_cells', 0, BIG_CELL_SIZE, cellsPastCeiling);
  for (let frame = 0; frame < cellsPastCeiling; frame++) {
    beginFigureFrame();
    drawFigureCached(ctx, figure, 'walk', frame, 0, 0, TILE_SIZE);
  }
  const stats = getFigureCacheStats();
  check(
    'a full figure falls back to a direct paint',
    stats.directDraws > 0,
    `${cellsPastCeiling} cells of ${BIG_CELL_SIZE}px fit inside the per-figure ceiling; ` +
      'nothing was refused, so the ceiling is not binding',
  );
}

// Rows nobody plays are given back.
{
  reset();
  const figure = makeFigure('idle_release', 0);
  drawFigureCached(ctx, figure, 'walk', 0, 0, 0, TILE_SIZE);
  const warmBytes = getFigureCacheStats().bytes;
  const pollLimit = RELEASE_FRAME_AFTER_WINDOW + IDLE_POLL_SLACK_FRAMES;
  let idleFrames = 0;
  while (idleFrames < pollLimit && getFigureCacheStats().bytes > 0) {
    beginFigureFrame();
    idleFrames++;
  }
  const stats = getFigureCacheStats();
  check(
    'an unplayed row is released',
    warmBytes > 0 && stats.bytes === 0 && stats.releases > 0,
    `held ${warmBytes} bytes warm; after ${idleFrames} idle frames it still holds ${stats.bytes} ` +
      `bytes over ${stats.releases} release(s)`,
  );
  check(
    'the idle sweep releases on the frame its declared window names',
    idleFrames === RELEASE_FRAME_AFTER_WINDOW,
    `the row came back after ${idleFrames} idle frames, not the ` +
      `${RELEASE_FRAME_AFTER_WINDOW} its ${IDLE_FRAMES_BEFORE_RELEASE}-frame window names`,
  );
  check(
    'the release window is still inside the ceiling it is held to',
    IDLE_FRAMES_BEFORE_RELEASE <= MAX_IDLE_FRAMES_TO_RELEASE,
    `the cache holds an unplayed row for ${IDLE_FRAMES_BEFORE_RELEASE} frames, past the ` +
      `${MAX_IDLE_FRAMES_TO_RELEASE} a finished fight is allowed to keep paying for`,
  );
}

// Prewarm paints a row before anything asks to draw it.
{
  reset();
  const figure = makeFigure('prewarm', 0);
  prewarmFigureState(figure, 'attack');
  beginFigureFrame();
  const prewarmed = getFigureCacheStats().prewarmBakes;
  drawFigureCached(ctx, figure, 'attack', 0, 0, 0, TILE_SIZE);
  const stats = getFigureCacheStats();
  check(
    'prewarm bakes ahead of the first draw',
    prewarmed > 0 && stats.hits === 1 && stats.bakes === 0,
    `prewarmed ${prewarmed} cells, then hit ${stats.hits} and baked ${stats.bakes}`,
  );
}

// A flush gives everything back.
{
  reset();
  const figure = makeFigure('flush', 0);
  drawFigureCached(ctx, figure, 'walk', 0, 0, 0, TILE_SIZE);
  const warmBytes = getFigureCacheStats().bytes;
  flushFigureFrameCache();
  const stats = getFigureCacheStats();
  check(
    'a flush empties the cache',
    warmBytes > 0 && stats.bytes === 0 && stats.rows === 0 && stats.figures === 0,
    `${stats.bytes} bytes, ${stats.rows} rows, ${stats.figures} figures still held`,
  );
}

// The cached blit and the direct paint must put the same pixels on the target,
// including under the context state a caller had already set.
{
  const plainDiff = parityDiff({});
  check(
    'a direct paint matches the cached blit',
    plainDiff.forcedDirect && plainDiff.differing === 0,
    plainDiff.forcedDirect
      ? `${plainDiff.differing} of ${plainDiff.compared} pixels differ`
      : 'the second pass never took the fallback path, so nothing was compared',
  );

  const alphaDiff = parityDiff({ alpha: CALLER_ALPHA });
  check(
    'a direct paint matches the cached blit under a caller alpha',
    alphaDiff.forcedDirect && alphaDiff.differing === 0,
    alphaDiff.forcedDirect
      ? `${alphaDiff.differing} of ${alphaDiff.compared} pixels differ at globalAlpha ` +
          `${CALLER_ALPHA}`
      : 'the second pass never took the fallback path, so nothing was compared',
  );

  const shadowDiff = parityDiff({ shadowBlur: CALLER_SHADOW_BLUR });
  check(
    'a direct paint matches the cached blit under a caller shadow',
    shadowDiff.forcedDirect && shadowDiff.differing === 0,
    shadowDiff.forcedDirect
      ? `${shadowDiff.differing} of ${shadowDiff.compared} pixels differ at shadowBlur ` +
          `${CALLER_SHADOW_BLUR}`
      : 'the second pass never took the fallback path, so nothing was compared',
  );

  check(
    'neither path draws past the declared cell',
    plainDiff.cachedOverhangInk === 0 && plainDiff.directOverhangInk === 0,
    `${plainDiff.cachedOverhangInk} cached and ${plainDiff.directOverhangInk} direct pixels ` +
      "landed outside the figure's declared frame",
  );
}

// A figure that has hit its own ceiling must not be paid for by another figure.
{
  reset();
  const bystanderFrames = 2;
  const bystander = makeFigure('bystander', 0, BYSTANDER_CELL_SIZE, bystanderFrames);
  for (let frame = 0; frame < bystanderFrames; frame++) {
    drawFigureCached(ctx, bystander, 'walk', frame, 0, 0, TILE_SIZE);
  }

  const cellsPastCeiling = cellsToFillFigureCeiling(BIG_CELL_SIZE) + 1;
  const hog = makeFigure('ceiling_hog', 0, BIG_CELL_SIZE, cellsPastCeiling);
  for (let frame = 0; frame < cellsPastCeiling; frame++) {
    beginFigureFrame();
    drawFigureCached(ctx, hog, 'walk', frame, 0, 0, TILE_SIZE);
  }
  const refusal = getFigureCacheStats();

  beginFigureFrame();
  for (let frame = 0; frame < bystanderFrames; frame++) {
    drawFigureCached(ctx, bystander, 'walk', frame, 0, 0, TILE_SIZE);
  }
  const afterwards = getFigureCacheStats();
  check(
    'a per-figure refusal spares every other figure',
    refusal.directDraws === 1 &&
      refusal.evictions === 0 &&
      afterwards.hits === bystanderFrames &&
      afterwards.misses === 0,
    `the refused cell direct-drew ${refusal.directDraws} time(s) after ${refusal.evictions} ` +
      `eviction(s), and the bystander then hit ${afterwards.hits} of its ${bystanderFrames} ` +
      `cells with ${afterwards.misses} miss(es)`,
  );
}

// A painter that composes another figure must not have its own cell wiped.
{
  reset();
  const inner: FigureDef = {
    id: 'nested_inner',
    frameWidth: NESTED_CELL_SIZE,
    frameHeight: NESTED_CELL_SIZE,
    tileX: 0,
    tileY: 0,
    tileScale: NESTED_CELL_SIZE,
    states: figureStates({ pose: 1 }),
    paintFrame: (innerCtx) => {
      innerCtx.fillStyle = INNER_COLOR;
      innerCtx.fillRect(0, 0, NESTED_CELL_SIZE, NESTED_CELL_SIZE);
    },
  };
  const outer: FigureDef = {
    id: 'nested_outer',
    frameWidth: NESTED_CELL_SIZE,
    frameHeight: NESTED_CELL_SIZE,
    tileX: 0,
    tileY: 0,
    tileScale: NESTED_CELL_SIZE,
    states: figureStates({ pose: 1 }),
    paintFrame: (outerCtx) => {
      outerCtx.fillStyle = OUTER_COLOR;
      outerCtx.fillRect(0, 0, NESTED_CELL_SIZE, NESTED_CELL_SIZE);
      drawFigureCached(
        outerCtx,
        inner,
        'pose',
        0,
        NESTED_INNER_OFFSET,
        NESTED_INNER_OFFSET,
        NESTED_CELL_SIZE,
      );
    },
  };

  const target = gameContext(NESTED_CELL_SIZE, NESTED_CELL_SIZE);
  drawFigureCached(target, outer, 'pose', 0, 0, 0, NESTED_CELL_SIZE);
  const corner = target.getImageData(NESTED_CORNER_PX, NESTED_CORNER_PX, 1, 1).data;
  check(
    "a nested paint leaves its caller's cell alone",
    corner[RED_OFFSET] === OUTER_RGB.red &&
      corner[GREEN_OFFSET] === OUTER_RGB.green &&
      corner[BLUE_OFFSET] === OUTER_RGB.blue &&
      corner[ALPHA_OFFSET] === OPAQUE,
    `the corner the inner figure never covers came back rgba(${corner[RED_OFFSET]}, ` +
      `${corner[GREEN_OFFSET]}, ${corner[BLUE_OFFSET]}, ${corner[ALPHA_OFFSET]})`,
  );
}

// An odd declared width must land where an even one does, not shrunk into the
// rounding surplus its cell was allocated with.
{
  const evenExtent = inkExtentAtHalfBake(EVEN_FRAME_WIDTH);
  const oddExtent = inkExtentAtHalfBake(ODD_FRAME_WIDTH);
  const expected = EXTENT_INK_WIDTH * (EXTENT_TILE_SIZE / EXTENT_TILE_SCALE);
  check(
    'an odd frame width blits at the same destination as an even one',
    Math.abs(evenExtent - expected) <= EXTENT_TOLERANCE_PX &&
      Math.abs(oddExtent - expected) <= EXTENT_TOLERANCE_PX,
    `a ${EXTENT_INK_WIDTH}px mark drew ${evenExtent}px wide from a ${EVEN_FRAME_WIDTH}px cell ` +
      `and ${oddExtent}px from a ${ODD_FRAME_WIDTH}px one; both should be ${expected}px`,
  );
}

// Prewarming a row whose every cell costs more than the whole prewarm
// allowance must spread the cost over frames, not spend it on each of them.
{
  reset();
  const figure = makeFigure(
    'prewarm_burst',
    SLOW_PAINT_MS,
    BYSTANDER_CELL_SIZE,
    PREWARM_BURST_FRAMES,
  );
  prewarmFigureState(figure, 'attack');
  let spentMs = 0;
  let framesPumped = 0;
  while (figurePrewarmDepth() > 0 && framesPumped < PREWARM_BURST_FRAME_LIMIT) {
    const startedAt = performance.now();
    beginFigureFrame();
    spentMs += performance.now() - startedAt;
    framesPumped++;
  }
  const meanMs = spentMs / framesPumped;
  const cellsBaked = PREWARM_BURST_FRAMES;
  check(
    'a row of over-budget cells is prewarmed across frames, not on every frame',
    figurePrewarmDepth() === 0 && meanMs <= PREWARM_BAKE_BUDGET_MS * PREWARM_MEAN_SLACK,
    `${cellsBaked} cells of ${SLOW_PAINT_MS}ms drained over ${framesPumped} frame(s) at ` +
      `${meanMs.toFixed(2)}ms a frame, past the ${PREWARM_BAKE_BUDGET_MS}ms allowance` +
      (figurePrewarmDepth() === 0 ? '' : ' — and the queue never drained at all'),
  );
}

// A cell whose measured cost cannot fit what is left of the allowance must not
// be started, because a bake cannot be stopped part way.
{
  reset();
  const cheap = makeFigure('pace_cheap', CHEAP_PAINT_MS, BYSTANDER_CELL_SIZE, 1);
  const costly = makeFigure('pace_costly', SLOW_PAINT_MS, BYSTANDER_CELL_SIZE, 1);
  prewarmFigureState(cheap, 'attack');
  prewarmFigureState(costly, 'attack');
  let learningFrames = 0;
  while (figurePrewarmDepth() > 0 && learningFrames < PREWARM_BURST_FRAME_LIMIT) {
    beginFigureFrame();
    learningFrames++;
  }

  // The cells go; what each figure was measured to cost stays, which is the
  // whole point of holding those measurements outside the cells they came from.
  flushFigureFrameCache();
  prewarmFigureState(cheap, 'attack');
  prewarmFigureState(costly, 'attack');
  beginFigureFrame();
  const paced = getFigureCacheStats();
  check(
    'a bake too large for the allowance left is not started',
    paced.prewarmBakes === 1,
    `one frame prewarmed ${paced.prewarmBakes} cells: a ${CHEAP_PAINT_MS}ms cell and then a ` +
      `${SLOW_PAINT_MS}ms one, on a ${PREWARM_BAKE_BUDGET_MS}ms allowance`,
  );
}

// A prewarm the cache had no room for is retried, and then let go of.
{
  reset();
  const oversized = Math.ceil(Math.sqrt(FIGURE_BYTE_BUDGET / BYTES_PER_PIXEL)) + 1;
  const figure = makeFigure('prewarm_refused', 0, oversized, 1);
  prewarmFigureState(figure, 'walk');
  beginFigureFrame();
  const afterFirstRefusal = figurePrewarmDepth();
  const rowsHeld = getFigureCacheStats().rows;
  for (let attempt = 1; attempt < PREWARM_CAPACITY_RETRIES; attempt++) beginFigureFrame();
  check(
    'a prewarm refused for capacity is retried, then abandoned',
    afterFirstRefusal === 1 && rowsHeld === 0 && figurePrewarmDepth() === 0,
    `after one refusal the queue held ${afterFirstRefusal} request(s) and the cache ` +
      `${rowsHeld} empty row(s); after ${PREWARM_CAPACITY_RETRIES} it held ` +
      `${figurePrewarmDepth()}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} figure cache gate(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll figure cache gates passed.');
}
