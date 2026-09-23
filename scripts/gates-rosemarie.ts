/**
 * Rosemarie's and Bernie's art gates.
 *
 * Pixel gates measure cells painted from the figures the way the runtime cache
 * bakes them; the timing gates tie the coin-release constant and the release
 * point the runtime spawns its coin from to what the art actually draws.
 *
 * Failures accumulate so one run reports everything. A gate whose loop
 * measured nothing fails rather than passing.
 *
 *   npm run gates:rosemarie
 *   (also run first by `npm run render:rosemarie`)
 */

import { pathToFileURL } from 'node:url';

import { paintFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import {
  BERNIE_FIGURE,
  BERNIE_PORTRAIT_FIGURE,
  BERNIE_SEAT_X,
  BERNIE_SEAT_Y,
  BERNIE_SNUFFLE_STATE,
  GROUND_OFFSET_IN_TILE,
  ROSEMARIE_FIGURE,
  ROSEMARIE_PORTRAIT_FIGURE,
  ROSEMARIE_ROWS,
  ROSEMARIE_VIEWS,
  TILE_SCALE,
  TILE_X,
  TILE_Y,
  COIN_TOSS_KEY_COUNT,
  IDLE_BLINK_FRAME,
  rosemariePose,
  rosemarieStateName,
} from '../src/sprites/art/rosemarieFigure.js';
import { rosemarieBernieSeat, type RosemarieView } from '../src/sprites/art/rosemarieArt.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  BERNIE_SNUFFLE_FPS,
  BERNIE_SNUFFLE_FRAMES,
  BERNIE_SNUFFLE_PATTERN,
  ROSEMARIE_IDLE_FPS,
  ROSEMARIE_IDLE_FRAMES,
  ROSEMARIE_COIN_TOSS_FRAMES,
  ROSEMARIE_COIN_TOSS_RELEASE_FRAME,
  ROSEMARIE_COIN_TOSS_RELEASE_PROGRESS,
} from '../src/sprites/rosemarieTiming.js';
import { rosemarieCoinReleasePoint } from '../src/sprites/rosemarieSprite.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Above this a pixel is her body, not the soft contact shadow on the ground line. */
const SOLID_ALPHA = 200;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(id, failure);
}

interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const pixelCache = new Map<string, Pixels>();

function pixelsOf(def: FigureDef, state: string, frame: number): Pixels {
  const cacheKey = `${def.id}/${state}/${frame}`;
  const cached = pixelCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const canvas = paintFigureCell(def, state, frame);
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = { width: canvas.width, height: canvas.height, data };
  pixelCache.set(cacheKey, pixels);
  return pixels;
}

function alphaAt(pixels: Pixels, x: number, y: number): number {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) return 0;
  return pixels.data[(py * pixels.width + px) * CHANNELS + ALPHA_OFFSET];
}

/** The most opaque pixel within `radius` cell pixels of a point. */
function solidNear(pixels: Pixels, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (alphaAt(pixels, x + dx, y + dy) >= SOLID_ALPHA) return true;
    }
  }
  return false;
}

const ORIGIN_X = TILE_X + TILE_SCALE / 2;
const ORIGIN_Y = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE;

// ── G1: structure ────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const def of [
    ROSEMARIE_FIGURE,
    ROSEMARIE_PORTRAIT_FIGURE,
    BERNIE_FIGURE,
    BERNIE_PORTRAIT_FIGURE,
  ]) {
    for (const failure of figureStructuralFailures(def)) fail('G1', failure);
  }
}

// ── G2: the choreography matches the timing it is played at ─────────────────

/**
 * Bernie's snuffle and her hobble must not come back into step often; the
 * pattern's length is chosen so they realign at most once in this long.
 */
const MIN_LOOP_REALIGN_SECONDS = 20;

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/** Seconds until two loops of `frames / fps` both return to their start together. */
function realignSeconds(framesA: number, fpsA: number, framesB: number, fpsB: number): number {
  // Periods as fractions framesA/fpsA and framesB/fpsB; their least common
  // multiple is lcm(framesA·fpsB, framesB·fpsA) / (fpsA·fpsB).
  const a = framesA * fpsB;
  const b = framesB * fpsA;
  return ((a / greatestCommonDivisor(a, b)) * b) / (fpsA * fpsB);
}

