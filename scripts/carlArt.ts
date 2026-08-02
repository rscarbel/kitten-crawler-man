/**
 * Drawing engine for Carl, the human crawler.
 *
 * Carl is the man from the surface who went down into the dungeon in a leather
 * jacket, a pair of heart-print boxer shorts and nothing else — no trousers, no
 * shoes. Everything painted here serves that silhouette: a jacket that ends at
 * the waist, bare legs, and the bare feet the Smush stomp lands with.
 *
 * The figure is built by forward kinematics and then painted over the joints, so
 * a limb physically cannot come apart no matter how far a pose throws it. Three
 * viewpoints are drawn — `front` (toward the camera), `back` (away) and `side`
 * (profile, always facing +X so the runtime can mirror it) — and all three read
 * the same {@link CarlPose}; the choreography that fills that pose lives in
 * `scripts/generate-human-sprite.ts`.
 *
 * Coordinates are tile units with the origin at the point between the feet and
 * +Y pointing down the screen, so heights above the ground are negative. The
 * caller translates to that ground point and scales by one tile before calling
 * a painter, exactly as the cat's painter expects.
 *
 * Light comes from the upper left, matching every other prop in the repo.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const DEGREES_PER_RADIAN = 180 / Math.PI;

export interface Pt {
  x: number;
  y: number;
}

export function deg(degrees: number): number {
  return degrees / DEGREES_PER_RADIAN;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Smooth 0→1 ease used for weight shifts and one-shot swings. */
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Fast start, slow finish — for a limb that is thrown and then settles. */
export function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/** Slow start, fast finish — for a limb winding up before it is thrown. */
export function easeIn(t: number): number {
  const c = clamp01(t);
  return c * c;
}

/** 0 → 1 → 0 over the unit interval. */
export function hump(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

/** 0 before `start`, 1 after `end`, eased in between. */
export function ramp(value: number, start: number, end: number): number {
  if (end === start) return value < start ? 0 : 1;
  return easeInOut((value - start) / (end - start));
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
// Every ramp runs shadow → dark → mid → light → rim under an upper-left key.
// Nothing is drawn in pure black; the darkest entry of a ramp is its outline.

interface Ramp {
  readonly shadow: string;
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
  readonly rim: string;
}

const HEX_RADIX = 16;
const HEX_PAIR = 2;
const RGB_MAX = 255;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const body = hex.slice(1);
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

/** Blends two hex colours; `t` of 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return `#${channel(lerp(ca.r, cb.r, t))}${channel(lerp(ca.g, cb.g, t))}${channel(lerp(ca.b, cb.b, t))}`;
}

/** A hex colour re-expressed with an alpha. */
export function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

const OUTLINE = '#1b120c';

const SKIN: Ramp = {
  shadow: '#7a4630',
  dark: '#a06546',
  mid: '#cd9068',
  light: '#e7b287',
  rim: '#f6d2ac',
};

/** Worn brown bomber leather: warm mid, hard sheen, near-black creases. */
const LEATHER: Ramp = {
  shadow: '#2e1f12',
  dark: '#4c351f',
  mid: '#71512f',
  light: '#8f6a3f',
  rim: '#b98f57',
};

/** Cotton boxers: white gone slightly grey-blue in dungeon light. */
const COTTON: Ramp = {
  shadow: '#8d94a0',
  dark: '#b3bac6',
  mid: '#d2d6dd',
  light: '#e6e9ee',
  rim: '#f4f6f9',
};

const HAIR: Ramp = {
  shadow: '#3d2411',
  dark: '#5a3618',
  mid: '#814f24',
  light: '#a76c33',
  rim: '#c98f4c',
};

const HEART_RED = '#cf2f45';
const HEART_RED_DARK = '#9a2033';
const EYE_WHITE = '#d6cab4';
const IRIS = '#5d452c';
const MOUTH_INNER = '#4a1c1c';
const TOOTH = '#e8e3d6';

/** Cool bounce light along the right-hand edge of every form. */
const RIM_LIGHT = '#d8c7a8';
const RIM_ALPHA = 0.22;
const SHEEN_ALPHA = 0.3;
const CREASE_ALPHA = 0.34;
const CONTACT_SHADOW_ALPHA = 0.4;

/** Unit vector the key light arrives from, in figure space. */
const LIGHT: Pt = { x: -0.62, y: -0.78 };

// ── Proportions ──────────────────────────────────────────────────────────────
// Heights are y values, so they are negative: the origin sits between the feet
// and the screen's +Y runs down. Carl stands two tiles tall.

/**
 * Total standing height, top of hair to the ground, and the head that height is
 * divided into. Under five heads is a game-character proportion, not a life
 * drawing: the head has to be a clear ball on top of the silhouette at a 32 px
 * tile, and an anatomically-correct seven-head figure reads as a pinhead there.
 * The generator scales the whole figure down to the tile footprint afterwards.
 */
export const FIGURE_HEIGHT = 2.03;
const HEADS_TALL = 4.8;
const HEAD_HEIGHT = FIGURE_HEIGHT / HEADS_TALL;

/**
 * Slack so a planted leg is not mathematically locked straight. It has to stay
 * tiny: the knee's sideways travel grows as the square root of it, and head-on
 * a knee should read as the leg *narrowing*, not as an angle in it. A few
 * percent here bows the legs into a pair of parentheses.
 */
const LEG_SLACK = 1.004;
const ANKLE_Y = -0.085;
const KNEE_Y = -0.55;
/** The hip sits at half the standing height, which is where a human's does. */
const HIP_Y = -FIGURE_HEIGHT / 2;
const WAIST_Y = -1.17;
export const SHOULDER_Y = -1.6;
const HEAD_CENTRE_Y = -1.85;

const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * LEG_SLACK;
const SHIN_LENGTH = Math.abs(KNEE_Y - ANKLE_Y) * LEG_SLACK;
export const UPPER_ARM_LENGTH = 0.34;
export const FOREARM_LENGTH = 0.3;
/** Shoulder to wrist. A relaxed arm hangs at very nearly this. */
export const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

/** Shoulders are the widest thing on him; the hips are markedly narrower. */
const SHOULDER_HALF = 0.28;
/**
 * Head-on the shoulders carry the whole read of his build, and the arms hang
 * off them: set them at the profile's width and he stands with his arms tucked
 * in, which is a slight, unathletic stature at any tile size.
 */
const FACING_SHOULDER_SPREAD = 1.14;
const HIP_HALF = 0.16;
/**
 * Where the thigh roots, measured in from the hip. It cannot be narrower than
 * the thigh's own half-width or the two thighs overlap into a single mass at
 * the top and the legs read as one wedge splitting downward.
 */
const LEG_ROOT_HALF = 0.118;
const CHEST_HALF = 0.26;
const WAIST_HALF = 0.2;
/** Arms root at the jacket's shoulder edge, not inside its silhouette. */
const ARM_INSET = 0.9;
/** Half the distance between the two arm roots, before any view narrowing. */
export const ARM_ROOT_HALF = SHOULDER_HALF * ARM_INSET;
/** Where the arms root head-on, once the shoulders are spread. */
export const FACING_ARM_ROOT_HALF = ARM_ROOT_HALF * FACING_SHOULDER_SPREAD;
/** The shoulder joint hangs below the shoulder line, where the deltoid is. */
/** The arm's root hangs this far below the shoulder line, not on it. */
export const SHOULDER_JOINT_DROP = 0.055;

/** A fit adult's thigh is about twice his upper arm. */
const THIGH_WIDTH = 0.105;
const KNEE_WIDTH = 0.068;
const CALF_WIDTH = 0.086;
const ANKLE_WIDTH = 0.052;
/** How far down the shin the calf reaches its widest. */
const CALF_AT = 0.3;
const UPPER_ARM_WIDTH = 0.056;
const ELBOW_WIDTH = 0.045;
const WRIST_WIDTH = 0.036;
/** The jacket sleeve is padded over the arm inside it. */
const SLEEVE_BULK = 0.011;

/**
 * Head-on the head is a tall oval, not a ball. Measured off the sheet this
 * replaced, the skull ran 27px across against 38 tall — and a round head is
 * what makes any chin drawn under it read as blocky, however narrow the chin.
 */
const HEAD_WIDTH_RATIO = 0.74;
const HEAD_DEPTH_RATIO = 0.9;
const HEAD_RY = HEAD_HEIGHT / 2;
const HEAD_RX = HEAD_RY * HEAD_WIDTH_RATIO;
/**
 * Half the head's depth, front to back. A head is markedly narrower across than
 * it is deep, so the profile keeps the roomier proportion the front view gave
 * up: sharing one radius makes the face either round head-on or shallow in
 * profile, and there is no value that is right for both.
 */
const HEAD_DEPTH = HEAD_RY * HEAD_DEPTH_RATIO;
const NECK_WIDTH = 0.072;
const NECK_TOP_Y = HEAD_CENTRE_Y + HEAD_RY * 0.55;

/** Side-on, the limbs gather toward the centreline instead of splaying wide. */
const PROFILE_LATERAL = 0.3;

// ── Views ────────────────────────────────────────────────────────────────────

export type CarlView = 'front' | 'back' | 'side';

interface ViewSpec {
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
  /**
   * Narrows the jacket's shoulders and chest without touching its waist. Seen
   * edge-on a torso is nearly as deep at the belt as at the chest; carrying the
   * head-on taper into profile gives him a wedge of a chest on a narrow waist.
   */
  readonly chestTaper: number;
  /**
   * Multiplier on the torso's drawn width. A body is nearly as deep as it is
   * wide, so in profile the jacket stays broad even though the limbs gather
   * onto the centreline.
   */
  readonly girth: number;
  /** Extra trim on the hips, which are much less deep than the chest. */
  readonly hipDepth: number;
  /**
   * How far apart the two shoulder joints are drawn. Edge-on they are almost
   * the same point; given the full half-width the arms angle inward and cross
   * the chest.
   */
  readonly armSpread: number;
  /** How deep the leg-opening notch is cut, 0 for a flat hem. */
  readonly crotchNotch: number;
  /** True when the figure is seen edge-on rather than head-on. */
  readonly profile: boolean;
  /** True when the face is toward the camera. */
  readonly showsFace: boolean;
  /** True when the back of the head and the jacket's back panel are shown. */
  readonly showsBack: boolean;
}

const PROFILE_GIRTH = 0.68;
const PROFILE_HIP_DEPTH = 0.88;
const PROFILE_ARM_SPREAD = 0.12;
const PROFILE_CHEST_TAPER = 0.78;
const PROFILE_CROTCH_NOTCH = 0.18;

const VIEWS: Record<CarlView, ViewSpec> = {
  front: {
    lateral: 1,
    girth: 1,
    hipDepth: 1,
    armSpread: 1,
    chestTaper: 1,
    crotchNotch: 1,
    profile: false,
    showsFace: true,
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
    showsFace: false,
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
    showsFace: true,
    showsBack: false,
  },
};

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * One frame of Carl. Hand and foot positions are targets in figure space that
 * the limb solver reaches for, so the choreography never has to think about
 * joint angles. `left`/`right` are the figure's own left and right; in the
 * profile view the right side is the near one, closest to the camera.
 */
export interface CarlPose {
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
  /** Head turn, −1 to 1; in the front view it slides the face across. */
  headTurn: number;
  /** Head tilt in radians. */
  headTilt: number;
  /** 0 neutral brow, 1 the full Carl scowl. */
  brow: number;
  /** 0 closed mouth, 1 mid-shout. */
  mouth: number;
  /** 0 eyes open, 1 shut. */
  blink: number;
  leftHand: Pt;
  rightHand: Pt;
  leftFoot: Pt;
  rightFoot: Pt;
  /** 0 open hand, 1 closed fist, per hand. */
  leftFist: number;
  rightFist: number;
  /** Foot pitch in radians; positive points the toes down. */
  leftFootPitch: number;
  rightFootPitch: number;
  /**
   * Which way a knee breaks: +1 bows it away from the body's centreline, which
   * is what a planted leg does; −1 folds it the other way, which is what a leg
   * driven up in front of the body does. Without this a raised foot solves into
   * a shin sticking out sideways.
   */
  leftKneeBreak: number;
  rightKneeBreak: number;
  /**
   * How much a leg is pointed at the camera rather than across it, 0 to 1. At 1
   * the knee is pulled onto the hip→ankle line and the leg is a straight column
   * that only gets shorter as the foot rises.
   *
   * Head-on there is no direction for a knee to break into: a real knee hinges
   * away from the viewer, so the joint hides behind the shin instead of throwing
   * the leg into a visible angle. Both legs of a head-on pose want the same
   * value — a straight swing leg beside a slightly bowed stance leg makes the
   * bow flicker on and off every step, which reads as a wiggle rather than as
   * a walk.
   */
  leftForeshorten: number;
  rightForeshorten: number;
  /**
   * How much nearer the camera a leg's shin is than its thigh, 0 to 1, which is
   * what the raised leg of a head-on step actually is. Unlike `foreshorten` this
   * differs between the two legs by design: it only changes widths, so it cues
   * depth without moving a joint.
   */
  leftLegNearness: number;
  rightLegNearness: number;
  /** How far the jacket hem kicks out from the body, 0 to 1. */
  jacketFlare: number;
  /** Sideways push on the hair, −1 to 1. */
  hairFlow: number;
  /** Elbows swing behind the body at 1 and in front of it at −1. */
  elbowFlare: number;
  /**
   * Drives an arm from its joint angles instead of from a hand target, which is
   * the only way to make the forearm swing *less* than the upper arm: solved
   * from the hand, both segments have to travel together. Set, it wins over
   * `leftHand`/`rightHand` and `elbowFlare` for that arm.
   */
  leftArmAngles: ArmAngles | null;
  rightArmAngles: ArmAngles | null;
  /**
   * Whether an arm is on the far side of the torso and so drawn before it.
   * Only consulted head-on; in profile the far arm is always the near-side one.
   * Walking away from the camera this is what hides the forward half of an arm
   * swing, which is where a real arm spends most of its travel.
   */
  leftArmBehind: boolean;
  rightArmBehind: boolean;
}

/**
 * Where an arm's two segments point, in radians from hanging straight down.
 * Positive swings forward, which is +X in the profile the figure is drawn in.
 */
export interface ArmAngles {
  readonly upper: number;
  readonly fore: number;
  /**
   * Fraction of its true length the forearm is drawn at, for a limb swinging
   * toward or away from the camera. A 2D arm has no other way to foreshorten,
   * and without it a hand swung at the viewer stays pinned at the same height
   * instead of riding up as the forearm turns out of the picture plane.
   */
  readonly foreScale: number;
}

/**
 * A relaxed arm reaches nearly its full length, and it does so from the
 * shoulder *joint* — measuring the drop from the shoulder line instead leaves
 * the IK 0.05 of slack, which it spends folding the elbow out sideways.
 */
const RESTING_HAND_DROP = SHOULDER_JOINT_DROP + ARM_LENGTH * 0.99;
const RESTING_HAND_SPREAD = 0.345;
const RESTING_FOOT_SPREAD = 0.13;

/** A relaxed standing pose. Every animation is written as edits to this. */
export function restingPose(): CarlPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    crouch: 0,
    twist: 0,
    headTurn: 0,
    headTilt: 0,
    brow: 0.45,
    mouth: 0,
    blink: 0,
    leftHand: pt(-RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    rightHand: pt(RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    leftFoot: pt(-RESTING_FOOT_SPREAD, 0),
    rightFoot: pt(RESTING_FOOT_SPREAD, 0),
    leftFist: 0.2,
    rightFist: 0.2,
    leftFootPitch: 0,
    rightFootPitch: 0,
    leftKneeBreak: 1,
    rightKneeBreak: 1,
    leftForeshorten: 0,
    rightForeshorten: 0,
    leftLegNearness: 0,
    rightLegNearness: 0,
    jacketFlare: 0,
    hairFlow: 0,
    elbowFlare: 0.25,
    leftArmAngles: null,
    rightArmAngles: null,
    leftArmBehind: false,
    rightArmBehind: false,
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
 *
 * Tiny, because the joint's sideways travel grows as the *square root* of this:
 * at 0.012 a hanging arm's elbow stood 0.06 tiles off the shoulder→wrist line,
 * a visible kink on an arm that should read as straight. Same trap as
 * `LEG_SLACK`.
 */
const JOINT_SLACK = 0.0003;

/**
 * Places a two-segment limb so its end sits on `target`. `bendSign` picks which
 * side the joint pops out to: +1 bends the joint toward +X of the root→target
 * line, −1 toward −X.
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

/**
 * Pulls a solved leg's knee back onto the hip→ankle line by `amount`, so the
 * leg reads as a column shortening toward the viewer rather than as a hinge
 * swinging sideways. See `CarlPose.leftForeshorten`.
 */
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
const CROUCH_DROP = 0.3;

/** Facing +X, a knee that bends toward +X is bending forward. */
const PROFILE_KNEE_FORWARD = -1;
/** A twisted torso narrows on the trailing side and widens on the leading one. */
const TWIST_WIDTH_GAIN = 0.16;
const TWIST_SHOULDER_SHIFT = 0.06;

/** Offset from the hip to a point `height` up the leaning spine. */
function spinePoint(hip: Pt, height: number, lean: number): Pt {
  const rotated = rotate({ x: 0, y: -height }, lean);
  return offset(hip, rotated.x, rotated.y);
}

function buildSkeleton(pose: CarlPose, view: ViewSpec): Skeleton {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);

  const waist = spinePoint(hip, Math.abs(WAIST_Y - HIP_Y), pose.lean);
  const chest = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y) * 0.72, pose.lean);
  const shoulderCentre = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y), pose.lean);
  const neck = spinePoint(hip, Math.abs(NECK_TOP_Y - HIP_Y), pose.lean);
  const headCentre = offset(
    spinePoint(hip, Math.abs(HEAD_CENTRE_Y - HIP_Y), pose.lean),
    pose.headTurn * HEAD_RX * view.lateral * 0.5,
    0,
  );

  const spread = view.profile ? 1 : FACING_SHOULDER_SPREAD;
  const shoulderHalf = SHOULDER_HALF * view.girth * spread;
  const twistShift = pose.twist * TWIST_SHOULDER_SHIFT * view.lateral;
  const armRoot = ARM_ROOT_HALF * view.armSpread * spread;
  const leftHalf = armRoot * (1 - pose.twist * TWIST_WIDTH_GAIN);
  const rightHalf = armRoot * (1 + pose.twist * TWIST_WIDTH_GAIN);

  const shoulderDrop = SHOULDER_JOINT_DROP;
  const leftShoulder = offset(shoulderCentre, -leftHalf + twistShift, shoulderDrop);
  const rightShoulder = offset(shoulderCentre, rightHalf + twistShift, shoulderDrop);
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
    // A standing knee breaks *away* from the centreline. Signed the other way
    // the two knees bow toward each other and the legs read as crossed.
    //
    // Edge-on that rule does not apply: "away from the centreline" would send
    // the two knees in opposite directions, and one of them would then hinge
    // backward, which no leg does. In profile both knees break forward.
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
    // A positive elbowFlare bows both elbows outward, away from the ribs, which
    // is why the two arms take opposite bend signs.
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

