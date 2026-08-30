/**
 * The Juicer's art gates.
 *
 * The creature has no baked sheet to inspect any more, so every invariant the
 * old bake gate enforced against sheet pixels is enforced here against cells
 * painted from `JUICER_FIGURE` — baked exactly the way the runtime cache bakes
 * them, supersampled and downsampled, so what is measured is what the game
 * blits. The pose-stream gates measure the rig itself and need no pixels at
 * all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly: a lookup that quietly returns nothing turns a whole gate module
 * green while measuring nothing.
 *
 * Run by the review harness: `npm run render:juicer`.
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
import {
  GORE_RECENTRE,
  GORE_STATES,
  GORE_UNIT,
  GROUND_OFFSET_PX,
  JUICER_FIGURE,
  JUICER_ROWS,
  TILE_SCALE,
  type RowSpec,
  carryAnchors,
  CARRY_DRIFT_LIMIT_TILES,
  throwAnchors,
  worstCarryDrift,
} from '../src/sprites/art/juicerFigure.js';
import { juicerGorePieces } from '../src/sprites/art/juicerGore.js';
import {
  JOINT_SLACK,
  type JuicerPose,
  SHIN_LENGTH,
  THIGH_LENGTH,
  ankleFor,
  solvedArm,
  solvedHip,
  solvedLegRoot,
  solvedShoulderCentre,
} from '../src/sprites/art/juicerArt.js';
import {
  JUICER_PUNCH_FRAMES,
  JUICER_PUNCH_IMPACT_PROGRESS,
  JUICER_THROW_FRAMES,
  JUICER_THROW_RELEASE_PROGRESS,
  juicerImpactSpriteFrame,
} from '../src/sprites/juicerAttackTiming.js';
import {
  JUICER_CARRY_HAND_ANCHORS,
  JUICER_THROW_HAND_ANCHORS,
  type JuicerHandView,
  type TileFraction,
} from '../src/sprites/juicerHandAnchor.js';
import { asGameContext } from './nodeGameContext.js';

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const DEGREES_PER_RADIAN = 180 / Math.PI;

const { frameWidth, frameHeight } = JUICER_FIGURE;

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
  const cell = bakeFigureCell(JUICER_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

const rgbaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's full RGBA, baked as the runtime cache bakes it. */
function cellRgba(state: string, frame: number): Uint8ClampedArray {
  const key = `${state}[${frame}]`;
  const cached = rgbaByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(JUICER_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  rgbaByCell.set(key, data);
  return data;
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
 * `JUICER_ROWS`, so renaming a row would otherwise turn its gate into a silent
 * no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = JUICER_ROWS.find((candidate) => candidate.name === name);
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
 * empty. The gore states are exempt from the fill check: a severed forearm is
 * meant to be small inside a cell sized for a 2.3-tile creature.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(JUICER_FIGURE, { sparseStates: GORE_STATES })) {
    fail('G1', failure);
  }
}

const FOOT_TOLERANCE_PX = 6;
const STANDING_ROWS = ['idle', 'idle_side', 'idle_away'] as const;

/**
 * G2 — the feet stand where `tileY` claims the ground is.
 *
 * Measured against the solid-alpha threshold, so the soft contact shadow under
 * him does not count as the lowest ink and quietly satisfy the gate.
 *
 * This cannot catch a wrong `tileY` — `paintFrame` puts its own origin on the
 * same line, so both sides of the comparison move together — and does not claim
 * to; the parity run against the sheet is what proved that number. What it
 * catches is the art drifting off its own anchor.
 */
