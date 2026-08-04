/**
 * Bakes the Tuskling sheet.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, and the tiling. Anatomy, palette and every stroke of paint live in
 * `scripts/tusklingArt.ts`.
 *
 * The gait is `generate-human-sprite.ts`'s, scaled to this creature's much
 * shorter leg: stance is a constant-rate backward slide so the contact rolls
 * rather than skates, swing is a keyed tuck → pass → reach, and the pelvis
 * *drops* at contact so the IK never clamps. Arms swing from joint angles, not
 * from hand targets — almost all of a walking arm's travel belongs to the
 * shoulder, and an arm placed by its hand cannot do that.
 *
 * Run through the gates, never directly: `npm run gen:tuskling`.
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import { clamp01, deg, easeInOut, lerp } from './carlArt.js';
import {
  ARM_ROOT_HALF,
  ELBOW_IN_FRONT,
  type ArmAngles,
  FOREARM_LENGTH,
  FOOT_STAND_SPREAD,
  HAND_HANG_DROP,
  HAND_HANG_SPREAD,
  type Pt,
  SHOULDER_Y,
  type TusklingPose,
  type TusklingView,
  UPPER_ARM_LENGTH,
  drawTusklingBack,
  drawTusklingFront,
  drawTusklingSide,
  pt,
  restingPose,
} from './tusklingArt.js';
import { type GorePiece, tusklingGorePieces } from './tusklingGore.js';
import {
  TUSKLING_CHARGE_FRAMES,
  TUSKLING_HOOK_FRAMES,
  TUSKLING_HOOK_IMPACT_PROGRESS,
  TUSKLING_IDLE_FRAMES,
  TUSKLING_SNORT_FRAMES,
  TUSKLING_WALK_FRAMES,
} from '../src/sprites/tusklingAttackTiming.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Where the floor sits inside the tile, matching the other dungeon mobs. */
export const GROUND_OFFSET_PX = 58;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
const FRAME_PADDING = 5;
const FRAME_SIZE_QUANTUM = 8;
/**
 * How much of a tile a Tuskling fills. The anatomy is authored at a comfortable
 * working size and then scaled about its own ground line, which keeps the
 * hooves on the tile they belong to. At 4'6" it stands three quarters of the
 * height the human crawler does.
 */
const FIGURE_SCALE = 0.71;

export const SHEET_PATH = 'src/images/enemies/tuskling.png';
const MANIFEST_PATH = 'src/images/enemies/manifest.json';
const SPRITE_KEY = 'tuskling';
const SHEET_RELATIVE_PATH = 'enemies/tuskling.png';

const FULL_TURN = Math.PI * 2;

// ── Gait ─────────────────────────────────────────────────────────────────────

/**
 * Short, and it has to be. The leg is very nearly as long as the hip is high,
 * so a hoof planted much further out than this is beyond the leg's reach: the
 * IK clamps at the end of stance, the leg locks dead straight, and the next
 * frame's tuck snaps the knee back — the hitch that reads as a hop.
 */
const STRIDE = 0.12;
/** Hoof height just after toe-off, when the knee is most folded. */
const TUCK_LIFT = 0.085;
/** The first, small lift as the toe leaves the floor. */
const TOE_LIFT = 0.021;
const TOE_LIFT_AT = 0.12;
/** Hoof height as it passes under the hip. */
const PASS_LIFT = 0.058;
/** Hoof height as it reaches out for the next contact. */
const REACH_LIFT = 0.013;
/** Where in the swing the tuck, the pass and the reach fall. */
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;
/** Half the cycle is stance, half is swing. */
const STANCE_SHARE = 0.5;

const WALK_BOB = 0.032;
const WALK_SWAY = 0.012;
const WALK_LEAN = deg(4);
/** A hoof rolls less than a foot does: there is no arch in it to unroll. */
const HEEL_STRIKE_PITCH = deg(-7);
const TOE_OFF_PITCH = deg(11);
const SWING_PITCH = deg(-5);

/**
 * Head-on the step reads only as height, so it takes nearly the full profile
 * lift to be legible at all; the pitch, by contrast, is almost invisible, and
 * the lateral travel collapses to a drift.
 */
const FACING_LIFT_SHARE = 0.95;
const FACING_PITCH_SHARE = 0.5;
const FACING_STRIDE_DRIFT = 0.022;
/** The lift at which the swing leg's shin is drawn at full near-camera width. */
const FULLY_NEAR_LIFT = TUCK_LIFT * FACING_LIFT_SHARE;

/** Piecewise linear interpolation through a set of (t, value) keys. */
function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  for (let i = 1; i < keys.length; i++) {
    const [prevT, prevV] = keys[i - 1];
    const [nextT, nextV] = keys[i];
    if (t <= nextT) return lerp(prevV, nextV, (t - prevT) / (nextT - prevT));
  }
  return keys[keys.length - 1][1];
}

/** Piecewise linear interpolation of a point through a set of (t, point) keys. */
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
 * Wide enough that three of the eight idle frames fall inside it. A blink
 * narrower than the frame spacing is sampled by one frame and snaps shut and
 * open again between two cells.
 */
const BLINK_WIDTH = 0.19;
const BLINK_AT = 0.72;

/** A blink centred on `at`, expressed in cycle phase. */
function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 1.5) % 1) - 0.5);
  if (distance > BLINK_WIDTH) return 0;
  const inside = 1 - distance / BLINK_WIDTH;
  return inside * inside * (3 - 2 * inside);
}

/**
 * One hoof of a profile gait. Through stance the hoof is planted and slides
 * backward under the body at a constant rate — the body is what moves. Through
 * swing it tucks, passes and reaches.
 */
