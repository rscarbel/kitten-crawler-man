/**
 * Carl's hands-on work: nailing down a barricade, setting a piece of gym
 * equipment down where it goes, and mending a broken thing with a spanner.
 *
 * He was a machinery technician, so all three are a mechanic's: close to the
 * work, one hand bracing it, short strikes from the forearm rather than big
 * swings from the shoulder, and a proper lift — a squat with a straight back,
 * never a stoop.
 *
 * Each is authored in all three views, because the work can be on any side of
 * him and he turns to face it. Every row keeps both feet where they stood: the
 * only foot that moves is the one he kneels back onto, and it plants on its
 * toes before any weight goes on it.
 */

import { mixPt, pt } from '../carl/geometry';
import { handGrip } from '../carl/limbs';
import { SHIN_LENGTH, THIGH_LENGTH } from '../carl/proportions';
import { FLOOR_BOARD } from '../carl/props/board';
import {
  buildSkeleton,
  type CarlPose,
  type CarlView,
  restingPose,
  setArmAngles,
  VIEWS,
} from '../carl/rig';
import { clamp01, easeInOut, lerp, type Pt } from '../carlArt';
import {
  ankleOverPivot,
  type PathKey,
  profileFootTarget,
  SOLE_REST_Y,
  soleOffsets,
  type Track,
  trackAt,
} from './gaitShared';
import { idleBack, idleFront, idleSide } from './idles';

// ── Timing ───────────────────────────────────────────────────────────────────

/** Dropping onto one knee: the rear foot steps back onto its toes, then the knee goes down. */
export const BUILD_KNEEL_FRAMES = 4;
export const BUILD_KNEEL_TICKS_PER_FRAME = 4;
/**
 * The hammering loop: three strikes of four frames, then a six-frame check —
 * he sits back, looks the work over, and bends to it again. Four frames is the
 * fewest a strike can take and still read as a swing (cock, drive, land,
 * rebound) rather than strobing.
 */
const STRIKES_PER_LOOP = 3;
const FRAMES_PER_STRIKE = 4;
const CHECK_FRAMES = 6;
export const BUILD_FRAMES = STRIKES_PER_LOOP * FRAMES_PER_STRIKE + CHECK_FRAMES;
/**
 * Five ticks a frame puts a strike every third of a second: a steady, placed
 * rhythm, the pace of someone driving a nail rather than beating on a board.
 */
export const BUILD_TICKS_PER_FRAME = 5;
/** Where in its four frames each strike lands: cock, drive, land, rebound. */
const STRIKE_COCK = 0;
const STRIKE_DRIVE = 1;
const STRIKE_LAND = 2;
const STRIKE_REBOUND = 3;
const CHECK_START = STRIKES_PER_LOOP * FRAMES_PER_STRIKE;
/**
 * The beat the row's first frame shows: the middle of the check, sat back
 * with the hammer resting on his thigh. That is the pose the kneel settles
 * into and the rise gets up from, so both hand off to a still, low pose
 * rather than to a hammer cocked over his head.
 *
 * Beats below are counted from the first strike's cock; frames are the row's.
 */
const LOOP_ENTRY_BEAT = CHECK_START + 3;

function beatOfFrame(frame: number): number {
  return (frame + LOOP_ENTRY_BEAT) % BUILD_FRAMES;
}

/** The frames of the hammering loop on which the hammer lands on the board. */
export const BUILD_STRIKE_FRAMES: readonly number[] = Array.from(
  { length: STRIKES_PER_LOOP },
  (_unused, strike) =>
    (strike * FRAMES_PER_STRIKE + STRIKE_LAND - LOOP_ENTRY_BEAT + BUILD_FRAMES) % BUILD_FRAMES,
);
export const BUILD_RISE_FRAMES = 4;
export const BUILD_RISE_TICKS_PER_FRAME = 4;

// ── Shared machinery ─────────────────────────────────────────────────────────

interface PtTrack {
  readonly x: Track;
  readonly y: Track;
}

function atPt(frame: number, track: PtTrack): Pt {
  return pt(trackAt(frame, track.x), trackAt(frame, track.y));
}

/**
 * A channel of a looping row: the keys once round, with the last key repeated
 * a loop before the first and the first a loop after the last, so the spline's
 * slopes run straight through the seam instead of flattening against it.
 */
function loopTrack(frames: number, keys: readonly PathKey[]): Track {
  const first = keys[0];
  const last = keys[keys.length - 1];
  return [[last[0] - frames, last[1]], ...keys, [first[0] + frames, first[1]]];
}

/** A point channel from `[frame, point]` keys, looped over `frames` when `frames` is given. */
function pointTrack(keys: readonly (readonly [number, Pt])[], frames?: number): PtTrack {
  const xs: PathKey[] = keys.map(([frame, p]) => [frame, p.x]);
  const ys: PathKey[] = keys.map(([frame, p]) => [frame, p.y]);
  if (frames === undefined) return { x: xs, y: ys };
  return { x: loopTrack(frames, xs), y: loopTrack(frames, ys) };
}

/** The same beat of every strike, repeated at each strike of the loop. */
function perStrike<T>(beats: readonly (readonly [number, T])[]): (readonly [number, T])[] {
  const keys: (readonly [number, T])[] = [];
  for (let strike = 0; strike < STRIKES_PER_LOOP; strike++) {
    for (const [beat, value] of beats) keys.push([strike * FRAMES_PER_STRIKE + beat, value]);
  }
  return keys;
}

