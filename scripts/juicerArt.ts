/**
 * The Juicer painter.
 *
 * An enormous roided-out lizard bro: a small skull on a colossal frame, a
 * trapezius that climbs toward the ears, a lat flare far wider than the pelvis,
 * legs that are thick but visibly the least-worked thing on him, and a heavy
 * tapering tail carried off the floor. Scaled hide in two ramps — an olive
 * dorsal and a pale belly-plate underside that doubles as pec and ab definition
 * at a 32 px tile — over gym shorts and lifting wraps.
 *
 * Coordinates are tile units with the origin at the point between the feet and
 * +Y pointing down the screen, so heights above the ground are negative. The
 * generator translates to that ground point, scales by one tile, and calls one
 * of the three painters. The side view is always drawn facing +X; the runtime
 * mirrors it for the other direction.
 *
 * The rig — the view table, the two-bone IK, the FK escape hatch for swinging
 * arms, and "every pose is an edit to one resting pose" — is taken from
 * `carlArt.ts`, which is the only figure in this game whose movement convinces.
 * Enrage is deliberately not painted here: it is a runtime filter over these
 * same rows, because five states across three views would double a sheet that
 * is already the largest creature bake in the game.
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

/**
 * The dorsal hide: a saturated olive-jade. Deliberately well clear of both
 * dungeon floor mids — a creature painted at the floor's own luminance is a
 * smudge at 32 px however good its silhouette is.
 */
const HIDE: Ramp = { dark: '#1d3320', mid: '#5f8a3c', light: '#9dc25a' };
/**
 * The underside: belly plates down the chest, abdomen and tail.
 *
 * It stays in the hide's own hue family — green-forward, with a green-minus-red
 * spread at least as wide as `HIDE.mid`'s — and earns its separation from
 * luminance alone. A plate desaturated toward khaki is not lit skin: it is a
 * second material, and at tile size a bodybuilder's chest painted in it reads
 * as a tank top rather than as muscle. The step up from the hide is deliberately
 * enormous, because the sheet is downsampled 2× before anyone sees it and a
 * subtle ramp does not survive that.
 */
const BELLY: Ramp = { dark: '#2c4a1e', mid: '#9ed15a', light: '#d6f894' };
const OUTLINE = '#0d1408';
/** Warm enough to separate from the hide's own highlight at a glance. */
const RIM_LIGHT = '#e8ffb0';
const RIM_ALPHA = 0.42;
const CONTACT_SHADOW_ALPHA = 0.44;

const SHORTS: Ramp = { dark: '#241033', mid: '#54216e', light: '#8b45ab' };
const GLOVE: Ramp = { dark: '#2a1408', mid: '#6a3a1c', light: '#a4652f' };
const CLAW: Ramp = { dark: '#39311d', mid: '#9a8a63', light: '#ded0a6' };
const MAW_INNER = '#4d1420';
const TOOTH = '#efe6c8';
/** A reptile's eye: a hot iris with a vertical slit, not a mammal's sclera. */
const EYE_IRIS = '#e8b427';
const EYE_SLIT = '#100c06';
const EYE_SPARK = '#ffffff';
const NOSTRIL = '#1a2411';

/** Where the key light comes from, as a direction in figure space. */
const LIGHT: Pt = { x: -0.6, y: -0.8 };
/** How far a far-side limb is pushed toward the outline so it recedes. */
const FAR_LIMB_SHADE = 0.3;
/** Painted at its own ramp, with nothing mixed toward the outline. */
const UNSHADED = 0;
/**
 * How far the near arm is lifted toward the hide's highlight in profile.
 *
 * Negative shade, because a limb in front of the body is not in shadow — it is
 * closer to the light. Left at the body's own tone it is a shape separated from
 * the trunk by one dark line, and one dark line down a torso is a seam.
 */
const NEAR_LIMB_LIFT = -0.3;

/** A limb's fill: positive shade recedes toward the ink, negative advances. */
function limbTone(base: string, shade: number): string {
  return shade >= 0 ? mix(base, OUTLINE, shade) : mix(base, HIDE.light, -shade);
}

// ── Proportions ──────────────────────────────────────────────────────────────
// Heights are y values, so they are negative: the origin sits between the feet
// and the screen's +Y runs down.

/**
 * Total standing height. He towers over the human crawler, who stands 2.03, and
 * being visibly the biggest thing on the floor is half of what makes the fight
 * read before a single attack plays.
 */
export const FIGURE_HEIGHT = 2.3;
/**
 * Deliberately fewer heads than a human figure's. Head count is how size is
 * read: a giant needs *fewer* heads of height, and a small skull on a huge
 * frame is also exactly the bodybuilder silhouette.
 */
const HEADS_TALL = 4.2;
const HEAD_HEIGHT = FIGURE_HEIGHT / HEADS_TALL;

const ANKLE_Y = -0.1;
const KNEE_Y = -0.5;
/**
 * The hip sits at 41% of standing height rather than the human's 47%. Short
 * legs under a long trunk is both the "never skips upper body day, always skips
 * leg day" joke and the top-heavy read the silhouette needs.
 */
const HIP_Y = -0.95;
const WAIST_Y = -1.16;
const CHEST_Y = -1.44;
export const SHOULDER_Y = -1.7;
/**
 * Close enough that the jaw sits just above the trapezius. A neck with daylight
 * around it reads as a lizard's head balanced on a bodybuilder, and the throat
 * wedge paints the remaining gap shut.
 */
const HEAD_CENTRE_Y = -2.03;

/**
 * How much longer the bones are than the column they stand in. He stands with
 * visibly loaded knees, which both suits the mass and buys the IK the headroom
 * it needs to take a stride without clamping — a clamped frame locks the leg
 * straight and the step reads as a hop.
 */
const KNEE_BEND_SLACK = 1.05;
const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * KNEE_BEND_SLACK;
const SHIN_LENGTH = Math.abs(KNEE_Y - ANKLE_Y) * KNEE_BEND_SLACK;
export { THIGH_LENGTH, SHIN_LENGTH };

/**
 * Arms long and heavy enough to matter in the silhouette. The upper arm carries
 * more of the length than a human's does, because the biceps is the single
 * shape the whole character is about.
 *
 * Their total also has to reach the floor once he folds into the slam. An arm
 * short of that cannot be made to reach it by any amount of lean — the pitch
 * needed to drop the shoulder far enough throws the skull out past the fist,
 * and a ground punch whose head leads its own hand is a dive.
 */
export const UPPER_ARM_LENGTH = 0.5;
export const FOREARM_LENGTH = 0.44;
/** Shoulder to wrist. A relaxed arm hangs at very nearly this. */
const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

/**
 * Half the shoulder span. A human's is about 0.138 of his standing height; the
 * lat flare here is set well past that, and the resulting near-half-a-body-
 * height of shoulder is what survives the downsample as "absurdly muscular".
 */
const HUMAN_SHOULDER_SHARE = 0.138;
const TORSO_BREADTH_MULTIPLE = 1.78;
const SHOULDER_HALF = FIGURE_HEIGHT * HUMAN_SHOULDER_SHARE * TORSO_BREADTH_MULTIPLE;
const CHEST_HALF = SHOULDER_HALF * 0.92;
/**
 * The pinch of the V. A waist wider than this and the lat flare stops reading
 * as a flare at all; narrower and the trunk breaks in half at tile size.
 */
const WAIST_HALF = SHOULDER_HALF * 0.6;
/**
 * Hips must never approach the shoulders — that is the barrel silhouette — and
 * here they are deliberately far under them.
 */
const HIP_HALF = SHOULDER_HALF * 0.53;

/** Arms root just inside the shoulder's edge, not inside the body's silhouette. */
const ARM_INSET = 0.97;
export const ARM_ROOT_HALF = SHOULDER_HALF * ARM_INSET;
/** The arm's root hangs this far below the shoulder line, not on it. */
const SHOULDER_JOINT_DROP = 0.06;
/**
 * How far the trapezius climbs above the shoulder line toward the skull. This
 * is the one shape that says "this creature lifts" from across a room.
 */
const TRAP_RISE = 0.13;
/** How far in from the shoulder edge the trap's slope begins. */
const TRAP_INBOARD = 0.52;

/**
 * Where the thigh roots, measured out from the hip centre. It cannot be
 * narrower than the thigh's own half-width or the two thighs merge into one
 * wedge splitting downward.
 */
const LEG_ROOT_HALF = 0.27;

/**
 * The quadriceps. He skips leg day relative to his own chest, not relative to
 * a person: a thigh narrower than the arm hanging beside it reads as a stick
 * figure wearing a barrel, so the thigh is drawn wider than the upper arm and
 * the joke is carried by the leg's *length* instead.
 *
 * "Wider than the upper arm" is measured against what the arm actually paints,
 * which is the deltoid cap and the biceps belly on top of the humerus, not the
 * bare bone width — a thigh matched to the humerus alone still comes out
 * visibly thinner than the arm hanging beside it.
 */
const THIGH_WIDTH = 0.2;
/**
 * The vastus lateralis sweep: the thigh's widest point, and it is low and
 * outboard rather than at the hip. A thigh tapering straight from hip to knee
 * is a cone; what says quadriceps is the bulge sitting just above the knee.
 */
const QUAD_WIDTH = 0.26;
/** Below the shorts hem, so the sweep is bare hide rather than cloth. */
const QUAD_AT = 0.58;
const KNEE_WIDTH = 0.13;
const CALF_WIDTH = 0.225;
const ANKLE_WIDTH = 0.09;
/** How far down the shin the calf reaches its widest. */
const CALF_AT = 0.3;
/** The biceps: the single shape the whole character is about. */
const UPPER_ARM_WIDTH = 0.17;
const ELBOW_WIDTH = 0.105;
const WRIST_WIDTH = 0.078;

/**
 * A narrow skull. Small relative to the frame, taller than it is wide head-on
 * and deeper than it is tall in profile — two radii, because a round head makes
 * any jaw under it read as blocky however narrow the jaw is drawn.
 */
const HEAD_WIDTH_RATIO = 0.8;
const HEAD_DEPTH_RATIO = 1.15;
const HEAD_RY = HEAD_HEIGHT / 2;
const HEAD_RX = HEAD_RY * HEAD_WIDTH_RATIO;
const HEAD_DEPTH = HEAD_RY * HEAD_DEPTH_RATIO;

/** Side-on, the limbs gather toward the centreline instead of splaying wide. */
const PROFILE_LATERAL = 0.3;

// ── Views ────────────────────────────────────────────────────────────────────

export type JuicerView = 'front' | 'back' | 'side';

interface ViewSpec {
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
  /**
   * Multiplier on the torso's drawn width. A chest this broad is nowhere near
   * as deep as it is wide, so the two factors have to be separate: compressing
   * the trunk by the limb spacing alone makes a plank.
   */
  readonly girth: number;
  /** Extra trim on the hips, which are shallower than the chest. */
  readonly hipDepth: number;
  /** Narrows the shoulders and chest in profile without touching the waist. */
  readonly chestTaper: number;
  /**
   * How far apart the two shoulder joints are drawn. Edge-on they are almost
   * the same point; given the full half-width the arms angle inward and cross
   * the chest.
   */
  readonly armSpread: number;
  /**
   * How far behind the trunk's own centre the shoulder line is drawn, edge-on.
   *
   * Zero head-on, where the two joints are genuinely left and right of the
   * spine. In profile they project onto each other, so they are spread fore and
   * aft to show both arms — and that spread is hung behind centre because a
   * shoulder does sit behind the front plane of the chest, and because a near
   * arm swung forward off a joint level with the sternum reaches further out in
   * front of him than anything else on the sheet and sets the width of all 256
   * cells, blank ones included.
   */
  readonly armBack: number;
  /** True when the figure is seen edge-on rather than head-on. */
  readonly profile: boolean;
  /** True when the face is toward the camera. */
  readonly showsFace: boolean;
  /**
   * How far the skull is turned off square, −1 to 1, before the pose's own
   * head turn is added. Head-on it is never zero: a snout square to the camera
   * projects to a stub, so the head-on rows carry a permanent three-quarter
   * turn and the muzzle is foreshortened rather than shortened.
   */
  readonly headYaw: number;
}

const PROFILE_GIRTH = 0.82;
const PROFILE_HIP_DEPTH = 0.9;
const PROFILE_ARM_SPREAD = 0.34;
const PROFILE_ARM_BACK = 0.12;
const PROFILE_CHEST_TAPER = 0.9;
/** The permanent three-quarter turn the head-on rows are drawn with. */
const FACING_HEAD_YAW = 0.62;

const VIEWS: Record<JuicerView, ViewSpec> = {
  front: {
    lateral: 1,
    girth: 1,
    hipDepth: 1,
    chestTaper: 1,
    armSpread: 1,
    armBack: 0,
    profile: false,
    showsFace: true,
    headYaw: FACING_HEAD_YAW,
  },
  back: {
    lateral: 1,
    girth: 1,
    hipDepth: 1,
    chestTaper: 1,
    armSpread: 1,
    armBack: 0,
    profile: false,
    showsFace: false,
    headYaw: -FACING_HEAD_YAW,
  },
  side: {
    lateral: PROFILE_LATERAL,
    girth: PROFILE_GIRTH,
    hipDepth: PROFILE_HIP_DEPTH,
    chestTaper: PROFILE_CHEST_TAPER,
    armSpread: PROFILE_ARM_SPREAD,
    armBack: PROFILE_ARM_BACK,
    profile: true,
    showsFace: true,
    headYaw: 1,
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
 * One frame of the Juicer. Hand and foot positions are targets in figure space
 * that the limb solver reaches for, so the choreography never has to think
 * about joint angles. `left`/`right` are the figure's own; in the profile view
 * the right side is the near one, closest to the camera.
 */
export interface JuicerPose {
  /** Whole-body vertical offset; negative lifts it off the ground. */
  bob: number;
  /** Hip shift along X — weight transfer, not a step. */
  sway: number;
  /** Torso lean in radians; positive tips the shoulders toward +X. */
  lean: number;
  /**
   * How far the hips sink. 0 stands tall and 1 is a loaded crouch; the slam
   * goes past 1 and folds him into a squat, which is the only way his fists
   * reach the floor without the lean throwing his skull out past them.
   */
  crouch: number;
  /** Shoulder rotation about the spine, −1 to 1, seen as a width shift. */
  twist: number;
  /** Head turn, −1 to 1, added to the view's own three-quarter yaw. */
  headTurn: number;
  /** Head tilt in radians; positive drops the muzzle toward +X. */
  headTilt: number;
  /** 0 eyes open, 1 shut. */
  blink: number;
  /** Eye bulge past resting size, 0 to 1 — the roid glare. */
  glare: number;
  /** 0 closed jaw, 1 full gape. */
  maw: number;
  /** How far the chest is puffed past its resting width, 0 to 1. */
  flex: number;
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
  /** Tail sweep across the body, −1 to 1. Positive swings toward +X. */
  tailSwing: number;
  /** How high the tail rides, 0 hanging low to 1 streaming out level. */
  tailLift: number;
}

export interface BoneChain {
  root: Pt;
  joint: Pt;
  end: Pt;
}

/**
 * How far outboard of its own shoulder joint a hanging hand sits.
 *
 * Small, because the widest point of the whole figure has to be the deltoids.
 * Hung wide the forearms fill the gap either side of the waist, the outline
 * stops narrowing below the chest and the V-taper inverts — the silhouette then
 * widens on its way down, which is the one thing a bodybuilder's never does.
 */
const HAND_HANG_OUT = -0.05;
export const HAND_HANG_SPREAD = ARM_ROOT_HALF + HAND_HANG_OUT;
/**
 * A relaxed arm reaches nearly, but not quite, its full length. The slack has
 * to be real: the shoulder root swings a little under the idle's lean, and an
 * arm hung at 99% of its reach has the IK clamping on the frames where it does.
 *
 * It cannot be much slacker than this either. The elbow's sideways bow grows as
 * the square root of the slack, and a hanging elbow bowed past the deltoid
 * above it is the widest point of the figure.
 */
const ARM_HANG_REACH = ARM_LENGTH * 0.975;
export const HAND_HANG_DROP =
  SHOULDER_JOINT_DROP + Math.sqrt(ARM_HANG_REACH * ARM_HANG_REACH - HAND_HANG_OUT * HAND_HANG_OUT);
/**
 * Feet stand under the hips. Any wider and the thighs angle out to reach them,
 * which reads as knock-kneed however subtle the knee itself is.
 */
export const FOOT_STAND_SPREAD = 0.2;
const RESTING_FIST = 0.4;
export const ELBOW_BEHIND = 1;
export const ELBOW_IN_FRONT = -1;
const RESTING_ELBOW_FLARE = ELBOW_BEHIND;
const RESTING_TAIL_LIFT = 0.3;

/** A relaxed standing pose. Every animation is written as edits to this. */
export function restingPose(): JuicerPose {
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
    flex: 0,
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
    tailSwing: 0,
    tailLift: RESTING_TAIL_LIFT,
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

/** The ankle for a foot planted at `target`: up the leg by the foot's height. */
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
const TWIST_WIDTH_GAIN = 0.15;
const TWIST_SHOULDER_SHIFT = 0.06;
const CROUCH_DROP = 0.3;
/** How far across its own half-width a full head turn slides the face. */
const HEAD_TURN_TRAVEL = 0.42;

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

function buildSkeleton(pose: JuicerPose, view: ViewSpec): Skeleton {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);

  const waist = spinePoint(hip, Math.abs(WAIST_Y - HIP_Y), pose.lean);
  const chest = spinePoint(hip, Math.abs(CHEST_Y - HIP_Y), pose.lean);
  const shoulderCentre = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y), pose.lean);
  const headRest = spinePoint(hip, Math.abs(HEAD_CENTRE_Y - HIP_Y), pose.lean);
  const headCentre = offset(headRest, pose.headTurn * HEAD_RX * view.lateral * HEAD_TURN_TRAVEL, 0);

  const twistShift = pose.twist * TWIST_SHOULDER_SHIFT * view.lateral;
  const armRoot = ARM_ROOT_HALF * view.armSpread;
  const leftHalf = armRoot * (1 - pose.twist * TWIST_WIDTH_GAIN);
  const rightHalf = armRoot * (1 + pose.twist * TWIST_WIDTH_GAIN);
  const leftShoulder = offset(
    shoulderCentre,
    -leftHalf + twistShift - view.armBack,
    SHOULDER_JOINT_DROP,
  );
  const rightShoulder = offset(
    shoulderCentre,
    rightHalf + twistShift - view.armBack,
    SHOULDER_JOINT_DROP,
  );
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
export function solvedArm(pose: JuicerPose, view: JuicerView, side: 'left' | 'right'): BoneChain {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftArm : skeleton.rightArm;
}

/** The solved leg chain, so a check on the knee measures what the painter draws. */
export function solvedLeg(pose: JuicerPose, view: JuicerView, side: 'left' | 'right'): BoneChain {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftLeg : skeleton.rightLeg;
}

/** Where a leg roots, for the gate that checks the leg never over-reaches. */
export function solvedLegRoot(pose: JuicerPose, view: JuicerView, side: 'left' | 'right'): Pt {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return side === 'left' ? skeleton.leftLeg.root : skeleton.rightLeg.root;
}

/** The shoulder line's centre, for the gate that checks the sprint leans. */
export function solvedShoulderCentre(pose: JuicerPose, view: JuicerView): Pt {
  return buildSkeleton(pose, VIEWS[view]).shoulderCentre;
}

/** The hip point, for the gate that checks the sprint leads with the shoulders. */
export function solvedHip(pose: JuicerPose, view: JuicerView): Pt {
  return buildSkeleton(pose, VIEWS[view]).hip;
}

// ── Painting primitives ──────────────────────────────────────────────────────

const OUTLINE_BLEED = 0.026;
const TWO_PI = Math.PI * 2;

/**
 * Adds a capsule as a fresh subpath of whatever path is already open. Every
 * subpath is wound the same way, so several of them fill and clip as their
 * union rather than punching each other out.
 */
function appendCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const angle = angleBetween(a, b);
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  ctx.moveTo(a.x + nx * wa, a.y + ny * wa);
  ctx.arc(a.x, a.y, wa, angle + Math.PI / 2, angle - Math.PI / 2);
  ctx.lineTo(b.x + nx * -wb, b.y + ny * -wb);
  ctx.arc(b.x, b.y, wb, angle - Math.PI / 2, angle + Math.PI / 2);
  ctx.closePath();
}

function traceCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  ctx.beginPath();
  appendCapsule(ctx, a, b, wa, wb);
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
const SHEEN_WIDTH_SHARE = 0.66;

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

/**
 * A limb's outline as five widths along its two bones: the root, a belly on the
 * upper bone, the joint, a belly on the lower bone, and the tip.
 *
 * The upper belly is what separates a limb from a pair of stacked cones. A
 * thigh with no swell above the knee has no quadriceps in its *outline*, and
 * definition that never breaks the silhouette does not survive the downsample
 * however carefully it is shaded inside.
 */
interface LimbShape {
  readonly root: number;
  readonly mid: number;
  readonly midAt: number;
  readonly joint: number;
  readonly belly: number;
  readonly tip: number;
  readonly bellyAt: number;
}

const LEG_SHAPE: LimbShape = {
  root: THIGH_WIDTH,
  mid: QUAD_WIDTH,
  midAt: QUAD_AT,
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
  mid: QUAD_WIDTH,
  midAt: QUAD_AT,
  joint: QUAD_WIDTH,
  belly: CALF_WIDTH * 1.16,
  tip: ANKLE_WIDTH * 1.14,
  bellyAt: 0.5,
};

function legShapeFor(nearness: number): LimbShape {
  const t = clamp01(nearness);
  if (t <= 0) return LEG_SHAPE;
  return {
    root: lerp(LEG_SHAPE.root, NEAR_LEG_SHAPE.root, t),
    mid: lerp(LEG_SHAPE.mid, NEAR_LEG_SHAPE.mid, t),
    midAt: lerp(LEG_SHAPE.midAt, NEAR_LEG_SHAPE.midAt, t),
    joint: lerp(LEG_SHAPE.joint, NEAR_LEG_SHAPE.joint, t),
    belly: lerp(LEG_SHAPE.belly, NEAR_LEG_SHAPE.belly, t),
    tip: lerp(LEG_SHAPE.tip, NEAR_LEG_SHAPE.tip, t),
    bellyAt: lerp(LEG_SHAPE.bellyAt, NEAR_LEG_SHAPE.bellyAt, t),
  };
}

/** The upper bone's two capsules: root to its own belly, belly to the joint. */
function appendUpperLimb(ctx: Ctx, chain: BoneChain, shape: LimbShape, grow: number): void {
  const mid = mixPt(chain.root, chain.joint, shape.midAt);
  appendCapsule(ctx, chain.root, mid, shape.root + grow, shape.mid + grow);
  appendCapsule(ctx, mid, chain.joint, shape.mid + grow, shape.joint + grow);
}

/** The whole limb: both bones, each with its own belly along it. */
function appendLimb(ctx: Ctx, chain: BoneChain, shape: LimbShape, grow: number): void {
  const belly = mixPt(chain.joint, chain.end, shape.bellyAt);
  appendUpperLimb(ctx, chain, shape, grow);
  appendCapsule(ctx, chain.joint, belly, shape.joint + grow, shape.belly + grow);
  appendCapsule(ctx, belly, chain.end, shape.belly + grow, shape.tip + grow);
}

const LIMB_SHEEN_ALPHA = 0.18;
/** How dark the scale banding runs against the hide it crosses. */
const SCALE_BAND_ALPHA = 0.26;
const LIMB_SCALE_BANDS = 3;

/**
 * Draws a two-segment limb: outline, fill, muscle sheen, then a few scale bands
 * across it. The bands are the only interior detail on a limb — at tile size
 * they survive as a texture rather than as lines, and anything finer dissolves.
 */
