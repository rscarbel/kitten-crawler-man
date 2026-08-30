/**
 * The Tuskling's art gates.
 *
 * The creature has no baked sheet to inspect any more, so every invariant the
 * old bake gate enforced against sheet pixels is enforced here against cells
 * painted from `TUSKLING_FIGURE` — baked exactly the way the runtime cache
 * bakes them, supersampled and downsampled, so what is measured is what the
 * game blits. The pose-stream gates measure the rig itself and need no pixels
 * at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly: a lookup that quietly returns nothing turns a whole gate module
 * green while measuring nothing.
 *
 * Run by the review harness: `npm run render:tuskling`.
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
  TILE_SCALE,
  TUSKLING_FIGURE,
  TUSKLING_ROWS,
  type RowSpec,
} from '../src/sprites/art/tusklingFigure.js';
import { tusklingGorePieces } from '../src/sprites/art/tusklingGore.js';
import {
  JOINT_SLACK,
  SHIN_LENGTH,
  THIGH_LENGTH,
  type TusklingPose,
  ankleFor,
  solvedArm,
  solvedHeadCentre,
  solvedLegRoot,
} from '../src/sprites/art/tusklingArt.js';
import {
  TUSKLING_HOOK_FRAMES,
  TUSKLING_HOOK_IMPACT_PROGRESS,
  tusklingImpactSpriteFrame,
} from '../src/sprites/tusklingAttackTiming.js';
import {
  TUSKLING_GORE_PARTS,
  TUSKLING_PREWARMED_STATES,
  TUSKLING_STATES,
} from '../src/sprites/tusklingSprite.js';
import { asGameContext } from './nodeGameContext.js';

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const { frameWidth, frameHeight } = TUSKLING_FIGURE;

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
  const cell = bakeFigureCell(TUSKLING_FIGURE, state, frame);
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

function inkStatsOf(alpha: Uint8ClampedArray, threshold = INK_ALPHA_THRESHOLD): InkStats {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alpha[y * frameWidth + x] < threshold) continue;
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
 * `TUSKLING_ROWS`, so renaming a row would otherwise turn its gate into a
 * silent no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = TUSKLING_ROWS.find((candidate) => candidate.name === name);
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
 * to be small inside a cell sized for the widest charge.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(TUSKLING_FIGURE, { sparseStates: GORE_STATES })) {
    fail('G1', failure);
  }
}

/** How far a hoof may float above the ground line the tile box declares. */
const FOOT_FLOAT_TOLERANCE_PX = 3;
/**
 * How far below it a hoof may sit.
 *
 * Wider than the float tolerance and deliberately so: a contact shadow and the
 * hoof's own soft lower edge legitimately spill past the line, while a figure
 * that floats has nothing holding it down. One number covering both has to be
 * loosened until it catches nothing.
 */
const FOOT_HANG_TOLERANCE_PX = 6;
const STANDING_ROWS = ['idle', 'idle_side', 'idle_away'] as const;

/**
 * G2 — the hooves stand on the ground line the frozen tile box declares.
 *
 * Measured against solid alpha rather than any ink: the creature's soft edges
 * and its contact shading reach below the sole, so an ordinary-ink reading
 * measures the shadow and stays green while the figure floats.
 *
 * This cannot catch a wrong `tileY` — `paintFrame` puts its own origin on the
 * same line — and does not claim to; the parity run against the sheet is what
 * proved those numbers. What it catches is the art drifting off its own anchor.
 */
