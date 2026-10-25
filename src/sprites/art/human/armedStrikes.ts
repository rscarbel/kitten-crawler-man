/**
 * The blows the human crawler throws with a weapon out, one family per armed set, each
 * authored frame by frame in every view he has rows for:
 *
 * - a light one-hander: the forehand slash (high on his right, down across
 *   him), the backhand (low on his left, up across him), the overhead chop
 *   (over his head, down ahead of him) and the thrust (drawn back to the hip,
 *   driven straight out);
 * - a heavy one-hander: the overhead smash (wound back over the shoulder,
 *   brought down hard ahead of him) and the side swing (wound round behind
 *   him, swung round level at the waist);
 * - a two-hander: the sweep, the haft carried round level at the waist in
 *   both fists.
 *
 * Every blow starts from the set's own guard — a two-hander's stance, having
 * none — and hands back to it; the weapon is fully extended on the impact
 * frame, the frame the hit is scored on.
 *
 * Each frame names where the weapon fist is relative to the shoulder it
 * hangs from, how the item turns, and what the trunk adds to the stance, so
 * the same beats ride on a running body for the versions thrown on the move:
 * the legs are then the run's own, carried on from the stride the blow was
 * begun at, and the upper body takes the blow over from the run's carry and
 * hands it back.
 */

import { HUMAN_SWING_FRAMES } from '../../../core/crawlerFormulas';
import { PLAYER_SPEED } from '../../../core/constants';
import { lerpAngle, pt } from '../biped/geometry';
import { WRIST_FOLLOW } from '../biped/limbs';
import {
  type BodySide,
  type BipedPose,
  FULL_UPPER_ARM,
  type HaftDepth,
  HAFT_AWAY_FROM_CAMERA,
  HAFT_IN_PLANE,
  HAFT_TOWARD_CAMERA,
  VIEWS,
  buildSkeleton,
} from '../biped/rig';
import { deg, lerp, type Pt } from '../bipedArt';
import type { CardinalView } from '../../facingView';
import type { Vec3 } from '../../held/heldPaint';
import {
  armAnglesFor,
  armOf,
  armedRunUnder,
  CARRY_HOLDS,
  type FistPlace,
  guardsOwnWay,
  type Hold,
  type OneHandHold,
  setArm,
  type TwoHandHold,
  withHold,
} from './armedHold';
import { type FrameTable, frameValue, runPhaseAt } from './gaitShared';
import { KNUCKLES_TO_CAMERA, rolled, towards } from './handTurn';
import { guardBack, guardFront, guardSide, idleBack, idleFront, idleSide } from './idles';
import { RUN_GROUND_PER_CYCLE_PX, runFacingCycle, runSide } from './locomotion';
import type { ArmedMotionSet } from './motionSets';
import { ATTACK_FRAMES } from './timing';

// ── The families ─────────────────────────────────────────────────────────────

/** The blows each armed set throws, by name. */
export const ARMED_STRIKES = {
  oneHandLight: ['slash', 'backhand', 'chop', 'thrust'],
  oneHandHeavy: ['smash', 'swing'],
  twoHand: ['sweep'],
} as const satisfies Readonly<Record<ArmedMotionSet, readonly string[]>>;

export type ArmedStrikeOf<S extends ArmedMotionSet> = (typeof ARMED_STRIKES)[S][number];
/** Every armed blow, by a name no two sets share. */
export type ArmedStrike = ArmedStrikeOf<ArmedMotionSet>;

// ── Frames ───────────────────────────────────────────────────────────────────

/**
 * What the trunk adds to the stance on each frame of a blow: the hips turn
 * and the shoulders follow (`twist`, positive bringing the right shoulder
 * forward), the body leans in and sinks, the head tips, and the face sets
 * (`effort`, 0 to 1). `leadStep` slides the lead foot in, edge-on only.
 */
interface TrunkTracks {
  readonly twist: FrameTable;
  readonly lean: FrameTable;
  readonly crouch: FrameTable;
  readonly headTilt: FrameTable;
  readonly effort: FrameTable;
  readonly leadStep?: FrameTable;
}

/** One frame of a one-handed blow: the weapon fist and how the item turns, in degrees. */
interface OneHandKey {
  readonly fist: FistPlace;
  readonly haft: number;
  readonly share?: number;
  readonly depth?: HaftDepth;
  readonly palm?: Vec3;
  /** The free fist; absent, it stays where the guard holds it. */
  readonly free?: FistPlace;
  /** Seen from behind, the weapon arm drawn on the far side of his back. */
  readonly behind?: boolean;
}

/** One frame of a two-handed blow: where the butt fist grips, from the middle of his shoulders. */
interface TwoHandKey {
  readonly butt: Pt;
  readonly haft: number;
  readonly spacing: number;
  readonly depth?: HaftDepth;
  readonly buttHand?: BodySide;
}

interface OneHandPlan {
  readonly kind: 'oneHand';
  readonly keys: readonly OneHandKey[];
  readonly trunk: TrunkTracks;
  readonly palm: Vec3;
}

interface TwoHandPlan {
  readonly kind: 'twoHand';
  readonly keys: readonly TwoHandKey[];
  readonly trunk: TrunkTracks;
}

type StrikePlan = OneHandPlan | TwoHandPlan;

function fist(
  x: number,
  y: number,
  bend: FistPlace['bend'],
  upperScale = 1,
  foreScale = 1,
): FistPlace {
  return { wrist: pt(x, y), bend, upperScale, foreScale };
}