/**
 * The `angle` a held prop needs for its head to point along `absolute` (in
 * figure space as authored, 0 toward +X, positive clockwise down the screen).
 * A prop's own `angle` is relative to the haft the fist reports, which turns
 * with the wrist; a tool aimed at a board has to be aimed in the world instead.
 * A mirrored view reflects the prop's angle along with the wrist, so solving
 * against the authored pose aims it in every view.
 */
function aimedAngle(
  pose: CarlPose,
  view: CarlView,
  hand: 'left' | 'right',
  absolute: number,
): number {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const chain = hand === 'right' ? skeleton.rightArm : skeleton.leftArm;
  return absolute - handGrip(chain).haftAngle;
}

/** The pose's hands at wherever `pose` actually solves them, for a row that picks up from it. */
function solvedHands(pose: CarlPose, view: CarlView): { left: Pt; right: Pt } {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  return { left: skeleton.leftArm.end, right: skeleton.rightArm.end };
}

/** The hip's height with the rig's full crouch and no bob — what a kneel's bob is measured from. */
const FULL_CROUCH_HIP_Y = buildSkeleton({ ...restingPose(), crouch: 1 }, VIEWS.side).hip.y;
/** How far the profile hip joints sit either side of the hip centre. */
const PROFILE_LEG_ROOT = buildSkeleton(restingPose(), VIEWS.side).rightLeg.root.x;

/**
 * The hammer a third over the prop's own size: at the 32 px tile its head is
 * otherwise three pixels, and the head is what says hammer.
 */
const HAMMER_SCALE = 1.3;
/** Straight down the screen, as a direction; its negative is straight up. */
const QUARTER_TURN = Math.PI / 2;

// ── Profile: the kneel ───────────────────────────────────────────────────────

const SIDE_IDLE = idleSide(0);
/**
 * The near foot stays exactly where it stood and becomes the front foot of
 * the kneel; the far one steps back and goes down onto its knee. Kneeling on
 * the far knee leaves the kneeling shin on show behind him and the working
 * arm on the near side, over everything.
 */
const FRONT_FOOT: Pt = SIDE_IDLE.rightFoot;
/** The kneeling knee's joint centre rests this high: half a knee's width off the floor. */
const KNEE_ON_FLOOR_Y = -0.04;
/**
 * Where the hip centre settles, from his ground point. Back from the front
 * foot by about a thigh's worth of lunge, so the front shin can stand near
 * upright under a knee raised to hip height.
 */
const KNEEL_HIP_X = -0.14;
/** The kneeling thigh leans back from the hip: the knee is a little behind it. */
const KNEELING_THIGH_TILT = 0.05;
/**
 * The kneeling foot curls onto its toes, heel up: toes-down pitch, radians.
 * The toes dug in are what take his weight off the kneecap.
 */
const KNEELING_FOOT_PITCH = 1.1;

const KNEEL_REAR_ROOT_X = KNEEL_HIP_X - PROFILE_LEG_ROOT;
const KNEEL_ROOT_Y = KNEE_ON_FLOOR_Y - THIGH_LENGTH * Math.cos(KNEELING_THIGH_TILT);
const KNEEL_KNEE: Pt = pt(
  KNEEL_REAR_ROOT_X - THIGH_LENGTH * Math.sin(KNEELING_THIGH_TILT),
  KNEE_ON_FLOOR_Y,
);
/**
 * The shin's rise from the floor, from the kneecap back to the ankle, solved so
 * the curled toes land on the floor rather than chosen.
 */
const KNEELING_SHIN_RISE = Math.asin(
  (KNEE_ON_FLOOR_Y + soleOffsets(KNEELING_FOOT_PITCH).toe.y - SOLE_REST_Y) / SHIN_LENGTH,
);
const KNEEL_REAR_ANKLE: Pt = pt(
  KNEEL_KNEE.x - SHIN_LENGTH * Math.cos(KNEELING_SHIN_RISE),
  KNEEL_KNEE.y - SHIN_LENGTH * Math.sin(KNEELING_SHIN_RISE),
);
/** Where the kneeling toes dig into the floor. */
const KNEEL_REAR_TOE_X = KNEEL_REAR_ANKLE.x + soleOffsets(KNEELING_FOOT_PITCH).toe.x;
const KNEEL_BOB = KNEEL_ROOT_Y - FULL_CROUCH_HIP_Y;
const KNEEL_SWAY = KNEEL_HIP_X / VIEWS.side.lateral;

/** The kneeling legs, the same on every frame of the loop so neither the knee nor the toes slide. */
function kneelLegsSide(pose: CarlPose): void {
  pose.crouch = 1;
  pose.bob = KNEEL_BOB;
  pose.sway = KNEEL_SWAY;
  pose.rightFoot = FRONT_FOOT;
  pose.rightFootPitch = 0;
  pose.leftFoot = profileFootTarget(KNEEL_REAR_ANKLE, KNEELING_FOOT_PITCH);
  pose.leftFootPitch = KNEELING_FOOT_PITCH;
  pose.leftKneeBreak = 1;
  pose.rightKneeBreak = 1;
}

/**
 * Bent to the board: a mechanic's hunch over floor work, the chest over the
 * front thigh. Upright he cannot reach the floor from a kneel at all.
 */
const SIDE_WORK_LEAN = 0.75;
/** Sat back for the check, about upright over the kneeling thigh. */
const SIDE_CHECK_LEAN = 0.42;
/** Each blow drives the shoulders down a little further into it. */
const SIDE_STRIKE_PUMP = 0.04;
/** Head tipped down at the nail while working, and up to take in the whole board on the check. */
const SIDE_WORK_HEAD_TILT = 0.38;
const SIDE_CHECK_HEAD_TILT = -0.1;
/** Then down along the board to the nail he has just driven, before he bends to the next. */
const SIDE_CHECK_LOOK_ALONG_TILT = 0.22;

