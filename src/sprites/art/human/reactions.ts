/**
 * Carl on the receiving end: the flinch when a blow lands, the stumble when
 * one shoves him back, the struggle against a web or a grip that holds his
 * feet, the collapse when he is knocked out, the lying loop he breathes in
 * while he waits to be revived, the climb back to his feet, and the fall when
 * a blow kills him.
 *
 * Every row here is a thing done *to* him, so each starts from where a fight
 * leaves him — the guard — and the ones he survives end back in it or in the
 * relaxed stance, which is what the animator hands to afterwards.
 *
 * Lying down needs no rotation of the whole figure: the rig's `lean` tips the
 * torso about the hip, so a torso leaned a quarter turn with the hip lowered
 * to the floor and the legs laid out along it is a man lying on the ground,
 * with the ground shadow, the key light and the solved joints all still right.
 * The falls and the lying loop are drawn edge-on only. From the game's camera a
 * body on the floor reads by its length, and seen head-on it would be a
 * foreshortened heap; the runtime turns him to the nearest profile to fall.
 */

import { mixPt, pt, TWO_PI } from '../carl/geometry';
import { HIP_Y, SHIN_LENGTH, THIGH_LENGTH } from '../carl/proportions';
import {
  type ArmAngles,
  type BoneChain,
  buildSkeleton,
  type CarlPose,
  type CarlView,
  CROUCH_DROP,
  restingPose,
  setArmAngles,
  VIEWS,
} from '../carl/rig';
import { clamp01, deg, easeOut, type Pt } from '../carlArt';
import {
  anglesThrough,
  ankleOverPivot,
  fromRest,
  HAND_HANG_DROP,
  type PathKey,
  profileFootTarget,
  soleOffsets,
  splineKeys,
  type Track,
  trackAt,
} from './gaitShared';
import { guardBack, guardFront, guardSide, idleSide } from './idles';
import type { HumanRowDef } from '../humanFigure';

// ── Row lengths and holds ────────────────────────────────────────────────────

/**
 * The flinch: the snap on the first frame, the cringe and the step back over
 * the next three, and four more to get the foot back under him. At three ticks
 * a frame it is over in two fifths of a second, which is about as long as a
 * man hit in the face takes to set himself again.
 */
const HURT_FRAMES = 8;
const HURT_TICKS_PER_FRAME = 3;

/**
 * The stumble. It is paced by the shove rather than by a clock — each frame is
 * an equal share of the distance the blow throws him — so it needs no hold of
 * its own; the length is only how finely the reel, the scramble and the catch
 * are cut.
 */
const STAGGER_FRAMES = 8;

/**
 * The struggle against whatever holds his feet: one wrench each way per loop,
 * a little under a second for the pair. Eight frames keeps each wrench four
 * frames long, the fewest that still reads as a motion rather than a flicker.
 */
const STRUGGLE_FRAMES = 8;
const STRUGGLE_TICKS_PER_FRAME = 6;

/** Knocked down, from on his feet to flat on his back: two thirds of a second. */
export const KNOCKDOWN_FRAMES = 10;
const KNOCKDOWN_TICKS_PER_FRAME = 4;

/**
 * Lying out cold, breathing: a slow sleeper's breath, one every three seconds,
 * held long rather than cut fine because every frame is resident while he lies
 * there.
 */
const KNOCKED_OUT_FRAMES = 6;
const KNOCKED_OUT_TICKS_PER_FRAME = 30;

/** Back up off the floor: a second, most of it spent getting a knee under him. */
const REVIVE_FRAMES = 12;
const REVIVE_TICKS_PER_FRAME = 5;

/**
 * The fall when he dies. Short, because it has to be over before the death
 * screen has darkened far enough to hide it.
 */
const DEATH_FRAMES = 10;
const DEATH_TICKS_PER_FRAME = 4;

// ── The frames a first showing cannot wait on ────────────────────────────────
//
// Each reaction opens on the news — the blow landing, the legs going — and
// the rest is the recovery or the settle. These are how many frames, from the
// first, carry the news: the ones a prewarm bakes ahead so a reaction's first
// showing is not painted on the tick it is needed, while the rest bakes as
// they play.

/** The flinch's snap, cringe and step out: everything before the foot starts back under him. */
export const HURT_RECOIL_FRAMES = 4;
/** The stumble's reel with the arms flung wide: everything before they come back to the guard. */
export const STAGGER_REEL_FRAMES = 4;
/** The knockdown's impact, stagger and fall, through to him sitting down hard on the floor. */
export const KNOCKDOWN_FALL_FRAMES = 5;
/** The fall through to both knees on the floor, before he pitches forward onto his hands. */
export const DEATH_KNEEL_FRAMES = 4;

// ── Keyed channels ───────────────────────────────────────────────────────────

type PointTrack = readonly (readonly [frame: number, point: Pt])[];

function pointAt(frame: number, track: PointTrack): Pt {
  return pt(
    splineKeys(
      frame,
      track.map(([key, point]): PathKey => [key, point.x]),
    ),
    splineKeys(
      frame,
      track.map(([key, point]): PathKey => [key, point.y]),
    ),
  );
}

/**
 * A channel that ends on `rest` but starts wherever its first key says: a
 * reaction's first frame is the blow already landed, not the pose before it.
 */
function toRest(rest: number, lastFrame: number, keys: readonly PathKey[]): Track {
  return [...keys, [lastFrame, rest]];
}

/**
 * Where the toe of a profile foot posed at `target` and `pitch` touches the
 * floor: the point a heel rolling up or down about the toe has to keep still.
 */
function toeOfProfileFoot(target: Pt, pitch: number): number {
  const ankleFromTarget = profileFootTarget(pt(0, 0), pitch);
  const ankleX = target.x - ankleFromTarget.x;
  return ankleX + soleOffsets(pitch).toe.x;
}

// ── Hurt flinch ──────────────────────────────────────────────────────────────

/**
 * Which way a blow shoves him: `back` for one from in front of him, which
 * rocks him back on his heels; `forward` for one from behind, which pitches
 * him forward over his feet.
 */
export type HurtFrom = 'front' | 'behind';

const HURT_LAST = HURT_FRAMES - 1;

/**
 * The flinch in three beats. The snap: on the first frame the blow has
 * already landed, and the head and shoulders are thrown away from it as far
 * as they go, the guard knocked loose — the one frame that has to read at a
 * glance, so it is the biggest displacement in the row. The cover: the
 * forearms come up in front of the face and he hunches in behind them while a
 * foot gives ground. The recovery: the guard he started in, set again.
 *
 * Every arm is placed relative to its own shoulder, never where the guard
 * held it in figure space: a fist left in place while the torso is thrown back
 * straightens the arm out in front of him, which reads as the end of a punch.
 */
const HURT_SNAP: Track = toRest(0, HURT_LAST, [
  [0, 1],
  [1, 0.7],
  [2, 0.2],
  [3, 0.04],
  [4, 0],
]);
/** Forearms up in front of the face: starting on the snap, held, then let down. */
const HURT_COVER: Track = toRest(0, HURT_LAST, [
  [0, 0.25],
  [1, 0.8],
  [2, 1],
  [3, 1],
  [4, 0.75],
  [5, 0.4],
  [6, 0.12],
]);
/** Shoulders rounded and the chin tucked in behind the cover. */
const HURT_HUNCH: Track = fromRest(0, HURT_LAST, [
  [1, 0.3],
  [2, 1],
  [3, 0.9],
  [4, 0.55],
  [5, 0.2],
  [6, 0.05],
]);
/** Knees give under the blow and come back. */
const HURT_CROUCH: Track = fromRest(0, HURT_LAST, [
  [1, 0.06],
  [2, 0.1],
  [3, 0.09],
  [4, 0.06],
  [5, 0.02],
]);
/**
 * How far the body is rocked by the blow — the hip's shift, positive toward
 * the way he is shoved — following the stepping foot out and back.
 */
const HURT_SWAY: Track = toRest(0, HURT_LAST, [
  [0, 0.06],
  [1, 0.1],
  [2, 0.12],
  [3, 0.1],
  [4, 0.06],
  [5, 0.015],
]);
/** Eyes screwed shut on the hit and opening again. */
const HURT_SQUINT: Track = toRest(0, HURT_LAST, [
  [0, 0.8],
  [1, 0.7],
  [2, 0.85],
  [3, 0.7],
  [4, 0.35],
  [5, 0.1],
]);
const HURT_GRIMACE: Track = toRest(0, HURT_LAST, [
  [0, 0.7],
  [1, 0.45],
  [2, 0.3],
  [3, 0.25],
  [4, 0.15],
]);
/** The hair keeps going the way the head was going when the blow stopped it. */
const HURT_HAIR: Track = toRest(0, HURT_LAST, [
  [0, 0.8],
  [1, 0.4],
  [2, -0.25],
  [3, -0.15],
  [4, 0.05],
]);
const HURT_JACKET: Track = toRest(0, HURT_LAST, [
  [0, 0.6],
  [1, 0.45],
  [2, 0.2],
  [4, 0.05],
]);

/** How far the stepping foot is set down from its guard spot, along the shove. */
const HURT_STEP: Track = fromRest(0, HURT_LAST, [
  [1, 0.12],
  [2, 0.22],
  [3, 0.22],
  [4, 0.12],
  [5, 0],
]);
/**
 * The frames the stepping foot is off the floor: it lifts as the blow lands
 * and is set down behind him (or ahead of him, shoved from behind), then lifts
 * again to come back under him. Every other frame it is planted.
 */
const HURT_STEP_OUT_LIFTED = 1;
const HURT_STEP_BACK_LIFTED = 4;
/** How high the stepping foot clears the floor on its two lifted frames. */
const HURT_STEP_LIFT = 0.05;
/**
 * Shoved from behind, the lead foot is already out ahead of him: the catching
 * step can only go this share as far before the leg runs out.
 */
const HURT_CATCH_STEP_SHARE = 0.35;
/** A lifted foot hangs toe-down a touch, as a foot does off the floor. */
const HURT_LIFTED_PITCH = deg(12);

/**
 * The profile snap: the torso rocked about the hip, and the upper back whipped
 * further than the hips go, so the body line bends through the waist the way a
 * body struck high does rather than tipping as one plank.
 */