/** The ankle for a foot planted at `target`: up the leg by the foot's height. */
function ankleFor(target: Pt, pitch: number): Pt {
  const lifted = rotate({ x: 0, y: ANKLE_Y }, -pitch);
  return offset(target, lifted.x, lifted.y);
}

// ── Low-level painting ───────────────────────────────────────────────────────

/** Traces a capsule: a quad between two circles, with both caps rounded. */
function traceCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const angle = angleBetween(a, b);
  const normal = angle + HALF_PI;
  const nx = Math.cos(normal);
  const ny = Math.sin(normal);
  ctx.beginPath();
  ctx.arc(a.x, a.y, wa, normal, normal + Math.PI);
  ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
  ctx.arc(b.x, b.y, wb, normal + Math.PI, normal + TWO_PI);
  ctx.lineTo(a.x + nx * wa, a.y + ny * wa);
  ctx.closePath();
}

function fillCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number, fill: string): void {
  traceCapsule(ctx, a, b, wa, wb);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Dark silhouette laid under a form so it separates from what is behind it. */
const OUTLINE_BLEED = 0.014;

function outlineCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  fillCapsule(ctx, a, b, wa + OUTLINE_BLEED, wb + OUTLINE_BLEED, OUTLINE);
}

/** Runs a light stroke down the lit side of a segment. */
function sheenSegment(ctx: Ctx, a: Pt, b: Pt, width: number, colour: string, alpha: number): void {
  const angle = angleBetween(a, b);
  const normal = angle + HALF_PI;
  const facing = Math.cos(normal) * LIGHT.x + Math.sin(normal) * LIGHT.y;
  const side = facing >= 0 ? 1 : -1;
  const push = width * SHEEN_OFFSET * side;
  const nx = Math.cos(normal) * push;
  const ny = Math.sin(normal) * push;
  ctx.save();
  ctx.globalAlpha = alpha;
  fillCapsule(
    ctx,
    offset(a, nx, ny),
    offset(b, nx, ny),
    width * SHEEN_WIDTH,
    width * SHEEN_WIDTH * SHEEN_TAPER,
    colour,
  );
  ctx.restore();
}

const SHEEN_OFFSET = 0.45;
const SHEEN_WIDTH = 0.34;
const SHEEN_TAPER = 0.7;

/** The four widths a limb is drawn from, root to tip. */
interface LimbShape {
  readonly root: number;
  readonly joint: number;
  /** Widest point of the lower segment — the calf, or the top of the forearm. */
  readonly belly: number;
  readonly tip: number;
  /** Where the belly sits along the lower segment, 0 at the joint, 1 at the tip. */
  readonly bellyAt: number;
}

const ARM_SHAPE: LimbShape = {
  root: UPPER_ARM_WIDTH,
  joint: ELBOW_WIDTH,
  belly: ELBOW_WIDTH,
  tip: WRIST_WIDTH,
  bellyAt: 0.25,
};

const LEG_SHAPE: LimbShape = {
  root: THIGH_WIDTH,
  joint: KNEE_WIDTH,
  belly: CALF_WIDTH,
  tip: ANKLE_WIDTH,
  bellyAt: CALF_AT,
};

/**
 * A leg swung toward the camera, drawn from the front. Everything below the
 * knee is nearer the viewer than the thigh is, so it reads *larger*, not
 * smaller: the knee stops pinching and the shin and ankle gain a little. The
 * calf's widest point also slides down the shin, because a shin tipped toward
 * the viewer projects its swell closer to the foot.
 */
const NEAR_LEG_SHAPE: LimbShape = {
  root: THIGH_WIDTH,
  joint: THIGH_WIDTH,
  belly: CALF_WIDTH * 1.16,
  tip: ANKLE_WIDTH * 1.14,
  bellyAt: 0.5,
};

function legShapeFor(nearness: number): LimbShape {
  const t = clamp01(nearness);
  if (t <= 0) return LEG_SHAPE;
  return {
    root: lerp(LEG_SHAPE.root, NEAR_LEG_SHAPE.root, t),
    joint: lerp(LEG_SHAPE.joint, NEAR_LEG_SHAPE.joint, t),
    belly: lerp(LEG_SHAPE.belly, NEAR_LEG_SHAPE.belly, t),
    tip: lerp(LEG_SHAPE.tip, NEAR_LEG_SHAPE.tip, t),
    bellyAt: lerp(LEG_SHAPE.bellyAt, NEAR_LEG_SHAPE.bellyAt, t),
  };
}

