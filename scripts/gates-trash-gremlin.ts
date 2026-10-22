/**
 * The Trash Gremlin's art gates, and its bile's.
 *
 * The pixel gates measure cells painted from `TRASH_GREMLIN_FIGURE`,
 * `GREMLIN_BILE_ARC_FIGURE` and `GREMLIN_ACID_FIGURE`, baked exactly the way
 * the runtime cache bakes them, so what is measured is what the game blits. The
 * pose-stream gates measure the rig itself and need no pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing: a lookup
 * that quietly returns nothing turns a gate green while it measures nothing.
 *
 * Run by the review harness: `npm run render:trash-gremlin`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures as sharedDistinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { type FigureDef, figureStates } from '../src/sprites/figure/figureDef.js';
import {
  GORE_STATES,
  type RowSpec,
  SCURRY_GROUND_PER_CYCLE,
  SUMMON_EVENT_FRAME,
  TRASH_GREMLIN_FIGURE,
  TRASH_GREMLIN_ROWS,
  VOMIT_RELEASE_FRAME,
  paintPoseCell,
} from '../src/sprites/art/trashGremlinFigure.js';
import { type Pt, project } from '../src/sprites/art/trashGremlin/rig.js';
import {
  ARM_REACH,
  type GremlinPose,
  LEG_REACH,
  buildSkeleton,
  armReachDemand,
  legReachDemand,
  torsoOutlineCurvature,
} from '../src/sprites/art/trashGremlinArt.js';
import { TRASH_GREMLIN_RUNTIME_STATES } from '../src/sprites/trashGremlinSprite.js';
import {
  GAME_PIXELS_PER_AUTHORED_PIXEL,
  POOL_ANCHOR,
  POOL_FRAME_COUNT,
  POOL_FRAME_SIZE,
  RUNTIME_TILE_SIZE,
} from '../src/sprites/art/gremlinBileArt.js';
import {
  GREMLIN_ACID_FIGURE,
  GREMLIN_ACID_ROWS,
  GREMLIN_BILE_ARC_FIGURE,
  GREMLIN_BILE_ARC_ROWS,
} from '../src/sprites/art/gremlinBileFigure.js';
import {
  ACID_FADE_FRAMES,
  ACID_FORM_FRAMES,
  ACID_POOL_FRAMES,
  ACID_SPLASH_FRAMES,
  BILE_ARC_FRAMES,
} from '../src/sprites/gremlinBileSprite.js';

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KIBIBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const ALPHA_MAX = 255;
/** A pixel's centre, half a pixel in from its corner. */
const PIXEL_CENTRE = 0.5;
const PERCENT = 100;
/** Decimal places messages print: shares as percentages, tile lengths, and finer ratios. */
const PERCENT_DECIMALS = 2;
const TILE_DECIMALS = 4;
const RATIO_DECIMALS = 3;

/** A share of the cell as a percentage, for messages. */
function percent(share: number, decimals = PERCENT_DECIMALS): string {
  return (share * PERCENT).toFixed(decimals);
}

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/** Fails a gate whose filtered loop ran zero times. */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