const HURT_SIDE_ROCK = deg(26);
const HURT_SIDE_WHIP = deg(12);
/** The head is thrown back on its neck by the snap, whichever side it came from. */
const HURT_SIDE_HEAD_SNAP = deg(38);
const HURT_SIDE_HEAD_TUCK = deg(22);
const HURT_SIDE_HUNCH = deg(14);
/**
 * Where the snap flings each fist, from where the guard held it relative to
 * its shoulder: up and back with the head, the hands opening.
 */
const HURT_SIDE_FLING = pt(-0.04, -0.14);
/**
 * The cover in profile: both fists up in front of the face, forearms
 * upright, relative to the head's centre — the lead out at brow height, the
 * near one lower, at the jaw. The near arm is the one drawn over the head, and
 * laid across the eye it hides the face and turns the head into the back of
 * one.
 */
const HURT_SIDE_LEAD_COVER = pt(0.17, 0.05);
const HURT_SIDE_REAR_COVER = pt(0.15, 0.19);
/** The hands thrown open by the snap and closed again as they cover. */
const HURT_FLUNG_OPEN_HAND = 0.35;

/** +1 for a shove toward the way he faces, −1 for one back away from it. */
function shoveSign(from: HurtFrom): number {
  return from === 'behind' ? 1 : -1;
}

/** A mouth pulled wide as the grimace opens. */
const HURT_MOUTH_STRETCH = 0.6;

function hurtFace(pose: CarlPose, frame: number): void {
  pose.brow = 1;
  pose.blink = trackAt(frame, HURT_SQUINT);
  pose.mouth = trackAt(frame, HURT_GRIMACE);
  pose.mouthWidth = 1 + trackAt(frame, HURT_GRIMACE) * HURT_MOUTH_STRETCH;
}

/** Whether the stepping foot is off the floor on this frame. */
function hurtFootLifted(frame: number): boolean {
  return frame === HURT_STEP_OUT_LIFTED || frame === HURT_STEP_BACK_LIFTED;
}

function rotated(point: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return pt(point.x * cos - point.y * sin, point.x * sin + point.y * cos);
}

function plus(a: Pt, b: Pt): Pt {
  return pt(a.x + b.x, a.y + b.y);
}

function minus(a: Pt, b: Pt): Pt {
  return pt(a.x - b.x, a.y - b.y);
}

const HURT_GUARD_SIDE = guardSide(0);
const HURT_GUARD_SIDE_SKELETON = buildSkeleton(HURT_GUARD_SIDE, VIEWS.side);
/** Each guard fist relative to its own shoulder, which is how the flinch carries it. */
const GUARD_SIDE_LEAD_FROM_SHOULDER = minus(
  HURT_GUARD_SIDE_SKELETON.leftArm.end,
  HURT_GUARD_SIDE_SKELETON.leftShoulder,
);
const GUARD_SIDE_REAR_FROM_SHOULDER = minus(
  HURT_GUARD_SIDE_SKELETON.rightArm.end,
  HURT_GUARD_SIDE_SKELETON.rightShoulder,
);

/**
 * The profile flinch. Hit from in front, the rear foot gives ground behind
 * him; shoved from behind, the lead foot is thrown out ahead to catch him.
 */
function hurtSide(frame: number, from: HurtFrom): CarlPose {
  const pose = guardSide(0);
  const shove = shoveSign(from);
  const snap = trackAt(frame, HURT_SNAP);
  const cover = trackAt(frame, HURT_COVER);
  const hunch = trackAt(frame, HURT_HUNCH);
  pose.sway = shove * trackAt(frame, HURT_SWAY);
  const rock = shove * snap * HURT_SIDE_ROCK + hunch * HURT_SIDE_HUNCH;
  pose.lean += rock;
  pose.spineBend = shove * snap * HURT_SIDE_WHIP;
  pose.headTilt += -snap * HURT_SIDE_HEAD_SNAP + hunch * HURT_SIDE_HEAD_TUCK;
  pose.crouch += trackAt(frame, HURT_CROUCH);

  const lift = hurtFootLifted(frame) ? HURT_STEP_LIFT : 0;
  const step = trackAt(frame, HURT_STEP);
  if (from === 'front') {
    const planted = pose.rightFoot;
    pose.rightFoot = pt(planted.x - step, planted.y - lift);
    pose.rightFootPitch = lift > 0 ? HURT_LIFTED_PITCH : pose.rightFootPitch;
    pose.rightFootPlanted = lift === 0;
    pose.leftFootPlanted = true;
  } else {
    pose.leftFoot = pt(pose.leftFoot.x + step * HURT_CATCH_STEP_SHARE, -lift);
    pose.leftFootPitch = lift > 0 ? HURT_LIFTED_PITCH : 0;
    pose.leftFootPlanted = lift === 0;
    pose.rightFootPlanted = true;
  }

  // The fists ride with the shoulders they hang from, turned with the torso,
  // flung up by the snap and then brought in front of the face.
  const skeleton = buildSkeleton(pose, VIEWS.side);
  const turn = pose.lean + (pose.spineBend ?? 0) - HURT_GUARD_SIDE.lean;
  const fling = pt(HURT_SIDE_FLING.x * snap, HURT_SIDE_FLING.y * snap);
  const leadGuard = plus(
    plus(skeleton.leftShoulder, rotated(GUARD_SIDE_LEAD_FROM_SHOULDER, turn)),
    fling,
  );
  const rearGuard = plus(
    plus(skeleton.rightShoulder, rotated(GUARD_SIDE_REAR_FROM_SHOULDER, turn)),
    fling,
  );
  pose.leftHand = mixPt(leadGuard, plus(skeleton.headCentre, HURT_SIDE_LEAD_COVER), cover);
  pose.rightHand = mixPt(rearGuard, plus(skeleton.headCentre, HURT_SIDE_REAR_COVER), cover);
  pose.rightArmAngles = frame === HURT_LAST ? HURT_GUARD_SIDE.rightArmAngles : null;
  const open = snap * (1 - cover);
  pose.leftFist += (HURT_FLUNG_OPEN_HAND - pose.leftFist) * open;
  pose.rightFist += (HURT_FLUNG_OPEN_HAND - pose.rightFist) * open;

  pose.hairFlow += -shove * trackAt(frame, HURT_HAIR);
  pose.jacketFlare += trackAt(frame, HURT_JACKET);
  hurtFace(pose, frame);
  return pose;
}

/**
 * Head-on the snap cannot be thrown back — that is along the line of sight —
 * so it is thrown aside, the way a blow to the jaw turns a head: the face
 * wrenched round, the head rolled and the shoulders tipped over one hip while
 * the hips go the other way, one fist flung out wide and the other knocked
 * down. Then both forearms come up in front of the face, elbows in, and he
 * hunches behind them while a foot steps back in depth.
 */
const HURT_FACING_SNAP_LEAN = deg(20);
const HURT_FACING_SNAP_SWAY = -0.1;
const HURT_FACING_SNAP_TURN = 0.9;
const HURT_FACING_SNAP_ROLL = deg(22);
/** The chin thrown up by a blow from in front, or down by one from behind. */
const HURT_FACING_CHIN = 0.6;
const HURT_FACING_TUCK = 0.35;
/**
 * Head-on a hunch is carried by the knees alone: pitched toward the camera the
 * head sinks behind the fists and the cover reads as his back.
 */
const HURT_FACING_HUNCH_CROUCH = 0.08;
/** The fist on the side the head is thrown toward is flung out and up; the other is knocked down. */
const HURT_FACING_FLUNG_FIST = pt(0.2, -0.06);
const HURT_FACING_DROPPED_FIST = pt(-0.04, 0.14);
/**
 * The cover head-on: a fist either side of the face at the cheekbones,
 * relative to the head's centre, forearms upright and elbows in. Brought in
 * any closer the upper arms have to lie level across the chest, and the
 * forearms crossed over the face read as arms folded over the head.
 */
const HURT_FACING_COVER_SPREAD = 0.12;
const HURT_FACING_COVER_DROP = 0.04;
/** A foot lifted off the floor head-on is a little nearer the camera than its thigh. */
const HURT_FACING_LIFTED_NEARNESS = 0.4;
/** From behind, radians of pitch the snap throws the torso through. */
const HURT_BACK_PITCH = 0.5;
/**
 * From behind, the fist on the side the head is thrown toward is drawn clear
 * of his back while the snap is at least this strong: a hand clapped to the
 * struck side of the head is the one part of a flinch that shows from there.
 */
const HURT_BACK_FLUNG_SHOWS_FROM = 0.5;
/** Head-on the hair swings sideways with the turned face, not back and forth. */
const HURT_FACING_HAIR_SHARE = 0.7;

/**
 * The head-on flinch, toward the camera or away from it. The left foot steps:
 * back from the blow, or ahead of him to catch a shove from behind — which
 * head-on is a step in depth, drawn up or down the screen.
 */
function hurtFacing(frame: number, from: HurtFrom, away: boolean): CarlPose {
  const pose = away ? guardBack(0) : guardFront(0);
  const shove = shoveSign(from);
  const snap = trackAt(frame, HURT_SNAP);
  const cover = trackAt(frame, HURT_COVER);
  const hunch = trackAt(frame, HURT_HUNCH);
  pose.lean += snap * HURT_FACING_SNAP_LEAN;
  pose.sway += snap * HURT_FACING_SNAP_SWAY;
  pose.headTurn += snap * HURT_FACING_SNAP_TURN;
  pose.headTilt += snap * HURT_FACING_SNAP_ROLL;
  pose.chinLift = (pose.chinLift ?? 0) - shove * snap * HURT_FACING_CHIN - hunch * HURT_FACING_TUCK;
  pose.crouch += trackAt(frame, HURT_CROUCH) + hunch * HURT_FACING_HUNCH_CROUCH;
  if (away) {
    // From behind the face and chin are out of sight, so the snap is carried
    // by the torso thrown back toward the camera (or forward, shoved from
    // behind) and by the near fist coming out from behind his back.
    pose.torsoPitch = (pose.torsoPitch ?? 0) + shove * snap * HURT_BACK_PITCH;
    pose.rightArmBehind = snap < HURT_BACK_FLUNG_SHOWS_FROM;
  }

  const lift = hurtFootLifted(frame) ? HURT_STEP_LIFT : 0;
  pose.leftFoot = pt(pose.leftFoot.x, -lift);
  pose.leftFootDepth = shove * trackAt(frame, HURT_STEP);
  pose.rightFootDepth = 0;
  pose.leftLegNearness = lift > 0 ? HURT_FACING_LIFTED_NEARNESS : 0;
  pose.leftFootPlanted = lift === 0;
  pose.rightFootPlanted = true;

  const view = away ? VIEWS.back : VIEWS.front;
  const skeleton = buildSkeleton(pose, view);
  const flung = pt(
    pose.rightHand.x + HURT_FACING_FLUNG_FIST.x * snap,
    pose.rightHand.y + HURT_FACING_FLUNG_FIST.y * snap,
  );
  const dropped = pt(
    pose.leftHand.x + HURT_FACING_DROPPED_FIST.x * snap,
    pose.leftHand.y + HURT_FACING_DROPPED_FIST.y * snap,
  );
  const coverY = skeleton.headCentre.y + HURT_FACING_COVER_DROP;
  pose.leftHand = mixPt(
    dropped,
    pt(skeleton.headCentre.x - HURT_FACING_COVER_SPREAD, coverY),
    cover,
  );
  pose.rightHand = mixPt(
    flung,
    pt(skeleton.headCentre.x + HURT_FACING_COVER_SPREAD, coverY),
    cover,
  );
  pose.hairFlow += trackAt(frame, HURT_HAIR) * HURT_FACING_HAIR_SHARE;
  pose.jacketFlare += trackAt(frame, HURT_JACKET);
  hurtFace(pose, frame);
  return pose;
}

