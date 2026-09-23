/**
 * Carl lighting a stick of goblin dynamite with his Zippo and lobbing it
 * overhand, in three row families per view:
 *
 * - **light** — the Zippo comes up in the left fist beside the stick in the
 *   right, the lid flips, it catches, the fuse is touched to the flame and
 *   spits, and he draws the stick back into the throwing stance.
 * - **hold** — the cocked stance held while the charge builds: a slow bounce
 *   on the back leg and the fuse spitting in the raised fist.
 * - **throw** — the overhand lob: the left foot strides at the target, the
 *   hips go, then the shoulders, then the arm comes over the top and lets go,
 *   and follows through across his body; the back foot comes through and the
 *   front one steps back to where he stood.
 *
 * The throw is the kinetic chain an overhand thrower shows frame by frame —
 * the stride foot lands, the hips turn a frame later, the shoulders a frame
 * after that, the hand last — and the arm arcs over the top of the head, which
 * is what separates a lob from a push at this size.
 *
 * Every row is keyed pose by pose: a key per frame, because what a reader of
 * the picture judges is exactly those frames. The light row leaves the idle's
 * first frame and ends on the cocked stance; the hold loops on the cocked
 * stance; the throw leaves it and ends back on the idle's first frame, so the
 * hand-offs at either end are to rows the animator already draws.
 *
 * Profile rows face +X with the left side away from the camera: the left
 * (Zippo) hand and the stride foot are the far limbs, the right (throwing)
 * arm the near one.
 */

import { offset, pt } from '../carl/geometry';
import { type HeldProp } from '../carl/props';
import { burningDynamite, type DynamiteVariant } from '../carl/props/dynamite';
import { type ZippoVariant } from '../carl/props/zippo';
import {
  type ArmAngles,
  buildSkeleton,
  type CarlPose,
  type CarlView,
  FULL_UPPER_ARM,
  type HandShape,
  setArmAngles,
  VIEWS,
} from '../carl/rig';
import { deg, type Pt } from '../carlArt';
import {
  anglesThrough,
  ankleOverPivot,
  armReaching,
  IDLE_FOOT_SPREAD,
  profileFootTarget,
  TOE_AHEAD_OF_ANKLE,
  upperArmShareThrough,
} from './gaitShared';
import { IDLE_SIDE_FOOT_LEAD, idleBack, idleFront, idleSide } from './idles';

// ── Row lengths and timing ───────────────────────────────────────────────────

export const DYNAMITE_LIGHT_FRAMES = 10;
export const DYNAMITE_HOLD_FRAMES = 8;
export const DYNAMITE_THROW_FRAMES = 10;
/**
 * The light is a deliberate little ritual — flick, catch, touch the fuse, draw
 * back — two thirds of a second.
 */
export const DYNAMITE_LIGHT_TICKS_PER_FRAME = 4;
/**
 * One bounce of the hold every 40 ticks: slow enough to read as a man
 * weighing a throw rather than jogging on the spot.
 */
export const DYNAMITE_HOLD_TICKS_PER_FRAME = 5;
/**
 * The throw is fast: the stick leaves the hand nine ticks after the release
 * key, which is as long as the stride and the hip turn can be shown in and
 * still feel like the stick went when he let go.
 */
export const DYNAMITE_THROW_TICKS_PER_FRAME = 3;
/** The light-row frame the fuse catches on. */
export const DYNAMITE_FUSE_CATCH_FRAME = 4;
/** The throw-row frame the stick leaves the right hand on. */
export const DYNAMITE_RELEASE_FRAME = 3;

// ── Keys ─────────────────────────────────────────────────────────────────────

/**
 * An arm's key:
 * - `angles` — posed by its joints (degrees from hanging, positive toward +X),
 *   the only way to hold an elbow above its fist or swing the arm over the top.
 * - `reach` — its wrist at an offset from its own shoulder, the elbow hanging
 *   below the line to it.
 * - `target` — its hand at an offset from its own shoulder, solved by the
 *   rig's own reach: head-on that tucks the elbow in front of the ribs, where
 *   a hand held up at the chest keeps it, instead of flaring it out sideways.
 * - `place` — its elbow and wrist at offsets from its own shoulder, each
 *   segment drawn at the length that joins them: an elbow pointed at or away
 *   from the camera sits closer to its shoulder on screen than the bone is
 *   long, which is how a head-on arm cocked back behind the head shows.
 * - `idle` — where the idle of the view puts it.
 */
type ArmKey =
  | {
      readonly kind: 'angles';
      readonly upper: number;
      readonly fore: number;
      readonly foreScale?: number;
      readonly behind?: boolean;
    }
  | { readonly kind: 'reach'; readonly to: Pt; readonly behind?: boolean }
  | { readonly kind: 'target'; readonly to: Pt; readonly behind?: boolean }
  | {
      readonly kind: 'place';
      readonly elbow: Pt;
      readonly wrist: Pt;
      readonly behind?: boolean;
    }
  | { readonly kind: 'idle' };

/**
 * A foot's key: `x` is where it stands across the screen (along the ground
 * in profile), `lift` how far it is off the floor, `pitch` its toes-down angle
 * in degrees — on a grounded foot that is a heel peeled up about the ball,
 * which stays put — and `depth` (head-on only) how far ahead of his hip it
 * stands along the way he faces.
 */
