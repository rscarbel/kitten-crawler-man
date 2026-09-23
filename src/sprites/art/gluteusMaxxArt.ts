/**
 * Gluteus Maxx, the Meat Shields brawler, as a painted figure: a short,
 * barrel-chested, hairy muscle man in a blue Speedo, wearing a pair of steel
 * war gauntlets nearly as big as his head.
 *
 * This module is the painter and nothing else. It knows his proportions, his
 * palette, a rig posed in three dimensions and one painter per view; it knows
 * nothing about animation. `gluteusMaxxFigure.ts` choreographs the rows.
 *
 * **One pose, three views.** A pose is a skeleton in figure space — x his own
 * right, y down, z the way he faces — and each view is an orthographic camera
 * on it. A knee driven forward therefore reads head-on as the leg narrowing
 * toward the camera rather than as a sideways angle, and an arm swinging
 * forward foreshortens and rises a little at both ends of its swing without
 * anybody authoring that per view. The camera looks down at the floor, so
 * depth along the floor shows as a little screen height near the ground and
 * fades out toward the hips, the way it does for Carl.
 *
 * **Handedness.** Seen from behind his right is at +X; head-on it is mirrored
 * onto the viewer's left. The Meat Shields armband is on his right upper arm,
 * which is the near arm in profile, so it shows in all three views.
 *
 * **Outline.** The silhouette is inked, the internal boundaries are not: every
 * part first lays down its dilated shape in the outline tone, and only then are
 * the parts painted over it in depth order. An arm over the chest is separated
 * from it by a soft cast shadow instead of an ink ring, which would read as a
 * paper doll.
 *
 * **Hair.** Body hair is a texture, not stripes: a soft tonal patch under a
 * scatter of short curled strands, fixed to the limb or torso frame it grows
 * on so it rides the body rather than swimming over it, plus tufts breaking
 * the silhouette along the outer edge of each leg and upper arm. At the
 * 32 px tile the strands merge into a
 * mottled darker tone and the tufts make a fuzzy edge, which is the read.
 */

import { clamp01, clampAlpha, deg, lerp, mix, type Pt } from './carlArt';
import { fillSoftEllipse, strokeSoftCrease, withClip, type CreaseLayer } from './softShade';

type Ctx = CanvasRenderingContext2D;

export const TWO_PI = Math.PI * 2;

// ── Palette ──────────────────────────────────────────────────────────────────

interface Ramp {
  readonly deep: string;
  readonly shadow: string;
  readonly base: string;
  readonly light: string;
  readonly rim: string;
}

/** Olive skin with a warm tan; hue cools toward the shadow end. */
const SKIN: Ramp = {
  deep: '#4f2621',
  shadow: '#86452f',
  base: '#c98459',
  light: '#e6a87a',
  rim: '#f6d0a4',
};
/** Body and head hair: nearly black brown, with a warm lift for its lit strands. */
const HAIR: Ramp = {
  deep: '#0f0907',
  shadow: '#1d120d',
  base: '#2e1d14',
  light: '#5a3a27',
  rim: '#86603f',
};
/**
 * Royal blue: the one saturated colour on him besides the armband, and blue
 * because it is as far from the armband's orange and his tan as a hue can get.
 */
const SPEEDO: Ramp = {
  deep: '#0d1b52',
  shadow: '#172f86',
  base: '#2652c4',
  light: '#4d7fe6',
  rim: '#9dbcff',
};
const SPEEDO_STRIPE = '#f1efe6';
const STEEL: Ramp = {
  deep: '#1a1d24',
  shadow: '#383e49',
  base: '#6c7481',
  light: '#a9b2bf',
  rim: '#e9eef6',
};
const BRASS = '#d4a64a';
const BRASS_DARK = '#76541b';
/** The Meat Shields zone colour, so every hireling carries the same mark. */
const ARMBAND_BASE = '#e06040';
const ARMBAND_LIGHT = '#f59a78';
const ARMBAND_SHADOW = '#9c3a26';
/** A warm plum rather than black: near-black ink at 32 px reads as a hole. */
const OUTLINE = '#27131b';
const OUTLINE_ALPHA = 0.92;
const EYE_WHITE = '#f6f0e4';
const PUPIL = '#1a0e0b';
const TEETH = '#fbf5e8';
const MOUTH = '#4a1219';
const TONGUE = '#d9606a';
const SPARK_HOT = '#fff8dc';
const SPARK_WARM = '#ffcf5a';
const DUST = '#b9a488';
const DUST_SHADOW = '#7e6a52';
const STAR = '#ffe66b';
const GROUND_SHADOW = '#000000';

/** The key light comes from the upper left, in screen space, in every view. */
const LIGHT: Pt = { x: -0.6, y: -0.8 };

// ── Proportions (tiles; origin between the feet on the floor, +Y down) ───────

/**
 * He stands about 1.3 tiles to the top of his hair, four fifths of Carl, and
 * about four and a third heads tall: a short man with an ordinary-sized head,
 * which is what reads as short rather than as a small person. Everything below
 * is derived from those, never from the head.
 */
export const ANKLE_HEIGHT = 0.055;
/**
 * The whole painted body is drawn this much smaller than the tables below,
 * about his own ground point, so he stands about three quarters of Carl's
 * height. Applied at draw time rather than to the proportions, so the rig,
 * the choreography and their gates keep their authored numbers; anything
 * that turns rig distances into screen distances multiplies by it.
 */
export const MAXX_BODY_SCALE = 0.9;
export const THIGH_LENGTH = 0.245;
export const SHIN_LENGTH = 0.24;
/**
 * The hip joint's standing height. A little under the leg's full reach, so the
 * knees hold an athletic bend at rest: a boxer on his toes never locks them.
 */
export const HIP_HEIGHT = 0.5;
/** A leg can never be solved fully straight; the IK holds this much back. */
const JOINT_SLACK = 1e-4;
export const LEG_REACH = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

/** Heights above the hip joint along the spine, before any lean. */
const WAIST_UP = 0.15;
const CHEST_UP = 0.3;
const SHOULDER_JOINT_UP = 0.385;
const NECK_BASE_UP = 0.43;
const HEAD_CENTRE_UP = 0.6;

/** The shoulders are a hulk's: nearly three heads across, deltoids included. */
export const SHOULDER_ROOT_HALF = 0.235;
export const LEG_ROOT_HALF = 0.082;

export const UPPER_ARM_LENGTH = 0.2;
export const FOREARM_LENGTH = 0.185;

const HEAD_RX = 0.108;
const HEAD_RY = 0.125;
/** Front to back the skull is deeper than it is wide. */
const HEAD_DEPTH = 0.118;

/** Half-widths of the limbs, shares of their own bones rather than of the head. */
const THIGH_ROOT_HALF = 0.1;
const THIGH_MID_HALF = 0.096;
const KNEE_HALF = 0.054;
const CALF_HALF = 0.074;
const ANKLE_HALF = 0.036;
/** How far down the shin the calf is widest: the gastrocnemius sits high. */
const CALF_AT = 0.3;
/** A heavy thigh is deeper than it is wide, so the profile draws it fuller. */
const PROFILE_THIGH_DEPTH = 1.15;
const UPPER_ARM_ROOT_HALF = 0.066;
const BICEP_HALF = 0.076;
const ELBOW_HALF = 0.05;
const DELTOID_RX = 0.086;
const DELTOID_RY = 0.074;
/** The deltoid's centre sits a touch below the joint, so its cap meets the trapezius line. */
const DELTOID_DROP = 0.012;

/** The gauntlets: a flared bracer from the elbow to a plated fist. */
const BRACER_ELBOW_HALF = 0.094;
const BRACER_LIP_HALF = 0.106;
const BRACER_WRIST_HALF = 0.07;
/** Where along the forearm the bracer starts, just below the elbow. */
const BRACER_START = 0.08;
/** How far past the wrist the fist's centre sits, along the forearm. */
const FIST_REACH = 0.075;
/** The fist is nearly as wide as his head: that is the gauntlets' whole read. */
export const FIST_WIDTH = 0.29;
const FIST_LENGTH = 0.22;
/** A fist pointed at the camera still shows this share of its length. */
const FIST_FACE_ON_SHARE = 0.88;
/** How much bigger a fist draws per tile it is nearer the camera than his chest. */
const FIST_NEAR_GROWTH = 1.9;
/**
 * Growth starts past where the guard holds the fists, so only a punch thrown
 * at the camera swells; a guard already that big would hide his whole chest.
 */
const FIST_GROWTH_FROM = 0.24;
const KNUCKLE_COUNT = 4;

const FOOT_HALF_WIDTH = 0.045;
/** Ball of the foot to ankle, along the floor. */
const BALL_TO_ANKLE = 0.07;
const BALL_TO_TOE = 0.045;
const HEEL_BEHIND_ANKLE = 0.035;

// ── Views and projection ─────────────────────────────────────────────────────

export type MaxxView = 'front' | 'side' | 'back';

/**
 * How much of a point's depth along the floor shows as screen height, on the
 * floor itself. The camera looks down at the floor but at the figure level, so
 * the share fades to nothing by hip height — a knee driven at the camera must
 * not hang lower than a straight leg's. Carl's `HEAD_ON_FLOOR_FORESHORTENING`.
 */
const FLOOR_DEPTH_SHARE = 0.15;
/** Profile: the far foot sits a little higher than the near one. */
const PROFILE_FLOOR_DEPTH_SHARE = 0.18;

export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}