/** The bracing palm flat on the board, just short of the nail. */
const SIDE_BRACE_WRIST: Pt = pt(FLOOR_BOARD.nearX + 0.1, -0.18);
/** On the check, the bracing hand comes off the board onto the front knee. */
const SIDE_KNEE_REST_WRIST: Pt = pt(0.22, -0.55);
/** The hammer hand rests on the front thigh while he looks. */
const SIDE_HAMMER_REST_WRIST: Pt = pt(0.12, -0.6);

/** The hammer's wrist through one strike, beat by beat. */
const SIDE_HAMMER_BEATS: readonly (readonly [number, Pt])[] = [
  [STRIKE_COCK, pt(0.7, -0.66)],
  [STRIKE_DRIVE, pt(0.6, -0.48)],
  [STRIKE_LAND, pt(0.4, -0.26)],
  [STRIKE_REBOUND, pt(0.44, -0.44)],
];
/** The hammer head's direction through one strike: cocked up and back, landing level. */
const SIDE_HAMMER_AIM_BEATS: readonly (readonly [number, number])[] = [
  [STRIKE_COCK, -QUARTER_TURN + 0.05],
  [STRIKE_DRIVE, -0.5],
  [STRIKE_LAND, 0.1],
  [STRIKE_REBOUND, -0.8],
];

const SIDE_HAMMER_WRIST = pointTrack(
  [
    ...perStrike(SIDE_HAMMER_BEATS),
    [CHECK_START + 1, SIDE_HAMMER_REST_WRIST],
    [CHECK_START + 3, SIDE_HAMMER_REST_WRIST],
    [CHECK_START + 5, pt(0.3, -0.56)],
  ],
  BUILD_FRAMES,
);
const SIDE_HAMMER_AIM = loopTrack(BUILD_FRAMES, [
  ...perStrike(SIDE_HAMMER_AIM_BEATS),
  [CHECK_START + 1, 0.3],
  [CHECK_START + 3, 0.3],
  [CHECK_START + 5, -QUARTER_TURN],
]);
const SIDE_BRACE = pointTrack(
  [
    [0, SIDE_BRACE_WRIST],
    [CHECK_START - 1, SIDE_BRACE_WRIST],
    [CHECK_START + 1, SIDE_KNEE_REST_WRIST],
    [CHECK_START + 3, SIDE_KNEE_REST_WRIST],
    [CHECK_START + 5, SIDE_BRACE_WRIST],
  ],
  BUILD_FRAMES,
);
const SIDE_LEAN = loopTrack(BUILD_FRAMES, [
  ...perStrike<number>([
    [STRIKE_COCK, SIDE_WORK_LEAN - SIDE_STRIKE_PUMP / 2],
    [STRIKE_LAND, SIDE_WORK_LEAN + SIDE_STRIKE_PUMP],
  ]),
  [CHECK_START + 1, SIDE_CHECK_LEAN + 0.1],
  [CHECK_START + 2, SIDE_CHECK_LEAN],
  [CHECK_START + 3, SIDE_CHECK_LEAN + 0.08],
  [CHECK_START + 5, SIDE_WORK_LEAN - 0.06],
]);
const SIDE_HEAD_TILT = loopTrack(BUILD_FRAMES, [
  [0, SIDE_WORK_HEAD_TILT],
  [CHECK_START - 1, SIDE_WORK_HEAD_TILT],
  [CHECK_START + 2, SIDE_CHECK_HEAD_TILT],
  [CHECK_START + 3, SIDE_CHECK_LOOK_ALONG_TILT],
  [CHECK_START + 5, SIDE_WORK_HEAD_TILT],
]);
/** The one blink of the loop, on the check, while he is looking rather than aiming. */
const CHECK_BLINK_FRAME = CHECK_START + 2;
const CONCENTRATION_BROW = 0.85;
/** On the check the brow eases a little: the look of someone judging, not straining. */
const CHECK_BROW = 0.6;

function isCheckFrame(frame: number): boolean {
  return frame > CHECK_START && frame < BUILD_FRAMES - 1;
}

/**
 * The hammer in the right fist and the board in the left. In profile the
 * board lies on the floor rather than in the hand (see `props/board.ts`), so
 * it stays put while his hands come off it for the check.
 */
function withTools(pose: CarlPose, hammerAim: number, view: CarlView): void {
  pose.rightHandShape = 'grip';
  pose.leftHandShape = 'grip';
  pose.heldProps = [
    {
      kind: 'hammer',
      hand: 'right',
      scale: HAMMER_SCALE,
      angle: aimedAngle(pose, view, 'right', hammerAim),
    },
    { kind: 'board', hand: 'left' },
  ];
}

function buildLoopSide(frame: number): CarlPose {
  const pose = restingPose();
  kneelLegsSide(pose);
  pose.lean = trackAt(frame, SIDE_LEAN);
  pose.headTilt = trackAt(frame, SIDE_HEAD_TILT);
  pose.headTurn = SIDE_IDLE.headTurn;
  pose.brow = isCheckFrame(frame) ? CHECK_BROW : CONCENTRATION_BROW;
  pose.blink = frame === CHECK_BLINK_FRAME ? 1 : 0;
  pose.rightHand = atPt(frame, SIDE_HAMMER_WRIST);
  pose.leftHand = atPt(frame, SIDE_BRACE);
  pose.elbowFlare = SIDE_IDLE.elbowFlare;
  pose.rightFist = 1;
  withTools(pose, trackAt(frame, SIDE_HAMMER_AIM), 'side');
  return pose;
}

