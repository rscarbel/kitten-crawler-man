/**
 * The Hoarder's art gates, and her bile's.
 *
 * She has no baked sheet to inspect any more, so every invariant the old bake
 * gates enforced against sheet pixels is enforced here against cells painted
 * from `HOARDER_FIGURE`, `HOARDER_BILE_ARC_FIGURE` and `HOARDER_ACID_FIGURE` —
 * baked exactly the way the runtime cache bakes them, supersampled and
 * downsampled, so what is measured is what the game blits. The pose-stream
 * gates measure the rig itself and need no pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing: a lookup
 * that quietly returns nothing turns a whole gate module green while measuring
 * nothing.
 *
 * Run by the review harness: `npm run render:hoarder`.
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
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  GORE_RECENTRE,
  GORE_STATES,
  GORE_UNIT,
  HOARDER_FIGURE,
  HOARDER_ROWS,
  type RowSpec,
  VOMIT_RELEASE_FRAME,
} from '../src/sprites/art/hoarderFigure.js';
import { hoarderGorePieces } from '../src/sprites/art/hoarderGore.js';
import {
  type HoarderPose,
  LEG_REACH,
  legReachDemand,
  torsoOutlineCurvature,
} from '../src/sprites/art/hoarderArt.js';
import {
  GAME_PIXELS_PER_AUTHORED_PIXEL,
  POOL_ANCHOR,
  POOL_FRAME_COUNT,
  POOL_FRAME_SIZE,
  RUNTIME_TILE_SIZE,
} from '../src/sprites/art/hoarderBileArt.js';
import {
  HOARDER_ACID_FIGURE,
  HOARDER_ACID_ROWS,
  HOARDER_BILE_ARC_FIGURE,
  HOARDER_BILE_ARC_ROWS,
} from '../src/sprites/art/hoarderBileFigure.js';

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

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
 * Her idles shipped as four pictures for six frames head-on and edge-on and
 * three from behind, because every term of the pose rode the same sine of the
 * cycle. Hanging her hair a quarter turn behind the breath made the six frames
 * six *files* and left them the same four pictures — the difference between a
 * held pair was a hair's width inside the head box — which is why the floor
 * this measures against is perceptual rather than a hash. What actually
 * separated them is the weight shift in `hoarderFigure.ts`.
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

/** Total coverage in a cell, as a sum of alpha rather than a thresholded count. */
function inkMass(cell: Cell): number {
  let total = 0;
  for (const value of cell.alpha) total += value;
  return total / 255;
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

function poseDistance(a: HoarderPose, b: HoarderPose): number {
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
 * `HOARDER_ROWS`, so renaming a row would otherwise turn its gate into a silent
 * no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = HOARDER_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `there is no row named "${name}" to measure`);
    return null;
  }
  return row;
}

// ── H1 structure ─────────────────────────────────────────────────────────────