/**
 * Whether `frame` lies in `[first, frames)`. Taking plain numbers keeps the
 * check honest about constants whose literal types the linter would otherwise
 * fold into an always-true comparison.
 */
function frameInRow(frame: number, first: number, frames: number): boolean {
  return frame >= first && frame < frames;
}

function gateChoreographyContract(): void {
  if (COIN_TOSS_KEY_COUNT !== ROSEMARIE_COIN_TOSS_FRAMES) {
    fail(
      'G2',
      `coin_toss is authored with ${COIN_TOSS_KEY_COUNT} keys but plays ${ROSEMARIE_COIN_TOSS_FRAMES} frames`,
    );
  }
  for (let frame = 0; frame < ROSEMARIE_COIN_TOSS_FRAMES; frame++) {
    try {
      rosemariePose('coin_toss', frame);
    } catch (error) {
      fail('G2', `coin_toss[${frame}] has no pose: ${String(error)}`);
    }
  }
  if (!frameInRow(ROSEMARIE_COIN_TOSS_RELEASE_FRAME, 1, ROSEMARIE_COIN_TOSS_FRAMES)) {
    fail(
      'G2',
      `the release frame ${ROSEMARIE_COIN_TOSS_RELEASE_FRAME} needs a wind-up frame before it ` +
        `inside the ${ROSEMARIE_COIN_TOSS_FRAMES}-frame row`,
    );
  }
  if (!frameInRow(IDLE_BLINK_FRAME, 0, ROSEMARIE_IDLE_FRAMES)) {
    fail(
      'G2',
      `the idle blink is on frame ${IDLE_BLINK_FRAME}, outside the ${ROSEMARIE_IDLE_FRAMES}-frame row`,
    );
  }
  let tapFrames = 0;
  for (let frame = 0; frame < ROSEMARIE_IDLE_FRAMES; frame++) {
    if (rosemariePose('idle', frame).caneLift > 0) tapFrames++;
  }
  if (tapFrames === 0) {
    fail('G2', 'no idle frame lifts the cane, so the hobble never re-plants it');
  }
  const realign = realignSeconds(
    BERNIE_SNUFFLE_PATTERN.length,
    BERNIE_SNUFFLE_FPS,
    ROSEMARIE_IDLE_FRAMES,
    ROSEMARIE_IDLE_FPS,
  );
  if (realign < MIN_LOOP_REALIGN_SECONDS) {
    fail(
      'G2',
      `Bernie's snuffle and her hobble fall back into step every ${realign.toFixed(1)} s ` +
        `(floor ${MIN_LOOP_REALIGN_SECONDS} s), so the two read as one animation`,
    );
  }
  const outOfRow = BERNIE_SNUFFLE_PATTERN.filter(
    (frame) => frame < 0 || frame >= BERNIE_SNUFFLE_FRAMES,
  );
  if (outOfRow.length > 0) {
    fail(
      'G2',
      `BERNIE_SNUFFLE_PATTERN names frames ${outOfRow.join(', ')} outside his ${BERNIE_SNUFFLE_FRAMES}-frame row`,
    );
  }
  for (const frame of [0, 1]) {
    if (!BERNIE_SNUFFLE_PATTERN.includes(frame)) {
      fail('G2', `BERNIE_SNUFFLE_PATTERN never plays frame ${frame}, so the snuffle never moves`);
    }
  }
}

// ── G3: every frame is its own picture ───────────────────────────────────────

function gateDistinctFrames(): void {
  for (const def of [ROSEMARIE_FIGURE, BERNIE_FIGURE]) {
    const report = distinctFrameFailures(def, (state, frame) => pixelsOf(def, state, frame).data);
    for (const failure of report.failures) fail('G3', failure);
    failUnlessMeasured('G3', report.framesMeasured, `${def.id} frames`);
  }
}

