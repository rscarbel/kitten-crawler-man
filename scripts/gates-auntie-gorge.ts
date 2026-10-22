/**
 * Auntie Gorge's art gates.
 *
 * These gates enforce sheet-shape invariants directly against cells painted
 * from `AUNTIE_GORGE_FIGURE`, baked exactly the way the runtime cache bakes them, supersampled and
 * downsampled, so what is measured is what the game blits. The pose-stream
 * gates measure the rig itself and need no pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing: a lookup
 * that quietly returns nothing turns a whole gate module green while measuring
 * nothing.
 *
 * Run by the review harness: `npm run render:auntie-gorge`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures as sharedDistinctFrameFailures,
  figureStructuralFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  GORE_RECENTRE,
  GORE_STATES,
  GORE_UNIT,
  AUNTIE_GORGE_FIGURE,
  AUNTIE_GORGE_ROWS,
  type RowSpec,
  HEAVE_RELEASE_FRAME,
} from '../src/shelf/auntieGorge/auntieGorgeFigure.js';
import { auntieGorgeGorePieces } from '../src/shelf/auntieGorge/auntieGorgeGore.js';
import {
  type AuntieGorgePose,
  LEG_REACH,
  legReachDemand,
  torsoOutlineCurvature,
} from '../src/shelf/auntieGorge/auntieGorgeArt.js';

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const PERCENT = 100;
/** Decimal places a share of the cell is reported to, as a percentage. */
const PERCENT_DIGITS = 2;
/** Decimal places a pose-space length (a reach, a slide, a radius) is reported to. */
const POSE_DIGITS = 4;
/** Decimal places a figure-space height is reported to. */
const HEIGHT_DIGITS = 3;
/** Samples a mask cell at its centre rather than its corner. */
const CELL_CENTRE = 0.5;

/** A share of the cell as a percentage string. */
function percentOf(share: number, digits = PERCENT_DIGITS): string {
  return (share * PERCENT).toFixed(digits);
}

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — planted frames only, looping
 * rows only, one entry per painted piece — and a narrowing that matches nothing
 * leaves a green gate that examined nothing. Every filtering loop here counts
 * what it looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

