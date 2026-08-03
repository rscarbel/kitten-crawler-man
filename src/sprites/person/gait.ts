/**
 * Turns a walk-cycle clock into a `Pose` for the skeleton.
 *
 * The clock is measured in **cycles, not frames**: one unit of `phase` is one
 * complete stride, and the caller advances it by the distance the figure
 * actually travelled divided by {@link walkCycleDistance}. That is what keeps
 * cadence tied to speed — the town's citizens range over a five-fold spread of
 * walking speeds, and a fixed per-frame advance had the slowest of them
 * moonwalking and the fastest mincing.
 *
 * Each foot is placed in **ground space** rather than swung from the hip. While
 * a foot is in stance it is planted and translates backward at exactly the rate
 * the body moves forward, so it does not slide; while it is in swing it tucks,
 * passes under the hip and reaches for the next contact. `skeleton.ts` solves
 * the knee to wherever that puts the ankle. The structure is ported from the
 * player character's generator, which is the only convincing walk in the game.
 *
 * Per-person `gait` traits scale stride, bounce and arm swing so a crowd never
 * marches in lockstep, and each {@link GaitArchetype} gives a role its own shape
 * of walk on top of that.
 */

import type { GaitArchetype, PersonAppearance } from './PersonAppearance';
import type { FootPlacement, LimbAngles, Pose } from './skeleton';
import type { Facing } from './skeleton';

/** Half the cycle is stance and half is swing, per foot. */
const STANCE_SHARE = 0.5;

/**
 * Stride reach as a fraction of the person's own leg length, so a tall citizen
 * covers more ground per step than a child without either of them splitting
 * further than a leg can.
 */
const STRIDE_PER_LEG_LENGTH = 0.37;

// Where in the swing the tuck, the pass and the reach fall, and how high the
// foot is at each. Lifts are fractions of leg length.
const TOE_LIFT_AT = 0.12;
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;
const TOE_LIFT = 0.049;
const TUCK_LIFT = 0.167;
const PASS_LIFT = 0.113;
const REACH_LIFT = 0.03;

/** Where the foot is through the swing, as a fraction of the stride reach. */
const SWING_TUCK_REACH = -0.75;
const SWING_MID_REACH = 0;
const SWING_LATE_REACH = 0.8;

const DEGREES_TO_RADIANS = Math.PI / 180;
const HEEL_STRIKE_PITCH = -9 * DEGREES_TO_RADIANS;
const TOE_OFF_PITCH = 13 * DEGREES_TO_RADIANS;
const SWING_PITCH = -6 * DEGREES_TO_RADIANS;
/** The stance foot is flat between these two points of the stance. */
const STANCE_FLAT_START = 0.2;
const STANCE_FLAT_END = 0.75;

/**
 * Head-on, almost none of the stride is visible: the step has to be sold by the
 * foot rising and the leg foreshortening rather than by sideways travel. The
 * pitch, by contrast, is nearly invisible from the front and is scaled down.
 */
const FACING_STRIDE_SHARE = 0.12;
const FACING_LIFT_SHARE = 0.95;
const FACING_PITCH_SHARE = 0.5;

/**
 * Pelvic drop beyond the minimum the stride geometrically demands, as a
 * fraction of leg length. The demanded part is derived rather than tuned — see
 * {@link hipDropAmplitude}.
 */
const EXTRA_BOB_PER_LEG_LENGTH = 0.028;
/**
 * Slack over the geometric minimum, so the IK's reach clamp does not bind *at
 * contact* — which is where binding would cost real stride. It still binds at
 * mid-stance, by the solver's extension epsilon: the foot is directly under the
 * hip there and the leg is genuinely straight, which is correct anatomy and
 * accounts for the fraction of a pixel the harness reports.
 */
const REACH_HEADROOM = 1.06;
/**
 * Beyond this share of full leg extension the drop needed to reach explodes. A
 * forward guard rather than a live knob: the widest stride any genome and
 * archetype can combine to is 0.52.
 */
const MAX_STRIDE_RATIO = 0.72;

const ARM_SWING_PROFILE = 0.5;
/**
 * Head-on the arms are the walk's whole readable travel, so they swing far
 * wider here than the legs do. Raising the skeleton's frontal scale instead
 * would be the wrong lever: that scale is what stops the legs splaying sideways.
 */
