/**
 * Dong Quixote's choreography and his `FigureDef`.
 *
 * Every row is authored once, as a pose of the three-dimensional rig, and
 * painted in all three views by projection: the front view is his front, not
 * his profile flipped, and the away view his back. A row therefore cannot
 * drift out of step between views, and the lance stays in his right hand
 * whichever way he faces.
 *
 * The gait is Carl's structure, re-derived for a taller, longer-legged man:
 * the stance foot slides back at exactly the ground the stride covers, the
 * pelvis rides the lower of the two stance legs' reach arcs rather than a
 * keyed bob, and the free arm swings from its shoulder by its joint angles,
 * back on the same side as the foot striking the floor.
 */

import { clamp01, easeInOut, lerp } from './carlArt';
import {
  ANKLE_HEIGHT,
  type ArmAngles,
  type ArmPose,
  type DongPose,
  type DongView,
  type FootPose,
  HIP_HEIGHT,
  LANCE_LENGTH,
  LEG_MAX_REACH,
  STANCE_HALF,
  UPRIGHT_CARRY_HAND,
  UPRIGHT_GRIP_ALONG,
  UPRIGHT_LANCE_DIR,
  type V3,
  add3,
  ankleOverPivot,
  drawDongQuixote,
  mix3,
  normalize3,
  restingPose,
  scale3,
  sub3,
  v3,
} from './dongQuixoteArt';
import { figureStates, type FigureDef } from '../figure/figureDef';
import {
  DONG_CHARGE_FRAMES,
  DONG_CHARGE_RECOVER_FRAMES,
  DONG_DEATH_CORPSE_FRAME,
  DONG_DEATH_FAREWELL_FRAME,
  DONG_CHARGE_WINDUP_FRAMES,
  DONG_DEATH_FRAMES,
  DONG_HURT_FRAMES,
  DONG_IDLE_FRAMES,
  DONG_SALUTE_FRAMES,
  DONG_SALUTE_RAISED_FRAME,
  DONG_THRUST_FRAMES,
  DONG_THRUST_IMPACT_FRAME,
  DONG_WALK_FRAMES,
} from '../dongQuixoteTiming';

const TWO_PI = Math.PI * 2;

// ── Keyed tracks ─────────────────────────────────────────────────────────────

type Keys = readonly (readonly [number, number])[];
type PointKeys = readonly (readonly [number, V3])[];

/** A value keyed on frame indices, eased between keys. */
function keyed(keys: Keys, t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) return lerp(v0, v1, easeInOut((t - t0) / (t1 - t0)));
  }
  return keys[keys.length - 1][1];
}

function keyedPoint(keys: PointKeys, t: number): V3 {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) return mix3(v0, v1, easeInOut((t - t0) / (t1 - t0)));
  }
  return keys[keys.length - 1][1];
}

/** A Catmull–Rom point through evenly keyed points, for a swinging foot's path. */
function splinePoint(points: readonly V3[], stops: readonly number[], s: number): V3 {
  const last = points.length - 1;
  let index = 0;
  while (index < last - 1 && s > stops[index + 1]) index++;
  const span = stops[index + 1] - stops[index];
  const u = clamp01((s - stops[index]) / span);
  const p0 = points[Math.max(0, index - 1)];
  const p1 = points[index];
  const p2 = points[index + 1];
  const p3 = points[Math.min(last, index + 2)];
  const u2 = u * u;
  const u3 = u2 * u;
  const blend = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  return v3(
    blend(p0.x, p1.x, p2.x, p3.x),
    blend(p0.y, p1.y, p2.y, p3.y),
    blend(p0.z, p1.z, p2.z, p3.z),
  );
}

function wrap(phase: number): number {
  return phase - Math.floor(phase);
}

/** A loop row's phase at a frame: evenly spaced, never reaching 1, so the last frame is not the first. */
function loopPhase(frame: number, frames: number): number {
  return frame / frames;
}

/** Soft minimum: rides the lowest value and hands between near-equal ones without a corner. */
function softMin(values: readonly number[], sharpness: number): number {
  const floor = Math.min(...values);
  const sum = values.reduce((acc, v) => acc + Math.exp(-(v - floor) / sharpness), 0);
  return floor - sharpness * Math.log(sum);
}

// ── Shared body settings ─────────────────────────────────────────────────────

const STANDING_HIP: V3 = v3(0, -HIP_HEIGHT, 0);
/** The hip joint sits this far below the pelvis centre. */
const HIP_JOINT_DROP = 0.02;
/** Standing, his left fist rests on his hip, elbow out: the proud akimbo. */
const AKIMBO_HAND: V3 = v3(-0.19, -0.935, 0.0);

function planted(ankle: V3): FootPose {
  return { ankle, pitch: 0, planted: true };
}

function carried(hipShift: V3, hand: V3 = UPRIGHT_CARRY_HAND): ArmPose {
  return { kind: 'reach', hand: add3(hand, hipShift) };
}

function withAngles(angles: ArmAngles): ArmPose {
  return { kind: 'angles', angles };
}

// ── Idle: the breath ─────────────────────────────────────────────────────────

/**
 * The breath through the idle, frame by frame: pumped, let go all at once,
 * sagging, and hauled back up. One cycle over the row — a breath that cycled
 * more often than every four frames would alias into a flicker.
 */
const IDLE_BREATH: readonly number[] = [1, 0.74, 0.38, 0.1, 0, 0.02, 0.24, 0.55, 0.82, 0.97];
/** On the deflated beat he blinks, as a man does when he sighs. */
const IDLE_BLINK_FRAME = 5;
/** The rush of air on the way out. */
const IDLE_PUFF_FRAMES: ReadonlyMap<number, number> = new Map([
  [2, 0.35],
  [3, 0.25],
]);
const IDLE_CHIN_LIFT = -0.12;
const IDLE_CHIN_DROP = 0.1;
/** The deflated hips settle this far. */
const IDLE_SAG = 0.012;
/** The carried lance droops forward as his arm goes soft. */
const IDLE_LANCE_DROOP = 0.07;

export function idlePose(frame: number): DongPose {
  const pose = restingPose();
  const breath = IDLE_BREATH[frame % DONG_IDLE_FRAMES];
  const slump = 1 - breath;
  const sag = v3(0, IDLE_SAG * slump, 0);
  pose.breath = breath;
  pose.hip = add3(STANDING_HIP, sag);
  pose.headPitch = lerp(IDLE_CHIN_DROP, IDLE_CHIN_LIFT, breath);
  pose.leftArm = { kind: 'reach', hand: add3(AKIMBO_HAND, v3(0, 0.03 * slump, 0)) };
  pose.rightArm = carried(sag, add3(UPRIGHT_CARRY_HAND, v3(0, 0.03 * slump, 0.01 * slump)));
  pose.lance = {
    kind: 'held',
    dir: normalize3(add3(UPRIGHT_LANCE_DIR, v3(0, 0, IDLE_LANCE_DROOP * slump))),
    gripAlong: UPRIGHT_GRIP_ALONG,
  };
  pose.blink = frame === IDLE_BLINK_FRAME ? 1 : 0;
  pose.mouth = IDLE_PUFF_FRAMES.get(frame) ?? 0;
  pose.pennonPhase = (TWO_PI * frame) / DONG_IDLE_FRAMES;
  pose.pennonLift = lerp(0.25, 0.55, breath);
  pose.beardSwing = 0.01 * Math.sin((TWO_PI * frame) / DONG_IDLE_FRAMES);
  return pose;
}