function gateAnchor(): void {
  const groundY = JUICER_FIGURE.tileY + GROUND_OFFSET_PX;
  let rowsMeasured = 0;
  for (const name of STANDING_ROWS) {
    const row = rowNamed(name, 'G2');
    if (row === null) continue;
    const stats = inkStatsOf(cellAlpha(row.name, 0), SOLID_ALPHA_THRESHOLD);
    if (stats.count === 0) {
      fail('G2', `${name}[0] paints no solid ink at all to stand on`);
      continue;
    }
    rowsMeasured++;
    const drop = Math.abs(stats.maxY - groundY);
    if (drop > FOOT_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its lowest solid ink at y=${stats.maxY} against a ground line of ` +
          `${groundY} (tileY ${JUICER_FIGURE.tileY} + ${GROUND_OFFSET_PX}) — ` +
          `${drop.toFixed(1)}px off, limit ${FOOT_TOLERANCE_PX}`,
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
 * describes it. Measured over his nine loops with the ink threshold this module
 * uses, the shipped seams run 0.678–1.000 of their largest in-cycle step, the
 * two head-on idles sitting exactly at 1.000 because their seam *is* the largest
 * step. 1.15 is that plus 15%, which is all a deterministic painter needs.
 *
 * It is an art-drift check and nothing more: it cannot see how many turns a row
 * covers, because over-running the cycle raises the ordinary steps faster than
 * it raises the seam. `CYCLE_CLOSE_TOLERANCE_PX` below is what holds the cycle
 * count.
 *
 * The disjunct this replaces allowed the seam up to 2.1× the row's *median* step
 * instead, and could not fail: his idles wrap at 2.27–2.65× their own median as
 * shipped, so a cycle sampled over 1.5 turns still sat comfortably under it.
 * Against this limit that same mis-sampling measures up to 1.592, and a cycle
 * stopping short at 0.7 of a turn measures up to 3.471.
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
 * which would collapse the floor into `seam >= 0`. His shipped loops wrap at
 * 1.040–2.649 of their median step, so 0.5 is far below any of them and still
 * fires the moment a seam collapses.
 */
const LOOP_SEAM_FLOOR = 0.5;

/** G3 — a loop must close: not a pop across its seam, and not a held frame. */
function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const row of JUICER_ROWS) {
    if (row.kind !== 'loop') continue;
    loopsMeasured++;
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) {
      // A loop whose frames are pixel-identical has aliased to a freeze — the
      // Nyquist failure this row's frame count is chosen to avoid — and the
      // seam comparison below has no scale left to measure against.
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
  failUnlessMeasured('G3', loopsMeasured, 'looping rows');
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
 * several times it. What actually distinguishes a snap is that it is a *lone*
 * outlier: real motion that is fast somewhere is fast in several places.
 *
 * The clause is only allowed to speak while the runner-up is itself an ordinary
 * step (see the ordinariness test where it is applied), because the commonest
 * rig defect is a wrong-sign keyframe: a limb teleports out on one frame and
 * back on the next, which is *two* equal huge steps. Uncapped, the runner-up
 * would then be the defect sizing its own allowance, and the gate would be
 * green on precisely what it exists to catch.
 */
const STEP_VS_RUNNER_UP = 1.35;
/**
 * The slam is a declared spike. Both punch rows fold him from standing to
 * fists-on-the-floor across the two frames either side of impact, and that is
 * the attack — flattening it to pass a continuity threshold would remove the
 * only frames the player reads as a blow.
 */
const PUNCH_IMPACT_FRAME = juicerImpactSpriteFrame(
  JUICER_PUNCH_FRAMES,
  JUICER_PUNCH_IMPACT_PROGRESS,
);
const PUNCH_ROWS = ['punch', 'punch_side', 'punch_away'] as const;

function isDeclaredSpike(row: string, step: number): boolean {
  const isPunch = PUNCH_ROWS.some((name) => name === row);
  return isPunch && (step === PUNCH_IMPACT_FRAME - 1 || step === PUNCH_IMPACT_FRAME);
}

/** G4 — no consecutive-frame step far above the row's own median. */
function gateMotionContinuity(): void {
  const cellArea = frameWidth * frameHeight;
  let stepsMeasured = 0;
  for (const row of JUICER_ROWS) {
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
      if (step > allowed && !isDeclaredSpike(row.name, i)) {
        fail(
          'G4',
          `${row.name} snaps between frames ${i} and ${i + 1}: ${step}px changed against a ` +
            `median step of ${typical}px and a runner-up of ${runnerUp}px ` +
            `(allowed ${allowed.toFixed(0)}px)`,
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
  for (const row of JUICER_ROWS) {
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
          `against a typical step of ${median(steps).toFixed(2)}px ` +
          `(allowed ${allowed.toFixed(2)}px)`,
      );
    }
  }
  failUnlessMeasured('G5', loopsMeasured, 'looping rows');
}

/**
 * How far the *second to last* frame of a one-shot may still sit from the idle
 * it hands to, as a share of the cell.
 *
 * The last frame is not measurable: the choreography ends every one-shot with a
 * blend that returns the idle pose identically on its final key, so the last
 * frame's distance to the idle is zero by construction whatever the recovery
 * arc does. A gate reading it measures the blend rather than the art. What the
 * player actually sees is the approach, so the gate reads the frame before —
 * that one carries the pose's own recovery and nothing hands it to the gate for
 * free.
 */
const PENULTIMATE_SETTLE_SHARE = 0.06;
/**
 * How many frames of the run-in have to be converging on the idle.
 *
 * A recovery that wanders away from the idle and is then yanked back by the
 * blend is the defect this half catches: every one of these steps has to be
 * closer to the idle than the one before it.
 */
const SETTLE_APPROACH_FRAMES = 4;
/**
 * Every one-shot here hands back to the idle of its own view: the throw's
 * follow-through and the punch's recovery both end standing, and there is no
 * third row either of them flows into.
 */
const ONE_SHOT_SETTLES: ReadonlyArray<readonly [string, string]> = [
  ['throw', 'idle'],
  ['throw_side', 'idle_side'],
  ['throw_away', 'idle_away'],
  ['punch', 'idle'],
  ['punch_side', 'idle_side'],
  ['punch_away', 'idle_away'],
];

/** G6 — a one-shot's recovery arc converges on the row it hands off to. */
function gateOneShotSettle(): void {
  const cellArea = frameWidth * frameHeight;
  let approachesMeasured = 0;
  for (const [shot, settle] of ONE_SHOT_SETTLES) {
    const shotRow = rowNamed(shot, 'G6');
    const settleRow = rowNamed(settle, 'G6');
    if (shotRow === null || settleRow === null) continue;
    // The final frame is excluded on purpose: it is the blend's fixed point.
    const framesNeeded = SETTLE_APPROACH_FRAMES + 1;
    if (shotRow.frameCount < framesNeeded) {
      fail(
        'G6',
        `${shot} has only ${shotRow.frameCount} frames, too few to show a ` +
          `${SETTLE_APPROACH_FRAMES}-frame approach to ${settle}`,
      );
      continue;
    }
    const idle = cellAlpha(settleRow.name, 0);
    const approach: number[] = [];
    for (let back = framesNeeded; back >= 2; back--) {
      approach.push(frameDelta(cellAlpha(shotRow.name, shotRow.frameCount - back), idle));
    }

    const penultimate = approach[approach.length - 1];
    const allowed = cellArea * PENULTIMATE_SETTLE_SHARE;
    if (penultimate > allowed) {
      fail(
        'G6',
        `${shot} is still ${penultimate}px away from ${settle}[0] one frame before it ends ` +
          `(allowed ${allowed.toFixed(0)}px) — the whole hand-off is crammed into the final ` +
          `blend, so the player sees the recovery as a single jump`,
      );
    }

    approach.forEach((distance, i) => {
      approachesMeasured++;
      if (i === 0) return;
      if (distance < approach[i - 1]) return;
      const framesFromEnd = SETTLE_APPROACH_FRAMES - i;
      fail(
        'G6',
        `${shot} stops converging on ${settle}: ${framesFromEnd} frames from the end it is ` +
          `${distance}px from ${settle}[0], no closer than the ${approach[i - 1]}px before it — ` +
          `the recovery arc moves away from the idle it hands to`,
      );
    });
  }
  failUnlessMeasured('G6', approachesMeasured, 'one-shot approach frames');
}

const IN_GAME_TILE = 32;
const GORE_MIN_SHORT_AXIS_PX = 9;

/** G7 — every gore piece must still be a shape at the size it actually renders. */
function gateGoreLegibility(): void {
  if (GORE_STATES.length === 0) {
    fail('G7', 'the figure declares no gore states — the gore gates are measuring nothing');
    return;
  }
  const screenScale = IN_GAME_TILE / TILE_SCALE;
  for (const state of GORE_STATES) {
    const stats = inkStatsOf(cellAlpha(state, 0));
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
  let pairsCompared = 0;
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      pairsCompared++;
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
  failUnlessMeasured('G8', pairsCompared, 'pairs of gore pieces');
}

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/**
 * The hard ceiling for one warm animation row.
 *
 * The sheet this figure replaced had a stated whole-texture budget. A painted
 * figure is admitted to the cache a row at a time, so the number that decides
 * whether it fits is the widest row's warm bytes rather than the sum of all of
 * them — and it has to stay well inside the cache's own per-figure ceiling so
 * that a second row can be warm at the same time.
 */
const ROW_BUDGET_MEGABYTES = 3;

/**
 * G9 — the widest warm row's memory, reported whether or not it passes.
 *
 * Measured over every state the figure declares rather than over the pose rows
 * alone: the cache does not know a gore piece from a walk cycle, and a gore
 * state that grew frames would otherwise be memory nothing accounts for.
 */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of JUICER_FIGURE.states) {
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

function poseStream(): Array<{ row: RowSpec; frame: number; pose: JuicerPose }> {
  const out: Array<{ row: RowSpec; frame: number; pose: JuicerPose }> = [];
  for (const row of JUICER_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      out.push({ row, frame, pose: row.pose(frame) });
    }
  }
  return out;
}

const FOOT_DOWN_LIMIT = 0.002;
const CONTACT_ROLL_TOLERANCE = 0.02;
/**
 * How far off the ground line a foot may sit and still count as planted, in
 * tiles.
 *
 * Exact equality with zero is not a test of anything: a lift authored as a
 * `Math.max(0, …)` or eased through a curve returns values like `1e-17`, every
 * frame stops counting as planted, and the loop below runs zero times while
 * reporting success. Well under a pixel at any tile size the game draws at.
 */
const FOOT_PLANTED_EPSILON = 0.001;
/** Rows that notionally cover ground, so their planted feet must roll backward. */
const TRAVELLING_ROWS = ['walk_side', 'sprint_side'] as const;

/**
 * G10 — a planted foot never slips.
 *
 * A walk cycle plays on the spot with the world scrolling past, so its planted
 * foot has to roll backward at exactly the speed the body is notionally moving
 * forward. "x must be constant" fails every correct walk cycle ever authored;
 * what actually holds is that the foot never moves *forward* while down, and
 * that each backward step is the same size as the last.
 */
function gateFootSlide(): void {
  for (const name of TRAVELLING_ROWS) {
    const row = rowNamed(name, 'G10');
    if (row === null) continue;
    for (const side of ['leftFoot', 'rightFoot'] as const) {
      let previousStep: number | null = null;
      let plantedSteps = 0;
      for (let i = 1; i < row.frameCount; i++) {
        const before = row.pose(i - 1)[side];
        const now = row.pose(i)[side];
        const planted =
          Math.abs(before.y) <= FOOT_PLANTED_EPSILON && Math.abs(now.y) <= FOOT_PLANTED_EPSILON;
        if (!planted) {
          previousStep = null;
          continue;
        }
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
      failUnlessMeasured('G10', plantedSteps, `planted frames of ${name}'s ${side}`);
    }
  }
}

