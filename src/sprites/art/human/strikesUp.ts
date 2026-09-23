/**
 * Carl's strikes at something north of him. He throws them away from the
 * camera, so every one is seen from behind — and from behind a fist travelling
 * away from the viewer has almost no screen motion of its own. Each blow is
 * therefore sold through what the back of a fighter does: the shoulders
 * rolling over the hips, an elbow flaring past the jacket's outline, a fist
 * breaking the line of the head, the hem swinging off the waist, a heel coming
 * up off the floor, the whole body dipping, rising or leaving the ground.
 *
 * Every row starts on the back-view guard and returns to it, lands on the
 * shared impact frame, and is authored as one value per frame for each moving
 * part, so the kinetic chain — foot, then hip, then shoulder, then fist — is
 * written down frame by frame rather than left to an easing curve.
 */

import { HUMAN_SWING_FRAMES } from '../../../core/crawlerFormulas';
import { PLAYER_SPEED } from '../../../core/constants';
import { pt } from '../carl/geometry';
import { type ArmAngles, buildSkeleton, type CarlPose, VIEWS } from '../carl/rig';
import { deg, lerp, type Pt } from '../carlArt';
import {
  ankleOverPivot,
  type FrameTable,
  RIGHT_ARM,
  runPhaseAt,
  TOE_AHEAD_OF_ANKLE,
} from './gaitShared';
import { guardBack } from './idles';
import { RUN_GROUND_PER_CYCLE_PX, RUN_TOE_OFF_PHASE, runFacing } from './locomotion';
import { ATTACK_FRAMES, ATTACK_IMPACT_FRAME } from './timing';
import { kickingLeg } from './travelling';

// ── Keyed channels ───────────────────────────────────────────────────────────

/** One point per frame of an eight-frame strike. */
type PointTrack = readonly Pt[];
/**
 * An arm posed by its joints on the frames that name angles, and reaching for
 * its fist target on the frames that leave it null. An elbow raised above the
 * fist is a pose a two-bone reach never solves into, so a loop or a flared
 * pull is posed by angle.
 */
type ArmTrack = readonly (ArmAngles | null)[];

function sampleTrack(track: FrameTable, frame: number): number {
  const last = track.length - 1;
  const clamped = Math.min(Math.max(frame, 0), last);
  const index = Math.min(Math.floor(clamped), last - 1);
  return lerp(track[index], track[index + 1], clamped - index);
}

function samplePoints(track: PointTrack, frame: number): Pt {
  return pt(
    sampleTrack(
      track.map((point) => point.x),
      frame,
    ),
    sampleTrack(
      track.map((point) => point.y),
      frame,
    ),
  );
}

/** A foot's path through a strike: across, up off the floor, ahead of the hip, and its pitch. */
interface FootTrack {
  readonly x: FrameTable;
  readonly lift: FrameTable;
  readonly depth: FrameTable;
  /**
   * Toes-down pitch in radians. On a foot that is on the floor it is a heel
   * coming up — the foot rolls over the ball, which stays where it stands.
   */
  readonly pitch: FrameTable;
}

/** Everything that moves in a back-view strike, one value per frame. */
interface UpStrikeKeys {
  readonly crouch: FrameTable;
  readonly bob: FrameTable;
  readonly lean: FrameTable;
  /**
   * The chest bent over his hips toward the target, away from the camera, in
   * radians. From behind the only sign of a blow thrown forward is the back
   * shortening and the head sinking toward the shoulders. Absent is upright.
   */
  readonly pitch?: FrameTable;
  readonly sway: FrameTable;
  readonly twist: FrameTable;
  readonly elbowFlare: FrameTable;
  /** Each fist relative to the centre of his shoulders, so it rides the body's dip and rise. */
  readonly rightHand: PointTrack;
  readonly leftHand: PointTrack;
  readonly rightArm?: ArmTrack;
  readonly leftArm?: ArmTrack;
  /**
   * Frames on which both arms are on the camera's side of his back: fists
   * cocked up behind his head, where from behind they cover the back of his
   * skull instead of vanishing behind it. Absent is never.
   */
  readonly armsNearCamera?: readonly boolean[];
  /**
   * Frames on which the right arm alone is on the camera's side of him: a
   * fist cocked back beside his ear, the elbow drawn toward the viewer.
   * Absent is never.
   */
  readonly rightArmNearCamera?: readonly boolean[];
  readonly rightFoot: FootTrack;
  readonly leftFoot: FootTrack;
  readonly jacketFlare: FrameTable;
  /** The jacket hem's lag off the waist: +X toward his right, +Y down. */
  readonly hemLag: PointTrack;
  readonly hairLag: PointTrack;
}

