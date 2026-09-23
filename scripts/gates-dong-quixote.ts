/**
 * Dong Quixote's art gates.
 *
 * Pose-stream gates measure the rig the painter solves; pixel gates measure
 * cells baked exactly the way the runtime cache bakes them. Failures
 * accumulate so one run reports everything, every gate carries an ID, and a
 * gate whose filtered loop examined nothing fails rather than passing.
 *
 * Run by the review harness (`npm run render:dong-quixote`) and on its own
 * (`npm run gates:dong-quixote`).
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import { asGameContext } from './nodeGameContext.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import { FIGURE_HEIGHT as CARL_FIGURE_HEIGHT } from '../src/sprites/art/carl/proportions.js';
import { HUMAN_SCALE } from '../src/sprites/art/human/figureScale.js';
import {
  ARM_MAX_REACH,
  FIGURE_HEIGHT,
  HEAD_RY,
  LANCE_LENGTH,
  LEG_MAX_REACH,
  type Chain,
  type DongPose,
  type DongView,
  drawDongQuixote,
  type Skeleton,
  type V3,
  buildSkeleton,
  length3,
  sub3,
} from '../src/sprites/art/dongQuixoteArt.js';
import {
  DONG_CHARGE_GROUND_PER_CYCLE,
  DONG_QUIXOTE_FIGURE,
  DONG_ROWS,
  DONG_VIEWS,
  DONG_WALK_GROUND_PER_CYCLE,
  type DongAction,
  ORIGIN_X,
  ORIGIN_Y,
  TILE_SCALE,
  dongPoseAt,
  dongStateName,
} from '../src/sprites/art/dongQuixoteFigure.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import {
  DONG_CHARGE_FRAMES,
  DONG_CHARGE_RECOVER_FRAMES,
  DONG_CHARGE_WINDUP_FRAMES,
  DONG_DEATH_CORPSE_FRAME,
  DONG_DEATH_FAREWELL_FRAME,
  DONG_DEATH_FRAMES,
  DONG_HURT_FRAMES,
  DONG_IDLE_FRAMES,
  DONG_IDLE_FRAME_MS,
  DONG_SALUTE_FRAMES,
  DONG_SALUTE_RAISED_FRAME,
  DONG_THRUST_FRAMES,
  DONG_THRUST_IMPACT_FRAME,
  DONG_WALK_FRAMES,
} from '../src/sprites/dongQuixoteTiming.js';
import {
  DONG_HEAD_TOP_ABOVE_TILE,
  dongQuixoteReachableStates,
} from '../src/sprites/dongQuixoteSprite.js';

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
  const cell = bakeFigureCell(DONG_QUIXOTE_FIGURE, state, frame);
  cellCache.set(key, cell);
  return cell;
}

function pixelsOf(state: string, frame: number): Uint8ClampedArray {
  const cell = cellOf(state, frame);
  return cell.getContext('2d').getImageData(0, 0, cell.width, cell.height).data;
}

function rowOf(action: DongAction): { frames: number; kind: 'loop' | 'oneShot' } {
  const row = DONG_ROWS.get(action);
  if (row === undefined) throw new Error(`no row "${action}"`);
  return row;
}

function framesOf(action: DongAction): number[] {
  return Array.from({ length: rowOf(action).frames }, (_unused, i) => i);
}

function poseOf(action: DongAction, frame: number): DongPose {
  return dongPoseAt(dongStateName(action, 'side'), frame).pose;
}

function skeletonOf(action: DongAction, frame: number): Skeleton {
  return buildSkeleton(poseOf(action, frame));
}

const ACTIONS: readonly DongAction[] = [...DONG_ROWS.keys()];

// ── G1: shared structure ─────────────────────────────────────────────────────

function gateStructure(): void {
  for (const message of figureStructuralFailures(DONG_QUIXOTE_FIGURE)) fail('G1', message);
}

// ── G2: standing on the ground line ──────────────────────────────────────────

/**
 * How far off the ground line his lowest solid pixel may sit on a frame with
 * a foot down, in tiles. The band is asymmetric: from behind, a foot planted a
 * stride ahead draws up the screen by the floor's foreshortened depth, and the
 * outline hangs a little under the sole.
 */