function add(a: V3, b: V3): V3 {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function sub(a: V3, b: V3): V3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function scale3(a: V3, k: number): V3 {
  return v3(a.x * k, a.y * k, a.z * k);
}

function dot3(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len3(a: V3): number {
  return Math.sqrt(dot3(a, a));
}

const DEGENERATE_LENGTH = 1e-6;
const DOWN: V3 = { x: 0, y: 1, z: 0 };

function unit3(a: V3, fallback: V3 = DOWN): V3 {
  const length = len3(a);
  return length < DEGENERATE_LENGTH ? fallback : scale3(a, 1 / length);
}

/** A projected point: screen x/y in tiles and how near the camera it is. */
export interface ScreenPt {
  readonly x: number;
  readonly y: number;
  /** Larger is nearer the camera. */
  readonly near: number;
}

function floorShare(p: V3): number {
  return clamp01(1 + p.y / HIP_HEIGHT);
}

export function project(p: V3, view: MaxxView): ScreenPt {
  const share = floorShare(p);
  if (view === 'front') return { x: -p.x, y: p.y + FLOOR_DEPTH_SHARE * share * p.z, near: p.z };
  if (view === 'back') return { x: p.x, y: p.y - FLOOR_DEPTH_SHARE * share * p.z, near: -p.z };
  return { x: p.z, y: p.y + PROFILE_FLOOR_DEPTH_SHARE * share * p.x, near: p.x };
}

function flat(p: ScreenPt): Pt {
  return { x: p.x, y: p.y };
}

// ── Pose ─────────────────────────────────────────────────────────────────────

export type Side = 'right' | 'left';
export const SIDES: readonly Side[] = ['right', 'left'];

/** +1 for his right side, which is +X in figure space. */
export function sideSign(side: Side): number {
  return side === 'right' ? 1 : -1;
}

/**
 * An arm posed by its joints. Each segment's direction is absolute within the
 * chest's frame: `swing` carries it forward from hanging (π/2 is level
 * forward), `abduct` lifts it out to its own side. A walking arm has to be
 * posed this way — solved from a hand target, both segments sweep together and
 * the forearm flails.
 */
export interface ArmAngles {
  readonly kind: 'angles';
  readonly upperSwing: number;
  readonly upperAbduct: number;
  readonly foreSwing: number;
  readonly foreAbduct: number;
}

/**
 * An arm posed by where its fist goes, in figure space: punches and guards.
 * `pole` is the way the elbow points.
 */
export interface ArmReach {
  readonly kind: 'reach';
  readonly wrist: V3;
  readonly pole: V3;
}

export type ArmPose = ArmAngles | ArmReach;

/**
 * A leg posed by where the ball of its foot is, in figure space, and how far
 * the heel is raised about it (radians; the toe points down as it grows).
 */
export interface LegPose {
  readonly ball: V3;
  readonly heelLift: number;
}

export type Mouth = 'grin' | 'yell' | 'grit' | 'ouch' | 'smug' | 'dead';
export type Eyes = 'open' | 'wide' | 'squint' | 'shut' | 'cross';

export interface FaceState {
  readonly mouth: Mouth;
  readonly eyes: Eyes;
  /** −1 knit down in a scowl, +1 raised; 0 neutral. */
  readonly brow: number;
}

/** A clank of steel on steel, at a point in figure space. */
export interface Spark {
  readonly at: V3;
  /** 0..1 — how far through its flash it is. */
  readonly progress: number;
  readonly size: number;
}

export interface Dust {
  /** Screen point on the floor in tiles, before the figure's own offset. */
  readonly at: Pt;
  readonly progress: number;
  readonly spread: number;
}

export interface MaxxPose {
  /** The midpoint of the hip joints. */
  readonly pelvis: V3;
  /** Chest pitched forward about the hips (+) or back (−). */
  readonly lean: number;
  /** Chest turned about the spine; + brings his right shoulder forward. */
  readonly twist: number;
  /** Chest tipped toward his right (+) or left (−). */
  readonly roll: number;
  /** Head offsets from where the neck carries it, in tiles of figure space. */
  readonly headNod: number;
  readonly headTilt: number;
  readonly arms: Readonly<Record<Side, ArmPose>>;
  readonly legs: Readonly<Record<Side, LegPose>>;
  readonly face: FaceState;
  /** Vertical squash about the floor, 1 for none: the landing of a sit. */
  readonly squash: number;
  /** The whole picture, shifted in screen tiles: travel and hops. */
  readonly offset: Pt;
  /** The whole picture turned about `rollPivot` in the screen plane (a fall). */
  readonly screenRoll: number;
  readonly rollPivot: Pt;
  /** Paint the profile facing −X instead of +X, for the turn in the crush. */
  readonly mirrored: boolean;
  readonly sparks: readonly Spark[];
  readonly dust: readonly Dust[];
  /** 0..1 progress of the dazed stars circling his seat or head, or null. */
  readonly stars: { readonly at: V3; readonly progress: number } | null;
  /** Streaks trailing a punching fist, 0 for none. */
  readonly jabStreak: Readonly<Record<Side, number>>;
  /** How far toward lying the ground shadow has stretched, 0..1. */
  readonly shadowStretch: number;
}

const REST_FOOT_HALF_SPREAD = 0.1;
const REST_UPPER_ABDUCT = deg(16);
const REST_FORE_ABDUCT = deg(9);
const REST_FORE_SWING = deg(12);

export function restArm(): ArmAngles {
  return {
    kind: 'angles',
    upperSwing: 0,
    upperAbduct: REST_UPPER_ABDUCT,
    foreSwing: REST_FORE_SWING,
    foreAbduct: REST_FORE_ABDUCT,
  };
}

export function restPose(): MaxxPose {
  return {
    pelvis: v3(0, -HIP_HEIGHT, 0),
    lean: 0,
    twist: 0,
    roll: 0,
    headNod: 0,
    headTilt: 0,
    arms: { right: restArm(), left: restArm() },
    legs: {
      right: { ball: v3(REST_FOOT_HALF_SPREAD, 0, BALL_TO_ANKLE), heelLift: 0 },
      left: { ball: v3(-REST_FOOT_HALF_SPREAD, 0, BALL_TO_ANKLE), heelLift: 0 },
    },
    face: { mouth: 'grin', eyes: 'open', brow: 0 },
    squash: 1,
    offset: { x: 0, y: 0 },
    screenRoll: 0,
    rollPivot: { x: 0, y: 0 },
    mirrored: false,
    sparks: [],
    dust: [],
    stars: null,
    jabStreak: { right: 0, left: 0 },
    shadowStretch: 0,
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

/** Rotates a chest-frame vector by the pose's roll, then lean, then twist. */
function chestRotate(pose: MaxxPose, v: V3): V3 {
  const cr = Math.cos(pose.roll);
  const sr = Math.sin(pose.roll);
  const rolled = v3(v.x * cr - v.y * sr, v.x * sr + v.y * cr, v.z);
  const cl = Math.cos(pose.lean);
  const sl = Math.sin(pose.lean);
  const leaned = v3(rolled.x, rolled.y * cl + rolled.z * sl, -rolled.y * sl + rolled.z * cl);
  const ct = Math.cos(pose.twist);
  const st = Math.sin(pose.twist);
  return v3(leaned.x * ct - leaned.z * st, leaned.y, leaned.x * st + leaned.z * ct);
}

function chestPoint(pose: MaxxPose, local: V3): V3 {
  return add(pose.pelvis, chestRotate(pose, local));
}

/**
 * How much of the chest's lean and side tip the pelvis itself takes. A man
 * bends mostly at the waist, so the hips — and the Speedo on them — turn
 * less than the chest does, and the torso bends between the two.
 */
const PELVIS_TILT_SHARE = 0.45;

/** Rotates a pelvis-frame vector by the pelvis's own share of the roll and lean. */
function pelvisRotate(pose: MaxxPose, v: V3): V3 {
  const roll = pose.roll * PELVIS_TILT_SHARE;
  const lean = pose.lean * PELVIS_TILT_SHARE;
  const rolled = v3(
    v.x * Math.cos(roll) - v.y * Math.sin(roll),
    v.x * Math.sin(roll) + v.y * Math.cos(roll),
    v.z,
  );
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);
  return v3(rolled.x, rolled.y * cl + rolled.z * sl, -rolled.y * sl + rolled.z * cl);
}

/**
 * A point fixed to his pelvis, in figure space: x his right, y down, z the
 * way his hips face. The Speedo is drawn on this frame, so the gates sample
 * the garment region through it too.
 */
export function pelvisPoint(pose: MaxxPose, local: V3): V3 {
  return add(pose.pelvis, pelvisRotate(pose, local));
}

/** A segment direction from its forward swing and outward lift. */
function segmentDirection(swing: number, abduct: number, sign: number): V3 {
  const ca = Math.cos(abduct);
  return v3(sign * Math.sin(abduct), ca * Math.cos(swing), ca * Math.sin(swing));
}

export interface Chain {
  readonly root: V3;
  readonly mid: V3;
  readonly end: V3;
}

/**
 * The two-bone solve: the middle joint sits on the circle the two bones allow,
 * on the side `pole` points to. The reach is clamped just short of straight, so
 * an over-long target locks the limb straight toward it rather than NaN.
 */
function solveTwoBone(root: V3, target: V3, upper: number, lower: number, pole: V3): Chain {
  const toTarget = sub(target, root);
  const dir = unit3(toTarget);
  const reach = Math.min(
    Math.max(len3(toTarget), Math.abs(upper - lower) + JOINT_SLACK),
    upper + lower - JOINT_SLACK,
  );
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  const poleAcross = sub(pole, scale3(dir, dot3(pole, dir)));
  const fallbackAcross = Math.abs(dir.z) < 1 - DEGENERATE_LENGTH ? v3(0, 0, 1) : v3(1, 0, 0);
  const across = unit3(poleAcross, fallbackAcross);
  const mid = add(add(root, scale3(dir, along)), scale3(across, out));
  return { root, mid, end: add(root, scale3(dir, reach)) };
}

export interface FootPoints {
  readonly ankle: V3;
  readonly heel: V3;
  readonly ball: V3;
  readonly toe: V3;
}

export function footPoints(leg: LegPose): FootPoints {
  const c = Math.cos(leg.heelLift);
  const s = Math.sin(leg.heelLift);
  // The heel swings up about the ball; the ankle and heel ride on it.
  const lifted = (back: number, up: number): V3 =>
    add(leg.ball, v3(0, -(up * c + back * s), -back * c + up * s));
  return {
    ankle: lifted(BALL_TO_ANKLE, ANKLE_HEIGHT),
    heel: lifted(BALL_TO_ANKLE + HEEL_BEHIND_ANKLE, 0),
    ball: leg.ball,
    toe: add(leg.ball, v3(0, -s * BALL_TO_TOE * 0.1, BALL_TO_TOE * c)),
  };
}

/** Knees break forward and a touch outward, as a stocky man's do. */
const KNEE_POLE_OUT = 0.1;

export interface Skeleton {
  readonly pelvis: V3;
  readonly waist: V3;
  readonly chest: V3;
  readonly neck: V3;
  readonly head: V3;
  readonly legs: Readonly<Record<Side, Chain>>;
  readonly feet: Readonly<Record<Side, FootPoints>>;
  readonly arms: Readonly<Record<Side, Chain>>;
  /** Unit direction of each forearm, which the fist is aligned to. */
  readonly forearmDir: Readonly<Record<Side, V3>>;
  readonly fists: Readonly<Record<Side, V3>>;
  readonly hips: Readonly<Record<Side, V3>>;
  readonly shoulders: Readonly<Record<Side, V3>>;
}

export function shoulderJoint(pose: MaxxPose, side: Side): V3 {
  return chestPoint(pose, v3(sideSign(side) * SHOULDER_ROOT_HALF, -SHOULDER_JOINT_UP, 0));
}

function armChain(pose: MaxxPose, side: Side): Chain {
  const shoulder = shoulderJoint(pose, side);
  const arm = pose.arms[side];
  if (arm.kind === 'reach') {
    return solveTwoBone(shoulder, arm.wrist, UPPER_ARM_LENGTH, FOREARM_LENGTH, arm.pole);
  }
  const sign = sideSign(side);
  const upperDir = chestRotate(pose, segmentDirection(arm.upperSwing, arm.upperAbduct, sign));
  const foreDir = chestRotate(pose, segmentDirection(arm.foreSwing, arm.foreAbduct, sign));
  const elbow = add(shoulder, scale3(upperDir, UPPER_ARM_LENGTH));
  return { root: shoulder, mid: elbow, end: add(elbow, scale3(foreDir, FOREARM_LENGTH)) };
}

export function buildSkeleton(pose: MaxxPose): Skeleton {
  const hipOf = (side: Side): V3 => add(pose.pelvis, v3(sideSign(side) * LEG_ROOT_HALF, 0, 0));
  const legOf = (side: Side): Chain => {
    const feet = footPoints(pose.legs[side]);
    return solveTwoBone(
      hipOf(side),
      feet.ankle,
      THIGH_LENGTH,
      SHIN_LENGTH,
      v3(sideSign(side) * KNEE_POLE_OUT, 0, 1),
    );
  };
  const right = armChain(pose, 'right');
  const left = armChain(pose, 'left');
  const foreDir = (chain: Chain): V3 => unit3(sub(chain.end, chain.mid));
  const fistOf = (chain: Chain): V3 => add(chain.end, scale3(foreDir(chain), FIST_REACH));
  const neck = chestPoint(pose, v3(0, -NECK_BASE_UP, 0));
  const headRest = chestPoint(pose, v3(0, -HEAD_CENTRE_UP, 0));
  return {
    pelvis: pose.pelvis,
    waist: chestPoint(pose, v3(0, -WAIST_UP, 0)),
    chest: chestPoint(pose, v3(0, -CHEST_UP, 0)),
    neck,
    head: add(headRest, v3(pose.headTilt, pose.headNod, 0)),
    legs: { right: legOf('right'), left: legOf('left') },
    feet: { right: footPoints(pose.legs.right), left: footPoints(pose.legs.left) },
    arms: { right, left },
    forearmDir: { right: foreDir(right), left: foreDir(left) },
    fists: { right: fistOf(right), left: fistOf(left) },
    hips: { right: hipOf('right'), left: hipOf('left') },
    shoulders: { right: right.root, left: left.root },
  };
}

// ── 2D drawing helpers ───────────────────────────────────────────────────────

function add2(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub2(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale2(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}

function len2(a: Pt): number {
  return Math.hypot(a.x, a.y);
}

function unit2(a: Pt, fallback: Pt = { x: 0, y: 1 }): Pt {
  const length = len2(a);
  return length < DEGENERATE_LENGTH ? fallback : scale2(a, 1 / length);
}

/** The left-hand normal of a direction: (−dy, dx). */
function normal2(a: Pt): Pt {
  return { x: -a.y, y: a.x };
}

function lerp2(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** A closed path through `pts`, smoothed by curving through their midpoints. */
function traceSmooth(ctx: Ctx, pts: readonly Pt[]): void {
  const count = pts.length;
  if (count < 3) return;
  const mid = (a: Pt, b: Pt): Pt => lerp2(a, b, 0.5);
  const start = mid(pts[count - 1], pts[0]);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < count; i++) {
    const next = mid(pts[i], pts[(i + 1) % count]);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, next.x, next.y);
  }
  ctx.closePath();
}

function tracePolygon(ctx: Ctx, pts: readonly Pt[]): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/** A deterministic hash of two numbers into [0, 1). */
const HASH_A = 127.1;
const HASH_B = 311.7;
const HASH_MAGNITUDE = 43758.5453;
export function hash2(a: number, b: number): number {
  const s = Math.sin(a * HASH_A + b * HASH_B) * HASH_MAGNITUDE;
  return s - Math.floor(s);
}

/**
 * A local frame on a body part: `origin`, a unit `along` axis and the `across`
 * axis perpendicular to it, both already in screen tiles. Hair, muscle marks
 * and shading are placed in these coordinates so they ride the part.
 */
interface LocalFrame {
  readonly origin: Pt;
  readonly along: Pt;
  readonly across: Pt;
}

function framePoint(frame: LocalFrame, across: number, along: number): Pt {
  return {
    x: frame.origin.x + frame.across.x * across + frame.along.x * along,
    y: frame.origin.y + frame.across.y * across + frame.along.y * along,
  };
}

function frameAngle(frame: LocalFrame): number {
  return Math.atan2(frame.across.y, frame.across.x);
}

// ── Tubes: limbs as width profiles along a joint chain ──────────────────────

interface TubeWidth {
  /** Half-width on the `normal2` side of the travel direction. */
  readonly left: number;
  readonly right: number;
}

interface TubeSample {
  readonly at: Pt;
  readonly normal: Pt;
  readonly width: TubeWidth;
}

const TUBE_STEPS = 14;
const CAP_STEPS = 5;

/** Samples a two-segment chain evenly by length, with a width at each sample. */
function tubeSamples(
  a: Pt,
  b: Pt,
  c: Pt,
  widthAt: (t: number) => TubeWidth,
  steps: number = TUBE_STEPS,
): TubeSample[] {
  const first = len2(sub2(b, a));
  const second = len2(sub2(c, b));
  const total = Math.max(first + second, DEGENERATE_LENGTH);
  const pointAt = (t: number): Pt => {
    const along = t * total;
    if (along <= first) return lerp2(a, b, first < DEGENERATE_LENGTH ? 0 : along / first);
    return lerp2(b, c, second < DEGENERATE_LENGTH ? 1 : (along - first) / second);
  };
  const fallback = unit2(sub2(c, a));
  const samples: TubeSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const before = pointAt(Math.max(0, t - 1 / steps));
    const after = pointAt(Math.min(1, t + 1 / steps));
    const dir = unit2(sub2(after, before), fallback);
    samples.push({ at: pointAt(t), normal: normal2(dir), width: widthAt(t) });
  }
  return samples;
}

/** The closed outline of a sampled tube, with a round cap at each end. */
function tubeOutline(samples: readonly TubeSample[]): Pt[] {
  const leftSide = samples.map((s) => add2(s.at, scale2(s.normal, s.width.left)));
  const rightSide = samples.map((s) => sub2(s.at, scale2(s.normal, s.width.right)));
  const cap = (s: TubeSample, forward: number): Pt[] => {
    const radius = (s.width.left + s.width.right) / 2;
    const centre = add2(s.at, scale2(s.normal, (s.width.left - s.width.right) / 2));
    const dir = { x: s.normal.y * forward, y: -s.normal.x * forward };
    const pts: Pt[] = [];
    for (let i = 1; i < CAP_STEPS; i++) {
      const angle = (Math.PI * i) / CAP_STEPS;
      const across = forward > 0 ? Math.cos(angle) : -Math.cos(angle);
      pts.push(
        add2(
          centre,
          add2(scale2(s.normal, across * radius), scale2(dir, Math.sin(angle) * radius)),
        ),
      );
    }
    return pts;
  };
  const last = samples[samples.length - 1];
  return [...leftSide, ...cap(last, 1), ...rightSide.reverse(), ...cap(samples[0], -1)];
}

/** How the soft form shading of a tube is laid: shadow away from the light. */
const TUBE_SHADOW_OFFSET = 0.55;
const TUBE_SHADOW_WIDTH = 0.8;
const TUBE_SHADOW_ALPHA = 0.55;
const TUBE_LIGHT_OFFSET = 0.45;
const TUBE_LIGHT_WIDTH = 0.38;
const TUBE_LIGHT_ALPHA = 0.5;
const TUBE_RIM_ALPHA = 0.3;
const TUBE_RIM_WIDTH = 0.012;

/**
 * Two steps are enough: at the 32 px tile the wider steps of the default
 * crease table land in the same pixels and each costs a full stroke.
 */
const BODY_CREASE_LAYERS: ReadonlyArray<CreaseLayer> = [
  { widthScale: 1.8, alpha: 0.35 },
  { widthScale: 1, alpha: 0.6 },
];

function strokeOffsetPath(
  ctx: Ctx,
  samples: readonly TubeSample[],
  offsetShare: (s: TubeSample) => number,
): void {
  samples.forEach((s, i) => {
    const p = add2(s.at, scale2(s.normal, offsetShare(s)));
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
}

/** Signed width along the normal toward the side facing away from the light. */
function shadowSideOffset(s: TubeSample, share: number): number {
  const facesLight = s.normal.x * LIGHT.x + s.normal.y * LIGHT.y > 0;
  return facesLight ? -s.width.right * share : s.width.left * share;
}

function lightSideOffset(s: TubeSample, share: number): number {
  const facesLight = s.normal.x * LIGHT.x + s.normal.y * LIGHT.y > 0;
  return facesLight ? s.width.left * share : -s.width.right * share;
}

function meanWidth(samples: readonly TubeSample[]): number {
  const sum = samples.reduce((acc, s) => acc + s.width.left + s.width.right, 0);
  return sum / Math.max(1, samples.length * 2);
}

function shadeTube(ctx: Ctx, samples: readonly TubeSample[], ramp: Ramp, outline: Pt[]): void {
  const width = meanWidth(samples);
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceSmooth(ctx, outline);
    },
    () => {
      strokeSoftCrease(
        ctx,
        width * TUBE_SHADOW_WIDTH,
        ramp.shadow,
        () => {
          strokeOffsetPath(ctx, samples, (s) => shadowSideOffset(s, TUBE_SHADOW_OFFSET * 2));
        },
        TUBE_SHADOW_ALPHA,
        BODY_CREASE_LAYERS,
      );
      strokeSoftCrease(
        ctx,
        width * TUBE_LIGHT_WIDTH,
        ramp.light,
        () => {
          strokeOffsetPath(ctx, samples, (s) => lightSideOffset(s, TUBE_LIGHT_OFFSET));
        },
        TUBE_LIGHT_ALPHA,
        BODY_CREASE_LAYERS,
      );
      ctx.save();
      ctx.globalAlpha = clampAlpha(ctx.globalAlpha * TUBE_RIM_ALPHA);
      ctx.strokeStyle = ramp.rim;
      ctx.lineWidth = TUBE_RIM_WIDTH;
      ctx.beginPath();
      strokeOffsetPath(ctx, samples, (s) => shadowSideOffset(s, 1));
      ctx.stroke();
      ctx.restore();
    },
  );
}

// ── Hair ─────────────────────────────────────────────────────────────────────

/** A region of body hair, in a part's local frame. */
interface HairPatch {
  readonly across: number;
  readonly along: number;
  readonly rx: number;
  readonly ry: number;
  /** Strands per square tile of patch. */
  readonly density: number;
  /** How dark the tonal underlay is, 0..1. */
  readonly tone: number;
}

const STRAND_LENGTH = 0.011;
const STRAND_WIDTH = 0.0055;
const STRAND_CURL = 0.006;
const STRAND_ALPHA = 0.3;
const STRAND_LIGHT_ALPHA = 0.16;
/** A patch is thinned toward its rim so it has no edge of its own. */
const PATCH_EDGE_FADE = 0.75;
/** The hair grain runs down the body, leaning this far off the part's axis. */
const STRAND_GRAIN_SPREAD = 1.3;
const HAIR_TONE_ALPHA = 0.26;
/**
 * The share of each patch's density actually drawn as strands. Strands are
 * the costliest thing he paints, and past this share the extra ones land in
 * pixels the tonal underlay already darkens.
 */
const STRAND_DENSITY_SHARE = 0.5;

function paintHairPatch(ctx: Ctx, frame: LocalFrame, patch: HairPatch, seed: number): void {
  const centre = framePoint(frame, patch.across, patch.along);
  fillSoftEllipse(
    ctx,
    centre.x,
    centre.y,
    patch.rx,
    patch.ry,
    HAIR.base,
    patch.tone * HAIR_TONE_ALPHA,
    frameAngle(frame),
  );
  const area = Math.PI * patch.rx * patch.ry;
  const count = Math.round(area * patch.density * STRAND_DENSITY_SHARE);
  const dark = new Path2DBuilder();
  const lit = new Path2DBuilder();
  for (let i = 0; i < count; i++) {
    const angle = hash2(seed + i, 1) * TWO_PI;
    const radius = Math.sqrt(hash2(seed + i, 2));
    if (radius > 1 - PATCH_EDGE_FADE * hash2(seed + i, 3)) continue;
    const at = framePoint(
      frame,
      patch.across + Math.cos(angle) * radius * patch.rx,
      patch.along + Math.sin(angle) * radius * patch.ry,
    );
    // Strands hang down the part's axis, each turned a little its own way.
    const grain = (hash2(seed + i, 4) - 0.5) * STRAND_GRAIN_SPREAD;
    const dirAlong = Math.cos(grain);
    const dirAcross = Math.sin(grain);
    const dir = {
      x: frame.along.x * -dirAlong + frame.across.x * dirAcross,
      y: frame.along.y * -dirAlong + frame.across.y * dirAcross,
    };
    const curl = (hash2(seed + i, 5) - 0.5) * 2 * STRAND_CURL;
    const end = add2(at, scale2(dir, STRAND_LENGTH));
    const control = add2(lerp2(at, end, 0.5), scale2(normal2(dir), curl));
    (i % 3 === 0 ? lit : dark).strand(at, control, end);
  }
  dark.stroke(ctx, HAIR.shadow, STRAND_WIDTH, STRAND_ALPHA);
  lit.stroke(ctx, HAIR.rim, STRAND_WIDTH, STRAND_LIGHT_ALPHA);
}

/**
 * Collects short curved strands into one path, so a patch of a hundred hairs
 * costs one stroke rather than a hundred.
 */
class Path2DBuilder {
  private readonly strands: Array<readonly [Pt, Pt, Pt]> = [];

  strand(from: Pt, control: Pt, to: Pt): void {
    this.strands.push([from, control, to]);
  }

  trace(ctx: Ctx): void {
    for (const [from, control, to] of this.strands) {
      // Two straight segments through the control point: at a strand's size
      // the bend is under a pixel, and a curve costs several times the fill.
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(control.x, control.y);
      ctx.lineTo(to.x, to.y);
    }
  }

  stroke(ctx: Ctx, colour: string, width: number, alpha: number): void {
    if (this.strands.length === 0) return;
    ctx.save();
    ctx.globalAlpha = clampAlpha(ctx.globalAlpha * alpha);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    this.trace(ctx);
    ctx.stroke();
    ctx.restore();
  }
}

/** Tufts breaking the silhouette along one side of a tube. */
const TUFT_LENGTH = 0.015;
const TUFT_WIDTH = 0.009;
/** Every other sample down the edge: a tuft on each one reads as a saw blade. */
const TUFT_STRIDE = 2;

function tubeTufts(
  samples: readonly TubeSample[],
  side: 1 | -1,
  from: number,
  to: number,
  seed: number,
): Path2DBuilder {
  const tufts = new Path2DBuilder();
  const last = samples.length - 1;
  for (let i = Math.ceil(from * last); i <= Math.floor(to * last); i += TUFT_STRIDE) {
    const s = samples[i];
    const edgeWidth = side > 0 ? s.width.left : -s.width.right;
    const base = add2(s.at, scale2(s.normal, edgeWidth * 0.92));
    const along = unit2(normal2(scale2(s.normal, -1)));
    const lean = 0.6 + hash2(seed + i, 7) * 0.6;
    const out = add2(scale2(s.normal, side * TUFT_LENGTH), scale2(along, TUFT_LENGTH * lean));
    const tip = add2(base, out);
    const control = add2(base, add2(scale2(out, 0.5), scale2(s.normal, side * TUFT_LENGTH * 0.3)));
    tufts.strand(base, control, tip);
  }
  return tufts;
}

// ── Parts and composition ────────────────────────────────────────────────────

/**
 * A part of the figure: its silhouette laid down in the outline pass, its paint
 * laid down in the colour pass, and how near the camera it sits.
 */
interface Part {
  readonly near: number;
  readonly silhouette: (ctx: Ctx) => void;
  readonly paint: (ctx: Ctx) => void;
}

/** One screen pixel of ink round the silhouette at the 32 px tile. */
const OUTLINE_WIDTH = 0.028;

function inkShape(ctx: Ctx, trace: () => void): void {
  ctx.beginPath();
  trace();
  ctx.fill();
  ctx.stroke();
}

function fillShape(ctx: Ctx, colour: string | CanvasGradient, trace: () => void): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  trace();
  ctx.fill();
}

function inkTufts(ctx: Ctx, tufts: Path2DBuilder): void {
  ctx.save();
  ctx.lineWidth = TUFT_WIDTH + OUTLINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  tufts.trace(ctx);
  ctx.stroke();
  ctx.restore();
}

/** A soft dark band laid just below-right of a part onto whatever is under it. */
const CAST_SHADOW_OFFSET = 0.02;
const CAST_SHADOW_ALPHA = 0.3;
const CAST_SHADOW_TONE = '#2b1320';

function castShadow(ctx: Ctx, trace: () => void): void {
  ctx.save();
  ctx.globalAlpha = clampAlpha(ctx.globalAlpha * CAST_SHADOW_ALPHA);
  ctx.translate(CAST_SHADOW_OFFSET * -LIGHT.x, CAST_SHADOW_OFFSET * -LIGHT.y);
  ctx.fillStyle = CAST_SHADOW_TONE;
  ctx.beginPath();
  trace();
  ctx.fill();
  ctx.restore();
}

// ── Legs and feet ────────────────────────────────────────────────────────────

function legWidth(view: MaxxView, t: number, thighShare: number): TubeWidth {
  const kneeT = thighShare;
  let half: number;
  if (t <= kneeT) {
    const u = t / Math.max(kneeT, DEGENERATE_LENGTH);
    half =
      u < 0.4
        ? lerp(THIGH_ROOT_HALF, THIGH_MID_HALF, u / 0.4)
        : lerp(THIGH_MID_HALF, KNEE_HALF, (u - 0.4) / 0.6);
  } else {
    const u = (t - kneeT) / Math.max(1 - kneeT, DEGENERATE_LENGTH);
    half =
      u < CALF_AT
        ? lerp(KNEE_HALF, CALF_HALF, Math.sin(((u / CALF_AT) * Math.PI) / 2))
        : lerp(CALF_HALF, ANKLE_HALF, (u - CALF_AT) / (1 - CALF_AT));
  }
  if (view !== 'side') return { left: half, right: half };
  // Edge-on the quad bellies out in front and the calf behind: the tube's left
  // normal points back when the leg hangs down in a figure facing +X.
  const thigh = t <= kneeT ? PROFILE_THIGH_DEPTH : 1;
  const calfBack = t > kneeT ? 1.25 : 1;
  return { left: half * thigh * calfBack * 0.95, right: half * thigh * (t > kneeT ? 0.8 : 1.08) };
}

interface LegDrawing {
  readonly samples: TubeSample[];
  readonly outline: Pt[];
  readonly foot: Pt[];
  readonly tufts: Path2DBuilder;
}

function legDrawing(view: MaxxView, skel: Skeleton, side: Side): LegDrawing {
  const chain = skel.legs[side];
  const hip = flat(project(chain.root, view));
  const knee = flat(project(chain.mid, view));
  const ankle = flat(project(chain.end, view));
  const thighLen = len2(sub2(knee, hip));
  const shinLen = len2(sub2(ankle, knee));
  const thighShare = thighLen / Math.max(thighLen + shinLen, DEGENERATE_LENGTH);
  const samples = tubeSamples(hip, knee, ankle, (t) => legWidth(view, t, thighShare));
  const outline = tubeOutline(samples);
  const feet = skel.feet[side];
  const foot = footOutline(view, feet, side);
  // Shins and thighs are furred on their outer edge; edge-on, down the front of the shin.
  const outer: 1 | -1 =
    view === 'side' ? -1 : (view === 'front' ? -1 : 1) * sideSign(side) > 0 ? -1 : 1;
  const tufts = tubeTufts(samples, outer, 0.1, 0.92, side === 'right' ? 17 : 23);
  return { samples, outline, foot, tufts };
}

function footOutline(view: MaxxView, feet: FootPoints, side: Side): Pt[] {
  const ankle = project(feet.ankle, view);
  const heel = project(feet.heel, view);
  const ball = project(feet.ball, view);
  const toe = project(feet.toe, view);
  if (view === 'side') {
    const up = v3(0, -ANKLE_HEIGHT * 0.85, 0);
    const instep = project(
      add(lerpV(feet.ankle, feet.ball, 0.55), v3(0, -ANKLE_HEIGHT * 0.2, 0)),
      view,
    );
    const toeTop = project(add(feet.toe, v3(0, -ANKLE_HEIGHT * 0.45, 0)), view);
    const heelTop = project(add(feet.heel, up), view);
    return [
      flat(heelTop),
      flat(heel),
      flat(ball),
      flat(toe),
      flat(toeTop),
      flat(instep),
      flat(ankle),
    ];
  }
  // Head-on and from behind the foot is a short rounded wedge under the ankle.
  const bottom = Math.max(heel.y, ball.y, toe.y);
  const top = ankle.y - ANKLE_HALF * 0.6;
  const centreX = lerp(ankle.x, ball.x, 0.5);
  const spread = FOOT_HALF_WIDTH;
  // The big toe is on the inside of each foot.
  const inward = (view === 'front' ? 1 : -1) * sideSign(side) * spread * 0.2;
  return [
    { x: centreX - spread * 0.7, y: top },
    { x: centreX + spread * 0.7, y: top },
    { x: centreX + spread + inward * 0.5, y: bottom - spread * 0.5 },
    { x: centreX + spread * 0.8 + inward, y: bottom },
    { x: centreX - spread * 0.8 + inward, y: bottom },
    { x: centreX - spread + inward * 0.5, y: bottom - spread * 0.5 },
  ];
}

function lerpV(a: V3, b: V3, t: number): V3 {
  return v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
}

/** Hair on a leg, in its thigh and shin frames. */
const LEG_HAIR_DENSITY = 9360;
const LEG_HAIR_TONE = 0.55;
const KNEE_CAP_ALPHA = 0.28;

function legPart(view: MaxxView, skel: Skeleton, side: Side, near: number): Part {
  const leg = legDrawing(view, skel, side);
  const chain = skel.legs[side];
  const hip = flat(project(chain.root, view));
  const knee = flat(project(chain.mid, view));
  const ankle = flat(project(chain.end, view));
  return {
    near,
    silhouette: (ctx) => {
      inkShape(ctx, () => {
        traceSmooth(ctx, leg.outline);
      });
      inkShape(ctx, () => {
        traceSmooth(ctx, leg.foot);
      });
      inkTufts(ctx, leg.tufts);
    },
    paint: (ctx) => {
      fillShape(ctx, SKIN.base, () => {
        traceSmooth(ctx, leg.foot);
      });
      paintFootDetail(ctx, view, leg.foot);
      fillShape(ctx, SKIN.base, () => {
        traceSmooth(ctx, leg.outline);
      });
      shadeTube(ctx, leg.samples, SKIN, leg.outline);
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceSmooth(ctx, leg.outline);
        },
        () => {
          const seed = side === 'right' ? 311 : 419;
          const thighFrame = segmentFrame(hip, knee);
          const shinFrame = segmentFrame(knee, ankle);
          const thighLen = len2(sub2(knee, hip));
          const shinLen = len2(sub2(ankle, knee));
          paintHairPatch(
            ctx,
            thighFrame,
            {
              across: 0,
              along: thighLen * 0.55,
              rx: THIGH_MID_HALF,
              ry: thighLen * 0.5,
              density: LEG_HAIR_DENSITY,
              tone: LEG_HAIR_TONE,
            },
            seed,
          );
          paintHairPatch(
            ctx,
            shinFrame,
            {
              across: 0,
              along: shinLen * 0.45,
              rx: CALF_HALF,
              ry: shinLen * 0.55,
              density: LEG_HAIR_DENSITY * 1.2,
              tone: LEG_HAIR_TONE,
            },
            seed + 97,
          );
          if (view !== 'back') {
            fillSoftEllipse(
              ctx,
              knee.x,
              knee.y,
              KNEE_HALF * 0.9,
              KNEE_HALF * 0.7,
              SKIN.light,
              KNEE_CAP_ALPHA,
            );
          }
        },
      );
      leg.tufts.stroke(ctx, HAIR.shadow, TUFT_WIDTH, 1);
    },
  };
}

