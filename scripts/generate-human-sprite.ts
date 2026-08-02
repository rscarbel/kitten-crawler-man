#!/usr/bin/env tsx
/**
 * Generates the `human` sprite sheet — Carl, who came down into the dungeon in
 * a leather jacket, heart-print boxers and bare feet.
 *
 * The anatomy and the painting live in `scripts/carlArt.ts`; this file is only
 * the choreography: one pose function per animation row, sampled per frame.
 *
 * Rows (see the `human` entry in src/images/characters/manifest.json):
 *    0 idle        — toward the camera, breathing, fists loose
 *    1 idle_side   — profile, drawn facing +X and mirrored at runtime
 *    2 idle_away   — away from the camera
 *    3 walk
 *    4 walk_side
 *    5 walk_away
 *    6 punch_side  — straight right cross, contact on the impact frame
 *    7 kick_side   — chambered front kick
 *    8 punch_up    — uppercut at something north of him, so seen from behind
 *    9 kick_down   — stomp at something south of him, so seen head-on
 *   10 smush       — the ability: foot raised over the head, then driven down
 *
 * The blast Smush throws off is NOT baked here. It scales with the ability's
 * level-dependent radius, so it is drawn at runtime by `SmushEffectSystem`.
 *
 * Run: npx tsx scripts/generate-human-sprite.ts   (npm run gen:human)
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  ARM_LENGTH,
  FACING_ARM_ROOT_HALF,
  type ArmAngles,
  type CarlPose,
  type Pt,
  clamp01,
  deg,
  drawCarlBack,
  drawCarlFront,
  drawCarlSide,
  easeIn,
  easeInOut,
  easeOut,
  hump,
  lerp,
  ramp,
  FOREARM_LENGTH,
  restingPose,
  SHOULDER_JOINT_DROP,
  UPPER_ARM_LENGTH,
  SHOULDER_Y,
} from './carlArt.js';

// ── Sheet geometry (must match the manifest entry) ───────────────────────────

export const FRAME_W = 192;
export const FRAME_H = 192;
/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
export const TILE_X = (FRAME_W - TILE_SCALE) / 2;
/**
 * The tile sits low in the frame: Carl is two tiles tall and throws a fist
 * higher still, so almost all the spare room has to be above his feet.
 */
export const TILE_Y = 120;
/** Ground line within the frame, matching the cat's foot placement in its tile. */
const GROUND_OFFSET_IN_TILE = 0.9;
const ORIGIN_X = TILE_X + TILE_SCALE / 2;
const ORIGIN_Y = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/**
 * How much of a tile Carl fills. The anatomy is authored at a comfortable
 * working size and then scaled about his own ground line, which keeps his feet
 * on the tile they belong to. The factor is set from the sheet he replaces: at
 * full size he stood 2.2 tiles tall against that sprite's 1.6, and a crawler
 * 40% taller than the one the maps were built around reads as a giant.
 */
const HUMAN_SCALE = 0.72;

const IDLE_FRAMES = 8;
/**
 * Twice the frames of the other cycles. The walk is the animation that plays
 * most and travels furthest, so it is the one where 8 steps read as a stutter;
 * these are half-steps, not extra motion.
 */
const WALK_FRAMES = 16;
const ATTACK_FRAMES = 8;
export const SMUSH_FRAMES = 12;

/**
 * `HumanPlayer` fires the melee hit on the middle frame of its swing, so every
 * attack row has to reach full extension exactly here.
 */
const ATTACK_IMPACT_FRAME = 4;
/**
 * The frame Smush's blast is spawned on. `src/sprites/humanSprite.ts` declares
 * the same value: the runtime cannot import from `scripts/` (rootDir is `src/`),
 * so the two are duplicated and the generator prints its row table on every bake
 * so a mismatch is visible.
 */
export const SMUSH_IMPACT_FRAME = 4;

// ── Pose helpers ─────────────────────────────────────────────────────────────

function pt(x: number, y: number): Pt {
  return { x, y };
}

/** Progress through a one-shot, where `impact` is the moment of contact. */
function strikePhase(t: number, impact: number): { wind: number; strike: number; recover: number } {
  const wind = clamp01(t / impact);
  const strike = t <= impact ? 0 : clamp01((t - impact) / (1 - impact));
  return { wind, strike, recover: strike };
}

/**
 * Standing still is meant to read as *alive*, not as swaying. Every idle term
 * is deliberately near the threshold of visibility at a 32px tile.
 */
const BREATH_RISE = 0.005;
const BREATH_SHOULDER_LEAN = deg(0.4);
const BLINK_AT = 0.72;
const BLINK_WIDTH = 0.08;

/** A blink centred on `at`, expressed in cycle phase. */
function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 1.5) % 1) - 0.5);
  return distance > BLINK_WIDTH ? 0 : hump(1 - distance / BLINK_WIDTH);
}

