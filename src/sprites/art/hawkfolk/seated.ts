/**
 * A Hawkfolk patron on a bar stool: the seated rest, a breath, a reach to a
 * lever or a table, a cheer and a slump.
 *
 * The hip is rested on the seat through `bob` (`hawkfolkBobForHipHeight`).
 * Each leg is posed as a sitter's: the thigh runs level off the cushion, the
 * knee breaks square and the shank and tarsus drop straight down to the foot.
 * Head-on and from behind that forward thigh is drawn as screen height
 * (`seatedDepthShare`), so the knees land in front of the seat rather than the
 * legs dropping as sticks behind it. The club's stools stand taller than the
 * leg, so the feet hang above the foot ring.
 *
 * Every wing pose is given as the angles the wing should make on screen —
 * the upper wing out from hanging, the forewing from straight down — and
 * converted to the rig's spread and elbow bend, which aim either wing alike,
 * mirrored about the body.
 */

import { deg, lerp } from '../bipedArt';
import type { HawkfolkBuild } from './palette';
import {
  HAWKFOLK_METATARSUS_LENGTH,
  HAWKFOLK_SHANK_LENGTH,
  HAWKFOLK_THIGH_LENGTH,
  hawkfolkBobForHipHeight,
  hawkfolkRestingPose,
  type HawkfolkLegPose,
  type HawkfolkPose,
  type HawkfolkView,
  type HawkfolkWingPose,
} from './rig';
import { SEAT_POSE_FRAMES, seatIdlePhase, seatPoseWeight, type SeatPose } from '../seatPoses';

const REST = hawkfolkRestingPose();
const TWO_PI = Math.PI * 2;

/** Hip joint above the seat it rests on, rig units. */
const HIP_ABOVE_SEAT = 0.02;
/** The feet sit a little apart under the knees. */
const FOOT_OUT = 0.06;
const SEATED_TOE_CURL = 0.5;
/** Head-on, a seated thigh's length toward the camera drawn as this share of screen height. */
const SEATED_DEPTH_SHARE = 1;

const BREATH_BOB = 0.012;

/**
 * A wing as it should look head-on: `out` is the upper wing's angle out from
 * hanging, away from the body; `fore` the forewing's angle from straight
 * down, positive toward the body's centreline (so past a right angle it
 * points up and in).
 */
interface WingAim {
  readonly out: number;
  readonly fore: number;
  readonly handOpen: number;
  readonly flare: number;
}

/**
 * Converts an aim into the rig's angles. The rig turns the upper wing by
 * `spread * side` and the forewing a further `elbowBend * side / 2`, so the
 * same spread and bend aim either wing, mirrored about the body.
 */
function aimWing(aim: WingAim): HawkfolkWingPose {
  return {
    shoulderSwing: 0,
    shoulderSpread: aim.out,
    elbowBend: -2 * (aim.fore + aim.out),
    handOpen: aim.handOpen,
    flare: aim.flare,
  };
}

function mixAim(from: WingAim, to: WingAim, t: number): WingAim {
  return {
    out: lerp(from.out, to.out, t),
    fore: lerp(from.fore, to.fore, t),
    handOpen: lerp(from.handOpen, to.handOpen, t),
    flare: lerp(from.flare, to.flare, t),
  };
}

/** Hanging at the side, the hand resting toward the thigh. */
const LAP_AIM: WingAim = { out: 0.16, fore: 0.25, handOpen: 0, flare: 0 };
/** Edge-on the wing comes forward onto the lap, the hand folded a little back toward the thigh. */
const SIDE_LAP_SWING = deg(28);
const SIDE_LAP_SPREAD = 0.16;
const SIDE_LAP_ELBOW = -0.2;

/**
 * The reach, head-on: the wing comes forward on its own side with the hand in
 * front of the lower chest, then pulls straight down — a lever, a button, a
 * stack of chips.
 */
const PLAY_REACH_AIM: WingAim = { out: 0.35, fore: 1.25, handOpen: 0.8, flare: 0 };
const PLAY_PULL_AIM: WingAim = { out: 0.28, fore: 0.85, handOpen: 0.8, flare: 0 };
/**
 * From behind the hand works on the far side of the body, so the reach shows
 * as the elbow poking out past the flank and pumping with the pull.
 */
const BACK_PLAY_REACH_AIM: WingAim = { out: 0.75, fore: 1.9, handOpen: 0.8, flare: 0 };
const BACK_PLAY_PULL_AIM: WingAim = { out: 0.6, fore: 1.6, handOpen: 0.8, flare: 0 };
/** Edge-on: swung forward to the lever, then pulled down. */
const SIDE_PLAY_REACH_SWING = deg(85);
const SIDE_PLAY_PULL_SWING = deg(45);
const SIDE_PLAY_ELBOW = 0.9;
/** Share of the play row the pull starts at, once the wing has arrived. */
const PLAY_PULL_START = 0.35;
const PLAY_LEAN = deg(6);

