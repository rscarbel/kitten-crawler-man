#!/usr/bin/env tsx
/**
 * Generates the `hoarder` sprite sheet — the first boss, fifteen feet of
 * enormously fat woman who vomits cockroaches.
 *
 * The anatomy and the painting live in `scripts/hoarderArt.ts` and the six
 * pieces she comes apart into in `scripts/hoarderGore.ts`; this file is only
 * the choreography, the sheet layout and the bake.
 *
 * Sheet rows (two of them carry two states side by side, which is what keeps
 * the sheet inside its texture budget — a six-frame state given a whole
 * twelve-column row wastes half of it):
 *
 *   0 walk        — toward the camera
 *   1 walk_side   — profile, drawn facing +X and mirrored at runtime
 *   2 walk_back   — away from the camera
 *   3 vomit       — toward the camera
 *   4 vomit_side
 *   5 vomit_back
 *   6 idle | idle_side
 *   7 idle_back | the six gore pieces
 *
 * Nothing here writes the manifest: `verifyManifest` compares the measured
 * geometry against what is on disk and prints the entry to paste on a
 * mismatch, because other agents work in this repo and a programmatic rewrite
 * of a shared file clobbers their edits.
 *
 * Run: npm run gen:hoarder  (which points at the gates, not at this file)
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ARM_LENGTH,
  FIGURE_HEIGHT,
  type HoarderPose,
  type HoarderView,
  LEG_REACH,
  SHOULDER_JOINT_DROP,
  SHOULDER_Y,
  clamp01,
  deg,
  drawHoarderView,
  hump,
  keyed,
  lerp,
  pt,
  restingPose,
} from './hoarderArt.js';
import { type GorePiece, hoarderGorePieces } from './hoarderGore.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
const SUPERSAMPLE = 2;
/** Clear pixels required between a frame's ink and the edge of its cell. */
const FRAME_PADDING = 6;
const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;
/** Scratch canvas the extents are measured on; larger than any frame can be. */
const MEASURE_SIZE = 640;

/**
 * How tall she stands on screen. The player is 1.46 tiles, so this is the 2.5×
 * that fifteen feet is against six — and it is applied here rather than in the
 * anatomy so retuning her size never silently redraws the choreography.
 */
export const HOARDER_TILES_TALL = 3.6;
const HOARDER_SCALE = HOARDER_TILES_TALL / FIGURE_HEIGHT;

/** Ground line inside the tile, in whole pixels so `tileY` stays an integer. */
const GROUND_OFFSET_PX = 58;

/**
 * Gore is drawn in the same units as the figure, because every piece is now
 * authored at the size of the part it came off. Scaled up independently — it
 * was 2.2 against her 1.5 — a piece measured against her anatomy still renders
 * half again as big as the part it came from, and "her head, only bigger" is
 * exactly the note this sheet came back with.
 */
const GORE_PIECE_SCALE = HOARDER_SCALE;
const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

const WALK_FRAMES = 12;
const VOMIT_FRAMES = 12;
const IDLE_FRAMES = 6;

/**
 * The frame the bolus actually leaves her mouth on. `src/sprites/hoarderSprite.ts`
 * declares the same number — the runtime cannot import from `scripts/` — and a
 * gate holds the two equal.
 */
export const VOMIT_RELEASE_FRAME = 7;

const GORE_PIECES: readonly GorePiece[] = hoarderGorePieces();
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

/** Phase of a looping row, 0 at the start and never reaching 1. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

/** Progress through a one-shot row, sampled at the middle of each frame. */
function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/**
 * Standing still has to read as *alive* without reading as swaying. On her the
 * breath is carried almost entirely by the belly, which is the one part of her
 * big enough for a movement this small to be visible at a 32px tile.
 */
const BREATH_HEAVE = 0.16;
/**
 * The breath settles her rather than lifting her — a body this heavy sinks on
 * the exhale — and it has to, because a hip lifted above standing puts the
 * ankle beyond the leg's reach and clamps it. Three sheet pixels: at a tenth of
 * that the idle measured as a still image with a wobbling belly.
 */
const BREATH_SETTLE = 0.03;
/**
 * Standing hip drop. Her leg is almost exactly as long as her hip is high, so
 * without a little permanent sag every standing pose sits on the clamp and any
 * animation that lifts the hip at all falls off it.
 */
const STANDING_HIP_DROP = 0.012;
const BREATH_ARM_DRIFT = 0.006;
const BLINK_AT = 0.7;
const BLINK_WIDTH = 0.1;
const IDLE_HAIR_DRIFT = 0.06;
const IDLE_HEAD_TURN = 0.04;
const IDLE_BROW = 0.55;
/** How far she keeps her face toward the camera while standing in profile. */
const SIDE_HEAD_TURN = 0.2;
const SIDE_HAND_BEHIND = 0.06;

