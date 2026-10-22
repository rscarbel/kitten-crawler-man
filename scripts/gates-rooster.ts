/**
 * The roosters' art gates, for any build.
 *
 * Pixel gates measure cells baked from the build's `FigureDef` exactly as the
 * runtime cache bakes them; pose-stream gates measure the rig itself and need
 * no pixels. Failures accumulate, so one run reports everything that is wrong,
 * and every filtering loop counts what it examined and fails when that is
 * nothing (`failUnlessMeasured`): a narrowing that matches nothing is a green
 * gate measuring nothing.
 *
 * Run by the review harness, before it bakes anything:
 * `npm run render:big-rooster -- --build=<big|little|bent>`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  BIG_ROOSTER_HAND_ANCHORS,
  DUMBBELL_HELD_FRAMES,
  GORE_STATES,
  GROUND_OFFSET_PX,
  ROOSTER_CELLS,
  ROOSTER_FIGURES,
  ROOSTER_ROWS,
  ROOSTER_ROW_TIMING,
  ROOSTER_VIEWS,
  type RoosterRowBase,
  type RowSpec,
  beakTipOf,
  roosterStateName,
} from '../src/sprites/art/roosterFigure.js';
import {
  LEG_MAX_REACH,
  ROOSTER_BUILDS,
  ROOSTER_BUILD_SPECS,
  type RoosterBuild,
  type RoosterPose,
  buildRoosterSkeleton,
  fistCentre,
  legReachDemand,
  ROOSTER_TILE_SCALE,
} from '../src/sprites/art/roosterArt.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import { roosterGorePieces } from '../src/sprites/art/roosterGore.js';
import {
  ROOSTER_GORE_PARTS,
  ROOSTER_RUNTIME_ROWS,
  RoosterAnimationClock,
  roosterGaitCeilingTilesPerTick,
} from '../src/sprites/roosterSprite.js';
import { BigRooster } from '../src/creatures/BigRooster.js';
import { LittleRooster } from '../src/creatures/LittleRooster.js';
import { SlightlyBentRooster } from '../src/creatures/SlightlyBentRooster.js';
import { allLevelDefs } from '../src/levels/index.js';
import type { MobKind } from '../src/levels/mobKinds.js';
import { MAX_MOB_LEVEL } from '../src/levels/spawner.js';

const INK_ALPHA = 24;
const SOLID_ALPHA = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const HALF_TURN_DEGREES = 180;
const DEGREES_PER_RADIAN = HALF_TURN_DEGREES / Math.PI;
/**
 * The pixel tolerances below are written in game pixels and held in cell
 * pixels, so they keep their meaning whatever scale the figure paints at.
 */
const CELL_PX_PER_GAME_PX = ROOSTER_TILE_SCALE / TILE_SIZE;
/** Decimal places reported for rig-unit and tile measurements. */
const RIG_DIGITS = 4;
const TILE_DIGITS = 3;
/** Peaks this close are a tie, so the earlier frame keeps the peak. */
const PEAK_TIE = 1e-9;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const rgbaByCell = new Map<string, Uint8ClampedArray>();

function cellRgba(build: RoosterBuild, state: string, frame: number): Uint8ClampedArray {
  const key = `${build}.${state}[${frame}]`;
  const cached = rgbaByCell.get(key);
  if (cached !== undefined) return cached;
  const figure = ROOSTER_FIGURES[build];
  const cell = bakeFigureCell(figure, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, figure.frameWidth, figure.frameHeight);
  rgbaByCell.set(key, data);
  return data;
}

function cellAlpha(build: RoosterBuild, state: string, frame: number): Uint8ClampedArray {
  const data = cellRgba(build, state, frame);
  const alpha = new Uint8ClampedArray(data.length / CHANNELS);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  return alpha;
}

interface InkStats {
  readonly count: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function inkStatsOf(alpha: Uint8ClampedArray, width: number, threshold = INK_ALPHA): InkStats {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < threshold) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    count++;
    sumX += x;
    sumY += y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (count === 0) return { count, centroidX: 0, centroidY: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { count, centroidX: sumX / count, centroidY: sumY / count, minX, maxX, minY, maxY };
}

function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) if (a[i] >= INK_ALPHA !== b[i] >= INK_ALPHA) differing++;
  return differing;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function rowNamed(build: RoosterBuild, name: string, gateId: string): RowSpec | null {
  const row = ROOSTER_ROWS[build].find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `${build} has no row "${name}" — a gate is guarding a row that does not exist`);
    return null;
  }
  return row;
}

function rowsOfBase(build: RoosterBuild, base: RoosterRowBase): RowSpec[] {
  return ROOSTER_ROWS[build].filter((row) => row.base === base);
}

function cellsOf(build: RoosterBuild, row: RowSpec): Uint8ClampedArray[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) =>
    cellAlpha(build, row.name, frame),
  );
}

// ── Structural and pixel gates ───────────────────────────────────────────────

/** G1 — the shared structural gate. Gore pieces are meant to be small in a cell sized for the bird. */
function gateStructure(build: RoosterBuild): void {
  for (const failure of figureStructuralFailures(ROOSTER_FIGURES[build], {
    sparseStates: GORE_STATES,
  })) {
    fail('G1', failure);
  }
}

/**
 * How far a standing figure's lowest solid ink may sit from the ground line, in
 * game pixels at the big build, either way. Asymmetric: a figure floating above
 * the floor shows at once, so that side is tight; below it, toes coming at the
 * camera head-on legitimately reach a few pixels past the line.
 */
const FLOAT_TOLERANCE_GAME_PX = 1;
const SINK_TOLERANCE_GAME_PX = 5;
const FLOAT_TOLERANCE_PX = FLOAT_TOLERANCE_GAME_PX * CELL_PX_PER_GAME_PX;
const SINK_TOLERANCE_PX = SINK_TOLERANCE_GAME_PX * CELL_PX_PER_GAME_PX;

/**
 * G2 — the toes stand on the ground line the tile box puts under him, measured
 * on solid alpha so the soft floor shadow cannot answer for the feet.
 */
