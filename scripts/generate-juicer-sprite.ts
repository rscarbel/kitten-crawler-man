/**
 * Bakes the Juicer sheet.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, the held-dumbbell anchor computation, and the tiling. Anatomy,
 * palette and every stroke of paint live in `scripts/juicerArt.ts`.
 *
 * The gait is `generate-human-sprite.ts`'s, scaled to a much heavier creature:
 * stance is a constant-rate backward slide so the contact rolls rather than
 * skates, swing is a keyed tuck → pass → reach, and the pelvis *drops* at
 * contact so the IK never clamps. Arms swing from joint angles, not from hand
 * targets — almost all of a walking arm's travel belongs to the shoulder, and
 * an arm placed by its hand cannot do that. Hand targets are kept for the two
 * one-shots, where the hands are going somewhere specific.
 *
 * Run through the gates, never directly: `npm run gen:juicer`.
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
  FOOT_STAND_SPREAD,
  FOREARM_LENGTH,
  HAND_HANG_DROP,
  HAND_HANG_SPREAD,
  type JuicerPose,
  type JuicerView,
  type Pt,
  SHOULDER_Y,
  UPPER_ARM_LENGTH,
  drawJuicerBack,
  drawJuicerFront,
  drawJuicerSide,
  pt,
  restingPose,
  solvedArm,
} from './juicerArt.js';
import { type GorePiece, juicerGorePieces } from './juicerGore.js';
import {
  JUICER_IDLE_FRAMES,
  JUICER_PUNCH_FRAMES,
  JUICER_PUNCH_IMPACT_PROGRESS,
  JUICER_SPRINT_FRAMES,
  JUICER_THROW_FRAMES,
  JUICER_THROW_RELEASE_PROGRESS,
  JUICER_WALK_FRAMES,
  juicerImpactSpriteFrame,
} from '../src/sprites/juicerAttackTiming.js';
import type { JuicerHandView, TileFraction } from '../src/sprites/juicerHandAnchor.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Where the floor sits inside the tile, matching the other dungeon mobs. */
export const GROUND_OFFSET_PX = 58;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
const FRAME_PADDING = 5;
const FRAME_SIZE_QUANTUM = 8;

export const SHEET_PATH = 'src/images/bosses/juicer.png';
const MANIFEST_PATH = 'src/images/bosses/manifest.json';
const SPRITE_KEY = 'juicer';
const SHEET_RELATIVE_PATH = 'bosses/juicer.png';

const FULL_TURN = Math.PI * 2;

// ── Gait ─────────────────────────────────────────────────────────────────────

/**
 * How far each foot travels either side of the hip through stance. Short legs
 * under a long trunk means the leg is barely longer than the hip is high, so a
 * foot planted much further out than this is beyond the leg's reach: the IK
 * clamps at the end of stance, the leg locks dead straight, and the next
 * frame's tuck snaps the knee back — the hitch that reads as a hop.
 */
const STRIDE = 0.27;
/** Foot height just after toe-off, when the knee is most folded. */
const TUCK_LIFT = 0.17;
/** The first, small lift as the toe leaves the floor. */
const TOE_LIFT = 0.042;
const TOE_LIFT_AT = 0.12;
/** Foot height as it passes under the hip. */
const PASS_LIFT = 0.125;
/** Foot height as it reaches out for the next contact. */
const REACH_LIFT = 0.016;
/** Where in the swing the tuck, the pass and the reach fall. */
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;
/** Half the cycle is stance, half is swing. */
const STANCE_SHARE = 0.5;

/**
 * The pelvis drops at contact by this much. A heavy creature's walk is mostly
 * this: the mass falling onto the planted leg and being caught by it.
 */
const WALK_BOB = 0.05;
const WALK_SWAY = 0.018;
const WALK_LEAN = deg(5);
const HEEL_STRIKE_PITCH = deg(-9);
const TOE_OFF_PITCH = deg(14);
const SWING_PITCH = deg(-6);

/**
 * Head-on the step reads only as height, so it takes nearly the full profile
 * lift to be legible at all; the pitch, by contrast, is almost invisible, and
 * the lateral travel collapses to a drift.
 */
const FACING_LIFT_SHARE = 0.95;
const FACING_PITCH_SHARE = 0.5;
const FACING_STRIDE_DRIFT = 0.085;
/**
 * How far toward the centreline a swinging foot is drawn at the passing
 * position, as a share of its own standing spread.
 */
const PASS_INSET = 0.55;
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
 * One foot of a profile gait. Through stance the foot is planted and slides
 * backward under the body at a constant rate — the body is what moves. Through
 * swing it tucks, passes and reaches.
 */
