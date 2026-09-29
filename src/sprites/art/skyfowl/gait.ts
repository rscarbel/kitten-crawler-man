/**
 * The skyfowl's walk and run, as a side-on model of each foot that every view
 * draws from.
 *
 * **A planted foot does not move relative to the floor.** Through its stance
 * each foot slides back through the figure's own frame at exactly the rate
 * the body travels, so the ground a cycle covers is not chosen but falls out
 * of how far ahead the foot lands and how far behind it pushes off
 * ({@link SKYFOWL_WALK_GROUND_PER_CYCLE}). The runtime advances the cycle by
 * ground actually covered divided by that number, which is what keeps the
 * talons still on the cobbles instead of skating.
 *
 * The leg is a bird's: the foot lands with the tarsus tipped forward over it,
 * rolls the hock forward over the planted toes, pushes off with the tarsus
 * trailing, then folds up tight under the body — toes curled — and swings
 * through low before reaching forward to land. The pelvis vaults over each
 * planted leg, riding no higher than that leg reaches, which is what drops it
 * at double support rather than a bob laid on top.
 *
 * Timing follows Carl's walk (ten stance frames of sixteen), the one gait in
 * this game that reads as convincing; only the leg it drives is different.
 */

import { deg, lerp } from '../carlArt';
import { splineKeys, type PathKey } from '../human/gaitShared';
import { SKYFOWL_STANDING_HIP, skyfowlHipCeiling, type SkyfowlLegPose } from './rig';

export interface SkyfowlGaitSpec {
  readonly frames: number;
  /** Frame steps each foot stays planted: the stance runs from frame 0 to this frame inclusive. */
  readonly stanceSteps: number;
  /** Where the ball of the foot lands, ahead of the hip. */
  readonly contactAhead: number;
  /** Where it leaves the floor, behind the hip. */
  readonly toeOffBehind: number;
  readonly contactTilt: number;
  readonly toeOffTilt: number;
  /** The swing's path between toe-off and the next contact, as `[phase, ahead, lift, tarsusTilt, toeCurl]` keys. */
  readonly swing: readonly (readonly [number, number, number, number, number])[];
  /** The highest the pelvis ever rides, below which each planted leg's reach holds it. */
  readonly topHip: number;
  /** How far the pelvis sinks into each landing, mid-stance, on top of what reach allows. */
  readonly stanceAbsorb: number;
  /** How high the pelvis rises in a flight phase, when no foot is down. */
  readonly flightRise: number;
}

/** The phase of the cycle at which a foot leaves the floor. */
export function toeOffPhase(spec: SkyfowlGaitSpec): number {
  return spec.stanceSteps / spec.frames;
}

/** Ground one full cycle covers, in rig units: the stance sweep over the share of the cycle it takes. */
export function groundPerCycle(spec: SkyfowlGaitSpec): number {
  return (spec.contactAhead + spec.toeOffBehind) / toeOffPhase(spec);
}

function wrap(phase: number): number {
  return ((phase % 1) + 1) % 1;
}

function stanceFoot(spec: SkyfowlGaitSpec, phase: number): SkyfowlLegPose {
  const progress = phase / toeOffPhase(spec);
  return {
    footAhead: spec.contactAhead - groundPerCycle(spec) * phase,
    footOut: 0,
    footLift: 0,
    tarsusTilt: lerp(spec.contactTilt, spec.toeOffTilt, progress),
    toeCurl: 0,
  };
}

interface SwingTracks {
  readonly ahead: readonly PathKey[];
  readonly lift: readonly PathKey[];
  readonly tilt: readonly PathKey[];
  readonly curl: readonly PathKey[];
}

/**
 * The swing's keys, bracketed by the stance's last two frames and the next
 * stance's first two, so the spline leaves the floor and lands with the
 * stance's own velocity — no hitch where swing meets stance.
 */