/**
 * The shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly
 * empty. The gore states are exempt from the fill check — a severed forearm is
 * meant to be small inside a cell sized for a 3.6-tile creature.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(HOARDER_FIGURE, { sparseStates: GORE_STATES })) {
    fail('H1', failure);
  }
}

// ── H2 anchor ────────────────────────────────────────────────────────────────

/**
 * Where her soles have to land inside her own tile, measured up from the tile's
 * floor.
 *
 * Against the *tile*, never against the painter's own ground line. Those two
 * were the same expression — the gate read `tileY + GROUND_OFFSET_PX` and the
 * painter takes its pose origin from `TILE_Y + GROUND_OFFSET_PX` — so both sides
 * moved together and the gate passed for any value of either constant. The tile
 * is frozen geometry the health bar and the aggro marker are hung off, which is
 * what makes it an independent thing to measure against, and `GROUND_OFFSET_PX`
 * is then a number the gate can actually see move.
 *
 * The band is 2–10px around a shipped 5–6px: her feet vary by one pixel across
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
  const tileFloorY = HOARDER_FIGURE.tileY + HOARDER_FIGURE.tileScale;
  let framesMeasured = 0;
  for (const row of HOARDER_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = inkStatsOf(cellAlpha(HOARDER_FIGURE, row.name, frame), SOLID_ALPHA_THRESHOLD);
      if (stats.count === 0) {
        fail('H2', `${row.name}[${frame}] has no solid ink at all`);
        continue;
      }
      framesMeasured++;
      const aboveFloor = tileFloorY - stats.maxY;
      if (aboveFloor < SOLES_ABOVE_TILE_FLOOR_MIN_PX) {
        fail(
          'H2',
          `${row.name}[${frame}] paints its lowest solid pixel ${aboveFloor}px above her tile's ` +
            `floor at y=${tileFloorY}, at or through it (minimum ` +
            `${SOLES_ABOVE_TILE_FLOOR_MIN_PX}px)`,
        );
      }
      if (aboveFloor > SOLES_ABOVE_TILE_FLOOR_MAX_PX) {
        fail(
          'H2',
          `${row.name}[${frame}] paints its lowest solid pixel ${aboveFloor}px above her tile's ` +
            `floor at y=${tileFloorY}, past a limit of ${SOLES_ABOVE_TILE_FLOOR_MAX_PX}px — she ` +
            'floats over the flagstones the health bar is hung off',
        );
      }
    }
  }
  failUnlessMeasured('H2', framesMeasured, 'frames with solid ink');
}

// ── H3 loop closure, H4 motion continuity, H5 centroid drift ─────────────────

/**
 * The band a closing seam has to land in, as a multiple of the row's own steps.
 *
 * The ceiling is against the row's largest ordinary step and the floor against
 * its median, and they are different on purpose. Her cycles step unevenly, so
 * the median sits down among the small steps and a healthy seam already measures
 * up to 1.07× it — a ceiling hung off the median cannot be tightened past the
 * art, which is what the 2.1× this replaces turned out to be. Against the
 * largest step her six loop rows close between 0.554× and 1.000× (the walks near
 * 0.85, the idles at exactly 1.000, where the seam *is* the largest step), so
 * 1.15 is a real bound on a cycle that overshoots its turn.
 *
 * The floor catches the opposite defect, which no ceiling can see: sampling at
 * `frame / (frameCount - 1)` instead of `frame / frameCount` makes the last
 * frame identical to the first, drops the seam to zero and holds the cycle still
 * for a whole frame. Its denominator has to be the median rather than the
 * narrowest step, which a row with two byte-identical adjacent frames would
 * collapse to zero; against the median the shipped rows run 0.961–1.067×, so
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
 * over-run reads as a *cleaner* loop than the shipped art. Asking the row for
 * the frame after its last one and requiring it to be the frame it started on
 * pins the mapping exactly: `frame / frameCount` lands on phase 1, which every
 * pose function here answers identically to phase 0, while
 * `(frame * 1.5) / frameCount` lands on phase 1.5 and `frame / (frameCount - 1)`
 * on phase `n/(n-1)`.
 *
 * A numerical tolerance rather than an equality: the shipped rows land within
 * 1e-16 of their own start, which is floating-point noise in a sine, so 1e-6 is
 * ten orders of magnitude of slack and still nowhere near any real motion.
 *
 * What it cannot see: a row sampled over a whole number of turns greater than
 * one, because phase 2 and phase 0 are the same pose. Her idle rows are in fact
 * two beats of a three-frame cycle by construction, so no half-period test can
 * be added to close that off without failing shipped art.
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
 * Frames where a snap is the point. A vomit is a violent motion and the release
 * frame is meant to be the fastest thing she does; the alternative is loosening
 * the limit for every row, which would hide a real pop somewhere else.
 */
const DECLARED_SPIKES: ReadonlyArray<{ readonly row: string; readonly frame: number }> = [
  { row: 'vomit', frame: VOMIT_RELEASE_FRAME },
  { row: 'vomit_side', frame: VOMIT_RELEASE_FRAME },
  { row: 'vomit_back', frame: VOMIT_RELEASE_FRAME },
];

function isDeclaredSpike(rowName: string, frame: number): boolean {
  return DECLARED_SPIKES.some((spike) => spike.row === rowName && spike.frame === frame);
}

function gateLoopsAndContinuity(): void {
  let rowsMeasured = 0;
  let loopsMeasured = 0;
  for (const row of HOARDER_ROWS) {
    rowsMeasured++;
    const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
      cellAlpha(HOARDER_FIGURE, row.name, frame),
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
          'H4',
          `${row.name} pops between frames ${index} and ${index + 1}: ` +
            `${(step * 100).toFixed(2)}% of the cell changed against a median of ` +
            `${(typical * 100).toFixed(2)}% (limit ${limit}x)`,
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
        'H3',
        `${row.name} does not close: the last-to-first step is ${(seam * 100).toFixed(2)}% of ` +
          `the cell against a largest ordinary step of ${(Math.max(...steps) * 100).toFixed(2)}% ` +
          `(ceiling ${(seamCeiling * 100).toFixed(2)}%)`,
      );
    }
    if (seam < median(steps) * LOOP_SEAM_FLOOR) {
      fail(
        'H3',
        `${row.name} holds still across its seam: the last-to-first step is ` +
          `${(seam * 100).toFixed(2)}% of the cell, only ` +
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
        'H3',
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
        'H5',
        `${row.name} closes its loop ${centroidSeam.toFixed(2)}px away from where it started, ` +
          `against a typical step of ${median(centroidSteps).toFixed(2)}px ` +
          `(limit ${seamLimit.toFixed(2)}px) — she moonwalks`,
      );
    }
  }
  failUnlessMeasured('H4', rowsMeasured, 'animation rows');
  failUnlessMeasured('H3', loopsMeasured, 'looping rows');
}