/** A frame whose `along` runs from `a` to `b` and whose origin is `a`. */
function segmentFrame(a: Pt, b: Pt): LocalFrame {
  const along = unit2(sub2(b, a));
  return { origin: a, along: scale2(along, -1), across: normal2(along) };
}

const TOE_BUMPS = 4;
const TOE_LINE_ALPHA = 0.45;

function paintFootDetail(ctx: Ctx, view: MaxxView, foot: readonly Pt[]): void {
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceSmooth(ctx, foot);
    },
    () => {
      const xs = foot.map((p) => p.x);
      const ys = foot.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const minY = Math.min(...ys);
      fillSoftEllipse(ctx, maxX, maxY, (maxX - minX) * 0.7, (maxY - minY) * 0.6, SKIN.shadow, 0.6);
      if (view !== 'front') return;
      ctx.save();
      ctx.strokeStyle = SKIN.deep;
      ctx.globalAlpha = clampAlpha(ctx.globalAlpha * TOE_LINE_ALPHA);
      ctx.lineWidth = STRAND_WIDTH;
      ctx.beginPath();
      for (let i = 1; i < TOE_BUMPS; i++) {
        const x = lerp(minX, maxX, i / TOE_BUMPS);
        ctx.moveTo(x, maxY);
        ctx.lineTo(x, lerp(maxY, minY, 0.3));
      }
      ctx.stroke();
      ctx.restore();
    },
  );
}