// ── The guard every strike leaves from and returns to ────────────────────────

const GUARD = guardBack(0);
const GUARD_SKELETON = buildSkeleton(GUARD, VIEWS.back);

function fromShoulders(point: Pt): Pt {
  return pt(point.x - GUARD_SKELETON.shoulderCentre.x, point.y - GUARD_SKELETON.shoulderCentre.y);
}

/** The guard's fists, relative to the shoulder centre. */
const GUARD_RIGHT_FIST = fromShoulders(GUARD.rightHand);
const GUARD_LEFT_FIST = fromShoulders(GUARD.leftHand);
const G_CROUCH = GUARD.crouch;
const G_FLARE = GUARD.elbowFlare;
const G_JACKET = GUARD.jacketFlare;
const G_RIGHT_X = GUARD.rightFoot.x;
const G_LEFT_X = GUARD.leftFoot.x;
const R = GUARD_RIGHT_FIST;
const L = GUARD_LEFT_FIST;

const STILL: FrameTable = [0, 0, 0, 0, 0, 0, 0, 0];

function plantedFoot(x: number, pitch: FrameTable = STILL): FootTrack {
  return { x: STILL.map(() => x), lift: STILL, depth: STILL, pitch };
}

/** The right fist's guard, with the fist offset `dy` along the way. */
function guardHeld(fist: Pt, dy: FrameTable = STILL): PointTrack {
  return dy.map((d) => pt(fist.x, fist.y + d));
}

/**
 * Where the ankle sits for a foot `pitch` radians toes-down while the ball of
 * the foot stays on the floor: raised, and drawn back toward the heel.
 */
function heelRaise(pitch: number): { lift: number; depth: number } {
  const ankle = ankleOverPivot(TOE_AHEAD_OF_ANKLE, 'toe', pitch);
  const rest = ankleOverPivot(TOE_AHEAD_OF_ANKLE, 'toe', 0);
  return { lift: rest.y - ankle.y, depth: ankle.x - rest.x };
}

/** Under this lift a foot counts as on the floor. */
const GROUNDED_LIFT = 1e-3;

function placeFoot(pose: CarlPose, side: 'left' | 'right', track: FootTrack, frame: number): void {
  const lift = sampleTrack(track.lift, frame);
  const pitch = sampleTrack(track.pitch, frame);
  const grounded = lift < GROUNDED_LIFT;
  const raise = grounded ? heelRaise(pitch) : { lift: 0, depth: 0 };
  const target = pt(sampleTrack(track.x, frame), -(lift + raise.lift));
  const depth = sampleTrack(track.depth, frame) + raise.depth;
  if (side === 'right') {
    pose.rightFoot = target;
    pose.rightFootDepth = depth;
    pose.rightFootPitch = pitch;
    pose.rightFootPlanted = grounded;
    pose.rightForeshorten = 1;
  } else {
    pose.leftFoot = target;
    pose.leftFootDepth = depth;
    pose.leftFootPitch = pitch;
    pose.leftFootPlanted = grounded;
    pose.leftForeshorten = 1;
  }
}

