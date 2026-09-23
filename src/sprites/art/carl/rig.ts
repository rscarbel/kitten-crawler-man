/**
 * Carl's rig: the view table, the pose every row fills, and the skeleton solved
 * from a pose — the forward kinematics the painter draws over and the joint
 * probe reads.
 *
 * The figure is built by forward kinematics and then painted over the joints, so
 * a limb physically cannot come apart no matter how far a pose throws it. Three
 * viewpoints are drawn — `front` (toward the camera), `back` (away) and `side`
 * (profile, always facing +X so the runtime can mirror it) — and all three read
 * the same {@link CarlPose}; the choreography that fills that pose lives in
 * `src/sprites/art/human/`.
 *
 * Coordinates are tile units with the origin at the point between the feet and
 * +Y pointing down the screen, so heights above the ground are negative. The
 * caller translates to that ground point and scales by one tile before calling
 * a painter, exactly as the cat's painter expects.
 */

import { mixPt, offset, pt, rotate } from './geometry';
import { pointedAnkleRise } from './feet';
import type { CarlGear } from './gear';
import type { HeldProp } from './props';
import {
  ANKLE_Y,
  ARM_LENGTH,
  ARM_ROOT_HALF,
  FACING_SHOULDER_SPREAD,
  FOREARM_LENGTH,
  HEAD_CENTRE_Y,
  HEAD_RX,
  HIP_Y,
  LEG_ROOT_HALF,
  PROFILE_LATERAL,
  SHIN_LENGTH,
  SHOULDER_HALF,
  SHOULDER_JOINT_DROP,
  SHOULDER_Y,
  THIGH_LENGTH,
  UPPER_ARM_LENGTH,
  WAIST_Y,
} from './proportions';
import { clamp01, easeInOut, type Pt } from '../carlArt';

// ── Views ────────────────────────────────────────────────────────────────────

export type CarlView = 'front' | 'back' | 'side';

export interface ViewSpec {
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
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
  /** True when the back of the head and the jacket's back panel are shown. */
  readonly showsBack: boolean;
  /**
   * True when the view's picture is the pose reflected left for right before
   * it is solved. Poses are authored with his right side toward +X, which is
   * where it lies from behind; facing the camera his right side is on the
   * viewer's left, so the head-on-front pose is drawn through
   * {@link mirrorPose}. Only geometry is reflected: the key light stays at
   * the upper left.
   */
  readonly mirrored: boolean;
}

const PROFILE_GIRTH = 0.68;
const PROFILE_HIP_DEPTH = 0.88;
const PROFILE_ARM_SPREAD = 0.12;
const PROFILE_CROTCH_NOTCH = 0.18;

