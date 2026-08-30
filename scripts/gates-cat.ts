/**
 * Donut's art gates.
 *
 * She has no baked sheet to inspect any more, so the invariants the old bake
 * held by construction — a pose that fits its cell, a row that keeps its frames
 * — are enforced here against cells painted from `CAT_FIGURE`, baked exactly
 * the way the runtime cache bakes them, plus pose-stream checks that measure
 * the choreography itself and need no pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row it names fails
 * loudly, and so does one whose filtered loop examined nothing: a lookup that
 * quietly returns nothing turns a whole gate module green while measuring
 * nothing.
 *
 * Run by the review harness: `npm run render:cat`.
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
  ACTION_FRAMES,
  BREAK_FRAMES,
  CAT_FIGURE,
  CAT_ROWS,
  DANCE_FRAMES,
  IDLE_FRAMES,
  KO_FRAMES,
  TILE_SCALE,
  TILE_X,
  TILE_Y,
  WALK_FRAMES,
  type RowSpec,
} from '../src/sprites/art/catFigure.js';
import { GROUND_Y, type CatPose } from '../src/sprites/art/catArt.js';

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

const { frameWidth, frameHeight } = CAT_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — standing rows only, looping
 * rows only, the swiping paw only — and a narrowing that matches nothing leaves
 * a green gate that examined nothing. Every filtering loop here counts what it
 * looked at and ends with a call to this.
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
  const cell = bakeFigureCell(CAT_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

interface InkStats {
  count: number;
  centroidX: number;
  minY: number;
  maxY: number;
}

function inkStatsOf(alpha: Uint8ClampedArray, threshold = INK_ALPHA_THRESHOLD): InkStats {
  let count = 0;
  let sumX = 0;
  let minY = frameHeight;
  let maxY = -1;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alpha[y * frameWidth + x] < threshold) continue;
      count++;
      sumX += x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { count, centroidX: count === 0 ? 0 : sumX / count, minY, maxY };
}

function inkCountOf(a: Uint8ClampedArray): number {
  let count = 0;
  for (const value of a) if (value >= INK_ALPHA_THRESHOLD) count++;
  return count;
}

/** Pixels whose ink-or-not answer changed between two cells. */
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
  const row = CAT_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `there is no row named "${name}" — the gate below it measured nothing`);
    return null;
  }
  return row;
}

function posesOf(row: RowSpec): CatPose[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) => row.pose(frame));
}

function cellsOfRow(row: RowSpec): Uint8ClampedArray[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) => cellAlpha(row.name, frame));
}

// ── G1: structure ────────────────────────────────────────────────────────────

/**
 * How much of her cell Donut's widest pose fills.
 *
 * Below the shared default, and deliberately: her cell is 160px so that the
 * tail plume, a raised paw and the claw arc all have room at full reach, while
 * she herself is drawn at two thirds of the anatomy's natural size because she
 * is a housecat standing next to goblins and clowns. The cell size is frozen by
 * the bake this figure replaces, so it cannot be tightened without breaking the
 * parity that proved the conversion; G9 is what says the cells are affordable.
 */
const MIN_CELL_FILL_SHARE = 0.13;

function gateStructure(): void {
  for (const failure of figureStructuralFailures(CAT_FIGURE, {
    minInkAreaShare: MIN_CELL_FILL_SHARE,
  })) {
    fail('G1', failure);
  }
}

// ── G2: the cell geometry still describes the painted figure ─────────────────

/**
 * The band around the anatomy's ground line her lowest solid ink may sit in.
 *
 * Wider than a rounding allowance because the three standing views legitimately
 * disagree: measured on the shipped art the head-on view's splayed forepaws
 * reach 5px below the line while the back view stops just above it, because a
 * paw pointed at the camera is drawn below the point it stands on. An eighth of
 * the 64px art tile covers that spread and still fires on a redraw that moved
 * her a quarter tile in her cell.
 */
