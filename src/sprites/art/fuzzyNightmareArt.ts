/**
 * Drawing engine for the Fuzzy Nightmare — the thing that lives under the bed,
 * grown up, coming up through the floor grates.
 *
 * The read the whole design serves is a child's nightmare made real: a gaunt
 * thing folded almost double, its spine arching up above its own shoulders and
 * its head slung low and forward in front of them, with arms so long the
 * fingers nearly brush the floor. It creeps on crouched, digitigrade legs. Its
 * coat is matted near-black with a violet cast, and at the edge of the
 * silhouette it frays into smoky wisps, so the outline seems to bleed into the
 * dark it hides in.
 *
 * The face is what makes it frightening rather than sad: a mouth far too wide
 * for the skull, always a little open on a row of needle teeth in dull bone,
 * and two small, deep-set pinprick eyes with a pale-gold shine. Big round eyes
 * make anything look sweet; two points of light in a dark socket do not.
 *
 * Three viewpoints are drawn: `front` (toward the camera), `back` (away) and
 * `side` (profile, always facing +X so the runtime can mirror it). All three
 * read the same {@link FuzzyNightmarePose}; the choreography that fills that
 * pose lives in `fuzzyNightmareFigure.ts`.
 *
 * Coordinates are tile units with the origin at the point between the feet and
 * +Y pointing down the screen, so heights above the ground are negative — the
 * same frame the biped rig (`biped/rig.ts`) uses, and for the same reason: the
 * generator translates to that ground point, scales by one tile, and calls a
 * painter.
 *
 * The rig's structure — the `ViewSpec` table, hand and foot targets solved by a
 * two-bone IK with FK escape hatches for swinging arms, and every pose written
 * as edits to one resting pose — is taken from `biped/rig.ts`, the only figure
 * in this game whose movement convinces. The anatomy on top of it is not.
 */

import { hash1 } from './ratArt';
import { type Pt, clamp01, clampAlpha, deg, lerp, mix, rgba } from './bipedArt';

type Ctx = CanvasRenderingContext2D;

export type { Pt };

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

