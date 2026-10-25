/**
 * Signet's pose, solved once per frame as a small 3D skeleton and projected
 * into whichever view she is drawn in.
 *
 * Every view is the same body: x runs across her (+x is her right as seen from
 * the front), y runs down, z runs forward along her heading. The front, back
 * and profile drawings are projections of one solve, so the stride a profile
 * shows and the stride a head-on drawing shows can never disagree, and an arm
 * that swings forward in profile foreshortens head-on by construction.
 *
 * Locomotion is solved in two halves. A foot on the floor is pinned to the
 * floor: it rolls heel → flat → ball and slides back through her body at
 * exactly the speed the floor passes under her. A foot in the air follows
 * authored hip and knee curves from normal-gait data, corrected so it leaves
 * the floor where the stance ended and arrives where the next one begins. The
 * pelvis rides as high as the planted legs allow, which is what drops her at
 * each heel strike and lifts her over the straight leg at mid-stance.
 */

import { clamp01, lerp } from '../bipedArt';
import { HEAD_ON_FLOOR_FORESHORTENING } from '../biped/rig';
import {
  ANKLE_HEIGHT,
  ANKLE_REST_X,
  ANKLE_Y,
  ARM_ROOT_X,
  ARM_ROOT_Y,
  FIGURE_SCALE,
  FOOT_LENGTH,
  FOOT_Y,
  FOREARM_LENGTH,
  HAND_LENGTH,
  HEEL_TO_ANKLE,
  HEEL_TO_BALL,
  HIP_JOINT_X,
  HIP_JOINT_Y,
  LEG_LENGTH,
  SHIN_LENGTH,
  THIGH_LENGTH,
  UPPER_ARM_LENGTH,
  WAIST_Y,
} from './proportions';

const TWO_PI = Math.PI * 2;
const DEGREES = Math.PI / 180;

export const SIDES = [-1, 1] as const;
export type BodySide = (typeof SIDES)[number];
export type SignetView = 'front' | 'back' | 'side';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface SignetLeg {
  hip: V3;
  knee: V3;
  ankle: V3;
  heel: V3;
  ball: V3;
  toe: V3;
  /** The foot's angle to the floor: positive with the toes raised. */
  pitch: number;
  /** 0 while it carries weight, rising to 1 at the top of its swing. */
  swing: number;
}

export interface SignetArm {
  shoulder: V3;
  elbow: V3;
  wrist: V3;
  fingertip: V3;
  /** 0 a relaxed, loosely curled hand to 1 fingers splayed open. */
  open: number;
}

/** A rigid body section's offset from its rest place and its turn. */
export interface SectionFrame {
  x: number;
  y: number;
  z: number;
  /** In the frontal plane; positive drops her right side. */
  roll: number;
  /** About the vertical; positive brings her right side forward. */
  yaw: number;
  /** In the sagittal plane; positive leans her forward. */
  pitch: number;
}

export interface SignetSkeleton {
  legs: Record<BodySide, SignetLeg>;
  arms: Record<BodySide, SignetArm>;
  pelvis: SectionFrame;
  chest: SectionFrame;
  /** The head's own turn on top of the chest's, in the frontal and sagittal planes. */
  headRoll: number;
  headPitch: number;
  /** 0–1 lungful, for the chest's rise. */
  breath: number;
  /** Her hair's lag behind the body: across, back along her heading, and up. */
  hairSway: number;
  hairTrail: number;
  hairLift: number;
}

/* ── Gait tuning ───────────────────────────────────────────────────────── */

/**
 * Her step is set by her speed the way a real walker's is: a slow saunter
 * takes short steps, a brisk walk long ones, and past a brisk walk she breaks
 * into a run rather than lunging. Expressed as step length over leg length.
 */
const SLOW_WALK_TILES_PER_SECOND = 0.84;
const BRISK_WALK_TILES_PER_SECOND = 1.9;
const RUN_FULL_TILES_PER_SECOND = 2.5;
/** A saunter swings the arms about half as far as a brisk walk. */
const SAUNTER_ARM_SHARE = 0.5;
const SLOW_WALK_STEP_RATIO = 0.6;
const BRISK_WALK_STEP_RATIO = 0.78;
const SLOW_RUN_STEP_RATIO = 0.95;
const RUN_STEP_RATIO_AT_FULL_SPEED = 1.12;
const FULL_SPEED_TILES_PER_SECOND = 3;
const STEPS_PER_CYCLE = 2;
const LEG_LENGTH_TILES = LEG_LENGTH * FIGURE_SCALE + ANKLE_HEIGHT * FIGURE_SCALE;

function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** How far into a run she is at this speed: 0 walking, 1 running. */
export function signetRunBlend(speedTilesPerSecond: number): number {
  return smoothstep(
    (speedTilesPerSecond - BRISK_WALK_TILES_PER_SECOND) /
      (RUN_FULL_TILES_PER_SECOND - BRISK_WALK_TILES_PER_SECOND),
  );
}

/**
 * The ground one gait cycle (two steps) covers at this speed, in tiles. The
 * creature advances its gait phase by exactly this, so a planted foot holds
 * still on the floor.
 */
export function signetStrideTiles(speedTilesPerSecond: number): number {
  const walkShare = clamp01(
    (speedTilesPerSecond - SLOW_WALK_TILES_PER_SECOND) /
      (BRISK_WALK_TILES_PER_SECOND - SLOW_WALK_TILES_PER_SECOND),
  );
  const walkRatio = lerp(SLOW_WALK_STEP_RATIO, BRISK_WALK_STEP_RATIO, walkShare);
  const runShare = clamp01(
    (speedTilesPerSecond - BRISK_WALK_TILES_PER_SECOND) /
      (FULL_SPEED_TILES_PER_SECOND - BRISK_WALK_TILES_PER_SECOND),
  );
  const runRatio = lerp(SLOW_RUN_STEP_RATIO, RUN_STEP_RATIO_AT_FULL_SPEED, runShare);
  const ratio = lerp(walkRatio, runRatio, signetRunBlend(speedTilesPerSecond));
  return ratio * LEG_LENGTH_TILES * STEPS_PER_CYCLE;
}