// ── Walk ─────────────────────────────────────────────────────────────────────

/** Ten frames of sixteen with each foot down: a stance of 62%, double support either side of each contact. */
const WALK_STANCE_FRAMES = 10;
const WALK_STANCE_SHARE = (WALK_STANCE_FRAMES - 1) / DONG_WALK_FRAMES;
/** He strikes with a straight leg and the toe high: the stiff, proud part of the stride. */
const WALK_HEEL_STRIKE_PITCH = 0.3;
const WALK_TOE_OFF_PITCH = -0.62;
/** The pelvis at double support, where the stride's reach is measured. */
const WALK_CONTACT_HIP = HIP_HEIGHT - 0.055;
/** A walking leg is never quite locked. */
const WALK_LEG_SPAN = LEG_MAX_REACH * 0.992;
const WALK_FOOT_HALF = 0.085;
const SOLE_LENGTH = 0.225;

function reachAhead(hipHeight: number, ankle: V3): number {
  const rootHeight = hipHeight - HIP_JOINT_DROP;
  const rise = rootHeight + ankle.y;
  return Math.sqrt(Math.max(0, WALK_LEG_SPAN * WALK_LEG_SPAN - rise * rise));
}

const STRIKE_ANKLE_OFFSET = ankleOverPivot(0, 'heel', WALK_HEEL_STRIKE_PITCH);
const TOE_OFF_ANKLE_OFFSET = ankleOverPivot(0, 'toe', WALK_TOE_OFF_PITCH);
/** Where the striking heel lands, ahead of the pelvis. */
const WALK_HEEL_STRIKE = reachAhead(WALK_CONTACT_HIP, STRIKE_ANKLE_OFFSET) - STRIKE_ANKLE_OFFSET.z;
/** Where the pushing toe is as it leaves the floor, behind the pelvis. */
const WALK_TOE_OFF = -reachAhead(WALK_CONTACT_HIP, TOE_OFF_ANKLE_OFFSET) - TOE_OFF_ANKLE_OFFSET.z;
/** Ground covered in one stance: heel strike to toe-off, the foot rolling heel to toe. */
const WALK_STANCE_GROUND = WALK_HEEL_STRIKE + SOLE_LENGTH - WALK_TOE_OFF;
/**
 * Ground one full walk cycle covers, in tiles. The kit advances the walk's
 * phase by the ground he actually covers over this, or the planted foot skates.
 */
export const DONG_WALK_GROUND_PER_CYCLE = WALK_STANCE_GROUND / WALK_STANCE_SHARE;

/** Heel strike toes-up, flat through mid-stance, heel off late and up onto the toes. */
const WALK_STANCE_PITCH: Keys = [
  [0, WALK_HEEL_STRIKE_PITCH],
  [0.16, 0],
  [0.55, 0],
  [1, WALK_TOE_OFF_PITCH],
];

/** A stance foot rocks on its heel while its toe is up and on its toe once its heel is. */
function walkStanceFoot(u: number, x: number): FootPose {
  const heel = WALK_HEEL_STRIKE - WALK_STANCE_GROUND * u;
  const pitch = keyed(WALK_STANCE_PITCH, u);
  const ankle =
    pitch >= 0
      ? ankleOverPivot(heel, 'heel', pitch)
      : ankleOverPivot(heel + SOLE_LENGTH, 'toe', pitch);
  return { ankle: v3(x, ankle.y, ankle.z), pitch, planted: true };
}

/**
 * The swing: the foot peels off behind, tucks up with the knee folded, passes
 * low under the hip and reaches forward straight-kneed to strike. His tuck is
 * shallower than Carl's — an old soldier's stiff march — but it is there, or
 * the swing is a goose step.
 */
const WALK_SWING_STOPS: readonly number[] = [0, 0.3, 0.58, 0.84, 1];
const WALK_SWING_PITCH: Keys = [
  [0, WALK_TOE_OFF_PITCH],
  [0.3, -0.5],
  [0.58, 0],
  [0.84, 0.22],
  [1, WALK_HEEL_STRIKE_PITCH],
];

function walkSwingFoot(s: number, x: number): FootPose {
  const start = walkStanceFoot(1, x).ankle;
  const end = walkStanceFoot(0, x).ankle;
  const points = [
    start,
    v3(x, -0.21, start.z + 0.1),
    v3(x, -0.17, 0.02),
    v3(x, end.y - 0.06, end.z + 0.03),
    end,
  ];
  return {
    ankle: splinePoint(points, WALK_SWING_STOPS, s),
    pitch: keyed(WALK_SWING_PITCH, s),
    planted: false,
  };
}

function walkFoot(phase: number, x: number): FootPose {
  const cycle = wrap(phase);
  if (cycle <= WALK_STANCE_SHARE) return walkStanceFoot(cycle / WALK_STANCE_SHARE, x);
  return walkSwingFoot((cycle - WALK_STANCE_SHARE) / (1 - WALK_STANCE_SHARE), x);
}

/** How sharply the pelvis hands from one stance leg's arc to the other's. */
const WALK_ARC_BLEND = 0.008;
const WALK_TOP_HIP = HIP_HEIGHT - 0.004;

/**
 * The walking pelvis: lowest at each contact, highest as he vaults over the
 * planted leg at mid-stance, on a smooth curve twice a cycle — and never
 * higher than either planted leg can reach, which is what sets the contact
 * low. Riding the reach ceilings alone drops it the whole way in the one
 * frame the heel strikes, a visible jolt; the curve spreads that fall over
 * the frames running into contact.
 */
function walkHipHeight(phase: number, right: FootPose, left: FootPose): number {
  const ceilings = [WALK_TOP_HIP];
  for (const foot of [right, left]) {
    if (!foot.planted) continue;
    const rise = Math.sqrt(
      Math.max(0, WALK_LEG_SPAN * WALK_LEG_SPAN - foot.ankle.z * foot.ankle.z),
    );
    ceilings.push(-foot.ankle.y + rise + HIP_JOINT_DROP);
  }
  const vault = (1 - Math.cos(2 * TWO_PI * phase)) / 2;
  const curve = WALK_CONTACT_HIP + (WALK_TOP_HIP - WALK_CONTACT_HIP) * vault;
  return softMin([...ceilings, curve], WALK_ARC_BLEND);
}

/** The free arm's swing, forward first at right-foot contact. */
const WALK_ARM_SWING = 0.42;
const WALK_ARM_ABDUCT = 0.12;
const WALK_ELBOW = 0.2;
/** He marches with the chest out and the shoulders held back. */
const WALK_PROUD_LEAN = -0.05;
const WALK_CHIN = -0.1;
const WALK_TWIST = 0.07;
const WALK_SWAY = 0.018;
const WALK_LANCE_ROCK = 0.035;

