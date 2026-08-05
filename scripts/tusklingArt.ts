/**
 * The Tuskling painter.
 *
 * A pink-skinned orc with a wide warthog head that sits straight on its
 * shoulders, a torso half again as broad as a human's, comically stubby legs
 * and no shoes over its hooves. Four tusks: a long pair sweeping up off the
 * lower jaw whose tips cross in front of the snout, and a shorter pair further
 * back sweeping down and out.
 *
 * Coordinates are tile units with the origin at the point between the hooves
 * and +Y pointing down the screen, so heights above the ground are negative.
 * The generator translates to that ground point, scales by one tile, and calls
 * one of the three painters. The side view is always drawn facing +X; the
 * runtime mirrors it for the other direction.
 *
 * The rig — the view table, the two-bone IK, the FK escape hatch for swinging
 * arms, and "every pose is an edit to one resting pose" — is taken from
 * `carlArt.ts`, which is the only figure in this game whose movement convinces.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { type Pt, clamp01, deg, lerp, mix } from './carlArt.js';
import { hash1, rgba } from './ratArt.js';

export type { Pt };

export function pt(x: number, y: number): Pt {
  return { x, y };
}

function offset(p: Pt, dx: number, dy: number): Pt {
  return { x: p.x + dx, y: p.y + dy };
}

function mixPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function rotate(p: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function angleBetween(a: Pt, b: Pt): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// ── Palette ──────────────────────────────────────────────────────────────────

interface Ramp {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
}

/** Dusty pig-pink. Bright enough to hold its own on the dungeon floor. */
const HIDE: Ramp = { dark: '#4a2530', mid: '#ab5f69', light: '#dfa199' };
/** The belly, chest and inner limbs, where the hide is thinner and paler. */
const BELLY: Ramp = { dark: '#7a3f47', mid: '#cf948d', light: '#eec0b6' };
const OUTLINE = '#170a10';
const RIM_LIGHT = '#ffd9c9';
const RIM_ALPHA = 0.5;
const CONTACT_SHADOW_ALPHA = 0.42;

const SNOUT: Ramp = { dark: '#7d3742', mid: '#b0616b', light: '#d18b8e' };
const NOSTRIL = '#33131c';
const MAW_INNER = '#4a121f';
const TOOTH = '#e7dcc4';

const TUSK: Ramp = { dark: '#9c8f6c', mid: '#e2d9bb', light: '#fbf6e4' };
const HOOF: Ramp = { dark: '#1e1820', mid: '#3a2f39', light: '#5d4d58' };
/** Black eyes, per the source description — the spark is what keeps them alive. */
const EYE = '#0c0a10';
const EYE_SPARK = '#ffffff';
const BRISTLE = '#4d2a33';

/** Where the key light comes from, as a direction in figure space. */
const LIGHT: Pt = { x: -0.6, y: -0.8 };
/** How far a far-side limb is pushed toward the outline so it recedes. */
const FAR_LIMB_SHADE = 0.42;
/** Painted at its own ramp, with nothing mixed toward the outline. */
const UNSHADED = 0;
/**
 * How far the near arm is lifted toward the hide's highlight in profile.
 *
 * Negative shade, because a limb in front of the body is not in shadow — it is
 * closer to the light. Left at the body's own tone it is a shape separated from
 * the trunk by one dark line, and one dark line down a torso is a seam.
 */
const NEAR_LIMB_LIFT = -0.34;

/** A limb's fill: positive shade recedes toward the ink, negative advances. */
function limbTone(base: string, shade: number): string {
  return shade >= 0 ? mix(base, OUTLINE, shade) : mix(base, HIDE.light, -shade);
}

// ── Proportions ──────────────────────────────────────────────────────────────
// Heights are y values, so they are negative: the origin sits between the
// hooves and the screen's +Y runs down.

/**
 * Total standing height. A Tuskling is 4'6" against a 6'0" human, so this is
 * three quarters of the height `carlArt.ts` authors, and the generator scales
 * the whole figure about its own ground line afterwards.
 */
const FIGURE_HEIGHT = 1.55;
/**
 * Deliberately low. The head is oversized on purpose — at a 32 px tile the
 * warthog skull and its tusks are the entire read, and an anatomical head is a
 * smudge there.
 */
const HEADS_TALL = 3.4;
const HEAD_HEIGHT = FIGURE_HEIGHT / HEADS_TALL;

const ANKLE_Y = -0.07;
const KNEE_Y = -0.225;
/**
 * The hip sits at under a third of the standing height rather than at half of
 * it, which is what "comically stubby from the waist down" means: the torso
 * takes the difference.
 */
const HIP_Y = -0.4;
const WAIST_Y = -0.58;
const CHEST_Y = -0.86;
export const SHOULDER_Y = -1.06;
/**
 * Low enough that the jaw overlaps the shoulder line. "Heads that sit too close
 * to their shoulders" is a silhouette decision, and any daylight between the
 * two reads as a neck however short the neck is drawn.
 */
const HEAD_CENTRE_Y = -1.33;

/**
 * How much longer the bones are than the column they stand in. A Tuskling
 * stands with visibly bent knees, which is both what a squat heavy biped does
 * and what buys the IK enough headroom to take a stride without clamping — a
 * clamped frame locks the leg straight and the step reads as a hop.
 */
const KNEE_BEND_SLACK = 1.06;
const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * KNEE_BEND_SLACK;
const SHIN_LENGTH = Math.abs(KNEE_Y - ANKLE_Y) * KNEE_BEND_SLACK;
export { THIGH_LENGTH, SHIN_LENGTH };

export const UPPER_ARM_LENGTH = 0.3;
export const FOREARM_LENGTH = 0.26;
/** Shoulder to wrist. A relaxed arm hangs at very nearly this. */
const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

/**
 * Half the shoulder span. A human's is about 0.138 of his standing height; the
 * source puts a Tuskling's torso at one and a half times a human's, so this is
 * that ratio scaled up, and it is what makes the silhouette read as wider than
 * it is tall through the chest.
 */
const HUMAN_SHOULDER_SHARE = 0.138;
const TORSO_BREADTH_MULTIPLE = 2.35;
const SHOULDER_HALF = FIGURE_HEIGHT * HUMAN_SHOULDER_SHARE * TORSO_BREADTH_MULTIPLE;
const CHEST_HALF = SHOULDER_HALF * 0.97;
const WAIST_HALF = SHOULDER_HALF * 0.8;
/**
 * Markedly narrower than the shoulders. A trunk whose widest point is low is a
 * pear, and a pear with two tubes on it is a plush toy however it is painted.
 */
const HIP_HALF = SHOULDER_HALF * 0.6;

/** Arms root just inside the shoulder's edge, not inside the body's silhouette. */
const ARM_INSET = 0.9;
export const ARM_ROOT_HALF = SHOULDER_HALF * ARM_INSET;
/** The arm's root hangs this far below the shoulder line, not on it. */
const SHOULDER_JOINT_DROP = 0.05;

/**
 * Where the thigh roots, measured out from the hip centre. It cannot be
 * narrower than the thigh's own half-width or the two thighs merge into one
 * wedge splitting downward.
 */
const LEG_ROOT_HALF = 0.145;

const THIGH_WIDTH = 0.135;
const KNEE_WIDTH = 0.1;
const CALF_WIDTH = 0.115;
const ANKLE_WIDTH = 0.07;
/** How far down the shin the calf reaches its widest. */
const CALF_AT = 0.3;
const UPPER_ARM_WIDTH = 0.115;
const ELBOW_WIDTH = 0.085;
const WRIST_WIDTH = 0.062;

/**
 * The skull is very nearly as wide as it is tall — a warthog's is broader than
 * a human's however you slice it — and slightly deeper still in profile.
 */
const HEAD_WIDTH_RATIO = 1.3;
const HEAD_DEPTH_RATIO = 1.3;
const HEAD_RY = HEAD_HEIGHT / 2;
const HEAD_RX = HEAD_RY * HEAD_WIDTH_RATIO;
const HEAD_DEPTH = HEAD_RY * HEAD_DEPTH_RATIO;

/** Side-on, the limbs gather toward the centreline instead of splaying wide. */
const PROFILE_LATERAL = 0.3;

// ── Views ────────────────────────────────────────────────────────────────────

export type TusklingView = 'front' | 'back' | 'side';

interface ViewSpec {
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
  /**
   * Multiplier on the torso's drawn width. A barrel body is nearly as deep as
   * it is wide, so in profile it stays broad even as the limbs gather onto the
   * centreline.
   */
  readonly girth: number;
  /** Extra trim on the hips, which are less deep than the chest. */
  readonly hipDepth: number;
  /** Narrows the shoulders and chest in profile without touching the waist. */
  readonly chestTaper: number;
  /**
   * How far apart the two shoulder joints are drawn. Edge-on they are almost
   * the same point; given the full half-width the arms angle inward and cross
   * the chest.
   */
  readonly armSpread: number;
  /** True when the figure is seen edge-on rather than head-on. */
  readonly profile: boolean;
  /** True when the face is toward the camera. */
  readonly showsFace: boolean;
}

const PROFILE_GIRTH = 0.72;
const PROFILE_HIP_DEPTH = 0.86;
const PROFILE_ARM_SPREAD = 0.14;
const PROFILE_CHEST_TAPER = 0.92;

