/**
 * Carl standing: the breathing idle, the combat-ready guard, and the fidgets
 * he breaks the idle with.
 *
 * Every fidget starts and ends exactly on the base idle's first frame, which
 * is the only frame the runtime hands off to or from one — so a fidget can be
 * dropped into the idle at that seam without a pop at either end.
 */

import { HEAD_CENTRE_Y, HEAD_RY, SHOULDER_Y } from '../carl/proportions';
import {
  type ArmAngles,
  type BodySide,
  type BoneChain,
  buildSkeleton,
  type CarlPose,
  FULL_UPPER_ARM,
  restingPose,
  setArmAngles,
  VIEWS,
  type ViewSpec,
} from '../carl/rig';
import { clamp01, deg, easeInOut, hump, lerp, type Pt } from '../carlArt';
import {
  anglesThrough,
  ankleOverPivot,
  facingArmAngles,
  HAND_HANG_DROP,
  IDLE_FOOT_SPREAD,
  LEFT_ARM,
  profileFootTarget,
  RIGHT_ARM,
  TOE_AHEAD_OF_ANKLE,
  upperArmShareThrough,
} from './gaitShared';
import { lerpAngle, mixPt, pt, TWO_PI } from '../carl/geometry';

/** 0 outside `[start, end]`, rising to 1 halfway through it and back to 0. */
function pulse(t: number, start: number, end: number): number {
  if (t <= start || t >= end) return 0;
  return hump((t - start) / (end - start));
}

/**
 * When, through a one-shot, a gesture eases in, holds and eases out again —
 * each a fraction of the row.
 */
interface Beats {
  readonly start: number;
  readonly peakIn: number;
  readonly peakOut: number;
  readonly end: number;
}

/** 0 before the beats start, 1 through their hold, 0 again after they end, eased both ways. */
function plateau(t: number, beats: Beats): number {
  if (t <= beats.start || t >= beats.end) return 0;
  if (t < beats.peakIn) return easeInOut((t - beats.start) / (beats.peakIn - beats.start));
  if (t <= beats.peakOut) return 1;
  return easeInOut((beats.end - t) / (beats.end - beats.peakOut));
}

/** How far through the hold of `beats` a moment is, 0 to 1 — for motion that keeps going while held. */
function throughHold(t: number, beats: Beats): number {
  return clamp01((t - beats.peakIn) / (beats.peakOut - beats.peakIn));
}

// ── Base idle ────────────────────────────────────────────────────────────────

/**
 * Standing is meant to read as *alive*, not as swaying. Every idle term sits
 * near the threshold of visibility at a 32px tile.
 *
 * The breath never lifts the hips above standing height. His leg is within a
 * hair of full reach at rest, and a pelvis raised on the inhale asks the IK for
 * more leg than he has — it clamps and the knees lock. So frame 0, the seam
 * every other standing row starts from, is the top of the breath, and the
 * exhale is carried by the knees softening and the whole upper body settling
 * about a pixel at the tile.
 */
const STANDING_KNEE_SOFTEN = 0.01;
/**
 * Head-on a knee has no direction to break into on screen, so the settle can
 * be the full pixel; edge-on the same drop pushes the knees forward twice as
 * far as it lowers the chest, and reads as a bounce, so the profile settles
 * half as much.
 */
const BREATH_SETTLE_FACING = 0.045;
const BREATH_SETTLE_PROFILE = 0.016;
const BREATH_SHOULDER_LEAN = deg(0.5);
/**
 * How far the rib cage and shoulders sink onto the waist on the exhale: a
 * pixel and a half at the 32 px tile on top of the pixel the whole body settles head-on,
 * so the shoulders travel over two while the feet stay put. Edge-on the body
 * settles less (see above), so the chest carries more of the breath there. It
 * is zero at the top of the breath because frame 0 is the seam every other
 * standing row starts from.
 */
const BREATH_CHEST_SINK_FACING = 0.05;
const BREATH_CHEST_SINK_PROFILE = 0.065;
/**
 * The weight rolls from one foot to the other once per breath. Hips over the
 * loaded foot, and the shoulders counter it by leaning the other way.
 */
const WEIGHT_SHIFT = 0.03;
const WEIGHT_SHIFT_COUNTER_LEAN = deg(1.5);
/**
 * The right fist tightens once, late in the exhale — the gesture his gauntlet
 * answers to, kept small enough to read as a habit rather than as a threat.
 */
const FIST_FLEX_START = 0.5;
const FIST_FLEX_END = 0.95;
const FIST_FLEX = 0.6;
const RELAXED_FIST = 0.2;

const IDLE_HAND_DRIFT = 0.07;
const IDLE_HEAD_TURN = 0.1;
const IDLE_HAIR_DRIFT = 0.04;
const IDLE_HEAD_COUNTER_TILT = deg(3);
const IDLE_BROW = 0.55;
/** How far he keeps his face toward the camera while standing in profile. */
const SIDE_HEAD_TURN = 0.2;

/**
 * Edge-on the feet stand staggered by about half a foot's length. Closer, the
 * two shins and both feet overlap into one column and one slab at the tile;
 * much wider, and the profile stance splits the legs so far fore-and-aft that
 * no pair of shorts can cover both.
 */
export const IDLE_SIDE_FOOT_LEAD = 0.115;
/** How far behind the hip the near hand hangs in profile. */
const SIDE_HAND_BEHIND = 0.02;
/**
 * The far hand hangs level with the near one, hidden behind his body. Set
 * further back, its forearm shows as a strip of skin behind the seat of the
 * boxers, and at the tile that strip reads as a bare backside.
 */
const SIDE_FAR_HAND_BEHIND = SIDE_HAND_BEHIND;
/** Edge-on the elbow breaks backward; forward it swings the forearm across his crotch. */
const SIDE_ELBOW_FLARE = -0.35;

/** The breath as a 0..1 exhale, 0 at the top of it on frame 0. */
function exhaleAt(phase: number): number {
  return (1 - Math.cos(phase * TWO_PI)) / 2;
}

function idleBase(phase: number, lid: number, settle: number, chestSink: number): CarlPose {
  const exhale = exhaleAt(phase);
  const pose = restingPose();
  pose.bob = STANDING_KNEE_SOFTEN + settle * exhale;
  pose.chestRise = -chestSink * exhale;
  // Centred on frame 0, the seam every fidget starts from, so a fidget leaves
  // from square stance rather than from one hip.
  const weight = Math.sin(phase * TWO_PI);
  pose.sway = weight * WEIGHT_SHIFT;
  pose.lean = BREATH_SHOULDER_LEAN * (exhale - HALF) - weight * WEIGHT_SHIFT_COUNTER_LEAN;
  // The head rights itself against the hips: it tips toward the loaded side
  // less than the shoulders do, so it rocks over them rather than riding them.
  pose.headTilt = weight * IDLE_HEAD_COUNTER_TILT;
  pose.blink = lid;
  pose.brow = IDLE_BROW;
  pose.hairFlow = (exhale - HALF) * IDLE_HAIR_DRIFT;
  pose.rightFist = RELAXED_FIST + FIST_FLEX * pulse(phase, FIST_FLEX_START, FIST_FLEX_END);
  return pose;
}