/** Poses the upper body — trunk, fists, loose parts — from a strike's keys. */
function placeUpperBody(pose: CarlPose, keys: UpStrikeKeys, frame: number): void {
  pose.crouch = sampleTrack(keys.crouch, frame);
  pose.bob = sampleTrack(keys.bob, frame);
  pose.lean = sampleTrack(keys.lean, frame);
  pose.torsoPitch = keys.pitch === undefined ? undefined : sampleTrack(keys.pitch, frame);
  pose.sway = sampleTrack(keys.sway, frame);
  pose.twist = sampleTrack(keys.twist, frame);
  pose.elbowFlare = sampleTrack(keys.elbowFlare, frame);
  const shoulders = buildSkeleton(pose, VIEWS.back).shoulderCentre;
  const right = samplePoints(keys.rightHand, frame);
  const left = samplePoints(keys.leftHand, frame);
  pose.rightHand = pt(shoulders.x + right.x, shoulders.y + right.y);
  pose.leftHand = pt(shoulders.x + left.x, shoulders.y + left.y);
  // Everything he throws goes away from the camera, so both arms stay on the
  // far side of the jacket through the blow; only what clears its outline shows.
  const nearCamera = keys.armsNearCamera?.[Math.round(frame)] ?? false;
  const rightNearCamera = keys.rightArmNearCamera?.[Math.round(frame)] ?? false;
  pose.rightArmBehind = !(nearCamera || rightNearCamera);
  pose.leftArmBehind = !nearCamera;
  pose.jacketFlare = sampleTrack(keys.jacketFlare, frame);
  pose.jacketHemLag = samplePoints(keys.hemLag, frame);
  pose.hairTuftLag = samplePoints(keys.hairLag, frame);
}

function armAt(track: ArmTrack | undefined, frame: number): ArmAngles | null {
  if (track === undefined) return null;
  const index = Math.min(Math.max(Math.round(frame), 0), track.length - 1);
  return track[index];
}

/**
 * Angles in degrees for an arm track. `foreScale` below 1 draws a forearm
 * pointed away from the camera — at a target ahead of him — short.
 */
function arm(upperDegrees: number, foreDegrees: number, foreScale = 1): ArmAngles {
  return { upper: deg(upperDegrees), fore: deg(foreDegrees), foreScale };
}

function poseFromKeys(keys: UpStrikeKeys, frame: number): CarlPose {
  const pose = guardBack(0);
  placeUpperBody(pose, keys, frame);
  placeFoot(pose, 'right', keys.rightFoot, frame);
  placeFoot(pose, 'left', keys.leftFoot, frame);
  pose.rightArmAngles = armAt(keys.rightArm, frame);
  pose.leftArmAngles = armAt(keys.leftArm, frame);
  // An arm posed by angle still reports where its fist is, for everything
  // that reads the fist target: the reach gate, the hand-off to the next row.
  const skeleton = buildSkeleton(pose, VIEWS.back);
  if (pose.rightArmAngles !== null) pose.rightHand = skeleton.rightArm.end;
  if (pose.leftArmAngles !== null) pose.leftHand = skeleton.leftArm.end;
  return pose;
}

// ── Uppercut ─────────────────────────────────────────────────────────────────

/**
 * A rear-hand uppercut at a tall enemy's chin. He dips and drops the right
 * shoulder, the fist sinking out past his right hip where, from behind, it
 * shows below the elbow; then he drives up out of the legs: the right heel
 * peels, the hips and shoulders roll left over it, and the fist scoops up the
 * middle of him and breaks the top of his head's outline beside it on the
 * impact frame, the body risen onto the ball of the rear foot. The low-to-high path
 * is the whole read: an arm raised from the guard alone reads as a wave. The
 * lead fist pulls in tight to the ribs as the right goes up.
 */
