/**
 * Drawing engine for the Skeleton Lord and the two skeleton warriors that
 * escort him.
 *
 * One bone rig paints all three variants — the goblin precedent, where a single
 * engine draws a family that has to look related. What differs between them is
 * scale, gear and how much of the skeleton is covered: the lord is a head
 * taller, robed, crowned and lit from inside; the sword and archer warriors are
 * bare bone with scavenged kit.
 *
 * A skeleton only reads as bones if the **negative space** reads. Everything
 * here is built to protect it:
 *
 *  - ribs are individual arcs with real gaps between them, never a filled shell;
 *  - the forearm is two bones (radius and ulna) with an interosseous gap that
 *    closes toward the wrist, not one tapering stick;
 *  - the pelvis is assembled from blades and rami so the obturator holes are
 *    genuine transparency rather than painted-on dark patches;
 *  - joints are condyle *knobs* on either end of a narrower shaft, so a knee is
 *    a widening-narrowing-widening rhythm instead of a smooth bend.
 *
 * The figure is built by IK/FK into a joint set and then painted over those
 * joints, so a limb cannot come apart however far a pose throws it. Three
 * viewpoints are drawn — `front` (toward the camera), `back` (away) and `side`
 * (profile, always facing +X so the runtime can mirror it) — and all three read
 * the same {@link SkeletonPose}. The choreography that fills that pose lives in
 * `scripts/generate-skeleton-sprites.ts`.
 *
 * Coordinates are tile units with the origin at the point between the feet and
 * +Y pointing down the screen, so heights above the ground are negative. The
 * caller translates to that ground point and scales by one tile before calling
 * a painter, exactly as the llama's and Carl's painters expect.
 *
 * Light comes from the upper left, matching every other prop in the repo. The
 * witch-light is the one exception: it is emitted, so it lights the bone around
 * it from wherever it happens to sit.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

export const TWO_PI = Math.PI * 2;
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

/**
 * Alpha below which a colour is dropped entirely.
 *
 * node-canvas serialises a very small computed alpha in exponent notation
 * (`5e-17`), fails to parse it back, and discards the whole `rgba()` — which
 * bakes as an opaque smear rather than as nothing at all.
 */
const MIN_VISIBLE_ALPHA = 0.002;