const HALF = 0.5;

/** `lid` is the eye, 0 open to 1 shut; the row blinks on a frame of its own. */
export function idleFront(phase: number, lid = 0): CarlPose {
  const pose = idleBase(phase, lid, BREATH_SETTLE_FACING, BREATH_CHEST_SINK_FACING);
  const drift = Math.sin(phase * TWO_PI);
  pose.headTurn = drift * IDLE_HEAD_TURN;
  // The same joint angles the head-on walk swings around, so stepping off from
  // standing cannot change the shape of his arms — only how much they move.
  pose.rightArmAngles = facingArmAngles(RIGHT_ARM, drift * IDLE_HAND_DRIFT, 0, 0);
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, drift * IDLE_HAND_DRIFT, 0, 0);
  pose.leftFoot = pt(-IDLE_FOOT_SPREAD, 0);
  pose.rightFoot = pt(IDLE_FOOT_SPREAD, 0);
  // Straight columns, matching the head-on walk, so standing up out of a step
  // doesn't pop the knees into a bow.
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  return pose;
}

export function idleSide(phase: number, lid = 0): CarlPose {
  const pose = idleBase(phase, lid, BREATH_SETTLE_PROFILE, BREATH_CHEST_SINK_PROFILE);
  const drift = Math.sin(phase * TWO_PI);
  // Edge-on the arms hang against the hip, and the fingertips have to stop at
  // or above the boxer hem: a bare hand below it, on the centreline, reads
  // obscenely at tile size. The hang is the near-full reach the front view
  // uses; held any higher the IK takes up the slack at the elbow and throws
  // the arm into a dog-leg.
  const handY = SHOULDER_Y + HAND_HANG_DROP + pose.bob - (pose.chestRise ?? 0);
  pose.leftHand = pt(-SIDE_FAR_HAND_BEHIND, handY);
  pose.rightHand = pt(-SIDE_HAND_BEHIND, handY);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD, 0);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD, 0);
  pose.headTurn = SIDE_HEAD_TURN + drift * IDLE_HEAD_TURN;
  pose.elbowFlare = SIDE_ELBOW_FLARE;
  return pose;
}

export function idleBack(phase: number, lid = 0): CarlPose {
  const pose = idleFront(phase, lid);
  pose.headTurn = -pose.headTurn;
  // Seen from behind his arms hang on the far side of him, the same as they do
  // in the walk he steps into from here.
  pose.leftArmBehind = true;
  pose.rightArmBehind = true;
  return pose;
}

// ── Guard ────────────────────────────────────────────────────────────────────

/**
 * A trained fighter between blows: a boxer's high guard, chin tucked, knees
 * soft, bouncing on the balls of his feet. Head-on the fists are up either
 * side of the jaw, a fist's width clear of the face, with the forearms upright
 * and the elbows down in front of the ribs, so the forearms frame the face
 * rather than hide it. Held lower and closer — under the chin, touching — the
 * two fists merge at the tile into hands pressed together in prayer.
 */
const GUARD_CROUCH = 0.09;
/** The bounce, as extra knee bend at the bottom of it. Always a drop, never a lift. */
const GUARD_BOUNCE = 0.022;
const GUARD_CHIN_TUCK = -0.35;
const GUARD_BROW = 0.85;
const GUARD_FIST = 0.95;
/** Head-on: the fists' height below the head's centre, and their spread. */
const GUARD_FIST_BELOW_HEAD = HEAD_RY * 1.2;
const GUARD_LEAD_FIST_SPREAD = 0.22;
const GUARD_REAR_FIST_SPREAD = 0.24;
/** The rear hand rides a touch higher, covering the jaw. */
const GUARD_REAR_FIST_RISE = 0.04;
/**
 * A wider base than standing: a fighter's feet sit about shoulder width, which
 * is what lets him bounce without the knees knocking.
 */
const GUARD_FOOT_SPREAD = 0.17;
/**
 * The IK bends toward the side this sign names relative to the shoulder→fist
 * line, and a fist raised inboard of its shoulder turns "outward" into "up":
 * this sign is the one that drops the elbows down against the ribs.
 */
const GUARD_ELBOW_FLARE = 0.6;
/**
 * Head-on the guard's upper arms run forward from the shoulders toward the
 * camera and draw at this share of their length. At full length a fist raised
 * to the jaw can only be reached by an elbow thrown up and out beside the
 * head (a flex) or folded in across the chest (arms crossed).
 */
const GUARD_UPPER_ARM_SCALE = 0.55;
/** The fists lag the body's bounce a little, which is what keeps them loose. */
const GUARD_FIST_BOUNCE_SHARE = 0.6;

/**
 * Edge-on the lead (far) hand is out in front and the rear hand by the chin,
 * over a stance split fore and aft: the same stance the profile strikes wind
 * up from, so a punch thrown out of the guard does not re-plant the feet.
 */
const GUARD_SIDE_LEAD_HAND: Pt = pt(0.42, -1.62);
/**
 * The rear (near) arm is posed by its joints: elbow down and a little forward,
 * forearm up to the chin.
 */
const GUARD_SIDE_REAR_ARM: ArmAngles = { upper: deg(18), fore: deg(172), foreScale: 1 };
/**
 * Where the lead foot stands, and where the rear foot would stand flat: close
 * enough in under the hip that both legs keep a bend at the top of the
 * bounce, where they are longest.
 */
const GUARD_SIDE_LEAD_FOOT = 0.18;
const GUARD_SIDE_REAR_FOOT = -0.17;
const GUARD_SIDE_ELBOW_FLARE = 0.8;
const GUARD_SIDE_HEAD_TURN = 0.3;
const GUARD_SIDE_LEAN = deg(4);
/**
 * The rear heel is up: the weight is on the ball of that foot, which stays on
 * the floor where the flat foot's toe was — the heel rolls up about it, as it
 * does in every strike thrown from this stance.
 */
const GUARD_REAR_HEEL_LIFT = deg(12);
const GUARD_REAR_TOE_FLOOR_X = GUARD_SIDE_REAR_FOOT + TOE_AHEAD_OF_ANKLE;

/**
 * The guard does not blink. Its bounce loops in well under a second, so a
 * blink on every cycle would be a flutter; and a fighter watching his man
 * holds his eyes open for the few seconds the guard lasts.
 */
function guardBase(phase: number): CarlPose {
  const pose = restingPose();
  // A triangle rather than a sine: six samples of a sine step a quarter, a
  // half, a quarter, and the half-steps read as a jolt; a triangle's steps are
  // even, and at this frame count the corners do not show.
  const bounce = 1 - Math.abs(1 - 2 * phase);
  pose.crouch = GUARD_CROUCH;
  pose.bob = GUARD_BOUNCE * bounce;
  pose.brow = GUARD_BROW;
  pose.chinLift = GUARD_CHIN_TUCK;
  pose.leftFist = GUARD_FIST;
  pose.rightFist = GUARD_FIST;
  pose.hairFlow = (bounce - HALF) * IDLE_HAIR_DRIFT;
  pose.jacketFlare = bounce * GUARD_JACKET_BOUNCE;
  return pose;
}