function gateAnchor(): void {
  const groundY = TUSKLING_FIGURE.tileY + GROUND_OFFSET_PX;
  let rowsMeasured = 0;
  for (const name of STANDING_ROWS) {
    const row = rowNamed(name, 'G2');
    if (row === null) continue;
    rowsMeasured++;
    const stats = inkStatsOf(cellAlpha(name, 0), SOLID_ALPHA_THRESHOLD);
    if (stats.count === 0) {
      fail('G2', `${name}[0] has no solid ink at all to stand on`);
      continue;
    }
    const drop = stats.maxY - groundY;
    if (drop < -FOOT_FLOAT_TOLERANCE_PX || drop > FOOT_HANG_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its lowest solid ink at y=${stats.maxY} against a ground line of ` +
          `${groundY} (tileY ${TUSKLING_FIGURE.tileY} + ${GROUND_OFFSET_PX}) — ` +
          `${drop.toFixed(1)}px off, allowed ${-FOOT_FLOAT_TOLERANCE_PX}..${FOOT_HANG_TOLERANCE_PX}`,
      );
    }
  }
  failUnlessMeasured('G2', rowsMeasured, 'standing rows');
}

/**
 * The most a closing loop's seam may exceed the row's own largest ordinary step.
 *
 * A cycle that closes makes the wrap from last frame to first just another step
 * of the same cycle, so the largest step inside the row is the only scale that
 * describes it. Measured over the nine loops with the ink threshold this module
 * uses, the shipped seams run 0.732–1.000 of their largest in-cycle step, the
 * two head-on idles sitting exactly at 1.000 because their seam *is* the largest
 * step. 1.15 is that plus 15%, which is all a deterministic painter needs.
 *
 * It is an art-drift check and nothing more: it cannot see how many turns a row
 * covers, because over-running the cycle raises the ordinary steps faster than
 * it raises the seam. `CYCLE_CLOSE_TOLERANCE_PX` below is what holds the cycle
 * count.
 *
 * The disjunct this replaces allowed the seam up to 2.1× the row's *median* step
 * instead, and could not fail: the idles and charges wrap at 2.08–2.29× their
 * own median as shipped, so a cycle sampled over 1.5 turns still sat comfortably
 * under it. Against this limit that same mis-sampling measures up to 1.273, and
 * a cycle stopping short at 0.7 of a turn measures up to 3.158.
 */
const LOOP_SEAM_CEILING = 1.15;
/**
 * How far the frame *after* a loop's last one may differ from its first, in
 * pixels. Zero: the shipped art closes exactly, so anything at all is a defect.
 *
 * This is the clause that carries the cycle count, and it exists because the
 * seam ratios cannot: over-running a cycle raises the ordinary steps faster than
 * it raises the seam, so a row sampled over 1.5 turns measures a *cleaner* wrap
 * than the shipped art does and no ceiling value separates them. Asking the
 * painter for one frame past the row's end is what settles it instead — the
 * painter takes a frame index, so the frame the row would play next if it kept
 * counting must paint the identical cell. That holds exactly when the phase the
 * row covers is a whole number of turns, which is what makes it a loop; it
 * holds for the two-turn idle bobs as well as the single-turn walks, and it
 * fails on both a cycle running 1.5 turns and one sampled over `frameCount - 1`
 * so its last frame repeats its first.
 *
 * Deliberately weaker than "the pose function is periodic in the frame count":
 * several rows drive a channel at half the row's own frequency — a `sin` of half
 * the cycle angle — so the poses only agree again at the whole turn, which is
 * the only place the row ever wraps.
 */
const CYCLE_CLOSE_TOLERANCE_PX = 0;
/**
 * The fewest frames a loop may spend on one turn of its own cycle.
 *
 * The closure check above pins the row to a *whole* number of turns but says
 * nothing about how many, so doubling every row's phase — `(frame * 2) /
 * frameCount` — still closes and slips through it, through both seam ratios and
 * through the continuity gate. What it actually does is halve the sampling rate,
 * which is the Nyquist failure a frame count is chosen to avoid.
 *
 * Deliberately *not* the sibling form of this check, "no interior frame may
 * reproduce frame 0". That is false of this art: measured over the loop rows
 * here, the head-on and profile idles reproduce frame 0 exactly at frame 4 of 8
 * and Donut's dance at frame 6 of 12, because those rows run two whole turns of
 * their oscillation each. Turn *count* is not the invariant; frames per turn is.
 * Shipped, the first exact repeat lands at 4, 6, 8, 12 or 16 frames, so 4 is the
 * floor the art already sits on, and it is an integer structural quantity rather
 * than a measured one — a row divides its cycle evenly or it does not, and
 * nothing can drift 4 into 3. Under a doubled phase every one of those halves,
 * and the rows sitting at 4 fall to 2.
 */
const MIN_FRAMES_PER_CYCLE_TURN = 4;
/**
 * The least a closing loop's seam may be, against the row's median step.
 *
 * A row sampled at `frame / (frameCount - 1)` instead of `frame / frameCount`
 * paints a last frame identical to its first: the cycle then spends a whole
 * frame held still, the seam goes to exactly zero, and every ceiling-only seam
 * gate stays green on it. The denominator is the median rather than the
 * narrowest step because two adjacent frames can legitimately be byte-identical,
 * which would collapse the floor into `seam >= 0`. The shipped loops wrap at
 * 1.177–2.293 of their median step, so 0.5 is far below any of them and still
 * fires the moment a seam collapses.
 */
const LOOP_SEAM_FLOOR = 0.5;

/** G3 — a loop must close: not a pop across its seam, and not a held frame. */
function gateLoopClosure(): void {
  let rowsMeasured = 0;
  for (const row of TUSKLING_ROWS) {
    if (row.kind !== 'loop') continue;
    rowsMeasured++;
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) {
      // Skipping a motionless loop here is how this gate used to go green on the
      // very row it exists to judge: with no median there is no scale for the
      // seam, and a row that has aliased into a still is the defect itself.
      fail(
        'G3',
        `${row.name} does not move at all: its median frame-to-frame step is 0px, so the row ` +
          'has aliased into a still',
      );
      continue;
    }
    const largestStep = Math.max(...steps);
    const ceiling = largestStep * LOOP_SEAM_CEILING;
    if (seam > ceiling) {
      fail(
        'G3',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a ` +
          `largest in-cycle step of ${largestStep}px (ceiling ${ceiling.toFixed(0)}px) — the ` +
          'cycle does not end where it began',
      );
    }
    const floor = typical * LOOP_SEAM_FLOOR;
    if (seam < floor) {
      fail(
        'G3',
        `${row.name} barely moves across its loop seam: last→first differs by ${seam}px against ` +
          `a median step of ${typical}px (floor ${floor.toFixed(0)}px) — the row holds still for ` +
          'a frame at the wrap, which is what sampling the cycle over frameCount-1 does',
      );
    }

    const closure = frameDelta(cells[0], cellAlpha(row.name, row.frameCount));
    if (closure > CYCLE_CLOSE_TOLERANCE_PX) {
      fail(
        'G3',
        `${row.name} does not close: the frame after its last one paints ${closure}px unlike ` +
          `${row.name}[0] (tolerance ${CYCLE_CLOSE_TOLERANCE_PX}px), so the phase this row ` +
          'covers is not a whole number of turns and the wrap is a jump',
      );
    }

    const framesPerTurn = cells.findIndex(
      (cell, frame) => frame > 0 && frameDelta(cells[0], cell) === 0,
    );
    if (framesPerTurn >= 0 && framesPerTurn < MIN_FRAMES_PER_CYCLE_TURN) {
      fail(
        'G3',
        `${row.name} is back on its first pose by frame ${framesPerTurn}, so it spends ` +
          `${framesPerTurn} frames on a turn of its cycle (floor ${MIN_FRAMES_PER_CYCLE_TURN}) — ` +
          'the row is sampled below its own rate and will strobe rather than animate',
      );
    }
  }
  failUnlessMeasured('G3', rowsMeasured, 'looping rows');
}

