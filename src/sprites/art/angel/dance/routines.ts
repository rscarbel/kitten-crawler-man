/**
 * Angel's four routines, each a function from a frame to a pose.
 *
 * Every routine opens and closes on the home pose — beside the pole, facing
 * the room, left hand on the pole, right hand on her hip — so any routine can
 * follow any other and the chain never visibly restarts. Each is four
 * sixteen-frame phrases at {@link ANGEL_FRAMES_PER_BEAT} frames a beat.
 *
 * Her left hand is the one on the pole whenever only one is, so she always
 * circles it with the pole on her left: counter-clockwise on screen.
 */

import { easeInOut, lerp } from '../../bipedArt';
import { HEAD_CENTER_Y, HIP_Y } from '../proportions';
import { smoothstep, v3, type ArmAngles, type BodySide, type V3 } from '../skeleton';
import { ANGEL_FRAMES_PER_BEAT, ANGEL_PHRASE_FRAMES } from './tempo';
import {
  FACING_CAMERA,
  STILL,
  blendPose,
  type ArmPose,
  type DancePose,
  type SectionPose,
  type StageFoot,
  type WeightedArm,
} from './pose';

const DEGREES = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const LEFT = -1 as const satisfies BodySide;
const RIGHT = 1 as const satisfies BodySide;

const ROUTINE_PHRASES = 4;
export const ROUTINE_FRAMES = ROUTINE_PHRASES * ANGEL_PHRASE_FRAMES;
const BEAT = ANGEL_FRAMES_PER_BEAT;
const PHRASE = ANGEL_PHRASE_FRAMES;

/* ── Shared pieces ─────────────────────────────────────────────────────── */

/** 0 before `start`, 1 after `end`, eased between. */
function progress(frame: number, start: number, end: number): number {
  return smoothstep((frame - start) / (end - start));
}

/** A foot's place in her own frame: across (her right +), forward, and how it stands. */
interface LocalFoot {
  readonly x: number;
  readonly z: number;
  readonly lift: number;
  readonly pitch: number;
  readonly onBall: boolean;
}

function flatFoot(x: number, z: number): LocalFoot {
  return { x, z, lift: 0, pitch: 0, onBall: false };
}

function lerpFoot(a: LocalFoot, b: LocalFoot, t: number): LocalFoot {
  const k = Math.min(1, Math.max(0, t));
  return {
    x: lerp(a.x, b.x, k),
    z: lerp(a.z, b.z, k),
    lift: lerp(a.lift, b.lift, k),
    pitch: lerp(a.pitch, b.pitch, k),
    onBall: k < HALF ? a.onBall : b.onBall,
  };
}

const HALF = 0.5;

function toesFoot(x: number, z: number, pitch: number): LocalFoot {
  return { x, z, lift: 0, pitch, onBall: true };
}

/** A foot placed in her frame at `heading`, carried onto the stage. */
function onStage(root: { x: number; z: number }, heading: number, foot: LocalFoot): StageFoot {
  const right = { x: -Math.cos(heading), z: Math.sin(heading) };
  const forward = { x: Math.sin(heading), z: Math.cos(heading) };
  return {
    x: root.x + foot.x * right.x + foot.z * forward.x,
    z: root.z + foot.x * right.z + foot.z * forward.z,
    lift: foot.lift,
    pitch: foot.pitch,
    onBall: foot.onBall,
  };
}

function feetOnStage(
  root: { x: number; z: number },
  heading: number,
  left: LocalFoot,
  right: LocalFoot,
): Record<BodySide, StageFoot> {
  return { [-1]: onStage(root, heading, left), [1]: onStage(root, heading, right) };
}

function only(pose: ArmPose): readonly WeightedArm[] {
  return [{ pose, weight: 1 }];
}

function section(partial: Partial<SectionPose>): SectionPose {
  return { ...STILL, ...partial };
}

/** The elbow of a hand on the pole at shoulder height hangs down and out. */
const ELBOW_DOWN_AND_OUT = v3(0.12, 0.14, -0.06);
/** Overhead on the pole, the elbows open out to her sides. */
const ELBOW_OUT_HIGH = v3(0.2, -0.04, 0.02);
/** Reaching back overhead to a pole behind her, the elbows point up and forward. */
const ELBOW_FORWARD_HIGH = v3(0.06, -0.2, 0.12);

function onPole(height: number, elbow: V3 = ELBOW_DOWN_AND_OUT): ArmPose {
  return { kind: 'pole', height, elbow };
}

/** A hand resting on her right hip, fingers down over the thong's band; mirrored for her left. */
const HAND_ON_HIP: ArmPose = {
  kind: 'rest',
  section: 'pelvis',
  at: v3(0.104, HIP_Y - 0.012, 0.012),
  handDirection: v3(-0.35, 0.9, 0.25),
  elbow: v3(0.22, 0.02, -0.1),
  open: 0.3,
};

/** The hand trailed down the outside of the thigh. */
const HAND_DOWN_THIGH: ArmPose = {
  kind: 'rest',
  section: 'pelvis',
  at: v3(0.1, HIP_Y + 0.14, 0.0),
  handDirection: v3(-0.1, 1, 0.1),
  elbow: v3(0.16, 0, -0.12),
  open: 0.6,
};