// ── Head-on and from behind: the deep crouch ─────────────────────────────────

/**
 * Head-on he kneels on the same knee as in profile, the left: its shin trails
 * back under him, so the knee lands a little ahead of his hip — lower on the
 * screen — and the right foot stays planted with its knee up beside the work.
 * A kneeling man's hip is about a thigh's length off the floor, lower than
 * the rig's crouch reaches on its own.
 */
const FACING_KNEEL_CROUCH = 0.91;
const FACING_KNEEL_BOB = 0.155;
const FACING_KNEELING_FOOT: Pt = pt(-0.18, 0);
/** How far behind his hip the kneeling foot lies. */
const FACING_KNEELING_FOOT_DEPTH = -0.14;
/**
 * How much nearer the camera the kneeling shin is drawn than its thigh. Fully
 * near, the knee on the floor swells into a bare disc under the boxers that
 * reads as a second head at the tile.
 */
const FACING_KNEELING_NEARNESS = 0.5;
/** The standing knee opens a little outward over its foot. */
const FACING_STANDING_KNEE_FORESHORTEN = 0.3;

/** The head-on kneel, the same on every frame of the loop so neither foot slides. */
function kneelLegsFacing(pose: CarlPose, standing: CarlPose): void {
  pose.crouch = FACING_KNEEL_CROUCH;
  pose.bob = FACING_KNEEL_BOB;
  pose.leftFoot = FACING_KNEELING_FOOT;
  pose.leftFootDepth = FACING_KNEELING_FOOT_DEPTH;
  pose.leftLegNearness = FACING_KNEELING_NEARNESS;
  pose.leftFootPlanted = false;
  pose.rightFoot = standing.rightFoot;
  pose.rightForeshorten = FACING_STANDING_KNEE_FORESHORTEN;
  pose.rightFootPlanted = true;
}

/**
 * Bent over the board: head-on the only way to show the chest going down to
 * work on the floor is the spine foreshortening toward the camera.
 */
const FACING_WORK_PITCH = 0.9;
const FACING_CHECK_PITCH = 0.3;
/**
 * The free hand braced on the kneeling thigh. Head-on the board lies on the
 * floor ahead of him (`FLOOR_BOARD_AHEAD` in `props/board.ts`), further down
 * the screen than a hand can reach: the hammer's head is what meets it.
 */
const FRONT_BRACE_WRIST: Pt = pt(-0.3, -0.3);
/** The squat the lifts share opens the knees this much: less is wider. */
const FRONT_SQUAT_FORESHORTEN = 0.8;
/**
 * Head-on the hammer arm is driven by its joint angles, because the strike
 * travels toward the camera: the board lies ahead of him, so the elbow is
 * raised in front of his chest (the upper arm drawn short, pointing at the
 * viewer) and the forearm chops down through pointing straight at the viewer,
 * where it can only be drawn short. The fist barely moves across the picture —
 * it rises, shrinks and drops — and the hammer comes down on the same line it
 * went up. Placed by the hand, or swung out sideways from the shoulder, the
 * blow reads as a flap of the elbow or a sideways sweep.
 * `[upper, fore, foreScale, upperScale]`, outward positive.
 */
type ArmKey = readonly [upper: number, fore: number, foreScale: number, upperScale: number];
const FRONT_HAMMER_ARM_BEATS: readonly (readonly [number, ArmKey])[] = [
  [STRIKE_COCK, [0.26, Math.PI - 0.2, 0.6, 0.55]],
  [STRIKE_DRIVE, [0.16, Math.PI - 0.35, 0.22, 0.62]],
  [STRIKE_LAND, [0.12, 0, 1, 0.85]],
  [STRIKE_REBOUND, [0.34, Math.PI - 0.9, 0.5, 0.8]],
];
/**
 * Resting on his raised knee through the check, then coming up ready again.
 * Lowered and raised, the forearm passes through pointing at the camera, so
 * it never sweeps out sideways on its way between the knee and the cock.
 */
const FRONT_HAMMER_ARM_REST: ArmKey = [0.25, 0.2, 1, 1];
const FRONT_HAMMER_ARM_END_ON: ArmKey = [0.2, Math.PI / 2, 0.15, 0.75];
const FRONT_HAMMER_ARM_READY: ArmKey = [0.25, Math.PI - 0.5, 0.6, 0.6];
const FRONT_HAMMER_ARM_KEYS: readonly (readonly [number, ArmKey])[] = [
  ...perStrike(FRONT_HAMMER_ARM_BEATS),
  [CHECK_START, FRONT_HAMMER_ARM_END_ON],
  [CHECK_START + 1, FRONT_HAMMER_ARM_REST],
  [CHECK_START + 3, FRONT_HAMMER_ARM_REST],
  [CHECK_START + 4, FRONT_HAMMER_ARM_END_ON],
  [CHECK_START + 5, FRONT_HAMMER_ARM_READY],
];
function armChannel(slot: 0 | 1 | 2 | 3): Track {
  return loopTrack(
    BUILD_FRAMES,
    FRONT_HAMMER_ARM_KEYS.map(([frame, key]) => [frame, key[slot]]),
  );
}
const FRONT_HAMMER_UPPER = armChannel(0);
const FRONT_HAMMER_FORE = armChannel(1);
const FRONT_HAMMER_FORE_SCALE = armChannel(2);
const FRONT_HAMMER_UPPER_SCALE = armChannel(3);
const FRONT_HAMMER_AIM_BEATS: readonly (readonly [number, number])[] = [
  [STRIKE_COCK, -QUARTER_TURN],
  [STRIKE_DRIVE, QUARTER_TURN - 0.3],
  [STRIKE_LAND, QUARTER_TURN],
  [STRIKE_REBOUND, -QUARTER_TURN + 0.1],
];
/**
 * Carried between the knee and the cock, the hammer hangs from the fist in
 * front of his thigh, head down and a little inboard: swung round through
 * pointing outward it would sweep the silhouette sideways.
 */
