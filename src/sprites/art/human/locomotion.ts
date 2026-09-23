/**
 * Carl's locomotion rows — the run he travels in at his base speed, the slow
 * walk, and the one-shots that start and stop the run — head-on, in profile and
 * from behind.
 *
 * One rule decides nearly every number here: a foot on the floor does not move
 * relative to the floor. The sprite is carried over the ground at the player's
 * speed, and a planted foot has to slide back through the cell at exactly that
 * rate. So a cycle's stride is not chosen: it is solved from how far the leg
 * reaches at contact and at push-off, and the runtime advances the cycle by the
 * ground the player actually covers ({@link RUN_RADIANS_PER_PX},
 * {@link WALK_RADIANS_PER_PX}).
 *
 * Every view is driven from one side-on model of each foot: its ankle's
 * position ahead of the hip, its height, its pitch and whether it bears
 * weight. Profile draws that model as it is; head-on turns "ahead" into depth
 * (`CarlPose.rightFootDepth`), which the rig draws as screen height on a floor
 * foreshortened to the upright figure's view (`HEAD_ON_FLOOR_FORESHORTENING`),
 * so head-on a planted foot slides back through the cell by that share of the
 * ground covered and the legs keep their length.
 *
 * Phase 0 of every cycle is the right foot's contact, and the left foot runs
 * half a cycle behind it.
 */

import { PLAYER_SPEED, TILE_SIZE, WADE_SPEED_FACTOR } from '../../../core/constants';
import { pt, TWO_PI } from '../carl/geometry';
import {
  ANKLE_Y,
  FIGURE_HEIGHT,
  FOREARM_LENGTH,
  HIP_Y,
  LEG_ROOT_HALF,
  PROFILE_LATERAL,
  UPPER_ARM_LENGTH,
} from '../carl/proportions';
import {
  type ArmAngles,
  type BodySide,
  buildSkeleton,
  type CarlPose,
  type CarlView,
  FULL_UPPER_ARM,
  restingPose,
  setArmAngles,
  VIEWS,
} from '../carl/rig';
import { clamp01, deg, easeInOut, lerp, type Pt } from '../carlArt';
import { HUMAN_SCALE } from './figureScale';
import {
  anchorHarmonics,
  anglesThrough,
  ankleOverPivot,
  ankleReachAtKneeFlex,
  blink,
  bisect,
  BLINK_AT,
  HALF_CYCLE,
  type Harmonic,
  IDLE_FOOT_SPREAD,
  LEFT_ARM,
  legSpanAtKneeFlex,
  type PathKey,
  profileFootTarget,
  RIGHT_ARM,
  RUN_FRAME_PHASE,
  sideArmAngles,
  sideSign,
  SOLE_LENGTH,
  soleOffsets,
  TOE_AHEAD_OF_ANKLE,
  splineKeys,
  type Spring,
  springLag,
  springSettle,
  wrapPhase,
} from './gaitShared';
import { idleBack, idleFront, idleSide } from './idles';
import {
  RUN_FRAMES,
  RUN_START_FRAMES,
  RUN_STOP_FRAMES,
  TICKS_PER_SECOND,
  WALK_FRAMES,
  WALK_START_FRAMES,
  WALK_STOP_FRAMES,
} from './timing';

/** Hip joint height above the floor, standing. */
const STANDING_HIP = Math.abs(HIP_Y);
/**
 * Edge-on each hip joint sits this far ahead of (right) or behind (left) the
 * pelvis centre the gait is measured from. A stride solved for the centre
 * would over-reach by this much on one leg or the other, so every reach below
 * gives it up.
 */
const PROFILE_HIP_JOINT_OFFSET = LEG_ROOT_HALF * PROFILE_LATERAL;

/** Height of an ankle above the floor, from its figure-space y. */
function heightOf(ankle: Pt): number {
  return -ankle.y;
}

/**
 * One foot of a gait, side-on: where its ankle is relative to the point on the
 * floor under the pelvis (x ahead, figure-space y), how it is pitched, and
 * whether it bears weight.
 */
export interface GaitFoot {
  readonly ankle: Pt;
  readonly pitch: number;
  readonly planted: boolean;
}

// ── Run ──────────────────────────────────────────────────────────────────────

/**
 * Frames of each step with the foot on the floor: five of eight, so three
 * frames in every eight — 37.5% of the cycle — have both feet off the ground.
 * At his base speed, about six metres a second, a runner is airborne for a
 * third to nearly half of every step: Muybridge's runner photographed at a
 * half-mile racing pace spends two of every six frames of a step clear of the
 * floor and lands and leaves between frames. The long flight is also what
 * carries the stride: at a jog's short flight the same speed needs a cadence
 * of over two hundred steps a minute.
 */
const RUN_STANCE_FRAMES = 5;
/** Frame-to-frame steps the planted foot is carried back through. */
const RUN_STANCE_STEPS = RUN_STANCE_FRAMES - 1;
/** Where in the cycle the right foot pushes off: the last frame it is down. */
export const RUN_TOE_OFF_PHASE = RUN_STANCE_STEPS / RUN_FRAMES;

/**
 * A runner carries his hips lower than he stands — the legs never straighten
 * fully under load. The hip height at contact and at push-off, as a share of
 * the standing height.
 */
const RUN_HIP_CARRIAGE = 0.94;
const RUN_CARRIAGE_HIP = STANDING_HIP * RUN_HIP_CARRIAGE;
/**
 * How far the pelvis sinks after contact, bottoming out at mid-stance, as the
 * knee absorbs the landing. A runner's centre of mass rises and falls about
 * 3–4% of his height a step.
 */
const RUN_ABSORB = 0.03;
/**
 * How far the pelvis rises above its carriage at the top of the flight. Not
 * chosen: the flight is a ballistic arc, and it has to leave the floor as fast
 * as the stance's absorb was rising at push-off, or the pelvis kinks there.
 */
const RUN_FLIGHT_RISE =
  (RUN_ABSORB * Math.PI * (HALF_CYCLE - RUN_TOE_OFF_PHASE)) / (4 * RUN_TOE_OFF_PHASE);

/**
 * Contact is on the forefoot, toes a little down, with the knee already well
 * bent — the leg lands nearly under the hips and gives, rather than reaching
 * out on a straight leg to strike with the heel.
 */
const RUN_CONTACT_PITCH = deg(8);
const RUN_CONTACT_KNEE_FLEX = deg(32);
/**
 * Push-off is up on the toes with the heel high and the knee nearly straight:
 * the foot is the last lever the stride has, and a runner's leaves the floor
 * pointing nearly down. The steep toe carries the push-off further behind the
 * hips, which is what lets contact land close under them without shortening
 * the ground a stride covers.
 */
const RUN_TOE_OFF_PITCH = deg(74);
const RUN_TOE_OFF_KNEE_FLEX = deg(6);

/** How far ahead of the pelvis the ankle lands. */
const RUN_CONTACT_ANKLE_AHEAD =
  ankleReachAtKneeFlex(
    RUN_CONTACT_KNEE_FLEX,
    RUN_CARRIAGE_HIP,
    heightOf(ankleOverPivot(0, 'toe', RUN_CONTACT_PITCH)),
  ) - PROFILE_HIP_JOINT_OFFSET;
/** How far behind the pelvis the ankle is as the toe leaves the floor. */
const RUN_TOE_OFF_ANKLE_BEHIND =
  ankleReachAtKneeFlex(
    RUN_TOE_OFF_KNEE_FLEX,
    RUN_CARRIAGE_HIP,
    heightOf(ankleOverPivot(0, 'toe', RUN_TOE_OFF_PITCH)),
  ) - PROFILE_HIP_JOINT_OFFSET;

/** Where the planted toe is, relative to the pelvis, at contact and at push-off. */
const RUN_CONTACT_TOE = RUN_CONTACT_ANKLE_AHEAD + soleOffsets(RUN_CONTACT_PITCH).toe.x;
const RUN_TOE_OFF_TOE = -RUN_TOE_OFF_ANKLE_BEHIND + soleOffsets(RUN_TOE_OFF_PITCH).toe.x;

/**
 * Ground the body covers per frame of the run, in figure units: everything
 * the planted toe sweeps through between contact and push-off, shared over the
 * frames of stance. The flight covers ground too, at the same rate, so this
 * is the rate for the whole cycle.
 */
const RUN_GROUND_PER_FRAME = (RUN_CONTACT_TOE - RUN_TOE_OFF_TOE) / RUN_STANCE_STEPS;
/** Ground covered by one full run cycle — two steps — in figure units. */
const RUN_GROUND_PER_CYCLE = RUN_GROUND_PER_FRAME * RUN_FRAMES;

/**
 * Pitch of the planted foot through the stance, keyed on the stance's own
 * progress: it lands a little toe-down, the heel settles, it stays flat under
 * the body, and the heel peels up into the push-off.
 */
const RUN_STANCE_PITCH: readonly PathKey[] = [
  [0, RUN_CONTACT_PITCH],
  [0.25, 0],
  [0.45, 0],
  [0.8, deg(36)],
  [1, RUN_TOE_OFF_PITCH],
];

/**
 * The swing, side-on: the ankle's distance ahead of the pelvis and height off
 * the floor. After push-off the heel is thrown up behind toward the seat, the
 * knee drives through under it, the lower leg unfolds forward, and the foot
 * paws back down onto the floor under the hips. Matched against a lateral
 * running plate at a half-mile pace.
 */
const RUN_SWING_KICK_AT = 0.36;
const RUN_SWING_RECOVERY_AT = 0.52;
const RUN_SWING_DRIVE_AT = 0.68;
const RUN_SWING_REACH_AT = 0.84;
const RUN_SWING_PAW_AT = 0.94;

const RUN_SWING_X: readonly PathKey[] = [
  [RUN_SWING_KICK_AT, -0.58],
  [RUN_SWING_RECOVERY_AT, -0.3],
  [RUN_SWING_DRIVE_AT, 0.1],
  [RUN_SWING_REACH_AT, 0.36],
  [RUN_SWING_PAW_AT, 0.34],
];
/**
 * At the top of the knee drive the thigh is near level with the shin hanging
 * under it, so the ankle rides high out in front before the foot is pawed back
 * and down.
 */