interface FootKey {
  readonly x: number;
  readonly lift?: number;
  readonly pitch?: number;
  readonly depth?: number;
}

/** Everything that moves in one frame of a dynamite row. */
interface ThrowKey {
  readonly crouch: number;
  readonly sway: number;
  readonly lean: number;
  /** Head-on, degrees the chest bends over the hips toward the target; negative leans back. */
  readonly torsoPitch?: number;
  readonly twist: number;
  readonly headTilt: number;
  readonly headTurn?: number;
  readonly chinLift?: number;
  readonly brow: number;
  readonly mouth: number;
  readonly right: ArmKey;
  readonly left: ArmKey;
  readonly rightFoot: FootKey | 'idle';
  readonly leftFoot: FootKey | 'idle';
  /** The stick's look; null once it has left the hand. */
  readonly stick: DynamiteVariant | null;
  /** Turns the stick in the fist, degrees, so the fuse end points where the pose wants it. */
  readonly stickAngle?: number;
  readonly zippo: ZippoVariant;
  /** Turns the lighter in the fist, degrees. */
  readonly zippoAngle?: number;
  readonly jacketFlare?: number;
}

// ── Shared pose building ─────────────────────────────────────────────────────

const IDLE_OF: Record<CarlView, () => CarlPose> = {
  front: () => idleFront(0),
  side: () => idleSide(0),
  back: () => idleBack(0),
};

/** The shoulder, as the origin the `place` keys' elbow and wrist offsets are measured from. */
const SHOULDER_ORIGIN = pt(0, 0);

function keyedAngles(key: Exclude<ArmKey, { kind: 'idle' }>, shoulder: Pt): ArmAngles {
  switch (key.kind) {
    case 'angles':
      return { upper: deg(key.upper), fore: deg(key.fore), foreScale: key.foreScale ?? 1 };
    case 'place':
      return anglesThrough(SHOULDER_ORIGIN, key.elbow, key.wrist);
    case 'reach':
    case 'target':
      return armReaching(shoulder, offset(shoulder, key.to.x, key.to.y));
  }
}

function placeArm(pose: CarlPose, view: CarlView, side: 'left' | 'right', key: ArmKey): void {
  if (key.kind === 'idle') return;
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const shoulder = side === 'left' ? skeleton.leftArm.root : skeleton.rightArm.root;
  const angles = keyedAngles(key, shoulder);
  const behind = key.behind ?? false;
  if (key.kind === 'target') {
    const hand = offset(shoulder, key.to.x, key.to.y);
    if (side === 'left') {
      pose.leftArmAngles = null;
      pose.leftHand = hand;
      pose.leftArmBehind = behind;
    } else {
      pose.rightArmAngles = null;
      pose.rightHand = hand;
      pose.rightArmBehind = behind;
    }
    return;
  }
  const upperScale =
    key.kind === 'place' ? upperArmShareThrough(SHOULDER_ORIGIN, key.elbow) : FULL_UPPER_ARM;
  setArmAngles(pose, side, angles, upperScale);
  if (side === 'left') pose.leftArmBehind = behind;
  else pose.rightArmBehind = behind;
}

/** Under this lift a foot counts as on the floor. */
const GROUNDED_LIFT = 1e-3;

function placeFoot(pose: CarlPose, view: CarlView, side: 'left' | 'right', key: FootKey): void {
  const lift = key.lift ?? 0;
  const pitch = deg(key.pitch ?? 0);
  const grounded = lift < GROUNDED_LIFT;
  if (view === 'side') {
    // A grounded foot with its heel up rolls about the ball, which stays
    // where the flat foot's toe stood.
    const target =
      grounded && pitch !== 0
        ? profileFootTarget(ankleOverPivot(key.x + TOE_AHEAD_OF_ANKLE, 'toe', pitch), pitch)
        : pt(key.x, -lift);
    if (side === 'left') {
      pose.leftFoot = target;
      pose.leftFootPitch = pitch;
      pose.leftFootPlanted = grounded;
    } else {
      pose.rightFoot = target;
      pose.rightFootPitch = pitch;
      pose.rightFootPlanted = grounded;
    }
    return;
  }
  const raise = grounded ? heelRaise(pitch) : { lift: 0, depth: 0 };
  const target = pt(key.x, -(lift + raise.lift));
  const depth = (key.depth ?? 0) + raise.depth;
  if (side === 'left') {
    pose.leftFoot = target;
    pose.leftFootDepth = depth;
    pose.leftFootPitch = pitch;
    pose.leftFootPlanted = grounded;
    pose.leftForeshorten = 1;
  } else {
    pose.rightFoot = target;
    pose.rightFootDepth = depth;
    pose.rightFootPitch = pitch;
    pose.rightFootPlanted = grounded;
    pose.rightForeshorten = 1;
  }
}

/**
 * Head-on, where the ankle sits for a foot `pitch` toes-down with the ball
 * still on the floor: raised, and drawn back toward the heel.
 */
function heelRaise(pitch: number): { lift: number; depth: number } {
  const ankle = ankleOverPivot(TOE_AHEAD_OF_ANKLE, 'toe', pitch);
  const rest = ankleOverPivot(TOE_AHEAD_OF_ANKLE, 'toe', 0);
  return { lift: rest.y - ankle.y, depth: ankle.x - rest.x };
}

/**
 * How far the hair tips and the jacket hem trail a change of the trunk from
 * the frame before: tiles per radian of lean, and per unit of sway.
 */
