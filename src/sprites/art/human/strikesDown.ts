/**
 * Carl's strikes at something south of him, seen head-on.
 *
 * Head-on, the whole blow travels toward the camera, which is the one direction
 * a flat picture cannot show. Each strike here is sold by what does show: a
 * knee rising toward the viewer shortens and widens the leg; a body dropping
 * into the blow lowers the head against the floor; a foot reaching ahead of
 * him draws lower on the screen, where the floor ahead of him is.
 *
 * Every row starts and ends on the guard's first frame, because the guard is
 * what the animator hands back to after a blow.
 */

import { mixPt, offset, pt } from '../carl/geometry';
import { buildSkeleton, type CarlPose, FULL_UPPER_ARM, VIEWS } from '../carl/rig';
import { clamp01, lerp, type Pt } from '../carlArt';
import {
  fromRest,
  offsetTrack,
  type PathKey,
  RUN_FRAME_PHASE,
  runPhaseAt,
  sideOfSign,
  type Track,
  trackAt,
} from './gaitShared';
import { guardFront } from './idles';
import { RUN_TOE_OFF_PHASE, runFacing } from './locomotion';
import { RUNNING_STRIKE_FRAMES, RUNNING_STRIKE_IMPACT_FRAME } from './strikesSide';
import { RUN_FRAMES } from './timing';
import {
  type BlowLeg,
  blowLeg,
  entryPhasesWhere,
  keepSwingFeetInReach,
  PHASE_EPSILON,
} from './travelling';

/**
 * How far through the swing timer the hit is scored: `HumanPlayer.isAttackPeak`
 * fires when half the swing is left. Every row's impact frame is the frame the
 * runtime's progress→frame mapping shows at that moment.
 */
const ATTACK_PEAK_PROGRESS = 0.5;

/** The frame a strike row of `frameCount` frames must land its blow on. */
function impactFrameOf(frameCount: number): number {
  return Math.floor(ATTACK_PEAK_PROGRESS * frameCount);
}

export const STOMP_DOWN_FRAMES = 8;
export const PUNT_DOWN_FRAMES = 8;
export const HAMMER_DOWN_FRAMES = 8;
/**
 * Two frames longer than the others: getting up off one knee is the slowest
 * recovery in the family, and every strike lands at the same tick, so the
 * extra frames all go after the impact.
 */
export const KNEE_DROP_FRAMES = 10;

export const STOMP_DOWN_IMPACT = impactFrameOf(STOMP_DOWN_FRAMES);
export const PUNT_DOWN_IMPACT = impactFrameOf(PUNT_DOWN_FRAMES);
export const HAMMER_DOWN_IMPACT = impactFrameOf(HAMMER_DOWN_FRAMES);
export const KNEE_DROP_IMPACT = impactFrameOf(KNEE_DROP_FRAMES);

// ── Shared machinery ─────────────────────────────────────────────────────────

const GUARD = guardFront(0);
const GUARD_SKELETON = buildSkeleton(GUARD, VIEWS.front);
/** Where each guard fist sits against its own shoulder joint. */
const GUARD_RIGHT_FIST: Pt = pt(
  GUARD.rightHand.x - GUARD_SKELETON.rightShoulder.x,
  GUARD.rightHand.y - GUARD_SKELETON.rightShoulder.y,
);
const GUARD_LEFT_FIST: Pt = pt(
  GUARD.leftHand.x - GUARD_SKELETON.leftShoulder.x,
  GUARD.leftHand.y - GUARD_SKELETON.leftShoulder.y,
);

/**
 * A hand's path, keyed as how far the fist has moved from where the guard holds
 * it, and carried by its own shoulder joint — so a fist held at the face stays
 * at the face however far the body drops under it.
 */
interface HandPath {
  readonly x: Track;
  readonly y: Track;
}

function handPath(
  guard: Pt,
  lastFrame: number,
  keys: readonly (readonly [number, Pt])[],
): HandPath {
  return {
    x: fromRest(
      guard.x,
      lastFrame,
      keys.map(([frame, p]): PathKey => [frame, guard.x + p.x]),
    ),
    y: fromRest(
      guard.y,
      lastFrame,
      keys.map(([frame, p]): PathKey => [frame, guard.y + p.y]),
    ),
  };
}

/**
 * A hand-path key for a fist at `at` against its own shoulder joint, rather
 * than as a move away from the guard: a fist flung out or thrown down is
 * placed by where the arm reaches, not by how far it travelled.
 */
function atShoulder(guardFist: Pt, x: number, y: number): Pt {
  return pt(x - guardFist.x, y - guardFist.y);
}

/** The guard draws each upper arm short, driven toward the camera; absent is the whole arm. */
const GUARD_RIGHT_UPPER_ARM = GUARD.rightUpperArmScale ?? FULL_UPPER_ARM;
const GUARD_LEFT_UPPER_ARM = GUARD.leftUpperArmScale ?? FULL_UPPER_ARM;
/**
 * How far a fist travels from its guard place, in tile units, before its upper
 * arm has swung back into the picture plane and draws whole: a fist raised
 * overhead or driven down to the floor is reached along the screen, not at
 * the camera.
 */
const FIST_TRAVEL_TO_WHOLE_ARM = 0.25;

function upperArmScaleFor(fistFromShoulder: Pt, guardFist: Pt, guardScale: number): number {
  const travel = Math.hypot(fistFromShoulder.x - guardFist.x, fistFromShoulder.y - guardFist.y);
  return lerp(guardScale, FULL_UPPER_ARM, clamp01(travel / FIST_TRAVEL_TO_WHOLE_ARM));
}

/** Sets both hands from their paths, against the shoulders of the body as already posed. */
function placeHands(pose: CarlPose, frame: number, right: HandPath, left: HandPath): void {
  const skeleton = buildSkeleton(pose, VIEWS.front);
  const rightFist = pt(trackAt(frame, right.x), trackAt(frame, right.y));
  const leftFist = pt(trackAt(frame, left.x), trackAt(frame, left.y));
  pose.rightHand = offset(skeleton.rightShoulder, rightFist.x, rightFist.y);
  pose.leftHand = offset(skeleton.leftShoulder, leftFist.x, leftFist.y);
  pose.rightUpperArmScale = upperArmScaleFor(rightFist, GUARD_RIGHT_FIST, GUARD_RIGHT_UPPER_ARM);
  pose.leftUpperArmScale = upperArmScaleFor(leftFist, GUARD_LEFT_FIST, GUARD_LEFT_UPPER_ARM);
}

/**
 * A head-on foot placed in three dimensions: sideways, lift, and how far ahead
 * of the hip — toward the camera — it reaches. A foot on the floor ahead of
 * him keeps its depth, drawn lower on the screen where the floor nearer the
 * camera is; one back under his hip returns to the guard's flat,
 * picture-plane leg, so the row hands back to the guard without the knee
 * jumping.
 */