/** A hex colour re-expressed with an alpha. */
export function rgba(hex: string, alpha: number): string {
  if (alpha < MIN_VISIBLE_ALPHA) return 'rgba(0, 0, 0, 0)';
  const c = hexToRgb(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

/** Bone is never outlined in black — a warm near-black keeps it from going flat. */
const OUTLINE = '#17130e';

/** Old, dry, slightly stained bone. Warmer than fresh bone and far less white. */
const BONE: Ramp = {
  shadow: '#6d6249',
  dark: '#948663',
  mid: '#c3b691',
  light: '#e2d8b8',
  rim: '#f5eed6',
};

/** The lord's robe: rotted black wool with a cold blue-green cast in the folds. */
const ROBE: Ramp = {
  shadow: '#10141a',
  dark: '#1c232b',
  mid: '#2b343e',
  light: '#3c4a55',
  rim: '#57696f',
};

/**
 * Rusted, pitted scrap iron — the warriors' sword, shield boss and buckles.
 *
 * Pale enough to separate from the wood beside it: at the first pass the blade
 * and the shield's planks sat within a few values of each other and the sword
 * read as a club.
 */
const IRON: Ramp = {
  shadow: '#2b211b',
  dark: '#584a41',
  mid: '#8b8177',
  light: '#aca396',
  rim: '#d5cec2',
};

/** Bow stave, arrow shafts and the quiver's hide. */
const WOOD: Ramp = {
  shadow: '#231710',
  dark: '#3c2818',
  mid: '#5b3f26',
  light: '#7b5836',
  rim: '#9c7549',
};

/** Witch-light: cold, sick green. The family resemblance across all three. */
const WITCH_CORE = '#eaffe4';
const WITCH_BRIGHT = '#8dff7a';
const WITCH_MID = '#3fd14f';
const WITCH_DEEP = '#12702f';

/** The near-black inside an orbit, a nasal aperture or a mouth. */
const CAVITY = '#0c0b09';

/** Cool bounce light along the right-hand edge of every form. */
const RIM_LIGHT = '#dfe6cf';
const RIM_ALPHA = 0.24;
const SHEEN_ALPHA = 0.3;
const CONTACT_SHADOW_ALPHA = 0.38;

/** Unit vector the key light arrives from, in figure space. */
const LIGHT: Pt = { x: -0.62, y: -0.78 };

// ── Proportions ──────────────────────────────────────────────────────────────
// Heights are y values, so they are negative: the origin sits between the feet
// and the screen's +Y runs down. The rig is authored at a single height and the
// generator scales each variant at bake time — scaling the proportion table
// instead would silently redraw the choreography and the gear along with it.

/**
 * Standing height, top of skull to ground, and the head that height divides
 * into. Slightly leaner than Carl's 4.8: a skull is smaller than a haired head,
 * and a skeleton that keeps Carl's head fraction reads as a bobblehead. It is
 * still far under a life-drawing seven, because at a 32 px tile a correctly
 * proportioned skull is four pixels of mush.
 */
export const FIGURE_HEIGHT = 2.03;
const HEADS_TALL = 5.1;
const HEAD_HEIGHT = FIGURE_HEIGHT / HEADS_TALL;

/**
 * Slack so a planted leg is not mathematically locked straight. It has to stay
 * tiny: a joint's sideways travel grows as the square root of it, and head-on a
 * knee should read as the leg *narrowing*, not as an angle in it.
 */
const LEG_SLACK = 1.004;
const JOINT_SLACK = 0.0003;

const ANKLE_Y = -0.075;
const KNEE_Y = -0.55;
const HIP_Y = -FIGURE_HEIGHT / 2;
const WAIST_Y = -1.19;
export const SHOULDER_Y = -1.62;
const HEAD_CENTRE_Y = -1.85;

const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * LEG_SLACK;
const SHIN_LENGTH = Math.abs(KNEE_Y - ANKLE_Y) * LEG_SLACK;
export const UPPER_ARM_LENGTH = 0.35;
export const FOREARM_LENGTH = 0.31;
/** Shoulder to wrist. A relaxed arm hangs at very nearly this. */
export const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

/**
 * A skeleton's shoulders are its clavicle span and nothing else — there is no
 * deltoid on them — so they are narrower than a living figure's and the arms
 * hang further from the ribs, which is most of what makes the silhouette read
 * as gaunt.
 */
const SHOULDER_HALF = 0.235;
const FACING_SHOULDER_SPREAD = 1.12;
const LEG_ROOT_HALF = 0.098;
/** Where the arms root, in from the clavicle tip. */
const ARM_INSET = 0.94;
export const ARM_ROOT_HALF = SHOULDER_HALF * ARM_INSET;
/** The arm's root hangs this far below the shoulder line, not on it. */
export const SHOULDER_JOINT_DROP = 0.05;

// Bone widths. Every one of these is a *shaft* width; the knobs at either end
// are separate and wider, which is the whole reason a joint reads as a joint.
const FEMUR_WIDTH = 0.045;
const TIBIA_WIDTH = 0.036;
const FEMUR_KNOB = 0.062;
const KNEE_KNOB = 0.052;
const ANKLE_KNOB = 0.038;
const HUMERUS_WIDTH = 0.033;
const FOREARM_BONE_WIDTH = 0.019;
const SHOULDER_KNOB = 0.044;
const ELBOW_KNOB = 0.04;
const WRIST_KNOB = 0.03;
/**
 * Gap between radius and ulna at the elbow, closing to nothing at the wrist.
 * This is the single most important piece of negative space on the figure: one
 * tapered stick here and the whole arm reads as a twig rather than as bone.
 */
const INTEROSSEOUS_GAP = 0.046;

const RIB_COUNT = 7;
const RIB_TOP_Y = -1.53;
const RIB_BOTTOM_Y = -1.2;
const RIB_WIDTH = 0.021;
/** Half-width of the ribcage at its widest, and the fractions above and below it. */
const RIBCAGE_HALF = 0.185;
const RIBCAGE_TOP_FRACTION = 0.62;
const RIBCAGE_BOTTOM_FRACTION = 0.7;
/** Where down the cage the widest rib sits, 0 at the top rib. */
const RIBCAGE_WIDEST_AT = 0.45;
/** How far a rib sags below the vertebra it springs from. */
const RIB_DROP = 0.055;

const SPINE_WIDTH = 0.036;
const VERTEBRA_COUNT = 11;

const PELVIS_HALF = 0.15;
const PELVIS_TOP_Y = -1.08;
const PELVIS_BOTTOM_Y = -0.9;
const ILIAC_WIDTH = 0.046;
const RAMUS_WIDTH = 0.026;

/**
 * Head-on the skull is a tall oval, not a ball, and in profile it is deeper than
 * it is wide — two radii, never one. A round skull makes the mandible under it
 * read as blocky however narrow the jaw is drawn.
 */
const SKULL_WIDTH_RATIO = 0.76;
const SKULL_DEPTH_RATIO = 1.14;
const SKULL_RY = HEAD_HEIGHT / 2;
const SKULL_RX = SKULL_RY * SKULL_WIDTH_RATIO;
const SKULL_DEPTH = SKULL_RY * SKULL_DEPTH_RATIO;
const NECK_TOP_Y = HEAD_CENTRE_Y + SKULL_RY * 0.6;
/** Where the cranium's underside is, and so where the spine has to end. */
const SKULL_BASE_Y = HEAD_CENTRE_Y + SKULL_RY * 0.74;

/**
 * Extra reach the ribs get edge-on.
 *
 * A chest is nearly as deep as it is wide, and `girth` alone leaves the profile
 * cage sweeping less than a tenth of a tile off the spine — at which point the
 * trunk reads as a bare backbone, and the one piece of negative space the whole
 * design rests on is missing from the view the mob spends a chase in.
 */
const PROFILE_RIB_REACH = 1.55;
/** Likewise the pelvis, which stays deep front-to-back as it narrows across. */
const PROFILE_PELVIS_REACH = 1.35;

/** Side-on, the limbs gather toward the centreline instead of splaying wide. */
const PROFILE_LATERAL = 0.3;
const PROFILE_GIRTH = 0.82;
const PROFILE_ARM_SPREAD = 0.12;

// ── Views ────────────────────────────────────────────────────────────────────

export type SkeletonView = 'front' | 'back' | 'side';

interface ViewSpec {
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
  /**
   * Multiplier on the drawn width of the ribcage, pelvis and robe. A body is
   * nearly as deep as it is wide, so edge-on the trunk stays broad even though
   * the limbs gather onto the centreline.
   */
  readonly girth: number;
  /**
   * How far apart the two shoulder joints are drawn. Edge-on they are almost
   * the same point; at full half-width the arms angle inward across the chest.
   */
  readonly armSpread: number;
  /** True when the figure is seen edge-on rather than head-on. */
  readonly profile: boolean;
  /** True when the face — orbits, nasal aperture, teeth — is toward the camera. */
  readonly showsFace: boolean;
  /** True when the occiput and the spine's own column are shown. */
  readonly showsBack: boolean;
}

const VIEWS: Record<SkeletonView, ViewSpec> = {
  front: {
    lateral: 1,
    girth: 1,
    armSpread: 1,
    profile: false,
    showsFace: true,
    showsBack: false,
  },
  back: {
    lateral: 1,
    girth: 1,
    armSpread: 1,
    profile: false,
    showsFace: false,
    showsBack: true,
  },
  side: {
    lateral: PROFILE_LATERAL,
    girth: PROFILE_GIRTH,
    armSpread: PROFILE_ARM_SPREAD,
    profile: true,
    showsFace: true,
    showsBack: false,
  },
};

// ── Variants ─────────────────────────────────────────────────────────────────

export type SkeletonVariant = 'lord' | 'sword' | 'archer';

interface VariantSpec {
  /** Draws a robe, a cowl and a crown, and burns witch-light in its ribs. */
  readonly robed: boolean;
  /** Baseline witch-light even when a pose asks for none — the lord always glows. */
  readonly ambientGlow: number;
  /**
   * How much of that light burns *inside the ribcage*, separately from the
   * orbits.
   *
   * It has to be nearly nothing on the warriors. The gaps between the ribs are
   * the whole read of a ribcage, and a glow behind them fills every one of those
   * gaps with opaque green — the cage stops being a cage and becomes a lamp.
   * Only the lord can afford it, because on him it is the point.
   */
  readonly ribLight: number;
  /** Bone tone shift: the warriors are more weathered than their master. */
  readonly boneStain: number;
}

const VARIANTS: Record<SkeletonVariant, VariantSpec> = {
  lord: { robed: true, ambientGlow: 0.55, ribLight: 0.7, boneStain: 0 },
  sword: { robed: false, ambientGlow: 0.22, ribLight: 0.1, boneStain: 0.3 },
  archer: { robed: false, ambientGlow: 0.22, ribLight: 0.1, boneStain: 0.42 },
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
 * One frame of a skeleton. Hand and foot positions are targets in figure space
 * that the limb solver reaches for, so the choreography never has to think about
 * joint angles — except for walking arms, which must be driven from
 * {@link ArmAngles} or the forearm flails.
 *
 * `left`/`right` are the figure's own left and right; in the profile view the
 * right side is the near one, closest to the camera.
 */
export interface SkeletonPose {
  /** Whole-body vertical offset; negative lifts it off the ground. */
  bob: number;
  /** Hip shift along X — weight transfer, not a step. */
  sway: number;
  /** Torso lean in radians; positive tips the shoulders toward +X. */
  lean: number;
  /** 0 stands tall, 1 sinks into a deep crouch. */
  crouch: number;
  /** Shoulder rotation about the spine, −1 to 1, seen as a width shift. */
  twist: number;
  /** Head turn, −1 to 1; in the head-on views it slides the skull across. */
  headTurn: number;
  /** Head tilt in radians. */
  headTilt: number;
  /** 0 shut, 1 a full gape. A skeleton has no lips, so this is the whole face. */
  jaw: number;
  leftHand: Pt;
  rightHand: Pt;
  leftFoot: Pt;
  rightFoot: Pt;
  /** 0 curled into a fist, 1 splayed into a claw, per hand. */
  leftClaw: number;
  rightClaw: number;
  /** Foot pitch in radians; positive points the toes down. */
  leftFootPitch: number;
  rightFootPitch: number;
  /** +1 bows a knee away from the centreline, −1 folds it up in front. */
  leftKneeBreak: number;
  rightKneeBreak: number;
  /** Pulls a knee onto the hip→ankle line; 1 on every leg of a head-on pose. */
  leftForeshorten: number;
  rightForeshorten: number;
  /** Elbows bow away from the ribs at 1, in toward them at −1. */
  elbowFlare: number;
  /** Drives an arm from joint angles instead of a hand target. Wins when set. */
  leftArmAngles: ArmAngles | null;
  rightArmAngles: ArmAngles | null;
  /** Whether an arm is behind the trunk and so drawn before it. Head-on only. */
  leftArmBehind: boolean;
  rightArmBehind: boolean;
  /** How far the robe hem kicks out from the legs, 0 to 1. Lord only. */
  robeFlare: number;
  /** Lateral drift of the hem, −1 to 1, so the robe trails the movement. */
  robeSway: number;
  /** Witch-light in the orbits and between the ribs, 0 to 1, over the ambient. */
  glow: number;
  /** A soul orb condensing at the palm, per hand, 0 to 1. */
  leftPalmGlow: number;
  rightPalmGlow: number;
  /**
   * How far below the ground line the whole figure sits, in tile units.
   * Everything under the ground line is clipped away and a broken-earth mound is
   * painted at it, which is what makes the `rise` row read as climbing out of a
   * grave rather than as sliding up behind a wall.
   */
  sink: number;
  /** Free-running phase for details with a life of their own. */
  time: number;
}

const RESTING_HAND_DROP = SHOULDER_JOINT_DROP + ARM_LENGTH * 0.99;
const RESTING_HAND_SPREAD = 0.3;
const RESTING_FOOT_SPREAD = 0.115;

/** A relaxed standing pose. Every animation is written as edits to this. */
export function restingPose(): SkeletonPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    crouch: 0,
    twist: 0,
    headTurn: 0,
    headTilt: 0,
    jaw: 0.12,
    leftHand: pt(-RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    rightHand: pt(RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    leftFoot: pt(-RESTING_FOOT_SPREAD, 0),
    rightFoot: pt(RESTING_FOOT_SPREAD, 0),
    leftClaw: 0.55,
    rightClaw: 0.55,
    leftFootPitch: 0,
    rightFootPitch: 0,
    leftKneeBreak: 1,
    rightKneeBreak: 1,
    leftForeshorten: 0,
    rightForeshorten: 0,
    elbowFlare: 0.3,
    leftArmAngles: null,
    rightArmAngles: null,
    leftArmBehind: false,
    rightArmBehind: false,
    robeFlare: 0.2,
    robeSway: 0,
    glow: 0,
    leftPalmGlow: 0,
    rightPalmGlow: 0,
    sink: 0,
    time: 0,
  };
}

// ── Skeleton solve ───────────────────────────────────────────────────────────

interface BoneChain {
  root: Pt;
  joint: Pt;
  end: Pt;
}

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

/** Forward kinematics for an arm: shoulder angle, then elbow angle. */
function armFromAngles(shoulder: Pt, angles: ArmAngles): BoneChain {
  const upper = rotate({ x: 0, y: UPPER_ARM_LENGTH }, -angles.upper);
  const joint = offset(shoulder, upper.x, upper.y);
  const fore = rotate({ x: 0, y: FOREARM_LENGTH * angles.foreScale }, -angles.fore);
  return { root: shoulder, joint, end: offset(joint, fore.x, fore.y) };
}

/** Where the knee falls along a straight, unbent leg. */
const KNEE_ALONG_LEG = THIGH_LENGTH / (THIGH_LENGTH + SHIN_LENGTH);

function foreshortenLeg(chain: BoneChain, amount: number): BoneChain {
  if (amount <= 0) return chain;
  const straightKnee = mixPt(chain.root, chain.end, KNEE_ALONG_LEG);
  return { ...chain, joint: mixPt(chain.joint, straightKnee, clamp01(amount)) };
}

interface Rig {
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
const TWIST_WIDTH_GAIN = 0.16;
const TWIST_SHOULDER_SHIFT = 0.06;

/** Offset from the hip to a point `height` up the leaning spine. */
function spinePoint(hip: Pt, height: number, lean: number): Pt {
  const rotated = rotate({ x: 0, y: -height }, lean);
  return offset(hip, rotated.x, rotated.y);
}

/** The ankle for a foot planted at `target`: up the leg by the foot's height. */
function ankleFor(target: Pt, pitch: number): Pt {
  const lifted = rotate({ x: 0, y: ANKLE_Y }, -pitch);
  return offset(target, lifted.x, lifted.y);
}

function elbowBend(flare: number): number {
  return flare < 0 ? -1 : 1;
}

function buildRig(pose: SkeletonPose, view: ViewSpec): Rig {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);

  const waist = spinePoint(hip, Math.abs(WAIST_Y - HIP_Y), pose.lean);
  const chest = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y) * 0.72, pose.lean);
  const shoulderCentre = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y), pose.lean);
  const neck = spinePoint(hip, Math.abs(NECK_TOP_Y - HIP_Y), pose.lean);
  const headCentre = offset(
    spinePoint(hip, Math.abs(HEAD_CENTRE_Y - HIP_Y), pose.lean),
    pose.headTurn * SKULL_RX * view.lateral * 0.5,
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
    // hinge one knee backward, so in profile both break forward instead.
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
const OUTLINE_BLEED = 0.011;

function outlineCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  fillCapsule(ctx, a, b, wa + OUTLINE_BLEED, wb + OUTLINE_BLEED, OUTLINE);
}

function fillDisc(ctx: Ctx, centre: Pt, radius: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, TWO_PI);
  ctx.fillStyle = fill;
  ctx.fill();
}

function outlineDisc(ctx: Ctx, centre: Pt, radius: number): void {
  fillDisc(ctx, centre, radius + OUTLINE_BLEED, OUTLINE);
}

const SHEEN_OFFSET = 0.42;
const SHEEN_WIDTH = 0.34;
const SHEEN_TAPER = 0.7;

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

/**
 * One long bone: a narrow shaft between two wider condyle knobs.
 *
 * The knobs are what make a joint read at tile size. Drawn as a plain taper the
 * same limb is a twig, and no amount of shading rescues it — the shape has to
 * say "wide, narrow, wide" before any pixel of detail lands on it.
 */