const HAIR_TRAIL = 0.12;
const HEM_TRAIL = 0.08;

function handShapeHolding(holding: boolean): HandShape {
  return holding ? 'grip' : 'open';
}

/** A hand that has just let go stays open, fingers spread off the release. */
const OPEN_HAND_FIST = 0;

function poseFromKey(view: CarlView, key: ThrowKey, previous: ThrowKey | null): CarlPose {
  const pose = IDLE_OF[view]();
  pose.crouch = key.crouch;
  pose.sway = key.sway;
  pose.lean = deg(key.lean);
  if (key.torsoPitch !== undefined) pose.torsoPitch = deg(key.torsoPitch);
  pose.twist = key.twist;
  pose.headTilt = deg(key.headTilt);
  if (key.headTurn !== undefined) pose.headTurn = key.headTurn;
  if (key.chinLift !== undefined) pose.chinLift = key.chinLift;
  pose.brow = key.brow;
  pose.mouth = key.mouth;
  if (key.jacketFlare !== undefined) pose.jacketFlare = key.jacketFlare;
  if (previous !== null) {
    pose.hairTuftLag = pt(HAIR_TRAIL * deg(previous.lean - key.lean), 0);
    pose.jacketHemLag = pt(HEM_TRAIL * (previous.sway - key.sway), 0);
  }
  if (key.rightFoot !== 'idle') placeFoot(pose, view, 'right', key.rightFoot);
  if (key.leftFoot !== 'idle') placeFoot(pose, view, 'left', key.leftFoot);
  placeArm(pose, view, 'right', key.right);
  placeArm(pose, view, 'left', key.left);
  // Anything that reads a hand target — the reach gate, the hand the runtime
  // throws from — reads where the posed fist is drawn.
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  if (pose.rightArmAngles !== null) pose.rightHand = skeleton.rightArm.end;
  if (pose.leftArmAngles !== null) pose.leftHand = skeleton.leftArm.end;

  const props: HeldProp[] = [
    { kind: 'zippo', hand: 'left', variant: key.zippo, angle: deg(key.zippoAngle ?? 0) },
  ];
  if (key.stick !== null) {
    props.push({
      kind: 'dynamite',
      hand: 'right',
      variant: key.stick,
      angle: deg(key.stickAngle ?? 0),
    });
  }
  pose.heldProps = props;
  pose.leftHandShape = 'grip';
  pose.rightHandShape = handShapeHolding(key.stick !== null);
  if (key.stick === null) pose.rightFist = OPEN_HAND_FIST;
  return pose;
}

function keyAt(keys: readonly ThrowKey[], frame: number): ThrowKey {
  return keys[Math.min(keys.length - 1, Math.max(0, frame))];
}

function poseAt(view: CarlView, keys: readonly ThrowKey[], frame: number): CarlPose {
  const previous = frame > 0 ? keyAt(keys, frame - 1) : null;
  return poseFromKey(view, keyAt(keys, frame), previous);
}

/**
 * The idle's first frame, as a key: where the light leaves from and the throw
 * returns to, holding the stick or the empty hand low.
 */
function idleKey(stick: DynamiteVariant | null): ThrowKey {
  return {
    crouch: 0,
    sway: 0,
    lean: 0,
    twist: 0,
    headTilt: 0,
    brow: 0.55,
    mouth: 0,
    right: { kind: 'idle' },
    left: { kind: 'idle' },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick,
    stickAngle: stick === null ? 0 : IDLE_STICK_TILT_DEGREES,
    zippo: 'closed',
  };
}

/**
 * Carried at his side the stick hangs straight down out of the fist, along
 * the outside of his thigh: held level it lies along the boxers' waistband
 * and reads as a red belt, and tipped in toward his middle it crosses his
 * groin.
 */
const IDLE_STICK_TILT_DEGREES = 80;

// ── Profile ──────────────────────────────────────────────────────────────────

/** Where the profile idle stands its feet, which the light leaves from and the throw returns to. */
const SIDE_IDLE_FOOT = IDLE_SIDE_FOOT_LEAD;
/** The right (throwing-side) foot steps back this far into the throwing stance. */
const SIDE_STANCE_BACK_FOOT = -0.3;
/** The far (left) foot's stride at the target lands here. */
const SIDE_STRIDE_FOOT = 0.3;

const SIDE_COCKED: ThrowKey = {
  crouch: 0.1,
  sway: -0.55,
  lean: -6,
  twist: -0.45,
  headTilt: 0,
  headTurn: 0.25,
  brow: 0.9,
  mouth: 0,
  right: { kind: 'angles', upper: -95, fore: -172 },
  left: { kind: 'angles', upper: 58, fore: 112 },
  rightFoot: { x: SIDE_STANCE_BACK_FOOT },
  leftFoot: { x: -SIDE_IDLE_FOOT },
  stick: burningDynamite(0),
  stickAngle: 0,
  zippo: 'closed',
};