function placeRightFoot(pose: CarlPose, x: number, lift: number, depth: number): void {
  pose.rightFoot = pt(x, -Math.max(lift, 0));
  const offTheHipLine = lift > 0 || depth > FOOT_ON_HIP_LINE;
  if (offTheHipLine) pose.rightFootDepth = depth;
  pose.rightFootPlanted = lift <= 0;
}

/** Under this depth a planted foot stands on the hip's own ground line. */
const FOOT_ON_HIP_LINE = 1e-3;

// ── Stomp ────────────────────────────────────────────────────────────────────

const STOMP_LAST = STOMP_DOWN_FRAMES - 1;
const STOMP_APEX = STOMP_DOWN_IMPACT - 1;

/**
 * The stamping foot: a dip loads the stance leg, the knee comes up high at
 * the camera with the shin hanging under it — far enough toward the camera
 * that the knee and shin are painted over the shorts, which is the only
 * silhouette a knee pointed at the viewer has; swung out to the side instead
 * it reads as a leg cocked at a post — and at the top of the chamber the heel
 * is driven down through the target, landing back where the guard stands it
 * and staying there, pressed home, for the rest of the row.
 */
const STOMP_LIFT: Track = [
  [0, 0],
  [1, 0.1],
  [2, 0.5],
  [STOMP_APEX, 0.7],
  [STOMP_DOWN_IMPACT, 0],
  [5, 0],
  [6, 0],
  [STOMP_LAST, 0],
];
const STOMP_FOOT_X: Track = fromRest(GUARD.rightFoot.x, STOMP_LAST, [
  [1, 0.14],
  [2, 0.12],
  [STOMP_APEX, 0.1],
  [STOMP_DOWN_IMPACT, GUARD.rightFoot.x],
  [5, GUARD.rightFoot.x],
  [6, GUARD.rightFoot.x],
]);
/** How far toward the camera the chambered knee carries the foot. */
const STOMP_DEPTH: Track = offsetTrack(STOMP_LAST, [
  [1, 0.06],
  [2, 0.28],
  [STOMP_APEX, 0.32],
  [STOMP_DOWN_IMPACT, 0],
  [5, 0],
  [6, 0],
]);
/** The shin turns toward the viewer as the knee rises: it draws wider, not longer. */
const STOMP_NEARNESS: Track = offsetTrack(STOMP_LAST, [
  [1, 0.2],
  [2, 0.8],
  [STOMP_APEX, 1],
  [STOMP_DOWN_IMPACT, 0],
  [5, 0],
  [6, 0],
]);
/**
 * Weight onto the left foot before the right one can leave the floor, then
 * over onto the right as it lands: the hips shifting onto the stamping foot is
 * what says the weight went down through it.
 */
const STOMP_SWAY: Track = offsetTrack(STOMP_LAST, [
  [1, -0.05],
  [2, -0.06],
  [STOMP_APEX, -0.05],
  [STOMP_DOWN_IMPACT, 0.05],
  [5, 0.05],
  [6, 0.02],
]);
/**
 * The body rises on the stance leg through the chamber and drops hard into the
 * stamp — the drop is most of what reads as weight — then sinks a little
 * further as the stamp is pressed home, before coming back up to the guard.
 */
const STOMP_BOB: Track = offsetTrack(STOMP_LAST, [
  [1, 0.03],
  [2, -0.01],
  [STOMP_APEX, -0.02],
  [STOMP_DOWN_IMPACT, 0.08],
  [5, 0.1],
  [6, 0.04],
]);
const STOMP_CROUCH: Track = offsetTrack(STOMP_LAST, [
  [1, 0.12],
  [2, 0],
  [STOMP_APEX, -0.02],
  [STOMP_DOWN_IMPACT, 0.3],
  [5, 0.34],
  [6, 0.12],
]);
/**
 * He rocks back off the chambered knee, then throws his chest down over the
 * stamp. Upright through both, the knee coming up reads as a knee strike and
 * the stamp as a foot put back down.
 */
const STOMP_TORSO_PITCH: Track = offsetTrack(STOMP_LAST, [
  [1, 0.08],
  [2, -0.2],
  [STOMP_APEX, -0.28],
  [STOMP_DOWN_IMPACT, 0.42],
  [5, 0.46],
  [6, 0.16],
]);
/**
 * The arms counter the leg: flung up and out for balance as the knee rises,
 * then thrown down past the hips with the stamp, the whole body driving the
 * heel into the floor. Held in the guard through the blow, the arms are the
 * one part of him that does not move, and the stomp reads as marching on the
 * spot.
 */
const STOMP_RIGHT_HAND = handPath(GUARD_RIGHT_FIST, STOMP_LAST, [
  [1, pt(0.02, 0.06)],
  [2, pt(0.2, -0.12)],
  [STOMP_APEX, pt(0.26, -0.22)],
  [STOMP_DOWN_IMPACT, atShoulder(GUARD_RIGHT_FIST, 0.16, 0.6)],
  [5, atShoulder(GUARD_RIGHT_FIST, 0.15, 0.6)],
  [6, pt(0.06, 0.2)],
]);
const STOMP_LEFT_HAND = handPath(GUARD_LEFT_FIST, STOMP_LAST, [
  [1, pt(-0.02, 0.06)],
  [2, pt(-0.22, -0.1)],
  [STOMP_APEX, pt(-0.28, -0.2)],
  [STOMP_DOWN_IMPACT, atShoulder(GUARD_LEFT_FIST, -0.16, 0.6)],
  [5, atShoulder(GUARD_LEFT_FIST, -0.15, 0.6)],
  [6, pt(-0.06, 0.2)],
]);
/** Elbows up and out with the arms at the chamber; straight down with the stamp. */
const STOMP_ELBOW_FLARE: Track = fromRest(GUARD.elbowFlare, STOMP_LAST, [
  [2, 0.8],
  [STOMP_APEX, 0.9],
  [STOMP_DOWN_IMPACT, 0.1],
  [5, 0.1],
  [6, 0.3],
]);
/** Eyes on the target through the whole blow: the chin drops to watch the foot land. */
const STOMP_CHIN: Track = fromRest(GUARD.chinLift ?? 0, STOMP_LAST, [
  [2, -0.4],
  [STOMP_APEX, -0.5],
  [STOMP_DOWN_IMPACT, -0.85],
  [5, -0.8],
]);
const STOMP_MOUTH: Track = offsetTrack(STOMP_LAST, [
  [STOMP_APEX, 0.2],
  [STOMP_DOWN_IMPACT, 0.9],
  [5, 0.6],
  [6, 0.2],
]);
const STOMP_JACKET: Track = offsetTrack(STOMP_LAST, [
  [STOMP_APEX, 0.3],
  [STOMP_DOWN_IMPACT, 0.9],
  [5, 0.5],
]);
/** The hair lifts on the rise and is thrown down by the stamp. */
const STOMP_HAIR: Track = offsetTrack(STOMP_LAST, [
  [STOMP_APEX, 0.3],
  [STOMP_DOWN_IMPACT, -0.5],
  [5, -0.3],
  [6, 0.1],
]);
const FULL_BROW = 1;

