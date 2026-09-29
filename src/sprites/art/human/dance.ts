/**
 * The Desperado Club's dance routines on Carl's rig: the same three the
 * skyfowl dancers do (`../danceStyles.ts`), so a mixed floor dances one
 * vocabulary.
 *
 * Hands are placed by where they go — overhead, out to the side, on the hip —
 * and the rig's arm solve reaches for them, rather than borrowing the walk's
 * arm swing: a swing sized for walking tops out at the chest, and every hand
 * on a dance floor is going over the head. Every routine sinks deep into the
 * knees on the beat; the feet are planted targets the leg solve holds while
 * the hips drop, sway and hop over them.
 */

import {
  VIEWS,
  buildSkeleton,
  restingPose,
  setArmAngles,
  type BodySide,
  type CarlPose,
} from '../carl/rig';
import type { Pt } from '../carlArt';
import { FOREARM_LENGTH, UPPER_ARM_LENGTH } from '../carl/proportions';
import { deg, hump, lerp } from '../carlArt';
import { pt, TWO_PI } from '../carl/geometry';
import { anglesThrough, splineKeys, type PathKey } from './gaitShared';
import { IDLE_SIDE_FOOT_LEAD } from './idles';
import {
  DANCE_FRAMES,
  barPhase,
  beatIndex,
  beatPhase,
  danceFacingAt,
  type DanceFacing,
  type DanceStyle,
} from '../danceStyles';

// Hand placements, as offsets from the arm's own shoulder joint in figure
// units, +X outward from his centreline and +Y down. Measured from the
// shoulder, not the floor, so a hand held overhead stays overhead however
// deep the knees sink under it.
const HAND_OVERHEAD = pt(-0.03, -0.63);
/** On the dip the fists pump down to just over the head, elbows bent out. */
const HAND_PUMPED = pt(0.02, -0.42);
const HAND_ON_HIP = pt(-0.05, 0.47);
const HAND_OUT = pt(0.6, 0.06);
const HAND_HIGH_V = pt(0.22, -0.58);
/** Profile: arms spread toward and away from the camera show as one hand forward, one back. */
const PROFILE_HAND_FORE_X = 0.46;
const PROFILE_HAND_AFT_X = -0.4;
const PROFILE_HAND_OUT_Y = -1.52;
const PROFILE_HAND_HIGH_Y = -1.98;

/** A straight arm is never asked for its whole length: a locked elbow is a hyper-extended one. */
const ARM_REACH_SHARE = 0.985;
/**
 * When choosing which side of the shoulder-to-hand line the elbow breaks to,
 * how much a lower elbow counts against an outward one: an arm held out to
 * the side hangs its elbow, an arm raised or set on the hip throws it wide.
 */
const ELBOW_DOWN_WEIGHT = 0.5;

/**
 * Poses one arm by its joints so the hand lands `offset` from its shoulder
 * with the elbow thrown outward. The rig's own solve from a hand target
 * breaks a head-on elbow inward, which for a hand over the head folds the
 * forearm across the face — hands on the head, not in the air.
 */
function placeHand(pose: CarlPose, side: BodySide, offset: Pt): void {
  const skeleton = buildSkeleton(pose, VIEWS.back);
  const root = side === 'left' ? skeleton.leftArm.root : skeleton.rightArm.root;
  const outward = side === 'left' ? -1 : 1;
  const target = pt(root.x + offset.x * outward, root.y + offset.y);
  const toX = target.x - root.x;
  const toY = target.y - root.y;
  const distance = Math.max(Math.hypot(toX, toY), Number.EPSILON);
  const span = Math.min(distance, (UPPER_ARM_LENGTH + FOREARM_LENGTH) * ARM_REACH_SHARE);
  const unitX = toX / distance;
  const unitY = toY / distance;
  const along = (UPPER_ARM_LENGTH ** 2 - FOREARM_LENGTH ** 2 + span * span) / (2 * span);
  const across = Math.sqrt(Math.max(0, UPPER_ARM_LENGTH ** 2 - along * along));
  const score = (x: number, y: number): number => x * outward + y * ELBOW_DOWN_WEIGHT;
  const flip = score(-unitY, unitX) >= score(unitY, -unitX) ? 1 : -1;
  const elbow = pt(
    root.x + unitX * along - unitY * across * flip,
    root.y + unitY * along + unitX * across * flip,
  );
  const wrist = pt(root.x + unitX * span, root.y + unitY * span);
  setArmAngles(pose, side, anglesThrough(root, elbow, wrist));
  if (side === 'left') pose.leftHand = wrist;
  else pose.rightHand = wrist;
}