function swingTracks(spec: SkyfowlGaitSpec): SwingTracks {
  const framePhase = 1 / spec.frames;
  const toeOff = toeOffPhase(spec);
  const ends: readonly (readonly [number, SkyfowlLegPose])[] = [
    [toeOff - framePhase, stanceFoot(spec, toeOff - framePhase)],
    [toeOff, stanceFoot(spec, toeOff)],
  ];
  const starts: readonly (readonly [number, SkyfowlLegPose])[] = [
    [1, stanceFoot(spec, 0)],
    [1 + framePhase, stanceFoot(spec, framePhase)],
  ];
  const track = (
    fromStance: (foot: SkyfowlLegPose) => number,
    fromKey: (key: readonly [number, number, number, number, number]) => number,
  ): PathKey[] => [
    ...ends.map(([t, foot]): PathKey => [t, fromStance(foot)]),
    ...spec.swing.map((key): PathKey => [key[0], fromKey(key)]),
    ...starts.map(([t, foot]): PathKey => [t, fromStance(foot)]),
  ];
  return {
    ahead: track(
      (foot) => foot.footAhead,
      (key) => key[1],
    ),
    lift: track(
      (foot) => foot.footLift,
      (key) => key[2],
    ),
    tilt: track(
      (foot) => foot.tarsusTilt,
      (key) => key[3],
    ),
    curl: track(
      (foot) => foot.toeCurl,
      (key) => key[4],
    ),
  };
}

const SWING_TRACKS = new WeakMap<SkyfowlGaitSpec, SwingTracks>();

function tracksOf(spec: SkyfowlGaitSpec): SwingTracks {
  const known = SWING_TRACKS.get(spec);
  if (known !== undefined) return known;
  const built = swingTracks(spec);
  SWING_TRACKS.set(spec, built);
  return built;
}

/** Whether the foot on this phase of its own cycle is on the floor. */
export function footPlanted(spec: SkyfowlGaitSpec, phase: number): boolean {
  return wrap(phase) <= toeOffPhase(spec) + Number.EPSILON;
}

/** One foot of the gait at `phase` of its own cycle; 0 is that foot landing. */
export function gaitFoot(spec: SkyfowlGaitSpec, phase: number): SkyfowlLegPose {
  const cycle = wrap(phase);
  if (footPlanted(spec, cycle)) return stanceFoot(spec, Math.min(cycle, toeOffPhase(spec)));
  const tracks = tracksOf(spec);
  return {
    footAhead: splineKeys(cycle, tracks.ahead),
    footOut: 0,
    footLift: Math.max(0, splineKeys(cycle, tracks.lift)),
    tarsusTilt: splineKeys(cycle, tracks.tilt),
    toeCurl: Math.min(1, Math.max(0, splineKeys(cycle, tracks.curl))),
  };
}

/** The far foot runs half a cycle behind the near one. */
export const CONTRALATERAL_PHASE = 0.5;

/**
 * How sharp the soft minimum over the planted legs' reach is: small enough
 * that the pelvis rides each leg's arc, large enough that it hands from one
 * leg to the other without a corner.
 */
const HIP_ARC_BLEND = 0.008;

function softMin(values: readonly number[]): number {
  const floor = Math.min(...values);
  const sum = values.reduce((acc, value) => acc + Math.exp(-(value - floor) / HIP_ARC_BLEND), 0);
  return floor - HIP_ARC_BLEND * Math.log(sum);
}

/**
 * The pelvis's height at `phase` of the near foot's cycle: no higher than
 * {@link SkyfowlGaitSpec.topHip}, no higher than either planted leg can reach,
 * sinking a little into each landing, and — when neither foot is down —
 * riding a shallow arc between push-off and landing.
 */
export function gaitHipHeight(spec: SkyfowlGaitSpec, phase: number): number {
  const ceilings = [spec.topHip];
  let absorb = 0;
  const toeOff = toeOffPhase(spec);
  for (const offset of [0, CONTRALATERAL_PHASE]) {
    const cycle = wrap(phase + offset);
    if (!footPlanted(spec, cycle)) continue;
    ceilings.push(skyfowlHipCeiling(stanceFoot(spec, Math.min(cycle, toeOff))));
    absorb = Math.max(absorb, spec.stanceAbsorb * Math.sin((Math.PI * cycle) / toeOff));
  }
  if (ceilings.length === 1) {
    const flightStart = toeOff;
    const flightLength = CONTRALATERAL_PHASE - toeOff;
    const flight = ((wrap(phase) % CONTRALATERAL_PHASE) - flightStart) / flightLength;
    const arc = 4 * flight * (1 - flight);
    return spec.topHip + spec.flightRise * arc;
  }
  return softMin(ceilings) - absorb;
}

