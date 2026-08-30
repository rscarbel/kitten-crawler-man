/**
 * The Rat Kin's art gates.
 *
 * The creature has no baked sheet to inspect any more, so every invariant the
 * old bake gate enforced against sheet pixels is enforced here against cells
 * painted from `RAT_KIN_FIGURE` — baked exactly the way the runtime cache bakes
 * them, supersampled and downsampled, so what is measured is what the game
 * blits. The pose-stream gates measure the rig itself and need no pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop measured nothing: a lookup
 * that quietly returns nothing turns a whole gate module green while examining
 * no art.
 *
 * Run by the review harness: `npm run render:rat-kin`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import { asGameContext } from './nodeGameContext.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  CONTRALATERAL_PHASE,
  GROUND_OFFSET_IN_TILE,
  ORIGIN_X,
  ORIGIN_Y,
  RAT_KIN_FIGURE,
  RAT_KIN_ROWS,
  RAT_KIN_SCALE,
  STANCE_FRACTION,
  TILE_SCALE,
  poseStream,
  type RowSpec,
} from '../src/sprites/art/ratKinFigure.js';
import {
  FLAT_TOE_CONTACT_HEIGHT,
  LEG_REACH_LIMIT,
  measureLegs,
  toeContactHeight,
} from '../src/sprites/art/ratKinArt.js';
import {
  RAT_KIN_DRAWN_STATES,
  RAT_KIN_PREWARMED_STATES,
  RAT_KIN_TILES_PER_WALK_CYCLE,
} from '../src/sprites/ratKinSprite.js';

const ALPHA_OFFSET = 3;
const CHANNELS = 4;
/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
const MAX_ALPHA = 255;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const { frameWidth, frameHeight } = RAT_KIN_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Several gates here narrow before they measure — planted frames only, profile
 * rows only, one entry per declared state — and a narrowing that matches
 * nothing leaves a green gate that examined nothing. Every filtering loop here
 * counts what it looked at and ends with a call to this.
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
  const cell = bakeFigureCell(RAT_KIN_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

/** Mean absolute alpha difference between two cells, 0–255. */
function cellDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

interface Centroid {
  readonly x: number;
  readonly y: number;
}

/** The ink centroid of a cell, or null when the cell painted nothing. */
function inkCentroid(alpha: Uint8ClampedArray): Centroid | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alpha[y * frameWidth + x] < INK_ALPHA_THRESHOLD) continue;
      sumX += x;
      sumY += y;
      count++;
    }
  }
  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count };
}

function consecutiveSteps(row: RowSpec): number[] {
  const steps: number[] = [];
  for (let frame = 1; frame < row.frameCount; frame++) {
    steps.push(cellDelta(cellAlpha(row.name, frame - 1), cellAlpha(row.name, frame)));
  }
  return steps;
}

/**
 * The row a gate names, or null after recording a failure.
 *
 * The name is a string literal written here rather than in `RAT_KIN_ROWS`, so
 * renaming a row would otherwise turn its gate into a silent no-op: present,
 * green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = RAT_KIN_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `no row named "${name}" — a gate is guarding a row that no longer exists`);
    return null;
  }
  return row;
}

// ── G1: structure ────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly
 * empty. The edge check is the old border-clip gate: a frame that paints
 * outside its cell is clipped away silently, and nothing downstream can detect
 * it.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(RAT_KIN_FIGURE)) fail('G1', failure);
}

// ── G2: the tile anchor ──────────────────────────────────────────────────────

/**
 * Where his soles must land inside his own tile, measured from the tile's floor.
 *
 * Against the *tile*, never against the painter's own ground line: the two are
 * built from the same ground-offset constant, so a gate comparing them moves
 * both together and passes whatever that constant is set to. The tile is frozen
 * geometry the health bar, the talk prompt and the minimap marker are all hung
 * off, which is what makes it an independent thing to measure against.
 *
 * Measured against *solid* alpha on a canvas padded all round, and both halves
 * of that are load-bearing. Against ordinary ink the question is answered by the
 * contact shadow, which is painted at the ground line wherever the feet are: a
 * mutation that lifted every standing foot 0.15 of a tile off the floor left
 * this gate green, because the shadow it was reading had not moved. And inside
 * the cell the lowest row a figure can report is the cell's own last row, which
 * capped the reading at 6px below the tile floor and made the sinking half of
 * the band unreachable at any setting — the clipping gate spoke instead.
 *
 * The band is asymmetric because a sole's own soft lower edge can still cross
 * the line while nothing legitimately floats above it. Measured on the shipped
 * art, every row's solid sole line sits 3–4px above the tile floor.
 */
