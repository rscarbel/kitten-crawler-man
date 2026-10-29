/**
 * The Fuzzy Nightmare, as a painted figure: the choreography, the cell
 * geometry, and the `FigureDef` the runtime cache and the review harness both
 * draw through.
 *
 * The thing from under the bed that comes up through the floor grates.
 * Anatomy and every stroke of paint live in `fuzzyNightmareArt.ts`; this module
 * is one pose function per animation row, sampled per frame, plus where that
 * pose sits inside its cell.
 *
 * Rows:
 *    idle          — toward the camera, crouched, breathing, coat shifting
 *    idle_side     — profile, drawn facing +X and mirrored at runtime
 *    idle_away     — away from the camera
 *    walk, walk_side, walk_away — a low, creeping gait
 *    swipe         — a long-armed rake at something in front of it
 *    swipe_side, swipe_away
 *    breach        — under a smashed floor, its fingers groping out of the hole
 *    emerge        — fingers first, then the head, then the rest of it
 *
 * `breach` is the one the defend quest plays while a Fuzzy Nightmare is still
 * working on a barricaded grate, and `emerge` is what it plays the moment the
 * boards give. Standing on a breach is what the arm coming out of it damages,
 * so those two rows are gameplay as much as art.
 *
 * The art invariants live in `scripts/gates-fuzzy-nightmare.ts`, which the
 * review harness runs: `npm run render:fuzzy-nightmare`.
 */

import { clamp01, deg, easeInOut, lerp, ramp } from './bipedArt';
import {
  ARM_ROOT_HALF,
  BREACH_FLOOR_Y,
  FOOT_STAND_SPREAD,
  FOREARM_LENGTH,
  HAND_HANG_DROP,
  HAND_HANG_SPREAD,
  RESTING_CLAW,
  RESTING_ELBOW_FLARE,
  SHOULDER_X_PROFILE,
  SHOULDER_Y,
  SUBMERGE_DEPTH,
  UPPER_ARM_LENGTH,
  type ArmAngles,
  type FuzzyNightmarePose,
  type FuzzyNightmareView,
  type Pt,
  drawFuzzyNightmareBack,
  drawFuzzyNightmareFront,
  drawFuzzyNightmareSide,
  pt,
  restingEyeCentres,
  restingPose,
} from './fuzzyNightmareArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import type { ViewedEyePlacement } from '../eyePlacement';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/**
 * Where the floor sits inside the tile, matching the cat's and the human's foot
 * placement so the three stand on the same line.
 */
export const GROUND_OFFSET_PX = 58;

/**
 * How much of a tile one figure unit fills. The anatomy is authored at a
 * comfortable working size and then scaled about its own ground line, which
 * keeps the feet on the tile they belong to. Folded double, the top of its back
 * stands about as tall as the human crawler; unfolded it would tower over him,
 * and the arms are already that long.
 */
export const FIGURE_SCALE = 0.78;

const IDLE_FRAMES = 8;
/**
 * Twice the frames of the other cycles. The walk is the animation that plays
 * most and travels furthest, so it is the one where 8 steps read as a stutter;
 * these are half-steps, not extra motion.
 */
const WALK_FRAMES = 16;
export const SWIPE_FRAMES = 8;
export const BREACH_FRAMES = 12;
export const EMERGE_FRAMES = 12;

/**
 * `FuzzyNightmare` fires its claw damage at the middle of the swing, so every
 * swipe row has to reach full extension exactly here.
 */
export const SWIPE_IMPACT_FRAME = 4;

// ── Pose helpers ─────────────────────────────────────────────────────────────

const FULL_TURN = Math.PI * 2;
/** Fingers fully splayed, and eyes fully burning. */
const FULL_CLAW = 1;
const FULL_GLARE = 1;
/**
 * How far a head-on knee is pulled back toward the hip→hock line. A crouched
 * leg seen from the front has to splay — that is the spider in it — but left
 * fully splayed the knees stick out past the shoulders. Both legs of a head-on
 * pose take the same value, or a splay that shows on one leg and not the other
 * flickers once per step.
 */
const HEAD_ON_KNEE_TUCK = 0.55;

/** Piecewise linear interpolation through a set of (t, value) keys. */
function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  for (let i = 1; i < keys.length; i++) {
    const [prevT, prevV] = keys[i - 1];
    const [nextT, nextV] = keys[i];
    if (t <= nextT) return lerp(prevV, nextV, (t - prevT) / (nextT - prevT));
  }
  return keys[keys.length - 1][1];
}

/**
 * A blink centred on `at`, expressed in cycle phase. Two points of light going
 * out and coming back is most of what its stillness has to say.
 */
function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 1.5) % 1) - 0.5);
  if (distance > BLINK_WIDTH) return 0;
  // Peaks *at* the centre of its own window: a hump fed the remaining distance
  // instead is zero there and the eye then blinks twice per cycle.
  const inside = 1 - distance / BLINK_WIDTH;
  return inside * inside * (3 - 2 * inside);
}

const BLINK_AT = 0.68;
const BLINK_WIDTH = 0.07;

/**
 * Standing still has to read as *alive*, not as swaying: a slow breath that
 * heaves the back and nothing else, near the threshold of visibility at a 32px
 * tile — except the coat, which should never be still.
 */
const BREATH_SETTLE = 0.012;
const BREATH_LEAN = deg(1.2);
const IDLE_SWAY = 0.008;
const IDLE_HEAD_TURN = 0.3;
const IDLE_FUR_DRIFT = 0.15;
/** Standing, the arms drift by a fraction of the walk's swing. */
const IDLE_ARM_DRIFT = 0.12;
/** How far it keeps its face toward the camera while standing in profile. */
const SIDE_HEAD_TURN = 0.2;
/**
 * How far ahead of the shoulder the hands hang in profile. A hunched body
 * hangs its arms from shoulders carried forward of the hips, so the hands come
 * to rest out in front of the feet, which is half of what makes it look like it
 * is reaching for you while it stands still.
 */
const SIDE_HAND_AHEAD = 0.04;
/**
 * Edge-on the two feet are staggered: the near one forward, the far one back
 * under the haunch.
 */
const IDLE_SIDE_FOOT_LEAD = 0.12;
/**
 * Edge-on the elbow has to break *backward*: forward it swings the forearm
 * across the creature's own front.
 */
const SIDE_ELBOW_FLARE = -0.35;
const WALK_SIDE_ELBOW_FLARE = -0.5;
/** The mouth at rest is never shut: a sliver of gape shows the teeth. */
const IDLE_MAW = 0.12;