function gateAnchor(build: RoosterBuild): void {
  const cell = ROOSTER_CELLS[build];
  const groundY = cell.tileY + GROUND_OFFSET_PX;
  const sink = Math.max(FLOAT_TOLERANCE_PX, SINK_TOLERANCE_PX * cell.tilesPerUnit);
  let measured = 0;
  for (const row of rowsOfBase(build, 'idle')) {
    const stats = inkStatsOf(cellAlpha(build, row.name, 0), cell.frameWidth, SOLID_ALPHA);
    if (stats.count === 0) {
      fail('G2', `${row.name}[0] paints no solid ink to stand on`);
      continue;
    }
    measured++;
    const below = stats.maxY - groundY;
    if (below < -FLOAT_TOLERANCE_PX) {
      fail(
        'G2',
        `${row.name}[0] floats: its lowest solid ink is ${-below}px above the ground line at ${groundY} (limit ${FLOAT_TOLERANCE_PX}px)`,
      );
    }
    if (below > sink) {
      fail(
        'G2',
        `${row.name}[0] sinks: its lowest solid ink is ${below}px below the ground line at ${groundY} (limit ${sink.toFixed(1)}px)`,
      );
    }
  }
  failUnlessMeasured('G2', measured, 'standing rows');
}

/** The most a loop's seam may exceed its own largest in-cycle step. */
const LOOP_SEAM_CEILING = 1.15;
/** The least a loop's seam may be against its median step: a seam of zero is a held frame. */
const LOOP_SEAM_FLOOR = 0.5;
/** The frame after a loop's last must paint its first exactly: a whole number of turns. */
const CYCLE_CLOSE_TOLERANCE_PX = 0;
const MIN_FRAMES_PER_CYCLE_TURN = 4;

/** G3 — every loop closes in a band: no pop across the seam, no held frame, a whole cycle. */
function gateLoopClosure(build: RoosterBuild): void {
  let measured = 0;
  for (const row of ROOSTER_ROWS[build]) {
    if (row.kind !== 'loop') continue;
    measured++;
    const cells = cellsOf(build, row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) {
      fail('G3', `${row.name} does not move: its median step is 0px`);
      continue;
    }
    const ceiling = Math.max(...steps) * LOOP_SEAM_CEILING;
    if (seam > ceiling)
      fail(
        'G3',
        `${row.name} pops across its seam: ${seam}px against a ceiling of ${ceiling.toFixed(0)}px`,
      );
    const floor = typical * LOOP_SEAM_FLOOR;
    if (seam < floor)
      fail(
        'G3',
        `${row.name} holds still at its seam: ${seam}px against a floor of ${floor.toFixed(0)}px`,
      );
    const closure = frameDelta(cells[0], cellAlpha(build, row.name, row.frameCount));
    if (closure > CYCLE_CLOSE_TOLERANCE_PX) {
      fail(
        'G3',
        `${row.name} does not close: the frame after its last paints ${closure}px unlike its first`,
      );
    }
    const repeat = cells.findIndex(
      (cellAt, frame) => frame > 0 && frameDelta(cells[0], cellAt) === 0,
    );
    if (repeat >= 0 && repeat < MIN_FRAMES_PER_CYCLE_TURN) {
      fail(
        'G3',
        `${row.name} is back on its first pose by frame ${repeat} — sampled below its own rate`,
      );
    }
  }
  failUnlessMeasured('G3', measured, 'looping rows');
}

const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
const STEP_FLOOR_SHARE = 0.005;
const STEP_VS_RUNNER_UP = 1.35;

/**
 * The steps that are the blow itself: the peck's dart, the slam's drop to the
 * floor, the club's swing into its arc and the throw's release. Flattening any
 * of them to pass a continuity threshold removes the frame the player reads as
 * the attack.
 */
function isDeclaredSpike(row: RowSpec, step: number): boolean {
  const impact = ROOSTER_ROW_TIMING[row.base].impactFrame;
  if (impact === undefined) return false;
  const striking: readonly RoosterRowBase[] = ['peck', 'slam', 'club_swing', 'throw', 'punch'];
  return striking.includes(row.base) && (step === impact - 1 || step === impact);
}

