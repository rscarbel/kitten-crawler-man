/**
 * The Hoarder, as a painted figure: the choreography, the cell geometry, and
 * the `FigureDef` the runtime cache and the review harness both draw through.
 *
 * This module is choreography and nothing else — one pose function per row, the
 * row table, and the placement of a pose or a gore piece inside its cell.
 * Anatomy, palette and every stroke of paint live in `hoarderArt.ts`, and the
 * six pieces she comes apart into in `hoarderGore.ts`.
 *
 * Her gait is the whole read of her: someone this heavy does not swing a leg
 * through, the pelvis tips and the entire mass is carried over the stance foot
 * once per step, and the belly arrives a beat after the hips do. Her leg is
 * almost exactly as long as her hip is high, so every row spends its bob
 * *downward* — a pelvis lifted at all puts the planted ankle beyond the leg's
 * reach and the IK clamps.
 *
 * The art invariants live in `scripts/gates-hoarder.ts`, which the review
 * harness runs: `npm run render:hoarder`.
 */

import {
  ARM_LENGTH,
  FIGURE_HEIGHT,
  type HoarderPose,
  type HoarderView,
  type Pt,
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
} from './hoarderArt';
import { type GorePiece, hoarderGorePieces } from './hoarderGore';
import { type FigureDef, figureStates } from '../figure/figureDef';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Where the floor sits inside the tile, matching the other dungeon mobs. */
export const GROUND_OFFSET_PX = 58;

/**
 * The cell every pose and every gore piece is painted into, and where her own
 * tile sits inside it.
 *
 * These four numbers were measured by the bake this figure replaces — her
 * widest pose plus padding, quantised, and widened until a spinning gore piece
 * could not clip its own cell — and `scripts/parity-figure-sheet.ts` is what
 * proved the painter still fills exactly that cell. The gates re-check that
 * nothing paints against the edge, which is what would say a pose has outgrown
 * them.
 */
const FRAME_WIDTH = 208;
const FRAME_HEIGHT = 280;
const TILE_X = 72;
const TILE_Y = 191;

/** Poses are painted with the origin on the ground line, at the cell's centre. */
const POSE_ORIGIN_X = FRAME_WIDTH / 2;
const POSE_ORIGIN_Y = TILE_Y + GROUND_OFFSET_PX;

/**
 * How tall she stands on screen. The player is 1.46 tiles, so this is the 2.5x
 * that fifteen feet is against six — and it is applied here rather than in the
 * anatomy so retuning her size never silently redraws the choreography.
 */
export const HOARDER_TILES_TALL = 3.6;
const HOARDER_SCALE = HOARDER_TILES_TALL / FIGURE_HEIGHT;

/**
 * Gore is drawn in the same units as the figure, because every piece is
 * authored at the size of the part it came off. Scaled up independently, a
 * piece measured against her anatomy still renders half again as big as the
 * part it came from, and "her head, only bigger" is exactly the note this art
 * came back with.
 */
const GORE_PIECE_SCALE = HOARDER_SCALE;
export const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

export const WALK_FRAMES = 12;
export const VOMIT_FRAMES = 12;
export const IDLE_FRAMES = 6;

/**
 * The frame the bolus actually leaves her mouth on.
 * `src/sprites/hoarderSprite.ts` declares the same number and a gate holds the
 * two equal; the projectile spawning on any other frame either precedes her jaw
 * dropping or trails it.
 */
export const VOMIT_RELEASE_FRAME = 7;

const GORE_PIECES: readonly GorePiece[] = hoarderGorePieces();

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
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
/**
 * How far behind the breath the hair trails, in cycle phase. Hair arrives after
 * the body that swung it, and a quarter turn is the longest lag that still
 * reads as the same motion rather than as a second, unrelated one.
 */
