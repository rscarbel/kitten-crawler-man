/**
 * Magnum's art gates.
 *
 * The pose-stream gates measure the rig itself; the pixel gates measure cells
 * painted from the figure exactly the way the runtime cache bakes them, so what
 * is measured is what the game blits.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness, `npm run render:magnum`, or alone with
 * `npm run gates:magnum`.
 */

import { pathToFileURL } from 'node:url';

import type { Canvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  inkBoxOf,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import { DANCE_POLE_HEIGHT_TILES } from '../src/sprites/art/dancePole/dancePole.js';
import {
  LEG_REACH,
  SIDES,
  buildSkeleton,
  footPoints,
  magnumHandCentre,
  magnumScreenPoint,
  pelvisPoint,
  type MagnumView,
  type Side,
  type V3,
} from '../src/sprites/art/magnumArt.js';
import {
  MAGNUM_ACT_FRAMES,
  MAGNUM_AIRBORNE_FRAMES,
  MAGNUM_PHRASES,
  MAGNUM_POLE_OFFSET_TILES,
  magnumBigMoves,
  magnumPoleContacts,
} from '../src/sprites/art/magnumDance.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import {
  MAGNUM_STAGE_CELL,
  MAGNUM_STAGE_FIGURE,
  TILE_SCALE,
  magnumFrameOf,
  magnumOrigin,
  type MagnumFrame,
} from '../src/sprites/art/magnumFigure.js';
import { MAGNUM_PHRASE_FRAMES } from '../src/sprites/magnumTiming.js';
import {
  MAGNUM_STAGE_TOP_ABOVE_TILE_TILES,
  magnumDanceCueAt,
  magnumStageStates,
} from '../src/sprites/magnumSprite.js';
import { MAGNUM_DANCE_FPS } from '../src/sprites/magnumTiming.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const INK_ALPHA = 24;
/**
 * Alpha above which a pixel is the figure rather than the soft ground shadow
 * under it: an anchor gate measured on ordinary ink measures the shadow, which
 * lands on the ground line whether or not the feet do.
 */
const SOLID_ALPHA = 200;
/** Floating-point slack for comparisons of solved positions, in tiles. */
const EPSILON = 1e-6;
/** Decimal places a distance in tiles is reported to: a thousandth is well under a pixel. */
const TILE_DECIMALS = 3;
const MID_FRAME = 0.5;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(id, failure);
}

const FIGURE: FigureDef = MAGNUM_STAGE_FIGURE;
const ORIGIN = magnumOrigin(MAGNUM_STAGE_CELL);

/** The figure, for a state it paints; a state it does not paint fails the gate asking. */
function figureOf(state: string): FigureDef {
  if (!FIGURE.states.has(state)) throw new Error(`magnum paints no state "${state}"`);
  return FIGURE;
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const cellByKey = new Map<string, Canvas>();

function cellOf(state: string, frame: number): Canvas {
  const key = `${state}[${frame}]`;
  const cached = cellByKey.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(figureOf(state), state, frame);
  cellByKey.set(key, cell);
  return cell;
}

function pixelsOf(state: string, frame: number): Uint8ClampedArray {
  const cell = cellOf(state, frame);
  return cell.getContext('2d').getImageData(0, 0, cell.width, cell.height).data;
}

function alphaOf(state: string, frame: number): Uint8ClampedArray {
  const data = pixelsOf(state, frame);
  const alpha = new Uint8ClampedArray(data.length / CHANNELS);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  return alpha;
}

/** Pixels whose ink coverage differs between two frames, of one row or of two rows of one figure. */
function coverageDelta(stateA: string, a: number, stateB: string, b: number): number {
  const alphaA = alphaOf(stateA, a);
  const alphaB = alphaOf(stateB, b);
  let differing = 0;
  for (let i = 0; i < alphaA.length; i++) {
    if (alphaA[i] >= INK_ALPHA !== alphaB[i] >= INK_ALPHA) differing++;
  }
  return differing;
}

function paintedOf(state: string, frame: number): MagnumFrame {
  const painted = magnumFrameOf(state, frame);
  if (painted === null) throw new Error(`magnum paints no state "${state}"`);
  return painted;
}

function framesOf(state: string): number {
  const declared = FIGURE.states.get(state);
  if (declared === undefined) {
    fail('G0', `the figure declares no state "${state}"`);
    return 0;
  }
  return declared.frames;
}

/** One frame of the act, addressed by its place in the whole act. */
interface ActFrame {
  readonly actFrame: number;
  readonly state: string;
  readonly frame: number;
}

function actFrame(actIndex: number): ActFrame {
  const wrapped = ((actIndex % MAGNUM_ACT_FRAMES) + MAGNUM_ACT_FRAMES) % MAGNUM_ACT_FRAMES;
  const phrase = MAGNUM_PHRASES[Math.floor(wrapped / MAGNUM_PHRASE_FRAMES)];
  return { actFrame: wrapped, state: phrase.state, frame: wrapped % MAGNUM_PHRASE_FRAMES };
}

const ACT: readonly ActFrame[] = Array.from({ length: MAGNUM_ACT_FRAMES }, (_unused, i) =>
  actFrame(i),
);

// ── G1: structure ────────────────────────────────────────────────────────────

/** Every cell paints something and nothing paints against a cell edge. */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(FIGURE)) fail('G1', failure);
}