export const VIEWS: Record<CarlView, ViewSpec> = {
  front: {
    lateral: 1,
    girth: 1,
    hipDepth: 1,
    armSpread: 1,
    crotchNotch: 1,
    profile: false,
    showsBack: false,
    mirrored: true,
  },
  back: {
    lateral: 1,
    girth: 1,
    hipDepth: 1,
    armSpread: 1,
    crotchNotch: 1,
    profile: false,
    showsBack: true,
    mirrored: false,
  },
  side: {
    lateral: PROFILE_LATERAL,
    girth: PROFILE_GIRTH,
    hipDepth: PROFILE_HIP_DEPTH,
    armSpread: PROFILE_ARM_SPREAD,
    crotchNotch: PROFILE_CROTCH_NOTCH,
    profile: true,
    showsBack: false,
    mirrored: false,
  },
};

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * One frame of Carl. Hand and foot positions are targets in figure space that
 * the limb solver reaches for, so the choreography never has to think about
 * joint angles. `left`/`right` are the figure's own left and right; in the
 * profile view the right side is the near one, closest to the camera.
 *
 * Every view's pose is authored with his right side toward +X, as it lies
 * from behind. The front view paints it reflected ({@link ViewSpec.mirrored}),
 * so a head-on pose keeps its anatomy: the hand a pose calls right is his
 * right from whichever side he is seen.
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
  /** 0 open hand, 1 closed fist, per hand. Only a `'relaxed'` hand reads it. */
  leftFist: number;
  rightFist: number;
  /** What each hand is doing; absent is `'relaxed'`. See {@link HandShape}. */
  leftHandShape?: HandShape;
  rightHandShape?: HandShape;
  /**
   * Props painted into the grip of a hand posed with `HandShape` `'grip'`. See
   * `HeldProp` in `props.ts`; absent is none held.
   */
  heldProps?: readonly HeldProp[];
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
  /**
   * How much larger a foot is drawn than its own size, for a foot driven at the
   * camera: head-on a kick toward the viewer has no length to show, so the foot
   * growing is what says it is coming closer. Absent is 1.
   */
  leftFootScale?: number;
  rightFootScale?: number;
  /**
   * Head-on only: how far a foot is pointed down onto its toes, 0 flat to 1
   * on the tips, with the heel lifted. Head-on `leftFootPitch` cannot show
   * that — a pitch there would rotate the foot sideways in the picture — so
   * the ankle rises and the foot below it draws taller instead (see
   * `pointedFootStretch` in `feet.ts`), and the sole stays on the floor. It is
   * what says a foot bears no weight while it still touches the ground.
   * Ignored with a foot depth set. Absent is flat.
   */
  leftFootPoint?: number;
  rightFootPoint?: number;
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
  /**
   * Where the eyes look vertically, −1 down to 1 up, independent of the head.
   * Absent is level. Rolling the eyes to the ceiling is most of what makes a
   * head tipped back read as looking *at* something rather than as a stretch.
   */
  gazeUp?: number;
  /**
   * The head pitched back (positive) or tucked down (negative), −1 to 1, for the
   * views that see the face or the skull square on. Head-on a pitch has no
   * in-plane angle to rotate by, so it shows as the features riding up or down
   * the face; absent is level.
   */
  chinLift?: number;
  /**
   * The mouth's width against its resting width. Absent is 1; under 1 purses it
   * toward an "o", over 1 pulls it into a flat grimace — the two extra shapes a
   * muttered line needs beyond open and shut.
   */
  mouthWidth?: number;
  /**
   * Head-on only: how far each foot's ankle stands ahead of his hip along the
   * way he is travelling, in tile units — positive toward the direction he
   * faces, so toward the camera in the front view and away from it in the back
   * view. Absent keeps the foot on the hip's own ground line, which is how
   * every standing row is posed.
   *
   * Set, it turns the leg into a three-dimensional one: `leftFoot`/`rightFoot`
   * then give only the foot's sideways position and its lift off the floor
   * (`y` = −lift), the IK reaches in three dimensions, and the depth is drawn
   * as screen height by {@link depthShareAt} — on the floor at the floor's
   * foreshortened share, where a planted foot slides up or down the screen
   * with the ground ({@link HEAD_ON_FLOOR_FORESHORTENING}), and not at all at
   * hip height, where a knee driven at the camera must still read as lifted
   * rather than as a leg hanging longer.
   */
  leftFootDepth?: number;
  rightFootDepth?: number;
  /**
   * Head-on only: how far each hand is ahead of his chest along the way he
   * faces, in tile units — toward the camera in the front view, away from it
   * in the back view. It changes only the painting order, not where the hand
   * is drawn: a hand far enough on the camera's far side of his body (a
   * hammer-fist brought down in front of him, seen from behind) paints its arm
   * behind the torso and head, the same as `leftArmBehind`. Absent is level
   * with the chest.
   */
  leftHandDepth?: number;
  rightHandDepth?: number;
  /**
   * The share of the upper arm's length drawn, for an upper arm driven toward
   * or away from the camera: a guard's elbows held in front of the ribs, a bow
   * drawn back toward the viewer, an elbow cocked up behind the head. Drawn at
   * full length, a guard's elbows cannot be under fists raised to the cheeks.
   * Absent is full length, the upper arm lying in the picture plane. It holds
   * however the arm is solved, from its hand or from its angles.
   */
  leftUpperArmScale?: number;
  rightUpperArmScale?: number;
  /**
   * Head-on only: the torso pitched about the hips, in radians — positive bends
   * the chest forward over his hips along the way he faces (toward the camera
   * in the front view, away from it in the back view), negative leans him
   * back. Edge-on the same bend is `lean`, an angle in the picture plane.
   *
   * Head-on there is no in-plane angle to rotate by, so the pitch shows as the
   * spine foreshortening: shoulders, neck and head all drop toward the hips by
   * the cosine of the pitch and the jacket shortens with them, which is what
   * puts a hammer-fist's or a knee drop's chest over the knee. Pitched far
   * enough away from the camera the head sinks behind the top of his back.
   * Absent is upright.
   */
  torsoPitch?: number;
  /**
   * How far the chest, shoulders, neck and head ride up off the waist, in tile
   * units: the rib cage filling on an inhale and the shoulders lifting with
   * it. It lengthens the spine above the waist and leaves the hips and legs
   * where they are, which is the only way a standing figure can rise at all —
   * his legs are within a hair of full reach at rest, so lifting the pelvis
   * locks the knees. Absent is none.
   */
  chestRise?: number;
  /**
   * Edge-on only: a bend of the spine at the waist, in radians, on top of
   * `lean` — positive turns the chest, shoulders and head further toward +X,
   * like `lean`. The hips and the boxers keep `lean` alone, so the jacket and
   * the boxers meet at an angle and the body line curves through the waist
   * instead of running hip to crown as one straight plank, which is how a
   * body lying on the floor reads when it has no curve. Absent is straight.
   */
  spineBend?: number;
  /**
   * A glow gathered in one open palm, 0 to 1 strong: the Protective Shell
   * cast, which is centred on that hand. Painted over the finished figure,
   * outline and all, because light spills past the silhouette. A hand posed
   * `'grip'` is holding something and shows none. Absent is no glow.
   */
  palmGlow?: PalmGlow;
  /**
   * Pelvic drop, in tile units: how much lower the left hip joint sits than the
   * right, split evenly between them. Positive drops the left and lifts the
   * right. A walker's pelvis sags on the side of the leg in the air; absent is
   * level.
   */
  pelvisDrop?: number;
  /**
   * Whether the choreography has this foot bearing weight on the floor. Set by
   * every locomotion row, because only the choreography knows it: head-on a
   * planted foot slides up or down the cell with the sprite's travel, so its
   * height on screen cannot tell standing from stepping. Absent leaves it to
   * the sole landmarks.
   */
  leftFootPlanted?: boolean;
  rightFootPlanted?: boolean;
  /**
   * Secondary motion: how far a loose part hangs off where the body would
   * carry it rigidly, in tile units in figure space (+X toward the way a
   * profile faces, so −X is behind him in profile and toward his left
   * head-on; +Y down the screen). Each is the displacement of the part's free
   * edge — the jacket's hem, a boxer leg's cuff, the tips of the hair — from
   * its rest position on the posed body; the attached edge (waist, waistband,
   * scalp) does not move. Absent means the part rides rigidly.
   *
   * The choreography computes these from a damped spring driven by the row's
   * own phase (`springLag` in `human/gaitShared.ts`), so they are
   * deterministic per frame and hold no history.
   */
  jacketHemLag?: Pt;
  leftBoxerFlutter?: Pt;
  rightBoxerFlutter?: Pt;
  hairTuftLag?: Pt;
  /**
   * The canon gear he is wearing on this frame, named by his own left and
   * right; see `CarlGear` in `gear.ts`. Absent is the trollskin shirt alone.
   */
  gear?: CarlGear;
}