export function walkPose(frame: number): DongPose {
  const phase = loopPhase(frame, DONG_WALK_FRAMES);
  const pose = restingPose();
  const right = walkFoot(phase, WALK_FOOT_HALF);
  const left = walkFoot(phase + 0.5, -WALK_FOOT_HALF);
  const hipHeight = walkHipHeight(phase, right, left);
  const angle = TWO_PI * phase;
  const sway = WALK_SWAY * Math.cos(angle - TWO_PI * (WALK_STANCE_SHARE / 2));
  pose.hip = v3(sway, -hipHeight, 0);
  pose.rightFoot = right;
  pose.leftFoot = left;
  pose.lean = WALK_PROUD_LEAN;
  pose.headPitch = WALK_CHIN;
  pose.twist = -WALK_TWIST * Math.cos(angle);
  const swing = WALK_ARM_SWING * Math.cos(angle);
  pose.leftArm = withAngles({
    swing,
    abduct: WALK_ARM_ABDUCT,
    elbow: WALK_ELBOW + 0.14 * Math.max(0, Math.cos(angle)),
  });
  pose.leftHand = 'fist';
  const shift = sub3(pose.hip, STANDING_HIP);
  pose.rightArm = carried(shift);
  pose.lance = {
    kind: 'held',
    dir: normalize3(add3(UPRIGHT_LANCE_DIR, v3(0, 0, WALK_LANCE_ROCK * Math.sin(2 * angle)))),
    gripAlong: UPRIGHT_GRIP_ALONG,
  };
  pose.vestSwing = 0.018 + 0.012 * Math.sin(2 * angle);
  pose.beardSwing = 0.02 + 0.012 * Math.sin(2 * angle - 1);
  pose.pennonPhase = 2 * angle;
  pose.pennonLift = 0.85;
  return pose;
}

// ── Charge: the running couch-lance ──────────────────────────────────────────

/** Three frames of eight with each foot down: the rest is flight, as a sprinter's is. */
const RUN_STANCE_SHARE = 0.34;
/** He runs low, over bent knees, and the pelvis sinks as each foot takes him. */
const RUN_CARRIAGE_HIP = HIP_HEIGHT - 0.085;
const RUN_ABSORB = 0.03;
const RUN_FLIGHT_RISE = 0.045;
const RUN_LEG_SPAN = LEG_MAX_REACH * 0.975;
const RUN_CONTACT_PITCH = -0.05;
const RUN_TOE_OFF_PITCH = -0.75;
const RUN_FOOT_HALF = 0.07;

const RUN_CONTACT_ANKLE = (() => {
  const rootHeight = RUN_CARRIAGE_HIP - HIP_JOINT_DROP;
  const ankleHeight = ANKLE_HEIGHT + 0.01;
  const rise = rootHeight - ankleHeight;
  return Math.sqrt(Math.max(0, RUN_LEG_SPAN * RUN_LEG_SPAN - rise * rise));
})();
/** Ground one stance covers: the planted foot sweeps from ahead of the pelvis to behind it. */
const RUN_STANCE_GROUND = RUN_CONTACT_ANKLE * 1.9;
/** Ground one charge cycle covers, in tiles, for pacing the charge row by ground covered. */
export const DONG_CHARGE_GROUND_PER_CYCLE = RUN_STANCE_GROUND / RUN_STANCE_SHARE;

const RUN_STANCE_PITCH: Keys = [
  [0, RUN_CONTACT_PITCH],
  [0.45, 0],
  [1, RUN_TOE_OFF_PITCH],
];

function runStanceFoot(u: number, x: number): FootPose {
  const ankleZ = RUN_CONTACT_ANKLE - RUN_STANCE_GROUND * u;
  const pitch = keyed(RUN_STANCE_PITCH, u);
  const toeGround = ankleZ + ankleOverPivot(0, 'toe', 0).z * -1;
  const ankle = pitch < 0 ? ankleOverPivot(toeGround, 'toe', pitch) : v3(0, -ANKLE_HEIGHT, ankleZ);
  return { ankle: v3(x, ankle.y, ankle.z), pitch, planted: true };
}

const RUN_SWING_STOPS: readonly number[] = [0, 0.3, 0.62, 0.86, 1];
const RUN_SWING_PITCH: Keys = [
  [0, RUN_TOE_OFF_PITCH],
  [0.3, -0.9],
  [0.62, -0.1],
  [0.86, 0.1],
  [1, RUN_CONTACT_PITCH],
];

function runSwingFoot(s: number, x: number): FootPose {
  const start = runStanceFoot(1, x).ankle;
  const end = runStanceFoot(0, x).ankle;
  const points = [
    start,
    v3(x, -0.42, start.z + 0.05),
    v3(x, -0.36, 0.12),
    v3(x, end.y - 0.1, end.z + 0.07),
    end,
  ];
  return {
    ankle: splinePoint(points, RUN_SWING_STOPS, s),
    pitch: keyed(RUN_SWING_PITCH, s),
    planted: false,
  };
}

function runFoot(phase: number, x: number): FootPose {
  const cycle = wrap(phase);
  if (cycle <= RUN_STANCE_SHARE) return runStanceFoot(cycle / RUN_STANCE_SHARE, x);
  return runSwingFoot((cycle - RUN_STANCE_SHARE) / (1 - RUN_STANCE_SHARE), x);
}

function runHipHeight(phase: number): number {
  const step = wrap(phase) % 0.5;
  if (step <= RUN_STANCE_SHARE)
    return RUN_CARRIAGE_HIP - RUN_ABSORB * Math.sin((Math.PI * step) / RUN_STANCE_SHARE);
  const flight = (step - RUN_STANCE_SHARE) / (0.5 - RUN_STANCE_SHARE);
  return RUN_CARRIAGE_HIP + RUN_FLIGHT_RISE * 4 * flight * (1 - flight);
}

/** The couch: fist at his lowest rib, the shaft clamped under his arm and levelled at the foe. */
const COUCH_HAND: V3 = v3(0.19, -1.12, 0.2);
/** Aimed a touch inward across his body and a touch down, at a man's chest. */
export const COUCH_LANCE_DIR: V3 = normalize3(v3(-0.1, 0.07, 1));
/** Gripped well back, so the butt is tucked under his armpit behind the hand. */
const COUCH_GRIP_ALONG = 0.55;
const RUN_LEAN = 0.24;
const RUN_ARM_SWING = 0.62;
const RUN_ELBOW = 1.35;

export function chargePose(frame: number): DongPose {
  const phase = loopPhase(frame, DONG_CHARGE_FRAMES);
  const pose = restingPose();
  const angle = TWO_PI * phase;
  pose.rightFoot = runFoot(phase, RUN_FOOT_HALF);
  pose.leftFoot = runFoot(phase + 0.5, -RUN_FOOT_HALF);
  pose.hip = v3(0.01 * Math.cos(angle), -runHipHeight(phase), 0);
  pose.lean = RUN_LEAN;
  pose.headPitch = -RUN_LEAN - 0.05;
  pose.twist = -0.05 * Math.cos(angle);
  pose.breath = 1;
  pose.mouth = 0.55;
  const shift = sub3(pose.hip, STANDING_HIP);
  pose.rightArm = { kind: 'reach', hand: add3(COUCH_HAND, shift) };
  pose.lance = { kind: 'held', dir: COUCH_LANCE_DIR, gripAlong: COUCH_GRIP_ALONG };
  pose.leftArm = withAngles({
    swing: RUN_ARM_SWING * Math.cos(angle) + 0.2,
    abduct: 0.1,
    elbow: RUN_ELBOW,
  });
  pose.vestSwing = 0.06 + 0.01 * Math.sin(2 * angle);
  pose.beardSwing = 0.07 + 0.015 * Math.sin(2 * angle);
  pose.pennonPhase = 3 * angle;
  pose.pennonLift = 1;
  return pose;
}

// ── Thrust ───────────────────────────────────────────────────────────────────

/** Two hands on the shaft for the jab, the left a forearm's width ahead of the right. */
const THRUST_HAND_SPACING = 0.25;
const THRUST_GRIP_ALONG = 0.5;
export const THRUST_LANCE_DIR: V3 = normalize3(v3(-0.08, 0.015, 1));

