/**
 * Smush: "taking your bare foot, placing it on top of a living, conscious life,
 * and then pressing lovingly down." A stomp with a press — the knee chambers
 * high, hangs, the heel is driven down with the whole body dropping in behind
 * it, and the weight stays on it, grinding, before he steps back into guard.
 *
 * Two versions, each in all three views:
 *
 * - standing ({@link smushStanding}): the stamp and the press, planted.
 * - hopping ({@link smushHop}), for a Smush thrown on the run: he pushes off
 *   the rear foot, hops in along the way he is running with the knee
 *   chambered, lands the stamp, and runs out of it. The sprite is carried over
 *   the floor the whole time, so the legs are the run's own, sampled at the
 *   Smush's slower frame rate, everywhere but the hop.
 *
 * The blast Smush throws off is NOT painted here. It scales with the ability's
 * level-dependent radius, so it is drawn at runtime by `SmushEffectSystem`,
 * centred on the stamp point each row declares ({@link smushStampPoint}).
 */

import { PLAYER_SPEED } from '../../../core/constants';
import { mixPt, pt, rotate } from '../carl/geometry';
import { ANKLE_Y, LEG_ROOT_HALF, PROFILE_LATERAL, SHOULDER_Y } from '../carl/proportions';
import {
  type BodySide,
  buildSkeleton,
  type CarlPose,
  type CarlView,
  FULL_UPPER_ARM,
  HEAD_ON_FLOOR_FORESHORTENING,
  restingPose,
  VIEWS,
} from '../carl/rig';
import { deg, lerp, type Pt } from '../carlArt';
import {
  ankleOverPivot,
  bisect,
  profileFootTarget,
  sideOfSign,
  sideSign,
  soleOffsets,
  wrapPhase,
} from './gaitShared';
import { guardBack, guardFront, guardSide } from './idles';
import {
  type GaitFoot,
  placeFoot,
  RUN_FOOT_SPREAD,
  RUN_GROUND_PER_CYCLE_PX,
  RUN_TOE_OFF_PHASE,
  runFacing,
  runFoot,
  runSide,
} from './locomotion';
import { SMUSH_DURATION_TICKS, SMUSH_FRAMES, SMUSH_IMPACT_FRAME } from './timing';
import { type BlowLeg, blowLeg, legPhase } from './travelling';

/** The last frame of a Smush row, which hands back to the guard (standing) or the run (hopping). */
const LAST_FRAME = SMUSH_FRAMES - 1;
/**
 * Frames the stamping foot is held on the floor from the stamp: the stamp, the
 * press and the grind standing; the stamp and one frame of press on the hop,
 * after which the foot is a stride behind him and has to come up.
 */
export const SMUSH_PRESS_FRAMES = 3;
export const SMUSH_HOP_PRESS_FRAMES = 2;

// ── Where the heel lands ─────────────────────────────────────────────────────

/**
 * The standing stamp comes down where the stamping foot stood in guard — the
 * lead foot in profile, the right head-on. The weight goes over it for the
 * press, and the recovery is then a straight rise back into guard rather than
 * a second step, which reads as a skip. Guard stands inside his own tile: the
 * heel lands within about five in-game pixels of the centre the damage is
 * measured from, against a blast several tiles across.
 */
const SIDE_STAMP_ANKLE_X = guardSide(0).leftFoot.x;
const FACING_STAMP_ANKLE_X = guardFront(0).rightFoot.x;
/**
 * The hop lands the stamp with its ankle square under the pelvis. The run would
 * put the foot down well ahead of him; on the hop the art comes to the point
 * the blast is centred on, never the other way round.
 */
const HOP_STAMP_ANKLE_AHEAD = 0;

/**
 * Where the stamping heel lands on the impact frame, in figure units from the
 * pose's ground origin as the view paints it: `x` across the screen (the
 * ankle), `y` down it to the floor under the foot — which head-on is not the
 * ground line, because a head-on hop is drawn with the figure carried up the
 * cell and the foot some way ahead of or behind the hips.
 *
 * Built from the choreography's constants rather than from the painted pose,
 * so `scripts/gates-human.ts` re-measuring the pose against it is a real check.
 */
export function smushStampPoint(view: CarlView, hop: boolean, stampSide: BodySide = 'right'): Pt {
  const authored = authoredStampPoint(view, hop, stampSide);
  // The choreography is authored with his right side toward +X; a mirrored
  // view paints it reflected, and the blast has to follow the heel it paints.
  return VIEWS[view].mirrored ? pt(-authored.x, authored.y) : authored;
}

function authoredStampPoint(view: CarlView, hop: boolean, stampSide: BodySide): Pt {
  if (!hop) {
    if (view === 'side') return pt(SIDE_STAMP_ANKLE_X, 0);
    // Head-on the standing stamp lands on the hips' own ground line, so the
    // floor under it is the ground line itself.
    return pt(FACING_STAMP_ANKLE_X, 0);
  }
  if (view === 'side') return pt(HOP_STAMP_ANKLE_AHEAD, 0);
  const hopAhead = HOP_STAMP_ANKLE_AHEAD + soleMidAhead(HOP_STAMP_PITCH);
  return pt(
    sideSign(stampSide) * RUN_FOOT_SPREAD,
    aheadSign(view) * hopAhead * HEAD_ON_FLOOR_FORESHORTENING,
  );
}

/** Which way ahead of him runs down the screen head-on: toward the camera in front, away behind. */
function aheadSign(view: CarlView): number {
  return view === 'back' ? -1 : 1;
}

/**
 * How far the middle of a sole at `pitch` stands ahead of its ankle: head-on
 * the floor under the foot is drawn there, a stride of depth down the screen.
 */
function soleMidAhead(pitch: number): number {
  const sole = soleOffsets(pitch);
  return (sole.heel.x + sole.toe.x) / 2;
}

// ── Standing ─────────────────────────────────────────────────────────────────

/**
 * One frame of the standing Smush, in the terms every view shares. The row is
 * short enough — nine frames — that the beats are keyed one per frame rather
 * than sampled off a curve: each frame is a pose worth drawing on its own.
 */
interface StompBeat {
  /** Stamping sole's height off the floor. */
  readonly lift: number;
  /** Profile: the stamping ankle ahead of the hips. Head-on the chamber hangs under the hip instead. */
  readonly footX: number;
  /** Stamping foot pitch; negative pulls the toes up so the heel leads. */
  readonly pitch: number;
  readonly crouch: number;
  /**
   * How far he rises onto the ball of the support foot, lifting the whole
   * body: the only way a man on one planted leg can get higher.
   */
  readonly rise: number;
  /** Profile torso lean; positive folds him forward over the stamp. */
  readonly lean: number;
  /** Hips toward the stamping foot (+) or the support foot (−), as a share of the stance. */
  readonly weight: number;
  /** Shoulders turned into the grind and back. */
  readonly twist: number;
  /**
   * 1 fists raised for balance, 0 in guard, −1 pressing: one fist driven
   * down beside the stamping knee and the other in guard.
   */
  readonly arms: number;
  /** Chin tucked to look down at what is under the foot, −1 to 1. */
  readonly chin: number;
  readonly mouth: number;
}