// ── Arms, the armband and the gauntlets ──────────────────────────────────────

function upperArmWidth(t: number, view: MaxxView): TubeWidth {
  const bicep = Math.sin(clamp01(t / 0.8) * Math.PI);
  const base = lerp(UPPER_ARM_ROOT_HALF, ELBOW_HALF, t);
  const half = lerp(base, BICEP_HALF, bicep * 0.8);
  if (view === 'side') return { left: half * 0.92, right: half * 1.08 };
  return { left: half, right: half };
}

function bracerWidth(t: number): TubeWidth {
  const half =
    t < 0.12
      ? lerp(BRACER_LIP_HALF, BRACER_ELBOW_HALF, t / 0.12)
      : lerp(BRACER_ELBOW_HALF, BRACER_WRIST_HALF, (t - 0.12) / 0.88);
  return { left: half, right: half };
}

interface ArmDrawing {
  readonly upper: TubeSample[];
  readonly upperOutline: Pt[];
  readonly bracer: TubeSample[];
  readonly bracerOutline: Pt[];
  readonly deltoid: Pt;
  readonly fist: FistDrawing;
  readonly tufts: Path2DBuilder;
}

interface FistDrawing {
  readonly centre: Pt;
  /** Unit screen direction the knuckles point. */
  readonly along: Pt;
  readonly across: Pt;
  readonly length: number;
  readonly width: number;
  /** 0 when the knuckles face the camera, 1 when the fist is seen side-on. */
  readonly planar: number;
  readonly corners: Pt[];
}

const FIST_CORNER_ROUNDING = 0.32;

function fistDrawing(view: MaxxView, skel: Skeleton, side: Side): FistDrawing {
  const centre3 = skel.fists[side];
  const dir3 = skel.forearmDir[side];
  const centre = project(centre3, view);
  const tip = project(add(centre3, scale3(dir3, FIST_LENGTH / 2)), view);
  const toTip = sub2(flat(tip), flat(centre));
  const planar = clamp01(len2(toTip) / (FIST_LENGTH / 2));
  const along = unit2(toTip, { x: 0, y: 1 });
  const across = normal2(along);
  const nearness = centre.near - project(skel.chest, view).near;
  const grow = 1 + FIST_NEAR_GROWTH * Math.max(0, nearness - FIST_GROWTH_FROM);
  const length = FIST_LENGTH * lerp(FIST_FACE_ON_SHARE, 1, planar) * grow;
  const width = FIST_WIDTH * grow;
  const c = flat(centre);
  const hl = length / 2;
  const hw = width / 2;
  const round = Math.min(hl, hw) * FIST_CORNER_ROUNDING;
  const corner = (sa: number, sw: number): Pt =>
    add2(c, add2(scale2(along, sa * hl), scale2(across, sw * hw)));
  // Eight points on a rounded box; the knuckle end is squarer than the wrist.
  const corners = [
    corner(1, -1 + round / hw),
    corner(1 - round / hl, -1),
    corner(-1 + round / hl, -1),
    corner(-1, -1 + round / hw),
    corner(-1, 1 - round / hw),
    corner(-1 + round / hl, 1),
    corner(1 - round / hl, 1),
    corner(1, 1 - round / hw),
  ];
  return { centre: c, along, across, length, width, planar, corners };
}

function armDrawing(view: MaxxView, skel: Skeleton, side: Side): ArmDrawing {
  const chain = skel.arms[side];
  const shoulder = flat(project(chain.root, view));
  const elbow = flat(project(chain.mid, view));
  const wrist = flat(project(chain.end, view));
  const upper = tubeSamples(shoulder, lerp2(shoulder, elbow, 0.5), elbow, (t) =>
    upperArmWidth(t, view),
  );
  const bracerStart = lerp2(elbow, wrist, BRACER_START);
  const bracer = tubeSamples(bracerStart, lerp2(bracerStart, wrist, 0.5), wrist, bracerWidth, 8);
  // The deltoid caps the shoulder a little outboard of the joint and above it.
  const outboard = project(add(chain.root, v3(sideSign(side) * 0.015, DELTOID_DROP, 0)), view);
  const tufts = tubeTufts(upper, 1, 0.05, 0.6, side === 'right' ? 53 : 71);
  return {
    upper,
    upperOutline: tubeOutline(upper),
    bracer,
    bracerOutline: tubeOutline(bracer),
    deltoid: flat(outboard),
    fist: fistDrawing(view, skel, side),
    tufts,
  };
}

const ARMBAND_AT = 0.36;
const ARMBAND_HALF_LENGTH = 0.09;
const ARMBAND_SWELL = 1.14;

function armbandQuad(upper: readonly TubeSample[]): Pt[] {
  const last = upper.length - 1;
  const from = upper[Math.round((ARMBAND_AT - ARMBAND_HALF_LENGTH * 2.2) * last)];
  const to = upper[Math.round((ARMBAND_AT + ARMBAND_HALF_LENGTH * 2.2) * last)];
  const edge = (s: TubeSample, sign: number): Pt =>
    add2(s.at, scale2(s.normal, sign * (sign > 0 ? s.width.left : s.width.right) * ARMBAND_SWELL));
  return [edge(from, 1), edge(to, 1), edge(to, -1), edge(from, -1)];
}

const BRACER_BAND_AT: readonly number[] = [0.36, 0.7];
const RIVET_RADIUS = 0.011;
const STEEL_SHEEN_ALPHA = 0.75;

function paintGauntlet(ctx: Ctx, arm: ArmDrawing, streak: number): void {
  fillShape(ctx, STEEL.base, () => {
    traceSmooth(ctx, arm.bracerOutline);
  });
  shadeTube(ctx, arm.bracer, STEEL, arm.bracerOutline);
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceSmooth(ctx, arm.bracerOutline);
    },
    () => {
      const last = arm.bracer.length - 1;
      ctx.save();
      ctx.lineCap = 'round';
      for (const at of BRACER_BAND_AT) {
        const s = arm.bracer[Math.round(at * last)];
        const a = add2(s.at, scale2(s.normal, s.width.left));
        const b = sub2(s.at, scale2(s.normal, s.width.right));
        ctx.strokeStyle = STEEL.deep;
        ctx.lineWidth = STRAND_WIDTH * 1.4;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const shift = scale2(normal2(s.normal), -STRAND_WIDTH * 1.4);
        ctx.strokeStyle = STEEL.light;
        ctx.lineWidth = STRAND_WIDTH;
        ctx.beginPath();
        ctx.moveTo(a.x + shift.x, a.y + shift.y);
        ctx.lineTo(b.x + shift.x, b.y + shift.y);
        ctx.stroke();
      }
      // The elbow lip: a rolled rim, dark under its edge.
      const lip = arm.bracer[1];
      const la = add2(lip.at, scale2(lip.normal, lip.width.left));
      const lb = sub2(lip.at, scale2(lip.normal, lip.width.right));
      ctx.strokeStyle = STEEL.shadow;
      ctx.lineWidth = STRAND_WIDTH * 1.6;
      ctx.beginPath();
      ctx.moveTo(la.x, la.y);
      ctx.lineTo(lb.x, lb.y);
      ctx.stroke();
      ctx.restore();
    },
  );
  paintFist(ctx, arm.fist, streak);
}

function paintFist(ctx: Ctx, fist: FistDrawing, streak: number): void {
  if (streak > 0) paintJabStreak(ctx, fist, streak);
  fillShape(ctx, STEEL.base, () => {
    traceSmooth(ctx, fist.corners);
  });
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceSmooth(ctx, fist.corners);
    },
    () => {
      const size = Math.max(fist.length, fist.width);
      const lit = add2(fist.centre, scale2(LIGHT, size * 0.3));
      const shade = sub2(fist.centre, scale2(LIGHT, size * 0.38));
      fillSoftEllipse(ctx, shade.x, shade.y, size * 0.55, size * 0.45, STEEL.deep, 0.75);
      fillSoftEllipse(
        ctx,
        lit.x,
        lit.y,
        size * 0.34,
        size * 0.24,
        STEEL.rim,
        STEEL_SHEEN_ALPHA,
        Math.atan2(LIGHT.y, LIGHT.x),
      );
      paintKnuckles(ctx, fist);
      // A bright rim along the lit edge, so steel holds its outline against
      // the lit skin of the chest it is so often held in front of.
      ctx.save();
      ctx.translate(-LIGHT.x * FIST_RIM_INSET, -LIGHT.y * FIST_RIM_INSET);
      ctx.strokeStyle = STEEL.rim;
      ctx.globalAlpha = clampAlpha(ctx.globalAlpha * FIST_RIM_ALPHA);
      ctx.lineWidth = FIST_RIM_WIDTH;
      ctx.beginPath();
      traceSmooth(ctx, fist.corners);
      ctx.stroke();
      ctx.restore();
    },
  );
}

const FIST_RIM_INSET = 0.014;
const FIST_RIM_WIDTH = 0.018;
const FIST_RIM_ALPHA = 0.7;

const KNUCKLE_RADIUS_SHARE = 0.13;
/** Past this much side-on share the knuckles are a row along the fist's end. */
const KNUCKLES_ON_END = 0.55;