const HAMMER_HANGING_INBOARD = QUARTER_TURN + 0.4;
const FRONT_HAMMER_AIM = loopTrack(BUILD_FRAMES, [
  ...perStrike(FRONT_HAMMER_AIM_BEATS),
  [CHECK_START, HAMMER_HANGING_INBOARD],
  [CHECK_START + 1, QUARTER_TURN],
  [CHECK_START + 3, QUARTER_TURN - 0.6],
  [CHECK_START + 4, HAMMER_HANGING_INBOARD],
  [CHECK_START + 5, Math.PI - 0.2],
]);
/** Head-on a head tipped down to the work is the chin dropping; on the check it comes back up. */
const FRONT_WORK_CHIN = -0.7;
const FRONT_CHIN = loopTrack(BUILD_FRAMES, [
  [0, FRONT_WORK_CHIN],
  [CHECK_START - 1, FRONT_WORK_CHIN],
  [CHECK_START + 2, 0.1],
  [CHECK_START + 3, -0.35],
  [CHECK_START + 5, FRONT_WORK_CHIN],
]);
/** Head-on both elbows bow out from the ribs, over knees spread either side of him. */
const FRONT_ELBOWS_OUT = 0.6;
/** Each blow sinks him a touch lower into the squat. */
const FRONT_STRIKE_SINK = 0.015;
const FRONT_SINK = loopTrack(
  BUILD_FRAMES,
  perStrike<number>([
    [STRIKE_COCK, 0],
    [STRIKE_LAND, FRONT_STRIKE_SINK],
  ]),
);

function buildLoopFacing(frame: number, back: boolean): CarlPose {
  const pose = back ? idleBack(0) : idleFront(0);
  kneelLegsFacing(pose, pose);
  pose.bob += trackAt(frame, FRONT_SINK);
  const bentToWork = clamp01(trackAt(frame, FRONT_CHIN) / FRONT_WORK_CHIN);
  pose.torsoPitch = lerp(FACING_CHECK_PITCH, FACING_WORK_PITCH, bentToWork);
  pose.leftArmAngles = null;
  pose.rightArmAngles = null;
  pose.leftHand = FRONT_BRACE_WRIST;
  const hammerArm = {
    upper: trackAt(frame, FRONT_HAMMER_UPPER),
    fore: trackAt(frame, FRONT_HAMMER_FORE),
    foreScale: trackAt(frame, FRONT_HAMMER_FORE_SCALE),
  };
  setArmAngles(pose, 'right', hammerArm, trackAt(frame, FRONT_HAMMER_UPPER_SCALE));
  // Where the angles put the hand, for the kneel and the rise to reach toward.
  pose.rightHand = solvedHands(pose, back ? 'back' : 'front').right;
  pose.elbowFlare = FRONT_ELBOWS_OUT;
  pose.chinLift = trackAt(frame, FRONT_CHIN);
  pose.brow = isCheckFrame(frame) ? CHECK_BROW : CONCENTRATION_BROW;
  pose.blink = frame === CHECK_BLINK_FRAME ? 1 : 0;
  pose.rightFist = 1;
  if (back) {
    pose.leftArmBehind = true;
    pose.rightArmBehind = true;
  }
  const view: CarlView = back ? 'back' : 'front';
  withTools(pose, trackAt(frame, FRONT_HAMMER_AIM), view);
  return pose;
}

export function buildLoop(frame: number, view: CarlView): CarlPose {
  const beat = beatOfFrame(frame);
  if (view === 'side') return buildLoopSide(beat);
  return buildLoopFacing(beat, view === 'back');
}

// ── Getting down and getting up ──────────────────────────────────────────────

function standingPose(view: CarlView): CarlPose {
  if (view === 'side') return idleSide(0);
  return view === 'back' ? idleBack(0) : idleFront(0);
}

/** How high the stepping-back foot clears the floor at the top of its step. */
const KNEEL_STEP_LIFT = 0.08;
/** Through the kneel, the share of it by which the rear foot has planted its toes. */
const KNEEL_TOES_DOWN_BY = 0.5;

/**
 * A pose `t` of the way from standing (0) to the kneeling pose `kneel` (1).
 * The body goes down on an ease; in profile the rear foot steps back in the
 * first half and then only pivots on its planted toes while the knee lowers
 * onto the floor, and head-on it slides back under him as the knee comes down.
 */