const UPPERCUT: UpStrikeKeys = {
  crouch: [G_CROUCH, 0.2, 0.28, 0.12, 0.04, 0.05, 0.07, G_CROUCH],
  bob: STILL,
  lean: [0, deg(7), deg(10), deg(3), deg(-6), deg(-7), deg(-3), 0],
  pitch: [0, 0.12, 0.18, 0.05, -0.08, -0.06, 0, 0],
  sway: [0, 0.03, 0.045, 0.015, -0.025, -0.03, -0.01, 0],
  twist: [0, -0.3, -0.45, -0.1, 0.4, 0.45, 0.2, 0],
  elbowFlare: [G_FLARE, 0.2, 0.15, 0.2, 0.25, 0.3, 0.45, G_FLARE],
  rightHand: [
    R,
    pt(0.34, 0.3),
    pt(0.38, 0.44),
    pt(0.26, 0.06),
    pt(0.2, -0.64),
    pt(0.2, -0.52),
    pt(0.18, -0.18),
    R,
  ],
  leftHand: [
    L,
    L,
    pt(-0.22, 0.1),
    pt(-0.24, 0.16),
    pt(-0.26, 0.2),
    pt(-0.25, 0.18),
    pt(-0.2, 0.06),
    L,
  ],
  rightFoot: plantedFoot(G_RIGHT_X, [0, 0, deg(4), deg(18), deg(34), deg(30), deg(12), 0]),
  leftFoot: plantedFoot(G_LEFT_X),
  jacketFlare: [G_JACKET, 0.1, 0.15, 0.25, 0.5, 0.45, 0.25, G_JACKET],
  hemLag: [
    pt(0, 0),
    pt(0.01, 0),
    pt(0.02, 0.01),
    pt(0.02, 0),
    pt(-0.02, -0.02),
    pt(-0.035, -0.015),
    pt(-0.02, 0),
    pt(0, 0),
  ],
  hairLag: [
    pt(0, 0),
    pt(0.01, 0),
    pt(0.015, 0.01),
    pt(0.01, 0),
    pt(-0.015, 0.01),
    pt(-0.025, 0),
    pt(-0.01, 0),
    pt(0, 0),
  ],
};

export function uppercutUp(frame: number): CarlPose {
  return poseFromKeys(UPPERCUT, frame);
}

// ── Overhand right ───────────────────────────────────────────────────────────

/**
 * A looping overhand right, thrown like a pitch. The shoulder loads back and
 * down, the fist cocked beside his right ear on the camera's side of him,
 * the elbow low; then the elbow lifts and the fist rolls over the top and
 * comes down onto the target ahead, and his weight falls forward and left
 * onto the lead leg with it: knees give, the torso tips over the left foot,
 * the right heel comes up. The follow-through carries the fist down and
 * across his body to the left hip, where it shows below the jacket, before
 * the guard returns. That diagonal, high right to low left, is the blow's
 * read from behind; an arm held up beside the head alone reads as a wave.
 */
/**
 * On contact the overhand's forearm drives forward at the target's head, away
 * from the camera, so it draws at a little over half its length.
 */
const OVERHAND_FOREARM_AWAY = 0.6;
const OVERHAND: UpStrikeKeys = {
  crouch: [G_CROUCH, 0.14, 0.12, 0.1, 0.2, 0.26, 0.16, G_CROUCH],
  bob: STILL,
  lean: [0, deg(8), deg(10), deg(2), deg(-9), deg(-11), deg(-5), 0],
  pitch: [0, -0.06, -0.1, 0.1, 0.45, 0.5, 0.2, 0],
  sway: [0, 0.04, 0.045, 0.0, -0.05, -0.06, -0.02, 0],
  twist: [0, -0.4, -0.55, -0.1, 0.5, 0.6, 0.25, 0],
  elbowFlare: [G_FLARE, 0.2, 0.1, 1, 0.9, 0.3, 0.5, G_FLARE],
  rightHand: [R, pt(0.3, -0.22), pt(0.32, -0.3), R, R, pt(0.02, 0.3), pt(0.06, 0.04), R],
  leftHand: [
    L,
    pt(-0.2, -0.02),
    pt(-0.22, -0.04),
    L,
    pt(-0.24, 0.14),
    pt(-0.26, 0.18),
    pt(-0.2, 0.06),
    L,
  ],
  rightArm: [
    null,
    null,
    null,
    arm(150, 235),
    arm(195, 215, OVERHAND_FOREARM_AWAY),
    null,
    null,
    null,
  ],
  rightArmNearCamera: [false, true, true, false, false, false, false, false],
  rightFoot: plantedFoot(G_RIGHT_X, [0, 0, deg(6), deg(16), deg(30), deg(32), deg(14), 0]),
  leftFoot: plantedFoot(G_LEFT_X),
  jacketFlare: [G_JACKET, 0.15, 0.25, 0.3, 0.55, 0.6, 0.3, G_JACKET],
  hemLag: [
    pt(0, 0),
    pt(0.015, 0),
    pt(0.03, -0.01),
    pt(0.02, -0.01),
    pt(-0.02, 0.01),
    pt(-0.045, 0.02),
    pt(-0.025, 0.01),
    pt(0, 0),
  ],
  hairLag: [
    pt(0, 0),
    pt(0.015, 0),
    pt(0.025, 0),
    pt(0.01, 0),
    pt(-0.02, 0.01),
    pt(-0.035, 0.01),
    pt(-0.015, 0),
    pt(0, 0),
  ],
};