// ── G4: the coin is in her hand until the release frame, and gone on it ─────

const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
/**
 * Coin gold is bright and strongly yellow. The thresholds sit between the coin
 * (#f2c440) and the nearest other warm colours she wears — skin, the apron's
 * cream and the cane's wood all carry far more blue or far less red.
 */
const GOLD_MIN_RED = 200;
const GOLD_MIN_GREEN = 160;
const GOLD_MAX_BLUE = 110;
const GOLD_MIN_RED_OVER_BLUE = 120;

function isGold(data: Uint8ClampedArray, i: number): boolean {
  const r = data[i];
  const g = data[i + GREEN_OFFSET];
  const b = data[i + BLUE_OFFSET];
  const a = data[i + ALPHA_OFFSET];
  return (
    a >= SOLID_ALPHA &&
    r > GOLD_MIN_RED &&
    g > GOLD_MIN_GREEN &&
    b < GOLD_MAX_BLUE &&
    r - b > GOLD_MIN_RED_OVER_BLUE
  );
}

function goldCount(state: string, frame: number): number {
  const { data } = pixelsOf(ROSEMARIE_FIGURE, state, frame);
  let count = 0;
  for (let i = 0; i < data.length; i += CHANNELS) if (isGold(data, i)) count++;
  return count;
}

/**
 * A coin in her fingers is a disc about four cell pixels across; anything
 * under this many extra gold pixels is not a coin anyone can see.
 */
const MIN_HELD_COIN_PIXELS = 6;
/** The frames the coin is between her fingers: out of the pocket up to the wind-up. */
const FIRST_HELD_FRAME = 2;

/** One-shot rows are sampled at frame centres. */
const FRAME_CENTRE = 0.5;
const PROGRESS_TOLERANCE = 1e-9;

function gateCoinRelease(): void {
  const expectedProgress =
    (ROSEMARIE_COIN_TOSS_RELEASE_FRAME + FRAME_CENTRE) / ROSEMARIE_COIN_TOSS_FRAMES;
  if (Math.abs(expectedProgress - ROSEMARIE_COIN_TOSS_RELEASE_PROGRESS) > PROGRESS_TOLERANCE) {
    fail(
      'G4',
      `the release progress ${ROSEMARIE_COIN_TOSS_RELEASE_PROGRESS} is not the centre of frame ${ROSEMARIE_COIN_TOSS_RELEASE_FRAME}`,
    );
  }
  let measured = 0;
  for (const view of ROSEMARIE_VIEWS) {
    const state = rosemarieStateName('coin_toss', view);
    const baseline = goldCount(state, 0);
    for (let frame = 0; frame < ROSEMARIE_COIN_TOSS_FRAMES; frame++) {
      const extra = goldCount(state, frame) - baseline;
      measured++;
      const held = frame >= FIRST_HELD_FRAME && frame < ROSEMARIE_COIN_TOSS_RELEASE_FRAME;
      if (held && extra < MIN_HELD_COIN_PIXELS) {
        fail(
          'G4',
          `${state}[${frame}] should show the coin in her fingers but paints only ${extra} extra gold pixels`,
        );
      }
      if (!held && extra >= MIN_HELD_COIN_PIXELS) {
        fail(
          'G4',
          `${state}[${frame}] still paints a coin (${extra} extra gold pixels) although ` +
            `the release frame is ${ROSEMARIE_COIN_TOSS_RELEASE_FRAME}, so the runtime's thrown coin would double it`,
        );
      }
    }
  }
  failUnlessMeasured('G4', measured, 'coin-toss frames');
}

// ── G5: the thrown coin spawns on her hand ───────────────────────────────────

/** How far, in cell pixels, the spawn point may sit from the painted hand. */
const RELEASE_POINT_TOLERANCE = 2;