const IDLE_HAND_SWAY = 0.005;
const IDLE_HEAD_TURN = 0.05;
const IDLE_HAIR_DRIFT = 0.04;
/** How far he keeps his face toward the camera while standing in profile. */
const SIDE_HEAD_TURN = 0.2;
/**
 * Where a relaxed arm hangs: straight down from the shoulder root, wrist level
 * with the boxer hem. Standing and the head-on walk share these, because the
 * walk has to start from where he stands.
 *
 * Both numbers are load-bearing. Set the hands inboard of the shoulder roots
 * (`SHOULDER_HALF * ARM_INSET`, 0.252) and the forearms converge on the
 * centreline, which turns his hands inward in front of his own crotch. Set the
 * drop past the arm's reach (0.628) and the IK clamps it, which tips the whole
 * arm toward whatever the target was — inward, again.
 */
const HAND_HANG_SPREAD = 0.345;
/**
 * How far the wrist sits below the shoulder *joint* — just inside the arm's own
 * reach, so the IK has nothing to bend to take up. Measured from the shoulder
 * line instead (the joint is `SHOULDER_JOINT_DROP` lower) the arm comes up 0.05
 * short of straight, and the solver spends every bit of that slack throwing the
 * elbow sideways: a 6px bow on a 46px-per-tile sheet.
 */
const ARM_HANG_REACH = ARM_LENGTH * 0.995;
/** The same hang, measured from the shoulder line, where poses place hands. */
const HAND_HANG_DROP = SHOULDER_JOINT_DROP + ARM_HANG_REACH;
/**
 * Feet stand under the hips. Any wider and the thighs have to angle out to
 * reach them, which reads as knock-kneed however subtle the knee itself is.
 */
const IDLE_FOOT_SPREAD = 0.135;
/**
 * Edge-on the two feet are only slightly staggered: a wide profile stance
 * splits the legs so far fore-and-aft that no pair of shorts can cover both.
 */
const IDLE_SIDE_FOOT_LEAD = 0.075;
/** How far behind the hip the hands hang in profile. */
const SIDE_HAND_BEHIND = 0.05;

function idleBase(phase: number): CarlPose {
  const breath = Math.sin(phase * Math.PI * 2);
  const pose = restingPose();
  pose.bob = -BREATH_RISE * (breath * 0.5 + 0.5);
  pose.lean = BREATH_SHOULDER_LEAN * breath;
  pose.blink = blink(phase, BLINK_AT);
  pose.brow = 0.55;
  pose.hairFlow = breath * IDLE_HAIR_DRIFT;
  return pose;
}

function idleFront(phase: number): CarlPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * Math.PI * 2);
  pose.sway = sway * IDLE_HAND_SWAY;
  pose.headTurn = sway * IDLE_HEAD_TURN;
  // The same joint angles the head-on walk swings around, so stepping off from
  // standing cannot change the shape of his arms — only how much they move.
  pose.rightArmAngles = facingArmAngles(RIGHT_ARM, sway * IDLE_ARM_DRIFT, 0, 0);
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, sway * IDLE_ARM_DRIFT, 0, 0);
  pose.leftFoot = pt(-IDLE_FOOT_SPREAD, 0);
  pose.rightFoot = pt(IDLE_FOOT_SPREAD, 0);
  // Straight columns, matching the head-on walk, so standing up out of a step
  // doesn't pop the knees into a bow.
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  return pose;
}

function idleSide(phase: number): CarlPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * Math.PI * 2);
  // Edge-on, a relaxed hand hangs beside the hip, not out in front of the
  // crotch: anything forward of the centreline reads as reaching for something.
  // Edge-on the arms hang against the hip, and the fingertips have to stop at
  // or above the boxer hem: a bare hand below it, on the centreline, reads
  // obscenely at tile size.
  // The same near-full-reach hang the front view uses. Held any higher the IK
  // takes up the slack at the elbow, and 0.04 of shortfall was enough to throw
  // this arm into a visible dog-leg.
  pose.leftHand = pt(-SIDE_HAND_BEHIND, SHOULDER_Y + HAND_HANG_DROP + pose.bob);
  pose.rightHand = pt(-SIDE_HAND_BEHIND * 0.4, SHOULDER_Y + HAND_HANG_DROP - pose.bob);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD, 0);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD, 0);
  pose.headTurn = SIDE_HEAD_TURN + sway * IDLE_HEAD_TURN;
  // Edge-on the elbow has to break backward; forward it swings the forearm
  // across his own crotch.
  pose.elbowFlare = -0.35;
  return pose;
}