/** A blink centred on `at`, expressed in cycle phase. */
function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 1.5) % 1) - 0.5);
  // `hump` peaks at 0.5, so the argument has to be half the *remaining*
  // distance: written as `hump(1 - d/w)` the eye is wide open at the centre of
  // its own blink and shut on both edges, which reads as two blinks.
  return distance > BLINK_WIDTH ? 0 : hump(0.5 * (1 - distance / BLINK_WIDTH));
}

function idleBase(phase: number): HoarderPose {
  const breath = Math.sin(phase * Math.PI * 2);
  const pose = restingPose();
  pose.bellyHeave = BREATH_HEAVE * (breath * 0.5 + 0.5);
  pose.bob = STANDING_HIP_DROP + BREATH_SETTLE * (breath * 0.5 + 0.5);
  pose.blink = blink(phase, BLINK_AT);
  pose.brow = IDLE_BROW;
  pose.hairFlow = breath * IDLE_HAIR_DRIFT;
  pose.bellySwing = breath * BREATH_ARM_DRIFT;
  return pose;
}

function idleFront(phase: number): HoarderPose {
  const pose = idleBase(phase);
  const breath = Math.sin(phase * Math.PI * 2);
  pose.headTurn = breath * IDLE_HEAD_TURN;
  pose.leftHand = pt(pose.leftHand.x - breath * BREATH_ARM_DRIFT, pose.leftHand.y);
  pose.rightHand = pt(pose.rightHand.x + breath * BREATH_ARM_DRIFT, pose.rightHand.y);
  // Straight columns, matching the head-on walk, so standing up out of a step
  // does not pop the knees into a bow.
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  return pose;
}

function idleSide(phase: number): HoarderPose {
  const pose = idleBase(phase);
  const breath = Math.sin(phase * Math.PI * 2);
  // Edge-on a relaxed hand hangs beside the hip; anything forward of the
  // centreline reads as reaching for something.
  pose.leftHand = pt(-SIDE_HAND_BEHIND, SHOULDER_Y + SHOULDER_JOINT_DROP + ARM_LENGTH * 0.9);
  pose.rightHand = pt(-SIDE_HAND_BEHIND * 0.4, SHOULDER_Y + SHOULDER_JOINT_DROP + ARM_LENGTH * 0.9);
  pose.leftFoot = pt(-SIDE_FOOT_LEAD, 0);
  pose.rightFoot = pt(SIDE_FOOT_LEAD, 0);
  pose.headTurn = SIDE_HEAD_TURN + breath * IDLE_HEAD_TURN;
  // Edge-on the elbow breaks backward; forward it swings the forearm across her
  // own front, where there is no room for it.
  pose.elbowsBack = true;
  return pose;
}

function idleBack(phase: number): HoarderPose {
  const pose = idleFront(phase);
  pose.headTurn = -pose.headTurn;
  // Seen from behind her arms hang on the far side of her, the same as they do
  // in the walk she steps into from here.
  pose.leftArmBehind = true;
  pose.rightArmBehind = true;
  return pose;
}

const SIDE_FOOT_LEAD = 0.1;

/** Where a resting hand hangs out from the centreline, read off the rest pose. */
const HAND_HANG_SPREAD = restingPose().rightHand.x;

// ── Walking ──────────────────────────────────────────────────────────────────

/**
 * How far each foot travels fore and aft in profile. It was a third of this,
 * which measured on a render as no step at all — the two feet overlapped for
 * the whole cycle and the side walk, the view a player sees on every horizontal
 * move, read as a skate.
 *
 * The headroom for it comes from the bob: her leg is almost exactly as long as
 * her hip is high, so a stride is only affordable at all because the pelvis
 * *drops* at contact. Raise one without the other and the IK clamps, the leg
 * locks straight and the step reads as a hop — `G8` measures this.
 */
const STRIDE = 0.22;
const TOE_LIFT = 0.05;
const TOE_LIFT_AT = 0.12;
const TUCK_LIFT = 0.145;
const PASS_LIFT = 0.11;
const REACH_LIFT = 0.02;
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;

/**
 * 5% of her height, against the 1.25% the first pass had — which measured as
 * a shimmy rather than as a walk. It is spent entirely *downward*: her leg is
 * almost exactly as long as her hip is high, so a bob that lifts the pelvis at
 * all puts the planted ankle beyond the leg's reach and the IK clamps.
 */
const WALK_BOB = 0.12;
/**
 * The lateral rock is the whole read of this gait. Someone this heavy does not
 * swing a leg through — the pelvis tips and the entire mass is carried over the
 * stance foot, once per step, and the belly arrives a beat after the hips do.
 */
