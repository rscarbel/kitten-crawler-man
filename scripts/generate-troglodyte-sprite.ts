#!/usr/bin/env tsx
/**
 * Generates the two Troglodyte sheets: the creature itself and the venomous
 * tongue it lashes with.
 *
 * The anatomy and the painting live in `scripts/trogArt.ts` and the severed
 * pieces in `scripts/trogGore.ts`; this file is only the choreography — one
 * pose function per animation row, sampled per frame — plus the bake.
 *
 * Body rows (see the `troglodyte` entry in src/images/enemies/manifest.json):
 *    0 idle        — toward the camera, gular sac pumping
 *    1 idle_side   — profile, drawn facing +X and mirrored at runtime
 *    2 idle_away
 *    3 walk        — a slow, low prowl
 *    4 walk_side
 *    5 walk_away
 *    6 gape        — the windup: jaw hinges open, crest snaps erect
 *    7 gape_side
 *    8 gape_away
 *    9 lash        — the strike: coil, thrust, recover
 *   10 lash_side
 *   11 lash_away
 *   12 gore        — the eight pieces, one per column
 *
 * The tongue is a **separate sheet** rather than a row here: it reaches three
 * tiles, twenty times the creature's own width, so baking it into the body's
 * cells would inflate every one of them. The runtime anchors it at the mouth
 * and rotates it toward the target — see `MOUTH_ANCHORS` below, which is what
 * `src/sprites/troglodyteSprite.ts` positions it from.
 *
 * Run: npx tsx scripts/generate-troglodyte-sprite.ts   (npm run gen:troglodyte)
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  ARM_LENGTH,
  RESTING_STOOP,
  TWO_PI,
  clamp01,
  deg,
  drawTrogBack,
  drawTrogFront,
  drawTrogSide,
  easeIn,
  easeInOut,
  easeOut,
  hump,
  keyed,
  lerp,
  mouthAnchor,
  pt,
  ramp,
  restingPose,
  shoulderJoint,
  type ArmAngles,
  type Pt,
  type TrogPose,
  type TrogSide,
  type TrogView,
} from './trogArt';
import { trogGorePieces } from './trogGore';
import { TONGUE_REACH_TILES, drawTongue } from './trogTongue';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** Clear pixels kept between the furthest ink and the edge of its cell. */
const FRAME_PADDING = 6;
const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;
/** Scratch canvas for measurement; comfortably larger than any body cell. */
const MEASURE_SIZE = 512;
/** And for the tongue, which is three tiles long. */
const TONGUE_MEASURE_WIDTH = 640;
const TONGUE_MEASURE_HEIGHT = 192;

/**
 * How much of a tile the creature fills, scaled about its own ground line so
 * its feet stay on the tile they belong to.
 *
 * It stands a little over a tile tall even hunched, which is the read: a thing
 * that would be taller than the player if it ever straightened up, and does not.
 */
const TROG_SCALE = 0.78;
/**
 * Where the ground line sits inside the tile, in pixels of the tile the art is
 * drawn at. Near the bottom, the way Carl's sheet places his: a standing
 * figure's feet belong on the floor of its tile, not in the middle of it.
 *
 * Held in whole pixels rather than as a fraction so `tileY` comes out an
 * integer — a fractional anchor is legal but it puts every blit on a half
 * pixel, which softens the whole sprite for no reason.
 */
const GROUND_OFFSET_PX = 58;
const GROUND_OFFSET_IN_TILE = GROUND_OFFSET_PX / TILE_SCALE;

const IDLE_FRAMES = 8;
/**
 * The head-on idles run longer than every other loop.
 *
 * They are the rows carrying the head's side-to-side sweep, and a sweep is the
 * one motion in the set whose whole job is to be smooth: it exists to show the
 * snout's length by turning it through the picture plane, and stepped coarsely
 * it reads as the head snapping between two poses rather than looking around.
 */
const FACING_IDLE_FRAMES = 14;
/**
 * More than the other cycles. The walk is the animation that plays most and
 * travels furthest, so it is the one where eight steps read as a stutter.
 */
const WALK_FRAMES = 12;
const GAPE_FRAMES = 6;
export const LASH_FRAMES = 8;
/**
 * Where in the lash the tongue is at full reach. `Troglodyte` fires its hit on
 * the middle frame of the strike, so the thrust has to peak exactly here.
 */
export const LASH_IMPACT_PROGRESS = 0.5;

// ── Pose helpers ─────────────────────────────────────────────────────────────

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

/** A blink centred on `at`, expressed in cycle phase. */
function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 1.5) % 1) - 0.5);
  return distance > BLINK_WIDTH ? 0 : hump(HUMP_PEAK * (1 - distance / BLINK_WIDTH));
}

/** Where `hump` peaks, so a blink is fully shut at its own centre. */
const HUMP_PEAK = 0.5;
/**
 * On a sample point *both* row lengths land on — 6/8 and 9/12 — so the blink is
 * centred on a real frame in every row rather than straddling two of them. Off
 * such a point the membrane enters by jumping from fully open to most of the
 * way shut in a single frame, which reads as a flicker rather than a blink.
 */
const BLINK_AT = 0.75;
/**
 * Wide enough that the nictitating membrane crosses over three frames. At 0.07
 * the whole blink fell inside a single frame of an eight-frame idle, so the eye
 * snapped shut and open again between two frames — which the `G4` continuity
 * gate reads, correctly, as a pop.
 */
const BLINK_WIDTH = 0.17;

/**
 * Standing still has to read as *alive*. On this creature that is the gular
 * sac: an amphibian at rest pumps its throat continuously, and it is the one
 * idle cue that survives a 32 px tile, because it changes the silhouette under
 * the jaw rather than moving a limb a pixel.
 */
const BREATH_RISE = 0.006;
const THROAT_BASE = 0.3;
const THROAT_PUMP = 0.4;
const IDLE_CREST = 0.5;
const IDLE_CREST_TWITCH = 0.12;
const IDLE_HEAD_TURN = 0.09;
const IDLE_SWAY = 0.006;
const IDLE_ARM_DRIFT = deg(2.5);
const IDLE_ARM_ASYMMETRY = deg(3);
const IDLE_FOOT_ASYMMETRY = 0.93;
const IDLE_GRASP_ASYMMETRY = 1.5;

/**
 * Where a relaxed arm hangs. Both numbers are load-bearing: hands set inboard
 * of the shoulder roots make the forearms converge on the centreline, and a
 * drop past the arm's own reach makes the IK clamp and tip the whole arm inward.
 */