function idleBack(phase: number): CarlPose {
  const pose = idleFront(phase);
  pose.headTurn = -pose.headTurn;
  // Seen from behind his arms hang on the far side of him, the same as they do
  // in the walk he steps into from here.
  pose.leftArmBehind = true;
  pose.rightArmBehind = true;
  return pose;
}

// ── Walking ──────────────────────────────────────────────────────────────────

/**
 * A walk cycle, timed the way animators key one: contact → down → passing → up,
 * twice per cycle. Phase 0 is right-foot contact.
 *
 * The thing that makes a walk read as walking rather than as a figure kicking
 * its feet out in front of it is the *tuck*: after toe-off the foot comes up
 * behind the hip with the knee folded, passes under the body, and only then
 * reaches forward. A swing leg that travels forward straight-kneed is a goose
 * step, which is what the first pass drew.
 */
/**
 * Short, and it has to be. His leg is very nearly as long as his hip is high,
 * so a foot planted much further out than this is beyond the leg's reach: the
 * IK clamps at the end of stance, the leg locks dead straight, and the next
 * frame's tuck snaps the knee back in — the hitch that reads as a hop.
 */
const STRIDE = 0.17;
/**
 * Foot height just after toe-off, when the knee is most folded — eased into by
 * `TOE_LIFT` rather than reached straight off the floor. A leg that is nearly
 * straight one frame and deeply folded the next pops at the knee.
 */
const TUCK_LIFT = 0.17;
/** The first, small lift as the toe leaves the floor. */
const TOE_LIFT = 0.05;
const TOE_LIFT_AT = 0.12;
/** Foot height as it passes under the hip. */
const PASS_LIFT = 0.115;
/** Foot height as it reaches out for the next contact. */
const REACH_LIFT = 0.03;
/** Where in the swing the tuck, the pass and the reach fall. */
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;

const WALK_BOB = 0.038;
const WALK_LEAN = deg(3);
const HEEL_STRIKE_PITCH = deg(-9);
const TOE_OFF_PITCH = deg(13);
const SWING_PITCH = deg(-6);

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
 * One foot of a profile gait. During stance the foot is planted and slides
 * backward under the body at a constant rate — the body is what moves. During
 * swing it tucks, passes and reaches.
 */