/**
 * The stamping foot's guard position is where the beats start and end, so the
 * first and last keys name it by this sentinel and {@link standingFootX} swaps
 * in the guard's own number for the view.
 */
const GUARD_FOOT = Number.NaN;

/**
 * Frame by frame:
 *
 * 0. The weight rocks onto the support foot and the stamping heel peels up;
 *    the knees give a little — the counter-move before a lift.
 * 1. The knee drives up in front, the arms rise for balance.
 * 2. The hang: knee at its highest, toes pulled back so the heel leads, up on
 *    the ball of the support foot, the torso arched a touch behind it and the
 *    fists up at the brow.
 * 3. The stamp: the heel driven flat onto the floor and the body dropped
 *    with it, the other foot already coming off, one fist driven down — the
 *    lowest pose lands on the contact, or the power reads as coming after it.
 * 4. The press: the weight over the stamping foot and the other foot off the
 *    floor, one fist driven down beside the stamping knee and the other up at
 *    the jaw, the head down over the foot, the shoulders turning into the
 *    grind.
 * 5. The grind back the other way, still pressing.
 * 6. He rises out of the press on both feet, the fists coming up.
 * 7. Nearly in guard.
 * 8. The guard's own first frame.
 *
 * Matched against Muybridge's standing high-jump plate (the arms thrown up
 * over a single-leg rise) and the running kick plate's chambered knee.
 */
const STOMP_BEATS: readonly StompBeat[] = [
  {
    lift: 0,
    footX: GUARD_FOOT,
    pitch: deg(38),
    crouch: 0.2,
    rise: 0,
    lean: deg(4),
    weight: -0.8,
    twist: 0.1,
    arms: 0.25,
    chin: -0.3,
    mouth: 0,
  },
  {
    lift: 0.5,
    footX: 0.14,
    pitch: deg(-6),
    crouch: 0.06,
    rise: 0.02,
    lean: deg(-4),
    weight: -1,
    twist: 0.15,
    arms: 0.8,
    chin: 0.1,
    mouth: 0.15,
  },
  {
    lift: 0.9,
    footX: 0.18,
    pitch: deg(-26),
    crouch: 0.04,
    rise: 0.045,
    lean: deg(-8),
    weight: -1,
    twist: 0.2,
    arms: 1,
    chin: 0.05,
    mouth: 0.35,
  },
  {
    lift: 0,
    footX: 0,
    pitch: 0,
    crouch: 0.8,
    rise: 0,
    lean: deg(8),
    weight: 0.1,
    twist: 0,
    arms: -1,
    chin: -0.3,
    mouth: 0.5,
  },
  {
    lift: 0,
    footX: 0,
    pitch: 0,
    crouch: 0.86,
    rise: 0,
    lean: deg(7),
    weight: 0.8,
    twist: -0.45,
    arms: -1,
    chin: -0.55,
    mouth: 0.4,
  },
  {
    lift: 0,
    footX: 0,
    pitch: 0,
    crouch: 0.78,
    rise: 0,
    lean: deg(7),
    weight: 0.65,
    twist: 0.35,
    arms: -1,
    chin: -0.5,
    mouth: 0.35,
  },
  {
    lift: 0,
    footX: 1,
    pitch: 0,
    crouch: 0.45,
    rise: 0,
    lean: deg(14),
    weight: -0.1,
    twist: 0.05,
    arms: -0.1,
    chin: -0.4,
    mouth: 0.2,
  },
  {
    lift: 0,
    footX: GUARD_FOOT,
    pitch: 0,
    crouch: 0.2,
    rise: 0,
    lean: deg(6),
    weight: 0,
    twist: 0,
    arms: -0.05,
    chin: -0.3,
    mouth: 0,
  },
  {
    lift: 0,
    footX: GUARD_FOOT,
    pitch: 0,
    crouch: 0,
    rise: 0,
    lean: 0,
    weight: 0,
    twist: 0,
    arms: 0,
    chin: 0,
    mouth: 0,
  },
];

/**
 * Head-on he stamps with his right. In profile he stamps with the lead (far)
 * leg: the weight rocks back onto the rear foot, the lead knee comes up in
 * front of him, and the heel goes down ahead of his hips, leaving the rear leg
 * braced out behind — the silhouette that reads as a stamp rather than as a
 * squat. Stamped with the rear leg instead, the foot comes down between the
 * two and the press is a man crouching with his feet together.
 */
function stampSideOf(view: CarlView): BodySide {
  return view === 'side' ? 'left' : 'right';
}

/** The guard each view hands back to, and where its feet and fists are. */
interface GuardStance {
  readonly pose: CarlPose;
  readonly stampSide: BodySide;
  /** The stamping foot's target and pitch in guard. */
  readonly stampFoot: Pt;
  readonly stampPitch: number;
  /** The support foot's target and pitch in guard; it never leaves the floor. */
  readonly supportFoot: Pt;
  readonly supportPitch: number;
  readonly leftWrist: Pt;
  readonly rightWrist: Pt;
  readonly leftUpperArmScale: number;
  readonly rightUpperArmScale: number;
}

function guardStance(view: CarlView): GuardStance {
  const pose = view === 'side' ? guardSide(0) : view === 'back' ? guardBack(0) : guardFront(0);
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const stampSide = stampSideOf(view);
  const left = { foot: pose.leftFoot, pitch: pose.leftFootPitch };
  const right = { foot: pose.rightFoot, pitch: pose.rightFootPitch };
  const stamp = stampSide === 'left' ? left : right;
  const support = stampSide === 'left' ? right : left;
  return {
    pose,
    stampSide,
    stampFoot: stamp.foot,
    stampPitch: stamp.pitch,
    supportFoot: support.foot,
    supportPitch: support.pitch,
    leftWrist: skeleton.leftArm.end,
    rightWrist: skeleton.rightArm.end,
    leftUpperArmScale: pose.leftUpperArmScale ?? FULL_UPPER_ARM,
    rightUpperArmScale: pose.rightUpperArmScale ?? FULL_UPPER_ARM,
  };
}

const GUARDS: Readonly<Record<CarlView, GuardStance>> = {
  front: guardStance('front'),
  side: guardStance('side'),
  back: guardStance('back'),
};

/**
 * In profile the chambered foot hangs under the knee, a little behind the point
 * it will land on, so the heel comes down and forward onto it. Ahead of the
 * knee the shin reaches out like a kick; the running-kick plate's standing
 * frame hangs it straight down.
 */
const SIDE_CHAMBER_BACK = -1.2;