interface Cell {
  readonly alpha: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

const rgbaCache = new Map<string, Uint8ClampedArray>();

/** One cell's full RGBA, baked as the runtime cache bakes it. */
function cellRgba(def: FigureDef, state: string, frame: number): Uint8ClampedArray {
  const key = `${def.id}/${state}[${frame}]`;
  const cached = rgbaCache.get(key);
  if (cached !== undefined) return cached;
  const { data } = bakeFigureCell(def, state, frame)
    .getContext('2d')
    .getImageData(0, 0, def.frameWidth, def.frameHeight);
  rgbaCache.set(key, data);
  return data;
}

const alphaCache = new Map<string, Cell>();

function cellAlpha(def: FigureDef, state: string, frame: number): Cell {
  const key = `${def.id}/${state}[${frame}]`;
  const cached = alphaCache.get(key);
  if (cached !== undefined) return cached;
  const data = cellRgba(def, state, frame);
  const alpha = new Uint8ClampedArray(def.frameWidth * def.frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  const cell: Cell = { alpha, width: def.frameWidth, height: def.frameHeight };
  alphaCache.set(key, cell);
  return cell;
}

/**
 * A one-shot starts from the crouch it interrupts and ends on the crouch it
 * hands back to, so its first and last frames are the same picture by design.
 * Only that exact pair is exempt.
 */
function endsOnItsStart(state: string, earlier: number, later: number): boolean {
  const row = TRASH_GREMLIN_ROWS.find((candidate) => candidate.name === state);
  return row?.kind === 'oneShot' && earlier === 0 && later === row.frameCount - 1;
}

/** The failures for a figure whose rows paint fewer pictures than they declare frames. */
function distinctFrameFailures(gateId: string, def: FigureDef): void {
  const report = sharedDistinctFrameFailures(def, (state, frame) => cellRgba(def, state, frame), {
    repeatsOnPurpose: endsOnItsStart,
  });
  for (const message of report.failures) fail(gateId, message);
  failUnlessMeasured(gateId, report.framesMeasured, `painted frames of ${def.id}`);
  if (report.closestNote !== null) console.log(`  ${gateId} closest frames: ${report.closestNote}`);
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

const EMPTY_INK: InkStats = {
  count: 0,
  centroidX: 0,
  centroidY: 0,
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
};

function inkStatsOf(cell: Cell, threshold = INK_ALPHA_THRESHOLD): InkStats {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (cell.alpha[y * cell.width + x] < threshold) continue;
      count++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return EMPTY_INK;
  return { count, centroidX: sumX / count, centroidY: sumY / count, minX, maxX, minY, maxY };
}

/** Share of pixels whose ink state differs between two cells. */
function frameDelta(a: Cell, b: Cell): number {
  let differing = 0;
  for (let i = 0; i < a.alpha.length; i++) {
    const inkedA = a.alpha[i] >= INK_ALPHA_THRESHOLD;
    const inkedB = b.alpha[i] >= INK_ALPHA_THRESHOLD;
    if (inkedA !== inkedB) differing++;
  }
  return differing / a.alpha.length;
}

function inkMass(cell: Cell): number {
  let total = 0;
  for (const value of cell.alpha) total += value;
  return total / ALPHA_MAX;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Every number a pose holds, walked rather than listed, so a pose axis added
 * tomorrow is in the comparison the day it is added.
 */
function poseNumbers(value: unknown, out: number[]): void {
  if (typeof value === 'number') {
    out.push(value);
    return;
  }
  if (typeof value === 'boolean') {
    out.push(value ? 1 : 0);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) poseNumbers(item, out);
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value).sort()) poseNumbers(value[key], out);
}

function poseDistance(a: GremlinPose, b: GremlinPose): number {
  const left: number[] = [];
  const right: number[] = [];
  poseNumbers(a, left);
  poseNumbers(b, right);
  if (left.length !== right.length) return Infinity;
  let total = 0;
  for (let i = 0; i < left.length; i++) total += (left[i] - right[i]) ** 2;
  return Math.sqrt(total);
}

// ── T1 structure ─────────────────────────────────────────────────────────────

/**
 * Every declared state paints every declared frame, nothing paints against the
 * cell edge, and the cell is not mostly empty. The gore states are exempt from
 * the fill check: a severed ear is meant to be small in a cell sized for the
 * whole creature.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(TRASH_GREMLIN_FIGURE, {
    sparseStates: GORE_STATES,
  })) {
    fail('T1', failure);
  }
}

// ── T2 anchor ────────────────────────────────────────────────────────────────

/**
 * Where its soles land inside its own tile, measured up from the tile's floor,
 * on solid ink — never ordinary ink, which the contact shadow answers wherever
 * the feet are. Measured against the frozen tile box the health bar is hung
 * off, never against the painter's own ground line, which moves with the art.
 *
 * The figure the gate paints is the game's own without its tail: from behind
 * the tail lies on the floor nearer the camera than the feet, so it is lower on
 * the screen than any sole and the lowest solid pixel would measure it instead.
 *
 * Each view has its own band, because the floor's depth puts a head-on foot's
 * toes below its heel and a back view's heel below its toes. Each band is the
 * spread its soles were measured over, frozen here, widened by a margin either
 * way: wide enough for a pose tweak, narrow enough that the ground line moving
 * by four pixels fails.
 */
const FRONT_SOLES_LOWEST_PX = -2;
const FRONT_SOLES_HIGHEST_PX = 2;
const SIDE_SOLES_LOWEST_PX = -2;
const SIDE_SOLES_HIGHEST_PX = 5;
const BACK_SOLES_LOWEST_PX = 1;
const BACK_SOLES_HIGHEST_PX = 6;
const SOLE_SPREADS: Readonly<Record<RowSpec['view'], readonly [number, number]>> = {
  front: [FRONT_SOLES_LOWEST_PX, FRONT_SOLES_HIGHEST_PX],
  side: [SIDE_SOLES_LOWEST_PX, SIDE_SOLES_HIGHEST_PX],
  back: [BACK_SOLES_LOWEST_PX, BACK_SOLES_HIGHEST_PX],
};
const SOLE_BAND_MARGIN_PX = 3;

function soleBandOf(view: RowSpec['view']): readonly [number, number] {
  const [low, high] = SOLE_SPREADS[view];
  return [low - SOLE_BAND_MARGIN_PX, high + SOLE_BAND_MARGIN_PX];
}

const TAILLESS_FIGURE: FigureDef = {
  ...TRASH_GREMLIN_FIGURE,
  id: 'trash_gremlin_soles',
  states: figureStates(
    Object.fromEntries(TRASH_GREMLIN_ROWS.map((row) => [row.name, row.frameCount])),
  ),
  paintFrame: (ctx, state, frame) => {
    const row = TRASH_GREMLIN_ROWS.find((candidate) => candidate.name === state);
    if (row !== undefined) paintPoseCell(ctx, row, frame, { tail: false });
  },
};

function gateAnchor(): void {
  const tileFloorY = TRASH_GREMLIN_FIGURE.tileY + TRASH_GREMLIN_FIGURE.tileScale;
  let framesMeasured = 0;
  const spread = new Map<string, [number, number]>();
  for (const row of TRASH_GREMLIN_ROWS) {
    const [low, high] = soleBandOf(row.view);
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = inkStatsOf(cellAlpha(TAILLESS_FIGURE, row.name, frame), SOLID_ALPHA_THRESHOLD);
      if (stats.count === 0) {
        fail('T2', `${row.name}[${frame}] has no solid ink at all`);
        continue;
      }
      framesMeasured++;
      const aboveFloor = tileFloorY - stats.maxY;
      const seen = spread.get(row.view) ?? [Infinity, -Infinity];
      spread.set(row.view, [Math.min(seen[0], aboveFloor), Math.max(seen[1], aboveFloor)]);
      if (aboveFloor < low || aboveFloor > high) {
        fail(
          'T2',
          `${row.name}[${frame}] paints its lowest solid pixel ${aboveFloor}px above its tile's ` +
            `floor at y=${tileFloorY}, outside the ${row.view} band ${low}–${high}px — it sinks ` +
            'into or floats over the floor the health bar is hung off',
        );
      }
    }
  }
  failUnlessMeasured('T2', framesMeasured, 'frames with solid ink');
  for (const [view, [low, high]] of spread)
    console.log(`  T2 ${view} soles ${low}–${high}px above the tile floor`);
}

// ── T3 loop closure, T4 motion continuity, T5 centroid drift ─────────────────

/**
 * The band a closing seam has to land in: a ceiling against the row's largest
 * ordinary step and a floor against its median. The ceiling catches a cycle
 * that overshoots its turn; the floor catches the last frame repeating the
 * first, which no ceiling can see.
 */
const LOOP_SEAM_CEILING = 1.15;
const LOOP_SEAM_FLOOR = 0.4;
/** The frame after the last must be the frame the row starts on, to rounding. */
const PHASE_TURN_TOLERANCE = 1e-6;
const LOOP_STEP_VS_MEDIAN = 2.6;
const ONE_SHOT_STEP_VS_MEDIAN = 4;
/** Deltas this small are noise; scaling them up finds a spike in a still row. */
const STEP_FLOOR_SHARE = 0.004;
const CENTROID_SEAM_VS_STEP = 1.6;
const CENTROID_SEAM_FLOOR_PX = 1.5;

/**
 * Frames where a snap is the point: the lunge that spits and the head thrown
 * back to shriek are meant to be the fastest things it does. Named here rather
 * than loosening every row's limit, which would hide a real pop elsewhere.
 */
function isDeclaredSpike(row: RowSpec, frame: number): boolean {
  return row.eventFrame !== null && (frame === row.eventFrame || frame === row.eventFrame + 1);
}

/**
 * How far one joint may jump between frames of a loop, against the row's
 * third-largest joint step. The silhouette measure above is dominated by the
 * body's mass, so a thin arm flung across one frame moves it less than the
 * whole body's sway does; following the joints themselves sees it.
 */
const JOINT_STEP_VS_THIRD = 2.2;
const THIRD_LARGEST = 2;

function jointsOf(row: RowSpec, frame: number): Pt[] {
  const sk = buildSkeleton(row.pose(frame));
  return [sk.leftArm.end, sk.rightArm.end, sk.leftLeg.end, sk.rightLeg.end, sk.head].map((joint) =>
    project(joint, row.view),
  );
}

function jointContinuityFailures(row: RowSpec): void {
  const frames = Array.from({ length: row.frameCount + 1 }, (_unused, frame) =>
    jointsOf(row, frame),
  );
  const steps: { frame: number; joint: number; step: number }[] = [];
  for (let frame = 1; frame <= row.frameCount; frame++) {
    frames[frame].forEach((joint, index) => {
      const before = frames[frame - 1][index];
      steps.push({ frame, joint: index, step: Math.hypot(joint.x - before.x, joint.y - before.y) });
    });
  }
  const sorted = steps.map((entry) => entry.step).sort((a, b) => b - a);
  const reference = sorted[THIRD_LARGEST] ?? 0;
  failUnlessMeasured('T4', steps.length, `joint steps of ${row.name}`);
  for (const entry of steps) {
    if (reference > 0 && entry.step > reference * JOINT_STEP_VS_THIRD) {
      fail(
        'T4',
        `${row.name}[${entry.frame % row.frameCount}] jumps joint ${entry.joint} ${entry.step.toFixed(RATIO_DECIMALS)} tiles, ` +
          `${(entry.step / reference).toFixed(2)}× the row's third-largest joint step (limit ${JOINT_STEP_VS_THIRD}×)`,
      );
    }
  }
}

function gateLoopsAndContinuity(): void {
  let worstStep = 0;
  let rowsMeasured = 0;
  let loopsMeasured = 0;
  for (const row of TRASH_GREMLIN_ROWS) {
    rowsMeasured++;
    const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
      cellAlpha(TRASH_GREMLIN_FIGURE, row.name, frame),
    );
    const steps: number[] = [];
    for (let frame = 1; frame < cells.length; frame++)
      steps.push(frameDelta(cells[frame - 1], cells[frame]));
    const typical = Math.max(median(steps), STEP_FLOOR_SHARE);
    const limit = row.kind === 'loop' ? LOOP_STEP_VS_MEDIAN : ONE_SHOT_STEP_VS_MEDIAN;
    steps.forEach((step, index) => {
      if (isDeclaredSpike(row, index + 1)) return;
      worstStep = Math.max(worstStep, step / typical);
      if (step > typical * limit) {
        fail(
          'T4',
          `${row.name} pops between frames ${index} and ${index + 1}: ${percent(step)}% ` +
            `of the cell changed against a median of ${percent(typical)}% (limit ${limit}x)`,
        );
      }
    });

    if (row.kind !== 'loop') continue;
    loopsMeasured++;
    jointContinuityFailures(row);

    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const largest = Math.max(...steps);
    const seamCeiling = Math.max(largest * LOOP_SEAM_CEILING, STEP_FLOOR_SHARE);
    if (seam > seamCeiling) {
      fail(
        'T3',
        `${row.name} does not close: the last-to-first step is ${percent(seam)}% of the ` +
          `cell against a largest ordinary step of ${percent(largest)}% ` +
          `(ceiling ${percent(seamCeiling)}%)`,
      );
    }
    if (seam < median(steps) * LOOP_SEAM_FLOOR) {
      fail(
        'T3',
        `${row.name} holds still across its seam: ${percent(seam)}% of the cell, only ` +
          `${(seam / median(steps)).toFixed(2)}× its median step (floor ${LOOP_SEAM_FLOOR}×)`,
      );
    }

    const poses = Array.from({ length: row.frameCount + 1 }, (_unused, frame) => row.pose(frame));
    const poseSteps: number[] = [];
    for (let frame = 1; frame < row.frameCount; frame++)
      poseSteps.push(poseDistance(poses[frame - 1], poses[frame]));
    const poseTypical = median(poseSteps);
    const pastTheEnd = poseDistance(poses[row.frameCount], poses[0]);
    if (poseTypical > 0 && pastTheEnd > poseTypical * PHASE_TURN_TOLERANCE) {
      fail(
        'T3',
        `${row.name}: the frame after the last is ${(pastTheEnd / poseTypical).toExponential(2)}× a ` +
          `median step from the frame the row starts on, so its ${row.frameCount} frames do not ` +
          'cover exactly one turn of the cycle',
      );
    }

    const centroids = cells.map((cell) => inkStatsOf(cell));
    const centroidSteps: number[] = [];
    for (let i = 1; i < centroids.length; i++) {
      centroidSteps.push(
        Math.hypot(
          centroids[i].centroidX - centroids[i - 1].centroidX,
          centroids[i].centroidY - centroids[i - 1].centroidY,
        ),
      );
    }
    const first = centroids[0];
    const last = centroids[centroids.length - 1];
    const centroidSeam = Math.hypot(
      last.centroidX - first.centroidX,
      last.centroidY - first.centroidY,
    );
    const seamLimit = Math.max(
      CENTROID_SEAM_FLOOR_PX,
      median(centroidSteps) * CENTROID_SEAM_VS_STEP,
    );
    if (centroidSeam > seamLimit) {
      fail(
        'T5',
        `${row.name} closes its loop ${centroidSeam.toFixed(2)}px from where it started, against a ` +
          `typical step of ${median(centroidSteps).toFixed(2)}px (limit ${seamLimit.toFixed(2)}px) — it moonwalks`,
      );
    }
  }
  failUnlessMeasured('T4', rowsMeasured, 'animation rows');
  console.log(`  T4 largest step against its row's median: ${worstStep.toFixed(2)}x`);
  failUnlessMeasured('T3', loopsMeasured, 'looping rows');
}