/** Which hand holds a {@link CarlPose.palmGlow}, and how strongly it shines. */
export interface PalmGlow {
  readonly hand: 'left' | 'right';
  readonly strength: number;
}

/**
 * The shape a hand is painted in.
 *
 * - `'relaxed'`: curls from an open hand to a fist by the pose's `leftFist` /
 *   `rightFist` amount, thumb along the palm and then across the fingers. Every
 *   walk, idle and punch uses it.
 * - `'open'`: fingers straight and together, thumb spread — a shove, a catch, a
 *   palm raised to stop someone.
 * - `'grip'`: fingers wrapped round a haft with the thumb locked over them, for
 *   anything he holds (hammer, dynamite, a bottle). `handGrip` in `limbs.ts`
 *   says where the haft runs through the fist; the prop is painted before the
 *   arm so the fist closes over it.
 */
export type HandShape = 'relaxed' | 'open' | 'grip';

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

/** An upper arm lying in the picture plane, drawn at its whole length. */
export const FULL_UPPER_ARM = 1;

/**
 * Poses one of his arms by its joint angles, its upper arm drawn `upperScale`
 * of its length. The two are set together so an arm never keeps the upper-arm
 * length of whatever posed it before.
 */
export function setArmAngles(
  pose: CarlPose,
  side: BodySide,
  angles: ArmAngles,
  upperScale = FULL_UPPER_ARM,
): void {
  if (side === 'left') {
    pose.leftArmAngles = angles;
    pose.leftUpperArmScale = upperScale;
  } else {
    pose.rightArmAngles = angles;
    pose.rightUpperArmScale = upperScale;
  }
}