function paintLongBone(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  shaftWidth: number,
  rootKnob: number,
  tipKnob: number,
  ramp: Ramp,
  shade: number,
): void {
  const mid = mixPt(from, to, 0.5);
  outlineDisc(ctx, from, rootKnob);
  outlineDisc(ctx, to, tipKnob);
  outlineCapsule(ctx, from, to, shaftWidth, shaftWidth);

  const body = shade > 0 ? mix(ramp.mid, ramp.shadow, shade) : ramp.mid;
  const highlight = shade > 0 ? mix(ramp.light, ramp.dark, shade) : ramp.light;
  fillCapsule(ctx, from, to, shaftWidth, shaftWidth, body);
  fillDisc(ctx, from, rootKnob, body);
  fillDisc(ctx, to, tipKnob, body);

  // A shaft is a tube, so the light runs as a stripe down one side of it rather
  // than pooling at the ends the way it does on the knobs.
  sheenSegment(ctx, from, mid, shaftWidth, highlight, SHEEN_ALPHA);
  const KNOB_HIGHLIGHT_OFFSET = 0.35;
  fillDisc(
    ctx,
    offset(
      from,
      LIGHT.x * rootKnob * KNOB_HIGHLIGHT_OFFSET,
      LIGHT.y * rootKnob * KNOB_HIGHLIGHT_OFFSET,
    ),
    rootKnob * 0.52,
    rgba(highlight, SHEEN_ALPHA),
  );
  fillDisc(
    ctx,
    offset(
      to,
      LIGHT.x * tipKnob * KNOB_HIGHLIGHT_OFFSET,
      LIGHT.y * tipKnob * KNOB_HIGHLIGHT_OFFSET,
    ),
    tipKnob * 0.52,
    rgba(highlight, SHEEN_ALPHA),
  );
}

/**
 * A soft emitted glow. Radial gradients only — `shadowBlur` is banned in this
 * repo's generators because node-canvas renders it inconsistently and it costs
 * an order of magnitude more per frame than a gradient does.
 */
function paintGlow(ctx: Ctx, centre: Pt, radius: number, intensity: number): void {
  const strength = clamp01(intensity);
  if (strength < MIN_VISIBLE_ALPHA || radius <= 0) return;
  const gradient = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius);
  gradient.addColorStop(0, rgba(WITCH_CORE, 0.95 * strength));
  gradient.addColorStop(0.28, rgba(WITCH_BRIGHT, 0.7 * strength));
  gradient.addColorStop(0.6, rgba(WITCH_MID, 0.32 * strength));
  gradient.addColorStop(1, rgba(WITCH_DEEP, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, TWO_PI);
  ctx.fill();
}

// ── Body parts ───────────────────────────────────────────────────────────────

interface PaintContext {
  readonly ctx: Ctx;
  readonly pose: SkeletonPose;
  readonly view: ViewSpec;
  readonly rig: Rig;
  /** Ambient plus posed witch-light, already combined. */
  readonly glow: number;
  /** The share of that light allowed to burn behind the ribs. */
  readonly ribLight: number;
  readonly bone: Ramp;
}

function ribHalfAt(t: number): number {
  // Two eased legs either side of the widest rib, so the cage swells and tucks
  // rather than tapering in one straight line from the shoulders to the waist.
  if (t <= RIBCAGE_WIDEST_AT) {
    const local = t / RIBCAGE_WIDEST_AT;
    return RIBCAGE_HALF * lerp(RIBCAGE_TOP_FRACTION, 1, easeInOut(local));
  }
  const local = (t - RIBCAGE_WIDEST_AT) / (1 - RIBCAGE_WIDEST_AT);
  return RIBCAGE_HALF * lerp(1, RIBCAGE_BOTTOM_FRACTION, easeInOut(local));
}

/**
 * The ribcage, drawn rib by rib.
 *
 * Each rib is stroked, not filled, and the gap between successive ribs is a
 * fixed fraction of the cage's height — so the cage always reads as a cage. A
 * filled shell with painted-on lines is the classic failure here: at 32 px the
 * lines vanish and what is left is a white barrel.
 */
function paintRibcage(paint: PaintContext): void {
  const { ctx, rig, view, pose } = paint;
  const spineTop = spinePoint(rig.hip, Math.abs(RIB_TOP_Y - HIP_Y), pose.lean);
  const spineBottom = spinePoint(rig.hip, Math.abs(RIB_BOTTOM_Y - HIP_Y), pose.lean);
  const glowRadius = RIBCAGE_HALF * 1.3;

  // The light lives *inside* the cage, so it is laid down first and the ribs are
  // painted over it — which is what puts the bars in front of the fire.
  const insideLight = paint.glow * paint.ribLight;
  if (insideLight > 0) {
    // Edge-on the cage is entirely on the +X side of the spine, so a glow
    // centred on the spine puts half of itself outside the body — a green smear
    // hanging in the air beside the robe with nothing containing it. It moves
    // forward with the ribs and shrinks to stay under them.
    const forward = view.profile ? RIBCAGE_HALF * PROFILE_RIB_REACH * 0.45 : 0;
    const radius = view.profile ? glowRadius * 0.62 : glowRadius;
    paintGlow(ctx, offset(mixPt(spineTop, spineBottom, 0.55), forward, 0), radius, insideLight);
  }

  const sternumVisible = view.showsFace && !view.profile;

  for (let i = 0; i < RIB_COUNT; i++) {
    const t = i / (RIB_COUNT - 1);
    const anchor = mixPt(spineTop, spineBottom, t);
    const half = ribHalfAt(t) * view.girth * (view.profile ? PROFILE_RIB_REACH : 1);
    const drop = RIB_DROP * lerp(0.7, 1.25, t);

    for (const side of [-1, 1]) {
      // Edge-on both "sides" of a rib project onto the same C, so the far one is
      // skipped rather than drawn on top of the near one at a slight offset,
      // which reads as a doubled outline rather than as depth.
      if (view.profile && side < 0) continue;
      const sweep = view.profile ? 1 : side;
      const tipX = anchor.x + sweep * half * 0.62;
      const tipY = anchor.y + drop;
      const controlX = anchor.x + sweep * half * 1.16;
      const controlY = anchor.y + drop * 0.28;

      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.quadraticCurveTo(controlX, controlY, tipX, tipY);
      ctx.lineCap = 'round';
      ctx.lineWidth = RIB_WIDTH * 2 + OUTLINE_BLEED * 2;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.lineWidth = RIB_WIDTH * 2;
      ctx.strokeStyle = paint.bone.mid;
      ctx.stroke();
      ctx.lineWidth = RIB_WIDTH * 0.8;
      ctx.strokeStyle = rgba(paint.bone.light, SHEEN_ALPHA);
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y - RIB_WIDTH * 0.5);
      ctx.quadraticCurveTo(controlX, controlY - RIB_WIDTH * 0.5, tipX, tipY - RIB_WIDTH * 0.5);
      ctx.stroke();
    }
  }

  if (sternumVisible) {
    const sternumTop = mixPt(spineTop, spineBottom, 0.12);
    const sternumBottom = mixPt(spineTop, spineBottom, 0.78);
    const STERNUM_WIDTH = 0.026;
    outlineCapsule(ctx, sternumTop, sternumBottom, STERNUM_WIDTH, STERNUM_WIDTH * 0.7);
    fillCapsule(
      ctx,
      sternumTop,
      sternumBottom,
      STERNUM_WIDTH,
      STERNUM_WIDTH * 0.7,
      paint.bone.light,
    );
  }

  // Clavicles: the shelf the arms hang off. Without them the humerus roots in
  // mid-air beside the top rib and the shoulders read as dislocated.
  const clavicleY = mixPt(spineTop, rig.shoulderCentre, 0.5);
  const CLAVICLE_WIDTH = 0.02;
  for (const shoulder of [rig.leftShoulder, rig.rightShoulder]) {
    outlineCapsule(ctx, clavicleY, shoulder, CLAVICLE_WIDTH, CLAVICLE_WIDTH);
    fillCapsule(ctx, clavicleY, shoulder, CLAVICLE_WIDTH, CLAVICLE_WIDTH, paint.bone.light);
  }
}

/** The spine, drawn as a stack of discrete vertebrae with gaps between them. */
function paintSpine(paint: PaintContext): void {
  const { ctx, rig, pose } = paint;
  // Carried right up under the cranium. Stopped half a skull-radius short, the
  // topmost vertebra sits a quarter of a tile below the jaw and the head floats
  // — the single most obvious thing wrong with a profile skeleton.
  const top = spinePoint(rig.hip, Math.abs(SKULL_BASE_Y - HIP_Y), pose.lean);
  const VERTEBRA_HALF = SPINE_WIDTH * 0.5;
  for (let i = 0; i < VERTEBRA_COUNT; i++) {
    const t = i / (VERTEBRA_COUNT - 1);
    const centre = mixPt(rig.hip, top, t);
    // Vertebrae taper toward the skull, which is what stops the neck reading as
    // a length of the same pipe the lower back is made of.
    const radius = VERTEBRA_HALF * lerp(1, 0.62, t);
    outlineDisc(ctx, centre, radius);
    fillDisc(ctx, centre, radius, paint.bone.mid);
    fillDisc(ctx, offset(centre, -radius * 0.25, -radius * 0.25), radius * 0.45, paint.bone.light);
  }
}

/**
 * The pelvis, assembled from separate blades and rami rather than filled as one
 * mass — the two obturator holes are actual transparency, and they are most of
 * what says "pelvis" instead of "shorts".
 */
function paintPelvis(paint: PaintContext): void {
  const { ctx, rig, view, pose } = paint;
  const half = PELVIS_HALF * view.girth * (view.profile ? PROFILE_PELVIS_REACH : 1);
  const top = spinePoint(rig.hip, Math.abs(PELVIS_TOP_Y - HIP_Y), pose.lean);
  const bottom = spinePoint(rig.hip, Math.abs(PELVIS_BOTTOM_Y - HIP_Y), pose.lean);
  const centre = mixPt(top, bottom, 0.35);

  for (const side of [-1, 1]) {
    if (view.profile && side < 0) continue;
    const sweep = view.profile ? 1 : side;
    const wingTip = offset(top, sweep * half, -0.012);
    const socket = offset(bottom, sweep * half * 0.72, 0);
    const pubis = offset(bottom, sweep * half * 0.14, 0.018);

    // Iliac blade: broad at the crest, narrowing into the socket.
    outlineCapsule(ctx, wingTip, socket, ILIAC_WIDTH, ILIAC_WIDTH * 0.62);
    fillCapsule(ctx, wingTip, socket, ILIAC_WIDTH, ILIAC_WIDTH * 0.62, paint.bone.mid);
    sheenSegment(ctx, wingTip, socket, ILIAC_WIDTH, paint.bone.light, SHEEN_ALPHA);

    // Pubic ramus: the bar under the hole, running in to the symphysis.
    outlineCapsule(ctx, socket, pubis, RAMUS_WIDTH, RAMUS_WIDTH);
    fillCapsule(ctx, socket, pubis, RAMUS_WIDTH, RAMUS_WIDTH, paint.bone.dark);
  }

  // Sacrum, wedged between the blades and continuous with the spine above it.
  const SACRUM_WIDTH = 0.038;
  outlineCapsule(ctx, top, bottom, SACRUM_WIDTH, SACRUM_WIDTH * 0.55);
  fillCapsule(ctx, top, bottom, SACRUM_WIDTH, SACRUM_WIDTH * 0.55, paint.bone.mid);
  fillDisc(
    ctx,
    offset(centre, -SACRUM_WIDTH * 0.3, 0),
    SACRUM_WIDTH * 0.4,
    rgba(paint.bone.light, SHEEN_ALPHA),
  );
}

