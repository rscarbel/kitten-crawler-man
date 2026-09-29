/**
 * Choreography for every skyfowl row: walk, run, idle, talk, work, the club
 * dances and the combat rows (peck/strike, aggressive stance, hurt, death),
 * each as a pose function of a 0..1 cycle phase (looping rows) or a frame
 * index (one-shot rows and the dances).
 *
 * The walk and run are paced by the ground they actually cover — see
 * `skyfowl/gait.ts`, whose ground-per-cycle the sprite wrapper divides
 * distance walked by, never elapsed time.
 */

import { clamp01, deg, easeInOut, easeOut, hump, lerp } from '../carlArt';
import { splineKeys, type PathKey } from '../human/gaitShared';
import {
  DANCE_FRAMES,
  barPhase,
  beatIndex,
  beatPhase,
  danceFacingAt,
  type DanceFacing,
  type DanceStyle,
} from '../danceStyles';
import type { SkyfowlLegPose, SkyfowlPose, SkyfowlWingPose } from './rig';
import { SKYFOWL_STANDING_HIP, SKYFOWL_STANDING_LEG, skyfowlRestingPose } from './rig';
import {
  CONTRALATERAL_PHASE,
  SKYFOWL_RUN,
  SKYFOWL_WALK,
  gaitFoot,
  gaitHipHeight,
  toeOffPhase,
  type SkyfowlGaitSpec,
} from './gait';

export function cyclePhase(frame: number, frameCount: number): number {
  return (frame % frameCount) / frameCount;
}

const REST = skyfowlRestingPose();
const TWO_PI = Math.PI * 2;

/** A foot planted `ahead` of its hip and `out` from it, the tarsus at its standing slope. */
function plantedLeg(ahead: number, out = 0): SkyfowlLegPose {
  return { ...SKYFOWL_STANDING_LEG, footAhead: ahead, footOut: out };
}

// ── Walk and run ─────────────────────────────────────────────────────────────

interface GaitCarriage {
  /** Forward pitch of the body. */
  readonly lean: number;
  /** Head-on weight shift over the planted foot. */
  readonly sway: number;
  /** Wing counter-swing at the shoulder, either side of hanging. */
  readonly wingSwing: number;
  /** How far the wings stand off the body for balance. */
  readonly wingSpread: number;
  readonly wingElbow: number;
  /**
   * How much of the body's bob the head refuses: a bird holds its head level
   * against the stride, which is most of what reads as a bird walking rather
   * than a person in a bird suit.
   */
  readonly headSteady: number;
  /** Profile head thrust, rig units either side of centre; 0 carries the head still. */
  readonly headThrust: number;
}

const WALK_CARRIAGE: GaitCarriage = {
  lean: deg(4),
  sway: 0.018,
  wingSwing: deg(7),
  wingSpread: 0.06,
  wingElbow: -0.3,
  headSteady: 0.6,
  headThrust: 0.04,
};

const RUN_CARRIAGE: GaitCarriage = {
  lean: deg(15),
  sway: 0.012,
  wingSwing: deg(16),
  wingSpread: 0.24,
  wingElbow: 0.45,
  headSteady: 0.7,
  headThrust: 0,
};

/**
 * Of each step, the share the head spends held still against the ground
 * before it thrusts forward to catch up — six frames of the step's eight
 * held, two thrusting.
 */
const HEAD_HOLD_SHARE = 0.75;

/**
 * The profile head's offset from the shoulders through one step: drifting
 * back as the body passes under a head held still, then thrust forward.
 */
function headThrustAt(phase: number, amplitude: number): number {
  if (amplitude === 0) return 0;
  const step = (phase * 2) % 1;
  if (step < HEAD_HOLD_SHARE) return lerp(amplitude, -amplitude, step / HEAD_HOLD_SHARE);
  return lerp(-amplitude, amplitude, easeInOut((step - HEAD_HOLD_SHARE) / (1 - HEAD_HOLD_SHARE)));
}

/**
 * The same-side wing is furthest back as its foot lands (phase 0 for the
 * near foot), which is a cosine off the foot's own cycle, not a sine — a
 * sine puts the wing a quarter-cycle late and the walk reads as a shuffle.
 */
function gaitWing(phase: number, carriage: GaitCarriage): SkyfowlWingPose {
  return {
    shoulderSwing: -Math.cos(phase * TWO_PI) * carriage.wingSwing,
    shoulderSpread: carriage.wingSpread,
    elbowBend: carriage.wingElbow,
    handOpen: 0,
  };
}

