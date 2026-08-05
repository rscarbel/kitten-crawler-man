/**
 * The Hoarder painter — the first boss of the dungeon.
 *
 * A fifteen-foot woman, enormously obese, who vomits cockroaches. Two things
 * have to read before anything else does, and every structure below serves one
 * of them:
 *
 *   1. **Scale.** Height alone does not read as size — a figure drawn twice as
 *      tall just looks like a figure drawn twice as tall. What sells it is the
 *      head being a small fraction of the whole (`HEADS_TALL` 8.3 against a
 *      normal game figure's ~4.8) and the complete absence of small detail
 *      anywhere on the silhouette. Nothing on her is the size of a hand except
 *      her hands.
 *   2. **Bulk.** The outline is a *bell*: sloping shoulders that never square
 *      off, a bust shelf, a belly that is the widest thing about her, and an
 *      apron of lower belly hanging over the waistband of her trousers. Her
 *      arms are held off her sides because her own mass puts them there, and
 *      she has no neck — the jowls run straight into the shoulders.
 *
 * A barrel is the failure mode of any wide figure, and the thing that stops
 * this one being a barrel is that the widest point is low, the shoulders slope,
 * and the clothing deliberately fails to cover her: a filthy vest ridden up
 * under the bust and trousers pushed down under the gut leave the whole belly
 * bare, so the silhouette is broken by two hems and the belly's own fold
 * instead of being one smooth wall of fabric.
 *
 * Coordinates are tile units with the origin at the point between her feet and
 * +Y pointing down the screen, so heights above the ground are negative. The
 * generator translates to that ground point, scales by one tile, and calls one
 * of the three painters. The side view is always drawn facing +X; the runtime
 * mirrors it for the other direction.
 *
 * The rig — the view table, the two-bone IK, and "every pose is an edit to one
 * resting pose" — is taken from
 * `carlArt.ts`, which is the only figure in this game whose movement convinces.
 * The anatomy on top of it is not.
 *
 * This module knows nothing about animation: it paints one pose. The
 * choreography lives in `scripts/generate-hoarder-sprite.ts`.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { type Pt, clamp01, deg, hump, lerp, mix } from './carlArt.js';

export type { Pt };

// ── Small math ───────────────────────────────────────────────────────────────

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

/** Piecewise linear interpolation through a set of (t, value) keys. */
export function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  for (let i = 1; i < keys.length; i++) {
    const previous = keys[i - 1];
    const next = keys[i];
    if (previous === undefined || next === undefined) break;
    if (t <= next[0])
      return lerp(previous[1], next[1], (t - previous[0]) / (next[0] - previous[0]));
  }
  const last = keys[keys.length - 1];
  return last === undefined ? 0 : last[1];
}

interface Ramp {
  readonly light: string;
  readonly mid: string;
  readonly dark: string;
}

// ── Palette ──────────────────────────────────────────────────────────────────

const OUTLINE = '#2a1a14';

/**
 * Doughy and bloodless. A healthy skin ramp on a body this size reads as a
 * beach ball; the value range here is narrow and the hue drifts yellow-grey in
 * the shadows, which is what makes the mass look soft rather than inflated.
 */
const SKIN: Ramp = {
  light: '#f0d0b8',
  mid: '#d8ab93',
  dark: '#a97a68',
};

/** Raw, rubbed-red skin, painted into the deep folds and under the arms. */
const CHAFE = '#c4685f';
/** The sallow cast around a mouth that spends its day full of bile. */
const SALLOW = '#c2bd82';

/** A vest that used to be white. */
const VEST: Ramp = {
  light: '#9c9179',
  mid: '#7a7059',
  dark: '#453f31',
};

const TROUSERS: Ramp = {
  light: '#5c5445',
  mid: '#413b31',
  dark: '#241f19',
};

const SLIPPER: Ramp = {
  light: '#8a6047',
  mid: '#5f4130',
  dark: '#33221a',
};

/** Lank and unwashed: barely any value range, so it reads as flat and greasy. */
const HAIR: Ramp = {
  light: '#8d7b5f',
  mid: '#6a5a43',
  dark: '#443a2c',
};

const BILE_BRIGHT = '#cad65e';
const BILE_MID = '#96a334';

const STAIN_BILE = 'rgba(120,128,54,0.5)';
const STAIN_GRIME = 'rgba(70,58,38,0.5)';

/**
 * Far brighter than the face it sits in. Her eyes survive to the 32px tile as
 * two device pixels or they do not survive at all, and two pixels only register
 * on a value break: against a face at luminance 179 this sits at 236.
 */
const EYE_WHITE = '#f4eee2';
const IRIS = '#2c2015';
const EYE_GLINT = '#fbf7ee';
const MOUTH_INNER = '#3a161a';
const THROAT_DARK = '#210c0f';
const TOOTH = '#c9bb92';
const TONGUE = '#a45a58';

const RIM_LIGHT = '#e6d4b6';
const RIM_ALPHA = 0.2;
const SHEEN_ALPHA = 0.26;
const CREASE_ALPHA = 0.4;
const CONTACT_SHADOW_ALPHA = 0.3;
/**
 * node-canvas drops an `rgba()` whose alpha serialises in exponent notation, so
 * a computed alpha that decays toward zero has to be snapped to zero before it
 * gets there or the whole colour is discarded and the shape bakes solid.
 */
const MIN_ALPHA = 1e-3;

function alpha(value: number): number {
  return value < MIN_ALPHA ? 0 : value;
}

// ── Proportions, in tile units ───────────────────────────────────────────────

/**
 * Her height as authored. The generator scales this to however many tiles she
 * is meant to stand on screen, so the anatomy below never has to move when the
 * size is retuned.
 */
export const FIGURE_HEIGHT = 2.4;

/**
 * One pixel of the baked sheet, in figure units. The generator draws a tile at
 * 64px and scales the figure by `HOARDER_TILES_TALL / FIGURE_HEIGHT`, which
 * comes to 96 sheet pixels per unit. Every constant below that came out of a
 * measurement on a rendered image is written against this rather than as a bare
 * fraction, so the number in the code is the number the review asked for.
 */
const SHEET_PX = 1 / 96;

/**
 * The single most load-bearing number on the figure. The brain sizes a humanoid
 * by counting heads into it: at five heads it reads as a toddler, and a toddler
 * scaled up reads as a doll rather than as a giant. A stylised game figure is
 * drawn at ~4.8 heads *because* it is meant to read as a person; she must not.
 *
 * Three independent blind reviews of this sheet asked for a smaller head, in
 * that order, before they asked for anything else. It is the one proportion no
 * amount of detail elsewhere can recover.
 */
const HEADS_TALL = 8.3;
const HEAD_HEIGHT = FIGURE_HEIGHT / HEADS_TALL;
export const HEAD_RY = HEAD_HEIGHT / 2;
/** A fat face is wide for its height, so this runs far closer to 1 than Carl's. */
const HEAD_WIDTH_RATIO = 0.88;
export const HEAD_RX = HEAD_RY * HEAD_WIDTH_RATIO;
/**
 * In profile the skull is deeper than it is wide — the occiput behind and the
 * nose in front. Drawn at the same radius as the front view the profile head is
 * a symmetric egg, and a symmetric egg has no direction: which way she faces
 * becomes a coin flip that only the feet resolve.
 */
const HEAD_DEPTH_RATIO = 1.1;
const HEAD_DEPTH = HEAD_RY * HEAD_DEPTH_RATIO;

/**
 * Keeps a fully extended limb off a dead straight line. Tiny, because the
 * joint's sideways travel grows as the square root of it.
 */
const JOINT_SLACK = 0.0003;
const LEG_SLACK = 1.004;

const ANKLE_Y = -0.14;
const KNEE_Y = -0.6;
/**
 * Her hips sit low for her height — short legs under a long body is most of
 * what separates a giant from a tall person. Set against `ANKLE_Y` this leaves
 * the standing leg 0.024 of reach in hand, which the stride spends.
 */
const HIP_Y = -1.02;
const BELLY_Y = -1.15;
const WAIST_Y = -1.52;
const BUST_Y = -1.7;
export const SHOULDER_Y = -1.98;
const HEAD_CENTRE_Y = -2.24;
const NECK_TOP_Y = HEAD_CENTRE_Y + HEAD_RY * 0.72;

export const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * LEG_SLACK;
export const SHIN_LENGTH = Math.abs(KNEE_Y - ANKLE_Y) * LEG_SLACK;
export const LEG_REACH = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

export const UPPER_ARM_LENGTH = 0.44;
export const FOREARM_LENGTH = 0.38;
export const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;
export const SHOULDER_JOINT_DROP = 0.07;

/**
 * Wide enough that the arm root does not step out past the torso in one row of
 * pixels. Measured on a render the body gained 40 sheet pixels of width in 2.3
 * of height at the shoulder, which is what a coat hanger looks like.
 */
const SHOULDER_HALF = 0.42;
const BUST_HALF = 0.54;
/** The widest point on the whole figure, and it is below the middle of her. */
export const BELLY_HALF = 0.66;
const HIP_HALF = 0.56;
const LEG_ROOT_HALF = 0.21;
const ARM_INSET = 0.86;
export const ARM_ROOT_HALF = SHOULDER_HALF * ARM_INSET;

/**
 * Her stance width comes from the thighs, not from where her feet are: the feet
 * have to stay under the hip roots or the leg is asked to reach further than it
 * is long. Two thighs this wide, rooted this close together, touch — which is
 * the point.
 */
export const THIGH_WIDTH = 0.32;
export const KNEE_WIDTH = 0.2;
export const CALF_WIDTH = 0.23;
/**
 * Her calf is enormous and her ankle is not. It was wider than the whole
 * slipper below it, so she stood on pegs; the taper has to run calf → ankle →
 * foot outward, never inward.
 */
export const ANKLE_WIDTH = 0.05;
const CALF_AT = 0.34;

/**
 * A third of the torso's width, not most of it. At the previous value the arms
 * were columns as wide as her ribcage, so the figure read as three parallel
 * masses rather than as a body with limbs on it.
 */
export const UPPER_ARM_WIDTH = 0.125;
export const ELBOW_WIDTH = 0.095;
export const WRIST_WIDTH = 0.068;

/**
 * She has no neck to speak of, but the column still has to be narrower than her
 * head or the head stops being a separate shape and the whole silhouette runs
 * together from crown to hip.
 */
const NECK_WIDTH = HEAD_RX * 0.62;

export const FOOT_LENGTH = FIGURE_HEIGHT * 0.082;
export const FOOT_DEPTH = FOOT_LENGTH * 0.52;
/**
 * Head-on the foot is nearly end-on, so almost all of its length is lost and
 * only its breadth survives. Two numbers rather than one: foreshortening the
 * breadth as hard as the length gives a doll's foot, and foreshortening neither
 * gives the 24-pixel paddle the first pass had.
 */
const FOOT_FORESHORTEN = 0.62;
const FOOT_FACING_BREADTH = 0.72;

/** Direction the key light comes from, in figure space. */
const LIGHT: Pt = { x: -0.6, y: -0.8 };

// ── Views ────────────────────────────────────────────────────────────────────

export type HoarderView = 'front' | 'back' | 'side';

interface ViewSpec {
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
  /** Multiplier on the torso's drawn width. */
  readonly girth: number;
  /**
   * How far the belly protrudes relative to how wide it is. A body this size is
   * *deeper* than it is broad through the gut, so unlike every other width this
   * one grows rather than shrinks going into profile.
   */
  readonly bellyDepth: number;
  /** Extra trim on the hips, which are less deep than they are wide. */
  readonly hipDepth: number;
  /** Narrows the chest without touching the belly. */
  readonly chestTaper: number;
  /** How far apart the two shoulder joints are drawn. */
  readonly armSpread: number;
  /** True when the figure is seen edge-on rather than head-on. */
  readonly profile: boolean;
  /** True when the face is toward the camera. */
  readonly showsFace: boolean;
  /** True when the back of the head and the vest's back panel are shown. */
  readonly showsBack: boolean;
}

const PROFILE_LATERAL = 0.3;
const PROFILE_GIRTH = 0.86;
const PROFILE_BELLY_DEPTH = 1.18;
const PROFILE_HIP_DEPTH = 0.88;
const PROFILE_CHEST_TAPER = 0.92;
const PROFILE_ARM_SPREAD = 0.14;

const VIEWS: Record<HoarderView, ViewSpec> = {
  front: {
    lateral: 1,
    girth: 1,
    bellyDepth: 1,
    hipDepth: 1,
    chestTaper: 1,
    armSpread: 1,
    profile: false,
    showsFace: true,
    showsBack: false,
  },
  back: {
    lateral: 1,
    girth: 1,
    bellyDepth: 1,
    hipDepth: 1,
    chestTaper: 1,
    armSpread: 1,
    profile: false,
    showsFace: false,
    showsBack: true,
  },
  side: {
    lateral: PROFILE_LATERAL,
    girth: PROFILE_GIRTH,
    bellyDepth: PROFILE_BELLY_DEPTH,
    hipDepth: PROFILE_HIP_DEPTH,
    chestTaper: PROFILE_CHEST_TAPER,
    armSpread: PROFILE_ARM_SPREAD,
    profile: true,
    showsFace: true,
    showsBack: false,
  },
};

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * One frame of the Hoarder. Hand and foot positions are targets in figure space
 * that the limb solver reaches for, so the choreography never has to think
 * about joint angles. `left`/`right` are her own left and right; in the profile
 * view the right side is the near one.
 */
export interface HoarderPose {
  /** Whole-body vertical offset; negative lifts her off the ground. */
  bob: number;
  /** Hip shift along X — weight transfer, not a step. */
  sway: number;
  /** Torso lean in radians; positive tips the shoulders toward +X. */
  lean: number;
  /**
   * Stretch of everything above the hip, as a fraction of its height. Positive
   * draws her up — the anticipation before a heave — and negative folds her
   * down into it. Head-on there is no lean and no stride to see, so this is the
   * only axis a wind-up can play on at all.
   */
  torsoLift: number;
  /** 0 stands tall, 1 sinks into as deep a crouch as she can manage. */
  crouch: number;
  /** Shoulder rotation about the spine, −1 to 1, seen as a width shift. */
  twist: number;
  /** Head turn, −1 to 1; in the front view it slides the face across. */
  headTurn: number;
  /** Head tilt in radians. */
  headTilt: number;
  /** 0 neutral, 1 the full glare. */
  brow: number;
  /** 0 closed mouth, 1 the jaw fully unhinged mid-spew. */
  mouth: number;
  /** 0 eyes open, 1 shut. */
  blink: number;
  /**
   * How hard the gut is convulsing, 0 to 1. It swells, rides up under the ribs
   * and drags the fold of the apron with it — the wind-up the whole vomit
   * telegraph is built on.
   */
  bellyHeave: number;
  /**
   * Where a bolus has got to on its way up the throat, 0 at the stomach and 1
   * at the mouth, or −1 for no bolus. Visible as a lump travelling up the
   * column of her neck, and it is the clearest single frame-to-frame cue that
   * something is about to come out.
   */
  throatBolus: number;
  /** Lateral wobble of the belly mass, lagging the hips. */
  bellySwing: number;
  /** Length of the bile string hanging from her mouth, 0 to 1. */
  drool: number;
  /**
   * How much bile is leaving her mouth this frame, 0 to 1. The projectile the
   * fight spawns is a separate sprite, and without something joining her mouth
   * to it on the frames around the release the bile pops into existence
   * detached from her and the attack reads as having no source.
   */
  spray: number;
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
  /** +1 bows a knee away from the centreline, −1 folds it the other way. */
  leftKneeBreak: number;
  rightKneeBreak: number;
  /** How much a leg points at the camera rather than across it, 0 to 1. */
  leftForeshorten: number;
  rightForeshorten: number;
  /** How much nearer the camera a leg's shin is than its thigh, 0 to 1. */
  leftLegNearness: number;
  rightLegNearness: number;
  /** Sideways drift of the hair, −1 to 1. */
  hairFlow: number;
  /**
   * Which way the elbows break: behind the body, or in front of it. A boolean
   * because only the direction was ever used — typed as a number, three
   * separately tuned values in the choreography produced identical output and
   * anyone adjusting the magnitude saw nothing change until they crossed zero.
   */
  elbowsBack: boolean;
  /** Whether an arm is on the far side of the torso and so drawn before it. */
  leftArmBehind: boolean;
  rightArmBehind: boolean;
}