/**
 * How far down the arm's own reach a resting hand hangs, per view.
 *
 * Two values, because an arm hanging at the camera is foreshortened and an arm
 * hanging across it is not — the same limb genuinely draws shorter head-on.
 *
 * Head-on it also has work to do: at the profile's value the fingertips landed
 * on the same line as the feet and covered them, so the front view read as four
 * identical ground contacts with the legs hidden behind two of them. The slack
 * lifts the knuckles clear and puts a visible break at the elbow.
 */
const FACING_HAND_REACH = 0.8;
const SIDE_HAND_REACH = 0.92;
/** How far out from straight down a relaxed arm hangs. */
const HAND_HANG_ANGLE = deg(31);
/** How far the windup tucks the arms in, out of the tongue's path. */
const GAPE_ARM_TUCK = deg(13);
/** And how much straighter than a resting arm it holds them while it does. */
const GAPE_ARM_STRAIGHTEN = 0.08;
/** And how much closer to straight they hang while it does. */
const GAPE_ARM_REACH = FACING_HAND_REACH + GAPE_ARM_STRAIGHTEN;
/** How far behind the hip a profile hand hangs. */
const SIDE_HAND_ANGLE = deg(-6);

/**
 * A hand target on the arm's own reach circle, measured from where this pose's
 * shoulder actually is.
 *
 * Two traps, both of which this closes:
 *
 * Choosing a sideways spread and a vertical drop independently puts the target
 * on the corner of a box, and a box's corner is further from the shoulder than
 * the arm is long: the IK clamps and the elbow locks dead straight. That is
 * what the `G11` gate measures.
 *
 * Measuring from `SHOULDER_Y` rather than from the pose is the same trap
 * inverted. The shoulder *rises* as the creature crouches, so a hand hung off
 * the resting height sits at two thirds of the arm's reach and the IK spends
 * the slack bowing the elbow out — which is what made the windup read as a
 * figure putting its hands on its hips.
 *
 * `angle` is measured from straight down, positive toward +X. A negative angle
 * belongs to the figure's left arm and a positive one to its right, which is
 * how the side the target hangs from is derived.
 */
function handAt(pose: TrogPose, view: TrogView, angle: number, reachShare: number): Pt {
  return handOf(pose, view, angle < 0 ? 'left' : 'right', angle, reachShare);
}

/**
 * The same target with the arm named outright, for the profile — where both
 * hands hang *behind* the hip and so both carry a negative angle, leaving the
 * sign unable to say which shoulder each belongs to.
 */
function handOf(
  pose: TrogPose,
  view: TrogView,
  side: TrogSide,
  angle: number,
  reachShare: number,
): Pt {
  const joint = shoulderJoint(pose, view, side);
  const reach = ARM_LENGTH * reachShare;
  return pt(joint.x + Math.sin(angle) * reach, joint.y + Math.cos(angle) * reach);
}
/**
 * Feet stand wide. This is a squat, splayed stance — a narrow one on legs this
 * long and this bent reads as a person crouching rather than as an animal.
 */
const IDLE_FOOT_SPREAD = 0.21;
/** Edge-on the two feet are only slightly staggered. */
const IDLE_SIDE_FOOT_LEAD = 0.085;
/** The near hand hangs a little less far back than the far one. */
const SIDE_NEAR_HAND_SHARE = 0.4;
/** How far it keeps its blind face toward the camera while standing in profile. */
const SIDE_HEAD_TURN = 0.18;

function idleBase(phase: number): TrogPose {
  const breath = Math.sin(phase * TWO_PI);
  const pose = restingPose();
  pose.bob = -BREATH_RISE * (breath * 0.5 + 0.5);
  pose.throat = THROAT_BASE + THROAT_PUMP * (breath * 0.5 + 0.5);
  pose.crest = IDLE_CREST + IDLE_CREST_TWITCH * breath;
  pose.eyeShut = blink(phase, BLINK_AT);
  // The tail drifts on its own slow beat rather than on the breath's. Locked to
  // the breath it pumps in time with the throat, and two things moving on one
  // clock read as one mechanism.
  pose.tailSway = Math.sin(phase * TWO_PI * IDLE_TAIL_BEATS) * IDLE_TAIL_SWAY;
  pose.tailLift = IDLE_TAIL_LIFT;
  return pose;
}

/**
 * Where the head is looking, as a share of a full turn, `phase` through an idle.
 *
 * It dwells at the two extremes and crosses the middle quickly — a head that
 * sweeps at constant speed reads as a scanning turret, and the frames that
 * matter are the ones at the ends, where the snout lays its full length across
 * the screen. Never reaches zero: square-on is the one angle that hides the
 * snout completely.
 */
function idleLook(phase: number): number {
  const swing = Math.sin(phase * TWO_PI);
  const dwelt = Math.sign(swing) * Math.pow(Math.abs(swing), IDLE_LOOK_DWELL);
  return dwelt * IDLE_LOOK_REACH;
}

const IDLE_LOOK_DWELL = 0.55;
const IDLE_LOOK_REACH = 0.92;
/** How far the sweep swings either side of where the body is already facing. */
const IDLE_LOOK_ABOUT_BODY = 0.34;

function idleFront(phase: number): TrogPose {
  const pose = idleBase(phase);
  faceThreeQuarter(pose, false);
  // Around the way the body already faces, not around the camera.
  pose.headYaw = BODY_LOOK + idleLook(phase) * IDLE_LOOK_ABOUT_BODY;
  const sway = Math.sin(phase * TWO_PI);
  pose.sway = sway * IDLE_SWAY;
  pose.headTurn = sway * IDLE_HEAD_TURN;
  // The same joint angles the head-on walk swings around, so stepping off from
  // standing cannot change the shape of its arms — only how much they move.
  pose.rightArmAngles = facingArmAngles(RIGHT_ARM, sway * IDLE_ARM_DRIFT, 0);
  // A hair looser on one side. Mirror-perfect limbs are the single loudest cue
  // that a figure was assembled rather than drawn.
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, sway * IDLE_ARM_DRIFT + IDLE_ARM_ASYMMETRY, 0);
  pose.leftFoot = pt(-IDLE_FOOT_SPREAD * IDLE_FOOT_ASYMMETRY, 0);
  pose.rightFoot = pt(IDLE_FOOT_SPREAD, 0);
  pose.leftGrasp = restingPose().leftGrasp * IDLE_GRASP_ASYMMETRY;
  // Knees thrown out to the sides, matching the head-on walk, so standing up
  // out of a step cannot change the shape of its stance.
  pose.leftForeshorten = SPLAYED_KNEES;
  pose.rightForeshorten = SPLAYED_KNEES;
  return pose;
}

