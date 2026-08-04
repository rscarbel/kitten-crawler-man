#!/usr/bin/env tsx
/**
 * Generates the `dark_knight` sprite sheet — the bounty board's mace knight.
 *
 * The anatomy and the painting live in `scripts/darkKnightArt.ts`; this file is
 * only the choreography (one pose function per row), the sheet geometry, and
 * the bake gates. Nothing here draws a plate.
 *
 * Rows (see the `dark_knight` entry in src/images/enemies/manifest.json):
 *    0 walk        — toward the camera
 *    1 walk_side   — profile, drawn facing +X and mirrored at runtime
 *    2 walk_away   — away from the camera, backplate and cloak
 *    3 idle        — toward
 *    4 idle_side
 *    5 idle_away
 *    6 slam        — overhead two-hand raise, full-body drop, mace buried
 *    7 slam_side
 *    8 slam_away
 *    9 sweep       — mace whirled round the helm, then a level 360° sweep
 *   10 sweep_side
 *   11 sweep_away
 *   12 punch       — off-hand jab, snappy because it is undodgeable
 *   13 punch_side
 *   14 punch_away
 *   15 gore        — the seven pieces, one per column
 *
 * The cell size is **measured** from the baked ink rather than declared, so a
 * pose that grows cannot silently clip; the generator then prints the manifest
 * entry it requires and verifies (never rewrites) the one on disk.
 *
 * Run: npm run gen:dark-knight
 *      npm run gen:dark-knight -- --skip-manifest-gate   (measure→paste loop)
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ARM_LENGTH,
  FIGURE_HEIGHT,
  LEG_REACH_LIMIT,
  SHOULDER_JOINT_DROP,
  SHOULDER_Y,
  type ArmAngles,
  type KnightPose,
  type KnightView,
  type Pt,
  clamp01,
  deg,
  drawKnightBack,
  drawKnightFront,
  drawKnightSide,
  easeIn,
  easeInOut,
  easeOut,
  legReach,
  lerp,
  macePosition,
  makeMacePainter,
  ramp,
  restingPose,
  SHADOW_RY,
} from './darkKnightArt.js';
import { darkKnightGorePieces } from './darkKnightGore.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** Clear pixels kept between the furthest ink and the cell edge. */
const FRAME_PADDING = 6;
/** Cell dimensions are rounded up to this, so the sheet blits on whole pixels. */
const FRAME_SIZE_QUANTUM = 4;
const MAX_PNG_COMPRESSION = 9;
/**
 * Ceiling on the baked sheet's area. Fifteen animation rows across three views
 * is a lot of cells, and most of them are transparent — the PNG compresses, but
 * the decoded texture does not.
 */
const TEXTURE_BUDGET_MEGAPIXELS = 16;
const PIXELS_PER_MEGAPIXEL = 1_000_000;
const BYTES_PER_MEGABYTE = 1_000_000;

/**
 * How much of a tile the knight fills. Carl stands at 0.72 of his 2.03 units,
 * i.e. 1.46 tiles; the knight at 0.94 of 2.28 stands 2.14 — half again Carl's
 * height, which is the whole point of him.
 */
const KNIGHT_SCALE = 0.94;

/** Ground line within the tile, matching where every other biped's feet sit. */
const GROUND_OFFSET_IN_TILE = 0.9;

const WALK_FRAMES = 16;
const IDLE_FRAMES = 8;
export const SLAM_FRAMES = 16;
export const SWEEP_FRAMES = 18;
export const PUNCH_FRAMES = 8;

/**
 * The frame each attack lands on. `src/sprites/darkKnightSprite.ts` re-declares
 * these — the runtime cannot import from `scripts/` — and the generator prints
 * its timing table on every bake so a drift is visible.
 */
export const SLAM_IMPACT_FRAME = 9;
export const SWEEP_IMPACT_FRAME = 13;
export const PUNCH_IMPACT_FRAME = 4;

// ── Pose helpers ─────────────────────────────────────────────────────────────

function pt(x: number, y: number): Pt {
  return { x, y };
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

/** Piecewise linear interpolation through a set of (t, value) keys. */
function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  for (let i = 1; i < keys.length; i++) {
    const [prevT, prevV] = keys[i - 1];
    const [nextT, nextV] = keys[i];
    if (t <= nextT) return lerp(prevV, nextV, (t - prevT) / (nextT - prevT));
  }
  return keys[keys.length - 1][1];
}

// ── The carry ────────────────────────────────────────────────────────────────

/**
 * The knight walks and stands with the mace shouldered rather than swinging at
 * his side. Two reasons, both about the silhouette: a 0.94-tile haft swung from
 * a hanging hand sweeps a quarter of the frame and drags the cell size out for
 * every row, and shouldered it puts a second vertical mass beside the helm,
 * which is what says "armed" at a 32 px tile.
 */
const CARRY_HAND_SPREAD = 0.33;
const CARRY_HAND_DROP = 0.5;
/** How far back from vertical the shouldered haft leans, per view. */
const CARRY_MACE_TILT = deg(26);
/** Straight up in screen terms; the mace leans off this. */
const STRAIGHT_UP = deg(-90);

/** Where a relaxed off-hand hangs: just inside the arm's own reach. */
const HAND_HANG_SPREAD = 0.375;
const ARM_HANG_REACH = ARM_LENGTH * 0.99;
const HAND_HANG_DROP = SHOULDER_JOINT_DROP + ARM_HANG_REACH;

/** Feet stand under the hips; wider angles the thighs out and reads knock-kneed. */
const IDLE_FOOT_SPREAD = 0.16;
/** Edge-on the two feet are only slightly staggered. */
const IDLE_SIDE_FOOT_LEAD = 0.085;

/**
 * Puts the mace on the right shoulder for a locomotion or idle pose.
 *
 * The haft leans *outboard*, away from the helm. Leaned the other way it lies
 * diagonally across the visor and the head sits behind the helm's own corner:
 * from the front the knight then appears to be carrying nothing at all.
 */
/**
 * How far the shouldered mace rocks against the stride, and how far behind the
 * torso's own bob its head lags. Small numbers: it is fifteen pounds of steel
 * braced on a pauldron, not a swinging arm. Without either, the upper body is
 * pixel-identical across all sixteen walk frames and moonwalks over the legs.
 */
const CARRY_ROCK = deg(7);
const CARRY_HAND_BOB = 0.018;

function shoulderTheMace(pose: KnightPose, view: KnightView, rock = 0): void {
  const lean = CARRY_MACE_TILT;
  pose.rightHand = pt(
    CARRY_HAND_SPREAD,
    SHOULDER_Y + CARRY_HAND_DROP + pose.bob + rock * CARRY_HAND_BOB,
  );
  pose.maceAngle = STRAIGHT_UP + lean + rock * CARRY_ROCK;
  // Behind the body only when the shaft would otherwise cross the helm, which
  // is the away view — from there the knight's own back is between them.
  pose.macePropBehind = view === 'back';
}

/**
 * Eases a finished attack back toward the pose the knight stands in.
 *
 * Without this an attack row ends wherever its follow-through left the arms —
 * the slam ended in a T-pose with the mace at half-mast — and the runtime then
 * cuts straight from that to the idle's shouldered carry. A one-shot has to
 * hand off to the pose that follows it, or every attack ends in a pop.
 */
function settleTowardCarry(pose: KnightPose, view: KnightView, amount: number): void {
  if (amount <= 0) return;
  // The row's own idle, not a bare resting pose: the idle is what the runtime
  // actually cuts to, and it is also the only stance whose foot spread is known
  // to be inside the leg's reach for this view.
  const carry = idleFor(view);
  const t = clamp01(amount);
  pose.rightHand = pt(
    lerp(pose.rightHand.x, carry.rightHand.x, t),
    lerp(pose.rightHand.y, carry.rightHand.y, t),
  );
  pose.leftHand = pt(
    lerp(pose.leftHand.x, carry.leftHand.x, t),
    lerp(pose.leftHand.y, carry.leftHand.y, t),
  );
  // Toward the *nearest* equivalent of the carry angle. A sweep ends two whole
  // turns past where it started, and a plain lerp to −72° would unwind those
  // turns during the settle — the mace spinning backwards for four frames.
  pose.maceAngle = lerp(pose.maceAngle, nearestEquivalentAngle(carry.maceAngle, pose.maceAngle), t);
  pose.crouch = lerp(pose.crouch, carry.crouch, t);
  pose.lean = lerp(pose.lean, carry.lean, t);
  pose.twist = lerp(pose.twist, carry.twist, t);
  pose.skirtFlare = lerp(pose.skirtFlare, carry.skirtFlare, t);
  pose.cloakSway = lerp(pose.cloakSway, carry.cloakSway, t);
  pose.headTilt = lerp(pose.headTilt, carry.headTilt, t);
  pose.leftFoot = pt(
    lerp(pose.leftFoot.x, carry.leftFoot.x, t),
    lerp(pose.leftFoot.y, carry.leftFoot.y, t),
  );
  pose.rightFoot = pt(
    lerp(pose.rightFoot.x, carry.rightFoot.x, t),
    lerp(pose.rightFoot.y, carry.rightFoot.y, t),
  );
}