function hurtFront(frame: number, from: HurtFrom): CarlPose {
  return hurtFacing(frame, from, false);
}

function hurtBack(frame: number, from: HurtFrom): CarlPose {
  return hurtFacing(frame, from, true);
}

// ── Knockback stagger ────────────────────────────────────────────────────────

const STAGGER_LAST = STAGGER_FRAMES - 1;

/**
 * A shove too hard to step under. For the first frames he is carried: the
 * blow folds him at the waist, the hip leads backward, both arms fly forward
 * and up for balance and the feet are swept out ahead of him, skidding on the
 * heels. Then, as the shove bleeds off, the feet scramble back under him in
 * two short steps, and the last frame is a wide caught stance with the arms
 * still out — from which the guard takes him.
 *
 * Profile, facing +X; the shove is toward −X.
 */
const STAGGER_LEAN: Track = [
  [0, deg(-10)],
  [1, deg(-18)],
  [2, deg(-16)],
  [3, deg(-8)],
  [4, deg(2)],
  [5, deg(8)],
  [6, deg(6)],
  [STAGGER_LAST, deg(4)],
];
const STAGGER_CROUCH: Track = [
  [0, 0.1],
  [1, 0.18],
  [2, 0.2],
  [3, 0.22],
  [4, 0.2],
  [5, 0.17],
  [6, 0.13],
  [STAGGER_LAST, 0.1],
];
/** The hip carried back past the feet by the shove, then the feet catch it up. */
const STAGGER_SWAY: Track = [
  [0, -0.05],
  [1, -0.1],
  [2, -0.12],
  [3, -0.1],
  [4, -0.06],
  [5, -0.03],
  [6, -0.01],
  [STAGGER_LAST, 0],
];
/**
 * The far (left) foot, in figure space: swept forward and skidding on its
 * heel, then lifted and set down behind the hip as the first catch step.
 */
const STAGGER_LEFT_FOOT: PointTrack = [
  [0, pt(0.18, 0)],
  [1, pt(0.2, 0)],
  [2, pt(0.18, 0)],
  [3, pt(0.02, -0.1)],
  [4, pt(-0.18, -0.02)],
  [5, pt(-0.22, 0)],
  [6, pt(-0.22, 0)],
  [STAGGER_LAST, pt(-0.2, 0)],
];
const STAGGER_LEFT_PITCH: Track = [
  [0, 0],
  [1, deg(-22)],
  [2, deg(-26)],
  [3, deg(10)],
  [4, deg(6)],
  [5, 0],
  [STAGGER_LAST, 0],
];
/**
 * The near (right) foot trails: it skids after the left, then steps back past
 * it on the scramble and lands the wide stance.
 */
const STAGGER_RIGHT_FOOT: PointTrack = [
  [0, pt(-0.14, 0)],
  [1, pt(-0.02, 0)],
  [2, pt(0.08, 0)],
  [3, pt(0.1, 0)],
  [4, pt(0.1, 0)],
  [5, pt(-0.05, -0.1)],
  [6, pt(-0.02, -0.01)],
  [STAGGER_LAST, pt(0.14, 0)],
];
const STAGGER_RIGHT_PITCH: Track = [
  [0, deg(10)],
  [1, deg(-12)],
  [2, deg(-20)],
  [3, deg(-14)],
  [4, 0],
  [5, deg(14)],
  [6, deg(4)],
  [STAGGER_LAST, 0],
];
/**
 * Arms thrown out against the fall: the near one up over his head, the far one
 * flung back behind him, then windmilling down as he catches himself.
 */
const STAGGER_LEFT_ARM_RAISE: Track = [
  [0, deg(20)],
  [1, deg(-30)],
  [2, deg(-55)],
  [3, deg(-40)],
  [4, deg(-10)],
  [5, deg(25)],
  [6, deg(20)],
  [STAGGER_LAST, deg(15)],
];
const STAGGER_RIGHT_ARM_RAISE: Track = [
  [0, deg(40)],
  [1, deg(100)],
  [2, deg(120)],
  [3, deg(110)],
  [4, deg(80)],
  [5, deg(50)],
  [6, deg(32)],
  [STAGGER_LAST, deg(22)],
];
/** The elbow stays soft; a flung arm is not locked straight. */
const STAGGER_ELBOW_BEND = deg(45);
const STAGGER_HEAD_TILT: Track = [
  [0, deg(-28)],
  [1, deg(-20)],
  [2, deg(-4)],
  [3, deg(6)],
  [STAGGER_LAST, deg(6)],
];
const STAGGER_HAIR: Track = [
  [0, 0.6],
  [2, 0.4],
  [4, 0.1],
  [STAGGER_LAST, 0],
];

/**
 * Which feet bear weight on each frame. On the carried frames both skid —
 * they are on the floor but not holding a place on it — so neither is planted.
 */
const STAGGER_LEFT_PLANTED: readonly boolean[] = [
  true,
  false,
  false,
  false,
  false,
  true,
  true,
  true,
];
const STAGGER_RIGHT_PLANTED: readonly boolean[] = [
  true,
  false,
  false,
  false,
  true,
  false,
  false,
  true,
];

function staggerSide(frame: number): CarlPose {
  const pose = guardSide(0);
  pose.lean = trackAt(frame, STAGGER_LEAN);
  pose.crouch = trackAt(frame, STAGGER_CROUCH);
  pose.sway = trackAt(frame, STAGGER_SWAY);
  pose.bob = 0;
  const left = pointAt(frame, STAGGER_LEFT_FOOT);
  const right = pointAt(frame, STAGGER_RIGHT_FOOT);
  pose.leftFootPitch = trackAt(frame, STAGGER_LEFT_PITCH);
  pose.rightFootPitch = trackAt(frame, STAGGER_RIGHT_PITCH);
  pose.leftFoot = left;
  pose.rightFoot = right;
  pose.leftFootPlanted = STAGGER_LEFT_PLANTED[frame] ?? false;
  pose.rightFootPlanted = STAGGER_RIGHT_PLANTED[frame] ?? false;
  const leftRaise = trackAt(frame, STAGGER_LEFT_ARM_RAISE);
  const rightRaise = trackAt(frame, STAGGER_RIGHT_ARM_RAISE);
  // Caught, the fists come back up into the guard the stumble hands him to,
  // so the last frames converge on its arms rather than leaving one reaching.
  const regard = clamp01((frame - STAGGER_REGUARD_FROM) / (STAGGER_LAST - STAGGER_REGUARD_FROM));
  const leftFlung = { upper: leftRaise, fore: leftRaise + STAGGER_ELBOW_BEND, foreScale: 1 };
  const rightFlung = { upper: rightRaise, fore: rightRaise + STAGGER_ELBOW_BEND, foreScale: 1 };
  setArmAngles(pose, 'left', mixArm(leftFlung, GUARD_SIDE_LEAD_ARM, regard));
  setArmAngles(pose, 'right', mixArm(rightFlung, GUARD_SIDE_REAR_ARM, regard));
  pose.leftFist = STAGGER_OPEN_HAND + (GUARD_SIDE.leftFist - STAGGER_OPEN_HAND) * regard;
  pose.rightFist = STAGGER_OPEN_HAND + (GUARD_SIDE.rightFist - STAGGER_OPEN_HAND) * regard;
  pose.headTilt = trackAt(frame, STAGGER_HEAD_TILT);
  pose.brow = 1;
  pose.mouth = frame <= STAGGER_MOUTH_OPEN_THROUGH ? STAGGER_MOUTH : STAGGER_MOUTH_SHUT;
  pose.hairFlow = trackAt(frame, STAGGER_HAIR);
  pose.jacketFlare = STAGGER_JACKET_FLARE;
  return pose;
}

/** Hands thrown open for balance rather than fists. */
const STAGGER_OPEN_HAND = 0.1;
/** From this frame the arms come back to the guard. */
const STAGGER_REGUARD_FROM = STAGGER_REEL_FRAMES;

const GUARD_SIDE = guardSide(0);
const GUARD_SIDE_SKELETON = buildSkeleton(GUARD_SIDE, VIEWS.side);

/**
 * The guard's arms as the joint angles that draw them: its lead arm is placed
 * by its fist, and a blend toward it has to happen in angles.
 */
function guardSideArm(chain: BoneChain): ArmAngles {
  return anglesThrough(chain.root, chain.joint, chain.end);
}

const GUARD_SIDE_LEAD_ARM = guardSideArm(GUARD_SIDE_SKELETON.leftArm);
const GUARD_SIDE_REAR_ARM = guardSideArm(GUARD_SIDE_SKELETON.rightArm);

/** Blends two arms' joint angles, taking each angle the short way round. */
function mixArm(a: ArmAngles, b: ArmAngles, t: number): ArmAngles {
  const toward = (from: number, to: number): number =>
    from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
  return {
    upper: toward(a.upper, b.upper),
    fore: toward(a.fore, b.fore),
    foreScale: a.foreScale + (b.foreScale - a.foreScale) * t,
  };
}
const STAGGER_MOUTH = 0.55;
const STAGGER_MOUTH_SHUT = 0.15;
/** The mouth hangs open through the carry and closes as he catches himself. */
const STAGGER_MOUTH_OPEN_THROUGH = 3;
const STAGGER_JACKET_FLARE = 0.6;