// ── G2: the names the runtime asks for ───────────────────────────────────────

/**
 * The draw path returns silently on a state it does not paint, so a name the
 * figure does not declare is an invisible dancer. Covers the act's phrase
 * list and every cue the act's clock hands the stage over one pass, sampled
 * at the act's own frame rate.
 */
function gateRuntimeStateNames(): void {
  const names = magnumStageStates();
  failUnlessMeasured('G2', names.length, 'reachable state names');
  for (const name of names) {
    if (FIGURE.states.has(name)) continue;
    fail('G2', `the sprite asks for "${name}", which the figure does not paint`);
  }
  let cues = 0;
  // Each frame is sampled at its middle, clear of the rounding at its edges.
  for (let i = 0; i < MAGNUM_ACT_FRAMES; i++) {
    const cue = magnumDanceCueAt((i + MID_FRAME) / MAGNUM_DANCE_FPS);
    cues++;
    const declared = MAGNUM_STAGE_FIGURE.states.get(cue.state)?.frames;
    if (declared === undefined || cue.frame >= declared) {
      fail(
        'G2',
        `the act's clock cues ${cue.state}[${cue.frame}], which the stage figure does not paint`,
      );
    }
    if (cue.actFrame !== i) {
      fail('G2', `the act's clock lands on act frame ${cue.actFrame} where it should be on ${i}`);
    }
  }
  failUnlessMeasured('G2', cues, 'act cues');
}

// ── G3: row lengths agree with the timing module ─────────────────────────────

function gateRowLengths(): void {
  let measured = 0;
  for (const phrase of MAGNUM_PHRASES) {
    measured++;
    if (framesOf(phrase.state) !== MAGNUM_PHRASE_FRAMES) {
      fail(
        'G3',
        `${phrase.state} paints ${framesOf(phrase.state)} frames, not a phrase of ${MAGNUM_PHRASE_FRAMES}`,
      );
    }
  }
  for (const move of magnumBigMoves()) {
    measured++;
    if (move.frame < 0 || move.frame >= MAGNUM_ACT_FRAMES) {
      fail('G3', `the ${move.move} cue lands on act frame ${move.frame}, outside the act`);
    }
  }
  failUnlessMeasured('G3', measured, 'rows');
}

// ── G4: no leg is asked to reach past its length ─────────────────────────────

/**
 * The hip-to-ankle distance each pose asks for, on every frame of every row,
 * against the leg's own length. The IK clamps an over-long demand, so the
 * solved chain always looks legal — this measures the demand, not the answer,
 * and a clamped planted foot is one that hangs off the floor.
 */