/** How far the finger fan opens, from a curled fist to a full claw. */
const FINGER_SPREAD_MIN = deg(6);
const FINGER_SPREAD_MAX = deg(30);
const FINGER_COUNT = 4;
const FINGER_LENGTH = 0.062;
const FINGER_WIDTH = 0.011;
const PALM_RADIUS = 0.026;

/**
 * A skeletal hand: a small carpal mass with four phalanges and a thumb fanning
 * off it. Every digit reads `claw` — a thumb pinned at its open spread throws a
 * stub out of a closed fist that reads as a stray sixth finger.
 */
function paintHand(paint: PaintContext, wrist: Pt, aim: number, claw: number, glow: number): void {
  const { ctx } = paint;
  const spread = lerp(FINGER_SPREAD_MIN, FINGER_SPREAD_MAX, clamp01(claw));
  const reach = FINGER_LENGTH * lerp(0.6, 1, clamp01(claw));
  const palm = offset(wrist, Math.cos(aim) * PALM_RADIUS, Math.sin(aim) * PALM_RADIUS);

  if (glow > 0) paintGlow(ctx, palm, PALM_RADIUS * 4.5, glow);

  outlineDisc(ctx, palm, PALM_RADIUS);

  for (let i = 0; i < FINGER_COUNT; i++) {
    const fan = (i / (FINGER_COUNT - 1) - 0.5) * 2;
    const angle = aim + fan * spread;
    // A curled hand does not just shorten its fingers, it hooks them: the tip
    // segment turns further in than the base one.
    const knuckle = offset(palm, Math.cos(angle) * reach * 0.5, Math.sin(angle) * reach * 0.5);
    const hookAngle = angle + (1 - clamp01(claw)) * deg(55);
    const tip = offset(
      knuckle,
      Math.cos(hookAngle) * reach * 0.5,
      Math.sin(hookAngle) * reach * 0.5,
    );
    outlineCapsule(ctx, palm, knuckle, FINGER_WIDTH, FINGER_WIDTH);
    outlineCapsule(ctx, knuckle, tip, FINGER_WIDTH, FINGER_WIDTH * 0.7);
    fillCapsule(ctx, palm, knuckle, FINGER_WIDTH, FINGER_WIDTH, paint.bone.light);
    fillCapsule(ctx, knuckle, tip, FINGER_WIDTH, FINGER_WIDTH * 0.7, paint.bone.mid);
  }

  const thumbAngle = aim - HALF_PI * lerp(0.35, 0.85, clamp01(claw));
  const thumbTip = offset(
    palm,
    Math.cos(thumbAngle) * reach * 0.72,
    Math.sin(thumbAngle) * reach * 0.72,
  );
  outlineCapsule(ctx, palm, thumbTip, FINGER_WIDTH * 1.15, FINGER_WIDTH * 0.8);
  fillCapsule(ctx, palm, thumbTip, FINGER_WIDTH * 1.15, FINGER_WIDTH * 0.8, paint.bone.light);

  fillDisc(ctx, palm, PALM_RADIUS, paint.bone.mid);
  fillDisc(
    ctx,
    offset(palm, -PALM_RADIUS * 0.3, -PALM_RADIUS * 0.3),
    PALM_RADIUS * 0.5,
    paint.bone.light,
  );
  if (glow > 0) paintGlow(ctx, palm, PALM_RADIUS * 2.4, glow);
}

const FOOT_LENGTH = 0.115;
const FOOT_WIDTH = 0.05;
const TOE_COUNT = 3;
/** How far outboard the toe end of a head-on foot leads. */
const FOOT_SPLAY = deg(24);
/**
 * How much of its length a foot pointed at the camera shows. A foot cannot be
 * splayed head-on by *rotating* it — that rolls the figure onto the outside
 * edges of both soles — so the toe end leads outward while the foot itself is
 * drawn shorter.
 */
const FOOT_FORESHORTEN = 0.62;

/** A foot: tarsal block, metatarsal fan, three stubby toe bones. */
function paintFoot(paint: PaintContext, ankle: Pt, pitch: number, side: number): void {
  const { ctx, view } = paint;
  // Edge-on a foot points along +X, the way the figure faces. Head-on it points
  // at the camera, which on screen is downward and a little outboard.
  const toeAim = view.profile ? -pitch : HALF_PI - side * FOOT_SPLAY;
  const length = FOOT_LENGTH * (view.profile ? 1 : FOOT_FORESHORTEN);
  const toeBase = offset(
    ankle,
    Math.cos(toeAim) * length * 0.75,
    Math.sin(toeAim) * length * 0.75 + FOOT_WIDTH * 0.3,
  );
  outlineCapsule(ctx, ankle, toeBase, FOOT_WIDTH * 0.55, FOOT_WIDTH * 0.45);
  fillCapsule(ctx, ankle, toeBase, FOOT_WIDTH * 0.55, FOOT_WIDTH * 0.45, paint.bone.mid);

  for (let i = 0; i < TOE_COUNT; i++) {
    const fan = (i / (TOE_COUNT - 1) - 0.5) * 2;
    const angle = toeAim + fan * deg(24);
    const tip = offset(toeBase, Math.cos(angle) * length * 0.38, Math.sin(angle) * length * 0.38);
    outlineCapsule(ctx, toeBase, tip, FINGER_WIDTH * 1.2, FINGER_WIDTH * 0.9);
    fillCapsule(ctx, toeBase, tip, FINGER_WIDTH * 1.2, FINGER_WIDTH * 0.9, paint.bone.light);
  }
}

/**
 * One arm: humerus, then radius and ulna side by side with the interosseous gap
 * between them, then the hand.
 */
function paintArm(
  paint: PaintContext,
  chain: BoneChain,
  claw: number,
  palmGlow: number,
  shade: number,
): void {
  const { ctx } = paint;
  paintLongBone(
    ctx,
    chain.root,
    chain.joint,
    HUMERUS_WIDTH,
    SHOULDER_KNOB,
    ELBOW_KNOB,
    paint.bone,
    shade,
  );

  const forearmAngle = angleBetween(chain.joint, chain.end);
  const normal = forearmAngle + HALF_PI;
  const nx = Math.cos(normal);
  const ny = Math.sin(normal);
  const gap = INTEROSSEOUS_GAP * 0.5;
  // The two bones converge at the wrist and separate at the elbow. Parallel all
  // the way down they read as a ladder; converging, they read as an arm.
  const WRIST_CONVERGENCE = 0.28;
  for (const side of [-1, 1]) {
    const from = offset(chain.joint, nx * gap * side, ny * gap * side);
    const to = offset(
      chain.end,
      nx * gap * WRIST_CONVERGENCE * side,
      ny * gap * WRIST_CONVERGENCE * side,
    );
    outlineCapsule(ctx, from, to, FOREARM_BONE_WIDTH, FOREARM_BONE_WIDTH * 0.85);
  }
  for (const side of [-1, 1]) {
    const from = offset(chain.joint, nx * gap * side, ny * gap * side);
    const to = offset(
      chain.end,
      nx * gap * WRIST_CONVERGENCE * side,
      ny * gap * WRIST_CONVERGENCE * side,
    );
    // The ulna (the far-side bone) is the heavier of the two at the elbow.
    const width = side < 0 ? FOREARM_BONE_WIDTH : FOREARM_BONE_WIDTH * 0.88;
    fillCapsule(ctx, from, to, width, width * 0.8, side < 0 ? paint.bone.mid : paint.bone.light);
  }
  outlineDisc(ctx, chain.end, WRIST_KNOB);
  fillDisc(ctx, chain.end, WRIST_KNOB, paint.bone.mid);

  paintHand(paint, chain.end, forearmAngle, claw, palmGlow);
}

/** One leg: femur, tibia, foot. Same knob rhythm as the arm, at twice the mass. */
function paintLeg(paint: PaintContext, chain: BoneChain, pitch: number, side: number): void {
  const { ctx } = paint;
  paintLongBone(ctx, chain.root, chain.joint, FEMUR_WIDTH, FEMUR_KNOB, KNEE_KNOB, paint.bone, 0);
  paintLongBone(
    ctx,
    chain.joint,
    chain.end,
    TIBIA_WIDTH,
    KNEE_KNOB * 0.8,
    ANKLE_KNOB,
    paint.bone,
    0,
  );
  // The fibula: a hairline second bone down the outside of the shin. Small, but
  // it is the difference between a shin and a dowel.
  const shinAngle = angleBetween(chain.joint, chain.end);
  const fibulaOffset = TIBIA_WIDTH * 1.1;
  const fx = Math.cos(shinAngle + HALF_PI) * fibulaOffset * side;
  const fy = Math.sin(shinAngle + HALF_PI) * fibulaOffset * side;
  const FIBULA_WIDTH = 0.013;
  outlineCapsule(
    ctx,
    offset(chain.joint, fx, fy),
    offset(chain.end, fx * 0.5, fy * 0.5),
    FIBULA_WIDTH,
    FIBULA_WIDTH,
  );
  fillCapsule(
    ctx,
    offset(chain.joint, fx, fy),
    offset(chain.end, fx * 0.5, fy * 0.5),
    FIBULA_WIDTH,
    FIBULA_WIDTH,
    paint.bone.dark,
  );
  paintFoot(paint, chain.end, pitch, side);
}

// ── Skull ────────────────────────────────────────────────────────────────────