function kneelBlend(view: CarlView, kneel: CarlPose, t: number, withGear: boolean): CarlPose {
  const stand = standingPose(view);
  const standHands = solvedHands(stand, view);
  const body = easeInOut(t);
  const pose: CarlPose = { ...kneel };
  pose.crouch = lerp(stand.crouch, kneel.crouch, body);
  pose.bob = lerp(stand.bob, kneel.bob, body);
  pose.sway = lerp(stand.sway, kneel.sway, body);
  pose.lean = lerp(stand.lean, kneel.lean, body);
  pose.headTilt = lerp(stand.headTilt, kneel.headTilt, body);
  pose.chinLift = lerp(stand.chinLift ?? 0, kneel.chinLift ?? 0, body);
  pose.brow = lerp(stand.brow, kneel.brow, body);
  pose.blink = 0;
  pose.elbowFlare = lerp(stand.elbowFlare, kneel.elbowFlare, body);
  pose.leftArmAngles = null;
  pose.rightArmAngles = null;
  pose.leftHand = mixPt(standHands.left, kneel.leftHand, body);
  pose.rightHand = mixPt(standHands.right, kneel.rightHand, body);
  pose.leftForeshorten = lerp(stand.leftForeshorten, kneel.leftForeshorten, body);
  pose.rightForeshorten = lerp(stand.rightForeshorten, kneel.rightForeshorten, body);
  pose.torsoPitch = lerp(stand.torsoPitch ?? 0, kneel.torsoPitch ?? 0, body);
  if (view === 'side') {
    const planted = clamp01(t / KNEEL_TOES_DOWN_BY);
    const pitch = lerp(0, KNEELING_FOOT_PITCH, easeInOut(t));
    if (planted < 1) {
      const from = stand.leftFoot;
      const to = profileFootTarget(ankleOverPivot(KNEEL_REAR_TOE_X, 'toe', pitch), pitch);
      const step = mixPt(from, to, easeInOut(planted));
      pose.leftFoot = pt(step.x, step.y - KNEEL_STEP_LIFT * Math.sin(Math.PI * planted));
    } else {
      pose.leftFoot = profileFootTarget(ankleOverPivot(KNEEL_REAR_TOE_X, 'toe', pitch), pitch);
    }
    pose.leftFootPitch = pitch;
  } else if (t > 0) {
    // The kneeling foot is off the floor's grip from the moment it starts back.
    pose.leftFoot = mixPt(stand.leftFoot, kneel.leftFoot, body);
    pose.leftFootDepth = lerp(0, kneel.leftFootDepth ?? 0, body);
    pose.leftLegNearness = lerp(stand.leftLegNearness, kneel.leftLegNearness, body);
    pose.leftFootPlanted = false;
  } else {
    return stand;
  }
  if (!withGear) {
    pose.heldProps = undefined;
    pose.leftHandShape = undefined;
    pose.rightHandShape = undefined;
    pose.rightFist = stand.rightFist;
    pose.leftFist = stand.leftFist;
  }
  return pose;
}

/**
 * The tools are in his hands only for the lower half of getting down and up:
 * out once he is nearly down, and still in them for the first half of the
 * rise, so they never appear in the hand of a man standing upright.
 */
const GEAR_OUT_FROM = 0.5;

export function buildKneel(frame: number, view: CarlView): CarlPose {
  const t = frame / BUILD_KNEEL_FRAMES;
  return kneelBlend(view, buildLoop(0, view), t, t >= GEAR_OUT_FROM);
}

export function buildRise(frame: number, view: CarlView): CarlPose {
  const t = 1 - (frame + 1) / BUILD_RISE_FRAMES;
  return kneelBlend(view, buildLoop(0, view), t, t >= 1 - GEAR_OUT_FROM);
}

// ── The squat both lifts share ───────────────────────────────────────────────

/**
 * A lifter's squat, `depth` of the way down: the hips go back and down, the
 * back stays straight and hinges forward just enough to keep the chest over
 * the feet, and the feet never move. `depth` 0 is standing.
 */
function squat(view: CarlView, depth: number): CarlPose {
  const pose = standingPose(view);
  pose.crouch = depth;
  if (view === 'side') {
    pose.bob += SQUAT_SIDE_BOB * depth;
    pose.sway = SQUAT_HIPS_BACK * depth;
    pose.lean = SQUAT_BACK_HINGE * depth;
  } else {
    pose.bob += SQUAT_FACING_BOB * depth;
    pose.leftForeshorten = lerp(pose.leftForeshorten, FRONT_SQUAT_FORESHORTEN, depth);
    pose.rightForeshorten = lerp(pose.rightForeshorten, FRONT_SQUAT_FORESHORTEN, depth);
  }
  pose.leftArmAngles = null;
  pose.rightArmAngles = null;
  if (view === 'back') {
    pose.leftArmBehind = true;
    pose.rightArmBehind = true;
  }
  return pose;
}

/** Below the rig's full crouch the squat sinks this much further, in profile and head-on. */
const SQUAT_SIDE_BOB = 0.14;
const SQUAT_FACING_BOB = 0.2;
/**
 * The hips drawn back behind the heels at the bottom, in sway units: without
 * it a squat with a straight back tips him forward off his feet.
 */
const SQUAT_HIPS_BACK = -0.7;
/**
 * The back's forward hinge at the bottom, radians. About forty degrees is a
 * lifter's straight-backed squat; more is a stoop.
 */
const SQUAT_BACK_HINGE = 0.7;

// ── Setting a piece of equipment down ────────────────────────────────────────

/**
 * Carrying the case in, squatting with it, setting it down and standing back
 * up. The barrier appears on the tick the placing timer runs out, which is
 * the first tick of {@link PLACE_RELEASE_FRAME}: the case is in his hands on
 * the floor up to then, and gone from them from then on.
 */
export const PLACE_FRAMES = 14;
export const PLACE_TICKS_PER_FRAME = 6;
/** The case's base touches the floor. */
const PLACE_SET_FRAME = 9;
/** His hands come off it — and the placed equipment takes its place. */
const PLACE_RELEASE_FRAME = 10;
/**
 * Ticks from the start of the placing row to his hands leaving the case: one
 * second. `BarrierSystem` runs its construct for exactly this long, so the
 * equipment stands on the tick the case leaves his hands.
 */