function gateLegReach(): void {
  let measured = 0;
  for (const [state, declared] of FIGURE.states) {
    for (let frame = 0; frame < declared.frames; frame++) {
      const pose = paintedOf(state, frame).pose;
      const skel = buildSkeleton(pose);
      for (const side of SIDES) {
        const ankle = footPoints(pose.legs[side]).ankle;
        const hip = skel.hips[side];
        const demand = Math.hypot(ankle.x - hip.x, ankle.y - hip.y, ankle.z - hip.z);
        measured++;
        if (demand > LEG_REACH + EPSILON) {
          fail(
            'G4',
            `${state}[${frame}] asks his ${side} leg to reach ${demand.toFixed(TILE_DECIMALS)} of ${LEG_REACH.toFixed(TILE_DECIMALS)}`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G4', measured, 'legs');
}

// ── G8: loops close, in a band ───────────────────────────────────────────────

/**
 * The act is one loop through every phrase: each step from one phrase into
 * the next, and the wrap from the last phrase into the first, moves about as
 * much as the steps round it — not a jump, and not nothing. A routine that
 * hands off badly, or an act that restarts with a jump, fails here.
 */
const SEAM_MIN_SHARE = 0.35;
/**
 * A phrase boundary inside the act is a step like any other, but the act
 * holds poses (a flex, a look back) and snaps hits, so its own steps range
 * wider than a cycle's: the ceiling is the act's largest ordinary step.
 */
const ACT_SEAM_MAX_SHARE_OF_LARGEST = 1;
/** The steps a phrase boundary is compared with: two before it and two after. */
const ACT_SEAM_REACH = 2;
const ACT_SEAM_NEIGHBOURS: readonly number[] = [-ACT_SEAM_REACH, -1, 1, ACT_SEAM_REACH];

function gateLoopSeams(): void {
  let measured = 0;
  const actSteps = ACT.map((from, i) => {
    const to = ACT[(i + 1) % ACT.length];
    return { from, to, delta: coverageDelta(from.state, from.frame, to.state, to.frame) };
  });
  const inner = actSteps.filter((step) => step.to.frame !== 0).map((step) => step.delta);
  const largest = Math.max(...inner);
  actSteps.forEach((step, i) => {
    if (step.to.frame !== 0) return;
    measured++;
    // A boundary is judged against the slowest of the steps either side of
    // it: the act slows for a held pose and settles after a turn, and a phrase
    // boundary there is rightly a small step. Only one far smaller than even
    // the slowest step round it is a stall.
    const around = ACT_SEAM_NEIGHBOURS.map(
      (offset) => actSteps[(i + offset + actSteps.length) % actSteps.length].delta,
    );
    const local = Math.min(...around);
    const share = local === 0 ? 0 : step.delta / local;
    const label = `${step.from.state}[${step.from.frame}] → ${step.to.state}[0]`;
    if (share < SEAM_MIN_SHARE) {
      fail(
        'G8',
        `${label}: the hand-off step is ${share.toFixed(2)}× the steps either side of it — it holds still`,
      );
    }
    if (step.delta > largest * ACT_SEAM_MAX_SHARE_OF_LARGEST) {
      fail(
        'G8',
        `${label}: the hand-off step changes ${step.delta} pixels, past the act's largest ordinary step of ${largest}`,
      );
    }
  });
  failUnlessMeasured('G8', measured, 'loop seams');
}

// ── G9: every frame is its own picture ───────────────────────────────────────

function gateDistinctFrames(): void {
  const report = distinctFrameFailures(FIGURE, pixelsOf);
  for (const failure of report.failures) fail('G9', failure);
  failUnlessMeasured('G9', report.framesMeasured, 'frames');
}

// ── G10: he stands on the ground line ────────────────────────────────────────

/**
 * Rows of slack either way. The one-pixel silhouette line is ink under the
 * sole, and the near foot is drawn a little nearer the camera — lower on the
 * screen — than the ground line his tile is anchored by.
 */
const GROUND_SLACK_ROWS = 3;

function lowestSolidRow(state: string, frame: number): number {
  const alpha = alphaOf(state, frame);
  const width = figureOf(state).frameWidth;
  let lowest = -1;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] >= SOLID_ALPHA) lowest = Math.max(lowest, Math.floor(i / width));
  }
  return lowest;
}

/**
 * His lowest solid pixel on every frame of the act but the authored airborne
 * ones sits on the ground line the tile promises — measured on solid alpha,
 * so the contact shadow cannot answer for the feet. Which act frames are
 * airborne comes from the act's own list, never from where the pose put the
 * feet: a foot lifted by mistake must fail here, not be excused.
 */
function gateGroundLine(): void {
  let measured = 0;
  const check = (state: string, frame: number): void => {
    const lowest = lowestSolidRow(state, frame);
    measured++;
    if (lowest < 0) {
      fail('G10', `${state}[${frame}] paints nothing solid`);
      return;
    }
    const groundRow = ORIGIN.y;
    if (Math.abs(lowest + 1 - groundRow) > GROUND_SLACK_ROWS) {
      fail(
        'G10',
        `${state}[${frame}]: his soles end on row ${lowest + 1}, the ground line is row ${groundRow}`,
      );
    }
  };
  for (const frame of ACT) {
    if (MAGNUM_AIRBORNE_FRAMES.has(frame.actFrame)) continue;
    check(frame.state, frame.frame);
  }
  failUnlessMeasured('G10', measured, 'frames with a foot down');
}

// ── G11: feet stay on the floor through the act ──────────────────────────────

/**
 * On every frame of the act but the authored airborne ones, at least one foot
 * is flat on the floor: the pose's own planted ball, not the pixels, so a hop
 * hidden by a long sole still fails. And a foot planted on two frames running,
 * in one view, stays where it was on the stage: a planted foot that slides is
 * a moonwalk. A turn swaps the view on one frame and pivots him on his feet,
 * so a step across a view change is not a planted pair.
 */
const PLANTED_LIFT = 1e-4;
/** How far a planted foot may drift between two frames, in stage tiles: well under a pixel at 32 px. */
const PLANTED_DRIFT_TILES = 0.012;

function plantedBallOnStage(painted: MagnumFrame, side: Side): { x: number; y: number } | null {
  const ball = painted.pose.legs[side].ball;
  if (-ball.y > PLANTED_LIFT) return null;
  return magnumScreenPoint(painted.pose, painted.view, ball);
}

function gateFeetGrounded(): void {
  let frames = 0;
  let pairs = 0;
  for (const frame of ACT) {
    const painted = paintedOf(frame.state, frame.frame);
    frames++;
    const planted = SIDES.filter((side) => plantedBallOnStage(painted, side) !== null);
    const airborne = MAGNUM_AIRBORNE_FRAMES.has(frame.actFrame);
    if (planted.length === 0 && !airborne) {
      fail(
        'G11',
        `${frame.state}[${frame.frame}] has both feet off the floor, and it is not an authored airborne frame`,
      );
    }
    if (planted.length > 0 && airborne) {
      fail(
        'G11',
        `${frame.state}[${frame.frame}] is declared airborne but has a foot on the floor`,
      );
    }
    const next = ACT[(frame.actFrame + 1) % ACT.length];
    const after = paintedOf(next.state, next.frame);
    if (after.view !== painted.view || after.pose.mirrored !== painted.pose.mirrored) continue;
    for (const side of SIDES) {
      const now = plantedBallOnStage(painted, side);
      const then = plantedBallOnStage(after, side);
      if (now === null || then === null) continue;
      pairs++;
      const drift = Math.hypot(then.x - now.x, then.y - now.y);
      if (drift > PLANTED_DRIFT_TILES) {
        fail(
          'G11',
          `${frame.state}[${frame.frame}] → ${next.state}[${next.frame}]: his planted ${side} foot slides ` +
            `${drift.toFixed(TILE_DECIMALS)} tiles, past ${PLANTED_DRIFT_TILES}`,
        );
      }
    }
  }
  failUnlessMeasured('G11', frames, 'act frames');
  failUnlessMeasured('G11', pairs, 'planted foot pairs');
}

// ── G16: the body never hops ─────────────────────────────────────────────────

/**
 * How far his hips (the root) and the point between his feet (the ground
 * point) may move between two consecutive frames of the act, in stage tiles.
 * The fastest authored motion is the body wave's hip roll and the strut's
 * travel, about three pixels a frame at the 32 px tile; a hit drawn in one
 * frame, a routine that hands off to a different spot, or an act that wraps
 * somewhere else moves five or more, which on screen is the sprite hopping.
 */
const ROOT_STEP_LIMIT_TILES = 0.115;
const GROUND_STEP_LIMIT_TILES = 0.085;

interface BodyPoints {
  readonly root: { x: number; y: number };
  readonly ground: { x: number; y: number };
}

function bodyPointsOf(frame: ActFrame): BodyPoints {
  const painted = paintedOf(frame.state, frame.frame);
  const skel = buildSkeleton(painted.pose);
  const right = magnumScreenPoint(painted.pose, painted.view, skel.feet.right.ball);
  const left = magnumScreenPoint(painted.pose, painted.view, skel.feet.left.ball);
  return {
    root: magnumScreenPoint(painted.pose, painted.view, skel.pelvis),
    ground: { x: (right.x + left.x) / 2, y: (right.y + left.y) / 2 },
  };
}

/**
 * Between every two consecutive frames of the act — phrase seams, routine
 * hand-offs, view pivots and the wrap from the last frame back to the first
 * included — his hips and his ground point move no further than the act's
 * fastest authored motion. Measured through the frame's own draw transform,
 * so a jump in travel, a view swap that relocates the body or a one-frame
 * hit all count.
 */
function gateNoHops(): void {
  let measured = 0;
  let worstRoot = 0;
  let worstGround = 0;
  const points = ACT.map(bodyPointsOf);
  ACT.forEach((frame, i) => {
    const next = ACT[(i + 1) % ACT.length];
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const root = Math.hypot(b.root.x - a.root.x, b.root.y - a.root.y);
    const ground = Math.hypot(b.ground.x - a.ground.x, b.ground.y - a.ground.y);
    worstRoot = Math.max(worstRoot, root);
    worstGround = Math.max(worstGround, ground);
    measured++;
    const label = `${frame.state}[${frame.frame}] → ${next.state}[${next.frame}]`;
    if (root > ROOT_STEP_LIMIT_TILES) {
      fail(
        'G16',
        `${label}: his hips jump ${root.toFixed(TILE_DECIMALS)} tiles, past ${ROOT_STEP_LIMIT_TILES}`,
      );
    }
    if (ground > GROUND_STEP_LIMIT_TILES) {
      fail(
        'G16',
        `${label}: his ground point jumps ${ground.toFixed(TILE_DECIMALS)} tiles, past ${GROUND_STEP_LIMIT_TILES}`,
      );
    }
  });
  console.log(
    `  G16 largest step: hips ${worstRoot.toFixed(TILE_DECIMALS)} of ${ROOT_STEP_LIMIT_TILES}, ` +
      `ground ${worstGround.toFixed(TILE_DECIMALS)} of ${GROUND_STEP_LIMIT_TILES} tiles`,
  );
  failUnlessMeasured('G16', measured, 'act steps');
}

// ── G12: the hand meets the pole on every authored contact frame ─────────────

/**
 * How far the middle of a gripping fist may sit from the pole's axis, in
 * stage tiles: under a pixel at the tile, so the fist always covers the pole
 * it holds rather than touching its edge.
 */
const GRIP_TOLERANCE_TILES = 0.02;
/** Skin pixels that must be painted round a gripping fist's middle. */
const MIN_GRIP_SKIN_PIXELS = 6;
const GRIP_SEARCH_RADIUS = 3;
/** How far above blue a pixel's red must be to count as skin. */
const SKIN_RED_MARGIN = 60;

function isSkin(data: Uint8ClampedArray, i: number): boolean {
  const red = data[i];
  const green = data[i + 1];
  const blue = data[i + 2];
  return red > green && green > blue && red - blue >= SKIN_RED_MARGIN;
}

/**
 * On every frame the act declares a hand on the pole, that hand's fist is
 * centred on the pole's axis, between the floor and the top of the pole, and
 * a hand is actually painted there — skin, solid, at the cell pixels round the
 * fist's middle. The contacts are authored beside the routines; the routines
 * move the hands. A routine whose hand drifts off the pole on a contact frame,
 * or an arm too short to reach it, fails here.
 */
function gatePoleContact(): void {
  let measured = 0;
  const poleX = MAGNUM_POLE_OFFSET_TILES.x;
  for (const contact of magnumPoleContacts()) {
    for (let index = contact.fromFrame; index <= contact.toFrame; index++) {
      const frame = actFrame(index);
      const painted = paintedOf(frame.state, frame.frame);
      const hand = magnumHandCentre(painted.pose, painted.view, contact.side);
      measured++;
      const label = `${frame.state}[${frame.frame}] (${contact.side} hand)`;
      const off = Math.abs(hand.x - poleX);
      if (off > GRIP_TOLERANCE_TILES) {
        fail(
          'G12',
          `${label}: the fist is ${off.toFixed(TILE_DECIMALS)} tiles off the pole, past ${GRIP_TOLERANCE_TILES}`,
        );
      }
      if (-hand.y < 0 || -hand.y > DANCE_POLE_HEIGHT_TILES) {
        fail(
          'G12',
          `${label}: the fist is ${(-hand.y).toFixed(TILE_DECIMALS)} tiles up, off the pole's length`,
        );
      }
      const cx = Math.round(ORIGIN.x + poleX * TILE_SCALE);
      const cy = Math.round(ORIGIN.y + hand.y * TILE_SCALE);
      const data = pixelsOf(frame.state, frame.frame);
      const width = MAGNUM_STAGE_FIGURE.frameWidth;
      let skin = 0;
      for (let dy = -GRIP_SEARCH_RADIUS; dy <= GRIP_SEARCH_RADIUS; dy++) {
        for (let dx = -GRIP_SEARCH_RADIUS; dx <= GRIP_SEARCH_RADIUS; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= width || y >= MAGNUM_STAGE_FIGURE.frameHeight) continue;
          const i = (y * width + x) * CHANNELS;
          if (data[i + ALPHA_OFFSET] >= SOLID_ALPHA && isSkin(data, i)) skin++;
        }
      }
      if (skin < MIN_GRIP_SKIN_PIXELS) {
        fail(
          'G12',
          `${label}: ${skin} pixels of hand are painted on the pole, under ${MIN_GRIP_SKIN_PIXELS}`,
        );
      }
    }
  }
  failUnlessMeasured('G12', measured, 'pole contact frames');
}

// ── G13: the frozen head clearances still match the art ──────────────────────

/** How far under the frozen clearance the measured top may sit before it is stale. */
const HEAD_CLEARANCE_SLACK_TILES = 0.04;

function topAboveTile(
  figure: FigureDef,
  states: readonly string[],
): { top: number; measured: number } {
  let top = Number.POSITIVE_INFINITY;
  let measured = 0;
  for (const state of states) {
    for (let frame = 0; frame < framesOf(state); frame++) {
      const box = inkBoxOf(figure, state, frame);
      if (box === null) continue;
      measured++;
      top = Math.min(top, box.minY);
    }
  }
  return { top: (figure.tileY - top) / TILE_SCALE, measured };
}

/**
 * `MAGNUM_STAGE_TOP_ABOVE_TILE_TILES` is where a label clears the act.
 * Nothing can measure ink at runtime, so it is frozen; this re-measures the
 * tallest frame and fails when the two part company in either direction.
 */
function gateHeadClearance(): void {
  const frozen = MAGNUM_STAGE_TOP_ABOVE_TILE_TILES;
  const name = 'MAGNUM_STAGE_TOP_ABOVE_TILE_TILES';
  const { top, measured } = topAboveTile(FIGURE, magnumStageStates());
  failUnlessMeasured('G13', measured, `${FIGURE.id} frames`);
  if (measured === 0) return;
  if (top > frozen) {
    fail(
      'G13',
      `${FIGURE.id} reaches ${top.toFixed(TILE_DECIMALS)} tiles above his tile, past the frozen ${name} ${frozen}`,
    );
  }
  if (top < frozen - HEAD_CLEARANCE_SLACK_TILES) {
    fail(
      'G13',
      `${FIGURE.id} tops out ${top.toFixed(TILE_DECIMALS)} tiles above his tile; the frozen ${name} ${frozen} is stale`,
    );
  }
}

// ── G14: warm-row memory ─────────────────────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MEGABYTE_DECIMALS = 2;

function cellBytes(figure: FigureDef): number {
  return figure.frameWidth * figure.frameHeight * BYTES_PER_PIXEL;
}

function megabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_DECIMALS);
}

