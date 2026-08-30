/**
 * The Troglodyte's art gates.
 *
 * The creature has no baked sheet to inspect any more, so every invariant the
 * old bake gate enforced against sheet pixels is enforced here against cells
 * painted from `TROGLODYTE_FIGURE` and `TROGLODYTE_TONGUE_FIGURE` — baked
 * exactly the way the runtime cache bakes them, supersampled and downsampled,
 * so what is measured is what the game blits. The pose-stream gates measure the
 * rig itself and need no pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly: a lookup that quietly returns nothing turns a whole gate module
 * green while measuring nothing.
 *
 * Run by the review harness: `npm run render:troglodyte`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  GORE_RECENTRE,
  GORE_STATES,
  GORE_UNIT,
  GROUND_OFFSET_PX,
  LASH_FRAMES,
  LASH_IMPACT_PROGRESS,
  TILE_SCALE,
  TONGUE_FRAMES,
  TONGUE_STATE,
  TROGLODYTE_FIGURE,
  TROGLODYTE_ROWS,
  TROGLODYTE_TONGUE_FIGURE,
  lashMouthAnchorsInTile,
  lashSide,
  mouthAnchorsInTile,
  type RowSpec,
} from '../src/sprites/art/troglodyteFigure.js';
import { ARM_LENGTH, solvedArm, type TrogPose, type TrogView } from '../src/sprites/art/trogArt.js';
import { trogGorePieces } from '../src/sprites/art/trogGore.js';
import {
  TROGLODYTE_ATTACK_STATES,
  TROGLODYTE_GORE_PARTS,
  TROGLODYTE_PREWARMED_STATES,
  TROGLODYTE_STATES,
} from '../src/sprites/troglodyteSprite.js';
import { TROGLODYTE_TONGUE_ART_REACH_TILES } from '../src/sprites/troglodyteTongue.js';
import { asGameContext } from './nodeGameContext.js';

/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
/**
 * And the alpha a pixel needs to count as the creature's *body* rather than as
 * its contact shadow, which is a radial gradient reaching a tenth of a tile
 * past the feet.
 */
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const { frameWidth, frameHeight } = TROGLODYTE_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — planted frames only, IK-placed
 * arms only, one entry per painted piece — and a narrowing that matches nothing
 * leaves a green gate that examined nothing. Every filtering loop here counts
 * what it looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const alphaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's alpha channel, baked as the runtime cache bakes it. */
function cellAlpha(state: string, frame: number): Uint8ClampedArray {
  const key = `${state}[${frame}]`;
  const cached = alphaByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(TROGLODYTE_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

function cellsOfRow(row: RowSpec): Uint8ClampedArray[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) => cellAlpha(row.name, frame));
}

interface InkStats {
  count: number;
  centroidX: number;
  centroidY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function inkStatsIn(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): InkStats {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] < threshold) continue;
      count++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) {
    return { count: 0, centroidX: 0, centroidY: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return { count, centroidX: sumX / count, centroidY: sumY / count, minX, maxX, minY, maxY };
}

function inkStatsOf(alpha: Uint8ClampedArray, threshold = INK_ALPHA_THRESHOLD): InkStats {
  return inkStatsIn(alpha, frameWidth, frameHeight, threshold);
}

function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    const inkedA = a[i] >= INK_ALPHA_THRESHOLD;
    const inkedB = b[i] >= INK_ALPHA_THRESHOLD;
    if (inkedA !== inkedB) differing++;
  }
  return differing;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * The row a gate names, or null after recording a failure.
 *
 * Every one of these names is a string literal written here rather than in
 * `TROGLODYTE_ROWS`, so renaming a row would otherwise turn its gate into a
 * silent no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = TROGLODYTE_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `no row named "${name}" — a gate is guarding a row that no longer exists`);
    return null;
  }
  return row;
}

// ── Structural gates ─────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly
 * empty. The gore states are exempt from the fill check: a severed jaw is meant
 * to be small inside a cell sized for the widest lash.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(TROGLODYTE_FIGURE, {
    sparseStates: GORE_STATES,
  })) {
    fail('G1', failure);
  }
  // The tongue's cell is a window onto something three tiles long: its whip
  // legitimately runs off the right-hand edge of a frame sized for the reach,
  // and its root bulges back to the left edge on the frames it is stowed.
  for (const failure of figureStructuralFailures(TROGLODYTE_TONGUE_FIGURE, {
    bleedEdges: ['left', 'right'],
    minInkAreaShare: TONGUE_MIN_CELL_FILL,
  })) {
    fail('G1', failure);
  }
}

/**
 * How much of its cell the tongue's longest frame must fill.
 *
 * Low, and it has to be: the tongue is a whip a couple of pixels thick drawn
 * across a cell sized for its reach, so its *bounding box* fills the cell while
 * its ink fills almost none of it. The check that matters for this figure is
 * the reach gate below, not the fill.
 */
const TONGUE_MIN_CELL_FILL = 0.05;

/**
 * How far a foot may float above the ground line the frozen tile box declares.
 *
 * Tight. A figure hanging in the air has nothing legitimately holding it up,
 * and this is the direction the defect actually goes in.
 */
const FOOT_FLOAT_TOLERANCE_PX = 3;
/**
 * How far below it a foot may sit.
 *
 * Wider, because head-on the toe that fans toward the camera is *nearer* than
 * the sole and so draws below the contact line — correct projection, not a
 * misplaced anchor. One number covering both directions has to be loosened
 * until it catches nothing.
 */