// ── T6/T7 gore ───────────────────────────────────────────────────────────────

/** A piece's cell scaled to the game's tile, the size a player sees it tumble at. */
const GORE_RUNTIME_SCALE = TILE_SIZE / TRASH_GREMLIN_FIGURE.tileScale;
const GORE_MIN_SHORT_AXIS_PX = 9;
const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function goreMask(state: string): boolean[] {
  const cell = cellAlpha(TRASH_GREMLIN_FIGURE, state, 0);
  const stats = inkStatsOf(cell);
  const mask = new Array<boolean>(DISTINCT_MASK * DISTINCT_MASK).fill(false);
  if (stats.count === 0) return mask;
  // Scale is normalised away but aspect is not: stretching each piece to fill
  // its own box maps every convex blob onto a square.
  const span = Math.max(stats.maxX - stats.minX, stats.maxY - stats.minY) + 1;
  const originX = (stats.minX + stats.maxX) / 2 - span / 2;
  const originY = (stats.minY + stats.maxY) / 2 - span / 2;
  for (let my = 0; my < DISTINCT_MASK; my++) {
    for (let mx = 0; mx < DISTINCT_MASK; mx++) {
      const x = Math.round(originX + ((mx + PIXEL_CENTRE) / DISTINCT_MASK) * span);
      const y = Math.round(originY + ((my + PIXEL_CENTRE) / DISTINCT_MASK) * span);
      const inside = x >= 0 && y >= 0 && x < cell.width && y < cell.height;
      mask[my * DISTINCT_MASK + mx] =
        inside && cell.alpha[y * cell.width + x] >= INK_ALPHA_THRESHOLD;
    }
  }
  return mask;
}