/** `target`, shifted by whole turns so it is within half a turn of `near`. */
function nearestEquivalentAngle(target: number, near: number): number {
  const turn = Math.PI * 2;
  return target + Math.round((near - target) / turn) * turn;
}

/** The standing pose an attack in this view hands back to. */
function idleFor(view: KnightView): KnightPose {
  if (view === 'side') return idleSide(0);
  if (view === 'back') return idleBack(0);
  return idleFront(0);
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/**
 * Standing still has to read as *alive* without reading as swaying. A knight in
 * plate does not breathe visibly through his chest, so the tell is the shoulder
 * line rising and the helm settling — deliberately near the threshold of
 * visibility at a 32 px tile.
 */
const BREATH_RISE = 0.011;
const BREATH_LEAN = deg(0.7);
const IDLE_SWAY = 0.008;
const IDLE_HEAD_TURN = 0.06;
/** How far the helm stays turned toward the camera while standing in profile. */
const SIDE_HEAD_TURN = 0.22;
const IDLE_VISOR_PULSE = 0.18;
const IDLE_ARM_DRIFT = 0.06;
const IDLE_SKIRT_FLARE = 0.1;

function idleBase(phase: number): KnightPose {
  const breath = Math.sin(phase * Math.PI * 2);
  const pose = restingPose();
  // The breath *settles* rather than lifts. A standing figure's leg is already
  // within half a percent of full extension, so raising the hip at all pushes
  // the ankle out of reach and the solver locks the leg — and a knight whose
  // weight sinks on the out-breath reads heavier anyway.
  pose.bob = BREATH_RISE * (breath * 0.5 + 0.5);
  pose.lean = BREATH_LEAN * breath;
  pose.visorGlow = 0.55 + IDLE_VISOR_PULSE * breath;
  pose.skirtFlare = IDLE_SKIRT_FLARE;
  return pose;
}

function idleFront(phase: number): KnightPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * Math.PI * 2);
  pose.sway = sway * IDLE_SWAY;
  pose.headTurn = sway * IDLE_HEAD_TURN;
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, sway * IDLE_ARM_DRIFT, 0, 0);
  pose.leftFoot = pt(-IDLE_FOOT_SPREAD, 0);
  pose.rightFoot = pt(IDLE_FOOT_SPREAD, 0);
  // Straight columns, matching the head-on walk, so standing up out of a step
  // does not pop the knees into a bow.
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  shoulderTheMace(pose, 'front');
  return pose;
}

function idleSide(phase: number): KnightPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * Math.PI * 2);
  pose.leftHand = pt(-SIDE_HAND_BEHIND, SHOULDER_Y + HAND_HANG_DROP + pose.bob);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD, 0);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD, 0);
  pose.headTurn = SIDE_HEAD_TURN + sway * IDLE_HEAD_TURN;
  // Edge-on the elbow has to break backward; forward it swings the forearm
  // across the knight's own front.
  pose.elbowFlare = -0.35;
  shoulderTheMace(pose, 'side');
  return pose;
}

/** How far behind the hip the off hand hangs in profile. */
const SIDE_HAND_BEHIND = 0.06;

function idleBack(phase: number): KnightPose {
  const pose = idleFront(phase);
  pose.headTurn = -pose.headTurn;
  // Seen from behind the arms hang on the far side of him, as they do in the
  // walk he steps into from here.
  pose.leftArmBehind = true;
  pose.rightArmBehind = true;
  shoulderTheMace(pose, 'back');
  return pose;
}

// ── Walking ──────────────────────────────────────────────────────────────────

/**
 * A walk cycle keyed the way animators key one: contact → down → passing → up,
 * twice per cycle. Phase 0 is right-foot contact.
 *
 * The stride is short and the bob deep. His leg is very nearly as long as his
 * hip is high, so a foot planted much further out than this is beyond the leg's
 * reach — the solver clamps, the leg locks straight, and the next frame's tuck
 * snaps it back, which is the hitch that reads as a hop. Armour buys nothing
 * here; it only makes the hitch more obvious, because the leg is wider.
 */
const STRIDE = 0.185;
const TUCK_LIFT = 0.185;
const TOE_LIFT = 0.045;
const TOE_LIFT_AT = 0.12;
const PASS_LIFT = 0.13;
const REACH_LIFT = 0.028;
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;

/**
 * Deeper than a man's. Weight is the whole read of this walk: the pelvis drops
 * hard onto each contact and the shoulders follow, which is what a person in
 * fifty pounds of steel does and a person in a jacket does not.
 */
const WALK_BOB = 0.075;
const WALK_LEAN = deg(4);
const WALK_SWAY = 0.018;
const HEEL_STRIKE_PITCH = deg(-8);
const TOE_OFF_PITCH = deg(12);
const SWING_PITCH = deg(-5);
const WALK_SKIRT_FLARE = 0.55;

/** Where the stance foot is planted, in cycle phase, for the foot-slide gate. */
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
const FACING_STRIDE_DRIFT = 0.055;
/** The lift at which the swing leg's shin is drawn at full near-camera width. */
const FULLY_NEAR_LIFT = TUCK_LIFT * FACING_LIFT_SHARE;

/**
 * Walking at the camera. A knee pointed at the viewer does not read as an angle
 * — it hinges away from the camera, not across it — so the swing leg stays a
 * straight column and reports only how foreshortened it is.
 */