function paintKnuckles(ctx: Ctx, fist: FistDrawing): void {
  const r = fist.width * KNUCKLE_RADIUS_SHARE;
  const endward = fist.planar > KNUCKLES_ON_END ? fist.length / 2 - r * 0.9 : fist.length * 0.05;
  ctx.save();
  for (let i = 0; i < KNUCKLE_COUNT; i++) {
    const across = lerp(-0.36, 0.36, i / (KNUCKLE_COUNT - 1)) * fist.width;
    const at = add2(fist.centre, add2(scale2(fist.along, endward), scale2(fist.across, across)));
    fillSoftEllipse(ctx, at.x + r * 0.35, at.y + r * 0.35, r * 1.25, r * 1.1, STEEL.deep, 0.42);
    ctx.fillStyle = STEEL.base;
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, TWO_PI);
    ctx.fill();
    fillSoftEllipse(ctx, at.x - r * 0.3, at.y - r * 0.35, r * 0.6, r * 0.45, STEEL.rim, 0.9);
  }
  // A row of brass rivets across the back of the hand, toward the wrist.
  const rivetsAt = -fist.length * 0.28;
  ctx.fillStyle = BRASS;
  for (const across of [-0.3, 0, 0.3]) {
    const at = add2(
      fist.centre,
      add2(scale2(fist.along, rivetsAt), scale2(fist.across, across * fist.width)),
    );
    ctx.beginPath();
    ctx.arc(at.x, at.y, RIVET_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
  ctx.fillStyle = BRASS_DARK;
  ctx.globalAlpha = clampAlpha(ctx.globalAlpha * 0.6);
  for (const across of [-0.3, 0, 0.3]) {
    const at = add2(
      fist.centre,
      add2(scale2(fist.along, rivetsAt), scale2(fist.across, across * fist.width)),
    );
    ctx.beginPath();
    ctx.arc(at.x + RIVET_RADIUS * 0.4, at.y + RIVET_RADIUS * 0.4, RIVET_RADIUS * 0.55, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

const STREAK_COUNT = 3;
const STREAK_LENGTH = 0.22;
const STREAK_ALPHA = 0.55;

/** Speed lines trailing a punch, fanned behind the fist. */
function paintJabStreak(ctx: Ctx, fist: FistDrawing, streak: number): void {
  ctx.save();
  ctx.strokeStyle = SPARK_HOT;
  ctx.lineCap = 'round';
  ctx.lineWidth = STRAND_WIDTH * 1.2;
  ctx.globalAlpha = clampAlpha(ctx.globalAlpha * STREAK_ALPHA * streak);
  ctx.beginPath();
  for (let i = 0; i < STREAK_COUNT; i++) {
    const across = lerp(-0.4, 0.4, i / (STREAK_COUNT - 1)) * fist.width;
    const from = add2(
      fist.centre,
      add2(scale2(fist.along, -fist.length * 0.6), scale2(fist.across, across)),
    );
    const to = add2(from, scale2(fist.along, -STREAK_LENGTH * (0.7 + 0.3 * (i % 2)) * streak));
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();
  ctx.restore();
}

const UPPER_ARM_HAIR_DENSITY = 5760;
const UPPER_ARM_HAIR_TONE = 0.3;

function armPart(
  view: MaxxView,
  skel: Skeleton,
  side: Side,
  near: number,
  streak: number,
  overBody: boolean,
): Part {
  const arm = armDrawing(view, skel, side);
  const traceUpper = (ctx: Ctx): void => {
    traceSmooth(ctx, arm.upperOutline);
  };
  const traceDeltoid = (ctx: Ctx): void => {
    ctx.ellipse(arm.deltoid.x, arm.deltoid.y, DELTOID_RX, DELTOID_RY, 0, 0, TWO_PI);
  };
  return {
    near,
    silhouette: (ctx) => {
      inkShape(ctx, () => {
        traceDeltoid(ctx);
      });
      inkShape(ctx, () => {
        traceUpper(ctx);
      });
      inkTufts(ctx, arm.tufts);
      inkShape(ctx, () => {
        traceSmooth(ctx, arm.bracerOutline);
      });
      inkShape(ctx, () => {
        traceSmooth(ctx, arm.fist.corners);
      });
    },
    paint: (ctx) => {
      if (overBody) {
        castShadow(ctx, () => {
          traceUpper(ctx);
        });
      }
      fillShape(ctx, SKIN.base, () => {
        traceUpper(ctx);
      });
      shadeTube(ctx, arm.upper, SKIN, arm.upperOutline);
      fillShape(ctx, SKIN.base, () => {
        traceDeltoid(ctx);
      });
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceDeltoid(ctx);
        },
        () => {
          const d = arm.deltoid;
          fillSoftEllipse(
            ctx,
            d.x + DELTOID_RX * 0.45,
            d.y + DELTOID_RY * 0.5,
            DELTOID_RX,
            DELTOID_RY * 0.8,
            SKIN.shadow,
            0.7,
          );
          fillSoftEllipse(
            ctx,
            d.x - DELTOID_RX * 0.35,
            d.y - DELTOID_RY * 0.4,
            DELTOID_RX * 0.55,
            DELTOID_RY * 0.4,
            SKIN.light,
            0.7,
          );
        },
      );
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceUpper(ctx);
        },
        () => {
          const first = arm.upper[0].at;
          const last = arm.upper[arm.upper.length - 1].at;
          paintHairPatch(
            ctx,
            segmentFrame(first, last),
            {
              across: 0,
              along: len2(sub2(last, first)) * 0.45,
              rx: BICEP_HALF,
              ry: len2(sub2(last, first)) * 0.5,
              density: UPPER_ARM_HAIR_DENSITY,
              tone: UPPER_ARM_HAIR_TONE,
            },
            side === 'right' ? 631 : 643,
          );
        },
      );
      arm.tufts.stroke(ctx, HAIR.shadow, TUFT_WIDTH, 1);
      if (side === 'right') paintArmband(ctx, arm);
      paintGauntlet(ctx, arm, streak);
    },
  };
}

function paintArmband(ctx: Ctx, arm: ArmDrawing): void {
  const quad = armbandQuad(arm.upper);
  ctx.save();
  ctx.fillStyle = OUTLINE;
  ctx.globalAlpha = clampAlpha(ctx.globalAlpha * OUTLINE_ALPHA * 0.5);
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  tracePolygon(ctx, quad);
  ctx.stroke();
  ctx.restore();
  fillShape(ctx, ARMBAND_BASE, () => {
    tracePolygon(ctx, quad);
  });
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      tracePolygon(ctx, quad);
    },
    () => {
      const [a, b, c, d] = quad;
      const litEdge = a.x + b.x < c.x + d.x ? [a, b] : [d, c];
      const darkEdge = litEdge[0] === a ? [d, c] : [a, b];
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = ARMBAND_LIGHT;
      ctx.lineWidth = STRAND_WIDTH * 1.6;
      ctx.beginPath();
      ctx.moveTo(litEdge[0].x, litEdge[0].y);
      ctx.lineTo(litEdge[1].x, litEdge[1].y);
      ctx.stroke();
      ctx.strokeStyle = ARMBAND_SHADOW;
      ctx.lineWidth = STRAND_WIDTH * 2;
      ctx.beginPath();
      ctx.moveTo(darkEdge[0].x, darkEdge[0].y);
      ctx.lineTo(darkEdge[1].x, darkEdge[1].y);
      ctx.stroke();
      // The stitched stripe round the middle of the band.
      ctx.strokeStyle = mix(ARMBAND_LIGHT, '#ffffff', 0.4);
      ctx.lineWidth = STRAND_WIDTH * 0.9;
      const m0 = lerp2(a, d, 0.5);
      const m1 = lerp2(b, c, 0.5);
      ctx.beginPath();
      ctx.moveTo(m0.x, m0.y);
      ctx.lineTo(m1.x, m1.y);
      ctx.stroke();
      ctx.restore();
    },
  );
}

// ── Torso ────────────────────────────────────────────────────────────────────

/**
 * The torso outline as (across, up) pairs in tiles, measured from the hip
 * joints' midpoint up the spine. Head-on and from behind it is symmetric; this
 * is his right half, bottom to top, mirrored for the other.
 */
const FACING_TORSO_EDGE: ReadonlyArray<readonly [number, number]> = [
  [0.05, -0.075],
  [0.145, -0.035],
  [0.168, 0.03],
  [0.172, 0.095],
  [0.16, 0.155],
  [0.172, 0.21],
  [0.205, 0.26],
  [0.23, 0.31],
  [0.235, 0.35],
  [0.205, 0.395],
  [0.14, 0.425],
  [0.085, 0.45],
];

/** Edge-on: the front edge (+) from the crotch up, then the back edge down. */
const PROFILE_TORSO_EDGE: ReadonlyArray<readonly [number, number]> = [
  [0.07, -0.065],
  [0.11, -0.005],
  [0.12, 0.07],
  [0.125, 0.13],
  [0.145, 0.2],
  [0.192, 0.245],
  [0.2, 0.3],
  [0.168, 0.36],
  [0.1, 0.41],
  [0.06, 0.45],
  [-0.07, 0.47],
  [-0.125, 0.44],
  [-0.168, 0.37],
  [-0.165, 0.28],
  [-0.12, 0.18],
  [-0.108, 0.1],
  [-0.142, 0.03],
  [-0.155, -0.045],
  [-0.128, -0.105],
  [-0.06, -0.11],
];

/**
 * Edge-on the barrel chest is drawn this much deeper than its outline table:
 * without it the profile reads as a slighter man than the head-on view.
 */
const PROFILE_TORSO_DEPTH = 1.2;

interface TorsoFrame extends LocalFrame {
  /** Tiles of screen per tile up the spine: less than 1 when the chest pitches at the camera. */
  readonly stretch: number;
  /** The frame fixed to the pelvis, which the hips, the seat and the Speedo are drawn on. */
  readonly pelvis: LocalFrame;
}

/**
 * The screen axis across the body for a body axis running down the screen:
 * the perpendicular on the +X side. Edge-on +X is the way he faces (the
 * mirrored turn is applied to the whole picture), so a positive `across` is
 * his front; head-on and from behind it is the viewer's right.
 */
function acrossFor(along: Pt): Pt {
  const perpendicular = normal2(along);
  return perpendicular.x >= 0 ? perpendicular : scale2(perpendicular, -1);
}

/** The length of the probe used to read an axis off the projected rig. */
const AXIS_PROBE = 0.1;

function pelvisFrame(view: MaxxView, pose: MaxxPose, widthScale: number): LocalFrame {
  const origin = flat(project(pose.pelvis, view));
  const up = flat(project(pelvisPoint(pose, v3(0, -AXIS_PROBE, 0)), view));
  const along = unit2(sub2(origin, up), { x: 0, y: 1 });
  return { origin, along, across: scale2(acrossFor(along), widthScale) };
}

function torsoFrame(view: MaxxView, skel: Skeleton, pose: MaxxPose): TorsoFrame {
  const pelvis = flat(project(skel.pelvis, view));
  const neck = flat(project(skel.neck, view));
  const spine = sub2(pelvis, neck);
  const along = unit2(spine, { x: 0, y: 1 });
  const stretch = len2(spine) / NECK_BASE_UP;
  // Head-on a twist foreshortens the chest's width; edge-on it does not.
  const widthScale = view === 'side' ? PROFILE_TORSO_DEPTH : lerp(1, Math.cos(pose.twist), 0.6);
  return {
    origin: pelvis,
    along,
    across: scale2(acrossFor(along), widthScale),
    stretch,
    pelvis: pelvisFrame(view, pose, widthScale),
  };
}

/**
 * A torso-frame point; `up` is height above the hips along the spine. Below
 * the waist the point rides the pelvis and above it the chest, blended in
 * between, so the body bends at the waist instead of pivoting at the hips.
 */
function torsoPoint(frame: TorsoFrame, across: number, up: number): Pt {
  const onChest = framePoint(frame, across, -up * frame.stretch);
  const onPelvis = framePoint(frame.pelvis, across, -up);
  return lerp2(onPelvis, onChest, clamp01(up / WAIST_UP));
}

function torsoOutline(view: MaxxView, frame: TorsoFrame): Pt[] {
  if (view === 'side') return PROFILE_TORSO_EDGE.map(([s, h]) => torsoPoint(frame, s, h));
  const right = FACING_TORSO_EDGE.map(([s, h]) => torsoPoint(frame, s, h));
  const left = [...FACING_TORSO_EDGE].reverse().map(([s, h]) => torsoPoint(frame, -s, h));
  return [...right, ...left];
}

const CHEST_HAIR_DENSITY = 11700;
const BACK_HAIR_DENSITY = 7560;
const MUSCLE_LINE_WIDTH = 0.014;

function torsoPart(view: MaxxView, skel: Skeleton, pose: MaxxPose): Part {
  const frame = torsoFrame(view, skel, pose);
  const outline = torsoOutline(view, frame);
  const trace = (ctx: Ctx): void => {
    traceSmooth(ctx, outline);
  };
  const speedo = speedoShape(view, frame);
  const cuffs = speedoCuffs(view, skel, frame);
  return {
    near: 0,
    silhouette: (ctx) => {
      inkShape(ctx, () => {
        trace(ctx);
      });
      inkShape(ctx, () => {
        traceSmooth(ctx, speedo);
      });
      for (const cuff of cuffs) {
        inkShape(ctx, () => {
          traceSmooth(ctx, cuff);
        });
      }
    },
    paint: (ctx) => {
      fillShape(ctx, SKIN.base, () => {
        trace(ctx);
      });
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => {
          if (view === 'front') paintChest(ctx, frame);
          else if (view === 'back') paintBack(ctx, frame);
          else paintProfileTorso(ctx, frame);
        },
      );
      paintSpeedoCuffs(ctx, cuffs);
      paintSpeedo(ctx, view, frame, speedo);
    },
  };
}

const CUFF_SHADE_ALPHA = 0.55;

function paintSpeedoCuffs(ctx: Ctx, cuffs: readonly Pt[][]): void {
  for (const cuff of cuffs) {
    fillShape(ctx, SPEEDO.base, () => {
      traceSmooth(ctx, cuff);
    });
    // The lower edge of each leg opening sits in the shadow of the seat. The
    // shade is a straight chord between the cuff's corners while the fill is
    // smoothed, so it is clipped to the fill or it would hang onto the thigh.
    const [, lowA, lowB] = cuff;
    withClip(
      ctx,
      () => {
        ctx.beginPath();
        traceSmooth(ctx, cuff);
      },
      () => {
        ctx.globalAlpha = clampAlpha(ctx.globalAlpha * CUFF_SHADE_ALPHA);
        ctx.strokeStyle = SPEEDO.shadow;
        ctx.lineWidth = STRAND_WIDTH * 2;
        ctx.beginPath();
        ctx.moveTo(lowA.x, lowA.y);
        ctx.lineTo(lowB.x, lowB.y);
        ctx.stroke();
      },
    );
  }
}

/** A soft light/shade pair across a whole torso, offset along the light. */
function shadeTorsoMass(ctx: Ctx, frame: TorsoFrame): void {
  const centre = torsoPoint(frame, 0, 0.22);
  const shade = torsoPoint(frame, 0.2, 0.12);
  const lit = torsoPoint(frame, -0.12, 0.3);
  const angle = frameAngle(frame);
  fillSoftEllipse(ctx, shade.x, shade.y, 0.2, 0.32, SKIN.shadow, 0.75, angle);
  fillSoftEllipse(ctx, lit.x, lit.y, 0.13, 0.16, SKIN.light, 0.55, angle);
  fillSoftEllipse(ctx, centre.x, centre.y + 0.2, 0.25, 0.08, SKIN.shadow, 0.35, angle);
}