export function overhandUp(frame: number): CarlPose {
  return poseFromKeys(OVERHAND, frame);
}

// ── Two-hand hammer-fist ─────────────────────────────────────────────────────

/**
 * Both fists clubbed together over his head and brought down on a tall
 * enemy's collarbone. He dips first, then the arms go up fast and high — his
 * whole outline grows by a forearm — he rises onto both toes at the top, then
 * drops his weight straight down through the blow: knees bend, both heels
 * slam, the head sinks between the shoulders, and on the impact frame the
 * clubbed fists show just over his sunken head with the elbows wide either
 * side of it. The drop under the fists is the blow: arms coming down over a
 * body that stays upright read as a stretch.
 */
const HAMMER_FIST: UpStrikeKeys = {
  crouch: [G_CROUCH, 0.16, 0.0, 0.0, 0.42, 0.42, 0.2, G_CROUCH],
  bob: [0, 0.01, -0.03, -0.04, 0, 0, 0, 0],
  lean: STILL,
  pitch: [0, 0.1, -0.1, -0.12, 0.75, 0.75, 0.3, 0],
  sway: STILL,
  twist: [0, 0, 0.06, 0.06, -0.04, -0.06, -0.03, 0],
  elbowFlare: [G_FLARE, 1.2, -0.3, -0.5, 1.6, 1.6, 1.4, G_FLARE],
  rightHand: [
    R,
    pt(0.14, 0.22),
    pt(0.05, -0.62),
    pt(0.05, -0.56),
    pt(0.06, -0.24),
    pt(0.06, -0.24),
    pt(0.12, 0.1),
    R,
  ],
  leftHand: [
    L,
    pt(-0.13, 0.22),
    pt(-0.04, -0.61),
    pt(-0.04, -0.55),
    pt(-0.05, -0.24),
    pt(-0.05, -0.24),
    pt(-0.11, 0.1),
    L,
  ],
  armsNearCamera: [false, false, true, true, false, false, false, false],
  rightFoot: plantedFoot(G_RIGHT_X, [0, 0, deg(18), deg(20), 0, 0, 0, 0]),
  leftFoot: plantedFoot(G_LEFT_X, [0, 0, deg(18), deg(20), 0, 0, 0, 0]),
  jacketFlare: [G_JACKET, 0.15, 0.3, 0.35, 0.6, 0.55, 0.3, G_JACKET],
  hemLag: [
    pt(0, 0),
    pt(0, 0.01),
    pt(0, -0.03),
    pt(0, -0.02),
    pt(0, 0.03),
    pt(0, 0.035),
    pt(0, 0.015),
    pt(0, 0),
  ],
  hairLag: [
    pt(0, 0),
    pt(0, -0.01),
    pt(0, 0.02),
    pt(0, 0.01),
    pt(0, -0.02),
    pt(0, -0.015),
    pt(0, 0),
    pt(0, 0),
  ],
};

export function hammerFistUp(frame: number): CarlPose {
  return poseFromKeys(HAMMER_FIST, frame);
}

// ── Front kick ───────────────────────────────────────────────────────────────

/**
 * The punt at something knee-high ahead of him. Weight goes over the left
 * foot, the right knee chambers up in front (from behind: the shin hangs under
 * a thigh that has vanished forward), then the foot drives out and away along
 * the floor at the target and snaps back to the chamber before it is set
 * down. The standing knee stays soft and both fists stay up in the guard,
 * the elbows opening for balance. An arm swung or held out from the shoulder
 * is the only limb that shows past the jacket from behind, and it reads as a
 * limp counter-swing or a hand hailing a cab rather than as a kick.
 */