/**
 * A relaxed arm reaches nearly its full length, and it does so from the
 * shoulder *joint* — measuring the drop from the shoulder line instead leaves
 * the IK 0.05 of slack, which it spends folding the elbow out sideways.
 */
const RESTING_HAND_DROP = SHOULDER_JOINT_DROP + ARM_LENGTH * 0.99;
/** Matches the idle's hang (`HAND_HANG_SPREAD`), so no pose starts with the arms elsewhere. */
const RESTING_HAND_SPREAD = 0.31;
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

// ── Handedness ───────────────────────────────────────────────────────────────

/** One of his two sides, by his own left and right. */
export type BodySide = 'left' | 'right';

/** The other side. */
function oppositeSide(side: BodySide): BodySide {
  return side === 'left' ? 'right' : 'left';
}

/**
 * Which of a drawn pose's sided fields carry his own `side` in `view`: the
 * same side, except in a mirrored view, where his right is drawn from the
 * pose's left fields.
 */
export function drawnSide(side: BodySide, view: ViewSpec): BodySide {
  return view.mirrored ? oppositeSide(side) : side;
}

function mirroredPt(point: Pt): Pt {
  return pt(-point.x, point.y);
}

function mirroredOptionalPt(point: Pt | undefined): Pt | undefined {
  return point === undefined ? undefined : mirroredPt(point);
}

function mirroredAngles(angles: ArmAngles | null): ArmAngles | null {
  return angles === null ? null : { ...angles, upper: -angles.upper, fore: -angles.fore };
}

function mirroredProp(prop: HeldProp): HeldProp {
  return {
    ...prop,
    hand: oppositeSide(prop.hand),
    // A grip's haft runs a quarter turn clockwise of the wrist, which a
    // mirror does not flip, so the mirrored haft lies end for end: the prop
    // turns a half turn on top of the reflected angle to keep its business
    // end where it was.
    angle: Math.PI - (prop.angle ?? 0),
    tether: mirroredOptionalPt(prop.tether),
  };
}

/**
 * Keyed through `Required` rather than with a `-?` modifier, which would make
 * every optional field mandatory to list just the same but stop the compiler
 * reading one entry back by a generic key.
 */
type PoseMirror = { readonly [K in keyof Required<CarlPose>]: (pose: CarlPose) => CarlPose[K] };

/**
 * How each field of a pose reads reflected left for right about his
 * centreline. Every field of `CarlPose` has to be listed, so a sided field
 * added to the rig is a compile error here rather than a head-on picture that
 * quietly keeps it on the wrong side.
 *
 * Knee breaks and elbow flare are signed relative to his centreline, not to
 * the screen, so they swap sides without changing sign; everything measured
 * along X negates.
 */