// Fist offsets are from his right shoulder joint, in tile units of his rig:
// his arm is 0.64 long, hanging straight its wrist sits about 0.63 below it.

// ── Light one-hander, profile ────────────────────────────────────────────────
//
// Edge-on facing +X his right arm is the near one, so every blow is thrown
// across the camera's side of him, and a blade turning through the camera
// is drawn short.

const LIGHT_SIDE_GUARD_FREE = fist(0.2, 0.34, 'down');

/** Down from high behind his right shoulder, through level ahead of him on the hit, across and low. */
const LIGHT_SIDE_SLASH: OneHandPlan = {
  kind: 'oneHand',
  palm: KNUCKLES_TO_CAMERA,
  keys: [
    { fist: fist(0.36, 0.3, 'down'), haft: -58 },
    { fist: fist(-0.02, 0.02, 'down'), haft: -166 },
    { fist: fist(-0.1, -0.14, 'up'), haft: -168, share: 0.9 },
    { fist: fist(0.26, -0.04, 'down'), haft: -95, share: 0.7, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.6, 0.18, 'down'), haft: -6 },
    { fist: fist(0.34, 0.42, 'down'), haft: 42, share: 0.55, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.3, 0.38, 'down'), haft: 10, share: 0.8, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.34, 0.32, 'down'), haft: -38 },
  ],
  trunk: {
    twist: [0, -0.35, -0.55, 0.2, 0.7, 0.8, 0.4, 0.1],
    lean: [0, -deg(4), -deg(6), deg(3), deg(9), deg(9), deg(4), deg(1)],
    crouch: [0, 0.02, 0.04, 0.08, 0.12, 0.12, 0.06, 0.02],
    headTilt: [0, -deg(2), -deg(3), deg(4), deg(8), deg(8), deg(4), deg(1)],
    effort: [0, 0.3, 0.6, 0.9, 1, 0.8, 0.4, 0.1],
    leadStep: [0, 0, 0.02, 0.08, 0.12, 0.12, 0.07, 0.02],
  },
};

/** Up from low on his far side, the blade rising through level to point high ahead of him on the hit. */
const LIGHT_SIDE_BACKHAND: OneHandPlan = {
  kind: 'oneHand',
  palm: KNUCKLES_TO_CAMERA,
  keys: [
    { fist: fist(0.36, 0.3, 'down'), haft: -58 },
    { fist: fist(0.2, 0.38, 'down'), haft: 120, share: 0.7, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.08, 0.46, 'down'), haft: 158, share: 0.6, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.36, 0.22, 'down'), haft: 62, share: 0.8, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.52, -0.26, 'down'), haft: -30 },
    { fist: fist(0.36, -0.4, 'down'), haft: -76 },
    { fist: fist(0.36, -0.04, 'down'), haft: -70 },
    { fist: fist(0.36, 0.24, 'down'), haft: -62 },
  ],
  trunk: {
    twist: [0, 0.3, 0.5, 0.1, -0.4, -0.5, -0.2, 0],
    lean: [0, deg(4), deg(7), deg(3), -deg(3), -deg(4), -deg(1), 0],
    crouch: [0, 0.06, 0.12, 0.1, 0.04, 0.02, 0.02, 0],
    headTilt: [0, deg(4), deg(6), deg(2), -deg(4), -deg(5), -deg(2), 0],
    effort: [0, 0.3, 0.6, 0.9, 1, 0.8, 0.4, 0.1],
    leadStep: [0, 0, 0.01, 0.05, 0.09, 0.09, 0.05, 0.01],
  },
};

/** Raised over his head, the blade hanging back behind it, then brought down level ahead of him and on down. */
const LIGHT_SIDE_CHOP: OneHandPlan = {
  kind: 'oneHand',
  palm: KNUCKLES_TO_CAMERA,
  keys: [
    { fist: fist(0.36, 0.3, 'down'), haft: -58 },
    { fist: fist(-0.22, 0.12, 'up'), haft: -150 },
    { fist: fist(-0.3, -0.28, 'up'), haft: -200 },
    { fist: fist(0.28, -0.4, 'down'), haft: -98 },
    { fist: fist(0.56, 0.24, 'down'), haft: 18 },
    { fist: fist(0.42, 0.38, 'down'), haft: 44 },
    { fist: fist(0.4, 0.36, 'down'), haft: 2 },
    { fist: fist(0.36, 0.31, 'down'), haft: -44 },
  ],
  trunk: {
    twist: [0, -0.2, -0.3, 0.2, 0.5, 0.5, 0.2, 0.05],
    lean: [0, -deg(5), -deg(8), deg(4), deg(14), deg(14), deg(6), deg(1)],
    crouch: [0, 0, -0.02, 0.06, 0.16, 0.16, 0.08, 0.02],
    headTilt: [0, -deg(6), -deg(9), deg(2), deg(10), deg(10), deg(4), deg(1)],
    effort: [0, 0.4, 0.7, 0.9, 1, 0.8, 0.4, 0.1],
    leadStep: [0, 0, 0, 0.06, 0.1, 0.1, 0.06, 0.02],
  },
};

