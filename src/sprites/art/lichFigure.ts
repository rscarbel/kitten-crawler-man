/**
 * The Lich, as a painted figure: the choreography, the cell geometry, and the
 * `FigureDef` the runtime cache and the review harness both draw through.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, the cold edge light laid round the finished silhouette, and the
 * placement of a pose or a loose bone inside its cell. Anatomy, palette and
 * every stroke of paint live in `lichArt.ts`, and the bones themselves in
 * `skeletonGore.ts` — the thing under the robe is a skeleton.
 *
 * The row vocabulary is deliberately the Skeleton Lord's, down to the frame
 * counts: the two creatures share a state machine, so a row this figure did not
 * paint would be a state the runtime could ask for and not get. What differs is
 * everything under the rows — a taller, thinner, closed silhouette instead of an
 * open lit ribcage — plus the `dazed` row, which the Lord has no use for.
 *
 * The art invariants live in `scripts/gates-lich.ts`, which the review harness
 * runs: `npm run render:lich`.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { type FigureDef, figureStates } from '../figure/figureDef';
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
  type Pt,
} from './skeletonArt';
import {
  LICH_ARM_LENGTH,
  LICH_CLOTH,
  LICH_CROUCH_DROP,
  LICH_FIGURE_HEIGHT,
  LICH_OUTLINE,
  LICH_RIM_EDGE,
  LICH_SHOULDER_JOINT_DROP,
  LICH_SHOULDER_Y,
  drawLichBack,
  drawLichContactShadow,
  drawLichFront,
  drawLichSide,
  type LichView,
} from './lichArt';
import { SKELETON_GORE_STATES, skeletonGorePieces, type SkeletonGorePiece } from './skeletonGore';
// The release fraction is shared with the runtime rather than copied here, so
// the thrust cannot drift away from the frame the bolt is queued on.
import { SOUL_BOLT_RELEASE_PROGRESS, SOUL_BOLT_THRUST_SHARE } from '../skeletonTiming';

type Ctx = CanvasRenderingContext2D;

// ── Cell geometry ────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * The cell the poses and the loose bones are painted into, and where the
 * creature's own tile sits inside it.
 *
 * These four numbers were measured by the bake this figure replaces — the
 * widest pose plus padding, quantised — and `scripts/parity-figure-sheet.ts` is
 * what proved the painter still fills exactly that cell. The gates re-check that
 * nothing paints against the edge, which is what would say a pose has outgrown
 * them.
 */
const FRAME_WIDTH = 136;
const FRAME_HEIGHT = 224;
const TILE_X = 36;
const TILE_Y = 173;

/** Poses are painted with the origin on the ground line, at the cell's centre. */
export const POSE_ORIGIN_X = FRAME_WIDTH / 2;
export const POSE_ORIGIN_Y = TILE_Y + TILE_SCALE / 2;

/** A loose bone is painted about the centre of its cell, which is what it spins about. */
export const GORE_ORIGIN_X = FRAME_WIDTH / 2;
export const GORE_ORIGIN_Y = FRAME_HEIGHT / 2;

/**
 * How tall the Lich stands, applied about its own ground line.
 *
 * Half a tile over the Skeleton Lord's 2.5. The rig is authored once at
 * {@link LICH_FIGURE_HEIGHT} and scaled here rather than re-proportioned:
 * scaling the anatomy tables instead would leave the choreography and the gore
 * at the original size and silently redraw the animation.
 */
const LICH_HEIGHT_TILES = 2.68;
export const FIGURE_SCALE = LICH_HEIGHT_TILES / LICH_FIGURE_HEIGHT;

/** Cell pixels per unit of a loose bone's own drawing space. */
export const GORE_UNIT = TILE_SCALE * FIGURE_SCALE;

/**
 * The density the edge light is built at, inside the painter's own scratch
 * surfaces.
 *
 * The rim is a dilation of the figure's finished alpha, measured in real
 * pixels, so what it looks like depends on how many pixels the figure was drawn
 * into. Pinning it here rather than reading the caller's transform is what
 * keeps the painter deterministic: a cache bake, a direct-paint fallback and an
 * offline harness all get the identical rim, and this is the density the bake
 * that measured this cell used.
 */