function drawLimb(ctx: Ctx, chain: BoneChain, shape: LimbShape, shade: number): void {
  const belly = mixPt(chain.joint, chain.end, shape.bellyAt);
  const skin = limbTone(HIDE.mid, shade);
  const lit = limbTone(HIDE.light, Math.max(0, shade));

  ctx.beginPath();
  appendLimb(ctx, chain, shape, OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.beginPath();
  appendLimb(ctx, chain, shape, 0);
  ctx.fillStyle = skin;
  ctx.fill();

  // Clipped to the segments they light. A sheen is offset by the limb's own
  // half-width, so a third of the stroke lies outside the outline: unclipped it
  // bakes a pale streak floating in the background beside every limb.
  ctx.save();
  ctx.beginPath();
  appendLimb(ctx, chain, shape, 0);
  ctx.clip();
  sheenSegment(ctx, chain.root, chain.joint, shape.mid, lit, LIMB_SHEEN_ALPHA);
  sheenSegment(ctx, chain.joint, belly, shape.belly, lit, LIMB_SHEEN_ALPHA);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  appendUpperLimb(ctx, chain, shape, 0);
  ctx.clip();
  const across = angleBetween(chain.root, chain.joint) + Math.PI / 2;
  ctx.strokeStyle = washed(limbTone(HIDE.dark, Math.max(0, shade)), SCALE_BAND_ALPHA);
  ctx.lineWidth = shape.root * 0.16;
  for (let i = 1; i <= LIMB_SCALE_BANDS; i++) {
    const at = mixPt(chain.root, chain.joint, i / (LIMB_SCALE_BANDS + 1));
    ctx.beginPath();
    ctx.moveTo(at.x - Math.cos(across) * shape.root, at.y - Math.sin(across) * shape.root);
    ctx.lineTo(at.x + Math.cos(across) * shape.root, at.y + Math.sin(across) * shape.root);
    ctx.stroke();
  }
  ctx.restore();
}

const SHADOW_RX = 0.42;
const SHADOW_RY = 0.11;
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

// ── Feet ─────────────────────────────────────────────────────────────────────

const FOOT_LENGTH = 0.24;
const FOOT_HEIGHT = 0.1;
const FOOT_BACK = 0.09;
const TOE_CLAW_COUNT = 3;

/**
 * A broad plantigrade reptile foot: a wide sole with three blunt claws off the
 * front. Claws are notches in the silhouette rather than separate strokes —
 * toes drawn as strokes read as sandal straps at this size.
 */
function drawFoot(ctx: Ctx, ankle: Pt, pitch: number, toeOut: number, profile: boolean): void {
  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(pitch);

  const forward = profile ? FOOT_LENGTH : FOOT_LENGTH * 0.6;
  const back = profile ? FOOT_BACK : FOOT_BACK * 0.7;
  const lead = profile ? 0 : toeOut;

  const trace = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(-back - grow, -FOOT_HEIGHT - grow);
    ctx.lineTo(forward * 0.55 + lead + grow, -FOOT_HEIGHT * 0.92 - grow);
    ctx.lineTo(forward + lead + grow, -FOOT_HEIGHT * 0.2);
    ctx.lineTo(forward * 0.94 + lead + grow, grow);
    ctx.lineTo(-back - grow, grow);
    ctx.closePath();
  };

  trace(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  trace(0);
  ctx.fillStyle = HIDE.mid;
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  fillEllipse(
    ctx,
    pt(forward * 0.3 + lead, -FOOT_HEIGHT),
    forward * 0.5,
    FOOT_HEIGHT * 0.4,
    HIDE.light,
  );
  ctx.restore();

  // The claws sit past the sole's own outline so they break the silhouette.
  for (let i = 0; i < TOE_CLAW_COUNT; i++) {
    const spread = profile ? 0 : ((i + 0.5) / TOE_CLAW_COUNT - 0.5) * FOOT_HEIGHT * 1.4;
    const tipY = profile ? -FOOT_HEIGHT * 0.1 + spread : spread;
    const rootY = profile ? tipY + FOOT_HEIGHT * 0.16 : spread;
    ctx.beginPath();
    ctx.moveTo(forward * 0.95 + lead, rootY - FOOT_HEIGHT * 0.14);
    ctx.lineTo(forward + lead + FOOT_LENGTH * 0.17, tipY - FOOT_HEIGHT * 0.02);
    ctx.lineTo(forward * 0.95 + lead, rootY + FOOT_HEIGHT * 0.12);
    ctx.closePath();
    ctx.fillStyle = CLAW.mid;
    ctx.fill();
  }

  ctx.restore();
}

const LEFT_FOOT_OUT = -0.03;
const RIGHT_FOOT_OUT = 0.03;

/**
 * Which perpendicular of the left humerus points away from the trunk, as a sign
 * on the bone's own normal. The right arm takes the other one. Edge-on the same
 * signs land on front and back, which is where those arms' free edges are too.
 */
const LEFT_ARM_OUTBOARD = 1;

/** How far down the shin the gastrocnemius reaches its widest point. */
const GASTROC_AT = 0.34;
const GASTROC_ALPHA = 0.34;
const KNEE_CREASE_ALPHA = 0.5;
/**
 * The two heads of the quadriceps: how far off the thigh's axis each sits, how
 * long each runs, and how hard the crease between them cuts. The outboard head
 * is the long one — that asymmetry is the whole "quad sweep" shape.
 */
const QUAD_HEAD_OUT = 0.34;
const QUAD_HEAD_WIDTH = 0.46;
const QUAD_LATERAL_LENGTH = 0.4;
const QUAD_MEDIAL_LENGTH = 0.26;
const QUAD_SPLIT_ALPHA = 0.3;
/** How much lower the inboard head of the calf hangs than the outboard one. */
const GASTROC_HEAD_STAGGER = 0.16;

/**
 * The knee break and the calf.
 *
 * Both are diamonds rather than gradients. A shin shaded smoothly from knee to
 * ankle is a spindle at any size, and a spindle is what a leg with no joint in
 * it looks like: what says "knee" is a hard crease across the limb, and what
 * says "calf" is a pair of staggered heads meeting in a point above the ankle.
 */
function drawLegDefinition(ctx: Ctx, chain: BoneChain, shape: LimbShape): void {
  const along = angleBetween(chain.joint, chain.end);
  const nx = Math.cos(along + Math.PI / 2);
  const ny = Math.sin(along + Math.PI / 2);

  ctx.save();
  ctx.beginPath();
  appendLimb(ctx, chain, shape, 0);
  ctx.clip();

  // The quadriceps: a long lit mass sweeping down the outboard side of the
  // thigh onto the knee cap, with the inboard head a shorter one beside it and
  // a crease between the two. One flat ellipse of shade over a thigh is a
  // smudge, and a smudge is what the reader takes for a slightly uneven tube.
  const thighAngle = angleBetween(chain.root, chain.joint);
  const thighNx = Math.cos(thighAngle + Math.PI / 2);
  const thighNy = Math.sin(thighAngle + Math.PI / 2);
  const thighLength = Math.hypot(chain.joint.x - chain.root.x, chain.joint.y - chain.root.y);
  const quad = mixPt(chain.root, chain.joint, QUAD_AT * 0.86);
  for (const quadSide of [-1, 1]) {
    const out = shape.mid * QUAD_HEAD_OUT * quadSide;
    fillEllipse(
      ctx,
      offset(quad, thighNx * out, thighNy * out),
      thighLength * (quadSide < 0 ? QUAD_LATERAL_LENGTH : QUAD_MEDIAL_LENGTH),
      shape.mid * QUAD_HEAD_WIDTH,
      washed(BELLY.mid, GASTROC_ALPHA * (quadSide < 0 ? 1 : 0.7)),
      thighAngle,
    );
  }
  ctx.strokeStyle = washed(HIDE.dark, QUAD_SPLIT_ALPHA);
  ctx.lineWidth = shape.mid * 0.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(chain.root.x + thighNx * shape.root * 0.1, chain.root.y + thighNy * shape.root * 0.1);
  ctx.lineTo(quad.x, quad.y);
  ctx.stroke();

  // The break itself: a hard line across the joint, with the cap lit above it.
  ctx.strokeStyle = washed(HIDE.dark, KNEE_CREASE_ALPHA);
  ctx.lineWidth = shape.joint * 0.36;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(chain.joint.x - nx * shape.joint, chain.joint.y - ny * shape.joint);
  ctx.lineTo(chain.joint.x + nx * shape.joint, chain.joint.y + ny * shape.joint);
  ctx.stroke();

  // Two staggered heads over the shin, each a diamond so the meeting point at
  // the achilles is a corner rather than a fade.
  for (const headSide of [-1, 1]) {
    const at = mixPt(
      chain.joint,
      chain.end,
      GASTROC_AT + (headSide < 0 ? GASTROC_HEAD_STAGGER : 0),
    );
    const centre = offset(
      at,
      nx * shape.belly * 0.38 * headSide,
      ny * shape.belly * 0.38 * headSide,
    );
    const tip = mixPt(chain.joint, chain.end, 0.78);
    const top = mixPt(chain.joint, chain.end, 0.14);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(
      centre.x + nx * shape.belly * 0.42 * headSide,
      centre.y + ny * shape.belly * 0.42 * headSide,
    );
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(
      centre.x - nx * shape.belly * 0.1 * headSide,
      centre.y - ny * shape.belly * 0.1 * headSide,
    );
    ctx.closePath();
    ctx.fillStyle = washed(headSide < 0 ? BELLY.mid : mix(BELLY.mid, HIDE.mid, 0.4), GASTROC_ALPHA);
    ctx.fill();
  }

  // The achilles: the shin's own tendon, dark and narrow under the two heads.
  ctx.strokeStyle = washed(HIDE.dark, KNEE_CREASE_ALPHA * 0.7);
  ctx.lineWidth = shape.tip * 0.5;
  ctx.beginPath();
  const tendonTop = mixPt(chain.joint, chain.end, 0.74);
  ctx.moveTo(tendonTop.x, tendonTop.y);
  ctx.lineTo(chain.end.x, chain.end.y);
  ctx.stroke();
  ctx.restore();
}

function drawLeg(
  ctx: Ctx,
  chain: BoneChain,
  pitch: number,
  view: ViewSpec,
  toeOut: number,
  nearness: number,
): void {
  const shape = legShapeFor(nearness);
  drawLimb(ctx, chain, shape, UNSHADED);
  drawLegDefinition(ctx, chain, shape);
  drawShortsCuff(ctx, chain);
  drawFoot(ctx, chain.end, pitch, toeOut, view.profile);
}

// ── Gym shorts ───────────────────────────────────────────────────────────────

/**
 * How far down its own thigh a shorts cuff sits, and how much wider than the
 * thigh it is. The cuff is a band wrapped round the thigh and square to it —
 * a fixed trapezoid hung off the hip stays bolt upright through a kick while
 * the leg swings out bare, and rotating a fixed hem about the hip has to be
 * damped and capped and then stops covering a thigh raised past the cap.
 * Following the thigh's own direction covers it at any angle by construction.
 */
const CUFF_AT = 0.46;
const CUFF_SLACK = 1.12;
const CUFF_DEPTH = 0.11;
const CUFF_SHEEN_ALPHA = 0.45;
const CUFF_SHADE = 0.55;

/** Where a shorts leg ends, in the thigh's own frame: the hem's centre and axes. */
interface CuffFrame {
  readonly centre: Pt;
  /** Unit vector down the thigh, from hip toward knee. */
  readonly along: Pt;
  /** Unit vector across the thigh. */
  readonly across: Pt;
  readonly half: number;
}

function cuffFrameFor(leg: BoneChain): CuffFrame {
  const angle = angleBetween(leg.root, leg.joint);
  return {
    centre: mixPt(leg.root, leg.joint, CUFF_AT),
    along: pt(Math.cos(angle), Math.sin(angle)),
    across: pt(Math.cos(angle + Math.PI / 2), Math.sin(angle + Math.PI / 2)),
    // Measured against the thigh's own width where the hem actually sits, not
    // against the width at the hip: the quadriceps sweep is wider than the
    // thigh's root, and a hem cut to the root lets the quad out of the shorts.
    half: lerp(THIGH_WIDTH, QUAD_WIDTH, CUFF_AT / QUAD_AT) * CUFF_SLACK,
  };
}

function drawShortsCuff(ctx: Ctx, leg: BoneChain): void {
  const { centre, half } = cuffFrameFor(leg);
  const along = angleBetween(leg.root, leg.joint);
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(along - Math.PI / 2);
  outlineEllipse(ctx, pt(0, 0), half, CUFF_DEPTH);
  // The hem carries the dark end of the garment's own ramp, not its mid tone.
  // The seat's crotch notch rises above the hem, so the inboard corner of each
  // cuff shows below it — painted at the mid tone those two corners are a pair
  // of pale wedges meeting under the crotch, brighter than any other part of
  // the shorts and the first thing the eye lands on.
  fillEllipse(ctx, pt(0, 0), half, CUFF_DEPTH, mix(SHORTS.mid, SHORTS.dark, CUFF_SHADE));
  fillEllipse(
    ctx,
    pt(-half * 0.34, -CUFF_DEPTH * 0.34),
    half * 0.34,
    CUFF_DEPTH * 0.26,
    washed(SHORTS.light, CUFF_SHEEN_ALPHA),
  );
  ctx.restore();
}

/** The waistband and seat, painted over the trunk between the two cuffs. */
const WAISTBAND_DROP = 0.02;
const SHORTS_LEG_DROP = 0.2;
/** How far below the hip the gusset between the two leg panels hangs. */
const CROTCH_DROP = 0.16;
/** The band at the top of the shorts — the one hard horizontal in the garment. */
const WAISTBAND_HEIGHT = 0.05;
const INSEAM_ALPHA = 0.7;
/** Where the garment's ramp turns over, and the folds hanging down each panel. */
const SHORTS_RAMP_TURN = 0.45;
const SHORTS_FOLDS = 3;
const SHORTS_FOLD_ALPHA = 0.42;
const SHORTS_FOLD_ROOT = 0.35;

/**
 * The seat and both leg panels, as one closed path.
 *
 * Stopped at the hip it is a belt, and the two cuffs further down each thigh
 * are then a pair of purple rings with bare hide showing between them and the
 * belt — three separate garments, none of which is a pair of shorts. The panels
 * run from the waistband down the outside of each thigh to its own cuff and
 * back up to a crotch notch between them, so waistband, gusset and both hems
 * are one silhouette however the legs are placed.
 */
function drawShortsSeat(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const hipHalf = HIP_HALF * view.girth * view.hipDepth;
  const top = offset(skeleton.waist, 0, WAISTBAND_DROP);
  const bottom = offset(skeleton.hip, 0, SHORTS_LEG_DROP);
  const crotch = offset(skeleton.hip, 0, CROTCH_DROP);
  const hems = [skeleton.leftLeg, skeleton.rightLeg].map((leg) => cuffFrameFor(leg));
  const [leftHem, rightHem] = hems;
  const hemEdge = (hem: CuffFrame, side: number, grow: number): Pt =>
    offset(
      hem.centre,
      hem.across.x * (hem.half + grow) * side + hem.along.x * CUFF_DEPTH,
      hem.across.y * (hem.half + grow) * side + hem.along.y * CUFF_DEPTH,
    );
  const trace = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(top.x - hipHalf * 1.06 - grow, top.y);
    ctx.quadraticCurveTo(top.x, top.y - hipHalf * 0.2 - grow, top.x + hipHalf * 1.06 + grow, top.y);
    const rightOuter = hemEdge(rightHem, 1, grow);
    const rightInner = hemEdge(rightHem, -1, grow);
    const leftOuter = hemEdge(leftHem, -1, grow);
    const leftInner = hemEdge(leftHem, 1, grow);
    ctx.quadraticCurveTo(
      bottom.x + hipHalf * 1.02 + grow,
      bottom.y,
      rightOuter.x,
      rightOuter.y + grow,
    );
    ctx.lineTo(rightInner.x, rightInner.y + grow);
    ctx.quadraticCurveTo(rightInner.x, crotch.y, crotch.x, crotch.y);
    ctx.quadraticCurveTo(leftInner.x, crotch.y, leftInner.x, leftInner.y + grow);
    ctx.lineTo(leftOuter.x, leftOuter.y + grow);
    ctx.quadraticCurveTo(
      bottom.x - hipHalf * 1.02 - grow,
      bottom.y,
      top.x - hipHalf * 1.06 - grow,
      top.y,
    );
    ctx.closePath();
  };
  trace(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  trace(0);
  ctx.fillStyle = SHORTS.mid;
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  // Waistband, body, hem: one continuous ramp down the garment. Painted as two
  // stacked rectangles it is three flat horizontal bands of colour with hard
  // seams between them, which is a flag rather than a pair of shorts — cloth
  // has no straight edges across it anywhere except the band itself.
  // Wide enough to cover the whole garment however far the hems have swung out.
  // Cut to the hips' own width it leaves the crotch and the outer panels at the
  // bare fill tone, and those uncovered patches read as light through a hole.
  const spread = hipHalf * 8;
  const left = top.x - hipHalf * 4;
  const hemY = Math.max(leftHem.centre.y, rightHem.centre.y);
  const ramp = ctx.createLinearGradient(0, top.y, 0, hemY);
  ramp.addColorStop(0, SHORTS.mid);
  ramp.addColorStop(SHORTS_RAMP_TURN, mix(SHORTS.mid, SHORTS.dark, 0.45));
  ramp.addColorStop(1, SHORTS.dark);
  ctx.fillStyle = ramp;
  ctx.fillRect(left, top.y + WAISTBAND_HEIGHT, spread, hipHalf * 6);
  ctx.fillStyle = SHORTS.light;
  ctx.fillRect(left, top.y, spread, WAISTBAND_HEIGHT);

  // Folds fanning down from the hip toward each hem. Three lines is all the
  // cloth a 32 px garment can carry, and without them the panels are two flat
  // fields whatever ramp runs down them.
  ctx.strokeStyle = washed(SHORTS.dark, SHORTS_FOLD_ALPHA);
  ctx.lineWidth = hipHalf * 0.07;
  ctx.lineCap = 'round';
  for (const hem of hems) {
    for (let i = 1; i <= SHORTS_FOLDS; i++) {
      const across = (i / (SHORTS_FOLDS + 1) - 0.5) * 2;
      const foot = offset(
        hem.centre,
        hem.across.x * hem.half * across,
        hem.across.y * hem.half * across,
      );
      ctx.beginPath();
      ctx.moveTo(lerp(top.x, hem.centre.x, SHORTS_FOLD_ROOT), top.y + WAISTBAND_HEIGHT * 1.6);
      ctx.quadraticCurveTo(
        lerp(hem.centre.x, foot.x, 0.4),
        lerp(top.y, foot.y, 0.7),
        foot.x,
        foot.y,
      );
      ctx.stroke();
    }
  }
  // The inseam, down the gusset from the crotch. One hard line is what makes
  // the two panels read as two legs of the same garment.
  ctx.strokeStyle = washed(SHORTS.dark, INSEAM_ALPHA);
  ctx.lineWidth = hipHalf * 0.12;
  ctx.beginPath();
  ctx.moveTo(skeleton.hip.x, skeleton.hip.y);
  ctx.lineTo(crotch.x, crotch.y + hipHalf * 0.4);
  ctx.stroke();
  ctx.restore();
}

// ── Hands ────────────────────────────────────────────────────────────────────

/**
 * Big enough to be a mass in the silhouette. A hand no wider than the wrist it
 * hangs off turns the arm into a uniform tube ending in a rounded stump, and
 * the knuckle has to be a hard corner in the outline.
 */
const HAND_LENGTH = FOREARM_LENGTH * 0.42;
const HAND_WIDTH = HAND_LENGTH * 0.84;
const FIST_WIDTH = HAND_LENGTH * 1.1;
const KNUCKLE_COUNT = 3;
/** A hand stays rigid relative to the body while the forearm swings under it. */
const WRIST_FOLLOW = 0.3;
/** The lifting wrap: a band of strapping round the wrist, under the hand. */
const WRAP_LENGTH = 0.09;
const WRAP_TURNS = 3;

function drawWristWrap(ctx: Ctx, chain: BoneChain, shade: number): void {
  const along = angleBetween(chain.joint, chain.end);
  const inboard = offset(chain.end, -Math.cos(along) * WRAP_LENGTH, -Math.sin(along) * WRAP_LENGTH);
  const tone = shade >= 0 ? mix(GLOVE.mid, OUTLINE, shade) : GLOVE.light;
  outlineCapsule(ctx, inboard, chain.end, WRIST_WIDTH * 1.18, WRIST_WIDTH * 1.24);
  fillCapsule(ctx, inboard, chain.end, WRIST_WIDTH * 1.18, WRIST_WIDTH * 1.24, tone);
  ctx.save();
  traceCapsule(ctx, inboard, chain.end, WRIST_WIDTH * 1.18, WRIST_WIDTH * 1.24);
  ctx.clip();
  ctx.strokeStyle = washed(GLOVE.dark, 0.6);
  ctx.lineWidth = WRAP_LENGTH * 0.12;
  const across = along + Math.PI / 2;
  for (let i = 1; i <= WRAP_TURNS; i++) {
    const at = mixPt(inboard, chain.end, i / (WRAP_TURNS + 1));
    ctx.beginPath();
    ctx.moveTo(
      at.x - Math.cos(across) * WRIST_WIDTH * 1.3,
      at.y - Math.sin(across) * WRIST_WIDTH * 1.3,
    );
    ctx.lineTo(
      at.x + Math.cos(across) * WRIST_WIDTH * 1.3,
      at.y + Math.sin(across) * WRIST_WIDTH * 1.3,
    );
    ctx.stroke();
  }
  ctx.restore();
}

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

/**
 * The deltoid cap. A round mass sitting proud of the arm's own outline at the
 * shoulder, with its striations fanning down into the biceps.
 *
 * Drawn before the limb so the arm covers its lower half and only the shoulder
 * bulge breaks the silhouette — which is the point. On a character whose whole
 * read is "this creature lifts", the shoulder has to be a separate lump in the
 * outline, not a rounded corner where the arm meets the trunk.
 */
const DELTOID_RADIUS = UPPER_ARM_WIDTH * 1.62;
const DELTOID_ALONG = 0.34;
const DELTOID_STRIATIONS = 3;
const DELTOID_STRIATION_ALPHA = 0.26;
/** The cap's highlight. At full strength the near arm blows out to bare white. */
const DELTOID_CAP_ALPHA = 0.55;
/**
 * How much shorter the cap is along the bone than across it. A deltoid drawn
 * longer than it is wide swallows the biceps under it and the whole upper arm
 * becomes one egg with a crease down it.
 */
const DELTOID_ALONG_SQUASH = 0.76;
/** How much of its head-on width the deltoid keeps when the arm is edge-on. */
const PROFILE_DELTOID_SHARE = 0.68;
/**
 * How much of the cap's own perimeter carries ink, centred on the outboard
 * direction, in radians either side of it.
 *
 * The cap is only a separate *shape* on the side where it breaks the
 * silhouette. Inked all the way round it is a disc bolted to the shoulder with
 * a full-weight black line between it and the trunk on one side and between it
 * and its own upper arm on the other — a shoulder pad, not a muscle, and at
 * full render resolution the loudest wrong thing on the figure. Everywhere the
 * cap meets another part of the same body the boundary has to be a tone step.
 */
const DELTOID_INK_SPAN = deg(88);
const DELTOID_INK_STEPS = 20;
/** The soft step where the cap sinks under the trap and the pectoral. */
const DELTOID_SEAM_ALPHA = 0.34;

/**
 * The arc of the cap's outline that is ink, walked in the cap's own frame.
 * `outboard` picks which perpendicular of the bone points away from the trunk.
 */
function inkDeltoidRim(
  ctx: Ctx,
  cap: Pt,
  rx: number,
  ry: number,
  along: number,
  outboard: number,
): void {
  const centreAngle = (outboard >= 0 ? 1 : -1) * (Math.PI / 2);
  ctx.beginPath();
  for (let i = 0; i <= DELTOID_INK_STEPS; i++) {
    const t = centreAngle + (i / DELTOID_INK_STEPS - 0.5) * 2 * DELTOID_INK_SPAN;
    const turned = rotate(pt(Math.cos(t) * rx, Math.sin(t) * ry), along);
    const world = offset(cap, turned.x, turned.y);
    if (i === 0) ctx.moveTo(world.x, world.y);
    else ctx.lineTo(world.x, world.y);
  }
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_BLEED * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawDeltoid(
  ctx: Ctx,
  chain: BoneChain,
  shade: number,
  swell: number,
  outboard: number,
): void {
  const along = angleBetween(chain.root, chain.joint);
  const cap = mixPt(chain.root, chain.joint, DELTOID_ALONG - 0.2);
  const radius = DELTOID_RADIUS * swell;
  const capRx = radius * DELTOID_ALONG_SQUASH;
  inkDeltoidRim(ctx, cap, capRx, radius, along, outboard);
  fillEllipse(ctx, cap, capRx, radius, limbTone(HIDE.mid, shade), along);

  ctx.save();
  traceEllipse(ctx, cap, capRx, radius, along);
  ctx.clip();
  // The seam where the cap sinks under the trapezius and the pectoral, and the
  // one where it rolls onto the arm below it: soft steps in tone rather than
  // lines, so the three read as one continuous mass.
  const inboard = along + (outboard >= 0 ? -Math.PI / 2 : Math.PI / 2);
  fillEllipse(
    ctx,
    offset(cap, Math.cos(inboard) * radius * 0.86, Math.sin(inboard) * radius * 0.86),
    capRx * 1.3,
    radius * 0.9,
    washed(limbTone(HIDE.dark, Math.max(0, shade)), DELTOID_SEAM_ALPHA),
    along,
  );
  // The crown, thrown toward the light and toward the free edge rather than
  // centred: a lens sitting square in the middle of the cap is a painted-on
  // gloss highlight, which is what the cap's own symmetry made of it.
  fillEllipse(
    ctx,
    offset(
      cap,
      -Math.cos(along) * radius * 0.36 - Math.cos(inboard) * radius * 0.24,
      -Math.sin(along) * radius * 0.36 - Math.sin(inboard) * radius * 0.24,
    ),
    radius * 0.58,
    radius * 0.4,
    washed(limbTone(BELLY.mid, Math.max(0, shade)), DELTOID_CAP_ALPHA),
    along,
  );
  ctx.strokeStyle = washed(limbTone(HIDE.dark, Math.max(0, shade)), DELTOID_STRIATION_ALPHA);
  ctx.lineWidth = radius * 0.14;
  ctx.lineCap = 'round';
  const across = along + Math.PI / 2;
  for (let i = 0; i < DELTOID_STRIATIONS; i++) {
    const offsetAcross = ((i + 0.5) / DELTOID_STRIATIONS - 0.5) * radius * 1.5;
    const from = offset(cap, Math.cos(across) * offsetAcross, Math.sin(across) * offsetAcross);
    ctx.beginPath();
    ctx.moveTo(from.x - Math.cos(along) * radius * 0.6, from.y - Math.sin(along) * radius * 0.6);
    ctx.lineTo(from.x + Math.cos(along) * radius, from.y + Math.sin(along) * radius);
    ctx.stroke();
  }
  ctx.restore();
}

/** How far off the arm's axis the biceps belly and the triceps shadow sit. */
const BICEPS_ACROSS = UPPER_ARM_WIDTH * 0.34;
const BICEPS_ALPHA = 0.95;
const TRICEPS_ALPHA = 0.6;
const ELBOW_CREASE_ALPHA = 0.6;
/** Where along the humerus the triceps' long head sits — low, onto the elbow. */
const TRICEPS_FROM = 0.56;
const TRICEPS_LENGTH_SHARE = 0.42;
const TRICEPS_WIDTH_SHARE = 0.6;
/** The lateral head: a second, smaller lump high and outboard of the long one. */
const TRICEPS_LATERAL_AT = 0.3;
const TRICEPS_LATERAL_OUT = 1.25;
const TRICEPS_LATERAL_LENGTH = 0.2;
const TRICEPS_LATERAL_WIDTH = 0.44;
/** How far a lit triceps is pulled back off the belly ramp toward bare hide. */
const TRICEPS_MUTE = 0.5;
const TRICEPS_CROWN_ALPHA = 0.7;
/** How far apart the biceps' two heads sit, as a share of the belly's width. */
const BICEPS_HEAD_SPLIT = 0.3;
const BICEPS_HEAD_WIDTH_SHARE = 0.82;
/** The short head is the smaller of the pair, and sits inboard. */
const BICEPS_SHORT_HEAD_SHARE = 0.78;
/** The notch between the two heads. Any harder and the biceps is two sticks. */
const BICEPS_SPLIT_ALPHA = 0.34;
/** How far past the humerus the muscle group swells, open elbow through folded. */
const ARM_BELLY_OPEN = 1.12;
const ARM_BELLY_FOLDED = 1.22;
const ARM_BELLY_AT = 0.44;

/**
 * How bent an elbow is, 0 straight through 1 fully folded.
 *
 * The arm's masses are read off this rather than off the row it is drawn in.
 * A biceps painted at one fixed size is a decal: it has to ball up as the elbow
 * closes and stretch flat as it opens, or the arm is the same picture hanging
 * at the hip, raised overhead in the heave and driven at the floor in the slam.
 */
function elbowFlexion(chain: BoneChain): number {
  const upper = angleBetween(chain.root, chain.joint);
  const fore = angleBetween(chain.joint, chain.end);
  let turn = Math.abs(fore - upper) % TWO_PI;
  if (turn > Math.PI) turn = TWO_PI - turn;
  return clamp01(turn / (Math.PI * 0.72));
}

/** How far the upper arm points above horizontal, 0 hanging through 1 overhead. */
function armRaise(chain: BoneChain): number {
  const rise = chain.root.y - chain.joint.y;
  return clamp01(rise / UPPER_ARM_LENGTH);
}

/**
 * The arm's silhouette for one frame: a biceps belly high on the upper segment,
 * a hard pinch at the elbow, a forearm that swells again before the wrist.
 * Drawn as one taper an arm is a traffic cone, and on this character the arm is
 * the read.
 *
 * The upper segment's own width carries the flexion, so the *outline* changes
 * between resting, overhead and driven down rather than only the shading inside
 * it — a bulge that never breaks the silhouette does not survive the downsample.
 */
function armShapeFor(flexion: number, raise: number): LimbShape {
  const root = UPPER_ARM_WIDTH * lerp(1, 1.2, flexion) * lerp(1, 1.06, raise);
  return {
    root,
    // The biceps/triceps group balls up as the elbow closes, and it does it in
    // the outline: an upper arm that tapers straight from shoulder to elbow is
    // a smooth tube whatever is shaded inside it, which is what the profile's
    // near arm read as.
    mid: root * lerp(ARM_BELLY_OPEN, ARM_BELLY_FOLDED, flexion),
    midAt: ARM_BELLY_AT,
    joint: ELBOW_WIDTH,
    belly: ELBOW_WIDTH * 1.24,
    tip: WRIST_WIDTH,
    bellyAt: 0.28,
  };
}

/**
 * The biceps and triceps, banded inside the upper arm's own outline.
 *
 * Two masses with a hard crease between them, not a soft gradient: definition
 * has to survive the downsample to a 32 px tile, and a smooth shade across an
 * arm reads there as a slightly uneven tube. `across` is +1 when the biceps
 * faces +X (the profile, where the arm is seen from the side) and 0 head-on,
 * where the belly faces the camera and both edges fall away instead.
 */
function drawUpperArmMuscle(
  ctx: Ctx,
  chain: BoneChain,
  shape: LimbShape,
  shade: number,
  across: number,
  flexion: number,
  fromBehind: boolean,
): void {
  const along = angleBetween(chain.root, chain.joint);
  const nx = Math.cos(along + Math.PI / 2);
  const ny = Math.sin(along + Math.PI / 2);
  const length = Math.hypot(chain.joint.x - chain.root.x, chain.joint.y - chain.root.y);
  // A folded elbow drags the belly toward it and balls it up; an open one
  // stretches it back along the bone and flattens it.
  const bellyAt = lerp(0.38, 0.54, flexion);
  const belly = mixPt(chain.root, chain.joint, bellyAt);
  const bellyLength = length * lerp(0.38, 0.28, flexion);
  const bellyWidth = shape.root * lerp(0.5, 0.74, flexion);
  const lit = limbTone(BELLY.mid, Math.max(0, shade));
  const hot = limbTone(BELLY.light, Math.max(0, shade));
  const dark = limbTone(HIDE.dark, Math.max(0, shade));

  ctx.save();
  ctx.beginPath();
  appendUpperLimb(ctx, chain, shape, 0);
  ctx.clip();

  // The triceps: a long mass running from high on the humerus down onto the
  // elbow, with the lateral head a second smaller lump beside its top. Two
  // shapes, not one: a single ellipse of shade is a smudge, and a smudge is
  // what the reader takes for a slightly uneven tube.
  const tricepsAt = mixPt(chain.root, chain.joint, lerp(TRICEPS_FROM, TRICEPS_FROM + 0.1, flexion));
  // A lit triceps is not a biceps seen from the back: it is a flatter, longer
  // mass under thicker skin, so it takes a muted step off the hide rather than
  // the belly ramp's full pale.
  const tricepsTone = fromBehind ? mix(lit, limbTone(HIDE.mid, shade), TRICEPS_MUTE) : dark;
  const tricepsAlpha = fromBehind ? BICEPS_ALPHA : TRICEPS_ALPHA;
  ctx.globalAlpha = tricepsAlpha;
  const tricepsSides = across === 0 ? [-1, 1] : [-1];
  for (const tricepsSide of tricepsSides) {
    const outAcross = BICEPS_ACROSS * (Math.abs(across) + 0.95) * tricepsSide;
    fillEllipse(
      ctx,
      offset(tricepsAt, nx * outAcross, ny * outAcross),
      length * TRICEPS_LENGTH_SHARE,
      shape.root * TRICEPS_WIDTH_SHARE,
      tricepsTone,
      along,
    );
    // The lateral head, sitting high and outboard of the long one.
    fillEllipse(
      ctx,
      offset(
        mixPt(chain.root, chain.joint, TRICEPS_LATERAL_AT),
        nx * outAcross * TRICEPS_LATERAL_OUT,
        ny * outAcross * TRICEPS_LATERAL_OUT,
      ),
      length * TRICEPS_LATERAL_LENGTH,
      shape.root * TRICEPS_LATERAL_WIDTH,
      tricepsTone,
      along,
    );
  }

  // The biceps: a short head and a long head side by side, then the crown of
  // the pair offset toward the light. From behind this whole group is the
  // *underside* of the arm and takes the shadow instead — a front-lit biceps
  // shine painted on the back of an upper arm is a limb drawn inside out.
  ctx.globalAlpha = fromBehind ? TRICEPS_ALPHA : BICEPS_ALPHA;
  const bellyTone = fromBehind ? dark : lit;
  const bellyCentre = offset(belly, nx * BICEPS_ACROSS * across, ny * BICEPS_ACROSS * across);
  for (const head of [-1, 1]) {
    fillEllipse(
      ctx,
      offset(
        bellyCentre,
        nx * bellyWidth * BICEPS_HEAD_SPLIT * head,
        ny * bellyWidth * BICEPS_HEAD_SPLIT * head,
      ),
      bellyLength * lerp(1, BICEPS_SHORT_HEAD_SHARE, (head + 1) / 2),
      bellyWidth * BICEPS_HEAD_WIDTH_SHARE,
      bellyTone,
      along,
    );
  }
  if (!fromBehind) {
    // The crown of the pair, offset toward the light: two flat slabs of one
    // tone are a sticker, and the peak is what makes them a dome.
    fillEllipse(
      ctx,
      offset(bellyCentre, nx * bellyWidth * -0.28, ny * bellyWidth * -0.28),
      bellyLength * 0.54,
      bellyWidth * 0.4,
      hot,
      along,
    );
  } else {
    // Behind, the light lands on the triceps' own crown instead.
    ctx.globalAlpha = TRICEPS_CROWN_ALPHA;
    fillEllipse(
      ctx,
      offset(tricepsAt, nx * bellyWidth * -0.22, ny * bellyWidth * -0.22),
      length * TRICEPS_LENGTH_SHARE * 0.6,
      shape.root * TRICEPS_WIDTH_SHARE * 0.42,
      mix(hot, limbTone(BELLY.mid, Math.max(0, shade)), TRICEPS_MUTE),
      along,
    );
  }
  ctx.globalAlpha = 1;

  // The creases: one down the split between the biceps heads, one along the
  // seam where the biceps group meets the triceps, and the fold at the elbow.
  // All hard lines — at tile size a crease is the only thing that separates two
  // masses, and separated masses are the whole "this creature lifts" read.
  ctx.strokeStyle = washed(dark, ELBOW_CREASE_ALPHA);
  ctx.lineWidth = shape.root * 0.18;
  ctx.lineCap = 'round';
  const creaseAcross = BICEPS_ACROSS * (across - 0.8);
  ctx.beginPath();
  ctx.moveTo(chain.root.x + nx * creaseAcross, chain.root.y + ny * creaseAcross);
  ctx.lineTo(chain.joint.x + nx * creaseAcross * 0.6, chain.joint.y + ny * creaseAcross * 0.6);
  ctx.stroke();

  const splitAcross = BICEPS_ACROSS * across;
  ctx.strokeStyle = washed(dark, BICEPS_SPLIT_ALPHA);
  ctx.lineWidth = shape.root * 0.07;
  ctx.beginPath();
  ctx.moveTo(
    bellyCentre.x + nx * splitAcross * 0.2 - Math.cos(along) * bellyLength * 0.7,
    bellyCentre.y + ny * splitAcross * 0.2 - Math.sin(along) * bellyLength * 0.7,
  );
  ctx.lineTo(
    bellyCentre.x + nx * splitAcross * 0.2 + Math.cos(along) * bellyLength * 0.7,
    bellyCentre.y + ny * splitAcross * 0.2 + Math.sin(along) * bellyLength * 0.7,
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * A hard crease across the elbow, and the forearm's own belly lit above it.
 *
 * The upper arm's masses stop at the joint, so on their own they leave the
 * forearm a smooth cone hanging off a smooth cone. What says "elbow" is the
 * same thing that says "knee": one hard line across the limb with a lit mass
 * on one side of it. Without it the profile's near arm is a featureless tube
 * from the shoulder to the glove however carefully the biceps is banded.
 */
const ELBOW_BREAK_ALPHA = 0.55;
const FOREARM_BELLY_AT = 0.34;
const FOREARM_BELLY_ALPHA = 0.4;

function drawElbowBreak(ctx: Ctx, chain: BoneChain, shape: LimbShape, shade: number): void {
  const along = angleBetween(chain.joint, chain.end);
  const nx = Math.cos(along + Math.PI / 2);
  const ny = Math.sin(along + Math.PI / 2);
  const dark = limbTone(HIDE.dark, Math.max(0, shade));

  ctx.save();
  ctx.beginPath();
  appendLimb(ctx, chain, shape, 0);
  ctx.clip();
  fillEllipse(
    ctx,
    mixPt(chain.joint, chain.end, FOREARM_BELLY_AT),
    Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y) * 0.3,
    shape.belly * 0.62,
    washed(limbTone(BELLY.mid, Math.max(0, shade)), FOREARM_BELLY_ALPHA),
    along,
  );
  ctx.strokeStyle = washed(dark, ELBOW_BREAK_ALPHA);
  ctx.lineWidth = shape.joint * 0.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(chain.joint.x - nx * shape.joint, chain.joint.y - ny * shape.joint);
  ctx.lineTo(chain.joint.x + nx * shape.joint, chain.joint.y + ny * shape.joint);
  ctx.stroke();
  ctx.restore();
}

function drawArm(
  ctx: Ctx,
  chain: BoneChain,
  fist: number,
  shade: number,
  across: number,
  fromBehind: boolean,
  outboard: number,
): void {
  const flexion = elbowFlexion(chain);
  const shape = armShapeFor(flexion, armRaise(chain));
  // The limb first, then the cap over the top of it. Drawn under the arm, the
  // arm's own capsule outline runs straight through the middle of the deltoid
  // and the shoulder reads as a pad strapped on over the limb rather than as
  // the head of it.
  drawLimb(ctx, chain, shape, shade);
  // Edge-on the deltoid is seen across its narrow axis: given its head-on width
  // in profile it is a disc as wide as the chest is deep and it covers the
  // whole trunk. `across` is already how edge-on this arm is drawn.
  const capSwell =
    lerp(1, 1.16, armRaise(chain)) * lerp(1, PROFILE_DELTOID_SHARE, Math.abs(across));
  drawDeltoid(ctx, chain, shade, capSwell, outboard);
  drawUpperArmMuscle(ctx, chain, shape, shade, across, flexion, fromBehind);
  drawElbowBreak(ctx, chain, shape, shade);
  drawWristWrap(ctx, chain, shade);
  drawHand(ctx, chain, fist, shade);
}

// ── Tail ─────────────────────────────────────────────────────────────────────

/**
 * The tail is built the way the severed tail in the gore set is built: a chain
 * of tapering capsules threaded along a spine, each one a lump in the outline.
 *
 * Traced instead as a single tapering polygon it is a leaf — uniformly thin,
 * sharply pointed, textured with parallel lines, and in the away view a flat
 * triangular flap lying over the shorts like torn cloth. What makes a tail a
 * tail is volume that falls away in stages, so the edge itself is scalloped and
 * the thing reads as round rather than as a blade.
 */
const TAIL_SEGMENTS = 9;
const TAIL_LENGTH = 0.98;
/**
 * Girth against length, matched to the severed tail piece in the gore set. Its
 * root half-width is a shade under a fifth of its own length, and that ratio is
 * what makes that piece read as a tapering tube rather than as a wedge; carried
 * fatter, the body's tail was a triangle with the same spine underneath it.
 */
const TAIL_ROOT_WIDTH = TAIL_LENGTH * 0.196;
const TAIL_TIP_WIDTH = TAIL_LENGTH * 0.028;
/**
 * How the girth falls off along the length. Past 1 the mass stays at the root
 * and lets go late, which is what gives the base its heft; at 1 the taper is a
 * straight cone and the whole thing is a spike again.
 */
const TAIL_TAPER_CURVE = 1.45;
/** Per-segment girth wobble, so the outline is scalloped rather than smooth. */
const TAIL_SEGMENT_WOBBLE = 0.075;
const TAIL_SEGMENT_LOBES = 1.9;
/**
 * How much wider each segment starts than the segment behind it ends.
 *
 * This is the whole difference between a tube and a wedge. Threaded as one
 * smoothly tapering chain the outline is two straight edges meeting at a point;
 * stepping each segment's root back up over its neighbour's tip puts a lump in
 * the edge at every joint, and overlapping rings of hide is what a real tail's
 * silhouette is made of.
 */
const TAIL_SEGMENT_OVERLAP = 0.16;
/** How far the tail's root sits behind the hip, edge-on. */
const TAIL_ROOT_BACK = 0.14;
/** How far the tip rides above the root at full lift. */
const TAIL_LIFT_RISE = 0.5;
/** How far the tail sags below its root when it is not carried. */
const TAIL_SAG = 0.24;
/**
 * How far the profile spine's bend point falls out of the straight line from
 * root to tip, as a share of the tail's reach. Zero is a chord, and a chord
 * with a taper on it is a blade whatever is painted inside it.
 */
const TAIL_ARC_SAG = 0.3;
/** Scale on the tail's reach in the head-on views, where it is foreshortened. */
const FACING_TAIL_REACH = 0.62;
/**
 * How far off the centreline the head-on views carry the tail even at rest.
 *
 * Hung dead centre and foreshortened it is a short fat stub pointing straight
 * at the camera — which projects to a circle sitting on top of his own shorts,
 * and reads as an egg. Carried to one side it stays a tapering limb.
 */
const FACING_TAIL_BIAS = 0.8;
/**
 * The same bias seen from behind, where the tail is between the camera and the
 * body rather than behind it.
 *
 * It has to carry well off the centreline. Hung near the midline and dropped to
 * ankle height the tail exits from under the crotch of the shorts and comes
 * down between the legs at a leg's own width and a leg's own colour, which at
 * 32 px is not a tail: it is a third limb in the one place on an animal where
 * nothing should hang at all. A real tail roots to one side of the spine's base
 * and sweeps away from it, so this carries the tip clear outboard of the leg it
 * passes and stops at knee height rather than running down to the floor.
 */
const AWAY_TAIL_BIAS = 0.75;
/** How far down the away view carries the tail, as a share of its own reach. */
const AWAY_TAIL_DROP = 0.95;
/**
 * Where the away view's spine bends, as shares of its reach across and of its
 * own drop down.
 *
 * It falls before it sweeps. Bent out and down together the tail crosses the
 * hanging hand at exactly the height the glove sits, and a tail lying over a
 * glove has eaten a piece of the silhouette; dropped first it passes under both
 * hands and only then carries outboard of the leg.
 */
const AWAY_TAIL_BEND_ACROSS = 0.18;
const AWAY_TAIL_BEND_DOWN = 0.9;
/** How far a swing throws the away view's tip across. Kept clear of the hands. */
const AWAY_TAIL_SWING = 0.22;
/**
 * How far off the hip's centre the away view roots the tail, as a share of the
 * hip's own half-width. The exit point is under one side of the waistband — the
 * base of a spine that is not perfectly square to the camera — never under the
 * crotch seam.
 */
const AWAY_TAIL_ROOT_ACROSS = 0.8;
/** Seen nearly end-on the tail shows less of its girth than it does in profile. */
const FACING_TAIL_GIRTH = 0.82;
/**
 * From behind, the tail is coming toward the camera down the midline, so it is
 * foreshortened rather than shortened: it shows nearly its full girth over a
 * fraction of its length, and the far end is a blunt disc of a tip rather than
 * a point. Given the profile's slender taper it comes out as a leaf lying on
 * his back — the very shape the tail was rebuilt to stop being.
 */
const AWAY_TAIL_GIRTH = 0.72;
const AWAY_TAIL_TIP_BLUNT = 2.4;
/** The tail is carried; no part of it is ever allowed to touch the floor. */
const TAIL_CLEARANCE = 0.1;
/** How far a full swing throws the tip across, as a share of the tail's reach. */
const TAIL_SWING_TRAVEL = 0.3;
const TAIL_BAND_ALPHA = 0.26;
const TAIL_BELLY_ALPHA = 0.6;
/** Where across the girth the two rolls of the tube sit, 0 spine to 1 edge. */
const TAIL_ROLL_AT = 0.62;
const TAIL_UNDER_ALPHA = 0.32;
const TAIL_SHEEN_ALPHA = 0.44;
/** How far a band bows along the tail before it crosses. A chord is a chevron. */
const TAIL_BAND_BOW = 0.55;
/** How far across the girth a band runs. Carried to 1 it cuts the lit edge. */
const TAIL_BAND_REACH = 0.48;

interface TailSpine {
  readonly points: readonly Pt[];
  readonly halves: readonly number[];
  /** Unit normals, so the belly stripe and the bands know which way is under. */
  readonly normals: readonly Pt[];
}

/**
 * The tip and the bend, per view.
 *
 * Edge-on the tail runs back along −X over a spine that sags out of the chord
 * before the tip carries back up — a straight chord with the girth tapered
 * along it is a blade however the girth is shaded, and the arc is the single
 * thing that stops it being one. Head-on almost all of its length projects away
 * from the camera, so what is left is a short heavy stub thrown out to one
 * side; from behind it hangs down the midline instead, clear of both hands.
 */
function tailArc(view: ViewSpec, lift: number, swing: number, reach: number, root: Pt): [Pt, Pt] {
  if (view.profile) {
    return [
      offset(
        root,
        -reach * 0.46,
        (lerp(TAIL_ARC_SAG, TAIL_ARC_SAG * 0.1, lift) - swing * TAIL_SWING_TRAVEL * 0.8) * reach,
      ),
      offset(
        root,
        -reach * 0.94,
        (lerp(TAIL_SAG, -TAIL_LIFT_RISE, lift) + swing * TAIL_SWING_TRAVEL) * reach,
      ),
    ];
  }
  if (view.showsFace) {
    return [
      offset(
        root,
        (FACING_TAIL_BIAS * 0.34 + swing * 0.22) * reach,
        (lerp(0.04, -0.1, lift) + 0.36) * reach,
      ),
      offset(
        root,
        (FACING_TAIL_BIAS + swing * 0.45) * reach,
        (lerp(TAIL_SAG, -TAIL_LIFT_RISE * 0.5, lift) + 0.42) * reach,
      ),
    ];
  }
  return [
    offset(
      root,
      (AWAY_TAIL_BEND_ACROSS + swing * AWAY_TAIL_SWING * 0.4) * reach,
      AWAY_TAIL_DROP * AWAY_TAIL_BEND_DOWN * reach,
    ),
    offset(
      root,
      (AWAY_TAIL_BIAS + swing * AWAY_TAIL_SWING) * reach,
      (lerp(AWAY_TAIL_DROP, AWAY_TAIL_DROP * 0.72, lift) + TAIL_SAG * 0.3) * reach,
    ),
  ];
}

function tailSpineFor(view: ViewSpec, pose: JuicerPose, root: Pt): TailSpine {
  const lift = clamp01(pose.tailLift);
  const swing = pose.tailSwing;
  const reach = view.profile ? TAIL_LENGTH : TAIL_LENGTH * FACING_TAIL_REACH;
  const [control, tip] = tailArc(view, lift, swing, reach, root);

  const points: Pt[] = [];
  const halves: number[] = [];
  const normals: Pt[] = [];
  for (let i = 0; i <= TAIL_SEGMENTS; i++) {
    const t = i / TAIL_SEGMENTS;
    const inv = 1 - t;
    const point = pt(
      inv * inv * root.x + 2 * inv * t * control.x + t * t * tip.x,
      inv * inv * root.y + 2 * inv * t * control.y + t * t * tip.y,
    );
    const ahead = pt(
      2 * inv * (control.x - root.x) + 2 * t * (tip.x - control.x),
      2 * inv * (control.y - root.y) + 2 * t * (tip.y - control.y),
    );
    const length = Math.hypot(ahead.x, ahead.y) || 1;
    const facesAway = !view.profile && !view.showsFace;
    const girth = view.profile ? 1 : facesAway ? AWAY_TAIL_GIRTH : FACING_TAIL_GIRTH;
    const tipWidth = TAIL_TIP_WIDTH * (facesAway ? AWAY_TAIL_TIP_BLUNT : 1);
    const half =
      lerp(TAIL_ROOT_WIDTH, tipWidth, t ** TAIL_TAPER_CURVE) *
      (1 + TAIL_SEGMENT_WOBBLE * Math.sin(i * TAIL_SEGMENT_LOBES)) *
      girth;
    points.push(pt(point.x, Math.min(point.y, -TAIL_CLEARANCE - half)));
    halves.push(half);
    normals.push(pt(-ahead.y / length, ahead.x / length));
  }
  return { points, halves, normals };
}

/**
 * The chain of capsules as one path, optionally grown for the ink pass.
 *
 * Each segment starts wider than the one behind it ended, so the union steps
 * outward at every joint. That step is the scallop, and the scallop is what
 * separates a tube of overlapping rings from a smooth cone.
 */
function traceTail(ctx: Ctx, spine: TailSpine, grow: number): void {
  ctx.beginPath();
  for (let i = 0; i < spine.points.length - 1; i++) {
    appendCapsule(
      ctx,
      spine.points[i],
      spine.points[i + 1],
      spine.halves[i] * (1 + TAIL_SEGMENT_OVERLAP) + grow,
      spine.halves[i + 1] + grow,
    );
  }
}

/**
 * The tail: the strongest lizard cue the silhouette has at distance, the thing
 * that fills the away and side outlines where a bipedal figure is otherwise a
 * column, and what makes the profile read as an animal rather than as a man in
 * a mask.
 */
function drawTail(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: JuicerPose): void {
  const facesAway = !view.profile && !view.showsFace;
  const rootAcross = facesAway ? HIP_HALF * AWAY_TAIL_ROOT_ACROSS : 0;
  const root = offset(
    skeleton.hip,
    view.profile ? -TAIL_ROOT_BACK : rootAcross,
    view.profile ? -HIP_HALF * 0.2 : HIP_HALF * 0.1,
  );
  const spine = tailSpineFor(view, pose, root);

  traceTail(ctx, spine, OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  traceTail(ctx, spine, 0);
  ctx.fillStyle = HIDE.mid;
  ctx.fill();

  ctx.save();
  traceTail(ctx, spine, 0);
  ctx.clip();

  // The pale underside runs the whole length: belly plating is what stops the
  // tail reading as a length of rope. It rides the taper, so it narrows with
  // the mass instead of running as a parallel stripe down a blade.
  //
  // Seen from behind, the underside is turned away from the camera. Painted
  // anyway it is a pale stripe down the middle of a foreshortened cone, and the
  // whole tail flattens into a leaf lying against his back.
  const showsUnderside = view.profile || view.showsFace;
  ctx.beginPath();
  for (let i = 0; showsUnderside && i < spine.points.length; i++) {
    const under = offset(
      spine.points[i],
      -spine.normals[i].x * spine.halves[i] * 0.5,
      -spine.normals[i].y * spine.halves[i] * 0.5,
    );
    if (i === 0) ctx.moveTo(under.x, under.y);
    else ctx.lineTo(under.x, under.y);
  }
  ctx.strokeStyle = washed(BELLY.mid, TAIL_BELLY_ALPHA);
  ctx.lineWidth = TAIL_ROOT_WIDTH * 0.3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // The two rolls of the tube: a shadow hugging the under edge and a sheen
  // along the lit one, both riding the taper. Without them the fill is one flat
  // field of hide and the thing is a cut-out however its edge is shaped — this
  // is the pair of strokes the gore piece gets from `paintGoreMass` and the
  // body's tail never had.
  const rollStroke = (side: number, colour: string, alpha: number, width: number): void => {
    ctx.beginPath();
    for (let i = 0; i < spine.points.length; i++) {
      const at = offset(
        spine.points[i],
        spine.normals[i].x * spine.halves[i] * side,
        spine.normals[i].y * spine.halves[i] * side,
      );
      if (i === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    }
    ctx.strokeStyle = washed(colour, alpha);
    ctx.lineWidth = TAIL_ROOT_WIDTH * width;
    ctx.stroke();
  };
  rollStroke(-TAIL_ROLL_AT, HIDE.dark, TAIL_UNDER_ALPHA, 0.62);
  rollStroke(TAIL_ROLL_AT, HIDE.light, TAIL_SHEEN_ALPHA, 0.4);

  // One band per segment joint, so the banding and the lumps in the outline are
  // the same subdivision. Bands on their own cadence read as stripes painted on.
  //
  // Each is an arc bowed along the taper and stopped short of the lit edge,
  // never a chord straight across the girth: a full-width straight rule reads as
  // a chevron printed on a flat wedge, which is what the whole tail read as.
  ctx.strokeStyle = washed(HIDE.dark, TAIL_BAND_ALPHA);
  ctx.lineCap = 'round';
  for (let i = 1; i < spine.points.length - 1; i++) {
    const half = spine.halves[i];
    const normal = spine.normals[i];
    const here = spine.points[i];
    const along = pt(-normal.y, normal.x);
    ctx.lineWidth = half * 0.24;
    ctx.beginPath();
    ctx.moveTo(here.x - normal.x * half, here.y - normal.y * half);
    ctx.quadraticCurveTo(
      here.x - along.x * half * TAIL_BAND_BOW,
      here.y - along.y * half * TAIL_BAND_BOW,
      here.x + normal.x * half * TAIL_BAND_REACH,
      here.y + normal.y * half * TAIL_BAND_REACH,
    );
    ctx.stroke();
  }
  ctx.restore();
}

// ── Torso ────────────────────────────────────────────────────────────────────

const MASS_SHADE_ALPHA = 0.4;
const MASS_LIGHT_ALPHA = 0.28;
const MASS_SHADE_OFFSET = 0.3;
const BELLY_ALPHA = 0.72;
const SCALE_SPECK_COUNT = 14;
const SCALE_SPECK_ALPHA = 0.2;
const SCALE_SEED = 27.4;
/** How much wider a full flex draws the chest and shoulders. */
const FLEX_GAIN = 0.07;

/**
 * The trunk, traced as one closed path from hips to trapezius so the V reads as
 * a single mass. Tracing each lobe separately cuts a visible seam down the
 * silhouette. The top is not a shelf and not a dome: it climbs from the deltoid
 * corner up toward the neck, which is the trapezius, which is the whole "this
 * creature lifts" read at any size.
 */
function traceTorso(
  ctx: Ctx,
  skeleton: Skeleton,
  view: ViewSpec,
  flex: number,
  grow: number,
): void {
  const swell = 1 + flex * FLEX_GAIN;
  const shoulderHalf = SHOULDER_HALF * view.girth * view.chestTaper * swell + grow;
  const chestHalf = CHEST_HALF * view.girth * view.chestTaper * swell + grow;
  const waistHalf = WAIST_HALF * view.girth + grow;
  const hipHalf = HIP_HALF * view.girth * view.hipDepth + grow;

  const shoulder = skeleton.shoulderCentre;
  const chest = skeleton.chest;
  const waist = skeleton.waist;
  const hip = skeleton.hip;
  const deltoidY = shoulder.y - SHOULDER_JOINT_DROP - grow;
  const neckHalf = shoulderHalf * TRAP_INBOARD * 0.42;
  const trapY = deltoidY - TRAP_RISE - grow;
  const bottom = offset(hip, 0, grow + HIP_HALF * 0.16);

  ctx.beginPath();
  ctx.moveTo(shoulder.x - neckHalf, trapY);
  ctx.quadraticCurveTo(shoulder.x, trapY - shoulderHalf * 0.06, shoulder.x + neckHalf, trapY);
  ctx.quadraticCurveTo(
    shoulder.x + shoulderHalf * TRAP_INBOARD,
    trapY + TRAP_RISE * 0.35,
    shoulder.x + shoulderHalf,
    deltoidY + SHOULDER_JOINT_DROP,
  );
  ctx.quadraticCurveTo(chest.x + chestHalf * 1.04, chest.y, waist.x + waistHalf, waist.y);
  ctx.quadraticCurveTo(hip.x + hipHalf, hip.y, bottom.x + hipHalf * 0.74, bottom.y);
  ctx.quadraticCurveTo(bottom.x, bottom.y + hipHalf * 0.24, bottom.x - hipHalf * 0.74, bottom.y);
  ctx.quadraticCurveTo(hip.x - hipHalf, hip.y, waist.x - waistHalf, waist.y);
  ctx.quadraticCurveTo(
    chest.x - chestHalf * 1.04,
    chest.y,
    shoulder.x - shoulderHalf,
    deltoidY + SHOULDER_JOINT_DROP,
  );
  ctx.quadraticCurveTo(
    shoulder.x - shoulderHalf * TRAP_INBOARD,
    trapY + TRAP_RISE * 0.35,
    shoulder.x - neckHalf,
    trapY,
  );
  ctx.closePath();
}

/** Scattered dark scale specks over the hide, clipped to it. */
function speckleTorso(ctx: Ctx, skeleton: Skeleton, spread: number): void {
  ctx.globalAlpha = SCALE_SPECK_ALPHA;
  for (let i = 0; i < SCALE_SPECK_COUNT; i++) {
    const x = skeleton.chest.x + (hash1(i + SCALE_SEED) - 0.5) * 2 * spread;
    const y = lerp(skeleton.shoulderCentre.y, skeleton.hip.y, hash1(i * 3.1 + SCALE_SEED));
    const rx = spread * (0.06 + hash1(i * 7.7 + SCALE_SEED) * 0.09);
    fillEllipse(ctx, pt(x, y), rx, rx * 0.55, HIDE.dark, hash1(i * 2.3) * Math.PI);
  }
  ctx.globalAlpha = 1;
}

/**
 * The chest and abdomen, built out of the pale belly-plate ramp.
 *
 * A reptile's scutes and a bodybuilder's pecs and abs are the same shape at a
 * 32 px tile: a stack of pale slabs separated by hard dark grooves. That is why
 * the plating carries the muscle read and no interior line work is needed —
 * but the grooves have to be *hard* and the ramp step has to be big. A soft
 * gradient across a torso reads at tile size as a slightly uneven barrel, which
 * is exactly what the first bake of this creature was.
 */
const PEC_HALF_SHARE = 0.48;
const PEC_DEPTH_SHARE = 0.2;
const PEC_SPREAD_SHARE = 0.44;
const PEC_ALONG = 0.45;
const AB_ROWS = 3;
const AB_FROM = 0.18;
const AB_UNTIL = 1.02;
const GROOVE_ALPHA = 0.85;
const GROOVE_WIDTH_SHARE = 0.085;
/** The pec's own edge, drawn round its whole outline rather than under it only. */
const PEC_EDGE_ALPHA = 0.75;
const RIB_COUNT = 2;
const RIB_ALPHA = 0.34;
/**
 * How far an outboard ab plate rides above its inboard partner, as a share of
 * the plate's own depth.
 *
 * This is the whole difference between abs that wrap a barrel and abs that sit
 * on it as horizontal bars: the far side of a cylinder turns away from the
 * camera, so the outboard end of every band has to climb and shorten.
 */
const AB_WRAP_RISE = 0.42;
const AB_WRAP_TILT = deg(15);
const OBLIQUE_ALPHA = 0.34;

/**
 * The pectoral's outline, centred on `at` and rounded on every edge.
 *
 * A slab with a flat top and a flat bottom is a bar painted across the chest;
 * what makes it a mass hanging off the ribs is that all four edges curve — the
 * clavicle line rising outboard toward the deltoid, a round outboard corner,
 * the hanging crease beneath, and a near-straight sternal edge inboard.
 */
function tracePec(ctx: Ctx, at: Pt, side: number, half: number, depth: number): void {
  const x = (share: number): number => at.x + side * half * share;
  ctx.beginPath();
  ctx.moveTo(x(-0.55), at.y - depth * 0.6);
  ctx.quadraticCurveTo(x(-0.08), at.y - depth * 1.12, x(0.62), at.y - depth * 0.74);
  ctx.quadraticCurveTo(x(1.14), at.y - depth * 0.32, x(0.92), at.y + depth * 0.5);
  ctx.quadraticCurveTo(x(0.28), at.y + depth * 1.3, x(-0.52), at.y + depth * 0.86);
  ctx.quadraticCurveTo(x(-0.8), at.y + depth * 0.2, x(-0.55), at.y - depth * 0.6);
  ctx.closePath();
}

function drawChestAndAbs(
  ctx: Ctx,
  skeleton: Skeleton,
  half: number,
  torsoHeight: number,
  flex: number,
): void {
  const groove = washed(HIDE.dark, GROOVE_ALPHA);
  const grooveWidth = half * GROOVE_WIDTH_SHARE;
  const swell = 1 + flex * FLEX_GAIN;

  // Pectorals: two slabs hanging off the collar line with a hard crease beneath
  // each and a gap of dark hide between them for the sternum.
  const pecCentre = mixPt(skeleton.shoulderCentre, skeleton.chest, PEC_ALONG);
  const pecHalf = half * PEC_HALF_SHARE * swell;
  const pecDepth = torsoHeight * PEC_DEPTH_SHARE;
  for (const side of [-1, 1]) {
    const at = offset(pecCentre, side * half * PEC_SPREAD_SHARE * swell, 0);
    tracePec(ctx, at, side, pecHalf, pecDepth);
    ctx.fillStyle = BELLY.mid;
    ctx.fill();
    // The crown of the slab, offset toward the key light — the same direction on
    // both pecs, because a highlight mirrored per side is two light sources.
    fillEllipse(
      ctx,
      offset(at, LIGHT.x * pecHalf * 0.2, LIGHT.y * pecDepth * 0.42),
      pecHalf * 0.62,
      pecDepth * 0.42,
      BELLY.light,
    );
    // The pec's whole edge, not just the crease beneath it: the inboard sternal
    // edge and the outboard one are what make the slab a mass hanging off the
    // ribs rather than a bar painted across the chest.
    tracePec(ctx, at, side, pecHalf, pecDepth);
    ctx.strokeStyle = washed(HIDE.dark, PEC_EDGE_ALPHA);
    ctx.lineWidth = grooveWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // The rib cage under the pec's outboard corner, sweeping inboard and down
    // the way the barrel does.
    ctx.strokeStyle = washed(HIDE.dark, RIB_ALPHA);
    ctx.lineWidth = grooveWidth * 0.8;
    ctx.lineCap = 'round';
    for (let rib = 0; rib < RIB_COUNT; rib++) {
      const drop = pecDepth * (0.9 + rib * 0.62);
      ctx.beginPath();
      ctx.moveTo(at.x + side * pecHalf * 1.0, at.y + drop);
      ctx.quadraticCurveTo(
        at.x + side * pecHalf * 0.62,
        at.y + drop + pecDepth * 0.34,
        at.x + side * pecHalf * 0.18,
        at.y + drop + pecDepth * 0.3,
      );
      ctx.stroke();
    }
  }
  // The sternum gap, drawn as ink rather than as a gap in the fills: two slabs
  // laid side by side with nothing between them merge into one shelf.
  ctx.strokeStyle = groove;
  ctx.lineWidth = grooveWidth * 1.4;
  ctx.beginPath();
  ctx.moveTo(pecCentre.x, pecCentre.y - pecDepth);
  ctx.lineTo(pecCentre.x, pecCentre.y + pecDepth * 0.9);
  ctx.stroke();

  // Abdomen: a grid of plates narrowing into the waist, with the vertical
  // groove running the whole way down.
  const abTop = mixPt(skeleton.chest, skeleton.hip, AB_FROM);
  const abBottom = mixPt(skeleton.chest, skeleton.hip, AB_UNTIL);
  const abDepth = (Math.abs(abBottom.y - abTop.y) / AB_ROWS) * 0.42;
  for (let row = 0; row < AB_ROWS; row++) {
    const t = (row + 0.5) / AB_ROWS;
    const at = mixPt(abTop, abBottom, t);
    const rowHalf = half * lerp(0.4, 0.24, t);
    for (const side of [-1, 1]) {
      // Each plate climbs, shortens and tilts as it turns away round the trunk.
      const plate = offset(at, side * rowHalf * 0.5, -abDepth * AB_WRAP_RISE * 0.5);
      fillEllipse(ctx, plate, rowHalf * 0.46, abDepth * 0.92, BELLY.mid, side * AB_WRAP_TILT);
      fillEllipse(
        ctx,
        offset(plate, LIGHT.x * rowHalf * 0.12, LIGHT.y * abDepth * 0.3),
        rowHalf * 0.3,
        abDepth * 0.4,
        BELLY.light,
        side * AB_WRAP_TILT,
      );
    }
    // The groove under the band dips at the navel line and lifts at both ends,
    // which is the same curve the plates above it are sitting on.
    ctx.strokeStyle = groove;
    ctx.lineWidth = grooveWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(at.x - rowHalf * 1.02, at.y + abDepth * (1.05 - AB_WRAP_RISE));
    ctx.quadraticCurveTo(
      at.x,
      at.y + abDepth * 1.5,
      at.x + rowHalf * 1.02,
      at.y + abDepth * (1.05 - AB_WRAP_RISE),
    );
    ctx.stroke();
  }
  ctx.strokeStyle = groove;
  ctx.lineWidth = grooveWidth;
  ctx.beginPath();
  ctx.moveTo(abTop.x, abTop.y - abDepth);
  ctx.lineTo(abBottom.x, abBottom.y);
  ctx.stroke();

  // The obliques: a wedge either side of the ab column running from the lowest
  // rib down into the waistband. Without them the trunk's edge falls straight
  // from the lat to the hip and the whole flank is one flat field of hide.
  for (const side of [-1, 1]) {
    const top = offset(abTop, side * half * 0.46, 0);
    const bottom = offset(abBottom, side * half * 0.2, 0);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.quadraticCurveTo(top.x + side * half * 0.1, mixPt(top, bottom, 0.5).y, bottom.x, bottom.y);
    ctx.quadraticCurveTo(
      mixPt(top, bottom, 0.5).x - side * half * 0.12,
      mixPt(top, bottom, 0.6).y,
      top.x - side * half * 0.12,
      top.y + abDepth * 0.4,
    );
    ctx.closePath();
    ctx.fillStyle = washed(mix(BELLY.mid, HIDE.mid, 0.45), OBLIQUE_ALPHA);
    ctx.fill();
    ctx.strokeStyle = washed(HIDE.dark, RIB_ALPHA);
    ctx.lineWidth = grooveWidth * 0.8;
    ctx.stroke();
  }
}

/**
 * The back: two lat wings sweeping out of the waist, the trapezius wedges above
 * them, and the spinal groove between. A single dark stripe down the middle is
 * a back seam, not an animal; what says "lat" is the pair of hard diagonal
 * edges running from the armpit down into the waist.
 */
/** Where the lat's widest point sits across the back, and how far down it is. */
const LAT_SPREAD_SHARE = 0.86;
const LAT_FLARE_AT = 0.26;
/** Where the lat runs out, tucked into the waist. */
const LAT_INSERTION_ACROSS = 0.2;
const LAT_INSERTION_DOWN = 0.86;
/** Where the lat roots under the armpit. */
const LAT_ROOT_ACROSS = 0.5;
const LAT_ROOT_DOWN = -0.06;
const LAT_ALPHA = 0.55;
const LAT_EDGE_ALPHA = 0.5;
/** The trapezius: a kite from the skull's base out to each deltoid corner. */
const TRAP_OUT_SHARE = 0.82;
const TRAP_DOWN = 0.34;
const TRAP_ALPHA = 0.34;
/** The erector columns either side of the spinal groove. */
const ERECTOR_ACROSS = 0.16;
const ERECTOR_FROM = 0.34;
const ERECTOR_TO = 0.9;
const ERECTOR_ALPHA = 0.3;

/**
 * The back.
 *
 * Built out of *forms* — a trapezius kite, a lat wing per side flaring wide
 * under the armpit and tucking into the waist, a pair of erector columns — and
 * not out of rules. Three straight dark bars in a Y with a flat circle either
 * side of them is a diagram of a back drawn on a flat green board: bars have no
 * width that varies, so nothing in them says which way the surface turns, and
 * at 32 px they collapse into stray marks.
 */
function drawBack(ctx: Ctx, skeleton: Skeleton, half: number, torsoHeight: number): void {
  const groove = washed(HIDE.dark, GROOVE_ALPHA);
  const grooveWidth = half * GROOVE_WIDTH_SHARE;
  const shoulder = skeleton.shoulderCentre;
  const down = (share: number): number => shoulder.y + torsoHeight * share;

  ctx.globalAlpha = TRAP_ALPHA;
  ctx.fillStyle = HIDE.light;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y - TRAP_RISE);
  ctx.quadraticCurveTo(
    shoulder.x + half * 0.5,
    shoulder.y - TRAP_RISE * 0.4,
    shoulder.x + half * TRAP_OUT_SHARE,
    shoulder.y + SHOULDER_JOINT_DROP,
  );
  ctx.quadraticCurveTo(
    shoulder.x + half * 0.34,
    down(TRAP_DOWN * 0.8),
    shoulder.x,
    down(TRAP_DOWN),
  );
  ctx.quadraticCurveTo(
    shoulder.x - half * 0.34,
    down(TRAP_DOWN * 0.8),
    shoulder.x - half * TRAP_OUT_SHARE,
    shoulder.y + SHOULDER_JOINT_DROP,
  );
  ctx.quadraticCurveTo(
    shoulder.x - half * 0.5,
    shoulder.y - TRAP_RISE * 0.4,
    shoulder.x,
    shoulder.y - TRAP_RISE,
  );
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  for (const side of [-1, 1]) {
    const root = pt(shoulder.x + side * half * LAT_ROOT_ACROSS, down(LAT_ROOT_DOWN));
    const flare = pt(shoulder.x + side * half * LAT_SPREAD_SHARE, down(LAT_FLARE_AT));
    const insertion = pt(shoulder.x + side * half * LAT_INSERTION_ACROSS, down(LAT_INSERTION_DOWN));

    ctx.globalAlpha = LAT_ALPHA;
    ctx.fillStyle = HIDE.dark;
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.quadraticCurveTo(
      flare.x + side * half * 0.1,
      flare.y - torsoHeight * 0.1,
      flare.x,
      flare.y,
    );
    ctx.quadraticCurveTo(
      flare.x - side * half * 0.06,
      down(LAT_INSERTION_DOWN * 0.7),
      insertion.x,
      insertion.y,
    );
    ctx.quadraticCurveTo(shoulder.x + side * half * 0.3, down(LAT_FLARE_AT + 0.16), root.x, root.y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // The hard upper margin of the wing. A lat is read by that one edge.
    ctx.strokeStyle = washed(HIDE.light, LAT_EDGE_ALPHA);
    ctx.lineWidth = grooveWidth * 0.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.quadraticCurveTo(
      flare.x + side * half * 0.1,
      flare.y - torsoHeight * 0.1,
      flare.x,
      flare.y,
    );
    ctx.stroke();

    ctx.strokeStyle = washed(HIDE.dark, ERECTOR_ALPHA);
    ctx.lineWidth = half * ERECTOR_ACROSS;
    ctx.beginPath();
    ctx.moveTo(shoulder.x + side * half * ERECTOR_ACROSS * 0.9, down(ERECTOR_FROM));
    ctx.lineTo(shoulder.x + side * half * ERECTOR_ACROSS * 0.7, down(ERECTOR_TO));
    ctx.stroke();
  }

  ctx.strokeStyle = groove;
  ctx.lineWidth = grooveWidth * 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shoulder.x, down(TRAP_DOWN * 0.6));
  ctx.lineTo(skeleton.hip.x, skeleton.hip.y);
  ctx.stroke();
}

/** Where the profile's rear shadow sits and how far the lat's edge runs. */
const FLANK_SHADE_ACROSS = -0.62;
const FLANK_SHADE_ALPHA = 0.42;
const FLANK_LAT_FROM = 0.06;
const FLANK_LAT_TO = 0.74;
const FLANK_LAT_ACROSS = -0.42;
const FLANK_LAT_ALPHA = 0.5;
const FLANK_SERRATUS_COUNT = 3;
const FLANK_SERRATUS_ALPHA = 0.32;

/**
 * The back half of the trunk, seen edge-on.
 *
 * Left as bare fill it is a flat pale field bounded by the trapezius' straight
 * slope on one side and the arm on the other, and that shape reads as a cape
 * hung off his shoulders rather than as his own back. What turns it into a body
 * is the rear edge falling away into shadow, the lat's own hard margin running
 * down it, and the serratus fingers over the ribs.
 */
function drawProfileFlank(ctx: Ctx, skeleton: Skeleton, half: number, torsoHeight: number): void {
  ctx.globalAlpha = FLANK_SHADE_ALPHA;
  fillEllipse(
    ctx,
    offset(mixPt(skeleton.chest, skeleton.hip, 0.3), half * FLANK_SHADE_ACROSS, 0),
    half * 0.66,
    torsoHeight * 0.72,
    HIDE.dark,
  );
  ctx.globalAlpha = 1;

  const latTop = offset(
    mixPt(skeleton.shoulderCentre, skeleton.hip, FLANK_LAT_FROM),
    half * FLANK_LAT_ACROSS * 0.4,
    0,
  );
  const latBottom = offset(
    mixPt(skeleton.shoulderCentre, skeleton.hip, FLANK_LAT_TO),
    half * FLANK_LAT_ACROSS,
    0,
  );
  ctx.strokeStyle = washed(HIDE.dark, FLANK_LAT_ALPHA);
  ctx.lineWidth = half * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(latTop.x, latTop.y);
  ctx.quadraticCurveTo(
    latTop.x - half * 0.34,
    mixPt(latTop, latBottom, 0.5).y,
    latBottom.x,
    latBottom.y,
  );
  ctx.stroke();

  // The serratus: short fingers stepping down the ribs ahead of the lat's edge.
  ctx.strokeStyle = washed(HIDE.dark, FLANK_SERRATUS_ALPHA);
  ctx.lineWidth = half * 0.07;
  for (let finger = 0; finger < FLANK_SERRATUS_COUNT; finger++) {
    const at = mixPt(latTop, latBottom, (finger + 0.5) / FLANK_SERRATUS_COUNT);
    ctx.beginPath();
    ctx.moveTo(at.x + half * 0.06, at.y);
    ctx.lineTo(at.x + half * 0.42, at.y + torsoHeight * 0.06);
    ctx.stroke();
  }
}

function drawTorso(ctx: Ctx, skeleton: Skeleton, pose: JuicerPose, view: ViewSpec): void {
  traceTorso(ctx, skeleton, view, pose.flex, OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  traceTorso(ctx, skeleton, view, pose.flex, 0);
  ctx.fillStyle = HIDE.mid;
  ctx.fill();

  const torsoHeight = Math.abs(skeleton.shoulderCentre.y - skeleton.hip.y);
  const half = SHOULDER_HALF * view.girth;

  ctx.save();
  traceTorso(ctx, skeleton, view, pose.flex, 0);
  ctx.clip();

  // The trunk's own volume goes down *before* the plating, never over it. Laid
  // on top, a 40% wash of the dark hide drags every lit plate two-thirds of the
  // way back to the base tone and turns the whole chest into one flat khaki
  // field — which is exactly what "definition" looked like before.
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
    half * 0.46,
    torsoHeight * 0.26,
    HIDE.light,
  );
  ctx.globalAlpha = 1;

  if (view.profile) {
    drawProfileFlank(ctx, skeleton, half, torsoHeight);
    // Edge-on the plating is a narrow strip down the belly line, not a panel:
    // seen from the side almost all of what faces the camera is flank.
    ctx.globalAlpha = BELLY_ALPHA;
    fillEllipse(
      ctx,
      offset(mixPt(skeleton.chest, skeleton.hip, 0.45), half * 0.4, 0),
      half * 0.28,
      torsoHeight * 0.42,
      BELLY.mid,
    );
    ctx.globalAlpha = 1;
  } else if (view.showsFace) {
    drawChestAndAbs(ctx, skeleton, half, torsoHeight, pose.flex);
  } else {
    drawBack(ctx, skeleton, half, torsoHeight);
  }

  speckleTorso(ctx, skeleton, half * 0.82);
  ctx.restore();
}

// ── Head ─────────────────────────────────────────────────────────────────────
// Everything below is drawn in the head's own local space: the caller has
// already translated to `headCentre` and rotated by the tilt. `yaw` runs −1 to
// 1 and is how far the skull is turned off square toward +X.

/**
 * The muzzle is short and blunt. A long muzzle reads as a beak, every time; the
 * reptile cue is the lip scales, the ear disc and the heavy brow, not snout
 * length. This is deliberately under half a head deep.
 */
const MUZZLE_Y = HEAD_RY * 0.34;
/**
 * How far the muzzle's own centre sits from the skull's, seen edge-on. It has
 * to clear the skull's radius or there is no muzzle at all — a snout drawn
 * inside its own head is a face painted on a ball, which is what the first bake
 * of this creature was.
 */
const MUZZLE_REACH = HEAD_DEPTH * 0.62;
/** How much muzzle survives the turn to head-on, where it is foreshortened. */
const MUZZLE_FACING_SHARE = 0.48;
/** Where along the skull's own radius the wedge roots. */
const MUZZLE_ROOT_SHARE = 0.86;
/** How far back under the skull the jaw line starts. */
const MUZZLE_JAW_BACK_SHARE = -0.1;
/** How far the bridge drops on its way to the nose. A rise is a Roman nose. */
const MUZZLE_TIP_DROP = 0.34;
/**
 * How deep the nose end is against the root. Well under 1, because a
 * parallel-sided muzzle is a drawer pulled out of the face; the taper is what
 * makes it a jaw.
 */
const MUZZLE_TIP_DEPTH = 0.52;
const MUZZLE_TOP_ALPHA = 0.3;
const MUZZLE_RY = HEAD_RY * 0.44;
const MUZZLE_HALF_WIDTH = HEAD_RX * 0.66;
const NOSTRIL_R = HEAD_RX * 0.1;

/** A flat disc of skin over the ear opening — the loudest cheap reptile cue. */
const EAR_DISC_R = HEAD_RX * 0.32;
const EAR_DISC_Y = -HEAD_RY * 0.16;
const EAR_DISC_OUT = HEAD_RX * 0.72;
/**
 * Where the ear sits once the skull is turned: back along the skull, well
 * behind both eyes. Held at its square-on offset it lands on the near eye at
 * every turn the face rows are actually drawn at, and a dark disc touching an
 * eye reads as a wound.
 */
const EAR_DISC_BACK_SHARE = 0.8;
/**
 * The turn by which the ear has finished swinging onto the side of the skull.
 * It is the head-on rows' own permanent yaw, so those rows already show the
 * ear fully back rather than part-way through the slide.
 */
const EAR_SWING_COMPLETE = FACING_HEAD_YAW;

/**
 * The cranium outline, in units of the skull's own two radii, with x running
 * forward toward the face and y down. It is walked from the brow's leading
 * corner down the cheek, around the underside and back up over the crown.
 *
 * An ellipse here is a beach ball with a face stuck on the front of it, which
 * is what the first bake of this skull read as. The crown instead runs as one
 * near-straight plane from the brow's corner back to a high occiput, so the
 * brow ridge is the leading edge of a continuous wedge rather than a stripe
 * painted across a sphere.
 *
 * The walk order matters: the muzzle wedge is traced into the same path, and a
 * subpath wound against it would punch the overlap back out again.
 */
interface CraniumSegment {
  readonly control: Pt;
  readonly to: Pt;
}
const CRANIUM_BROW_CORNER = pt(0.86, -0.68);
const CRANIUM_CROWN_BACK = pt(-0.52, -0.96);
const CRANIUM_CROWN_CONTROL = pt(0.2, -0.85);
const CRANIUM_OUTLINE: readonly CraniumSegment[] = [
  { control: pt(0.98, -0.36), to: pt(1.0, 0.04) },
  { control: pt(1.0, 0.62), to: pt(0.55, 0.88) },
  { control: pt(-0.06, 1.06), to: pt(-0.72, 0.78) },
  { control: pt(-1.06, 0.5), to: pt(-1.06, -0.14) },
  { control: pt(-1.02, -0.82), to: CRANIUM_CROWN_BACK },
  { control: CRANIUM_CROWN_CONTROL, to: CRANIUM_BROW_CORNER },
];

function quadPoint(from: Pt, control: Pt, to: Pt, t: number): Pt {
  const inv = 1 - t;
  return pt(
    inv * inv * from.x + 2 * inv * t * control.x + t * t * to.x,
    inv * inv * from.y + 2 * inv * t * control.y + t * t * to.y,
  );
}

function traceCranium(ctx: Ctx, side: number, rx: number, ry: number): void {
  ctx.moveTo(side * CRANIUM_BROW_CORNER.x * rx, CRANIUM_BROW_CORNER.y * ry);
  for (const segment of CRANIUM_OUTLINE) {
    ctx.quadraticCurveTo(
      side * segment.control.x * rx,
      segment.control.y * ry,
      side * segment.to.x * rx,
      segment.to.y * ry,
    );
  }
  ctx.closePath();
}

const EYE_RX = HEAD_RX * 0.24;
const EYE_RY = HEAD_RY * 0.19;
const EYE_SPREAD = HEAD_RX * 0.6;
const EYE_Y = -HEAD_RY * 0.22;
const GLARE_GAIN = 0.34;
/** Below this the eye carries no highlight at all: a glint is an angry eye. */
const GLINT_FROM = 0.5;
/** How much of the eye's own width a closed lid spans. */
const BLINK_LID_SHARE = 0.85;
/** Below this the eye is drawn as a lid line rather than as an ellipse. */
const SHUT_EYE_HEIGHT = 0.004;
const BROW_THICKNESS = HEAD_RX * 0.34;
/**
 * Teeth are front-loaded, never a row.
 *
 * An evenly spaced comb running the length of the jaw reads as a keyboard
 * smile at 32 px however carefully each tooth is drawn — the spacing is the
 * whole signal and the eye reads it before it reads anything else. So: very
 * few teeth, a canine at the front carrying most of the size, each one behind
 * it smaller and further from its neighbour, and nothing at all down the back
 * of the jaw where the profile foreshortens it to a smear anyway.
 */
const TOOTH_COUNT_CLOSED = 2;
const TOOTH_COUNT_GAPE = 3;
/** Where the canine sits, as a share of the jaw's length back from the nose. */
const TOOTH_FRONT_AT = 0.13;
/** The first gap behind the canine, and how much each gap widens after it. */
const TOOTH_STEP = 0.17;
const TOOTH_STEP_GROWTH = 0.55;
/** How much of the tooth ahead of it each tooth keeps. */
const TOOTH_FALLOFF = 0.6;

interface ToothStop {
  /** Share of the jaw's length back from the nose. */
  readonly at: number;
  /** Share of the canine's size. */
  readonly scale: number;
}

function toothLadder(count: number): readonly ToothStop[] {
  const stops: ToothStop[] = [];
  let at = TOOTH_FRONT_AT;
  let step = TOOTH_STEP;
  for (let i = 0; i < count; i++) {
    stops.push({ at, scale: TOOTH_FALLOFF ** i });
    at += step;
    step *= 1 + TOOTH_STEP_GROWTH;
  }
  return stops;
}
/** Crest scales up the back of the skull, the away view's identifying shape. */
const CREST_COUNT = 5;
const CREST_HEIGHT = HEAD_RY * 0.26;

function drawEye(ctx: Ctx, centre: Pt, blink: number, glare: number, squash: number): void {
  const open = 1 - clamp01(blink);
  const rx = EYE_RX * (1 + glare * GLARE_GAIN) * squash;
  const ry = EYE_RY * (1 + glare * GLARE_GAIN) * open;
  if (ry <= SHUT_EYE_HEIGHT || rx <= SHUT_EYE_HEIGHT) {
    ctx.beginPath();
    ctx.moveTo(centre.x - rx * BLINK_LID_SHARE, centre.y);
    ctx.lineTo(centre.x + rx * BLINK_LID_SHARE, centre.y);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = EYE_RY * 0.55;
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }
  fillEllipse(ctx, centre, rx * 1.5, ry * 1.6, HIDE.dark);
  fillEllipse(ctx, centre, rx, ry, EYE_IRIS);
  // A vertical slit. It is two pixels wide in game and it is the single thing
  // that stops a bright round eye reading as a mammal's.
  fillEllipse(ctx, centre, Math.max(rx * 0.2, EYE_RX * 0.12), ry * 0.92, EYE_SLIT);
  if (glare > GLINT_FROM) {
    fillEllipse(
      ctx,
      offset(centre, -rx * 0.42, -ry * 0.36),
      rx * 0.22,
      ry * 0.24,
      washed(EYE_SPARK, (glare - GLINT_FROM) / (1 - GLINT_FROM)),
    );
  }
}

/**
 * The brow: a bony shelf over the eye with a hard leading corner, not a bar.
 *
 * Along with the ear disc and the lip scutes this is what carries the reptile
 * read — the muzzle's length never does, because a snout long enough to read as
 * a snout reads as a beak instead.
 *
 * It runs as one straight tapering wedge whose heavy end hoods the inboard
 * corner of the eye and whose point lifts away over the outboard corner. Two
 * things decide whether a face is angry or startled and neither is the eye: an
 * inboard end that sits *below* the outboard one, and a top edge with no arch
 * in it. A brow bowed upward in the middle is a raised eyebrow at any angle.
 */
const BROW_INBOARD = 1.5;
const BROW_OUTBOARD = 2.1;
/** Share of the brow's own lift the inboard end keeps. Well under the outboard. */
const BROW_INNER_DROP = 0.5;
const BROW_OUTER_LIFT = 1.25;
/** How much of its inboard thickness the wedge keeps at the outboard point. */
const BROW_TIP_TAPER = 0.22;

function drawBrowRidge(ctx: Ctx, centre: Pt, side: number, glare: number, squash: number): void {
  const width = EYE_RX * squash;
  const lift = EYE_RY * (2.4 - glare * 0.9);
  const inner = offset(centre, -side * width * BROW_INBOARD, -lift * BROW_INNER_DROP);
  const outer = offset(centre, side * width * BROW_OUTBOARD, -lift * BROW_OUTER_LIFT);
  const innerTop = inner.y - BROW_THICKNESS * 0.6;
  const innerBottom = inner.y + BROW_THICKNESS * 0.4;
  const tipHalf = BROW_THICKNESS * 0.5 * BROW_TIP_TAPER;
  ctx.beginPath();
  ctx.moveTo(inner.x, innerBottom);
  ctx.lineTo(inner.x, innerTop);
  ctx.lineTo(outer.x, outer.y - tipHalf);
  ctx.lineTo(outer.x, outer.y + tipHalf);
  ctx.closePath();
  ctx.fillStyle = HIDE.dark;
  ctx.fill();
  // A lit top edge, so the shelf has a thickness rather than reading as a
  // painted stripe.
  ctx.beginPath();
  ctx.moveTo(inner.x, innerTop);
  ctx.lineTo(outer.x, outer.y - tipHalf);
  ctx.strokeStyle = washed(HIDE.light, 0.5);
  ctx.lineWidth = BROW_THICKNESS * 0.3;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** The flat ear disc, drawn on the skull rather than standing off it. */
function drawEarDisc(ctx: Ctx, centre: Pt, squash: number): void {
  fillEllipse(ctx, centre, EAR_DISC_R * squash, EAR_DISC_R, mix(HIDE.dark, HIDE.mid, 0.35));
  fillEllipse(ctx, centre, EAR_DISC_R * 0.52 * squash, EAR_DISC_R * 0.52, HIDE.dark);
}

/** How far out the skull's own radius the ear rides when seen from behind. */
const AWAY_EAR_OUT_SHARE = 0.94;
/** How far below the ear's square-on height the away view carries it. */
const AWAY_EAR_DROP = HEAD_RY * 0.24;
const AWAY_EAR_ALPHA = 0.42;

/**
 * The ear seen from behind: a crease riding the edge of the skull, not a disc.
 *
 * Given the face's own ear — a dark disc with a darker centre, drawn on both
 * sides at eye height and eye spacing — the back of the head grows a pair of
 * eyes, and a retreating sprite whose back looks at the camera leaves the
 * player unable to tell which way the boss is facing. Hung half off the skull's
 * own outline, lower down toward the jaw, and painted as one soft tone with no
 * pupil in it, the same feature reads as the side of a head instead.
 */
function drawAwayEar(ctx: Ctx, side: number, skullRx: number): void {
  fillEllipse(
    ctx,
    pt(side * skullRx * AWAY_EAR_OUT_SHARE, EAR_DISC_Y + AWAY_EAR_DROP),
    EAR_DISC_R * 0.5,
    EAR_DISC_R * 0.9,
    washed(HIDE.dark, AWAY_EAR_ALPHA),
  );
}

/** How far past the lip a canine hangs, and how wide it is at the gum. */
const TOOTH_LENGTH = 1.15;
const TOOTH_HALF_WIDTH = 0.3;

/**
 * The lip line from `from` (the back of the jaw) to `to` (the nose), with the
 * two teeth a shut mouth still shows hanging over it.
 */
function drawLipLine(ctx: Ctx, from: Pt, to: Pt, depth: number, teeth: number): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = HIDE.dark;
  ctx.lineWidth = depth * 0.36;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.fillStyle = TOOTH;
  for (const stop of toothLadder(teeth)) {
    const root = mixPt(to, from, stop.at);
    const half = depth * TOOTH_HALF_WIDTH * stop.scale;
    const tip = depth * TOOTH_LENGTH * stop.scale;
    ctx.beginPath();
    ctx.moveTo(root.x - half, root.y);
    ctx.lineTo(root.x + half, root.y);
    // The point is offset toward the back of the jaw, so the fang hooks rather
    // than standing as a symmetric peg.
    ctx.lineTo(root.x + (from.x < to.x ? -half : half) * 0.5, root.y + tip);
    ctx.closePath();
    ctx.fill();
  }
}

function drawMaw(ctx: Ctx, lipFrom: Pt, lipTo: Pt, maw: number, depth: number): void {
  if (maw <= 0.01) {
    drawLipLine(ctx, lipFrom, lipTo, depth, TOOTH_COUNT_CLOSED);
    return;
  }
  const drop = depth * 2.4 * maw;
  const centre = offset(mixPt(lipFrom, lipTo, 0.5), 0, drop * 0.45);
  const half = Math.hypot(lipTo.x - lipFrom.x, lipTo.y - lipFrom.y) * 0.5;
  const towardNose = lipTo.x >= lipFrom.x ? 1 : -1;
  outlineEllipse(ctx, centre, half, drop * 0.6);
  fillEllipse(ctx, centre, half, drop * 0.6, MAW_INNER);
  ctx.save();
  traceEllipse(ctx, centre, half, drop * 0.6);
  ctx.clip();
  ctx.fillStyle = TOOTH;
  const upperRoof = centre.y - drop * 0.6;
  const lowerFloor = centre.y + drop * 0.6;
  for (const stop of toothLadder(TOOTH_COUNT_GAPE)) {
    const x = centre.x + towardNose * half * (1 - 2 * stop.at);
    const width = half * TOOTH_HALF_WIDTH * stop.scale;
    const length = drop * TOOTH_LENGTH * 0.5 * stop.scale;
    ctx.beginPath();
    ctx.moveTo(x - width, upperRoof);
    ctx.lineTo(x + width, upperRoof);
    ctx.lineTo(x, upperRoof + length);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - width, lowerFloor);
    ctx.lineTo(x + width, lowerFloor);
    ctx.lineTo(x, lowerFloor - length);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // No hanging fangs here: the gape already has its own, and a second set on
  // the lip line lands on top of them.
  drawLipLine(ctx, lipFrom, lipTo, depth * 0.7, 0);
}

/** The stretch of the crown plane the crest occupies, leaving both ends bare. */
const CREST_FROM = 0.08;
const CREST_TO = 0.9;

/**
 * The crest roots on the crown plane itself rather than on a circle: a spike
 * placed on an arc the skull no longer has floats off the outline.
 */
function drawCrest(ctx: Ctx, side: number, rx: number, ry: number, forward: number): void {
  ctx.strokeStyle = HIDE.dark;
  ctx.lineCap = 'round';
  for (let i = 0; i < CREST_COUNT; i++) {
    const along = lerp(CREST_FROM, CREST_TO, (i + 0.5) / CREST_COUNT);
    const root = quadPoint(CRANIUM_CROWN_BACK, CRANIUM_CROWN_CONTROL, CRANIUM_BROW_CORNER, along);
    const x = side * root.x * rx;
    const y = root.y * ry;
    const height = CREST_HEIGHT * (0.55 + hash1(i + SCALE_SEED) * 0.7);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + forward * height * 0.9, y - height * 0.8);
    ctx.lineWidth = height * 0.62;
    ctx.stroke();
  }
}

/**
 * The skull, at any yaw between square-on and full profile.
 *
 * One construction serves all three views. Head-on the muzzle is *fore-
 * shortened* rather than shortened — a snout square to the camera projects to a
 * stub and the head stops reading as a lizard's at all — so the head-on rows
 * carry a permanent three-quarter turn and this function interpolates the
 * muzzle's reach, the eye squash and where the ear disc sits from `yaw`.
 */
function drawHead(ctx: Ctx, pose: JuicerPose, yaw: number, showsFace: boolean): void {
  const turn = Math.max(-1, Math.min(1, yaw));
  const side = turn >= 0 ? 1 : -1;
  const turnDepth = Math.abs(turn);
  const skullRx = lerp(HEAD_RX, HEAD_DEPTH, turnDepth);
  const muzzleLength = lerp(HEAD_RX * MUZZLE_FACING_SHARE, MUZZLE_REACH, turnDepth);
  const noseX = side * (skullRx * MUZZLE_ROOT_SHARE + muzzleLength);
  const jawBackX = side * skullRx * MUZZLE_JAW_BACK_SHARE;
  const bridgeY = MUZZLE_Y - MUZZLE_RY;
  const jawY = MUZZLE_Y + MUZZLE_RY;
  // How much a head-on feature squashes as the skull turns away from square.
  const faceSquash = lerp(1, 0.42, turnDepth);
  const earSwing = Math.min(1, turnDepth / EAR_SWING_COMPLETE);
  const earCentre = pt(
    side * lerp(EAR_DISC_OUT, -skullRx * EAR_DISC_BACK_SHARE, earSwing),
    EAR_DISC_Y,
  );

  /**
   * The muzzle is a wedge traced into the same path as the skull: a straight
   * bridge running out from under the brow to a squared-off nose, and a jaw
   * line under it. An ellipse stuck on the front of a ball is a pair of lips,
   * which is what the first bake of this creature read as — the reptile cue is
   * the flat top plane and the hard corner at the nose, never a bulb.
   */
  const traceSkull = (grow: number): void => {
    ctx.beginPath();
    traceCranium(ctx, side, skullRx + grow, HEAD_RY + grow);
    // From behind, the muzzle is on the far side of the skull and the cranium
    // covers all of it. Traced anyway it unions a hard-cornered wedge onto the
    // outline at ear height on one side only, which is a rectangular tab
    // growing out of the back of his head and nothing else.
    if (!showsFace) {
      ctx.closePath();
      return;
    }
    ctx.moveTo(jawBackX, bridgeY - grow);
    ctx.quadraticCurveTo(
      side * (skullRx * MUZZLE_ROOT_SHARE + muzzleLength * 0.55),
      bridgeY - grow,
      noseX + side * grow,
      bridgeY + MUZZLE_RY * MUZZLE_TIP_DROP - grow,
    );
    ctx.lineTo(
      noseX + side * grow,
      bridgeY + MUZZLE_RY * (MUZZLE_TIP_DROP + 2 * MUZZLE_TIP_DEPTH) + grow,
    );
    ctx.quadraticCurveTo(
      side * (skullRx * MUZZLE_ROOT_SHARE + muzzleLength * 0.4),
      jawY + grow,
      jawBackX,
      jawY + grow,
    );
    ctx.closePath();
  };
  traceSkull(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  traceSkull(0);
  ctx.fillStyle = HIDE.mid;
  ctx.fill();

  ctx.save();
  traceSkull(0);
  ctx.clip();
  ctx.globalAlpha = MASS_SHADE_ALPHA;
  fillEllipse(
    ctx,
    pt(-LIGHT.x * skullRx * 0.55, -LIGHT.y * HEAD_RY * 0.55),
    skullRx * 0.92,
    HEAD_RY * 0.92,
    HIDE.dark,
  );
  ctx.globalAlpha = 1;
  // The top plane of the muzzle catches the light; the jaw under it stays in
  // the flank tone. Two planes with a hard step between them is what makes a
  // wedge read as a wedge rather than as a flat tab.
  // Rooted at the wedge, not at the jaw's back corner: run back that far and
  // most of the plane lies inside the cranium, where it paints a pale slab
  // across the middle of the skull that reads as a hole in the head.
  if (showsFace) {
    const topPlaneBackX = side * skullRx * MUZZLE_ROOT_SHARE;
    ctx.fillStyle = washed(HIDE.light, MUZZLE_TOP_ALPHA);
    ctx.beginPath();
    ctx.moveTo(topPlaneBackX, bridgeY);
    ctx.lineTo(noseX, bridgeY + MUZZLE_RY * MUZZLE_TIP_DROP);
    ctx.lineTo(noseX, MUZZLE_Y - MUZZLE_RY * 0.1);
    ctx.lineTo(topPlaneBackX, MUZZLE_Y - MUZZLE_RY * 0.25);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  if (!showsFace) {
    drawCrest(ctx, side, skullRx, HEAD_RY, side);
    // Both ears show from behind, and they show at the same offset: the skull
    // is square to the camera from this side too, so one crease alone reads as
    // damage on an otherwise blank scalp rather than as an ear.
    ctx.save();
    traceSkull(0);
    ctx.clip();
    for (const earSide of [-1, 1]) {
      drawAwayEar(ctx, earSide, skullRx);
    }
    ctx.restore();
    return;
  }

  // The lip runs along the jaw line of the wedge, not across its middle: pale
  // marks in the middle of the muzzle are a mouthful of teeth in a grin.
  const lipFrom = pt(jawBackX, jawY - MUZZLE_RY * 0.2);
  const lipTo = pt(
    noseX,
    bridgeY + MUZZLE_RY * (MUZZLE_TIP_DROP + 2 * MUZZLE_TIP_DEPTH) - MUZZLE_RY * 0.12,
  );
  // Clipped to the skull. The front fang roots on the lip line, which ends *at*
  // the nose corner, so half of it hangs off the front of the jaw — and a pale
  // splinter floating past the tip of a muzzle reads as damage, not as a tooth.
  ctx.save();
  traceSkull(0);
  ctx.clip();
  drawMaw(ctx, lipFrom, lipTo, pose.maw, MUZZLE_RY * 0.34);
  ctx.restore();

  for (const nostrilSide of [-1, 1]) {
    const acrossFace = lerp(1, 0.25, turnDepth) * nostrilSide;
    fillEllipse(
      ctx,
      pt(
        noseX - side * muzzleLength * 0.3 + acrossFace * MUZZLE_HALF_WIDTH * 0.26,
        bridgeY + MUZZLE_RY * (MUZZLE_TIP_DROP + 0.3),
      ),
      NOSTRIL_R * lerp(1, 0.7, turnDepth),
      NOSTRIL_R * 0.8,
      NOSTRIL,
    );
  }

  drawCrest(ctx, side, skullRx, HEAD_RY, -side);

  // The near eye rides toward the turned side; the far one shrinks and slides
  // onto the skull's edge rather than vanishing, which is what a real three-
  // quarter head does and what keeps the face from reading as one-eyed.
  const nearEye = pt(side * EYE_SPREAD * lerp(1, 0.72, turnDepth), EYE_Y);
  const farEye = pt(-side * EYE_SPREAD * lerp(1, 0.34, turnDepth), EYE_Y);
  if (turnDepth < 0.92) {
    drawEye(ctx, farEye, pose.blink, pose.glare, faceSquash);
    drawBrowRidge(ctx, farEye, -side, pose.glare, faceSquash);
  }
  drawEye(ctx, nearEye, pose.blink, pose.glare, 1);
  drawBrowRidge(ctx, nearEye, side, pose.glare, 1);

  drawEarDisc(ctx, earCentre, faceSquash);
}

// ── Rim light ────────────────────────────────────────────────────────────────

const RIM_WIDTH = 0.038;
/** How much of the trunk's own half-width the lit edge is allowed to cover. */
const RIM_LIT_SHARE = 0.4;

/**
 * The lit edge of the trunk, painted as the trunk's *own* outline clipped to
 * the trunk and to the lit side of it.
 *
 * Not decoration: the dorsal hide is dark enough that on the unlit-cave floor
 * the silhouette's lit edge would otherwise sit within a few values of the
 * ground, and a creature at the floor's own luminance is a smudge at 32 px.
 *
 * It has to be the silhouette's own path. Drawn as a hand-placed curve through
 * hip, chest and shoulder *points* it followed no edge at all: those points are
 * well inside the outline, so the stroke ran diagonally across the middle of the
 * body in a colour matching nothing else in the palette, ended in mid-air, and
 * on the frames where a pose threw the shoulder about it left the silhouette
 * entirely and floated in the background.
 */
function drawRimLight(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, flex: number): void {
  const side = LIGHT.x >= 0 ? 1 : -1;
  const reach = SHOULDER_HALF * view.girth * 2;
  const from = skeleton.chest.x + side * SHOULDER_HALF * view.girth * (1 - 2 * RIM_LIT_SHARE);
  // Head-on, the trunk's flank below the shoulder is not the figure's edge at
  // all — the arms hang outside it — so a rim painted there is a bright line
  // running down the middle of the chest with nothing on either side of it.
  // Only the trapezius shelf above the shoulder joint is genuinely exposed.
  const bottom = view.profile ? skeleton.hip.y + reach : skeleton.shoulderCentre.y;

  ctx.save();
  traceTorso(ctx, skeleton, view, flex, 0);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(
    side > 0 ? from : from - reach,
    skeleton.shoulderCentre.y - reach,
    reach,
    bottom - skeleton.shoulderCentre.y + reach,
  );
  ctx.clip();
  traceTorso(ctx, skeleton, view, flex, 0);
  ctx.strokeStyle = washed(RIM_LIGHT, RIM_ALPHA);
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

// ── Assembly ─────────────────────────────────────────────────────────────────

const SHADOW_LIFT_FADE = 2;
const SHADOW_LIFT_SHRINK = 0.7;
const HEAD_LEAN_FOLLOW = 0.3;
/** How wide the throat is where it meets the chest and where it meets the jaw. */
const THROAT_ROOT_SHARE = 0.32;
const THROAT_TOP_SHARE = 0.62;
/** How far up into the skull the throat reaches, so the two never separate. */
const THROAT_OVERLAP = 0.35;

/**
 * The wedge of neck between the jaw and the trapezius.
 *
 * A neck thick and short is part of the character, and a head placed close
 * enough to look right standing still still opens a gap the moment a pose
 * leans or turns it. Painting the gap shut is the only thing that holds across
 * every frame; a strut narrow enough to show reads as a leash.
 */
function drawThroat(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const rootHalf = SHOULDER_HALF * view.girth * THROAT_ROOT_SHARE;
  const topHalf = HEAD_RX * view.girth * THROAT_TOP_SHARE;
  const top = offset(skeleton.headCentre, 0, HEAD_RY * THROAT_OVERLAP);
  // Painted *under* the trunk and unstroked. Inked, its two sides show through
  // as a U across the chest and read as a collar.
  fillCapsule(ctx, skeleton.shoulderCentre, top, rootHalf, topHalf, mix(HIDE.mid, HIDE.dark, 0.4));
}

function drawFigure(ctx: Ctx, view: ViewSpec, pose: JuicerPose): void {
  const skeleton = buildSkeleton(pose, view);

  // The *lower* of the two feet, and +Y is down, so this is a `max`. Taking the
  // min picks whichever foot is highest and fades the shadow once a stride
  // while the other one is still planted on the floor.
  const lift = Math.max(0, -Math.max(pose.leftFoot.y, pose.rightFoot.y));
  const shadowFade = clamp01(1 - lift * SHADOW_LIFT_FADE);
  drawGroundShadow(
    ctx,
    skeleton.hip.x * SHADOW_FOLLOW,
    CONTACT_SHADOW_ALPHA * lerp(SHADOW_LIFT_SHRINK, 1, shadowFade),
  );

  // Head-on the tail is behind him and goes down first; from behind it is
  // between the camera and his legs, so it goes down last.
  const tailInFront = !view.profile && !view.showsFace;
  if (!tailInFront) drawTail(ctx, skeleton, view, pose);

  // The figure's left side is the far one. Seen edge-on that arm is genuinely
  // behind the torso; head-on it hangs in front like the near one, and drawing
  // it early is what makes a figure look one-armed. Bare hide takes no depth
  // shade outside the profile — there it reads as two colours of skin.
  const farArmShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  const leftBehind = view.profile || pose.leftArmBehind;
  const rightBehind = !view.profile && pose.rightArmBehind;
  // Edge-on the biceps faces +X, the way the figure does; head-on it faces the
  // camera, so the belly is centred and both edges of the arm fall away.
  const bicepsAcross = view.profile ? 1 : 0;
  // What faces the camera on the away rows is the back of the arm, so the mass
  // that takes the light there is the triceps and not the biceps.
  const armFromBehind = !view.profile && !view.showsFace;
  // Which perpendicular of each humerus points away from the trunk, so the
  // deltoid inks its free edge and shades the seam where it meets the body.
  const leftOutboard = LEFT_ARM_OUTBOARD;
  const rightOutboard = -LEFT_ARM_OUTBOARD;
  if (leftBehind) {
    drawArm(
      ctx,
      skeleton.leftArm,
      pose.leftFist,
      farArmShade,
      bicepsAcross,
      armFromBehind,
      leftOutboard,
    );
  }
  if (rightBehind) {
    drawArm(
      ctx,
      skeleton.rightArm,
      pose.rightFist,
      farArmShade,
      bicepsAcross,
      armFromBehind,
      rightOutboard,
    );
  }

  drawLeg(ctx, skeleton.leftLeg, pose.leftFootPitch, view, LEFT_FOOT_OUT, pose.leftLegNearness);
  drawLeg(ctx, skeleton.rightLeg, pose.rightFootPitch, view, RIGHT_FOOT_OUT, pose.rightLegNearness);

  drawThroat(ctx, skeleton, view);
  drawTorso(ctx, skeleton, pose, view);
  drawRimLight(ctx, skeleton, view, pose.flex);
  drawShortsSeat(ctx, skeleton, view);

  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(pose.headTilt + pose.lean * HEAD_LEAN_FOLLOW);
  drawHead(ctx, pose, view.headYaw + pose.headTurn, view.showsFace);
  ctx.restore();

  if (!leftBehind) {
    drawArm(
      ctx,
      skeleton.leftArm,
      pose.leftFist,
      farArmShade,
      bicepsAcross,
      armFromBehind,
      leftOutboard,
    );
  }
  if (!rightBehind) {
    drawArm(
      ctx,
      skeleton.rightArm,
      pose.rightFist,
      view.profile ? NEAR_LIMB_LIFT : UNSHADED,
      bicepsAcross,
      armFromBehind,
      rightOutboard,
    );
  }

  if (tailInFront) drawTail(ctx, skeleton, view, pose);
}

/** Head-on, coming at the camera. */
export function drawJuicerFront(ctx: Ctx, pose: JuicerPose): void {
  drawFigure(ctx, VIEWS.front, pose);
}

/** From behind, walking away. */
export function drawJuicerBack(ctx: Ctx, pose: JuicerPose): void {
  drawFigure(ctx, VIEWS.back, pose);
}

/** In profile. Always drawn facing +X; the runtime mirrors for the left. */
export function drawJuicerSide(ctx: Ctx, pose: JuicerPose): void {
  drawFigure(ctx, VIEWS.side, pose);
}
