/**
 * Angel's art gates.
 *
 * The pose-stream gates measure the solved choreography; the pixel gates
 * measure cells painted from the figure exactly the way the runtime cache
 * bakes them, so what is measured is what the game blits.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. Every filtering loop hands the count it examined to
 * `nothingMeasuredFailures`, so a filter that matches nothing fails loudly.
 *
 * Run by the review harness, `npm run render:angel`, or alone with
 * `npm run gates:angel`.
 *
 *   G1  every frame keeps its cell (shared structural gate)
 *   G2  the frozen cell extents still fit the measured ink, with a margin but not a waste
 *   G3  every hand-off in the loop — within a routine, between routines and at
 *       the wrap — is a step in band: never a pop, never a held frame
 *   G4  each routine opens exactly on the home pose and closes within a step of it
 *   G5  feet are on the floor on every frame but the authored airborne ones,
 *       and both clear the floor on those
 *   G6  a hand is closed on the pole on its authored contact frames and only
 *       there, its fist on the pole's axis, its arm not folded or overstretched
 *   G7  the fist is painted on the pole on every contact frame: skin, not brass,
 *       at the grip
 *   G8  the authored tables (airborne, contact, big moves) name frames that exist
 *   G9  the painter is deterministic: the same cell painted twice is the same bytes
 *   G10 the routines held warm together fit the figure's cache budget
 *   G11 across the whole loop, the wrap included, her ground point and her
 *       hips move no further between two frames than a step takes her: a
 *       jump to a new spot is a hop
 *   G12 performing through the real cache, once every routine is warm, the
 *       routine about to be drawn is still whole on every frame of three
 *       loops, and no draw is a stand-in. A routine let go between passes
 *       comes back cold, and while the club's other figures hold the frame's
 *       bake allowance a cold cell is drawn as a stand-in — often a frame of
 *       another routine, which puts her somewhere else on the stage
 */

import { pathToFileURL } from 'node:url';

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureCell, paintFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  inkBoxOf,
  nothingMeasuredFailures,
  REFERENCE_WORLD_PIXEL_RATIO,
  reportFigureGates,
  storedRowBytes,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import {
  ANGEL_AIRBORNE_FRAMES,
  ANGEL_BIG_MOVE_FRAMES,
  ANGEL_CELL_ABOVE_GROUND_TILES,
  ANGEL_CELL_BELOW_GROUND_TILES,
  ANGEL_CELL_HALF_WIDTH_TILES,
  ANGEL_CELL_PX_PER_UNIT,
  ANGEL_FIGURE,
  ANGEL_POLE_BASE_IN_CELL,
  ANGEL_POLE_CONTACT,
  ANGEL_ROUTINES,
  ANGEL_ROUTINE_FRAMES,
  ANGEL_SEQUENCE_FRAMES,
  ANGEL_FRAMES_PER_SECOND,
  angelFrameAt,
  angelSequenceAt,
  angelSequenceFrameAtSeconds,
  inSpans,
  type AngelRoutine,
  type FrameSpan,
} from '../src/sprites/art/angelFigure.js';
import { gripCentreOnScreen } from '../src/sprites/art/angel/arms.js';
import { HOME_POSE } from '../src/sprites/art/angel/dance/routines.js';
import {
  drawnSideOf,
  solveDancePose,
  type AngelFrame,
} from '../src/sprites/art/angel/dance/pose.js';
import { POLE_RADIUS, POLE_TOP_Y } from '../src/sprites/art/angel/dance/stage.js';
import {
  FOOT_Y,
  FOREARM_LENGTH,
  HIP_JOINT_Y,
  UPPER_ARM_LENGTH,
} from '../src/sprites/art/angel/proportions.js';
import {
  ARM_MAX_REACH,
  SIDES,
  footClearance,
  length3,
  project,
  sub3,
  type AngelSkeleton,
  type BodySide,
  type V3,
} from '../src/sprites/art/angel/skeleton.js';
import { BRA_COLOR, SKIN_BASE, SKIN_LIT, SKIN_SHADE } from '../src/sprites/art/angel/palette.js';
import {
  beginFigureFrame,
  figureByteBudgetFor,
  figureWorldPixelRatio,
  flushFigureFrameCache,
  isFigureStateWarm,
  onFigureUnbakedDraw,
  setFigureBakeClock,
  setFigureWorldPixelRatio,
} from '../src/sprites/figure/figureFrameCache.js';
import { drawAngelSprite, prewarmAngel } from '../src/sprites/angelSprite.js';
import { WORLD_TICKS_PER_SECOND } from '../src/core/constants';