/** G4 — no frame-to-frame step far above the row's own ordinary steps. */
function gateMotionContinuity(build: RoosterBuild): void {
  const figure = ROOSTER_FIGURES[build];
  const area = figure.frameWidth * figure.frameHeight;
  let measured = 0;
  for (const row of ROOSTER_ROWS[build]) {
    const cells = cellsOf(build, row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    measured += steps.length;
    const typical = median(steps);
    const runnerUp = [...steps].sort((a, b) => b - a)[1] ?? 0;
    const ordinary = typical * (row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT);
    const lone = runnerUp <= ordinary ? runnerUp * STEP_VS_RUNNER_UP : 0;
    const allowed = Math.max(ordinary, lone, area * STEP_FLOOR_SHARE);
    steps.forEach((step, i) => {
      if (step > allowed && !isDeclaredSpike(row, i)) {
        fail(
          'G4',
          `${row.name} snaps between frames ${i} and ${i + 1}: ${step}px against a median of ${typical}px (allowed ${allowed.toFixed(0)}px)`,
        );
      }
    });
  }
  failUnlessMeasured('G4', measured, 'frame-to-frame steps');
}

const CENTROID_SEAM_LIMIT = 1.6;
const CENTROID_SEAM_VS_WORST_STEP = 1.25;
const CENTROID_SEAM_FLOOR_PX = 1;

/** G5 — a loop's ink centroid comes back to where it started: no slide in place. */
function gateCentroidDrift(build: RoosterBuild): void {
  const width = ROOSTER_FIGURES[build].frameWidth;
  let measured = 0;
  for (const row of ROOSTER_ROWS[build]) {
    if (row.kind !== 'loop') continue;
    measured++;
    const stats = cellsOf(build, row).map((alpha) => inkStatsOf(alpha, width));
    const steps: number[] = [];
    for (let i = 1; i < stats.length; i++) {
      steps.push(
        Math.hypot(
          stats[i].centroidX - stats[i - 1].centroidX,
          stats[i].centroidY - stats[i - 1].centroidY,
        ),
      );
    }
    const last = stats[stats.length - 1];
    const seam = Math.hypot(
      last.centroidX - stats[0].centroidX,
      last.centroidY - stats[0].centroidY,
    );
    const allowed = Math.max(
      median(steps) * CENTROID_SEAM_LIMIT,
      Math.max(...steps) * CENTROID_SEAM_VS_WORST_STEP,
      CENTROID_SEAM_FLOOR_PX,
    );
    if (seam > allowed)
      fail(
        'G5',
        `${row.name} slides across its seam: centroid moves ${seam.toFixed(2)}px (allowed ${allowed.toFixed(2)}px)`,
      );
  }
  failUnlessMeasured('G5', measured, 'looping rows');
}

const PENULTIMATE_SETTLE_SHARE = 0.06;

/**
 * G6 — every one-shot's recovery converges on the idle of its own view: one
 * frame from the end it is already close, and every recovery frame after the
 * blow is closer than the one before. The pickup hands to the carry instead and
 * is held by the hand-anchor gate.
 */
function gateOneShotSettle(build: RoosterBuild): void {
  const figure = ROOSTER_FIGURES[build];
  const area = figure.frameWidth * figure.frameHeight;
  let measured = 0;
  for (const row of ROOSTER_ROWS[build]) {
    const impact = ROOSTER_ROW_TIMING[row.base].impactFrame;
    if (row.kind !== 'oneShot' || row.base === 'pickup' || impact === undefined) continue;
    const idle = rowNamed(build, roosterStateName('idle', row.view), 'G6');
    if (idle === null) continue;
    const idleCell = cellAlpha(build, idle.name, 0);
    const recovery: number[] = [];
    for (let frame = impact + 1; frame < row.frameCount - 1; frame++) {
      recovery.push(frameDelta(cellAlpha(build, row.name, frame), idleCell));
    }
    const penultimate = recovery[recovery.length - 1] ?? 0;
    if (penultimate > area * PENULTIMATE_SETTLE_SHARE) {
      fail(
        'G6',
        `${row.name} is ${penultimate}px from ${idle.name}[0] one frame before it ends (allowed ${(area * PENULTIMATE_SETTLE_SHARE).toFixed(0)}px)`,
      );
    }
    recovery.forEach((distance, i) => {
      measured++;
      if (i > 0 && distance >= recovery[i - 1]) {
        fail(
          'G6',
          `${row.name} stops converging on ${idle.name} at frame ${impact + 1 + i}: ${distance}px, no closer than ${recovery[i - 1]}px before it`,
        );
      }
    });
  }
  failUnlessMeasured('G6', measured, 'one-shot recovery frames');
}

/**
 * The short axis a gore piece needs at the tile to stay a shape. The minions'
 * pieces are their own size, so the floor is a share of the big bird's.
 */
const GORE_MIN_SHORT_AXIS_PX = 9;
const MINION_GORE_FLOOR_PX = 5;

/** G7 — every gore piece is still a shape at the size it renders. */
function gateGoreLegibility(build: RoosterBuild): void {
  const figure = ROOSTER_FIGURES[build];
  const floor = Math.max(
    MINION_GORE_FLOOR_PX,
    GORE_MIN_SHORT_AXIS_PX * ROOSTER_CELLS[build].tilesPerUnit,
  );
  let measured = 0;
  for (const state of GORE_STATES) {
    measured++;
    const stats = inkStatsOf(cellAlpha(build, state, 0), figure.frameWidth);
    const shortAxis =
      (Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) + 1) *
      (TILE_SIZE / ROOSTER_TILE_SCALE);
    if (shortAxis < floor)
      fail(
        'G7',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis in game (floor ${floor.toFixed(1)}px)`,
      );
  }
  failUnlessMeasured('G7', measured, 'gore pieces');
}

const DISTINCT_MASK = 16;
/** Sampling a mask cell at its middle. */
const PIXEL_CENTRE = 0.5;
const PERCENT = 100;
const DISTINCT_IOU_LIMIT = 0.62;

/** A piece's silhouette as a small mask, scale normalised away and aspect kept. */
function maskOf(build: RoosterBuild, state: string): boolean[] {
  const width = ROOSTER_FIGURES[build].frameWidth;
  const alpha = cellAlpha(build, state, 0);
  const stats = inkStatsOf(alpha, width);
  const span = Math.max(stats.maxX - stats.minX + 1, stats.maxY - stats.minY + 1);
  const left = (stats.minX + stats.maxX + 1) / 2 - span / 2;
  const top = (stats.minY + stats.maxY + 1) / 2 - span / 2;
  return Array.from({ length: DISTINCT_MASK * DISTINCT_MASK }, (_unused, i) => {
    const x = Math.floor(left + ((i % DISTINCT_MASK) + PIXEL_CENTRE) * (span / DISTINCT_MASK));
    const y = Math.floor(
      top + (Math.floor(i / DISTINCT_MASK) + PIXEL_CENTRE) * (span / DISTINCT_MASK),
    );
    if (x < 0 || y < 0 || x >= width) return false;
    const index = y * width + x;
    return index < alpha.length && alpha[index] >= INK_ALPHA;
  });
}

/** G8 — no two gore pieces share a silhouette. */
function gateGoreDistinctness(build: RoosterBuild): void {
  const masks = GORE_STATES.map((state) => maskOf(build, state));
  let measured = 0;
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      measured++;
      let both = 0;
      let either = 0;
      masks[a].forEach((inked, i) => {
        if (inked && masks[b][i]) both++;
        if (inked || masks[b][i]) either++;
      });
      const iou = either === 0 ? 0 : both / either;
      if (iou > DISTINCT_IOU_LIMIT)
        fail(
          'G8',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} share ${(iou * PERCENT).toFixed(0)}% of their silhouette`,
        );
    }
  }
  failUnlessMeasured('G8', measured, 'pairs of gore pieces');
}

const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
/**
 * One base row in all three views may take this share of the cache's
 * per-figure ceiling, so the rows a fight holds warm together (a walk, an
 * idle, a strike) fit.
 */
const ROW_SHARE_OF_FIGURE_BUDGET = 0.25;

function megabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(2);
}

/**
 * G9 — each base row, held in its three views together as `prewarmRoosterRow`
 * warms it, fits its share of the cache's ceiling for one figure, and the whole
 * runtime set fits the ceiling, with the headroom reported either way. A boss
 * whose rows overflow the ceiling evicts the row he is about to play again
 * mid-fight.
 */