function mixOffset(from: Pt, to: Pt, t: number): Pt {
  return pt(lerp(from.x, to.x, t), lerp(from.y, to.y, t));
}

const FEET_APART = 0.17;
const KNEE_TOWARD_CAMERA = 0.75;
const FIST_CLOSED = 0.85;
const HAND_OPEN = 0.1;

/** 1 on the beat, 0 half a beat later: the knee bounce every routine rides. */
function onBeat(frame: number): number {
  return 0.5 + 0.5 * Math.cos(beatPhase(frame) * TWO_PI);
}

/** A dancer's face is open, not Carl's scowl: brow relaxed, lips parted. */
const DANCE_BROW = 0.1;
const DANCE_MOUTH = 0.25;
const DANCE_ELBOW_FLARE = 0.6;

function base(): CarlPose {
  const pose = restingPose();
  pose.brow = DANCE_BROW;
  pose.mouth = DANCE_MOUTH;
  pose.leftArmAngles = null;
  pose.rightArmAngles = null;
  pose.elbowFlare = DANCE_ELBOW_FLARE;
  pose.leftFoot = pt(-FEET_APART, 0);
  pose.rightFoot = pt(FEET_APART, 0);
  // Knees driven toward the camera rather than bowed out: head-on a bounce
  // then reads as the legs shortening under the body, not as a squat.
  pose.leftForeshorten = KNEE_TOWARD_CAMERA;
  pose.rightForeshorten = KNEE_TOWARD_CAMERA;
  return pose;
}

// ── Pump: hands in the air ──────────────────────────────────────────────────

const PUMP_HOP_FROM = 0.25;
const PUMP_HOP_SPAN = 0.5;
const PUMP_HOP_HEIGHT = 0.13;
const PUMP_DIP = 0.32;
const PUMP_SWAY = 0.06;
const PUMP_LEAN = deg(5);
const PUMP_HEAD_TILT = deg(10);
const PUMP_MOUTH = 0.3;
/** The mouth opens further on the hop — a whoop. */
const PUMP_WHOOP = 0.4;
const PUMP_HEM_FLARE = 0.6;
const PUMP_HAIR_SWING = 0.6;

function pumpHop(frame: number): number {
  const t = (beatPhase(frame) - PUMP_HOP_FROM) / PUMP_HOP_SPAN;
  return t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t);
}

/**
 * Both fists up over the head, pumping down on the beat as the knees sink and
 * punching back up on the hop between beats; the hips swing across the bar
 * and the head rocks with them.
 */
function pumpPose(frame: number): CarlPose {
  const pose = base();
  const dip = onBeat(frame);
  const hop = pumpHop(frame);
  const rise = hop * PUMP_HOP_HEIGHT;
  const bar = barPhase(frame) * TWO_PI;
  pose.crouch = PUMP_DIP * dip;
  pose.bob = -rise;
  pose.sway = Math.sin(bar) * PUMP_SWAY;
  pose.lean = -Math.sin(bar) * PUMP_LEAN;
  pose.headTilt = Math.sin(bar) * PUMP_HEAD_TILT;
  pose.mouth = PUMP_MOUTH + hop * PUMP_WHOOP;
  pose.leftFoot = pt(-FEET_APART, -rise);
  pose.rightFoot = pt(FEET_APART, -rise);
  const fists = mixOffset(HAND_PUMPED, HAND_OVERHEAD, 1 - dip);
  placeHand(pose, 'left', fists);
  placeHand(pose, 'right', fists);
  pose.leftFist = FIST_CLOSED;
  pose.rightFist = FIST_CLOSED;
  pose.leftFootPoint = hop;
  pose.rightFootPoint = hop;
  pose.jacketFlare = hop * PUMP_HEM_FLARE;
  pose.hairFlow = Math.sin(bar) * PUMP_HAIR_SWING;
  return pose;
}