const GROUND_ABOVE_TILES = 0.08;
const GROUND_BELOW_TILES = 0.11;
const GROUND_ABOVE_PX = Math.round(GROUND_ABOVE_TILES * TILE_SCALE);
const GROUND_BELOW_PX = Math.round(GROUND_BELOW_TILES * TILE_SCALE);

/**
 * The lowest solid row of his body, painted without the lance: a butt planted
 * ahead of him draws lower than his feet head-on, and is not his footing.
 */
function lowestSolidRow(action: DongAction, view: DongView, frame: number): number {
  const { data, width } = bodyOnlyCell(action, view, frame);
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
    if (action === 'death') continue;
    for (const frame of framesOf(action)) {
      const pose = poseOf(action, frame);
      if (!pose.leftFoot.planted && !pose.rightFoot.planted) continue;
      for (const view of DONG_VIEWS) {
        const state = dongStateName(action, view);
        const lowest = lowestSolidRow(action, view, frame);
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
    for (const view of DONG_VIEWS) {
      const state = dongStateName(action, view);
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
      if (pose.topple !== null) continue;
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
 * half its span. The two go together: "does the hand reach" alone passes an
 * arm folded to a third of its length with the elbow thrown over the shoulder.
 */
const MIN_ARM_SPAN_SHARE = 0.45;

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

/** How close a gripping off hand must be to the shaft, in tiles: about a pixel at the tile. */
const GRIP_TOLERANCE = 0.035;

function distanceToSegment(p: V3, a: V3, b: V3): { distance: number; along: number } {
  const ab = sub3(b, a);
  const ap = sub3(p, a);
  const lengthSquared = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const along = (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, along));
  const closest = { x: a.x + ab.x * clamped, y: a.y + ab.y * clamped, z: a.z + ab.z * clamped };
  return { distance: length3(sub3(p, closest)), along };
}

/** A left hand drawn gripping is on the shaft, between butt and point. */
function gateOffHandGrip(): void {
  let measured = 0;
  for (const action of ACTIONS) {
    for (const frame of framesOf(action)) {
      const pose = poseOf(action, frame);
      if (pose.leftHand !== 'grip') continue;
      measured++;
      const s = buildSkeleton(pose);
      const { distance, along } = distanceToSegment(s.leftArm.end, s.lanceButt, s.lanceTip);
      if (distance > GRIP_TOLERANCE || along < 0 || along > 1) {
        fail(
          'G6',
          `${action}[${frame}] left hand grips ${distance.toFixed(DECIMALS)} off the shaft ` +
            `(${(along * PERCENT).toFixed(0)}% along it; tolerance ${GRIP_TOLERANCE}) — a fist in mid-air`,
        );
      }
    }
  }
  failUnlessMeasured('G6', measured, 'two-handed grips');
}

// ── G7: the lance is a lance ─────────────────────────────────────────────────

/**
 * Longer than the man carrying it, and carried upright its point clears his
 * helmet. Its length is what tells a lance from a spear at 32 px.
 */
const MIN_LANCE_TO_HEIGHT = 1.1;
const MIN_POINT_CLEARANCE = 0.25;
const HELMET_COMB_HEADS = 1.82;

function gateLanceIdentity(): void {
  const share = LANCE_LENGTH / FIGURE_HEIGHT;
  if (share < MIN_LANCE_TO_HEIGHT) {
    fail(
      'G7',
      `the lance is ${share.toFixed(2)}× his height; under ${MIN_LANCE_TO_HEIGHT}× it reads as a spear`,
    );
  }
  let measured = 0;
  for (const frame of framesOf('idle')) {
    const s = skeletonOf('idle', frame);
    const combTop = -s.headCentre.y + HEAD_RY * HELMET_COMB_HEADS;
    const clearance = -s.lanceTip.y - combTop;
    measured++;
    if (clearance < MIN_POINT_CLEARANCE) {
      fail(
        'G7',
        `idle[${frame}] lance point clears the helmet comb by ${clearance.toFixed(DECIMALS)} tiles ` +
          `(floor ${MIN_POINT_CLEARANCE}); carried upright it must stand above him`,
      );
    }
  }
  failUnlessMeasured('G7', measured, 'idle frames');
}

// ── G8: the thrust lands on its impact frame ─────────────────────────────────

function rightmostSolidColumn(state: string, frame: number): number {
  const data = pixelsOf(state, frame);
  const { width, height } = cellOf(state, frame);
  for (let x = width - 1; x >= 0; x--) {
    for (let y = 0; y < height; y++) {
      if (data[(y * width + x) * RGBA_STRIDE + ALPHA_OFFSET] >= SOLID_ALPHA) return x;
    }
  }
  return -1;
}

/**
 * The point is furthest out on the impact frame, in the rig and in the
 * painted profile, so the kit's damage lands on the frame the jab is drawn.
 */
function gateThrustImpact(): void {
  const frames = framesOf('thrust');
  const reach = frames.map((frame) => skeletonOf('thrust', frame).lanceTip.z);
  const peak = reach.indexOf(Math.max(...reach));
  if (peak !== DONG_THRUST_IMPACT_FRAME) {
    fail(
      'G8',
      `the rig's lance point is furthest out on thrust frame ${peak}, not the impact frame ${DONG_THRUST_IMPACT_FRAME}`,
    );
  }
  const columns = frames.map((frame) =>
    rightmostSolidColumn(dongStateName('thrust', 'side'), frame),
  );
  const drawnPeak = Math.max(...columns);
  if (columns[DONG_THRUST_IMPACT_FRAME] !== drawnPeak) {
    fail(
      'G8',
      `thrust_side reaches column ${drawnPeak} on frame ${columns.indexOf(drawnPeak)} but only ` +
        `${columns[DONG_THRUST_IMPACT_FRAME]} on the impact frame ${DONG_THRUST_IMPACT_FRAME}`,
    );
  }
  if (columns[DONG_THRUST_IMPACT_FRAME] <= columns[DONG_THRUST_IMPACT_FRAME - 1]) {
    fail(
      'G8',
      'thrust_side does not drive out into its impact frame: the point is no further than the frame before',
    );
  }
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
  const gaits: readonly [DongAction, number][] = [
    ['walk', DONG_WALK_GROUND_PER_CYCLE],
    ['charge', DONG_CHARGE_GROUND_PER_CYCLE],
  ];
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
 * At each foot's contact the same-side arm is back and the other forward. His
 * right arm carries the lance, so the free left arm is the one measured: it is
 * forward as the right heel strikes and back as the left one does.
 */
function gateArmPhase(): void {
  const contacts: readonly [number, number][] = [
    [0, 1],
    [DONG_WALK_FRAMES / 2, -1],
  ];
  for (const [frame, sign] of contacts) {
    const s = skeletonOf('walk', frame);
    const handAhead = s.leftArm.end.z - s.leftArm.root.z;
    if (handAhead * sign <= 0) {
      fail(
        'G10',
        `walk[${frame}] left hand is ${handAhead.toFixed(DECIMALS)} ahead of its shoulder; at this contact it must be ` +
          (sign > 0 ? 'forward' : 'back'),
      );
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
 * side, in in-game pixels — stopping at the first gap, so a lance held clear of
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
/** In profile, the deflated paunch pushes at least this much further forward than the pumped belly. */
const MIN_PAUNCH_PX = 2;

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

/** Heights (tiles above the floor) of the bands measured: across his shoulders, between armpit and trapezius. */
const SHOULDER_BAND_LOW = 1.3;
const SHOULDER_BAND_HIGH = 1.45;
const SHOULDER_BAND: readonly [number, number] = [SHOULDER_BAND_LOW, SHOULDER_BAND_HIGH];
/**
 * The lower belly, under the reach of his forearm: higher up, the carried
 * lance's forearm crosses the band on the exhale and the gate measures the arm.
 */
const BELLY_BAND_LOW = 0.94;
const BELLY_BAND_HIGH = 1.0;
const BELLY_BAND: readonly [number, number] = [BELLY_BAND_LOW, BELLY_BAND_HIGH];

function bandRows(band: readonly [number, number]): [number, number] {
  const toRow = (height: number): number =>
    Math.round(((ORIGIN_Y - height * TILE_SCALE) * IN_GAME_TILE) / TILE_SCALE);
  return [toRow(band[1]), toRow(band[0])];
}

/**
 * His signature has to survive the 32 px tile: measured there, head-on the
 * pumped shoulders stand wider than the deflated ones, and in profile the
 * deflated paunch pushes out past the pumped belly. Both are silhouette
 * measures, because a count of changed pixels cannot tell the deflation from
 * the slump and the lance droop that ride along with it.
 */
function gateBreathReads(): void {
  const extremes = breathExtremes();
  if (extremes === null) return;
  const { pumped, deflated } = extremes;
  const front = [inGameCell('idle', pumped), inGameCell('idle', deflated)];
  const [shoulderFrom, shoulderTo] = bandRows(SHOULDER_BAND);
  // His left side, away from the lance, is the viewer's right head-on.
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
  if (deflatedBelly - pumpedBelly < MIN_PAUNCH_PX) {
    fail(
      'G11',
      `in profile at 32 px the deflated belly reaches ${deflatedBelly} px ahead and the pumped one ${pumpedBelly} px; ` +
        `the paunch needs at least ${MIN_PAUNCH_PX} px`,
    );
  }
}

// ── G12: the Meat Shields armband ────────────────────────────────────────────

/**
 * The armband is shaded light to dark round the arm, so it is matched by its
 * orange family rather than by distance to one colour — a strict match finds
 * only the flat middle of the band. The bounds exclude everything else warm
 * on him: skin (too little red over green), the crimson vest and the pennon's
 * red (too dark, or too much red over green), and the gold trim (too little).
 */
const ARMBAND_MIN_RED = 190;
const ARMBAND_MIN_RED_OVER_GREEN = 85;
const ARMBAND_MAX_RED_OVER_GREEN = 150;
/**
 * The armband must be at least this share of the frame's solid ink — a share,
 * so the floor means the same thing whatever size the cell is painted at —
 * and never fewer than a handful of pixels, a patch a player can see at the tile.
 */
const MIN_ARMBAND_SHARE = 0.012;
const MIN_ARMBAND_PIXELS = 8;

function isArmbandOrange(r: number, g: number, b: number): boolean {
  const redOverGreen = r - g;
  return (
    r >= ARMBAND_MIN_RED &&
    redOverGreen >= ARMBAND_MIN_RED_OVER_GREEN &&
    redOverGreen <= ARMBAND_MAX_RED_OVER_GREEN &&
    b < g
  );
}

/** The ally armband is painted, in its own orange, in every view he stands in. */
function gateArmband(): void {
  let measured = 0;
  for (const view of DONG_VIEWS) {
    for (const frame of framesOf('idle')) {
      const state = dongStateName('idle', view);
      const data = pixelsOf(state, frame);
      let count = 0;
      let ink = 0;
      for (let i = 0; i < data.length; i += RGBA_STRIDE) {
        if (data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
        ink++;
        if (isArmbandOrange(data[i], data[i + 1], data[i + 2])) count++;
      }
      measured++;
      const share = ink === 0 ? 0 : count / ink;
      if (share < MIN_ARMBAND_SHARE || count < MIN_ARMBAND_PIXELS) {
        fail(
          'G12',
          `${state}[${frame}] paints ${count} armband-orange pixels, ${(share * PERCENT).toFixed(2)}% of its ink ` +
            `(floors ${(MIN_ARMBAND_SHARE * PERCENT).toFixed(1)}% and ${MIN_ARMBAND_PIXELS} px)`,
        );
      }
    }
  }
  failUnlessMeasured('G12', measured, 'idle cells');
}

// ── G13: the timing table agrees with the figure ─────────────────────────────

function gateTiming(): void {
  const expected: readonly [DongAction, number][] = [
    ['idle', DONG_IDLE_FRAMES],
    ['walk', DONG_WALK_FRAMES],
    ['thrust', DONG_THRUST_FRAMES],
    ['charge_windup', DONG_CHARGE_WINDUP_FRAMES],
    ['charge', DONG_CHARGE_FRAMES],
    ['charge_recover', DONG_CHARGE_RECOVER_FRAMES],
    ['salute', DONG_SALUTE_FRAMES],
    ['hurt', DONG_HURT_FRAMES],
    ['death', DONG_DEATH_FRAMES],
  ];
  for (const [action, frames] of expected) {
    for (const view of DONG_VIEWS) {
      const state = dongStateName(action, view);
      const declared = DONG_QUIXOTE_FIGURE.states.get(state)?.frames;
      if (declared !== frames)
        fail(
          'G13',
          `${state} declares ${declared ?? 'no'} frames; the timing table says ${frames}`,
        );
    }
  }
  if (DONG_IDLE_FRAME_MS.length !== DONG_IDLE_FRAMES) {
    fail(
      'G13',
      `the idle has ${DONG_IDLE_FRAMES} frames but ${DONG_IDLE_FRAME_MS.length} frame holds`,
    );
  }
  // Read off the painted figure rather than the timing constant, so the check is against what is drawn.
  const thrustFrames = DONG_QUIXOTE_FIGURE.states.get(dongStateName('thrust', 'side'))?.frames ?? 0;
  if (DONG_THRUST_IMPACT_FRAME >= thrustFrames) {
    fail(
      'G13',
      `the thrust impact frame ${DONG_THRUST_IMPACT_FRAME} is outside its ${thrustFrames}-frame row`,
    );
  }
}

// ── G14: every name the runtime asks for is painted ──────────────────────────

function gateRuntimeNames(): void {
  for (const message of missingStateFailures(
    DONG_QUIXOTE_FIGURE,
    dongQuixoteReachableStates(),
    'dongQuixoteSprite',
  )) {
    fail('G14', message);
  }
}

// ── G15: every frame is a picture of its own ─────────────────────────────────

function gateDistinctFrames(): void {
  const report = distinctFrameFailures(DONG_QUIXOTE_FIGURE, pixelsOf);
  for (const message of report.failures) fail('G15', message);
  failUnlessMeasured('G15', report.framesMeasured, 'frames');
}

// ── G16: the frozen head-top clearance ───────────────────────────────────────

/** A health bar over him may sit at most this far (a pixel at the tile) above the helmet. */
const HEAD_TOP_SLACK_TILES = 1 / IN_GAME_TILE;

/**
 * A cell of him painted without the lance and its pennon, for the gates that
 * measure his body: the pennon flies across his head, and a planted butt
 * draws lower than his feet.
 */
function bodyOnlyCell(
  action: DongAction,
  view: DongView,
  frame: number,
): { data: Uint8ClampedArray; width: number } {
  const canvas = createCanvas(DONG_QUIXOTE_FIGURE.frameWidth, DONG_QUIXOTE_FIGURE.frameHeight);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  drawDongQuixote(ctx, dongPoseAt(dongStateName(action, view), frame).pose, view, { lance: false });
  return {
    data: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
    width: canvas.width,
  };
}

/**
 * `DONG_HEAD_TOP_ABOVE_TILE` still wraps the top of his helmet on every
 * standing row, and not by more than a pixel at the tile. Measured on him
 * painted without the lance, whose pennon flies across his head.
 */
function gateHeadTop(): void {
  let highest = -Infinity;
  let measured = 0;
  for (const action of ['idle', 'walk', 'hurt'] as const) {
    for (const view of DONG_VIEWS) {
      for (const frame of framesOf(action)) {
        const { data, width } = bodyOnlyCell(action, view, frame);
        for (let y = 0; y < ORIGIN_Y; y++) {
          let hit = false;
          for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * RGBA_STRIDE + ALPHA_OFFSET] >= SOLID_ALPHA) hit = true;
          }
          if (hit) {
            measured++;
            highest = Math.max(highest, (DONG_QUIXOTE_FIGURE.tileY - y) / TILE_SCALE);
            break;
          }
        }
      }
    }
  }
  failUnlessMeasured('G16', measured, 'standing cells');
  if (highest > DONG_HEAD_TOP_ABOVE_TILE) {
    fail(
      'G16',
      `his helmet stands ${highest.toFixed(DECIMALS)} tiles above his tile, over the frozen ${DONG_HEAD_TOP_ABOVE_TILE}`,
    );
  }
  if (DONG_HEAD_TOP_ABOVE_TILE - highest > HEAD_TOP_SLACK_TILES) {
    fail(
      'G16',
      `the frozen ${DONG_HEAD_TOP_ABOVE_TILE} tiles floats ${(DONG_HEAD_TOP_ABOVE_TILE - highest).toFixed(DECIMALS)} ` +
        `over his helmet at ${highest.toFixed(DECIMALS)}; re-measure it`,
    );
  }
}

// ── G17: his warm rows fit the cache ─────────────────────────────────────────

/**
 * Every row the kit can play, in every view, warm at once must leave this
 * share of his per-figure budget free. A fight warms all of them together —
 * the walk and idle from the hire, then every attack, the salute, the hurt
 * and the death as he engages — and the cache admits a row only while there
 * is room for it, so a set that only just fits refuses the next row that
 * asks while an old one is still releasing.
 */
const MAX_WORKING_SET_SHARE = 0.75;
/**
 * The ceiling for one warm row in one view. The golem holds its rows to the
 * same number; it is a runaway stop, not a tight budget.
 */
const ROW_BUDGET_MEGABYTES = 3;

function gateWarmRows(): void {
  const cellBytes =
    DONG_QUIXOTE_FIGURE.frameWidth * DONG_QUIXOTE_FIGURE.frameHeight * BYTES_PER_PIXEL;
  const rowCeiling = ROW_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
  const budget = figureByteBudgetFor(DONG_QUIXOTE_FIGURE);
  let workingSet = 0;
  let rows = 0;
  for (const state of dongQuixoteReachableStates()) {
    const frames = DONG_QUIXOTE_FIGURE.states.get(state)?.frames ?? 0;
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
    `  note dong quixote: every reachable row warm is ${(workingSet / BYTES_PER_MEGABYTE).toFixed(2)} MB, ` +
      `${(share * PERCENT).toFixed(0)}% of his ${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB budget`,
  );
  if (share > MAX_WORKING_SET_SHARE) {
    fail(
      'G17',
      `every row the kit can warm needs ${(workingSet / BYTES_PER_MEGABYTE).toFixed(2)} MB, ` +
        `${(share * PERCENT).toFixed(0)}% of the ${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB per-figure budget ` +
        `(ceiling ${(MAX_WORKING_SET_SHARE * PERCENT).toFixed(0)}%)`,
    );
  }
}

// ── G18: taller than Carl ────────────────────────────────────────────────────

/** He stands at least this much taller than Carl, skull to sole, before the helmet adds anything. */
const MIN_HEIGHT_OVER_CARL = 1.1;

function gateTallerThanCarl(): void {
  const carl = CARL_FIGURE_HEIGHT * HUMAN_SCALE;
  const ratio = FIGURE_HEIGHT / carl;
  if (ratio < MIN_HEIGHT_OVER_CARL) {
    fail(
      'G18',
      `he stands ${ratio.toFixed(2)}× Carl's height (floor ${MIN_HEIGHT_OVER_CARL}×); he is meant to tower over him`,
    );
  }
}

// ── G19: death ends on a corpse ──────────────────────────────────────────────

/**
 * Lying on the floor, no part of his body stands higher than this, in tiles.
 * Head-on he lies on his side, so the width of his shoulders and the arm on
 * top stand up off the floor; standing, he is nearly three times this.
 */
const CORPSE_MAX_HEIGHT_TILES = 0.75;

/**
 * The death row's last frame is the corpse the kit holds while it fades: he
 * lies on the floor, in every view — nothing standing, nothing floating, and
 * no part of him sunk through the floor.
 */
function gateCorpse(): void {
  const lastFrame = rowOf('death').frames - 1;
  if (DONG_DEATH_CORPSE_FRAME !== lastFrame) {
    fail(
      'G19',
      `the corpse frame is ${DONG_DEATH_CORPSE_FRAME}, not the death row's last frame ${lastFrame}`,
    );
  }
  let measured = 0;
  for (const view of DONG_VIEWS) {
    const { data, width } = bodyOnlyCell('death', view, lastFrame);
    const height = data.length / RGBA_STRIDE / width;
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * RGBA_STRIDE + ALPHA_OFFSET] < SOLID_ALPHA) continue;
        if (top < 0) top = y;
        bottom = y;
      }
    }
    measured++;
    const standing = (ORIGIN_Y - top) / TILE_SCALE;
    if (top < 0 || standing > CORPSE_MAX_HEIGHT_TILES) {
      fail(
        'G19',
        `death${view === 'front' ? '' : `_${view}`}[${lastFrame}] stands ${standing.toFixed(DECIMALS)} tiles tall ` +
          `(a corpse lies under ${CORPSE_MAX_HEIGHT_TILES})`,
      );
    }
    if (bottom < ORIGIN_Y - GROUND_ABOVE_PX || bottom > ORIGIN_Y + GROUND_BELOW_PX) {
      fail(
        'G19',
        `death (${view}) corpse's lowest pixel is row ${bottom}, off the ground line ${ORIGIN_Y} ` +
          `(allowed ${ORIGIN_Y - GROUND_ABOVE_PX}..${ORIGIN_Y + GROUND_BELOW_PX})`,
      );
    }
  }
  failUnlessMeasured('G19', measured, 'corpse views');
}

// ── G20: named frames are the frames the poses mark ──────────────────────────

/** Heights within this, in tiles, count as the same height. */
const HEIGHT_EPSILON = 0.005;

/**
 * The frames the timing module names for barks are the frames the art
 * shows them on: the salute's lance fist first reaches its full height on
 * `DONG_SALUTE_RAISED_FRAME`, and the farewell hand is highest on
 * `DONG_DEATH_FAREWELL_FRAME`.
 */
function gateNamedFrames(): void {
  const fistHeights = framesOf('salute').map(
    (frame) => -skeletonOf('salute', frame).rightArm.end.y,
  );
  const top = Math.max(...fistHeights);
  const firstAtTop = fistHeights.findIndex((height) => height >= top - HEIGHT_EPSILON);
  if (firstAtTop !== DONG_SALUTE_RAISED_FRAME) {
    fail(
      'G20',
      `the salute's fist first reaches the top on frame ${firstAtTop}, not DONG_SALUTE_RAISED_FRAME ` +
        `(${DONG_SALUTE_RAISED_FRAME})`,
    );
  }
  const handHeights = framesOf('death').map((frame) => -skeletonOf('death', frame).leftArm.end.y);
  const highest = handHeights.indexOf(Math.max(...handHeights));
  if (highest !== DONG_DEATH_FAREWELL_FRAME) {
    fail(
      'G20',
      `the farewell hand is highest on death frame ${highest}, not DONG_DEATH_FAREWELL_FRAME ` +
        `(${DONG_DEATH_FAREWELL_FRAME})`,
    );
  }
}

export function dongQuixoteGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateGroundLine();
  gateLoopClosure();
  gateLegReach();
  gateArmReach();
  gateOffHandGrip();
  gateLanceIdentity();
  gateThrustImpact();
  gateFootSlide();
  gateArmPhase();
  gateBreathReads();
  gateArmband();
  gateTiming();
  gateRuntimeNames();
  gateDistinctFrames();
  gateHeadTop();
  gateWarmRows();
  gateTallerThanCarl();
  gateCorpse();
  gateNamedFrames();
  return [...failures];
}

if (process.argv[1].endsWith('gates-dong-quixote.ts')) {
  reportFigureGates('dong quixote', dongQuixoteGateFailures());
}