/** Drawn back to the hip, the point level ahead, then driven straight out at full stretch with a lunge. */
const LIGHT_SIDE_THRUST: OneHandPlan = {
  kind: 'oneHand',
  palm: KNUCKLES_TO_CAMERA,
  keys: [
    { fist: fist(0.36, 0.3, 'down'), haft: -58 },
    { fist: fist(0.14, 0.4, 'down'), haft: -12 },
    { fist: fist(-0.02, 0.42, 'down'), haft: -2 },
    { fist: fist(0.3, 0.3, 'down'), haft: -2 },
    { fist: fist(0.62, 0.12, 'down'), haft: -4 },
    { fist: fist(0.55, 0.15, 'down'), haft: -4 },
    { fist: fist(0.42, 0.24, 'down'), haft: -22 },
    { fist: fist(0.37, 0.29, 'down'), haft: -46 },
  ],
  trunk: {
    twist: [0, -0.3, -0.45, 0.2, 0.6, 0.55, 0.25, 0.05],
    lean: [0, -deg(3), -deg(5), deg(6), deg(14), deg(12), deg(5), deg(1)],
    crouch: [0, 0.04, 0.08, 0.14, 0.18, 0.18, 0.1, 0.02],
    headTilt: [0, 0, 0, deg(2), deg(4), deg(4), deg(2), 0],
    effort: [0, 0.3, 0.5, 0.9, 1, 0.8, 0.4, 0.1],
    leadStep: [0, 0, 0, 0.1, 0.18, 0.18, 0.1, 0.03],
  },
};

// ── Light one-hander, head-on ────────────────────────────────────────────────
//
// Authored with his right at +X; the head-on view draws it reflected, so his
// sword arm is on the viewer's left. A blow at something south of him is
// thrown at the camera: the arm drives toward it and is drawn short.

const LIGHT_FRONT_SLASH: OneHandPlan = {
  kind: 'oneHand',
  palm: towards(0.3, 0, -0.95),
  keys: [
    { fist: fist(0.05, 0.3, 'up', 0.6), haft: -74 },
    { fist: fist(0.28, -0.06, 'down'), haft: -62 },
    { fist: fist(0.26, -0.18, 'down', 0.85), haft: -74, share: 0.8, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.16, 0.02, 'down', 0.8), haft: -175, share: 0.8, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(-0.14, 0.2, 'down', 0.4, 0.75), haft: 172 },
    { fist: fist(-0.28, 0.3, 'down', 0.8), haft: 165, share: 0.9, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(-0.1, 0.4, 'down', 0.8), haft: 200 },
    { fist: fist(0.02, 0.32, 'up', 0.6), haft: 270 },
  ],
  trunk: {
    twist: [0, -0.15, -0.25, 0.05, 0.25, 0.3, 0.15, 0.03],
    lean: [0, deg(3), deg(5), deg(1), -deg(4), -deg(5), -deg(2), 0],
    crouch: [0, 0.02, 0.04, 0.08, 0.12, 0.12, 0.06, 0.02],
    headTilt: [0, 0, 0, 0, 0, 0, 0, 0],
    effort: [0, 0.3, 0.6, 0.9, 1, 0.8, 0.4, 0.1],
  },
};

const LIGHT_FRONT_BACKHAND: OneHandPlan = {
  kind: 'oneHand',
  palm: towards(0.3, 0, -0.95),
  keys: [
    { fist: fist(0.05, 0.3, 'up', 0.6), haft: -74 },
    { fist: fist(-0.14, 0.24, 'down', 0.8), haft: 168, share: 0.9, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(-0.22, 0.26, 'down', 0.8), haft: 176, share: 0.9, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.0, 0.34, 'down', 0.7), haft: 72, share: 0.7, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.28, -0.04, 'down', 0.45, 0.7), haft: -36 },
    { fist: fist(0.32, -0.24, 'down'), haft: -70 },
    { fist: fist(0.18, 0.06, 'down', 0.8), haft: -80 },
    { fist: fist(0.07, 0.28, 'up', 0.6), haft: -76 },
  ],
  trunk: {
    twist: [0, 0.2, 0.3, 0.05, -0.25, -0.3, -0.12, 0],
    lean: [0, -deg(3), -deg(5), -deg(1), deg(4), deg(5), deg(2), 0],
    crouch: [0, 0.06, 0.12, 0.1, 0.04, 0.02, 0.02, 0],
    headTilt: [0, 0, 0, 0, 0, 0, 0, 0],
    effort: [0, 0.3, 0.6, 0.9, 1, 0.8, 0.4, 0.1],
  },
};

const LIGHT_FRONT_CHOP: OneHandPlan = {
  kind: 'oneHand',
  palm: towards(0.3, 0, -0.95),
  keys: [
    { fist: fist(0.05, 0.3, 'up', 0.6), haft: -74 },
    { fist: fist(0.16, -0.24, 'down', 0.9), haft: -92 },
    { fist: fist(0.12, -0.5, 'down'), haft: -90, share: 0.5, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.12, -0.24, 'down'), haft: -64, share: 0.6, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.05, 0.36, 'up', 0.45, 0.7), haft: 100, share: 0.7, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.05, 0.46, 'up', 0.6, 0.8), haft: 96, share: 0.8, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.05, 0.38, 'up', 0.6), haft: 20 },
    { fist: fist(0.05, 0.31, 'up', 0.6), haft: -60 },
  ],
  trunk: {
    twist: [0, -0.1, -0.15, 0, 0.1, 0.1, 0.05, 0],
    lean: [0, 0, 0, 0, 0, 0, 0, 0],
    crouch: [0, 0, -0.02, 0.08, 0.2, 0.2, 0.1, 0.02],
    headTilt: [0, 0, 0, 0, 0, 0, 0, 0],
    effort: [0, 0.4, 0.7, 0.9, 1, 0.8, 0.4, 0.1],
  },
};

