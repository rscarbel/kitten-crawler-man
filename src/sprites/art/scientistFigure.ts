/**
 * Dr. Moult as a painted figure: his choreography, the row table, the cell
 * geometry, the `FigureDef`, and the one draw call the game makes.
 *
 * Six actions, each painted head-on, in profile (facing +X, mirrored at
 * runtime for −X) and from behind:
 *
 *   idle   — a nervous fidget: wrings his hands, pushes his glasses up,
 *            glances over his shoulder
 *   walk   — short quick steps, elbows bent, hands carried near the chest
 *   run    — a panicked, awkward run: pitched forward, arms flailing, coat
 *            streaming, the knees never quite clearing
 *   talk   — one hand chopping the air, then pointing hard on the emphasis
 *   beckon — a "this way" wave toward himself
 *   cower  — a one-shot flinch into hands up over his face, held trembling
 *
 * The gait is Carl's structure, not his phase or posture: a planted foot
 * slides back through the cell at exactly the rate the sprite is carried over
 * the floor, so walk and run are paced by ground covered
 * ({@link advanceScientistPhase}); the pelvis rides the lower of the planted
 * legs' reach arcs, which drops it at contact; arms are posed by their joints,
 * and the same-side arm is back when a foot lands.
 *
 * Painting lives in `scientistArt.ts`; the gates in `scripts/gates-scientist.ts`
 * run with the review harness, `npm run render:scientist`.
 */

import { TILE_SIZE } from '../../core/constants';
import type { CardinalView, FacingSelection, FacingView } from '../facingView';
import { type FigureDef, figureStates } from '../figure/figureDef';
import { drawFigureCached } from '../figure/figureFrameCache';
import { clamp01, easeInOut, easeOut, hump, lerp, ramp, type Pt } from './carlArt';
import {
  ANKLE_HEIGHT,
  type ArmPose,
  buildSkeleton,
  drawScientistPose,
  type FootPose,
  LEG_MAX_REACH,
  PROFILE_HIP_JOINT_AHEAD,
  pt,
  REST_HEAD_PITCH,
  REST_HIP_BACK,
  REST_NECK,
  restingPose,
  type ScientistPose,
  type Side,
  STANDING_HIP_HEIGHT,
} from './scientistArt';

const TWO_PI = Math.PI * 2;

// ── Actions and views ────────────────────────────────────────────────────────

export const SCIENTIST_ACTIONS = ['idle', 'walk', 'run', 'talk', 'beckon', 'cower'] as const;
/** What the quest has him doing; the figure turns it into a row. */
export type ScientistAction = (typeof SCIENTIST_ACTIONS)[number];

/** The views painted: head-on, profile and from behind. */
export const SCIENTIST_VIEWS: readonly CardinalView[] = ['front', 'side', 'back'];

/**
 * The facing views he has no rows of his own for, and the view each draws
 * instead: a south diagonal in profile, a north one from behind.
 */
const SCIENTIST_VIEW_FALLBACK = {
  frontDiagonal: 'side',
  backDiagonal: 'back',
} as const satisfies Partial<Record<FacingView, CardinalView>>;

export function scientistViewOf(view: FacingView): CardinalView {
  switch (view) {
    case 'front':
    case 'side':
    case 'back':
      return view;
    case 'frontDiagonal':
    case 'backDiagonal':
      return SCIENTIST_VIEW_FALLBACK[view];
  }
}

const VIEW_SUFFIX: Record<CardinalView, string> = { front: '', side: '_side', back: '_away' };

/** The figure state an action is painted in for a view. */
export function scientistState(action: ScientistAction, view: CardinalView): string {
  return `${action}${VIEW_SUFFIX[view]}`;
}

/** Every state an action can draw, across its views: what to prewarm before he does it. */
export function scientistStatesFor(action: ScientistAction): string[] {
  return SCIENTIST_VIEWS.map((view) => scientistState(action, view));
}

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/**
 * How much of a tile one figure unit spans: the same as Carl's, so the two
 * stand on one scale and Moult's extra height is his own, a head over Carl's.
 */
export const SCIENTIST_SCALE = 0.72;
export const PX_PER_UNIT = TILE_SCALE * SCIENTIST_SCALE;
const FRAME_WIDTH = 176;
const FRAME_HEIGHT = 176;
const TILE_X = (FRAME_WIDTH - TILE_SCALE) / 2;
/** The tile sits low in the frame: he stands well over two tiles tall. */
const TILE_Y = 104;
/** His soles sit on the same row of the tile as Carl's, a whole cell row so no mark smears. */
const GROUND_ROW_IN_TILE = 58;
export const ORIGIN_X = TILE_X + TILE_SCALE / 2;
export const ORIGIN_Y = TILE_Y + GROUND_ROW_IN_TILE;

// ── Shared gait pieces ───────────────────────────────────────────────────────

/** A cubic Hermite between two values with the given end slopes, over 0–1. */
function hermite(p0: number, p1: number, m0: number, m1: number, s: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1
  );
}

function wrap(phase: number): number {
  return ((phase % 1) + 1) % 1;
}

/** The sole's heel and toe ground points, relative to the ankle, before pitch. */
const HEEL_BACK = 0.065;
const TOE_AHEAD = 0.2;

/** How far a pitched sole drops its lowest point below the unpitched floor. */
function soleDrop(pitch: number): number {
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  const heelY = -HEEL_BACK * s + ANKLE_HEIGHT * c;
  const toeY = TOE_AHEAD * s + ANKLE_HEIGHT * c;
  return Math.max(heelY, toeY) - ANKLE_HEIGHT;
}