function gaitFootSide(phase: number, stride: number): { foot: Pt; pitch: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_SHARE;
  const t = stance ? cycle / STANCE_SHARE : (cycle - STANCE_SHARE) / (1 - STANCE_SHARE);

  if (stance) {
    return {
      foot: pt(lerp(stride, -stride, t), 0),
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
        [0, -stride],
        [TUCK_AT, -stride * 0.75],
        [PASS_AT, 0],
        [REACH_AT, stride * 0.8],
        [1, stride],
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
 * step is sold by the foot rising and the leg foreshortening rather than by any
 * sideways travel.
 */
function gaitFootFacing(
  phase: number,
  side: number,
  liftGain: number,
  driftGain: number,
): { foot: Pt; pitch: number; nearness: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_SHARE;
  const t = stance ? cycle / STANCE_SHARE : (cycle - STANCE_SHARE) / (1 - STANCE_SHARE);
  const home = side * FOOT_STAND_SPREAD;
  const drift = FACING_STRIDE_DRIFT * driftGain;

  if (stance) {
    return {
      foot: pt(home + drift * lerp(1, -1, t), 0),
      pitch: keyed(t, [
        [0, HEEL_STRIKE_PITCH * FACING_PITCH_SHARE],
        [0.2, 0],
        [0.75, 0],
        [1, TOE_OFF_PITCH * FACING_PITCH_SHARE],
      ]),
      nearness: 0,
    };
  }
  const lift =
    keyed(t, [
      [0, 0],
      [TOE_LIFT_AT, TOE_LIFT * FACING_LIFT_SHARE],
      [TUCK_AT, TUCK_LIFT * FACING_LIFT_SHARE],
      [PASS_AT, PASS_LIFT * FACING_LIFT_SHARE],
      [REACH_AT, REACH_LIFT],
      [1, 0],
    ]) * liftGain;
  // The swinging foot draws in toward the stance leg on its way through, so the
  // two feet visibly pass each other. Head-on that crossing is most of what
  // says "step": with the feet pinned at their standing spread the walk is a
  // pair of legs bobbing side by side, and the frame half a cycle later — which
  // should be the opposite-leg pose — comes out nearly identical to the first.
  const passing = home * PASS_INSET * Math.sin(t * Math.PI);
  return {
    foot: pt(home + drift * lerp(-1, 1, easeInOut(t)) - passing, -lift),
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
const ARM_SWING_ANGLE = deg(38);
/** An arm swings further forward than back, so the backswing is scaled down. */
const ARM_BACKSWING_SHARE = 0.55;
/** How much of the shoulder's swing the forearm inherits. */
const FOREARM_FOLLOW = 0.22;
/** The bend a walking elbow simply holds, keeping the forearm ahead of the arm. */
const ELBOW_FLEX = deg(16);

function armSwingAngle(forward: number, amplitude: number): number {
  const shortened = forward >= 0 ? forward : forward * ARM_BACKSWING_SHARE;
  return shortened * amplitude;
}

/**
 * A profile arm, driven from its joints rather than from a hand target. Almost
 * all of a walking arm's travel belongs to the shoulder; the elbow keeps a
 * near-constant bend and the forearm barely sweeps at all.
 */
function sideArmAngles(forward: number, amplitude: number, flex: number): ArmAngles {
  const upper = armSwingAngle(forward, amplitude);
  return { upper, fore: upper * FOREARM_FOLLOW + flex, foreScale: 1 };
}

/**
 * A relaxed arm is not a straight rod: the elbow carries a little standing
 * flexion, which gives the arm a readable break at the joint and holds it off
 * the ribs. The upper arm therefore tilts out further than the forearm does.
 */
const FACING_ELBOW_FLEX = deg(11);
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
const FACING_UPPER_SWING = deg(16);
const FACING_FOREARM_SWING = deg(30);
/**
 * How much of its length the forearm loses at the front of the swing.
 *
 * This is what the head-on gait is *read* by. In and out across the body is a
 * mirrored pair, so both hands travel the same way across the screen however
 * hard they swing and the alternation cannot be seen there; the arm coming
 * forward is instead the one whose hand rides higher, and the two hands have to
 * sit at obviously different heights for a viewer to see a stride at all.
 */
const FACING_FOREARM_FORESHORTEN = 0.32;
const WALK_ELBOW_FLEX = deg(9);
/** Standing, the arms drift by a fraction of the walk's swing. */
const IDLE_ARM_DRIFT = 0.08;

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
  flex: number,
): { angles: ArmAngles; behind: boolean } {
  const own = Math.sin(phase * FULL_TURN) * side;
  const signedSwing = own >= 0 ? own : own * ARM_BACKSWING_SHARE;
  // Centred on the rest hang, so the average of the cycle is where the arms
  // stand. Left uncentred the whole swing sits inboard of the idle, and the
  // creature visibly tucks its arms in the moment it starts walking.
  const swing = signedSwing - (1 - ARM_BACKSWING_SHARE) / 2;
  const forward = (own + 1) / 2;
  return {
    angles: facingArmAngles(side, swing, forward, flex),
    // Whole-row, not per-frame: an arm that changes sides partway through the
    // cycle pops at the shoulder.
    behind: away,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

const BREATH_LIFT = 0.012;
const BREATH_LEAN = deg(1.4);
const IDLE_SWAY = 0.02;
const IDLE_HEAD_TURN = 0.1;
const IDLE_HEAD_TILT = deg(2.5);
const IDLE_TAIL_SWAY = 0.35;
const IDLE_FLEX = 0.25;
/** The lats never fully drop: a bodybuilder standing still is still posing. */
const IDLE_GLARE = 0.15;

function idleBase(phase: number): JuicerPose {
  const breath = Math.sin(phase * FULL_TURN);
  const pose = restingPose();
  pose.bob = -BREATH_LIFT * (breath * 0.5 + 0.5);
  pose.lean = BREATH_LEAN * breath;
  pose.blink = blink(phase, BLINK_AT);
  pose.flex = IDLE_FLEX + breath * IDLE_FLEX * 0.5;
  pose.glare = IDLE_GLARE;
  pose.tailSwing = breath * IDLE_TAIL_SWAY;
  return pose;
}

function idleFacing(phase: number, away: boolean): JuicerPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * FULL_TURN);
  pose.sway = sway * IDLE_SWAY;
  pose.headTurn = sway * IDLE_HEAD_TURN;
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
 * Edge-on the two feet are only slightly staggered: a wide profile stance
 * splits the legs so far fore-and-aft that the trunk no longer sits over
 * either of them.
 */
const IDLE_SIDE_FOOT_LEAD = 0.06;
const SIDE_HEAD_TURN = 0;
const SIDE_HAND_FORWARD = 0.16;
/**
 * How far behind the near hand the far one trails in a two-handed pose.
 *
 * Edge-on the two shoulder joints are drawn spread fore and aft so both arms
 * show, so the far hand has that whole spread to make up before it reaches
 * anything the near hand is holding. Offset by a token amount instead, it is
 * the far arm that runs out of reach and clamps.
 */
const SIDE_FAR_HAND_TRAIL = 0.22;
/**
 * Where the far hand hangs edge-on, against the near one.
 *
 * Behind him, not beside him. Hung at the near hand's own position the far arm
 * is exactly underneath it and the trunk covers every inch of it — the profile
 * then has one arm, and the shape left over between the trunk's edge and the
 * near arm is a flat pad that reads as a cape.
 */
const SIDE_FAR_HAND_BACK = -0.3;

function idleSide(phase: number): JuicerPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * FULL_TURN);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD, 0);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD, 0);
  pose.headTurn = SIDE_HEAD_TURN;
  pose.headTilt = sway * IDLE_HEAD_TILT;
  pose.leftHand = pt(SIDE_FAR_HAND_BACK, SHOULDER_Y + HAND_HANG_DROP);
  pose.rightHand = pt(SIDE_HAND_FORWARD, SHOULDER_Y + HAND_HANG_DROP);
  pose.elbowFlare = ELBOW_IN_FRONT;
  return pose;
}

// ── Walk ─────────────────────────────────────────────────────────────────────

const WALK_FIST = 0.55;
const WALK_TAIL_SWAY = 0.5;
const WALK_FLEX = 0.4;

function walkSide(phase: number): JuicerPose {
  const pose = restingPose();
  const right = gaitFootSide(phase, STRIDE);
  const left = gaitFootSide(phase + 0.5, STRIDE);
  const bobPhase = Math.abs(Math.sin(phase * FULL_TURN));

  // The pelvis *drops* at contact rather than rising at mid-stance. A walking
  // leg is nearly as long as the hip is high, so a foot planted a stride ahead
  // is out of reach from the standing height: the IK clamps, and the clamped
  // leg locks straight with its foot hanging above the floor.
  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.lean = WALK_LEAN;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;

  const rightForward = -Math.sin(phase * FULL_TURN);
  pose.rightArmAngles = sideArmAngles(rightForward, ARM_SWING_ANGLE, ELBOW_FLEX);
  pose.leftArmAngles = sideArmAngles(-rightForward, ARM_SWING_ANGLE, ELBOW_FLEX);
  pose.rightFist = WALK_FIST;
  pose.leftFist = WALK_FIST;
  pose.flex = WALK_FLEX;
  pose.tailSwing = -Math.sin(phase * FULL_TURN) * WALK_TAIL_SWAY;
  pose.tailLift = 0.55;
  pose.blink = blink(phase, BLINK_AT);
  pose.glare = IDLE_GLARE;
  pose.headTurn = SIDE_HEAD_TURN;
  return pose;
}

function walkFacing(phase: number, away: boolean): JuicerPose {
  const pose = restingPose();
  const right = gaitFootFacing(phase, 1, 1, 1);
  const left = gaitFootFacing(phase + 0.5, -1, 1, 1);
  const bobPhase = Math.abs(Math.sin(phase * FULL_TURN));

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

  const rightArm = facingArmSwing(phase, RIGHT_ARM, away, WALK_ELBOW_FLEX);
  const leftArm = facingArmSwing(phase, LEFT_ARM, away, WALK_ELBOW_FLEX);
  pose.rightArmAngles = rightArm.angles;
  pose.leftArmAngles = leftArm.angles;
  pose.rightArmBehind = rightArm.behind;
  pose.leftArmBehind = leftArm.behind;
  pose.rightFist = WALK_FIST;
  pose.leftFist = WALK_FIST;
  pose.flex = WALK_FLEX;
  pose.twist = Math.sin(phase * FULL_TURN) * 0.12;
  pose.tailSwing = Math.sin(phase * FULL_TURN) * WALK_TAIL_SWAY;
  pose.tailLift = 0.55;
  pose.blink = blink(phase, BLINK_AT);
  pose.glare = IDLE_GLARE;
  pose.headTurn = away ? 0 : Math.sin(phase * FULL_TURN) * 0.1;
  return pose;
}

// ── Sprint ───────────────────────────────────────────────────────────────────

const SPRINT_STRIDE = STRIDE * 1.5;
const SPRINT_BOB = WALK_BOB * 1.5;
/** Deep enough that the sprint and the walk are different pictures at 32 px. */
const SPRINT_LEAN = deg(27);
const SPRINT_CROUCH = 0.28;
/** How far behind the shoulders the sprinting hips ride. */
const SPRINT_HIP_BACK = 0.09;
/**
 * The sprint's shoulder swing.
 *
 * Capped by the cell as much as by the pose: the arm is nearly a body-width
 * long, so every extra degree here widens every one of the sheet's 256 cells,
 * blank ones included, and the sheet has a stated texture budget.
 */
const SPRINT_ARM_SWING = deg(46);
const SPRINT_ELBOW_FLEX = deg(52);
const SPRINT_FLEX = 0.9;
const SPRINT_LIFT_GAIN = 1.45;
/**
 * What the charge is made of head-on, where there is no forward for the lean to
 * travel in.
 *
 * Given only the profile's treatment the head-on sprint is the head-on walk: an
 * upright trunk over two legs going up and down in place, and a player looking
 * at the boss face-on cannot tell a charge from a stroll. Three things carry it
 * instead. The hips sink much further than the walk's, which is how a body
 * pitched at the camera projects; the feet scissor much wider across the frame,
 * which is the stride the picture plane can actually show; and the skull ducks
 * down over the shoulders behind the jaw.
 */
const SPRINT_FACING_CROUCH = 0.62;
const SPRINT_DRIFT_GAIN = 2.6;
const SPRINT_FACING_HEAD_DUCK = deg(13);

function sprintBase(phase: number): JuicerPose {
  const pose = restingPose();
  pose.crouch = SPRINT_CROUCH;
  pose.glare = 1;
  pose.maw = 0.35;
  pose.flex = SPRINT_FLEX;
  pose.leftFist = 1;
  pose.rightFist = 1;
  // Streaming out behind him and level: a tail hanging low on a sprint reads
  // as a creature dragging something.
  pose.tailLift = 1;
  const bobPhase = Math.abs(Math.sin(phase * FULL_TURN));
  pose.bob = SPRINT_BOB * (1 - bobPhase);
  return pose;
}

function sprintSide(phase: number): JuicerPose {
  const pose = sprintBase(phase);
  const right = gaitFootSide(phase, SPRINT_STRIDE);
  const left = gaitFootSide(phase + 0.5, SPRINT_STRIDE);
  pose.lean = SPRINT_LEAN;
  // The hips travel back as the shoulders tip forward. Leaning the spine alone
  // pivots the whole trunk about a hip that stays under the chest, so the rear
  // third of the body hangs over nothing and the sprint reads as a fall.
  pose.sway = -SPRINT_HIP_BACK;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  const rightForward = -Math.sin(phase * FULL_TURN);
  pose.rightArmAngles = sideArmAngles(rightForward, SPRINT_ARM_SWING, SPRINT_ELBOW_FLEX);
  pose.leftArmAngles = sideArmAngles(-rightForward, SPRINT_ARM_SWING, SPRINT_ELBOW_FLEX);
  pose.tailSwing = -Math.sin(phase * FULL_TURN) * 0.3;
  pose.headTurn = SIDE_HEAD_TURN;
  return pose;
}

function sprintFacing(phase: number, away: boolean): JuicerPose {
  const pose = sprintBase(phase);
  const right = gaitFootFacing(phase, 1, SPRINT_LIFT_GAIN, SPRINT_DRIFT_GAIN);
  const left = gaitFootFacing(phase + 0.5, -1, SPRINT_LIFT_GAIN, SPRINT_DRIFT_GAIN);
  pose.sway = Math.sin(phase * FULL_TURN) * WALK_SWAY * 1.6;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.rightLegNearness = right.nearness;
  pose.leftLegNearness = left.nearness;
  pose.rightForeshorten = 1;
  pose.leftForeshorten = 1;
  const rightArm = facingArmSwing(phase, RIGHT_ARM, away, SPRINT_ELBOW_FLEX);
  const leftArm = facingArmSwing(phase, LEFT_ARM, away, SPRINT_ELBOW_FLEX);
  pose.rightArmAngles = rightArm.angles;
  pose.leftArmAngles = leftArm.angles;
  pose.rightArmBehind = rightArm.behind;
  pose.leftArmBehind = leftArm.behind;
  pose.twist = Math.sin(phase * FULL_TURN) * 0.2;
  pose.tailSwing = Math.sin(phase * FULL_TURN) * 0.3;
  pose.headTurn = 0;
  pose.crouch = SPRINT_FACING_CROUCH;
  pose.headTilt = SPRINT_FACING_HEAD_DUCK * (away ? -1 : 1);
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
 * Both one-shots use it to arrive exactly on the idle's opening frame. An
 * animation that merely ends *near* the row that follows it still jumps on the
 * hand-off, and that jump lands the frame the attack ends — which the settle
 * gate measures and the player sees on every single throw.
 */
function blendPose(a: JuicerPose, b: JuicerPose, t: number): JuicerPose {
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
    blink: num(a.blink, b.blink),
    glare: num(a.glare, b.glare),
    maw: num(a.maw, b.maw),
    flex: num(a.flex, b.flex),
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
    // Which side an arm is drawn on is a per-row decision, and a one-shot and
    // the idle it hands off to always agree about it.
    leftArmBehind: t < 0.5 ? a.leftArmBehind : b.leftArmBehind,
    rightArmBehind: t < 0.5 ? a.rightArmBehind : b.rightArmBehind,
    tailSwing: num(a.tailSwing, b.tailSwing),
    tailLift: num(a.tailLift, b.tailLift),
  };
}

/**
 * Where a one-shot starts easing back into the idle it hands off to.
 *
 * Early enough that the blend spreads over several frames. Squeezed into the
 * last one it is a single large jump on the frame the attack ends, which is
 * both what the settle gate measures and what the player sees every time.
 */
const SETTLE_FROM = 0.78;

function settleInto(pose: JuicerPose, idle: JuicerPose, t: number): JuicerPose {
  return blendPose(pose, idle, easeInOut(clamp01((t - SETTLE_FROM) / (1 - SETTLE_FROM))));
}

// ── Dumbbell throw ───────────────────────────────────────────────────────────

const THROW_RELEASE_AT = JUICER_THROW_RELEASE_PROGRESS;
const THROW_COIL_BY = 0.3;
/** One frame's worth: held longer the release has no snap. */
const THROW_RECOVER_STEP = 1 / (JUICER_THROW_FRAMES - 1);
const THROW_COIL_CROUCH = 0.45;
/** How closed the gripping hands are while the bar is in them, and after it. */
const THROW_GRIP_FIST = 0.5;
const THROW_RELEASED_FIST = 0.86;
const THROW_COIL_LEAN = deg(-16);
const THROW_RELEASE_LEAN = deg(22);

/**
 * The heave, as one progress-driven motion: crouch and hip coil, an overhead
 * drive, the release on the peak frame, and a follow-through that eases back
 * into standing.
 *
 * Every key is written against `THROW_RELEASE_AT`, which comes from the shared
 * timing module the creature counts its release frame off — so the peak of the
 * motion and the frame the dumbbell leaves his hands cannot drift apart.
 */
/**
 * The spine's tip through the heave. Head-on it is scaled right down: `lean`
 * rotates the spine in the picture plane, so on a head-on row it slides the
 * shoulders bodily sideways off the hips rather than tipping them at the
 * camera, and it drags the shoulder joint out from under the hand target.
 */
function throwLean(t: number, share: number): number {
  return (
    keyed(t, [
      [0, 0],
      [THROW_COIL_BY, THROW_COIL_LEAN],
      [THROW_RELEASE_AT, THROW_RELEASE_LEAN],
      [THROW_RELEASE_AT + THROW_RECOVER_STEP, THROW_RELEASE_LEAN * 0.6],
      [1, 0],
    ]) * share
  );
}

/** How much of the profile's lean a head-on row keeps. */
const FACING_LEAN_SHARE = 0.15;

function throwBase(t: number): JuicerPose {
  const pose = restingPose();
  pose.crouch = keyed(t, [
    [0, 0.1],
    [THROW_COIL_BY, THROW_COIL_CROUCH],
    [THROW_RELEASE_AT, 0.08],
    [1, 0],
  ]);
  pose.headTilt = keyed(t, [
    [0, 0],
    [THROW_COIL_BY, deg(-12)],
    [THROW_RELEASE_AT, deg(16)],
    [1, 0],
  ]);
  pose.maw = keyed(t, [
    [0, 0],
    [THROW_COIL_BY, 0.3],
    [THROW_RELEASE_AT, 1],
    [0.8, 0.25],
    [1, 0],
  ]);
  pose.glare = keyed(t, [
    [0, IDLE_GLARE],
    [THROW_RELEASE_AT, 1],
    [1, IDLE_GLARE],
  ]);
  pose.flex = keyed(t, [
    [0, WALK_FLEX],
    [THROW_COIL_BY, 0.7],
    [THROW_RELEASE_AT, 1],
    [1, IDLE_FLEX],
  ]);
  pose.tailLift = keyed(t, [
    [0, 0.45],
    [THROW_COIL_BY, 0.15],
    [THROW_RELEASE_AT, 0.95],
    [1, 0.45],
  ]);
  // A hand round a dumbbell is not a fist. Closed all the way the two hands are
  // solid balls, there is no gap for the bar to pass through, and the overlay
  // the runtime draws under them has nothing to be gripped by; opened after the
  // release, the same hands read as having just let go of something.
  const grip = keyed(t, [
    [0, THROW_GRIP_FIST],
    [THROW_RELEASE_AT, THROW_GRIP_FIST],
    [THROW_RELEASE_AT + THROW_RECOVER_STEP, THROW_RELEASED_FIST],
    [1, THROW_GRIP_FIST],
  ]);
  pose.leftFist = grip;
  pose.rightFist = grip;
  return pose;
}

/**
 * Profile hand targets for the heave. Edge-on the two shoulder joints sit
 * almost on the centreline, so a hand placed at the head-on hang spread is most
 * of an arm's length out to the side and the IK clamps.
 */
const THROW_SIDE_REST = pt(SIDE_HAND_FORWARD, SHOULDER_Y + HAND_HANG_DROP);
const THROW_SIDE_COIL = pt(-0.3, SHOULDER_Y + HAND_HANG_DROP * 0.66);
/**
 * The hands arc up *behind* him rather than straight up his own centreline. A
 * hand target that passes within a hand's width of its shoulder joint folds the
 * elbow flat, and the arm reads as inside out on exactly that frame.
 */
const THROW_SIDE_ARC = pt(-0.46, SHOULDER_Y - 0.02);
const THROW_SIDE_ARC_AT = 0.38;
const THROW_SIDE_OVERHEAD = pt(0.02, SHOULDER_Y - 0.42);
const THROW_SIDE_RELEASE = pt(0.66, SHOULDER_Y - 0.44);
const THROW_SIDE_FOLLOW = pt(0.5, SHOULDER_Y + 0.12);

function throwSide(t: number): JuicerPose {
  const pose = throwBase(t);
  pose.lean = throwLean(t, 1);
  const shift = keyed(t, [
    [0, 0],
    [THROW_COIL_BY, -0.09],
    [THROW_RELEASE_AT, 0.1],
    [0.82, 0.03],
    [1, 0],
  ]);
  pose.sway = shift;
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD * 2.4, 0);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD * 2.4, 0);
  // Both hands travel together — it is a two-handed heave — with the far hand
  // trailing slightly so the two never fuse into one shape.
  const grip = keyedPoint(t, [
    [0, THROW_SIDE_REST],
    [THROW_COIL_BY, THROW_SIDE_COIL],
    [THROW_SIDE_ARC_AT, THROW_SIDE_ARC],
    [THROW_RELEASE_AT - THROW_RECOVER_STEP, THROW_SIDE_OVERHEAD],
    [THROW_RELEASE_AT, THROW_SIDE_RELEASE],
    [0.82, THROW_SIDE_FOLLOW],
    [1, THROW_SIDE_REST],
  ]);
  pose.rightHand = grip;
  pose.leftHand = pt(grip.x - SIDE_FAR_HAND_TRAIL, grip.y - 0.04);
  pose.elbowFlare = ELBOW_IN_FRONT;
  pose.headTurn = SIDE_HEAD_TURN;
  return settleInto(pose, idleSide(0), t);
}