function gaitFootFacing(
  phase: number,
  side: number,
): { foot: Pt; pitch: number; nearness: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_SHARE;
  const t = stance ? cycle / STANCE_SHARE : (cycle - STANCE_SHARE) / (1 - STANCE_SHARE);
  const home = side * IDLE_FOOT_SPREAD;

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

const LEFT_ARM = -1;
/** Shoulder rotation at the top of the forward swing. */
const ARM_SWING_ANGLE = deg(30);
/** An arm swings further forward than back, so the backswing is scaled down. */
const ARM_BACKSWING_SHARE = 0.55;
/** How much of the shoulder's swing the forearm inherits. */
const FOREARM_FOLLOW = 0.22;
/** The bend a walking elbow simply holds, keeping the forearm ahead of the arm. */
const ELBOW_FLEX = deg(12);
/** How much of its length the forearm loses at the front of a head-on swing. */
const FACING_FOREARM_FORESHORTEN = 0.16;
const WALK_ELBOW_FLEX = deg(7);
/**
 * A relaxed arm carries a little standing flexion at the elbow — the break that
 * gives the arm a readable joint and holds it off the ribs. The upper arm
 * therefore tilts out further than the forearm does.
 */
const FACING_ELBOW_FLEX = deg(8);
/** Head-on the upper arm is nearly end-on and shows very little travel... */
const FACING_UPPER_SWING = deg(5);
/** ...so the forearm carries most of what there is. */
const FACING_FOREARM_SWING = deg(11);

function armSwingAngle(forward: number): number {
  const shortened = forward >= 0 ? forward : forward * ARM_BACKSWING_SHARE;
  return shortened * ARM_SWING_ANGLE;
}

/**
 * A profile arm, driven from its joints rather than from a hand target. Almost
 * all of a walking arm's travel belongs to the shoulder; placed by its hand,
 * both segments are forced to swing together and the forearm flails.
 */
function sideArmAngles(forward: number): ArmAngles {
  const upper = armSwingAngle(forward);
  return { upper, fore: upper * FOREARM_FOLLOW + ELBOW_FLEX, foreScale: 1 };
}

/**
 * The pair of tilts that hold `FACING_ELBOW_FLEX` of bend while still landing
 * the wrist exactly where the idle's hand hangs. Two segments at two angles
 * have no tidy closed form for that, so it is solved by bisection at load.
 */
const TILT_SOLVE_STEPS = 40;

function solveForearmTilt(): number {
  const wristOffset = HAND_HANG_SPREAD - FACING_ARM_ROOT;
  const reach = (fore: number): number =>
    UPPER_ARM * Math.sin(fore + FACING_ELBOW_FLEX) + FOREARM * Math.sin(fore);
  let low = -Math.PI / 2;
  let high = Math.PI / 2;
  for (let i = 0; i < TILT_SOLVE_STEPS; i++) {
    const mid = (low + high) / 2;
    if (reach(mid) < wristOffset) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Re-exported proportions the tilt solver needs, named locally for brevity. */
const FACING_ARM_ROOT = 0.345;
const UPPER_ARM = 0.375;
const FOREARM = 0.325;

const FACING_FOREARM_TILT = solveForearmTilt();
const FACING_UPPER_TILT = FACING_FOREARM_TILT + FACING_ELBOW_FLEX;

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
 * The off arm of a head-on walk. The mace arm does not swing — it is holding
 * fifteen pounds of steel against the shoulder — so only this one does, which
 * is exactly what a shouldered-arms march looks like.
 */
function facingOffArmSwing(phase: number, away: boolean): { angles: ArmAngles; behind: boolean } {
  const own = Math.sin(phase * Math.PI * 2) * LEFT_ARM;
  const signedSwing = own >= 0 ? own : own * ARM_BACKSWING_SHARE;
  // Centred on the rest hang, so the average of the cycle is where the arm
  // stands. Uncentred, the whole swing sits inboard of the idle and he visibly
  // tucks his arm in the moment he starts walking.
  const swing = signedSwing - (1 - ARM_BACKSWING_SHARE) / 2;
  // 0 at the back of the swing, 1 at the front — one peak per stride. A
  // *rectified* swing would peak twice and read at double speed.
  const forward = (own + 1) / 2;
  return {
    angles: facingArmAngles(LEFT_ARM, swing, forward, WALK_ELBOW_FLEX),
    // Whole-row, not per-frame: an arm that changes sides partway through the
    // cycle pops at the shoulder.
    behind: away,
  };
}

function walkSide(phase: number): KnightPose {
  const pose = restingPose();
  const right = gaitFootSide(phase);
  const left = gaitFootSide(phase + 0.5);
  const bobPhase = Math.abs(Math.sin(phase * Math.PI * 2));

  // The pelvis *drops* at contact rather than rising at mid-stance, which is
  // what buys the stride and what a real pelvis does anyway.
  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.lean = WALK_LEAN;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.leftArmAngles = sideArmAngles(Math.sin(phase * Math.PI * 2));
  pose.elbowFlare = -0.5;
  pose.skirtFlare = WALK_SKIRT_FLARE;
  pose.cloakSway = -0.6;
  pose.headTurn = SIDE_HEAD_TURN;
  // Lagged a quarter cycle behind the torso, which is what gives a carried
  // weight its weight: the mace peaks after the shoulder that is carrying it.
  shoulderTheMace(pose, 'side', Math.cos(phase * Math.PI * 2));
  return pose;
}

function walkFacing(phase: number, away: boolean): KnightPose {
  const pose = restingPose();
  const right = gaitFootFacing(phase, 1);
  const left = gaitFootFacing(phase + 0.5, -1);
  const bobPhase = Math.abs(Math.sin(phase * Math.PI * 2));

  // Dropped at contact rather than raised at mid-stance, the same way the
  // profile walk does it. Raising the hip lengthens the span the leg has to
  // cover at exactly the moment a foot is planted, and there is no headroom for
  // that — the solver clamps and the sole lifts off the floor for a frame.
  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.sway = Math.sin(phase * Math.PI * 2) * WALK_SWAY;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.rightLegNearness = right.nearness;
  pose.leftLegNearness = left.nearness;
  // Both legs, not just the swinging one: a bow that shows on the planted leg
  // and vanishes on the swinging one flickers once per step and reads as a
  // wiggle. Head-on, every knee is a straight column.
  pose.rightForeshorten = 1;
  pose.leftForeshorten = 1;

  const offArm = facingOffArmSwing(phase, away);
  pose.leftArmAngles = offArm.angles;
  pose.leftArmBehind = offArm.behind;
  pose.rightArmBehind = away;
  pose.twist = Math.sin(phase * Math.PI * 2) * 0.1;
  pose.skirtFlare = WALK_SKIRT_FLARE;
  pose.cloakSway = Math.sin(phase * Math.PI * 2) * 0.4;
  pose.headTurn = away ? 0 : Math.sin(phase * Math.PI * 2) * 0.12;
  shoulderTheMace(pose, away ? 'back' : 'front', Math.cos(phase * Math.PI * 2));
  return pose;
}

// ── Slam ─────────────────────────────────────────────────────────────────────

/**
 * The overhead slam: both hands take the haft, it goes up behind the helm, and
 * the whole body drops onto it. The windup is long because the fight's warning
 * circle is on the ground for its whole length — the animation and the
 * telegraph have to agree about how much time the player is being given.
 */
const SLAM_RAISE_ANGLE = deg(-118);
const SLAM_BURIED_ANGLE = deg(58);
/**
 * A wide stance is a *low* stance, and here that is arithmetic rather than
 * taste: the knight's leg is within a few percent of his hip height, so every
 * bit of lateral foot spread has to be paid for by dropping the pelvis or the
 * solver clamps the leg straight and the sole lifts off the floor. Each attack
 * therefore plants itself with a baseline crouch sized to its own stance.
 */
const SLAM_PLANT_CROUCH = 0.16;
const SLAM_CROUCH = 0.48;
const SLAM_LEAN_BACK = deg(-13);
const SLAM_LEAN_INTO = deg(26);
const SLAM_STANCE_SPREAD = 0.235;
/** How far up the raised hands go, measured from the shoulder line. */
const SLAM_HAND_RISE = 0.42;
/** How far forward and down the buried hands end up. */
const SLAM_HAND_REACH = 0.34;
const SLAM_HAND_DROP = 0.5;
const SLAM_FACING_REACH_SHARE = 0.72;
/** The off hand grips the haft this far back from the mace hand. */
const OFF_GRIP_BEHIND = 0.15;

/**
 * The slam's four beats, in row progress. The mace is *buried* on the declared
 * impact frame rather than starting to fall there: a strike whose extreme lands
 * after its damage frame telegraphs the wrong moment, and the ground circle is
 * timed against this.
 */
const SLAM_RAISE_END = 0.34;
const SLAM_IMPACT_T = (SLAM_IMPACT_FRAME + 0.5) / SLAM_FRAMES;
/**
 * A frame of stillness at the bottom of the swing. Without it the mace is at
 * the shoulder one frame, at the ground the next and back up the frame after —
 * the contact is over before the eye finds it.
 */
const SLAM_CONTACT_HOLD = 1 / SLAM_FRAMES;
/**
 * The rebound starts on the frame of contact, not after a beat of stillness:
 * `settle` is eased out, so it moves fastest in the frames right after impact,
 * which is what a follow-through is.
 */
const SLAM_RECOVER_START = SLAM_IMPACT_T + SLAM_CONTACT_HOLD;

function slamPose(t: number, view: KnightView): KnightPose {
  const pose = restingPose();
  const raise = easeInOut(ramp(t, 0, SLAM_RAISE_END));
  // Eased *in*: the mace accelerates the whole way down, which is what gives a
  // heavy weapon its weight. Three frames of travel is the strike, and the
  // mace-arc gate is told to expect that spike rather than have it averaged out.
  const drop = easeIn(ramp(t, SLAM_RAISE_END, SLAM_IMPACT_T));
  // The rebound is the follow-through, not a fifth beat: eased out, so it moves
  // fastest in the frames right after contact.
  const settle = easeOut(ramp(t, SLAM_RECOVER_START, 1)) * SLAM_RECOVERY;

  // Head-on the slam still has to put the head somewhere the player reads as
  // "in front of his feet", so the facing views keep more of the profile's
  // forward reach than a straight foreshortening would give them.
  const lateral = view === 'side' ? 1 : SLAM_FACING_REACH_SHARE;
  const buried = drop;
  pose.crouch = SLAM_PLANT_CROUCH + SLAM_CROUCH * buried;
  pose.lean = lerp(SLAM_LEAN_BACK * raise, SLAM_LEAN_INTO, buried);
  pose.leftFoot = pt(-SLAM_STANCE_SPREAD, 0);
  pose.rightFoot = pt(SLAM_STANCE_SPREAD, 0);
  pose.leftForeshorten = view === 'side' ? 0 : 1;
  pose.rightForeshorten = view === 'side' ? 0 : 1;
  pose.skirtFlare = 0.3 + 0.7 * buried;
  pose.cloakSway = lerp(-0.8 * raise, 0.9, drop) * (1 - settle * 0.6);
  pose.visorGlow = 0.5 + 0.5 * Math.max(raise, drop);

  const handX = lerp(lerp(0.24, -0.1 * lateral, raise), SLAM_HAND_REACH * lateral, buried);
  const handY = SHOULDER_Y + lerp(lerp(0.5, -SLAM_HAND_RISE, raise), SLAM_HAND_DROP, buried);
  pose.rightHand = pt(handX, handY);
  // Both hands on the haft. The off fist has to stay within its own arm's
  // length of the grip or it paints in mid-air — identical on every frame and
  // therefore invisible to every ratio and continuity gate there is.
  pose.leftHand = pt(handX - OFF_GRIP_BEHIND * lateral, handY + OFF_GRIP_BEHIND * 0.35);
  pose.elbowFlare = -0.4;
  pose.maceAngle = lerp(
    lerp(STRAIGHT_UP - CARRY_MACE_TILT, SLAM_RAISE_ANGLE, raise),
    SLAM_BURIED_ANGLE,
    buried,
  );
  // Behind him only in the away view, where his own back is between them.
  // Head-on, hiding the mace for the three frames of the strike takes the
  // signature move off screen entirely — the blow simply never appears.
  pose.macePropBehind = view === 'back' && raise > 0.35 && drop < 0.25;
  pose.leftArmBehind = view === 'back';
  pose.rightArmBehind = view === 'back' && pose.macePropBehind;
  pose.headTurn = view === 'side' ? SIDE_HEAD_TURN : 0;
  pose.headTilt = deg(10) * buried - deg(6) * raise;
  settleTowardCarry(pose, view, settle);
  return pose;
}

/**
 * How far back toward the carry the rebound gets by the last frame. Short of 1
 * on purpose: the knight comes up into his guard, not to attention, and the
 * runtime blends the last few percent when the row hands back to the idle.
 */
const SLAM_RECOVERY = 0.95;

/**
 * True for the one step in a slam row that is *meant* to be a spike: the strike
 * itself. A gate that measured the strike against the row's own median would
 * either fail every honest slam or, loosened enough to pass, stop catching the
 * cornered swings it exists for.
 */
function isDeclaredTipSpike(rowName: string, fromFrame: number): boolean {
  if (!rowName.startsWith('slam')) return false;
  const from = shotProgress(fromFrame, SLAM_FRAMES);
  const to = shotProgress(fromFrame + 1, SLAM_FRAMES);
  return to > SLAM_RAISE_END && from < SLAM_IMPACT_T;
}

// ── Sweep ────────────────────────────────────────────────────────────────────

/**
 * The arc sweep: the mace is whirled twice round the helm to wind up, then
 * levelled and driven through a full turn at torso height. The whirl is what
 * the ground ring's fade is timed against — it has to be visibly a wind-up and
 * not just a fast swing.
 */
/**
 * One turn round the helm, not two. Two spun the head through ninety degrees
 * per frame, which at any playback rate is a strobe rather than a swing — the
 * eye cannot follow an arc that jumps more than about a sixth of a turn a frame.
 */
const SWEEP_WHIRL_TURNS = 1;
/**
 * How far from the body the *grip* orbits. The head then reaches a further
 * `MACE_REACH` beyond it, so the arc the player has to back out of is the sum
 * of the two. Held small enough that the arm never has to over-reach for it:
 * a clamped arm stops orbiting and the sweep stalls on one side.
 */
/** Where round the orbit the whirl begins, in turns. */
const WHIRL_START_TURN = 0.14;
const SWEEP_WHIRL_RADIUS = 0.2;
const SWEEP_LEVEL_RADIUS = 0.3;
const SWEEP_PLANT_CROUCH = 0.13;
const SWEEP_CROUCH = 0.22;
const SWEEP_STANCE_SPREAD = 0.215;
/** Where the whirl ends and the level sweep begins, in row progress. */
const SWEEP_LEVEL_AT = 0.44;
/**
 * How much the grip's orbit is flattened. Edge-on the swing is nearly in the
 * picture plane; head-on most of it runs toward and away from the camera, and a
 * circular orbit there reads as the knight lifting the mace over his own head
 * twice a turn.
 */
const SWEEP_SIDE_SQUASH = 0.32;
const SWEEP_FACING_SQUASH = 0.22;
/** First frame on which the mace has left the helm and is sweeping at torso height. */
const SWEEP_FIRST_LEVEL_FRAME = Math.ceil(SWEEP_LEVEL_AT * SWEEP_FRAMES - 0.5);

function sweepPose(t: number, view: KnightView): KnightPose {
  const pose = restingPose();
  const whirl = clamp01(t / SWEEP_LEVEL_AT);
  const level = clamp01((t - SWEEP_LEVEL_AT) / (1 - SWEEP_LEVEL_AT));
  const lateral = view === 'side' ? 1 : 0.55;

  // One continuous angle across both halves, so the haft never jumps: the whirl
  // spins it two turns above the helm and the sweep carries straight on into a
  // third at torso height.
  // Started off the vertical. Dead upright on frame 0 the shaft rises straight
  // out of the top of the helm with the gripping fist hidden behind the head,
  // and the mace reads as a pole growing out of him.
  const spin = WHIRL_START_TURN + easeIn(whirl) * SWEEP_WHIRL_TURNS + easeInOut(level);
  pose.maceAngle = STRAIGHT_UP + spin * Math.PI * 2;

  // The grip leads the head rather than trailing it: put the hand on the far
  // side of the orbit and the mace points back at the knight, so the head only
  // ever reaches `MACE_REACH − radius` from him and the sweep has no reach at
  // all. Hand and head travel the same direction, and their radii add.
  const radius = lerp(SWEEP_WHIRL_RADIUS, SWEEP_LEVEL_RADIUS, level);
  const centreY = SHOULDER_Y + lerp(-0.02, 0.3, level);
  // The whirl orbits nearly round above the helm; the sweep itself runs flat.
  // A circular orbit in the second half carries the head up over his own head
  // twice a turn, which reads as a windmill rather than as a level sweep.
  const flat = view === 'side' ? SWEEP_SIDE_SQUASH : SWEEP_FACING_SQUASH;
  const orbitSquash = lerp(WHIRL_ORBIT_SQUASH, flat, level);
  pose.rightHand = pt(
    Math.cos(pose.maceAngle) * radius * lateral,
    centreY + Math.sin(pose.maceAngle) * radius * orbitSquash,
  );
  pose.leftHand = pt(pose.rightHand.x * 0.3 - 0.2 * lateral, centreY + 0.16);
  pose.elbowFlare = 0.5;

  pose.crouch = SWEEP_PLANT_CROUCH + SWEEP_CROUCH * easeInOut(level);
  pose.lean = deg(7) * level;
  pose.twist = Math.sin(spin * Math.PI * 2) * 0.35;
  pose.leftFoot = pt(-SWEEP_STANCE_SPREAD, 0);
  pose.rightFoot = pt(SWEEP_STANCE_SPREAD, 0);
  pose.leftForeshorten = view === 'side' ? 0 : 1;
  pose.rightForeshorten = view === 'side' ? 0 : 1;
  pose.skirtFlare = 0.35 + 0.65 * level;
  pose.cloakSway = Math.sin(spin * Math.PI * 2) * 0.9;
  pose.visorGlow = 0.6 + 0.4 * level;
  // Never hidden behind the body. Occluded for the far half of each turn the
  // whirl reads as the mace teleporting from one side of him to the other,
  // because three consecutive frames have no weapon in them at all.
  pose.macePropBehind = false;
  pose.leftArmBehind = view === 'back';
  pose.rightArmBehind = view === 'back' && pose.macePropBehind;
  pose.headTurn = view === 'side' ? SIDE_HEAD_TURN : 0;
  settleTowardCarry(pose, view, easeInOut(ramp(t, SWEEP_RECOVER_START, 1)) * SWEEP_RECOVERY);
  return pose;
}

/** The whirl's own orbit, near enough round to read as going over the helm. */
const WHIRL_ORBIT_SQUASH = 0.85;

/** Where the sweep stops spinning and comes back to the guard, in row progress. */
const SWEEP_RECOVER_START = 0.8;
const SWEEP_RECOVERY = 0.95;

// ── Punch ────────────────────────────────────────────────────────────────────

/**
 * The off-hand jab. Short by design: it is mechanically undodgeable, so the
 * only honest thing the animation can do is not pretend otherwise — no windup
 * worth reading, straight out and straight back.
 */
const PUNCH_REACH = 0.66;
/** How far behind the hip the fist is drawn back before the jab. */
const PUNCH_CHAMBER = 0.22;
/**
 * Shoulder rotation through the jab. Small: the twist shifts the pauldrons, and
 * a large one slides a plate sideways with nothing under it driving it.
 */
const PUNCH_TWIST = 0.45;
const PUNCH_PLANT_CROUCH = 0.1;
/** The jab's three beats, in row progress: chamber, extend, retract. */
const PUNCH_CHAMBER_END = 0.3;
const PUNCH_IMPACT_T = (PUNCH_IMPACT_FRAME + 0.5) / PUNCH_FRAMES;

function punchPose(t: number, view: KnightView): KnightPose {
  const pose = restingPose();
  const chamber = easeInOut(ramp(t, 0, PUNCH_CHAMBER_END));
  // Full extension lands *on* the impact frame and comes straight back off it.
  // Reaching furthest at the end of the row instead would put the blow three
  // frames after the damage.
  const extend = easeOut(ramp(t, PUNCH_CHAMBER_END, PUNCH_IMPACT_T));
  const retract = easeInOut(ramp(t, PUNCH_IMPACT_T, 1));
  const thrust = extend * (1 - retract);

  if (view === 'side') {
    // Edge-on the jab is a straight line across the picture, so a hand target
    // says everything.
    const punchOut = chamber * (1 - extend) * -PUNCH_CHAMBER + thrust * PUNCH_REACH;
    pose.leftHand = pt(
      punchOut - (1 - Math.max(chamber, thrust)) * HAND_HANG_SPREAD,
      SHOULDER_Y + lerp(HAND_HANG_DROP, PUNCH_HAND_HEIGHT, Math.max(chamber * 0.7, thrust)),
    );
    pose.elbowFlare = -0.3;
  } else {
    // Head-on a jab travels almost entirely *at the camera*, and a 2D arm has
    // no way to show that except to be drawn shorter. Moving the hand sideways
    // instead — the first attempt — produced an arm raised out to the side and
    // held there, which a reviewer read as no punch at all. So the arm is driven
    // from its joints, swung inboard across the chest, and its forearm
    // foreshortened until the fist sits over the sternum.
    pose.leftArmAngles = {
      upper: LEFT_ARM * (FACING_UPPER_TILT - PUNCH_FACING_UPPER_SWING * thrust),
      fore: LEFT_ARM * (FACING_FOREARM_TILT - PUNCH_FACING_FOREARM_SWING * thrust),
      foreScale: 1 - PUNCH_FACING_FORESHORTEN * thrust,
    };
    pose.offFistScale = 1 + PUNCH_FIST_GROWTH * thrust;
  }

  pose.twist = -PUNCH_TWIST * chamber + PUNCH_TWIST * thrust;
  pose.lean = deg(6) * thrust - deg(3) * chamber;
  pose.leftFoot = pt(-IDLE_FOOT_SPREAD * 1.15, 0);
  pose.rightFoot = pt(IDLE_FOOT_SPREAD * 1.15, 0);
  pose.leftForeshorten = view === 'side' ? 0 : 1;
  pose.rightForeshorten = view === 'side' ? 0 : 1;
  pose.crouch = PUNCH_PLANT_CROUCH + 0.08 * thrust;
  pose.skirtFlare = 0.2 + 0.3 * thrust;
  pose.visorGlow = 0.6 + 0.4 * thrust;
  pose.headTurn = view === 'side' ? SIDE_HEAD_TURN : 0;
  // Never behind the body, in any view. Away-facing it was drawn behind his own
  // back and the row became indistinguishable from the idle.
  pose.leftArmBehind = false;
  pose.rightArmBehind = view === 'back';
  // Edge-on the off arm is the far one and would be painted behind the torso,
  // which hides the entire jab: the silhouette then does not move by a pixel
  // across the row. The one pose that has to override that rule does.
  pose.leftArmInFront = view === 'side';
  // Hauled back and down out of the jab's lane. Left on the shoulder the mace
  // hand sits at 0.33 forward with the shaft rising past it, and the punching
  // fist arrives into that cluster — three review rounds read the result as a
  // guard rather than a strike, because there was no clean space for the fist
  // to be seen arriving in.
  // Driven by the chamber rather than the thrust: the chamber is eased at both
  // ends, so the mace drifts back and returns smoothly. Tied to the thrust it
  // snapped, and the mace-arc gate rightly called that a cornered swing.
  shoulderTheMace(pose, view, -chamber * (1 - retract) * PUNCH_MACE_CLEARANCE);
  settleTowardCarry(pose, view, retract * PUNCH_RECOVERY);
  return pose;
}

/** How far the shouldered mace rocks back to clear the jab, in `rock` units. */
const PUNCH_MACE_CLEARANCE = 2.2;

/** How high the jabbing fist rides, measured from the shoulder line. */
/**
 * How far below the shoulder line the jabbing fist lands. Chest height, not
 * shoulder height: level with the shoulder it arrives on top of the mace hand
 * and the shaft rising past it, and the whole jab disappears into that clutter.
 */
const PUNCH_HAND_HEIGHT = 0.34;
/** Head-on, how far the jab swings the arm inboard across the chest. */
const PUNCH_FACING_UPPER_SWING = deg(52);
const PUNCH_FACING_FOREARM_SWING = deg(96);
/** How much of its length the forearm loses pointing at the camera. */
const PUNCH_FACING_FORESHORTEN = 0.55;
/** How much the fist grows at full extension, coming at the camera. */
const PUNCH_FIST_GROWTH = 0.7;

const PUNCH_RECOVERY = 0.95;

// ── Row table ────────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: KnightView;
  /** The frame a one-shot lands on, or null for a loop. */
  readonly impactFrame: number | null;
  /** Null on the gore row, whose cells are pieces rather than poses. */
  readonly pose: ((frame: number) => KnightPose) | null;
}

function attackRows(
  base: string,
  frames: number,
  impactFrame: number,
  pose: (t: number, view: KnightView) => KnightPose,
): RowSpec[] {
  const views: ReadonlyArray<readonly [string, KnightView]> = [
    [base, 'front'],
    [`${base}_side`, 'side'],
    [`${base}_away`, 'back'],
  ];
  return views.map(([name, view]) => ({
    name,
    frameCount: frames,
    kind: 'oneShot' as const,
    view,
    impactFrame,
    pose: (frame: number) => pose(shotProgress(frame, frames), view),
  }));
}

const GORE_PIECES = darkKnightGorePieces();

/**
 * Extra scale applied to the gore pieces on top of `KNIGHT_SCALE`.
 *
 * The pieces are drawn at their own tile-unit sizes rather than sliced off the
 * figure, so they do not inherit his scale — but they do have to survive the
 * runtime's own 0.5×. Held at 1 they come out around eight screen pixels
 * across, below the size at which one shape can be told from another.
 */
const GORE_PIECE_SCALE = 1.9;
/** Pixels per tile unit a gore piece is painted at. */
const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;
/**
 * How much bigger than the animation rows need the gore may make every cell.
 * Rotation safety is free — `geometryFor` guarantees it — so this bounds cost,
 * not correctness.
 */
const GORE_AREA_INFLATION_LIMIT = 1.5;

export const ROWS: readonly RowSpec[] = [
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrame: null,
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), false),
  },
  {
    name: 'walk_side',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrame: null,
    pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrame: null,
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), true),
  },
  {
    name: 'idle',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrame: null,
    pose: (f) => idleFront(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_side',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrame: null,
    pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_away',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrame: null,
    pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES)),
  },
  ...attackRows('slam', SLAM_FRAMES, SLAM_IMPACT_FRAME, slamPose),
  ...attackRows('sweep', SWEEP_FRAMES, SWEEP_IMPACT_FRAME, sweepPose),
  ...attackRows('punch', PUNCH_FRAMES, PUNCH_IMPACT_FRAME, punchPose),
  {
    name: 'gore',
    frameCount: GORE_PIECES.length,
    kind: 'gore',
    view: 'side',
    impactFrame: null,
    pose: null,
  },
];

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