/**
 * Every row of the act, warm at once, fits the figure's budget: the stage
 * prewarms the whole act when the club is entered and the act plays every
 * phrase within one pass, so all of it is resident together.
 */
function gateWarmRowSize(): void {
  let frames = 0;
  for (const [, declared] of FIGURE.states) frames += declared.frames;
  const bytes = frames * cellBytes(FIGURE);
  const budget = figureByteBudgetFor(FIGURE);
  console.log(
    `  G14 warm set: ${FIGURE.id} holds ${frames} cells, ${megabytes(bytes)} MB of its ${megabytes(budget)} MB budget`,
  );
  failUnlessMeasured('G14', frames, `${FIGURE.id} frames`);
  if (bytes > budget) {
    fail(
      'G14',
      `${FIGURE.id}'s rows come to ${megabytes(bytes)} MB warm, past its ${megabytes(budget)} MB budget`,
    );
  }
}

// ── G15: the trunks cover him ────────────────────────────────────────────────

/**
 * Points on his pelvis that the trunks must cover in each view, in the
 * pelvis's own frame (x his right, y down, z the way his hips face), read
 * off the garment's cut: head-on the crotch and both hips; from behind both
 * cheeks of the seat; edge-on the seat, the underside of the seat, the side
 * strip over the hip and the front panel. The underside point sits just inside
 * the seat, above the leg opening: on the opening's own line a tucked pelvis
 * shows the thigh under it by a pixel of antialiasing.
 */