/**
 * Head-on foreshortening for both legs, everywhere.
 *
 * Zero, and deliberately: a human's knee hinges away from a head-on camera and
 * so reads as a straight column, but this thing squats with its knees out to
 * the sides. Flattening them onto the hip→ankle line is what made the first
 * pass read as a person standing in a pond.
 */
const SPLAYED_KNEES = 0;

/**
 * The depth staggering that makes a three-quarter body read as one.
 *
 * The two head-on views are turned poses now, not square ones, so the figure's
 * two sides are no longer at the same distance from the camera: one shoulder
 * leads, one arm passes in front of the trunk while the other passes behind it,
 * and one shin is nearer than the other. Without this the turn shows only in
 * the head and the whole thing reads as an owl on a mannequin.
 *
 * `away` flips which side leads, because the same physical turn seen from
 * behind puts the other shoulder forward.
 */
function faceThreeQuarter(pose: TrogPose, away: boolean): void {
  const lead = away ? -1 : 1;
  pose.twist = lead * THREE_QUARTER_TWIST;
  // The trailing arm swings behind the trunk; the leading one in front of it.
  pose.leftArmBehind = !away;
  pose.rightArmBehind = away;
  pose.leftLegNearness = away ? THREE_QUARTER_NEAR_LEG : THREE_QUARTER_FAR_LEG;
  pose.rightLegNearness = away ? THREE_QUARTER_FAR_LEG : THREE_QUARTER_NEAR_LEG;
}

const THREE_QUARTER_TWIST = 0.55;
const THREE_QUARTER_NEAR_LEG = 0.62;
const THREE_QUARTER_FAR_LEG = 0.12;
/**
 * Where the head looks when it is looking straight ahead: along the body, which
 * a turned body has already swung most of the way round. The sweep rides on top
 * of this rather than being centred on the camera.
 */
const BODY_LOOK = 0.62;

function idleSide(phase: number): TrogPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * TWO_PI);
  // Edge-on a hanging hand belongs beside the hip, not out in front of it:
  // anything forward of the centreline reads as reaching for something.
  pose.leftHand = handOf(pose, 'side', 'left', SIDE_HAND_ANGLE, SIDE_HAND_REACH);
  pose.rightHand = handOf(
    pose,
    'side',
    'right',
    SIDE_HAND_ANGLE * SIDE_NEAR_HAND_SHARE,
    SIDE_HAND_REACH,
  );
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD, 0);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD, 0);
  pose.headTurn = SIDE_HEAD_TURN + sway * IDLE_HEAD_TURN;
  pose.headPitch = sway * IDLE_HEAD_PITCH;
  // Edge-on the elbow has to break backward; forward it swings the forearm
  // across the creature's own gut.
  pose.elbowFlare = -0.4;
  return pose;
}

function idleBack(phase: number): TrogPose {
  const pose = idleFront(phase);
  pose.headTurn = -pose.headTurn;
  // Turning its head to its own right swings the snout the other way across
  // the screen when the creature is seen from behind.
  pose.headYaw = -pose.headYaw;
  faceThreeQuarter(pose, true);
  return pose;
}

const IDLE_HEAD_PITCH = deg(2.5);

// ── Walking ──────────────────────────────────────────────────────────────────

/**
 * A slow prowl, timed the way animators key a walk: contact → down → passing →
 * up, twice per cycle. Phase 0 is right-foot contact.
 *
 * The thing that makes a walk read as walking rather than as a figure kicking
 * its feet out in front of it is the *tuck*: after toe-off the foot comes up
 * behind the hip with the knee folded, passes under the body, and only then
 * reaches forward.
 */
const STRIDE = 0.16;
const TOE_LIFT = 0.045;
const TOE_LIFT_AT = 0.12;
const TUCK_LIFT = 0.15;
const PASS_LIFT = 0.1;
const REACH_LIFT = 0.028;
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;

/**
 * Shallow. The whole point of this gait is that the creature keeps its head at
 * one height while it closes — a stalking predator does not bounce, and the
 * player has to be able to read the moment it stops and gapes.
 */
const WALK_BOB = 0.026;
const WALK_LEAN = deg(2);
const WALK_STOOP = 0.92;
const WALK_CREST = 0.55;
const WALK_THROAT = 0.25;
const HEEL_STRIKE_PITCH = deg(-7);
const TOE_OFF_PITCH = deg(15);
const SWING_PITCH = deg(-5);

/**
 * One foot of a profile gait. During stance the foot is planted and slides
 * backward under the body at a constant rate — the body is what moves.
 */