const ORBIT_RX = 0.052;
const ORBIT_RY = 0.055;
const ORBIT_SPREAD = 0.052;
const ORBIT_Y = -0.018;
const JAW_HINGE_DROP = 0.055;
const FACING_JAW_WIDTH = 0.72;
/** Edge-on the mandible is a muzzle at the front of the skull, not a full bar. */
const PROFILE_JAW_WIDTH = 0.42;
/** How far forward that muzzle sits, as a fraction of the skull's depth. */
const PROFILE_JAW_FORWARD = 0.34;
/** How far forward the face sits on the skull, edge-on, as a fraction of depth. */
const PROFILE_FACE_FORWARD = 0.22;
/** Where the single visible orbit sits along that depth, edge-on. */
const PROFILE_ORBIT_FORWARD = 0.44;
const JAW_MAX_OPEN = 0.07;

/**
 * The skull, drawn as cranium + mandible so the jaw can hang open.
 *
 * The dark orbital and nasal triangle is what makes a pale oval read as a skull
 * at any size — it goes in before any surface detail, and nothing is allowed to
 * cover it.
 */
function paintSkull(paint: PaintContext, centre: Pt): void {
  const { ctx, view, pose } = paint;
  const rx = view.profile ? SKULL_DEPTH : SKULL_RX;
  const ry = SKULL_RY;

  // Edge-on, everything that makes a head a *face* sits at the front of it: the
  // jaw, the teeth and the nasal aperture all shift toward +X while the cranium
  // stays put, which is what gives the profile an occiput behind the ear.
  const faceShift = view.profile ? rx * PROFILE_FACE_FORWARD : 0;

  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(pose.headTilt);

  // Cranium. Squared off at the crown rather than a circle, so the brow has
  // somewhere to sit and the skull does not read as an egg.
  const CRANIUM_CROWN_FLATTEN = 0.92;
  ctx.beginPath();
  ctx.ellipse(
    0,
    -ry * 0.12,
    rx + OUTLINE_BLEED,
    ry * CRANIUM_CROWN_FLATTEN + OUTLINE_BLEED,
    0,
    0,
    TWO_PI,
  );
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -ry * 0.12, rx, ry * CRANIUM_CROWN_FLATTEN, 0, 0, TWO_PI);
  ctx.fillStyle = paint.bone.mid;
  ctx.fill();
  // Key light on the upper-left of the dome.
  const domeLight = ctx.createRadialGradient(
    -rx * 0.35,
    -ry * 0.5,
    0,
    -rx * 0.35,
    -ry * 0.5,
    rx * 1.35,
  );
  domeLight.addColorStop(0, rgba(paint.bone.rim, 0.75));
  domeLight.addColorStop(1, rgba(paint.bone.rim, 0));
  ctx.fillStyle = domeLight;
  ctx.beginPath();
  ctx.ellipse(0, -ry * 0.12, rx, ry * CRANIUM_CROWN_FLATTEN, 0, 0, TWO_PI);
  ctx.fill();

  // Mandible, hinged at the back of the jaw so a gape rotates rather than slides.
  //
  // Edge-on it is a short muzzle at the front of the skull, not a bar across the
  // whole of it: run full depth, the jaw and the gape between its halves draw a
  // smile from the occiput to the chin, and the profile reads as a smiley face
  // however carefully the eye socket above it is done.
  const jawDrop = pose.jaw * JAW_MAX_OPEN;
  const jawWidth = rx * (view.profile ? PROFILE_JAW_WIDTH : FACING_JAW_WIDTH);
  const jawTop = ry * 0.36 + JAW_HINGE_DROP * 0.2;
  ctx.save();
  ctx.translate(faceShift + (view.profile ? rx * PROFILE_JAW_FORWARD : 0), 0);
  ctx.beginPath();
  ctx.moveTo(-jawWidth, jawTop);
  ctx.quadraticCurveTo(
    -jawWidth * 0.9,
    jawTop + ry * 0.5 + jawDrop,
    0,
    jawTop + ry * 0.56 + jawDrop,
  );
  ctx.quadraticCurveTo(jawWidth * 0.9, jawTop + ry * 0.5 + jawDrop, jawWidth, jawTop);
  ctx.closePath();
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.save();
  const JAW_INSET = 0.9;
  ctx.scale(JAW_INSET, JAW_INSET);
  ctx.beginPath();
  ctx.moveTo(-jawWidth, jawTop);
  ctx.quadraticCurveTo(
    -jawWidth * 0.9,
    jawTop + ry * 0.5 + jawDrop,
    0,
    jawTop + ry * 0.56 + jawDrop,
  );
  ctx.quadraticCurveTo(jawWidth * 0.9, jawTop + ry * 0.5 + jawDrop, jawWidth, jawTop);
  ctx.closePath();
  ctx.fillStyle = paint.bone.light;
  ctx.fill();
  ctx.restore();

  // The gape itself: a wedge of shadow between the tooth rows — and only where
  // there *are* tooth rows. Drawn unconditionally it lays a dark bar across the
  // back of the head, which with the occipital arc under it reads as a face on
  // the wrong side of the skull.
  if (pose.jaw > 0.02 && view.showsFace) {
    ctx.beginPath();
    ctx.moveTo(-jawWidth * 0.66, jawTop);
    ctx.lineTo(jawWidth * 0.66, jawTop);
    ctx.lineTo(jawWidth * 0.42, jawTop + jawDrop);
    ctx.lineTo(-jawWidth * 0.42, jawTop + jawDrop);
    ctx.closePath();
    ctx.fillStyle = CAVITY;
    ctx.fill();
  }
  ctx.restore();

  if (view.showsFace) {
    paintFace(paint, rx, ry, jawTop, jawWidth, faceShift);
  } else {
    // From behind, the occipital ridge and the suture running up from it are the
    // only structure there is; without them the back of the head is a blank egg.
    ctx.strokeStyle = rgba(paint.bone.shadow, 0.6);
    ctx.lineWidth = 0.011;
    ctx.beginPath();
    ctx.moveTo(0, -ry * 0.95);
    ctx.lineTo(0, ry * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, ry * 0.16, rx * 0.62, ry * 0.2, 0, 0, Math.PI);
    ctx.stroke();
  }

  ctx.restore();
}

/** Orbits, nasal aperture, cheekbones and the tooth row. */
function paintFace(
  paint: PaintContext,
  rx: number,
  ry: number,
  jawTop: number,
  jawWidth: number,
  faceShift: number,
): void {
  const { ctx, view } = paint;
  // Edge-on there is one socket and it belongs well forward on the face. Left
  // near the centreline it reads as a cyclops with an eye in the middle of its
  // skull rather than as a head seen from the side.
  const eyeSides = view.profile ? [1] : [-1, 1];
  const orbitSpread = view.profile ? rx * PROFILE_ORBIT_FORWARD : ORBIT_SPREAD;

  for (const side of eyeSides) {
    const cx = side * orbitSpread;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, ORBIT_Y, ORBIT_RX, ORBIT_RY, 0, 0, TWO_PI);
    ctx.fillStyle = CAVITY;
    ctx.fill();
    // The brow shelf: a hard dark edge over the socket, which is what stops an
    // orbit reading as a drawn-on cartoon eye.
    ctx.beginPath();
    ctx.moveTo(cx - ORBIT_RX * 1.15, ORBIT_Y - ORBIT_RY * 0.9);
    ctx.quadraticCurveTo(
      cx,
      ORBIT_Y - ORBIT_RY * 1.5,
      cx + ORBIT_RX * 1.15,
      ORBIT_Y - ORBIT_RY * 0.85,
    );
    ctx.lineWidth = 0.014;
    ctx.strokeStyle = mix(paint.bone.shadow, OUTLINE, 0.5);
    ctx.stroke();
    ctx.restore();

    if (paint.glow > 0) {
      // A light *inside* a socket, not a light instead of one. Filling the
      // orbit with green leaves two bright discs on a pale oval, which reads as
      // goggles — the dark cavity is what makes a skull a skull, so the glow is
      // kept well inside it and the socket's own shadow is restated on top.
      const ORBIT_HALO = 0.8;
      const ORBIT_CORE = 0.3;
      paintGlow(paint.ctx, { x: cx, y: ORBIT_Y }, ORBIT_RX * ORBIT_HALO, paint.glow * 0.9);
      fillDisc(
        paint.ctx,
        { x: cx, y: ORBIT_Y },
        ORBIT_RX * ORBIT_CORE,
        rgba(WITCH_CORE, 0.95 * paint.glow),
      );
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, ORBIT_Y, ORBIT_RX, ORBIT_RY, 0, 0, TWO_PI);
      ctx.lineWidth = ORBIT_RX * 0.36;
      ctx.strokeStyle = CAVITY;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Nasal aperture — an inverted teardrop, never a circle.
  const nasalTop = ORBIT_Y + ORBIT_RY * 0.7;
  const nasalBottom = jawTop - ry * 0.06;
  const NASAL_HALF = 0.021;
  const nasalX = view.profile ? orbitSpread + faceShift * 0.5 : 0;
  ctx.beginPath();
  ctx.moveTo(nasalX, nasalTop);
  ctx.quadraticCurveTo(
    nasalX + NASAL_HALF,
    nasalBottom * 0.9 + nasalTop * 0.1,
    nasalX + NASAL_HALF * 0.8,
    nasalBottom,
  );
  ctx.lineTo(nasalX - NASAL_HALF * 0.8, nasalBottom);
  ctx.quadraticCurveTo(nasalX - NASAL_HALF, nasalBottom * 0.9 + nasalTop * 0.1, nasalX, nasalTop);
  ctx.closePath();
  ctx.fillStyle = CAVITY;
  ctx.fill();

  // Zygomatic arch: the diagonal that separates the temple from the cheek.
  ctx.strokeStyle = rgba(paint.bone.shadow, 0.7);
  ctx.lineWidth = 0.012;
  for (const side of view.profile ? [1] : [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * rx * 0.92, ORBIT_Y - ORBIT_RY * 0.2);
    ctx.quadraticCurveTo(
      side * rx * 0.82,
      ORBIT_Y + ORBIT_RY * 0.8,
      side * orbitSpread * 0.85,
      jawTop - ry * 0.1,
    );
    ctx.stroke();
  }

  // Upper tooth row. Individual teeth, because a solid bar reads as a grin drawn
  // on with a marker.
  const TOOTH_COUNT = 6;
  const TOOTH_WIDTH = 0.012;
  const FACING_TOOTH_SPAN = 0.6;
  const PROFILE_TOOTH_SPAN = 0.26;
  const PROFILE_TOOTH_FORWARD = 0.42;
  // Edge-on you see one side of the tooth row, not both, so it sits in the front
  // of the muzzle rather than spanning the skull. Run full-width in profile it
  // is a grin from the occiput to the chin, and the head reads as a smiley face
  // however carefully the socket behind it is drawn.
  const toothSpan = jawWidth * (view.profile ? PROFILE_TOOTH_SPAN : FACING_TOOTH_SPAN);
  const toothCentre = faceShift + (view.profile ? jawWidth * PROFILE_TOOTH_FORWARD : 0);
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const t = i / (TOOTH_COUNT - 1) - 0.5;
    const x = t * toothSpan * 2 + toothCentre;
    ctx.fillStyle = paint.bone.rim;
    ctx.fillRect(x - TOOTH_WIDTH * 0.5, jawTop - ry * 0.13, TOOTH_WIDTH, ry * 0.13);
  }
}