/** Where the stamping ankle is on a beat, sideways from the hips. */
function standingFootX(beat: StompBeat, view: CarlView, frame: number): number {
  const guard = GUARDS[view].stampFoot.x;
  if (Number.isNaN(beat.footX)) return guard;
  const stamp = view === 'side' ? SIDE_STAMP_ANKLE_X : FACING_STAMP_ANKLE_X;
  // Before the stamp a beat's footX is measured from the stamp point; after it,
  // footX is the share of the way back to guard the foot has stepped.
  if (frame > SMUSH_IMPACT_FRAME) return lerp(stamp, guard, beat.footX);
  // Head-on the chamber is placed by `facingChamberFootX`, under the hip.
  if (view !== 'side') return stamp;
  return stamp + beat.footX * SIDE_CHAMBER_BACK;
}
/**
 * Head-on the chambered foot hangs straight under its own hip joint. The knee
 * breaks forward off the hip→ankle line, so a foot carried out to the side
 * throws the knee in across the body and the thigh reads as swung sideways —
 * a side kick, or a dog at a post.
 */
function facingChamberFootX(pose: CarlPose): number {
  return pose.sway + LEG_ROOT_HALF;
}

/**
 * The rest of the head-on chamber is forward, toward the way he faces: the
 * knee comes up over the hip and the shin hangs under it, ahead of the body,
 * far enough ahead that the knee is painted over the shorts.
 */
const FACING_CHAMBER_AHEAD = 0.45;
/**
 * Head-on the chamber lifts the foot this share of the beat's lift. A foot
 * raised to hip height with the knee ahead of it leaves the hip→ankle line
 * pointing almost at the camera, and a knee solved off that line has no
 * forward to break into and swings out sideways instead.
 */
const FACING_CHAMBER_LIFT_SHARE = 0.72;
/**
 * Head-on, the torso pitched over the stamp toward the camera, per frame: the
 * chest and head driven down over the foot. Squatting straight down with the
 * back upright, the same legs read as a man sitting onto a stool.
 */
const FACING_PRESS_PITCH: readonly number[] = [0, 0, -0.05, 0.4, 0.45, 0.4, 0.2, 0.06, 0];
/**
 * From the stamp on, head-on, the hips sink this share of the beat's crouch:
 * enough to bend the loaded leg and bring the shoulders down within reach of
 * its knee, while the other leg comes off the floor. Sunk the full depth with
 * both feet down, the legs fold alike and the body reads as a squat.
 */
const PRESS_CROUCH_SHARE = 0.4;
/**
 * In profile the press sinks nearly the full depth: edge-on the drop reads as
 * the lead knee bending forward over the stamp, and it brings that knee under
 * the near hand. Shallow, with the rear leg long behind, it is a lunge —
 * pushing forward rather than bearing down.
 */
const PROFILE_PRESS_CROUCH_SHARE = 0.9;
/**
 * Before the stamp, head-on, the hips sink this share of the beat's crouch:
 * the drop into the counter-move is carried by the chest pitching over the
 * foot instead, and sunk the full depth with the back upright a head-on body
 * reads as a sumo squat. In profile the counter-move sinks in full.
 */
const FACING_CHAMBER_CROUCH_SHARE = 0.6;

/** The share of a beat's crouch the hips sink on `step` in `view`. */
function crouchShare(step: number, view: CarlView): number {
  if (step >= SMUSH_IMPACT_FRAME) {
    return view === 'side' ? PROFILE_PRESS_CROUCH_SHARE : PRESS_CROUCH_SHARE;
  }
  return view === 'side' ? 1 : FACING_CHAMBER_CROUCH_SHARE;
}
/** The raised shin is the near-camera part of a head-on chamber. */
const FACING_CHAMBER_NEARNESS = 0.8;
/** How near the camera the loaded shin draws at the full weight of the press. */
const FACING_PRESS_NEARNESS = 0.7;

/**
 * Hand targets. Raised for balance the fists come up past the chin, no wider
 * than the shoulders — a trained fighter's arms, not a startled man's thrown
 * out wide, nor a flex beside the head. Driven down through the press a fist
 * keeps its elbow bent: hung straight beside the leg the arm reads as gone
 * limp.
 */
const PROFILE_BALANCE_LEAD: Pt = pt(0.36, SHOULDER_Y - 0.26);
/** How far the rear heel comes up off the floor at the full weight of the press. */
const PROFILE_PRESS_HEEL_LIFT = deg(35);
/**
 * Head-on the fists rise out of his guard rather than to a point of their own:
 * a little higher and a little wider, forearms still upright either side of
 * the chin. Anywhere higher or further in the forearms cross over the chest.
 */
const FACING_BALANCE_LIFT: Pt = pt(0.05, -0.06);
/** Head-on, how far the torso tips toward the stamping foot at the full weight of the press. */
const FACING_PRESS_LEAN = 0.25;
/**
 * How far the support foot is drawn out to the side on each frame of the
 * standing Smush, in tile units: out on the press and the grind, halfway back
 * as he rises, home by the guard.
 */
const FACING_SUPPORT_SLIDE: readonly number[] = [0, 0, 0, 0.08, 0.18, 0.16, 0.05, 0, 0];
/** The same for the rear foot in profile, drawn back behind him. */
const PROFILE_SUPPORT_SLIDE: readonly number[] = [0, 0, 0, 0.03, 0.06, 0.06, 0.03, 0, 0];
/**
 * Through the press the other foot comes off the floor altogether: the whole
 * of him is on the stamp. With both feet down the same body reads as a squat
 * or a lunge whatever the hips do.
 */
const SUPPORT_LIFT: readonly number[] = [0, 0, 0, 0.1, 0.3, 0.27, 0.05, 0, 0];
/** Head-on the lifted foot hangs pointed, toes down, as it comes off the floor. */
const SUPPORT_POINT: readonly number[] = [0, 0, 0, 0.1, 0.15, 0.15, 0.1, 0, 0];
/**
 * Edge-on the rear foot barely leaves the floor behind him, toes trailing: it
 * bears nothing. Swung up high behind a body going forward, it reads as the
 * back foot kicked up by a stumble.
 */
const PROFILE_SUPPORT_LIFT: readonly number[] = [0, 0, 0, 0.03, 0.08, 0.07, 0.02, 0, 0];
/** The lifted foot hangs toes down, as a foot does with no weight on it. */
const LIFTED_FOOT_PITCH = deg(45);

/**
 * Head-on, how much of the loaded leg's column is kept through the press: the
 * rest goes to the knee breaking out over the foot, which is what shows that
 * leg bent under the weight while the other hangs straight and light.
 */