const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
const STEP_FLOOR_SHARE = 0.005;
/**
 * How far the worst step may exceed the *second* worst.
 *
 * Any cycle driven off a sine has a bimodal step distribution — a handful of
 * fast steps around the zero crossings and a handful of slow ones at the
 * extremes — so its median is the slow step and a perfectly smooth row scores
 * three times it. What actually distinguishes a snap is that it is a *lone*
 * outlier: real motion that is fast somewhere is fast in several places.
 *
 * The clause is only allowed to speak while the runner-up is itself an ordinary
 * step (see the ordinariness test where it is applied), because the commonest
 * rig defect is a wrong-sign keyframe: a limb teleports out on one frame and
 * back on the next, which is *two* equal huge steps. Uncapped, the runner-up
 * would then be the defect sizing its own allowance, and the gate would be green
 * on precisely what it exists to catch.
 */
const STEP_VS_RUNNER_UP = 1.35;

/** G4 — no consecutive-frame step far above the row's own median. */
function gateMotionContinuity(): void {
  const cellArea = frameWidth * frameHeight;
  let stepsMeasured = 0;
  for (const row of TUSKLING_ROWS) {
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    stepsMeasured += steps.length;
    const typical = median(steps);
    const runnerUp = [...steps].sort((a, b) => b - a)[1] ?? 0;
    const limitShare = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const ordinaryStepLimit = typical * limitShare;
    const runnerUpIsOrdinary = runnerUp <= ordinaryStepLimit;
    const loneOutlierAllowance = runnerUpIsOrdinary ? runnerUp * STEP_VS_RUNNER_UP : 0;
    const allowed = Math.max(ordinaryStepLimit, loneOutlierAllowance, cellArea * STEP_FLOOR_SHARE);
    steps.forEach((step, i) => {
      if (step > allowed) {
        fail(
          'G4',
          `${row.name} snaps between frames ${i} and ${i + 1}: ${step}px changed against a ` +
            `median step of ${typical}px (allowed ${allowed.toFixed(0)}px)`,
        );
      }
    });
  }
  failUnlessMeasured('G4', stepsMeasured, 'frame-to-frame steps');
}

const CENTROID_SEAM_LIMIT = 1.6;
/**
 * A cycle whose speed is not uniform — anything driven off a sine — has some
 * in-cycle steps much larger than the median, and the seam may legitimately be
 * one of them. Without this clause the gate fires on correct animation.
 */
