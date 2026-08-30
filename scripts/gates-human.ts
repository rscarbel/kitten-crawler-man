/**
 * Carl's art gates.
 *
 * He has no baked sheet to inspect any more, so the invariants the old bake
 * enforced by throwing — a pose that painted outside its cell, a strike that
 * missed the frame the hit is scored on — are enforced here against cells
 * painted from `HUMAN_FIGURE`, baked exactly the way the runtime cache bakes
 * them, plus pose-stream checks that measure the rig itself and need no pixels
 * at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row it names fails
 * loudly, and so does one whose filtered loop examined nothing: a lookup that
 * quietly returns nothing turns a whole gate module green while measuring
 * nothing.
 *
 * Run by the review harness: `npm run render:human`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  ATTACK_FRAMES,
  ATTACK_IMPACT_FRAME,
  GROUND_OFFSET_IN_TILE,
  HUMAN_FIGURE,
  HUMAN_ROWS,
  HUMAN_SCALE,
  IDLE_FRAMES,
  SMUSH_FRAMES,
  SMUSH_IMPACT_FRAME,
  SMUSH_STANCE,
  TILE_SCALE,
  TILE_X,
  TILE_Y,
  WALK_FRAMES,
  type RowSpec,
} from '../src/sprites/art/humanFigure.js';
import { SHOULDER_Y, type CarlPose, type Pt } from '../src/sprites/art/carlArt.js';

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

const { frameWidth, frameHeight } = HUMAN_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — standing rows only, looping
 * rows only, the striking limb only — and a narrowing that matches nothing
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
  const cell = bakeFigureCell(HUMAN_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

interface InkStats {
  count: number;
  centroidX: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function inkStatsOf(alpha: Uint8ClampedArray, threshold = INK_ALPHA_THRESHOLD): InkStats {
  let count = 0;
  let sumX = 0;
  let minX = frameWidth;
  let maxX = -1;
  let minY = frameHeight;
  let maxY = -1;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alpha[y * frameWidth + x] < threshold) continue;
      count++;
      sumX += x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { count, centroidX: count === 0 ? 0 : sumX / count, minX, maxX, minY, maxY };
}

/** Pixels that changed between two cells, as a share of the larger cell's ink. */
function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    const wasInk = a[i] >= INK_ALPHA_THRESHOLD;
    const isInk = b[i] >= INK_ALPHA_THRESHOLD;
    if (wasInk !== isInk) changed++;
  }
  return changed;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = HUMAN_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `there is no row named "${name}" — the gate below it measured nothing`);
    return null;
  }
  return row;
}

// ── G1: structure ────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const failure of figureStructuralFailures(HUMAN_FIGURE)) fail('G1', failure);
}

// ── G2: the cell geometry still describes the painted figure ─────────────────

/**
 * How far his soles and his centreline may sit from where the cell geometry
 * says they are, in cell pixels. Two or three pixels of a 64-px art tile:
 * loose enough that a downsampling difference between node-canvas builds
 * cannot fire it, far too tight to hide a redraw that moved him in his cell.
 */
const GROUND_TOLERANCE_PX = 4;
const CENTRELINE_TOLERANCE_PX = 6;

const STANDING_ROWS = ['idle', 'idle_side', 'idle_away'] as const;

/**
 * G2 — the art still stands on the ground line the cell geometry declares.
 *
 * It cannot catch a wrong `tileX`, `tileY` or `GROUND_OFFSET_IN_TILE`, and does
 * not claim to: `paintFrame` derives its paint origin from the very same
 * expression this gate builds its ground line from, so both sides move together.
 * Dropping `GROUND_OFFSET_IN_TILE` from 0.9 to 0.7 leaves this green, and moving
 * `tileY` 20px is caught by the clipping gate rather than by this one — his cell
 * is padded tightly enough that any translation big enough to fail an anchor
 * check runs off the edge first. The parity run against the deleted sheet is the
 * only thing that ever checked those numbers.
 *
 * What it does catch is a redraw that raised his feet or shifted him inside his
 * cell — the art drifting off its own anchor — which is re-measured from painted
 * ink here.
 *
 * The feet are measured against the solid-alpha threshold so the soft contact
 * shadow under him does not count as the lowest ink and quietly satisfy it.
 */
