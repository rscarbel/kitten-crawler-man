#!/usr/bin/env tsx
/**
 * Generates the three skeleton sprite sheets — the Skeleton Lord and the sword
 * and bow warriors that escort him.
 *
 * The anatomy and the painting live in `scripts/skeletonArt.ts` and the loose
 * bones in `scripts/skeletonGore.ts`; this file is only the choreography plus
 * the bake: one pose function per animation row, sampled per frame, then
 * measured and laid out.
 *
 * Three sheets rather than one, following the goblin precedent: the variants
 * differ in height by more than half a tile, and a shared cell sized for the
 * lord would leave every warrior frame mostly empty — which costs the runtime a
 * texture upload per draw for nothing.
 *
 * The frame geometry is measured rather than declared. A cast throws an arm most
 * of a tile past the shoulder and the lord's crown stands well over his skull, so
 * a hand-guessed cell is exactly how a spike ends up sheared flat in the PNG.
 *
 * Run: npm run gen:skeletons
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  ARM_LENGTH,
  FIGURE_HEIGHT,
  SHOULDER_JOINT_DROP,
  SHOULDER_Y,
  type ArmAngles,
  type SkeletonPose,
  type SkeletonVariant,
  clamp01,
  deg,
  drawSkeletonBack,
  drawSkeletonFront,
  drawSkeletonSide,
  easeIn,
  easeInOut,
  easeOut,
  hump,
  lateralFor,
  legReachHeadroom,
  lerp,
  ramp,
  restingPose,
  TWO_PI,
} from './skeletonArt.js';
import { SKELETON_GORE_STATES, skeletonGorePieces } from './skeletonGore.js';
// The release fractions are shared with the runtime rather than copied here; see
// the header of that module for what goes wrong when the two drift.
import {
  BONE_ARROW_RELEASE_PROGRESS,
  SOUL_BOLT_RELEASE_PROGRESS,
  SOUL_BOLT_THRUST_SHARE,
  SWORD_SLASH_IMPACT_PROGRESS,
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
 * How many tiles tall each variant stands, applied at bake time about its own
 * ground line so the feet stay on the tile they belong to.
 *
 * The rig is authored once at {@link FIGURE_HEIGHT} and scaled here rather than
 * being re-proportioned per variant: scaling the anatomy tables instead would
 * leave the choreography, the gear and the gore at the original size and
 * silently redraw the animation.
 */
const VARIANT_HEIGHT_TILES: Record<SkeletonVariant, number> = {
  lord: 2.5,
  sword: 1.55,
  archer: 1.5,
};

/**
 * Walks are sampled denser than everything else because a gait is the one
 * animation a player watches for minutes at a time. Twelve rather than Carl's
 * sixteen: these are mobs seen at a distance, and four extra columns on three
 * sheets buys smoothness nobody is close enough to see.
 */
const WALK_FRAMES = 12;
const IDLE_FRAMES = 8;
const CAST_FRAMES = 10;
const HANDS_FRAMES = 10;
const SUMMON_FRAMES = 10;
const SLASH_FRAMES = 10;
const DRAW_LOOSE_FRAMES = 10;
const RISE_FRAMES = 12;

// ── Pose helpers ─────────────────────────────────────────────────────────────

function pt(x: number, y: number): { x: number; y: number } {
  return { x, y };
}

/** Where a relaxed hand hangs, measured from the shoulder joint rather than the line. */
const HAND_HANG_Y = SHOULDER_Y + SHOULDER_JOINT_DROP + ARM_LENGTH * 0.99;

/** Share of a stride a foot spends in the air. */
const SWING_SHARE = 0.4;
const STRIDE = 0.155;
const FOOT_LIFT = 0.075;
/**
 * How far the pelvis drops at contact.
 *
 * It drops rather than rising at mid-stance — which is what a real pelvis does,
 * and the only way a leg nearly as long as the hip is high can reach a foot
 * planted a full stride ahead without the IK clamping. A stride that clamps on
 * even one frame reads as a hop, and the bake gate now measures it: the first
 * version of this walk raised the hip above standing height and over-extended
 * both legs on a third of its frames.
 */
const WALK_BOB = 0.04;

/**
 * The pelvis has to be at its lowest on the frame a foot *plants*, which is the
 * moment the swing ends — not at an arbitrary point of the cycle. Phased against
 * anything else the drop fights the stride instead of paying for it.
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
const ARM_REST_TILT = deg(6);
const ARM_ELBOW_BREAK = deg(9);
/** Arms swing further forward than back. */
const ARM_FORWARD_SHARE = 0.55;
const SIDE_UPPER_SWING = deg(21);
const SIDE_FOREARM_SWING = deg(11);
/**
 * Head-on the upper arm is nearly end-on and shows almost nothing; the forearm
 * carries what travel there is, and the depth of the swing is sold by drawing
 * the forearm shorter as it turns out of the picture plane.
 */
const FACING_UPPER_SWING = deg(5);
const FACING_FOREARM_SWING = deg(11);
const FACING_FORE_SCALE_MIN = 0.84;

function swingShare(raw: number): number {
  return raw >= 0 ? raw * ARM_FORWARD_SHARE * 2 : raw * (1 - ARM_FORWARD_SHARE) * 2;
}

/**
 * Forward bias on the arm that is carrying something, edge-on.
 *
 * A profile walk drives both arms from the same FK angles off two shoulder
 * joints that are all but coincident, so at the ends of the swing the shield
 * and the sword grip land on the same spot — over the ribcage, for the whole
 * cycle, in the view a chasing mob spends its life in.
 */