function gaitPose(spec: SkyfowlGaitSpec, carriage: GaitCarriage, phase: number): SkyfowlPose {
  const farPhase = phase + CONTRALATERAL_PHASE;
  const bob = SKYFOWL_STANDING_HIP - gaitHipHeight(spec, phase);
  const nearMidStance = toeOffPhase(spec) / 2;
  return {
    ...REST,
    bob,
    lean: carriage.lean,
    crouch: 0,
    sway: -Math.cos((phase - nearMidStance) * TWO_PI) * carriage.sway,
    nearLeg: gaitFoot(spec, phase),
    farLeg: gaitFoot(spec, farPhase),
    nearWing: gaitWing(phase, carriage),
    farWing: gaitWing(farPhase, carriage),
    headDrop: -bob * carriage.headSteady,
    headAhead: headThrustAt(phase, carriage.headThrust),
  };
}

export function skyfowlWalkPose(phase: number): SkyfowlPose {
  return gaitPose(SKYFOWL_WALK, WALK_CARRIAGE, phase);
}

export function skyfowlRunPose(phase: number): SkyfowlPose {
  return gaitPose(SKYFOWL_RUN, RUN_CARRIAGE, phase);
}

// ── Idle ─────────────────────────────────────────────────────────────────────

const IDLE_BOB_AMPLITUDE = 0.018;

export function skyfowlIdlePose(phase: number): SkyfowlPose {
  const breathe = Math.sin(phase * TWO_PI);
  return {
    ...REST,
    bob: breathe * IDLE_BOB_AMPLITUDE,
    headDrop: -breathe * IDLE_BOB_AMPLITUDE * WALK_CARRIAGE.headSteady,
    headTilt: Math.sin(phase * TWO_PI + Math.PI / 3) * deg(3),
    nearWing: { ...REST.nearWing, shoulderSpread: 0.16 + breathe * 0.02 },
    farWing: { ...REST.farWing, shoulderSpread: 0.16 + breathe * 0.02 },
  };
}

// ── Talk ─────────────────────────────────────────────────────────────────────

export function skyfowlTalkPose(phase: number): SkyfowlPose {
  const beak = hump((phase * 2) % 1);
  const gesture = Math.sin(phase * TWO_PI) * deg(14);
  return {
    ...REST,
    bob: Math.sin(phase * TWO_PI) * 0.01,
    headTilt: Math.sin(phase * TWO_PI) * deg(4),
    beakOpen: beak,
    nearWing: { ...REST.nearWing, shoulderSwing: gesture, handOpen: beak * 0.6 },
  };
}

// ── Work (side + down only) ─────────────────────────────────────────────────

export type SkyfowlWorkMotion = 'stir' | 'hammer' | 'sweep' | 'weigh';

export function skyfowlWorkPose(phase: number, motion: SkyfowlWorkMotion): SkyfowlPose {
  const swing = Math.sin(phase * TWO_PI);
  const amplitude = motion === 'hammer' ? deg(45) : deg(24);
  return {
    ...REST,
    bob: Math.abs(swing) * 0.012,
    nearWing: {
      ...REST.nearWing,
      shoulderSwing: swing * amplitude,
      elbowBend: 0.7 + Math.abs(swing) * 0.3,
      handOpen: 0.3,
    },
    farWing: { ...REST.farWing, shoulderSwing: -swing * amplitude * 0.3 },
  };
}

/** The frame in the work loop where a hammering pose lands its blow. */
export const WORK_STRIKE_PHASE = 0.5;

// ── Dance (Desperado Club dancer looks only) ────────────────────────────────
//
// A wing flared overhead is the skyfowl's "hands in the air": the shoulder
// spread runs past a right angle so the wing stands up beside the head with
// its fingers fanned. Every routine sinks into its knees on the beat.

/** A wing standing straight up beside the head. */
const WING_OVERHEAD = 3.0;
/** At the top of the pump's hop the wings close in toward straight up, short of meeting overhead. */
const WING_PUMPED_UP = 2.75;
/** A wing raised in a high V, clear of the head. */
const WING_HIGH_V = 2.55;
/** A wing held straight out to the side. */
const WING_OUT = 1.55;
/** A wing tucked low with the hand at the hip. */
const WING_LOW = 0.5;
const WING_OPEN_ELBOW = 0.55;
/** A negative bend folds the forewing back in toward the body: the hand comes to the hip. */
const WING_TUCKED_ELBOW = -0.9;