interface Cell {
  readonly alpha: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

const cellCache = new Map<string, Cell>();

/** One cell's alpha channel, baked as the runtime cache bakes it. */
function cellAlpha(def: FigureDef, state: string, frame: number): Cell {
  const key = `${def.id}/${state}[${frame}]`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const { frameWidth, frameHeight } = def;
  const baked = bakeFigureCell(def, state, frame);
  const { data } = baked.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  const cell: Cell = { alpha, width: frameWidth, height: frameHeight };
  cellCache.set(key, cell);
  return cell;
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

/**
 * The failures for a figure whose rows paint fewer pictures than they declare
 * frames.
 *
 * A row whose every pose term rides the same sine of the cycle paints six
 * frames as four pictures, and hanging one small term off a different phase
 * makes the six frames six *files* that still look like four — a held pair can
 * differ by a hair's width inside the head box. That is why the floor this
 * measures against is perceptual rather than a hash. What separates her idle
 * frames is the weight shift in `auntieGorgeFigure.ts`.
 */
function distinctFrameFailures(gateId: string, def: FigureDef): void {
  const report = sharedDistinctFrameFailures(def, (state, frame) => cellRgba(def, state, frame));
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
 * Every number a pose holds, walked rather than listed.
 *
 * A hand-written list of fields is the shape where a renamed or newly added
 * pose axis silently stops being measured and the gate goes green having looked
 * at less than it did yesterday. Walking the object means a new axis is in the
 * comparison the day it is added.
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

function poseDistance(a: AuntieGorgePose, b: AuntieGorgePose): number {
  const left: number[] = [];
  const right: number[] = [];
  poseNumbers(a, left);
  poseNumbers(b, right);
  if (left.length !== right.length) return Infinity;
  let total = 0;
  for (let i = 0; i < left.length; i++) total += (left[i] - right[i]) ** 2;
  return Math.sqrt(total);
}

/**
 * The row a gate names, or null after recording a failure.
 *
 * Every one of these names is a string literal written here rather than in
 * `AUNTIE_GORGE_ROWS`, so renaming a row would otherwise turn its gate into a silent
 * no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = AUNTIE_GORGE_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `there is no row named "${name}" to measure`);
    return null;
  }
  return row;
}

// ── G1 structure ─────────────────────────────────────────────────────────────

/**
 * The shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly
 * empty. The gore states are exempt from the fill check — a severed forearm is
 * meant to be small inside a cell sized for a 3.6-tile creature.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(AUNTIE_GORGE_FIGURE, {
    sparseStates: GORE_STATES,
  })) {
    fail('G1', failure);
  }
}

// ── G2 anchor ────────────────────────────────────────────────────────────────

/**
 * Where her soles have to land inside her own tile, measured up from the tile's
 * floor.
 *
 * Against the *tile*, never against the painter's own ground line. The painter
 * takes its pose origin from `TILE_Y + GROUND_OFFSET_PX`, so a gate reading that
 * same expression moves with it and passes for any value of either constant. The tile
 * is frozen geometry the health bar and the aggro marker are hung off, which is
 * what makes it an independent thing to measure against, and `GROUND_OFFSET_PX`
 * is then a number the gate can actually see move.
 *
 * The band is 2–10px around her 5–6px: her feet vary by one pixel across
 * every frame of every row, so anything wider would be slack for its own sake,
 * and this catches the ground offset moving by four pixels in either direction.
 *
 * Measured against solid alpha, never ordinary ink: she paints a contact shadow
 * on the ground line wherever her feet actually are, so a lowest-ink check
 * measures the shadow and stays green while she floats.
 */
const SOLES_ABOVE_TILE_FLOOR_MIN_PX = 2;
const SOLES_ABOVE_TILE_FLOOR_MAX_PX = 10;

function gateAnchor(): void {
  const tileFloorY = AUNTIE_GORGE_FIGURE.tileY + AUNTIE_GORGE_FIGURE.tileScale;
  let framesMeasured = 0;
  for (const row of AUNTIE_GORGE_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = inkStatsOf(
        cellAlpha(AUNTIE_GORGE_FIGURE, row.name, frame),
        SOLID_ALPHA_THRESHOLD,
      );
      if (stats.count === 0) {
        fail('G2', `${row.name}[${frame}] has no solid ink at all`);
        continue;
      }
      framesMeasured++;
      const aboveFloor = tileFloorY - stats.maxY;
      if (aboveFloor < SOLES_ABOVE_TILE_FLOOR_MIN_PX) {
        fail(
          'G2',
          `${row.name}[${frame}] paints its lowest solid pixel ${aboveFloor}px above her tile's ` +
            `floor at y=${tileFloorY}, at or through it (minimum ` +
            `${SOLES_ABOVE_TILE_FLOOR_MIN_PX}px)`,
        );
      }
      if (aboveFloor > SOLES_ABOVE_TILE_FLOOR_MAX_PX) {
        fail(
          'G2',
          `${row.name}[${frame}] paints its lowest solid pixel ${aboveFloor}px above her tile's ` +
            `floor at y=${tileFloorY}, past a limit of ${SOLES_ABOVE_TILE_FLOOR_MAX_PX}px — she ` +
            'floats over the flagstones the health bar is hung off',
        );
      }
    }
  }
  failUnlessMeasured('G2', framesMeasured, 'frames with solid ink');
}

// ── G3 loop closure, G4 motion continuity, G5 centroid drift ─────────────────

/**
 * The band a closing seam has to land in, as a multiple of the row's own steps.
 *
 * The ceiling is against the row's largest ordinary step and the floor against
 * its median, and they are different on purpose. Her cycles step unevenly, so
 * the median sits down among the small steps and a healthy seam already measures
 * up to 1.07× it, so a ceiling hung off the median has to sit far above the
 * art before it stops firing on healthy rows, and then catches nothing. Against the
 * largest step her six loop rows close between 0.554× and 1.000× (the walks near
 * 0.85, the idles at exactly 1.000, where the seam *is* the largest step), so
 * 1.15 is a real bound on a cycle that overshoots its turn.
 *
 * The floor catches the opposite defect, which no ceiling can see: sampling at
 * `frame / (frameCount - 1)` instead of `frame / frameCount` makes the last
 * frame identical to the first, drops the seam to zero and holds the cycle still
 * for a whole frame. Its denominator has to be the median rather than the
 * narrowest step, which a row with two byte-identical adjacent frames would
 * collapse to zero; against the median her rows run 0.961–1.067×, so
 * 0.4 is far clear of the art.
 */
const LOOP_SEAM_CEILING = 1.15;
const LOOP_SEAM_FLOOR = 0.4;

/**
 * How far the pose one frame past the end of a loop may sit from the pose the
 * loop starts on, as a share of the row's median pose-space step.
 *
 * This is the gate on the phase mapping itself, and it is the only clause here
 * that can see how much of a turn the row actually covers. A ratio between the
 * seam and the row's own pixel steps cannot: a row sampled over one and a half
 * turns still wraps by a plausible-looking amount, and a pixel difference
 * saturates once the silhouette has moved off itself, so on some figures the
 * over-run reads as a *cleaner* loop than her art. Asking the row for
 * the frame after its last one and requiring it to be the frame it started on
 * pins the mapping exactly: `frame / frameCount` lands on phase 1, which every
 * pose function here answers identically to phase 0, while
 * `(frame * 1.5) / frameCount` lands on phase 1.5 and `frame / (frameCount - 1)`
 * on phase `n/(n-1)`.
 *
 * A numerical tolerance rather than an equality: her rows land within
 * 1e-16 of their own start, which is floating-point noise in a sine, so 1e-6 is
 * ten orders of magnitude of slack and still nowhere near any real motion.
 *
 * What it cannot see: a row sampled over a whole number of turns greater than
 * one, because phase 2 and phase 0 are the same pose. Her idle rows are in fact
 * two beats of a three-frame cycle by construction, so no half-period test can
 * be added to close that off without failing her art.
 */
const PHASE_TURN_TOLERANCE = 1e-6;
const LOOP_STEP_VS_MEDIAN = 2.6;
const ONE_SHOT_STEP_VS_MEDIAN = 4;
/** Deltas this small are noise; scaling them up finds a spike in a still row. */
const STEP_FLOOR_SHARE = 0.004;
/**
 * The last frame of a cycle is one step short of the first, not identical to
 * it, so the seam is only drift when it is larger than a step. Comparing the
 * two centroids against a flat pixel limit measures the sway amplitude instead.
 */
const CENTROID_SEAM_VS_STEP = 1.6;
const CENTROID_SEAM_FLOOR_PX = 1.5;

/**
 * Frames where a snap is the point. A heave is a violent motion and the release
 * frame is meant to be the fastest thing she does; the alternative is loosening
 * the limit for every row, which would hide a real pop somewhere else.
 */
const DECLARED_SPIKES: ReadonlyArray<{ readonly row: string; readonly frame: number }> = [
  { row: 'heave', frame: HEAVE_RELEASE_FRAME },
  { row: 'heave_side', frame: HEAVE_RELEASE_FRAME },
  { row: 'heave_back', frame: HEAVE_RELEASE_FRAME },
];

function isDeclaredSpike(rowName: string, frame: number): boolean {
  return DECLARED_SPIKES.some((spike) => spike.row === rowName && spike.frame === frame);
}

function gateLoopsAndContinuity(): void {
  let rowsMeasured = 0;
  let loopsMeasured = 0;
  for (const row of AUNTIE_GORGE_ROWS) {
    rowsMeasured++;
    const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
      cellAlpha(AUNTIE_GORGE_FIGURE, row.name, frame),
    );
    const steps: number[] = [];
    for (let frame = 1; frame < cells.length; frame++) {
      steps.push(frameDelta(cells[frame - 1], cells[frame]));
    }
    const typical = Math.max(median(steps), STEP_FLOOR_SHARE);
    const limit = row.kind === 'loop' ? LOOP_STEP_VS_MEDIAN : ONE_SHOT_STEP_VS_MEDIAN;
    steps.forEach((step, index) => {
      if (isDeclaredSpike(row.name, index + 1)) return;
      if (step > typical * limit) {
        fail(
          'G4',
          `${row.name} pops between frames ${index} and ${index + 1}: ` +
            `${percentOf(step)}% of the cell changed against a median of ` +
            `${percentOf(typical)}% (limit ${limit}x)`,
        );
      }
    });

    if (row.kind !== 'loop') continue;
    loopsMeasured++;

    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    // The noise floor still floors the ceiling: a row that barely moves at all
    // makes any ratio a measurement of antialiasing rather than of motion.
    const seamCeiling = Math.max(Math.max(...steps) * LOOP_SEAM_CEILING, STEP_FLOOR_SHARE);
    if (seam > seamCeiling) {
      fail(
        'G3',
        `${row.name} does not close: the last-to-first step is ${percentOf(seam)}% of ` +
          `the cell against a largest ordinary step of ${percentOf(Math.max(...steps))}% ` +
          `(ceiling ${percentOf(seamCeiling)}%)`,
      );
    }
    if (seam < median(steps) * LOOP_SEAM_FLOOR) {
      fail(
        'G3',
        `${row.name} holds still across its seam: the last-to-first step is ` +
          `${percentOf(seam)}% of the cell, only ` +
          `${(seam / median(steps)).toFixed(2)}× its median step (floor ${LOOP_SEAM_FLOOR}×) — ` +
          'the last frame all but repeats the first instead of leading back into it',
      );
    }

    const poses = Array.from({ length: row.frameCount + 1 }, (_unused, frame) => row.pose(frame));
    const poseSteps: number[] = [];
    for (let frame = 1; frame < row.frameCount; frame++) {
      poseSteps.push(poseDistance(poses[frame - 1], poses[frame]));
    }
    const poseTypical = median(poseSteps);
    const pastTheEnd = poseDistance(poses[row.frameCount], poses[0]);
    if (poseTypical > 0 && pastTheEnd > poseTypical * PHASE_TURN_TOLERANCE) {
      fail(
        'G3',
        `${row.name}: the frame after the last one is ` +
          `${(pastTheEnd / poseTypical).toExponential(2)}× a median step away from the frame the ` +
          `row starts on, so the ${row.frameCount} frames do not cover exactly one turn of the ` +
          'cycle',
      );
    }

    const centroids = cells.map((cell) => inkStatsOf(cell));
    const first = centroids[0];
    const last = centroids[centroids.length - 1];
    const centroidSteps: number[] = [];
    for (let i = 1; i < centroids.length; i++) {
      centroidSteps.push(
        Math.hypot(
          centroids[i].centroidX - centroids[i - 1].centroidX,
          centroids[i].centroidY - centroids[i - 1].centroidY,
        ),
      );
    }
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
        'G5',
        `${row.name} closes its loop ${centroidSeam.toFixed(2)}px away from where it started, ` +
          `against a typical step of ${median(centroidSteps).toFixed(2)}px ` +
          `(limit ${seamLimit.toFixed(2)}px) — she moonwalks`,
      );
    }
  }
  failUnlessMeasured('G4', rowsMeasured, 'animation rows');
  failUnlessMeasured('G3', loopsMeasured, 'looping rows');
}

