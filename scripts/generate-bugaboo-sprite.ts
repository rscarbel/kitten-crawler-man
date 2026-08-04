#!/usr/bin/env tsx
/**
 * Generates the `bugaboo` sprite sheet — the seven-foot, obsidian-haired thing
 * that comes up through the floor grates, and the shape Mordecai wears on
 * level 2.
 *
 * The anatomy and the painting live in `scripts/bugabooArt.ts`; this file is
 * only the choreography: one pose function per animation row, sampled per
 * frame, plus the sheet geometry.
 *
 * Rows (see the `bugaboo` entry in src/images/npcs/manifest.json):
 *    0 idle          — toward the camera, breathing, coat shifting
 *    1 idle_side     — profile, drawn facing +X and mirrored at runtime
 *    2 idle_away     — away from the camera
 *    3 walk
 *    4 walk_side
 *    5 walk_away
 *    6 swipe         — a two-clawed rake at something in front of it
 *    7 swipe_side
 *    8 swipe_away
 *    9 breach        — half out of a smashed floor, groping around the hole
 *   10 emerge        — hauling itself the rest of the way out
 *
 * `breach` is the one the defend quest plays while a Bugaboo is still working
 * on a barricaded grate, and `emerge` is what it plays the moment the boards
 * give. Standing on a breach is what the arm coming out of it damages, so those
 * two rows are gameplay as much as art.
 *
 * The bake gates are the entry point (`npm run gen:bugaboo` →
 * `generate-bugaboo-sprite.gates.ts`), not this file: a sheet that fails a gate
 * must never reach disk.
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import { clamp01, deg, easeInOut, lerp, ramp } from './carlArt.js';
import {
  ARM_ROOT_HALF,
  FOOT_STAND_SPREAD,
  FOREARM_LENGTH,
  BREACH_FLOOR_Y,
  HAND_HANG_DROP,
  HAND_HANG_SPREAD,
  RESTING_CLAW,
  RESTING_ELBOW_FLARE,
  SHOULDER_Y,
  SUBMERGE_DEPTH,
  UPPER_ARM_LENGTH,
  type ArmAngles,
  type BugabooPose,
  type BugabooView,
  type Pt,
  drawBugabooBack,
  drawBugabooFront,
  drawBugabooSide,
  pt,
  restingPose,
} from './bugabooArt.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/**
 * Where the floor sits inside the tile, matching the cat's and Carl's foot
 * placement so the three stand on the same line.
 */
export const GROUND_OFFSET_PX = 58;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** Clear space kept around the widest frame, so nothing sits on a cell border. */
const FRAME_PADDING = 5;
/** Cell dimensions are rounded up to this, which keeps the blits aligned. */
const FRAME_SIZE_QUANTUM = 8;

/**
 * How much of a tile the creature fills. The anatomy is authored at a
 * comfortable working size and then scaled about its own ground line, which
 * keeps the feet on the tile they belong to. Set against Carl, who stands 1.46
 * tiles at his own scale: seven feet against six is a fifth taller, and this is
 * the factor that lands it there.
 */
export const FIGURE_SCALE = 0.72;

const IDLE_FRAMES = 8;
/**
 * Twice the frames of the other cycles. The walk is the animation that plays
 * most and travels furthest, so it is the one where 8 steps read as a stutter;
 * these are half-steps, not extra motion.
 */
const WALK_FRAMES = 16;
const SWIPE_FRAMES = 8;
export const BREACH_FRAMES = 12;
export const EMERGE_FRAMES = 12;

/**
 * `Bugaboo` fires its claw damage at the middle of the swing, so every swipe
 * row has to reach full extension exactly here.
 */
export const SWIPE_IMPACT_FRAME = 4;

// ── Pose helpers ─────────────────────────────────────────────────────────────

const FULL_TURN = Math.PI * 2;
/** Claws fully splayed, and eyes fully fixed on something. */
const FULL_CLAW = 1;
const FULL_GLARE = 1;
/**
 * `foreshorten` at 1: the knee is pulled onto the hip→ankle line and the leg is
 * a straight column. Every head-on pose wants this on *both* legs — a bow that
 * shows on one and not the other flickers once per step.
 */
const STRAIGHT_COLUMN = 1;

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
 * A blink centred on `at`, expressed in cycle phase. Owl eyes this size are the
 * only feature on the creature, so a blink is the whole of its idle "life".
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
 * Standing still has to read as *alive*, not as swaying. Every idle term here
 * is deliberately near the threshold of visibility at a 32px tile — except the
 * coat, which is the one thing on this creature that should never be still.
 */
/**
 * A breath *settles* the creature rather than lifting it. Standing, its legs
 * are within half a percent of its own hip height, so even eight thousandths of
 * a tile of rise puts both planted feet past the end of their legs and the idle
 * bakes with the knees locked and the feet off the floor.
 */