const RUN_SWING_HEIGHT: readonly PathKey[] = [
  [RUN_SWING_KICK_AT, 0.36],
  [RUN_SWING_RECOVERY_AT, 0.63],
  [RUN_SWING_DRIVE_AT, 0.56],
  [RUN_SWING_REACH_AT, 0.34],
  [RUN_SWING_PAW_AT, 0.2],
];
const RUN_SWING_PITCH: readonly PathKey[] = [
  [RUN_SWING_KICK_AT, deg(62)],
  [RUN_SWING_RECOVERY_AT, deg(60)],
  [RUN_SWING_DRIVE_AT, deg(28)],
  [RUN_SWING_REACH_AT, deg(2)],
  [RUN_SWING_PAW_AT, deg(6)],
];

/** The run's planted foot at `phase` of its own stance, `0 ≤ phase ≤ RUN_TOE_OFF_PHASE`. */
function runStanceFoot(phase: number): GaitFoot {
  const toe = RUN_CONTACT_TOE - RUN_GROUND_PER_CYCLE * phase;
  const pitch = splineKeys(phase / RUN_TOE_OFF_PHASE, RUN_STANCE_PITCH);
  return { ankle: ankleOverPivot(toe, 'toe', pitch), pitch, planted: true };
}

/**
 * A swing path's keys with the stance's own motion either side of it, so the
 * spline leaves the floor and comes back to it at the speed and angle the
 * planted foot was moving at — no kink at push-off or at contact.
 */
function withStanceEnds(
  keys: readonly PathKey[],
  read: (foot: GaitFoot) => number,
): readonly PathKey[] {
  const beforeToeOff = runStanceFoot(RUN_TOE_OFF_PHASE - RUN_FRAME_PHASE);
  const toeOff = runStanceFoot(RUN_TOE_OFF_PHASE);
  const contact = runStanceFoot(0);
  const afterContact = runStanceFoot(RUN_FRAME_PHASE);
  return [
    [RUN_TOE_OFF_PHASE - RUN_FRAME_PHASE, read(beforeToeOff)],
    [RUN_TOE_OFF_PHASE, read(toeOff)],
    ...keys,
    [1, read(contact)],
    [1 + RUN_FRAME_PHASE, read(afterContact)],
  ];
}

const RUN_SWING_PATH_X = withStanceEnds(RUN_SWING_X, (foot) => foot.ankle.x);
const RUN_SWING_PATH_Y = withStanceEnds(
  RUN_SWING_HEIGHT.map(([t, height]): PathKey => [t, -height]),
  (foot) => foot.ankle.y,
);
const RUN_SWING_PATH_PITCH = withStanceEnds(RUN_SWING_PITCH, (foot) => foot.pitch);

/** The right foot of the run at `phase`; the left foot is the same half a cycle later. */
export function runFoot(phase: number): GaitFoot {
  const cycle = wrapPhase(phase);
  if (cycle <= RUN_TOE_OFF_PHASE) return runStanceFoot(cycle);
  return {
    ankle: pt(splineKeys(cycle, RUN_SWING_PATH_X), splineKeys(cycle, RUN_SWING_PATH_Y)),
    pitch: splineKeys(cycle, RUN_SWING_PATH_PITCH),
    planted: false,
  };
}

/**
 * The pelvis's height above the floor at `phase`. Each step it sinks after
 * contact to the bottom of the absorb at mid-stance, rises through push-off
 * and flies a ballistic arc to the next contact.
 */
function runHipHeight(phase: number): number {
  const step = wrapPhase(phase) % HALF_CYCLE;
  if (step <= RUN_TOE_OFF_PHASE) {
    return RUN_CARRIAGE_HIP - RUN_ABSORB * Math.sin((Math.PI * step) / RUN_TOE_OFF_PHASE);
  }
  const flight = (step - RUN_TOE_OFF_PHASE) / (HALF_CYCLE - RUN_TOE_OFF_PHASE);
  return RUN_CARRIAGE_HIP + RUN_FLIGHT_RISE * 4 * flight * (1 - flight);
}

/** Middle of the right foot's stance, where his weight is squarely over it. */
const RUN_MID_STANCE = RUN_TOE_OFF_PHASE / 2;

// ── Walk ─────────────────────────────────────────────────────────────────────

/**
 * Frames each foot is on the floor: ten of sixteen, a stance of 62% — a
 * walker's foot is down for about three fifths of the cycle, so both feet are
 * down together for a frame either side of each contact.
 */
const WALK_STANCE_FRAMES = 10;
const WALK_STANCE_STEPS = WALK_STANCE_FRAMES - 1;
const WALK_TOE_OFF_PHASE = WALK_STANCE_STEPS / WALK_FRAMES;

/** A walker's knee is fixed nearly straight as the heel strikes. */
const WALK_HEEL_STRIKE_PITCH = deg(-15);
const WALK_HEEL_STRIKE_KNEE_FLEX = deg(6);
/**
 * The knee is already folding as the toe leaves the floor: by push-off it is
 * about a third of the way to the swing's full bend.
 */
const WALK_TOE_OFF_PITCH = deg(45);
const WALK_TOE_OFF_KNEE_FLEX = deg(30);
/**
 * The pelvis is lowest at double support, with both legs spread, and that
 * is where the stride's reach is measured. A walker's centre of mass rises and
 * falls about 2–3% of his height a stride.
 */
const WALK_PELVIS_DROP = 0.045;
const WALK_CONTACT_HIP = STANDING_HIP - WALK_PELVIS_DROP;

const WALK_HEEL_STRIKE_ANKLE_AHEAD =
  ankleReachAtKneeFlex(
    WALK_HEEL_STRIKE_KNEE_FLEX,
    WALK_CONTACT_HIP,
    heightOf(ankleOverPivot(0, 'heel', WALK_HEEL_STRIKE_PITCH)),
  ) - PROFILE_HIP_JOINT_OFFSET;
const WALK_TOE_OFF_ANKLE_BEHIND =
  ankleReachAtKneeFlex(
    WALK_TOE_OFF_KNEE_FLEX,
    WALK_CONTACT_HIP,
    heightOf(ankleOverPivot(0, 'toe', WALK_TOE_OFF_PITCH)),
  ) - PROFILE_HIP_JOINT_OFFSET;

/** Where the striking heel lands, ahead of the pelvis. */
const WALK_HEEL_STRIKE_HEEL =
  WALK_HEEL_STRIKE_ANKLE_AHEAD + soleOffsets(WALK_HEEL_STRIKE_PITCH).heel.x;
/** Where the pushing toe is as it leaves the floor, behind the pelvis. */
const WALK_TOE_OFF_TOE = -WALK_TOE_OFF_ANKLE_BEHIND + soleOffsets(WALK_TOE_OFF_PITCH).toe.x;

/**
 * Ground covered per frame of the walk, in figure units. The foot rolls heel
 * to toe, so the body travels the heel's lead, the length of the sole, and the
 * toe's trail between strike and push-off.
 */
const WALK_GROUND_PER_FRAME =
  (WALK_HEEL_STRIKE_HEEL + SOLE_LENGTH - WALK_TOE_OFF_TOE) / WALK_STANCE_STEPS;
const WALK_GROUND_PER_CYCLE = WALK_GROUND_PER_FRAME * WALK_FRAMES;

/**
 * Pitch of the walking foot through its stance: heel strike toes-up, rolled
 * flat, heel off late in stance, and up onto the toes to push off.
 */
const WALK_HEEL_FLAT_AT = 0.18;
const WALK_HEEL_OFF_AT = 0.5;
const WALK_STANCE_PITCH: readonly PathKey[] = [
  [0, WALK_HEEL_STRIKE_PITCH],
  [WALK_HEEL_FLAT_AT, 0],
  [WALK_HEEL_OFF_AT, 0],
  [1, WALK_TOE_OFF_PITCH],
];
/**
 * The knee bend each stance leg holds, keyed on the stance's progress: nearly
 * straight from heel strike through mid-stance — the leg vaults the body over
 * it — and folding into push-off.
 */
const WALK_STANCE_KNEE_FLEX: readonly PathKey[] = [
  [0, WALK_HEEL_STRIKE_KNEE_FLEX],
  [0.5, WALK_HEEL_STRIKE_KNEE_FLEX],
  [1, WALK_TOE_OFF_KNEE_FLEX],
];

const WALK_FRAME_PHASE = 1 / WALK_FRAMES;

function walkStanceFoot(phase: number): GaitFoot {
  const u = phase / WALK_TOE_OFF_PHASE;
  const pitch = splineKeys(u, WALK_STANCE_PITCH);
  const heel = WALK_HEEL_STRIKE_HEEL - WALK_GROUND_PER_CYCLE * phase;
  // A pitched-up foot rocks on its heel, a pitched-down one on its toe; flat,
  // both give the same ankle.
  const ankle =
    pitch < 0
      ? ankleOverPivot(heel, 'heel', pitch)
      : ankleOverPivot(heel + SOLE_LENGTH, 'toe', pitch);
  return { ankle, pitch, planted: true };
}

/**
 * The walking swing: the foot peels off behind, tucks up with the knee
 * folded, passes low under the hip, and the leg straightens forward to strike
 * with the heel. A swing that travels forward straight-kneed is a goose step;
 * the tuck is what makes it a walk.
 */
const WALK_SWING_TUCK_AT = 0.66;
const WALK_SWING_PASS_AT = 0.78;
const WALK_SWING_REACH_AT = 0.9;
const WALK_SWING_X: readonly PathKey[] = [
  [WALK_SWING_TUCK_AT, -0.3],
  [WALK_SWING_PASS_AT, -0.02],
  [WALK_SWING_REACH_AT, 0.2],
];
const WALK_SWING_HEIGHT: readonly PathKey[] = [
  [WALK_SWING_TUCK_AT, 0.28],
  [WALK_SWING_PASS_AT, 0.2],
  [WALK_SWING_REACH_AT, 0.13],
];
const WALK_SWING_PITCH: readonly PathKey[] = [
  [WALK_SWING_TUCK_AT, deg(35)],
  [WALK_SWING_PASS_AT, deg(8)],
  [WALK_SWING_REACH_AT, deg(-10)],
];