const GROUND_TOLERANCE_PX = 8;
/**
 * How far her ink may be centred from the tile's own centre line. The three
 * views disagree by a couple of pixels because her tail leaves on a different
 * side in each; this covers that and nothing larger.
 */
const CENTRELINE_TOLERANCE_PX = 6;

const STANDING_ROWS = ['idle', 'idle_side', 'idle_away'] as const;

/**
 * G2 — the art still stands on the ground line the cell geometry declares.
 *
 * It cannot catch a wrong `tileX` or `tileY`, and does not claim to: `paintFrame`
 * builds its own paint origin out of those same two constants, so moving one
 * moves the art and this gate's reference line together. Moving `tileY` by 20px
 * leaves every gate here green, her cell being padded enough that even the
 * clipping check stays quiet. The parity run against the deleted sheet is the
 * only thing that ever checked those five numbers.
 *
 * What it does catch is the art drifting off its own anchor — and, unusually,
 * `GROUND_Y` with it: she is scaled about her ground line rather than about the
 * tile centre, so that constant enters the painter as a *pivot* and this gate as
 * an offset. The two therefore move at different rates, and a change to
 * `CAT_SCALE` that failed to keep the pivot would float her paws.
 *
 * The paws are measured against the solid-alpha threshold so the soft contact
 * shadow under her does not count as the lowest ink and quietly satisfy it.
 */