/**
 * Head-on, the stumble is the same beats in depth: the feet swept out ahead
 * (toward the camera when he faces it) and scrambling back under him, the
 * arms flung up to either side for balance.
 */
function staggerFacing(frame: number, away: boolean): CarlPose {
  const pose = away ? guardBack(0) : guardFront(0);
  const side = staggerSide(frame);
  pose.crouch = side.crouch;
  pose.chinLift = trackAt(frame, STAGGER_HEAD_TILT) * STAGGER_FACING_CHIN_PER_RADIAN;
  pose.leftFoot = pt(pose.leftFoot.x, side.leftFoot.y);
  pose.rightFoot = pt(pose.rightFoot.x, side.rightFoot.y);
  pose.leftFootDepth = (side.leftFoot.x - STAGGER_FACING_DEPTH_CENTRE) * STAGGER_FACING_DEPTH_SHARE;
  pose.rightFootDepth =
    (side.rightFoot.x - STAGGER_FACING_DEPTH_CENTRE) * STAGGER_FACING_DEPTH_SHARE;
  pose.leftFootPlanted = side.leftFootPlanted;
  pose.rightFootPlanted = side.rightFootPlanted;
  pose.leftLegNearness = side.leftFoot.y < 0 ? STAGGER_FACING_LIFTED_NEARNESS : 0;
  pose.rightLegNearness = side.rightFoot.y < 0 ? STAGGER_FACING_LIFTED_NEARNESS : 0;
  // Head-on both arms go out to the sides, whichever way each swings in
  // profile, and together: the profile's one-arm-up, one-arm-back split seen
  // from the front is one arm level and one hanging, which reads as pointing.
  // Only a share of the split is kept, as the windmill between the two sides.
  const profileLeft = Math.abs(trackAt(frame, STAGGER_LEFT_ARM_RAISE));
  const profileRight = trackAt(frame, STAGGER_RIGHT_ARM_RAISE);
  const bothRaised = (profileLeft + profileRight) / 2;
  const windmill = ((profileRight - profileLeft) / 2) * STAGGER_FACING_WINDMILL_SHARE;
  const leftRaise = bothRaised - windmill;
  const rightRaise = bothRaised + windmill;
  // Head-on an arm flung up for balance goes out to the side: the angle is
  // taken away from the body on each side, never across it.
  // Flung out to the sides the upper arms lie in the picture plane, whatever
  // share of them the guard the stumble started from drew.
  setArmAngles(pose, 'left', {
    upper: -leftRaise * STAGGER_FACING_ARM_SHARE,
    fore: -(leftRaise * STAGGER_FACING_ARM_SHARE + STAGGER_ELBOW_BEND),
    foreScale: 1,
  });
  setArmAngles(pose, 'right', {
    upper: rightRaise * STAGGER_FACING_ARM_SHARE,
    fore: rightRaise * STAGGER_FACING_ARM_SHARE + STAGGER_ELBOW_BEND,
    foreScale: 1,
  });
  pose.lean = Math.sin((frame / STAGGER_FRAMES) * TWO_PI) * STAGGER_FACING_WOBBLE;
  pose.leftFist = STAGGER_OPEN_HAND;
  pose.rightFist = STAGGER_OPEN_HAND;
  pose.brow = 1;
  pose.mouth = side.mouth;
  pose.jacketFlare = STAGGER_JACKET_FLARE;
  return pose;
}

/** Figure-x the profile feet are measured about, turned into depth head-on. */
const STAGGER_FACING_DEPTH_CENTRE = 0;
const STAGGER_FACING_CHIN_PER_RADIAN = -2.5;
const STAGGER_FACING_LIFTED_NEARNESS = 0.4;
/**
 * How much of the profile's split between the arms survives head-on: enough
 * that they rock from side to side, not so much that one hangs.
 */
const STAGGER_FACING_WINDMILL_SHARE = 0.55;
/**
 * Head-on a foot's fore-and-aft skid is drawn as screen height, and at full
 * size a foot skidding out toward the camera drops below the other one's
 * line far enough to read as a hop.
 */
const STAGGER_FACING_DEPTH_SHARE = 0.6;
/** Head-on the arms spread rather than reach, so they travel less far. */
const STAGGER_FACING_ARM_SHARE = 0.6;
/** Head-on the arms windmill him from side to side as he tries to stay up. */
const STAGGER_FACING_WOBBLE = deg(7);

function staggerFront(frame: number): CarlPose {
  return staggerFacing(frame, false);
}

function staggerBack(frame: number): CarlPose {
  return staggerFacing(frame, true);
}

// ── Struggle ─────────────────────────────────────────────────────────────────

/**
 * Fighting a hold on his feet, in two beats a loop. First he hauls: bent
 * over, both hands under one thigh, heaving the knee up while the heel tears
 * off the floor and the toes stay stuck. Then he wrenches: the shoulders
 * thrown back and the fists yanked down past the hips, the other heel
 * tearing up. The toes never move.
 */
function struggleBeats(frame: number): { haul: number; wrench: number } {
  const swing = Math.sin((frame / STRUGGLE_FRAMES) * TWO_PI);
  return { haul: clamp01(swing), wrench: clamp01(-swing) };
}

const STRUGGLE_CROUCH = 0.12;
const STRUGGLE_HAUL_CROUCH = 0.1;
/** Bent over the hauled thigh, then thrown back on the wrench. */
const STRUGGLE_HAUL_LEAN = deg(24);
const STRUGGLE_WRENCH_LEAN = deg(14);
/** How far a hauled heel pitches up about its stuck toe, and a wrenched one. */
const STRUGGLE_HAUL_HEEL = deg(62);
const STRUGGLE_WRENCH_HEEL = deg(26);
const STRUGGLE_HAUL_CHIN_TILT = deg(18);
const STRUGGLE_WRENCH_HEAD_BACK = deg(16);
const STRUGGLE_MOUTH = 0.4;
const STRUGGLE_MOUTH_WIDTH = 1.4;
const STRUGGLE_FIST = 0.95;
const STRUGGLE_HAIR = 0.35;
const STRUGGLE_JACKET = 0.35;
/**
 * Where the hands grip the hauled thigh: this share of the way from the knee
 * up to the hip, a little in front of it.
 */
const THIGH_GRIP_UP_FROM_KNEE = 0.3;
const THIGH_GRIP_AHEAD = 0.06;
/** Fists at the chest between beats, relative to each shoulder joint. */
const STRUGGLE_REST_FIST = pt(0.16, 0.36);
/** Fists yanked down and back past the hips on the wrench. */
const STRUGGLE_YANK_FIST = pt(-0.16, 0.56);

/** A foot whose toe stays where it is while the heel pitches up about it. */
function heelTorn(target: Pt, pitch: number): Pt {
  const toe = toeOfProfileFoot(target, 0);
  return profileFootTarget(ankleOverPivot(toe, 'toe', pitch), pitch);
}

function struggleSide(frame: number): CarlPose {
  const { haul, wrench } = struggleBeats(frame);
  const pose = idleSide(0);
  pose.crouch = STRUGGLE_CROUCH + haul * STRUGGLE_HAUL_CROUCH;
  pose.lean = haul * STRUGGLE_HAUL_LEAN - wrench * STRUGGLE_WRENCH_LEAN;
  pose.headTilt = haul * STRUGGLE_HAUL_CHIN_TILT - wrench * STRUGGLE_WRENCH_HEAD_BACK;
  pose.brow = 1;
  pose.mouth = STRUGGLE_MOUTH;
  pose.mouthWidth = STRUGGLE_MOUTH_WIDTH;
  pose.blink = haul * STRUGGLE_STRAIN_SQUINT;
  const nearPitch = haul * STRUGGLE_HAUL_HEEL;
  const farPitch = wrench * STRUGGLE_WRENCH_HEEL;
  pose.rightFoot = heelTorn(pose.rightFoot, nearPitch);
  pose.leftFoot = heelTorn(pose.leftFoot, farPitch);
  pose.rightFootPitch = nearPitch;
  pose.leftFootPitch = farPitch;
  pose.leftFootPlanted = true;
  pose.rightFootPlanted = true;
  const skeleton = buildSkeleton(pose, VIEWS.side);
  const knee = skeleton.rightLeg.joint;
  const grip = offset(
    mixPt(knee, skeleton.rightLeg.root, THIGH_GRIP_UP_FROM_KNEE),
    THIGH_GRIP_AHEAD,
  );
  const handFor = (shoulder: Pt): Pt => {
    const rest = pt(shoulder.x + STRUGGLE_REST_FIST.x, shoulder.y + STRUGGLE_REST_FIST.y);
    const yank = pt(shoulder.x + STRUGGLE_YANK_FIST.x, shoulder.y + STRUGGLE_YANK_FIST.y);
    return mixPt(mixPt(rest, grip, haul), yank, wrench);
  };
  pose.leftHand = handFor(skeleton.leftShoulder);
  pose.rightHand = handFor(skeleton.rightShoulder);
  pose.elbowFlare = STRUGGLE_SIDE_ELBOW_FLARE;
  pose.leftFist = STRUGGLE_FIST;
  pose.rightFist = STRUGGLE_FIST;
  pose.hairFlow = (haul - wrench) * STRUGGLE_HAIR;
  pose.jacketFlare = Math.max(haul, wrench) * STRUGGLE_JACKET;
  return pose;
}

const STRUGGLE_STRAIN_SQUINT = 0.6;
const STRUGGLE_SIDE_ELBOW_FLARE = -0.8;

function offset(point: Pt, dx: number): Pt {
  return pt(point.x + dx, point.y);
}

/**
 * Head-on the haul is the left knee driven up with both fists under the
 * thigh, the shoulders bowed over it; the wrench is the shoulders twisted
 * and thrown back with the fists yanked out to the sides, the right heel
 * coming up.
 */