/** The hand drawn up behind her head, through her hair. */
const HAND_IN_HAIR: ArmPose = {
  kind: 'rest',
  section: 'head',
  at: v3(0.04, HEAD_CENTER_Y - 0.06, -0.035),
  handDirection: v3(-0.6, -0.4, -0.2),
  // The elbow lifts above her head line, so the forearm rises to the hand
  // rather than lying across her face.
  elbow: v3(0.2, -0.26, 0),
  open: 0.5,
};

/** The free arm held out to her side, wrist soft: the line a dancer travels with. */
const ARM_OUT_GRACEFUL: ArmAngles = {
  abduction: 32 * DEGREES,
  flex: 14 * DEGREES,
  elbowFlex: 22 * DEGREES,
  carry: 6 * DEGREES,
  wristFlex: -12 * DEGREES,
  open: 0.7,
};

/* ── Home ──────────────────────────────────────────────────────────────── */

/** How far west of the pole she stands at home: an arm's comfortable bend from it. */
const HOME_DISTANCE = 0.24;
const HOME_ROOT = { x: -HOME_DISTANCE, z: 0 };
const HOME_GRIP_HEIGHT = 0.9;
/** Her weight is on her left leg, by the pole; the right is the free leg, on its toes. */
const HOME_LEFT_FOOT = flatFoot(-0.03, -0.035);
const HOME_RIGHT_FOOT = toesFoot(0.072, 0.02, -28 * DEGREES);
const HOME_HIP_SHIFT = -0.02;
const HOME_HIP_ROLL = 6 * DEGREES;
const HOME_CHEST_ROLL = -3 * DEGREES;
const HOME_FREE_KNEE_IN = -0.4;
const HOME_HEAD_ROLL = -4 * DEGREES;

export const HOME_POSE: DancePose = {
  root: HOME_ROOT,
  heading: FACING_CAMERA,
  pelvis: section({ x: HOME_HIP_SHIFT, roll: HOME_HIP_ROLL }),
  chest: section({ roll: HOME_CHEST_ROLL }),
  feet: feetOnStage(HOME_ROOT, FACING_CAMERA, HOME_LEFT_FOOT, HOME_RIGHT_FOOT),
  kneeSplay: { [-1]: 0, [1]: HOME_FREE_KNEE_IN },
  arms: { [-1]: only(onPole(HOME_GRIP_HEIGHT)), [1]: only(HAND_ON_HIP) },
  headRoll: HOME_HEAD_ROLL,
  headPitch: 0,
  lookBack: 0,
  hairSway: 0,
  hairLift: 0,
  hairTrail: 0,
  hairSwing: 0,
};

function withArms(
  pose: DancePose,
  left: readonly WeightedArm[],
  right: readonly WeightedArm[],
): DancePose {
  return { ...pose, arms: { [-1]: left, [1]: right } };
}

function blendArmPoses(a: ArmPose, b: ArmPose, t: number): readonly WeightedArm[] {
  if (t <= 0) return only(a);
  if (t >= 1) return only(b);
  return [
    { pose: a, weight: 1 - t },
    { pose: b, weight: t },
  ];
}

/* ── Stepping ──────────────────────────────────────────────────────────── */

/** A step's foot rises this high at mid-swing. */
const STEP_LIFT = 0.032;
/** The toe leaves the floor pointed and comes down nearly flat. */
const STEP_TOE_OFF_PITCH = -34 * DEGREES;
const STEP_LANDING_PITCH = -6 * DEGREES;

/** One foot in mid-step: `t` 0 at lift-off to 1 at landing. */
function swingFoot(from: StageFoot, to: StageFoot, t: number): StageFoot {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const along = easeInOut(t);
  return {
    x: lerp(from.x, to.x, along),
    z: lerp(from.z, to.z, along),
    lift: STEP_LIFT * Math.sin(Math.PI * t),
    pitch: lerp(STEP_TOE_OFF_PITCH, STEP_LANDING_PITCH, t),
    onBall: false,
  };
}

/**
 * Both steps of a travel land by this share of it, so her feet are down and
 * still while her body settles into where it is going.
 */
const STEPS_LAND_BY = 0.85;

/**
 * Two steps from one pose to another: her lead foot steps first, then the
 * other, while her body travels and turns between them.
 */
function travel(
  frame: number,
  start: number,
  end: number,
  from: DancePose,
  to: DancePose,
  lead: BodySide,
): DancePose {
  const t = (frame - start) / (end - start);
  const body = blendPose(from, to, progress(frame, start, end));
  const stepShare = STEPS_LAND_BY / 2;
  const firstHalf = Math.min(1, Math.max(0, t / stepShare));
  const secondHalf = Math.min(1, Math.max(0, (t - stepShare) / stepShare));
  const stepOf = (side: BodySide): StageFoot =>
    swingFoot(from.feet[side], to.feet[side], side === lead ? firstHalf : secondHalf);
  return { ...body, feet: { [-1]: stepOf(LEFT), [1]: stepOf(RIGHT) } };
}

/* ── Routine 1: hip rolls ──────────────────────────────────────────────── */

/**
 * A slow figure eight of the hips beside the pole: they sway across and turn
 * through the eight, tilting over each standing leg, and never push toward the
 * room. Two phrases, one eight a phrase.
 */