function gateWarmRowSize(build: RoosterBuild): void {
  const figure = ROOSTER_FIGURES[build];
  const cellBytes = figure.frameWidth * figure.frameHeight * BYTES_PER_PIXEL;
  const ceiling = figureByteBudgetFor(figure);
  const rowLimit = ceiling * ROW_SHARE_OF_FIGURE_BUDGET;
  let widestBase = '';
  let widestBytes = 0;
  let rowsMeasured = 0;
  for (const base of ROOSTER_RUNTIME_ROWS[build]) {
    const views = rowsOfBase(build, base);
    if (views.length !== ROOSTER_VIEWS.length) {
      fail(
        'G9',
        `${build}.${base} is painted in ${views.length} views, not ${ROOSTER_VIEWS.length}`,
      );
      continue;
    }
    rowsMeasured++;
    const bytes = views.reduce((sum, row) => sum + row.frameCount * cellBytes, 0);
    if (bytes > widestBytes) {
      widestBytes = bytes;
      widestBase = base;
    }
    if (bytes > rowLimit)
      fail(
        'G9',
        `${base} in its ${views.length} views warms to ${megabytes(bytes)} MB against ${megabytes(rowLimit)} MB`,
      );
  }
  failUnlessMeasured('G9', rowsMeasured, 'runtime rows');

  let statesMeasured = 0;
  let totalFrames = 0;
  for (const declared of figure.states.values()) {
    statesMeasured++;
    totalFrames += declared.frames;
  }
  failUnlessMeasured('G9', statesMeasured, 'declared states');
  const everything = totalFrames * cellBytes;
  console.log(
    `  G9 warm rows: ${widestBase} in all views is ${megabytes(widestBytes)} MB (limit ${megabytes(rowLimit)} MB); ` +
      `all ${statesMeasured} states warm are ${megabytes(everything)} MB of ${megabytes(ceiling)} MB, ` +
      `${megabytes(ceiling - everything)} MB headroom`,
  );
  if (everything > ceiling)
    fail(
      'G9',
      `all ${statesMeasured} states warm come to ${megabytes(everything)} MB against the figure ceiling of ${megabytes(ceiling)} MB`,
    );
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

function poseStream(
  build: RoosterBuild,
): Array<{ row: RowSpec; frame: number; pose: RoosterPose }> {
  return ROOSTER_ROWS[build].flatMap((row) =>
    Array.from({ length: row.frameCount }, (_unused, frame) => ({
      row,
      frame,
      pose: row.pose(frame),
    })),
  );
}

const FOOT_FORWARD_LIMIT = 0.002;
const CONTACT_ROLL_TOLERANCE = 0.02;
const FOOT_PLANTED_EPSILON = 0.001;

/** G10 — a planted foot rolls back at one constant rate and never forward: no moonwalk. */
function gateFootSlide(build: RoosterBuild): void {
  const travelling: readonly RoosterRowBase[] = ['walk', 'sprint', 'carry_walk'];
  let rows = 0;
  for (const row of ROOSTER_ROWS[build]) {
    if (row.view !== 'side' || !travelling.includes(row.base)) continue;
    rows++;
    for (const side of ['leftFoot', 'rightFoot'] as const) {
      let previous: number | null = null;
      let planted = 0;
      for (let i = 1; i < row.frameCount; i++) {
        const before = row.pose(i - 1)[side];
        const now = row.pose(i)[side];
        if (
          Math.abs(before.lift) > FOOT_PLANTED_EPSILON ||
          Math.abs(now.lift) > FOOT_PLANTED_EPSILON
        ) {
          previous = null;
          continue;
        }
        planted++;
        const step = now.forward - before.forward;
        if (step > FOOT_FORWARD_LIMIT)
          fail(
            'G10',
            `${row.name}'s ${side} moves ${step.toFixed(RIG_DIGITS)} forward while planted (frames ${i - 1}→${i})`,
          );
        if (previous !== null && Math.abs(step - previous) > CONTACT_ROLL_TOLERANCE) {
          fail(
            'G10',
            `${row.name}'s ${side} rolls unevenly: ${step.toFixed(RIG_DIGITS)} after ${previous.toFixed(RIG_DIGITS)}`,
          );
        }
        previous = step;
      }
      failUnlessMeasured('G10', planted, `planted frames of ${row.name}'s ${side}`);
    }
  }
  failUnlessMeasured('G10', rows, 'travelling profile rows');
  gateGaitKeepsUp(build);
}

/** The mob kind each build spawns as, for finding the levels it spawns at. */
const ROOSTER_MOB_KINDS: Readonly<Record<RoosterBuild, MobKind>> = {
  big: 'big_rooster',
  little: 'little_rooster',
  bent: 'slightly_bent_rooster',
};

/**
 * Every level band any floor gives `kind`, found by walking each `LevelDef`
 * for rules naming it, so a spawn added anywhere is counted. A floor that
 * slides its bands to meet the party can carry one up to its tracking ceiling.
 */
function spawnLevelsOf(kind: MobKind): number[] {
  const levels: number[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown, trackingCeiling: number): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, trackingCeiling);
      return;
    }
    if ('type' in value && value.type === kind) {
      const min = 'minLevel' in value && typeof value.minLevel === 'number' ? value.minLevel : 1;
      const max = 'maxLevel' in value && typeof value.maxLevel === 'number' ? value.maxLevel : min;
      levels.push(Math.min(Math.max(max, trackingCeiling), MAX_MOB_LEVEL));
    }
    for (const child of Object.values(value)) visit(child, trackingCeiling);
  };
  for (const def of allLevelDefs()) visit(def, def.ambientTracking?.maxLevel ?? 0);
  return levels;
}

/** How fast a build covers ground at `level`: walking at his fastest, and sprinting where he can. */
function levelledTravel(build: RoosterBuild, level: number): { walk: number; sprint: number } {
  if (build !== 'big') {
    const minion =
      build === 'little'
        ? new LittleRooster(0, 0, TILE_SIZE)
        : new SlightlyBentRooster(0, 0, TILE_SIZE);
    minion.applyMobLevel(level);
    return { walk: minion.moveSpeed, sprint: 0 };
  }
  const bigRooster = new BigRooster(0, 0, TILE_SIZE);
  bigRooster.applyMobLevel(level);
  // Enraging is his fastest walk; the same tick that enrages him sets it.
  bigRooster.hp = 1;
  bigRooster.updateAI([]);
  if (!bigRooster.isEnraged)
    fail('G10', 'a big rooster at 1 HP did not enrage, so his fastest walk is unmeasured');
  return { walk: bigRooster.moveSpeed, sprint: bigRooster.sprintSpeed };
}