/** Decimal places for figure-unit measurements in gate messages. */
const FINE_DIGITS = 4;
const COARSE_DIGITS = 3;
const RGBA_STRIDE = 4;
const ALPHA_OFFSET = 3;
const TILE_SCALE = ANGEL_FIGURE.tileScale;

function failUnlessMeasured(
  failures: string[],
  gate: string,
  measured: number,
  what: string,
): void {
  for (const failure of nothingMeasuredFailures(measured, what))
    failures.push(`${gate}: ${failure}`);
}

/* ── Shared measurements ───────────────────────────────────────────────── */

const cells = new Map<string, Canvas>();
function cellOf(routine: AngelRoutine, frame: number): Canvas {
  const key = `${routine}:${frame}`;
  const cached = cells.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(ANGEL_FIGURE, routine, frame);
  cells.set(key, cell);
  return cell;
}

const pixelData = new Map<string, Uint8ClampedArray>();
function pixelsOf(routine: AngelRoutine, frame: number): Uint8ClampedArray {
  const key = `${routine}:${frame}`;
  const cached = pixelData.get(key);
  if (cached !== undefined) return cached;
  const cell = cellOf(routine, frame);
  const data = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height).data;
  pixelData.set(key, data);
  return data;
}

/** A pixel counts as changed past this sum of channel steps; under it is antialiasing shimmer. */
const PERCEPTIBLE_PIXEL_STEP = 36;

/** How many pixels differ perceptibly between two cells: the size of the step between them. */
function stepBetween(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += RGBA_STRIDE) {
    const d =
      Math.abs(a[i] - b[i]) +
      Math.abs(a[i + 1] - b[i + 1]) +
      Math.abs(a[i + 2] - b[i + 2]) +
      Math.abs(a[i + ALPHA_OFFSET] - b[i + ALPHA_OFFSET]);
    if (d > PERCEPTIBLE_PIXEL_STEP) changed++;
  }
  return changed;
}

/* ── G1 ────────────────────────────────────────────────────────────────── */

function gateStructure(): string[] {
  return figureStructuralFailures(ANGEL_FIGURE).map((failure) => `G1: ${failure}`);
}

/* ── G2 ────────────────────────────────────────────────────────────────── */

/** The cell must clear her ink by this much on every side… */
const MIN_EXTENT_MARGIN_PX = 2;
/** …and not by more than this, or every instance pays for empty pixels. */
const MAX_EXTENT_MARGIN_PX = 10;

function gateFrozenExtents(): string[] {
  const failures: string[] = [];
  let left = 0;
  let right = 0;
  let above = 0;
  let below = 0;
  let measured = 0;
  for (const routine of ANGEL_ROUTINES) {
    for (let frame = 0; frame < ANGEL_ROUTINE_FRAMES[routine]; frame++) {
      const box = inkBoxOf(ANGEL_FIGURE, routine, frame);
      if (box === null) continue;
      measured++;
      left = Math.max(left, ANGEL_POLE_BASE_IN_CELL.x - box.minX);
      right = Math.max(right, box.maxX + 1 - ANGEL_POLE_BASE_IN_CELL.x);
      above = Math.max(above, ANGEL_POLE_BASE_IN_CELL.y - box.minY);
      below = Math.max(below, box.maxY + 1 - ANGEL_POLE_BASE_IN_CELL.y);
    }
  }
  failUnlessMeasured(failures, 'G2', measured, 'cells for the frozen extents');
  const check = (what: string, frozenTiles: number, inkPx: number): void => {
    const margin = frozenTiles * TILE_SCALE - inkPx;
    if (margin < MIN_EXTENT_MARGIN_PX || margin > MAX_EXTENT_MARGIN_PX) {
      failures.push(
        `G2: ${what} is frozen at ${frozenTiles} tiles (${(frozenTiles * TILE_SCALE).toFixed(1)} px) ` +
          `but her ink reaches ${inkPx} px: a margin of ${margin.toFixed(1)} px, outside ` +
          `[${MIN_EXTENT_MARGIN_PX}, ${MAX_EXTENT_MARGIN_PX}]; re-measure to ` +
          `${((inkPx + MIN_EXTENT_MARGIN_PX + 1) / TILE_SCALE).toFixed(COARSE_DIGITS)} tiles`,
      );
    }
  };
  check('ANGEL_CELL_HALF_WIDTH_TILES (left)', ANGEL_CELL_HALF_WIDTH_TILES, left);
  check('ANGEL_CELL_HALF_WIDTH_TILES (right)', ANGEL_CELL_HALF_WIDTH_TILES, Math.max(left, right));
  check('ANGEL_CELL_ABOVE_GROUND_TILES', ANGEL_CELL_ABOVE_GROUND_TILES, above);
  check('ANGEL_CELL_BELOW_GROUND_TILES', ANGEL_CELL_BELOW_GROUND_TILES, below);
  return failures;
}