const GUARD_JACKET_BOUNCE = 0.08;

/** Where a head-on guard fist sits, following the body down through the bounce. */
function guardFistY(pose: CarlPose): number {
  return HEAD_CENTRE_Y + GUARD_FIST_BELOW_HEAD + pose.bob * GUARD_FIST_BOUNCE_SHARE;
}

export function guardFront(phase: number): CarlPose {
  const pose = guardBase(phase);
  const fistY = guardFistY(pose);
  pose.leftHand = pt(-GUARD_LEAD_FIST_SPREAD, fistY);
  pose.rightHand = pt(GUARD_REAR_FIST_SPREAD, fistY - GUARD_REAR_FIST_RISE);
  pose.leftFoot = pt(-GUARD_FOOT_SPREAD, 0);
  pose.rightFoot = pt(GUARD_FOOT_SPREAD, 0);
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  pose.elbowFlare = GUARD_ELBOW_FLARE;
  pose.leftUpperArmScale = GUARD_UPPER_ARM_SCALE;
  pose.rightUpperArmScale = GUARD_UPPER_ARM_SCALE;
  return pose;
}

export function guardSide(phase: number): CarlPose {
  const pose = guardBase(phase);
  const follow = pose.bob * GUARD_FIST_BOUNCE_SHARE;
  pose.leftHand = pt(GUARD_SIDE_LEAD_HAND.x, GUARD_SIDE_LEAD_HAND.y + follow);
  pose.rightArmAngles = GUARD_SIDE_REAR_ARM;
  pose.leftFoot = pt(GUARD_SIDE_LEAD_FOOT, 0);
  pose.rightFoot = profileFootTarget(
    ankleOverPivot(GUARD_REAR_TOE_FLOOR_X, 'toe', GUARD_REAR_HEEL_LIFT),
    GUARD_REAR_HEEL_LIFT,
  );
  pose.rightFootPitch = GUARD_REAR_HEEL_LIFT;
  pose.elbowFlare = GUARD_SIDE_ELBOW_FLARE;
  pose.headTurn = GUARD_SIDE_HEAD_TURN;
  pose.lean = GUARD_SIDE_LEAN;
  pose.chinLift = 0;
  pose.headTilt = GUARD_SIDE_CHIN_TUCK_TILT;
  return pose;
}

/** In profile a tucked chin is a real rotation of the head, toward the chest. */
const GUARD_SIDE_CHIN_TUCK_TILT = deg(8);

/**
 * From behind, a guard is read from its outline alone. The fists stay where
 * the head-on guard holds them — in front of his chin, on the far side of him
 * and hidden by his back — and only the elbows show, bent and bowed out past
 * the ribs. Fists raised far enough to show either side of the head read as
 * hands clasped behind it; fists held in at the ribs, as arms hanging.
 */
const GUARD_BACK_FIST_SPREAD = 0.18;
const GUARD_BACK_FIST_BELOW_HEAD = HEAD_RY * 1.9;
/** The elbows bowed out past the ribs, the one part of the guard that shows from behind. */
const GUARD_BACK_ELBOW_FLARE = 1.6;

export function guardBack(phase: number): CarlPose {
  const pose = guardFront(phase);
  pose.leftArmBehind = true;
  pose.rightArmBehind = true;
  const fistY = HEAD_CENTRE_Y + GUARD_BACK_FIST_BELOW_HEAD + pose.bob * GUARD_FIST_BOUNCE_SHARE;
  pose.leftHand = pt(-GUARD_BACK_FIST_SPREAD, fistY - GUARD_REAR_FIST_RISE);
  pose.rightHand = pt(GUARD_BACK_FIST_SPREAD, fistY);
  pose.elbowFlare = GUARD_BACK_ELBOW_FLARE;
  // From behind the fists are hidden and only the elbows show, so the upper arms draw whole.
  pose.leftUpperArmScale = FULL_UPPER_ARM;
  pose.rightUpperArmScale = FULL_UPPER_ARM;
  return pose;
}

// ── Dropping the guard ───────────────────────────────────────────────────────

/** An arm as a skeleton solved it: its joint angles and the share of its upper arm drawn. */
interface SolvedArm {
  readonly angles: ArmAngles;
  readonly upperScale: number;
}

/** See {@link anglesThrough} for why arms are blended by their solved joints. */
function solvedArm(arm: BoneChain): SolvedArm {
  return {
    angles: anglesThrough(arm.root, arm.joint, arm.end),
    upperScale: upperArmShareThrough(arm.root, arm.joint),
  };
}

function setSolvedArm(pose: CarlPose, side: BodySide, arm: SolvedArm): void {
  setArmAngles(pose, side, arm.angles, arm.upperScale);
}

/**
 * The elbow drops first and the forearm falls after it, so the fist comes
 * down in front of the chest before the arm straightens. Swung together, the
 * forearm passes level through the middle of the drop — pointing, forward in
 * profile and across the belly head-on.
 */
const DROP_UPPER_LEAD = 2.4;
const DROP_FORE_DELAY = 0.1;
const DROP_FORE_RATE = 1.6;
/**
 * Head-on the falling forearm swings toward the camera, not across him, and
 * is drawn this much shorter as it passes end-on.
 */
const DROP_FORE_END_ON = 0.85;

/**
 * How an arm comes down. From behind, the guard's fists are up by the ears,
 * twice as far from the hips as head-on, and the fall is spread evenly over
 * the drop instead of front-loaded, so no one frame carries most of it.
 */
type DropPace = 'staggered' | 'even';

function blendArm(
  from: SolvedArm,
  to: SolvedArm,
  t: number,
  towardCamera: boolean,
  pace: DropPace,
): SolvedArm {
  const staggered = pace === 'staggered';
  const upper = staggered ? easeInOut(clamp01(t * DROP_UPPER_LEAD)) : t;
  const fore = staggered ? easeInOut(clamp01((t - DROP_FORE_DELAY) * DROP_FORE_RATE)) : t;
  const endOn = towardCamera ? DROP_FORE_END_ON * hump(fore) : 0;
  return {
    angles: {
      upper: lerpAngle(from.angles.upper, to.angles.upper, upper),
      fore: lerpAngle(from.angles.fore, to.angles.fore, fore),
      foreScale: lerp(from.angles.foreScale, to.angles.foreScale, fore) * (1 - endOn),
    },
    upperScale: lerp(from.upperScale, to.upperScale, upper),
  };
}

/** How high a foot drawn back under him from the fighting stance clears the floor. */
const DROP_STEP_LIFT = 0.035;
/**
 * The hands fall ahead of the feet: a man coming out of his guard lets his
 * arms go first and shuffles his stance square after.
 */
const DROP_ARMS_LEAD = 1.6;
/**
 * He stays down in his fighting crouch until the stance is nearly square:
 * straightened over a foot still planted wide, the leg has to reach further
 * than it is long.
 */
const DROP_RISE_START = 0.4;

/**
 * When, through the drop, a foot is off the floor stepping from its guard
 * place to its idle one, as fractions of the drop. One foot steps at a time,
 * so the other holds its place on the floor across the frames between.
 */
