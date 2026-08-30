/**
 * The three skeletons — the Skeleton Lord and the sword and bow warriors that
 * escort him — as painted figures: the choreography, the cell geometry, and the
 * `FigureDef`s the runtime cache and the review harness both draw through.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row tables, and the placement of a pose or a loose bone inside its cell.
 * Anatomy, gear and every stroke of paint live in `skeletonArt.ts`, the loose
 * bones in `skeletonGore.ts`.
 *
 * Three figures rather than one, following the goblin precedent: the variants
 * differ in height by more than half a tile, and a shared cell sized for the
 * lord would leave every warrior frame mostly empty — which the cache would pay
 * for on every cell it holds.
 *
 * The art invariants live in `scripts/gates-skeletons.ts`, which the review
 * harness runs: `npm run render:skeletons`.
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  ARM_LENGTH,
  FIGURE_HEIGHT,
  SHOULDER_JOINT_DROP,
  SHOULDER_Y,
  type ArmAngles,
  type Pt,
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
  lerp,
  ramp,
  restingPose,
  TWO_PI,
} from './skeletonArt';
import { SKELETON_GORE_STATES, skeletonGorePieces, type SkeletonGorePiece } from './skeletonGore';
// The release fractions are shared with the runtime rather than copied here; see
// the header of that module for what goes wrong when the two drift.
import {
  BONE_ARROW_RELEASE_PROGRESS,
  SOUL_BOLT_RELEASE_PROGRESS,
  SOUL_BOLT_THRUST_SHARE,
  SWORD_SLASH_IMPACT_PROGRESS,
} from '../skeletonTiming';

type Ctx = CanvasRenderingContext2D;

// ── Cell geometry ────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * How many tiles tall each variant stands, applied about its own ground line so
 * the feet stay on the tile they belong to.
 *
 * The rig is authored once at {@link FIGURE_HEIGHT} and scaled here rather than
 * being re-proportioned per variant: scaling the anatomy tables instead would
 * leave the choreography, the gear and the gore at the original size and
 * silently redraw the animation.
 */
const VARIANT_HEIGHT_TILES: Readonly<Record<SkeletonVariant, number>> = {
  lord: 2.5,
  sword: 1.55,
  archer: 1.5,
};

/**
 * Walks are sampled denser than everything else because a gait is the one
 * animation a player watches for minutes at a time. Twelve rather than Carl's
 * sixteen: these are mobs seen at a distance, and four extra columns buys
 * smoothness nobody is close enough to see.
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
 * even one frame reads as a hop, and an art gate measures it: the first
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
  // far side of the trunk. Left at false this row paints identical to the front
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

// ── Row manifest ────────────────────────────────────────────────────

type View = 'front' | 'side' | 'back';
export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: View;
  readonly pose: (frame: number) => SkeletonPose;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

export function shotProgress(frame: number, frameCount: number): number {
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
  ];
}

// ── Cells ─────────────────────────────────────────────────────────────

/**
 * The cell each variant's poses and loose bones are painted into, and where the
 * creature's own tile sits inside it.
 *
 * These four numbers per variant were measured by the bake this figure replaces
 * — the widest pose plus padding, quantised — and `scripts/parity-figure-sheet.ts`
 * is what proved the painters still fill exactly those cells. The gates re-check
 * that nothing paints against an edge, which is what would say a pose has
 * outgrown them.
 */
interface CellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

const CELLS: Readonly<Record<SkeletonVariant, CellGeometry>> = {
  lord: { frameWidth: 128, frameHeight: 208, tileX: 32, tileY: 157 },
  sword: { frameWidth: 120, frameHeight: 152, tileX: 28, tileY: 104 },
  archer: { frameWidth: 80, frameHeight: 120, tileX: 8, tileY: 73 },
};

export function figureScaleOf(variant: SkeletonVariant): number {
  return VARIANT_HEIGHT_TILES[variant] / FIGURE_HEIGHT;
}

/**
 * Cell pixels per unit of a loose bone's own drawing space.
 *
 * Scaled by the variant exactly like the figure is: the pieces are drawn at
 * their own tile-unit sizes rather than sliced off the body, so without this the
 * Lord's bones and an archer's would be identical despite a whole tile of height
 * between them.
 */
export function goreUnitOf(variant: SkeletonVariant): number {
  return TILE_SCALE * figureScaleOf(variant);
}

export const GORE_STATES: readonly string[] = SKELETON_GORE_STATES;

function gorePieceOf(variant: SkeletonVariant, state: string): SkeletonGorePiece {
  const piece = skeletonGorePieces(variant).find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`${variant} has no gore piece for "${state}"`);
  return piece;
}

/**
 * How far each loose bone is nudged, in cell pixels, so that its ink — not its
 * authoring origin — sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own visible pixels,
 * so a piece drawn off-centre in its cell orbits rather than tumbles. The
 * numbers were measured from the painted ink of each piece. Measuring is
 * something only an offline pass can do, so they are frozen here and
 * `scripts/gates-skeletons.ts` re-measures the result on every render — it
 * paints each piece into its real cell and asserts the ink lands on the centre.
 *
 * One table per variant: a piece is drawn at the variant's own scale, and a
 * rasterised bounding box is not something that scales exactly.
 */