const FRONT_KICK_RIGHT_X: FrameTable = [G_RIGHT_X, 0.15, 0.16, 0.22, 0.3, 0.27, 0.18, G_RIGHT_X];
const FRONT_KICK: UpStrikeKeys = {
  crouch: [G_CROUCH, 0.11, 0.06, 0.05, 0.08, 0.1, 0.12, G_CROUCH],
  bob: STILL,
  lean: [0, deg(-2), deg(-4), deg(-4), deg(-5), deg(-4), deg(-1), 0],
  pitch: [0, 0.05, -0.1, -0.2, -0.3, -0.25, -0.08, 0],
  sway: [0, -0.035, -0.06, -0.06, -0.05, -0.05, -0.03, 0],
  twist: [0, -0.05, -0.1, 0.05, 0.15, 0.1, 0.05, 0],
  elbowFlare: [G_FLARE, 0.7, 0.8, 0.85, 0.85, 0.8, 0.7, G_FLARE],
  rightHand: [R, R, R, R, R, R, R, R],
  leftHand: guardHeld(L, STILL),
  rightFoot: {
    x: FRONT_KICK_RIGHT_X,
    lift: [0, 0.14, 0.46, 0.56, 0.66, 0.52, 0.12, 0],
    depth: [0, 0.04, 0.16, 0.5, 0.76, 0.5, 0.08, 0],
    pitch: [0, deg(20), deg(-10), deg(20), deg(30), deg(15), deg(5), 0],
  },
  leftFoot: plantedFoot(G_LEFT_X),
  jacketFlare: [G_JACKET, 0.15, 0.25, 0.35, 0.45, 0.4, 0.2, G_JACKET],
  hemLag: [
    pt(0, 0),
    pt(0.015, 0),
    pt(0.03, -0.01),
    pt(0.02, 0),
    pt(0, 0.01),
    pt(-0.01, 0.01),
    pt(-0.01, 0),
    pt(0, 0),
  ],
  hairLag: [
    pt(0, 0),
    pt(0.01, 0),
    pt(0.02, 0),
    pt(0.01, 0.01),
    pt(0, 0.015),
    pt(-0.01, 0.01),
    pt(0, 0),
    pt(0, 0),
  ],
};

export function frontKickUp(frame: number): CarlPose {
  return poseFromKeys(FRONT_KICK, frame);
}

// ── Hop-knee ─────────────────────────────────────────────────────────────────

/**
 * The Jump Attack: a hop into a flying knee. He sinks, reaches up with both
 * hands for the enemy's head, springs off the left foot, and at the top of
 * the hop yanks both fists down to his chest as the right knee drives up to
 * meet them — elbows flared wide, both feet off the floor, his shadow
 * shrinking under him. He lands on the left foot into a deep absorb and
 * steps back down into his guard.
 */
const HOP_KNEE_BOB: FrameTable = [0, 0.02, -0.06, -0.17, -0.24, -0.14, 0, 0];
/**
 * In the air the push-off foot hangs under the hip with its knee a little
 * bent, so it rides this much higher than the hop alone would carry it.
 */
