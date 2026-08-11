#!/usr/bin/env tsx
/**
 * Generates The Lich's sprite sheet.
 *
 * The anatomy and the painting live in `scripts/lichArt.ts`; this file is the
 * choreography plus the bake — one pose function per animation row, sampled per
 * frame, then measured, gated and laid out.
 *
 * The row vocabulary is deliberately the Skeleton Lord's, down to the frame
 * counts: the two creatures share a state machine, so a row this sheet did not
 * carry would be a state the runtime could ask for and not get. What differs is
 * everything under the rows — a taller, thinner, closed silhouette instead of an
 * open lit ribcage.
 *
 * Frame geometry is measured rather than declared. A summon throws both hands
 * most of a tile above the crown and the cast reaches the same distance forward,
 * so a hand-guessed cell is exactly how a claw ends up sheared flat in the PNG.
 *
 * Run: npm run gen:lich
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  type ArmAngles,
  type SkeletonPose,
  TWO_PI,
  clamp01,
  deg,
  easeInOut,
  easeOut,
  hump,
  lerp,
  ramp,
  restingPose,
  rgba,
} from './skeletonArt.js';
import {
  LICH_ARM_LENGTH,
  LICH_CLOTH,
  LICH_FIGURE_HEIGHT,
  LICH_OUTLINE,
  LICH_RIM_EDGE,
  LICH_SHOULDER_JOINT_DROP,
  LICH_SHOULDER_Y,
  drawLichBack,
  drawLichContactShadow,
  drawLichFront,
  drawLichSide,
  lichLateralFor,
  lichLegReachHeadroom,
  type LichView,
} from './lichArt.js';
import { SKELETON_GORE_STATES, skeletonGorePieces } from './skeletonGore.js';
// The release fraction is shared with the runtime rather than copied here, so
// the thrust cannot drift away from the frame the bolt is queued on.
import {
  SOUL_BOLT_RELEASE_PROGRESS,
  SOUL_BOLT_THRUST_SHARE,
} from '../src/sprites/skeletonTiming.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** Clear pixels kept between the furthest ink and the frame edge. */
const FRAME_PADDING = 6;
/** Frame dimensions are rounded up to this so the sheet stays tidily aligned. */
const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;

/**
 * How tall the Lich stands, applied at bake time about its own ground line.
 *
 * Half a tile over the Skeleton Lord's 2.5. The rig is authored once at
 * {@link LICH_FIGURE_HEIGHT} and scaled here rather than re-proportioned:
 * scaling the anatomy tables instead would leave the choreography and the gore
 * at the original size and silently redraw the animation.
 */
const LICH_HEIGHT_TILES = 2.68;

const WALK_FRAMES = 12;
const IDLE_FRAMES = 8;
const CAST_FRAMES = 10;
const HANDS_FRAMES = 10;
const SUMMON_FRAMES = 10;

// ── Pose helpers ─────────────────────────────────────────────────────────────

function pt(x: number, y: number): { x: number; y: number } {
  return { x, y };
}

/** Where a relaxed hand hangs, measured from the shoulder joint rather than the line. */
const HAND_HANG_Y = LICH_SHOULDER_Y + LICH_SHOULDER_JOINT_DROP + LICH_ARM_LENGTH * 0.99;
const HAND_HANG_SPREAD = 0.25;
/** Where the feet rest, matching the reach the leg solver actually has. */
const RESTING_FOOT_SPREAD = 0.115;

/**
 * The Skeleton Lord's resting pose with the Lich's own reach substituted in.
 *
 * The shared pose type carries absolute hand targets, and the Lich's shoulder
 * sits a fraction higher than the Lord's — so the inherited resting hands are
 * further from the joint than the arm is long, and every pose that did not
 * override them would solve to a clamped, locked-straight arm.
 */
function lichRestingPose(): SkeletonPose {
  return {
    ...restingPose(),
    leftHand: pt(-HAND_HANG_SPREAD, HAND_HANG_Y),
    rightHand: pt(HAND_HANG_SPREAD, HAND_HANG_Y),
    leftFoot: pt(-RESTING_FOOT_SPREAD, 0),
    rightFoot: pt(RESTING_FOOT_SPREAD, 0),
  };
}

/** Share of a stride a foot spends in the air. */
const SWING_SHARE = 0.4;
const STRIDE = 0.15;
const FOOT_LIFT = 0.07;
/**
 * How far the pelvis drops at contact.
 *
 * It drops rather than rising at mid-stance — which is what a real pelvis does,
 * and the only way a leg nearly as long as the hip is high can reach a foot
 * planted a full stride ahead without the IK clamping. A stride that clamps on
 * even one frame reads as a hop, and the bake gate measures it.
 */
const WALK_BOB = 0.04;

/**
 * The pelvis is at its lowest on the frame a foot *plants*, which is the moment
 * the swing ends. Phased against anything else the drop fights the stride
 * instead of paying for it.
 */
function gaitBob(phase: number): number {
  return WALK_BOB * (0.5 + 0.5 * Math.cos(TWO_PI * 2 * (phase - SWING_SHARE)));
}

interface Step {
  readonly dx: number;
  readonly lift: number;
}

function gaitStep(phase: number): Step {
  const cycle = ((phase % 1) + 1) % 1;
  const swinging = cycle < SWING_SHARE;
  const t = swinging ? cycle / SWING_SHARE : (cycle - SWING_SHARE) / (1 - SWING_SHARE);
  const dx = swinging ? lerp(-STRIDE, STRIDE, easeInOut(t)) : lerp(STRIDE, -STRIDE, t);
  return { dx, lift: swinging ? hump(t) : 0 };
}

/**
 * A walking arm, driven from joint angles.
 *
 * Nearly all of a walking arm's travel belongs to the shoulder; the elbow only
 * holds a bend. Solved from a hand target instead, both segments sweep together
 * and the forearm flails — so this is FK and stays FK.
 */
const ARM_REST_TILT = deg(5);
const ARM_ELBOW_BREAK = deg(8);
/** Arms swing further forward than back. */
const ARM_FORWARD_SHARE = 0.55;
const SIDE_UPPER_SWING = deg(19);
const SIDE_FOREARM_SWING = deg(10);
/**
 * Head-on the upper arm is nearly end-on and shows almost nothing; the forearm
 * carries what travel there is, and the depth of the swing is sold by drawing
 * the forearm shorter as it turns out of the picture plane.
 */
const FACING_UPPER_SWING = deg(4);
const FACING_FOREARM_SWING = deg(10);
const FACING_FORE_SCALE_MIN = 0.86;

function swingShare(raw: number): number {
  return raw >= 0 ? raw * ARM_FORWARD_SHARE * 2 : raw * (1 - ARM_FORWARD_SHARE) * 2;
}

function sideArm(phase: number, side: number): ArmAngles {
  const swing = swingShare(Math.sin(phase * TWO_PI) * side);
  return {
    upper: ARM_REST_TILT + SIDE_UPPER_SWING * swing,
    fore: ARM_REST_TILT - ARM_ELBOW_BREAK + SIDE_FOREARM_SWING * swing,
    foreScale: 1,
  };
}