function gaitFootSide(phase: number): { foot: Pt; pitch: number } {
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
 * Walking at the camera. Almost none of the stride is visible head-on, so the
 * step has to be sold by the foot rising and the leg foreshortening rather than
 * by any sideways travel.
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

const FACING_LIFT_SHARE = 0.95;
const FACING_PITCH_SHARE = 0.5;
const FACING_STRIDE_DRIFT = 0.032;
/** The lift at which the swing leg's shin is drawn at full near-camera width. */
const FULLY_NEAR_LIFT = TUCK_LIFT * FACING_LIFT_SHARE;

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
 * Small. These arms are long and heavy and the creature is slow: swung at a
 * human's amplitude they read as jogging, which is the one thing a stalking
 * ambush predator must not look like.
 */
const ARM_SWING_ANGLE = deg(22);
const ARM_BACKSWING_SHARE = 0.55;
const FOREARM_FOLLOW = 0.2;
/** The bend a walking elbow simply holds, keeping the forearm ahead of the arm. */
const ELBOW_FLEX = deg(16);
const RIGHT_ARM = 1;
const LEFT_ARM = -1;

/**
 * One arm of a head-on walk, as joint angles.
 *
 * Head-on the upper arm is nearly end-on to the viewer and shows almost
 * nothing; the forearm carries the visible travel, and it does so by
 * *foreshortening* — a 2D arm has no other way to swing toward the camera.
 * Placing the hand instead is the trap: a shorter hand target is slack the IK
 * has nowhere to put but the elbow, which duly swings out to the side.
 */
function facingArmAngles(side: number, drift: number, forward: number): ArmAngles {
  // The travel is inward only, and it has to be a *remapped* swing rather than
  // a rectified one: folding the negative half back up gives each arm two
  // inward peaks per stride and the swing reads at double speed.
  const inward = (forward + 1) / 2;
  const upper = side * inward * FACING_UPPER_SWING + drift;
  const fore = side * inward * FACING_FOREARM_SWING + drift;
  const foreScale = lerp(1, FACING_FORE_SQUASH, Math.abs(forward));
  return { upper, fore, foreScale };
}

const FACING_UPPER_SWING = deg(5);
const FACING_FOREARM_SWING = deg(10);
const FACING_FORE_SQUASH = 0.84;

function walkSide(phase: number): TrogPose {
  const pose = restingPose();
  const right = gaitFootSide(phase);
  const left = gaitFootSide(phase + 0.5);
  const bobPhase = Math.abs(Math.sin(phase * TWO_PI));

  // The pelvis *drops* at contact rather than rising at mid-stance, which is
  // what a real pelvis does and what buys the stride: a foot planted a stride
  // ahead of a hip held at standing height is out of the leg's reach, the IK
  // clamps, and the clamped leg locks straight with its foot off the floor.
  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.lean = WALK_LEAN;
  pose.stoop = WALK_STOOP;
  pose.crest = WALK_CREST;
  pose.throat = WALK_THROAT;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;

  const rightForward = -Math.sin(phase * TWO_PI);
  pose.rightArmAngles = sideArmAngles(rightForward);
  pose.leftArmAngles = sideArmAngles(-rightForward);
  pose.rightGrasp = WALK_GRASP;
  pose.leftGrasp = WALK_GRASP;
  pose.elbowFlare = -0.5;
  pose.headTurn = 0.22;
  pose.eyeShut = blink(phase, BLINK_AT);
  // Counter to the stride, and carried high: a walking lizard's tail is a
  // balance weight swinging against the hips, and a tail that swings *with*
  // them reads as a rope tied on rather than as part of the animal.
  pose.tailSway = -Math.sin(phase * TWO_PI) * WALK_TAIL_SWAY;
  pose.tailLift = WALK_TAIL_LIFT;
  return pose;
}

function walkFacing(phase: number, away: boolean): TrogPose {
  const pose = restingPose();
  const right = gaitFootFacing(phase, 1);
  const left = gaitFootFacing(phase + 0.5, -1);
  const bobPhase = Math.abs(Math.sin(phase * TWO_PI));

  pose.bob = -WALK_BOB * bobPhase;
  pose.sway = Math.sin(phase * TWO_PI) * WALK_SWAY;
  pose.stoop = WALK_STOOP;
  pose.crest = WALK_CREST;
  pose.throat = WALK_THROAT;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.rightLegNearness = right.nearness;
  pose.leftLegNearness = left.nearness;
  // Both legs, not just the swinging one: a bow that appears on the planted leg
  // and vanishes on the swinging one flickers once per step and reads as a
  // wiggle.
  pose.rightForeshorten = SPLAYED_KNEES;
  pose.leftForeshorten = SPLAYED_KNEES;

  const rightForward = -Math.sin(phase * TWO_PI);
  pose.rightArmAngles = facingArmAngles(RIGHT_ARM, 0, rightForward);
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, 0, -rightForward);
  // Which side an arm is drawn on is per view, never per frame: toward the
  // camera an arm is in front of the chest for the whole cycle, away from it
  // behind the back for the whole cycle. Switching mid-swing pops at the
  // shoulder.
  pose.rightGrasp = WALK_GRASP;
  pose.leftGrasp = WALK_GRASP;
  faceThreeQuarter(pose, away);
  pose.twist += Math.sin(phase * TWO_PI) * FACING_SHOULDER_TWIST;
  pose.headTurn = away ? 0 : Math.sin(phase * TWO_PI) * IDLE_HEAD_TURN;
  pose.eyeShut = blink(phase, BLINK_AT);
  pose.tailSway = -Math.sin(phase * TWO_PI) * WALK_TAIL_SWAY;
  pose.tailLift = WALK_TAIL_LIFT;
  // Held at a slant with a small bob in it, rather than swept: a creature going
  // somewhere is looking where it is going, and a head panning while the legs
  // walk reads as two animations playing at once.
  pose.headYaw = (away ? -1 : 1) * (BODY_LOOK + Math.sin(phase * TWO_PI) * WALK_LOOK_BOB);
  return pose;
}

const WALK_LOOK_BOB = 0.12;
const WALK_SWAY = 0.012;
/**
 * The tail's swing, against the hips. Full amplitude: it is the one part of
 * the creature with nothing to collide with, and edge-on it is the only thing
 * on screen far enough from the centreline for its motion to be legible.
 */
const WALK_TAIL_SWAY = 1;
/** Carried clear of the floor at a walk, dragged at rest. */
const WALK_TAIL_LIFT = 0.72;
const IDLE_TAIL_SWAY = 0.42;
const IDLE_TAIL_LIFT = 0.3;
/** Slower than the breath, and not a whole number of it, so the two never lock. */
const IDLE_TAIL_BEATS = 0.5;
const WALK_GRASP = 0.45;
/**
 * Barely there: the shoulders are what carry the *upper* arm, and head-on the
 * upper arm is the part that should not visibly move at all.
 */
const FACING_SHOULDER_TWIST = 0.09;

// ── Gape: the windup ─────────────────────────────────────────────────────────

/**
 * The telegraph. Fifty game frames of it, which is a very long time to hold a
 * pose, so it has to keep changing: the jaw hinges open, the throat inflates,
 * the crest snaps up, the weight settles back onto the rear leg, and the arms
 * come out and down into a threat spread.
 *
 * The whole point is that a player who sees this has time to step out of the
 * cone. Nothing here may be subtle.
 */
/** How far the jaw is already cracked on the windup's first frame. */
const GAPE_CRACK = 0.3;
const GAPE_CROUCH = 0.55;
const GAPE_STOOP = 0.6;
const GAPE_FOOT_SETTLE = 0.05;
const SIDE_SPREAD_SHARE = 0.45;

function gapeBase(progress: number): TrogPose {
  const t = clamp01(progress);
  const open = easeInOut(t);
  const pose = restingPose();
  // The jaw is driven off the raw progress, not off the eased `open`: eased
  // *and* ramped, the first half of the windup showed no mouth at all, and the
  // windup is the only warning the player gets. It leads; the crest follows it
  // and the throat inflates last, because three things starting at three
  // different moments read as a build where three moving together read as one
  // keyframe held for fifty frames.
  pose.gape = lerp(GAPE_CRACK, 1, t);
  pose.crest = lerp(IDLE_CREST, 1, ramp(open, 0.1, 0.6));
  pose.throat = lerp(THROAT_BASE, 1, ramp(open, 0.3, 1));
  pose.tongue = ramp(open, 0.4, 1);
  pose.crouch = lerp(restingPose().crouch, GAPE_CROUCH, open);
  pose.stoop = lerp(RESTING_STOOP, GAPE_STOOP, open);
  pose.eyeShut = 0;
  return pose;
}