const BREATH_SETTLE = 0.006;
const BREATH_LEAN = deg(0.5);
const IDLE_SWAY = 0.008;
const IDLE_HEAD_TURN = 0.06;
const IDLE_FUR_DRIFT = 0.1;
/** Standing, the arms drift by a fraction of the walk's swing. */
const IDLE_ARM_DRIFT = 0.08;
/** How far it keeps its face toward the camera while standing in profile. */
const SIDE_HEAD_TURN = 0.2;
/** Walking, it carries its face a little further round toward the camera. */
const WALK_HEAD_TURN = 0.05;
/** How far behind the hip the hands hang in profile. */
const SIDE_HAND_BEHIND = 0.05;
/**
 * Edge-on the two feet are only slightly staggered: a wide profile stance
 * splits the legs so far fore-and-aft that the mass no longer sits over either.
 */
const IDLE_SIDE_FOOT_LEAD = 0.07;
/**
 * Edge-on the elbow has to break *backward*: forward it swings the forearm
 * across the creature's own front. It breaks further back through a walk than
 * standing still, because the elbow trails the shoulder through the swing.
 */
const SIDE_ELBOW_FLARE = -0.35;
const WALK_SIDE_ELBOW_FLARE = -0.5;

function idleBase(phase: number): BugabooPose {
  const breath = Math.sin(phase * FULL_TURN);
  const pose = restingPose();
  pose.bob = BREATH_SETTLE * (breath * 0.5 + 0.5);
  pose.lean = BREATH_LEAN * breath;
  pose.blink = blink(phase, BLINK_AT);
  pose.furFlow = breath * IDLE_FUR_DRIFT;
  pose.furPhase = phase * FULL_TURN;
  return pose;
}

function idleFront(phase: number): BugabooPose {
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
  // Straight columns, matching the head-on walk, so standing up out of a step
  // does not pop the knees into a bow.
  pose.leftForeshorten = STRAIGHT_COLUMN;
  pose.rightForeshorten = STRAIGHT_COLUMN;
  return pose;
}

function idleSide(phase: number): BugabooPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * FULL_TURN);
  // Edge-on a relaxed hand hangs beside the hip, not out in front of it:
  // anything forward of the centreline reads as reaching for something.
  // Both hands ride the breath rather than one of them opposing it: the hang is
  // already at 99% of the arm's reach, so a hand pushed even a hundredth below
  // the shoulder's own drop is a target the solver has to clamp.
  pose.leftHand = pt(-SIDE_HAND_BEHIND, SHOULDER_Y + HAND_HANG_DROP + pose.bob);
  pose.rightHand = pt(-SIDE_HAND_BEHIND * 0.4, SHOULDER_Y + HAND_HANG_DROP + pose.bob * 0.6);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD, 0);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD, 0);
  pose.headTurn = SIDE_HEAD_TURN + sway * IDLE_HEAD_TURN;
  pose.elbowFlare = SIDE_ELBOW_FLARE;
  return pose;
}