/**
 * The cheer: both wings up in a high V, flight feathers fanned, beak open.
 * On the way up the wings pass through bent elbows, forearms already raised,
 * never a straight-armed T.
 */
const CHEER_WIND_UP_AIM: WingAim = { out: 1.0, fore: -2.0, handOpen: 0.6, flare: 0.3 };
const CHEER_UP_AIM: WingAim = { out: 2.55, fore: -2.83, handOpen: 1, flare: 0.7 };
/** Share of the rise spent reaching the wind-up. */
const CHEER_WIND_UP_SHARE = 0.5;
/**
 * Edge-on the wings swing up the back way, behind the shoulder line: a
 * Hawkfolk's wing is too short to clear the crown going up the front, where
 * it lies across the face on the way up and at the top.
 */
const SIDE_CHEER_SWING = deg(-150);
const SIDE_CHEER_ELBOW = 0;
const CHEER_BEAK = 1;
const CHEER_HEAD_LIFT = -0.04;
const CHEER_BOUNCE = 0.025;
const CHEER_BOUNCES = 2;

/**
 * The slump: the body folds forward so the shoulders come down, the head
 * hangs, and the wings fold in, hands together in the lap. Edge-on the
 * body barely tips; the neck carries the head forward and down, so the hem
 * stays on the seat.
 */
const SLUMP_AIM: WingAim = { out: 0.02, fore: 0.35, handOpen: 0, flare: 0 };
const SLUMP_HEAD_DROP = 0.08;
const SLUMP_HEAD_AHEAD = 0.1;
const SLUMP_SINK = 0.04;
const SLUMP_FACING_LEAN = deg(26);
const SLUMP_SIDE_LEAN = deg(12);
/** Edge-on the head pitches forward and down, the face toward the lap. */
const SIDE_SLUMP_HEAD_TILT = deg(25);
/** From behind the head sinks between the shoulders. */
const BACK_SLUMP_HEAD_DROP = 0.14;
const SLUMP_HEAD_TILT = deg(10);
const SIDE_SLUMP_SWING = deg(35);

function seatedLeg(hipHeight: number): HawkfolkLegPose {
  // The thigh runs level off the seat; the shank and tarsus hang straight
  // down from a square knee.
  return {
    footAhead: HAWKFOLK_THIGH_LENGTH,
    footOut: FOOT_OUT,
    footLift: hipHeight - HAWKFOLK_SHANK_LENGTH - HAWKFOLK_METATARSUS_LENGTH,
    tarsusTilt: 0,
    toeCurl: SEATED_TOE_CURL,
  };
}

/**
 * Edge-on a wing's spread barely shows and its swing carries it forward, so a
 * profile wing is posed by the rig's own angles rather than by a head-on aim.
 */
function sideWing(swing: number, elbowBend: number, handOpen = 0, flare = 0): HawkfolkWingPose {
  return { shoulderSwing: swing, shoulderSpread: SIDE_LAP_SPREAD, elbowBend, handOpen, flare };
}

function lapWing(view: HawkfolkView): HawkfolkWingPose {
  return view === 'side' ? sideWing(SIDE_LAP_SWING, SIDE_LAP_ELBOW) : aimWing(LAP_AIM);
}

function mixWing(from: HawkfolkWingPose, to: HawkfolkWingPose, t: number): HawkfolkWingPose {
  return {
    shoulderSwing: lerp(from.shoulderSwing, to.shoulderSwing, t),
    shoulderSpread: lerp(from.shoulderSpread, to.shoulderSpread, t),
    elbowBend: lerp(from.elbowBend, to.elbowBend, t),
    handOpen: lerp(from.handOpen, to.handOpen, t),
    flare: lerp(from.flare ?? 0, to.flare ?? 0, t),
  };
}

function seatedRest(view: HawkfolkView, seatHeight: number, build: HawkfolkBuild): HawkfolkPose {
  const hipHeight = seatHeight + HIP_ABOVE_SEAT;
  const leg = seatedLeg(hipHeight);
  return {
    ...REST,
    bob: hawkfolkBobForHipHeight(hipHeight, REST.crouch, build),
    nearLeg: leg,
    farLeg: leg,
    nearWing: lapWing(view),
    farWing: lapWing(view),
    seatedDepthShare: SEATED_DEPTH_SHARE,
  };
}

function idle(
  view: HawkfolkView,
  seatHeight: number,
  build: HawkfolkBuild,
  frame: number,
): HawkfolkPose {
  const rest = seatedRest(view, seatHeight, build);
  const breath = Math.sin(seatIdlePhase(frame) * TWO_PI);
  return { ...rest, bob: rest.bob + breath * BREATH_BOB, headDrop: -breath * BREATH_BOB };
}