const ARM_SWING_FRONT = 0.34;
/** An arm swings further forward than back. */
const ARM_BACKSWING_SHARE = 0.55;
const ARM_BEND_BASE = 0.16;
const ARM_BEND_AMP = 0.3;

const LEAN_SWAY = 0.012;
const HEAD_SWAY = 0.01;
/**
 * `lean` is a horizontal shift of the shoulders, which edge-on is a fore/aft
 * lean and head-on is nothing of the sort — a citizen who leans into their walk
 * would simply stand permanently listing to one side. Most of it is motion in
 * depth from the front, so only a fraction survives.
 */
const FACING_LEAN_SHARE = 0.2;
/** Shoulder-line roll at full swing, as a fraction of draw size. */
const SHOULDER_ROLL_AMP = 0.016;
/** Profile hides a shoulder roll entirely — edge-on it is motion in depth. */
const PROFILE_SHOULDER_ROLL = 0;

/** Cycles of the idle breathe clock per frame, for callers standing still. */
export const IDLE_CYCLES_PER_FRAME = 0.0072;
const IDLE_SETTLE = 0.01;
const IDLE_ARM_BEND = 0.12;
/** A person at rest stands with one foot fractionally ahead of the other. */
const IDLE_FOOT_STAGGER = 0.02;

const TWO_PI = Math.PI * 2;

/** How a role's walk differs in shape, not just in scalar jitter. */
interface GaitArchetypeTraits {
  strideFactor: number;
  liftFactor: number;
  armSwingFactor: number;
  bobFactor: number;
  pitchFactor: number;
  /** Constant forward lean added to the person's own posture. */
  leanBias: number;
  /** Lateral body sway amplitude as a fraction of draw size. */
  swayAmp: number;
  /** Sway cycles per stride. Deliberately not a whole number, so a stagger never repeats on the beat. */
  swayCycles: number;
}

const NO_SWAY = 0;
const NO_SWAY_CYCLES = 0;

const ARCHETYPE_TRAITS: Record<GaitArchetype, GaitArchetypeTraits> = {
  amble: {
    strideFactor: 1,
    liftFactor: 1,
    armSwingFactor: 1,
    bobFactor: 1,
    pitchFactor: 1,
    leanBias: 0,
    swayAmp: NO_SWAY,
    swayCycles: NO_SWAY_CYCLES,
  },
  // Somewhere to be: long steps, a driven arm, and almost no vertical waste.
  purposeful: {
    strideFactor: 1.18,
    liftFactor: 1,
    armSwingFactor: 1.25,
    bobFactor: 0.9,
    pitchFactor: 1,
    leanBias: 0.012,
    swayAmp: NO_SWAY,
    swayCycles: NO_SWAY_CYCLES,
  },
  // Carrying something heavy: short steps, feet barely clearing the ground, arms pinned.
  trudge: {
    strideFactor: 0.85,
    liftFactor: 0.75,
    armSwingFactor: 0.7,
    bobFactor: 1.15,
    pitchFactor: 0.8,
    leanBias: 0.022,
    swayAmp: NO_SWAY,
    swayCycles: NO_SWAY_CYCLES,
  },
  // Short quick steps. Not as short as a child's legs alone would make them —
  // the height scale already shortens the stride, and shortening it twice is
  // what put a child's legs at fourteen steps a second.
  trot: {
    strideFactor: 0.85,
    liftFactor: 1.25,
    armSwingFactor: 1.3,
    bobFactor: 1.3,
    pitchFactor: 1,
    leanBias: 0,
    swayAmp: NO_SWAY,
    swayCycles: NO_SWAY_CYCLES,
  },
  stagger: {
    strideFactor: 1.05,
    liftFactor: 0.85,
    armSwingFactor: 1.1,
    bobFactor: 1.2,
    pitchFactor: 0.7,
    leanBias: 0,
    swayAmp: 0.035,
    swayCycles: 0.37,
  },
  // Barely lifts a foot; the shoes never leave the flagstones.
  shuffle: {
    strideFactor: 0.55,
    liftFactor: 0.35,
    armSwingFactor: 0.5,
    bobFactor: 0.7,
    pitchFactor: 0.3,
    leanBias: 0.03,
    swayAmp: NO_SWAY,
    swayCycles: NO_SWAY_CYCLES,
  },
};