function withWalkStanceEnds(
  keys: readonly PathKey[],
  read: (foot: GaitFoot) => number,
): readonly PathKey[] {
  return [
    [
      WALK_TOE_OFF_PHASE - WALK_FRAME_PHASE,
      read(walkStanceFoot(WALK_TOE_OFF_PHASE - WALK_FRAME_PHASE)),
    ],
    [WALK_TOE_OFF_PHASE, read(walkStanceFoot(WALK_TOE_OFF_PHASE))],
    ...keys,
    [1, read(walkStanceFoot(0))],
    [1 + WALK_FRAME_PHASE, read(walkStanceFoot(WALK_FRAME_PHASE))],
  ];
}

const WALK_SWING_PATH_X = withWalkStanceEnds(WALK_SWING_X, (foot) => foot.ankle.x);
const WALK_SWING_PATH_Y = withWalkStanceEnds(
  WALK_SWING_HEIGHT.map(([t, height]): PathKey => [t, -height]),
  (foot) => foot.ankle.y,
);
const WALK_SWING_PATH_PITCH = withWalkStanceEnds(WALK_SWING_PITCH, (foot) => foot.pitch);

/** The right foot of the walk at `phase`; the left is the same half a cycle later. */
function walkFoot(phase: number): GaitFoot {
  const cycle = wrapPhase(phase);
  if (cycle <= WALK_TOE_OFF_PHASE) return walkStanceFoot(cycle);
  return {
    ankle: pt(splineKeys(cycle, WALK_SWING_PATH_X), splineKeys(cycle, WALK_SWING_PATH_Y)),
    pitch: splineKeys(cycle, WALK_SWING_PATH_PITCH),
    planted: false,
  };
}

/**
 * The highest the pelvis stands through the walk: a hair under straight, the
 * same softness his idle stands with, so the leg keeps its headroom.
 */
const WALK_TOP_HIP = STANDING_HIP - 0.006;
/**
 * How sharp the soft minimum below is, in figure units: small enough that the
 * pelvis rides each leg's arc, large enough that it hands from one to the
 * other without a corner.
 */
const WALK_ARC_BLEND = 0.008;

/**
 * The walking pelvis vaults over each planted leg: it can stand no higher than
 * that leg reaches at the knee bend it holds at this point of its stance, and
 * with two feet down it rides the lower of the two arcs. That is what drops it
 * at contact — both legs spread, neither reaching straight up — rather than a
 * bob laid on top.
 */
function walkHipHeight(phase: number): number {
  const ceilings = [WALK_TOP_HIP];
  for (const [offset, jointAhead] of [
    [0, PROFILE_HIP_JOINT_OFFSET],
    [HALF_CYCLE, -PROFILE_HIP_JOINT_OFFSET],
  ] as const) {
    const cycle = wrapPhase(phase + offset);
    if (cycle > WALK_TOE_OFF_PHASE) continue;
    const foot = walkStanceFoot(cycle);
    const flex = splineKeys(cycle / WALK_TOE_OFF_PHASE, WALK_STANCE_KNEE_FLEX);
    const span = legSpanAtKneeFlex(flex);
    // Head-on the hip joint has no fore-and-aft offset at all, so the arc is
    // held to whichever of the two views asks the leg to reach further.
    const out = Math.max(Math.abs(foot.ankle.x - jointAhead), Math.abs(foot.ankle.x));
    ceilings.push(heightOf(foot.ankle) + Math.sqrt(Math.max(0, span * span - out * out)));
  }
  const floor = Math.min(...ceilings);
  const sum = ceilings.reduce((acc, h) => acc + Math.exp(-(h - floor) / WALK_ARC_BLEND), 0);
  return floor - WALK_ARC_BLEND * Math.log(sum);
}

const WALK_MID_STANCE = WALK_TOE_OFF_PHASE / 2;

// ── Runtime pacing ───────────────────────────────────────────────────────────

/** World pixels one figure unit spans: a tile is `TILE_SIZE` px, and a figure unit is `HUMAN_SCALE` of one. */
const WORLD_PX_PER_UNIT = TILE_SIZE * HUMAN_SCALE;

/** Ground a run cycle covers in the world, in pixels. */
export const RUN_GROUND_PER_CYCLE_PX = RUN_GROUND_PER_CYCLE * WORLD_PX_PER_UNIT;
/** Ground a walk cycle covers in the world, in pixels. */
export const WALK_GROUND_PER_CYCLE_PX = WALK_GROUND_PER_CYCLE * WORLD_PX_PER_UNIT;

/**
 * How far the run's phase turns, in radians, for every world pixel he actually
 * covers. One cycle has to cover exactly the ground the planted foot sweeps,
 * or the foot skates; so this is a full turn over {@link RUN_GROUND_PER_CYCLE_PX}
 * and nothing else. At his base speed that is a cycle of just over half a
 * second — about 220 steps a minute, a fast runner's cadence — and about two
 * game ticks for each of its sixteen frames, so the row is played
 * frame by frame rather than skipped through.
 */
export const RUN_RADIANS_PER_PX = TWO_PI / RUN_GROUND_PER_CYCLE_PX;
/** The walk's phase per world pixel, derived from its own stride the same way. */
export const WALK_RADIANS_PER_PX = TWO_PI / WALK_GROUND_PER_CYCLE_PX;

/**
 * The most ground one tick may advance the gait by, in world pixels: one run
 * frame's worth. The phase is paced by ground actually covered, and a
 * separation shove or a knockback covers ground several times faster than he
 * can run — uncapped, the legs would skip whole frames of the row and strobe.
 * Capped at one frame a tick, the row is always played, never skipped through.
 */
export const MAX_GAIT_ADVANCE_PX_PER_TICK = RUN_GROUND_PER_CYCLE_PX / RUN_FRAMES;

/**
 * Walk to run and back, by measured ground speed, with a gap between the two
 * so the row does not flicker at the threshold.
 *
 * People change gait at a Froude number `v² / (g · leg)` of about 0.5, running
 * above it and walking below; the change back happens a little lower than the
 * change up. At his scale — 6'3" standing {@link FIGURE_HEIGHT_TILES} tiles
 * tall, a leg of {@link STANDING_HIP} figure units — that puts both thresholds
 * a little over a third of his base speed. A wade (`WADE_SPEED_FACTOR` of it)
 * falls just under the change back, so wading is always a walk.
 */
const CARL_HEIGHT_METRES = 1.905;
const GRAVITY_METRES_PER_SECOND_SQ = 9.81;
const RUN_ENTER_FROUDE = 0.6;
const RUN_EXIT_FROUDE = 0.55;
const FIGURE_HEIGHT_TILES = FIGURE_HEIGHT * HUMAN_SCALE;
const METRES_PER_WORLD_PX = CARL_HEIGHT_METRES / (FIGURE_HEIGHT_TILES * TILE_SIZE);
const LEG_METRES = STANDING_HIP * WORLD_PX_PER_UNIT * METRES_PER_WORLD_PX;

function froudeSpeedPxPerTick(froude: number): number {
  const metresPerSecond = Math.sqrt(froude * GRAVITY_METRES_PER_SECOND_SQ * LEG_METRES);
  return metresPerSecond / METRES_PER_WORLD_PX / TICKS_PER_SECOND;
}

/** Measured ground speed at or above which a walk turns into a run. */
export const RUN_SPEED_ENTER_PX_PER_TICK = froudeSpeedPxPerTick(RUN_ENTER_FROUDE);
/** Measured ground speed below which a run drops back to a walk. */
export const RUN_SPEED_EXIT_PX_PER_TICK = froudeSpeedPxPerTick(RUN_EXIT_FROUDE);

// ── Secondary motion ─────────────────────────────────────────────────────────

/**
 * Loose parts hang on springs whose stiffness is a property of the part, in
 * swings per second. The row's phase is distance-driven, so a loop's duration
 * depends on speed; these are set for the speed each gait is made for.
 */
interface SpringSpec {
  readonly hertz: number;
  readonly damping: number;
}
/** Heavy leather sways slowly and settles in a couple of swings. */
const JACKET_HEM_SPRING: SpringSpec = { hertz: 3, damping: 0.45 };
/** Loose cotton is quicker and livelier than the leather. */
const BOXER_CUFF_SPRING: SpringSpec = { hertz: 5, damping: 0.3 };
/** Short hair is stiff: it only twitches, and settles fast. */
const HAIR_SPRING: SpringSpec = { hertz: 6, damping: 0.4 };

/**
 * How many samples round the loop the anchor paths are measured at. The
 * spring only ever sees the harmonics a row can draw, so this only needs to
 * resolve those cleanly.
 */
const ANCHOR_SAMPLES = 64;
/** How far down the thigh a boxer leg's cuff sits, as a share of the thigh. */
const CUFF_ALONG_THIGH = 0.3;
/**
 * The drag of the air on the jacket's hem at a run, trailing it straight back
 * — the hem flares behind him for as long as he is running.
 */
const RUN_JACKET_DRAG = 0.02;

function springFor(spec: SpringSpec, loopSeconds: number): Spring {
  return { naturalCycles: spec.hertz * loopSeconds, damping: spec.damping };
}

interface AnchorSeries {
  readonly x: Harmonic[];
  readonly y: Harmonic[];
}

function seriesOf(points: readonly Pt[], frames: number): AnchorSeries {
  return {
    x: anchorHarmonics(
      points.map((p) => p.x),
      frames,
    ),
    y: anchorHarmonics(
      points.map((p) => p.y),
      frames,
    ),
  };
}

function lagOf(series: AnchorSeries, phase: number, spring: Spring): Pt {
  return pt(springLag(series.x, phase, spring), springLag(series.y, phase, spring));
}

/** The anchors every loose part hangs from, measured round one loop of a row. */
interface SecondaryAnchors {
  readonly waist: AnchorSeries;
  readonly leftCuff: AnchorSeries;
  readonly rightCuff: AnchorSeries;
  readonly head: AnchorSeries;
}

function measureAnchors(
  base: (phase: number) => CarlPose,
  view: CarlView,
  frames: number,
): SecondaryAnchors {
  const skeletons = Array.from({ length: ANCHOR_SAMPLES }, (_unused, i) =>
    buildSkeleton(base(i / ANCHOR_SAMPLES), VIEWS[view]),
  );
  const cuff = (root: Pt, knee: Pt): Pt =>
    pt(lerp(root.x, knee.x, CUFF_ALONG_THIGH), lerp(root.y, knee.y, CUFF_ALONG_THIGH));
  return {
    waist: seriesOf(
      skeletons.map((s) => s.waist),
      frames,
    ),
    leftCuff: seriesOf(
      skeletons.map((s) => cuff(s.leftLeg.root, s.leftLeg.joint)),
      frames,
    ),
    rightCuff: seriesOf(
      skeletons.map((s) => cuff(s.rightLeg.root, s.rightLeg.joint)),
      frames,
    ),
    head: seriesOf(
      skeletons.map((s) => s.headCentre),
      frames,
    ),
  };
}