const FOOT_HANG_TOLERANCE_PX = 8;
const STANDING_ROWS = ['idle', 'idle_side', 'idle_away'] as const;
/**
 * Clear space added on every side before the anchor is measured.
 *
 * The cell is padded by six pixels, so any translation big enough to fail this
 * gate would clip against the cell edge first and the structural gate would
 * speak instead — leaving this one structurally unable to fail on its own
 * subject. Measured on a padded canvas and reported back in cell coordinates,
 * the two gates are independent again.
 */
const ANCHOR_MEASURE_PAD = 48;

/** One frame painted into a canvas with room around it, as a flat alpha array. */
function paddedAlpha(state: string, frame: number): Uint8ClampedArray {
  const width = frameWidth + ANCHOR_MEASURE_PAD * 2;
  const height = frameHeight + ANCHOR_MEASURE_PAD * 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(ANCHOR_MEASURE_PAD, ANCHOR_MEASURE_PAD);
  TROGLODYTE_FIGURE.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { data } = ctx.getImageData(0, 0, width, height);
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  return alpha;
}

/**
 * G2 — the feet stand on the ground line the frozen tile box declares.
 *
 * Measured against solid alpha rather than any ink: the contact shadow is a
 * radial gradient that legitimately spreads a tenth of a tile past the feet, so
 * an ordinary-ink reading measures the shadow's radius and stays green while
 * the figure floats.
 *
 * This cannot catch a wrong `tileY` — `paintFrame` puts its own origin on the
 * same line — and does not claim to; the parity run against the sheet is what
 * proved those numbers. What it catches is the art drifting off its own anchor.
 */