const POSE_MIRROR: PoseMirror = {
  bob: (pose) => pose.bob,
  sway: (pose) => -pose.sway,
  lean: (pose) => -pose.lean,
  crouch: (pose) => pose.crouch,
  twist: (pose) => -pose.twist,
  headTurn: (pose) => -pose.headTurn,
  headTilt: (pose) => -pose.headTilt,
  brow: (pose) => pose.brow,
  mouth: (pose) => pose.mouth,
  blink: (pose) => pose.blink,
  leftHand: (pose) => mirroredPt(pose.rightHand),
  rightHand: (pose) => mirroredPt(pose.leftHand),
  leftFoot: (pose) => mirroredPt(pose.rightFoot),
  rightFoot: (pose) => mirroredPt(pose.leftFoot),
  leftFist: (pose) => pose.rightFist,
  rightFist: (pose) => pose.leftFist,
  leftHandShape: (pose) => pose.rightHandShape,
  rightHandShape: (pose) => pose.leftHandShape,
  heldProps: (pose) => pose.heldProps?.map(mirroredProp),
  leftFootPitch: (pose) => pose.rightFootPitch,
  rightFootPitch: (pose) => pose.leftFootPitch,
  leftKneeBreak: (pose) => pose.rightKneeBreak,
  rightKneeBreak: (pose) => pose.leftKneeBreak,
  leftForeshorten: (pose) => pose.rightForeshorten,
  rightForeshorten: (pose) => pose.leftForeshorten,
  leftLegNearness: (pose) => pose.rightLegNearness,
  rightLegNearness: (pose) => pose.leftLegNearness,
  leftFootScale: (pose) => pose.rightFootScale,
  rightFootScale: (pose) => pose.leftFootScale,
  leftFootPoint: (pose) => pose.rightFootPoint,
  rightFootPoint: (pose) => pose.leftFootPoint,
  jacketFlare: (pose) => pose.jacketFlare,
  hairFlow: (pose) => -pose.hairFlow,
  elbowFlare: (pose) => pose.elbowFlare,
  leftArmAngles: (pose) => mirroredAngles(pose.rightArmAngles),
  rightArmAngles: (pose) => mirroredAngles(pose.leftArmAngles),
  leftArmBehind: (pose) => pose.rightArmBehind,
  rightArmBehind: (pose) => pose.leftArmBehind,
  gazeUp: (pose) => pose.gazeUp,
  chinLift: (pose) => pose.chinLift,
  mouthWidth: (pose) => pose.mouthWidth,
  leftFootDepth: (pose) => pose.rightFootDepth,
  rightFootDepth: (pose) => pose.leftFootDepth,
  leftHandDepth: (pose) => pose.rightHandDepth,
  rightHandDepth: (pose) => pose.leftHandDepth,
  leftUpperArmScale: (pose) => pose.rightUpperArmScale,
  rightUpperArmScale: (pose) => pose.leftUpperArmScale,
  torsoPitch: (pose) => pose.torsoPitch,
  chestRise: (pose) => pose.chestRise,
  spineBend: (pose) => (pose.spineBend === undefined ? undefined : -pose.spineBend),
  palmGlow: (pose) =>
    pose.palmGlow === undefined
      ? undefined
      : { ...pose.palmGlow, hand: oppositeSide(pose.palmGlow.hand) },
  pelvisDrop: (pose) => (pose.pelvisDrop === undefined ? undefined : -pose.pelvisDrop),
  leftFootPlanted: (pose) => pose.rightFootPlanted,
  rightFootPlanted: (pose) => pose.leftFootPlanted,
  jacketHemLag: (pose) => mirroredOptionalPt(pose.jacketHemLag),
  leftBoxerFlutter: (pose) => mirroredOptionalPt(pose.rightBoxerFlutter),
  rightBoxerFlutter: (pose) => mirroredOptionalPt(pose.leftBoxerFlutter),
  hairTuftLag: (pose) => mirroredOptionalPt(pose.hairTuftLag),
  gear: (pose) => pose.gear,
};

function isPoseField(key: string): key is keyof CarlPose {
  return key in POSE_MIRROR;
}

const POSE_FIELDS = Object.keys(POSE_MIRROR).filter(isPoseField);

function assignMirrored<K extends keyof CarlPose>(
  target: Pick<CarlPose, K>,
  source: CarlPose,
  field: K,
): void {
  const value = POSE_MIRROR[field](source);
  // An optional field absent on both sides stays absent rather than becoming a
  // key that holds undefined, which a later spread over defaults would copy.
  if (value === undefined && !(field in target)) return;
  target[field] = value;
}

/** A pose reflected left for right about his centreline, every sided field swapped. */
function mirrorPose(pose: CarlPose): CarlPose {
  const mirrored: CarlPose = { ...pose };
  for (const field of POSE_FIELDS) assignMirrored(mirrored, pose, field);
  return mirrored;
}

/**
 * The pose as `view` paints and solves it: the authored pose, reflected for
 * a mirrored view. Everything that reads the drawn picture — the painter, the
 * joint probe, a gate measuring ink — goes through this; choreography that
 * places one limb relative to another stays in the authored pose.
 */