// ── Bake ─────────────────────────────────────────────────────────────────────

const MACE = makeMacePainter();

function drawView(ctx: Ctx, view: KnightView, pose: KnightPose): void {
  if (view === 'front') drawKnightFront(ctx, pose, MACE);
  else if (view === 'back') drawKnightBack(ctx, pose, MACE);
  else drawKnightSide(ctx, pose, MACE);
}

interface FrameJob {
  readonly row: RowSpec;
  readonly frame: number;
  /**
   * Animation cells anchor on the painter's own origin; gore cells anchor on
   * the centre of the cell, so every piece is measured and laid out about the
   * same point.
   */
  readonly anchor: 'origin' | 'cellCentre';
  /** Shift applied to a gore piece so its painted ink lands on the cell centre. */
  readonly recentre: Pt;
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
          recentre,
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
      const { pose } = row;
      if (pose === null) throw new Error(`row "${row.name}" is not gore but has no pose function`);
      jobs.push({
        row,
        frame,
        anchor: 'origin',
        recentre: { x: 0, y: 0 },
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          ctx.scale(KNIGHT_SCALE, KNIGHT_SCALE);
          drawView(ctx, row.view, pose(frame));
          ctx.restore();
        },
      });
    }
  }
  return jobs;
}

/** Alpha above which a pixel counts as painted, when measuring ink extents. */
const INK_ALPHA_THRESHOLD = 24;
/** Scratch canvas for measurement; comfortably larger than any cell can be. */
const MEASURE_SIZE = 512;
const ALPHA_OFFSET = 3;
const CHANNELS = 4;

interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBoxOf(ctx: Ctx, width: number, height: number): InkBox | null {
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

interface Extents {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  /** Furthest any gore piece reaches from its own ink centre, in pixels. */
  readonly goreRadius: number;
  /** Shift, in tile units, that puts each gore piece's ink on the cell centre. */
  readonly goreOffsets: ReadonlyMap<number, Pt>;
  /** Frames that painted nothing — the signature of a NaN in a pose. */
  readonly blankFrames: readonly string[];
}

function measure(jobs: readonly FrameJob[]): Extents {
  const canvas = createCanvas(MEASURE_SIZE, MEASURE_SIZE);
  const ctx = canvas.getContext('2d');
  const originX = MEASURE_SIZE / 2;
  const originY = MEASURE_SIZE / 2;

  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  let goreRadius = 0;
  const goreOffsets = new Map<number, Pt>();
  const blankFrames: string[] = [];

  for (const job of jobs) {
    ctx.clearRect(0, 0, MEASURE_SIZE, MEASURE_SIZE);
    job.paint(ctx, originX, originY);
    const box = inkBoxOf(ctx, MEASURE_SIZE, MEASURE_SIZE);
    if (box === null) {
      blankFrames.push(`${job.row.name}[${job.frame}]`);
      continue;
    }
    if (job.anchor === 'cellCentre') {
      // A severed piece has its mass well off its construction origin, which
      // would leave it drawn to one side of a cell sized for it. This offset
      // pulls the ink back to the middle, which is what makes `goreRadius` a
      // meaningful measure of how big the pieces actually are.
      const inkCentreX = (box.minX + box.maxX) / 2;
      const inkCentreY = (box.minY + box.maxY) / 2;
      goreOffsets.set(job.frame, {
        x: job.recentre.x + (originX - inkCentreX) / GORE_UNIT,
        y: job.recentre.y + (originY - inkCentreY) / GORE_UNIT,
      });
      goreRadius = Math.max(
        goreRadius,
        Math.hypot((box.maxX - box.minX) / 2, (box.maxY - box.minY) / 2),
      );
      continue;
    }
    left = Math.max(left, originX - box.minX);
    right = Math.max(right, box.maxX - originX);
    up = Math.max(up, originY - box.minY);
    down = Math.max(down, box.maxY - originY);
  }

  return { left, right, up, down, goreRadius, goreOffsets, blankFrames };
}

export interface SheetGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

function roundUpTo(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

function geometryFor(extents: Extents): SheetGeometry {
  // Both axes have to clear the gore radius: a spinning piece sweeps the cell's
  // *inscribed* circle, so a cell wide enough but not tall enough still clips.
  const goreSpan = (extents.goreRadius + FRAME_PADDING) * 2;
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const frameWidth = roundUpTo(Math.max(halfWidth * 2, goreSpan), FRAME_SIZE_QUANTUM);
  // Whole pixels, because the manifest carries these and a fractional anchor
  // makes every blit land on a half pixel.
  const tileY = Math.round(extents.up + FRAME_PADDING - TILE_SCALE * GROUND_OFFSET_IN_TILE);
  const originY = tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE;
  const frameHeight = roundUpTo(
    Math.max(originY + extents.down + FRAME_PADDING, goreSpan),
    FRAME_SIZE_QUANTUM,
  );
  return {
    frameWidth,
    frameHeight,
    // The origin is the knight's ground line, which sits GROUND_OFFSET_IN_TILE
    // of the way down his tile.
    tileX: frameWidth / 2 - TILE_SCALE / 2,
    tileY,
  };
}

export interface BakedSheet {
  readonly buffer: Buffer;
  readonly geometry: SheetGeometry;
  readonly columns: number;
}

// ── Gates ────────────────────────────────────────────────────────────────────

/**
 * Every gate throws before anything is written. A sheet that fails one must
 * never reach disk: the defects these catch are invisible to typecheck, to lint
 * and to a code read, and several of them are invisible in a still as well.
 */

/** Alpha above which a border pixel counts as an overrun. */
const BORDER_ALPHA_LIMIT = 8;

function findBorderInk(ctx: Ctx, width: number, height: number): string | null {
  const { data } = ctx.getImageData(0, 0, width, height);
  const alphaAt = (x: number, y: number): number => data[(y * width + x) * CHANNELS + ALPHA_OFFSET];
  for (let x = 0; x < width; x++) {
    if (alphaAt(x, 0) > BORDER_ALPHA_LIMIT) return `top edge at x=${x}`;
    if (alphaAt(x, height - 1) > BORDER_ALPHA_LIMIT) return `bottom edge at x=${x}`;
  }
  for (let y = 0; y < height; y++) {
    if (alphaAt(0, y) > BORDER_ALPHA_LIMIT) return `left edge at y=${y}`;
    if (alphaAt(width - 1, y) > BORDER_ALPHA_LIMIT) return `right edge at y=${y}`;
  }
  return null;
}

/**
 * G1 — reach headroom. Hip→ankle must stay inside the leg's own span on every
 * frame of every row. One clamped frame locks the leg straight and the next
 * tuck snaps it back: the hitch that reads as a hop, and the single defect a
 * contact sheet is worst at showing.
 */
function gateLegReach(): void {
  let worst = 0;
  let worstAt = '';
  for (const row of ROWS) {
    const { pose } = row;
    if (pose === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const { left, right } = legReach(pose(frame), row.view);
      for (const [side, span] of [
        ['left', left],
        ['right', right],
      ] as const) {
        if (span > worst) {
          worst = span;
          worstAt = `${row.name}[${frame}] ${side}`;
        }
      }
    }
  }
  if (worst >= LEG_REACH_LIMIT) {
    throw new Error(
      `G1 leg reach: ${worstAt} spans ${worst.toFixed(4)} against a limit of ` +
        `${LEG_REACH_LIMIT.toFixed(4)} — the solver clamps and the walk hops`,
    );
  }
  console.log(
    `  G1 leg reach: worst ${worst.toFixed(4)} of ${LEG_REACH_LIMIT.toFixed(4)} (${worstAt})`,
  );
}

/**
 * G2 — foot slide. The profile walk's planted foot must travel backward at a
 * steady rate through stance; a foot that stalls or reverses is a moonwalk.
 */
function gateFootSlide(): void {
  const steps: number[] = [];
  for (let frame = 0; frame < WALK_FRAMES; frame++) {
    const phase = cyclePhase(frame, WALK_FRAMES);
    if (phase >= STANCE_SHARE) break;
    steps.push(gaitFootSide(phase).foot.x);
  }
  for (let i = 1; i < steps.length; i++) {
    if (steps[i] >= steps[i - 1]) {
      throw new Error(
        `G2 foot slide: the stance foot moves from ${steps[i - 1].toFixed(4)} to ` +
          `${steps[i].toFixed(4)} between frames ${i - 1} and ${i} — it must slide backward`,
      );
    }
  }
  console.log(`  G2 foot slide: ${steps.length} stance frames, all monotonic`);
}

/**
 * G3 — off-hand grip. On the slam both fists are on the haft, so the off fist
 * must stay within its own arm's reach of the mace hand. A two-handed off hand
 * painting in mid-air is identical on every frame, and therefore invisible to
 * every ratio and continuity gate there is.
 */
function gateOffHandGrip(): void {
  let worst = 0;
  let worstAt = '';
  for (const row of ROWS) {
    const { pose } = row;
    if (pose === null || !row.name.startsWith('slam')) continue;
    // Only up to the blow. Past it the knight is recovering into his one-handed
    // guard, and the off hand is *supposed* to leave the haft.
    for (let frame = 0; frame <= SLAM_IMPACT_FRAME; frame++) {
      const framePose = pose(frame);
      const gap = Math.hypot(
        framePose.leftHand.x - framePose.rightHand.x,
        framePose.leftHand.y - framePose.rightHand.y,
      );
      if (gap > worst) {
        worst = gap;
        worstAt = `${row.name}[${frame}]`;
      }
    }
  }
  const limit = ARM_LENGTH * 0.9;
  if (worst > limit) {
    throw new Error(
      `G3 off-hand grip: ${worstAt} puts the off fist ${worst.toFixed(4)} from the haft ` +
        `against a reach of ${limit.toFixed(4)} — it is painting in mid-air`,
    );
  }
  console.log(`  G3 off-hand grip: worst gap ${worst.toFixed(4)} of ${limit.toFixed(4)}`);
}

/**
 * G4 — mace-tip continuity. The head must trace a smooth arc: a step far above
 * the row's own median is a cornered swing or a draw-order flip, both of which
 * a still frame hides completely.
 */
const TIP_STEP_SPIKE_LIMIT = 2.6;
/**
 * Below this the "spike" is smaller than a pixel on the baked sheet. Without an
 * absolute floor a row where the mace is essentially still — the punch, which
 * only carries it — fails on a tenth-of-a-pixel step being eight times a
 * hundredth-of-a-pixel median.
 */
const MIN_MEANINGFUL_TIP_STEP = 0.05;

function gateMaceArc(): void {
  for (const row of ROWS) {
    const { pose } = row;
    if (pose === null) continue;
    const tips: Pt[] = [];
    for (let frame = 0; frame < row.frameCount; frame++) {
      tips.push(macePosition(pose(frame), row.view));
    }
    const steps: number[] = [];
    for (let i = 1; i < tips.length; i++) {
      steps.push(Math.hypot(tips[i].x - tips[i - 1].x, tips[i].y - tips[i - 1].y));
    }
    if (steps.length === 0) continue;
    const sorted = [...steps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median === 0) continue;
    let worst = 0;
    let at = 0;
    steps.forEach((step, index) => {
      if (isDeclaredTipSpike(row.name, index)) return;
      if (step > worst) {
        worst = step;
        at = index;
      }
    });
    if (worst > MIN_MEANINGFUL_TIP_STEP && worst > median * TIP_STEP_SPIKE_LIMIT) {
      throw new Error(
        `G4 mace arc: ${row.name} steps ${worst.toFixed(4)} between frames ${at} and ${at + 1} ` +
          `against a median of ${median.toFixed(4)} — the swing corners`,
      );
    }
  }
  console.log(
    `  G4 mace arc: every row's worst tip step is within ${TIP_STEP_SPIKE_LIMIT}× its median`,
  );
}

/**
 * G5 — mace floor clearance. The head may only be at or below the ground line
 * on the slam, where burying it is the point. Anywhere else it is a swing that
 * has gone through the floor.
 */
const MACE_FLOOR_TOLERANCE = 0.04;

function gateMaceFloor(): void {
  for (const row of ROWS) {
    const { pose } = row;
    if (pose === null || row.name.startsWith('slam')) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const tip = macePosition(pose(frame), row.view);
      if (tip.y > MACE_FLOOR_TOLERANCE) {
        throw new Error(
          `G5 mace floor: ${row.name}[${frame}] puts the head ${tip.y.toFixed(4)} below the ` +
            `ground line — only the slam may bury it`,
        );
      }
    }
  }
  console.log('  G5 mace floor: no non-slam frame drives the head into the ground');
}

/**
 * G6 — impact is the peak. The declared impact frame must be the extreme of its
 * own motion, or the timing table has drifted from the choreography and the
 * damage lands on a frame where nothing is happening.
 */
interface ImpactCheck {
  readonly rowName: string;
  readonly impactFrame: number;
  /** What the row's motion is measured by; the impact frame must maximise it. */
  readonly metric: (pose: KnightPose) => number;
  /**
   * First frame the metric is meaningful on. The sweep spends its first half
   * whirling the mace above the helm, where "how far out is the head" answers a
   * question about the wind-up rather than about the blow.
   */
  readonly fromFrame: number;
}

const IMPACT_CHECKS: readonly ImpactCheck[] = [
  {
    rowName: 'slam_side',
    impactFrame: SLAM_IMPACT_FRAME,
    metric: (pose) => macePosition(pose, 'side').y,
    fromFrame: 0,
  },
  {
    rowName: 'sweep_side',
    impactFrame: SWEEP_IMPACT_FRAME,
    metric: (pose) => Math.abs(macePosition(pose, 'side').x),
    fromFrame: SWEEP_FIRST_LEVEL_FRAME,
  },
  {
    rowName: 'punch_side',
    impactFrame: PUNCH_IMPACT_FRAME,
    metric: (pose) => pose.leftHand.x,
    fromFrame: 0,
  },
];

/**
 * How far short of its row's extreme a declared impact frame may sit. Not zero:
 * a one-shot samples the *middle* of each frame, so the true extreme falls
 * between two of them and no frame lands exactly on it.
 */
const IMPACT_PEAK_TOLERANCE = 0.08;

function gateImpactIsPeak(): void {
  for (const check of IMPACT_CHECKS) {
    const row = ROWS.find((candidate) => candidate.name === check.rowName);
    if (row === undefined || row.pose === null) {
      throw new Error(`G6 impact: no posed row named "${check.rowName}"`);
    }
    const { pose } = row;
    if (check.impactFrame < check.fromFrame) {
      throw new Error(
        `G6 impact: ${check.rowName} declares impact on frame ${check.impactFrame}, before its ` +
          `measurable window opens at ${check.fromFrame}`,
      );
    }
    const values: number[] = [];
    for (let frame = check.fromFrame; frame < row.frameCount; frame++) {
      values.push(check.metric(pose(frame)));
    }
    const peak = Math.max(...values);
    const span = peak - Math.min(...values);
    const shortfall = span === 0 ? 0 : (peak - values[check.impactFrame - check.fromFrame]) / span;
    if (shortfall > IMPACT_PEAK_TOLERANCE) {
      throw new Error(
        `G6 impact: ${check.rowName} frame ${check.impactFrame} sits ` +
          `${(shortfall * 100).toFixed(0)}% short of the row's own extreme — the timing table ` +
          `and the choreography disagree`,
      );
    }
  }
  console.log('  G6 impact: every declared impact frame is at the extreme of its own motion');
}

/**
 * G7 — loop closure. A cycle's last→first delta must sit inside the spread of
 * its ordinary frame-to-frame deltas, or it pops once per lap.
 */
/**
 * How much larger than the *largest ordinary step* in its own row a loop's seam
 * may be. Measured against the largest rather than the median because a cycle
 * driven by a sine samples unevenly — its own steps already vary two-fold — and
 * a median-based limit fails an honest loop while a limit loose enough to pass
 * it stops catching pops.
 */
const LOOP_SEAM_LIMIT = 1.25;

function gateLoopClosure(sheet: BakedSheet, pixels: ReadonlyMap<string, Uint8ClampedArray>): void {
  for (const row of ROWS) {
    if (row.kind !== 'loop') continue;
    const deltas: number[] = [];
    for (let frame = 0; frame < row.frameCount; frame++) {
      const a = pixels.get(`${row.name}[${frame}]`);
      const b = pixels.get(`${row.name}[${(frame + 1) % row.frameCount}]`);
      if (a === undefined || b === undefined) throw new Error(`G7 loop: missing ${row.name}`);
      deltas.push(alphaDelta(a, b));
    }
    const seam = deltas[deltas.length - 1];
    const largestOrdinary = Math.max(...deltas.slice(0, -1));
    if (largestOrdinary > 0 && seam > largestOrdinary * LOOP_SEAM_LIMIT) {
      throw new Error(
        `G7 loop closure: ${row.name}'s seam moves ${seam} pixels against a largest ordinary ` +
          `step of ${largestOrdinary} — the cycle pops once per lap`,
      );
    }
  }
  void sheet;
  console.log(
    `  G7 loop closure: every looping row seams within ${LOOP_SEAM_LIMIT}× its own largest step`,
  );
}

/** Count of pixels whose coverage differs between two frames. */
function alphaDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  const COVERAGE_STEP = 32;
  for (let i = ALPHA_OFFSET; i < a.length; i += CHANNELS) {
    if (Math.abs(a[i] - b[i]) > COVERAGE_STEP) differing++;
  }
  return differing;
}