function facingArm(phase: number, side: number): ArmAngles {
  const swing = swingShare(Math.sin(phase * TWO_PI) * side);
  return {
    upper: ARM_REST_TILT + FACING_UPPER_SWING * swing,
    fore: ARM_REST_TILT - ARM_ELBOW_BREAK + FACING_FOREARM_SWING * swing,
    // Foreshortening comes off the size of the swing, not off its sign: the arm
    // is shortest at both ends of the travel and longest across the hip.
    foreScale: lerp(FACING_FORE_SCALE_MIN, 1, 1 - Math.abs(swing)),
  };
}

// ── Walk ─────────────────────────────────────────────────────────────────────

/**
 * The Lich does not stride, it *stalks* — a long slow step with the robe
 * trailing a beat behind it and the hood barely moving. The head lolls far less
 * than the Skeleton Lord's does: his loose skull is the joke, and this thing is
 * meant to read as composed enough to have been signing letters for weeks.
 */
const WALK_HEAD_LOLL = deg(2);

function walkSide(phase: number): SkeletonPose {
  const angle = phase * TWO_PI;
  const left = gaitStep(phase);
  const right = gaitStep(phase + 0.5);
  return {
    ...lichRestingPose(),
    bob: gaitBob(phase),
    lean: deg(3),
    leftFoot: pt(left.dx, -left.lift * FOOT_LIFT),
    rightFoot: pt(right.dx, -right.lift * FOOT_LIFT),
    leftFootPitch: deg(16) * left.lift,
    rightFootPitch: deg(16) * right.lift,
    leftArmAngles: sideArm(phase, -1),
    rightArmAngles: sideArm(phase, 1),
    leftClaw: 0.4,
    rightClaw: 0.4,
    headTilt: WALK_HEAD_LOLL * Math.sin(angle),
    jaw: 0.12 + 0.05 * Math.sin(angle * 2),
    robeFlare: 0.5 + 0.22 * Math.sin(angle),
    robeSway: -Math.sin(angle),
    glow: 0.45 + 0.2 * Math.sin(angle),
    time: phase,
  };
}

/** Head-on a step is a lift and a plant, not a stride — there is no reach to show. */
const FACING_TRACK_IN = 0.02;

function walkFront(phase: number): SkeletonPose {
  const angle = phase * TWO_PI;
  const left = gaitStep(phase);
  const right = gaitStep(phase + 0.5);
  return {
    ...lichRestingPose(),
    bob: gaitBob(phase),
    sway: 0.02 * Math.sin(angle),
    leftFoot: pt(-RESTING_FOOT_SPREAD + FACING_TRACK_IN * left.lift, -left.lift * FOOT_LIFT),
    rightFoot: pt(RESTING_FOOT_SPREAD - FACING_TRACK_IN * right.lift, -right.lift * FOOT_LIFT),
    leftFootPitch: deg(13) * left.lift,
    rightFootPitch: deg(13) * right.lift,
    // Head-on a knee has no direction to break into, so both legs are pulled
    // fully onto their hip→ankle lines. A bow that shows on one leg and not the
    // other flickers once per step and reads as a wiggle.
    leftForeshorten: 1,
    rightForeshorten: 1,
    leftArmAngles: facingArm(phase, -1),
    rightArmAngles: facingArm(phase, 1),
    leftClaw: 0.4,
    rightClaw: 0.4,
    headTilt: WALK_HEAD_LOLL * Math.sin(angle),
    headTurn: 0.08 * Math.sin(angle),
    jaw: 0.12 + 0.05 * Math.sin(angle * 2),
    robeFlare: 0.5 + 0.2 * Math.sin(angle),
    robeSway: Math.sin(angle) * 0.6,
    glow: 0.45 + 0.2 * Math.sin(angle),
    time: phase,
  };
}

function walkBack(phase: number): SkeletonPose {
  const front = walkFront(phase);
  return {
    ...front,
    // Seen from behind the same body sways the other way on screen, and both
    // arms spend the cycle behind the robe rather than in front of it.
    sway: -front.sway,
    headTurn: -front.headTurn,
    leftArmBehind: true,
    rightArmBehind: true,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/** The Lich hovers: a slow vertical drift with the robe settling under it. */
const IDLE_DRIFT = 0.03;

function idleBase(phase: number): SkeletonPose {
  const angle = phase * TWO_PI;
  const rest = lichRestingPose();
  // A hovering figure lifts its feet with it. Left on the floor while the hips
  // rise, the legs simply stretch — the IK clamps them straight and the drift
  // reads as the pelvis sliding up a pair of stilts.
  const drift = -IDLE_DRIFT * (0.5 + 0.5 * Math.sin(angle));
  return {
    ...rest,
    bob: drift,
    leftFoot: pt(rest.leftFoot.x, rest.leftFoot.y + drift),
    rightFoot: pt(rest.rightFoot.x, rest.rightFoot.y + drift),
    lean: deg(1.5) * Math.sin(angle * 0.5),
    headTilt: deg(2.5) * Math.sin(angle * 0.5),
    // The jaw works constantly. It is the only moving part of the face, and the
    // cue that separates a standing Lich from a coat on a hook.
    jaw: 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(angle * 2)),
    leftHand: pt(-HAND_HANG_SPREAD, HAND_HANG_Y + 0.012 * Math.sin(angle)),
    rightHand: pt(HAND_HANG_SPREAD, HAND_HANG_Y + 0.012 * Math.sin(angle + 1)),
    leftClaw: 0.5 + 0.25 * Math.sin(angle * 1.5),
    rightClaw: 0.5 + 0.25 * Math.sin(angle * 1.5 + 2),
    robeFlare: 0.28 + 0.12 * Math.sin(angle),
    robeSway: 0.4 * Math.sin(angle * 0.5),
    glow: 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(angle)),
    time: phase,
  };
}

function idleFront(phase: number): SkeletonPose {
  return {
    ...idleBase(phase),
    headTurn: 0.14 * Math.sin(phase * TWO_PI * 0.5),
    leftForeshorten: 1,
    rightForeshorten: 1,
  };
}

/**
 * How far apart the feet stand fore-and-aft when seen edge-on.
 *
 * Every pose inherits a head-on stance of ±0.115, which edge-on stops being
 * width and becomes a quarter-tile of *depth* — and a leg is barely longer than
 * the hip is high, so that alone stretches both of them past their reach. Any
 * profile pose that does not author its own stride has to say so.
 */
const PROFILE_FOOT_STAGGER = 0.045;

function facingStance(lift = 0): Pick<SkeletonPose, 'leftFoot' | 'rightFoot'> {
  return {
    leftFoot: pt(-RESTING_FOOT_SPREAD, lift),
    rightFoot: pt(RESTING_FOOT_SPREAD, lift),
  };
}

function profileStance(lead = 0, lift = 0): Pick<SkeletonPose, 'leftFoot' | 'rightFoot'> {
  return {
    leftFoot: pt(-PROFILE_FOOT_STAGGER + lead, lift),
    rightFoot: pt(PROFILE_FOOT_STAGGER + lead, lift),
  };
}