// ── H6/H7 gore ───────────────────────────────────────────────────────────────

/** The runtime draws body parts at half size; a piece has to survive that. */
const GORE_RUNTIME_SCALE = 0.5;
const GORE_MIN_SHORT_AXIS_PX = 9;
const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function goreMask(state: string): boolean[] {
  const cell = cellAlpha(HOARDER_FIGURE, state, 0);
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
      const x = Math.round(originX + ((mx + 0.5) / DISTINCT_MASK) * span);
      const y = Math.round(originY + ((my + 0.5) / DISTINCT_MASK) * span);
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
    const stats = inkStatsOf(cellAlpha(HOARDER_FIGURE, state, 0));
    if (stats.count === 0) {
      fail('H6', `${state} painted nothing`);
      continue;
    }
    piecesMeasured++;
    const shortAxis =
      Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) * GORE_RUNTIME_SCALE;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'H6',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis on screen ` +
          `(limit ${GORE_MIN_SHORT_AXIS_PX}px) — it reads as a speck`,
      );
    }
  }
  failUnlessMeasured('H6', piecesMeasured, 'gore pieces');
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
          'H7',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} share ${(iou * 100).toFixed(0)}% of their ` +
            `silhouette (limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%) — they tumble as the ` +
            'same blob',
        );
      }
    }
  }
  failUnlessMeasured('H7', pairsMeasured, 'pairs of gore pieces');
}

// ── H8 reach headroom, H9 foot slide ─────────────────────────────────────────

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
  for (const row of HOARDER_ROWS) {
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
            'H8',
            `${row.name}[${frame}] asks the ${side} leg for ${span.toFixed(4)} against a reach ` +
              `of ${LEG_REACH.toFixed(4)} — the IK clamps and the step reads as a hop`,
          );
        }
      }
    }
  }
  failUnlessMeasured('H8', legsMeasured, 'legs');
  console.log(
    `  H8 leg reach: worst frame asks ${worst.toFixed(4)} of ${LEG_REACH.toFixed(4)} available`,
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
  const row = rowNamed('walk_side', 'H9');
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
          'H9',
          `walk_side[${frame}] drags the planted right foot forward by ${step.toFixed(4)} ` +
            `(limit ${FOOT_SLIDE_LIMIT})`,
        );
      }
    }
    previousX = here.rightFoot.x;
  }
  failUnlessMeasured('H9', plantedSteps, "planted steps of walk_side's right foot");
}

// ── H10 the silhouette has no corners ────────────────────────────────────────

/**
 * The tightest turn the flesh outline is allowed, in figure units. Roughly a
 * seventh of her half-width: a fat body is a stack of long shallow arcs, and
 * anything much tighter than this stops reading as flesh and starts reading as
 * a fold in cardboard. It went in after the outline was found turning inside a
 * hundredth of a tile — a mathematical curve and a visual corner.
 */
const MIN_OUTLINE_RADIUS = 0.1;

function gateSilhouetteCurvature(): void {
  let worstRadius = Infinity;
  let worstAt = '';
  let worstY = 0;
  let framesMeasured = 0;
  for (const row of HOARDER_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      framesMeasured++;
      const tightest = torsoOutlineCurvature(row.pose(frame), row.view);
      if (tightest.radius >= worstRadius) continue;
      worstRadius = tightest.radius;
      worstAt = `${row.name}[${frame}]`;
      worstY = tightest.y;
    }
  }
  failUnlessMeasured('H10', framesMeasured, 'posed frames');
  if (framesMeasured === 0) return;
  if (worstRadius < MIN_OUTLINE_RADIUS) {
    fail(
      'H10',
      `${worstAt} turns the silhouette inside ${worstRadius.toFixed(4)} at y ` +
        `${worstY.toFixed(3)} (limit ${MIN_OUTLINE_RADIUS}) — that is a corner, not a body`,
    );
    return;
  }
  console.log(
    `  H10 silhouette: tightest turn ${worstRadius.toFixed(4)} of ${MIN_OUTLINE_RADIUS} ` +
      `at ${worstAt}, y ${worstY.toFixed(3)}`,
  );
}