const LIGHT_FRONT_THRUST: OneHandPlan = {
  kind: 'oneHand',
  palm: towards(0.3, 0, -0.95),
  keys: [
    { fist: fist(0.05, 0.3, 'up', 0.6), haft: -74 },
    { fist: fist(0.2, 0.44, 'up'), haft: -40, share: 0.6, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.24, 0.48, 'up'), haft: -20, share: 0.4, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.12, 0.34, 'up', 0.7, 0.8), haft: 30, share: 0.4, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.02, 0.22, 'up', 0.3, 0.45), haft: 100, share: 0.45, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.03, 0.24, 'up', 0.35, 0.5), haft: 100, share: 0.45, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.05, 0.3, 'up', 0.5, 0.8), haft: 10, share: 0.7, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.05, 0.3, 'up', 0.6), haft: -60 },
  ],
  trunk: {
    twist: [0, -0.15, -0.2, 0.05, 0.2, 0.2, 0.1, 0],
    lean: [0, 0, 0, 0, 0, 0, 0, 0],
    crouch: [0, 0.04, 0.08, 0.14, 0.18, 0.18, 0.1, 0.02],
    headTilt: [0, 0, 0, 0, 0, 0, 0, 0],
    effort: [0, 0.3, 0.5, 0.9, 1, 0.8, 0.4, 0.1],
  },
};

/**
 * From behind the same blows, driven away from the camera: depth reverses,
 * and while the fist is out ahead of him his back hides the arm, so only
 * the blade showing past his outline carries the blow.
 */
function fromBehind(plan: OneHandPlan, behindFrames: readonly number[]): OneHandPlan {
  return {
    ...plan,
    keys: plan.keys.map((key, frame) => {
      const behind = behindFrames.includes(frame);
      // Hidden by his back, only the length that clears his outline shows,
      // so the item is held flat across the picture there.
      if (behind) return { ...key, behind, share: 1, depth: HAFT_IN_PLANE };
      return {
        ...key,
        ...(key.depth === undefined ? {} : { depth: reversedDepth(key.depth) }),
        behind,
      };
    }),
  };
}

function reversedDepth(depth: HaftDepth): HaftDepth {
  if (depth === HAFT_TOWARD_CAMERA) return HAFT_AWAY_FROM_CAMERA;
  if (depth === HAFT_AWAY_FROM_CAMERA) return HAFT_TOWARD_CAMERA;
  return HAFT_IN_PLANE;
}

/** Frames whose weapon fist is out before his chest, hidden by his back seen from behind. */
const OUT_BEFORE_HIM = [0, 3, 4, 5, 6, 7];
const LOW_BEFORE_HIM = [0, 1, 2, 3, 4, 5, 6, 7];

// ── Heavy one-hander ─────────────────────────────────────────────────────────

const HEAVY_SIDE_SMASH: OneHandPlan = {
  kind: 'oneHand',
  palm: KNUCKLES_TO_CAMERA,
  keys: [
    { fist: fist(0.2, 0.05, 'down'), haft: -170 },
    { fist: fist(-0.22, 0.12, 'up'), haft: -170 },
    { fist: fist(-0.3, -0.28, 'up'), haft: -218 },
    { fist: fist(0.3, -0.38, 'down'), haft: -100 },
    { fist: fist(0.56, 0.28, 'down'), haft: 32 },
    { fist: fist(0.44, 0.36, 'down'), haft: 52 },
    { fist: fist(0.3, 0.3, 'down'), haft: 120 },
    { fist: fist(0.22, 0.07, 'down'), haft: -168 },
  ],
  trunk: {
    twist: [0, -0.25, -0.35, 0.2, 0.55, 0.55, 0.25, 0.05],
    lean: [0, -deg(6), -deg(10), deg(6), deg(18), deg(18), deg(8), deg(2)],
    crouch: [0, 0, -0.02, 0.08, 0.22, 0.22, 0.1, 0.02],
    headTilt: [0, -deg(6), -deg(10), deg(2), deg(12), deg(12), deg(5), deg(1)],
    effort: [0, 0.4, 0.8, 1, 1, 0.8, 0.4, 0.1],
    leadStep: [0, 0, 0, 0.08, 0.14, 0.14, 0.08, 0.02],
  },
};

const HEAVY_SIDE_SWING: OneHandPlan = {
  kind: 'oneHand',
  palm: KNUCKLES_TO_CAMERA,
  keys: [
    { fist: fist(0.2, 0.05, 'down'), haft: -170 },
    { fist: fist(0.02, 0.18, 'down'), haft: -170 },
    { fist: fist(-0.14, 0.24, 'up'), haft: -185, share: 0.9 },
    { fist: fist(0.26, 0.26, 'down'), haft: -90, share: 0.4, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.6, 0.2, 'down'), haft: 0 },
    { fist: fist(0.3, 0.32, 'down'), haft: 22, share: 0.5, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.28, 0.2, 'down'), haft: -50, share: 0.8, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.22, 0.07, 'down'), haft: -168 },
  ],
  trunk: {
    twist: [0, -0.45, -0.7, 0.3, 0.9, 1, 0.5, 0.1],
    lean: [0, -deg(3), -deg(5), deg(4), deg(8), deg(8), deg(4), deg(1)],
    crouch: [0, 0.06, 0.1, 0.14, 0.16, 0.16, 0.08, 0.02],
    headTilt: [0, 0, 0, deg(2), deg(4), deg(4), deg(2), 0],
    effort: [0, 0.4, 0.7, 1, 1, 0.8, 0.4, 0.1],
    leadStep: [0, 0, 0.02, 0.08, 0.12, 0.12, 0.06, 0.02],
  },
};