interface GaitStyle {
  /** Share of the cycle each foot is on the floor. */
  stance: number;
  /** Heel strike to foot flat, and heel off, as shares of the cycle. */
  footFlatAt: number;
  heelOffAt: number;
  /** Toes up at contact, heel up at toe-off. */
  contactPitch: number;
  toeOffPitch: number;
  /** Share of the cycle at which the ankle passes under the hip. */
  ankleUnderHipAt: number;
  /** Foot pitch through the swing: (share of the swing, radians). */
  swingPitchKeys: ReadonlyArray<readonly [number, number]>;
  /** How high the ankle rises above the line between lift-off and contact, and when. */
  swingLift: number;
  liftPeakAt: number;
  /** Where her feet land across: close to the centreline is a woman's walk. */
  footLineX: number;
  /** How far the swing foot arcs out round the planted one. */
  swingClearanceX: number;
  pelvisRoll: number;
  pelvisYaw: number;
  pelvisShift: number;
  chestRoll: number;
  chestYaw: number;
  lean: number;
  /** Shoulder swing forward and back, the elbow's resting bend and how much more it folds coming forward. */
  armForward: number;
  armBack: number;
  elbowBase: number;
  elbowForwardFold: number;
  /** How far the arms trail the legs, in radians of the cycle. */
  armLag: number;
  /** Hands cross toward the midline coming forward. */
  armInward: number;
  /** How far the hand hangs curled from the forearm's line. */
  wristFlex: number;
  /** Driven pelvis that sinks into each stance, for a run. */
  springyPelvis: boolean;
  /** How far her hair lifts and settles against the body's bob. */
  hairBounce: number;
}

const WRIST_REST_FLEX = 8 * DEGREES;
/** Running, the hands are held loosely curled. */
const RUN_WRIST_FLEX = 24 * DEGREES;

/**
 * A walk, after normal adult gait data: the heel strikes with the toes up, the
 * foot rolls flat and then off the ball, and through the swing the ankle rises
 * early as the knee folds behind her, then skims low as the shin flicks out and
 * the heel reaches for the floor.
 */
const WALK_STYLE: GaitStyle = {
  stance: 0.6,
  footFlatAt: 0.09,
  heelOffAt: 0.4,
  contactPitch: 17 * DEGREES,
  toeOffPitch: 42 * DEGREES,
  ankleUnderHipAt: 0.27,
  swingPitchKeys: [
    [0, -42 * DEGREES],
    [0.2, -28 * DEGREES],
    [0.45, -8 * DEGREES],
    [0.7, 4 * DEGREES],
    [1, 17 * DEGREES],
  ],
  swingLift: 0.04,
  liftPeakAt: 0.3,
  footLineX: 0.026,
  swingClearanceX: 0.008,
  pelvisRoll: 7 * DEGREES,
  pelvisYaw: 8 * DEGREES,
  pelvisShift: 0.018,
  chestRoll: 3.5 * DEGREES,
  chestYaw: 7 * DEGREES,
  lean: 2 * DEGREES,
  armForward: 26 * DEGREES,
  armBack: 26 * DEGREES,
  elbowBase: 10 * DEGREES,
  elbowForwardFold: 12 * DEGREES,
  armLag: 0.3,
  armInward: 10 * DEGREES,
  wristFlex: WRIST_REST_FLEX,
  springyPelvis: false,
  hairBounce: 0.006,
};

/**
 * A light run: a short stance under the body with a flight phase either side,
 * the knee folding hard to tuck the heel up behind, arms bent near square.
 */
const RUN_STYLE: GaitStyle = {
  stance: 0.33,
  footFlatAt: 0.05,
  heelOffAt: 0.18,
  contactPitch: 7 * DEGREES,
  toeOffPitch: 48 * DEGREES,
  ankleUnderHipAt: 0.12,
  swingPitchKeys: [
    [0, -48 * DEGREES],
    [0.25, -40 * DEGREES],
    [0.55, -12 * DEGREES],
    [0.8, 2 * DEGREES],
    [1, 7 * DEGREES],
  ],
  swingLift: 0.15,
  liftPeakAt: 0.32,
  footLineX: 0.028,
  swingClearanceX: 0.006,
  pelvisRoll: 5 * DEGREES,
  pelvisYaw: 10 * DEGREES,
  pelvisShift: 0.012,
  chestRoll: 3 * DEGREES,
  chestYaw: 11 * DEGREES,
  lean: 14 * DEGREES,
  armForward: 34 * DEGREES,
  armBack: 52 * DEGREES,
  elbowBase: 74 * DEGREES,
  elbowForwardFold: 6 * DEGREES,
  armLag: 0.15,
  armInward: 24 * DEGREES,
  wristFlex: RUN_WRIST_FLEX,
  springyPelvis: true,
  hairBounce: 0.014,
};

/** The run's pelvis dips at mid-stance as the leg loads and rises through flight. */
const RUN_PELVIS_DIP = 0.0125;
const RUN_PELVIS_BASE_DROP = 0.004;
/** Coming forward the forearm swings in across the body rather than out past the hip. */
const FORWARD_CARRY_RELEASE = 0.5;
/** Straight enough to read as a straight leg, never so straight the knee locks backward. */
const STANCE_REACH = 0.997;
/** Softens the walk's pelvis path where the two legs' reach arcs cross at each heel strike. */
const PELVIS_CUSP_SOFTNESS = 0.018;
const TOE_TIP_HEIGHT = 0.006;
const HALF = 0.5;
/** Guards a direction taken from a vector that has collapsed to a point. */
const DEGENERATE_LENGTH = 1e-6;
/** The pelvis takes part of a run's forward lean; the rest bends at the waist. */
const PELVIS_LEAN_SHARE = 0.4;
/** The ribcage rides part of the way across with the hips, so the waist bends rather than shears. */
const CHEST_FOLLOWS_PELVIS_SHIFT = 0.5;
const IDLE_CHEST_FOLLOWS_PELVIS_SHIFT = 0.4;
/** Her neck takes back most of the shoulders' tilt, keeping her eyes level. */
const HEAD_LEVELLING = 0.6;
/** Before the swing foot lands the pelvis starts lowering for it, over this last share of the swing. */
const CONTACT_ANTICIPATION = 0.3;
/** And it lets go of a leg that has just left the floor over this first share of the swing. */
const LIFT_OFF_RELEASE = 0.2;