function gateGoreLegibility(): void {
  let piecesMeasured = 0;
  for (const state of GORE_STATES) {
    const stats = inkStatsOf(cellAlpha(TRASH_GREMLIN_FIGURE, state, 0));
    if (stats.count === 0) {
      fail('T6', `${state} painted nothing`);
      continue;
    }
    piecesMeasured++;
    const shortAxis =
      Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) * GORE_RUNTIME_SCALE;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'T6',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis on screen ` +
          `(limit ${GORE_MIN_SHORT_AXIS_PX}px) — it reads as a speck`,
      );
    }
  }
  failUnlessMeasured('T6', piecesMeasured, 'gore pieces');
}

function gateGoreDistinctness(): void {
  const masks = GORE_STATES.map((state) => goreMask(state));
  let pairsMeasured = 0;
  let closest = 0;
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      pairsMeasured++;
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < masks[a].length; i++) {
        if (masks[a][i] && masks[b][i]) intersection++;
        if (masks[a][i] || masks[b][i]) union++;
      }
      const iou = union === 0 ? 0 : intersection / union;
      closest = Math.max(closest, iou);
      if (iou > DISTINCT_IOU_LIMIT) {
        fail(
          'T7',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} share ${percent(iou, 0)}% of their ` +
            `silhouette (limit ${percent(DISTINCT_IOU_LIMIT, 0)}%) — they tumble as the same blob`,
        );
      }
    }
  }
  failUnlessMeasured('T7', pairsMeasured, 'pairs of gore pieces');
  console.log(`  T7 closest pair of gore silhouettes overlaps ${percent(closest, 0)}%`);
}

// ── T8 reach headroom, T9 foot slide ─────────────────────────────────────────

/**
 * A leg that clamps on even one frame reads as a hop: the leg locks dead
 * straight, the foot hangs off the floor and the next frame snaps it back. An
 * IK-placed arm that clamps the same way leaves its hand short of where the
 * row put it. Both read off the pose's demand, because the IK clamps.
 */
function gateReachHeadroom(): void {
  let legsMeasured = 0;
  let armsMeasured = 0;
  let worstLeg = 0;
  for (const row of TRASH_GREMLIN_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      const legs = legReachDemand(pose);
      for (const [side, span] of [
        ['left', legs.left],
        ['right', legs.right],
      ] as const) {
        legsMeasured++;
        worstLeg = Math.max(worstLeg, span);
        if (span > LEG_REACH) {
          fail(
            'T8',
            `${row.name}[${frame}] asks the ${side} leg for ${span.toFixed(TILE_DECIMALS)} against a reach of ` +
              `${LEG_REACH.toFixed(TILE_DECIMALS)} — the IK clamps and the step reads as a hop`,
          );
        }
      }
      const arms = armReachDemand(pose);
      for (const [side, span] of [
        ['left', arms.left],
        ['right', arms.right],
      ] as const) {
        if (span === null) continue;
        armsMeasured++;
        if (span > ARM_REACH) {
          fail(
            'T8',
            `${row.name}[${frame}] asks the ${side} arm for ${span.toFixed(TILE_DECIMALS)} against a reach of ` +
              `${ARM_REACH.toFixed(TILE_DECIMALS)} — the hand stops short of where the row put it`,
          );
        }
      }
    }
  }
  failUnlessMeasured('T8', legsMeasured, 'legs');
  failUnlessMeasured('T8', armsMeasured, 'IK-placed arms');
  console.log(
    `  T8 leg reach: worst frame asks ${worstLeg.toFixed(TILE_DECIMALS)} of ${LEG_REACH.toFixed(TILE_DECIMALS)} available`,
  );
}