const CENTROID_SEAM_VS_WORST_STEP = 1.25;
const CENTROID_SEAM_FLOOR_PX = 1;

/** G5 — a loop's ink centroid must come back to where it started. */
function gateCentroidDrift(): void {
  let loopsMeasured = 0;
  for (const row of TUSKLING_ROWS) {
    if (row.kind !== 'loop') continue;
    loopsMeasured++;
    const stats = cellsOfRow(row).map((cell) => inkStatsOf(cell));
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
    const first = stats[0];
    const seam = Math.hypot(last.centroidX - first.centroidX, last.centroidY - first.centroidY);
    const allowed = Math.max(
      median(steps) * CENTROID_SEAM_LIMIT,
      Math.max(...steps) * CENTROID_SEAM_VS_WORST_STEP,
      CENTROID_SEAM_FLOOR_PX,
    );
    if (seam > allowed) {
      fail(
        'G5',
        `${row.name} slides across its loop seam: the ink centroid moves ${seam.toFixed(2)}px ` +
          `against a typical step of ${median(steps).toFixed(2)}px (allowed ${allowed.toFixed(2)}px)`,
      );
    }
  }
  failUnlessMeasured('G5', loopsMeasured, 'loop rows');
}

/**
 * How far a one-shot's last frame may sit from frame 0 of the row it hands to,
 * as a share of the cell.
 *
 * Measured on the shipped art: the three snorts land on their charge exactly
 * (0px), and the hooks come back to standing within 136, 43 and 132px of a
 * 104×88 cell — 1.5% at worst. 2.2% is that plus half again, and it is what
 * makes the gate speak: at the inherited 5% a hook left holding a quarter-tile
 * crouch on its final frame was still inside the allowance on two of its three
 * views.
 */
const SETTLE_LIMIT_SHARE = 0.022;
/**
 * A one-shot hands off to whatever plays next. The hook returns to standing;
 * the wind-up hands off to the charge, and settling it back to standing first
 * would put a visible flinch between the telegraph and the sprint.
 */
const ONE_SHOT_SETTLES: ReadonlyArray<readonly [string, string]> = [
  ['hook', 'idle'],
  ['hook_side', 'idle_side'],
  ['hook_away', 'idle_away'],
  ['snort', 'charge'],
  ['snort_side', 'charge_side'],
  ['snort_away', 'charge_away'],
];

/** G6 — a one-shot's last frame must match frame 0 of the row it hands off to. */
function gateOneShotSettle(): void {
  const cellArea = frameWidth * frameHeight;
  let pairsMeasured = 0;
  for (const [shot, settle] of ONE_SHOT_SETTLES) {
    const shotRow = rowNamed(shot, 'G6');
    const settleRow = rowNamed(settle, 'G6');
    if (shotRow === null || settleRow === null) continue;
    pairsMeasured++;
    const last = cellAlpha(shotRow.name, shotRow.frameCount - 1);
    const target = cellAlpha(settleRow.name, 0);
    const delta = frameDelta(last, target);
    const allowed = cellArea * SETTLE_LIMIT_SHARE;
    if (delta > allowed) {
      fail(
        'G6',
        `${shot} does not hand off to ${settle}: its last frame differs from ${settle}[0] by ` +
          `${delta}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
  }
  failUnlessMeasured('G6', pairsMeasured, 'one-shot hand-offs');
}

const IN_GAME_TILE = 32;
const GORE_MIN_SHORT_AXIS_PX = 9;

/** G7 — every gore piece must still be a shape at the size it actually renders. */
function gateGoreLegibility(): void {
  const screenScale = IN_GAME_TILE / TILE_SCALE;
  let piecesMeasured = 0;
  for (const state of GORE_STATES) {
    piecesMeasured++;
    const stats = inkStatsOf(cellAlpha(state, 0));
    if (stats.count === 0) {
      fail('G7', `${state} painted nothing at all`);
      continue;
    }
    const shortAxis =
      (Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) + 1) * screenScale;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'G7',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis in game (limit ` +
          `${GORE_MIN_SHORT_AXIS_PX}px) — at that size it is a speck, not a body part`,
      );
    }
  }
  failUnlessMeasured('G7', piecesMeasured, 'gore pieces');
}

