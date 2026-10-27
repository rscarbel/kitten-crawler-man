/**
 * Brandon's art gates.
 *
 * Pose-stream gates measure the rig the painter solves; pixel gates measure
 * cells baked exactly the way the runtime cache bakes them. Failures
 * accumulate so one run reports everything, every gate carries an ID, and a
 * gate whose filtered loop examined nothing fails rather than passing.
 *
 * Run by the review harness (`npm run render:brandon`) and on its own
 * (`npm run gates:brandon`).
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import {
  ARM_MAX_REACH,
  HEAD_RY,
  LEG_MAX_REACH,
  type Chain,
  type BrandonPose,
  type Skeleton,
  type V3,
  buildSkeleton,
  handOnScreen,
  length3,
  projectedSkeleton,
  sub3,
} from '../src/sprites/art/brandonArt.js';
import {
  BRANDON_ACTIONS,
  BRANDON_FIGURE,
  BRANDON_ROWS,
  BRANDON_VIEWS,
  BRANDON_WALK_GROUND_PER_CYCLE,
  type BrandonAction,
  ORIGIN_X,
  ORIGIN_Y,
  PX_PER_FIGURE_UNIT,
  TILE_SCALE,
  brandonPoseAt,
  brandonStateName,
} from '../src/sprites/art/brandonFigure.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import {
  BRANDON_IDLE_FRAMES,
  BRANDON_IDLE_FRAME_MS,
  BRANDON_SALUTE_FRAMES,
  BRANDON_SALUTE_RAISED_FRAME,
  BRANDON_WALK_FRAMES,
} from '../src/sprites/brandonTiming.js';
import { brandonReachableStates } from '../src/sprites/brandonSprite.js';

const RGBA_STRIDE = 4;
const ALPHA_OFFSET = 3;
/** Solid ink, not the soft contact shadow (which paints at about a third of full alpha). */
const SOLID_ALPHA = 200;
/** Any visible ink. */
const INK_ALPHA = 24;
const IN_GAME_TILE = 32;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const PERCENT = 100;
const DECIMALS = 3;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const message of nothingMeasuredFailures(measured, what)) fail(id, message);
}

const cellCache = new Map<string, Canvas>();

function cellOf(state: string, frame: number): Canvas {
  const key = `${state}#${frame}`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(BRANDON_FIGURE, state, frame);
  cellCache.set(key, cell);
  return cell;
}

function pixelsOf(state: string, frame: number): Uint8ClampedArray {
  const cell = cellOf(state, frame);
  return cell.getContext('2d').getImageData(0, 0, cell.width, cell.height).data;
}

function rowOf(action: BrandonAction): { frames: number; kind: 'loop' | 'oneShot' } {
  return BRANDON_ROWS[action];
}

function framesOf(action: BrandonAction): number[] {
  return Array.from({ length: rowOf(action).frames }, (_unused, i) => i);
}

function poseOf(action: BrandonAction, frame: number): BrandonPose {
  return brandonPoseAt(brandonStateName(action, 'side'), frame).pose;
}

function skeletonOf(action: BrandonAction, frame: number): Skeleton {
  return buildSkeleton(poseOf(action, frame));
}

const ACTIONS: readonly BrandonAction[] = BRANDON_ACTIONS;

// ── G1: shared structure ─────────────────────────────────────────────────────

function gateStructure(): void {
  for (const message of figureStructuralFailures(BRANDON_FIGURE)) fail('G1', message);
}

// ── G2: standing on the ground line ──────────────────────────────────────────

/**
 * How far off the ground line his lowest solid pixel may sit on a frame with
 * a foot down, in figure units. The band is asymmetric: from behind, a foot planted a
 * stride ahead draws up the screen by the floor's foreshortened depth, and the
 * outline hangs a little under the sole.
 */
const GROUND_ABOVE_UNITS = 0.08;
const GROUND_BELOW_UNITS = 0.11;
const GROUND_ABOVE_PX = Math.round(GROUND_ABOVE_UNITS * PX_PER_FIGURE_UNIT);
const GROUND_BELOW_PX = Math.round(GROUND_BELOW_UNITS * PX_PER_FIGURE_UNIT);