const HAIR_LAG_QUARTER_TURN = 0.25;
/**
 * How far the hips travel from side to side while she stands, in tiles.
 *
 * Nobody stands on two feet evenly for long, and least of all somebody this
 * heavy: the weight goes onto one hip, rests there, and comes back. It is the
 * largest thing her idle does, and at half her walk's rock it is a transfer of
 * weight rather than a step.
 *
 * It also runs on its own clock rather than on her lungs', which is what keeps
 * the six frames six pictures. Her breath is a sine of the cycle, and a sine
 * sampled at six frames takes every one of its values twice — the row painted
 * move, hold, move, move, hold, move, byte-distinct only inside the head box
 * and visually stuck. A weight shift a quarter turn off the breath puts the two
 * in quadrature, so the pair traces a circle through the cycle and the six
 * frames sit an even sixth of a turn apart with no two alike.
 */
const IDLE_WEIGHT_SHIFT = 0.03;
/**
 * How far the torso tips back against that shift, in radians.
 *
 * The hips going out from under her would topple her; what actually happens is
 * that the spine leans the other way and keeps the head roughly over the feet.
 * Edge-on the lateral shift is foreshortened away and this counter-lean is all
 * that survives, which is exactly what a standing rock on the balls of the feet
 * looks like from the side — so the profile idle carries the same motion as the
 * head-on one rather than going still in the view she is most often seen in.
 *
 * Partial on purpose, and this is the whole of the tuning. The lean reaches the
 * torso outline as a shear about the hip, so it cancels the hip's own travel at
 * some height and reverses it above: set to fully centre the head it cancelled
 * at the *waist*, which pinned the belly — the widest part of her — dead still
 * over shorts that were visibly sliding around underneath it. At this the chain
 * is graded, hips through belly to head at 5.0, 2.5 and 1.75 in-game pixels of
 * travel, and she reads as one body shifting rather than as two.
 */
const IDLE_WEIGHT_COUNTER_LEAN = deg(0.9);
/** A weight shift and a breath are independent, so they sit a quarter turn apart. */
const WEIGHT_SHIFT_QUARTER_TURN = 0.25;
/**
 * How far the gut swings after the hips that carried it, and how far behind.
 *
 * The belly is loose mass hung off the pelvis, so it arrives late — the same
 * thing the walk does at `WALK_BELLY_LAG`, and held to the same share of the
 * hips' own travel the walk holds it to, so a step out of the idle does not
 * change how heavy the gut is. One frame of six is the coarsest lag this row can
 * express and is already enough to read as the gut settling after the hips have
 * stopped.
 */
const IDLE_BELLY_SWING = 0.04;
const IDLE_BELLY_LAG = 1 / IDLE_FRAMES;
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

/** Where her weight is this frame, −1 fully on one hip and +1 on the other. */
function idleWeightShift(phase: number): number {
  return Math.sin((phase + WEIGHT_SHIFT_QUARTER_TURN) * Math.PI * 2);
}

function idleBase(phase: number): HoarderPose {
  const breath = Math.sin(phase * Math.PI * 2);
  const pose = restingPose();
  pose.bellyHeave = BREATH_HEAVE * (breath * 0.5 + 0.5);
  pose.bob = STANDING_HIP_DROP + BREATH_SETTLE * (breath * 0.5 + 0.5);
  pose.blink = blink(phase, BLINK_AT);
  pose.brow = IDLE_BROW;
  const trailingBreath = Math.sin((phase - HAIR_LAG_QUARTER_TURN) * Math.PI * 2);
  pose.hairFlow = trailingBreath * IDLE_HAIR_DRIFT;
  const weightShift = idleWeightShift(phase);
  const trailingShift = idleWeightShift(phase - IDLE_BELLY_LAG);
  pose.sway = weightShift * IDLE_WEIGHT_SHIFT;
  pose.lean = -weightShift * IDLE_WEIGHT_COUNTER_LEAN;
  pose.bellySwing = trailingShift * IDLE_BELLY_SWING;
  return pose;
}

