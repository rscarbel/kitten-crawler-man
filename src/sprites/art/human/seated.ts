/**
 * A patron on a bar stool, on the human rig: the seated rest, a breath, a
 * reach forward to a lever or a table, a cheer and a slump.
 *
 * The hips are lifted onto the seat by `bob` alone, never by `crouch`, which
 * would fold the knees under a standing pelvis. The thighs run level off the
 * seat and the shins hang straight down: head-on the thigh is depth toward
 * the camera (`leftFootDepth`), drawn short by `seatedDepthShare`, and
 * edge-on distance ahead of the hips. The club's stools stand taller than the
 * rig's inseam, so the feet hang above the foot ring rather than on it.
 */

import {
  ANKLE_Y,
  FACING_SHOULDER_SPREAD,
  HIP_Y,
  SHIN_LENGTH,
  SHOULDER_Y,
  THIGH_LENGTH,
} from '../biped/proportions';
import { type BipedPose, restingPose, setArmAngles } from '../biped/rig';
import { pt } from '../biped/geometry';
import { lerp, type Pt } from '../bipedArt';
import type { CardinalView } from '../../facingView';
import { SEAT_POSE_FRAMES, seatIdlePhase, seatPoseWeight, type SeatPose } from '../seatPoses';

/**
 * How far below the hip joint the lap ends head-on, rig units: anything worn
 * that hangs from the waist — an apron, a tabard — is cut off where the
 * thighs leave the body rather than falling to where a standing knee was.
 */
export const SEATED_LAP_BELOW_HIP = 0.02;
/** Hip joint above the seat it rests on, rig units: the depth of the buttock under it. */
const HIP_ABOVE_SEAT = 0.03;
/** Shoulders above the hips, rig units, standing or sitting. */
const SHOULDERS_ABOVE_HIP = Math.abs(SHOULDER_Y - HIP_Y);

/** The breath: the chest rises and settles once a loop. */
const BREATH_CHEST_RISE = 0.012;

/**
 * The seated leg: the thigh level, forward off the seat, the shin straight
 * down from a square knee. Each bone is asked for a hair under its length so
 * the knee keeps its corner instead of locking straight.
 */
const SQUARE_KNEE_REACH = 0.97;
const KNEE_AHEAD = THIGH_LENGTH * SQUARE_KNEE_REACH;
const ANKLE_BELOW_HIP = SHIN_LENGTH * SQUARE_KNEE_REACH;
/** Head-on, a seated thigh's length toward the camera drawn as this share of screen height. */
const SEATED_DEPTH_SHARE = 0.3;
/** Head-on and from behind, the knees sit hip width apart. */
const FACING_FOOT_SPREAD = 0.12;
/** Head-on the thigh points at the camera: short and wide. */
const FACING_THIGH_NEARNESS = 0.85;
/**
 * Edge-on the foot sits back under the seat from the knee, so the shin slants
 * back toward the stool a little off plumb, the way a perched sitter's does.
 */
const SIDE_FOOT_SHARE_OF_KNEE = 0.6;
/** Edge-on the far leg sits a little behind the near one. */
const SIDE_FAR_KNEE_SHARE = 0.9;
/** The toes dropped a little off level, radians. */
const SIDE_FOOT_PITCH = 0.25;
/** Edge-on a knee breaking +1 bends forward, the only way a knee hinges. */
const SEATED_KNEE_BREAK = 1;

/** Hands resting on the thighs, below the hips' height and just ahead of them. */
const LAP_HAND_DROP = 0.04;
const FACING_LAP_HAND_SPREAD = 0.17;
const SIDE_LAP_HAND_AHEAD = 0.24;
const SIDE_FAR_LAP_HAND_AHEAD = 0.1;
const LAP_FIST = 0.3;
/**
 * From behind his hands are in his lap, in front of him and out of sight:
 * only the upper arms show, hanging at his sides past the flanks.
 */
const BACK_LAP_HAND_SPREAD = 0.2;
/** From behind and edge-on the coat's hem rests on the seat, this far below the hip joint. */
const SEAT_HEM_BELOW_HIP = 0.04;
/** Head-on the hands rest ahead of the chest on the lap, which only orders the paint. */
const LAP_HAND_DEPTH = 0.2;

/**
 * The reach, edge-on: the right hand comes up in front of him to above his
 * shoulder, then pulls down in an arc to his waist — a lever pulled, a
 * button pressed, chips pushed in.
 */