/**
 * Her arms cannot hang at her sides — the belly is in the way — so a resting
 * hand sits *outside* the widest part of her, resting on top of the gut, and
 * the slack that leaves in the arm bows the elbow outward, which is what a fat
 * arm does. Set anywhere inside `BELLY_HALF` the whole forearm disappears into
 * the silhouette and she loses her arms at tile size.
 */
export const RESTING_HAND_SPREAD = BELLY_HALF * 1.12;
const RESTING_HAND_Y = BELLY_Y + 0.05;
const RESTING_HAND_DROP = RESTING_HAND_Y - SHOULDER_Y;
/** Feet apart, because her thighs cannot pass each other. */
const RESTING_FOOT_SPREAD = 0.24;
const RESTING_FOOT_TURNOUT = deg(0);
const RESTING_BROW = 0.5;

/** A relaxed standing pose. Every animation is written as edits to this. */
export function restingPose(): HoarderPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    torsoLift: 0,
    crouch: 0,
    twist: 0,
    headTurn: 0,
    headTilt: 0,
    brow: RESTING_BROW,
    mouth: 0,
    blink: 0,
    bellyHeave: 0,
    throatBolus: -1,
    bellySwing: 0,
    drool: 0,
    spray: 0,
    leftHand: pt(-RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    rightHand: pt(RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    leftFoot: pt(-RESTING_FOOT_SPREAD, 0),
    rightFoot: pt(RESTING_FOOT_SPREAD, 0),
    leftFist: 0.25,
    rightFist: 0.25,
    leftFootPitch: RESTING_FOOT_TURNOUT,
    rightFootPitch: RESTING_FOOT_TURNOUT,
    leftKneeBreak: 1,
    rightKneeBreak: 1,
    leftForeshorten: 0,
    rightForeshorten: 0,
    leftLegNearness: 0,
    rightLegNearness: 0,
    hairFlow: 0,
    elbowsBack: false,
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

interface Skeleton {
  hip: Pt;
  belly: Pt;
  waist: Pt;
  bust: Pt;
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
const CROUCH_DROP = 0.22;
/** Facing +X, a knee that bends toward +X is bending forward. */
const PROFILE_KNEE_FORWARD = -1;
const TWIST_WIDTH_GAIN = 0.14;
const TWIST_SHOULDER_SHIFT = 0.05;
/**
 * The bust shelf sits fractionally below where `BUST_Y` alone would put it: the
 * spine leans, and a shelf placed at its full height swings out past the
 * shoulder on any leaning pose.
 */
const CHEST_ALONG_SPINE_LIFT = 0.97;

/**
 * Places a two-segment limb so its end sits on `target`. `bendSign` picks which
 * side the joint pops out to.
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

const KNEE_ALONG_LEG = THIGH_LENGTH / (THIGH_LENGTH + SHIN_LENGTH);

/** Pulls a solved leg's knee back onto the hip→ankle line by `amount`. */
function foreshortenLeg(chain: BoneChain, amount: number): BoneChain {
  if (amount <= 0) return chain;
  const straightKnee = mixPt(chain.root, chain.end, KNEE_ALONG_LEG);
  return { ...chain, joint: mixPt(chain.joint, straightKnee, clamp01(amount)) };
}

/** The ankle for a foot planted at `target`: up the leg by the foot's height. */
function ankleFor(target: Pt, pitch: number): Pt {
  const lifted = rotate({ x: 0, y: ANKLE_Y }, -pitch);
  return offset(target, lifted.x, lifted.y);
}

/** Offset from the hip to a point `height` up the leaning spine. */
function spinePoint(hip: Pt, height: number, lean: number): Pt {
  const rotated = rotate({ x: 0, y: -height }, lean);
  return offset(hip, rotated.x, rotated.y);
}

function buildSkeleton(pose: HoarderPose, view: ViewSpec): Skeleton {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);
  const spine = 1 + pose.torsoLift;

  const belly = offset(
    spinePoint(hip, Math.abs(BELLY_Y - HIP_Y) * spine, pose.lean),
    pose.bellySwing * view.lateral,
    0,
  );
  const waist = spinePoint(hip, Math.abs(WAIST_Y - HIP_Y) * spine, pose.lean);
  const bust = spinePoint(
    hip,
    Math.abs(BUST_Y - HIP_Y) * CHEST_ALONG_SPINE_LIFT * spine,
    pose.lean,
  );
  const shoulderCentre = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y) * spine, pose.lean);
  const neck = spinePoint(hip, Math.abs(NECK_TOP_Y - HIP_Y) * spine, pose.lean);
  const headCentre = offset(
    spinePoint(hip, Math.abs(HEAD_CENTRE_Y - HIP_Y) * spine, pose.lean),
    pose.headTurn * HEAD_RX * view.lateral * 0.5,
    0,
  );

  const shoulderHalf = SHOULDER_HALF * view.girth;
  const twistShift = pose.twist * TWIST_SHOULDER_SHIFT * view.lateral;
  const armRoot = ARM_ROOT_HALF * view.armSpread;
  const leftHalf = armRoot * (1 - pose.twist * TWIST_WIDTH_GAIN);
  const rightHalf = armRoot * (1 + pose.twist * TWIST_WIDTH_GAIN);

  const leftShoulder = offset(shoulderCentre, -leftHalf + twistShift, SHOULDER_JOINT_DROP);
  const rightShoulder = offset(shoulderCentre, rightHalf + twistShift, SHOULDER_JOINT_DROP);
  const hipHalf = LEG_ROOT_HALF * view.lateral;

  return {
    hip,
    belly,
    waist,
    bust,
    shoulderCentre,
    neck,
    headCentre,
    leftShoulder,
    rightShoulder,
    shoulderHalf,
    // A standing knee breaks away from the centreline; edge-on that rule would
    // send the two knees in opposite directions and hinge one of them backward,
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
    leftArm: solveTwoBone(
      leftShoulder,
      pose.leftHand,
      UPPER_ARM_LENGTH,
      FOREARM_LENGTH,
      pose.elbowsBack ? -1 : 1,
    ),
    rightArm: solveTwoBone(
      rightShoulder,
      pose.rightHand,
      UPPER_ARM_LENGTH,
      FOREARM_LENGTH,
      pose.elbowsBack ? 1 : -1,
    ),
  };
}

// ── Low-level painting ───────────────────────────────────────────────────────

const OUTLINE_BLEED = 0.016;

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

function outlineCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number, grow = 0): void {
  fillCapsule(ctx, a, b, wa + OUTLINE_BLEED + grow, wb + OUTLINE_BLEED + grow, OUTLINE);
}

/** A lit streak laid down one side of a limb segment. */
const SHEEN_OFFSET = 0.42;
const SHEEN_WIDTH = 0.32;
const SHEEN_TAPER = 0.68;

function sheenSegment(ctx: Ctx, a: Pt, b: Pt, width: number, colour: string, amount: number): void {
  const angle = angleBetween(a, b);
  const normal = angle + HALF_PI;
  const towardLight = Math.cos(normal) * LIGHT.x + Math.sin(normal) * LIGHT.y;
  const side = towardLight >= 0 ? 1 : -1;
  const dx = Math.cos(normal) * width * SHEEN_OFFSET * side;
  const dy = Math.sin(normal) * width * SHEEN_OFFSET * side;
  ctx.globalAlpha = alpha(amount);
  fillCapsule(
    ctx,
    offset(a, dx, dy),
    offset(b, dx * SHEEN_TAPER, dy * SHEEN_TAPER),
    width * SHEEN_WIDTH,
    width * SHEEN_WIDTH * SHEEN_TAPER,
    colour,
  );
  ctx.globalAlpha = 1;
}

/**
 * A fold of fat, drawn as two lenses rather than as two strokes. A stroke has
 * the same weight at its ends as in its middle, so it runs into the silhouette
 * and reads as a seam in cloth; a lens tapers to nothing well inside the
 * outline, which is what a roll of fat actually does.
 *
 * The two halves are deliberately unlike: the shadow under the fold is wide and
 * soft because it is an occlusion, and the lit lip above it is thin and hard
 * because it is a highlight on a rolled edge. Matched, they read as a stripe.
 */
const CREASE_LIP_OFFSET = 0.55;
const CREASE_LIP_ALPHA = 1.5;
const CREASE_LIP_THICKNESS = 0.34;