function gateCellGeometry(): void {
  const groundY = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE;
  const tileCentreX = TILE_X + TILE_SCALE / 2;
  let framesMeasured = 0;
  for (const name of STANDING_ROWS) {
    const row = rowNamed(name, 'G2');
    if (row === null) continue;
    const solid = inkStatsOf(cellAlpha(row.name, 0), SOLID_ALPHA_THRESHOLD);
    if (solid.count === 0) {
      fail('G2', `${name}[0] paints no solid ink at all`);
      continue;
    }
    framesMeasured++;
    const drop = Math.abs(solid.maxY - groundY);
    if (drop > GROUND_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its lowest solid ink at y=${solid.maxY} against a ground line of ` +
          `${groundY} (tileY ${TILE_Y} + ${GROUND_OFFSET_IN_TILE} of a ${TILE_SCALE}px tile) — ` +
          `${drop.toFixed(1)}px off, limit ${GROUND_TOLERANCE_PX}`,
      );
    }
    const offCentre = Math.abs(inkStatsOf(cellAlpha(row.name, 0)).centroidX - tileCentreX);
    if (offCentre > CENTRELINE_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its ink centred ${offCentre.toFixed(1)}px from the tile centre ` +
          `(tileX ${TILE_X} + half of ${TILE_SCALE}), limit ${CENTRELINE_TOLERANCE_PX}`,
      );
    }
  }
  failUnlessMeasured('G2', framesMeasured, 'standing frames');
}

// ── G3: a loop closes ────────────────────────────────────────────────────────

/**
 * The most a closing loop's seam may exceed the row's own largest ordinary step.
 *
 * A cycle that closes makes the wrap from last frame to first just another step
 * of the same cycle, so the largest step inside the row is the only scale that
 * describes it. Measured over his six loops with the ink threshold this module
 * uses, the shipped seams run 0.720–1.000 of their largest in-cycle step, the
 * three idles sitting exactly at 1.000 because their seam *is* the largest step.
 * 1.15 is that plus 15%, which is all a deterministic painter needs.
 *
 * It is an art-drift check and nothing more: it cannot see how many turns a row
 * covers, because over-running the cycle raises the ordinary steps faster than
 * it raises the seam. `CYCLE_CLOSE_TOLERANCE_PX` below is what holds the cycle
 * count.
 *
 * The disjunct this replaces allowed the seam up to 2.1× the row's *median* step
 * instead, and could not fail: his idles wrap at 2.20–2.38× their own median as
 * shipped, so a cycle sampled over 1.5 turns still sat comfortably under it.
 * Against this limit that same mis-sampling measures up to 1.846, and a cycle
 * stopping short at 0.7 of a turn measures up to 3.967.
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
 * 0.914–2.379 of their median step, so 0.5 is far below any of them and still
 * fires the moment a seam collapses.
 */
const LOOP_SEAM_FLOOR = 0.5;