const HEAVY_FRONT_SMASH: OneHandPlan = {
  kind: 'oneHand',
  palm: towards(0.3, 0, -0.95),
  keys: [
    { fist: fist(0.12, 0.14, 'up', 0.7), haft: -92 },
    { fist: fist(0.24, -0.2, 'down'), haft: -82 },
    { fist: fist(0.14, -0.5, 'down'), haft: -96, share: 0.5, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.12, -0.26, 'down'), haft: -70, share: 0.6, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.05, 0.4, 'up', 0.45, 0.7), haft: 175, share: 0.9, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.05, 0.48, 'up', 0.6, 0.8), haft: 160, share: 0.9, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(0.1, 0.46, 'up', 0.75, 0.85), haft: 10 },
    { fist: fist(0.12, 0.18, 'up', 0.7), haft: -70 },
  ],
  trunk: {
    twist: [0, -0.1, -0.15, 0, 0.1, 0.1, 0.05, 0],
    lean: [0, 0, 0, 0, 0, 0, 0, 0],
    crouch: [0, 0, -0.02, 0.1, 0.26, 0.26, 0.12, 0.02],
    headTilt: [0, 0, 0, 0, 0, 0, 0, 0],
    effort: [0, 0.4, 0.8, 1, 1, 0.8, 0.4, 0.1],
  },
};

const HEAVY_FRONT_SWING: OneHandPlan = {
  kind: 'oneHand',
  palm: towards(0.3, 0, -0.95),
  keys: [
    { fist: fist(0.12, 0.14, 'up', 0.7), haft: -92 },
    { fist: fist(0.38, 0.16, 'down'), haft: -20 },
    { fist: fist(0.44, 0.12, 'down'), haft: -6, share: 0.8, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(0.24, 0.36, 'up', 0.85), haft: 54, share: 0.5, depth: HAFT_TOWARD_CAMERA },
    { fist: fist(-0.1, 0.3, 'down', 0.5, 0.8), haft: 174 },
    { fist: fist(-0.34, 0.3, 'down', 0.8), haft: 196, share: 0.7, depth: HAFT_AWAY_FROM_CAMERA },
    { fist: fist(-0.06, 0.26, 'down', 0.75), haft: 200 },
    { fist: fist(0.1, 0.18, 'up', 0.7), haft: 266 },
  ],
  trunk: {
    twist: [0, -0.25, -0.35, 0.05, 0.3, 0.35, 0.15, 0.03],
    lean: [0, deg(4), deg(6), deg(1), -deg(5), -deg(6), -deg(2), 0],
    crouch: [0, 0.04, 0.08, 0.12, 0.14, 0.14, 0.07, 0.02],
    headTilt: [0, 0, 0, 0, 0, 0, 0, 0],
    effort: [0, 0.4, 0.7, 1, 1, 0.8, 0.4, 0.1],
  },
};

// ── Two-hander ───────────────────────────────────────────────────────────────
//
// The butt fist's place is from the middle of his shoulders, and the haft
// runs from it at `haft` degrees; `spacing` under the carry's draws the haft
// turned out of the picture. Head-on his shoulders are too far apart for one
// fist to reach across to the other's side, so while the head is out on his
// right the left fist takes the butt and the right slides up the haft, the
// way a chop's grip slides as it passes over.

const TWO_HAND_SIDE_SWEEP: TwoHandPlan = {
  kind: 'twoHand',
  keys: [
    { butt: pt(0.02, 0.58), haft: -22, spacing: 2.6 },
    { butt: pt(-0.14, 0.5), haft: -170, spacing: 2.2 },
    { butt: pt(-0.24, 0.46), haft: -165, spacing: 1.6, depth: HAFT_TOWARD_CAMERA },
    { butt: pt(0.04, 0.56), haft: -60, spacing: 1.4, depth: HAFT_TOWARD_CAMERA },
    { butt: pt(0.26, 0.6), haft: 0, spacing: 2.6 },
    { butt: pt(0.16, 0.6), haft: 40, spacing: 1, depth: HAFT_AWAY_FROM_CAMERA },
    { butt: pt(0.06, 0.6), haft: 4, spacing: 1.8, depth: HAFT_AWAY_FROM_CAMERA },
    { butt: pt(0.03, 0.58), haft: -18, spacing: 2.5 },
  ],
  trunk: {
    twist: [0, -0.5, -0.8, 0.2, 0.9, 1, 0.5, 0.1],
    lean: [0, -deg(3), -deg(5), deg(4), deg(10), deg(10), deg(4), deg(1)],
    crouch: [0, 0.06, 0.12, 0.16, 0.2, 0.2, 0.1, 0.02],
    headTilt: [0, 0, 0, deg(2), deg(6), deg(6), deg(2), 0],
    effort: [0, 0.4, 0.7, 1, 1, 0.8, 0.4, 0.1],
    leadStep: [0, 0, 0.02, 0.08, 0.14, 0.14, 0.07, 0.02],
  },
};