/* ── Rest pose and gestures ────────────────────────────────────────────── */

/**
 * A woman's arms hang close at the shoulder and angle out at the elbow — the
 * carrying angle — which is what lets her hands clear her hips.
 */
const ARM_REST_ABDUCTION = 5 * DEGREES;
const CARRYING_ANGLE = 11 * DEGREES;
const ELBOW_REST_FLEX = 14 * DEGREES;

/**
 * The throw, right-handed: the hand is drawn back beside the shoulder as the
 * chest turns away, then the chest whips round and the arm drives out at the
 * target with the hand opening, holds a beat, and settles. Each key is
 * (progress through the cast, throwing arm, off arm, chest turn, lean).
 */
interface CastKey {
  at: number;
  arm: ArmAngles;
  offArm: ArmAngles;
  chestYaw: number;
  lean: number;
}

const SUMMON_ARM_ABDUCTION = 126 * DEGREES;
const SUMMON_ARM_FLEX = 26 * DEGREES;
/** In profile both arms come up in front of her, held out toward what she calls. */
const SUMMON_PROFILE_ABDUCTION = 40 * DEGREES;
const SUMMON_PROFILE_FLEX = 70 * DEGREES;
const SUMMON_ELBOW_FLEX = 34 * DEGREES;
/**
 * In profile her two raised arms would lie exactly over each other and read as
 * one; the far arm goes up higher so both show.
 */
const SUMMON_PROFILE_FAR_ARM_RAISE = 28 * DEGREES;
const SUMMON_CHEST_LIFT = 0.006;
const SUMMON_HEAD_PITCH = -8 * DEGREES;
/** The summon rises over this first share of its time and falls away over the last. */
const SUMMON_RISE_SHARE = 0.3;
const SUMMON_FALL_START = 0.62;
/** Raising an arm past level lifts its shoulder with it, by up to this much. */
const SHOULDER_SHRUG = 0.012;

/**
 * Standing, she rests her weight on one leg: the hip over it rides up and out,
 * the other knee eases forward and in, and the shoulders tilt against the hips.
 */
const IDLE_WEIGHT = 0.6;
const IDLE_WEIGHT_DRIFT = 0.18;
const IDLE_WEIGHT_PERIOD_SECONDS = 8.5;
const IDLE_PELVIS_ROLL = 6.5 * DEGREES;
const IDLE_PELVIS_SHIFT = 0.02;
const IDLE_CHEST_ROLL = 3 * DEGREES;
const IDLE_FREE_FOOT_AHEAD = 0.085;
const IDLE_FREE_FOOT_X = 0.056;
const IDLE_STANCE_FOOT_X = 0.022;
const IDLE_HEAD_ROLL = 2.5 * DEGREES;
/** Throwing right-handed she sets her weight back over the left foot. */
const CAST_WEIGHT = -0.7;

const BREATH_PERIOD_SECONDS = 4.2;
const BREATH_CHEST_RISE = 0.0035;
const BREATH_ARM_SWAY = 1.2 * DEGREES;

/* ── Hair ──────────────────────────────────────────────────────────────── */

const HAIR_SWAY_LAG = 0.9;
const HAIR_SWAY_GAIN = 2.8;
const HAIR_LIFT_LAG = 0.7;
const HAIR_TRAIL_AT_FULL_SPEED = 0.09;
const IDLE_HAIR_DRIFT = 0.004;
const IDLE_HAIR_PERIOD_SECONDS = 5.3;

/* ── Small vector helpers ──────────────────────────────────────────────── */

function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}

function lerp3(a: V3, b: V3, t: number): V3 {
  return v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
}