const SIDE_LIGHT: readonly ThrowKey[] = [
  idleKey('unlit'),
  {
    crouch: 0.02,
    sway: 0,
    lean: 3,
    twist: 0.05,
    headTilt: 6,
    brow: 0.6,
    mouth: 0,
    right: { kind: 'reach', to: pt(0.2, 0.2) },
    left: { kind: 'reach', to: pt(0.32, 0.24) },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'unlit',
    stickAngle: -115,
    zippo: 'closed',
  },
  {
    crouch: 0.03,
    sway: 0,
    lean: 5,
    twist: 0.1,
    headTilt: 20,
    brow: 0.65,
    mouth: 0,
    right: { kind: 'reach', to: pt(0.2, 0.1) },
    left: { kind: 'reach', to: pt(0.38, 0.22) },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'unlit',
    stickAngle: -115,
    zippo: 'open',
  },
  {
    crouch: 0.03,
    sway: 0,
    lean: 6,
    twist: 0.1,
    headTilt: 24,
    brow: 0.7,
    mouth: 0,
    right: { kind: 'reach', to: pt(0.2, 0.09) },
    left: { kind: 'reach', to: pt(0.46, 0.14) },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'unlit',
    stickAngle: -115,
    zippo: 'lit',
  },
  {
    crouch: 0.03,
    sway: 0,
    lean: 6,
    twist: 0.1,
    headTilt: 24,
    brow: 0.75,
    mouth: 0,
    right: { kind: 'reach', to: pt(0.2, 0.09) },
    left: { kind: 'reach', to: pt(0.46, 0.11) },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'catching',
    stickAngle: -115,
    zippo: 'lit-tall',
  },
  // The lit stick comes up past the shoulder on its way back.
  {
    crouch: 0.04,
    sway: -0.04,
    lean: 4,
    twist: 0,
    headTilt: 8,
    brow: 0.8,
    mouth: 0,
    right: { kind: 'angles', upper: 15, fore: 150 },
    left: { kind: 'reach', to: pt(0.34, 0.32) },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: burningDynamite(0),
    stickAngle: 180,
    zippo: 'closed',
  },
  {
    crouch: 0.05,
    sway: -0.1,
    lean: 2,
    twist: -0.1,
    headTilt: 6,
    brow: 0.8,
    mouth: 0,
    right: { kind: 'angles', upper: -8, fore: -178 },
    left: { kind: 'angles', upper: 42, fore: 88 },
    rightFoot: { x: -0.19, lift: 0.07, pitch: 20 },
    leftFoot: { x: -SIDE_IDLE_FOOT },
    stick: burningDynamite(1),
    zippo: 'closed',
  },
  {
    crouch: 0.08,
    sway: -0.42,
    lean: -3,
    twist: -0.35,
    headTilt: 2,
    headTurn: 0.25,
    brow: 0.85,
    mouth: 0,
    right: { kind: 'angles', upper: -42, fore: -180 },
    left: { kind: 'angles', upper: 55, fore: 100 },
    rightFoot: { x: SIDE_STANCE_BACK_FOOT },
    leftFoot: { x: -SIDE_IDLE_FOOT },
    stick: burningDynamite(2),
    zippo: 'closed',
  },
  {
    ...SIDE_COCKED,
    crouch: 0.09,
    sway: -0.5,
    lean: -5,
    twist: -0.42,
    right: { kind: 'angles', upper: -72, fore: -178 },
    left: { kind: 'angles', upper: 64, fore: 106 },
    stick: burningDynamite(3),
  },
  SIDE_COCKED,
];