const PROP_ARM_FORWARD_BIAS = deg(26);

function sideArm(phase: number, side: number, forwardBias = 0): ArmAngles {
  const raw = Math.sin(phase * TWO_PI) * side;
  const swing = swingShare(raw);
  return {
    upper: ARM_REST_TILT + SIDE_UPPER_SWING * swing + forwardBias,
    fore: ARM_REST_TILT - ARM_ELBOW_BREAK + SIDE_FOREARM_SWING * swing + forwardBias,
    foreScale: 1,
  };
}

function facingArm(phase: number, side: number): ArmAngles {
  const raw = Math.sin(phase * TWO_PI) * side;
  const swing = swingShare(raw);
  return {
    upper: ARM_REST_TILT + FACING_UPPER_SWING * swing,
    fore: ARM_REST_TILT - ARM_ELBOW_BREAK + FACING_FOREARM_SWING * swing,
    // Foreshortening comes off the cosine of the swing, not off its sign: the
    // arm is shortest at both ends of the travel and longest across the hip.
    foreScale: lerp(FACING_FORE_SCALE_MIN, 1, 1 - Math.abs(swing)),
  };
}

// ── Walk ─────────────────────────────────────────────────────────────────────

function walkSide(phase: number, carriesProp: boolean): SkeletonPose {
  const angle = phase * TWO_PI;
  const left = gaitStep(phase);
  const right = gaitStep(phase + 0.5);
  return {
    ...restingPose(),
    bob: gaitBob(phase),
    lean: deg(4),
    leftFoot: pt(left.dx, -left.lift * FOOT_LIFT),
    rightFoot: pt(right.dx, -right.lift * FOOT_LIFT),
    leftFootPitch: deg(18) * left.lift,
    rightFootPitch: deg(18) * right.lift,
    leftArmAngles: sideArm(phase, -1, carriesProp ? PROP_ARM_FORWARD_BIAS : 0),
    rightArmAngles: sideArm(phase, 1),
    leftClaw: 0.35,
    rightClaw: 0.35,
    // A skull with no muscle to hold it lolls with the stride. It is the one
    // thing that separates a walking skeleton from a walking figure with the
    // flesh painted off, and it costs one line.
    headTilt: deg(4) * Math.sin(angle),
    jaw: 0.1 + 0.06 * Math.sin(angle * 2),
    robeFlare: 0.55 + 0.2 * Math.sin(angle),
    robeSway: -Math.sin(angle),
    glow: 0.5 + 0.2 * Math.sin(angle),
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
    ...restingPose(),
    bob: gaitBob(phase),
    sway: 0.022 * Math.sin(angle),
    leftFoot: pt(-0.115 + FACING_TRACK_IN * left.lift, -left.lift * FOOT_LIFT),
    rightFoot: pt(0.115 - FACING_TRACK_IN * right.lift, -right.lift * FOOT_LIFT),
    leftFootPitch: deg(14) * left.lift,
    rightFootPitch: deg(14) * right.lift,
    // Head-on a knee has no direction to break into, so both legs are pulled
    // fully onto their hip→ankle lines. A bow that shows on one leg and not the
    // other flickers once per step and reads as a wiggle.
    leftForeshorten: 1,
    rightForeshorten: 1,
    leftArmAngles: facingArm(phase, -1),
    rightArmAngles: facingArm(phase, 1),
    leftClaw: 0.35,
    rightClaw: 0.35,
    headTilt: deg(3) * Math.sin(angle),
    headTurn: 0.1 * Math.sin(angle),
    jaw: 0.1 + 0.06 * Math.sin(angle * 2),
    robeFlare: 0.55 + 0.18 * Math.sin(angle),
    robeSway: Math.sin(angle) * 0.6,
    glow: 0.5 + 0.2 * Math.sin(angle),
    time: phase,
  };
}

function walkBack(phase: number): SkeletonPose {
  const front = walkFront(phase);
  return {
    ...front,
    // Seen from behind the same body sways the other way on screen, and both
    // arms spend the cycle behind the ribcage rather than in front of it.
    sway: -front.sway,
    headTurn: -front.headTurn,
    leftArmBehind: true,
    rightArmBehind: true,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/**
 * The lord does not stand, he *hovers* — a slow vertical drift with the robe
 * settling under it. The warriors sway on their heels instead, because a
 * floating swordsman reads as a bug rather than as a lord.
 */
const LORD_DRIFT = 0.028;
const WARRIOR_IDLE_SWAY = 0.012;

function idleBase(phase: number, drifts: boolean): SkeletonPose {
  const angle = phase * TWO_PI;
  const rest = restingPose();
  // A hovering figure lifts its feet with it. Left on the floor while the hips
  // rise, the legs simply stretch — the IK clamps them straight and the drift
  // reads as the pelvis sliding up a pair of stilts.
  const drift = drifts ? -LORD_DRIFT * (0.5 + 0.5 * Math.sin(angle)) : 0;
  return {
    ...rest,
    bob: drift,
    leftFoot: pt(rest.leftFoot.x, rest.leftFoot.y + drift),
    rightFoot: pt(rest.rightFoot.x, rest.rightFoot.y + drift),
    sway: drifts ? 0 : WARRIOR_IDLE_SWAY * Math.sin(angle),
    lean: deg(2) * Math.sin(angle * 0.5),
    headTilt: deg(3) * Math.sin(angle * 0.5),
    // The jaw works constantly — a skeleton's only expression, and the cue that
    // separates a live one from a pile of bones somebody stood up.
    jaw: 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(angle * 2)),
    leftHand: pt(-0.3, HAND_HANG_Y + 0.012 * Math.sin(angle)),
    rightHand: pt(0.3, HAND_HANG_Y + 0.012 * Math.sin(angle + 1)),
    leftClaw: 0.5 + 0.25 * Math.sin(angle * 1.5),
    rightClaw: 0.5 + 0.25 * Math.sin(angle * 1.5 + 2),
    robeFlare: 0.3 + 0.12 * Math.sin(angle),
    robeSway: 0.4 * Math.sin(angle * 0.5),
    glow: 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(angle)),
    time: phase,
  };
}