const THROW_FACING_REST_OUT = HAND_HANG_SPREAD * 0.72;
const THROW_FACING_OVERHEAD_OUT = 0.36;
/** How far outboard of the near hand the far one grips, head-on. */
const THROW_FACING_FAR_OUT = 0.06;

function throwFacing(t: number, away: boolean): JuicerPose {
  const pose = throwBase(t);
  pose.lean = throwLean(t, FACING_LEAN_SHARE);
  // The hands travel up the *outside* of the body, never past the shoulder
  // joint: a hand target that crosses its own shoulder folds the elbow flat and
  // the arm reads as inside out on the frame it passes.
  const out = keyed(t, [
    [0, THROW_FACING_REST_OUT],
    [THROW_COIL_BY, THROW_FACING_REST_OUT * 0.95],
    [THROW_RELEASE_AT - THROW_RECOVER_STEP, THROW_FACING_REST_OUT * 0.85],
    [THROW_RELEASE_AT, THROW_FACING_OVERHEAD_OUT],
    [1, THROW_FACING_REST_OUT],
  ]);
  const height = keyed(t, [
    [0, SHOULDER_Y + HAND_HANG_DROP],
    [THROW_COIL_BY, SHOULDER_Y + HAND_HANG_DROP * 0.78],
    [THROW_RELEASE_AT - THROW_RECOVER_STEP, SHOULDER_Y - 0.3],
    [THROW_RELEASE_AT, SHOULDER_Y - 0.46],
    [0.82, SHOULDER_Y - 0.1],
    [1, SHOULDER_Y + HAND_HANG_DROP],
  ]);
  pose.rightHand = pt(out, height);
  // The far hand sits a little *outboard* of the near one, never lower. Hung
  // below it, the rest key asks for a reach past the arm's own length and the
  // IK clamps on the row's opening frame — which is the frame it hands off to
  // and from, so the clamp shows every time the attack is played.
  pose.leftHand = pt(-(out + THROW_FACING_FAR_OUT), height);
  pose.leftFoot = pt(-FOOT_STAND_SPREAD * 1.25, 0);
  pose.rightFoot = pt(FOOT_STAND_SPREAD * 1.25, 0);
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  pose.leftArmBehind = away;
  pose.rightArmBehind = away;
  pose.headTurn = 0;
  // Head-on the coil is a twist: the shoulders wind one way and unwind through
  // the drive, which is the only travel the picture plane can show.
  pose.twist =
    keyed(t, [
      [0, 0],
      [THROW_COIL_BY, -1],
      [THROW_RELEASE_AT, 0.8],
      [0.82, 0.2],
      [1, 0],
    ]) * 0.4;
  return settleInto(pose, idleFacing(0, away), t);
}