/** Ticks a fresh animation clock at a steady speed and reports whether it ran. */
function clockRunsAt(build: RoosterBuild, speedPx: number): boolean {
  const clock = new RoosterAnimationClock(build, 0, 0, 0);
  for (let tick = 1; tick <= CLOCK_SETTLE_TICKS; tick++)
    clock.tick(tick * speedPx, 0, TILE_SIZE, true);
  return clock.running;
}

/** Ticks enough for the run's hysteresis to have settled at a steady speed. */
const CLOCK_SETTLE_TICKS = 4;
const SPEED_DIGITS = 3;

/**
 * G10, its runtime half — at the fastest the creature can travel at the highest
 * level any floor spawns it, its feet stay planted: the walk's one-frame-a-tick
 * ceiling holds his walk, or (for a build with a sprint row) he runs in the
 * sprint row and that row's ceiling holds both his walk and his sprint. Past a
 * row's ceiling the phase stops and the feet skate across the floor.
 */
function gateGaitKeepsUp(build: RoosterBuild): void {
  const levels = spawnLevelsOf(ROOSTER_MOB_KINDS[build]);
  failUnlessMeasured('G10', levels.length, `spawn rules for ${ROOSTER_MOB_KINDS[build]}`);
  if (levels.length === 0) return;
  const level = Math.max(...levels);
  const travel = levelledTravel(build, level);
  const walkCeiling = roosterGaitCeilingTilesPerTick(build, 'walk') * TILE_SIZE;
  const canRun = ROOSTER_RUNTIME_ROWS[build].includes('sprint');
  const px = (speed: number): string => speed.toFixed(SPEED_DIGITS);
  if (!canRun) {
    console.log(
      `  G10 gait at level ${level}: walks ${px(travel.walk)} px/tick of a ${px(walkCeiling)} ceiling`,
    );
    if (travel.walk > walkCeiling)
      fail(
        'G10',
        `at level ${level} the ${build} rooster walks ${px(travel.walk)} px a tick, past his walk's ${px(walkCeiling)} ceiling, and has no sprint row to run in`,
      );
    return;
  }
  const sprintCeiling = roosterGaitCeilingTilesPerTick(build, 'sprint') * TILE_SIZE;
  console.log(
    `  G10 gait at level ${level}: walks ${px(travel.walk)} and sprints ${px(travel.sprint)} px/tick; ceilings walk ${px(walkCeiling)}, sprint ${px(sprintCeiling)}`,
  );
  const fastest = Math.max(travel.walk, travel.sprint);
  if (fastest > sprintCeiling)
    fail(
      'G10',
      `at level ${level} the ${build} rooster travels ${px(fastest)} px a tick, past his sprint's ${px(sprintCeiling)} ceiling`,
    );
  if (travel.walk > walkCeiling && !clockRunsAt(build, travel.walk))
    fail(
      'G10',
      `at level ${level} the ${build} rooster walks ${px(travel.walk)} px a tick, past his walk's ${px(walkCeiling)} ceiling, and his clock does not switch him to the sprint row`,
    );
}

/** G11 — no leg is asked to reach past its own length on any frame: a clamp reads as a hop. */
function gateLegReach(build: RoosterBuild): void {
  const spec = ROOSTER_BUILD_SPECS[build];
  let worst = 0;
  let worstAt = '';
  let measured = 0;
  for (const { row, frame, pose } of poseStream(build)) {
    for (const side of ['left', 'right'] as const) {
      measured++;
      const reach = legReachDemand(pose, row.view, spec, side);
      if (reach > worst) {
        worst = reach;
        worstAt = `${row.name}[${frame}] ${side}`;
      }
      if (reach > LEG_MAX_REACH)
        fail(
          'G11',
          `${row.name}[${frame}]'s ${side} leg must span ${reach.toFixed(RIG_DIGITS)} against ${LEG_MAX_REACH.toFixed(RIG_DIGITS)}`,
        );
    }
  }
  failUnlessMeasured('G11', measured, 'legs');
  console.log(
    `  G11 leg reach: worst ${worst.toFixed(RIG_DIGITS)} of ${LEG_MAX_REACH.toFixed(RIG_DIGITS)} (${worstAt})`,
  );
}

const CLAMP_TOLERANCE = 0.0005;
const MIN_ELBOW_DEGREES = 20;

/** G12 — no elbow folds flat, and no arm reaching for a hand target falls short of it. */
function gateArmReach(build: RoosterBuild): void {
  const spec = ROOSTER_BUILD_SPECS[build];
  let elbows = 0;
  let ikArms = 0;
  for (const { row, frame, pose } of poseStream(build)) {
    const skeleton = buildRoosterSkeleton(pose, row.view, spec);
    for (const side of ['left', 'right'] as const) {
      const chain = side === 'left' ? skeleton.leftArm : skeleton.rightArm;
      const upper = Math.hypot(chain.joint.x - chain.root.x, chain.joint.y - chain.root.y);
      const lower = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
      const span = Math.hypot(chain.end.x - chain.root.x, chain.end.y - chain.root.y);
      const cosine = (upper * upper + lower * lower - span * span) / (2 * upper * lower);
      const elbow = Math.acos(Math.min(1, Math.max(-1, cosine))) * DEGREES_PER_RADIAN;
      elbows++;
      if (elbow < MIN_ELBOW_DEGREES)
        fail('G12', `${row.name}[${frame}]'s ${side} elbow folds to ${elbow.toFixed(1)}°`);
      const angles = side === 'left' ? pose.leftArmAngles : pose.rightArmAngles;
      if (angles !== null) continue;
      ikArms++;
      const drawnTarget = side === 'left' ? skeleton.leftHandTarget : skeleton.rightHandTarget;
      const short = Math.hypot(chain.end.x - drawnTarget.x, chain.end.y - drawnTarget.y);
      if (short > CLAMP_TOLERANCE)
        fail(
          'G12',
          `${row.name}[${frame}]'s ${side} hand target is out of reach by ${short.toFixed(RIG_DIGITS)}`,
        );
    }
  }
  failUnlessMeasured('G12', elbows, 'elbows');
  failUnlessMeasured('G12', ikArms, 'arms placed by a hand target');
}