function gapeFacing(progress: number, away: boolean): TrogPose {
  const open = easeInOut(clamp01(progress));
  const pose = gapeBase(progress);
  const spread = IDLE_FOOT_SPREAD + GAPE_FOOT_SETTLE * open;
  pose.leftFoot = pt(-spread, 0);
  pose.rightFoot = pt(spread, 0);
  pose.leftForeshorten = SPLAYED_KNEES;
  pose.rightForeshorten = SPLAYED_KNEES;
  // Down and tucked, not out and akimbo: flaring the elbows made the whole
  // windup read as a person putting their hands on their hips.
  const gapeAngle = HAND_HANG_ANGLE - GAPE_ARM_TUCK * open;
  const gapeView: TrogView = away ? 'back' : 'front';
  pose.leftHand = handAt(pose, gapeView, -gapeAngle, GAPE_ARM_REACH);
  pose.rightHand = handAt(pose, gapeView, gapeAngle, GAPE_ARM_REACH);
  pose.leftGrasp = lerp(0.25, 0, open);
  pose.rightGrasp = lerp(0.25, 0, open);
  faceThreeQuarter(pose, away);
  pose.elbowFlare = 0.5;
  pose.headYaw = away ? -ATTACK_LOOK : ATTACK_LOOK;
  return pose;
}

/**
 * The angle the head is locked at through both attack rows.
 *
 * Much less than the body's own turn, but never square: the creature snaps its
 * head round onto its target while its body stays angled. That is what a
 * real animal does, and it is also the only thing that makes the tongue read.
 * Held at the body's angle the mouth points fifty degrees off the direction the
 * tongue fires in, so the tongue crossed in front of the creature's own face
 * instead of coming out of it.
 *
 * Constant through the row, too: `TROGLODYTE_MOUTH_ANCHORS` carries one anchor
 * per view, so the point the tongue leaves from is baked once.
 */
const ATTACK_LOOK = 0.34;

function gapeSide(progress: number): TrogPose {
  const open = easeInOut(clamp01(progress));
  const pose = gapeBase(progress);
  // Edge-on the windup is a *coil*: the head draws back over the rear foot and
  // the front foot plants forward, so the lunge that follows has somewhere to
  // come from. Without it the strike is a head that teleports forward.
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD - GAPE_REAR_FOOT_BACK * open, 0);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD + GAPE_FRONT_FOOT_OUT * open, 0);
  pose.lean = -GAPE_COIL_LEAN * open;
  pose.headPitch = GAPE_SNOUT_LIFT * open;
  // Edge-on the threat spread is depth, so the two hands separate only a
  // little; thrown as wide as they go head-on they cross the creature's gut.
  pose.leftHand = handOf(
    pose,
    'side',
    'left',
    SIDE_HAND_ANGLE - GAPE_ARM_TUCK * open * SIDE_SPREAD_SHARE,
    GAPE_ARM_REACH,
  );
  pose.rightHand = handOf(
    pose,
    'side',
    'right',
    SIDE_HAND_ANGLE + GAPE_ARM_TUCK * open * SIDE_SPREAD_SHARE,
    GAPE_ARM_REACH,
  );
  pose.leftGrasp = lerp(0.25, 0, open);
  pose.rightGrasp = lerp(0.25, 0, open);
  pose.elbowFlare = -0.45;
  pose.headTurn = SIDE_HEAD_TURN;
  return pose;
}

const GAPE_REAR_FOOT_BACK = 0.06;
const GAPE_FRONT_FOOT_OUT = 0.07;
const GAPE_COIL_LEAN = deg(7);
const GAPE_SNOUT_LIFT = deg(9);

// ── Lash: the strike ─────────────────────────────────────────────────────────

/**
 * The three beats of the strike, as windows over the row's progress.
 *
 * `drive` peaks at {@link LASH_IMPACT_PROGRESS}, which is the frame the mob
 * deals its damage on; `recover` runs it back to the resting pose so the last
 * frame of the row hands off cleanly to the idle that follows it.
 */
interface LashPhases {
  readonly coil: number;
  readonly drive: number;
  readonly recover: number;
}

function lashPhases(progress: number): LashPhases {
  const t = clamp01(progress);
  const wind = 1 - ramp(t, 0, LASH_IMPACT_PROGRESS);
  const recover = ramp(t, LASH_IMPACT_PROGRESS, 1);
  const drive = easeOut(ramp(t, LASH_COIL_END, LASH_IMPACT_PROGRESS)) * (1 - recover);
  return { coil: wind * (1 - recover), drive, recover };
}

/** How much of the strike is spent coiling before the head goes anywhere. */
const LASH_COIL_END = 0.14;
const LASH_HEAD_THRUST = deg(11);
const LASH_LUNGE_STOOP = 1;
const LASH_STEP = 0.09;
/** How far the strike flings the arms out of the tongue's way. */
const LASH_ARM_FLING = deg(15);

function lashBase(progress: number): TrogPose {
  const { coil, drive, recover } = lashPhases(progress);
  const pose = restingPose();
  // The jaw stays wide through the thrust and only shuts on the recovery: a
  // gape that closes as the tongue leaves reads as the creature swallowing.
  pose.gape = Math.max(coil, 1 - recover);
  pose.crest = lerp(1, IDLE_CREST, recover);
  pose.throat = lerp(1, THROAT_BASE, easeInOut(recover)) * (1 - drive * THROAT_EMPTY);
  pose.tongue = 1 - drive;
  pose.crouch = lerp(GAPE_CROUCH, restingPose().crouch, recover) - drive * LASH_RISE;
  pose.stoop = lerp(GAPE_STOOP, LASH_LUNGE_STOOP, drive) * (1 - recover) + RESTING_STOOP * recover;
  // The tail is the counterweight to the lunge: it comes up and straightens as
  // the head is thrown forward, which is the whole reason a striking lizard
  // does not fall on its face.
  pose.tailLift = lerp(LASH_TAIL_COIL_LIFT, 1, drive) * (1 - recover) + IDLE_TAIL_LIFT * recover;
  pose.tailSway = LASH_TAIL_SET * (1 - recover);
  return pose;
}