function fillLens(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  control: Pt,
  halfThickness: number,
  colour: string,
  amount: number,
): void {
  ctx.globalAlpha = alpha(amount);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(control.x, control.y + halfThickness, to.x, to.y);
  ctx.quadraticCurveTo(control.x, control.y - halfThickness, from.x, from.y);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawCrease(ctx: Ctx, from: Pt, to: Pt, sag: number, thickness: number): void {
  const mid = mixPt(from, to, 0.5);
  const control = offset(mid, 0, sag);
  fillLens(ctx, from, to, control, thickness, OUTLINE, CREASE_ALPHA);

  const lift = thickness * CREASE_LIP_OFFSET;
  fillLens(
    ctx,
    offset(from, 0, -lift),
    offset(to, 0, -lift),
    offset(control, 0, -lift),
    thickness * CREASE_LIP_THICKNESS,
    SKIN.light,
    CREASE_ALPHA * CREASE_LIP_ALPHA,
  );
}

/** Soft elliptical shadow under the figure. */
const SHADOW_RX = BELLY_HALF * 1.15;
const SHADOW_RY = SHADOW_RX * 0.3;
const SHADOW_Y = -0.01;
const SHADOW_FOLLOW = 0.5;

function drawGroundShadow(ctx: Ctx, cx: number, rx: number, ry: number, amount: number): void {
  ctx.globalAlpha = alpha(amount);
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(cx, SHADOW_Y, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ── Limbs ────────────────────────────────────────────────────────────────────

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
  belly: ELBOW_WIDTH * 1.05,
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

/** A leg swung toward the camera reads *wider* below the knee, not shorter. */
const NEAR_LEG_SHAPE: LimbShape = {
  root: THIGH_WIDTH,
  joint: THIGH_WIDTH * 0.92,
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

const FAR_LIMB_SHADE = 0.22;
const UNSHADED = 0;

/**
 * Paints a solved limb: outline, flesh, then a sheen down the lit edge. The
 * lower segment is drawn in two pieces so the joint can pinch in and the belly
 * of the segment swell back out below it — one taper makes a limb a traffic
 * cone.
 */
function drawLimb(
  ctx: Ctx,
  chain: BoneChain,
  shape: LimbShape,
  ramp: Ramp,
  shade: number,
  outlineGrow = 0,
): void {
  const belly = mixPt(chain.joint, chain.end, shape.bellyAt);
  const flesh = mix(ramp.mid, OUTLINE, shade);
  const lit = mix(ramp.light, OUTLINE, shade);

  outlineCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint, outlineGrow);
  outlineCapsule(ctx, chain.joint, belly, shape.joint, shape.belly, outlineGrow);
  outlineCapsule(ctx, belly, chain.end, shape.belly, shape.tip, outlineGrow);

  fillCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint, flesh);
  fillCapsule(ctx, chain.joint, belly, shape.joint, shape.belly, flesh);
  fillCapsule(ctx, belly, chain.end, shape.belly, shape.tip, flesh);

  sheenSegment(ctx, chain.root, chain.joint, shape.root, lit, SHEEN_ALPHA);
  sheenSegment(ctx, chain.joint, chain.end, shape.belly, lit, SHEEN_ALPHA);
}

/**
 * The crease at the elbow and the one at the back of the knee. On a limb this
 * heavy the joint is a dimple in a column of fat, and without it the arm reads
 * as a sausage.
 */
const JOINT_DIMPLE_SPAN = 0.62;
const JOINT_DIMPLE_SAG = 0.02;
const JOINT_DIMPLE_THICKNESS = 0.022;

function drawJointDimple(ctx: Ctx, chain: BoneChain, width: number): void {
  const along = angleBetween(chain.root, chain.joint) + HALF_PI;
  const nx = Math.cos(along) * width * JOINT_DIMPLE_SPAN;
  const ny = Math.sin(along) * width * JOINT_DIMPLE_SPAN;
  drawCrease(
    ctx,
    offset(chain.joint, -nx, -ny),
    offset(chain.joint, nx, ny),
    JOINT_DIMPLE_SAG,
    JOINT_DIMPLE_THICKNESS,
  );
}

// ── Hands ────────────────────────────────────────────────────────────────────

/**
 * A hand is derived from its own forearm, never from the head. Hung off the
 * head — the usual "a hand is as long as the face" — it came out at 12% of her
 * height against a human's 4.5% and read as a mitten on the end of a sleeve.
 * This puts her whole hand at eleven sheet pixels from wrist to fingertip.
 */
export const HAND_LENGTH = FOREARM_LENGTH * 0.3;
const HAND_WIDTH_RATIO = 0.86;
const FIST_WIDTH_RATIO = 1;
/**
 * Two divisions, not three. Three collides with the toe motif on her burst
 * slippers, and at the tile downscale the two read as the same creature part.
 */
const FINGER_LOBE_COUNT = 3;
const FINGER_SPLAY = 0.4;
/** The thumb has to be its own mass or the hand is a mitten however round it is. */
const THUMB_RADIUS = 3 * SHEET_PX;
const THUMB_SHADE = 0.3;
const KNUCKLE_ALPHA = 0.3;
/** A hand keeps most of the line of the whole arm, not of the forearm alone. */
const HAND_FOLLOW_FOREARM = 0.3;

function drawHand(ctx: Ctx, chain: BoneChain, fist: number, thumbSide: number, ramp: Ramp): void {
  const armLine = angleBetween(chain.root, chain.end);
  const foreLine = angleBetween(chain.joint, chain.end);
  const angleDelta = ((foreLine - armLine + Math.PI * 3) % TWO_PI) - Math.PI;
  const angle = armLine + angleDelta * HAND_FOLLOW_FOREARM;

  const closed = clamp01(fist);
  const length = HAND_LENGTH * lerp(1, 0.78, closed);
  const width = HAND_LENGTH * lerp(HAND_WIDTH_RATIO, FIST_WIDTH_RATIO, closed);
  const palmAt = length * 0.42;
  const palmRx = length * 0.46;
  const fingerRadius = width * 0.22;
  const fingerReach = length * lerp(0.82, 0.6, closed) - fingerRadius;
  const thumbAt = pt(length * 0.24, thumbSide * width * lerp(0.6, 0.44, closed));

  ctx.save();
  ctx.translate(chain.end.x, chain.end.y);
  ctx.rotate(angle);

  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(palmAt, 0, palmRx + OUTLINE_BLEED, width * 0.5 + OUTLINE_BLEED, 0, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = ramp.mid;
  ctx.beginPath();
  ctx.ellipse(palmAt, 0, palmRx, width * 0.5, 0, 0, TWO_PI);
  ctx.fill();

  // Sausage fingers as bumps on the far edge rather than as separate strokes:
  // drawn as lines they read as sandal straps at any size this sheet is seen at.
  for (let i = 0; i < FINGER_LOBE_COUNT; i++) {
    const share = i / (FINGER_LOBE_COUNT - 1);
    const spread = (share - 0.5) * width * FINGER_SPLAY * 2;
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(fingerReach, spread, fingerRadius + OUTLINE_BLEED, 0, TWO_PI);
    ctx.fill();
  }
  for (let i = 0; i < FINGER_LOBE_COUNT; i++) {
    const share = i / (FINGER_LOBE_COUNT - 1);
    const spread = (share - 0.5) * width * FINGER_SPLAY * 2;
    ctx.fillStyle = ramp.mid;
    ctx.beginPath();
    ctx.arc(fingerReach, spread, fingerRadius, 0, TWO_PI);
    ctx.fill();
  }

  // The thumb rides on the inboard edge and tucks with the rest of the hand.
  // Painted *after* the palm, because the palm's own fill buries the thumb's
  // outline where the two overlap and a thumb without an outline against a palm
  // of the same colour is not a thumb, it is a mitten.
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(thumbAt.x, thumbAt.y, THUMB_RADIUS + OUTLINE_BLEED, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = mix(ramp.mid, ramp.dark, THUMB_SHADE);
  ctx.beginPath();
  ctx.arc(thumbAt.x, thumbAt.y, THUMB_RADIUS, 0, TWO_PI);
  ctx.fill();

  ctx.globalAlpha = alpha(KNUCKLE_ALPHA * closed);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width * 0.09;
  ctx.beginPath();
  ctx.moveTo(palmAt + palmRx * 0.5, -width * 0.34);
  ctx.lineTo(palmAt + palmRx * 0.5, width * 0.34);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

// ── Feet ─────────────────────────────────────────────────────────────────────

const SLIPPER_SPLIT_ALPHA = 0.45;
const TOE_BULGE_COUNT = 3;
const FOOT_HEEL_SHARE = 0.55;
const FOOT_TOE_SHARE = 0.46;

/**
 * A burst slipper with the toes coming out of the front. The split is what
 * makes the foot read as *hers* rather than as a shoe, and it is drawn as a gap
 * in the slipper's own outline instead of as a line on top of it.
 *
 * The foot's span is measured end to end rather than built out of a heel and a
 * toe hung off a centre: a capsule from heel to toe is *longer* than the foot
 * by a whole cap radius at each end, which head-on — where the foot is drawn
 * lying across the screen — made it half again as wide as it should be.
 */
function drawFoot(ctx: Ctx, ankle: Pt, pitch: number, view: ViewSpec, turnOut: number): void {
  const breadth = view.profile ? FOOT_DEPTH : FOOT_DEPTH * FOOT_FACING_BREADTH;
  const span = view.profile ? FOOT_LENGTH : FOOT_LENGTH * FOOT_FORESHORTEN;
  const lead = view.profile ? 1 : turnOut;
  const heelRadius = breadth * FOOT_HEEL_SHARE;
  const toeRadius = breadth * FOOT_TOE_SHARE;

  // Drawn centred on the ankle the sole floats the ankle's own height above the
  // floor, so every frame stands that far off the ground line the manifest
  // declares. The foot is dropped until its underside touches instead.
  const soleDrop = Math.abs(ANKLE_Y) - heelRadius;

  ctx.save();
  ctx.translate(ankle.x, ankle.y + soleDrop);
  ctx.rotate(pitch);

  const heel = pt(-(span / 2 - heelRadius) * lead, 0);
  const toe = pt((span / 2 - toeRadius) * lead, 0);

  outlineCapsule(ctx, heel, toe, heelRadius, toeRadius);
  fillCapsule(ctx, heel, toe, heelRadius, toeRadius, SLIPPER.mid);
  fillCapsule(ctx, heel, mixPt(heel, toe, 0.45), heelRadius, heelRadius * 0.9, SLIPPER.light);

  ctx.globalAlpha = alpha(SLIPPER_SPLIT_ALPHA);
  ctx.strokeStyle = SLIPPER.dark;
  ctx.lineWidth = breadth * 0.14;
  ctx.beginPath();
  ctx.moveTo(mixPt(heel, toe, 0.5).x, -breadth * 0.3);
  ctx.lineTo(mixPt(heel, toe, 0.58).x, breadth * 0.3);
  ctx.stroke();
  ctx.globalAlpha = 1;

  for (let i = 0; i < TOE_BULGE_COUNT; i++) {
    const share = i / (TOE_BULGE_COUNT - 1);
    const across = (share - 0.5) * breadth * 0.8;
    ctx.fillStyle = SKIN.mid;
    ctx.beginPath();
    ctx.arc(toe.x + toeRadius * 0.2 * lead, across, breadth * 0.16, 0, TWO_PI);
    ctx.fill();
  }

  ctx.restore();
}

// ── Torso ────────────────────────────────────────────────────────────────────

/**
 * The width of the body at one height. Head-on the two sides are `half`; edge-on
 * the gut leads by `front` and the backside trails by `back`, which are not the
 * same number and never were — a profile built by scaling one half-width gives
 * a figure with a belly and no arse.
 */
interface TorsoStation {
  readonly y: number;
  readonly half: number;
  readonly front: number;
  readonly back: number;
}

/**
 * The silhouette, station by station from the shoulders down to the bottom of
 * the apron.
 *
 * Two things in here are the whole read and neither is an endpoint:
 *
 *  - the **bust**, which is a local maximum. Without one the width climbs
 *    monotonically from neck to belly and the outline is a traffic cone; with
 *    one there is a swell, an under-bust pinch and then the flare, which is the
 *    only thing on the figure that says *woman*.
 *  - the **apron's widest point sitting low**, at two thirds of the way down
 *    rather than at the middle, and hanging *below* the hips. A mass centred at
 *    the waist is a barrel.
 */
/**
 * Where the overhang stops. Below this the thighs carry the silhouette, and the
 * apron hanging past the hips is what separates a fat body from a wide one.
 */
const APRON_BOTTOM_Y = -0.78;

/**
 * Stations are spaced evenly enough that no span has to make up a width the
 * ones around it did not, and no two are closer in height than the width step
 * between them. Both are the same rule seen twice: what the eye reads as a
 * corner is not a steep edge, it is a *change* of steepness packed into no
 * height at all. G14 measures the turn radius the spline through these actually
 * produces, which is several times tighter than the polygon they describe.
 */
const TORSO_STATIONS: readonly TorsoStation[] = [
  { y: SHOULDER_Y, half: SHOULDER_HALF, front: 0.26, back: 0.2 },
  { y: -1.85, half: 0.46, front: 0.34, back: 0.245 },
  // The bust's own front depth and the shallow dip under it are the only place
  // on the whole outline that says *woman*, and edge-on is the only view where
  // the arms are not in front of it. The dip is deliberately gentle: a crease
  // belongs in the shading, and cut into the silhouette instead it reads as a
  // notch taken out of her rather than as flesh resting on flesh.
  { y: BUST_Y, half: BUST_HALF, front: 0.48, back: 0.27 },
  { y: WAIST_Y, half: 0.575, front: 0.515, back: 0.3 },
  // A station between the under-bust dip and the gut. Without it the spline has
  // to climb a quarter of her depth in one span and the belly comes out as a
  // shelf with a corner on it rather than as a curve.
  { y: -1.34, half: 0.625, front: 0.585, back: 0.33 },
  { y: BELLY_Y, half: BELLY_HALF, front: 0.65, back: 0.36 },
  // The widest point of her, and it is level with the hip rather than the waist:
  // a mass centred at the waist is a barrel.
  { y: HIP_Y, half: 0.675, front: 0.657, back: 0.41 },
  // The apron tucks in below the hip across three stations rather than one.
  // Taken in a single span it closes on a crisp flared curve across the top of
  // the trousers, and a crisp flared curve over a dark leg is read as the hem of
  // a skirt rather than as the bottom of her. Each station takes about the same
  // share of the turn, which is what keeps the tuck a curve at every point on it
  // instead of a straight run into one corner.
  { y: -0.94, half: 0.655, front: 0.637, back: 0.404 },
  { y: -0.86, half: 0.605, front: 0.589, back: 0.378 },
  { y: APRON_BOTTOM_Y, half: 0.525, front: 0.511, back: 0.336 },
];

/** How much lower the centre of the apron hangs than its flanks. */
const APRON_HANG = 0.14;
/** How far the trapezius rises above the shoulder line before the neck. */
const SHOULDER_RISE = 0.06;
const SHOULDER_SLOPE_PULL = 0.55;
const NECK_NOTCH_WIDEN = 1.25;
/** How far the belly swells and rides up at the peak of a heave. */
const BELLY_HEAVE_SWELL = 1.09;
const BELLY_HEAVE_RISE = -0.05;
/**
 * Over what height the belly's heave and its swing fade in. The heave is all
 * gut and nothing at the bust; the swing keeps `BELLY_SWING_UPPER_SHARE` up
 * there, because a chest riding over a swinging gut does move, just less.
 *
 * This used to be a boolean on `station.y > WAIST_Y`, and a boolean is a step. A
 * heave then lifted one station by the full rise while the one 0.18 above it did
 * not move at all, which put a hard kink in the outline at the waist on every
 * frame of the vomit — the two stations were the same distance apart in width
 * and no distance apart in the code, and the crease that produced looked like a
 * fold in cardboard.
 */
const BELLY_INFLUENCE_TOP = BUST_Y;
const BELLY_INFLUENCE_BOTTOM = BELLY_Y;

/** Smoothstep, so the fade has no corner of its own at either end. */
function easeInOut(t: number): number {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - 2 * clamped);
}

function bellyInfluenceAt(stationY: number): number {
  return easeInOut(
    (stationY - BELLY_INFLUENCE_TOP) / (BELLY_INFLUENCE_BOTTOM - BELLY_INFLUENCE_TOP),
  );
}

interface TorsoEdge {
  readonly x: number;
  readonly y: number;
}

/**
 * The station widths for one pose, already carrying the heave, the swing and
 * the view. `sign` is +1 for the side of the body at +X.
 */
function torsoEdges(
  sk: Skeleton,
  pose: HoarderPose,
  view: ViewSpec,
  grow: number,
  sign: number,
): TorsoEdge[] {
  const heave = clamp01(pose.bellyHeave);
  const swing = pose.bellySwing * view.lateral;

  return TORSO_STATIONS.map((station) => {
    const influence = bellyInfluenceAt(station.y);
    const width = view.profile
      ? (sign > 0 ? station.front * view.bellyDepth : station.back) * view.girth
      : station.half * view.girth;
    const swollen = width * lerp(1, BELLY_HEAVE_SWELL, heave * influence);
    const lift = heave * BELLY_HEAVE_RISE * influence;
    const drift = swing * lerp(BELLY_SWING_UPPER_SHARE, 1, influence);
    return {
      x: sk.hip.x + drift + sign * (swollen + grow),
      y:
        sk.hip.y +
        (station.y - HIP_Y) * (1 + pose.torsoLift) +
        lift +
        pose.lean * (station.y - HIP_Y) * LEAN_SHEAR,
    };
  });
}

/** How much of the belly's wobble the chest inherits. */
const BELLY_SWING_UPPER_SHARE = 0.3;
/**
 * The torso is traced in hip space rather than rebuilt off the leaning spine,
 * so the lean has to reach it as a shear. Small: at anything larger the outline
 * separates from the limbs the skeleton solved against.
 */
const LEAN_SHEAR = 0.55;

/**
 * Lays a smooth curve down one edge, from the shoulder to the apron.
 *
 * The tangent at each station comes from its *neighbours* — a Catmull-Rom spline
 * written as cubics. Placing both control points on the segment's own midline
 * instead forces the curve vertical at every station, so each one becomes a
 * bulge and the run between two of them a waist: the front of her came out as a
 * stack of four puffs, which reads as a cloud rather than as a body.
 *
 * It is **centripetal** — the knots are spaced by the square root of the chord
 * rather than uniformly. The uniform form divides a neighbour difference by a
 * constant, so a station whose neighbours are far above and close below gets a
 * tangent scaled for the long gap and applied to the short one: the control
 * point lands past the next station and the curve doubles back on itself. That
 * showed up as a crease under the widest part of the apron that no amount of
 * moving the stations would shift, because the stations were not what was wrong.
 * Centripetal spacing is the standard cure and provably cusp-free.
 */
const CENTRIPETAL_EXPONENT = 0.5;
/**
 * The uniform form of the same spline, for closed paths whose points are laid
 * out evenly by hand and where the spacing problem below cannot arise.
 */
const SPLINE_TENSION = 6;
/** A cubic's control points sit a third of the way along its end tangents. */
const TANGENT_THIRD = 3;
/** Guards the knot spacing where two stations coincide. */
const MIN_KNOT_SPAN = 1e-6;

interface EdgeSegment {
  readonly from: TorsoEdge;
  readonly control1: TorsoEdge;
  readonly control2: TorsoEdge;
  readonly to: TorsoEdge;
}

/**
 * The cubics one edge is drawn as. Split out from the tracing so a gate can
 * measure the curve the painter actually lays down rather than the station
 * polygon, which is a different shape and a much kinder one.
 */
function edgeSegments(edges: readonly TorsoEdge[], forward: boolean): EdgeSegment[] {
  const ordered = forward ? edges : [...edges].reverse();
  const at = (index: number): TorsoEdge | undefined =>
    ordered[Math.min(ordered.length - 1, Math.max(0, index))];
  const knotAt = (index: number): number => {
    let knot = 0;
    for (let step = 1; step <= index; step++) {
      const from = at(step - 1);
      const to = at(step);
      if (from === undefined || to === undefined) continue;
      knot += Math.max(
        MIN_KNOT_SPAN,
        Math.hypot(to.x - from.x, to.y - from.y) ** CENTRIPETAL_EXPONENT,
      );
    }
    return knot;
  };
  const segments: EdgeSegment[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const before = at(i - 2);
    const previous = at(i - 1);
    const here = at(i);
    const after = at(i + 1);
    if (
      before === undefined ||
      previous === undefined ||
      here === undefined ||
      after === undefined
    ) {
      continue;
    }
    // Clamping the index at the ends duplicates a station, which would leave the
    // knot span there zero; the floor keeps the two tangents finite.
    const beforeKnot = knotAt(i - 2);
    const previousKnot = knotAt(i - 1);
    const hereKnot = knotAt(i);
    const afterKnot = knotAt(i + 1);
    const span = hereKnot - previousKnot;
    const incoming = span / (TANGENT_THIRD * Math.max(MIN_KNOT_SPAN, hereKnot - beforeKnot));
    const outgoing = span / (TANGENT_THIRD * Math.max(MIN_KNOT_SPAN, afterKnot - previousKnot));
    segments.push({
      from: previous,
      control1: {
        x: previous.x + (here.x - before.x) * incoming,
        y: previous.y + (here.y - before.y) * incoming,
      },
      control2: {
        x: here.x - (after.x - previous.x) * outgoing,
        y: here.y - (after.y - previous.y) * outgoing,
      },
      to: here,
    });
  }
  return segments;
}

function traceEdge(ctx: Ctx, edges: readonly TorsoEdge[], forward: boolean): void {
  for (const segment of edgeSegments(edges, forward)) {
    ctx.bezierCurveTo(
      segment.control1.x,
      segment.control1.y,
      segment.control2.x,
      segment.control2.y,
      segment.to.x,
      segment.to.y,
    );
  }
}

/**
 * Traces the flesh silhouette from the shoulders to the bottom of the apron as
 * one closed path.
 */
function traceTorso(ctx: Ctx, sk: Skeleton, pose: HoarderPose, view: ViewSpec, grow: number): void {
  const right = torsoEdges(sk, pose, view, grow, 1);
  const left = torsoEdges(sk, pose, view, grow, -1);
  const rightTop = right[0];
  const leftTop = left[0];
  const rightBottom = right[right.length - 1];
  const leftBottom = left[left.length - 1];
  if (
    rightTop === undefined ||
    leftTop === undefined ||
    rightBottom === undefined ||
    leftBottom === undefined
  ) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(rightTop.x, rightTop.y);
  traceEdge(ctx, right, true);

  // The bottom of the apron is a hanging U, lowest on the centreline. Closed
  // with a straight line it is a flared hem, and at tile size a flared hem is
  // read as a skirt rather than as a body.
  const hangY = (rightBottom.y + leftBottom.y) / 2 + APRON_HANG + grow;
  ctx.quadraticCurveTo(sk.hip.x, hangY, leftBottom.x, leftBottom.y);

  traceEdge(ctx, left, false);

  // Over the shoulders and in to the neck. A torso closed with a straight line
  // between its two shoulder points is a box, and no amount of belly below it
  // rescues that: the flat lid is the first thing the eye reads.
  const rise = SHOULDER_RISE + grow;
  const neckHalf = NECK_WIDTH * view.girth * NECK_NOTCH_WIDEN + grow;
  ctx.quadraticCurveTo(
    sk.shoulderCentre.x - SHOULDER_HALF * view.girth * SHOULDER_SLOPE_PULL,
    sk.shoulderCentre.y - rise,
    sk.shoulderCentre.x - neckHalf,
    sk.shoulderCentre.y - rise,
  );
  ctx.lineTo(sk.shoulderCentre.x + neckHalf, sk.shoulderCentre.y - rise);
  ctx.quadraticCurveTo(
    sk.shoulderCentre.x + SHOULDER_HALF * view.girth * SHOULDER_SLOPE_PULL,
    sk.shoulderCentre.y - rise,
    rightTop.x,
    rightTop.y,
  );
  ctx.closePath();
}

/**
 * Deliberately weak. It was strong enough to lift the middle of the belly to
 * within fifteen luminance units of the near arm lying on it, which put the two
 * back inside the margin the arm's own value was raised to clear.
 */
const TORSO_AMBIENT_ALPHA = 0.14;

/**
 * The bare mass: outline, flesh, an ambient darkening around the rim so the
 * form turns away rather than ending flat, and the folds.
 */
function drawTorsoFlesh(ctx: Ctx, sk: Skeleton, pose: HoarderPose, view: ViewSpec): void {
  traceTorso(ctx, sk, pose, view, OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();

  traceTorso(ctx, sk, pose, view, 0);
  ctx.fillStyle = SKIN.mid;
  ctx.fill();

  ctx.save();
  traceTorso(ctx, sk, pose, view, 0);
  ctx.clip();

  // A soft light from the upper-left, painted as one big ellipse rather than as
  // a gradient: node-canvas gradients are the one thing in this pipeline that
  // have bitten before, and at this size the ellipse is indistinguishable.
  ctx.globalAlpha = alpha(TORSO_AMBIENT_ALPHA);
  ctx.fillStyle = SKIN.light;
  ctx.beginPath();
  ctx.ellipse(
    sk.belly.x + LIGHT.x * BELLY_HALF * view.girth * 0.45,
    lerp(sk.bust.y, sk.belly.y, 0.6) + LIGHT.y * 0.12,
    BELLY_HALF * view.girth * 0.62,
    Math.abs(sk.bust.y - sk.hip.y) * 0.4,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  drawTorsoTerminator(ctx, sk, pose, view);
  drawTorsoFolds(ctx, sk, pose, view);
  ctx.restore();
}

/**
 * The form shade that turns the belly into a sphere.
 *
 * Without it her whole trunk sat inside a six-luminance range from edge to
 * edge — a flat pink panel — and the horizontal folds drawn on a flat panel are
 * read as seams in cloth rather than as rolls of fat. A mass this size needs
 * the surface to fall away by 40-plus luminance units before it reaches the
 * outline, and that falloff is the single strongest cue that the bare middle of
 * her is skin.
 *
 * Painted as a stack of inset strokes rather than as a gradient: node-canvas
 * gradients are the one thing in this pipeline that have bitten before.
 */
const TERMINATOR_STEPS = 7;
const TERMINATOR_ALPHA = 0.36;
const TERMINATOR_DEPTH = 0.2;

function drawTorsoTerminator(ctx: Ctx, sk: Skeleton, pose: HoarderPose, view: ViewSpec): void {
  const step = TERMINATOR_DEPTH / TERMINATOR_STEPS;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = step * 2;
  for (let i = 0; i < TERMINATOR_STEPS; i++) {
    const inward = i / TERMINATOR_STEPS;
    ctx.globalAlpha = alpha(TERMINATOR_ALPHA * (1 - inward) ** 2);
    traceTorso(ctx, sk, pose, view, -step * i);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Unevenly spaced, and every one of them stops well inside the silhouette. A
 * fold that reaches the outline is a seam: run edge to edge at even spacing
 * they turn the bare belly into a striped shirt, which is exactly how the first
 * pass read at tile size.
 */
const FOLD_SHARES = [0.3, 0.46, 0.58, 0.74] as const;
const FOLD_SPANS = [0.5, 0.62, 0.56, 0.44] as const;
/**
 * A crease is a quadratic and `sag` is its *control* offset, so the arc's actual
 * mid-drop is half of what is written here. At the old values the deepest fold
 * dropped 2.9 sheet pixels across a fold two thirds of a tile wide — 2% of its
 * own span, which is a straight line. A fold lying across a belly this deep has
 * to sag like one or the belly behind it flattens into a disc.
 */
const FOLD_SAGS = [0.07, 0.11, 0.09, 0.06] as const;
const FOLD_THICKNESS = 0.028;
const NAVEL_AT = 0.52;
const NAVEL_RX = 0.045;
const NAVEL_RY = 0.06;
const NAVEL_ALPHA = 0.4;
/** The deep fold where the belly's apron overhangs the waistband. */
const APRON_FOLD_SAG = 0.18;
const APRON_FOLD_THICKNESS = 0.045;
const APRON_FOLD_AT = 0.99;
/** Share of the belly's half-width the apron fold and the chafe under it span. */
const APRON_FOLD_SPAN = 0.82;
const CHAFE_SPAN = 0.7;
/**
 * The chafe sits inside the fold's arc rather than on its chord — the fold is a
 * quadratic, so its deepest point is a fraction of the control offset below the
 * line joining its ends.
 */
const CHAFE_BELOW_FOLD = 0.4;
const CHAFE_THICKNESS = APRON_FOLD_THICKNESS * 1.4;
const UNDERBUST_SAG = 0.12;
const UNDERBUST_SPAN = 0.5;

function drawTorsoFolds(ctx: Ctx, sk: Skeleton, pose: HoarderPose, view: ViewSpec): void {
  const heave = clamp01(pose.bellyHeave);
  const halfAt = (share: number): number =>
    BELLY_HALF * view.girth * lerp(1, BELLY_HEAVE_SWELL, heave) * share;

  if (view.showsBack) {
    drawBackFolds(ctx, sk, halfAt);
    drawStretchMarks(ctx, sk, view, halfAt);
    drawGrime(ctx, sk, view, halfAt);
    return;
  }

  // Under-bust, where the chest sits down on the gut.
  const underBustY = lerp(sk.bust.y, sk.belly.y, 0.24);
  drawCrease(
    ctx,
    pt(sk.bust.x - halfAt(UNDERBUST_SPAN), underBustY),
    pt(sk.bust.x + halfAt(UNDERBUST_SPAN), underBustY),
    UNDERBUST_SAG,
    FOLD_THICKNESS,
  );

  FOLD_SHARES.forEach((along, index) => {
    const y = lerp(sk.bust.y, sk.hip.y, along) - heave * FOLD_HEAVE_LIFT;
    const span = FOLD_SPANS[index] ?? FOLD_SPANS[0];
    const sag = FOLD_SAGS[index] ?? FOLD_SAGS[0];
    drawCrease(
      ctx,
      pt(sk.belly.x - halfAt(span), y),
      pt(sk.belly.x + halfAt(span), y),
      sag,
      FOLD_THICKNESS,
    );
  });

  const navelY = lerp(sk.bust.y, sk.hip.y, NAVEL_AT);
  ctx.globalAlpha = alpha(NAVEL_ALPHA);
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(sk.belly.x, navelY, NAVEL_RX, NAVEL_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;

  const apronY = lerp(sk.bust.y, sk.hip.y, APRON_FOLD_AT);
  drawCrease(
    ctx,
    pt(sk.belly.x - halfAt(APRON_FOLD_SPAN), apronY),
    pt(sk.belly.x + halfAt(APRON_FOLD_SPAN), apronY),
    APRON_FOLD_SAG,
    APRON_FOLD_THICKNESS,
  );

  // Raw skin in the deepest fold. Painted, not lined: a red line reads as a cut.
  ctx.globalAlpha = alpha(CHAFE_ALPHA);
  ctx.fillStyle = CHAFE;
  ctx.beginPath();
  ctx.ellipse(
    sk.belly.x,
    apronY + APRON_FOLD_SAG * CHAFE_BELOW_FOLD,
    halfAt(CHAFE_SPAN),
    CHAFE_THICKNESS,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  drawStretchMarks(ctx, sk, view, halfAt);
  drawGrime(ctx, sk, view, halfAt);
}

/**
 * Her back, which is not her front.
 *
 * The whole apron story — the under-bust crease, the four belly rolls, the
 * navel, the deep chafed fold over the waistband — was drawn in every view, so
 * a pixel diff of the walking rows found the two sides of her identical below
 * the neck and she carried a navel on her back. From behind there is no apron
 * at all: there is a spine groove, two shoulder blades, a pair of wide rolls
 * across the small of her back, and the cleft between her buttocks.
 */
const BACK_ROLL_SHARES = [0.34, 0.62] as const;
const BACK_ROLL_SPANS = [0.68, 0.78] as const;
const BACK_ROLL_SAG = -0.05;
const BACK_SPINE_TOP = 0.06;
const BACK_SPINE_BOTTOM = 0.82;
const BACK_SPINE_WIDTH = 0.02;
const BACK_SPINE_ALPHA = 0.3;
const BLADE_ACROSS = 0.42;
const BLADE_AT = 0.12;
const BLADE_RX = 0.15;
const BLADE_RY = 0.11;
const BLADE_ALPHA = 0.24;
const CLEFT_FROM = 0.9;
const CLEFT_TO = 1.12;

function drawBackFolds(ctx: Ctx, sk: Skeleton, halfAt: (share: number) => number): void {
  const along = (share: number): number => lerp(sk.bust.y, sk.hip.y, share);

  ctx.globalAlpha = alpha(BLADE_ALPHA);
  ctx.fillStyle = OUTLINE;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      sk.belly.x + side * halfAt(BLADE_ACROSS),
      along(BLADE_AT),
      BLADE_RX,
      BLADE_RY,
      side * deg(18),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // The rolls across her back arc *upward*, opposite to the belly's, which is
  // most of what stops the back reading as the front seen through her.
  BACK_ROLL_SHARES.forEach((share, index) => {
    const span = BACK_ROLL_SPANS[index] ?? BACK_ROLL_SPANS[0];
    const y = along(share);
    drawCrease(
      ctx,
      pt(sk.belly.x - halfAt(span), y),
      pt(sk.belly.x + halfAt(span), y),
      BACK_ROLL_SAG,
      FOLD_THICKNESS,
    );
  });

  ctx.globalAlpha = alpha(BACK_SPINE_ALPHA);
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(
    sk.belly.x,
    (along(BACK_SPINE_TOP) + along(BACK_SPINE_BOTTOM)) / 2,
    BACK_SPINE_WIDTH,
    (along(BACK_SPINE_BOTTOM) - along(BACK_SPINE_TOP)) / 2,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    sk.belly.x,
    (along(CLEFT_FROM) + along(CLEFT_TO)) / 2,
    BACK_SPINE_WIDTH * 1.6,
    (along(CLEFT_TO) - along(CLEFT_FROM)) / 2,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * Dirt ground into the folds. Without it every square pixel of her skin is one
 * of two colours, and a body that clean cannot be the one described as filthy
 * however stained the vest over it is.
 */
const GRIME_ALPHA = 0.16;
const GRIME_SPOTS: readonly (readonly [number, number, number])[] = [
  [-0.62, 0.28, 0.09],
  [0.48, 0.44, 0.13],
  [-0.3, 0.66, 0.07],
  [0.7, 0.72, 0.1],
  [-0.72, 0.86, 0.11],
] as const;

function drawGrime(
  ctx: Ctx,
  sk: Skeleton,
  view: ViewSpec,
  halfAt: (share: number) => number,
): void {
  ctx.globalAlpha = alpha(GRIME_ALPHA);
  ctx.fillStyle = STAIN_GRIME;
  for (const [across, down, size] of GRIME_SPOTS) {
    const side = view.profile ? Math.abs(across) : across;
    ctx.beginPath();
    ctx.ellipse(
      sk.belly.x + side * halfAt(0.9),
      lerp(sk.bust.y, sk.hip.y, down),
      size,
      size * 0.7,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Short pale streaks up the flanks of the gut. Folds alone are horizontal lines
 * on a pale field, and horizontal lines on a pale field are a striped shirt;
 * these run the other way and belong to nothing but skin.
 */
const STRETCH_MARK_COUNT = 4;
const STRETCH_MARK_ALPHA = 0.3;
const STRETCH_MARK_LENGTH = 0.12;
const STRETCH_MARK_WIDTH = 0.012;
const STRETCH_MARK_AT = 0.78;
const STRETCH_MARK_LEAN = 0.28;

function drawStretchMarks(
  ctx: Ctx,
  sk: Skeleton,
  view: ViewSpec,
  halfAt: (share: number) => number,
): void {
  ctx.globalAlpha = alpha(STRETCH_MARK_ALPHA);
  ctx.strokeStyle = SKIN.light;
  ctx.lineWidth = STRETCH_MARK_WIDTH;
  ctx.lineCap = 'round';
  const sides = view.profile ? [1] : [-1, 1];
  for (const side of sides) {
    for (let i = 0; i < STRETCH_MARK_COUNT; i++) {
      const share = i / (STRETCH_MARK_COUNT - 1);
      const x = sk.belly.x + side * halfAt(STRETCH_MARK_AT - share * 0.16);
      const y = lerp(sk.bust.y, sk.hip.y, 0.36 + share * 0.34);
      const length = STRETCH_MARK_LENGTH * lerp(1, 0.62, share);
      ctx.beginPath();
      ctx.moveTo(x, y - length / 2);
      ctx.lineTo(x - side * length * STRETCH_MARK_LEAN, y + length / 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

const CHAFE_ALPHA = 0.4;
/** How far the folds ride up with a heave. */
const FOLD_HEAVE_LIFT = 0.02;

// ── Clothing ─────────────────────────────────────────────────────────────────

/**
 * The vest, ridden up under the bust. Its hem is the top edge of the bare
 * belly, so the two are drawn against the same curve and cannot separate.
 */
/**
 * Where the vest stops. Ridden right up under the bust in front, because that
 * is what the gut under it has done to it; from behind there is no gut, so it
 * hangs where a vest hangs and covers most of her back.
 */
const VEST_HEM_AT = 0.3;
const VEST_HEM_AT_BACK = 0.92;
/**
 * The hem sags 9 sheet pixels over the belly. It arced *upward* before, which
 * is what a hem does on a flat stomach and the opposite of what it does when
 * the garment is riding on top of one.
 */
const VEST_HEM_SAG = 0.18;
/** Edge-on the hem cannot be level: the gut it lies on protrudes most of a head. */
const VEST_HEM_FRONT_DROP = 0.075;
/**
 * The vest is cut wider than the chest it grips and trimmed back to the body by
 * the torso clip, so its edges are the silhouette's rather than a rectangle's.
 */
const VEST_GRIP_REACH = BELLY_HALF * 1.15;
const VEST_STAIN_COUNT = 4;
/** The bunched roll of jersey where the hem has ridden up and stopped. */
const VEST_HEM_ROLL = 4 * SHEET_PX;
const VEST_ARMHOLE_ALPHA = 0.45;

function traceVest(ctx: Ctx, sk: Skeleton, view: ViewSpec, hemY: number): void {
  const top = sk.shoulderCentre.y - SHOULDER_RISE * 2;
  const frontDrop = view.profile ? VEST_HEM_FRONT_DROP : 0;
  const left = sk.shoulderCentre.x - VEST_GRIP_REACH;
  const right = sk.shoulderCentre.x + VEST_GRIP_REACH;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, hemY + frontDrop);
  ctx.quadraticCurveTo(sk.belly.x, hemY + VEST_HEM_SAG + frontDrop, left, hemY);
  ctx.closePath();
}

function drawVest(ctx: Ctx, sk: Skeleton, pose: HoarderPose, view: ViewSpec): void {
  const hemY = lerp(sk.bust.y, sk.belly.y, view.showsBack ? VEST_HEM_AT_BACK : VEST_HEM_AT);
  const top = sk.shoulderCentre.y - SHOULDER_RISE * 2;

  ctx.save();
  traceTorso(ctx, sk, pose, view, OUTLINE_BLEED * 0.5);
  ctx.clip();

  ctx.fillStyle = VEST.mid;
  traceVest(ctx, sk, view, hemY);
  ctx.fill();

  // The neckline is *cut* out of the vest rather than painted on it, so the
  // straps are whatever the cut leaves either side and cannot drift away from
  // it. Deep in front, shallow behind.
  const scoopHalf = (view.showsBack ? NECK_SCOOP_HALF_BACK : NECK_SCOOP_HALF_FRONT) * view.girth;
  const scoopDrop = view.showsBack ? NECK_SCOOP_DROP_BACK : NECK_SCOOP_DROP_FRONT;
  ctx.fillStyle = SKIN.mid;
  ctx.beginPath();
  ctx.moveTo(sk.shoulderCentre.x - scoopHalf, top);
  ctx.quadraticCurveTo(
    sk.shoulderCentre.x,
    sk.shoulderCentre.y + scoopDrop,
    sk.shoulderCentre.x + scoopHalf,
    top,
  );
  ctx.closePath();
  ctx.fill();

  // Everything from here on is clipped to the vest as well as to her, because a
  // stain whose top sits on the jersey and whose bottom runs on down bare skin
  // is the one thing that tells the eye the two are the same surface.
  ctx.save();
  traceVest(ctx, sk, view, hemY);
  ctx.clip();

  // Old bile down the front, in several runs rather than one blob, because one
  // blob at this size reads as a printed motif rather than as a stain.
  for (let i = 0; i < VEST_STAIN_COUNT; i++) {
    const share = i / (VEST_STAIN_COUNT - 1);
    const x = sk.bust.x + (share - 0.5) * BUST_HALF * view.girth * 1.2;
    const y = lerp(sk.bust.y, hemY, 0.4 + share * 0.45);
    ctx.fillStyle = i % 2 === 0 ? STAIN_BILE : STAIN_GRIME;
    ctx.beginPath();
    ctx.ellipse(x, y, VEST_STAIN_RX, VEST_STAIN_RY, 0, 0, TWO_PI);
    ctx.fill();
  }

  // Head-on her arms hang outside the widest part of her, so they cover the
  // bust shelf and the outline runs shoulder-to-belly as one cone. The jersey
  // is where the bust has to read instead: a seam under each breast and a
  // highlight over it, which survives the tile downscale as two pale lobes.
  if (!view.showsBack) {
    const bustY = lerp(sk.bust.y, hemY, BUST_SEAM_AT);
    for (const side of [-1, 1]) {
      const x = sk.bust.x + side * BUST_HALF * view.girth * BUST_SEAM_SPREAD;
      ctx.globalAlpha = alpha(BUST_SEAM_ALPHA);
      ctx.fillStyle = VEST.light;
      ctx.beginPath();
      ctx.ellipse(x, bustY - BUST_SEAM_RY, BUST_SEAM_RX, BUST_SEAM_RY, 0, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = VEST.dark;
      ctx.lineWidth = VEST_HEM_LINE;
      ctx.beginPath();
      ctx.ellipse(x, bustY - BUST_SEAM_RY, BUST_SEAM_RX, BUST_SEAM_RY, 0, 0, Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // The armholes cut into the flesh of her shoulders rather than ending at a
  // straight strap edge: the pinch is what says the garment is too small.
  ctx.globalAlpha = alpha(VEST_ARMHOLE_ALPHA);
  ctx.strokeStyle = VEST.dark;
  ctx.lineWidth = VEST_HEM_LINE;
  for (const side of [-1, 1]) {
    const shoulderX = sk.shoulderCentre.x + side * SHOULDER_HALF * view.girth;
    ctx.beginPath();
    ctx.moveTo(shoulderX, top);
    ctx.quadraticCurveTo(
      shoulderX - side * ARMHOLE_PINCH,
      lerp(top, hemY, 0.3),
      shoulderX + side * ARMHOLE_PINCH * 0.4,
      lerp(top, hemY, 0.62),
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // The hem's bunched roll, inside the torso clip: drawn outside it the stroke
  // runs on past her silhouette and reads as a bar driven through her.
  const frontDrop = view.profile ? VEST_HEM_FRONT_DROP : 0;
  const left = sk.shoulderCentre.x - VEST_GRIP_REACH;
  const right = sk.shoulderCentre.x + VEST_GRIP_REACH;
  ctx.lineCap = 'round';
  ctx.strokeStyle = VEST.light;
  ctx.lineWidth = VEST_HEM_ROLL;
  ctx.beginPath();
  ctx.moveTo(left, hemY - VEST_HEM_ROLL * 0.4);
  ctx.quadraticCurveTo(
    sk.belly.x,
    hemY + VEST_HEM_SAG + frontDrop - VEST_HEM_ROLL * 0.4,
    right,
    hemY + frontDrop - VEST_HEM_ROLL * 0.4,
  );
  ctx.stroke();
  ctx.strokeStyle = VEST.dark;
  ctx.lineWidth = VEST_HEM_LINE;
  ctx.beginPath();
  ctx.moveTo(left, hemY);
  ctx.quadraticCurveTo(sk.belly.x, hemY + VEST_HEM_SAG + frontDrop, right, hemY + frontDrop);
  ctx.stroke();

  ctx.restore();
}

const NECK_SCOOP_HALF_FRONT = 0.15;
const NECK_SCOOP_DROP_FRONT = 0.1;
const NECK_SCOOP_HALF_BACK = 0.17;
const NECK_SCOOP_DROP_BACK = 0.04;
const VEST_STAIN_RX = 0.055;
const VEST_STAIN_RY = 0.085;
const VEST_HEM_LINE = 0.022;
const ARMHOLE_PINCH = 0.07;
const BUST_SEAM_AT = 0.34;
const BUST_SEAM_SPREAD = 0.52;
const BUST_SEAM_RX = 0.17;
const BUST_SEAM_RY = 0.13;
const BUST_SEAM_ALPHA = 0.3;

/**
 * Where the trousers' top edge sits: below the belly's lowest fold, which is the
 * whole reason the apron reads as an apron. Nothing is drawn *at* this line —
 * the apron hangs well past it — but the panel between the legs starts here.
 */
const WAISTBAND_AT = 1.02;
/**
 * How far down the shin the trouser leg reaches. Stopping above the knee left a
 * 28-pixel dark band that read as underwear; carried to mid-shin the bare calf
 * disappears and the pale apron above it starts reading as a skirt. Just past
 * the knee is the only place that is a trouser leg and not either of those.
 */
const TROUSER_SHIN_AT = 0.38;
/** Where along the knee-to-cuff run the darkened hem band starts. */
const TROUSER_HEM_FROM = 0.88;

interface TrouserLeg {
  readonly chain: BoneChain;
  readonly shape: LimbShape;
}

function drawTrousers(
  ctx: Ctx,
  sk: Skeleton,
  view: ViewSpec,
  legs: {
    left: TrouserLeg;
    right: TrouserLeg;
  },
): void {
  const bandY = lerp(sk.bust.y, sk.hip.y, WAISTBAND_AT);
  const half = HIP_HALF * view.girth * view.hipDepth;

  // Each leg's cuff is wrapped round its own thigh and follows that thigh's
  // direction, which is the only construction that covers the leg at any angle;
  // a fixed trapezoid stays upright while the leg swings out bare. Its widths
  // come off *that leg's own* shape rather than off the standing one: a leg
  // swung toward the camera is drawn wider below the knee, and a cuff sized for
  // the standing shape then leaves a strip of bare shin down each side of the
  // trouser for exactly the frames the leg is lifted.
  for (const leg of [legs.left, legs.right]) {
    const { chain, shape } = leg;
    const cuff = mixPt(chain.joint, chain.end, TROUSER_SHIN_AT);
    const thighWidth = shape.root * TROUSER_BULK;
    const kneeWidth = Math.max(shape.joint, shape.belly) * TROUSER_BULK;
    const calfWidth = shape.belly * TROUSER_BULK;
    outlineCapsule(ctx, chain.root, chain.joint, thighWidth, kneeWidth);
    outlineCapsule(ctx, chain.joint, cuff, kneeWidth, calfWidth);
    fillCapsule(ctx, chain.root, chain.joint, thighWidth, kneeWidth, TROUSERS.mid);
    fillCapsule(ctx, chain.joint, cuff, kneeWidth, calfWidth, TROUSERS.mid);
    sheenSegment(ctx, chain.root, chain.joint, thighWidth, TROUSERS.light, SHEEN_ALPHA);
    sheenSegment(ctx, chain.joint, cuff, calfWidth, TROUSERS.light, SHEEN_ALPHA);
    // The cuff's own hem, so the leg ends in an edge rather than fading out.
    ctx.globalAlpha = alpha(TROUSER_CUFF_ALPHA);
    fillCapsule(
      ctx,
      mixPt(chain.joint, cuff, TROUSER_HEM_FROM),
      cuff,
      calfWidth,
      calfWidth,
      TROUSERS.dark,
    );
    ctx.globalAlpha = 1;
  }

  // There is no waistband drawn here. There used to be one, and it never
  // rendered a single pixel: it sits at `bandY`, the apron hangs a third of a
  // tile lower, and the flesh is painted after the trousers — so the only part
  // of it anything ever saw was the sliver that reached past her back edge in
  // profile and hung a two-pixel spur off the silhouette. A band that has to be
  // clipped to be correct is a band nobody can see.
  ctx.fillStyle = TROUSERS.mid;
  ctx.beginPath();
  ctx.moveTo(sk.hip.x - half, bandY);
  ctx.lineTo(sk.hip.x + half, bandY);
  ctx.lineTo(sk.hip.x + half * TROUSER_TAPER, sk.hip.y + CROTCH_DROP_BELOW_HIP);
  ctx.lineTo(sk.hip.x - half * TROUSER_TAPER, sk.hip.y + CROTCH_DROP_BELOW_HIP);
  ctx.closePath();
  ctx.fill();
}

/** How far below the hip joint the trouser panel closes. */
const CROTCH_DROP_BELOW_HIP = 0.16;
const TROUSER_BULK = 1.1;
const TROUSER_TAPER = 0.9;
const TROUSER_CUFF_ALPHA = 0.5;

// ── Head ─────────────────────────────────────────────────────────────────────

/**
 * The widest part of her head, and it is at the jaw rather than at the cranium:
 * a skull that is widest above the mouth reads as a skull whatever is painted
 * on it, and only a head that bulges *below* the cheekbone reads as fat.
 */
const JOWL_HALF = HEAD_RX * 1.25;
const JOWL_DROP = HEAD_RY * 0.6;
const JOWL_RY = HEAD_RY * 0.48;
/** The second chin tapers off the jowl rather than matching it. */
const CHIN_ROLL_TAPER = 0.85;
const CHIN_ROLL_RY = HEAD_RY * 0.3;
const CHIN_ROLL_DROP = HEAD_RY * 1.05;

const EYE_HALF_SPACING = HEAD_RX * 0.38;
const EYE_Y = -HEAD_RY * 0.1;
/**
 * Big for the head, because the tile downscale is 0.47× and an eye that lands
 * on less than two device pixels is not an eye. At this radius the sclera comes
 * out 3.3 device pixels across.
 */
const EYE_RX = HEAD_RX * 0.3;
const EYE_RY = HEAD_RY * 0.23;
const EYE_GLINT_RATIO = 0.28;
/** A heavy lid over the top of the eye: without one the white reads as a doll's. */
const EYE_LID_DROP = 0.16;
const EYE_LID_ALPHA = 0.22;
const BROW_DROP = HEAD_RY * 0.16;
const BROW_THICKNESS = HEAD_RY * 0.11;
const BROW_ANGER = deg(17);

const NOSE_Y = HEAD_RY * 0.24;
const NOSE_RX = HEAD_RX * 0.24;
const NOSE_RY = HEAD_RY * 0.19;

const MOUTH_Y = HEAD_RY * 0.6;
const MOUTH_HALF_CLOSED = HEAD_RX * 0.42;
const MOUTH_HALF_OPEN = HEAD_RX * 0.72;
const MOUTH_OPEN_DROP = HEAD_RY * 1.15;
const TOOTH_COUNT = 4;

/**
 * How far the jaw itself swings down as the mouth opens. A mouth that scales in
 * place while the chin stays put is a painted hole, not an unhinged jaw: at
 * this value her chin travels 14 sheet pixels between the wind-up and the
 * release, which is the whole difference between retching and shouting.
 */
const JAW_DROP = HEAD_RY * 0.9;

function drawFace(ctx: Ctx, pose: HoarderPose, toward: number): void {
  const gape = clamp01(pose.mouth);
  const open = clamp01(pose.blink);

  // Brows: heavy pads of fat rather than hair, which is what buries the eyes.
  for (const side of [-1, 1]) {
    const x = side * EYE_HALF_SPACING * toward;
    ctx.save();
    ctx.translate(x, EYE_Y - BROW_DROP);
    ctx.rotate(side * toward * BROW_ANGER * pose.brow);
    ctx.fillStyle = mix(SKIN.mid, OUTLINE, BROW_SHADE);
    ctx.beginPath();
    ctx.ellipse(0, 0, EYE_RX * 1.5, BROW_THICKNESS, 0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  for (const side of [-1, 1]) {
    const x = side * EYE_HALF_SPACING * toward;
    const lidClose = 1 - open;
    ctx.fillStyle = EYE_WHITE;
    ctx.beginPath();
    ctx.ellipse(x, EYE_Y, EYE_RX, EYE_RY * lidClose, 0, 0, TWO_PI);
    ctx.fill();
    if (lidClose > EYE_MIN_OPEN) {
      const irisX = x + side * EYE_RX * 0.15 * toward;
      ctx.fillStyle = IRIS;
      ctx.beginPath();
      ctx.arc(irisX, EYE_Y, EYE_RY * IRIS_RATIO * lidClose, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = EYE_GLINT;
      ctx.beginPath();
      ctx.arc(
        irisX - EYE_RX * 0.3,
        EYE_Y - EYE_RY * 0.3,
        EYE_RY * EYE_GLINT_RATIO * lidClose,
        0,
        TWO_PI,
      );
      ctx.fill();
      // The lid comes down over the top of the eye. Without it the sclera is a
      // full disc and the whole face reads as a doll's rather than as hers.
      ctx.globalAlpha = alpha(EYE_LID_ALPHA);
      ctx.fillStyle = mix(SKIN.mid, OUTLINE, BROW_SHADE);
      ctx.beginPath();
      ctx.ellipse(x, EYE_Y - EYE_RY * (1 - EYE_LID_DROP), EYE_RX, EYE_RY, 0, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // A pouch of fat under the eye. Without it the eye floats in a bare cheek.
    ctx.globalAlpha = alpha(EYE_BAG_ALPHA);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = HEAD_RY * 0.035;
    ctx.beginPath();
    ctx.arc(x, EYE_Y + EYE_RY * 0.6, EYE_RX * 0.9, 0, Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = mix(SKIN.mid, SKIN.dark, NOSE_SHADE);
  ctx.beginPath();
  ctx.ellipse(0, NOSE_Y, NOSE_RX, NOSE_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = OUTLINE;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      side * NOSE_RX * 0.45,
      NOSE_Y + NOSE_RY * 0.4,
      NOSE_RX * 0.18,
      NOSE_RY * 0.22,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  drawMouth(ctx, gape, toward);
}

const BROW_SHADE = 0.22;
const NOSE_SHADE = 0.35;
/**
 * The iris deliberately leaves sclera on both sides of it. Filled to the lid
 * the eye measured 0.44 square pixels of white per side at play size, which is
 * no eye at all — the white is the part that survives the downscale.
 */
const IRIS_RATIO = 0.5;
const EYE_MIN_OPEN = 0.12;
const EYE_BAG_ALPHA = 0.35;

function drawMouth(ctx: Ctx, gape: number, toward: number): void {
  const half = lerp(MOUTH_HALF_CLOSED, MOUTH_HALF_OPEN, gape);
  const drop = MOUTH_OPEN_DROP * gape;
  const y = MOUTH_Y;

  if (gape <= MOUTH_CLOSED_THRESHOLD) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = HEAD_RY * 0.06;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-half, y);
    // Corners *below* the middle. Drawn the other way the closed mouth is an
    // upturned line, and this boss is meant to read as menacing, not cheerful.
    ctx.quadraticCurveTo(0, y - HEAD_RY * MOUTH_GRIMACE, half, y + HEAD_RY * MOUTH_CORNER_DROP);
    ctx.stroke();
    return;
  }

  ctx.fillStyle = MOUTH_INNER;
  ctx.beginPath();
  ctx.ellipse(0, y + drop * 0.4, half, drop * 0.6, 0, 0, TWO_PI);
  ctx.fill();

  // The throat, painted darker and deeper the wider the jaw goes, so the mouth
  // reads as a hole rather than as a painted shape.
  ctx.fillStyle = THROAT_DARK;
  ctx.beginPath();
  ctx.ellipse(0, y + drop * 0.45, half * 0.5, drop * 0.34, 0, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = TOOTH;
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const share = i / (TOOTH_COUNT - 1);
    // A missing tooth, always the same one, so the gap is a feature of her face
    // rather than noise that changes frame to frame.
    if (i === MISSING_TOOTH_INDEX) continue;
    const x = (share - 0.5) * half * 1.4;
    ctx.beginPath();
    ctx.rect(x - TOOTH_HALF_WIDTH, y - drop * 0.05, TOOTH_HALF_WIDTH * 2, TOOTH_HEIGHT);
    ctx.fill();
  }

  ctx.fillStyle = TONGUE;
  ctx.beginPath();
  ctx.ellipse(0, y + drop * 0.72, half * 0.52, drop * 0.24, 0, 0, TWO_PI);
  ctx.fill();

  // The face is drawn in its own rotated frame, so the head turn has to reach
  // the mouth as a shear or the gape stays square to the camera while the rest
  // of the face turns away.
  ctx.globalAlpha = alpha(SALLOW_ALPHA * gape);
  ctx.fillStyle = SALLOW;
  ctx.beginPath();
  ctx.ellipse(toward * half * 0.1, y + drop * 0.2, half * 1.25, drop * 0.9, 0, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
}

const MOUTH_GRIMACE = 0.14;
const MOUTH_CORNER_DROP = 0.16;
const MOUTH_CLOSED_THRESHOLD = 0.06;
const MISSING_TOOTH_INDEX = 1;
const TOOTH_HALF_WIDTH = HEAD_RX * 0.07;
const TOOTH_HEIGHT = HEAD_RY * 0.17;
const SALLOW_ALPHA = 0.22;

/**
 * The bottom of the fringe over her forehead. It has to clear the eye line by a
 * real margin: hair hanging anywhere near the eyes buries them outright at the
 * 0.47× tile downscale, and a face with no eyes has no expression to read.
 */
const HAIRLINE_Y = -HEAD_RY * 0.52;
/** Hair sits a little proud of the skull; a cap flush to it is a swim hat. */
const HAIR_RADIUS_GAIN = 1.06;
/** The temples, where the hairline is highest before it dips over the brow. */
const HAIR_TEMPLE_LIFT = HEAD_RY * 0.14;
const HAIR_FLOW_REACH = HEAD_RX * 0.5;
const HAIR_TIP_WIDTH = SHEET_PX;
/** A hank narrows early and holds its point; a late taper is a square-tipped bar. */
const HAIR_TAPER_CONTROL = 0.15;
const HAIR_TAPER_AT = 0.32;
const HAIR_SHEEN_ALPHA = 0.3;

/**
 * One hank of hair. What separates lank unwashed hair from a mop head is
 * *variance* — of width, of length, and of where the points land. Uniform
 * strands at uniform spacing read as fringe trim whatever colour they are, so
 * no two of these share a width or a drop.
 */
interface HairClump {
  /** Root position across the head, −1 at the far side and +1 at the near one. */
  readonly at: number;
  /** Width at the root, in sheet pixels. */
  readonly width: number;
  /** How far below the head's centre the point hangs, in sheet pixels. */
  readonly drop: number;
  /** Sideways drift of the point, as a share of its own fall. */
  readonly kick: number;
  /** Which of the three hair values this hank takes, so neighbours separate. */
  readonly tone: keyof Ramp;
}

/**
 * The head's centre is 21 sheet pixels above the bottom of her jaw, so the
 * longest hanks are the ones that hang past it onto her shoulders. Measured on
 * a render, the first pass's tips all landed inside eight pixels of each other
 * however varied the table looked — the spread here is 32, better than 3:1
 * between the shortest and the longest.
 */
const HAIR_CLUMPS: readonly HairClump[] = [
  { at: -1, width: 4, drop: 34, kick: -0.11, tone: 'mid' },
  { at: -0.97, width: 9, drop: 12, kick: -0.05, tone: 'dark' },
  { at: -0.85, width: 5, drop: 41, kick: 0.02, tone: 'light' },
  { at: -0.55, width: 3, drop: 22, kick: 0.05, tone: 'mid' },
  { at: -0.18, width: 7, drop: 9, kick: 0.02, tone: 'dark' },
  { at: 0.2, width: 4, drop: 28, kick: -0.02, tone: 'mid' },
  { at: 0.55, width: 9, drop: 14, kick: 0.04, tone: 'dark' },
  { at: 0.83, width: 3, drop: 38, kick: 0.06, tone: 'light' },
  { at: 0.92, width: 6, drop: 18, kick: 0.09, tone: 'mid' },
  { at: 1, width: 5, drop: 30, kick: 0.12, tone: 'dark' },
];

/**
 * How far out a clump has to root before it clears the face. Head-on her eyes
 * reach 0.64 of the head's half-width, so anything inboard of this would hang
 * over one of them; edge-on the whole middle of the head *is* the cheek, so
 * only hair rooted behind the ear can fall without lying across her face.
 */
const HAIR_CLEARS_FACE_FRONT = 0.8;
const HAIR_CLEARS_FACE_PROFILE = 0.05;

function clumpShowsIn(clump: HairClump, view: ViewSpec): boolean {
  if (view.showsBack) return true;
  if (view.profile) return clump.at <= HAIR_CLEARS_FACE_PROFILE;
  return Math.abs(clump.at) >= HAIR_CLEARS_FACE_FRONT;
}

const HAIR_CROWN_RISE = 1.04;
/**
 * How far down the sides of the skull the mass comes before the clumps take
 * over. Cut off at the hairline all the way round, the scalp is a cap and the
 * bare skull shows between the hanging clumps as stripes of skin — which reads
 * as a bamboo curtain rather than as hair.
 */
const HAIR_SIDE_DROP = 0.42;
const HAIR_FACE_CORNER = 0.74;
/** How far the widow's peak dips below the temples, as a share of the hairline. */
const HAIR_PEAK_DIP = 1.18;
const HAIR_NAPE_SAG = 0.18;
/** From behind the mass comes down past the jaw; the clumps are its ragged hem. */
const HAIR_BACK_FALL = 2.1;
const HAIR_PROFILE_FRONT_CORNER = 0.66;
/**
 * Edge-on the mass is not symmetric and cannot be traced as though it were: it
 * stops at the brow in front and falls past the jaw behind. Cut at one height
 * all the way round, the skull showed between the hanging hanks as a row of
 * vertical stripes of skin, which reads as a comb rather than as hair.
 */
const HAIR_PROFILE_FALL = 1.05;
const HAIR_PROFILE_NAPE_AT = -0.35;

/**
 * The scalp: the skull's own curve carried a little proud of it, closed off
 * underneath by an edge that differs per view — an arch over the face head-on,
 * a sagging nape from behind, and a brow-to-nape diagonal in profile. Traced as
 * a box across the top it read as a mortarboard; the crown has to follow the
 * head or the hair is headgear.
 */
function traceHairCap(ctx: Ctx, rx: number, view: ViewSpec): void {
  const hrx = rx * HAIR_RADIUS_GAIN;
  const hry = HEAD_RY * HAIR_CROWN_RISE;
  const sideY = HEAD_RY * HAIR_SIDE_DROP * (view.showsBack ? HAIR_BACK_FALL : 1);
  const sideAngle = Math.asin(sideY / hry);
  const sideX = Math.cos(sideAngle) * hrx;
  const templeY = HAIRLINE_Y - HAIR_TEMPLE_LIFT;

  if (view.profile) {
    const backY = HEAD_RY * HAIR_PROFILE_FALL;
    const backAngle = Math.asin(Math.min(1, (backY / hry) * 0.6));
    const frontAngle = Math.asin(templeY / hry);
    ctx.beginPath();
    ctx.ellipse(0, 0, hrx, hry, 0, Math.PI - backAngle, TWO_PI + frontAngle);
    ctx.quadraticCurveTo(hrx * 0.86, templeY, hrx * HAIR_PROFILE_FRONT_CORNER, HAIRLINE_Y);
    ctx.quadraticCurveTo(hrx * 0.16, HEAD_RY * 0.32, hrx * HAIR_PROFILE_NAPE_AT, backY * 0.86);
    ctx.quadraticCurveTo(
      -hrx * 0.82,
      backY * 1.12,
      Math.cos(Math.PI - backAngle) * hrx,
      Math.sin(Math.PI - backAngle) * hry,
    );
    ctx.closePath();
    return;
  }

  ctx.beginPath();
  ctx.ellipse(0, 0, hrx, hry, 0, Math.PI - sideAngle, TWO_PI + sideAngle);

  if (view.showsBack) {
    ctx.quadraticCurveTo(0, sideY + HEAD_RY * HAIR_NAPE_SAG, -sideX, sideY);
  } else {
    const cornerX = hrx * HAIR_FACE_CORNER;
    ctx.quadraticCurveTo(hrx * 0.92, templeY * 0.5, cornerX, HAIRLINE_Y);
    ctx.quadraticCurveTo(0, HAIRLINE_Y * HAIR_PEAK_DIP, -cornerX, HAIRLINE_Y);
    ctx.quadraticCurveTo(-hrx * 0.92, templeY * 0.5, -sideX, sideY);
  }
  ctx.closePath();
}

function drawHairClump(ctx: Ctx, clump: HairClump, rx: number, flow: number, ramp: Ramp): void {
  const halfWidth = (clump.width * SHEET_PX) / 2;
  const hrx = rx * HAIR_RADIUS_GAIN;
  const rootX = clump.at * hrx;
  const rootY = -Math.sqrt(clamp01(1 - clump.at ** 2)) * HEAD_RY * HAIR_CROWN_RISE;
  const tipY = clump.drop * SHEET_PX;
  const fall = tipY - rootY;
  const tipX = rootX + flow + clump.kick * fall;
  const bellyY = lerp(rootY, tipY, HAIR_TAPER_AT);

  ctx.fillStyle = ramp[clump.tone];
  ctx.beginPath();
  ctx.moveTo(rootX - halfWidth, rootY);
  ctx.quadraticCurveTo(tipX - halfWidth * HAIR_TAPER_CONTROL, bellyY, tipX - HAIR_TIP_WIDTH, tipY);
  ctx.lineTo(tipX + HAIR_TIP_WIDTH, tipY);
  ctx.quadraticCurveTo(tipX + halfWidth * HAIR_TAPER_CONTROL, bellyY, rootX + halfWidth, rootY);
  ctx.closePath();
  ctx.fill();
}

function drawHair(ctx: Ctx, pose: HoarderPose, view: ViewSpec): void {
  const flow = pose.hairFlow * HAIR_FLOW_REACH;
  // The profile skull is deeper than the head-on one is wide; hair laid out on
  // the narrower radius leaves the back of her head bare.
  const rx = view.profile ? HEAD_DEPTH : HEAD_RX;

  for (const clump of HAIR_CLUMPS) {
    if (clumpShowsIn(clump, view)) drawHairClump(ctx, clump, rx, flow, HAIR);
  }

  ctx.fillStyle = HAIR.mid;
  traceHairCap(ctx, rx, view);
  ctx.fill();

  // One greasy highlight across the crown, which is what stops the hair reading
  // as a felt cap.
  ctx.globalAlpha = alpha(HAIR_SHEEN_ALPHA);
  ctx.fillStyle = HAIR.light;
  ctx.beginPath();
  ctx.ellipse(LIGHT.x * rx * 0.3, -HEAD_RY * 0.78, rx * 0.42, HEAD_RY * 0.12, 0, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * The profile face. A head-on face painted on a profile skull is the single
 * most obvious thing a side view can get wrong: two eyes and a centred mouth
 * make the figure read as facing the camera whatever the body is doing, which
 * is exactly what the first pass did. Edge-on she gets one eye, a nose that
 * breaks the front of the skull, an ear behind it, and a mouth that opens
 * forward.
 */
const PROFILE_EYE_AT = 0.56;
const PROFILE_BROW_AT = 0.66;
const PROFILE_MOUTH_AT = 0.54;
const PROFILE_EAR_AT = -0.2;
const PROFILE_EAR_RX = 0.16;
const PROFILE_EAR_RY = 0.3;

/**
 * The profile skull, as a silhouette rather than as an ellipse with features
 * painted on it. An egg is symmetric and a symmetric head has no direction:
 * which way she faces becomes a coin flip that only the feet resolve, and at
 * tile size the feet are four pixels. Three bumps break the outline and settle
 * it — the nose past the brow, the chin past the jaw behind it, and the occiput
 * bulging out the back. The chin is deliberately kept *short* of the nose:
 * measured equal, the two convex points with the mouth's notch between them are
 * the muzzle signature, and the profile stops reading as human.
 */
const PROFILE_BROW_OUT = 0.88;
const PROFILE_NOSE_OUT = 1.26;
const PROFILE_CHIN_OUT = 1.06;
const PROFILE_OCCIPUT_OUT = -1.2;
const PROFILE_JAW_BACK = -0.55;

/** Points of the profile skull, as (depth, height) multiples of its two radii. */
const PROFILE_SKULL_PATH = [
  [0, -1.02],
  [0.78, -0.86],
  [PROFILE_BROW_OUT, -0.34],
  [0.83, -0.04],
  [PROFILE_NOSE_OUT, 0.22],
  // The blunt underside of the nose. Without it the spline runs straight from
  // the tip to the lip and the whole face reads as a beak — the reptile trap
  // from the troglodyte, and it costs a round every time.
  [1.12, 0.34],
  [0.8, 0.44],
  [0.9, 0.56],
  [PROFILE_CHIN_OUT, 0.8],
  [0.62, 1.06],
  [PROFILE_JAW_BACK, 1.0],
  [-1.02, 0.58],
  [PROFILE_OCCIPUT_OUT, 0.1],
  [-1.14, -0.34],
  [-0.86, -0.7],
  [-0.5, -0.95],
] as const;

/** How much of the jaw's drop the lower half of the profile outline takes. */
const PROFILE_JAW_FROM = 0.4;

function traceProfileSkull(ctx: Ctx, toward: number, gape: number, grow: number): void {
  const gain = 1 + grow;
  // Walked as a closed spline rather than as line segments: joined straight the
  // back of the skull came out as a 26-pixel vertical wall, and a head with a
  // flat back is a rectangle with a face painted on the front of it.
  const points = PROFILE_SKULL_PATH.map(([depth, height]) => {
    const swings = height > PROFILE_JAW_FROM;
    return pt(
      depth * HEAD_DEPTH * toward * gain,
      height * HEAD_RY * gain + (swings ? JAW_DROP * gape : 0),
    );
  });
  const wrap = (index: number): Pt => {
    const found = points[((index % points.length) + points.length) % points.length];
    return found ?? pt(0, 0);
  };
  ctx.beginPath();
  const first = wrap(0);
  ctx.moveTo(first.x, first.y);
  for (let i = 0; i < points.length; i++) {
    const before = wrap(i - 1);
    const from = wrap(i);
    const to = wrap(i + 1);
    const after = wrap(i + 2);
    ctx.bezierCurveTo(
      from.x + (to.x - before.x) / SPLINE_TENSION,
      from.y + (to.y - before.y) / SPLINE_TENSION,
      to.x - (after.x - from.x) / SPLINE_TENSION,
      to.y - (after.y - from.y) / SPLINE_TENSION,
      to.x,
      to.y,
    );
  }
  ctx.closePath();
}

function drawProfileEye(ctx: Ctx, toward: number, lidOpen: number): void {
  const x = HEAD_DEPTH * PROFILE_EYE_AT * toward;
  ctx.fillStyle = EYE_WHITE;
  ctx.beginPath();
  ctx.ellipse(x, EYE_Y, EYE_RX * 0.9, EYE_RY * lidOpen, 0, 0, TWO_PI);
  ctx.fill();
  if (lidOpen <= EYE_MIN_OPEN) return;

  // One almond, one pupil, one glint. The previous pass laid a horizontal
  // sclera under a pupil offset most of its own width forward, and the two read
  // as a "+" rather than as an eye.
  ctx.fillStyle = IRIS;
  ctx.beginPath();
  ctx.ellipse(
    x + EYE_RX * 0.16 * toward,
    EYE_Y,
    EYE_RX * 0.52,
    EYE_RY * 0.78 * lidOpen,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = EYE_GLINT;
  ctx.beginPath();
  ctx.arc(
    x - EYE_RX * 0.2 * toward,
    EYE_Y - EYE_RY * 0.3,
    EYE_RY * EYE_GLINT_RATIO * lidOpen,
    0,
    TWO_PI,
  );
  ctx.fill();
}

function drawProfileFace(ctx: Ctx, pose: HoarderPose, toward: number): void {
  const gape = clamp01(pose.mouth);

  // The ear sits behind the eye and is what fixes which way the head points
  // even when the nose is small.
  ctx.fillStyle = mix(SKIN.mid, SKIN.dark, EAR_SHADE);
  ctx.beginPath();
  ctx.ellipse(
    HEAD_DEPTH * PROFILE_EAR_AT * toward,
    EYE_Y + HEAD_RY * 0.1,
    HEAD_RX * PROFILE_EAR_RX,
    HEAD_RY * PROFILE_EAR_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  // A nostril and the shadow under the nose, on a nose that is already part of
  // the outline: painted features on a smooth skull never resolved which way
  // she pointed, so the shape carries it and this only shades it.
  ctx.globalAlpha = alpha(NOSE_UNDERSHADE_ALPHA);
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(
    HEAD_DEPTH * (PROFILE_NOSE_OUT - 0.18) * toward,
    NOSE_Y + NOSE_RY * 0.55,
    NOSE_RX * 0.5,
    NOSE_RY * 0.3,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(HEAD_DEPTH * PROFILE_BROW_AT * toward, EYE_Y - BROW_DROP);
  ctx.rotate(-toward * BROW_ANGER * pose.brow);
  ctx.fillStyle = mix(SKIN.mid, OUTLINE, BROW_SHADE);
  ctx.beginPath();
  ctx.ellipse(0, 0, EYE_RX * 1.3, BROW_THICKNESS, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  drawProfileEye(ctx, toward, 1 - clamp01(pose.blink));

  // Edge-on the mouth is seen end-on, so it is drawn far narrower than the
  // head-on one. At full width the line ran out past the tip of her nose.
  ctx.save();
  ctx.translate(HEAD_DEPTH * PROFILE_MOUTH_AT * toward, 0);
  ctx.scale(toward * PROFILE_MOUTH_NARROW, 1);
  drawMouth(ctx, gape, 1);
  ctx.restore();
}

const PROFILE_MOUTH_NARROW = 0.62;
const EAR_SHADE = 0.3;
const NOSE_UNDERSHADE_ALPHA = 0.45;

/**
 * Fills the head's mass. Head-on that is the jowls with the cranium sitting
 * down on them — two shapes, because the jowls have to be *wider* than the
 * skull for the head to have a jaw at all; edge-on it is the one traced
 * silhouette, whose whole job is to have a front and a back.
 */
function fillHeadMass(
  ctx: Ctx,
  view: ViewSpec,
  toward: number,
  gape: number,
  grow: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  if (view.profile) {
    traceProfileSkull(ctx, toward, gape, grow);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.ellipse(
    0,
    JOWL_DROP + JAW_DROP * gape,
    JOWL_HALF * (1 + grow),
    JOWL_RY * (1 + grow),
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, HEAD_RX * (1 + grow), HEAD_RY * (1 + grow), 0, 0, TWO_PI);
  ctx.fill();
}

function drawHead(ctx: Ctx, pose: HoarderPose, view: ViewSpec, toward: number): void {
  const gape = clamp01(pose.mouth);
  const outlineGrow = OUTLINE_BLEED / HEAD_RY;

  fillHeadMass(ctx, view, toward, gape, outlineGrow, OUTLINE);
  fillHeadMass(ctx, view, toward, gape, 0, SKIN.mid);

  // The roll of chin under the jowls, which is what a missing neck looks like,
  // and it tapers off the jaw rather than matching it.
  ctx.fillStyle = mix(SKIN.mid, SKIN.dark, CHIN_ROLL_SHADE);
  ctx.beginPath();
  ctx.ellipse(
    view.profile ? HEAD_DEPTH * PROFILE_CHIN_ROLL_AT * toward : 0,
    CHIN_ROLL_DROP + JAW_DROP * gape * 0.6,
    JOWL_HALF * CHIN_ROLL_TAPER,
    CHIN_ROLL_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  if (view.showsFace) {
    ctx.save();
    ctx.translate(0, JAW_DROP * gape * FACE_FOLLOWS_JAW);
    if (view.profile) drawProfileFace(ctx, pose, toward);
    else drawFace(ctx, pose, toward);
    ctx.restore();
  }

  drawHair(ctx, pose, view);
}

const PROFILE_CHIN_ROLL_AT = 0.16;

const CHIN_ROLL_SHADE = 0.25;
/** How much of the jaw's travel the features ride down with. */
const FACE_FOLLOWS_JAW = 0.28;

// ── Throat and bile ──────────────────────────────────────────────────────────

const NECK_COLUMN_TOP = 0.55;
const BOLUS_RX = NECK_WIDTH * 0.85;
const BOLUS_RY = NECK_WIDTH * 0.62;

/**
 * The lump travelling up her throat. It is the single clearest cue that the
 * vomit is coming, and it exists because a wind-up that only opens a mouth is
 * indistinguishable from a shout at the size this is seen at.
 */
function drawThroat(ctx: Ctx, sk: Skeleton, pose: HoarderPose, view: ViewSpec): void {
  const top = mixPt(sk.shoulderCentre, sk.headCentre, NECK_COLUMN_TOP);
  const width = NECK_WIDTH * view.girth;
  outlineCapsule(ctx, sk.shoulderCentre, top, width, width * 0.86);
  fillCapsule(ctx, sk.shoulderCentre, top, width, width * 0.86, SKIN.dark);

  if (pose.throatBolus < 0) return;
  const travel = clamp01(pose.throatBolus);
  const at = mixPt(sk.shoulderCentre, top, travel);
  ctx.fillStyle = mix(SKIN.mid, SKIN.light, BOLUS_LIFT);
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, BOLUS_RX * view.girth, BOLUS_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = alpha(BOLUS_SHADE_ALPHA);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = BOLUS_RY * 0.24;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, BOLUS_RX * view.girth, BOLUS_RY, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const BOLUS_LIFT = 0.4;
const BOLUS_SHADE_ALPHA = 0.4;

const DROOL_MAX_LENGTH = HEAD_RY * 2.2;
const DROOL_WIDTH = HEAD_RX * 0.11;
const DROOL_BEAD_RATIO = 1.15;

/** A string of bile off the chin, drawn in head space. */
function drawDrool(ctx: Ctx, pose: HoarderPose): void {
  const amount = clamp01(pose.drool);
  if (amount <= 0) return;
  const length = DROOL_MAX_LENGTH * amount;
  const top = MOUTH_Y + JAW_DROP * clamp01(pose.mouth) * FACE_FOLLOWS_JAW + HEAD_RY * 0.2;
  ctx.strokeStyle = BILE_MID;
  ctx.lineWidth = DROOL_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.quadraticCurveTo(DROOL_WIDTH, top + length * 0.6, 0, top + length);
  ctx.stroke();
  ctx.fillStyle = BILE_BRIGHT;
  ctx.beginPath();
  ctx.arc(0, top + length, DROOL_WIDTH * DROOL_BEAD_RATIO, 0, TWO_PI);
  ctx.fill();
}

/**
 * The lick of bile leaving her mouth on the release frame and the two after it.
 * It is deliberately short — it exists to overlap the mouth so the sprite and
 * the projectile the fight spawns read as one event, not to be the attack.
 */
/**
 * Edge-on the bile is seen across its own travel, so it is a long lick; head-on
 * it is coming at the camera and foreshortens to a short broad splat. Drawn at
 * the profile's length in the front view it came out as a straight green bar
 * down her chest, which reads as a plank rather than as vomit.
 */
const SPRAY_REACH = HEAD_RY * 2.1;
const SPRAY_FACING_REACH = HEAD_RY * 1.15;
const SPRAY_FACING_SPREAD = 2.6;
/**
 * Narrow where it leaves her and lumpy along its length. A wide flat wedge off
 * the chin is a bib: what says *vomit* is that the stream is thinner than the
 * mouth it comes out of and breaks into gobs immediately.
 */
const SPRAY_ROOT_HALF = HEAD_RX * 0.2;
const SPRAY_TIP_HALF = HEAD_RX * 0.34;
const SPRAY_GOB_COUNT = 4;
const SPRAY_GOB_RADIUS = HEAD_RX * 0.19;
const SPRAY_OUTLINE_GROW = 1.35;
/** From behind it has to clear her own skull, so it comes past one cheek. */
const SPRAY_BEHIND_HEAD_AT = 1.05;
/** Edge-on it leaves forward and falls; head-on almost all of it is fall. */
const SPRAY_PROFILE_DIRECTION: Pt = { x: 0.86, y: 0.51 };
const SPRAY_FACING_DIRECTION: Pt = { x: 0.14, y: 0.99 };
/**
 * From behind, her own skull is between the camera and her mouth, so all that
 * can be seen is what clears the silhouette sideways. Given the front view's
 * downward throw it painted a green streak down her back instead.
 */
const SPRAY_BEHIND_DIRECTION: Pt = { x: 0.82, y: 0.34 };
const SPRAY_BEHIND_REACH = HEAD_RY * 0.7;

function drawBileSpray(ctx: Ctx, pose: HoarderPose, view: ViewSpec, toward: number): void {
  const amount = clamp01(pose.spray);
  if (amount <= 0) return;

  const direction = view.profile
    ? SPRAY_PROFILE_DIRECTION
    : view.showsBack
      ? SPRAY_BEHIND_DIRECTION
      : SPRAY_FACING_DIRECTION;
  const mouthX = view.profile
    ? HEAD_DEPTH * PROFILE_MOUTH_AT * toward
    : HEAD_RX * (view.showsBack ? SPRAY_BEHIND_HEAD_AT : 0);
  const mouthY = MOUTH_Y + JAW_DROP * clamp01(pose.mouth) * FACE_FOLLOWS_JAW;
  const reach =
    (view.profile ? SPRAY_REACH : view.showsBack ? SPRAY_BEHIND_REACH : SPRAY_FACING_REACH) *
    amount;
  const spread = view.profile || view.showsBack ? 1 : SPRAY_FACING_SPREAD;
  const tip = pt(mouthX + direction.x * reach * toward, mouthY + direction.y * reach);
  const across = pt(-direction.y * toward, direction.x);

  const streamAt = (rootHalf: number, tipHalf: number): void => {
    ctx.beginPath();
    ctx.moveTo(mouthX + across.x * rootHalf, mouthY + across.y * rootHalf);
    ctx.lineTo(tip.x + across.x * tipHalf, tip.y + across.y * tipHalf);
    ctx.lineTo(tip.x - across.x * tipHalf, tip.y - across.y * tipHalf);
    ctx.lineTo(mouthX - across.x * rootHalf, mouthY - across.y * rootHalf);
    ctx.closePath();
    ctx.fill();
  };

  const tipHalf = SPRAY_TIP_HALF * spread;
  ctx.fillStyle = OUTLINE;
  streamAt(SPRAY_ROOT_HALF * SPRAY_OUTLINE_GROW, tipHalf * SPRAY_OUTLINE_GROW);
  ctx.fillStyle = BILE_MID;
  streamAt(SPRAY_ROOT_HALF, tipHalf);

  for (let i = 0; i < SPRAY_GOB_COUNT; i++) {
    const along = (i + 1) / SPRAY_GOB_COUNT;
    const wander = (i % 2 === 0 ? 1 : -1) * tipHalf * 0.8;
    const at = pt(
      lerp(mouthX, tip.x, along) + across.x * wander,
      lerp(mouthY, tip.y, along) + across.y * wander,
    );
    const radius = SPRAY_GOB_RADIUS * lerp(1, 0.55, along);
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius * SPRAY_OUTLINE_GROW, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = i % 2 === 0 ? BILE_BRIGHT : BILE_MID;
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, TWO_PI);
    ctx.fill();
  }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/** Feet turn outward, away from the centreline, on both sides. */
const LEFT_FOOT_OUT = -1;
const RIGHT_FOOT_OUT = 1;
/**
 * Thumbs face *outboard*. Anatomically a hanging hand keeps its thumb forward,
 * which head-on points it at the camera where it has no silhouette at all; on
 * the outside edge it is the one bump that separates a hand from a mitten.
 */
const LEFT_THUMB = 1;
const RIGHT_THUMB = -1;

const SHADOW_LIFT_FADE = 2.4;
const SHADOW_LIFT_SHRINK = 0.6;
/**
 * How much of the torso's lean the head copies. A head that stays nearly level
 * is what keeps a leaning figure reading as upright rather than as hunched.
 */
const HEAD_LEAN_FOLLOW = 0.22;

const RIM_INSET = 0.03;

function drawRimLight(ctx: Ctx, sk: Skeleton, pose: HoarderPose, view: ViewSpec): void {
  ctx.save();
  traceTorso(ctx, sk, pose, view, 0);
  ctx.clip();
  ctx.globalAlpha = alpha(RIM_ALPHA);
  ctx.strokeStyle = RIM_LIGHT;
  ctx.lineWidth = RIM_INSET;
  traceTorso(ctx, sk, pose, view, -RIM_INSET * 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * An arm lying against a torso of the same colour disappears into it: the
 * outline is what separates them, and at the arm's own bleed it was a third of
 * a pixel at tile size. This one is drawn thick enough to survive the downscale.
 */
const ARM_OUTLINE_GROW = 0.018;

/**
 * The arm nearest the camera is lit as the nearest thing on the figure, which
 * puts its skin 28 luminance units off the torso's. The measured gap was 9 —
 * under 5% — and at the tile downscale an arm that close in value is not an arm
 * lying on a belly, it is a belly.
 */
const NEAR_ARM_SKIN: Ramp = {
  light: mix(SKIN.light, RIM_LIGHT, 0.3),
  mid: SKIN.light,
  dark: SKIN.mid,
};

/** How far the arm's shadow is thrown across the body, and how dark it lands. */
const ARM_CONTACT_OFFSET = 0.032;
const ARM_CONTACT_SPREAD = 1.2;
const ARM_CONTACT_ALPHA = 0.3;

/**
 * The shadow the near arm casts onto the body under it. Value alone separates
 * two shapes only where they meet an edge; the cast shadow is what makes the
 * arm sit *in front of* the belly rather than beside it.
 */
function drawArmContactShadow(
  ctx: Ctx,
  sk: Skeleton,
  pose: HoarderPose,
  view: ViewSpec,
  chain: BoneChain,
): void {
  const dx = -LIGHT.x * ARM_CONTACT_OFFSET;
  const dy = -LIGHT.y * ARM_CONTACT_OFFSET;
  ctx.save();
  traceTorso(ctx, sk, pose, view, 0);
  ctx.clip();
  ctx.globalAlpha = alpha(ARM_CONTACT_ALPHA);
  fillCapsule(
    ctx,
    offset(chain.root, dx, dy),
    offset(chain.joint, dx, dy),
    ARM_SHAPE.root * ARM_CONTACT_SPREAD,
    ARM_SHAPE.joint * ARM_CONTACT_SPREAD,
    OUTLINE,
  );
  fillCapsule(
    ctx,
    offset(chain.joint, dx, dy),
    offset(chain.end, dx, dy),
    ARM_SHAPE.joint * ARM_CONTACT_SPREAD,
    ARM_SHAPE.belly * ARM_CONTACT_SPREAD,
    OUTLINE,
  );
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Dirt on the arm. Sampled off a render, her arms held exactly two colours
 * across every frame of the sheet — the fill and its sheen — which is a clean
 * arm however grimy the vest beside it is. Placed well inside the limb's own
 * half-width so no blotch can reach the outline and read as a bite.
 */
const ARM_GRIME_ALPHA = 0.2;
const ARM_GRIME_SPOTS: readonly (readonly [number, number, number])[] = [
  [0.34, -0.3, 0.045],
  [0.72, 0.24, 0.03],
  [1.35, -0.2, 0.038],
] as const;

function drawLimbGrime(ctx: Ctx, chain: BoneChain, shape: LimbShape): void {
  const along = angleBetween(chain.root, chain.joint) + HALF_PI;
  const nx = Math.cos(along);
  const ny = Math.sin(along);
  ctx.globalAlpha = alpha(ARM_GRIME_ALPHA);
  ctx.fillStyle = STAIN_GRIME;
  for (const [at, across, size] of ARM_GRIME_SPOTS) {
    const spine =
      at <= 1 ? mixPt(chain.root, chain.joint, at) : mixPt(chain.joint, chain.end, at - 1);
    const width = at <= 1 ? lerp(shape.root, shape.joint, at) : shape.belly;
    ctx.beginPath();
    ctx.ellipse(
      spine.x + nx * across * width,
      spine.y + ny * across * width,
      size,
      size * 0.72,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawArm(
  ctx: Ctx,
  chain: BoneChain,
  fist: number,
  ramp: Ramp,
  shade: number,
  thumb: number,
): void {
  drawLimb(ctx, chain, ARM_SHAPE, ramp, shade, ARM_OUTLINE_GROW);
  drawLimbGrime(ctx, chain, ARM_SHAPE);
  drawJointDimple(ctx, chain, ELBOW_WIDTH);
  drawHand(ctx, chain, fist, thumb, ramp);
}

function drawLeg(
  ctx: Ctx,
  chain: BoneChain,
  pitch: number,
  view: ViewSpec,
  turnOut: number,
  nearness: number,
): void {
  drawLimb(ctx, chain, legShapeFor(nearness), SKIN, UNSHADED);
  drawFoot(ctx, chain.end, pitch, view, turnOut);
}

function drawFigure(ctx: Ctx, view: ViewSpec, pose: HoarderPose, toward: number): void {
  const skeleton = buildSkeleton(pose, view);
  // The figure is airborne only when the *lower* foot leaves the floor. `y` is
  // negative upward, so that is `Math.max`; reading `Math.min` picks whichever
  // foot is raised and fades the shadow through every ordinary stride while a
  // real jump — both feet up — never registers at all.
  const lift = Math.max(0, -Math.max(pose.leftFoot.y, pose.rightFoot.y));
  const shadowFade = clamp01(1 - lift * SHADOW_LIFT_FADE);
  drawGroundShadow(
    ctx,
    skeleton.hip.x * SHADOW_FOLLOW,
    SHADOW_RX * lerp(SHADOW_LIFT_SHRINK, 1, shadowFade),
    SHADOW_RY * lerp(SHADOW_LIFT_SHRINK, 1, shadowFade),
    CONTACT_SHADOW_ALPHA * shadowFade,
  );

  // Edge-on the far arm is genuinely behind the body and takes a depth shade;
  // head-on neither arm is behind anything, and a shade there reads as two
  // different colours of skin rather than as depth.
  const farArmShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  const leftBehind = view.profile || pose.leftArmBehind;
  const rightBehind = !view.profile && pose.rightArmBehind;
  if (leftBehind) drawArm(ctx, skeleton.leftArm, pose.leftFist, SKIN, farArmShade, LEFT_THUMB);
  if (rightBehind) drawArm(ctx, skeleton.rightArm, pose.rightFist, SKIN, farArmShade, RIGHT_THUMB);

  drawLeg(ctx, skeleton.leftLeg, pose.leftFootPitch, view, LEFT_FOOT_OUT, pose.leftLegNearness);
  drawLeg(ctx, skeleton.rightLeg, pose.rightFootPitch, view, RIGHT_FOOT_OUT, pose.rightLegNearness);
  drawTrousers(ctx, skeleton, view, {
    left: { chain: skeleton.leftLeg, shape: legShapeFor(pose.leftLegNearness) },
    right: { chain: skeleton.rightLeg, shape: legShapeFor(pose.rightLegNearness) },
  });

  drawTorsoFlesh(ctx, skeleton, pose, view);
  drawVest(ctx, skeleton, pose, view);
  // After the torso, not before it: painted first the torso covers the neck
  // outright and the bolus climbing her throat — the one cue that says the
  // vomit is coming rather than a shout — is never visible at all.
  drawThroat(ctx, skeleton, pose, view);
  drawRimLight(ctx, skeleton, pose, view);

  // The near arms go down before the head, not after it. Painted last, the
  // shoulder cap of the near arm sits over her own jaw in profile — and it does
  // it on exactly the frames the jaw is unhinged and the bile is leaving it.
  // Head-on the arms hang far outside the head and the order costs nothing.
  if (!leftBehind) {
    drawArmContactShadow(ctx, skeleton, pose, view, skeleton.leftArm);
    drawArm(ctx, skeleton.leftArm, pose.leftFist, NEAR_ARM_SKIN, UNSHADED, LEFT_THUMB);
  }
  if (!rightBehind) {
    drawArmContactShadow(ctx, skeleton, pose, view, skeleton.rightArm);
    drawArm(ctx, skeleton.rightArm, pose.rightFist, NEAR_ARM_SKIN, UNSHADED, RIGHT_THUMB);
  }

  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(pose.headTilt + pose.lean * HEAD_LEAN_FOLLOW);
  drawHead(ctx, pose, view, toward);
  if (view.showsFace) drawDrool(ctx, pose);
  // The spray is drawn from behind too. Seen from the back her own head hides
  // the mouth, but nothing coming out at all made the back-facing attack the
  // one direction with no tell whatsoever.
  drawBileSpray(ctx, pose, view, toward);
  ctx.restore();
}

/** The Hoarder seen head-on, coming at the camera. */
export function drawHoarderFront(ctx: Ctx, pose: HoarderPose): void {
  drawFigure(ctx, VIEWS.front, pose, 1);
}

/** The Hoarder seen from behind, walking away. */
export function drawHoarderBack(ctx: Ctx, pose: HoarderPose): void {
  drawFigure(ctx, VIEWS.back, pose, 1);
}

/** In profile. Always drawn facing +X; the runtime mirrors for the other way. */
export function drawHoarderSide(ctx: Ctx, pose: HoarderPose): void {
  drawFigure(ctx, VIEWS.side, pose, 1);
}

export function drawHoarderView(ctx: Ctx, view: HoarderView, pose: HoarderPose): void {
  if (view === 'front') drawHoarderFront(ctx, pose);
  else if (view === 'back') drawHoarderBack(ctx, pose);
  else drawHoarderSide(ctx, pose);
}

/**
 * How far each leg is being *asked* to reach, before the solver clamps it.
 *
 * The solved chain is the wrong thing to measure: `solveTwoBone` clamps to
 * `LEG_REACH`, so a pose demanding twice her leg length reports exactly her leg
 * length and a gate reading it can only ever see equality.
 */
export function legReachDemand(
  pose: HoarderPose,
  view: HoarderView,
): { readonly left: number; readonly right: number } {
  const spec = VIEWS[view];
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * spec.lateral, -hipHeight + pose.bob);
  const hipHalf = LEG_ROOT_HALF * spec.lateral;
  const leftAnkle = ankleFor(pose.leftFoot, pose.leftFootPitch);
  const rightAnkle = ankleFor(pose.rightFoot, pose.rightFootPitch);
  return {
    left: Math.hypot(leftAnkle.x - (hip.x - hipHalf), leftAnkle.y - hip.y),
    right: Math.hypot(rightAnkle.x - (hip.x + hipHalf), rightAnkle.y - hip.y),
  };
}

/** Samples per cubic when the outline is measured rather than drawn. */
const CURVATURE_SAMPLES_PER_SEGMENT = 48;

/** The tightest turn found on a torso edge, and the height it happens at. */
export interface OutlineCurvature {
  /** Radius of the osculating circle in tile units. Small means a corner. */
  readonly radius: number;
  readonly y: number;
}

function pointOnCubic(segment: EdgeSegment, t: number): TorsoEdge {
  const u = 1 - t;
  const fromWeight = u * u * u;
  const control1Weight = 3 * u * u * t;
  const control2Weight = 3 * u * t * t;
  const toWeight = t * t * t;
  return {
    x:
      fromWeight * segment.from.x +
      control1Weight * segment.control1.x +
      control2Weight * segment.control2.x +
      toWeight * segment.to.x,
    y:
      fromWeight * segment.from.y +
      control1Weight * segment.control1.y +
      control2Weight * segment.control2.y +
      toWeight * segment.to.y,
  };
}

/**
 * The tightest corner on the flesh silhouette between the shoulders and the
 * bottom of the apron.
 *
 * A body has no corners. Two stations set close in height with a large width
 * step between them produce a curve whose radius is a fraction of a sheet pixel
 * — geometrically a curve, visually a crease — and neither the code nor a
 * typecheck shows it. Only the radius does.
 */
export function torsoOutlineCurvature(pose: HoarderPose, view: HoarderView): OutlineCurvature {
  const spec = VIEWS[view];
  const skeleton = buildSkeleton(pose, spec);
  let tightest: OutlineCurvature = { radius: Infinity, y: 0 };
  for (const sign of [1, -1]) {
    const segments = edgeSegments(torsoEdges(skeleton, pose, spec, 0, sign), true);
    // Sampled half-open, then closed once at the end. Sampling each cubic over
    // the whole range repeats every station — the end of one segment and the
    // start of the next are the same point — and a repeated point has a
    // zero-length step either side of it, which is exactly the sample that gets
    // skipped below. The station is the only place two cubics meet, and a join
    // is where a spline stops being smooth: measuring everything except the
    // joins would leave the gate blind to the defect it was written for.
    const points: TorsoEdge[] = [];
    for (const segment of segments) {
      for (let step = 0; step < CURVATURE_SAMPLES_PER_SEGMENT; step++) {
        points.push(pointOnCubic(segment, step / CURVATURE_SAMPLES_PER_SEGMENT));
      }
    }
    const lastSegment = segments[segments.length - 1];
    if (lastSegment !== undefined) points.push(lastSegment.to);
    for (let i = 1; i < points.length - 1; i++) {
      const before = points[i - 1];
      const here = points[i];
      const after = points[i + 1];
      if (before === undefined || here === undefined || after === undefined) continue;
      const inX = here.x - before.x;
      const inY = here.y - before.y;
      const outX = after.x - here.x;
      const outY = after.y - here.y;
      const inLength = Math.hypot(inX, inY);
      const outLength = Math.hypot(outX, outY);
      if (inLength === 0 || outLength === 0) continue;
      const turn = Math.abs(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY));
      if (turn === 0) continue;
      const radius = (inLength + outLength) / 2 / turn;
      if (radius < tightest.radius) tightest = { radius, y: here.y };
    }
  }
  return tightest;
}

export { hump, mix, clamp01, deg, lerp };
export type { Ramp };