const SIDE_PLAY_REACH_AHEAD = 0.36;
const SIDE_PLAY_REACH_ABOVE_SHOULDER = 0.12;
/** The pull ends at his waist, this far above the hip joint. */
const SIDE_PLAY_PULL_ABOVE_HIP = 0.15;
const PLAY_LEAN = 0.08;
/**
 * Head-on the reach is toward the camera, so it is posed by joint angles the
 * way a hammer blow at the camera is: the forearm stands up in front of his
 * chest, drawn short because it points along the line of sight, then chops
 * down to the lap — a vertical stroke that never sweeps sideways. Each key is
 * the upper arm's angle out from hanging, the forearm's angle from hanging
 * (negative swings it in across his front), and the share of the forearm
 * and upper arm drawn.
 */
const FRONT_PLAY_LAP: FrontArmKey = { upper: 0.1, fore: -0.3, foreScale: 0.55, upperScale: 1 };
/**
 * Halfway up, the forearm points straight at the camera and is drawn short,
 * so between hanging and standing up it never lies across the belly.
 */
const FRONT_PLAY_END_ON: FrontArmKey = {
  upper: 0.22,
  fore: -Math.PI / 2,
  foreScale: 0.12,
  upperScale: 0.75,
};
const FRONT_PLAY_PEAK: FrontArmKey = {
  upper: 0.12,
  fore: -(Math.PI - 0.6),
  foreScale: 0.5,
  upperScale: 0.6,
};
/** Where along the stroke the forearm passes end-on. */
const FRONT_PLAY_END_ON_AT = 0.5;
const FRONT_PLAY_HAND_DEPTH = 0.6;
/**
 * From behind the hand stays in front of him, hidden by the body, so the
 * reach is told by the elbow poking out past his flank and pumping with the
 * pull, and the head dipping to the machine.
 */
const BACK_PLAY_HAND_X = 0.18;
const BACK_PLAY_PEAK_BELOW_SHOULDER = 0.25;
const BACK_PLAY_PULL_DROP = 0.11;
const BACK_PLAY_ELBOW_FLARE = 1;
const BACK_PLAY_HAND_DEPTH = 0.4;
const BACK_PLAY_CHIN_TUCK = -0.35;
const PLAY_FIST = 0.85;
/** Share of the play row the pull starts at, once the hand has arrived. */
const PLAY_PULL_START = 0.35;

/**
 * The cheer: both arms up overhead in a V, the head back, the mouth open. On
 * the way up the hands pass out wide at shoulder height with the elbows bent,
 * so the arms never cross in front of the face. Edge-on they swing up through
 * the front and finish straight up, the near fist just behind the head line
 * and the far one just ahead of it, both above the head with the face clear.
 */
const CHEER_HAND_SPREAD = 0.42;
const CHEER_HAND_ABOVE_SHOULDER = 0.6;
const CHEER_WIND_UP_SPREAD = 0.36;
const CHEER_WIND_UP_ABOVE_SHOULDER = 0.05;
/** Share of the rise spent reaching the wind-up. */
const CHEER_WIND_UP_SHARE = 0.5;
const SIDE_CHEER_HAND_AHEAD = -0.15;
const SIDE_FAR_CHEER_HAND_AHEAD = 0.02;
const SIDE_CHEER_WIND_UP_AHEAD = 0.36;
const SIDE_CHEER_WIND_UP_BELOW_SHOULDER = 0.1;
const CHEER_CHIN_LIFT = 0.45;
const CHEER_MOUTH = 0.9;
const CHEER_FIST = 0.9;
/** He bounces on the seat twice through the hold. */
const CHEER_BOUNCE = 0.03;
const CHEER_BOUNCES = 2;

/**
 * The slump: he folds forward over his lap, the shoulders rounding in, the
 * head hung so its crown shows, the hands dropped between the knees. The
 * spine keeps its length and the hips stay on the seat: the fold is pitch,
 * never a squash. Edge-on the bend is in the spine, not at the hip, so the
 * coat's skirt stays on the seat.
 */