/**
 * G8 — anchor. The knight's feet must land on the tile's ground line and his
 * height must be what the proportions claim. A redraw silently moves the anchor,
 * and every health bar and status marker keys off it.
 */
const ANCHOR_TOLERANCE_PX = 3;

function gateAnchor(geometry: SheetGeometry): void {
  const canvas = createCanvas(geometry.frameWidth, geometry.frameHeight);
  const ctx = canvas.getContext('2d');
  const idle = ROWS.find((row) => row.name === 'idle');
  if (idle === undefined || idle.pose === null) throw new Error('G8 anchor: no idle row');
  const idlePose = idle.pose;
  const originY = geometry.tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE;
  ctx.save();
  ctx.translate(geometry.frameWidth / 2, originY);
  ctx.scale(TILE_SCALE * KNIGHT_SCALE, TILE_SCALE * KNIGHT_SCALE);
  drawView(ctx, 'front', idlePose(0));
  ctx.restore();

  const box = inkBoxOf(ctx, geometry.frameWidth, geometry.frameHeight);
  if (box === null) throw new Error('G8 anchor: the idle frame painted nothing');
  // The contact shadow is the one thing painted below the ground line, so the
  // lowest ink is the shadow's rim rather than a sole.
  const shadowDrop = SHADOW_RY * TILE_SCALE * KNIGHT_SCALE;
  const soleDrop = box.maxY - originY - shadowDrop;
  if (Math.abs(soleDrop) > ANCHOR_TOLERANCE_PX) {
    throw new Error(
      `G8 anchor: the lowest ink sits ${soleDrop.toFixed(1)}px off where the ground line plus ` +
        `the contact shadow puts it, past a ${ANCHOR_TOLERANCE_PX}px tolerance`,
    );
  }
  const heightTiles = (box.maxY - box.minY) / TILE_SCALE;
  const expected = (FIGURE_HEIGHT + SHADOW_RY) * KNIGHT_SCALE;
  const HEIGHT_TOLERANCE_TILES = 0.14;
  if (Math.abs(heightTiles - expected) > HEIGHT_TOLERANCE_TILES) {
    throw new Error(
      `G8 anchor: he stands ${heightTiles.toFixed(2)} tiles against an expected ` +
        `${expected.toFixed(2)} — the proportions and the bake disagree`,
    );
  }
  console.log(
    `  G8 anchor: soles ${soleDrop.toFixed(1)}px off the line, standing ${heightTiles.toFixed(2)} tiles`,
  );
}