function gateAnchor(): void {
  const groundY = TROGLODYTE_FIGURE.tileY + GROUND_OFFSET_PX;
  const width = frameWidth + ANCHOR_MEASURE_PAD * 2;
  const height = frameHeight + ANCHOR_MEASURE_PAD * 2;
  let rowsMeasured = 0;
  for (const name of STANDING_ROWS) {
    const row = rowNamed(name, 'G2');
    if (row === null) continue;
    rowsMeasured++;
    const stats = inkStatsIn(paddedAlpha(name, 0), width, height, SOLID_ALPHA_THRESHOLD);
    if (stats.count === 0) {
      fail('G2', `${name}[0] has no solid ink at all to stand on`);
      continue;
    }
    const soleY = stats.maxY - ANCHOR_MEASURE_PAD;
    const drop = soleY - groundY;
    if (drop < -FOOT_FLOAT_TOLERANCE_PX || drop > FOOT_HANG_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its lowest solid ink at y=${soleY} against a ground line of ${groundY} ` +
          `(tileY ${TROGLODYTE_FIGURE.tileY} + ${GROUND_OFFSET_PX}) — ${drop.toFixed(1)}px off, ` +
          `allowed ${-FOOT_FLOAT_TOLERANCE_PX}..${FOOT_HANG_TOLERANCE_PX}`,
      );
    }
  }
  failUnlessMeasured('G2', rowsMeasured, 'standing rows');
}

/**
 * How far past the row's own largest ordinary step the seam may reach.
 *
 * A closed cycle crosses its seam the way it crosses anywhere else, so the
 * largest in-cycle step is the yardstick. Measured on shipped art: this figure's
 * six loop rows seam at 0.69–0.92 of their largest step, and the worst across
 * every painted figure in the repo is 1.076. The limit this replaces also
 * allowed 2.1× the row's *median* step, and on a walk — whose steps are all
 * large — that clause swallowed the whole check. This clause is an art-drift check and cannot see cycle count at
 * all: re-timing a row moves the steps it is judged against along with the
 * seam. The wrap clause is what covers that.
 */
const LOOP_SEAM_CEILING = 1.15;
/**
 * How many pixels the frame one past a loop's last may differ from its first.
 *
 * The clause that binds a cycle to exactly one turn, and the only one that can:
 * a seam ratio moves its own denominator when the row is re-timed, so a cycle
 * running one and a half turns can measure *inside* the ceiling. The painter
 * takes a frame index rather than a phase, so a loop can be painted at
 * `frameCount` — one frame past its end — where a closed cycle reproduces frame
 * 0. Not held to exactly zero because the cell is downsampled from twice its
 * size and a pose value landing on 2π rather than 0 rounds independently on each
 * side; this figure's six loop rows measure 0px except idle_side at 1px, and the
 * worst across the seven figures swept with it is 4px.
 */
const LOOP_WRAP_TOLERANCE_PX = 16;
/**
 * The least any interior frame of a loop may differ from its first.
 *
 * The wrap check is satisfied by a row that runs its cycle *twice*, which
 * repeats frame 0 in the middle of the row. The margin here is thin by
 * necessity: the front idle is a slow breath whose half-cycle differs from its
 * start by only 9px, which is the closest measured across the six rows. It is
 * still decisive against the defect it names, because an exact repeat scores 0.
 */
const LOOP_INTERIOR_REPEAT_FLOOR_PX = 4;
/**
 * How small the seam may be relative to the row's own median step.
 *
 * A ceiling alone is half a gate. Sampling a cycle at `frame / (frameCount - 1)`
 * instead of `frame / frameCount` makes the last frame identical to the first:
 * the seam goes to zero, a "seam versus median" check passes with room to
 * spare, and the cycle spends a whole frame held still every loop. Measured
 * across this figure's six loop rows the smallest honest seam is 1.00 of the
 * median, so the floor sits at half of that — twice the margin over correct
 * animation, and a repeated frame is nowhere near it.
 */
const LOOP_SEAM_FLOOR_SHARE = 0.5;

/** G3 — a loop must not pop across its seam, nor close it by repeating a frame. */
function gateLoopClosure(): void {
  let rowsMeasured = 0;
  for (const row of TROGLODYTE_ROWS) {
    if (row.kind !== 'loop') continue;
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    rowsMeasured++;
    if (typical === 0) {
      fail('G3', `${row.name} has a median step of 0px — the row is frozen, not looping`);
      continue;
    }

    const wrap = frameDelta(cellAlpha(row.name, row.frameCount), cells[0]);
    if (wrap > LOOP_WRAP_TOLERANCE_PX) {
      fail(
        'G3',
        `${row.name} does not cover exactly one turn: painted at frame ${row.frameCount}, one ` +
          `past its end, it differs from frame 0 by ${wrap}px (allowed ` +
          `${LOOP_WRAP_TOLERANCE_PX}px) — the cycle is sampled over more or less than its own ` +
          'length, so the row plays at the wrong rate and never closes',
      );
    }
    let closestInterior = Infinity;
    let closestFrame = -1;
    for (let frame = 1; frame < row.frameCount; frame++) {
      const distance = frameDelta(cells[frame], cells[0]);
      if (distance >= closestInterior) continue;
      closestInterior = distance;
      closestFrame = frame;
    }
    if (closestInterior < LOOP_INTERIOR_REPEAT_FLOOR_PX) {
      fail(
        'G3',
        `${row.name}[${closestFrame}] comes back to within ${closestInterior}px of frame 0 (at ` +
          `least ${LOOP_INTERIOR_REPEAT_FLOOR_PX}px expected) — the row is running its cycle ` +
          'more than once',
      );
    }

    const worst = Math.max(...steps);
    const allowed = worst * LOOP_SEAM_CEILING;
    if (seam > allowed) {
      fail(
        'G3',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a ` +
          `largest in-cycle step of ${worst}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
    const floor = typical * LOOP_SEAM_FLOOR_SHARE;
    if (seam < floor) {
      fail(
        'G3',
        `${row.name} barely moves across its loop seam: last→first differs by ${seam}px against a ` +
          `median step of ${typical}px (floor ${floor.toFixed(0)}px) — the cycle is holding a ` +
          'frame rather than closing',
      );
    }
  }
  failUnlessMeasured('G3', rowsMeasured, 'loops that actually move');
}

const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
/**
 * A step this small is not visible however large its ratio to the row's median.
 *
 * Without a floor the gate is loudest on the rows that move least: a breathing
 * idle whose frames differ by five pixels flags a fifteen-pixel step at 3× the
 * median, and fifteen pixels of this cell is a tenth of one percent of it.
 */
const STEP_FLOOR_SHARE = 0.005;

/** G4 — no consecutive-frame step far above the row's own median. */
function gateMotionContinuity(): void {
  const floor = frameWidth * frameHeight * STEP_FLOOR_SHARE;
  let stepsMeasured = 0;
  for (const row of TROGLODYTE_ROWS) {
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const typical = median(steps);
    if (typical === 0) continue;
    stepsMeasured += steps.length;
    const limit = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    steps.forEach((step, i) => {
      const ratio = step / typical;
      if (ratio > limit && step > floor) {
        fail(
          'G4',
          `${row.name} jumps between frames ${i} and ${i + 1}: ${step}px against a median of ` +
            `${typical}px (${ratio.toFixed(2)}×, limit ${limit})`,
        );
      }
    });
  }
  failUnlessMeasured('G4', stepsMeasured, 'frame-to-frame steps');
}

/**
 * G5 — a walk cycle does not slide in place.
 *
 * The creature's ink centroid may bob, but over a full loop it must come back
 * to where it started: a centroid that has drifted by the end of the cycle is a
 * figure moonwalking on the spot.
 */
const CENTROID_DRIFT_LIMIT_PX = 2;

function gateCentroidDrift(): void {
  let loopsMeasured = 0;
  for (const row of TROGLODYTE_ROWS) {
    if (row.kind !== 'loop') continue;
    loopsMeasured++;
    const first = inkStatsOf(cellAlpha(row.name, 0));
    const last = inkStatsOf(cellAlpha(row.name, row.frameCount - 1));
    const drift = Math.hypot(last.centroidX - first.centroidX, last.centroidY - first.centroidY);
    if (drift > CENTROID_DRIFT_LIMIT_PX) {
      fail(
        'G5',
        `${row.name} drifts ${drift.toFixed(2)}px across its loop (limit ` +
          `${CENTROID_DRIFT_LIMIT_PX})`,
      );
    }
  }
  failUnlessMeasured('G5', loopsMeasured, 'loop rows');
}

const IN_GAME_TILE = 32;
const GORE_MIN_SHORT_AXIS_PX = 9;

/**
 * G6 — every severed piece is big enough to be identified as it tumbles.
 *
 * A blind naming test could not name a single piece of the first bake at the
 * size they actually render, and the reason was measurable: several were under
 * five pixels across. Measured in *screen* pixels, at the 0.5× the runtime
 * applies, not in cell pixels.
 */
function gateGoreLegibility(): void {
  const screenScale = IN_GAME_TILE / TILE_SCALE;
  let piecesMeasured = 0;
  for (const state of GORE_STATES) {
    piecesMeasured++;
    const stats = inkStatsOf(cellAlpha(state, 0));
    if (stats.count === 0) {
      fail('G6', `${state} painted nothing`);
      continue;
    }
    const shortAxis = Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) * screenScale;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'G6',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis at the size it renders ` +
          `(limit ${GORE_MIN_SHORT_AXIS_PX}) — nothing that thin can be told from anything else`,
      );
    }
  }
  failUnlessMeasured('G6', piecesMeasured, 'gore pieces');
}