const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function maskOf(state: string): boolean[] {
  const alpha = cellAlpha(state, 0);
  const stats = inkStatsOf(alpha);
  const width = Math.max(1, stats.maxX - stats.minX + 1);
  const height = Math.max(1, stats.maxY - stats.minY + 1);
  // Scale is normalised away but aspect deliberately is not: stretching each
  // piece to fill its own bounding box maps every convex blob onto a filled
  // square and measures the normalisation rather than the art.
  const span = Math.max(width, height);
  const mask: boolean[] = Array.from({ length: DISTINCT_MASK * DISTINCT_MASK }, () => false);
  for (let y = 0; y < DISTINCT_MASK; y++) {
    for (let x = 0; x < DISTINCT_MASK; x++) {
      const sourceX = Math.round(
        stats.minX + (width - span) / 2 + ((x + 0.5) / DISTINCT_MASK) * span,
      );
      const sourceY = Math.round(
        stats.minY + (height - span) / 2 + ((y + 0.5) / DISTINCT_MASK) * span,
      );
      if (sourceX < 0 || sourceY < 0 || sourceX >= frameWidth) continue;
      if (sourceY * frameWidth + sourceX >= alpha.length) continue;
      mask[y * DISTINCT_MASK + x] = alpha[sourceY * frameWidth + sourceX] >= INK_ALPHA_THRESHOLD;
    }
  }
  return mask;
}

/** G8 — no two gore pieces may share a silhouette. */
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
          'G8',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} share ${(iou * 100).toFixed(0)}% of their ` +
            `silhouette (limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%) — they will read as ` +
            'the same piece',
        );
      }
    }
  }
  failUnlessMeasured('G8', pairsMeasured, 'gore piece pairings');
}

/**
 * Megabytes the widest single state may occupy once warm.
 *
 * The sheet-era budget was the whole texture, because the whole texture was
 * decoded whether or not anything played. A painted figure is admitted one
 * state at a time and lets go of the states it stops playing, so the number
 * that decides whether it fits is the widest row against the cache's
 * per-figure ceiling. Well under it here, and it has to stay there: eight
 * Tusklings arriving at once share these rows, but a floor's worth of packs
 * shares the global ceiling.
 */
const ROW_BUDGET_MEGABYTES = 6;

/** G9 — the widest state's warm bytes, reported whether or not it passes. */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of TUSKLING_FIGURE.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G9', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G9 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarmMegabytes.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G9',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

function poseStream(): Array<{ row: RowSpec; frame: number; pose: TusklingPose }> {
  const out: Array<{ row: RowSpec; frame: number; pose: TusklingPose }> = [];
  for (const row of TUSKLING_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      out.push({ row, frame, pose: row.pose(frame) });
    }
  }
  return out;
}

const FOOT_DOWN_LIMIT = 0.002;
const CONTACT_ROLL_TOLERANCE = 0.012;
/**
 * A hoof counts as planted when its lift is inside this, rather than exactly
 * zero. An equality filter on a float is one keyed value away from matching
 * nothing at all, and a gate that matches nothing reports success.
 */
const PLANTED_LIFT_EPSILON = 1e-9;
const TRAVELLING_ROWS = ['walk_side', 'charge_side'] as const;
/**
 * The share of a travelling row's frames each hoof must contribute as planted
 * steps.
 *
 * `failUnlessMeasured` only catches the planted filter emptying *completely*,
 * and the way this one fails is partial: giving the stance-phase hoof a
 * computed height instead of the literal zero it carries today — a heel-strike
 * bob, a settle — drops one row out of the filter while the other keeps the
 * gate green. Writing `1e-7` into `gaitFootSide`'s stance height did exactly
 * that: every walk_side step stopped being examined and the gate still passed,
 * because charge_side was still contributing.
 *
 * A gait spends about half its cycle in stance on each side, so a quarter of
 * the row's frames per hoof leaves room for the keying to move while staying
 * decisive: shipped, walk_side measures 7 and 8 steps against a floor of 4, and
 * charge_side 3 and 4 against a floor of 2, while an emptied filter scores 0.
 */
const PLANTED_STEP_SHARE = 4;
const MIN_PLANTED_STEPS_PER_FOOT = 2;

/**
 * G10 — a planted hoof never slips.
 *
 * A walk cycle plays on the spot with the world scrolling past, so its planted
 * hoof has to roll backward at exactly the speed the body is notionally moving
 * forward. "x must be constant" fails every correct walk cycle ever authored;
 * what actually holds is that the hoof never moves *forward* while down, and
 * that each backward step is the same size as the last.
 */
function gateFootSlide(): void {
  let stepsMeasured = 0;
  for (const name of TRAVELLING_ROWS) {
    const row = rowNamed(name, 'G10');
    if (row === null) continue;
    const requiredPlantedSteps = Math.max(
      MIN_PLANTED_STEPS_PER_FOOT,
      Math.floor(row.frameCount / PLANTED_STEP_SHARE),
    );
    for (const side of ['leftFoot', 'rightFoot'] as const) {
      let previousStep: number | null = null;
      let plantedSteps = 0;
      for (let i = 1; i < row.frameCount; i++) {
        const before = row.pose(i - 1)[side];
        const now = row.pose(i)[side];
        if (Math.abs(before.y) > PLANTED_LIFT_EPSILON || Math.abs(now.y) > PLANTED_LIFT_EPSILON) {
          previousStep = null;
          continue;
        }
        stepsMeasured++;
        plantedSteps++;
        const step = now.x - before.x;
        if (step > FOOT_DOWN_LIMIT) {
          fail(
            'G10',
            `${name}'s ${side} moves ${step.toFixed(4)} tile *forward* between frames ${i - 1} ` +
              `and ${i} while planted`,
          );
        }
        if (previousStep !== null && Math.abs(step - previousStep) > CONTACT_ROLL_TOLERANCE) {
          fail(
            'G10',
            `${name}'s ${side} rolls unevenly: ${Math.abs(step).toFixed(4)} tile between frames ` +
              `${i - 1} and ${i} against ${Math.abs(previousStep).toFixed(4)} before it ` +
              `(tolerance ${CONTACT_ROLL_TOLERANCE})`,
          );
        }
        previousStep = step;
      }
      if (plantedSteps < requiredPlantedSteps) {
        fail(
          'G10',
          `only ${plantedSteps} of ${name}'s ${row.frameCount - 1} ${side} steps count as ` +
            `planted (at least ${requiredPlantedSteps} expected) — the stance phase has stopped ` +
            'resolving to a flat zero lift, so most of the row is no longer being checked',
        );
      }
    }
  }
  failUnlessMeasured('G10', stepsMeasured, 'planted-hoof steps');
}