/** How far a planted foot may drift over the floor between frames, in tiles. */
const FOOT_SLIDE_LIMIT = 0.002;
/** A lift this close to zero is a planted foot: compared against an epsilon, never for equality. */
const PLANTED_LIFT_EPSILON = 1e-6;

/**
 * A planted foot holds the floor: while it is down it slides back under the
 * body at exactly the rate the body is carried forward — the ground one cycle
 * covers, spread over its frames — so over the floor it does not move at all.
 * A foot that drifts either way skates or moonwalks, and no pixel measure sees
 * it. Measured on every locomotion row, both feet, the seam included.
 */
function gateFootSlide(): void {
  const rows = TRASH_GREMLIN_ROWS.filter((row) => row.locomotion);
  failUnlessMeasured('T9', rows.length, 'locomotion rows');
  for (const row of rows) {
    const travelPerFrame = SCURRY_GROUND_PER_CYCLE / row.frameCount;
    for (const side of ['left', 'right'] as const) {
      let plantedSteps = 0;
      let previous: number | null = null;
      for (let frame = 0; frame <= row.frameCount; frame++) {
        const pose = row.pose(frame);
        const foot = side === 'left' ? pose.leftFoot : pose.rightFoot;
        if (foot.y < -PLANTED_LIFT_EPSILON) {
          previous = null;
          continue;
        }
        if (previous !== null) {
          plantedSteps++;
          const drift = foot.z - previous + travelPerFrame;
          if (Math.abs(drift) > FOOT_SLIDE_LIMIT) {
            fail(
              'T9',
              `${row.name}[${frame}] moves the planted ${side} foot ${drift.toFixed(TILE_DECIMALS)} tiles over the ` +
                `floor (limit ${FOOT_SLIDE_LIMIT}) — it ${drift > 0 ? 'moonwalks' : 'skates'}`,
            );
          }
        }
        previous = foot.z;
      }
      failUnlessMeasured('T9', plantedSteps, `planted steps of ${row.name}'s ${side} foot`);
    }
  }
}

// ── T10 the torso's outline has no corners ───────────────────────────────────

/**
 * The tightest turn the torso's outline may take, in figure units: the
 * smallest offset any of its stations stands off the spine (the cap over the
 * neck). A turn tighter than the outline's own thinnest point is a fold, not a
 * curve, and stops reading as flesh.
 */
const MIN_OUTLINE_RADIUS = 0.035;

function gateSilhouetteCurvature(): void {
  let worstRadius = Infinity;
  let worstAt = '';
  let framesMeasured = 0;
  for (const row of TRASH_GREMLIN_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      framesMeasured++;
      const tightest = torsoOutlineCurvature(row.pose(frame), row.view);
      if (tightest.radius >= worstRadius) continue;
      worstRadius = tightest.radius;
      worstAt = `${row.name}[${frame}] at y ${tightest.y.toFixed(RATIO_DECIMALS)}`;
    }
  }
  failUnlessMeasured('T10', framesMeasured, 'posed frames');
  if (worstRadius < MIN_OUTLINE_RADIUS) {
    fail(
      'T10',
      `${worstAt} turns the torso inside ${worstRadius.toFixed(TILE_DECIMALS)} (limit ${MIN_OUTLINE_RADIUS}) — a corner, not a body`,
    );
    return;
  }
  console.log(
    `  T10 torso outline: tightest turn ${worstRadius.toFixed(TILE_DECIMALS)} of ${MIN_OUTLINE_RADIUS} at ${worstAt}`,
  );
}

// ── T11 the event frame is the peak ──────────────────────────────────────────

/**
 * A one-shot's event frame is the extreme of its motion. The spit's release has
 * the jaw at full gape and the most acid leaving its mouth; the summon's shriek
 * has the jaw at full gape and the head thrown furthest back. Off by a frame
 * and the acid leaves before the mouth opens, or the piles rustle while it is
 * still beating its chest.
 */
function peakFrame(row: RowSpec, measure: (pose: GremlinPose) => number): number {
  let best = 0;
  let bestValue = -Infinity;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const value = measure(row.pose(frame));
    if (value > bestValue) {
      bestValue = value;
      best = frame;
    }
  }
  return best;
}

function gateEventIsThePeak(): void {
  const checks: ReadonlyArray<{
    readonly action: RowSpec['action'];
    readonly frame: number;
    readonly measures: ReadonlyArray<{
      readonly what: string;
      readonly of: (pose: GremlinPose) => number;
    }>;
  }> = [
    {
      action: 'vomit',
      frame: VOMIT_RELEASE_FRAME,
      measures: [
        { what: 'gape', of: (pose) => pose.jaw },
        { what: 'spray', of: (pose) => pose.spew },
      ],
    },
    {
      action: 'summon',
      frame: SUMMON_EVENT_FRAME,
      measures: [
        { what: 'gape', of: (pose) => pose.jaw },
        { what: 'head thrown back', of: (pose) => -pose.headPitch },
      ],
    },
  ];
  for (const check of checks) {
    let measured = 0;
    const rows = TRASH_GREMLIN_ROWS.filter((row) => row.action === check.action);
    for (const row of rows) {
      for (const measure of check.measures) {
        measured++;
        const peak = peakFrame(row, measure.of);
        if (peak !== check.frame) {
          fail(
            'T11',
            `${row.name} peaks its ${measure.what} on frame ${peak}, not its event frame ${check.frame}`,
          );
        }
      }
    }
    failUnlessMeasured('T11', measured, `${check.action} event-frame peaks`);
  }
}