// ── Ground punch ─────────────────────────────────────────────────────────────

/**
 * Where the impact key sits along the row, snapped to the frame the sheet
 * actually bakes.
 *
 * The impact *progress* is a fraction of the whole action; the row samples at
 * `frame / (frames − 1)`, and for twelve frames those two do not coincide. Left
 * on the raw progress the deepest pose of the slam falls between two baked
 * frames and is never drawn: both neighbours show the fists already on their
 * way somewhere else, and the row reads as a creature waving rather than as one
 * hitting the floor. Every other key is written against this, so the extreme
 * lands on the frame the timing module says the damage does.
 */
const PUNCH_IMPACT_AT =
  juicerImpactSpriteFrame(JUICER_PUNCH_FRAMES, JUICER_PUNCH_IMPACT_PROGRESS) /
  (JUICER_PUNCH_FRAMES - 1);
const PUNCH_REAR_BY = 0.26;
const PUNCH_RECOVER_STEP = 1 / (JUICER_PUNCH_FRAMES - 1);
/**
 * The slam has to fold him nearly double: his fists have to reach the floor
 * ahead of his own feet, and from standing height that is most of a body length
 * outside the arm's span. The crouch is what buys the reach.
 */
const PUNCH_IMPACT_CROUCH = 1.5;
const PUNCH_REAR_CROUCH = 0;
/**
 * Head-on there is no forward for the fists to travel in, so the slam travels
 * almost entirely in height — and the fists have to arrive outboard of the
 * knees and below the hips, which from standing is further than the arm is
 * long. The crouch is what buys that reach; short of it the fists stop at the
 * hips with the elbows folded, and two fists tucked beside the ribs at the peak
 * frame is a bodybuilder's front double-biceps, not a blow.
 */