// ── H11 the release is the peak ──────────────────────────────────────────────

/**
 * Her jaw opens widest on the exact frame the projectile spawns. Off by one and
 * the bile appears before her mouth is open, or after she has begun to sag.
 */
function gateReleaseIsThePeak(): void {
  const vomitRows = HOARDER_ROWS.filter((row) => row.name.startsWith('vomit'));
  failUnlessMeasured('H11', vomitRows.length, 'vomit rows');
  for (const row of vomitRows) {
    let peakFrame = 0;
    let peakGape = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const gape = row.pose(frame).mouth;
      if (gape > peakGape) {
        peakGape = gape;
        peakFrame = frame;
      }
    }
    if (peakFrame !== VOMIT_RELEASE_FRAME) {
      fail(
        'H11',
        `${row.name} opens widest on frame ${peakFrame} but the bile is released on frame ` +
          `${VOMIT_RELEASE_FRAME} — the projectile appears before or after her jaw drops`,
      );
    }
  }
}

// ── H12 contracts with the runtime ───────────────────────────────────────────

/**
 * The runtime's own declarations, read out of the source rather than imported:
 * the sprite modules reach for browser globals a Node process does not have.
 *
 * Each of these fails by drawing nothing and saying nothing. `drawFigureCached`
 * returns silently on a state the figure does not paint, `BodyPartGoreSystem`
 * skips a part it cannot find, and the frame index is clamped rather than
 * checked — so a row that lost a frame freezes on its last cell.
 */
const HOARDER_SPRITE_PATH = 'src/sprites/hoarderSprite.ts';
const BILE_SPRITE_PATH = 'src/sprites/hoarderBileSprite.ts';
const BOSS_ROOM_PATH = 'src/systems/BossRoomSystem.ts';