/**
 * G9 — gore distinctness. Every pair of pieces is compared as a small binary
 * mask; too much overlap means two cells tumbling past at 16 px read as the
 * same object.
 *
 * Scale is normalised away but **aspect is not**: stretching each piece to fill
 * its own bounding box maps every convex blob onto a filled square, which
 * scores a severed helm against a leg at 70% — i.e. it measures the
 * normalisation rather than the art.
 */
const DISTINCTNESS_GRID = 16;
const DISTINCTNESS_LIMIT = 0.62;

function goreMask(pixels: Uint8ClampedArray, width: number, height: number): boolean[] {
  const box = { minX: width, minY: height, maxX: -1, maxY: -1 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) continue;
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  const centreX = (box.minX + box.maxX) / 2;
  const centreY = (box.minY + box.maxY) / 2;
  const mask: boolean[] = [];
  for (let gy = 0; gy < DISTINCTNESS_GRID; gy++) {
    for (let gx = 0; gx < DISTINCTNESS_GRID; gx++) {
      const sx = Math.round(centreX + ((gx + 0.5) / DISTINCTNESS_GRID - 0.5) * span);
      const sy = Math.round(centreY + ((gy + 0.5) / DISTINCTNESS_GRID - 0.5) * span);
      const inside = sx >= 0 && sy >= 0 && sx < width && sy < height;
      mask.push(
        inside && pixels[(sy * width + sx) * CHANNELS + ALPHA_OFFSET] >= INK_ALPHA_THRESHOLD,
      );
    }
  }
  return mask;
}