function gateCellGeometry(): void {
  const groundY = TILE_Y + TILE_SCALE / 2 + GROUND_Y * TILE_SCALE;
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
          `${groundY} (tileY ${TILE_Y}, half a ${TILE_SCALE}px tile, then ${GROUND_Y} of one) — ` +
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
 * describes it. The disjunct this replaces allowed the seam up to 2.1× the row's
 * *median* step instead, and could not fail: her walks and idles wrap at
 * 1.27–1.71× their own median as shipped, so a cycle sampled over 1.5 turns
 * still sat comfortably under it.
 *
 * Measured over her eight loops with the ink threshold this module uses, the
 * shipped seams run 0.558–1.281 of their largest in-cycle step, the top being
 * knocked_out (41px against a 32px largest step) and then walk_side (246 against
 * 205). 1.35 is those plus about 5%.
 *
 * What it catches is a cycle that stops *short* of closing: sampled over 0.7 of
 * a turn her rows wrap at 1.34–3.04, six of the eight clear of this limit. It
 * does *not* catch a cycle that overruns — over 1.5 turns every one of her rows
 * measures 1.152 or less, because an overrun raises the ordinary steps faster
 * than it raises the seam. The floor below is the end of the gate with teeth
 * against a mis-sampled phase.
 */
const LOOP_SEAM_CEILING = 1.35;
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
 * several rows drive a channel at half the row's own frequency — Donut's idle
 * head tilt is a `sin(angle * 0.5)` — so the poses only agree again at the whole
 * turn, which is the only place the row ever wraps.
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
 * which would collapse the floor into `seam >= 0`. Her shipped loops wrap at
 * 0.750–1.708 of their median step, so 0.5 is far below any of them and still
 * fires the moment a seam collapses.
 */
const LOOP_SEAM_FLOOR = 0.5;

/** G3 — a loop must close: not a pop across its seam, and not a held frame. */
function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const row of CAT_ROWS) {
    if (row.kind !== 'loop') continue;
    loopsMeasured++;
    const cells = cellsOfRow(row);
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
 * commonest rig defect is a wrong-sign keyframe, which throws a limb out on one
 * frame and back on the next and so produces *two* huge steps. Uncapped, the
 * defect would then be sizing its own allowance.
 */
const STEP_VS_RUNNER_UP = 1.35;
/**
 * The step, as a share of the busiest frame's own ink, below which a frame
 * counts as *held* rather than as motion.
 *
 * Several of her rows hold a pose for a few frames and then move a whole limb —
 * the flank groom sits still through the licking and then puts the hind leg
 * down — and a median taken over every step of such a row is the length of a
 * hold, which the animation has nothing to do with. Measured on the shipped art
 * the flank groom's median step is 5px against moves of up to 385px, so the
 * scale every step is judged against is the median of the *moving* steps.
 */
const HOLD_STEP_INK_SHARE = 0.02;
/**
 * How much of a row may be pixel-identical frames before the row has aliased.
 *
 * Not zero: a grooming break legitimately holds a pose for a beat, and one
 * frozen step of eleven is that hold. A row where a third of the steps change
 * nothing is a cycle sampled below its own rate, which is the Nyquist failure a
 * frame count exists to avoid.
 */
const FROZEN_STEP_SHARE = 1 / 3;

/**
 * G4 — no frame-to-frame jump that reads as a teleport, and no row that has
 * stopped moving.
 *
 * A step far larger than the row's typical one is a pose that skipped; a row
 * whose frames repeat has aliased into a still. Both are invisible in the code
 * and obvious in the picture.
 *
 * How much the snap half can prove, measured rather than assumed: the allowance
 * is a multiple of the row's own median moving step, so a row whose ordinary
 * steps are already large buys itself room. Compared against the largest step
 * any reordering of a row's own frames could produce, only the three idles and
 * `knocked_out` can be failed by a skipped pose — `idle_side` fails at 183px
 * against an allowance of 153. Every walk row and every one-shot has an
 * allowance larger than its two most different frames are apart (`swipe`, 572px
 * against 315), so on those rows this clause can only catch a limb thrown
 * somewhere no frame of the row goes. The frozen-step half below has no such
 * blind spot.
 */
function gateMotionContinuity(): void {
  let stepsMeasured = 0;
  for (const row of CAT_ROWS) {
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    if (steps.length === 0) {
      fail('G4', `${row.name} has no frame-to-frame step to measure`);
      continue;
    }
    stepsMeasured += steps.length;
    const busiestInk = Math.max(...cells.map(inkCountOf));
    const moving = steps.filter((step) => step > busiestInk * HOLD_STEP_INK_SHARE);
    failUnlessMeasured('G4', moving.length, `moving steps in ${row.name}`);
    if (moving.length === 0) continue;
    const typical = median(moving);
    const runnerUp = [...steps].sort((a, b) => b - a)[1] ?? 0;
    const limitShare = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const ordinaryStepLimit = typical * limitShare;
    const runnerUpIsOrdinary = runnerUp <= ordinaryStepLimit;
    const allowed = Math.max(
      ordinaryStepLimit,
      runnerUpIsOrdinary ? runnerUp * STEP_VS_RUNNER_UP : 0,
    );
    steps.forEach((step, index) => {
      if (step <= allowed) return;
      fail(
        'G4',
        `${row.name} snaps between frames ${index} and ${index + 1}: ${step}px changed ` +
          `against a median moving step of ${typical}px and a runner-up of ${runnerUp}px ` +
          `(allowed ${allowed.toFixed(0)}px)`,
      );
    });

    const frozen = steps.filter((step) => step === 0).length;
    if (typical === 0) {
      fail(
        'G4',
        `${row.name} does not move at all: its median frame-to-frame step is 0px, so the row ` +
          'has aliased into a still',
      );
    } else if (frozen > steps.length * FROZEN_STEP_SHARE) {
      fail(
        'G4',
        `${row.name} repeats ${frozen} of its ${steps.length} steps exactly — more than the ` +
          `${(FROZEN_STEP_SHARE * 100).toFixed(0)}% a held beat accounts for, so the row is ` +
          'sampled below its own rate',
      );
    }
  }
  failUnlessMeasured('G4', stepsMeasured, 'frame-to-frame steps');
}

// ── G5: the claw comes out and goes away again ───────────────────────────────

const SWIPE_ROWS = ['swipe', 'swipe_side', 'swipe_away'] as const;
/**
 * The views that show the claws at all. Seen from behind her forepaw is on the
 * far side of her body, so the back view draws no claw and measuring one there
 * would compare a row of zeros against itself.
 */
const CLAWED_SWIPE_ROWS = ['swipe', 'swipe_side'] as const;
/** How much of its peak the claw may still be showing on the row's last frame. */
const CLAW_SHEATHED_SHARE = 0.25;
/** A claw value below this counts as sheathed rather than as a small extension. */
const CLAW_EPSILON = 1e-6;

/**
 * G5 — every swipe unsheathes its claws mid-swing and puts them away.
 *
 * The claw is the whole read of the attack at tile size. A row whose claw peaks
 * on its first or last frame is one that never swung — it either starts armed
 * or ends armed — and neither is visible in anything but the picture.
 *
 * `swipe_away` is drawn from behind and shows no claw of its own, so the gate
 * measures the pose's claw value rather than painted ink: the value is what the
 * three views share, and it is what a redraw would break.
 */
function gateClawSwing(): void {
  let clawedRowsMeasured = 0;
  for (const name of CLAWED_SWIPE_ROWS) {
    const row = rowNamed(name, 'G5');
    if (row === null) continue;
    clawedRowsMeasured++;
    const claws = posesOf(row).map((pose) => pose.frontR.claw);
    let peakFrame = 0;
    claws.forEach((claw, frame) => {
      if (claw > claws[peakFrame]) peakFrame = frame;
    });
    const last = row.frameCount - 1;
    if (peakFrame === 0 || peakFrame === last) {
      fail(
        'G5',
        `${name} has its claws furthest out on frame ${peakFrame} of ${last} — the swing has ` +
          'no middle, so she is either armed before it starts or still armed when it ends',
      );
    }
    if (claws[peakFrame] <= CLAW_EPSILON) {
      fail('G5', `${name} never unsheathes a claw at all`);
      continue;
    }
    if (claws[last] > claws[peakFrame] * CLAW_SHEATHED_SHARE) {
      fail(
        'G5',
        `${name} ends with its claws at ${claws[last].toFixed(3)} against a peak of ` +
          `${claws[peakFrame].toFixed(3)} — they are never put away, so the row cannot hand ` +
          'back to idle',
      );
    }
  }
  failUnlessMeasured('G5', clawedRowsMeasured, 'clawed swipe rows');

  // The slash arc is what reads as the blow at tile size, and every view draws
  // one — including the one that shows no claw.
  let slashRowsMeasured = 0;
  for (const name of SWIPE_ROWS) {
    const row = rowNamed(name, 'G5');
    if (row === null) continue;
    slashRowsMeasured++;
    const poses = posesOf(row);
    failUnlessMeasured(
      'G5',
      poses.filter((pose) => pose.slash !== null).length,
      `frames of ${name} drawing a slash arc`,
    );
    if (poses[0].slash !== null) {
      fail('G5', `${name} draws its slash arc on frame 0, before the paw has travelled anywhere`);
    }
  }
  failUnlessMeasured('G5', slashRowsMeasured, 'swipe rows');
}

// ── G6: the cast charges before it releases ──────────────────────────────────

const CAST_ROWS = ['cast', 'cast_side', 'cast_away'] as const;
/** A charge or a release below this counts as not happening yet. */
const CAST_EPSILON = 1e-6;

/**
 * G6 — the orb is charged before it is thrown.
 *
 * `castRelease` is what paints the bolt leaving her paws and `cast` is what
 * paints it building up. A row that releases before it charges, or that never
 * releases at all, is a spell animation with no throw in it — and the missile
 * itself is a separate sprite, so nothing else in the game would look wrong.
 *
 * Compared against an epsilon rather than for equality with zero: a ramp that
 * starts returning a hair above zero instead of exactly zero would empty an
 * equality filter and leave this passing while measuring nothing.
 */
function gateCastChargesBeforeRelease(): void {
  let rowsMeasured = 0;
  for (const name of CAST_ROWS) {
    const row = rowNamed(name, 'G6');
    if (row === null) continue;
    rowsMeasured++;
    const poses = posesOf(row);
    const firstRelease = poses.findIndex((pose) => pose.castRelease > CAST_EPSILON);
    if (firstRelease < 0) {
      fail('G6', `${name} never releases: castRelease stays at zero for the whole row`);
      continue;
    }
    let peakChargeFrame = 0;
    poses.forEach((pose, frame) => {
      if (pose.cast > poses[peakChargeFrame].cast) peakChargeFrame = frame;
    });
    if (poses[peakChargeFrame].cast <= CAST_EPSILON) {
      fail('G6', `${name} never charges: cast stays at zero for the whole row`);
      continue;
    }
    if (peakChargeFrame > firstRelease) {
      fail(
        'G6',
        `${name} is still charging on frame ${peakChargeFrame} but released on frame ` +
          `${firstRelease} — the bolt leaves her paws before the orb is built`,
      );
    }
  }
  failUnlessMeasured('G6', rowsMeasured, 'cast rows');
}

// ── G7: the downed pose is down ──────────────────────────────────────────────

/**
 * How much shorter than her standing silhouette the collapsed one has to be.
 *
 * Measured: the shipped downed pose stands 75% of the standing one, and a
 * version of it with the roll, the drop and the flatten all removed stands 84%
 * — a cat with her eyes shut. The limit sits between the two.
 */
const KNOCKED_OUT_MAX_HEIGHT_SHARE = 0.8;

/**
 * G7 — the knocked-out row actually lies down.
 *
 * It is the only cue the player has that the companion is dead rather than
 * idling, and it is drawn from the profile art with a roll and a drop rather
 * than from a pose of its own, so a change to either quietly stands her back
 * up.
 */
function gateKnockedOutLiesDown(): void {
  const downed = rowNamed('knocked_out', 'G7');
  const standing = rowNamed('idle_side', 'G7');
  if (downed === null || standing === null) return;

  const heightOf = (row: RowSpec): number => {
    let tallest = 0;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = inkStatsOf(cellAlpha(row.name, frame));
      if (stats.count === 0) continue;
      tallest = Math.max(tallest, stats.maxY - stats.minY + 1);
    }
    return tallest;
  };

  const downHeight = heightOf(downed);
  const standHeight = heightOf(standing);
  if (downHeight === 0 || standHeight === 0) {
    fail('G7', 'one of knocked_out and idle_side painted no ink to measure a height from');
    return;
  }
  const share = downHeight / standHeight;
  console.log(
    `  G7 downed silhouette: knocked_out stands ${downHeight}px against idle_side's ` +
      `${standHeight}px (${(share * 100).toFixed(0)}%)`,
  );
  if (share > KNOCKED_OUT_MAX_HEIGHT_SHARE) {
    fail(
      'G7',
      `knocked_out is ${(share * 100).toFixed(0)}% as tall as idle_side — she is not lying ` +
        `down, and the limit is ${(KNOCKED_OUT_MAX_HEIGHT_SHARE * 100).toFixed(0)}%`,
    );
  }
}