function gaitFootSide(phase: number): { foot: Pt; pitch: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_SHARE;
  const t = stance ? cycle / STANCE_SHARE : (cycle - STANCE_SHARE) / (1 - STANCE_SHARE);

  if (stance) {
    return {
      foot: pt(lerp(STRIDE, -STRIDE, t), 0),
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
 * Walking at the camera. Almost none of the stride is visible head-on, so the
 * step is sold by the hoof rising and the leg foreshortening rather than by any
 * sideways travel.
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

// ── Arms ─────────────────────────────────────────────────────────────────────

/** `side` is +1 for the arm that swings forward on the beat and −1 for its pair. */
const RIGHT_ARM = 1;
const LEFT_ARM = -1;
/** Shoulder rotation at the top of the forward swing. */
const ARM_SWING_ANGLE = deg(34);
/** An arm swings further forward than back, so the backswing is scaled down. */
const ARM_BACKSWING_SHARE = 0.55;
/** How much of the shoulder's swing the forearm inherits. */
const FOREARM_FOLLOW = 0.22;
/** The bend a walking elbow simply holds, keeping the forearm ahead of the arm. */
const ELBOW_FLEX = deg(13);

function armSwingAngle(forward: number): number {
  const shortened = forward >= 0 ? forward : forward * ARM_BACKSWING_SHARE;
  return shortened * ARM_SWING_ANGLE;
}

/**
 * A profile arm, driven from its joints rather than from a hand target. Almost
 * all of a walking arm's travel belongs to the shoulder; the elbow keeps a
 * near-constant bend and the forearm barely sweeps at all.
 */
function sideArmAngles(forward: number): ArmAngles {
  const upper = armSwingAngle(forward);
  return { upper, fore: upper * FOREARM_FOLLOW + ELBOW_FLEX, foreScale: 1 };
}

/**
 * A relaxed arm is not a straight rod: the elbow carries a little standing
 * flexion, which gives the arm a readable break at the joint and holds it off
 * the ribs. The upper arm therefore tilts out further than the forearm does.
 */
const FACING_ELBOW_FLEX = deg(9);
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
const FACING_UPPER_SWING = deg(5);
const FACING_FOREARM_SWING = deg(11);
/** How much of its length the forearm loses at the front of the swing. */
const FACING_FOREARM_FORESHORTEN = 0.18;
const WALK_ELBOW_FLEX = deg(7);
/** Standing, the arms drift by a fraction of the walk's swing. */
const IDLE_ARM_DRIFT = 0.07;

/**
 * One head-on arm. `swing` is positive as it comes forward and crosses inboard;
 * `forward` runs 0 at the back of the swing to 1 at the front and drives the
 * foreshortening, which is what carries the hand up the body.
 */
function facingArmAngles(side: number, swing: number, forward: number, flex: number): ArmAngles {
  return {
    upper: side * (FACING_UPPER_TILT - swing * FACING_UPPER_SWING),
    fore: side * (FACING_FOREARM_TILT - flex - swing * FACING_FOREARM_SWING),
    foreScale: 1 - forward * FACING_FOREARM_FORESHORTEN,
  };
}

/**
 * One arm of a head-on walk. The travel is inward only: arms swing in a plane
 * just off the body and cross slightly toward the centreline coming forward.
 *
 * That inward amount is a *remapped* swing, not a rectified one. Folding the
 * negative half back up keeps the motion inward but gives each arm two inward
 * peaks per stride, and the swing then reads at double speed however small the
 * amplitude is.
 */
function facingArmSwing(
  phase: number,
  side: number,
  away: boolean,
): { angles: ArmAngles; behind: boolean } {
  const own = Math.sin(phase * FULL_TURN) * side;
  const signedSwing = own >= 0 ? own : own * ARM_BACKSWING_SHARE;
  // Centred on the rest hang, so the average of the cycle is where the arms
  // stand. Left uncentred the whole swing sits inboard of the idle, and the
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

// ── Idle ─────────────────────────────────────────────────────────────────────

const BREATH_LIFT = 0.008;
const BREATH_LEAN = deg(1.4);
const IDLE_SWAY = 0.012;
const IDLE_HEAD_TURN = 0.14;
const IDLE_HEAD_TILT = deg(2.5);
const IDLE_BRISTLE_DRIFT = 0.35;
const IDLE_SNORT = 0.18;

function idleBase(phase: number): TusklingPose {
  const breath = Math.sin(phase * FULL_TURN);
  const pose = restingPose();
  pose.bob = -BREATH_LIFT * (breath * 0.5 + 0.5);
  pose.lean = BREATH_LEAN * breath;
  pose.blink = blink(phase, BLINK_AT);
  pose.bristleFlow = breath * IDLE_BRISTLE_DRIFT;
  // The nostrils never fully settle. A warthog head that holds perfectly still
  // reads as a mask rather than as a face.
  pose.snort = IDLE_SNORT * (breath * 0.5 + 0.5);
  return pose;
}

function idleFacing(phase: number, away: boolean): TusklingPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * FULL_TURN);
  pose.sway = sway * IDLE_SWAY;
  pose.headTurn = away ? 0 : sway * IDLE_HEAD_TURN;
  pose.headTilt = sway * IDLE_HEAD_TILT;
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, sway * IDLE_ARM_DRIFT, 0.5, FACING_ELBOW_FLEX);
  pose.rightArmAngles = facingArmAngles(RIGHT_ARM, sway * IDLE_ARM_DRIFT, 0.5, FACING_ELBOW_FLEX);
  pose.leftArmBehind = away;
  pose.rightArmBehind = away;
  pose.leftFoot = pt(-FOOT_STAND_SPREAD, 0);
  pose.rightFoot = pt(FOOT_STAND_SPREAD, 0);
  // Head-on every knee is a straight column: there is no direction for it to
  // break into, and a bow on one leg only flickers once per cycle.
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  return pose;
}

/**
 * Edge-on the two hooves are only slightly staggered: a wide profile stance
 * splits the legs so far fore-and-aft that the barrel body no longer sits over
 * either of them.
 */
const IDLE_SIDE_FOOT_LEAD = 0.05;
const SIDE_HEAD_TURN = 0.2;
const SIDE_HAND_FORWARD = 0.16;
const SIDE_HAND_BEHIND = 0.035;

function idleSide(phase: number): TusklingPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * FULL_TURN);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD, 0);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD, 0);
  pose.headTurn = SIDE_HEAD_TURN;
  pose.headTilt = sway * IDLE_HEAD_TILT;
  pose.leftHand = pt(SIDE_HAND_FORWARD - SIDE_HAND_BEHIND * 2, SHOULDER_Y + HAND_HANG_DROP);
  pose.rightHand = pt(SIDE_HAND_FORWARD, SHOULDER_Y + HAND_HANG_DROP);
  pose.elbowFlare = ELBOW_IN_FRONT;
  return pose;
}

// ── Walk ─────────────────────────────────────────────────────────────────────

const WALK_FIST = 0.5;
const WALK_BRISTLE_TRAIL = 0.5;
const WALK_GLARE = 0.2;