function add3(a: V3, b: V3): V3 {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function sub3(a: V3, b: V3): V3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function scale3(a: V3, k: number): V3 {
  return v3(a.x * k, a.y * k, a.z * k);
}

function length3(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function wrap01(t: number): number {
  return t - Math.floor(t);
}

/** A point given in a section's own rest coordinates, carried by that section's frame about `pivotY`. */
export function placeInSection(frame: SectionFrame, pivotY: number, p: V3): V3 {
  const below = p.y - pivotY;
  const cr = Math.cos(frame.roll);
  const sr = Math.sin(frame.roll);
  const rolledX = p.x * cr - below * sr;
  const rolledY = p.x * sr + below * cr;
  const cy = Math.cos(frame.yaw);
  const sy = Math.sin(frame.yaw);
  const yawedX = rolledX * cy - p.z * sy;
  const yawedZ = rolledX * sy + p.z * cy;
  // Leaning forward carries what is above the pivot ahead of it.
  const cp = Math.cos(frame.pitch);
  const sp = Math.sin(frame.pitch);
  const pitchedY = rolledY * cp + yawedZ * sp;
  const pitchedZ = yawedZ * cp - rolledY * sp;
  return v3(frame.x + yawedX, frame.y + pivotY + pitchedY, frame.z + pitchedZ);
}

const PELVIS_PIVOT_Y = HIP_JOINT_Y;
const CHEST_PIVOT_Y = WAIST_Y;

/* ── Feet on the floor ─────────────────────────────────────────────────── */

interface FootPlacement {
  heel: V3;
  ankle: V3;
  ball: V3;
  toe: V3;
  pitch: number;
}

const TOE_SEGMENT = FOOT_LENGTH - HEEL_TO_BALL;

/**
 * The toes hinge at the ball: with the heel up they stay flat on the floor
 * rather than following the foot down through it.
 */
function toeFromBall(ball: V3, pitch: number): V3 {
  const ballHeight = FOOT_Y - ball.y;
  const lowestPitch = Math.asin(
    Math.max(-1, Math.min(1, (TOE_TIP_HEIGHT - ballHeight) / TOE_SEGMENT)),
  );
  const toePitch = Math.max(pitch, lowestPitch);
  return v3(
    ball.x,
    ball.y - TOE_SEGMENT * Math.sin(toePitch),
    ball.z + TOE_SEGMENT * Math.cos(toePitch),
  );
}

/** A rigid foot at `pitch`, pivoting on its heel (`pivotOnBall` false) or its ball, which sits at `pivotZ` on the floor. */
function placeFoot(x: number, pivotZ: number, pitch: number, pivotOnBall: boolean): FootPlacement {
  const along = Math.cos(pitch);
  const rise = Math.sin(pitch);
  const pivotFromHeel = pivotOnBall ? HEEL_TO_BALL : 0;
  const point = (fromHeel: number, up: number): V3 => {
    const forward = fromHeel - pivotFromHeel;
    const z = pivotZ + forward * along - up * rise;
    const height = forward * rise + up * along;
    return v3(x, FOOT_Y - height, z);
  };
  const ball = point(HEEL_TO_BALL, 0);
  return {
    heel: point(0, 0),
    ankle: point(HEEL_TO_ANKLE, ANKLE_HEIGHT),
    ball,
    toe: toeFromBall(ball, pitch),
    pitch,
  };
}

/** A foot in the air, placed by its ankle and pitched about it. */
function footFromAnkle(ankle: V3, pitch: number): FootPlacement {
  const along = Math.cos(pitch);
  const rise = Math.sin(pitch);
  const point = (fromHeel: number, up: number): V3 => {
    const forward = fromHeel - HEEL_TO_ANKLE;
    const lift = up - ANKLE_HEIGHT;
    return v3(
      ankle.x,
      ankle.y - (forward * rise + lift * along),
      ankle.z + forward * along - lift * rise,
    );
  };
  const ball = point(HEEL_TO_BALL, 0);
  return { heel: point(0, 0), ankle, ball, toe: toeFromBall(ball, pitch), pitch };
}

function easeIn(t: number): number {
  return t * t;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** The heel's place on the floor at contact, chosen so the ankle passes under the hip on cue. */
function contactHeelZ(style: GaitStyle, stride: number): number {
  return stride * style.ankleUnderHipAt - HEEL_TO_ANKLE;
}

/** A planted foot `t` of the way through the cycle (`t` within the stance). */
function stanceFoot(style: GaitStyle, stride: number, t: number, x: number): FootPlacement {
  const heelAtContact = contactHeelZ(style, stride);
  const heelZ = heelAtContact - stride * t;
  if (t < style.footFlatAt) {
    const pitch = style.contactPitch * (1 - easeOutQuad(t / style.footFlatAt));
    return placeFoot(x, heelZ, pitch, false);
  }
  if (t < style.heelOffAt) return placeFoot(x, heelZ, 0, false);
  const rollShare = (t - style.heelOffAt) / (style.stance - style.heelOffAt);
  const pitch = -style.toeOffPitch * easeIn(rollShare);
  return placeFoot(x, heelZ + HEEL_TO_BALL, pitch, true);
}

/** Eased interpolation through a table of (swing share, foot pitch) keys. */
function keyedPitch(keys: ReadonlyArray<readonly [number, number]>, u: number): number {
  const first = keys[0];
  if (u <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1];
    const next = keys[i];
    if (u <= next[0])
      return lerp(prev[1], next[1], smoothstep((u - prev[0]) / (next[0] - prev[0])));
  }
  return keys[keys.length - 1][1];
}

interface LegPhase {
  foot: FootPlacement;
  swing: number;
  /** 0–1 progress through the swing; 0 while planted. */
  swingShare: number;
  planted: boolean;
}

function legPhase(style: GaitStyle, stride: number, t: number, side: BodySide): LegPhase {
  const lineX = side * style.footLineX;
  if (t < style.stance) {
    return { foot: stanceFoot(style, stride, t, lineX), swing: 0, swingShare: 0, planted: true };
  }
  const swingStart = style.stance;
  const u = (t - swingStart) / (1 - swingStart);
  const liftOff = stanceFoot(style, stride, swingStart, lineX);
  const nextContact = stanceFoot(style, stride, 0, lineX);
  // Planned on the floor rather than in her body: a foot leaves the floor and
  // arrives on it with no speed over the ground, which is what keeps it from
  // skating in at the end of the swing.
  const travelled = stride * (t - swingStart);
  const groundStart = liftOff.ankle.z;
  const groundEnd = nextContact.ankle.z + stride * (1 - swingStart);
  const groundZ = lerp(groundStart, groundEnd, smoothstep(u));
  const liftProgress =
    u < style.liftPeakAt
      ? (HALF * u) / style.liftPeakAt
      : HALF + (HALF * (u - style.liftPeakAt)) / (1 - style.liftPeakAt);
  const lift = style.swingLift * Math.sin(Math.PI * liftProgress) ** 2;
  const ankle = v3(
    lineX + side * style.swingClearanceX * Math.sin(Math.PI * u),
    lerp(liftOff.ankle.y, nextContact.ankle.y, smoothstep(u)) - lift,
    groundZ - travelled,
  );
  let pitch = keyedPitch(style.swingPitchKeys, u);
  let foot = footFromAnkle(ankle, pitch);
  // A heel that would scrape the floor tips the toes down until it clears, and a toe tips up.
  const heelHeight = FOOT_Y - foot.heel.y;
  if (heelHeight < 0) {
    pitch -= Math.asin(clamp01(-heelHeight / Math.hypot(HEEL_TO_ANKLE, ANKLE_HEIGHT)));
    foot = footFromAnkle(ankle, pitch);
  }
  return { foot, swing: Math.sin(Math.PI * u), swingShare: u, planted: false };
}

/** Two-bone solve with the knee bending forward, along her heading. */
function solveKnee(hip: V3, ankle: V3): V3 {
  const span = sub3(ankle, hip);
  const reach = Math.min(length3(span), LEG_LENGTH * STANCE_REACH);
  const dist = Math.max(length3(span), DEGENERATE_LENGTH);
  const along =
    (THIGH_LENGTH * THIGH_LENGTH - SHIN_LENGTH * SHIN_LENGTH + reach * reach) / (2 * reach);
  const out = Math.sqrt(Math.max(0, THIGH_LENGTH * THIGH_LENGTH - along * along));
  const axis = scale3(span, 1 / dist);
  // The bend direction is "forward" made perpendicular to the leg's axis.
  const forwardDot = axis.z;
  const bend = v3(-axis.x * forwardDot, -axis.y * forwardDot, 1 - axis.z * forwardDot);
  const bendLength = Math.max(length3(bend), DEGENERATE_LENGTH);
  const knee = add3(add3(hip, scale3(axis, along)), scale3(bend, out / bendLength));
  return knee;
}

function smoothMax(a: number, b: number, softness: number): number {
  return (a + b + Math.sqrt((a - b) * (a - b) + softness * softness)) / 2;
}

/** The lowest the hip may sit and still let a planted ankle be reached. */
function hipFloorFor(hip: V3, ankle: V3): number {
  const dx = ankle.x - hip.x;
  const dz = ankle.z - hip.z;
  const reach = LEG_LENGTH * STANCE_REACH;
  return ankle.y - Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz));
}