const PUNCH_FACING_IMPACT_CROUCH = 1.6;
/**
 * The pitch of the trunk at impact.
 *
 * It is a *drop*, not a dive. Pitched far enough to throw the shoulder down to
 * the floor the skull ends up further forward than the fist it is supposedly
 * following, the hips are left standing behind under nothing, and the whole
 * attack reads as a headbutt. The reach the fists need has to come out of the
 * crouch instead.
 */
const PUNCH_SIDE_LEAN = deg(44);
const PUNCH_REAR_LEAN = deg(-14);

function punchBase(t: number): JuicerPose {
  const pose = restingPose();
  pose.crouch = keyed(t, [
    [0, 0],
    [PUNCH_REAR_BY, PUNCH_REAR_CROUCH],
    [PUNCH_IMPACT_AT, PUNCH_IMPACT_CROUCH],
    [PUNCH_IMPACT_AT + PUNCH_RECOVER_STEP, PUNCH_IMPACT_CROUCH * 0.82],
    [1, 0],
  ]);
  pose.maw = keyed(t, [
    [0, 0],
    [PUNCH_REAR_BY, 0.7],
    [PUNCH_IMPACT_AT, 1],
    [0.8, 0.2],
    [1, 0],
  ]);
  pose.glare = keyed(t, [
    [0, IDLE_GLARE],
    [PUNCH_REAR_BY, 0.8],
    [PUNCH_IMPACT_AT, 1],
    [1, IDLE_GLARE],
  ]);
  pose.flex = keyed(t, [
    [0, WALK_FLEX],
    [PUNCH_REAR_BY, 1],
    [PUNCH_IMPACT_AT, 1],
    [1, IDLE_FLEX],
  ]);
  pose.tailLift = keyed(t, [
    [0, 0.45],
    [PUNCH_REAR_BY, 0.9],
    [PUNCH_IMPACT_AT, 0.1],
    [1, 0.45],
  ]);
  pose.leftFist = 1;
  pose.rightFist = 1;
  return pose;
}

/**
 * The fists swing forward and up before they go back over his head.
 *
 * Taken from the hip straight to the wind-up the hand target passes within a
 * hand's width of its own shoulder joint on the way, and the elbow folds flat
 * on exactly that frame — the arm reads as inside out.
 */