export const PLACE_RELEASE_TICKS = PLACE_RELEASE_FRAME * PLACE_TICKS_PER_FRAME;
const PLACE_LAST = PLACE_FRAMES - 1;

const PLACE_DEPTH: Track = [
  [0, 0],
  [2, 0.25],
  [5, 0.75],
  [7, 0.97],
  [PLACE_SET_FRAME, 1],
  [PLACE_RELEASE_FRAME, 0.96],
  [11, 0.7],
  [12, 0.3],
  [PLACE_LAST, 0.06],
];
/** In profile the case is held against his belly, then carried down and out in front of his toes. */
const PLACE_SIDE_HANDS = pointTrack([
  [0, pt(0.3, -1.08)],
  [2, pt(0.33, -1.0)],
  [5, pt(0.42, -0.66)],
  [7, pt(0.5, -0.4)],
  [8, pt(0.52, -0.29)],
  [PLACE_SET_FRAME, pt(0.52, -0.26)],
  [PLACE_RELEASE_FRAME, pt(0.46, -0.42)],
  [11, pt(0.3, -0.6)],
  [12, pt(0.08, -0.82)],
  [PLACE_LAST, pt(-0.02, -0.9)],
]);
/**
 * Edge-on the case shows only its depth, and at the prop's own size a box that
 * narrow held against his belly reads as something small carried in one hand.
 */
const PLACE_SIDE_CASE_SCALE = 1.3;
/** The far hand holds the case's far side, a touch behind the near one. */
const PLACE_FAR_HAND_BACK = 0.03;
/**
 * Head-on the case hangs between his fists, gripped just outside his hips so
 * its ends stand clear of his body either side, and comes down to hang off
 * straight arms. From behind it is on the far side of him, and those ends are
 * all of it there is to see: gripped at his hips' width it vanishes entirely.
 */
const PLACE_FACING_FIST_X = 0.36;
/**
 * From behind he carries it lower, at his hips rather than his chest: the
 * jacket is the widest thing about him and hides a case held against it,
 * while below the hem the ends show clear either side of the boxers.
 */
const PLACE_BACK_CARRY_Y = -0.8;
const PLACE_BACK_FIST_X = 0.4;
/** The case's face-on width against the prop's own, to span the wider grip. */
const PLACE_FACING_CASE_SCALE = 1.2;
/**
 * Head-on the squat's straight-backed hinge is the chest pitching over his
 * knees toward the case, radians at the bottom — the same forty degrees the
 * profile squat leans.
 */
const PLACE_FACING_PITCH = SQUAT_BACK_HINGE;
const PLACE_FACING_HANDS_Y: Track = [
  [0, -1.1],
  [2, -1.03],
  [5, -0.72],
  [7, -0.46],
  [PLACE_SET_FRAME, -0.4],
  [PLACE_RELEASE_FRAME, -0.56],
  [11, -0.7],
  [12, -0.8],
  [PLACE_LAST, -0.86],
];
/** Watching the case down: the head drops to it through the squat and comes up after. */
const PLACE_LOOK_DOWN: Track = [
  [0, 0.15],
  [5, 0.45],
  [PLACE_SET_FRAME, 0.6],
  [PLACE_RELEASE_FRAME, 0.55],
  [12, 0.2],
  [PLACE_LAST, 0.05],
];
/** Hands still on the case until it is down, then open as they come off it. */
function placeHolding(frame: number): boolean {
  return frame < PLACE_RELEASE_FRAME;
}

export function placeEquipment(frame: number, view: CarlView): CarlPose {
  const depth = trackAt(frame, PLACE_DEPTH);
  const pose = squat(view, depth);
  const look = trackAt(frame, PLACE_LOOK_DOWN);
  const holding = placeHolding(frame);
  const standing = standingPose(view);
  const release = clamp01((frame - PLACE_SET_FRAME) / (PLACE_LAST - PLACE_SET_FRAME));
  if (view === 'side') {
    const hand = atPt(frame, PLACE_SIDE_HANDS);
    pose.rightHand = hand;
    pose.leftHand = pt(hand.x - PLACE_FAR_HAND_BACK, hand.y);
    pose.headTilt = look * SIDE_WORK_HEAD_TILT;
    pose.elbowFlare = SIDE_IDLE.elbowFlare;
  } else {
    const back = view === 'back';
    const trackY = trackAt(frame, PLACE_FACING_HANDS_Y);
    const handY = back && holding ? Math.max(trackY, PLACE_BACK_CARRY_Y) : trackY;
    const hands = solvedHands(standing, view);
    const grip = back ? PLACE_BACK_FIST_X : PLACE_FACING_FIST_X;
    const spread = holding ? grip : lerp(grip, hands.right.x, release);
    pose.leftHand = pt(-spread, handY);
    pose.rightHand = pt(spread, handY);
    pose.chinLift = -look;
    pose.elbowFlare = PLACE_FACING_ELBOW_FLARE;
    pose.torsoPitch = PLACE_FACING_PITCH * depth;
  }
  pose.brow = CONCENTRATION_BROW;
  if (holding) {
    pose.leftHandShape = 'grip';
    pose.rightHandShape = 'grip';
    // Profile: the near fist carries it, over everything; head-on the left
    // one does, so both fists are painted over the case rather than under it.
    pose.heldProps =
      view === 'side'
        ? [{ kind: 'crate', hand: 'right', scale: PLACE_SIDE_CASE_SCALE }]
        : [{ kind: 'crate', hand: 'left', scale: PLACE_FACING_CASE_SCALE }];
  } else {
    pose.leftHandShape = 'open';
    pose.rightHandShape = 'open';
  }
  return pose;
}