/* ── Arms ──────────────────────────────────────────────────────────────── */

interface ArmAngles {
  abduction: number;
  flex: number;
  elbowFlex: number;
  /** Extra outward turn of the forearm past the upper arm. */
  carry: number;
  wristFlex: number;
  open: number;
}

/**
 * Flexion swings the arm forward in the sagittal plane first, then abduction
 * swings that plane out to her side; taken the other way round, a raised arm
 * flexed "forward" would swing back over her shoulder.
 */
function armDirection(side: BodySide, abduction: number, flex: number): V3 {
  const sagittalDown = Math.cos(flex);
  return v3(
    side * sagittalDown * Math.sin(abduction),
    sagittalDown * Math.cos(abduction),
    Math.sin(flex),
  );
}

function solveArm(side: BodySide, rootShoulder: V3, a: ArmAngles): SignetArm {
  const upper = armDirection(side, a.abduction, a.flex);
  const shoulder = { ...rootShoulder, y: rootShoulder.y - SHOULDER_SHRUG * clamp01(-upper.y) };
  const elbow = add3(shoulder, scale3(upper, UPPER_ARM_LENGTH));
  const fore = armDirection(side, a.abduction + a.carry, a.flex + a.elbowFlex);
  const wrist = add3(elbow, scale3(fore, FOREARM_LENGTH));
  const hand = armDirection(side, a.abduction + a.carry, a.flex + a.elbowFlex + a.wristFlex);
  return {
    shoulder,
    elbow,
    wrist,
    fingertip: add3(wrist, scale3(hand, HAND_LENGTH)),
    open: a.open,
  };
}

function blendAngles(a: ArmAngles, b: ArmAngles, t: number): ArmAngles {
  return {
    abduction: lerp(a.abduction, b.abduction, t),
    flex: lerp(a.flex, b.flex, t),
    elbowFlex: lerp(a.elbowFlex, b.elbowFlex, t),
    carry: lerp(a.carry, b.carry, t),
    wristFlex: lerp(a.wristFlex, b.wristFlex, t),
    open: lerp(a.open, b.open, t),
  };
}

const REST_ARM: ArmAngles = {
  abduction: ARM_REST_ABDUCTION,
  flex: 0,
  elbowFlex: ELBOW_REST_FLEX,
  carry: CARRYING_ANGLE,
  wristFlex: WRIST_REST_FLEX,
  open: 0,
};

const CAST_WIND_UP: ArmAngles = {
  abduction: 45 * DEGREES,
  flex: -30 * DEGREES,
  elbowFlex: 148 * DEGREES,
  carry: 0,
  wristFlex: 25 * DEGREES,
  open: 0.4,
};
const CAST_THRUST: ArmAngles = {
  abduction: 30 * DEGREES,
  flex: 82 * DEGREES,
  elbowFlex: 6 * DEGREES,
  carry: 0,
  wristFlex: -14 * DEGREES,
  open: 1,
};
const CAST_OFF_WIND_UP: ArmAngles = {
  ...REST_ARM,
  abduction: 16 * DEGREES,
  flex: 22 * DEGREES,
  elbowFlex: 30 * DEGREES,
};
const CAST_OFF_THRUST: ArmAngles = {
  ...REST_ARM,
  abduction: 14 * DEGREES,
  flex: -24 * DEGREES,
  elbowFlex: 16 * DEGREES,
};
/** Head-on the throw goes out a little to her side of the camera, so the arm keeps its length on screen. */
const CAST_THRUST_HEAD_ON: ArmAngles = {
  ...CAST_THRUST,
  abduction: 55 * DEGREES,
  flex: 60 * DEGREES,
};

function castKeys(thrust: ArmAngles): ReadonlyArray<CastKey> {
  return [
    { at: 0, arm: REST_ARM, offArm: REST_ARM, chestYaw: 0, lean: 0 },
    {
      at: 0.3,
      arm: CAST_WIND_UP,
      offArm: CAST_OFF_WIND_UP,
      chestYaw: -14 * DEGREES,
      lean: -3 * DEGREES,
    },
    { at: 0.5, arm: thrust, offArm: CAST_OFF_THRUST, chestYaw: 13 * DEGREES, lean: 5 * DEGREES },
    { at: 0.64, arm: thrust, offArm: CAST_OFF_THRUST, chestYaw: 11 * DEGREES, lean: 4 * DEGREES },
    { at: 1, arm: REST_ARM, offArm: REST_ARM, chestYaw: 0, lean: 0 },
  ];
}
const CAST_KEYS_PROFILE = castKeys(CAST_THRUST);
const CAST_KEYS_HEAD_ON = castKeys(CAST_THRUST_HEAD_ON);