const WALK_SWAY = 0.055;
const WALK_BELLY_SWING = 0.075;
/** Two frames of twelve: the mass arrives after the hips that threw it. */
const WALK_BELLY_LAG = 2 / WALK_FRAMES;
const WALK_BELLY_HEAVE = 0.2;
const HEEL_STRIKE_PITCH = deg(-5);
const TOE_OFF_PITCH = deg(9);
const SWING_PITCH = deg(-3);
/** Leaning back is what a belly this size does to a spine. */
const WALK_LEAN = deg(-5);

interface GaitFoot {
  readonly foot: { x: number; y: number };
  readonly pitch: number;
}

/**
 * The pelvis through one stride: deepest at each contact and highest at each
 * mid-stance. Written as `1 - |sin|` its slope is discontinuous at contact, and
 * at this amplitude that corner is a five-pixel jump between two frames that
 * reads as a hitch; a raised cosine at twice the step rate has the same shape
 * with zero slope at both ends of every half cycle.
 */
function walkBob(phase: number): number {
  return WALK_BOB * (0.5 + 0.5 * Math.cos(phase * Math.PI * 4));
}

/**
 * One foot of a profile gait. During stance the foot is planted and slides
 * backward under the body at a constant rate — the body is what moves. During
 * swing it tucks, passes and reaches.
 */