/** Piecewise linear interpolation through a set of (t, value) keys. */
function keyed(t: number, keys: ReadonlyArray<readonly [number, number]>): number {
  for (let i = 1; i < keys.length; i++) {
    const [prevT, prevV] = keys[i - 1];
    const [nextT, nextV] = keys[i];
    if (t <= nextT) return prevV + (nextV - prevV) * ((t - prevT) / (nextT - prevT));
  }
  return keys[keys.length - 1][1];
}

function wrapCycle(phase: number): number {
  return ((phase % 1) + 1) % 1;
}

function isProfileFacing(facing: Facing): boolean {
  return facing === 'left' || facing === 'right';
}

function traitsFor(appearance: PersonAppearance): GaitArchetypeTraits {
  return ARCHETYPE_TRAITS[appearance.gait.archetype];
}

/** Leg length as a fraction of draw size, which every gait amplitude is measured against. */
function legLengthFraction(appearance: PersonAppearance): number {
  return appearance.body.legLength * appearance.body.heightScale;
}

/**
 * How far a foot splits from under the hip at contact, as a share of leg length.
 * Clamped in one place, because both the stride and the pelvic drop that has to
 * pay for it are derived from it and a clamp applied to only one of them would
 * silently put the foot out of reach.
 */
function strideRatio(appearance: PersonAppearance): number {
  return Math.min(
    MAX_STRIDE_RATIO,
    STRIDE_PER_LEG_LENGTH * appearance.gait.strideScale * traitsFor(appearance).strideFactor,
  );
}

/** How far ahead of neutral a foot reaches at contact, as a fraction of draw size. */
export function strideReach(appearance: PersonAppearance): number {
  return strideRatio(appearance) * legLengthFraction(appearance);
}

/**
 * World distance one full stride carries the body, in the same pixels the draw
 * size is given in. Each half-cycle one foot is planted and travels twice the
 * stride reach backward relative to the body, so the body advances exactly that
 * far; two half-cycles make the stride.
 */
export function walkCycleDistance(appearance: PersonAppearance, drawSize: number): number {
  const strideTravelPerStep = 2 * strideReach(appearance) * drawSize;
  return strideTravelPerStep * STEPS_PER_CYCLE;
}

const STEPS_PER_CYCLE = 2;
/** A neutral genome's leg length: the midpoint of the range, at unit stature. */
const REFERENCE_LEG_LENGTH_FRACTION = 0.38;
/** That genome's cycle distance, as a fraction of draw size — the yardstick speeds scale against. */
const REFERENCE_CYCLE_FRACTION =
  STEPS_PER_CYCLE * 2 * STRIDE_PER_LEG_LENGTH * REFERENCE_LEG_LENGTH_FRACTION;

/**
 * How much of a stride difference is taken out of a person's *speed* rather
 * than left to show up in their cadence. One means everybody steps at the same
 * rate; zero means nobody's speed is adjusted at all, which is where this
 * started.
 */
const STRIDE_SPEED_SHARE = 0.75;
/**
 * A citizen may not end up more than this much slower or faster than their
 * cohort intends. The floor is a guard rather than a live knob — the smallest
 * genome lands at 0.48 — but the ceiling does bind, on the tallest striders.
 */
const GAIT_SPEED_FACTOR_MIN = 0.4;
const GAIT_SPEED_FACTOR_MAX = 1.25;

/**
 * What to multiply a citizen's world speed by so their walk does not blur.
 *
 * Cadence is `speed / cycleDistance`, and once cadence is driven by distance
 * (which is the whole point of this rig) a crowd that hands every citizen the
 * same speed while their strides differ four-fold gets a four-fold spread of
 * step rates. Observed: a child's legs moved at fourteen steps a second next to
 * an adult's four, because a child is 62 % of an adult's height and was walking
 * at an adult's pace. So the same terms that shorten a stride also slow the
 * person down — which is what being small, laden, or shuffling actually means.
 *
 * Not the *whole* difference: a child should still take quicker steps than the
 * adult beside them, so only {@link STRIDE_SPEED_SHARE} of it moves into speed.
 */