const TWO_HAND_FRONT_SWEEP: TwoHandPlan = {
  kind: 'twoHand',
  keys: [
    { butt: pt(0.3, 0.6), haft: -141, spacing: 2 },
    { butt: pt(0.08, 0.48), haft: -70, spacing: 1.6, buttHand: 'left' },
    {
      butt: pt(0.05, 0.45),
      haft: -30,
      spacing: 1.4,
      depth: HAFT_AWAY_FROM_CAMERA,
      buttHand: 'left',
    },
    { butt: pt(0.08, 0.5), haft: 20, spacing: 1.6, depth: HAFT_TOWARD_CAMERA, buttHand: 'left' },
    { butt: pt(0.05, 0.55), haft: 150, spacing: 2.2, depth: HAFT_TOWARD_CAMERA },
    { butt: pt(0.12, 0.55), haft: 185, spacing: 2.6, depth: HAFT_TOWARD_CAMERA },
    { butt: pt(0.22, 0.58), haft: 205, spacing: 2.8 },
    { butt: pt(0.28, 0.6), haft: 222, spacing: 2.2 },
  ],
  trunk: {
    twist: [0, -0.25, -0.35, 0, 0.3, 0.35, 0.15, 0.03],
    lean: [0, deg(3), deg(5), deg(1), -deg(4), -deg(5), -deg(2), 0],
    crouch: [0, 0.06, 0.1, 0.16, 0.22, 0.22, 0.1, 0.02],
    headTilt: [0, 0, 0, 0, 0, 0, 0, 0],
    effort: [0, 0.4, 0.7, 1, 1, 0.8, 0.4, 0.1],
  },
};

function twoHandFromBehind(plan: TwoHandPlan): TwoHandPlan {
  return {
    ...plan,
    keys: plan.keys.map((key) => ({
      ...key,
      ...(key.depth === undefined ? {} : { depth: reversedDepth(key.depth) }),
    })),
  };
}

// ── Every blow's frames, by view ──────────────────────────────────────────────

type PlansByView = Readonly<Record<CardinalView, StrikePlan>>;

const STRIKE_PLANS: Readonly<Record<ArmedStrike, PlansByView>> = {
  slash: {
    side: LIGHT_SIDE_SLASH,
    front: LIGHT_FRONT_SLASH,
    back: fromBehind(LIGHT_FRONT_SLASH, OUT_BEFORE_HIM),
  },
  backhand: {
    side: LIGHT_SIDE_BACKHAND,
    front: LIGHT_FRONT_BACKHAND,
    back: fromBehind(LIGHT_FRONT_BACKHAND, LOW_BEFORE_HIM),
  },
  chop: {
    side: LIGHT_SIDE_CHOP,
    front: LIGHT_FRONT_CHOP,
    back: fromBehind(LIGHT_FRONT_CHOP, OUT_BEFORE_HIM),
  },
  thrust: {
    side: LIGHT_SIDE_THRUST,
    front: LIGHT_FRONT_THRUST,
    back: fromBehind(LIGHT_FRONT_THRUST, LOW_BEFORE_HIM),
  },
  smash: {
    side: HEAVY_SIDE_SMASH,
    front: HEAVY_FRONT_SMASH,
    back: fromBehind(HEAVY_FRONT_SMASH, OUT_BEFORE_HIM),
  },
  swing: {
    side: HEAVY_SIDE_SWING,
    front: HEAVY_FRONT_SWING,
    back: fromBehind(HEAVY_FRONT_SWING, OUT_BEFORE_HIM),
  },
  sweep: {
    side: TWO_HAND_SIDE_SWEEP,
    front: TWO_HAND_FRONT_SWEEP,
    back: twoHandFromBehind(TWO_HAND_FRONT_SWEEP),
  },
};

// ── Posing a frame ───────────────────────────────────────────────────────────

/** The settled bottom of the guard's bounce, where every blow starts from. */
const GUARD_SETTLED_PHASE = 0.5;

/** What a blow is thrown from in a view: the bare-handed guard's legs, or a two-hander's stance. */
function strikeBase(set: ArmedMotionSet, view: CardinalView): BipedPose {
  if (!guardsOwnWay(set)) {
    if (view === 'side') return idleSide(0);
    return view === 'back' ? idleBack(0) : idleFront(0);
  }
  if (view === 'side') return guardSide(GUARD_SETTLED_PHASE);
  return view === 'back' ? guardBack(GUARD_SETTLED_PHASE) : guardFront(GUARD_SETTLED_PHASE);
}

/** The free fist where the set's guard raises it, for a blow that does not move it. */
const LIGHT_FREE: Readonly<Record<CardinalView, FistPlace>> = {
  side: LIGHT_SIDE_GUARD_FREE,
  front: fist(0.08, 0.3, 'down', 0.7),
  back: fist(0.08, 0.3, 'down', 0.7),
};

/** The hold a one-handed blow's frame puts in his hands. */
function oneHandHoldAt(plan: OneHandPlan, frame: number, view: CardinalView): OneHandHold {
  const key = plan.keys[Math.min(Math.max(frame, 0), plan.keys.length - 1)];
  return {
    kind: 'oneHand',
    fist: key.fist,
    haftAngle: deg(key.haft),
    haftShare: key.share ?? 1,
    haftDepth: key.depth ?? HAFT_IN_PLANE,
    palm: key.palm ?? plan.palm,
    free: key.free ?? LIGHT_FREE[view],
  };
}