function sourceOf(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

/** The numeric value of an exported `const NAME = <number>;`, or null. */
function declaredNumber(source: string, name: string): number | null {
  const match = new RegExp(`${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`).exec(source);
  if (match === null) return null;
  return Number(match[1]);
}

function gateRuntimeContract(): void {
  const source = sourceOf(HOARDER_SPRITE_PATH);

  const release = declaredNumber(source, 'HOARDER_VOMIT_RELEASE_FRAME');
  if (release === null) {
    fail('H12', `${HOARDER_SPRITE_PATH} does not declare HOARDER_VOMIT_RELEASE_FRAME`);
  } else if (release !== VOMIT_RELEASE_FRAME) {
    fail(
      'H12',
      `the figure releases on frame ${VOMIT_RELEASE_FRAME} and the runtime expects ${release}`,
    );
  }

  const table = /HOARDER_FRAME_COUNT[^=]*=\s*\{([^}]*)\}/.exec(source);
  if (table === null) {
    fail('H12', `${HOARDER_SPRITE_PATH} does not declare HOARDER_FRAME_COUNT`);
  } else {
    const constants = new Map<string, number>();
    for (const name of ['HOARDER_WALK_FRAMES', 'HOARDER_VOMIT_FRAMES', 'HOARDER_IDLE_FRAMES']) {
      const value = declaredNumber(source, name);
      if (value === null) {
        fail('H12', `${HOARDER_SPRITE_PATH} does not declare ${name}`);
        continue;
      }
      constants.set(name, value);
    }
    const declared = new Map<string, number>();
    for (const line of table[1].split(',')) {
      const entry = /([A-Za-z_]+)\s*:\s*([A-Za-z_]+)/.exec(line);
      if (entry === null) continue;
      const frames = constants.get(entry[2]);
      if (frames === undefined) {
        fail(
          'H12',
          `${HOARDER_SPRITE_PATH} counts "${entry[1]}" as ${entry[2]}, which is not a row length`,
        );
        continue;
      }
      declared.set(entry[1], frames);
    }
    failUnlessMeasured('H12', declared.size, 'rows in HOARDER_FRAME_COUNT');
    for (const row of HOARDER_ROWS) {
      const runtimeCount = declared.get(row.name);
      if (runtimeCount === undefined) {
        fail('H12', `the figure paints a row "${row.name}" the runtime does not declare`);
        continue;
      }
      if (runtimeCount !== row.frameCount) {
        fail(
          'H12',
          `the ${row.name} row paints ${row.frameCount} frames and the runtime declares ` +
            `${runtimeCount}; the shorter of the two is the one that freezes`,
        );
      }
    }
    for (const name of declared.keys()) {
      if (HOARDER_ROWS.some((row) => row.name === name)) continue;
      fail('H12', `the runtime declares a row "${name}" the figure does not paint`);
    }
  }

  const parts = /HOARDER_GORE_PARTS[^=]*=\s*\[([^\]]*)\]/.exec(source);
  if (parts === null) {
    fail('H12', `${HOARDER_SPRITE_PATH} does not declare HOARDER_GORE_PARTS`);
  } else {
    const runtimeParts = [...parts[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const painted = [...GORE_STATES];
    if (
      runtimeParts.length !== painted.length ||
      runtimeParts.some((part, index) => part !== painted[index])
    ) {
      fail(
        'H12',
        `${HOARDER_SPRITE_PATH}'s HOARDER_GORE_PARTS is [${runtimeParts.join(', ')}] but the ` +
          `figure paints [${painted.join(', ')}] — a part that is not in both is silently skipped`,
      );
    }
  }

  const union = /type HoarderState\s*=([^;]*);/.exec(source);
  if (union === null) {
    fail('H12', `${HOARDER_SPRITE_PATH} does not declare a HoarderState union`);
  } else {
    const names = [...union[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    for (const failure of missingStateFailures(
      HOARDER_FIGURE,
      names,
      `${HOARDER_SPRITE_PATH}'s HoarderState`,
    )) {
      fail('H12', failure);
    }
  }
}

// ── H13 warm-row budget ──────────────────────────────────────────────────────

/**
 * The widest warm row's memory, reported whether or not it passes.
 *
 * The whole-sheet texture budget the bake enforced has no analogue: a painted
 * figure is admitted to the cache one state at a time, so the number that
 * decides whether she fits is her widest state's bytes, not the sum of every
 * state. Measured over every state she declares, gore pieces included — the
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

// ── H14 the frozen gore recentring still describes the pieces ────────────────

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
  const pieces = hoarderGorePieces();
  const paintedStates = new Set(pieces.map((piece) => piece.state));
  for (const frozenState of GORE_RECENTRE.keys()) {
    if (paintedStates.has(frozenState)) continue;
    fail(
      'H14',
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
      fail('H14', `${piece.state} painted nothing at all when measured about its own centre`);
      continue;
    }
    const measuredX = (GORE_MEASURE_ORIGIN - (minX + maxX) / 2) / GORE_UNIT;
    const measuredY = (GORE_MEASURE_ORIGIN - (minY + maxY) / 2) / GORE_UNIT;
    const frozen = GORE_RECENTRE.get(piece.state);
    if (frozen === undefined) {
      fail('H14', `the figure freezes no recentring offset for ${piece.state}`);
      continue;
    }
    const gap = Math.hypot(measuredX - frozen.x, measuredY - frozen.y);
    if (gap > GORE_RECENTRE_TOLERANCE) {
      fail(
        'H14',
        `${piece.state}'s ink centres at (${measuredX}, ${measuredY}) but GORE_RECENTRE freezes ` +
          `(${frozen.x}, ${frozen.y}) — the piece will orbit rather than tumble; paste the ` +
          'measured pair',
      );
    }
  }
  failUnlessMeasured('H14', piecesMeasured, 'gore pieces');
}

// ── B1–B7 the bile and the acid ──────────────────────────────────────────────

/** A frame carrying fewer visible pixels than this is effectively empty. */
const MIN_INK_PIXELS = 64;
/**
 * The band an effect loop's seam has to land in, as a multiple of the row's own
 * steps: the ceiling against its largest ordinary step, the floor against its
 * median.
 *
 * The 2.2× against the median this replaces was carried over from the bake and
 * was no bound at all — the pool closes at 0.975× its median and the bolus at
 * 1.012×, so more than double either was unreachable by anything.
 *
 * Against the largest step the pool closes at 0.928× and the bolus at 0.902×,
 * and a pool row rewritten to run one and a half turns measures 1.420×, so the
 * 1.15 separates them cleanly. The floor is against the median for the usual
 * reason — a row may hold two byte-identical adjacent frames, which collapses a
 * narrowest-step floor into `seam >= 0` — and both rows sit near 1.0× it, so 0.4
 * is far clear of the art while still catching a row sampled at
 * `frame / (frameCount - 1)`, whose seam is exactly zero.
 */
const EFFECT_SEAM_CEILING = 1.15;
const EFFECT_SEAM_FLOOR = 0.4;

/**
 * Whether a pixel comparison can bound an effect row's seam from above at all.
 *
 * For a row whose detail is seeded per element rather than carried rigidly
 * around the cycle, it cannot, and the answer is a property of the art rather
 * than of the threshold: the bolus's silhouette is a different scatter of chunks
 * and drool at every phase, so its frame-to-frame delta saturates after one step
 * and a longer cycle raises the ordinary steps faster than it raises the seam —
 * a row rewritten to run one and a half turns measures a *smaller* seam ratio
 * (0.785×) than the shipped art (0.902×). Only the floor survives there. The
 * pool's boil, by contrast, advances one wave across the whole disc, so its
 * ratio moves the way the defect does.
 */
type EffectSeamBound = 'bounded-both-ways' | 'floor-only';
/** Slack allowed against a strictly monotonic one-shot, as a fraction. */
const MONOTONIC_SLACK = 0.03;

function gateEffectStructure(): void {
  // Both are full-bleed by nature — a pool is a disc drawn out to the damage
  // radius its own cell was sized around, and the bolus's drool streams behind
  // it — but neither may actually reach the cell wall, and the shared gate is
  // what says so.
  for (const def of [HOARDER_BILE_ARC_FIGURE, HOARDER_ACID_FIGURE]) {
    for (const failure of figureStructuralFailures(def)) fail('B1', failure);
  }
}

function gateEffectInk(): void {
  let framesMeasured = 0;
  for (const def of [HOARDER_BILE_ARC_FIGURE, HOARDER_ACID_FIGURE]) {
    for (const [state, declared] of def.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        framesMeasured++;
        const count = inkStatsOf(cellAlpha(def, state, frame)).count;
        if (count < MIN_INK_PIXELS) {
          fail(
            'B2',
            `${def.id}.${state}[${frame}] carries ${count} visible pixels, minimum ` +
              `${MIN_INK_PIXELS} — the frame is blank or all but blank`,
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
      `${def.id}.${state} pops once per cycle: the seam is ${(seam * 100).toFixed(3)}% of the ` +
        `cell, ${(seam / largest).toFixed(2)}× its largest ordinary step of ` +
        `${(largest * 100).toFixed(3)}% (ceiling ${EFFECT_SEAM_CEILING}×)`,
    );
  }
  if (typical > 0 && seam < typical * EFFECT_SEAM_FLOOR) {
    fail(
      'B3',
      `${def.id}.${state} holds still across its seam: ${(seam * 100).toFixed(3)}% of the cell, ` +
        `only ${(seam / typical).toFixed(2)}× its median step (floor ${EFFECT_SEAM_FLOOR}×) — ` +
        'the last frame all but repeats the first instead of leading back into it',
    );
  }
}

/**
 * One frame of an effect row painted straight into its own cell, so the gate can
 * ask for the frame *after* the last one.
 *
 * `bakeFigureCell` only knows the frames a state declares; the row painter
 * itself takes an unbounded frame index, and painting index `frameCount` is what
 * says where the phase mapping lands at the end of one lap.
 */
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
 * How far the cell one frame past the end of an effect loop may sit from the
 * cell the loop starts on, as a share of the row's median step.
 *
 * The effects have no pose to read, so the phase mapping is pinned through the
 * painter instead: the row is asked to paint frame `frameCount`, and a mapping
 * of `frame / frameCount` puts that at phase 1, which both of these rows draw
 * identically to phase 0. `(frame * 1.5) / frameCount` puts it at phase 1.5 and
 * `frame / (frameCount - 1)` at `n/(n-1)`, and both come back as a visibly
 * different picture.
 *
 * This is the only clause that can bound the bolus's cycle count at all. Its
 * detail is seeded per element — a different scatter of chunks and drool at
 * every phase — so its frame-to-frame delta saturates after a single step and a
 * longer cycle raises the ordinary steps faster than it raises the seam: a row
 * rewritten to run one and a half turns measures a *smaller* seam ratio (0.785×)
 * than the shipped art (0.902×) and reads as the cleaner loop of the two.
 *
 * Rasterised rather than arithmetic, so the tolerance is a share of a step
 * rather than machine epsilon. The pool repaints its phase-1 frame identically
 * to its phase-0 one; the bolus does not quite, because its shed droplets are
 * laid out along a track rather than around a circle and land 0.15 of a step
 * apart at the two ends. The tolerance is set above that and an order of
 * magnitude below what either mutation produces.
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
      `${def.id}.${row.name}: the frame after the last one differs from the frame the row starts ` +
        `on by ${(pastTheEnd * 100).toFixed(3)}% of the cell, ` +
        `${(pastTheEnd / typical).toFixed(3)}× a median step — the ${row.frameCount} frames do ` +
        'not cover exactly one turn of the cycle',
    );
  }
}

function gateEffectMonotonicMass(state: string, direction: 'grows' | 'shrinks'): void {
  const declared = HOARDER_ACID_FIGURE.states.get(state);
  if (declared === undefined) {
    fail('B4', `the acid figure declares no state "${state}"`);
    return;
  }
  const masses = Array.from({ length: declared.frames }, (_unused, frame) =>
    inkMass(cellAlpha(HOARDER_ACID_FIGURE, state, frame)),
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
        `${state} must ${direction}, but frame ${i} carries ${masses[i].toFixed(0)} coverage and ` +
          `frame ${i + 1} carries ${masses[i + 1].toFixed(0)} (allowed ${allowed.toFixed(0)} at ` +
          `${(MONOTONIC_SLACK * 100).toFixed(0)}% slack)`,
      );
    }
  }
  failUnlessMeasured('B4', stepsMeasured, `steps of ${state}`);
  console.log(
    `  B4 ${state} coverage ${masses.map((m) => m.toFixed(0)).join(' → ')} — ${direction}`,
  );
}