const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function maskOf(state: string): boolean[] {
  const alpha = cellAlpha(state, 0);
  const stats = inkStatsOf(alpha);
  const boxW = Math.max(1, stats.maxX - stats.minX);
  const boxH = Math.max(1, stats.maxY - stats.minY);
  // Scale is normalised away but aspect deliberately is not: stretching each
  // piece to fill its own bounding box maps every convex blob onto a filled
  // square and measures the normalisation rather than the art.
  const span = Math.max(boxW, boxH);
  const mask: boolean[] = new Array<boolean>(DISTINCT_MASK * DISTINCT_MASK).fill(false);
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < INK_ALPHA_THRESHOLD) continue;
    const x = (i % frameWidth) - stats.minX;
    const y = Math.floor(i / frameWidth) - stats.minY;
    const mx = Math.min(DISTINCT_MASK - 1, Math.floor((x / span) * DISTINCT_MASK));
    const my = Math.min(DISTINCT_MASK - 1, Math.floor((y / span) * DISTINCT_MASK));
    mask[my * DISTINCT_MASK + mx] = true;
  }
  return mask;
}

/** G7 — no two severed pieces are the same shape. */
function gateGoreDistinctness(): void {
  const masks = GORE_STATES.map((state) => maskOf(state));
  let pairsMeasured = 0;
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
      if (iou > DISTINCT_IOU_LIMIT) {
        fail(
          'G7',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} are ${(iou * 100).toFixed(0)}% the same shape ` +
            `(limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%)`,
        );
      }
    }
  }
  failUnlessMeasured('G7', pairsMeasured, 'gore piece pairings');
}

// ── The tongue ───────────────────────────────────────────────────────────────

const tongueAlphaByFrame = new Map<number, Uint8ClampedArray>();

function tongueAlpha(frame: number): Uint8ClampedArray {
  const cached = tongueAlphaByFrame.get(frame);
  if (cached !== undefined) return cached;
  const { frameWidth: width, frameHeight: height } = TROGLODYTE_TONGUE_FIGURE;
  const cell = bakeFigureCell(TROGLODYTE_TONGUE_FIGURE, TONGUE_STATE, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, width, height);
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  tongueAlphaByFrame.set(frame, alpha);
  return alpha;
}

function tongueInk(frame: number): InkStats {
  const { frameWidth: width, frameHeight: height } = TROGLODYTE_TONGUE_FIGURE;
  return inkStatsIn(tongueAlpha(frame), width, height, INK_ALPHA_THRESHOLD);
}

/**
 * G8 — the tongue is never drawn detached from its own root.
 *
 * The runtime anchors this figure at the mouth and rotates it, so ink that does
 * not reach back to the anchor is a tongue hanging in the air beside the
 * creature rather than coming out of it.
 */
const TONGUE_ROOT_GAP_LIMIT_PX = 6;

function gateTongueRoot(): void {
  let framesMeasured = 0;
  for (let frame = 0; frame < TONGUE_FRAMES; frame++) {
    const stats = tongueInk(frame);
    if (stats.count === 0) {
      fail('G8', `tongue frame ${frame} painted nothing`);
      continue;
    }
    framesMeasured++;
    const gap = stats.minX - TROGLODYTE_TONGUE_FIGURE.tileX;
    if (gap > TONGUE_ROOT_GAP_LIMIT_PX) {
      fail(
        'G8',
        `tongue frame ${frame} starts ${gap}px past its own mouth anchor (limit ` +
          `${TONGUE_ROOT_GAP_LIMIT_PX}) — it would draw detached from the creature`,
      );
    }
  }
  failUnlessMeasured('G8', framesMeasured, 'tongue frames');
}

/**
 * G9 — the tongue's reach grows monotonically and never shrinks.
 *
 * The row is indexed by extension, so a frame shorter than the one before it
 * makes the strike visibly stutter backward mid-throw.
 */
function gateTongueMonotonic(): void {
  let previous = -Infinity;
  let framesMeasured = 0;
  for (let frame = 0; frame < TONGUE_FRAMES; frame++) {
    const stats = tongueInk(frame);
    if (stats.count === 0) continue;
    framesMeasured++;
    if (stats.maxX <= previous) {
      fail(
        'G9',
        `tongue frame ${frame} reaches x=${stats.maxX}, no further than frame ${frame - 1}'s ` +
          `${previous} — the strike would stutter backward`,
      );
    }
    previous = stats.maxX;
  }
  failUnlessMeasured('G9', framesMeasured, 'tongue frames');
}

/**
 * G16 — the painted tongue reaches as far as the runtime scales it by.
 *
 * `troglodyteSprite.ts` scales the tongue overlay per view from
 * `TROGLODYTE_TONGUE_ART_REACH_TILES` so its tip lands on the mob's hit
 * boundary. Wrong, and the thing that visibly reaches the player stops being
 * the thing that damages them.
 *
 * Measured on the last frame's ink, never by comparing two constants: the
 * constants agreed while the art did not. Sampling the row at cell centres
 * painted the longest frame at 0.91 of full extension, so the art spanned 2.92
 * tiles against a declared 3.2 and every strike landed a quarter of a tile
 * short — invisible to a constant-to-constant check, which passed throughout.
 * (That check is now impossible as well as useless: the runtime constant *is*
 * the painter's, by import.)
 */