function struggleFacing(frame: number, away: boolean): CarlPose {
  const { haul, wrench } = struggleBeats(frame);
  const pose = away ? guardBack(0) : guardFront(0);
  pose.crouch = STRUGGLE_CROUCH + haul * STRUGGLE_HAUL_CROUCH;
  pose.bob = 0;
  pose.twist = wrench * STRUGGLE_FACING_TWIST;
  pose.lean = (haul - wrench) * STRUGGLE_FACING_LEAN;
  pose.headTurn = wrench * STRUGGLE_FACING_HEAD_TURN;
  pose.chinLift = -haul * STRUGGLE_FACING_CHIN + wrench * STRUGGLE_FACING_CHIN;
  pose.brow = 1;
  pose.mouth = STRUGGLE_MOUTH;
  pose.mouthWidth = STRUGGLE_MOUTH_WIDTH;
  pose.blink = haul * STRUGGLE_STRAIN_SQUINT;
  pose.leftFoot = pt(pose.leftFoot.x, -haul * STRUGGLE_FACING_HEEL_RISE);
  pose.rightFoot = pt(
    pose.rightFoot.x,
    -wrench * STRUGGLE_FACING_HEEL_RISE * STRUGGLE_FACING_WRENCH_HEEL_SHARE,
  );
  pose.leftLegNearness = haul * STRUGGLE_FACING_NEARNESS;
  pose.rightLegNearness = wrench * STRUGGLE_FACING_NEARNESS;
  pose.leftFootPlanted = haul < STRUGGLE_PLANTED_BELOW;
  pose.rightFootPlanted = wrench < STRUGGLE_PLANTED_BELOW;
  pose.torsoPitch = haul * STRUGGLE_FACING_HAUL_PITCH;
  const view = away ? VIEWS.back : VIEWS.front;
  const skeleton = buildSkeleton(pose, view);
  // The haul bends him over the stuck leg, pitched toward the way he faces,
  // which is what brings both hands down to it head-on: one round the outside
  // of the thigh, one over the front of the knee, heaving it up. Upright, his
  // arms cannot reach a knee, and one fist at the hip beside the other arm
  // hanging reads as a lopsided slouch rather than as pulling. The wrench then
  // pulls both fists in to the chest, elbows out, as if hauling on a rope.
  const hauledKnee = skeleton.leftLeg.joint;
  const leftRest = pt(
    hauledKnee.x - STRUGGLE_FACING_THIGH_GRIP_OUT,
    hauledKnee.y - STRUGGLE_FACING_THIGH_GRIP_UP,
  );
  const rightRest = pt(hauledKnee.x + STRUGGLE_FACING_KNEE_GRIP_IN, hauledKnee.y);
  const leftYank = pt(
    -STRUGGLE_FACING_CHEST_SPREAD,
    skeleton.leftShoulder.y + STRUGGLE_FACING_CHEST_DROP,
  );
  const rightYank = pt(
    STRUGGLE_FACING_CHEST_SPREAD,
    skeleton.rightShoulder.y + STRUGGLE_FACING_CHEST_DROP,
  );
  const between = 1 - Math.max(haul, wrench);
  const leftHang = pt(
    skeleton.leftShoulder.x - STRUGGLE_FACING_HANG_OUT,
    skeleton.leftShoulder.y + HAND_HANG_DROP,
  );
  const rightHang = pt(
    skeleton.rightShoulder.x + STRUGGLE_FACING_HANG_OUT,
    skeleton.rightShoulder.y + HAND_HANG_DROP,
  );
  const blend = (hang: Pt, hauled: Pt, yanked: Pt): Pt =>
    pt(
      hang.x * between + hauled.x * haul + yanked.x * wrench,
      hang.y * between + hauled.y * haul + yanked.y * wrench,
    );
  pose.leftHand = blend(leftHang, leftRest, leftYank);
  pose.rightHand = blend(rightHang, rightRest, rightYank);
  pose.elbowFlare = STRUGGLE_FACING_ELBOW_FLARE;
  // Bent over, the hauling hands are out ahead of his chest, over his thighs.
  pose.leftHandDepth = haul * STRUGGLE_FACING_HAUL_HAND_DEPTH;
  pose.rightHandDepth = haul * STRUGGLE_FACING_HAUL_HAND_DEPTH;
  pose.leftFist = STRUGGLE_FIST;
  pose.rightFist = STRUGGLE_FIST;
  pose.hairFlow = (haul - wrench) * STRUGGLE_HAIR;
  pose.jacketFlare = Math.max(haul, wrench) * STRUGGLE_JACKET;
  return pose;
}

const STRUGGLE_FACING_TWIST = 0.5;
const STRUGGLE_FACING_LEAN = deg(9);
const STRUGGLE_FACING_HEAD_TURN = 0.35;
const STRUGGLE_FACING_CHIN = 0.5;
/** Head-on a knee hauled up shows as the foot rising a little off its stuck spot. */
const STRUGGLE_FACING_HEEL_RISE = 0.1;
const STRUGGLE_FACING_WRENCH_HEEL_SHARE = 0.5;
const STRUGGLE_FACING_NEARNESS = 0.6;
/** A foot hauled up less than this share of the way still bears weight. */
const STRUGGLE_PLANTED_BELOW = 0.05;
/** Bent over the hauled leg, radians of pitch about the hips at the top of the haul. */
const STRUGGLE_FACING_HAUL_PITCH = 0.95;
/** The outer hand grips the thigh this far outside and above the knee. */
const STRUGGLE_FACING_THIGH_GRIP_OUT = 0.09;
const STRUGGLE_FACING_THIGH_GRIP_UP = 0.04;
/** The inner hand cups the front of the knee, just inboard of its centre. */
const STRUGGLE_FACING_KNEE_GRIP_IN = 0.07;
const STRUGGLE_FACING_HAUL_HAND_DEPTH = 0.2;
const STRUGGLE_FACING_CHEST_SPREAD = 0.2;
const STRUGGLE_FACING_CHEST_DROP = 0.1;
const STRUGGLE_FACING_HANG_OUT = 0.05;
const STRUGGLE_FACING_ELBOW_FLARE = 1.2;

function struggleFront(frame: number): CarlPose {
  return struggleFacing(frame, false);
}

function struggleBack(frame: number): CarlPose {
  return struggleFacing(frame, true);
}

// ── On the floor ─────────────────────────────────────────────────────────────

/**
 * Lying down, the hip joint sits this far off the floor: the buttock under it
 * is about this thick on a heavy man.
 */
const HIP_ON_FLOOR = 0.11;
/** How much `bob` puts a standing hip at a given height above the floor. */
function bobForHipHeight(height: number, crouch: number): number {
  return Math.abs(HIP_Y) - crouch * CROUCH_DROP - height;
}

/**
 * The head follows only part of the torso's lean on its own
 * (`HEAD_LEAN_FOLLOW` in the head painter); a body lying flat has to carry the
 * head all the way round with it, so the rest is added as tilt.
 */
const HEAD_LEAN_REMAINDER = 0.75;

/**
 * Where a knee resting on the floor has its joint: the kneecap under it is a
 * little under a tenth of a unit thick.
 */
const KNEE_ON_FLOOR = 0.07;

/**
 * A leg kneeling in profile: the knee on the floor at `kneeX`, the shin laid
 * back along the floor behind it, the toes tucked under. Returns the foot
 * target and pitch that put it there given where the hip is; the leg's own
 * solve then finds that knee, since hip→knee is a thigh and knee→ankle a shin.
 */
function kneelingLeg(kneeX: number, shinRise: number): { foot: Pt; pitch: number } {
  const ankle = pt(
    kneeX - SHIN_LENGTH * Math.cos(shinRise),
    -KNEE_ON_FLOOR - SHIN_LENGTH * Math.sin(shinRise),
  );
  return { foot: profileFootTarget(ankle, KNEELING_TOE_PITCH), pitch: KNEELING_TOE_PITCH };
}

/** Toes tucked under a kneeling foot, the heel up: the foot nearly on end. */
const KNEELING_TOE_PITCH = deg(70);

/** The hip height of an upright kneel on a knee at the floor. */
const KNEELING_HIP_HEIGHT = KNEE_ON_FLOOR + THIGH_LENGTH * 0.98;

/**
 * A pose with everything the collapse, the fall and the rise share: the face
 * gone slack, the fists open.
 */
function floorPose(): CarlPose {
  const pose = restingPose();
  pose.brow = FLOOR_BROW;
  pose.leftFist = LIMP_HAND;
  pose.rightFist = LIMP_HAND;
  return pose;
}

const FLOOR_BROW = 0.3;
const LIMP_HAND = 0.3;

/**
 * Hands placed relative to their own shoulders, once the torso is posed —
 * which is the only way to lay an arm on the floor beside a body whose
 * shoulders move with its lean.
 */
function placeHandsFromShoulders(pose: CarlPose, left: Pt, right: Pt): void {
  const skeleton = buildSkeleton(pose, VIEWS.side);
  pose.leftHand = pt(skeleton.leftShoulder.x + left.x, skeleton.leftShoulder.y + left.y);
  pose.rightHand = pt(skeleton.rightShoulder.x + right.x, skeleton.rightShoulder.y + right.y);
}

// ── Knockdown and lying out cold ─────────────────────────────────────────────

/**
 * Where the far heel rests, out from under the hip: far enough that the leg
 * lies nearly straight, a hair inside its reach so the knee does not lock.
 */
const LYING_FAR_HEEL_X = 0.89;
/** Supine feet fall open, toes up and out: pitched well back past level. */
const LYING_FOOT_PITCH = deg(-65);
/** A supine foot rests on its heel, the rest of it tipped up off the floor. */
function supineFoot(heelX: number): Pt {
  return profileFootTarget(ankleOverPivot(heelX, 'heel', LYING_FOOT_PITCH), LYING_FOOT_PITCH);
}
const LYING_LEFT_FOOT = supineFoot(LYING_FAR_HEEL_X);
/**
 * The near knee is drawn up, its foot flat on the floor: a body laid out dead
 * straight reads as a corpse, and one bent knee is the sprawl of a man who
 * will get up again.
 */
const LYING_NEAR_FOOT_X = 0.56;
const LYING_NEAR_FOOT_PITCH = 0;
const LYING_RIGHT_FOOT = pt(LYING_NEAR_FOOT_X, 0);
/**
 * The out-cold sprawl: the far arm flung back past his head along the floor,
 * where it shows beyond the skull rather than across the face, and the near
 * arm laid straight down his side.
 */
const LYING_LEFT_HAND = pt(-0.52, 0.16);
const LYING_RIGHT_HAND = pt(0.55, 0.17);

/** The torso's lean, flat on his back, and how far the breath lifts the chest. */
const SUPINE_LEAN = deg(-90);
const BREATH_LEAN = deg(4);
/**
 * Flat on his back the upper back curls a little off the floor at the waist
 * — the shoulders' own thickness props them — so the body line bends through
 * the waist rather than lying hip to crown as one plank.
 */
const SUPINE_SPINE_BEND = deg(8);
/**
 * Face down, the chest rests on the forearms braced beside his head, so the
 * shoulders ride up off the floor over the waist.
 */
const PRONE_SPINE_BEND = deg(-7);