function gaitFootSide(phase: number): GaitFoot {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < 0.5;
  const t = stance ? cycle / 0.5 : (cycle - 0.5) / 0.5;

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
const FACING_STRIDE_DRIFT = 0.03;
const FACING_FOOT_SPREAD = 0.2;
const FULLY_NEAR_LIFT = TUCK_LIFT * FACING_LIFT_SHARE;

interface GaitFootFacing extends GaitFoot {
  readonly nearness: number;
}

function gaitFootFacing(phase: number, side: number): GaitFootFacing {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < 0.5;
  const t = stance ? cycle / 0.5 : (cycle - 0.5) / 0.5;
  const home = side * FACING_FOOT_SPREAD;

  if (stance) {
    return {
      foot: pt(home + FACING_STRIDE_DRIFT * lerp(1, -1, t), 0),
      pitch:
        keyed(t, [
          [0, HEEL_STRIKE_PITCH],
          [0.2, 0],
          [0.75, 0],
          [1, TOE_OFF_PITCH],
        ]) * FACING_PITCH_SHARE,
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
    foot: pt(home + FACING_STRIDE_DRIFT * lerp(-1, 1, t), -lift),
    pitch:
      keyed(t, [
        [0, TOE_OFF_PITCH],
        [PASS_AT, SWING_PITCH],
        [1, HEEL_STRIKE_PITCH],
      ]) * FACING_PITCH_SHARE,
    nearness: clamp01(lift / FULLY_NEAR_LIFT),
  };
}

/** How far a hand travels fore and aft in profile. Fat arms sway; they do not swing. */
const SIDE_HAND_SWING = 0.09;
const SIDE_HAND_RISE = 0.02;

function walkSide(phase: number): HoarderPose {
  const pose = restingPose();
  const right = gaitFootSide(phase);
  const left = gaitFootSide(phase + 0.5);
  const stepPhase = Math.abs(Math.sin(phase * Math.PI * 2));
  const rock = Math.sin(phase * Math.PI * 2);

  // The pelvis drops at contact rather than rising at mid-stance. A leg this
  // short cannot reach a foot planted a stride ahead from full standing height:
  // the IK clamps, the leg locks straight, and the foot hangs off the floor.
  pose.bob = walkBob(phase);
  pose.lean = WALK_LEAN;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;

  const forward = -Math.sin(phase * Math.PI * 2);
  const hangY = SHOULDER_Y + SHOULDER_JOINT_DROP + ARM_LENGTH * 0.9;
  pose.rightHand = pt(forward * SIDE_HAND_SWING, hangY - Math.abs(forward) * SIDE_HAND_RISE);
  pose.leftHand = pt(-forward * SIDE_HAND_SWING, hangY - Math.abs(forward) * SIDE_HAND_RISE);
  pose.elbowsBack = true;
  pose.bellySwing = Math.sin((phase - WALK_BELLY_LAG) * Math.PI * 2) * WALK_BELLY_SWING * 0.4;
  pose.bellyHeave = WALK_BELLY_HEAVE * (1 - stepPhase);
  pose.hairFlow = -0.25 + rock * 0.08;
  pose.headTurn = SIDE_HEAD_TURN;
  pose.brow = 0.65;
  pose.blink = blink(phase, BLINK_AT);
  return pose;
}

function walkFacing(phase: number, away: boolean): HoarderPose {
  const pose = restingPose();
  const right = gaitFootFacing(phase, 1);
  const left = gaitFootFacing(phase + 0.5, -1);
  const stepPhase = Math.abs(Math.sin(phase * Math.PI * 2));
  const rock = Math.sin(phase * Math.PI * 2);

  pose.bob = walkBob(phase);
  pose.sway = rock * WALK_SWAY;
  pose.bellySwing = Math.sin((phase - WALK_BELLY_LAG) * Math.PI * 2) * WALK_BELLY_SWING;
  pose.bellyHeave = WALK_BELLY_HEAVE * (1 - stepPhase);
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.rightLegNearness = right.nearness;
  pose.leftLegNearness = left.nearness;
  // Both legs, not just the swinging one: a bow that appears on the planted leg
  // and vanishes on the swinging one flickers once per step and reads as a
  // wiggle rather than as a walk.
  pose.rightForeshorten = 1;
  pose.leftForeshorten = 1;

  // Her hands ride on top of her own hips, so head-on they travel across the
  // body with the rock rather than fore and aft with the step.
  const hangY = SHOULDER_Y + SHOULDER_JOINT_DROP + ARM_LENGTH * 0.9;
  pose.rightHand = pt(
    HAND_HANG_SPREAD + rock * FACING_HAND_DRIFT,
    hangY - Math.abs(rock) * SIDE_HAND_RISE,
  );
  pose.leftHand = pt(
    -HAND_HANG_SPREAD + rock * FACING_HAND_DRIFT,
    hangY - Math.abs(rock) * SIDE_HAND_RISE,
  );
  pose.leftArmBehind = away;
  pose.rightArmBehind = away;
  pose.twist = rock * FACING_SHOULDER_TWIST;
  pose.hairFlow = rock * 0.14;
  pose.blink = blink(phase, BLINK_AT);
  pose.brow = 0.65;
  pose.headTurn = away ? 0 : rock * 0.12;
  return pose;
}

const FACING_HAND_DRIFT = 0.03;
const FACING_SHOULDER_TWIST = 0.12;

// ── Vomiting ─────────────────────────────────────────────────────────────────

/**
 * The telegraph the whole fight hangs on, in four beats: she plants and
 * swells, the gut convulses and a bolus climbs her throat, the head whips
 * forward and the jaw comes off its hinge, and then she sags with the string
 * still hanging off her chin.
 *
 * A wind-up that only opens a mouth is indistinguishable from a shout at the
 * size this is seen at, which is why the bolus in the throat exists at all.
 */
const VOMIT_RELEASE_AT = shotProgress(VOMIT_RELEASE_FRAME, VOMIT_FRAMES);
/**
 * The four beats, pinned to the frames they land on rather than to round
 * fractions, because every one of them is a thing the reviewer counts frames
 * for. Anticipation runs to f3, the heave from f4 to f6, the release is f7 and
 * the bile is still leaving her at f9.
 */
const VOMIT_ANTICIPATION_PEAK = shotProgress(3, VOMIT_FRAMES);
const VOMIT_HEAVE_FROM = shotProgress(4, VOMIT_FRAMES);
const VOMIT_HEAVE_MID = shotProgress(5, VOMIT_FRAMES);
const VOMIT_HEAVE_LATE = shotProgress(6, VOMIT_FRAMES);
const VOMIT_SPRAY_HOLD = shotProgress(8, VOMIT_FRAMES);
const VOMIT_SPRAY_ENDS = shotProgress(9, VOMIT_FRAMES);
const VOMIT_SPRAY_LAST = shotProgress(10, VOMIT_FRAMES);

/**
 * The jaw comes off its hinge *late*. Opened from the first frame the whole row
 * reads as a shout: a mouth already wide through the wind-up has nothing left
 * to do at the release, and the belly and the throat are then carrying the
 * telegraph on their own.
 */
const VOMIT_MOUTH = [
  [0, 0],
  [VOMIT_ANTICIPATION_PEAK, 0.14],
  [VOMIT_HEAVE_FROM, 0.2],
  [VOMIT_HEAVE_MID, 0.42],
  [VOMIT_HEAVE_LATE, 0.72],
  [VOMIT_RELEASE_AT, 1],
  [0.79, 0.5],
  [1, 0.14],
] as const;

/** The gut swells through the anticipation and empties through the heave. */
const VOMIT_HEAVE = [
  [0, 0.12],
  [VOMIT_ANTICIPATION_PEAK, 1],
  [VOMIT_HEAVE_MID, 0.72],
  [VOMIT_HEAVE_LATE, 0.42],
  [VOMIT_RELEASE_AT, 0.12],
  [1, 0.04],
] as const;

/** Negative leans back over the heels; positive throws the head forward. */
const VOMIT_LEAN = [
  [0, 0],
  [VOMIT_ANTICIPATION_PEAK, deg(-12)],
  [VOMIT_HEAVE_MID, deg(-6)],
  [VOMIT_RELEASE_AT, deg(14)],
  [0.82, deg(8)],
  [1, deg(2)],
] as const;

const VOMIT_HEAD_TILT = [
  [0, 0],
  [VOMIT_ANTICIPATION_PEAK, deg(-17)],
  [VOMIT_HEAVE_MID, deg(-8)],
  [VOMIT_RELEASE_AT, deg(20)],
  [0.85, deg(10)],
  [1, deg(3)],
] as const;

const VOMIT_CROUCH = [
  [0, 0],
  [VOMIT_ANTICIPATION_PEAK, 0],
  [VOMIT_HEAVE_MID, 0.1],
  [VOMIT_RELEASE_AT, 0.32],
  [1, 0.12],
] as const;

/**
 * The spine stretching up through the anticipation and collapsing through the
 * release. Head-on there is no lean to see and no stride to see, so this is the
 * only thing that separates "about to be sick" from "shouting".
 */
const VOMIT_TORSO_LIFT = [
  [0, 0],
  [VOMIT_ANTICIPATION_PEAK, 0.12],
  [VOMIT_HEAVE_MID, 0.05],
  [VOMIT_RELEASE_AT, -0.07],
  [0.85, -0.02],
  [1, 0],
] as const;

/** How much bile is leaving her mouth, frame by frame. */
const VOMIT_SPRAY = [
  [0, 0],
  [VOMIT_HEAVE_LATE, 0],
  [VOMIT_RELEASE_AT, 1],
  [VOMIT_SPRAY_HOLD, 0.95],
  [VOMIT_SPRAY_ENDS, 0.8],
  [VOMIT_SPRAY_LAST, 0.45],
  [0.96, 0],
  [1, 0],
] as const;

/** Where the bolus is visible in the throat, and where it is not. */
const BOLUS_START_AT = 0.18;
const BOLUS_ARRIVES_AT = 0.6;
const VOMIT_FOOT_SPREAD = 0.2;
const VOMIT_HAND_OUT = 0.14;
const VOMIT_HAND_LIFT = 0.1;
const VOMIT_BROW = 1;
const VOMIT_DROOL_FROM = 0.7;

function vomitBolus(progress: number): number {
  if (progress < BOLUS_START_AT || progress > BOLUS_ARRIVES_AT) return -1;
  return (progress - BOLUS_START_AT) / (BOLUS_ARRIVES_AT - BOLUS_START_AT);
}

function vomitBase(progress: number): HoarderPose {
  const pose = restingPose();
  pose.bob = STANDING_HIP_DROP;
  pose.mouth = keyed(progress, VOMIT_MOUTH);
  pose.bellyHeave = keyed(progress, VOMIT_HEAVE);
  pose.crouch = keyed(progress, VOMIT_CROUCH);
  pose.headTilt = keyed(progress, VOMIT_HEAD_TILT);
  pose.torsoLift = keyed(progress, VOMIT_TORSO_LIFT);
  pose.throatBolus = vomitBolus(progress);
  pose.spray = keyed(progress, VOMIT_SPRAY);
  pose.brow = VOMIT_BROW;
  // Eyes wide through the anticipation and screwed shut across the heave: at a
  // 32px tile the sclera is the brightest thing on her, so it is the one facial
  // cue that survives, and it has to be doing something before the mouth does.
  pose.blink =
    clamp01((progress - VOMIT_HEAVE_FROM) * VOMIT_BLINK_RATE) *
    (1 - clamp01((progress - VOMIT_SPRAY_HOLD) * VOMIT_BLINK_RATE));
  pose.drool =
    progress < VOMIT_DROOL_FROM
      ? 0
      : clamp01((progress - VOMIT_DROOL_FROM) / (1 - VOMIT_DROOL_FROM));
  pose.leftFoot = pt(-VOMIT_FOOT_SPREAD, 0);
  pose.rightFoot = pt(VOMIT_FOOT_SPREAD, 0);
  pose.leftFist = 0.7;
  pose.rightFist = 0.7;
  // Arms thrown out and back as the body folds — the shape of anyone about to
  // be sick, and it also clears the silhouette so the head is legible. Keyed
  // rather than humped so the widest frame is the release frame: a `hump` peaks
  // at the middle of the row, which put the extreme two frames early and had
  // her already recovering as the bile spawned.
  const thrown = keyed(progress, VOMIT_THROW);
  const hangY = SHOULDER_Y + SHOULDER_JOINT_DROP + ARM_LENGTH * 0.9;
  const spread = HAND_HANG_SPREAD + thrown * VOMIT_HAND_OUT;
  pose.leftHand = pt(-spread, hangY - thrown * VOMIT_HAND_LIFT);
  pose.rightHand = pt(spread, hangY - thrown * VOMIT_HAND_LIFT);
  pose.elbowsBack = false;
  return pose;
}

const VOMIT_THROW = [
  [0, 0],
  [0.3, 0.35],
  [0.5, 0.72],
  [VOMIT_RELEASE_AT, 1],
  [0.85, 0.45],
  [1, 0.1],
] as const;

function vomitSide(progress: number): HoarderPose {
  const pose = vomitBase(progress);
  pose.lean = keyed(progress, VOMIT_LEAN);
  pose.leftFoot = pt(-SIDE_FOOT_LEAD * 1.6, 0);
  pose.rightFoot = pt(SIDE_FOOT_LEAD * 1.6, 0);
  pose.headTurn = 0.15;
  pose.elbowsBack = true;
  // Edge-on the hands go *down* and back as she folds, not up: lifted the way
  // the head-on throw lifts them, the near forearm crosses in front of her own
  // face on exactly the frames the bile is leaving it.
  const hangY = SHOULDER_Y + SHOULDER_JOINT_DROP + ARM_LENGTH * 0.9;
  const thrown = keyed(progress, VOMIT_THROW);
  const back = -thrown * VOMIT_HAND_OUT * SIDE_HAND_BACK_GAIN;
  pose.leftHand = pt(back, hangY + thrown * SIDE_HAND_SINK);
  pose.rightHand = pt(back * 0.6, hangY + thrown * SIDE_HAND_SINK);
  return pose;
}

function vomitFacing(progress: number, away: boolean): HoarderPose {
  const pose = vomitBase(progress);
  // Head-on there is no lean to see, so the fold is carried by the crouch and
  // by how far the head drops. Carried on the bob instead it would *lift* her
  // through the arch-back half of the wind-up, and a hip lifted at all is a hip
  // her legs cannot reach the floor from.
  pose.crouch += Math.abs(keyed(progress, VOMIT_LEAN)) * VOMIT_FACING_LEAN_AS_CROUCH;
  pose.leftArmBehind = away;
  pose.rightArmBehind = away;
  pose.headTurn = 0;
  return pose;
}

const VOMIT_BLINK_RATE = 6;
const VOMIT_FACING_LEAN_AS_CROUCH = 0.55;
const SIDE_HAND_BACK_GAIN = 1.7;
const SIDE_HAND_SINK = 0.05;

// ── Rows ─────────────────────────────────────────────────────────────────────

type SegmentKind = 'loop' | 'oneShot' | 'gore';

export interface SegmentSpec {
  readonly name: string;
  /** Index of the sheet row this state lives on. */
  readonly row: number;
  readonly frameCount: number;
  readonly kind: SegmentKind;
  readonly view: HoarderView;
  /** Null on the gore segment, whose cells are pieces rather than poses. */
  readonly pose: ((frame: number) => HoarderPose) | null;
}

export const SEGMENTS: readonly SegmentSpec[] = [
  {
    name: 'walk',
    row: 0,
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), false),
  },
  {
    name: 'walk_side',
    row: 1,
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_back',
    row: 2,
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), true),
  },
  {
    name: 'vomit',
    row: 3,
    frameCount: VOMIT_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => vomitFacing(shotProgress(f, VOMIT_FRAMES), false),
  },
  {
    name: 'vomit_side',
    row: 4,
    frameCount: VOMIT_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => vomitSide(shotProgress(f, VOMIT_FRAMES)),
  },
  {
    name: 'vomit_back',
    row: 5,
    frameCount: VOMIT_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: (f) => vomitFacing(shotProgress(f, VOMIT_FRAMES), true),
  },
  {
    name: 'idle',
    row: 6,
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => idleFront(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_side',
    row: 6,
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_back',
    row: 7,
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'gore',
    row: 7,
    frameCount: GORE_PIECES.length,
    kind: 'gore',
    view: 'front',
    pose: null,
  },
];