interface GaitSpec {
  readonly frames: number;
  /** The phase the foot leaves the floor: the last frame it is down. */
  readonly toeOff: number;
  /** The ankle's lead at contact and its trail at push-off, relative to the hip. */
  readonly contact: number;
  readonly pushOff: number;
  readonly lift: number;
  /** Where in the swing the foot is highest, as a share of the swing. */
  readonly liftPeak: number;
  readonly strikePitch: number;
  readonly pushPitch: number;
  /** The share of the leg's full reach the hip may ask for, so no frame locks a knee. */
  readonly reachShare: number;
  readonly hipBack: number;
}

/**
 * The walk: ten of sixteen frames down per foot, so both feet are down for a
 * frame either side of each contact. The steps are short — a little over
 * half a foot's length ahead and behind — which at his walking speed is a
 * cadence well above Carl's.
 */
const WALK: GaitSpec = {
  frames: 16,
  toeOff: 9 / 16,
  contact: 0.29,
  pushOff: -0.34,
  lift: 0.075,
  liftPeak: 0.4,
  strikePitch: -0.22,
  pushPitch: 0.42,
  reachShare: 0.985,
  hipBack: -0.05,
};

/**
 * The run: six of sixteen frames down per foot, so a quarter of each step is
 * flight — a short one, an old man's — and the swing foot barely leaves the
 * floor, which is the "knees not quite clearing".
 */
const RUN: GaitSpec = {
  frames: 16,
  toeOff: 5 / 16,
  contact: 0.32,
  pushOff: -0.4,
  lift: 0.13,
  liftPeak: 0.45,
  strikePitch: -0.12,
  pushPitch: 0.55,
  reachShare: 0.95,
  hipBack: 0.04,
};

/** Ground a cycle covers, in figure units: the planted foot's whole travel, scaled to a full cycle. */
function groundPerCycle(gait: GaitSpec): number {
  return (gait.contact - gait.pushOff) / gait.toeOff;
}

/** One foot of a gait at `phase` (0 is its own contact), its x relative to the hip. */
function gaitFoot(gait: GaitSpec, rawPhase: number): FootPose {
  const phase = wrap(rawPhase);
  const ground = groundPerCycle(gait);
  if (phase <= gait.toeOff) {
    const u = phase / gait.toeOff;
    const pitch =
      u < STANCE_FLAT_AT
        ? lerp(gait.strikePitch, 0, easeOut(u / STANCE_FLAT_AT))
        : u < STANCE_HEEL_OFF_AT
          ? 0
          : lerp(0, gait.pushPitch, easeInOut((u - STANCE_HEEL_OFF_AT) / (1 - STANCE_HEEL_OFF_AT)));
    return {
      ahead: gait.contact - ground * phase,
      height: ANKLE_HEIGHT + soleDrop(pitch),
      pitch,
      planted: true,
    };
  }
  const swing = 1 - gait.toeOff;
  const s = (phase - gait.toeOff) / swing;
  const slope = -ground * swing * SWING_CARRY;
  const ahead = hermite(gait.pushOff, gait.contact, slope, slope, s);
  const liftShape =
    s < gait.liftPeak ? s / gait.liftPeak : 1 - (s - gait.liftPeak) / (1 - gait.liftPeak);
  const pitch = lerp(gait.pushPitch, gait.strikePitch, easeInOut(s));
  return {
    ahead,
    height: ANKLE_HEIGHT + soleDrop(pitch) * (1 - s) + gait.lift * easeInOut(clamp01(liftShape)),
    pitch,
    planted: false,
  };
}

/** Where the rolling foot flattens and where its heel comes up, as shares of the stance. */
const STANCE_FLAT_AT = 0.2;
const STANCE_HEEL_OFF_AT = 0.6;
/**
 * How much of the stance's backward speed the swing keeps at either end, so
 * the foot neither stops dead as it leaves the floor nor slaps down.
 */
const SWING_CARRY = 0.5;

/** How sharp the soft minimum is: the pelvis hands from one leg's arc to the other without a corner. */
const ARC_BLEND = 0.008;

/**
 * The pelvis vaults over each planted leg: it stands no higher than that leg
 * can reach at this point of its stance, and with both feet down it rides the
 * lower of the two arcs. In flight it carries on along a shallow arc between
 * the push-off it left and the contact it is heading for.
 */
function gaitHipHeight(gait: GaitSpec, phase: number): number {
  const reach = LEG_MAX_REACH * gait.reachShare;
  const ceilingOf = (foot: FootPose): number =>
    foot.height + Math.sqrt(Math.max(0, reach * reach - foot.ahead * foot.ahead));
  const ceilings = [STANDING_HIP_HEIGHT];
  for (const offset of [0, HALF_CYCLE]) {
    const foot = gaitFoot(gait, phase + offset);
    if (foot.planted) ceilings.push(ceilingOf(foot));
  }
  if (ceilings.length === 1) {
    const local = wrap(phase) % HALF_CYCLE;
    const flightStart = gait.toeOff;
    const flightEnd = HALF_CYCLE;
    const s = (local - flightStart) / (flightEnd - flightStart);
    const leaving = ceilingOf(gaitFoot(gait, flightStart));
    const landing = ceilingOf(gaitFoot(gait, 0));
    return Math.min(STANDING_HIP_HEIGHT, lerp(leaving, landing, s) + hump(s) * FLIGHT_RISE);
  }
  const floor = Math.min(...ceilings);
  const sum = ceilings.reduce((acc, h) => acc + Math.exp(-(h - floor) / ARC_BLEND), 0);
  return floor - ARC_BLEND * Math.log(sum);
}