const HIP_ROLL_PHRASES = 2;
export const HIP_ROLL_FRAMES = HIP_ROLL_PHRASES * PHRASE;
const ROLL_ACROSS = 0.075;
const ROLL_HIP_TILT = 14 * DEGREES;
const ROLL_HIP_TURN = 14 * DEGREES;
const ROLL_CHEST_COUNTER = 0.25;
/** She sinks a little into the roll, so both knees soften. */
const ROLL_SINK = 0.022;
const ROLL_STANCE_LEFT = flatFoot(-0.045, -0.03);
const ROLL_STANCE_RIGHT = toesFoot(0.05, 0.0, -14 * DEGREES);
/** The roll grows out of her home pose and settles back into it over this many frames at each end. */
const ROLL_ENVELOPE_FRAMES = 6;
/** Her right hand climbs from her hip into her hair over the second eight, and comes back down. */
const HAND_UP_START = PHRASE - BEAT / 2;
const HAND_UP_END = PHRASE + BEAT / 2;
const HAND_DOWN_START = HIP_ROLL_FRAMES - BEAT;

/** Figure-eight hip rolls at the pole, opening from and closing on the home pose. */
export function hipRoll(frame: number): DancePose {
  const phase = (TWO_PI * frame) / PHRASE;
  const opening = progress(frame, 0, ROLL_ENVELOPE_FRAMES);
  const closing = progress(frame, HIP_ROLL_FRAMES - ROLL_ENVELOPE_FRAMES, HIP_ROLL_FRAMES);
  const envelope = opening * (1 - closing);
  const across = Math.sin(phase) * envelope;
  const rolling: DancePose = {
    ...HOME_POSE,
    feet: feetOnStage(HOME_ROOT, FACING_CAMERA, ROLL_STANCE_LEFT, ROLL_STANCE_RIGHT),
    kneeSplay: { [-1]: 0, [1]: 0 },
    pelvis: section({
      x: ROLL_ACROSS * across,
      y: ROLL_SINK * envelope,
      roll: -ROLL_HIP_TILT * across,
      yaw: ROLL_HIP_TURN * Math.cos(phase) * envelope,
    }),
    chest: section({
      x: -ROLL_ACROSS * across * ROLL_CHEST_COUNTER,
      roll: ROLL_HIP_TILT * across * ROLL_CHEST_COUNTER,
    }),
    headRoll: HOME_HEAD_ROLL + ROLL_HIP_TILT * across * ROLL_CHEST_COUNTER,
    hairSway: -ROLL_ACROSS * across,
  };
  const body = blendPose(HOME_POSE, rolling, Math.min(opening, 1 - closing));
  const handUp = progress(frame, HAND_UP_START, HAND_UP_END);
  const handDown = progress(frame, HAND_DOWN_START, HIP_ROLL_FRAMES);
  const rightHand =
    handDown > 0
      ? blendArmPoses(HAND_IN_HAIR, HAND_ON_HIP, handDown)
      : blendArmPoses(HAND_ON_HIP, HAND_IN_HAIR, handUp);
  return withArms(body, only(onPole(HOME_GRIP_HEIGHT)), rightHand);
}

const ROUTINE_END = ROUTINE_FRAMES;

/* ── Routine 2: the walk round the pole ────────────────────────────────── */

/** She circles at her home distance, the pole on her left, a step a beat. */
const WALK_RADIUS = HOME_DISTANCE;
const WALK_STEPS = 8;
/** Her feet land almost on one line, crossing a little: a catwalk step. */
const WALK_FOOT_LINE = 0.01;
/** A step's foot is in the air for this share of its beat; both feet are down for the rest. */
const WALK_SWING_SHARE = 0.75;
const WALK_HIP_SWAY = 0.024;
const WALK_HIP_TILT = 7 * DEGREES;
const WALK_CHEST_TILT = 3 * DEGREES;
const WALK_GRIP_HEIGHT = HOME_GRIP_HEIGHT;
/** Her hips lead the turn round the pole a little, her shoulders open to the room. */
const WALK_HIP_TWIST = 6 * DEGREES;
const WALK_ENTRY_FRAMES = BEAT / 2;
/** The free arm swings a little with each step, against the hips. */
const WALK_ARM_SWAY = 12 * DEGREES;
const WALK_LEAD = 0.1;

/** Where on the circle she is at `heading`, with the pole on her left. */
function walkRoot(heading: number, radius: number): { x: number; z: number } {
  return { x: -radius * Math.cos(heading), z: radius * Math.sin(heading) };
}

/** A foot's plant on the circle, `heading` round it: the left foot inside, the right outside. */
function walkPlant(side: BodySide, heading: number): StageFoot {
  const radius = WALK_RADIUS + side * WALK_FOOT_LINE;
  const at = walkRoot(heading, radius);
  return { x: at.x, z: at.z, lift: 0, pitch: 0, onBall: false };
}

/** Heel strikes land a half step ahead of her body and lift off a half step behind it. */
/**
 * How far round the pole she is on a frame of the walk. She sets off and
 * arrives at half her mid-circle pace, so the foot she stands on at home is
 * never left more than half a step behind her while the other steps out.
 */
const WALK_EASE = 0.5;

function walkHeading(frame: number): number {
  const t = frame / ROUTINE_FRAMES;
  return TWO_PI * t - WALK_EASE * Math.sin(TWO_PI * t);
}