interface CastPose {
  arm: ArmAngles;
  offArm: ArmAngles;
  chestYaw: number;
  lean: number;
  /** How much of the cast is in the body at all: 0 at either end, 1 through the throw. */
  envelope: number;
}

function castPose(progress: number, profile: boolean): CastPose {
  const keys = profile ? CAST_KEYS_PROFILE : CAST_KEYS_HEAD_ON;
  const p = clamp01(progress);
  let i = 1;
  while (i < keys.length - 1 && p > keys[i].at) i++;
  const from = keys[i - 1];
  const to = keys[i];
  const t = smoothstep((p - from.at) / (to.at - from.at));
  const first = keys[1].at;
  const last = keys[keys.length - 2].at;
  const envelope =
    p <= first ? smoothstep(p / first) : p >= last ? 1 - smoothstep((p - last) / (1 - last)) : 1;
  return {
    arm: blendAngles(from.arm, to.arm, t),
    offArm: blendAngles(from.offArm, to.offArm, t),
    chestYaw: lerp(from.chestYaw, to.chestYaw, t),
    lean: lerp(from.lean, to.lean, t),
    envelope: progress > 0 ? envelope : 0,
  };
}

function summonEnvelope(progress: number): number {
  if (progress <= 0) return 0;
  if (progress < SUMMON_RISE_SHARE) return smoothstep(progress / SUMMON_RISE_SHARE);
  if (progress > SUMMON_FALL_START)
    return 1 - smoothstep((progress - SUMMON_FALL_START) / (1 - SUMMON_FALL_START));
  return 1;
}

/* ── The solve ─────────────────────────────────────────────────────────── */

export interface SkeletonInput {
  /** Gait phase in radians; the right heel strikes at 0. */
  walkPhase: number;
  /** 0 standing still to 1 fully in stride. */
  locomotion: number;
  speedTilesPerSecond: number;
  /** 0–1 progress through each gesture, unshaped: the skeleton times its own keys. */
  castProgress: number;
  summonProgress: number;
  timeSec: number;
  /**
   * Whether she is drawn in profile. A gesture is staged for the view it is
   * seen in: an arm flung out to her side reads head-on and vanishes into her
   * head in profile, and one driven straight at the target reads in profile
   * and collapses to a stub head-on.
   */
  profile: boolean;
}

interface BodyPose {
  legs: Record<BodySide, SignetLeg>;
  pelvis: SectionFrame;
  chest: SectionFrame;
  armAngles: Record<BodySide, ArmAngles>;
  headRoll: number;
  hairSway: number;
  hairLift: number;
}

function frame(partial: Partial<SectionFrame>): SectionFrame {
  return { x: 0, y: 0, z: 0, roll: 0, yaw: 0, pitch: 0, ...partial };
}

function hipJointOf(pelvis: SectionFrame, side: BodySide): V3 {
  return placeInSection(pelvis, PELVIS_PIVOT_Y, v3(side * HIP_JOINT_X, HIP_JOINT_Y, 0));
}

function buildLeg(hip: V3, foot: FootPlacement, swing: number): SignetLeg {
  return {
    hip,
    knee: solveKnee(hip, foot.ankle),
    ankle: foot.ankle,
    heel: foot.heel,
    ball: foot.ball,
    toe: foot.toe,
    pitch: foot.pitch,
    swing,
  };
}

function gaitPose(style: GaitStyle, stride: number, phase: number, vigor: number): BodyPose {
  const t = wrap01(phase / TWO_PI);
  const phases: Record<BodySide, LegPhase> = {
    [1]: legPhase(style, stride, t, 1),
    [-1]: legPhase(style, stride, wrap01(t + HALF), -1),
  };
  // Which leg carries her: +1 over the right foot at its mid-stance.
  const midStance = style.stance / 2;
  const weight = Math.cos(TWO_PI * (t - midStance));
  const reach = Math.cos(TWO_PI * t);

  const pelvisBase = frame({
    x: style.pelvisShift * weight,
    roll: -style.pelvisRoll * weight,
    yaw: style.pelvisYaw * reach,
    pitch: style.lean * PELVIS_LEAN_SHARE,
  });

  // Each planted leg asks for the pelvis to be low enough for it to reach its
  // ankle. A leg in the air is weighed in gradually — as it leaves the floor and
  // as its heel arrives — so the pelvis eases off one support and onto the next
  // instead of stepping between them.
  const firm: number[] = [];
  const easing: Array<{ ask: number; hold: number }> = [];
  for (const side of SIDES) {
    const phase = phases[side];
    const restHip = hipJointOf(pelvisBase, side);
    const ask = hipFloorFor(restHip, phase.foot.ankle) - restHip.y;
    if (phase.planted) {
      firm.push(ask);
      continue;
    }
    const landing = smoothstep(
      (phase.swingShare - (1 - CONTACT_ANTICIPATION)) / CONTACT_ANTICIPATION,
    );
    const releasing = 1 - smoothstep(phase.swingShare / LIFT_OFF_RELEASE);
    const hold = Math.max(landing, releasing);
    if (hold > 0) easing.push({ ask, hold });
  }
  const bounce = Math.cos(TWO_PI * (wrap01(t * 2) - midStance * 2));
  if (style.springyPelvis) {
    // A run's pelvis is driven as well as reached for: it sinks into each
    // stance as the leg loads and rides up through the flight.
    firm.push(RUN_PELVIS_BASE_DROP + RUN_PELVIS_DIP * (1 + bounce));
  }
  let hipY = firm.length > 0 ? firm.reduce((a, b) => smoothMax(a, b, PELVIS_CUSP_SOFTNESS)) : 0;
  for (const { ask, hold } of easing) {
    hipY = lerp(hipY, smoothMax(hipY, ask, PELVIS_CUSP_SOFTNESS), hold);
  }
  const pelvis = { ...pelvisBase, y: hipY };

  const legs: Record<BodySide, SignetLeg> = {
    [1]: buildLeg(hipJointOf(pelvis, 1), phases[1].foot, phases[1].swing),
    [-1]: buildLeg(hipJointOf(pelvis, -1), phases[-1].foot, phases[-1].swing),
  };

  const chest = frame({
    x: pelvis.x * CHEST_FOLLOWS_PELVIS_SHIFT,
    y: pelvis.y,
    z: pelvis.z,
    roll: style.chestRoll * weight,
    yaw: -style.chestYaw * reach,
    pitch: style.lean,
  });

  const swingArm = (side: BodySide): ArmAngles => {
    // Each arm comes forward with the opposite leg.
    const forward = -side * Math.cos(phase - style.armLag) * lerp(SAUNTER_ARM_SHARE, 1, vigor);
    const swingAngle = forward > 0 ? forward * style.armForward : forward * style.armBack;
    const forwardShare = Math.max(0, forward);
    return {
      abduction: ARM_REST_ABDUCTION - style.armInward * forwardShare,
      flex: swingAngle,
      elbowFlex: style.elbowBase + style.elbowForwardFold * forwardShare,
      carry: CARRYING_ANGLE * (1 - forwardShare * FORWARD_CARRY_RELEASE),
      wristFlex: style.wristFlex,
      open: 0,
    };
  };
  const armAngles: Record<BodySide, ArmAngles> = { [1]: swingArm(1), [-1]: swingArm(-1) };

  const hairSway =
    -HAIR_SWAY_GAIN * style.pelvisShift * Math.cos(TWO_PI * (t - midStance) - HAIR_SWAY_LAG);
  const hairLift =
    style.hairBounce * Math.cos(TWO_PI * (wrap01(t * 2) - midStance * 2) - HAIR_LIFT_LAG);
  return {
    legs,
    pelvis,
    chest,
    armAngles,
    headRoll: -chest.roll * HEAD_LEVELLING,
    hairSway,
    hairLift,
  };
}