const TONGUE_REACH_SHORTFALL_LIMIT = 0.06;
/**
 * The venom glow and the head's barbs paint past the whip's own tip, so ink
 * legitimately runs beyond the spine's reach.
 */
const TONGUE_REACH_OVERSHOOT_LIMIT = 0.3;

function gateTongueReach(): void {
  const stats = tongueInk(TONGUE_FRAMES - 1);
  if (stats.count === 0) {
    fail('G16', "the tongue's last frame painted nothing");
    return;
  }
  const reached = (stats.maxX - TROGLODYTE_TONGUE_FIGURE.tileX) / TILE_SCALE;
  console.log(
    `  G16 tongue reach: ${reached.toFixed(3)} tiles painted against a declared ` +
      `${TROGLODYTE_TONGUE_ART_REACH_TILES}`,
  );
  if (reached < TROGLODYTE_TONGUE_ART_REACH_TILES - TONGUE_REACH_SHORTFALL_LIMIT) {
    fail(
      'G16',
      `the painted tongue's furthest frame reaches ${reached.toFixed(3)} tiles from its own root, ` +
        `but the runtime scales it as though it reached ${TROGLODYTE_TONGUE_ART_REACH_TILES} — ` +
        `every strike would land ${(TROGLODYTE_TONGUE_ART_REACH_TILES - reached).toFixed(3)} ` +
        'tiles short of the range it damages from',
    );
  }
  if (reached > TROGLODYTE_TONGUE_ART_REACH_TILES + TONGUE_REACH_OVERSHOOT_LIMIT) {
    fail(
      'G16',
      `the painted tongue reaches ${reached.toFixed(3)} tiles against a declared ` +
        `${TROGLODYTE_TONGUE_ART_REACH_TILES} — further than the glow and barbs account for, so ` +
        'it would visibly overshoot the range it damages from',
    );
  }
}

/**
 * G13 — the mouth the tongue leaves from is on the creature.
 *
 * The anchors used to be a table frozen in the runtime and compared against the
 * rig on every bake. Both sides live under `src/` now and the runtime reads the
 * rig's own answer, so that comparison cannot fail any more, whatever the rig
 * says. What still can — and is the thing the old gate was really protecting —
 * is the anchor and the head parting company: the tongue is drawn from this
 * point, so a point outside the creature's painted ink is a tongue leaving from
 * somewhere near its jaw rather than out of it.
 *
 * Checked on every frame of the lash, in every view, because that is the table
 * the overlay is actually positioned from.
 */
const MOUTH_INK_SEARCH_RADIUS_PX = 3;

/** True when any ink sits within a few pixels of a point in a body cell. */
function inkNear(alpha: Uint8ClampedArray, cellX: number, cellY: number): boolean {
  const left = Math.max(0, Math.round(cellX) - MOUTH_INK_SEARCH_RADIUS_PX);
  const right = Math.min(frameWidth - 1, Math.round(cellX) + MOUTH_INK_SEARCH_RADIUS_PX);
  const top = Math.max(0, Math.round(cellY) - MOUTH_INK_SEARCH_RADIUS_PX);
  const bottom = Math.min(frameHeight - 1, Math.round(cellY) + MOUTH_INK_SEARCH_RADIUS_PX);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (alpha[y * frameWidth + x] >= INK_ALPHA_THRESHOLD) return true;
    }
  }
  return false;
}

/** The painter names the away view `back`; the runtime names it `away`. */
const LASH_ROW_OF: Record<TrogView, string> = {
  front: 'lash',
  side: 'lash_side',
  back: 'lash_away',
};

function gateMouthAnchors(): void {
  const perFrame = lashMouthAnchorsInTile();
  const resting = mouthAnchorsInTile();
  let anchorsMeasured = 0;
  for (const view of ['front', 'side', 'back'] as const) {
    const row = rowNamed(LASH_ROW_OF[view], 'G13');
    if (row === null) continue;
    const frames = perFrame[view];
    if (frames.length !== row.frameCount) {
      fail(
        'G13',
        `the ${view} lash paints ${row.frameCount} frames but the anchor table carries ` +
          `${frames.length} of them`,
      );
      continue;
    }
    frames.forEach((anchor, frame) => {
      anchorsMeasured++;
      // Tile fractions, measured from the top-left of the creature's own tile.
      const cellX = TROGLODYTE_FIGURE.tileX + anchor.x * TILE_SCALE;
      const cellY = TROGLODYTE_FIGURE.tileY + anchor.y * TILE_SCALE;
      if (inkNear(cellAlpha(row.name, frame), cellX, cellY)) return;
      fail(
        'G13',
        `${row.name}[${frame}]'s mouth anchor (${anchor.x.toFixed(4)}, ${anchor.y.toFixed(4)}) ` +
          `lands at cell pixel (${cellX.toFixed(1)}, ${cellY.toFixed(1)}), where the creature ` +
          'paints nothing — the tongue would leave from a point beside its own head',
      );
    });
    const rest = resting[view];
    anchorsMeasured++;
    const restX = TROGLODYTE_FIGURE.tileX + rest.x * TILE_SCALE;
    const restY = TROGLODYTE_FIGURE.tileY + rest.y * TILE_SCALE;
    // The fallback anchor is measured on the impact pose, so the impact frame
    // is the cell it has to sit on.
    const impactFrame = Math.floor(LASH_IMPACT_PROGRESS * row.frameCount);
    if (inkNear(cellAlpha(row.name, impactFrame), restX, restY)) continue;
    fail(
      'G13',
      `the ${view} resting mouth anchor lands at cell pixel (${restX.toFixed(1)}, ` +
        `${restY.toFixed(1)}), where ${row.name}[${impactFrame}] paints nothing`,
    );
  }
  failUnlessMeasured('G13', anchorsMeasured, 'mouth anchors');
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

function poseStream(): Array<{ row: RowSpec; frame: number; pose: TrogPose }> {
  const out: Array<{ row: RowSpec; frame: number; pose: TrogPose }> = [];
  for (const row of TROGLODYTE_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      out.push({ row, frame, pose: row.pose(frame) });
    }
  }
  return out;
}