/**
 * Where the two hands hang edge-on, where +X is *forward* rather than outboard.
 *
 * A profile collapses both shoulder joints onto very nearly one point, so how
 * far apart the hands are is how far the two arms fan from that point. Hung on
 * the centreline the two sleeves stack into one bone with two claws round it;
 * hung back past the spine they clear the robe and the negative space between
 * arm and body finally shows in the view a chasing mob spends its life in.
 */
const BARE_OFF_HAND_BACK = -0.04;
const BARE_WEAPON_HAND_BACK = -0.11;
/** How far behind vertical a hanging arm sits edge-on, clear of the robe. */
const PROFILE_ARM_HANG_BACK = deg(-12);

function idleSide(phase: number): SkeletonPose {
  const angle = phase * TWO_PI;
  const base = idleBase(phase);
  // Driven from joint angles rather than hand targets: solved from a target, the
  // elbow flare bows the two arms in opposite *screen* directions, which head-on
  // holds them off the robe and edge-on throws one forward and one back into a
  // diagonal X across the chest.
  const hangAngles: ArmAngles = {
    upper: PROFILE_ARM_HANG_BACK,
    fore: PROFILE_ARM_HANG_BACK - deg(4),
    foreScale: 1,
  };
  return {
    ...base,
    lean: deg(2),
    ...profileStance(0, base.leftFoot.y),
    leftHand: pt(BARE_OFF_HAND_BACK, base.leftHand.y),
    rightHand: pt(BARE_WEAPON_HAND_BACK, base.rightHand.y),
    leftArmAngles: hangAngles,
    rightArmAngles: { ...hangAngles, upper: hangAngles.upper + deg(4) * Math.sin(angle) },
  };
}

function idleBack(phase: number): SkeletonPose {
  return {
    ...idleFront(phase),
    headTurn: -0.1 * Math.sin(phase * TWO_PI * 0.5),
    leftArmBehind: true,
    rightArmBehind: true,
  };
}

// ── Soul-bolt cast ───────────────────────────────────────────────────────────

/**
 * The thrust window, derived from the shared release fraction rather than
 * declared: the bolt leaves at the middle of the thrust, so putting the thrust
 * anywhere else would fire it on a frame where the arm has not moved yet.
 */
const CAST_FOOT_LEAD = 0.05;
const CAST_GATHER_END = SOUL_BOLT_RELEASE_PROGRESS - SOUL_BOLT_THRUST_SHARE / 2;
const CAST_THRUST_END = SOUL_BOLT_RELEASE_PROGRESS + SOUL_BOLT_THRUST_SHARE / 2;
/** When the witch-light first shows in the palm — early enough to be a warning. */
const CAST_CHARGE_START = 0.05;

interface CastPhases {
  /** The arm drawing back and the light condensing in the palm. */
  readonly gather: number;
  /** The forward thrust that launches the bolt. */
  readonly thrust: number;
  readonly recover: number;
  /** How much light is showing in the palm right now. */
  readonly charge: number;
}

function castPhases(progress: number): CastPhases {
  return {
    gather: easeInOut(ramp(progress, 0, CAST_GATHER_END)),
    thrust: easeInOut(ramp(progress, CAST_GATHER_END, CAST_THRUST_END)),
    recover: easeInOut(ramp(progress, CAST_THRUST_END, 1)),
    // The charge has to be gone the instant the thrust launches it, or the glow
    // stops being a usable warning and becomes decoration.
    charge:
      clamp01(ramp(progress, CAST_CHARGE_START, CAST_GATHER_END)) *
      (1 - clamp01(ramp(progress, CAST_GATHER_END, SOUL_BOLT_RELEASE_PROGRESS))),
  };
}

function castSide(progress: number): SkeletonPose {
  const s = castPhases(progress);
  const drive = s.thrust * (1 - s.recover);
  // The coil has to unwind on the recovery as well as be overridden by the
  // thrust: left as a bare `gather`, every value is still at full draw-back on
  // the last frame and the row snaps to rest the moment it stops playing.
  const coil = s.gather * (1 - s.recover);
  return {
    ...lichRestingPose(),
    lean: deg(-5) * coil + deg(9) * drive,
    bob: 0.012 * coil + 0.006 * drive,
    crouch: 0.07 * coil,
    ...profileStance(CAST_FOOT_LEAD * drive),
    // Drawn back beside the ribs rather than up beside the hood: at head height
    // the condensing light sits inside the cowl and the two eye points and the
    // palm become one green blob.
    rightHand: pt(
      lerp(HAND_HANG_SPREAD, -0.15, coil) + 0.62 * drive,
      lerp(HAND_HANG_Y, LICH_SHOULDER_Y + 0.2, coil) + 0.06 * drive,
    ),
    leftHand: pt(-0.25 - 0.05 * coil, HAND_HANG_Y - 0.05 * coil),
    rightClaw: lerp(0.35, 1, coil) * (1 - drive * 0.5),
    leftClaw: 0.8,
    rightPalmGlow: s.charge,
    headTilt: deg(-5) * coil + deg(8) * drive,
    jaw: 0.15 + 0.55 * coil,
    robeFlare: 0.3 + 0.5 * drive,
    robeSway: -coil + drive,
    glow: 0.4 + 0.6 * Math.max(coil, drive),
    time: progress,
  };
}

function castFront(progress: number): SkeletonPose {
  const s = castPhases(progress);
  const drive = s.thrust * (1 - s.recover);
  const coil = s.gather * (1 - s.recover);
  return {
    ...castSide(progress),
    ...facingStance(),
    lean: deg(2) * drive,
    // Head-on there is no forward reach to show, so the thrust is sold by the
    // arm coming *toward* the camera: the hand drops down the screen and the
    // light grows instead of travelling.
    rightHand: pt(
      lerp(HAND_HANG_SPREAD, 0.2, coil),
      lerp(HAND_HANG_Y, LICH_SHOULDER_Y + 0.16, coil) + 0.13 * drive,
    ),
    leftHand: pt(-HAND_HANG_SPREAD, HAND_HANG_Y - 0.04 * coil),
    leftForeshorten: 1,
    rightForeshorten: 1,
    headTilt: 0,
    headTurn: 0.1 * drive,
  };
}

function castBack(progress: number): SkeletonPose {
  return {
    ...castFront(progress),
    // From behind the light is on the far side of the body and mostly hidden;
    // the read is the shoulder driving forward and the robe flaring.
    leftArmBehind: true,
    rightArmBehind: false,
    headTurn: 0,
  };
}

// ── Grasping hands ───────────────────────────────────────────────────────────

/**
 * The wind-up for the ground attack: both arms sweep low and out, the robe
 * flares, and the witch-light drops to the hem. A red cone telegraph runs on top
 * of this the whole time it plays, so the pose has to read as *committed* — a
 * player who thinks the thing might still be deciding will not move.
 */
const HANDS_SWEEP_END = 0.62;
const HANDS_SLAM_END = 0.85;