interface StepWindow {
  readonly start: number;
  readonly end: number;
}

interface DropSteps {
  readonly left: StepWindow;
  readonly right: StepWindow;
  readonly pace: DropPace;
}

/**
 * Head-on the feet only narrow by about a pixel: the left steps in while the
 * arms fall, and the right's last pixel is taken on the cut into the idle.
 */
const FACING_DROP_STEPS: DropSteps = {
  left: { start: 0, end: 0.66 },
  right: { start: 0.75, end: 1 },
  pace: 'staggered',
};
const BACK_DROP_STEPS: DropSteps = { ...FACING_DROP_STEPS, pace: 'even' };
/**
 * Edge-on the fighting stance is split fore and aft by several pixels: the
 * rear foot comes up under him first, then the lead foot draws back.
 */
const PROFILE_DROP_STEPS: DropSteps = {
  left: { start: 0.6, end: 1 },
  right: { start: 0, end: 0.4 },
  pace: 'staggered',
};

interface SteppedFoot {
  readonly at: Pt;
  readonly pitch: number;
  /** On the floor bearing weight: before its step begins or once it has landed. */
  readonly planted: boolean;
}

function steppedFoot(
  from: Pt,
  to: Pt,
  fromPitch: number,
  toPitch: number,
  t: number,
  window: StepWindow,
): SteppedFoot {
  const progress = clamp01((t - window.start) / (window.end - window.start));
  const along = easeInOut(progress);
  const at = mixPt(from, to, along);
  return {
    at: pt(at.x, at.y - hump(progress) * DROP_STEP_LIFT),
    pitch: lerp(fromPitch, toPitch, along),
    planted: progress <= 0 || progress >= 1,
  };
}

/**
 * `t` of the way from the guard's first frame to the idle's, 0 to 1: the
 * fists come down and open, the chin lifts, the stance squares up. Played
 * when the guard runs out, so the hands never jump from the jaw to the hips.
 */
function guardDrop(
  guard: CarlPose,
  idle: CarlPose,
  t: number,
  view: ViewSpec,
  steps: DropSteps,
): CarlPose {
  const arms = easeInOut(clamp01(t * DROP_ARMS_LEAD));
  const body = easeInOut(clamp01((t - DROP_RISE_START) / (1 - DROP_RISE_START)));
  const from = buildSkeleton(guard, view);
  const to = buildSkeleton(idle, view);
  const pose = { ...idle };
  const headOn = !view.profile;
  const [fromLeft, toLeft] = [solvedArm(from.leftArm), solvedArm(to.leftArm)];
  const [fromRight, toRight] = [solvedArm(from.rightArm), solvedArm(to.rightArm)];
  setSolvedArm(pose, 'left', blendArm(fromLeft, toLeft, t, headOn, steps.pace));
  setSolvedArm(pose, 'right', blendArm(fromRight, toRight, t, headOn, steps.pace));
  pose.leftFist = lerp(guard.leftFist, idle.leftFist, arms);
  pose.rightFist = lerp(guard.rightFist, idle.rightFist, arms);
  pose.bob = lerp(guard.bob, idle.bob, body);
  pose.crouch = lerp(guard.crouch, idle.crouch, body);
  pose.lean = lerp(guard.lean, idle.lean, body);
  pose.headTurn = lerp(guard.headTurn, idle.headTurn, body);
  pose.headTilt = lerp(guard.headTilt, idle.headTilt, body);
  pose.chinLift = lerp(guard.chinLift ?? 0, idle.chinLift ?? 0, arms);
  pose.brow = lerp(guard.brow, idle.brow, body);
  pose.jacketFlare = lerp(guard.jacketFlare, idle.jacketFlare, body);
  pose.hairFlow = lerp(guard.hairFlow, idle.hairFlow, body);
  const left = steppedFoot(
    guard.leftFoot,
    idle.leftFoot,
    guard.leftFootPitch,
    idle.leftFootPitch,
    t,
    steps.left,
  );
  const right = steppedFoot(
    guard.rightFoot,
    idle.rightFoot,
    guard.rightFootPitch,
    idle.rightFootPitch,
    t,
    steps.right,
  );
  pose.leftFoot = left.at;
  pose.leftFootPitch = left.pitch;
  pose.rightFoot = right.at;
  pose.rightFootPitch = right.pitch;
  pose.leftFootPlanted = left.planted;
  pose.rightFootPlanted = right.planted;
  return pose;
}

export function guardDropFront(t: number): CarlPose {
  return guardDrop(guardFront(0), idleFront(0), t, VIEWS.front, FACING_DROP_STEPS);
}

export function guardDropSide(t: number): CarlPose {
  return guardDrop(guardSide(0), idleSide(0), t, VIEWS.side, PROFILE_DROP_STEPS);
}

export function guardDropBack(t: number): CarlPose {
  return guardDrop(guardBack(0), idleBack(0), t, VIEWS.back, BACK_DROP_STEPS);
}

// ── Fidgets ──────────────────────────────────────────────────────────────────

/**
 * Brings a head-on forearm up in front of the body the way a real one comes
 * up: toward the camera. Head-on that is a forearm getting shorter as it
 * swings at the viewer, vanishing end-on at the halfway point, then growing
 * again pointing up — never a hand sweeping sideways across the hips, which is
 * the path a hand target interpolated in the picture plane takes, and which
 * carries the hands straight past his crotch.
 *
 * `raise` runs 0 (hanging, exactly the idle's arm) to 1 (`upAngle`, drawn at
 * `upScale` of its length). The angle is inward-positive: 0 hangs, a quarter
 * turn points across the body, a half turn points straight up. The upper
 * arm's drawn share is {@link foldedUpperScale}'s.
 */
function foldForearm(side: number, raise: number, upAngle: number, upScale: number): ArmAngles {
  const hanging = facingArmAngles(side, 0, 0, 0);
  const upper = lerp(hanging.upper, side * FOLD_UPPER_TUCK, raise);
  if (raise < FOLD_END_ON_AT) {
    const towardCamera = raise / FOLD_END_ON_AT;
    return {
      upper,
      fore: lerp(hanging.fore, -side * FOLD_PASS_ANGLE, towardCamera),
      foreScale: lerp(hanging.foreScale, FOLD_END_ON_SCALE, towardCamera),
    };
  }
  const rising = (raise - FOLD_END_ON_AT) / (1 - FOLD_END_ON_AT);
  return {
    upper,
    fore: lerp(-side * FOLD_PASS_ANGLE, -side * upAngle, rising),
    foreScale: lerp(FOLD_END_ON_SCALE, upScale, rising),
  };
}

/**
 * The share of the upper arm a folding arm draws. `elbowForward` is how far
 * the upper arm comes up toward the camera by the end of the raise, as the
 * share of its length it loses on screen: an elbow brought forward lifts the
 * whole forearm up the body, which is the only way head-on to hold two hands
 * together in front of the chest rather than the belly.
 */
function foldedUpperScale(raise: number, elbowForward = 0): number {
  return FULL_UPPER_ARM - elbowForward * raise;
}