function muscleLine(
  ctx: Ctx,
  frame: TorsoFrame,
  pts: ReadonlyArray<readonly [number, number]>,
  alpha: number,
  width = MUSCLE_LINE_WIDTH,
): void {
  strokeSoftCrease(
    ctx,
    width,
    SKIN.shadow,
    () => {
      pts.forEach(([s, h], i) => {
        const p = torsoPoint(frame, s, h);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
    },
    alpha,
    BODY_CREASE_LAYERS,
  );
}

function paintChest(ctx: Ctx, frame: TorsoFrame): void {
  shadeTorsoMass(ctx, frame);
  const angle = frameAngle(frame);
  // Pecs: two heavy plates, lit on their upper inner quarter, shaded under.
  for (const sign of [-1, 1]) {
    const under = torsoPoint(frame, sign * 0.1, 0.25);
    const top = torsoPoint(frame, sign * 0.09, 0.33);
    fillSoftEllipse(ctx, under.x, under.y, 0.1, 0.04, SKIN.deep, 0.55, angle);
    fillSoftEllipse(ctx, top.x, top.y, 0.085, 0.05, SKIN.light, sign < 0 ? 0.6 : 0.3, angle);
    muscleLine(
      ctx,
      frame,
      [
        [sign * 0.01, 0.3],
        [sign * 0.06, 0.262],
        [sign * 0.13, 0.26],
        [sign * 0.19, 0.3],
      ],
      0.9,
    );
  }
  // Abs: a faint six-pack under the belly hair.
  muscleLine(
    ctx,
    frame,
    [
      [0, 0.24],
      [0, 0.06],
    ],
    0.55,
  );
  for (const up of [0.2, 0.14, 0.085]) {
    for (const sign of [-1, 1]) {
      muscleLine(
        ctx,
        frame,
        [
          [sign * 0.015, up],
          [sign * 0.07, up + 0.006],
        ],
        0.35,
      );
    }
  }
  // The iliac V running down into the Speedo.
  for (const sign of [-1, 1]) {
    muscleLine(
      ctx,
      frame,
      [
        [sign * 0.13, 0.1],
        [sign * 0.09, 0.03],
        [sign * 0.05, -0.01],
      ],
      0.55,
    );
  }
  // Chest rug, and the trail down the belly.
  paintHairPatch(
    ctx,
    frame,
    {
      across: 0,
      along: -0.3 * frame.stretch,
      rx: 0.14,
      ry: 0.07,
      density: CHEST_HAIR_DENSITY,
      tone: 0.75,
    },
    811,
  );
  paintHairPatch(
    ctx,
    frame,
    {
      across: 0,
      along: -0.14 * frame.stretch,
      rx: 0.045,
      ry: 0.13,
      density: CHEST_HAIR_DENSITY,
      tone: 0.6,
    },
    829,
  );
  paintHairPatch(
    ctx,
    frame,
    {
      across: 0,
      along: -0.2 * frame.stretch,
      rx: 0.16,
      ry: 0.13,
      density: CHEST_HAIR_DENSITY * 0.35,
      tone: 0.2,
    },
    853,
  );
}

function paintBack(ctx: Ctx, frame: TorsoFrame): void {
  shadeTorsoMass(ctx, frame);
  const angle = frameAngle(frame);
  // The spine groove between two ropes of erector, and the shoulder blades.
  muscleLine(
    ctx,
    frame,
    [
      [0, 0.4],
      [0, 0.05],
    ],
    0.8,
  );
  for (const sign of [-1, 1]) {
    const blade = torsoPoint(frame, sign * 0.1, 0.32);
    fillSoftEllipse(ctx, blade.x, blade.y, 0.075, 0.06, SKIN.light, sign < 0 ? 0.5 : 0.25, angle);
    muscleLine(
      ctx,
      frame,
      [
        [sign * 0.05, 0.36],
        [sign * 0.08, 0.28],
        [sign * 0.15, 0.25],
      ],
      0.55,
    );
    muscleLine(
      ctx,
      frame,
      [
        [sign * 0.2, 0.26],
        [sign * 0.16, 0.18],
        [sign * 0.12, 0.13],
      ],
      0.45,
    );
  }
  // A hairy back: one mat across the shoulders thinning down the spine. Off
  // centre on purpose — two matched patches either side of the spine read as
  // a tattoo, not as hair.
  paintHairPatch(
    ctx,
    frame,
    {
      across: 0.015,
      along: -0.33 * frame.stretch,
      rx: 0.2,
      ry: 0.1,
      density: BACK_HAIR_DENSITY,
      tone: 0.55,
    },
    877,
  );
  paintHairPatch(
    ctx,
    frame,
    {
      across: -0.03,
      along: -0.2 * frame.stretch,
      rx: 0.1,
      ry: 0.12,
      density: BACK_HAIR_DENSITY * 0.6,
      tone: 0.3,
    },
    883,
  );
  paintHairPatch(
    ctx,
    frame,
    {
      across: 0.02,
      along: -0.07 * frame.stretch,
      rx: 0.1,
      ry: 0.05,
      density: BACK_HAIR_DENSITY * 0.7,
      tone: 0.3,
    },
    907,
  );
}

function paintProfileTorso(ctx: Ctx, frame: TorsoFrame): void {
  const angle = frameAngle(frame);
  const back = torsoPoint(frame, -0.12, 0.2);
  const chest = torsoPoint(frame, 0.1, 0.3);
  const belly = torsoPoint(frame, 0.12, 0.12);
  fillSoftEllipse(ctx, back.x, back.y, 0.1, 0.3, SKIN.shadow, 0.55, angle);
  fillSoftEllipse(ctx, chest.x, chest.y, 0.09, 0.07, SKIN.light, 0.5, angle);
  fillSoftEllipse(ctx, belly.x, belly.y, 0.05, 0.08, SKIN.shadow, 0.3, angle);
  muscleLine(
    ctx,
    frame,
    [
      [0.165, 0.265],
      [0.12, 0.25],
      [0.07, 0.27],
    ],
    0.85,
  );
  paintHairPatch(
    ctx,
    frame,
    {
      across: 0.13,
      along: -0.29 * frame.stretch,
      rx: 0.05,
      ry: 0.07,
      density: CHEST_HAIR_DENSITY,
      tone: 0.7,
    },
    941,
  );
  paintHairPatch(
    ctx,
    frame,
    {
      across: 0.12,
      along: -0.13 * frame.stretch,
      rx: 0.035,
      ry: 0.11,
      density: CHEST_HAIR_DENSITY * 0.8,
      tone: 0.5,
    },
    953,
  );
  paintHairPatch(
    ctx,
    frame,
    {
      across: -0.11,
      along: -0.33 * frame.stretch,
      rx: 0.05,
      ry: 0.08,
      density: BACK_HAIR_DENSITY,
      tone: 0.55,
    },
    967,
  );
}

// ── The Speedo ───────────────────────────────────────────────────────────────

/**
 * Head-on: a low waistband across the hips and a high-cut V to a narrow
 * crotch. From behind it is a seat over two rounded cheeks. Edge-on a thin
 * side strip over the hip, the front panel low, the seat round and full.
 * Cut high and snug, but a smooth plain shape: this is a cartoon of a man in
 * swimwear, and nothing is drawn under it.
 */
const FRONT_SPEEDO: ReadonlyArray<readonly [number, number]> = [
  [-0.172, 0.07],
  [0.172, 0.07],
  [0.168, 0.035],
  [0.06, -0.035],
  [0.035, -0.075],
  [-0.035, -0.075],
  [-0.06, -0.035],
  [-0.168, 0.035],
];
const BACK_SPEEDO: ReadonlyArray<readonly [number, number]> = [
  [-0.172, 0.085],
  [0.172, 0.085],
  [0.17, 0.04],
  [0.165, -0.04],
  [0.13, -0.1],
  [0.06, -0.12],
  [0, -0.1],
  [-0.06, -0.12],
  [-0.13, -0.1],
  [-0.165, -0.04],
  [-0.17, 0.04],
];
const SIDE_SPEEDO: ReadonlyArray<readonly [number, number]> = [
  [0.125, 0.06],
  [-0.108, 0.1],
  [-0.143, 0.03],
  [-0.162, -0.045],
  [-0.138, -0.11],
  [-0.07, -0.115],
  [-0.03, -0.03],
  [0.02, -0.01],
  [0.085, -0.085],
  [0.128, -0.02],
];

function speedoShape(view: MaxxView, frame: TorsoFrame): Pt[] {
  const table = view === 'front' ? FRONT_SPEEDO : view === 'back' ? BACK_SPEEDO : SIDE_SPEEDO;
  return table.map(([s, h]) => framePoint(frame.pelvis, s, -h));
}

/**
 * Each leg of the Speedo is cut round its own thigh: a band laid square
 * across the thigh just below the hip joint and carried down the thigh's own
 * direction, so however far the leg swings, the garment still covers where it
 * meets the hip. A fixed outline alone would leave the thigh root bare the
 * moment the leg swung past it.
 *
 * Cut deeper on the side toward the crotch head-on and from behind, and
 * toward the seat edge-on, and shallow on the other: a high-cut leg opening.
 */
const CUFF_ABOVE_HIP = 0.05;
const CUFF_DEEP = 0.05;
const CUFF_SHALLOW = 0.005;
/** Edge-on the front of the leg opening still wraps the top of the thigh, or a raised knee bares the groin. */
const CUFF_SHALLOW_PROFILE = 0.035;
const CUFF_WIDTH_SLACK = 1.02;

function speedoCuffs(view: MaxxView, skel: Skeleton, frame: TorsoFrame): Pt[][] {
  return SIDES.map((side) => {
    const chain = skel.legs[side];
    const hip = flat(project(chain.root, view));
    const knee = flat(project(chain.mid, view));
    const down = unit2(sub2(knee, hip), frame.pelvis.along);
    const across = normal2(down);
    const half = THIGH_ROOT_HALF * (view === 'side' ? PROFILE_THIGH_DEPTH : 1) * CUFF_WIDTH_SLACK;
    // Which side of this thigh the deep cut is on: toward the body's middle
    // head-on and from behind, toward the seat (behind him) edge-on.
    const deepToward =
      view === 'side' ? scale2(frame.pelvis.across, -1) : sub2(frame.pelvis.origin, hip);
    const deepSign = across.x * deepToward.x + across.y * deepToward.y >= 0 ? 1 : -1;
    const top = sub2(hip, scale2(down, CUFF_ABOVE_HIP));
    const shallow = view === 'side' ? CUFF_SHALLOW_PROFILE : CUFF_SHALLOW;
    const edge = (sign: number, depth: number): Pt =>
      add2(add2(hip, scale2(down, depth)), scale2(across, sign * half));
    return [
      add2(top, scale2(across, half)),
      edge(1, deepSign > 0 ? CUFF_DEEP : shallow),
      edge(-1, deepSign < 0 ? CUFF_DEEP : shallow),
      sub2(top, scale2(across, half)),
    ];
  });
}

const WAISTBAND_ALPHA = 0.9;

/** A point on the pelvis frame, in the torso tables' (across, up) units. */
function onPelvis(frame: TorsoFrame, across: number, up: number): Pt {
  return framePoint(frame.pelvis, across, -up);
}

function paintSpeedo(ctx: Ctx, view: MaxxView, frame: TorsoFrame, shape: readonly Pt[]): void {
  fillShape(ctx, SPEEDO.base, () => {
    traceSmooth(ctx, shape);
  });
  const angle = frameAngle(frame);
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceSmooth(ctx, shape);
    },
    () => {
      if (view === 'back') {
        // Two cheeks, each lit on its upper outer curve and shaded under.
        for (const sign of [-1, 1]) {
          const cheek = onPelvis(frame, sign * 0.085, -0.03);
          const lit = onPelvis(frame, sign * 0.1 - 0.02, 0.0);
          fillSoftEllipse(ctx, cheek.x, cheek.y + 0.05, 0.1, 0.05, SPEEDO.deep, 0.7, angle);
          fillSoftEllipse(
            ctx,
            lit.x,
            lit.y,
            0.055,
            0.04,
            SPEEDO.light,
            sign < 0 ? 0.8 : 0.45,
            angle,
          );
        }
        strokeSoftCrease(
          ctx,
          MUSCLE_LINE_WIDTH,
          SPEEDO.deep,
          () => {
            const a = onPelvis(frame, 0, 0.02);
            const b = onPelvis(frame, 0, -0.09);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          },
          0.5,
          BODY_CREASE_LAYERS,
        );
      } else if (view === 'side') {
        const seat = onPelvis(frame, -0.12, -0.03);
        const seatLit = onPelvis(frame, -0.13, 0.02);
        fillSoftEllipse(ctx, seat.x + 0.03, seat.y + 0.05, 0.08, 0.05, SPEEDO.deep, 0.6, angle);
        fillSoftEllipse(ctx, seatLit.x, seatLit.y, 0.05, 0.04, SPEEDO.light, 0.7, angle);
      } else {
        const low = onPelvis(frame, 0.05, -0.02);
        const lit = onPelvis(frame, -0.08, 0.04);
        fillSoftEllipse(ctx, low.x, low.y, 0.12, 0.06, SPEEDO.shadow, 0.6, angle);
        fillSoftEllipse(ctx, lit.x, lit.y, 0.06, 0.025, SPEEDO.light, 0.6, angle);
      }
      // Waistband and a white racing stripe down the hip.
      const bandHigh = view === 'side' ? 0.08 : view === 'back' ? 0.085 : 0.07;
      const a = onPelvis(frame, -0.25, bandHigh - 0.012);
      const b = onPelvis(frame, 0.25, bandHigh - 0.012);
      ctx.save();
      ctx.globalAlpha = clampAlpha(ctx.globalAlpha * WAISTBAND_ALPHA);
      ctx.strokeStyle = SPEEDO.deep;
      ctx.lineWidth = STRAND_WIDTH * 1.6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = SPEEDO_STRIPE;
      ctx.lineWidth = STRAND_WIDTH * 1.6;
      ctx.beginPath();
      const stripeSides = view === 'side' ? [0.0] : [-0.15, 0.15];
      for (const s of stripeSides) {
        const top = onPelvis(frame, s, bandHigh);
        const bottom = onPelvis(frame, s + (view === 'side' ? 0.01 : 0), bandHigh - 0.07);
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bottom.x, bottom.y);
      }
      ctx.stroke();
      ctx.restore();
    },
  );
}

// ── Head ─────────────────────────────────────────────────────────────────────

/** The neck is short and nearly as wide as the jaw. */
const NECK_HALF = 0.078;
const HAIR_BUMP_RADIUS = 0.042;
const HAIR_BUMPS = 9;
const HAIR_CURLS = 16;
const HAIR_SHADE_ALPHA = 0.6;
const HAIR_SHADE_LIFT = 0.2;
/** Where the curls are centred up the head, and how far down they spread, in head radii. */
const CURL_CENTRE_CROWN = 0.55;
const CURL_SPREAD_CROWN = 0.55;
const CURL_CENTRE_BACK = 0.15;
const CURL_SPREAD_BACK = 0.75;

interface HeadDrawing {
  readonly centre: Pt;
  readonly neckBase: Pt;
  readonly skull: Pt[];
  readonly hair: Pt[];
  readonly neck: Pt[];
}

/** Head-on the jaw holds its width to the mouth and then turns in to the chin. */
const FACING_HEAD_EDGE: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0.72, -0.72],
  [1, -0.1],
  [1, 0.3],
  [0.94, 0.62],
  [0.62, 0.92],
  [0, 1.04],
];

/** Edge-on, facing +X: brow, nose, mustache and chin forward, skull behind. */
const PROFILE_HEAD_EDGE: ReadonlyArray<readonly [number, number]> = [
  [-0.1, -1],
  [0.55, -0.9],
  [0.95, -0.45],
  [1.05, -0.2],
  [1.02, 0.05],
  [1.25, 0.28],
  [1.12, 0.45],
  [1.1, 0.62],
  [0.95, 0.95],
  [0.55, 1.03],
  [0.1, 0.8],
  [-0.4, 0.55],
  [-0.95, 0.2],
  [-1.0, -0.35],
  [-0.72, -0.82],
];