function idleFront(phase: number, drifts: boolean): SkeletonPose {
  return {
    ...idleBase(phase, drifts),
    headTurn: 0.16 * Math.sin(phase * TWO_PI * 0.5),
    leftForeshorten: 1,
    rightForeshorten: 1,
  };
}

/**
 * Where the two hands hang edge-on, where +X is *forward* rather than outboard.
 *
 * They are deliberately not symmetrical. The figure's left hand is the one that
 * carries the shield and the bow, and a prop held on the centreline is drawn
 * entirely behind the ribcage and simply does not appear; carried forward it
 * clears the body in profile, which is the only view it can read in.
 */
/**
 * How far apart the feet stand fore-and-aft when seen edge-on.
 *
 * Every pose inherits `restingPose`'s head-on stance of ±0.115, which edge-on
 * stops being width and becomes a quarter-tile of *depth* — and a leg is barely
 * longer than the hip is high, so that alone stretches both of them past their
 * reach. Any profile pose that does not author its own stride has to say so.
 */
const PROFILE_FOOT_STAGGER = 0.045;

/**
 * The two foot targets of a standing head-on pose.
 *
 * A head-on pose that spreads a profile one has to re-assert this. Edge-on the
 * feet stand a narrow stagger apart; head-on that same number puts each foot
 * *inboard* of its own hip, which angles the leg in and makes it reach further
 * than standing square does — the over-extension is caused by the stance being
 * too narrow, not too wide.
 */
function facingStance(lift = 0): Pick<SkeletonPose, 'leftFoot' | 'rightFoot'> {
  return {
    leftFoot: pt(-RESTING_FOOT_SPREAD, lift),
    rightFoot: pt(RESTING_FOOT_SPREAD, lift),
  };
}

/**
 * The two foot targets of a standing profile pose, shifted forward by `lead` and
 * raised off the floor by `lift` — which a hovering pose must pass, or narrowing
 * the stance silently puts the feet back on the ground under a floating pelvis.
 */
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
 * far apart the hands are is how far apart the two arms fan from that point.
 * Both extremes fail: a tenth of a tile apart the chains stack on the same
 * pixels and read as one bone with a set of phalanges wrapped round it, and a
 * quarter of a tile apart they cross into an X over the chest. Either way the
 * ribcage behind them is gone.
 *
 * So it depends on whether the variant is holding anything. A shield and a bow
 * have to clear the body or they are drawn entirely behind it, which is worth
 * some crossing; the lord carries nothing, and his arms simply hang.
 */
const PROP_OFF_HAND_FORWARD = 0.16;
const PROP_WEAPON_HAND_FORWARD = 0.05;
/**
 * Bare hands hang *behind* the ribcage rather than beside it.
 *
 * Edge-on the cage is entirely forward of the spine, so any hand within about a
 * tenth of a tile of the centreline puts its whole arm across the ribs — and
 * with the two shoulder joints barely 0.05 apart, two such arms also stack into
 * a single bone with a claw wrapped round it. Hung back past the spine both arms
 * clear the cage completely and the negative space finally shows in profile.
 */
const BARE_OFF_HAND_BACK = -0.03;
const BARE_WEAPON_HAND_BACK = -0.1;
/** How far behind vertical a bare arm hangs edge-on, clear of the ribcage. */
const BARE_ARM_HANG_BACK = deg(-13);

function idleSide(phase: number, drifts: boolean, carriesProp: boolean): SkeletonPose {
  const angle = phase * TWO_PI;
  const base = idleBase(phase, drifts);
  const offHand = carriesProp ? PROP_OFF_HAND_FORWARD : BARE_OFF_HAND_BACK;
  const weaponHand = carriesProp ? PROP_WEAPON_HAND_FORWARD : BARE_WEAPON_HAND_BACK;
  // Bare arms are driven from joint angles rather than hand targets. Solved from
  // a target, the elbow flare bows the two arms in opposite *screen* directions
  // — which head-on holds them off the ribs, and edge-on throws one forward and
  // one back into a diagonal X across the chest. A carrier keeps its targets,
  // because where the shield and the bow end up is the whole point of them.
  const hangAngles: ArmAngles = {
    upper: BARE_ARM_HANG_BACK,
    fore: BARE_ARM_HANG_BACK - deg(4),
    foreScale: 1,
  };
  return {
    ...base,
    lean: deg(3),
    ...profileStance(0, base.leftFoot.y),
    // In profile a pose's X is depth, not width. The head-on spreads become
    // fore-and-aft reach: a third of a tile of it holds both arms out in front
    // of the chest like a sleepwalker.
    leftHand: pt(offHand, base.leftHand.y),
    rightHand: pt(weaponHand + 0.02 * Math.sin(angle), base.rightHand.y),
    leftArmAngles: carriesProp ? null : hangAngles,
    rightArmAngles: carriesProp
      ? null
      : { ...hangAngles, upper: hangAngles.upper + deg(4) * Math.sin(angle) },
  };
}