const HOP_TRAILING_KNEE_TUCK = 0.05;
const HOP_KNEE: UpStrikeKeys = {
  crouch: [G_CROUCH, 0.25, 0.06, 0.0, 0.0, 0.02, 0.22, G_CROUCH],
  bob: HOP_KNEE_BOB,
  lean: [0, 0, deg(-2), deg(-3), deg(-3), deg(-2), deg(-1), 0],
  pitch: [0, 0.1, -0.05, 0.15, 0.4, 0.3, 0.12, 0],
  sway: [0, -0.01, -0.03, -0.04, -0.04, -0.03, -0.02, 0],
  twist: [0, 0.05, 0.1, 0.1, 0.05, 0, 0, 0],
  elbowFlare: [G_FLARE, 0.2, -0.3, -0.8, -1, -0.9, -0.3, G_FLARE],
  rightHand: [R, pt(0.22, -0.4), pt(0.26, -0.56), R, R, R, pt(0.16, -0.06), R],
  leftHand: [L, pt(-0.21, -0.4), pt(-0.25, -0.56), L, L, L, pt(-0.15, -0.06), L],
  rightArm: [null, null, null, arm(70, -150), arm(50, -100), arm(45, -90), null, null],
  leftArm: [null, null, null, arm(-70, 150), arm(-50, 100), arm(-45, 90), null, null],
  rightFoot: {
    x: [G_RIGHT_X, G_RIGHT_X, 0.16, 0.15, 0.14, 0.15, 0.16, G_RIGHT_X],
    lift: [0, 0, 0.14, 0.48, 0.66, 0.46, 0.12, 0],
    depth: [0, 0, 0.05, 0.16, 0.24, 0.18, 0.05, 0],
    pitch: [0, deg(24), deg(40), deg(35), deg(35), deg(30), deg(10), 0],
  },
  leftFoot: {
    x: STILL.map(() => G_LEFT_X),
    lift: HOP_KNEE_BOB.map((bob, frame) =>
      frame > 1 && bob < 0 ? -bob + HOP_TRAILING_KNEE_TUCK : 0,
    ),
    depth: [0, 0, 0, -0.03, -0.04, -0.02, 0, 0],
    pitch: [0, deg(6), deg(38), deg(40), deg(40), deg(30), 0, 0],
  },
  jacketFlare: [G_JACKET, 0.1, 0.3, 0.45, 0.5, 0.55, 0.4, G_JACKET],
  hemLag: [
    pt(0, 0),
    pt(0, -0.01),
    pt(0, 0.02),
    pt(0, 0.035),
    pt(0, 0.02),
    pt(0, -0.02),
    pt(0, -0.03),
    pt(0, 0),
  ],
  hairLag: [
    pt(0, 0),
    pt(0, -0.01),
    pt(0, 0.015),
    pt(0, 0.025),
    pt(0, 0.01),
    pt(0, -0.015),
    pt(0, -0.02),
    pt(0, 0),
  ],
};

export function hopKneeUp(frame: number): CarlPose {
  return poseFromKeys(HOP_KNEE, frame);
}

// ── The running punt ─────────────────────────────────────────────────────────

/**
 * How much of a run cycle one frame of a strike covers at his base speed: the
 * swing's ticks shared over the row's frames, at the run's own ground per
 * cycle. The legs of the running punt step through the run at exactly this
 * rate, so the foot in stance holds the floor while the sprite travels.
 */
const RUN_CYCLE_PER_STRIKE_FRAME =
  ((HUMAN_SWING_FRAMES / ATTACK_FRAMES) * PLAYER_SPEED) / RUN_GROUND_PER_CYCLE_PX;

/**
 * The phase, of whichever leg kicks, the running punt lands at: that leg's
 * own push-off plus the frames to impact, so the kick is the leg's swing out of
 * its push-off, driven harder and higher, while the other foot lands and holds
 * the floor under the impact.
 */
const PUNT_KICKING_LEG_PHASE = RUN_TOE_OFF_PHASE + ATTACK_IMPACT_FRAME * RUN_CYCLE_PER_STRIKE_FRAME;
const LAST_FRAME = ATTACK_FRAMES - 1;

function puntRunPhaseAt(entry: number, frame: number): number {
  return runPhaseAt(entry, frame, RUN_CYCLE_PER_STRIKE_FRAME);
}

/** The run phase the running punt begun at `entry` hands the legs back at. */
export function runningPuntExitPhase(entry: number): number {
  return puntRunPhaseAt(entry, LAST_FRAME);
}

/**
 * The kicking foot's own path, used on the frames between the run's hand-offs:
 * it chambers higher than a running knee ever comes, sweeps out low and far
 * along the floor through the target, and — unlike the standing push-kick —
 * follows through upward, the way a punted ball's kick does.
 */