function walkFoot(side: BodySide, frame: number): StageFoot {
  // The left foot swings on even beats, the right on odd ones.
  const firstSwing = side === LEFT ? 0 : 1;
  const beat = Math.floor(frame / BEAT);
  const within = (frame - beat * BEAT) / BEAT;
  const swinging = (beat - firstSwing) % 2 === 0 && beat >= firstSwing && beat < WALK_STEPS;
  const swingT = Math.min(1, within / WALK_SWING_SHARE);
  // A foot lands where her body will be half-way through standing on it.
  const landedAt = (b: number): number => walkHeading((b + 1 + HALF) * BEAT);
  if (swinging) {
    const from = beat < 2 ? homeFootOf(side) : walkPlant(side, landedAt(beat - 2));
    const to = beat >= WALK_STEPS - 2 ? homeFootOf(side) : walkPlant(side, landedAt(beat));
    return swingFoot(from, to, swingT);
  }
  const lastSwing = beat - ((beat - firstSwing) % 2 === 0 ? 2 : 1);
  if (lastSwing < firstSwing) return homeFootOf(side);
  if (lastSwing >= WALK_STEPS - 2) return homeFootOf(side);
  return walkPlant(side, landedAt(lastSwing));
}

function homeFootOf(side: BodySide): StageFoot {
  return HOME_POSE.feet[side];
}

/** One slow revolution round the pole, eight steps, her left hand sliding round it. */
export function poleWalk(frame: number): DancePose {
  const heading = walkHeading(frame);
  // Passing in front of or behind the pole she walks a little ahead of her
  // hand, so the pole runs along her back edge — her reaching hand showing on
  // it — rather than hidden behind the middle of her or crossing it.
  const passing = Math.abs(Math.sin(heading));
  const onCircle = walkRoot(heading, WALK_RADIUS);
  const root = {
    x: onCircle.x + Math.sin(heading) * WALK_LEAD * passing,
    z: onCircle.z + Math.cos(heading) * WALK_LEAD * passing,
  };
  const weight = Math.cos((Math.PI * (frame - BEAT / 2)) / BEAT);
  const settle =
    progress(frame, 0, WALK_ENTRY_FRAMES) *
    (1 - progress(frame, ROUTINE_FRAMES - WALK_ENTRY_FRAMES, ROUTINE_FRAMES));
  const walking: DancePose = {
    ...HOME_POSE,
    root,
    heading,
    pelvis: section({
      x: WALK_HIP_SWAY * weight,
      roll: -WALK_HIP_TILT * weight,
      yaw: WALK_HIP_TWIST,
    }),
    chest: section({ roll: WALK_CHEST_TILT * weight, yaw: -WALK_HIP_TWIST }),
    feet: { [-1]: walkFoot(LEFT, frame), [1]: walkFoot(RIGHT, frame) },
    kneeSplay: { [-1]: 0, [1]: 0 },
    arms: {
      [-1]: only(onPole(WALK_GRIP_HEIGHT)),
      [1]: blendArmPoses(
        HAND_ON_HIP,
        {
          kind: 'angles',
          angles: { ...ARM_OUT_GRACEFUL, flex: ARM_OUT_GRACEFUL.flex + WALK_ARM_SWAY * weight },
        },
        settle,
      ),
    },
    headRoll: 0,
    hairSway: -WALK_HIP_SWAY * weight,
  };
  const entry = progress(frame, 0, WALK_ENTRY_FRAMES);
  const exit = progress(frame, ROUTINE_FRAMES - WALK_ENTRY_FRAMES, ROUTINE_FRAMES);
  const atStart = blendPose({ ...HOME_POSE, feet: walking.feet }, walking, entry);
  return exit > 0
    ? blendPose(atStart, { ...HOME_POSE, feet: walking.feet, heading: TWO_PI }, exit)
    : atStart;
}

/* ── Routine 3: the swing round the pole, then the squats ──────────────── */

const SWING_WIND_END = BEAT / 2;
const SWING_LIFT_OFF = 5;
const SWING_LAND = 22;
const SWING_TAKE_OFF_FRAMES = 2;
const SWING_LEAD = 0.07;
const SWING_TURN_END = 24;
/** Out of the swing she steps round in front of the pole over most of a beat, into the first squat. */
const SWING_STEP_END = SWING_TURN_END + BEAT / 2;
/** Swinging, she hangs closer in than she walks, arms pulling her round. */
const SWING_RADIUS = 0.07;
/** She closes in on the pole over the wind-up and on into the first beat in the air, never in a lunge. */
const SWING_STEP_IN_END = SWING_LIFT_OFF + BEAT / 2;
/** The inside hand is high on the pole and carries her; the outside hand, reaching across, holds low. */
const SWING_INSIDE_GRIP = 1.02;
const SWING_OUTSIDE_GRIP = 0.83;
/** In the air her knees come up together, shins tucked under her. */
const SWING_TUCK_LIFT = 0.13;
const SWING_TUCK_PITCH = -40 * DEGREES;
const SWING_REACH_ACROSS = 0.034;
const SWING_REACH_FORWARD = 0.09;
const SWING_REACH_LIFT = 0.08;
const SWING_REACH_POINT = -60 * DEGREES;
const SWING_KNEES_OPEN = 22 * DEGREES;
const SWING_BODY_RISE = 0.05;
/** She leans out from the pole on her arms. */
const SWING_LEAN_OUT = 12 * DEGREES;
const SWING_WIND_SINK = 0.035;
const SWING_HAIR_FLING = 0.006;
/** Winding up she gathers her feet together under her, the right on its toes. */
const SWING_STANCE_LEFT = flatFoot(-0.03, -0.03);
const SWING_STANCE_RIGHT = toesFoot(0.03, 0, -18 * DEGREES);