/** G3 — a loop must close: not a pop across its seam, and not a held frame. */
function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const row of HUMAN_ROWS) {
    if (row.kind !== 'loop') continue;
    loopsMeasured++;
    const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
      cellAlpha(row.name, frame),
    );
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) {
      // A loop whose frames are pixel-identical has aliased into a still — the
      // Nyquist failure a frame count is chosen to avoid — and the seam
      // comparison below has no scale left to measure against.
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

// ── G4: motion is continuous ─────────────────────────────────────────────────

const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
/**
 * How far the worst step may exceed the *second* worst.
 *
 * Any cycle driven off a sine has a bimodal step distribution — fast steps
 * around the zero crossings, slow ones at the extremes — so its median is the
 * slow step and a perfectly smooth row scores several times it. What
 * distinguishes a snap is that it is a *lone* outlier, and the clause is only
 * allowed to speak while the runner-up is itself an ordinary step: the
 * commonest rig defect is a wrong-sign keyframe, which teleports a limb out on
 * one frame and back on the next and so produces *two* huge steps. Uncapped,
 * the defect would then be sizing its own allowance.
 */
const STEP_VS_RUNNER_UP = 1.35;

/**
 * The stamp is a declared spike. Both stomp rows drive a foot from over his own
 * waist to flat on the floor across the impact frame, and that single step is
 * the whole blow — flattening it to satisfy a continuity threshold would remove
 * the only frames a player reads as an impact. G6 is what holds the spike to
 * exactly that step.
 */
function isDeclaredSpike(row: string, step: number): boolean {
  const stomp = STOMP_ROWS.find((candidate) => candidate.row === row);
  return stomp !== undefined && step === stomp.impact - 1;
}

/**
 * G4 — no frame-to-frame jump that reads as a teleport, and no dead frame.
 *
 * A step far larger than the row's typical one is a pose that skipped; a step
 * of zero inside a row that is supposed to be moving is a frame that aliased
 * away. Both are invisible in the code and obvious in the picture.
 *
 * How much it can prove, measured rather than assumed: the allowance is a
 * multiple of the row's own median step, so a row whose ordinary steps are
 * already large buys itself room. Comparing each row's allowance against the
 * largest step any reordering of its own frames could produce, the three idles
 * and the three walks can be failed by a skipped pose — the head-on walk fails
 * at 474px against an allowance of 369 — but `punch_side`, `kick_side` and
 * `kick_down` cannot: their allowances (1548, 2588 and 2520px) exceed the
 * furthest apart any two of their own frames are (728, 1308 and 1808px). On a
 * one-shot this clause therefore only catches a limb thrown somewhere no frame
 * of the row goes, which is what the Smush stamp moving 0.1 tiles off its stance
 * does. The dead-frame clause below has no such blind spot.
 */
function gateMotionContinuity(): void {
  let stepsMeasured = 0;
  for (const row of HUMAN_ROWS) {
    const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
      cellAlpha(row.name, frame),
    );
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    if (steps.length === 0) {
      fail('G4', `${row.name} has no frame-to-frame step to measure`);
      continue;
    }
    stepsMeasured += steps.length;
    const typical = median(steps);
    const runnerUp = [...steps].sort((a, b) => b - a)[1] ?? 0;
    const limitShare = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const ordinaryStepLimit = typical * limitShare;
    const runnerUpIsOrdinary = runnerUp <= ordinaryStepLimit;
    const allowed = Math.max(
      ordinaryStepLimit,
      runnerUpIsOrdinary ? runnerUp * STEP_VS_RUNNER_UP : 0,
    );
    steps.forEach((step, index) => {
      if (step > allowed && !isDeclaredSpike(row.name, index)) {
        fail(
          'G4',
          `${row.name} snaps between frames ${index} and ${index + 1}: ${step}px changed ` +
            `against a median step of ${typical}px and a runner-up of ${runnerUp}px ` +
            `(allowed ${allowed.toFixed(0)}px)`,
        );
      }
      if (step === 0) {
        fail(
          'G4',
          `${row.name}[${index}]→[${index + 1}] is pixel-identical: the row has a dead frame`,
        );
      }
    });
  }
  failUnlessMeasured('G4', stepsMeasured, 'frame-to-frame steps');
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

function posesOf(row: RowSpec): CarlPose[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) => row.pose(frame));
}

/** Distance from a body anchor to a limb's target, in tile units. */
function reach(from: Pt, to: Pt): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** The strikes that land by extending a limb, and which limb carries the blow. */
const STRIKE_ROWS: ReadonlyArray<{ readonly row: string; readonly limb: 'hand' | 'foot' }> = [
  { row: 'punch_side', limb: 'hand' },
  { row: 'punch_up', limb: 'hand' },
  { row: 'kick_side', limb: 'foot' },
];

/** A hand is measured from the shoulder line, a foot from the point he stands on. */
function strikeReach(pose: CarlPose, limb: 'hand' | 'foot'): number {
  if (limb === 'hand') return reach({ x: 0, y: SHOULDER_Y + pose.bob }, pose.rightHand);
  return reach({ x: 0, y: 0 }, pose.rightFoot);
}

/**
 * G5 — every strike reaches full extension exactly on the impact frame.
 *
 * `HumanPlayer` scores the melee hit on {@link ATTACK_IMPACT_FRAME}, so a row
 * whose peak sits a frame either side of it lands its damage on a picture of a
 * fist still travelling. Nothing about the damage would look wrong; only the
 * animation would.
 */
function gateStrikePeaksOnImpact(): void {
  let rowsMeasured = 0;
  for (const { row: name, limb } of STRIKE_ROWS) {
    const row = rowNamed(name, 'G5');
    if (row === null) continue;
    rowsMeasured++;
    const reaches = posesOf(row).map((pose) => strikeReach(pose, limb));
    let peakFrame = 0;
    reaches.forEach((value, frame) => {
      if (value > reaches[peakFrame]) peakFrame = frame;
    });
    if (peakFrame !== ATTACK_IMPACT_FRAME) {
      fail(
        'G5',
        `${name} reaches furthest on frame ${peakFrame} (${reaches[peakFrame].toFixed(3)} tiles) ` +
          `but the hit is scored on frame ${ATTACK_IMPACT_FRAME} ` +
          `(${reaches[ATTACK_IMPACT_FRAME].toFixed(3)} tiles)`,
      );
    }
  }
  failUnlessMeasured('G5', rowsMeasured, 'striking rows');
}

/**
 * How close to the floor a foot counts as planted, in tile units. A stamp is
 * either down or it is not; this is slack for arithmetic, not for a pose.
 */
const PLANTED_EPSILON = 1e-6;