const SIDE_THROW: readonly ThrowKey[] = [
  SIDE_COCKED,
  // The stride: the far foot comes up and reaches for the target while the
  // arm lays back.
  {
    ...SIDE_COCKED,
    crouch: 0.1,
    sway: -0.5,
    lean: -8,
    twist: -0.55,
    right: { kind: 'angles', upper: -130, fore: -150 },
    left: { kind: 'angles', upper: 80, fore: 95 },
    leftFoot: { x: 0.05, lift: 0.07, pitch: -10 },
    stick: burningDynamite(1),
  },
  // Stride foot down, hips driving: the arm comes up over the top, the stick high above his head.
  {
    ...SIDE_COCKED,
    crouch: 0.14,
    sway: 0.3,
    lean: 2,
    twist: -0.2,
    right: { kind: 'angles', upper: 200, fore: 225 },
    left: { kind: 'angles', upper: 50, fore: 60 },
    rightFoot: { x: SIDE_STANCE_BACK_FOOT, pitch: 15 },
    leftFoot: { x: SIDE_STRIDE_FOOT },
    stick: burningDynamite(2),
    mouth: 0.3,
  },
  // Release: shoulders turned through, the fist opening a head-length in front of his brow.
  {
    ...SIDE_COCKED,
    crouch: 0.14,
    sway: 0.75,
    lean: 14,
    twist: 1,
    headTilt: 4,
    brow: 1,
    mouth: 0.5,
    right: { kind: 'angles', upper: 130, fore: 110 },
    left: { kind: 'angles', upper: 20, fore: 0 },
    rightFoot: { x: SIDE_STANCE_BACK_FOOT, pitch: 30 },
    leftFoot: { x: SIDE_STRIDE_FOOT },
    stick: null,
  },
  // Follow-through: the arm carries on down past the target, the trunk folding over the front leg.
  {
    ...SIDE_COCKED,
    crouch: 0.16,
    sway: 0.9,
    lean: 22,
    twist: 1,
    headTilt: 6,
    brow: 1,
    mouth: 0.35,
    right: { kind: 'angles', upper: 80, fore: 40 },
    left: { kind: 'angles', upper: -15, fore: -5 },
    rightFoot: { x: SIDE_STANCE_BACK_FOOT, pitch: 40 },
    leftFoot: { x: SIDE_STRIDE_FOOT },
    stick: null,
  },
  // The hand finishes low across the front thigh.
  {
    ...SIDE_COCKED,
    crouch: 0.15,
    sway: 0.9,
    lean: 24,
    twist: 1,
    headTilt: 4,
    brow: 0.9,
    mouth: 0.1,
    right: { kind: 'angles', upper: 25, fore: -20 },
    left: { kind: 'angles', upper: -20, fore: -10 },
    rightFoot: { x: SIDE_STANCE_BACK_FOOT, pitch: 42 },
    leftFoot: { x: SIDE_STRIDE_FOOT },
    stick: null,
  },
  // The back foot comes through as he straightens.
  {
    ...SIDE_COCKED,
    crouch: 0.1,
    sway: 0.7,
    lean: 12,
    twist: 0.5,
    headTilt: 2,
    brow: 0.8,
    mouth: 0,
    right: { kind: 'angles', upper: 10, fore: -5 },
    left: { kind: 'angles', upper: -10, fore: -5 },
    rightFoot: { x: -0.05, lift: 0.06, pitch: 15 },
    leftFoot: { x: SIDE_STRIDE_FOOT },
    stick: null,
  },
  {
    ...SIDE_COCKED,
    crouch: 0.09,
    sway: 0.5,
    lean: 5,
    twist: 0.2,
    headTilt: 0,
    brow: 0.7,
    mouth: 0,
    right: { kind: 'angles', upper: 5, fore: 2 },
    left: { kind: 'angles', upper: -8, fore: -4 },
    rightFoot: { x: SIDE_IDLE_FOOT },
    leftFoot: { x: SIDE_STRIDE_FOOT },
    stick: null,
  },
  // And the front foot steps back beside it.
  {
    ...SIDE_COCKED,
    crouch: 0.04,
    sway: 0.2,
    lean: 2,
    twist: 0.05,
    headTilt: 0,
    brow: 0.6,
    mouth: 0,
    right: { kind: 'angles', upper: 2, fore: 0 },
    left: { kind: 'angles', upper: -5, fore: -3 },
    rightFoot: { x: SIDE_IDLE_FOOT },
    leftFoot: { x: 0.02, lift: 0.05, pitch: 10 },
    stick: null,
  },
  idleKey(null),
];

// ── Head-on ──────────────────────────────────────────────────────────────────

/** Head-on the feet stand this far either side of his centre, as the idle stands them. */
const FACING_FOOT_X = IDLE_FOOT_SPREAD;
/** The throwing-side foot steps back, away from the target, into the stance. */
const FACING_STANCE_BACK_DEPTH = -0.08;
/** The stride foot lands this far toward the target. */
const FACING_STRIDE_DEPTH = 0.1;
/** The stride lands a touch inboard of the stance: the foot steps at the target, not out wide. */
const FACING_STRIDE_X = -0.1;
/**
 * Through the follow-through the back heel stays peeled up off the ball of the
 * foot, in degrees. Head-on a heel peeled much further than the release's lifts
 * the ankle so far up the screen that, under a trunk bent over the front leg,
 * the back foot reads as kicked up off the floor — a stumble.
 */
const FACING_FOLLOW_HEEL_PEEL = 30;

/**
 * Toward the camera: the stick cocked back behind his right ear, the left arm
 * pointing at the target, his weight on the back foot. The cocked arm is an
 * "L": the elbow out level with the shoulder and drawn back away from the
 * camera, so the upper arm is short on screen, and the forearm standing up
 * beside the head with the fist back by the ear. An upper arm raised full
 * length above the shoulder with the stick on top instead reads as a man
 * holding up a torch.
 */
const FRONT_COCKED_ARM: ArmKey = {
  kind: 'place',
  elbow: pt(0.2, -0.02),
  wrist: pt(0.16, -0.3),
  behind: true,
};

const FRONT_COCKED: ThrowKey = {
  crouch: 0.1,
  sway: 0.02,
  lean: -5,
  torsoPitch: -8,
  twist: -0.4,
  headTilt: 0,
  brow: 0.9,
  mouth: 0,
  right: FRONT_COCKED_ARM,
  left: { kind: 'angles', upper: -40, fore: 150, foreScale: 0.6 },
  rightFoot: { x: FACING_FOOT_X, depth: FACING_STANCE_BACK_DEPTH },
  leftFoot: 'idle',
  stick: burningDynamite(0),
  stickAngle: -160,
  zippo: 'closed',
};