function idleFront(phase: number): HoarderPose {
  const pose = idleBase(phase);
  const breath = Math.sin(phase * Math.PI * 2);
  // Her hands rest on top of the gut rather than beside her, so they are part
  // of the belly's silhouette and have to travel with the hips that carry it.
  // Left where they were, the arms pin the widest part of her in place and the
  // shorts read as sliding around underneath a body that never moves.
  const carried = pose.sway;
  pose.headTurn = breath * IDLE_HEAD_TURN;
  pose.leftHand = pt(pose.leftHand.x + carried - breath * BREATH_ARM_DRIFT, pose.leftHand.y);
  pose.rightHand = pt(pose.rightHand.x + carried + breath * BREATH_ARM_DRIFT, pose.rightHand.y);
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

export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: HoarderView;
  readonly pose: (frame: number) => HoarderPose;
}

export const HOARDER_ROWS: readonly RowSpec[] = [
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
    name: 'walk_back',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), true),
  },
  {
    name: 'vomit',
    frameCount: VOMIT_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => vomitFacing(shotProgress(f, VOMIT_FRAMES), false),
  },
  {
    name: 'vomit_side',
    frameCount: VOMIT_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => vomitSide(shotProgress(f, VOMIT_FRAMES)),
  },
  {
    name: 'vomit_back',
    frameCount: VOMIT_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: (f) => vomitFacing(shotProgress(f, VOMIT_FRAMES), true),
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
    name: 'idle_back',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES)),
  },
];

// ── Gore placement ───────────────────────────────────────────────────────────

/**
 * How far each gore piece is nudged so that its ink, not its authoring origin,
 * sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own visible
 * pixels, so a piece drawn off-centre in its cell orbits rather than tumbles.
 * The offsets are in the piece's own units, the same ones its `paint` is scaled
 * by, and they were measured from the painted ink of each piece. Measuring is
 * something only an offline pass can do, so the numbers are frozen here and
 * `scripts/gates-hoarder.ts` re-measures them on every render.
 */
export const GORE_RECENTRE: ReadonlyMap<string, Pt> = new Map([
  ['gore_head', pt(0.03125, -0.03125)],
  ['gore_right_arm', pt(0.020833333333333332, 0.020833333333333332)],
  ['gore_left_arm', pt(0.203125, 0.09375)],
  ['gore_left_leg', pt(0.3125, 0.2604166666666667)],
  ['gore_right_leg', pt(0.28125, 0.041666666666666664)],
  ['gore_torso', pt(-0.03125, 0.11979166666666667)],
]);

function goreRecentreOf(state: string): Pt {
  const offset = GORE_RECENTRE.get(state);
  if (offset === undefined) throw new Error(`no gore recentring offset for "${state}"`);
  return offset;
}

function gorePieceOf(state: string): GorePiece {
  const piece = GORE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for "${state}"`);
  return piece;
}

function poseRowOf(state: string): RowSpec | undefined {
  return HOARDER_ROWS.find((row) => row.name === state);
}

/**
 * Paints one cell of the Hoarder, in the cell's own pixels.
 *
 * A pose row is anchored at the ground line under the cell's centre, which is
 * what ties the art to the tile she stands on. A gore piece is anchored at the
 * cell's centre instead, because the only thing that reads its cell is the spin
 * the gore field applies about that point.
 */
function paintHoarderFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = poseRowOf(state);
  if (row === undefined) {
    const piece = gorePieceOf(state);
    const recentre = goreRecentreOf(state);
    ctx.save();
    ctx.translate(
      FRAME_WIDTH / 2 + recentre.x * GORE_UNIT,
      FRAME_HEIGHT / 2 + recentre.y * GORE_UNIT,
    );
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(ctx);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(POSE_ORIGIN_X, POSE_ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  // Scaled about the ground line, which is the origin of figure space, so a
  // creature this much taller than a tile still stands on the tile her feet
  // belong to.
  ctx.scale(HOARDER_SCALE, HOARDER_SCALE);
  drawHoarderView(ctx, row.view, row.pose(frame));
  ctx.restore();
}

/** Every state the figure declares, pose rows first and then the gore pieces. */
function hoarderStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of HOARDER_ROWS) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

export const HOARDER_FIGURE: FigureDef = {
  id: 'hoarder',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(hoarderStateFrames()),
  paintFrame: paintHoarderFrame,
};