const SOLES_ABOVE_TILE_FLOOR_MIN_PX = -2;
const SOLES_ABOVE_TILE_FLOOR_MAX_PX = 4;
/** Alpha above which a pixel counts as *body* rather than as an antialiased edge. */
const SOLID_ALPHA_THRESHOLD = 200;
/** Clear pixels kept around the measurement, wider than any pose can reach. */
const ANCHOR_MEASURE_PAD = 160;

/**
 * The lowest solid row of one frame, in cell coordinates, painted into a canvas
 * padded on all four sides so a figure sunk below the cell reports where it
 * actually reached rather than where the cell cut it off.
 */
function lowestSolidRow(state: string, frame: number): number | null {
  const width = frameWidth + ANCHOR_MEASURE_PAD * 2;
  const height = frameHeight + ANCHOR_MEASURE_PAD * 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(ANCHOR_MEASURE_PAD, ANCHOR_MEASURE_PAD);
  RAT_KIN_FIGURE.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { data } = ctx.getImageData(0, 0, width, height);
  let lowest = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA_THRESHOLD) lowest = y;
    }
  }
  return lowest < 0 ? null : lowest - ANCHOR_MEASURE_PAD;
}

/**
 * G2 — his feet must stand on the tile the figure claims, or the health bar,
 * the talk prompt and the minimap marker all sit somewhere else.
 */
function gateAnchor(): void {
  // Every row, not just one: the head-on and edge-on feet are painted by
  // different code, and a view that stands a pixel lower than the others is
  // exactly the drift a single-row sample cannot see.
  const tileFloor = RAT_KIN_FIGURE.tileY + TILE_SCALE;
  let rowsMeasured = 0;
  for (const row of RAT_KIN_ROWS) {
    const soleLine = lowestSolidRow(row.name, 0);
    if (soleLine === null) {
      fail('G2', `${row.name}[0] painted no solid ink at all to stand on`);
      continue;
    }
    rowsMeasured++;
    const aboveFloor = tileFloor - soleLine;
    if (aboveFloor > SOLES_ABOVE_TILE_FLOOR_MAX_PX) {
      fail(
        'G2',
        `${row.name}'s lowest solid ink is ${aboveFloor}px above his tile's floor, past a limit ` +
          `of ${SOLES_ABOVE_TILE_FLOOR_MAX_PX}px — he is floating`,
      );
    }
    if (aboveFloor < SOLES_ABOVE_TILE_FLOOR_MIN_PX) {
      fail(
        'G2',
        `${row.name}'s lowest solid ink is ${-aboveFloor}px below his tile's floor (limit ` +
          `${-SOLES_ABOVE_TILE_FLOOR_MIN_PX}px of soft sole edge) — the figure's tileY no ` +
          'longer describes where he stands',
      );
    }
  }
  failUnlessMeasured('G2', rowsMeasured, 'rows with a measurable sole line');
}

// ── G3 / G4: continuity ──────────────────────────────────────────────────────

/**
 * Floor under both delta gates, as a budget of fully-opaque pixels on the bake.
 *
 * Both gates are ratio tests, and a ratio against a near-zero median means
 * nothing: a head-on idle is *supposed* to sit near the threshold of visibility,
 * so its typical step is a fraction of a pixel's worth of antialiased edge and
 * any transition at all measures several times it. The head-on idle is the row
 * this actually covers — it is not merely guarding against a silly ratio, it is
 * passing a measurement that would otherwise fail on a change nobody can see.
 *
 * Stated in pixels rather than in mean alpha because mean alpha is per-cell: an
 * absolute mean would quietly buy a bigger allowance as the cell grew.
 */
const SEAM_INK_BUDGET_PX = 24;

function deltaLimit(typical: number, factor: number): number {
  const floor = (SEAM_INK_BUDGET_PX * MAX_ALPHA) / (frameWidth * frameHeight);
  return Math.max(typical * factor, floor);
}