function walkSide(phase: number): TusklingPose {
  const pose = restingPose();
  const right = gaitFootSide(phase);
  const left = gaitFootSide(phase + 0.5);
  const bobPhase = Math.abs(Math.sin(phase * FULL_TURN));

  // The pelvis *drops* at contact rather than rising at mid-stance. A walking
  // leg is nearly as long as the hip is high, so a hoof planted a stride ahead
  // is out of reach from the standing height: the IK clamps, and the clamped
  // leg locks straight with its hoof hanging above the floor.
  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.lean = WALK_LEAN;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;

  const rightForward = -Math.sin(phase * FULL_TURN);
  pose.rightArmAngles = sideArmAngles(rightForward);
  pose.leftArmAngles = sideArmAngles(-rightForward);
  pose.rightFist = WALK_FIST;
  pose.leftFist = WALK_FIST;
  pose.bristleFlow = -WALK_BRISTLE_TRAIL;
  pose.blink = blink(phase, BLINK_AT);
  pose.glare = WALK_GLARE;
  pose.headTurn = SIDE_HEAD_TURN;
  pose.snort = IDLE_SNORT;
  return pose;
}

export function walkFacing(phase: number, away: boolean): TusklingPose {
  const pose = restingPose();
  const right = gaitFootFacing(phase, 1);
  const left = gaitFootFacing(phase + 0.5, -1);
  const bobPhase = Math.abs(Math.sin(phase * FULL_TURN));

  // The pelvis drops at contact head-on as well as in profile. Rising at
  // mid-stance instead — which is what the human rig does — lifts the hip
  // above the planted hoof's reach and the IK clamps the leg straight.
  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.sway = Math.sin(phase * FULL_TURN) * WALK_SWAY;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.rightLegNearness = right.nearness;
  pose.leftLegNearness = left.nearness;
  pose.rightForeshorten = 1;
  pose.leftForeshorten = 1;

  const rightArm = facingArmSwing(phase, RIGHT_ARM, away);
  const leftArm = facingArmSwing(phase, LEFT_ARM, away);
  pose.rightArmAngles = rightArm.angles;
  pose.leftArmAngles = leftArm.angles;
  pose.rightArmBehind = rightArm.behind;
  pose.leftArmBehind = leftArm.behind;
  pose.rightFist = WALK_FIST;
  pose.leftFist = WALK_FIST;
  pose.twist = Math.sin(phase * FULL_TURN) * 0.1;
  pose.bristleFlow = Math.sin(phase * FULL_TURN) * 0.3;
  pose.blink = blink(phase, BLINK_AT);
  pose.glare = WALK_GLARE;
  pose.headTurn = away ? 0 : Math.sin(phase * FULL_TURN) * 0.12;
  pose.snort = IDLE_SNORT;
  return pose;
}

// ── Pose blending ────────────────────────────────────────────────────────────

function blendAngles(a: ArmAngles | null, b: ArmAngles | null, t: number): ArmAngles | null {
  if (a === null || b === null) return t < 0.5 ? a : b;
  return {
    upper: lerp(a.upper, b.upper, t),
    fore: lerp(a.fore, b.fore, t),
    foreScale: lerp(a.foreScale, b.foreScale, t),
  };
}

/**
 * Eases one pose into another.
 *
 * The wind-up uses it to arrive exactly on the charge's opening frame. An
 * animation that merely ends *near* the row that follows it still jumps on the
 * hand-off, and that jump lands on the frame the creature launches — the one
 * frame the player is certainly watching.
 */
function blendPose(a: TusklingPose, b: TusklingPose, t: number): TusklingPose {
  const num = (from: number, to: number): number => lerp(from, to, t);
  const point = (from: Pt, to: Pt): Pt => pt(lerp(from.x, to.x, t), lerp(from.y, to.y, t));
  return {
    bob: num(a.bob, b.bob),
    sway: num(a.sway, b.sway),
    lean: num(a.lean, b.lean),
    crouch: num(a.crouch, b.crouch),
    twist: num(a.twist, b.twist),
    headTurn: num(a.headTurn, b.headTurn),
    headTilt: num(a.headTilt, b.headTilt),
    headThrust: num(a.headThrust, b.headThrust),
    blink: num(a.blink, b.blink),
    glare: num(a.glare, b.glare),
    maw: num(a.maw, b.maw),
    snort: num(a.snort, b.snort),
    leftHand: point(a.leftHand, b.leftHand),
    rightHand: point(a.rightHand, b.rightHand),
    leftFoot: point(a.leftFoot, b.leftFoot),
    rightFoot: point(a.rightFoot, b.rightFoot),
    leftFist: num(a.leftFist, b.leftFist),
    rightFist: num(a.rightFist, b.rightFist),
    leftFootPitch: num(a.leftFootPitch, b.leftFootPitch),
    rightFootPitch: num(a.rightFootPitch, b.rightFootPitch),
    leftKneeBreak: num(a.leftKneeBreak, b.leftKneeBreak),
    rightKneeBreak: num(a.rightKneeBreak, b.rightKneeBreak),
    leftForeshorten: num(a.leftForeshorten, b.leftForeshorten),
    rightForeshorten: num(a.rightForeshorten, b.rightForeshorten),
    leftLegNearness: num(a.leftLegNearness, b.leftLegNearness),
    rightLegNearness: num(a.rightLegNearness, b.rightLegNearness),
    // Picked, never lerped: `elbowFlare` is read as a sign, so a blend that
    // crosses zero flips both elbows to the other side of the arm on one frame.
    elbowFlare: t < 0.5 ? a.elbowFlare : b.elbowFlare,
    leftArmAngles: blendAngles(a.leftArmAngles, b.leftArmAngles, t),
    rightArmAngles: blendAngles(a.rightArmAngles, b.rightArmAngles, t),
    // Which side an arm is drawn on is a per-row decision, and the wind-up and
    // the charge it hands off to always agree about it.
    leftArmBehind: t < 0.5 ? a.leftArmBehind : b.leftArmBehind,
    rightArmBehind: t < 0.5 ? a.rightArmBehind : b.rightArmBehind,
    bristleFlow: num(a.bristleFlow, b.bristleFlow),
  };
}

// ── Charge windup: head down, hoof pawing the ground ─────────────────────────

