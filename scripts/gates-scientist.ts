/**
 * Dr. Moult's art gates: the shared structural gate and the standard stance
 * and gait checks every painted biped carries.
 *
 * Pixel gates measure cells baked exactly as the runtime cache bakes them.
 * Pose-stream gates measure the choreography itself and need no pixels.
 * Failures accumulate so one run reports everything; every filtering loop
 * counts what it examined and fails if that is nothing.
 *
 * Run by the review harness, `npm run render:scientist`.
 *
 *   G1  structure: every state paints, nothing touches the cell edge, the cell is not mostly empty
 *   G2  ground: the lowest solid pixel of every standing frame sits on his ground row
 *   G3  loop closure: the seam of every loop is an ordinary step, neither a pop nor a held frame
 *   G4  continuity: no step in a loop is far above that loop's ordinary step
 *   G5  foot slide: a planted foot in profile holds its place on the floor as the sprite travels
 *   G6  reach headroom: no leg with its foot down is clamped straight by the IK
 *   G7  arm phase: at each profile foot contact the same-side arm is back
 *   G8  runtime names: every state the draw call can compose is painted
 *   G9  warm-row size: the widest state fits the cache's per-figure ceiling
 *   G10 distinct frames: no row repeats a picture it has already painted
 *   G11 flight: every run has frames with both feet off the floor; no walk does
 *   G12 head clearance: the frozen head-top constant still wraps his standing ink
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { FACING_VIEWS } from '../src/sprites/facingView.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import {
  buildSkeleton,
  LEG_MAX_REACH,
  SIDES,
  type ScientistPose,
} from '../src/sprites/art/scientistArt.js';
import {
  ORIGIN_Y,
  PX_PER_UNIT,
  SCIENTIST_ACTION_TABLE,
  SCIENTIST_ACTIONS,
  SCIENTIST_FIGURE,
  SCIENTIST_HEAD_TOP_ABOVE_TILE_PX,
  SCIENTIST_VIEWS,
  type ScientistAction,
  scientistPoseAt,
  scientistState,
  scientistStateKey,
  scientistTravelPerFrameCellPx,
  scientistViewOf,
} from '../src/sprites/art/scientistFigure.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Alpha at or above which a pixel is solid figure, not an antialiased edge or a soft shade. */
const SOLID_ALPHA = 200;
/** A channel moving this far counts as a changed pixel; below it is edge shimmer. */
const PERCEPTIBLE_STEP = 12;
const BYTES_PER_PIXEL = 4;
const DECIMALS = 2;
/** Figure units are reported to a thousandth: under a tenth of a cell pixel. */
const UNIT_DECIMALS = 3;

const { frameWidth, frameHeight } = SCIENTIST_FIGURE;
const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(id, failure);
}

const cells = new Map<string, Uint8ClampedArray>();

function cellRgba(state: string, frame: number): Uint8ClampedArray {
  const key = `${state}[${frame}]`;
  const cached = cells.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(SCIENTIST_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  cells.set(key, data);
  return data;
}

function framesOf(state: string): number {
  return SCIENTIST_FIGURE.states.get(state)?.frames ?? 0;
}

function statesOf(action: ScientistAction): string[] {
  return SCIENTIST_VIEWS.map((view) => scientistState(action, view));
}

/** Pixels that changed perceptibly between two cells. */
function changedPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += CHANNELS) {
    for (let c = 0; c < CHANNELS; c++) {
      if (Math.abs(a[i + c] - b[i + c]) >= PERCEPTIBLE_STEP) {
        changed++;
        break;
      }
    }
  }
  return changed;
}