function handsCastSide(progress: number): SkeletonPose {
  const sweep = easeInOut(ramp(progress, 0.08, HANDS_SWEEP_END));
  const slam = easeOut(ramp(progress, HANDS_SWEEP_END, HANDS_SLAM_END));
  const settle = easeInOut(ramp(progress, HANDS_SLAM_END, 1));
  const commit = sweep * (1 - settle);
  return {
    ...lichRestingPose(),
    crouch: 0.28 * commit + 0.14 * slam,
    lean: deg(15) * commit,
    bob: 0.02 * commit,
    ...profileStance(),
    leftHand: pt(-0.32 - 0.13 * commit, HAND_HANG_Y + 0.16 * commit + 0.05 * slam),
    rightHand: pt(0.32 + 0.19 * commit, HAND_HANG_Y + 0.16 * commit + 0.05 * slam),
    leftClaw: 1,
    rightClaw: 1,
    leftPalmGlow: commit * 0.9,
    rightPalmGlow: commit * 0.9,
    elbowFlare: 0.6,
    headTilt: deg(11) * commit,
    jaw: 0.2 + 0.7 * commit,
    robeFlare: 0.25 + 0.75 * commit,
    robeSway: 0.3 * Math.sin(progress * TWO_PI),
    glow: 0.5 + 0.5 * commit,
    time: progress,
  };
}

function handsCastFront(progress: number): SkeletonPose {
  return {
    ...handsCastSide(progress),
    ...facingStance(),
    lean: deg(5) * easeInOut(ramp(progress, 0.08, HANDS_SWEEP_END)),
    leftForeshorten: 1,
    rightForeshorten: 1,
  };
}

function handsCastBack(progress: number): SkeletonPose {
  // Both arms sweep low and out in front, so from behind both are on the far
  // side of the trunk. Left unset, this row bakes identical to the front one and
  // the away-facing wind-up shows the arms on the near side of the robe.
  return { ...handsCastFront(progress), leftArmBehind: true, rightArmBehind: true };
}

// ── Summon ───────────────────────────────────────────────────────────────────

/**
 * Both hands thrown overhead with a sustained flare.
 *
 * Baked in one facing only. Every other row reads from four directions, but this
 * one is a held, symmetrical, arms-overhead pose: mirrored to profile it is two
 * sleeves drawn on top of each other, and from behind it is a robe with nothing
 * happening above it. A single camera-facing row is both the clearest read and
 * the honest one — the creature turns to face the party before it summons, which
 * is what a summon is for.
 */
const SUMMON_LIFT = 0.05;
const SUMMON_RAISE_END = 0.35;
const SUMMON_HOLD_END = 0.78;
/** Cycles of flare across the hold — fast enough to flicker, slow enough to see. */
const SUMMON_FLARE_CYCLES = 3;

function summonFront(progress: number): SkeletonPose {
  const raise = easeOut(ramp(progress, 0, SUMMON_RAISE_END));
  const drop = easeInOut(ramp(progress, SUMMON_HOLD_END, 1));
  const held = raise * (1 - drop);
  const flare = 0.5 + 0.5 * Math.sin(progress * TWO_PI * SUMMON_FLARE_CYCLES);
  const overhead = LICH_SHOULDER_Y - LICH_ARM_LENGTH * 0.86;
  return {
    ...lichRestingPose(),
    lean: deg(-7) * held,
    // It rises off the floor on the flare, feet and all — the one moment the
    // Lich is unambiguously not walking.
    bob: -SUMMON_LIFT * held,
    leftFoot: pt(-RESTING_FOOT_SPREAD, -SUMMON_LIFT * held),
    rightFoot: pt(RESTING_FOOT_SPREAD, -SUMMON_LIFT * held),
    leftHand: pt(-0.32 - 0.08 * held, lerp(HAND_HANG_Y, overhead, held)),
    rightHand: pt(0.32 + 0.08 * held, lerp(HAND_HANG_Y, overhead, held)),
    leftClaw: 1,
    rightClaw: 1,
    leftPalmGlow: held * lerp(0.7, 1, flare),
    rightPalmGlow: held * lerp(0.7, 1, flare),
    elbowFlare: -0.4,
    headTilt: deg(-9) * held,
    jaw: 0.2 + 0.75 * held,
    leftForeshorten: 1,
    rightForeshorten: 1,
    robeFlare: 0.3 + 0.5 * held,
    glow: 0.5 + 0.5 * held * lerp(0.6, 1, flare),
    time: progress,
  };
}

// ── Row manifest ─────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: LichView;
  /** Null on the gore row, whose cells are pieces rather than poses. */
  readonly pose: ((frame: number) => SkeletonPose) | null;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const GORE_ROW: RowSpec = {
  name: 'gore',
  frameCount: SKELETON_GORE_STATES.length,
  kind: 'gore',
  view: 'side',
  pose: null,
};

function lichRows(): RowSpec[] {
  return [
    {
      name: 'walk',
      frameCount: WALK_FRAMES,
      kind: 'loop',
      view: 'front',
      pose: (f) => walkFront(cyclePhase(f, WALK_FRAMES)),
    },
    {
      name: 'walk_side',
      frameCount: WALK_FRAMES,
      kind: 'loop',
      view: 'side',
      pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES)),
    },
    {
      name: 'walk_away',
      frameCount: WALK_FRAMES,
      kind: 'loop',
      view: 'back',
      pose: (f) => walkBack(cyclePhase(f, WALK_FRAMES)),
    },
    {
      name: 'idle',
      frameCount: IDLE_FRAMES,
      kind: 'loop',
      view: 'front',
      pose: (f) => idleFront(cyclePhase(f, IDLE_FRAMES)),
    },
    {
      name: 'idle_side',
      frameCount: IDLE_FRAMES,
      kind: 'loop',
      view: 'side',
      pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES)),
    },
    {
      name: 'idle_away',
      frameCount: IDLE_FRAMES,
      kind: 'loop',
      view: 'back',
      pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES)),
    },
    {
      name: 'cast',
      frameCount: CAST_FRAMES,
      kind: 'oneShot',
      view: 'front',
      pose: (f) => castFront(shotProgress(f, CAST_FRAMES)),
    },
    {
      name: 'cast_side',
      frameCount: CAST_FRAMES,
      kind: 'oneShot',
      view: 'side',
      pose: (f) => castSide(shotProgress(f, CAST_FRAMES)),
    },
    {
      name: 'cast_away',
      frameCount: CAST_FRAMES,
      kind: 'oneShot',
      view: 'back',
      pose: (f) => castBack(shotProgress(f, CAST_FRAMES)),
    },
    {
      name: 'hands_cast',
      frameCount: HANDS_FRAMES,
      kind: 'oneShot',
      view: 'front',
      pose: (f) => handsCastFront(shotProgress(f, HANDS_FRAMES)),
    },
    {
      name: 'hands_cast_side',
      frameCount: HANDS_FRAMES,
      kind: 'oneShot',
      view: 'side',
      pose: (f) => handsCastSide(shotProgress(f, HANDS_FRAMES)),
    },
    {
      name: 'hands_cast_away',
      frameCount: HANDS_FRAMES,
      kind: 'oneShot',
      view: 'back',
      pose: (f) => handsCastBack(shotProgress(f, HANDS_FRAMES)),
    },
    {
      name: 'summon',
      frameCount: SUMMON_FRAMES,
      kind: 'oneShot',
      view: 'front',
      pose: (f) => summonFront(shotProgress(f, SUMMON_FRAMES)),
    },
    GORE_ROW,
  ];
}