const THRUST_HIP: PointKeys = [
  [0, v3(0, -HIP_HEIGHT, 0)],
  [1, v3(0, -HIP_HEIGHT + 0.03, 0.01)],
  [2, v3(0.02, -HIP_HEIGHT + 0.08, -0.08)],
  [3, v3(0, -HIP_HEIGHT + 0.1, 0.06)],
  [4, v3(-0.02, -HIP_HEIGHT + 0.13, 0.17)],
  [5, v3(-0.02, -HIP_HEIGHT + 0.12, 0.15)],
  [6, v3(0, -HIP_HEIGHT + 0.06, 0.05)],
  [7, v3(0, -HIP_HEIGHT + 0.01, 0.01)],
];
/**
 * The jab drives from his right hip in toward his centreline as it goes out:
 * the line a right-handed pikeman strikes along, and the only travel a jab
 * aimed at the camera shows head-on.
 */
const THRUST_RIGHT_HAND: PointKeys = [
  [0, add3(UPRIGHT_CARRY_HAND, v3(0, 0, -0.03))],
  [1, v3(0.22, -1.1, 0.0)],
  [2, v3(0.25, -1.05, -0.27)],
  [3, v3(0.14, -1.06, 0.06)],
  [4, v3(0.02, -1.08, 0.42)],
  [5, v3(0.04, -1.08, 0.36)],
  [6, v3(0.17, -1.07, 0.06)],
  [7, add3(UPRIGHT_CARRY_HAND, v3(0, 0.01, 0))],
];
const THRUST_LANCE_TILT: Keys = [
  [0, 0.12],
  [1, 0.65],
  [2, 1],
  [6, 1],
  [7, 0.2],
];
const THRUST_LEAN: Keys = [
  [0, 0],
  [2, -0.08],
  [3, 0.12],
  [4, 0.3],
  [5, 0.26],
  [6, 0.1],
  [7, 0.02],
];
const THRUST_TWIST: Keys = [
  [0, 0],
  [2, 0.12],
  [4, -0.32],
  [5, -0.28],
  [7, 0],
];
const THRUST_LEFT_FOOT: PointKeys = [
  [0, v3(-STANCE_HALF, -ANKLE_HEIGHT, 0)],
  [1, v3(-0.1, -ANKLE_HEIGHT - 0.06, 0.14)],
  [2, v3(-0.1, -ANKLE_HEIGHT, 0.26)],
  [6, v3(-0.1, -ANKLE_HEIGHT, 0.26)],
  [7, v3(-STANCE_HALF, -ANKLE_HEIGHT, 0.05)],
];
const THRUST_RIGHT_FOOT: PointKeys = [
  [0, v3(STANCE_HALF, -ANKLE_HEIGHT, 0)],
  [2, v3(0.11, -ANKLE_HEIGHT, -0.16)],
  [6, v3(0.11, -ANKLE_HEIGHT, -0.16)],
  [7, v3(STANCE_HALF, -ANKLE_HEIGHT, -0.02)],
];

/** The lance's direction blended from upright to levelled by `tilt`. */
function tiltedLance(tilt: number, level: V3): V3 {
  return normalize3(mix3(UPRIGHT_LANCE_DIR, level, tilt));
}

export function thrustPose(frame: number): DongPose {
  const pose = restingPose();
  const tilt = keyed(THRUST_LANCE_TILT, frame);
  const dir = tiltedLance(tilt, THRUST_LANCE_DIR);
  pose.hip = keyedPoint(THRUST_HIP, frame);
  pose.lean = keyed(THRUST_LEAN, frame);
  pose.twist = keyed(THRUST_TWIST, frame);
  pose.headPitch = -0.05;
  pose.leftFoot = {
    ...planted(keyedPoint(THRUST_LEFT_FOOT, frame)),
    planted: frame >= 2 || frame === 0,
  };
  pose.rightFoot = planted(keyedPoint(THRUST_RIGHT_FOOT, frame));
  const right = keyedPoint(THRUST_RIGHT_HAND, frame);
  pose.rightArm = { kind: 'reach', hand: right };
  const gripAlong = lerp(UPRIGHT_GRIP_ALONG, THRUST_GRIP_ALONG, tilt);
  pose.lance = { kind: 'held', dir, gripAlong };
  // The left hand closes on the shaft only once the lance is lowered to it.
  const onShaft = clamp01((tilt - 0.5) / 0.4);
  const shaftHand = add3(right, scale3(dir, THRUST_HAND_SPACING));
  pose.leftArm = { kind: 'reach', hand: mix3(AKIMBO_HAND, shaftHand, onShaft) };
  pose.leftHand = onShaft > 0.5 ? 'grip' : 'fist';
  pose.mouth =
    frame === DONG_THRUST_IMPACT_FRAME || frame === DONG_THRUST_IMPACT_FRAME + 1 ? 0.7 : 0;
  pose.breath = frame >= 2 && frame <= 5 ? 1.05 : 1;
  pose.vestSwing = keyed(
    [
      [2, -0.01],
      [4, 0.05],
      [6, 0.01],
    ],
    frame,
  );
  pose.beardSwing = pose.vestSwing * 1.2;
  pose.pennonPhase = frame * 0.9;
  pose.pennonLift = 0.8;
  return pose;
}

// ── Charge wind-up ───────────────────────────────────────────────────────────

const WINDUP_HIP: PointKeys = [
  [0, v3(0, -HIP_HEIGHT, 0)],
  [2, v3(0, -HIP_HEIGHT + 0.07, 0)],
  [3, v3(0, -HIP_HEIGHT + 0.1, -0.06)],
  [4, v3(0, -HIP_HEIGHT + 0.1, -0.05)],
  [5, v3(0, -RUN_CARRIAGE_HIP + 0.02, 0.02)],
];
const WINDUP_RIGHT_FOOT: PointKeys = [
  [0, v3(STANCE_HALF, -ANKLE_HEIGHT, 0)],
  [1, v3(0.09, -ANKLE_HEIGHT - 0.07, 0.16)],
  [2, v3(0.08, -ANKLE_HEIGHT, 0.26)],
  [5, v3(0.08, -ANKLE_HEIGHT, 0.26)],
];
const WINDUP_LEFT_FOOT: PointKeys = [
  [0, v3(-STANCE_HALF, -ANKLE_HEIGHT, 0)],
  [2, v3(-0.08, -ANKLE_HEIGHT, -0.26)],
  [3, v3(-0.08, -ANKLE_HEIGHT - 0.035, -0.36)],
  [4, v3(-0.08, -ANKLE_HEIGHT, -0.3)],
  [5, v3(-0.08, -ANKLE_HEIGHT - 0.02, -0.3)],
];
const WINDUP_LEFT_PITCH: Keys = [
  [0, 0],
  [2, -0.3],
  [3, -0.1],
  [4, -0.45],
  [5, -0.6],
];
const WINDUP_TILT: Keys = [
  [0, 0.15],
  [1, 0.6],
  [2, 1],
];
const WINDUP_LEAN: Keys = [
  [0, 0],
  [2, 0.05],
  [3, -0.1],
  [4, -0.06],
  [5, RUN_LEAN],
];

/** The wind-up's last frame: the lance is couched and he shouts as he goes. */
const WINDUP_LAST = DONG_CHARGE_WINDUP_FRAMES - 1;