/** Half of one loop in phase units: the two feet run this far apart in a gait. */
const HALF_CYCLE = 0.5;
const FLIGHT_RISE = 0.025;

/** Lays a gait's two feet and its pelvis onto a pose. Phase 0 is his right foot's contact. */
function applyGait(pose: ScientistPose, gait: GaitSpec, phase: number): void {
  const hipX = gait.hipBack;
  pose.hip = pt(pose.view === 'side' ? hipX : pose.hip.x, -gaitHipHeight(gait, phase));
  const right = gaitFoot(gait, phase);
  const left = gaitFoot(gait, phase + HALF_CYCLE);
  const place = (foot: FootPose): FootPose =>
    pose.view === 'side' ? { ...foot, ahead: foot.ahead + hipX + PROFILE_HIP_JOINT_AHEAD } : foot;
  pose.feet = { right: place(right), left: place(left) };
}

/**
 * The arm swing driver: +1 is that arm furthest forward. At a foot's contact
 * the same-side arm is furthest back, so the right arm runs on −cos of a phase
 * whose zero is the right foot's contact.
 */
function armForward(phase: number, side: Side): number {
  const c = Math.cos(phase * TWO_PI);
  return side === 'right' ? -c : c;
}

function setArm(pose: ScientistPose, side: Side, edit: Partial<ArmPose>): void {
  pose.arms[side] = { ...pose.arms[side], ...edit };
}

// ── Walk ─────────────────────────────────────────────────────────────────────

const WALK_EXTRA_LEAN = 0.06;
/** The head pecks forward on each step, the way a hurrying old man's does. */
const WALK_PECK = 0.07;
const WALK_UPPER = -0.28;
const WALK_UPPER_SWING = 0.3;
/** Elbows held bent so the hands ride up near his chest. */
const WALK_BEND = 1.95;
const WALK_BEND_SWING = 0.2;
const WALK_FACING_UPPER = 0.16;
const WALK_FACING_UPPER_SWING = 0.05;
const WALK_FACING_BEND = 1.0;
const WALK_FACING_FORE_SCALE = 0.62;
const WALK_FACING_FORE_SWING = 0.12;
const WALK_HEM_SWING = 0.025;
/** The hem is carried forward by the leading leg. */
const WALK_HEM_FOLLOW = 0.15;
/** He pitches forward into each step and back as he passes over it. */
const WALK_LEAN_PUMP = 0.03;
const WALK_FACING_SWAY = 0.02;
const WALK_BADGE_SWING = 0.02;

function walkPose(view: CardinalView, phase: number): ScientistPose {
  const pose = restingPose(view);
  applyGait(pose, WALK, phase);
  const step = Math.cos(phase * 2 * TWO_PI);
  pose.lean += WALK_EXTRA_LEAN + step * WALK_LEAN_PUMP;
  pose.neck = REST_NECK + step * WALK_PECK;
  pose.headPitch = REST_HEAD_PITCH - step * WALK_PECK;
  pose.worry = WORRIED;
  for (const side of ['left', 'right'] as const) {
    const forward = armForward(phase, side);
    if (view === 'side') {
      setArm(pose, side, {
        upper: WALK_UPPER + forward * WALK_UPPER_SWING,
        bend: WALK_BEND + forward * WALK_BEND_SWING,
      });
    } else {
      setArm(pose, side, {
        upper: WALK_FACING_UPPER + forward * WALK_FACING_UPPER_SWING,
        bend: WALK_FACING_BEND,
        foreScale: WALK_FACING_FORE_SCALE - forward * WALK_FACING_FORE_SWING,
        foreBehind: view === 'back',
      });
    }
  }
  if (view === 'side') {
    const leading = Math.max(pose.feet.left.ahead, pose.feet.right.ahead) - pose.hip.x;
    pose.hemSwing = -step * WALK_HEM_SWING + leading * WALK_HEM_FOLLOW;
  } else {
    const weight = Math.cos(phase * TWO_PI);
    pose.hip = pt(weight * WALK_FACING_SWAY * (view === 'front' ? -1 : 1), pose.hip.y);
    pose.hemSwing = -weight * WALK_HEM_SWING;
  }
  pose.badgeSwing = Math.sin(phase * 2 * TWO_PI) * WALK_BADGE_SWING;
  pose.blink = blinkAt(phase, WALK_BLINK_AT);
  return pose;
}

const WORRIED = 0.6;
const WALK_BLINK_AT = 0.7;

// ── Run ──────────────────────────────────────────────────────────────────────

const RUN_EXTRA_LEAN = 0.12;
const RUN_NECK = REST_NECK + 0.12;
const RUN_HEAD_PITCH = REST_HEAD_PITCH - 0.22;
const RUN_UPPER = -0.12;
const RUN_UPPER_SWING = 0.85;
const RUN_BEND = 1.05;
/** The forearms flop on their own beat, twice a stride and out of step with each other. */
const RUN_FLOP = 0.55;
const RUN_FLOP_OFFSET = 0.18;
const RUN_FACING_UPPER = 0.75;
const RUN_FACING_UPPER_SWING = 0.45;
const RUN_FACING_BEND = 0.95;
const RUN_FACING_FLOP = 0.5;
const RUN_FLARE = 0.8;
const RUN_FLARE_FLUTTER = 0.2;
const RUN_GAZE_UP = 0.5;
const RUN_BADGE_TRAIL = -0.09;
const RUN_FACING_SWAY = 0.035;
const RUN_FACING_ROLL = 0.08;