const FOOT_FORWARD_LIMIT = 0.002;
/**
 * A foot counts as planted when its lift is inside this, rather than exactly
 * zero. An equality filter on a float is one keyed value away from matching
 * nothing at all, and a gate that matches nothing reports success.
 */
const PLANTED_LIFT_EPSILON = 1e-9;
/**
 * The fewest planted steps each foot of a travelling row must contribute.
 *
 * `failUnlessMeasured` only catches the filter emptying *completely*, and the
 * way this one fails is partial: give the stance-phase foot a computed height
 * instead of the literal zero it carries today — a heel-strike bob, a settle —
 * and most of its frames drop out of the filter while a couple survive, leaving
 * a gate that reports success on a fraction of the row. A twelve-frame walk
 * spends about half its length in stance on each side, and today's row measures
 * five steps on the left foot and six on the right.
 */
const MIN_PLANTED_STEPS_PER_FOOT = 4;
const TRAVELLING_ROWS = ['walk_side'] as const;

/**
 * G10 — a planted foot stays planted.
 *
 * The classic moonwalk, and the one defect a contact sheet is completely blind
 * to: every individual frame looks correct. A planted foot slides backward
 * under the body at a constant rate — that is what a stance phase *is*, and it
 * is the body that moves. What must never happen is a planted foot moving
 * *forward*.
 */
function gateFootSlide(): void {
  let stepsMeasured = 0;
  for (const name of TRAVELLING_ROWS) {
    const row = rowNamed(name, 'G10');
    if (row === null) continue;
    for (const side of ['leftFoot', 'rightFoot'] as const) {
      let plantedSteps = 0;
      for (let i = 1; i < row.frameCount; i++) {
        const before = row.pose(i - 1)[side];
        const now = row.pose(i)[side];
        if (Math.abs(before.y) > PLANTED_LIFT_EPSILON || Math.abs(now.y) > PLANTED_LIFT_EPSILON) {
          continue;
        }
        stepsMeasured++;
        plantedSteps++;
        const step = now.x - before.x;
        if (step > FOOT_FORWARD_LIMIT) {
          fail(
            'G10',
            `${name}'s ${side} is planted and travels ${step.toFixed(4)} tile forward between ` +
              `frames ${i - 1} and ${i} (${before.x.toFixed(4)} → ${now.x.toFixed(4)}) — that ` +
              'is a moonwalk',
          );
        }
      }
      if (plantedSteps < MIN_PLANTED_STEPS_PER_FOOT) {
        fail(
          'G10',
          `only ${plantedSteps} of ${name}'s ${row.frameCount - 1} ${side} steps count as ` +
            `planted (at least ${MIN_PLANTED_STEPS_PER_FOOT} expected) — the stance phase has ` +
            'stopped resolving to a flat zero lift, so most of the row is no longer being checked',
        );
      }
    }
  }
  failUnlessMeasured('G10', stepsMeasured, 'planted-foot steps');
}

/**
 * G11 — the IK never has to move a hand to reach its own target, and never has
 * slack to spend bowing the elbow out.
 *
 * A clamped arm locks dead straight and throws its slack sideways into the
 * elbow, which is what "the arms have a sharp elbow" always turns out to mean.
 * Both numbers are measured on the **solved** arm rather than on the target:
 * comparing a target against the shoulder it was itself built from is a
 * tautology, and the gate would then assert two constants rather than anything
 * about the figure.
 */
const CLAMP_TOLERANCE = 0.0005;
/**
 * How much of its own length a solved arm must span.
 *
 * Every target-placed hand in the choreography sits at 0.88 or 0.92 of full
 * reach on purpose — that slack is the visible break at the elbow. Rebuilding
 * the targets off the wrong shoulder drops the span to 0.72. The limit sits
 * between the two with room on both sides rather than a hair under the fault.
 */
const MIN_ARM_EXTENSION = 0.8;