export function chargeWindupPose(frame: number): DongPose {
  const pose = restingPose();
  pose.hip = keyedPoint(WINDUP_HIP, frame);
  pose.rightFoot = { ...planted(keyedPoint(WINDUP_RIGHT_FOOT, frame)), planted: frame !== 1 };
  const leftPitch = keyed(WINDUP_LEFT_PITCH, frame);
  const leftAnkle = keyedPoint(WINDUP_LEFT_FOOT, frame);
  pose.leftFoot = { ankle: leftAnkle, pitch: leftPitch, planted: frame !== 3 };
  pose.lean = keyed(WINDUP_LEAN, frame);
  pose.headPitch = frame >= 3 ? -0.2 : -0.06;
  const tilt = keyed(WINDUP_TILT, frame);
  pose.lance = {
    kind: 'held',
    dir: tiltedLance(tilt, COUCH_LANCE_DIR),
    gripAlong: lerp(UPRIGHT_GRIP_ALONG, COUCH_GRIP_ALONG, tilt),
  };
  const shift = sub3(pose.hip, STANDING_HIP);
  pose.rightArm = { kind: 'reach', hand: add3(mix3(UPRIGHT_CARRY_HAND, COUCH_HAND, tilt), shift) };
  pose.leftArm = withAngles({
    swing: keyed(
      [
        [0, -0.1],
        [2, 0.3],
        [4, 0.5],
        [WINDUP_LAST, 0.8],
      ],
      frame,
    ),
    abduct: 0.15,
    elbow: keyed(
      [
        [0, 0.3],
        [WINDUP_LAST, RUN_ELBOW],
      ],
      frame,
    ),
  });
  pose.breath = keyed(
    [
      [0, 1],
      [3, 1.1],
      [WINDUP_LAST, 1.05],
    ],
    frame,
  );
  pose.mouth = frame === WINDUP_LAST ? 0.6 : 0;
  pose.vestSwing = frame >= WINDUP_LAST ? 0.04 : 0;
  pose.pennonPhase = frame * 1.1;
  pose.pennonLift = lerp(0.6, 1, tilt);
  return pose;
}

// ── Charge recovery ──────────────────────────────────────────────────────────

/** The lance's butt planted in front of his right foot as he doubles over. */
const RECOVER_BUTT: V3 = v3(0.26, 0, 0.5);
/** Leaning on the planted lance, his hand closes on it at knee height. */
const RECOVER_GRIP_ALONG = 0.66;
const RECOVER_LANCE_DIR: V3 = normalize3(v3(-0.02, -1, -0.12));
/** Braced just above the knee: the knees stay where they are on the floor, so this does not ride with the hip. */
const RECOVER_LEFT_HAND: V3 = v3(-0.13, -0.57, 0.22);
/** The pant: one heave in, one heave out, across six frames — fewer would alias. */
const RECOVER_BREATH: readonly number[] = [
  0.7, 0.4, 0.15, 0.05, 0.35, 0.7, 0.45, 0.12, 0, 0.3, 0.65, 0.9,
];
const RECOVER_BENT_FROM = 3;
/** He folds over three frames, not one: the lance swings from couched to planted by thirds. */
const RECOVER_FOLD_AT_FIRST = 0.33;
const RECOVER_FOLD_AT_SECOND = 0.67;
const RECOVER_BENT_TO = 8;
const RECOVER_LAST = DONG_CHARGE_RECOVER_FRAMES - 1;
/** Half way back up: the frame between doubled over and upright. */
const RECOVER_RISING = RECOVER_LAST - 1;
/** One pant, in and out, over this many frames: fewer would alias into a flicker. */
const RECOVER_PANT_FRAMES = 6;

const RECOVER_LEAN: Keys = [
  [0, -0.12],
  [1, 0.25],
  [2, 0.6],
  [RECOVER_BENT_FROM, 0.9],
  [RECOVER_BENT_TO, 0.9],
  [RECOVER_RISING, 0.35],
  [RECOVER_LAST, 0.02],
];
const RECOVER_HIP: PointKeys = [
  [0, v3(0, -RUN_CARRIAGE_HIP, -0.04)],
  [1, v3(0, -HIP_HEIGHT + 0.09, -0.06)],
  [2, v3(0, -HIP_HEIGHT + 0.13, -0.08)],
  [RECOVER_BENT_FROM, v3(0, -HIP_HEIGHT + 0.16, -0.1)],
  [RECOVER_BENT_TO, v3(0, -HIP_HEIGHT + 0.16, -0.1)],
  [RECOVER_RISING, v3(0, -HIP_HEIGHT + 0.06, -0.03)],
  [RECOVER_LAST, v3(0, -HIP_HEIGHT, 0)],
];
const RECOVER_TILT: Keys = [
  [0, 0],
  [RECOVER_BENT_FROM, 1],
  [RECOVER_BENT_TO, 1],
  [RECOVER_LAST, 0],
];

export function chargeRecoverPose(frame: number): DongPose {
  const pose = restingPose();
  const bentShare = keyed(
    [
      [0, 0],
      [1, RECOVER_FOLD_AT_FIRST],
      [2, RECOVER_FOLD_AT_SECOND],
      [RECOVER_BENT_FROM, 1],
      [RECOVER_BENT_TO, 1],
      [RECOVER_LAST, 0],
    ],
    frame,
  );
  pose.hip = keyedPoint(RECOVER_HIP, frame);
  pose.lean = keyed(RECOVER_LEAN, frame);
  pose.headPitch =
    lerp(-0.05, -0.55, bentShare) + 0.06 * Math.sin((TWO_PI * frame) / RECOVER_PANT_FRAMES);
  pose.rightFoot = planted(
    v3(0.12, -ANKLE_HEIGHT, frame === 0 ? 0.26 : 0.12 * (1 - frame / RECOVER_LAST) + 0.02),
  );
  pose.leftFoot = planted(
    v3(-0.12, -ANKLE_HEIGHT, frame === 0 ? -0.2 : -0.06 * (1 - frame / RECOVER_LAST)),
  );
  pose.breath = RECOVER_BREATH[frame];
  pose.mouth = lerp(0.2, 0.75, bentShare) * (0.6 + 0.4 * (1 - RECOVER_BREATH[frame]));
  const tilt = keyed(RECOVER_TILT, frame);
  const planting = clamp01(bentShare);
  const couchDir = COUCH_LANCE_DIR;
  const shift = sub3(pose.hip, STANDING_HIP);
  if (planting > 0.02) {
    const grip = add3(RECOVER_BUTT, scale3(RECOVER_LANCE_DIR, RECOVER_GRIP_ALONG));
    const carry = add3(UPRIGHT_CARRY_HAND, shift);
    const hand = mix3(frame >= RECOVER_BENT_TO ? carry : add3(COUCH_HAND, shift), grip, planting);
    pose.rightArm = { kind: 'reach', hand };
    const dir = normalize3(
      mix3(frame >= RECOVER_BENT_TO ? UPRIGHT_LANCE_DIR : couchDir, RECOVER_LANCE_DIR, planting),
    );
    pose.lance = {
      kind: 'held',
      dir,
      gripAlong: lerp(COUCH_GRIP_ALONG, RECOVER_GRIP_ALONG, planting),
    };
  } else {
    pose.rightArm = {
      kind: 'reach',
      hand: add3(frame === 0 ? COUCH_HAND : UPRIGHT_CARRY_HAND, shift),
    };
    pose.lance = {
      kind: 'held',
      dir: frame === 0 ? couchDir : tiltedLance(tilt, UPRIGHT_LANCE_DIR),
      gripAlong: frame === 0 ? COUCH_GRIP_ALONG : UPRIGHT_GRIP_ALONG,
    };
  }
  pose.rightHand = 'grip';
  pose.leftArm = {
    kind: 'reach',
    hand: mix3(add3(AKIMBO_HAND, shift), RECOVER_LEFT_HAND, planting),
  };
  pose.leftHand = planting > 0.5 ? 'open' : 'fist';
  pose.pennonLift = lerp(0.8, 0.1, bentShare);
  pose.pennonPhase = frame * 0.5;
  pose.beardSwing = -0.02 * bentShare;
  return pose;
}