export interface SheetSpec {
  /** Manifest key and PNG basename. */
  readonly key: string;
  readonly rows: readonly RowSpec[];
}

export const LICH_SHEET: SheetSpec = { key: 'the_lich', rows: lichRows() };

export function sheetPathFor(key: string): string {
  return `src/images/enemies/${key}.png`;
}

const MANIFEST_PATH = 'src/images/enemies/manifest.json';

// ── Gore ─────────────────────────────────────────────────────────────────────

/**
 * The Lich comes apart into the same seven bones a skeleton does — it is one
 * under the robe — with a scrap of its own wool still hanging off two of them.
 *
 * The scraps go on the skull and the forearm because those are the two pieces
 * the cloth was actually wrapped round, and they are drawn *behind* the bone and
 * reaching past one edge of it: over the top they would cover the very outline
 * the piece has to be named from.
 */
const SCRAP_PIECES: ReadonlyArray<string> = ['gore_skull', 'gore_forearm'];
const SCRAP_REACH = 0.24;
const SCRAP_TATTER_COUNT = 4;
const SCRAP_OUTLINE_BLEED = 0.012;

function paintClothScrap(ctx: Ctx, seed: number): void {
  const trace = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(-SCRAP_REACH * 0.2 - grow, -SCRAP_REACH * 0.5 - grow);
    ctx.quadraticCurveTo(
      SCRAP_REACH * 0.9 + grow,
      -SCRAP_REACH * 0.3,
      SCRAP_REACH + grow,
      SCRAP_REACH * 0.3 + grow,
    );
    for (let i = SCRAP_TATTER_COUNT; i >= 0; i--) {
      const t = i / SCRAP_TATTER_COUNT;
      const notch = ((seed + i * 7) % 5) / 4;
      ctx.lineTo(
        lerp(-SCRAP_REACH * 0.3, SCRAP_REACH, t),
        SCRAP_REACH * (0.28 + notch * 0.34) + grow,
      );
    }
    ctx.closePath();
  };
  trace(SCRAP_OUTLINE_BLEED);
  ctx.fillStyle = LICH_OUTLINE;
  ctx.fill();
  trace(0);
  ctx.fillStyle = LICH_CLOTH.mid;
  ctx.fill();
  ctx.fillStyle = rgba(LICH_CLOTH.rim, 0.4);
  ctx.fillRect(-SCRAP_REACH * 0.2, -SCRAP_REACH * 0.45, SCRAP_REACH * 0.9, SCRAP_REACH * 0.12);
}

// ── Bake ─────────────────────────────────────────────────────────────────────

interface Pt {
  readonly x: number;
  readonly y: number;
}

interface FrameJob {
  readonly row: RowSpec;
  readonly frame: number;
  /**
   * Animation cells anchor on the painter's own origin; gore cells anchor on the
   * centre of the cell, so every piece is measured and laid out about the same
   * point.
   */
  readonly anchor: 'origin' | 'cellCentre';
  /**
   * Paints one cell into `target`.
   *
   * A whole canvas rather than a context, and an explicit `pixelsPerTile`
   * rather than a pre-scaled transform, because the edge light is built by
   * dilating the finished figure's own alpha — which needs a scratch canvas the
   * size of the one being painted into and a rim reach in real pixels.
   */
  readonly paint: (target: Canvas, originX: number, originY: number, pixelsPerTile: number) => void;
}

/**
 * How far the edge light reaches past the silhouette, in tile units.
 *
 * Sized against the *game* tile, not the sheet: the art is authored at a 64 px
 * tile and drawn at 32, so a rim that looks like a crisp pixel on the sheet is
 * half a pixel in play and simply is not there.
 */
const RIM_REACH_TILES = 0.026;
/** Directions sampled round the silhouette when dilating it. */
const RIM_DILATE_SAMPLES = 16;
/** Peak opacity of the edge light, on the side it arrives from. */
const RIM_ALPHA = 0.72;
/** What is left of it on the far side, so the silhouette never closes entirely. */
const RIM_FAR_SIDE_SHARE = 0.12;
/**
 * Unit vector the rim light arrives from, opposite the key light every other
 * prop in this repo is lit by. A rim that glows evenly all the way round is not
 * a light, it is an outline — and an outline in this colour is a neon sign.
 */
const RIM_FROM = { x: 0.62, y: 0.78 };
/**
 * Alpha at which a pixel counts as part of the silhouette to be dilated.
 *
 * The figure carries soft radial glows at the palms and the eyes, and dilating
 * those along with the solid forms hands the creature a second bright ring out
 * at each glow's own radius with nothing casting it.
 */
const RIM_MASK_CUTOFF = 128;

/**
 * Paints the figure with one cold edge light laid round its finished outline.
 *
 * The silhouette is thresholded to a hard mask, dilated by sampling a ring of
 * offsets, punched back out with its own mask to leave a halo, and then faded
 * across so the light reads as coming from one side. Applied per form instead —
 * which is what this file did first — every internal seam gets an edge and the
 * creature reads as a wireframe.
 */
function paintWithEdgeLight(target: Canvas, rimPx: number, paintFigure: (ctx: Ctx) => void): void {
  const figure = createCanvas(target.width, target.height);
  paintFigure(figure.getContext('2d'));

  const mask = createCanvas(target.width, target.height);
  const maskCtx = mask.getContext('2d');
  maskCtx.drawImage(figure, 0, 0);
  const image = maskCtx.getImageData(0, 0, mask.width, mask.height);
  const { data } = image;
  for (let i = 0; i < data.length; i += CHANNELS) {
    const solid = data[i + ALPHA_OFFSET] >= RIM_MASK_CUTOFF;
    data[i] = RIM_RGB.r;
    data[i + 1] = RIM_RGB.g;
    data[i + 2] = RIM_RGB.b;
    data[i + ALPHA_OFFSET] = solid ? MAX_ALPHA : 0;
  }
  maskCtx.putImageData(image, 0, 0);

  const halo = createCanvas(target.width, target.height);
  const haloCtx = halo.getContext('2d');
  for (let i = 0; i < RIM_DILATE_SAMPLES; i++) {
    const angle = (i / RIM_DILATE_SAMPLES) * TWO_PI;
    haloCtx.drawImage(mask, Math.cos(angle) * rimPx, Math.sin(angle) * rimPx);
  }
  haloCtx.globalCompositeOperation = 'destination-out';
  haloCtx.drawImage(mask, 0, 0);

  haloCtx.globalCompositeOperation = 'destination-in';
  const reach = Math.hypot(target.width, target.height) / 2;
  const centreX = target.width / 2;
  const centreY = target.height / 2;
  const fade = haloCtx.createLinearGradient(
    centreX + RIM_FROM.x * reach,
    centreY + RIM_FROM.y * reach,
    centreX - RIM_FROM.x * reach,
    centreY - RIM_FROM.y * reach,
  );
  fade.addColorStop(0, rgba('#ffffff', 1));
  fade.addColorStop(1, rgba('#ffffff', RIM_FAR_SIDE_SHARE));
  haloCtx.fillStyle = fade;
  haloCtx.fillRect(0, 0, halo.width, halo.height);

  const ctx = target.getContext('2d');
  ctx.save();
  ctx.globalAlpha = RIM_ALPHA;
  ctx.drawImage(halo, 0, 0);
  ctx.restore();
  ctx.drawImage(figure, 0, 0);
}