const LEG_REACH_LIMIT = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

/**
 * G11 — hip → ankle stays inside the leg's span on *every* frame.
 *
 * Measured off the pose the choreography asks for, never off the solved chain:
 * the IK clamps, so a solved leg can only ever report a length it can reach and
 * the gate would be measuring the clamp instead of the demand on it. One
 * clamped frame locks the leg straight, the next tuck snaps it back, and the
 * result reads as a hop rather than as a walk.
 */
function gateLegReach(): void {
  let worst = 0;
  let worstAt = '';
  let legsMeasured = 0;
  for (const { row, frame, pose } of poseStream()) {
    for (const [side, foot, pitch] of [
      ['left', pose.leftFoot, pose.leftFootPitch],
      ['right', pose.rightFoot, pose.rightFootPitch],
    ] as const) {
      legsMeasured++;
      const root = solvedLegRoot(pose, row.view, side);
      const ankle = ankleFor(foot, pitch);
      const reach = Math.hypot(ankle.x - root.x, ankle.y - root.y);
      if (reach > worst) {
        worst = reach;
        worstAt = `${row.name}[${frame}] ${side}`;
      }
      if (reach > LEG_REACH_LIMIT) {
        fail(
          'G11',
          `${row.name}[${frame}]'s ${side} leg has to span ${reach.toFixed(4)} from its root ` +
            `against a leg ${LEG_REACH_LIMIT.toFixed(4)} long — the IK clamps and the step ` +
            'becomes a hop',
        );
      }
    }
  }
  failUnlessMeasured('G11', legsMeasured, 'legs');
  console.log(
    `  G11 leg reach: worst frame spans ${worst.toFixed(4)} of ${LEG_REACH_LIMIT.toFixed(4)} (${worstAt})`,
  );
}

const CLAMP_TOLERANCE = 0.0005;
const MIN_ELBOW_DEGREES = 22;

/** G12 — no arm folds implausibly flat, and no IK arm is clamped short. */
function gateArmReach(): void {
  let elbowsMeasured = 0;
  let ikArmsMeasured = 0;
  for (const { row, frame, pose } of poseStream()) {
    for (const [side, hand, angles] of [
      ['left', pose.leftHand, pose.leftArmAngles],
      ['right', pose.rightHand, pose.rightArmAngles],
    ] as const) {
      const chain = solvedArm(pose, row.view, side);
      const upper = Math.hypot(chain.joint.x - chain.root.x, chain.joint.y - chain.root.y);
      const lower = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
      const span = Math.hypot(chain.end.x - chain.root.x, chain.end.y - chain.root.y);
      const cosine = (upper * upper + lower * lower - span * span) / (2 * upper * lower);
      const elbow = Math.acos(Math.min(1, Math.max(-1, cosine))) * DEGREES_PER_RADIAN;
      elbowsMeasured++;
      if (elbow < MIN_ELBOW_DEGREES) {
        fail(
          'G12',
          `${row.name}[${frame}]'s ${side} elbow folds to ${elbow.toFixed(1)}° (limit ` +
            `${MIN_ELBOW_DEGREES}°) — the forearm doubles back over the upper arm`,
        );
      }
      // Only an arm placed by a hand target can clamp.
      if (angles !== null) continue;
      ikArmsMeasured++;
      const moved = Math.hypot(chain.end.x - hand.x, chain.end.y - hand.y);
      if (moved > CLAMP_TOLERANCE) {
        fail(
          'G12',
          `${row.name}[${frame}]'s ${side} hand target is out of reach: the IK clamped it ` +
            `${moved.toFixed(4)} short`,
        );
      }
    }
  }
  failUnlessMeasured('G12', elbowsMeasured, 'elbows');
  failUnlessMeasured('G12', ikArmsMeasured, 'arms placed by a hand target');
}