const GARMENT_SAMPLES: Readonly<Record<MagnumView, readonly V3[]>> = {
  front: [
    { x: 0, y: 0.04, z: 0 },
    { x: 0.1, y: -0.03, z: 0 },
    { x: -0.1, y: -0.03, z: 0 },
  ],
  back: [
    { x: 0.085, y: 0.04, z: -0.1 },
    { x: -0.085, y: 0.04, z: -0.1 },
    { x: 0, y: -0.04, z: -0.1 },
  ],
  side: [
    { x: 0, y: 0.03, z: -0.12 },
    { x: 0, y: -0.04, z: 0 },
    { x: 0, y: -0.04, z: -0.08 },
    { x: 0, y: 0.05, z: -0.1 },
    { x: 0, y: 0.02, z: 0.08 },
  ],
};
/** Cell pixels either side of a sample point that are read with it. */
const GARMENT_SAMPLE_RADIUS = 1;
/**
 * Skin pixels allowed round any one sample: antialiasing where the garment's
 * edge meets bare skin can put a pixel or two of tan in the neighbourhood of a
 * point near the edge; more than that is bare skin inside the garment.
 */
const MAX_SKIN_PIXELS_PER_SAMPLE = 2;
/**
 * A hand resting on his hip, or a forearm swinging past it, is skin over the
 * trunks by design; a sample this close to a forearm or hand, in stage tiles,
 * is the arm's and not the cut's.
 */