/* ── G3 ────────────────────────────────────────────────────────────────── */

/**
 * A hand-off may be no bigger than this many times the largest ordinary step
 * either side of it. Re-derived from the shipped art: the worst hand-off
 * measured 1.0× its neighbours, and a frame skipped at a hand-off measured
 * over 1.6×.
 */
const SEAM_CEILING_SHARE = 1.5;
/**
 * …and no smaller than this share of the smaller step either side of it: a
 * hand-off that paints the same picture twice holds the dance still for a
 * frame. Measured against the smaller neighbour, because each routine eases
 * into and out of its home pose and those steps are legitimately small.
 */
const SEAM_FLOOR_SHARE = 0.2;
/**
 * Within a routine, a step may be no bigger than this many times the larger of
 * the steps either side of it: a snap is a spike against its own neighbours,
 * whatever the routine's pace. Measured against a routine-wide statistic, the
 * swing's fast frames hid a seven-frame skip in the slow squat. Re-derived from
 * the shipped art: the worst step is 2.13× its neighbours, at a turn from
 * profile to head-on.
 */
const STEP_SPIKE_SHARE = 2.4;
/**
 * A frame out of place — painted from somewhere else in the routine — makes
 * two large steps that are each other's size, so neither is a spike; but going
 * through it is far longer than skipping it. Re-derived from the shipped art:
 * the worst frame is a 2.14× detour, mid-swing, where the turn round the pole
 * genuinely doubles back on screen.
 */
const DETOUR_SHARE = 2.6;
/** A detour counts only when both its steps are this many times the routine's median step; a turnaround at a slow point is legitimately a detour. */
const DETOUR_MIN_LEG_SHARE = 1.2;
/** A spike smaller than the routine's median step is a twitch in a near-hold, not a snap. */
const STEP_SPIKE_FLOOR_PERCENTILE = 0.5;

interface Handoff {
  readonly label: string;
  readonly before: readonly [AngelRoutine, number];
  readonly after: readonly [AngelRoutine, number];
}

/** The two frames the loop plays after and before a hand-off, to compare it with. */
function neighbours(h: Handoff): { previous: number; next: number } {
  const [beforeRoutine, beforeFrame] = h.before;
  const [afterRoutine, afterFrame] = h.after;
  const previous = stepBetween(
    pixelsOf(beforeRoutine, beforeFrame - 1),
    pixelsOf(beforeRoutine, beforeFrame),
  );
  const next = stepBetween(
    pixelsOf(afterRoutine, afterFrame),
    pixelsOf(afterRoutine, afterFrame + 1),
  );
  return { previous, next };
}

function gateSeams(): string[] {
  const failures: string[] = [];
  const handoffs: Handoff[] = ANGEL_ROUTINES.map((routine, i) => {
    const next = ANGEL_ROUTINES[(i + 1) % ANGEL_ROUTINES.length];
    const last = ANGEL_ROUTINE_FRAMES[routine] - 1;
    return { label: `${routine} into ${next}`, before: [routine, last], after: [next, 0] };
  });
  for (const h of handoffs) {
    const seam = stepBetween(pixelsOf(...h.before), pixelsOf(...h.after));
    const { previous, next } = neighbours(h);
    const ceiling = Math.max(previous, next) * SEAM_CEILING_SHARE;
    const floor = Math.min(previous, next) * SEAM_FLOOR_SHARE;
    if (seam > ceiling) {
      failures.push(
        `G3: the hand-off ${h.label} changes ${seam} px, over ${SEAM_CEILING_SHARE}× ` +
          `the larger neighbouring step (${previous} / ${next} px): it pops`,
      );
    }
    if (seam <= floor) {
      failures.push(
        `G3: the hand-off ${h.label} changes ${seam} px, under ${SEAM_FLOOR_SHARE}× ` +
          `the smaller neighbouring step (${previous} / ${next} px): it holds a frame`,
      );
    }
  }
  failUnlessMeasured(failures, 'G3', handoffs.length, 'hand-offs');

  let stepsMeasured = 0;
  let detoursMeasured = 0;
  for (const routine of ANGEL_ROUTINES) {
    const steps: number[] = [];
    for (let frame = 1; frame < ANGEL_ROUTINE_FRAMES[routine]; frame++) {
      steps.push(stepBetween(pixelsOf(routine, frame - 1), pixelsOf(routine, frame)));
    }
    stepsMeasured += steps.length;
    const sorted = [...steps].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * STEP_SPIKE_FLOOR_PERCENTILE)];
    steps.forEach((step, i) => {
      const around = Math.max(steps[i - 1] ?? 0, steps[i + 1] ?? 0);
      if (step > floor && step > around * STEP_SPIKE_SHARE) {
        failures.push(
          `G3: ${routine} ${i}→${i + 1} changes ${step} px, over ${STEP_SPIKE_SHARE}× the ` +
            `larger step either side (${around} px): a snap mid-routine`,
        );
      }
      if (step === 0) failures.push(`G3: ${routine} ${i}→${i + 1} paints the same frame twice`);
    });
    for (let frame = 1; frame < ANGEL_ROUTINE_FRAMES[routine] - 1; frame++) {
      const into = steps[frame - 1];
      const outOf = steps[frame];
      if (Math.min(into, outOf) < floor * DETOUR_MIN_LEG_SHARE) continue;
      detoursMeasured++;
      const skipping = stepBetween(pixelsOf(routine, frame - 1), pixelsOf(routine, frame + 1));
      const detour = (into + outOf) / Math.max(skipping, 1);
      if (detour > DETOUR_SHARE) {
        failures.push(
          `G3: ${routine}[${frame}] is a ${detour.toFixed(2)}× detour (${into} + ${outOf} px ` +
            `through it against ${skipping} px past it), over ${DETOUR_SHARE}×: a frame out of place`,
        );
      }
    }
  }
  failUnlessMeasured(failures, 'G3', stepsMeasured, 'steps within routines');
  failUnlessMeasured(failures, 'G3', detoursMeasured, 'frames large enough to test for a detour');
  return failures;
}