/** Held low and gathered through the coil, so the drive has somewhere to go. */
const LASH_TAIL_COIL_LIFT = 0.2;
/** A fixed lie rather than a swing — nothing about a strike is rhythmic. */
const LASH_TAIL_SET = -0.35;

function lashFacing(progress: number, away: boolean): TrogPose {
  const { coil, drive, recover } = lashPhases(progress);
  const pose = lashBase(progress);
  const spread = IDLE_FOOT_SPREAD + GAPE_FOOT_SETTLE * (1 - recover);
  pose.leftFoot = pt(-spread, 0);
  pose.rightFoot = pt(spread, 0);
  pose.leftForeshorten = SPLAYED_KNEES;
  pose.rightForeshorten = SPLAYED_KNEES;
  // Head-on the lunge is depth, so it shows as the skull growing and the arms
  // being flung out of the way — see `ViewSpec.stoopHeadGrow`.
  const lashAngle = HAND_HANG_ANGLE - GAPE_ARM_TUCK * (1 - recover) + LASH_ARM_FLING * drive;
  const lashView: TrogView = away ? 'back' : 'front';
  pose.leftHand = handAt(pose, lashView, -lashAngle, GAPE_ARM_REACH);
  pose.rightHand = handAt(pose, lashView, lashAngle, GAPE_ARM_REACH);
  pose.leftGrasp = drive;
  pose.rightGrasp = drive;
  faceThreeQuarter(pose, away);
  pose.elbowFlare = 0.5;
  pose.headTurn = 0;
  pose.headYaw = away ? -ATTACK_LOOK : ATTACK_LOOK;
  pose.eyeShut = coil * COIL_SQUINT;
  return pose;
}

function lashSide(progress: number): TrogPose {
  const { coil, drive, recover } = lashPhases(progress);
  const pose = lashBase(progress);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD - GAPE_REAR_FOOT_BACK * (1 - recover), 0);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD + GAPE_FRONT_FOOT_OUT + LASH_STEP * drive, 0);
  pose.lean = -GAPE_COIL_LEAN * coil + LASH_HEAD_THRUST * drive;
  pose.headPitch = GAPE_SNOUT_LIFT * coil - LASH_SNOUT_DROP * drive;
  // Edge-on the arms are thrown *back* as the head goes forward, which is what
  // gives the lunge somewhere to come from.
  const sideSpread = GAPE_ARM_TUCK * (1 - recover) * SIDE_SPREAD_SHARE;
  const backSwing = SIDE_HAND_ANGLE - LASH_ARM_FLING * drive;
  pose.leftHand = handOf(pose, 'side', 'left', backSwing - sideSpread, GAPE_ARM_REACH);
  pose.rightHand = handOf(pose, 'side', 'right', backSwing + sideSpread, GAPE_ARM_REACH);
  pose.leftGrasp = drive;
  pose.rightGrasp = drive;
  pose.elbowFlare = -0.45;
  pose.headTurn = SIDE_HEAD_TURN;
  pose.eyeShut = coil * COIL_SQUINT;
  return pose;
}

/** The gular sac empties into the strike, which is where the tongue's push comes from. */
const THROAT_EMPTY = 0.7;
const LASH_RISE = 0.18;
const LASH_SNOUT_DROP = deg(6);
const COIL_SQUINT = 0.5;

// ── Row manifest ─────────────────────────────────────────────────────────────

type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: TrogView;
  /** Null on the gore row, whose cells are pieces rather than poses. */
  readonly pose: ((frame: number) => TrogPose) | null;
}

const GORE_PIECES = trogGorePieces();

/**
 * Extra scale applied to the gore pieces on top of {@link TROG_SCALE}.
 *
 * The pieces are drawn at their own tile-unit sizes rather than sliced off the
 * creature, so they do not inherit its scale — but they do have to survive the
 * runtime's own 0.5x. Held at 1 they come out around six screen pixels across,
 * below the size at which one shape can be told from another.
 */
const GORE_PIECE_SCALE = 1.7;
/** Pixels per tile unit a gore piece is painted at. */
const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

export const ROWS: readonly RowSpec[] = [
  {
    name: 'idle',
    frameCount: FACING_IDLE_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => idleFront(cyclePhase(f, FACING_IDLE_FRAMES)),
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
    frameCount: FACING_IDLE_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => idleBack(cyclePhase(f, FACING_IDLE_FRAMES)),
  },
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), false),
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
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), true),
  },
  {
    name: 'gape',
    frameCount: GAPE_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => gapeFacing(shotProgress(f, GAPE_FRAMES), false),
  },
  {
    name: 'gape_side',
    frameCount: GAPE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => gapeSide(shotProgress(f, GAPE_FRAMES)),
  },
  {
    name: 'gape_away',
    frameCount: GAPE_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: (f) => gapeFacing(shotProgress(f, GAPE_FRAMES), true),
  },
  {
    name: 'lash',
    frameCount: LASH_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => lashFacing(shotProgress(f, LASH_FRAMES), false),
  },
  {
    name: 'lash_side',
    frameCount: LASH_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => lashSide(shotProgress(f, LASH_FRAMES)),
  },
  {
    name: 'lash_away',
    frameCount: LASH_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: (f) => lashFacing(shotProgress(f, LASH_FRAMES), true),
  },
  {
    name: 'gore',
    frameCount: GORE_PIECES.length,
    kind: 'gore',
    view: 'side',
    pose: null,
  },
];

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

/**
 * Where the tongue leaves the mouth, per view, as a fraction of a tile measured
 * from the top-left of the creature's own tile.
 *
 * Taken from the pose the tongue actually fires on rather than from the resting
 * pose: the head thrusts nearly a third of a tile over the lash, and an anchor
 * measured standing still puts the tongue's root in the creature's chest.
 *
 * `src/sprites/troglodyteSprite.ts` carries the same numbers — the runtime
 * cannot import from `scripts/` — and the `G-MOUTH` gate compares the two.
 */
function anchorInTile(view: TrogView, pose: TrogPose): Pt {
  const inFigureSpace = mouthAnchor(view, pose);
  // Figure space has its origin between the feet with +Y up the screen as a
  // negative; the tile's own origin is its top-left corner.
  return {
    x: 0.5 + inFigureSpace.x * TROG_SCALE,
    y: GROUND_OFFSET_IN_TILE + inFigureSpace.y * TROG_SCALE,
  };
}