const LEG_REACH_LIMIT = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

/**
 * G11 — hip → ankle stays inside the leg's span on *every* frame. One clamped
 * frame locks the leg straight, the next tuck snaps it back, and the result
 * reads as a hop rather than as a walk.
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
      const root = solvedLegRoot(pose, row.view, side);
      const ankle = ankleFor(foot, pitch);
      const reach = Math.hypot(ankle.x - root.x, ankle.y - root.y);
      legsMeasured++;
      if (reach > worst) {
        worst = reach;
        worstAt = `${row.name}[${frame}] ${side}`;
      }
      if (reach > LEG_REACH_LIMIT) {
        fail(
          'G11',
          `${row.name}[${frame}]'s ${side} leg has to span ${reach.toFixed(4)} from its root ` +
            `against a leg ${LEG_REACH_LIMIT.toFixed(4)} long — the IK clamps and the step ` +
            `becomes a hop`,
        );
      }
    }
  }
  failUnlessMeasured('G11', legsMeasured, 'legs');
  console.log(
    `  G11 leg reach: worst frame spans ${worst.toFixed(4)} of ` +
      `${LEG_REACH_LIMIT.toFixed(4)} (${worstAt})`,
  );
}

const CLAMP_TOLERANCE = 0.0005;
const MIN_ELBOW_DEGREES = 20;

/**
 * G12 — no arm folds implausibly flat, and no IK arm is clamped short.
 *
 * The reach half of this measures the *demand* — where the choreography asked
 * the hand to be against where the solver put it — rather than the solved
 * chain, because the solver clamps and a gate reading its output can only ever
 * see equality.
 */
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