export const GORE_RECENTRE_PX: Readonly<Record<SkeletonVariant, ReadonlyMap<string, Pt>>> = {
  lord: new Map([
    ['gore_skull', pt(0.6157635467980296, 2.4630541871921183)],
    ['gore_ribcage', pt(0.6157635467980296, -1.2315270935960592)],
    ['gore_pelvis', pt(0.6157635467980296, 1.8472906403940887)],
    ['gore_femur', pt(0.6157635467980296, 0.6157635467980296)],
    ['gore_tibia', pt(1.2315270935960592, 0.6157635467980296)],
    ['gore_forearm', pt(1.2315270935960592, 0.6157635467980296)],
    ['gore_hand', pt(1.2315270935960592, -3.6945812807881775)],
  ]),
  sword: new Map([
    ['gore_skull', pt(0.38177339901477836, 1.145320197044335)],
    ['gore_ribcage', pt(0.38177339901477836, -0.38177339901477836)],
    ['gore_pelvis', pt(0.38177339901477836, 1.145320197044335)],
    ['gore_femur', pt(0.7635467980295567, 0.38177339901477836)],
    ['gore_tibia', pt(0.7635467980295567, 0.38177339901477836)],
    ['gore_forearm', pt(0.7635467980295567, 0.38177339901477836)],
    ['gore_hand', pt(0.38177339901477836, -1.145320197044335)],
  ]),
  archer: new Map([
    ['gore_skull', pt(0.3694581280788178, 1.1083743842364533)],
    ['gore_ribcage', pt(0.3694581280788178, -0.3694581280788178)],
    ['gore_pelvis', pt(0.3694581280788178, 1.1083743842364533)],
    ['gore_femur', pt(0.7389162561576356, 0.3694581280788178)],
    ['gore_tibia', pt(0.7389162561576356, 0.3694581280788178)],
    ['gore_forearm', pt(0.7389162561576356, 0.3694581280788178)],
    ['gore_hand', pt(0.7389162561576356, -1.1083743842364533)],
  ]),
};

function goreRecentreOf(variant: SkeletonVariant, state: string): Pt {
  const offset = GORE_RECENTRE_PX[variant].get(state);
  if (offset === undefined) throw new Error(`${variant} freezes no recentring for "${state}"`);
  return offset;
}

function paintView(ctx: Ctx, view: View, pose: SkeletonPose, variant: SkeletonVariant): void {
  if (view === 'front') drawSkeletonFront(ctx, pose, variant);
  else if (view === 'back') drawSkeletonBack(ctx, pose, variant);
  else drawSkeletonSide(ctx, pose, variant);
}

export const SKELETON_ROWS: Readonly<Record<SkeletonVariant, readonly RowSpec[]>> = {
  lord: lordRows(),
  sword: swordRows(),
  archer: archerRows(),
};

function stateFrames(variant: SkeletonVariant): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of SKELETON_ROWS[variant]) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

/**
 * Paints one cell of a skeleton, in the cell's own pixels.
 *
 * A pose row is anchored at the ground line under the cell's centre, which is
 * what ties the art to the tile the creature stands on. A loose bone is anchored
 * at the cell's centre instead, because the only thing that reads its cell is
 * the spin the gore field applies about that point.
 */
function paintSkeletonFrame(
  variant: SkeletonVariant,
  ctx: Ctx,
  state: string,
  frame: number,
): void {
  const cell = CELLS[variant];
  const row = SKELETON_ROWS[variant].find((candidate) => candidate.name === state);
  if (row === undefined) {
    const unit = goreUnitOf(variant);
    const recentre = goreRecentreOf(variant, state);
    ctx.save();
    ctx.translate(cell.frameWidth / 2 + recentre.x, cell.frameHeight / 2 + recentre.y);
    ctx.scale(unit, unit);
    gorePieceOf(variant, state).paint(ctx);
    ctx.restore();
    return;
  }
  const scale = TILE_SCALE * figureScaleOf(variant);
  ctx.save();
  ctx.translate(cell.frameWidth / 2, cell.tileY + TILE_SCALE / 2);
  // Scaled about the ground line, so a taller variant still stands on the tile
  // its feet belong to rather than floating above it.
  ctx.scale(scale, scale);
  paintView(ctx, row.view, row.pose(frame), variant);
  ctx.restore();
}

function figureFor(variant: SkeletonVariant, id: string): FigureDef {
  const cell = CELLS[variant];
  return {
    id,
    frameWidth: cell.frameWidth,
    frameHeight: cell.frameHeight,
    tileX: cell.tileX,
    tileY: cell.tileY,
    tileScale: TILE_SCALE,
    states: figureStates(stateFrames(variant)),
    paintFrame: (ctx, state, frame) => {
      paintSkeletonFrame(variant, ctx, state, frame);
    },
  };
}

export const SKELETON_LORD_FIGURE: FigureDef = figureFor('lord', 'skeleton_lord');
export const SKELETON_SWORD_FIGURE: FigureDef = figureFor('sword', 'skeleton_sword');
export const SKELETON_ARCHER_FIGURE: FigureDef = figureFor('archer', 'skeleton_archer');

/** The three figures by variant, for code that walks all of them. */
export const SKELETON_FIGURES: Readonly<Record<SkeletonVariant, FigureDef>> = {
  lord: SKELETON_LORD_FIGURE,
  sword: SKELETON_SWORD_FIGURE,
  archer: SKELETON_ARCHER_FIGURE,
};
