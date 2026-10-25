/**
 * Taking a weapon out of where it rests, and putting it back: a light
 * one-hander drawn across his body from his left hip, a heavy one-hander or
 * a two-hander drawn up over his right shoulder from across his back.
 *
 * A draw starts on the bare-handed idle's first frame and ends on the armed
 * set's own; a stow is the draw played backwards. While his hand is on its
 * way the weapon is still at rest; from the frame his fist closes on it
 * where it rests, it is in his hand — on the same place, along the same
 * axis, so nothing jumps.
 */

import { pt } from '../biped/geometry';
import { handGrip } from '../biped/limbs';
import { buildSkeleton, type BipedPose, HAFT_IN_PLANE, VIEWS } from '../biped/rig';
import { deg, easeInOut, lerp, type Pt } from '../bipedArt';
import type { CardinalView } from '../../facingView';
import { armOf, CARRY_HOLDS, type FistPlace, setArm, withHold } from './armedHold';
import { KNUCKLES_TO_CAMERA, towards } from './handTurn';
import { idleBack, idleFront, idleSide } from './idles';
import { type ArmedMotionSet, type HolsterMotion, stowedPlacementOfSet } from './motionSets';
import { type ShownPlacement, stowedCentreAuthored, stowedHaftAngle } from './stowedGeometry';

/** Frames in every draw and stow: reach, grip, pull, swing out and settle. */
export const HOLSTER_FRAMES = 6;
/** A draw takes about a third of a second, the time a practised hand takes. */
export const HOLSTER_TICKS_PER_FRAME = 4;

const REACH_FRAME = 1;
const GRIP_FRAME = 2;
const PULL_FRAME = 3;
const SWING_FRAME = 4;
const LAST_FRAME = HOLSTER_FRAMES - 1;

function standing(view: CardinalView): BipedPose {
  if (view === 'side') return idleSide(0);
  return view === 'back' ? idleBack(0) : idleFront(0);
}

/** Passes of the grip correction: each moves the wrist by its grip's remaining error. */
const GRIP_SOLVE_PASSES = 3;

/** Puts his right fist's grip on `target` (figure space as authored), by its wrist. */
function rightGripOn(pose: BipedPose, view: CardinalView, target: Pt): void {
  pose.rightArmAngles = null;
  pose.rightHand = target;
  for (let pass = 0; pass < GRIP_SOLVE_PASSES; pass++) {
    const grip = handGrip(buildSkeleton(pose, VIEWS[view]).rightArm).centre;
    pose.rightHand = pt(pose.rightHand.x + target.x - grip.x, pose.rightHand.y + target.y - grip.y);
  }
}

/** The fist's place on the frames after the grip, per placement and view, as offsets from his right shoulder. */
interface PullKeys {
  readonly pull: FistPlace;
  readonly pullHaft: number;
  readonly swing: FistPlace;
  readonly swingHaft: number;
}

/**
 * Out of the hip: the hilt pulled up across his belly to his chest, the
 * point coming out behind him, then swung round and down into the carry.
 */
const HIP_PULL: Readonly<Record<CardinalView, PullKeys>> = {
  side: {
    pull: { wrist: pt(0.08, 0.26), bend: 'down' },
    pullHaft: deg(-150),
    swing: { wrist: pt(0.24, 0.4), bend: 'down' },
    swingHaft: deg(-30),
  },
  front: {
    pull: { wrist: pt(-0.04, 0.3), upperScale: 0.75, bend: 'down' },
    pullHaft: deg(-170),
    swing: { wrist: pt(0.1, 0.46), bend: 'up' },
    swingHaft: deg(6),
  },
  back: {
    pull: { wrist: pt(-0.04, 0.3), upperScale: 0.75, bend: 'down' },
    pullHaft: deg(-170),
    swing: { wrist: pt(0.1, 0.46), bend: 'up' },
    swingHaft: deg(6),
  },
};

/**
 * Off the back: the handle pulled up over his right shoulder, the head
 * coming up behind it, then brought over and down in front.
 */
const BACK_PULL: Readonly<Record<CardinalView, PullKeys>> = {
  side: {
    pull: { wrist: pt(0.06, -0.24), bend: 'down' },
    pullHaft: deg(-200),
    swing: { wrist: pt(0.14, 0.04), bend: 'down' },
    swingHaft: deg(-175),
  },
  front: {
    pull: { wrist: pt(0.1, -0.24), bend: 'up' },
    pullHaft: deg(-80),
    swing: { wrist: pt(0.1, -0.02), upperScale: 0.8, bend: 'up' },
    swingHaft: deg(-84),
  },
  back: {
    pull: { wrist: pt(0.1, -0.24), bend: 'up' },
    pullHaft: deg(-80),
    swing: { wrist: pt(0.1, -0.02), upperScale: 0.8, bend: 'up' },
    swingHaft: deg(-84),
  },
};

const PULLS: Readonly<Record<ShownPlacement, Readonly<Record<CardinalView, PullKeys>>>> = {
  hip: HIP_PULL,
  back: BACK_PULL,
};