const PAW_BACK = -0.165;
const PAW_LIFT = 0.11;
const SNORT_CROUCH = 0.22;
/**
 * Shallow, and deliberately so. The wind-up and the charge have to be different
 * pictures at a 32 px tile or the telegraph tells the player nothing; leaning
 * the wind-up as far as the sprint put the two within five degrees of each
 * other. The wind-up drops the head and keeps the weight back; the sprint is
 * the one that tips.
 */
const SNORT_LEAN = deg(4);
const WINDUP_HAND_DROP = 0.03;
const WINDUP_WEIGHT_BACK = 0.045;
/** The head drops, but not as far as the sprint carries it. */
const SNORT_HEAD_DROP = 0.55;
/** Extra crouch at the bottom of the hoof rake. */
const RAKE_CROUCH = 0.25;
/** Where the single hoof rake starts, and how long the launch blend runs. */
const RAKE_FROM = 0.15;
const RAKE_UNTIL = 0.76;
/**
 * Where the wind-up starts easing into the sprint's opening frame.
 *
 * Early enough that the blend is spread over four frames. Squeezed into the
 * last one it is a single 1359-pixel jump on the frame the creature launches —
 * the one frame the player is certainly watching.
 */
const LAUNCH_FROM = 0.62;

/**
 * The single backward hoof rake, as a fraction 0 → 1 → 0 of full stroke.
 *
 * One rake, not two. Eight frames sampling two strokes is four samples a
 * stroke, which is the Nyquist limit: the hoof reads as jittering in place
 * rather than as pawing the ground.
 */
function rakeStroke(t: number): number {
  if (t <= RAKE_FROM || t >= RAKE_UNTIL) return 0;
  return keyed((t - RAKE_FROM) / (RAKE_UNTIL - RAKE_FROM), [
    [0, 0],
    [0.45, 1],
    [0.6, 1],
    [1, 0],
  ]);
}

function rakeLift(t: number): number {
  if (t <= RAKE_FROM || t >= RAKE_UNTIL) return 0;
  return keyed((t - RAKE_FROM) / (RAKE_UNTIL - RAKE_FROM), [
    [0, 0],
    [0.5, 0],
    [0.78, 1],
    [1, 0],
  ]);
}

/**
 * The telegraph: the head sinks, the shoulders drop over it, and one hoof rakes
 * the floor. It ends on the pose the charge row opens with rather than on the
 * idle, because the charge is what plays next.
 */
function snortBase(t: number): TusklingPose {
  const pose = restingPose();
  // Eased in and out rather than out alone: `easeOut` moves fastest at the very
  // start, which over eight frames puts most of the crouch between frames 0
  // and 1 and reads as a flinch rather than as a creature settling.
  const sink = easeInOut(clamp01(t / 0.6));
  pose.crouch = sink * SNORT_CROUCH;
  pose.lean = sink * SNORT_LEAN;
  pose.headThrust = sink * SNORT_HEAD_DROP;
  pose.headTilt = sink * deg(16);
  // Weight back over the rear hoof — the opposite of the sprint's forward tip.
  pose.sway = -sink * WINDUP_WEIGHT_BACK;
  pose.glare = sink;
  pose.snort = keyed(t, [
    [0, IDLE_SNORT],
    [0.45, 1],
    [1, 0.8],
  ]);
  pose.maw = keyed(t, [
    [0, 0],
    [0.4, 0.3],
    [1, 0.5],
  ]);
  pose.leftFist = 0.8;
  pose.rightFist = 0.8;
  return pose;
}

function snortSide(t: number): TusklingPose {
  const pose = snortBase(t);
  const stroke = rakeStroke(t);
  const lift = rakeLift(t);
  // Sinking into the rake is both what a pawing animal does and what buys the
  // reach: the hoof is dragged most of a leg's length behind the hip, and from
  // standing height that is outside the leg's span.
  pose.crouch += stroke * RAKE_CROUCH;
  pose.rightFoot = pt(lerp(0.04, PAW_BACK, stroke), -PAW_LIFT * lift);
  pose.rightFootPitch = TOE_OFF_PITCH * stroke;
  pose.leftFoot = pt(-0.06, 0);
  pose.leftHand = pt(SIDE_HAND_FORWARD * 0.6, SHOULDER_Y + HAND_HANG_DROP - WINDUP_HAND_DROP);
  pose.rightHand = pt(SIDE_HAND_FORWARD * 0.9, SHOULDER_Y + HAND_HANG_DROP - WINDUP_HAND_DROP);
  pose.elbowFlare = ELBOW_IN_FRONT;
  pose.headTurn = SIDE_HEAD_TURN;
  return blendPose(pose, chargeSide(0), easeInOut(clamp01((t - LAUNCH_FROM) / (1 - LAUNCH_FROM))));
}

function snortFacing(t: number, away: boolean): TusklingPose {
  const pose = snortBase(t);
  const lift = rakeLift(t) * PAW_LIFT * FACING_LIFT_SHARE;
  pose.rightFoot = pt(FOOT_STAND_SPREAD, -lift);
  pose.leftFoot = pt(-FOOT_STAND_SPREAD, 0);
  pose.rightLegNearness = clamp01(lift / FULLY_NEAR_LIFT);
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, -0.6, 0.2, WALK_ELBOW_FLEX * 2);
  pose.rightArmAngles = facingArmAngles(RIGHT_ARM, -0.6, 0.2, WALK_ELBOW_FLEX * 2);
  pose.leftArmBehind = away;
  pose.rightArmBehind = away;
  pose.headTurn = 0;
  return blendPose(
    pose,
    chargeFacing(0, away),
    easeInOut(clamp01((t - LAUNCH_FROM) / (1 - LAUNCH_FROM))),
  );
}

// ── Charging run ─────────────────────────────────────────────────────────────

const CHARGE_STRIDE = STRIDE * 1.45;
const CHARGE_BOB = WALK_BOB * 1.7;
const CHARGE_LEAN = deg(24);
const CHARGE_CROUCH = 0.45;
/** How far behind the shoulders the sprinting hips ride. */
const CHARGE_HIP_BACK = 0.075;
const CHARGE_ARM_BACK = deg(-40);

/**
 * A pounding sprint with the tusks leading. The stride is longer than the
 * walk's and the crouch is what buys it: sunk hips shorten the column the legs
 * have to span, so a longer reach still clears the IK's limit.
 */