function play(
  view: HawkfolkView,
  seatHeight: number,
  build: HawkfolkBuild,
  frame: number,
): HawkfolkPose {
  const rest = seatedRest(view, seatHeight, build);
  const weight = seatPoseWeight('play', frame);
  const t = frame / SEAT_POSE_FRAMES.play;
  const pull = Math.max(0, Math.min(1, (t - PLAY_PULL_START) / PLAY_PULL_START));
  if (view === 'side') {
    const reach = sideWing(
      lerp(SIDE_PLAY_REACH_SWING, SIDE_PLAY_PULL_SWING, pull),
      SIDE_PLAY_ELBOW,
      PLAY_REACH_AIM.handOpen,
    );
    return {
      ...rest,
      lean: PLAY_LEAN * weight,
      nearWing: mixWing(rest.nearWing, reach, weight),
    };
  }
  // From behind the reaching wing is the one on the other side of the picture,
  // the same arm seen from the other side.
  const reachAim = view === 'down' ? PLAY_REACH_AIM : BACK_PLAY_REACH_AIM;
  const pullAim = view === 'down' ? PLAY_PULL_AIM : BACK_PLAY_PULL_AIM;
  const aim = mixAim(LAP_AIM, mixAim(reachAim, pullAim, pull), weight);
  const wing = aimWing(aim);
  return view === 'down' ? { ...rest, nearWing: wing } : { ...rest, farWing: wing };
}

function cheerAim(weight: number): WingAim {
  if (weight < CHEER_WIND_UP_SHARE) {
    return mixAim(LAP_AIM, CHEER_WIND_UP_AIM, weight / CHEER_WIND_UP_SHARE);
  }
  const rest = (weight - CHEER_WIND_UP_SHARE) / (1 - CHEER_WIND_UP_SHARE);
  return mixAim(CHEER_WIND_UP_AIM, CHEER_UP_AIM, rest);
}

function cheer(
  view: HawkfolkView,
  seatHeight: number,
  build: HawkfolkBuild,
  frame: number,
): HawkfolkPose {
  const rest = seatedRest(view, seatHeight, build);
  const weight = seatPoseWeight('cheer', frame);
  const t = frame / SEAT_POSE_FRAMES.cheer;
  const aim = cheerAim(weight);
  const wing =
    view === 'side'
      ? mixWing(
          rest.nearWing,
          sideWing(SIDE_CHEER_SWING, SIDE_CHEER_ELBOW, CHEER_UP_AIM.handOpen, CHEER_UP_AIM.flare),
          weight,
        )
      : aimWing(aim);
  return {
    ...rest,
    bob: rest.bob - CHEER_BOUNCE * weight * Math.abs(Math.sin(t * Math.PI * CHEER_BOUNCES)),
    beakOpen: CHEER_BEAK * weight,
    headDrop: CHEER_HEAD_LIFT * weight,
    nearWing: wing,
    farWing: wing,
  };
}

function slump(
  view: HawkfolkView,
  seatHeight: number,
  build: HawkfolkBuild,
  frame: number,
): HawkfolkPose {
  const rest = seatedRest(view, seatHeight, build);
  const weight = seatPoseWeight('slump', frame);
  const side = view === 'side';
  const aim = mixAim(LAP_AIM, SLUMP_AIM, weight);
  const wing = side
    ? sideWing(lerp(SIDE_LAP_SWING, SIDE_SLUMP_SWING, weight), SIDE_LAP_ELBOW)
    : aimWing(aim);
  return {
    ...rest,
    bob: rest.bob + SLUMP_SINK * weight,
    lean: (side ? SLUMP_SIDE_LEAN : SLUMP_FACING_LEAN) * weight,
    headDrop: (view === 'up' ? BACK_SLUMP_HEAD_DROP : SLUMP_HEAD_DROP) * weight,
    headAhead: SLUMP_HEAD_AHEAD * weight,
    headTilt: (side ? SIDE_SLUMP_HEAD_TILT : SLUMP_HEAD_TILT) * weight,
    nearWing: wing,
    farWing: wing,
  };
}

const SEATED_POSES: Readonly<
  Record<
    SeatPose,
    (view: HawkfolkView, seatHeight: number, build: HawkfolkBuild, frame: number) => HawkfolkPose
  >
> = { idle, play, cheer, slump };

/** One frame of a seated pose in a view, on a seat `seatHeight` rig units off the ground. */
export function hawkfolkSeatedPose(
  seatPose: SeatPose,
  view: HawkfolkView,
  seatHeight: number,
  build: HawkfolkBuild,
  frame: number,
): HawkfolkPose {
  return SEATED_POSES[seatPose](view, seatHeight, build, frame);
}