const VIEWS: Record<TusklingView, ViewSpec> = {
  front: {
    lateral: 1,
    girth: 1,
    hipDepth: 1,
    chestTaper: 1,
    armSpread: 1,
    profile: false,
    showsFace: true,
  },
  back: {
    lateral: 1,
    girth: 1,
    hipDepth: 1,
    chestTaper: 1,
    armSpread: 1,
    profile: false,
    showsFace: false,
  },
  side: {
    lateral: PROFILE_LATERAL,
    girth: PROFILE_GIRTH,
    hipDepth: PROFILE_HIP_DEPTH,
    chestTaper: PROFILE_CHEST_TAPER,
    armSpread: PROFILE_ARM_SPREAD,
    profile: true,
    showsFace: true,
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
   * toward or away from the camera. A 2D arm has no other way to foreshorten,
   * and without it a hand swung at the viewer stays pinned at one height
   * instead of riding up as the forearm turns out of the picture plane.
   */
  readonly foreScale: number;
}

/**
 * One frame of a Tuskling. Hand and foot positions are targets in figure space
 * that the limb solver reaches for, so the choreography never has to think
 * about joint angles. `left`/`right` are the figure's own; in the profile view
 * the right side is the near one, closest to the camera.
 */
export interface TusklingPose {
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
  /** Head turn, −1 to 1; head-on it slides the face across. */
  headTurn: number;
  /** Head tilt in radians; positive drops the snout toward +X. */
  headTilt: number;
  /**
   * How far the head is driven down and forward off the shoulders, 0 to 1.
   * This is the charge: the tusks lead and the skull hides the chest.
   */
  headThrust: number;
  /** 0 eyes open, 1 shut. */
  blink: number;
  /** Eye bulge past resting size, 0 to 1. */
  glare: number;
  /** 0 closed jaw, 1 full gape. */
  maw: number;
  /** How hard the nostrils flare, 0 to 1. */
  snort: number;
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
   * Which way a knee breaks: +1 bows it away from the centreline, which is
   * what a planted leg does; −1 folds it the other way, which is what a leg
   * driven up in front of the body does.
   */
  leftKneeBreak: number;
  rightKneeBreak: number;
  /**
   * How much a leg points at the camera rather than across it, 0 to 1. At 1 the
   * knee is pulled onto the hip→ankle line and the leg is a straight column
   * that only gets shorter as the foot rises. Head-on both legs want the same
   * value: a bow on one and not the other flickers once per step.
   */
  leftForeshorten: number;
  rightForeshorten: number;
  /**
   * How much nearer the camera a leg's shin is than its thigh, 0 to 1. Unlike
   * `foreshorten` this differs between the legs by design — it only changes
   * widths, so it cues depth without moving a joint.
   */
  leftLegNearness: number;
  rightLegNearness: number;
  /**
   * Which side the elbows break toward: positive puts them behind the body,
   * negative in front. Only the sign is read — the bow itself comes out of
   * where the hand is — so this is `ELBOW_BEHIND` or `ELBOW_IN_FRONT`, never a
   * magnitude, and it must never be interpolated through zero.
   */
  elbowFlare: number;
  /**
   * Drives an arm from its joint angles instead of from a hand target, which is
   * the only way to make the forearm swing *less* than the upper arm. Set, it
   * wins over the hand target and `elbowFlare` for that arm.
   */
  leftArmAngles: ArmAngles | null;
  rightArmAngles: ArmAngles | null;
  /**
   * Whether an arm is on the far side of the torso and so drawn before it.
   * Only consulted head-on; in profile the far arm is always the left one.
   */
  leftArmBehind: boolean;
  rightArmBehind: boolean;
  /** Sideways drift on the spine bristles, −1 to 1. */
  bristleFlow: number;
}

export interface BoneChain {
  root: Pt;
  joint: Pt;
  end: Pt;
}

const HAND_HANG_OUT = 0.13;
export const HAND_HANG_SPREAD = ARM_ROOT_HALF + HAND_HANG_OUT;
/**
 * A relaxed arm reaches nearly, but not quite, its full length. The slack has
 * to be real: the shoulder root swings a little under the idle's lean, and an
 * arm hung at 99% of its reach has the IK clamping on the frames where it does.
 */
const ARM_HANG_REACH = ARM_LENGTH * 0.965;
export const HAND_HANG_DROP =
  SHOULDER_JOINT_DROP + Math.sqrt(ARM_HANG_REACH * ARM_HANG_REACH - HAND_HANG_OUT * HAND_HANG_OUT);
/**
 * Hooves stand under the hips. Any wider and the thighs angle out to reach
 * them, which reads as knock-kneed however subtle the knee itself is.
 */
export const FOOT_STAND_SPREAD = 0.155;
const RESTING_FIST = 0.35;
export const ELBOW_BEHIND = 1;
export const ELBOW_IN_FRONT = -1;
const RESTING_ELBOW_FLARE = ELBOW_BEHIND;

/** A relaxed standing pose. Every animation is written as edits to this. */
export function restingPose(): TusklingPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    crouch: 0,
    twist: 0,
    headTurn: 0,
    headTilt: 0,
    headThrust: 0,
    blink: 0,
    glare: 0,
    maw: 0,
    snort: 0,
    leftHand: pt(-HAND_HANG_SPREAD, SHOULDER_Y + HAND_HANG_DROP),
    rightHand: pt(HAND_HANG_SPREAD, SHOULDER_Y + HAND_HANG_DROP),
    leftFoot: pt(-FOOT_STAND_SPREAD, 0),
    rightFoot: pt(FOOT_STAND_SPREAD, 0),
    leftFist: RESTING_FIST,
    rightFist: RESTING_FIST,
    leftFootPitch: 0,
    rightFootPitch: 0,
    leftKneeBreak: 1,
    rightKneeBreak: 1,
    leftForeshorten: 0,
    rightForeshorten: 0,
    leftLegNearness: 0,
    rightLegNearness: 0,
    elbowFlare: RESTING_ELBOW_FLARE,
    leftArmAngles: null,
    rightArmAngles: null,
    leftArmBehind: false,
    rightArmBehind: false,
    bristleFlow: 0,
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

/**
 * Keeps a fully extended limb from locking into a straight, lifeless line.
 * Tiny, because the joint's sideways travel grows as the square root of it.
 */
export const JOINT_SLACK = 0.0003;

/**
 * Places a two-segment limb so its end sits on `target`. `bendSign` picks which
 * side the joint pops out to: +1 bends it toward +X of the root→target line.
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

/**
 * Pulls a solved leg's knee back onto the hip→ankle line by `amount`, so the
 * leg reads as a column shortening toward the viewer rather than as a hinge
 * swinging sideways.
 */
function foreshortenLeg(chain: BoneChain, amount: number): BoneChain {
  if (amount <= 0) return chain;
  const straightKnee = mixPt(chain.root, chain.end, KNEE_ALONG_LEG);
  return { ...chain, joint: mixPt(chain.joint, straightKnee, clamp01(amount)) };
}

/** The ankle for a hoof planted at `target`: up the leg by the hoof's height. */
function ankleFor(target: Pt, pitch: number): Pt {
  const lifted = rotate({ x: 0, y: ANKLE_Y }, -pitch);
  return offset(target, lifted.x, lifted.y);
}

export { ankleFor };

/**
 * Which side an elbow pops out to. Only the sign is read: the amount of bow an
 * arm actually carries comes from where its hand is, not from this.
 */
function elbowBend(flare: number): number {
  return flare < 0 ? -1 : 1;
}

/**
 * Facing +X, an elbow that bends toward +X is bending forward.
 *
 * Head-on the two arms take opposite bend signs so both elbows bow away from
 * the ribs. Edge-on there is no "away": mirrored signs send one elbow forward
 * along the facing axis and the other backward, and an arm hinged backward is
 * the single most obviously wrong thing a profile can do. In profile both take
 * the same sign, exactly as both knees do.
 */
const PROFILE_ELBOW_FORWARD = -1;

/** Facing +X, a knee that bends toward +X is bending forward. */
const PROFILE_KNEE_FORWARD = -1;
/** A twisted torso narrows on the trailing side and widens on the leading one. */
const TWIST_WIDTH_GAIN = 0.16;
const TWIST_SHOULDER_SHIFT = 0.05;
const CROUCH_DROP = 0.16;
/** How far the thrust carries the head forward and down off its rest point. */
const THRUST_FORWARD = 0.2;
const THRUST_DROP = 0.13;
/**
 * Head-on the thrust has no forward to travel in, so the whole telegraph has to
 * land in the drop — the skull sinking into the shoulders until the tusks sit
 * over the chest.
 */
const FACING_THRUST_DROP_GAIN = 1.5;
/** How far across its own half-width a full head turn slides the face. */
const HEAD_TURN_TRAVEL = 0.5;

interface Skeleton {
  hip: Pt;
  waist: Pt;
  chest: Pt;
  shoulderCentre: Pt;
  headCentre: Pt;
  leftShoulder: Pt;
  rightShoulder: Pt;
  leftLeg: BoneChain;
  rightLeg: BoneChain;
  leftArm: BoneChain;
  rightArm: BoneChain;
}

/** Offset from the hip to a point `height` up the leaning spine. */
function spinePoint(hip: Pt, height: number, lean: number): Pt {
  const rotated = rotate({ x: 0, y: -height }, lean);
  return offset(hip, rotated.x, rotated.y);
}

function buildSkeleton(pose: TusklingPose, view: ViewSpec): Skeleton {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);

  const waist = spinePoint(hip, Math.abs(WAIST_Y - HIP_Y), pose.lean);
  const chest = spinePoint(hip, Math.abs(CHEST_Y - HIP_Y), pose.lean);
  const shoulderCentre = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y), pose.lean);
  const headRest = spinePoint(hip, Math.abs(HEAD_CENTRE_Y - HIP_Y), pose.lean);
  // The thrust carries the skull forward only in profile: head-on "forward" is
  // toward the camera, which is a drop and a swell, not a slide across the
  // screen — carried sideways there it reads as the head coming off the neck.
  const thrustForward = view.profile ? pose.headThrust * THRUST_FORWARD : 0;
  const headCentre = offset(
    headRest,
    pose.headTurn * HEAD_RX * view.lateral * HEAD_TURN_TRAVEL + thrustForward,
    pose.headThrust * THRUST_DROP * (view.profile ? 1 : FACING_THRUST_DROP_GAIN),
  );

  const twistShift = pose.twist * TWIST_SHOULDER_SHIFT * view.lateral;
  const armRoot = ARM_ROOT_HALF * view.armSpread;
  const leftHalf = armRoot * (1 - pose.twist * TWIST_WIDTH_GAIN);
  const rightHalf = armRoot * (1 + pose.twist * TWIST_WIDTH_GAIN);
  const leftShoulder = offset(shoulderCentre, -leftHalf + twistShift, SHOULDER_JOINT_DROP);
  const rightShoulder = offset(shoulderCentre, rightHalf + twistShift, SHOULDER_JOINT_DROP);
  const legRootHalf = LEG_ROOT_HALF * view.lateral;

  return {
    hip,
    waist,
    chest,
    shoulderCentre,
    headCentre,
    leftShoulder,
    rightShoulder,
    // Head-on the two knees take opposite bend signs so both bow outward; in
    // profile they take the same sign, because "away from the centreline" would
    // hinge one of them backward, which no leg does.
    leftLeg: foreshortenLeg(
      solveTwoBone(
        offset(hip, -legRootHalf, 0),
        ankleFor(pose.leftFoot, pose.leftFootPitch),
        THIGH_LENGTH,
        SHIN_LENGTH,
        view.profile ? PROFILE_KNEE_FORWARD * pose.leftKneeBreak : pose.leftKneeBreak,
      ),
      pose.leftForeshorten,
    ),
    rightLeg: foreshortenLeg(
      solveTwoBone(
        offset(hip, legRootHalf, 0),
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
            view.profile
              ? PROFILE_ELBOW_FORWARD * elbowBend(pose.elbowFlare)
              : elbowBend(pose.elbowFlare),
          )
        : armFromAngles(leftShoulder, pose.leftArmAngles),
    rightArm:
      pose.rightArmAngles === null
        ? solveTwoBone(
            rightShoulder,
            pose.rightHand,
            UPPER_ARM_LENGTH,
            FOREARM_LENGTH,
            view.profile
              ? PROFILE_ELBOW_FORWARD * elbowBend(pose.elbowFlare)
              : -elbowBend(pose.elbowFlare),
          )
        : armFromAngles(rightShoulder, pose.rightArmAngles),
  };
}