function chargeFootSide(phase: number): { foot: Pt; pitch: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_SHARE;
  const t = stance ? cycle / STANCE_SHARE : (cycle - STANCE_SHARE) / (1 - STANCE_SHARE);
  if (stance) {
    return {
      foot: pt(lerp(CHARGE_STRIDE, -CHARGE_STRIDE, t), 0),
      pitch: keyed(t, [
        [0, HEEL_STRIKE_PITCH],
        [0.25, 0],
        [1, TOE_OFF_PITCH * 1.4],
      ]),
    };
  }
  return {
    foot: pt(
      keyed(t, [
        [0, -CHARGE_STRIDE],
        [TUCK_AT, -CHARGE_STRIDE * 0.7],
        [PASS_AT, 0],
        [1, CHARGE_STRIDE],
      ]),
      -keyed(t, [
        [0, 0],
        [TUCK_AT, TUCK_LIFT * 1.5],
        [PASS_AT, PASS_LIFT * 1.5],
        [REACH_AT, REACH_LIFT],
        [1, 0],
      ]),
    ),
    pitch: keyed(t, [
      [0, TOE_OFF_PITCH * 1.4],
      [PASS_AT, SWING_PITCH],
      [1, HEEL_STRIKE_PITCH],
    ]),
  };
}

function chargeBase(phase: number): TusklingPose {
  const pose = restingPose();
  pose.crouch = CHARGE_CROUCH;
  pose.headThrust = 1;
  pose.headTilt = deg(26);
  pose.glare = 1;
  pose.maw = 0.55;
  pose.snort = 1;
  pose.leftFist = 1;
  pose.rightFist = 1;
  pose.bristleFlow = -1;
  pose.blink = 0;
  const bobPhase = Math.abs(Math.sin(phase * FULL_TURN));
  pose.bob = CHARGE_BOB * (1 - bobPhase);
  return pose;
}

function chargeSide(phase: number): TusklingPose {
  const pose = chargeBase(phase);
  const right = chargeFootSide(phase);
  const left = chargeFootSide(phase + 0.5);
  pose.lean = CHARGE_LEAN;
  // The hips travel back as the shoulders tip forward. Leaning the spine alone
  // pivots the whole trunk about a hip that stays under the chest, so the rear
  // third of the body hangs over nothing and the sprint reads as a fall.
  pose.sway = -CHARGE_HIP_BACK;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  // Both arms trail behind through the whole sprint. A charging tuskling leads
  // with its skull; arms pumping alongside it would argue with the read.
  const swing = Math.sin(phase * FULL_TURN) * 0.25;
  pose.rightArmAngles = {
    upper: CHARGE_ARM_BACK + swing,
    fore: CHARGE_ARM_BACK * 0.5,
    foreScale: 1,
  };
  pose.leftArmAngles = {
    upper: CHARGE_ARM_BACK - swing,
    fore: CHARGE_ARM_BACK * 0.5,
    foreScale: 1,
  };
  pose.headTurn = SIDE_HEAD_TURN;
  return pose;
}

export function chargeFacing(phase: number, away: boolean): TusklingPose {
  const pose = chargeBase(phase);
  const right = gaitFootFacing(phase, 1);
  const left = gaitFootFacing(phase + 0.5, -1);
  pose.sway = Math.sin(phase * FULL_TURN) * WALK_SWAY * 1.6;
  pose.rightFoot = pt(right.foot.x, right.foot.y * 1.5);
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = pt(left.foot.x, left.foot.y * 1.5);
  pose.leftFootPitch = left.pitch;
  pose.rightLegNearness = right.nearness;
  pose.leftLegNearness = left.nearness;
  pose.rightForeshorten = 1;
  pose.leftForeshorten = 1;
  const swing = Math.sin(phase * FULL_TURN) * 0.2;
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, -1 + swing, 0, WALK_ELBOW_FLEX * 3);
  pose.rightArmAngles = facingArmAngles(RIGHT_ARM, -1 - swing, 0, WALK_ELBOW_FLEX * 3);
  pose.leftArmBehind = away;
  pose.rightArmBehind = away;
  pose.headTurn = 0;
  pose.twist = Math.sin(phase * FULL_TURN) * 0.14;
  return pose;
}

// ── Tusk hook ────────────────────────────────────────────────────────────────

const HOOK_IMPACT_AT = TUSKLING_HOOK_IMPACT_PROGRESS;
const HOOK_COCK_BY = 0.24;
/**
 * How far past the impact the recovery has already begun, in row fractions.
 * One frame's worth: held for three the strike has no snap and the player
 * cannot tell which frame was the blow.
 */
const HOOK_RECOVER_STEP = 1 / (TUSKLING_HOOK_FRAMES - 1);
const HOOK_COCK_TILT = deg(-34);
const HOOK_STRIKE_TILT = deg(44);
const HOOK_COCK_LEAN = deg(-9);
const HOOK_STRIKE_LEAN = deg(30);

/**
 * The melee attack: the head cocks away and down, then drives up and across so
 * the long front tusks rake the target, then falls back to standing.
 *
 * Every key is written against `HOOK_IMPACT_AT`, which comes from the shared
 * timing module the creature counts its damage frame off — so the peak of the
 * motion and the frame the blow lands on cannot drift apart.
 */
function hookBase(t: number): TusklingPose {
  const pose = restingPose();
  pose.headTilt = keyed(t, [
    [0, 0],
    [HOOK_COCK_BY, HOOK_COCK_TILT],
    [HOOK_IMPACT_AT, HOOK_STRIKE_TILT],
    [HOOK_IMPACT_AT + HOOK_RECOVER_STEP, HOOK_STRIKE_TILT * 0.55],
    [1, 0],
  ]);
  pose.lean = keyed(t, [
    [0, 0],
    [HOOK_COCK_BY, HOOK_COCK_LEAN],
    [HOOK_IMPACT_AT, HOOK_STRIKE_LEAN],
    [0.78, HOOK_STRIKE_LEAN * 0.35],
    [1, 0],
  ]);
  pose.crouch = keyed(t, [
    [0, 0],
    [HOOK_COCK_BY, 0.28],
    [HOOK_IMPACT_AT, 0.06],
    [1, 0],
  ]);
  // Shallow. Sunk any deeper the shoulder mass swallows the jaw and the tusk
  // appears to grow out of the chest with no head attached to it.
  pose.headThrust = keyed(t, [
    [0, 0],
    [HOOK_COCK_BY, 0.26],
    [HOOK_IMPACT_AT, 0.08],
    [1, 0],
  ]);
  pose.maw = keyed(t, [
    [0, 0],
    [HOOK_COCK_BY, 0.35],
    [HOOK_IMPACT_AT, 1],
    [0.8, 0.3],
    [1, 0],
  ]);
  pose.glare = keyed(t, [
    [0, 0.2],
    [HOOK_IMPACT_AT, 1],
    [1, 0.2],
  ]);
  pose.snort = keyed(t, [
    [0, IDLE_SNORT],
    [HOOK_COCK_BY, 0.9],
    [HOOK_IMPACT_AT, 0.5],
    [1, IDLE_SNORT],
  ]);
  pose.bristleFlow = keyed(t, [
    [0, 0],
    [HOOK_COCK_BY, 0.8],
    [HOOK_IMPACT_AT, -1],
    [1, 0],
  ]);
  pose.leftFist = 1;
  pose.rightFist = 1;
  return pose;
}