const ARM_OVER_GARMENT_TILES = 0.07;

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
/** Trunk pixels the clearest frame of every row must show; under this the garment is a sliver. */
const MIN_SPEEDO_PIXELS = 80;
/** How far above red and green a pixel's blue must be to count as the trunks. */
const SPEEDO_BLUE_MARGIN = 40;

function isSpeedo(data: Uint8ClampedArray, i: number): boolean {
  const blue = data[i + 2];
  return blue - data[i] >= SPEEDO_BLUE_MARGIN && blue - data[i + 1] >= SPEEDO_BLUE_MARGIN;
}

/**
 * On every frame of every row and view the parts of him the garment is for
 * are covered by it: no skin shows at the crotch, hip or seat points of the
 * rig, projected through the frame's own draw transform, and the trunks
 * themselves show at a real size. Clothes stay on through the whole act.
 */
function gateSpeedoCoverage(): void {
  let samplesMeasured = 0;
  for (const [state, declared] of FIGURE.states) {
    let clearest = 0;
    for (let frame = 0; frame < declared.frames; frame++) {
      const painted = paintedOf(state, frame);
      const data = pixelsOf(state, frame);
      const width = FIGURE.frameWidth;
      let speedoPixels = 0;
      for (let i = 0; i < data.length; i += CHANNELS) {
        if (data[i + ALPHA_OFFSET] >= SOLID_ALPHA && isSpeedo(data, i)) speedoPixels++;
      }
      clearest = Math.max(clearest, speedoPixels);
      const skel = buildSkeleton(painted.pose);
      const forearms = SIDES.map((side) => ({
        from: magnumScreenPoint(painted.pose, painted.view, skel.arms[side].mid),
        to: magnumHandCentre(painted.pose, painted.view, side),
      }));
      for (const local of GARMENT_SAMPLES[painted.view]) {
        const at = magnumScreenPoint(painted.pose, painted.view, pelvisPoint(painted.pose, local));
        if (
          forearms.some((arm) => distanceToSegment(at, arm.from, arm.to) < ARM_OVER_GARMENT_TILES)
        ) {
          continue;
        }
        const cx = Math.round(ORIGIN.x + at.x * TILE_SCALE);
        const cy = Math.round(ORIGIN.y + at.y * TILE_SCALE);
        let skin = 0;
        for (let dy = -GARMENT_SAMPLE_RADIUS; dy <= GARMENT_SAMPLE_RADIUS; dy++) {
          for (let dx = -GARMENT_SAMPLE_RADIUS; dx <= GARMENT_SAMPLE_RADIUS; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= width || y >= FIGURE.frameHeight) continue;
            const i = (y * width + x) * CHANNELS;
            if (data[i + ALPHA_OFFSET] >= SOLID_ALPHA && isSkin(data, i)) skin++;
          }
        }
        samplesMeasured++;
        if (skin > MAX_SKIN_PIXELS_PER_SAMPLE) {
          fail(
            'G15',
            `${state}[${frame}]: bare skin where the trunks should be, at pelvis point ` +
              `(${local.x}, ${local.y}, ${local.z}) — ${skin} skin pixels`,
          );
        }
      }
    }
    if (clearest < MIN_SPEEDO_PIXELS) {
      fail(
        'G15',
        `${state}'s clearest frame shows ${clearest} pixels of trunks, under ${MIN_SPEEDO_PIXELS}`,
      );
    }
  }
  failUnlessMeasured('G15', samplesMeasured, 'garment samples');
}

/** Runs every gate and returns one message per failure. */
export function magnumGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateRuntimeStateNames();
  gateRowLengths();
  gateLegReach();
  gateLoopSeams();
  gateDistinctFrames();
  gateGroundLine();
  gateFeetGrounded();
  gatePoleContact();
  gateNoHops();
  gateHeadClearance();
  gateWarmRowSize();
  gateSpeedoCoverage();
  return [...failures];
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  console.log('Gating Magnum…');
  reportFigureGates('magnum', magnumGateFailures());
}