function idlePose(timeSec: number, cast: number): BodyPose {
  const drift = Math.sin((TWO_PI * timeSec) / IDLE_WEIGHT_PERIOD_SECONDS);
  const idleWeight = IDLE_WEIGHT + IDLE_WEIGHT_DRIFT * drift;
  const weight = lerp(idleWeight, CAST_WEIGHT, cast);
  const stanceSide: BodySide = weight >= 0 ? 1 : -1;
  const load = Math.abs(weight);

  const pelvis0 = frame({
    x: IDLE_PELVIS_SHIFT * weight,
    roll: -IDLE_PELVIS_ROLL * weight,
  });
  const feet: Record<BodySide, FootPlacement> = {
    [1]: placeFoot(0, 0, 0, false),
    [-1]: placeFoot(0, 0, 0, false),
  };
  for (const side of SIDES) {
    const free = side !== stanceSide ? load : 0;
    const x = side * lerp(IDLE_STANCE_FOOT_X, IDLE_FREE_FOOT_X, free);
    feet[side] = placeFoot(x, -HEEL_TO_ANKLE + IDLE_FREE_FOOT_AHEAD * free, 0, false);
  }
  const stanceHip = hipJointOf(pelvis0, stanceSide);
  const hipY = hipFloorFor(stanceHip, feet[stanceSide].ankle) - stanceHip.y;
  const pelvis = { ...pelvis0, y: hipY };

  const legs: Record<BodySide, SignetLeg> = {
    [1]: buildLeg(hipJointOf(pelvis, 1), feet[1], 0),
    [-1]: buildLeg(hipJointOf(pelvis, -1), feet[-1], 0),
  };
  const chest = frame({
    x: pelvis.x * IDLE_CHEST_FOLLOWS_PELVIS_SHIFT,
    y: pelvis.y,
    roll: IDLE_CHEST_ROLL * weight,
  });
  return {
    legs,
    pelvis,
    chest,
    armAngles: { [1]: REST_ARM, [-1]: REST_ARM },
    headRoll: -IDLE_HEAD_ROLL * weight,
    hairSway: 0,
    hairLift: 0,
  };
}

function blendLeg(a: SignetLeg, b: SignetLeg, t: number): SignetLeg {
  const hip = lerp3(a.hip, b.hip, t);
  const ankle = lerp3(a.ankle, b.ankle, t);
  return {
    hip,
    knee: solveKnee(hip, ankle),
    ankle,
    heel: lerp3(a.heel, b.heel, t),
    ball: lerp3(a.ball, b.ball, t),
    toe: lerp3(a.toe, b.toe, t),
    pitch: lerp(a.pitch, b.pitch, t),
    swing: lerp(a.swing, b.swing, t),
  };
}

function blendFrame(a: SectionFrame, b: SectionFrame, t: number): SectionFrame {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    roll: lerp(a.roll, b.roll, t),
    yaw: lerp(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
  };
}

function blendPose(a: BodyPose, b: BodyPose, t: number): BodyPose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    legs: { [1]: blendLeg(a.legs[1], b.legs[1], t), [-1]: blendLeg(a.legs[-1], b.legs[-1], t) },
    pelvis: blendFrame(a.pelvis, b.pelvis, t),
    chest: blendFrame(a.chest, b.chest, t),
    armAngles: {
      [1]: blendAngles(a.armAngles[1], b.armAngles[1], t),
      [-1]: blendAngles(a.armAngles[-1], b.armAngles[-1], t),
    },
    headRoll: lerp(a.headRoll, b.headRoll, t),
    hairSway: lerp(a.hairSway, b.hairSway, t),
    hairLift: lerp(a.hairLift, b.hairLift, t),
  };
}