/** Halfway up, the forearm points straight at the camera and is drawn at almost nothing. */
const FOLD_END_ON_AT = 0.5;
const FOLD_END_ON_SCALE = 0.12;
/**
 * The forearm turns in across the body as it comes up, passing across it at
 * the end-on moment, so neither half of the raise has to swing it through a
 * wide arc while it is still drawn long.
 */
const FOLD_PASS_ANGLE = deg(90);
/** The upper arm drops in against the ribs as the forearm comes up. */
const FOLD_UPPER_TUCK = deg(2);

/** The seam pose every fidget leaves from and returns to. */
function seamFront(t: number): CarlPose {
  const pose = idleFront(0);
  pose.sway += FIDGET_WEIGHT_DRIFT * hump(t);
  return pose;
}

/**
 * Nobody stands dead still through a gesture: the weight drifts onto one foot
 * and back over the length of every head-on fidget, which also keeps a held
 * beat from being a frozen picture.
 */
const FIDGET_WEIGHT_DRIFT = 0.012;

function seamSide(t: number): CarlPose {
  const pose = idleSide(0);
  pose.sway += FIDGET_WEIGHT_DRIFT * hump(t);
  return pose;
}

/**
 * "Really? Fucking really?" — his signature. The head tips back, the eyes roll
 * up to the ceiling, the brows knit, the hands turn out from his sides, and he
 * mutters three shapes at whoever is watching; then a short shake of the head
 * and he settles.
 *
 * The turned-out hands are what carry it at a 32px tile, where a face is a
 * handful of pixels: the silhouette widens exactly when the head goes back.
 */
const CEILING_BEATS: Beats = { start: 0, peakIn: 0.26, peakOut: 0.62, end: 0.97 };
const CEILING_SHAKE_START = 0.58;
const CEILING_SHAKE_END = 0.86;
const CEILING_CHIN_LIFT = 0.85;
const CEILING_GAZE = 1;
const CEILING_BROW = 1;
/**
 * Hands out and up, open: the "what do you want from me" shrug. The elbows
 * stay in at the ribs and the forearms come forward and out, palms up —
 * toward the camera head-on, so they are drawn short, pointing up and out
 * from the elbow. Swung out sideways at full length instead, two forearms at
 * waist height read as flippers; elbows flared away from the body, as a flex.
 */
const CEILING_FOREARM_OUT = deg(150);
const CEILING_FOREARM_SCALE = 0.55;
/** Halfway out the forearm points straight at the camera and is drawn at almost nothing. */
const CEILING_END_ON_DIP = 0.7;
const CEILING_UPPER_TUCK = deg(2);
/** Through the hold the forearms keep turning up, the exasperation building. */
const CEILING_HOLD_FOREARM_DRIFT = deg(12);
/** The hands open once they are clearly on their way out, not on the first twitch. */
const CEILING_HANDS_OPEN_AT = 0.3;
/**
 * Through the hold the hands keep rising a little and the head keeps rolling
 * over — exasperation building — so no two held frames are the same picture.
 */
const CEILING_HOLD_HAND_DRIFT = 0.05;
/** An exasperated head rolls a little off upright as it tips back. */
const CEILING_HEAD_ROLL = deg(7);
const CEILING_HOLD_ROLL_DRIFT = deg(5);
/** A single left-right-centre shake: one full cycle, spread over five frames. */
const CEILING_SHAKE_TURN = 0.55;
/** A mouth shape: how far the lips part and how wide they stretch, 1 being the resting width. */
interface MouthShape {
  readonly open: number;
  readonly width: number;
}
/** An "o": parted a little, pursed narrow. */
const MUTTER_ROUND_O: MouthShape = { open: 0.32, width: 0.7 };
/** A flat grimace: barely parted, stretched wide. */
const MUTTER_GRIMACE: MouthShape = { open: 0.12, width: 1.3 };
/** An open syllable at the mouth's resting width. */
const MUTTER_SYLLABLE: MouthShape = { open: 0.48, width: 1 };
/**
 * The mutter's mouth shapes in the order they are spoken, each held for a
 * couple of frames, in the window the head is back.
 */
const MUTTER_SHAPES: readonly MouthShape[] = [MUTTER_ROUND_O, MUTTER_GRIMACE, MUTTER_SYLLABLE];
const MUTTER_START = 0.22;
const MUTTER_END = 0.58;
/**
 * Edge-on a shake swings the whole face toward and away from the camera, which
 * moves far more of the silhouette than it does head-on; it is kept smaller so
 * it stays a shake rather than a spin.
 */
const CEILING_SIDE_SHAKE_TURN = 0.3;
/** In profile the head tips back as a true rotation, face up to the ceiling. */
const CEILING_SIDE_TILT = deg(-28);
const CEILING_SIDE_LEAN = deg(-3);
/**
 * Edge-on the shrug's hands come forward and up rather than out — out is into
 * the picture, where nothing shows — forearms raised in front of the hips.
 */
const CEILING_SIDE_HAND_FORWARD = 0.22;
const CEILING_SIDE_HAND_RISE = 0.2;

interface CeilingBeat {
  readonly lift: number;
  /** 0 at the start of the hold, 1 at its end, eased; the hold's slow build. */
  readonly build: number;
  readonly shake: number;
  readonly mouthOpen: number;
  readonly mouthWidth: number;
}

function ceilingBeat(t: number): CeilingBeat {
  const lift = plateau(t, CEILING_BEATS);
  const build = lift * easeInOut(throughHold(t, CEILING_BEATS));
  const shakeT = clamp01((t - CEILING_SHAKE_START) / (CEILING_SHAKE_END - CEILING_SHAKE_START));
  const shaking = t > CEILING_SHAKE_START && t < CEILING_SHAKE_END;
  const shake = shaking ? Math.sin(shakeT * TWO_PI) * hump(shakeT) : 0;
  let mouthOpen = 0;
  let mouthWidth = 1;
  if (t >= MUTTER_START && t < MUTTER_END) {
    const through = (t - MUTTER_START) / (MUTTER_END - MUTTER_START);
    const slot = Math.min(Math.floor(through * MUTTER_SHAPES.length), MUTTER_SHAPES.length - 1);
    const shape = MUTTER_SHAPES[slot];
    mouthOpen = shape.open;
    mouthWidth = shape.width;
  }
  return { lift, build, shake, mouthOpen, mouthWidth };
}

function openHands(pose: CarlPose, amount: number): void {
  pose.rightFist = lerp(pose.rightFist, 0, amount);
  pose.leftFist = lerp(pose.leftFist, 0, amount);
  if (amount < CEILING_HANDS_OPEN_AT) return;
  pose.rightHandShape = 'open';
  pose.leftHandShape = 'open';
}

/** A head-on arm `amount` of the way from hanging into the shrug, its forearm `outAngle` from hanging. */
function shrugArm(side: number, amount: number, outAngle: number): ArmAngles {
  const hanging = facingArmAngles(side, 0, 0, 0);
  const endOn = 1 - CEILING_END_ON_DIP * hump(amount);
  return {
    upper: lerp(hanging.upper, side * CEILING_UPPER_TUCK, amount),
    fore: lerp(hanging.fore, side * outAngle, amount),
    foreScale: lerp(hanging.foreScale, CEILING_FOREARM_SCALE, amount) * endOn,
  };
}