/**
 * How far short of the damage radius the pool's *thinnest* bearing may fall.
 * Kept tight: this is the number that decides whether a player standing on
 * clean-looking floor takes damage.
 */
const POOL_COVERAGE_TOLERANCE_GAME_PX = 2;
/**
 * How far past the damage radius the longest runnel may reach. Paint that
 * promises damage it does not deal is the same lie pointing the other way.
 */
const MAX_POOL_OVERREACH_GAME_PX = 12;
/** Directions the footprint is sampled along. */
const FOOTPRINT_BEARINGS = 360;
/** Alpha at which the corroded rim counts as covering a pixel. */
const FOOTPRINT_ALPHA_THRESHOLD = 64;

/**
 * The damage radius the pool is painted to cover, read out of the system that
 * applies it. Hard-coding the number here would leave the gate green on the day
 * somebody widens the hazard and not the art.
 */
function damageRadiusGamePx(): number | null {
  const source = sourceOf(BOSS_ROOM_PATH);
  const match = /ACID_PUDDLE_RADIUS\s*=\s*TILE_SIZE\s*\*\s*(\d+(?:\.\d+)?)\s*;/.exec(source);
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
    const cell = cellAlpha(HOARDER_ACID_FIGURE, 'pool', frame);
    const reachByBearing = new Float64Array(FOOTPRINT_BEARINGS);
    for (let y = 0; y < POOL_FRAME_SIZE; y++) {
      for (let x = 0; x < POOL_FRAME_SIZE; x++) {
        if (cell.alpha[y * POOL_FRAME_SIZE + x] < FOOTPRINT_ALPHA_THRESHOLD) continue;
        const dx = x + 0.5 - POOL_ANCHOR;
        const dy = y + 0.5 - POOL_ANCHOR;
        const distance = Math.hypot(dx, dy);
        widest = Math.max(widest, distance);
        const bearing = Math.atan2(dy, dx);
        const bucket =
          Math.floor(((bearing + Math.PI) / (Math.PI * 2)) * FOOTPRINT_BEARINGS) %
          FOOTPRINT_BEARINGS;
        reachByBearing[bucket] = Math.max(reachByBearing[bucket], distance);
      }
    }
    shortest = Math.min(shortest, ...reachByBearing);
  }
  failUnlessMeasured('B5', framesMeasured, 'pool frames');
  if (framesMeasured === 0) return;

  const shortestGame = shortest * GAME_PIXELS_PER_AUTHORED_PIXEL;
  const widestGame = widest * GAME_PIXELS_PER_AUTHORED_PIXEL;
  console.log(
    `  B5 pool footprint vs a ${target} game px damage radius: shortest reach ` +
      `${shortestGame.toFixed(1)}, widest ${widestGame.toFixed(1)}`,
  );
  if (shortestGame < target - POOL_COVERAGE_TOLERANCE_GAME_PX) {
    fail(
      'B5',
      `the pool's shortest reach is ${shortestGame.toFixed(1)} game px but it damages out to ` +
        `${target}, so ${(target - shortestGame).toFixed(1)} px of live hazard is painted as ` +
        `clean floor (tolerance ${POOL_COVERAGE_TOLERANCE_GAME_PX} px) — the nominal radius is ` +
        'the FLOOR of the rim profile, never its mean',
    );
  }
  if (widestGame > target + MAX_POOL_OVERREACH_GAME_PX) {
    fail(
      'B5',
      `the pool draws out to ${widestGame.toFixed(1)} game px against a ${target} px damage ` +
        `radius, ${(widestGame - target).toFixed(1)} px past it (limit ` +
        `${MAX_POOL_OVERREACH_GAME_PX})`,
    );
  }
}