// ── G8: the names and counts the runtime asks for ────────────────────────────

const SPRITE_MODULE_PATH = 'src/sprites/catSprite.ts';

function spriteModuleSource(): string {
  return readFileSync(resolve(SPRITE_MODULE_PATH), 'utf8');
}

/**
 * The frame-count constants the sprite module is allowed to key a row to. Both
 * modules import these from the choreography, so the gate resolves the name the
 * sprite module wrote rather than a literal it might have typed.
 */
const FRAME_CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['WALK_FRAMES', WALK_FRAMES],
  ['IDLE_FRAMES', IDLE_FRAMES],
  ['BREAK_FRAMES', BREAK_FRAMES],
  ['ACTION_FRAMES', ACTION_FRAMES],
  ['KO_FRAMES', KO_FRAMES],
  ['DANCE_FRAMES', DANCE_FRAMES],
]);

/**
 * The row names `directionalState` builds by template literal.
 *
 * This is the shape that goes wrong silently: `${base}_${view}` is a name no
 * grep for a string literal will ever find, and a draw call handed one the
 * figure does not paint returns without drawing and without a word. Every
 * combination the function can produce is enumerated here and checked.
 */
const DIRECTIONAL_BASES = ['walk', 'idle', 'swipe', 'cast'] as const;
const DIRECTIONAL_SUFFIXES = ['', '_side', '_away'] as const;