export function fidgetCeilingFront(t: number): CarlPose {
  const pose = seamFront(t);
  const beat = ceilingBeat(t);
  pose.chinLift = beat.lift * CEILING_CHIN_LIFT;
  pose.gazeUp = beat.lift * CEILING_GAZE;
  pose.brow = lerp(pose.brow, CEILING_BROW, beat.lift);
  pose.mouth = beat.mouthOpen;
  pose.mouthWidth = beat.mouthWidth;
  pose.headTurn += beat.shake * CEILING_SHAKE_TURN;
  pose.headTilt = CEILING_HEAD_ROLL * beat.lift + CEILING_HOLD_ROLL_DRIFT * beat.build;
  const turnedUp = CEILING_FOREARM_OUT + CEILING_HOLD_FOREARM_DRIFT * beat.build;
  pose.rightArmAngles = shrugArm(RIGHT_ARM, beat.lift, turnedUp);
  pose.leftArmAngles = shrugArm(LEFT_ARM, beat.lift, turnedUp);
  openHands(pose, beat.lift);
  return pose;
}

export function fidgetCeilingSide(t: number): CarlPose {
  const pose = seamSide(t);
  const beat = ceilingBeat(t);
  pose.headTilt = CEILING_SIDE_TILT * beat.lift - CEILING_HOLD_ROLL_DRIFT * beat.build;
  pose.lean += CEILING_SIDE_LEAN * beat.lift;
  pose.gazeUp = beat.lift * CEILING_GAZE;
  pose.brow = lerp(pose.brow, CEILING_BROW, beat.lift);
  pose.mouth = beat.mouthOpen;
  pose.mouthWidth = beat.mouthWidth;
  pose.headTurn += beat.shake * CEILING_SIDE_SHAKE_TURN;
  const out = beat.lift * CEILING_SIDE_HAND_FORWARD;
  const rise = beat.lift * CEILING_SIDE_HAND_RISE + beat.build * CEILING_HOLD_HAND_DRIFT;
  pose.rightHand = pt(pose.rightHand.x + out, pose.rightHand.y - rise);
  pose.leftHand = pt(pose.leftHand.x + out, pose.leftHand.y - rise);
  openHands(pose, beat.lift);
  return pose;
}

/**
 * A neck roll: the head drops to the right shoulder, rolls forward through the
 * chest and up to the left, then comes back upright — eyes half shut through
 * the bottom of it, the way a man loosens a stiff neck. The shoulders rise into
 * it and drop out of it.
 */
const NECK_ROLL_BEATS: Beats = { start: 0, peakIn: 0.15, peakOut: 0.8, end: 1 };
/** The roll itself sweeps once, from the right shoulder to the left, inside the beats. */
const NECK_ROLL_SWEEP_START = 0.1;
const NECK_ROLL_SWEEP_END = 0.85;
const NECK_ROLL_TILT = deg(26);
const NECK_ROLL_TUCK = -0.7;
const NECK_ROLL_EYES = 0.7;
const NECK_ROLL_SHRUG = 0.018;
const NECK_ROLL_TWIST = 0.12;
/** The shoulders counter-rotate twice per roll: once as the head drops, once as it lifts. */
const NECK_ROLL_TWISTS_PER_SWEEP = 2;

export function fidgetNeckRoll(t: number): CarlPose {
  const pose = seamFront(t);
  const amount = plateau(t, NECK_ROLL_BEATS);
  const sweep = clamp01(
    (t - NECK_ROLL_SWEEP_START) / (NECK_ROLL_SWEEP_END - NECK_ROLL_SWEEP_START),
  );
  const angle = sweep * Math.PI;
  pose.headTilt = Math.cos(angle) * NECK_ROLL_TILT * amount;
  pose.chinLift = Math.sin(angle) * NECK_ROLL_TUCK * amount;
  pose.blink = Math.max(pose.blink, Math.sin(angle) * NECK_ROLL_EYES * amount);
  // Shoulders up into the roll: the body lifts out of the knees' standing
  // softness, and never past straight.
  pose.bob -= Math.min(NECK_ROLL_SHRUG, pose.bob) * amount;
  pose.twist = Math.sin(angle * NECK_ROLL_TWISTS_PER_SWEEP) * NECK_ROLL_TWIST * amount;
  return pose;
}

/**
 * The right fist comes up in front of his chest and closes hard; he tucks his
 * chin and looks at the knuckles, turns the fist once, and lets it drop.
 */
const FIST_RAISE_BEATS: Beats = { start: 0, peakIn: 0.25, peakOut: 0.72, end: 1 };
const FIST_LOOK_BEATS: Beats = { start: 0.1, peakIn: 0.32, peakOut: 0.7, end: 0.9 };
const FIST_CLENCH_BEATS: Beats = { start: 0.12, peakIn: 0.3, peakOut: 0.72, end: 0.9 };
/** Raised, the forearm points up and in across the chest, foreshortened toward him. */
const FIST_RAISED_ANGLE = deg(155);
const FIST_RAISED_SCALE = 0.75;
/** The fist turns over once while he looks at it, rocking the forearm this far. */
const FIST_TURN = deg(12);
const FIST_LOOK_TURN = 0.45;
const FIST_LOOK_TUCK = -0.55;
const FIST_LOOK_GAZE = -0.8;
const FIST_BROW = 0.9;

export function fidgetFist(t: number): CarlPose {
  const pose = seamFront(t);
  const raised = plateau(t, FIST_RAISE_BEATS);
  const looking = plateau(t, FIST_LOOK_BEATS);
  const turn = Math.sin(throughHold(t, FIST_CLENCH_BEATS) * TWO_PI);
  if (raised > 0) {
    const arm = foldForearm(
      RIGHT_ARM,
      raised,
      FIST_RAISED_ANGLE + turn * FIST_TURN,
      FIST_RAISED_SCALE,
    );
    setArmAngles(pose, 'right', arm, foldedUpperScale(raised));
  }
  const clench = plateau(t, FIST_CLENCH_BEATS);
  pose.rightFist = lerp(pose.rightFist, 1, clench);
  pose.headTurn = lerp(pose.headTurn, FIST_LOOK_TURN, looking);
  pose.chinLift = FIST_LOOK_TUCK * looking;
  pose.gazeUp = FIST_LOOK_GAZE * looking;
  pose.brow = lerp(pose.brow, FIST_BROW, looking);
  return pose;
}

/**
 * Cracking the knuckles: both hands meet in front of the chest, the right palm
 * presses over the left fist, a sharp push on the crack frame, and the hands
 * part and drop.
 */
const KNUCKLES_BEATS: Beats = { start: 0, peakIn: 0.42, peakOut: 0.62, end: 1 };
/**
 * Both forearms come up and across until the fists meet in front of the
 * chest; the right one rides a little higher, its palm over the left's
 * knuckles.
 */