/**
 * Every state name the bile sprite asks one of its figures for, read out of the
 * source.
 *
 * A list of names written here instead would only ever pin the figure: renaming
 * a `drawFigureCached` call in the sprite to a state the figure does not paint
 * leaves the effect invisible, silent, and the gate green, because the gate
 * would still be asking about the name it remembered rather than the name the
 * runtime now uses. `missingStateFailures` fails when this comes back empty, so
 * a call shape this cannot read is reported rather than skipped.
 */
function statesDrawnFrom(source: string, figureName: string): string[] {
  const call = new RegExp(
    `(?:drawFigureCached|prewarmFigureState)\\(\\s*(?:ctx,\\s*)?${figureName},\\s*'([^']+)'`,
    'g',
  );
  return [...source.matchAll(call)].map((match) => match[1]);
}

function gateBileRuntimeContract(): void {
  const source = sourceOf(BILE_SPRITE_PATH);
  const declared: ReadonlyArray<{
    readonly name: string;
    readonly def: FigureDef;
    readonly state: string;
  }> = [
    { name: 'BILE_ARC_FRAMES', def: HOARDER_BILE_ARC_FIGURE, state: 'arc' },
    { name: 'ACID_SPLASH_FRAMES', def: HOARDER_ACID_FIGURE, state: 'splash' },
    { name: 'ACID_FORM_FRAMES', def: HOARDER_ACID_FIGURE, state: 'form' },
    { name: 'ACID_POOL_FRAMES', def: HOARDER_ACID_FIGURE, state: 'pool' },
    { name: 'ACID_FADE_FRAMES', def: HOARDER_ACID_FIGURE, state: 'fade' },
  ];
  let namesMeasured = 0;
  for (const { name, def, state } of declared) {
    const runtimeCount = declaredNumber(source, name);
    if (runtimeCount === null) {
      fail('B7', `${BILE_SPRITE_PATH} does not declare ${name} as a number`);
      continue;
    }
    namesMeasured++;
    const painted = def.states.get(state)?.frames ?? 0;
    if (painted !== runtimeCount) {
      fail(
        'B7',
        `${def.id}.${state} paints ${painted} frames where the runtime's ${name} declares ` +
          `${runtimeCount}; the shorter of the two is the one that freezes`,
      );
    }
  }
  failUnlessMeasured('B7', namesMeasured, 'declared effect row lengths');

  for (const [figureName, def] of [
    ['HOARDER_BILE_ARC_FIGURE', HOARDER_BILE_ARC_FIGURE],
    ['HOARDER_ACID_FIGURE', HOARDER_ACID_FIGURE],
  ] as const) {
    const asked = statesDrawnFrom(source, figureName);
    for (const failure of missingStateFailures(
      def,
      asked,
      `${BILE_SPRITE_PATH}'s ${figureName} draw calls`,
    )) {
      fail('B7', failure);
    }
  }
}