function headDrawing(view: MaxxView, skel: Skeleton): HeadDrawing {
  const centre = flat(project(skel.head, view));
  const neckBase = flat(project(skel.neck, view));
  const rx = view === 'side' ? HEAD_DEPTH : HEAD_RX;
  let skull: Pt[];
  if (view === 'side') {
    skull = PROFILE_HEAD_EDGE.map(([x, y]) => ({
      x: centre.x + x * rx,
      y: centre.y + y * HEAD_RY,
    }));
  } else {
    const right = FACING_HEAD_EDGE.map(([x, y]) => ({
      x: centre.x + x * rx,
      y: centre.y + y * HEAD_RY,
    }));
    const left = [...FACING_HEAD_EDGE]
      .slice(1, -1)
      .reverse()
      .map(([x, y]) => ({ x: centre.x - x * rx, y: centre.y + y * HEAD_RY }));
    skull = [...right, ...left];
  }
  const hair = hairShape(view, centre);
  const jaw = { x: centre.x + (view === 'side' ? -0.02 : 0), y: centre.y + HEAD_RY * 0.6 };
  const neck = [
    { x: neckBase.x - NECK_HALF * 1.15, y: neckBase.y + 0.02 },
    { x: jaw.x - NECK_HALF, y: jaw.y },
    { x: jaw.x + NECK_HALF, y: jaw.y },
    { x: neckBase.x + NECK_HALF * 1.15, y: neckBase.y + 0.02 },
  ];
  return { centre, neckBase, skull, hair, neck };
}

/**
 * A curly mop: a soft cloud of bumps round the crown. Head-on it stops at the
 * temples above the ears with a low, nearly straight hairline; from behind it
 * comes down to the nape; edge-on it sweeps back over the skull.
 */
function hairShape(view: MaxxView, c: Pt): Pt[] {
  const rx = view === 'side' ? HEAD_DEPTH : HEAD_RX;
  const pts: Pt[] = [];
  const from = view === 'side' ? Math.PI * 0.7 : view === 'back' ? Math.PI * 0.95 : Math.PI * 1.02;
  const to = view === 'side' ? Math.PI * 1.72 : view === 'back' ? Math.PI * 2.05 : Math.PI * 1.98;
  for (let i = 0; i <= HAIR_BUMPS * 2; i++) {
    const t = i / (HAIR_BUMPS * 2);
    const angle = lerp(from, to, t);
    const bump = i % 2 === 0 ? 1.18 : 1.08;
    pts.push({
      x: c.x + Math.cos(angle) * rx * bump,
      y: c.y + Math.sin(angle) * HEAD_RY * bump - 0.012,
    });
  }
  if (view === 'front') {
    // The hairline: low, a shallow widow's peak, straight across.
    pts.push({ x: c.x + rx * 0.82, y: c.y - HEAD_RY * 0.3 });
    pts.push({ x: c.x + rx * 0.3, y: c.y - HEAD_RY * 0.42 });
    pts.push({ x: c.x, y: c.y - HEAD_RY * 0.34 });
    pts.push({ x: c.x - rx * 0.3, y: c.y - HEAD_RY * 0.42 });
    pts.push({ x: c.x - rx * 0.82, y: c.y - HEAD_RY * 0.3 });
  } else if (view === 'back') {
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = lerp(0.95, -0.95, t);
      const dip = Math.sin(t * Math.PI) * 0.12 + (i % 2 === 0 ? 0.06 : 0);
      pts.push({ x: c.x + x * rx, y: c.y + HEAD_RY * (0.35 + dip) });
    }
  } else {
    // Edge-on: from the forehead, the temple, a sideburn in front of the ear,
    // then round under the ear to the nape.
    pts.push({ x: c.x + rx * 0.55, y: c.y - HEAD_RY * 0.5 });
    pts.push({ x: c.x + rx * 0.3, y: c.y - HEAD_RY * 0.32 });
    pts.push({ x: c.x + rx * 0.18, y: c.y + HEAD_RY * 0.3 });
    pts.push({ x: c.x + rx * 0.02, y: c.y + HEAD_RY * 0.32 });
    pts.push({ x: c.x - rx * 0.08, y: c.y - HEAD_RY * 0.22 });
    pts.push({ x: c.x - rx * 0.4, y: c.y - HEAD_RY * 0.1 });
    pts.push({ x: c.x - rx * 0.62, y: c.y + HEAD_RY * 0.5 });
  }
  return pts;
}

function headPart(view: MaxxView, skel: Skeleton, face: FaceState, near: number): Part {
  const head = headDrawing(view, skel);
  return {
    near,
    silhouette: (ctx) => {
      inkShape(ctx, () => {
        tracePolygon(ctx, head.neck);
      });
      inkShape(ctx, () => {
        traceSmooth(ctx, head.skull);
      });
      if (view !== 'side') {
        inkShape(ctx, () => {
          traceEars(ctx, head.centre);
        });
      }
      inkShape(ctx, () => {
        traceSmooth(ctx, head.hair);
      });
    },
    paint: (ctx) => {
      fillShape(ctx, SKIN.base, () => {
        tracePolygon(ctx, head.neck);
      });
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          tracePolygon(ctx, head.neck);
        },
        () => {
          fillSoftEllipse(
            ctx,
            head.centre.x + 0.04,
            head.centre.y + HEAD_RY * 0.95,
            NECK_HALF * 1.3,
            0.05,
            SKIN.shadow,
            0.9,
          );
          if (view === 'back') {
            paintHairPatch(
              ctx,
              { origin: head.neckBase, along: { x: 0, y: -1 }, across: { x: 1, y: 0 } },
              {
                across: 0,
                along: 0.05,
                rx: NECK_HALF,
                ry: 0.04,
                density: BACK_HAIR_DENSITY,
                tone: 0.5,
              },
              991,
            );
          }
        },
      );
      if (view !== 'side') {
        fillShape(ctx, SKIN.base, () => {
          traceEars(ctx, head.centre);
        });
        fillSoftEllipse(
          ctx,
          head.centre.x + HEAD_RX * 1.05,
          head.centre.y,
          0.015,
          0.025,
          SKIN.shadow,
          0.8,
        );
        fillSoftEllipse(
          ctx,
          head.centre.x - HEAD_RX * 1.05,
          head.centre.y,
          0.015,
          0.025,
          SKIN.shadow,
          0.6,
        );
      }
      fillShape(ctx, SKIN.base, () => {
        traceSmooth(ctx, head.skull);
      });
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceSmooth(ctx, head.skull);
        },
        () => {
          const c = head.centre;
          fillSoftEllipse(
            ctx,
            c.x + HEAD_RX * 0.6,
            c.y + HEAD_RY * 0.2,
            HEAD_RX * 0.8,
            HEAD_RY * 1.1,
            SKIN.shadow,
            0.7,
          );
          fillSoftEllipse(
            ctx,
            c.x - HEAD_RX * 0.35,
            c.y - HEAD_RY * 0.35,
            HEAD_RX * 0.55,
            HEAD_RY * 0.45,
            SKIN.light,
            0.55,
          );
          if (view === 'front') paintFaceFront(ctx, c, face);
          else if (view === 'side') paintFaceSide(ctx, c, face);
          else
            fillSoftEllipse(
              ctx,
              c.x,
              c.y + HEAD_RY * 0.75,
              HEAD_RX * 0.8,
              HEAD_RY * 0.3,
              SKIN.shadow,
              0.5,
            );
        },
      );
      if (view === 'side') paintProfileEar(ctx, head.centre);
      paintHair(ctx, view, head);
    },
  };
}

function traceEars(ctx: Ctx, c: Pt): void {
  for (const sign of [-1, 1]) {
    const x = c.x + sign * HEAD_RX * 1.02;
    ctx.moveTo(x + 0.02, c.y);
    ctx.ellipse(x, c.y, 0.02, 0.03, 0, 0, TWO_PI);
  }
}

function paintProfileEar(ctx: Ctx, c: Pt): void {
  const ear = { x: c.x - HEAD_DEPTH * 0.12, y: c.y + HEAD_RY * 0.02 };
  ctx.fillStyle = SKIN.base;
  ctx.beginPath();
  ctx.ellipse(ear.x, ear.y, 0.024, 0.034, 0, 0, TWO_PI);
  ctx.fill();
  fillSoftEllipse(ctx, ear.x + 0.006, ear.y, 0.012, 0.02, SKIN.deep, 0.6);
}

function paintHair(ctx: Ctx, view: MaxxView, head: HeadDrawing): void {
  fillShape(ctx, HAIR.base, () => {
    traceSmooth(ctx, head.hair);
  });
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceSmooth(ctx, head.hair);
    },
    () => {
      const c = head.centre;
      // Shade away from the light, lifted off the nape: shaded at the bottom
      // edge, the back of the mop reads as a dark band — a headband.
      fillSoftEllipse(
        ctx,
        c.x + HEAD_RX * 0.5,
        c.y - HEAD_RY * HAIR_SHADE_LIFT,
        HEAD_RX,
        HEAD_RY,
        HAIR.deep,
        HAIR_SHADE_ALPHA,
      );
      // Curls: lit crescents scattered over the mop — over the crown head-on
      // and edge-on, over the whole of it from behind.
      const curls = new Path2DBuilder();
      const spreadDown = view === 'back' ? CURL_SPREAD_BACK : CURL_SPREAD_CROWN;
      const centreUp = view === 'back' ? CURL_CENTRE_BACK : CURL_CENTRE_CROWN;
      for (let i = 0; i < HAIR_CURLS; i++) {
        const angle = hash2(i, view === 'side' ? 3 : view === 'back' ? 5 : 7) * TWO_PI;
        const r = Math.sqrt(hash2(i, 11));
        const at = {
          x: c.x + Math.cos(angle) * r * HEAD_RX,
          y: c.y - HEAD_RY * centreUp + Math.sin(angle) * r * HEAD_RY * spreadDown,
        };
        const size = HAIR_BUMP_RADIUS * 0.45;
        curls.strand(
          { x: at.x - size, y: at.y },
          { x: at.x, y: at.y - size * 1.2 },
          { x: at.x + size, y: at.y },
        );
      }
      curls.stroke(ctx, HAIR.light, STRAND_WIDTH * 1.1, 0.75);
    },
  );
}

const EYE_SPACING = 0.044;
const EYE_HEIGHT = -0.01;
const EYE_RX = 0.019;
const EYE_RY = 0.015;
const PUPIL_RADIUS = 0.0085;
const BROW_HEIGHT = -0.042;
const STUBBLE_ALPHA = 0.3;

function paintFaceFront(ctx: Ctx, c: Pt, face: FaceState): void {
  // Stubble over the jaw and chin.
  fillSoftEllipse(
    ctx,
    c.x,
    c.y + HEAD_RY * 0.68,
    HEAD_RX * 0.9,
    HEAD_RY * 0.42,
    HAIR.base,
    STUBBLE_ALPHA,
  );
  // Brow shadow and the nose.
  fillSoftEllipse(ctx, c.x, c.y + EYE_HEIGHT, HEAD_RX * 0.8, 0.028, SKIN.shadow, 0.55);
  fillSoftEllipse(ctx, c.x + 0.012, c.y + 0.045, 0.026, 0.03, SKIN.shadow, 0.7);
  fillSoftEllipse(ctx, c.x - 0.008, c.y + 0.03, 0.012, 0.022, SKIN.light, 0.8);
  paintEyesFront(ctx, c, face.eyes);
  paintBrowsFront(ctx, c, face.brow);
  paintMouthFront(ctx, c, face.mouth);
  paintMustacheFront(ctx, c);
}

function paintEyesFront(ctx: Ctx, c: Pt, eyes: Eyes): void {
  for (const sign of [-1, 1]) {
    const e = { x: c.x + sign * EYE_SPACING, y: c.y + EYE_HEIGHT };
    paintEye(ctx, e, eyes, sign);
  }
}