// ── The two gaits ────────────────────────────────────────────────────────────

const WALK_FRAMES = 16;
/** Ten of sixteen frames down, as Carl walks: both feet share the floor a frame either side of each landing. */
const WALK_STANCE_STEPS = 9;
const WALK_CONTACT_AHEAD = 0.24;
const WALK_TOE_OFF_BEHIND = 0.21;
/**
 * The walking pelvis rides just under standing height, so a planted leg keeps
 * a soft knee and the reach arcs, not a ceiling, set where it sits.
 */
const WALK_TOP_HIP_DROP = 0.015;

export const SKYFOWL_WALK: SkyfowlGaitSpec = {
  frames: WALK_FRAMES,
  stanceSteps: WALK_STANCE_STEPS,
  contactAhead: WALK_CONTACT_AHEAD,
  toeOffBehind: WALK_TOE_OFF_BEHIND,
  contactTilt: deg(20),
  toeOffTilt: deg(-30),
  // Peel off behind with the tarsus trailing, fold up tight under the body
  // with the toes curled, pass under the hip, and reach forward to land.
  swing: [
    [0.66, -0.17, 0.07, deg(-62), 0.75],
    [0.78, 0.02, 0.1, deg(-28), 1],
    [0.9, 0.2, 0.05, deg(12), 0.35],
  ],
  topHip: SKYFOWL_STANDING_HIP - WALK_TOP_HIP_DROP,
  stanceAbsorb: 0,
  flightRise: 0,
};

const RUN_FRAMES = 16;
/**
 * Six of sixteen frames down: each foot's stance is shorter than half the
 * cycle, so a quarter of it has both feet in the air — a run, not a fast
 * walk.
 */
const RUN_STANCE_STEPS = 5;
const RUN_CONTACT_AHEAD = 0.25;
const RUN_TOE_OFF_BEHIND = 0.27;
const RUN_CONTACT_TILT = deg(24);
const RUN_TOE_OFF_TILT = deg(-42);
/** Headroom below the lower of the two reaches the run lands and pushes off at. */
const RUN_HIP_MARGIN = 0.02;
const RUN_ABSORB = 0.03;
const RUN_FLIGHT_RISE = 0.035;

/**
 * The run's carriage height is solved, not chosen: the highest the hip can
 * sit and still put the foot down at contact and hold it at push-off, so the
 * flight arc begins and ends on a leg that actually reaches the floor.
 */
const RUN_CARRIAGE_HIP =
  Math.min(
    skyfowlHipCeiling({
      footAhead: RUN_CONTACT_AHEAD,
      footOut: 0,
      footLift: 0,
      tarsusTilt: RUN_CONTACT_TILT,
      toeCurl: 0,
    }),
    skyfowlHipCeiling({
      footAhead: -RUN_TOE_OFF_BEHIND,
      footOut: 0,
      footLift: 0,
      tarsusTilt: RUN_TOE_OFF_TILT,
      toeCurl: 0,
    }),
  ) - RUN_HIP_MARGIN;

export const SKYFOWL_RUN: SkyfowlGaitSpec = {
  frames: RUN_FRAMES,
  stanceSteps: RUN_STANCE_STEPS,
  contactAhead: RUN_CONTACT_AHEAD,
  toeOffBehind: RUN_TOE_OFF_BEHIND,
  contactTilt: RUN_CONTACT_TILT,
  toeOffTilt: RUN_TOE_OFF_TILT,
  swing: [
    [0.42, -0.22, 0.13, deg(-82), 0.9],
    [0.62, 0.0, 0.2, deg(-34), 1],
    [0.84, 0.24, 0.1, deg(16), 0.4],
  ],
  topHip: RUN_CARRIAGE_HIP,
  stanceAbsorb: RUN_ABSORB,
  flightRise: RUN_FLIGHT_RISE,
};

/** Rig units of ground one walk cycle covers. */
export const SKYFOWL_WALK_GROUND_PER_CYCLE = groundPerCycle(SKYFOWL_WALK);
/** Rig units of ground one run cycle covers. */
export const SKYFOWL_RUN_GROUND_PER_CYCLE = groundPerCycle(SKYFOWL_RUN);