const EDGE_LIGHT_DENSITY = 2;

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
 * even one frame reads as a hop, and an art gate measures it.
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
  // side of the trunk. Left unset, this row paints identical to the front one and
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

// ── Dazed ────────────────────────────────────────────────────────────────────

/**
 * The vulnerability window: the Lich is spent and back on the floor.
 *
 * Every other row is a creature that hovers, stands tall and glares. This one
 * has to say "reachable" from across the room and in a glance, so it inverts all
 * three at once — the hover stops and the feet are planted, the body sinks, and
 * the witch-light that is the whole face gutters down to an ember. What sells it
 * head-on is mostly the height: a figure two thirds of the height the player has
 * been chasing for two phases reads as broken before any detail resolves.
 *
 * Baked camera-facing only. It is a held, symmetrical pose, and the fight parks
 * the creature at the room centre in front of the party to play it.
 */
const DAZE_FRAMES = 10;
/**
 * A full crouch, plus a sag past it.
 *
 * The crouch alone only takes {@link LICH_CROUCH_DROP} out of the hip height,
 * which at a 32 px tile is three pixels — a difference that is obvious beside
 * the idle row and invisible without it, and the player never sees the two side
 * by side. The rest of the drop is a positive bob, which sinks the whole rig
 * without asking the legs to fold further than they can.
 */
const DAZE_CROUCH = 1;
const DAZE_SAG = 0.18;
/** Total drop of the body, which the hanging hands have to follow down. */
const DAZE_SINK = DAZE_CROUCH * LICH_CROUCH_DROP + DAZE_SAG;
/** Head-on roll of the cowl; a hood that has slid off true reads as a dropped head. */
const DAZE_HEAD_ROLL = deg(21);
/** How far the woozy loll carries the roll either side of that. */
const DAZE_LOLL = deg(5);
/** Dead arms hang wider than live ones — nothing is holding them in. */
const DAZE_HAND_SPREAD = 0.29;
/** Slack travel left in the arms, so they swing rather than sit. */
const DAZE_HAND_DRIFT = 0.02;
const DAZE_SHOULDER_SAG = deg(4);
/**
 * Guttering hood-fire: an ember that flares and dies rather than pulsing.
 *
 * Two cycles across the loop is the fastest this may run. Past one oscillation
 * per two frames the flicker aliases against the playback rate and the ember
 * either freezes or strobes, and a strobing light reads as a hazard rather than
 * as an exhausted one.
 */
const DAZE_GLOW_FLOOR = 0.06;
const DAZE_GLOW_REACH = 0.16;
const DAZE_GUTTER_CYCLES = 2;
/** The jaw hangs open and barely moves — a slack jaw, not a chant. */
const DAZE_JAW_OPEN = 0.55;
const DAZE_JAW_TREMBLE = 0.06;
/** The hem has pooled on the floor rather than being held out by anything. */
const DAZE_ROBE_FLARE = 0.14;

function dazedFront(phase: number): SkeletonPose {
  const angle = phase * TWO_PI;
  const breath = Math.sin(angle);
  const gutter = 0.5 + 0.5 * Math.sin(angle * DAZE_GUTTER_CYCLES);
  const handY = HAND_HANG_Y + DAZE_SINK + DAZE_HAND_DRIFT * breath;
  return {
    ...lichRestingPose(),
    crouch: DAZE_CROUCH,
    bob: DAZE_SAG,
    // Planted, not hovering: the feet are the tell that it can be walked up to.
    ...facingStance(),
    leftHand: pt(-DAZE_HAND_SPREAD, handY),
    rightHand: pt(DAZE_HAND_SPREAD, handY - DAZE_HAND_DRIFT * breath * 2),
    // Curled, not clawed. An open claw is a threat whatever the rest is doing.
    leftClaw: 0.12,
    rightClaw: 0.08,
    leftForeshorten: 1,
    rightForeshorten: 1,
    elbowFlare: 1,
    lean: DAZE_SHOULDER_SAG * breath,
    headTilt: DAZE_HEAD_ROLL + DAZE_LOLL * breath,
    headTurn: 0.1 * breath,
    jaw: DAZE_JAW_OPEN + DAZE_JAW_TREMBLE * gutter,
    robeFlare: DAZE_ROBE_FLARE,
    robeSway: 0.15 * breath,
    glow: DAZE_GLOW_FLOOR + DAZE_GLOW_REACH * gutter,
    time: phase,
  };
}