/**
 * Profile hand targets. Edge-on the two shoulder joints sit almost on the
 * centreline (`PROFILE_ARM_SPREAD`), so a hand placed at the head-on hang
 * spread is most of an arm's length out to the side and the IK clamps.
 */
const HOOK_REST_HAND = pt(SIDE_HAND_FORWARD, SHOULDER_Y + HAND_HANG_DROP);
const HOOK_BRACE_HAND = pt(0.13, SHOULDER_Y + HAND_HANG_DROP * 0.8);
/**
 * Forward of the shoulder root, not behind it. A thirty-degree lean swings the
 * shoulder most of a third of a tile toward +X, so a hand target left where the
 * standing shoulder was is out of the arm's reach by the impact frame.
 */
const HOOK_DRIVE_HAND = pt(0.08, SHOULDER_Y + HAND_HANG_DROP * 0.72);

function hookSide(t: number): TusklingPose {
  const pose = hookBase(t);
  // The hooves plant wide and the body rocks over them; there is no step in a
  // hook, only a shift of weight.
  // A real lunge, not a rock: the whole body has to travel or the strike is a
  // shrug and the impact frame is indistinguishable from the two beside it.
  const shift = keyed(t, [
    [0, 0],
    [HOOK_COCK_BY, -0.06],
    [HOOK_IMPACT_AT, 0.12],
    [0.78, 0.04],
    [1, 0],
  ]);
  pose.sway = shift;
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD * 1.6, 0);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD * 1.6, 0);
  pose.rightHand = keyedPoint(t, [
    [0, HOOK_REST_HAND],
    [HOOK_COCK_BY, HOOK_BRACE_HAND],
    [HOOK_IMPACT_AT, HOOK_DRIVE_HAND],
    [1, HOOK_REST_HAND],
  ]);
  pose.leftHand = keyedPoint(t, [
    [0, pt(SIDE_HAND_FORWARD * 0.55, HOOK_REST_HAND.y)],
    [HOOK_COCK_BY, pt(SIDE_HAND_FORWARD * 0.1, HOOK_BRACE_HAND.y)],
    [HOOK_IMPACT_AT, pt(SIDE_HAND_FORWARD * 0.85, HOOK_DRIVE_HAND.y)],
    [1, pt(SIDE_HAND_FORWARD * 0.55, HOOK_REST_HAND.y)],
  ]);
  pose.elbowFlare = ELBOW_IN_FRONT;
  pose.headTurn = SIDE_HEAD_TURN;
  return pose;
}

function hookFacing(t: number, away: boolean): TusklingPose {
  const pose = hookBase(t);
  // Head-on the hook is a twist: the shoulders wind one way and unwind through
  // the strike, which is the only travel the picture plane can show.
  const wind = keyed(t, [
    [0, 0],
    [HOOK_COCK_BY, -1],
    [HOOK_IMPACT_AT, 1],
    [0.8, 0.3],
    [1, 0],
  ]);
  pose.twist = wind * 0.5;
  pose.headTurn = (away ? -wind : wind) * 0.4;
  pose.sway = wind * 0.02;
  pose.leftFoot = pt(-FOOT_STAND_SPREAD * 1.35, 0);
  pose.rightFoot = pt(FOOT_STAND_SPREAD * 1.35, 0);
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  // FK on both arms: head-on a hand target crossing the shoulder flips the
  // solver's elbow sign, and the arm turns inside out on one frame.
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, -0.4 - wind * 0.5, 0.4, WALK_ELBOW_FLEX * 2.5);
  pose.rightArmAngles = facingArmAngles(RIGHT_ARM, -0.4 + wind * 0.5, 0.4, WALK_ELBOW_FLEX * 2.5);
  pose.leftArmBehind = away;
  pose.rightArmBehind = away;
  return pose;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: TusklingView;
  readonly kind: RowKind;
  /** Null on the gore row, whose cells are pieces rather than poses. */
  readonly pose: ((frame: number) => TusklingPose) | null;
}

/** Loops sample the cycle evenly; one-shots sample the frame's own position. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return frame / (frameCount - 1);
}

const GORE_PIECES: readonly GorePiece[] = tusklingGorePieces();
/** Pieces are authored at their own tile-unit sizes, not the creature's scale. */
const GORE_PIECE_SCALE = 1.5;
const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

