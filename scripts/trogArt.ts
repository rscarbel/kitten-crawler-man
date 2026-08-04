/**
 * Drawing engine for the Troglodyte — the blind cave amphibian that hunts by
 * smell and kills with a venomous tongue.
 *
 * The read the whole design serves: a stooped, long-armed predator that has
 * never seen daylight. Broad flat skull, a lipless jaw that hinges nearly the
 * full width of the head, milky sightless eyes set high and wide, gill slits
 * behind the jaw, a crest of spines down the spine, and wet mottled hide over
 * a heavy gut. Everything below the hips is folded — the legs are longer than
 * the hips are high, so the creature is permanently crouched and springs
 * rather than strides.
 *
 * The figure is built by forward kinematics and painted over the joints, so a
 * limb cannot come apart however far a pose throws it. Three viewpoints are
 * drawn — `front` (toward the camera), `back` (away) and `side` (profile,
 * always facing +X so the runtime can mirror it) — and all three read the same
 * {@link TrogPose}; the choreography that fills that pose lives in
 * `scripts/generate-troglodyte-sprite.ts`.
 *
 * Coordinates are tile units with the origin at the point between the feet and
 * +Y pointing down the screen, so heights above the ground are negative — the
 * same frame `carlArt.ts` uses, and for the same reason: the generator
 * translates to that ground point, scales by one tile, and calls a painter.
 *
 * The rig's structure — the `ViewSpec` table, hand/foot targets solved by a
 * two-bone IK with FK escape hatches for swinging arms, and poses written as
 * edits to one resting pose — is taken from `carlArt.ts`, the only figure in
 * this game whose movement convinces. The anatomy on top of it is not.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { TWO_PI, clamp01, deg, easeInOut, hash1, lerp, mix, pt, rgba, type Pt } from './ratArt';

export { TWO_PI, clamp01, deg, easeInOut, hash1, lerp, mix, pt, rgba };
export type { Pt };

const HALF_PI = Math.PI / 2;

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

/** Piecewise linear interpolation through a set of (t, value) keys. */
export function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  for (let i = 1; i < keys.length; i++) {
    const [prevT, prevV] = keys[i - 1];
    const [nextT, nextV] = keys[i];
    if (t <= nextT) return lerp(prevV, nextV, (t - prevT) / (nextT - prevT));
  }
  return keys[keys.length - 1][1];
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

const OUTLINE = '#0e1512';

/**
 * Cave hide: a cold grey-green that has never had any sun on it. Deliberately
 * desaturated — the old sprite's leaf green read as a cartoon frog, and green
 * is the one hue a player already associates with harmless pond life.
 */
export const HIDE: Ramp = {
  shadow: '#28332c',
  dark: '#4b5c4f',
  mid: '#7d9080',
  light: '#a3b5a2',
  rim: '#ccd7c6',
};

/** Throat, chest and the inside of every limb: waxy, near-translucent. */
const BELLY: Ramp = {
  shadow: '#6e7159',
  dark: '#969778',
  mid: '#bcba99',
  light: '#d6d1b0',
  rim: '#e8e2c4',
};

/** The darker blotching over the back and skull. */
const MOTTLE = '#33422f';
/** Claws, teeth and the crest spines — old horn rather than white bone. */
const HORN: Ramp = {
  shadow: '#3b3f34',
  dark: '#5c6150',
  mid: '#878a72',
  light: '#adaf95',
  rim: '#cfd0b6',
};

const TOOTH = '#ddd6bd';
const GULLET = '#3d1219';
const GUM = '#6d2430';
/** A blind eye: no iris, no pupil, just clouded jelly. */
const EYE_MILK = '#c6cbb6';
const EYE_CLOUD = '#8f9a86';
const EYE_RING = '#1b211a';
/** The nictitating membrane that slides across when it blinks. */
const EYE_LID = '#7d8c74';
/** Venom, wherever it shows: on the tongue root and beading on the fangs. */
export const VENOM = '#b9d24a';

/** Cool bounce light along the right-hand edge of every form. */
const RIM_LIGHT = '#b9c9bd';
const RIM_ALPHA = 0.24;
const SHEEN_ALPHA = 0.28;
const CONTACT_SHADOW_ALPHA = 0.42;
/**
 * The wet specular pass. Small, bright and few: this is the single cue that
 * separates an amphibian from a lizard, and spread over the whole body it just
 * reads as a washed-out figure.
 */
const WET_ALPHA = 0.22;
const MOTTLE_ALPHA = 0.5;

/** Unit vector the key light arrives from, in figure space. */
const LIGHT: Pt = { x: -0.62, y: -0.78 };

// ── Proportions ──────────────────────────────────────────────────────────────
// Heights are y values, so they are negative: the origin sits between the feet
// and the screen's +Y runs down.

/** Crown of the skull to the ground, standing at rest. */
export const FIGURE_HEIGHT = 1.5;
/**
 * Far fewer heads than a human, and deliberately. Two reasons compound: the
 * skull is this creature's whole identity, and it has to survive being drawn at
 * a 32 px tile where a realistically-proportioned head is four pixels of wedge.
 *
 * The trunk is also heavy for something standing on two legs — that bulk is the
 * stoop's whole point — and a small head over it reads as a person in a suit
 * rather than as an animal built round its jaws.
 */
const HEADS_TALL = 3.4;
const HEAD_HEIGHT = FIGURE_HEIGHT / HEADS_TALL;

const ANKLE_Y = -0.105;
const KNEE_Y = -0.5;
const HIP_Y = -0.8;
const WAIST_Y = -0.95;
export const SHOULDER_Y = -1.16;
/**
 * High enough above the shoulder line to leave a neck that is visibly its own
 * segment. Sat where the skull's underside met the shoulders the creature read
 * as an amphibian — a frog has no neck, and nothing else about a head can undo
 * that once the jaw hinges are level with the collarbone.
 */
const HEAD_CENTRE_Y = -1.3;

/**
 * The legs are longer than the hip is high, which is the whole silhouette: the
 * knees can never straighten, so the creature stands folded and reads as
 * something that springs rather than walks. Carl's legs are sized to *just*
 * reach the floor from his hip; these overshoot it by a fifth.
 */
const LEG_OVERSHOOT = 1.2;
const HIP_TO_ANKLE = Math.abs(HIP_Y - ANKLE_Y);
const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * LEG_OVERSHOOT;
const SHIN_LENGTH = (HIP_TO_ANKLE - Math.abs(HIP_Y - KNEE_Y)) * LEG_OVERSHOOT;

/**
 * Long enough that a hanging hand falls past the knee. Anything shorter and the
 * creature reads as a squat little humanoid instead of something that moves on
 * its knuckles when it is not upright.
 */
export const UPPER_ARM_LENGTH = 0.39;
export const FOREARM_LENGTH = 0.39;
/** Shoulder to wrist. A relaxed arm hangs at very nearly this. */
export const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

const SHOULDER_HALF = 0.255;
/** Head-on the shoulders carry the whole read of its build. */
const FACING_SHOULDER_SPREAD = 1.12;
const CHEST_HALF = 0.245;
/**
 * Narrower than the chest, and it has to be. A lizard's trunk is a flat box
 * that tapers from the shoulder girdle back to the pelvis; held at the chest's
 * own width the trunk is a barrel, and a barrel on two folded legs is a toad
 * whatever is drawn on the head.
 */
const WAIST_HALF = 0.172;
const HIP_HALF = 0.165;
/**
 * Where the thigh roots, measured in from the centreline. It cannot be narrower
 * than the thigh's own half-width or the two thighs merge into one wedge.
 */
const LEG_ROOT_HALF = 0.125;
const ARM_INSET = 0.92;
export const ARM_ROOT_HALF = SHOULDER_HALF * ARM_INSET;
export const FACING_ARM_ROOT_HALF = ARM_ROOT_HALF * FACING_SHOULDER_SPREAD;
/** The arm's root hangs this far below the shoulder line, not on it. */
export const SHOULDER_JOINT_DROP = 0.05;

const THIGH_WIDTH = 0.102;
const KNEE_WIDTH = 0.062;
const CALF_WIDTH = 0.084;
const ANKLE_WIDTH = 0.046;
/** How far down the shin the calf reaches its widest. */
const CALF_AT = 0.34;
const UPPER_ARM_WIDTH = 0.068;
const ELBOW_WIDTH = 0.05;
const WRIST_WIDTH = 0.032;

/**
 * A lizard's skull is *long*, not wide: seen head-on it is barely broader than
 * it is tall, and edge-on it runs half again its own height out in front of the
 * eyes. Those two numbers together are the difference between a saurian and an
 * amphibian — a head that is much wider than it is deep is a frog's, and no
 * amount of scale texture, brow ridge or jaw shape argues a viewer out of it.
 */
const HEAD_WIDTH_RATIO = 1.12;
/**
 * Deliberately *short*. A long muzzle is what makes a 2D head read as a beak —
 * a smooth taper with a rounded end is a bill whether it was drawn thinking of
 * a crocodile or a dragon, and both of those are wrong animals besides. The
 * lizards a player actually pictures — skinks, geckos, iguanas — carry a blunt
 * muzzle barely longer than the braincase behind it, and the reptile read comes
 * from the lip scales, the ear disc and the brow rather than from length.
 */
const HEAD_DEPTH_RATIO = 1.34;
const HEAD_RY = HEAD_HEIGHT / 2;
const HEAD_RX = HEAD_RY * HEAD_WIDTH_RATIO;
/** Half the skull's depth, front to back — the snout is long. */
const HEAD_DEPTH = HEAD_RY * HEAD_DEPTH_RATIO;
/**
 * Narrow enough to be read as a neck rather than as the head's own base. The
 * column tapers up it, so this is its width where it leaves the shoulders.
 */
const NECK_WIDTH = 0.175;

/** Side-on, the limbs gather toward the centreline instead of splaying wide. */
const PROFILE_LATERAL = 0.28;

// ── Views ────────────────────────────────────────────────────────────────────

export type TrogView = 'front' | 'back' | 'side';

interface ViewSpec {
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
  /**
   * Multiplier on the torso's drawn width. A body is nearly as deep as it is
   * wide, so in profile the trunk stays broad even though the limbs gather onto
   * the centreline.
   */
  readonly girth: number;
  /** Extra trim on the hips, which are much less deep than the chest. */
  readonly hipDepth: number;
  /** How far apart the two shoulder joints are drawn. */
  readonly armSpread: number;
  /**
   * Which screen direction "forward" is. +1 in the profile the figure is drawn
   * facing; 0 head-on, where a forward stoop has no sideways component at all
   * and has to be sold by the head dropping and coming at the camera instead.
   */
  readonly forward: number;
  /**
   * How much the skull grows as the stoop thrusts it at the viewer. Positive
   * head-on, negative from behind, where the same thrust carries it away.
   */
  readonly stoopHeadGrow: number;
  /**
   * How much a full stoop foreshortens the trunk toward the camera.
   *
   * Zero in profile, where the stoop is visible as a lean and needs no help.
   * Head-on it is the *only* thing that makes the posture read at all: without
   * it the front and back views stand bolt upright while the profile hunches,
   * and the three stop being the same creature.
   */
  readonly stoopCompress: number;
  /** True when the figure is seen edge-on rather than head-on. */
  readonly profile: boolean;
  /** True when the face is toward the camera. */
  readonly showsFace: boolean;
  /** True when the back of the skull and the spine crest are shown. */
  readonly showsBack: boolean;
}

const PROFILE_GIRTH = 0.9;
const PROFILE_HIP_DEPTH = 0.86;
const PROFILE_ARM_SPREAD = 0.12;
const FACING_STOOP_HEAD_GROW = 0.07;
const AWAY_STOOP_HEAD_GROW = -0.03;
/**
 * Much less than a square-on view needs. A three-quarter body shows its stoop
 * as a *lean* the way the profile does, so most of the depth cue is back in the
 * picture plane where it can be drawn rather than faked by squashing.
 */
const FACING_STOOP_COMPRESS = 0.08;

/**
 * How far the two "head-on" views are actually turned, as a share of a full
 * profile. They are three-quarter poses, not square ones.
 *
 * A square body is what made the turned head unconvincing: the skull sat at
 * fifty degrees on shoulders that were dead flat to the camera, which reads as
 * an owl on a mannequin rather than as an animal looking at you. Turning the
 * whole figure puts the head, the shoulder line, the arms' depth and the feet
 * on the same axis, and it is what a 2D character sheet does for every facing
 * that is not a clean profile.
 *
 * Front and back take opposite signs because the same physical rotation, seen
 * from the other side, throws its forward vector the other way across screen.
 */
export const FACING_TURN = 0.55;
const FACING_LATERAL = 0.82;
const FACING_GIRTH = 0.96;
const FACING_HIP_DEPTH = 0.95;
const FACING_ARM_SPREAD = 0.72;