/* ── G4 ────────────────────────────────────────────────────────────────── */

/** A joint this close is the same place. */
const SAME_PLACE = 1e-9;
/** The last frame of a routine is the step into home: within this of it, in figure units. */
const CLOSING_STEP_LIMIT = 0.03;

function jointsOf(s: AngelSkeleton): V3[] {
  return SIDES.flatMap((side) => [
    s.legs[side].hip,
    s.legs[side].knee,
    s.legs[side].ankle,
    s.legs[side].toe,
    s.arms[side].shoulder,
    s.arms[side].elbow,
    s.arms[side].wrist,
    s.arms[side].fingertip,
  ]);
}

function widestJointGap(a: AngelFrame, b: AngelFrame): number {
  const ja = jointsOf(a.skeleton);
  const jb = jointsOf(b.skeleton);
  const rootGap = Math.hypot(a.root.x - b.root.x, a.root.y - b.root.y);
  return Math.max(rootGap, ...ja.map((joint, i) => length3(sub3(joint, jb[i]))));
}

function gateHome(): string[] {
  const failures: string[] = [];
  const home = solveDancePose(HOME_POSE);
  for (const routine of ANGEL_ROUTINES) {
    const opening = angelFrameAt(routine, 0);
    const openingGap = widestJointGap(opening, home);
    if (opening.view !== home.view || openingGap > SAME_PLACE) {
      failures.push(
        `G4: ${routine} opens ${openingGap.toFixed(FINE_DIGITS)} figure units from the home pose ` +
          `(view ${opening.view}); every routine must open exactly on it`,
      );
    }
    const closing = angelFrameAt(routine, ANGEL_ROUTINE_FRAMES[routine] - 1);
    const closingGap = widestJointGap(closing, home);
    if (closing.view !== home.view || closingGap > CLOSING_STEP_LIMIT) {
      failures.push(
        `G4: ${routine} closes ${closingGap.toFixed(FINE_DIGITS)} figure units from the home pose ` +
          `(view ${closing.view}), over ${CLOSING_STEP_LIMIT}: the next routine would pop`,
      );
    }
  }
  return failures;
}

/* ── G5 ────────────────────────────────────────────────────────────────── */

/** A foot this close to the floor is standing on it. */
const ON_FLOOR = 0.004;
/** And no foot ever sinks into the floor more than this. */
const THROUGH_FLOOR = 0.004;
/** On an airborne frame both feet are clear of the floor by at least this: a hop, not a shuffle. */
const AIRBORNE_MIN_CLEARANCE = 0.04;