const FRONT_LIGHT: readonly ThrowKey[] = [
  idleKey('unlit'),
  {
    ...FRONT_COCKED,
    crouch: 0.02,
    sway: 0,
    lean: 0,
    twist: 0,
    headTilt: 0,
    chinLift: -0.3,
    brow: 0.6,
    right: { kind: 'target', to: pt(-0.12, 0.28) },
    left: { kind: 'target', to: pt(0.22, 0.3) },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'unlit',
    stickAngle: 18,
    zippo: 'closed',
  },
  {
    ...FRONT_COCKED,
    crouch: 0.03,
    sway: 0,
    lean: 0,
    twist: 0,
    headTilt: 0,
    chinLift: -0.5,
    brow: 0.65,
    right: { kind: 'target', to: pt(-0.24, 0.2) },
    left: { kind: 'target', to: pt(0.3, 0.2) },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'unlit',
    stickAngle: 18,
    zippo: 'open',
  },
  {
    ...FRONT_COCKED,
    crouch: 0.03,
    sway: 0,
    lean: 0,
    twist: 0,
    headTilt: 0,
    chinLift: -0.55,
    brow: 0.7,
    right: { kind: 'target', to: pt(-0.24, 0.2) },
    left: { kind: 'target', to: pt(0.31, 0.16) },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'unlit',
    stickAngle: 18,
    zippo: 'lit',
  },
  {
    ...FRONT_COCKED,
    crouch: 0.03,
    sway: 0,
    lean: 0,
    twist: 0,
    headTilt: 0,
    chinLift: -0.55,
    brow: 0.75,
    right: { kind: 'target', to: pt(-0.24, 0.2) },
    left: { kind: 'target', to: pt(0.31, 0.13) },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'catching',
    stickAngle: 18,
    zippo: 'lit-tall',
  },
  {
    ...FRONT_COCKED,
    crouch: 0.05,
    lean: -2,
    twist: -0.15,
    chinLift: -0.1,
    brow: 0.8,
    right: { kind: 'place', elbow: pt(0.2, 0.27), wrist: pt(0.15, 0.02) },
    left: { kind: 'target', to: pt(0.12, 0.4) },
    rightFoot: { x: FACING_FOOT_X, depth: FACING_STANCE_BACK_DEPTH / 2, lift: 0.05 },
    leftFoot: 'idle',
    stick: burningDynamite(1),
    stickAngle: 70,
  },
  {
    ...FRONT_COCKED,
    crouch: 0.08,
    lean: -4,
    twist: -0.3,
    brow: 0.85,
    right: { kind: 'place', elbow: pt(0.23, 0.18), wrist: pt(0.24, -0.12) },
    left: { kind: 'angles', upper: -30, fore: 140, foreScale: 0.7 },
    stick: burningDynamite(2),
  },
  {
    ...FRONT_COCKED,
    crouch: 0.09,
    lean: -5,
    twist: -0.35,
    brow: 0.85,
    right: { kind: 'place', elbow: pt(0.22, 0.09), wrist: pt(0.21, -0.2) },
    left: { kind: 'angles', upper: -35, fore: 145, foreScale: 0.65 },
    stick: burningDynamite(3),
  },
  {
    ...FRONT_COCKED,
    crouch: 0.1,
    lean: -5,
    twist: -0.38,
    right: { kind: 'place', elbow: pt(0.21, 0.02), wrist: pt(0.18, -0.27), behind: true },
    stick: burningDynamite(0),
  },
  FRONT_COCKED,
];

const FRONT_THROW: readonly ThrowKey[] = [
  FRONT_COCKED,
  // The stride foot comes up toward the target as the arm lays back.
  {
    ...FRONT_COCKED,
    torsoPitch: -11,
    crouch: 0.1,
    lean: -7,
    twist: -0.5,
    right: { kind: 'place', elbow: pt(0.17, -0.03), wrist: pt(0.21, -0.29), behind: true },
    leftFoot: {
      x: (FACING_STRIDE_X - FACING_FOOT_X) / 2,
      depth: FACING_STRIDE_DEPTH / 2,
      lift: 0.07,
    },
    stick: burningDynamite(1),
  },
  // Stride foot down, hips turning: the elbow comes up above his shoulder.
  {
    ...FRONT_COCKED,
    torsoPitch: 3,
    crouch: 0.15,
    lean: -3,
    twist: -0.1,
    mouth: 0.3,
    right: { kind: 'angles', upper: 160, fore: 220, foreScale: 0.7 },
    left: { kind: 'angles', upper: -30, fore: -45, foreScale: 0.8 },
    rightFoot: { x: FACING_FOOT_X, depth: FACING_STANCE_BACK_DEPTH, pitch: 15 },
    leftFoot: { x: FACING_STRIDE_X, depth: FACING_STRIDE_DEPTH },
    stick: burningDynamite(2),
  },
  // Release: the arm over the top and coming at the camera, the fist opening above his brow.
  {
    ...FRONT_COCKED,
    torsoPitch: 20,
    crouch: 0.17,
    lean: -8,
    twist: 0.7,
    chinLift: -0.2,
    brow: 1,
    mouth: 0.5,
    right: { kind: 'target', to: pt(-0.12, -0.02) },
    left: { kind: 'angles', upper: -20, fore: -15 },
    rightFoot: { x: FACING_FOOT_X, depth: FACING_STANCE_BACK_DEPTH, pitch: 30 },
    leftFoot: { x: FACING_STRIDE_X, depth: FACING_STRIDE_DEPTH },
    stick: null,
  },
  // Follow-through: the hand drives down at the camera across his chest.
  {
    ...FRONT_COCKED,
    torsoPitch: 28,
    crouch: 0.19,
    lean: -10,
    twist: 1,
    chinLift: -0.3,
    brow: 1,
    mouth: 0.35,
    right: { kind: 'angles', upper: 30, fore: -95, foreScale: 0.8 },
    left: { kind: 'angles', upper: -18, fore: -8 },
    rightFoot: {
      x: FACING_FOOT_X,
      depth: FACING_STANCE_BACK_DEPTH,
      pitch: FACING_FOLLOW_HEEL_PEEL,
    },
    leftFoot: { x: FACING_STRIDE_X, depth: FACING_STRIDE_DEPTH },
    stick: null,
  },
  // And on down past his left hip.
  {
    ...FRONT_COCKED,
    torsoPitch: 25,
    crouch: 0.17,
    lean: -9,
    twist: 1,
    chinLift: -0.2,
    brow: 0.9,
    mouth: 0.1,
    right: { kind: 'angles', upper: -20, fore: -60 },
    left: { kind: 'angles', upper: -15, fore: -6 },
    rightFoot: {
      x: FACING_FOOT_X,
      depth: FACING_STANCE_BACK_DEPTH,
      pitch: FACING_FOLLOW_HEEL_PEEL,
    },
    leftFoot: { x: FACING_STRIDE_X, depth: FACING_STRIDE_DEPTH },
    stick: null,
  },
  // The back foot comes through as he straightens.
  {
    ...FRONT_COCKED,
    torsoPitch: 14,
    crouch: 0.12,
    lean: -5,
    twist: 0.5,
    chinLift: -0.1,
    brow: 0.8,
    right: { kind: 'angles', upper: -5, fore: -12 },
    left: { kind: 'angles', upper: -10, fore: -5 },
    rightFoot: { x: FACING_FOOT_X, depth: FACING_STRIDE_DEPTH / 2, lift: 0.06 },
    leftFoot: { x: FACING_STRIDE_X, depth: FACING_STRIDE_DEPTH },
    stick: null,
  },
  {
    ...FRONT_COCKED,
    torsoPitch: 6,
    crouch: 0.07,
    lean: -2,
    twist: 0.2,
    brow: 0.7,
    right: { kind: 'angles', upper: 2, fore: -2 },
    left: { kind: 'angles', upper: -6, fore: -3 },
    rightFoot: 'idle',
    leftFoot: { x: FACING_STRIDE_X, depth: FACING_STRIDE_DEPTH },
    stick: null,
  },
  // And the front foot steps back beside it.
  {
    ...FRONT_COCKED,
    torsoPitch: 2,
    crouch: 0.03,
    lean: -1,
    twist: 0.05,
    brow: 0.6,
    right: { kind: 'idle' },
    left: { kind: 'idle' },
    rightFoot: 'idle',
    leftFoot: { x: -FACING_FOOT_X, depth: FACING_STRIDE_DEPTH / 3, lift: 0.05 },
    stick: null,
  },
  idleKey(null),
];