export function gaitSpeedFactor(appearance: PersonAppearance): number {
  // Through `walkCycleDistance`, not a second copy of its arithmetic: the two
  // have to normalize against the same distance, and a stride relation changed
  // in one place only would drift cadence back apart with no gate to catch it.
  const unitDrawSize = 1;
  const relative = walkCycleDistance(appearance, unitDrawSize) / REFERENCE_CYCLE_FRACTION;
  const factor = Math.pow(relative, STRIDE_SPEED_SHARE);
  return Math.min(GAIT_SPEED_FACTOR_MAX, Math.max(GAIT_SPEED_FACTOR_MIN, factor));
}

/**
 * How far the pelvis drops at contact.
 *
 * The geometric part is not a taste decision: with a foot planted a stride
 * ahead, the hip→ankle distance is `hypot(stride, hipHeight)`, and the leg can
 * only cover that if the hip comes down to `sqrt(legLen² − stride²)`. Guessing
 * a bob instead is what makes an IK leg lock straight with its foot hanging in
 * the air. The person's own `bounceScale` rides on top of that floor.
 */
function hipDropAmplitude(appearance: PersonAppearance): number {
  const legLen = legLengthFraction(appearance);
  const ratio = strideRatio(appearance);
  const geometric = legLen * (1 - Math.sqrt(1 - ratio * ratio)) * REACH_HEADROOM;
  const traits = traitsFor(appearance);
  const character =
    legLen * EXTRA_BOB_PER_LEG_LENGTH * appearance.gait.bounceScale * traits.bobFactor;
  return geometric + character;
}

/**
 * One foot's placement at a point in its own cycle. `cycle` 0 is heel strike:
 * stance runs to {@link STANCE_SHARE}, swing to the next contact.
 */
function footPlacement(
  cycle: number,
  reach: number,
  liftScale: number,
  pitchScale: number,
  strideShare: number,
  liftShare: number,
): FootPlacement {
  const c = wrapCycle(cycle);
  const stance = c < STANCE_SHARE;
  const t = stance ? c / STANCE_SHARE : (c - STANCE_SHARE) / (1 - STANCE_SHARE);
  const forwardReach = reach * strideShare;

  if (stance) {
    return {
      // Planted: the foot slides backward at exactly the rate the body moves
      // forward, which is the whole point of driving the clock off distance.
      forward: forwardReach - 2 * forwardReach * t,
      lift: 0,
      pitch:
        keyed(t, [
          [0, HEEL_STRIKE_PITCH],
          [STANCE_FLAT_START, 0],
          [STANCE_FLAT_END, 0],
          [1, TOE_OFF_PITCH],
        ]) * pitchScale,
    };
  }
  return {
    forward:
      forwardReach *
      keyed(t, [
        [0, -1],
        [TUCK_AT, SWING_TUCK_REACH],
        [PASS_AT, SWING_MID_REACH],
        [REACH_AT, SWING_LATE_REACH],
        [1, 1],
      ]),
    lift:
      liftScale *
      liftShare *
      keyed(t, [
        [0, 0],
        [TOE_LIFT_AT, TOE_LIFT],
        [TUCK_AT, TUCK_LIFT],
        [PASS_AT, PASS_LIFT],
        [REACH_AT, REACH_LIFT],
        [1, 0],
      ]),
    pitch:
      keyed(t, [
        [0, TOE_OFF_PITCH],
        [PASS_AT, SWING_PITCH],
        [1, HEEL_STRIKE_PITCH],
      ]) * pitchScale,
  };
}

/** Shoulder rotation for an arm that is `forward` of vertical, −1 to 1. */
function armAngles(forward: number, amplitude: number): LimbAngles {
  const shortened = forward >= 0 ? forward : forward * ARM_BACKSWING_SHARE;
  return {
    swing: shortened * amplitude,
    bend: ARM_BEND_BASE + ARM_BEND_AMP * Math.max(0, forward),
  };
}