const KNOCKDOWN_LAST = KNOCKDOWN_FRAMES - 1;

/**
 * Knocked off his feet by a blow from in front, in four beats. The impact:
 * head snapped back, the upper back whipped back further than the hips, both
 * arms flung up by it. The stagger: rocked back onto the rear foot, the lead
 * foot coming up off the floor, the arms windmilling. The fall: the knees
 * buckle, the back curls and the chin tucks the way a falling man's does, and
 * the near arm reaches back to break the fall as the hip drops past his heels.
 * The landing: he sits down hard, rolls back flat, the head knocks the floor
 * and the legs, carried up by the roll, drop — ending flat on his back with
 * his face to the ceiling, the lying loop's first frame.
 *
 * Dying is a different fall on purpose: the killing blow sags him forward onto
 * his knees and his face, and nothing in this row goes forward.
 */
const KNOCKDOWN_HIP_HEIGHT: Track = [
  [0, 0.97],
  [1, 0.94],
  [2, 0.74],
  [3, 0.44],
  [4, HIP_ON_FLOOR + 0.04],
  [5, HIP_ON_FLOOR],
  [6, HIP_ON_FLOOR],
  [7, HIP_ON_FLOOR],
  [8, HIP_ON_FLOOR],
  [KNOCKDOWN_LAST, HIP_ON_FLOOR],
];
const KNOCKDOWN_LEAN: Track = [
  [0, deg(-20)],
  [1, deg(-28)],
  [2, deg(-36)],
  [3, deg(-52)],
  [4, deg(-66)],
  [5, deg(-84)],
  [6, deg(-93)],
  [7, deg(-89)],
  [8, deg(-91)],
  [KNOCKDOWN_LAST, SUPINE_LEAN],
];
/**
 * The upper back bent on the hips: whipped back by the impact, then curled
 * forward — chin to chest — through the fall, and flattened onto the floor.
 */
const KNOCKDOWN_SPINE_BEND: Track = [
  [0, deg(-14)],
  [1, deg(-6)],
  [2, deg(8)],
  [3, deg(12)],
  [4, deg(12)],
  [5, deg(8)],
  [6, deg(4)],
  [7, SUPINE_SPINE_BEND],
  [8, SUPINE_SPINE_BEND],
  [KNOCKDOWN_LAST, SUPINE_SPINE_BEND],
];
const KNOCKDOWN_HEAD_TILT: Track = [
  [0, deg(-40)],
  [1, deg(-24)],
  [2, deg(16)],
  [3, deg(26)],
  [4, deg(22)],
  [5, deg(10)],
  [6, deg(-14)],
  [7, deg(-4)],
  [8, 0],
  [KNOCKDOWN_LAST, 0],
];
const KNOCKDOWN_BLINK: Track = [
  [0, 0.7],
  [1, 0.55],
  [2, 0.7],
  [3, 0.85],
  [4, 0.95],
  [5, 1],
  [KNOCKDOWN_LAST, 1],
];
const KNOCKDOWN_MOUTH: Track = [
  [0, 0.7],
  [1, 0.5],
  [3, 0.35],
  [KNOCKDOWN_LAST, 0.3],
];
const KNOCKDOWN_HAIR: Track = [
  [0, 0.8],
  [1, 0.5],
  [3, 0.2],
  [5, -0.3],
  [KNOCKDOWN_LAST, -0.3],
];

/**
 * The feet, in figure space. The lead (far) foot comes up off the floor as
 * he rocks back and is carried up ahead of him by the fall; the rear (near)
 * foot takes his weight through the stagger, then is swept out forward as he
 * sits down past it. Both then drop to where the lying loop lays them.
 */
const KNOCKDOWN_LEFT_FOOT: readonly Pt[] = [
  pt(0.14, 0),
  pt(0.2, -0.05),
  pt(0.3, -0.14),
  pt(0.44, -0.2),
  pt(0.6, -0.2),
  pt(0.74, -0.18),
  pt(0.78, -0.03),
];
const KNOCKDOWN_LEFT_PITCH: readonly number[] = [0, -15, -25, -30, -40, -50, -60].map(deg);
const KNOCKDOWN_RIGHT_FOOT: readonly Pt[] = [
  pt(-0.12, 0),
  pt(-0.12, 0),
  pt(-0.12, 0),
  pt(0.04, -0.02),
  pt(0.34, -0.04),
  pt(0.58, -0.08),
  pt(0.74, -0.01),
];
const KNOCKDOWN_RIGHT_PITCH: readonly number[] = [0, 0, 0, -10, -30, -45, -60].map(deg);
/** The last frame the rear foot bears his weight, before it is swept out from under him. */
const KNOCKDOWN_REAR_FOOT_PLANTED_THROUGH = 2;

/**
 * The arms by their joints while he is still on his feet: the far one flung
 * up ahead of him by the impact and windmilling over his head, the near one
 * flung forward and then thrown back behind him.
 */
const KNOCKDOWN_LEFT_ARM: readonly ArmAngles[] = [
  { upper: deg(110), fore: deg(140), foreScale: 1 },
  { upper: deg(160), fore: deg(185), foreScale: 1 },
  { upper: deg(100), fore: deg(125), foreScale: 1 },
  { upper: deg(70), fore: deg(95), foreScale: 1 },
  { upper: deg(50), fore: deg(70), foreScale: 1 },
];
const KNOCKDOWN_RIGHT_ARM: readonly ArmAngles[] = [
  { upper: deg(75), fore: deg(100), foreScale: 1 },
  { upper: deg(-35), fore: deg(-15), foreScale: 1 },
];
/**
 * The near hand reaching back for the floor, relative to its shoulder, until
 * it gets there; from then on its palm is on the floor behind the hip.
 */
const KNOCKDOWN_REACH_BACK = pt(-0.22, 0.55);
const KNOCKDOWN_BRACE_BEHIND = 0.28;
/** The first frame the near palm is on the floor, bracing the fall. */
const KNOCKDOWN_BRACED_FRAME = 4;
/** From here the arms are laid out on the floor, landing over the next frames. */
const KNOCKDOWN_ARMS_LAND_FROM = 5;
const KNOCKDOWN_ARMS_LANDED = 7;
/** Where each hand is, relative to its shoulder, as his back hits the floor. */
const KNOCKDOWN_FAR_HAND_THROWN = pt(0.3, -0.25);
const KNOCKDOWN_NEAR_HAND_THROWN = pt(-0.25, 0.3);
/** The far foot is off the floor while it is carried up by the fall. */
const KNOCKDOWN_LEAD_FOOT_PLANTED_THROUGH = 0;
/** The first frame the legs have dropped all the way to the lying loop's. */
const KNOCKDOWN_LEGS_DOWN_FRAME = 7;
const KNOCKDOWN_HANDS_OPEN = 0.2;

/** A per-frame table's entry, or nothing past its end. */
function entryAt<T>(table: readonly T[], frame: number): T | undefined {
  return frame >= 0 && frame < table.length ? table[frame] : undefined;
}

function knockdownLegs(pose: CarlPose, frame: number): void {
  if (frame >= KNOCKDOWN_LEGS_DOWN_FRAME) {
    pose.leftFoot = LYING_LEFT_FOOT;
    pose.rightFoot = LYING_RIGHT_FOOT;
    pose.leftFootPitch = LYING_FOOT_PITCH;
    pose.rightFootPitch = LYING_NEAR_FOOT_PITCH;
    pose.leftFootPlanted = false;
    pose.rightFootPlanted = false;
    return;
  }
  pose.leftFoot = entryAt(KNOCKDOWN_LEFT_FOOT, frame) ?? LYING_LEFT_FOOT;
  pose.rightFoot = entryAt(KNOCKDOWN_RIGHT_FOOT, frame) ?? LYING_RIGHT_FOOT;
  pose.leftFootPitch = entryAt(KNOCKDOWN_LEFT_PITCH, frame) ?? LYING_FOOT_PITCH;
  pose.rightFootPitch = entryAt(KNOCKDOWN_RIGHT_PITCH, frame) ?? LYING_NEAR_FOOT_PITCH;
  pose.leftFootPlanted = frame <= KNOCKDOWN_LEAD_FOOT_PLANTED_THROUGH;
  pose.rightFootPlanted = frame <= KNOCKDOWN_REAR_FOOT_PLANTED_THROUGH;
}

function knockdownArms(pose: CarlPose, frame: number): void {
  const leftArm = entryAt(KNOCKDOWN_LEFT_ARM, frame);
  const rightArm = entryAt(KNOCKDOWN_RIGHT_ARM, frame);
  if (frame >= KNOCKDOWN_ARMS_LAND_FROM) {
    const landed = clamp01(
      (frame - KNOCKDOWN_ARMS_LAND_FROM + 1) /
        (KNOCKDOWN_ARMS_LANDED - KNOCKDOWN_ARMS_LAND_FROM + 1),
    );
    placeHandsFromShoulders(
      pose,
      mixPt(KNOCKDOWN_FAR_HAND_THROWN, LYING_LEFT_HAND, landed),
      mixPt(KNOCKDOWN_NEAR_HAND_THROWN, LYING_RIGHT_HAND, landed),
    );
    pose.elbowFlare = LIMP_ELBOW_FLARE;
    return;
  }
  if (leftArm !== undefined) setArmAngles(pose, 'left', leftArm);
  if (rightArm !== undefined) {
    setArmAngles(pose, 'right', rightArm);
    return;
  }
  const skeleton = buildSkeleton(pose, VIEWS.side);
  const shoulder = skeleton.rightShoulder;
  pose.rightHand =
    frame >= KNOCKDOWN_BRACED_FRAME
      ? pt(shoulder.x - KNOCKDOWN_BRACE_BEHIND, -HAND_ON_FLOOR)
      : pt(
          shoulder.x + KNOCKDOWN_REACH_BACK.x,
          Math.min(-HAND_ON_FLOOR, shoulder.y + KNOCKDOWN_REACH_BACK.y),
        );
  pose.elbowFlare = LIMP_ELBOW_FLARE;
}