const PUNCH_SIDE_LIFT_AT = 0.14;
const PUNCH_SIDE_LIFT_HAND = pt(0.42, SHOULDER_Y + 0.3);
const PUNCH_SIDE_REAR_HAND = pt(-0.1, SHOULDER_Y - 0.46);
const PUNCH_SIDE_IMPACT_HAND = pt(0.92, -0.18);
/**
 * Halfway down the profile's slam, carried well out in front.
 *
 * The straight line from the wind-up to the floor runs within half an arm of
 * the shoulder joint the arm hangs off, and an elbow folded past flat on that
 * frame reads as a limb hinged the wrong way. It is the same key the head-on
 * row carries for the same reason.
 */
const PUNCH_SIDE_DESCENT_HAND = pt(0.92, -0.92);
/** How far apart the feet split fore and aft at the bottom of the slam. */
const PUNCH_SIDE_LUNGE = 0.4;
const PUNCH_SIDE_REST_HAND = pt(SIDE_HAND_FORWARD, SHOULDER_Y + HAND_HANG_DROP);

function punchSide(t: number): JuicerPose {
  const pose = punchBase(t);
  pose.lean = keyed(t, [
    [0, 0],
    [PUNCH_REAR_BY, PUNCH_REAR_LEAN],
    [PUNCH_IMPACT_AT, PUNCH_SIDE_LEAN],
    [PUNCH_IMPACT_AT + PUNCH_RECOVER_STEP, PUNCH_SIDE_LEAN * 0.8],
    [1, 0],
  ]);
  pose.headTilt = keyed(t, [
    [0, 0],
    [PUNCH_REAR_BY, deg(-18)],
    [PUNCH_IMPACT_AT, deg(10)],
    [1, 0],
  ]);
  pose.sway = keyed(t, [
    [0, 0],
    [PUNCH_REAR_BY, -0.05],
    [PUNCH_IMPACT_AT, -0.02],
    [1, 0],
  ]);
  // The stance splits into a lunge as he goes down. Kept at the standing lead
  // the two legs fold into the same place under a crouch this deep, and the
  // whole lower body merges with the trunk into one horizontal lump with feet
  // sticking out of it — which at 32 px is a creature dropping to all fours,
  // not one slamming the floor.
  const lunge = keyed(t, [
    [0, IDLE_SIDE_FOOT_LEAD * 2.6],
    [PUNCH_REAR_BY, IDLE_SIDE_FOOT_LEAD * 3],
    [PUNCH_IMPACT_AT, PUNCH_SIDE_LUNGE],
    [PUNCH_RECOVER_TO, IDLE_SIDE_FOOT_LEAD * 3],
    [1, IDLE_SIDE_FOOT_LEAD * 2.6],
  ]);
  pose.rightFoot = pt(lunge, 0);
  pose.leftFoot = pt(-lunge, 0);
  const grip = keyedPoint(t, [
    [0, PUNCH_SIDE_REST_HAND],
    [PUNCH_SIDE_LIFT_AT, PUNCH_SIDE_LIFT_HAND],
    [PUNCH_REAR_BY, PUNCH_SIDE_REAR_HAND],
    [PUNCH_DESCENT_AT, PUNCH_SIDE_DESCENT_HAND],
    [PUNCH_IMPACT_AT, PUNCH_SIDE_IMPACT_HAND],
    // The fists come up as fast as the body does. Left low while the crouch
    // unwinds, the shoulder rises away from them and the IK clamps for four
    // frames running — a stiff-armed drag rather than a recovery.
    [PUNCH_IMPACT_AT + PUNCH_RECOVER_STEP, pt(0.94, -0.42)],
    [0.72, pt(0.72, -0.9)],
    [0.86, pt(0.42, -1.32)],
    [1, PUNCH_SIDE_REST_HAND],
  ]);
  pose.rightHand = grip;
  pose.leftHand = pt(grip.x - SIDE_FAR_HAND_TRAIL, grip.y - 0.03);
  pose.elbowFlare = ELBOW_IN_FRONT;
  pose.headTurn = SIDE_HEAD_TURN;
  return settleInto(pose, idleSide(0), t);
}

/**
 * Head-on the slam has no forward to travel in, so the whole thing lands in the
 * drop: the body sinks, the fists come down in front of the chest, and the
 * ground he is punching is nearer the camera than his own feet — which is why
 * the fists stop well above the tile's floor line rather than on it.
 */
/**
 * Where the fists land, head-on.
 *
 * *Outside* the shoulders, and below the knee line. Brought down inboard of the
 * shoulders instead, the two fists arrive on his own hips: the silhouette at
 * the frame of the blow is then narrower and smaller than the one he is
 * standing in when he is doing nothing at all, and an attack whose peak frame
 * is the smallest picture in the row does not read as an attack at any size.
 * The whole row is measured on that — the impact frame's ink has to beat the
 * idle's, not merely differ from it.
 */
const PUNCH_FACING_IMPACT_HAND_OUT = 0.78;
const PUNCH_FACING_IMPACT_HAND_Y = -0.34;
const PUNCH_FACING_IMPACT_BOB = 0.02;
/** How far apart the feet brace under the slam. */
const PUNCH_FACING_STANCE = 2.3;
/**
 * The two keys the fists swing through on their way up to the wind-up and back
 * down out of it.
 *
 * Both are carried well *outside* the shoulder joint. A hand that passes within
 * a hand's width of its own shoulder folds the elbow flat on that frame and the
 * arm reads as inside out — and the straight line from the hip to overhead, and
 * the straight line from overhead to the floor, both run right through the
 * joint. These are the only two places on the row where that can happen.
 */
const PUNCH_FACING_SWING_OUT = 0.95;
const PUNCH_FACING_LIFT_HEIGHT = 0.1;
const PUNCH_FACING_DROP_OUT = 1.02;
const PUNCH_FACING_DROP_HEIGHT = -0.34;
/** Where the fists are back under the shoulders after the blow. */
const PUNCH_RECOVER_TO = 0.82;
/** How hard the tail whips across as the blow lands, and how high it rides. */
const PUNCH_FACING_TAIL_LASH = 0.95;
const PUNCH_FACING_IMPACT_TAIL_LIFT = 0.85;
/**
 * Where the fists are carried at the top of the wind-up: high, wide, and far
 * enough from their own shoulders that the elbows stay open.
 *
 * Two constraints meet here. A fist parked near its own shoulder folds the
 * elbow flat, and a pair of folded elbows with the fists at head height is the
 * front double-biceps pose — the exact thing this row was read as. And the
 * throw's own peak carries both fists *together* just above the skull, so a
 * wind-up that gathers them there gives the two attacks the same silhouette on
 * their loudest frame. Thrown straight up and apart instead, the arms stay
 * extended and the shape belongs to this row alone.
 */
const PUNCH_FACING_REAR_HAND_OUT = 0.66;
/**
 * And no higher. Every cell on the sheet, blank ones included, is as tall as
 * the tallest pose on it, and the sheet has a stated texture budget: fists
 * carried a further tenth of a tile up cost 8.65 MP against a ceiling of 8.
 */