const SLUMP_PITCH = 0.35;
/** From behind the fold drops the head forward, still mostly in sight over level shoulders. */
const BACK_SLUMP_PITCH = 0.35;
/** Edge-on the back rounds and the shoulders come down, the head hung to face the lap. */
const SLUMP_SPINE_BEND = 0.2;
const SIDE_SLUMP_SHOULDER_DROP = 0.09;
const SIDE_SLUMP_HEAD_PITCH = 0.45;
const SLUMP_CHIN_TUCK = -1;
const SLUMP_HEAD_TILT = 0.12;
const SLUMP_BROW = 0.4;
const SLUMP_HAND_DROP = 0.14;
const SLUMP_HAND_X = 0.04;
const SLUMP_SHOULDER_SPREAD = 1.12;

const RIGHT = 1;
const LEFT = -1;

/**
 * Lifts a resting pose onto a seat `seatHeight` rig units off the floor and
 * hangs its legs from it.
 */
function seatBody(view: CardinalView, seatHeight: number): BipedPose {
  const pose = restingPose();
  const hipHeight = seatHeight + HIP_ABOVE_SEAT;
  pose.bob = Math.abs(HIP_Y) - hipHeight;
  // On a seat lower than the shin is long, such as a street bench, the feet
  // rest on the ground and the knees rise, rather than the soles sinking
  // through the floor.
  const footLift = Math.max(0, hipHeight - ANKLE_BELOW_HIP - Math.abs(ANKLE_Y));
  pose.leftKneeBreak = SEATED_KNEE_BREAK;
  pose.rightKneeBreak = SEATED_KNEE_BREAK;
  pose.leftFootPlanted = false;
  pose.rightFootPlanted = false;
  if (view === 'side') {
    pose.seatedHemDrape = 1;
    pose.seatedHemFloor = HIP_Y + pose.bob + SEAT_HEM_BELOW_HIP;
    const footAhead = KNEE_AHEAD * SIDE_FOOT_SHARE_OF_KNEE;
    pose.rightFoot = pt(footAhead, -footLift);
    pose.leftFoot = pt(footAhead * SIDE_FAR_KNEE_SHARE, -footLift);
    pose.rightFootPitch = SIDE_FOOT_PITCH;
    pose.leftFootPitch = SIDE_FOOT_PITCH;
    return pose;
  }
  pose.seatedDepthShare = SEATED_DEPTH_SHARE;
  pose.leftFoot = pt(-FACING_FOOT_SPREAD, -footLift);
  pose.rightFoot = pt(FACING_FOOT_SPREAD, -footLift);
  pose.leftFootDepth = KNEE_AHEAD;
  pose.rightFootDepth = KNEE_AHEAD;
  // From behind the thighs run away from the camera under the seat, and the
  // coat stops at the seat so the cushion shows either side of him.
  const fromBehind = view === 'back';
  const thighNearness = fromBehind ? 0 : FACING_THIGH_NEARNESS;
  pose.leftLegNearness = thighNearness;
  pose.rightLegNearness = thighNearness;
  const hipLine = HIP_Y + pose.bob;
  pose.seatedHemFloor = fromBehind
    ? hipLine + SEAT_HEM_BELOW_HIP
    : hipLine + KNEE_AHEAD * SEATED_DEPTH_SHARE;
  pose.leftArmBehind = fromBehind;
  pose.rightArmBehind = fromBehind;
  return pose;
}

function hipY(pose: BipedPose): number {
  return HIP_Y + pose.bob;
}

function shoulderY(pose: BipedPose): number {
  return hipY(pose) - SHOULDERS_ABOVE_HIP;
}

function lapHand(view: CardinalView, pose: BipedPose, side: number): Pt {
  const y = hipY(pose) + LAP_HAND_DROP;
  if (view === 'side') {
    return pt(side === RIGHT ? SIDE_LAP_HAND_AHEAD : SIDE_FAR_LAP_HAND_AHEAD, y);
  }
  if (view === 'back') return pt(side * BACK_LAP_HAND_SPREAD, y);
  return pt(side * FACING_LAP_HAND_SPREAD, y);
}

/** Both hands in the lap, arms solved from them. */
function restHands(pose: BipedPose, view: CardinalView): void {
  pose.leftArmAngles = null;
  pose.rightArmAngles = null;
  pose.leftHand = lapHand(view, pose, LEFT);
  pose.rightHand = lapHand(view, pose, RIGHT);
  pose.leftFist = LAP_FIST;
  pose.rightFist = LAP_FIST;
  if (view === 'front') {
    pose.leftHandDepth = LAP_HAND_DEPTH;
    pose.rightHandDepth = LAP_HAND_DEPTH;
  }
}