/**
 * G3 — loop closure. A cycle whose last frame does not lead back into its first
 * pops once per lap, which is invisible on a contact sheet and obvious in
 * motion; one sampled over anything other than its own length never closes at
 * all.
 */
/**
 * How far past the row's own largest ordinary step the seam may reach.
 *
 * A closed cycle crosses its seam the way it crosses anywhere else, so the
 * largest in-cycle step is the yardstick. Measured on shipped art, these six
 * loop rows seam at 0.39–0.63 of their largest step (walk_away lowest,
 * walk_side highest), and the worst reading of any painted figure in the repo is
 * 1.076. This replaces a limit of 2.2× the row's *median* step, which a walk's
 * own large steps swamp: on other figures a row deliberately re-timed to run one
 * and a half cycles passed that form of the check. This clause is an art-drift check and cannot see cycle count at
 * all: re-timing a row moves the steps it is judged against along with the
 * seam. The wrap clause is what covers that.
 */
const LOOP_SEAM_CEILING = 1.15;
/**
 * The least of the row's median step the seam may be.
 *
 * The half this gate lacked altogether. Sampling a cycle at
 * `frame / (frameCount - 1)` instead of `frame / frameCount` makes the last
 * frame identical to the first: the seam goes to zero, the loop holds still for
 * a whole frame every lap, and a ceiling-only gate stays green through it.
 * Against the median step rather than the narrowest, because a row may
 * legitimately hold two identical adjacent frames, which would collapse the
 * floor to `seam >= 0`. Measured: these rows seam at 0.47–0.88 of their median.
 */
const LOOP_SEAM_FLOOR_SHARE = 0.25;
/**
 * How far the frame one past a loop's last may sit from its first, in mean
 * alpha.
 *
 * The clause that binds a cycle to exactly one turn, and the only one that can:
 * a seam ratio moves its own denominator when the row is re-timed. The painter
 * takes a frame index rather than a phase, so a loop can be painted at
 * `frameCount` — one frame past its end — where a closed cycle reproduces frame
 * 0. Not held to exactly zero because the cell is downsampled from twice its
 * size and a pose value landing on 2π rather than 0 rounds independently on each
 * side; these six rows measure 0.0000–0.0010, against a closest honest
 * frame-to-frame distance of 0.87.
 */
const LOOP_WRAP_TOLERANCE = 0.05;
/**
 * The least any interior frame of a loop may sit from its first, in mean alpha.
 *
 * The wrap check is satisfied by a row that runs its cycle *twice*, which
 * repeats frame 0 in the middle of the row. Measured: the closest any interior
 * frame comes to frame 0 across these rows is 0.871 (idle), against the 0 an
 * exact repeat scores.
 */
const LOOP_INTERIOR_REPEAT_FLOOR = 0.3;

function gateLoopClosure(): void {
  let rowsMeasured = 0;
  for (const row of RAT_KIN_ROWS) {
    rowsMeasured++;
    const steps = consecutiveSteps(row);
    const typical = median(steps);
    const seam = cellDelta(cellAlpha(row.name, row.frameCount - 1), cellAlpha(row.name, 0));

    const wrap = cellDelta(cellAlpha(row.name, row.frameCount), cellAlpha(row.name, 0));
    if (wrap > LOOP_WRAP_TOLERANCE) {
      fail(
        'G3',
        `${row.name} does not cover exactly one turn: painted at frame ${row.frameCount}, one ` +
          `past its end, it sits ${wrap.toFixed(3)} from frame 0 (allowed ` +
          `${LOOP_WRAP_TOLERANCE}) — the cycle is sampled over more or less than its own ` +
          'length, so the row plays at the wrong rate and never closes',
      );
    }
    let closestInterior = Infinity;
    let closestFrame = -1;
    for (let frame = 1; frame < row.frameCount; frame++) {
      const distance = cellDelta(cellAlpha(row.name, frame), cellAlpha(row.name, 0));
      if (distance >= closestInterior) continue;
      closestInterior = distance;
      closestFrame = frame;
    }
    if (closestInterior < LOOP_INTERIOR_REPEAT_FLOOR) {
      fail(
        'G3',
        `${row.name}[${closestFrame}] comes back to within ${closestInterior.toFixed(3)} of ` +
          `frame 0 (at least ${LOOP_INTERIOR_REPEAT_FLOOR} expected) — the row is running its ` +
          'cycle more than once',
      );
    }

    const limit = deltaLimit(Math.max(...steps), LOOP_SEAM_CEILING);
    if (seam > limit) {
      fail(
        'G3',
        `${row.name}'s loop seam is ${seam.toFixed(2)} against a largest in-cycle step of ` +
          `${Math.max(...steps).toFixed(2)} (limit ${limit.toFixed(2)})`,
      );
    }
    const floor = typical * LOOP_SEAM_FLOOR_SHARE;
    if (seam < floor) {
      fail(
        'G3',
        `${row.name} holds still across its loop seam: it sits only ${seam.toFixed(3)} from ` +
          `frame 0 against a median step of ${typical.toFixed(3)} (floor ${floor.toFixed(3)}) — ` +
          'the cycle is being sampled so that its last frame repeats its first',
      );
    }
  }
  failUnlessMeasured('G3', rowsMeasured, 'looping rows');
}