/** Back to the pole, in front of it: her shoulder blades just clear of it. */
/** In front of the pole and a little to one side of it, so it shows beside her body. */
const SQUAT_ROOT = { x: -0.1, z: 0.075 };
const SQUAT_HIGH_GRIP = 1.12;
const SQUAT_DEPTH = 0.21;
const SQUAT_HANDS_SLIDE = 0.21;
const SQUAT_TOGETHER_LEFT = toesFoot(-0.028, -0.01, -30 * DEGREES);
const SQUAT_TOGETHER_RIGHT = toesFoot(0.028, -0.01, -30 * DEGREES);
const SQUAT_APART_LEFT = toesFoot(-0.078, 0.0, -30 * DEGREES);
const SQUAT_APART_RIGHT = toesFoot(0.078, 0.0, -30 * DEGREES);
const SQUAT_KNEES_APART = 12 * DEGREES;
const SQUAT_KNEES_ASIDE = 10 * DEGREES;
const SQUAT_HEAD_TILT = 6 * DEGREES;
const SQUAT_TOGETHER_START = SWING_STEP_END;
const SQUAT_APART_START = PHRASE * 2 + BEAT;
const SQUAT_END = PHRASE * 3 + BEAT - 2;
/** Each squat sinks over a beat and a half, holds, and rises over the rest. */
/**
 * Each squat sinks over the first share of its span, settles through the
 * next, and rises over the rest: the rise gets as long as the sink, so she
 * never shoots back up.
 */
const SQUAT_SINK_SHARE = 0.4;
const SQUAT_HOLD_SHARE = 0.2;
const SQUAT_SWAY = 0.016;
const SQUAT_OPEN_HIP_TILT = 10 * DEGREES;
const SQUAT_CHEST_COUNTER = 0.5;
const SQUAT_OPEN_ARCH = -12 * DEGREES;
/** She drops most of the way, then keeps sinking slowly through the hold, so the bottom is never a still frame. */
const SQUAT_DROP_SHARE = 0.86;

const SQUAT_STAND: DancePose = {
  ...HOME_POSE,
  root: SQUAT_ROOT,
  heading: FACING_CAMERA,
  pelvis: STILL,
  chest: STILL,
  feet: feetOnStage(SQUAT_ROOT, FACING_CAMERA, SQUAT_TOGETHER_LEFT, SQUAT_TOGETHER_RIGHT),
  kneeSplay: { [-1]: 0, [1]: 0 },
  // Squatting beside the pole, her near hand holds it overhead and the far
  // one rests on her hip: reaching across her head it would cross her face.
  arms: {
    [-1]: only(onPole(SQUAT_HIGH_GRIP, ELBOW_OUT_HIGH)),
    [1]: only(HAND_ON_HIP),
  },
  headRoll: 0,
};

function swingPose(frame: number): DancePose {
  const turnT = progress(frame, SWING_WIND_END, SWING_TURN_END);
  const heading = TWO_PI * turnT;
  // Her feet leave the floor together and come down together, each over an
  // in-between frame, so she neither pops up nor drops.
  const air =
    progress(frame, SWING_LIFT_OFF - SWING_TAKE_OFF_FRAMES, SWING_LIFT_OFF) *
    (1 - progress(frame, SWING_LAND, SWING_LAND + SWING_TAKE_OFF_FRAMES));
  const wind = progress(frame, 0, SWING_WIND_END) * (1 - air);
  // Half-way into the air she is up on her toes with her feet still down; the
  // tuck happens only once she is off them.
  const tuck = Math.max(0, air * 2 - 1);
  // Winding up she steps in to the pole, and stays in close round the swing.
  const radius = lerp(HOME_DISTANCE, SWING_RADIUS, progress(frame, 0, SWING_STEP_IN_END));
  // Swinging, her body leads the pole round, so it crosses behind her back
  // edge rather than through the middle of her.
  const lead = SWING_LEAD * air;
  const circling = walkRoot(heading, radius);
  const root = {
    x: circling.x + Math.sin(heading) * lead,
    z: circling.z + Math.cos(heading) * lead,
  };
  const tucked: LocalFoot = {
    x: 0,
    z: 0.02,
    lift: SWING_TUCK_LIFT * tuck,
    pitch: SWING_TUCK_PITCH * tuck,
    onBall: true,
  };
  // The inside knee hooks up toward the pole; the outside leg reaches out,
  // toes pointed, so the spin shows a shape rather than a hop.
  const left = { ...tucked, x: -0.026 };
  const right: LocalFoot = {
    ...tucked,
    x: SWING_REACH_ACROSS,
    z: SWING_REACH_FORWARD * tuck,
    lift: SWING_REACH_LIFT * tuck,
    pitch: SWING_REACH_POINT * tuck,
  };
  const stance = (home: LocalFoot, spin: LocalFoot, tuck: LocalFoot): LocalFoot =>
    lerpFoot(lerpFoot(home, spin, wind + air), tuck, air);
  const feet = feetOnStage(
    root,
    heading,
    stance(HOME_LEFT_FOOT, SWING_STANCE_LEFT, left),
    stance(HOME_RIGHT_FOOT, SWING_STANCE_RIGHT, right),
  );
  const gathered = Math.min(1, wind + air);
  const swinging: DancePose = {
    ...HOME_POSE,
    root,
    heading,
    pelvis: section({
      y: SWING_WIND_SINK * wind - SWING_BODY_RISE * air,
      roll: SWING_LEAN_OUT * air,
    }),
    chest: section({ roll: SWING_LEAN_OUT * air }),
    feet,
    // The tucked knees open a little in the air, so the fold of her legs
    // still shows when the swing carries her round to face away.
    kneeSplay: { [-1]: SWING_KNEES_OPEN * air, [1]: SWING_KNEES_OPEN * air },
    arms: {
      [-1]: only(onPole(SWING_INSIDE_GRIP)),
      [1]: only(onPole(SWING_OUTSIDE_GRIP, ELBOW_OUT_HIGH)),
    },
    headRoll: SWING_LEAN_OUT * air,
    hairSway: SWING_HAIR_FLING * air,
    hairLift: SWING_HAIR_FLING * air,
  };
  // Gathering for the swing she is still her home pose, easing into the swing's.
  const body = blendPose({ ...HOME_POSE, root, heading, feet }, swinging, gathered);
  return withArms(
    body,
    only(onPole(lerp(HOME_GRIP_HEIGHT, SWING_INSIDE_GRIP, gathered))),
    // Landing in front of the pole she lets go with her outside hand and brings
    // it down to her hip; held on, it would reach across behind her head.
    blendArmPoses(
      HAND_ON_HIP,
      onPole(SWING_OUTSIDE_GRIP, ELBOW_OUT_HIGH),
      gathered * (1 - progress(frame, SWING_LAND - BEAT / 2, SWING_TURN_END)),
    ),
  );
}