/** The solved arm chain, so the bake gates measure what the painter draws. */
export function solvedArm(
  pose: TusklingPose,
  view: TusklingView,
  side: 'left' | 'right',
): BoneChain {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftArm : skeleton.rightArm;
}

/** Where a leg roots, for the gate that checks the leg never over-reaches. */
export function solvedLegRoot(pose: TusklingPose, view: TusklingView, side: 'left' | 'right'): Pt {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftLeg.root : skeleton.rightLeg.root;
}

/** The head's centre in figure space, for the gate that checks the charge. */
export function solvedHeadCentre(pose: TusklingPose, view: TusklingView): Pt {
  return buildSkeleton(pose, VIEWS[view]).headCentre;
}

// ── Painting primitives ──────────────────────────────────────────────────────

const OUTLINE_BLEED = 0.028;
const TWO_PI = Math.PI * 2;

function traceCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const angle = angleBetween(a, b);
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  ctx.beginPath();
  ctx.arc(a.x, a.y, wa, angle + Math.PI / 2, angle - Math.PI / 2);
  ctx.lineTo(b.x + nx * -wb, b.y + ny * -wb);
  ctx.arc(b.x, b.y, wb, angle - Math.PI / 2, angle + Math.PI / 2);
  ctx.closePath();
}

function fillCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number, fill: string): void {
  traceCapsule(ctx, a, b, wa, wb);
  ctx.fillStyle = fill;
  ctx.fill();
}

function outlineCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  fillCapsule(ctx, a, b, wa + OUTLINE_BLEED, wb + OUTLINE_BLEED, OUTLINE);
}

function traceEllipse(ctx: Ctx, centre: Pt, rx: number, ry: number, rotation = 0): void {
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, Math.max(rx, 0), Math.max(ry, 0), rotation, 0, TWO_PI);
}

function fillEllipse(
  ctx: Ctx,
  centre: Pt,
  rx: number,
  ry: number,
  fill: string,
  rotation = 0,
): void {
  traceEllipse(ctx, centre, rx, ry, rotation);
  ctx.fillStyle = fill;
  ctx.fill();
}

function outlineEllipse(ctx: Ctx, centre: Pt, rx: number, ry: number, rotation = 0): void {
  fillEllipse(ctx, centre, rx + OUTLINE_BLEED, ry + OUTLINE_BLEED, OUTLINE, rotation);
}

/**
 * `node-canvas` discards an `rgba()` whose alpha serialises in exponent
 * notation, baking a solid smear where a vanishing wash was meant.
 */
const MIN_ALPHA = 0.002;

function washed(colour: string, alpha: number): string {
  return rgba(colour, alpha < MIN_ALPHA ? 0 : alpha);
}

const LIGHT_LENGTH = Math.hypot(LIGHT.x, LIGHT.y);
/** How wide the sheen stroke is against the limb it runs down. */
const SHEEN_WIDTH_SHARE = 0.7;

/**
 * Strokes a highlight down the lit side of a limb segment.
 *
 * The offset is the *projection* of the light onto the limb's normal rather
 * than a side picked by the sign of that projection. Choosing a side is a
 * binary flip, and a limb that rocks through perpendicular-to-the-light — which
 * every near-vertical limb does under a one-degree idle sway — teleports its
 * highlight across itself on one frame. Projecting slides it through the middle
 * and fades it out as it passes.
 */
function sheenSegment(ctx: Ctx, a: Pt, b: Pt, width: number, colour: string, alpha: number): void {
  const angle = angleBetween(a, b);
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  const towardLight = (nx * LIGHT.x + ny * LIGHT.y) / LIGHT_LENGTH;
  const shift = width * towardLight;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * shift, a.y + ny * shift);
  ctx.lineTo(b.x + nx * shift, b.y + ny * shift);
  ctx.strokeStyle = washed(colour, alpha * Math.abs(towardLight));
  ctx.lineWidth = width * SHEEN_WIDTH_SHARE;
  ctx.lineCap = 'round';
  ctx.stroke();
}

interface LimbShape {
  readonly root: number;
  readonly joint: number;
  readonly belly: number;
  readonly tip: number;
  readonly bellyAt: number;
}

const ARM_SHAPE: LimbShape = {
  root: UPPER_ARM_WIDTH,
  joint: ELBOW_WIDTH,
  belly: ELBOW_WIDTH,
  tip: WRIST_WIDTH,
  bellyAt: 0.24,
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
 * knee is nearer the viewer than the thigh is, so it reads larger, not smaller:
 * the knee stops pinching and the calf's swell slides down the shin.
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

const LIMB_SHEEN_ALPHA = 0.3;

/**
 * Draws a two-segment limb. The lower segment is two capsules rather than one
 * so the joint pinches and the belly of the muscle swells — drawn as a single
 * taper a limb is a traffic cone.
 */
function drawLimb(ctx: Ctx, chain: BoneChain, shape: LimbShape, shade: number): void {
  const belly = mixPt(chain.joint, chain.end, shape.bellyAt);
  const skin = limbTone(HIDE.mid, shade);
  const lit = limbTone(HIDE.light, Math.max(0, shade));

  outlineCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint);
  outlineCapsule(ctx, chain.joint, belly, shape.joint, shape.belly);
  outlineCapsule(ctx, belly, chain.end, shape.belly, shape.tip);

  fillCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint, skin);
  fillCapsule(ctx, chain.joint, belly, shape.joint, shape.belly, skin);
  fillCapsule(ctx, belly, chain.end, shape.belly, shape.tip, skin);

  sheenSegment(ctx, chain.root, chain.joint, shape.root, lit, LIMB_SHEEN_ALPHA);
  sheenSegment(ctx, chain.joint, belly, shape.belly, lit, LIMB_SHEEN_ALPHA);
}

const SHADOW_RX = 0.3;
const SHADOW_RY = 0.09;
const SHADOW_FOLLOW = 0.4;