const PRESS_LOADED_COLUMN = 0.55;
/**
 * Pressing, one fist is driven down beside the stamping knee — just outside
 * it, the arm nearly straight — and the other stays up in guard at the jaw:
 * one bearing down through the loaded leg, one still a fighter's. The driven
 * fist goes outside the knee, never onto the thigh, and the guard fist is
 * held a little out from the chin. Every other placement tried reads, at the
 * tile, as a stock gesture of its own: on the thigh or the knee a hand to the
 * crotch (and with a squat, a man relieving himself), bent at the hip a hand
 * on the hip, driven straight down past both thighs an ape, both thrown out
 * for balance "ta-da", one out level a clothesline, across the body arms
 * folded, one raised overhead a wave or a man hailing a cab, both held in
 * guard at the chin hands pressed together in prayer.
 */
const DRIVEN_FIST_BESIDE_KNEE: Pt = pt(0.3, -0.04);
/** Edge-on the driven fist comes down in front of the lead knee instead. */
const PROFILE_DRIVEN_FIST_BESIDE_KNEE: Pt = pt(0.1, -0.04);
/** How far out from its standing guard the guard fist is held head-on. */
const PRESS_GUARD_SPREAD = 0.06;
/** Edge-on, how far the head tips down to look at the foot, per unit of tucked chin. */
const PROFILE_PRESS_HEAD_DROP = 0.9;
/**
 * Pressing, the mouth is a flat grimace of bared teeth rather than a shout:
 * wide open over a bowed head it reads as a gasp.
 */
const PRESS_MOUTH_WIDTH = 1.4;

/** Where the hands start from: the guard standing, the run's own swing on the hop. */
interface Wrists {
  readonly leftWrist: Pt;
  readonly rightWrist: Pt;
  /** The share of each upper arm drawn there; absent is the whole arm. */
  readonly leftUpperArmScale?: number;
  readonly rightUpperArmScale?: number;
}

function upperArmScaleOf(wrists: Wrists, side: BodySide): number {
  return (side === 'left' ? wrists.leftUpperArmScale : wrists.rightUpperArmScale) ?? FULL_UPPER_ARM;
}

/** Where a view's guard holds a fist, from its own shoulder. */
function guardFistFromShoulder(view: CarlView, side: BodySide): Pt {
  const skeleton = buildSkeleton(GUARDS[view].pose, VIEWS[view]);
  const arm = side === 'left' ? skeleton.leftArm : skeleton.rightArm;
  const shoulder = side === 'left' ? skeleton.leftShoulder : skeleton.rightShoulder;
  return pt(arm.end.x - shoulder.x, arm.end.y - shoulder.y);
}

/**
 * Hands for the press, `share` of the way from where they were: the fist on
 * `drivenSide` driven down beside the stamping knee, the other held in the
 * view's guard where its own shoulder now is.
 */
function pressHands(
  pose: CarlPose,
  view: CarlView,
  stampSide: BodySide,
  drivenSide: BodySide,
  from: Wrists,
  share: number,
): void {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const knee = stampSide === 'right' ? skeleton.rightLeg.joint : skeleton.leftLeg.joint;
  const profile = view === 'side';
  // Head-on "out" is away from his centreline; edge-on it is forward.
  const out = profile || stampSide === 'right' ? 1 : -1;
  const besideKnee = profile ? PROFILE_DRIVEN_FIST_BESIDE_KNEE : DRIVEN_FIST_BESIDE_KNEE;
  const driven = pt(knee.x + out * besideKnee.x, knee.y + besideKnee.y);
  const guardSide: BodySide = drivenSide === 'right' ? 'left' : 'right';
  const shoulder = guardSide === 'left' ? skeleton.leftShoulder : skeleton.rightShoulder;
  const fist = guardFistFromShoulder(view, guardSide);
  const spread = profile ? 0 : (guardSide === 'left' ? -1 : 1) * PRESS_GUARD_SPREAD;
  const guarded = pt(shoulder.x + fist.x + spread, shoulder.y + fist.y);
  // A fist driven down to the knee reaches along the picture plane: the whole upper arm shows.
  const drivenScale = lerp(upperArmScaleOf(from, drivenSide), FULL_UPPER_ARM, share);
  const guardedScale = lerp(
    upperArmScaleOf(from, guardSide),
    upperArmScaleOf(GUARDS[view], guardSide),
    share,
  );
  if (drivenSide === 'right') {
    pose.rightHand = mixPt(from.rightWrist, driven, share);
    pose.leftHand = mixPt(from.leftWrist, guarded, share);
    pose.rightUpperArmScale = drivenScale;
    pose.leftUpperArmScale = guardedScale;
  } else {
    pose.leftHand = mixPt(from.leftWrist, driven, share);
    pose.rightHand = mixPt(from.rightWrist, guarded, share);
    pose.leftUpperArmScale = drivenScale;
    pose.rightUpperArmScale = guardedScale;
  }
  pose.leftArmAngles = null;
  pose.rightArmAngles = null;
}

/**
 * A hand `raise` of the way from guard (0) to raised (1). The raised target is
 * authored against a standing body and carried with the shoulders: a crouch
 * and a fold forward move the shoulders a long way, and a fist left where a
 * standing man would hold it ends up buried in his chest.
 */
function handAt(guard: Pt, raised: Pt, raise: number, carry: Pt): Pt {
  return mixPt(guard, pt(raised.x + carry.x, raised.y + carry.y), raise);
}

const REST_SHOULDERS = buildSkeleton(restingPose(), VIEWS.front).shoulderCentre;

/** How far a pose's shoulders stand from where a standing body carries them. */
function shoulderCarry(pose: CarlPose, view: CarlView): Pt {
  const shoulders = buildSkeleton(pose, VIEWS[view]).shoulderCentre;
  return pt(shoulders.x - REST_SHOULDERS.x, shoulders.y - REST_SHOULDERS.y);
}

/**
 * How much of the way over the loaded foot the hips carry, head-on. Past about
 * half the hip joint ends up outboard of the foot and the loaded shin slants
 * in under it, knock-kneed; the torso's lean carries the rest of him over.
 */
const WEIGHT_SHIFT_SHARE = 0.55;
/**
 * Rocking back onto the support foot for the chamber the hips go only halfway
 * over it: the stamping leg is still on the floor, and a leg left reaching
 * that far across would lock straight.
 */
const CHAMBER_WEIGHT_SHIFT_SHARE = 0.5;
/**
 * In profile the hips go right over the stamp and the torso stays upright on
 * top of them: every pound of him is on that foot. Folded forward over the
 * lead knee with the hips short of it, the same legs read as a man pitching
 * over his own foot — a trip, not a press.
 */
const PROFILE_WEIGHT_SHIFT_SHARE = 0.95;
/** Head-on, a tucked chin is the whole of the torso's fold: a lean there tips him sideways. */
const FACING_CRUNCH_CHIN = 1;
/** How much lower the loaded hip sits in a full crouch, in tile units. */
const LOADED_HIP_DROP = 0.16;
/** How much of a head-on leg's column a full crouch gives up to the knee breaking outward. */
const SQUAT_KNEE_SPLAY = 0.5;
/** How far the jacket hem swings out as the arms go up, and as he drops onto the stamp. */
const JACKET_FLARE_RAISED = 0.5;
const JACKET_FLARE_DRIVEN = 0.3;
/** Elbows bowed out from the ribs while the fists are away from the guard. */
const PROFILE_STOMP_ELBOW_FLARE = 0.8;
/**
 * Head-on the raised fists come up inboard of the shoulders, where this sign
 * drops the elbows down along the ribs; the other sign folds them out and up
 * into a flex beside the head.
 */