const VIEWS: Record<TrogView, ViewSpec> = {
  front: {
    lateral: FACING_LATERAL,
    girth: FACING_GIRTH,
    hipDepth: FACING_HIP_DEPTH,
    armSpread: FACING_ARM_SPREAD,
    forward: FACING_TURN,
    stoopHeadGrow: FACING_STOOP_HEAD_GROW,
    stoopCompress: FACING_STOOP_COMPRESS,
    profile: false,
    showsFace: true,
    showsBack: false,
  },
  back: {
    lateral: FACING_LATERAL,
    girth: FACING_GIRTH,
    hipDepth: FACING_HIP_DEPTH,
    armSpread: FACING_ARM_SPREAD,
    forward: -FACING_TURN,
    stoopHeadGrow: AWAY_STOOP_HEAD_GROW,
    stoopCompress: FACING_STOOP_COMPRESS,
    profile: false,
    showsFace: false,
    showsBack: true,
  },
  side: {
    lateral: PROFILE_LATERAL,
    girth: PROFILE_GIRTH,
    hipDepth: PROFILE_HIP_DEPTH,
    armSpread: PROFILE_ARM_SPREAD,
    forward: 1,
    stoopHeadGrow: 0,
    stoopCompress: 0,
    profile: true,
    showsFace: true,
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
   * toward or away from the camera. A 2D arm has no other way to foreshorten,
   * and without it a hand swung at the viewer stays pinned at the same height
   * instead of riding up as the forearm turns out of the picture plane.
   */
  readonly foreScale: number;
}

/**
 * One frame of a troglodyte. Hand and foot positions are targets in figure
 * space that the limb solver reaches for, so the choreography never has to
 * think about joint angles. `left`/`right` are the figure's own left and right;
 * in the profile view the right side is the near one.
 */
export interface TrogPose {
  /** Whole-body vertical offset; negative lifts it off the ground. */
  bob: number;
  /** Hip shift along X — weight transfer, not a step. */
  sway: number;
  /** Torso lean in radians; positive tips the shoulders toward +X. */
  lean: number;
  /** 0 stands as tall as it ever does, 1 sinks into a full squat. */
  crouch: number;
  /**
   * How far the shoulders are carried out over the feet, 0 to 1. This is the
   * creature's whole posture: at 0 it stands like a person, and it never does.
   */
  stoop: number;
  /** Shoulder rotation about the spine, −1 to 1, seen as a width shift. */
  twist: number;
  /** Head turn, −1 to 1; in the head-on views it slides the face across. */
  headTurn: number;
  /**
   * How far the skull is rotated about its own vertical axis, −1 to 1, where 0
   * points the snout straight at the camera and ±1 turns it fully side-on.
   *
   * Only the head-on views use it, and they need it badly. A long saurian snout
   * pointed at the viewer projects to a stub — there is no drawing of it that
   * shows its length — so the head-on views were the two that kept reading as
   * an amphibian however the skull was shaped. Turned even a third of the way
   * the same snout projects most of its length across the screen, and the front
   * view gets to borrow the profile's whole silhouette.
   */
  headYaw: number;
  /** Head roll in radians. */
  headTilt: number;
  /** Snout pitch in radians; positive lifts the snout. Profile only. */
  headPitch: number;
  /** 0 jaw shut, 1 jaw hinged to its full gape. */
  gape: number;
  /** 0 eyes open, 1 nictitating membrane fully across. */
  eyeShut: number;
  /** 0 slack throat, 1 gular sac fully inflated. */
  throat: number;
  /** 0 crest laid flat along the spine, 1 spines fully erect. */
  crest: number;
  /**
   * Lateral swing of the tail, −1 to 1. Edge-on there is no sideways to swing
   * in, so the same value bows the tail vertically instead — a tail that went
   * rigid in the one view that shows its whole length would read as a prop.
   */
  tailSway: number;
  /** 0 tail dragging, 1 carried out straight behind for balance. */
  tailLift: number;
  /** 0 tongue stowed, 1 tongue root filling the gape. */
  tongue: number;
  leftHand: Pt;
  rightHand: Pt;
  leftFoot: Pt;
  rightFoot: Pt;
  /** 0 fingers splayed with the web open, 1 hooked into a grasp, per hand. */
  leftGrasp: number;
  rightGrasp: number;
  /** Foot pitch in radians; positive points the toes down. */
  leftFootPitch: number;
  rightFootPitch: number;
  /**
   * Which way a knee breaks: +1 bows it away from the body's centreline, which
   * is what this creature's squat stance does; −1 folds it the other way, which
   * is what a leg driven up in front of the body does.
   */
  leftKneeBreak: number;
  rightKneeBreak: number;
  /**
   * How much a leg is pointed at the camera rather than across it, 0 to 1. At 1
   * the knee is pulled onto the hip→ankle line.
   *
   * A human's knee hinges *away* from a head-on viewer, so it hides behind the
   * shin and the leg reads as a straight column: that is what a foreshorten of
   * 1 is for. This creature's do not — it squats with its knees thrown out to
   * the sides, which is a real angle in the image plane and the clearest single
   * thing separating its stance from a person's, so its head-on poses run at 0.
   *
   * What still holds is that both legs must use the *same* value: a bow that
   * shows on the planted leg and vanishes on the swinging one flickers once per
   * step and reads as a wiggle rather than as a walk.
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
   * Whether an arm is on the far side of the torso and so drawn before it.
   * Only consulted head-on; in profile the far arm is always the left one.
   */
  leftArmBehind: boolean;
  rightArmBehind: boolean;
}

/**
 * A relaxed arm reaches nearly its full length, and it does so from the
 * shoulder *joint* — measuring the drop from the shoulder line instead leaves
 * the IK slack, which it spends folding the elbow out sideways.
 */
const RESTING_HAND_DROP = SHOULDER_JOINT_DROP + ARM_LENGTH * 0.98;
const RESTING_HAND_SPREAD = 0.33;
const RESTING_FOOT_SPREAD = 0.185;
/** The stoop it is never without. Nothing in the bestiary stands up straight. */
export const RESTING_STOOP = 0.75;
const RESTING_CROUCH = 0.34;

/** A resting crouch. Every animation is written as edits to this. */
export function restingPose(): TrogPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    crouch: RESTING_CROUCH,
    stoop: RESTING_STOOP,
    twist: 0,
    headTurn: 0,
    headYaw: 0.42,
    headTilt: 0,
    headPitch: 0,
    gape: 0,
    eyeShut: 0,
    throat: 0,
    crest: 0.3,
    tailSway: 0,
    tailLift: 0.35,
    tongue: 0,
    leftHand: pt(-RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    rightHand: pt(RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    leftFoot: pt(-RESTING_FOOT_SPREAD, 0),
    rightFoot: pt(RESTING_FOOT_SPREAD, 0),
    leftGrasp: 0.25,
    rightGrasp: 0.25,
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
 * Tiny, because the joint's sideways travel grows as the *square root* of it:
 * a few percent here bows the arms into a pair of parentheses.
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
 * swinging sideways. See {@link TrogPose.leftForeshorten}.
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
  /**
   * Where the neck actually meets the skull: the occiput, at the *back* of the
   * head, not its centre.
   *
   * This matters far more on a long-jawed skull than on a round one. Run the
   * neck to the head's centre and the entire back half of a saurian skull hangs
   * off nothing, which bakes as a paddle balanced on a pole — the head reads as
   * detached from the body however well either one is drawn.
   */
  neckTop: Pt;
  /** Multiplier on the drawn skull, carrying the stoop's depth cue. */
  headScale: number;
  /** How far the skull is rolled, which the occiput attachment swings with. */
  headAngle: number;
  leftShoulder: Pt;
  rightShoulder: Pt;
  leftLeg: BoneChain;
  rightLeg: BoneChain;
  leftArm: BoneChain;
  rightArm: BoneChain;
  shoulderHalf: number;
}

/** How much of the hip height a full squat removes. */
const CROUCH_DROP = 0.22;
/** How far a full stoop carries the shoulders out over the feet, in profile. */
const STOOP_SHOULDER_FORWARD = 0.24;
/** And how far the same stoop sinks them, in every view. */
const STOOP_SHOULDER_DROP = 0.075;
/** The head is thrust further than the shoulders — the neck straightens out. */
const STOOP_HEAD_FORWARD = 0.3;
const STOOP_HEAD_DROP = 0.055;
/** How much wider a shoulder line reads for being that much nearer the camera. */
const STOOP_NEARER_GAIN = 0.5;

/** Facing +X, a knee that bends toward +X is bending forward. */
const PROFILE_KNEE_FORWARD = -1;
/** A twisted torso narrows on the trailing side and widens on the leading one. */
const TWIST_WIDTH_GAIN = 0.16;
const TWIST_SHOULDER_SHIFT = 0.055;

/** Offset from the hip to a point `height` up the leaning spine. */
function spinePoint(hip: Pt, height: number, lean: number): Pt {
  const rotated = rotate({ x: 0, y: -height }, lean);
  return offset(hip, rotated.x, rotated.y);
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

/** The ankle for a foot planted at `target`: up the leg by the foot's height. */
function ankleFor(target: Pt, pitch: number): Pt {
  const lifted = rotate({ x: 0, y: ANKLE_Y }, -pitch);
  return offset(target, lifted.x, lifted.y);
}

function buildSkeleton(pose: TrogPose, view: ViewSpec): Skeleton {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);

  const stoopX = pose.stoop * view.forward;
  // Head-on, a trunk leaning at the camera is *shorter* and its shoulders are
  // *nearer*, so it draws squat and wide. This is the whole posture in the two
  // views that have no sideways lean to show it with.
  const compress = 1 - pose.stoop * view.stoopCompress;
  const spread = view.profile ? 1 : FACING_SHOULDER_SPREAD;
  const nearer = 1 + pose.stoop * view.stoopCompress * STOOP_NEARER_GAIN;
  const waist = spinePoint(hip, Math.abs(WAIST_Y - HIP_Y) * compress, pose.lean);
  const chest = offset(
    spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y) * CHEST_UP_SPINE * compress, pose.lean),
    stoopX * STOOP_SHOULDER_FORWARD * CHEST_UP_SPINE,
    pose.stoop * STOOP_SHOULDER_DROP * CHEST_UP_SPINE,
  );
  const shoulderCentre = offset(
    spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y) * compress, pose.lean),
    stoopX * STOOP_SHOULDER_FORWARD,
    pose.stoop * STOOP_SHOULDER_DROP,
  );
  const neck = mixPt(shoulderCentre, hip, -NECK_ABOVE_SHOULDER);
  const headCentre = offset(
    spinePoint(hip, Math.abs(HEAD_CENTRE_Y - HIP_Y) * compress, pose.lean),
    stoopX * STOOP_HEAD_FORWARD + pose.headTurn * HEAD_RX * view.lateral * HEAD_TURN_SLIDE,
    pose.stoop * STOOP_HEAD_DROP,
  );

  const headScale = 1 + pose.stoop * view.stoopHeadGrow;
  const headAngle = pose.headTilt + pose.lean * HEAD_LEAN_FOLLOW - pose.headPitch * view.forward;
  const occiput = rotate(
    pt(-HEAD_DEPTH * OCCIPUT_ATTACH_BACK * view.forward, HEAD_RY * OCCIPUT_ATTACH_DOWN),
    headAngle,
  );
  const neckTop = offset(headCentre, occiput.x * headScale, occiput.y * headScale);

  const shoulderHalf = SHOULDER_HALF * view.girth * spread * nearer;
  const twistShift = pose.twist * TWIST_SHOULDER_SHIFT * view.lateral;
  const armRoot = ARM_ROOT_HALF * view.armSpread * spread;
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
    neck,
    headCentre,
    neckTop,
    headScale,
    headAngle,
    leftShoulder,
    rightShoulder,
    shoulderHalf,
    // A squatting knee breaks *away* from the centreline. Signed the other way
    // the two knees bow toward each other and the legs read as crossed.
    //
    // Edge-on that rule does not apply: "away from the centreline" would send
    // the two knees in opposite directions, and one of them would then hinge
    // backward, which no leg does. In profile both knees break forward.
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

/** Where up the spine the ribcage's widest point sits, as a share of shoulder height. */
const CHEST_UP_SPINE = 0.66;
/** The skull sits this far past the shoulder line, as a share of the spine below it. */
const NECK_ABOVE_SHOULDER = 0.12;
const HEAD_TURN_SLIDE = 0.45;
/** Where on the skull the neck attaches, back from and below its centre. */
const OCCIPUT_ATTACH_BACK = 0.72;
const OCCIPUT_ATTACH_DOWN = 0.34;

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
const OUTLINE_BLEED = 0.021;

function outlineCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  fillCapsule(ctx, a, b, wa + OUTLINE_BLEED, wb + OUTLINE_BLEED, OUTLINE);
}

const SHEEN_OFFSET = 0.45;
const SHEEN_WIDTH = 0.32;
const SHEEN_TAPER = 0.7;

/**
 * Runs a stroke down one long edge of a segment.
 *
 * `toLight` of +1 puts it on the lit edge and −1 on the shaded one, which is
 * how the same routine paints both the highlight and the pale underside. It is
 * an explicit argument rather than a sign on the width, because the width is
 * also the stroke's radius and a negative one is not a shape.
 */