const HOOK_ROWS = ['hook', 'hook_side', 'hook_away'] as const;

/**
 * G13 — the declared impact frame is the extreme of the hook.
 *
 * A timing table that drifted from the choreography is invisible in every other
 * gate: the row still animates, the damage still lands, and the two simply stop
 * describing the same moment.
 */
function gateImpactIsThePeak(): void {
  const declared = tusklingImpactSpriteFrame(TUSKLING_HOOK_FRAMES, TUSKLING_HOOK_IMPACT_PROGRESS);
  let rowsMeasured = 0;
  // Every hook row, not only the profile: the front and away rows are what the
  // runtime plays for two of the four facings, and they share a base pose only
  // until somebody tunes one of them.
  for (const name of HOOK_ROWS) {
    const row = rowNamed(name, 'G13');
    if (row === null) continue;
    rowsMeasured++;
    let peakFrame = 0;
    let peakTilt = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const tilt = row.pose(frame).headTilt;
      if (tilt > peakTilt) {
        peakTilt = tilt;
        peakFrame = frame;
      }
    }
    if (peakFrame !== declared) {
      fail(
        'G13',
        `${name} reaches its furthest head tilt on frame ${peakFrame}, but the shared timing ` +
          `puts the impact on frame ${declared} (progress ${TUSKLING_HOOK_IMPACT_PROGRESS} of ` +
          `${TUSKLING_HOOK_FRAMES} frames)`,
      );
    }
  }
  failUnlessMeasured('G13', rowsMeasured, 'hook rows');
}

const CHARGE_MIN_HEAD_DROP = 0.1;

/**
 * G14 — the charge actually lowers the head.
 *
 * The whole read of the attack is the skull dropping in front of the chest so
 * the tusks lead. A charge row whose head sits where the idle's does is a
 * Tuskling jogging, and no other gate can tell the difference.
 */
function gateChargeLeadsWithTheHead(): void {
  const chargeRows = [
    ['charge', 'idle'],
    ['charge_side', 'idle_side'],
    ['charge_away', 'idle_away'],
  ] as const;
  let framesMeasured = 0;
  for (const [name, idleName] of chargeRows) {
    const charge = rowNamed(name, 'G14');
    const idle = rowNamed(idleName, 'G14');
    if (charge === null || idle === null) continue;
    const idleHead = solvedHeadCentre(idle.pose(0), idle.view);
    for (let frame = 0; frame < charge.frameCount; frame++) {
      framesMeasured++;
      const head = solvedHeadCentre(charge.pose(frame), charge.view);
      const drop = head.y - idleHead.y;
      if (drop < CHARGE_MIN_HEAD_DROP) {
        fail(
          'G14',
          `${name}[${frame}] carries its head only ${drop.toFixed(3)} tile below where ${idleName} ` +
            `does (limit ${CHARGE_MIN_HEAD_DROP}) — the tusks are not leading`,
        );
      }
    }
  }
  failUnlessMeasured('G14', framesMeasured, 'charge frames');
}

/**
 * G15 — the runtime's gore-part list matches the figure, element for element.
 *
 * This one fails by dropping a body part on the floor and saying nothing,
 * because `BodyPartGoreSystem` skips a state it cannot find. Imported rather
 * than scraped out of the source: both sides live under `src/` now, and an
 * import cannot silently stop matching the way a regex can.
 */
function gateGoreContract(): void {
  const runtimeParts = [...TUSKLING_GORE_PARTS];
  const painted = [...GORE_STATES];
  failUnlessMeasured('G15', runtimeParts.length, 'gore parts the runtime names');
  if (
    runtimeParts.length !== painted.length ||
    runtimeParts.some((part, i) => part !== painted[i])
  ) {
    fail(
      'G15',
      `TUSKLING_GORE_PARTS is [${runtimeParts.join(', ')}] but the figure paints ` +
        `[${painted.join(', ')}] — a state the runtime names and the figure lacks is ` +
        'silently skipped',
    );
  }
}