function idleBack(phase: number, drifts: boolean): SkeletonPose {
  return {
    ...idleFront(phase, drifts),
    headTurn: -0.12 * Math.sin(phase * TWO_PI * 0.5),
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

interface CastPhases {
  /** The arm drawing back and the orb condensing in the palm. */
  readonly gather: number;
  /** The forward thrust that launches the bolt. */
  readonly thrust: number;
  readonly recover: number;
  /** How much orb is showing in the palm right now. */
  readonly charge: number;
}

function castPhases(progress: number): CastPhases {
  const gather = easeInOut(ramp(progress, 0, CAST_GATHER_END));
  const thrust = easeInOut(ramp(progress, CAST_GATHER_END, CAST_THRUST_END));
  const recover = easeInOut(ramp(progress, CAST_THRUST_END, 1));
  return {
    gather,
    thrust,
    recover,
    // The charge has to be gone the instant the thrust launches it, or the glow
    // stops being a usable warning and becomes decoration.
    charge:
      clamp01(ramp(progress, 0.05, CAST_GATHER_END)) *
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
    ...restingPose(),
    lean: deg(-6) * coil + deg(10) * drive,
    bob: 0.012 * coil + 0.006 * drive,
    crouch: 0.08 * coil,
    ...profileStance(CAST_FOOT_LEAD * drive),
    // Drawn back beside the ribs rather than up beside the skull: at head height
    // the condensing orb sits exactly on the jaw and the lord reads as blowing a
    // bubble rather than as gathering something in his hand.
    rightHand: pt(
      lerp(0.3, -0.16, coil) + 0.66 * drive,
      lerp(HAND_HANG_Y, SHOULDER_Y + 0.16, coil) + 0.06 * drive,
    ),
    leftHand: pt(-0.26 - 0.05 * coil, HAND_HANG_Y - 0.05 * coil),
    rightClaw: lerp(0.3, 1, coil) * (1 - drive * 0.5),
    leftClaw: 0.8,
    rightPalmGlow: s.charge,
    headTilt: deg(-6) * coil + deg(9) * drive,
    jaw: 0.15 + 0.6 * coil,
    robeFlare: 0.3 + 0.55 * drive,
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
    // arm coming *toward* the camera: the hand drops down the screen and the orb
    // grows instead of travelling.
    rightHand: pt(lerp(0.3, 0.2, coil), lerp(HAND_HANG_Y, SHOULDER_Y + 0.12, coil) + 0.14 * drive),
    leftHand: pt(-0.3, HAND_HANG_Y - 0.04 * coil),
    leftForeshorten: 1,
    rightForeshorten: 1,
    headTilt: 0,
    headTurn: 0.12 * drive,
  };
}

function castBack(progress: number): SkeletonPose {
  return {
    ...castFront(progress),
    // From behind the orb is on the far side of the body and mostly hidden; the
    // read is the shoulder driving forward and the robe flaring. Anything more
    // expressive here would be invented.
    leftArmBehind: true,
    rightArmBehind: false,
    headTurn: 0,
  };
}

// ── Grasping hands ───────────────────────────────────────────────────────────

/**
 * The wind-up for the ground attack: both arms sweep low and out, the robe
 * flares, and the witch-light drops to the hem. The red cone telegraph runs on
 * top of this the whole time it plays, so the pose has to read as *committed* —
 * a player who thinks he might still be deciding will not move.
 */
const HANDS_SWEEP_END = 0.62;

function handsCastSide(progress: number): SkeletonPose {
  const sweep = easeInOut(ramp(progress, 0.08, HANDS_SWEEP_END));
  const slam = easeOut(ramp(progress, HANDS_SWEEP_END, 0.85));
  const settle = easeInOut(ramp(progress, 0.85, 1));
  const commit = sweep * (1 - settle);
  return {
    ...restingPose(),
    crouch: 0.3 * commit + 0.15 * slam,
    lean: deg(16) * commit,
    bob: 0.02 * commit,
    ...profileStance(),
    leftHand: pt(-0.34 - 0.14 * commit, HAND_HANG_Y + 0.18 * commit + 0.06 * slam),
    rightHand: pt(0.34 + 0.2 * commit, HAND_HANG_Y + 0.18 * commit + 0.06 * slam),
    leftClaw: 1,
    rightClaw: 1,
    leftPalmGlow: commit * 0.85,
    rightPalmGlow: commit * 0.85,
    elbowFlare: 0.6,
    headTilt: deg(12) * commit,
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
    lean: deg(6) * easeInOut(ramp(progress, 0.08, HANDS_SWEEP_END)),
    leftForeshorten: 1,
    rightForeshorten: 1,
  };
}

function handsCastBack(progress: number): SkeletonPose {
  // Both arms sweep low and out in front of him, so from behind both are on the
  // far side of the trunk. Left at false this row baked identical to the front
  // one and the away-facing wind-up showed him with his arms on the near side.
  return { ...handsCastFront(progress), leftArmBehind: true, rightArmBehind: true };
}

// ── Summon ───────────────────────────────────────────────────────────────────

/**
 * Both hands thrown overhead with a sustained flare.
 *
 * Baked in one facing only. The lord's other rows all read from four directions,
 * but this one is a held, symmetrical, arms-overhead pose: mirrored to profile
 * it is two arms drawn on top of each other, and from behind it is a robe with
 * nothing happening above it. A single camera-facing row is both the clearest
 * read and the honest one — the creature turns to face the party before it
 * summons, which is what a summon is for.
 */
/** How far off the ground the summon lifts him, in tile units. */
const SUMMON_LIFT = 0.045;
/** Where his feet rest, matching `restingPose`'s own spread. */
const RESTING_FOOT_SPREAD = 0.115;
const SUMMON_RAISE_END = 0.35;
const SUMMON_HOLD_END = 0.78;

function summonFront(progress: number): SkeletonPose {
  const raise = easeOut(ramp(progress, 0, SUMMON_RAISE_END));
  const drop = easeInOut(ramp(progress, SUMMON_HOLD_END, 1));
  const held = raise * (1 - drop);
  const flare = 0.5 + 0.5 * Math.sin(progress * TWO_PI * 3);
  return {
    ...restingPose(),
    lean: deg(-8) * held,
    // He rises off the floor on the flare, feet and all — the one moment the
    // lord is unambiguously not walking.
    bob: -SUMMON_LIFT * held,
    leftFoot: pt(-RESTING_FOOT_SPREAD, -SUMMON_LIFT * held),
    rightFoot: pt(RESTING_FOOT_SPREAD, -SUMMON_LIFT * held),
    leftHand: pt(-0.34 - 0.08 * held, lerp(HAND_HANG_Y, SHOULDER_Y - ARM_LENGTH * 0.86, held)),
    rightHand: pt(0.34 + 0.08 * held, lerp(HAND_HANG_Y, SHOULDER_Y - ARM_LENGTH * 0.86, held)),
    leftClaw: 1,
    rightClaw: 1,
    leftPalmGlow: held * lerp(0.7, 1, flare),
    rightPalmGlow: held * lerp(0.7, 1, flare),
    elbowFlare: -0.4,
    headTilt: deg(-10) * held,
    jaw: 0.2 + 0.75 * held,
    leftForeshorten: 1,
    rightForeshorten: 1,
    robeFlare: 0.3 + 0.5 * held,
    glow: 0.5 + 0.5 * held * lerp(0.6, 1, flare),
    time: progress,
  };
}

// ── Sword slash ──────────────────────────────────────────────────────────────

const SLASH_WINDUP_END = SWORD_SLASH_IMPACT_PROGRESS - 0.18;

function slashSide(progress: number): SkeletonPose {
  const wind = easeIn(ramp(progress, 0, SLASH_WINDUP_END));
  const strike = easeOut(ramp(progress, SLASH_WINDUP_END, SWORD_SLASH_IMPACT_PROGRESS + 0.12));
  const follow = easeInOut(ramp(progress, SWORD_SLASH_IMPACT_PROGRESS + 0.12, 1));
  const raised = wind * (1 - strike);
  const swung = strike * (1 - follow * 0.55);
  return {
    ...restingPose(),
    lean: deg(-10) * raised + deg(14) * swung,
    twist: -0.6 * raised + 0.7 * swung,
    crouch: 0.06 + 0.14 * swung,
    // The hand stays high through the strike and the blade angle does the work.
    // Authored under any ground clearance clamp: a swing that gets capped lies
    // flat for the whole of its impact and no amount of tuning shows it up.
    rightHand: pt(
      lerp(0.3, -0.06, raised) + 0.44 * swung,
      lerp(HAND_HANG_Y, SHOULDER_Y - 0.22, raised) + 0.36 * swung,
    ),
    leftHand: pt(-0.3 - 0.08 * raised + 0.06 * swung, HAND_HANG_Y - 0.16 * raised - 0.02 * swung),
    rightClaw: 0.1,
    leftClaw: 0.2,
    rightFoot: pt(0.115 + 0.08 * swung, 0),
    leftFoot: pt(-0.125 - 0.03 * raised, 0),
    headTilt: deg(-6) * raised + deg(8) * swung,
    jaw: 0.15 + 0.65 * swung,
    glow: 0.3 + 0.4 * swung,
    time: progress,
  };
}

function slashFront(progress: number): SkeletonPose {
  const side = slashSide(progress);
  const strike = easeOut(ramp(progress, SLASH_WINDUP_END, SWORD_SLASH_IMPACT_PROGRESS + 0.12));
  return {
    ...side,
    lean: side.lean * 0.4,
    // Head-on the chop comes down the screen rather than across it, so the arm
    // crosses the body instead of reaching past its own shoulder.
    rightHand: pt(lerp(side.rightHand.x, 0.02, 0.5), side.rightHand.y + 0.06 * strike),
    leftForeshorten: 1,
    rightForeshorten: 1,
  };
}

function slashBack(progress: number): SkeletonPose {
  return { ...slashFront(progress), leftArmBehind: true, rightArmBehind: false };
}

// ── Draw and loose ───────────────────────────────────────────────────────────

const DRAW_END = BONE_ARROW_RELEASE_PROGRESS - 0.12;

function drawLooseSide(progress: number): SkeletonPose {
  const draw = easeInOut(ramp(progress, 0.05, DRAW_END));
  const loose = easeOut(ramp(progress, BONE_ARROW_RELEASE_PROGRESS - 0.02, 1));
  const held = draw * (1 - loose);
  return {
    ...restingPose(),
    lean: deg(-3),
    twist: 0.3 * held,
    // The bow arm goes out first and *stays* out through the loose; only the
    // string hand travels. A bow arm that recoils with the string reads as the
    // archer dropping the bow.
    leftHand: pt(
      lerp(-0.3, 0.44, easeInOut(ramp(progress, 0, 0.3))),
      lerp(HAND_HANG_Y, SHOULDER_Y + 0.05, easeInOut(ramp(progress, 0, 0.3))),
    ),
    rightHand: pt(lerp(0.3, -0.06, held) + 0.1 * loose, lerp(HAND_HANG_Y, SHOULDER_Y + 0.02, draw)),
    leftClaw: 0.15,
    rightClaw: lerp(0.25, 0.05, held) + 0.7 * loose,
    ...profileStance(),
    headTilt: deg(4) * held,
    jaw: 0.12,
    glow: 0.3 + 0.35 * held,
    time: progress,
  };
}

function drawLooseFront(progress: number): SkeletonPose {
  const side = drawLooseSide(progress);
  return {
    ...side,
    ...facingStance(),
    twist: 0,
    // Head-on the bow is held across the body and the draw pulls back toward the
    // camera, so the string hand drops rather than travelling sideways.
    leftHand: pt(-0.3, side.leftHand.y),
    rightHand: pt(0.24, side.rightHand.y),
    leftForeshorten: 1,
    rightForeshorten: 1,
  };
}

function drawLooseBack(progress: number): SkeletonPose {
  // Seen from behind, an archer aiming away from the camera has *both* arms on
  // the far side of its own ribs — the bow arm out front and the string hand
  // drawn back past the far shoulder.
  return { ...drawLooseFront(progress), leftArmBehind: true, rightArmBehind: true };
}

// ── Rise ─────────────────────────────────────────────────────────────────────

const RISE_HAND_END = 0.3;
const RISE_SHOULDER_END = 0.7;

/**
 * Climbing out of the ground: a hand punches up through the soil, then the
 * shoulders, then the thing hauls itself upright.
 *
 * Driven by `sink`, which clips everything below the ground line and paints a
 * broken-earth mound at it — so the emergence is real occlusion rather than the
 * figure sliding up from behind an opaque rectangle.
 */
function risePose(progress: number): SkeletonPose {
  const reach = easeOut(ramp(progress, 0, RISE_HAND_END));
  const haul = easeInOut(ramp(progress, RISE_HAND_END, RISE_SHOULDER_END));
  const stand = easeInOut(ramp(progress, RISE_SHOULDER_END, 1));
  const sink = FIGURE_HEIGHT * (1 - easeInOut(clamp01(progress / RISE_SHOULDER_END))) * (1 - stand);
  return {
    ...restingPose(),
    sink,
    crouch: 0.75 * (1 - stand),
    lean: deg(26) * (1 - stand),
    // The lead hand is thrown straight up and holds there while the rest of the
    // body catches up to it, which is the whole read of the row.
    rightHand: pt(
      lerp(0.3, 0.14, reach),
      lerp(HAND_HANG_Y, SHOULDER_Y - ARM_LENGTH * 0.8, reach) + 0.24 * stand,
    ),
    leftHand: pt(lerp(-0.3, -0.26, haul), lerp(HAND_HANG_Y, SHOULDER_Y + 0.14, haul) + 0.2 * stand),
    rightClaw: lerp(1, 0.5, stand),
    leftClaw: lerp(0.9, 0.5, stand),
    leftForeshorten: 1,
    rightForeshorten: 1,
    headTilt: deg(-18) * (1 - stand),
    jaw: 0.15 + 0.7 * haul * (1 - stand),
    glow: 0.3 + 0.6 * haul,
    time: progress,
  };
}

// ── Row manifest ─────────────────────────────────────────────────────────────

type View = 'front' | 'side' | 'back';
export type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: View;
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

/**
 * The six rows every variant shares.
 *
 * `drifts` makes the idle a hover rather than a stand; `carriesProp` widens the
 * profile arm spread so a shield or a bow clears the body. Both are properties
 * of the variant, not of the row, which is why they are threaded through rather
 * than branched on inside each pose.
 */
function movementRows(drifts: boolean, carriesProp: boolean): RowSpec[] {
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
      pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES), carriesProp),
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
      pose: (f) => idleFront(cyclePhase(f, IDLE_FRAMES), drifts),
    },
    {
      name: 'idle_side',
      frameCount: IDLE_FRAMES,
      kind: 'loop',
      view: 'side',
      pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES), drifts, carriesProp),
    },
    {
      name: 'idle_away',
      frameCount: IDLE_FRAMES,
      kind: 'loop',
      view: 'back',
      pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES), drifts),
    },
  ];
}