/** A stamp at something small at his feet: knee up toward the camera, heel driven down. */
export function stompDown(frame: number): CarlPose {
  const pose = guardFront(0);
  pose.sway = trackAt(frame, STOMP_SWAY);
  pose.bob += trackAt(frame, STOMP_BOB);
  pose.crouch += trackAt(frame, STOMP_CROUCH);
  pose.torsoPitch = trackAt(frame, STOMP_TORSO_PITCH);
  placeRightFoot(
    pose,
    trackAt(frame, STOMP_FOOT_X),
    trackAt(frame, STOMP_LIFT),
    trackAt(frame, STOMP_DEPTH),
  );
  pose.rightLegNearness = trackAt(frame, STOMP_NEARNESS);
  placeHands(pose, frame, STOMP_RIGHT_HAND, STOMP_LEFT_HAND);
  pose.elbowFlare = trackAt(frame, STOMP_ELBOW_FLARE);
  pose.leftFootPlanted = true;
  pose.chinLift = trackAt(frame, STOMP_CHIN);
  pose.brow = frame === 0 || frame === STOMP_LAST ? GUARD.brow : FULL_BROW;
  pose.mouth = trackAt(frame, STOMP_MOUTH);
  pose.jacketFlare += trackAt(frame, STOMP_JACKET);
  pose.hairFlow += trackAt(frame, STOMP_HAIR);
  return pose;
}

// ── Punt ─────────────────────────────────────────────────────────────────────

const PUNT_LAST = PUNT_DOWN_FRAMES - 1;

/**
 * A toe punt at something on the floor in front of him: the foot draws back
 * behind the stance leg with the heel kicked up, then swings through and up
 * at the camera, the leg nearly straight and the sole and swelling foot held
 * out in front of the shorts on the impact frame while he rocks back off it.
 * Ahead of him is lower on the screen and up is higher, so a foot kicked
 * forward and up stays in front of him rather than rising past the hip.
 */
const PUNT_LIFT: Track = [
  [0, 0],
  [1, 0.3],
  [2, 0.36],
  [3, 0.42],
  [PUNT_DOWN_IMPACT, 0.62],
  [5, 0.54],
  [6, 0.22],
  [PUNT_LAST, 0],
];
const PUNT_DEPTH: Track = offsetTrack(PUNT_LAST, [
  [1, -0.3],
  [2, -0.1],
  [3, 0.36],
  [PUNT_DOWN_IMPACT, 0.56],
  [5, 0.48],
  [6, 0.2],
]);
/**
 * The knee chambers in under his centre and the kick snaps straight out at the
 * target, toward the camera. Its silhouette is the knee and shin painted over
 * the shorts and the foot swelling low on the screen, not a sideways swing:
 * a leg carried out to the side reads as a kick at something beside him.
 */
const PUNT_FOOT_X: Track = fromRest(GUARD.rightFoot.x, PUNT_LAST, [
  [1, 0.2],
  [2, 0.16],
  [3, 0.22],
  [PUNT_DOWN_IMPACT, 0.34],
  [5, 0.3],
  [6, 0.18],
]);
const PUNT_NEARNESS: Track = offsetTrack(PUNT_LAST, [
  [2, 0.3],
  [3, 0.8],
  [PUNT_DOWN_IMPACT, 1],
  [5, 0.8],
  [6, 0.3],
]);
/** The kicked foot swells as it comes at the camera. */
const PUNT_FOOT_SCALE: Track = fromRest(1, PUNT_LAST, [
  [2, 1.05],
  [3, 1.4],
  [PUNT_DOWN_IMPACT, 1.85],
  [5, 1.6],
  [6, 1.2],
]);
const PUNT_SWAY: Track = offsetTrack(PUNT_LAST, [
  [1, -0.05],
  [2, -0.06],
  [PUNT_DOWN_IMPACT, -0.06],
  [5, -0.05],
  [6, -0.02],
]);
/** The stance knee loads as the foot draws back and stays bent under the kick, braced. */
const PUNT_CROUCH: Track = offsetTrack(PUNT_LAST, [
  [1, 0.1],
  [2, 0.12],
  [3, 0.08],
  [PUNT_DOWN_IMPACT, 0.06],
  [5, 0.08],
  [6, 0.06],
]);
const PUNT_BOB: Track = offsetTrack(PUNT_LAST, [
  [1, 0.02],
  [2, 0.02],
  [PUNT_DOWN_IMPACT, -0.01],
  [5, 0],
]);
/**
 * Over the foot as it draws back, then rocked back off the kick as it goes
 * through: the body leaning away from the foot is what says the foot is
 * coming at the viewer.
 */
const PUNT_TORSO_PITCH: Track = offsetTrack(PUNT_LAST, [
  [1, 0.18],
  [2, 0.1],
  [3, -0.15],
  [PUNT_DOWN_IMPACT, -0.32],
  [5, -0.28],
  [6, -0.1],
]);
/**
 * The arms swing against the legs, as a runner's do: the left fist drives
 * forward and up across his chest as the right foot kicks, and the right arm
 * swings back and down past the hip. Flung out sideways, they read as a
 * haymaker thrown past the camera.
 */