function danceWing(
  spread: number,
  elbowBend: number,
  handOpen: number,
  flare: number,
): SkyfowlWingPose {
  return { shoulderSwing: 0, shoulderSpread: spread, elbowBend, handOpen, flare };
}

/** 1 on the beat, 0 half a beat later: the knee bounce every routine rides. */
function onBeat(frame: number): number {
  return 0.5 + 0.5 * Math.cos(beatPhase(frame) * TWO_PI);
}

/** The pump's hop: off the floor through the middle of each beat, landing into the next beat's dip. */
const PUMP_HOP_FROM = 0.25;
const PUMP_HOP_SPAN = 0.5;
const PUMP_HOP_HEIGHT = 0.08;
const PUMP_DIP = 0.75;
const PUMP_SWAY = 0.05;
const PUMP_TILT = deg(6);
const PUMP_FOOT_OUT = 0.07;
const PUMP_FOOT_STAGGER = 0.03;
const PUMP_HEAD_NOD = 0.05;
const PUMP_HEAD_ROCK = deg(8);
/** Toes point down off the floor at the top of the hop. */
const PUMP_TOE_POINT = 0.6;
const PUMP_BEAK_OPEN = 0.4;
/** The beak opens further on the hop — a whoop. */
const PUMP_BEAK_WHOOP = 0.4;
const HAND_FULLY_OPEN = 1;
const WING_FULLY_FLARED = 1;

function pumpHop(frame: number): number {
  const t = (beatPhase(frame) - PUMP_HOP_FROM) / PUMP_HOP_SPAN;
  return t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t);
}

/**
 * Hands in the air: both wings flared overhead, a deep knee bounce into
 * every beat and a hop off the floor between them, the hips swinging across
 * the bar and the head nodding on the beat.
 */
function pumpPose(frame: number): SkyfowlPose {
  const dip = onBeat(frame);
  const hop = pumpHop(frame);
  const rise = hop * PUMP_HOP_HEIGHT;
  const bar = barPhase(frame) * TWO_PI;
  const wingSpread = lerp(WING_HIGH_V, WING_PUMPED_UP, hop);
  const foot = (ahead: number, out: number): SkyfowlLegPose => ({
    ...plantedLeg(ahead, out),
    footLift: rise,
    toeCurl: hop * PUMP_TOE_POINT,
  });
  return {
    ...REST,
    crouch: PUMP_DIP * dip,
    bob: -rise,
    sway: Math.sin(bar) * PUMP_SWAY,
    tilt: -Math.sin(bar) * PUMP_TILT,
    nearLeg: foot(PUMP_FOOT_STAGGER, PUMP_FOOT_OUT),
    farLeg: foot(-PUMP_FOOT_STAGGER, PUMP_FOOT_OUT),
    nearWing: danceWing(wingSpread, WING_OPEN_ELBOW, HAND_FULLY_OPEN, WING_FULLY_FLARED),
    farWing: danceWing(wingSpread, WING_OPEN_ELBOW, HAND_FULLY_OPEN, WING_FULLY_FLARED),
    headDrop: PUMP_HEAD_NOD * dip,
    headTilt: Math.sin(bar) * PUMP_HEAD_ROCK,
    beakOpen: PUMP_BEAK_OPEN + hop * PUMP_BEAK_WHOOP,
  };
}

const SHIMMY_SWAY = 0.1;
const SHIMMY_TILT = deg(8);
/** The shoulders shake once a beat on top of the hip swing: eight frames a shake. */
const SHIMMY_SHAKE = deg(5);
const SHIMMY_DIP = 0.55;
const SHIMMY_FOOT_OUT = 0.11;
const SHIMMY_TAP_LIFT = 0.07;
/**
 * The point peaks a quarter-beat after the dip, on the upbeat: pointed at the
 * bottom of the knee bend the hand is dragged down with the body and never
 * clears the head.
 */