function drawGroundShadow(ctx: Ctx, centreX: number, alpha: number): void {
  // A gradient resolves in the user space it is painted in, so it has to be
  // built here rather than hoisted to module scope.
  const gradient = ctx.createRadialGradient(centreX, 0, 0, centreX, 0, SHADOW_RX);
  gradient.addColorStop(0, washed('#000000', alpha));
  gradient.addColorStop(1, washed('#000000', 0));
  ctx.save();
  ctx.translate(centreX, 0);
  ctx.scale(1, SHADOW_RY / SHADOW_RX);
  ctx.translate(-centreX, 0);
  ctx.beginPath();
  ctx.arc(centreX, 0, SHADOW_RX, 0, TWO_PI);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

// ── Hooves ───────────────────────────────────────────────────────────────────

const HOOF_LENGTH = 0.14;
const HOOF_HEIGHT = 0.085;
const HOOF_BACK = 0.05;
/** Splits the hoof into two toes, which is what stops it reading as a boot. */
const CLEFT_WIDTH = 0.012;

/**
 * A blunt keratin wedge, not a foot. Toes drawn as separate strokes read as
 * sandal straps at this size, so the split is a notch in the silhouette.
 */
function drawHoof(ctx: Ctx, ankle: Pt, pitch: number, toeOut: number, profile: boolean): void {
  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(pitch);

  const forward = profile ? HOOF_LENGTH : HOOF_LENGTH * 0.72;
  const back = profile ? HOOF_BACK : HOOF_BACK * 0.8;
  const lead = profile ? 0 : toeOut;

  const trace = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(-back - grow, -HOOF_HEIGHT * 0.5);
    ctx.lineTo(forward * 0.6 + lead + grow, -HOOF_HEIGHT - grow);
    ctx.lineTo(forward + lead + grow, -HOOF_HEIGHT * 0.35);
    ctx.lineTo(forward * 0.92 + lead + grow, grow);
    ctx.lineTo(-back - grow, grow);
    ctx.closePath();
  };

  trace(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  trace(0);
  ctx.fillStyle = HOOF.mid;
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  fillEllipse(
    ctx,
    pt(forward * 0.5 + lead, -HOOF_HEIGHT * 0.9),
    forward * 0.5,
    HOOF_HEIGHT * 0.4,
    HOOF.light,
  );
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(forward * 0.45 + lead, -HOOF_HEIGHT * 0.2);
  ctx.lineTo(forward * 0.95 + lead, HOOF_HEIGHT * 0.05);
  ctx.strokeStyle = HOOF.dark;
  ctx.lineWidth = CLEFT_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.restore();
}

const LEFT_FOOT_OUT = -0.024;
const RIGHT_FOOT_OUT = 0.024;

function drawLeg(
  ctx: Ctx,
  chain: BoneChain,
  pitch: number,
  view: ViewSpec,
  toeOut: number,
  nearness: number,
): void {
  drawLimb(ctx, chain, legShapeFor(nearness), UNSHADED);
  drawHoof(ctx, chain.end, pitch, toeOut, view.profile);
}

// ── Hands ────────────────────────────────────────────────────────────────────

/**
 * Big enough to be a mass in the silhouette. A hand no wider than the wrist it
 * hangs off turns the arm into a uniform tube ending in a rounded stump, which
 * is the plush-toy read; the knuckle has to be a hard corner in the outline.
 */
const HAND_LENGTH = FOREARM_LENGTH * 0.44;
const HAND_WIDTH = HAND_LENGTH * 0.82;
const FIST_WIDTH = HAND_LENGTH * 1.06;
const KNUCKLE_COUNT = 3;
/** A hand stays rigid relative to the body while the forearm swings under it. */
const WRIST_FOLLOW = 0.3;

function drawHand(ctx: Ctx, chain: BoneChain, fist: number, shade: number): void {
  const alongArm = angleBetween(chain.root, chain.end);
  const alongForearm = angleBetween(chain.joint, chain.end);
  const wristAngle = lerp(alongArm, alongForearm, WRIST_FOLLOW);
  const closed = clamp01(fist);
  const halfWidth = lerp(HAND_WIDTH, FIST_WIDTH, closed) * 0.5;
  const length = HAND_LENGTH * lerp(1, 0.78, closed);
  const skin = limbTone(HIDE.mid, shade);

  ctx.save();
  ctx.translate(chain.end.x, chain.end.y);
  ctx.rotate(wristAngle - Math.PI / 2);

  outlineEllipse(ctx, pt(0, length * 0.5), halfWidth, length * 0.62);
  fillEllipse(ctx, pt(0, length * 0.5), halfWidth, length * 0.62, skin);

  // Every knuckle reads `closed`: a digit pinned at its open-hand fan throws a
  // stub out of a closed fist that reads as a stray extra finger.
  for (let i = 0; i < KNUCKLE_COUNT; i++) {
    const across = ((i + 0.5) / KNUCKLE_COUNT - 0.5) * halfWidth * 1.7;
    const reach = length * lerp(1.05, 0.62, closed);
    ctx.beginPath();
    ctx.moveTo(across, length * 0.55);
    ctx.lineTo(across * lerp(1, 0.8, closed), reach);
    ctx.strokeStyle = limbTone(HIDE.dark, Math.max(0, shade));
    ctx.lineWidth = halfWidth * 0.34;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

function drawArm(ctx: Ctx, chain: BoneChain, fist: number, shade: number): void {
  drawLimb(ctx, chain, ARM_SHAPE, shade);
  drawHand(ctx, chain, fist, shade);
}

// ── Torso ────────────────────────────────────────────────────────────────────

/** How much of the shoulder half-width the flat top of the trunk spans. */
const SHOULDER_SHELF_SHARE = 0.62;
/** How far the shelf domes up between the two shoulder points. */
const SHOULDER_CROWN = 0.06;
const BRISTLE_COUNT = 7;
const BRISTLE_HEIGHT = 0.075;
const BRISTLE_LEAN = 0.5;
const BRISTLE_SEED = 17.3;
/**
 * How far out along the spine's perpendicular a bristle roots, as a share of
 * the trunk's half-width there. Under 1 so every stroke starts inside the ink:
 * one that starts on the edge floats clear of it the moment the body leans, and
 * a detached dash behind a sprinting creature reads as a speed line.
 */
const BRISTLE_ON_EDGE = 0.76;
/** How much of the shoulder span the ridge covers seen from behind. */
const BACK_RIDGE_SPAN = 0.9;
/** How far a bristle may wander off its even slot along the spine. */
const BRISTLE_JITTER = 0.5;
/** What is left of a bristle's length by the hips. */
const BRISTLE_HIP_TAPER = 0.35;
const MASS_SHADE_ALPHA = 0.42;
const MASS_LIGHT_ALPHA = 0.26;
const MASS_SHADE_OFFSET = 0.3;

/**
 * The trunk, traced as one closed path from hips to shoulders so the barrel
 * reads as a single mass. Tracing each lobe separately cuts a visible seam
 * down the silhouette.
 */
function traceTorso(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, grow: number): void {
  const shoulderHalf = SHOULDER_HALF * view.girth * view.chestTaper + grow;
  const chestHalf = CHEST_HALF * view.girth * view.chestTaper + grow;
  const waistHalf = WAIST_HALF * view.girth + grow;
  const hipHalf = HIP_HALF * view.girth * view.hipDepth + grow;

  const shoulder = skeleton.shoulderCentre;
  const chest = skeleton.chest;
  const waist = skeleton.waist;
  const hip = skeleton.hip;
  const topY = shoulder.y - SHOULDER_JOINT_DROP - grow;
  const bottom = offset(hip, 0, grow + HIP_HALF * 0.12);
  // A shelf, not a dome. Converging the two shoulder edges onto a single apex
  // gives a smooth egg with no shoulders in it at all, and the arms then read
  // as hanging off a sack.
  const shelfHalf = shoulderHalf * SHOULDER_SHELF_SHARE;

  ctx.beginPath();
  ctx.moveTo(shoulder.x - shelfHalf, topY);
  ctx.quadraticCurveTo(
    shoulder.x,
    topY - shoulderHalf * SHOULDER_CROWN,
    shoulder.x + shelfHalf,
    topY,
  );
  ctx.quadraticCurveTo(shoulder.x + shoulderHalf, topY, shoulder.x + shoulderHalf, shoulder.y);
  ctx.quadraticCurveTo(chest.x + chestHalf, chest.y, waist.x + waistHalf, waist.y);
  ctx.quadraticCurveTo(hip.x + hipHalf, hip.y, bottom.x + hipHalf * 0.72, bottom.y);
  ctx.quadraticCurveTo(bottom.x, bottom.y + hipHalf * 0.25, bottom.x - hipHalf * 0.72, bottom.y);
  ctx.quadraticCurveTo(hip.x - hipHalf, hip.y, waist.x - waistHalf, waist.y);
  ctx.quadraticCurveTo(chest.x - chestHalf, chest.y, shoulder.x - shoulderHalf, shoulder.y);
  ctx.quadraticCurveTo(shoulder.x - shoulderHalf, topY, shoulder.x - shelfHalf, topY);
  ctx.closePath();
}

const MOTTLE_COUNT = 10;
const MOTTLE_ALPHA = 0.22;
const MOTTLE_SEED = 41.9;
const BELLY_ALPHA = 0.62;
const PECTORAL_ALPHA = 0.3;
const BELLY_FOLDS = 3;
const CROTCH_ALPHA = 0.45;

/** Dark blotching over the hide, clipped to it. A flat field of pink is a toy. */
function mottleTorso(ctx: Ctx, skeleton: Skeleton, spread: number): void {
  ctx.globalAlpha = MOTTLE_ALPHA;
  ctx.fillStyle = HIDE.dark;
  for (let i = 0; i < MOTTLE_COUNT; i++) {
    const x = skeleton.chest.x + (hash1(i + MOTTLE_SEED) - 0.5) * 2 * spread;
    const y = lerp(skeleton.shoulderCentre.y, skeleton.hip.y, hash1(i * 3.1 + MOTTLE_SEED));
    const rx = spread * (0.1 + hash1(i * 7.7 + MOTTLE_SEED) * 0.14);
    fillEllipse(ctx, pt(x, y), rx, rx * 0.6, HIDE.dark, hash1(i * 2.3) * Math.PI);
  }
  ctx.globalAlpha = 1;
}

function drawTorso(ctx: Ctx, skeleton: Skeleton, pose: TusklingPose, view: ViewSpec): void {
  traceTorso(ctx, skeleton, view, OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  traceTorso(ctx, skeleton, view, 0);
  ctx.fillStyle = HIDE.mid;
  ctx.fill();

  const torsoHeight = Math.abs(skeleton.shoulderCentre.y - skeleton.hip.y);
  const half = SHOULDER_HALF * view.girth;

  ctx.save();
  traceTorso(ctx, skeleton, view, 0);
  ctx.clip();

  if (view.profile) {
    // Edge-on the pale underside is a narrow strip along the belly line, not a
    // panel: seen from the side almost all of what faces the camera is flank.
    ctx.globalAlpha = BELLY_ALPHA;
    fillEllipse(
      ctx,
      offset(mixPt(skeleton.chest, skeleton.hip, 0.6), half * 0.42, 0),
      half * 0.34,
      torsoHeight * 0.32,
      BELLY.mid,
    );
    ctx.globalAlpha = 1;
  } else if (view.showsFace) {
    // A tapered panel rather than a disc. A bright ball on the stomach is the
    // loudest thing on the figure and reads as a target painted on it.
    const bellyTop = mixPt(skeleton.chest, skeleton.hip, 0.15);
    const bellyBottom = mixPt(skeleton.chest, skeleton.hip, 1.05);
    ctx.globalAlpha = BELLY_ALPHA;
    ctx.beginPath();
    ctx.moveTo(bellyTop.x - half * 0.34, bellyTop.y);
    ctx.quadraticCurveTo(
      bellyTop.x + half * 0.52,
      mixPt(bellyTop, bellyBottom, 0.5).y,
      bellyBottom.x + half * 0.3,
      bellyBottom.y,
    );
    ctx.lineTo(bellyBottom.x - half * 0.3, bellyBottom.y);
    ctx.quadraticCurveTo(
      bellyTop.x - half * 0.52,
      mixPt(bellyTop, bellyBottom, 0.5).y,
      bellyTop.x - half * 0.34,
      bellyTop.y,
    );
    ctx.closePath();
    ctx.fillStyle = BELLY.mid;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = washed(BELLY.dark, 0.4);
    ctx.lineWidth = torsoHeight * 0.02;
    for (let i = 1; i <= BELLY_FOLDS; i++) {
      const fold = mixPt(bellyTop, bellyBottom, i / (BELLY_FOLDS + 1));
      ctx.beginPath();
      ctx.moveTo(fold.x - half * 0.3, fold.y);
      ctx.quadraticCurveTo(fold.x, fold.y + torsoHeight * 0.03, fold.x + half * 0.3, fold.y);
      ctx.stroke();
    }

    // Two heavy slabs of chest under the shoulder shelf.
    ctx.globalAlpha = PECTORAL_ALPHA;
    for (const side of [-1, 1]) {
      fillEllipse(
        ctx,
        offset(skeleton.chest, side * half * 0.46, -torsoHeight * 0.18),
        half * 0.4,
        torsoHeight * 0.22,
        HIDE.dark,
      );
    }
    ctx.globalAlpha = 1;
  } else {
    // From behind, two shoulder blades and nothing down the middle: a single
    // dark stripe along the spine is a back seam, not an animal.
    ctx.globalAlpha = PECTORAL_ALPHA;
    for (const side of [-1, 1]) {
      fillEllipse(
        ctx,
        offset(skeleton.chest, side * half * 0.48, -torsoHeight * 0.12),
        half * 0.34,
        torsoHeight * 0.2,
        HIDE.dark,
      );
    }
    ctx.globalAlpha = 1;
  }

  mottleTorso(ctx, skeleton, half * 0.85);

  const shadeCentre = offset(
    skeleton.chest,
    -LIGHT.x * half * MASS_SHADE_OFFSET,
    -LIGHT.y * half * MASS_SHADE_OFFSET,
  );
  ctx.globalAlpha = MASS_SHADE_ALPHA;
  fillEllipse(ctx, shadeCentre, half, torsoHeight * 0.62, HIDE.dark);
  ctx.globalAlpha = MASS_LIGHT_ALPHA;
  fillEllipse(
    ctx,
    offset(skeleton.chest, LIGHT.x * half * MASS_SHADE_OFFSET, LIGHT.y * half * MASS_SHADE_OFFSET),
    half * 0.5,
    torsoHeight * 0.28,
    HIDE.light,
  );
  ctx.globalAlpha = 1;

  // The crease the legs come out of. Without it the trunk's hem is a straight
  // edge and the thighs read as two pegs pushed into the bottom of a barrel.
  if (!view.profile) {
    const crotch = offset(skeleton.hip, 0, HIP_HALF * 0.14);
    ctx.strokeStyle = washed(HIDE.dark, CROTCH_ALPHA);
    ctx.lineWidth = HIP_HALF * 0.11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(crotch.x - HIP_HALF * 0.55, crotch.y - HIP_HALF * 0.3);
    ctx.lineTo(crotch.x, crotch.y);
    ctx.lineTo(crotch.x + HIP_HALF * 0.55, crotch.y - HIP_HALF * 0.3);
    ctx.stroke();
  }
  ctx.restore();

  drawBristles(ctx, skeleton, pose, view);
}

/**
 * The mane, and only where it breaks the silhouette.
 *
 * Head-on there is no mane at all: a row of short strokes across the top of the
 * chest is a line of stitches, and a stroke down the middle of the back is a
 * back seam. Both were drawn, and both read as a stuffed animal. Edge-on and
 * from behind the ridge is real, and it earns its place by sticking out past
 * the outline rather than by being drawn on top of it.
 */
function drawBristles(ctx: Ctx, skeleton: Skeleton, pose: TusklingPose, view: ViewSpec): void {
  if (!view.profile && view.showsFace) return;
  const top = skeleton.shoulderCentre;
  const bottom = skeleton.waist;
  // Rooted on the spine and offset along its own perpendicular. Held at a fixed
  // x instead, the ridge stays put while a leaning or thrusting body slides out
  // from under it, and the strokes float clear of the back as speed lines.
  const spineAngle = angleBetween(bottom, top);
  const outX = Math.cos(spineAngle + Math.PI / 2);
  const outY = Math.sin(spineAngle + Math.PI / 2);
  const shoulderBack = SHOULDER_HALF * view.girth * view.chestTaper * BRISTLE_ON_EDGE;
  const waistBack = WAIST_HALF * view.girth * BRISTLE_ON_EDGE;
  ctx.strokeStyle = BRISTLE;
  ctx.lineCap = 'round';
  for (let i = 0; i < BRISTLE_COUNT; i++) {
    // Uneven in spacing and in length, and dying away toward the hips. Six
    // marks of one length at one pitch down a straight edge is a row of
    // stitches, and no amount of colour argues a viewer out of that read.
    const even = (i + 0.5) / BRISTLE_COUNT;
    const t = clamp01(even + (hash1(i * 3.7 + BRISTLE_SEED) - 0.5) * BRISTLE_JITTER);
    const taper = lerp(1, BRISTLE_HIP_TAPER, t);
    const height = BRISTLE_HEIGHT * taper * (0.45 + hash1(i + BRISTLE_SEED) * 1.35);
    const onSpine = mixPt(top, bottom, t);
    const backHalf = lerp(shoulderBack, waistBack, t);
    const root = view.profile
      ? offset(onSpine, outX * backHalf, outY * backHalf)
      : pt(top.x + (t - 0.5) * SHOULDER_HALF * BACK_RIDGE_SPAN, top.y - SHOULDER_JOINT_DROP);
    const tip = view.profile
      ? offset(root, outX * height, outY * height - height * 0.45)
      : offset(root, pose.bristleFlow * BRISTLE_LEAN * height, -height);
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.quadraticCurveTo(
      (root.x + tip.x) / 2 + outX * height * 0.2,
      (root.y + tip.y) / 2,
      tip.x,
      tip.y,
    );
    ctx.lineWidth = height * 0.26;
    ctx.stroke();
  }
}

// ── Head ─────────────────────────────────────────────────────────────────────
// Everything below is drawn in the head's own local space: the caller has
// already translated to `headCentre` and rotated by the tilt.

/**
 * The muzzle is blunt and deep, never long. A snout carried far enough forward
 * to read as a snout reads as a beak instead; what says "warthog" is the width
 * of the thing and the tusks around it, not its reach.
 */
const MUZZLE_Y = HEAD_RY * 0.4;
const MUZZLE_RX = HEAD_RX * 0.7;
const MUZZLE_RY = HEAD_RY * 0.38;
const PROFILE_MUZZLE_OUT = HEAD_DEPTH * 0.95;
const PROFILE_MUZZLE_RX = HEAD_DEPTH * 0.5;
const SNOUT_DISC_R = HEAD_RX * 0.46;
const NOSTRIL_R = SNOUT_DISC_R * 0.28;
const NOSTRIL_SPREAD = SNOUT_DISC_R * 0.44;
const SNORT_FLARE = 0.35;

/**
 * Leaf-shaped and swept back, not two round lobes on the crown. Round ears at
 * ten and two o'clock are Mickey placement and no amount of colour undoes it.
 */
const EAR_RX = HEAD_RX * 0.22;
const EAR_RY = HEAD_RY * 0.52;
const EAR_TILT = deg(74);

const EYE_RX = HEAD_RX * 0.22;
const EYE_RY = HEAD_RY * 0.17;
const EYE_SPREAD = HEAD_RX * 0.66;
const EYE_Y = -HEAD_RY * 0.2;
const GLARE_GAIN = 0.3;
/** Below this the eye carries no highlight at all: a glint is an angry eye. */
const GLINT_FROM = 0.55;
/** How much of the eye's own width a closed lid spans. */
const BLINK_LID_SHARE = 0.8;
/** Below this the eye is drawn as a lid line rather than as an ellipse. */
const SHUT_EYE_HEIGHT = 0.004;
const BROW_THICKNESS = HEAD_RX * 0.13;

/**
 * Fat enough to survive the downsample. At a 32 px tile a feature under about
 * four sheet pixels disappears, and the tusks are the one shape that has to
 * read at that size — they are what tells a player which pink lump this is.
 */
const TUSK_ROOT_WIDTH = HEAD_RX * 0.14;
const TUSK_TIP_WIDTH = HEAD_RX * 0.03;
const TUSK_SEGMENTS = 8;
/** How much of the front pair survives the turn away from the camera. */
const AWAY_TUSK_SCALE = 0.66;
/** Where the far side's tusk sits relative to the near one, and how dim it is. */
const FAR_TUSK_BACK = 0.36;
const FAR_TUSK_LIFT = 0.2;
const FAR_TUSK_SCALE = 0.66;
const FAR_TUSK_SHADE = 0.26;
/** Half a far limb's shade: a tusk tip seen from behind is turned, not hidden. */
const AWAY_TUSK_SHADE = FAR_LIMB_SHADE * 0.5;

/**
 * A tapered horn swept along a quadratic spine, drawn as a closed polygon
 * rather than a stroked curve: a stroke of varying width is not a shape the
 * canvas can express, and the taper is most of what says "tusk".
 */
function drawTusk(ctx: Ctx, root: Pt, control: Pt, tip: Pt, shade: number): void {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= TUSK_SEGMENTS; i++) {
    const t = i / TUSK_SEGMENTS;
    const inv = 1 - t;
    const point = pt(
      inv * inv * root.x + 2 * inv * t * control.x + t * t * tip.x,
      inv * inv * root.y + 2 * inv * t * control.y + t * t * tip.y,
    );
    const ahead = pt(
      2 * inv * (control.x - root.x) + 2 * t * (tip.x - control.x),
      2 * inv * (control.y - root.y) + 2 * t * (tip.y - control.y),
    );
    const len = Math.hypot(ahead.x, ahead.y) || 1;
    const nx = -ahead.y / len;
    const ny = ahead.x / len;
    const width = lerp(TUSK_ROOT_WIDTH, TUSK_TIP_WIDTH, t * t);
    left.push(pt(point.x + nx * width, point.y + ny * width));
    right.push(pt(point.x - nx * width, point.y - ny * width));
  }

  const centroid = pt(
    (left.reduce((sum, p) => sum + p.x, 0) + right.reduce((sum, p) => sum + p.x, 0)) /
      (left.length + right.length),
    (left.reduce((sum, p) => sum + p.y, 0) + right.reduce((sum, p) => sum + p.y, 0)) /
      (left.length + right.length),
  );

  // Grown from the shape's own centroid: pushing each edge along a hand-picked
  // axis instead pinches the outline shut at whichever end the axis points away
  // from, and the tip loses its ink.
  const trace = (grow: number): void => {
    const push = (p: Pt): Pt => {
      if (grow === 0) return p;
      const dx = p.x - centroid.x;
      const dy = p.y - centroid.y;
      const len = Math.hypot(dx, dy) || 1;
      return pt(p.x + (dx / len) * grow, p.y + (dy / len) * grow);
    };
    ctx.beginPath();
    const first = push(left[0]);
    ctx.moveTo(first.x, first.y);
    for (const p of left) {
      const g = push(p);
      ctx.lineTo(g.x, g.y);
    }
    for (let i = right.length - 1; i >= 0; i--) {
      const g = push(right[i]);
      ctx.lineTo(g.x, g.y);
    }
    ctx.closePath();
  };

  trace(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  trace(0);
  ctx.fillStyle = mix(TUSK.mid, OUTLINE, shade);
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = washed(mix(TUSK.light, OUTLINE, shade), 0.85);
  ctx.lineWidth = TUSK_ROOT_WIDTH * 0.7;
  ctx.stroke();
  ctx.restore();
}

/**
 * The long front pair, rooted at the jaw corners. They sweep up and out and
 * then hook back in so the two tips cross over the snout — the "four crossed
 * tusks" of the description, and the read that has to survive a 32 px tile.
 */
function drawFacingFrontTusk(ctx: Ctx, side: number, shade: number): void {
  const root = pt(side * MUZZLE_RX * 0.78, MUZZLE_Y + MUZZLE_RY * 0.5);
  const control = pt(side * HEAD_RX * 1.34, MUZZLE_Y - HEAD_RY * 0.08);
  const tip = pt(side * HEAD_RX * 1.12, MUZZLE_Y - HEAD_RY * 0.86);
  drawTusk(ctx, root, control, tip, shade);
}

/** The short rear pair, sweeping down and out to scissor across the front pair. */
function drawFacingRearTusk(ctx: Ctx, side: number, shade: number): void {
  const root = pt(side * HEAD_RX * 0.6, MUZZLE_Y - MUZZLE_RY * 0.55);
  const control = pt(side * HEAD_RX * 1.16, MUZZLE_Y + HEAD_RY * 0.1);
  const tip = pt(side * HEAD_RX * 1.02, MUZZLE_Y + HEAD_RY * 0.52);
  drawTusk(ctx, root, control, tip, shade);
}

/**
 * The near front tusk: out of the lower jaw, forward and up, tip ahead of the
 * snout rather than over it. Swept back across the muzzle it lies on the face
 * and the three profile tusks fuse into one cream hook.
 */
function drawProfileFrontTusk(ctx: Ctx, shade: number): void {
  const root = pt(PROFILE_MUZZLE_OUT * 0.9, MUZZLE_Y + MUZZLE_RY * 0.45);
  const control = pt(PROFILE_MUZZLE_OUT * 1.75, MUZZLE_Y - HEAD_RY * 0.1);
  const tip = pt(PROFILE_MUZZLE_OUT * 1.62, -HEAD_RY * 0.42);
  drawTusk(ctx, root, control, tip, shade);
}

/**
 * The near rear tusk, sweeping down and forward across the front one. Its tip
 * stops above the jaw line: carried below it the tusk hangs under the chin as a
 * separate lump that reads as neither tusk nor lip.
 */
function drawProfileRearTusk(ctx: Ctx, shade: number): void {
  const root = pt(PROFILE_MUZZLE_OUT * 0.42, MUZZLE_Y - MUZZLE_RY * 0.7);
  const control = pt(PROFILE_MUZZLE_OUT * 1.02, MUZZLE_Y - MUZZLE_RY * 0.15);
  const tip = pt(PROFILE_MUZZLE_OUT * 1.16, MUZZLE_Y + HEAD_RY * 0.26);
  drawTusk(ctx, root, control, tip, shade);
}

function drawEye(ctx: Ctx, centre: Pt, blink: number, glare: number): void {
  const open = 1 - clamp01(blink);
  const rx = EYE_RX * (1 + glare * GLARE_GAIN);
  const ry = EYE_RY * (1 + glare * GLARE_GAIN) * open;
  if (ry <= SHUT_EYE_HEIGHT) {
    // Confined to the eye's own width, and without the socket behind it. The
    // socket plus the brow plus a full-width lid is three horizontal bars
    // across the face, which reads as a slotted visor rather than as a blink.
    ctx.beginPath();
    ctx.moveTo(centre.x - rx * BLINK_LID_SHARE, centre.y);
    ctx.lineTo(centre.x + rx * BLINK_LID_SHARE, centre.y);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = EYE_RY * 0.55;
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }
  // A sunken socket, then a solid black lozenge. The source says black eyes,
  // and the pale sclera with a white specular dot that was here instead is the
  // single most reliable cute-mammal cue there is.
  fillEllipse(ctx, centre, rx * 1.7, ry * 1.8, HIDE.dark);
  fillEllipse(ctx, centre, rx, ry, EYE);
  if (glare > GLINT_FROM) {
    fillEllipse(
      ctx,
      offset(centre, -rx * 0.34, -ry * 0.3),
      rx * 0.2,
      ry * 0.24,
      washed(EYE_SPARK, (glare - GLINT_FROM) / (1 - GLINT_FROM)),
    );
  }
}

/** A heavy brow ridge. Without one the eyes float on a bare dome. */
function drawBrow(ctx: Ctx, side: number, glare: number): void {
  const inner = pt(side * EYE_SPREAD * 0.3, EYE_Y - EYE_RY * (1.6 + glare * 0.8));
  const outer = pt(side * EYE_SPREAD * 1.5, EYE_Y - EYE_RY * (2.4 - glare * 0.6));
  ctx.beginPath();
  ctx.moveTo(inner.x, inner.y);
  ctx.lineTo(outer.x, outer.y);
  ctx.strokeStyle = HIDE.dark;
  ctx.lineWidth = BROW_THICKNESS;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * The rostrum. Broad and flat, never round: a circular disc with two centred
 * dots is the snout every cartoon pig has, and it is worth more of the
 * creature's menace than any amount of shading elsewhere can buy back.
 */
const SNOUT_ASPECT = 0.44;

function drawSnoutDisc(ctx: Ctx, centre: Pt, snort: number, profile: boolean): void {
  const flare = 1 + snort * SNORT_FLARE;
  const rx = SNOUT_DISC_R * (profile ? 0.78 : 1) * flare;
  const ry = SNOUT_DISC_R * SNOUT_ASPECT * flare;
  outlineEllipse(ctx, centre, rx, ry);
  fillEllipse(ctx, centre, rx, ry, SNOUT.mid);
  const spread = NOSTRIL_SPREAD * (profile ? 0.5 : 1) * flare;
  for (const side of [-1, 1]) {
    fillEllipse(
      ctx,
      offset(centre, side * spread, 0),
      NOSTRIL_R * (profile ? 0.85 : 1),
      NOSTRIL_R * 1.2,
      NOSTRIL,
    );
  }
}

const MAW_DROP = HEAD_RY * 0.36;
const LOWER_TOOTH_COUNT = 4;
/** Below this the jaw is drawn as a lip line rather than as an opening. */
const SHUT_JAW = 0.01;

function drawMaw(ctx: Ctx, maw: number, profile: boolean): void {
  const lipY = MUZZLE_Y + MUZZLE_RY * 0.5;
  if (maw <= SHUT_JAW) {
    ctx.beginPath();
    if (profile) {
      ctx.moveTo(PROFILE_MUZZLE_OUT * 0.15, lipY);
      ctx.lineTo(PROFILE_MUZZLE_OUT + PROFILE_MUZZLE_RX * 0.8, lipY - MUZZLE_RY * 0.15);
    } else {
      ctx.moveTo(-MUZZLE_RX * 0.6, lipY);
      ctx.lineTo(MUZZLE_RX * 0.6, lipY);
    }
    ctx.strokeStyle = SNOUT.dark;
    ctx.lineWidth = HEAD_RY * 0.07;
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }

  const drop = MAW_DROP * maw;
  const halfWidth = profile ? PROFILE_MUZZLE_RX * 0.9 : MUZZLE_RX * 0.66;
  const centre = pt(profile ? PROFILE_MUZZLE_OUT * 0.7 : 0, lipY + drop * 0.5);
  outlineEllipse(ctx, centre, halfWidth, drop * 0.62);
  fillEllipse(ctx, centre, halfWidth, drop * 0.62, MAW_INNER);

  ctx.save();
  traceEllipse(ctx, centre, halfWidth, drop * 0.62);
  ctx.clip();
  for (let i = 0; i < LOWER_TOOTH_COUNT; i++) {
    const across = ((i + 0.5) / LOWER_TOOTH_COUNT - 0.5) * halfWidth * 1.7;
    ctx.beginPath();
    ctx.moveTo(centre.x + across, centre.y + drop * 0.62);
    ctx.lineTo(centre.x + across, centre.y + drop * 0.1);
    ctx.strokeStyle = TOOTH;
    ctx.lineWidth = halfWidth * 0.18;
    ctx.stroke();
  }
  ctx.restore();
}

/** One pointed ear, traced as a leaf so its tip is a corner in the outline. */
function traceEar(ctx: Ctx, grow: number, rx: number, ry: number): void {
  const wide = rx + grow;
  const tall = ry + grow;
  ctx.beginPath();
  ctx.moveTo(0, tall);
  ctx.quadraticCurveTo(-wide, tall * 0.3, 0, -tall);
  ctx.quadraticCurveTo(wide, tall * 0.3, 0, tall);
  ctx.closePath();
}

function drawEar(ctx: Ctx, centre: Pt, tilt: number, rx: number, ry: number): void {
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(tilt);
  traceEar(ctx, OUTLINE_BLEED, rx, ry);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  traceEar(ctx, 0, rx, ry);
  ctx.fillStyle = HIDE.dark;
  ctx.fill();
  traceEar(ctx, -rx * 0.42, rx * 0.5, ry * 0.62);
  ctx.fillStyle = mix(HIDE.mid, SNOUT.dark, 0.5);
  ctx.fill();
  ctx.restore();
}

function drawFacingEars(ctx: Ctx, showsFace: boolean): void {
  const y = -HEAD_RY * 0.22;
  for (const side of [-1, 1]) {
    const centre = pt(side * HEAD_RX * 0.92, y);
    drawEar(ctx, centre, side * EAR_TILT * (showsFace ? 1 : -1), EAR_RX, EAR_RY);
  }
}

/** The profile ear sits on the back of the skull and so is painted over it. */
function drawProfileEar(ctx: Ctx): void {
  drawEar(ctx, pt(-HEAD_DEPTH * 0.62, -HEAD_RY * 0.3), -EAR_TILT * 1.25, EAR_RX * 0.8, EAR_RY);
}

/**
 * The crest, which is the whole read from behind.
 *
 * Enough strokes, close enough together, to be a mane. Three tall thin ones on
 * a bare dome are antennae — the creature has hair nowhere else, so a sparse
 * crown of spikes reads as something stuck to it rather than growing from it.
 */
const SCALP_BRISTLE_COUNT = 13;

function drawScalpBristles(ctx: Ctx, flow: number, halfWidth: number): void {
  ctx.strokeStyle = BRISTLE;
  ctx.lineCap = 'round';
  for (let i = 0; i < SCALP_BRISTLE_COUNT; i++) {
    const t = (i + 0.5) / SCALP_BRISTLE_COUNT;
    const x = (t - 0.5) * halfWidth * 1.85;
    const height = BRISTLE_HEIGHT * (0.4 + hash1(i + BRISTLE_SEED * 2) * 0.5);
    const y = -Math.sqrt(Math.max(0, 1 - Math.min(1, (x / halfWidth) ** 2))) * HEAD_RY;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + flow * height * BRISTLE_LEAN, y - height);
    ctx.lineWidth = height * 0.26;
    ctx.stroke();
  }
}

function shadeSkull(ctx: Ctx, rx: number, ry: number): void {
  ctx.save();
  traceEllipse(ctx, pt(0, 0), rx, ry);
  ctx.clip();
  ctx.globalAlpha = MASS_SHADE_ALPHA;
  fillEllipse(ctx, pt(-LIGHT.x * rx * 0.55, -LIGHT.y * ry * 0.55), rx * 0.92, ry * 0.92, HIDE.dark);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawHeadFacing(ctx: Ctx, pose: TusklingPose, showsFace: boolean): void {
  const farShade = showsFace ? UNSHADED : AWAY_TUSK_SHADE;
  drawFacingEars(ctx, showsFace);
  // The rear pair sits behind the skull; the front pair crosses over it.
  for (const side of [-1, 1]) drawFacingRearTusk(ctx, side, farShade);
  if (!showsFace) {
    // Scaled down as well as painted first: at full length the tips still clear
    // the skull far enough to read as two cream blocks on the back of its head.
    ctx.save();
    ctx.scale(AWAY_TUSK_SCALE, AWAY_TUSK_SCALE);
    for (const side of [-1, 1]) drawFacingFrontTusk(ctx, side, farShade);
    ctx.restore();
  }

  outlineEllipse(ctx, pt(0, 0), HEAD_RX, HEAD_RY);
  fillEllipse(ctx, pt(0, 0), HEAD_RX, HEAD_RY, HIDE.mid);
  shadeSkull(ctx, HEAD_RX, HEAD_RY);

  if (showsFace) {
    outlineEllipse(ctx, pt(0, MUZZLE_Y), MUZZLE_RX, MUZZLE_RY);
    fillEllipse(ctx, pt(0, MUZZLE_Y), MUZZLE_RX, MUZZLE_RY, SNOUT.mid);
    drawMaw(ctx, pose.maw, false);
    drawSnoutDisc(ctx, pt(0, MUZZLE_Y - MUZZLE_RY * 0.2), pose.snort, false);
    for (const side of [-1, 1]) {
      drawBrow(ctx, side, pose.glare);
      drawEye(ctx, pt(side * EYE_SPREAD, EYE_Y), pose.blink, pose.glare);
    }
  } else {
    drawScalpBristles(ctx, pose.bristleFlow, HEAD_RX);
  }

  // From behind, the front pair goes down *before* the skull so only the tips
  // that clear its outline show. Painted over it the back of the head carries a
  // full set of front-facing crescents and the away row becomes indistinguish-
  // able from the toward row — which is a gameplay bug, not only an art one.
  if (showsFace) {
    for (const side of [-1, 1]) drawFacingFrontTusk(ctx, side, UNSHADED);
  }
}

/**
 * The profile skull, its blunt muzzle traced as one path with it so the two
 * read as a single head rather than as a ball with a lump stuck on the front.
 */
function traceProfileHead(ctx: Ctx, grow: number): void {
  const backX = -HEAD_DEPTH - grow;
  const topY = -HEAD_RY - grow;
  const jawY = MUZZLE_Y + MUZZLE_RY + grow;
  const snoutX = PROFILE_MUZZLE_OUT + PROFILE_MUZZLE_RX + grow;
  const browX = HEAD_DEPTH * 0.72 + grow;

  // The step down from the brow to the bridge is what makes the muzzle read as
  // a separate mass: run the two into one curve and the head is an egg.
  const bridgeY = MUZZLE_Y - MUZZLE_RY * 1.15;
  ctx.beginPath();
  ctx.moveTo(backX, -HEAD_RY * 0.1);
  ctx.quadraticCurveTo(backX, topY, 0, topY);
  ctx.quadraticCurveTo(browX, topY, browX, bridgeY - MUZZLE_RY * 0.35);
  ctx.quadraticCurveTo(browX * 1.05, bridgeY, PROFILE_MUZZLE_OUT * 0.75, bridgeY);
  ctx.quadraticCurveTo(snoutX, bridgeY + MUZZLE_RY * 0.1, snoutX, MUZZLE_Y);
  ctx.quadraticCurveTo(snoutX, jawY, PROFILE_MUZZLE_OUT * 0.6, jawY);
  ctx.quadraticCurveTo(-HEAD_DEPTH * 0.5, jawY, backX, HEAD_RY * 0.3);
  ctx.closePath();
}

/**
 * The far side's front tusk alone, offset up and back off the near pair.
 *
 * Only one, and only the front one. The far *rear* tusk landed under the jaw
 * where it fused with the near pair into a single grey mass — a mid-value lump
 * that reads as neither tusk nor lip, and that made the profile impossible to
 * count tusks in. One clearly separated cream stroke behind the near pair is
 * what says "there are more of these on the other side".
 */
function drawProfileFarTusks(ctx: Ctx): void {
  ctx.save();
  ctx.translate(-HEAD_DEPTH * FAR_TUSK_BACK, -HEAD_RY * FAR_TUSK_LIFT);
  ctx.scale(FAR_TUSK_SCALE, FAR_TUSK_SCALE);
  drawProfileFrontTusk(ctx, FAR_TUSK_SHADE);
  ctx.restore();
}

function drawHeadProfile(ctx: Ctx, pose: TusklingPose): void {
  traceProfileHead(ctx, OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  traceProfileHead(ctx, 0);
  ctx.fillStyle = HIDE.mid;
  ctx.fill();

  ctx.save();
  traceProfileHead(ctx, 0);
  ctx.clip();
  ctx.globalAlpha = MASS_SHADE_ALPHA;
  fillEllipse(
    ctx,
    pt(-LIGHT.x * HEAD_DEPTH * 0.5, -LIGHT.y * HEAD_RY * 0.5),
    HEAD_DEPTH,
    HEAD_RY,
    HIDE.dark,
  );
  ctx.globalAlpha = 1;
  // The muzzle takes the paler snout tone so the head has a front to it.
  fillEllipse(
    ctx,
    pt(PROFILE_MUZZLE_OUT * 0.75, MUZZLE_Y),
    PROFILE_MUZZLE_RX * 1.5,
    MUZZLE_RY * 1.05,
    SNOUT.mid,
  );
  ctx.restore();

  drawProfileEar(ctx);
  // All four tusks are in the profile, and the far pair is painted over the
  // skull rather than behind it: a head this deep hides anything drawn under
  // it, and the profile then shows one tusk where the design calls for four.
  drawProfileFarTusks(ctx);
  drawMaw(ctx, pose.maw, true);
  drawSnoutDisc(
    ctx,
    pt(PROFILE_MUZZLE_OUT + PROFILE_MUZZLE_RX * 0.7, MUZZLE_Y - MUZZLE_RY * 0.15),
    pose.snort,
    true,
  );
  drawBrow(ctx, 1, pose.glare);
  drawEye(ctx, pt(HEAD_DEPTH * 0.4, EYE_Y), pose.blink, pose.glare);
  // The near rear tusk goes down before the near front one, so the front one's
  // own ink draws the dark line that separates them. Painted the other way
  // round the two fuse into a single cream hook and nothing can be counted.
  drawProfileRearTusk(ctx, UNSHADED);
  drawProfileFrontTusk(ctx, UNSHADED);
}

// ── Rim light ────────────────────────────────────────────────────────────────

const RIM_WIDTH = 0.016;

/**
 * One continuous stroke up the lit side, hip → chest → skull, so the three
 * masses read as a single silhouette rather than as stacked blobs.
 */
function drawRimLight(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const side = LIGHT.x >= 0 ? 1 : -1;
  const hipEdge = offset(skeleton.hip, side * HIP_HALF * view.girth * view.hipDepth, 0);
  const chestEdge = offset(skeleton.chest, side * CHEST_HALF * view.girth * view.chestTaper, 0);
  const shoulderEdge = offset(
    skeleton.shoulderCentre,
    side * SHOULDER_HALF * view.girth * view.chestTaper * 0.8,
    -SHOULDER_JOINT_DROP,
  );

  // The stroke stops at the shoulder. Carried on to the skull it has to cross
  // whatever gap the head's own pose has opened, and on a charge — where the
  // head is thrust forward and down — that span becomes a long free-floating
  // arc over the creature's back that reads as a leash.
  ctx.beginPath();
  ctx.moveTo(hipEdge.x, hipEdge.y);
  ctx.quadraticCurveTo(chestEdge.x, chestEdge.y, shoulderEdge.x, shoulderEdge.y);
  ctx.strokeStyle = washed(RIM_LIGHT, RIM_ALPHA);
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ── Assembly ─────────────────────────────────────────────────────────────────

const SHADOW_LIFT_FADE = 2.4;
const SHADOW_LIFT_SHRINK = 0.7;
const HEAD_LEAN_FOLLOW = 0.25;
/** How wide the throat is where it meets the chest and where it meets the jaw. */
const THROAT_ROOT_SHARE = 0.42;
const THROAT_TOP_SHARE = 0.5;
/** How far up into the skull the throat reaches, so the two never separate. */
const THROAT_OVERLAP = 0.3;

/**
 * The wedge of muscle between the jaw and the chest.
 *
 * The description's "heads that sit too close to their shoulders" is a
 * silhouette with nothing between the two, and a head placed close enough to
 * look right standing still still opens a gap the moment a pose leans, turns or
 * thrusts it. Painting the gap shut is the only thing that holds across every
 * frame; a strut narrow enough to show reads as a leash.
 */
function drawThroat(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const rootHalf = SHOULDER_HALF * view.girth * THROAT_ROOT_SHARE;
  const topHalf = HEAD_RX * view.girth * THROAT_TOP_SHARE;
  const top = offset(skeleton.headCentre, 0, HEAD_RY * THROAT_OVERLAP);
  // Painted *under* the trunk and unstroked. Inked, its two sides show through
  // as a U across the chest and read as a collar or a bib; the trunk drawn over
  // it leaves only the wedge behind the jaw, which is all that was wanted.
  fillCapsule(ctx, skeleton.shoulderCentre, top, rootHalf, topHalf, mix(HIDE.mid, HIDE.dark, 0.45));
}

function drawFigure(ctx: Ctx, view: ViewSpec, pose: TusklingPose): void {
  const skeleton = buildSkeleton(pose, view);

  // The *lower* of the two hooves, and +Y is down, so this is a `max`. Taking
  // the min picks whichever hoof is highest and fades the shadow once a stride
  // while the other one is still planted on the floor.
  const lift = Math.max(0, -Math.max(pose.leftFoot.y, pose.rightFoot.y));
  const shadowFade = clamp01(1 - lift * SHADOW_LIFT_FADE);
  drawGroundShadow(
    ctx,
    skeleton.hip.x * SHADOW_FOLLOW,
    CONTACT_SHADOW_ALPHA * lerp(SHADOW_LIFT_SHRINK, 1, shadowFade),
  );

  // The figure's left side is the far one. Seen edge-on that arm is genuinely
  // behind the torso; head-on it hangs in front like the near one, and drawing
  // it early is what makes a figure look one-armed. Bare hide takes no depth
  // shade outside the profile — there it reads as two colours of skin.
  const farArmShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  const leftBehind = view.profile || pose.leftArmBehind;
  const rightBehind = !view.profile && pose.rightArmBehind;
  if (leftBehind) drawArm(ctx, skeleton.leftArm, pose.leftFist, farArmShade);
  if (rightBehind) drawArm(ctx, skeleton.rightArm, pose.rightFist, farArmShade);

  drawLeg(ctx, skeleton.leftLeg, pose.leftFootPitch, view, LEFT_FOOT_OUT, pose.leftLegNearness);
  drawLeg(ctx, skeleton.rightLeg, pose.rightFootPitch, view, RIGHT_FOOT_OUT, pose.rightLegNearness);

  drawThroat(ctx, skeleton, view);
  drawTorso(ctx, skeleton, pose, view);
  drawRimLight(ctx, skeleton, view);

  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(pose.headTilt + pose.lean * HEAD_LEAN_FOLLOW);
  if (view.profile) drawHeadProfile(ctx, pose);
  else drawHeadFacing(ctx, pose, view.showsFace);
  ctx.restore();

  if (!leftBehind) drawArm(ctx, skeleton.leftArm, pose.leftFist, farArmShade);
  if (!rightBehind)
    drawArm(ctx, skeleton.rightArm, pose.rightFist, view.profile ? NEAR_LIMB_LIFT : UNSHADED);
}

/** Head-on, coming at the camera. */
export function drawTusklingFront(ctx: Ctx, pose: TusklingPose): void {
  drawFigure(ctx, VIEWS.front, pose);
}

/** From behind, walking away. */
export function drawTusklingBack(ctx: Ctx, pose: TusklingPose): void {
  drawFigure(ctx, VIEWS.back, pose);
}

/** In profile. Always drawn facing +X; the runtime mirrors for the left. */
export function drawTusklingSide(ctx: Ctx, pose: TusklingPose): void {
  drawFigure(ctx, VIEWS.side, pose);
}