function runPose(view: CardinalView, phase: number): ScientistPose {
  const pose = restingPose(view);
  applyGait(pose, RUN, phase);
  pose.lean += RUN_EXTRA_LEAN;
  pose.neck = RUN_NECK;
  pose.headPitch = RUN_HEAD_PITCH;
  pose.mouth = 1;
  pose.worry = 1;
  pose.gaze = pt(0, -RUN_GAZE_UP);
  const flutter = Math.sin(phase * 2 * TWO_PI);
  pose.flare = RUN_FLARE + flutter * RUN_FLARE_FLUTTER;
  for (const side of ['left', 'right'] as const) {
    const forward = armForward(phase, side);
    const offset = side === 'right' ? 0 : RUN_FLOP_OFFSET;
    const flop = Math.sin((phase * 2 + offset) * TWO_PI);
    if (view === 'side') {
      setArm(pose, side, {
        upper: RUN_UPPER + forward * RUN_UPPER_SWING,
        bend: RUN_BEND + flop * RUN_FLOP,
        hand: 'open',
      });
    } else {
      setArm(pose, side, {
        upper: RUN_FACING_UPPER + forward * RUN_FACING_UPPER_SWING,
        bend: RUN_FACING_BEND + flop * RUN_FACING_FLOP,
        hand: 'open',
      });
    }
  }
  if (view === 'side') {
    pose.badgeSwing = RUN_BADGE_TRAIL;
  } else {
    const weight = Math.cos(phase * TWO_PI);
    const mirror = view === 'front' ? -1 : 1;
    pose.hip = pt(weight * RUN_FACING_SWAY * mirror, pose.hip.y);
    pose.roll = weight * RUN_FACING_ROLL * mirror;
    pose.hemSwing = -weight * RUN_FACING_SWAY;
  }
  return pose;
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/** Beats of the fidget, as shares of the loop. */
const PUSH_START = 0.22;
const PUSH_UP = 0.42;
const PUSH_HOLD = 0.48;
const PUSH_END = 0.68;
const GLANCE_START = 0.66;
const GLANCE_OUT = 0.76;
const GLANCE_BACK = 0.95;
/** Whole turns per loop, so the wringing closes on itself at the seam. */
const WRING_TURNS = 5;
const IDLE_BREATHS = 2;
const WRING_RX = 0.035;
const WRING_RY = 0.025;
/** The hands wring this far in front of his paunch, and this far below the waist line. */
const WRING_AHEAD = 0.1;
const WRING_DROP = 0.04;
const FACING_WRING_HALF = 0.035;
const GLANCE_TURN = 0.9;
const GLANCE_GAZE = 1;
const PUSH_CHIN_LIFT = 0.12;
const IDLE_BREATH = 0.02;
const IDLE_SWAY = 0.012;
const IDLE_BLINK_AT = 0.5;
/** Head-on the arm folding to his belly is mostly depth, so the elbow is held near the line. */
const FACING_FOLD_FORESHORTEN = 0.55;
/** A wringing hand slows to half its circle while he glances away. */
const GLANCE_WRING_EASE = 0.5;
/** In profile a folded elbow breaks back and down; head-on, down and out to its own side. */
const PROFILE_ELBOW_POLE_BACK = 0.5;
const FACING_ELBOW_POLE_DROP = 0.5;
/** Past this share of the push the hand is at his glasses: it pinches, and its elbow swings ahead. */
const PUSH_AT_GLASSES_FROM = 0.5;
const PUSH_ELBOW_POLE_AHEAD = 0.5;
const PUSH_GAZE_UP = 0.5;

function idlePose(view: CardinalView, t: number): ScientistPose {
  const pose = restingPose(view);
  const breath = Math.sin(t * TWO_PI * IDLE_BREATHS);
  pose.hip = pt(
    pose.hip.x + (view === 'side' ? 0 : Math.sin(t * TWO_PI) * IDLE_SWAY),
    pose.hip.y - breath * IDLE_BREATH,
  );
  pose.worry = WORRIED;

  const glance =
    hump(ramp(t, GLANCE_START, GLANCE_BACK)) * easeOut(ramp(t, GLANCE_START, GLANCE_OUT));
  const pushRaise = ramp(t, PUSH_START, PUSH_UP) * (1 - ramp(t, PUSH_HOLD, PUSH_END));
  const wringAngle = t * WRING_TURNS * TWO_PI;
  const wringSettle = 1 - glance * GLANCE_WRING_EASE;

  const rest = buildSkeleton(pose);
  const belly =
    view === 'side'
      ? pt(rest.waist.x + WRING_AHEAD + WAIST_FRONT_REACH, rest.waist.y + WRING_DROP)
      : pt(rest.waist.x, rest.waist.y + WRING_DROP);
  const circle = pt(
    Math.cos(wringAngle) * WRING_RX * wringSettle,
    Math.sin(wringAngle) * WRING_RY * wringSettle,
  );
  const spread = view === 'side' ? 0 : FACING_WRING_HALF;
  const handFor = (side: Side): Pt => {
    const sign = side === 'right' ? 1 : -1;
    const screen = view === 'front' ? -sign : sign;
    return pt(belly.x + screen * spread + sign * circle.x, belly.y + sign * circle.y);
  };
  const glasses =
    view === 'side'
      ? pt(rest.head.x + GLASSES_AHEAD, rest.head.y + GLASSES_DROP)
      : pt(rest.head.x + (view === 'front' ? -1 : 1) * GLASSES_SIDE, rest.head.y + GLASSES_DROP);
  const rightHand = lerpPoint(handFor('right'), glasses, pushRaise);
  const pushAtGlasses = pushRaise > PUSH_AT_GLASSES_FROM;

  const facing = view !== 'side';
  const pole = (side: Side): Pt => {
    if (!facing) return pt(-PROFILE_ELBOW_POLE_BACK, 1);
    const sign = side === 'right' ? 1 : -1;
    const screen = view === 'front' ? -sign : sign;
    return pt(screen, FACING_ELBOW_POLE_DROP);
  };
  setArm(pose, 'left', {
    target: handFor('left'),
    pole: pole('left'),
    hand: 'fist',
    foreshorten: facing ? FACING_FOLD_FORESHORTEN : 0,
    foreBehind: view === 'back',
  });
  setArm(pose, 'right', {
    target: rightHand,
    pole: pushAtGlasses ? pt(facing ? 0 : PUSH_ELBOW_POLE_AHEAD, 1) : pole('right'),
    hand: pushAtGlasses ? 'pinch' : 'fist',
    foreshorten: facing ? lerp(FACING_FOLD_FORESHORTEN, FACING_PUSH_FORESHORTEN, pushRaise) : 0,
    foreBehind: view === 'back' && pushRaise < PUSH_AT_GLASSES_FROM,
    overHead: view === 'front' && pushAtGlasses,
  });

  pose.headPitch = REST_HEAD_PITCH - pushRaise * PUSH_CHIN_LIFT;
  pose.headTurn = glance * GLANCE_TURN;
  pose.gaze = pt(glance * GLANCE_GAZE * (view === 'front' ? 1 : -1), -pushRaise * PUSH_GAZE_UP);
  pose.blink = blinkAt(t, IDLE_BLINK_AT);
  return pose;
}

const WAIST_FRONT_REACH = 0.12;
const GLASSES_AHEAD = 0.24;
const GLASSES_DROP = 0.05;
const GLASSES_SIDE = 0.01;
/** Head-on, the elbow of a hand raised to his glasses points at the camera, not out to the side. */
const FACING_PUSH_FORESHORTEN = 0.9;

function lerpPoint(a: Pt, b: Pt, t: number): Pt {
  return pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
}

// ── Talk ─────────────────────────────────────────────────────────────────────

/** The emphasis: he flings the arm out and points, down the hallway. */
const POINT_START = 0.4;
const POINT_OUT = 0.58;
const POINT_HOLD = 0.75;
const POINT_END = 0.88;
const CHOP_BEATS = 3;
const CHOP_TRAVEL = 0.06;
const TALK_HAND_AHEAD = 0.22;
const TALK_HAND_DROP = 0.18;
const POINT_REACH = 0.82;
const POINT_RISE = 0.08;
const FACING_POINT_OUT = 0.78;
const FACING_POINT_DROP = 0.12;
const TALK_MOUTH_BEATS = 5;
const TALK_NOD = 0.08;
const TALK_LEAN = 0.05;
const TALK_DRIFT = 0.015;
/** A chop comes down fast and lifts back slowly; a mouth opens fast and closes slowly. */
const CHOP_STRIKE_SHARE = 0.3;
const MOUTH_OPEN_SHARE = 0.35;
const BECKON_CURL_SHARE = 0.4;
/** Head-on the gesturing hand stays nearer his body than it reaches in profile. */
const FACING_TALK_HAND_SHARE = 0.5;
const POINT_HAND_FROM = 0.5;
const POINT_HEAD_TURN = 0.5;

/**
 * One beat, 0 → 1 → 0 over the unit interval, rising over the first `rise`
 * of it and falling over the rest. A sine beat retraces its own path, so a
 * row of them paints each picture twice.
 */
function beat(u: number, rise: number): number {
  return u < rise ? easeOut(u / rise) : 1 - easeInOut((u - rise) / (1 - rise));
}

function talkPose(view: CardinalView, t: number): ScientistPose {
  const pose = restingPose(view);
  pose.worry = WORRIED;
  const point =
    easeOut(ramp(t, POINT_START, POINT_OUT)) * (1 - easeInOut(ramp(t, POINT_HOLD, POINT_END)));
  const chop = beat(wrap(t * CHOP_BEATS), CHOP_STRIKE_SHARE) * (1 - point);
  const drift = Math.sin(t * TWO_PI);
  pose.hip = pt(pose.hip.x + drift * TALK_DRIFT, pose.hip.y);
  pose.lean += point * TALK_LEAN;
  pose.headPitch = REST_HEAD_PITCH + chop * TALK_NOD;
  pose.mouth = beat(wrap(t * TALK_MOUTH_BEATS), MOUTH_OPEN_SHARE);
  const rest = buildSkeleton(pose);
  const shoulder = rest.shoulders.right;
  const facing = view !== 'side';
  const screenRight = view === 'front' ? -1 : 1;
  const gesture = facing
    ? pt(
        shoulder.x + screenRight * TALK_HAND_AHEAD * FACING_TALK_HAND_SHARE,
        shoulder.y + TALK_HAND_DROP + chop * CHOP_TRAVEL,
      )
    : pt(shoulder.x + TALK_HAND_AHEAD, shoulder.y + TALK_HAND_DROP + chop * CHOP_TRAVEL);
  const pointAt = facing
    ? pt(shoulder.x + screenRight * FACING_POINT_OUT, shoulder.y + FACING_POINT_DROP)
    : pt(shoulder.x + POINT_REACH, shoulder.y - POINT_RISE);
  setArm(pose, 'right', {
    target: lerpPoint(gesture, pointAt, point),
    pole: facing ? pt(screenRight, 1) : pt(-PROFILE_ELBOW_POLE_BACK, 1),
    hand: point > POINT_HAND_FROM ? 'point' : 'open',
    foreshorten: facing ? FACING_FOLD_FORESHORTEN * (1 - point) : 0,
  });
  const belly = facing
    ? pt(rest.waist.x - screenRight * FACING_WRING_HALF, rest.waist.y + WRING_DROP)
    : pt(rest.waist.x + WRING_AHEAD + WAIST_FRONT_REACH, rest.waist.y + WRING_DROP);
  setArm(pose, 'left', {
    target: belly,
    pole: facing ? pt(-screenRight, FACING_ELBOW_POLE_DROP) : pt(-PROFILE_ELBOW_POLE_BACK, 1),
    hand: 'fist',
    foreshorten: facing ? FACING_FOLD_FORESHORTEN : 0,
    foreBehind: view === 'back',
  });
  pose.headTurn =
    point * (facing ? -screenRight * POINT_HEAD_TURN * (view === 'front' ? 1 : -1) : 0);
  pose.gaze = pt(point * (view === 'front' ? -1 : 1), 0);
  return pose;
}

// ── Beckon ───────────────────────────────────────────────────────────────────

const BECKON_WAVES = 1;
const BECKON_UPPER = 1.15;
const BECKON_BEND_OPEN = 0.35;
const BECKON_BEND_CURL = 1.6;
const BECKON_FACING_UPPER = 1.15;
const BECKON_FACING_BEND_OPEN = -0.2;
const BECKON_FACING_BEND_CURL = -1.55;
const BECKON_NOD = 0.12;
const BECKON_LEAN = 0.04;
const BECKON_HAND_TURN = 0.6;
const BECKON_MOUTH_OPEN = 0.5;
const BECKON_GAZE_ASIDE = 0.5;

function beckonPose(view: CardinalView, t: number): ScientistPose {
  const pose = restingPose(view);
  pose.worry = WORRIED;
  const wave = beat(wrap(t * BECKON_WAVES), BECKON_CURL_SHARE);
  const facing = view !== 'side';
  setArm(pose, 'right', {
    upper: facing ? BECKON_FACING_UPPER : BECKON_UPPER,
    bend: facing
      ? lerp(BECKON_FACING_BEND_OPEN, BECKON_FACING_BEND_CURL, wave)
      : lerp(BECKON_BEND_OPEN, BECKON_BEND_CURL, wave),
    hand: 'open',
    handTurn: -wave * BECKON_HAND_TURN,
  });
  pose.lean += wave * BECKON_LEAN;
  pose.headPitch = REST_HEAD_PITCH + wave * BECKON_NOD;
  pose.mouth = wave * BECKON_MOUTH_OPEN;
  const rest = buildSkeleton(pose);
  const screenRight = view === 'front' ? -1 : 1;
  setArm(pose, 'left', {
    target: facing
      ? pt(rest.waist.x - screenRight * FACING_WRING_HALF, rest.waist.y + WRING_DROP)
      : pt(rest.waist.x + WRING_AHEAD + WAIST_FRONT_REACH, rest.waist.y + WRING_DROP),
    pole: facing ? pt(-screenRight, FACING_ELBOW_POLE_DROP) : pt(-PROFILE_ELBOW_POLE_BACK, 1),
    hand: 'fist',
    foreshorten: facing ? FACING_FOLD_FORESHORTEN : 0,
    foreBehind: view === 'back',
  });
  pose.gaze = pt(view === 'front' ? -BECKON_GAZE_ASIDE : BECKON_GAZE_ASIDE, 0);
  return pose;
}

// ── Cower ────────────────────────────────────────────────────────────────────

/** The flinch lands in the first share of the row; the rest holds it, trembling. */
const COWER_SNAP_END = 0.3;
const COWER_CROUCH = 0.2;
const COWER_LEAN_BACK = -0.08;
const COWER_HIP_BACK = -0.06;
const COWER_NECK = REST_NECK - 0.45;
const COWER_HEAD_PITCH = REST_HEAD_PITCH + 0.75;
const COWER_TURN = 0.75;
const COWER_TREMBLE = 0.012;
/** Hands up in front of his face, palms out, either side of the nose. */
const COWER_HANDS_AHEAD = 0.2;
const COWER_HANDS_RISE = 0.02;
const COWER_HANDS_SPREAD = 0.09;
const FACING_COWER_SPREAD = 0.075;
/** Head-on the cowering elbows come forward, toward the camera, not out to the sides. */
const FACING_COWER_FORESHORTEN = 0.8;
const COWER_ELBOW_POLE_AHEAD = 0.5;

function cowerPose(view: CardinalView, t: number): ScientistPose {
  const pose = restingPose(view);
  const snap = easeOut(clamp01(t / COWER_SNAP_END));
  const holding = t > COWER_SNAP_END;
  const trembleIndex = Math.round(t * (COWER_FRAMES - 1));
  const tremble = holding ? (trembleIndex % 2 === 0 ? 1 : -1) * COWER_TREMBLE : 0;
  pose.hip = pt(
    pose.hip.x + (view === 'side' ? COWER_HIP_BACK * snap : tremble),
    pose.hip.y + COWER_CROUCH * snap,
  );
  pose.lean += COWER_LEAN_BACK * snap;
  pose.neck = lerp(REST_NECK, COWER_NECK, snap);
  pose.headPitch = lerp(REST_HEAD_PITCH, COWER_HEAD_PITCH, snap);
  pose.headTurn = COWER_TURN * snap;
  pose.shrug = snap;
  pose.mouth = snap;
  pose.worry = 1;
  pose.blink = holding ? 1 : 0;
  const rest = buildSkeleton(pose);
  const facing = view !== 'side';
  const screenRight = view === 'front' ? -1 : 1;
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'right' ? screenRight : -screenRight;
    const hands = facing
      ? pt(rest.head.x + sign * FACING_COWER_SPREAD + tremble, rest.head.y - COWER_HANDS_RISE)
      : pt(
          rest.head.x + COWER_HANDS_AHEAD + (side === 'right' ? 0 : -COWER_HANDS_SPREAD) + tremble,
          rest.head.y - COWER_HANDS_RISE,
        );
    const resting = rest.shoulders[side];
    const restHand = pt(
      resting.x + (facing ? sign * REST_HAND_OUT : REST_HAND_OUT),
      resting.y + REST_HAND_DROP,
    );
    setArm(pose, side, {
      target: lerpPoint(restHand, hands, snap),
      pole: facing ? pt(sign, 1) : pt(COWER_ELBOW_POLE_AHEAD, 1),
      foreshorten: facing ? FACING_COWER_FORESHORTEN * snap : 0,
      hand: 'open',
      handTurn: 0,
      overHead: view === 'front',
      foreBehind: view === 'back',
    });
  }
  return pose;
}