const POINT_LEAD = Math.PI / 2;
/** The pointing wing straightens most of the way as it goes up. */
const WING_POINTING_ELBOW = WING_OPEN_ELBOW / 2;
/** The dropped wing's hand half-closes at the hip. */
const HAND_AT_HIP_OPEN = 0.3;
const SHIMMY_HEAD_TILT = deg(10);
const SHIMMY_HEAD_NOD = 0.035;
const SHIMMY_BEAK_OPEN = 0.3;

/**
 * Step-touch with a disco point: the weight swings onto one foot each beat
 * while the other taps, the hips throw wide with the shoulders tipping the
 * other way and shaking on the beat, and one wing points up to the ceiling
 * while the other drops to the hip — trading on the next beat.
 */
function shimmyPose(frame: number): SkyfowlPose {
  const dip = onBeat(frame);
  const bar = barPhase(frame) * TWO_PI;
  const toward = Math.cos(bar);
  const tap = hump(beatPhase(frame)) * SHIMMY_TAP_LIFT;
  const nearTaps = beatIndex(frame) === 1;
  const nearRaise = 0.5 - 0.5 * Math.cos(bar - POINT_LEAD);
  const wing = (raise: number): SkyfowlWingPose =>
    danceWing(
      lerp(WING_LOW, WING_OVERHEAD, raise),
      lerp(WING_TUCKED_ELBOW, WING_POINTING_ELBOW, raise),
      lerp(HAND_AT_HIP_OPEN, HAND_FULLY_OPEN, raise),
      raise,
    );
  const leg = (taps: boolean): SkyfowlLegPose => ({
    ...plantedLeg(0, SHIMMY_FOOT_OUT),
    footLift: taps ? tap : 0,
    toeCurl: taps ? tap / SHIMMY_TAP_LIFT : 0,
  });
  return {
    ...REST,
    crouch: SHIMMY_DIP * dip,
    sway: -toward * SHIMMY_SWAY,
    tilt: toward * SHIMMY_TILT + Math.sin(beatPhase(frame) * TWO_PI) * SHIMMY_SHAKE,
    nearLeg: leg(nearTaps),
    farLeg: leg(!nearTaps),
    nearWing: wing(nearRaise),
    farWing: wing(1 - nearRaise),
    headTilt: -toward * SHIMMY_HEAD_TILT,
    headDrop: dip * SHIMMY_HEAD_NOD,
    beakOpen: SHIMMY_BEAK_OPEN,
  };
}

/** The spin's knee bend through the bar: loading on the first beat, rising into the turn, landing on the wrap. */
const SPIN_CROUCH: readonly PathKey[] = [
  [-2, 0.4],
  [0, 0.7],
  [3, 0.2],
  [6, 0.6],
  [8, 0.3],
  [11, 0.05],
  [14, 0.4],
  [16, 0.7],
  [19, 0.2],
];
/** The outstretched wings lift a little mid-beat, riding the bounce. */
const SPIN_WING_BOB = 0.2;
/** The wings: held straight out on the first beat, swept straight up for the turn. */
const SPIN_WING: readonly PathKey[] = [
  [-2, WING_OVERHEAD],
  [0, WING_OUT],
  [4, WING_OUT + SPIN_WING_BOB],
  [7, WING_OUT],
  [9, WING_OVERHEAD],
  [13, WING_OVERHEAD],
  [16, WING_OUT],
  [20, WING_OUT + SPIN_WING_BOB],
];
const SPIN_PIVOT_LIFT = 0.06;
/** In profile the spread wings reach toward and away from the camera: shown as a swing fore and aft. */
const SPIN_PROFILE_WING_SWING = 1.25;
const SPIN_SWAY = 0.04;
/** Through the first beat the body rocks twice: once a half-beat. */
const SPIN_ROCKS_PER_BAR = 2;
const SPIN_HEAD_ROCK = deg(8);
const SPIN_FOOT_OUT = 0.03;
/** The pivoting foot rides a little ahead of the planted one. */
const SPIN_PIVOT_AHEAD = 0.02;
const SPIN_PIVOT_TOE_POINT = 0.7;
const SPIN_HEAD_NOD_PER_CROUCH = 0.03;
const SPIN_BEAK_OPEN = 0.5;
/** The last frames of the bar land out of the turn, still on the pivot foot. */
const SPIN_LANDING_FRAMES = 2;

/**
 * Loads on the first beat with the wings straight out and the body rocking,
 * then spins a full turn on one foot on the second, wings swept up, landing
 * facing the camera into the next bar's dip.
 */