// ── Runners ──────────────────────────────────────────────────────────────────

/** Runs every gate on the Hoarder herself and returns one message per failure. */
export function hoarderGateFailures(): string[] {
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
  gateRuntimeContract();
  reportWarmRow('H13', HOARDER_FIGURE);
  gateGoreRecentre();
  distinctFrameFailures('H15', HOARDER_FIGURE);
  return [...failures];
}

/** Runs every gate on the bolus and the acid pool. */
export function hoarderBileGateFailures(): string[] {
  failures.length = 0;
  gateEffectStructure();
  gateEffectInk();
  gateEffectLoop(HOARDER_BILE_ARC_FIGURE, 'arc', 'floor-only');
  gateEffectLoop(HOARDER_ACID_FIGURE, 'pool', 'bounded-both-ways');
  for (const row of HOARDER_BILE_ARC_ROWS) gateEffectCoversOneTurn(HOARDER_BILE_ARC_FIGURE, row);
  for (const row of HOARDER_ACID_ROWS) {
    if (row.name !== 'pool') continue;
    gateEffectCoversOneTurn(HOARDER_ACID_FIGURE, row);
  }
  gateEffectMonotonicMass('form', 'grows');
  gateEffectMonotonicMass('fade', 'shrinks');
  gatePoolFootprint();
  gateBileRuntimeContract();
  reportWarmRow('B6', HOARDER_BILE_ARC_FIGURE);
  reportWarmRow('B6', HOARDER_ACID_FIGURE);
  distinctFrameFailures('B8', HOARDER_BILE_ARC_FIGURE);
  distinctFrameFailures('B8', HOARDER_ACID_FIGURE);
  return [...failures];
}