const PUNCH_FACING_REAR_HEIGHT = SHOULDER_Y - 0.54;
/**
 * Halfway down the slam. Without a key here the hands cut the straight line
 * from overhead to the floor, which passes through the shoulder joint itself.
 */
const PUNCH_DESCENT_AT = (PUNCH_REAR_BY + PUNCH_IMPACT_AT) / 2;
/**
 * Halfway down: arms swung wide and already below the chest, the elbows open.
 * Brought down inboard at chest height instead the two folded arms arrive
 * either side of the ribs, which is a flex however fast the frames run past.
 */
const PUNCH_FACING_DESCENT_OUT = 1.0;
const PUNCH_FACING_DESCENT_HEIGHT = SHOULDER_Y + 0.98;
/** Where the fists leave the overhead wind-up, on their way back outboard. */
const PUNCH_DROP_AT = PUNCH_REAR_BY + (PUNCH_DESCENT_AT - PUNCH_REAR_BY) * 0.45;

function punchFacing(t: number, away: boolean): JuicerPose {
  const pose = punchBase(t);
  pose.bob = keyed(t, [
    [0, 0],
    [PUNCH_REAR_BY, -0.04],
    [PUNCH_IMPACT_AT, PUNCH_FACING_IMPACT_BOB],
    [1, 0],
  ]);
  pose.crouch = keyed(t, [
    [0, 0],
    [PUNCH_REAR_BY, PUNCH_REAR_CROUCH],
    [PUNCH_IMPACT_AT, PUNCH_FACING_IMPACT_CROUCH],
    [PUNCH_IMPACT_AT + PUNCH_RECOVER_STEP, PUNCH_FACING_IMPACT_CROUCH * 0.82],
    [1, 0],
  ]);
  pose.headTilt = keyed(t, [
    [0, 0],
    [PUNCH_REAR_BY, deg(-10)],
    [PUNCH_IMPACT_AT, deg(16)],
    [1, 0],
  ]);
  // Out and up, never straight up: a hand target lifted through its own
  // shoulder folds the elbow flat on the frame it passes and the arm reads as
  // inside out.
  const out = keyed(t, [
    [0, HAND_HANG_SPREAD],
    [PUNCH_REAR_BY * 0.5, PUNCH_FACING_SWING_OUT],
    [PUNCH_REAR_BY, PUNCH_FACING_REAR_HAND_OUT],
    [PUNCH_DROP_AT, PUNCH_FACING_DROP_OUT],
    [PUNCH_DESCENT_AT, PUNCH_FACING_DESCENT_OUT],
    [PUNCH_IMPACT_AT, PUNCH_FACING_IMPACT_HAND_OUT],
    // The recovery comes back in as fast as it went out: left to interpolate
    // straight to the rest hang, the fists sweep wide through every frame after
    // the blow and the recovery out-measures the blow itself.
    [PUNCH_RECOVER_TO, HAND_HANG_SPREAD * 0.94],
    [1, HAND_HANG_SPREAD],
  ]);
  const height = keyed(t, [
    [0, SHOULDER_Y + HAND_HANG_DROP],
    [PUNCH_REAR_BY * 0.5, SHOULDER_Y + PUNCH_FACING_LIFT_HEIGHT],
    [PUNCH_REAR_BY, PUNCH_FACING_REAR_HEIGHT],
    [PUNCH_DROP_AT, SHOULDER_Y + PUNCH_FACING_DROP_HEIGHT],
    [PUNCH_DESCENT_AT, PUNCH_FACING_DESCENT_HEIGHT],
    [PUNCH_IMPACT_AT, PUNCH_FACING_IMPACT_HAND_Y],
    [PUNCH_RECOVER_TO, SHOULDER_Y + HAND_HANG_DROP * 0.5],
    [1, SHOULDER_Y + HAND_HANG_DROP],
  ]);
  pose.rightHand = pt(out, height);
  pose.leftHand = pt(-out, height);
  // The brace widens with the crouch, never ahead of it: a stance this wide
  // under a standing hip puts the foot further from its own leg root than the
  // leg is long, and the IK clamps on the wind-up frames.
  const stance =
    FOOT_STAND_SPREAD *
    keyed(t, [
      [0, 1],
      [PUNCH_REAR_BY, 1.15],
      [PUNCH_IMPACT_AT, PUNCH_FACING_STANCE],
      [PUNCH_RECOVER_TO, 1.3],
      [1, 1],
    ]);
  pose.leftFoot = pt(-stance, 0);
  pose.rightFoot = pt(stance, 0);
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  pose.leftArmBehind = away;
  pose.rightArmBehind = away;
  pose.headTurn = 0;
  // The tail is the counterweight, and head-on it is the only part of him with
  // any room left to move: dropped into the crouch with everything else it
  // takes ink out of the frame the blow lands on, which is the one frame that
  // has to be the biggest picture in the row.
  pose.tailLift = keyed(t, [
    [0, 0.45],
    [PUNCH_REAR_BY, 0.9],
    [PUNCH_IMPACT_AT, PUNCH_FACING_IMPACT_TAIL_LIFT],
    [1, 0.45],
  ]);
  pose.tailSwing = keyed(t, [
    [0, 0],
    [PUNCH_REAR_BY, -PUNCH_FACING_TAIL_LASH * 0.4],
    [PUNCH_IMPACT_AT, PUNCH_FACING_TAIL_LASH],
    [1, 0],
  ]);
  return settleInto(pose, idleFacing(0, away), t);
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: JuicerView;
  readonly kind: RowKind;
  /** Null on the gore row, whose cells are pieces rather than poses. */
  readonly pose: ((frame: number) => JuicerPose) | null;
}

/** Loops sample the cycle evenly; one-shots sample the frame's own position. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return frame / (frameCount - 1);
}

const GORE_PIECES: readonly GorePiece[] = juicerGorePieces();
/** Pieces are authored at their own tile-unit sizes, not the creature's scale. */
const GORE_PIECE_SCALE = 1.7;
const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