const FACING_STOMP_ELBOW_FLARE = 0.6;

/** The ankle a profile foot target stands its ankle at, for a foot at `pitch`. */
function profileAnkleOf(target: Pt, pitch: number): Pt {
  const lifted = rotate(pt(0, ANKLE_Y), -pitch);
  return pt(target.x + lifted.x, target.y + lifted.y);
}

/** The chamber's highest lift, which the head-on forward reach scales against. */
const CHAMBER_APEX_LIFT = Math.max(...STOMP_BEATS.map((beat) => beat.lift));

/** A flat foot's ankle height, the height a lifted sole is measured up from. */
const FLAT_ANKLE_Y = ankleOverPivot(0, 'toe', 0).y;

/**
 * A profile foot target rolled about its own toe from one pitch to another,
 * the toe set down on the floor. A foot target pitched in place does not keep
 * its toe on the floor on its own: the guard's rear foot, up on its ball,
 * stands with its toe a couple of pixels under the ground line, and rolling
 * about that point would carry the error into every frame of the stamp.
 */
function rolledAboutToe(target: Pt, fromPitch: number, toPitch: number): Pt {
  const ankle = profileAnkleOf(target, fromPitch);
  const toeX = ankle.x + soleOffsets(fromPitch).toe.x;
  return profileFootTarget(ankleOverPivot(toeX, 'toe', toPitch), toPitch);
}

/**
 * The stamping foot's profile target on a beat. A planted beat with the heel
 * up rolls about the toe of the guard foot, so the peel off the floor and the
 * roll back onto it leave the toe where it stood.
 */
function profileStampFoot(beat: StompBeat, footX: number, guard: GuardStance): Pt {
  if (beat.lift === 0 && beat.pitch > 0) {
    return rolledAboutToe(guard.stampFoot, guard.stampPitch, beat.pitch);
  }
  return profileFootTarget(pt(footX, FLAT_ANKLE_Y - beat.lift), beat.pitch);
}

/** Past this a foot is on its toes rather than the ball of the foot. */
const MAX_RISE_PITCH = deg(45);

/** The pitch, rolled about the toe, that lifts a flat foot's ankle by `rise`. */
function pitchForRise(rise: number): number {
  const liftAt = (pitch: number): number => FLAT_ANKLE_Y - ankleOverPivot(0, 'toe', pitch).y;
  return bisect(0, MAX_RISE_PITCH, (pitch) => liftAt(pitch) < rise);
}

/**
 * The support foot through the stamp. In a profile guard it is up on its
 * ball; under the chamber it rolls down flat, then up onto the ball again as
 * he rises into the hang, and back into guard — always about the toe, so the
 * toe never moves on the floor. Through the press it is lifted off the floor
 * behind him (see {@link PROFILE_SUPPORT_LIFT}).
 */
function profileSupportFoot(
  frame: number,
  rise: number,
  weight: number,
  guard: GuardStance,
): { foot: Pt; pitch: number } {
  const inGuard = frame >= LAST_FRAME - 1;
  const pressed = frame > SMUSH_IMPACT_FRAME ? Math.max(0, weight) * PROFILE_PRESS_HEEL_LIFT : 0;
  const pitch = inGuard ? guard.supportPitch : Math.max(pitchForRise(rise), pressed);
  return { foot: rolledAboutToe(guard.supportFoot, guard.supportPitch, pitch), pitch };
}

function supportSideOf(guard: GuardStance): BodySide {
  return guard.stampSide === 'left' ? 'right' : 'left';
}

function setFoot(pose: CarlPose, side: BodySide, foot: Pt, pitch: number): void {
  if (side === 'left') {
    pose.leftFoot = foot;
    pose.leftFootPitch = pitch;
  } else {
    pose.rightFoot = foot;
    pose.rightFootPitch = pitch;
  }
}

/**
 * The standing Smush at `frame` (0 to {@link LAST_FRAME}) in `view`. The last
 * frame is the view's guard, which the animator hands over to when the row
 * ends.
 */