export function mouthAnchorsInTile(): Record<TrogView, Pt> {
  return {
    front: anchorInTile('front', lashFacing(LASH_IMPACT_PROGRESS, false)),
    side: anchorInTile('side', lashSide(LASH_IMPACT_PROGRESS)),
    back: anchorInTile('back', lashFacing(LASH_IMPACT_PROGRESS, true)),
  };
}

/** The pose each frame of a lash row is baked from, per view. */
const LASH_POSE_OF: Record<TrogView, (frame: number) => TrogPose> = {
  front: (f) => lashFacing(shotProgress(f, LASH_FRAMES), false),
  side: (f) => lashSide(shotProgress(f, LASH_FRAMES)),
  back: (f) => lashFacing(shotProgress(f, LASH_FRAMES), true),
};

/**
 * Where the mouth is on **every** frame of the lash, per view.
 *
 * One anchor per view is not enough. The head thrusts through the strike — most
 * of a third of a tile edge-on — so a single baked point is only correct on the
 * one frame it was measured at, and on every other frame the tongue's root sits
 * that far off the mouth it is supposed to be leaving. Edge-on that error runs
 * along the creature's facing, which is precisely the direction that makes the
 * tongue look like it is floating in front of its own jaw.
 */
export function lashMouthAnchorsInTile(): Record<TrogView, Pt[]> {
  const perFrame = (view: TrogView): Pt[] => {
    const frames: Pt[] = [];
    for (let f = 0; f < LASH_FRAMES; f++) frames.push(anchorInTile(view, LASH_POSE_OF[view](f)));
    return frames;
  };
  return { front: perFrame('front'), side: perFrame('side'), back: perFrame('back') };
}

// ── Bake ─────────────────────────────────────────────────────────────────────

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

function drawView(ctx: Ctx, view: TrogView, pose: TrogPose): void {
  if (view === 'front') drawTrogFront(ctx, pose);
  else if (view === 'back') drawTrogBack(ctx, pose);
  else drawTrogSide(ctx, pose);
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

      const { pose, view } = row;
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
          // Scaled about the ground line, which is the origin of figure space,
          // so a larger creature still stands on the tile its feet belong to.
          ctx.scale(TROG_SCALE, TROG_SCALE);
          drawView(ctx, view, pose(frame));
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
  /** Furthest the animation rows reach from the painter's origin, in pixels. */
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  /** Furthest any gore piece reaches from its own ink centre, in pixels. */
  readonly goreRadius: number;
  /** Shift, in tile units, that puts each gore piece's ink on the cell centre. */
  readonly goreOffsets: ReadonlyMap<number, Pt>;
  /** Frames that painted nothing — the signature of a NaN pose. */
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
      const inkCentreX = (box.minX + box.maxX) / 2;
      const inkCentreY = (box.minY + box.maxY) / 2;
      // A severed limb has its mass well off its construction origin, which
      // would leave it drawn to one side of a cell sized for it. This offset
      // pulls the ink back to the middle, which is what makes `goreRadius`
      // below a meaningful measure of how big the pieces actually are.
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

interface SheetGeometry {
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
}

/**
 * How much bigger than the animation rows need the gore may make every cell.
 * Rotation safety is free — `geometryFor` guarantees it — so this bounds cost,
 * not correctness.
 */
const GORE_AREA_INFLATION_LIMIT = 2;

function bake(): BakedSheet {
  // Two passes: the first measures where each gore piece's ink actually lands,
  // the second repaints it centred on that measurement.
  const measured = measure(buildJobs());
  const jobs = buildJobs(measured.goreOffsets);
  const extents = measure(jobs);

  if (extents.blankFrames.length > 0) {
    throw new Error(
      `these frames painted nothing, which almost always means a NaN in the pose: ` +
        `${extents.blankFrames.join(', ')}`,
    );
  }

  const geometry = geometryFor(extents);
  const animationOnly = geometryFor({ ...extents, goreRadius: 0 });
  const animationArea = animationOnly.frameWidth * animationOnly.frameHeight;
  const inflation = (geometry.frameWidth * geometry.frameHeight) / animationArea;
  if (inflation > GORE_AREA_INFLATION_LIMIT) {
    throw new Error(
      `the gore pieces inflate every cell to ${inflation.toFixed(2)}x the area the animation ` +
        `rows need — shrink the longest piece rather than paying for it on all ${ROWS.length} rows`,
    );
  }
  if (inflation > 1) {
    console.log(`  gore widens each cell to ${inflation.toFixed(2)}x the animation rows' own size`);
  }

  const columns = Math.max(...ROWS.map((row) => row.frameCount));
  const sheet = createCanvas(columns * geometry.frameWidth, ROWS.length * geometry.frameHeight);
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');
  const rowIndexOf = new Map(ROWS.map((row, index) => [row.name, index]));

  for (const job of jobs) {
    const rowIndex = rowIndexOf.get(job.row.name);
    if (rowIndex === undefined) throw new Error(`row "${job.row.name}" is not in ROWS`);

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
      job.frame * geometry.frameWidth,
      rowIndex * geometry.frameHeight,
      geometry.frameWidth,
      geometry.frameHeight,
    );
  }

  return {
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry,
    columns,
  };
}

// ── The tongue sheet ─────────────────────────────────────────────────────────

/**
 * Frames in the tongue's row. At least two: the row is sampled end to end, so
 * the last frame *is* full extension and a one-frame sheet would divide by zero
 * working out where the others sit.
 */
export const TONGUE_FRAMES = 8;

/**
 * The tongue's cells are anchored on the mouth rather than on a tile: the
 * runtime draws this one with a rotation, and in that mode `tileX`/`tileY` are
 * the offset from the anchor point to the top-left of the frame.
 */