export const ROWS: readonly RowSpec[] = [
  {
    name: 'idle',
    frameCount: JUICER_IDLE_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (f) => idleFacing(cyclePhase(f, JUICER_IDLE_FRAMES), false),
  },
  {
    name: 'idle_side',
    frameCount: JUICER_IDLE_FRAMES,
    view: 'side',
    kind: 'loop',
    pose: (f) => idleSide(cyclePhase(f, JUICER_IDLE_FRAMES)),
  },
  {
    name: 'idle_away',
    frameCount: JUICER_IDLE_FRAMES,
    view: 'back',
    kind: 'loop',
    pose: (f) => idleFacing(cyclePhase(f, JUICER_IDLE_FRAMES), true),
  },
  {
    name: 'walk',
    frameCount: JUICER_WALK_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (f) => walkFacing(cyclePhase(f, JUICER_WALK_FRAMES), false),
  },
  {
    name: 'walk_side',
    frameCount: JUICER_WALK_FRAMES,
    view: 'side',
    kind: 'loop',
    pose: (f) => walkSide(cyclePhase(f, JUICER_WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: JUICER_WALK_FRAMES,
    view: 'back',
    kind: 'loop',
    pose: (f) => walkFacing(cyclePhase(f, JUICER_WALK_FRAMES), true),
  },
  {
    name: 'sprint',
    frameCount: JUICER_SPRINT_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (f) => sprintFacing(cyclePhase(f, JUICER_SPRINT_FRAMES), false),
  },
  {
    name: 'sprint_side',
    frameCount: JUICER_SPRINT_FRAMES,
    view: 'side',
    kind: 'loop',
    pose: (f) => sprintSide(cyclePhase(f, JUICER_SPRINT_FRAMES)),
  },
  {
    name: 'sprint_away',
    frameCount: JUICER_SPRINT_FRAMES,
    view: 'back',
    kind: 'loop',
    pose: (f) => sprintFacing(cyclePhase(f, JUICER_SPRINT_FRAMES), true),
  },
  {
    name: 'throw',
    frameCount: JUICER_THROW_FRAMES,
    view: 'front',
    kind: 'oneShot',
    pose: (f) => throwFacing(shotProgress(f, JUICER_THROW_FRAMES), false),
  },
  {
    name: 'throw_side',
    frameCount: JUICER_THROW_FRAMES,
    view: 'side',
    kind: 'oneShot',
    pose: (f) => throwSide(shotProgress(f, JUICER_THROW_FRAMES)),
  },
  {
    name: 'throw_away',
    frameCount: JUICER_THROW_FRAMES,
    view: 'back',
    kind: 'oneShot',
    pose: (f) => throwFacing(shotProgress(f, JUICER_THROW_FRAMES), true),
  },
  {
    name: 'punch',
    frameCount: JUICER_PUNCH_FRAMES,
    view: 'front',
    kind: 'oneShot',
    pose: (f) => punchFacing(shotProgress(f, JUICER_PUNCH_FRAMES), false),
  },
  {
    name: 'punch_side',
    frameCount: JUICER_PUNCH_FRAMES,
    view: 'side',
    kind: 'oneShot',
    pose: (f) => punchSide(shotProgress(f, JUICER_PUNCH_FRAMES)),
  },
  {
    name: 'punch_away',
    frameCount: JUICER_PUNCH_FRAMES,
    view: 'back',
    kind: 'oneShot',
    pose: (f) => punchFacing(shotProgress(f, JUICER_PUNCH_FRAMES), true),
  },
  {
    name: 'gore',
    frameCount: GORE_PIECES.length,
    view: 'side',
    kind: 'gore',
    pose: null,
  },
];

function paintView(ctx: Ctx, view: JuicerView, pose: JuicerPose): void {
  if (view === 'front') drawJuicerFront(ctx, pose);
  else if (view === 'back') drawJuicerBack(ctx, pose);
  else drawJuicerSide(ctx, pose);
}

// ── Held-dumbbell anchors ────────────────────────────────────────────────────

/**
 * Where a figure-space point lands inside the sprite's own logical tile.
 *
 * The tile box is `TILE_SCALE` square with its left edge at `tileX` and the
 * ground line `GROUND_OFFSET_PX` below `tileY`, and the figure is painted with
 * the origin on that ground line at the frame's centre. Both of those cancel
 * to a constant, which is why this needs no bake geometry: x is measured from
 * the tile's centre and y from its top. Values outside 0…1 are legitimate — he
 * is 2.3 tiles tall, so most of him is above his own tile.
 */
const GROUND_TILE_FRACTION = GROUND_OFFSET_PX / TILE_SCALE;
const TILE_HALF_FRACTION = 0.5;

function tileFractionOf(point: Pt): TileFraction {
  return { x: TILE_HALF_FRACTION + point.x, y: GROUND_TILE_FRACTION + point.y };
}

/**
 * The gripping hand. His right, which is the near one in profile — a dumbbell
 * anchored to the far hand would be drawn behind his own chest half the time.
 */
function gripHandOf(pose: JuicerPose, view: JuicerView): Pt {
  return solvedArm(pose, view, 'right').end;
}

function rowNamed(name: string): RowSpec {
  const row = ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) throw new Error(`no row named "${name}"`);
  return row;
}

/** Every gripping-hand position across a row, in tile fractions. */
export function handAnchorsOfRow(name: string): TileFraction[] {
  const row = rowNamed(name);
  const posed = row.pose;
  if (posed === null) throw new Error(`row ${name} has no pose stream`);
  return Array.from({ length: row.frameCount }, (_unused, frame) =>
    tileFractionOf(gripHandOf(posed(frame), row.view)),
  );
}

/** The rows a carried dumbbell is visible through: he stands and he walks with it. */
const CARRY_ROWS: Record<JuicerHandView, ReadonlyArray<string>> = {
  front: ['idle', 'walk'],
  side: ['idle_side', 'walk_side'],
  away: ['idle_away', 'walk_away'],
};

const THROW_ROWS: Record<JuicerHandView, string> = {
  front: 'throw',
  side: 'throw_side',
  away: 'throw_away',
};

/**
 * The carry anchor: the mean gripping-hand position across every frame a
 * dumbbell is carried through.
 *
 * A mean rather than one frame's hand, because the contract carries a single
 * point per view and the arm swings through the walk. The gate pairs this with
 * a drift check — a mean is only meaningful if no frame strays far from it.
 */
function meanCarryAnchor(handView: JuicerHandView): TileFraction {
  const points = CARRY_ROWS[handView].flatMap((name) => handAnchorsOfRow(name));
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

export function carryAnchors(): Record<JuicerHandView, TileFraction> {
  return {
    front: meanCarryAnchor('front'),
    side: meanCarryAnchor('side'),
    away: meanCarryAnchor('away'),
  };
}

/** How far any carried frame's hand may stray from the single carry anchor. */
export const CARRY_DRIFT_LIMIT_TILES = 0.4;

/** The largest distance any carry frame's hand sits from its view's anchor. */
export function worstCarryDrift(handView: JuicerHandView): number {
  const anchor = carryAnchors()[handView];
  let worst = 0;
  for (const name of CARRY_ROWS[handView]) {
    for (const point of handAnchorsOfRow(name)) {
      worst = Math.max(worst, Math.hypot(point.x - anchor.x, point.y - anchor.y));
    }
  }
  return worst;
}

export function throwAnchors(): Record<JuicerHandView, TileFraction[]> {
  return {
    front: handAnchorsOfRow(THROW_ROWS.front),
    side: handAnchorsOfRow(THROW_ROWS.side),
    away: handAnchorsOfRow(THROW_ROWS.away),
  };
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
const MEASURE_SPAN = 512;
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
          ctx.scale(TILE_SCALE, TILE_SCALE);
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
  console.log(`Writing the juicer sheet (tileScale=${TILE_SCALE})…`);
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
// point: `npm run gen:juicer` runs the gates, which write the sheet they
// measured. Run directly it explains itself rather than writing an ungated
// sheet.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  console.error('Run `npm run gen:juicer`; a sheet that skipped its gates must not reach disk.');
  process.exitCode = 1;
}