function sheenSegment(
  ctx: Ctx,
  a: Pt,
  b: Pt,
  width: number,
  colour: string,
  alpha: number,
  toLight: number,
): void {
  const angle = angleBetween(a, b);
  const normal = angle + HALF_PI;
  const facing = Math.cos(normal) * LIGHT.x + Math.sin(normal) * LIGHT.y;
  const side = (facing >= 0 ? 1 : -1) * toLight;
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

/** The forearm's own swell, just below the elbow node. */
const FOREARM_SWELL = 1.14;

const ARM_SHAPE: LimbShape = {
  root: UPPER_ARM_WIDTH,
  joint: ELBOW_WIDTH,
  belly: ELBOW_WIDTH * FOREARM_SWELL,
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

/**
 * Paints a solved limb: outline, flesh, a paler underside, then a sheen down
 * the lit edge.
 *
 * The lower segment is drawn in two pieces so the joint can pinch in and the
 * belly swell back out below it. Drawn as one taper, a limb is a traffic cone.
 */
function drawLimb(ctx: Ctx, chain: BoneChain, shape: LimbShape, shade: number): void {
  const belly = mixPt(chain.joint, chain.end, shape.bellyAt);
  const flesh = mix(HIDE.mid, OUTLINE, shade);
  const fleshLight = mix(HIDE.light, OUTLINE, shade);
  const underside = mix(BELLY.mid, OUTLINE, shade);

  outlineCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint);
  outlineCapsule(ctx, chain.joint, belly, shape.joint, shape.belly);
  outlineCapsule(ctx, belly, chain.end, shape.belly, shape.tip);

  fillCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint, flesh);
  fillCapsule(ctx, chain.joint, belly, shape.joint, shape.belly, flesh);
  fillCapsule(ctx, belly, chain.end, shape.belly, shape.tip, flesh);

  // The pale underside runs down the shaded edge — the opposite side from the
  // sheen — which is what makes a limb read as round rather than as a flat
  // stripe of one colour.
  sheenSegment(
    ctx,
    chain.root,
    chain.joint,
    shape.root,
    underside,
    UNDERSIDE_ALPHA,
    AWAY_FROM_LIGHT,
  );
  sheenSegment(
    ctx,
    chain.joint,
    chain.end,
    shape.belly,
    underside,
    UNDERSIDE_ALPHA,
    AWAY_FROM_LIGHT,
  );
  sheenSegment(ctx, chain.root, chain.joint, shape.root, fleshLight, SHEEN_ALPHA, TOWARD_LIGHT);
  sheenSegment(ctx, chain.joint, chain.end, shape.belly, fleshLight, SHEEN_ALPHA, TOWARD_LIGHT);

  scaleChevrons(ctx, chain.joint, chain.end, shape.belly, shade);
  // The joint crease. A limb of two capsules with no mark where they meet is a
  // tube with a kink in it, and a tube with a highlight down it reads as
  // moulded plastic — which, with bare hide, is exactly what it baked as.
  const creaseAcross = angleBetween(chain.root, chain.joint) + HALF_PI;
  ctx.save();
  ctx.globalAlpha = JOINT_CREASE_ALPHA;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = shape.joint * JOINT_CREASE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(
    chain.joint.x + Math.cos(creaseAcross) * shape.joint * JOINT_CREASE_SPAN,
    chain.joint.y + Math.sin(creaseAcross) * shape.joint * JOINT_CREASE_SPAN,
  );
  ctx.lineTo(
    chain.joint.x - Math.cos(creaseAcross) * shape.joint * JOINT_CREASE_SPAN,
    chain.joint.y - Math.sin(creaseAcross) * shape.joint * JOINT_CREASE_SPAN,
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * A few scale rows across a limb's lower segment.
 *
 * Bare unbroken hide is a *frog* cue, and it is the one that survived this
 * creature's redraw longest: every limb was a smooth capsule with a highlight
 * down the middle of it. Chevrons rather than straight bands, because a band
 * across a cylinder is a joint and four of them are a concertina hose.
 */
function scaleChevrons(ctx: Ctx, from: Pt, to: Pt, half: number, shade: number): void {
  const along = angleBetween(from, to);
  const across = along + HALF_PI;
  ctx.save();
  ctx.globalAlpha = SCALE_ROW_ALPHA;
  ctx.strokeStyle = mix(HIDE.shadow, OUTLINE, shade);
  ctx.lineWidth = half * SCALE_ROW_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let i = 0; i < SCALE_ROW_COUNT; i++) {
    const at = mixPt(from, to, lerp(SCALE_ROW_FROM, SCALE_ROW_TO, i / (SCALE_ROW_COUNT - 1)));
    const reach = half * SCALE_ROW_SPAN;
    const peak = offset(
      at,
      Math.cos(along) * half * SCALE_ROW_POINT,
      Math.sin(along) * half * SCALE_ROW_POINT,
    );
    ctx.beginPath();
    ctx.moveTo(at.x + Math.cos(across) * reach, at.y + Math.sin(across) * reach);
    ctx.lineTo(peak.x, peak.y);
    ctx.lineTo(at.x - Math.cos(across) * reach, at.y - Math.sin(across) * reach);
    ctx.stroke();
  }
  ctx.restore();
}

const SCALE_ROW_COUNT = 4;
const SCALE_ROW_ALPHA = 0.3;
const SCALE_ROW_WIDTH = 0.16;
const SCALE_ROW_FROM = 0.2;
const SCALE_ROW_TO = 0.82;
const SCALE_ROW_SPAN = 0.66;
/** How far the chevron's point runs ahead of its own ends, toward the tip. */
const SCALE_ROW_POINT = 0.5;
const JOINT_CREASE_ALPHA = 0.34;
const JOINT_CREASE_WIDTH = 0.28;
const JOINT_CREASE_SPAN = 0.72;

const UNDERSIDE_ALPHA = 0.3;
const TOWARD_LIGHT = 1;
const AWAY_FROM_LIGHT = -1;

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

/**
 * Blotches of darker hide, scattered inside whatever path is currently clipped.
 *
 * Seeded off a fixed number rather than off the pose: markings that reshuffle
 * every frame are a boiling texture, which is worse than no markings at all.
 */
function speckle(
  ctx: Ctx,
  seed: number,
  count: number,
  spread: Pt,
  centre: Pt,
  radius: number,
): void {
  ctx.save();
  ctx.globalAlpha = MOTTLE_ALPHA;
  ctx.fillStyle = MOTTLE;
  for (let i = 0; i < count; i++) {
    const x = centre.x + (hash1(seed + i * 3.7) - 0.5) * 2 * spread.x;
    const y = centre.y + (hash1(seed + i * 7.1 + 31) - 0.5) * 2 * spread.y;
    const rx = radius * (0.55 + hash1(seed + i * 11.3) * 0.9);
    const ry = rx * (0.5 + hash1(seed + i * 5.9) * 0.6);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, hash1(seed + i * 2.3) * Math.PI, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** The small hard highlight that says the hide is wet rather than dusty. */
function wetSpot(ctx: Ctx, centre: Pt, rx: number, ry: number, angle: number): void {
  ctx.save();
  ctx.globalAlpha = WET_ALPHA;
  ctx.fillStyle = HIDE.rim;
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, rx, ry, angle, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Hands ────────────────────────────────────────────────────────────────────

/**
 * Long. The hand is the second silhouette cue after the skull — a splayed
 * webbed rake, half again the length of a human hand against its own forearm —
 * and it is what makes a hanging arm read as a grasping limb rather than a
 * stick that stops.
 */
const HAND_LENGTH = FOREARM_LENGTH * 0.46;
const HAND_HALF_SPREAD = HAND_LENGTH * 0.5;
const FINGER_COUNT = 3;
const FINGER_HALF_WIDTH = 0.019;
const CLAW_LENGTH = HAND_LENGTH * 0.26;
const CLAW_HALF_WIDTH = 0.013;
/** How far the fingers fold toward the palm at a full grasp. */
const GRASP_CURL = deg(62);
/** The web runs this far up the fingers from the palm. */
const WEB_SHARE = 0.62;
const PALM_HALF_WIDTH = 0.05;

/**
 * A hand hanging off the wrist at `at`, along the forearm's direction.
 *
 * Fingers are drawn as separate capsules with the web filled between them as a
 * single polygon, because the web has to be part of the *silhouette*: painted
 * on top as a translucent panel it disappears entirely at tile size, and the
 * hand then reads as three loose sticks.
 */
function drawHand(ctx: Ctx, at: Pt, wristAngle: number, grasp: number, shade: number): void {
  const flesh = mix(HIDE.mid, OUTLINE, shade);
  const fleshLight = mix(HIDE.light, OUTLINE, shade);
  const web = mix(BELLY.dark, OUTLINE, shade);
  const claw = mix(HORN.mid, OUTLINE, shade);
  const curl = clamp01(grasp) * GRASP_CURL;

  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(wristAngle);

  const palmTip = pt(HAND_LENGTH * PALM_SHARE, 0);
  const fingers: { base: Pt; tip: Pt; clawTip: Pt }[] = [];
  for (let i = 0; i < FINGER_COUNT; i++) {
    const across = lerp(-1, 1, i / (FINGER_COUNT - 1));
    const fan = across * FINGER_FAN;
    const length = HAND_LENGTH * (1 - Math.abs(across) * FINGER_SHORTEN);
    // A curled finger swings toward the palm's own plane, so the fan closes as
    // the grip closes: a splayed claw that keeps its spread while it clenches
    // reads as a starfish stuck to the arm.
    const angle = fan * (1 - clamp01(grasp) * FAN_CLOSE) + curl;
    const dir = rotate({ x: length, y: 0 }, angle);
    const base = pt(palmTip.x, HAND_HALF_SPREAD * across * (1 - clamp01(grasp) * FAN_CLOSE));
    const tip = offset(base, dir.x, dir.y);
    const clawDir = rotate({ x: CLAW_LENGTH, y: 0 }, angle + CLAW_HOOK);
    fingers.push({ base, tip, clawTip: offset(tip, clawDir.x, clawDir.y) });
  }

  // Web first, as a filled fan between the outermost finger tips, so the
  // fingers and their outlines land on top of it.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const finger of fingers) {
    const webEnd = mixPt(finger.base, finger.tip, WEB_SHARE);
    ctx.lineTo(webEnd.x, webEnd.y);
  }
  ctx.closePath();
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.save();
  ctx.scale(WEB_INSET, WEB_INSET);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const finger of fingers) {
    const webEnd = mixPt(finger.base, finger.tip, WEB_SHARE);
    ctx.lineTo(webEnd.x / WEB_INSET, webEnd.y / WEB_INSET);
  }
  ctx.closePath();
  ctx.fillStyle = web;
  ctx.fill();
  ctx.restore();

  outlineCapsule(ctx, pt(0, 0), palmTip, PALM_HALF_WIDTH * WRIST_PINCH, PALM_HALF_WIDTH);
  for (const finger of fingers) {
    outlineCapsule(ctx, finger.base, finger.tip, FINGER_HALF_WIDTH, FINGER_HALF_WIDTH * 0.8);
    outlineCapsule(ctx, finger.tip, finger.clawTip, CLAW_HALF_WIDTH, CLAW_HALF_WIDTH * 0.2);
  }
  fillCapsule(ctx, pt(0, 0), palmTip, PALM_HALF_WIDTH * WRIST_PINCH, PALM_HALF_WIDTH, flesh);
  for (const finger of fingers) {
    fillCapsule(ctx, finger.base, finger.tip, FINGER_HALF_WIDTH, FINGER_HALF_WIDTH * 0.8, flesh);
  }
  for (const finger of fingers) {
    fillCapsule(ctx, finger.tip, finger.clawTip, CLAW_HALF_WIDTH, CLAW_HALF_WIDTH * 0.2, claw);
  }

  ctx.save();
  ctx.globalAlpha = HAND_SHEEN_ALPHA;
  fillCapsule(
    ctx,
    pt(HAND_LENGTH * 0.1, -PALM_HALF_WIDTH * 0.35),
    pt(HAND_LENGTH * PALM_SHARE * 0.9, -PALM_HALF_WIDTH * 0.35),
    PALM_HALF_WIDTH * 0.26,
    PALM_HALF_WIDTH * 0.2,
    fleshLight,
  );
  ctx.restore();
  ctx.restore();
}

/** How much of the hand's length is palm before the fingers start. */
const PALM_SHARE = 0.34;
const FINGER_FAN = deg(26);
/** The outer fingers are shorter, which is what stops the hand reading square. */
const FINGER_SHORTEN = 0.16;
const FAN_CLOSE = 0.7;
/** Claws hook further round than the finger they sit on. */
const CLAW_HOOK = deg(26);
const WEB_INSET = 0.9;
const WRIST_PINCH = 0.72;
const HAND_SHEEN_ALPHA = 0.2;

// ── Feet ─────────────────────────────────────────────────────────────────────

/**
 * A long, flat, splayed foot. Derived from the figure's height rather than from
 * its head — a game figure's head is deliberately oversized, so any ratio hung
 * off it comes out a clown shoe.
 */
const FOOT_LEN = FIGURE_HEIGHT * 0.19;
const FOOT_DEPTH = FOOT_LEN * 0.42;
/** How much of the foot lies behind the ankle. A digitigrade heel is short. */
const HEEL_SHARE = 0.16;
/** Head-on the foot is mostly toes, so it draws short and blunt. */
const FOOT_FORESHORTEN = 0.52;
const TOE_COUNT = 3;
const TOE_HALF_WIDTH = 0.021;
const TOE_CLAW_LENGTH = 0.036;
const TOE_FAN = deg(30);

/**
 * A webbed foot drawn from the ankle: a wedge of sole with three long toes
 * notched out of the silhouette and webbed between.
 *
 * Head-on, a foot turns out in the *ground* plane, which a 2D rotation cannot
 * express — rotating it rolls the creature onto the outer edges of both soles.
 * The toe end leads outward through `outward` instead, and the sole stays level.
 */
function drawFoot(ctx: Ctx, ankle: Pt, pitch: number, view: ViewSpec, outward: number): void {
  const profile = view.profile;
  const length = profile ? FOOT_LEN : FOOT_LEN * FOOT_FORESHORTEN;
  const lead = profile ? 1 : outward;

  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(profile ? pitch : 0);

  if (view.showsBack) {
    // From behind a foot is a heel and the outside edge of the sole; toes drawn
    // here would read as feet on backwards.
    const heel = pt(0, FOOT_DEPTH * BACK_HEEL_DROP);
    const soleHalf = length * BACK_SOLE_SHARE;
    outlineCapsule(
      ctx,
      offset(heel, -soleHalf, 0),
      offset(heel, soleHalf, 0),
      FOOT_DEPTH * 0.5,
      FOOT_DEPTH * 0.5,
    );
    outlineCapsule(ctx, pt(0, 0), heel, ANKLE_WIDTH, FOOT_DEPTH * 0.42);
    fillCapsule(ctx, pt(0, 0), heel, ANKLE_WIDTH, FOOT_DEPTH * 0.42, HIDE.mid);
    fillCapsule(
      ctx,
      offset(heel, -soleHalf, 0),
      offset(heel, soleHalf, 0),
      FOOT_DEPTH * 0.5,
      FOOT_DEPTH * 0.5,
      HIDE.mid,
    );
    wetSpot(ctx, offset(heel, 0, -FOOT_DEPTH * 0.2), soleHalf * 0.7, FOOT_DEPTH * 0.15, 0);
    ctx.restore();
    return;
  }

  const heel = pt(-length * HEEL_SHARE * lead, FOOT_DEPTH * 0.3);
  const ball = pt(length * (1 - HEEL_SHARE) * lead * BALL_SHARE, FOOT_DEPTH * 0.42);
  const toes: { base: Pt; tip: Pt; clawTip: Pt }[] = [];
  for (let i = 0; i < TOE_COUNT; i++) {
    const across = lerp(-1, 1, i / (TOE_COUNT - 1));
    const angle = across * TOE_FAN;
    const reach = length * (1 - HEEL_SHARE) * (1 - Math.abs(across) * TOE_SHORTEN);
    // In profile the toes fan in the picture plane about the ball of the foot;
    // head-on that same fan is depth, so it is flattened onto the sole instead.
    const spread = profile ? angle * PROFILE_TOE_FAN_SHARE : angle;
    const dir = rotate({ x: reach * lead, y: 0 }, spread * lead);
    const tip = offset(ball, dir.x, dir.y);
    const clawDir = rotate({ x: TOE_CLAW_LENGTH * lead, y: 0 }, spread * lead + CLAW_HOOK * lead);
    toes.push({ base: ball, tip, clawTip: offset(tip, clawDir.x, clawDir.y) });
  }

  // The web is part of the outline, not a wash on top of it.
  ctx.beginPath();
  ctx.moveTo(heel.x, heel.y);
  for (const toe of toes) {
    const webEnd = mixPt(toe.base, toe.tip, FOOT_WEB_SHARE);
    ctx.lineTo(webEnd.x, webEnd.y);
  }
  ctx.closePath();
  ctx.fillStyle = OUTLINE;
  ctx.fill();

  outlineCapsule(ctx, pt(0, 0), heel, ANKLE_WIDTH, FOOT_DEPTH * 0.4);
  outlineCapsule(ctx, heel, ball, FOOT_DEPTH * 0.4, FOOT_DEPTH * 0.46);
  for (const toe of toes) {
    outlineCapsule(ctx, toe.base, toe.tip, TOE_HALF_WIDTH, TOE_HALF_WIDTH * 0.75);
    outlineCapsule(ctx, toe.tip, toe.clawTip, CLAW_HALF_WIDTH, CLAW_HALF_WIDTH * 0.2);
  }
  fillCapsule(ctx, pt(0, 0), heel, ANKLE_WIDTH, FOOT_DEPTH * 0.4, HIDE.mid);
  fillCapsule(ctx, heel, ball, FOOT_DEPTH * 0.4, FOOT_DEPTH * 0.46, HIDE.mid);
  ctx.save();
  ctx.globalAlpha = FOOT_WEB_ALPHA;
  ctx.beginPath();
  ctx.moveTo(heel.x, heel.y);
  for (const toe of toes) {
    const webEnd = mixPt(toe.base, toe.tip, FOOT_WEB_SHARE);
    ctx.lineTo(webEnd.x, webEnd.y);
  }
  ctx.closePath();
  ctx.fillStyle = BELLY.dark;
  ctx.fill();
  ctx.restore();
  for (const toe of toes) {
    fillCapsule(ctx, toe.base, toe.tip, TOE_HALF_WIDTH, TOE_HALF_WIDTH * 0.75, HIDE.mid);
  }
  for (const toe of toes) {
    fillCapsule(ctx, toe.tip, toe.clawTip, CLAW_HALF_WIDTH, CLAW_HALF_WIDTH * 0.2, HORN.mid);
  }

  wetSpot(ctx, mixPt(heel, ball, 0.5), length * 0.16, FOOT_DEPTH * 0.13, 0);
  ctx.restore();
}

const BALL_SHARE = 0.5;
/** From behind the sole spreads sideways instead of running away from the ankle. */
const BACK_HEEL_DROP = 0.5;
const BACK_SOLE_SHARE = 0.34;
const TOE_SHORTEN = 0.14;
/** Edge-on, most of the toes' fan is depth and only a little of it shows. */
const PROFILE_TOE_FAN_SHARE = 0.3;
const FOOT_WEB_SHARE = 0.7;
const FOOT_WEB_ALPHA = 0.85;

// ── Crest ────────────────────────────────────────────────────────────────────

/** Tallest spine, at the shoulders, fully erect. */
const CREST_MAX_HEIGHT = 0.2;
const CREST_HALF_WIDTH = 0.03;
/** How much of its height a laid-flat crest keeps. */
const CREST_FLAT_SHARE = 0.45;
/**
 * A spine's tip is a fraction of its root, not a point: taken to nothing the
 * ink border around it is wider than the spine itself and every one of them
 * bakes as a dark rounded bead.
 */
const CREST_TIP_SHARE = 0.22;

/**
 * The row of horn spines from the nape to the small of the back. **Edge-on
 * only.**
 *
 * Seen from directly behind, a dorsal crest projects to essentially nothing —
 * a line down the spine. Every attempt to draw it there anyway failed the same
 * way: studs baked as a zipper, a continuous ridge as a necktie, broad scutes
 * as a stack of rings. All three destroyed the one thing the back view has to
 * offer, which is a clean silhouette. The spinal furrow `drawTorso` already
 * paints is the honest amount of crest to show from that angle.
 */
function drawCrest(ctx: Ctx, skeleton: Skeleton, pose: TrogPose, view: ViewSpec): void {
  const raise = lerp(CREST_FLAT_SHARE, 1, clamp01(pose.crest));
  const spineTop = mixPt(skeleton.neck, skeleton.shoulderCentre, CREST_TOP_ALONG);
  const spineBottom = skeleton.hip;

  // Straight backward, not along the spine's own normal: the stoop swings that
  // normal up and back, which roots the whole crest above the creature's neck.
  // The profile always faces +X, so the back is always −X.
  const outX = -1;
  const outY = 0;
  // The spines sweep up and back the way a raised hackle does; square to the
  // body they read as a garden rake bolted on sideways.
  const rakeAngle = Math.PI + CREST_RAKE;

  for (const t of CREST_STOPS) {
    const onSpine = mixPt(spineTop, spineBottom, t * CREST_RUN);
    // Out to the back edge of the trunk, so the spine starts where the
    // silhouette is rather than a body's depth inside it.
    const backEdge = trunkHalfAt(skeleton, view, t * CREST_RUN);
    const rooted = offset(onSpine, outX * backEdge, outY * backEdge);
    const height = CREST_MAX_HEIGHT * raise * crestSpineHeight(t);
    const tip = offset(rooted, Math.cos(rakeAngle) * height, Math.sin(rakeAngle) * height);
    outlineCapsule(ctx, rooted, tip, CREST_HALF_WIDTH, CREST_HALF_WIDTH * CREST_TIP_SHARE);
    fillCapsule(ctx, rooted, tip, CREST_HALF_WIDTH, CREST_HALF_WIDTH * CREST_TIP_SHARE, HORN.dark);
    fillCapsule(
      ctx,
      mixPt(rooted, tip, 0.15),
      mixPt(rooted, tip, 0.85),
      CREST_HALF_WIDTH * 0.5,
      CREST_HALF_WIDTH * CREST_TIP_SHARE,
      HORN.mid,
    );
  }
}

/** Half-width of the trunk `down` of the way from the shoulders to the hips. */
function trunkHalfAt(skeleton: Skeleton, view: ViewSpec, down: number): number {
  return (
    lerp(skeleton.shoulderHalf, HIP_HALF * view.girth * view.hipDepth, clamp01(down)) *
    CREST_ROOT_INSET
  );
}

/** How far the spines lean back from square to the spine. */
const CREST_RAKE = deg(24);
/** A spine seen end-on is a stud this fraction of its own length across. */
/** How far a foreshortened spine's base sits below its own root. */
/** Roots sit just inside the silhouette so they are not floating off the back. */
const CREST_ROOT_INSET = 0.9;

/** Where the topmost spine sits between the nape and the shoulder line. */
const CREST_TOP_ALONG = 1;
/** How far down the spine toward the hips the crest runs. */
const CREST_RUN = 1;
/**
 * Spine height along the crest: short at the nape, tallest just behind the
 * shoulders, trailing off to a stub at the hips. Keyed rather than a bell
 * curve, because a symmetric profile puts the peak halfway down the back and
 * the crest then reads as a fish's fin rather than as a raised hackle.
 */
function crestSpineHeight(t: number): number {
  return keyed(t, [
    [0, 0.62],
    [0.28, 1],
    [0.7, 0.5],
    [1, 0.16],
  ]);
}

/**
 * Where each spine roots, as a fraction of the run from shoulders to hips.
 *
 * Deliberately uneven. Evenly spaced spines of a smoothly varying height read
 * as a zipper sewn down the back of a costume; the irregularity is what makes
 * them grow out of the animal.
 */
const CREST_STOPS: readonly number[] = [0, 0.24, 0.5, 0.72, 1];

// ── Torso ────────────────────────────────────────────────────────────────────

/** How far the gut hangs below the hip line at rest. */
const GUT_DROP = 0.045;
/**
 * Barely any. A swell here is a hanging belly, and a hanging belly is the whole
 * reason the creature read as a toad squatting on its haunches. A lizard's
 * trunk is a flat box that narrows steadily from the shoulder girdle to the
 * pelvis, and the flanks should run nearly straight between them.
 */
const GUT_SWELL = 1.02;
const TORSO_SPECKLES = 9;

function traceTorso(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, throat: number): void {
  const shoulderHalf = skeleton.shoulderHalf;
  const chestHalf = CHEST_HALF * view.girth * lerp(1, THROAT_CHEST_SWELL, clamp01(throat));
  const waistHalf = WAIST_HALF * view.girth * GUT_SWELL;
  const hipHalf = HIP_HALF * view.girth * view.hipDepth;
  const gut = offset(skeleton.hip, 0, GUT_DROP);

  ctx.beginPath();
  ctx.moveTo(skeleton.shoulderCentre.x - shoulderHalf, skeleton.shoulderCentre.y);
  ctx.quadraticCurveTo(
    skeleton.chest.x - chestHalf * FLANK_BOW,
    skeleton.chest.y,
    skeleton.waist.x - waistHalf,
    skeleton.waist.y,
  );
  ctx.quadraticCurveTo(gut.x - waistHalf, gut.y - GUT_DROP * 0.2, gut.x - hipHalf, gut.y);
  ctx.quadraticCurveTo(gut.x, gut.y - CROTCH_NOTCH, gut.x + hipHalf, gut.y);
  ctx.quadraticCurveTo(
    gut.x + waistHalf,
    gut.y - GUT_DROP * 0.2,
    skeleton.waist.x + waistHalf,
    skeleton.waist.y,
  );
  ctx.quadraticCurveTo(
    skeleton.chest.x + chestHalf * FLANK_BOW,
    skeleton.chest.y,
    skeleton.shoulderCentre.x + shoulderHalf,
    skeleton.shoulderCentre.y,
  );
  ctx.quadraticCurveTo(
    skeleton.shoulderCentre.x,
    skeleton.shoulderCentre.y - shoulderHalf * SHOULDER_CROWN,
    skeleton.shoulderCentre.x - shoulderHalf,
    skeleton.shoulderCentre.y,
  );
  ctx.closePath();
}

/**
 * How far the shoulder line arches above its own end points.
 *
 * Low, and it has to stay low: the arch rises exactly where the neck leaves the
 * body, and at half the shoulder's half-width it swallowed the entire neck in
 * both head-on views — the skull sat straight down on a hump of trunk and the
 * creature read as neckless from the front however long the neck actually was.
 */
const SHOULDER_CROWN = 0.24;
/**
 * How far the trunk's underside notches *up* between the legs. Bowed downward
 * instead it draws a straight edge right across the creature's belly, and a
 * straight edge that long reads as the bottom of a breastplate.
 */
const CROTCH_NOTCH = 0.062;
/**
 * How far past the chest's own half-width its control point sits. A control
 * point *on* the chord draws a straight side, and four straight sides is a
 * crate — which is exactly what the back view baked as. Kept only a little
 * past it, though: a hard bow here is a ribcage sprung out over a wasp waist,
 * and this animal's flanks want to read as nearly parallel.
 */
const FLANK_BOW = 1.08;
const THROAT_CHEST_SWELL = 1.06;
/** Half-width of the pale ventral panel, as a share of the trunk's own width. */
const BELLY_PANEL_SHARE = 0.5;
const BELLY_BAND_COUNT = 2;
const BELLY_BAND_ALPHA = 0.28;
const TORSO_SEED = 4211;

function drawTorso(ctx: Ctx, skeleton: Skeleton, pose: TrogPose, view: ViewSpec): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_BLEED * 2;
  traceTorso(ctx, skeleton, view, pose.throat);
  ctx.stroke();
  ctx.fillStyle = HIDE.mid;
  ctx.fill();

  ctx.save();
  traceTorso(ctx, skeleton, view, pose.throat);
  ctx.clip();

  const trunkTop = skeleton.shoulderCentre;
  const trunkBottom = offset(skeleton.hip, 0, GUT_DROP);
  const trunkHeight = Math.abs(trunkBottom.y - trunkTop.y);

  // Dorsal shading first: the back is darker than the flanks in every view, and
  // head-on that gradient is what keeps the trunk from reading as a flat card.
  const dorsal = ctx.createLinearGradient(trunkTop.x, trunkTop.y, trunkTop.x, trunkBottom.y);
  dorsal.addColorStop(0, rgba(HIDE.shadow, DORSAL_ALPHA));
  dorsal.addColorStop(1, rgba(HIDE.shadow, 0));
  ctx.fillStyle = dorsal;
  ctx.fillRect(trunkTop.x - 1, trunkTop.y, 2, trunkHeight);

  speckle(
    ctx,
    TORSO_SEED,
    TORSO_SPECKLES,
    { x: CHEST_HALF * view.girth, y: trunkHeight * 0.45 },
    mixPt(trunkTop, trunkBottom, 0.4),
    SPECKLE_RADIUS,
  );

  if (!view.showsBack) {
    // The ventral panel and its bands. From behind there is no belly to draw,
    // and painting one there is the single most common way a back view ends up
    // reading as a second front view.
    const panelHalf = WAIST_HALF * view.girth * BELLY_PANEL_SHARE;
    const panelTop = mixPt(trunkTop, trunkBottom, BELLY_PANEL_TOP);
    // A wash that runs from the throat down past the crotch and is cut off by
    // the trunk's own silhouette, not a disc floating in the middle of it: a
    // centred soft-edged blob is the brightest thing on the body and reads as
    // a glowing core.
    // Soft in both axes. Poured into a rectangle it has a hard horizontal edge
    // straight across the chest, and a straight edge that long on a creature
    // reads as a breastplate.
    const panelHeight = Math.abs(trunkBottom.y - panelTop.y) + GUT_DROP;
    ctx.save();
    ctx.translate(
      lerp(trunkBottom.x - panelHalf, trunkBottom.x + panelHalf, PANEL_OFF_CENTRE),
      panelTop.y + panelHeight * PANEL_CENTRE_DOWN,
    );
    ctx.scale(panelHalf, panelHeight * PANEL_CENTRE_DOWN);
    const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    wash.addColorStop(0, rgba(BELLY.mid, PANEL_ALPHA));
    wash.addColorStop(PANEL_SOLID_TO, rgba(BELLY.mid, PANEL_ALPHA));
    wash.addColorStop(1, rgba(BELLY.mid, 0));
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TWO_PI);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = BELLY_BAND_ALPHA;
    ctx.strokeStyle = BELLY.dark;
    ctx.lineWidth = BELLY_BAND_WIDTH;
    for (let i = 1; i <= BELLY_BAND_COUNT; i++) {
      const t = i / (BELLY_BAND_COUNT + 1);
      const y = lerp(panelTop.y, trunkBottom.y, t);
      const half = panelHalf * Math.sin(t * Math.PI) * BELLY_BAND_SPAN;
      ctx.beginPath();
      ctx.moveTo(trunkBottom.x - half, y);
      ctx.quadraticCurveTo(trunkBottom.x, y + BELLY_BAND_SAG, trunkBottom.x + half, y);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    // A spinal furrow, so the back reads as a back.
    ctx.save();
    ctx.globalAlpha = SPINE_FURROW_ALPHA;
    ctx.strokeStyle = HIDE.shadow;
    ctx.lineWidth = SPINE_FURROW_WIDTH;
    ctx.beginPath();
    ctx.moveTo(trunkTop.x, trunkTop.y);
    ctx.lineTo(trunkBottom.x, trunkBottom.y - GUT_DROP);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  wetSpot(
    ctx,
    offset(skeleton.shoulderCentre, -skeleton.shoulderHalf * 0.5, skeleton.shoulderHalf * 0.25),
    skeleton.shoulderHalf * 0.2,
    skeleton.shoulderHalf * 0.09,
    -SHOULDER_WET_TILT,
  );
  ctx.restore();
}

const DORSAL_ALPHA = 0.55;
const SPECKLE_RADIUS = 0.028;
const BELLY_PANEL_TOP = 0.28;
/** Off the centreline, so the belly is a side of the creature, not a badge. */
const PANEL_OFF_CENTRE = 0.58;
const PANEL_ALPHA = 0.34;
/** Where down the panel its centre sits, and how far out it stays fully opaque. */
const PANEL_CENTRE_DOWN = 0.78;
const PANEL_SOLID_TO = 0.35;
const BELLY_BAND_WIDTH = 0.012;
const BELLY_BAND_SPAN = 0.9;
const BELLY_BAND_SAG = 0.014;
const SPINE_FURROW_ALPHA = 0.5;
const SPINE_FURROW_WIDTH = 0.018;
const SHOULDER_WET_TILT = deg(24);

// ── Neck ─────────────────────────────────────────────────────────────────────

const NECK_FOLD_COUNT = 3;
const NUCHAL_SCALE_COUNT = 4;

/**
 * The banded neck: skin folds ringing the column, and a row of enlarged nuchal
 * scales down its top.
 *
 * This replaced a set of gill slits. The slits were the one feature on the
 * creature that named its clade outright — nothing with gill openings behind the
 * jaw is a reptile — and a banded, scaled neck is the exact opposite cue in the
 * exact same place. It also does the job the neck itself needs done: an
 * unmarked column between head and shoulders reads as a *gap* rather than as a
 * segment, and the bands are what give it length.
 */
function drawNeck(ctx: Ctx, shoulderCentre: Pt, headCentre: Pt, view: ViewSpec): void {
  const halfAt = (t: number): number =>
    NECK_WIDTH * view.girth * lerp(1, NECK_TAPER, t) * (view.profile ? NECK_PROFILE_DEPTH : 1);

  fillCapsule(
    ctx,
    shoulderCentre,
    headCentre,
    halfAt(0),
    halfAt(1),
    view.showsBack ? HIDE.shadow : HIDE.dark,
  );

  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < NECK_FOLD_COUNT; i++) {
    const up = lerp(NECK_FOLD_FROM, NECK_FOLD_TO, i / (NECK_FOLD_COUNT - 1));
    const at = mixPt(shoulderCentre, headCentre, up);
    const half = halfAt(up) * NECK_FOLD_SPAN;
    ctx.globalAlpha = NECK_FOLD_ALPHA;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = NECK_FOLD_WIDTH;
    ctx.beginPath();
    ctx.moveTo(at.x - half, at.y);
    ctx.quadraticCurveTo(at.x, at.y + NECK_FOLD_SAG, at.x + half, at.y);
    ctx.stroke();
  }
  ctx.restore();

  // The nuchal row, edge-on only — the same rule the dorsal crest follows and
  // for the same reason. Pointed at the camera these scales have no silhouette
  // to give, and drawn anyway they bake as a pale stub between the head and the
  // shoulders that reads as a cork.
  if (!view.profile) return;
  const backward = -1;
  for (let i = 0; i < NUCHAL_SCALE_COUNT; i++) {
    const up = lerp(NUCHAL_FROM, NUCHAL_TO, i / (NUCHAL_SCALE_COUNT - 1));
    const at = mixPt(shoulderCentre, headCentre, up);
    const half = halfAt(up);
    const root = offset(at, half * backward, 0);
    const tip = offset(root, half * NUCHAL_RAKE * backward, -half * NUCHAL_HEIGHT);
    fillCapsule(ctx, root, tip, half * NUCHAL_HALF, half * NUCHAL_HALF * 0.3, HORN.mid);
  }
}

const NECK_TAPER = 0.74;
/** Edge-on the neck is deeper front-to-back than it is wide across. */
const NECK_PROFILE_DEPTH = 1.18;
const NECK_FOLD_FROM = 0.2;
const NECK_FOLD_TO = 0.72;
const NECK_FOLD_SPAN = 0.86;
const NECK_FOLD_ALPHA = 0.42;
const NECK_FOLD_WIDTH = 0.011;
const NECK_FOLD_SAG = 0.012;
const NUCHAL_FROM = 0.12;
const NUCHAL_TO = 0.66;
const NUCHAL_RAKE = 0.55;
const NUCHAL_HEIGHT = 0.72;
const NUCHAL_HALF = 0.3;

// ── Head ─────────────────────────────────────────────────────────────────────

const HINGE_Y = 0.16;
/** Full gape, in radians of lower-jaw rotation about the hinge. */
const MAX_GAPE = deg(46);
/** The skull itself lifts as the jaw drops, the way a crocodilian's does. */
const MAX_SKULL_LIFT = deg(13);

const TOOTH_COUNT = 6;
/** Tooth length as a share of how far open the mouth is at that point. */
const TOOTH_LENGTH = 0.24;
/** Tooth half-width as a share of the half-pitch, so the teeth never merge. */
const TOOTH_HALF_SHARE = 0.55;

/** How far a full gular sac swells the jaw's underside past its own chin. */
const THROAT_SAC_BULGE = 0.28;

const JAW_LIP = 0.16;
const CHIN_HALF = 0.19;
const CHIN_Y = 0.92;

/**
 * The upper skull in profile: a flat roof from the occiput to a brow ridge over
 * the orbit, then a long muzzle falling away to a blunt tip.
 *
 * The roof is the whole read. An amphibian's profile is one continuous dome
 * from the neck to the nostril; a saurian's is two straight runs meeting in a
 * step at the brow, and that step is what a viewer resolves as "lizard" at a
 * glance. Everything else on the head is detail by comparison.
 */
function traceSkullProfile(ctx: Ctx): void {
  const roofBack = -SKULL_TOP * OCCIPUT_HEIGHT;
  const browTop = -SKULL_TOP * BROW_RISE;
  const lipY = HINGE_Y + JAW_LIP * 0.55;
  ctx.beginPath();
  ctx.moveTo(-SNOUT_BACK, roofBack);
  ctx.quadraticCurveTo(
    -SNOUT_BACK * 0.42,
    roofBack - SKULL_TOP * ROOF_CAMBER,
    -SNOUT_BACK * 0.04,
    browTop,
  );
  // Over the brow and down onto the muzzle. The control point below the ridge
  // is the step: without it the two runs blend and the dome comes back.
  ctx.quadraticCurveTo(
    SNOUT_TIP * 0.24,
    browTop + SKULL_TOP * BROW_STEP,
    SNOUT_TIP * 0.52,
    -SKULL_TOP * SNOUT_SLOPE,
  );
  ctx.quadraticCurveTo(
    SNOUT_TIP * 0.87,
    -SKULL_TOP * SNOUT_SLOPE * SNOUT_FALL,
    SNOUT_TIP,
    -SNOUT_TIP_Y,
  );
  ctx.quadraticCurveTo(SNOUT_TIP * 1.02, HINGE_Y * 0.4, SNOUT_TIP * 0.88, lipY);
  ctx.lineTo(-SNOUT_BACK * 0.86, lipY);
  // The quadrate: the flare of bone behind the jaw hinge that a lizard's cheek
  // hangs off, and the anchor the whole roof runs back to.
  ctx.quadraticCurveTo(-SNOUT_BACK * QUADRATE_FLARE, HINGE_Y * 0.1, -SNOUT_BACK, roofBack);
  ctx.closePath();
}

/**
 * The lower jaw in profile: a long straight ramus with the gular pouch slung
 * under its back half.
 *
 * Straight, deliberately. The mandible's lower edge is the only long straight
 * line on the creature, and curving it to match the pouch turns the whole jaw
 * into the sac it is meant to be carrying.
 */
function traceJawProfile(ctx: Ctx, throat: number): void {
  const sag = 1 + clamp01(throat) * THROAT_SAC_BULGE;
  ctx.beginPath();
  ctx.moveTo(-SNOUT_BACK * 0.92, HINGE_Y);
  ctx.lineTo(SNOUT_TIP * MANDIBLE_SHARE, HINGE_Y);
  ctx.quadraticCurveTo(
    SNOUT_TIP * 0.86,
    CHIN_Y * JAW_TIP_DEPTH * sag,
    SNOUT_TIP * 0.58,
    CHIN_Y * JAW_RAMUS_DEPTH * sag,
  );
  ctx.quadraticCurveTo(
    -SNOUT_BACK * 0.24,
    CHIN_Y * JAW_POUCH_DEPTH * sag,
    -SNOUT_BACK * 0.92,
    HINGE_Y,
  );
  ctx.closePath();
}

const SNOUT_TIP = 1.02;
const SNOUT_BACK = 0.96;
const SKULL_TOP = 0.8;
/**
 * The brow ridge is the skull's high point and the occiput is only a little
 * below it, which is what holds the roof flat between them.
 */
const BROW_RISE = 1;
const OCCIPUT_HEIGHT = 0.86;
/** A whisper of convexity on the roof, so it is not a drawn straightedge. */
const ROOF_CAMBER = 0.05;
/** How far the outline drops immediately in front of the brow. */
const BROW_STEP = 0.15;
const SNOUT_SLOPE = 0.62;
/** How much of the muzzle's height survives to the tip — the wedge's taper. */
const SNOUT_FALL = 0.68;
const SNOUT_TIP_Y = 0.3;
const QUADRATE_FLARE = 1.18;
/** Depths of the mandible at the chin, mid-ramus, and under the gular pouch. */
const JAW_TIP_DEPTH = 0.34;
const JAW_RAMUS_DEPTH = 0.44;
const JAW_POUCH_DEPTH = 0.72;

const PROFILE_EYE_Y = -0.34;
/** Almond, not round: a lizard's orbit is far wider than it is tall. */
const EYE_RX = 0.29;
const EYE_RY = 0.185;
/** The almonds rake down toward the snout, away from each other head-on. */
const EYE_TILT = deg(13);
const NOSTRIL_R = 0.042;
const SKULL_SPECKLES = 6;
const SKULL_SEED = 9137;

/**
 * One blind eye: a milky almond set into the side of the skull under a heavy
 * supraorbital shelf, ringed by a collar of small scales.
 *
 * It used to be a turret — a mound of hide standing proud of the crown, the way
 * a frog's does — and that single shape did more to make the creature read as an
 * amphibian than the rest of the head put together. A saurian eye sits *in* the
 * skull, below its roof line, hooded from above by a brow that overhangs it. The
 * hood is what keeps a set-in eye from reading as a visor slit, which is the
 * failure the turret was there to avoid in the first place.
 *
 * `tilt` rakes the almond, which is what stops two of them head-on reading as a
 * pair of level slots cut in a mask.
 */
function drawEye(
  ctx: Ctx,
  cx: number,
  cy: number,
  tilt: number,
  shut: number,
  scale: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.scale(scale, scale);

  // The scale collar, in outline tone: the orbit's rim, and the only place on
  // the head where individual scales are big enough to resolve.
  ctx.beginPath();
  ctx.ellipse(0, 0, EYE_RX * ORBIT_RIM, EYE_RY * ORBIT_RIM, 0, 0, TWO_PI);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  for (let i = 0; i < ORBIT_SCALES; i++) {
    const around = (i / ORBIT_SCALES) * TWO_PI;
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(around) * EYE_RX * ORBIT_SCALE_AT,
      Math.sin(around) * EYE_RY * ORBIT_SCALE_AT,
      EYE_RX * ORBIT_SCALE_R,
      EYE_RX * ORBIT_SCALE_R,
      0,
      0,
      TWO_PI,
    );
    ctx.fillStyle = HIDE.dark;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.ellipse(0, 0, EYE_RX, EYE_RY, 0, 0, TWO_PI);
  ctx.fillStyle = EYE_RING;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, 0, EYE_RX * EYE_JELLY, EYE_RY * EYE_JELLY, 0, 0, TWO_PI);
  ctx.fillStyle = EYE_MILK;
  ctx.fill();

  // The clouding, drawn as a *vertical slit*. It is still a blind eye — there is
  // no iris and nothing focuses — but a vertical axis in the pupil position is
  // read as reptilian before it is read as anything else, and a round smear in
  // the same place is read as an amphibian's horizontal one.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, EYE_RX * EYE_JELLY, EYE_RY * EYE_JELLY, 0, 0, TWO_PI);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(0, 0, EYE_RX * SLIT_HALF_WIDTH, EYE_RY * SLIT_HALF_HEIGHT, 0, 0, TWO_PI);
  ctx.fillStyle = EYE_RING;
  ctx.fill();
  // A haze of the old clouding over the slit, so the eye still reads as one
  // nothing is looking out of.
  ctx.globalAlpha = SLIT_HAZE_ALPHA;
  ctx.fillStyle = EYE_CLOUD;
  ctx.fill();
  ctx.restore();

  // The nictitating membrane sweeps across from the front corner rather than
  // squeezing shut top and bottom — which is how a lizard's third eyelid moves,
  // and which stays legible on an eye this much wider than it is tall.
  const lid = clamp01(shut);
  if (lid > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, EYE_RX * EYE_JELLY, EYE_RY * EYE_JELLY, 0, 0, TWO_PI);
    ctx.clip();
    ctx.fillStyle = EYE_LID;
    const sweptTo = lerp(-EYE_RX, EYE_RX, lid);
    ctx.fillRect(-EYE_RX, -EYE_RY, sweptTo + EYE_RX, EYE_RY * 2);
    ctx.restore();
  }

  // The supraorbital shelf: a wedge of hide overhanging the eye from above, with
  // its heavy edge toward the snout. This is the creature's whole expression.
  ctx.beginPath();
  ctx.moveTo(-EYE_RX * BROW_SPAN, -EYE_RY * BROW_END_DROP);
  ctx.quadraticCurveTo(0, -EYE_RY * (1 + BROW_ARCH), EYE_RX * BROW_SPAN, -EYE_RY * BROW_END_DROP);
  ctx.quadraticCurveTo(
    0,
    -EYE_RY * (1 + BROW_ARCH + BROW_THICKNESS),
    -EYE_RX * BROW_SPAN,
    -EYE_RY * BROW_END_DROP,
  );
  ctx.closePath();
  ctx.fillStyle = HIDE.dark;
  ctx.fill();
  ctx.restore();
}