const GORE_ROW: RowSpec = {
  name: 'gore',
  frameCount: SKELETON_GORE_STATES.length,
  kind: 'gore',
  view: 'side',
  pose: null,
};

function lordRows(): RowSpec[] {
  return [
    ...movementRows(true, false),
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

function swordRows(): RowSpec[] {
  return [
    ...movementRows(false, true),
    {
      name: 'slash',
      frameCount: SLASH_FRAMES,
      kind: 'oneShot',
      view: 'front',
      pose: (f) => slashFront(shotProgress(f, SLASH_FRAMES)),
    },
    {
      name: 'slash_side',
      frameCount: SLASH_FRAMES,
      kind: 'oneShot',
      view: 'side',
      pose: (f) => slashSide(shotProgress(f, SLASH_FRAMES)),
    },
    {
      name: 'slash_away',
      frameCount: SLASH_FRAMES,
      kind: 'oneShot',
      view: 'back',
      pose: (f) => slashBack(shotProgress(f, SLASH_FRAMES)),
    },
    {
      name: 'rise',
      frameCount: RISE_FRAMES,
      kind: 'oneShot',
      view: 'front',
      pose: (f) => risePose(shotProgress(f, RISE_FRAMES)),
    },
    GORE_ROW,
  ];
}

function archerRows(): RowSpec[] {
  return [
    ...movementRows(false, true),
    {
      name: 'draw_loose',
      frameCount: DRAW_LOOSE_FRAMES,
      kind: 'oneShot',
      view: 'front',
      pose: (f) => drawLooseFront(shotProgress(f, DRAW_LOOSE_FRAMES)),
    },
    {
      name: 'draw_loose_side',
      frameCount: DRAW_LOOSE_FRAMES,
      kind: 'oneShot',
      view: 'side',
      pose: (f) => drawLooseSide(shotProgress(f, DRAW_LOOSE_FRAMES)),
    },
    {
      name: 'draw_loose_away',
      frameCount: DRAW_LOOSE_FRAMES,
      kind: 'oneShot',
      view: 'back',
      pose: (f) => drawLooseBack(shotProgress(f, DRAW_LOOSE_FRAMES)),
    },
    {
      name: 'rise',
      frameCount: RISE_FRAMES,
      kind: 'oneShot',
      view: 'front',
      pose: (f) => risePose(shotProgress(f, RISE_FRAMES)),
    },
    GORE_ROW,
  ];
}

/** Every sheet this generator bakes, keyed by its manifest key. */
export interface SheetSpec {
  readonly variant: SkeletonVariant;
  /** Manifest key and PNG basename. */
  readonly key: string;
  readonly rows: readonly RowSpec[];
}

export const SHEETS: readonly SheetSpec[] = [
  { variant: 'lord', key: 'skeleton_lord', rows: lordRows() },
  { variant: 'sword', key: 'skeleton_sword', rows: swordRows() },
  { variant: 'archer', key: 'skeleton_archer', rows: archerRows() },
];

export function sheetPathFor(key: string): string {
  return `src/images/enemies/${key}.png`;
}

const MANIFEST_PATH = 'src/images/enemies/manifest.json';

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
  readonly paint: (ctx: Ctx, originX: number, originY: number) => void;
}

/**
 * Extra scale applied to the loose bones on top of the variant's own.
 *
 * **1.0 — the pieces are drawn at the size they are meant to be.** This was
 * 1.85, on the reasoning that the bones "still have to survive the runtime's
 * 0.5×". That 0.5× is real but it is not theirs: the sheet is authored at
 * `tileScale` 64 and drawn at a 32 px tile, so *everything* on it — the walk,
 * the idle, the figure the bones came out of — is halved by the same factor.
 * Inflating only the gore to compensate made the bones 1.85× too big relative
 * to the skeleton, which is exactly how it looked in play: a femur measured
 * 1.09 tiles against a body 1.61 tiles tall, and the archer's skull came out
 * wider than the archer.
 *
 * The legibility problem it was solving is real, but it belongs to the review
 * harness, which should zoom rather than have the art lie about its size.
 */
const GORE_PIECE_SCALE = 1;

function buildJobs(spec: SheetSpec, goreOffsets?: ReadonlyMap<number, Pt>): FrameJob[] {
  const jobs: FrameJob[] = [];
  const figureScale = VARIANT_HEIGHT_TILES[spec.variant] / FIGURE_HEIGHT;
  // Scaled by the variant like the figure is: the pieces are drawn at their own
  // tile-unit sizes rather than sliced off the body, so without this the Lord's
  // bones and an archer's were identical despite a whole tile of height between
  // them.
  const goreUnit = TILE_SCALE * GORE_PIECE_SCALE * figureScale;
  const pieces = skeletonGorePieces(spec.variant);

  for (const row of spec.rows) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      if (row.kind === 'gore') {
        const piece = pieces[frame];
        const recentre = goreOffsets?.get(frame) ?? { x: 0, y: 0 };
        jobs.push({
          row,
          frame,
          anchor: 'cellCentre',
          paint: (ctx, originX, originY) => {
            ctx.save();
            ctx.translate(originX + recentre.x * goreUnit, originY + recentre.y * goreUnit);
            ctx.scale(goreUnit, goreUnit);
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
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          // Scaled about the ground line, so a taller variant still stands on
          // the tile its feet belong to rather than floating above it.
          ctx.scale(figureScale, figureScale);
          const posed = pose(frame);
          if (view === 'front') drawSkeletonFront(ctx, posed, spec.variant);
          else if (view === 'back') drawSkeletonBack(ctx, posed, spec.variant);
          else drawSkeletonSide(ctx, posed, spec.variant);
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
const MEASURE_SIZE = 640;

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
  const goreUnit = TILE_SCALE * GORE_PIECE_SCALE;
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
    cellCtx.save();
    cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    const originY =
      job.anchor === 'cellCentre' ? geometry.frameHeight / 2 : geometry.tileY + TILE_SCALE / 2;
    job.paint(cellCtx, geometry.frameWidth / 2, originY);
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
 * Comparing the pose at phase 0 with the pose at phase 1 — the obvious loop
 * check, and the one this gate used to be — is worthless here: every pose in
 * this file is built from sinusoids of the phase and from `gaitStep`, whose
 * first line wraps its argument into [0,1). Both are identical at 0 and 1 *by
 * construction*, so the gate could not fail for any row written in the style of
 * the rows it was guarding. What actually catches a pop is measuring how far the
 * figure moves between each pair of adjacent frames and asking whether the wrap
 * from the last frame back to the first is out of line with the rest.
 */
const MAX_LOOP_SEAM_RATIO = 2.2;

/**
 * Headroom a leg must keep under its own full extension, in tile units.
 *
 * A walking leg is nearly as long as the hip is high, so a foot planted a full
 * stride ahead can be out of reach from standing height: the IK clamps, the leg
 * locks straight and the foot hangs above the floor. A stride that clamps on
 * even one frame reads as a hop, and the sheet looks perfectly fine — the only
 * way to catch it is numerically.
 */
const MIN_LEG_REACH_HEADROOM = 0.002;

/**
 * How far the tallest ink may sit from the top of the cell before the padding is
 * doing nothing. A frame whose ink touches the border has already been clipped
 * somewhere the eye will find before any assertion does.
 */
const MIN_BORDER_CLEARANCE_PX = 1;

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

function runGates(spec: SheetSpec, baked: BakedSheet, jobs: readonly FrameJob[]): void {
  // 1. Loop seam. A walk or idle whose last frame does not lead back into its
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
        `${spec.key}/${row.name}: the loop does not close — the step across the seam is ` +
          `${(seam / typical).toFixed(2)}x the median step, which pops once per cycle`,
      );
    }
  }

  // 2. Leg reach. Checked on every frame of every row, including the one-shots:
  // a crouch or a lunge can put a foot out of reach just as easily as a stride.
  for (const row of spec.rows) {
    if (row.pose === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      const headroom = legReachHeadroom(pose, lateralFor(row.view));
      if (headroom < MIN_LEG_REACH_HEADROOM) {
        throw new Error(
          `${spec.key}/${row.name}[${frame}]: a leg is over-extended by ` +
            `${(MIN_LEG_REACH_HEADROOM - headroom).toFixed(4)} tiles — the IK clamps and the ` +
            `foot hangs off the floor, which reads as a hop`,
        );
      }
    }
  }

  // 3. Border clearance. Measured off the baked pixels rather than off the pose,
  // because the thing that clips is always something the pose does not know it
  // draws — a crown spike, a sword tip, a flared hem.
  const canvas = createCanvas(baked.geometry.frameWidth, baked.geometry.frameHeight);
  const ctx = canvas.getContext('2d');
  for (const job of jobs) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const originY =
      job.anchor === 'cellCentre'
        ? baked.geometry.frameHeight / 2
        : baked.geometry.tileY + TILE_SCALE / 2;
    job.paint(ctx, baked.geometry.frameWidth / 2, originY);
    const box = inkBoxOf(ctx, canvas.width, canvas.height);
    if (box === null) continue;
    const clearance = Math.min(
      box.minX,
      box.minY,
      canvas.width - 1 - box.maxX,
      canvas.height - 1 - box.maxY,
    );
    if (clearance < MIN_BORDER_CLEARANCE_PX) {
      throw new Error(
        `${spec.key}/${job.row.name}[${job.frame}]: ink reaches the cell border (clearance ` +
          `${clearance}px) — the frame is being cut off`,
      );
    }
  }

  // 4. Every gore piece has to be nameable, which starts with it being big
  // enough to have a shape at all once the runtime halves it.
  const goreRow = spec.rows.find((row) => row.kind === 'gore');
  if (goreRow !== undefined && goreRow.frameCount !== SKELETON_GORE_STATES.length) {
    throw new Error(
      `${spec.key}: the gore row holds ${goreRow.frameCount} cells but SKELETON_GORE_STATES names ` +
        `${SKELETON_GORE_STATES.length} — the runtime would spawn a state that is not on the sheet`,
    );
  }
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

/** The manifest entry this bake requires, exported so `verifyManifest` and the
 * paste-helper cannot derive it two different ways. */
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
 * their edits. A mismatch prints the entries to paste and fails the run — a
 * sheet on disk that its manifest does not describe renders as garbage.
 */
function verifyManifest(sheets: readonly BakedSheet[]): void {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };

  const stale: string[] = [];
  for (const sheet of sheets) {
    const required = manifestEntryFor(sheet);
    if (canonicalJson(manifest[sheet.key]) !== canonicalJson(required)) {
      stale.push(`"${sheet.key}": ${JSON.stringify(required, null, 2)}`);
    }
  }
  if (stale.length > 0) {
    console.error(
      `\n${MANIFEST_PATH} is out of sync with the bake. Replace these entries with:\n\n` +
        `${stale.join(',\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

function writeSheets(): void {
  console.log(`Generating skeleton sprite sheets (tileScale=${TILE_SCALE})…`);
  const baked: BakedSheet[] = [];
  for (const spec of SHEETS) {
    const sheet = bakeSheet(spec);
    const path = sheetPathFor(spec.key);
    writeFileSync(resolve(path), sheet.buffer);
    baked.push(sheet);
    console.log(
      `  → ${path}  ${sheet.columns * sheet.geometry.frameWidth}×` +
        `${spec.rows.length * sheet.geometry.frameHeight}px  (${spec.rows.length} rows × ` +
        `${sheet.columns} cols of ${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight}, ` +
        `${VARIANT_HEIGHT_TILES[spec.variant]} tiles tall)`,
    );
    console.log(`     tileX=${sheet.geometry.tileX}  tileY=${sheet.geometry.tileY}`);
    spec.rows.forEach((row, index) => {
      console.log(`     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view})`);
    });
  }
  verifyManifest(baked);
}

// The review harness imports SHEETS from here, so painting has to be something
// this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheets();
}
