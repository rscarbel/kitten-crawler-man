/**
 * Drawing engine for the Dark Knight — the bounty board's mace-wielding boss.
 *
 * The skeleton is the one Carl uses (`scripts/carlArt.ts`): a pelvis, a leaning
 * spine, four two-bone limbs solved by inverse kinematics from foot and hand
 * targets, plus a forward-kinematic escape hatch for arms that have to swing
 * rather than reach. Plate armour changes what is *painted* over that skeleton,
 * not the skeleton itself, so every anatomy lesson banked in that rig carries
 * over unchanged.
 *
 * What is specific here is the read the silhouette has to survive: at a 32 px
 * tile the figure must say "articulated plate", not "smooth suit". Three things
 * carry that and are therefore load-bearing rather than decorative:
 *
 *  1. **Every plate is painted as its own mass** by {@link paintPlate} — an ink
 *     border, a bright up-left rim, a mid body and a dark down-right band. The
 *     rim is what separates a pauldron from the arm under it when both are the
 *     same near-black steel.
 *  2. **Joints are discs**, not tapers: a couter at each elbow and a poleyn at
 *     each knee. A limb that narrows smoothly reads as a sleeve.
 *  3. **The skirt of faulds flares**, so the waist is the narrowest point of the
 *     torso and the hips are the widest. That flare is most of the difference
 *     between a knight and a man in a coat at tile size.
 *
 * Everything works in *tile units*: 1.0 is one dungeon tile. The origin is the
 * point between the feet, +X is the direction the figure faces and −Y is up.
 * The caller scales into pixels once, so the sheet can be baked at any
 * resolution.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const DEGREES_PER_RADIAN = 180 / Math.PI;

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export function deg(degrees: number): number {
  return degrees / DEGREES_PER_RADIAN;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Smooth 0→1 ease, for weight shifts and settles. */
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Fast start, slow finish — a limb thrown and then settling. */
export function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/** Slow start, fast finish — a mass gathering before it moves. */
export function easeIn(t: number): number {
  const c = clamp01(t);
  return c * c;
}