function idlePose(appearance: PersonAppearance, facing: Facing, phase: number): Pose {
  const { gait } = appearance;
  const breatheCycle = wrapCycle(phase + gait.phaseOffset);
  const settle = ((1 - Math.sin(breatheCycle * TWO_PI)) / 2) * IDLE_SETTLE * gait.bounceScale;
  const restingArm: LimbAngles = { swing: 0, bend: IDLE_ARM_BEND };
  const traits = traitsFor(appearance);
  const leanShare = isProfileFacing(facing) ? 1 : FACING_LEAN_SHARE;
  return {
    hipDrop: settle,
    lean: (gait.postureLean + traits.leanBias) * leanShare,
    sway: 0,
    headTilt: 0,
    shoulderRoll: 0,
    leftFoot: { forward: -IDLE_FOOT_STAGGER, lift: 0, pitch: 0 },
    rightFoot: { forward: IDLE_FOOT_STAGGER, lift: 0, pitch: 0 },
    leftArm: restingArm,
    rightArm: restingArm,
  };
}

function walkPose(appearance: PersonAppearance, facing: Facing, phase: number): Pose {
  const { gait } = appearance;
  const traits = traitsFor(appearance);
  const profile = isProfileFacing(facing);
  const cycle = wrapCycle(phase + gait.phaseOffset);

  const reach = strideReach(appearance);
  const liftScale = legLengthFraction(appearance) * traits.liftFactor;
  const pitchScale = traits.pitchFactor;
  const strideShare = profile ? 1 : FACING_STRIDE_SHARE;
  const liftShare = profile ? 1 : FACING_LIFT_SHARE;
  const pitchShare = profile ? 1 : FACING_PITCH_SHARE;

  const rightFoot = footPlacement(
    cycle,
    reach,
    liftScale,
    pitchScale * pitchShare,
    strideShare,
    liftShare,
  );
  const leftFoot = footPlacement(
    cycle + STANCE_SHARE,
    reach,
    liftScale,
    pitchScale * pitchShare,
    strideShare,
    liftShare,
  );

  // Zero at contact and one over the straight stance leg, so the pelvis troughs
  // where a real one does. The old pose had this exactly inverted.
  const overStanceLeg = Math.abs(Math.sin(cycle * TWO_PI));
  const hipDrop = hipDropAmplitude(appearance) * (1 - overStanceLeg);

  const armAmplitude =
    (profile ? ARM_SWING_PROFILE : ARM_SWING_FRONT) * gait.armSwingScale * traits.armSwingFactor;

  // Cosine, not sine, and getting this wrong is the standing trap in this
  // codebase: `footPlacement` puts a foot at its furthest forward at cycle 0,
  // so the driver has to peak there too. A sine is zero at both contacts and
  // extreme at mid-stance — every limb still moves, and the walk still reads as
  // a shuffle, because the arms are a quarter of a stride out of phase with the
  // legs they are supposed to oppose.
  const rightFootLead = Math.cos(cycle * TWO_PI);
  // Contralateral: the arm on a leg's own side swings against it.
  const rightArmForward = -rightFootLead;
  const sway = traits.swayAmp * Math.sin(cycle * TWO_PI * traits.swayCycles);

  return {
    hipDrop,
    // The torso counter-rotates with the arms rather than with the pelvis, so
    // every upper-body channel rides the same driver.
    lean:
      (gait.postureLean + traits.leanBias + LEAN_SWAY * rightArmForward) *
      (profile ? 1 : FACING_LEAN_SHARE),
    sway,
    headTilt: HEAD_SWAY * rightArmForward,
    shoulderRoll: profile
      ? PROFILE_SHOULDER_ROLL
      : SHOULDER_ROLL_AMP * rightArmForward * gait.armSwingScale,
    leftFoot,
    rightFoot,
    leftArm: armAngles(-rightArmForward, armAmplitude),
    rightArm: armAngles(rightArmForward, armAmplitude),
  };
}

/**
 * Snaps a cycle clock onto one of `buckets` evenly spaced positions, returning
 * both the bucket index and a phase that lands exactly on it. The frame cache
 * keys cells on the bucket, so it needs a phase it can reproduce the pose from.
 */
export function quantizePhase(phase: number, buckets: number): { bucket: number; phase: number } {
  const withinCycle = wrapCycle(phase);
  const bucket = Math.min(buckets - 1, Math.floor(withinCycle * buckets));
  return { bucket, phase: bucket / buckets };
}

/** The pose for a person at cycle `phase`, facing `facing`, moving or not. */
export function poseForMotion(
  appearance: PersonAppearance,
  facing: Facing,
  phase: number,
  moving: boolean,
): Pose {
  return moving ? walkPose(appearance, facing, phase) : idlePose(appearance, facing, phase);
}