// ── T12 contracts with the runtime ───────────────────────────────────────────

/**
 * A state the runtime composes but the figure does not paint fails by drawing
 * nothing and saying nothing: `drawFigureCached` returns silently on it.
 */
function gateRuntimeContract(): void {
  for (const failure of missingStateFailures(
    TRASH_GREMLIN_FIGURE,
    TRASH_GREMLIN_RUNTIME_STATES,
    'trashGremlinSprite.ts runtime states',
  )) {
    fail('T12', failure);
  }
}

// ── T15 one-shots settle on the idle ─────────────────────────────────────────

/**
 * A one-shot starts from the idle it interrupts and hands back to it, so its
 * first and last frames each land on a pose of the idle cycle: no joint further
 * from the nearest idle frame than the matching view's idle moves a joint in
 * one frame, times this. Against the idle rather than the one-shot's own steps,
 * which are big enough to hide a whole skipped beat. Measured on the joints
 * (wrists, ankles, head) rather than on silhouette, because a pair of thin arms
 * snapping into place moves little ink against a whole body.
 */
const ONE_SHOT_SETTLE_VS_IDLE_STEP = 2.5;

function largestJointMove(a: readonly Pt[], b: readonly Pt[]): number {
  return Math.max(
    ...a.map((joint, index) => Math.hypot(joint.x - b[index].x, joint.y - b[index].y)),
  );
}

function gateOneShotSettle(): void {
  let endsMeasured = 0;
  let worstGap = '';
  let worstGapTiles = -1;
  for (const row of TRASH_GREMLIN_ROWS.filter((candidate) => candidate.kind === 'oneShot')) {
    const idle = TRASH_GREMLIN_ROWS.find(
      (candidate) => candidate.action === 'idle' && candidate.view === row.view,
    );
    if (idle === undefined) {
      fail('T15', `there is no ${row.view} idle for ${row.name} to settle on`);
      continue;
    }
    const frames = [0, row.frameCount - 1].map((frame) => jointsOf(row, frame));
    const idleFrames = Array.from({ length: idle.frameCount + 1 }, (_unused, frame) =>
      jointsOf(idle, frame),
    );
    let idleStep = 0;
    for (let frame = 1; frame < idleFrames.length; frame++) {
      idleStep = Math.max(idleStep, largestJointMove(idleFrames[frame - 1], idleFrames[frame]));
    }
    const limit = idleStep * ONE_SHOT_SETTLE_VS_IDLE_STEP;
    for (const [end, label] of [
      [0, 'starts'],
      [1, 'ends'],
    ] as const) {
      endsMeasured++;
      const gap = Math.min(
        ...idleFrames.slice(0, idle.frameCount).map((pose) => largestJointMove(frames[end], pose)),
      );
      if (gap > worstGapTiles) {
        worstGapTiles = gap;
        worstGap = `${row.name} ${label} ${gap.toFixed(TILE_DECIMALS)} of ${limit.toFixed(TILE_DECIMALS)}`;
      }
      if (gap > limit) {
        fail(
          'T15',
          `${row.name} ${label} ${gap.toFixed(TILE_DECIMALS)} tiles from the nearest idle pose at its furthest ` +
            `joint, against ${limit.toFixed(TILE_DECIMALS)} (${ONE_SHOT_SETTLE_VS_IDLE_STEP}× the ` +
            `${row.view} idle's largest step) — it snaps into or out of the idle`,
        );
      }
    }
  }
  failUnlessMeasured('T15', endsMeasured, 'one-shot ends');
  console.log(`  T15 furthest one-shot end from the idle: ${worstGap}`);
}

// ── T13 warm-row budget ──────────────────────────────────────────────────────

/**
 * The widest state's memory, reported whether or not it passes: a painted
 * figure is admitted to the cache one state at a time, gore pieces included.
 */
const ROW_BUDGET_MEGABYTES = 6;