// ── Salute ───────────────────────────────────────────────────────────────────

/** The lance hand thrust overhead. */
const SALUTE_HAND: V3 = v3(0.27, -1.92, 0.06);
/** Raised, he holds the lance near its middle, so the point stands well over him without climbing out of his cell. */
const SALUTE_GRIP_ALONG = 1.35;
/** How many frames he holds the lance aloft, from the frame it reaches the top. */
const SALUTE_HOLD_FRAMES = 3;
const SALUTE_LOWER_FROM = DONG_SALUTE_RAISED_FRAME + SALUTE_HOLD_FRAMES;
const SALUTE_LAST = DONG_SALUTE_FRAMES - 1;
const SALUTE_RAISE: Keys = [
  [0, 0],
  [DONG_SALUTE_RAISED_FRAME, 1],
  [SALUTE_LOWER_FROM, 1],
  [SALUTE_LAST, 0],
];
/** The fist swings out and forward on its way up and down, so the arm never folds against the shoulder. */
const SALUTE_ARC: V3 = v3(0.14, 0, 0.16);
/** Lowering, he dips the point and bows from the waist: a courtier's flourish after the boast. */
const SALUTE_BOW: Keys = [
  [SALUTE_LOWER_FROM, 0],
  [(SALUTE_LOWER_FROM + SALUTE_LAST) / 2, 1],
  [SALUTE_LAST, 0],
];
const SALUTE_BOW_LEAN = 0.3;
const SALUTE_BOW_DIP = 0.4;
/** Each held beat pumps the lance once, over this many frames. */
const SALUTE_PUMP_FRAMES = 1.5;
const SALUTE_PUMP = 0.035;

function saluteHeld(frame: number): boolean {
  return frame >= DONG_SALUTE_RAISED_FRAME && frame <= SALUTE_LOWER_FROM;
}

export function salutePose(frame: number): DongPose {
  const pose = restingPose();
  const raise = keyed(SALUTE_RAISE, frame);
  const bow = frame > SALUTE_LOWER_FROM ? keyed(SALUTE_BOW, frame) : 0;
  const arc = Math.sin(Math.PI * raise);
  // The pump dips below the raised fist and comes back, so the fist is never
  // higher than on the frame it first reaches the top.
  const pump = saluteHeld(frame)
    ? SALUTE_PUMP *
      Math.abs(Math.sin((Math.PI * (frame - DONG_SALUTE_RAISED_FRAME)) / SALUTE_PUMP_FRAMES))
    : 0;
  const hand = add3(
    add3(mix3(UPRIGHT_CARRY_HAND, SALUTE_HAND, raise), scale3(SALUTE_ARC, arc)),
    v3(0, pump, 0),
  );
  pose.lean = lerp(0, -0.08, raise) + SALUTE_BOW_LEAN * bow;
  const shift = v3(0, 0, 0.1 * bow);
  pose.rightArm = { kind: 'reach', hand: add3(hand, shift) };
  pose.lance = {
    kind: 'held',
    dir: normalize3(add3(UPRIGHT_LANCE_DIR, v3(0, 0, SALUTE_BOW_DIP * bow))),
    gripAlong: lerp(UPRIGHT_GRIP_ALONG, SALUTE_GRIP_ALONG, raise),
  };
  pose.leftArm = { kind: 'reach', hand: AKIMBO_HAND };
  pose.breath = lerp(1, 1.12, raise);
  pose.headPitch = lerp(-0.05, -0.28, raise) + 0.3 * bow;
  pose.mouth = saluteHeld(frame) && frame < SALUTE_LOWER_FROM ? 0.8 : 0;
  pose.hip = add3(STANDING_HIP, v3(0, -0.012 * raise, -0.03 * bow));
  pose.pennonPhase = frame * 1.3;
  pose.pennonLift = lerp(0.6, 1, raise);
  pose.beardSwing = 0.015 * Math.sin(frame * 1.3) - 0.03 * bow;
  return pose;
}

// ── Hurt ─────────────────────────────────────────────────────────────────────

/** A blow knocks the wind out of him: the chest collapses before anything else moves. */
const HURT_BREATH: readonly number[] = [0.3, 0, 0.15, 0.42, 0.72];
/** He is rocked back onto his heels, head snapped up, and the lance sways back with him. */
const HURT_LEAN: readonly number[] = [-0.2, -0.32, -0.18, -0.04, 0];
const HURT_HIP_BACK: readonly number[] = [-0.05, -0.09, -0.07, -0.02, 0];
const HURT_HEAD: readonly number[] = [-0.35, -0.45, -0.1, 0.05, -0.05];
const HURT_LANCE_BACK: readonly number[] = [-0.12, -0.2, -0.12, -0.03, 0];
/** The rear foot steps back to catch him. */
const HURT_STEP_BACK: readonly number[] = [-0.03, -0.12, -0.12, -0.05, 0];

export function hurtPose(frame: number): DongPose {
  const pose = idlePose(0);
  pose.breath = HURT_BREATH[frame];
  pose.lean = HURT_LEAN[frame];
  pose.roll = frame <= 2 ? 0.05 : 0;
  pose.headPitch = HURT_HEAD[frame];
  pose.hip = add3(STANDING_HIP, v3(0, 0.02, HURT_HIP_BACK[frame]));
  pose.mouth = frame <= 2 ? 0.8 - frame * 0.2 : 0;
  pose.blink = frame <= 1 ? 1 : 0;
  const shift = sub3(pose.hip, STANDING_HIP);
  pose.rightArm = carried(
    shift,
    add3(UPRIGHT_CARRY_HAND, v3(0.02, 0, HURT_LANCE_BACK[frame] * 0.5)),
  );
  pose.lance = {
    kind: 'held',
    dir: normalize3(add3(UPRIGHT_LANCE_DIR, v3(0, 0, HURT_LANCE_BACK[frame]))),
    gripAlong: UPRIGHT_GRIP_ALONG,
  };
  const flung = v3(-0.34, -1.12, 0.08);
  pose.leftArm = {
    kind: 'reach',
    hand: add3(mix3(AKIMBO_HAND, flung, clamp01(1 - frame / 3)), shift),
  };
  pose.leftHand = frame <= 1 ? 'open' : 'fist';
  pose.rightFoot = planted(v3(STANCE_HALF, -ANKLE_HEIGHT, HURT_STEP_BACK[frame]));
  pose.beardSwing = -0.04 * Math.max(0, 2 - frame) * 0.5;
  pose.vestSwing = -0.03 * Math.max(0, 2 - frame) * 0.5;
  pose.pennonPhase = frame * 1.4;
  return pose;
}

// ── Death ────────────────────────────────────────────────────────────────────

/** Kneeling, the hip sits a thigh's length above his knees on the floor. */
const KNEEL_HIP_HEIGHT = 0.47;
const KNEEL_SHIN_BACK = 0.36;
/** Kneeling, the top of each boot lies on the floor with its sole turned up and its toe pointing back. */
const KNEEL_FOOT_PITCH = -2.9;
const DEATH_STAND_THROUGH = 0;
/**
 * The point he falls about, a little above his knees: his body lies on the
 * floor on its chest or its side, which is that thick, so pivoting on the
 * floor itself would sink the lower shoulder and his face through it.
 */