/** The palms a two-handed blow closes with, per view, as the carry closes them. */
function twoHandHoldAt(plan: TwoHandPlan, frame: number, view: CardinalView): TwoHandHold {
  const key = plan.keys[Math.min(Math.max(frame, 0), plan.keys.length - 1)];
  const carry = CARRY_HOLDS.twoHand[view];
  if (carry.kind !== 'twoHand') return twoHandFallback(view);
  return {
    ...carry,
    butt: key.butt,
    haftAngle: deg(key.haft),
    spacing: key.spacing,
    depth: key.depth ?? HAFT_IN_PLANE,
    buttHand: key.buttHand ?? carry.buttHand,
  };
}

function twoHandFallback(view: CardinalView): TwoHandHold {
  return {
    kind: 'twoHand',
    butt: pt(0, 0.6),
    haftAngle: 0,
    spacing: 1,
    buttHand: 'right',
    depth: HAFT_IN_PLANE,
    palms: { left: KNUCKLES_TO_CAMERA, right: KNUCKLES_TO_CAMERA },
    elbowFlare: view === 'side' ? 0 : 1,
  };
}

function holdAt(plan: StrikePlan, frame: number, view: CardinalView): Hold {
  return plan.kind === 'oneHand'
    ? oneHandHoldAt(plan, frame, view)
    : twoHandHoldAt(plan, frame, view);
}

/** A set face: the brow drawn down and the mouth open on the effort. */
const EFFORT_MOUTH = 0.45;

function applyTrunk(pose: BipedPose, trunk: TrunkTracks, frame: number, weight: number): void {
  pose.twist += frameValue(trunk.twist, frame) * weight;
  pose.lean += frameValue(trunk.lean, frame) * weight;
  pose.crouch += frameValue(trunk.crouch, frame) * weight;
  pose.headTilt += frameValue(trunk.headTilt, frame) * weight;
  const effort = frameValue(trunk.effort, frame) * weight;
  pose.brow = pose.brow + (1 - pose.brow) * effort;
  pose.mouth = EFFORT_MOUTH * effort;
}

/** How high the lead foot is lifted off the floor on a frame it is sliding in. */
const LEAD_STEP_LIFT = 0.02;

/**
 * Steps the lead (left) foot in along the floor, edge-on: lifted clear on a
 * frame it travels, set down where it lands, and planted only while it holds
 * still.
 */
function stepLead(pose: BipedPose, steps: FrameTable, frame: number): void {
  const step = frameValue(steps, frame);
  const moving = step !== frameValue(steps, frame - 1) && step !== frameValue(steps, frame + 1);
  const lift = moving ? LEAD_STEP_LIFT : 0;
  pose.leftFoot = pt(pose.leftFoot.x + step, pose.leftFoot.y - lift);
  pose.leftFootPlanted = !moving;
}

/** One frame of a blow thrown standing. */
export function armedStrike(
  set: ArmedMotionSet,
  strike: ArmedStrike,
  view: CardinalView,
  frame: number,
): BipedPose {
  const plan = STRIKE_PLANS[strike][view];
  const base = strikeBase(set, view);
  applyTrunk(base, plan.trunk, frame, 1);
  if (view === 'side' && plan.trunk.leadStep !== undefined) {
    stepLead(base, plan.trunk.leadStep, frame);
  }
  const pose = withHold(base, view, holdAt(plan, frame, view), 0);
  if (plan.kind === 'oneHand' && view === 'back') {
    const behind = plan.keys[Math.min(frame, plan.keys.length - 1)].behind ?? true;
    pose.rightArmBehind = behind;
  }
  return pose;
}

// ── On the move ──────────────────────────────────────────────────────────────

/**
 * How much of a run cycle one frame of a blow covers at his base speed: the
 * swing's ticks shared over the row's frames, at the run's own ground per
 * cycle, so the foot in stance holds the floor while the sprite travels.
 */
const RUN_CYCLE_PER_STRIKE_FRAME =
  ((HUMAN_SWING_FRAMES / ATTACK_FRAMES) * PLAYER_SPEED) / RUN_GROUND_PER_CYCLE_PX;
const LAST_FRAME = ATTACK_FRAMES - 1;

/** The run phase a blow begun at `entry` is at on `frame`. */
export function travellingRunPhase(entry: number, frame: number): number {
  return runPhaseAt(entry, frame, RUN_CYCLE_PER_STRIKE_FRAME);
}

/** The run phase a blow on the move begun at `entry` hands the legs back at. */
export function travellingExitPhase(entry: number): number {
  return travellingRunPhase(entry, LAST_FRAME);
}

/**
 * How much of each frame's upper body is the blow rather than the run's
 * carry: taken over through the wind-up, whole through the hit, handed back
 * through the recovery, so the last frame is close to the stride it rejoins.
 */
const TRAVELLING_BLEND: FrameTable = [0.15, 0.85, 1, 1, 1, 1, 0.85, 0.3];