// ── Row manifest ────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: LichView;
  readonly pose: (frame: number) => SkeletonPose;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

export function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

export const LICH_ROWS: readonly RowSpec[] = [
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
  {
    name: 'dazed',
    frameCount: DAZE_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => dazedFront(cyclePhase(f, DAZE_FRAMES)),
  },
];

// ── Edge light ────────────────────────────────────────────────────────

const HEX_RADIX = 16;
const HEX_PAIR = 2;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const MAX_ALPHA = 255;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.slice(1);
  return {
    r: parseInt(value.slice(0, HEX_PAIR), HEX_RADIX),
    g: parseInt(value.slice(HEX_PAIR, HEX_PAIR * 2), HEX_RADIX),
    b: parseInt(value.slice(HEX_PAIR * 2, HEX_PAIR * 3), HEX_RADIX),
  };
}

export const RIM_RGB = hexToRgb(LICH_RIM_EDGE);

/**
 * How far the edge light reaches past the silhouette, in tile units.
 *
 * Sized against the *game* tile, not the cell: the art is authored at a 64 px
 * tile and drawn at 32, so a rim that looks like a crisp pixel in the cell is
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
function paintWithEdgeLight(
  target: CanvasSurface,
  rimPx: number,
  paintFigure: (ctx: Ctx) => void,
): void {
  const figure = allocCanvas(target.width, target.height);
  paintFigure(surfaceContext(figure));

  const mask = allocCanvas(target.width, target.height);
  const maskCtx = surfaceContext(mask);
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

  const halo = allocCanvas(target.width, target.height);
  const haloCtx = surfaceContext(halo);
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

  const ctx = surfaceContext(target);
  ctx.save();
  ctx.globalAlpha = RIM_ALPHA;
  ctx.drawImage(halo, 0, 0);
  ctx.restore();
  ctx.drawImage(figure, 0, 0);
}

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

// ── Gore ──────────────────────────────────────────────────────────────

/**
 * The loose bones are the skeleton warrior's, drawn at their own tile-unit sizes
 * and scaled by the figure like the figure is — without this the Lich's bones
 * would come out the size a 1.55-tile warrior's are.
 */
const GORE_VARIANT = 'sword' as const;

export const GORE_STATES: readonly string[] = SKELETON_GORE_STATES;

export const GORE_PIECES: readonly SkeletonGorePiece[] = skeletonGorePieces(GORE_VARIANT);