const REST_HAND_OUT = 0.06;
const REST_HAND_DROP = 0.78;

// ── Blink ────────────────────────────────────────────────────────────────────

const BLINK_WIDTH = 0.06;

/** Shut on the frame nearest `at`, open everywhere else. */
function blinkAt(t: number, at: number): number {
  const distance = Math.abs(wrap(t - at + HALF_CYCLE) - HALF_CYCLE);
  return distance < BLINK_WIDTH / 2 ? 1 : 0;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

const IDLE_FRAMES = 24;
const TALK_FRAMES = 16;
const BECKON_FRAMES = 10;
const COWER_FRAMES = 12;

const TICKS_PER_SECOND = 60;
const IDLE_SECONDS = 4.2;
const TALK_SECONDS = 1.8;
const BECKON_SECONDS = 0.8;
const COWER_SECONDS = 0.8;

/** How an action's phase is advanced: by ground covered, or by the clock. */
type Pacing =
  | { readonly kind: 'ground'; readonly pxPerCycle: number }
  | { readonly kind: 'clock'; readonly ticksPerCycle: number };

interface ActionSpec {
  readonly frames: number;
  readonly loops: boolean;
  readonly pacing: Pacing;
  /** `t` is the cycle phase for a loop and the progress 0–1 for a one-shot. */
  readonly pose: (view: CardinalView, t: number) => ScientistPose;
  /** Travelling rows carry the sprite over the floor; the rest stand on it. */
  readonly travels: boolean;
}

/** World pixels one figure unit spans at the game's tile. */
const WORLD_PX_PER_UNIT = TILE_SIZE * SCIENTIST_SCALE;

/** Ground one walk cycle covers in the world, in pixels. */
export const SCIENTIST_WALK_CYCLE_PX = groundPerCycle(WALK) * WORLD_PX_PER_UNIT;
/** Ground one run cycle covers in the world, in pixels. */
export const SCIENTIST_RUN_CYCLE_PX = groundPerCycle(RUN) * WORLD_PX_PER_UNIT;

export const SCIENTIST_ACTION_TABLE: Readonly<Record<ScientistAction, ActionSpec>> = {
  idle: {
    frames: IDLE_FRAMES,
    loops: true,
    pacing: { kind: 'clock', ticksPerCycle: IDLE_SECONDS * TICKS_PER_SECOND },
    pose: idlePose,
    travels: false,
  },
  walk: {
    frames: WALK.frames,
    loops: true,
    pacing: { kind: 'ground', pxPerCycle: SCIENTIST_WALK_CYCLE_PX },
    pose: walkPose,
    travels: true,
  },
  run: {
    frames: RUN.frames,
    loops: true,
    pacing: { kind: 'ground', pxPerCycle: SCIENTIST_RUN_CYCLE_PX },
    pose: runPose,
    travels: true,
  },
  talk: {
    frames: TALK_FRAMES,
    loops: true,
    pacing: { kind: 'clock', ticksPerCycle: TALK_SECONDS * TICKS_PER_SECOND },
    pose: talkPose,
    travels: false,
  },
  beckon: {
    frames: BECKON_FRAMES,
    loops: true,
    pacing: { kind: 'clock', ticksPerCycle: BECKON_SECONDS * TICKS_PER_SECOND },
    pose: beckonPose,
    travels: false,
  },
  cower: {
    frames: COWER_FRAMES,
    loops: false,
    pacing: { kind: 'clock', ticksPerCycle: COWER_SECONDS * TICKS_PER_SECOND },
    pose: cowerPose,
    travels: false,
  },
};

/** The sample point of a frame: a loop's frames split the cycle evenly; a one-shot's run 0 to 1. */
export function scientistRowT(action: ScientistAction, frame: number): number {
  const spec = SCIENTIST_ACTION_TABLE[action];
  return spec.loops ? frame / spec.frames : frame / (spec.frames - 1);
}

/** The pose a cell paints. */
export function scientistPoseAt(
  action: ScientistAction,
  view: CardinalView,
  frame: number,
): ScientistPose {
  return SCIENTIST_ACTION_TABLE[action].pose(view, scientistRowT(action, frame));
}

interface StateKey {
  readonly action: ScientistAction;
  readonly view: CardinalView;
}

const STATE_KEYS: ReadonlyMap<string, StateKey> = new Map(
  SCIENTIST_ACTIONS.flatMap((action) =>
    SCIENTIST_VIEWS.map((view): [string, StateKey] => [
      scientistState(action, view),
      { action, view },
    ]),
  ),
);

/** Which action and view a state name paints, for the harness and the gates. */
export function scientistStateKey(state: string): StateKey | undefined {
  return STATE_KEYS.get(state);
}

function paintScientistFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const key = STATE_KEYS.get(state);
  if (key === undefined) return;
  ctx.save();
  try {
    ctx.translate(ORIGIN_X, ORIGIN_Y);
    ctx.scale(PX_PER_UNIT, PX_PER_UNIT);
    drawScientistPose(ctx, scientistPoseAt(key.action, key.view, frame));
  } finally {
    ctx.restore();
  }
}

function stateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const [state, key] of STATE_KEYS) frames[state] = SCIENTIST_ACTION_TABLE[key.action].frames;
  return frames;
}

export const SCIENTIST_FIGURE: FigureDef = {
  id: 'dr_moult',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(stateFrames()),
  paintFrame: paintScientistFrame,
};

// ── Runtime ──────────────────────────────────────────────────────────────────

/**
 * Moves an action's phase on by one tick. Walk and run turn by the ground he
 * actually covered this tick, so a planted foot stays put on the floor;
 * everything else runs on the clock. A loop wraps; the cower is a one-shot
 * and holds on its last frame.
 *
 * @param phase    The phase so far: cycles for a loop, progress 0–1 for a one-shot.
 * @param groundPx World pixels he moved this tick; ignored by the clock-paced actions.
 */
export function advanceScientistPhase(
  action: ScientistAction,
  phase: number,
  groundPx: number,
): number {
  const spec = SCIENTIST_ACTION_TABLE[action];
  const step =
    spec.pacing.kind === 'ground'
      ? Math.min(groundPx, MAX_GAIT_ADVANCE_PX) / spec.pacing.pxPerCycle
      : 1 / spec.pacing.ticksPerCycle;
  const next = phase + step;
  return spec.loops ? wrap(next) : Math.min(1, next);
}