function gaitFootSide(phase: number): { foot: Pt; pitch: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < 0.5;
  const t = stance ? cycle / 0.5 : (cycle - 0.5) / 0.5;

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
 * Walking at the camera. Almost none of the stride is visible head-on, so the
 * step has to be sold by the foot rising and the leg foreshortening rather than
 * by any sideways travel.
 *
 * A knee pointed at the viewer does not read as an angle — it hinges away from
 * the camera, not across it — so the swing leg stays a straight column and
 * reports how foreshortened it is, which is what tells the painter to stop
 * pinching the shin at the knee. Bending it in the image plane instead is what
 * made the earlier front walk look like the legs were snapping sideways.
 */
function gaitFootFacing(
  phase: number,
  side: number,
): { foot: Pt; pitch: number; nearness: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < 0.5;
  const t = stance ? cycle / 0.5 : (cycle - 0.5) / 0.5;
  const home = side * IDLE_FOOT_SPREAD;

  if (stance) {
    return {
      foot: pt(home + FACING_STRIDE_DRIFT * lerp(1, -1, t), 0),
      // Same shape as the profile's, scaled down. Held flat and then jumping to
      // the swing's constant pitch — which is what this did — moves the ankle a
      // step sideways on the frame the foot changes phase.
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

/**
 * Head-on the step reads only as height, so it takes nearly the full profile
 * lift to be legible at all; the pitch, by contrast, is almost invisible.
 */
const FACING_LIFT_SHARE = 0.95;
const FACING_PITCH_SHARE = 0.5;
const FACING_STRIDE_DRIFT = 0.035;
/** The lift at which the swing leg's shin is drawn at full near-camera width. */
const FULLY_NEAR_LIFT = TUCK_LIFT * FACING_LIFT_SHARE;

function walkSide(phase: number): CarlPose {
  const pose = restingPose();
  const right = gaitFootSide(phase);
  const left = gaitFootSide(phase + 0.5);
  const bobPhase = Math.abs(Math.sin(phase * Math.PI * 2));

  // The pelvis *drops* at contact rather than rising at mid-stance. A walking
  // leg is nearly as long as the hip is high, so a foot planted a stride ahead
  // is out of reach from the standing height: the IK clamps, and the clamped
  // leg locks straight with its foot hanging above the floor. Dropping the hip
  // is what buys the stride, and it is what a real pelvis does anyway.
  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.lean = WALK_LEAN;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;

  const rightForward = -Math.sin(phase * Math.PI * 2);
  pose.rightArmAngles = sideArmAngles(rightForward);
  pose.leftArmAngles = sideArmAngles(-rightForward);
  pose.rightFist = 0.55;
  pose.leftFist = 0.55;
  // Edge-on the elbow trails behind the shoulder through the swing.
  pose.elbowFlare = -0.5;
  pose.jacketFlare = 0.25;
  pose.hairFlow = -0.2;
  pose.blink = blink(phase, BLINK_AT);
  pose.brow = 0.6;
  pose.headTurn = 0.25;
  return pose;
}

function walkFacing(phase: number, away: boolean): CarlPose {
  const pose = restingPose();
  const right = gaitFootFacing(phase, 1);
  const left = gaitFootFacing(phase + 0.5, -1);
  const bobPhase = Math.abs(Math.sin(phase * Math.PI * 2));

  pose.bob = -WALK_BOB * bobPhase;
  pose.sway = Math.sin(phase * Math.PI * 2) * WALK_SWAY;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.rightLegNearness = right.nearness;
  pose.leftLegNearness = left.nearness;
  // Both legs, not just the swinging one: a bow that appears on the planted leg
  // and vanishes on the swinging one flickers once per step and reads as a
  // wiggle. Head-on, every knee is a straight column.
  pose.rightForeshorten = 1;
  pose.leftForeshorten = 1;

  const rightArm = facingArmSwing(phase, RIGHT_ARM, away);
  const leftArm = facingArmSwing(phase, LEFT_ARM, away);
  pose.rightArmAngles = rightArm.angles;
  pose.leftArmAngles = leftArm.angles;
  pose.rightArmBehind = rightArm.behind;
  pose.leftArmBehind = leftArm.behind;
  pose.rightFist = 0.55;
  pose.leftFist = 0.55;
  pose.twist = Math.sin(phase * Math.PI * 2) * FACING_SHOULDER_TWIST;
  pose.jacketFlare = 0.2;
  pose.hairFlow = Math.sin(phase * Math.PI * 2) * 0.12;
  pose.blink = blink(phase, BLINK_AT);
  pose.brow = 0.6;
  pose.headTurn = away ? 0 : Math.sin(phase * Math.PI * 2) * 0.15;
  return pose;
}

const WALK_SWAY = 0.014;
/**
 * Barely there: the shoulders are what carry the *upper* arm, and head-on the
 * upper arm is the part that should not visibly move at all.
 */
const FACING_SHOULDER_TWIST = 0.1;

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

/** How much of the shoulder's swing the forearm inherits. */
const FOREARM_FOLLOW = 0.22;
/** The bend a walking elbow simply holds, keeping the forearm ahead of the arm. */
const ELBOW_FLEX = deg(11);

/** `side` is +1 for the arm that swings forward on the beat and −1 for its pair. */
const RIGHT_ARM = 1;
const LEFT_ARM = -1;
/** Shoulder rotation at the top of the forward swing. */
const ARM_SWING_ANGLE = deg(36);
/** An arm swings further forward than back, so the backswing is scaled down. */
const ARM_BACKSWING_SHARE = 0.55;
/**
 * One arm of a head-on walk, as joint angles.
 *
 * Placing the hand instead is a trap that cost several passes: head-on a
 * swinging arm foreshortens, a shorter hand target is slack the IK has nowhere
 * to put but the elbow, and at full swing the elbow duly swung 0.18 tiles out
 * to the side. Rotating the joints keeps the arm at its own length, so nothing
 * bows.
 *
 * The upper arm barely moves — at this angle it is nearly end-on to the viewer
 * and has almost nothing it *can* show — so the forearm carries what travel
 * there is, and even that stays small.
 *
 * The travel is inward only. Arms swing in a plane just off the body and cross
 * slightly toward the centreline as they come forward; they never swing out
 * away from it. So each arm's hang is its rest tilt *minus* an inward amount
 * that peaks when that arm is forward — the two arms alternate in time, not in
 * direction.
 *
 * That inward amount has to be a *remapped* swing, not a rectified one. Folding
 * the negative half back up (`own >= 0 ? own : -own`) keeps the motion inward,
 * but it also makes each arm reach an inward peak twice per stride instead of
 * once — the swing then reads at double speed however small the amplitude is.
 */
function facingArmSwing(
  phase: number,
  side: number,
  away: boolean,
): { angles: ArmAngles; behind: boolean } {
  const own = Math.sin(phase * Math.PI * 2) * side;
  const signedSwing = own >= 0 ? own : own * ARM_BACKSWING_SHARE;
  // Centred on the rest hang, so the *average* of the cycle is where his arms
  // stand. Left uncentred the whole swing sits inboard of the idle, and he
  // visibly tucks his arms in the moment he starts walking.
  const swing = signedSwing - (1 - ARM_BACKSWING_SHARE) / 2;
  // 0 at the back of the swing, 1 at the front — one peak per stride, matching
  // the inward travel rather than doubling its rate.
  const forward = (own + 1) / 2;
  return {
    angles: facingArmAngles(side, swing, forward, WALK_ELBOW_FLEX),
    // Whole-row, not per-frame: an arm that changes sides partway through the
    // cycle pops at the shoulder. Toward the camera an arm is in front of the
    // chest for the whole swing; away from it, behind the back.
    behind: away,
  };
}

/**
 * One head-on arm, `swing` positive as it comes forward and crosses inboard.
 *
 * `forward` runs 0 at the back of the swing to 1 at the front, and drives the
 * foreshortening: an arm swung at the camera turns out of the picture plane, so
 * its forearm draws shorter and carries the hand *up* the body. Without that
 * the hand tracks a flat arc at one height, which is the last thing that kept
 * the head-on walk from looking like a walk.
 */
function facingArmAngles(side: number, swing: number, forward: number, flex: number): ArmAngles {
  return {
    upper: side * (FACING_UPPER_TILT - swing * FACING_UPPER_SWING),
    fore: side * (FACING_FOREARM_TILT - flex - swing * FACING_FOREARM_SWING),
    foreScale: 1 - forward * FACING_FOREARM_FORESHORTEN,
  };
}

/** How much of its length the forearm loses at the front of the swing. */
const FACING_FOREARM_FORESHORTEN = 0.18;
/** Walking bends the elbow a little past where it hangs standing. */
const WALK_ELBOW_FLEX = deg(7);

/** Standing, the arms drift by a fraction of the walk's swing. */
const IDLE_ARM_DRIFT = 0.07;

/**
 * A relaxed arm is not a straight rod: the elbow carries a little standing
 * flexion, which is what gives the arm a readable break at the joint and holds
 * it off the ribs. The upper arm therefore tilts out further than the forearm
 * does — elbow outboard, forearm hanging closer to vertical.
 */
const FACING_ELBOW_FLEX = deg(8);

/**
 * The pair of tilts that hold `FACING_ELBOW_FLEX` of bend while still landing
 * the wrist exactly where the idle's hand hangs. Two segments at two angles
 * have no tidy closed form for that, so it is solved by bisection at load.
 */
function solveForearmTilt(): number {
  const wristOffset = HAND_HANG_SPREAD - FACING_ARM_ROOT_HALF;
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

/** Enough halvings to land the wrist inside a thousandth of a tile. */
const TILT_SOLVE_STEPS = 40;

const FACING_FOREARM_TILT = solveForearmTilt();
const FACING_UPPER_TILT = FACING_FOREARM_TILT + FACING_ELBOW_FLEX;

/**
 * The shoulder does move — an arm swinging only at the elbow is a hand waving
 * on a fixed stick. It just moves far less than the elbow does, since head-on
 * the upper arm is close to end-on and has little of its travel to show.
 */
const FACING_UPPER_SWING = deg(5);
/** The forearm still carries most of the visible work at this angle. */
const FACING_FOREARM_SWING = deg(11);

// ── Attacks ──────────────────────────────────────────────────────────────────

const GUARD_HAND_X = 0.12;
const GUARD_HAND_Y = -1.42;
const PUNCH_REACH = 0.66;
const PUNCH_CHAMBER_X = -0.12;

/** A straight right cross thrown in profile, landing on the impact frame. */
function punchSide(t: number): CarlPose {
  const { wind, strike } = strikePhase(t, ATTACK_IMPACT_FRAME / (ATTACK_FRAMES - 1));
  const thrown = strike > 0 ? 1 - easeOut(strike) : easeIn(wind);
  const pose = restingPose();

  pose.lean = deg(3) * thrown - deg(2) * (1 - thrown);
  pose.twist = lerp(-0.4, 0.6, thrown);
  pose.bob = -0.012 * thrown;
  pose.crouch = 0.06 * (1 - thrown) + 0.03;

  pose.rightHand = pt(
    lerp(PUNCH_CHAMBER_X, PUNCH_REACH, thrown),
    lerp(GUARD_HAND_Y, -1.56, thrown),
  );
  pose.leftHand = pt(GUARD_HAND_X * (1 - thrown) - 0.02, GUARD_HAND_Y + 0.04 * thrown);
  pose.rightFist = 1;
  pose.leftFist = 0.9;
  pose.elbowFlare = 0.9;

  pose.rightFoot = pt(0.2 + 0.06 * thrown, 0);
  pose.leftFoot = pt(-0.22, 0);
  pose.leftFootPitch = deg(-8) * thrown;
  pose.brow = 0.8 + 0.2 * thrown;
  pose.mouth = 0.55 * thrown;
  pose.headTurn = 0.4;
  pose.hairFlow = -0.5 * thrown;
  pose.jacketFlare = 0.5 * thrown;
  return pose;
}

const KICK_CHAMBER_LIFT = 0.72;
const KICK_REACH = 0.86;
const KICK_HEIGHT = 0.62;

/** A chambered front kick: knee up, then the sole driven out. */
function kickSide(t: number): CarlPose {
  const { wind, strike } = strikePhase(t, ATTACK_IMPACT_FRAME / (ATTACK_FRAMES - 1));
  const chambered = easeInOut(wind);
  const extended = strike > 0 ? 1 - easeOut(strike) : easeIn(wind);
  const pose = restingPose();

  pose.lean = -deg(6) * extended;
  pose.bob = -0.03 * chambered;
  pose.crouch = 0.1 * chambered;

  pose.rightFoot = pt(
    lerp(0.16, KICK_REACH, extended),
    -lerp(KICK_CHAMBER_LIFT * chambered, KICK_HEIGHT, extended),
  );
  pose.rightFootPitch = deg(-30) * (1 - extended) + deg(8) * extended;
  pose.leftFoot = pt(-0.1, 0);

  const shoulderY = SHOULDER_Y + pose.bob;
  pose.rightHand = pt(-0.2 * extended - 0.04, shoulderY + 0.5);
  pose.leftHand = pt(0.16 - 0.24 * extended, shoulderY + 0.4 - 0.08 * extended);
  pose.rightFist = 0.8;
  pose.leftFist = 0.8;
  pose.elbowFlare = 0.7;
  pose.brow = 0.85;
  pose.mouth = 0.6 * extended;
  pose.headTurn = 0.35;
  pose.hairFlow = -0.4 * extended;
  pose.jacketFlare = 0.6 * extended;
  return pose;
}

const UPPERCUT_RISE = 0.64;

/** An uppercut at something north of him — seen from behind, so back view. */
function punchUp(t: number): CarlPose {
  const { wind, strike } = strikePhase(t, ATTACK_IMPACT_FRAME / (ATTACK_FRAMES - 1));
  const thrown = strike > 0 ? 1 - easeOut(strike) : easeIn(wind);
  const pose = restingPose();

  pose.crouch = 0.16 * (1 - thrown) * easeInOut(wind) + 0.04;
  pose.bob = -0.05 * thrown;
  pose.lean = -deg(3) * thrown;
  pose.twist = 0.3 * thrown;

  const shoulderY = SHOULDER_Y + pose.bob;
  pose.rightHand = pt(
    lerp(0.3, 0.14, thrown),
    lerp(shoulderY + 0.34, shoulderY - UPPERCUT_RISE, thrown),
  );
  pose.leftHand = pt(-0.32, shoulderY + 0.44 - 0.1 * thrown);
  pose.rightFist = 1;
  pose.leftFist = 0.85;
  pose.elbowFlare = 0.85;

  pose.rightFoot = pt(0.16, -0.05 * thrown);
  pose.rightFootPitch = deg(24) * thrown;
  pose.leftFoot = pt(-0.16, 0);
  pose.hairFlow = 0.4 * thrown;
  pose.jacketFlare = 0.7 * thrown;
  return pose;
}

const STOMP_LIFT = 0.62;
const STOMP_CROUCH = 0.13;
const STOMP_FOOT_OUT = 0.3;
const STOMP_STANCE = 0.22;

/** A stomp at something south of him — seen head-on, so front view. */
function kickDown(t: number): CarlPose {
  const impactAt = ATTACK_IMPACT_FRAME / (ATTACK_FRAMES - 1);
  const raised = easeInOut(clamp01(t / impactAt));
  // The sole meets the floor *on* the impact frame, so everything after it is
  // recovery: a lift that is still up on that frame reads as a missed beat.
  const landed = t >= impactAt ? 1 : 0;
  const recoil = landed * (1 - ramp(t, impactAt, 1));
  const pose = restingPose();

  pose.bob = -0.05 * raised * (1 - landed);
  pose.crouch = STOMP_CROUCH * recoil + 0.1 * raised * (1 - landed);
  pose.lean = deg(3) * recoil;

  const lift = STOMP_LIFT * raised * (1 - landed);
  // The knee comes up in front of him and the foot swings outboard, because a
  // knee raised straight at the camera has no silhouette to read.
  pose.rightFoot = pt(STOMP_STANCE + STOMP_FOOT_OUT * (lift / STOMP_LIFT), -lift);
  pose.rightKneeBreak = 1;
  pose.rightFootPitch = deg(-22) * raised * (1 - landed) + deg(14) * recoil;
  pose.leftFoot = pt(-STOMP_STANCE, 0);

  const shoulderY = SHOULDER_Y + pose.bob;
  const armsUp = 0.16 * raised * (1 - landed);
  pose.rightHand = pt(0.34 + 0.06 * raised, shoulderY + 0.4 - armsUp + 0.14 * recoil);
  pose.leftHand = pt(-0.34 - 0.06 * raised, shoulderY + 0.4 - armsUp + 0.14 * recoil);
  pose.rightFist = 0.9;
  pose.leftFist = 0.9;
  pose.elbowFlare = 0.9;
  pose.brow = 0.9;
  pose.mouth = 0.7 * recoil;
  pose.hairFlow = 0.3 * raised * (1 - landed) - 0.3 * recoil;
  pose.jacketFlare = 0.8 * recoil;
  pose.blink = 0.5 * recoil;
  return pose;
}

// ── Smush ────────────────────────────────────────────────────────────────────

const SMUSH_KNEE_APEX = 0.92;
const SMUSH_FOOT_OUT = 0.26;
const SMUSH_ARCH_BACK = deg(-5);
/**
 * A crouch drops the hip toward the planted feet, so the knees have to break
 * out to absorb it. Too deep a landing and the recovery frames spend half the
 * animation bow-legged.
 */
const SMUSH_LANDED_CROUCH = 0.26;
/**
 * The landing stance. A crouch bends the knees outward whatever you do, so the
 * feet plant wide enough that the knees end up over them and it reads as an
 * athletic landing rather than as bow legs.
 */
const SMUSH_STANCE = 0.19;
const SMUSH_ARMS_UP = 0.46;
const SMUSH_RECOIL_FRAMES = 3;
const SMUSH_REBOUND = 0.03;

/**
 * The ability itself: Carl rears back, drives one bare foot up over his own
 * waist, and stamps it through the floor. Timed so the sole meets the ground on
 * {@link SMUSH_IMPACT_FRAME}, which is the frame the blast is spawned on.
 */
function smush(t: number): CarlPose {
  const impactAt = SMUSH_IMPACT_FRAME / (SMUSH_FRAMES - 1);
  const recoilEnd = (SMUSH_IMPACT_FRAME + SMUSH_RECOIL_FRAMES) / (SMUSH_FRAMES - 1);

  const rear = ramp(t, 0, impactAt * 0.55);
  // The foot is at its apex on the frame *before* impact, so the raise has to
  // be finished by then: on the impact frame itself the sole is already down.
  const apexAt = impactAt * ((SMUSH_IMPACT_FRAME - 1) / SMUSH_IMPACT_FRAME);
  const raise = ramp(t, impactAt * 0.25, apexAt);
  const landed = t >= impactAt ? 1 : 0;
  const recoil = landed * (1 - ramp(t, impactAt, recoilEnd));
  const settle = landed * ramp(t, recoilEnd, 1);

  const pose = restingPose();
  const airborne = raise * (1 - landed);

  pose.bob = -0.06 * airborne + SMUSH_REBOUND * recoil * (1 - recoil) * 4;
  pose.crouch = 0.2 * rear * (1 - airborne) + SMUSH_LANDED_CROUCH * recoil;
  pose.lean = SMUSH_ARCH_BACK * airborne + deg(5) * recoil;

  pose.rightFoot = pt(SMUSH_STANCE + SMUSH_FOOT_OUT * airborne, -SMUSH_KNEE_APEX * airborne);
  pose.rightKneeBreak = 1;
  pose.rightFootPitch = deg(-30) * airborne + deg(16) * recoil;
  pose.leftFoot = pt(-SMUSH_STANCE - 0.04 * airborne, 0);

  const shoulderY = SHOULDER_Y + pose.bob;
  const armsUp = SMUSH_ARMS_UP * airborne;
  // On the stamp the fists are driven down past the hips: it is the follow
  // through that sells the weight, not the raised leg.
  const armsDown = 0.3 * recoil;
  pose.rightHand = pt(0.4 + 0.12 * airborne, shoulderY + 0.4 - armsUp + armsDown);
  pose.leftHand = pt(-0.4 - 0.12 * airborne, shoulderY + 0.4 - armsUp + armsDown);
  pose.rightFist = 1;
  pose.leftFist = 1;
  pose.elbowFlare = 0.9;

  pose.brow = 1;
  pose.mouth = Math.max(0.45 * airborne, recoil);
  pose.blink = 0.6 * recoil;
  pose.headTilt = deg(-6) * airborne + deg(9) * recoil;
  pose.hairFlow = 0.6 * airborne - 0.5 * recoil;
  pose.jacketFlare = Math.max(0.5 * airborne, recoil);
  // Settling back to the stance is what makes the row loop cleanly into idle.
  pose.crouch *= 1 - settle;
  pose.lean *= 1 - settle;
  return pose;
}

// ── Sheet assembly ───────────────────────────────────────────────────────────

type View = 'front' | 'side' | 'back';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: View;
  readonly pose: (frame: number) => CarlPose;
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
    pose: (f) => idleFront(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_side',
    frameCount: IDLE_FRAMES,
    view: 'side',
    pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_away',
    frameCount: IDLE_FRAMES,
    view: 'back',
    pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    view: 'front',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), false),
  },
  {
    name: 'walk_side',
    frameCount: WALK_FRAMES,
    view: 'side',
    pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: WALK_FRAMES,
    view: 'back',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), true),
  },
  {
    name: 'punch_side',
    frameCount: ATTACK_FRAMES,
    view: 'side',
    pose: (f) => punchSide(shotProgress(f, ATTACK_FRAMES)),
  },
  {
    name: 'kick_side',
    frameCount: ATTACK_FRAMES,
    view: 'side',
    pose: (f) => kickSide(shotProgress(f, ATTACK_FRAMES)),
  },
  {
    name: 'punch_up',
    frameCount: ATTACK_FRAMES,
    view: 'back',
    pose: (f) => punchUp(shotProgress(f, ATTACK_FRAMES)),
  },
  {
    name: 'kick_down',
    frameCount: ATTACK_FRAMES,
    view: 'front',
    pose: (f) => kickDown(shotProgress(f, ATTACK_FRAMES)),
  },
  {
    name: 'smush',
    frameCount: SMUSH_FRAMES,
    view: 'front',
    pose: (f) => smush(shotProgress(f, SMUSH_FRAMES)),
  },
];

