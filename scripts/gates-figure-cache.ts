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
  BYTES_PER_MEGABYTE,
  getFigureCacheStats,
  setFigureCacheStatsRecording,
} from '../src/sprites/figure/figureCacheStats.js';
import { figureStates, type FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  beginFigureFrame,
  drawFigureCached,
  figureByteBudgetFor,
  figurePrewarmDepth,
  figurePrewarmRequests,
  figureResidentBytes,
  flushFigureFrameCache,
  prewarmFigureState,
  FIGURE_BYTE_BUDGET,
  IDLE_FRAMES_BEFORE_RELEASE,
  PREWARM_BAKE_BUDGET_MS,
  PREWARM_CAPACITY_RETRIES,
  releaseFigure,
} from '../src/sprites/figure/figureFrameCache.js';
import { DEFAULT_HUMAN_APPEARANCE } from '../src/sprites/art/human/appearance.js';
import {
  activeHumanFigure,
  drawHumanSelection,
  setHumanAppearance,
} from '../src/sprites/humanSprite.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { restorePlayer, snapPlayer } from '../src/core/PlayerSnapshot.js';
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
  // Measured, not read off the declared window: comparing two constants is
  // settled at compile time and can never fail, while the frames the sweep
  // actually took answer the claim whatever the cache declares.
  check(
    'an unplayed row is released inside the ceiling it is held to',
    idleFrames <= MAX_IDLE_FRAMES_TO_RELEASE,
    `the cache held an unplayed row for ${idleFrames} frames, past the ` +
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

// A `FigureDef.budgetMegabytes` below the fleet default is honoured: two rows
// that fit easily under the default ceiling still evict one another once an
// override sets the figure's own ceiling below their combined size.
{
  const overrideBudgetMegabytes = 6;
  const overrideCellSize = 512;
  const overrideFramesPerRow = 4;
  const rowMegabytes =
    (overrideFramesPerRow * overrideCellSize * overrideCellSize * BYTES_PER_PIXEL) /
    BYTES_PER_MEGABYTE;
  const overriddenFigure: FigureDef = {
    ...makeFigure('budget_override', 0, overrideCellSize, overrideFramesPerRow),
    budgetMegabytes: overrideBudgetMegabytes,
  };
  check(
    'the override scenario is sized to actually test something',
    rowMegabytes < overrideBudgetMegabytes && rowMegabytes * 2 > overrideBudgetMegabytes,
    `one row is ${rowMegabytes} MB against a ${overrideBudgetMegabytes} MB override — it must ` +
      'fit alone and overflow paired with a second row for the eviction below to prove anything',
  );

  // One cell a frame, and evictions summed over the frames: the stats are
  // per frame, and a whole row baked inside one frame's 2 ms allowance depends
  // on how fast this machine allocates a 1 MB cell, which is not what the case
  // is about.
  const evictionsDrawingRow = (figure: FigureDef, state: string): number => {
    let evictions = 0;
    for (let frame = 0; frame < overrideFramesPerRow; frame++) {
      beginFigureFrame();
      drawFigureCached(ctx, figure, state, frame, 0, 0, TILE_SIZE);
      evictions += getFigureCacheStats().evictions;
    }
    return evictions;
  };
  reset();
  const walkEvictions = evictionsDrawingRow(overriddenFigure, 'walk');
  const attackEvictions = evictionsDrawingRow(overriddenFigure, 'attack');
  check(
    'a per-figure budget override is honoured: a second row evicts the first once it is exceeded',
    walkEvictions === 0 && attackEvictions > 0,
    `the walk row alone caused ${walkEvictions} eviction(s); adding the attack row under ` +
      `the ${overrideBudgetMegabytes} MB override caused ${attackEvictions}, though the two ` +
      `rows together are only ${(rowMegabytes * 2).toFixed(1)} MB — well inside the ` +
      `${(FIGURE_BYTE_BUDGET / BYTES_PER_MEGABYTE).toFixed(0)} MB fleet default`,
  );

  // The same geometry without the override must not evict, or the eviction
  // above would say nothing about the override in particular.
  reset();
  const defaultFigure = makeFigure('budget_no_override', 0, overrideCellSize, overrideFramesPerRow);
  const withoutOverride =
    evictionsDrawingRow(defaultFigure, 'walk') + evictionsDrawingRow(defaultFigure, 'attack');
  check(
    'the same rows fit without an override, isolating the eviction above to the override itself',
    withoutOverride === 0,
    `the identical rows caused ${withoutOverride} eviction(s) under the fleet default, ` +
      'so the eviction seen with the override cannot be attributed to the override',
  );

  check(
    'figureByteBudgetFor reports the override rather than the fleet default',
    figureByteBudgetFor(overriddenFigure) === overrideBudgetMegabytes * BYTES_PER_MEGABYTE,
    `reported ${figureByteBudgetFor(overriddenFigure) / BYTES_PER_MEGABYTE} MB for a figure ` +
      `declaring a ${overrideBudgetMegabytes} MB override`,
  );
}

// A painter that throws inside a save of its own must not leave its clip and
// alpha on the pooled scratch surface for every later figure to paint through —
// on the bake path, and on the direct path a cell the cache refused falls to.
{
  const poisonClipPx = 4;
  const poisonAlpha = 0.1;
  const probeCellSize = PARITY_CELL_SIZE;
  const probeTarget = gameContext(probeCellSize, probeCellSize);
  const makeThrower = (id: string, cellSize: number): FigureDef => ({
    ...makeFigure(id, 0, cellSize, 1),
    paintFrame: (paintCtx) => {
      paintCtx.save();
      paintCtx.beginPath();
      paintCtx.rect(0, 0, poisonClipPx, poisonClipPx);
      paintCtx.clip();
      paintCtx.globalAlpha = poisonAlpha;
      paintCtx.save();
      throw new Error('painter failed mid-save');
    },
  });
  const probe: FigureDef = {
    id: 'after_throw_probe',
    frameWidth: probeCellSize,
    frameHeight: probeCellSize,
    tileX: 0,
    tileY: 0,
    tileScale: probeCellSize,
    states: figureStates({ walk: 1 }),
    paintFrame: (paintCtx) => {
      paintCtx.fillStyle = PARITY_BASE_COLOR;
      paintCtx.fillRect(0, 0, probeCellSize, probeCellSize);
    },
  };
  const oversizedCell = Math.ceil(Math.sqrt(FIGURE_BYTE_BUDGET / BYTES_PER_PIXEL)) + 1;
  const throwers = [
    { path: 'bake', figure: makeThrower('throws_while_baking', CELL_SIZE) },
    { path: 'direct paint', figure: makeThrower('throws_while_painting', oversizedCell) },
  ];

  // Some figure has to stay resident, or the next frame's sweep releases the
  // scratch surfaces along with the empty cache and hides the poisoning.
  const resident = makeFigure('resident_through_throw', 0, BYSTANDER_CELL_SIZE, 1);

  for (const { path, figure } of throwers) {
    reset();
    drawFigureCached(ctx, resident, 'walk', 0, 0, 0, TILE_SIZE);
    let rethrown = false;
    try {
      drawFigureCached(ctx, figure, 'walk', 0, 0, 0, TILE_SIZE);
    } catch {
      rethrown = true;
    }
    beginFigureFrame();
    probeTarget.clearRect(0, 0, probeCellSize, probeCellSize);
    drawFigureCached(probeTarget, probe, 'walk', 0, 0, 0, probeCellSize);
    const pixels = probeTarget.getImageData(0, 0, probeCellSize, probeCellSize).data;
    let opaquePixels = 0;
    for (let i = ALPHA_OFFSET; i < pixels.length; i += RGBA_STRIDE) {
      if (pixels[i] === OPAQUE) opaquePixels++;
    }
    const expectedPixels = probeCellSize * probeCellSize;
    check(
      `a painter throwing mid-save on the ${path} path does not poison the next figure`,
      rethrown && opaquePixels === expectedPixels,
      `the painter's error was ${rethrown ? '' : 'not '}rethrown; the next figure painted ` +
        `${opaquePixels} of ${expectedPixels} pixels opaque`,
    );
  }
}

/** Each outfit in the release gate is drawn in one row; its prewarm is queued, never pumped. */
const ROWS_DRAWN_PER_OUTFIT = 1;

// A replaced figure gives its memory back at once, and only its own.
{
  reset();
  const replaced = makeFigure('replaced_outfit', 0);
  const bystander = makeFigure('bystander_outfit', 0);
  drawFigureCached(ctx, replaced, 'walk', 0, 0, 0, TILE_SIZE);
  drawFigureCached(ctx, bystander, 'walk', 0, 0, 0, TILE_SIZE);
  prewarmFigureState(replaced, 'attack');
  prewarmFigureState(bystander, 'attack');
  const warmBytes = figureResidentBytes(replaced);
  const bystanderBytes = figureResidentBytes(bystander);
  const occupancyBefore = getFigureCacheStats();
  releaseFigure(replaced);
  const occupancyAfter = getFigureCacheStats();
  check(
    'a released figure holds no cells and no queued prewarm',
    warmBytes > 0 && figureResidentBytes(replaced) === 0 && figurePrewarmRequests(replaced) === 0,
    `held ${warmBytes} bytes warm; after release it holds ${figureResidentBytes(replaced)} ` +
      `bytes and ${figurePrewarmRequests(replaced)} queued prewarm(s)`,
  );
  // The per-figure count and the cache's own total are kept apart; a release
  // that clears one and not the other leaves the budget believing it is fuller
  // than it is, and every later admission pays for memory nobody holds.
  const bytesFreed = occupancyBefore.bytes - occupancyAfter.bytes;
  const rowsFreed = occupancyBefore.rows - occupancyAfter.rows;
  check(
    "a released figure's bytes and rows leave the cache's total",
    bytesFreed === warmBytes && rowsFreed === ROWS_DRAWN_PER_OUTFIT,
    `released ${warmBytes} bytes in ${ROWS_DRAWN_PER_OUTFIT} row(s); the cache total fell by ` +
      `${bytesFreed} bytes and ${rowsFreed} row(s)`,
  );
  check(
    'releasing one figure leaves every other alone',
    figureResidentBytes(bystander) === bystanderBytes && figurePrewarmRequests(bystander) === 1,
    `the bystander went from ${bystanderBytes} to ${figureResidentBytes(bystander)} bytes with ` +
      `${figurePrewarmRequests(bystander)} queued prewarm(s)`,
  );
}

// Carl changing outfit: the outfit he took off is released, the new one warmed.
{
  reset();
  setHumanAppearance(DEFAULT_HUMAN_APPEARANCE);
  const before = activeHumanFigure();
  drawHumanSelection(ctx, 0, 0, TILE_SIZE, { row: 'idle', frame: 0, flipX: false });
  const warmBytes = figureResidentBytes(before);
  setHumanAppearance({ ...DEFAULT_HUMAN_APPEARANCE, cloak: true, gauntlet: true });
  const after = activeHumanFigure();
  check(
    "Carl's equipment change releases the outfit he took off",
    warmBytes > 0 &&
      after.id !== before.id &&
      figureResidentBytes(before) === 0 &&
      figurePrewarmRequests(before) === 0,
    `the old outfit held ${warmBytes} bytes; after the change it holds ` +
      `${figureResidentBytes(before)} bytes and ${figurePrewarmRequests(before)} queued prewarm(s), ` +
      `drawing ${after.id} in place of ${before.id}`,
  );
  check(
    "Carl's equipment change queues the new outfit's rows",
    figurePrewarmRequests(after) > 0,
    `${after.id} has no prewarm queued after the change, so his first frames in it paint cold`,
  );
  setHumanAppearance(DEFAULT_HUMAN_APPEARANCE);
}

/** Frames the geared player is drawn for, so his outfit is resident before the scene changes. */
const TRANSIT_WARM_FRAMES = 60;
/** Where the transit gate's Carl stands; anywhere on the map serves. */
const TRANSIT_TILE = 3;

// A scene change keeps a geared Carl's warm outfit: the new scene builds a
// fresh player, empty-handed, and restores his gear onto him from a snapshot.
// Dressing that fresh player in what his empty inventory says releases every
// cell of the outfit he is about to be drawn in again.
{
  reset();
  const carl = new HumanPlayer(TRANSIT_TILE, TRANSIT_TILE, TILE_SIZE);
  carl.inventory.addItem('nightgaunt_cloak', 1);
  carl.inventory.equipByItemId('nightgaunt_cloak');
  carl.onEquipmentChanged();
  const geared = activeHumanFigure();
  for (let i = 0; i < TRANSIT_WARM_FRAMES; i++) {
    beginFigureFrame();
    carl.render(ctx, 0, 0, TILE_SIZE);
  }
  const warmBytes = figureResidentBytes(geared);
  const snapshot = snapPlayer(carl);
  const residentAt: Array<readonly [string, number]> = [];
  const rebuilt = new HumanPlayer(TRANSIT_TILE, TRANSIT_TILE, TILE_SIZE);
  residentAt.push(['construct', figureResidentBytes(geared)]);
  restorePlayer(rebuilt, snapshot);
  residentAt.push(['restore', figureResidentBytes(geared)]);
  beginFigureFrame();
  rebuilt.render(ctx, 0, 0, TILE_SIZE);
  residentAt.push(['first draw', figureResidentBytes(geared)]);
  const dropped = residentAt.filter(([, bytes]) => bytes === 0).map(([step]) => step);
  check(
    "a scene change keeps a geared Carl's outfit resident",
    warmBytes > 0 && dropped.length === 0 && activeHumanFigure() === geared,
    `${geared.id} held ${warmBytes} bytes before the change; it held none after ` +
      `${dropped.join(', ') || 'no step'} and is drawing ${activeHumanFigure().id}`,
  );
  setHumanAppearance(DEFAULT_HUMAN_APPEARANCE);
}

if (failures > 0) {
  console.error(`\n${failures} figure cache gate(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll figure cache gates passed.');
}