function paintEye(ctx: Ctx, e: Pt, eyes: Eyes, sign: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  if (eyes === 'shut' || eyes === 'squint') {
    ctx.strokeStyle = PUPIL;
    ctx.lineWidth = STRAND_WIDTH * 1.3;
    ctx.beginPath();
    const lift = eyes === 'squint' ? 0.006 : -0.004;
    ctx.moveTo(e.x - EYE_RX, e.y);
    ctx.quadraticCurveTo(e.x, e.y - lift * 2, e.x + EYE_RX, e.y);
    ctx.stroke();
  } else if (eyes === 'cross') {
    ctx.strokeStyle = PUPIL;
    ctx.lineWidth = STRAND_WIDTH * 1.3;
    ctx.beginPath();
    const r = EYE_RX * 0.8;
    ctx.moveTo(e.x - r, e.y - r);
    ctx.lineTo(e.x + r, e.y + r);
    ctx.moveTo(e.x + r, e.y - r);
    ctx.lineTo(e.x - r, e.y + r);
    ctx.stroke();
  } else {
    const grow = eyes === 'wide' ? 1.25 : 1;
    ctx.fillStyle = EYE_WHITE;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, EYE_RX * grow, EYE_RY * grow, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = PUPIL;
    ctx.beginPath();
    // Pupils sit a little inward: a manic, focused stare.
    ctx.arc(
      e.x - sign * EYE_RX * 0.2,
      e.y + 0.001,
      PUPIL_RADIUS * (eyes === 'wide' ? 0.8 : 1),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.restore();
}

function paintBrowsFront(ctx: Ctx, c: Pt, brow: number): void {
  ctx.save();
  ctx.strokeStyle = HAIR.deep;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.022;
  ctx.beginPath();
  for (const sign of [-1, 1]) {
    const inner = { x: c.x + sign * 0.014, y: c.y + BROW_HEIGHT - brow * 0.012 + 0.008 };
    const outer = { x: c.x + sign * 0.072, y: c.y + BROW_HEIGHT - brow * 0.006 - 0.006 };
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
  }
  ctx.stroke();
  ctx.restore();
}

const MOUTH_Y = 0.088;
const MOUTH_HALF = 0.046;

function paintMouthFront(ctx: Ctx, c: Pt, mouth: Mouth): void {
  const y = c.y + MOUTH_Y;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (mouth === 'grin' || mouth === 'grit') {
    const drop = mouth === 'grin' ? 0.03 : 0.018;
    ctx.fillStyle = MOUTH;
    ctx.beginPath();
    ctx.moveTo(c.x - MOUTH_HALF, y - 0.004);
    ctx.quadraticCurveTo(c.x, y + drop * 1.9, c.x + MOUTH_HALF, y - 0.004);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = TEETH;
    ctx.beginPath();
    ctx.moveTo(c.x - MOUTH_HALF * 0.9, y - 0.001);
    ctx.quadraticCurveTo(
      c.x,
      y + drop * (mouth === 'grit' ? 1.6 : 1.1),
      c.x + MOUTH_HALF * 0.9,
      y - 0.001,
    );
    ctx.closePath();
    ctx.fill();
  } else if (mouth === 'yell' || mouth === 'ouch') {
    const r = mouth === 'yell' ? 0.03 : 0.018;
    ctx.fillStyle = MOUTH;
    ctx.beginPath();
    ctx.ellipse(c.x, y + r * 0.5, r * 1.1, r, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = TONGUE;
    ctx.beginPath();
    ctx.ellipse(c.x, y + r * 1.05, r * 0.7, r * 0.4, 0, 0, TWO_PI);
    ctx.fill();
  } else if (mouth === 'smug') {
    ctx.strokeStyle = MOUTH;
    ctx.lineWidth = STRAND_WIDTH * 1.5;
    ctx.beginPath();
    ctx.moveTo(c.x - MOUTH_HALF, y + 0.002);
    ctx.quadraticCurveTo(c.x, y + 0.02, c.x + MOUTH_HALF, y - 0.012);
    ctx.stroke();
  } else {
    ctx.strokeStyle = MOUTH;
    ctx.lineWidth = STRAND_WIDTH * 1.5;
    ctx.beginPath();
    ctx.moveTo(c.x - MOUTH_HALF * 0.8, y + 0.01);
    ctx.lineTo(c.x + MOUTH_HALF * 0.8, y + 0.006);
    ctx.stroke();
    ctx.fillStyle = TONGUE;
    ctx.beginPath();
    ctx.ellipse(c.x + 0.015, y + 0.026, 0.014, 0.018, 0, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** A thick push-broom mustache sitting right on the upper lip. */
function paintMustacheFront(ctx: Ctx, c: Pt): void {
  const y = c.y + 0.068;
  ctx.save();
  ctx.fillStyle = HAIR.base;
  ctx.beginPath();
  ctx.moveTo(c.x - 0.064, y + 0.022);
  ctx.quadraticCurveTo(c.x - 0.06, y - 0.012, c.x - 0.02, y - 0.012);
  ctx.quadraticCurveTo(c.x, y - 0.004, c.x + 0.02, y - 0.012);
  ctx.quadraticCurveTo(c.x + 0.06, y - 0.012, c.x + 0.064, y + 0.022);
  ctx.quadraticCurveTo(c.x + 0.04, y + 0.012, c.x, y + 0.016);
  ctx.quadraticCurveTo(c.x - 0.04, y + 0.012, c.x - 0.064, y + 0.022);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  fillSoftEllipse(ctx, c.x - 0.02, y - 0.004, 0.024, 0.008, HAIR.light, 0.6);
}

function paintFaceSide(ctx: Ctx, c: Pt, face: FaceState): void {
  const d = HEAD_DEPTH;
  fillSoftEllipse(
    ctx,
    c.x + d * 0.6,
    c.y + HEAD_RY * 0.7,
    d * 0.55,
    HEAD_RY * 0.35,
    HAIR.base,
    STUBBLE_ALPHA,
  );
  fillSoftEllipse(ctx, c.x + d * 0.72, c.y + EYE_HEIGHT, 0.03, 0.022, SKIN.shadow, 0.6);
  // Eye: a single one, set back from the brow.
  paintEye(ctx, { x: c.x + d * 0.68, y: c.y + EYE_HEIGHT }, face.eyes, -1);
  ctx.save();
  ctx.strokeStyle = HAIR.deep;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.022;
  ctx.beginPath();
  ctx.moveTo(c.x + d * 0.5, c.y + BROW_HEIGHT - face.brow * 0.006 - 0.004);
  ctx.lineTo(c.x + d * 0.95, c.y + BROW_HEIGHT - face.brow * 0.012 + 0.006);
  ctx.stroke();
  ctx.restore();
  // The nose's shadow under its bulb.
  fillSoftEllipse(ctx, c.x + d * 1.08, c.y + HEAD_RY * 0.38, 0.02, 0.012, SKIN.deep, 0.6);
  // Mouth corner, under the mustache.
  const my = c.y + MOUTH_Y + 0.004;
  ctx.save();
  if (
    face.mouth === 'grin' ||
    face.mouth === 'grit' ||
    face.mouth === 'yell' ||
    face.mouth === 'ouch'
  ) {
    ctx.fillStyle = MOUTH;
    ctx.beginPath();
    const open = face.mouth === 'yell' ? 0.03 : face.mouth === 'ouch' ? 0.018 : 0.014;
    ctx.moveTo(c.x + d * 1.12, my - 0.004);
    ctx.lineTo(c.x + d * 0.72, my - 0.002);
    ctx.quadraticCurveTo(c.x + d * 0.9, my + open * 1.6, c.x + d * 1.08, my + open);
    ctx.closePath();
    ctx.fill();
    if (face.mouth === 'grin' || face.mouth === 'grit') {
      ctx.fillStyle = TEETH;
      ctx.beginPath();
      ctx.moveTo(c.x + d * 1.1, my - 0.002);
      ctx.lineTo(c.x + d * 0.78, my);
      ctx.quadraticCurveTo(c.x + d * 0.92, my + open * 0.9, c.x + d * 1.06, my + open * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = MOUTH;
    ctx.lineWidth = STRAND_WIDTH * 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.x + d * 1.08, my + 0.004);
    ctx.lineTo(c.x + d * 0.8, my + (face.mouth === 'smug' ? -0.008 : 0.006));
    ctx.stroke();
    if (face.mouth === 'dead') {
      ctx.fillStyle = TONGUE;
      ctx.beginPath();
      ctx.ellipse(c.x + d * 1.05, my + 0.018, 0.013, 0.017, 0, 0, TWO_PI);
      ctx.fill();
    }
  }
  ctx.restore();
  // Mustache, jutting past the lip.
  ctx.save();
  ctx.fillStyle = HAIR.base;
  ctx.beginPath();
  const top = c.y + 0.058;
  ctx.moveTo(c.x + d * 1.18, top);
  ctx.quadraticCurveTo(c.x + d * 1.3, top + 0.03, c.x + d * 1.12, top + 0.036);
  ctx.quadraticCurveTo(c.x + d * 0.9, top + 0.04, c.x + d * 0.78, top + 0.03);
  ctx.quadraticCurveTo(c.x + d * 0.85, top + 0.006, c.x + d * 1.18, top);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Effects ──────────────────────────────────────────────────────────────────

const SPARK_RAYS = 7;
const SPARK_ALPHA = 0.95;

function paintSpark(ctx: Ctx, at: Pt, spark: Spark): void {
  const fade = 1 - spark.progress;
  const reach = spark.size * (0.5 + spark.progress * 0.7);
  ctx.save();
  ctx.globalAlpha = clampAlpha(ctx.globalAlpha * SPARK_ALPHA * fade);
  fillSoftEllipse(ctx, at.x, at.y, spark.size * 0.55, spark.size * 0.55, SPARK_HOT, 1);
  ctx.lineCap = 'round';
  for (const [colour, width] of [
    [SPARK_WARM, STRAND_WIDTH * 2.2],
    [SPARK_HOT, STRAND_WIDTH],
  ] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < SPARK_RAYS; i++) {
      const angle = (i / SPARK_RAYS) * TWO_PI + hash2(i, 13) * 0.5;
      const inner = reach * 0.35;
      const outer = reach * (0.75 + hash2(i, 17) * 0.5);
      ctx.moveTo(at.x + Math.cos(angle) * inner, at.y + Math.sin(angle) * inner);
      ctx.lineTo(at.x + Math.cos(angle) * outer, at.y + Math.sin(angle) * outer);
    }
    ctx.stroke();
  }
  ctx.restore();
}

const DUST_PUFFS = 9;
const DUST_ALPHA = 0.7;

function paintDust(ctx: Ctx, dust: Dust): void {
  const fade = 1 - dust.progress;
  ctx.save();
  for (let i = 0; i < DUST_PUFFS; i++) {
    const angle = (i / DUST_PUFFS) * TWO_PI + hash2(i, 29);
    const out = dust.spread * (0.45 + dust.progress * 0.6) * (0.8 + hash2(i, 31) * 0.4);
    const x = dust.at.x + Math.cos(angle) * out;
    const y = dust.at.y + Math.sin(angle) * out * 0.35 - dust.progress * 0.05;
    const r = dust.spread * (0.16 + hash2(i, 37) * 0.1) * (0.8 + dust.progress * 0.5);
    fillSoftEllipse(
      ctx,
      x + r * 0.2,
      y + r * 0.25,
      r,
      r * 0.75,
      DUST_SHADOW,
      DUST_ALPHA * fade * 0.6,
    );
    fillSoftEllipse(ctx, x, y, r, r * 0.8, DUST, DUST_ALPHA * fade, 0, 0.55);
  }
  ctx.restore();
}

const STAR_COUNT = 3;
const STAR_ORBIT_RX = 0.17;
const STAR_ORBIT_RY = 0.05;
const STAR_SIZE = 0.035;

function paintStars(ctx: Ctx, at: Pt, progress: number): void {
  ctx.save();
  ctx.fillStyle = STAR;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH * 0.8;
  ctx.lineJoin = 'round';
  for (let i = 0; i < STAR_COUNT; i++) {
    const angle = (i / STAR_COUNT + progress) * TWO_PI;
    const x = at.x + Math.cos(angle) * STAR_ORBIT_RX;
    const y = at.y + Math.sin(angle) * STAR_ORBIT_RY;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const r = k % 2 === 0 ? STAR_SIZE : STAR_SIZE * 0.42;
      const a = (k / 8) * TWO_PI - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
  ctx.restore();
}

const GROUND_SHADOW_RX = 0.27;
const GROUND_SHADOW_RY = 0.075;
const GROUND_SHADOW_ALPHA = 0.32;
/** A lying body's shadow is as long as he is. */
const LYING_SHADOW_RX = 0.62;
/** How far up his body its middle is, which is where a lying body's shadow centres. */
const LYING_SHADOW_CENTRE = 0.6;
/** Past this height off the floor his shadow has faded to nothing. */
const SHADOW_FADE_HEIGHT = 0.9;

function paintGroundShadow(ctx: Ctx, pose: MaxxPose, view: MaxxView): void {
  const lift = Math.max(0, HIP_HEIGHT + pose.pelvis.y);
  const fade = clamp01(1 - lift / SHADOW_FADE_HEIGHT);
  const centreX =
    view === 'side' ? pose.pelvis.z : view === 'front' ? -pose.pelvis.x : pose.pelvis.x;
  const rx = lerp(GROUND_SHADOW_RX, LYING_SHADOW_RX, pose.shadowStretch) * lerp(0.7, 1, fade);
  // A falling body's middle swings over with it, and the shadow follows it.
  const x = centreX + LYING_SHADOW_CENTRE * Math.sin(pose.screenRoll);
  fillSoftEllipse(
    ctx,
    x,
    0,
    rx,
    GROUND_SHADOW_RY,
    GROUND_SHADOW,
    GROUND_SHADOW_ALPHA * fade,
    0,
    0.55,
  );
}

// ── Composition ──────────────────────────────────────────────────────────────

/** An arm counts as behind the body, head-on or from behind, past this depth. */
const ARM_BEHIND_DEPTH = 0.08;

function viewParts(view: MaxxView, pose: MaxxPose, skel: Skeleton): Part[] {
  const parts: Part[] = [];
  const chestNear = project(skel.chest, view).near;
  for (const side of SIDES) {
    const hipNear = project(skel.hips[side], view).near;
    const footNear = project(skel.feet[side].ball, view).near;
    // Legs sit under the torso in every view; between the two, the nearer foot wins.
    parts.push(legPart(view, skel, side, -1 + (hipNear + footNear) * 0.1));
  }
  parts.push(torsoPart(view, skel, pose));
  parts.push(headPart(view, skel, pose.face, 0.5));
  for (const side of SIDES) {
    const handNear = project(skel.fists[side], view).near - chestNear;
    const shoulderNear = project(skel.shoulders[side], view).near - chestNear;
    let near: number;
    if (view === 'side') {
      near = shoulderNear > 0 ? 1 + handNear * 0.1 : -2 + handNear * 0.1;
    } else {
      near = handNear < -ARM_BEHIND_DEPTH ? -0.5 + handNear * 0.1 : 1 + handNear * 0.1;
    }
    parts.push(armPart(view, skel, side, near, pose.jabStreak[side], near > 0));
  }
  return parts.sort((a, b) => a.near - b.near);
}

/**
 * Paints Gluteus Maxx in one view and pose, in figure units, with the origin
 * between his feet on the floor. The caller scales tiles to cell pixels.
 */
export function drawMaxx(ctx: Ctx, view: MaxxView, pose: MaxxPose): void {
  const skel = buildSkeleton(pose);
  ctx.save();
  ctx.translate(pose.offset.x, pose.offset.y);
  ctx.scale(MAXX_BODY_SCALE, MAXX_BODY_SCALE);
  paintGroundShadow(ctx, pose, view);
  for (const dust of pose.dust) paintDust(ctx, dust);
  ctx.translate(pose.rollPivot.x, pose.rollPivot.y);
  ctx.rotate(pose.screenRoll);
  ctx.translate(-pose.rollPivot.x, -pose.rollPivot.y);
  ctx.scale(pose.mirrored ? -1 : 1, pose.squash);
  const parts = viewParts(view, pose, skel);
  ctx.save();
  ctx.fillStyle = OUTLINE;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH * 2;
  ctx.lineJoin = 'round';
  ctx.globalAlpha = clampAlpha(ctx.globalAlpha * OUTLINE_ALPHA);
  for (const part of parts) part.silhouette(ctx);
  ctx.restore();
  // A clank in front of his chest from behind is hidden by him; the rest are not.
  const chestNear = project(skel.chest, view).near;
  const hidden = (spark: Spark): boolean => project(spark.at, view).near < chestNear;
  for (const spark of pose.sparks)
    if (hidden(spark)) paintSpark(ctx, flat(project(spark.at, view)), spark);
  for (const part of parts) part.paint(ctx);
  for (const spark of pose.sparks)
    if (!hidden(spark)) paintSpark(ctx, flat(project(spark.at, view)), spark);
  if (pose.stars !== null) paintStars(ctx, flat(project(pose.stars.at, view)), pose.stars.progress);
  ctx.restore();
}