function gateArmReach(): void {
  let ikArmsMeasured = 0;
  for (const { row, frame, pose } of poseStream()) {
    for (const [side, hand, angles] of [
      ['left', pose.leftHand, pose.leftArmAngles],
      ['right', pose.rightHand, pose.rightArmAngles],
    ] as const) {
      // Only an arm placed by a hand *target* can clamp; the FK-driven walk
      // arms carry their own length by construction.
      if (angles !== null) continue;
      ikArmsMeasured++;
      const chain = solvedArm(pose, row.view, side);
      const moved = Math.hypot(chain.end.x - hand.x, chain.end.y - hand.y);
      const spanned = Math.hypot(chain.end.x - chain.root.x, chain.end.y - chain.root.y);
      if (moved > CLAMP_TOLERANCE) {
        fail(
          'G11',
          `${row.name}[${frame}]'s ${side} hand target is beyond an arm ` +
            `${ARM_LENGTH.toFixed(4)} long, so the IK clamped it ${moved.toFixed(4)} short and ` +
            'locked the elbow straight',
        );
      } else if (spanned < ARM_LENGTH * MIN_ARM_EXTENSION) {
        fail(
          'G11',
          `${row.name}[${frame}]'s ${side} arm spans only ${spanned.toFixed(4)} of its own ` +
            `${ARM_LENGTH.toFixed(4)} — ${((spanned / ARM_LENGTH) * 100).toFixed(0)}%, under ` +
            `${(MIN_ARM_EXTENSION * 100).toFixed(0)}% — so the solver has slack to spend and ` +
            'will throw the elbow out sideways',
        );
      }
    }
  }
  failUnlessMeasured('G11', ikArmsMeasured, 'arms placed by a hand target');
}

/**
 * G12 — the lash's thrust peaks on the frame the mob deals its damage.
 *
 * `Troglodyte` fires its hit at the middle of the strike. A timing table that
 * drifted from the choreography puts the tongue at full reach two frames after
 * the player has already been poisoned.
 */
function gateImpactIsThePeak(): void {
  const row = rowNamed('lash_side', 'G12');
  if (row === null) return;
  let peakFrame = 0;
  let peakStoop = -Infinity;
  let framesMeasured = 0;
  for (let frame = 0; frame < row.frameCount; frame++) {
    framesMeasured++;
    const stoop = lashSide((frame + 0.5) / LASH_FRAMES).stoop;
    if (stoop > peakStoop) {
      peakStoop = stoop;
      peakFrame = frame;
    }
  }
  failUnlessMeasured('G12', framesMeasured, 'lash frames');
  const impactFrame = Math.floor(LASH_IMPACT_PROGRESS * LASH_FRAMES);
  if (Math.abs(peakFrame - impactFrame) > 1) {
    fail(
      'G12',
      `lash_side reaches its furthest thrust on frame ${peakFrame} but the mob deals damage on ` +
        `frame ${impactFrame} — the two have drifted apart`,
    );
  }
}

/**
 * Megabytes the widest single state may occupy once warm.
 *
 * The sheet-era budget was the whole texture, because the whole texture was
 * decoded whether or not anything played. A painted figure is admitted one
 * state at a time and lets go of the states it stops playing, so the number
 * that decides whether it fits is the widest row against the cache's per-figure
 * ceiling. Measured over every declared state, the single-frame gore pieces
 * included: a scan of the pose rows alone leaves them out of the figure's
 * memory accounting entirely.
 */
const ROW_BUDGET_MEGABYTES = 6;

