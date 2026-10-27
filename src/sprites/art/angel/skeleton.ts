/**
 * Angel's skeleton: the solved 3D body every view is projected from, and the
 * solvers that build it.
 *
 * Every view is the same body: x runs across her (+x is her right as seen from
 * behind), y runs down, z runs forward along her heading. The front, back and
 * profile drawings are projections of one solve, so a foot a profile shows
 * ahead of her and the same foot head-on can never disagree, and an arm reached
 * forward in profile foreshortens head-on by construction.
 *
 * Nothing here knows about time: a skeleton is solved from a pose, and the
 * choreography (`dance/`) decides the pose for each frame.
 */

import { clamp01 } from '../bipedArt';
import { HEAD_ON_FLOOR_FORESHORTENING } from '../biped/rig';
import {
  ANKLE_HEIGHT,
  ANKLE_Y,
  ARM_ROOT_X,
  ARM_ROOT_Y,
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

const DEGREES = Math.PI / 180;

export const SIDES = [-1, 1] as const;
export type BodySide = (typeof SIDES)[number];
export type AngelView = 'front' | 'back' | 'side';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Pt2 {
  x: number;
  y: number;
}

export interface AngelLeg {
  hip: V3;
  knee: V3;
  ankle: V3;
  heel: V3;
  ball: V3;
  toe: V3;
  /** The foot's angle to the floor: positive with the toes raised. */
  pitch: number;
  /** 0 while it carries weight, rising to 1 with the foot well off the floor. */
  swing: number;
}

export interface AngelArm {
  shoulder: V3;
  elbow: V3;
  wrist: V3;
  fingertip: V3;
  /** 0 a relaxed, loosely curled hand to 1 fingers splayed open. */
  open: number;
  /** 0 a free hand to 1 a fist closed round the pole. */
  grip: number;
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

export interface AngelSkeleton {
  legs: Record<BodySide, AngelLeg>;
  arms: Record<BodySide, AngelArm>;
  pelvis: SectionFrame;
  chest: SectionFrame;
  /** The head's own turn on top of the chest's, in the frontal and sagittal planes. */
  headRoll: number;
  headPitch: number;
  /** 0 facing where her chest faces to 1 turned to look back over her shoulder. */
  lookBack: number;
  /** Her hair's lag behind the body: across, back along her heading, and up. */
  hairSway: number;
  hairTrail: number;
  hairLift: number;
  /** How far her hair swings about the crown against the head's own pitch, radians. */
  hairSwing: number;
}

/* ── Small vector helpers ──────────────────────────────────────────────── */

export function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}

export function add3(a: V3, b: V3): V3 {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub3(a: V3, b: V3): V3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale3(a: V3, k: number): V3 {
  return v3(a.x * k, a.y * k, a.z * k);
}

export function length3(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function dot3(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Guards a direction taken from a vector that has collapsed to a point. */
const DEGENERATE_LENGTH = 1e-6;

export function normalize3(a: V3): V3 {
  return scale3(a, 1 / Math.max(length3(a), DEGENERATE_LENGTH));
}

export function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
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

export const PELVIS_PIVOT_Y = HIP_JOINT_Y;
export const CHEST_PIVOT_Y = WAIST_Y;

export function restFrame(partial: Partial<SectionFrame> = {}): SectionFrame {
  return { x: 0, y: 0, z: 0, roll: 0, yaw: 0, pitch: 0, ...partial };
}

export function hipJointOf(pelvis: SectionFrame, side: BodySide): V3 {
  return placeInSection(pelvis, PELVIS_PIVOT_Y, v3(side * HIP_JOINT_X, HIP_JOINT_Y, 0));
}

export function shoulderOf(chest: SectionFrame, side: BodySide): V3 {
  return placeInSection(chest, CHEST_PIVOT_Y, v3(side * ARM_ROOT_X, ARM_ROOT_Y, 0));
}

/* ── Feet ──────────────────────────────────────────────────────────────── */

export interface FootPlacement {
  heel: V3;
  ankle: V3;
  ball: V3;
  toe: V3;
  pitch: number;
}

const TOE_TIP_HEIGHT = 0.006;
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
export function placeFoot(
  x: number,
  pivotZ: number,
  pitch: number,
  pivotOnBall: boolean,
): FootPlacement {
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
export function footFromAnkle(ankle: V3, pitch: number): FootPlacement {
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

/** The lowest any point of a placed foot sits above the floor; negative is through it. */
export function footClearance(foot: Pick<AngelLeg, 'heel' | 'ball' | 'toe'>): number {
  return FOOT_Y - Math.max(foot.heel.y, foot.ball.y, foot.toe.y);
}

/* ── Legs ──────────────────────────────────────────────────────────────── */

/** Straight enough to read as a straight leg, never so straight the knee locks backward. */
const STANCE_REACH = 0.997;
export const LEG_MAX_REACH = LEG_LENGTH * STANCE_REACH;

/**
 * Two-bone solve with the knee bending forward along her heading, turned out
 * toward her own side by `splay` radians: a squat with the knees apart is the
 * same solve as one with them together, with the bend swung outward.
 */
export function solveKnee(hip: V3, ankle: V3, side: BodySide, splay = 0): V3 {
  const span = sub3(ankle, hip);
  const dist = Math.max(length3(span), DEGENERATE_LENGTH);
  const reach = Math.min(dist, LEG_MAX_REACH);
  const along =
    (THIGH_LENGTH * THIGH_LENGTH - SHIN_LENGTH * SHIN_LENGTH + reach * reach) / (2 * reach);
  const out = Math.sqrt(Math.max(0, THIGH_LENGTH * THIGH_LENGTH - along * along));
  const axis = scale3(span, 1 / dist);
  const hint = v3(side * Math.sin(splay), 0, Math.cos(splay));
  const hintAlong = dot3(axis, hint);
  const bend = sub3(hint, scale3(axis, hintAlong));
  const bendLength = Math.max(length3(bend), DEGENERATE_LENGTH);
  return add3(add3(hip, scale3(axis, along)), scale3(bend, out / bendLength));
}

/** The highest the hip may sit (smallest y) and still let a planted ankle be reached. */
export function hipFloorFor(hip: V3, ankle: V3): number {
  const dx = ankle.x - hip.x;
  const dz = ankle.z - hip.z;
  return ankle.y - Math.sqrt(Math.max(0, LEG_MAX_REACH * LEG_MAX_REACH - dx * dx - dz * dz));
}

/* ── Arms ──────────────────────────────────────────────────────────────── */

export interface ArmAngles {
  abduction: number;
  flex: number;
  elbowFlex: number;
  /** Extra outward turn of the forearm past the upper arm. */
  carry: number;
  wristFlex: number;
  open: number;
}

/**
 * A woman's arms hang close at the shoulder and angle out at the elbow — the
 * carrying angle — which is what lets her hands clear her hips.
 */
const ARM_REST_ABDUCTION = 5 * DEGREES;
const CARRYING_ANGLE = 11 * DEGREES;
const ELBOW_REST_FLEX = 14 * DEGREES;
const WRIST_REST_FLEX = 8 * DEGREES;

export const REST_ARM: ArmAngles = {
  abduction: ARM_REST_ABDUCTION,
  flex: 0,
  elbowFlex: ELBOW_REST_FLEX,
  carry: CARRYING_ANGLE,
  wristFlex: WRIST_REST_FLEX,
  open: 0,
};

/** Raising an arm past level lifts its shoulder with it, by up to this much. */
const SHOULDER_SHRUG = 0.012;

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

/** An arm placed by its joint angles: what a hanging or swinging arm wants. */
export function solveArmFromAngles(side: BodySide, rootShoulder: V3, a: ArmAngles): AngelArm {
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
    grip: 0,
  };
}

/** Never quite straight, so the elbow keeps a direction to bend in. */
const ARM_MAX_REACH_SHARE = 0.998;
export const ARM_MAX_REACH = (UPPER_ARM_LENGTH + FOREARM_LENGTH) * ARM_MAX_REACH_SHARE;

/** Where an arm is asked to put its hand, and which way the elbow should point. */
export interface ArmTarget {
  wrist: V3;
  /** A point the elbow bends toward; only its direction off the shoulder–wrist line counts. */
  elbowToward: V3;
  /** The direction from wrist to fingertips. */
  handDirection: V3;
  open: number;
  grip: number;
}

/**
 * An arm placed by its hand: two-bone solve from the shoulder to the wrist,
 * bending toward `elbowToward`. A wrist out of reach is pulled in along the
 * line to it rather than leaving the arm stretched past its length.
 */
export function solveArmToTarget(rootShoulder: V3, target: ArmTarget): AngelArm {
  const raise = clamp01((rootShoulder.y - target.wrist.y) / UPPER_ARM_LENGTH);
  const shoulder = { ...rootShoulder, y: rootShoulder.y - SHOULDER_SHRUG * raise };
  const span = sub3(target.wrist, shoulder);
  const dist = Math.max(length3(span), DEGENERATE_LENGTH);
  const reach = Math.min(dist, ARM_MAX_REACH);
  const axis = scale3(span, 1 / dist);
  const wrist = add3(shoulder, scale3(axis, reach));
  const along =
    (UPPER_ARM_LENGTH * UPPER_ARM_LENGTH - FOREARM_LENGTH * FOREARM_LENGTH + reach * reach) /
    (2 * reach);
  const out = Math.sqrt(Math.max(0, UPPER_ARM_LENGTH * UPPER_ARM_LENGTH - along * along));
  const hint = sub3(target.elbowToward, shoulder);
  const bend = sub3(hint, scale3(axis, dot3(axis, hint)));
  const elbow = add3(add3(shoulder, scale3(axis, along)), scale3(normalize3(bend), out));
  return {
    shoulder,
    elbow,
    wrist,
    fingertip: add3(wrist, scale3(normalize3(target.handDirection), HAND_LENGTH)),
    open: target.open,
    grip: target.grip,
  };
}

/** The target an arm already solved would ask for, so a solved arm can be blended with a reached one. */
export function targetOfArm(arm: AngelArm): ArmTarget {
  return {
    wrist: arm.wrist,
    elbowToward: arm.elbow,
    handDirection: sub3(arm.fingertip, arm.wrist),
    open: arm.open,
    grip: arm.grip,
  };
}

/* ── Projection ────────────────────────────────────────────────────────── */

/**
 * Head-on, a point's distance ahead of her draws as a little screen height —
 * the floor's share near the ground, nothing at the hip — because the floor is
 * seen from above while she stands as if seen level (see the biped rig's `depthShareAt`).
 */
function depthShare(y: number): number {
  return HEAD_ON_FLOOR_FORESHORTENING * clamp01((y - HIP_JOINT_Y) / (ANKLE_Y - HIP_JOINT_Y));
}

export function project(view: AngelView, p: V3): Pt2 {
  if (view === 'side') return { x: p.z, y: p.y };
  const depth = p.z * depthShare(p.y);
  return { x: p.x, y: view === 'front' ? p.y + depth : p.y - depth };
}

function mirrorPoint(p: V3): V3 {
  return v3(-p.x, p.y, p.z);
}

function mirrorFrame(f: SectionFrame): SectionFrame {
  return { ...f, x: -f.x, roll: -f.roll, yaw: -f.yaw };
}

/**
 * The skeleton with its sides exchanged: her right drawn where her left was.
 * Head-on from the front her right is on the viewer's left, and in profile
 * facing left the side nearer the camera is her left; the painters draw the
 * body as seen from behind and as her right-side profile, and this is what
 * turns either into the other view.
 */
export function mirrorSkeleton(s: AngelSkeleton): AngelSkeleton {
  const leg = (l: AngelLeg): AngelLeg => ({
    ...l,
    hip: mirrorPoint(l.hip),
    knee: mirrorPoint(l.knee),
    ankle: mirrorPoint(l.ankle),
    heel: mirrorPoint(l.heel),
    ball: mirrorPoint(l.ball),
    toe: mirrorPoint(l.toe),
  });
  const arm = (a: AngelArm): AngelArm => ({
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