export function smushStanding(frame: number, view: CarlView): CarlPose {
  const step = Math.min(Math.max(Math.round(frame), 0), LAST_FRAME);
  const guard = GUARDS[view];
  if (step === LAST_FRAME) {
    // The guard itself, with its support foot's toe on the floor where the
    // stamp stood it rather than where the guard sinks it.
    const settled: CarlPose = { ...guard.pose };
    if (view === 'side') {
      const support = rolledAboutToe(guard.supportFoot, guard.supportPitch, guard.supportPitch);
      setFoot(settled, supportSideOf(guard), support, guard.supportPitch);
    }
    return settled;
  }
  const beat = STOMP_BEATS[step];

  const pose = restingPose();
  pose.crouch = beat.crouch * crouchShare(step, view);
  pose.bob = -beat.rise;
  pose.twist = beat.twist;
  pose.brow = 1;
  pose.mouth = beat.mouth;
  if (beat.arms < 0) pose.mouthWidth = PRESS_MOUTH_WIDTH;
  pose.chinLift = beat.chin * (view === 'side' ? 1 : FACING_CRUNCH_CHIN);
  pose.rightFist = 1;
  pose.leftFist = 1;
  pose.jacketFlare =
    Math.max(0, beat.arms) * JACKET_FLARE_RAISED + Math.max(0, -beat.arms) * JACKET_FLARE_DRIVEN;

  const stampX = standingFootX(beat, view, step);
  const supportSide = supportSideOf(guard);
  const supportX = guard.supportFoot.x;
  const pressShare = view === 'side' ? PROFILE_WEIGHT_SHIFT_SHARE : WEIGHT_SHIFT_SHARE;
  const shiftShare = beat.weight > 0 ? pressShare : CHAMBER_WEIGHT_SHIFT_SHARE;
  const hipsOver = lerp(supportX, stampX, (beat.weight + 1) / 2) * shiftShare;
  pose.leftKneeBreak = 1;
  pose.rightKneeBreak = 1;

  if (view === 'side') {
    pose.lean = beat.lean;
    // The rig carries a profile hip only `PROFILE_LATERAL` of its sway.
    pose.sway = hipsOver / PROFILE_LATERAL;
    pose.headTurn = guard.pose.headTurn;
    const support = profileSupportFoot(step, beat.rise, beat.weight, guard);
    // Unweighted, the rear foot is drawn back along the floor on its toes as
    // the body goes forward over the stamp, so the rear leg straightens out
    // behind. It bears nothing while it moves.
    const slide = PROFILE_SUPPORT_SLIDE[step];
    const lift = PROFILE_SUPPORT_LIFT[step];
    if (lift > 0) {
      const ankleX = profileAnkleOf(support.foot, support.pitch).x - slide;
      const target = profileFootTarget(pt(ankleX, FLAT_ANKLE_Y - lift), LIFTED_FOOT_PITCH);
      setFoot(pose, supportSide, target, LIFTED_FOOT_PITCH);
    } else {
      setFoot(pose, supportSide, pt(support.foot.x - slide, support.foot.y), support.pitch);
    }
    if (slide > 0 || lift > 0) pose.rightFootPlanted = false;
    setFoot(pose, guard.stampSide, profileStampFoot(beat, stampX, guard), beat.pitch);
    const carry = shoulderCarry(pose, view);
    if (beat.arms >= 0) {
      pose.leftHand = handAt(guard.leftWrist, PROFILE_BALANCE_LEAD, beat.arms, carry);
      // Edge-on the near arm is painted over the head, so raised anywhere
      // above the chin it lies across the face and leaves only the hair: the
      // back of his head. The rear fist stays in guard and rides with the
      // shoulders.
      pose.rightHand = handAt(guard.rightWrist, guard.rightWrist, beat.arms, carry);
    } else {
      // Edge-on the near arm is the one seen whole, so it is the one bearing
      // down on the lead knee.
      // Edge-on the near arm is the one seen whole, so it is the one driven.
      pressHands(pose, view, guard.stampSide, 'right', guard, -beat.arms);
      pose.headTilt = Math.max(0, -beat.chin) * PROFILE_PRESS_HEAD_DROP;
    }
    pose.elbowFlare = beat.arms < 0 ? guard.pose.elbowFlare : PROFILE_STOMP_ELBOW_FLARE;
    return pose;
  }
  const raised = beat.lift > 0;
  pose.sway = hipsOver;
  // The hip over the loaded leg sits lower, so the leg taking the weight is the
  // one that bends: head-on that is the only thing that says which foot the
  // press is on.
  pose.pelvisDrop = -beat.weight * Math.max(0, beat.crouch) * LOADED_HIP_DROP;
  // No rise head-on: the support foot rising onto its ball there would lift
  // the whole figure off the floor it is about to stamp.
  pose.bob = 0;
  pose.leftFoot = guard.supportFoot;
  pose.leftFootPitch = guard.supportPitch;
  pose.rightFoot = pt(
    raised ? facingChamberFootX(pose) : stampX,
    -beat.lift * FACING_CHAMBER_LIFT_SHARE,
  );
  pose.rightFootPitch = raised ? beat.pitch : 0;
  if (raised) pose.rightFootDepth = FACING_CHAMBER_AHEAD * (beat.lift / CHAMBER_APEX_LIFT);
  pose.torsoPitch = FACING_PRESS_PITCH[step];
  const loaded = Math.max(0, beat.weight);
  // A deep head-on squat splays the knees out over the toes; straight columns
  // there read as a man standing with his hands on his hips. Once the weight
  // is on the stamp the support leg straightens out to the side instead: one
  // leg bent under him and one reaching out light is what says the whole of
  // him is on one foot.
  const squatColumn = 1 - Math.min(1, beat.crouch) * SQUAT_KNEE_SPLAY;
  pose.leftForeshorten = lerp(squatColumn, 1, loaded);
  // The loaded knee breaks out over the foot while the other leg straightens:
  // both splayed alike read as a man sitting down onto a stool.
  const loadedColumn = lerp(squatColumn, PRESS_LOADED_COLUMN, loaded);
  pose.rightForeshorten = raised ? 0 : loadedColumn;
  // Pressing, the loaded knee is driven forward at the camera over the foot:
  // its shin draws as the nearer, wider leg.
  pose.rightLegNearness = raised ? FACING_CHAMBER_NEARNESS : loaded * FACING_PRESS_NEARNESS;
  // The torso tips over the stamping foot as the hips go over it.
  pose.lean = loaded * FACING_PRESS_LEAN;
  const slide = FACING_SUPPORT_SLIDE[step];
  if (slide > 0) {
    // Unweighted, the support foot swings out and comes off the floor, toes
    // down, as the body drops over the other one.
    pose.leftFoot = pt(guard.supportFoot.x - slide, guard.supportFoot.y - SUPPORT_LIFT[step]);
    pose.leftFootPoint = SUPPORT_POINT[step];
    pose.leftFootPlanted = false;
  }
  const carry = shoulderCarry(pose, view);
  const raisedRight = pt(
    guard.rightWrist.x + FACING_BALANCE_LIFT.x,
    guard.rightWrist.y + FACING_BALANCE_LIFT.y,
  );
  const raisedLeft = pt(
    guard.leftWrist.x - FACING_BALANCE_LIFT.x,
    guard.leftWrist.y + FACING_BALANCE_LIFT.y,
  );
  if (beat.arms >= 0) {
    pose.rightHand = handAt(guard.rightWrist, raisedRight, beat.arms, carry);
    pose.leftHand = handAt(guard.leftWrist, raisedLeft, beat.arms, carry);
    // Raised out of the guard the fists stay up by the jaw, the upper arms
    // still driven toward the camera as the guard holds them.
    pose.rightUpperArmScale = guard.rightUpperArmScale;
    pose.leftUpperArmScale = guard.leftUpperArmScale;
    pose.elbowFlare = FACING_STOMP_ELBOW_FLARE;
    pose.leftArmBehind = guard.pose.leftArmBehind;
    pose.rightArmBehind = guard.pose.rightArmBehind;
  } else {
    pose.leftArmBehind = guard.pose.leftArmBehind;
    pose.rightArmBehind = guard.pose.rightArmBehind;
    pressHands(pose, view, 'right', 'right', guard, -beat.arms);
    pose.elbowFlare = guard.pose.elbowFlare;
  }
  return pose;
}

// ── Hopping ──────────────────────────────────────────────────────────────────

/**
 * Ground the sprite covers while one Smush frame plays, at his base speed, in
 * world pixels. Movement stays his own through a Smush, so a hop is carried
 * over the floor as fast as he runs — about two and a half run frames' worth
 * of ground for every Smush frame.
 */
export const SMUSH_GROUND_PX_PER_FRAME = (PLAYER_SPEED * SMUSH_DURATION_TICKS) / SMUSH_FRAMES;

/** The run phase one Smush frame spans: a planted foot sweeps exactly this ground. */
const HOP_PHASE_PER_FRAME = SMUSH_GROUND_PX_PER_FRAME / RUN_GROUND_PER_CYCLE_PX;

/** The run's right-foot stance falls inside this share of its cycle. */
const RIGHT_STANCE_SEARCH_END = 0.3;

/**
 * The run phase at which the right foot, planted, has its ankle `ahead` of the
 * pelvis in the run's own side-on gait.
 */