const THROW_ROWS = ['throw', 'throw_side', 'throw_away'] as const;

/**
 * G13 — the declared release and impact frames are the extremes of their rows.
 *
 * A timing table that drifted from the choreography is invisible in every other
 * gate: the row still animates, the damage still lands, and the two simply stop
 * describing the same moment.
 *
 * The throw's peak is the gripping hand's distance from the hip, which is the
 * one measure that works in all three views — edge-on the heave travels along
 * X, head-on it travels almost entirely in height, and full extension away from
 * the body is what both of those have in common. The punch's peak is the hand's
 * lowest point, because a ground punch ends on the floor in every view.
 */
function gateImpactIsThePeak(): void {
  const release = juicerImpactSpriteFrame(JUICER_THROW_FRAMES, JUICER_THROW_RELEASE_PROGRESS);
  let rowsMeasured = 0;
  for (const name of THROW_ROWS) {
    const row = rowNamed(name, 'G13');
    if (row === null) continue;
    rowsMeasured++;
    let peakFrame = 0;
    let peakReach = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      const hand = solvedArm(pose, row.view, 'right').end;
      const hip = solvedHip(pose, row.view);
      const reach = Math.hypot(hand.x - hip.x, hand.y - hip.y);
      if (reach > peakReach) {
        peakReach = reach;
        peakFrame = frame;
      }
    }
    if (peakFrame !== release) {
      fail(
        'G13',
        `${name} reaches furthest from the hip on frame ${peakFrame}, but the shared timing puts ` +
          `the release on frame ${release} (progress ${JUICER_THROW_RELEASE_PROGRESS} of ` +
          `${JUICER_THROW_FRAMES} frames)`,
      );
    }
  }

  for (const name of PUNCH_ROWS) {
    const row = rowNamed(name, 'G13');
    if (row === null) continue;
    rowsMeasured++;
    let peakFrame = 0;
    let lowest = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const hand = solvedArm(row.pose(frame), row.view, 'right').end;
      if (hand.y > lowest) {
        lowest = hand.y;
        peakFrame = frame;
      }
    }
    if (peakFrame !== PUNCH_IMPACT_FRAME) {
      fail(
        'G13',
        `${name} drives its fist lowest on frame ${peakFrame}, but the shared timing puts the ` +
          `impact on frame ${PUNCH_IMPACT_FRAME} (progress ${JUICER_PUNCH_IMPACT_PROGRESS} of ` +
          `${JUICER_PUNCH_FRAMES} frames)`,
      );
    }
  }
  failUnlessMeasured('G13', rowsMeasured, 'timed attack rows');
}