/**
 * What each strike drives furthest on its impact frame, as a number to
 * maximise: the beak's reach from the hip on a peck, the fist's from the
 * shoulder on a punch, the fist's forward travel (or, head-on, its drop) on the
 * club, its reach from the hip at the throw's release, its drop on the slam and
 * the pickup, and the gape on the crow.
 */
function strikeMeasure(build: RoosterBuild, row: RowSpec, frame: number): number {
  const spec = ROOSTER_BUILD_SPECS[build];
  const pose = row.pose(frame);
  const skeleton = buildRoosterSkeleton(pose, row.view, spec);
  const fist = fistCentre(skeleton.rightArm);
  switch (row.base) {
    case 'idle':
    case 'walk':
    case 'sprint':
    case 'carry_walk':
      return 0;
    case 'peck': {
      // Edge-on the beak darts forward; head-on it darts at the camera, which
      // shows as the head dropping.
      const beak = beakTipOf(build, row.name, frame);
      return row.view === 'side' ? beak.x : beak.y;
    }
    case 'punch':
      // Head-on the fist drives at the camera, so its reach shows only as the
      // arm drawing shorter.
      return row.view === 'side' ? fist.x - skeleton.rightShoulder.x : 1 - pose.rightUpperArmScale;
    case 'club_swing': {
      // The arc's front: edge-on its furthest reach ahead, head-on where it
      // crosses in front of his middle. A turned body carries the arm across
      // the picture with its shoulder, so the carry comes off the fist first.
      if (row.view === 'side') return fist.x;
      const squareTarget = row.view === 'front' ? -pose.rightHand.x : pose.rightHand.x;
      const carry = skeleton.rightHandTarget.x - squareTarget;
      return -Math.abs(fist.x - carry - skeleton.hip.x);
    }
    case 'throw':
      // Released at full stretch: ahead edge-on, overhead head-on.
      return row.view === 'side' ? fist.x : -fist.y;
    case 'slam':
    case 'pickup':
      return fist.y;
    case 'crow':
      return pose.beakOpen - pose.headPitch;
  }
}

/** G13 — each strike peaks on the frame the shared timing table says it lands. */
function gateImpactIsThePeak(build: RoosterBuild): void {
  let measured = 0;
  for (const row of ROOSTER_ROWS[build]) {
    const impact = ROOSTER_ROW_TIMING[row.base].impactFrame;
    if (row.kind !== 'oneShot' || impact === undefined) continue;
    measured++;
    let peakFrame = 0;
    let peak = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const value = strikeMeasure(build, row, frame);
      if (value > peak + PEAK_TIE) {
        peak = value;
        peakFrame = frame;
      }
    }
    if (peakFrame !== impact)
      fail(
        'G13',
        `${row.name} peaks on frame ${peakFrame} but the timing table lands it on frame ${impact}`,
      );
  }
  failUnlessMeasured('G13', measured, 'timed one-shot rows');
}

const SPRINT_MIN_SHOULDER_LEAD = 0.16;
const SPRINT_MIN_HIP_DROP = 0.08;

/** G14 — the sprint leans: shoulders well ahead of the hips edge-on, hips low head-on. */
function gateSprintLeans(build: RoosterBuild): void {
  const spec = ROOSTER_BUILD_SPECS[build];
  let measured = 0;
  for (const row of rowsOfBase(build, 'sprint')) {
    const idle = rowNamed(build, roosterStateName('idle', row.view), 'G14');
    if (idle === null) continue;
    const idleHip = buildRoosterSkeleton(idle.pose(0), idle.view, spec).hip;
    for (let frame = 0; frame < row.frameCount; frame++) {
      measured++;
      const skeleton = buildRoosterSkeleton(row.pose(frame), row.view, spec);
      if (row.view === 'side') {
        const shoulder = (skeleton.leftShoulder.x + skeleton.rightShoulder.x) / 2;
        const lead = shoulder - skeleton.hip.x;
        if (lead < SPRINT_MIN_SHOULDER_LEAD)
          fail(
            'G14',
            `${row.name}[${frame}] carries its shoulders ${lead.toFixed(TILE_DIGITS)} ahead of its hips (floor ${SPRINT_MIN_SHOULDER_LEAD})`,
          );
      } else if (skeleton.hip.y - idleHip.y < SPRINT_MIN_HIP_DROP) {
        fail(
          'G14',
          `${row.name}[${frame}] keeps its hips within ${SPRINT_MIN_HIP_DROP} of the idle's`,
        );
      }
    }
  }
  if (build === 'big') failUnlessMeasured('G14', measured, 'sprint frames');
}

/**
 * G15 — the runtime's gore list matches the build's own pieces, element for
 * element and in order, and every build paints every piece.
 */
function gateGoreContract(build: RoosterBuild): void {
  const pieces = roosterGorePieces(build).map((piece) => piece.state);
  failUnlessMeasured('G15', pieces.length, `${build} gore pieces`);
  const matches =
    ROOSTER_GORE_PARTS.length === pieces.length &&
    ROOSTER_GORE_PARTS.every((part, i) => part === pieces[i]);
  if (!matches)
    fail(
      'G15',
      `ROOSTER_GORE_PARTS [${ROOSTER_GORE_PARTS.join(', ')}] is not the ${build} rooster's pieces [${pieces.join(', ')}]`,
    );
  for (const failure of missingStateFailures(
    ROOSTER_FIGURES[build],
    ROOSTER_GORE_PARTS,
    'ROOSTER_GORE_PARTS',
  ))
    fail('G15', failure);
}

/**
 * The window round an anchor searched for the fist's skin, in game pixels: a
 * little wider than a closed fist, so the whole hand falls inside it.
 */