/** One squat in a phrase: sink, settle at the bottom, rise. */
function squatDepth(frame: number, start: number, end: number): number {
  const span = end - start;
  const bottom = start + span * SQUAT_SINK_SHARE;
  const holdEnd = bottom + span * SQUAT_HOLD_SHARE;
  const sink =
    SQUAT_DROP_SHARE * progress(frame, start, bottom) +
    (1 - SQUAT_DROP_SHARE) * Math.min(1, Math.max(0, (frame - bottom) / (holdEnd - bottom)));
  const rise = progress(frame, holdEnd, end);
  return sink * (1 - rise);
}

function squatPose(frame: number): DancePose {
  const apart = frame >= SQUAT_APART_START ? 1 : 0;
  const start = apart > 0 ? SQUAT_APART_START : SQUAT_TOGETHER_START;
  const depth = squatDepth(frame, start, apart > 0 ? SQUAT_END : SQUAT_APART_START);
  const spread = apart * progress(frame, SQUAT_APART_START, SQUAT_APART_START + BEAT / 2);
  const feet = blendPose(
    SQUAT_STAND,
    {
      ...SQUAT_STAND,
      feet: feetOnStage(SQUAT_ROOT, FACING_CAMERA, SQUAT_APART_LEFT, SQUAT_APART_RIGHT),
    },
    spread,
  ).feet;
  return {
    ...SQUAT_STAND,
    feet,
    // Her hips sway across a beat while she sinks and rises, so no part of the
    // squat is a held frame.
    // Knees apart she drops with her hips tilted to one side and her chest
    // lifted, a slide down the pole rather than a crouch.
    pelvis: section({
      y: SQUAT_DEPTH * depth,
      x: SQUAT_SWAY * Math.sin((TWO_PI * (frame - start)) / BEAT),
      roll: SQUAT_OPEN_HIP_TILT * spread * depth,
    }),
    chest: section({
      roll: -SQUAT_OPEN_HIP_TILT * spread * depth * SQUAT_CHEST_COUNTER,
      pitch: SQUAT_OPEN_ARCH * spread * depth,
    }),
    // Knees together they both swing toward her right, so the squat shows its
    // folded thighs head-on instead of hiding them end-on to the camera.
    kneeSplay: {
      [-1]: lerp(-SQUAT_KNEES_ASIDE, SQUAT_KNEES_APART, spread),
      [1]: lerp(SQUAT_KNEES_ASIDE, SQUAT_KNEES_APART, spread),
    },
    arms: {
      [-1]: only(onPole(SQUAT_HIGH_GRIP - SQUAT_HANDS_SLIDE * depth, ELBOW_OUT_HIGH)),
      [1]: only(HAND_ON_HIP),
    },
    headRoll: SQUAT_HEAD_TILT * depth * (apart > 0 ? -1 : 1),
    headPitch: -SQUAT_HEAD_TILT * depth,
  };
}

/** A swing round the pole with both feet off the floor, then squats with her back to it. */
export function swingSquat(frame: number): DancePose {
  if (frame < SWING_TURN_END) return swingPose(frame);
  if (frame < SWING_STEP_END) {
    return travel(
      frame,
      SWING_TURN_END,
      SWING_STEP_END,
      swingPose(SWING_TURN_END),
      SQUAT_STAND,
      RIGHT,
    );
  }
  if (frame < SQUAT_END) return squatPose(frame);
  const leaving = { ...squatPose(SQUAT_END - 1), pelvis: STILL, headRoll: 0, headPitch: 0 };
  return travel(frame, SQUAT_END, ROUTINE_END, leaving, HOME_POSE, LEFT);
}

/* ── Routine 4: the arch, the hair flip and the look back ──────────────── */