interface SecondarySprings {
  readonly jacket: Spring;
  readonly cuff: Spring;
  readonly hair: Spring;
}

function springsFor(loopSeconds: number): SecondarySprings {
  return {
    jacket: springFor(JACKET_HEM_SPRING, loopSeconds),
    cuff: springFor(BOXER_CUFF_SPRING, loopSeconds),
    hair: springFor(HAIR_SPRING, loopSeconds),
  };
}

function applySecondary(
  pose: CarlPose,
  anchors: SecondaryAnchors,
  springs: SecondarySprings,
  phase: number,
  drag: Pt,
): void {
  const hem = lagOf(anchors.waist, phase, springs.jacket);
  pose.jacketHemLag = pt(hem.x + drag.x, hem.y + drag.y);
  pose.leftBoxerFlutter = lagOf(anchors.leftCuff, phase, springs.cuff);
  pose.rightBoxerFlutter = lagOf(anchors.rightCuff, phase, springs.cuff);
  pose.hairTuftLag = lagOf(anchors.head, phase, springs.hair);
}

// ── Poses shared by every view ───────────────────────────────────────────────

/** A loosely closed runner's fist: curled, never clenched. */
const LOOSE_FIST = 0.6;
const WALK_FIST = 0.55;
const LOCOMOTION_BROW = 0.6;

/** The run's forward lean, from the ankles, and how much push-off adds to it. */
const RUN_LEAN = deg(7);
const RUN_LEAN_PUMP = deg(1.5);
/**
 * The head keeps the eyes level: it tips back by as much as the torso pumps
 * forward, so only the body rocks.
 */
const RUN_HEAD_STEADY = 1;
const WALK_LEAN = deg(3);

/**
 * Edge-on the shoulders turn against the pelvis: the right shoulder swings back
 * as the right leg swings forward. Seen as the width shift `twist` draws.
 */
const RUN_SHOULDER_TWIST = 0.2;
const WALK_SHOULDER_TWIST = 0.1;

/** How much the torso pumps at the given phase, 0 at contact, 1 at push-off. */
function runPump(phase: number): number {
  const step = wrapPhase(phase) % HALF_CYCLE;
  return Math.sin((Math.PI * step) / HALF_CYCLE);
}

/** Right foot forward (+1) to left foot forward (−1), as the arms counter it. */
function legSwing(phase: number): number {
  return Math.cos(phase * TWO_PI);
}

// ── Run arms ─────────────────────────────────────────────────────────────────

/**
 * A running arm edge-on: driven from the shoulder, the elbow opening as it
 * swings back and closing as it comes forward. At the back of the swing the
 * arm is nearly straight, the fist well behind the seat; at the front the
 * elbow is folded past a right angle and the fist is up at the chin, ahead of
 * the chest. That opening and closing is what makes the arm read as pumping
 * rather than held at a guard — a forearm that stays level at the same bend
 * all the way round reads as a boxer's hands carried along.
 */
const RUN_ARM_FORWARD = deg(55);
/**
 * Far enough back that the fist trails clear behind the seat: edge-on the
 * torso hides any backswing short of that, and the far arm's fist, forward at
 * the same moment, then reads as the only arm moving.
 */
const RUN_ARM_BACK = deg(60);
/** Nearly straight at the back of the swing, so the fist trails out behind him. */
const RUN_ELBOW_FLEX = deg(30);
/** The elbow closes as the arm comes forward, bringing the fist up to the chin. */
const RUN_ELBOW_PUMP = deg(75);

/** Shoulder swing from `forward` (−1 back to 1 forward), centred so it runs smoothly through vertical. */
function runUpperArmAngle(forward: number): number {
  const centre = (RUN_ARM_FORWARD - RUN_ARM_BACK) / 2;
  const amplitude = (RUN_ARM_FORWARD + RUN_ARM_BACK) / 2;
  return centre + amplitude * forward;
}

function runElbowFlex(forward: number): number {
  return RUN_ELBOW_FLEX + (RUN_ELBOW_PUMP * (forward + 1)) / 2;
}

function runSideArm(forward: number): ArmAngles {
  const upper = runUpperArmAngle(forward);
  return { upper, fore: upper + runElbowFlex(forward), foreScale: 1 };
}

/**
 * One head-on swinging arm, solved in three dimensions and drawn by its
 * projection: the swing is fore and aft, which the upright figure shows as
 * the arm's segments shortening as they turn toward or away from the camera,
 * the elbow riding out as the arm goes back and the fist crossing in and up
 * as it comes forward.
 *
 * - `forward` / `back`: the shoulder's swing at either end, in radians from
 *   hanging straight down.
 * - `flexBack` / `flexForward`: the elbow's bend at either end.
 * - `elbowOutBack` / `elbowOutForward`: how far out from the body the upper
 *   arm rides.
 * - `forearmInBack` / `forearmInForward`: how far in across the body the
 *   forearm turns from the elbow.
 */
interface FacingSwing {
  readonly forward: number;
  readonly back: number;
  readonly flexBack: number;
  readonly flexForward: number;
  readonly elbowOutBack: number;
  readonly elbowOutForward: number;
  readonly forearmInBack: number;
  readonly forearmInForward: number;
}

/**
 * The run head-on. A runner's fist comes up to the chest and in toward the
 * sternum at the front of the swing and the elbow drives out and back at the
 * rear, and it is the difference between the two sides — one fist high and
 * in, the other low and out past the hip — that says the arms are pumping.
 * Swung only as far as a real runner's, the two ends differ by a pixel or two
 * at the tile and the arms read as held still, so the swing is pushed well
 * past life, and the upper arm is drawn at its projected length: at full
 * length an upper arm swung toward or away from the camera stands out
 * sideways and the pair reads as a bodybuilder's lat spread.
 */
const RUN_FACING_SWING: FacingSwing = {
  forward: deg(70),
  back: deg(75),
  flexBack: deg(80),
  flexForward: deg(85),
  elbowOutBack: deg(22),
  elbowOutForward: deg(6),
  forearmInBack: deg(-10),
  forearmInForward: deg(45),
};

/**
 * The walk head-on: a looser, lower swing than the run, the elbow bent enough
 * that the forearm shortens and the hand rises visibly at the front of each
 * swing. A walking arm swung straight reads as a hang that jiggles.
 */
const WALK_FACING_SWING: FacingSwing = {
  forward: deg(45),
  back: deg(30),
  flexBack: deg(15),
  flexForward: deg(70),
  elbowOutBack: deg(16),
  elbowOutForward: deg(7),
  forearmInBack: deg(-4),
  forearmInForward: deg(22),
};

/** An arm posed head-on: its joint angles, the drawn share of its upper arm, and how far ahead of the chest its hand is. */
interface FacingArm {
  readonly angles: ArmAngles;
  readonly upperScale: number;
  readonly handDepth: number;
}

/** A head-on arm of `swing`, `forward` running −1 at the back of its swing to 1 at the front. */
function facingSwingArm(side: number, forward: number, swing: FacingSwing): FacingArm {
  const ahead = (forward + 1) / 2;
  const centre = (swing.forward - swing.back) / 2;
  const amplitude = (swing.forward + swing.back) / 2;
  const shoulder = centre + amplitude * forward;
  const forearmPitch = shoulder + lerp(swing.flexBack, swing.flexForward, ahead);
  const elbowOut = lerp(swing.elbowOutBack, swing.elbowOutForward, ahead);
  const forearmIn = lerp(swing.forearmInBack, swing.forearmInForward, ahead);
  const upperAcross = side * Math.sin(elbowOut);
  const upperDown = Math.cos(elbowOut) * Math.cos(shoulder);
  const upperAhead = Math.cos(elbowOut) * Math.sin(shoulder);
  const foreAcross = -side * Math.sin(forearmIn);
  const foreDown = Math.cos(forearmIn) * Math.cos(forearmPitch);
  const foreAhead = Math.cos(forearmIn) * Math.sin(forearmPitch);
  return {
    angles: {
      upper: Math.atan2(upperAcross, upperDown),
      fore: Math.atan2(foreAcross, foreDown),
      foreScale: Math.hypot(foreAcross, foreDown),
    },
    upperScale: Math.hypot(upperAcross, upperDown),
    handDepth: UPPER_ARM_LENGTH * upperAhead + FOREARM_LENGTH * foreAhead,
  };
}

function runFacingArm(side: number, forward: number): FacingArm {
  return facingSwingArm(side, forward, RUN_FACING_SWING);
}

/** Lays both head-on arms on a pose; `rightForward` is the right arm's swing, −1 back to 1 forward. */
function setFacingArms(
  pose: CarlPose,
  rightForward: number,
  arm: (side: number, forward: number) => FacingArm,
): void {
  const right = arm(RIGHT_ARM, rightForward);
  const left = arm(LEFT_ARM, -rightForward);
  setArmAngles(pose, 'right', right.angles, right.upperScale);
  setArmAngles(pose, 'left', left.angles, left.upperScale);
  pose.rightHandDepth = right.handDepth;
  pose.leftHandDepth = left.handDepth;
}

// ── Head-on ──────────────────────────────────────────────────────────────────

/**
 * Head-on, how far out from the centreline each foot tracks. A runner's feet
 * land nearer the line than a walker's, but not on it: at the 32 px tile two
 * legs a hair apart merge into one column and read as a stilt.
 */
export const RUN_FOOT_SPREAD = 0.1;
/**
 * How a gait's feet are laid out head-on, beyond their side-on paths.
 *
 * - `swingFlare`: how much further out than its track a foot rides at the top
 *   of its swing, scaled by its lift so a foot on the floor never moves
 *   sideways.
 * - `kickLift`: how much the lift of a swinging foot behind the hip is
 *   multiplied by.
 * - `reachLift`: the same for a swinging foot ahead of the hip.
 *
 * Head-on the floor's depth barely shows, so a swinging foot's only mark on
 * the screen is its lift. Side-on a runner in flight has one foot kicked up
 * behind and the other reaching ahead, both a little off the floor, and the
 * split between them is what reads as flight; head-on that split is gone and
 * two feet a little off the floor under bent knees read as a squat. Muybridge's
 * oncoming runner shows what the camera sees instead: the heel flicked up out
 * of sight behind him and the landing leg reaching long for the floor.
 */