export const ROWS: readonly RowSpec[] = [
  {
    name: 'idle',
    frameCount: TUSKLING_IDLE_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (f) => idleFacing(cyclePhase(f, TUSKLING_IDLE_FRAMES), false),
  },
  {
    name: 'idle_side',
    frameCount: TUSKLING_IDLE_FRAMES,
    view: 'side',
    kind: 'loop',
    pose: (f) => idleSide(cyclePhase(f, TUSKLING_IDLE_FRAMES)),
  },
  {
    name: 'idle_away',
    frameCount: TUSKLING_IDLE_FRAMES,
    view: 'back',
    kind: 'loop',
    pose: (f) => idleFacing(cyclePhase(f, TUSKLING_IDLE_FRAMES), true),
  },
  {
    name: 'walk',
    frameCount: TUSKLING_WALK_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (f) => walkFacing(cyclePhase(f, TUSKLING_WALK_FRAMES), false),
  },
  {
    name: 'walk_side',
    frameCount: TUSKLING_WALK_FRAMES,
    view: 'side',
    kind: 'loop',
    pose: (f) => walkSide(cyclePhase(f, TUSKLING_WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: TUSKLING_WALK_FRAMES,
    view: 'back',
    kind: 'loop',
    pose: (f) => walkFacing(cyclePhase(f, TUSKLING_WALK_FRAMES), true),
  },
  {
    name: 'hook',
    frameCount: TUSKLING_HOOK_FRAMES,
    view: 'front',
    kind: 'oneShot',
    pose: (f) => hookFacing(shotProgress(f, TUSKLING_HOOK_FRAMES), false),
  },
  {
    name: 'hook_side',
    frameCount: TUSKLING_HOOK_FRAMES,
    view: 'side',
    kind: 'oneShot',
    pose: (f) => hookSide(shotProgress(f, TUSKLING_HOOK_FRAMES)),
  },
  {
    name: 'hook_away',
    frameCount: TUSKLING_HOOK_FRAMES,
    view: 'back',
    kind: 'oneShot',
    pose: (f) => hookFacing(shotProgress(f, TUSKLING_HOOK_FRAMES), true),
  },
  {
    name: 'snort',
    frameCount: TUSKLING_SNORT_FRAMES,
    view: 'front',
    kind: 'oneShot',
    pose: (f) => snortFacing(shotProgress(f, TUSKLING_SNORT_FRAMES), false),
  },
  {
    name: 'snort_side',
    frameCount: TUSKLING_SNORT_FRAMES,
    view: 'side',
    kind: 'oneShot',
    pose: (f) => snortSide(shotProgress(f, TUSKLING_SNORT_FRAMES)),
  },
  {
    name: 'snort_away',
    frameCount: TUSKLING_SNORT_FRAMES,
    view: 'back',
    kind: 'oneShot',
    pose: (f) => snortFacing(shotProgress(f, TUSKLING_SNORT_FRAMES), true),
  },
  {
    name: 'charge',
    frameCount: TUSKLING_CHARGE_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (f) => chargeFacing(cyclePhase(f, TUSKLING_CHARGE_FRAMES), false),
  },
  {
    name: 'charge_side',
    frameCount: TUSKLING_CHARGE_FRAMES,
    view: 'side',
    kind: 'loop',
    pose: (f) => chargeSide(cyclePhase(f, TUSKLING_CHARGE_FRAMES)),
  },
  {
    name: 'charge_away',
    frameCount: TUSKLING_CHARGE_FRAMES,
    view: 'back',
    kind: 'loop',
    pose: (f) => chargeFacing(cyclePhase(f, TUSKLING_CHARGE_FRAMES), true),
  },
  {
    name: 'gore',
    frameCount: GORE_PIECES.length,
    view: 'side',
    kind: 'gore',
    pose: null,
  },
];

function paintView(ctx: Ctx, view: TusklingView, pose: TusklingPose): void {
  if (view === 'front') drawTusklingFront(ctx, pose);
  else if (view === 'back') drawTusklingBack(ctx, pose);
  else drawTusklingSide(ctx, pose);
}

// ── Bake ─────────────────────────────────────────────────────────────────────

interface SheetGeometry {
  frameWidth: number;
  frameHeight: number;
  tileX: number;
  tileY: number;
}

export interface BakedSheet {
  buffer: Buffer;
  geometry: SheetGeometry;
  columns: number;
}

const INK_ALPHA = 8;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const MEASURE_SPAN = 384;
const MEASURE_ORIGIN = MEASURE_SPAN / 2;
/**
 * A gore piece cannot exceed this multiple of the animation cells' area. The
 * pieces are authored at their own scale, so a fat one quietly doubles every
 * cell on the sheet, blank ones included.
 */
const GORE_AREA_INFLATION_LIMIT = 2;

interface Extents {
  left: number;
  right: number;
  up: number;
  down: number;
  goreRadius: number;
}

interface FrameJob {
  readonly row: RowSpec;
  readonly frame: number;
  readonly anchor: 'origin' | 'cellCentre';
  readonly paint: (ctx: Ctx, originX: number, originY: number) => void;
}

function buildJobs(goreOffsets?: ReadonlyMap<number, Pt>): FrameJob[] {
  const jobs: FrameJob[] = [];
  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      if (row.kind === 'gore') {
        const piece = GORE_PIECES[frame];
        const recentre = goreOffsets?.get(frame) ?? { x: 0, y: 0 };
        jobs.push({
          row,
          frame,
          anchor: 'cellCentre',
          paint: (ctx, originX, originY) => {
            ctx.save();
            ctx.translate(originX + recentre.x * GORE_UNIT, originY + recentre.y * GORE_UNIT);
            ctx.scale(GORE_UNIT, GORE_UNIT);
            piece.paint(ctx);
            ctx.restore();
          },
        });
        continue;
      }
      const posed = row.pose;
      if (posed === null) throw new Error(`row ${row.name} is not a gore row but has no pose`);
      jobs.push({
        row,
        frame,
        anchor: 'origin',
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE * FIGURE_SCALE, TILE_SCALE * FIGURE_SCALE);
          paintView(ctx, row.view, posed(frame));
          ctx.restore();
        },
      });
    }
  }
  return jobs;
}

interface Measured {
  extents: Extents;
  goreOffsets: Map<number, Pt>;
}