/** G14 — the widest state's warm bytes, reported whether or not it passes. */
function gateWarmRowSize(): void {
  for (const def of [TROGLODYTE_FIGURE, TROGLODYTE_TONGUE_FIGURE]) {
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
    failUnlessMeasured('G14', statesMeasured, `${def.id} declared states`);
    if (statesMeasured === 0) continue;
    const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
    const allWarm = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
    console.log(
      `  G14 warm row: ${def.id}'s ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
        `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
        `${allWarm.toFixed(2)} MB`,
    );
    if (megabytes > ROW_BUDGET_MEGABYTES) {
      fail(
        'G14',
        `${def.id}'s ${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
          `${ROW_BUDGET_MEGABYTES} MB`,
      );
    }
  }
}

/**
 * G15 — the runtime's gore-part list is the figure's own, in the figure's
 * order.
 *
 * This one fails by dropping a body part on the floor and saying nothing,
 * because `BodyPartGoreSystem` skips a state it cannot find. Imported rather
 * than scraped out of the source: both sides live under `src/` now, and an
 * import cannot silently stop matching the way a regex can.
 */
function gateGoreContract(): void {
  const runtimeParts = [...TROGLODYTE_GORE_PARTS];
  const painted = [...GORE_STATES];
  failUnlessMeasured('G15', runtimeParts.length, 'gore parts the runtime names');
  if (
    runtimeParts.length !== painted.length ||
    runtimeParts.some((part, i) => part !== painted[i])
  ) {
    fail(
      'G15',
      `TROGLODYTE_GORE_PARTS is [${runtimeParts.join(', ')}] but the figure paints ` +
        `[${painted.join(', ')}] — a state the runtime names and the figure lacks is silently ` +
        'skipped',
    );
  }
}

/**
 * G17 — every state name the runtime can build is one the figure paints.
 *
 * Both draw paths return silently on an unknown state, so a pose name composed
 * from a base and a view that the figure does not paint is an invisible
 * creature and no log line. The prewarm lists go through the same check: a
 * prewarm of a state that does not exist warms nothing and warns nowhere.
 */
function gateRuntimeStateNames(): void {
  const tables: ReadonlyArray<readonly [readonly string[], string]> = [
    [[...TROGLODYTE_STATES], "troglodyteSprite's TROGLODYTE_STATES"],
    [[...TROGLODYTE_PREWARMED_STATES], "troglodyteSprite's TROGLODYTE_PREWARMED_STATES"],
    [[...TROGLODYTE_ATTACK_STATES], "troglodyteSprite's TROGLODYTE_ATTACK_STATES"],
    [[...TROGLODYTE_GORE_PARTS], "troglodyteSprite's TROGLODYTE_GORE_PARTS"],
  ];
  for (const [names, purpose] of tables) {
    for (const failure of missingStateFailures(TROGLODYTE_FIGURE, names, purpose)) {
      fail('G17', failure);
    }
  }
  for (const failure of missingStateFailures(
    TROGLODYTE_TONGUE_FIGURE,
    [TONGUE_STATE],
    "troglodyteSprite's tongue overlay",
  )) {
    fail('G17', failure);
  }
  // The other direction: a row the figure paints that no runtime name can reach
  // is art nobody ever sees, and it costs a cell in every accounting.
  const reachable = new Set([...TROGLODYTE_STATES, ...TROGLODYTE_GORE_PARTS]);
  let rowsMeasured = 0;
  for (const row of TROGLODYTE_ROWS) {
    rowsMeasured++;
    if (reachable.has(row.name)) continue;
    fail('G17', `the figure paints "${row.name}", which no runtime state name can reach`);
  }
  failUnlessMeasured('G17', rowsMeasured, 'painted rows');
}

/**
 * The canvas the severed pieces are measured on, big enough that no piece
 * painted about its own centre can reach an edge.
 */
const GORE_MEASURE_SPAN = 512;
const GORE_MEASURE_ORIGIN = GORE_MEASURE_SPAN / 2;
/**
 * How far a re-measured offset may sit from the frozen one, in piece units.
 *
 * Zero in principle — the same painter measured the same way — but a sub-pixel
 * band keeps the gate from firing on a rounding difference between node-canvas
 * builds rather than on the art.
 */
const GORE_RECENTRE_TOLERANCE = 1 / GORE_UNIT;

/**
 * G18 — the frozen gore recentring offsets still describe the painted pieces.
 *
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
function gateGoreRecentre(): void {
  const canvas = createCanvas(GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  const pieces = trogGorePieces();
  const paintedStates = new Set(pieces.map((piece) => piece.state));
  for (const frozenState of GORE_RECENTRE.keys()) {
    if (paintedStates.has(frozenState)) continue;
    fail(
      'G18',
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
    const alpha = new Uint8ClampedArray(GORE_MEASURE_SPAN * GORE_MEASURE_SPAN);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
    const stats = inkStatsIn(alpha, GORE_MEASURE_SPAN, GORE_MEASURE_SPAN, INK_ALPHA_THRESHOLD);
    if (stats.count === 0) {
      fail('G18', `${piece.state} painted nothing at all when measured about its own centre`);
      continue;
    }
    const measuredX = (GORE_MEASURE_ORIGIN - (stats.minX + stats.maxX) / 2) / GORE_UNIT;
    const measuredY = (GORE_MEASURE_ORIGIN - (stats.minY + stats.maxY) / 2) / GORE_UNIT;
    const frozen = GORE_RECENTRE.get(piece.state);
    if (frozen === undefined) {
      fail('G18', `the figure freezes no recentring offset for ${piece.state}`);
      continue;
    }
    const gap = Math.hypot(measuredX - frozen.x, measuredY - frozen.y);
    if (gap > GORE_RECENTRE_TOLERANCE) {
      fail(
        'G18',
        `${piece.state}'s ink centres at (${measuredX.toFixed(5)}, ${measuredY.toFixed(5)}) but ` +
          `GORE_RECENTRE freezes (${frozen.x.toFixed(5)}, ${frozen.y.toFixed(5)}) — the piece ` +
          'will orbit rather than tumble; paste the measured pair',
      );
    }
  }
  failUnlessMeasured('G18', piecesMeasured, 'gore pieces');
}

/**
 * G19 — a severed piece's ink lands on the centre of its own cell.
 *
 * The consumer's requirement, rather than a re-derivation of the arithmetic
 * G18 checks: `drawFigureCachedRotatedCenter` spins the piece about the ink
 * centre it measures off the painted cell, and a piece drawn off-centre in a
 * cell padded for a whole creature can be clipped as it turns.
 */
const GORE_CELL_CENTRING_TOLERANCE_PX = 1;

function gateGoreCentring(): void {
  let piecesMeasured = 0;
  for (const state of GORE_STATES) {
    const stats = inkStatsOf(cellAlpha(state, 0));
    if (stats.count === 0) {
      fail('G19', `${state} painted nothing at all`);
      continue;
    }
    piecesMeasured++;
    const offX = (stats.minX + stats.maxX) / 2 - frameWidth / 2;
    const offY = (stats.minY + stats.maxY) / 2 - frameHeight / 2;
    const off = Math.hypot(offX, offY);
    if (off > GORE_CELL_CENTRING_TOLERANCE_PX) {
      fail(
        'G19',
        `${state}'s ink centres ${off.toFixed(2)}px from the middle of its cell (limit ` +
          `${GORE_CELL_CENTRING_TOLERANCE_PX}px) — it will orbit rather than tumble`,
      );
    }
  }
  failUnlessMeasured('G19', piecesMeasured, 'gore pieces');
}

/** Runs every gate and returns one message per failure. */
export function troglodyteGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateAnchor();
  gateLoopClosure();
  gateMotionContinuity();
  gateCentroidDrift();
  gateGoreLegibility();
  gateGoreDistinctness();
  gateTongueRoot();
  gateTongueMonotonic();
  gateTongueReach();
  gateMouthAnchors();
  gateFootSlide();
  gateArmReach();
  gateImpactIsThePeak();
  gateWarmRowSize();
  gateGoreContract();
  gateRuntimeStateNames();
  gateGoreRecentre();
  gateGoreCentring();
  return [...failures];
}