const DEATH_FALL_PIVOT: V3 = v3(0, -0.26, 0.02);
const DEATH_KNEEL_FROM = 3;
/** The lance slips from his hand two frames after the farewell: the gesture, then the letting go. */
const DEATH_LANCE_LET_GO = DONG_DEATH_FAREWELL_FRAME + 2;
/** The dropped lance topples over four frames, so it never crosses the cell in one. */
const DEATH_LANCE_FALL_FRAMES = 4;
/** Kneeling, he leans on the lance with his hand low on the shaft, at his shoulder's reach. */
const KNEEL_GRIP_ALONG = 0.62;
/**
 * The fall about his knees, keyed as shares of the frames from letting go of
 * the lance to the corpse: slow to tip, quick to land. He ends just short of
 * flat, because his arm is under him.
 */
const DEATH_FALL_SHARES: Keys = [
  [0, 0],
  [0.25, 0.25],
  [0.5, 0.75],
  [0.75, 1.35],
  [1, 1.5],
];
/** His eyes close as he goes over, two frames before he lands. */
const DEATH_EYES_CLOSE = DONG_DEATH_CORPSE_FRAME - 2;
/** Lying face-down, his chin is turned up onto his cheek, or the morion's front peak digs into the floor. */
const DEATH_CORPSE_CHIN = -0.4;

function deathFallAngle(frame: number): number {
  const share = (frame - DEATH_LANCE_LET_GO) / (DONG_DEATH_CORPSE_FRAME - DEATH_LANCE_LET_GO);
  return share <= 0 ? 0 : keyed(DEATH_FALL_SHARES, share);
}

/**
 * Which way he rolls head-on: +1 onto his left, −1 onto his right. Both put
 * him on the viewer's right — his left in the mirrored front view, his right
 * from behind — so the corpse needs room on one side of the cell only.
 */
function deathFallSide(view: DongView): number {
  return view === 'back' ? -1 : 1;
}

/** The dropped lance's direction on the floor, on the side he does not fall to. */
function fallenLanceDir(view: DongView): V3 {
  switch (view) {
    case 'side':
      return v3(0.9, -0.02, -0.55);
    case 'front':
      return v3(0.42, -0.02, -0.9);
    case 'back':
      return v3(-0.42, -0.02, -0.9);
  }
}

function deathLegs(pose: DongPose, frame: number): void {
  const kneel = keyed(
    [
      [DEATH_STAND_THROUGH, 0],
      [DEATH_KNEEL_FROM, 1],
    ],
    frame,
  );
  const shinBack = KNEEL_SHIN_BACK * kneel;
  const ankleHeight = lerp(ANKLE_HEIGHT, 0.055, kneel);
  pose.rightFoot = {
    ankle: v3(0.1, -ankleHeight, -shinBack + 0.02),
    pitch: KNEEL_FOOT_PITCH * kneel,
    planted: true,
  };
  pose.leftFoot = {
    ankle: v3(-0.1, -ankleHeight, -shinBack - 0.03 * (1 - kneel)),
    pitch: KNEEL_FOOT_PITCH * kneel,
    planted: true,
  };
  pose.hip = v3(0, -lerp(HIP_HEIGHT, KNEEL_HIP_HEIGHT, kneel), lerp(-0.04, 0.02, kneel));
}

export function deathPose(frame: number, view: DongView): DongPose {
  const pose = restingPose();
  deathLegs(pose, frame);
  pose.breath = keyed(
    [
      [0, 0.4],
      [2, 0],
    ],
    frame,
  );
  pose.lean = keyed(
    [
      [0, -0.16],
      [1, -0.1],
      [DEATH_KNEEL_FROM, 0.15],
      [DONG_DEATH_FAREWELL_FRAME, 0.05],
      [DEATH_LANCE_LET_GO, 0.2],
    ],
    frame,
  );
  pose.headPitch = keyed(
    [
      [0, -0.3],
      [2, 0.2],
      [DONG_DEATH_FAREWELL_FRAME - 1, 0.35],
      [DONG_DEATH_FAREWELL_FRAME, -0.1],
      [DONG_DEATH_FAREWELL_FRAME + 1, 0.1],
      [DEATH_LANCE_LET_GO + 1, 0.5],
      [DONG_DEATH_CORPSE_FRAME, DEATH_CORPSE_CHIN],
    ],
    frame,
  );
  pose.mouth = frame <= 1 ? 0.6 : frame === DONG_DEATH_FAREWELL_FRAME ? 0.35 : 0;
  pose.blink = frame >= DEATH_EYES_CLOSE || frame === 0 ? 1 : 0;
  const shift = sub3(pose.hip, STANDING_HIP);

  const chest = add3(v3(-0.1, -1.12, 0.3), shift);
  const farewell = add3(v3(-0.45, -1.66, 0.15), shift);
  const limp = add3(v3(-0.27, -0.9, 0.08), shift);
  const leftHand = keyedPoint(
    [
      [0, chest],
      [DEATH_KNEEL_FROM, chest],
      [DONG_DEATH_FAREWELL_FRAME - 1, limp],
      [DONG_DEATH_FAREWELL_FRAME, farewell],
      [DONG_DEATH_FAREWELL_FRAME + 1, farewell],
      [DEATH_LANCE_LET_GO, limp],
    ],
    frame,
  );
  pose.leftArm = { kind: 'reach', hand: leftHand };
  const waving = Math.abs(frame - DONG_DEATH_FAREWELL_FRAME) <= 1;
  pose.leftHand = waving ? 'open' : 'fist';

  const buttPlanted = v3(0.24, 0, 0.3);
  if (frame < DEATH_LANCE_LET_GO) {
    const tilt = keyed(
      [
        [0, 0],
        [2, 0.4],
        [DEATH_KNEEL_FROM + 1, 1],
      ],
      frame,
    );
    const leaning = normalize3(v3(-0.05, -1, -0.12));
    const dir = normalize3(mix3(UPRIGHT_LANCE_DIR, leaning, tilt));
    const kneelGrip = add3(buttPlanted, scale3(leaning, KNEEL_GRIP_ALONG));
    const standGrip = add3(UPRIGHT_CARRY_HAND, shift);
    pose.rightArm = { kind: 'reach', hand: mix3(standGrip, kneelGrip, tilt) };
    pose.lance = { kind: 'held', dir, gripAlong: lerp(UPRIGHT_GRIP_ALONG, KNEEL_GRIP_ALONG, tilt) };
  } else {
    const fall = clamp01((frame - DEATH_LANCE_LET_GO + 1) / DEATH_LANCE_FALL_FRAMES);
    // It falls clear of him and lies mostly along the floor's depth, where it
    // takes little width: behind him in profile, away from the side he falls to head-on.
    const flat = normalize3(fallenLanceDir(view));
    const dir = normalize3(mix3(normalize3(v3(-0.05, -1, -0.12)), flat, easeInOut(fall)));
    pose.lance = { kind: 'loose', butt: buttPlanted, dir };
    pose.rightArm = { kind: 'reach', hand: add3(v3(0.27, -0.9, 0.1), shift) };
  }
  pose.rightHand = frame < DEATH_LANCE_LET_GO ? 'grip' : 'open';

  const fallAngle = deathFallAngle(frame);
  if (fallAngle > 0) {
    pose.topple = {
      pivot: DEATH_FALL_PIVOT,
      angle: fallAngle * deathFallSide(view),
      plane: view === 'side' ? 'sagittal' : 'frontal',
    };
  }
  pose.pennonLift = 0.2;
  pose.pennonPhase = frame * 0.4;
  return pose;
}