export function poseAsDrawn(pose: CarlPose, view: ViewSpec): CarlPose {
  return view.mirrored ? mirrorPose(pose) : pose;
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export interface BoneChain {
  root: Pt;
  joint: Pt;
  end: Pt;
  /**
   * How far from the root the limb was asked to reach, before the solver
   * clamped it into what the two segments can span. For a limb posed by joint
   * angles it is simply the root→end distance.
   */
  readonly demand: number;
  /** True when the target lay outside the limb's reach and the solver clamped it. */
  readonly clamped: boolean;
  /**
   * The limb's end in the ground frame, for a head-on leg solved against
   * depth; absent for every limb solved in the picture plane.
   */
  readonly groundEnd?: GroundPoint;
  /** The limb's joint in the ground frame, alongside {@link groundEnd}. */
  readonly groundJoint?: GroundPoint;
}

/**
 * A point in front of or behind a head-on figure: sideways across the screen,
 * height above the floor, and depth ahead of the hip along the way he faces,
 * all in tile units.
 */
export interface GroundPoint {
  readonly x: number;
  readonly height: number;
  readonly depth: number;
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
  return { root, joint, end, demand: raw, clamped: dist !== raw };
}

/**
 * The furthest a leg's IK will reach from hip to ankle. A planted foot asked to
 * sit further out than this is where the solver clamps, locking the leg straight
 * with its foot short of the floor.
 */
export const LEG_MAX_REACH = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

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

export interface Skeleton {
  hip: Pt;
  waist: Pt;
  shoulderCentre: Pt;
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
export const CROUCH_DROP = 0.3;

/** Facing +X, a knee that bends toward +X is bending forward. */
const PROFILE_KNEE_FORWARD = -1;
/** A twisted torso narrows on the trailing side and widens on the leading one. */
const TWIST_WIDTH_GAIN = 0.16;
const TWIST_SHOULDER_SHIFT = 0.06;

/** A turned head slides its face this share of the head's half-width across the front view. */
const HEAD_TURN_SLIDE = 0.5;

/**
 * How much of its length the spine shows on screen: all of it edge-on, where
 * a bend is `lean`, and the cosine of the pitch head-on, where the chest
 * bending toward or away from the camera only foreshortens.
 */
function spineForeshortening(pose: CarlPose, view: ViewSpec): number {
  if (view.profile) return 1;
  return Math.cos(pose.torsoPitch ?? 0);
}

/** Offset from the hip to a point `height` up the leaning spine. */
function spinePoint(hip: Pt, height: number, lean: number): Pt {
  const rotated = rotate({ x: 0, y: -height }, lean);
  return offset(hip, rotated.x, rotated.y);
}

export function buildSkeleton(pose: CarlPose, view: ViewSpec): Skeleton {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);
  const spineShare = spineForeshortening(pose, view);
  const waistHeight = Math.abs(WAIST_Y - HIP_Y);
  const ribHeight = Math.abs(SHOULDER_Y - HIP_Y) - waistHeight;
  const rise = pose.chestRise ?? 0;
  // The rise grows from nothing at the waist to its full height at the
  // shoulders: the belly does not lift, the rib cage does.
  const riseAt = (height: number): number => rise * clamp01((height - waistHeight) / ribHeight);
  const bend = view.profile ? (pose.spineBend ?? 0) : 0;
  const waist = spinePoint(hip, waistHeight * spineShare, pose.lean);
  // Above the waist the spine turns by the bend, pivoting at the waist.
  const upSpine = (height: number): Pt =>
    height <= waistHeight
      ? spinePoint(hip, height * spineShare, pose.lean)
      : spinePoint(waist, (height - waistHeight + riseAt(height)) * spineShare, pose.lean + bend);

  const shoulderCentre = upSpine(Math.abs(SHOULDER_Y - HIP_Y));
  const headCentre = offset(
    upSpine(Math.abs(HEAD_CENTRE_Y - HIP_Y)),
    pose.headTurn * HEAD_RX * view.lateral * HEAD_TURN_SLIDE,
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
  const halfDrop = (pose.pelvisDrop ?? 0) / 2;
  const leftRoot = offset(hip, -hipHalf, halfDrop);
  const rightRoot = offset(hip, hipHalf, -halfDrop);
  const ahead = aheadScreenSign(view);

  return {
    hip,
    waist,
    shoulderCentre,
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
    leftLeg:
      pose.leftFootDepth === undefined || ahead === 0
        ? foreshortenLeg(
            solveTwoBone(
              leftRoot,
              headOnPointed(ankleFor(pose.leftFoot, pose.leftFootPitch), pose.leftFootPoint, view),
              THIGH_LENGTH,
              SHIN_LENGTH,
              view.profile ? PROFILE_KNEE_FORWARD * pose.leftKneeBreak : pose.leftKneeBreak,
            ),
            pose.leftForeshorten,
          )
        : solveHeadOnLeg(leftRoot, pose.leftFoot, pose.leftFootDepth, ahead),
    rightLeg:
      pose.rightFootDepth === undefined || ahead === 0
        ? foreshortenLeg(
            solveTwoBone(
              rightRoot,
              headOnPointed(
                ankleFor(pose.rightFoot, pose.rightFootPitch),
                pose.rightFootPoint,
                view,
              ),
              THIGH_LENGTH,
              SHIN_LENGTH,
              view.profile ? PROFILE_KNEE_FORWARD * pose.rightKneeBreak : -pose.rightKneeBreak,
            ),
            pose.rightForeshorten,
          )
        : solveHeadOnLeg(rightRoot, pose.rightFoot, pose.rightFootDepth, ahead),
    // A positive elbowFlare bows both elbows outward, away from the ribs, which
    // is why the two arms take opposite bend signs.
    //
    // Edge-on, as with the knees, that rule would hinge one arm backward: both
    // elbows flex the same way, and the flare has no side to bow them to. A
    // near arm bent backward throws its elbow up over the shoulder and lays the
    // arm across the face, which leaves only the hair and reads as the back of
    // his head.
    leftArm:
      pose.leftArmAngles === null
        ? solveTwoBone(
            leftShoulder,
            pose.leftHand,
            UPPER_ARM_LENGTH * (pose.leftUpperArmScale ?? FULL_UPPER_ARM),
            FOREARM_LENGTH,
            view.profile ? PROFILE_ELBOW_FLEX : elbowBend(pose.elbowFlare),
          )
        : armFromAngles(leftShoulder, pose.leftArmAngles, pose.leftUpperArmScale),
    rightArm:
      pose.rightArmAngles === null
        ? solveTwoBone(
            rightShoulder,
            pose.rightHand,
            UPPER_ARM_LENGTH * (pose.rightUpperArmScale ?? FULL_UPPER_ARM),
            FOREARM_LENGTH,
            view.profile ? PROFILE_ELBOW_FLEX : -elbowBend(pose.elbowFlare),
          )
        : armFromAngles(rightShoulder, pose.rightArmAngles, pose.rightUpperArmScale),
  };
}

/** Forward kinematics for an arm: shoulder angle, then elbow angle. */
function armFromAngles(shoulder: Pt, angles: ArmAngles, upperScale = FULL_UPPER_ARM): BoneChain {
  const upper = rotate({ x: 0, y: UPPER_ARM_LENGTH * upperScale }, -angles.upper);
  const joint = offset(shoulder, upper.x, upper.y);
  const fore = rotate({ x: 0, y: FOREARM_LENGTH * angles.foreScale }, -angles.fore);
  const end = offset(joint, fore.x, fore.y);
  const demand = Math.hypot(end.x - shoulder.x, end.y - shoulder.y);
  return { root: shoulder, joint, end, demand, clamped: false };
}

/** The solver's bend sign that flexes an arm forward in a profile drawn facing +X. */
const PROFILE_ELBOW_FLEX = 1;

function elbowBend(flare: number): number {
  return flare < 0 ? -1 : 1;
}

/** An ankle lifted by a head-on foot's point, so its toes stay where they were. */
function headOnPointed(ankle: Pt, point: number | undefined, view: ViewSpec): Pt {
  if (view.profile || point === undefined) return ankle;
  return offset(ankle, 0, -pointedAnkleRise(point));
}

/** The ankle for a foot planted at `target`: up the leg by the foot's height. */
function ankleFor(target: Pt, pitch: number): Pt {
  const lifted = rotate({ x: 0, y: ANKLE_Y }, -pitch);
  return offset(target, lifted.x, lifted.y);
}

// ── Head-on depth ────────────────────────────────────────────────────────────

/**
 * Which way ground ahead of him runs on the screen: +1 down it in the front
 * view, where he faces the camera; −1 up it from behind; 0 in profile, where
 * ahead is +X and not a screen height at all.
 */
export function aheadScreenSign(view: ViewSpec): number {
  if (view.profile) return 0;
  return view.showsBack ? -1 : 1;
}

/**
 * The share of the floor's depth a head-on view draws as screen height.
 *
 * The game's floor is seen from straight above, so a tile ahead of him is a
 * whole tile further down (or up) the screen, while the figure stands upright
 * as if seen from level. Drawn at the floor's own scale, a planted foot slides
 * down the screen at the sprite's full rate while his hips ride along with the
 * sprite, and the leg between them stretches through the stance to half again
 * its standing length — the leg is being drawn in two projections at once.
 * Games with this camera draw the upright figure's feet on a floor
 * foreshortened to the figure's own view instead: the foot slides a small
 * share of the ground covered, the hips carry the rest with the sprite, and a
 * leg keeps its length.
 *
 * The share is the largest that keeps a planted leg within a tenth of the
 * length it would have with no depth drawn at all: the run's stance reaches
 * furthest, about 0.6 of a standing leg ahead of or behind the hip, which
 * puts a ceiling of 1/6 on the share. 0.15 sits a bit under that ceiling —
 * the planted-leg stretch this share actually produces measures 0.595 of it,
 * so 0.15 stretches the leg by 8.9%, inside the 10% band the leg-length gate
 * checks.
 */
export const HEAD_ON_FLOOR_FORESHORTENING = 0.15;
/**
 * Up to this height the floor's depth shows in full: a flat foot's ankle sits
 * below it, so the whole of a planted foot slides with the ground.
 */
const DEPTH_SHOWN_FULLY_BELOW = 0.12;
/** From hip height up, depth does not show at all: the body stands upright. */
const DEPTH_HIDDEN_ABOVE = Math.abs(HIP_Y);

/**
 * The share of a point's depth that shows as screen height, by its height off
 * the floor.
 *
 * A foot on the floor has to obey the floor, or it skates; a knee at hip
 * height has to obey the upright figure, or a knee driven at the camera draws
 * exactly where a hanging one does and the leg reads as straight. So the
 * share runs from the floor's ({@link HEAD_ON_FLOOR_FORESHORTENING}) to the
 * figure's (none) through the height of the leg.
 */
function depthShareAt(height: number): number {
  const span = DEPTH_HIDDEN_ABOVE - DEPTH_SHOWN_FULLY_BELOW;
  const upright = easeInOut(clamp01((height - DEPTH_SHOWN_FULLY_BELOW) / span));
  return HEAD_ON_FLOOR_FORESHORTENING * (1 - upright);
}

/** Where a ground-frame point draws, in figure space, for a head-on view. */
export function projectGroundPoint(p: GroundPoint, ahead: number): Pt {
  return pt(p.x, -p.height + ahead * depthShareAt(p.height) * p.depth);
}

/** Below this a vector is treated as having no length at all. */
const DEGENERATE_LENGTH = 1e-9;

/**
 * A head-on leg reaching for an ankle `depth` ahead of the hip, solved in three
 * dimensions and then drawn through {@link projectGroundPoint}.
 *
 * The knee always breaks forward, along the way he faces: in the plane the
 * hip, the ankle and "ahead" span, perpendicular to the hip→ankle line. A leg
 * that reaches straight ahead has no such plane, and the knee then rises
 * instead.
 */
function solveHeadOnLeg(root: Pt, foot: Pt, depth: number, ahead: number): BoneChain {
  const hip: GroundPoint = { x: root.x, height: -root.y, depth: 0 };
  const target: GroundPoint = { x: foot.x, height: -foot.y - ANKLE_Y, depth };
  const dx = target.x - hip.x;
  const dh = target.height - hip.height;
  const dz = target.depth - hip.depth;
  const raw = Math.hypot(dx, dh, dz);
  const length = Math.max(raw, DEGENERATE_LENGTH);
  const dir = { x: dx / length, h: dh / length, z: dz / length };

  const minReach = Math.abs(THIGH_LENGTH - SHIN_LENGTH) + JOINT_SLACK;
  const dist = Math.min(Math.max(raw, minReach), LEG_MAX_REACH);
  const along =
    (dist * dist + THIGH_LENGTH * THIGH_LENGTH - SHIN_LENGTH * SHIN_LENGTH) / (2 * dist);
  const out = Math.sqrt(Math.max(0, THIGH_LENGTH * THIGH_LENGTH - along * along));

  // "Ahead" with its component along the leg removed; straight up if nothing is left.
  let bend = { x: -dir.x * dir.z, h: -dir.h * dir.z, z: 1 - dir.z * dir.z };
  let bendLength = Math.hypot(bend.x, bend.h, bend.z);
  if (bendLength < DEGENERATE_LENGTH) {
    bend = { x: -dir.x * dir.h, h: 1 - dir.h * dir.h, z: -dir.z * dir.h };
    bendLength = Math.max(Math.hypot(bend.x, bend.h, bend.z), DEGENERATE_LENGTH);
  }
  const knee: GroundPoint = {
    x: hip.x + dir.x * along + (bend.x / bendLength) * out,
    height: hip.height + dir.h * along + (bend.h / bendLength) * out,
    depth: hip.depth + dir.z * along + (bend.z / bendLength) * out,
  };
  const end: GroundPoint = {
    x: hip.x + dir.x * dist,
    height: hip.height + dir.h * dist,
    depth: hip.depth + dir.z * dist,
  };
  return {
    root,
    joint: projectGroundPoint(knee, ahead),
    end: projectGroundPoint(end, ahead),
    demand: raw,
    clamped: dist !== raw,
    groundEnd: end,
    groundJoint: knee,
  };
}