function gateReleasePoint(): void {
  let measured = 0;
  for (const view of ROSEMARIE_VIEWS) {
    const state = rosemarieStateName('coin_toss', view);
    const pixels = pixelsOf(ROSEMARIE_FIGURE, state, ROSEMARIE_COIN_TOSS_RELEASE_FRAME);
    const point = rosemarieCoinReleasePoint(view, 1);
    const x = TILE_X + point.x * TILE_SCALE;
    const y = TILE_Y + point.y * TILE_SCALE;
    measured++;
    if (!solidNear(pixels, x, y, RELEASE_POINT_TOLERANCE)) {
      fail(
        'G5',
        `${state}: the coin release point (${x.toFixed(1)}, ${y.toFixed(1)}) is not on her painted hand`,
      );
    }
  }
  failUnlessMeasured('G5', measured, 'release points');
}

// ── G6: Bernie sits on her, and his feet are on his seat ─────────────────────

const SEAT_TOLERANCE = 2;

function gateBernieSeat(): void {
  let measured = 0;
  for (const row of ROSEMARIE_ROWS) {
    for (const view of ROSEMARIE_VIEWS) {
      const state = rosemarieStateName(row, view);
      const frames = ROSEMARIE_FIGURE.states.get(state)?.frames ?? 0;
      for (let frame = 0; frame < frames; frame++) {
        const seat = rosemarieBernieSeat(view, rosemariePose(row, frame));
        const x = ORIGIN_X + seat.x * TILE_SCALE;
        const y = ORIGIN_Y + seat.y * TILE_SCALE;
        measured++;
        // The pixel just under his feet must be her shoulder, not air.
        if (
          !solidNear(
            pixelsOf(ROSEMARIE_FIGURE, state, frame),
            x,
            y + SEAT_TOLERANCE,
            SEAT_TOLERANCE,
          )
        ) {
          fail(
            'G6',
            `${state}[${frame}]: Bernie's seat (${x.toFixed(1)}, ${y.toFixed(1)}) floats off her shoulder`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G6', measured, 'seat checks');
  for (let frame = 0; frame < BERNIE_SNUFFLE_FRAMES; frame++) {
    const pixels = pixelsOf(BERNIE_FIGURE, BERNIE_SNUFFLE_STATE, frame);
    let lowest = -1;
    for (let y = 0; y < pixels.height; y++) {
      for (let x = 0; x < pixels.width; x++) if (alphaAt(pixels, x, y) >= SOLID_ALPHA) lowest = y;
    }
    if (lowest < 0 || Math.abs(lowest - BERNIE_SEAT_Y) > SEAT_TOLERANCE) {
      fail(
        'G6',
        `Bernie's snuffle[${frame}] lowest solid row is ${lowest}, his seat row is ${BERNIE_SEAT_Y}`,
      );
    }
    if (!solidNear(pixels, BERNIE_SEAT_X, BERNIE_SEAT_Y - SEAT_TOLERANCE, SEAT_TOLERANCE)) {
      fail('G6', `Bernie's snuffle[${frame}] paints nothing over his seat`);
    }
  }
}

// ── G7: facing parity ────────────────────────────────────────────────────────

interface RowExtent {
  readonly left: number;
  readonly right: number;
}

function extentInBand(pixels: Pixels, top: number, bottom: number): RowExtent | null {
  let left = Infinity;
  let right = -Infinity;
  for (let y = Math.round(top); y <= Math.round(bottom); y++) {
    for (let x = 0; x < pixels.width; x++) {
      if (alphaAt(pixels, x, y) < SOLID_ALPHA) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return Number.isFinite(left) ? { left: ORIGIN_X - left, right: right - ORIGIN_X } : null;
}

/** Heights, in tiles above the ground, of the bands the parity checks read. */
const NOSE_BAND_LOW = 0.64;
const NOSE_BAND_HIGH = 0.74;
const CANE_BAND_LOW = 0.02;
const CANE_BAND_HIGH = 0.12;
const FACE_BAND: readonly [number, number] = [NOSE_BAND_LOW, NOSE_BAND_HIGH];
const CANE_BAND: readonly [number, number] = [CANE_BAND_LOW, CANE_BAND_HIGH];
/** How much further, in cell pixels, the leading side must reach. */
const PARITY_MARGIN = 4;

function bandRows(band: readonly [number, number]): { top: number; bottom: number } {
  return { top: ORIGIN_Y - band[1] * TILE_SCALE, bottom: ORIGIN_Y - band[0] * TILE_SCALE };
}

function gateFacingParity(): void {
  let measured = 0;
  const views: ReadonlyArray<{
    view: RosemarieView;
    band: readonly [number, number];
    what: string;
  }> = [
    // In profile she faces +x: the nose leads the face band.
    { view: 'side', band: FACE_BAND, what: 'her nose' },
    // Head-on the cane is on her left, which is the viewer's right.
    { view: 'front', band: CANE_BAND, what: 'the cane' },
  ];
  for (const { view, band, what } of views) {
    for (const row of ROSEMARIE_ROWS) {
      const state = rosemarieStateName(row, view);
      const { top, bottom } = bandRows(band);
      const extent = extentInBand(pixelsOf(ROSEMARIE_FIGURE, state, 0), top, bottom);
      measured++;
      if (extent === null) {
        fail('G7', `${state}[0] paints nothing in the band ${what} is measured in`);
        continue;
      }
      if (extent.right < extent.left + PARITY_MARGIN) {
        fail(
          'G7',
          `${state}[0]: ${what} should put the ink further right (${extent.right}px) than left ` +
            `(${extent.left}px) of her centre by ${PARITY_MARGIN}px`,
        );
      }
    }
  }
  failUnlessMeasured('G7', measured, 'parity bands');
}

// ── G8: she is short even for a dwarf ────────────────────────────────────────

/**
 * Standing height to the crown of her hair, in tiles. Carl is two tiles; a
 * dwarf woman bent over a cane comes to his hip, and stands shorter than the
 * club patrons around her, who are about a tile.
 */
const MIN_HEIGHT_TILES = 0.82;
const MAX_HEIGHT_TILES = 0.95;

function gateHeight(): void {
  let measured = 0;
  for (const view of ROSEMARIE_VIEWS) {
    const state = rosemarieStateName('idle', view);
    const pixels = pixelsOf(ROSEMARIE_FIGURE, state, 0);
    let top = -1;
    for (let y = 0; y < pixels.height && top < 0; y++) {
      for (let x = 0; x < pixels.width; x++) {
        if (alphaAt(pixels, x, y) >= SOLID_ALPHA) {
          top = y;
          break;
        }
      }
    }
    measured++;
    const height = (ORIGIN_Y - top) / TILE_SCALE;
    if (top < 0 || height < MIN_HEIGHT_TILES || height > MAX_HEIGHT_TILES) {
      fail(
        'G8',
        `${state}[0] stands ${height.toFixed(2)} tiles, outside ${MIN_HEIGHT_TILES}–${MAX_HEIGHT_TILES}`,
      );
    }
  }
  failUnlessMeasured('G8', measured, 'standing heights');
}

/** Runs every gate and returns one message per failure. */
export function rosemarieGateFailures(): string[] {
  failures.length = 0;
  pixelCache.clear();
  // The contract gate runs first: a broken choreography makes the painter
  // throw, and each later gate's throw is reported rather than ending the run.
  const gates: ReadonlyArray<readonly [string, () => void]> = [
    ['G2', gateChoreographyContract],
    ['G1', gateStructure],
    ['G3', gateDistinctFrames],
    ['G4', gateCoinRelease],
    ['G5', gateReleasePoint],
    ['G6', gateBernieSeat],
    ['G7', gateFacingParity],
    ['G8', gateHeight],
  ];
  for (const [id, gate] of gates) {
    try {
      gate();
    } catch (error) {
      fail(id, `the gate threw before it could measure: ${String(error)}`);
    }
  }
  return [...failures];
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  console.log('Rosemarie and Bernie art gates');
  reportFigureGates('rosemarie', rosemarieGateFailures());
}