function knockdownSide(frame: number): CarlPose {
  const pose = floorPose();
  pose.lean = trackAt(frame, KNOCKDOWN_LEAN);
  pose.spineBend = trackAt(frame, KNOCKDOWN_SPINE_BEND);
  pose.bob = bobForHipHeight(trackAt(frame, KNOCKDOWN_HIP_HEIGHT), 0);
  pose.headTilt = trackAt(frame, KNOCKDOWN_HEAD_TILT) + pose.lean * HEAD_LEAN_REMAINDER;
  pose.blink = trackAt(frame, KNOCKDOWN_BLINK);
  pose.brow = frame === 0 ? 1 : FLOOR_BROW;
  pose.mouth = trackAt(frame, KNOCKDOWN_MOUTH);
  pose.leftFist = KNOCKDOWN_HANDS_OPEN;
  pose.rightFist = KNOCKDOWN_HANDS_OPEN;
  knockdownLegs(pose, frame);
  knockdownArms(pose, frame);
  pose.hairFlow = trackAt(frame, KNOCKDOWN_HAIR);
  pose.jacketFlare = frame < KNOCKDOWN_ARMS_LAND_FROM ? KNOCKDOWN_JACKET_FLARE : 0;
  return pose;
}

const KNOCKDOWN_JACKET_FLARE = 0.5;
const LIMP_ELBOW_FLARE = -0.3;

/** Flat on his back, eyes shut, breathing slow. */
function knockedOutSide(frame: number): CarlPose {
  const breath = (1 - Math.cos((frame / KNOCKED_OUT_FRAMES) * TWO_PI)) / 2;
  const pose = knockdownSide(KNOCKDOWN_LAST);
  pose.lean = SUPINE_LEAN + breath * BREATH_LEAN;
  pose.headTilt = pose.lean * HEAD_LEAN_REMAINDER;
  pose.mouth = KNOCKED_OUT_MOUTH + breath * KNOCKED_OUT_MOUTH_BREATH;
  placeHandsFromShoulders(pose, LYING_LEFT_HAND, LYING_RIGHT_HAND);
  return pose;
}

const KNOCKED_OUT_MOUTH = 0.2;
const KNOCKED_OUT_MOUTH_BREATH = 0.15;

// ── Revive ───────────────────────────────────────────────────────────────────

const REVIVE_LAST = REVIVE_FRAMES - 1;

/**
 * Coming round: the head lifts, he props himself up on his elbows and sits up,
 * tucks his feet in and rolls forward onto the near knee, pushes up off the
 * far knee with his hand on it, and shakes his head clear standing.
 */
const REVIVE_HIP_HEIGHT: Track = [
  [0, HIP_ON_FLOOR],
  [3, HIP_ON_FLOOR],
  [4, HIP_ON_FLOOR + 0.02],
  [5, 0.36],
  [6, KNEELING_HIP_HEIGHT],
  [7, 0.66],
  [8, 0.86],
  [9, Math.abs(HIP_Y) - 0.014],
  // Pinned, or the curve rising out of the push-up overshoots here and
  // straightens the staggered legs past their reach.
  [10, Math.abs(HIP_Y) - 0.013],
  [REVIVE_LAST, Math.abs(HIP_Y) - 0.012],
];
/** By this frame he is up on his elbows and the lying curl has gone out of his back. */
const REVIVE_SPINE_STRAIGHT_FRAME = 2;
const REVIVE_LEAN: Track = [
  [0, SUPINE_LEAN],
  [1, deg(-84)],
  [2, deg(-62)],
  [3, deg(-30)],
  [4, deg(12)],
  [5, deg(38)],
  [6, deg(24)],
  [7, deg(30)],
  [8, deg(14)],
  [9, deg(2)],
  [REVIVE_LAST, 0],
];
const REVIVE_HEAD_TILT: Track = [
  [0, 0],
  [1, deg(28)],
  [2, deg(34)],
  [3, deg(24)],
  [4, deg(14)],
  [6, deg(8)],
  [8, deg(-4)],
  [REVIVE_LAST, 0],
];
/** The head shake: a turn toward the camera and back, twice, standing. */
const REVIVE_HEAD_TURN: Track = [
  [0, 0],
  [8, 0.15],
  [9, 0.55],
  [10, -0.1],
  [REVIVE_LAST, 0.2],
];
const REVIVE_BLINK: Track = [
  [0, 1],
  [1, 0.6],
  [2, 0.2],
  [9, 0.5],
  [10, 0.6],
  [REVIVE_LAST, 0],
];

function reviveLegs(pose: CarlPose, frame: number): void {
  if (frame <= REVIVE_TUCKED_FRAME) {
    // Knees drawn up as he sits: the feet slide in toward the hip, the near
    // one right in under it, ready to take a knee over. Most of the slide is
    // done early, while he is still propped back: on the frame he rocks
    // forward over them the feet are already nearly home, so the legs are not
    // seen to jump in under him at the same moment the body swings over them.
    const tuck = easeOut(clamp01(frame / REVIVE_TUCKED_FRAME));
    pose.leftFoot = mixPt(LYING_LEFT_FOOT, pt(REVIVE_FAR_FOOT_TUCKED_X, 0), tuck);
    pose.rightFoot = mixPt(LYING_RIGHT_FOOT, pt(REVIVE_NEAR_FOOT_TUCKED_X, 0), tuck);
    pose.leftFootPitch = LYING_FOOT_PITCH * (1 - tuck);
    pose.rightFootPitch = LYING_NEAR_FOOT_PITCH * (1 - tuck);
    return;
  }
  if (frame <= REVIVE_KNEELING_THROUGH_FRAME) {
    // Rolled forward over the feet: the far foot planted ahead, the near knee
    // on the floor under him.
    const kneel = kneelingLeg(REVIVE_KNEE_X, REVIVE_SHIN_RISE);
    pose.rightFoot = kneel.foot;
    pose.rightFootPitch = kneel.pitch;
    pose.leftFoot = pt(REVIVE_FAR_FOOT_X, 0);
    pose.leftFootPlanted = true;
    return;
  }
  // Up off the knee: the near foot comes forward under him and plants.
  const up = clamp01(
    (frame - REVIVE_KNEELING_THROUGH_FRAME) /
      (REVIVE_STANDING_FRAME - REVIVE_KNEELING_THROUGH_FRAME),
  );
  const kneel = kneelingLeg(REVIVE_KNEE_X, REVIVE_SHIN_RISE);
  const stand = idleSide(0);
  pose.leftFoot = mixPt(pt(REVIVE_FAR_FOOT_X, 0), stand.leftFoot, up);
  pose.rightFoot = mixPt(kneel.foot, stand.rightFoot, up);
  pose.rightFootPitch = kneel.pitch * (1 - up);
  pose.leftFootPlanted = true;
  pose.rightFootPlanted = up >= 1;
}

/** The last frame he is still sitting, feet drawn in, before he rolls onto a knee. */
const REVIVE_TUCKED_FRAME = 4;
const REVIVE_FAR_FOOT_TUCKED_X = 0.4;
const REVIVE_NEAR_FOOT_TUCKED_X = 0.12;
/** The last frame he is on a knee, pushing off it. */
const REVIVE_KNEELING_THROUGH_FRAME = 6;
/** On his feet: the head shake plays from here. */
const REVIVE_STANDING_FRAME = 9;
const REVIVE_KNEE_X = -0.12;
const REVIVE_SHIN_RISE = deg(6);
const REVIVE_FAR_FOOT_X = 0.26;

/**
 * Where the hands go on the way up: propped behind him on the floor, then
 * planted beside the hip as he rolls over, then the far hand on the far knee
 * to push off, then hanging.
 */
const REVIVE_LEFT_HAND: PointTrack = [
  [0, LYING_LEFT_HAND],
  [2, pt(-0.1, 0.3)],
  [3, pt(-0.28, 0.42)],
  [4, pt(0.12, 0.6)],
  [5, pt(0.2, 0.55)],
  [6, pt(0.2, 0.42)],
  [7, pt(0.14, 0.44)],
  [9, pt(-0.04, 0.6)],
  [REVIVE_LAST, pt(-0.05, 0.6)],
];
const REVIVE_RIGHT_HAND: PointTrack = [
  [0, LYING_RIGHT_HAND],
  [2, pt(-0.18, 0.32)],
  [3, pt(-0.3, 0.42)],
  [4, pt(0.05, 0.58)],
  [5, pt(0.1, 0.62)],
  [6, pt(0.02, 0.6)],
  [9, pt(-0.02, 0.6)],
  [REVIVE_LAST, pt(-0.02, 0.6)],
];

function reviveSide(frame: number): CarlPose {
  const pose = floorPose();
  pose.lean = trackAt(frame, REVIVE_LEAN);
  // The curl he lay in straightens as he props himself up.
  pose.spineBend = SUPINE_SPINE_BEND * (1 - clamp01(frame / REVIVE_SPINE_STRAIGHT_FRAME));
  pose.bob = bobForHipHeight(trackAt(frame, REVIVE_HIP_HEIGHT), 0);
  pose.headTilt = trackAt(frame, REVIVE_HEAD_TILT) + Math.min(0, pose.lean) * HEAD_LEAN_REMAINDER;
  pose.headTurn = trackAt(frame, REVIVE_HEAD_TURN);
  pose.blink = trackAt(frame, REVIVE_BLINK);
  pose.brow = frame > 0 ? REVIVE_BROW : FLOOR_BROW;
  reviveLegs(pose, frame);
  placeHandsFromShoulders(
    pose,
    pointAt(frame, REVIVE_LEFT_HAND),
    pointAt(frame, REVIVE_RIGHT_HAND),
  );
  pose.elbowFlare = LIMP_ELBOW_FLARE;
  pose.hairFlow = frame >= REVIVE_STANDING_FRAME ? -trackAt(frame, REVIVE_HEAD_TURN) : 0;
  return pose;
}

const REVIVE_BROW = 0.8;

// ── Death ────────────────────────────────────────────────────────────────────

const DEATH_LAST = DEATH_FRAMES - 1;

/**
 * The killing blow: his head goes back, the knees buckle and he drops onto
 * both of them, pitches forward and catches himself on his hands, and the
 * arms give and he goes down flat on his face. Held on the last frame.
 */