/**
 * The most ground one tick may turn the gait by, in world pixels: about one
 * run frame's worth, so a shove never skips whole frames and strobes the legs.
 */
const MAX_GAIT_ADVANCE_PX = SCIENTIST_RUN_CYCLE_PX / RUN.frames;

/** The frame of an action's row a phase draws. */
export function scientistFrame(action: ScientistAction, phase: number): number {
  const spec = SCIENTIST_ACTION_TABLE[action];
  if (!spec.loops) return Math.min(spec.frames - 1, Math.round(clamp01(phase) * (spec.frames - 1)));
  return Math.floor(wrap(phase) * spec.frames) % spec.frames;
}

/**
 * Draws him: `(x, y)` is the screen top-left of the tile he stands on, as for
 * `drawFigureCached`. The facing is a `selectFacing` result; the diagonals draw
 * their cardinal neighbour.
 */
export function drawScientist(
  ctx: CanvasRenderingContext2D,
  action: ScientistAction,
  facing: FacingSelection,
  phase: number,
  x: number,
  y: number,
  tileSize: number,
): void {
  const view = scientistViewOf(facing.view);
  drawFigureCached(
    ctx,
    SCIENTIST_FIGURE,
    scientistState(action, view),
    scientistFrame(action, phase),
    x,
    y,
    tileSize,
    { flipX: facing.flipX },
  );
}

/**
 * How far above the top of his tile the highest ink of his standing rows
 * reaches, in screen pixels at the game's 32 px tile — where a marker or a
 * speech bubble over his head hangs. Measured off the art and re-measured by
 * the gates; nothing can measure ink at runtime.
 */
export const SCIENTIST_HEAD_TOP_ABOVE_TILE_PX = 35;

/** Head-top clearance at any tile size, scaled from the 32 px measurement. */
export function scientistHeadTop(tileTopY: number, tileSize: number): number {
  return tileTopY - (SCIENTIST_HEAD_TOP_ABOVE_TILE_PX * tileSize) / TILE_SIZE;
}

/** Where the cell's origin sits for a gate: the travelling rows' ground speed in cell pixels per frame. */
export function scientistTravelPerFrameCellPx(action: ScientistAction): number {
  const spec = SCIENTIST_ACTION_TABLE[action];
  if (!spec.travels || spec.pacing.kind !== 'ground') return 0;
  return (spec.pacing.pxPerCycle / WORLD_PX_PER_UNIT / spec.frames) * PX_PER_UNIT;
}

export { STANDING_HIP_HEIGHT, REST_HIP_BACK };