function directionalStateNames(): string[] {
  return DIRECTIONAL_BASES.flatMap((base) =>
    DIRECTIONAL_SUFFIXES.map((suffix) => `${base}${suffix}`),
  );
}

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

  const union = /type CatState =([^;]*);/.exec(source);
  if (union === null) {
    fail('G8', `${SPRITE_MODULE_PATH} does not declare a CatState union`);
  } else {
    const names = [...union[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    for (const failure of missingStateFailures(
      CAT_FIGURE,
      names,
      `${SPRITE_MODULE_PATH}'s CatState`,
    )) {
      fail('G8', failure);
    }
  }

  const oneShots = /export type CatOneShot =([^;]*);/.exec(source);
  if (oneShots === null) {
    fail('G8', `${SPRITE_MODULE_PATH} does not declare a CatOneShot union`);
  } else {
    const names = [...oneShots[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    // The two directional one-shots are asked for as `${action}_${view}`, which
    // the directional check below covers; the rest are drawn by their own name.
    const headOnOnly = names.filter((name) => name !== 'swipe' && name !== 'cast');
    for (const failure of missingStateFailures(
      CAT_FIGURE,
      headOnOnly,
      `${SPRITE_MODULE_PATH}'s CatOneShot`,
    )) {
      fail('G8', failure);
    }
  }

  for (const failure of missingStateFailures(
    CAT_FIGURE,
    directionalStateNames(),
    `${SPRITE_MODULE_PATH}'s directionalState`,
  )) {
    fail('G8', failure);
  }

  const prewarm = /const PREWARMED_ROWS: ReadonlyArray<CatState> = \[([^\]]*)\]/.exec(source);
  if (prewarm === null) {
    fail('G8', `${SPRITE_MODULE_PATH} does not declare a PREWARMED_ROWS list`);
  } else {
    const warmed = [...prewarm[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    for (const failure of missingStateFailures(
      CAT_FIGURE,
      warmed,
      `${SPRITE_MODULE_PATH}'s PREWARMED_ROWS`,
    )) {
      fail('G8', failure);
    }
    // Her painter costs an order of magnitude more per frame than the point at
    // which painting on demand fits inside a frame's slack, so a row nobody
    // warms is a dropped frame the first time she plays it.
    for (const state of CAT_FIGURE.states.keys()) {
      if (warmed.includes(state)) continue;
      fail(
        'G8',
        `nothing prewarms "${state}", and her painter is far too slow to bake a row of it on ` +
          'the frame she first needs it',
      );
    }
  }

  const table = /const FRAME_COUNT: Record<CatState, number> = \{([^}]*)\}/.exec(source);
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
    const painted = CAT_FIGURE.states.get(state)?.frames;
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
 * because she is on screen continuously with several of her rows warm at once.
 */
const ROW_BUDGET_MEGABYTES = 3;

/** G9 — the widest warm row's memory, reported whether or not it passes. */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of CAT_FIGURE.states) {
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
export function catGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateCellGeometry();
  gateLoopClosure();
  gateMotionContinuity();
  gateClawSwing();
  gateCastChargesBeforeRelease();
  gateKnockedOutLiesDown();
  gateRuntimeStates();
  gateWarmRowSize();
  return [...failures];
}