// ── The row table ────────────────────────────────────────────────────────────

export type DongAction =
  | 'idle'
  | 'walk'
  | 'thrust'
  | 'charge_windup'
  | 'charge'
  | 'charge_recover'
  | 'salute'
  | 'hurt'
  | 'death';

export type DongRowKind = 'loop' | 'oneShot';

export interface DongRow {
  readonly action: DongAction;
  readonly frames: number;
  readonly kind: DongRowKind;
  readonly pose: (frame: number, view: DongView) => DongPose;
  /** The frame the blow lands on, for a strike. */
  readonly impactFrame?: number;
  /**
   * How the row's frames advance: by ground covered (a gait), by the clock
   * with per-frame holds, or by the progress of the action it shows.
   */
  readonly pacing: 'ground' | 'clock' | 'progress';
}

export const DONG_ROWS: ReadonlyMap<DongAction, DongRow> = new Map<DongAction, DongRow>([
  [
    'idle',
    { action: 'idle', frames: DONG_IDLE_FRAMES, kind: 'loop', pose: idlePose, pacing: 'clock' },
  ],
  [
    'walk',
    { action: 'walk', frames: DONG_WALK_FRAMES, kind: 'loop', pose: walkPose, pacing: 'ground' },
  ],
  [
    'thrust',
    {
      action: 'thrust',
      frames: DONG_THRUST_FRAMES,
      kind: 'oneShot',
      pose: thrustPose,
      impactFrame: DONG_THRUST_IMPACT_FRAME,
      pacing: 'progress',
    },
  ],
  [
    'charge_windup',
    {
      action: 'charge_windup',
      frames: DONG_CHARGE_WINDUP_FRAMES,
      kind: 'oneShot',
      pose: chargeWindupPose,
      pacing: 'progress',
    },
  ],
  [
    'charge',
    {
      action: 'charge',
      frames: DONG_CHARGE_FRAMES,
      kind: 'loop',
      pose: chargePose,
      pacing: 'ground',
    },
  ],
  [
    'charge_recover',
    {
      action: 'charge_recover',
      frames: DONG_CHARGE_RECOVER_FRAMES,
      kind: 'oneShot',
      pose: chargeRecoverPose,
      pacing: 'progress',
    },
  ],
  [
    'salute',
    {
      action: 'salute',
      frames: DONG_SALUTE_FRAMES,
      kind: 'oneShot',
      pose: salutePose,
      pacing: 'progress',
    },
  ],
  [
    'hurt',
    {
      action: 'hurt',
      frames: DONG_HURT_FRAMES,
      kind: 'oneShot',
      pose: hurtPose,
      pacing: 'progress',
    },
  ],
  [
    'death',
    {
      action: 'death',
      frames: DONG_DEATH_FRAMES,
      kind: 'oneShot',
      pose: deathPose,
      pacing: 'progress',
    },
  ],
]);

export const DONG_ACTIONS: readonly DongAction[] = [...DONG_ROWS.keys()];

export const DONG_VIEWS: readonly DongView[] = ['front', 'side', 'back'];

const VIEW_SUFFIX: Readonly<Record<DongView, string>> = { front: '', side: '_side', back: '_away' };

/** The state name a row takes in a view: `thrust`, `thrust_side`, `thrust_away`. */
export function dongStateName(action: DongAction, view: DongView): string {
  return `${action}${VIEW_SUFFIX[view]}`;
}

interface ResolvedState {
  readonly row: DongRow;
  readonly view: DongView;
}

const STATE_INDEX: ReadonlyMap<string, ResolvedState> = new Map(
  [...DONG_ROWS.values()].flatMap((row) =>
    DONG_VIEWS.map((view): [string, ResolvedState] => [
      dongStateName(row.action, view),
      { row, view },
    ]),
  ),
);

/** The row and view a state name paints, or undefined for a name the figure does not have. */
export function resolveDongState(state: string): ResolvedState | undefined {
  return STATE_INDEX.get(state);
}

/** The pose a state paints at a frame; throws on a state the figure does not have. */
export function dongPoseAt(state: string, frame: number): { pose: DongPose; view: DongView } {
  const resolved = STATE_INDEX.get(state);
  if (resolved === undefined) throw new Error(`Dong Quixote has no state "${state}"`);
  return { pose: resolved.row.pose(frame, resolved.view), view: resolved.view };
}

// ── Cell geometry ────────────────────────────────────────────────────────────

/**
 * Cell pixels per tile; the runtime scales by tileSize / TILE_SCALE. Painted
 * just above the 32 px game tile (and baked at twice that) rather than at
 * Carl's 64: every row he can play in a fight is warmed at once, and at 64
 * the set does not fit the frame cache's per-figure budget.
 */
export const TILE_SCALE = 36;
/**
 * How far his ink reaches from his origin, in tiles, a little past the widest
 * pose on each side. Left: the bow's dipped lance and the dropped lance
 * head-on. Right: the thrust's point at full reach in profile (the cell is
 * mirrored about his tile's centre for a left facing). Up: the saluting
 * point. Down: a lance lying toward the camera from behind. The cell is cut
 * to these and no wider; the structural gate fails any pose that outgrows it.
 */
const REACH_LEFT_TILES = 1.25;
const REACH_RIGHT_TILES = 2.11;
const REACH_UP_TILES = 2.83;
const REACH_DOWN_TILES = 0.53;
/** The ground line's row within his tile: where Carl's feet sit, rounded to a whole row. */
export const GROUND_ROW_IN_TILE = 33;
export const ORIGIN_X = Math.round(REACH_LEFT_TILES * TILE_SCALE);
export const ORIGIN_Y = Math.round(REACH_UP_TILES * TILE_SCALE);
export const FRAME_W = ORIGIN_X + Math.round(REACH_RIGHT_TILES * TILE_SCALE);
export const FRAME_H = ORIGIN_Y + Math.round(REACH_DOWN_TILES * TILE_SCALE);
export const TILE_X = ORIGIN_X - TILE_SCALE / 2;
export const TILE_Y = ORIGIN_Y - GROUND_ROW_IN_TILE;

/** A figure-space point in cell pixels. */
export function toCellPx(x: number, y: number): { x: number; y: number } {
  return { x: ORIGIN_X + x * TILE_SCALE, y: ORIGIN_Y + y * TILE_SCALE };
}

function paintDongFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const resolved = STATE_INDEX.get(state);
  if (resolved === undefined) return;
  const pose = resolved.row.pose(frame, resolved.view);
  ctx.save();
  try {
    ctx.translate(ORIGIN_X, ORIGIN_Y);
    ctx.scale(TILE_SCALE, TILE_SCALE);
    drawDongQuixote(ctx, pose, resolved.view);
  } finally {
    ctx.restore();
  }
}

function stateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const [state, resolved] of STATE_INDEX) frames[state] = resolved.row.frames;
  return frames;
}

export const DONG_QUIXOTE_FIGURE: FigureDef = {
  id: 'dong_quixote',
  frameWidth: FRAME_W,
  frameHeight: FRAME_H,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(stateFrames()),
  paintFrame: paintDongFrame,
};

/** The lance's full length, re-exported for the kit's reach arithmetic. */
export const DONG_LANCE_LENGTH = LANCE_LENGTH;