interface FacingTrack {
  readonly swingFlare: number;
  readonly kickLift: number;
  readonly reachLift: number;
}

/**
 * The run seen head-on.
 *
 * The heel recovers up and a little out behind the hip, the way Muybridge's
 * oncoming runner flicks it, so the swinging shin is drawn beside the planted
 * leg rather than hidden behind it: legs sharing one column read as a hop on
 * one leg.
 */
const RUN_FACING_TRACK: FacingTrack = { swingFlare: 0.2, kickLift: 1.6, reachLift: 0.45 };
/**
 * How far behind the hip a recovering foot rides fully flared. The flare is
 * the heel's, kicked up behind him; it has mostly gone by the time the foot
 * swings under the hip, so a foot in the air on each side never splays both
 * legs into a squat.
 */
const RECOVERY_FLARE_DEPTH = 0.3;
/**
 * The share of the flare a foot keeps once it has swung under and ahead of
 * the hip: enough that the driving knee stays beside the other leg rather
 * than crossing in front of it, where two legs draw as one column.
 */
const DRIVE_FLARE_SHARE = 0.5;
/** How far behind the hip a swinging foot takes its view's whole `kickLift`. */
const KICK_LIFT_FULL_DEPTH = 0.3;
/**
 * The swinging foot takes `reachLift` only once it is further ahead than the
 * knee drive carries it, and all of it by the reach: the knee drive keeps the
 * lift the side-on gait gives it, and the foot reaching for the floor drops.
 */
const REACH_LIFT_FROM_DEPTH = 0.1;
const REACH_LIFT_SPAN = 0.24;
/**
 * The highest a kick lifts a heel, off a flat foot's ankle height: just under
 * the seat. Higher, the heel with its flare swings out level with the hip and
 * reads as a leg flung sideways.
 */
const KICK_LIFT_CEILING = 0.45;
/** Profile draws the side-on gait as it is. */
const PROFILE_TRACK: FacingTrack = { swingFlare: 0, kickLift: 1, reachLift: 1 };

/** How the run's feet are laid out in `view`. */
function runFacingTrack(view: CarlView): FacingTrack {
  return view === 'side' ? PROFILE_TRACK : RUN_FACING_TRACK;
}

/** A walker's feet pass straight through beside each other, on his own ground line. */
const WALK_FACING_TRACK: FacingTrack = { swingFlare: 0, kickLift: 1, reachLift: 1 };

/** A track `weight` of the way from standing to `track`, for a start or a stop. */
function facingTrackAt(track: FacingTrack, weight: number): FacingTrack {
  return {
    swingFlare: track.swingFlare * weight,
    kickLift: lerp(1, track.kickLift, weight),
    reachLift: lerp(1, track.reachLift, weight),
  };
}
/**
 * A slow walker's feet track about as wide as he stands, and at the stance's
 * own width stepping off and settling back never shift a planted foot sideways.
 */
const WALK_FOOT_SPREAD = IDLE_FOOT_SPREAD;
/** The hips carry toward the foot bearing weight, keeping his mass over it. */
const RUN_WEIGHT_SWAY = 0.018;
const WALK_WEIGHT_SWAY = 0.022;
/**
 * The pelvis drops on the side of the leg in the air — a few degrees, which
 * across the hip joints is this much of a tile.
 */
const RUN_PELVIS_DROP = 0.018;
const WALK_PELVIS_TILT_DROP = 0.014;
/**
 * The lift at which a swinging shin draws at full near-camera width: the knee
 * is well up and the shin turned toward the viewer.
 */
const FULLY_NEAR_LIFT = 0.25;
/** A flat foot's ankle height off the floor. */
const FLAT_ANKLE_HEIGHT = heightOf(ankleOverPivot(0, 'toe', 0));

/**
 * The depth toward the camera at which a leg draws at full near-camera width:
 * a foot this far nearer the viewer than the hips, as the pushing foot is
 * seen from behind and the landing foot from the front.
 */
const FULLY_NEAR_DEPTH = 0.4;

/**
 * Puts one side-on gait foot onto a head-on pose. A leg nearer the camera than
 * the hips — its knee driven up at the viewer, or its foot on the floor on the
 * viewer's side of him — draws at the near leg's width: a long leg reaching
 * down the screen then reads as close, not as a stilt.
 */
function placeFacingFoot(
  pose: CarlPose,
  side: number,
  foot: GaitFoot,
  spread: number,
  view: CarlView,
  track: FacingTrack,
): void {
  const depth = foot.ankle.x;
  const towardCamera = view === 'back' ? -depth : depth;
  const lifted = foot.planted
    ? 0
    : clamp01((heightOf(foot.ankle) - FLAT_ANKLE_HEIGHT) / FULLY_NEAR_LIFT);
  const recovering = clamp01(-depth / RECOVERY_FLARE_DEPTH);
  const flareShare = lerp(DRIVE_FLARE_SHARE, 1, recovering);
  const flare = track.swingFlare * lifted * flareShare;
  const kicking = clamp01(-depth / KICK_LIFT_FULL_DEPTH);
  const reaching = clamp01((depth - REACH_LIFT_FROM_DEPTH) / REACH_LIFT_SPAN);
  const liftGain = foot.planted
    ? 1
    : lerp(1, track.kickLift, kicking) * lerp(1, track.reachLift, reaching);
  const sideOnLift = Math.max(0, heightOf(foot.ankle) - FLAT_ANKLE_HEIGHT);
  const lift = Math.min(sideOnLift * liftGain, Math.max(sideOnLift, KICK_LIFT_CEILING));
  const ankleY = foot.planted ? foot.ankle.y : -(FLAT_ANKLE_HEIGHT + lift);
  const target = pt(side * (spread + flare), ankleY - ANKLE_Y);
  const nearness = Math.max(lifted, clamp01(towardCamera / FULLY_NEAR_DEPTH));
  if (side > 0) {
    pose.rightFoot = target;
    pose.rightFootDepth = depth;
    pose.rightFootPitch = foot.pitch;
    pose.rightFootPlanted = foot.planted;
    pose.rightLegNearness = nearness;
    pose.rightForeshorten = 1;
  } else {
    pose.leftFoot = target;
    pose.leftFootDepth = depth;
    pose.leftFootPitch = foot.pitch;
    pose.leftFootPlanted = foot.planted;
    pose.leftLegNearness = nearness;
    pose.leftForeshorten = 1;
  }
}