const PUNT_LEFT_HAND = handPath(GUARD_LEFT_FIST, PUNT_LAST, [
  [1, atShoulder(GUARD_LEFT_FIST, -0.12, 0.56)],
  [2, atShoulder(GUARD_LEFT_FIST, -0.06, 0.58)],
  [3, atShoulder(GUARD_LEFT_FIST, 0.14, 0.26)],
  [PUNT_DOWN_IMPACT, atShoulder(GUARD_LEFT_FIST, 0.22, 0.12)],
  [5, atShoulder(GUARD_LEFT_FIST, 0.2, 0.14)],
  [6, pt(0.04, 0.04)],
]);
const PUNT_RIGHT_HAND = handPath(GUARD_RIGHT_FIST, PUNT_LAST, [
  [1, atShoulder(GUARD_RIGHT_FIST, -0.2, 0.12)],
  [2, atShoulder(GUARD_RIGHT_FIST, 0.06, 0.58)],
  [3, atShoulder(GUARD_RIGHT_FIST, 0.12, 0.6)],
  [PUNT_DOWN_IMPACT, atShoulder(GUARD_RIGHT_FIST, 0.16, 0.6)],
  [5, atShoulder(GUARD_RIGHT_FIST, 0.15, 0.58)],
  [6, pt(0.08, 0.2)],
]);
const PUNT_CHIN: Track = fromRest(GUARD.chinLift ?? 0, PUNT_LAST, [
  [1, -0.4],
  [2, -0.55],
  [PUNT_DOWN_IMPACT, -0.5],
  [5, -0.5],
]);
const PUNT_MOUTH: Track = offsetTrack(PUNT_LAST, [
  [3, 0.2],
  [PUNT_DOWN_IMPACT, 0.6],
  [5, 0.35],
]);
const PUNT_JACKET: Track = offsetTrack(PUNT_LAST, [
  [3, 0.3],
  [PUNT_DOWN_IMPACT, 0.6],
  [5, 0.3],
]);
const PUNT_HAIR: Track = offsetTrack(PUNT_LAST, [
  [2, 0.15],
  [PUNT_DOWN_IMPACT, -0.35],
  [5, -0.2],
]);

/** A toe punt toward the camera, the rat-punting kick. */
export function puntDown(frame: number): CarlPose {
  const pose = guardFront(0);
  pose.sway = trackAt(frame, PUNT_SWAY);
  pose.bob += trackAt(frame, PUNT_BOB);
  pose.crouch += trackAt(frame, PUNT_CROUCH);
  pose.torsoPitch = trackAt(frame, PUNT_TORSO_PITCH);
  placeRightFoot(
    pose,
    trackAt(frame, PUNT_FOOT_X),
    trackAt(frame, PUNT_LIFT),
    trackAt(frame, PUNT_DEPTH),
  );
  pose.rightLegNearness = trackAt(frame, PUNT_NEARNESS);
  pose.rightFootScale = trackAt(frame, PUNT_FOOT_SCALE);
  placeHands(pose, frame, PUNT_RIGHT_HAND, PUNT_LEFT_HAND);
  pose.leftFootPlanted = true;
  pose.chinLift = trackAt(frame, PUNT_CHIN);
  pose.brow = frame === 0 || frame === PUNT_LAST ? GUARD.brow : FULL_BROW;
  pose.mouth = trackAt(frame, PUNT_MOUTH);
  pose.jacketFlare += trackAt(frame, PUNT_JACKET);
  pose.hairFlow += trackAt(frame, PUNT_HAIR);
  return pose;
}

// ── Hammer-fist ──────────────────────────────────────────────────────────────

const HAMMER_LAST = HAMMER_DOWN_FRAMES - 1;

/**
 * The right fist goes up over his head, and then he drops his body under it
 * and folds over it: knees bend and the chest pitches down toward the
 * camera, so the fist reaches a target at knee height, which no arm swung
 * from a standing shoulder can.
 */
const HAMMER_CROUCH: Track = offsetTrack(HAMMER_LAST, [
  [1, -0.02],
  [2, -0.03],
  [3, 0.2],
  [HAMMER_DOWN_IMPACT, 0.56],
  [5, 0.56],
  [6, 0.26],
]);
const HAMMER_BOB: Track = offsetTrack(HAMMER_LAST, [
  [1, -0.005],
  [2, -0.01],
  [3, 0.02],
  [HAMMER_DOWN_IMPACT, 0.07],
  [5, 0.07],
  [6, 0.03],
]);
/**
 * Rocked back under the raised fist, then the chest thrown down over the
 * target after it. The fold is what carries the fist to the floor; upright,
 * the arm swung down reads as a hand dropped to the side.
 */
const HAMMER_TORSO_PITCH: Track = offsetTrack(HAMMER_LAST, [
  [1, -0.12],
  [2, -0.2],
  [3, 0.22],
  [HAMMER_DOWN_IMPACT, 0.62],
  [5, 0.62],
  [6, 0.25],
]);
/** Squatting, the knees spread over the feet rather than folding straight at the camera. */
const HAMMER_FORESHORTEN: Track = fromRest(GUARD.rightForeshorten, HAMMER_LAST, [
  [3, 0.92],
  [HAMMER_DOWN_IMPACT, 0.88],
  [5, 0.88],
  [6, 0.94],
]);
/**
 * A folded thigh points at the camera, so it draws as a short, wide mass
 * rather than as a leg bowed out to the side.
 */
const HAMMER_THIGH_NEARNESS: Track = offsetTrack(HAMMER_LAST, [
  [3, 0.2],
  [HAMMER_DOWN_IMPACT, 0.6],
  [5, 0.6],
  [6, 0.3],
]);
/**
 * Straight up over his head, then down through the front of him to the
 * target in front of his knees, on the centreline: brought down beside him
 * instead, the fist reads as a hand dropped to the hip.
 */
const HAMMER_RIGHT_HAND = handPath(GUARD_RIGHT_FIST, HAMMER_LAST, [
  [1, atShoulder(GUARD_RIGHT_FIST, 0.02, -0.46)],
  [2, atShoulder(GUARD_RIGHT_FIST, -0.2, -0.5)],
  [3, atShoulder(GUARD_RIGHT_FIST, -0.2, 0.12)],
  [HAMMER_DOWN_IMPACT, atShoulder(GUARD_RIGHT_FIST, -0.24, 0.6)],
  [5, atShoulder(GUARD_RIGHT_FIST, -0.24, 0.6)],
  [6, pt(0.0, 0.2)],
]);
/**
 * The left arm counters the blow: forward to the jaw as the right goes up,
 * then thrown back and out past the hip as the right comes down.
 */
const HAMMER_LEFT_HAND = handPath(GUARD_LEFT_FIST, HAMMER_LAST, [
  [1, pt(0.02, 0.02)],
  [2, pt(0.04, 0.04)],
  [3, atShoulder(GUARD_LEFT_FIST, -0.2, 0.36)],
  [HAMMER_DOWN_IMPACT, atShoulder(GUARD_LEFT_FIST, -0.42, 0.3)],
  [5, atShoulder(GUARD_LEFT_FIST, -0.4, 0.3)],
  [6, pt(-0.04, 0.16)],
]);
const HAMMER_SWAY: Track = offsetTrack(HAMMER_LAST, [
  [2, -0.03],
  [3, 0.01],
  [HAMMER_DOWN_IMPACT, 0.03],
  [5, 0.03],
  [6, 0.01],
]);
const HAMMER_CHIN: Track = fromRest(GUARD.chinLift ?? 0, HAMMER_LAST, [
  [1, 0.3],
  [2, 0.4],
  [3, -0.4],
  [HAMMER_DOWN_IMPACT, -1],
  [5, -1],
  [6, -0.6],
]);
const HAMMER_MOUTH: Track = offsetTrack(HAMMER_LAST, [
  [2, 0.3],
  [HAMMER_DOWN_IMPACT, 0.85],
  [5, 0.6],
  [6, 0.2],
]);
const HAMMER_JACKET: Track = offsetTrack(HAMMER_LAST, [
  [2, 0.2],
  [HAMMER_DOWN_IMPACT, 0.8],
  [5, 0.5],
]);
const HAMMER_HAIR: Track = offsetTrack(HAMMER_LAST, [
  [2, 0.35],
  [HAMMER_DOWN_IMPACT, -0.5],
  [5, -0.3],
]);
/** The elbow leads the fist up over the top and straightens on the way down. */
const HAMMER_ELBOW_FLARE: Track = fromRest(GUARD.elbowFlare, HAMMER_LAST, [
  [2, 1],
  [3, 0.6],
  [HAMMER_DOWN_IMPACT, 0.05],
  [5, 0.05],
  [6, 0.15],
]);