/**
 * A two-hander's long haft, pulled up over his shoulder edge-on, would lie
 * across his face: it comes off his back low instead, swung down and forward
 * past his hip into both hands.
 */
const TWO_HAND_SIDE_PULL: PullKeys = {
  pull: { wrist: pt(0.04, 0.04), bend: 'down' },
  pullHaft: deg(160),
  swing: { wrist: pt(0.22, 0.3), bend: 'down' },
  swingHaft: deg(-60),
};

function pullKeys(set: ArmedMotionSet, placement: ShownPlacement, view: CardinalView): PullKeys {
  return set === 'twoHand' && view === 'side' ? TWO_HAND_SIDE_PULL : PULLS[placement][view];
}

/** How far toward the stowed place his hand has come on the reach frame. */
const REACH_SHARE = 0.6;
/**
 * The shoulders turn into a draw: toward his left hip for a cross-draw,
 * back over the right shoulder for a draw off his back.
 */
const DRAW_TWIST: Readonly<Record<ShownPlacement, number>> = { hip: 0.35, back: -0.25 };
const DRAW_TWIST_BY_FRAME: readonly number[] = [0, 0.7, 1, 0.7, 0.3, 0];
/** The wrist turned so the knuckles face the camera as the hand closes on the grip. */
const HOLSTER_PALM = KNUCKLES_TO_CAMERA;
/** Head-on the palm faces in toward him as it reaches across. */
const FACING_HOLSTER_PALM = towards(0.3, 0, -0.95);

/** One frame of `set`'s draw in `view`. A weapon stowed out of sight comes out of nowhere. */
export function armedDraw(set: ArmedMotionSet, view: CardinalView, frame: number): BipedPose {
  if (frame >= LAST_FRAME) return withHold(standing(view), view, CARRY_HOLDS[set][view], 0);
  const placement = stowedPlacementOfSet(set);
  if (placement === 'none') return { ...standing(view) };
  const pose = { ...standing(view) };
  pose.twist += DRAW_TWIST[placement] * (DRAW_TWIST_BY_FRAME[frame] ?? 0);
  if (frame <= 0) return pose;
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const rest = skeleton.rightArm.end;
  const place = stowedCentreAuthored(placement, view, skeleton);
  if (frame === REACH_FRAME) {
    rightGripOn(
      pose,
      view,
      pt(lerp(rest.x, place.x, REACH_SHARE), lerp(rest.y, place.y, REACH_SHARE)),
    );
    pose.rightHandShape = 'open';
    return pose;
  }
  const palm = view === 'side' ? HOLSTER_PALM : FACING_HOLSTER_PALM;
  if (frame === GRIP_FRAME) {
    rightGripOn(pose, view, place);
    pose.rightHandShape = 'grip';
    pose.rightFist = 1;
    pose.rightHandOrientation = {
      palmNormal: palm,
      haftDepth: HAFT_IN_PLANE,
      haftAngle: stowedHaftAngle(placement, view),
    };
    return pose;
  }
  const keys = pullKeys(set, placement, view);
  const fist = frame === PULL_FRAME ? keys.pull : keys.swing;
  const haft = frame === PULL_FRAME ? keys.pullHaft : keys.swingHaft;
  const held = withHold(
    pose,
    view,
    { kind: 'oneHand', fist, haftAngle: haft, palm, haftDepth: HAFT_IN_PLANE },
    0,
  );
  if (set === 'twoHand' && frame === SWING_FRAME) return joinFreeHand(held, view);
  return held;
}

/**
 * The free hand comes up to meet the haft as a two-hander swings down off
 * the shoulder: half-way from its hang to where the carry closes it.
 */
function joinFreeHand(pose: BipedPose, view: CardinalView): BipedPose {
  const carried = withHold(standing(view), view, CARRY_HOLDS.twoHand[view], 0);
  const from = armOf(pose, view, 'left');
  const to = armOf(carried, view, 'left');
  const halfway = easeInOut(HALF);
  setArm(
    pose,
    view,
    'left',
    {
      upper: lerp(from.angles.upper, to.angles.upper, halfway),
      fore: lerp(from.angles.fore, to.angles.fore, halfway),
      foreScale: lerp(from.angles.foreScale, to.angles.foreScale, halfway),
    },
    lerp(from.upperScale, to.upperScale, halfway),
  );
  return pose;
}

const HALF = 0.5;

/** One frame of `set`'s stow: its draw played backwards. */
export function armedStow(set: ArmedMotionSet, view: CardinalView, frame: number): BipedPose {
  return armedDraw(set, view, LAST_FRAME - frame);
}

/** One frame of a draw or a stow. */
export function armedHolster(
  set: ArmedMotionSet,
  motion: HolsterMotion,
  view: CardinalView,
  frame: number,
): BipedPose {
  return motion === 'draw' ? armedDraw(set, view, frame) : armedStow(set, view, frame);
}