/** 0 at both ends, 1 in the middle. */
export function hump(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

/** Remaps `value` from the range [start, end] onto 0→1, clamped. */
export function ramp(value: number, start: number, end: number): number {
  if (end === start) return value >= end ? 1 : 0;
  return clamp01((value - start) / (end - start));
}

function pt(x: number, y: number): Pt {
  return { x, y };
}

function offset(base: Pt, dx: number, dy: number): Pt {
  return { x: base.x + dx, y: base.y + dy };
}

function mixPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function rotate(p: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

function angleBetween(from: Pt, to: Pt): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// ── Colour ───────────────────────────────────────────────────────────────────

/**
 * One material, as the four tones {@link paintPlate} needs.
 *
 * `edge` is deliberately far brighter than `light`: it is only ever a one-pixel
 * rim at tile size, and a rim within a shade or two of the body it edges simply
 * disappears there.
 */
export interface Ramp {
  readonly ink: string;
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
  readonly edge: string;
}

const HEX_RADIX = 16;
const HEX_PAIR = 2;
const RGB_MAX = 255;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hexToRgb(hex: string): Rgb {
  const body = hex.replace('#', '');
  return {
    r: parseInt(body.slice(0, HEX_PAIR), HEX_RADIX),
    g: parseInt(body.slice(HEX_PAIR, HEX_PAIR * 2), HEX_RADIX),
    b: parseInt(body.slice(HEX_PAIR * 2, HEX_PAIR * 3), HEX_RADIX),
  };
}

function channel(value: number): string {
  const clamped = Math.max(0, Math.min(RGB_MAX, Math.round(value)));
  return clamped.toString(HEX_RADIX).padStart(HEX_PAIR, '0');
}

export function mix(a: string, b: string, t: number): string {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  return `#${channel(lerp(from.r, to.r, t))}${channel(lerp(from.g, to.g, t))}${channel(lerp(from.b, to.b, t))}`;
}

/**
 * node-canvas discards an `rgba()` whose alpha serialises in exponent notation,
 * baking a solid smear where a nearly-invisible wash was intended. Anything
 * below the floor is snapped to fully transparent instead.
 */
const ALPHA_EPSILON = 1e-4;

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const safe = alpha < ALPHA_EPSILON ? 0 : alpha;
  return `rgba(${r},${g},${b},${safe})`;
}

/** Blackened plate: the whole figure is this unless it is cloth, brass or leather. */
export const STEEL: Ramp = {
  ink: '#07080b',
  dark: '#2c3446',
  mid: '#525f7e',
  light: '#7284a3',
  edge: '#c6d3e8',
};

/** The far side of the body, mixed toward the ink so depth reads in profile. */
const FAR_STEEL: Ramp = {
  ink: '#05060a',
  dark: '#1b2130',
  mid: '#333c52',
  light: '#48546d',
  edge: '#8794ad',
};

/** Trim, rivets and the helm's reinforcing cross. */
const BRASS: Ramp = {
  ink: '#150e04',
  dark: '#4a3311',
  mid: '#8a6a22',
  light: '#c2a04a',
  edge: '#efd88c',
};

/** The tabard and cloak. A dried-blood crimson, never a clean heraldic red. */
const CLOTH: Ramp = {
  ink: '#170406',
  dark: '#3d0b12',
  mid: '#65131c',
  light: '#8c232e',
  edge: '#b04a54',
};

const FAR_CLOTH: Ramp = {
  ink: '#120305',
  dark: '#25070b',
  mid: '#3b0b11',
  light: '#521118',
  edge: '#6d2029',
};

/** Leather straps and the mace's grip. */
const LEATHER: Ramp = {
  ink: '#100a06',
  dark: '#251a10',
  mid: '#3c2a19',
  light: '#5a4227',
  edge: '#846444',
};

/** What burns behind the eye slit. The only warm colour on the whole figure. */
const VISOR_EMBER = '#ff7a2a';
const VISOR_EMBER_CORE = '#ffd9a0';
const VISOR_VOID = '#050507';

const CONTACT_SHADOW = '#000000';
const CONTACT_SHADOW_ALPHA = 0.42;

// ── Proportions ──────────────────────────────────────────────────────────────
// Heights are y values and therefore negative: the origin is between the feet
// and +Y runs down the screen.

/**
 * Standing height, sabaton sole to the top of the helm.
 *
 * Half again Carl's 2.03 in the same units, which is what "he is a head and a
 * half taller than you and twice as wide" costs. The generator scales the whole
 * figure once at bake time; nothing here is retuned to change his size.
 */
export const FIGURE_HEIGHT = 2.28;
/**
 * Heads tall, counting the great helm as the head. Fewer than Carl's 4.8
 * because the helm is a bucket rather than a skull — it has to stay a legible
 * block on top of the silhouette at 32 px.
 */
const HEADS_TALL = 5.0;
const HEAD_HEIGHT = FIGURE_HEIGHT / HEADS_TALL;

/**
 * Slack so a planted leg is not mathematically locked straight. Tiny on
 * purpose: the knee's sideways travel grows as the square root of it, so a few
 * percent here bows both legs into parentheses.
 */
const LEG_SLACK = 1.004;
/**
 * How high the ankle rides above the sole. Generous, and it has to be: the leg
 * is very nearly as long as the hip is high, so this is the only headroom the
 * solver has before a stride clamps it straight. Trimmed to the sabaton's own
 * height the walk had none and hopped.
 */
const ANKLE_Y = -0.12;
const KNEE_Y = -0.62;
/** The hip sits at half the standing height, which is where a human's does. */
const HIP_Y = -FIGURE_HEIGHT / 2;
const WAIST_Y = -1.33;
export const SHOULDER_Y = -1.8;
const HEAD_CENTRE_Y = -2.055;

const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * LEG_SLACK;
const SHIN_LENGTH = Math.abs(KNEE_Y - ANKLE_Y) * LEG_SLACK;
export const UPPER_ARM_LENGTH = 0.375;
export const FOREARM_LENGTH = 0.325;
/** Shoulder to wrist. A relaxed arm hangs at very nearly this. */
export const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

/** Shoulders are the widest thing on him by a long way; the waist is pinched. */
const SHOULDER_HALF = 0.375;
/** Head-on the shoulders carry the whole read of his bulk, so they spread. */
const FACING_SHOULDER_SPREAD = 1.12;
/** Where a thigh roots, measured in from the hip centre. */
const LEG_ROOT_HALF = 0.132;
const CHEST_HALF = 0.33;
const WAIST_HALF = 0.225;
/** Arms root at the breastplate's shoulder edge, not inside its silhouette. */
const ARM_INSET = 0.92;
export const ARM_ROOT_HALF = SHOULDER_HALF * ARM_INSET;
export const FACING_ARM_ROOT_HALF = ARM_ROOT_HALF * FACING_SHOULDER_SPREAD;
/** The arm's root hangs this far below the shoulder line, not on it. */
export const SHOULDER_JOINT_DROP = 0.06;

/** Armoured limbs are thicker than bare ones and barely taper. */
const THIGH_WIDTH = 0.135;
const KNEE_WIDTH = 0.088;
const CALF_WIDTH = 0.108;
const ANKLE_WIDTH = 0.062;
/** How far down the shin the greave reaches its widest. */
const CALF_AT = 0.32;
const UPPER_ARM_WIDTH = 0.086;
const ELBOW_WIDTH = 0.062;
const WRIST_WIDTH = 0.05;

/**
 * Half-width of the plate capping each elbow and knee — the articulation cue.
 *
 * It must be wider than *both* segments it joins, or it disappears into the
 * limb and the leg reads as one tapered tube. Drawn as a hard-cornered shell
 * rather than a disc: a shaded circle is a ball, and a limb built of balls is
 * a balloon animal.
 */
const COUTER_RADIUS = 0.085;
const POLEYN_RADIUS = 0.115;

/** The gauntlet's fist, and the flared cuff behind it. */
const FIST_RADIUS = 0.072;
const GAUNTLET_CUFF_RADIUS = 0.083;
const GAUNTLET_CUFF_LENGTH = 0.075;

/** The sabaton: a long boxy shoe with a blunt toe. */
const SABATON_LENGTH = FIGURE_HEIGHT * 0.17;
const SABATON_HEIGHT = 0.105;
const SABATON_HEEL_SHARE = 0.26;
/** How much of its length a sabaton loses when it points at the camera. */
const SABATON_FORESHORTEN = 0.46;

/**
 * The helm head-on is a tall block, in profile a deeper one. Two radii, never
 * one: a helm as deep as it is wide reads as a ball with a slot cut in it.
 */
const HEAD_WIDTH_RATIO = 0.86;
const HEAD_DEPTH_RATIO = 0.98;
const HEAD_RY = HEAD_HEIGHT / 2;
const HEAD_RX = HEAD_RY * HEAD_WIDTH_RATIO;
const HEAD_DEPTH = HEAD_RY * HEAD_DEPTH_RATIO;
/** How square the top of the helm is: 0 is a dome, 1 a flat lid. */
const HELM_CROWN_FLATNESS = 0.82;
const GORGET_WIDTH = 0.115;
const GORGET_TOP_Y = HEAD_CENTRE_Y + HEAD_RY * 0.62;

/** Side-on, the limbs gather toward the centreline instead of splaying wide. */
const PROFILE_LATERAL = 0.3;

// ── Views ────────────────────────────────────────────────────────────────────

export type KnightView = 'front' | 'back' | 'side';

interface ViewSpec {
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
  /** Narrows the breastplate's shoulders and chest without touching its waist. */
  readonly chestTaper: number;
  /** Multiplier on the torso's drawn width; a body is nearly as deep as wide. */
  readonly girth: number;
  /** Extra trim on the faulds, which are less deep than they are wide. */
  readonly hipDepth: number;
  /** How far apart the two shoulder joints are drawn. */
  readonly armSpread: number;
  /** How deep the notch between the tassets is cut, 0 for a flat hem. */
  readonly crotchNotch: number;
  /** True when the figure is seen edge-on rather than head-on. */
  readonly profile: boolean;
  /** True when the eye slit faces the camera. */
  readonly showsVisor: boolean;
  /** True when the backplate and the full spread of the cloak are shown. */
  readonly showsBack: boolean;
}

const PROFILE_GIRTH = 0.7;
const PROFILE_HIP_DEPTH = 0.86;
const PROFILE_ARM_SPREAD = 0.13;
const PROFILE_CHEST_TAPER = 0.8;
const PROFILE_CROTCH_NOTCH = 0.2;

const VIEWS: Record<KnightView, ViewSpec> = {
  front: {
    lateral: 1,
    girth: 1,
    hipDepth: 1,
    armSpread: 1,
    chestTaper: 1,
    crotchNotch: 1,
    profile: false,
    showsVisor: true,
    showsBack: false,
  },
  back: {
    lateral: 1,
    girth: 1,
    hipDepth: 1,
    armSpread: 1,
    chestTaper: 1,
    crotchNotch: 1,
    profile: false,
    showsVisor: false,
    showsBack: true,
  },
  side: {
    lateral: PROFILE_LATERAL,
    girth: PROFILE_GIRTH,
    hipDepth: PROFILE_HIP_DEPTH,
    armSpread: PROFILE_ARM_SPREAD,
    chestTaper: PROFILE_CHEST_TAPER,
    crotchNotch: PROFILE_CROTCH_NOTCH,
    profile: true,
    showsVisor: true,
    showsBack: false,
  },
};

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * Where an arm's two segments point, in radians from hanging straight down.
 * Positive swings forward, which is +X in the profile the figure is drawn in.
 */
export interface ArmAngles {
  readonly upper: number;
  readonly fore: number;
  /**
   * Fraction of its true length the forearm is drawn at, for a limb swinging
   * toward or away from the camera. A 2D arm has no other way to foreshorten.
   */
  readonly foreScale: number;
}

/**
 * One frame of the Dark Knight. Hand and foot positions are targets in figure
 * space that the limb solver reaches for; `left`/`right` are the figure's own,
 * and in profile the right side is the near one.
 */
export interface KnightPose {
  /** Whole-body vertical offset; negative lifts him off the ground. */
  bob: number;
  /** Hip shift along X — weight transfer, not a step. */
  sway: number;
  /** Torso lean in radians; positive tips the shoulders toward +X. */
  lean: number;
  /** 0 stands tall, 1 sinks into a deep crouch. */
  crouch: number;
  /** Shoulder rotation about the spine, −1 to 1, seen as a width shift. */
  twist: number;
  /** Head turn, −1 to 1; head-on it slides the visor across the helm. */
  headTurn: number;
  /** Head tilt in radians. */
  headTilt: number;
  leftHand: Pt;
  rightHand: Pt;
  leftFoot: Pt;
  rightFoot: Pt;
  /** Foot pitch in radians; positive points the toes down. */
  leftFootPitch: number;
  rightFootPitch: number;
  /** +1 bows a knee away from the centreline, −1 folds it up in front. */
  leftKneeBreak: number;
  rightKneeBreak: number;
  /** How much a leg points at the camera rather than across it, 0 to 1. */
  leftForeshorten: number;
  rightForeshorten: number;
  /** How much nearer the camera a leg's shin is than its thigh, 0 to 1. */
  leftLegNearness: number;
  rightLegNearness: number;
  /** Elbows swing behind the body at 1 and in front of it at −1. */
  elbowFlare: number;
  /** Drives an arm from joint angles instead of a hand target. Wins when set. */
  leftArmAngles: ArmAngles | null;
  rightArmAngles: ArmAngles | null;
  /** Whether an arm is on the far side of the torso, so drawn before it. */
  leftArmBehind: boolean;
  rightArmBehind: boolean;
  /**
   * Forces the off arm in front of the torso even in profile, where it is
   * otherwise always the far one.
   *
   * Needed by exactly one pose and load-bearing there: a jab thrown edge-on is
   * *the* thing the animation has to show, and drawn behind the body it is
   * hidden by it — the silhouette then does not change by a single pixel across
   * the whole row, which is what a reviewer measured and read as no punch at
   * all.
   */
  leftArmInFront: boolean;
  /**
   * Absolute direction, in figure-space radians, from the mace grip toward the
   * mace head. Authored rather than taken from the forearm: a whirl has to
   * corner smoothly around the helm while the wrist barely moves, and a haft
   * angle derived from the arm cannot do that.
   */
  maceAngle: number;
  /**
   * Draw the mace before the body rather than over it. A haul-back passes the
   * mace behind the helm, and painting it in front there buries the face.
   */
  macePropBehind: boolean;
  /** 0 dims the eye slit to an ember, 1 is the full burn. */
  visorGlow: number;
  /** Cloak drift, −1 to 1; positive blows the hem toward +X. */
  cloakSway: number;
  /** How far the faulds kick out from the body, 0 to 1. */
  skirtFlare: number;
  /**
   * Scale on the off hand's fist. A 2D arm punching at the camera cannot travel
   * across the picture, so the only cues it has are a shortened forearm and a
   * fist that grows — without the second one a head-on jab is invisible.
   */
  offFistScale: number;
}

/**
 * A relaxed arm reaches nearly its full length, and it does so from the
 * shoulder *joint* — measuring the drop from the shoulder line instead leaves
 * the solver slack, which it spends folding the elbow out sideways.
 */
const RESTING_HAND_DROP = SHOULDER_JOINT_DROP + ARM_LENGTH * 0.985;
const RESTING_HAND_SPREAD = 0.375;
const RESTING_FOOT_SPREAD = 0.155;
/** The mace hangs point-down at rest, which is −Y in screen terms inverted. */
const MACE_RESTING_ANGLE = deg(80);

/** A relaxed standing pose. Every animation is written as edits to this. */
export function restingPose(): KnightPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    crouch: 0,
    twist: 0,
    headTurn: 0,
    headTilt: 0,
    leftHand: pt(-RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    rightHand: pt(RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    leftFoot: pt(-RESTING_FOOT_SPREAD, 0),
    rightFoot: pt(RESTING_FOOT_SPREAD, 0),
    leftFootPitch: 0,
    rightFootPitch: 0,
    leftKneeBreak: 1,
    rightKneeBreak: 1,
    leftForeshorten: 0,
    rightForeshorten: 0,
    leftLegNearness: 0,
    rightLegNearness: 0,
    elbowFlare: 0.3,
    leftArmAngles: null,
    rightArmAngles: null,
    leftArmBehind: false,
    rightArmBehind: false,
    leftArmInFront: false,
    maceAngle: MACE_RESTING_ANGLE,
    macePropBehind: false,
    visorGlow: 0.55,
    cloakSway: 0,
    skirtFlare: 0,
    offFistScale: 1,
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

interface BoneChain {
  root: Pt;
  joint: Pt;
  end: Pt;
}

/**
 * Keeps a fully extended limb from locking into a straight, lifeless line.
 * Tiny, because the joint's sideways travel grows as the square root of it.
 */
const JOINT_SLACK = 0.0003;

/**
 * Places a two-segment limb so its end sits on `target`. `bendSign` picks which
 * side the joint pops out to: +1 toward +X of the root→target line, −1 toward −X.
 */
function solveTwoBone(
  root: Pt,
  target: Pt,
  upper: number,
  lower: number,
  bendSign: number,
): BoneChain {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const raw = Math.hypot(dx, dy);
  const dirX = raw === 0 ? 0 : dx / raw;
  const dirY = raw === 0 ? 1 : dy / raw;

  const minReach = Math.abs(upper - lower) + JOINT_SLACK;
  const maxReach = upper + lower - JOINT_SLACK;
  const dist = Math.min(Math.max(raw, minReach), maxReach);

  const end = { x: root.x + dirX * dist, y: root.y + dirY * dist };
  const along = (dist * dist + upper * upper - lower * lower) / (2 * dist);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  const joint = {
    x: root.x + dirX * along - dirY * out * bendSign,
    y: root.y + dirY * along + dirX * out * bendSign,
  };
  return { root, joint, end };
}

/** Where the knee falls along a straight, unbent leg. */
const KNEE_ALONG_LEG = THIGH_LENGTH / (THIGH_LENGTH + SHIN_LENGTH);

/** Pulls a solved leg's knee onto the hip→ankle line, for a leg seen end-on. */
function foreshortenLeg(chain: BoneChain, amount: number): BoneChain {
  if (amount <= 0) return chain;
  const straightKnee = mixPt(chain.root, chain.end, KNEE_ALONG_LEG);
  return { ...chain, joint: mixPt(chain.joint, straightKnee, clamp01(amount)) };
}

interface Skeleton {
  hip: Pt;
  waist: Pt;
  chest: Pt;
  shoulderCentre: Pt;
  neck: Pt;
  headCentre: Pt;
  leftShoulder: Pt;
  rightShoulder: Pt;
  leftLeg: BoneChain;
  rightLeg: BoneChain;
  leftArm: BoneChain;
  rightArm: BoneChain;
  shoulderHalf: number;
}

/** How much of the hip height a full crouch removes. */
const CROUCH_DROP = 0.32;
/** Facing +X, a knee that bends toward +X is bending forward. */
const PROFILE_KNEE_FORWARD = -1;
/** A twisted torso narrows on the trailing side and widens on the leading one. */
const TWIST_WIDTH_GAIN = 0.16;
const TWIST_SHOULDER_SHIFT = 0.06;
/** Where the chest sits between hip and shoulder, as a share of that span. */
const CHEST_ALONG_SPINE = 0.72;
/** How far the head slides across the helm at full turn, as a share of its width. */
const HEAD_TURN_TRAVEL = 0.5;

/** Offset from the hip to a point `height` up the leaning spine. */
function spinePoint(hip: Pt, height: number, lean: number): Pt {
  const rotated = rotate({ x: 0, y: -height }, lean);
  return offset(hip, rotated.x, rotated.y);
}

/** Forward kinematics for an arm: shoulder angle, then elbow angle. */
function armFromAngles(shoulder: Pt, angles: ArmAngles): BoneChain {
  const upper = rotate({ x: 0, y: UPPER_ARM_LENGTH }, -angles.upper);
  const joint = offset(shoulder, upper.x, upper.y);
  const fore = rotate({ x: 0, y: FOREARM_LENGTH * angles.foreScale }, -angles.fore);
  return { root: shoulder, joint, end: offset(joint, fore.x, fore.y) };
}

function elbowBend(flare: number): number {
  return flare < 0 ? -1 : 1;
}

/** The ankle for a foot planted at `target`: up the leg by the sabaton's height. */
function ankleFor(target: Pt, pitch: number): Pt {
  const lifted = rotate({ x: 0, y: ANKLE_Y }, -pitch);
  return offset(target, lifted.x, lifted.y);
}

function buildSkeleton(pose: KnightPose, view: ViewSpec): Skeleton {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);

  const waist = spinePoint(hip, Math.abs(WAIST_Y - HIP_Y), pose.lean);
  const chest = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y) * CHEST_ALONG_SPINE, pose.lean);
  const shoulderCentre = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y), pose.lean);
  const neck = spinePoint(hip, Math.abs(GORGET_TOP_Y - HIP_Y), pose.lean);
  const headCentre = offset(
    spinePoint(hip, Math.abs(HEAD_CENTRE_Y - HIP_Y), pose.lean),
    pose.headTurn * HEAD_RX * view.lateral * HEAD_TURN_TRAVEL,
    0,
  );

  const spread = view.profile ? 1 : FACING_SHOULDER_SPREAD;
  const shoulderHalf = SHOULDER_HALF * view.girth * spread;
  const twistShift = pose.twist * TWIST_SHOULDER_SHIFT * view.lateral;
  const armRoot = ARM_ROOT_HALF * view.armSpread * spread;
  const leftHalf = armRoot * (1 - pose.twist * TWIST_WIDTH_GAIN);
  const rightHalf = armRoot * (1 + pose.twist * TWIST_WIDTH_GAIN);

  const leftShoulder = offset(shoulderCentre, -leftHalf + twistShift, SHOULDER_JOINT_DROP);
  const rightShoulder = offset(shoulderCentre, rightHalf + twistShift, SHOULDER_JOINT_DROP);
  const hipHalf = LEG_ROOT_HALF * view.lateral;

  return {
    hip,
    waist,
    chest,
    shoulderCentre,
    neck,
    headCentre,
    leftShoulder,
    rightShoulder,
    shoulderHalf,
    // A standing knee breaks away from the centreline; edge-on that rule would
    // send the two knees in opposite screen directions and hinge one backward,
    // so in profile both break forward instead.
    leftLeg: foreshortenLeg(
      solveTwoBone(
        offset(hip, -hipHalf, 0),
        ankleFor(pose.leftFoot, pose.leftFootPitch),
        THIGH_LENGTH,
        SHIN_LENGTH,
        view.profile ? PROFILE_KNEE_FORWARD * pose.leftKneeBreak : pose.leftKneeBreak,
      ),
      pose.leftForeshorten,
    ),
    rightLeg: foreshortenLeg(
      solveTwoBone(
        offset(hip, hipHalf, 0),
        ankleFor(pose.rightFoot, pose.rightFootPitch),
        THIGH_LENGTH,
        SHIN_LENGTH,
        view.profile ? PROFILE_KNEE_FORWARD * pose.rightKneeBreak : -pose.rightKneeBreak,
      ),
      pose.rightForeshorten,
    ),
    // A positive elbowFlare bows both elbows away from the ribs, which is why
    // the two arms take opposite bend signs.
    leftArm:
      pose.leftArmAngles === null
        ? solveTwoBone(
            leftShoulder,
            pose.leftHand,
            UPPER_ARM_LENGTH,
            FOREARM_LENGTH,
            elbowBend(pose.elbowFlare),
          )
        : armFromAngles(leftShoulder, pose.leftArmAngles),
    rightArm:
      pose.rightArmAngles === null
        ? solveTwoBone(
            rightShoulder,
            pose.rightHand,
            UPPER_ARM_LENGTH,
            FOREARM_LENGTH,
            -elbowBend(pose.elbowFlare),
          )
        : armFromAngles(rightShoulder, pose.rightArmAngles),
  };
}