const SHEET_ROWS = Math.max(...SEGMENTS.map((segment) => segment.row)) + 1;

/** Where each state's frames start along its sheet row. */
export function columnOffsetOf(name: string): number {
  let offset = 0;
  for (const segment of SEGMENTS) {
    if (segment.name === name) return offset;
    if (segment.row === segmentByName(name).row) offset += segment.frameCount;
  }
  throw new Error(`no segment named "${name}"`);
}

function segmentByName(name: string): SegmentSpec {
  const found = SEGMENTS.find((segment) => segment.name === name);
  if (found === undefined) throw new Error(`no segment named "${name}"`);
  return found;
}

const SHEET_COLUMNS = (() => {
  const perRow = new Array<number>(SHEET_ROWS).fill(0);
  for (const segment of SEGMENTS) perRow[segment.row] += segment.frameCount;
  return Math.max(...perRow);
})();

// ── Bake ─────────────────────────────────────────────────────────────────────

interface FrameJob {
  readonly segment: SegmentSpec;
  readonly frame: number;
  readonly column: number;
  /**
   * Animation cells anchor on the painter's own origin; gore cells anchor on
   * the centre of the cell, so every piece is measured about the same point.
   */
  readonly anchor: 'origin' | 'cellCentre';
  readonly recentre: { x: number; y: number };
  readonly paint: (ctx: Ctx, originX: number, originY: number) => void;
}