const ANCHOR_WINDOW_GAME_PX = 7;
const ANCHOR_WINDOW_PX = ANCHOR_WINDOW_GAME_PX * CELL_PX_PER_GAME_PX;
/** The fewest skin pixels that count as a hand in the window, rather than a stray speck of shank. */
const MIN_HAND_GAME_PIXELS = 3;
const MIN_HAND_PIXELS = MIN_HAND_GAME_PIXELS * CELL_PX_PER_GAME_PX * CELL_PX_PER_GAME_PX;
/**
 * How far the middle of that skin may sit from the anchor, in game pixels: a
 * third of a fist across. The bar is drawn across the fist's middle, and an anchor
 * drifting toward its edge hangs the dumbbell off the knuckles.
 */
const ANCHOR_CENTRE_TOLERANCE_GAME_PX = 2.5;
const ANCHOR_CENTRE_TOLERANCE_PX = ANCHOR_CENTRE_TOLERANCE_GAME_PX * CELL_PX_PER_GAME_PX;
/** The fist's scaly skin: yellow, its green channel close to its red, little blue. */
const HAND_GREEN_OF_RED = 0.68;
const HAND_BLUE_OF_GREEN = 0.72;
const HAND_MIN_RED = 110;

function isHandSkin(data: Uint8ClampedArray, index: number): boolean {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const a = data[index + ALPHA_OFFSET];
  return (
    a >= SOLID_ALPHA &&
    r >= HAND_MIN_RED &&
    g >= r * HAND_GREEN_OF_RED &&
    b <= g * HAND_BLUE_OF_GREEN
  );
}

/**
 * G16 — on every frame the dumbbell is held, its anchor lies on the painted
 * fist: scaly yellow skin within half a fist of the point. A redraw that moves
 * the arm and leaves the anchor behind floats the weight in mid-air.
 */
function gateHandAnchors(build: RoosterBuild): void {
  if (build !== 'big') return;
  const figure = ROOSTER_FIGURES.big;
  let measured = 0;
  let hidden = 0;
  for (const [state, anchors] of BIG_ROOSTER_HAND_ANCHORS) {
    const row = rowNamed('big', state, 'G16');
    anchors.forEach((anchor, frame) => {
      if (anchor === null) return;
      // From behind, a fist swung across his front is hidden by his back, and
      // so is the dumbbell, which is drawn behind him there.
      if (row !== null && row.view === 'back' && row.pose(frame).rightArmBehind) {
        hidden++;
        return;
      }
      measured++;
      const data = cellRgba('big', state, frame);
      const cx = Math.round(figure.tileX + anchor.at.x * ROOSTER_TILE_SCALE);
      const cy = Math.round(figure.tileY + anchor.at.y * ROOSTER_TILE_SCALE);
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      for (let dy = -ANCHOR_WINDOW_PX; dy <= ANCHOR_WINDOW_PX; dy++) {
        for (let dx = -ANCHOR_WINDOW_PX; dx <= ANCHOR_WINDOW_PX; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= figure.frameWidth || y >= figure.frameHeight) continue;
          if (dx * dx + dy * dy > ANCHOR_WINDOW_PX * ANCHOR_WINDOW_PX) continue;
          if (!isHandSkin(data, (y * figure.frameWidth + x) * CHANNELS)) continue;
          count++;
          sumX += x;
          sumY += y;
        }
      }
      if (count < MIN_HAND_PIXELS) {
        fail(
          'G16',
          `${state}[${frame}]'s dumbbell anchor (${cx}, ${cy}) has only ${count} px of painted fist within ${ANCHOR_WINDOW_PX}px (floor ${MIN_HAND_PIXELS})`,
        );
        return;
      }
      const off = Math.hypot(sumX / count - cx, sumY / count - cy);
      if (off > ANCHOR_CENTRE_TOLERANCE_PX) {
        fail(
          'G16',
          `${state}[${frame}]'s dumbbell anchor sits ${off.toFixed(1)}px off the middle of the painted fist (limit ${ANCHOR_CENTRE_TOLERANCE_PX}px)`,
        );
      }
    });
  }
  failUnlessMeasured('G16', measured, 'held frames');
  if (hidden > 0)
    console.log(
      `  G16 hand anchors: ${measured} on a painted fist, ${hidden} hidden behind his back`,
    );
  for (const row of ROOSTER_ROWS.big) {
    if (DUMBBELL_HELD_FRAMES[row.base] === undefined) continue;
    if (!BIG_ROOSTER_HAND_ANCHORS.has(row.name))
      fail('G16', `no anchor table for held row ${row.name}`);
  }
}

/** G17 — every row the runtime asks this build for is painted in every view. */
function gateRuntimeStateNames(build: RoosterBuild): void {
  const names = ROOSTER_RUNTIME_ROWS[build].flatMap((base) =>
    ROOSTER_VIEWS.map((view) => roosterStateName(base, view)),
  );
  failUnlessMeasured('G17', names.length, 'runtime state names');
  for (const failure of missingStateFailures(
    ROOSTER_FIGURES[build],
    names,
    `ROOSTER_RUNTIME_ROWS.${build}`,
  ))
    fail('G17', failure);
}

/** G20 — each row paints as many pictures as frames it declares. */
function gateDistinctFrames(build: RoosterBuild): void {
  const report = distinctFrameFailures(ROOSTER_FIGURES[build], (state, frame) =>
    cellRgba(build, state, frame),
  );
  for (const message of report.failures) fail('G20', message);
  failUnlessMeasured('G20', report.framesMeasured, 'painted frames');
  if (report.closestNote !== null) console.log(`  G20 closest frames: ${report.closestNote}`);
}

/** A standing build's silhouette at the 32 px tile: how tall, and how far its head leans off its body. */
interface BuildRead {
  readonly heightPx: number;
  readonly headLeanPx: number;
  /** Solid pixels the head-on height was measured over. */
  readonly standingPixels: number;
  /** Comb-red pixels the lean was measured over, seen from behind. */
  readonly combPixels: number;
}

/** Comb-red: a strong red with little green or blue in it — nothing else on him is. */
const COMB_MIN_RED = 150;
const COMB_MAX_GREEN_SHARE = 0.45;
const COMB_MAX_BLUE_SHARE = 0.45;

function isCombRed(data: Uint8ClampedArray, index: number): boolean {
  const r = data[index];
  return (
    data[index + ALPHA_OFFSET] >= SOLID_ALPHA &&
    r >= COMB_MIN_RED &&
    data[index + 1] <= r * COMB_MAX_GREEN_SHARE &&
    data[index + 2] <= r * COMB_MAX_BLUE_SHARE
  );
}