/** How far ahead of the hips the shoulders must ride, edge-on, for a sprint. */
const SPRINT_MIN_SHOULDER_LEAD = 0.16;
/** How far below the idle's hips the sprinting hips must sit, head-on. */
const SPRINT_MIN_HIP_DROP = 0.04;

/**
 * G14 — the sprint actually leans.
 *
 * The whole read of the sprint is the shoulders driving out ahead of the hips.
 * A sprint row standing as upright as the walk is a Juicer jogging, and no
 * other gate can tell the difference. Edge-on that lean is a horizontal offset;
 * head-on there is no forward to travel in, so what has to be there instead is
 * the crouch — the hips sitting visibly lower than the idle's.
 */
function gateSprintLeadsWithTheShoulders(): void {
  const sprintRows = ['sprint', 'sprint_side', 'sprint_away'] as const;
  let framesMeasured = 0;
  for (const name of sprintRows) {
    const row = rowNamed(name, 'G14');
    if (row === null) continue;
    const idleName = name.replace('sprint', 'idle');
    const idleRow = rowNamed(idleName, 'G14');
    if (idleRow === null) continue;
    const idleHip = solvedHip(idleRow.pose(0), idleRow.view);

    for (let frame = 0; frame < row.frameCount; frame++) {
      framesMeasured++;
      const pose = row.pose(frame);
      const hip = solvedHip(pose, row.view);
      if (row.view === 'side') {
        const lead = solvedShoulderCentre(pose, row.view).x - hip.x;
        if (lead < SPRINT_MIN_SHOULDER_LEAD) {
          fail(
            'G14',
            `${name}[${frame}] carries its shoulders only ${lead.toFixed(3)} tile ahead of its ` +
              `hips (limit ${SPRINT_MIN_SHOULDER_LEAD}) — it is jogging, not sprinting`,
          );
        }
        continue;
      }
      const drop = hip.y - idleHip.y;
      if (drop < SPRINT_MIN_HIP_DROP) {
        fail(
          'G14',
          `${name}[${frame}] carries its hips only ${drop.toFixed(3)} tile below where ` +
            `${idleName} does (limit ${SPRINT_MIN_HIP_DROP}) — head-on the crouch is the whole ` +
            'lean',
        );
      }
    }
  }
  failUnlessMeasured('G14', framesMeasured, 'sprint frames');
}