function spinPose(frame: number, facing: DanceFacing): SkyfowlPose {
  const crouch = splineKeys(frame, SPIN_CROUCH);
  const spread = splineKeys(frame, SPIN_WING);
  const turning = facing !== 'down' || frame >= DANCE_FRAMES - SPIN_LANDING_FRAMES;
  const rock = Math.sin(barPhase(frame) * TWO_PI * SPIN_ROCKS_PER_BAR);
  const profile = facing === 'left' || facing === 'right';
  const wing = (fore: number): SkyfowlWingPose => ({
    ...danceWing(spread, WING_OPEN_ELBOW, HAND_FULLY_OPEN, WING_FULLY_FLARED),
    shoulderSwing: profile ? fore * SPIN_PROFILE_WING_SWING : 0,
  });
  return {
    ...REST,
    crouch,
    sway: turning ? 0 : rock * SPIN_SWAY,
    nearLeg: plantedLeg(0, SPIN_FOOT_OUT),
    farLeg: turning
      ? {
          ...plantedLeg(SPIN_PIVOT_AHEAD, SPIN_FOOT_OUT),
          footLift: SPIN_PIVOT_LIFT,
          toeCurl: SPIN_PIVOT_TOE_POINT,
        }
      : plantedLeg(0, SPIN_FOOT_OUT),
    nearWing: wing(1),
    farWing: wing(-1),
    headTilt: turning ? 0 : rock * SPIN_HEAD_ROCK,
    headDrop: crouch * SPIN_HEAD_NOD_PER_CROUCH,
    beakOpen: SPIN_BEAK_OPEN,
  };
}

/** One frame of a dance routine, in the facing the routine is in on that frame. */
export function skyfowlDancePose(style: DanceStyle, frame: number): SkyfowlPose {
  if (style === 'pump') return pumpPose(frame);
  if (style === 'shimmy') return shimmyPose(frame);
  return spinPose(frame, danceFacingAt(style, frame));
}

// ── Combat: strike ───────────────────────────────────────────────────────────

export const STRIKE_FRAMES = 8;
export const STRIKE_IMPACT_FRAME = 4;

const STRIKE_LUNGE_AHEAD = 0.2;
const STRIKE_REAR_BEHIND = 0.14;
const STRIKE_CROUCH = 0.2;
/** The head drives forward past the shoulders into the peck. */
const STRIKE_HEAD_THRUST = 0.06;

export function skyfowlStrikePose(frame: number): SkyfowlPose {
  const t = frame / (STRIKE_FRAMES - 1);
  const impactT = STRIKE_IMPACT_FRAME / (STRIKE_FRAMES - 1);
  const windup = clamp01(t / impactT);
  const release = clamp01((t - impactT) / (1 - impactT));
  const strikeExtend = t < impactT ? easeInOut(windup) : 1 - easeOut(release) * 0.7;
  return {
    ...REST,
    lean: deg(18) * strikeExtend,
    crouch: STRIKE_CROUCH * strikeExtend,
    headAhead: STRIKE_HEAD_THRUST * strikeExtend,
    nearLeg: plantedLeg(STRIKE_LUNGE_AHEAD * strikeExtend),
    farLeg: plantedLeg(-STRIKE_REAR_BEHIND),
    nearWing: {
      shoulderSwing: deg(70) * strikeExtend,
      shoulderSpread: 0.1,
      elbowBend: 0.3,
      handOpen: 0.9,
    },
    headTurn: 0,
    beakOpen: strikeExtend,
  };
}

// ── Combat: aggressive stance (loop) ─────────────────────────────────────────

export const AGGRESSIVE_FRAMES = 8;

/** The fighting stance's feet: one ahead, one behind, set wide. */
const AGGRO_FOOT_SPLIT = 0.1;
const AGGRO_FOOT_OUT = 0.05;
const AGGRO_CROUCH = 0.4;
const AGGRO_CROUCH_BOUNCE = 0.05;
const AGGRO_SWAY = 0.02;