// ── Shimmy: step-touch with a disco point ───────────────────────────────────

const SHIMMY_SWAY = 0.11;
const SHIMMY_LEAN = deg(6);
const SHIMMY_TWIST = 0.45;
const SHIMMY_DIP = 0.18;
const SHIMMY_TAP_LIFT = 0.07;
const SHIMMY_STEP_WIDTH = 0.22;
const SHIMMY_HEAD_TURN = 0.3;
const SHIMMY_HEAD_TILT = deg(8);
const SHIMMY_HEM_FLARE = 0.4;
const SHIMMY_HAIR_SWING = 0.8;
/**
 * The point peaks a quarter-beat after the dip, on the upbeat: pointed at the
 * bottom of the knee bend the hand is dragged down with the body and barely
 * clears the head.
 */
const POINT_LEAD = Math.PI / 2;
/**
 * The pointing hand's path from the hip to overhead and back runs out round
 * the side of the body: a straight line between the two crosses the chest,
 * and two arms passing there at once read as arms folded.
 */
const POINT_PATH_X: readonly PathKey[] = [
  [0, HAND_ON_HIP.x],
  [0.5, HAND_OUT.x],
  [1, HAND_OVERHEAD.x],
];
const POINT_PATH_Y: readonly PathKey[] = [
  [0, HAND_ON_HIP.y],
  [0.5, HAND_OUT.y],
  [1, HAND_OVERHEAD.y],
];

/**
 * The weight swings onto one foot a beat while the other taps beside it, the
 * hips throw wide with the shoulders leaning back over them and shaking on
 * the beat, and one hand points up at the ceiling while the other rests on
 * the hip — trading on the next beat.
 */
function shimmyPose(frame: number): CarlPose {
  const pose = base();
  const dip = onBeat(frame);
  const bar = barPhase(frame) * TWO_PI;
  const toward = Math.cos(bar);
  const tap = hump(beatPhase(frame)) * SHIMMY_TAP_LIFT;
  const rightTaps = beatIndex(frame) === 0;
  const rightRaise = 0.5 - 0.5 * Math.cos(bar - POINT_LEAD);
  pose.crouch = SHIMMY_DIP * dip;
  pose.sway = -toward * SHIMMY_SWAY;
  pose.lean = toward * SHIMMY_LEAN;
  pose.twist = Math.sin(beatPhase(frame) * TWO_PI) * SHIMMY_TWIST;
  pose.headTilt = toward * SHIMMY_HEAD_TILT;
  pose.headTurn = -toward * SHIMMY_HEAD_TURN;
  const pointing = (raise: number): Pt =>
    pt(splineKeys(raise, POINT_PATH_X), splineKeys(raise, POINT_PATH_Y));
  pose.rightFist = lerp(HAND_OPEN, FIST_CLOSED, rightRaise);
  pose.leftFist = lerp(HAND_OPEN, FIST_CLOSED, 1 - rightRaise);
  pose.leftFoot = pt(-SHIMMY_STEP_WIDTH, rightTaps ? 0 : -tap);
  pose.rightFoot = pt(SHIMMY_STEP_WIDTH, rightTaps ? -tap : 0);
  pose.leftFootPoint = rightTaps ? 0 : tap / SHIMMY_TAP_LIFT;
  pose.rightFootPoint = rightTaps ? tap / SHIMMY_TAP_LIFT : 0;
  placeHand(pose, 'right', pointing(rightRaise));
  placeHand(pose, 'left', pointing(1 - rightRaise));
  pose.jacketFlare = Math.abs(toward) * SHIMMY_HEM_FLARE;
  pose.hairFlow = -toward * SHIMMY_HAIR_SWING;
  return pose;
}

// ── Spin ─────────────────────────────────────────────────────────────────────