/**
 * G16 — every state name the runtime can build is one the figure paints.
 *
 * Both draw paths return silently on an unknown state, so a pose name composed
 * from a base and a view that the figure does not paint is an invisible
 * creature and no log line. The prewarm list goes through the same check: a
 * prewarm of a state that does not exist warms nothing and warns nowhere.
 */
function gateRuntimeStateNames(): void {
  for (const failure of missingStateFailures(
    TUSKLING_FIGURE,
    [...TUSKLING_STATES],
    "tusklingSprite's TUSKLING_STATES",
  )) {
    fail('G16', failure);
  }
  for (const failure of missingStateFailures(
    TUSKLING_FIGURE,
    [...TUSKLING_PREWARMED_STATES],
    "tusklingSprite's TUSKLING_PREWARMED_STATES",
  )) {
    fail('G16', failure);
  }
  for (const failure of missingStateFailures(
    TUSKLING_FIGURE,
    [...TUSKLING_GORE_PARTS],
    "tusklingSprite's TUSKLING_GORE_PARTS",
  )) {
    fail('G16', failure);
  }
  // The other direction: a row the figure paints that no runtime name can
  // reach is art nobody ever sees, and it costs a cell in every accounting.
  const reachable = new Set([...TUSKLING_STATES, ...TUSKLING_GORE_PARTS]);
  let rowsMeasured = 0;
  for (const row of TUSKLING_ROWS) {
    rowsMeasured++;
    if (reachable.has(row.name)) continue;
    fail('G16', `the figure paints "${row.name}", which no runtime state name can reach`);
  }
  failUnlessMeasured('G16', rowsMeasured, 'painted rows');
}

/**
 * The canvas the gore pieces are measured on, big enough that no piece painted
 * about its centre can reach an edge.
 */
const GORE_MEASURE_SPAN = 512;
const GORE_MEASURE_ORIGIN = GORE_MEASURE_SPAN / 2;
const GORE_INK_ALPHA = 8;
/**
 * How far a re-measured offset may sit from the frozen one, in piece units.
 *
 * Zero in principle — the same painter measured the same way — but a sub-pixel
 * band keeps the gate from firing on a rounding difference between node-canvas
 * builds rather than on the art.
 */
const GORE_RECENTRE_TOLERANCE = 1 / GORE_UNIT;

/**
 * G17 — the frozen gore recentring offsets still describe the painted pieces.
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
  const pieces = tusklingGorePieces();
  const paintedStates = new Set(pieces.map((piece) => piece.state));
  for (const frozenState of GORE_RECENTRE.keys()) {
    if (paintedStates.has(frozenState)) continue;
    fail(
      'G17',
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
        if (data[(y * GORE_MEASURE_SPAN + x) * CHANNELS + ALPHA_OFFSET] < GORE_INK_ALPHA) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) {
      fail('G17', `${piece.state} painted nothing at all when measured about its own centre`);
      continue;
    }
    const measuredX = (GORE_MEASURE_ORIGIN - (minX + maxX) / 2) / GORE_UNIT;
    const measuredY = (GORE_MEASURE_ORIGIN - (minY + maxY) / 2) / GORE_UNIT;
    const frozen = GORE_RECENTRE.get(piece.state);
    if (frozen === undefined) {
      fail('G17', `the figure freezes no recentring offset for ${piece.state}`);
      continue;
    }
    const gap = Math.hypot(measuredX - frozen.x, measuredY - frozen.y);
    if (gap > GORE_RECENTRE_TOLERANCE) {
      fail(
        'G17',
        `${piece.state}'s ink centres at (${measuredX.toFixed(5)}, ${measuredY.toFixed(5)}) but ` +
          `GORE_RECENTRE freezes (${frozen.x.toFixed(5)}, ${frozen.y.toFixed(5)}) — the piece ` +
          'will orbit rather than tumble; paste the measured pair',
      );
    }
  }
  failUnlessMeasured('G17', piecesMeasured, 'gore pieces');
}

/** Runs every gate and returns one message per failure. */
export function tusklingGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateAnchor();
  gateLoopClosure();
  gateMotionContinuity();
  gateCentroidDrift();
  gateOneShotSettle();
  gateGoreLegibility();
  gateGoreDistinctness();
  gateWarmRowSize();
  gateFootSlide();
  gateLegReach();
  gateArmReach();
  gateImpactIsThePeak();
  gateChargeLeadsWithTheHead();
  gateGoreContract();
  gateRuntimeStateNames();
  gateGoreRecentre();
  return [...failures];
}