// ── G6/G7 gore ───────────────────────────────────────────────────────────────

/** The runtime draws body parts at half size; a piece has to survive that. */
const GORE_RUNTIME_SCALE = 0.5;
const GORE_MIN_SHORT_AXIS_PX = 9;
const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function goreMask(state: string): boolean[] {
  const cell = cellAlpha(AUNTIE_GORGE_FIGURE, state, 0);
  const stats = inkStatsOf(cell);
  const mask = new Array<boolean>(DISTINCT_MASK * DISTINCT_MASK).fill(false);
  if (stats.count === 0) return mask;
  // Scale is normalised away but aspect is not: stretching each piece to fill
  // its own bounding box maps every convex blob onto a filled square, which
  // measures the normalisation rather than the art.
  const span = Math.max(stats.maxX - stats.minX, stats.maxY - stats.minY) + 1;
  const originX = (stats.minX + stats.maxX) / 2 - span / 2;
  const originY = (stats.minY + stats.maxY) / 2 - span / 2;
  for (let my = 0; my < DISTINCT_MASK; my++) {
    for (let mx = 0; mx < DISTINCT_MASK; mx++) {
      const x = Math.round(originX + ((mx + CELL_CENTRE) / DISTINCT_MASK) * span);
      const y = Math.round(originY + ((my + CELL_CENTRE) / DISTINCT_MASK) * span);
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
    const stats = inkStatsOf(cellAlpha(AUNTIE_GORGE_FIGURE, state, 0));
    if (stats.count === 0) {
      fail('G6', `${state} painted nothing`);
      continue;
    }
    piecesMeasured++;
    const shortAxis =
      Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) * GORE_RUNTIME_SCALE;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'G6',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis on screen ` +
          `(limit ${GORE_MIN_SHORT_AXIS_PX}px) — it reads as a speck`,
      );
    }
  }
  failUnlessMeasured('G6', piecesMeasured, 'gore pieces');
}

function gateGoreDistinctness(): void {
  const masks = GORE_STATES.map((state) => goreMask(state));
  let pairsMeasured = 0;
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      pairsMeasured++;
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < masks[a].length; i++) {
        const inA = masks[a][i];
        const inB = masks[b][i];
        if (inA && inB) intersection++;
        if (inA || inB) union++;
      }
      const iou = union === 0 ? 0 : intersection / union;
      if (iou > DISTINCT_IOU_LIMIT) {
        fail(
          'G7',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} share ${percentOf(iou, 0)}% of their ` +
            `silhouette (limit ${percentOf(DISTINCT_IOU_LIMIT, 0)}%) — they tumble as the ` +
            'same blob',
        );
      }
    }
  }
  failUnlessMeasured('G7', pairsMeasured, 'pairs of gore pieces');
}