function runPhaseWithRightAnkleAt(ahead: number): number {
  return bisect(0, RIGHT_STANCE_SEARCH_END, (phase) => runFoot(phase).ankle.x > ahead);
}

/**
 * The run phase the stamp frame is keyed to: the one at which the planted
 * right foot is drawn {@link HOP_STAMP_ANKLE_AHEAD} of the pelvis. From the
 * stamp on the stamping foot is simply the run's own planted foot, held in
 * place on the floor as the sprite carries him over it.
 */
function hopStampPhase(): number {
  return runPhaseWithRightAnkleAt(HOP_STAMP_ANKLE_AHEAD);
}

/** The right foot's run phase on frame `frame` of a hop begun at `entry`, not wrapped. */
function hopRunPhase(entry: number, frame: number): number {
  return entry + frame * HOP_PHASE_PER_FRAME;
}

/** The run phase the last frame of a hop begun at `entry` hands back to. */
export function smushHopExitPhase(entry: number): number {
  return wrapPhase(hopRunPhase(entry, LAST_FRAME));
}

/**
 * The leg a hop begun at `entry` stamps with — whichever leg's own phase at
 * the stamp is nearest {@link hopStampPhase} — and how far its phase runs
 * from there.
 */
function hopStampLeg(entry: number): BlowLeg {
  return blowLeg(hopRunPhase(entry, SMUSH_IMPACT_FRAME), hopStampPhase());
}

/** Which foot a hop begun at `entry` stamps with. */
export function smushHopStampSide(entry: number): BodySide {
  return sideOfSign(hopStampLeg(entry).side);
}

/**
 * The last hop frame the stamping foot is still on the floor: the stance from
 * the stamp phase to push-off, one frame of the hop at a time.
 */
function hopLastHeldFrame(): number {
  const heldPhase = RUN_TOE_OFF_PHASE - hopStampPhase();
  return SMUSH_IMPACT_FRAME + Math.floor(heldPhase / HOP_PHASE_PER_FRAME);
}

/**
 * The stamping leg's own run phase from the stamp on. The heel always lands
 * where {@link hopStampPhase} has it — under the pelvis, on the damage centre
 * — whatever phase the stride would have that leg in, so through the press its
 * phase is held that much behind or ahead of its own and carried back over the
 * floor with it. Once it has pushed off, the swing takes up the difference by
 * the last frame, where the leg is the run's own again.
 */
function stampLegPhase(entry: number, leg: BlowLeg, frame: number): number {
  const own = legPhase(hopRunPhase(entry, frame), leg.side);
  const lastHeld = hopLastHeldFrame();
  if (frame <= lastHeld) return own - leg.lead;
  const caughtUp = (frame - lastHeld) / (LAST_FRAME - lastHeld);
  return own - leg.lead * (1 - caughtUp);
}

/** The stamp lands flat. */
const HOP_STAMP_PITCH = 0;
/**
 * The press on the hop is one frame, on the ball of the foot as the body goes
 * over it — the run would already have the heel well up.
 */
const HOP_PRESS_MAX_PITCH = deg(14);

/**
 * The stamping foot through the hop, side-on: the ankle ahead of the hips and
 * its height, keyed on the two airborne frames. The knee drives up out of the
 * run's recovery on the push-off, and hangs highest the frame before it stamps.
 * Matched against the running-kick plate's third to fifth frames.
 */
const HOP_CHAMBER: ReadonlyArray<{ readonly ankle: Pt; readonly pitch: number }> = [
  { ankle: pt(0.2, -0.58), pitch: deg(-8) },
  { ankle: pt(0.2, -0.86), pitch: deg(-26) },
];

/**
 * Head-on the chambered knee swings out from the run's narrow track, for the
 * same reason the standing chamber goes out to the side: a knee driven
 * straight at the camera hides behind its own shin.
 */
const HOP_CHAMBER_SPREAD = 0.22;

/** How much higher than the run's own flight the hop carries him, head-on. */
const HOP_RISE: readonly number[] = [0, 0, 0.3, 0, 0, 0, 0, 0, 0];
/**
 * Edge-on the hop's height is seen whole against the run's own flight, and a
 * third of a leg's height over it reads as a floaty leap rather than a stamp
 * hopped into at a run: side-on it rises only a little over the stride.
 * Head-on the rise is the one sign of the hop the camera shows, so it keeps
 * the full height there.
 */
const HOP_SIDE_RISE: readonly number[] = [0, 0, 0.04, 0, 0, 0, 0, 0, 0];

function hopRise(view: CarlView, frame: number): number {
  return (view === 'side' ? HOP_SIDE_RISE : HOP_RISE)[frame];
}
/**
 * At the top of the hop the trailing leg tucks up under him as well, the way
 * the running-kick plate's jumper draws both knees up in the air; left
 * trailing at the run's own height it reads as a leap, not a hop.
 */
/**
 * Landing, the trailing foot is held up off the floor behind him, as the
 * standing press lifts its other foot: set down, the landing reads as a
 * crouch on two feet rather than all of him coming down on one.
 */
const HOP_LANDING_TRAIL_LIFT = 0.06;
/**
 * A trailing foot already off the floor as he arches back into the hop
 * starts folding up under him: left where the run has it, straight out behind
 * a body leaning back, the leg would have to reach past its own length.
 */
const HOP_PUSH_OFF_FOLD = 0.03;
/**
 * How far below the chambered ankle the trailing one hangs at least, at the
 * top of the hop. Begun with the trailing leg high in its own swing, the tuck
 * would carry its foot up level with the chambered one: both knees up together read as a tuck jump,
 * and the chamber — the stamp's wind-up — is lost.
 */
const HOP_TRAILING_BELOW_CHAMBER = 0.4;
const HOP_TRAILING_TUCK: readonly Pt[] = [
  pt(0, 0),
  pt(HOP_PUSH_OFF_FOLD, HOP_PUSH_OFF_FOLD),
  pt(0.16, 0.14),
  pt(0, HOP_LANDING_TRAIL_LIFT),
  pt(0, HOP_LANDING_TRAIL_LIFT),
  pt(0, 0),
  pt(0, 0),
  pt(0, 0),
  pt(0, 0),
];
/** The drop onto the stamp, as crouch on top of the run's own absorb. */
const HOP_DROP: readonly number[] = [0, 0, 0, 0.3, 0.3, 0.1, 0, 0, 0];
/** Arched back over the hop, folded forward onto the stamp. */
const HOP_LEAN: readonly number[] = [0, deg(-4), deg(-6), deg(27), deg(16), deg(4), 0, 0, 0];
/** Arms as in {@link StompBeat}: raised for balance in the air, driven down on the stamp. */
const HOP_ARMS: readonly number[] = [0, 0.95, 1, -1, -1, 0, 0, 0, 0];
const HOP_MOUTH: readonly number[] = [0, 0.2, 0.35, 0.5, 0.4, 0.2, 0, 0, 0];
const HOP_CHIN: readonly number[] = [0, 0.1, 0, -0.8, -0.6, -0.2, 0, 0, 0];