function buildJobs(goreOffsets?: ReadonlyMap<number, { x: number; y: number }>): FrameJob[] {
  const jobs: FrameJob[] = [];
  for (const segment of SEGMENTS) {
    const base = columnOffsetOf(segment.name);
    for (let frame = 0; frame < segment.frameCount; frame++) {
      if (segment.kind === 'gore') {
        const piece = GORE_PIECES[frame];
        if (piece === undefined) throw new Error(`gore piece ${frame} is missing`);
        const recentre = goreOffsets?.get(frame) ?? { x: 0, y: 0 };
        jobs.push({
          segment,
          frame,
          column: base + frame,
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

      const { pose, view } = segment;
      if (pose === null) throw new Error(`segment "${segment.name}" has no pose function`);
      jobs.push({
        segment,
        frame,
        column: base + frame,
        anchor: 'origin',
        recentre: { x: 0, y: 0 },
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          // Scaled about the ground line, which is the origin of figure space,
          // so a taller creature still stands on the tile its feet belong to.
          ctx.scale(HOARDER_SCALE, HOARDER_SCALE);
          drawHoarderView(ctx, view, pose(frame));
          ctx.restore();
        },
      });
    }
  }
  return jobs;
}

/** Alpha above which a pixel counts as painted, when measuring ink extents. */
const INK_ALPHA_THRESHOLD = 24;

interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBoxOf(ctx: Ctx, width: number, height: number): InkBox | null {
  const { data } = ctx.getImageData(0, 0, width, height);
  const ALPHA_OFFSET = 3;
  const CHANNELS = 4;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * CHANNELS + ALPHA_OFFSET;
      if ((data[at] ?? 0) < INK_ALPHA_THRESHOLD) continue;
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
  readonly goreRadius: number;
  readonly goreOffsets: ReadonlyMap<number, { x: number; y: number }>;
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
  const goreOffsets = new Map<number, { x: number; y: number }>();
  const blankFrames: string[] = [];

  for (const job of jobs) {
    ctx.clearRect(0, 0, MEASURE_SIZE, MEASURE_SIZE);
    job.paint(ctx, originX, originY);
    const box = inkBoxOf(ctx, MEASURE_SIZE, MEASURE_SIZE);
    if (box === null) {
      blankFrames.push(`${job.segment.name}[${job.frame}]`);
      continue;
    }

    if (job.anchor === 'cellCentre') {
      const inkCentreX = (box.minX + box.maxX) / 2;
      const inkCentreY = (box.minY + box.maxY) / 2;
      // A severed limb has its mass well off its construction origin, which
      // would leave it drawn to one side of a cell sized for it.
      goreOffsets.set(job.frame, {
        x: job.recentre.x + (originX - inkCentreX) / GORE_UNIT,
        y: job.recentre.y + (originY - inkCentreY) / GORE_UNIT,
      });
      const halfWidth = (box.maxX - box.minX) / 2;
      const halfHeight = (box.maxY - box.minY) / 2;
      goreRadius = Math.max(goreRadius, Math.hypot(halfWidth, halfHeight));
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
  // inscribed circle, so a cell wide enough but not tall enough still clips.
  const goreSpan = (extents.goreRadius + FRAME_PADDING) * 2;
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const frameWidth = roundUpTo(Math.max(halfWidth * 2, goreSpan), FRAME_SIZE_QUANTUM);
  const originY = Math.ceil(extents.up + FRAME_PADDING);
  const frameHeight = roundUpTo(
    Math.max(originY + extents.down + FRAME_PADDING, goreSpan),
    FRAME_SIZE_QUANTUM,
  );
  return {
    frameWidth,
    frameHeight,
    tileX: frameWidth / 2 - TILE_SCALE / 2,
    tileY: originY - GROUND_OFFSET_PX,
  };
}

export interface BakedSheet {
  readonly buffer: Buffer;
  readonly geometry: SheetGeometry;
  readonly columns: number;
  readonly rows: number;
}

/**
 * How much bigger than the animation rows the gore may make every cell.
 * Rotation safety is free — `geometryFor` guarantees it — so this bounds cost,
 * not correctness.
 */
const GORE_AREA_INFLATION_LIMIT = 2;

export function bake(): BakedSheet {
  // Two passes: the first measures where each gore piece's ink actually lands,
  // the second repaints it centred on that measurement.
  const measured = measure(buildJobs());
  const jobs = buildJobs(measured.goreOffsets);
  const extents = measure(jobs);

  if (extents.blankFrames.length > 0) {
    throw new Error(
      'these frames painted nothing, which almost always means a NaN in the pose: ' +
        extents.blankFrames.join(', '),
    );
  }

  const geometry = geometryFor(extents);
  const animationOnly = geometryFor({ ...extents, goreRadius: 0 });
  const animationArea = animationOnly.frameWidth * animationOnly.frameHeight;
  const inflation = (geometry.frameWidth * geometry.frameHeight) / animationArea;
  if (inflation > GORE_AREA_INFLATION_LIMIT) {
    throw new Error(
      `the gore pieces inflate every cell to ${inflation.toFixed(2)}x the area the animation ` +
        `rows need — shrink the longest piece rather than paying for it on all ${SHEET_ROWS} rows`,
    );
  }

  const sheet = createCanvas(
    SHEET_COLUMNS * geometry.frameWidth,
    SHEET_ROWS * geometry.frameHeight,
  );
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  for (const job of jobs) {
    cellCtx.clearRect(0, 0, cell.width, cell.height);
    cellCtx.save();
    cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    const originY =
      job.anchor === 'cellCentre' ? geometry.frameHeight / 2 : geometry.tileY + GROUND_OFFSET_PX;
    job.paint(cellCtx, geometry.frameWidth / 2, originY);
    cellCtx.restore();

    sheetCtx.drawImage(
      cell,
      0,
      0,
      cell.width,
      cell.height,
      job.column * geometry.frameWidth,
      job.segment.row * geometry.frameHeight,
      geometry.frameWidth,
      geometry.frameHeight,
    );
  }

  return {
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry,
    columns: SHEET_COLUMNS,
    rows: SHEET_ROWS,
  };
}

// ── Manifest ─────────────────────────────────────────────────────────────────

const SHEET_PATH = 'src/images/bosses/hoarder.png';
const MANIFEST_PATH = 'src/images/bosses/manifest.json';
const SHEET_KEY = 'hoarder';

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

export function manifestEntryFor(sheet: BakedSheet): ManifestEntry {
  const states: Record<string, ManifestStateEntry> = {};
  for (const segment of SEGMENTS) {
    const colOffset = columnOffsetOf(segment.name);
    if (segment.kind === 'gore') {
      GORE_STATES.forEach((state, index) => {
        states[state] = { row: segment.row, colOffset: colOffset + index, frameCount: 1 };
      });
      continue;
    }
    states[segment.name] =
      colOffset === 0
        ? { row: segment.row, frameCount: segment.frameCount }
        : { row: segment.row, colOffset, frameCount: segment.frameCount };
  }
  return {
    path: 'bosses/hoarder.png',
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

/** Key-order-insensitive comparison, so a reordered manifest is not a failure. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record: Record<string, unknown> = { ...value };
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Compares rather than rewrites. Other agents work in this repo and a
 * programmatic rewrite of a shared file clobbers their edits, so a mismatch
 * prints the entry to paste and fails the run instead.
 */
function verifyManifest(entry: ManifestEntry): void {
  const raw: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${MANIFEST_PATH} did not parse as an object`);
  }
  const entries: Record<string, unknown> = { ...raw };
  const onDisk: unknown = entries[SHEET_KEY];
  if (canonicalJson(onDisk) === canonicalJson(entry)) {
    console.log(`  manifest entry "${SHEET_KEY}" matches the bake`);
    return;
  }
  console.error(
    `\n  the "${SHEET_KEY}" entry in ${MANIFEST_PATH} does not match the bake. Paste this:\n`,
  );
  console.error(`"${SHEET_KEY}": ${JSON.stringify(entry, null, 2)}\n`);
  process.exitCode = 1;
}

const MEGA = 1_000_000;

export function writeSheet(): void {
  const sheet = bake();
  writeFileSync(resolve(SHEET_PATH), sheet.buffer);

  const megapixels =
    (sheet.columns * sheet.geometry.frameWidth * sheet.rows * sheet.geometry.frameHeight) / MEGA;
  console.log(`wrote ${SHEET_PATH}`);
  console.log(
    `  ${sheet.rows} rows x ${sheet.columns} cols of ` +
      `${sheet.geometry.frameWidth}x${sheet.geometry.frameHeight} (${megapixels.toFixed(2)} Mpx)`,
  );
  for (const segment of SEGMENTS) {
    console.log(
      `  row ${segment.row} col ${columnOffsetOf(segment.name)}: ` +
        `${segment.name} (${segment.frameCount}f, ${segment.view})`,
    );
  }
  console.log(`  tileX=${sheet.geometry.tileX} tileY=${sheet.geometry.tileY}`);
  console.log(
    `  she stands ${HOARDER_TILES_TALL} tiles; bile leaves on frame ${VOMIT_RELEASE_FRAME}`,
  );
  console.log(`  leg reach ${LEG_REACH.toFixed(4)} figure units`);
  verifyManifest(manifestEntryFor(sheet));
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheet();
}

export {
  idleBack,
  idleFront,
  idleSide,
  vomitFacing,
  vomitSide,
  walkFacing,
  walkSide,
  cyclePhase,
  shotProgress,
  WALK_FRAMES,
  VOMIT_FRAMES,
  IDLE_FRAMES,
  GORE_UNIT,
  HOARDER_SCALE,
  GROUND_OFFSET_PX,
  SHEET_ROWS,
  SHEET_COLUMNS,
};