function gateFeet(): string[] {
  const failures: string[] = [];
  let grounded = 0;
  let airborne = 0;
  for (const routine of ANGEL_ROUTINES) {
    for (let frame = 0; frame < ANGEL_ROUTINE_FRAMES[routine]; frame++) {
      const { skeleton } = angelFrameAt(routine, frame);
      const clearances = SIDES.map((side) => footClearance(skeleton.legs[side]));
      const lowest = Math.min(...clearances);
      if (lowest < -THROUGH_FLOOR) {
        failures.push(
          `G5: ${routine}[${frame}] puts a foot ${(-lowest).toFixed(FINE_DIGITS)} through the floor`,
        );
      }
      if (inSpans(ANGEL_AIRBORNE_FRAMES[routine], frame)) {
        airborne++;
        if (lowest < AIRBORNE_MIN_CLEARANCE) {
          failures.push(
            `G5: ${routine}[${frame}] is an authored airborne frame but a foot is only ` +
              `${lowest.toFixed(FINE_DIGITS)} off the floor, under ${AIRBORNE_MIN_CLEARANCE}`,
          );
        }
        continue;
      }
      grounded++;
      if (lowest > ON_FLOOR) {
        failures.push(
          `G5: ${routine}[${frame}] has both feet off the floor (lowest ${lowest.toFixed(FINE_DIGITS)}) ` +
            'but is not an authored airborne frame',
        );
      }
    }
  }
  failUnlessMeasured(failures, 'G5', grounded, 'grounded frames');
  failUnlessMeasured(failures, 'G5', airborne, 'airborne frames');
  return failures;
}

/* ── G6 and G7 ─────────────────────────────────────────────────────────── */

/** The fist's centre is on the pole's axis to within the pole's own radius. */
const GRIP_AXIS_TOLERANCE = POLE_RADIUS;
/** A grip arm is never folded tighter than this share of its full length, shoulder to wrist. */
const MIN_GRIP_SPAN_SHARE = 0.38;
/** …and never asked to reach past its length: the IK would leave the hand short of the pole. */
const REACH_SLACK = 1e-4;
const HALF = 0.5;

/** Where the pole and a fist are, in figure units across the stage with the pole at 0. */
function gripOnStage(solved: AngelFrame, side: BodySide): { x: number; y: number } {
  const local = gripCentreOnScreen(
    { view: solved.view },
    solved.skeleton.arms[drawnSideOf(solved, side)],
  );
  const flip = solved.flip ? -1 : 1;
  return { x: solved.root.x + flip * local.x, y: solved.root.y + local.y };
}

function gateGrips(): string[] {
  const failures: string[] = [];
  let contacts = 0;
  let free = 0;
  for (const routine of ANGEL_ROUTINES) {
    for (let frame = 0; frame < ANGEL_ROUTINE_FRAMES[routine]; frame++) {
      const solved = angelFrameAt(routine, frame);
      for (const side of SIDES) {
        const arm = solved.skeleton.arms[drawnSideOf(solved, side)];
        const spans: readonly FrameSpan[] = ANGEL_POLE_CONTACT[routine][side];
        const hand = side < 0 ? 'left' : 'right';
        if (!inSpans(spans, frame)) {
          free++;
          if (arm.grip >= HALF) {
            failures.push(
              `G6: ${routine}[${frame}] closes her ${hand} hand off its authored contact frames`,
            );
          }
          continue;
        }
        contacts++;
        if (arm.grip < HALF) {
          failures.push(
            `G6: ${routine}[${frame}] opens her ${hand} hand on an authored contact frame (grip ${arm.grip.toFixed(2)})`,
          );
          continue;
        }
        const at = gripOnStage(solved, side);
        if (Math.abs(at.x) > GRIP_AXIS_TOLERANCE) {
          failures.push(
            `G6: ${routine}[${frame}] her ${hand} fist is ${Math.abs(at.x).toFixed(FINE_DIGITS)} off the ` +
              `pole's axis, over ${GRIP_AXIS_TOLERANCE}: the hand closes on air`,
          );
        }
        if (at.y < POLE_TOP_Y || at.y > FOOT_Y) {
          failures.push(
            `G6: ${routine}[${frame}] her ${hand} fist is at y ${at.y.toFixed(COARSE_DIGITS)}, off the pole's length`,
          );
        }
        const span = length3(sub3(arm.wrist, arm.shoulder));
        if (span < (UPPER_ARM_LENGTH + FOREARM_LENGTH) * MIN_GRIP_SPAN_SHARE) {
          failures.push(
            `G6: ${routine}[${frame}] her ${hand} arm is folded to ${span.toFixed(COARSE_DIGITS)} gripping the pole`,
          );
        }
        if (span > ARM_MAX_REACH + REACH_SLACK) {
          failures.push(`G6: ${routine}[${frame}] her ${hand} arm is stretched past its reach`);
        }
      }
    }
  }
  failUnlessMeasured(failures, 'G6', contacts, 'contact frames');
  failUnlessMeasured(failures, 'G6', free, 'free-hand frames');
  return failures;
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  const BYTE = 0xff;
  const RED_SHIFT = 16;
  const GREEN_SHIFT = 8;
  return [(value >> RED_SHIFT) & BYTE, (value >> GREEN_SHIFT) & BYTE, value & BYTE];
}

function distanceTo(rgb: readonly [number, number, number], hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return Math.hypot(rgb[0] - r, rgb[1] - g, rgb[2] - b);
}