function reportWarmRow(gateId: string, def: FigureDef): void {
  const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of def.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured(gateId, statesMeasured, `states of ${def.id}`);
  if (statesMeasured === 0) return;
  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarm = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  ${gateId} warm row: ${def.id}.${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ${allWarm.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      gateId,
      `${def.id}.${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

// ── B1–B8 the bile and the acid ──────────────────────────────────────────────

/** A frame carrying fewer visible pixels than this is effectively empty. */
const MIN_INK_PIXELS = 64;
/**
 * The band an effect loop's seam has to land in: ceiling against its largest
 * step, floor against its median. The pool closes at 0.928× its largest step
 * and the bolus at 0.902×; a pool row run over one and a half turns measures
 * 1.420×, so 1.15 separates them.
 */
const EFFECT_SEAM_CEILING = 1.15;
const EFFECT_SEAM_FLOOR = 0.4;

/**
 * Whether a pixel comparison can bound an effect row's seam from above at all.
 * The bolus's silhouette is a different scatter of chunks at every phase, so
 * its steps saturate and only the floor survives; the pool's boil advances one
 * wave across the disc, so its ratio moves the way the defect does.
 */
type EffectSeamBound = 'bounded-both-ways' | 'floor-only';
const MONOTONIC_SLACK = 0.03;

function gateEffectStructure(): void {
  for (const def of [GREMLIN_BILE_ARC_FIGURE, GREMLIN_ACID_FIGURE]) {
    for (const failure of figureStructuralFailures(def)) fail('B1', failure);
  }
}

function gateEffectInk(): void {
  let framesMeasured = 0;
  for (const def of [GREMLIN_BILE_ARC_FIGURE, GREMLIN_ACID_FIGURE]) {
    for (const [state, declared] of def.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        framesMeasured++;
        const count = inkStatsOf(cellAlpha(def, state, frame)).count;
        if (count < MIN_INK_PIXELS) {
          fail(
            'B2',
            `${def.id}.${state}[${frame}] carries ${count} visible pixels, minimum ${MIN_INK_PIXELS}`,
          );
        }
      }
    }
  }
  failUnlessMeasured('B2', framesMeasured, 'effect frames');
}

function gateEffectLoop(def: FigureDef, state: string, bound: EffectSeamBound): void {
  const declared = def.states.get(state);
  if (declared === undefined) {
    fail('B3', `${def.id} declares no state "${state}" to close a loop on`);
    return;
  }
  const cells = Array.from({ length: declared.frames }, (_unused, frame) =>
    cellAlpha(def, state, frame),
  );
  const steps: number[] = [];
  for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
  failUnlessMeasured('B3', steps.length, `steps of ${def.id}.${state}`);
  if (steps.length === 0) return;
  const typical = median(steps);
  const largest = Math.max(...steps);
  const seam = frameDelta(cells[cells.length - 1], cells[0]);
  if (bound === 'bounded-both-ways' && seam > largest * EFFECT_SEAM_CEILING) {
    fail(
      'B3',
      `${def.id}.${state} pops once per cycle: the seam is ${(seam / largest).toFixed(2)}× its largest step (ceiling ${EFFECT_SEAM_CEILING}×)`,
    );
  }
  if (typical > 0 && seam < typical * EFFECT_SEAM_FLOOR) {
    fail(
      'B3',
      `${def.id}.${state} holds still across its seam: ${(seam / typical).toFixed(2)}× its median step (floor ${EFFECT_SEAM_FLOOR}×)`,
    );
  }
}

interface EffectRowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly paint: (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    frame: number,
    frameCount: number,
  ) => void;
}

function paintEffectAlpha(def: FigureDef, row: EffectRowSpec, frame: number): Cell {
  const { frameWidth, frameHeight } = def;
  const canvas = createCanvas(frameWidth, frameHeight);
  const ctx = canvas.getContext('2d');
  row.paint(asGameContext(ctx), def.tileX, def.tileY, frame, row.frameCount);
  const { data } = ctx.getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  return { alpha, width: frameWidth, height: frameHeight };
}

/**
 * The frame after the last must repaint the frame the row starts on: the only
 * clause that bounds the bolus's cycle count. Rasterised, so the tolerance is a
 * share of a step — the bolus's shed droplets land 0.15 of a step apart at the
 * two ends of its track.
 */
const EFFECT_PHASE_TOLERANCE = 0.35;

function gateEffectCoversOneTurn(def: FigureDef, row: EffectRowSpec): void {
  const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
    paintEffectAlpha(def, row, frame),
  );
  const steps: number[] = [];
  for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
  failUnlessMeasured('B3', steps.length, `repainted steps of ${def.id}.${row.name}`);
  if (steps.length === 0) return;
  const typical = median(steps);
  const pastTheEnd = frameDelta(paintEffectAlpha(def, row, row.frameCount), cells[0]);
  if (typical > 0 && pastTheEnd > typical * EFFECT_PHASE_TOLERANCE) {
    fail(
      'B3',
      `${def.id}.${row.name}: the frame after the last is ${(pastTheEnd / typical).toFixed(RATIO_DECIMALS)}× a median step from the first — not exactly one turn`,
    );
  }
}

function gateEffectMonotonicMass(state: string, direction: 'grows' | 'shrinks'): void {
  const declared = GREMLIN_ACID_FIGURE.states.get(state);
  if (declared === undefined) {
    fail('B4', `the acid figure declares no state "${state}"`);
    return;
  }
  const masses = Array.from({ length: declared.frames }, (_unused, frame) =>
    inkMass(cellAlpha(GREMLIN_ACID_FIGURE, state, frame)),
  );
  let stepsMeasured = 0;
  for (let i = 0; i + 1 < masses.length; i++) {
    stepsMeasured++;
    const allowed =
      direction === 'grows' ? masses[i] * (1 - MONOTONIC_SLACK) : masses[i] * (1 + MONOTONIC_SLACK);
    const broken = direction === 'grows' ? masses[i + 1] < allowed : masses[i + 1] > allowed;
    if (broken) {
      fail(
        'B4',
        `${state} must ${direction}, but frame ${i} carries ${masses[i].toFixed(0)} and frame ${i + 1} ${masses[i + 1].toFixed(0)}`,
      );
    }
  }
  failUnlessMeasured('B4', stepsMeasured, `steps of ${state}`);
}

/** How far short of the damage radius the pool's thinnest bearing may fall. */
const POOL_COVERAGE_TOLERANCE_GAME_PX = 2;
/** How far past the damage radius the longest runnel may reach. */
const MAX_POOL_OVERREACH_GAME_PX = 12;
const FOOTPRINT_BEARINGS = 360;
const FOOTPRINT_ALPHA_THRESHOLD = 64;
const BOSS_ROOM_PATH = 'src/systems/BossRoomSystem.ts';
const BILE_SPRITE_PATH = 'src/sprites/gremlinBileSprite.ts';

function sourceOf(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

/**
 * The damage radius the pool is painted to cover, read out of the system that
 * applies it, so widening the hazard without the art turns this red.
 */
function damageRadiusGamePx(): number | null {
  const match = /ACID_PUDDLE_RADIUS\s*=\s*TILE_SIZE\s*\*\s*(\d+(?:\.\d+)?)\s*;/.exec(
    sourceOf(BOSS_ROOM_PATH),
  );
  if (match === null) return null;
  return RUNTIME_TILE_SIZE * Number(match[1]);
}

function gatePoolFootprint(): void {
  const target = damageRadiusGamePx();
  if (target === null) {
    fail('B5', `${BOSS_ROOM_PATH} does not declare ACID_PUDDLE_RADIUS as a multiple of TILE_SIZE`);
    return;
  }
  let shortest = Infinity;
  let widest = 0;
  let framesMeasured = 0;
  for (let frame = 0; frame < POOL_FRAME_COUNT; frame++) {
    framesMeasured++;
    const cell = cellAlpha(GREMLIN_ACID_FIGURE, 'pool', frame);
    const reachByBearing = new Float64Array(FOOTPRINT_BEARINGS);
    for (let y = 0; y < POOL_FRAME_SIZE; y++) {
      for (let x = 0; x < POOL_FRAME_SIZE; x++) {
        if (cell.alpha[y * POOL_FRAME_SIZE + x] < FOOTPRINT_ALPHA_THRESHOLD) continue;
        const dx = x + PIXEL_CENTRE - POOL_ANCHOR;
        const dy = y + PIXEL_CENTRE - POOL_ANCHOR;
        const distance = Math.hypot(dx, dy);
        widest = Math.max(widest, distance);
        const bucket =
          Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * FOOTPRINT_BEARINGS) %
          FOOTPRINT_BEARINGS;
        reachByBearing[bucket] = Math.max(reachByBearing[bucket], distance);
      }
    }
    shortest = Math.min(shortest, ...reachByBearing);
  }
  failUnlessMeasured('B5', framesMeasured, 'pool frames');
  const shortestGame = shortest * GAME_PIXELS_PER_AUTHORED_PIXEL;
  const widestGame = widest * GAME_PIXELS_PER_AUTHORED_PIXEL;
  if (shortestGame < target - POOL_COVERAGE_TOLERANCE_GAME_PX) {
    fail(
      'B5',
      `the pool's shortest reach is ${shortestGame.toFixed(1)} game px but it damages out to ${target}`,
    );
  }
  if (widestGame > target + MAX_POOL_OVERREACH_GAME_PX) {
    fail(
      'B5',
      `the pool draws out to ${widestGame.toFixed(1)} game px against a ${target} px damage radius`,
    );
  }
}

