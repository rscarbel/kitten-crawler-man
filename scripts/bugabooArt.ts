/**
 * Drawing engine for the Bugaboo — the thing that comes up through the floor
 * grates.
 *
 * The read the whole design serves, from the source material: about seven feet
 * tall, "terrifying and cartoonish" at once. The general shape of a bear with
 * no neck, enormous owl-like eyes, comically skinny legs and long but absurdly
 * thin arms, the whole of it under obsidian-coloured hair.
 *
 * Everything about the silhouette serves that contrast: a single enormous
 * shaggy mass — hips, chest and skull are one continuous form, because a neck
 * is the one thing it must not have — carried on four twigs. The eyes are the
 * only bright things on it and the only reason it reads at a 32px tile, so they
 * are drawn large enough to survive that size.
 *
 * Three viewpoints are drawn: `front` (toward the camera), `back` (away) and
 * `side` (profile, always facing +X so the runtime can mirror it). All three
 * read the same {@link BugabooPose}; the choreography that fills that pose
 * lives in `scripts/generate-bugaboo-sprite.ts`.
 *
 * Coordinates are tile units with the origin at the point between the feet and
 * +Y pointing down the screen, so heights above the ground are negative — the
 * same frame `carlArt.ts` uses, and for the same reason: the generator
 * translates to that ground point, scales by one tile, and calls a painter.
 *
 * The rig's structure — the `ViewSpec` table, hand and foot targets solved by a
 * two-bone IK with FK escape hatches for swinging arms, and every pose written
 * as edits to one resting pose — is taken from `carlArt.ts`, the only figure in
 * this game whose movement convinces. The anatomy on top of it is not.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { hash1 } from './ratArt.js';
import { type Pt, clamp01, deg, lerp, mix, rgba } from './carlArt.js';

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
 * Obsidian is black *glass*: near-black with a violet cast and a hard specular
 * edge. Painted at true black the creature disappears into a dungeon floor that
 * is itself nearly black, so the ramp bottoms out above it and the read is
 * carried by {@link RIM_LIGHT} down the lit edge.
 */
const FUR: Ramp = {
  dark: '#181524',
  mid: '#332e49',
  light: '#5c5480',
};

const OUTLINE = '#07060b';

/** The cool specular that separates an obsidian body from an unlit floor. */
const RIM_LIGHT = '#b3aada';
/**
 * Heavy, because the creature is the same value as the floor it stands on.
 * Measured on the baked idle: the body's median luminance is 57 against a
 * dungeon floor of about 26, and at a 32px tile a 30-step gap is a smudge. The
 * rim is what actually draws the outline the player reads.
 */
const RIM_ALPHA = 0.72;
const SHEEN_ALPHA = 0.34;
const CONTACT_SHADOW_ALPHA = 0.45;

const IRIS = '#e8a91f';
const IRIS_DEEP = '#a86c0d';
const PUPIL = '#08070d';
const EYE_SPARK = '#ffffff';

/**
 * Several steps lighter than the coat. A muzzle painted the creature's own
 * near-black is drawn and invisible, and the profile then reads as a ball with
 * one eye stuck on it — the snout has to be a *tone* as well as a bump.
 */
const MUZZLE = '#5b5273';
const NOSE = '#0a0910';
const MAW_INNER = '#3d1220';
const TOOTH = '#ded6c2';
const CLAW_LIT = '#c9c2d8';
const CLAW_DARK = '#6d6684';

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
 * Total height in tile units, crown of the skull to the floor. Carl stands at
 * 2.03 in the same units for a six-foot man, so a seven-foot Bugaboo is a fifth
 * taller again — and it has to *look* it, because the whole point of the thing
 * is that it towers over either crawler.
 */
const FIGURE_HEIGHT = 2.44;

/**
 * Joint heights, all negative because +Y is down the screen. Every bone length
 * below is derived from these rather than the other way round, and none of them
 * is derived from the head: this skull is deliberately oversized, so anything
 * hung off it inflates.
 */
const ANKLE_Y = -0.1;
const KNEE_Y = -0.72;
export const HIP_Y = -1.3;
const BELLY_Y = -1.62;
const CHEST_Y = -1.86;
export const SHOULDER_Y = -1.96;
const HEAD_CENTRE_Y = -2.12;

/**
 * A hair over the straight-line distance, so a fully extended limb keeps a
 * trace of a bend instead of locking into a lifeless line. Tiny, because the
 * joint's sideways travel grows as the *square root* of it.
 */
const LEG_SLACK = 1.004;
export const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * LEG_SLACK;
export const SHIN_LENGTH = Math.abs(KNEE_Y - ANKLE_Y) * LEG_SLACK;

/**
 * Arms long enough that the knuckles hang below the knees. The gag of the
 * creature is arms far too long *and* far too thin for the body they come off,
 * so the reach is set against the shoulder height rather than any anatomical
 * ratio: hanging straight down the hands stop half a tile off the floor, with
 * the hips more than twice that high.
 */
export const UPPER_ARM_LENGTH = 0.62;
export const FOREARM_LENGTH = 0.6;
export const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

/**
 * A shoulder joint sits below the shoulder *line* poses write against. Hanging
 * a hand at exactly `ARM_LENGTH` below the line therefore leaves the solver
 * slack, and a two-bone solver spends slack throwing the elbow out sideways.
 */
const SHOULDER_JOINT_DROP = 0.06;

/** Half-widths of the mass at each height. Hips must never exceed shoulders. */
const SHOULDER_HALF = 0.5;
const CHEST_HALF = 0.55;
const HIP_HALF = 0.34;

/**
 * Where the arms root: just inside the shoulder's own half-width, so an arm
 * leaves the mass rather than floating off the side of it.
 */
const ARM_INSET = 0.94;
export const ARM_ROOT_HALF = SHOULDER_HALF * ARM_INSET;

/**
 * Where the legs root — far inboard of the body they carry. A mass three times
 * as wide as its own stance is what makes the legs read as comically skinny;
 * rooting them out under the hips would just make it a heavy animal.
 */
const LEG_ROOT_HALF = 0.135;

/** Limb widths. "Absurdly thin" is the brief, and these are the numbers for it. */
const THIGH_WIDTH = 0.056;
const KNEE_WIDTH = 0.04;
const CALF_WIDTH = 0.05;
const ANKLE_WIDTH = 0.032;
const CALF_AT = 0.32;
const UPPER_ARM_WIDTH = 0.045;
const ELBOW_WIDTH = 0.032;
const WRIST_WIDTH = 0.028;