const SKIN_TONES = [SKIN_LIT, SKIN_BASE, SKIN_SHADE];
/**
 * The pole's own brass, read off the cell high up the pole's axis where she
 * never reaches, so the test follows whatever the shared pole painter draws.
 */
const BRASS_SAMPLE_BELOW_TOP = 0.03;

function brassOf(data: Uint8ClampedArray): readonly [number, number, number] {
  const x = ANGEL_POLE_BASE_IN_CELL.x;
  const y = Math.round(
    ANGEL_POLE_BASE_IN_CELL.y +
      (POLE_TOP_Y + BRASS_SAMPLE_BELOW_TOP - FOOT_Y) * ANGEL_CELL_PX_PER_UNIT,
  );
  const i = (y * ANGEL_FIGURE.frameWidth + x) * RGBA_STRIDE;
  return [data[i], data[i + 1], data[i + 2]];
}

function rgbDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
/** The fist must win a majority of the pixels sampled round its centre. */
const FIST_SAMPLE_RADIUS_PX = 1;
const FIST_MAJORITY = 0.5;

function gateFistPainted(): string[] {
  const failures: string[] = [];
  let sampled = 0;
  let hiddenBehindBody = 0;
  for (const routine of ANGEL_ROUTINES) {
    for (let frame = 0; frame < ANGEL_ROUTINE_FRAMES[routine]; frame++) {
      const solved = angelFrameAt(routine, frame);
      for (const side of SIDES) {
        if (!inSpans(ANGEL_POLE_CONTACT[routine][side], frame)) continue;
        // In profile with the pole behind her, the far hand grips it behind
        // her own body: hidden by design, so there is nothing to sample.
        if (solved.view === 'side' && drawnSideOf(solved, side) < 0 && !solved.poleInFront) {
          hiddenBehindBody++;
          continue;
        }
        const at = gripOnStage(solved, side);
        const cx = Math.round(ANGEL_POLE_BASE_IN_CELL.x + at.x * ANGEL_CELL_PX_PER_UNIT);
        const cy = Math.round(ANGEL_POLE_BASE_IN_CELL.y + (at.y - FOOT_Y) * ANGEL_CELL_PX_PER_UNIT);
        const data = pixelsOf(routine, frame);
        const brass = brassOf(data);
        let skin = 0;
        let total = 0;
        for (let dy = -FIST_SAMPLE_RADIUS_PX; dy <= FIST_SAMPLE_RADIUS_PX; dy++) {
          for (let dx = -FIST_SAMPLE_RADIUS_PX; dx <= FIST_SAMPLE_RADIUS_PX; dx++) {
            const i = ((cy + dy) * ANGEL_FIGURE.frameWidth + (cx + dx)) * RGBA_STRIDE;
            if (data[i + ALPHA_OFFSET] === 0) continue;
            const rgb = [data[i], data[i + 1], data[i + 2]] as const;
            const nearestSkin = Math.min(...SKIN_TONES.map((tone) => distanceTo(rgb, tone)));
            const nearestOther = Math.min(rgbDistance(rgb, brass), distanceTo(rgb, BRA_COLOR));
            total++;
            if (nearestSkin < nearestOther) skin++;
          }
        }
        sampled++;
        if (total === 0 || skin / total < FIST_MAJORITY) {
          failures.push(
            `G7: ${routine}[${frame}] her ${side < 0 ? 'left' : 'right'} fist is not painted on ` +
              `the pole: ${skin} of ${total} pixels at (${cx}, ${cy}) read as skin`,
          );
        }
      }
    }
  }
  failUnlessMeasured(failures, 'G7', sampled, 'grip pixels');
  failUnlessMeasured(failures, 'G7', hiddenBehindBody, 'grips hidden behind her body');
  return failures;
}

/* ── G8 ────────────────────────────────────────────────────────────────── */

function gateTables(): string[] {
  const failures: string[] = [];
  for (const routine of ANGEL_ROUTINES) {
    const frames = ANGEL_ROUTINE_FRAMES[routine];
    const inRange = (frame: number): boolean => frame >= 0 && frame < frames;
    const spans = [
      ...ANGEL_AIRBORNE_FRAMES[routine],
      ...ANGEL_POLE_CONTACT[routine][-1],
      ...ANGEL_POLE_CONTACT[routine][1],
    ];
    for (const [from, until] of spans) {
      if (!inRange(from) || until > frames || until <= from) {
        failures.push(
          `G8: ${routine} names the span [${from}, ${until}), outside its ${frames} frames`,
        );
      }
    }
    for (const frame of ANGEL_BIG_MOVE_FRAMES[routine]) {
      if (!inRange(frame))
        failures.push(`G8: ${routine} names big move frame ${frame}, out of range`);
    }
  }
  const [swingApex] = ANGEL_BIG_MOVE_FRAMES.swing_squat;
  if (!inSpans(ANGEL_AIRBORNE_FRAMES.swing_squat, swingApex)) {
    failures.push(`G8: the swing's big move frame ${swingApex} is not one of its airborne frames`);
  }
  return failures;
}