/** A right hammer-fist driven down onto something low, the body dropping under it. */
export function hammerDown(frame: number): CarlPose {
  const pose = guardFront(0);
  pose.sway = trackAt(frame, HAMMER_SWAY);
  pose.bob += trackAt(frame, HAMMER_BOB);
  pose.crouch += trackAt(frame, HAMMER_CROUCH);
  pose.torsoPitch = trackAt(frame, HAMMER_TORSO_PITCH);
  pose.leftForeshorten = trackAt(frame, HAMMER_FORESHORTEN);
  pose.rightForeshorten = pose.leftForeshorten;
  pose.leftLegNearness = trackAt(frame, HAMMER_THIGH_NEARNESS);
  pose.rightLegNearness = pose.leftLegNearness;
  pose.leftFootPlanted = true;
  pose.rightFootPlanted = true;
  placeHands(pose, frame, HAMMER_RIGHT_HAND, HAMMER_LEFT_HAND);
  pose.elbowFlare = trackAt(frame, HAMMER_ELBOW_FLARE);
  pose.chinLift = trackAt(frame, HAMMER_CHIN);
  pose.brow = frame === 0 || frame === HAMMER_LAST ? GUARD.brow : FULL_BROW;
  pose.mouth = trackAt(frame, HAMMER_MOUTH);
  pose.jacketFlare += trackAt(frame, HAMMER_JACKET);
  pose.hairFlow += trackAt(frame, HAMMER_HAIR);
  return pose;
}

// ── Knee drop ────────────────────────────────────────────────────────────────

const KNEE_LAST = KNEE_DROP_FRAMES - 1;

/**
 * The finisher on something already down: the right knee comes up, and then he
 * drops his whole weight onto it, landing kneeling with that knee on the target
 * — ahead of him, so lower on the screen — and the shin trailing behind under
 * him. The left foot never moves; the left knee folds over it.
 */
const KNEE_LIFT: Track = [
  [0, 0],
  [1, 0.08],
  [2, 0.5],
  [3, 0.56],
  [4, 0.2],
  [KNEE_DROP_IMPACT, 0.05],
  [6, 0.05],
  [7, 0.08],
  [8, 0.06],
  [KNEE_LAST, 0],
];
const KNEE_DEPTH: Track = offsetTrack(KNEE_LAST, [
  [1, 0.06],
  [2, 0.3],
  [3, 0.32],
  [4, 0.12],
  [KNEE_DROP_IMPACT, 0.04],
  [6, 0.02],
  [7, -0.02],
  [8, -0.02],
]);
const KNEE_FOOT_X: Track = fromRest(GUARD.rightFoot.x, KNEE_LAST, [
  [1, 0.17],
  [2, 0.14],
  [3, 0.14],
  [KNEE_DROP_IMPACT, 0.18],
]);
const KNEE_NEARNESS: Track = offsetTrack(KNEE_LAST, [
  [1, 0.2],
  [2, 1],
  [3, 1],
  [KNEE_DROP_IMPACT, 1],
  [7, 0.8],
  [8, 0.3],
]);
/**
 * A dip, a rise up the standing leg with the right knee raised, then the
 * fall: a kneeling man's hip is about a thigh's length off the floor, well
 * under what a crouch alone reaches.
 */
const KNEE_BOB: Track = offsetTrack(KNEE_LAST, [
  [1, 0.04],
  [2, -0.01],
  [3, -0.015],
  [4, 0.08],
  [KNEE_DROP_IMPACT, 0.15],
  [6, 0.11],
  [7, 0.04],
  [8, 0.01],
]);
const KNEE_CROUCH: Track = offsetTrack(KNEE_LAST, [
  [1, 0.16],
  [2, -0.02],
  [3, -0.02],
  [4, 0.6],
  [KNEE_DROP_IMPACT, 0.91],
  [6, 0.72],
  [7, 0.34],
  [8, 0.12],
]);
/**
 * His chest is thrown forward over the knee as it lands, toward the camera:
 * the weight going down through the knee into the target. Kneeling upright
 * over it, the same legs read as a man going down on one knee.
 */
const KNEE_TORSO_PITCH: Track = offsetTrack(KNEE_LAST, [
  [1, 0.12],
  [2, -0.12],
  [3, -0.1],
  [4, 0.3],
  [KNEE_DROP_IMPACT, 0.55],
  [6, 0.45],
  [7, 0.2],
  [8, 0.05],
]);
/**
 * The standing leg's knee folds only a little out to the side: it bends
 * forward over its foot, under the dropping hips. Splayed as far as the
 * kneeling leg, the two read as a sumo squat over the target.
 */
const KNEE_LEFT_FORESHORTEN: Track = fromRest(GUARD.leftForeshorten, KNEE_LAST, [
  [3, 0.95],
  [4, 0.78],
  [KNEE_DROP_IMPACT, 0.68],
  [7, 0.75],
  [8, 0.9],
]);
/**
 * Both arms are swung down on the dip and thrown up over his head with the
 * rise — the height he drops from, drawn — then flung out wide as he lands,
 * elbows high. A fist driven down to the floor beside the knee reads as a
 * hand picking something up.
 */