/** `to` turned to the equivalent of itself nearest `from`, so a blend turns the short way. */
function nearestTurn(from: number, to: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function blendFist(from: FistPlace, to: FistPlace, t: number): FistPlace {
  return {
    wrist: pt(lerp(from.wrist.x, to.wrist.x, t), lerp(from.wrist.y, to.wrist.y, t)),
    upperScale: lerp(from.upperScale ?? FULL_UPPER_ARM, to.upperScale ?? FULL_UPPER_ARM, t),
    foreScale: lerp(from.foreScale ?? 1, to.foreScale ?? 1, t),
    bend: t < HALF ? from.bend : to.bend,
  };
}

const HALF = 0.5;

function blendedHold(carry: Hold, blow: Hold, t: number): Hold {
  if (carry.kind === 'twoHand' && blow.kind === 'twoHand') {
    return {
      ...(t < HALF ? carry : blow),
      butt: pt(lerp(carry.butt.x, blow.butt.x, t), lerp(carry.butt.y, blow.butt.y, t)),
      haftAngle: lerpAngle(carry.haftAngle, blow.haftAngle, t),
      spacing: lerp(carry.spacing, blow.spacing, t),
    };
  }
  if (carry.kind === 'oneHand' && blow.kind === 'oneHand') {
    return {
      kind: 'oneHand',
      fist: blendFist(carry.fist, blow.fist, t),
      haftAngle: lerp(carry.haftAngle, nearestTurn(carry.haftAngle, blow.haftAngle), t),
      haftShare: lerp(carry.haftShare ?? 1, blow.haftShare ?? 1, t),
      haftDepth: t < HALF ? (carry.haftDepth ?? HAFT_IN_PLANE) : (blow.haftDepth ?? HAFT_IN_PLANE),
      palm: rolled(carry.palm, blow.palm, t),
    };
  }
  return t < HALF ? carry : blow;
}

/**
 * One frame of a blow thrown on the move, begun at run phase `entry`: the
 * run's legs and body, carrying the weapon, with the blow's upper body
 * taken over from the carry and handed back to it.
 */
export function armedTravellingStrike(
  set: ArmedMotionSet,
  strike: ArmedStrike,
  view: CardinalView,
  entry: number,
  frame: number,
): BipedPose {
  const phase = travellingRunPhase(entry, frame);
  // The blow takes the upper body only: the legs stay the run's own, flight
  // and all.
  const run = view === 'side' ? runSide(phase) : runFacingCycle(phase, view === 'back');
  const carrying = armedRunUnder(set, view, run);
  const plan = STRIKE_PLANS[strike][view];
  const weight = frameValue(TRAVELLING_BLEND, frame);
  const blow = holdAt(plan, frame, view);
  const carryHold = currentHold(carrying, view, set);
  const body = { ...carrying };
  applyTrunk(body, plan.trunk, frame, weight);
  // The shoulders turn as far as they do in the blow thrown standing, not that
  // on top of the stride's own counter-swing: the fists are placed from them.
  const standingTwist = strikeBase(set, view).twist + frameValue(plan.trunk.twist, frame);
  body.twist = lerp(carrying.twist, standingTwist, weight);
  body.crouch = carrying.crouch;
  const pose = withHold(body, view, blendedHold(carryHold, blow, weight), 0);
  if (blow.kind === 'oneHand' && blow.free !== undefined) {
    const running = armOf(carrying, view, 'left');
    const raised = armAnglesFor(blow.free);
    // Head-on the standing blow's free fist sits at his belt, which over
    // running legs reads as a hand parked on the hip: the free arm keeps
    // pumping with the stride instead. Edge-on it rises to the guard.
    const freeWeight = VIEWS[view].profile ? weight : 0;
    setArm(
      pose,
      view,
      'left',
      {
        upper: lerp(running.angles.upper, raised.upper, freeWeight),
        fore: lerp(running.angles.fore, raised.fore, freeWeight),
        foreScale: lerp(running.angles.foreScale, raised.foreScale, freeWeight),
        wristFollow: lerp(
          running.angles.wristFollow ?? WRIST_FOLLOW,
          raised.wristFollow ?? WRIST_FOLLOW,
          freeWeight,
        ),
      },
      lerp(running.upperScale, blow.free.upperScale ?? FULL_UPPER_ARM, freeWeight),
    );
  }
  if (plan.kind === 'oneHand' && view === 'back') {
    const behind = plan.keys[Math.min(frame, plan.keys.length - 1)].behind ?? true;
    pose.rightArmBehind = weight >= HALF ? behind : carrying.rightArmBehind;
  }
  return pose;
}

/**
 * The hold the run's carry has on one of its frames, read back as the hold
 * that produced it — the carry's fist where the stride has swung it — so a
 * blow taken over from it starts from the arm on screen.
 */
function currentHold(carrying: BipedPose, view: CardinalView, set: ArmedMotionSet): Hold {
  const carry = CARRY_HOLDS[set][view];
  if (carry.kind === 'twoHand') return carry;
  const turned = carrying.rightHandOrientation?.haftAngle ?? carry.haftAngle;
  const wrist = carrying.rightHand;
  const shoulder = rightShoulderOf(carrying, view);
  return {
    ...carry,
    fist: { ...carry.fist, wrist: pt(wrist.x - shoulder.x, wrist.y - shoulder.y) },
    haftAngle: turned,
  };
}

function rightShoulderOf(pose: BipedPose, view: CardinalView): Pt {
  return buildSkeleton(pose, VIEWS[view]).rightArm.root;
}