function gateGoreDistinctness(
  pixels: ReadonlyMap<string, Uint8ClampedArray>,
  geometry: SheetGeometry,
): void {
  const masks = GORE_STATES.map((state, index) => {
    const data = pixels.get(`gore[${index}]`);
    if (data === undefined) throw new Error(`G9 distinctness: gore[${index}] was never baked`);
    return { state, mask: goreMask(data, geometry.frameWidth, geometry.frameHeight) };
  });
  let worst = 0;
  let worstPair = '';
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      let union = 0;
      let intersection = 0;
      for (let i = 0; i < masks[a].mask.length; i++) {
        const inA = masks[a].mask[i];
        const inB = masks[b].mask[i];
        if (inA || inB) union++;
        if (inA && inB) intersection++;
      }
      const iou = union === 0 ? 0 : intersection / union;
      if (iou > worst) {
        worst = iou;
        worstPair = `${masks[a].state} vs ${masks[b].state}`;
      }
    }
  }
  if (worst > DISTINCTNESS_LIMIT) {
    throw new Error(
      `G9 distinctness: ${worstPair} overlap ${(worst * 100).toFixed(0)}% against a ` +
        `${(DISTINCTNESS_LIMIT * 100).toFixed(0)}% limit — they read as the same piece`,
    );
  }
  console.log(
    `  G9 distinctness: worst pair ${worstPair} at ${(worst * 100).toFixed(0)}% of ` +
      `${(DISTINCTNESS_LIMIT * 100).toFixed(0)}%`,
  );
}

function bake(): BakedSheet {
  // Two passes: the first measures where each gore piece's ink actually lands,
  // the second repaints it centred on that measurement.
  const measured = measure(buildJobs());
  const jobs = buildJobs(measured.goreOffsets);
  const extents = measure(jobs);
  if (extents.blankFrames.length > 0) {
    throw new Error(
      `these frames painted nothing, which almost always means a NaN in the pose: ` +
        extents.blankFrames.join(', '),
    );
  }

  const geometry = geometryFor(extents);
  // Every cell is at least as wide and as tall as the longest piece's sweep, so
  // rotation safety holds by construction. What is worth policing is the cost:
  // one over-large piece can quietly inflate all sixteen rows to suit itself.
  const animationOnly = geometryFor({ ...extents, goreRadius: 0 });
  const inflation =
    (geometry.frameWidth * geometry.frameHeight) /
    (animationOnly.frameWidth * animationOnly.frameHeight);
  if (inflation > GORE_AREA_INFLATION_LIMIT) {
    throw new Error(
      `G10 gore inflation: the pieces widen every cell to ${inflation.toFixed(2)}x the area the ` +
        `animation rows need — shrink the longest piece rather than paying for it on all ` +
        `${ROWS.length} rows`,
    );
  }
  console.log(
    `  G10 gore inflation: cells are ${inflation.toFixed(2)}x the animation rows' own size`,
  );
  const columns = Math.max(...ROWS.map((row) => row.frameCount));
  const sheet = createCanvas(columns * geometry.frameWidth, ROWS.length * geometry.frameHeight);
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');
  const flat = createCanvas(geometry.frameWidth, geometry.frameHeight);
  const flatCtx = flat.getContext('2d');
  const pixels = new Map<string, Uint8ClampedArray>();

  const rowIndexOf = new Map(ROWS.map((row, index) => [row.name, index]));
  const originY = geometry.tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE;

  for (const job of jobs) {
    const rowIndex = rowIndexOf.get(job.row.name);
    if (rowIndex === undefined) throw new Error(`row "${job.row.name}" is not in ROWS`);

    cellCtx.clearRect(0, 0, cell.width, cell.height);
    cellCtx.save();
    cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    job.paint(
      cellCtx,
      geometry.frameWidth / 2,
      job.anchor === 'cellCentre' ? geometry.frameHeight / 2 : originY,
    );
    cellCtx.restore();

    flatCtx.clearRect(0, 0, flat.width, flat.height);
    flatCtx.drawImage(cell, 0, 0, cell.width, cell.height, 0, 0, flat.width, flat.height);
    const overrun = findBorderInk(flatCtx, flat.width, flat.height);
    if (overrun !== null) {
      throw new Error(
        `G0 border: ${job.row.name}[${job.frame}] paints outside its cell: ${overrun}`,
      );
    }
    pixels.set(
      `${job.row.name}[${job.frame}]`,
      flatCtx.getImageData(0, 0, flat.width, flat.height).data,
    );

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

  const baked: BakedSheet = {
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry,
    columns,
  };
  gateLoopClosure(baked, pixels);
  gateGoreDistinctness(pixels, geometry);
  gateAnchor(geometry);
  return baked;
}

// ── Manifest ─────────────────────────────────────────────────────────────────

export const SHEET_PATH = 'src/images/enemies/dark_knight.png';
const MANIFEST_PATH = 'src/images/enemies/manifest.json';
const MANIFEST_KEY = 'dark_knight';

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

function manifestEntryFor(sheet: BakedSheet): ManifestEntry {
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
    path: 'enemies/dark_knight.png',
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
function verifyManifest(sheet: BakedSheet): void {
  const required = manifestEntryFor(sheet);
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  if (canonicalJson(manifest[MANIFEST_KEY]) === canonicalJson(required)) {
    console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
    return;
  }
  console.error(
    `\n${MANIFEST_PATH} is out of sync with the bake. Replace its "${MANIFEST_KEY}" entry with:\n` +
      `${JSON.stringify(required, null, 2)}\n`,
  );
  process.exitCode = 1;
}

function writeSheet(): void {
  console.log(
    `Generating dark knight sprite sheet (tileScale=${TILE_SCALE}, scale=${KNIGHT_SCALE})…`,
  );
  gateLegReach();
  gateFootSlide();
  gateOffHandGrip();
  gateMaceArc();
  gateMaceFloor();
  gateImpactIsPeak();

  const sheet = bake();
  writeFileSync(resolve(SHEET_PATH), sheet.buffer);

  console.log(`  → ${SHEET_PATH}`);
  console.log(
    `  → ${sheet.columns * sheet.geometry.frameWidth}×${ROWS.length * sheet.geometry.frameHeight}px  ` +
      `(${ROWS.length} rows × ${sheet.columns} cols of ${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight})`,
  );
  ROWS.forEach((row, index) => {
    const impact = row.impactFrame === null ? '' : `, impact ${row.impactFrame}`;
    console.log(`     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view}${impact})`);
  });
  console.log(`  tileX=${sheet.geometry.tileX}  tileY=${sheet.geometry.tileY}`);
  // Reported even when it passes: a sheet quietly doubling in size between
  // bakes is a cost nobody notices until the download budget is already spent.
  const megapixels =
    (sheet.columns * sheet.geometry.frameWidth * ROWS.length * sheet.geometry.frameHeight) /
    PIXELS_PER_MEGAPIXEL;
  if (megapixels > TEXTURE_BUDGET_MEGAPIXELS) {
    throw new Error(
      `texture budget: the sheet is ${megapixels.toFixed(1)} megapixels against a ` +
        `${TEXTURE_BUDGET_MEGAPIXELS} limit — trim a row or shorten one`,
    );
  }
  console.log(
    `  texture: ${megapixels.toFixed(1)} of ${TEXTURE_BUDGET_MEGAPIXELS} megapixels ` +
      `(${(sheet.buffer.length / BYTES_PER_MEGABYTE).toFixed(2)} MB on disk)`,
  );

  if (process.argv.includes('--skip-manifest-gate')) {
    console.log('  manifest: gate skipped');
    return;
  }
  verifyManifest(sheet);
}

// The review harness imports ROWS from here, so painting the sheet has to be
// something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheet();
}

export { bake, geometryFor, measure };