/**
 * She turns her back to the pole where she stands — a quarter turn to face
 * screen left — so the arch and the fold happen in profile, the view that
 * shows them; then a further quarter turn faces her away for the look back,
 * and a half turn brings her home. Every turn goes the same way round.
 */
const ARCH_HEADING = -Math.PI / 2;
const LOOK_HEADING = -Math.PI;
const HOME_AGAIN_HEADING = -TWO_PI;
/** Just west of the pole, her back a hand's depth from it. */
const ARCH_ROOT = { x: -0.09, z: 0.004 };
const ARCH_TURN_END = BEAT;
const ARCH_REACH_END = BEAT + BEAT / 2;
const ARCH_PEAK = PHRASE - 2;
const ARCH_UPPER_GRIP = 1.12;
const ARCH_LOWER_GRIP = 1.03;
const ARCH_CHEST_BACK = -32 * DEGREES;
const ARCH_HEAD_BACK = -30 * DEGREES;
const ARCH_LEFT_FOOT = flatFoot(-0.02, -0.02);
const ARCH_RIGHT_FOOT = toesFoot(0.02, 0.07, -36 * DEGREES);

const FLIP_FOLD_END = PHRASE + BEAT + 3;
const FLIP_WHIP_END = FLIP_FOLD_END + 4;
const FLIP_SETTLE_END = PHRASE * 2;
const FOLD_HIP_PITCH = 28 * DEGREES;
const FOLD_CHEST_PITCH = 48 * DEGREES;
const FOLD_KNEE_SINK = 0.03;
/** Folded over, her hair hangs to the floor: swung forward against her head's pitch. */
const FOLD_HAIR_HANG = -1.1;
/** Folded over, she keeps her chin up so her face still shows past her hair. */
const FOLD_CHIN_UP = -30 * DEGREES;
/** Whipped up, it flies back past her shoulders before it settles. */
const WHIP_HAIR_FLING = 0.9;
const WHIP_CHEST_BACK = -5 * DEGREES;

const LOOK_TURN_END = PHRASE * 2 + BEAT;
const LOOK_HOLD_END = PHRASE * 3;
/** Back toward her home spot, facing away, the pole off her right shoulder. */
const LOOK_ROOT = { x: -0.21, z: 0.02 };
const LOOK_HIP_SHIFT = 0.026;
const LOOK_HIP_TILT = -8 * DEGREES;
const LOOK_LEFT_FOOT = toesFoot(-0.05, 0.03, -24 * DEGREES);
const LOOK_RIGHT_FOOT = flatFoot(0.03, -0.03);
/** Walking home her left hand finds the pole well before she arrives. */
const RETURN_GRIP_SHARE = 0.6;

const ARCH_POSE: DancePose = {
  ...HOME_POSE,
  root: ARCH_ROOT,
  heading: ARCH_HEADING,
  pelvis: STILL,
  chest: section({ pitch: ARCH_CHEST_BACK }),
  feet: feetOnStage(ARCH_ROOT, ARCH_HEADING, ARCH_LEFT_FOOT, ARCH_RIGHT_FOOT),
  kneeSplay: { [-1]: 0, [1]: 0 },
  arms: {
    [-1]: only(onPole(ARCH_LOWER_GRIP, ELBOW_FORWARD_HIGH)),
    [1]: only(onPole(ARCH_UPPER_GRIP, ELBOW_FORWARD_HIGH)),
  },
  headRoll: 0,
  headPitch: ARCH_HEAD_BACK,
};

const ARCH_UPRIGHT: DancePose = { ...ARCH_POSE, pelvis: STILL, chest: STILL, headPitch: 0 };

/**
 * For the hair flip she turns from the arch to face the pole, a step back from
 * it, and holds it with both hands at her waist: she folds toward it from the
 * hips, her hair hanging, and whips back up still holding on.
 */
const FACE_POLE_HEADING = -Math.PI * 1.5;
const FOLD_ROOT = { x: -0.31, z: 0 };
const FOLD_LEFT_FOOT = flatFoot(-0.04, -0.02);
const FOLD_RIGHT_FOOT = flatFoot(0.04, -0.02);
const FOLD_UPPER_GRIP = 0.84;
const FOLD_LOWER_GRIP = 0.8;
/** The half turn and step back to face the pole take most of a beat, so she never slides across the stage. */
const FOLD_TURN_END = PHRASE + 6;

const FOLD_UPRIGHT: DancePose = {
  ...ARCH_UPRIGHT,
  root: FOLD_ROOT,
  heading: FACE_POLE_HEADING,
  feet: feetOnStage(FOLD_ROOT, FACE_POLE_HEADING, FOLD_LEFT_FOOT, FOLD_RIGHT_FOOT),
  arms: {
    [-1]: only(onPole(FOLD_LOWER_GRIP)),
    [1]: only(onPole(FOLD_UPPER_GRIP)),
  },
};

/** Folding, her hands slide down the pole ahead of her dropping shoulders, so her arms stay long. */
const FOLD_LOW_UPPER_GRIP = 0.58;
const FOLD_LOW_LOWER_GRIP = 0.52;