// ── Plate painting ───────────────────────────────────────────────────────────

/** How far the ink border is grown past a plate's own outline. */
const PLATE_OUTLINE_GROW = 0.013;
/**
 * How far the mid and dark bands are shifted down-right inside a plate. The
 * up-left crescent left behind is the bright rim that makes the plate read as
 * a curved metal surface rather than as a flat cut-out.
 */
const BEVEL_X = 0.0065;
const BEVEL_Y = 0.008;
/** Multiple of the bevel at which the darkest band starts. */
const BEVEL_SHADE_STEP = 2.4;

type Trace = (grow: number) => void;

/**
 * Paints one plate: ink border, bright body, a mid band shifted off the light
 * and a dark band shifted further. Three flat tones rather than a gradient —
 * node-canvas gradients have burned this codebase before, and banded steel is
 * the look anyway.
 */
function paintPlate(ctx: Ctx, trace: Trace, ramp: Ramp, bevelScale = 1): void {
  ctx.fillStyle = ramp.ink;
  trace(PLATE_OUTLINE_GROW);
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();

  ctx.fillStyle = ramp.edge;
  trace(0);
  ctx.fill();

  ctx.save();
  ctx.translate(BEVEL_X * bevelScale, BEVEL_Y * bevelScale);
  ctx.fillStyle = ramp.light;
  trace(0);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(
    BEVEL_X * bevelScale * BEVEL_SHADE_STEP * 0.55,
    BEVEL_Y * bevelScale * BEVEL_SHADE_STEP * 0.55,
  );
  ctx.fillStyle = ramp.mid;
  trace(0);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(BEVEL_X * bevelScale * BEVEL_SHADE_STEP, BEVEL_Y * bevelScale * BEVEL_SHADE_STEP);
  ctx.fillStyle = ramp.dark;
  trace(0);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/** Adds a capsule — a quad between two circles, both caps rounded — to the current path. */
function capsuleSubpath(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const angle = angleBetween(a, b);
  const normal = angle + HALF_PI;
  const nx = Math.cos(normal);
  const ny = Math.sin(normal);
  const ra = Math.max(0, wa);
  const rb = Math.max(0, wb);
  ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
  ctx.arc(a.x, a.y, ra, normal, normal + Math.PI);
  ctx.lineTo(b.x - nx * rb, b.y - ny * rb);
  ctx.arc(b.x, b.y, rb, normal + Math.PI, normal + TWO_PI);
  ctx.closePath();
}

/** Adds an ellipse to the current path. */
function ellipseSubpath(ctx: Ctx, centre: Pt, rx: number, ry: number, angle: number): void {
  ctx.moveTo(centre.x + rx, centre.y);
  ctx.ellipse(centre.x, centre.y, Math.max(0, rx), Math.max(0, ry), angle, 0, TWO_PI);
  ctx.closePath();
}

/** Adds a closed polygon, grown outward along each vertex's own radius. */
function polygonSubpath(ctx: Ctx, points: readonly Pt[], grow: number): void {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / points.length;
  const cy = sy / points.length;
  points.forEach((p, index) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const x = p.x + (dx / len) * grow;
    const y = p.y + (dy / len) * grow;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/**
 * One shape assembled from several overlapping pieces, filled as a single mass.
 *
 * This is the whole difference between a knight and a balloon animal. Painting
 * an upper arm, an elbow disc and a forearm as three separately shaded pieces
 * gives three beads on a string; unioning them into one path and shading *that*
 * gives one limb with a bump at the joint, which is what an articulated arm
 * looks like. Overlapping subpaths wound the same way fill as their union under
 * the default nonzero rule, so no clipping is needed.
 */
type Piece = (ctx: Ctx, grow: number) => void;

function unionTrace(ctx: Ctx, pieces: readonly Piece[]): Trace {
  return (grow) => {
    ctx.beginPath();
    for (const piece of pieces) piece(ctx, grow);
  };
}

function capsulePiece(a: Pt, b: Pt, wa: number, wb: number): Piece {
  return (ctx, grow) => capsuleSubpath(ctx, a, b, wa + grow, wb + grow);
}

function ellipsePiece(centre: Pt, rx: number, ry: number, angle = 0): Piece {
  return (ctx, grow) => ellipseSubpath(ctx, centre, rx + grow, ry + grow, angle);
}

function polygonPiece(points: readonly Pt[]): Piece {
  return (ctx, grow) => polygonSubpath(ctx, points, grow);
}

function paintPieces(ctx: Ctx, pieces: readonly Piece[], ramp: Ramp, bevelScale = 1): void {
  paintPlate(ctx, unionTrace(ctx, pieces), ramp, bevelScale);
}

/**
 * A dark seam scored across a mass, which is how a plate boundary reads once
 * the two plates either side of it are one silhouette. Clipped to the mass so
 * the line never escapes the piece it divides.
 */
function scoreSeam(ctx: Ctx, trace: Trace, from: Pt, to: Pt, ramp: Ramp, width = SEAM_WIDTH): void {
  ctx.save();
  trace(0);
  ctx.clip();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = ramp.ink;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  // A hairline of the bright tone on the near side of the seam: a plate lip
  // catches the light, and without it the seam reads as a crack rather than as
  // one plate overlapping another.
  ctx.strokeStyle = rgba(ramp.edge, SEAM_LIP_ALPHA);
  ctx.lineWidth = width * SEAM_LIP_SHARE;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y - width);
  ctx.lineTo(to.x, to.y - width);
  ctx.stroke();
  ctx.restore();
}

const SEAM_WIDTH = 0.016;
const SEAM_LIP_SHARE = 0.5;
const SEAM_LIP_ALPHA = 0.55;

/**
 * The shell over an elbow or a knee: a hard-cornered hexagon square to the limb
 * and wider than both segments it joins. A shaded circle here is a ball, and a
 * limb assembled from balls is a balloon animal — the one thing this figure is
 * most at risk of reading as.
 */
function jointPlatePiece(centre: Pt, along: number, halfWidth: number): Piece {
  const forward = { x: Math.cos(along), y: Math.sin(along) };
  const side = { x: -forward.y, y: forward.x };
  const reach = halfWidth * JOINT_PLATE_REACH;
  const at = (u: number, v: number): Pt => ({
    x: centre.x + forward.x * v + side.x * u,
    y: centre.y + forward.y * v + side.y * u,
  });
  return polygonPiece([
    at(-halfWidth, -reach * 0.55),
    at(-halfWidth * 0.72, -reach),
    at(halfWidth * 0.72, -reach),
    at(halfWidth, -reach * 0.55),
    at(halfWidth * 0.86, reach * 0.75),
    at(-halfWidth * 0.86, reach * 0.75),
  ]);
}

/** How far along the limb a joint plate reaches, as a share of its half-width. */
const JOINT_PLATE_REACH = 0.95;

/** A perpendicular across a limb at `centre`, for scoring a joint seam. */
function acrossLimb(centre: Pt, along: number, halfWidth: number): { from: Pt; to: Pt } {
  const nx = -Math.sin(along);
  const ny = Math.cos(along);
  return {
    from: { x: centre.x - nx * halfWidth, y: centre.y - ny * halfWidth },
    to: { x: centre.x + nx * halfWidth, y: centre.y + ny * halfWidth },
  };
}

// ── Ground shadow ────────────────────────────────────────────────────────────

const SHADOW_RX = 0.34;
/**
 * Half-height of the contact shadow. Exported because it is the only ink the
 * figure puts *below* its own ground line, so the bake's anchor gate has to
 * know about it to tell a moved anchor from a shadow.
 */
export const SHADOW_RY = 0.115;
const SHADOW_FOLLOW = 0.6;
const SHADOW_LIFT_FADE = 1.6;
const SHADOW_LIFT_SHRINK = 0.55;

function drawGroundShadow(ctx: Ctx, cx: number, rx: number, ry: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.fillStyle = rgba(CONTACT_SHADOW, alpha);
  ctx.beginPath();
  ctx.ellipse(cx, 0, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
}

// ── Legs ─────────────────────────────────────────────────────────────────────

/**
 * A leg pointed at the camera is a change in *width*, not an angle: the shin
 * stops pinching at the knee and widens toward the thigh. This is the only
 * thing `legNearness` does, which is why it may differ between the two legs.
 */
function legWidths(nearness: number): { thigh: number; knee: number; calf: number; ankle: number } {
  const near = clamp01(nearness);
  return {
    thigh: THIGH_WIDTH,
    knee: lerp(KNEE_WIDTH, THIGH_WIDTH * 0.94, near),
    calf: lerp(CALF_WIDTH, THIGH_WIDTH * 0.98, near),
    ankle: lerp(ANKLE_WIDTH, CALF_WIDTH, near),
  };
}

function drawSabaton(
  ctx: Ctx,
  ankle: Pt,
  pitch: number,
  view: ViewSpec,
  outward: number,
  ramp: Ramp,
): void {
  // A foot pointed at the camera cannot be splayed by rotating it — that rolls
  // the figure onto the outside edges of both soles. The toe end leads outward
  // and the sole stays level instead.
  const length = view.profile ? SABATON_LENGTH : SABATON_LENGTH * SABATON_FORESHORTEN;
  const heel = -length * SABATON_HEEL_SHARE;
  const toe = length * (1 - SABATON_HEEL_SHARE);
  const splay = view.profile ? 0 : outward * SABATON_LENGTH * 0.2;
  const sole = SABATON_HEIGHT;

  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(pitch);

  // A long shoe that comes to a blunt point. The point is the whole read: a
  // rounded box under a leg is a boot, and a boot on a knight is a missing
  // sabaton.
  const points: Pt[] = [
    pt(heel, -sole * 0.9),
    pt(heel * 0.55, -sole * 1.05),
    pt(toe * 0.5 + splay * 0.4, -sole * 0.72),
    pt(toe * 0.92 + splay, -sole * 0.1),
    pt(toe + splay * 1.15, sole * 0.16),
    pt(toe * 0.55 + splay * 0.5, sole * 0.34),
    pt(heel * 1.1, sole * 0.3),
  ];
  const shoe = [polygonPiece(points)];
  paintPieces(ctx, shoe, ramp);

  // Toe lames: two seams across the front of the shoe.
  const trace = unionTrace(ctx, shoe);
  const LAME_COUNT = 2;
  for (let i = 1; i <= LAME_COUNT; i++) {
    const along = lerp(toe * 0.3, toe * 0.82, i / (LAME_COUNT + 1)) + splay * 0.4;
    scoreSeam(
      ctx,
      trace,
      pt(along, -sole * 1.1),
      pt(along - sole * 0.25, sole * 0.4),
      ramp,
      SEAM_WIDTH * 0.8,
    );
  }
  ctx.restore();
}

function drawLeg(
  ctx: Ctx,
  chain: BoneChain,
  pitch: number,
  view: ViewSpec,
  outward: number,
  nearness: number,
  ramp: Ramp,
): void {
  const widths = legWidths(nearness);
  const calfAt = mixPt(chain.joint, chain.end, CALF_AT);

  // Cuisse, poleyn and greave as one silhouette with a bump at the knee, then
  // the plate boundary scored across it. Painted as three separate masses they
  // read as a string of beads, which was the first thing a reviewer saw.
  const pieces: Piece[] = [
    capsulePiece(chain.root, chain.joint, widths.thigh, widths.knee),
    jointPlatePiece(chain.joint, angleBetween(chain.root, chain.end), POLEYN_RADIUS),
    capsulePiece(chain.joint, calfAt, widths.knee, widths.calf),
    capsulePiece(calfAt, chain.end, widths.calf, widths.ankle),
  ];
  paintPieces(ctx, pieces, ramp);

  const trace = unionTrace(ctx, pieces);
  const thighAngle = angleBetween(chain.root, chain.joint);
  const shinAngle = angleBetween(chain.joint, chain.end);
  // Two seams, above and below the knee: that pair is what says the poleyn is a
  // separate plate strapped over the joint rather than a swelling in the leg.
  const above = acrossLimb(
    mixPt(chain.root, chain.joint, POLEYN_SEAM_ALONG),
    thighAngle,
    POLEYN_RADIUS,
  );
  const below = acrossLimb(
    mixPt(chain.joint, chain.end, 1 - POLEYN_SEAM_ALONG),
    shinAngle,
    POLEYN_RADIUS,
  );
  scoreSeam(ctx, trace, above.from, above.to, ramp);
  scoreSeam(ctx, trace, below.from, below.to, ramp);

  drawSabaton(ctx, chain.end, pitch, view, outward, ramp);
}

/** How far up the thigh and down the shin the poleyn's edges are scored. */
const POLEYN_SEAM_ALONG = 0.82;

// ── Arms ─────────────────────────────────────────────────────────────────────

/** The cuff and fist, as pieces of whatever mass they are being unioned into. */
function gauntletPieces(chain: BoneChain, fistScale: number): Piece[] {
  const forearmAngle = angleBetween(chain.joint, chain.end);
  const cuffBack = offset(
    chain.end,
    -Math.cos(forearmAngle) * GAUNTLET_CUFF_LENGTH,
    -Math.sin(forearmAngle) * GAUNTLET_CUFF_LENGTH,
  );
  // The cuff flares *wider* than the wrist it covers: that step is the whole
  // reason a gauntlet reads as a gauntlet rather than as a sleeve end.
  return [
    capsulePiece(cuffBack, chain.end, GAUNTLET_CUFF_RADIUS, FIST_RADIUS * fistScale),
    ellipsePiece(chain.end, FIST_RADIUS * fistScale, FIST_RADIUS * 0.94 * fistScale, forearmAngle),
  ];
}

/**
 * The gauntlet's own seams and knuckle studs, painted over whatever mass it was
 * unioned into.
 */
function drawGauntletDetail(ctx: Ctx, chain: BoneChain, ramp: Ramp, fistScale: number): void {
  const forearmAngle = angleBetween(chain.joint, chain.end);
  const cuffBack = offset(
    chain.end,
    -Math.cos(forearmAngle) * GAUNTLET_CUFF_LENGTH,
    -Math.sin(forearmAngle) * GAUNTLET_CUFF_LENGTH,
  );
  const trace = unionTrace(ctx, gauntletPieces(chain, fistScale));
  const wristSeam = acrossLimb(cuffBack, forearmAngle, GAUNTLET_CUFF_RADIUS);
  scoreSeam(ctx, trace, wristSeam.from, wristSeam.to, ramp);

  // Knuckle gadlings — three studs across the back of the fist.
  const KNUCKLE_COUNT = 3;
  const fist = FIST_RADIUS * fistScale;
  const knuckleRadius = fist * 0.22;
  ctx.save();
  trace(0);
  ctx.clip();
  ctx.fillStyle = rgba(ramp.edge, 0.6);
  for (let i = 0; i < KNUCKLE_COUNT; i++) {
    const across = (i / (KNUCKLE_COUNT - 1) - 0.5) * fist * 1.3;
    const along = fist * 0.4;
    const px = chain.end.x + Math.cos(forearmAngle) * along - Math.sin(forearmAngle) * across;
    const py = chain.end.y + Math.sin(forearmAngle) * along + Math.cos(forearmAngle) * across;
    ctx.beginPath();
    ctx.arc(px, py, knuckleRadius, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** The mace hand, drawn alone so it comes back over the haft it grips. */
function drawGauntlet(ctx: Ctx, chain: BoneChain, ramp: Ramp, fistScale = 1): void {
  paintPieces(ctx, gauntletPieces(chain, fistScale), ramp, GAUNTLET_BEVEL);
  drawGauntletDetail(ctx, chain, ramp, fistScale);
}

/** The gauntlet is small, so it takes a shallower bevel or it reads as a bead. */
const GAUNTLET_BEVEL = 0.65;

function drawArm(ctx: Ctx, chain: BoneChain, ramp: Ramp, fistScale = 1): void {
  // Rerebrace, couter, vambrace *and* gauntlet as one silhouette. Painted as
  // separate masses each carries its own ink border, and five bordered lumps in
  // a row read as beads on a string however well they overlap.
  const pieces: Piece[] = [
    capsulePiece(chain.root, chain.joint, UPPER_ARM_WIDTH, ELBOW_WIDTH),
    jointPlatePiece(chain.joint, angleBetween(chain.root, chain.end), COUTER_RADIUS),
    capsulePiece(chain.joint, chain.end, ELBOW_WIDTH, WRIST_WIDTH),
    ...gauntletPieces(chain, fistScale),
  ];
  paintPieces(ctx, pieces, ramp);

  const trace = unionTrace(ctx, pieces);
  const upperAngle = angleBetween(chain.root, chain.joint);
  const foreAngle = angleBetween(chain.joint, chain.end);
  const above = acrossLimb(
    mixPt(chain.root, chain.joint, COUTER_SEAM_ALONG),
    upperAngle,
    COUTER_RADIUS,
  );
  const below = acrossLimb(
    mixPt(chain.joint, chain.end, 1 - COUTER_SEAM_ALONG),
    foreAngle,
    COUTER_RADIUS,
  );
  scoreSeam(ctx, trace, above.from, above.to, ramp);
  scoreSeam(ctx, trace, below.from, below.to, ramp);
  // The gauntlet's own seams and studs, over the shared mass.
  drawGauntletDetail(ctx, chain, ramp, fistScale);
}

/** How far along each segment the couter's edges are scored. */
const COUTER_SEAM_ALONG = 0.8;

/**
 * The pauldron: one flared cap sitting *on* the shoulder and overhanging it
 * outward, with its lames scored in. Three stacked ellipses — the first
 * attempt — read as bubbles blown out of the chest, because a shaded circle is
 * a sphere and three of them are three spheres.
 */
const PAULDRON_HALF_WIDTH = 0.2;
const PAULDRON_HEIGHT = 0.185;
const PAULDRON_LAMES = 2;
/**
 * How far the cap is lifted above the shoulder joint it caps.
 *
 * Small, and it has to be. Lifted clear the pauldron becomes a horizontal shelf
 * with daylight under it, and the figure reads as a scarecrow's crossbar rather
 * than as a shoulder: a reviewer named exactly that. It must sit *over* the
 * deltoid, sharing area with the arm beneath it.
 */
const PAULDRON_LIFT = 0.03;
/** How far it overhangs outboard of the arm. */
const PAULDRON_OUTSET = 0.045;
/** How far the outer edge rolls *down* past the inner one. A level outer edge is the shelf. */
const PAULDRON_ROLL = 0.075;

function drawPauldron(ctx: Ctx, shoulder: Pt, outward: number, ramp: Ramp): void {
  const centre = offset(shoulder, outward * PAULDRON_OUTSET, -PAULDRON_LIFT);
  const top = centre.y - PAULDRON_HEIGHT * 0.55;
  const bottom = centre.y + PAULDRON_HEIGHT * 0.75;
  const inner = centre.x - outward * PAULDRON_HALF_WIDTH * 0.62;
  const outer = centre.x + outward * PAULDRON_HALF_WIDTH;
  // A wedge that is widest at its lower outer corner: the shoulder's mass
  // hangs outboard, which is what makes the figure read broad at tile size.
  const cap: Pt[] = [
    pt(inner, top + PAULDRON_HEIGHT * 0.15),
    pt(centre.x + outward * PAULDRON_HALF_WIDTH * 0.25, top),
    pt(outer, top + PAULDRON_HEIGHT * 0.5 + PAULDRON_ROLL),
    pt(outer - outward * PAULDRON_HALF_WIDTH * 0.1, bottom + PAULDRON_ROLL),
    pt(inner + outward * PAULDRON_HALF_WIDTH * 0.2, bottom - PAULDRON_HEIGHT * 0.1),
  ];
  const pieces = [polygonPiece(cap)];
  paintPieces(ctx, pieces, ramp);

  const trace = unionTrace(ctx, pieces);
  for (let lame = 1; lame <= PAULDRON_LAMES; lame++) {
    const t = lame / (PAULDRON_LAMES + 1);
    const y = lerp(top, bottom, t);
    scoreSeam(
      ctx,
      trace,
      pt(inner - PAULDRON_HALF_WIDTH * 0.2 * outward, y),
      pt(outer + PAULDRON_HALF_WIDTH * 0.2 * outward, y + PAULDRON_HEIGHT * 0.1),
      ramp,
    );
  }
}

// ── Torso ────────────────────────────────────────────────────────────────────

/** How far the faulds kick out past the hip at full flare. */
const SKIRT_FLARE_GAIN = 0.075;
const FAULD_LAMES = 3;
const TASSET_DROP = 0.21;
/**
 * Wide enough that the two tassets meet across the front. Left with a gap they
 * read as saddlebags hung on a floating box rather than as the bottom of a
 * cuirass.
 */
const TASSET_HALF_WIDTH = 0.145;
/**
 * How much wider than the waist the lowest fauld lame sits.
 *
 * Capped well under the shoulder line on purpose: hips as wide as shoulders is
 * the barrel silhouette, and a skirt is the easiest way in the world to draw
 * one by accident.
 */
const SKIRT_SPREAD = 1.28;

function traceBreastplate(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): Trace {
  const shoulderHalf = skeleton.shoulderHalf * view.chestTaper;
  const chestHalf = CHEST_HALF * view.girth * view.chestTaper;
  const waistHalf = WAIST_HALF * view.girth;
  const { shoulderCentre, chest, waist } = skeleton;
  return (grow) => {
    ctx.beginPath();
    ctx.moveTo(shoulderCentre.x - shoulderHalf - grow, shoulderCentre.y);
    ctx.quadraticCurveTo(
      chest.x - chestHalf - grow,
      chest.y,
      waist.x - waistHalf - grow,
      waist.y + grow,
    );
    ctx.lineTo(waist.x + waistHalf + grow, waist.y + grow);
    ctx.quadraticCurveTo(
      chest.x + chestHalf + grow,
      chest.y,
      shoulderCentre.x + shoulderHalf + grow,
      shoulderCentre.y,
    );
    ctx.quadraticCurveTo(
      shoulderCentre.x,
      shoulderCentre.y - shoulderHalf * 0.4 - grow,
      shoulderCentre.x - shoulderHalf - grow,
      shoulderCentre.y,
    );
    ctx.closePath();
  };
}

/**
 * The skirt of overlapping lames hanging off the breastplate, plus its tassets.
 *
 * The lames widen downward and each overhangs the one above by a dark seam, so
 * the waist is the narrowest part of the torso and the hips the widest. That
 * flare is most of the difference between a knight and a man in a long coat at
 * a 32 px tile.
 */
function drawFaulds(
  ctx: Ctx,
  skeleton: Skeleton,
  pose: KnightPose,
  view: ViewSpec,
  ramp: Ramp,
): void {
  const waistHalf = WAIST_HALF * view.girth;
  const hipHalf = waistHalf * SKIRT_SPREAD * view.hipDepth;
  const flare = hipHalf + pose.skirtFlare * SKIRT_FLARE_GAIN;
  const top = skeleton.waist;
  const bottom = skeleton.hip;
  const height = Math.abs(bottom.y - top.y) / FAULD_LAMES;

  for (let lame = 0; lame < FAULD_LAMES; lame++) {
    const upper = lame / FAULD_LAMES;
    const lower = (lame + 1) / FAULD_LAMES;
    const topHalf = lerp(waistHalf, flare, upper);
    const bottomHalf = lerp(waistHalf, flare, lower);
    const topY = lerp(top.y, bottom.y, upper);
    const bottomY = lerp(top.y, bottom.y, lower) + height * FAULD_OVERLAP;
    const cx = lerp(top.x, bottom.x, lower);
    paintPieces(
      ctx,
      [
        polygonPiece([
          pt(cx - topHalf, topY),
          pt(cx + topHalf, topY),
          pt(cx + bottomHalf, bottomY),
          pt(cx - bottomHalf, bottomY),
        ]),
      ],
      ramp,
      FAULD_BEVEL,
    );
  }

  // Tassets: the two plates hanging over the thighs. The notch between them is
  // what stops the skirt reading as a bell.
  const notch = view.crotchNotch;
  for (const side of [-1, 1] as const) {
    const cx = bottom.x + side * (flare - TASSET_HALF_WIDTH * 0.72);
    paintPieces(
      ctx,
      [
        polygonPiece([
          pt(cx - TASSET_HALF_WIDTH, bottom.y - TASSET_DROP * 0.12),
          pt(cx + TASSET_HALF_WIDTH, bottom.y - TASSET_DROP * 0.12),
          pt(cx + TASSET_HALF_WIDTH * 0.82, bottom.y + TASSET_DROP * notch),
          pt(cx - TASSET_HALF_WIDTH * 0.82, bottom.y + TASSET_DROP * notch),
        ]),
      ],
      ramp,
      FAULD_BEVEL,
    );
  }
}

/** How far each lame hangs past the one below it, as a share of its own height. */
const FAULD_OVERLAP = 0.4;
/** Lames are thin, so a full bevel would eat them; they take a shallow one. */
const FAULD_BEVEL = 0.55;

/** The tabard: a narrow band of cloth down the centre of the breastplate. */
const TABARD_HALF_WIDTH = 0.055;

function drawTabard(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, ramp: Ramp): void {
  if (view.showsBack) return;
  const top = skeleton.chest;
  // Stopped at the skirt. Run past it the band drops between the thighs and
  // reads as blood, or as bare red legs.
  const bottom = offset(skeleton.hip, 0, TASSET_DROP * 0.25);
  const half = TABARD_HALF_WIDTH * view.girth;
  paintPieces(
    ctx,
    [
      polygonPiece([
        pt(top.x - half, top.y),
        pt(top.x + half, top.y),
        pt(bottom.x + half * 1.2, bottom.y - TASSET_DROP * 0.25),
        pt(bottom.x, bottom.y),
        pt(bottom.x - half * 1.2, bottom.y - TASSET_DROP * 0.25),
      ]),
    ],
    ramp,
    0.5,
  );
}

function drawBreastplate(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, ramp: Ramp): void {
  const trace = traceBreastplate(ctx, skeleton, view);
  paintPlate(ctx, trace, ramp);

  ctx.save();
  trace(0);
  ctx.clip();
  if (view.showsBack) {
    // The backplate is one smooth shell with a spine seam down it.
    ctx.strokeStyle = rgba(ramp.ink, 0.8);
    ctx.lineWidth = SEAM_WIDTH;
    ctx.beginPath();
    ctx.moveTo(skeleton.shoulderCentre.x, skeleton.shoulderCentre.y);
    ctx.lineTo(skeleton.waist.x, skeleton.waist.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // The roll along the top edge of the cuirass, then the medial ridge running
  // down from it. Head-on this is the only thing separating a breastplate from
  // a barrel. Two round swells were tried first and read unmistakably as a
  // chest rather than as armour — the highlight has to follow the *edge* of the
  // plate, not sit in the middle of it.
  const chestHalf = CHEST_HALF * view.girth * view.chestTaper;
  ctx.fillStyle = rgba(ramp.light, CUIRASS_ROLL_ALPHA);
  ctx.beginPath();
  ctx.moveTo(skeleton.shoulderCentre.x - chestHalf, skeleton.shoulderCentre.y);
  ctx.quadraticCurveTo(
    skeleton.shoulderCentre.x,
    skeleton.shoulderCentre.y + chestHalf * 0.5,
    skeleton.shoulderCentre.x + chestHalf,
    skeleton.shoulderCentre.y,
  );
  ctx.quadraticCurveTo(
    skeleton.shoulderCentre.x,
    skeleton.shoulderCentre.y + chestHalf * 0.18,
    skeleton.shoulderCentre.x - chestHalf,
    skeleton.shoulderCentre.y,
  );
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(ramp.ink, 0.85);
  ctx.lineWidth = SEAM_WIDTH * 1.2;
  ctx.beginPath();
  ctx.moveTo(skeleton.shoulderCentre.x, skeleton.shoulderCentre.y);
  ctx.lineTo(skeleton.waist.x, skeleton.waist.y);
  ctx.stroke();
  // A hard shadow under the chest, which is where the breastplate's lower half
  // turns away from the light.
  ctx.fillStyle = rgba(ramp.ink, BELLY_SHADE_ALPHA);
  ctx.beginPath();
  ctx.moveTo(skeleton.waist.x - chestHalf * 1.4, skeleton.waist.y);
  ctx.quadraticCurveTo(
    skeleton.waist.x,
    skeleton.waist.y - chestHalf * 0.55,
    skeleton.waist.x + chestHalf * 1.4,
    skeleton.waist.y,
  );
  ctx.lineTo(skeleton.waist.x + chestHalf * 1.4, skeleton.waist.y + chestHalf);
  ctx.lineTo(skeleton.waist.x - chestHalf * 1.4, skeleton.waist.y + chestHalf);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const CUIRASS_ROLL_ALPHA = 0.5;
const BELLY_SHADE_ALPHA = 0.4;

/** The cloak, drawn behind everything and widest when seen from the back. */
/**
 * Head-on the cloak shows only as the sliver that hangs past his own outline.
 * Given the back view's spread it wraps round both legs and the figure reads as
 * a red-skirted silhouette rather than an armoured one.
 */
const CLOAK_WIDTH = 0.25;
/**
 * Narrow enough that the fauld lip and the greaves still show outside it. A
 * cloak that covers the whole of the back leaves the rear silhouette with no
 * plate cues at all, and the knight then reads as a different character coming
 * and going.
 */
const CLOAK_BACK_WIDTH = 0.4;
/**
 * How far the cloak hangs. Head-on it is cut short: at full length the hem
 * shows either side of the greaves as two red columns, which a reviewer read as
 * red trousers at review scale and as a red smear at a 32 px tile.
 */
const CLOAK_LENGTH = 1.36;
const FACING_CLOAK_LENGTH = 0.78;
const CLOAK_SWAY_GAIN = 0.18;
/** How much of the cloak's width its shoulder line spans. */
const CLOAK_SHOULDER_SHARE = 0.92;
/** How far the cloak's shoulder line sits above the shoulder joints. */
const CLOAK_RISE = 0.05;

function drawCloak(ctx: Ctx, skeleton: Skeleton, pose: KnightPose, view: ViewSpec): void {
  const top = skeleton.shoulderCentre;
  const half = view.showsBack ? CLOAK_BACK_WIDTH : CLOAK_WIDTH * view.girth;
  const cloakLength = view.showsBack ? CLOAK_LENGTH : FACING_CLOAK_LENGTH;
  const hemY = top.y + cloakLength;
  const drift = pose.cloakSway * CLOAK_SWAY_GAIN;
  const ramp = view.showsBack ? CLOTH : FAR_CLOTH;

  // Sprung from the full width of the shoulders rather than from a point
  // between them: hung narrow, the cloth first appears at the waist where it
  // flares past the breastplate, and the cape reads as a skirt that materialises
  // at the hips with nothing holding it up.
  ctx.fillStyle = ramp.ink;
  ctx.beginPath();
  ctx.moveTo(top.x - half * CLOAK_SHOULDER_SHARE, top.y - CLOAK_RISE);
  ctx.quadraticCurveTo(top.x - half * 1.2 + drift, hemY * 0.75, top.x - half + drift, hemY);
  ctx.quadraticCurveTo(top.x + drift, hemY + CLOAK_LENGTH * 0.05, top.x + half + drift, hemY);
  ctx.quadraticCurveTo(
    top.x + half * 1.2 + drift,
    hemY * 0.75,
    top.x + half * 0.68,
    top.y - PLATE_OUTLINE_GROW,
  );
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = ramp.mid;
  ctx.fillRect(top.x - half * 1.4, top.y - half, half * 2.8, cloakLength * 1.4);
  // Folds: vertical bands of the darker tone. Flat cloth at this size is a cape
  // shaped hole in the picture.
  const FOLD_COUNT = 4;
  ctx.fillStyle = ramp.dark;
  for (let i = 0; i < FOLD_COUNT; i++) {
    const t = (i + 0.5) / FOLD_COUNT;
    const x = lerp(top.x - half, top.x + half, t) + drift * t;
    ctx.beginPath();
    ctx.moveTo(x - half * 0.06, top.y);
    ctx.quadraticCurveTo(x + drift * 0.5, hemY * 0.6, x + drift - half * 0.09, hemY + half * 0.1);
    ctx.lineTo(x + drift + half * 0.09, hemY + half * 0.1);
    ctx.quadraticCurveTo(x + drift * 0.5, hemY * 0.6, x + half * 0.06, top.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ── Helm ─────────────────────────────────────────────────────────────────────

const VISOR_SLIT_Y = -0.06;
const VISOR_SLIT_HALF_WIDTH = 0.72;
const VISOR_SLIT_HEIGHT = 0.115;
const HELM_BREATH_COUNT = 4;
const HELM_BREATH_Y = 0.42;
const HELM_CREST_HEIGHT = 0.3;

/** Traces the great helm in head-local space: origin at its centre, +X forward. */
function traceHelm(ctx: Ctx, rx: number, ry: number): Trace {
  const crown = ry * HELM_CROWN_FLATNESS;
  return (grow) => {
    const w = rx + grow;
    const h = ry + grow;
    const c = crown + grow;
    ctx.beginPath();
    ctx.moveTo(-w * 0.78, -c);
    ctx.lineTo(w * 0.78, -c);
    ctx.quadraticCurveTo(w, -c, w, -c * 0.55);
    // The sides bulge slightly then draw in at the chin — a straight-sided
    // bucket reads as a bin, and a rounded one as a diving helmet.
    ctx.quadraticCurveTo(w * 1.04, h * 0.28, w * 0.7, h * 0.86);
    ctx.quadraticCurveTo(0, h * 1.06, -w * 0.7, h * 0.86);
    ctx.quadraticCurveTo(-w * 1.04, h * 0.28, -w, -c * 0.55);
    ctx.quadraticCurveTo(-w, -c, -w * 0.78, -c);
    ctx.closePath();
  };
}

function drawHelm(ctx: Ctx, pose: KnightPose, view: ViewSpec): void {
  const rx = view.profile ? HEAD_DEPTH : HEAD_RX;
  const ry = HEAD_RY;
  const ramp = STEEL;

  // The crest: a low blade along the top of the helm. It is what stops the
  // silhouette ending in a flat lid, which at 32 px reads as a bucket.
  const crestTop = -ry * HELM_CROWN_FLATNESS - ry * HELM_CREST_HEIGHT;
  // Head-on the crest is seen edge-on, so it is drawn as a low block rather
  // than a blade: at a 32 px tile a one-pixel spike reads as an antenna, and an
  // antenna reads as a robot.
  const crestHalf = view.profile ? rx * 0.86 : rx * 0.3;
  paintPieces(
    ctx,
    [
      polygonPiece([
        pt(-crestHalf, -ry * HELM_CROWN_FLATNESS),
        pt(-crestHalf * 0.5, crestTop),
        pt(crestHalf * 0.5, crestTop),
        pt(crestHalf, -ry * HELM_CROWN_FLATNESS),
      ]),
    ],
    ramp,
    0.6,
  );

  paintPlate(ctx, traceHelm(ctx, rx, ry), ramp);

  ctx.save();
  traceHelm(ctx, rx, ry)(0);
  ctx.clip();

  if (view.showsVisor) {
    // Reinforcing cross: the vertical rib and the brow band the slit is cut in.
    ctx.fillStyle = BRASS.mid;
    const RIB_HALF = 0.055;
    const ribX = view.profile ? rx * 0.55 : 0;
    ctx.fillRect(ribX - RIB_HALF * rx, -ry, RIB_HALF * rx * 2, ry * 2);
    ctx.fillStyle = BRASS.light;
    ctx.fillRect(ribX - RIB_HALF * rx, -ry, RIB_HALF * rx * 0.7, ry * 2);

    const slitHalf = rx * VISOR_SLIT_HALF_WIDTH * (view.profile ? 0.62 : 1);
    const slitCx = view.profile ? rx * 0.44 : 0;
    const slitY = ry * VISOR_SLIT_Y;
    const slitH = ry * VISOR_SLIT_HEIGHT;

    ctx.fillStyle = BRASS.dark;
    ctx.fillRect(
      slitCx - slitHalf - 0.012,
      slitY - slitH - 0.012,
      (slitHalf + 0.012) * 2,
      (slitH + 0.012) * 2,
    );
    ctx.fillStyle = VISOR_VOID;
    ctx.fillRect(slitCx - slitHalf, slitY - slitH, slitHalf * 2, slitH * 2);

    // The slit itself glows, dimly, along its whole length before the two
    // embers are laid in it. Without the connecting bar the pair reads as two
    // round eyes on a robot rather than as light behind a visor.
    const glow = clamp01(pose.visorGlow);
    ctx.fillStyle = rgba(VISOR_EMBER, 0.14 + 0.2 * glow);
    ctx.fillRect(slitCx - slitHalf, slitY - slitH * 0.62, slitHalf * 2, slitH * 1.24);
    const EYE_SPREAD = 0.44;
    const eyeCount = view.profile ? 1 : 2;
    for (let i = 0; i < eyeCount; i++) {
      const side = eyeCount === 1 ? 0.35 : (i === 0 ? -1 : 1) * EYE_SPREAD;
      const ex = slitCx + slitHalf * side;
      ctx.fillStyle = rgba(VISOR_EMBER, 0.35 + 0.5 * glow);
      ctx.beginPath();
      ctx.ellipse(ex, slitY, slitH * 1.5, slitH * 0.92, 0, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = rgba(VISOR_EMBER_CORE, 0.6 + 0.4 * glow);
      ctx.beginPath();
      ctx.ellipse(ex, slitY, slitH * 0.62, slitH * 0.46, 0, 0, TWO_PI);
      ctx.fill();
    }

    // Breaths: the punched holes below the slit.
    ctx.fillStyle = VISOR_VOID;
    for (let i = 0; i < HELM_BREATH_COUNT; i++) {
      const t = (i + 0.5) / HELM_BREATH_COUNT;
      const bx = slitCx + lerp(-slitHalf * 0.7, slitHalf * 0.7, t);
      ctx.beginPath();
      ctx.arc(bx, ry * HELM_BREATH_Y, ry * 0.055, 0, TWO_PI);
      ctx.fill();
    }
  } else {
    // From behind: the skull plate's seam, and nothing else.
    // The seam alone. Rivets were tried at two heights and read as eyes at
    // both: a pair of dark dots on an anonymous helm is a face wherever you put
    // them, and a knight walking away then appears to be walking toward you.
    ctx.strokeStyle = rgba(ramp.edge, 0.45);
    ctx.lineWidth = 0.013;
    ctx.beginPath();
    ctx.moveTo(0, -ry * HELM_CROWN_FLATNESS);
    ctx.lineTo(0, ry * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

// ── The mace ─────────────────────────────────────────────────────────────────

/**
 * The mace, in its own space: the grip sits at the origin and the head lies
 * along +X. Callers rotate it into place.
 *
 * Its identity is entirely in the outline — a plain shaft that ends in a short,
 * wide, many-cornered lump. Detail does not rescue a wrong silhouette, so the
 * flanges are drawn deep enough to survive being two pixels tall.
 */
export const MACE_HAFT_LENGTH = 0.72;
export const MACE_HAFT_WIDTH = 0.034;
export const MACE_HEAD_LENGTH = 0.25;
export const MACE_HEAD_HALF_WIDTH = 0.15;
/** How far the grip runs back past the hand, so the fist is not at the butt. */
const MACE_GRIP_OVERHANG = 0.12;
const MACE_POMMEL_RADIUS = 0.05;
/** How much of each flange's length runs at full width before it steps back. */
const MACE_FLANGE_TIP_SHARE = 0.55;
/** How far the outline steps back between flanges, as a share of the head's half-width. */
const MACE_FLANGE_NOTCH = 0.42;
/**
 * How much of the haft is leather-bound. Short: seen over his shoulder the grip
 * is most of what shows, and a long brown section there reads as a bare forearm
 * rather than as a weapon.
 */
const MACE_GRIP_SHARE = 0.2;
/** Overall reach from grip to the tip of the head — used by the arc gates. */
export const MACE_REACH = MACE_HAFT_LENGTH + MACE_HEAD_LENGTH * 0.5;

/** Anything the knight carries, drawn in figure space after the near arm. */
export type PropPainter = (ctx: Ctx, grip: Pt, angle: number) => void;

/**
 * The mace, in its own space: the grip sits at the origin and the head lies
 * along +X.
 *
 * Its identity is entirely in the outline — a plain shaft ending in a short,
 * wide, many-cornered lump. Detail does not rescue a wrong silhouette, so the
 * flanges are cut deep enough to survive being two pixels tall, and the head is
 * drawn as one closed shape rather than as a stack of wedges: at a 32 px tile a
 * radiating star reads as a morningstar, and a mace has to read as a *weight*.
 */
export function makeMacePainter(): PropPainter {
  const base = MACE_HAFT_LENGTH - MACE_HEAD_LENGTH * 0.24;
  const tip = base + MACE_HEAD_LENGTH;
  // Each flange is a blade: a straight leading edge running out to a squared
  // corner, then a hard step back to the shaft. Soft lobes here read as a
  // feather duster — that is not a figure of speech, it is what a blind naming
  // test called the first attempt.
  // Unequal steps. Three parallel grooves of the same width across a rounded
  // head read as fingers, and a blind naming test duly called the whole thing a
  // fist on a stick.
  const FLANGE_SPANS: readonly number[] = [0.44, 0.31, 0.25];
  /** Where each flange starts and ends along the head, as fractions of it. */
  const flangeEdges: number[] = [0];
  for (const span of FLANGE_SPANS) flangeEdges.push(flangeEdges[flangeEdges.length - 1] + span);

  const headOutline: Pt[] = [pt(base, -MACE_HAFT_WIDTH * 1.6)];
  for (let i = 0; i < FLANGE_SPANS.length; i++) {
    const near = base + flangeEdges[i] * MACE_HEAD_LENGTH;
    const far = base + flangeEdges[i + 1] * MACE_HEAD_LENGTH;
    headOutline.push(pt(near, -MACE_HEAD_HALF_WIDTH));
    headOutline.push(pt(lerp(near, far, MACE_FLANGE_TIP_SHARE), -MACE_HEAD_HALF_WIDTH));
    headOutline.push(pt(far, -MACE_HEAD_HALF_WIDTH * MACE_FLANGE_NOTCH));
  }
  headOutline.push(pt(tip + MACE_HEAD_LENGTH * 0.2, 0));
  for (let i = FLANGE_SPANS.length - 1; i >= 0; i--) {
    const near = base + flangeEdges[i] * MACE_HEAD_LENGTH;
    const far = base + flangeEdges[i + 1] * MACE_HEAD_LENGTH;
    headOutline.push(pt(far, MACE_HEAD_HALF_WIDTH * MACE_FLANGE_NOTCH));
    headOutline.push(pt(lerp(near, far, MACE_FLANGE_TIP_SHARE), MACE_HEAD_HALF_WIDTH));
    headOutline.push(pt(near, MACE_HEAD_HALF_WIDTH));
  }
  headOutline.push(pt(base, MACE_HAFT_WIDTH * 1.6));

  return (ctx, grip, angle) => {
    ctx.save();
    ctx.translate(grip.x, grip.y);
    ctx.rotate(angle);

    // Pommel and leather-bound grip as one mass, then the bare shaft above it.
    paintPieces(
      ctx,
      [
        ellipsePiece(pt(-MACE_GRIP_OVERHANG, 0), MACE_POMMEL_RADIUS, MACE_POMMEL_RADIUS),
        capsulePiece(
          pt(-MACE_GRIP_OVERHANG, 0),
          pt(MACE_HAFT_LENGTH * MACE_GRIP_SHARE, 0),
          MACE_HAFT_WIDTH,
          MACE_HAFT_WIDTH * 0.92,
        ),
      ],
      LEATHER,
      0.5,
    );
    paintPieces(
      ctx,
      [
        capsulePiece(
          pt(MACE_HAFT_LENGTH * (MACE_GRIP_SHARE - 0.02), 0),
          pt(MACE_HAFT_LENGTH, 0),
          MACE_HAFT_WIDTH * 0.92,
          MACE_HAFT_WIDTH * 0.88,
        ),
      ],
      STEEL,
      0.5,
    );

    // Painted a step brighter than the armour: the head is most often swung
    // past the helm, and at equal value the two merge into one dark lump and
    // the weapon reads as a crest.
    paintPieces(ctx, [polygonPiece(headOutline)], MACE_HEAD_STEEL, MACE_HEAD_BEVEL);
    // A brass collar where the head meets the haft: the one warm accent, and
    // the thing that tells the eye where the weapon stops and the weight begins.
    ctx.fillStyle = BRASS.mid;
    ctx.fillRect(
      base - MACE_HEAD_LENGTH * 0.2,
      -MACE_HAFT_WIDTH * 2,
      MACE_HEAD_LENGTH * 0.14,
      MACE_HAFT_WIDTH * 4,
    );
    ctx.fillStyle = BRASS.light;
    ctx.fillRect(
      base - MACE_HEAD_LENGTH * 0.2,
      -MACE_HAFT_WIDTH * 2,
      MACE_HEAD_LENGTH * 0.14,
      MACE_HAFT_WIDTH,
    );

    ctx.restore();
  };
}

/**
 * The head is a small shape, so a deep bevel pushes its dark band across most
 * of it and the whole weapon sinks into the background it is swung against.
 */
const MACE_HEAD_BEVEL = 0.8;

/** A worn, lighter steel, so the head separates from the plate behind it. */
const MACE_HEAD_STEEL: Ramp = {
  ink: '#0a0b10',
  dark: '#3a4356',
  mid: '#5d6a80',
  light: '#8494ae',
  edge: '#d3ddec',
};

// ── Assembly ─────────────────────────────────────────────────────────────────

/** Feet turn outward, away from the centreline, on both sides. */
const LEFT_FOOT_OUT = -1;
const RIGHT_FOOT_OUT = 1;
/** How much of the torso's lean the helm copies. */
const HELM_LEAN_FOLLOW = 0.3;
/** Where along the forearm the mace grip sits, from elbow to fist. */
const GRIP_ALONG_FOREARM = 0.98;

function gripPoint(chain: BoneChain): Pt {
  return mixPt(chain.joint, chain.end, GRIP_ALONG_FOREARM);
}

function drawFigure(ctx: Ctx, view: ViewSpec, pose: KnightPose, prop: PropPainter | null): void {
  const skeleton = buildSkeleton(pose, view);
  const lift = Math.max(0, -Math.min(pose.leftFoot.y, pose.rightFoot.y));
  const shadowFade = clamp01(1 - lift * SHADOW_LIFT_FADE);
  drawGroundShadow(
    ctx,
    skeleton.hip.x * SHADOW_FOLLOW,
    SHADOW_RX * lerp(SHADOW_LIFT_SHRINK, 1, shadowFade),
    SHADOW_RY * lerp(SHADOW_LIFT_SHRINK, 1, shadowFade),
    CONTACT_SHADOW_ALPHA * shadowFade,
  );

  drawCloak(ctx, skeleton, pose, view);

  // The figure's left side is the far one. Seen edge-on that arm is genuinely
  // behind the torso; head-on both arms hang in front of the breastplate, and
  // drawing the far one early is what makes a figure look one-armed.
  const farRamp = view.profile ? FAR_STEEL : STEEL;
  const leftBehind = !pose.leftArmInFront && (view.profile || pose.leftArmBehind);
  const rightBehind = !view.profile && pose.rightArmBehind;

  const paintProp = (): void => {
    if (prop === null) return;
    prop(ctx, gripPoint(skeleton.rightArm), pose.maceAngle);
  };

  // An arm forced in front is a *near* limb and takes the near ramp. Left on
  // the far ramp it is painted three shades darker than everything around it
  // and reads as the body's own shadow rather than as an arm — which is how a
  // fully extended jab managed to be invisible in profile.
  const offRamp = pose.leftArmInFront ? STEEL : farRamp;
  if (leftBehind) {
    drawArm(ctx, skeleton.leftArm, offRamp, pose.offFistScale);
    drawPauldron(ctx, skeleton.leftShoulder, -1, farRamp);
  }
  if (rightBehind) {
    drawArm(ctx, skeleton.rightArm, STEEL);
    drawPauldron(ctx, skeleton.rightShoulder, 1, STEEL);
  }
  if (pose.macePropBehind) paintProp();

  drawLeg(
    ctx,
    skeleton.leftLeg,
    pose.leftFootPitch,
    view,
    LEFT_FOOT_OUT,
    pose.leftLegNearness,
    farRamp,
  );
  drawLeg(
    ctx,
    skeleton.rightLeg,
    pose.rightFootPitch,
    view,
    RIGHT_FOOT_OUT,
    pose.rightLegNearness,
    STEEL,
  );

  drawFaulds(ctx, skeleton, pose, view, STEEL);
  drawBreastplate(ctx, skeleton, view, STEEL);
  // Gorget: the collar bridging breastplate and helm, painted *over* the
  // breastplate because that is how one sits. Under it, the cuirass swallows
  // the collar and the helm floats on the chest with no neck beneath it.
  paintPieces(
    ctx,
    [
      capsulePiece(
        offset(skeleton.shoulderCentre, 0, GORGET_WIDTH * 0.3),
        offset(skeleton.headCentre, 0, HEAD_RY * 0.62),
        GORGET_WIDTH * view.girth,
        GORGET_WIDTH * view.girth * 0.78,
      ),
    ],
    STEEL,
  );
  drawTabard(ctx, skeleton, view, CLOTH);

  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(pose.headTilt + pose.lean * HELM_LEAN_FOLLOW);
  drawHelm(ctx, pose, view);
  ctx.restore();

  if (!leftBehind) {
    drawArm(ctx, skeleton.leftArm, offRamp, pose.offFistScale);
    drawPauldron(ctx, skeleton.leftShoulder, -1, offRamp);
  }
  if (!rightBehind) {
    drawArm(ctx, skeleton.rightArm, STEEL);
    drawPauldron(ctx, skeleton.rightShoulder, 1, STEEL);
  }
  // A carried prop is painted over the torso and the helm but *under* the fist
  // that grips it: a haft is wider than a gauntlet, and painting it over the
  // hand makes the knight appear to swing something nobody is holding.
  if (!pose.macePropBehind) {
    paintProp();
    drawGauntlet(ctx, skeleton.rightArm, STEEL);
  }
}

/** Where the mace head lands for a given pose, for the choreography's own gates. */
export function macePosition(pose: KnightPose, view: KnightView): Pt {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const grip = gripPoint(skeleton.rightArm);
  return offset(grip, Math.cos(pose.maceAngle) * MACE_REACH, Math.sin(pose.maceAngle) * MACE_REACH);
}

/**
 * How far each leg is being *asked* to span, for the reach-headroom gate.
 *
 * Measured against the ankle target rather than against the solved chain: the
 * solver clamps, so a solved leg reports the limit exactly however far past it
 * the pose reached, and the overreach the gate exists to catch would be
 * invisible.
 */
export function legReach(pose: KnightPose, view: KnightView): { left: number; right: number } {
  const spec = VIEWS[view];
  const skeleton = buildSkeleton(pose, spec);
  const hipHalf = LEG_ROOT_HALF * spec.lateral;
  const leftRoot = offset(skeleton.hip, -hipHalf, 0);
  const rightRoot = offset(skeleton.hip, hipHalf, 0);
  const leftAnkle = ankleFor(pose.leftFoot, pose.leftFootPitch);
  const rightAnkle = ankleFor(pose.rightFoot, pose.rightFootPitch);
  return {
    left: Math.hypot(leftAnkle.x - leftRoot.x, leftAnkle.y - leftRoot.y),
    right: Math.hypot(rightAnkle.x - rightRoot.x, rightAnkle.y - rightRoot.y),
  };
}

/** The longest a leg can span before the solver clamps it straight. */
export const LEG_REACH_LIMIT = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

/** The Dark Knight seen head-on, walking toward the camera. */
export function drawKnightFront(ctx: Ctx, pose: KnightPose, prop: PropPainter | null = null): void {
  drawFigure(ctx, VIEWS.front, pose, prop);
}

/** The Dark Knight seen from behind, walking away. */
export function drawKnightBack(ctx: Ctx, pose: KnightPose, prop: PropPainter | null = null): void {
  drawFigure(ctx, VIEWS.back, pose, prop);
}

/** The Dark Knight in profile. Always drawn facing +X; the runtime mirrors. */
export function drawKnightSide(ctx: Ctx, pose: KnightPose, prop: PropPainter | null = null): void {
  drawFigure(ctx, VIEWS.side, pose, prop);
}