/** Where the ink of every frame actually lands, relative to its own anchor. */
function measure(jobs: readonly FrameJob[]): Measured {
  const canvas = createCanvas(MEASURE_SPAN, MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  const extents: Extents = { left: 0, right: 0, up: 0, down: 0, goreRadius: 0 };
  const goreOffsets = new Map<number, Pt>();

  for (const job of jobs) {
    ctx.clearRect(0, 0, MEASURE_SPAN, MEASURE_SPAN);
    job.paint(ctx, MEASURE_ORIGIN, MEASURE_ORIGIN);
    const { data } = ctx.getImageData(0, 0, MEASURE_SPAN, MEASURE_SPAN);
    let minX = MEASURE_SPAN;
    let maxX = -1;
    let minY = MEASURE_SPAN;
    let maxY = -1;
    for (let y = 0; y < MEASURE_SPAN; y++) {
      for (let x = 0; x < MEASURE_SPAN; x++) {
        if (data[(y * MEASURE_SPAN + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) {
      throw new Error(
        `${job.row.name}[${job.frame}] painted nothing at all, which almost always means a NaN in the pose`,
      );
    }

    if (job.anchor === 'cellCentre') {
      const halfWidth = Math.max(MEASURE_ORIGIN - minX, maxX - MEASURE_ORIGIN);
      const halfHeight = Math.max(MEASURE_ORIGIN - minY, maxY - MEASURE_ORIGIN);
      extents.goreRadius = Math.max(extents.goreRadius, Math.hypot(halfWidth, halfHeight));
      goreOffsets.set(job.frame, {
        x: (MEASURE_ORIGIN - (minX + maxX) / 2) / GORE_UNIT,
        y: (MEASURE_ORIGIN - (minY + maxY) / 2) / GORE_UNIT,
      });
      continue;
    }
    extents.left = Math.max(extents.left, MEASURE_ORIGIN - minX);
    extents.right = Math.max(extents.right, maxX - MEASURE_ORIGIN);
    extents.up = Math.max(extents.up, MEASURE_ORIGIN - minY);
    extents.down = Math.max(extents.down, maxY - MEASURE_ORIGIN);
  }
  return { extents, goreOffsets };
}

function roundUpTo(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

/**
 * The cell has to hold the widest pose *and* the inscribed circle of the
 * largest gore piece, which spins about its own ink centre at runtime.
 */
function geometryFor(extents: Extents): SheetGeometry {
  const goreSpan = (extents.goreRadius + FRAME_PADDING) * 2;
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const poseWidth = roundUpTo(halfWidth * 2, FRAME_SIZE_QUANTUM);
  const originY = Math.ceil(extents.up + FRAME_PADDING);
  const poseHeight = roundUpTo(originY + extents.down + FRAME_PADDING, FRAME_SIZE_QUANTUM);
  const frameWidth = roundUpTo(Math.max(poseWidth, goreSpan), FRAME_SIZE_QUANTUM);
  const frameHeight = roundUpTo(Math.max(poseHeight, goreSpan), FRAME_SIZE_QUANTUM);

  const inflation = (frameWidth * frameHeight) / (poseWidth * poseHeight);
  if (inflation > GORE_AREA_INFLATION_LIMIT) {
    throw new Error(
      `the gore pieces inflate every cell on the sheet by ${inflation.toFixed(2)}x ` +
        `(poses need ${poseWidth}×${poseHeight}, gore needs ${Math.ceil(goreSpan)} square) — ` +
        `limit ${GORE_AREA_INFLATION_LIMIT}x; shrink the pieces or GORE_PIECE_SCALE`,
    );
  }

  return {
    frameWidth,
    frameHeight,
    tileX: Math.round(frameWidth / 2 - TILE_SCALE / 2),
    tileY: originY - GROUND_OFFSET_PX,
  };
}

export function bake(): BakedSheet {
  const firstPass = measure(buildJobs());
  const jobs = buildJobs(firstPass.goreOffsets);
  const geometry = geometryFor(measure(jobs).extents);
  const columns = Math.max(...ROWS.map((row) => row.frameCount));

  const sheet = createCanvas(columns * geometry.frameWidth, ROWS.length * geometry.frameHeight);
  const sheetCtx = sheet.getContext('2d');
  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  const poseOriginX = geometry.frameWidth / 2;
  const poseOriginY = geometry.tileY + GROUND_OFFSET_PX;
  const rowIndexOf = new Map(ROWS.map((row, index) => [row.name, index] as const));

  for (const job of jobs) {
    const rowIndex = rowIndexOf.get(job.row.name);
    if (rowIndex === undefined) throw new Error(`row ${job.row.name} is not in ROWS`);
    cellCtx.clearRect(0, 0, cell.width, cell.height);
    cellCtx.save();
    cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    if (job.anchor === 'cellCentre') {
      job.paint(cellCtx, geometry.frameWidth / 2, geometry.frameHeight / 2);
    } else {
      job.paint(cellCtx, poseOriginX, poseOriginY);
    }
    cellCtx.restore();

    sheetCtx.drawImage(
      cell,
      0,
      0,
      cell.width,
      cell.height,
      job.frame * geometry.frameWidth,
      rowIndex * geometry.frameHeight,
      geometry.frameWidth,
      geometry.frameHeight,
    );
  }

  return { buffer: sheet.toBuffer('image/png'), geometry, columns };
}

// ── Manifest ─────────────────────────────────────────────────────────────────

interface ManifestStateEntry {
  readonly row: number;
  readonly frameCount: number;
  readonly colOffset?: number;
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
    if (row.kind === 'gore') {
      GORE_STATES.forEach((state, column) => {
        states[state] = { row: index, colOffset: column, frameCount: 1 };
      });
      return;
    }
    states[row.name] = { row: index, frameCount: row.frameCount };
  });
  return {
    path: SHEET_RELATIVE_PATH,
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

/** A stable string for comparing two manifest entries; key order carries no meaning. */
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
 * Checks manifest.json against the bake rather than rewriting it. That file is
 * shared with every other sprite in the game and other agents edit it, so a
 * generator that rewrote it would silently clobber their work.
 */
export function manifestMismatch(sheet: BakedSheet): string | null {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const required = manifestEntry(sheet);
  if (canonicalJson(manifest[SPRITE_KEY]) === canonicalJson(required)) return null;
  return (
    `${MANIFEST_PATH} is out of sync with the bake. Replace its "${SPRITE_KEY}" entry with:\n` +
    `${JSON.stringify(required, null, 2)}`
  );
}

/** Writes a sheet the gates have already measured. */
export function writeSheet(sheet: BakedSheet): void {
  console.log(`Writing the tuskling sheet (tileScale=${TILE_SCALE}, scale=${FIGURE_SCALE})…`);
  writeFileSync(resolve(SHEET_PATH), sheet.buffer);
  const { frameWidth, frameHeight, tileX, tileY } = sheet.geometry;
  console.log(`  → ${SHEET_PATH}`);
  console.log(
    `  → ${sheet.columns * frameWidth}×${ROWS.length * frameHeight}px  ` +
      `(${ROWS.length} rows × ${sheet.columns} cols of ${frameWidth}×${frameHeight})`,
  );
  ROWS.forEach((row, index) => {
    console.log(
      `     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view}, ${row.kind})`,
    );
  });
  console.log(`  tileX=${tileX}  tileY=${tileY}  tileScale=${TILE_SCALE}`);
}

// This module is imported by the review harness and by the gate module, so it
// must not paint anything when it is merely loaded — and it is never the entry
// point: `npm run gen:tuskling` runs the gates, which write the sheet they
// measured. Run directly it explains itself rather than writing an ungated
// sheet.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  console.error('Run `npm run gen:tuskling`; a sheet that skipped its gates must not reach disk.');
  process.exitCode = 1;
}