/** How far past the eye the orbit's scale collar reaches. */
const ORBIT_RIM = 1.26;
const ORBIT_SCALES = 9;
const ORBIT_SCALE_AT = 1.12;
const ORBIT_SCALE_R = 0.13;

const EYE_JELLY = 0.62;
/**
 * The slit: narrow across, and tall enough to run past the eye's own top and
 * bottom so it is cut off by them rather than floating as a bead inside them.
 *
 * Drawn in the socket's own ink, because a light smear on a light eye carries
 * no contrast at a 32 px tile and the one mark on this face that says
 * "reptile" cannot be the one that disappears first.
 *
 * **Narrow, though.** At a quarter of the eye's width the bar was as thick as
 * the two pale lobes it left either side of it, and a blind reviewer read the
 * profile head as having *two eyes side by side on top of its skull* — which is
 * precisely the frog cue this whole redraw exists to kill.
 */
const SLIT_HALF_WIDTH = 0.13;
const SLIT_HALF_HEIGHT = 1.1;
const SLIT_HAZE_ALPHA = 0.45;
const BROW_SPAN = 1.3;
const BROW_ARCH = 0.5;
/**
 * Where the shelf's two ends sit, as a share of the eye's own half-height.
 *
 * Near the eye's top edge, not near its centre. Hung low the hood covers the
 * upper half of the eye — and with it the vertical slit, which is the one mark
 * on this face doing the reptile work. Symmetric, too: `drawEye` is called
 * unmirrored for both head-on eyes, so a brow that dips toward one side of its
 * own local space dips toward the snout on one eye and away on the other.
 */
