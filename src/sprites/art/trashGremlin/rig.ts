/**
 * The Trash Gremlin's rig: the pose a row hands the painter, the skeleton that
 * pose solves into, and how a point on that skeleton lands on the screen in
 * each of the three views.
 *
 * The skeleton is solved once, in three dimensions, and *projected* into a
 * view. A hunched biped is the case that breaks a per-view 2D rig: the spine
 * pitching forward has to shorten the torso head-on, swing it out edge-on and
 * hide the head behind the bin lid from behind, and one solve projected three
 * ways gets all of that from the same numbers instead of three sets of
 * multipliers that drift apart.
 *
 * Body space: +X the figure's own right, +Y down, +Z the way it faces, origin
 * on the ground between its feet.
 */

import { type Pt, clamp01 } from '../bipedArt';
import { pt } from '../biped/geometry';
import {
  ANKLE_HEIGHT,
  ARM_REACH,
  FOREARM_LENGTH,
  HEAD_ABOVE_NECK,
  HIP_JOINT_DROP,
  HIP_Y,
  JOINT_SLACK,
  LEG_REACH,
  LEG_ROOT_HALF,
  NECK_BASE,
  NECK_LENGTH,
  SHIN_LENGTH,
  SHOULDER_DROP,
  SHOULDER_HALF,
  THIGH_LENGTH,
  TORSO_LENGTH,
  UPPER_ARM_LENGTH,
} from './proportions';

export type { Pt };

export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}

export function add(a: V3, b: V3): V3 {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function sub(a: V3, b: V3): V3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(a: V3, k: number): V3 {
  return v3(a.x * k, a.y * k, a.z * k);
}

export function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}

const DEGENERATE_LENGTH = 1e-9;

export function normalize(a: V3): V3 {
  const len = length(a);
  return len < DEGENERATE_LENGTH ? v3(0, 0, 0) : scale(a, 1 / len);
}

/** `base + dir·k`. */
export function offset(base: V3, dir: V3, k: number): V3 {
  return v3(base.x + dir.x * k, base.y + dir.y * k, base.z + dir.z * k);
}

/** `base + a·ka + b·kb`, the shape almost every placement on the body takes. */
export function along(base: V3, a: V3, ka: number, b: V3, kb: number): V3 {
  return v3(
    base.x + a.x * ka + b.x * kb,
    base.y + a.y * ka + b.y * kb,
    base.z + a.z * ka + b.z * kb,
  );
}

export { pt };

// ── Views ────────────────────────────────────────────────────────────────────

export type GremlinView = 'front' | 'side' | 'back';

/**
 * How much screen height one unit of floor depth takes at the soles. The floor
 * is seen from above while the figure stands as if seen level, so a foot a step
 * nearer the camera draws lower on the screen — but a knee driven at the camera
 * must not, so the share fades out up the leg and is nothing at the hip.
 */
const HEAD_ON_FLOOR_DEPTH_SHARE = 0.15;
/** Edge-on the depth is across the body, a step's width at most, so it takes less. */
const PROFILE_FLOOR_DEPTH_SHARE = 0.08;
const DEPTH_FADE_HEIGHT = -HIP_Y;

function depthFadeAt(y: number): number {
  return clamp01(1 + y / DEPTH_FADE_HEIGHT);
}

/**
 * The body-space point on the screen, in figure units.
 *
 * Head-on the figure's own right lands on the screen's left, so a torn left ear
 * stays on the figure's left whichever way it turns. The profile faces screen
 * right and shows the figure's right side; the runtime mirrors it for the left.
 */
export function project(p: V3, view: GremlinView): Pt {
  const fade = depthFadeAt(p.y);
  if (view === 'front') return pt(-p.x, p.y + p.z * HEAD_ON_FLOOR_DEPTH_SHARE * fade);
  if (view === 'back') return pt(p.x, p.y - p.z * HEAD_ON_FLOOR_DEPTH_SHARE * fade);
  return pt(p.z, p.y + p.x * PROFILE_FLOOR_DEPTH_SHARE * fade);
}

/** How near the camera a body-space point is in a view; larger is nearer. */
export function nearness(p: V3, view: GremlinView): number {
  if (view === 'front') return p.z;
  if (view === 'back') return -p.z;
  return p.x;
}

