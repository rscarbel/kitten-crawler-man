/**
 * The block: a shot glancing off the shield on his off hand. The rows start
 * from the guard's stance, the shot being what puts him on guard, with the
 * off fist pushed down and out to put the shield square between him and the
 * shot across his chest, take the knock on the second frame — the shield arm
 * driven back and his shoulders rocked away from it — and hold the
 * shield there until the row hands him back.
 *
 * The rows close nothing in his off hand of their own: on a figure carrying a
 * shield, the off-hand dresser closes the fist round it and turns it to face
 * the shot (`offHand.ts`). On a figure carrying none they read as a raised
 * forearm warding off a blow.
 */

import { pt } from '../biped/geometry';
import type { BipedPose } from '../biped/rig';
import { deg, type Pt } from '../bipedArt';
import type { CardinalView } from '../../facingView';
import type { HumanRowDef } from '../humanFigure';
import { guardBack, guardFront, guardSide } from './idles';

const BLOCK_FRAMES = 6;
const BLOCK_TICKS_PER_FRAME = 3;
const NO_IMPACT: readonly number[] = [];

/**
 * How far the shield arm is out, 0 at the guard and 1 squarely blocking,
 * frame by frame: out already as the shot arrives and held to the end. Eased
 * back toward the guard, the fist rises to his chin and the lid above it
 * crosses his face.
 */
const BLOCK_REACH: readonly number[] = [0.85, 1, 1, 1, 1, 0.95];
/** The knock: all of it on the frame the shot strikes, gone two frames later. */
const BLOCK_KNOCK: readonly number[] = [0, 1, 0.45, 0.15, 0, 0];

/**
 * Head-on: the guard's off fist comes in toward his centre line and down to
 * his chest, so the shield covers his body rather than his chin.
 */
const BLOCK_FRONT_FIST_SHIFT: Pt = pt(0.1, 0.3);
/**
 * From behind, the off fist goes out past his ribs at chest height rather
 * than in, so the shield shows beside his arm instead of under his back.
 */
const BLOCK_BACK_FIST_SHIFT: Pt = pt(-0.12, 0.04);
/** In profile the lead fist drops from his eye line to his chest, a little further out. */
const BLOCK_SIDE_FIST_SHIFT: Pt = pt(0.05, 0.22);
/** The knock pushes the shield fist back toward him by this much at its height. */
const BLOCK_KNOCK_PUSH = 0.07;
/** And rocks his shoulders away from the shot. */
const BLOCK_KNOCK_LEAN = deg(7);
/** Head-on a rock away from the camera shows as a little sink. */
const BLOCK_KNOCK_SINK = 0.02;
/** He squints into the knock. */
const BLOCK_KNOCK_BLINK = 0.6;

function shareAt(track: readonly number[], frame: number): number {
  return track[Math.min(frame, track.length - 1)] ?? 0;
}

/** The off fist shifted by `reach` of `shift`, and pushed back toward him by the knock. */
function shieldFist(guardFist: Pt, shift: Pt, reach: number, push: Pt): Pt {
  return pt(guardFist.x + shift.x * reach + push.x, guardFist.y + shift.y * reach + push.y);
}

function blockFront(frame: number): BipedPose {
  const pose = guardFront(0);
  const reach = shareAt(BLOCK_REACH, frame);
  const knock = shareAt(BLOCK_KNOCK, frame);
  pose.leftHand = shieldFist(pose.leftHand, BLOCK_FRONT_FIST_SHIFT, reach, pt(0, 0));
  pose.bob += BLOCK_KNOCK_SINK * knock;
  pose.blink = BLOCK_KNOCK_BLINK * knock;
  return pose;
}

function blockSide(frame: number): BipedPose {
  const pose = guardSide(0);
  const reach = shareAt(BLOCK_REACH, frame);
  const knock = shareAt(BLOCK_KNOCK, frame);
  pose.leftHand = shieldFist(
    pose.leftHand,
    BLOCK_SIDE_FIST_SHIFT,
    reach,
    pt(-BLOCK_KNOCK_PUSH * knock, 0),
  );
  pose.lean -= BLOCK_KNOCK_LEAN * knock;
  pose.blink = BLOCK_KNOCK_BLINK * knock;
  return pose;
}

/** From behind the shield is in front of him: what shows is its rim beside his off arm. */
function blockBack(frame: number): BipedPose {
  const pose = guardBack(0);
  const reach = shareAt(BLOCK_REACH, frame);
  const knock = shareAt(BLOCK_KNOCK, frame);
  pose.leftHand = shieldFist(pose.leftHand, BLOCK_BACK_FIST_SHIFT, reach, pt(0, 0));
  pose.bob += BLOCK_KNOCK_SINK * knock;
  return pose;
}

const BLOCK_POSE: Readonly<Record<CardinalView, (frame: number) => BipedPose>> = {
  front: blockFront,
  side: blockSide,
  back: blockBack,
};

function blockRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: BLOCK_FRAMES,
    kind: 'oneShot',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    role: 'reaction',
    ticksPerFrame: BLOCK_TICKS_PER_FRAME,
    pose: BLOCK_POSE[view],
  };
}

/** The block rows, one per painted view; `HUMAN_ROW_NAMES` spreads them in. */
export const BLOCK_ROW_NAMES = ['block', 'block_side', 'block_away'] as const;
export type BlockRowName = (typeof BLOCK_ROW_NAMES)[number];

export const BLOCK_ROW_TABLE = {
  block: blockRow('front'),
  block_side: blockRow('side'),
  block_away: blockRow('back'),
} satisfies Record<BlockRowName, HumanRowDef>;

/** The block row painted in each view. */
export const BLOCK_ROWS: Readonly<Record<CardinalView, BlockRowName>> = {
  front: 'block',
  side: 'block_side',
  back: 'block_away',
};