const KNEE_RIGHT_HAND = handPath(GUARD_RIGHT_FIST, KNEE_LAST, [
  [1, atShoulder(GUARD_RIGHT_FIST, 0.08, 0.6)],
  [2, atShoulder(GUARD_RIGHT_FIST, -0.06, -0.58)],
  [3, atShoulder(GUARD_RIGHT_FIST, -0.04, -0.6)],
  [4, atShoulder(GUARD_RIGHT_FIST, 0.36, -0.2)],
  [KNEE_DROP_IMPACT, atShoulder(GUARD_RIGHT_FIST, 0.5, 0.06)],
  [6, atShoulder(GUARD_RIGHT_FIST, 0.46, 0.12)],
  [7, pt(0.12, 0.1)],
  [8, pt(0.03, 0.03)],
]);
const KNEE_LEFT_HAND = handPath(GUARD_LEFT_FIST, KNEE_LAST, [
  [1, atShoulder(GUARD_LEFT_FIST, -0.08, 0.6)],
  [2, atShoulder(GUARD_LEFT_FIST, 0.06, -0.58)],
  [3, atShoulder(GUARD_LEFT_FIST, 0.04, -0.6)],
  [4, atShoulder(GUARD_LEFT_FIST, -0.36, -0.2)],
  [KNEE_DROP_IMPACT, atShoulder(GUARD_LEFT_FIST, -0.5, 0.06)],
  [6, atShoulder(GUARD_LEFT_FIST, -0.46, 0.12)],
  [7, pt(-0.12, 0.1)],
  [8, pt(-0.03, 0.03)],
]);
/** Elbows up over the head, then out and level with the landing. */
const KNEE_ELBOW_FLARE: Track = fromRest(GUARD.elbowFlare, KNEE_LAST, [
  [1, 0],
  [2, 0.9],
  [3, 0.9],
  [4, 0.8],
  [KNEE_DROP_IMPACT, 0.6],
  [6, 0.6],
  [7, 0.5],
]);
const KNEE_CHIN: Track = fromRest(GUARD.chinLift ?? 0, KNEE_LAST, [
  [2, 0.2],
  [3, 0],
  [4, -0.6],
  [KNEE_DROP_IMPACT, -0.9],
  [7, -0.8],
  [8, -0.5],
]);
const KNEE_MOUTH: Track = offsetTrack(KNEE_LAST, [
  [2, 0.2],
  [KNEE_DROP_IMPACT, 0.9],
  [6, 0.6],
  [7, 0.3],
]);
const KNEE_JACKET: Track = offsetTrack(KNEE_LAST, [
  [2, 0.3],
  [4, 0.7],
  [KNEE_DROP_IMPACT, 1],
  [7, 0.4],
]);
const KNEE_HAIR: Track = offsetTrack(KNEE_LAST, [
  [2, -0.3],
  [4, 0.6],
  [KNEE_DROP_IMPACT, -0.5],
  [6, -0.3],
]);

/** The finisher on a downed enemy: he drops his whole weight onto one knee. */
export function kneeDropDown(frame: number): CarlPose {
  const pose = guardFront(0);
  pose.bob += trackAt(frame, KNEE_BOB);
  pose.crouch += trackAt(frame, KNEE_CROUCH);
  pose.torsoPitch = trackAt(frame, KNEE_TORSO_PITCH);
  const lift = trackAt(frame, KNEE_LIFT);
  const depth = trackAt(frame, KNEE_DEPTH);
  pose.rightFoot = pt(trackAt(frame, KNEE_FOOT_X), -lift);
  const kneeling = frame > 0 && frame < KNEE_LAST;
  if (kneeling) pose.rightFootDepth = depth;
  pose.rightFootPlanted = !kneeling;
  pose.rightLegNearness = trackAt(frame, KNEE_NEARNESS);
  pose.leftForeshorten = trackAt(frame, KNEE_LEFT_FORESHORTEN);
  pose.leftFootPlanted = true;
  placeHands(pose, frame, KNEE_RIGHT_HAND, KNEE_LEFT_HAND);
  pose.elbowFlare = trackAt(frame, KNEE_ELBOW_FLARE);
  pose.chinLift = trackAt(frame, KNEE_CHIN);
  pose.brow = frame === 0 || frame === KNEE_LAST ? GUARD.brow : FULL_BROW;
  pose.mouth = trackAt(frame, KNEE_MOUTH);
  pose.jacketFlare += trackAt(frame, KNEE_JACKET);
  pose.hairFlow += trackAt(frame, KNEE_HAIR);
  return pose;
}

// ── Hop-in stomp, on the move ────────────────────────────────────────────────

export const STOMP_RUN_FRAMES = RUNNING_STRIKE_FRAMES;
export const STOMP_RUN_IMPACT = RUNNING_STRIKE_IMPACT_FRAME;
const STOMP_RUN_LAST = STOMP_RUN_FRAMES - 1;
/**
 * The running stomp's tracks are keyed over a nine-frame swing, the stamp on
 * its middle frame; the row is as many frames as the run steps through in a
 * swing and samples them at its own frame's share of it.
 */
const STOMP_KEYED_LAST = 8;
const STOMP_KEYED_IMPACT = STOMP_KEYED_LAST / 2;
const STOMP_KEYED_APEX = STOMP_KEYED_IMPACT - 1;

function keyedFrame(frame: number): number {
  return (frame * STOMP_KEYED_LAST) / STOMP_RUN_LAST;
}
/** The stamp is the stamping foot's contact: the phase, of whichever leg stamps, the run lands it at. */
const STAMP_LEG_PHASE = 0;

/**
 * How far short of its own contact a stamping foot may be at the impact frame
 * on the stride alone: a run frame. Both feet are off the floor from the
 * first frame to the stamp whenever the stamping foot is that little short,
 * so the approach can be hurried by that much without sliding a planted foot,
 * and the foot then lands exactly on its own contact. Driven down any earlier
 * it would have to land ahead of its contact, and head-on a run's contact is
 * already as far ahead of the hips as the leg reaches.
 */
const STAMP_EARLIEST = RUN_FRAME_PHASE;
/**
 * The latest in its stance a stamping foot may be at the impact frame: a run
 * frame short of push-off, so it is still on the floor the frame after the
 * stamp. A foot stamped on its last stance frame is off the floor again the
 * next, and the stamp reads as a tap.
 */
const STAMP_LATEST = RUN_TOE_OFF_PHASE - RUN_FRAME_PHASE;

/**
 * The phase by which the airborne approach of a stomp begun at `entry` is
 * hurried: whatever the stamping foot would still be short of its contact at
 * the impact frame.
 */
function approachCatchUp(entry: number): number {
  const lead = blowLeg(runPhaseAt(entry, STOMP_RUN_IMPACT), STAMP_LEG_PHASE).lead;
  return Math.max(0, -lead);
}

/**
 * The run phase the legs are at on `frame` of a stomp begun at `entry`: the
 * stride's own, hurried evenly through the approach so the stamping foot meets
 * its contact on the impact frame, and a run frame a frame from there.
 */
function stompRunPhase(entry: number, frame: number): number {
  const approach = Math.min(frame, STOMP_RUN_IMPACT) / STOMP_RUN_IMPACT;
  return (runPhaseAt(entry, frame) + approachCatchUp(entry) * approach) % 1;
}