function bakeTongue(): BakedSheet {
  const measureCanvas = createCanvas(TONGUE_MEASURE_WIDTH, TONGUE_MEASURE_HEIGHT);
  const measureCtx = measureCanvas.getContext('2d');
  const measureOriginX = TONGUE_ROOT_MEASURE_INSET;
  const measureOriginY = TONGUE_MEASURE_HEIGHT / 2;

  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  for (let frame = 0; frame < TONGUE_FRAMES; frame++) {
    measureCtx.clearRect(0, 0, TONGUE_MEASURE_WIDTH, TONGUE_MEASURE_HEIGHT);
    paintTongueFrame(measureCtx, frame, measureOriginX, measureOriginY);
    const box = inkBoxOf(measureCtx, TONGUE_MEASURE_WIDTH, TONGUE_MEASURE_HEIGHT);
    if (box === null) throw new Error(`tongue frame ${frame} painted nothing`);
    left = Math.max(left, measureOriginX - box.minX);
    right = Math.max(right, box.maxX - measureOriginX);
    up = Math.max(up, measureOriginY - box.minY);
    down = Math.max(down, box.maxY - measureOriginY);
  }

  const tileX = Math.ceil(left + FRAME_PADDING);
  const tileY = Math.ceil(up + FRAME_PADDING);
  const frameWidth = roundUpTo(tileX + right + FRAME_PADDING, FRAME_SIZE_QUANTUM);
  const frameHeight = roundUpTo(tileY + down + FRAME_PADDING, FRAME_SIZE_QUANTUM);

  const sheet = createCanvas(TONGUE_FRAMES * frameWidth, frameHeight);
  const sheetCtx = sheet.getContext('2d');
  const cell = createCanvas(frameWidth * SUPERSAMPLE, frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  for (let frame = 0; frame < TONGUE_FRAMES; frame++) {
    cellCtx.clearRect(0, 0, cell.width, cell.height);
    cellCtx.save();
    cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    paintTongueFrame(cellCtx, frame, tileX, tileY);
    cellCtx.restore();
    sheetCtx.drawImage(
      cell,
      0,
      0,
      cell.width,
      cell.height,
      frame * frameWidth,
      0,
      frameWidth,
      frameHeight,
    );
  }

  return {
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry: { frameWidth, frameHeight, tileX, tileY },
    columns: TONGUE_FRAMES,
  };
}

/** Room to the left of the mouth for the tongue's root to bulge back into. */
const TONGUE_ROOT_MEASURE_INSET = 48;
/**
 * The shortest the tongue is ever drawn, as a share of its full reach. Below
 * this the venom club is longer than the whip carrying it and the strike's
 * first frame reads as a bead stuck to the creature's chin.
 */
const TONGUE_MIN_EXTENSION = 0.06;
/** How much of the throw's pacing comes from the ease rather than from linear. */
const TONGUE_EASE_SHARE = 0.55;

function paintTongueFrame(ctx: Ctx, frame: number, originX: number, originY: number): void {
  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  // Sampled *end to end*, not at cell centres: the runtime scales this sheet by
  // its declared reach, so the last frame has to be the full reach. Sampled at
  // centres the longest frame baked at 0.91 of it and every strike then landed
  // a quarter of a tile short of the range it could actually damage from.
  //
  // Part eased, part linear. Sampled evenly the tongue is at 45% of full reach
  // on its second frame, which throws away the anticipation the strike is built
  // on; eased outright the first two frames barely move and the last two jump,
  // a 7:1 spread between the smallest and largest step. Floored, because an
  // ease starting at zero puts the first frame shorter than its own venom head
  // and `drawTongue` then paints nothing at all.
  const shot = frame / (TONGUE_FRAMES - 1);
  const paced = lerp(shot, easeIn(shot), TONGUE_EASE_SHARE);
  drawTongue(ctx, lerp(TONGUE_MIN_EXTENSION, 1, paced));
  ctx.restore();
}

// ── Manifest ─────────────────────────────────────────────────────────────────

const SHEET_PATH = 'src/images/enemies/troglodyte.png';
const TONGUE_SHEET_PATH = 'src/images/enemies/troglodyte_tongue.png';
const MANIFEST_PATH = 'src/images/enemies/manifest.json';
const BODY_KEY = 'troglodyte';
const TONGUE_KEY = 'troglodyte_tongue';

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

function bodyManifestEntry(sheet: BakedSheet): ManifestEntry {
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
    path: 'enemies/troglodyte.png',
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

function tongueManifestEntry(sheet: BakedSheet): ManifestEntry {
  return {
    path: 'enemies/troglodyte_tongue.png',
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states: { extend: { row: 0, frameCount: TONGUE_FRAMES } },
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
function verifyManifest(body: BakedSheet, tongue: BakedSheet): void {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };

  let mismatched = false;
  const check = (key: string, required: ManifestEntry): void => {
    if (canonicalJson(manifest[key]) === canonicalJson(required)) return;
    console.error(
      `\n${MANIFEST_PATH} is out of sync with the bake. Replace its "${key}" entry with:\n` +
        `${JSON.stringify(required, null, 2)}\n`,
    );
    mismatched = true;
  };
  check(BODY_KEY, bodyManifestEntry(body));
  check(TONGUE_KEY, tongueManifestEntry(tongue));

  if (mismatched) {
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

function writeSheets(): void {
  console.log(`Generating troglodyte sheets (tileScale=${TILE_SCALE}, scale=${TROG_SCALE})…`);
  const body = bake();
  const tongue = bakeTongue();
  writeFileSync(resolve(SHEET_PATH), body.buffer);
  writeFileSync(resolve(TONGUE_SHEET_PATH), tongue.buffer);

  console.log(`  → ${SHEET_PATH}`);
  console.log(
    `  → ${body.columns * body.geometry.frameWidth}×${ROWS.length * body.geometry.frameHeight}px  ` +
      `(${ROWS.length} rows × ${body.columns} cols of ` +
      `${body.geometry.frameWidth}×${body.geometry.frameHeight})`,
  );
  ROWS.forEach((row, index) => {
    console.log(`     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view})`);
  });
  console.log(`  tileX=${body.geometry.tileX}  tileY=${body.geometry.tileY}`);
  console.log(
    `  → ${TONGUE_SHEET_PATH}  ${TONGUE_FRAMES}×${tongue.geometry.frameWidth}×` +
      `${tongue.geometry.frameHeight}px  tileX=${tongue.geometry.tileX} tileY=${tongue.geometry.tileY}`,
  );
  const anchors = mouthAnchorsInTile();
  console.log(
    `  mouth anchors (tile fractions): ` +
      (['front', 'side', 'back'] as const)
        .map((view) => `${view}=(${anchors[view].x.toFixed(4)}, ${anchors[view].y.toFixed(4)})`)
        .join('  '),
  );
  console.log(`  tongue reach: ${TONGUE_REACH_TILES.toFixed(2)} tiles`);
  verifyManifest(body, tongue);
}

// The review harness and the gate module import ROWS from here, so painting the
// sheets has to be something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheets();
}

export {
  bake,
  bakeTongue,
  gapeSide,
  idleFront,
  idleSide,
  lashSide,
  lashFacing,
  walkSide,
  walkFacing,
  writeSheets,
};