/**
 * The loose bones are the skeleton warrior's, drawn at their own tile-unit sizes
 * and scaled by the figure like the figure is — without this the Lich's bones
 * would come out the size a 1.55-tile warrior's are.
 */
const GORE_VARIANT = 'sword' as const;

function buildJobs(spec: SheetSpec, goreOffsets?: ReadonlyMap<number, Pt>): FrameJob[] {
  const jobs: FrameJob[] = [];
  const figureScale = LICH_HEIGHT_TILES / LICH_FIGURE_HEIGHT;
  const pieces = skeletonGorePieces(GORE_VARIANT);

  for (const row of spec.rows) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      if (row.kind === 'gore') {
        const piece = pieces[frame];
        const recentre = goreOffsets?.get(frame) ?? { x: 0, y: 0 };
        jobs.push({
          row,
          frame,
          anchor: 'cellCentre',
          paint: (target, originX, originY, pixelsPerTile) => {
            const goreUnit = pixelsPerTile * figureScale;
            const ctx = target.getContext('2d');
            ctx.save();
            ctx.translate(originX + recentre.x * goreUnit, originY + recentre.y * goreUnit);
            ctx.scale(goreUnit, goreUnit);
            if (SCRAP_PIECES.includes(piece.state)) paintClothScrap(ctx, frame);
            piece.paint(ctx);
            ctx.restore();
          },
        });
        continue;
      }

      const { pose, view } = row;
      if (pose === null) throw new Error(`row "${row.name}" is not gore but has no pose function`);
      jobs.push({
        row,
        frame,
        anchor: 'origin',
        paint: (target, originX, originY, pixelsPerTile) => {
          const posed = pose(frame);
          const place = (ctx: Ctx): void => {
            ctx.translate(originX, originY);
            // Scaled about the ground line, so the taller figure still stands on
            // the tile its feet belong to rather than floating above it.
            ctx.scale(pixelsPerTile * figureScale, pixelsPerTile * figureScale);
          };
          // The shadow is on the floor, not on the figure, so it is laid down
          // before the edge light is built and never dilated into a halo.
          const shadowCtx = target.getContext('2d');
          shadowCtx.save();
          place(shadowCtx);
          drawLichContactShadow(shadowCtx, posed);
          shadowCtx.restore();

          paintWithEdgeLight(target, RIM_REACH_TILES * pixelsPerTile, (ctx) => {
            ctx.save();
            place(ctx);
            if (view === 'front') drawLichFront(ctx, posed);
            else if (view === 'back') drawLichBack(ctx, posed);
            else drawLichSide(ctx, posed);
            ctx.restore();
          });
        },
      });
    }
  }
  return jobs;
}

/** Alpha above which a pixel counts as painted, when measuring ink extents. */
const INK_ALPHA_THRESHOLD = 24;
const MAX_ALPHA = 255;
/** Scratch canvas for measurement; comfortably larger than any cell can be. */
const MEASURE_SIZE = 480;

interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const ALPHA_OFFSET = 3;
const CHANNELS = 4;

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
  readonly goreRadius: number;
  readonly goreOffsets: ReadonlyMap<number, Pt>;
  /** Frames that painted nothing — the signature of a NaN in a pose. */
  readonly blankFrames: readonly string[];
}