/** Elbows held just off the ribs: the arms hang straight from the shoulders under the load. */
const PLACE_FACING_ELBOW_FLARE = 0.3;

// ── Mending with a spanner ───────────────────────────────────────────────────

/**
 * Down onto one knee at the broken thing, two turns of the spanner with the
 * other hand steadying it, and back up. The mend itself is already done when
 * this starts — the repair is instant — so it is played after it, as the
 * reason the thing is whole. It kneels where the lift squats, so the two read
 * apart even before the spanner does.
 */
export const REPAIR_FRAMES = 16;
export const REPAIR_TICKS_PER_FRAME = 5;
const REPAIR_KNEEL_FRAMES = 4;
/**
 * Each turn of the spanner — a pull and a return — takes four frames, the
 * fewest that keep each half of it monotone: fewer, and it reads as a
 * tremble rather than as working a nut.
 */
const REPAIR_TURN_FRAMES = 4;
const REPAIR_TURNS = 2;
const REPAIR_RISE_FROM = REPAIR_KNEEL_FRAMES + REPAIR_TURN_FRAMES * REPAIR_TURNS;
const REPAIR_RISE_FRAMES = REPAIR_FRAMES - REPAIR_RISE_FROM;

/** How far the spanner pulls through a turn, radians about the nut. */
const REPAIR_TURN_SWING = 0.9;
/** The fist rides a small arc as it pulls the spanner round. */
const REPAIR_FIST_ARC = 0.1;
/**
 * Where the nut is: in profile at the height of a bed frame or a table rail
 * just ahead of him; head-on out past the raised right knee, never between
 * his knees, where a working hand reads as nothing of the kind.
 */
const REPAIR_SIDE_WORK: Pt = pt(0.62, -0.5);
const REPAIR_FACING_WORK: Pt = pt(0.46, -0.3);
/**
 * In profile the other hand steadies the work beside the nut. Head-on the
 * work is out past the raised knee and the other hand rests outboard on its
 * own thigh: anything drawn over his lap there reads as a hand at his crotch.
 */
const REPAIR_SIDE_BRACE: Pt = pt(0.5, -0.66);
const REPAIR_FACING_BRACE: Pt = pt(-0.38, -0.4);
/** Bent in to the work, less than over a board on the floor. */
const REPAIR_SIDE_LEAN = 0.5;
const REPAIR_FACING_PITCH = 0.75;
const REPAIR_SIDE_HEAD_TILT = 0.3;
const REPAIR_FACING_CHIN = -0.5;
/**
 * Which way the spanner's jaw points onto the nut before the pull: forward
 * and down in profile, down and out past the knee head-on.
 */
const REPAIR_SPANNER_AIM: Readonly<Record<CarlView, number>> = {
  side: 0.5,
  front: QUARTER_TURN - 0.5,
  back: QUARTER_TURN - 0.5,
};

/** 0 → 1 → 0 over each turn: one pull and its return. */
function turnAt(workFrame: number): number {
  const t = (workFrame % REPAIR_TURN_FRAMES) / REPAIR_TURN_FRAMES;
  return (1 - Math.cos(t * Math.PI * 2)) / 2;
}

/** Kneeling at the work, `turn` of the way through a pull of the spanner. */
function repairAtWork(view: CarlView, turn: number): CarlPose {
  const pose = standingPose(view);
  if (view === 'side') {
    kneelLegsSide(pose);
    pose.lean = REPAIR_SIDE_LEAN;
    pose.headTilt = REPAIR_SIDE_HEAD_TILT;
    pose.elbowFlare = SIDE_IDLE.elbowFlare;
  } else {
    kneelLegsFacing(pose, pose);
    pose.torsoPitch = REPAIR_FACING_PITCH;
    pose.chinLift = REPAIR_FACING_CHIN;
    pose.elbowFlare = FRONT_ELBOWS_OUT;
    if (view === 'back') {
      pose.leftArmBehind = true;
      pose.rightArmBehind = true;
    }
  }
  const work = view === 'side' ? REPAIR_SIDE_WORK : REPAIR_FACING_WORK;
  pose.leftArmAngles = null;
  pose.rightArmAngles = null;
  pose.rightHand = pt(work.x - turn * REPAIR_FIST_ARC, work.y - turn * REPAIR_FIST_ARC);
  pose.leftHand = view === 'side' ? REPAIR_SIDE_BRACE : REPAIR_FACING_BRACE;
  pose.leftHandShape = 'open';
  pose.rightHandShape = 'grip';
  pose.brow = CONCENTRATION_BROW;
  const aim = REPAIR_SPANNER_AIM[view] - turn * REPAIR_TURN_SWING;
  pose.heldProps = [{ kind: 'wrench', hand: 'right', angle: aimedAngle(pose, view, 'right', aim) }];
  return pose;
}

export function repairMend(frame: number, view: CarlView): CarlPose {
  if (frame < REPAIR_KNEEL_FRAMES) {
    const t = frame / REPAIR_KNEEL_FRAMES;
    return kneelBlend(view, repairAtWork(view, 0), t, t >= GEAR_OUT_FROM);
  }
  if (frame >= REPAIR_RISE_FROM) {
    const t = 1 - (frame - REPAIR_RISE_FROM + 1) / REPAIR_RISE_FRAMES;
    return kneelBlend(view, repairAtWork(view, 0), t, t >= 1 - GEAR_OUT_FROM);
  }
  return repairAtWork(view, turnAt(frame - REPAIR_KNEEL_FRAMES));
}