function idleBase(phase: number): FuzzyNightmarePose {
  const breath = Math.sin(phase * FULL_TURN);
  const pose = restingPose();
  pose.bob = BREATH_SETTLE * (breath * 0.5 + 0.5);
  pose.lean = BREATH_LEAN * breath;
  pose.blink = blink(phase, BLINK_AT);
  pose.maw = IDLE_MAW * (breath * 0.5 + 0.5);
  pose.furFlow = breath * IDLE_FUR_DRIFT;
  pose.furPhase = phase * FULL_TURN;
  return pose;
}

function idleFront(phase: number): FuzzyNightmarePose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * FULL_TURN);
  pose.sway = sway * IDLE_SWAY;
  pose.headTurn = sway * IDLE_HEAD_TURN;
  // The same joint angles the head-on walk swings around, so stepping off from
  // standing cannot change the shape of the arms — only how much they move.
  pose.rightArmAngles = facingArmAngles(RIGHT_ARM, sway * IDLE_ARM_DRIFT, 0, 0);
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, sway * IDLE_ARM_DRIFT, 0, 0);
  pose.leftFoot = pt(-FOOT_STAND_SPREAD, 0);
  pose.rightFoot = pt(FOOT_STAND_SPREAD, 0);
  pose.leftForeshorten = HEAD_ON_KNEE_TUCK;
  pose.rightForeshorten = HEAD_ON_KNEE_TUCK;
  return pose;
}

const SIDE_REST_HAND = pt(SHOULDER_X_PROFILE + SIDE_HAND_AHEAD, SHOULDER_Y + HAND_HANG_DROP);
/** The far hand hangs a little behind the near one, so the two read apart. */
const SIDE_FAR_HAND_BEHIND = 0.08;

function idleSide(phase: number): FuzzyNightmarePose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * FULL_TURN);
  // Both hands ride the breath rather than one of them opposing it: the hang is
  // already at the arm's reach, so a hand pushed below the shoulder's own drop
  // is a target the solver has to clamp.
  pose.rightHand = pt(SIDE_REST_HAND.x, SIDE_REST_HAND.y + pose.bob);
  pose.leftHand = pt(SIDE_REST_HAND.x - SIDE_FAR_HAND_BEHIND, SIDE_REST_HAND.y + pose.bob);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD, 0);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD, 0);
  pose.headTurn = SIDE_HEAD_TURN + sway * IDLE_HEAD_TURN;
  pose.headTilt = sway * IDLE_HEAD_TILT;
  pose.elbowFlare = SIDE_ELBOW_FLARE;
  return pose;
}

/** In profile the head cocks a little as it breathes, the way a dog listens. */
const IDLE_HEAD_TILT = deg(4);

function idleBack(phase: number): FuzzyNightmarePose {
  const pose = idleFront(phase);
  pose.headTurn = -pose.headTurn;
  // Seen from behind the arms hang on the far side of it, the same as they do
  // in the walk it steps into from here.
  pose.leftArmBehind = true;
  pose.rightArmBehind = true;
  return pose;
}

// ── Walking ──────────────────────────────────────────────────────────────────

/**
 * Long and low. A folded digitigrade leg has slack to spare, so the stride is
 * set by how it should look — a creep, reaching each foot out and setting it
 * down — rather than by what the leg can reach.
 */
const STRIDE = 0.26;
/** The hips sink at each contact, which is the weight landing on a folded leg. */
const WALK_BOB = 0.05;
/** It creeps head-down, leaning into the walk further than it stands. */
const WALK_LEAN = deg(7);
const WALK_SWAY = 0.018;
/** How far the head scans side to side as it comes at the camera. */
const FACING_HEAD_SCAN = 0.5;
const HEEL_STRIKE_PITCH = deg(-8);
const TOE_OFF_PITCH = deg(16);
const SWING_PITCH = deg(-6);

/**
 * The tuck is what makes a walk read as walking rather than as a figure kicking
 * its feet out in front of it: after toe-off the foot comes up behind the hip
 * with the hock folded, passes under the body, and only then reaches forward.
 */
const TUCK_LIFT = 0.16;
/** The first, small lift as the toe leaves the floor. */
const TOE_LIFT = 0.04;
const TOE_LIFT_AT = 0.12;
/** Foot height as it passes under the hip. */
const PASS_LIFT = 0.11;
/** Foot height as it reaches out for the next contact. */
const REACH_LIFT = 0.03;
/** Where in the swing the tuck, the pass and the reach fall. */
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;
/**
 * More of the cycle on the ground than in the air: a creep keeps a foot down
 * for as long as it can.
 */
const STANCE_SHARE = 0.5;

/**
 * One foot of a profile gait. During stance the foot is planted and slides
 * backward under the body at a constant rate — the body is what moves. During
 * swing it tucks, passes and reaches.
 */
function gaitFootSide(phase: number): { foot: Pt; pitch: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_SHARE;
  const t = stance ? cycle / STANCE_SHARE : (cycle - STANCE_SHARE) / (1 - STANCE_SHARE);

  if (stance) {
    return {
      foot: pt(lerp(STRIDE, -STRIDE, t), 0),
      // Rolls onto the ball and up off it to push away.
      pitch: keyed(t, [
        [0, HEEL_STRIKE_PITCH],
        [0.2, 0],
        [0.75, 0],
        [1, TOE_OFF_PITCH],
      ]),
    };
  }
  return {
    foot: pt(
      keyed(t, [
        [0, -STRIDE],
        [TUCK_AT, -STRIDE * 0.75],
        [PASS_AT, 0],
        [REACH_AT, STRIDE * 0.8],
        [1, STRIDE],
      ]),
      -keyed(t, [
        [0, 0],
        [TOE_LIFT_AT, TOE_LIFT],
        [TUCK_AT, TUCK_LIFT],
        [PASS_AT, PASS_LIFT],
        [REACH_AT, REACH_LIFT],
        [1, 0],
      ]),
    ),
    pitch: keyed(t, [
      [0, TOE_OFF_PITCH],
      [PASS_AT, SWING_PITCH],
      [1, HEEL_STRIKE_PITCH],
    ]),
  };
}

/**
 * Head-on the step reads only as height, so it takes nearly the full profile
 * lift to be legible at all; the pitch, by contrast, is almost invisible.
 */
const FACING_LIFT_SHARE = 0.95;
const FACING_PITCH_SHARE = 0.5;
const FACING_STRIDE_DRIFT = 0.04;
/** The lift at which the swing leg's shin is drawn at full near-camera width. */
const FULLY_NEAR_LIFT = TUCK_LIFT * FACING_LIFT_SHARE;

/**
 * Walking at the camera. Almost none of the stride is visible head-on, so the
 * step has to be sold by the foot rising and the leg foreshortening rather than
 * by any sideways travel.
 */