// ── G8 reach headroom, G9 foot slide ─────────────────────────────────────────

/**
 * A stride that clamps on even one frame reads as a hop: the leg locks dead
 * straight, the foot hangs off the floor and the next tuck snaps it back.
 *
 * The demand is read off the pose rather than off the solved chain: the IK
 * clamps, so a gate reading the chain can only ever measure equality.
 */
function gateReachHeadroom(): void {
  let legsMeasured = 0;
  let worst = 0;
  for (const row of AUNTIE_GORGE_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const demand = legReachDemand(row.pose(frame), row.view);
      for (const [side, span] of [
        ['left', demand.left],
        ['right', demand.right],
      ] as const) {
        legsMeasured++;
        worst = Math.max(worst, span);
        if (span > LEG_REACH) {
          fail(
            'G8',
            `${row.name}[${frame}] asks the ${side} leg for ${span.toFixed(POSE_DIGITS)} against a reach ` +
              `of ${LEG_REACH.toFixed(POSE_DIGITS)} — the IK clamps and the step reads as a hop`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G8', legsMeasured, 'legs');
  console.log(
    `  G8 leg reach: worst frame asks ${worst.toFixed(POSE_DIGITS)} of ${LEG_REACH.toFixed(POSE_DIGITS)} available`,
  );
}

/** How far a planted foot may move between frames, in figure units. */
const FOOT_SLIDE_LIMIT = 0.002;
/**
 * Compared against an epsilon rather than for equality with zero: a lift that
 * starts returning `1e-17` instead of `0` empties the filter, and the gate then
 * measures nothing while reporting a pass.
 */
const PLANTED_LIFT_EPSILON = 1e-6;

/**
 * A planted foot must not move sideways, and a foot sliding backward under a
 * moving body must step monotonically. Both are the same defect seen twice —
 * the moonwalk — and neither shows up in any pixel measurement.
 */
function gateFootSlide(): void {
  const row = rowNamed('walk_side', 'G9');
  if (row === null) return;
  let plantedSteps = 0;
  let previousX: number | null = null;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const here = row.pose(frame);
    if (here.rightFoot.y < -PLANTED_LIFT_EPSILON) {
      previousX = null;
      continue;
    }
    if (previousX !== null) {
      plantedSteps++;
      const step = here.rightFoot.x - previousX;
      // Stance travel is backward by construction; a forward step is the foot
      // being dragged along with the body, which is exactly the moonwalk.
      if (step > FOOT_SLIDE_LIMIT) {
        fail(
          'G9',
          `walk_side[${frame}] drags the planted right foot forward by ${step.toFixed(POSE_DIGITS)} ` +
            `(limit ${FOOT_SLIDE_LIMIT})`,
        );
      }
    }
    previousX = here.rightFoot.x;
  }
  failUnlessMeasured('G9', plantedSteps, "planted steps of walk_side's right foot");
}

// ── G10 the silhouette has no corners ────────────────────────────────────────

/**
 * The tightest turn the flesh outline is allowed, in figure units. Roughly a
 * seventh of her half-width: a fat body is a stack of long shallow arcs, and
 * anything much tighter than this stops reading as flesh and starts reading as
 * a fold in cardboard.
 */
const MIN_OUTLINE_RADIUS = 0.1;

function gateSilhouetteCurvature(): void {
  let worstRadius = Infinity;
  let worstAt = '';
  let worstY = 0;
  let framesMeasured = 0;
  for (const row of AUNTIE_GORGE_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      framesMeasured++;
      const tightest = torsoOutlineCurvature(row.pose(frame), row.view);
      if (tightest.radius >= worstRadius) continue;
      worstRadius = tightest.radius;
      worstAt = `${row.name}[${frame}]`;
      worstY = tightest.y;
    }
  }
  failUnlessMeasured('G10', framesMeasured, 'posed frames');
  if (framesMeasured === 0) return;
  if (worstRadius < MIN_OUTLINE_RADIUS) {
    fail(
      'G10',
      `${worstAt} turns the silhouette inside ${worstRadius.toFixed(POSE_DIGITS)} at y ` +
        `${worstY.toFixed(HEIGHT_DIGITS)} (limit ${MIN_OUTLINE_RADIUS}) — that is a corner, not a body`,
    );
    return;
  }
  console.log(
    `  G10 silhouette: tightest turn ${worstRadius.toFixed(POSE_DIGITS)} of ${MIN_OUTLINE_RADIUS} ` +
      `at ${worstAt}, y ${worstY.toFixed(HEIGHT_DIGITS)}`,
  );
}

// ── G11 the release is the peak ──────────────────────────────────────────────

/**
 * Her jaw opens widest on the exact frame the spittle leaves her. Off by one and
 * the spray appears before her mouth is open, or after she has begun to sag.
 */
function gateReleaseIsThePeak(): void {
  const heaveRows = AUNTIE_GORGE_ROWS.filter((row) => row.name.startsWith('heave'));
  failUnlessMeasured('G11', heaveRows.length, 'heave rows');
  for (const row of heaveRows) {
    let peakFrame = 0;
    let peakGape = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const gape = row.pose(frame).mouth;
      if (gape > peakGape) {
        peakGape = gape;
        peakFrame = frame;
      }
    }
    if (peakFrame !== HEAVE_RELEASE_FRAME) {
      fail(
        'G11',
        `${row.name} opens widest on frame ${peakFrame} but the heave peaks on frame ` +
          `${HEAVE_RELEASE_FRAME} — the spittle leaves before or after her jaw drops`,
      );
    }
  }
}

// ── G12 warm-row budget ──────────────────────────────────────────────────────

/**
 * The widest warm row's memory, reported whether or not it passes.
 *
 * A painted figure is admitted to the cache one state at a time, so the number
 * that decides whether she fits is her widest state's bytes, not the sum of
 * every state. Measured over every state she declares, gore pieces included — the
 * cache does not know a severed arm from a walk cycle, and a scan of the pose
 * rows alone leaves the single-frame states out of her memory accounting
 * entirely.
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
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarm.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      gateId,
      `${def.id}.${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

// ── G13 the frozen gore recentring still describes the pieces ────────────────

/**
 * The offsets are the one number in the figure that cannot be computed where it
 * is used: `BodyPartGoreSystem` spins a piece about the centre of its ink, and
 * finding that centre means painting the piece and reading the pixels back.
 * They are frozen in the figure module and re-measured here, so a redrawn piece
 * cannot silently start orbiting.
 *
 * Checked in both directions. A frozen offset with no piece left to own it is a
 * dead entry that reads like a maintained measurement, and the next agent to
 * add a piece by that name inherits a number measured off art that is gone.
 */
const GORE_MEASURE_SPAN = 640;
const GORE_MEASURE_ORIGIN = GORE_MEASURE_SPAN / 2;
/** A fifth of a sheet pixel at the unit the pieces are painted in. */
const GORE_RECENTRE_TOLERANCE = 0.002;

function gateGoreRecentre(): void {
  const canvas = createCanvas(GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  const pieces = auntieGorgeGorePieces();
  const paintedStates = new Set(pieces.map((piece) => piece.state));
  for (const frozenState of GORE_RECENTRE.keys()) {
    if (paintedStates.has(frozenState)) continue;
    fail(
      'G13',
      `GORE_RECENTRE freezes an offset for "${frozenState}", which nothing paints any more`,
    );
  }
  let piecesMeasured = 0;
  for (const piece of pieces) {
    piecesMeasured++;
    ctx.clearRect(0, 0, GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
    ctx.save();
    ctx.translate(GORE_MEASURE_ORIGIN, GORE_MEASURE_ORIGIN);
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(asGameContext(ctx));
    ctx.restore();
    const { data } = ctx.getImageData(0, 0, GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
    let minX = GORE_MEASURE_SPAN;
    let maxX = -1;
    let minY = GORE_MEASURE_SPAN;
    let maxY = -1;
    for (let y = 0; y < GORE_MEASURE_SPAN; y++) {
      for (let x = 0; x < GORE_MEASURE_SPAN; x++) {
        if (data[(y * GORE_MEASURE_SPAN + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) {
          continue;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) {
      fail('G13', `${piece.state} painted nothing at all when measured about its own centre`);
      continue;
    }
    const measuredX = (GORE_MEASURE_ORIGIN - (minX + maxX) / 2) / GORE_UNIT;
    const measuredY = (GORE_MEASURE_ORIGIN - (minY + maxY) / 2) / GORE_UNIT;
    const frozen = GORE_RECENTRE.get(piece.state);
    if (frozen === undefined) {
      fail('G13', `the figure freezes no recentring offset for ${piece.state}`);
      continue;
    }
    const gap = Math.hypot(measuredX - frozen.x, measuredY - frozen.y);
    if (gap > GORE_RECENTRE_TOLERANCE) {
      fail(
        'G13',
        `${piece.state}'s ink centres at (${measuredX}, ${measuredY}) but GORE_RECENTRE freezes ` +
          `(${frozen.x}, ${frozen.y}) — the piece will orbit rather than tumble; paste the ` +
          'measured pair',
      );
    }
  }
  failUnlessMeasured('G13', piecesMeasured, 'gore pieces');
}

// ── Runners ──────────────────────────────────────────────────────────────────

/** Runs every gate on Auntie Gorge herself and returns one message per failure. */
export function auntieGorgeGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateAnchor();
  gateLoopsAndContinuity();
  gateGoreLegibility();
  gateGoreDistinctness();
  gateReachHeadroom();
  gateFootSlide();
  gateSilhouetteCurvature();
  gateReleaseIsThePeak();
  reportWarmRow('G12', AUNTIE_GORGE_FIGURE);
  gateGoreRecentre();
  distinctFrameFailures('G14', AUNTIE_GORGE_FIGURE);
  return [...failures];
}