export function skyfowlAggressivePose(phase: number): SkyfowlPose {
  const sway = Math.sin(phase * TWO_PI);
  return {
    ...REST,
    lean: deg(14),
    crouch: AGGRO_CROUCH + sway * AGGRO_CROUCH_BOUNCE,
    sway: sway * AGGRO_SWAY,
    nearLeg: plantedLeg(AGGRO_FOOT_SPLIT, AGGRO_FOOT_OUT),
    farLeg: plantedLeg(-AGGRO_FOOT_SPLIT, AGGRO_FOOT_OUT),
    nearWing: {
      shoulderSwing: deg(10) + sway * deg(5),
      shoulderSpread: 0.32,
      elbowBend: 0.5,
      handOpen: 0.7,
    },
    farWing: {
      shoulderSwing: -deg(10) - sway * deg(5),
      shoulderSpread: 0.32,
      elbowBend: 0.5,
      handOpen: 0.7,
    },
    beakOpen: 0.5,
  };
}

// ── Combat: hurt ─────────────────────────────────────────────────────────────

export const HURT_FRAMES = 4;

/** The feet a hit rocks the body back over: planted where the blow found them. */
const HURT_NEAR_FOOT_AHEAD = 0.04;
const HURT_FAR_FOOT_BEHIND = 0.06;
const HURT_CROUCH = 0.2;
/** The head snaps back behind the shoulders as the body recoils. */
const HURT_HEAD_SNAP = 0.04;

export function skyfowlHurtPose(frame: number): SkyfowlPose {
  const t = frame / (HURT_FRAMES - 1);
  const recoil = hump(t);
  return {
    ...REST,
    lean: -deg(16) * recoil,
    crouch: HURT_CROUCH * recoil,
    headAhead: -HURT_HEAD_SNAP * recoil,
    nearLeg: plantedLeg(HURT_NEAR_FOOT_AHEAD),
    farLeg: plantedLeg(-HURT_FAR_FOOT_BEHIND),
    nearWing: {
      shoulderSwing: -deg(20) * recoil,
      shoulderSpread: 0.4 * recoil,
      elbowBend: 0.8,
      handOpen: 0.6,
    },
    farWing: {
      shoulderSwing: deg(10) * recoil,
      shoulderSpread: 0.3 * recoil,
      elbowBend: 0.8,
      handOpen: 0.3,
    },
    beakOpen: recoil,
  };
}

// ── Combat: death ────────────────────────────────────────────────────────────

export const DEATH_FRAMES = 8;

/** How far the collapse pitches the body forward over the folding legs. */
const DEATH_PITCH = deg(68);
/** How far past a full crouch the hips sink as the legs fold, plus the body's own slump. */
const DEATH_CROUCH = 1.3;
const DEATH_SLUMP = 0.14;
const DEATH_NEAR_FOOT_AHEAD = 0.06;
const DEATH_FAR_FOOT_BEHIND = 0.04;

/** A collapse: the legs fold under the body and it pitches forward over them. */
export function skyfowlDeathPose(frame: number): SkyfowlPose {
  const t = clamp01(frame / (DEATH_FRAMES - 1));
  const fall = easeOut(t);
  return {
    ...REST,
    lean: DEATH_PITCH * fall,
    bob: DEATH_SLUMP * fall,
    crouch: DEATH_CROUCH * fall,
    nearLeg: plantedLeg(DEATH_NEAR_FOOT_AHEAD * fall),
    farLeg: plantedLeg(-DEATH_FAR_FOOT_BEHIND * fall),
    nearWing: {
      shoulderSwing: lerp(0, deg(50), fall),
      shoulderSpread: lerp(0.16, 0.5, fall),
      elbowBend: 0.6,
      handOpen: lerp(0, 0.8, fall),
    },
    farWing: {
      shoulderSwing: lerp(0, -deg(20), fall),
      shoulderSpread: lerp(0.16, 0.4, fall),
      elbowBend: 0.6,
      handOpen: 0.4,
    },
    beakOpen: fall,
  };
}

// ── Posture bias ─────────────────────────────────────────────────────────────

export type SkyfowlPosture = 'upright' | 'hunched';

const HUNCHED_LEAN = deg(9);
const HUNCHED_CROUCH = 0.16;

/**
 * The street-tough's base posture reads differently from any citizen's even
 * before it moves — a forward hunch and a lower stance — so a player never
 * mistakes an idle citizen for one at a glance from the base rows alone.
 */
export function applyPosture(pose: SkyfowlPose, posture: SkyfowlPosture): SkyfowlPose {
  if (posture === 'upright') return pose;
  return {
    ...pose,
    lean: pose.lean + HUNCHED_LEAN,
    crouch: pose.crouch + HUNCHED_CROUCH,
  };
}