/** The two rows that land by driving a raised foot down onto the floor. */
const STOMP_ROWS: ReadonlyArray<{ readonly row: string; readonly impact: number }> = [
  { row: 'kick_down', impact: ATTACK_IMPACT_FRAME },
  { row: 'smush', impact: SMUSH_IMPACT_FRAME },
];

/**
 * G6 — a stomp is at its apex the frame before impact and on the floor from
 * impact onward.
 *
 * Compared against an epsilon rather than for equality with zero: a lift that
 * starts returning a hair above the floor instead of exactly zero would empty
 * an equality filter and leave this passing while measuring nothing.
 */
function gateStompLandsOnImpact(): void {
  let rowsMeasured = 0;
  for (const { row: name, impact } of STOMP_ROWS) {
    const row = rowNamed(name, 'G6');
    if (row === null) continue;
    rowsMeasured++;
    const lifts = posesOf(row).map((pose) => -pose.rightFoot.y);
    let apexFrame = 0;
    lifts.forEach((lift, frame) => {
      if (lift > lifts[apexFrame]) apexFrame = frame;
    });
    if (apexFrame !== impact - 1) {
      fail(
        'G6',
        `${name} raises its stamping foot highest on frame ${apexFrame}, not on frame ` +
          `${impact - 1}, the frame before the sole is supposed to meet the floor`,
      );
    }
    let plantedFrames = 0;
    for (let frame = impact; frame < row.frameCount; frame++) {
      plantedFrames++;
      if (lifts[frame] > PLANTED_EPSILON) {
        fail(
          'G6',
          `${name}[${frame}] still holds its stamping foot ${lifts[frame].toFixed(4)} tiles off ` +
            `the floor, on or after the impact frame ${impact}`,
        );
      }
    }
    failUnlessMeasured('G6', plantedFrames, `planted frames of ${name}`);
  }
  failUnlessMeasured('G6', rowsMeasured, 'stomping rows');
}

/**
 * How far the re-measured stamp may sit from the frozen one, in tile fractions.
 * Under a twentieth of a tile: nothing an arithmetic difference can reach, far
 * less than the blast radius it would take to hide a foot in the wrong place.
 */
const STAMP_TOLERANCE_TILES = 0.02;

/**
 * G7 — the Smush blast is still spawned under the stamping heel.
 *
 * `SMUSH_STAMP_X` and `SMUSH_STAMP_Y` in the sprite module put the shockwave in
 * the world, and nothing at runtime can look at the art to check them. They are
 * built from `SMUSH_STANCE`, `HUMAN_SCALE` and `GROUND_OFFSET_IN_TILE`, so the
 * thing that can still go wrong is the choreography moving the foot off that
 * stance on the frame the blast is spawned — which puts the explosion beside
 * him with every other gate green.
 */
function gateSmushStampAnchor(): void {
  const row = rowNamed('smush', 'G7');
  if (row === null) return;
  const pose = row.pose(SMUSH_IMPACT_FRAME);
  const offStance = Math.abs(pose.rightFoot.x - SMUSH_STANCE) * HUMAN_SCALE;
  const offGround = Math.abs(pose.rightFoot.y) * HUMAN_SCALE;
  console.log(
    `  G7 smush stamp: foot at (${pose.rightFoot.x.toFixed(4)}, ` +
      `${pose.rightFoot.y.toFixed(4)}) on frame ${SMUSH_IMPACT_FRAME} against a stance of ` +
      `${SMUSH_STANCE} on the ground line`,
  );
  if (offStance > STAMP_TOLERANCE_TILES) {
    fail(
      'G7',
      `on the impact frame his stamping foot stands at x=${pose.rightFoot.x.toFixed(4)} but ` +
        `SMUSH_STAMP_X is built from a stance of ${SMUSH_STANCE} — the blast spawns ` +
        `${offStance.toFixed(4)} tiles away from the heel that made it`,
    );
  }
  if (offGround > STAMP_TOLERANCE_TILES) {
    fail(
      'G7',
      `on the impact frame his stamping foot is ${offGround.toFixed(4)} tiles off the ground ` +
        'line SMUSH_STAMP_Y places the blast on',
    );
  }
}

// ── G8: the names and counts the runtime asks for ────────────────────────────

const SPRITE_MODULE_PATH = 'src/sprites/humanSprite.ts';

function spriteModuleSource(): string {
  return readFileSync(resolve(SPRITE_MODULE_PATH), 'utf8');
}

/**
 * The frame-count constants the sprite module is allowed to key a row to. Both
 * modules import these from the choreography, so the gate resolves the name the
 * sprite module wrote rather than a literal it might have typed.
 */