function gorePieceOf(state: string): SkeletonGorePiece {
  const piece = GORE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for "${state}"`);
  return piece;
}

/**
 * How far each loose bone is nudged, in cell pixels, so that its ink — not its
 * authoring origin — sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own visible pixels,
 * so a piece drawn off-centre in its cell orbits rather than tumbles. The
 * numbers were measured from the painted ink of each piece, the cloth scrap
 * included, since that is ink too. Measuring is something only an offline pass
 * can do, so they are frozen here and `scripts/gates-lich.ts` re-measures the
 * result on every render — it paints each piece into its real cell and asserts
 * the ink lands on the centre.
 */
export const GORE_RECENTRE_PX: ReadonlyMap<string, Pt> = new Map([
  ['gore_skull', pt(-3, 2)],
  ['gore_ribcage', pt(1, -1.5)],
  ['gore_pelvis', pt(0.5, 3.5)],
  ['gore_femur', pt(0, 0.5)],
  ['gore_tibia', pt(1.5, 0.5)],
  ['gore_forearm', pt(-1, -1)],
  ['gore_hand', pt(1, -3.5)],
]);

function goreRecentreOf(state: string): Pt {
  const offset = GORE_RECENTRE_PX.get(state);
  if (offset === undefined) throw new Error(`no gore recentring offset for "${state}"`);
  return offset;
}

/**
 * Paints one loose bone about the current origin, in the piece's own units.
 *
 * Exported so the gate that re-measures {@link GORE_RECENTRE} paints exactly
 * what the cell paints — the scrap is ink, and a gate measuring the bone alone
 * would freeze a different centre from the one the cell shows.
 */
export function paintGorePiece(ctx: Ctx, state: string): void {
  const piece = gorePieceOf(state);
  const index = GORE_PIECES.indexOf(piece);
  if (SCRAP_PIECES.includes(state)) paintClothScrap(ctx, index);
  piece.paint(ctx);
}

// ── Painting a cell ─────────────────────────────────────────────────

function paintView(ctx: Ctx, view: LichView, pose: SkeletonPose): void {
  if (view === 'front') drawLichFront(ctx, pose);
  else if (view === 'back') drawLichBack(ctx, pose);
  else drawLichSide(ctx, pose);
}

function poseRowOf(state: string): RowSpec | undefined {
  return LICH_ROWS.find((row) => row.name === state);
}

/**
 * Paints one pose row cell.
 *
 * The whole cell is composed on a scratch surface of its own and blitted down
 * in one call, because the edge light is a dilation of the finished figure's
 * alpha and there is no way to build that in the caller's context without
 * dilating whatever was already there. The contact shadow is laid down first,
 * on the floor rather than on the figure, so it is never dilated into a halo of
 * its own.
 */
function paintPoseCell(ctx: Ctx, row: RowSpec, frame: number): void {
  const density = EDGE_LIGHT_DENSITY;
  const surface = allocCanvas(FRAME_WIDTH * density, FRAME_HEIGHT * density);
  const place = (target: Ctx): void => {
    target.translate(POSE_ORIGIN_X * density, POSE_ORIGIN_Y * density);
    // Scaled about the ground line, so the taller figure still stands on the
    // tile its feet belong to rather than floating above it.
    target.scale(TILE_SCALE * density * FIGURE_SCALE, TILE_SCALE * density * FIGURE_SCALE);
  };
  const posed = row.pose(frame);

  const shadowCtx = surfaceContext(surface);
  shadowCtx.save();
  place(shadowCtx);
  drawLichContactShadow(shadowCtx, posed);
  shadowCtx.restore();

  paintWithEdgeLight(surface, RIM_REACH_TILES * TILE_SCALE * density, (figureCtx) => {
    figureCtx.save();
    place(figureCtx);
    paintView(figureCtx, row.view, posed);
    figureCtx.restore();
  });

  ctx.drawImage(surface, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
}

/**
 * Paints one cell of the Lich, in the cell's own pixels.
 *
 * A pose row is anchored at the ground line under the cell's centre, which is
 * what ties the art to the tile the creature stands on. A loose bone is anchored
 * at the cell's centre instead, because the only thing that reads its cell is
 * the spin the gore field applies about that point.
 */
function paintLichFrame(ctx: Ctx, state: string, frame: number): void {
  const row = poseRowOf(state);
  if (row === undefined) {
    const recentre = goreRecentreOf(state);
    ctx.save();
    ctx.translate(GORE_ORIGIN_X + recentre.x, GORE_ORIGIN_Y + recentre.y);
    ctx.scale(GORE_UNIT, GORE_UNIT);
    paintGorePiece(ctx, state);
    ctx.restore();
    return;
  }
  paintPoseCell(ctx, row, frame);
}

/** Every state the figure declares, pose rows first and then the loose bones. */
function lichStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of LICH_ROWS) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

export const LICH_FIGURE: FigureDef = {
  id: 'the_lich',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(lichStateFrames()),
  paintFrame: paintLichFrame,
};