function seatedRest(view: CardinalView, seatHeight: number): BipedPose {
  const pose = seatBody(view, seatHeight);
  restHands(pose, view);
  return pose;
}

function idle(view: CardinalView, seatHeight: number, frame: number): BipedPose {
  const pose = seatedRest(view, seatHeight);
  const breath = (1 - Math.cos(seatIdlePhase(frame) * Math.PI * 2)) / 2;
  pose.chestRise = BREATH_CHEST_RISE * breath;
  return pose;
}

interface FrontArmKey {
  readonly upper: number;
  readonly fore: number;
  readonly foreScale: number;
  readonly upperScale: number;
}

function mixArmKey(from: FrontArmKey, to: FrontArmKey, t: number): FrontArmKey {
  return {
    upper: lerp(from.upper, to.upper, t),
    fore: lerp(from.fore, to.fore, t),
    foreScale: lerp(from.foreScale, to.foreScale, t),
    upperScale: lerp(from.upperScale, to.upperScale, t),
  };
}

/** The arm `stroke` of the way from the lap (0) to standing up in front of the chest (1). */
function frontPlayKey(stroke: number): FrontArmKey {
  if (stroke < FRONT_PLAY_END_ON_AT) {
    return mixArmKey(FRONT_PLAY_LAP, FRONT_PLAY_END_ON, stroke / FRONT_PLAY_END_ON_AT);
  }
  const rest = (stroke - FRONT_PLAY_END_ON_AT) / (1 - FRONT_PLAY_END_ON_AT);
  return mixArmKey(FRONT_PLAY_END_ON, FRONT_PLAY_PEAK, rest);
}

function play(view: CardinalView, seatHeight: number, frame: number): BipedPose {
  const pose = seatedRest(view, seatHeight);
  const weight = seatPoseWeight('play', frame);
  const t = frame / SEAT_POSE_FRAMES.play;
  const pull = Math.max(0, Math.min(1, (t - PLAY_PULL_START) / PLAY_PULL_START));
  const lap = lapHand(view, pose, RIGHT);
  let reach: Pt;
  if (view === 'side') {
    const peak = shoulderY(pose) - SIDE_PLAY_REACH_ABOVE_SHOULDER;
    const waist = hipY(pose) - SIDE_PLAY_PULL_ABOVE_HIP;
    reach = pt(SIDE_PLAY_REACH_AHEAD, lerp(peak, waist, pull));
    pose.lean = PLAY_LEAN * weight;
  } else if (view === 'front') {
    reach = lap;
    if (weight > 0) {
      // Up the stroke on the reach, back down it on the pull.
      const key = frontPlayKey(weight * (1 - pull));
      setArmAngles(
        pose,
        'right',
        { upper: key.upper, fore: key.fore, foreScale: key.foreScale },
        key.upperScale,
      );
      pose.rightHandDepth = lerp(LAP_HAND_DEPTH, FRONT_PLAY_HAND_DEPTH, weight);
    }
  } else {
    const peak = shoulderY(pose) + BACK_PLAY_PEAK_BELOW_SHOULDER;
    reach = pt(BACK_PLAY_HAND_X, peak + BACK_PLAY_PULL_DROP * pull);
    pose.rightHandDepth = lerp(pose.rightHandDepth ?? 0, BACK_PLAY_HAND_DEPTH, weight);
    // The elbow swings out on the reach and back in on the pull.
    pose.elbowFlare = lerp(pose.elbowFlare, BACK_PLAY_ELBOW_FLARE, weight * (1 - pull));
    pose.chinLift = BACK_PLAY_CHIN_TUCK * weight;
  }
  pose.rightHand = pt(lerp(lap.x, reach.x, weight), lerp(lap.y, reach.y, weight));
  pose.rightFist = lerp(LAP_FIST, PLAY_FIST, weight);
  return pose;
}