const FRAME_CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['IDLE_FRAMES', IDLE_FRAMES],
  ['WALK_FRAMES', WALK_FRAMES],
  ['ATTACK_FRAMES', ATTACK_FRAMES],
  ['SMUSH_FRAMES', SMUSH_FRAMES],
]);

/**
 * G8 — every state name and frame count the sprite module can ask for is one
 * the figure actually paints.
 *
 * `drawFigureCached` returns without drawing when it is handed a name the
 * figure does not declare, and *clamps* a frame index that runs past the row it
 * was given: a renamed row is an invisible player character and a miscounted
 * one freezes on its last frame, and neither says a word. The union and the
 * count table are read out of the source because the sprite module reaches for
 * browser globals a Node process does not have.
 */
function gateRuntimeStates(): void {
  const source = spriteModuleSource();

  const union = /type HumanState =([^;]*);/.exec(source);
  if (union === null) {
    fail('G8', `${SPRITE_MODULE_PATH} does not declare a HumanState union`);
    return;
  }
  const names = [...union[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  for (const failure of missingStateFailures(
    HUMAN_FIGURE,
    names,
    `${SPRITE_MODULE_PATH}'s HumanState`,
  )) {
    fail('G8', failure);
  }

  const attacks = /type HumanAttackPhase =([^;]*);/.exec(source);
  if (attacks === null) {
    fail('G8', `${SPRITE_MODULE_PATH} does not declare a HumanAttackPhase union`);
  } else {
    const phases = [...attacks[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    for (const failure of missingStateFailures(
      HUMAN_FIGURE,
      phases,
      `${SPRITE_MODULE_PATH}'s HumanAttackPhase`,
    )) {
      fail('G8', failure);
    }
  }

  const prewarm = /const ALWAYS_DRAWN_ROWS: ReadonlyArray<HumanState> = \[([^\]]*)\]/.exec(source);
  if (prewarm === null) {
    fail('G8', `${SPRITE_MODULE_PATH} does not declare an ALWAYS_DRAWN_ROWS list`);
  } else {
    const warmed = [...prewarm[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    for (const failure of missingStateFailures(
      HUMAN_FIGURE,
      warmed,
      `${SPRITE_MODULE_PATH}'s ALWAYS_DRAWN_ROWS`,
    )) {
      fail('G8', failure);
    }
  }

  const table = /const FRAME_COUNT: Record<HumanState, number> = \{([^}]*)\}/.exec(source);
  if (table === null) {
    fail('G8', `${SPRITE_MODULE_PATH} does not declare a FRAME_COUNT table`);
    return;
  }
  let entriesMeasured = 0;
  for (const entry of table[1].matchAll(/(\w+): (\w+),/g)) {
    const [, state, constant] = entry;
    entriesMeasured++;
    const declared = FRAME_CONSTANTS.get(constant);
    if (declared === undefined) {
      fail(
        'G8',
        `${SPRITE_MODULE_PATH} counts "${state}" with ${constant}, which is not one of the ` +
          `choreography's frame counts (${[...FRAME_CONSTANTS.keys()].join(', ')})`,
      );
      continue;
    }
    const painted = HUMAN_FIGURE.states.get(state)?.frames;
    if (painted === undefined) {
      fail('G8', `${SPRITE_MODULE_PATH} counts "${state}", which the figure does not paint`);
      continue;
    }
    if (painted !== declared) {
      fail(
        'G8',
        `${SPRITE_MODULE_PATH} counts "${state}" as ${constant} (${declared}) but the figure ` +
          `paints ${painted} frames of it, so the draw call clamps and the row freezes`,
      );
    }
  }
  failUnlessMeasured('G8', entriesMeasured, 'frame-count entries');
}

// ── G9: warm-row memory ──────────────────────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * The hard ceiling for one warm animation row.
 *
 * The sheet this figure replaced was one texture with a whole-texture budget. A
 * painted figure is admitted to the cache a row at a time, so the number that
 * decides whether it fits is the widest row's warm bytes rather than the sum of
 * all of them — and it has to stay well inside the cache's per-figure ceiling,
 * because Carl is on screen continuously with several of his rows warm at once.
 */
const ROW_BUDGET_MEGABYTES = 3;

/** G9 — the widest warm row's memory, reported whether or not it passes. */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of HUMAN_FIGURE.states) {
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

/** Runs every gate and returns one message per failure. */
export function humanGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateCellGeometry();
  gateLoopClosure();
  gateMotionContinuity();
  gateStrikePeaksOnImpact();
  gateStompLandsOnImpact();
  gateSmushStampAnchor();
  gateRuntimeStates();
  gateWarmRowSize();
  return [...failures];
}