/* ── G9 ────────────────────────────────────────────────────────────────── */

function gateDeterministic(): string[] {
  const failures: string[] = [];
  const probes: ReadonlyArray<readonly [AngelRoutine, number]> = [
    ['pole_walk', ANGEL_ROUTINE_FRAMES.pole_walk / 2],
    ['arch_flip_look', ANGEL_ROUTINE_FRAMES.arch_flip_look / 2],
  ];
  for (const [routine, frame] of probes) {
    // A cell painted between two of the same, to catch state a painter carries from one cell to the next.
    const first = paintFigureCell(ANGEL_FIGURE, routine, frame).toBuffer('raw');
    paintFigureCell(ANGEL_FIGURE, 'swing_squat', 0);
    const second = paintFigureCell(ANGEL_FIGURE, routine, frame).toBuffer('raw');
    if (!first.equals(second)) {
      failures.push(`G9: ${routine}[${frame}] painted twice is not the same bytes`);
    }
  }
  return failures;
}

/* ── G10 ───────────────────────────────────────────────────────────────── */

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;

function gateBudget(): string[] {
  const failures: string[] = [];
  const budget = figureByteBudgetFor(ANGEL_FIGURE);
  let total = 0;
  for (const routine of ANGEL_ROUTINES) {
    try {
      total += storedRowBytes(ANGEL_FIGURE, routine).reduce((sum, bytes) => sum + bytes, 0);
    } catch (error) {
      // The cache refuses a row bigger than the figure's whole budget outright.
      failures.push(`G10: ${routine} could not be held in the cache at all: ${String(error)}`);
      return failures;
    }
  }
  if (total > budget) {
    failures.push(
      `G10: her four routines, held warm together as the loop plays them, store ` +
        `${(total / BYTES_PER_MEGABYTE).toFixed(1)} MB, over her ${(budget / BYTES_PER_MEGABYTE).toFixed(1)} MB budget`,
    );
  }
  return failures;
}

/* ── G11 ───────────────────────────────────────────────────────────────── */

/**
 * The furthest her ground point may move between two frames, in figure
 * units: a little over the most her walk carries her in a frame. Measured on
 * the shipped loop, the worst is 0.053, on the step back from the arch into
 * the fold; the hops this exists for measured 0.093 (the swing's orbit, too
 * fast) and more.
 */
const ROOT_STEP_LIMIT = 0.06;
/**
 * The furthest her hips may move on screen between two frames. Measured on
 * the shipped loop, the worst is 0.07; a planted foot left behind on the
 * walk's first step dropped her hips and snapped them back by 0.105.
 */
const HIPS_STEP_LIMIT = 0.08;

interface PlacedFrame {
  readonly label: string;
  readonly root: { x: number; y: number };
  readonly hips: { x: number; y: number };
}

function placedAt(sequenceFrame: number): PlacedFrame {
  const { routine, frame } = angelSequenceAt(sequenceFrame);
  const solved = angelFrameAt(routine, frame);
  const { pelvis } = solved.skeleton;
  const hips = project(solved.view, { x: pelvis.x, y: pelvis.y + HIP_JOINT_Y, z: pelvis.z });
  const flip = solved.flip ? -1 : 1;
  return {
    label: `${routine}[${frame}]`,
    root: solved.root,
    hips: { x: solved.root.x + flip * hips.x, y: solved.root.y + hips.y },
  };
}

function gateContinuity(): string[] {
  const failures: string[] = [];
  let measured = 0;
  let previous = placedAt(0);
  // One frame past the end of the loop is its first frame again: the wrap.
  for (let i = 1; i <= ANGEL_SEQUENCE_FRAMES; i++) {
    const next = placedAt(i);
    measured++;
    const rootStep = Math.hypot(next.root.x - previous.root.x, next.root.y - previous.root.y);
    const hipsStep = Math.hypot(next.hips.x - previous.hips.x, next.hips.y - previous.hips.y);
    if (rootStep > ROOT_STEP_LIMIT) {
      failures.push(
        `G11: ${previous.label} → ${next.label} moves her ground point ${rootStep.toFixed(FINE_DIGITS)}, ` +
          `over ${ROOT_STEP_LIMIT}: she hops to a new spot`,
      );
    }
    if (hipsStep > HIPS_STEP_LIMIT) {
      failures.push(
        `G11: ${previous.label} → ${next.label} moves her hips ${hipsStep.toFixed(FINE_DIGITS)} on screen, ` +
          `over ${HIPS_STEP_LIMIT}: her body jumps`,
      );
    }
    previous = next;
  }
  failUnlessMeasured(failures, 'G11', measured, 'frame-to-frame steps round the loop');
  return failures;
}