function idleBack(phase: number): BugabooPose {
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
 * Short, and it has to be. The legs are very nearly as long as the hips are
 * high, so a foot planted much further out than this is beyond a leg's reach:
 * the IK clamps at the end of stance, the leg locks dead straight, and the next
 * frame's tuck snaps the knee back in — the hitch that reads as a hop.
 */
const STRIDE = 0.22;
/**
 * The pelvis *drops* at contact rather than rising at mid-stance. A walking leg
 * is nearly as long as the hip is high, so a foot planted a stride ahead is out
 * of reach from the standing height; dropping the hip is what buys the stride,
 * and it is what a real pelvis does anyway.
 */
const WALK_BOB = 0.055;
const WALK_LEAN = deg(2.5);
const WALK_SWAY = 0.018;
/** How far the head scans side to side as it comes at the camera. */
const FACING_HEAD_SCAN = 0.12;
const HEEL_STRIKE_PITCH = deg(-8);
const TOE_OFF_PITCH = deg(12);
const SWING_PITCH = deg(-6);

/**
 * The tuck is what makes a walk read as walking rather than as a figure kicking
 * its feet out in front of it: after toe-off the foot comes up behind the hip
 * with the knee folded, passes under the body, and only then reaches forward.
 */
const TUCK_LIFT = 0.2;
/** The first, small lift as the toe leaves the floor. */
const TOE_LIFT = 0.055;
const TOE_LIFT_AT = 0.12;
/** Foot height as it passes under the hip. */
const PASS_LIFT = 0.13;
/** Foot height as it reaches out for the next contact. */
const REACH_LIFT = 0.035;
/** Where in the swing the tuck, the pass and the reach fall. */
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;
/** Half the cycle is stance and half is swing. */
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
      // Heel strike, flat through mid-stance, then up onto the toes to push off.
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
      // to the swing's pitch moves the ankle a step sideways on the frame the
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

export function walkSide(phase: number): BugabooPose {
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
  pose.headTurn = SIDE_HEAD_TURN + WALK_HEAD_TURN;
  return pose;
}

/** The coat streams behind a walking creature rather than shimmering in place. */
const WALK_FUR_TRAIL = 0.35;
/** Walking, the claws hang half-open and the eyes are already narrowed. */
const WALK_CLAW = 0.4;
const WALK_GLARE = 0.3;
/**
 * Barely there: the shoulders are what carry the *upper* arm, and head-on the
 * upper arm is the part that should not visibly move at all.
 */
const FACING_SHOULDER_TWIST = 0.1;

export function walkFacing(phase: number, away: boolean): BugabooPose {
  const pose = restingPose();
  const right = gaitFootFacing(phase, 1);
  const left = gaitFootFacing(phase + 0.5, -1);
  const bobPhase = Math.abs(Math.sin(phase * FULL_TURN));

  // The pelvis drops at contact head-on for the same reason it does in profile,
  // even though almost none of the stride is visible from here: standing, this
  // creature's legs are already within half a percent of its hip height, so a
  // pelvis that *rises* at any point puts the planted foot beyond its own leg
  // and the frame bakes with that leg locked straight, its foot in the air.
  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.sway = Math.sin(phase * FULL_TURN) * WALK_SWAY;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.rightLegNearness = right.nearness;
  pose.leftLegNearness = left.nearness;
  // Both legs, not just the swinging one: a bow that appears on the planted leg
  // and vanishes on the swinging one flickers once per step and reads as a
  // wiggle. Head-on, every knee is a straight column.
  pose.rightForeshorten = STRAIGHT_COLUMN;
  pose.leftForeshorten = STRAIGHT_COLUMN;

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
  pose.headTurn = away ? 0 : Math.sin(phase * FULL_TURN) * FACING_HEAD_SCAN;
  return pose;
}

// ── Arms ─────────────────────────────────────────────────────────────────────

/** `side` is +1 for the arm that swings forward on the beat and −1 for its pair. */
const RIGHT_ARM = 1;
const LEFT_ARM = -1;
/**
 * Shoulder rotation at the top of the forward swing. Small, because these arms
 * are nearly a tile and a half long: the same angle Carl swings at throws a
 * Bugaboo's hand twice as far and turns the walk into a semaphore.
 */
const ARM_SWING_ANGLE = deg(21);
/** An arm swings further forward than back, so the backswing is scaled down. */
const ARM_BACKSWING_SHARE = 0.55;
/** How much of the shoulder's swing the forearm inherits. */
const FOREARM_FOLLOW = 0.22;
/** The bend a walking elbow simply holds, keeping the forearm ahead of the arm. */
const ELBOW_FLEX = deg(9);

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
const FACING_ELBOW_FLEX = deg(6);
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
 * its forearm draws shorter and carries the hand *up* the body. Without that
 * the hand tracks a flat arc at one height, which is the last thing that keeps
 * a head-on walk from looking like a walk.
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
 * The rake. Both arms come up and over and are dragged down across whatever is
 * in front of it, claws splayed and maw open — the arms are the whole attack,
 * because a creature this thin in the limb has nothing else to swing.
 */
/**
 * The profile rake, as three positions the hand passes through: drawn back and
 * up, carried over the skull, then thrown forward and down.
 *
 * The middle one is not decoration. Swung straight from back to front the hand
 * passes within a hand's breadth of its own shoulder, the elbow folds to under
 * 20°, and for two frames the arm is a bent wire with no joint in it. Taking
 * the hand *over the top* keeps it an arm's length out the whole way round —
 * and it is what an overhand rake actually looks like.
 */
const SWIPE_COCK_X = -0.45;
const SWIPE_COCK_Y = -2.45;
const SWIPE_OVER_X = 0.55;
const SWIPE_OVER_Y = -2.5;
const SWIPE_REACH_X = 1.0;
const SWIPE_REACH_Y = -1.26;
/** Where the hand tops out, between the windup and the impact. */
const SWIPE_OVERHEAD_AT = 0.43;
/** How much of the near arm's reach the far one gives up, so they read apart. */
const SWIPE_TRAIL_SHARE = 0.62;
const SWIPE_TRAIL_COCK = 1.15;
const SWIPE_TRAIL_OVER = 0.8;
const SWIPE_TRAIL_DROP = 0.2;
const SWIPE_LEAN_BACK = deg(-9);
const SWIPE_LEAN_IN = deg(11);
const SWIPE_CROUCH = 0.14;
/** Shoulder rotation at the two ends of the swing, seen as a width shift. */
const SWIPE_TWIST_IN = 0.5;
const SWIPE_TWIST_BACK = 0.35;
/** Edge-on the elbow has to break backward, or the forearm crosses the body. */
const SWIPE_ELBOW_FLARE = -0.6;
/** The profile stance: braced, with the leading foot stepping into the blow. */
const SWIPE_SIDE_LEAD_FOOT = 0.2;
const SWIPE_SIDE_LEAD_STEP = 0.05;
const SWIPE_SIDE_TRAIL_FOOT = -0.22;
const SWIPE_SIDE_TRAIL_PITCH = deg(-7);
/** The head-on stance, which has to hold the mass over both feet at once. */
const SWIPE_FACING_STANCE = 0.19;
/** How far it keeps its face toward the camera while striking in profile. */
const SWIPE_SIDE_HEAD_TURN = 0.35;
const SWIPE_HEAD_DIP = deg(6);
const SWIPE_FACING_HEAD_DIP = deg(4);
const SWIPE_FACING_LEAN = deg(4);
/** How far the swing lifts it off its own heels. Small: the legs have no slack. */
const SWIPE_LIFT = 0.02;
const SWIPE_FACING_LIFT = 0.03;
/** The coat is thrown by the swing, forward in profile and outward head-on. */
const SWIPE_FUR_THROW = 0.7;
const SWIPE_FACING_FUR_THROW = 0.5;
/** How far the off hand's claws open against the leading hand's full spread. */
const SWIPE_OFF_CLAW = 0.85;
const SWIPE_FACING_OFF_CLAW = 0.9;
/** The crouch a swing holds throughout, which is what buys the stance width. */
const SWIPE_BRACE = 0.12;

/** Where the impact falls in the row, as progress rather than as a frame. */
const SWIPE_IMPACT_AT = SWIPE_IMPACT_FRAME / (SWIPE_FRAMES - 1);
/**
 * Where the windup reaches its top, and how long it holds there.
 *
 * It has to *hold*: without the second key the arms are still on their way up
 * on the row's second frame, which catches them straight out to the sides, and
 * a pair of arms this thin held out sideways is a scarecrow rather than a
 * creature about to hit something.
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
 * swing — once as the row is entered and once as it hands back to the idle —
 * and the pop is at the shoulders, which is where the eye already is.
 */
function swipeHand(t: number, cocked: Pt, over: Pt, struck: Pt): Pt {
  return keyedPoint(t, [
    [0, SIDE_REST_HAND],
    [SWIPE_COCK_BY, cocked],
    [SWIPE_COCK_UNTIL, cocked],
    [SWIPE_OVERHEAD_AT, over],
    [SWIPE_IMPACT_AT, struck],
    [1, SIDE_REST_HAND],
  ]);
}

const SIDE_REST_HAND = pt(-SIDE_HAND_BEHIND * 0.4, SHOULDER_Y + HAND_HANG_DROP);

export function swipeSide(t: number): BugabooPose {
  const struck = struckShare(t);
  const cocked = cockedShare(t);
  const committed = Math.max(struck, cocked);
  const pose = restingPose();

  pose.lean = SWIPE_LEAN_IN * struck + SWIPE_LEAN_BACK * cocked;
  // Braced throughout, and it *stays* braced through the strike. The legs are
  // within half a percent of the hip height, so a swing that lifts the hips at
  // all puts the planted foot out of its own leg's reach and the strike frame
  // bakes with one leg locked straight and its foot off the floor.
  pose.crouch = SWIPE_BRACE + SWIPE_CROUCH * cocked;
  pose.twist = SWIPE_TWIST_IN * struck - SWIPE_TWIST_BACK * cocked;
  pose.bob = -SWIPE_LIFT * struck;

  pose.rightHand = swipeHand(
    t,
    pt(SWIPE_COCK_X, SWIPE_COCK_Y),
    pt(SWIPE_OVER_X, SWIPE_OVER_Y),
    pt(SWIPE_REACH_X, SWIPE_REACH_Y),
  );
  // The off arm trails wider and stops short, so the two claws read as one rake
  // rather than as a pair of identical arms.
  pose.leftHand = swipeHand(
    t,
    pt(SWIPE_COCK_X * SWIPE_TRAIL_COCK, SWIPE_COCK_Y + SWIPE_TRAIL_DROP),
    pt(SWIPE_OVER_X * SWIPE_TRAIL_OVER, SWIPE_OVER_Y + SWIPE_TRAIL_DROP),
    pt(SWIPE_REACH_X * SWIPE_TRAIL_SHARE, SWIPE_REACH_Y + SWIPE_TRAIL_DROP),
  );
  pose.rightClaw = lerp(RESTING_CLAW, FULL_CLAW, committed);
  pose.leftClaw = lerp(RESTING_CLAW, SWIPE_OFF_CLAW, committed);
  pose.elbowFlare = SWIPE_ELBOW_FLARE;

  pose.rightFoot = pt(SWIPE_SIDE_LEAD_FOOT + SWIPE_SIDE_LEAD_STEP * struck, 0);
  pose.leftFoot = pt(SWIPE_SIDE_TRAIL_FOOT, 0);
  pose.leftFootPitch = SWIPE_SIDE_TRAIL_PITCH * struck;
  pose.glare = committed;
  pose.maw = easeInOut(struck);
  pose.headTurn = SWIPE_SIDE_HEAD_TURN;
  pose.headTilt = SWIPE_HEAD_DIP * struck;
  pose.furFlow = -SWIPE_FUR_THROW * struck;
  pose.furPhase = struck * Math.PI;
  return pose;
}

/**
 * The head-on smash is driven from joint angles rather than from hand targets,
 * and that is not a stylistic choice.
 *
 * A two-bone solver decides which way the elbow pops from the sign of a single
 * flare value, and "outward" flips sign the moment the hand crosses the
 * shoulder — so a hand target swung from over the head down past the hip needs
 * the *opposite* flare at each end, and no single value gives elbows-out for
 * both. Given one, the windup frames put both forearms across the creature's
 * own face in an X. Angles have no such ambiguity: the arm goes where it is
 * told on every frame of the arc.
 *
 * 0 is straight down and positive swings toward +X, so the right arm sweeps
 * from past vertical down to a low follow-through and the left mirrors it.
 */
/**
 * How far behind the leading arm the off one trails.
 *
 * Both arms raised together in a symmetric V is the universal cheer, and it
 * read as one for two full passes. Offsetting the second arm by a beat turns
 * the same motion into a rake: one claw is already coming down while the other
 * is still going up.
 */
const SMASH_OFF_ARM_LAG = 0.1;
const SMASH_UPPER_RAISED = deg(168);
const SMASH_FOREARM_RAISED = deg(150);
const SMASH_UPPER_DROPPED = deg(42);
const SMASH_FOREARM_DROPPED = deg(-28);
/**
 * The elbow folds *through* the swing and only opens again at impact, which is
 * what an overhand strike actually does — and what keeps the frame narrow. Left
 * to travel straight, an arm this long sweeps its claws two full tiles out from
 * the centreline on the way past horizontal, and every row on the sheet then
 * pays for a cell wide enough to hold that one frame.
 */
const SMASH_FOREARM_MIDSWING = deg(20);
const SMASH_MIDSWING_AT = 0.43;
/** The claws end up nearer the camera than they started, so they draw shorter. */
const SMASH_FOREARM_FORESHORTEN = 0.12;

/** One arm's angles at `t` through the smash. */
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
 * The attack seen head-on: both claws driven up over the skull and hammered
 * down the front of the body. A swipe *at* the camera has no sideways travel to
 * read, so the height the hands lose is the whole of the motion.
 */
function swipeFacing(t: number, away: boolean): BugabooPose {
  const struck = struckShare(t);
  const cocked = cockedShare(t);
  const committed = Math.max(struck, cocked);
  const pose = restingPose();

  pose.crouch = SWIPE_BRACE + SWIPE_CROUCH * cocked;
  pose.bob = -SWIPE_FACING_LIFT * struck;
  pose.lean = SWIPE_FACING_LEAN * struck;

  pose.rightArmAngles = smashArm(t, RIGHT_ARM);
  pose.leftArmAngles = smashArm(Math.max(0, t - SMASH_OFF_ARM_LAG), LEFT_ARM);
  pose.rightClaw = lerp(RESTING_CLAW, FULL_CLAW, committed);
  pose.leftClaw = lerp(RESTING_CLAW, SWIPE_FACING_OFF_CLAW, committed);

  pose.leftFoot = pt(-SWIPE_FACING_STANCE, 0);
  pose.rightFoot = pt(SWIPE_FACING_STANCE, 0);
  pose.leftForeshorten = STRAIGHT_COLUMN;
  pose.rightForeshorten = STRAIGHT_COLUMN;
  pose.glare = committed;
  pose.maw = easeInOut(struck);
  pose.headTilt = SWIPE_FACING_HEAD_DIP * struck;
  pose.furFlow = SWIPE_FACING_FUR_THROW * struck;
  pose.furPhase = struck * Math.PI;
  // Away from the camera both arms are behind the mass for the whole row, so
  // the smash reads as the shoulders working rather than as hands in mid-air.
  pose.leftArmBehind = away;
  pose.rightArmBehind = away;
  return pose;
}

// ── The breach ───────────────────────────────────────────────────────────────

/**
 * Half out of a smashed floor, groping.
 *
 * How deep it sits is the whole shot: any deeper and the eyes go under the
 * rubble and the hole reads as empty; any shallower and it is a creature
 * standing in a hole rather than one still coming out of it.
 */
/**
 * Deep enough that only the crown of the skull and the eyes clear the lip. The
 * shot is a hand coming out of a hole in the floor, not a creature standing in
 * one: raised far enough to show its shoulders it stops reading as trapped and
 * the hole stops reading as a hole.
 */
/**
 * Deep enough that the *face* never clears the floor line.
 *
 * The barrier's boards are painted before mobs are, so everything this row
 * draws lands on top of them. An arm through a gap in boards genuinely is in
 * front of them, seen from above — but a face pressed to their underside is
 * not, and at 0.78 the eyes sat squarely on the planks. Sunk this far only the
 * crown of the skull breaks the line, which reads as the boards bulging.
 */
const BREACH_DEPTH = 0.88;
const BREACH_HEAVE = 0.03;
/**
 * The groping hand's circle, in *screen* space above the floor line — the hole
 * does not sink with the creature, so a circle authored in figure space would
 * put the hand a tile and a half underground.
 */
const GROPE_CENTRE_X = 0.26;
const GROPE_CENTRE_Y = -0.52;
/**
 * Wide in *height* rather than in width. The arc has to read as a hand going
 * round, and a flat side-to-side sweep is a wave — but the width is what sets
 * the cell size for all eleven rows, and a groping hand thrown out past the
 * body costs every other row the pixels to hold it.
 */
const GROPE_RADIUS_X = 0.34;
const GROPE_RADIUS_Y = 0.18;
/**
 * The off hand, kept down inside the hole where the clip hides it.
 *
 * One arm out, not two. With the shoulders sitting almost exactly on the floor
 * line there is nowhere within a folded arm's reach for a second hand to grip:
 * anywhere on the rim is a hand's breadth from its own shoulder, and the elbow
 * folds flat. One hand out of a hole is also the better picture.
 */
const GRIP_X = -0.75;
const GRIP_Y = 0.95;
const GRIP_SHUDDER = 0.03;
/** How wide the groping hand opens and closes as it feels around. */
const GROPE_CLAW_MIN = 0.45;
const GROPE_CLAW_RANGE = 0.55;
/** The off hand stays half-closed; it is out of sight below the floor anyway. */
const GRIP_CLAW = 0.3;
/** Elbows break outward, away from the hole's own rim. */
const BREACH_ELBOW_FLARE = 0.9;
/** How far the head casts about as the arm sweeps. */
const BREACH_HEAD_TURN = 0.5;
/** The coat stirs as the body heaves against the boards. */
const BREACH_FUR_STIR = 0.2;
/** How many times the hand closes on nothing per sweep of the arc. */
const GRASPS_PER_SWEEP = 2;

/** Opens and closes twice per sweep, 0 for a slack hand and 1 for a full grab. */
function grasp(sweep: number): number {
  return (1 - Math.cos(sweep * GRASPS_PER_SWEEP)) / 2;
}

export function breach(phase: number): BugabooPose {
  const pose = restingPose();
  const heave = Math.sin(phase * FULL_TURN);
  pose.submerged = BREACH_DEPTH - heave * BREACH_HEAVE;
  // No hole is painted on this row. It only ever plays over a *barricaded*
  // grate — the creature is only "breaching" while boards are still in its way
  // — and `drawWoodBarrierSprite` already paints the void under those boards.
  // Painting a second one here blacks out the planks it is coming through.
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
  // Claws open and close through the sweep: a hand groping for something is
  // grasping, and a fixed spread reads as a prop hand on a stick.
  pose.rightClaw = GROPE_CLAW_MIN + GROPE_CLAW_RANGE * grasp(sweep);
  pose.leftClaw = GRIP_CLAW;
  pose.elbowFlare = BREACH_ELBOW_FLARE;
  pose.glare = FULL_GLARE;
  pose.blink = blink(phase, BLINK_AT);
  pose.headTurn = Math.cos(sweep) * BREACH_HEAD_TURN;
  pose.furFlow = heave * BREACH_FUR_STIR;
  pose.furPhase = phase * FULL_TURN;
  return pose;
}

// ── The emergence ────────────────────────────────────────────────────────────

/** Where the haul-up starts, and how much of the row it takes. */
const EMERGE_START_DEPTH = 0.95;
const EMERGE_RISE_END = 0.78;
/**
 * How wide the hands plant to push against — outside the hole, flat on the
 * floor beside it, which is how anything hauls itself out of a hole anyway.
 *
 * Planted narrow they pass straight through their own shoulders as the body
 * climbs, and for two frames each elbow folds to under 20°.
 */
const EMERGE_PLANT_X = 0.95;
/** How far above the lip the palms sit while they are bearing weight. */
const EMERGE_PLANT_LIFT = 0.06;
/**
 * When the hands let go of the rim, measured against how far the body has
 * *risen* rather than against the row's own clock — the reach is a function of
 * the height, so the release has to be too.
 *
 * They must let go well before the haul finishes: the rim stays on the floor
 * while the shoulders climb nearly two tiles above it, and an arm still
 * reaching for it at the top is half a tile past its own length.
 */
const EMERGE_RELEASE_FROM = 0.3;
const EMERGE_RELEASE_BY = 0.62;
const EMERGE_CROUCH = 0.5;
/** How hard it grips the lip while it is bearing its own weight on the rim. */
const EMERGE_GRIP_CLAW = 0.9;
/** How wide its jaw goes with the effort of the haul. */
const EMERGE_STRAIN = 0.7;
/** The coat still hangs out of the hole for the first frames of the climb. */
const EMERGE_FUR_DRAG = 0.4;

/**
 * Hauling itself the rest of the way out: hands plant on the lip of the hole,
 * the shoulders drive up past them, and it settles onto its feet.
 *
 * The last frame has to be the idle's first, or the hand-off from this row back
 * to standing pops.
 */
export function emerge(t: number): BugabooPose {
  const risen = easeInOut(ramp(t, 0, EMERGE_RISE_END));
  const settle = ramp(t, EMERGE_RISE_END, 1);
  const pose = restingPose();

  pose.submerged = EMERGE_START_DEPTH * (1 - risen);
  pose.breach = true;
  pose.crouch = EMERGE_CROUCH * risen * (1 - settle);

  // The hands stay planted on the lip of the hole while the body climbs between
  // them, which is what makes it read as pushing rather than as floating up.
  // The rim does not move with the creature, so the plant is placed in *screen*
  // space and the pose's own submergence taken back off it — a plant authored
  // in figure space sinks with the body and the hands then ride up with it.
  const plantY = BREACH_FLOOR_Y - EMERGE_PLANT_LIFT - pose.submerged * SUBMERGE_DEPTH;
  const release = ramp(risen, EMERGE_RELEASE_FROM, EMERGE_RELEASE_BY);
  const eased = easeInOut(release);
  pose.rightHand = pt(
    lerp(EMERGE_PLANT_X, HAND_HANG_SPREAD, eased),
    lerp(plantY, SHOULDER_Y + HAND_HANG_DROP, eased),
  );
  pose.leftHand = pt(
    lerp(-EMERGE_PLANT_X, -HAND_HANG_SPREAD, eased),
    lerp(plantY, SHOULDER_Y + HAND_HANG_DROP, eased),
  );
  pose.rightClaw = lerp(EMERGE_GRIP_CLAW, RESTING_CLAW, eased);
  pose.leftClaw = lerp(EMERGE_GRIP_CLAW, RESTING_CLAW, eased);
  // Relaxes with the grip. Held at the pushing-off flare all the way to the end
  // of the row, the elbows stay bowed out over a hand already back at its hang
  // and the last third of the climb reads as the creature putting its hands on
  // its hips.
  pose.elbowFlare = lerp(BREACH_ELBOW_FLARE, RESTING_ELBOW_FLARE, eased);

  pose.leftFoot = pt(-FOOT_STAND_SPREAD, 0);
  pose.rightFoot = pt(FOOT_STAND_SPREAD, 0);
  pose.leftForeshorten = STRAIGHT_COLUMN;
  pose.rightForeshorten = STRAIGHT_COLUMN;
  pose.glare = FULL_GLARE - eased;
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
  readonly view: BugabooView;
  readonly kind: RowKind;
  readonly pose: (frame: number) => BugabooPose;
}

/** Loops sample the cycle evenly; one-shots sample the frame's own position. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return frame / (frameCount - 1);
}

export const ROWS: readonly RowSpec[] = [
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

// ── Bake ─────────────────────────────────────────────────────────────────────

function paintView(ctx: Ctx, view: BugabooView, pose: BugabooPose): void {
  if (view === 'front') drawBugabooFront(ctx, pose);
  else if (view === 'back') drawBugabooBack(ctx, pose);
  else drawBugabooSide(ctx, pose);
}

interface SheetGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

export interface BakedSheet {
  readonly buffer: Buffer;
  readonly geometry: SheetGeometry;
  readonly columns: number;
}

/** Alpha above which a measured pixel counts as painted. */
const INK_ALPHA = 8;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

/** Generous enough that no pose can reach its edge; only used for measuring. */
const MEASURE_SPAN = 384;
const MEASURE_ORIGIN = MEASURE_SPAN / 2;

interface Extents {
  left: number;
  right: number;
  up: number;
  down: number;
}

/**
 * Where the ink of every frame actually lands, relative to the ground point.
 *
 * Measured rather than authored, because a pose that outgrows its cell is
 * sheared flat by the sheet blit and baked in, and nothing downstream can
 * detect it. Deriving the cell from the art instead makes that impossible by
 * construction — and keeps the sheet no larger than the art needs.
 */
function measureExtents(): Extents {
  const canvas = createCanvas(MEASURE_SPAN, MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  const extents: Extents = { left: 0, right: 0, up: 0, down: 0 };

  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      ctx.clearRect(0, 0, MEASURE_SPAN, MEASURE_SPAN);
      ctx.save();
      ctx.translate(MEASURE_ORIGIN, MEASURE_ORIGIN);
      ctx.scale(TILE_SCALE * FIGURE_SCALE, TILE_SCALE * FIGURE_SCALE);
      paintView(ctx, row.view, row.pose(frame));
      ctx.restore();

      const { data } = ctx.getImageData(0, 0, MEASURE_SPAN, MEASURE_SPAN);
      for (let y = 0; y < MEASURE_SPAN; y++) {
        for (let x = 0; x < MEASURE_SPAN; x++) {
          if (data[(y * MEASURE_SPAN + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA) continue;
          extents.left = Math.max(extents.left, MEASURE_ORIGIN - x);
          extents.right = Math.max(extents.right, x - MEASURE_ORIGIN);
          extents.up = Math.max(extents.up, MEASURE_ORIGIN - y);
          extents.down = Math.max(extents.down, y - MEASURE_ORIGIN);
        }
      }
    }
  }
  return extents;
}

function roundUpTo(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

function geometryFor(extents: Extents): SheetGeometry {
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const frameWidth = roundUpTo(halfWidth * 2, FRAME_SIZE_QUANTUM);
  const originY = Math.ceil(extents.up + FRAME_PADDING);
  const frameHeight = roundUpTo(originY + extents.down + FRAME_PADDING, FRAME_SIZE_QUANTUM);
  return {
    frameWidth,
    frameHeight,
    tileX: Math.round(frameWidth / 2 - TILE_SCALE / 2),
    tileY: originY - GROUND_OFFSET_PX,
  };
}

export function bake(): BakedSheet {
  const geometry = geometryFor(measureExtents());
  const columns = Math.max(...ROWS.map((row) => row.frameCount));
  const sheet = createCanvas(columns * geometry.frameWidth, ROWS.length * geometry.frameHeight);
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');
  const originX = geometry.frameWidth / 2;
  const originY = geometry.tileY + GROUND_OFFSET_PX;

  ROWS.forEach((row, rowIndex) => {
    for (let frame = 0; frame < row.frameCount; frame++) {
      cellCtx.clearRect(0, 0, cell.width, cell.height);
      cellCtx.save();
      cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
      cellCtx.translate(originX, originY);
      cellCtx.scale(TILE_SCALE * FIGURE_SCALE, TILE_SCALE * FIGURE_SCALE);
      paintView(cellCtx, row.view, row.pose(frame));
      cellCtx.restore();

      sheetCtx.drawImage(
        cell,
        0,
        0,
        cell.width,
        cell.height,
        frame * geometry.frameWidth,
        rowIndex * geometry.frameHeight,
        geometry.frameWidth,
        geometry.frameHeight,
      );
    }
  });

  return { buffer: sheet.toBuffer('image/png'), geometry, columns };
}

// ── Manifest ─────────────────────────────────────────────────────────────────

export const SHEET_PATH = 'src/images/npcs/bugaboo.png';
const MANIFEST_PATH = 'src/images/npcs/manifest.json';
const SPRITE_KEY = 'bugaboo';

interface ManifestStateEntry {
  readonly row: number;
  readonly frameCount: number;
}

interface ManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Record<string, ManifestStateEntry>;
}

function manifestEntry(sheet: BakedSheet): ManifestEntry {
  const states: Record<string, ManifestStateEntry> = {};
  ROWS.forEach((row, index) => {
    states[row.name] = { row: index, frameCount: row.frameCount };
  });
  return {
    path: 'npcs/bugaboo.png',
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

/**
 * A stable string for comparing two manifest entries. Key order in JSON carries
 * no meaning, so a hand-edit that reorders `tileX` and `tileY` must not read as
 * a mismatch.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return nested;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(nested).sort()) {
      sorted[key] = Object.getOwnPropertyDescriptor(nested, key)?.value;
    }
    return sorted;
  });
}

/**
 * Checks `manifest.json` against the bake rather than rewriting it: other agents
 * work in this repo, and a programmatic rewrite of a shared file would clobber
 * their edits. A mismatch prints the entry to paste and fails the run — a sheet
 * on disk that its manifest does not describe renders as garbage.
 */
export function verifyManifest(sheet: BakedSheet): boolean {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const required = manifestEntry(sheet);
  if (canonicalJson(manifest[SPRITE_KEY]) === canonicalJson(required)) {
    console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
    return true;
  }
  console.error(
    `\n${MANIFEST_PATH} is out of sync with the bake. Replace its "${SPRITE_KEY}" entry with:\n` +
      `${JSON.stringify(required, null, 2)}\n`,
  );
  return false;
}

export function writeSheet(): void {
  console.log(`Generating the bugaboo sheet (tileScale=${TILE_SCALE}, scale=${FIGURE_SCALE})…`);
  const sheet = bake();
  writeFileSync(resolve(SHEET_PATH), sheet.buffer);

  const { frameWidth, frameHeight, tileX, tileY } = sheet.geometry;
  console.log(`  → ${SHEET_PATH}`);
  console.log(
    `  → ${sheet.columns * frameWidth}×${ROWS.length * frameHeight}px  ` +
      `(${ROWS.length} rows × ${sheet.columns} cols of ${frameWidth}×${frameHeight})`,
  );
  ROWS.forEach((row, index) => {
    console.log(`     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view})`);
  });
  console.log(`  tileX=${tileX}  tileY=${tileY}  tileScale=${TILE_SCALE}`);
  if (!verifyManifest(sheet)) process.exitCode = 1;
}

// The review harness and the gate module import ROWS from here, so painting the
// sheet has to be something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheet();
}