function gaitFootFacing(
  phase: number,
  side: number,
): { foot: Pt; pitch: number; nearness: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_SHARE;
  const t = stance ? cycle / STANCE_SHARE : (cycle - STANCE_SHARE) / (1 - STANCE_SHARE);
  const home = side * FOOT_STAND_SPREAD;

  if (stance) {
    return {
      foot: pt(home + FACING_STRIDE_DRIFT * lerp(1, -1, t), 0),
      // The same shape as the profile's, scaled down. Held flat and then jumping
      // to the swing's pitch moves the hock a step sideways on the frame the
      // foot changes phase.
      pitch: keyed(t, [
        [0, HEEL_STRIKE_PITCH * FACING_PITCH_SHARE],
        [0.2, 0],
        [0.75, 0],
        [1, TOE_OFF_PITCH * FACING_PITCH_SHARE],
      ]),
      nearness: 0,
    };
  }
  const lift = keyed(t, [
    [0, 0],
    [TOE_LIFT_AT, TOE_LIFT * FACING_LIFT_SHARE],
    [TUCK_AT, TUCK_LIFT * FACING_LIFT_SHARE],
    [PASS_AT, PASS_LIFT * FACING_LIFT_SHARE],
    [REACH_AT, REACH_LIFT],
    [1, 0],
  ]);
  return {
    foot: pt(home + FACING_STRIDE_DRIFT * lerp(-1, 1, easeInOut(t)), -lift),
    pitch:
      keyed(t, [
        [0, TOE_OFF_PITCH],
        [PASS_AT, SWING_PITCH],
        [1, HEEL_STRIKE_PITCH],
      ]) * FACING_PITCH_SHARE,
    nearness: clamp01(lift / FULLY_NEAR_LIFT),
  };
}

/** The coat streams behind a walking creature rather than shimmering in place. */
const WALK_FUR_TRAIL = 0.35;
/** Walking, the fingers hang half-open and the eyes already burn. */
const WALK_CLAW = 0.45;
const WALK_GLARE = 0.4;
/**
 * Barely there: the shoulders are what carry the *upper* arm, and head-on the
 * upper arm is the part that should not visibly move at all.
 */
const FACING_SHOULDER_TWIST = 0.1;

export function walkSide(phase: number): FuzzyNightmarePose {
  const pose = restingPose();
  const right = gaitFootSide(phase);
  const left = gaitFootSide(phase + 0.5);
  const bobPhase = Math.abs(Math.sin(phase * FULL_TURN));

  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.lean = WALK_LEAN;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;

  const rightForward = -Math.sin(phase * FULL_TURN);
  pose.rightArmAngles = sideArmAngles(rightForward);
  pose.leftArmAngles = sideArmAngles(-rightForward);
  pose.rightClaw = WALK_CLAW;
  pose.leftClaw = WALK_CLAW;
  pose.elbowFlare = WALK_SIDE_ELBOW_FLARE;
  pose.furFlow = -WALK_FUR_TRAIL;
  pose.furPhase = phase * FULL_TURN;
  pose.blink = blink(phase, BLINK_AT);
  pose.glare = WALK_GLARE;
  pose.maw = IDLE_MAW;
  pose.headTurn = SIDE_HEAD_TURN;
  return pose;
}

export function walkFacing(phase: number, away: boolean): FuzzyNightmarePose {
  const pose = restingPose();
  const right = gaitFootFacing(phase, 1);
  const left = gaitFootFacing(phase + 0.5, -1);
  const bobPhase = Math.abs(Math.sin(phase * FULL_TURN));

  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.sway = Math.sin(phase * FULL_TURN) * WALK_SWAY;
  pose.lean = WALK_LEAN;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.rightLegNearness = right.nearness;
  pose.leftLegNearness = left.nearness;
  pose.rightForeshorten = HEAD_ON_KNEE_TUCK;
  pose.leftForeshorten = HEAD_ON_KNEE_TUCK;

  const rightArm = facingArmSwing(phase, RIGHT_ARM, away);
  const leftArm = facingArmSwing(phase, LEFT_ARM, away);
  pose.rightArmAngles = rightArm.angles;
  pose.leftArmAngles = leftArm.angles;
  pose.rightArmBehind = rightArm.behind;
  pose.leftArmBehind = leftArm.behind;
  pose.rightClaw = WALK_CLAW;
  pose.leftClaw = WALK_CLAW;
  pose.twist = Math.sin(phase * FULL_TURN) * FACING_SHOULDER_TWIST;
  pose.furFlow = Math.sin(phase * FULL_TURN) * IDLE_FUR_DRIFT;
  pose.furPhase = phase * FULL_TURN;
  pose.blink = blink(phase, BLINK_AT);
  pose.glare = WALK_GLARE;
  pose.maw = IDLE_MAW;
  pose.headTurn = away ? 0 : Math.sin(phase * FULL_TURN) * FACING_HEAD_SCAN;
  return pose;
}

// ── Arms ─────────────────────────────────────────────────────────────────────

/** `side` is +1 for the arm that swings forward on the beat and −1 for its pair. */
const RIGHT_ARM = 1;
const LEFT_ARM = -1;
/**
 * Shoulder rotation at the top of the forward swing. Small, because these arms
 * are as long as the creature is tall: the same angle the biped figure swings
 * at throws a hand twice as far and turns the walk into a semaphore.
 */
const ARM_SWING_ANGLE = deg(18);
/** An arm swings further forward than back, so the backswing is scaled down. */
const ARM_BACKSWING_SHARE = 0.55;
/** How much of the shoulder's swing the forearm inherits. */
const FOREARM_FOLLOW = 0.22;
/**
 * The bend a walking elbow simply holds. More than a man's: these arms drag
 * along beside it, hands down by its feet, and a straighter arm would scrape
 * its knuckles on the floor.
 */
const ELBOW_FLEX = deg(14);

/** Shoulder rotation for a swing that is `forward` of vertical, −1 to 1. */
function armSwingAngle(forward: number): number {
  const shortened = forward >= 0 ? forward : forward * ARM_BACKSWING_SHARE;
  return shortened * ARM_SWING_ANGLE;
}

/**
 * A profile arm, driven from its joints rather than from a hand target.
 *
 * Almost all of a walking arm's travel belongs to the shoulder; the elbow keeps
 * a near-constant bend and the forearm barely sweeps at all. Placed by its hand
 * the arm cannot do that — both segments are forced to swing together, and the
 * forearm ends up flailing at the full amplitude of the shoulder.
 */
function sideArmAngles(forward: number): ArmAngles {
  const upper = armSwingAngle(forward);
  // Edge-on the swing is all in the picture plane, so nothing foreshortens.
  return { upper, fore: upper * FOREARM_FOLLOW + ELBOW_FLEX, foreScale: 1 };
}

/**
 * A relaxed arm is not a straight rod: the elbow carries a little standing
 * flexion, which is what gives the arm a readable break at the joint and holds
 * it off the ribs. The upper arm therefore tilts out further than the forearm
 * does — elbow outboard, forearm hanging closer to vertical.
 */