/** The lowest solid row of his cell. */
function lowestSolidRow(state: string, frame: number): number {
  const data = pixelsOf(state, frame);
  const { width } = cellOf(state, frame);
  const height = data.length / RGBA_STRIDE / width;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * RGBA_STRIDE + ALPHA_OFFSET] >= SOLID_ALPHA) return y;
    }
  }
  return -1;
}

function gateGroundLine(): void {
  let measured = 0;
  for (const action of ACTIONS) {
    for (const frame of framesOf(action)) {
      const pose = poseOf(action, frame);
      if (!pose.leftFoot.planted && !pose.rightFoot.planted) continue;
      for (const view of BRANDON_VIEWS) {
        const state = brandonStateName(action, view);
        const lowest = lowestSolidRow(state, frame);
        measured++;
        if (lowest < ORIGIN_Y - GROUND_ABOVE_PX || lowest > ORIGIN_Y + GROUND_BELOW_PX) {
          fail(
            'G2',
            `${state}[${frame}] lowest solid pixel is row ${lowest} against the ground line ${ORIGIN_Y} ` +
              `(allowed ${ORIGIN_Y - GROUND_ABOVE_PX}..${ORIGIN_Y + GROUND_BELOW_PX}) with a foot planted`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G2', measured, 'standing frames');
}

// ── G3: loops close ──────────────────────────────────────────────────────────

function frameDelta(state: string, a: number, b: number): number {
  const pa = pixelsOf(state, a);
  const pb = pixelsOf(state, b);
  let changed = 0;
  for (let i = ALPHA_OFFSET; i < pa.length; i += RGBA_STRIDE) {
    if (Math.abs(pa[i] - pb[i]) > INK_ALPHA) changed++;
  }
  return changed;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * A gait's seam must look like any other step: no pop (too large) and no
 * held frame (too small). The breathing idle holds on purpose, so its seam is
 * held only under its own largest step.
 */
const SEAM_MIN_SHARE = 0.45;
const SEAM_MAX_SHARE = 1.6;

function gateLoopClosure(): void {
  let measured = 0;
  for (const action of ACTIONS) {
    if (rowOf(action).kind !== 'loop') continue;
    for (const view of BRANDON_VIEWS) {
      const state = brandonStateName(action, view);
      const frames = rowOf(action).frames;
      const steps = Array.from({ length: frames - 1 }, (_unused, f) => frameDelta(state, f, f + 1));
      const seam = frameDelta(state, frames - 1, 0);
      measured++;
      // A row whose frames do not change has no step to hold the seam to, and
      // the ratio below would be NaN — which compares false both ways and passes.
      if (Math.max(...steps) === 0) {
        fail('G3', `${state} paints the same picture on every frame; there is no motion to close`);
        continue;
      }
      if (action === 'idle') {
        const largest = Math.max(...steps);
        if (seam > largest)
          fail('G3', `${state} seam ${seam} is larger than its largest step ${largest}`);
        continue;
      }
      const typical = median(steps);
      if (typical === 0) {
        fail(
          'G3',
          `${state} holds still on most of its steps (median change 0); a gait never does`,
        );
        continue;
      }
      const share = seam / typical;
      if (share < SEAM_MIN_SHARE || share > SEAM_MAX_SHARE) {
        fail(
          'G3',
          `${state} seam changes ${seam} px against a median step of ${typical} (${share.toFixed(2)}×, ` +
            `band ${SEAM_MIN_SHARE}–${SEAM_MAX_SHARE}×)`,
        );
      }
    }
  }
  failUnlessMeasured('G3', measured, 'loop rows');
}

// ── G4 / G5 / G6: reach ──────────────────────────────────────────────────────

function legOf(s: Skeleton, side: 'left' | 'right'): Chain {
  return side === 'left' ? s.leftLeg : s.rightLeg;
}

/** No planted leg is clamped by the IK: one clamped frame locks the leg and reads as a hop. */
function gateLegReach(): void {
  let measured = 0;
  for (const action of ACTIONS) {
    for (const frame of framesOf(action)) {
      const pose = poseOf(action, frame);
      const s = buildSkeleton(pose);
      for (const side of ['left', 'right'] as const) {
        const foot = side === 'left' ? pose.leftFoot : pose.rightFoot;
        if (!foot.planted) continue;
        measured++;
        const leg = legOf(s, side);
        if (leg.clamped || leg.demand >= LEG_MAX_REACH) {
          fail(
            'G4',
            `${action}[${frame}] ${side} leg asks ${leg.demand.toFixed(DECIMALS)} of a ${LEG_MAX_REACH.toFixed(DECIMALS)} ` +
              'reach with its foot planted — the IK locks it straight',
          );
        }
      }
    }
  }
  failUnlessMeasured('G4', measured, 'planted legs');
}

/**
 * Every arm placed by its hand reaches its target, and none is folded past
 * this share of its span. The two go together: "does the hand reach" alone
 * passes an arm folded shut with the elbow thrown over the shoulder. A hand
 * at his brow or on his stomach folds the arm to about a third of its span,
 * which is as far as any pose may take it.
 */
const MIN_ARM_SPAN_SHARE = 0.32;

function gateArmReach(): void {
  let measured = 0;
  for (const action of ACTIONS) {
    for (const frame of framesOf(action)) {
      const pose = poseOf(action, frame);
      const s = buildSkeleton(pose);
      for (const side of ['left', 'right'] as const) {
        const arm = side === 'left' ? pose.leftArm : pose.rightArm;
        if (arm.kind !== 'reach') continue;
        measured++;
        const chain = side === 'left' ? s.leftArm : s.rightArm;
        if (chain.clamped) {
          fail(
            'G5',
            `${action}[${frame}] ${side} hand is ${chain.demand.toFixed(DECIMALS)} from the shoulder, past the ` +
              `${ARM_MAX_REACH.toFixed(DECIMALS)} the arm spans — the IK leaves it short of where it grips`,
          );
        }
        const span = length3(sub3(chain.end, chain.root)) / ARM_MAX_REACH;
        if (span < MIN_ARM_SPAN_SHARE) {
          fail(
            'G5',
            `${action}[${frame}] ${side} arm is folded to ${span.toFixed(2)} of its span (floor ${MIN_ARM_SPAN_SHARE})`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G5', measured, 'hand-placed arms');
}

// ── G9: planted feet hold the floor ──────────────────────────────────────────

/** The floor under a planted foot, within this, counts as touching it. */
const ON_FLOOR = 0.006;
/** Allowed error in a planted sole's step against the ground the frame covers. */
const SLIDE_TOLERANCE = 0.15;

function soleOnFloor(heel: V3, toe: V3): { heel: boolean; toe: boolean } {
  return { heel: Math.abs(heel.y) < ON_FLOOR, toe: Math.abs(toe.y) < ON_FLOOR };
}

/**
 * A foot in stance slides back through the cell at exactly the ground each
 * frame covers — the sprite carries him forward at that rate, so the foot
 * stays put on the floor. The sole point that is on the floor on both frames
 * is the one measured, since a rolling foot pivots from heel to toe.
 */
function gateFootSlide(): void {
  let measured = 0;
  const gaits: readonly [BrandonAction, number][] = [['walk', BRANDON_WALK_GROUND_PER_CYCLE]];
  for (const [action, perCycle] of gaits) {
    const frames = rowOf(action).frames;
    const expected = -perCycle / frames;
    for (let frame = 0; frame < frames; frame++) {
      const next = (frame + 1) % frames;
      const a = poseOf(action, frame);
      const b = poseOf(action, next);
      const sa = buildSkeleton(a);
      const sb = buildSkeleton(b);
      for (const side of ['left', 'right'] as const) {
        const planted =
          side === 'left'
            ? a.leftFoot.planted && b.leftFoot.planted
            : a.rightFoot.planted && b.rightFoot.planted;
        if (!planted) continue;
        const heelA = side === 'left' ? sa.leftHeel : sa.rightHeel;
        const heelB = side === 'left' ? sb.leftHeel : sb.rightHeel;
        const toeA = side === 'left' ? sa.leftToe : sa.rightToe;
        const toeB = side === 'left' ? sb.leftToe : sb.rightToe;
        const onA = soleOnFloor(heelA, toeA);
        const onB = soleOnFloor(heelB, toeB);
        const step =
          onA.heel && onB.heel ? heelB.z - heelA.z : onA.toe && onB.toe ? toeB.z - toeA.z : null;
        if (step === null) {
          fail(
            'G9',
            `${action}[${frame}→${next}] ${side} foot is planted but no sole point is on the floor on both frames`,
          );
          continue;
        }
        measured++;
        if (Math.abs(step - expected) > Math.abs(expected) * SLIDE_TOLERANCE) {
          fail(
            'G9',
            `${action}[${frame}→${next}] ${side} planted sole moves ${step.toFixed(DECIMALS)} against the ` +
              `${expected.toFixed(DECIMALS)} the frame covers — the foot skates`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G9', measured, 'planted foot steps');
}

// ── G10: arm swings against the legs ─────────────────────────────────────────

/**
 * At each foot's contact the same-side arm is back and the other forward: the
 * left hand is forward as the right heel strikes and back as the left one
 * does, and the right hand the other way round.
 */
function gateArmPhase(): void {
  const contacts: readonly [number, number][] = [
    [0, 1],
    [BRANDON_WALK_FRAMES / 2, -1],
  ];
  for (const [frame, sign] of contacts) {
    const s = skeletonOf('walk', frame);
    const arms = [
      { name: 'left', arm: s.leftArm, armSign: sign },
      { name: 'right', arm: s.rightArm, armSign: -sign },
    ];
    for (const { name, arm, armSign } of arms) {
      const handAhead = arm.end.z - arm.root.z;
      if (handAhead * armSign <= 0) {
        fail(
          'G10',
          `walk[${frame}] ${name} hand is ${handAhead.toFixed(DECIMALS)} ahead of its shoulder; at this contact it must be ` +
            (armSign > 0 ? 'forward' : 'back'),
        );
      }
    }
  }
}

// ── G11: the breath reads at the tile ────────────────────────────────────────

function inGameCell(
  state: string,
  frame: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const cell = cellOf(state, frame);
  const scale = IN_GAME_TILE / TILE_SCALE;
  const width = Math.round(cell.width * scale);
  const height = Math.round(cell.height * scale);
  const small = createCanvas(width, height);
  const ctx = small.getContext('2d');
  ctx.drawImage(cell, 0, 0, cell.width, cell.height, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

/**
 * How far solid ink runs from the figure's centre over a band of rows, on one
 * side, in in-game pixels — stopping at the first gap, so a hand held clear of
 * his body is not counted as his belly.
 */
function extentFromCentre(
  cell: { data: Uint8ClampedArray; width: number },
  rowFrom: number,
  rowTo: number,
  side: 1 | -1,
): number {
  const centre = Math.round((ORIGIN_X * IN_GAME_TILE) / TILE_SCALE);
  let furthest = 0;
  for (let y = rowFrom; y <= rowTo; y++) {
    for (let d = 0; d < cell.width / 2; d++) {
      const x = centre + d * side;
      if (x < 0 || x >= cell.width) break;
      if (cell.data[(y * cell.width + x) * RGBA_STRIDE + ALPHA_OFFSET] < SOLID_ALPHA) break;
      furthest = Math.max(furthest, d);
    }
  }
  return furthest;
}

/** Pumped, his free shoulder stands at least this many in-game pixels further out than deflated. */
const MIN_SHOULDER_SWING_PX = 1;
/**
 * In profile his buttoned waistcoat holds its shape through the breath: the
 * front of it may move by no more than this many in-game pixels.
 */
const MAX_PROFILE_BREATH_PX = 1;

/**
 * The idle's fullest and emptiest breaths, read off the row's own poses so a
 * retimed breath is still measured at its extremes. Fails loudly on a row
 * whose breath never changes.
 */
function breathExtremes(): { pumped: number; deflated: number } | null {
  const breaths = framesOf('idle').map((frame) => poseOf('idle', frame).breath);
  const pumped = breaths.indexOf(Math.max(...breaths));
  const deflated = breaths.indexOf(Math.min(...breaths));
  if (breaths[pumped] === breaths[deflated]) {
    fail('G11', `the idle's breath is ${breaths[pumped]} on every frame; it never deflates`);
    return null;
  }
  return { pumped, deflated };
}

/** Heights (figure units above the floor) of the bands measured: across his shoulders, between armpit and trapezius. */
const SHOULDER_BAND_LOW = 1.3;
const SHOULDER_BAND_HIGH = 1.45;
const SHOULDER_BAND: readonly [number, number] = [SHOULDER_BAND_LOW, SHOULDER_BAND_HIGH];
/**
 * The waistcoat over his belly, under the reach of his forearm: higher up, the
 * hanging right forearm crosses the band and the gate would measure the arm.
 */
const BELLY_BAND_LOW = 0.94;
const BELLY_BAND_HIGH = 1.0;
const BELLY_BAND: readonly [number, number] = [BELLY_BAND_LOW, BELLY_BAND_HIGH];

function bandRows(band: readonly [number, number]): [number, number] {
  const toRow = (height: number): number =>
    Math.round(((ORIGIN_Y - height * PX_PER_FIGURE_UNIT) * IN_GAME_TILE) / TILE_SCALE);
  return [toRow(band[1]), toRow(band[0])];
}

/**
 * His signature has to survive the 32 px tile: measured there, head-on the
 * pumped shoulders stand wider than the deflated ones, while in profile the
 * waistcoat's front holds still, so the breath never reads as a lump pushing
 * out of it. Both are silhouette measures, because a count of changed pixels
 * cannot tell the deflation from the slump that rides along with it.
 */
function gateBreathReads(): void {
  const extremes = breathExtremes();
  if (extremes === null) return;
  const { pumped, deflated } = extremes;
  const front = [inGameCell('idle', pumped), inGameCell('idle', deflated)];
  const [shoulderFrom, shoulderTo] = bandRows(SHOULDER_BAND);
  // His akimbo left side is the viewer's right head-on.
  const pumpedShoulder = extentFromCentre(front[0], shoulderFrom, shoulderTo, 1);
  const deflatedShoulder = extentFromCentre(front[1], shoulderFrom, shoulderTo, 1);
  if (pumpedShoulder - deflatedShoulder < MIN_SHOULDER_SWING_PX) {
    fail(
      'G11',
      `head-on at 32 px the pumped shoulder reaches ${pumpedShoulder} px from centre and the deflated one ` +
        `${deflatedShoulder} px; the breath needs at least ${MIN_SHOULDER_SWING_PX} px between them`,
    );
  }
  const side = [inGameCell('idle_side', pumped), inGameCell('idle_side', deflated)];
  const [bellyFrom, bellyTo] = bandRows(BELLY_BAND);
  const pumpedBelly = extentFromCentre(side[0], bellyFrom, bellyTo, 1);
  const deflatedBelly = extentFromCentre(side[1], bellyFrom, bellyTo, 1);
  if (Math.abs(deflatedBelly - pumpedBelly) > MAX_PROFILE_BREATH_PX) {
    fail(
      'G11',
      `in profile at 32 px the waistcoat's front reaches ${pumpedBelly} px ahead pumped and ${deflatedBelly} px ` +
        `deflated; it may move at most ${MAX_PROFILE_BREATH_PX} px`,
    );
  }
}

// ── G13: the timing table agrees with the figure ─────────────────────────────

function gateTiming(): void {
  const expected: readonly [BrandonAction, number][] = [
    ['idle', BRANDON_IDLE_FRAMES],
    ['walk', BRANDON_WALK_FRAMES],
    ['salute', BRANDON_SALUTE_FRAMES],
  ];
  for (const [action, frames] of expected) {
    for (const view of BRANDON_VIEWS) {
      const state = brandonStateName(action, view);
      const declared = BRANDON_FIGURE.states.get(state)?.frames;
      if (declared !== frames)
        fail(
          'G13',
          `${state} declares ${declared ?? 'no'} frames; the timing table says ${frames}`,
        );
    }
  }
  if (BRANDON_IDLE_FRAME_MS.length !== BRANDON_IDLE_FRAMES) {
    fail(
      'G13',
      `the idle has ${BRANDON_IDLE_FRAMES} frames but ${BRANDON_IDLE_FRAME_MS.length} frame holds`,
    );
  }
}

// ── G14: every name the runtime asks for is painted ──────────────────────────

function gateRuntimeNames(): void {
  for (const message of missingStateFailures(
    BRANDON_FIGURE,
    brandonReachableStates(),
    'brandonSprite',
  )) {
    fail('G14', message);
  }
}

// ── G15: every frame is a picture of its own ─────────────────────────────────

function gateDistinctFrames(): void {
  const report = distinctFrameFailures(BRANDON_FIGURE, pixelsOf);
  for (const message of report.failures) fail('G15', message);
  failUnlessMeasured('G15', report.framesMeasured, 'frames');
}

// ── G17: his warm rows fit the cache ─────────────────────────────────────────

/**
 * Every row he can be drawn in, in every view, warm at once must leave this
 * share of his per-figure budget free. His prewarm warms all of them
 * together, and the cache admits a row only while there is room for it, so a
 * set that only just fits refuses the next row that asks while an old one is
 * still releasing.
 */
const MAX_WORKING_SET_SHARE = 0.75;
/**
 * The ceiling for one warm row in one view. The golem holds its rows to the
 * same number; it is a runaway stop, not a tight budget.
 */
const ROW_BUDGET_MEGABYTES = 3;

function gateWarmRows(): void {
  const cellBytes = BRANDON_FIGURE.frameWidth * BRANDON_FIGURE.frameHeight * BYTES_PER_PIXEL;
  const rowCeiling = ROW_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
  const budget = figureByteBudgetFor(BRANDON_FIGURE);
  let workingSet = 0;
  let rows = 0;
  for (const state of brandonReachableStates()) {
    const frames = BRANDON_FIGURE.states.get(state)?.frames ?? 0;
    const bytes = frames * cellBytes;
    workingSet += bytes;
    rows++;
    if (bytes > rowCeiling) {
      fail(
        'G17',
        `${state} needs ${(bytes / BYTES_PER_MEGABYTE).toFixed(2)} MB warm, over the ` +
          `${ROW_BUDGET_MEGABYTES} MB ceiling for one row`,
      );
    }
  }
  failUnlessMeasured('G17', rows, 'reachable rows');
  const share = workingSet / budget;
  console.log(
    `  note brandon: every reachable row warm is ${(workingSet / BYTES_PER_MEGABYTE).toFixed(2)} MB, ` +
      `${(share * PERCENT).toFixed(0)}% of his ${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB budget`,
  );
  if (share > MAX_WORKING_SET_SHARE) {
    fail(
      'G17',
      `every row he can be drawn in needs ${(workingSet / BYTES_PER_MEGABYTE).toFixed(2)} MB, ` +
        `${(share * PERCENT).toFixed(0)}% of the ${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB per-figure budget ` +
        `(ceiling ${(MAX_WORKING_SET_SHARE * PERCENT).toFixed(0)}%)`,
    );
  }
}

// ── G20: named frames are the frames the poses mark ──────────────────────────

/** Heights within this, in tiles, count as the same height. */
const HEIGHT_EPSILON = 0.005;

/**
 * The frame the timing module names for a greeting line is the frame the art
 * shows it on: the salute's hand first reaches his brow on
 * `BRANDON_SALUTE_RAISED_FRAME`.
 */
function gateNamedFrames(): void {
  const fistHeights = framesOf('salute').map(
    (frame) => -skeletonOf('salute', frame).rightArm.end.y,
  );
  const top = Math.max(...fistHeights);
  const firstAtTop = fistHeights.findIndex((height) => height >= top - HEIGHT_EPSILON);
  if (firstAtTop !== BRANDON_SALUTE_RAISED_FRAME) {
    fail(
      'G20',
      `the salute's hand first reaches his brow on frame ${firstAtTop}, not BRANDON_SALUTE_RAISED_FRAME ` +
        `(${BRANDON_SALUTE_RAISED_FRAME})`,
    );
  }
}

// ── G21: the salute stays on its own side of his face ────────────────────────

/** The hairline head-on, in head radii above the eye line at the head's centre. */
const HAIRLINE_HEADS = 0.62;
/** The outer corner of the eye, in head radii from the head's centre line. */
const EYE_OUTER_HEADS = 0.4;
/**
 * The forearm slopes up and in at least this steeply on screen, and the
 * elbow rises no further than this over the shoulder: a forearm lying flat
 * across the top of his head, under an elbow cocked well above it, frames his
 * crown and reads as a hand on his head. A little rise is allowed, because in
 * profile the forearm needs an elbow lifted a touch to make a diagonal up to
 * the brow rather than lie level across his face.
 */
const MIN_FOREARM_SLOPE_RADIANS = 0.6;
const MAX_ELBOW_RISE = 0.1;

/**
 * Head-on and from behind, the saluting hand lands just above and outside the
 * eye on its own arm's side: the wrist and the fingertips never cross the
 * head's centre line, the fingertips sit between the eye line and the
 * hairline, and the wrist never rises over the hairline. The elbow stays at
 * about shoulder height with the forearm sloping up and in to the brow. A hand
 * reaching over the crown, or lying across the top of the head, reads as
 * scratching it.
 */
function gateSaluteSide(): void {
  let measured = 0;
  for (const frame of framesOf('salute')) {
    const pose = poseOf('salute', frame);
    if (frame < BRANDON_SALUTE_RAISED_FRAME || pose.rightHand !== 'blade') continue;
    for (const view of ['front', 'back'] as const) {
      const { skeleton, at } = projectedSkeleton(pose, view);
      const head = at(skeleton.headCentre);
      const shoulder = at(skeleton.rightArm.root);
      const elbow = at(skeleton.rightArm.joint);
      const wrist = at(skeleton.rightArm.end);
      const { tip } = handOnScreen(wrist, elbow, pose.rightHand);
      const ownSide = Math.sign(shoulder.x - head.x);
      const eyeY = head.y;
      const hairlineY = head.y - HAIRLINE_HEADS * HEAD_RY;
      const state = brandonStateName('salute', view);
      measured++;
      for (const [name, point] of [
        ['wrist', wrist],
        ['fingertips', tip],
      ] as const) {
        if ((point.x - head.x) * ownSide <= 0) {
          fail('G21', `${state}[${frame}] ${name} cross the head's centre line to the far side`);
        }
      }
      if ((tip.x - head.x) * ownSide < EYE_OUTER_HEADS * HEAD_RY) {
        fail('G21', `${state}[${frame}] fingertips land over the eye, not outside it`);
      }
      if (tip.y > eyeY || tip.y < hairlineY) {
        fail(
          'G21',
          `${state}[${frame}] fingertips are at ${tip.y.toFixed(DECIMALS)}, outside the eye line ` +
            `${eyeY.toFixed(DECIMALS)} to the hairline ${hairlineY.toFixed(DECIMALS)}`,
        );
      }
      if (wrist.y < hairlineY) {
        fail('G21', `${state}[${frame}] wrist rises over the hairline`);
      }
      const slope = Math.atan2(elbow.y - wrist.y, Math.abs(elbow.x - wrist.x));
      if (slope < MIN_FOREARM_SLOPE_RADIANS) {
        fail(
          'G21',
          `${state}[${frame}] forearm slopes ${slope.toFixed(2)} rad up to the brow ` +
            `(floor ${MIN_FOREARM_SLOPE_RADIANS}); flatter, it lies across his head`,
        );
      }
      if (shoulder.y - elbow.y > MAX_ELBOW_RISE) {
        fail(
          'G21',
          `${state}[${frame}] elbow rises ${(shoulder.y - elbow.y).toFixed(DECIMALS)} over the shoulder ` +
            `(at most ${MAX_ELBOW_RISE})`,
        );
      }
    }
  }
  failUnlessMeasured('G21', measured, 'salute hold frames');
}

export function brandonGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateGroundLine();
  gateLoopClosure();
  gateLegReach();
  gateArmReach();
  gateFootSlide();
  gateArmPhase();
  gateBreathReads();
  gateTiming();
  gateRuntimeNames();
  gateDistinctFrames();
  gateWarmRows();
  gateNamedFrames();
  gateSaluteSide();
  return [...failures];
}

if (process.argv[1].endsWith('gates-brandon.ts')) {
  reportFigureGates('brandon', brandonGateFailures());
}