/** The stamping foot on a hop frame, side-on. */
function hopStampFoot(entry: number, leg: BlowLeg, frame: number, view: CarlView): GaitFoot {
  if (frame > 0 && frame < SMUSH_IMPACT_FRAME) {
    const chamber = HOP_CHAMBER[Math.min(frame - 1, HOP_CHAMBER.length - 1)];
    const ankle = pt(chamber.ankle.x, chamber.ankle.y - hopRise(view, frame));
    return { ankle, pitch: chamber.pitch, planted: false };
  }
  const run = runFoot(stampLegPhase(entry, leg, frame));
  if (frame === SMUSH_IMPACT_FRAME + 1 && run.pitch > HOP_PRESS_MAX_PITCH) {
    // Rolled back onto the same toe point the run has, with the heel lower.
    const toe = run.ankle.x + soleOffsets(run.pitch).toe.x;
    return {
      ankle: ankleOverPivot(toe, 'toe', HOP_PRESS_MAX_PITCH),
      pitch: HOP_PRESS_MAX_PITCH,
      planted: true,
    };
  }
  return run;
}

/**
 * In the air on the hop both fists swing forward and up along the way he is
 * going, the way a jumper's arms carry him. Head-on "forward" is toward the
 * camera, so the fists come up over the chest instead; raised past the
 * shoulders there they read as hands clasped behind the head.
 */
const HOP_REACH_LEAD: Pt = pt(0.44, SHOULDER_Y - 0.1);
const HOP_REACH_REAR: Pt = pt(0.32, SHOULDER_Y);
const HOP_REACH_FACING: Pt = pt(0.16, SHOULDER_Y + 0.1);
/**
 * Arm targets for the hop: reaching along the way he is going in the air,
 * then on the landing the same press as standing, both fists back in guard.
 */
function hopArms(pose: CarlPose, view: CarlView, arms: number, stampSide: BodySide): void {
  if (arms === 0) return;
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const from: Wrists = { leftWrist: skeleton.leftArm.end, rightWrist: skeleton.rightArm.end };
  pose.leftArmAngles = null;
  pose.rightArmAngles = null;
  if (arms < 0) {
    pressHands(pose, view, stampSide, view === 'side' ? 'right' : stampSide, from, -arms);
    pose.elbowFlare = GUARDS[view].pose.elbowFlare;
    return;
  }
  const carry = shoulderCarry(pose, view);
  if (view === 'side') {
    pose.leftHand = handAt(from.leftWrist, HOP_REACH_LEAD, arms, carry);
    pose.rightHand = handAt(from.rightWrist, HOP_REACH_REAR, arms, carry);
    pose.elbowFlare = PROFILE_STOMP_ELBOW_FLARE;
    return;
  }
  const mirrored = pt(-HOP_REACH_FACING.x, HOP_REACH_FACING.y);
  pose.rightHand = handAt(from.rightWrist, HOP_REACH_FACING, arms, carry);
  pose.leftHand = handAt(from.leftWrist, mirrored, arms, carry);
  pose.elbowFlare = FACING_STOMP_ELBOW_FLARE;
}

/**
 * The hopping Smush at `frame` in `view`, begun at run phase `entry`. The
 * first and last frames are the run's own poses at `entry` and at
 * {@link smushHopExitPhase}; everything between is the run with the hop laid
 * over it, stamped with whichever foot {@link smushHopStampSide} names.
 */
export function smushHop(frame: number, view: CarlView, entry: number): CarlPose {
  const step = Math.min(Math.max(Math.round(frame), 0), LAST_FRAME);
  const phase = wrapPhase(hopRunPhase(entry, step));
  const pose = view === 'side' ? runSide(phase) : runFacing(phase, view === 'back');
  const onHop = step > 0 && step < LAST_FRAME;
  if (!onHop) return pose;

  const chambered = step < SMUSH_IMPACT_FRAME;
  const leg = hopStampLeg(entry);
  const trailingSide = -leg.side;
  placeFoot(
    pose,
    view,
    sideOfSign(leg.side),
    hopStampFoot(entry, leg, step, view),
    chambered ? HOP_CHAMBER_SPREAD : RUN_FOOT_SPREAD,
  );
  const trailing = runFoot(legPhase(phase, trailingSide));
  // Off the floor both feet ride up with the body; the trailing leg left at
  // the run's own height would be stretched past its length to reach it. A
  // trailing foot the run still has down pushes off as the body rises.
  const rise = hopRise(view, step);
  const tuck = HOP_TRAILING_TUCK[step];
  const pushingOff = trailing.planted && rise === 0;
  const tuckedY = trailing.ankle.y - rise - tuck.y;
  const stampAnkleY = hopStampFoot(entry, leg, step, view).ankle.y;
  const carriedY = rise > 0 ? Math.max(tuckedY, stampAnkleY + HOP_TRAILING_BELOW_CHAMBER) : tuckedY;
  const carried = pushingOff
    ? trailing
    : { ...trailing, ankle: pt(trailing.ankle.x + tuck.x, carriedY), planted: false };
  placeFoot(pose, view, sideOfSign(trailingSide), carried, RUN_FOOT_SPREAD);
  pose.bob -= rise;
  pose.crouch += HOP_DROP[step];
  if (view !== 'side' && HOP_DROP[step] > 0) {
    // Landing, the weight goes onto the stamp as it does on the standing
    // press: the stamping knee driven at the camera, the trailing leg left
    // straight and light, the torso tipped over the foot.
    const pressed = HOP_DROP[step] / HOP_DROP[SMUSH_IMPACT_FRAME];
    pose.leftForeshorten = 1;
    pose.rightForeshorten = 1;
    if (sideOfSign(leg.side) === 'right') pose.rightLegNearness = pressed * FACING_PRESS_NEARNESS;
    else pose.leftLegNearness = pressed * FACING_PRESS_NEARNESS;
    pose.lean = leg.side * pressed * FACING_PRESS_LEAN;
  }
  if (view === 'side') pose.lean += HOP_LEAN[step];
  pose.brow = 1;
  pose.mouth = HOP_MOUTH[step];
  pose.chinLift = HOP_CHIN[step];
  pose.rightFist = 1;
  pose.leftFist = 1;
  const arms = HOP_ARMS[step];
  hopArms(pose, view, arms, sideOfSign(leg.side));
  if (arms < 0) pose.mouthWidth = PRESS_MOUTH_WIDTH;
  if (chambered && view !== 'side') {
    if (sideOfSign(leg.side) === 'right') pose.rightLegNearness = FACING_CHAMBER_NEARNESS;
    else pose.leftLegNearness = FACING_CHAMBER_NEARNESS;
  }
  return pose;
}