/**
 * Whether the running stomp can begin on a run frame: one leg or the other
 * has to reach the floor within {@link STAMP_EARLIEST} of the impact frame, or
 * already stand on it with a frame of its stance still to go
 * ({@link STAMP_LATEST}).
 */
function stompCanBeginOn(runFrame: number): boolean {
  const lead = blowLeg(runPhaseAt(runFrame / RUN_FRAMES, STOMP_RUN_IMPACT), STAMP_LEG_PHASE).lead;
  return lead >= -STAMP_EARLIEST - PHASE_EPSILON && lead <= STAMP_LATEST + PHASE_EPSILON;
}

/** The run phases the running stomp's versions begin at. */
export const STOMP_RUN_ENTRY_PHASES = entryPhasesWhere('front', stompCanBeginOn);

/** The run phase the running stomp begun at `entry` hands the legs back at. */
export function stompRunExitPhase(entry: number): number {
  return stompRunPhase(entry, STOMP_RUN_LAST);
}

/**
 * How much of each frame is the stomp rather than the run it rides on: none on
 * the first and last frame, which are the run's own, so the stride carries on
 * into and out of the blow.
 */
const STOMP_RUN_WEIGHT: Track = [
  [0, 0],
  [1, 0.5],
  [2, 1],
  [STOMP_KEYED_APEX, 1],
  [STOMP_KEYED_IMPACT, 1],
  [5, 1],
  [6, 0.7],
  [7, 0.35],
  [STOMP_KEYED_LAST, 0],
];
/**
 * The run's own flight is stretched into a hop: the last push off the left
 * foot throws him higher than a stride would, and the right knee rides up in
 * front of him toward the camera before the heel is driven down on the spot
 * the stride would have put it anyway.
 */
const STOMP_RUN_EXTRA_LIFT: Track = [
  [0, 0],
  [1, 0],
  [2, 0.4],
  [STOMP_KEYED_APEX, 0.52],
  [STOMP_KEYED_IMPACT, 0],
  [STOMP_KEYED_LAST, 0],
];
/**
 * The chambered knee carries the foot nearer the camera than the stride does,
 * far enough that the knee and shin are painted over the shorts.
 */
const STOMP_RUN_EXTRA_DEPTH: Track = [
  [0, 0],
  [1, 0],
  [2, 0.12],
  [STOMP_KEYED_APEX, 0.18],
  [STOMP_KEYED_IMPACT, 0],
  [STOMP_KEYED_LAST, 0],
];
/**
 * The chambered knee swings only a touch out as it rises. It is told from one
 * more stride by coming over the shorts at the camera; swung out wide it reads
 * as a leg flung sideways.
 */
const STOMP_RUN_KNEE_OUT = 0.06;
const STOMP_RUN_NEARNESS: Track = [
  [0, 0],
  [1, 0.3],
  [2, 1],
  [STOMP_KEYED_APEX, 1],
  [STOMP_KEYED_IMPACT, 0],
  [STOMP_KEYED_LAST, 0],
];
/** Up through the hop, then the body drops through the stamp and rises back into the run. */
const STOMP_RUN_BOB: Track = offsetTrack(STOMP_KEYED_LAST, [
  [1, -0.01],
  [2, -0.04],
  [STOMP_KEYED_APEX, -0.03],
  [STOMP_KEYED_IMPACT, 0.06],
  [5, 0.07],
  [6, 0.04],
  [7, 0.015],
]);
const STOMP_RUN_CROUCH: Track = offsetTrack(STOMP_KEYED_LAST, [
  [STOMP_KEYED_APEX, 0],
  [STOMP_KEYED_IMPACT, 0.42],
  [5, 0.4],
  [6, 0.16],
  [7, 0.05],
]);
/**
 * The fists, as how far they sit from the guard's: held up through the hop and
 * pulled down past the ribs by the stamp, as the standing stomp does.
 */
const STOMP_RUN_RIGHT_FIST: Track = [
  [0, 0],
  [1, 0.02],
  [2, 0.05],
  [STOMP_KEYED_APEX, 0.05],
  [STOMP_KEYED_IMPACT, 0.16],
  [5, 0.18],
  [6, 0.12],
  [7, 0.06],
  [STOMP_KEYED_LAST, 0],
];
/**
 * The guard stays tight through the hop: fists flung out for balance read as
 * a leap for joy, not a stamp. Landing, they open a little with the drop.
 */
const STOMP_RUN_WIDEN: Track = [
  [0, 0],
  [1, 0.05],
  [2, 0.1],
  [STOMP_KEYED_APEX, 0.1],
  [STOMP_KEYED_IMPACT, 0.1],
  [STOMP_KEYED_LAST, 0],
];
/**
 * How far the hop carries the whole body, legs and all, above where the run's
 * own flight has it: both feet leave the floor together, which is what makes
 * it a hop rather than one more stride.
 */
const STOMP_RUN_HOP: Track = [
  [0, 0],
  [1, 0],
  [2, 0.09],
  [STOMP_KEYED_APEX, 0.07],
  [STOMP_KEYED_IMPACT, 0],
  [STOMP_KEYED_LAST, 0],
];
/** How far below the chambered foot the trailing one hangs at least, while the knee is up. */
const STOMP_RUN_TRAILING_BELOW_CHAMBER = 0.25;
/** The trailing foot rises this much faster than the body through the hop. */
const HOP_TRAIL_TUCK = 1.5;
const STOMP_RUN_CHIN: Track = [
  [0, 0],
  [2, -0.5],
  [STOMP_KEYED_APEX, -0.6],
  [STOMP_KEYED_IMPACT, -0.75],
  [5, -0.7],
  [7, -0.3],
  [STOMP_KEYED_LAST, 0],
];
/**
 * The chest drives down over the stamping foot as it lands, toward the
 * camera: the body following the heel into the floor.
 */
const STOMP_RUN_TORSO_PITCH: Track = offsetTrack(STOMP_KEYED_LAST, [
  [STOMP_KEYED_APEX, 0.05],
  [STOMP_KEYED_IMPACT, 0.4],
  [5, 0.35],
  [6, 0.15],
]);
const STOMP_RUN_MOUTH: Track = offsetTrack(STOMP_KEYED_LAST, [
  [STOMP_KEYED_APEX, 0.2],
  [STOMP_KEYED_IMPACT, 0.8],
  [5, 0.6],
  [6, 0.3],
]);
const STOMP_RUN_JACKET: Track = offsetTrack(STOMP_KEYED_LAST, [
  [STOMP_KEYED_APEX, 0.3],
  [STOMP_KEYED_IMPACT, 0.9],
  [5, 0.5],
]);