function drawView(ctx: Ctx, view: View, pose: CarlPose): void {
  if (view === 'front') drawCarlFront(ctx, pose);
  else if (view === 'back') drawCarlBack(ctx, pose);
  else drawCarlSide(ctx, pose);
}

/**
 * A frame that paints outside its cell is sheared flat by the sheet blit and
 * baked in, which nothing downstream can detect. Checking the border for ink
 * before anything is written turns that into a loud failure.
 */
const BORDER_ALPHA_LIMIT = 8;

function findBorderInk(ctx: Ctx, width: number, height: number): string | null {
  const data = ctx.getImageData(0, 0, width, height).data;
  const alphaAt = (x: number, y: number): number => data[(y * width + x) * 4 + 3];
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

function renderSheet(): Buffer {
  const cols = Math.max(...ROWS.map((r) => r.frameCount));
  const sheet = createCanvas(cols * FRAME_W, ROWS.length * FRAME_H);
  const sheetCtx = sheet.getContext('2d');

  const frame = createCanvas(FRAME_W * SUPERSAMPLE, FRAME_H * SUPERSAMPLE);
  const frameCtx = frame.getContext('2d');

  for (let row = 0; row < ROWS.length; row++) {
    const spec = ROWS[row];
    for (let col = 0; col < spec.frameCount; col++) {
      frameCtx.clearRect(0, 0, frame.width, frame.height);
      frameCtx.save();
      frameCtx.translate(ORIGIN_X * SUPERSAMPLE, ORIGIN_Y * SUPERSAMPLE);
      frameCtx.scale(TILE_SCALE * SUPERSAMPLE, TILE_SCALE * SUPERSAMPLE);
      frameCtx.scale(HUMAN_SCALE, HUMAN_SCALE);
      drawView(frameCtx, spec.view, spec.pose(col));
      frameCtx.restore();

      const overrun = findBorderInk(frameCtx, frame.width, frame.height);
      if (overrun !== null) {
        throw new Error(`${spec.name} frame ${col} paints outside its cell: ${overrun}`);
      }

      sheetCtx.drawImage(
        frame,
        0,
        0,
        frame.width,
        frame.height,
        col * FRAME_W,
        row * FRAME_H,
        FRAME_W,
        FRAME_H,
      );
    }
  }

  return sheet.toBuffer('image/png');
}

export const SHEET_PATH = 'src/images/characters/human.png';

function writeSheet(): void {
  const outPath = resolve(SHEET_PATH);
  console.log(
    `Generating human sprite sheet (${FRAME_W}×${FRAME_H}px frames, tileScale=${TILE_SCALE})…`,
  );
  writeFileSync(outPath, renderSheet());

  const cols = Math.max(...ROWS.map((r) => r.frameCount));
  console.log(`  → ${outPath}`);
  console.log(
    `  → ${cols * FRAME_W}×${ROWS.length * FRAME_H}px  (${ROWS.length} rows × ${cols} cols)`,
  );
  ROWS.forEach((r, i) => {
    console.log(`     row ${i}: ${r.name} (${r.frameCount} frames, ${r.view})`);
  });
  console.log(`tileX=${TILE_X}  tileY=${TILE_Y}  tileScale=${TILE_SCALE}`);
}

// The review harness imports ROWS from here, so painting the sheet has to be
// something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheet();
}