interface LimbPaint {
  readonly ramp: Ramp;
  /** Fraction of the limb, from the root, that a sleeve covers. 1 is the elbow. */
  readonly clothedTo: number;
  readonly clothRamp: Ramp | null;
  readonly clothBulk: number;
  /** How far the whole limb is pushed toward the outline; far limbs recede. */
  readonly shade: number;
}

/**
 * Paints a solved limb: outline, then the flesh, then any cloth that covers the
 * upper part of it, then a sheen down the lit edge.
 *
 * The lower segment is drawn in two pieces so the knee can pinch in and the
 * calf swell back out below it. Drawn as one taper, a leg is a traffic cone —
 * which is exactly how the first pass read.
 */
function drawLimb(ctx: Ctx, chain: BoneChain, shape: LimbShape, paint: LimbPaint): void {
  const belly = mixPt(chain.joint, chain.end, shape.bellyAt);
  const flesh = mix(paint.ramp.mid, OUTLINE, paint.shade);
  const fleshLight = mix(paint.ramp.light, OUTLINE, paint.shade);

  outlineCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint);
  outlineCapsule(ctx, chain.joint, belly, shape.joint, shape.belly);
  outlineCapsule(ctx, belly, chain.end, shape.belly, shape.tip);

  fillCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint, flesh);
  fillCapsule(ctx, chain.joint, belly, shape.joint, shape.belly, flesh);
  fillCapsule(ctx, belly, chain.end, shape.belly, shape.tip, flesh);
  sheenSegment(ctx, chain.root, chain.joint, shape.root, fleshLight, SHEEN_ALPHA);
  sheenSegment(ctx, chain.joint, chain.end, shape.belly, fleshLight, SHEEN_ALPHA);

  if (paint.clothRamp === null || paint.clothedTo <= 0) return;

  const sleeveEnd =
    paint.clothedTo <= 1
      ? mixPt(chain.root, chain.joint, paint.clothedTo)
      : mixPt(chain.joint, chain.end, paint.clothedTo - 1);
  const bulkRoot = shape.root + paint.clothBulk;
  const bulkEnd = shape.tip + paint.clothBulk * SLEEVE_TAPER;
  const cloth = mix(paint.clothRamp.mid, OUTLINE, paint.shade);
  // The sleeve follows the arm through the elbow rather than cutting the corner,
  // which is what let the old one-piece sleeve read as a log strapped on.
  outlineCapsule(ctx, chain.root, chain.joint, bulkRoot, shape.joint + paint.clothBulk);
  outlineCapsule(ctx, chain.joint, sleeveEnd, shape.joint + paint.clothBulk, bulkEnd);
  fillCapsule(ctx, chain.root, chain.joint, bulkRoot, shape.joint + paint.clothBulk, cloth);
  fillCapsule(ctx, chain.joint, sleeveEnd, shape.joint + paint.clothBulk, bulkEnd, cloth);
  const clothLight = mix(paint.clothRamp.light, OUTLINE, paint.shade);
  sheenSegment(ctx, chain.root, chain.joint, bulkRoot, clothLight, SHEEN_ALPHA);
  sheenSegment(ctx, chain.joint, sleeveEnd, bulkEnd, clothLight, SHEEN_ALPHA);

  // A cuff band reads as the sleeve ending rather than the arm changing colour.
  const bandStart = mixPt(chain.joint, sleeveEnd, CUFF_BAND_START);
  fillCapsule(
    ctx,
    bandStart,
    sleeveEnd,
    bulkEnd * CUFF_GRIP,
    bulkEnd * CUFF_GRIP,
    mix(mix(paint.clothRamp.dark, paint.clothRamp.mid, CUFF_LIFT), OUTLINE, paint.shade),
  );
}

const CUFF_BAND_START = 0.86;
const CUFF_GRIP = 1.02;
const CUFF_LIFT = 0.45;
const SLEEVE_TAPER = 0.7;