// ── Pose ─────────────────────────────────────────────────────────────────────

/** A walking arm swung from the shoulder by joint angles rather than placed by its hand. */
export interface ArmAngles {
  /** Swing about the shoulder, forward positive, from hanging straight down. */
  readonly swing: number;
  /** How far the arm is carried out from the body. */
  readonly spread: number;
  /** Forward bend at the elbow. */
  readonly elbow: number;
}

export interface EarPose {
  /** Rotation of the ear about its root, upward positive. */
  readonly lift: number;
  /** How far the ear is folded back along its length, 0 spread to 1 flat. */
  readonly fold: number;
}

export interface GremlinPose {
  /** Pelvis drop below standing height, positive down. */
  bob: number;
  /** Pelvis travel to the figure's right. */
  sway: number;
  /** How full the chest and belly are, 0 out to 1 in. */
  breath: number;
  /** Pelvis travel forward. */
  hipForward: number;
  /** Forward pitch of the spine from vertical, in radians. */
  hunch: number;
  /** Roll of the spine toward the figure's right. */
  lean: number;
  /** Turn of the shoulders about the spine. */
  twist: number;
  /** How much further forward than the spine the neck carries the head. */
  neckPitch: number;
  /** Head tilt, chin-down positive; negative throws the head back. */
  headPitch: number;
  /** Mouth opening, 0 shut to 1 at full gape. */
  jaw: number;
  /** 0 open to 1 shut. */
  blink: number;
  /** Brow drawn down over the eyes, 0 to 1. */
  scowl: number;
  /** How swollen the throat sac is, 0 to 1. */
  sac: number;
  /** How brightly the sac glows, 0 to 1. */
  sacGlow: number;
  leftEar: EarPose;
  rightEar: EarPose;
  /** Where each sole meets the ground, in body space; y below zero is lifted. */
  leftFoot: V3;
  rightFoot: V3;
  /** Toe-down positive. */
  leftFootPitch: number;
  rightFootPitch: number;
  /** IK targets for each wrist, used when the arm has no joint angles. */
  leftHand: V3;
  rightHand: V3;
  leftArm: ArmAngles | null;
  rightArm: ArmAngles | null;
  /** 0 open hand to 1 closed fist. */
  leftFist: number;
  rightFist: number;
  /** Sideways sweep of the tail along the floor, radians. */
  tailSwing: number;
  /** How tightly its last third curls, 0 to 1. */
  tailCurl: number;
  /** Swing of the dangling cans, forward positive, radians. */
  canSwing: number;
  /** How far the cans and sack are thrown upward this frame, in tiles. */
  canLift: number;
  /** How much of the spray is leaving its mouth, 0 to 1. */
  spew: number;
}

/** The ears' resting tilt above level: they stand out and a little up. */
export const EAR_REST_LIFT = 0.16;

const REST_FOOT_SPREAD = 0.25;
const REST_FOOT_LEAD = 0.03;
const REST_HAND_SPREAD = 0.42;
const REST_HAND_Y = -0.42;
const REST_HAND_LEAD = 0.1;