/** Where a cheering hand is on its way up: out to the wind-up, then on overhead. */
function cheerHand(view: CardinalView, pose: BipedPose, side: number, weight: number): Pt {
  const lap = lapHand(view, pose, side);
  const shoulder = shoulderY(pose);
  const windUp =
    view === 'side'
      ? pt(SIDE_CHEER_WIND_UP_AHEAD, shoulder + SIDE_CHEER_WIND_UP_BELOW_SHOULDER)
      : pt(side * CHEER_WIND_UP_SPREAD, shoulder - CHEER_WIND_UP_ABOVE_SHOULDER);
  const top = shoulder - CHEER_HAND_ABOVE_SHOULDER;
  const up =
    view === 'side'
      ? pt(side === RIGHT ? SIDE_CHEER_HAND_AHEAD : SIDE_FAR_CHEER_HAND_AHEAD, top)
      : pt(side * CHEER_HAND_SPREAD, top);
  if (weight < CHEER_WIND_UP_SHARE) {
    const t = weight / CHEER_WIND_UP_SHARE;
    return pt(lerp(lap.x, windUp.x, t), lerp(lap.y, windUp.y, t));
  }
  const t = (weight - CHEER_WIND_UP_SHARE) / (1 - CHEER_WIND_UP_SHARE);
  return pt(lerp(windUp.x, up.x, t), lerp(windUp.y, up.y, t));
}

function cheer(view: CardinalView, seatHeight: number, frame: number): BipedPose {
  const pose = seatedRest(view, seatHeight);
  const weight = seatPoseWeight('cheer', frame);
  const t = frame / SEAT_POSE_FRAMES.cheer;
  pose.leftHand = cheerHand(view, pose, LEFT, weight);
  pose.rightHand = cheerHand(view, pose, RIGHT, weight);
  pose.leftFist = lerp(LAP_FIST, CHEER_FIST, weight);
  pose.rightFist = pose.leftFist;
  if (view !== 'side') {
    // Overhead the arms are beside the head, not in front of the chest.
    pose.leftHandDepth = lerp(pose.leftHandDepth ?? 0, 0, weight);
    pose.rightHandDepth = pose.leftHandDepth;
    // From behind the hands come out from in front of him as they rise.
    const handsInFront = view === 'back' && weight < CHEER_WIND_UP_SHARE;
    pose.leftArmBehind = handsInFront;
    pose.rightArmBehind = handsInFront;
  }
  pose.chinLift = CHEER_CHIN_LIFT * weight;
  pose.mouth = CHEER_MOUTH * weight;
  pose.bob -= CHEER_BOUNCE * weight * Math.abs(Math.sin(t * Math.PI * CHEER_BOUNCES));
  return pose;
}

function slump(view: CardinalView, seatHeight: number, frame: number): BipedPose {
  const pose = seatedRest(view, seatHeight);
  const weight = seatPoseWeight('slump', frame);
  if (view === 'side') {
    pose.spineBend = SLUMP_SPINE_BEND * weight;
    pose.chestRise = -SIDE_SLUMP_SHOULDER_DROP * weight;
  } else {
    pose.torsoPitch = (view === 'back' ? BACK_SLUMP_PITCH : SLUMP_PITCH) * weight;
  }
  if (view === 'front') {
    pose.shoulderSpread = lerp(
      pose.shoulderSpread ?? FACING_SHOULDER_SPREAD,
      SLUMP_SHOULDER_SPREAD,
      weight,
    );
  }
  pose.chinLift = SLUMP_CHIN_TUCK * weight;
  pose.headTilt = (view === 'side' ? SIDE_SLUMP_HEAD_PITCH : SLUMP_HEAD_TILT) * weight;
  pose.brow = lerp(pose.brow, SLUMP_BROW, weight);
  const handDrop = SLUMP_HAND_DROP * weight;
  if (view === 'side') {
    pose.leftHand = pt(pose.leftHand.x, pose.leftHand.y + handDrop);
    pose.rightHand = pt(pose.rightHand.x, pose.rightHand.y + handDrop);
  } else if (view === 'front') {
    pose.leftHand = pt(lerp(pose.leftHand.x, -SLUMP_HAND_X, weight), pose.leftHand.y + handDrop);
    pose.rightHand = pt(lerp(pose.rightHand.x, SLUMP_HAND_X, weight), pose.rightHand.y + handDrop);
  }
  return pose;
}

const SEATED_POSES: Readonly<
  Record<SeatPose, (view: CardinalView, seatHeight: number, frame: number) => BipedPose>
> = { idle, play, cheer, slump };

/** One frame of a seated pose in a view, on a seat `seatHeight` rig units off the floor. */
export function seatedPose(
  seatPose: SeatPose,
  view: CardinalView,
  seatHeight: number,
  frame: number,
): BipedPose {
  return SEATED_POSES[seatPose](view, seatHeight, frame);
}