/** Every state name the bile sprite's draw and warm calls ask one of its figures for. */
function statesDrawnFrom(source: string, figureName: string): string[] {
  const call = new RegExp(
    `(?:drawFigureCached|prewarmFigureState)\\(\\s*(?:ctx,\\s*)?${figureName},\\s*'([^']+)'`,
    'g',
  );
  return [...source.matchAll(call)].map((match) => match[1]);
}

function gateBileRuntimeContract(): void {
  const declared: ReadonlyArray<{
    readonly name: string;
    readonly count: number;
    readonly def: FigureDef;
    readonly state: string;
  }> = [
    { name: 'BILE_ARC_FRAMES', count: BILE_ARC_FRAMES, def: GREMLIN_BILE_ARC_FIGURE, state: 'arc' },
    {
      name: 'ACID_SPLASH_FRAMES',
      count: ACID_SPLASH_FRAMES,
      def: GREMLIN_ACID_FIGURE,
      state: 'splash',
    },
    { name: 'ACID_FORM_FRAMES', count: ACID_FORM_FRAMES, def: GREMLIN_ACID_FIGURE, state: 'form' },
    { name: 'ACID_POOL_FRAMES', count: ACID_POOL_FRAMES, def: GREMLIN_ACID_FIGURE, state: 'pool' },
    { name: 'ACID_FADE_FRAMES', count: ACID_FADE_FRAMES, def: GREMLIN_ACID_FIGURE, state: 'fade' },
  ];
  let namesMeasured = 0;
  for (const { name, count, def, state } of declared) {
    namesMeasured++;
    const painted = def.states.get(state)?.frames ?? 0;
    if (painted !== count) {
      fail(
        'B7',
        `${def.id}.${state} paints ${painted} frames where the runtime's ${name} declares ${count}`,
      );
    }
  }
  failUnlessMeasured('B7', namesMeasured, 'declared effect row lengths');
  const source = sourceOf(BILE_SPRITE_PATH);
  for (const [figureName, def] of [
    ['GREMLIN_BILE_ARC_FIGURE', GREMLIN_BILE_ARC_FIGURE],
    ['GREMLIN_ACID_FIGURE', GREMLIN_ACID_FIGURE],
  ] as const) {
    for (const failure of missingStateFailures(
      def,
      statesDrawnFrom(source, figureName),
      `${BILE_SPRITE_PATH}'s ${figureName} calls`,
    )) {
      fail('B7', failure);
    }
  }
}

// ── Runners ──────────────────────────────────────────────────────────────────

/** Runs every gate on the Trash Gremlin itself and returns one message per failure. */
export function trashGremlinGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateAnchor();
  gateLoopsAndContinuity();
  gateGoreLegibility();
  gateGoreDistinctness();
  gateReachHeadroom();
  gateFootSlide();
  gateSilhouetteCurvature();
  gateEventIsThePeak();
  gateRuntimeContract();
  reportWarmRow('T13', TRASH_GREMLIN_FIGURE);
  distinctFrameFailures('T14', TRASH_GREMLIN_FIGURE);
  gateOneShotSettle();
  return [...failures];
}

/** Runs every gate on the bolus and the acid pool. */
export function gremlinBileGateFailures(): string[] {
  failures.length = 0;
  gateEffectStructure();
  gateEffectInk();
  gateEffectLoop(GREMLIN_BILE_ARC_FIGURE, 'arc', 'floor-only');
  gateEffectLoop(GREMLIN_ACID_FIGURE, 'pool', 'bounded-both-ways');
  for (const row of GREMLIN_BILE_ARC_ROWS) gateEffectCoversOneTurn(GREMLIN_BILE_ARC_FIGURE, row);
  for (const row of GREMLIN_ACID_ROWS) {
    if (row.name !== 'pool') continue;
    gateEffectCoversOneTurn(GREMLIN_ACID_FIGURE, row);
  }
  gateEffectMonotonicMass('form', 'grows');
  gateEffectMonotonicMass('fade', 'shrinks');
  gatePoolFootprint();
  gateBileRuntimeContract();
  reportWarmRow('B6', GREMLIN_BILE_ARC_FIGURE);
  reportWarmRow('B6', GREMLIN_ACID_FIGURE);
  distinctFrameFailures('B8', GREMLIN_BILE_ARC_FIGURE);
  distinctFrameFailures('B8', GREMLIN_ACID_FIGURE);
  return [...failures];
}