function measure(jobs: readonly FrameJob[], goreUnit: number): Extents {
  const canvas = createCanvas(MEASURE_SIZE, MEASURE_SIZE);
  const ctx = canvas.getContext('2d');
  const originX = MEASURE_SIZE / 2;
  const originY = MEASURE_SIZE / 2;
  // Measured at the size the sheet is authored at, so the extents include the
  // edge light — which is real ink and has to fit inside the cell with it.

  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  let goreRadius = 0;
  const goreOffsets = new Map<number, Pt>();
  const blankFrames: string[] = [];

  for (const job of jobs) {
    ctx.clearRect(0, 0, MEASURE_SIZE, MEASURE_SIZE);
    job.paint(canvas, originX, originY, TILE_SCALE);
    const box = inkBoxOf(ctx, MEASURE_SIZE, MEASURE_SIZE);
    if (box === null) {
      blankFrames.push(`${job.row.name}[${job.frame}]`);
      continue;
    }

    if (job.anchor === 'cellCentre') {
      const inkCentreX = (box.minX + box.maxX) / 2;
      const inkCentreY = (box.minY + box.maxY) / 2;
      goreOffsets.set(job.frame, {
        x: (originX - inkCentreX) / goreUnit,
        y: (originY - inkCentreY) / goreUnit,
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
    tileY: originY - TILE_SCALE / 2,
  };
}

export interface BakedSheet {
  readonly key: string;
  readonly buffer: Buffer;
  readonly geometry: SheetGeometry;
  readonly columns: number;
  readonly rows: readonly RowSpec[];
}

/**
 * How much bigger than the animation rows need the gore may make every cell.
 * Rotation safety is free — `geometryFor` guarantees it — so this bounds cost,
 * not correctness.
 */
const GORE_AREA_INFLATION_LIMIT = 2;

export function bakeSheet(spec: SheetSpec): BakedSheet {
  const figureScale = LICH_HEIGHT_TILES / LICH_FIGURE_HEIGHT;
  const goreUnit = TILE_SCALE * figureScale;
  // Two passes: the first measures where each piece's ink actually lands, the
  // second repaints it centred on that measurement.
  const measured = measure(buildJobs(spec), goreUnit);
  const jobs = buildJobs(spec, measured.goreOffsets);
  const extents = measure(jobs, goreUnit);

  if (extents.blankFrames.length > 0) {
    throw new Error(
      `${spec.key}: these frames painted nothing, which almost always means a NaN in the pose: ` +
        extents.blankFrames.join(', '),
    );
  }

  const geometry = geometryFor(extents);
  const animationOnly = geometryFor({ ...extents, goreRadius: 0 });
  const animationArea = animationOnly.frameWidth * animationOnly.frameHeight;
  const inflation = (geometry.frameWidth * geometry.frameHeight) / animationArea;
  if (inflation > GORE_AREA_INFLATION_LIMIT) {
    throw new Error(
      `${spec.key}: the loose bones inflate every cell to ${inflation.toFixed(2)}× the area the ` +
        `animation rows need — shrink the longest piece rather than paying for it on all ` +
        `${spec.rows.length} rows`,
    );
  }

  const columns = Math.max(...spec.rows.map((row) => row.frameCount));
  const sheet = createCanvas(
    columns * geometry.frameWidth,
    spec.rows.length * geometry.frameHeight,
  );
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  const rowIndexOf = new Map(spec.rows.map((row, index) => [row.name, index]));

  for (const job of jobs) {
    const rowIndex = rowIndexOf.get(job.row.name);
    if (rowIndex === undefined)
      throw new Error(`row "${job.row.name}" is not in ${spec.key}'s rows`);

    cellCtx.clearRect(0, 0, cell.width, cell.height);
    const originY =
      job.anchor === 'cellCentre' ? geometry.frameHeight / 2 : geometry.tileY + TILE_SCALE / 2;
    job.paint(
      cell,
      (geometry.frameWidth / 2) * SUPERSAMPLE,
      originY * SUPERSAMPLE,
      TILE_SCALE * SUPERSAMPLE,
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
    key: spec.key,
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry,
    columns,
    rows: spec.rows,
  };
  runGates(spec, baked, jobs);
  return baked;
}

// ── Bake gates ───────────────────────────────────────────────────────────────

/**
 * How much bigger the step across a loop's seam may be than its median step.
 *
 * Comparing the pose at phase 0 with the pose at phase 1 is worthless here:
 * every pose in this file is built from sinusoids of the phase and from
 * `gaitStep`, whose first line wraps its argument into [0,1), so both are
 * identical at 0 and 1 by construction. What catches a pop is measuring how far
 * the figure moves between each pair of adjacent frames and asking whether the
 * wrap from the last frame back to the first is out of line with the rest.
 */
const MAX_LOOP_SEAM_RATIO = 2.2;

/** Headroom a leg must keep under its own full extension, in tile units. */
const MIN_LEG_REACH_HEADROOM = 0.002;

/** How far the ink must stay from the cell border before the padding does nothing. */
const MIN_BORDER_CLEARANCE_PX = 1;

/**
 * The rim light is the silhouette, so its absence is a bake failure and not a
 * style note.
 *
 * Expressed as a share of the frame's *own* ink with a hard floor, never as an
 * absolute pixel count: a threshold tuned on a summon frame that fills the cell
 * would pass anything on a hunched idle, and one tuned on the idle would be
 * meaningless on the summon.
 */
const MIN_RIM_INK_SHARE = 0.03;
const MIN_RIM_INK_PIXELS = 40;
/** How far a pixel's green may sit under the rim colour's and still count. */
const RIM_MATCH_TOLERANCE = 46;

/**
 * The dimmest floor this creature is fought on, and how far its brightest edge
 * has to clear that floor once the sheet has been halved to the game's tile.
 *
 * A near-black figure on a dark tower floor is a smudge whatever the outline is
 * doing at 4×, and the only honest place to measure that is at the size it
 * renders. `p95` rather than the maximum: one stray bright pixel is not a
 * silhouette, and the maximum would be satisfied by the wax seal alone.
 */
const DIM_FLOOR_LUMA = 58;
const MIN_SILHOUETTE_CONTRAST = 46;
const SILHOUETTE_PERCENTILE = 0.95;

/** Joints sampled to measure how much a pose changed between two frames. */
function poseFingerprint(pose: SkeletonPose): readonly number[] {
  return [
    pose.leftFoot.x,
    pose.leftFoot.y,
    pose.rightFoot.x,
    pose.rightFoot.y,
    pose.bob,
    pose.sway,
    pose.lean,
    pose.leftHand.x,
    pose.leftHand.y,
    pose.rightHand.x,
    pose.rightHand.y,
  ];
}

function poseDistance(a: SkeletonPose, b: SkeletonPose): number {
  const left = poseFingerprint(a);
  const right = poseFingerprint(b);
  let total = 0;
  for (let i = 0; i < left.length; i++) total += (left[i] - right[i]) ** 2;
  return Math.sqrt(total);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const HEX_RADIX = 16;
const HEX_PAIR = 2;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hexToRgb(hex: string): Rgb {
  const body = hex.slice(1);
  return {
    r: parseInt(body.slice(0, HEX_PAIR), HEX_RADIX),
    g: parseInt(body.slice(HEX_PAIR, HEX_PAIR * 2), HEX_RADIX),
    b: parseInt(body.slice(HEX_PAIR * 2, HEX_PAIR * 3), HEX_RADIX),
  };
}

const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;

function lumaOf(r: number, g: number, b: number): number {
  return r * LUMA_RED + g * LUMA_GREEN + b * LUMA_BLUE;
}

interface FrameInk {
  readonly inkPixels: number;
  readonly rimPixels: number;
  /** Luminance at {@link SILHOUETTE_PERCENTILE} across the frame's own ink. */
  readonly brightLuma: number;
}

const RIM_RGB = hexToRgb(LICH_RIM_EDGE);

function measureInk(ctx: Ctx, width: number, height: number): FrameInk {
  const { data } = ctx.getImageData(0, 0, width, height);
  const lumas: number[] = [];
  let rimPixels = 0;
  for (let i = 0; i < data.length; i += CHANNELS) {
    if (data[i + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    lumas.push(lumaOf(r, g, b));
    const greenLead = g - Math.max(r, b);
    if (
      g >= RIM_RGB.g - RIM_MATCH_TOLERANCE &&
      greenLead >= RIM_RGB.g - RIM_RGB.r - RIM_MATCH_TOLERANCE
    ) {
      rimPixels++;
    }
  }
  if (lumas.length === 0) return { inkPixels: 0, rimPixels: 0, brightLuma: 0 };
  lumas.sort((a, b) => a - b);
  const index = Math.min(lumas.length - 1, Math.floor(lumas.length * SILHOUETTE_PERCENTILE));
  return { inkPixels: lumas.length, rimPixels, brightLuma: lumas[index] };
}

/** What `drawSpriteKey` scales this sheet by in play. */
const IN_GAME_TILE = 32;

function runGates(spec: SheetSpec, baked: BakedSheet, jobs: readonly FrameJob[]): void {
  // G1. Loop seam. A walk or idle whose last frame does not lead back into its
  // first pops once per cycle, forever — and it pops in the one place a contact
  // sheet cannot show, between the right-hand column and the left-hand one.
  for (const row of spec.rows) {
    if (row.kind !== 'loop' || row.pose === null) continue;
    const poses: SkeletonPose[] = [];
    for (let frame = 0; frame < row.frameCount; frame++) poses.push(row.pose(frame));
    const steps: number[] = [];
    for (let frame = 0; frame < poses.length - 1; frame++) {
      steps.push(poseDistance(poses[frame], poses[frame + 1]));
    }
    const seam = poseDistance(poses[poses.length - 1], poses[0]);
    const typical = median(steps);
    if (typical > 0 && seam > typical * MAX_LOOP_SEAM_RATIO) {
      throw new Error(
        `G1 ${spec.key}/${row.name}: the loop does not close — the step across the seam is ` +
          `${(seam / typical).toFixed(2)}× the median step, which pops once per cycle`,
      );
    }
  }

  // G2. Leg reach, on every frame of every row including the one-shots: a crouch
  // or a lunge can put a foot out of reach just as easily as a stride can.
  for (const row of spec.rows) {
    if (row.pose === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const headroom = lichLegReachHeadroom(row.pose(frame), lichLateralFor(row.view));
      if (headroom < MIN_LEG_REACH_HEADROOM) {
        throw new Error(
          `G2 ${spec.key}/${row.name}[${frame}]: a leg is over-extended by ` +
            `${(MIN_LEG_REACH_HEADROOM - headroom).toFixed(4)} tiles — the IK clamps and the ` +
            `foot hangs off the floor, which reads as a hop`,
        );
      }
    }
  }

  const canvas = createCanvas(baked.geometry.frameWidth, baked.geometry.frameHeight);
  const ctx = canvas.getContext('2d');
  const gameCanvas = createCanvas(
    Math.ceil((baked.geometry.frameWidth * IN_GAME_TILE) / TILE_SCALE),
    Math.ceil((baked.geometry.frameHeight * IN_GAME_TILE) / TILE_SCALE),
  );
  const gameCtx = gameCanvas.getContext('2d');

  let worstContrast = Infinity;
  let worstContrastAt = '';
  let worstRimShare = Infinity;
  let worstRimAt = '';

  for (const job of jobs) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const originY =
      job.anchor === 'cellCentre'
        ? baked.geometry.frameHeight / 2
        : baked.geometry.tileY + TILE_SCALE / 2;
    job.paint(canvas, baked.geometry.frameWidth / 2, originY, TILE_SCALE);

    // G3. Border clearance, measured off the baked pixels rather than off the
    // pose: the thing that clips is always something the pose does not know it
    // draws — a claw, a hood peak, a flared hem.
    const box = inkBoxOf(ctx, canvas.width, canvas.height);
    if (box === null) {
      throw new Error(
        `G3 ${spec.key}/${job.row.name}[${job.frame}]: the frame baked no ink at all — the pose ` +
          `or paint callback produced an empty cell, which would also skip G4 and G5`,
      );
    }
    const clearance = Math.min(
      box.minX,
      box.minY,
      canvas.width - 1 - box.maxX,
      canvas.height - 1 - box.maxY,
    );
    if (clearance < MIN_BORDER_CLEARANCE_PX) {
      throw new Error(
        `G3 ${spec.key}/${job.row.name}[${job.frame}]: ink reaches the cell border (clearance ` +
          `${clearance}px) — the frame is being cut off`,
      );
    }

    if (job.row.kind === 'gore') continue;

    // G4. The rim light actually got painted. A geometry gate proves where a
    // form would be, never that it was painted in the colour that makes it
    // visible — and this creature has no silhouette without it.
    const full = measureInk(ctx, canvas.width, canvas.height);
    const rimShare = full.rimPixels / Math.max(1, full.inkPixels);
    if (rimShare < worstRimShare) {
      worstRimShare = rimShare;
      worstRimAt = `${job.row.name}[${job.frame}]`;
    }
    if (rimShare < MIN_RIM_INK_SHARE || full.rimPixels < MIN_RIM_INK_PIXELS) {
      throw new Error(
        `G4 ${spec.key}/${job.row.name}[${job.frame}]: only ${full.rimPixels} rim pixels ` +
          `(${(rimShare * 100).toFixed(2)}% of the frame's ink, floor ` +
          `${(MIN_RIM_INK_SHARE * 100).toFixed(0)}% / ${MIN_RIM_INK_PIXELS}px) — a near-black ` +
          `figure without its edge light is a smudge on a dark floor`,
      );
    }

    // G5. And that it survives being halved to the game's tile. The rim can be
    // present on the sheet and still average away into the robe under it.
    gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
    gameCtx.drawImage(canvas, 0, 0, gameCanvas.width, gameCanvas.height);
    const shrunk = measureInk(gameCtx, gameCanvas.width, gameCanvas.height);
    const contrast = shrunk.brightLuma - DIM_FLOOR_LUMA;
    if (contrast < worstContrast) {
      worstContrast = contrast;
      worstContrastAt = `${job.row.name}[${job.frame}]`;
    }
    if (contrast < MIN_SILHOUETTE_CONTRAST) {
      throw new Error(
        `G5 ${spec.key}/${job.row.name}[${job.frame}]: at a ${IN_GAME_TILE}px tile the frame's ` +
          `brightest edge is ${shrunk.brightLuma.toFixed(1)} luma against a ${DIM_FLOOR_LUMA} ` +
          `floor — ${contrast.toFixed(1)} of contrast against a ${MIN_SILHOUETTE_CONTRAST} ` +
          `floor. Fix the exposure, not the texture`,
      );
    }
  }

  // G6. The gore row has to carry exactly the states the runtime spawns, or a
  // part flies as an empty cell.
  const goreRow = spec.rows.find((row) => row.kind === 'gore');
  if (goreRow !== undefined && goreRow.frameCount !== SKELETON_GORE_STATES.length) {
    throw new Error(
      `G6 ${spec.key}: the gore row holds ${goreRow.frameCount} cells but SKELETON_GORE_STATES ` +
        `names ${SKELETON_GORE_STATES.length} — the runtime would spawn a state that is not on ` +
        `the sheet`,
    );
  }

  console.log(
    `  gates: worst rim share ${(worstRimShare * 100).toFixed(2)}% at ${worstRimAt}; ` +
      `worst in-game contrast ${worstContrast.toFixed(1)} at ${worstContrastAt}`,
  );
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

/**
 * The manifest entry this bake requires, exported so the verifier and the
 * paste-helper cannot derive it two different ways.
 */
export function manifestEntryFor(sheet: BakedSheet): ManifestEntry {
  const states: Record<string, ManifestStateEntry> = {};
  sheet.rows.forEach((row, index) => {
    if (row.kind === 'gore') {
      SKELETON_GORE_STATES.forEach((state, column) => {
        states[state] = { row: index, colOffset: column, frameCount: 1 };
      });
      return;
    }
    states[row.name] = { row: index, frameCount: row.frameCount };
  });
  return {
    path: `enemies/${sheet.key}.png`,
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

/** A stable string for comparing two manifest entries, ignoring key order. */
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
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const required = manifestEntryFor(sheet);
  if (canonicalJson(manifest[sheet.key]) !== canonicalJson(required)) {
    console.error(
      `\n${MANIFEST_PATH} is out of sync with the bake. Replace this entry with:\n\n` +
        `"${sheet.key}": ${JSON.stringify(required, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

function writeSheet(): void {
  console.log(`Generating The Lich's sprite sheet (tileScale=${TILE_SCALE})…`);
  const sheet = bakeSheet(LICH_SHEET);
  const path = sheetPathFor(LICH_SHEET.key);
  writeFileSync(resolve(path), sheet.buffer);
  console.log(
    `  → ${path}  ${sheet.columns * sheet.geometry.frameWidth}×` +
      `${LICH_SHEET.rows.length * sheet.geometry.frameHeight}px  (${LICH_SHEET.rows.length} rows ` +
      `× ${sheet.columns} cols of ${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight}, ` +
      `${LICH_HEIGHT_TILES} tiles tall)`,
  );
  console.log(`     tileX=${sheet.geometry.tileX}  tileY=${sheet.geometry.tileY}`);
  LICH_SHEET.rows.forEach((row, index) => {
    console.log(`     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view})`);
  });
  verifyManifest(sheet);
}

// The review harness imports LICH_SHEET from here, so painting has to be
// something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheet();
}