/**
 * G15 — the runtime's gore-part list matches the figure, element for element.
 *
 * This one fails by dropping a body part on the floor and saying nothing,
 * because `BodyPartGoreSystem` skips a state it cannot find. The list is read
 * out of the source rather than imported: the sprite module reaches for browser
 * globals a Node process does not have.
 */
const SPRITE_MODULE_PATH = 'src/sprites/juicerSprite.ts';

function spriteModuleSource(): string {
  return readFileSync(resolve(SPRITE_MODULE_PATH), 'utf8');
}

function gateGoreContract(): void {
  const source = spriteModuleSource();
  const declaration = /JUICER_GORE_PARTS[^=]*=\s*\[([^\]]*)\]/.exec(source);
  if (declaration === null) {
    fail('G15', `${SPRITE_MODULE_PATH} does not declare JUICER_GORE_PARTS`);
    return;
  }
  const runtimeParts = [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const painted = [...GORE_STATES];
  if (
    runtimeParts.length !== painted.length ||
    runtimeParts.some((part, i) => part !== painted[i])
  ) {
    fail(
      'G15',
      `${SPRITE_MODULE_PATH}'s JUICER_GORE_PARTS is [${runtimeParts.join(', ')}] but the figure ` +
        `paints [${painted.join(', ')}] — a state the runtime names and the figure lacks is ` +
        `silently skipped`,
    );
  }
}

/**
 * G17 — every pose name the runtime can ask for is a state the figure paints.
 *
 * `stateFor` builds its names by template literal, one per base and view, and
 * `drawFigureCached` returns without drawing when it is handed a name the
 * figure does not declare: a whole facing of the boss goes invisible and
 * nothing is logged. The union the runtime's frame-count table is keyed by is
 * exactly that set of names, and it is read out of the source because the
 * sprite module reaches for browser globals a Node process does not have.
 */