/** The upright figure at rest; every row is written as edits to this. */
export function restingPose(): GremlinPose {
  return {
    bob: 0,
    sway: 0,
    breath: 0,
    hipForward: 0,
    hunch: 0,
    lean: 0,
    twist: 0,
    neckPitch: 0,
    headPitch: 0,
    jaw: 0,
    blink: 0,
    scowl: 0.4,
    sac: 0,
    sacGlow: 0.2,
    leftEar: { lift: EAR_REST_LIFT, fold: 0 },
    rightEar: { lift: EAR_REST_LIFT, fold: 0 },
    leftFoot: v3(-REST_FOOT_SPREAD, 0, REST_FOOT_LEAD),
    rightFoot: v3(REST_FOOT_SPREAD, 0, REST_FOOT_LEAD),
    leftFootPitch: 0,
    rightFootPitch: 0,
    leftHand: v3(-REST_HAND_SPREAD, REST_HAND_Y, REST_HAND_LEAD),
    rightHand: v3(REST_HAND_SPREAD, REST_HAND_Y, REST_HAND_LEAD),
    leftArm: null,
    rightArm: null,
    leftFist: 0.25,
    rightFist: 0.25,
    tailSwing: 0,
    tailCurl: 0.5,
    canSwing: 0,
    canLift: 0,
    spew: 0,
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export interface Chain {
  readonly root: V3;
  readonly joint: V3;
  readonly end: V3;
}

export interface Skeleton {
  readonly pelvis: V3;
  readonly chest: V3;
  readonly neckBase: V3;
  readonly neckTop: V3;
  readonly head: V3;
  /** Unit vectors along the spine (pelvis to chest), out of its back, and to its right. */
  readonly spine: V3;
  readonly back: V3;
  readonly right: V3;
  /** The head's own frame: up through the crown, forward out of the face, right. */
  readonly headUp: V3;
  readonly headForward: V3;
  readonly headRight: V3;
  readonly leftLeg: Chain;
  readonly rightLeg: Chain;
  readonly leftArm: Chain;
  readonly rightArm: Chain;
}

/**
 * How much of the spine's pitch the head follows. A gremlin hunched over keeps
 * its face toward whatever it is watching rather than at the floor, so the
 * head takes only a share of the bend below it.
 */
const HEAD_FOLLOWS_NECK = 0.25;
/** The neck always carries the head a little forward of the spine. */
const NECK_FORWARD_REST = 0.35;

/** Knees bow out to the sides as well as forward: the bowed legs. */
const KNEE_BOW_OUT = 1.8;
/** Elbows break back and out, away from the ribs. */
const ELBOW_POLE_OUT = 0.6;
const ELBOW_POLE_DOWN = 0.2;

/** The up vector of something pitched forward by `pitch` and rolled right by `roll`. */
function pitchedUp(pitch: number, roll: number): V3 {
  return normalize(
    v3(Math.sin(roll) * Math.cos(pitch), -Math.cos(roll) * Math.cos(pitch), Math.sin(pitch)),
  );
}

function cross(a: V3, b: V3): V3 {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

/**
 * Two-bone IK in three dimensions, the joint bending toward `pole`. A target out
 * of reach is pulled in to it rather than leaving the chain short: the gates
 * read the *demand* off the pose, so a clamp here is never silent.
 */
function solveTwoBone(root: V3, target: V3, upper: number, lower: number, pole: V3): Chain {
  const toTarget = sub(target, root);
  const reach = upper + lower - JOINT_SLACK;
  const distance = Math.min(length(toTarget), reach);
  const axis = normalize(toTarget);
  const end = offset(root, axis, distance);
  const across = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const rise = Math.sqrt(Math.max(0, upper * upper - across * across));
  const poleOff = sub(pole, scale(axis, dot(pole, axis)));
  const bend = normalize(poleOff);
  const joint = along(root, axis, across, bend, rise);
  return { root, joint, end };
}

function armFromAngles(root: V3, angles: ArmAngles, side: number): Chain {
  const upperDir = v3(
    side * Math.sin(angles.spread),
    Math.cos(angles.spread) * Math.cos(angles.swing),
    Math.cos(angles.spread) * Math.sin(angles.swing),
  );
  const joint = offset(root, upperDir, UPPER_ARM_LENGTH);
  const foreSwing = angles.swing + angles.elbow;
  const foreDir = v3(
    side * Math.sin(angles.spread),
    Math.cos(angles.spread) * Math.cos(foreSwing),
    Math.cos(angles.spread) * Math.sin(foreSwing),
  );
  const end = offset(joint, foreDir, FOREARM_LENGTH);
  return { root, joint, end };
}

/** Where a sole's ankle sits above it. */
export function ankleOf(foot: V3): V3 {
  return v3(foot.x, foot.y - ANKLE_HEIGHT, foot.z);
}

function pelvisOf(pose: GremlinPose): V3 {
  return v3(pose.sway, HIP_Y + pose.bob, pose.hipForward);
}

function legRootOf(pelvis: V3, side: number): V3 {
  return v3(pelvis.x + side * LEG_ROOT_HALF, pelvis.y + HIP_JOINT_DROP, pelvis.z);
}

export function buildSkeleton(pose: GremlinPose): Skeleton {
  const pelvis = pelvisOf(pose);
  const spine = pitchedUp(pose.hunch, pose.lean);
  const back = normalize(v3(0, -Math.sin(pose.hunch), -Math.cos(pose.hunch)));
  const right = normalize(cross(spine, back));
  const chest = offset(pelvis, spine, TORSO_LENGTH);
  const neckBase = offset(chest, spine, NECK_BASE);
  const neckDir = pitchedUp(pose.hunch + NECK_FORWARD_REST + pose.neckPitch, pose.lean);
  const neckTop = offset(neckBase, neckDir, NECK_LENGTH);
  const headTilt =
    (pose.hunch + NECK_FORWARD_REST + pose.neckPitch) * HEAD_FOLLOWS_NECK + pose.headPitch;
  const headUp = pitchedUp(headTilt, pose.lean * HEAD_FOLLOWS_NECK);
  const headForward = normalize(v3(0, Math.sin(headTilt), Math.cos(headTilt)));
  const headRight = normalize(cross(headForward, headUp));
  const head = offset(neckTop, headUp, HEAD_ABOVE_NECK);

  const twistedRight = v3(Math.cos(pose.twist), 0, -Math.sin(pose.twist));
  const shoulderBase = offset(chest, spine, -SHOULDER_DROP);
  const leftShoulder = offset(shoulderBase, twistedRight, -SHOULDER_HALF);
  const rightShoulder = offset(shoulderBase, twistedRight, SHOULDER_HALF);

  const leftLeg = solveTwoBone(
    legRootOf(pelvis, -1),
    ankleOf(pose.leftFoot),
    THIGH_LENGTH,
    SHIN_LENGTH,
    normalize(v3(-KNEE_BOW_OUT, 0, 1)),
  );
  const rightLeg = solveTwoBone(
    legRootOf(pelvis, 1),
    ankleOf(pose.rightFoot),
    THIGH_LENGTH,
    SHIN_LENGTH,
    normalize(v3(KNEE_BOW_OUT, 0, 1)),
  );
  const leftArm =
    pose.leftArm === null
      ? solveTwoBone(
          leftShoulder,
          pose.leftHand,
          UPPER_ARM_LENGTH,
          FOREARM_LENGTH,
          normalize(v3(-ELBOW_POLE_OUT, ELBOW_POLE_DOWN, -1)),
        )
      : armFromAngles(leftShoulder, pose.leftArm, -1);
  const rightArm =
    pose.rightArm === null
      ? solveTwoBone(
          rightShoulder,
          pose.rightHand,
          UPPER_ARM_LENGTH,
          FOREARM_LENGTH,
          normalize(v3(ELBOW_POLE_OUT, ELBOW_POLE_DOWN, -1)),
        )
      : armFromAngles(rightShoulder, pose.rightArm, 1);

  return {
    pelvis,
    chest,
    neckBase,
    neckTop,
    head,
    spine,
    back,
    right,
    headUp,
    headForward,
    headRight,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
  };
}

/**
 * How far each leg is asked to reach on this pose, hip socket to ankle, in
 * tiles. Read off the pose rather than the solved chain: the IK clamps, so a
 * gate reading the chain could only ever measure equality.
 */
export function legReachDemand(pose: GremlinPose): { left: number; right: number } {
  const pelvis = pelvisOf(pose);
  return {
    left: length(sub(ankleOf(pose.leftFoot), legRootOf(pelvis, -1))),
    right: length(sub(ankleOf(pose.rightFoot), legRootOf(pelvis, 1))),
  };
}

/** How far each IK-placed arm is asked to reach, or null for an arm driven by angles. */
export function armReachDemand(pose: GremlinPose): { left: number | null; right: number | null } {
  const skeleton = buildSkeleton(pose);
  return {
    left: pose.leftArm === null ? length(sub(pose.leftHand, skeleton.leftArm.root)) : null,
    right: pose.rightArm === null ? length(sub(pose.rightHand, skeleton.rightArm.root)) : null,
  };
}

export { ARM_REACH, LEG_REACH };