const BROW_END_DROP = 0.82;
const BROW_THICKNESS = 0.42;

/**
 * The open mouth, described by the two jaw lines that bound it.
 *
 * `roof` runs along the palate from the hinge forward; `floor` runs along the
 * mandible from the same hinge. Head-on those two lines are very nearly
 * parallel and the opening is a lens; edge-on they diverge from the hinge and
 * it is a wedge. One description covers both, which is what stops the profile
 * gape and the head-on gape being two unrelated drawings that disagree about
 * how far the jaw has moved.
 */
interface MouthShape {
  /** The hinge, where the two jaw lines meet. */
  readonly hinge: Pt;
  /** Front end of the palate. */
  readonly roofTip: Pt;
  /** Front end of the mandible. */
  readonly floorTip: Pt;
  /** How far the roof bows away from the straight hinge→tip line. */
  readonly roofArch: number;
  readonly floorArch: number;
}

/** Point on a quadratic bezier at `t`, used to hang teeth off a curved jaw. */
function quadPoint(a: Pt, control: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
  };
}

/** The control point that bows a jaw line `arch` away from its own chord. */
function archControl(a: Pt, b: Pt, arch: number): Pt {
  const mid = mixPt(a, b, 0.5);
  const angle = angleBetween(a, b) + HALF_PI;
  return offset(mid, Math.cos(angle) * arch, Math.sin(angle) * arch);
}

/**
 * The gullet behind the teeth, plus the teeth themselves.
 *
 * Teeth are drawn *into* the mouth's dark shape rather than as pale strokes on
 * the hide. At a 32 px tile a tooth painted over skin is one grey pixel and
 * disappears; a pale notch cut out of a black hole survives, because it changes
 * the shape of the hole.
 */