/**
 * G4 — motion continuity. A snapped knee, a mid-swing draw-order flip or an IK
 * clamp all show up as one consecutive-frame delta far above its neighbours.
 */
const CONTINUITY_LIMIT = 2.4;

function gateContinuity(): void {
  let stepsMeasured = 0;
  for (const row of RAT_KIN_ROWS) {
    const steps = consecutiveSteps(row);
    const typical = median(steps);
    const limit = deltaLimit(typical, CONTINUITY_LIMIT);
    steps.forEach((step, index) => {
      stepsMeasured++;
      if (step > limit) {
        fail(
          'G4',
          `${row.name} jumps ${step.toFixed(2)} between frames ${index} and ${index + 1}, ` +
            `against a median step of ${typical.toFixed(2)} (limit ${limit.toFixed(2)})`,
        );
      }
    });
  }
  failUnlessMeasured('G4', stepsMeasured, 'consecutive-frame steps');
}

/**
 * G5 — centroid drift. A walk cycle is drawn in place: the body must end the lap
 * where it started it, or he moonwalks along his own path in the safe room.
 */
const CENTROID_DRIFT_LIMIT_PX = 1.5;
/** A seam step may be this much larger than a typical one before it reads. */
const CENTROID_SEAM_SHARE = 2;

function gateCentroidDrift(): void {
  let rowsMeasured = 0;
  for (const row of RAT_KIN_ROWS) {
    const first = inkCentroid(cellAlpha(row.name, 0));
    const last = inkCentroid(cellAlpha(row.name, row.frameCount - 1));
    if (first === null || last === null) {
      fail('G5', `${row.name} has a cell with no ink at all to take a centroid from`);
      continue;
    }
    const steps: number[] = [];
    for (let frame = 1; frame < row.frameCount; frame++) {
      const before = inkCentroid(cellAlpha(row.name, frame - 1));
      const after = inkCentroid(cellAlpha(row.name, frame));
      if (before === null || after === null) continue;
      steps.push(Math.hypot(after.x - before.x, after.y - before.y));
    }
    rowsMeasured++;
    const seam = Math.hypot(first.x - last.x, first.y - last.y);
    const limit = Math.max(CENTROID_DRIFT_LIMIT_PX, median(steps) * CENTROID_SEAM_SHARE);
    if (seam > limit) {
      fail(
        'G5',
        `${row.name}'s ink centroid steps ${seam.toFixed(2)}px across the loop seam, against ` +
          `a limit of ${limit.toFixed(2)}px`,
      );
    }
  }
  failUnlessMeasured('G5', rowsMeasured, 'rows with a measurable centroid');
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

/**
 * G6 — reach headroom. Hip→hock must stay inside the thigh and shank's combined
 * span on *every* frame. One clamped frame locks the leg straight, the next
 * tuck snaps it back, and the result reads as a hop rather than as a walk.
 */
const REACH_HEADROOM = 0.004;

function gateReachHeadroom(): void {
  let worst = 0;
  let worstAt = '';
  let legsMeasured = 0;
  for (const { row, frame, pose } of poseStream()) {
    const legs = measureLegs(pose, row.view);
    for (const [side, leg] of Object.entries(legs)) {
      legsMeasured++;
      if (leg.hipToHock <= worst) continue;
      worst = leg.hipToHock;
      worstAt = `${row.name}[${frame}] ${side}`;
    }
  }
  failUnlessMeasured('G6', legsMeasured, 'legs');
  if (legsMeasured === 0) return;
  if (worst > LEG_REACH_LIMIT - REACH_HEADROOM) {
    fail(
      'G6',
      `${worstAt} asks the leg to span ${worst.toFixed(4)} against a reach of ` +
        `${LEG_REACH_LIMIT.toFixed(4)} — shorten STRIDE or drop the pelvis further at contact`,
    );
  }
  console.log(
    `  G6 reach headroom: worst frame spans ${worst.toFixed(4)} of ` +
      `${LEG_REACH_LIMIT.toFixed(4)} (${worstAt})`,
  );
}

/**
 * G7 — foot slide. The classic moonwalk.
 *
 * The contact is the *toe pads*, not the ball: late in stance the ball rocks up
 * off the floor and the push-off rolls forward onto the toes, so a gate watching
 * the ball would read that roll as the foot leaving the ground early. What has
 * to hold is that the pads stay at their own contact height and travel backward
 * under the body monotonically.
 *
 * Returns the ground one full cycle covers, in tiles, so G10 can check the
 * runtime against something *measured* rather than against a formula — or null
 * when it measured no planted frame at all.
 */
const PLANTED_EPSILON = 1e-9;
/** How far the toe pads may wander off their contact plane while planted. */
const CONTACT_HEIGHT_TOLERANCE = 0.002;
/** How much the per-frame slide may vary across a stance before it reads. */
const SLIDE_RATE_TOLERANCE = 1e-9;

function gateFootSlide(): number | null {
  // Only the profile walk plants a foot and slides it: the head-on gait has
  // almost no stride to show, so its feet barely move by design.
  const walk = rowNamed('walk_side', 'G7');
  if (walk === null) return null;

  const slides: number[] = [];
  let plantedFramesMeasured = 0;

  for (const side of ['near', 'far'] as const) {
    // Stance comes from the phase, not from the foot's height: once the ball
    // lifts at toe-off, height no longer distinguishes stance from swing.
    const phaseOffset = side === 'near' ? 0 : CONTRALATERAL_PHASE;
    let previous: { x: number; frame: number } | null = null;
    for (let frame = 0; frame < walk.frameCount; frame++) {
      const cycle = (((frame / walk.frameCount + phaseOffset) % 1) + 1) % 1;
      const pose = walk.pose(frame);
      const foot = side === 'near' ? pose.nearFoot : pose.farFoot;
      if (cycle >= STANCE_FRACTION) {
        previous = null;
        continue;
      }
      plantedFramesMeasured++;

      const contact = toeContactHeight(foot);
      if (Math.abs(contact - FLAT_TOE_CONTACT_HEIGHT) > CONTACT_HEIGHT_TOLERANCE) {
        fail(
          'G7',
          `the ${side} foot's toe pads sit ${contact.toFixed(4)} while planted on walk_side ` +
            `frame ${frame}, against a contact plane of ${FLAT_TOE_CONTACT_HEIGHT} — the roll ` +
            'is lifting the foot off the floor instead of rocking it forward',
        );
      }
      if (previous !== null && foot.ball.x >= previous.x - PLANTED_EPSILON) {
        fail(
          'G7',
          `the ${side} foot slides forward while planted — x went from ` +
            `${previous.x.toFixed(4)} on frame ${previous.frame} to ${foot.ball.x.toFixed(4)} ` +
            `on frame ${frame}`,
        );
      }
      if (previous !== null) slides.push(previous.x - foot.ball.x);
      previous = { x: foot.ball.x, frame };
    }
  }

  failUnlessMeasured('G7', plantedFramesMeasured, 'planted frames of walk_side');
  if (slides.length === 0) {
    fail('G7', 'no consecutive pair of planted frames of walk_side to measure a slide across');
    return null;
  }

  // The rate, not the span. A planted foot slides at a constant rate — that is
  // what "the body travels over it" means — so the ground covered per cycle is
  // one frame's slide times the frame count. Measuring the span of the *sampled*
  // frames instead comes up one frame-step short, because the last instant of
  // stance falls between two frames and is never drawn.
  const slowest = Math.min(...slides);
  const fastest = Math.max(...slides);
  if (fastest - slowest > SLIDE_RATE_TOLERANCE) {
    fail(
      'G7',
      `the planted foot slides unevenly — between ${slowest.toFixed(5)} and ` +
        `${fastest.toFixed(5)} per frame (limit ${SLIDE_RATE_TOLERANCE}). A stance that ` +
        'accelerates under him is a skate however monotonic it is',
    );
  }
  return fastest * walk.frameCount * RAT_KIN_SCALE;
}

/**
 * G8 — both feet never leave the floor. He walks; he does not run or hop, so
 * every frame has at least one foot in contact. A frame with neither is a flight
 * phase, which at this gait reads as a stumble.
 *
 * Measured at the toe pads, for the same reason G7 is: from the moment the ball
 * rocks up at toe-off it is no longer what is touching the ground.
 */
function gateGroundContact(): void {
  let framesMeasured = 0;
  for (const { row, frame, pose } of poseStream()) {
    framesMeasured++;
    const lowest = Math.max(toeContactHeight(pose.nearFoot), toeContactHeight(pose.farFoot));
    if (lowest < FLAT_TOE_CONTACT_HEIGHT - CONTACT_HEIGHT_TOLERANCE) {
      fail(
        'G8',
        `${row.name}[${frame}] has both feet off the floor (lowest toe contact at ` +
          `${lowest.toFixed(4)}, floor at ${FLAT_TOE_CONTACT_HEIGHT})`,
      );
    }
  }
  failUnlessMeasured('G8', framesMeasured, 'poses');
}

/**
 * G9 — knee direction, and its head-on counterpart.
 *
 * Edge-on every knee bends forward, and a knee that solves behind the hip→hock
 * line has hinged backward — the most obviously wrong thing a profile walk can
 * do, and something a sign flip produces silently.
 *
 * Head-on that test is meaningless and the opposite rule applies: a real knee
 * hinges *away* from the camera, so it has to stay on the hip→hock line. A knee
 * thrown sideways there flickers once per step and reads as a wiggle. Checking
 * only one of the two leaves the other free to be wrong.
 */
/** A head-on leg is a straight column, which the art declares as this exactly. */
const STRAIGHT_COLUMN_FORESHORTEN = 1;

function gateKneeDirection(): void {
  let facingFeetMeasured = 0;
  let profileKneesMeasured = 0;
  for (const { row, frame, pose } of poseStream()) {
    if (row.view !== 'side') {
      // Head-on, the off-line measure cannot fail: `foreshorten: 1` *assigns*
      // the knee to the straight-leg point any offset would be measured
      // against, so the number is structurally zero. The invariant worth
      // policing is the one a new pose can actually get wrong — declaring the
      // foreshortening at all.
      for (const [side, foot] of Object.entries({ near: pose.nearFoot, far: pose.farFoot })) {
        facingFeetMeasured++;
        if (foot.foreshorten !== STRAIGHT_COLUMN_FORESHORTEN) {
          fail(
            'G9',
            `${row.name}[${frame}]'s ${side} foot declares foreshorten ${foot.foreshorten} ` +
              `head-on, where every leg must be a straight column ` +
              `(${STRAIGHT_COLUMN_FORESHORTEN})`,
          );
        }
      }
      continue;
    }
    const legs = measureLegs(pose, row.view);
    for (const [side, leg] of Object.entries(legs)) {
      profileKneesMeasured++;
      // Signed area of hip→hock against hip→knee. Facing +X with +Y down, a
      // knee forward of that line gives a negative cross product.
      const hock = { x: leg.hock.x - leg.hip.x, y: leg.hock.y - leg.hip.y };
      const knee = { x: leg.knee.x - leg.hip.x, y: leg.knee.y - leg.hip.y };
      const cross = hock.x * knee.y - hock.y * knee.x;
      if (cross >= 0) {
        fail(
          'G9',
          `${row.name}[${frame}]'s ${side} knee sits behind the hip→hock line ` +
            `(cross ${cross.toFixed(5)}) — the leg has hinged backward`,
        );
      }
    }
  }
  failUnlessMeasured('G9', facingFeetMeasured, 'head-on feet');
  failUnlessMeasured('G9', profileKneesMeasured, 'profile knees');
}

/**
 * G10 — stride sync. `src/sprites/ratKinSprite.ts` declares how much ground one
 * walk cycle covers so the runtime can advance the phase by distance travelled.
 *
 * It is checked against what G7 *measured* off the planted frames, not against a
 * hand-derived formula: a formula agrees with itself even after the keyframes it
 * claims to describe have been edited out from under it.
 *
 * Drift here does not break anything visibly enough to notice — it just makes
 * his feet skate, quietly, forever.
 */
/** The runtime constant is written to four decimals, so it can differ by half of one. */
const STRIDE_TOLERANCE = 0.00005;

function gateStrideSync(measuredTilesPerCycle: number | null): void {
  if (measuredTilesPerCycle === null) {
    fail('G10', 'the foot-slide gate measured no stride for this to be checked against');
    return;
  }
  if (Math.abs(RAT_KIN_TILES_PER_WALK_CYCLE - measuredTilesPerCycle) > STRIDE_TOLERANCE) {
    fail(
      'G10',
      `the sprite wrapper says one walk cycle covers ${RAT_KIN_TILES_PER_WALK_CYCLE} tiles, ` +
        `but the choreography covers ${measuredTilesPerCycle.toFixed(4)} — his feet will ` +
        'skate until they agree',
    );
  }
  console.log(
    `  G10 stride sync: one walk cycle covers ${RAT_KIN_TILES_PER_WALK_CYCLE} tiles (measured ` +
      `${measuredTilesPerCycle.toFixed(4)})`,
  );
}

// ── G11: the warm-row budget ─────────────────────────────────────────────────

/**
 * The hard ceiling for one warm animation row.
 *
 * The sheet this figure replaced had a stated whole-texture budget. A painted
 * figure is admitted to the cache a row at a time, so the number that decides
 * whether it fits is the widest row's warm bytes rather than the sum of all of
 * them — and it has to stay well inside the cache's own per-figure ceiling so
 * that a second row can be warm at the same time. He can exist in more than one
 * safe room at once, and every instance of him shares these same cells.
 */
const ROW_BUDGET_MEGABYTES = 3;

/**
 * G11 — the widest warm row's memory, reported whether or not it passes.
 *
 * Measured over every state the figure declares rather than over a hand-picked
 * list: the cache does not know one row from another, and a state that grew
 * frames would otherwise be memory nothing accounts for.
 */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of RAT_KIN_FIGURE.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G11', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G11 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarmMegabytes.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G11',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

// ── G12: the state names the runtime asks for ────────────────────────────────

/**
 * G12 — every state name the runtime can reach is a state the figure paints.
 *
 * This is what the old timing-table gate was for, re-expressed: it held the row
 * names and frame counts the runtime expects against the ones baked. Both draw
 * paths now return silently on an unknown state, so a name the wrapper builds
 * by template literal and the figure lacks is an invisible NPC and no log line.
 */
function gateRuntimeStateNames(): void {
  for (const failure of missingStateFailures(
    RAT_KIN_FIGURE,
    RAT_KIN_DRAWN_STATES,
    'the sprite wrapper',
  )) {
    fail('G12', failure);
  }
  for (const failure of missingStateFailures(
    RAT_KIN_FIGURE,
    RAT_KIN_PREWARMED_STATES,
    'the prewarm list',
  )) {
    fail('G12', failure);
  }
  // The other direction too: a row the figure paints that no runtime name
  // reaches is art nobody can ever see, which is what a renamed row leaves
  // behind.
  let statesMeasured = 0;
  for (const [state] of RAT_KIN_FIGURE.states) {
    statesMeasured++;
    if (RAT_KIN_DRAWN_STATES.some((drawn) => drawn === state)) continue;
    fail('G12', `the figure paints "${state}", which the sprite wrapper never asks for`);
  }
  failUnlessMeasured('G12', statesMeasured, 'declared states');
}

// ── G13: the frozen cell geometry ────────────────────────────────────────────

/**
 * G13 — the frozen cell still fits the art that is painted into it.
 *
 * `frameWidth`, `frameHeight`, `tileX` and `tileY` were *measured* by the bake
 * this figure replaces: the widest pose plus padding, rounded up to a quantum.
 * Nothing can measure ink at runtime, so they are frozen — and every other gate
 * computes from them, which makes a wrong one invisible to all of them. This
 * paints every frame again into a canvas large enough not to clip it, measures
 * the extents, re-derives the four numbers by the same rule, and fails when the
 * two part company.
 *
 * The X derivation is symmetric about the painter's origin because the runtime
 * mirrors the profile rows about the *tile's* centre: a cell whose ink sat
 * off-centre would slide him sideways every time he turned round.
 */
/** Clear pixels kept between the furthest ink and the frame edge. */
const FRAME_PADDING = 6;
/** Frame dimensions are rounded up to this so the cell stays tidily aligned. */
const FRAME_SIZE_QUANTUM = 8;
/** Comfortably larger than any cell this figure can need. */
const MEASURE_SIZE = 512;

function roundUpTo(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

function gateCellGeometry(): void {
  const canvas = createCanvas(MEASURE_SIZE, MEASURE_SIZE);
  const ctx = asGameContext(canvas.getContext('2d'));
  const origin = MEASURE_SIZE / 2;

  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  let framesMeasured = 0;

  for (const [state, declared] of RAT_KIN_FIGURE.states) {
    for (let frame = 0; frame < declared.frames; frame++) {
      ctx.clearRect(0, 0, MEASURE_SIZE, MEASURE_SIZE);
      ctx.save();
      // The painter anchors itself at the cell's own origin, so shifting by the
      // difference puts the figure's ground line on the scratch canvas' centre.
      ctx.translate(origin - ORIGIN_X, origin - ORIGIN_Y);
      RAT_KIN_FIGURE.paintFrame(ctx, state, frame);
      ctx.restore();
      const { data } = canvas.getContext('2d').getImageData(0, 0, MEASURE_SIZE, MEASURE_SIZE);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let y = 0; y < MEASURE_SIZE; y++) {
        for (let x = 0; x < MEASURE_SIZE; x++) {
          if (data[(y * MEASURE_SIZE + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) {
            continue;
          }
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (minX === Infinity) {
        fail('G13', `${state}[${frame}] painted nothing to measure a cell from`);
        continue;
      }
      framesMeasured++;
      // `maxX` is the *index* of the last inked pixel, whose right edge is one
      // further out; without the +1 the right and bottom clearances come up a
      // pixel short of the left and top ones.
      left = Math.max(left, origin - minX);
      right = Math.max(right, maxX + 1 - origin);
      up = Math.max(up, origin - minY);
      down = Math.max(down, maxY + 1 - origin);
    }
  }

  failUnlessMeasured('G13', framesMeasured, 'frames with ink to size a cell from');
  if (framesMeasured === 0) return;

  const halfWidth = Math.max(left, right) + FRAME_PADDING;
  const originY = Math.ceil(up + FRAME_PADDING);
  const derived = {
    frameWidth: roundUpTo(halfWidth * 2, FRAME_SIZE_QUANTUM),
    frameHeight: roundUpTo(originY + down + FRAME_PADDING, FRAME_SIZE_QUANTUM),
    tileX: 0,
    tileY: Math.round(originY - TILE_SCALE * GROUND_OFFSET_IN_TILE),
  };
  derived.tileX = derived.frameWidth / 2 - TILE_SCALE / 2;

  console.log(
    `  G13 cell geometry: ${derived.frameWidth}×${derived.frameHeight} at ` +
      `(${derived.tileX}, ${derived.tileY}) re-measured from the painter`,
  );
  const comparisons: ReadonlyArray<readonly [string, number, number]> = [
    ['frameWidth', RAT_KIN_FIGURE.frameWidth, derived.frameWidth],
    ['frameHeight', RAT_KIN_FIGURE.frameHeight, derived.frameHeight],
    ['tileX', RAT_KIN_FIGURE.tileX, derived.tileX],
    ['tileY', RAT_KIN_FIGURE.tileY, derived.tileY],
  ];
  for (const [name, held, value] of comparisons) {
    if (held === value) continue;
    fail('G13', `the figure freezes ${name} ${held} while the painted art needs ${value}`);
  }
  failUnlessMeasured('G13', comparisons.length, 'frozen cell numbers to re-measure');
}

/** Runs every gate and returns one message per failure. */
export function ratKinGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateAnchor();
  gateLoopClosure();
  gateContinuity();
  gateCentroidDrift();
  gateReachHeadroom();
  gateStrideSync(gateFootSlide());
  gateGroundContact();
  gateKneeDirection();
  gateWarmRowSize();
  gateRuntimeStateNames();
  gateCellGeometry();
  return [...failures];
}