/**
 * Away from the camera the same throw is seen from behind: the stick cocked
 * up by his right ear, then carried over the top and away, and the follow-
 * through dropping down in front of him out of sight. The fuse is lit up by
 * his right shoulder, where the flame shows past the outline of his back.
 */
const BACK_COCKED: ThrowKey = {
  ...FRONT_COCKED,
  right: { ...FRONT_COCKED_ARM, behind: false },
  stickAngle: -150,
  left: { kind: 'angles', upper: -40, fore: 150, foreScale: 0.6, behind: true },
  headTurn: 0,
};

const BACK_LIGHT: readonly ThrowKey[] = [
  idleKey('unlit'),
  {
    ...BACK_COCKED,
    crouch: 0.02,
    lean: 0,
    twist: 0,
    brow: 0.6,
    right: { kind: 'reach', to: pt(0.16, 0.3) },
    left: { kind: 'reach', to: pt(0.3, 0.4), behind: true },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'unlit',
    stickAngle: -90,
    zippo: 'closed',
  },
  {
    ...BACK_COCKED,
    crouch: 0.03,
    lean: -3,
    twist: 0,
    brow: 0.65,
    right: { kind: 'angles', upper: 25, fore: 175 },
    left: { kind: 'target', to: pt(0.5, -0.12), behind: true },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'unlit',
    stickAngle: 163,
    zippo: 'open',
  },
  {
    ...BACK_COCKED,
    crouch: 0.03,
    lean: -4,
    twist: 0,
    brow: 0.7,
    right: { kind: 'angles', upper: 25, fore: 175 },
    left: { kind: 'target', to: pt(0.54, -0.16), behind: true },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'unlit',
    stickAngle: 163,
    zippo: 'lit',
  },
  {
    ...BACK_COCKED,
    crouch: 0.03,
    lean: -4,
    twist: 0,
    brow: 0.75,
    right: { kind: 'angles', upper: 25, fore: 175 },
    left: { kind: 'target', to: pt(0.54, -0.19), behind: true },
    rightFoot: 'idle',
    leftFoot: 'idle',
    stick: 'catching',
    stickAngle: 163,
    zippo: 'lit-tall',
  },
  {
    ...BACK_COCKED,
    crouch: 0.05,
    lean: -3,
    twist: -0.15,
    right: { kind: 'angles', upper: 40, fore: 182 },
    left: { kind: 'reach', to: pt(0.2, 0.4), behind: true },
    rightFoot: { x: FACING_FOOT_X, depth: FACING_STANCE_BACK_DEPTH / 2, lift: 0.05 },
    leftFoot: 'idle',
    stick: burningDynamite(1),
  },
  {
    ...BACK_COCKED,
    crouch: 0.08,
    lean: -4,
    twist: -0.3,
    right: { kind: 'place', elbow: pt(0.23, 0.2), wrist: pt(0.26, -0.1) },
    stick: burningDynamite(2),
  },
  {
    ...BACK_COCKED,
    crouch: 0.09,
    lean: -5,
    twist: -0.35,
    right: { kind: 'place', elbow: pt(0.22, 0.09), wrist: pt(0.21, -0.2) },
    stick: burningDynamite(3),
  },
  {
    ...BACK_COCKED,
    crouch: 0.1,
    lean: -5,
    twist: -0.38,
    right: { kind: 'place', elbow: pt(0.21, 0.02), wrist: pt(0.18, -0.27) },
    stick: burningDynamite(0),
  },
  BACK_COCKED,
];