/** Puts one side-on gait foot onto a profile pose. */
function placeSideFoot(pose: CarlPose, side: number, foot: GaitFoot): void {
  const target = profileFootTarget(foot.ankle, foot.pitch);
  if (side > 0) {
    pose.rightFoot = target;
    pose.rightFootPitch = foot.pitch;
    pose.rightFootPlanted = foot.planted;
  } else {
    pose.leftFoot = target;
    pose.leftFootPitch = foot.pitch;
    pose.leftFootPlanted = foot.planted;
  }
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function runBody(phase: number): CarlPose {
  const pose = restingPose();
  pose.bob = STANDING_HIP - runHipHeight(phase);
  const pump = runPump(phase);
  pose.lean = RUN_LEAN + RUN_LEAN_PUMP * pump;
  pose.headTilt = -RUN_LEAN_PUMP * pump * RUN_HEAD_STEADY;
  pose.rightFist = LOOSE_FIST;
  pose.leftFist = LOOSE_FIST;
  pose.blink = blink(phase, BLINK_AT);
  pose.brow = LOCOMOTION_BROW;
  return pose;
}

function runSideBase(phase: number): CarlPose {
  const pose = runBody(phase);
  placeSideFoot(pose, RIGHT_ARM, runFoot(phase));
  placeSideFoot(pose, LEFT_ARM, runFoot(phase + HALF_CYCLE));
  // The right arm is furthest back as the right foot lands.
  const swing = legSwing(phase);
  pose.rightArmAngles = runSideArm(-swing);
  pose.leftArmAngles = runSideArm(swing);
  pose.twist = -swing * RUN_SHOULDER_TWIST;
  pose.headTurn = SIDE_HEAD_TURN;
  pose.bob -= RUN_SIDE_BOB_GAIN * Math.min(0, runHipHeight(phase) - RUN_CARRIAGE_HIP);
  return pose;
}

/**
 * Edge-on the pelvis's rise and fall is the one sign of the flight a reader
 * sees whole, and at the tile the physical 3% of his height is about a pixel:
 * the side-on run sinks deeper into each stance by this share on top of the
 * true absorb. Only the sink is deepened — the knees of a planted leg take it
 * up — never the flight, where a higher pelvis would stretch the legs of
 * every blow and hop thrown over the stride past their length.
 */
const RUN_SIDE_BOB_GAIN = 1;

function runFacingBase(phase: number, away: boolean): CarlPose {
  const pose = runBody(phase);
  pose.lean = 0;
  pose.headTilt = 0;
  const view = away ? 'back' : 'front';
  const track = runFacingTrack(view);
  placeFacingFoot(pose, RIGHT_ARM, runFoot(phase), RUN_FOOT_SPREAD, view, track);
  placeFacingFoot(pose, LEFT_ARM, runFoot(phase + HALF_CYCLE), RUN_FOOT_SPREAD, view, track);
  const weight = Math.cos((phase - RUN_MID_STANCE) * TWO_PI);
  pose.sway = weight * RUN_WEIGHT_SWAY;
  pose.pelvisDrop = weight * RUN_PELVIS_DROP;
  const swing = legSwing(phase);
  // Each arm paints behind the torso by its hand's depth rather than for the
  // whole row: from behind, the arm swung back comes toward the camera and
  // must lie over his back. It changes sides as it passes the hip, outboard
  // of the torso, where the order cannot show.
  setFacingArms(pose, -swing, runFacingArm);
  pose.twist = -swing * RUN_SHOULDER_TWIST * FACING_TWIST_SHARE;
  return pose;
}

/**
 * How much higher than the side-on arc the whole figure rides at the top of
 * the flight head-on, feet and all. Side-on the flight shows as both feet
 * clear of the floor across a long split; head-on the split is depth, which
 * the foreshortened floor all but hides, and the flight's own rise — a
 * couple of hundredths of his height — is under a pixel at the tile. Without
 * more, feet drawn off the floor under a body that does not leave it read as
 * legs shortening.
 */
const FACING_FLIGHT_LIFT = 0.04;

/** How far through its flight's arc the body is at `phase`: 0 in stance, 1 at the top. */
function runFlightArc(phase: number): number {
  const step = wrapPhase(phase) % HALF_CYCLE;
  if (step <= RUN_TOE_OFF_PHASE) return 0;
  const flight = (step - RUN_TOE_OFF_PHASE) / (HALF_CYCLE - RUN_TOE_OFF_PHASE);
  return 4 * flight * (1 - flight);
}

/** Carries a head-on body and both its feet, neither planted in flight, up the arc. */
function liftFacingFlight(pose: CarlPose, arc: number): void {
  const lift = FACING_FLIGHT_LIFT * arc;
  if (lift <= 0) return;
  pose.bob -= lift;
  pose.rightFoot = pt(pose.rightFoot.x, pose.rightFoot.y - lift);
  pose.leftFoot = pt(pose.leftFoot.x, pose.leftFoot.y - lift);
}

/**
 * Head-on the shoulders' turn shows only as a slight width shift; at the
 * profile's strength it reads as the torso wobbling.
 */
const FACING_TWIST_SHARE = 0.5;
/** How far he keeps his face toward the camera while travelling in profile. */
const SIDE_HEAD_TURN = 0.25;

function walkBody(phase: number): CarlPose {
  const pose = restingPose();
  pose.bob = STANDING_HIP - walkHipHeight(phase);
  pose.rightFist = WALK_FIST;
  pose.leftFist = WALK_FIST;
  pose.blink = blink(phase, BLINK_AT);
  pose.brow = LOCOMOTION_BROW;
  return pose;
}

function walkSideBase(phase: number): CarlPose {
  const pose = walkBody(phase);
  pose.lean = WALK_LEAN;
  placeSideFoot(pose, RIGHT_ARM, walkFoot(phase));
  placeSideFoot(pose, LEFT_ARM, walkFoot(phase + HALF_CYCLE));
  const swing = legSwing(phase);
  pose.rightArmAngles = sideArmAngles(-swing);
  pose.leftArmAngles = sideArmAngles(swing);
  // Edge-on the elbow trails behind the shoulder through the swing.
  pose.elbowFlare = WALK_SIDE_ELBOW_FLARE;
  pose.twist = -swing * WALK_SHOULDER_TWIST;
  pose.headTurn = SIDE_HEAD_TURN;
  return pose;
}

const WALK_SIDE_ELBOW_FLARE = -0.5;

function walkFacingArm(side: number, forward: number): FacingArm {
  return facingSwingArm(side, forward, WALK_FACING_SWING);
}

function walkFacingBase(phase: number, away: boolean): CarlPose {
  const pose = walkBody(phase);
  const view = away ? 'back' : 'front';
  placeFacingFoot(pose, RIGHT_ARM, walkFoot(phase), WALK_FOOT_SPREAD, view, WALK_FACING_TRACK);
  placeFacingFoot(
    pose,
    LEFT_ARM,
    walkFoot(phase + HALF_CYCLE),
    WALK_FOOT_SPREAD,
    view,
    WALK_FACING_TRACK,
  );
  const weight = Math.cos((phase - WALK_MID_STANCE) * TWO_PI);
  pose.sway = weight * WALK_WEIGHT_SWAY;
  pose.pelvisDrop = weight * WALK_PELVIS_TILT_DROP;
  const swing = legSwing(phase);
  setFacingArms(pose, -swing, walkFacingArm);
  // Whole-row, not per-frame: an arm that changes sides partway through the
  // cycle pops at the shoulder.
  pose.rightArmBehind = away;
  pose.leftArmBehind = away;
  pose.twist = -swing * WALK_SHOULDER_TWIST;
  return pose;
}

/**
 * How long one loop lasts at `speedPxPerTick`. The springs are timed against
 * the run at his base speed and the walk at a wade, the fastest pace he walks.
 */
function loopSeconds(groundPerCycle: number, speedPxPerTick: number): number {
  return (groundPerCycle * WORLD_PX_PER_UNIT) / speedPxPerTick / TICKS_PER_SECOND;
}

const RUN_SPRINGS = springsFor(loopSeconds(RUN_GROUND_PER_CYCLE, PLAYER_SPEED));
const WALK_SPRINGS = springsFor(
  loopSeconds(WALK_GROUND_PER_CYCLE, PLAYER_SPEED * WADE_SPEED_FACTOR),
);

const RUN_SIDE_ANCHORS = measureAnchors(runSideBase, 'side', RUN_FRAMES);
const RUN_FRONT_ANCHORS = measureAnchors((p) => runFacingBase(p, false), 'front', RUN_FRAMES);
const RUN_BACK_ANCHORS = measureAnchors((p) => runFacingBase(p, true), 'back', RUN_FRAMES);
const WALK_SIDE_ANCHORS = measureAnchors(walkSideBase, 'side', WALK_FRAMES);
const WALK_FRONT_ANCHORS = measureAnchors((p) => walkFacingBase(p, false), 'front', WALK_FRAMES);
const WALK_BACK_ANCHORS = measureAnchors((p) => walkFacingBase(p, true), 'back', WALK_FRAMES);

const NO_DRAG = pt(0, 0);

export function runSide(phase: number): CarlPose {
  const pose = runSideBase(phase);
  applySecondary(pose, RUN_SIDE_ANCHORS, RUN_SPRINGS, phase, pt(-RUN_JACKET_DRAG, 0));
  return pose;
}

export function runFacing(phase: number, away: boolean): CarlPose {
  const pose = runFacingBase(phase, away);
  applySecondary(pose, away ? RUN_BACK_ANCHORS : RUN_FRONT_ANCHORS, RUN_SPRINGS, phase, NO_DRAG);
  return pose;
}

/**
 * The head-on run cycle as its own row plays it: {@link runFacing} carried up
 * its flight by {@link FACING_FLIGHT_LIFT}. Rows built over the run — blows
 * and hops thrown on the move — take {@link runFacing} itself, because they
 * put a foot back on the floor in frames the run spends in the air.
 */
export function runFacingCycle(phase: number, away: boolean): CarlPose {
  const pose = runFacing(phase, away);
  liftFacingFlight(pose, runFlightArc(phase));
  return pose;
}

export function walkSide(phase: number): CarlPose {
  const pose = walkSideBase(phase);
  applySecondary(pose, WALK_SIDE_ANCHORS, WALK_SPRINGS, phase, NO_DRAG);
  return pose;
}

export function walkFacing(phase: number, away: boolean): CarlPose {
  const pose = walkFacingBase(phase, away);
  applySecondary(pose, away ? WALK_BACK_ANCHORS : WALK_FRONT_ANCHORS, WALK_SPRINGS, phase, NO_DRAG);
  return pose;
}

// ── Start and stop ───────────────────────────────────────────────────────────

/**
 * The run's start: from standing, he leans in and drives off the left foot —
 * it stays planted while the body goes over it and peels up into the push-off —
 * while the right knee comes up and through. Its last frame is the run's own
 * pose at {@link RUN_START_EXIT_PHASE}, so the cycle carries on from there.
 *
 * The sprite is already moving at full speed on the first frame, so the left
 * foot is the run's own planted left foot, carried back through the cell a
 * run frame's worth of ground at a time; everything else eases out of the idle.
 */
const RUN_START_STEPS = RUN_START_FRAMES - 1;
/** The run phase the start hands off to: the left foot's push-off. */
export const RUN_START_EXIT_PHASE = HALF_CYCLE + RUN_TOE_OFF_PHASE;
/** Run phase of the left foot's stance on the start's first frame. */
const RUN_START_LEFT_STANCE_FROM = RUN_TOE_OFF_PHASE - RUN_START_STEPS * RUN_FRAME_PHASE;
/**
 * The right foot's path out of standing: up off the floor with the knee
 * lifting in front, then into the run's knee drive. Keyed on the start's
 * frames, with the run's own swing as the last key.
 */
const RUN_START_RIGHT_LIFT: readonly Pt[] = [pt(0.03, 0.2), pt(0.1, 0.42)];
const RUN_START_RIGHT_LIFT_PITCH: readonly number[] = [deg(18), deg(24)];

/**
 * The knees give a little as he sets off, before the body has left the idle:
 * the planted left foot is already a run frame behind him, and a leg reaching
 * back from standing height would lock straight.
 */
const RUN_START_SET_DIP = 0.012;

/** How far through the start a frame is, 0 standing to 1 running. */
function startBlend(frame: number): number {
  return frame / RUN_START_STEPS;
}

function startLeftFoot(frame: number): GaitFoot {
  return runStanceFoot(RUN_START_LEFT_STANCE_FROM + frame * RUN_FRAME_PHASE);
}

function startRightFoot(frame: number, standingAnkleX: number): GaitFoot {
  if (frame <= 0) {
    return {
      ankle: ankleOverPivot(standingAnkleX + TOE_AHEAD_OF_ANKLE, 'toe', 0),
      pitch: 0,
      planted: true,
    };
  }
  if (frame >= RUN_START_STEPS) return runFoot(RUN_START_EXIT_PHASE);
  const lift = RUN_START_RIGHT_LIFT[frame - 1];
  return {
    ankle: pt(lift.x, -lift.y),
    pitch: RUN_START_RIGHT_LIFT_PITCH[frame - 1],
    planted: false,
  };
}

/**
 * The run's stop: the right foot plants out ahead of the hips — the braking
 * step — and stays planted while the knees give and the body rocks back off
 * its lean, the left foot comes down beside it, the right shuffles in under the
 * hip, and he settles into the idle's stance. Its first frame is the run's own
 * contact, at {@link RUN_STOP_ENTRY_PHASE}.
 *
 * Nothing travels: the player has stopped. So the feet go where standing needs
 * them, and the one that is planted when the stop begins waits for the other
 * before it moves.
 */
export const RUN_STOP_ENTRY_PHASE = 0;
/**
 * The stop's beats, by frame: the plant — the right foot down, the knees
 * absorbing, the left still coming down — then the shuffle, with the left
 * foot standing and the right drawn in under the hip.
 */
const RUN_STOP_PLANT_FRAME = 1;
const RUN_STOP_SHUFFLE_FRAME = 2;
/** How much deeper than the run's own absorb the knees give on the plant. */
const RUN_STOP_ABSORB = 0.05;
/**
 * The stop's last frame: both feet in the idle's stance, the knees not quite
 * straightened out of the catch — the idle that follows is the settle.
 */
const RUN_STOP_SETTLE_FRAME = RUN_STOP_FRAMES - 1;
const RUN_STOP_SETTLE_DIP = 0.012;
/**
 * How far the torso rocks back past upright as the lean is caught: the weight
 * is thrown back over the braking foot.
 */
const RUN_STOP_CATCH_LEAN = deg(-9);
/**
 * The left foot on its way down, between the run's swing and the idle stance:
 * about halfway, so it neither hangs in the air nor snaps to the floor.
 */
const RUN_STOP_LEFT_DESCENT: Pt = pt(-0.22, 0.34);
const RUN_STOP_LEFT_DESCENT_PITCH = deg(30);
/** How high the right foot clears the floor as it shuffles in under him. */
const RUN_STOP_SHUFFLE_LIFT = 0.05;

/** The ankle of an idle foot standing at `x`. */
function standingFoot(x: number): GaitFoot {
  return { ankle: ankleOverPivot(x + TOE_AHEAD_OF_ANKLE, 'toe', 0), pitch: 0, planted: true };
}

function stopFeet(
  frame: number,
  standing: { left: number; right: number },
): { left: GaitFoot; right: GaitFoot } {
  const entryRight = runFoot(RUN_STOP_ENTRY_PHASE);
  const entryLeft = runFoot(RUN_STOP_ENTRY_PHASE + HALF_CYCLE);
  if (frame <= 0) return { left: entryLeft, right: entryRight };
  const plantedRight = {
    ...entryRight,
    pitch: 0,
    ankle: ankleOverPivot(entryRight.ankle.x + TOE_AHEAD_OF_ANKLE, 'toe', 0),
  };
  if (frame === RUN_STOP_PLANT_FRAME) {
    return {
      left: {
        ankle: pt(RUN_STOP_LEFT_DESCENT.x, -RUN_STOP_LEFT_DESCENT.y),
        pitch: RUN_STOP_LEFT_DESCENT_PITCH,
        planted: false,
      },
      right: plantedRight,
    };
  }
  const left = standingFoot(standing.left);
  if (frame === RUN_STOP_SHUFFLE_FRAME) {
    const shuffle = lerp(plantedRight.ankle.x, standing.right, HALF_CYCLE);
    return {
      left,
      right: {
        ankle: pt(shuffle, plantedRight.ankle.y - RUN_STOP_SHUFFLE_LIFT),
        pitch: 0,
        planted: false,
      },
    };
  }
  return { left, right: standingFoot(standing.right) };
}

/** Side-on standing ankles, from the idle's own first frame. */
const IDLE_SIDE_ANKLES = { left: idleSide(0).leftFoot.x, right: idleSide(0).rightFoot.x };
/** Head-on the idle feet stand side by side on the hip's own ground line. */
const IDLE_FACING_SPREAD = idleFront(0).rightFoot.x;

/** The hip height, lean and arm swing of a start or stop frame, blended from standing. */
function transitionBody(
  pose: CarlPose,
  view: CarlView,
  weight: number,
  runPhase: number,
  extraDrop: number,
): void {
  const standing = STANDING_HIP - idleFront(0).bob;
  pose.bob = STANDING_HIP - lerp(standing, runHipHeight(runPhase), weight) + extraDrop;
  pose.lean = RUN_LEAN * weight;
  pose.rightFist = lerp(pose.rightFist, LOOSE_FIST, weight);
  pose.leftFist = lerp(pose.leftFist, LOOSE_FIST, weight);
  pose.brow = LOCOMOTION_BROW;
}

function blendAngles(a: ArmAngles, b: ArmAngles, t: number): ArmAngles {
  return {
    upper: lerp(a.upper, b.upper, t),
    fore: lerp(a.fore, b.fore, t),
    foreScale: lerp(a.foreScale, b.foreScale, t),
  };
}

/** The run's arms at `runPhase`, swung by `weight` of their full swing. */
function runArmsAt(pose: CarlPose, view: CarlView, runPhase: number, weight: number): void {
  const swing = legSwing(runPhase);
  const running = (side: number): FacingArm => {
    const forward = side === RIGHT_ARM ? -swing : swing;
    return view === 'side'
      ? { angles: runSideArm(forward), upperScale: FULL_UPPER_ARM, handDepth: 0 }
      : runFacingArm(side, forward);
  };
  // From the idle's own hang in every view, so the arms neither snap into
  // their bend as he sets off nor out of it as he stands.
  const right = running(RIGHT_ARM);
  const left = running(LEFT_ARM);
  blendArmsFromStanding(pose, view, right, left, weight);
  if (view === 'side') return;
  // Standing, both arms hang behind him seen from behind; the one swinging
  // back toward the camera comes out over his back as it gets going.
  pose.rightArmBehind = view === 'back' && right.handDepth >= 0;
  pose.leftArmBehind = view === 'back' && left.handDepth >= 0;
  pose.rightHandDepth = right.handDepth * weight;
  pose.leftHandDepth = left.handDepth * weight;
}

/** Both arms `t` of the way from the idle's hang in `view` to `right` / `left`. */
function blendArmsFromStanding(
  pose: CarlPose,
  view: CarlView,
  right: FacingArm,
  left: FacingArm,
  t: number,
): void {
  const standing = standingPose(view);
  setArmAngles(
    pose,
    'right',
    blendAngles(armAnglesOf(standing, view, RIGHT_ARM), right.angles, t),
    lerp(standing.rightUpperArmScale ?? FULL_UPPER_ARM, right.upperScale, t),
  );
  setArmAngles(
    pose,
    'left',
    blendAngles(armAnglesOf(standing, view, LEFT_ARM), left.angles, t),
    lerp(standing.leftUpperArmScale ?? FULL_UPPER_ARM, left.upperScale, t),
  );
}

/** A pose's arm as it stands, for blending: its angles and the drawn share of its upper arm. */
function facingArmOf(pose: CarlPose, view: CarlView, side: number): FacingArm {
  const upperScale =
    (side === RIGHT_ARM ? pose.rightUpperArmScale : pose.leftUpperArmScale) ?? FULL_UPPER_ARM;
  return { angles: armAnglesOf(pose, view, side), upperScale, handDepth: 0 };
}

/** A pose's arm as joint angles, solving an arm it places by the hand. */
function armAnglesOf(pose: CarlPose, view: CarlView, side: number): ArmAngles {
  return (
    (side === RIGHT_ARM ? pose.rightArmAngles : pose.leftArmAngles) ??
    solvedArmAngles(pose, view, side)
  );
}

function standingPose(view: CarlView): CarlPose {
  if (view === 'side') return idleSide(0);
  return view === 'back' ? idleBack(0) : idleFront(0);
}

/**
 * Puts one side-on gait foot onto a pose in any view. Head-on the foot is laid
 * out on `track`, the run's own for the view unless a caller says otherwise:
 * a foot placed off the run's track while the run's other foot is on it
 * stands somewhere the run never puts it.
 */
export function placeFoot(
  pose: CarlPose,
  view: CarlView,
  side: BodySide,
  foot: GaitFoot,
  spread: number,
  track: FacingTrack = runFacingTrack(view),
): void {
  const sign = sideSign(side);
  if (view === 'side') placeSideFoot(pose, sign, foot);
  else placeFacingFoot(pose, sign, foot, spread, view, track);
}

/** Jacket hem drag, eased in over a start or shed over a stop by the spring's own response. */
const START_SETTLE_LOOPS_PER_FRAME = RUN_FRAME_PHASE;

export function runStart(frame: number, view: CarlView): CarlPose {
  const step = Math.round(frame);
  const weight = startBlend(step);
  const runPhase = RUN_START_EXIT_PHASE - (RUN_START_STEPS - step) * RUN_FRAME_PHASE;
  const pose = standingPose(view);
  transitionBody(pose, view, weight, runPhase, step === 0 ? RUN_START_SET_DIP : 0);
  // The left foot is planted from the first frame to the last, so it stands
  // where the run will have it and cannot drift across; the right foot is in
  // the air from the second frame and closes in as it goes.
  placeFoot(pose, view, 'left', startLeftFoot(step), RUN_FOOT_SPREAD);
  placeFoot(
    pose,
    view,
    'right',
    startRightFoot(step, view === 'side' ? IDLE_SIDE_ANKLES.right : 0),
    lerp(IDLE_FACING_SPREAD, RUN_FOOT_SPREAD, weight),
    facingTrackAt(runFacingTrack(view), weight),
  );
  // The arms lead a start: most of the way into their drive by the first step.
  if (step > 0) runArmsAt(pose, view, runPhase, Math.sin((weight * Math.PI) / 2));
  const drive = RUN_START_DRIVE_LEAN * Math.sin(Math.PI * weight);
  if (view !== 'side') {
    pose.lean = 0;
    pose.torsoPitch = drive;
  } else {
    pose.lean += drive;
    pose.headTurn = lerp(pose.headTurn, SIDE_HEAD_TURN, weight);
  }
  const settle = springSettle(step * START_SETTLE_LOOPS_PER_FRAME, RUN_SPRINGS.jacket);
  pose.jacketHemLag = pt(view === 'side' ? RUN_JACKET_DRAG * settle : 0, 0);
  return pose;
}

/**
 * Setting off, the body pitches further forward than it runs: the push has to
 * put his weight ahead of the driving foot before the stride can carry it. The
 * extra lean peaks mid-start and is gone by the run's own lean at the hand-off.
 */
const RUN_START_DRIVE_LEAN = deg(8);

export function runStop(frame: number, view: CarlView): CarlPose {
  const step = Math.round(frame);
  const weight = 1 - step / (RUN_STOP_FRAMES - 1);
  const pose = standingPose(view);
  const absorb =
    step === RUN_STOP_PLANT_FRAME
      ? RUN_STOP_ABSORB
      : step === RUN_STOP_SETTLE_FRAME
        ? RUN_STOP_SETTLE_DIP
        : 0;
  transitionBody(pose, view, weight, RUN_STOP_ENTRY_PHASE, absorb);
  if (step === RUN_STOP_PLANT_FRAME) {
    pose.lean = RUN_STOP_CATCH_LEAN;
    if (view !== 'side') pose.torsoPitch = RUN_STOP_CATCH_LEAN;
  }
  const standing = view === 'side' ? IDLE_SIDE_ANKLES : { left: 0, right: 0 };
  const feet = stopFeet(step, standing);
  // Once both feet are down in the idle's stance they stand where the idle's do.
  const bothFeetDown = step >= RUN_STOP_SHUFFLE_FRAME;
  const spread = bothFeetDown
    ? IDLE_FACING_SPREAD
    : lerp(IDLE_FACING_SPREAD, RUN_FOOT_SPREAD, weight);
  // A foot still planted where the run put it keeps the run's track; moving it
  // with the blend would slide it over the floor.
  const trackFor = (foot: GaitFoot): FacingTrack =>
    foot.planted && step <= RUN_STOP_PLANT_FRAME
      ? runFacingTrack(view)
      : facingTrackAt(runFacingTrack(view), weight);
  placeFoot(pose, view, 'left', feet.left, spread, trackFor(feet.left));
  placeFoot(pose, view, 'right', feet.right, spread, trackFor(feet.right));
  if (bothFeetDown && view !== 'side') {
    // Standing, the left foot is the idle's own: drawn on the hip's ground line
    // exactly as the idle draws it, so it does not shift as the idle takes over.
    const idle = standingPose(view);
    pose.leftFoot = idle.leftFoot;
    pose.leftFootPitch = idle.leftFootPitch;
    pose.leftForeshorten = idle.leftForeshorten;
    delete pose.leftFootDepth;
  }
  runArmsAt(pose, view, RUN_STOP_ENTRY_PHASE, weight);
  if (view !== 'side') {
    pose.lean = 0;
  } else {
    pose.headTurn = SIDE_HEAD_TURN;
  }
  const settle = springSettle(step * START_SETTLE_LOOPS_PER_FRAME, RUN_SPRINGS.jacket);
  pose.jacketHemLag = pt(view === 'side' ? -RUN_JACKET_DRAG * settle : 0, 0);
  return pose;
}

// ── Walk start and stop ──────────────────────────────────────────────────────

/**
 * The walk's phase, within the right foot's stance, at which its ankle stands
 * `ahead` of the pelvis. The stance carries the foot steadily back, so the
 * ankle's lead falls monotonically and a bisection finds it.
 */
function walkStancePhaseWithRightAnkleAt(ahead: number): number {
  return bisect(0, WALK_TOE_OFF_PHASE, (phase) => walkStanceFoot(phase).ankle.x > ahead);
}

/**
 * Where the right ankle stands ahead of the pelvis in a view's idle: staggered
 * a little forward edge-on, and level with the other head-on, where the idle
 * stands on the hip's own ground line.
 */
function idleRightAnkleAhead(view: CarlView): number {
  return view === 'side' ? IDLE_SIDE_ANKLES.right : 0;
}

/**
 * The walk phase the stop takes over from: the moment the right foot, planted
 * and carried back through its stance, stands exactly where the idle has it.
 * From there the right foot need never move again, and stopping is only the
 * left foot coming down beside it.
 */
export function walkStopEntryPhase(view: CarlView): number {
  return walkStancePhaseWithRightAnkleAt(idleRightAnkleAhead(view));
}

/**
 * The walk phase the start hands off to. The right foot is planted where the
 * idle has it on the start's first frame and stays planted while the body
 * walks over it, so by the last frame it is as many frames of ground behind
 * the idle's stance as the start has steps — and the walk carries on from the
 * phase that has the foot there.
 */
export function walkStartExitPhase(view: CarlView): number {
  const travelled = (WALK_START_FRAMES - 1) * WALK_GROUND_PER_FRAME;
  return walkStancePhaseWithRightAnkleAt(idleRightAnkleAhead(view) - travelled);
}

/**
 * On the start's first frame the left heel is already peeling off the floor,
 * rolling onto the toes the way every walking step leaves the ground.
 */
const WALK_START_PEEL_PITCH = deg(25);
/**
 * Head-on the foot is drawn end-on and cannot show its pitch, so the peel
 * shows only as the ankle rising off the idle's stance. At the profile's peel
 * that rise is a hop larger than any step the walk's feet take on screen; this
 * much still starts the foot up without one.
 */
const WALK_START_FACING_PEEL_PITCH = deg(12);

/** The walk's pose at `phase` in any view. */
function walkPose(view: CarlView, phase: number): CarlPose {
  if (view === 'side') return walkSide(phase);
  return walkFacing(phase, view === 'back');
}

/** Joint angles that draw the same arm a pose's solved skeleton has. */
function solvedArmAngles(pose: CarlPose, view: CarlView, side: number): ArmAngles {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const chain = side === RIGHT_ARM ? skeleton.rightArm : skeleton.leftArm;
  return anglesThrough(chain.root, chain.joint, chain.end);
}

/**
 * A pose `stride` of the way from standing to walking — the body, the arms and
 * the loose parts, everything but the feet, which each bridge places itself.
 */
function bridgeBody(view: CarlView, walking: CarlPose, stride: number): CarlPose {
  const standing = standingPose(view);
  const pose = walkPose(view, 0);
  pose.bob = lerp(standing.bob, walking.bob, stride);
  pose.sway = lerp(standing.sway, walking.sway, stride);
  pose.lean = lerp(standing.lean, walking.lean, stride);
  pose.twist = lerp(standing.twist, walking.twist, stride);
  pose.headTurn = lerp(standing.headTurn, walking.headTurn, stride);
  pose.pelvisDrop = lerp(standing.pelvisDrop ?? 0, walking.pelvisDrop ?? 0, stride);
  pose.rightFist = lerp(standing.rightFist, walking.rightFist, stride);
  pose.leftFist = lerp(standing.leftFist, walking.leftFist, stride);
  pose.blink = standing.blink;
  blendArmsFromStanding(
    pose,
    view,
    facingArmOf(walking, view, RIGHT_ARM),
    facingArmOf(walking, view, LEFT_ARM),
    stride,
  );
  pose.rightArmBehind = walking.rightArmBehind;
  pose.leftArmBehind = walking.leftArmBehind;
  const scaled = (p: Pt | undefined): Pt => pt((p?.x ?? 0) * stride, (p?.y ?? 0) * stride);
  pose.jacketHemLag = scaled(walking.jacketHemLag);
  pose.leftBoxerFlutter = scaled(walking.leftBoxerFlutter);
  pose.rightBoxerFlutter = scaled(walking.rightBoxerFlutter);
  pose.hairTuftLag = scaled(walking.hairTuftLag);
  return pose;
}

/** The idle's own left foot, standing, as a side-on gait foot. */
function idleLeftFoot(view: CarlView): GaitFoot {
  return standingFoot(view === 'side' ? IDLE_SIDE_ANKLES.left : 0);
}

/**
 * The left foot `stride` of the way along a step between standing and the
 * walk's swing, across the floor on an eased path. `height` is how much of the
 * swing's height it has at that point: a foot stepping off clears the floor
 * early, and one coming down to stand settles late.
 */
function bridgeLeftFoot(
  standing: GaitFoot,
  swinging: GaitFoot,
  stride: number,
  height: number,
): GaitFoot {
  const across = easeInOut(stride);
  return {
    ankle: pt(
      lerp(standing.ankle.x, swinging.ankle.x, across),
      lerp(standing.ankle.y, swinging.ankle.y, height),
    ),
    pitch: lerp(standing.pitch, swinging.pitch, height),
    planted: false,
  };
}

/** Stepping off, the foot is most of the way up by a third of the way through. */
function steppingOffHeight(stride: number): number {
  return Math.sin((stride * Math.PI) / 2);
}

/** Coming down to stand, it is near the floor well before it arrives. */
function settlingHeight(stride: number): number {
  return stride * stride;
}

/**
 * The walk's start: the right foot stays planted where he stood while the body
 * walks over it, the left heel peels up and the left foot swings through into
 * the stride. Its last frame is the walk's own pose at
 * {@link walkStartExitPhase}; like the run's start it is paced by the ground
 * he covers, one walk frame of it per frame.
 */
export function walkStart(frame: number, view: CarlView): CarlPose {
  const step = Math.round(frame);
  const exit = walkStartExitPhase(view);
  const stride = (step + 1) / WALK_START_FRAMES;
  const phase = exit - (WALK_START_FRAMES - 1 - step) * WALK_FRAME_PHASE;
  const walking = walkPose(view, phase);
  const pose = bridgeBody(view, walking, stride);
  placeFoot(pose, view, 'right', walkFoot(phase), WALK_FOOT_SPREAD, WALK_FACING_TRACK);
  const standing = idleLeftFoot(view);
  const swinging = walkFoot(phase + HALF_CYCLE);
  const peel = view === 'side' ? WALK_START_PEEL_PITCH : WALK_START_FACING_PEEL_PITCH;
  const left =
    step === 0
      ? {
          ankle: ankleOverPivot(standing.ankle.x + TOE_AHEAD_OF_ANKLE, 'toe', peel),
          pitch: peel,
          planted: true,
        }
      : bridgeLeftFoot(standing, swinging, stride, steppingOffHeight(stride));
  placeFoot(pose, view, 'left', left, WALK_FOOT_SPREAD, WALK_FACING_TRACK);
  return pose;
}

/**
 * The walk's stop: the right foot is planted where the idle has it and stays
 * there, and the left foot, mid-swing, comes forward and down beside it while
 * the body settles out of the stride. Its first frame is the walk's own pose at
 * {@link walkStopEntryPhase}, and the idle follows its last.
 */
export function walkStop(frame: number, view: CarlView): CarlPose {
  const step = Math.round(frame);
  const entry = walkStopEntryPhase(view);
  const settled = step / WALK_STOP_FRAMES;
  const walking = walkPose(view, entry);
  const pose = bridgeBody(view, walking, 1 - settled);
  placeFoot(pose, view, 'right', walkFoot(entry), WALK_FOOT_SPREAD, WALK_FACING_TRACK);
  const swinging = walkFoot(entry + HALF_CYCLE);
  const stride = 1 - settled;
  placeFoot(
    pose,
    view,
    'left',
    bridgeLeftFoot(idleLeftFoot(view), swinging, stride, settlingHeight(stride)),
    WALK_FOOT_SPREAD,
    WALK_FACING_TRACK,
  );
  return pose;
}