export function solveSignetSkeleton(input: SkeletonInput): SignetSkeleton {
  const { walkPhase, locomotion, speedTilesPerSecond, timeSec } = input;
  const thrown = castPose(input.castProgress, input.profile);
  const cast = thrown.envelope;
  const summon = summonEnvelope(input.summonProgress) * (1 - cast);
  const strideFu = signetStrideTiles(speedTilesPerSecond) / FIGURE_SCALE;
  const runBlend = signetRunBlend(speedTilesPerSecond);

  let moving: BodyPose | null = null;
  if (locomotion > 0) {
    const vigor = clamp01(
      (speedTilesPerSecond - SLOW_WALK_TILES_PER_SECOND) /
        (BRISK_WALK_TILES_PER_SECOND - SLOW_WALK_TILES_PER_SECOND),
    );
    const walk = runBlend < 1 ? gaitPose(WALK_STYLE, strideFu, walkPhase, vigor) : null;
    const run = runBlend > 0 ? gaitPose(RUN_STYLE, strideFu, walkPhase, 1) : null;
    if (walk !== null && run !== null) moving = blendPose(walk, run, runBlend);
    else moving = walk ?? run;
  }
  const gesture = Math.max(cast, summon);
  const standing = idlePose(timeSec, cast);
  // Eased at both ends, so she settles into a stance rather than stopping on a line.
  const body = moving === null ? standing : blendPose(standing, moving, smoothstep(locomotion));

  const breathWave = Math.sin((TWO_PI * timeSec) / BREATH_PERIOD_SECONDS);
  const breath = (1 + breathWave) / 2;
  const chest = {
    ...body.chest,
    y: body.chest.y - BREATH_CHEST_RISE * breath * (1 - locomotion) - SUMMON_CHEST_LIFT * summon,
    yaw: body.chest.yaw + thrown.chestYaw * cast,
    pitch: body.chest.pitch + thrown.lean * cast,
  };

  const solveSide = (side: BodySide): SignetArm => {
    const shoulder = placeInSection(chest, CHEST_PIVOT_Y, v3(side * ARM_ROOT_X, ARM_ROOT_Y, 0));
    let angles = body.armAngles[side];
    angles = {
      ...angles,
      abduction: angles.abduction + BREATH_ARM_SWAY * breath * (1 - locomotion),
    };
    const castAngles = side > 0 ? thrown.arm : thrown.offArm;
    const summonAngles: ArmAngles = {
      abduction: input.profile ? SUMMON_PROFILE_ABDUCTION : SUMMON_ARM_ABDUCTION,
      flex: input.profile
        ? SUMMON_PROFILE_FLEX + (side < 0 ? SUMMON_PROFILE_FAR_ARM_RAISE : 0)
        : SUMMON_ARM_FLEX,
      elbowFlex: SUMMON_ELBOW_FLEX,
      carry: 0,
      wristFlex: -WRIST_REST_FLEX,
      open: 1,
    };
    angles = blendAngles(angles, castAngles, cast);
    angles = blendAngles(angles, summonAngles, summon);
    return solveArm(side, shoulder, angles);
  };
  const arms: Record<BodySide, SignetArm> = { [1]: solveSide(1), [-1]: solveSide(-1) };

  const idleHair = IDLE_HAIR_DRIFT * Math.sin((TWO_PI * timeSec) / IDLE_HAIR_PERIOD_SECONDS);
  const speedShare = clamp01(speedTilesPerSecond / FULL_SPEED_TILES_PER_SECOND) * locomotion;
  return {
    legs: body.legs,
    arms,
    pelvis: body.pelvis,
    chest,
    headRoll: body.headRoll * (1 - gesture),
    headPitch: SUMMON_HEAD_PITCH * summon,
    breath,
    hairSway: body.hairSway + idleHair * (1 - locomotion),
    hairTrail: HAIR_TRAIL_AT_FULL_SPEED * speedShare,
    hairLift: body.hairLift,
  };
}

/* ── Projection ────────────────────────────────────────────────────────── */

export interface Pt2 {
  x: number;
  y: number;
}

/**
 * Head-on, a point's distance ahead of her draws as a little screen height —
 * the floor's share near the ground, nothing at the hip — because the floor is
 * seen from above while she stands as if seen level (see the biped rig's `depthShareAt`).
 */
function depthShare(y: number): number {
  return HEAD_ON_FLOOR_FORESHORTENING * clamp01((y - HIP_JOINT_Y) / (ANKLE_Y - HIP_JOINT_Y));
}

export function project(view: SignetView, p: V3): Pt2 {
  if (view === 'side') return { x: p.z, y: p.y };
  const depth = p.z * depthShare(p.y);
  return { x: p.x, y: view === 'front' ? p.y + depth : p.y - depth };
}

/** Exposed for the rest pose's own geometry: a standing ankle's lateral place. */
export const STANDING_ANKLE_X = ANKLE_REST_X;

function mirrorPoint(p: V3): V3 {
  return v3(-p.x, p.y, p.z);
}

function mirrorFrame(f: SectionFrame): SectionFrame {
  return { ...f, x: -f.x, roll: -f.roll, yaw: -f.yaw };
}

/**
 * The skeleton seen from in front: her right side on the viewer's left. The
 * solve is authored as seen from behind, where her right is the viewer's
 * right; mirroring it here keeps a right-handed throw in her right hand and
 * the shark on her right thigh whichever way she faces.
 */
export function mirrorSkeleton(s: SignetSkeleton): SignetSkeleton {
  const leg = (l: SignetLeg): SignetLeg => ({
    ...l,
    hip: mirrorPoint(l.hip),
    knee: mirrorPoint(l.knee),
    ankle: mirrorPoint(l.ankle),
    heel: mirrorPoint(l.heel),
    ball: mirrorPoint(l.ball),
    toe: mirrorPoint(l.toe),
  });
  const arm = (a: SignetArm): SignetArm => ({
    ...a,
    shoulder: mirrorPoint(a.shoulder),
    elbow: mirrorPoint(a.elbow),
    wrist: mirrorPoint(a.wrist),
    fingertip: mirrorPoint(a.fingertip),
  });
  return {
    ...s,
    legs: { [1]: leg(s.legs[-1]), [-1]: leg(s.legs[1]) },
    arms: { [1]: arm(s.arms[-1]), [-1]: arm(s.arms[1]) },
    pelvis: mirrorFrame(s.pelvis),
    chest: mirrorFrame(s.chest),
    headRoll: -s.headRoll,
    hairSway: -s.hairSway,
  };
}