/**
 * The back-view throw is the front one, with the arm carried away from the
 * camera from the release on. Seen from behind, the release itself is the
 * fist just clearing the top of his head on its way over — the one moment
 * of the throw that shows past his back.
 */
/**
 * From behind, a trunk bent over the front leg pitches away from the camera,
 * and at the front view's full pitch the head sinks behind the top of his back
 * and he reads as headless. Seen from behind the throw keeps this share of it.
 */
const BACK_TORSO_PITCH_SHARE = 0.4;
const BACK_RELEASE_ARM: ArmKey = { kind: 'angles', upper: 150, fore: -60, foreScale: 0.45 };
const BACK_THROW: readonly ThrowKey[] = FRONT_THROW.map((key, frame) => {
  const armGoesAway = frame > DYNAMITE_RELEASE_FRAME;
  const releasing = frame === DYNAMITE_RELEASE_FRAME;
  const right: ArmKey = releasing
    ? BACK_RELEASE_ARM
    : key.right.kind === 'idle'
      ? key.right
      : { ...key.right, behind: armGoesAway };
  const left: ArmKey = key.left.kind === 'idle' ? key.left : { ...key.left, behind: true };
  const stickAngle = key.stick === null ? key.stickAngle : BACK_COCKED.stickAngle;
  const torsoPitch =
    key.torsoPitch === undefined ? undefined : key.torsoPitch * BACK_TORSO_PITCH_SHARE;
  return { ...key, right, left, stickAngle, torsoPitch, headTurn: 0 };
});

// ── The hold loop ────────────────────────────────────────────────────────────

/**
 * The bounce, as extra knee bend at its bottom, and the throwing fist's
 * little pump back with it. One cycle across the whole row: eight frames a
 * cycle is well inside the four-frame floor under which a loop aliases into a
 * strobe.
 */
const HOLD_BOUNCE_CROUCH = 0.04;
const HOLD_PUMP_DEGREES = 10;
/** The pump of an arm placed by its joints: the fist rocks back and out behind the ear. */
const HOLD_PUMP_WRIST: Pt = pt(0.03, 0.02);

function pumped(arm: ArmKey, cycle: number): ArmKey {
  switch (arm.kind) {
    case 'angles':
      return { ...arm, upper: arm.upper - HOLD_PUMP_DEGREES * cycle };
    case 'place':
      return {
        ...arm,
        wrist: offset(arm.wrist, HOLD_PUMP_WRIST.x * cycle, HOLD_PUMP_WRIST.y * cycle),
      };
    case 'reach':
    case 'target':
    case 'idle':
      return arm;
  }
}

/**
 * The spark steps to its next fan every frame: a four-look flicker over four
 * frames, the fewest a cycle can have and still read as motion rather than a
 * strobe, and a change on every step so the loop never holds still at its seam.
 */
function holdKey(cocked: ThrowKey, frame: number): ThrowKey {
  // A triangle rather than a sine: every step of the bounce is the same size,
  // so the wrap back to the top is no smaller a step than any other.
  const phase =
    (((frame % DYNAMITE_HOLD_FRAMES) + DYNAMITE_HOLD_FRAMES) % DYNAMITE_HOLD_FRAMES) /
    DYNAMITE_HOLD_FRAMES;
  const cycle = 1 - Math.abs(1 - 2 * phase);
  const right = pumped(cocked.right, cycle);
  return {
    ...cocked,
    crouch: cocked.crouch + HOLD_BOUNCE_CROUCH * cycle,
    right,
    stick: burningDynamite(frame),
  };
}

/**
 * The hand he throws with, by his own side: the stick is in his right and the
 * Zippo in his left from every view.
 */
export const DYNAMITE_THROWING_HAND = 'right';

// ── Rows ─────────────────────────────────────────────────────────────────────

const LIGHT_KEYS: Record<CarlView, readonly ThrowKey[]> = {
  side: SIDE_LIGHT,
  front: FRONT_LIGHT,
  back: BACK_LIGHT,
};
const THROW_KEYS: Record<CarlView, readonly ThrowKey[]> = {
  side: SIDE_THROW,
  front: FRONT_THROW,
  back: BACK_THROW,
};
const COCKED: Record<CarlView, ThrowKey> = {
  side: SIDE_COCKED,
  front: FRONT_COCKED,
  back: BACK_COCKED,
};

export function dynamiteLight(view: CarlView, frame: number): CarlPose {
  return poseAt(view, LIGHT_KEYS[view], frame);
}

export function dynamiteHold(view: CarlView, frame: number): CarlPose {
  const previous = holdKey(COCKED[view], frame - 1);
  return poseFromKey(view, holdKey(COCKED[view], frame), previous);
}

export function dynamiteThrow(view: CarlView, frame: number): CarlPose {
  return poseAt(view, THROW_KEYS[view], frame);
}