const DEATH_HIP_HEIGHT: Track = [
  [0, Math.abs(HIP_Y) - 0.01],
  [1, 0.82],
  [2, 0.62],
  [3, KNEELING_HIP_HEIGHT],
  [4, KNEELING_HIP_HEIGHT - 0.02],
  [5, 0.42],
  [6, 0.28],
  [7, HIP_ON_FLOOR + 0.03],
  [8, HIP_ON_FLOOR - 0.01],
  [DEATH_LAST, HIP_ON_FLOOR],
];
const DEATH_LEAN: Track = [
  [0, deg(-10)],
  [1, deg(6)],
  [2, deg(10)],
  [3, deg(16)],
  [4, deg(42)],
  [5, deg(62)],
  [6, deg(74)],
  [7, deg(88)],
  [8, deg(91)],
  [DEATH_LAST, deg(90)],
];
const DEATH_HEAD_TILT: Track = [
  [0, deg(-26)],
  [1, deg(10)],
  [2, deg(24)],
  [3, deg(20)],
  [4, deg(-6)],
  [5, deg(-18)],
  [6, deg(-10)],
  [7, deg(0)],
  [DEATH_LAST, deg(4)],
];
/** Knees under him as he goes down, then the legs straighten out behind. */
const DEATH_KNEE_X: Track = [
  [2, 0.06],
  [3, 0.04],
  [4, 0.02],
  [5, -0.1],
  [6, -0.3],
];
/** Hands out for the floor, then under the shoulders, then flat beside the head. */
const DEATH_HANDS: PointTrack = [
  [0, pt(-0.06, 0.6)],
  [1, pt(0.02, 0.6)],
  [2, pt(0.1, 0.55)],
  [3, pt(0.2, 0.5)],
  [4, pt(0.34, 0.42)],
  [5, pt(0.4, 0.36)],
  [6, pt(0.46, 0.18)],
  [7, pt(0.56, 0.02)],
  [DEATH_LAST, pt(0.58, 0)],
];
const DEATH_BLINK: Track = [
  [0, 0.5],
  [1, 0.7],
  [3, 0.9],
  [5, 1],
  [DEATH_LAST, 1],
];
/** The prone body's feet: laid out behind, toes to the floor. */
const PRONE_FOOT_X = -0.8;
const PRONE_FOOT_PITCH = deg(80);

function deathLegs(pose: CarlPose, frame: number): void {
  if (frame <= DEATH_STANDING_THROUGH_FRAME) {
    pose.leftFoot = pt(DEATH_STANCE_HALF, 0);
    pose.rightFoot = pt(-DEATH_STANCE_HALF, 0);
    pose.leftFootPlanted = true;
    pose.rightFootPlanted = true;
    return;
  }
  if (frame <= DEATH_KNEELING_THROUGH_FRAME) {
    const knee = trackAt(frame, DEATH_KNEE_X);
    const left = kneelingLeg(knee + DEATH_FAR_KNEE_AHEAD, DEATH_SHIN_RISE);
    const right = kneelingLeg(knee, DEATH_SHIN_RISE);
    pose.leftFoot = left.foot;
    pose.rightFoot = right.foot;
    pose.leftFootPitch = left.pitch;
    pose.rightFootPitch = right.pitch;
    return;
  }
  pose.leftFoot = pt(PRONE_FOOT_X + DEATH_FAR_KNEE_AHEAD, 0);
  pose.rightFoot = pt(PRONE_FOOT_X, 0);
  pose.leftFootPitch = PRONE_FOOT_PITCH;
  pose.rightFootPitch = PRONE_FOOT_PITCH;
  pose.leftKneeBreak = -1;
  pose.rightKneeBreak = -1;
}

/** Still on his feet as the knees go, stance a little under hip width. */
const DEATH_STANDING_THROUGH_FRAME = 1;
const DEATH_STANCE_HALF = 0.08;
/** Both knees on the floor. */
const DEATH_KNEES_DOWN_FRAME = 3;
/** The last frame the knees are under him, before the legs slide out behind. */
const DEATH_KNEELING_THROUGH_FRAME = 6;
const DEATH_FAR_KNEE_AHEAD = 0.05;
const DEATH_SHIN_RISE = deg(3);

function deathSide(frame: number): CarlPose {
  const pose = floorPose();
  pose.lean = trackAt(frame, DEATH_LEAN);
  pose.bob = bobForHipHeight(trackAt(frame, DEATH_HIP_HEIGHT), 0);
  pose.headTilt = trackAt(frame, DEATH_HEAD_TILT) + Math.max(0, pose.lean) * HEAD_LEAN_REMAINDER;
  pose.blink = trackAt(frame, DEATH_BLINK);
  pose.mouth = frame === 0 ? DEATH_CRY : DEATH_SLACK_MOUTH;
  deathLegs(pose, frame);
  const hands = pointAt(frame, DEATH_HANDS);
  placeHandsFromShoulders(pose, hands, pt(hands.x + DEATH_NEAR_HAND_AHEAD, hands.y));
  if (frame >= DEATH_HANDS_DOWN_FRAME) {
    pose.leftHand = pt(pose.leftHand.x, -HAND_ON_FLOOR);
    pose.rightHand = pt(pose.rightHand.x, -HAND_ON_FLOOR);
  }
  pose.elbowFlare = frame >= DEATH_HANDS_DOWN_FRAME ? DEATH_BRACED_ELBOW : LIMP_ELBOW_FLARE;
  pose.spineBend = PRONE_SPINE_BEND * clamp01(frame - DEATH_KNEELING_THROUGH_FRAME);
  pose.leftFist = LIMP_HAND;
  pose.rightFist = LIMP_HAND;
  pose.hairFlow =
    frame <= DEATH_STANDING_THROUGH_FRAME
      ? DEATH_HAIR
      : -DEATH_HAIR * clamp01(frame - DEATH_KNEES_DOWN_FRAME);
  return pose;
}

/** From this frame his palms are on the floor: he has caught himself, and then lies on them. */
const DEATH_HANDS_DOWN_FRAME = 5;
/** A palm flat on the floor has its wrist this far off it. */
const HAND_ON_FLOOR = 0.05;
const DEATH_CRY = 0.6;
const DEATH_SLACK_MOUTH = 0.25;
const DEATH_NEAR_HAND_AHEAD = 0.06;
const DEATH_BRACED_ELBOW = -0.6;
const DEATH_HAIR = 0.4;

// ── Rows ─────────────────────────────────────────────────────────────────────

/**
 * Every reaction row, in sheet order. `HUMAN_ROW_NAMES` spreads these in, so
 * the runtime's state type carries them and the table below must name exactly
 * them.
 */
export const REACTION_ROW_NAMES = [
  'hurt',
  'hurt_side',
  'hurt_away',
  'hurt_behind',
  'hurt_behind_side',
  'hurt_behind_away',
  'stagger',
  'stagger_side',
  'stagger_away',
  'struggle',
  'struggle_side',
  'struggle_away',
  'knockdown_side',
  'knocked_out_side',
  'revive_side',
  'death_side',
] as const;

type ReactionRowName = (typeof REACTION_ROW_NAMES)[number];

const NO_IMPACT: readonly number[] = [];

/**
 * The stumble is paced by the shove, not by a clock; this hold is only what it
 * plays at if something draws it without a shove behind it.
 */
const STAGGER_FALLBACK_TICKS_PER_FRAME = 2;

function hurtRow(view: CarlView, from: HurtFrom): HumanRowDef {
  return {
    frameCount: HURT_FRAMES,
    kind: 'oneShot',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    role: 'reaction',
    ticksPerFrame: HURT_TICKS_PER_FRAME,
    pose: (frame) => hurtPose(view, from, frame),
  };
}

function viewRow(
  view: CarlView,
  frameCount: number,
  kind: 'loop' | 'oneShot',
  ticksPerFrame: number,
  locomotion: 'none' | 'planted',
  pose: (frame: number) => CarlPose,
): HumanRowDef {
  return {
    frameCount,
    kind,
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion,
    role: 'reaction',
    ticksPerFrame,
    pose,
  };
}

/**
 * The reaction rows' metadata and poses. The stumble and the floor rows have
 * no contract with the floor (`none`): in the stumble his feet are swept and
 * skid under a shove whose ground per frame depends on the blow, and in the
 * falls and the rise the feet slide out and back in along the floor as the
 * body goes down and comes up.
 */
export const REACTION_ROW_TABLE = {
  hurt: hurtRow('front', 'front'),
  hurt_side: hurtRow('side', 'front'),
  hurt_away: hurtRow('back', 'front'),
  hurt_behind: hurtRow('front', 'behind'),
  hurt_behind_side: hurtRow('side', 'behind'),
  hurt_behind_away: hurtRow('back', 'behind'),
  stagger: viewRow(
    'front',
    STAGGER_FRAMES,
    'oneShot',
    STAGGER_FALLBACK_TICKS_PER_FRAME,
    'none',
    staggerFront,
  ),
  stagger_side: viewRow(
    'side',
    STAGGER_FRAMES,
    'oneShot',
    STAGGER_FALLBACK_TICKS_PER_FRAME,
    'none',
    staggerSide,
  ),
  stagger_away: viewRow(
    'back',
    STAGGER_FRAMES,
    'oneShot',
    STAGGER_FALLBACK_TICKS_PER_FRAME,
    'none',
    staggerBack,
  ),
  struggle: viewRow(
    'front',
    STRUGGLE_FRAMES,
    'loop',
    STRUGGLE_TICKS_PER_FRAME,
    'planted',
    struggleFront,
  ),
  struggle_side: viewRow(
    'side',
    STRUGGLE_FRAMES,
    'loop',
    STRUGGLE_TICKS_PER_FRAME,
    'planted',
    struggleSide,
  ),
  struggle_away: viewRow(
    'back',
    STRUGGLE_FRAMES,
    'loop',
    STRUGGLE_TICKS_PER_FRAME,
    'planted',
    struggleBack,
  ),
  knockdown_side: viewRow(
    'side',
    KNOCKDOWN_FRAMES,
    'oneShot',
    KNOCKDOWN_TICKS_PER_FRAME,
    'none',
    knockdownSide,
  ),
  knocked_out_side: viewRow(
    'side',
    KNOCKED_OUT_FRAMES,
    'loop',
    KNOCKED_OUT_TICKS_PER_FRAME,
    'none',
    knockedOutSide,
  ),
  revive_side: viewRow(
    'side',
    REVIVE_FRAMES,
    'oneShot',
    REVIVE_TICKS_PER_FRAME,
    'none',
    reviveSide,
  ),
  death_side: viewRow('side', DEATH_FRAMES, 'oneShot', DEATH_TICKS_PER_FRAME, 'none', deathSide),
} satisfies Record<ReactionRowName, HumanRowDef>;

// ── Views ────────────────────────────────────────────────────────────────────

/** The flinch for a view and the side the blow came from. */
function hurtPose(view: CarlView, from: HurtFrom, frame: number): CarlPose {
  if (view === 'side') return hurtSide(frame, from);
  return view === 'back' ? hurtBack(frame, from) : hurtFront(frame, from);
}