/**
 * The skull: distinctly narrower than the shoulders it sits on, which is the
 * only thing that makes it read as a head at all. Given the same width as the
 * chest — the obvious way to draw "no neck" — the whole creature is one black
 * egg with eyes painted on the front of it.
 */
const HEAD_RX = 0.35;
const HEAD_RY = 0.3;
const HEAD_DEPTH_RATIO = 1.06;
const HEAD_DEPTH = HEAD_RX * HEAD_DEPTH_RATIO;

// ── Views ────────────────────────────────────────────────────────────────────

export type BugabooView = 'front' | 'back' | 'side';

interface ViewSpec {
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
  /**
   * Multiplier on the mass's drawn width. A bear-shaped body is nearly as deep
   * as it is wide, so in profile the mass stays broad even though the limbs
   * gather onto the centreline.
   */
  readonly girth: number;
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
const PROFILE_LATERAL = 0.28;
const PROFILE_GIRTH = 0.88;
const PROFILE_ARM_SPREAD = 0.14;

const VIEWS: Record<BugabooView, ViewSpec> = {
  front: { lateral: 1, girth: 1, armSpread: 1, profile: false, showsFace: true },
  back: { lateral: 1, girth: 1, armSpread: 1, profile: false, showsFace: false },
  side: {
    lateral: PROFILE_LATERAL,
    girth: PROFILE_GIRTH,
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
   * and without it a hand swung at the viewer stays pinned at the same height
   * instead of riding up as the forearm turns out of the picture plane.
   */
  readonly foreScale: number;
}

/**
 * One frame of a Bugaboo. Hand and foot positions are targets in figure space
 * that the limb solver reaches for, so the choreography never has to think
 * about joint angles. `left`/`right` are the creature's own left and right; in
 * the profile view the right side is the near one, closest to the camera.
 */
export interface BugabooPose {
  /** Whole-body vertical offset; negative lifts it off the ground. */
  bob: number;
  /** Hip shift along X — weight transfer, not a step. */
  sway: number;
  /** Body lean in radians; positive tips the shoulders toward +X. */
  lean: number;
  /** 0 stands tall, 1 sinks into a deep crouch. */
  crouch: number;
  /** Shoulder rotation about the spine, −1 to 1, seen as a width shift. */
  twist: number;
  /** Head turn, −1 to 1; in the head-on views it slides the face across. */
  headTurn: number;
  /** Head tilt in radians. */
  headTilt: number;
  /** 0 eyes open, 1 shut. */
  blink: number;
  /** How far the eyes bulge past their resting size, 0 to 1. */
  glare: number;
  /** 0 closed muzzle, 1 a full gape. */
  maw: number;
  leftHand: Pt;
  rightHand: Pt;
  leftFoot: Pt;
  rightFoot: Pt;
  /** 0 curled fingers, 1 claws fully splayed, per hand. */
  leftClaw: number;
  rightClaw: number;
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
   * that only gets shorter as the foot rises. Head-on there is no direction for
   * a knee to break into, so both legs of a head-on pose want the same value: a
   * bow that shows on one leg and not the other flickers once per step.
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
   * Whether an arm is on the far side of the mass and so drawn before it. Only
   * consulted head-on; in profile the far arm is always the left one. Walking
   * away from the camera this is what hides the forward half of an arm swing,
   * which is where a real arm spends most of its travel.
   */
  leftArmBehind: boolean;
  rightArmBehind: boolean;
  /** Sideways drift on the shaggy coat, −1 to 1. */
  furFlow: number;
  /** Slow shimmer through the coat, in radians, so the fur is never static. */
  furPhase: number;
  /**
   * How much of the creature is still below the floor, 0 to 1. At 1 nothing but
   * the hole is painted; the body rises through the breach as it falls to 0.
   * Everything below the floor line is clipped away, so this is the only pose
   * value that changes what is drawn rather than where.
   */
  submerged: number;
  /**
   * Paints the smashed floor the creature is coming up through. Sized to one
   * tile, because the defend quest paints this over a floor grate and a hole
   * wider than the grate reads as the room falling in rather than as one thing
   * forcing its way through one square.
   */
  breach: boolean;
}

/**
 * How far outboard of its own shoulder root a relaxed wrist hangs. Small: set
 * wide, the forearms have to angle out to reach and the arms stop hanging.
 */
const HAND_HANG_OUT = 0.09;
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
 * Feet stand under the hips. Any wider and the thighs angle out to reach them,
 * which reads as knock-kneed however subtle the knee itself is.
 */
export const FOOT_STAND_SPREAD = 0.15;

/** How far a relaxed hand's claws are spread. */
export const RESTING_CLAW = 0.25;
/** The break a relaxed elbow holds, which keeps the arm off the ribs. */
export const RESTING_ELBOW_FLARE = 0.3;

/** A relaxed standing pose. Every animation is written as edits to this. */
export function restingPose(): BugabooPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    crouch: 0,
    twist: 0,
    headTurn: 0,
    headTilt: 0,
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
 * Pulls a solved leg's knee back onto the hip→ankle line by `amount`, so the
 * leg reads as a column shortening toward the viewer rather than as a hinge
 * swinging sideways. See {@link BugabooPose.leftForeshorten}.
 */
function foreshortenLeg(chain: BoneChain, amount: number): BoneChain {
  if (amount <= 0) return chain;
  const straightKnee = mixPt(chain.root, chain.end, KNEE_ALONG_LEG);
  return { ...chain, joint: mixPt(chain.joint, straightKnee, clamp01(amount)) };
}

interface Skeleton {
  hip: Pt;
  belly: Pt;
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

/** How much of the hip height a full crouch removes. */
const CROUCH_DROP = 0.34;
/** Facing +X, a knee that bends toward +X is bending forward. */
const PROFILE_KNEE_FORWARD = -1;
/** A twisted body narrows on the trailing side and widens on the leading one. */
const TWIST_WIDTH_GAIN = 0.16;
const TWIST_SHOULDER_SHIFT = 0.07;
/** How far the head slides across the face when the pose turns it. */
const HEAD_TURN_TRAVEL = 0.42;

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

/** Forward kinematics for an arm: shoulder angle, then elbow angle. */
function armFromAngles(shoulder: Pt, angles: ArmAngles): BoneChain {
  const upper = rotate({ x: 0, y: UPPER_ARM_LENGTH }, -angles.upper);
  const joint = offset(shoulder, upper.x, upper.y);
  const fore = rotate({ x: 0, y: FOREARM_LENGTH * angles.foreScale }, -angles.fore);
  return { root: shoulder, joint, end: offset(joint, fore.x, fore.y) };
}

function buildSkeleton(pose: BugabooPose, view: ViewSpec): Skeleton {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);

  const belly = spinePoint(hip, Math.abs(BELLY_Y - HIP_Y), pose.lean);
  const chest = spinePoint(hip, Math.abs(CHEST_Y - HIP_Y), pose.lean);
  const shoulderCentre = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y), pose.lean);
  const headCentre = offset(
    spinePoint(hip, Math.abs(HEAD_CENTRE_Y - HIP_Y), pose.lean),
    pose.headTurn * HEAD_RX * view.lateral * HEAD_TURN_TRAVEL,
    0,
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
    belly,
    chest,
    shoulderCentre,
    headCentre,
    leftShoulder,
    rightShoulder,
    // A standing knee breaks *away* from the centreline; signed the other way
    // the two knees bow toward each other and the legs read as crossed. Edge-on
    // that rule does not apply — "away from the centreline" would send the two
    // knees in opposite directions and one of them would hinge backward, which
    // no leg does — so in profile both knees break forward.
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
export function solvedArm(pose: BugabooPose, view: BugabooView, side: 'left' | 'right'): BoneChain {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftArm : skeleton.rightArm;
}

/**
 * Where one leg actually roots, for the reach-headroom gate. Not the hip
 * *centre*: the roots sit a seventh of a tile either side of it, and a gate
 * measuring from the centre reads that offset as reach the leg does not have.
 */
export function solvedLegRoot(pose: BugabooPose, view: BugabooView, side: 'left' | 'right'): Pt {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftLeg.root : skeleton.rightLeg.root;
}

/** The ankle a foot target implies, for the reach-headroom gate. */
export { ankleFor };

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
const OUTLINE_BLEED = 0.012;

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
  bellyAt: 0.22,
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
 * smaller: the knee stops pinching and the shin and ankle gain a little.
 */
const NEAR_LEG_SHAPE: LimbShape = {
  root: THIGH_WIDTH,
  joint: THIGH_WIDTH,
  belly: CALF_WIDTH * 1.18,
  tip: ANKLE_WIDTH * 1.15,
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
  // the mass it hangs off.
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

const LIMB_SPARK_WIDTH = 0.6;
const LIMB_SPARK_ALPHA = 0.4;

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

const SHADOW_RX = 0.44;
const SHADOW_RY = 0.13;
const SHADOW_FOLLOW = 0.6;
const SHADOW_LIFT_FADE = 1.6;
const SHADOW_LIFT_SHRINK = 0.6;

// ── The coat ─────────────────────────────────────────────────────────────────

/**
 * A shaggy edge is one soft mass with an uneven outline, not a ring of spikes:
 * a curve walked through many small tufts, never straight lines between a few
 * tall peaks and deep notches. That is the difference between fur and a crown
 * of thorns, and it is the whole reason this creature reads as hairy rather
 * than as a black egg.
 */
const COAT_TUFTS = 30;
/**
 * Tuft height as a share of the mass's own radius. Sized against the *sheet*:
 * at a fifteenth of the radius a tuft is one pixel on the baked frame and half
 * of one in game, so the coat quietly bakes as a smooth egg.
 */
const TUFT_MIN = 0.08;
const TUFT_RANGE = 0.13;
/** How much a tuft leans with the coat's drift. */
const TUFT_LEAN = 0.5;
/** Amplitude of the idle shimmer, as a share of the tuft's own height. */
const TUFT_SHIMMER = 0.22;
/** How fast the shimmer runs around the body, in cycles per revolution. */
const TUFT_SHIMMER_WAVES = 3;
/** A fixed but arbitrary seed, so the coat is identical on every bake. */
const COAT_SEED = 31.7;

interface CoatMass {
  readonly centreX: number;
  readonly centreY: number;
  readonly radiusX: number;
  readonly radiusY: number;
}

/**
 * One tuft tip on the ragged outline of a mass, at angle `theta` around it.
 *
 * The tuft's own height is fixed per index — it must not be re-rolled per frame
 * or the coat boils — and only the shimmer term moves, driven by the pose's
 * `furPhase`, so consecutive frames differ a little everywhere rather than a
 * lot somewhere.
 */
function coatPoint(mass: CoatMass, index: number, pose: BugabooPose, scale: number): Pt {
  const theta = (index / COAT_TUFTS) * TWO_PI;
  const height = TUFT_MIN + hash1(index + COAT_SEED) * TUFT_RANGE;
  const shimmer =
    1 + Math.sin(theta * TUFT_SHIMMER_WAVES + pose.furPhase) * TUFT_SHIMMER * hash1(index * 2 + 1);
  const out = 1 + height * shimmer * scale;
  // The drift leans the tips downwind: a coat that only scales outward is a
  // halo, and a halo on a black body reads as a bad cut-out.
  const lean = pose.furFlow * TUFT_LEAN * height * scale;
  return {
    x: mass.centreX + Math.cos(theta) * mass.radiusX * out + lean * mass.radiusX,
    y: mass.centreY + Math.sin(theta) * mass.radiusY * out,
  };
}

/** Traces the ragged outline of one mass as a closed smooth curve. */
function traceCoat(ctx: Ctx, mass: CoatMass, pose: BugabooPose, scale: number): void {
  const tips = Array.from({ length: COAT_TUFTS }, (_unused, i) => coatPoint(mass, i, pose, scale));
  // Midpoint-to-midpoint quadratics with the tuft tips as control points, so the
  // outline passes *between* the tips as one continuous curve rather than
  // zig-zagging from spike to spike.
  const midpoints = tips.map((tip, i) => mixPt(tip, tips[(i + 1) % tips.length], 0.5));
  const last = midpoints[midpoints.length - 1];
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  for (let i = 0; i < tips.length; i++) {
    ctx.quadraticCurveTo(tips[i].x, tips[i].y, midpoints[i].x, midpoints[i].y);
  }
  ctx.closePath();
}

// ── The mass ─────────────────────────────────────────────────────────────────

/** Where the body's own centre sits between the hip and the chest. */
const BODY_CENTRE_ALONG = 0.45;
/**
 * The body lobe is a little shorter than the hip→chest span it is measured
 * from, because the skull's lobe carries the shoulders. Between them the two
 * overlap by a sixth of a tile, which is what makes them one form and not a
 * head balanced on a body.
 */
const BODY_HEIGHT_GAIN = 0.85;
/** The dark silhouette is drawn proud of the fur so it fringes it. */
const COAT_OUTLINE_SCALE = 1.8;

function bodyMassOf(skeleton: Skeleton, view: ViewSpec): CoatMass {
  const centre = mixPt(skeleton.hip, skeleton.chest, BODY_CENTRE_ALONG);
  return {
    centreX: centre.x,
    centreY: centre.y,
    radiusX: CHEST_HALF * view.girth,
    radiusY: Math.abs(skeleton.chest.y - skeleton.hip.y) * BODY_HEIGHT_GAIN,
  };
}

function skullMassOf(skeleton: Skeleton, view: ViewSpec): CoatMass {
  return {
    centreX: skeleton.headCentre.x,
    centreY: skeleton.headCentre.y,
    radiusX: (view.profile ? HEAD_DEPTH : HEAD_RX) * view.girth,
    radiusY: HEAD_RY,
  };
}

/**
 * Hips, chest and skull as one continuous shaggy form.
 *
 * The two lobes are outlined first and filled afterwards, in that order across
 * both: outlined and filled one at a time, the second lobe's dark fringe cuts
 * a seam across the first, and a seam between head and body is a neck — the one
 * feature the source material rules out.
 */
function drawMass(ctx: Ctx, skeleton: Skeleton, pose: BugabooPose, view: ViewSpec): void {
  const masses = [bodyMassOf(skeleton, view), skullMassOf(skeleton, view)];

  for (const mass of masses) {
    traceCoat(ctx, mass, pose, COAT_OUTLINE_SCALE);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
  }
  for (const mass of masses) {
    traceCoat(ctx, mass, pose, 1);
    ctx.fillStyle = FUR.mid;
    ctx.fill();
  }
  for (const mass of masses) drawMassShading(ctx, mass, pose);
  for (const mass of masses) drawFurStrokes(ctx, mass, pose);
  drawUnderbelly(ctx, skeleton, view);
}

const MASS_SHADOW_OFFSET = 0.92;
const MASS_SHADOW_INSET = 0.86;
const MASS_LIGHT_OFFSET = 0.34;
const MASS_LIGHT_INSET = 0.8;
const MASS_LIGHT_ALPHA = 0.32;

/**
 * Three tones over the mass: the mid it is already filled with, a shadow
 * swelling up from the unlit side, and a highlight cap on the lit one.
 *
 * Drawn as hard-edged shapes rather than as a gradient — gradients at this
 * scale wash out to a flat mid-tone — and in that order, because the reverse
 * (a light crescent cut back by a shadow) leaves a bright "C" ringing the body
 * that reads as a hole through it rather than as a lit edge.
 */
function drawMassShading(ctx: Ctx, mass: CoatMass, pose: BugabooPose): void {
  ctx.save();
  traceCoat(ctx, mass, pose, 1);
  ctx.clip();

  ctx.fillStyle = FUR.dark;
  ctx.beginPath();
  ctx.ellipse(
    mass.centreX - LIGHT.x * mass.radiusX * MASS_SHADOW_OFFSET,
    mass.centreY - LIGHT.y * mass.radiusY * MASS_SHADOW_OFFSET,
    mass.radiusX * MASS_SHADOW_INSET,
    mass.radiusY * MASS_SHADOW_INSET,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.globalAlpha = MASS_LIGHT_ALPHA;
  ctx.fillStyle = FUR.light;
  ctx.beginPath();
  ctx.ellipse(
    mass.centreX + LIGHT.x * mass.radiusX * MASS_LIGHT_OFFSET,
    mass.centreY + LIGHT.y * mass.radiusY * MASS_LIGHT_OFFSET,
    mass.radiusX * MASS_LIGHT_INSET,
    mass.radiusY * MASS_LIGHT_INSET,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
}

/**
 * Strokes of hair lying over the mass.
 *
 * Tone alone does not make a black shape read as fur: the three-tone body is a
 * *polished* black egg, which is the opposite of shaggy. These are what carry
 * the coat across the interior, where the ragged outline cannot reach.
 *
 * Only the lit side takes them — a stroke in the shadow is a stroke nobody can
 * see, and painting them everywhere doubles the cost of the row for nothing.
 */
const FUR_STROKES = 26;
const FUR_STROKE_LENGTH = 0.3;
const FUR_STROKE_WIDTH = 0.016;
const FUR_STROKE_ALPHA = 0.3;
/** Strokes lie along the body, so they sweep down and out from the crown. */
const FUR_STROKE_LEAN = 0.5;
const FUR_STROKE_SEED = 5.1;
/** How far in from the coat's edge a stroke's root sits. */
const FUR_STROKE_INSET = 0.86;

function drawFurStrokes(ctx: Ctx, mass: CoatMass, pose: BugabooPose): void {
  ctx.save();
  traceCoat(ctx, mass, pose, 1);
  ctx.clip();
  ctx.strokeStyle = FUR.light;
  ctx.lineCap = 'round';
  ctx.lineWidth = FUR_STROKE_WIDTH;

  for (let i = 0; i < FUR_STROKES; i++) {
    const theta = TWO_PI * hash1(i + FUR_STROKE_SEED);
    const radius = FUR_STROKE_INSET * Math.sqrt(hash1(i * 3 + FUR_STROKE_SEED));
    const lit = -(Math.cos(theta) * LIGHT.x + Math.sin(theta) * LIGHT.y);
    if (lit <= 0) continue;
    const rootX = mass.centreX + Math.cos(theta) * mass.radiusX * radius;
    const rootY = mass.centreY + Math.sin(theta) * mass.radiusY * radius;
    const length = mass.radiusY * FUR_STROKE_LENGTH * (0.6 + hash1(i * 7 + 1) * 0.8);
    const drift = (pose.furFlow + Math.sin(theta * 2 + pose.furPhase) * 0.3) * FUR_STROKE_LEAN;
    ctx.globalAlpha = FUR_STROKE_ALPHA * lit;
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.quadraticCurveTo(
      rootX + drift * length * 0.5,
      rootY + length * 0.5,
      rootX + drift * length,
      rootY + length,
    );
    ctx.stroke();
  }
  ctx.restore();
}

const UNDERBELLY_DROP = 0.16;
const UNDERBELLY_PINCH = 0.62;

/**
 * A dark pool across the underside of the mass, where the legs leave it.
 *
 * The legs root inside the fur, so without this the thighs simply appear out of
 * a flat black shape; the pool is what reads as the body's own shadow falling
 * on the place they come out of.
 */
function drawUnderbelly(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const half = HIP_HALF * view.girth;
  const rump = skeleton.hip.y + UNDERBELLY_DROP;
  ctx.beginPath();
  ctx.moveTo(skeleton.hip.x - half, skeleton.belly.y);
  ctx.quadraticCurveTo(skeleton.hip.x - half * UNDERBELLY_PINCH, rump, skeleton.hip.x, rump);
  ctx.quadraticCurveTo(
    skeleton.hip.x + half * UNDERBELLY_PINCH,
    rump,
    skeleton.hip.x + half,
    skeleton.belly.y,
  );
  ctx.closePath();
  ctx.fillStyle = FUR.dark;
  ctx.fill();
}

const RIM_WIDTH = 0.03;
const RIM_HIP_PINCH = 0.82;
const RIM_BELLY_BULGE = 1.04;
const RIM_SKULL_BULGE = 1.02;
const RIM_CROWN_PINCH = 0.6;
const RIM_CROWN_RISE = 0.72;

/**
 * The specular that makes an obsidian body legible against an unlit floor.
 *
 * Run down the lit edge as a single stroke, so it unifies hips, chest and skull
 * into one silhouette instead of outlining three separate shapes.
 */
function drawRimLight(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const side = LIGHT.x < 0 ? -1 : 1;
  const half = CHEST_HALF * view.girth * side;
  const skullHalf = (view.profile ? HEAD_DEPTH : HEAD_RX) * view.girth * side;
  ctx.save();
  ctx.globalAlpha = RIM_ALPHA;
  ctx.strokeStyle = RIM_LIGHT;
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(skeleton.hip.x + half * RIM_HIP_PINCH, skeleton.hip.y);
  ctx.quadraticCurveTo(
    skeleton.belly.x + half * RIM_BELLY_BULGE,
    skeleton.belly.y,
    skeleton.shoulderCentre.x + half,
    skeleton.shoulderCentre.y,
  );
  ctx.quadraticCurveTo(
    skeleton.headCentre.x + skullHalf * RIM_SKULL_BULGE,
    skeleton.headCentre.y,
    skeleton.headCentre.x + skullHalf * RIM_CROWN_PINCH,
    skeleton.headCentre.y - HEAD_RY * RIM_CROWN_RISE,
  );
  ctx.stroke();
  ctx.restore();
}

// ── Ears ─────────────────────────────────────────────────────────────────────

/**
 * Small rounded bear ears at the top corners of the skull.
 *
 * They sit *on* the skull's own arc rather than at its full half-width: the
 * head is an ellipse, so a point at the half-width at ear height hangs off the
 * side of the face.
 */
const EAR_ANGLE = deg(44);
const EAR_R = 0.15;
const EAR_INNER_R = 0.082;
const EAR_INNER_DROP = 0.026;
/**
 * Just past the skull's own arc, so the ears break the coat's outline. Set flush
 * with it they are swallowed by the fringe and the creature loses the one cue
 * that says "bear" rather than "blob".
 */
const EAR_ON_SKULL = 1.05;

/** How far the ear's own shading is pushed away from the key light. */
const EAR_SHADE_SHIFT = 0.3;
const EAR_SHADE_R = 0.82;

const PROFILE_EAR_BACK = -0.55;

function drawEars(ctx: Ctx, radiusX: number, showsInner: boolean, profile: boolean): void {
  // Edge-on the far ear is hidden behind the skull and the near one sits well
  // back on it: given both, one lands out over the snout and the crown reads as
  // a row of lumps instead of a head.
  for (const side of profile ? [PROFILE_EAR_BACK] : [-1, 1]) {
    const x = Math.cos(EAR_ANGLE) * radiusX * side * EAR_ON_SKULL;
    const y = -Math.sin(EAR_ANGLE) * HEAD_RY * EAR_ON_SKULL;
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(x, y, EAR_R + OUTLINE_BLEED, 0, TWO_PI);
    ctx.fill();
    // Lit rather than mid-toned: an ear the same colour as the skull it sits on
    // is drawn and invisible, whatever size it is.
    ctx.fillStyle = FUR.light;
    ctx.beginPath();
    ctx.arc(x, y, EAR_R, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = FUR.mid;
    ctx.beginPath();
    ctx.arc(
      x - Math.sign(side) * EAR_R * EAR_SHADE_SHIFT,
      y + EAR_INNER_DROP,
      EAR_R * EAR_SHADE_R,
      0,
      TWO_PI,
    );
    ctx.fill();
    if (!showsInner) continue;
    ctx.fillStyle = FUR.dark;
    ctx.beginPath();
    ctx.arc(x, y + EAR_INNER_DROP, EAR_INNER_R, 0, TWO_PI);
    ctx.fill();
  }
}

// ── The face ─────────────────────────────────────────────────────────────────

/**
 * Enormous owl eyes: nearly touching at the bridge and reaching almost to the
 * edge of the skull. At a 32px tile these are about five pixels across, which
 * is the smallest anything can be and still read as a *feature* rather than a
 * speck — and they are the only bright thing on an otherwise black creature.
 */
const EYE_SPREAD = 0.44;
const EYE_Y = -0.02;
const EYE_RX = 0.155;
const EYE_RY = 0.15;
/**
 * The outer corner rides higher than the inner one, so the two eyes read as a
 * scowl. This is the single cheapest thing that separates a predator's face
 * from a cartoon owl's: round eyes set level are friendly at any colour.
 */
const EYE_TILT = deg(14);
/** How much the eyes bulge at a full glare. */
const EYE_GLARE_GAIN = 0.16;
/**
 * The eye is one burning disc, not a pale sclera with a coloured disc floating
 * in it. Whites are what make a big eye look *sweet*: the moment they are gone
 * and the iris fills the socket the same shape reads as an animal's.
 */
const IRIS_SHADE_DROP = 0.34;
const IRIS_SHADE_RATIO = 0.55;
/**
 * A vertical slit, and a narrow one. A wide round pupil is a friendly pupil —
 * every cartoon owl has one — while a constricted slit on a big amber eye is
 * the look of something that has already decided what it is going to do.
 */
const PUPIL_WIDTH_RATIO = 0.24;
const PUPIL_HEIGHT_RATIO = 0.8;
/** The slit narrows further as it fixes on something. */
const PUPIL_GLARE_PINCH = 0.4;
const EYE_RING_WIDTH = 0.03;
/**
 * A wet highlight, kept small and pushed out to the rim. Centred and large it
 * is the "sparkle" that makes any eye look kind.
 */
const SPARK_RATIO = 0.11;
const SPARK_OFFSET = 0.52;
/** How much of its height a fully shut eye keeps; not zero, or the lid vanishes. */
const BLINK_CLOSE = 0.86;

/**
 * The brow ridge: a heavy wedge overhanging each eye, dropping toward the
 * bridge of the snout. Nothing else on the face does as much — a hooded, angled
 * brow turns the same pair of eyes from startled to furious.
 */
const BROW_OVERHANG = 0.42;
const BROW_THICKNESS = 0.5;
const BROW_INNER_DROP = 0.5;
const BROW_OUTER_LIFT = 0.22;
const BROW_SPAN = 1.25;
/** How much further the brow drops over the eye at a full glare. */
const BROW_GLARE_DROP = 0.3;

/** How far forward of the skull's centre the profile's single eye sits. */
const PROFILE_EYE_X = 0.46;
const PROFILE_MUZZLE_X = 0.72;

const MUZZLE_Y = 0.15;
const MUZZLE_RX = 0.17;
const MUZZLE_RY = 0.11;
const NOSE_Y = 0.11;
const NOSE_RX = 0.062;
const NOSE_RY = 0.042;

/**
 * The jaw line, drawn closed as well as open.
 *
 * A face that is two big eyes over a blank snout is the mascot formula whatever
 * the eyes are doing — the mouth is what makes the rest of it read as an animal
 * that bites. It sits *under* the muzzle's own light patch, so the snout has a
 * lower lip rather than fading out into the coat.
 */
const LIP_WIDTH = 0.024;
const LIP_HALF = 0.13;
const LIP_BOW = 0.055;
const MAW_Y = 0.24;
const MAW_HALF = 0.14;
const MAW_OPEN = 0.15;
const MAW_FLOOR_BOW = 0.35;
const PROFILE_MAW_NARROW = 0.7;
const TOOTH_COUNT = 4;
const TOOTH_HEIGHT = 0.05;
const TOOTH_INSET = 0.82;
const TOOTH_HALF = 0.018;

/**
 * The face, painted in the skull's own local space with the origin at the head
 * centre. Nothing here is drawn in the `back` view: from behind there is no
 * face, and a hint of one is worse than none.
 */
function drawFace(ctx: Ctx, pose: BugabooPose, view: ViewSpec): void {
  const radiusX = (view.profile ? HEAD_DEPTH : HEAD_RX) * view.girth;
  const featureX = view.profile ? radiusX * PROFILE_MUZZLE_X : 0;
  if (view.profile) drawProfileSnout(ctx, radiusX);
  drawMuzzle(ctx, featureX, view.profile);
  if (pose.maw > 0) drawMaw(ctx, featureX, pose.maw, view.profile);

  // In profile the far eye is hidden behind the muzzle, so only the near one is
  // painted and it sits forward on the skull rather than centred on it.
  const eyes: readonly number[] = view.profile ? [PROFILE_EYE_X] : [-EYE_SPREAD, EYE_SPREAD];
  const bulge = 1 + pose.glare * EYE_GLARE_GAIN;
  // Edge-on the eye's inner side is the back of the skull, which is −X.
  for (const side of eyes)
    drawEye(ctx, side * radiusX, view.profile ? -1 : -Math.sign(side), bulge, pose);
}

/**
 * `inward` is −1 for an eye whose nose side is toward −X and +1 for the other,
 * so the brow and the tilt know which way the face's centreline lies. The
 * profile has only one eye and its inner side is the back of the skull.
 */
function drawEye(ctx: Ctx, x: number, inward: number, bulge: number, pose: BugabooPose): void {
  const lid = clamp01(pose.blink);
  const rx = EYE_RX * bulge;
  const ry = EYE_RY * bulge * (1 - lid * BLINK_CLOSE);
  const y = EYE_Y;
  const tilt = -inward * EYE_TILT;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);

  ctx.fillStyle = IRIS;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
  // The lower half of the socket is in the brow's shadow, which is what stops
  // a single flat disc of amber reading as a painted dot.
  ctx.fillStyle = IRIS_DEEP;
  ctx.beginPath();
  ctx.ellipse(0, ry * IRIS_SHADE_DROP, rx, ry * IRIS_SHADE_RATIO, 0, 0, TWO_PI);
  ctx.fill();

  const pinch = 1 - pose.glare * PUPIL_GLARE_PINCH;
  ctx.fillStyle = PUPIL;
  ctx.beginPath();
  // Counter-rotated: the socket is tilted into a scowl but the slit itself
  // stays plumb, the way a goat's or a cat's does. Tilted with the eye the two
  // slits lean apart and the creature reads as cross-eyed.
  ctx.ellipse(0, 0, rx * PUPIL_WIDTH_RATIO * pinch, ry * PUPIL_HEIGHT_RATIO, -tilt, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = EYE_SPARK;
  ctx.beginPath();
  ctx.ellipse(
    -inward * rx * SPARK_OFFSET,
    -ry * SPARK_OFFSET,
    rx * SPARK_RATIO,
    ry * SPARK_RATIO,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = EYE_RING_WIDTH;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TWO_PI);
  ctx.stroke();

  // A blink closes the eye from the top down: an eye that only shrinks about
  // its own centre reads as a pupil retracting, not as a lid coming over it.
  if (lid > 0) {
    ctx.fillStyle = FUR.mid;
    ctx.beginPath();
    ctx.ellipse(0, -EYE_RY * bulge * (1 - lid), EYE_RX * bulge, EYE_RY * bulge * lid, 0, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();

  drawBrow(ctx, x, y, rx, EYE_RY * bulge, inward, pose.glare);
}

/** The hooded ridge over one eye, drawn after it so it cuts into the socket. */
function drawBrow(
  ctx: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  inward: number,
  glare: number,
): void {
  const drop = BROW_OVERHANG + glare * BROW_GLARE_DROP;
  const inner = x + inward * rx * BROW_SPAN;
  const outer = x - inward * rx * BROW_SPAN;
  const innerY = y - ry * (1 - BROW_INNER_DROP * drop);
  const outerY = y - ry * (1 + BROW_OUTER_LIFT);
  const thickness = ry * BROW_THICKNESS;
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.moveTo(inner, innerY);
  ctx.quadraticCurveTo(x, y - ry * (1 - drop * BROW_INNER_DROP * 0.4), outer, outerY);
  ctx.lineTo(outer, outerY - thickness);
  ctx.quadraticCurveTo(x, innerY - thickness * 1.6, inner, innerY - thickness);
  ctx.closePath();
  ctx.fill();
}

/**
 * The snout, as a bump in the profile's own silhouette.
 *
 * Edge-on the skull is otherwise a circle with one eye in it, which reads as a
 * ball and not as a head at all. Short and broad, not long: a snout carried far
 * enough forward to be unmissable stops being a bear's and becomes a beak.
 */
const SNOUT_REACH = 1.5;
const SNOUT_ROOT_X = 0.3;
const SNOUT_TOP_Y = -0.04;
const SNOUT_TIP_Y = 0.12;
const SNOUT_JAW_Y = 0.26;

function drawProfileSnout(ctx: Ctx, radiusX: number): void {
  const tip = radiusX * SNOUT_REACH;
  const root = radiusX * SNOUT_ROOT_X;
  const trace = (bleed: number): void => {
    ctx.beginPath();
    ctx.moveTo(root, SNOUT_TOP_Y - bleed);
    ctx.quadraticCurveTo(tip * 0.9, SNOUT_TOP_Y - bleed, tip + bleed, SNOUT_TIP_Y);
    ctx.quadraticCurveTo(tip * 0.8, SNOUT_JAW_Y + bleed, root, SNOUT_JAW_Y + bleed);
    ctx.closePath();
  };
  trace(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  trace(0);
  ctx.fillStyle = FUR.mid;
  ctx.fill();
}

function drawMuzzle(ctx: Ctx, x: number, profile: boolean): void {
  ctx.fillStyle = MUZZLE;
  ctx.beginPath();
  ctx.ellipse(x, MUZZLE_Y, MUZZLE_RX, MUZZLE_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = NOSE;
  ctx.beginPath();
  ctx.ellipse(x, NOSE_Y, NOSE_RX, NOSE_RY, 0, 0, TWO_PI);
  ctx.fill();

  const half = LIP_HALF * (profile ? PROFILE_MAW_NARROW : 1);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = LIP_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - half, MAW_Y - LIP_BOW);
  ctx.quadraticCurveTo(x, MAW_Y + LIP_BOW, x + half, MAW_Y - LIP_BOW);
  ctx.stroke();
}

/**
 * The gape. Teeth are triangular bumps along the upper jaw rather than separate
 * strokes: at tile size a row of individual teeth reads as a dotted line.
 */
function drawMaw(ctx: Ctx, x: number, open: number, profile: boolean): void {
  const half = MAW_HALF * (profile ? PROFILE_MAW_NARROW : 1);
  const drop = MAW_OPEN * open;
  ctx.fillStyle = MAW_INNER;
  ctx.beginPath();
  ctx.moveTo(x - half, MAW_Y);
  ctx.quadraticCurveTo(x, MAW_Y + drop * MAW_FLOOR_BOW, x + half, MAW_Y);
  ctx.quadraticCurveTo(x, MAW_Y + drop, x - half, MAW_Y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = TOOTH;
  const height = TOOTH_HEIGHT * open;
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const at = x + lerp(-half, half, (i + 0.5) / TOOTH_COUNT) * TOOTH_INSET;
    ctx.beginPath();
    ctx.moveTo(at - TOOTH_HALF, MAW_Y);
    ctx.lineTo(at, MAW_Y + height);
    ctx.lineTo(at + TOOTH_HALF, MAW_Y);
    ctx.closePath();
    ctx.fill();
  }
}

// ── Hands ────────────────────────────────────────────────────────────────────

/**
 * A hand is three long claws off a small palm — the shape that has to be
 * legible entirely on its own, because the defend quest paints one of these
 * coming up out of a hole in the floor with nothing else of the creature
 * visible.
 *
 * Derived from the forearm, never from the skull: hanging a hand off this
 * creature's deliberately oversized head makes it a catcher's mitt.
 */
const PALM_R = FOREARM_LENGTH * 0.125;
const CLAW_LENGTH = FOREARM_LENGTH * 0.4;
const CLAW_COUNT = 3;
/** How far the claws fan apart at full spread. */
const CLAW_FAN = deg(34);
/** The curl a relaxed hand keeps, so it is never a starfish. */
const CLAW_CURL = deg(52);
/**
 * Wider than a claw that thin has any right to be. The sheet bakes at about 46
 * pixels to the figure unit, so a claw at 0.024 is one pixel across and gone
 * the moment the frame is downsampled — and the claws are the whole of the
 * breach row, where a hand out of a hole is all the player sees.
 */
const CLAW_WIDTH = 0.036;
const CLAW_TIP_WIDTH = 0.01;
const CLAW_TAPER = 0.7;
/** Where the single knuckle falls along a claw. */
const CLAW_KNUCKLE_ALONG = 0.45;
const PALM_LEAD = 0.6;

/**
 * A hand does not take the full angle of its forearm: real hands stay rigid
 * relative to the body while the forearm swings under them. Blending toward the
 * whole arm's line costs nothing on a straight limb, so a strike is unaffected.
 */
const WRIST_FOLLOW = 0.3;

function wristAngle(chain: BoneChain): number {
  const alongArm = angleBetween(chain.root, chain.end);
  const alongForearm = angleBetween(chain.joint, chain.end);
  return lerp(alongArm, alongForearm, WRIST_FOLLOW);
}

function drawHand(ctx: Ctx, chain: BoneChain, spread: number, shade: number): void {
  const open = clamp01(spread);
  const hide = mix(FUR.mid, OUTLINE, shade);
  const clawLit = mix(CLAW_LIT, OUTLINE, shade);
  const clawDark = mix(CLAW_DARK, OUTLINE, shade);

  ctx.save();
  ctx.translate(chain.end.x, chain.end.y);
  ctx.rotate(wristAngle(chain));

  for (let i = 0; i < CLAW_COUNT; i++) {
    const fan = ((i - (CLAW_COUNT - 1) / 2) / ((CLAW_COUNT - 1) / 2)) * CLAW_FAN * open;
    const curl = CLAW_CURL * (1 - open);
    const root = pt(PALM_R * PALM_LEAD, 0);
    const knuckle = rotate({ x: CLAW_LENGTH * CLAW_KNUCKLE_ALONG, y: 0 }, fan);
    const joint = offset(root, knuckle.x, knuckle.y);
    const tipStep = rotate({ x: CLAW_LENGTH * (1 - CLAW_KNUCKLE_ALONG), y: 0 }, fan + curl);
    const end = offset(joint, tipStep.x, tipStep.y);
    outlineCapsule(ctx, root, joint, CLAW_WIDTH, CLAW_WIDTH * CLAW_TAPER);
    outlineCapsule(ctx, joint, end, CLAW_WIDTH * CLAW_TAPER, CLAW_TIP_WIDTH);
    fillCapsule(ctx, root, joint, CLAW_WIDTH, CLAW_WIDTH * CLAW_TAPER, clawDark);
    fillCapsule(ctx, joint, end, CLAW_WIDTH * CLAW_TAPER, CLAW_TIP_WIDTH, clawLit);
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
 * Derived from the figure's height, not from its head. A foot is a narrow pad
 * with three stubby toes: broad enough to carry the mass, small enough that the
 * legs still read as twigs.
 */
const FOOT_LEN = FIGURE_HEIGHT * 0.115;
const FOOT_DEPTH = FOOT_LEN * 0.44;
const HEEL_SHARE = 0.26;
/** Head-on a foot is seen end-on, so it draws barely half as long. */
const FOOT_FORESHORTEN = 0.52;
/**
 * How far the toe end leads outward head-on. A foot pointed at the camera
 * cannot be splayed by *rotating* it — that rolls the creature onto the outside
 * edges of both soles — so the toe end leads and the sole stays level.
 */
const FOOT_SPLAY = 0.3;
const TOE_COUNT = 3;
/** Toes are bumps in the silhouette; drawn as strokes they read as sandal straps. */
const TOE_BUMP = 0.34;
const HEEL_LOBE = 0.55;
const INSTEP_AT = 0.35;

/** `outward` is +1 for the creature's right foot and −1 for its left. */
function drawFoot(ctx: Ctx, ankle: Pt, pitch: number, view: ViewSpec, outward: number): void {
  const length = FOOT_LEN * (view.profile ? 1 : FOOT_FORESHORTEN);
  const lead = view.profile ? 0 : outward * length * FOOT_SPLAY;
  const heel = -length * HEEL_SHARE;
  const toe = length * (1 - HEEL_SHARE) + lead;
  const sole = -ANKLE_Y;
  const toeSpan = (toe - heel) / (TOE_COUNT + 1);

  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(pitch);
  ctx.beginPath();
  ctx.moveTo(heel, sole);
  ctx.lineTo(toe, sole);
  for (let i = 0; i < TOE_COUNT; i++) {
    const from = toe - toeSpan * i;
    const to = from - toeSpan;
    ctx.quadraticCurveTo(
      (from + to) / 2,
      sole - FOOT_DEPTH * (TOE_BUMP + i * TOE_RISE),
      to,
      sole - FOOT_DEPTH * TOE_BUMP,
    );
  }
  ctx.quadraticCurveTo(
    lerp(heel, toe, INSTEP_AT),
    sole - FOOT_DEPTH,
    heel,
    sole - FOOT_DEPTH * HEEL_LOBE,
  );
  ctx.quadraticCurveTo(heel - FOOT_DEPTH * HEEL_ROUND, sole, heel, sole);
  ctx.closePath();
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.restore();
}

/** Each toe back from the lead one stands a little higher up the instep. */
const TOE_RISE = 0.12;
const HEEL_ROUND = 0.5;

// ── The breach ───────────────────────────────────────────────────────────────

/**
 * The hole a Bugaboo comes up through: one tile's worth of smashed floor slab
 * over a black void.
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

/** How much of the body's lean the skull copies; a head that follows fully hunches. */
const HEAD_LEAN_FOLLOW = 0.3;
/** Feet turn outward, away from the centreline, on both sides. */
const LEFT_FOOT_OUT = -1;
const RIGHT_FOOT_OUT = 1;
/** How far below the floor line a fully submerged creature is pushed. */
export const SUBMERGE_DEPTH = FIGURE_HEIGHT * 1.05;
/** The floor line the breach cuts the body off at, in figure units. */
export const BREACH_FLOOR_Y = -0.02;
/** The clip is far wider than the figure, so only its floor edge ever cuts. */
const CLIP_SPAN = 4;

function drawFigure(ctx: Ctx, view: ViewSpec, pose: BugabooPose): void {
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

function drawBody(ctx: Ctx, view: ViewSpec, pose: BugabooPose, sunk: number): void {
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

  // The creature's left side is the far one. Seen edge-on that arm is genuinely
  // behind the mass; head-on it hangs in front of the body like the near one
  // does, and drawing it early is what makes a figure look one-armed.
  const farArmShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  const leftBehind = view.profile || pose.leftArmBehind;
  const rightBehind = !view.profile && pose.rightArmBehind;
  if (leftBehind) drawArm(ctx, skeleton.leftArm, pose.leftClaw, farArmShade);
  if (rightBehind) drawArm(ctx, skeleton.rightArm, pose.rightClaw, farArmShade);

  drawLeg(ctx, skeleton.leftLeg, pose.leftFootPitch, view, LEFT_FOOT_OUT, pose.leftLegNearness);
  drawLeg(ctx, skeleton.rightLeg, pose.rightFootPitch, view, RIGHT_FOOT_OUT, pose.rightLegNearness);

  drawMass(ctx, skeleton, pose, view);
  drawRimLight(ctx, skeleton, view);

  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(pose.headTilt + pose.lean * HEAD_LEAN_FOLLOW);
  drawEars(ctx, (view.profile ? HEAD_DEPTH : HEAD_RX) * view.girth, view.showsFace, view.profile);
  if (view.showsFace) drawFace(ctx, pose, view);
  ctx.restore();

  if (!leftBehind) drawArm(ctx, skeleton.leftArm, pose.leftClaw, farArmShade);
  if (!rightBehind) drawArm(ctx, skeleton.rightArm, pose.rightClaw, UNSHADED);
}

function drawArm(ctx: Ctx, chain: BoneChain, claw: number, shade: number): void {
  drawLimb(ctx, chain, ARM_SHAPE, shade);
  drawHand(ctx, chain, claw, shade);
}

/**
 * No depth shade on a leg in any view: at this width a shaded leg does not read
 * as a far leg, it reads as one leg painted a different colour. Edge-on the
 * outline is what separates them.
 */
function drawLeg(
  ctx: Ctx,
  chain: BoneChain,
  pitch: number,
  view: ViewSpec,
  outward: number,
  nearness: number,
): void {
  drawLimb(ctx, chain, legShapeFor(nearness), UNSHADED);
  drawFoot(ctx, chain.end, pitch, view, outward);
}

/** Head-on, coming at the camera. */
export function drawBugabooFront(ctx: Ctx, pose: BugabooPose): void {
  drawFigure(ctx, VIEWS.front, pose);
}

/** From behind, walking away. */
export function drawBugabooBack(ctx: Ctx, pose: BugabooPose): void {
  drawFigure(ctx, VIEWS.back, pose);
}

/** In profile. Always drawn facing +X; the runtime mirrors for the left. */
export function drawBugabooSide(ctx: Ctx, pose: BugabooPose): void {
  drawFigure(ctx, VIEWS.side, pose);
}