const PUNT_LIFT: FrameTable = [0, 0.24, 0.44, 0.32, 0.28, 0.42, 0.26, 0];
const PUNT_DEPTH: FrameTable = [0, -0.02, 0.14, 0.44, 0.62, 0.5, 0.3, 0];
const PUNT_PITCH: FrameTable = [0, deg(40), deg(10), deg(30), deg(40), deg(20), deg(5), 0];
/** How much of each frame's foot is the kick rather than the run's own swing. */
const PUNT_WEIGHT: FrameTable = [0, 0.6, 1, 1, 1, 1, 0.6, 0];
/**
 * The kick sweeps only a little outboard of the run's line, enough to clear
 * the standing leg. From behind a foot driven ahead has to vanish up behind
 * his shorts; sent further out, its shin shows level beside the knee and reads
 * as a heel curled up behind him.
 */
const PUNT_OUTBOARD = 0.07;

/**
 * The arms of the running punt: the run's own swing, thrown out wide for
 * balance as the leg goes through — the one opposite the kicking leg
 * furthest — and a lean off the kicking leg over the stance foot.
 */
const PUNT_ARM_BOOST: FrameTable = [0, 0.4, 0.8, 1, 1, 0.8, 0.4, 0];
const PUNT_LEAN = deg(-4);
const PUNT_OTHER_ARM_OUT = deg(55);
const PUNT_KICKING_SIDE_ARM_OUT = deg(25);

/** Which foot, as `placeFoot`'s sign, the running punt up begun at `entry` kicks with. */
export function runningPuntUpKickingSide(entry: number): number {
  return kickingLeg(
    (at) => puntRunPhaseAt(entry, at),
    PUNT_WEIGHT,
    ATTACK_IMPACT_FRAME,
    PUNT_KICKING_LEG_PHASE,
  ).side;
}

/**
 * The running punt, its legs the run's own from `entry` on, kicked with
 * whichever leg is nearest its own push-off-and-swing at the impact. Head-on
 * the left kick is the right one mirrored across him: the foot sweeps out on
 * its own side and the arm furthest flung is the one opposite the kick.
 */
export function runningPuntUp(frame: number, entry: number): CarlPose {
  const pose = runFacing(puntRunPhaseAt(entry, frame), true);
  const side = runningPuntUpKickingSide(entry);
  const kicksRight = side === RIGHT_ARM;
  const weight = sampleTrack(PUNT_WEIGHT, frame);
  const runFoot = kicksRight ? pose.rightFoot : pose.leftFoot;
  const runLift = -runFoot.y;
  const runDepth = (kicksRight ? pose.rightFootDepth : pose.leftFootDepth) ?? 0;
  const runPitch = kicksRight ? pose.rightFootPitch : pose.leftFootPitch;
  const lift = lerp(runLift, sampleTrack(PUNT_LIFT, frame), weight);
  const foot = pt(runFoot.x + side * PUNT_OUTBOARD * weight, -lift);
  const depth = lerp(runDepth, sampleTrack(PUNT_DEPTH, frame), weight);
  const pitch = lerp(runPitch, sampleTrack(PUNT_PITCH, frame), weight);
  if (kicksRight) {
    pose.rightFoot = foot;
    pose.rightFootDepth = depth;
    pose.rightFootPitch = pitch;
    pose.rightLegNearness = 0;
  } else {
    pose.leftFoot = foot;
    pose.leftFootDepth = depth;
    pose.leftFootPitch = pitch;
    pose.leftLegNearness = 0;
  }
  if (weight > 0) {
    if (kicksRight) pose.rightFootPlanted = false;
    else pose.leftFootPlanted = false;
  }
  const boost = sampleTrack(PUNT_ARM_BOOST, frame);
  pose.lean += PUNT_LEAN * boost;
  const kickingArmOut = PUNT_KICKING_SIDE_ARM_OUT * boost;
  const otherArmOut = PUNT_OTHER_ARM_OUT * boost;
  const right = pose.rightArmAngles;
  const left = pose.leftArmAngles;
  // Head-on an arm's angle turns it outward on its own side: positive on the
  // right, negative on the left.
  if (right !== null) {
    const out = kicksRight ? kickingArmOut : otherArmOut;
    pose.rightArmAngles = { ...right, upper: right.upper + out };
  }
  if (left !== null) {
    const out = kicksRight ? otherArmOut : kickingArmOut;
    pose.leftArmAngles = { ...left, upper: left.upper - out };
  }
  pose.brow = 1;
  return pose;
}