const KNUCKLES_ACROSS_ANGLE = deg(125);
const KNUCKLES_ACROSS_SCALE = 1;
/** The elbows come forward, so the hands meet in front of the chest. */
const KNUCKLES_ELBOW_FORWARD = 0.45;
const KNUCKLES_OVER_ANGLE = deg(8);
const KNUCKLES_CRACK_AT = 0.52;
const KNUCKLES_CRACK_WIDTH = 0.1;
/** The push that cracks them: the pressing forearm drives down and in. */
const KNUCKLES_PUSH = deg(10);
const KNUCKLES_TUCK = -0.3;
/** The pressing hand stays half open over the fist it is pressing. */
const KNUCKLES_PRESSING_FIST = 0.5;
const KNUCKLES_BROW = 0.8;
/** The crack itself: a wince of the brow and mouth and a jolt of the shoulders. */
const KNUCKLES_CRACK_BROW = 0.2;
const KNUCKLES_CRACK_MOUTH = 0.15;
const KNUCKLES_CRACK_GRIMACE = 0.3;
const KNUCKLES_CRACK_TWIST = 0.08;
const KNUCKLES_CRACK_ELBOWS = deg(9);
const KNUCKLES_PEEL_EASE = 1.8;

export function fidgetKnuckles(t: number): CarlPose {
  const pose = seamFront(t);
  const together = plateau(t, KNUCKLES_BEATS);
  const crack = pulse(
    t,
    KNUCKLES_CRACK_AT - KNUCKLES_CRACK_WIDTH,
    KNUCKLES_CRACK_AT + KNUCKLES_CRACK_WIDTH,
  );
  if (together > 0) {
    // Both arms leave his sides at once here, which moves far more of the
    // outline than one arm does; they peel away slowly and speed up once clear.
    const raise = together ** KNUCKLES_PEEL_EASE;
    const right = foldForearm(
      RIGHT_ARM,
      raise,
      KNUCKLES_ACROSS_ANGLE + KNUCKLES_OVER_ANGLE - crack * KNUCKLES_PUSH,
      KNUCKLES_ACROSS_SCALE,
    );
    const left = foldForearm(LEFT_ARM, raise, KNUCKLES_ACROSS_ANGLE, KNUCKLES_ACROSS_SCALE);
    const upperScale = foldedUpperScale(raise, KNUCKLES_ELBOW_FORWARD);
    // The push comes from the shoulders: both elbows kick out as he leans on it.
    const elbowsOut = crack * KNUCKLES_CRACK_ELBOWS;
    setArmAngles(
      pose,
      'right',
      { ...right, upper: right.upper + RIGHT_ARM * elbowsOut },
      upperScale,
    );
    setArmAngles(pose, 'left', { ...left, upper: left.upper + LEFT_ARM * elbowsOut }, upperScale);
  }
  pose.leftFist = lerp(pose.leftFist, 1, together);
  pose.rightFist = lerp(pose.rightFist, KNUCKLES_PRESSING_FIST, together);
  pose.chinLift = KNUCKLES_TUCK * together;
  pose.brow = lerp(pose.brow, KNUCKLES_BROW, together) + crack * KNUCKLES_CRACK_BROW;
  pose.mouth = crack * KNUCKLES_CRACK_MOUTH;
  pose.mouthWidth = 1 + crack * KNUCKLES_CRACK_GRIMACE;
  pose.twist = crack * KNUCKLES_CRACK_TWIST;
  return pose;
}

/**
 * A glance back over his shoulder — the dungeon is dangerous. The head
 * leads, the shoulders follow a frame behind, the eyes go to the corner; he
 * holds a beat, searching, and comes back round.
 *
 * Head-on the painter cannot turn the skull to profile, so the look is carried
 * by the body turning under it: the shoulders swing round as far as they go,
 * the arms swing with them — the right one back, the left one forward and
 * foreshortened toward the camera — the weight goes onto the left foot, and
 * the head drops toward the shoulder it looks over.
 */
const GLANCE_HEAD_BEATS: Beats = { start: 0, peakIn: 0.25, peakOut: 0.65, end: 0.92 };
const GLANCE_SHOULDER_BEATS: Beats = { start: 0.08, peakIn: 0.35, peakOut: 0.6, end: 1 };
const GLANCE_HEAD_TURN = 1;
const GLANCE_TWIST = 1;
const GLANCE_BROW = 0.9;
/** Searching the dark behind him, the head keeps easing round through the hold. */
const GLANCE_SEARCH_TILT = deg(6);
const GLANCE_SHOULDER_DROP = deg(4);
/** The arms follow the shoulders round: the swing of a walking arm at about full stride. */
const GLANCE_ARM_SWING = 0.6;
const GLANCE_LEAN = deg(3);

export function fidgetGlance(t: number): CarlPose {
  const pose = seamFront(t);
  const head = plateau(t, GLANCE_HEAD_BEATS);
  const shoulders = plateau(t, GLANCE_SHOULDER_BEATS);
  pose.headTurn = lerp(pose.headTurn, GLANCE_HEAD_TURN, head);
  pose.headTilt =
    -(GLANCE_SHOULDER_DROP + GLANCE_SEARCH_TILT * throughHold(t, GLANCE_HEAD_BEATS)) * head;
  pose.twist = GLANCE_TWIST * shoulders;
  pose.brow = lerp(pose.brow, GLANCE_BROW, head);
  pose.sway -= shoulders * WEIGHT_SHIFT;
  pose.lean -= shoulders * GLANCE_LEAN;
  const swing = shoulders * GLANCE_ARM_SWING;
  pose.rightArmAngles = facingArmAngles(RIGHT_ARM, -swing, 0, 0);
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, swing, shoulders, 0);
  return pose;
}

// ── Fidgets in the other views ───────────────────────────────────────────────

/**
 * A head-on fidget seen from behind: the same gesture, with the arms hung on
 * the far side of him and the head turned the way the back idle turns it.
 * Only the gestures that read from behind are given one — a fist raised in
 * front of his chest, or two hands meeting there, are hidden by his back.
 */
function fromBehind(pose: CarlPose): CarlPose {
  return {
    ...pose,
    headTurn: -pose.headTurn,
    leftArmBehind: true,
    rightArmBehind: true,
  };
}

export function fidgetCeilingBack(t: number): CarlPose {
  return fromBehind(fidgetCeilingFront(t));
}

export function fidgetNeckRollBack(t: number): CarlPose {
  return fromBehind(fidgetNeckRoll(t));
}

export function fidgetGlanceBack(t: number): CarlPose {
  return fromBehind(fidgetGlance(t));
}

/** The profile idle's arms, as joint angles, so an edge-on fidget leaves from and returns to them exactly. */
function hangingSideAngles(): { left: SolvedArm; right: SolvedArm } {
  const skeleton = buildSkeleton(idleSide(0), VIEWS.side);
  return { left: solvedArm(skeleton.leftArm), right: solvedArm(skeleton.rightArm) };
}

const SIDE_HANG = hangingSideAngles();

/**
 * An edge-on arm `weight` of the way from its hang to `target`. The forearm
 * leads the upper arm by `curl`: raised, the elbow bends before the shoulder
 * swings, and lowered, the elbow drops before the forearm opens — the fist
 * travels up and down in front of the chest instead of sweeping out ahead of
 * him through a level, pointing arm.
 */