/** The leg the running stomp begun at `entry` stamps with: the one nearest its own contact at the impact. */
function stompRunStampingLeg(entry: number): BlowLeg {
  return blowLeg(stompRunPhase(entry, STOMP_RUN_IMPACT), STAMP_LEG_PHASE);
}

/** Which foot, as `placeFoot`'s sign, the running stomp begun at `entry` stamps with. */
export function stompRunStampingSide(entry: number): number {
  return stompRunStampingLeg(entry).side;
}

/**
 * The stomp thrown while running at the camera, its legs the run's own from
 * `entry` on: a hop, one knee up, and the stamp on the impact frame with
 * whichever foot the run has nearest its own contact there.
 *
 * - A foot already down is lifted out of its stance for the hop and stamped
 *   back onto the spot it stood on, which the run carries on from.
 * - A foot still in the air short of its contact is brought down on it: the
 *   airborne approach is hurried so the stamp lands on the contact itself.
 */
export function stompRunDown(frame: number, entry: number): CarlPose {
  const phase = stompRunPhase(entry, frame);
  const keyed = keyedFrame(frame);
  const pose = runFacing(phase, false);
  const leg = stompRunStampingLeg(entry);
  const stampsRight = sideOfSign(leg.side) === 'right';
  const weight = trackAt(keyed, STOMP_RUN_WEIGHT);
  const runSkeleton = buildSkeleton(pose, VIEWS.front);
  const stampFoot = (): Pt => (stampsRight ? pose.rightFoot : pose.leftFoot);
  const setStampFoot = (foot: Pt): void => {
    if (stampsRight) pose.rightFoot = foot;
    else pose.leftFoot = foot;
  };
  const trailingPlanted = (stampsRight ? pose.leftFootPlanted : pose.rightFootPlanted) === true;
  const runTrailingY = stampsRight ? pose.leftFoot.y : pose.rightFoot.y;

  // The body rises into the hop only once the foot he hops off has left the
  // floor; over a planted foot the rise would pull the leg past its length.
  const bob = trackAt(keyed, STOMP_RUN_BOB);
  pose.bob += trailingPlanted ? Math.max(0, bob) : bob;
  pose.crouch += trackAt(keyed, STOMP_RUN_CROUCH);
  const extraLift = trackAt(keyed, STOMP_RUN_EXTRA_LIFT);
  if (extraLift > 0) {
    const foot = stampFoot();
    setStampFoot(pt(foot.x + leg.side * extraLift * STOMP_RUN_KNEE_OUT, foot.y - extraLift));
    const extraDepth = trackAt(keyed, STOMP_RUN_EXTRA_DEPTH);
    if (stampsRight) pose.rightFootDepth = (pose.rightFootDepth ?? 0) + extraDepth;
    else pose.leftFootDepth = (pose.leftFootDepth ?? 0) + extraDepth;
    if (stampsRight) pose.rightFootPlanted = false;
    else pose.leftFootPlanted = false;
  }
  // A trailing foot still on the floor is the one he hops off: the body cannot
  // leave the floor over it yet.
  const hop = trailingPlanted ? 0 : trackAt(keyed, STOMP_RUN_HOP);
  if (hop > 0) {
    pose.bob -= hop;
    const stamp = stampFoot();
    setStampFoot(pt(stamp.x, stamp.y - hop));
    // The trailing leg tucks as it leaves the floor, or the hop would ask it to
    // reach past its own length for a foot it has already pushed off with.
    if (stampsRight) pose.leftFoot = pt(pose.leftFoot.x, pose.leftFoot.y - hop * HOP_TRAIL_TUCK);
    else pose.rightFoot = pt(pose.rightFoot.x, pose.rightFoot.y - hop * HOP_TRAIL_TUCK);
  }
  if (hop > 0) {
    // Begun with the trailing leg high in its own recovery, the tuck carries
    // its foot up level with the chambered one: both knees up together read
    // as a tuck jump, and the stamp's wind-up is lost. The tuck gives way,
    // never the run's own swing.
    const lowest = Math.min(runTrailingY, stampFoot().y + STOMP_RUN_TRAILING_BELOW_CHAMBER);
    if (stampsRight) pose.leftFoot = pt(pose.leftFoot.x, Math.max(pose.leftFoot.y, lowest));
    else pose.rightFoot = pt(pose.rightFoot.x, Math.max(pose.rightFoot.y, lowest));
  }
  const nearness = trackAt(keyed, STOMP_RUN_NEARNESS);
  if (stampsRight) pose.rightLegNearness = Math.max(pose.rightLegNearness, nearness);
  else pose.leftLegNearness = Math.max(pose.leftLegNearness, nearness);

  if (weight > 0) {
    // Between its first and last frames the arms leave the run's swing for the
    // stomp's guard, so they are placed by the fist rather than by the swing.
    const stomped = buildSkeleton(pose, VIEWS.front);
    const drop = trackAt(keyed, STOMP_RUN_RIGHT_FIST);
    const widen = trackAt(keyed, STOMP_RUN_WIDEN);
    const rightFist = offset(
      stomped.rightShoulder,
      GUARD_RIGHT_FIST.x + widen,
      GUARD_RIGHT_FIST.y + drop,
    );
    const leftFist = offset(
      stomped.leftShoulder,
      GUARD_LEFT_FIST.x - widen,
      GUARD_LEFT_FIST.y + drop,
    );
    pose.rightHand = mixPt(runSkeleton.rightArm.end, rightFist, weight);
    pose.leftHand = mixPt(runSkeleton.leftArm.end, leftFist, weight);
    pose.rightUpperArmScale = lerp(
      pose.rightUpperArmScale ?? FULL_UPPER_ARM,
      GUARD_RIGHT_UPPER_ARM,
      weight,
    );
    pose.leftUpperArmScale = lerp(
      pose.leftUpperArmScale ?? FULL_UPPER_ARM,
      GUARD_LEFT_UPPER_ARM,
      weight,
    );
    pose.rightArmAngles = null;
    pose.leftArmAngles = null;
    pose.elbowFlare = GUARD.elbowFlare;
    pose.rightFist = GUARD.rightFist;
    pose.leftFist = GUARD.leftFist;
  }
  pose.torsoPitch = trackAt(keyed, STOMP_RUN_TORSO_PITCH);
  keepSwingFeetInReach(pose, 'front');
  pose.chinLift = trackAt(keyed, STOMP_RUN_CHIN);
  pose.brow = frame === 0 || frame === STOMP_RUN_LAST ? pose.brow : FULL_BROW;
  pose.mouth = trackAt(keyed, STOMP_RUN_MOUTH);
  pose.jacketFlare += trackAt(keyed, STOMP_RUN_JACKET);
  return pose;
}