/** Knee bend through the bar: loading on the first beat, rising into the turn, landing on the wrap. */
const SPIN_CROUCH: readonly PathKey[] = [
  [-2, 0.18],
  [0, 0.34],
  [3, 0.08],
  [6, 0.28],
  [8, 0.12],
  [11, 0.02],
  [14, 0.18],
  [16, 0.34],
  [19, 0.08],
];
/** How far the arms have swept from straight out to the high V, through the bar. */
const SPIN_ARMS_UP: readonly PathKey[] = [
  [-2, 1],
  [0, 0],
  [7, 0],
  [9, 1],
  [13, 1],
  [16, 0],
  [23, 0],
];
const SPIN_SWAY = 0.05;
const SPIN_PIVOT_LIFT = 0.05;
/** Through the first beat the hips rock twice: once a half-beat. */
const SPIN_ROCKS_PER_BAR = 2;
const SPIN_HEAD_ROCK = deg(8);
const SPIN_MOUTH = 0.4;
/** The skirt swings out full in the turn and only a little on the bounce. */
const SPIN_HEM_FLARE_TURNING = 1;
const SPIN_HEM_FLARE_BOUNCING = 0.2;
const SPIN_HAIR_SWING = 1;
/** Feet drawn in under the hips to turn on. */
const SPIN_FEET_SHARE = 0.6;
const SPIN_PROFILE_FEET_SHARE = 0.5;
/** The pivot foot's heel lifts in profile as it turns on the ball. */
const SPIN_PIVOT_PITCH = deg(35);
/** The last frames of the bar land out of the turn, still on the pivot foot. */
const SPIN_LANDING_FRAMES = 2;

/**
 * Loads on the first beat with the arms straight out and the hips rocking,
 * then turns a full circle on the ball of one foot on the second, arms swept
 * up and the skirt flaring, landing facing the camera into the next dip.
 */
function spinPose(frame: number, facing: DanceFacing): CarlPose {
  const pose = base();
  const armsUp = Math.min(1, Math.max(0, splineKeys(frame, SPIN_ARMS_UP)));
  const turning = facing !== 'down' || frame >= DANCE_FRAMES - SPIN_LANDING_FRAMES;
  const rock = Math.sin(barPhase(frame) * TWO_PI * SPIN_ROCKS_PER_BAR);
  pose.crouch = splineKeys(frame, SPIN_CROUCH);
  pose.sway = turning ? 0 : rock * SPIN_SWAY;
  pose.headTilt = turning ? 0 : rock * SPIN_HEAD_ROCK;
  pose.mouth = SPIN_MOUTH;
  pose.leftFist = HAND_OPEN;
  pose.rightFist = HAND_OPEN;
  pose.jacketFlare = turning ? SPIN_HEM_FLARE_TURNING : SPIN_HEM_FLARE_BOUNCING;
  pose.hairFlow = turning ? SPIN_HAIR_SWING : 0;
  if (facing === 'left' || facing === 'right') {
    const handY = lerp(PROFILE_HAND_OUT_Y, PROFILE_HAND_HIGH_Y, armsUp);
    pose.rightHand = pt(PROFILE_HAND_FORE_X, handY);
    pose.leftHand = pt(PROFILE_HAND_AFT_X, handY);
    pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD * SPIN_PROFILE_FEET_SHARE, 0);
    pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD * SPIN_PROFILE_FEET_SHARE, -SPIN_PIVOT_LIFT);
    pose.rightFootPitch = SPIN_PIVOT_PITCH;
    return pose;
  }
  pose.leftFoot = pt(-FEET_APART * SPIN_FEET_SHARE, 0);
  pose.rightFoot = pt(FEET_APART * SPIN_FEET_SHARE, turning ? -SPIN_PIVOT_LIFT : 0);
  pose.rightFootPoint = turning ? 1 : 0;
  const hands = mixOffset(HAND_OUT, HAND_HIGH_V, armsUp);
  placeHand(pose, 'left', hands);
  placeHand(pose, 'right', hands);
  return pose;
}

/** One frame of a routine, posed for the facing the routine is in on that frame. */
export function dancePose(style: DanceStyle, frame: number): CarlPose {
  if (style === 'pump') return pumpPose(frame);
  if (style === 'shimmy') return shimmyPose(frame);
  return spinPose(frame, danceFacingAt(style, frame));
}