function sideArmToward(hang: SolvedArm, target: ArmAngles, weight: number, curl = 0): SolvedArm {
  const foreWeight = weight ** (1 - curl);
  const upperWeight = weight ** (1 + curl);
  return {
    angles: {
      upper: lerpAngle(hang.angles.upper, target.upper, upperWeight),
      fore: lerpAngle(hang.angles.fore, target.fore, foreWeight),
      foreScale: lerp(hang.angles.foreScale, target.foreScale, foreWeight),
    },
    upperScale: lerp(hang.upperScale, FULL_UPPER_ARM, upperWeight),
  };
}

/** How far a raised forearm leads its upper arm; see {@link sideArmToward}. */
const SIDE_CURL = 0.25;

/**
 * Edge-on the neck roll is a nod that goes round: the chin drops to the
 * chest, the head swings toward the camera and back up past upright, then
 * settles. In profile a pitch is a true rotation, so it reads at any size.
 */
const NECK_SIDE_DROP = deg(40);
const NECK_SIDE_BACK = deg(-14);
const NECK_SIDE_TURN = 0.35;

export function fidgetNeckRollSide(t: number): CarlPose {
  const pose = seamSide(t);
  const amount = plateau(t, NECK_ROLL_BEATS);
  const sweep = clamp01(
    (t - NECK_ROLL_SWEEP_START) / (NECK_ROLL_SWEEP_END - NECK_ROLL_SWEEP_START),
  );
  const angle = sweep * Math.PI;
  // Forward on the first half of the sweep, back on the second: one arc
  // through the chest and up past upright.
  const forward = sweep < HALF ? hump(sweep / HALF) : 0;
  const back = sweep >= HALF ? hump((sweep - HALF) / HALF) : 0;
  pose.headTilt = (forward * NECK_SIDE_DROP + back * NECK_SIDE_BACK) * amount;
  pose.headTurn += Math.sin(angle) * NECK_SIDE_TURN * amount;
  pose.blink = Math.max(pose.blink, Math.sin(angle) * NECK_ROLL_EYES * amount);
  // No lift out of the knees edge-on: the profile stance is staggered, and
  // legs spread fore-and-aft cannot straighten as far as legs side by side.
  return pose;
}

/**
 * Edge-on the clench is the clearest of the gestures: the near forearm comes
 * up in front of his chest, the fist closes, and his head bows to look at it.
 */
const FIST_SIDE_ARM: ArmAngles = { upper: deg(28), fore: deg(168), foreScale: 1 };
const FIST_SIDE_BOW = deg(22);

export function fidgetFistSide(t: number): CarlPose {
  const pose = seamSide(t);
  const raised = plateau(t, FIST_RAISE_BEATS);
  const looking = plateau(t, FIST_LOOK_BEATS);
  const clench = plateau(t, FIST_CLENCH_BEATS);
  const turn = Math.sin(throughHold(t, FIST_CLENCH_BEATS) * TWO_PI);
  if (raised > 0) {
    const arm = { ...FIST_SIDE_ARM, fore: FIST_SIDE_ARM.fore + turn * FIST_TURN };
    setSolvedArm(pose, 'right', sideArmToward(SIDE_HANG.right, arm, raised, SIDE_CURL));
  }
  pose.rightFist = lerp(pose.rightFist, 1, clench);
  pose.headTilt = FIST_SIDE_BOW * looking;
  pose.gazeUp = FIST_LOOK_GAZE * looking;
  pose.brow = lerp(pose.brow, FIST_BROW, looking);
  return pose;
}

/**
 * Edge-on the knuckle crack is both forearms folded up until the hands meet
 * close in front of his chest, the near palm over the far fist, and a shove
 * of the elbows on the crack. The elbows ride back at his sides: with them
 * forward, a forearm passing level on its way up sticks out ahead of him and
 * reads as a reach.
 */
const KNUCKLES_SIDE_NEAR_ARM: ArmAngles = { upper: deg(-12), fore: deg(150), foreScale: 1 };
const KNUCKLES_SIDE_FAR_ARM: ArmAngles = { upper: deg(-15), fore: deg(145), foreScale: 1 };
const KNUCKLES_SIDE_BOW = deg(14);

const KNUCKLES_SIDE_RISE_EASE = 0.8;

export function fidgetKnucklesSide(t: number): CarlPose {
  const pose = seamSide(t);
  const together = plateau(t, KNUCKLES_BEATS);
  const crack = pulse(
    t,
    KNUCKLES_CRACK_AT - KNUCKLES_CRACK_WIDTH,
    KNUCKLES_CRACK_AT + KNUCKLES_CRACK_WIDTH,
  );
  if (together > 0) {
    // Edge-on the arms rise across the torso's own outline, so the steepest
    // part of the rise is what the silhouette shows most; leading the rise
    // spreads it over the first frames instead of spending it in one.
    const raise = together ** KNUCKLES_SIDE_RISE_EASE;
    const push = crack * KNUCKLES_CRACK_ELBOWS;
    const near = { ...KNUCKLES_SIDE_NEAR_ARM, upper: KNUCKLES_SIDE_NEAR_ARM.upper - push };
    const far = { ...KNUCKLES_SIDE_FAR_ARM, upper: KNUCKLES_SIDE_FAR_ARM.upper - push };
    setSolvedArm(pose, 'right', sideArmToward(SIDE_HANG.right, near, raise, SIDE_CURL));
    setSolvedArm(pose, 'left', sideArmToward(SIDE_HANG.left, far, raise, SIDE_CURL));
  }
  pose.leftFist = lerp(pose.leftFist, 1, together);
  pose.rightFist = lerp(pose.rightFist, KNUCKLES_PRESSING_FIST, together);
  pose.headTilt = KNUCKLES_SIDE_BOW * together;
  pose.brow = lerp(pose.brow, KNUCKLES_BROW, together) + crack * KNUCKLES_CRACK_BROW;
  pose.mouth = crack * KNUCKLES_CRACK_MOUTH;
  pose.mouthWidth = 1 + crack * KNUCKLES_CRACK_GRIMACE;
  return pose;
}

/**
 * Edge-on a look back over the shoulder turns the face round to the camera —
 * the one direction a profile head can turn — with the shoulders following
 * and the weight rocking onto the back foot.
 */
const GLANCE_SIDE_TURN = 1;
const GLANCE_SIDE_TWIST = 1;
const GLANCE_SIDE_LEAN = deg(-4);
const GLANCE_SIDE_SWAY = -0.02;

export function fidgetGlanceSide(t: number): CarlPose {
  const pose = seamSide(t);
  const head = plateau(t, GLANCE_HEAD_BEATS);
  const shoulders = plateau(t, GLANCE_SHOULDER_BEATS);
  pose.headTurn = lerp(pose.headTurn, GLANCE_SIDE_TURN, head);
  pose.headTilt = -GLANCE_SEARCH_TILT * throughHold(t, GLANCE_HEAD_BEATS) * head;
  pose.twist = GLANCE_SIDE_TWIST * shoulders;
  pose.lean += GLANCE_SIDE_LEAN * shoulders;
  pose.sway += GLANCE_SIDE_SWAY * shoulders;
  pose.brow = lerp(pose.brow, GLANCE_BROW, head);
  return pose;
}