/** Soft elliptical shadow under the figure. */
function drawGroundShadow(
  ctx: Ctx,
  centreX: number,
  radiusX: number,
  radiusY: number,
  alpha: number,
): void {
  // A gradient resolves in the user space it is painted in, not the one it was
  // built in, so the transform has to be in place before the gradient is made.
  ctx.save();
  ctx.translate(centreX, 0);
  ctx.scale(radiusX, radiusY);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgba(OUTLINE, alpha));
  gradient.addColorStop(1, rgba(OUTLINE, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Feet ─────────────────────────────────────────────────────────────────────

/** A foot is about two thirds of the head's height; longer reads as a flipper. */
/**
 * Derived from his height, not from his head: a foot is about 15% of a figure,
 * and hanging it off this character's deliberately oversized head — the trap
 * `HAND_LENGTH` fell into — makes it a clown shoe.
 */
const FOOT_LEN = FIGURE_HEIGHT * 0.15;
/** A bare foot is about half as deep as it is long; thinner reads as a blade. */
const FOOT_DEPTH = FOOT_LEN * 0.5;
/**
 * How much of the foot lies behind the ankle. A bare heel is short — the ankle
 * sits well back over it — and a foot centred on its ankle reads as a shoe.
 */
const HEEL_SHARE = 0.22;
/** Head-on the foot is mostly toes, so it draws short and blunt. */
const FOOT_FORESHORTEN = 0.5;
/**
 * Head-on, a foot turns out in the *ground* plane, which a 2D rotation cannot
 * express: rotating it rolls him onto the outer edge of the sole. The toe end
 * leads outward through `outward` instead, and the sole stays level.
 */
const SMALL_TOES = 2;
const TOE_BUMP_DEPTH = 0.4;
const TOE_STEP = 0.3;
/** Pulls the last small toe back from the tip so the foot ends blunt. */
const TOE_TAPER = 0.9;
/** Kept low: a big toe that overshoots the ball of the foot ends in a point. */
const BIG_TOE_LEAD = 0.45;
const HEEL_LOBE = 0.3;
/**
 * How deep the toe end is against the ankle. Thin, the front of the foot tapers
 * to a blade; a real foot keeps most of its depth all the way to the toes.
 */
const TOE_HEIGHT_SHARE = 0.5;
const ARCH_AT = 0.55;
/**
 * Slight. A sole that lifts far off the ground through its middle leaves the
 * foot a crescent between heel and toe — a scythe blade, not a foot.
 */
const ARCH_LIFT = 0.1;
/** A hard black line under the sole reads as the welt of a shoe. */
const FOOT_OUTLINE_LIFT = 0.55;
const ARCH_ALPHA = 0.3;

/**
 * A bare foot drawn from the ankle: a wedge that rises to a narrow ankle and
 * runs out to a toe end scalloped into the silhouette.
 *
 * The toes have to be notches in the outline, not highlights painted on top —
 * painted-on toe lines read as sandal straps, and Carl is barefoot.
 */
function drawFoot(
  ctx: Ctx,
  ankle: Pt,
  pitch: number,
  view: ViewSpec,
  outward: number,
  shade: number,
): void {
  const flesh = mix(SKIN.mid, OUTLINE, shade);
  const fleshLight = mix(SKIN.light, OUTLINE, shade);
  const profile = view.profile;
  const length = profile ? FOOT_LEN : FOOT_LEN * FOOT_FORESHORTEN;
  const lead = profile ? 1 : outward;

  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(profile ? pitch : 0);

  if (view.showsBack) {
    // From behind a bare foot is a heel and an arch; toes drawn here would read
    // as feet on backwards.
    const heel = pt(0, FOOT_DEPTH * 0.35);
    outlineCapsule(ctx, pt(0, 0), heel, ANKLE_WIDTH, FOOT_DEPTH * 0.55);
    fillCapsule(ctx, pt(0, 0), heel, ANKLE_WIDTH, FOOT_DEPTH * 0.55, flesh);
    ctx.beginPath();
    ctx.ellipse(0, heel.y * 0.6, FOOT_DEPTH * 0.3, FOOT_DEPTH * 0.22, 0, 0, TWO_PI);
    ctx.fillStyle = fleshLight;
    ctx.fill();
    ctx.restore();
    return;
  }

  const toeX = length * (1 - HEEL_SHARE) * lead;
  const heelX = -length * HEEL_SHARE * lead;
  const sole = FOOT_DEPTH * 0.5;
  const toeHalf = FOOT_DEPTH * TOE_HEIGHT_SHARE;
  // The inner edge of a foot is its arch, the outer edge its blade, and the big
  // toe leads. Two mirror-identical ovals read as loafers, which is what the
  // first two passes drew.
  const inner = profile ? lead : -outward;

  ctx.beginPath();
  ctx.moveTo(heelX, -FOOT_DEPTH * 0.1);
  ctx.quadraticCurveTo(heelX - FOOT_DEPTH * HEEL_LOBE * lead, sole * 0.85, heelX * 0.55, sole);
  // Arch: the sole lifts away from the ground on the inboard half.
  ctx.quadraticCurveTo(
    lerp(heelX, toeX, ARCH_AT),
    sole - FOOT_DEPTH * ARCH_LIFT * (inner === lead ? 1 : 0.35),
    toeX - toeHalf * lead,
    sole,
  );
  // Big toe, then two smaller ones, each a bump in the outline.
  ctx.quadraticCurveTo(toeX + toeHalf * BIG_TOE_LEAD * lead, sole, toeX, sole - toeHalf * 0.4);
  for (let i = 1; i <= SMALL_TOES; i++) {
    const from = sole - toeHalf * (0.4 + (i - 1) * TOE_STEP);
    const to = sole - toeHalf * (0.4 + i * TOE_STEP);
    ctx.quadraticCurveTo(
      toeX + toeHalf * TOE_BUMP_DEPTH * lead,
      lerp(from, to, 0.5),
      toeX * TOE_TAPER,
      to,
    );
  }
  ctx.quadraticCurveTo(toeX * 0.7, -FOOT_DEPTH * 0.05, toeX * 0.6, -FOOT_DEPTH * 0.08);
  ctx.quadraticCurveTo(toeX * 0.25, -FOOT_DEPTH * 0.3, heelX, -FOOT_DEPTH * 0.1);
  ctx.closePath();
  ctx.fillStyle = flesh;
  ctx.strokeStyle = mix(OUTLINE, SKIN.shadow, FOOT_OUTLINE_LIFT);
  ctx.lineWidth = OUTLINE_BLEED;
  ctx.fill();
  ctx.stroke();

  // Instep highlight and the shaded hollow of the arch.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = rgba(SKIN.light, SHEEN_ALPHA);
  ctx.beginPath();
  ctx.ellipse(toeX * 0.35, -FOOT_DEPTH * 0.02, length * 0.3, FOOT_DEPTH * 0.22, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(SKIN.shadow, ARCH_ALPHA);
  ctx.beginPath();
  ctx.ellipse(heelX * 0.2, sole * 0.85, length * 0.3, FOOT_DEPTH * 0.2, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

// ── Hands ────────────────────────────────────────────────────────────────────

const KNUCKLE_COUNT = 3;
/**
 * A hand is about half its forearm. Derived from the head instead — which is
 * where a life-drawing rule of thumb points — it inherits this figure's
 * deliberately oversized game-character head and comes out 80% of the forearm,
 * long enough that the bare skin below the cuff reads as a rolled-up sleeve.
 */
const HAND_LENGTH = FOREARM_LENGTH * 0.38;
/**
 * Wider than it looks like it should be: at 0.52 the hand came out exactly as
 * thick as the wrist it hangs off (both 0.07 across), so the arm read as one
 * tapering stick and the cuff→hand step looked like a kink in the limb. A hand
 * needs visible mass past the wrist to read as a hand at all.
 */
const HAND_WIDTH = HAND_LENGTH * 0.72;
const FIST_LENGTH = HAND_LENGTH * 0.78;
const FIST_WIDTH = HAND_LENGTH * 0.85;
const THUMB_AT = 0.3;
const THUMB_LENGTH = 0.42;
const THUMB_WIDTH = 0.3;
const KNUCKLE_DEPTH = 0.16;

/**
 * A hand hanging off the wrist at `at`, along the forearm's direction. Closing
 * it shortens and widens it into a fist and brings the knuckles up.
 *
 * The hand is drawn *past* the wrist rather than centred on it — centred, the
 * arm looked like it ended in a cork.
 */
function drawHand(
  ctx: Ctx,
  at: Pt,
  wristAngle: number,
  fist: number,
  shade: number,
  thumbSide: number,
): void {
  const flesh = mix(SKIN.mid, OUTLINE, shade);
  const fleshLight = mix(SKIN.light, OUTLINE, shade);
  const length = lerp(HAND_LENGTH, FIST_LENGTH, fist);
  const halfWidth = lerp(HAND_WIDTH, FIST_WIDTH, fist) / 2;

  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(wristAngle);

  // The thumb sits on the side of the hand nearest the body, and is drawn under
  // the palm so only its ball shows.
  const thumbBase = pt(length * THUMB_AT, halfWidth * 0.6 * thumbSide);
  const thumbTip = pt(length * (THUMB_AT + THUMB_LENGTH * 0.5), halfWidth * 1.25 * thumbSide);
  outlineCapsule(ctx, thumbBase, thumbTip, halfWidth * THUMB_WIDTH, halfWidth * THUMB_WIDTH * 0.8);
  fillCapsule(
    ctx,
    thumbBase,
    thumbTip,
    halfWidth * THUMB_WIDTH,
    halfWidth * THUMB_WIDTH * 0.8,
    flesh,
  );

  const wrist = pt(0, 0);
  const tip = pt(length, 0);
  outlineCapsule(ctx, wrist, tip, halfWidth * WRIST_PINCH, halfWidth);
  fillCapsule(ctx, wrist, tip, halfWidth * WRIST_PINCH, halfWidth, flesh);

  // Knuckle scallops on the leading edge. A few pixels of notch is the whole
  // difference between a fist and a bean.
  ctx.save();
  ctx.globalAlpha = KNUCKLE_ALPHA * fist;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_BLEED;
  for (let i = 0; i < KNUCKLE_COUNT; i++) {
    const across = lerp(-halfWidth * 0.6, halfWidth * 0.6, (i + 0.5) / KNUCKLE_COUNT);
    ctx.beginPath();
    ctx.moveTo(length * (1 - KNUCKLE_DEPTH), across);
    ctx.lineTo(length, across);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = HAND_SHEEN_ALPHA;
  fillCapsule(
    ctx,
    pt(length * 0.3, -halfWidth * 0.3),
    pt(length * 0.8, -halfWidth * 0.3),
    halfWidth * 0.24,
    halfWidth * 0.18,
    fleshLight,
  );
  ctx.restore();
  ctx.restore();
}

/** Hands must not out-value the thighs behind them or they read as forward. */
const HAND_SHEEN_ALPHA = 0.16;
/** Keeps a hand from disappearing into the thigh it hangs beside. */

const WRIST_PINCH = 0.7;
const KNUCKLE_ALPHA = 0.7;

// ── Boxer shorts ─────────────────────────────────────────────────────────────

const SHORTS_TOP_RISE = 0.055;
const SHORTS_HEM_DROP = 0.24;
const SHORTS_HIP_FLARE = 1.22;
/**
 * The hem still has to cover the tops of the thighs (`LEG_ROOT_HALF +
 * THIGH_WIDTH`), so it cannot go much below 1.4. Wider than this and the boxers
 * reach nearly as far as his shoulders, which leaves a hanging arm no room to
 * clear his hip.
 */
const SHORTS_HEM_FLARE = 1.42;
const WAISTBAND_HEIGHT = 0.042;
/**
 * Few and large. Fifteen hearts at 0.03 tiles came out under two pixels each on
 * the sheet, which is not a heart at any distance — it is a polka dot.
 */
const HEART_ROWS = 2;
const HEART_COLS = 3;
const HEART_SIZE = 0.058;
const HEART_JITTER = 0.02;
const HEART_HIGHLIGHT = 0.82;
const HEART_HIGHLIGHT_LIFT = 0.09;

/**
 * A leg opening: a band lying across the thigh, square to it, at a fixed
 * distance down the leg.
 *
 * Rotating a fixed hem about the hip was the obvious approach and it does not
 * work — the turn has to be damped and capped to keep the crotch from sweeping
 * across the body, and a capped hem simply stops covering a thigh raised past
 * the cap. Following the thigh's own direction covers it at any angle by
 * construction.
 */
function legOpening(leg: BoneChain, outward: number, outerHalf: number, innerHalf: number) {
  const span = Math.hypot(leg.joint.x - leg.root.x, leg.joint.y - leg.root.y);
  const dirX = span === 0 ? 0 : (leg.joint.x - leg.root.x) / span;
  const dirY = span === 0 ? 1 : (leg.joint.y - leg.root.y) / span;
  const along = Math.min(SHORTS_HEM_DROP, span * SHORTS_MAX_THIGH_SHARE);
  const centre = offset(leg.root, dirX * along, dirY * along);
  // Square to the thigh, so the opening reads as a cuff rather than as a
  // horizontal cut across a diagonal leg.
  const acrossX = dirY * outward;
  const acrossY = -dirX * outward;
  return {
    outer: offset(centre, acrossX * outerHalf, acrossY * outerHalf),
    inner: offset(centre, -acrossX * innerHalf, -acrossY * innerHalf),
    seam: offset(
      offset(leg.root, dirX * along * SIDE_SEAM_AT, dirY * along * SIDE_SEAM_AT),
      acrossX * outerHalf,
      acrossY * outerHalf,
    ),
  };
}

/** The hem never rides further than this down a thigh, however short the leg. */
const SHORTS_MAX_THIGH_SHARE = 0.62;

/**
 * The shorts hang off the waist, but each leg of them is a cuff wrapped round
 * its own thigh. Drawn as a fixed trapezoid the boxers stay bolt upright
 * through a kick while the leg inside swings away, and the raised thigh comes
 * out bare — which is the one thing that reads as cardboard.
 */
function traceShorts(
  ctx: Ctx,
  hip: Pt,
  halfWidth: number,
  flare: number,
  notch: number,
  legs: LegPair,
): void {
  const top = hip.y - SHORTS_TOP_RISE;
  const hem = hip.y + SHORTS_HEM_DROP;
  const hipHalf = halfWidth * SHORTS_HIP_FLARE;
  const hemHalf = halfWidth * lerp(SHORTS_HEM_FLARE, SHORTS_HEM_FLARE * 1.15, flare);
  // Taken off the solved legs, not re-derived from the hip width: the roots move
  // with `view.lateral`, which narrows far faster than the hip does, and a cuff
  // centred where the leg *isn't* misses it by its own error.
  const rootHalf = Math.abs(legs.right.root.x - hip.x);
  // A cuff must clear the thigh it wraps, whatever the hip flare works out to.
  // Edge-on the flare-derived width came out a third narrower than the leg.
  const clearsThigh = THIGH_WIDTH * CUFF_SLACK;
  const outerHalf = Math.max(hemHalf - rootHalf, clearsThigh);
  const innerHalf = Math.min(rootHalf * CUFF_INNER_REACH, clearsThigh);
  const right = legOpening(legs.right, 1, outerHalf, innerHalf);
  const left = legOpening(legs.left, -1, outerHalf, innerHalf);
  const crotchY = lerp(hem, lerp(top, hem, CROTCH_RISE), notch);

  ctx.beginPath();
  ctx.moveTo(hip.x - hipHalf, top);
  ctx.lineTo(hip.x + hipHalf, top);
  ctx.quadraticCurveTo(right.seam.x, right.seam.y, right.outer.x, right.outer.y);
  ctx.lineTo(right.inner.x, right.inner.y);
  ctx.quadraticCurveTo(hip.x, crotchY, left.inner.x, left.inner.y);
  ctx.lineTo(left.outer.x, left.outer.y);
  ctx.quadraticCurveTo(left.seam.x, left.seam.y, hip.x - hipHalf, top);
  ctx.closePath();
}

/** Cloth stands off the leg it covers by this much. */
const CUFF_SLACK = 1.15;
/**
 * How far inboard of its own root a cuff may reach. Held short of the
 * centreline so the two openings leave the V that reads as boxers rather than
 * meeting into a skirt — and, edge-on where the roots nearly coincide, so the
 * two do not cross each other.
 */
const CUFF_INNER_REACH = 0.95;

const SIDE_SEAM_AT = 0.6;

/** The two solved legs, so the shorts can follow the thighs they cover. */
interface LegPair {
  readonly left: BoneChain;
  readonly right: BoneChain;
}

const CROTCH_RISE = 0.42;

function drawHeart(ctx: Ctx, cx: number, cy: number, size: number, colour: string): void {
  const lobe = size * 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.72);
  ctx.bezierCurveTo(cx - size, cy + size * 0.1, cx - lobe, cy - size * 0.75, cx, cy - size * 0.18);
  ctx.bezierCurveTo(cx + lobe, cy - size * 0.75, cx + size, cy + size * 0.1, cx, cy + size * 0.72);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/** Deterministic 0–1 jitter so the heart print does not crawl between frames. */
function printHash(row: number, col: number): number {
  const seeded = Math.sin(row * 127.1 + col * 311.7) * 43758.5453;
  return seeded - Math.floor(seeded);
}

/**
 * The boxers. `notch` is how deep the leg openings cut: edge-on you see one hip
 * wrapped in cloth, and cutting the full crotch V there splits the shorts into
 * two panels with bare body showing between them.
 */
function drawShorts(
  ctx: Ctx,
  hip: Pt,
  halfWidth: number,
  flare: number,
  showsBack: boolean,
  notch: number,
  legs: LegPair,
): void {
  const top = hip.y - SHORTS_TOP_RISE;
  const hem = hip.y + SHORTS_HEM_DROP;

  ctx.save();
  traceShorts(ctx, hip, halfWidth, flare, notch, legs);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_BLEED * 2;
  ctx.stroke();
  ctx.fillStyle = COTTON.mid;
  ctx.fill();

  ctx.save();
  traceShorts(ctx, hip, halfWidth, flare, notch, legs);
  ctx.clip();

  const spanX = halfWidth * SHORTS_HEM_FLARE;
  for (let row = 0; row < HEART_ROWS; row++) {
    for (let col = 0; col < HEART_COLS; col++) {
      const jx = (printHash(row, col) - 0.5) * HEART_JITTER * 2;
      const jy = (printHash(col, row) - 0.5) * HEART_JITTER * 2;
      const cx = hip.x + lerp(-spanX, spanX, (col + 0.5) / HEART_COLS) + jx;
      const cy = lerp(top, hem, (row + 0.5) / HEART_ROWS) + jy;
      // One solid heart with a shaded lower lobe. A second small heart drawn
      // inside it just turns the print into polka dots at tile size.
      drawHeart(ctx, cx, cy, HEART_SIZE, HEART_RED_DARK);
      drawHeart(
        ctx,
        cx,
        cy - HEART_SIZE * HEART_HIGHLIGHT_LIFT,
        HEART_SIZE * HEART_HIGHLIGHT,
        HEART_RED,
      );
    }
  }

  // Shading: the far side of the trunk falls off, and the crotch sits in shade.
  ctx.fillStyle = rgba(COTTON.shadow, CLOTH_SHADE_ALPHA);
  ctx.fillRect(hip.x + spanX * SHADE_START, top - 1, spanX * 2, hem - top + 2);
  ctx.fillStyle = rgba(COTTON.shadow, CLOTH_SHADE_ALPHA * (showsBack ? 0.5 : 1));
  ctx.beginPath();
  ctx.ellipse(hip.x, hem, spanX * CROTCH_SHADE_W, (hem - top) * CROTCH_SHADE_H, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  fillCapsule(
    ctx,
    pt(hip.x - halfWidth * SHORTS_HIP_FLARE, top),
    pt(hip.x + halfWidth * SHORTS_HIP_FLARE, top),
    WAISTBAND_HEIGHT,
    WAISTBAND_HEIGHT,
    COTTON.dark,
  );
  ctx.restore();
}

const CLOTH_SHADE_ALPHA = 0.34;
const SHADE_START = 0.35;
const CROTCH_SHADE_W = 0.42;
const CROTCH_SHADE_H = 0.3;

// ── Jacket ───────────────────────────────────────────────────────────────────

const JACKET_HEM_DROP = 0.055;
const JACKET_SHOULDER_PAD = 0.03;
const JACKET_WAIST_PINCH = 0.94;
const COLLAR_HEIGHT = 0.052;
const COLLAR_SPREAD = 0.16;
const ZIP_WIDTH = 0.012;
const POCKET_WIDTH = 0.07;
const POCKET_HEIGHT = 0.042;
const POCKET_DROP = 0.68;
const SEAM_ALPHA = 0.45;

/** Traces the jacket body from the shoulder line to the hem, pinched at the waist. */
function traceJacket(ctx: Ctx, skeleton: Skeleton, pose: CarlPose, view: ViewSpec): void {
  const shoulderHalf = (skeleton.shoulderHalf + JACKET_SHOULDER_PAD * view.girth) * view.chestTaper;
  const chestHalf = (CHEST_HALF + JACKET_SHOULDER_PAD) * view.girth * view.chestTaper;
  const waistHalf =
    (WAIST_HALF + JACKET_SHOULDER_PAD) *
    view.girth *
    JACKET_WAIST_PINCH *
    (1 + pose.jacketFlare * 0.3);

  const left = -1;
  const right = 1;
  const shoulder = skeleton.shoulderCentre;
  const chest = skeleton.chest;
  const hem = offset(skeleton.waist, 0, JACKET_HEM_DROP);

  ctx.beginPath();
  ctx.moveTo(shoulder.x + left * shoulderHalf, shoulder.y);
  ctx.quadraticCurveTo(
    chest.x + left * chestHalf * SHOULDER_BULGE,
    chest.y,
    hem.x + left * waistHalf,
    hem.y,
  );
  ctx.quadraticCurveTo(hem.x, hem.y + JACKET_HEM_DROP, hem.x + right * waistHalf, hem.y);
  ctx.quadraticCurveTo(
    chest.x + right * chestHalf * SHOULDER_BULGE,
    chest.y,
    shoulder.x + right * shoulderHalf,
    shoulder.y,
  );
  ctx.quadraticCurveTo(
    shoulder.x,
    shoulder.y - JACKET_SHOULDER_PAD * 2,
    shoulder.x + left * shoulderHalf,
    shoulder.y,
  );
  ctx.closePath();
}

const SHOULDER_BULGE = 1.12;

function drawJacket(ctx: Ctx, skeleton: Skeleton, pose: CarlPose, view: ViewSpec): void {
  const hem = offset(skeleton.waist, 0, JACKET_HEM_DROP);
  const shoulderHalf = (skeleton.shoulderHalf + JACKET_SHOULDER_PAD * view.girth) * view.chestTaper;

  ctx.save();
  traceJacket(ctx, skeleton, pose, view);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_BLEED * 2;
  ctx.stroke();
  ctx.fillStyle = LEATHER.mid;
  ctx.fill();

  ctx.save();
  traceJacket(ctx, skeleton, pose, view);
  ctx.clip();

  // The unlit half of the torso, then the creases leather always breaks into.
  ctx.fillStyle = rgba(LEATHER.shadow, CLOTH_SHADE_ALPHA);
  ctx.fillRect(skeleton.chest.x + shoulderHalf * SHADE_START, skeleton.shoulderCentre.y - 1, 2, 3);
  ctx.fillStyle = rgba(LEATHER.light, SHEEN_ALPHA);
  ctx.beginPath();
  ctx.ellipse(
    skeleton.chest.x - shoulderHalf * CHEST_SHEEN_X,
    skeleton.chest.y,
    shoulderHalf * CHEST_SHEEN_RX,
    Math.abs(skeleton.shoulderCentre.y - hem.y) * CHEST_SHEEN_RY,
    deg(CHEST_SHEEN_TILT),
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.strokeStyle = rgba(LEATHER.shadow, CREASE_ALPHA);
  ctx.lineWidth = ZIP_WIDTH * 0.8;
  for (let i = 0; i < WAIST_CREASES; i++) {
    const t = (i + 1) / (WAIST_CREASES + 1);
    const y = lerp(skeleton.chest.y, hem.y, lerp(CREASE_BAND_TOP, 1, t));
    ctx.beginPath();
    ctx.moveTo(hem.x - shoulderHalf, y);
    ctx.quadraticCurveTo(hem.x, y + CREASE_SAG, hem.x + shoulderHalf, y - CREASE_SAG);
    ctx.stroke();
  }

  if (view.showsBack) {
    // A yoke seam across the shoulder blades is the only structure the back has.
    ctx.strokeStyle = rgba(LEATHER.shadow, SEAM_ALPHA);
    ctx.lineWidth = ZIP_WIDTH;
    ctx.beginPath();
    ctx.moveTo(skeleton.shoulderCentre.x - shoulderHalf, skeleton.shoulderCentre.y + YOKE_DROP);
    ctx.quadraticCurveTo(
      skeleton.shoulderCentre.x,
      skeleton.shoulderCentre.y + YOKE_DROP + YOKE_SAG,
      skeleton.shoulderCentre.x + shoulderHalf,
      skeleton.shoulderCentre.y + YOKE_DROP,
    );
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(skeleton.shoulderCentre.x, skeleton.shoulderCentre.y + YOKE_DROP);
    ctx.lineTo(hem.x, hem.y);
    ctx.stroke();
  } else {
    const zipTop = skeleton.shoulderCentre.y + COLLAR_HEIGHT * 0.5;
    fillCapsule(
      ctx,
      pt(skeleton.shoulderCentre.x + ZIP_OFFSET, zipTop),
      pt(hem.x + ZIP_OFFSET, hem.y),
      ZIP_WIDTH,
      ZIP_WIDTH,
      LEATHER.shadow,
    );
    ctx.fillStyle = rgba(LEATHER.rim, SEAM_ALPHA);
    ctx.fillRect(
      skeleton.shoulderCentre.x + ZIP_OFFSET - ZIP_WIDTH * 0.4,
      zipTop,
      ZIP_WIDTH * 0.8,
      Math.abs(hem.y - zipTop),
    );

    for (const side of [-1, 1]) {
      const px = skeleton.chest.x + side * shoulderHalf * POCKET_X;
      const py = lerp(skeleton.chest.y, hem.y, POCKET_DROP);
      ctx.fillStyle = rgba(LEATHER.shadow, SEAM_ALPHA);
      ctx.fillRect(px - POCKET_WIDTH / 2, py, POCKET_WIDTH, POCKET_HEIGHT);
      ctx.fillStyle = LEATHER.dark;
      ctx.fillRect(px - POCKET_WIDTH / 2, py, POCKET_WIDTH, POCKET_HEIGHT * FLAP_SHARE);
    }
  }
  ctx.restore();

  // Hem band and collar sit outside the clip so their outlines stay crisp.
  // The ribbed waistband: one step lighter than the body, which is what says
  // "bomber jacket" at a size where no other detail survives.
  // The band has to follow the jacket's own waist. Sized off the shoulders it
  // juts out past the hem on both sides and reads as a tutu.
  const bandHalf =
    (WAIST_HALF + JACKET_SHOULDER_PAD) *
    view.girth *
    JACKET_WAIST_PINCH *
    (1 + pose.jacketFlare * 0.3);
  fillCapsule(
    ctx,
    pt(hem.x - bandHalf, hem.y),
    pt(hem.x + bandHalf, hem.y),
    HEM_BAND,
    HEM_BAND,
    LEATHER.light,
  );
  ctx.save();
  ctx.globalAlpha = RIB_ALPHA;
  ctx.strokeStyle = LEATHER.shadow;
  ctx.lineWidth = OUTLINE_BLEED;
  for (let i = 1; i < RIB_COUNT; i++) {
    const x = lerp(hem.x - bandHalf, hem.x + bandHalf, i / RIB_COUNT);
    ctx.beginPath();
    ctx.moveTo(x, hem.y - HEM_BAND * 0.8);
    ctx.lineTo(x, hem.y + HEM_BAND * 0.8);
    ctx.stroke();
  }
  ctx.restore();

  // A rolled collar wraps the neck and rises behind it. Drawn as two wings it
  // reads as a bowtie tied under his chin.
  const collarBase = mixPt(skeleton.shoulderCentre, skeleton.neck, COLLAR_RIDE);
  const collarHalf = Math.max(NECK_WIDTH * COLLAR_WRAP, COLLAR_SPREAD * view.girth);
  ctx.beginPath();
  ctx.moveTo(collarBase.x - collarHalf, collarBase.y + COLLAR_HEIGHT * COLLAR_SEAT);
  ctx.quadraticCurveTo(
    collarBase.x - collarHalf * COLLAR_SHOULDER,
    collarBase.y - COLLAR_HEIGHT,
    collarBase.x,
    collarBase.y - COLLAR_HEIGHT * COLLAR_BACK_RISE,
  );
  ctx.quadraticCurveTo(
    collarBase.x + collarHalf * COLLAR_SHOULDER,
    collarBase.y - COLLAR_HEIGHT,
    collarBase.x + collarHalf,
    collarBase.y + COLLAR_HEIGHT * COLLAR_SEAT,
  );
  ctx.quadraticCurveTo(
    collarBase.x,
    collarBase.y + COLLAR_HEIGHT * COLLAR_NOTCH,
    collarBase.x - collarHalf,
    collarBase.y + COLLAR_HEIGHT * COLLAR_SEAT,
  );
  ctx.closePath();
  ctx.fillStyle = LEATHER.dark;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_BLEED * 1.5;
  ctx.fill();
  ctx.stroke();
  // A lit edge along the collar's roll, so it does not read as a flat band.
  ctx.strokeStyle = rgba(LEATHER.rim, SEAM_ALPHA);
  ctx.lineWidth = OUTLINE_BLEED;
  ctx.beginPath();
  ctx.moveTo(collarBase.x - collarHalf * COLLAR_SHOULDER, collarBase.y - COLLAR_HEIGHT * 0.5);
  ctx.quadraticCurveTo(
    collarBase.x,
    collarBase.y - COLLAR_HEIGHT * COLLAR_BACK_RISE * 1.3,
    collarBase.x + collarHalf * COLLAR_SHOULDER,
    collarBase.y - COLLAR_HEIGHT * 0.5,
  );
  ctx.stroke();
  ctx.restore();
}

const CHEST_SHEEN_X = 0.42;
const CHEST_SHEEN_RX = 0.42;
const CHEST_SHEEN_RY = 0.3;
const CHEST_SHEEN_TILT = -12;
const WAIST_CREASES = 3;
const CREASE_BAND_TOP = 0.35;
const CREASE_SAG = 0.022;
const YOKE_DROP = 0.075;
const YOKE_SAG = 0.03;
const ZIP_OFFSET = 0.012;
const POCKET_X = 0.46;
const FLAP_SHARE = 0.42;
const HEM_BAND = 0.026;
const RIB_COUNT = 9;
const RIB_ALPHA = 0.5;
/** The collar wraps this much wider than the neck it stands around. */
const COLLAR_WRAP = 1.5;
const COLLAR_SEAT = 0.55;
const COLLAR_SHOULDER = 0.8;
const COLLAR_BACK_RISE = 0.75;
const COLLAR_NOTCH = 0.1;
/** How far up the neck the collar stands from the shoulder line. */
const COLLAR_RIDE = 0.12;

// ── Head ─────────────────────────────────────────────────────────────────────

/**
 * The jaw's taper. A chin much past a third of the head's half-width squares
 * the bottom of the face off, and a blocky chin reads as a helmet or a jaw
 * rather than as a head.
 */
const JAW_WIDTH = 0.94;
const JAW_DROP = 0.3;
/** How wide the jaw still is where it turns in, level with the top of the mouth. */
const JAW_AT_MOUTH = 0.8;
/** Half-width of the chin itself: a rounded point, not a flat edge. */
const CHIN_WIDTH = 0.26;
/** How far down the taper runs before the chin's own curve takes over. */
const CHIN_SLOPE = 0.72;
const CHIN_Y = 0.98;
const CHIN_TIP_Y = 1.2;

/**
 * The face, laid out from the eyeline. A human's eyes sit halfway between crown
 * and chin; the first pass put them at 70% down, which is what made the head
 * read as an inflated cranium with a tiny face hung underneath.
 */
const EYE_Y = 0;
const EYE_WIDTH = HEAD_RX * 0.4;
const EYE_RX = EYE_WIDTH / 2;
const EYE_RY = EYE_RX * 0.72;
/** Eyes sit one eye-width apart. */
const EYE_DX = EYE_WIDTH;
const IRIS_R = EYE_RX * 0.58;
const PUPIL_R = EYE_RX * 0.3;
const LID_THICK = EYE_RY * 0.35;

const BROW_Y = -HEAD_RY * 0.28;
const BROW_THICK = HEAD_RY * 0.1;
const BROW_LENGTH = EYE_WIDTH * 1.5;
/** How far the inner end of a brow drops below the outer one: the whole scowl. */
const BROW_ANGRY_TILT = 1.6;

const NOSE_Y = HEAD_RY * 0.24;
const MOUTH_Y = HEAD_RY * 0.56;
/** The jaw turns in level with the top of the mouth, not above it. */
const JAW_TURN_Y = MOUTH_Y - HEAD_RY * 0.1;
const EAR_Y = 0;
const STUBBLE_ALPHA = 0.26;

/** Traces the skull-plus-jaw silhouette in head-local space. */
function traceSkull(ctx: Ctx, profile: boolean, toward: number): void {
  ctx.beginPath();
  if (!profile) {
    ctx.moveTo(-HEAD_RX, -HEAD_RY * 0.1);
    ctx.quadraticCurveTo(-HEAD_RX, -HEAD_RY * 1.25, 0, -HEAD_RY * 1.2);
    ctx.quadraticCurveTo(HEAD_RX, -HEAD_RY * 1.25, HEAD_RX, -HEAD_RY * 0.1);
    // The jaw holds its width down to the top of the mouth and only then turns
    // in, so the chin is a rounded triangle hung off a square jawline. Tapering
    // from the cheekbone instead gives a face with no jaw and a wide flat chin
    // at the bottom of it.
    ctx.quadraticCurveTo(
      HEAD_RX * JAW_WIDTH,
      HEAD_RY * JAW_DROP,
      HEAD_RX * JAW_AT_MOUTH,
      JAW_TURN_Y,
    );
    ctx.quadraticCurveTo(
      HEAD_RX * JAW_AT_MOUTH * CHIN_SLOPE,
      HEAD_RY * CHIN_Y,
      HEAD_RX * CHIN_WIDTH,
      HEAD_RY * CHIN_Y,
    );
    ctx.quadraticCurveTo(0, HEAD_RY * CHIN_TIP_Y, -HEAD_RX * CHIN_WIDTH, HEAD_RY * CHIN_Y);
    ctx.quadraticCurveTo(
      -HEAD_RX * JAW_AT_MOUTH * CHIN_SLOPE,
      HEAD_RY * CHIN_Y,
      -HEAD_RX * JAW_AT_MOUTH,
      JAW_TURN_Y,
    );
    ctx.quadraticCurveTo(-HEAD_RX * JAW_WIDTH, HEAD_RY * JAW_DROP, -HEAD_RX, -HEAD_RY * 0.1);
    ctx.closePath();
    return;
  }
  {
    // In profile the brow, nose and chin are the whole read, so they are traced
    // as explicit landmarks rather than falling out of an oval.
    const f = toward;
    ctx.moveTo(-HEAD_DEPTH * f, -HEAD_RY * 0.2);
    ctx.quadraticCurveTo(
      -HEAD_DEPTH * 1.05 * f,
      -HEAD_RY * 1.2,
      HEAD_DEPTH * 0.25 * f,
      -HEAD_RY * 1.15,
    );
    ctx.quadraticCurveTo(
      HEAD_DEPTH * 1.02 * f,
      -HEAD_RY * 0.95,
      HEAD_DEPTH * 0.95 * f,
      -HEAD_RY * 0.2,
    );
    ctx.lineTo(HEAD_DEPTH * 1.18 * f, HEAD_RY * 0.14);
    ctx.lineTo(HEAD_DEPTH * 0.86 * f, HEAD_RY * 0.24);
    ctx.quadraticCurveTo(
      HEAD_DEPTH * 0.98 * f,
      HEAD_RY * 0.62,
      HEAD_DEPTH * 0.38 * f,
      HEAD_RY * 0.88,
    );
    ctx.quadraticCurveTo(
      -HEAD_DEPTH * 0.5 * f,
      HEAD_RY * 0.92,
      -HEAD_DEPTH * 0.85 * f,
      HEAD_RY * 0.25,
    );
    ctx.closePath();
  }
}

/** Many small tufts, not a few tall spikes. */
const HAIR_TUFTS = 8;
const HAIR_TUFT_HEIGHT = HEAD_RY * 0.2;
const HAIR_SPIKE_LEAN = 0.4;
/** Where the hairline crosses the temples and the centre of the forehead. */
/**
 * Where the hair meets the side of the head: below the top of the ear, so the
 * crop covers the temple, but above the ear's middle, so the ear still shows
 * beneath it. Carried past the ear entirely the hair swallows it.
 */
const HAIRLINE_TEMPLE_Y = -0.24;
/**
 * How high up the head the front hairline sits. High, this leaves a band of
 * hair across the top of the skull and a forehead under it — a swim cap rather
 * than a head of hair.
 */
/**
 * The brow sits at −0.28 HEAD_RY, so the hairline has to clear it by a real
 * margin or he has no forehead — the single thing that made the crop read as
 * headgear rather than hair.
 */
const HAIRLINE_CROWN_Y = -0.78;
/** How far down the skull the crop reaches when seen from behind. */
/**
 * Seen from behind the crop covers the skull but stops short of the neck; run
 * to the full head height it squares off into a helmet.
 */
/** How far out the hairline turns down toward the temple. */
const HAIRLINE_CORNER = 0.82;
/** The skull's half-width at brow height, as a fraction of its widest. */
const BROW_ON_SKULL = Math.sqrt(Math.max(0, 1 - HAIRLINE_CROWN_Y * HAIRLINE_CROWN_Y));

/** Where the brow hairline has finished sloping back toward the ear. */
const HAIRLINE_SLOPE = 0.42;
/**
 * The sideburn's front edge. The ear sits a shade *behind* centre at
 * `PROFILE_EAR_X` (−0.16), so the sideburn belongs just forward of that — out
 * where the head is widest it lands on his cheek and reads as a chinstrap.
 */
const SIDEBURN_X = 0.12;
/** Its tip: a short drop past the hairline, level with the top of the ear. */
const SIDEBURN_TIP_Y = -0.1;
/** Where it rejoins the hairline, behind the sideburn. */
const SIDEBURN_BACK_X = -0.04;
/** The hairline clears the top of the ear (which reaches −0.3) by a little. */
const ABOVE_EAR_Y = -0.36;
/** …and then runs a little way down the back of the skull. Only a little: a
 * deep nape reads as a mullet rather than as a haircut. */
const PROFILE_NAPE_Y = 0.14;
/** How far back the hairline holds its height before dropping to the nape. */
const PROFILE_NAPE_BEND = 0.3;
/** A shallow widow's peak, so the brow line is not dead flat. */
const HAIRLINE_PEAK = 0.07;

/** How far down the back of the head the crop reaches. */
const BACK_HAIR_COVERAGE = 0.56;
/** Half-width at the crop's lower corners, following the skull as it narrows. */
const BACK_HAIR_SIDE = 0.7;
/**
 * How far the lower edge reaches at the centre of the nape, against how far it
 * reaches beside the ears. Over 1, because a nape hairline dips *down* in the
 * middle of the neck and lifts toward the ears — inverted it curves like a
 * chinstrap. At 1 exactly the edge is straight, which reads as a moulded rim.
 */
const BACK_HAIR_NAPE_DROP = 1.3;
const NAPE_TUFTS = 7;
/** Unevenness along the nape, in head radii. Hair does not end on a curve. */
const NAPE_WOBBLE = 0.16;
/** Keeps the nape's noise off the same row the crown tufts draw from. */
const NAPE_NOISE_ROW = 5;
/** The crown arc the spikes root along, in radians around the head centre. */
const HAIR_ARC_START = deg(200);
const HAIR_ARC_END = deg(340);
/** Edge-on the crop reaches further down the back and stops at the brow. */
const PROFILE_ARC_START = deg(200);
const PROFILE_ARC_END = deg(309);

/**
 * The hair: one mass with a jagged top edge, not a cap with separate spikes
 * standing on it. Spikes drawn as individual shapes rooted along the skull's
 * rim read as a crown — the silhouette has to be the hair itself.
 *
 * `flow` leans the whole crop sideways; in profile it sweeps back off the face.
 */
function drawHair(
  ctx: Ctx,
  profile: boolean,
  toward: number,
  flow: number,
  fromBehind: boolean,
): void {
  const half = profile ? HEAD_DEPTH * 1.02 : HEAD_RX * 1.05;
  const templeY = HEAD_RY * (fromBehind ? BACK_HAIR_COVERAGE : HAIRLINE_TEMPLE_Y);
  const crownY =
    HEAD_RY * (fromBehind ? BACK_HAIR_COVERAGE * BACK_HAIR_NAPE_DROP : HAIRLINE_CROWN_Y);
  const sweep = (profile ? -toward * HAIR_SWEEP_BACK : 0) + flow * HAIR_SPIKE_LEAN;

  // The crop is one soft mass with an uneven edge, drawn as a curve through a
  // ring of small tufts. Straight lines between tall peaks and deep notches —
  // which is what this was — give him a crown of thorns, not hair.
  // Edge-on the crop has to stop where the hairline starts. Carried round to the
  // same angle the head-on view uses, its front end juts out past the brow and
  // the hairline then cuts back up behind it — an overhang over his face.
  // The profile row is always drawn facing +X; the runtime mirrors it.
  const arcStart = profile ? PROFILE_ARC_START : HAIR_ARC_START;
  const arcEnd = profile ? PROFILE_ARC_END : HAIR_ARC_END;
  const tufts: Pt[] = [];
  for (let i = 0; i <= HAIR_TUFTS; i++) {
    const t = i / HAIR_TUFTS;
    const angle = lerp(arcStart, arcEnd, t);
    const wobble = 1 + (printHash(i, 0) - 0.5) * HAIR_TUFT_WOBBLE;
    const lift = HAIR_TUFT_HEIGHT * lerp(0.55, 1, hump(t)) * wobble;
    const outX = Math.cos(angle) + sweep;
    const outY = Math.sin(angle) * HAIR_TUFT_TILT;
    tufts.push(
      pt(
        Math.cos(angle) * half + outX * lift,
        crownProfile(angle) * HEAD_RY * HAIR_CAP_LIFT + outY * lift,
      ),
    );
  }

  const backStartY = profile ? HEAD_RY * PROFILE_NAPE_Y : templeY;
  /**
   * Where the crop's lower corners sit, seen from behind. On the skull, which
   * at that height is only ~0.69 of its widest — carried out to the full
   * half-width the silhouette is widest at its lowest point, which is a bowl
   * sitting on his head however ragged its edge is.
   */
  const backSideX = half * BACK_HAIR_SIDE;

  ctx.beginPath();
  ctx.moveTo(profile ? -half * toward : -backSideX, backStartY);
  ctx.lineTo(tufts[0].x, tufts[0].y);
  for (let i = 1; i < tufts.length - 1; i++) {
    const mid = mixPt(tufts[i], tufts[i + 1], 0.5);
    ctx.quadraticCurveTo(tufts[i].x, tufts[i].y, mid.x, mid.y);
  }
  const lastTuft = tufts[tufts.length - 1];
  ctx.lineTo(lastTuft.x, lastTuft.y);
  if (profile) {
    // Edge-on the hairline is three different heights: the brow, where it sits
    // exactly where the front view puts it; a sideburn dropping in front of the
    // ear; and the nape, which runs a long way further down the back of the
    // skull. Closed at one height all round — which is what the front view's
    // hairline does — the crop reads as a bowl.
    const face = toward;
    // Edge-on the face is the head's front *edge*, so the brow hairline sits at
    // the crown height the front view shows across the forehead — not at the
    // temple height, which reads as a hood pulled down over his eyes. It also
    // has to sit *on* the skull: the head is an ellipse, and at brow height it
    // is only two-thirds as wide as it is at the ears, so a brow point out at
    // the full half-width hangs off the front of his face.
    ctx.lineTo(half * BROW_ON_SKULL * face, crownY);
    ctx.quadraticCurveTo(
      half * HAIRLINE_SLOPE * face,
      HEAD_RY * ABOVE_EAR_Y,
      half * SIDEBURN_X * face,
      HEAD_RY * ABOVE_EAR_Y,
    );
    ctx.quadraticCurveTo(
      -half * PROFILE_NAPE_BEND * face,
      HEAD_RY * ABOVE_EAR_Y,
      -half * face,
      backStartY,
    );
  } else if (fromBehind) {
    // From behind the crop has to follow the curve of the skull; closed with
    // straight sides it reads as a box sitting on his shoulders.
    //
    // Both ends land back on `templeY`, where the path began. Ending anywhere
    // else leaves `closePath` to stroke the gap shut, and that seam ran down
    // one side of his head as a dark line below the ear — on one side only,
    // because the other side is a segment the path actually travels.
    // The nape hairline is broken up the same way the crown is. Two clean
    // quadratics across the back of the head give it a moulded lower rim, and a
    // moulded rim on a smooth dome is a helmet — hair ends raggedly.
    const nape: Pt[] = [];
    for (let i = 0; i <= NAPE_TUFTS; i++) {
      const across = i / NAPE_TUFTS;
      const arch = Math.sin(across * Math.PI);
      const wobble = (printHash(i, NAPE_NOISE_ROW) - 0.5) * NAPE_WOBBLE * HEAD_RY;
      nape.push(pt(lerp(backSideX, -backSideX, across), lerp(templeY, crownY, arch) + wobble));
    }
    ctx.lineTo(backSideX, templeY);
    ctx.lineTo(nape[0].x, nape[0].y);
    for (let i = 1; i < nape.length - 1; i++) {
      const mid = mixPt(nape[i], nape[i + 1], 0.5);
      ctx.quadraticCurveTo(nape[i].x, nape[i].y, mid.x, mid.y);
    }
    const lastNape = nape[nape.length - 1];
    ctx.lineTo(lastNape.x, lastNape.y);
    ctx.lineTo(-backSideX, templeY);
  } else {
    // A hairline runs nearly straight across the brow and only turns down at
    // the temples. Bowed up through the middle it is a helmet brim.
    ctx.lineTo(half, templeY);
    ctx.quadraticCurveTo(half * HAIRLINE_CORNER, crownY, half * 0.34, crownY);
    ctx.quadraticCurveTo(0, crownY + HEAD_RY * HAIRLINE_PEAK, -half * 0.34, crownY);
    ctx.quadraticCurveTo(-half * HAIRLINE_CORNER, crownY, -half, templeY);
  }
  ctx.closePath();
  ctx.fillStyle = HAIR.mid;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_BLEED * 1.5;
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = rgba(HAIR.light, SHEEN_ALPHA);
  ctx.beginPath();
  ctx.ellipse(-half * 0.35, -HEAD_RY * 0.85, half * 0.4, HEAD_RY * 0.3, deg(-20), 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(HAIR.shadow, CLOTH_SHADE_ALPHA);
  ctx.fillRect(half * SHADE_START, -HEAD_RY * 2, half * 2, HEAD_RY * 3);
  ctx.restore();

  if (profile) drawSideburn(ctx, half, toward);
}

/**
 * The tab of hair in front of the ear. Painted on its own, after the crop, and
 * deliberately *unstroked*: at this size the outline is as thick as the tab is
 * wide, so carried in the main path it renders as a black spike rather than as
 * hair.
 */
function drawSideburn(ctx: Ctx, half: number, toward: number): void {
  const front = half * SIDEBURN_X * toward;
  const back = half * SIDEBURN_BACK_X * toward;
  const top = HEAD_RY * ABOVE_EAR_Y;
  const tip = HEAD_RY * SIDEBURN_TIP_Y;
  ctx.beginPath();
  ctx.moveTo(front, top);
  ctx.quadraticCurveTo(front, tip, (front + back) / 2, tip);
  ctx.quadraticCurveTo(back, tip, back, top);
  ctx.closePath();
  ctx.fillStyle = HAIR.mid;
  ctx.fill();
}

/** Hair stands off the skull; flush to it the crop has no volume at all. */
const HAIR_CAP_LIFT = 1.05;

/**
 * The crown of a head of hair is not a circle — it runs flat across the top and
 * turns down hard at the corners. Raising the circle's height to a power under
 * one squares it off exactly that much; drawn round, the crop reads as a cap
 * pulled over the skull.
 */
function crownProfile(angle: number): number {
  const height = Math.sin(angle);
  return -Math.pow(Math.abs(height), HAIR_CROWN_FLATNESS);
}

const HAIR_CROWN_FLATNESS = 0.62;
const HAIR_TUFT_TILT = 1.1;
/** Just enough unevenness to keep the edge from reading as a moulded helmet. */
const HAIR_TUFT_WOBBLE = 0.6;
const HAIR_SWEEP_BACK = 0.7;

/**
 * An eye: sclera, iris, pupil and a heavy upper lid. The lid is what makes the
 * eye read at all — without it a small eye is just a dark dot, which is how the
 * first pass ended up with two empty sockets.
 */
function drawEye(
  ctx: Ctx,
  cx: number,
  cy: number,
  look: number,
  blink: number,
  squint: number,
): void {
  const openness = (1 - blink) * (1 - squint * EYE_SQUINT_CLOSE);
  const halfHeight = EYE_RY * openness + EYE_LID_MIN;

  ctx.beginPath();
  ctx.ellipse(cx, cy, EYE_RX, halfHeight, 0, 0, TWO_PI);
  ctx.fillStyle = EYE_WHITE;
  ctx.fill();

  if (openness > EYE_SHUT_THRESHOLD) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, EYE_RX, halfHeight, 0, 0, TWO_PI);
    ctx.clip();
    const irisX = cx + look * EYE_RX * EYE_LOOK_TRAVEL;
    ctx.beginPath();
    ctx.arc(irisX, cy, IRIS_R, 0, TWO_PI);
    ctx.fillStyle = IRIS;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(irisX, cy, PUPIL_R, 0, TWO_PI);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, EYE_RX, halfHeight, 0, 0, TWO_PI);
  ctx.clip();
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(cx - EYE_RX, cy - halfHeight, EYE_RX * 2, LID_THICK);
  ctx.restore();

  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_BLEED * 0.8;
  ctx.beginPath();
  ctx.ellipse(cx, cy, EYE_RX, halfHeight, 0, 0, TWO_PI);
  ctx.stroke();
}

const EYE_SQUINT_CLOSE = 0.22;
const EYE_LID_MIN = 0.003;
const EYE_SHUT_THRESHOLD = 0.25;
const EYE_LOOK_TRAVEL = 0.4;

/**
 * The scowl. The brow's inner end drops toward the bridge of the nose and sits
 * almost on the lid; brows angled the other way read as worried, which is the
 * one expression Carl never wears.
 */
function drawBrow(ctx: Ctx, cx: number, cy: number, side: number, anger: number): void {
  const innerDrop = anger * BROW_ANGRY_TILT * BROW_THICK;
  const inner = pt(cx - side * BROW_LENGTH * 0.5, cy + innerDrop);
  const outer = pt(cx + side * BROW_LENGTH * 0.5, cy - innerDrop * BROW_OUTER_LIFT);
  fillCapsule(ctx, inner, outer, BROW_THICK * 0.5, BROW_THICK * 0.34, mix(HAIR.dark, OUTLINE, 0.4));
}

const BROW_OUTER_LIFT = 0.35;

function drawMouth(
  ctx: Ctx,
  cx: number,
  cy: number,
  open: number,
  profile: boolean,
  toward: number,
): void {
  const halfWidth = MOUTH_HALF_WIDTH * (profile ? 0.55 : 1);
  const height = lerp(MOUTH_CLOSED_HEIGHT, MOUTH_OPEN_HEIGHT, open);
  const centre = profile ? cx + toward * MOUTH_HALF_WIDTH * 0.5 : cx;

  ctx.beginPath();
  ctx.ellipse(centre, cy, halfWidth, height, 0, 0, TWO_PI);
  ctx.fillStyle = open > MOUTH_TEETH_THRESHOLD ? MOUTH_INNER : mix(SKIN.shadow, OUTLINE, 0.55);
  ctx.fill();

  if (open > MOUTH_TEETH_THRESHOLD) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(centre, cy, halfWidth, height, 0, 0, TWO_PI);
    ctx.clip();
    ctx.fillStyle = TOOTH;
    ctx.fillRect(centre - halfWidth, cy - height, halfWidth * 2, height * TEETH_SHARE);
    ctx.restore();
  }
}

const MOUTH_HALF_WIDTH = HEAD_RX * 0.42;
const MOUTH_CLOSED_HEIGHT = HEAD_RY * 0.05;
const MOUTH_OPEN_HEIGHT = HEAD_RY * 0.28;
const MOUTH_TEETH_THRESHOLD = 0.3;
const TEETH_SHARE = 0.5;

/** Draw the head in head-local space: origin at its centre, `toward` is +X. */
function drawHead(ctx: Ctx, pose: CarlPose, view: ViewSpec, toward: number): void {
  const profile = view.profile;

  if (view.showsBack) {
    traceSkull(ctx, false, toward);
    ctx.fillStyle = SKIN.mid;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_BLEED * 1.5;
    ctx.fill();
    ctx.stroke();
    // Ears are the only thing that keeps a back-of-head from reading as a ball.
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * HEAD_RX * 0.98, EAR_Y, EAR_RX, EAR_RY, 0, 0, TWO_PI);
      ctx.fillStyle = SKIN.dark;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = OUTLINE_BLEED;
      ctx.fill();
      ctx.stroke();
    }
    drawHair(ctx, false, toward, pose.hairFlow, true);
    return;
  }

  // The head casts onto the neck. Without it the two run together into one
  // column of skin at tile size, and the jawline stops existing.
  ctx.beginPath();
  ctx.ellipse(
    0,
    HEAD_RY * NECK_SHADOW_Y,
    HEAD_RX * NECK_SHADOW_RX,
    HEAD_RY * NECK_SHADOW_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fillStyle = rgba(SKIN.shadow, NECK_SHADOW_ALPHA);
  ctx.fill();

  // Far ear first, so the skull covers where it meets the head.
  if (!profile) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * HEAD_RX * 0.96, EAR_Y, EAR_RX, EAR_RY, 0, 0, TWO_PI);
      ctx.fillStyle = SKIN.dark;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = OUTLINE_BLEED;
      ctx.fill();
      ctx.stroke();
    }
  }

  traceSkull(ctx, profile, toward);
  ctx.fillStyle = SKIN.mid;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_BLEED * 1.5;
  ctx.fill();
  ctx.stroke();

  ctx.save();
  traceSkull(ctx, profile, toward);
  ctx.clip();
  ctx.fillStyle = rgba(SKIN.shadow, CLOTH_SHADE_ALPHA * 0.8);
  ctx.fillRect(HEAD_RX * SHADE_START, -HEAD_RY * 1.3, HEAD_RX * 2, HEAD_RY * 3);
  ctx.fillStyle = rgba(SKIN.light, SHEEN_ALPHA);
  ctx.beginPath();
  ctx.ellipse(-HEAD_RX * 0.38, -HEAD_RY * 0.35, HEAD_RX * 0.4, HEAD_RY * 0.34, deg(-18), 0, TWO_PI);
  ctx.fill();
  // Stubble: a jaw-shaped wash, the one thing that stops him reading as a boy.
  ctx.fillStyle = rgba(HAIR.dark, STUBBLE_ALPHA);
  ctx.beginPath();
  ctx.ellipse(0, HEAD_RY * 0.66, HEAD_RX * 0.86, HEAD_RY * 0.42, 0, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, HEAD_RY * 0.42, HEAD_RX * 0.34, HEAD_RY * 0.14, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  if (profile) {
    ctx.beginPath();
    ctx.ellipse(
      -HEAD_DEPTH * PROFILE_EAR_X * toward,
      EAR_Y,
      EAR_RX * 0.8,
      EAR_RY * 0.8,
      0,
      0,
      TWO_PI,
    );
    ctx.fillStyle = SKIN.mid;
    ctx.strokeStyle = rgba(SKIN.shadow, EAR_LINE_ALPHA);
    ctx.lineWidth = OUTLINE_BLEED;
    ctx.fill();
    ctx.stroke();

    drawBrow(ctx, HEAD_DEPTH * 0.62 * toward, BROW_Y, toward, pose.brow);
    drawEye(ctx, HEAD_DEPTH * 0.66 * toward, EYE_Y, toward * 0.4, pose.blink, pose.brow);
    drawMouth(ctx, HEAD_DEPTH * 0.72 * toward, MOUTH_Y, pose.mouth, true, toward);
  } else {
    const look = pose.headTurn;
    for (const side of [-1, 1]) {
      drawBrow(ctx, side * EYE_DX, BROW_Y, side, pose.brow);
      drawEye(ctx, side * EYE_DX, EYE_Y, look, pose.blink, pose.brow);
    }
    // The nose is a shadow wedge and two nostrils; a drawn nose reads as a beak.
    ctx.fillStyle = rgba(SKIN.shadow, NOSE_ALPHA);
    ctx.beginPath();
    ctx.moveTo(-NOSE_HALF, NOSE_Y + NOSE_LENGTH);
    ctx.quadraticCurveTo(0, NOSE_Y - NOSE_LENGTH, NOSE_HALF, NOSE_Y + NOSE_LENGTH);
    ctx.quadraticCurveTo(0, NOSE_Y + NOSE_LENGTH * 1.5, -NOSE_HALF, NOSE_Y + NOSE_LENGTH);
    ctx.closePath();
    ctx.fill();
    drawMouth(ctx, 0, MOUTH_Y, pose.mouth, false, toward);
  }

  drawHair(ctx, profile, toward, pose.hairFlow, false);
}

const PROFILE_EAR_X = 0.16;
const EAR_LINE_ALPHA = 0.7;
/** Big enough to clear the hair beside them; smaller and the ears vanish. */
const NECK_SHADOW_Y = 1.22;
const NECK_SHADOW_RX = 0.62;
const NECK_SHADOW_RY = 0.3;
const NECK_SHADOW_ALPHA = 0.55;

const EAR_RX = HEAD_RX * 0.26;
const EAR_RY = HEAD_RY * 0.3;
const NOSE_ALPHA = 0.6;
const NOSE_HALF = HEAD_RX * 0.17;
const NOSE_LENGTH = HEAD_RY * 0.2;

// ── Figure ───────────────────────────────────────────────────────────────────

const SHADOW_RX = 0.36;
const SHADOW_RY = 0.13;
/** A figure in the air casts a smaller, fainter shadow. */
const SHADOW_LIFT_FADE = 1.6;

/** The jacket is full-sleeved: the leather runs past the elbow to the wrist. */
const SLEEVE_END = 1.86;
/** The far-side limbs sit in the body's shade so the near ones read forward. */
const FAR_LIMB_SHADE = 0.32;

function legPaint(shade: number): LimbPaint {
  return { ramp: SKIN, clothedTo: 0, clothRamp: null, clothBulk: 0, shade };
}

function armPaint(shade: number): LimbPaint {
  return {
    ramp: SKIN,
    clothedTo: SLEEVE_END,
    clothRamp: LEATHER,
    clothBulk: SLEEVE_BULK,
    shade: shade + SLEEVE_SHADE,
  };
}

/** Keeps the sleeve reading as its own panel against the chest. */
const SLEEVE_SHADE = 0.16;

/**
 * A hand does not take the full angle of its forearm. The wrist holds it close
 * to the line of the arm as a whole, which is why a walking figure's hands read
 * as rigid while the forearm swings under them — following the forearm outright
 * gives him waving hands, which nobody walks with. On a straight limb the two
 * directions coincide, so a punch is unaffected.
 */
function wristAngle(chain: BoneChain): number {
  const alongArm = angleBetween(chain.root, chain.end);
  const alongForearm = angleBetween(chain.joint, chain.end);
  return lerp(alongArm, alongForearm, WRIST_FOLLOW);
}

const WRIST_FOLLOW = 0.3;

/**
 * Edge-on the arm is the only part of him with any depth to show, and it is the
 * part the shoved-up sleeves are there to display, so it is drawn heavier than
 * the head-on arm rather than at one width for every view.
 */
function armShapeFor(profile: boolean): LimbShape {
  if (!profile) return ARM_SHAPE;
  return {
    root: ARM_SHAPE.root * PROFILE_ARM_GIRTH,
    joint: ARM_SHAPE.joint * PROFILE_ARM_GIRTH,
    belly: ARM_SHAPE.belly * PROFILE_ARM_GIRTH * PROFILE_BICEP_SWELL,
    tip: ARM_SHAPE.tip * PROFILE_ARM_GIRTH,
    bellyAt: ARM_SHAPE.bellyAt,
  };
}

const PROFILE_ARM_GIRTH = 1.2;
/** The forearm's belly swells a little further, which is where the mass reads. */
const PROFILE_BICEP_SWELL = 1.12;

/** `thumbSide` is +1 for the figure's right hand and −1 for its left. */
function drawArm(
  ctx: Ctx,
  chain: BoneChain,
  fist: number,
  shade: number,
  thumbSide: number,
  profile: boolean,
): void {
  drawLimb(ctx, chain, armShapeFor(profile), armPaint(shade));
  drawHand(ctx, chain.end, wristAngle(chain), fist, shade, thumbSide);
}

/**
 * `outward` is +1 for the figure's right foot and −1 for its left.
 *
 * No depth shade, in any view: bare skin reads as one colour or as two
 * different ones, with no subtle middle, and a darkened far leg just looks like
 * his legs are painted differently. Edge-on the outline separates them.
 */
function drawLeg(
  ctx: Ctx,
  chain: BoneChain,
  pitch: number,
  view: ViewSpec,
  outward: number,
  nearness: number,
): void {
  drawLimb(ctx, chain, legShapeFor(nearness), legPaint(UNSHADED));
  drawFoot(ctx, chain.end, pitch, view, outward, UNSHADED);
}

/** Painted at its own ramp, with nothing mixed toward the outline. */
const UNSHADED = 0;

/** Rim light along the figure's right edge, unifying the parts into one body. */
function drawRimLight(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  ctx.save();
  ctx.globalAlpha = RIM_ALPHA;
  ctx.strokeStyle = RIM_LIGHT;
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineCap = 'round';
  const half = (skeleton.shoulderHalf + JACKET_SHOULDER_PAD * view.girth) * view.chestTaper;
  ctx.beginPath();
  ctx.moveTo(skeleton.shoulderCentre.x + half, skeleton.shoulderCentre.y);
  ctx.quadraticCurveTo(
    skeleton.chest.x + half * SHOULDER_BULGE,
    skeleton.chest.y,
    skeleton.waist.x + half * JACKET_WAIST_PINCH,
    skeleton.waist.y + JACKET_HEM_DROP,
  );
  ctx.stroke();
  ctx.restore();
}

const RIM_WIDTH = 0.017;

function drawFigure(ctx: Ctx, view: ViewSpec, pose: CarlPose, toward: number): void {
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

  // The figure's left side is the far one. Seen edge-on that arm is genuinely
  // behind the torso; head-on it hangs in front of the jacket like the near one
  // does, and drawing it early is what made him look one-armed.
  // Head-on, neither arm is behind anything, so neither is shaded — the same
  // rule the legs follow. A shade there paints one hand a different colour of
  // skin from the other, and from his bare legs.
  const farArmShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  const leftBehind = view.profile || pose.leftArmBehind;
  const rightBehind = !view.profile && pose.rightArmBehind;
  if (leftBehind)
    drawArm(ctx, skeleton.leftArm, pose.leftFist, farArmShade, LEFT_THUMB, view.profile);
  if (rightBehind)
    drawArm(ctx, skeleton.rightArm, pose.rightFist, farArmShade, RIGHT_THUMB, view.profile);
  drawLeg(ctx, skeleton.leftLeg, pose.leftFootPitch, view, LEFT_FOOT_OUT, pose.leftLegNearness);
  drawLeg(ctx, skeleton.rightLeg, pose.rightFootPitch, view, RIGHT_FOOT_OUT, pose.rightLegNearness);
  drawShorts(
    ctx,
    skeleton.hip,
    HIP_HALF * view.girth * view.hipDepth,
    pose.jacketFlare,
    view.showsBack,
    view.crotchNotch,
    { left: skeleton.leftLeg, right: skeleton.rightLeg },
  );
  fillCapsule(
    ctx,
    skeleton.shoulderCentre,
    offset(skeleton.headCentre, 0, HEAD_RY * 0.6),
    NECK_WIDTH * view.girth,
    NECK_WIDTH * view.girth * 0.85,
    SKIN.dark,
  );
  drawJacket(ctx, skeleton, pose, view);
  drawRimLight(ctx, skeleton, view);

  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(pose.headTilt + pose.lean * HEAD_LEAN_FOLLOW);
  drawHead(ctx, pose, view, toward);
  ctx.restore();

  if (!leftBehind)
    drawArm(ctx, skeleton.leftArm, pose.leftFist, farArmShade, LEFT_THUMB, view.profile);
  if (!rightBehind) drawArm(ctx, skeleton.rightArm, pose.rightFist, 0, RIGHT_THUMB, view.profile);
}

/** Feet turn outward, away from the centreline, on both sides. */
const LEFT_FOOT_OUT = -1;
const RIGHT_FOOT_OUT = 1;

/** Thumbs face inboard, toward the body, on both hands. */
const LEFT_THUMB = -1;
const RIGHT_THUMB = 1;

const SHADOW_FOLLOW = 0.6;
const SHADOW_LIFT_SHRINK = 0.55;
/**
 * How much of the torso's lean the head copies. Near 1 the head buries itself
 * in the shoulders on any leaning pose, which is what turned the punch into a
 * hunch; a head that stays level keeps the figure reading upright.
 */
const HEAD_LEAN_FOLLOW = 0.25;

/** Carl seen head-on, walking toward the camera. */
export function drawCarlFront(ctx: Ctx, pose: CarlPose): void {
  drawFigure(ctx, VIEWS.front, pose, 1);
}

/** Carl seen from behind, walking away. */
export function drawCarlBack(ctx: Ctx, pose: CarlPose): void {
  drawFigure(ctx, VIEWS.back, pose, 1);
}

/** Carl in profile. Always drawn facing +X; the runtime mirrors for the left. */
export function drawCarlSide(ctx: Ctx, pose: CarlPose): void {
  drawFigure(ctx, VIEWS.side, pose, 1);
}