function lowestSolidRow(data: Uint8ClampedArray): number {
  for (let y = frameHeight - 1; y >= 0; y--) {
    for (let x = 0; x < frameWidth; x++) {
      if (data[(y * frameWidth + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA) return y;
    }
  }
  return -1;
}

function highestSolidRow(data: Uint8ClampedArray): number {
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (data[(y * frameWidth + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA) return y;
    }
  }
  return -1;
}

const STANDING: readonly ScientistAction[] = SCIENTIST_ACTIONS.filter(
  (action) => !SCIENTIST_ACTION_TABLE[action].travels,
);
const LOOPING: readonly ScientistAction[] = SCIENTIST_ACTIONS.filter(
  (action) => SCIENTIST_ACTION_TABLE[action].loops,
);

// ── G1 ───────────────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const failure of figureStructuralFailures(SCIENTIST_FIGURE)) fail('G1', failure);
}

// ── G2 ───────────────────────────────────────────────────────────────────────

/**
 * How far his soles may sit from the ground row, in cell pixels. Tight above
 * it — a figure a pixel off the floor reads as floating — looser below,
 * where a rolled shoe's toe legitimately dips a pixel past the line.
 */
const GROUND_ABOVE_TOLERANCE = 1;
const GROUND_BELOW_TOLERANCE = 1;
/**
 * The lowest solid row of a standing frame: the sole sits on the ground row
 * and the silhouette line runs one cell pixel below it.
 */
const SOLE_ROW = ORIGIN_Y + 1;

function gateGround(): void {
  let measured = 0;
  for (const action of STANDING) {
    for (const state of statesOf(action)) {
      for (let frame = 0; frame < framesOf(state); frame++) {
        const lowest = lowestSolidRow(cellRgba(state, frame));
        measured++;
        const offset = lowest - SOLE_ROW;
        if (offset < -GROUND_ABOVE_TOLERANCE || offset > GROUND_BELOW_TOLERANCE) {
          fail(
            'G2',
            `${state}[${frame}] lowest solid row ${lowest} is ${offset} px off the ground row ` +
              `${SOLE_ROW} (allowed −${GROUND_ABOVE_TOLERANCE}…+${GROUND_BELOW_TOLERANCE})`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G2', measured, 'standing frames');
}

// ── G3 / G4 ──────────────────────────────────────────────────────────────────

/** The seam of a loop has to be an ordinary step: not a pop, and not a held frame. */
const SEAM_MIN_SHARE = 0.35;
const SEAM_MAX_SHARE = 1.6;
/** No step of a loop may be this many times its median step. */
const MAX_STEP_SHARE = 2.6;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function gateLoops(): void {
  let measured = 0;
  for (const action of LOOPING) {
    for (const state of statesOf(action)) {
      const frames = framesOf(state);
      const steps: number[] = [];
      for (let frame = 1; frame < frames; frame++) {
        steps.push(changedPixels(cellRgba(state, frame - 1), cellRgba(state, frame)));
      }
      const seam = changedPixels(cellRgba(state, frames - 1), cellRgba(state, 0));
      const ordinary = median(steps);
      if (ordinary <= 0) {
        fail('G3', `${state} has no moving steps at all`);
        continue;
      }
      measured++;
      const share = seam / ordinary;
      if (share < SEAM_MIN_SHARE || share > SEAM_MAX_SHARE) {
        fail(
          'G3',
          `${state} loop seam is ${seam} px against a median step of ${ordinary} ` +
            `(${share.toFixed(DECIMALS)}×, band ${SEAM_MIN_SHARE}–${SEAM_MAX_SHARE})`,
        );
      }
      [...steps, seam].forEach((step, i) => {
        if (step / ordinary <= MAX_STEP_SHARE) return;
        fail(
          'G4',
          `${state} step into frame ${(i + 1) % frames} changes ${step} px, ` +
            `${(step / ordinary).toFixed(DECIMALS)}× its median ${ordinary} (limit ${MAX_STEP_SHARE}×)`,
        );
      });
    }
  }
  failUnlessMeasured('G3', measured, 'loop rows');
}

/**
 * A joint may step at most this many times the row's third-largest joint step.
 * The third-largest, because a snapped limb makes two large steps — out and
 * back — and against its own two it would always pass.
 */
const MAX_JOINT_STEP_SHARE = 2.2;
const JOINT_RANK = 2;

/**
 * G4's joint clause. Counting changed pixels cannot see an arm thrown out for
 * one frame in a row that is already moving a lot; following each wrist,
 * ankle and the head can.
 */
function gateJointSteps(): void {
  let measured = 0;
  for (const action of LOOPING) {
    for (const view of SCIENTIST_VIEWS) {
      const skeletons = poses(action, view).map((pose) => buildSkeleton(pose));
      const jointsOf = (i: number): { x: number; y: number }[] => {
        const skel = skeletons[i];
        return [
          skel.arms.left.end,
          skel.arms.right.end,
          skel.legs.left.end,
          skel.legs.right.end,
          skel.head,
        ];
      };
      const steps: { step: number; frame: number }[] = [];
      for (let frame = 0; frame < skeletons.length; frame++) {
        const before = jointsOf(frame);
        const after = jointsOf((frame + 1) % skeletons.length);
        before.forEach((p, j) => {
          steps.push({ step: Math.hypot(after[j].x - p.x, after[j].y - p.y), frame });
        });
      }
      const ranked = steps.map((s) => s.step).sort((a, b) => b - a);
      const reference = ranked[JOINT_RANK] ?? 0;
      if (reference <= 0) continue;
      measured++;
      for (const { step, frame } of steps) {
        if (step / reference <= MAX_JOINT_STEP_SHARE) continue;
        fail(
          'G4',
          `${scientistState(action, view)} a joint jumps ${step.toFixed(UNIT_DECIMALS)} between frames ${frame} and ` +
            `${(frame + 1) % skeletons.length}, ${(step / reference).toFixed(DECIMALS)}× the row's ` +
            `third-largest joint step (limit ${MAX_JOINT_STEP_SHARE}×)`,
        );
      }
    }
  }
  failUnlessMeasured('G4', measured, 'loop rows with moving joints');
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

function poses(action: ScientistAction, view: 'front' | 'side' | 'back'): ScientistPose[] {
  const frames = SCIENTIST_ACTION_TABLE[action].frames;
  return Array.from({ length: frames }, (_unused, frame) => scientistPoseAt(action, view, frame));
}

/** A planted foot may drift by this much, in cell pixels, against the floor under it. */
const FOOT_SLIDE_TOLERANCE_PX = 0.5;

function gateFootSlide(): void {
  let measured = 0;
  for (const action of SCIENTIST_ACTIONS) {
    if (!SCIENTIST_ACTION_TABLE[action].travels) continue;
    const travel = scientistTravelPerFrameCellPx(action);
    const stream = poses(action, 'side');
    for (const side of SIDES) {
      for (let frame = 1; frame < stream.length; frame++) {
        const before = stream[frame - 1].feet[side];
        const after = stream[frame].feet[side];
        if (!before.planted || !after.planted) continue;
        measured++;
        const drift = (after.ahead - before.ahead) * PX_PER_UNIT + travel;
        if (Math.abs(drift) > FOOT_SLIDE_TOLERANCE_PX) {
          fail(
            'G5',
            `${action}_side ${side} foot slides ${drift.toFixed(DECIMALS)} px on the floor ` +
              `between frames ${frame - 1} and ${frame} (limit ${FOOT_SLIDE_TOLERANCE_PX})`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G5', measured, 'planted foot steps');
}

/** Hip to ankle has to stay this far short of the leg's full reach on a planted leg. */
const REACH_HEADROOM = 0.002;

function gateReach(): void {
  let measured = 0;
  for (const action of SCIENTIST_ACTIONS) {
    for (const view of SCIENTIST_VIEWS) {
      poses(action, view).forEach((pose, frame) => {
        const skel = buildSkeleton(pose);
        for (const side of SIDES) {
          if (!pose.feet[side].planted) continue;
          measured++;
          const leg = skel.legs[side];
          const span = Math.hypot(leg.end.x - leg.root.x, leg.end.y - leg.root.y);
          if (leg.clamped || span > LEG_MAX_REACH - REACH_HEADROOM) {
            fail(
              'G6',
              `${scientistState(action, view)}[${frame}] ${side} leg reaches ${span.toFixed(UNIT_DECIMALS)} ` +
                `of ${LEG_MAX_REACH.toFixed(UNIT_DECIMALS)} with its foot down — the knee locks and he hops`,
            );
          }
        }
      });
    }
  }
  failUnlessMeasured('G6', measured, 'planted legs');
}

function gateArmPhase(): void {
  let measured = 0;
  for (const action of ['walk', 'run'] as const) {
    const stream = poses(action, 'side');
    const contacts: readonly { frame: number; side: 'left' | 'right' }[] = [
      { frame: 0, side: 'right' },
      { frame: stream.length / 2, side: 'left' },
    ];
    for (const { frame, side } of contacts) {
      const pose = stream[frame];
      if (!pose.feet[side].planted) {
        fail(
          'G7',
          `${action}_side[${frame}] should be the ${side} foot's contact, but it is off the floor`,
        );
        continue;
      }
      measured++;
      const skel = buildSkeleton(pose);
      const other = side === 'right' ? 'left' : 'right';
      const sameElbow = skel.arms[side].joint.x;
      const otherElbow = skel.arms[other].joint.x;
      if (sameElbow >= otherElbow) {
        fail(
          'G7',
          `${action}_side[${frame}]: at the ${side} foot's contact the ${side} arm is not back ` +
            `(elbow x ${sameElbow.toFixed(UNIT_DECIMALS)} against ${otherElbow.toFixed(UNIT_DECIMALS)})`,
        );
      }
    }
  }
  failUnlessMeasured('G7', measured, 'foot contacts');
}

function gateRuntimeNames(): void {
  const names = SCIENTIST_ACTIONS.flatMap((action) =>
    FACING_VIEWS.map((view) => scientistState(action, scientistViewOf(view))),
  );
  for (const failure of missingStateFailures(SCIENTIST_FIGURE, names, 'drawScientist')) {
    fail('G8', failure);
  }
  for (const state of SCIENTIST_FIGURE.states.keys()) {
    if (scientistStateKey(state) === undefined) fail('G8', `${state} names no action and view`);
  }
}

function gateWarmRow(): void {
  const budget = figureByteBudgetFor(SCIENTIST_FIGURE);
  let widest = 0;
  let widestState = '';
  for (const [state, def] of SCIENTIST_FIGURE.states) {
    const bytes = def.frames * frameWidth * frameHeight * BYTES_PER_PIXEL;
    if (bytes > widest) {
      widest = bytes;
      widestState = state;
    }
  }
  failUnlessMeasured('G9', widest, 'states');
  if (widest > budget)
    fail('G9', `${widestState} holds ${widest} bytes, over the ${budget} ceiling`);
}

/** The cower holds its flinch trembling between two poses, so its held frames repeat by design. */
function cowerRepeats(state: string, earlier: number, later: number): boolean {
  if (scientistStateKey(state)?.action !== 'cower') return false;
  const frames = SCIENTIST_ACTION_TABLE.cower.frames;
  const holdFrom = Math.ceil(COWER_HOLD_SHARE * (frames - 1));
  return earlier >= holdFrom && (later - earlier) % 2 === 0;
}

/** The share of the cower's row after which it is holding rather than flinching. */
const COWER_HOLD_SHARE = 0.3;

function gateDistinct(): void {
  const report = distinctFrameFailures(SCIENTIST_FIGURE, cellRgba, {
    repeatsOnPurpose: cowerRepeats,
  });
  for (const failure of report.failures) fail('G10', failure);
  failUnlessMeasured('G10', report.framesMeasured, 'frames');
}

function gateFlight(): void {
  let measured = 0;
  for (const action of ['walk', 'run'] as const) {
    for (const view of SCIENTIST_VIEWS) {
      const airborne = poses(action, view).filter((pose) =>
        SIDES.every((side) => !pose.feet[side].planted),
      ).length;
      measured++;
      if (action === 'run' && airborne === 0) {
        fail(
          'G11',
          `${scientistState(action, view)} never leaves the floor — a run with no flight is a walk`,
        );
      }
      if (action === 'walk' && airborne > 0) {
        fail(
          'G11',
          `${scientistState(action, view)} has ${airborne} frames with both feet off the floor`,
        );
      }
    }
  }
  failUnlessMeasured('G11', measured, 'gait rows');
}

/** The constant may overstate his height by up to this much at the 32 px tile, never understate it. */
const HEAD_TOP_SLACK_PX = 2;

function gateHeadTop(): void {
  const toScreen = TILE_SIZE / SCIENTIST_FIGURE.tileScale;
  let highest = Number.POSITIVE_INFINITY;
  let measured = 0;
  for (const state of statesOf('idle')) {
    for (let frame = 0; frame < framesOf(state); frame++) {
      const top = highestSolidRow(cellRgba(state, frame));
      if (top < 0) continue;
      measured++;
      highest = Math.min(highest, top);
    }
  }
  failUnlessMeasured('G12', measured, 'idle frames');
  if (measured === 0) return;
  const abovePx = (SCIENTIST_FIGURE.tileY - highest) * toScreen;
  if (
    abovePx > SCIENTIST_HEAD_TOP_ABOVE_TILE_PX ||
    abovePx < SCIENTIST_HEAD_TOP_ABOVE_TILE_PX - HEAD_TOP_SLACK_PX
  ) {
    fail(
      'G12',
      `his idle ink tops out ${abovePx.toFixed(DECIMALS)} px above his tile at the 32 px tile, ` +
        `but SCIENTIST_HEAD_TOP_ABOVE_TILE_PX is ${SCIENTIST_HEAD_TOP_ABOVE_TILE_PX}`,
    );
  }
}

/** Runs every gate and returns one message per failure. */
export function scientistGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateGround();
  gateLoops();
  gateJointSteps();
  gateFootSlide();
  gateReach();
  gateArmPhase();
  gateRuntimeNames();
  gateWarmRow();
  gateDistinct();
  gateFlight();
  gateHeadTop();
  return [...failures];
}