const FOLD_POSE: DancePose = {
  ...FOLD_UPRIGHT,
  arms: {
    [-1]: only(onPole(FOLD_LOW_LOWER_GRIP)),
    [1]: only(onPole(FOLD_LOW_UPPER_GRIP)),
  },
  pelvis: section({ pitch: FOLD_HIP_PITCH, y: FOLD_KNEE_SINK, z: -0.04 }),
  chest: section({ pitch: FOLD_CHEST_PITCH }),
  hairSwing: FOLD_HAIR_HANG,
  headPitch: FOLD_CHIN_UP,
};

const WHIP_POSE: DancePose = {
  ...FOLD_UPRIGHT,
  chest: section({ pitch: WHIP_CHEST_BACK }),
  headPitch: WHIP_CHEST_BACK,
  hairSwing: WHIP_HAIR_FLING,
};

const SETTLED_POSE: DancePose = FOLD_UPRIGHT;

const LOOK_POSE: DancePose = {
  ...HOME_POSE,
  root: LOOK_ROOT,
  heading: LOOK_HEADING,
  pelvis: section({ x: LOOK_HIP_SHIFT, roll: LOOK_HIP_TILT }),
  chest: section({ roll: -LOOK_HIP_TILT / 2 }),
  feet: feetOnStage(LOOK_ROOT, LOOK_HEADING, LOOK_LEFT_FOOT, LOOK_RIGHT_FOOT),
  kneeSplay: { [-1]: HOME_FREE_KNEE_IN, [1]: 0 },
  arms: { [-1]: only(HAND_ON_HIP), [1]: only(HAND_ON_HIP) },
  headRoll: 0,
  lookBack: 1,
};

function archPhrase(frame: number): DancePose {
  if (frame < ARCH_TURN_END) {
    const turned = { ...ARCH_UPRIGHT, arms: HOME_POSE.arms };
    return travel(frame, 0, ARCH_TURN_END, HOME_POSE, turned, LEFT);
  }
  const reach = progress(frame, ARCH_TURN_END, ARCH_REACH_END);
  const arched = progress(frame, ARCH_TURN_END, ARCH_PEAK);
  const leftHand = only(onPole(lerp(HOME_GRIP_HEIGHT, ARCH_LOWER_GRIP, reach), ELBOW_FORWARD_HIGH));
  const rightHand = blendArmPoses(HAND_ON_HIP, onPole(ARCH_UPPER_GRIP, ELBOW_FORWARD_HIGH), reach);
  return withArms(blendPose(ARCH_UPRIGHT, ARCH_POSE, arched), leftHand, rightHand);
}

function flipPhrase(frame: number): DancePose {
  if (frame < FOLD_TURN_END) {
    return travel(frame, ARCH_PEAK, FOLD_TURN_END, ARCH_POSE, FOLD_UPRIGHT, RIGHT);
  }
  if (frame < FLIP_FOLD_END) {
    return blendPose(FOLD_UPRIGHT, FOLD_POSE, progress(frame, FOLD_TURN_END, FLIP_FOLD_END));
  }
  if (frame < FLIP_WHIP_END) {
    const t = (frame - FLIP_FOLD_END) / (FLIP_WHIP_END - FLIP_FOLD_END);
    // The body comes up fast; the hair lags it, still hanging as the head rises.
    const body = blendPose(FOLD_POSE, WHIP_POSE, easeInOut(t));
    return { ...body, hairSwing: lerp(FOLD_HAIR_HANG, WHIP_HAIR_FLING, t * t) };
  }
  return blendPose(WHIP_POSE, SETTLED_POSE, progress(frame, FLIP_WHIP_END, FLIP_SETTLE_END));
}

function lookPhrase(frame: number): DancePose {
  if (frame < LOOK_TURN_END) {
    return travel(frame, FLIP_SETTLE_END, LOOK_TURN_END, SETTLED_POSE, LOOK_POSE, RIGHT);
  }
  const trail = progress(frame, LOOK_TURN_END, LOOK_HOLD_END);
  // Her left hand trails down the hip she looks back over, away from the pole.
  return withArms(LOOK_POSE, blendArmPoses(HAND_ON_HIP, HAND_DOWN_THIGH, trail), only(HAND_ON_HIP));
}

/** The walk home sets off the frame before the look's last, so the hand-off between them is a step. */
const HOME_WALK_START = LOOK_HOLD_END - 1;

function homePhrase(frame: number): DancePose {
  const leaving = withArms(LOOK_POSE, only(HAND_DOWN_THIGH), only(HAND_ON_HIP));
  const home = { ...HOME_POSE, heading: HOME_AGAIN_HEADING };
  const body = travel(frame, HOME_WALK_START, ROUTINE_END, leaving, home, LEFT);
  const span = ROUTINE_END - HOME_WALK_START;
  const grip = progress(frame, HOME_WALK_START, HOME_WALK_START + span * RETURN_GRIP_SHARE);
  const turnedBack = progress(frame, HOME_WALK_START, ROUTINE_END);
  return {
    ...withArms(
      body,
      blendArmPoses(HAND_DOWN_THIGH, onPole(HOME_GRIP_HEIGHT), grip),
      only(HAND_ON_HIP),
    ),
    lookBack: 1 - turnedBack,
  };
}

/** A back-arch against the pole, a hair flip, and a look back over her shoulder. */
export function archFlipLook(frame: number): DancePose {
  if (frame < ARCH_PEAK) return archPhrase(frame);
  if (frame < FLIP_SETTLE_END) return flipPhrase(frame);
  if (frame < LOOK_HOLD_END) return lookPhrase(frame);
  return homePhrase(frame);
}