/**
 * Where the build's head would sit seen from behind on a straight neck over an
 * upright body, in cell pixels across: the same pose solved with the build's
 * kink and lean taken out.
 */
function straightHeadPx(build: RoosterBuild, row: RowSpec): number {
  const spec = ROOSTER_BUILD_SPECS[build];
  const straight = { ...spec, carriage: { ...spec.carriage, neckKink: 0, bodyRoll: 0 } };
  const skeleton = buildRoosterSkeleton(row.pose(0), row.view, straight);
  const pxPerUnit = ROOSTER_CELLS[build].tilesPerUnit * ROOSTER_TILE_SCALE;
  return ROOSTER_FIGURES[build].frameWidth / 2 + skeleton.headCentre.x * pxPerUnit;
}

/**
 * How tall a build stands head-on, and how far his comb sits seen from behind
 * off where a straight neck would hold it — where every build's head is turned
 * nearly straight away, so only a kinked neck or a flopped comb carries it
 * aside. Measured against his own straight-necked head rather than the cell's
 * middle, because his body is turned and carries every build's head ahead of
 * his hips. The comb is found by its colour rather than as the top of the ink,
 * because the tail's fountain rises past the head from behind.
 */
function buildRead(build: RoosterBuild): BuildRead | null {
  const figure = ROOSTER_FIGURES[build];
  const away = rowNamed(build, 'idle_away', 'G21');
  if (away === null) return null;
  const alpha = cellAlpha(build, 'idle', 0);
  const stats = inkStatsOf(alpha, figure.frameWidth, SOLID_ALPHA);
  const back = cellRgba(build, away.name, 0);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < back.length / CHANNELS; i++) {
    if (!isCombRed(back, i * CHANNELS)) continue;
    sum += i % figure.frameWidth;
    count++;
  }
  const toGame = TILE_SIZE / ROOSTER_TILE_SCALE;
  const straightHead = straightHeadPx(build, away);
  return {
    heightPx: (stats.maxY - stats.minY + 1) * toGame,
    headLeanPx: count === 0 ? 0 : Math.abs(sum / count - straightHead) * toGame,
    standingPixels: stats.count,
    combPixels: count,
  };
}

/** At the tile the three must be told apart by size first: each a clear step taller than the next. */
const MIN_HEIGHT_STEP_PX = 6;
/** And Bent by his tilt: his head sits off his body's centre by at least this much more than the others'. */
const MIN_TILT_LEAD_PX = 1.5;

/** G21 — the three builds stay apart at the 32 px tile: by ink height, then by Bent's head tilt. */
function gateBuildDistinctness(): void {
  const reads = new Map(ROOSTER_BUILDS.map((build) => [build, buildRead(build)] as const));
  for (const [build, read] of reads) {
    if (read === null) continue;
    failUnlessMeasured('G21', read.standingPixels, `${build}'s head-on standing pixels`);
    failUnlessMeasured('G21', read.combPixels, `${build}'s comb pixels seen from behind`);
  }
  const big = reads.get('big');
  const little = reads.get('little');
  const bent = reads.get('bent');
  if (big === undefined || little === undefined || bent === undefined) return;
  if (big === null || little === null || bent === null) return;
  console.log(
    `  G21 builds at 32px: big ${big.heightPx.toFixed(1)}px tall, head lean ${big.headLeanPx.toFixed(1)}px; ` +
      `bent ${bent.heightPx.toFixed(1)} / ${bent.headLeanPx.toFixed(1)}; little ${little.heightPx.toFixed(1)} / ${little.headLeanPx.toFixed(1)}`,
  );
  if (big.heightPx - bent.heightPx < MIN_HEIGHT_STEP_PX)
    fail(
      'G21',
      `big stands only ${(big.heightPx - bent.heightPx).toFixed(1)}px taller than bent at the tile (floor ${MIN_HEIGHT_STEP_PX})`,
    );
  if (bent.heightPx - little.heightPx < MIN_HEIGHT_STEP_PX / 2)
    fail(
      'G21',
      `bent stands only ${(bent.heightPx - little.heightPx).toFixed(1)}px taller than little at the tile (floor ${MIN_HEIGHT_STEP_PX / 2})`,
    );
  const plainLean = Math.max(big.headLeanPx, little.headLeanPx);
  if (bent.headLeanPx - plainLean < MIN_TILT_LEAD_PX)
    fail(
      'G21',
      `bent's head sits ${bent.headLeanPx.toFixed(1)}px off his centre against ${plainLean.toFixed(1)}px for the others (lead floor ${MIN_TILT_LEAD_PX}px)`,
    );
}

/** G22 — facing the camera his right fist is on the viewer's left, carrying or not. */
function gateHandedness(build: RoosterBuild): void {
  const spec = ROOSTER_BUILD_SPECS[build];
  let measured = 0;
  for (const row of ROOSTER_ROWS[build]) {
    if (
      row.view !== 'front' ||
      (row.base !== 'idle' && row.base !== 'walk' && row.base !== 'carry_walk')
    )
      continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      measured++;
      const skeleton = buildRoosterSkeleton(row.pose(frame), row.view, spec);
      if (skeleton.rightArm.end.x >= skeleton.leftArm.end.x)
        fail('G22', `${row.name}[${frame}] puts his right fist on the viewer's right`);
    }
  }
  failUnlessMeasured('G22', measured, 'head-on standing and walking frames');
}

/** Runs every gate for one build and returns one message per failure. */
export function roosterGateFailures(build: RoosterBuild): string[] {
  failures.length = 0;
  gateStructure(build);
  gateAnchor(build);
  gateLoopClosure(build);
  gateMotionContinuity(build);
  gateCentroidDrift(build);
  gateOneShotSettle(build);
  gateGoreLegibility(build);
  gateGoreDistinctness(build);
  gateWarmRowSize(build);
  gateFootSlide(build);
  gateLegReach(build);
  gateArmReach(build);
  gateImpactIsThePeak(build);
  gateSprintLeans(build);
  gateGoreContract(build);
  gateHandAnchors(build);
  gateRuntimeStateNames(build);
  gateDistinctFrames(build);
  gateBuildDistinctness();
  gateHandedness(build);
  return [...failures];
}