function gateRuntimeStateNames(): void {
  const source = spriteModuleSource();
  const union = /type JuicerState\s*=([^;]*);/.exec(source);
  if (union === null) {
    fail('G17', `${SPRITE_MODULE_PATH} does not declare a JuicerState union`);
    return;
  }
  const names = [...union[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  for (const failure of missingStateFailures(
    JUICER_FIGURE,
    names,
    `${SPRITE_MODULE_PATH}'s JuicerState`,
  )) {
    fail('G17', failure);
  }
}

/**
 * How far a re-measured head clearance may sit from the frozen one, in tiles.
 *
 * A couple of pixels of a 64-px art tile: enough that a downsampling difference
 * between node-canvas builds cannot fire the gate, far too little to hide a
 * redraw that moved the skull.
 */
const HEAD_CLEARANCE_TOLERANCE_TILES = 0.03;

/**
 * G19 — the frozen head clearance still describes the painted head.
 *
 * `JUICER_HEAD_CLEARANCE_TILES` is an ink measurement, and nothing can measure
 * ink at runtime, so the number is frozen in the sprite module and everything
 * drawn above him — the health bar, the taunt bubble, the septic label — is
 * lifted by it. A redraw that raises his head by a few pixels then paints all
 * of that across his chest with every other gate green.
 *
 * Measured against the tallest ink of any standing frame, because the bubble
 * has to clear the head on the frame where it is highest, not on average.
 */
function gateHeadClearance(): void {
  const source = spriteModuleSource();
  const declaration = /JUICER_HEAD_CLEARANCE_TILES\s*=\s*([\d.]+)/.exec(source);
  if (declaration === null) {
    fail('G19', `${SPRITE_MODULE_PATH} does not declare JUICER_HEAD_CLEARANCE_TILES`);
    return;
  }
  const frozen = Number(declaration[1]);

  let highestInk = frameHeight;
  let highestAt = '';
  let framesMeasured = 0;
  for (const name of STANDING_ROWS) {
    const row = rowNamed(name, 'G19');
    if (row === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = inkStatsOf(cellAlpha(row.name, frame));
      if (stats.count === 0) continue;
      framesMeasured++;
      if (stats.minY >= highestInk) continue;
      highestInk = stats.minY;
      highestAt = `${row.name}[${frame}]`;
    }
  }
  failUnlessMeasured('G19', framesMeasured, 'standing frames');
  if (framesMeasured === 0) return;

  const measured = (JUICER_FIGURE.tileY - highestInk) / JUICER_FIGURE.tileScale;
  console.log(
    `  G19 head clearance: ${measured.toFixed(4)} tiles measured at ${highestAt} against a ` +
      `frozen ${frozen}`,
  );
  if (Math.abs(measured - frozen) > HEAD_CLEARANCE_TOLERANCE_TILES) {
    fail(
      'G19',
      `his tallest standing ink stands ${measured.toFixed(4)} tiles above his tile (${highestAt}) ` +
        `but ${SPRITE_MODULE_PATH} freezes JUICER_HEAD_CLEARANCE_TILES at ${frozen} — ` +
        `everything drawn over him is lifted by the frozen number; paste the measured one`,
    );
  }
}

/**
 * How far the runtime's anchor table may sit from the rig, in tile fractions.
 *
 * A dumbbell is most of a third of a tile across, so a tenth of a tile of slop
 * is invisible and anything past it puts the weight outside the fist.
 */
const ANCHOR_TOLERANCE_TILES = 0.1;

function anchorDelta(a: TileFraction, b: TileFraction): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function formatAnchor(a: TileFraction): string {
  return `{ x: ${a.x.toFixed(3)}, y: ${a.y.toFixed(3)} }`;
}

const HAND_VIEWS: ReadonlyArray<JuicerHandView> = ['front', 'side', 'away'];

/**
 * G16 — the held-dumbbell anchors describe the rig that is actually painted.
 *
 * The dumbbell is an overlay rather than part of any row, so the numbers the
 * runtime draws it at are a hand-maintained copy of a measurement of the rig.
 * This gate is the only thing standing between a redraw that moves the arm and
 * a dumbbell that keeps floating where the hand used to be.
 *
 * It is paired with a drift check: a single carry anchor is only meaningful if
 * no frame the dumbbell is carried through strays far from it.
 */
function gateHandAnchors(): void {
  const rigCarry = carryAnchors();
  const rigThrow = throwAnchors();
  for (const view of HAND_VIEWS) {
    const runtime = JUICER_CARRY_HAND_ANCHORS[view];
    const rig = rigCarry[view];
    const delta = anchorDelta(runtime, rig);
    if (delta > ANCHOR_TOLERANCE_TILES) {
      fail(
        'G16',
        `the ${view} carry anchor is ${formatAnchor(runtime)} but the rig grips at ` +
          `${formatAnchor(rig)} — ${delta.toFixed(3)} tile out (limit ` +
          `${ANCHOR_TOLERANCE_TILES}); update JUICER_CARRY_HAND_ANCHORS`,
      );
    }
    const drift = worstCarryDrift(view);
    if (drift > CARRY_DRIFT_LIMIT_TILES) {
      fail(
        'G16',
        `the ${view} carry anchor is a mean the rig strays ${drift.toFixed(3)} tile from (limit ` +
          `${CARRY_DRIFT_LIMIT_TILES}) — one point cannot describe that arm; damp the walk swing`,
      );
    }

    const runtimeThrow = JUICER_THROW_HAND_ANCHORS[view];
    const rigThrowFrames = rigThrow[view];
    if (runtimeThrow.length !== rigThrowFrames.length) {
      fail(
        'G16',
        `the ${view} throw anchor table has ${runtimeThrow.length} frames but the throw row ` +
          `paints ${rigThrowFrames.length}`,
      );
      continue;
    }
    rigThrowFrames.forEach((rigFrame, frame) => {
      const gap = anchorDelta(runtimeThrow[frame], rigFrame);
      if (gap > ANCHOR_TOLERANCE_TILES) {
        fail(
          'G16',
          `the ${view} throw anchor for frame ${frame} is ${formatAnchor(runtimeThrow[frame])} ` +
            `but the rig grips at ${formatAnchor(rigFrame)} — ${gap.toFixed(3)} tile out ` +
            `(limit ${ANCHOR_TOLERANCE_TILES}); update JUICER_THROW_HAND_ANCHORS`,
        );
      }
    });
  }
}

/** Prints the anchor tables the rig measures, so a failed G16 can be pasted. */
function printAnchors(): void {
  const carry = carryAnchors();
  const throws = throwAnchors();
  console.log('  measured carry anchors:');
  for (const view of HAND_VIEWS) console.log(`    ${view}: ${formatAnchor(carry[view])}`);
  console.log('  measured throw anchors:');
  for (const view of HAND_VIEWS) {
    console.log(`    ${view}: [${throws[view].map(formatAnchor).join(', ')}]`);
  }
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
  const pieces = juicerGorePieces();
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
      fail('G18', `${piece.state} painted nothing at all when measured about its own centre`);
      continue;
    }
    const measuredX = (GORE_MEASURE_ORIGIN - (minX + maxX) / 2) / GORE_UNIT;
    const measuredY = (GORE_MEASURE_ORIGIN - (minY + maxY) / 2) / GORE_UNIT;
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
          `will orbit rather than tumble; paste the measured pair`,
      );
    }
  }
  failUnlessMeasured('G18', piecesMeasured, 'gore pieces');
}

/**
 * G20 — a row paints as many pictures as it declares frames.
 *
 * His idles shipped as six pictures for eight frames head-on and edge-on and
 * five from behind, where there is no blink to break the tie, because every term
 * of the pose rode the same sine of the cycle. Hanging the tail a quarter turn
 * behind the breath is what separated them, and the floor is perceptual rather
 * than a hash because two rows elsewhere passed a hash while still painting the
 * same picture twice.
 */
function gateDistinctFrames(): void {
  const report = sharedDistinctFrameFailures(JUICER_FIGURE, cellRgba);
  for (const message of report.failures) fail('G20', message);
  failUnlessMeasured('G20', report.framesMeasured, 'painted frames');
  if (report.closestNote !== null) console.log(`  G20 closest frames: ${report.closestNote}`);
}

/** Runs every gate and returns one message per failure. */
export function juicerGateFailures(): string[] {
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
  gateSprintLeadsWithTheShoulders();
  gateGoreContract();
  gateRuntimeStateNames();
  gateHandAnchors();
  gateGoreRecentre();
  gateHeadClearance();
  gateDistinctFrames();
  printAnchors();
  return [...failures];
}