export function pt(x: number, y: number): Pt {
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

// ── Palette ──────────────────────────────────────────────────────────────────

interface Ramp {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
}

/**
 * Matted near-black with a violet cast. The ramp bottoms out above true black
 * because the dungeon floor is itself nearly black: painted at black the
 * creature is a hole in the picture rather than a thing standing in it, and
 * the read is carried by {@link RIM_LIGHT} down the lit edge.
 */
const FUR: Ramp = {
  dark: '#0e0a14',
  mid: '#221a2f',
  light: '#3a2f50',
};

const OUTLINE = '#060409';

/** A cold violet edge that separates the body from an unlit floor. */
const RIM_LIGHT = '#9a8cc4';
const RIM_ALPHA = 0.85;
const SHEEN_ALPHA = 0.3;
const CONTACT_SHADOW_ALPHA = 0.45;

/** The smoke the coat frays into, lighter than the coat so it shows at all. */
const WISP = '#3b2f50';

/**
 * Pale gold, not amber: amber is warm and animal, while a pale cold point of
 * light in a black socket is what a child sees from the bed.
 */
const EYE_SHINE = '#f6e4a2';
const EYE_GLOW = '#d8b55a';
const EYE_SOCKET = '#030205';

const MAW_INNER = '#1a0710';
/** Dull bone rather than white: clean white teeth read as a cartoon grin. */
const TOOTH = '#c4b697';
const CLAW_LIT = '#bfb29a';
const CLAW_DARK = '#5f5648';
/** The vertebrae pressing up through the coat along the arch of the back. */
const VERTEBRA = '#41355a';

/** The rubble and void of a floor it has broken up through. */
const VOID = '#05050a';
const SLAB = '#4b4855';
const SLAB_DARK = '#2c2b36';
const SLAB_EDGE = '#77738a';

/** Where the key light comes from, as a direction in figure space. */
const LIGHT: Pt = { x: -0.6, y: -0.8 };

/** How far a far-side limb is pushed toward the outline so it recedes. */
const FAR_LIMB_SHADE = 0.45;
/** Painted at its own ramp, with nothing mixed toward the outline. */
const UNSHADED = 0;

// ── Proportions ──────────────────────────────────────────────────────────────

/**
 * Hip height standing. Low, because it never stands up straight: the legs are
 * folded under it at the knee and the hock, and the height of the thing is in
 * its arched back, not in its legs.
 */
export const HIP_Y = -0.92;

/**
 * A point on the spine, measured from the hip: `forward` toward the way it
 * faces, `up` above the hip. The spine is laid out in this plane and only then
 * projected into a view, so a lean tips the whole back about the hip the same
 * way in every view.
 */
interface SpineNode {
  readonly forward: number;
  readonly up: number;
}

/**
 * The spine at rest. It rises from the hip, arches to its highest point over
 * the middle of the back, and then falls *forward and down* through the
 * shoulders to a head carried lower than either — which is the hunch.
 */
const LOWER_BACK: SpineNode = { forward: -0.05, up: 0.34 };
const HUMP: SpineNode = { forward: 0.06, up: 0.78 };
const SHOULDER: SpineNode = { forward: 0.3, up: 0.5 };
const NECK: SpineNode = { forward: 0.46, up: 0.34 };
const HEAD: SpineNode = { forward: 0.64, up: 0.16 };
/**
 * Where the neck and head go when it cranes up — out of a hole, the head has to
 * clear the floor ahead of the hump, so it is lifted above it.
 */
const RAISED_NECK: SpineNode = { forward: 0.38, up: 0.76 };
const RAISED_HEAD: SpineNode = { forward: 0.46, up: 1.02 };

/** How far the coat stands above the spine at the top of the hump. */
const HUMP_DORSAL = 0.2;

/** The shoulder line poses write their hand targets against, at rest. */
export const SHOULDER_Y = HIP_Y - SHOULDER.up;
/** How far forward of the hip the shoulders hang in profile, at rest. */
export const SHOULDER_X_PROFILE = SHOULDER.forward;

/** Floor to the top of the arched back: what the creature measures, standing. */
const FIGURE_HEIGHT = Math.abs(HIP_Y) + HUMP.up + HUMP_DORSAL;

export const THIGH_LENGTH = 0.44;
export const SHIN_LENGTH = 0.44;
/**
 * The long bone between the hock and the ball of the foot. It is what makes the
 * leg digitigrade: the creature stands on its toes with the hock raised behind
 * it, so the leg folds into a Z rather than a column.
 */
const METATARSAL_BACK = 0.1;
const METATARSAL_RISE = 0.24;

/**
 * Arms long enough that hanging from a hunched shoulder the fingertips nearly
 * brush the floor. Set against the shoulder height rather than any anatomical
 * ratio, because wrong is the point.
 */
export const UPPER_ARM_LENGTH = 0.62;
export const FOREARM_LENGTH = 0.56;
export const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

/**
 * A shoulder joint sits below the shoulder *line* poses write against. Hanging
 * a hand at exactly `ARM_LENGTH` below the line therefore leaves the solver
 * slack, and a two-bone solver spends slack throwing the elbow out sideways.
 */
const SHOULDER_JOINT_DROP = 0.04;

/** Where the arms root head-on: out at the bony points of the shoulders. */
export const ARM_ROOT_HALF = 0.36;
/** Where the legs root head-on, under a pelvis that is narrow and gaunt. */
const LEG_ROOT_HALF = 0.13;

/** Limb widths: wiry, with knobbed joints. */
const THIGH_WIDTH = 0.095;
const KNEE_WIDTH = 0.045;
const SHIN_WIDTH = 0.05;
const HOCK_WIDTH = 0.034;
const METATARSAL_WIDTH = 0.028;
const UPPER_ARM_WIDTH = 0.044;
const ELBOW_WIDTH = 0.034;
const FOREARM_WIDTH = 0.036;
const WRIST_WIDTH = 0.026;

// ── Views ────────────────────────────────────────────────────────────────────

export type FuzzyNightmareView = 'front' | 'back' | 'side';

interface ViewSpec {
  /** Multiplier on where the legs root either side of the hip. */
  readonly lateral: number;
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

/** Side-on, the limbs gather toward the centreline instead of splaying wide. */
const PROFILE_LATERAL = 0.3;
const PROFILE_ARM_SPREAD = 0.14;

const VIEWS: Record<FuzzyNightmareView, ViewSpec> = {
  front: { lateral: 1, armSpread: 1, profile: false, showsFace: true },
  back: { lateral: 1, armSpread: 1, profile: false, showsFace: false },
  side: { lateral: PROFILE_LATERAL, armSpread: PROFILE_ARM_SPREAD, profile: true, showsFace: true },
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
   * and without it a hand swung at the viewer stays pinned at the same height
   * instead of riding up as the forearm turns out of the picture plane.
   */
  readonly foreScale: number;
}

/**
 * One frame of a Fuzzy Nightmare. Hand and foot positions are targets in figure
 * space that the limb solver reaches for, so the choreography never has to
 * think about joint angles. `left`/`right` are the creature's own left and
 * right; in the profile view the right side is the near one, closest to the
 * camera. A foot target is the ball of the foot, which is what it stands on.
 */
export interface FuzzyNightmarePose {
  /** Whole-body vertical offset; negative lifts it off the ground. */
  bob: number;
  /** Hip shift along X — weight transfer, not a step. */
  sway: number;
  /** Spine lean in radians about the hip; positive tips the shoulders toward +X. */
  lean: number;
  /** 0 at its usual crouch, 1 sunk deep onto its haunches. */
  crouch: number;
  /** Shoulder rotation about the spine, −1 to 1, seen as a width shift. */
  twist: number;
  /** Head turn, −1 to 1; in the head-on views it slides the face across. */
  headTurn: number;
  /** Head tilt in radians. */
  headTilt: number;
  /** 0 slung low in front of the shoulders, 1 craned up above the hump. */
  headRaise: number;
  /** 0 eyes open, 1 shut. */
  blink: number;
  /** How hard the eyes burn, 0 to 1. */
  glare: number;
  /** 0 the mouth's resting part, 1 a full gape. */
  maw: number;
  leftHand: Pt;
  rightHand: Pt;
  leftFoot: Pt;
  rightFoot: Pt;
  /** 0 fingers curled, 1 fingers fully splayed, per hand. */
  leftClaw: number;
  rightClaw: number;
  /** Foot pitch in radians about the ball of the foot; positive lifts the hock. */
  leftFootPitch: number;
  rightFootPitch: number;
  /**
   * Which way a knee breaks: +1 bows it away from the body's centreline, which
   * is what a planted leg does; −1 folds it the other way.
   */
  leftKneeBreak: number;
  rightKneeBreak: number;
  /**
   * How much a leg is pointed at the camera rather than across it, 0 to 1. At 1
   * the knee is pulled onto the hip→hock line. Head-on there is no single right
   * answer for a folded leg, so both legs of a head-on pose want the same value:
   * a splay that shows on one leg and not the other flickers once per step.
   */
  leftForeshorten: number;
  rightForeshorten: number;
  /**
   * How much nearer the camera a leg's shin is than its thigh, 0 to 1. Unlike
   * `foreshorten` this differs between the two legs by design: it only changes
   * widths, so it cues depth without moving a joint.
   */
  leftLegNearness: number;
  rightLegNearness: number;
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
   * Whether an arm is on the far side of the body and so drawn before it. Only
   * consulted head-on; in profile the far arm is always the left one.
   */
  leftArmBehind: boolean;
  rightArmBehind: boolean;
  /** Sideways drift on the coat and its smoke, −1 to 1. */
  furFlow: number;
  /** Slow shimmer through the coat, in radians, so the fur is never static. */
  furPhase: number;
  /**
   * How much of the creature is still below the floor, 0 to 1. Everything below
   * the floor line is clipped away, so this is the only pose value that changes
   * what is drawn rather than where.
   */
  submerged: number;
  /**
   * Paints the smashed floor the creature is coming up through. Sized to one
   * tile, because the defend quest paints this over a floor grate and a hole
   * wider than the grate reads as the room falling in.
   */
  breach: boolean;
}

/**
 * How far outboard of its own shoulder root a relaxed wrist hangs head-on.
 * Wide: hung straight down from the shoulders the two arms are a pair of extra
 * legs beside the real ones, and at a 32px tile the creature reads as a table
 * on four sticks. Splayed out past the feet they read as arms.
 */
const HAND_HANG_OUT = 0.1;
export const HAND_HANG_SPREAD = ARM_ROOT_HALF + HAND_HANG_OUT;
/**
 * Just inside the arm's own reach, so the IK has nothing left to bend. Measured
 * from the shoulder *joint* and with the outboard hang taken off it, because
 * even a few hundredths of leftover slack is spent bowing the elbow sideways.
 */
const ARM_HANG_REACH = ARM_LENGTH * 0.99;
export const HAND_HANG_DROP =
  SHOULDER_JOINT_DROP + Math.sqrt(ARM_HANG_REACH * ARM_HANG_REACH - HAND_HANG_OUT * HAND_HANG_OUT);

/**
 * The crouched stance is wide: a creature this top-heavy and this folded needs
 * its feet well apart to stay over them.
 */
export const FOOT_STAND_SPREAD = 0.2;

/** How far a relaxed hand's fingers are spread. */
export const RESTING_CLAW = 0.3;
/** The break a relaxed elbow holds, which keeps the arm off the ribs. */
export const RESTING_ELBOW_FLARE = 0.3;

/** A relaxed crouch. Every animation is written as edits to this. */
export function restingPose(): FuzzyNightmarePose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    crouch: 0,
    twist: 0,
    headTurn: 0,
    headTilt: 0,
    headRaise: 0,
    blink: 0,
    glare: 0,
    maw: 0,
    leftHand: pt(-HAND_HANG_SPREAD, SHOULDER_Y + HAND_HANG_DROP),
    rightHand: pt(HAND_HANG_SPREAD, SHOULDER_Y + HAND_HANG_DROP),
    leftFoot: pt(-FOOT_STAND_SPREAD, 0),
    rightFoot: pt(FOOT_STAND_SPREAD, 0),
    leftClaw: RESTING_CLAW,
    rightClaw: RESTING_CLAW,
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
    furFlow: 0,
    furPhase: 0,
    submerged: 0,
    breach: false,
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export interface BoneChain {
  root: Pt;
  joint: Pt;
  end: Pt;
}

/**
 * Keeps a fully extended limb from locking into a straight, lifeless line.
 * Tiny, because the joint's sideways travel grows as the square root of it.
 */
export const JOINT_SLACK = 0.0003;

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
 * Pulls a solved leg's knee back toward the hip→hock line by `amount`, so a
 * head-on leg reads as folding toward the viewer rather than as a hinge swung
 * flat out to the side. See {@link FuzzyNightmarePose.leftForeshorten}.
 */
function foreshortenLeg(chain: BoneChain, amount: number): BoneChain {
  if (amount <= 0) return chain;
  const straightKnee = mixPt(chain.root, chain.end, KNEE_ALONG_LEG);
  return { ...chain, joint: mixPt(chain.joint, straightKnee, clamp01(amount)) };
}

interface Skeleton {
  hip: Pt;
  lowerBack: Pt;
  hump: Pt;
  shoulderCentre: Pt;
  neck: Pt;
  headCentre: Pt;
  leftShoulder: Pt;
  rightShoulder: Pt;
  leftLeg: BoneChain;
  rightLeg: BoneChain;
  leftArm: BoneChain;
  rightArm: BoneChain;
}

/** How much of the hip height a full crouch removes. */
const CROUCH_DROP = 0.34;
/** Facing +X, a knee that bends toward +X is bending forward. */
const PROFILE_KNEE_FORWARD = -1;
/** A twisted body narrows on the trailing side and widens on the leading one. */
const TWIST_WIDTH_GAIN = 0.16;
const TWIST_SHOULDER_SHIFT = 0.07;
/** How far the head slides across the body when the pose turns it. */
const HEAD_TURN_TRAVEL = 0.1;

/**
 * The hock for a foot whose ball is planted at `target`: up the metatarsal and,
 * in profile, back behind it. Head-on that bone points at the camera, so all
 * that is left of it is its height.
 */
export function hockFor(target: Pt, pitch: number, view: FuzzyNightmareView): Pt {
  const back = VIEWS[view].profile ? METATARSAL_BACK : 0;
  const raised = rotate({ x: -back, y: -METATARSAL_RISE }, -pitch);
  return offset(target, raised.x, raised.y);
}

function elbowBend(flare: number): number {
  return flare < 0 ? -1 : 1;
}

/** Forward kinematics for an arm: shoulder angle, then elbow angle. */
function armFromAngles(shoulder: Pt, angles: ArmAngles): BoneChain {
  const upper = rotate({ x: 0, y: UPPER_ARM_LENGTH }, -angles.upper);
  const joint = offset(shoulder, upper.x, upper.y);
  const fore = rotate({ x: 0, y: FOREARM_LENGTH * angles.foreScale }, -angles.fore);
  return { root: shoulder, joint, end: offset(joint, fore.x, fore.y) };
}

function blendNode(a: SpineNode, b: SpineNode, t: number): SpineNode {
  return { forward: lerp(a.forward, b.forward, t), up: lerp(a.up, b.up, t) };
}

/**
 * A spine node tipped by the lean about the hip and projected into the view.
 * Head-on the forward axis points at the camera and is lost; what a lean does
 * from there is lower the back, which is exactly what a hunch looks like coming
 * at you.
 */
function project(hip: Pt, node: SpineNode, lean: number, view: ViewSpec): Pt {
  const forward = node.forward * Math.cos(lean) + node.up * Math.sin(lean);
  const up = node.up * Math.cos(lean) - node.forward * Math.sin(lean);
  return pt(hip.x + (view.profile ? forward : 0), hip.y - up);
}

function buildSkeleton(pose: FuzzyNightmarePose, view: ViewSpec): Skeleton {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);
  const raise = clamp01(pose.headRaise);

  const lowerBack = project(hip, LOWER_BACK, pose.lean, view);
  const hump = project(hip, HUMP, pose.lean, view);
  const shoulderCentre = project(hip, SHOULDER, pose.lean, view);
  const neck = project(hip, blendNode(NECK, RAISED_NECK, raise), pose.lean, view);
  const headCentre = offset(
    project(hip, blendNode(HEAD, RAISED_HEAD, raise), pose.lean, view),
    view.profile ? 0 : pose.headTurn * HEAD_TURN_TRAVEL,
    0,
  );

  const twistShift = pose.twist * TWIST_SHOULDER_SHIFT * view.lateral;
  const armRoot = ARM_ROOT_HALF * view.armSpread;
  const leftHalf = armRoot * (1 - pose.twist * TWIST_WIDTH_GAIN);
  const rightHalf = armRoot * (1 + pose.twist * TWIST_WIDTH_GAIN);

  const leftShoulder = offset(shoulderCentre, -leftHalf + twistShift, SHOULDER_JOINT_DROP);
  const rightShoulder = offset(shoulderCentre, rightHalf + twistShift, SHOULDER_JOINT_DROP);
  const legRootHalf = LEG_ROOT_HALF * view.lateral;
  const viewName: FuzzyNightmareView = view.profile ? 'side' : 'front';

  return {
    hip,
    lowerBack,
    hump,
    shoulderCentre,
    neck,
    headCentre,
    leftShoulder,
    rightShoulder,
    // Head-on a folded knee breaks *away* from the centreline; signed the other
    // way the knees knock together. Edge-on both knees break forward, and the
    // hock behind the ball of the foot is what folds the leg back again.
    leftLeg: foreshortenLeg(
      solveTwoBone(
        offset(hip, -legRootHalf, 0),
        hockFor(pose.leftFoot, pose.leftFootPitch, viewName),
        THIGH_LENGTH,
        SHIN_LENGTH,
        view.profile ? PROFILE_KNEE_FORWARD * pose.leftKneeBreak : pose.leftKneeBreak,
      ),
      pose.leftForeshorten,
    ),
    rightLeg: foreshortenLeg(
      solveTwoBone(
        offset(hip, legRootHalf, 0),
        hockFor(pose.rightFoot, pose.rightFootPitch, viewName),
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

/**
 * The solved arm for one side of a pose, so the bake gates can measure the same
 * chain the painter draws rather than a second copy of the maths.
 */
export function solvedArm(
  pose: FuzzyNightmarePose,
  view: FuzzyNightmareView,
  side: 'left' | 'right',
): BoneChain {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftArm : skeleton.rightArm;
}

/**
 * Where one leg actually roots, for the reach-headroom gate. Not the hip
 * *centre*: the roots sit either side of it, and a gate measuring from the
 * centre reads that offset as reach the leg does not have.
 */
export function solvedLegRoot(
  pose: FuzzyNightmarePose,
  view: FuzzyNightmareView,
  side: 'left' | 'right',
): Pt {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftLeg.root : skeleton.rightLeg.root;
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

const SHEEN_OFFSET = 0.45;
const SHEEN_WIDTH = 0.32;
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
  const baseAlpha = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha * alpha;
  fillCapsule(
    ctx,
    offset(a, nx, ny),
    offset(b, nx, ny),
    width * SHEEN_WIDTH,
    width * SHEEN_WIDTH * SHEEN_TAPER,
    colour,
  );
  ctx.globalAlpha = baseAlpha;
}

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
  belly: FOREARM_WIDTH,
  tip: WRIST_WIDTH,
  bellyAt: 0.25,
};

const LEG_SHAPE: LimbShape = {
  root: THIGH_WIDTH,
  joint: KNEE_WIDTH,
  belly: SHIN_WIDTH,
  tip: HOCK_WIDTH,
  bellyAt: 0.3,
};

/**
 * A leg swung toward the camera, drawn from the front. Everything below the
 * knee is nearer the viewer than the thigh is, so it reads *larger*: the knee
 * stops pinching and the shin gains a little.
 */
const NEAR_SHIN_GAIN = 1.18;
const NEAR_HOCK_GAIN = 1.15;
const NEAR_LEG_SHAPE: LimbShape = {
  root: THIGH_WIDTH,
  joint: THIGH_WIDTH,
  belly: SHIN_WIDTH * NEAR_SHIN_GAIN,
  tip: HOCK_WIDTH * NEAR_HOCK_GAIN,
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

const LIMB_SPARK_WIDTH = 0.6;
const LIMB_SPARK_ALPHA = 0.36;

/**
 * Paints a solved limb: outline, then the hide, then a sheen down the lit edge.
 *
 * The lower segment is drawn in two pieces so the joint can pinch in and the
 * belly swell back out below it. Drawn as one taper a limb is a traffic cone.
 */
function drawLimb(ctx: Ctx, chain: BoneChain, shape: LimbShape, shade: number): void {
  const belly = mixPt(chain.joint, chain.end, shape.bellyAt);
  const hide = mix(FUR.mid, OUTLINE, shade);
  const lit = mix(FUR.light, OUTLINE, shade);

  outlineCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint);
  outlineCapsule(ctx, chain.joint, belly, shape.joint, shape.belly);
  outlineCapsule(ctx, belly, chain.end, shape.belly, shape.tip);

  fillCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint, hide);
  fillCapsule(ctx, chain.joint, belly, shape.joint, shape.belly, hide);
  fillCapsule(ctx, belly, chain.end, shape.belly, shape.tip, hide);
  sheenSegment(ctx, chain.root, chain.joint, shape.root, lit, SHEEN_ALPHA);
  sheenSegment(ctx, chain.joint, chain.end, shape.belly, lit, SHEEN_ALPHA);
  // A specular down the lit edge, not another shade of the same near-black: a
  // limb this thin painted only in ramp tones is drawn and unreadable against
  // the body it hangs off.
  const spark = mix(RIM_LIGHT, OUTLINE, shade);
  sheenSegment(
    ctx,
    chain.root,
    chain.joint,
    shape.root * LIMB_SPARK_WIDTH,
    spark,
    LIMB_SPARK_ALPHA,
  );
  sheenSegment(
    ctx,
    chain.joint,
    chain.end,
    shape.belly * LIMB_SPARK_WIDTH,
    spark,
    LIMB_SPARK_ALPHA,
  );
}

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

const SHADOW_RX = 0.52;
const SHADOW_RY = 0.13;
const SHADOW_FOLLOW = 0.6;
const SHADOW_LIFT_FADE = 1.6;
const SHADOW_LIFT_SHRINK = 0.6;

// ── The coat ─────────────────────────────────────────────────────────────────

/**
 * A ragged outline is a smooth curve walked through many small, uneven tufts,
 * never straight lines between a few tall peaks: that is the difference between
 * matted fur and a crown of thorns.
 *
 * Every body shape here is authored as a handful of control points, smoothed
 * into a dense closed curve, and then pushed out along its own normal by a
 * tuft height fixed per sample — fixed, or the coat boils from frame to frame —
 * plus a small shimmer driven by the pose.
 */
const COAT_SAMPLES_PER_SPAN = 7;
const TUFT_SHIMMER = 0.25;
const TUFT_SHIMMER_WAVES = 5;
/** How far the coat's drift leans each tuft, as a share of its height. */
const TUFT_LEAN = 0.6;

interface CoatEdge {
  readonly point: Pt;
  /** Unit normal pointing out of the shape. */
  readonly normal: Pt;
}

/** Catmull–Rom through four control points at `t`. */
function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  const along = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return pt(along(p0.x, p1.x, p2.x, p3.x), along(p0.y, p1.y, p2.y, p3.y));
}

function controlAt(control: readonly Pt[], index: number): Pt {
  const n = control.length;
  return control[((index % n) + n) % n];
}

/**
 * A dense, smooth closed curve through `control`, each sample carrying its
 * outward normal. The control points must run clockwise on screen, so the
 * outward normal is the tangent turned a quarter to the left.
 */
function smoothOutline(control: readonly Pt[]): CoatEdge[] {
  const samples: Pt[] = [];
  for (let i = 0; i < control.length; i++) {
    for (let s = 0; s < COAT_SAMPLES_PER_SPAN; s++) {
      samples.push(
        catmullRom(
          controlAt(control, i - 1),
          controlAt(control, i),
          controlAt(control, i + 1),
          controlAt(control, i + 2),
          s / COAT_SAMPLES_PER_SPAN,
        ),
      );
    }
  }
  return samples.map((point, i) => {
    const prev = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const length = Math.hypot(tx, ty);
    const normal = length === 0 ? pt(0, -1) : pt(ty / length, -tx / length);
    return { point, normal };
  });
}

interface CoatStyle {
  /** Tallest tuft, in figure units. */
  readonly tuft: number;
  /** A seed so two shapes do not share the same tufts. */
  readonly seed: number;
}

/** The ragged version of an outline: every sample pushed out by its own tuft. */
function raggedOutline(
  edges: readonly CoatEdge[],
  style: CoatStyle,
  pose: FuzzyNightmarePose,
  scale: number,
): Pt[] {
  return edges.map((edge, i) => {
    const height = style.tuft * hash1(i + style.seed);
    const theta = (i / edges.length) * TWO_PI;
    const shimmer = 1 + Math.sin(theta * TUFT_SHIMMER_WAVES + pose.furPhase) * TUFT_SHIMMER;
    const out = height * shimmer * scale;
    const lean = pose.furFlow * TUFT_LEAN * height * scale;
    return pt(edge.point.x + edge.normal.x * out + lean, edge.point.y + edge.normal.y * out);
  });
}

/**
 * Traces a closed curve through `points`, passing *between* them with
 * midpoint-to-midpoint quadratics, so a ragged outline is one continuous edge
 * rather than a zig-zag from spike to spike.
 */
function traceSmooth(ctx: Ctx, points: readonly Pt[]): void {
  ctx.beginPath();
  addSmooth(ctx, points);
}

/** {@link traceSmooth} without starting a new path, so it can cut a hole in one. */
function addSmooth(ctx: Ctx, points: readonly Pt[]): void {
  const n = points.length;
  const last = mixPt(points[n - 1], points[0], 0.5);
  ctx.moveTo(last.x, last.y);
  for (let i = 0; i < n; i++) {
    const next = points[(i + 1) % n];
    const mid = mixPt(points[i], next, 0.5);
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  ctx.closePath();
}

/** The dark silhouette is drawn proud of the fur so it fringes it. */
const COAT_OUTLINE_SCALE = 1.7;
const COAT_OUTLINE_BLEED = 0.012;

/**
 * Smoke at the silhouette's edge. Every few samples a strand leaves the coat
 * along its outward normal, curls downwind and thins to nothing, so the outline
 * seems to dissolve into the shadows rather than stop at a line.
 */
const WISP_EVERY = 3;
const WISP_LENGTH = 0.1;
const WISP_LENGTH_RANGE = 0.12;
const WISP_WIDTH = 0.04;
const WISP_ALPHA = 0.6;
const WISP_CURL = 0.45;
const WISP_SEED = 13.1;
/** Strands on the underside hang rather than rise, and only half as far. */
const WISP_UNDERSIDE_SHARE = 0.5;

function drawWisps(
  ctx: Ctx,
  edges: readonly CoatEdge[],
  ragged: readonly Pt[],
  pose: FuzzyNightmarePose,
): void {
  const baseAlpha = ctx.globalAlpha;
  ctx.lineCap = 'round';
  for (let i = 0; i < edges.length; i += WISP_EVERY) {
    const edge = edges[i];
    const root = ragged[i];
    const underside = edge.normal.y > 0;
    const reach =
      (WISP_LENGTH + hash1(i * 5 + WISP_SEED) * WISP_LENGTH_RANGE) *
      (underside ? WISP_UNDERSIDE_SHARE : 1);
    const sway = Math.sin(pose.furPhase + i * WISP_CURL) * WISP_CURL + pose.furFlow;
    const tip = pt(
      root.x + edge.normal.x * reach + sway * reach * WISP_CURL,
      root.y + edge.normal.y * reach - (underside ? 0 : reach * WISP_CURL * 0.5),
    );
    const bend = pt(
      lerp(root.x, tip.x, 0.5) - edge.normal.y * reach * WISP_CURL * 0.5,
      lerp(root.y, tip.y, 0.5) + edge.normal.x * reach * WISP_CURL * 0.5,
    );
    // Two passes, wide and faint then narrow and denser, which is the cheapest
    // way to make a stroke that thins and fades toward its end.
    for (const [width, alpha] of WISP_PASSES) {
      ctx.globalAlpha = baseAlpha * clampAlpha(WISP_ALPHA * alpha);
      ctx.strokeStyle = WISP;
      ctx.lineWidth = WISP_WIDTH * width;
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.quadraticCurveTo(bend.x, bend.y, lerp(root.x, tip.x, width), lerp(root.y, tip.y, width));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = baseAlpha;
}

/** `[share of the strand's length and width, alpha]` per pass. */
const WISP_PASSES: ReadonlyArray<readonly [number, number]> = [
  [1, 0.45],
  [0.6, 0.9],
];

const RIM_WIDTH = 0.04;
/** The share of lit edge the rim skips, and the seed that picks which. */
const RIM_BREAK_SHARE = 0.35;
const RIM_BREAK_SEED = 71.3;
/** Below this much facing toward the light an edge gets no rim at all. */
const RIM_FACING_FLOOR = 0.15;

/**
 * The cold edge light that makes a near-black body legible against an unlit
 * floor: run along every part of the outline that faces the key light, at a
 * strength set by how squarely it faces it.
 */
function drawRim(ctx: Ctx, edges: readonly CoatEdge[], ragged: readonly Pt[]): void {
  const baseAlpha = ctx.globalAlpha;
  ctx.strokeStyle = RIM_LIGHT;
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineCap = 'round';
  const lightLength = Math.hypot(LIGHT.x, LIGHT.y);
  for (let i = 0; i < edges.length; i++) {
    const facing =
      ((edges[i].normal.x * LIGHT.x + edges[i].normal.y * LIGHT.y) / lightLength -
        RIM_FACING_FLOOR) /
      (1 - RIM_FACING_FLOOR);
    // Broken rather than continuous: an unbroken light edge is the outline of
    // a plush toy, while one that comes and goes reads as light catching the
    // tips of matted fur.
    if (facing <= 0 || hash1(i + RIM_BREAK_SEED) < RIM_BREAK_SHARE) continue;
    const next = ragged[(i + 1) % ragged.length];
    ctx.globalAlpha = baseAlpha * clampAlpha(RIM_ALPHA * facing);
    ctx.beginPath();
    ctx.moveTo(ragged[i].x, ragged[i].y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
  }
  ctx.globalAlpha = baseAlpha;
}

/**
 * Two hard-edged tones over the base coat: a lit crescent on the side facing
 * the key light and a shadow crescent on the side away from it. Each is the
 * shape minus a copy of itself shifted along the light, clipped to the shape —
 * hard edges rather than gradients, because gradients at this scale wash out
 * to a flat mid-tone.
 */
const SHADE_SHIFT = 0.08;
const LIGHT_CAP_SHIFT = 0.04;
const LIGHT_CAP_ALPHA = 0.45;
/** Far larger than any shape, so the even-odd fill below covers the whole clip. */
const SHADE_FIELD = 8;

function fillCrescent(ctx: Ctx, ragged: readonly Pt[], shiftX: number, shiftY: number): void {
  ctx.beginPath();
  ctx.rect(-SHADE_FIELD, -SHADE_FIELD, SHADE_FIELD * 2, SHADE_FIELD * 2);
  addSmooth(
    ctx,
    ragged.map((p) => offset(p, shiftX, shiftY)),
  );
  ctx.fill('evenodd');
}

function shadeCoat(ctx: Ctx, ragged: readonly Pt[]): void {
  ctx.save();
  traceSmooth(ctx, ragged);
  ctx.clip();
  ctx.fillStyle = FUR.dark;
  fillCrescent(ctx, ragged, LIGHT.x * SHADE_SHIFT, LIGHT.y * SHADE_SHIFT);
  ctx.globalAlpha *= LIGHT_CAP_ALPHA;
  ctx.fillStyle = FUR.light;
  fillCrescent(ctx, ragged, -LIGHT.x * LIGHT_CAP_SHIFT, -LIGHT.y * LIGHT_CAP_SHIFT);
  ctx.restore();
}

/**
 * Matted strands across the interior. Tone alone does not make a black shape
 * read as fur — it reads as a polished stone — so a few clumps are drawn lying
 * down the body, on the lit side only: a strand in the shadow is a strand
 * nobody can see.
 */
const MAT_STRANDS = 22;
const MAT_LENGTH = 0.13;
const MAT_WIDTH = 0.016;
const MAT_ALPHA = 0.32;
const MAT_SEED = 5.1;

function drawMatting(
  ctx: Ctx,
  ragged: readonly Pt[],
  centre: Pt,
  pose: FuzzyNightmarePose,
  seed: number,
): void {
  ctx.save();
  traceSmooth(ctx, ragged);
  ctx.clip();
  ctx.strokeStyle = FUR.light;
  ctx.lineCap = 'round';
  ctx.lineWidth = MAT_WIDTH;
  const baseAlpha = ctx.globalAlpha;
  for (let i = 0; i < MAT_STRANDS; i++) {
    const edge = ragged[Math.floor(hash1(i + seed + MAT_SEED) * ragged.length)];
    const inset = 0.2 + hash1(i * 3 + seed) * 0.6;
    const root = mixPt(edge, centre, inset);
    const lit =
      ((edge.x - centre.x) * LIGHT.x + (edge.y - centre.y) * LIGHT.y) /
      Math.max(Math.hypot(edge.x - centre.x, edge.y - centre.y), JOINT_SLACK);
    if (lit <= 0) continue;
    const length = MAT_LENGTH * (0.6 + hash1(i * 7 + seed) * 0.8);
    const drift = pose.furFlow * 0.4 + Math.sin(i + pose.furPhase) * 0.2;
    ctx.globalAlpha = baseAlpha * clampAlpha(MAT_ALPHA * lit);
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.quadraticCurveTo(
      root.x + drift * length * 0.5,
      root.y + length * 0.5,
      root.x + drift * length,
      root.y + length,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Paints one furred shape from its control polygon: outline fringe, base coat,
 * shadow, matting, smoke and rim, in that order. Returns the ragged outline so
 * the caller can lay detail inside it.
 */
function drawCoatShape(
  ctx: Ctx,
  control: readonly Pt[],
  style: CoatStyle,
  pose: FuzzyNightmarePose,
  centre: Pt,
): Pt[] {
  const edges = smoothOutline(control);
  const fringe = raggedOutline(edges, style, pose, COAT_OUTLINE_SCALE);
  const coat = raggedOutline(edges, style, pose, 1);

  drawWisps(ctx, edges, fringe, pose);
  traceSmooth(ctx, fringe);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.lineWidth = COAT_OUTLINE_BLEED * 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  traceSmooth(ctx, coat);
  ctx.fillStyle = FUR.mid;
  ctx.fill();
  shadeCoat(ctx, coat);
  drawMatting(ctx, coat, centre, pose, style.seed);
  drawRim(ctx, edges, coat);
  return coat;
}

// ── The body ─────────────────────────────────────────────────────────────────

/** Profile thickness of the body at each spine node: above it, then below it. */
const RUMP_DORSAL = 0.14;
const RUMP_VENTRAL = 0.12;
const LOWER_BACK_DORSAL = 0.15;
const LOWER_BACK_VENTRAL = 0.09;
/** Shallow under the hump: it is gaunt there, all spine and ribs. */
const HUMP_VENTRAL = 0.1;
const SHOULDER_DORSAL = 0.15;
const SHOULDER_VENTRAL = 0.14;
const NECK_DORSAL = 0.1;
const NECK_VENTRAL = 0.08;
/** The rump rounds off this far behind the hip. */
const RUMP_BACK = 0.12;

const BODY_COAT: CoatStyle = { tuft: 0.07, seed: 31.7 };
const HEAD_COAT: CoatStyle = { tuft: 0.035, seed: 47.3 };

/** The outward normal of a spine run at `at`, on its dorsal side. */
function dorsalNormal(before: Pt, after: Pt): Pt {
  const tx = after.x - before.x;
  const ty = after.y - before.y;
  const length = Math.hypot(tx, ty);
  return length === 0 ? pt(0, -1) : pt(ty / length, -tx / length);
}

/**
 * The body edge-on: a thick, arched run from the rump up over the hump and down
 * through the shoulders into the neck, fat on top where the coat stands up off
 * the spine and thin underneath, where it is starved.
 */
function profileBodyControl(skeleton: Skeleton): Pt[] {
  const spine = [
    skeleton.hip,
    skeleton.lowerBack,
    skeleton.hump,
    skeleton.shoulderCentre,
    skeleton.neck,
  ];
  const dorsal = [RUMP_DORSAL, LOWER_BACK_DORSAL, HUMP_DORSAL, SHOULDER_DORSAL, NECK_DORSAL];
  const ventral = [RUMP_VENTRAL, LOWER_BACK_VENTRAL, HUMP_VENTRAL, SHOULDER_VENTRAL, NECK_VENTRAL];
  const normals = spine.map((node, i) =>
    dorsalNormal(spine[Math.max(0, i - 1)], spine[Math.min(spine.length - 1, i + 1)]),
  );
  const top = spine.map((node, i) =>
    offset(node, normals[i].x * dorsal[i], normals[i].y * dorsal[i]),
  );
  const bottom = spine.map((node, i) =>
    offset(node, -normals[i].x * ventral[i], -normals[i].y * ventral[i]),
  );
  const rump = offset(skeleton.hip, -RUMP_BACK, 0);
  // Clockwise on screen: up the back, over the top, and back along the belly.
  return [rump, ...top, ...bottom.reverse()];
}

/** Head-on and from behind, half-widths of the body at each of its heights. */
const FRONT_HIP_HALF = 0.17;
const FRONT_WAIST_HALF = 0.21;
const FRONT_SHOULDER_HALF = 0.43;
const FRONT_SHOULDER_TOP_HALF = 0.3;
const FRONT_HUMP_HALF = 0.12;
/** How far above the shoulder line the tops of the shoulders sit. */
const FRONT_SHOULDER_RISE = 0.12;
/** How far below the hip the haunches reach. */
const FRONT_HAUNCH_DROP = 0.08;

/**
 * The body head-on: a narrow, starved waist widening up into bony shoulders,
 * and above them the arch of the back rising into a peak — a cowl the head
 * hangs beneath. That peak over the head is the silhouette, and it is the
 * thing a bear or a man does not have.
 */
function frontBodyControl(skeleton: Skeleton, pose: FuzzyNightmarePose): Pt[] {
  const cx = skeleton.shoulderCentre.x;
  const hipX = skeleton.hip.x;
  const twist = pose.twist * TWIST_WIDTH_GAIN;
  const leftShoulder = FRONT_SHOULDER_HALF * (1 - twist);
  const rightShoulder = FRONT_SHOULDER_HALF * (1 + twist);
  const shoulderY = skeleton.shoulderCentre.y;
  const crownY = skeleton.hump.y - HUMP_DORSAL;
  return [
    pt(hipX - FRONT_HIP_HALF, skeleton.hip.y + FRONT_HAUNCH_DROP),
    pt(lerp(hipX, cx, 0.5) - FRONT_WAIST_HALF, skeleton.lowerBack.y),
    pt(cx - leftShoulder, shoulderY),
    pt(cx - FRONT_SHOULDER_TOP_HALF * (1 - twist), shoulderY - FRONT_SHOULDER_RISE),
    pt(cx - FRONT_HUMP_HALF, lerp(shoulderY - FRONT_SHOULDER_RISE, crownY, 0.75)),
    pt(cx, crownY),
    pt(cx + FRONT_HUMP_HALF, lerp(shoulderY - FRONT_SHOULDER_RISE, crownY, 0.75)),
    pt(cx + FRONT_SHOULDER_TOP_HALF * (1 + twist), shoulderY - FRONT_SHOULDER_RISE),
    pt(cx + rightShoulder, shoulderY),
    pt(lerp(hipX, cx, 0.5) + FRONT_WAIST_HALF, skeleton.lowerBack.y),
    pt(hipX + FRONT_HIP_HALF, skeleton.hip.y + FRONT_HAUNCH_DROP),
  ];
}

/**
 * Knobs of spine pressing up through the coat along the arch: the one
 * unmistakable "starved" cue, and the one that reads at a 32px tile as a
 * serrated ridge along the top of the silhouette.
 */
const VERTEBRA_COUNT = 5;
const VERTEBRA_R = 0.026;
/**
 * How far along the coat's own thickness each knob sits: just short of the
 * edge, so it breaks the outline as a bump rather than floating off it.
 */
const VERTEBRA_PROUD = 0.88;

/**
 * Knobs spaced evenly along a run of spine points, each pushed out along the
 * run's dorsal normal by that point's coat thickness.
 */
function drawVertebrae(
  ctx: Ctx,
  spine: readonly Pt[],
  dorsal: readonly number[],
  radiusScale: number,
): void {
  const spans = spine.length - 1;
  for (let i = 0; i < VERTEBRA_COUNT; i++) {
    const along = ((i + 0.5) / VERTEBRA_COUNT) * spans;
    const span = Math.min(spans - 1, Math.floor(along));
    const t = along - span;
    const at = mixPt(spine[span], spine[span + 1], t);
    const normal = dorsalNormal(spine[span], spine[span + 1]);
    const lift = lerp(dorsal[span], dorsal[span + 1], t) * VERTEBRA_PROUD;
    const knob = offset(at, normal.x * lift, normal.y * lift);
    const radius = VERTEBRA_R * radiusScale;
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, radius + OUTLINE_BLEED, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = VERTEBRA;
    ctx.beginPath();
    ctx.arc(
      knob.x + LIGHT.x * radius * 0.3,
      knob.y + LIGHT.y * radius * 0.3,
      radius * 0.7,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

/** Ribs showing through the starved flank in profile. */
const RIB_COUNT = 3;
const RIB_ALPHA = 0.55;
const RIB_WIDTH = 0.014;
const RIB_SPACING = 0.075;
const RIB_LENGTH = 0.12;

function drawRibs(ctx: Ctx, skeleton: Skeleton): void {
  const baseAlpha = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha * RIB_ALPHA;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = RIB_WIDTH;
  ctx.lineCap = 'round';
  const start = mixPt(skeleton.hump, skeleton.shoulderCentre, 0.3);
  for (let i = 0; i < RIB_COUNT; i++) {
    const x = start.x - i * RIB_SPACING;
    const y = start.y + RIB_SPACING * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + RIB_LENGTH * 0.3,
      y + RIB_LENGTH * 0.6,
      x - RIB_LENGTH * 0.1,
      y + RIB_LENGTH,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = baseAlpha;
}

function drawBodyProfile(ctx: Ctx, skeleton: Skeleton, pose: FuzzyNightmarePose): void {
  drawCoatShape(ctx, profileBodyControl(skeleton), BODY_COAT, pose, skeleton.hump);
  drawRibs(ctx, skeleton);
  drawVertebrae(
    ctx,
    [skeleton.lowerBack, skeleton.hump, skeleton.shoulderCentre],
    [LOWER_BACK_DORSAL, HUMP_DORSAL, SHOULDER_DORSAL],
    1,
  );
}

/**
 * From behind, the spine is a ridge up the middle of the back: a groove of
 * shadow with its lit flank beside it. Knobs here read as a row of buttons.
 */
const BACK_SPINE_TOP_INSET = 0.6;
const BACK_SPINE_WIDTH = 0.03;
const BACK_SPINE_LIT_OFFSET = 0.025;
const BACK_SPINE_LIT_ALPHA = 0.5;

/**
 * The shadow the slung head throws on the chest behind it. Without it the face
 * sits on the body like a print on a sack; with it the head hangs out in front
 * of a dark hollow, which is where it is.
 */
const CHEST_SHADOW_DROP = 0.1;
const CHEST_SHADOW_RX = 0.3;
const CHEST_SHADOW_RY = 0.26;
const CHEST_SHADOW_ALPHA = 0.85;

function drawChestShadow(ctx: Ctx, coat: readonly Pt[], head: Pt): void {
  ctx.save();
  traceSmooth(ctx, coat);
  ctx.clip();
  ctx.globalAlpha *= CHEST_SHADOW_ALPHA;
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(head.x, head.y + CHEST_SHADOW_DROP, CHEST_SHADOW_RX, CHEST_SHADOW_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawBodyHeadOn(
  ctx: Ctx,
  skeleton: Skeleton,
  pose: FuzzyNightmarePose,
  view: ViewSpec,
): void {
  const coat = drawCoatShape(
    ctx,
    frontBodyControl(skeleton, pose),
    BODY_COAT,
    pose,
    skeleton.lowerBack,
  );
  if (view.showsFace) {
    drawChestShadow(ctx, coat, skeleton.headCentre);
    return;
  }
  const crown = pt(skeleton.shoulderCentre.x, skeleton.hump.y - HUMP_DORSAL * BACK_SPINE_TOP_INSET);
  const base = skeleton.lowerBack;
  const bow = pt(lerp(base.x, crown.x, 0.5), lerp(base.y, crown.y, 0.5));
  ctx.lineCap = 'round';
  ctx.lineWidth = BACK_SPINE_WIDTH;
  ctx.strokeStyle = FUR.dark;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.quadraticCurveTo(bow.x, bow.y, crown.x, crown.y);
  ctx.stroke();
  const baseAlpha = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha * BACK_SPINE_LIT_ALPHA;
  ctx.strokeStyle = FUR.light;
  ctx.beginPath();
  ctx.moveTo(base.x - BACK_SPINE_LIT_OFFSET, base.y);
  ctx.quadraticCurveTo(
    bow.x - BACK_SPINE_LIT_OFFSET,
    bow.y,
    crown.x - BACK_SPINE_LIT_OFFSET,
    crown.y,
  );
  ctx.stroke();
  ctx.globalAlpha = baseAlpha;
}

// ── The head ─────────────────────────────────────────────────────────────────

/**
 * The head head-on: a narrow crown over a jaw far wider than it, so the mouth
 * can run nearly the full width of the face. Clockwise from the crown, in the
 * head's own space.
 */
const FRONT_HEAD: readonly Pt[] = [
  pt(0, -0.18),
  pt(0.13, -0.15),
  pt(0.2, -0.05),
  pt(0.25, 0.05),
  pt(0.2, 0.13),
  pt(0.08, 0.17),
  pt(-0.08, 0.17),
  pt(-0.2, 0.13),
  pt(-0.25, 0.05),
  pt(-0.2, -0.05),
  pt(-0.13, -0.15),
];

/**
 * The head in profile, facing +X: a low skull running out into a long, flat
 * muzzle, its jaw hinged far back under the eye.
 */
const PROFILE_HEAD: readonly Pt[] = [
  pt(-0.16, -0.06),
  pt(-0.06, -0.15),
  pt(0.08, -0.13),
  pt(0.22, -0.06),
  pt(0.31, 0.0),
  pt(0.3, 0.06),
  pt(0.2, 0.12),
  pt(0.05, 0.15),
  pt(-0.1, 0.11),
];

/**
 * Eyes: deep sockets with a pinprick in each. The pinprick is sized against the
 * 32px tile, not the review sheet: it has to survive as at least one bright
 * pixel there, and the glow around it is what makes that pixel read as a
 * light rather than as a fleck of paint.
 */
const FRONT_EYE_SPREAD = 0.085;
const EYE_Y = -0.045;
const PROFILE_EYE_X = 0.1;
const SOCKET_RX = 0.058;
const SOCKET_RY = 0.04;
/** The sockets slant down toward the nose, which is the scowl. */
const SOCKET_TILT = deg(18);
const PINPRICK_R = 0.026;
const GLOW_R = 0.04;
const GLOW_ALPHA = 0.5;
/** How much brighter and wider the glow gets at a full glare. */
const GLARE_GLOW_GAIN = 0.3;
/** The heavy ridge hooding each socket. */
const BROW_THICKNESS = 0.035;
const BROW_REACH = 1.35;

/**
 * The mouth. It runs nearly the width of the jaw and never quite closes: the
 * resting part is what shows the teeth, and the teeth are the face.
 */
const MOUTH_Y = 0.07;
const MOUTH_HALF = 0.23;
/** How far the corners turn up, which is the grin. */
const MOUTH_CORNER_RISE = 0.04;
const MOUTH_REST_OPEN = 0.075;
const MOUTH_GAPE = 0.1;
const UPPER_TEETH = 8;
const LOWER_TEETH = 7;
const TOOTH_LENGTH = 0.062;
const TOOTH_HALF = 0.014;
/** In profile the mouth runs from the muzzle's tip back to under the eye. */
const PROFILE_MOUTH_FRONT = 0.29;
const PROFILE_MOUTH_BACK = -0.02;
const PROFILE_MOUTH_Y = 0.055;
const PROFILE_UPPER_TEETH = 6;
const PROFILE_LOWER_TEETH = 5;

/**
 * Where the eyes sit in a resting pose, in figure units from the ground point,
 * for the eye-shine the dungeon's dark shows. Taken from the same skeleton and
 * face constants the painter draws them from, so they cannot part company.
 */
export function restingEyeCentres(view: FuzzyNightmareView): Pt[] {
  const spec = VIEWS[view];
  const skeleton = buildSkeleton(restingPose(), spec);
  const head = skeleton.headCentre;
  if (!spec.showsFace) return [];
  if (spec.profile) return [offset(head, PROFILE_EYE_X, EYE_Y)];
  return [offset(head, -FRONT_EYE_SPREAD, EYE_Y), offset(head, FRONT_EYE_SPREAD, EYE_Y)];
}

/**
 * One band of shadow across both eyes under the brow, so the two points of
 * light sit deep in the skull rather than on its surface.
 */
const SOCKET_BAND_RX = 0.17;
const SOCKET_BAND_RY = 0.055;

function drawSocketBand(ctx: Ctx): void {
  ctx.fillStyle = EYE_SOCKET;
  ctx.beginPath();
  ctx.ellipse(0, EYE_Y, SOCKET_BAND_RX, SOCKET_BAND_RY, 0, 0, TWO_PI);
  ctx.fill();
}

function drawEye(ctx: Ctx, x: number, inward: number, pose: FuzzyNightmarePose): void {
  ctx.save();
  ctx.translate(x, EYE_Y);
  ctx.rotate(inward * SOCKET_TILT);
  ctx.fillStyle = EYE_SOCKET;
  ctx.beginPath();
  ctx.ellipse(0, 0, SOCKET_RX, SOCKET_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  const open = 1 - clamp01(pose.blink);
  if (open > 0) {
    const glare = 1 + clamp01(pose.glare) * GLARE_GLOW_GAIN;
    const baseAlpha = ctx.globalAlpha;
    ctx.globalAlpha = baseAlpha * clampAlpha(GLOW_ALPHA * open * glare);
    ctx.fillStyle = EYE_GLOW;
    ctx.beginPath();
    ctx.arc(x, EYE_Y, GLOW_R * glare, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = baseAlpha;
    ctx.fillStyle = EYE_SHINE;
    ctx.beginPath();
    ctx.ellipse(x, EYE_Y, PINPRICK_R, PINPRICK_R * open, 0, 0, TWO_PI);
    ctx.fill();
  }

  // The brow, cutting across the top of the socket and dropping toward the
  // nose: a hooded point of light is a stare, an unhooded one is a lamp.
  const inner = x + inward * SOCKET_RX * BROW_REACH;
  const outer = x - inward * SOCKET_RX * BROW_REACH;
  ctx.fillStyle = FUR.dark;
  ctx.beginPath();
  ctx.moveTo(outer, EYE_Y - SOCKET_RY * 1.4);
  ctx.lineTo(inner, EYE_Y - SOCKET_RY * 0.2);
  ctx.lineTo(inner, EYE_Y - SOCKET_RY * 0.2 - BROW_THICKNESS);
  ctx.lineTo(outer, EYE_Y - SOCKET_RY * 1.4 - BROW_THICKNESS);
  ctx.closePath();
  ctx.fill();
}

/** A row of needle teeth along one jaw, pointing `direction` (+1 down, −1 up). */
function drawTeethRow(
  ctx: Ctx,
  from: number,
  to: number,
  lipY: (x: number) => number,
  count: number,
  direction: number,
  length: number,
): void {
  ctx.fillStyle = TOOTH;
  for (let i = 0; i < count; i++) {
    const x = lerp(from, to, (i + 0.5) / count);
    const y = lipY(x);
    // Uneven, the way a jaw full of needles is: no two the same length.
    const reach = length * lerp(TOOTH_SHORT_SHARE, 1, hash1(i * direction + TOOTH_SEED));
    ctx.beginPath();
    ctx.moveTo(x - TOOTH_HALF, y);
    ctx.lineTo(x, y + reach * direction);
    ctx.lineTo(x + TOOTH_HALF, y);
    ctx.closePath();
    ctx.fill();
  }
}

const TOOTH_SHORT_SHARE = 0.45;
const TOOTH_SEED = 23.9;

function drawFrontMouth(ctx: Ctx, pose: FuzzyNightmarePose): void {
  const open = MOUTH_REST_OPEN + clamp01(pose.maw) * MOUTH_GAPE;
  const upper = (x: number): number =>
    MOUTH_Y - MOUTH_CORNER_RISE * (x / MOUTH_HALF) * (x / MOUTH_HALF);
  const lower = (x: number): number => upper(x) + open * (1 - (x / MOUTH_HALF) * (x / MOUTH_HALF));
  ctx.fillStyle = MAW_INNER;
  ctx.beginPath();
  ctx.moveTo(-MOUTH_HALF, upper(-MOUTH_HALF));
  ctx.quadraticCurveTo(0, MOUTH_Y + MOUTH_CORNER_RISE * 0.6, MOUTH_HALF, upper(MOUTH_HALF));
  ctx.quadraticCurveTo(0, MOUTH_Y + open * 2, -MOUTH_HALF, upper(-MOUTH_HALF));
  ctx.closePath();
  ctx.fill();
  const toothSpan = MOUTH_HALF * 0.9;
  drawTeethRow(ctx, -toothSpan, toothSpan, upper, UPPER_TEETH, 1, TOOTH_LENGTH);
  drawTeethRow(ctx, -toothSpan, toothSpan, lower, LOWER_TEETH, -1, TOOTH_LENGTH * 0.8);
}

function drawProfileMouth(ctx: Ctx, pose: FuzzyNightmarePose): void {
  const open = MOUTH_REST_OPEN + clamp01(pose.maw) * MOUTH_GAPE;
  // The gape is a wedge hinged at the back of the jaw, widest at the muzzle.
  const span = PROFILE_MOUTH_FRONT - PROFILE_MOUTH_BACK;
  const upper = (): number => PROFILE_MOUTH_Y;
  const lower = (x: number): number => PROFILE_MOUTH_Y + open * ((x - PROFILE_MOUTH_BACK) / span);
  ctx.fillStyle = MAW_INNER;
  ctx.beginPath();
  ctx.moveTo(PROFILE_MOUTH_BACK, PROFILE_MOUTH_Y);
  ctx.lineTo(PROFILE_MOUTH_FRONT, PROFILE_MOUTH_Y);
  ctx.lineTo(PROFILE_MOUTH_FRONT, PROFILE_MOUTH_Y + open);
  ctx.closePath();
  ctx.fill();
  const toothFrom = lerp(PROFILE_MOUTH_BACK, PROFILE_MOUTH_FRONT, 0.25);
  drawTeethRow(ctx, toothFrom, PROFILE_MOUTH_FRONT, upper, PROFILE_UPPER_TEETH, 1, TOOTH_LENGTH);
  drawTeethRow(
    ctx,
    toothFrom,
    PROFILE_MOUTH_FRONT,
    lower,
    PROFILE_LOWER_TEETH,
    -1,
    TOOTH_LENGTH * 0.8,
  );
}

/** How much of the body's lean the skull copies; a head that follows fully nods. */
const HEAD_LEAN_FOLLOW = 0.3;

/**
 * The head, in its own space with the origin at its centre. Nothing is drawn in
 * the `back` view: from behind it hangs below the cowl of the back and the
 * coat hides it, which is better than a hint of a face.
 */
function drawHead(ctx: Ctx, skeleton: Skeleton, pose: FuzzyNightmarePose, view: ViewSpec): void {
  if (!view.showsFace) return;
  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(pose.headTilt + pose.lean * HEAD_LEAN_FOLLOW);
  drawCoatShape(ctx, view.profile ? PROFILE_HEAD : FRONT_HEAD, HEAD_COAT, pose, pt(0, 0));
  if (view.profile) {
    drawProfileMouth(ctx, pose);
    drawEye(ctx, PROFILE_EYE_X, -1, pose);
  } else {
    drawFrontMouth(ctx, pose);
    drawSocketBand(ctx);
    for (const side of [-1, 1]) drawEye(ctx, side * FRONT_EYE_SPREAD, -side, pose);
  }
  ctx.restore();
}

// ── Hands ────────────────────────────────────────────────────────────────────

/**
 * A hand is four long, thin fingers off a small palm, each ending in a hooked
 * claw — the shape that has to be legible entirely on its own, because the
 * defend quest paints one of these coming up out of a hole in the floor with
 * nothing else of the creature visible.
 */
const PALM_R = 0.044;
/** Each finger's length, first to last, as the two segments either side of its knuckle. */
const FINGER_LENGTHS: readonly number[] = [0.24, 0.28, 0.26, 0.2];
const FINGER_KNUCKLE_ALONG = 0.5;
/** How far the fingers fan apart at full spread. */
const FINGER_FAN = deg(46);
/** The curl a relaxed finger keeps at the knuckle, so the hand is never a rake of sticks. */
const FINGER_CURL = deg(40);
/** Widths sized against the sheet: thinner than this and a finger bakes away. */
const FINGER_WIDTH = 0.022;
const FINGER_TIP_WIDTH = 0.014;
/** The claw: a hooked thorn off the end of each finger. */
const CLAW_LENGTH = 0.07;
const CLAW_HOOK = deg(55);
const CLAW_BASE = 0.016;

/**
 * A hand does not take the full angle of its forearm: real hands stay rigid
 * relative to the body while the forearm swings under them.
 */
const WRIST_FOLLOW = 0.3;

function wristAngle(chain: BoneChain): number {
  const alongArm = angleBetween(chain.root, chain.end);
  const alongForearm = angleBetween(chain.joint, chain.end);
  return lerp(alongArm, alongForearm, WRIST_FOLLOW);
}

function drawClaw(ctx: Ctx, tip: Pt, direction: number, lit: string, dark: string): void {
  const hooked = direction + CLAW_HOOK;
  const mid = offset(
    tip,
    Math.cos(direction) * CLAW_LENGTH * 0.6,
    Math.sin(direction) * CLAW_LENGTH * 0.6,
  );
  const point = offset(
    mid,
    Math.cos(hooked) * CLAW_LENGTH * 0.5,
    Math.sin(hooked) * CLAW_LENGTH * 0.5,
  );
  const normal = direction + HALF_PI;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(tip.x + Math.cos(normal) * CLAW_BASE, tip.y + Math.sin(normal) * CLAW_BASE);
  ctx.quadraticCurveTo(mid.x, mid.y, point.x, point.y);
  ctx.quadraticCurveTo(
    mid.x,
    mid.y,
    tip.x - Math.cos(normal) * CLAW_BASE,
    tip.y - Math.sin(normal) * CLAW_BASE,
  );
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = lit;
  ctx.lineWidth = CLAW_BASE * 0.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.quadraticCurveTo(mid.x, mid.y, point.x, point.y);
  ctx.stroke();
}

function drawHand(ctx: Ctx, chain: BoneChain, spread: number, shade: number): void {
  const open = clamp01(spread);
  const hide = mix(FUR.mid, OUTLINE, shade);
  const clawLit = mix(CLAW_LIT, OUTLINE, shade);
  const clawDark = mix(CLAW_DARK, OUTLINE, shade);
  const base = wristAngle(chain);
  const count = FINGER_LENGTHS.length;

  ctx.save();
  ctx.translate(chain.end.x, chain.end.y);
  for (let i = 0; i < count; i++) {
    const length = FINGER_LENGTHS[i];
    const fan = ((i - (count - 1) / 2) / ((count - 1) / 2)) * FINGER_FAN * (0.35 + open * 0.65);
    const curl = FINGER_CURL * (1 - open * 0.7);
    const first = base + fan;
    const root = rotate({ x: PALM_R * 0.7, y: 0 }, first);
    const knuckle = offset(
      root,
      Math.cos(first) * length * FINGER_KNUCKLE_ALONG,
      Math.sin(first) * length * FINGER_KNUCKLE_ALONG,
    );
    // Curled toward the palm, which is the side the claws hook toward too.
    const second = first + curl;
    const tip = offset(
      knuckle,
      Math.cos(second) * length * (1 - FINGER_KNUCKLE_ALONG),
      Math.sin(second) * length * (1 - FINGER_KNUCKLE_ALONG),
    );
    outlineCapsule(ctx, root, knuckle, FINGER_WIDTH, FINGER_TIP_WIDTH);
    outlineCapsule(ctx, knuckle, tip, FINGER_TIP_WIDTH, FINGER_TIP_WIDTH);
    fillCapsule(ctx, root, knuckle, FINGER_WIDTH, FINGER_TIP_WIDTH, hide);
    fillCapsule(ctx, knuckle, tip, FINGER_TIP_WIDTH, FINGER_TIP_WIDTH, hide);
    drawClaw(ctx, tip, second + curl * 0.5, clawLit, clawDark);
  }
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(0, 0, PALM_R + OUTLINE_BLEED, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.arc(0, 0, PALM_R, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Feet ─────────────────────────────────────────────────────────────────────

/**
 * The metatarsal and the toes. It stands on the balls of long, clawed feet, the
 * hock raised behind — head-on the bone points at the camera and all that is
 * left of the foot is the splay of its toes.
 */
const TOE_LENGTH = 0.13;
const TOE_COUNT = 3;
const TOE_FAN = deg(26);
const TOE_WIDTH = 0.022;
/** Head-on the toes point at the camera, so they draw short and splay downward. */
const FRONT_TOE_FORESHORTEN = 0.5;

/** `outward` is +1 for the creature's right foot and −1 for its left. */
function drawFoot(
  ctx: Ctx,
  hock: Pt,
  ball: Pt,
  view: ViewSpec,
  outward: number,
  shade: number,
): void {
  const hide = mix(FUR.mid, OUTLINE, shade);
  outlineCapsule(ctx, hock, ball, METATARSAL_WIDTH, TOE_WIDTH);
  fillCapsule(ctx, hock, ball, METATARSAL_WIDTH, TOE_WIDTH, hide);
  const clawLit = mix(CLAW_LIT, OUTLINE, shade);
  const clawDark = mix(CLAW_DARK, OUTLINE, shade);
  for (let i = 0; i < TOE_COUNT; i++) {
    const fan = (i - (TOE_COUNT - 1) / 2) * TOE_FAN;
    // In profile the toes run forward along the floor; head-on they come at
    // the camera, which is down the screen and splayed out to the sides.
    const direction = view.profile ? fan * 0.4 : HALF_PI - fan - outward * TOE_FAN * 0.5;
    const length = TOE_LENGTH * (view.profile ? 1 : FRONT_TOE_FORESHORTEN);
    const tip = offset(
      ball,
      Math.cos(direction) * length,
      Math.sin(direction) * length * (view.profile ? 0.3 : 1),
    );
    outlineCapsule(ctx, ball, tip, TOE_WIDTH, TOE_WIDTH * 0.6);
    fillCapsule(ctx, ball, tip, TOE_WIDTH, TOE_WIDTH * 0.6, hide);
    drawClaw(ctx, tip, direction, clawLit, clawDark);
  }
}

// ── The breach ───────────────────────────────────────────────────────────────

/**
 * The hole a Fuzzy Nightmare comes up through: one tile's worth of smashed
 * floor slab over a black void.
 */
const HOLE_RX = 0.52;
const HOLE_RY = 0.19;
const SHARD_COUNT = 9;
const SHARD_MIN = 0.07;
const SHARD_RANGE = 0.09;
const SHARD_SEED = 8.3;
const SHARD_TILT = 0.4;
const SHARD_BASE = 0.5;
const SHARD_CROWN = 0.55;
const SHARD_LEAN = 0.45;
const SHARD_EDGE_WIDTH = 0.008;

const HOLE_LIP_WIDTH = 0.03;

/**
 * The void, ringed by the cut edge of the slab it broke through.
 *
 * The ring is the load-bearing part: a black ellipse on a near-black dungeon
 * floor is not a hole, it is nothing at all, and the only thing that says
 * "this floor is open" is the pale edge of the concrete around it.
 */
function drawBreachVoid(ctx: Ctx): void {
  ctx.strokeStyle = SLAB_EDGE;
  ctx.lineWidth = HOLE_LIP_WIDTH;
  ctx.beginPath();
  ctx.ellipse(0, BREACH_FLOOR_Y, HOLE_RX, HOLE_RY, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.fillStyle = VOID;
  ctx.beginPath();
  ctx.ellipse(0, BREACH_FLOOR_Y, HOLE_RX, HOLE_RY, 0, 0, TWO_PI);
  ctx.fill();
}

/**
 * The broken lip of the hole, painted *over* the creature so the body reads as
 * coming through the floor rather than as standing behind a picture of one.
 */
function drawBreachRim(ctx: Ctx): void {
  for (let i = 0; i < SHARD_COUNT; i++) {
    const theta = (i / SHARD_COUNT) * TWO_PI + SHARD_SEED;
    const size = SHARD_MIN + hash1(i + SHARD_SEED) * SHARD_RANGE;
    ctx.save();
    ctx.translate(Math.cos(theta) * HOLE_RX, BREACH_FLOOR_Y + Math.sin(theta) * HOLE_RY);
    ctx.rotate(Math.cos(theta) * SHARD_TILT);
    ctx.beginPath();
    ctx.moveTo(-size, size * SHARD_BASE);
    ctx.lineTo(-size * SHARD_CROWN, -size);
    ctx.lineTo(size * SHARD_CROWN, -size * SHARD_LEAN);
    ctx.lineTo(size, size * SHARD_BASE);
    ctx.closePath();
    // The far half of the ring lies in the creature's shadow; the near half
    // catches the same key light the body does.
    ctx.fillStyle = Math.sin(theta) > 0 ? SLAB : SLAB_DARK;
    ctx.fill();
    ctx.strokeStyle = SLAB_EDGE;
    ctx.lineWidth = SHARD_EDGE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(-size * SHARD_CROWN, -size);
    ctx.lineTo(size * SHARD_CROWN, -size * SHARD_LEAN);
    ctx.stroke();
    ctx.restore();
  }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/** Feet turn outward, away from the centreline, on both sides. */
const LEFT_FOOT_OUT = -1;
const RIGHT_FOOT_OUT = 1;
/**
 * How far below the floor line a fully submerged creature is pushed: past its
 * full height, so at full depth not even the top of the hump shows.
 */
const SUBMERGE_HEADROOM = 1.12;
export const SUBMERGE_DEPTH = FIGURE_HEIGHT * SUBMERGE_HEADROOM;
/** The floor line the breach cuts the body off at, in figure units. */
export const BREACH_FLOOR_Y = -0.02;
/** The clip is far wider than the figure, so only its floor edge ever cuts. */
const CLIP_SPAN = 5;

function drawFigure(ctx: Ctx, view: ViewSpec, pose: FuzzyNightmarePose): void {
  const sunk = clamp01(pose.submerged);
  if (pose.breach) drawBreachVoid(ctx);

  ctx.save();
  if (sunk > 0) {
    // Everything below the floor is clipped away rather than drawn and covered:
    // a creature painted under the floor shows through every gap in the rubble,
    // and the gaps are exactly where the eye goes.
    ctx.beginPath();
    ctx.rect(-CLIP_SPAN / 2, BREACH_FLOOR_Y - CLIP_SPAN, CLIP_SPAN, CLIP_SPAN);
    ctx.clip();
    ctx.translate(0, sunk * SUBMERGE_DEPTH);
  }
  drawBody(ctx, view, pose, sunk);
  ctx.restore();

  if (pose.breach) drawBreachRim(ctx);
}

function drawBody(ctx: Ctx, view: ViewSpec, pose: FuzzyNightmarePose, sunk: number): void {
  const skeleton = buildSkeleton(pose, view);

  // A creature half-way out of the floor casts no contact shadow on the floor
  // it has just destroyed.
  if (sunk <= 0) {
    const lift = Math.max(0, -Math.min(pose.leftFoot.y, pose.rightFoot.y));
    const shadowFade = clamp01(1 - lift * SHADOW_LIFT_FADE);
    drawGroundShadow(
      ctx,
      skeleton.hip.x * SHADOW_FOLLOW,
      SHADOW_RX * lerp(SHADOW_LIFT_SHRINK, 1, shadowFade),
      SHADOW_RY * lerp(SHADOW_LIFT_SHRINK, 1, shadowFade),
      CONTACT_SHADOW_ALPHA * shadowFade,
    );
  }

  // The creature's left side is the far one. Seen edge-on that arm and leg are
  // genuinely behind the body; head-on the arms hang in front of it.
  const farShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  const leftBehind = view.profile || pose.leftArmBehind;
  const rightBehind = !view.profile && pose.rightArmBehind;
  if (leftBehind) drawArm(ctx, skeleton.leftArm, pose.leftClaw, farShade);
  if (rightBehind) drawArm(ctx, skeleton.rightArm, pose.rightClaw, farShade);

  drawLeg(
    ctx,
    skeleton.leftLeg,
    pose.leftFoot,
    view,
    LEFT_FOOT_OUT,
    pose.leftLegNearness,
    farShade,
  );
  // Edge-on the near leg folds in front of the haunch, so it is drawn over the
  // body; head-on both legs come out from under it.
  if (!view.profile) {
    drawLeg(
      ctx,
      skeleton.rightLeg,
      pose.rightFoot,
      view,
      RIGHT_FOOT_OUT,
      pose.rightLegNearness,
      UNSHADED,
    );
  }

  if (view.profile) drawBodyProfile(ctx, skeleton, pose);
  else drawBodyHeadOn(ctx, skeleton, pose, view);

  if (view.profile) {
    drawLeg(
      ctx,
      skeleton.rightLeg,
      pose.rightFoot,
      view,
      RIGHT_FOOT_OUT,
      pose.rightLegNearness,
      UNSHADED,
    );
  }

  drawHead(ctx, skeleton, pose, view);

  if (!leftBehind) drawArm(ctx, skeleton.leftArm, pose.leftClaw, farShade);
  if (!rightBehind) drawArm(ctx, skeleton.rightArm, pose.rightClaw, UNSHADED);
}

/** The ragged tufts that hang off the back of each elbow. */
const ELBOW_TUFT = 0.07;
const ELBOW_TUFT_WIDTH = 0.03;

function drawArm(ctx: Ctx, chain: BoneChain, claw: number, shade: number): void {
  drawLimb(ctx, chain, ARM_SHAPE, shade);
  const hang = offset(chain.joint, 0, ELBOW_TUFT);
  outlineCapsule(ctx, chain.joint, hang, ELBOW_TUFT_WIDTH, OUTLINE_BLEED);
  fillCapsule(
    ctx,
    chain.joint,
    hang,
    ELBOW_TUFT_WIDTH,
    OUTLINE_BLEED,
    mix(FUR.mid, OUTLINE, shade),
  );
  drawHand(ctx, chain, claw, shade);
}

function drawLeg(
  ctx: Ctx,
  chain: BoneChain,
  ball: Pt,
  view: ViewSpec,
  outward: number,
  nearness: number,
  shade: number,
): void {
  drawLimb(ctx, chain, legShapeFor(nearness), shade);
  drawFoot(ctx, chain.end, ball, view, outward, shade);
}

/** Head-on, coming at the camera. */
export function drawFuzzyNightmareFront(ctx: Ctx, pose: FuzzyNightmarePose): void {
  drawFigure(ctx, VIEWS.front, pose);
}

/** From behind, walking away. */
export function drawFuzzyNightmareBack(ctx: Ctx, pose: FuzzyNightmarePose): void {
  drawFigure(ctx, VIEWS.back, pose);
}

/** In profile. Always drawn facing +X; the runtime mirrors for the left. */
export function drawFuzzyNightmareSide(ctx: Ctx, pose: FuzzyNightmarePose): void {
  drawFigure(ctx, VIEWS.side, pose);
}