/** The lord's crown: a ring of uneven bone spikes fused to the cranium. */
const CROWN_SPIKE_COUNT = 5;

function paintCrown(paint: PaintContext, centre: Pt): void {
  const { ctx, view, pose } = paint;
  const rx = view.profile ? SKULL_DEPTH : SKULL_RX;
  const ry = SKULL_RY;
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(pose.headTilt);

  const BAND_HEIGHT = 0.028;
  const bandY = -ry * 0.52;
  ctx.beginPath();
  ctx.ellipse(0, bandY, rx * 0.96, BAND_HEIGHT, 0, 0, TWO_PI);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, bandY, rx * 0.9, BAND_HEIGHT * 0.72, 0, 0, TWO_PI);
  ctx.fillStyle = paint.bone.light;
  ctx.fill();

  for (let i = 0; i < CROWN_SPIKE_COUNT; i++) {
    const t = i / (CROWN_SPIKE_COUNT - 1) - 0.5;
    const x = t * rx * 1.7;
    // Uneven heights: a crown of matched spikes reads as a machined part, and
    // this one is meant to look grown.
    const heightScale = 1 - Math.abs(t) * 1.15;
    const spikeHeight = ry * lerp(0.34, 0.78, Math.max(0, heightScale));
    const halfBase = 0.026;
    ctx.beginPath();
    ctx.moveTo(x - halfBase, bandY);
    ctx.lineTo(x + (i % 2 === 0 ? 0.008 : -0.008), bandY - spikeHeight);
    ctx.lineTo(x + halfBase, bandY);
    ctx.closePath();
    ctx.fillStyle = OUTLINE;
    ctx.fill();
    ctx.save();
    const SPIKE_INSET = 0.82;
    ctx.translate(x, bandY);
    ctx.scale(SPIKE_INSET, SPIKE_INSET);
    ctx.translate(-x, -bandY);
    ctx.beginPath();
    ctx.moveTo(x - halfBase, bandY);
    ctx.lineTo(x + (i % 2 === 0 ? 0.008 : -0.008), bandY - spikeHeight);
    ctx.lineTo(x + halfBase, bandY);
    ctx.closePath();
    ctx.fillStyle = paint.bone.rim;
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ── Robe ─────────────────────────────────────────────────────────────────────

const ROBE_HEM_Y = -0.08;
const ROBE_HEM_HALF = 0.34;
const ROBE_WAIST_HALF = 0.19;
const ROBE_TATTER_COUNT = 7;
/** How far below the shoulder line the mantle's hem hangs. */
const MANTLE_DROP = 0.12;
/** Extra drop at the centre of that hem, so the cape comes to a point. */
const MANTLE_POINT_DIP = 0.05;

/**
 * The lord's robe: a heavy skirt from the waist to just off the floor, plus a
 * mantle over the shoulders. It is deliberately open down the front so the lit
 * ribcage shows through — the robe is the silhouette, the ribcage is the story.
 */
function paintRobeSkirt(paint: PaintContext): void {
  const { ctx, rig, pose, view } = paint;
  // Hung from the hip rather than the waist so the pelvis stays visible above
  // it. A skirt that starts at the ribs turns the lord into a bell with a skull
  // on it, and the exposed lit skeleton is the whole of his silhouette's story.
  const waist = rig.hip;
  const flare = lerp(0.85, 1.25, clamp01(pose.robeFlare));
  const hemHalf = ROBE_HEM_HALF * view.girth * flare;
  const waistHalf = ROBE_WAIST_HALF * view.girth;
  const hemY = ROBE_HEM_Y + pose.bob * 0.4;
  const sway = pose.robeSway * hemHalf * 0.22;

  const hemPoint = (t: number): Pt => {
    const x = lerp(-hemHalf, hemHalf, t) + sway;
    // Torn hem: a repeating notch that varies with the frame's own phase so the
    // rags shift as the robe swings instead of being stamped on.
    const notch = Math.sin(t * ROBE_TATTER_COUNT * Math.PI + pose.time * TWO_PI) * 0.5 + 0.5;
    return { x, y: hemY - notch * 0.045 };
  };

  const traceSkirt = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(waist.x - waistHalf - grow, waist.y);
    const STEPS = 14;
    ctx.lineTo(hemPoint(0).x - grow, hemPoint(0).y + grow);
    for (let i = 1; i <= STEPS; i++) {
      const p = hemPoint(i / STEPS);
      ctx.lineTo(p.x, p.y + grow);
    }
    ctx.lineTo(waist.x + waistHalf + grow, waist.y);
    ctx.closePath();
  };

  traceSkirt(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  traceSkirt(0);
  ctx.fillStyle = ROBE.mid;
  ctx.fill();

  // Folds: vertical creases fanning from the waist, which is the only thing
  // that gives a flat dark shape any read of volume at tile size.
  ctx.save();
  traceSkirt(0);
  ctx.clip();
  const FOLD_COUNT = 5;
  for (let i = 0; i < FOLD_COUNT; i++) {
    const t = (i + 0.5) / FOLD_COUNT;
    const p = hemPoint(t);
    ctx.beginPath();
    ctx.moveTo(lerp(waist.x - waistHalf * 0.6, waist.x + waistHalf * 0.6, t), waist.y);
    ctx.lineTo(p.x, p.y);
    ctx.lineWidth = 0.022;
    ctx.strokeStyle = rgba(i % 2 === 0 ? ROBE.shadow : ROBE.light, 0.55);
    ctx.stroke();
  }
  // The witch-light leaking out from under the hem is what stops the robe
  // reading as a solid black wedge sitting on the floor.
  if (paint.glow > 0) {
    paintGlow(ctx, { x: waist.x + sway, y: hemY - 0.02 }, hemHalf * 0.62, paint.glow * 0.3);
  }
  ctx.restore();
}

/** The cowl and mantle across the shoulders, drawn over the arms' roots. */
function paintRobeMantle(paint: PaintContext): void {
  const { ctx, rig } = paint;
  const half = rig.shoulderHalf * 1.14;
  const top = offset(rig.shoulderCentre, 0, -0.035);
  // Stops well above the ribcage. Carried down to the chest it is a black
  // rectangle across the one part of him the design is about, and only the
  // bottom two ribs survive it.
  const hemY = rig.shoulderCentre.y + MANTLE_DROP;
  const hemHalf = half * 0.82;
  const point = hemY + MANTLE_POINT_DIP;

  const traceMantle = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(top.x - half * 0.5 - grow, top.y - grow);
    ctx.quadraticCurveTo(top.x - half - grow, top.y + 0.02, top.x - hemHalf - grow, hemY + grow);
    // A dip at the centre of the hem: a straight edge across a cape reads as a
    // bib, and the point is what makes it hang.
    ctx.quadraticCurveTo(top.x - hemHalf * 0.4, point + grow, top.x, point + grow);
    ctx.quadraticCurveTo(top.x + hemHalf * 0.4, point + grow, top.x + hemHalf + grow, hemY + grow);
    ctx.quadraticCurveTo(
      top.x + half + grow,
      top.y + 0.02,
      top.x + half * 0.5 + grow,
      top.y - grow,
    );
    ctx.closePath();
  };
  traceMantle(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  traceMantle(0);
  ctx.fillStyle = ROBE.dark;
  ctx.fill();
  ctx.save();
  traceMantle(0);
  ctx.clip();
  ctx.fillStyle = rgba(ROBE.rim, RIM_ALPHA);
  ctx.beginPath();
  ctx.moveTo(top.x - half * 0.5, top.y);
  ctx.quadraticCurveTo(top.x - half * 0.9, top.y + 0.02, top.x - hemHalf * 0.9, point);
  ctx.lineTo(top.x - hemHalf * 0.55, point);
  ctx.quadraticCurveTo(top.x - half * 0.6, top.y + 0.02, top.x - half * 0.3, top.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // A collar standing up behind the neck rather than a hood over the skull: a
  // dome behind the head fought the crown for the same silhouette and won,
  // leaving a black lump with spikes on it.
  const collarHalf = half * 0.55;
  const collarTop = offset(top, 0, -SKULL_RY * 0.55);
  ctx.beginPath();
  ctx.moveTo(top.x - collarHalf, top.y);
  ctx.quadraticCurveTo(
    collarTop.x - collarHalf * 0.7,
    collarTop.y,
    collarTop.x - collarHalf * 0.3,
    collarTop.y,
  );
  ctx.lineTo(collarTop.x + collarHalf * 0.3, collarTop.y);
  ctx.quadraticCurveTo(collarTop.x + collarHalf * 0.7, collarTop.y, top.x + collarHalf, top.y);
  ctx.closePath();
  ctx.fillStyle = ROBE.shadow;
  ctx.fill();
}

// ── Gear ─────────────────────────────────────────────────────────────────────

const SWORD_BLADE_LENGTH = 0.62;
const SWORD_BLADE_HALF = 0.035;
const SWORD_GUARD_HALF = 0.075;
const SWORD_GRIP_LENGTH = 0.11;
const SWORD_NOTCH_COUNT = 3;
/** How far forward of the forearm's line the blade is carried. */
const SWORD_CARRY_TILT = deg(24);

/**
 * A notched, rust-eaten short sword.
 *
 * Identity lives in the outline: a straight blunt blade with a hard crossguard
 * and three bites out of one edge. Detail inside the shape is invisible at 32 px
 * and the notches are the only interior feature that survives, because they cut
 * the silhouette rather than decorate it.
 */
function paintSword(paint: PaintContext, grip: Pt, aim: number): void {
  const { ctx } = paint;
  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(aim);

  const pommel = -SWORD_GRIP_LENGTH * 0.5;
  const guard = SWORD_GRIP_LENGTH * 0.5;
  const tip = guard + SWORD_BLADE_LENGTH;

  ctx.beginPath();
  ctx.moveTo(guard, -SWORD_BLADE_HALF - OUTLINE_BLEED);
  ctx.lineTo(tip - 0.03, -SWORD_BLADE_HALF * 0.5 - OUTLINE_BLEED);
  ctx.lineTo(tip + OUTLINE_BLEED, 0);
  ctx.lineTo(tip - 0.03, SWORD_BLADE_HALF * 0.5 + OUTLINE_BLEED);
  ctx.lineTo(guard, SWORD_BLADE_HALF + OUTLINE_BLEED);
  ctx.closePath();
  ctx.fillStyle = OUTLINE;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(guard, -SWORD_BLADE_HALF);
  for (let i = 0; i < SWORD_NOTCH_COUNT; i++) {
    const t = (i + 0.5) / SWORD_NOTCH_COUNT;
    const x = lerp(guard, tip - 0.05, t);
    ctx.lineTo(x - 0.02, -SWORD_BLADE_HALF * lerp(1, 0.5, t));
    ctx.lineTo(x, -SWORD_BLADE_HALF * lerp(1, 0.5, t) + 0.022);
    ctx.lineTo(x + 0.02, -SWORD_BLADE_HALF * lerp(1, 0.5, t));
  }
  ctx.lineTo(tip - 0.03, -SWORD_BLADE_HALF * 0.5);
  ctx.lineTo(tip, 0);
  ctx.lineTo(tip - 0.03, SWORD_BLADE_HALF * 0.5);
  ctx.lineTo(guard, SWORD_BLADE_HALF);
  ctx.closePath();
  ctx.fillStyle = IRON.mid;
  ctx.fill();
  ctx.fillStyle = rgba(IRON.rim, SHEEN_ALPHA);
  ctx.fillRect(guard, -SWORD_BLADE_HALF * 0.4, SWORD_BLADE_LENGTH * 0.85, SWORD_BLADE_HALF * 0.3);

  const GUARD_THICK = 0.022;
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(guard - GUARD_THICK, -SWORD_GUARD_HALF, GUARD_THICK * 2, SWORD_GUARD_HALF * 2);
  ctx.fillStyle = IRON.dark;
  ctx.fillRect(
    guard - GUARD_THICK * 0.7,
    -SWORD_GUARD_HALF * 0.86,
    GUARD_THICK * 1.4,
    SWORD_GUARD_HALF * 1.72,
  );

  const GRIP_HALF = 0.018;
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(pommel, -GRIP_HALF - OUTLINE_BLEED, guard - pommel, (GRIP_HALF + OUTLINE_BLEED) * 2);
  ctx.fillStyle = WOOD.dark;
  ctx.fillRect(pommel, -GRIP_HALF, guard - pommel, GRIP_HALF * 2);
  fillDisc(ctx, { x: pommel, y: 0 }, GRIP_HALF * 1.5, IRON.dark);

  ctx.restore();
}

const SHIELD_RADIUS = 0.16;

/** A round shield beaten out of scrap: dented rim, one broken plank across it. */
function paintShield(paint: PaintContext, centre: Pt): void {
  const { ctx } = paint;
  outlineDisc(ctx, centre, SHIELD_RADIUS);
  fillDisc(ctx, centre, SHIELD_RADIUS, WOOD.mid);
  fillDisc(ctx, centre, SHIELD_RADIUS * 0.94, WOOD.mid);
  ctx.save();
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, SHIELD_RADIUS * 0.94, 0, TWO_PI);
  ctx.clip();
  const PLANK_COUNT = 3;
  for (let i = 0; i < PLANK_COUNT; i++) {
    const y = centre.y + (i / (PLANK_COUNT - 1) - 0.5) * SHIELD_RADIUS * 1.5;
    ctx.strokeStyle = rgba(WOOD.shadow, 0.75);
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    ctx.moveTo(centre.x - SHIELD_RADIUS, y);
    ctx.lineTo(centre.x + SHIELD_RADIUS, y);
    ctx.stroke();
  }
  ctx.restore();
  fillDisc(ctx, centre, SHIELD_RADIUS * 0.3, IRON.mid);
  fillDisc(
    ctx,
    offset(centre, -SHIELD_RADIUS * 0.09, -SHIELD_RADIUS * 0.09),
    SHIELD_RADIUS * 0.16,
    IRON.rim,
  );
}

const BOW_HALF_HEIGHT = 0.36;
/** How far the stave bellies away from the string. A shallow bow reads as a plank. */
const BOW_DEPTH = 0.17;
const BOW_STAVE_WIDTH = 0.034;
/** The horn nocks at either tip, which are what make the ends read as ends. */
const BOW_NOCK_RADIUS = 0.02;
const BOW_STRING_WIDTH = 0.013;

/**
 * A bow held at `grip`, opening along `aim`. `draw` is 0 at rest and 1 at full
 * draw, which both bends the limbs and pulls the string back to a point.
 */
function paintBow(paint: PaintContext, grip: Pt, aim: number, draw: number): void {
  const { ctx } = paint;
  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(aim);

  const belly = BOW_DEPTH * lerp(1, 1.5, clamp01(draw));
  const traceStave = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(0, -BOW_HALF_HEIGHT - grow);
    ctx.quadraticCurveTo(belly + grow, 0, 0, BOW_HALF_HEIGHT + grow);
  };
  ctx.lineCap = 'round';
  traceStave(0);
  ctx.lineWidth = BOW_STAVE_WIDTH + OUTLINE_BLEED * 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  traceStave(0);
  ctx.lineWidth = BOW_STAVE_WIDTH;
  ctx.strokeStyle = WOOD.light;
  ctx.stroke();
  for (const tip of [-BOW_HALF_HEIGHT, BOW_HALF_HEIGHT]) {
    outlineDisc(ctx, { x: 0, y: tip }, BOW_NOCK_RADIUS);
    fillDisc(ctx, { x: 0, y: tip }, BOW_NOCK_RADIUS, BONE.light);
  }

  // String: a straight line at rest, a shallow V once it is drawn.
  const pull = -lerp(0, 0.24, clamp01(draw));
  ctx.beginPath();
  ctx.moveTo(0, -BOW_HALF_HEIGHT);
  ctx.lineTo(pull, 0);
  ctx.lineTo(0, BOW_HALF_HEIGHT);
  // Thicker than looks right on paper: at a 32 px tile a hairline string is
  // simply not drawn, and a bow with no string is a bent stick.
  ctx.lineWidth = BOW_STRING_WIDTH;
  ctx.strokeStyle = rgba(BONE.rim, 0.95);
  ctx.stroke();

  if (draw > 0.05) {
    const ARROW_LENGTH = 0.42;
    ctx.beginPath();
    ctx.moveTo(pull, 0);
    ctx.lineTo(pull + ARROW_LENGTH, 0);
    ctx.lineWidth = 0.014;
    ctx.strokeStyle = BONE.light;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pull + ARROW_LENGTH, 0);
    ctx.lineTo(pull + ARROW_LENGTH - 0.04, -0.024);
    ctx.lineTo(pull + ARROW_LENGTH - 0.04, 0.024);
    ctx.closePath();
    ctx.fillStyle = BONE.rim;
    ctx.fill();
  }
  ctx.restore();
}