const FACING_ELBOW_FLEX = deg(24);
/** Enough halvings to land the wrist inside a thousandth of a tile. */
const TILT_SOLVE_STEPS = 40;

/**
 * The pair of tilts that hold `FACING_ELBOW_FLEX` of bend while still landing
 * the wrist exactly where the idle's hand hangs. Two segments at two angles
 * have no tidy closed form for that, so it is solved by bisection at load.
 */
function solveForearmTilt(): number {
  const wristOffset = HAND_HANG_SPREAD - ARM_ROOT_HALF;
  const reach = (fore: number): number =>
    UPPER_ARM_LENGTH * Math.sin(fore + FACING_ELBOW_FLEX) + FOREARM_LENGTH * Math.sin(fore);
  let low = -Math.PI / 2;
  let high = Math.PI / 2;
  for (let i = 0; i < TILT_SOLVE_STEPS; i++) {
    const mid = (low + high) / 2;
    if (reach(mid) < wristOffset) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

const FACING_FOREARM_TILT = solveForearmTilt();
const FACING_UPPER_TILT = FACING_FOREARM_TILT + FACING_ELBOW_FLEX;

/**
 * The shoulder does move — an arm swinging only at the elbow is a hand waving
 * on a fixed stick. It just moves far less than the elbow does, since head-on
 * the upper arm is close to end-on and has little of its travel to show.
 */
const FACING_UPPER_SWING = deg(4);
/** The forearm still carries most of the visible work at this angle. */
const FACING_FOREARM_SWING = deg(8);
/** How much of its length the forearm loses at the front of the swing. */
const FACING_FOREARM_FORESHORTEN = 0.18;
/** Walking bends the elbow a little past where it hangs standing. */
const WALK_ELBOW_FLEX = deg(6);

/**
 * One head-on arm, `swing` positive as it comes forward and crosses inboard.
 *
 * `forward` runs 0 at the back of the swing to 1 at the front, and drives the
 * foreshortening: an arm swung at the camera turns out of the picture plane, so
 * its forearm draws shorter and carries the hand *up* the body.
 */
function facingArmAngles(side: number, swing: number, forward: number, flex: number): ArmAngles {
  return {
    upper: side * (FACING_UPPER_TILT - swing * FACING_UPPER_SWING),
    fore: side * (FACING_FOREARM_TILT - flex - swing * FACING_FOREARM_SWING),
    foreScale: 1 - forward * FACING_FOREARM_FORESHORTEN,
  };
}

/**
 * One arm of a head-on walk.
 *
 * The travel is inward only: arms swing in a plane just off the body and cross
 * slightly toward the centreline as they come forward, never out away from it.
 * That inward amount has to be a *remapped* swing, not a rectified one — folding
 * the negative half back up gives each arm two inward peaks per stride and the
 * swing then reads at double speed however small the amplitude.
 */
function facingArmSwing(
  phase: number,
  side: number,
  away: boolean,
): { angles: ArmAngles; behind: boolean } {
  const own = Math.sin(phase * FULL_TURN) * side;
  const signedSwing = own >= 0 ? own : own * ARM_BACKSWING_SHARE;
  // Centred on the rest hang, so the *average* of the cycle is where the arms
  // stand. Left uncentred the whole swing sits inboard of the idle and the
  // creature visibly tucks its arms in the moment it starts walking.
  const swing = signedSwing - (1 - ARM_BACKSWING_SHARE) / 2;
  const forward = (own + 1) / 2;
  return {
    angles: facingArmAngles(side, swing, forward, WALK_ELBOW_FLEX),
    // Whole-row, not per-frame: an arm that changes sides partway through the
    // cycle pops at the shoulder.
    behind: away,
  };
}

// ── The swipe ────────────────────────────────────────────────────────────────

/**
 * The rake, in profile, as three positions the hand passes through: drawn back
 * and high over the hump, carried over the top, then raked down and far out in
 * front at the full length of an arm that is longer than the creature is tall.
 *
 * The middle one is not decoration. Swung straight from back to front the hand
 * passes within a hand's breadth of its own shoulder and the elbow folds flat;
 * taking it *over the top* keeps it an arm's length out the whole way round.
 */
const SWIPE_COCK_X = -0.42;
const SWIPE_COCK_Y = -2.25;
const SWIPE_OVER_X = 0.75;
const SWIPE_OVER_Y = -2.25;
const SWIPE_REACH_X = 1.4;
const SWIPE_REACH_Y = -0.62;
/** Where the hand tops out, between the windup and the impact. */
const SWIPE_OVERHEAD_AT = 0.43;
/** How much of the near arm's reach the far one gives up, so they read apart. */
const SWIPE_TRAIL_SHARE = 0.72;
/** Where the off hand is drawn back to, low along the flank, and where it passes. */
const SWIPE_TRAIL_COCK_X = -0.1;
const SWIPE_TRAIL_COCK_Y = -1.0;
const SWIPE_TRAIL_OVER_X = 0.45;
const SWIPE_TRAIL_OVER_Y = -1.05;
const SWIPE_TRAIL_DROP = 0.18;
const SWIPE_LEAN_BACK = deg(-14);
const SWIPE_LEAN_IN = deg(12);
const SWIPE_CROUCH = 0.12;
/** Shoulder rotation at the two ends of the swing, seen as a width shift. */
const SWIPE_TWIST_IN = 0.5;
const SWIPE_TWIST_BACK = 0.35;
/** Edge-on the elbow has to break backward, or the forearm crosses the body. */
const SWIPE_ELBOW_FLARE = -0.6;
/** The profile stance: braced, with the leading foot stepping into the blow. */
const SWIPE_SIDE_LEAD_FOOT = 0.2;
const SWIPE_SIDE_LEAD_STEP = 0.08;
const SWIPE_SIDE_TRAIL_FOOT = -0.22;
const SWIPE_SIDE_TRAIL_PITCH = deg(-7);
/** The head-on stance, which has to hold the mass over both feet at once. */
const SWIPE_FACING_STANCE = 0.24;
/** How far it keeps its face toward the camera while striking in profile. */
const SWIPE_SIDE_HEAD_TURN = 0.35;
/** The head comes *up* as the arms go back, and snaps forward with the rake. */
const SWIPE_HEAD_LIFT = 0.35;
const SWIPE_HEAD_DIP = deg(8);
const SWIPE_FACING_HEAD_DIP = deg(5);
const SWIPE_FACING_LEAN = deg(6);
const SWIPE_LIFT = 0.02;
const SWIPE_FACING_LIFT = 0.03;
/** The coat is thrown by the swing, forward in profile and outward head-on. */
const SWIPE_FUR_THROW = 0.7;
const SWIPE_FACING_FUR_THROW = 0.5;
/** How far the off hand's fingers open against the leading hand's full spread. */
const SWIPE_OFF_CLAW = 0.85;
const SWIPE_FACING_OFF_CLAW = 0.9;
/** The crouch a swing holds throughout, which is what buys the stance width. */
const SWIPE_BRACE = 0.1;

/** Where the impact falls in the row, as progress rather than as a frame. */
const SWIPE_IMPACT_AT = SWIPE_IMPACT_FRAME / (SWIPE_FRAMES - 1);
/**
 * Where the windup reaches its top, and how long it holds there.
 *
 * It has to *hold*: without the second key the arms are still on their way up
 * on the row's second frame, which catches them straight out to the sides — a
 * scarecrow rather than a creature about to hit something.
 */
const SWIPE_COCK_BY = 0.14;
const SWIPE_COCK_UNTIL = 0.3;

/** How wound up the swing is, 0 at rest and 1 fully cocked. */
function cockedShare(t: number): number {
  return keyed(t, [
    [0, 0],
    [SWIPE_COCK_BY, 1],
    [SWIPE_COCK_UNTIL, 1],
    [SWIPE_IMPACT_AT, 0],
    [1, 0],
  ]);
}

/** How far the strike has landed, 0 at rest and 1 at full extension. */
function struckShare(t: number): number {
  return keyed(t, [
    [0, 0],
    [SWIPE_COCK_UNTIL, 0],
    [SWIPE_IMPACT_AT, 1],
    [1, 0],
  ]);
}

/** Piecewise linear interpolation of a hand through a set of (t, point) keys. */
function keyedPoint(t: number, keys: readonly (readonly [number, Pt])[]): Pt {
  return pt(
    keyed(
      t,
      keys.map(([at, p]) => [at, p.x] as const),
    ),
    keyed(
      t,
      keys.map(([at, p]) => [at, p.y] as const),
    ),
  );
}

/**
 * One hand through the whole rake.
 *
 * Both ends of the row land back on the rest hang. An attack that starts
 * already wound up and finishes still following through pops twice on every
 * swing — once as the row is entered and once as it hands back to the idle.
 */
function swipeHand(t: number, rest: Pt, cocked: Pt, over: Pt, struck: Pt): Pt {
  return keyedPoint(t, [
    [0, rest],
    [SWIPE_COCK_BY, cocked],
    [SWIPE_COCK_UNTIL, cocked],
    [SWIPE_OVERHEAD_AT, over],
    [SWIPE_IMPACT_AT, struck],
    [1, rest],
  ]);
}

export function swipeSide(t: number): FuzzyNightmarePose {
  const struck = struckShare(t);
  const cocked = cockedShare(t);
  const committed = Math.max(struck, cocked);
  const pose = restingPose();

  pose.lean = SWIPE_LEAN_IN * struck + SWIPE_LEAN_BACK * cocked;
  pose.crouch = SWIPE_BRACE + SWIPE_CROUCH * cocked;
  pose.twist = SWIPE_TWIST_IN * struck - SWIPE_TWIST_BACK * cocked;
  pose.bob = -SWIPE_LIFT * struck;
  pose.headRaise = SWIPE_HEAD_LIFT * cocked;

  pose.rightHand = swipeHand(
    t,
    SIDE_REST_HAND,
    pt(SWIPE_COCK_X, SWIPE_COCK_Y),
    pt(SWIPE_OVER_X, SWIPE_OVER_Y),
    pt(SWIPE_REACH_X, SWIPE_REACH_Y),
  );
  // The off arm stays low — drawn back along its flank and then thrown forward
  // under the near one — so the two claws read as one rake. Raised overhead
  // together the pair is a cheer.
  pose.leftHand = swipeHand(
    t,
    pt(SIDE_REST_HAND.x - SIDE_FAR_HAND_BEHIND, SIDE_REST_HAND.y),
    pt(SWIPE_TRAIL_COCK_X, SWIPE_TRAIL_COCK_Y),
    pt(SWIPE_TRAIL_OVER_X, SWIPE_TRAIL_OVER_Y),
    pt(SWIPE_REACH_X * SWIPE_TRAIL_SHARE, SWIPE_REACH_Y + SWIPE_TRAIL_DROP),
  );
  pose.rightClaw = lerp(RESTING_CLAW, FULL_CLAW, committed);
  pose.leftClaw = lerp(RESTING_CLAW, SWIPE_OFF_CLAW, committed);
  pose.elbowFlare = SWIPE_ELBOW_FLARE;

  pose.rightFoot = pt(
    lerp(IDLE_SIDE_FOOT_LEAD, SWIPE_SIDE_LEAD_FOOT + SWIPE_SIDE_LEAD_STEP * struck, committed),
    0,
  );
  pose.leftFoot = pt(lerp(-IDLE_SIDE_FOOT_LEAD, SWIPE_SIDE_TRAIL_FOOT, committed), 0);
  pose.leftFootPitch = SWIPE_SIDE_TRAIL_PITCH * struck;
  pose.glare = committed;
  pose.maw = lerp(IDLE_MAW, 1, easeInOut(committed));
  pose.headTurn = lerp(SIDE_HEAD_TURN, SWIPE_SIDE_HEAD_TURN, committed);
  pose.headTilt = SWIPE_HEAD_DIP * struck;
  pose.furFlow = -SWIPE_FUR_THROW * struck;
  pose.furPhase = struck * Math.PI;
  return pose;
}

/**
 * The head-on rake is driven from joint angles rather than from hand targets,
 * and that is not a stylistic choice.
 *
 * A two-bone solver decides which way the elbow pops from the sign of a single
 * flare value, and "outward" flips sign the moment the hand crosses the
 * shoulder — so a hand target swung from over the head down past the hip needs
 * the *opposite* flare at each end, and no single value gives elbows-out for
 * both. Angles have no such ambiguity.
 *
 * 0 is straight down and positive swings toward +X, so the right arm sweeps
 * from up and out to the side, down and across the front, and the left mirrors
 * it a beat behind.
 */
/**
 * How far behind the leading arm the off one trails.
 *
 * Both arms raised together in a symmetric V is the universal cheer. Offsetting
 * the second arm by a beat turns the same motion into a rake: one claw is
 * already coming down while the other is still going up.
 */
const SMASH_OFF_ARM_LAG = 0.18;
/**
 * Out to the side and only a little above the shoulder, fingers hooked up and
 * in: held any higher the two arms make the cheer.
 */
const SMASH_UPPER_RAISED = deg(105);
const SMASH_FOREARM_RAISED = deg(150);
/** Raked down and in across the front, as low as the knees. */
const SMASH_UPPER_DROPPED = deg(-8);
const SMASH_FOREARM_DROPPED = deg(-38);
/**
 * The elbow folds *through* the swing and only opens again at impact, which is
 * what an overhand strike does — and what keeps the frame narrow. Left to
 * travel straight, an arm this long sweeps its claws two full tiles out from
 * the centreline on the way past horizontal, and every row on the sheet then
 * pays for a cell wide enough to hold that one frame.
 */
const SMASH_FOREARM_MIDSWING = deg(30);
const SMASH_MIDSWING_AT = 0.43;
/** The claws end up nearer the camera than they started, so they draw shorter. */
const SMASH_FOREARM_FORESHORTEN = 0.18;

/** One arm's angles at `t` through the rake. */
function smashArm(t: number, side: number): ArmAngles {
  const upper = keyed(t, [
    [0, FACING_UPPER_TILT],
    [SWIPE_COCK_BY, SMASH_UPPER_RAISED],
    [SWIPE_COCK_UNTIL, SMASH_UPPER_RAISED],
    [SWIPE_IMPACT_AT, SMASH_UPPER_DROPPED],
    [1, FACING_UPPER_TILT],
  ]);
  const fore = keyed(t, [
    [0, FACING_FOREARM_TILT],
    [SWIPE_COCK_BY, SMASH_FOREARM_RAISED],
    [SWIPE_COCK_UNTIL, SMASH_FOREARM_RAISED],
    [SMASH_MIDSWING_AT, SMASH_FOREARM_MIDSWING],
    [SWIPE_IMPACT_AT, SMASH_FOREARM_DROPPED],
    [1, FACING_FOREARM_TILT],
  ]);
  const foreScale = 1 - struckShare(t) * SMASH_FOREARM_FORESHORTEN;
  return { upper: side * upper, fore: side * fore, foreScale };
}

/**
 * The attack seen head-on: both claws driven up and out over the cowl of its
 * back and raked down across the front. A swipe *at* the camera has no
 * sideways travel to read, so the height the hands lose is the whole of the
 * motion.
 */
function swipeFacing(t: number, away: boolean): FuzzyNightmarePose {
  const struck = struckShare(t);
  const cocked = cockedShare(t);
  const committed = Math.max(struck, cocked);
  const pose = restingPose();

  pose.crouch = SWIPE_BRACE + SWIPE_CROUCH * cocked;
  pose.bob = -SWIPE_FACING_LIFT * struck;
  pose.lean = SWIPE_FACING_LEAN * struck;
  pose.headRaise = SWIPE_HEAD_LIFT * cocked;

  pose.rightArmAngles = smashArm(t, RIGHT_ARM);
  // The off arm runs the same keys compressed into the rest of the row, so it
  // starts late and still lands home on the row's last frame.
  pose.leftArmAngles = smashArm(
    Math.max(0, (t - SMASH_OFF_ARM_LAG) / (1 - SMASH_OFF_ARM_LAG)),
    LEFT_ARM,
  );
  pose.rightClaw = lerp(RESTING_CLAW, FULL_CLAW, committed);
  pose.leftClaw = lerp(RESTING_CLAW, SWIPE_FACING_OFF_CLAW, committed);

  const stance = lerp(FOOT_STAND_SPREAD, SWIPE_FACING_STANCE, committed);
  pose.leftFoot = pt(-stance, 0);
  pose.rightFoot = pt(stance, 0);
  pose.leftForeshorten = HEAD_ON_KNEE_TUCK;
  pose.rightForeshorten = HEAD_ON_KNEE_TUCK;
  pose.glare = committed;
  pose.maw = lerp(IDLE_MAW, 1, easeInOut(committed));
  pose.headTilt = SWIPE_FACING_HEAD_DIP * struck;
  pose.furFlow = SWIPE_FACING_FUR_THROW * struck;
  pose.furPhase = struck * Math.PI;
  // Away from the camera both arms are behind the body for the whole row, so
  // the rake reads as the shoulders working rather than as hands in mid-air.
  pose.leftArmBehind = away;
  pose.rightArmBehind = away;
  return pose;
}

// ── The breach ───────────────────────────────────────────────────────────────

/**
 * Under a smashed floor, groping.
 *
 * Deep enough that nothing of it clears the lip but one arm: the fingers come
 * up through the grate first, and the head only follows once the boards give.
 *
 * The barrier's boards are painted before mobs are, so everything this row
 * draws lands on top of them. An arm through a gap in boards genuinely is in
 * front of them, seen from above — but a face pressed to their underside is
 * not, so the head stays under.
 */
const BREACH_DEPTH = 0.93;
const BREACH_HEAVE = 0.03;
/**
 * The groping hand's circle, in *screen* space above the floor line — the hole
 * does not sink with the creature, so a circle authored in figure space would
 * put the hand a tile and a half underground.
 */
const GROPE_CENTRE_X = 0.26;
const GROPE_CENTRE_Y = -0.37;
/**
 * Wide in *height* rather than in width. The arc has to read as a hand going
 * round, and a flat side-to-side sweep is a wave — but the width is what sets
 * the cell size for all eleven rows, and a groping hand thrown out past the
 * body costs every other row the pixels to hold it.
 */
const GROPE_RADIUS_X = 0.3;
const GROPE_RADIUS_Y = 0.14;
/**
 * The off hand, kept down inside the hole where the clip hides it. One hand out
 * of a hole is the better picture, and with the shoulders this far under there
 * is nowhere for a second hand to grip.
 */
const GRIP_X = -0.7;
const GRIP_Y = 0.75;
const GRIP_SHUDDER = 0.03;
/** How wide the groping hand opens and closes as it feels around. */
const GROPE_CLAW_MIN = 0.35;
const GROPE_CLAW_RANGE = 0.65;
/** The off hand stays half-closed; it is out of sight below the floor anyway. */
const GRIP_CLAW = 0.3;
/** Elbows break outward, away from the hole's own rim. */
const BREACH_ELBOW_FLARE = 0.9;
/** The coat stirs as the body heaves against the boards. */
const BREACH_FUR_STIR = 0.2;
/** How many times the hand closes on nothing per sweep of the arc. */
const GRASPS_PER_SWEEP = 2;

/** Opens and closes twice per sweep, 0 for a slack hand and 1 for a full grab. */
function grasp(sweep: number): number {
  return (1 - Math.cos(sweep * GRASPS_PER_SWEEP)) / 2;
}

export function breach(phase: number): FuzzyNightmarePose {
  const pose = restingPose();
  const heave = Math.sin(phase * FULL_TURN);
  pose.submerged = BREACH_DEPTH - heave * BREACH_HEAVE;
  // No hole is painted on this row. It only ever plays over a *barricaded*
  // grate, and the grate's own shaft already shows dark between those boards.
  // Painting a hole here would black out the planks it is coming through.
  pose.breach = false;

  // The arm sweeps a full circle once per loop, which is what "reaching around"
  // is: a hand that only rocks side to side reads as a wave.
  const sweep = phase * FULL_TURN;
  const sunk = pose.submerged * SUBMERGE_DEPTH;
  pose.rightHand = pt(
    GROPE_CENTRE_X + Math.cos(sweep) * GROPE_RADIUS_X,
    GROPE_CENTRE_Y + Math.sin(sweep) * GROPE_RADIUS_Y - sunk,
  );
  pose.leftHand = pt(GRIP_X, GRIP_Y + Math.sin(sweep * GRASPS_PER_SWEEP) * GRIP_SHUDDER - sunk);
  // Fingers open and close through the sweep: a hand groping for something is
  // grasping, and a fixed spread reads as a prop hand on a stick.
  pose.rightClaw = GROPE_CLAW_MIN + GROPE_CLAW_RANGE * grasp(sweep);
  pose.leftClaw = GRIP_CLAW;
  pose.elbowFlare = BREACH_ELBOW_FLARE;
  pose.glare = FULL_GLARE;
  pose.blink = blink(phase, BLINK_AT);
  pose.furFlow = heave * BREACH_FUR_STIR;
  pose.furPhase = phase * FULL_TURN;
  return pose;
}

// ── The emergence ────────────────────────────────────────────────────────────

/** Where the climb starts: fully under, nothing showing yet but the hole. */
const EMERGE_START_DEPTH = 1;
/**
 * The three beats of the row, as shares of it: the hands come up out of the
 * hole and plant on the lip while the body waits below; then the body hauls up
 * between them, head craned up so it breaks the floor first; then it settles
 * into its crouch.
 */
const EMERGE_HANDS_UP_BY = 0.25;
const EMERGE_RISE_END = 0.8;
/**
 * How wide the hands plant to push against — outside the hole, flat on the
 * floor beside it, which is how anything hauls itself out of a hole.
 */
const EMERGE_PLANT_X = 0.8;
/** How far above the lip the palms sit while they are bearing weight. */
const EMERGE_PLANT_LIFT = 0.06;
/** Where the hands start, still down inside the hole. */
const EMERGE_HANDS_START_X = 0.25;
const EMERGE_HANDS_START_Y = 0.1;
/**
 * Where the fingers reach to first, straight up out of the hole, before they
 * spread out and come down on the floor beside it: a hand that rises flat and
 * slides sideways onto the lip reads as a starfish, not as something reaching.
 */
const EMERGE_REACH_X = 0.4;
const EMERGE_REACH_Y = -0.45;
/** Where in the hands' beat the reach tops out. */
const EMERGE_REACH_AT = 0.55;
/**
 * When the hands let go of the rim, measured against how far the body has
 * *risen* rather than against the row's own clock — the reach is a function of
 * the height, so the release has to be too.
 */
const EMERGE_RELEASE_FROM = 0.45;
const EMERGE_RELEASE_BY = 0.85;
const EMERGE_CROUCH = 0.45;
/** How far through the rise the head stays craned, then sinks back into the hunch. */
const EMERGE_HEAD_CLEAR_FROM = 0.35;
const EMERGE_HEAD_CLEAR_BY = 0.85;
/** It climbs out bent over its own hands, not standing up. */
const EMERGE_HUNCH = deg(14);
/** How hard it grips the lip while it is bearing its own weight on the rim. */
const EMERGE_GRIP_CLAW = 0.9;
/** How wide its jaw goes with the effort of the haul. */
const EMERGE_STRAIN = 0.7;
/** The coat still hangs out of the hole for the first frames of the climb. */
const EMERGE_FUR_DRAG = 0.4;

/**
 * Hauling itself out: fingers first, then the head, then the rest of it.
 *
 * The last frame has to be the idle's first, or the hand-off from this row back
 * to standing pops.
 */
export function emerge(t: number): FuzzyNightmarePose {
  const handsUp = easeInOut(ramp(t, 0, EMERGE_HANDS_UP_BY));
  const risen = easeInOut(ramp(t, EMERGE_HANDS_UP_BY, EMERGE_RISE_END));
  const settle = ramp(t, EMERGE_RISE_END, 1);
  const pose = restingPose();

  pose.submerged = EMERGE_START_DEPTH * (1 - risen);
  pose.breach = true;
  pose.crouch = EMERGE_CROUCH * risen * (1 - settle);
  // Craned up only while the head is breaking the floor, so it clears ahead of
  // the hump, then lowered back into the hunch for the rest of the climb: a
  // creature hauled out upright reads as a lift coming up a shaft.
  pose.headRaise = 1 - easeInOut(ramp(risen, EMERGE_HEAD_CLEAR_FROM, EMERGE_HEAD_CLEAR_BY));
  pose.lean = EMERGE_HUNCH * risen * (1 - settle);

  // The hands stay planted on the lip of the hole while the body climbs between
  // them, which is what makes it read as pushing rather than as floating up.
  // The rim does not move with the creature, so the plant is placed in *screen*
  // space and the pose's own submergence taken back off it.
  const sunk = pose.submerged * SUBMERGE_DEPTH;
  const plantY = BREACH_FLOOR_Y - EMERGE_PLANT_LIFT;
  const release = easeInOut(ramp(risen, EMERGE_RELEASE_FROM, EMERGE_RELEASE_BY));
  for (const side of [LEFT_ARM, RIGHT_ARM]) {
    const fromHole = pt(side * EMERGE_HANDS_START_X, EMERGE_HANDS_START_Y);
    const plant = pt(side * EMERGE_PLANT_X, plantY);
    const hang = pt(side * HAND_HANG_SPREAD, SHOULDER_Y + HAND_HANG_DROP + sunk);
    const reach = pt(side * EMERGE_REACH_X, EMERGE_REACH_Y);
    const reaching = keyedPoint(handsUp, [
      [0, fromHole],
      [EMERGE_REACH_AT, reach],
      [1, plant],
    ]);
    const screen = pt(lerp(reaching.x, hang.x, release), lerp(reaching.y, hang.y, release));
    const hand = pt(screen.x, screen.y - sunk);
    if (side === LEFT_ARM) pose.leftHand = hand;
    else pose.rightHand = hand;
  }
  pose.rightClaw = lerp(EMERGE_GRIP_CLAW, RESTING_CLAW, release);
  pose.leftClaw = lerp(EMERGE_GRIP_CLAW, RESTING_CLAW, release);
  // Relaxes with the grip. Held at the pushing-off flare all the way to the end
  // of the row, the elbows stay bowed out over a hand already back at its hang.
  pose.elbowFlare = lerp(BREACH_ELBOW_FLARE, RESTING_ELBOW_FLARE, release);

  pose.leftFoot = pt(-FOOT_STAND_SPREAD, 0);
  pose.rightFoot = pt(FOOT_STAND_SPREAD, 0);
  pose.leftForeshorten = HEAD_ON_KNEE_TUCK;
  pose.rightForeshorten = HEAD_ON_KNEE_TUCK;
  pose.glare = FULL_GLARE * (1 - settle);
  pose.maw = EMERGE_STRAIN * risen * (1 - settle);
  pose.furFlow = (1 - risen) * EMERGE_FUR_DRAG;
  pose.furPhase = t * FULL_TURN;
  return pose;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: FuzzyNightmareView;
  readonly kind: RowKind;
  readonly pose: (frame: number) => FuzzyNightmarePose;
}

/** Loops sample the cycle evenly; one-shots sample the frame's own position. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return frame / (frameCount - 1);
}

export const FUZZY_NIGHTMARE_ROWS: readonly RowSpec[] = [
  {
    name: 'idle',
    frameCount: IDLE_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (f) => idleFront(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_side',
    frameCount: IDLE_FRAMES,
    view: 'side',
    kind: 'loop',
    pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_away',
    frameCount: IDLE_FRAMES,
    view: 'back',
    kind: 'loop',
    pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), false),
  },
  {
    name: 'walk_side',
    frameCount: WALK_FRAMES,
    view: 'side',
    kind: 'loop',
    pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: WALK_FRAMES,
    view: 'back',
    kind: 'loop',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), true),
  },
  {
    name: 'swipe',
    frameCount: SWIPE_FRAMES,
    view: 'front',
    kind: 'oneShot',
    pose: (f) => swipeFacing(shotProgress(f, SWIPE_FRAMES), false),
  },
  {
    name: 'swipe_side',
    frameCount: SWIPE_FRAMES,
    view: 'side',
    kind: 'oneShot',
    pose: (f) => swipeSide(shotProgress(f, SWIPE_FRAMES)),
  },
  {
    name: 'swipe_away',
    frameCount: SWIPE_FRAMES,
    view: 'back',
    kind: 'oneShot',
    pose: (f) => swipeFacing(shotProgress(f, SWIPE_FRAMES), true),
  },
  {
    name: 'breach',
    frameCount: BREACH_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (f) => breach(cyclePhase(f, BREACH_FRAMES)),
  },
  {
    name: 'emerge',
    frameCount: EMERGE_FRAMES,
    view: 'front',
    kind: 'oneShot',
    pose: (f) => emerge(shotProgress(f, EMERGE_FRAMES)),
  },
];

function paintView(
  ctx: CanvasRenderingContext2D,
  view: FuzzyNightmareView,
  pose: FuzzyNightmarePose,
): void {
  if (view === 'front') drawFuzzyNightmareFront(ctx, pose);
  else if (view === 'back') drawFuzzyNightmareBack(ctx, pose);
  else drawFuzzyNightmareSide(ctx, pose);
}

/**
 * The cell every pose is painted into, and where the creature's own tile sits
 * inside it.
 *
 * These numbers come from painting every frame of every row onto an oversized
 * canvas, taking the widest reach in each direction from the ground point, and
 * adding `FRAME_PADDING` before rounding up to `FRAME_SIZE_QUANTUM`. Nothing
 * can measure ink at runtime, so the answer is frozen here and
 * `scripts/gates-fuzzy-nightmare.ts` re-measures it on every render: a pose
 * that grows past the cell is sheared flat by the blit and baked in, and
 * nothing downstream can see it happen.
 */
const FRAME_WIDTH = 184;
const FRAME_HEIGHT = 152;
const TILE_X = 60;
const TILE_Y = 77;

/** Clear space kept around the widest frame, so nothing sits on a cell border. */
export const FRAME_PADDING = 5;
/** Cell dimensions are rounded up to this, which keeps the blits aligned. */
export const FRAME_SIZE_QUANTUM = 8;

/** Poses are painted with the origin on the ground line, at the cell's centre. */
const POSE_ORIGIN_X = FRAME_WIDTH / 2;
const POSE_ORIGIN_Y = TILE_Y + GROUND_OFFSET_PX;

function poseRowOf(state: string): RowSpec {
  const row = FUZZY_NIGHTMARE_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) throw new Error(`no fuzzy nightmare row for "${state}"`);
  return row;
}

/** Paints one cell of the Fuzzy Nightmare, in the cell's own pixels. */
function paintFuzzyNightmareFrame(
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
): void {
  const row = poseRowOf(state);
  ctx.save();
  ctx.translate(POSE_ORIGIN_X, POSE_ORIGIN_Y);
  ctx.scale(TILE_SCALE * FIGURE_SCALE, TILE_SCALE * FIGURE_SCALE);
  paintView(ctx, row.view, row.pose(frame));
  ctx.restore();
}

function fuzzyNightmareStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of FUZZY_NIGHTMARE_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

export const FUZZY_NIGHTMARE_FIGURE: FigureDef = {
  id: 'fuzzy_nightmare',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(fuzzyNightmareStateFrames()),
  paintFrame: paintFuzzyNightmareFrame,
};

// ── Eye shine ────────────────────────────────────────────────────────────────

/** Where the ground line sits in a tile, as a share of the tile from its top. */
const GROUND_IN_TILE = GROUND_OFFSET_PX / TILE_SCALE;
/** The tile's centre, as a share of the tile from its left edge. */
const TILE_CENTRE = 0.5;

/** A figure-space point in tiles from the tile's top-left. */
function inTiles(point: Pt): Pt {
  return pt(TILE_CENTRE + point.x * FIGURE_SCALE, GROUND_IN_TILE + point.y * FIGURE_SCALE);
}

function eyeAt(view: FuzzyNightmareView, index: number): Pt {
  const eyes = restingEyeCentres(view);
  const eye = eyes[Math.min(index, eyes.length - 1)];
  return inTiles(eye);
}

/** Its pinprick eyes, read off the resting skeleton the painter draws them on. */
const SIDE_EYE = eyeAt('side', 0);
const FRONT_LEFT_EYE = eyeAt('front', 0);
const FRONT_RIGHT_EYE = eyeAt('front', 1);

/** Profile shows one eye; the far one sits a hair behind it, mostly hidden. */
const SIDE_EYE_SPACING = 0.03;

export const FUZZY_NIGHTMARE_EYE_PLACEMENT: ViewedEyePlacement = {
  sideForward: SIDE_EYE.x - TILE_CENTRE,
  sideHeight: SIDE_EYE.y,
  sideSpacing: SIDE_EYE_SPACING,
  frontMirrors: false,
  frontAcross: (FRONT_LEFT_EYE.x + FRONT_RIGHT_EYE.x) / 2 - TILE_CENTRE,
  frontHeight: FRONT_LEFT_EYE.y,
  frontSpacing: FRONT_RIGHT_EYE.x - FRONT_LEFT_EYE.x,
};