function drawGullet(ctx: Ctx, mouth: MouthShape, tongue: number): void {
  const roofControl = archControl(mouth.hinge, mouth.roofTip, -mouth.roofArch);
  const floorControl = archControl(mouth.hinge, mouth.floorTip, mouth.floorArch);
  // How far apart the two jaw lines get, which is the only measure of "how
  // open" that works for a wedge and a lens alike: a lens is widest at its
  // middle and a wedge at its open end, so both are sampled.
  let span = 0;
  for (const at of GAPE_SAMPLES) {
    const roofAt = quadPoint(mouth.hinge, roofControl, mouth.roofTip, at);
    const floorAt = quadPoint(mouth.hinge, floorControl, mouth.floorTip, at);
    span = Math.max(span, Math.hypot(floorAt.x - roofAt.x, floorAt.y - roofAt.y));
  }
  if (span <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(mouth.hinge.x, mouth.hinge.y);
  ctx.quadraticCurveTo(roofControl.x, roofControl.y, mouth.roofTip.x, mouth.roofTip.y);
  ctx.lineTo(mouth.floorTip.x, mouth.floorTip.y);
  ctx.quadraticCurveTo(floorControl.x, floorControl.y, mouth.hinge.x, mouth.hinge.y);
  ctx.closePath();
  ctx.fillStyle = GULLET;
  ctx.fill();
  ctx.clip();

  // Gum bands along both jaw lines, so the teeth are set in something.
  ctx.strokeStyle = GUM;
  ctx.lineWidth = span * GUM_BAND;
  ctx.beginPath();
  ctx.moveTo(mouth.hinge.x, mouth.hinge.y);
  ctx.quadraticCurveTo(roofControl.x, roofControl.y, mouth.roofTip.x, mouth.roofTip.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mouth.hinge.x, mouth.hinge.y);
  ctx.quadraticCurveTo(floorControl.x, floorControl.y, mouth.floorTip.x, mouth.floorTip.y);
  ctx.stroke();

  const bulge = clamp01(tongue);
  if (bulge > 0) {
    // The tongue's root, packed into the floor of the mouth ready to fire.
    const seat = quadPoint(mouth.hinge, floorControl, mouth.floorTip, TONGUE_ROOT_ALONG);
    const towardRoof = quadPoint(mouth.hinge, roofControl, mouth.roofTip, TONGUE_ROOT_ALONG);
    const centre = mixPt(seat, towardRoof, TONGUE_ROOT_UP * bulge);
    const radius = span * TONGUE_ROOT_HALF * bulge;
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y, radius, radius * TONGUE_ROOT_SQUASH, 0, 0, TWO_PI);
    ctx.fillStyle = TONGUE_MID;
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = VENOM_SHEEN_ALPHA;
    ctx.fillStyle = VENOM;
    ctx.beginPath();
    ctx.ellipse(
      centre.x,
      centre.y,
      radius * TONGUE_VENOM_SHARE,
      radius * TONGUE_ROOT_SQUASH * TONGUE_VENOM_SHARE,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = TOOTH;
  const halfPitch = 1 / (TOOTH_COUNT * 2);
  const toothHalf = halfPitch * TOOTH_HALF_SHARE;
  /**
   * Per-tooth length and spacing jitter. Even triangles at even spacing are a
   * saw blade; a mouth has a couple of long ones and a couple of stubs.
   */
  const toothJitter = (index: number): { length: number; shift: number } => {
    const spread = TOOTH_JITTER[index % TOOTH_JITTER.length];
    return { length: spread.length, shift: spread.shift * halfPitch };
  };
  /**
   * One row of teeth, each pointing at the *same parameter* on the opposite jaw
   * line rather than at a fixed point on it. That is what makes a tooth longest
   * where the gape is widest and taper to nothing back at the hinge; aimed at
   * the far jaw's tip instead, the teeth are longest at the hinge, where the
   * mouth is shut.
   */
  const toothRow = (
    control: Pt,
    tip: Pt,
    oppositeControl: Pt,
    oppositeTip: Pt,
    phase: number,
  ): void => {
    for (let i = 0; i < TOOTH_COUNT; i++) {
      const jitter = toothJitter(i);
      const at = clamp01((i + phase) / TOOTH_COUNT + jitter.shift);
      const back = quadPoint(mouth.hinge, control, tip, Math.max(0, at - toothHalf));
      const front = quadPoint(mouth.hinge, control, tip, Math.min(1, at + toothHalf));
      const root = quadPoint(mouth.hinge, control, tip, at);
      const facing = quadPoint(mouth.hinge, oppositeControl, oppositeTip, at);
      const toothTip = mixPt(root, facing, TOOTH_LENGTH * jitter.length);
      ctx.beginPath();
      ctx.moveTo(back.x, back.y);
      ctx.lineTo(front.x, front.y);
      ctx.lineTo(toothTip.x, toothTip.y);
      ctx.closePath();
      ctx.fill();
    }
  };
  // Offset the two rows against each other so upper and lower teeth interlock
  // rather than meeting point to point, which is what a bite looks like.
  toothRow(roofControl, mouth.roofTip, floorControl, mouth.floorTip, UPPER_ROW_PHASE);
  toothRow(floorControl, mouth.floorTip, roofControl, mouth.roofTip, LOWER_ROW_PHASE);
  ctx.restore();
}

const GAPE_SAMPLES: readonly number[] = [0.5, 0.8, 1];
const GUM_BAND = 0.16;
const TONGUE_ROOT_ALONG = 0.62;
const TONGUE_ROOT_SQUASH = 0.7;
const TONGUE_VENOM_SHARE = 0.45;
const TONGUE_MID = '#8e2f43';
/** How far the packed tongue root rises off the floor of the mouth. */
const TONGUE_ROOT_UP = 0.28;
const TONGUE_ROOT_HALF = 0.24;
const VENOM_SHEEN_ALPHA = 0.45;
const TOOTH_JITTER: readonly { readonly length: number; readonly shift: number }[] = [
  { length: 1.24, shift: -0.12 },
  { length: 0.78, shift: 0.16 },
  { length: 1.05, shift: -0.05 },
  { length: 1.35, shift: 0.1 },
  { length: 0.7, shift: -0.15 },
];
const UPPER_ROW_PHASE = 0.35;
const LOWER_ROW_PHASE = 0.85;

/**
 * The jaw hinge in profile — far back on the skull, where a crocodile's is.
 *
 * Anchored on the profile skull's own back edge rather than on `HINGE_X`, which
 * measures the mouth's corners *across* a head-on face. The two were the same
 * number until the head-on skull grew a narrow muzzle and its corners moved in;
 * shared, that change would have dragged the profile's pivot a third of the way
 * up the snout and opened a gap at the back of every gape.
 */
function profileHinge(): Pt {
  return pt(-SNOUT_BACK * PROFILE_HINGE_SHARE, HINGE_Y);
}

/** Rotates `p` about `pivot`. */
function rotateAbout(p: Pt, pivot: Pt, angle: number): Pt {
  const spun = rotate({ x: p.x - pivot.x, y: p.y - pivot.y }, angle);
  return offset(pivot, spun.x, spun.y);
}

/**
 * Edge-on the gape is a genuine wedge: both jaws pivot on the same hinge, the
 * mandible swinging down and the skull lifting a little against it, so the
 * opening is nothing at the hinge and widest at the snout.
 */
function profileMouth(gape: number): MouthShape {
  const hinge = profileHinge();
  return {
    hinge,
    roofTip: rotateAbout(pt(SNOUT_TIP * PALATE_SHARE, HINGE_Y), hinge, -gape * MAX_SKULL_LIFT),
    floorTip: rotateAbout(pt(SNOUT_TIP * MANDIBLE_SHARE, HINGE_Y), hinge, gape * MAX_GAPE),
    roofArch: PROFILE_ROOF_ARCH,
    floorArch: PROFILE_FLOOR_ARCH,
  };
}

/**
 * The whole head, drawn about `headCentre` in skull-radius units.
 *
 * The jaw is a genuinely separate shape hinged at the corners of the skull, in
 * every view. Faking a gape by widening a painted mouth line gives a creature
 * whose face changes shape rather than one whose jaw opens, and the gape is the
 * entire telegraph the player has to read before the tongue fires.
 */
/**
 * The head in the two views that are not edge-on, drawn as a **turned** skull.
 *
 * A muzzle pointed straight at the camera projects to a stub, and there is no
 * drawing of it from that angle that shows its shape — which is why these two
 * views stayed amphibian through several rounds of reshaping the face itself.
 * So the head is never held square: it is turned, and the turn is drawn by
 * painting the *profile* skull with its x squashed, which is exactly what a
 * rotation about the vertical axis looks like.
 *
 * Behind that, a head-on braincase, because a skull does not lose its width
 * when it turns — squashing the profile alone would pinch the whole head to a
 * sliver on the frames the sweep passes through square.
 */
function drawYawedHead(ctx: Ctx, pose: TrogPose, view: ViewSpec, layer: HeadLayer): void {
  const yaw = Math.max(-1, Math.min(1, pose.headYaw)) * MAX_HEAD_YAW;
  const facing = Math.sin(yaw) < 0 ? -1 : 1;
  // Never fully square. At zero the profile collapses to a vertical line, so
  // the floor is what a real head shows when it looks almost at you: a blunt
  // muzzle foreshortened to about a third of its length.
  const showing = Math.max(Math.abs(Math.sin(yaw)), MIN_SNOUT_SHOWING);
  // Two different braincases, because the two views ask opposite things of it.
  // From the front it has to *hide inside* the turned skull painted over it, so
  // it is flat and wide; from behind it is the entire head and a flat wide
  // ellipse there is a discus balanced on the shoulders.
  const craniumHalf = view.showsBack
    ? BACK_CRANIUM_HALF_ACROSS
    : CRANIUM_HALF_ACROSS * Math.abs(Math.cos(yaw)) + CRANIUM_HALF_DEEP * showing;
  const craniumTall = view.showsBack ? BACK_CRANIUM_HALF_TALL : CRANIUM_HALF_TALL;
  const craniumY = view.showsBack ? BACK_CRANIUM_CENTRE_Y : CRANIUM_CENTRE_Y;

  const paintCranium = (): void => {
    ctx.save();
    ctx.scale(HEAD_RY, HEAD_RY);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = (OUTLINE_BLEED * 2) / HEAD_RY;
    const trace = (): void => {
      ctx.beginPath();
      ctx.ellipse(0, craniumY, craniumHalf, craniumTall, 0, 0, TWO_PI);
    };
    trace();
    ctx.stroke();
    ctx.fillStyle = HIDE.mid;
    ctx.fill();

    // From behind, the muzzle is hidden behind the body and this ellipse is the
    // entire head. Left bare it bakes as a smooth pale disc — a plate balanced
    // on the shoulders — so the parietal scales and the occipital ridge that
    // would be visible from this angle have to carry it.
    if (view.showsBack) {
      ctx.save();
      trace();
      ctx.clip();
      speckle(
        ctx,
        SKULL_SEED,
        SKULL_SPECKLES,
        { x: craniumHalf * 0.66, y: craniumTall * 0.6 },
        pt(0, craniumY),
        SPECKLE_RADIUS / HEAD_RY,
      );
      ctx.globalAlpha = OCCIPUT_RIDGE_ALPHA;
      ctx.strokeStyle = HIDE.shadow;
      ctx.lineWidth = OCCIPUT_RIDGE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(-craniumHalf, craniumY + craniumTall * OCCIPUT_RIDGE_AT);
      ctx.quadraticCurveTo(
        0,
        craniumY + craniumTall * (OCCIPUT_RIDGE_AT - OCCIPUT_RIDGE_ARCH),
        craniumHalf,
        craniumY + craniumTall * OCCIPUT_RIDGE_AT,
      );
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  const paintTurnedSkull = (): void => {
    ctx.save();
    ctx.scale(HEAD_DEPTH * showing * facing, HEAD_RY);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = (OUTLINE_BLEED * 2) / Math.min(HEAD_DEPTH * showing, HEAD_RY);
    paintProfileSkull(ctx, pose, view, HEAD_RY);
    ctx.restore();
  };

  // From behind, the head is carried above the shoulders and turned, so what
  // shows is the back of the braincase with the muzzle swung out past one side
  // of it. The muzzle therefore goes *over* the braincase, not under it —
  // painted beneath, it is a sliver of outline and the whole view bakes as a
  // bare egg on a pair of shoulders.
  //
  // Nothing of the face comes with it: `view.showsFace` is false here, so
  // `paintProfileSkull` draws the skull and jaw and skips the eye, the nostril
  // and the lip line. Which is exactly right for a head seen from behind.
  if (layer === 'behindBody') return;
  // From behind there is no braincase to add: the turned skull already carries
  // one, and a second ellipse behind it just makes two overlapping pale shapes
  // with no structure between them — a bowl with a lid on it. The front view
  // still needs it, because there the skull is painted over it and the two
  // together are what give the head width.
  if (!view.showsBack) paintCranium();
  paintTurnedSkull();
}

/** How far the skull turns at a full `headYaw`. */
const MAX_HEAD_YAW = deg(78);
/**
 * The least of its own depth the head is ever drawn at.
 *
 * High, and that is the whole point. Squashed much below this the skull is a
 * narrow vertical smear with a compressed eye in it — a blob, not a head, which
 * is exactly what a viewer said of it. The head is *never* drawn facing the
 * camera square, because there is no readable drawing of it from that angle;
 * the choreography keeps its yaw above the floor too, so the sweep stays a real
 * turn rather than a clamp.
 */
const MIN_SNOUT_SHOWING = 0.62;
const CRANIUM_HALF_ACROSS = 0.7;
const CRANIUM_HALF_DEEP = 0.56;
const CRANIUM_HALF_TALL = 0.56;
const CRANIUM_CENTRE_Y = -0.28;
/** The back of the skull is tall and narrow, not the flat plate the front needs. */
const BACK_CRANIUM_HALF_ACROSS = 0.74;
const BACK_CRANIUM_HALF_TALL = 0.86;
const BACK_CRANIUM_CENTRE_Y = -0.34;
const OCCIPUT_RIDGE_ALPHA = 0.5;
const OCCIPUT_RIDGE_WIDTH = 0.07;
const OCCIPUT_RIDGE_AT = 0.1;
const OCCIPUT_RIDGE_ARCH = 0.5;

/**
 * Which pass of the head is being painted.
 *
 * Only the back view needs two: its snout runs away from the camera behind the
 * creature's own trunk, so it has to be laid down before the body while the
 * skull that carries it goes on top of everything.
 */
type HeadLayer = 'behindBody' | 'overBody';

const LABIAL_SCALE_COUNT = 7;

/**
 * The row of enlarged lip scales along the upper jaw.
 *
 * Small, and worth every pixel: a mouth line drawn as a single stroke is a
 * seam, and a seam down a tapering muzzle is a beak. Broken into a row of
 * scallops the same line becomes a jaw with scales on it, which is a thing only
 * a reptile has — a bird's bill has no scales along its edge and a frog's lip
 * has no texture at all.
 */
function drawLabialScales(ctx: Ctx): void {
  ctx.save();
  ctx.globalAlpha = LABIAL_ALPHA;
  ctx.fillStyle = HIDE.light;
  for (let i = 0; i < LABIAL_SCALE_COUNT; i++) {
    const along = (i + 0.5) / LABIAL_SCALE_COUNT;
    const x = lerp(-SNOUT_BACK * LABIAL_FROM, SNOUT_TIP * LABIAL_TO, along);
    const size = LABIAL_SIZE * lerp(1, LABIAL_TAPER, along);
    ctx.beginPath();
    ctx.ellipse(x, HINGE_Y - size * LABIAL_UP, size, size * LABIAL_SQUASH, 0, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

const LABIAL_ALPHA = 0.42;
const LABIAL_FROM = 0.72;
const LABIAL_TO = 0.9;
const LABIAL_SIZE = 0.11;
const LABIAL_TAPER = 0.62;
const LABIAL_UP = 0.7;
const LABIAL_SQUASH = 0.62;

/**
 * The tympanum — the bare eardrum disc behind the eye.
 *
 * The single most specifically *lizard* mark available at this size. Snakes do
 * not have one, birds and mammals cover theirs, and an amphibian's is set flush
 * in smooth skin rather than sunk behind a scaled jowl. A viewer will not name
 * it, but it is the reason the head stops being generically reptilian.
 */
function drawEarDisc(ctx: Ctx): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(EAR_X, EAR_Y, EAR_RX, EAR_RY, EAR_TILT, 0, TWO_PI);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(EAR_X, EAR_Y, EAR_RX * EAR_INSET, EAR_RY * EAR_INSET, EAR_TILT, 0, TWO_PI);
  ctx.fillStyle = HIDE.shadow;
  ctx.fill();
  ctx.restore();
}

const EAR_X = -0.52;
const EAR_Y = -0.2;
const EAR_RX = 0.16;
const EAR_RY = 0.21;
const EAR_TILT = deg(-12);
const EAR_INSET = 0.66;

/**
 * Paints the edge-on skull inside a transform its caller has already set: x
 * scaled by how much of the head's depth is showing, y by the head's radius.
 *
 * Shared with the *turned* head-on views, which paint this exact art with a
 * squashed x — foreshortening a profile is what a rotation about the vertical
 * axis actually looks like. Building those views a separate three-quarter snout
 * out of capsules instead produced a uniform tapering bar with a rounded end,
 * which reads as a bill; the reptile lives in these curves, and the way to get
 * it into the front view is to reuse them rather than redraw them.
 */
function paintProfileSkull(ctx: Ctx, pose: TrogPose, view: ViewSpec, ry: number): void {
  const gape = clamp01(pose.gape);
  const traceSkull = traceSkullProfile;
  const traceJaw = (target: Ctx): void => traceJawProfile(target, pose.throat);

  // Jaw first, then the gullet, then the skull over both: the roof of the mouth
  // belongs to the skull, so the skull has to be the thing painted last or the
  // gullet's dark shape swallows the snout.
  ctx.save();
  const jawPivot = profileHinge();
  ctx.translate(jawPivot.x, jawPivot.y);
  ctx.rotate(gape * MAX_GAPE);
  ctx.translate(-jawPivot.x, -jawPivot.y);
  traceJaw(ctx);
  ctx.stroke();
  ctx.fillStyle = HIDE.mid;
  ctx.fill();
  ctx.save();
  traceJaw(ctx);
  ctx.clip();
  // Only edge-on. Head-on there is no underside of a jaw in view, and a pale
  // band painted there is a beard however narrow it is made.
  {
    ctx.fillStyle = rgba(BELLY.mid, JAW_UNDER_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      -SNOUT_BACK * 0.1,
      CHIN_Y * JAW_UNDER_AT,
      CHIN_HALF,
      CHIN_Y * JAW_UNDER_DEPTH,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  if (pose.throat > 0) {
    // A blush over the sac, not a slab of belly tone: the swelling itself is
    // already in the jaw's outline, and painted opaque here it is the brightest
    // thing on the creature and reads as a bib.
    ctx.beginPath();
    ctx.ellipse(
      -SNOUT_BACK * 0.1,
      CHIN_Y * THROAT_SAC_Y,
      CHIN_HALF * THROAT_SAC_RX * (1 + clamp01(pose.throat) * THROAT_SAC_SWELL),
      CHIN_Y * THROAT_SAC_RY * (1 + clamp01(pose.throat) * THROAT_SAC_SWELL),
      0,
      0,
      TWO_PI,
    );
    ctx.fillStyle = rgba(BELLY.dark, THROAT_SAC_ALPHA * clamp01(pose.throat));
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  if (gape > 0) {
    drawGullet(ctx, profileMouth(gape), pose.tongue);
  }

  ctx.save();
  // The skull lifts against the same hinge the mandible drops on, not about the
  // head's centre: pivoted anywhere else the two jaw lines stop meeting and the
  // gape opens a gap at the back of the mouth.
  const liftPivot = profileHinge();
  ctx.translate(liftPivot.x, liftPivot.y);
  ctx.rotate(-gape * MAX_SKULL_LIFT);
  ctx.translate(-liftPivot.x, -liftPivot.y);
  traceSkull(ctx);
  ctx.stroke();
  ctx.fillStyle = HIDE.mid;
  ctx.fill();

  ctx.save();
  traceSkull(ctx);
  ctx.clip();
  speckle(
    ctx,
    SKULL_SEED,
    SKULL_SPECKLES,
    { x: SNOUT_TIP * 0.6, y: 0.45 },
    pt(SNOUT_TIP * 0.15, -0.35),
    SPECKLE_RADIUS / ry,
  );
  // The underside of the snout is pale, like the belly — but only edge-on, and
  // only a sliver hugging the lip line. Painted across the lower half of a
  // head-on skull it turns the face into two stacked plates.
  {
    ctx.fillStyle = rgba(BELLY.mid, SNOUT_UNDER_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      SNOUT_TIP * 0.3,
      HINGE_Y + JAW_LIP * SNOUT_UNDER_AT,
      SNOUT_TIP * SNOUT_UNDER_SPAN,
      JAW_LIP * SNOUT_UNDER_DEPTH,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.restore();

  if (view.showsFace) {
    // The lip line, so a shut jaw still reads as a jaw that could open.
    if (gape < MOUTH_LINE_FADE) {
      ctx.save();
      ctx.globalAlpha = 1 - gape / MOUTH_LINE_FADE;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = MOUTH_LINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(-SNOUT_BACK * MOUTH_LINE_SPAN, HINGE_Y);
      ctx.quadraticCurveTo(
        SNOUT_TIP * 0.3,
        HINGE_Y + JAW_LIP * MOUTH_LINE_SAG,
        SNOUT_TIP * MOUTH_LINE_SPAN,
        HINGE_Y - JAW_LIP * PROFILE_LIP_RISE,
      );
      ctx.stroke();
      ctx.restore();
    }
    drawLabialScales(ctx);
    drawEarDisc(ctx);
    drawEye(ctx, PROFILE_EYE_X, PROFILE_EYE_Y, EYE_TILT, pose.eyeShut, EYE_PROFILE_SCALE);
    ctx.beginPath();
    ctx.ellipse(
      SNOUT_TIP * NOSTRIL_PROFILE_X,
      -SKULL_TOP * NOSTRIL_PROFILE_UP,
      NOSTRIL_R,
      NOSTRIL_R * 0.7,
      0,
      0,
      TWO_PI,
    );
    ctx.fillStyle = EYE_RING;
    ctx.fill();
  }

  // Two soft blobs of different sizes rather than one hard streak: a single
  // even highlight reads as a glaze on ceramic, not as water on hide.
  for (const blob of CROWN_WET_BLOBS) {
    wetSpot(
      ctx,
      pt(SNOUT_TIP * 0.3 + blob.dx, -SKULL_TOP * CROWN_WET_UP + blob.dy),
      CROWN_WET_RX * blob.scale,
      CROWN_WET_RY * blob.scale,
      blob.tilt,
    );
  }
  ctx.restore();
}

function drawHead(ctx: Ctx, pose: TrogPose, view: ViewSpec, layer: HeadLayer): void {
  if (!view.profile) {
    drawYawedHead(ctx, pose, view, layer);
    return;
  }
  if (layer === 'behindBody') return;
  ctx.save();
  ctx.scale(HEAD_DEPTH, HEAD_RY);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = (OUTLINE_BLEED * 2) / Math.min(HEAD_DEPTH, HEAD_RY);
  paintProfileSkull(ctx, pose, view, HEAD_RY);
  ctx.restore();
}

/** How far back along the profile skull's own length the hinge sits. */
const PROFILE_HINGE_SHARE = 0.88;
/** How far forward along the snout the palate and the mandible each reach. */
const PALATE_SHARE = 0.94;
const MANDIBLE_SHARE = 0.84;
const PROFILE_ROOF_ARCH = 0.09;
const PROFILE_FLOOR_ARCH = 0.05;
const PROFILE_EYE_X = 0.06;
/**
 * The profile skull is far shallower than the head-on one is tall, so an eye
 * drawn at the same size fills it top to bottom and sits on the crown.
 */
const EYE_PROFILE_SCALE = 0.74;
const NOSTRIL_PROFILE_X = 0.88;
/** Up the snout's own falling top line, where a real naris sits. */
const NOSTRIL_PROFILE_UP = 0.24;
const MOUTH_LINE_FADE = 0.12;
const MOUTH_LINE_WIDTH = 0.15;
const MOUTH_LINE_SPAN = 0.9;
const MOUTH_LINE_SAG = 0.06;
/** The lip line lifts toward the snout tip, which is what gives it a sneer. */
const PROFILE_LIP_RISE = 0.35;
const SNOUT_UNDER_ALPHA = 0.38;
const SNOUT_UNDER_AT = 0.5;
const SNOUT_UNDER_SPAN = 0.8;
const SNOUT_UNDER_DEPTH = 0.7;
const JAW_UNDER_ALPHA = 0.16;
const JAW_UNDER_AT = 0.8;
const JAW_UNDER_DEPTH = 0.28;
const THROAT_SAC_Y = 0.5;
const THROAT_SAC_RX = 0.66;
const THROAT_SAC_RY = 0.3;
const THROAT_SAC_SWELL = 0.3;
const THROAT_SAC_ALPHA = 0.5;
const CROWN_WET_UP = 0.62;
const CROWN_WET_RX = 0.22;
const CROWN_WET_RY = 0.1;
const CROWN_WET_BLOBS: readonly {
  readonly dx: number;
  readonly dy: number;
  readonly scale: number;
  readonly tilt: number;
}[] = [
  { dx: 0, dy: 0, scale: 1, tilt: 0 },
  { dx: 0.34, dy: 0.16, scale: 0.5, tilt: deg(18) },
];

// ── Tail ─────────────────────────────────────────────────────────────────────

const TAIL_SEGMENTS = 8;
/**
 * In tile units, along the tail's own curve rather than across the screen. The
 * arc spends a good third of it turning, so the silhouette grows by noticeably
 * less than this.
 */
const TAIL_LENGTH = 0.95;
const TAIL_ROOT_HALF = 0.098;
const TAIL_TIP_HALF = 0.009;
const TAIL_BAND_COUNT = 4;
const TAIL_SCUTE_COUNT = 5;

/**
 * The tail's centreline, root first, integrated as a constant-ish turn per
 * segment rather than laid out as fixed points — which is what lets one
 * description cover a tail dragged on the floor and the same tail carried out
 * straight behind, without either being authored twice.
 */
function tailSpine(root: Pt, pose: TrogPose, view: ViewSpec): Pt[] {
  const sway = Math.max(-1, Math.min(1, pose.tailSway));
  const lift = clamp01(pose.tailLift);
  const towardCamera = view.showsBack;

  // Edge-on the tail lies in the picture plane and shows its true length. In
  // the head-on views it runs almost straight at or away from the camera, so
  // nearly all of that length is spent in depth and only a stub of it projects.
  const alongView = view.profile
    ? 1
    : towardCamera
      ? TAIL_TOWARD_CAMERA_SHARE
      : TAIL_AWAY_FROM_CAMERA_SHARE;
  const step = (TAIL_LENGTH * alongView) / TAIL_SEGMENTS;

  // Backward and down edge-on; straight down head-on, where "backward" is into
  // the screen and the swing is the only part of it with a direction on screen.
  // Head-on it always lies off to one side. Hung straight down the centreline
  // it emerges from between the legs as a banded column, which reads as a
  // segmented abdomen rather than as a tail going away behind the creature.
  const base = view.profile
    ? TAIL_PROFILE_BASE_ANGLE - lift * TAIL_LIFT_SWING
    : TAIL_FACING_BASE_ANGLE +
      Math.sign(view.forward) * TAIL_FACING_REST_LEAN +
      sway * TAIL_FACING_SWING;

  let heading = base;
  let at = root;
  const spine = [at];
  for (let i = 1; i <= TAIL_SEGMENTS; i++) {
    const along = i / TAIL_SEGMENTS;
    // The tail droops through its first half and flicks up through its last, so
    // the tip is the part that reads at a glance.
    const droop = lerp(TAIL_DROOP_TURN, TAIL_TIP_TURN, along) * (1 - lift * TAIL_LIFT_STRAIGHTEN);
    // Head-on the tail curls away across the screen rather than undulating.
    // Run straight it is a long even wedge, which bakes as a hanging flap of
    // cloth — a blind reviewer called it a loincloth in both head-on views.
    const bow = view.profile
      ? sway * TAIL_PROFILE_BOW * Math.sin(along * Math.PI)
      : Math.sign(view.forward) * TAIL_FACING_CURL;
    heading += droop + bow;
    at = offset(at, Math.cos(heading) * step, Math.sin(heading) * step);
    spine.push(at);
  }
  return spine;
}

/**
 * Half-width `along` the tail. Head-on it is drawn much thinner: the *same*
 * root width that reads as a tapering tail edge-on reads as a flat panel when
 * it is only two thirds of a tile long, because there is no length left to
 * taper over.
 */
function tailHalfAt(along: number, view: ViewSpec): number {
  const slim = view.profile ? 1 : TAIL_FACING_SLIM;
  return lerp(TAIL_ROOT_HALF * slim, TAIL_TIP_HALF, easeIn(along));
}

/**
 * The tail: a banded, scuted taper off the base of the spine.
 *
 * It is the single strongest thing on the creature saying "lizard" — a stooped
 * biped with a long jaw and no tail behind it reads as an amphibian standing up,
 * because that is the one body plan that matches. Which is also why it is drawn
 * in every view including the two that barely show it: a tail that appears only
 * in profile is worse than none, since it makes the three views disagree about
 * what animal this is.
 */
function drawTail(ctx: Ctx, skeleton: Skeleton, pose: TrogPose, view: ViewSpec): void {
  const hipHalf = HIP_HALF * view.girth * view.hipDepth;
  const root = offset(
    skeleton.hip,
    -hipHalf * TAIL_ROOT_BACK * view.forward,
    GUT_DROP * TAIL_ROOT_DOWN,
  );
  const spine = tailSpine(root, pose, view);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_BLEED * 2;
  for (let i = 0; i < TAIL_SEGMENTS; i++) {
    outlineCapsule(
      ctx,
      spine[i],
      spine[i + 1],
      tailHalfAt(i / TAIL_SEGMENTS, view),
      tailHalfAt((i + 1) / TAIL_SEGMENTS, view),
    );
  }
  // Every outline before any fill. Interleaved, each segment's stroke is laid
  // over the previous segment's body and the tail bakes as a stack of rings.
  for (let i = 0; i < TAIL_SEGMENTS; i++) {
    fillCapsule(
      ctx,
      spine[i],
      spine[i + 1],
      tailHalfAt(i / TAIL_SEGMENTS, view),
      tailHalfAt((i + 1) / TAIL_SEGMENTS, view),
      HIDE.mid,
    );
  }

  // Scale bands ringing it. At the size this renders they are what separate a
  // tail from a length of cable trailing off the creature's back.
  ctx.save();
  ctx.globalAlpha = TAIL_BAND_ALPHA;
  ctx.strokeStyle = HIDE.shadow;
  ctx.lineCap = 'round';
  for (let i = 1; i <= TAIL_BAND_COUNT; i++) {
    const along = lerp(TAIL_BAND_FROM, TAIL_BAND_TO, (i - 1) / (TAIL_BAND_COUNT - 1));
    const index = Math.min(TAIL_SEGMENTS - 1, Math.floor(along * TAIL_SEGMENTS));
    const at = mixPt(spine[index], spine[index + 1], along * TAIL_SEGMENTS - index);
    const half = tailHalfAt(along, view);
    const across = angleBetween(spine[index], spine[index + 1]) + HALF_PI;
    ctx.lineWidth = half * TAIL_BAND_WIDTH;
    ctx.beginPath();
    ctx.moveTo(at.x + Math.cos(across) * half, at.y + Math.sin(across) * half);
    ctx.lineTo(at.x - Math.cos(across) * half, at.y - Math.sin(across) * half);
    ctx.stroke();
  }
  ctx.restore();

  // The dorsal scutes, carrying the spine crest on down the tail. Only edge-on:
  // head-on the tail's top is pointed at or away from the camera, and a row of
  // horns drawn there sits on its flank instead of on its back.
  if (view.profile) {
    for (let i = 0; i < TAIL_SCUTE_COUNT; i++) {
      const along = lerp(TAIL_SCUTE_FROM, TAIL_SCUTE_TO, i / (TAIL_SCUTE_COUNT - 1));
      const index = Math.min(TAIL_SEGMENTS - 1, Math.floor(along * TAIL_SEGMENTS));
      const at = mixPt(spine[index], spine[index + 1], along * TAIL_SEGMENTS - index);
      const half = tailHalfAt(along, view);
      const up = angleBetween(spine[index], spine[index + 1]) - HALF_PI;
      const scute = half * TAIL_SCUTE_HEIGHT * lerp(1, TAIL_SCUTE_TAPER, along);
      const rootAt = offset(at, Math.cos(up) * half * 0.6, Math.sin(up) * half * 0.6);
      fillCapsule(
        ctx,
        rootAt,
        offset(rootAt, Math.cos(up) * scute, Math.sin(up) * scute),
        half * TAIL_SCUTE_HALF,
        half * TAIL_SCUTE_HALF * 0.2,
        HORN.mid,
      );
    }
  }
  ctx.restore();
}

/** How far behind the hip the tail roots, as a share of the hip's half-width. */
const TAIL_ROOT_BACK = 0.85;
const TAIL_ROOT_DOWN = 0.6;
/** Back and slightly down, in screen radians, where +Y runs down. */
const TAIL_PROFILE_BASE_ANGLE = deg(158);
/** Straight down, which is all a tail pointed at the camera projects to. */
const TAIL_FACING_BASE_ANGLE = deg(90);
const TAIL_FACING_SWING = deg(34);
/** Its resting lie, off the centreline even with no swing on it at all. */
const TAIL_FACING_REST_LEAN = deg(14);
/** Constant turn per segment head-on, which curls the stub into a C. */
const TAIL_FACING_CURL = deg(11);
/** How much thinner the tail is drawn in the two head-on views. */
const TAIL_FACING_SLIM = 0.58;
/** How far carrying the tail high swings its root up off the floor. */
const TAIL_LIFT_SWING = deg(40);
/** And how much of its droop that same carry takes out. */
const TAIL_LIFT_STRAIGHTEN = 0.7;
const TAIL_DROOP_TURN = deg(9);
const TAIL_TIP_TURN = deg(-6);
const TAIL_PROFILE_BOW = deg(7);
const TAIL_TOWARD_CAMERA_SHARE = 0.62;
/**
 * Shorter still: pointed away, the tail is mostly *behind* the creature's own
 * body as well as foreshortened, so only its last stretch clears the hips.
 */
const TAIL_AWAY_FROM_CAMERA_SHARE = 0.34;
const TAIL_BAND_ALPHA = 0.26;
const TAIL_BAND_FROM = 0.12;
const TAIL_BAND_TO = 0.78;
const TAIL_BAND_WIDTH = 0.3;
const TAIL_SCUTE_FROM = 0.04;
const TAIL_SCUTE_TO = 0.6;
const TAIL_SCUTE_HEIGHT = 0.85;
const TAIL_SCUTE_TAPER = 0.45;
const TAIL_SCUTE_HALF = 0.32;

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * A hand does not take the full angle of its forearm. The wrist holds it close
 * to the line of the arm as a whole, which is why a walking figure's hands read
 * as rigid while the forearm swings under them.
 */
function wristAngle(chain: BoneChain): number {
  const alongArm = angleBetween(chain.root, chain.end);
  const alongForearm = angleBetween(chain.joint, chain.end);
  return lerp(alongArm, alongForearm, WRIST_FOLLOW);
}

const WRIST_FOLLOW = 0.3;
/** The far-side limbs sit in the body's shade so the near ones read forward. */
const FAR_LIMB_SHADE = 0.34;
/** Painted at its own ramp, with nothing mixed toward the outline. */
const UNSHADED = 0;

function drawArm(ctx: Ctx, chain: BoneChain, grasp: number, shade: number): void {
  drawLimb(ctx, chain, ARM_SHAPE, shade);
  drawHand(ctx, chain.end, wristAngle(chain), grasp, shade);
}

/**
 * No depth shade on a leg in any view: bare hide reads as one colour or as two
 * different ones, with no subtle middle, and a darkened far leg just looks like
 * the creature is painted in two tones. Edge-on the outline separates them.
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

/** Rim light down the figure's right edge, unifying the parts into one body. */
function drawRimLight(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  ctx.save();
  ctx.globalAlpha = RIM_ALPHA;
  ctx.strokeStyle = RIM_LIGHT;
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineCap = 'round';
  const shoulderHalf = skeleton.shoulderHalf;
  const gut = offset(skeleton.hip, 0, GUT_DROP);
  ctx.beginPath();
  ctx.moveTo(skeleton.shoulderCentre.x + shoulderHalf, skeleton.shoulderCentre.y);
  ctx.quadraticCurveTo(
    skeleton.chest.x + CHEST_HALF * view.girth,
    skeleton.chest.y,
    gut.x + HIP_HALF * view.girth * view.hipDepth,
    gut.y,
  );
  ctx.stroke();
  ctx.restore();
}

const RIM_WIDTH = 0.016;
const SHADOW_RX = 0.36;
const SHADOW_RY = 0.13;
const SHADOW_FOLLOW = 0.6;
const SHADOW_LIFT_SHRINK = 0.55;
const SHADOW_LIFT_FADE = 2.2;
/** Feet turn outward, away from the centreline, on both sides. */
const LEFT_FOOT_OUT = -1;
const RIGHT_FOOT_OUT = 1;
/**
 * How much of the torso's lean the head copies. Near 1 the head buries itself
 * in the shoulders on any leaning pose; a head that stays level keeps the
 * figure reading as one that is looking at something.
 */
const HEAD_LEAN_FOLLOW = 0.3;

function drawFigure(ctx: Ctx, view: ViewSpec, pose: TrogPose): void {
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

  // Behind the legs in every view. From behind it is genuinely the nearer
  // thing, but drawn over them it crosses both shins as one long unbroken
  // diagonal and reads as a blade rather than as a tail; occluded, the same
  // shape reads as going away from the viewer, which is what it is doing.
  drawTail(ctx, skeleton, pose, view);

  // From behind, the snout runs away from the camera behind the creature's own
  // trunk, so it is laid down here — before the body — while the skull carrying
  // it still goes on top of everything at the end.
  const paintHead = (layer: HeadLayer): void => {
    ctx.save();
    ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
    ctx.rotate(skeleton.headAngle);
    ctx.scale(skeleton.headScale, skeleton.headScale);
    drawHead(ctx, pose, view, layer);
    ctx.restore();
  };
  if (view.showsBack) paintHead('behindBody');

  // The figure's left side is the far one. Seen edge-on that arm is genuinely
  // behind the torso; head-on it hangs in front of the trunk like the near one
  // does, and drawing it early is what makes a figure look one-armed.
  const farArmShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  const leftBehind = view.profile || pose.leftArmBehind;
  const rightBehind = !view.profile && pose.rightArmBehind;
  if (leftBehind) drawArm(ctx, skeleton.leftArm, pose.leftGrasp, farArmShade);
  if (rightBehind) drawArm(ctx, skeleton.rightArm, pose.rightGrasp, farArmShade);

  drawLeg(ctx, skeleton.leftLeg, pose.leftFootPitch, view, LEFT_FOOT_OUT, pose.leftLegNearness);
  drawLeg(ctx, skeleton.rightLeg, pose.rightFootPitch, view, RIGHT_FOOT_OUT, pose.rightLegNearness);

  drawNeck(ctx, skeleton.shoulderCentre, skeleton.neckTop, view);
  drawTorso(ctx, skeleton, pose, view);
  // Only edge-on and from behind: head-on the crest is directly behind the
  // skull and the shoulders, and anything drawn for it there is a horn growing
  // out of the creature's face.
  if (view.profile) drawCrest(ctx, skeleton, pose, view);
  drawRimLight(ctx, skeleton, view);

  if (!leftBehind) drawArm(ctx, skeleton.leftArm, pose.leftGrasp, farArmShade);
  if (!rightBehind) drawArm(ctx, skeleton.rightArm, pose.rightGrasp, UNSHADED);

  // The head goes last, over the arms, in every view. This creature's skull is
  // carried out past its own chest by the stoop, so it is genuinely the nearest
  // thing to the camera — and a hand painted over a full gape reads as an arm
  // growing out of the lower jaw. It never raises a hand to its face, so there
  // is nothing this order gets wrong in exchange.
  paintHead('overBody');
}

/** Which of the figure's own shoulders a hand target hangs from. */
export type TrogSide = 'left' | 'right';

/** A solved two-segment limb: where it roots, where it bends, where it ends. */
export interface ArmChain {
  readonly root: Pt;
  readonly joint: Pt;
  readonly end: Pt;
}

/**
 * The arm as the IK actually solved it, hand target and all.
 *
 * A gate that checks a hand *target* against the arm's length asks whether the
 * choreography intended something reachable. This asks whether the solver had
 * to move the hand to reach it — which is the failure itself, and which stays a
 * real question however the target was constructed. Checking the target against
 * the same shoulder it was built from asks nothing at all.
 */
export function solvedArm(pose: TrogPose, view: TrogView, side: TrogSide): ArmChain {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftArm : skeleton.rightArm;
}

/**
 * Where a pose's shoulder joint actually is, in figure space.
 *
 * Choreography that places a hand by a *target* has to measure from here, not
 * from `SHOULDER_Y`: the shoulder rises as the creature crouches and moves
 * forward as it stoops, and a hand hung off the resting height instead ends up
 * at two thirds of the arm's reach. The IK has nowhere to put that third but
 * the elbow, so it bows out sideways — which is what turned the attack windup
 * into a figure standing with its hands on its hips.
 *
 * Both coordinates matter, and the side does too. The two shoulders are only
 * mirror images of each other about the *centreline*, and in profile the stoop
 * carries that centreline forward — so a target built off `y` alone sits on a
 * circle centred where the shoulder is not, and overshoots the arm by up to 7%
 * on the very frames a lunge is sold on.
 *
 * Runs the real rig rather than re-deriving it, so it cannot drift from what
 * the painter does.
 */
export function shoulderJoint(pose: TrogPose, view: TrogView, side: TrogSide): Pt {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftShoulder : skeleton.rightShoulder;
}

/**
 * Where the mouth sits for a given pose, in tile units from the ground origin.
 *
 * The tongue is not baked into the body sheet — it reaches three tiles, which
 * is twenty times the creature's own width — so the runtime anchors a separate
 * rotated overlay here. The pose matters: the head thrusts most of a third of a
 * tile forward over the lash, so an anchor taken from the resting pose leaves
 * the tongue growing out of the creature's chest on the frame it fires.
 */
export function mouthAnchor(view: TrogView, pose: TrogPose): Pt {
  const spec = VIEWS[view];
  const skeleton = buildSkeleton(pose, spec);
  const scale = skeleton.headScale;
  if (spec.profile) {
    return offset(
      skeleton.headCentre,
      HEAD_DEPTH * SNOUT_TIP * MOUTH_ALONG_SNOUT * scale,
      HEAD_RY * (HINGE_Y + JAW_LIP * MOUTH_ANCHOR_DROP) * scale,
    );
  }
  // Head-on the mouth is wherever the turn has swung the muzzle's tip to, which
  // is most of a skull's length off the centreline at a committed yaw. Measured
  // at the head's centre instead, the tongue leaves from behind its own jaw.
  //
  // Same foreshortening the painter uses, because the two have to agree: the
  // gate compares this against the baked art, and a turn drawn one way and
  // measured another puts the tongue's root beside the head it comes out of.
  const yaw = Math.max(-1, Math.min(1, pose.headYaw)) * MAX_HEAD_YAW;
  const facing = Math.sin(yaw) < 0 ? -1 : 1;
  const showing = Math.max(Math.abs(Math.sin(yaw)), MIN_SNOUT_SHOWING);
  const spun = rotate(
    pt(
      HEAD_DEPTH * showing * facing * SNOUT_TIP * MOUTH_ALONG_SNOUT,
      HEAD_RY * (HINGE_Y + JAW_LIP * MOUTH_ANCHOR_DROP),
    ),
    skeleton.headAngle,
  );
  return offset(skeleton.headCentre, spun.x * scale, spun.y * scale);
}

/** How far along the snout the tongue leaves the mouth, edge-on. */
const MOUTH_ALONG_SNOUT = 0.72;
const MOUTH_ANCHOR_DROP = 1.4;

/** Toward the camera. */
export function drawTrogFront(ctx: Ctx, pose: TrogPose): void {
  drawFigure(ctx, VIEWS.front, pose);
}

/** Away from the camera. */
export function drawTrogBack(ctx: Ctx, pose: TrogPose): void {
  drawFigure(ctx, VIEWS.back, pose);
}

/** In profile, always facing +X; the runtime mirrors it for the other side. */
export function drawTrogSide(ctx: Ctx, pose: TrogPose): void {
  drawFigure(ctx, VIEWS.side, pose);
}