const QUIVER_HALF = 0.055;
const QUIVER_LENGTH = 0.42;
const QUIVER_ARROW_COUNT = 4;
/** How far the shafts stand out of the quiver's mouth, in tile units. */
const QUIVER_ARROW_REACH = 0.17;

/** The quiver, slung across the back and drawn behind the ribcage. */
function paintQuiver(paint: PaintContext, chest: Pt, lean: number): void {
  const { ctx, view } = paint;
  const tilt = lean + deg(view.profile ? 18 : 24);
  ctx.save();
  // Slung well off the spine. Tucked against it the ribcage and the arms are
  // painted straight over the whole thing and the archer simply has no quiver.
  ctx.translate(chest.x + (view.profile ? -0.19 : 0.22), chest.y - 0.06);
  ctx.rotate(tilt);
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(
    -QUIVER_HALF - OUTLINE_BLEED,
    -OUTLINE_BLEED,
    QUIVER_HALF * 2 + OUTLINE_BLEED * 2,
    QUIVER_LENGTH,
  );
  ctx.fillStyle = WOOD.dark;
  ctx.fillRect(-QUIVER_HALF, 0, QUIVER_HALF * 2, QUIVER_LENGTH);
  ctx.fillStyle = rgba(WOOD.light, RIM_ALPHA);
  ctx.fillRect(-QUIVER_HALF, 0, QUIVER_HALF * 0.5, QUIVER_LENGTH);
  for (let i = 0; i < QUIVER_ARROW_COUNT; i++) {
    const t = i / (QUIVER_ARROW_COUNT - 1) - 0.5;
    const x = t * QUIVER_HALF * 1.3;
    ctx.strokeStyle = BONE.light;
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    // Long enough to stand above the shoulder line: arrow shafts poking out of
    // the quiver are what identifies it as a quiver rather than as a satchel.
    ctx.moveTo(x, 0);
    ctx.lineTo(x + t * 0.045, -QUIVER_ARROW_REACH);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Ground ───────────────────────────────────────────────────────────────────

/**
 * The broken earth a rising skeleton climbs out of. Drawn under everything and
 * only when the figure is actually below the ground line, so a standing frame
 * never carries a mound it did not dig.
 */
function paintGraveMound(ctx: Ctx, emergence: number): void {
  const strength = clamp01(emergence);
  if (strength < MIN_VISIBLE_ALPHA) return;
  const MOUND_HALF = 0.36;
  const MOUND_HEIGHT = 0.075;
  const SOIL_DARK = '#241a12';
  const SOIL_MID = '#3d2c1d';

  ctx.beginPath();
  ctx.ellipse(0, 0, MOUND_HALF * strength, MOUND_HEIGHT * strength, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(SOIL_DARK, 0.85 * strength);
  ctx.fill();

  const CLOD_COUNT = 6;
  for (let i = 0; i < CLOD_COUNT; i++) {
    const angle = (i / CLOD_COUNT) * TWO_PI;
    const dist = MOUND_HALF * lerp(0.5, 1, ((i * 7) % 5) / 4) * strength;
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(angle) * dist,
      Math.sin(angle) * dist * (MOUND_HEIGHT / MOUND_HALF),
      0.03,
      0.018,
      angle,
      0,
      TWO_PI,
    );
    ctx.fillStyle = rgba(i % 2 === 0 ? SOIL_MID : SOIL_DARK, 0.9 * strength);
    ctx.fill();
  }
}

/** The soft contact shadow every standing figure casts on the tile under it. */
function paintContactShadow(ctx: Ctx, pose: SkeletonPose, robed: boolean): void {
  const half = robed ? ROBE_HEM_HALF * 0.9 : 0.19;
  const lift = clamp01(-pose.bob * 4);
  const alpha = CONTACT_SHADOW_ALPHA * (1 - lift * 0.5);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, half);
  gradient.addColorStop(0, rgba('#000000', alpha));
  gradient.addColorStop(1, rgba('#000000', 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(0, 0, half, half * 0.3, 0, 0, TWO_PI);
  ctx.fill();
}

// ── Painters ─────────────────────────────────────────────────────────────────

/** Depth shade applied to a limb genuinely behind the body, in profile only. */
const FAR_LIMB_SHADE = 0.4;

/** Fraction of the figure's height it must still be buried for a full mound. */
const MOUND_FULL_DEPTH = 0.25;

function paintFigure(
  ctx: Ctx,
  pose: SkeletonPose,
  variant: SkeletonVariant,
  viewName: SkeletonView,
): void {
  const view = VIEWS[viewName];
  const spec = VARIANTS[variant];
  const rig = buildRig(pose, view);
  const glow = clamp01(
    spec.ambientGlow * lerp(0.7, 1, pose.glow) + pose.glow * (1 - spec.ambientGlow),
  );
  const bone: Ramp = {
    shadow: mix(BONE.shadow, '#42381f', spec.boneStain),
    dark: mix(BONE.dark, '#6d5f3c', spec.boneStain),
    mid: mix(BONE.mid, '#9c8f68', spec.boneStain),
    light: mix(BONE.light, '#c0b389', spec.boneStain),
    rim: mix(BONE.rim, '#ded1a8', spec.boneStain),
  };
  const paint: PaintContext = { ctx, pose, view, rig, glow, ribLight: spec.ribLight, bone };

  ctx.save();
  if (pose.sink > 0) {
    // Clipped at the ground line rather than drawn and covered: a mound painted
    // over the buried half would still show through wherever the mound is
    // narrower than the figure, which is most of the rise.
    ctx.beginPath();
    const CLIP_REACH = 4;
    ctx.rect(-CLIP_REACH, -CLIP_REACH, CLIP_REACH * 2, CLIP_REACH);
    ctx.clip();
    ctx.translate(0, pose.sink);
  }

  // The figure's left is the far side in every view: the profile faces +X, so
  // the left limbs are the ones across the body from the camera, and head-on the
  // choice only decides which leg is painted over the other where they cross.
  paintContactShadow(ctx, pose, spec.robed);

  // Which arms go behind the trunk. Head-on both arms normally belong in *front*
  // of the ribcage — drawing one behind it makes the figure look one-armed — but
  // a pose seen from the back says so explicitly, and both flags have to be
  // honoured. Read only `leftArmBehind`, a row that sets only the right one
  // bakes identically to the row it was written to differ from.
  const drawLeftArmFirst = view.profile || pose.leftArmBehind;
  const drawRightArmFirst = !view.profile && pose.rightArmBehind;

  /**
   * Whatever the given hand is holding, painted straight after that arm.
   *
   * Gear has to travel with its own limb. Drawn at one fixed point in the order,
   * a shield whose arm went behind the ribcage is left floating over the pelvis
   * with the forearm holding it hidden — and the fist repainted on top of it
   * then belongs to no arm at all.
   *
   * The fist always comes back over the grip: a haft is wider than a hand, so
   * painted over it the figure appears to be swinging something nobody holds.
   */
  const paintHeldHand = (chain: BoneChain, claw: number, glow: number): void => {
    paintHand(paint, chain.end, angleBetween(chain.joint, chain.end), claw, glow);
  };
  const paintOffHandGear = (): void => {
    if (variant === 'sword') {
      paintShield(paint, offset(rig.leftArm.end, 0, -0.02));
    } else if (variant === 'archer') {
      const bowAim = angleBetween(rig.leftArm.joint, rig.leftArm.end) - HALF_PI;
      const drawAmount = clamp01((rig.leftArm.end.x - rig.rightArm.end.x) / (FOREARM_LENGTH * 1.2));
      paintBow(paint, rig.leftArm.end, bowAim, view.profile ? drawAmount : drawAmount * 0.9);
    } else {
      return;
    }
    paintHeldHand(rig.leftArm, pose.leftClaw, pose.leftPalmGlow);
  };
  const paintWeaponHandGear = (): void => {
    if (variant !== 'sword') return;
    // A carried sword is not a continuation of the forearm. Aligned with it, a
    // hanging arm points the blade straight down and it is drawn through the
    // legs, which reads as a stake driven through the body.
    const swordAim = angleBetween(rig.rightArm.joint, rig.rightArm.end) - SWORD_CARRY_TILT;
    paintSword(paint, rig.rightArm.end, swordAim);
    paintHeldHand(rig.rightArm, pose.rightClaw, pose.rightPalmGlow);
  };

  if (drawLeftArmFirst) {
    paintArm(
      paint,
      rig.leftArm,
      pose.leftClaw,
      pose.leftPalmGlow,
      view.profile ? FAR_LIMB_SHADE : 0,
    );
    paintOffHandGear();
  }
  if (drawRightArmFirst) {
    paintArm(paint, rig.rightArm, pose.rightClaw, pose.rightPalmGlow, 0);
    paintWeaponHandGear();
  }
  // A quiver is slung across the back, so from behind it is in *front* of the
  // ribs and from every other angle it is behind them.
  if (variant === 'archer' && !view.showsBack) paintQuiver(paint, rig.chest, pose.lean);

  // The fibula sits on the *outside* of each shin, so the two legs push it in
  // opposite screen directions; sharing a sign puts one leg's second bone down
  // the inside of the calf, where no leg has one.
  paintLeg(paint, rig.leftLeg, pose.leftFootPitch, -1);
  paintLeg(paint, rig.rightLeg, pose.rightFootPitch, 1);

  paintSpine(paint);
  paintPelvis(paint);
  paintRibcage(paint);
  if (spec.robed) paintRobeSkirt(paint);
  if (spec.robed) paintRobeMantle(paint);

  if (!drawLeftArmFirst) {
    paintArm(paint, rig.leftArm, pose.leftClaw, pose.leftPalmGlow, 0);
    paintOffHandGear();
  }

  paintSkull(paint, rig.headCentre);
  if (spec.robed) paintCrown(paint, rig.headCentre);

  if (variant === 'archer' && view.showsBack) paintQuiver(paint, rig.chest, pose.lean);

  if (!drawRightArmFirst) {
    paintArm(paint, rig.rightArm, pose.rightClaw, pose.rightPalmGlow, 0);
    paintWeaponHandGear();
  }

  ctx.restore();

  // The mound is at full size for as long as the figure is meaningfully buried
  // and only collapses over the last of the climb. Scaled off how deep the
  // figure still is instead, the first frames of a rise are a barely-visible
  // smudge over an entirely clipped skeleton — which bakes as an empty cell.
  if (pose.sink > 0) paintGraveMound(ctx, clamp01(pose.sink / (FIGURE_HEIGHT * MOUND_FULL_DEPTH)));
}

/**
 * How wide apart the leg roots are drawn in a given view, as a fraction of the
 * head-on spacing. The bake gate needs it to judge a profile pose's reach with
 * the roots it will actually be solved against.
 */
export function lateralFor(view: SkeletonView): number {
  return VIEWS[view].lateral;
}

/**
 * How much slack a pose leaves in its longer leg, in tile units.
 *
 * Positive means the IK can reach the foot without clamping. Exported because it
 * is the one thing about a pose that cannot be judged from the baked picture: a
 * leg the solver had to clamp is drawn as a perfectly straight line with the
 * foot hanging off the floor, which looks like a stylistic choice until the row
 * plays and the figure hops.
 *
 * `lateral` must be the view's own leg-root spacing: a profile pose's X is
 * forward reach, not width, so judging its stride against head-on roots invents
 * a quarter-tile of sideways travel that the drawn figure never has.
 */
export function legReachHeadroom(pose: SkeletonPose, lateral: number): number {
  const maxReach = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * lateral, -hipHeight + pose.bob);
  const rootHalf = LEG_ROOT_HALF * lateral;
  const legs: ReadonlyArray<readonly [Pt, number, number]> = [
    [pose.leftFoot, pose.leftFootPitch, -rootHalf],
    [pose.rightFoot, pose.rightFootPitch, rootHalf],
  ];
  let worst = maxReach;
  for (const [foot, pitch, rootOffset] of legs) {
    const root = offset(hip, rootOffset, 0);
    const ankle = ankleFor(foot, pitch);
    worst = Math.min(worst, maxReach - Math.hypot(ankle.x - root.x, ankle.y - root.y));
  }
  return worst;
}

/** Paints the figure seen head-on, toward the camera. */
export function drawSkeletonFront(ctx: Ctx, pose: SkeletonPose, variant: SkeletonVariant): void {
  paintFigure(ctx, pose, variant, 'front');
}

/** Paints the figure seen from behind, walking away from the camera. */
export function drawSkeletonBack(ctx: Ctx, pose: SkeletonPose, variant: SkeletonVariant): void {
  paintFigure(ctx, pose, variant, 'back');
}

/** Paints the figure in profile, always facing +X so the runtime can mirror it. */
export function drawSkeletonSide(ctx: Ctx, pose: SkeletonPose, variant: SkeletonVariant): void {
  paintFigure(ctx, pose, variant, 'side');
}

/** Exposed for the gore module, which paints loose bones in the same palette. */
export {
  BONE,
  IRON,
  WOOD,
  OUTLINE,
  RIM_LIGHT,
  RIM_ALPHA,
  CAVITY,
  WITCH_CORE,
  WITCH_BRIGHT,
  WITCH_MID,
  WITCH_DEEP,
};
export {
  paintLongBone,
  paintGlow,
  fillCapsule,
  fillDisc,
  outlineCapsule,
  outlineDisc,
  traceCapsule,
};
export { SKULL_RX, SKULL_RY, ORBIT_RX, ORBIT_RY, ORBIT_SPREAD, RIBCAGE_HALF, PELVIS_HALF };
export { THIGH_LENGTH, SHIN_LENGTH, FEMUR_WIDTH, FEMUR_KNOB, KNEE_KNOB, TIBIA_WIDTH, ANKLE_KNOB };
export { HUMERUS_WIDTH, SHOULDER_KNOB, ELBOW_KNOB, FOREARM_BONE_WIDTH, WRIST_KNOB };