/* ── G12 ───────────────────────────────────────────────────────────────── */

/** The in-game tile she is drawn at, as the club draws her. */
const IN_GAME_TILE_PX = 32;
const PERFORMANCE_CANVAS_TILES = 4;
/**
 * Every bake costs this much on the simulated clock, a little over what one
 * of her cells costs in a browser, so the pacing of the queue — and the count
 * riding on it — is a property of the code, not of the machine.
 */
const SIMULATED_MS_PER_BAKE_CLOCK_READ = 1.5;
/** Long enough for the room-entry prewarm to land every routine at the simulated pace. */
const WARM_UP_SECONDS_LIMIT = 60;
/** Loops played once warm: more than the cache's idle window, so a row it would release is caught. */
const LOOPS_PERFORMED = 3;

function gateResidency(): string[] {
  const failures: string[] = [];
  const previousRatio = figureWorldPixelRatio();
  let simulatedMs = 0;
  let unbakedDraws = 0;
  let counting = false;
  setFigureBakeClock(() => {
    simulatedMs += SIMULATED_MS_PER_BAKE_CLOCK_READ;
    return simulatedMs;
  });
  setFigureWorldPixelRatio(REFERENCE_WORLD_PIXEL_RATIO);
  onFigureUnbakedDraw((def) => {
    if (counting && def.id === ANGEL_FIGURE.id) unbakedDraws++;
  });
  const side = IN_GAME_TILE_PX * PERFORMANCE_CANVAS_TILES;
  const ctx = asGameContext(createCanvas(side, side).getContext('2d'));
  try {
    flushFigureFrameCache();
    prewarmAngel();
    let tick = 0;
    let coldDraws = 0;
    const perform = (): void => {
      beginFigureFrame();
      const seconds = tick / WORLD_TICKS_PER_SECOND;
      const { routine } = angelSequenceAt(angelSequenceFrameAtSeconds(seconds));
      if (counting && !isFigureStateWarm(ANGEL_FIGURE, routine)) coldDraws++;
      drawAngelSprite(
        ctx,
        IN_GAME_TILE_PX,
        IN_GAME_TILE_PX,
        IN_GAME_TILE_PX,
        angelSequenceFrameAtSeconds(seconds),
      );
      tick++;
    };
    const allWarm = (): boolean =>
      ANGEL_ROUTINES.every((routine) => isFigureStateWarm(ANGEL_FIGURE, routine));
    while (!allWarm() && tick < WARM_UP_SECONDS_LIMIT * WORLD_TICKS_PER_SECOND) perform();
    if (!allWarm()) {
      failures.push(
        `G12: her routines were still not all warm after ${WARM_UP_SECONDS_LIMIT}s of performing`,
      );
      return failures;
    }
    counting = true;
    const loopTicks = Math.ceil(
      (ANGEL_SEQUENCE_FRAMES / ANGEL_FRAMES_PER_SECOND) * WORLD_TICKS_PER_SECOND,
    );
    const performedTicks = loopTicks * LOOPS_PERFORMED;
    for (let i = 0; i < performedTicks; i++) perform();
    failUnlessMeasured(failures, 'G12', performedTicks, 'frames performed once warm');
    if (coldDraws > 0) {
      failures.push(
        `G12: performing ${LOOPS_PERFORMED} loops once warm, ${coldDraws} frames drew a routine ` +
          'whose row was no longer whole: a routine was let go between passes and came back cold',
      );
    }
    if (unbakedDraws > 0) {
      failures.push(
        `G12: performing ${LOOPS_PERFORMED} loops once warm, ${unbakedDraws} of her draws were not ` +
          'her own baked cell: a routine was let go and came back cold, drawn from a stand-in',
      );
    }
    return failures;
  } finally {
    counting = false;
    setFigureBakeClock(null);
    setFigureWorldPixelRatio(previousRatio);
    flushFigureFrameCache();
  }
}

/** Every gate's failures, in order. */
export function angelGateFailures(): string[] {
  return [
    ...gateStructure(),
    ...gateFrozenExtents(),
    ...gateSeams(),
    ...gateHome(),
    ...gateFeet(),
    ...gateGrips(),
    ...gateFistPainted(),
    ...gateTables(),
    ...gateDeterministic(),
    ...gateBudget(),
    ...gateContinuity(),
    ...gateResidency(),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log('Angel art gates:');
  reportFigureGates('angel', angelGateFailures());
}
