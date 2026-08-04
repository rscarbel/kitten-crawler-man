#!/usr/bin/env tsx
/**
 * Choreography and bake for Mongo's three growth-stage sprite sheets.
 *
 * The anatomy and the painting live in `scripts/mongoArt.ts`; this file is only
 * the movement plus the tiling: one pose function per animation row, sampled per
 * frame, then measured and laid out — once per stage, from one table, so the
 * juvenile, the adolescent and the adult can never drift into three different
 * animations of three different animals.
 *
 * Rows (see the `mongo_<stage>` entries in src/images/enemies/manifest.json):
 *    0–2   idle    — breathing, weight shift, head scan, tail-tip flick
 *    3–5   walk    — digitigrade toe-off, level head, counter-swaying tail
 *    6–8   bite    — neck coils into a deep S, strikes, recovers
 *    9–11  slash   — wings flare, a one-two rake with both hands
 *    12–14 pounce  — crouch, leap, two-footed sickle strike, recovery hop
 *    15    collapse — legs buckle at 0 HP (side only; he is never gored)
 *
 * Impact timings come from `src/sprites/mongoAttackTiming.ts`, which the runtime
 * imports too, so the frame the art lands a blow on is the frame the gameplay
 * charges damage for.
 *
 * This module has no write path: `npm run gen:mongo` points at the gates file,
 * which bakes into memory, measures, and only then writes.
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  GROUND_Y,
  MONGO_STAGES,
  MONGO_STAGE_ORDER,
  type ArmPose,
  type LegPose,
  type MongoPose,
  type MongoProportions,
  type MongoStage,
  clamp01,
  deg,
  drawMongoBack,
  drawMongoFront,
  drawMongoSide,
  easeInOut,
  hump,
  lerp,
  measureHead,
  ramp,
  restArm,
  restLeg,
  restPose,
  TWO_PI,
} from './mongoArt.js';
import {
  MONGO_BITE_FRAMES,
  MONGO_BITE_IMPACT_PROGRESS,
  MONGO_COLLAPSE_FRAMES,
  MONGO_POUNCE_AIRBORNE_END,
  MONGO_POUNCE_AIRBORNE_START,
  MONGO_POUNCE_FRAMES,
  MONGO_POUNCE_IMPACT_PROGRESS,
  MONGO_SLASH_FRAMES,
  MONGO_SLASH_IMPACT_PROGRESS,
} from '../src/sprites/mongoAttackTiming.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** Clear pixels kept between the furthest ink and the frame edge. */
const FRAME_PADDING = 5;
/** Frame dimensions are rounded up to this so the sheet stays tidily aligned. */
export const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;

export const WALK_FRAMES = 8;
export const IDLE_FRAMES = 8;

// ── Gait ─────────────────────────────────────────────────────────────────────

/**
 * The share of one stride a foot spends on the ground.
 *
 * Over a half — with the two feet a half-cycle apart, that overlap is what
 * guarantees at least one foot is always down. Under it he would have a flight
 * phase, which at this gait reads as a stumble rather than as a run.
 */
export const STANCE_FRACTION = 0.62;
export const CONTRALATERAL_PHASE = 0.5;

/** Stride length as a share of the leg's total reach. */
const STRIDE_SHARE = 0.62;

export function strideOf(prop: MongoProportions): number {
  return (prop.femur + prop.tibia) * STRIDE_SHARE;
}

const WALK_BOB = 0.085;
const WALK_ARCH = 0.5;
const WALK_PITCH = deg(3.2);
const WALK_FOOT_LIFT_SHARE = 0.42;
/**
 * How much of the stance the toes spend rolling up onto their tips.
 *
 * The roll starts well before toe-off rather than at the very end: it is what
 * shortens the leg through the back half of stance, and without it the stride
 * asks the hip to reach further than the thigh and shank can span.
 */
const ROLL_START = 0.35;

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

/**
 * One foot through one stride, edge-on.
 *
 * Stance is a straight line at a constant rate — that is what "the body travels
 * over a planted foot" means, and any easing on it is a skate. The swing is
 * eased, lifted, and brings the toes back down flat.
 */
function gaitFoot(phase: number, prop: MongoProportions): LegPose {
  const cycle = wrap01(phase);
  const stride = strideOf(prop);
  const lift = prop.metatarsus * WALK_FOOT_LIFT_SHARE;
  if (cycle < STANCE_FRACTION) {
    const t = cycle / STANCE_FRACTION;
    return {
      toeX: stride * (0.5 - t),
      lift: 0,
      meta: lerp(REST_META_WALK, TOE_OFF_META, easeInOut(ramp(t, ROLL_START, 1))),
      roll: easeInOut(ramp(t, ROLL_START, 1)),
      sickle: 0,
      lateral: 0,
      nearness: 0.35,
    };
  }
  const t = (cycle - STANCE_FRACTION) / (1 - STANCE_FRACTION);
  return {
    toeX: lerp(-stride * 0.5, stride * 0.5, easeInOut(t)),
    lift: hump(t) * lift,
    meta: lerp(TOE_OFF_META, REST_META_WALK, easeInOut(t)),
    roll: (1 - easeInOut(ramp(t, 0, SWING_UNROLL))) * SWING_ROLL_CARRY,
    sickle: 0,
    lateral: 0,
    nearness: clamp01(hump(t) + WALK_NEARNESS_FLOOR),
  };
}

const REST_META_WALK = deg(66);
const TOE_OFF_META = deg(52);
const SWING_UNROLL = 0.4;
const SWING_ROLL_CARRY = 0.85;
const WALK_NEARNESS_FLOOR = 0.25;

/**
 * The same foot head-on, where a step is almost pure lift: the stride is
 * foreshortened to nothing and what the viewer sees is the leg rising, tracking
 * slightly inward under the chest, and planting again.
 */
function axialStep(phase: number, side: number, prop: MongoProportions): LegPose {
  const cycle = wrap01(phase);
  const lift = prop.metatarsus * WALK_FOOT_LIFT_SHARE;
  if (cycle < STANCE_FRACTION) {
    const t = cycle / STANCE_FRACTION;
    return {
      toeX: 0,
      lift: 0,
      meta: lerp(REST_META_WALK, TOE_OFF_META, easeInOut(ramp(t, ROLL_START, 1))),
      roll: easeInOut(ramp(t, ROLL_START, 1)),
      sickle: 0,
      lateral: side * AXIAL_STANCE_SPLAY * prop.girth,
      nearness: 0.3,
    };
  }
  const t = (cycle - STANCE_FRACTION) / (1 - STANCE_FRACTION);
  const swing = hump(t);
  return {
    toeX: 0,
    lift: swing * lift * AXIAL_LIFT_SHARE,
    meta: lerp(TOE_OFF_META, REST_META_WALK, easeInOut(t)),
    roll: (1 - easeInOut(ramp(t, 0, SWING_UNROLL))) * SWING_ROLL_CARRY,
    sickle: 0,
    lateral: side * lerp(AXIAL_STANCE_SPLAY, AXIAL_SWING_TRACK_IN, swing) * prop.girth,
    nearness: clamp01(swing + WALK_NEARNESS_FLOOR),
  };
}

const AXIAL_STANCE_SPLAY = 0.34;
const AXIAL_SWING_TRACK_IN = 0.08;
const AXIAL_LIFT_SHARE = 1.25;

// ── Head stabilisation ───────────────────────────────────────────────────────

/**
 * The head height a stage holds at rest, which walk and idle both stabilise to.
 */
function restHeadY(prop: MongoProportions): number {
  return measureHead(restPose(), prop).y;
}

/**
 * Rewrites a pose so its head sits exactly where the rest pose's does.
 *
 * `headLift` shifts the head by exactly its own value, so one measurement and
 * one subtraction is an exact solve rather than a tuned approximation.
 */
function levelHead(pose: MongoPose, prop: MongoProportions): MongoPose {
  const measured = measureHead({ ...pose, headLift: 0 }, prop);
  return { ...pose, headLift: (restHeadY(prop) - measured.y) * HEAD_STABILISE_SHARE };
}

/**
 * How much of the body's bob the neck absorbs.
 *
 * Not all of it. A head pinned to a constant height across every frame is
 * technically what avian head stabilisation does and reads on screen as a skull
 * glued in mid-air while the body slides under it — the reviewer measured the
 * eye travelling 0.07 px across a whole stride. The residual quarter is the
 * pigeon's own hold-and-thrust, and it is what makes the walk look alive.
 */
const HEAD_STABILISE_SHARE = 0.74;

/**
 * Head-on the neck top is placed straight off the shoulders, so cancelling the
 * body's own rise is all the stabilisation there is to do.
 */
function levelHeadAxial(pose: MongoPose): MongoPose {
  return { ...pose, headLift: -pose.rise * HEAD_STABILISE_SHARE };
}

// ── Blink ────────────────────────────────────────────────────────────────────

/**
 * How much of the cycle a blink occupies.
 *
 * Wider than it looks like it needs to be, because a row samples its own
 * oscillations: at eight frames the phase steps in eighths, so a blink narrower
 * than 0.125 falls between two samples and is simply never drawn. This spans
 * one to two frames, which is what a blink is.
 */
const BLINK_HOLD = 0.16;

/** A blink centred on `at`, expressed in cycle phase. */
function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 0.5 + 1) % 1) - 0.5);
  return distance < BLINK_HOLD ? clamp01(distance / BLINK_HOLD) : 1;
}

// ── Idle ─────────────────────────────────────────────────────────────────────

const IDLE_BOB = 0.07;
const IDLE_ARCH = 0.16;
const IDLE_ARCH_SWING = 0.34;
const IDLE_TAIL_SWING = deg(9);
const IDLE_TAIL_FLICK = 0.1;
const IDLE_HEAD_SCAN = deg(9);
const IDLE_TAIL_SWAY = deg(7);
const IDLE_HEAD_TURN = 0.4;
const REST_TAIL_LIFT = deg(-6);

function idleBase(phase: number, prop: MongoProportions): MongoPose {
  const angle = phase * TWO_PI;
  const rest = restPose();
  return {
    ...rest,
    rise: IDLE_BOB * Math.sin(angle),
    breathe: Math.sin(angle),
    arch: IDLE_ARCH + IDLE_ARCH_SWING * Math.sin(angle),
    headTilt: IDLE_HEAD_SCAN * Math.sin(angle * IDLE_SCAN_CYCLES),
    eyeOpen: blink(phase, IDLE_BLINK_AT),
    tailLift: REST_TAIL_LIFT + IDLE_TAIL_SWING * Math.sin(angle),
    tailCurve: IDLE_TAIL_FLICK * Math.sin(angle * IDLE_FLICK_CYCLES),
    nearArm: { ...restArm(), upper: restArm().upper + IDLE_ARM_SWING * Math.sin(angle) },
    farArm: { ...restArm(), upper: restArm().upper - IDLE_ARM_SWING * Math.sin(angle) },
    nearLeg: { ...restLeg(REST_NEAR_TOE * prop.femur), nearness: 0.75 },
    farLeg: { ...restLeg(REST_FAR_TOE * prop.femur), nearness: 0.3 },
    time: phase,
  };
}

/**
 * Whole cycles of head scan per idle loop.
 *
 * An integer, and it has to be: a half-cycle closes in *value* at the seam but
 * not in slope, so the head arrives at the end of the loop still moving and
 * snaps back on the wrap. That shows up as a loop-closure gate failure and, in
 * play, as a twitch once per idle.
 */
const IDLE_SCAN_CYCLES = 1;
const IDLE_FLICK_CYCLES = 2;
const IDLE_BLINK_AT = 0.55;
const IDLE_ARM_SWING = deg(5);
/** Rest toe placement, as a share of the femur, so the stagger scales with him. */
const REST_NEAR_TOE = 0.17;
const REST_FAR_TOE = -0.24;

function idleSide(frame: number, prop: MongoProportions): MongoPose {
  return levelHead(idleBase(cyclePhase(frame, IDLE_FRAMES), prop), prop);
}

function idleFront(frame: number, prop: MongoProportions): MongoPose {
  const phase = cyclePhase(frame, IDLE_FRAMES);
  const angle = phase * TWO_PI;
  return levelHeadAxial({
    ...idleBase(phase, prop),
    headTurn: IDLE_HEAD_TURN * Math.sin(angle * IDLE_SCAN_CYCLES),
    tailSway: IDLE_TAIL_SWAY * Math.sin(angle),
    sway: IDLE_SWAY * Math.sin(angle),
  });
}

function idleBack(frame: number, prop: MongoProportions): MongoPose {
  const phase = cyclePhase(frame, IDLE_FRAMES);
  const angle = phase * TWO_PI;
  return levelHeadAxial({
    ...idleBase(phase, prop),
    headTurn: -IDLE_HEAD_TURN * Math.sin(angle * IDLE_SCAN_CYCLES),
    tailSway: -IDLE_TAIL_SWAY * Math.sin(angle),
    sway: -IDLE_SWAY * Math.sin(angle),
  });
}

const IDLE_SWAY = 0.006;

// ── Walk ─────────────────────────────────────────────────────────────────────

const WALK_ARM_SWING = deg(9);
const WALK_ARM_SPREAD = 0.08;
const WALK_TAIL_SWING = deg(9);
const WALK_TAIL_SWAY = deg(11);
const WALK_SWAY = 0.014;
const WALK_HEAD_TURN = 0.12;

function walkBase(phase: number, prop: MongoProportions): MongoPose {
  const angle = phase * TWO_PI;
  const rest = restPose();
  return {
    ...rest,
    // Two bobs per stride, and the pelvis drops *at contact* rather than rising
    // there. That is what a real pelvis does, and it is also load-bearing: the
    // legs are at their widest spread the moment both feet are down, and a hip
    // that rises then asks for more reach than the leg has.
    rise: WALK_BOB * Math.cos(angle * 2),
    arch: WALK_ARCH * Math.sin(angle * 2),
    pitch: WALK_PITCH * Math.sin(angle * 2),
    breathe: Math.sin(angle * 2),
    eyeOpen: blink(phase, WALK_BLINK_AT),
    // The tail swings as one rod, in counterphase to the hips. It does not whip:
    // a dromaeosaur tail is rod-straightened by ossified tendons.
    tailLift: REST_TAIL_LIFT + WALK_TAIL_SWING * Math.sin(angle + Math.PI),
    tailCurve: WALK_TAIL_CURVE * Math.sin(angle),
    nearArm: walkArm(angle, 1),
    farArm: walkArm(angle, -1),
    nearLeg: gaitFoot(phase, prop),
    farLeg: gaitFoot(phase + CONTRALATERAL_PHASE, prop),
    time: phase,
  };
}

const WALK_BLINK_AT = 0.4;
const WALK_TAIL_CURVE = 0.03;

function walkArm(angle: number, side: number): ArmPose {
  const rest = restArm();
  return {
    upper: rest.upper + side * WALK_ARM_SWING * Math.sin(angle),
    fore: rest.fore - side * WALK_ARM_SWING * Math.sin(angle) * WALK_FOREARM_SHARE,
    spread: WALK_ARM_SPREAD,
    lateral: 0,
  };
}

const WALK_FOREARM_SHARE = 0.5;

function walkSide(frame: number, prop: MongoProportions): MongoPose {
  return levelHead(walkBase(cyclePhase(frame, WALK_FRAMES), prop), prop);
}

function walkFront(frame: number, prop: MongoProportions): MongoPose {
  const phase = cyclePhase(frame, WALK_FRAMES);
  const angle = phase * TWO_PI;
  return levelHeadAxial({
    ...walkBase(phase, prop),
    sway: WALK_SWAY * Math.sin(angle),
    headTurn: WALK_HEAD_TURN * Math.sin(angle),
    tailSway: WALK_TAIL_SWAY * Math.sin(angle + Math.PI),
    nearLeg: axialStep(phase, 1, prop),
    farLeg: axialStep(phase + CONTRALATERAL_PHASE, -1, prop),
  });
}

function walkBack(frame: number, prop: MongoProportions): MongoPose {
  const phase = cyclePhase(frame, WALK_FRAMES);
  const angle = phase * TWO_PI;
  return levelHeadAxial({
    ...walkBase(phase, prop),
    sway: -WALK_SWAY * Math.sin(angle),
    headTurn: -WALK_HEAD_TURN * Math.sin(angle),
    tailSway: -WALK_TAIL_SWAY * Math.sin(angle + Math.PI),
    nearLeg: axialStep(phase, 1, prop),
    farLeg: axialStep(phase + CONTRALATERAL_PHASE, -1, prop),
  });
}

// ── Bite ─────────────────────────────────────────────────────────────────────

/** How far past the snap the head keeps driving before it recovers. */
const BITE_DRIVE_TAIL = 0.05;
const BITE_COIL_END = 0.34;
const BITE_STRIKE_END = MONGO_BITE_IMPACT_PROGRESS + BITE_DRIVE_TAIL;
const BITE_NECK_COIL = deg(26);
const BITE_NECK_DRIVE = deg(-11);
const BITE_SURGE = 0.09;
const BITE_REAR_STEP = 0.06;
const BITE_HEAD_COIL = deg(-12);
const BITE_HEAD_DRIVE = deg(9);
const BITE_TAIL_COIL = deg(15);
const BITE_TAIL_DRIVE = deg(-11);
const BITE_RISE_COIL = -0.011;
const BITE_RISE_DRIVE = 0.013;
const BITE_PITCH_COIL = deg(-4);
const BITE_PITCH_DRIVE = deg(5);

interface StrikePhases {
  readonly coil: number;
  readonly drive: number;
  readonly recover: number;
}

function strikePhases(progress: number, coilEnd: number, strikeEnd: number): StrikePhases {
  const coil = easeInOut(ramp(progress, 0, coilEnd));
  const strike = easeInOut(ramp(progress, coilEnd, strikeEnd));
  const recover = easeInOut(ramp(progress, strikeEnd, 1));
  return { coil, drive: strike * (1 - recover), recover };
}

function biteBase(progress: number, prop: MongoProportions): MongoPose {
  const p = strikePhases(progress, BITE_COIL_END, BITE_STRIKE_END);
  const rest = restPose();
  return {
    ...rest,
    surge: BITE_SURGE * p.drive,
    rise: BITE_RISE_COIL * p.coil + BITE_RISE_DRIVE * p.drive,
    pitch: BITE_PITCH_COIL * p.coil + BITE_PITCH_DRIVE * p.drive,
    arch: lerp(IDLE_ARCH, -BITE_FLATTEN, p.drive),
    neckCurl: BITE_NECK_COIL * p.coil + BITE_NECK_DRIVE * p.drive,
    neckReach: p.drive,
    headTilt: BITE_HEAD_COIL * p.coil + BITE_HEAD_DRIVE * p.drive,
    // The jaws open on the coil, hold wide across the lunge, and snap shut on
    // the impact frame — the snap is the frame that reads as damage.
    gape:
      easeInOut(ramp(progress, BITE_GAPE_OPEN, BITE_GAPE_WIDE)) *
      (1 -
        easeInOut(
          ramp(progress, MONGO_BITE_IMPACT_PROGRESS - BITE_SNAP_LEAD, MONGO_BITE_IMPACT_PROGRESS),
        )),
    eyeOpen: lerp(1, BITE_SQUINT, p.coil),
    tailLift: REST_TAIL_LIFT + BITE_TAIL_COIL * p.coil + BITE_TAIL_DRIVE * p.drive,
    breathe: p.drive,
    nearArm: { ...restArm(), spread: BITE_ARM_SPREAD * p.drive },
    farArm: { ...restArm(), spread: BITE_ARM_SPREAD * p.drive },
    nearLeg: { ...restLeg(REST_NEAR_TOE * prop.femur + BITE_SURGE * p.drive), nearness: 0.75 },
    farLeg: { ...restLeg(REST_FAR_TOE * prop.femur + BITE_REAR_STEP * p.drive), nearness: 0.3 },
    time: progress,
  };
}

const BITE_FLATTEN = 0.55;
const BITE_GAPE_OPEN = 0.02;
/** The jaws are fully open by here and stay open until the snap. */
const BITE_GAPE_WIDE = 0.2;
const BITE_SNAP_LEAD = 0.07;
const BITE_SQUINT = 0.6;
const BITE_ARM_SPREAD = 0.3;

function biteSide(frame: number, prop: MongoProportions): MongoPose {
  return biteBase(shotProgress(frame, MONGO_BITE_FRAMES), prop);
}

function biteFront(frame: number, prop: MongoProportions): MongoPose {
  const progress = shotProgress(frame, MONGO_BITE_FRAMES);
  const p = strikePhases(progress, BITE_COIL_END, BITE_STRIKE_END);
  const base = biteBase(progress, prop);
  return {
    ...base,
    // Head-on there is no forward reach to show, so the lunge is sold by the
    // head dropping toward the camera and the jaws filling the frame instead.
    rise: base.rise - BITE_AXIAL_DROP * p.drive,
    headLift: BITE_AXIAL_HEAD_DROP * p.drive,
    tailSway: BITE_TAIL_SWAY * p.coil,
  };
}

function biteBack(frame: number, prop: MongoProportions): MongoPose {
  const progress = shotProgress(frame, MONGO_BITE_FRAMES);
  const p = strikePhases(progress, BITE_COIL_END, BITE_STRIKE_END);
  const base = biteBase(progress, prop);
  return {
    ...base,
    // From behind a bite is all haunch and tail: the head is hidden past the
    // shoulders, so anything drawn happening to it would be invented.
    gape: 0,
    rise: base.rise - BITE_AXIAL_DROP * p.drive * BITE_BACK_DROP_SHARE,
    headLift: BITE_AXIAL_HEAD_DROP * p.drive,
    tailSway: -BITE_TAIL_SWAY * p.coil,
  };
}

const BITE_AXIAL_DROP = 0.03;
const BITE_AXIAL_HEAD_DROP = 0.05;
const BITE_TAIL_SWAY = deg(13);
const BITE_BACK_DROP_SHARE = 0.5;

// ── Fore-claw slash ──────────────────────────────────────────────────────────

/**
 * How much of the row the rake itself occupies, centred on the declared impact.
 *
 * Derived from `MONGO_SLASH_IMPACT_PROGRESS` rather than declared beside it, so
 * the frame the claws cross the target *is* the frame gameplay charges damage
 * for, by construction.
 */
const SLASH_RAKE_HALF = 0.16;
const SLASH_COIL_END = MONGO_SLASH_IMPACT_PROGRESS - SLASH_RAKE_HALF;
const SLASH_RAKE_END = MONGO_SLASH_IMPACT_PROGRESS + SLASH_RAKE_HALF;
const SLASH_WIND_UPPER = deg(196);
const SLASH_STRIKE_UPPER = deg(-6);
const SLASH_WIND_FORE = deg(-62);
const SLASH_STRIKE_FORE = deg(-14);
/** How far behind the near arm the far one rakes — the one-two, not a clap. */
const SLASH_OFF_ARM_LAG = 0.13;
const SLASH_SURGE_BACK = -0.04;
const SLASH_SURGE_DRIVE = 0.07;
const SLASH_PITCH_COIL = deg(-7);
const SLASH_PITCH_DRIVE = deg(6);
const SLASH_TAIL_COIL = deg(18);
const SLASH_TAIL_DRIVE = deg(-9);
const SLASH_SNARL = 0.08;

function slashArm(progress: number, lag: number): ArmPose {
  const rake = easeInOut(ramp(progress - lag, SLASH_COIL_END, SLASH_RAKE_END));
  const reset = easeInOut(ramp(progress - lag, SLASH_RAKE_END, 1));
  const swing = rake * (1 - reset);
  return {
    upper: lerp(lerp(SLASH_WIND_UPPER, SLASH_STRIKE_UPPER, rake), REST_ARM_RETURN, reset),
    fore: lerp(SLASH_WIND_FORE, SLASH_STRIKE_FORE, rake),
    // The pink display feathers are what makes this frame — flared for balance
    // through the whole rake and only folded once he settles.
    spread:
      easeInOut(ramp(progress - lag, SLASH_FLARE_START, SLASH_COIL_END)) *
      (1 - reset * SLASH_FOLD_SHARE),
    lateral: swing * SLASH_ARM_LATERAL,
  };
}

const REST_ARM_RETURN = deg(118);
const SLASH_FLARE_START = 0.04;
const SLASH_FOLD_SHARE = 0.85;
const SLASH_ARM_LATERAL = 0.02;

function slashBase(progress: number, prop: MongoProportions): MongoPose {
  const p = strikePhases(progress, SLASH_COIL_END, SLASH_RAKE_END);
  const rest = restPose();
  return {
    ...rest,
    surge: SLASH_SURGE_BACK * p.coil + SLASH_SURGE_DRIVE * p.drive,
    rise: SLASH_RISE_COIL * p.coil + SLASH_RISE_DRIVE * p.drive,
    pitch: SLASH_PITCH_COIL * p.coil + SLASH_PITCH_DRIVE * p.drive,
    arch: lerp(IDLE_ARCH, SLASH_ARCH_COIL, p.coil) - SLASH_ARCH_DRIVE * p.drive,
    neckCurl: SLASH_NECK_COIL * p.coil + SLASH_NECK_DRIVE * p.drive,
    headTilt: SLASH_HEAD_COIL * p.coil + SLASH_HEAD_DRIVE * p.drive,
    gape: SLASH_SNARL * p.drive,
    eyeOpen: lerp(1, SLASH_SQUINT, p.coil),
    tailLift: REST_TAIL_LIFT + SLASH_TAIL_COIL * p.coil + SLASH_TAIL_DRIVE * p.drive,
    breathe: p.drive,
    nearArm: slashArm(progress, 0),
    farArm: slashArm(progress, SLASH_OFF_ARM_LAG),
    nearLeg: {
      ...restLeg(REST_NEAR_TOE * prop.femur + SLASH_SURGE_DRIVE * p.drive),
      nearness: 0.75,
    },
    farLeg: { ...restLeg(REST_FAR_TOE * prop.femur), nearness: 0.3 },
    time: progress,
  };
}

const SLASH_RISE_COIL = -0.012;
const SLASH_RISE_DRIVE = 0.008;
const SLASH_ARCH_COIL = 0.7;
const SLASH_ARCH_DRIVE = 0.5;
const SLASH_NECK_COIL = deg(14);
const SLASH_NECK_DRIVE = deg(-8);
const SLASH_HEAD_COIL = deg(-8);
const SLASH_HEAD_DRIVE = deg(7);
const SLASH_SQUINT = 0.7;

function slashSide(frame: number, prop: MongoProportions): MongoPose {
  return slashBase(shotProgress(frame, MONGO_SLASH_FRAMES), prop);
}

function slashFront(frame: number, prop: MongoProportions): MongoPose {
  const progress = shotProgress(frame, MONGO_SLASH_FRAMES);
  const p = strikePhases(progress, SLASH_COIL_END, SLASH_RAKE_END);
  return {
    ...slashBase(progress, prop),
    headLift: -SLASH_RISE_DRIVE * p.drive,
    sway: SLASH_SWAY * (p.coil - p.drive),
    tailSway: SLASH_TAIL_SWAY * p.coil,
  };
}

function slashBack(frame: number, prop: MongoProportions): MongoPose {
  const progress = shotProgress(frame, MONGO_SLASH_FRAMES);
  const p = strikePhases(progress, SLASH_COIL_END, SLASH_RAKE_END);
  return {
    ...slashBase(progress, prop),
    gape: 0,
    headLift: -SLASH_RISE_DRIVE * p.drive,
    sway: -SLASH_SWAY * (p.coil - p.drive),
    tailSway: -SLASH_TAIL_SWAY * p.coil,
  };
}

const SLASH_SWAY = 0.02;
const SLASH_TAIL_SWAY = deg(15);

// ── Pounce ───────────────────────────────────────────────────────────────────

const POUNCE_CROUCH_END = MONGO_POUNCE_AIRBORNE_START;
/** How far past the declared impact the strike keeps extending. */
const POUNCE_STRIKE_TAIL = 0.05;
const POUNCE_STRIKE_END = MONGO_POUNCE_IMPACT_PROGRESS + POUNCE_STRIKE_TAIL;
const POUNCE_CROUCH_DROP = 0.07;
/**
 * How high he leaps, as a share of his own hip height.
 *
 * Proportional rather than absolute: a flat 0.26 tiles is a shallow hop for the
 * adult and half the juvenile's entire height, and at fourteen frames that made
 * the chick's take-off strobe.
 */
const POUNCE_LEAP_SHARE = 0.4;
/**
 * Forward travel baked into the frames.
 *
 * Deliberately small: the real gap-closing distance is ordinary per-frame
 * movement in `Mongo.updateAI`, because the mob grid only tracks a mob that
 * moves itself. Baking the whole lunge into the sheet would make him teleport
 * and his attacks would then miss from a tile the grid still thinks he is on.
 */
const POUNCE_SURGE = 0.1;
const POUNCE_REACH = 0.44;
const POUNCE_TAIL_LIFT = deg(26);

/**
 * The leap's height over the airborne window, 0 at both ends and 1 at the apex.
 *
 * Squared rather than a plain half-sine: a half-sine leaves the ground at its
 * steepest, so at fourteen frames the take-off moves half the leap's height in
 * one frame and strobes. Squaring eases both ends without moving the apex.
 */
function pounceAirArc(progress: number): number {
  const arc = hump(ramp(progress, MONGO_POUNCE_AIRBORNE_START, MONGO_POUNCE_AIRBORNE_END));
  return arc * arc;
}

function pounceLeg(progress: number, prop: MongoProportions, toeBase: number): LegPose {
  const air = pounceAirArc(progress);
  const crouch = easeInOut(ramp(progress, 0, POUNCE_CROUCH_END));
  const reach = easeInOut(
    ramp(progress, MONGO_POUNCE_AIRBORNE_START, MONGO_POUNCE_IMPACT_PROGRESS),
  );
  const settle = easeInOut(ramp(progress, MONGO_POUNCE_IMPACT_PROGRESS, 1));
  return {
    toeX: toeBase * prop.femur + POUNCE_SURGE * air + POUNCE_REACH * reach * (1 - settle),
    // The feet ride up with the body and a little further, which is what swings
    // the legs out in front of him rather than letting them trail.
    lift: air * (prop.hipHeight * POUNCE_LEAP_SHARE + prop.metatarsus * POUNCE_EXTRA_LIFT),
    // Tucked for the whole flight, not just the crouch: released at take-off the
    // legs hang straight down and the leap reads as the standing pose slid
    // upward rather than as an animal in the air.
    meta: lerp(REST_META_WALK, POUNCE_TUCK_META, Math.max(crouch * (1 - reach), air * (1 - reach))),
    roll: 0,
    // The killing claw swings down out of its retraction as he commits, and
    // stays out until he has settled back onto his feet.
    sickle:
      easeInOut(ramp(progress, POUNCE_SICKLE_OUT, MONGO_POUNCE_IMPACT_PROGRESS)) * (1 - settle),
    lateral: 0,
    nearness: 0.75,
  };
}

const POUNCE_EXTRA_LIFT = 0.6;
const POUNCE_TUCK_META = deg(84);
const POUNCE_SICKLE_OUT = 0.3;

function pounceBase(progress: number, prop: MongoProportions): MongoPose {
  const air = pounceAirArc(progress);
  const crouch = easeInOut(ramp(progress, 0, POUNCE_CROUCH_END));
  const strike = easeInOut(ramp(progress, MONGO_POUNCE_AIRBORNE_START, POUNCE_STRIKE_END));
  const settle = easeInOut(ramp(progress, POUNCE_STRIKE_END, 1));
  const rest = restPose();
  const spread = easeInOut(ramp(progress, POUNCE_FLARE_START, POUNCE_CROUCH_END)) * (1 - settle);
  return {
    ...rest,
    surge: POUNCE_SURGE * strike * (1 - settle * POUNCE_SETTLE_BACK),
    rise: POUNCE_CROUCH_DROP * crouch - prop.hipHeight * POUNCE_LEAP_SHARE * air,
    pitch: POUNCE_PITCH_CROUCH * crouch - POUNCE_PITCH_AIR * air,
    arch: lerp(POUNCE_ARCH_CROUCH, POUNCE_ARCH_AIR, air),
    neckCurl: POUNCE_NECK_CROUCH * crouch + POUNCE_NECK_AIR * air,
    headTilt: POUNCE_HEAD_CROUCH * crouch + POUNCE_HEAD_AIR * air,
    gape: POUNCE_GAPE * air,
    eyeOpen: lerp(1, POUNCE_SQUINT, crouch),
    tailLift: REST_TAIL_LIFT + POUNCE_TAIL_LIFT * air,
    breathe: air,
    nearArm: { ...restArm(), spread, upper: lerp(restArm().upper, POUNCE_ARM_UPPER, spread) },
    farArm: { ...restArm(), spread, upper: lerp(restArm().upper, POUNCE_ARM_UPPER, spread) },
    nearLeg: pounceLeg(progress, prop, REST_NEAR_TOE),
    farLeg: { ...pounceLeg(progress, prop, REST_FAR_TOE), nearness: 0.3 },
    shadow: 1 - POUNCE_SHADOW_SHRINK * air,
    time: progress,
  };
}

const POUNCE_FLARE_START = 0.12;
const POUNCE_SETTLE_BACK = 0.4;
const POUNCE_PITCH_CROUCH = deg(4);
const POUNCE_PITCH_AIR = deg(12);
const POUNCE_ARCH_CROUCH = 0.75;
const POUNCE_ARCH_AIR = -0.45;
const POUNCE_NECK_CROUCH = deg(16);
const POUNCE_NECK_AIR = deg(-9);
const POUNCE_HEAD_CROUCH = deg(-9);
const POUNCE_HEAD_AIR = deg(11);
const POUNCE_GAPE = 0.09;
const POUNCE_SQUINT = 0.65;
const POUNCE_ARM_UPPER = deg(158);
const POUNCE_SHADOW_SHRINK = 0.55;

function pounceSide(frame: number, prop: MongoProportions): MongoPose {
  return pounceBase(shotProgress(frame, MONGO_POUNCE_FRAMES), prop);
}

function pounceFront(frame: number, prop: MongoProportions): MongoPose {
  const progress = shotProgress(frame, MONGO_POUNCE_FRAMES);
  const air = pounceAirArc(progress);
  const base = pounceBase(progress, prop);
  return {
    ...base,
    headLift: -base.rise * POUNCE_AXIAL_HEAD_SHARE,
    tailSway: POUNCE_TAIL_SWAY * air,
    nearLeg: { ...base.nearLeg, lateral: POUNCE_AXIAL_SPLAY * prop.girth * air },
    farLeg: { ...base.farLeg, lateral: -POUNCE_AXIAL_SPLAY * prop.girth * air },
  };
}

function pounceBack(frame: number, prop: MongoProportions): MongoPose {
  const progress = shotProgress(frame, MONGO_POUNCE_FRAMES);
  const air = pounceAirArc(progress);
  const base = pounceBase(progress, prop);
  return {
    ...base,
    gape: 0,
    headLift: -base.rise * POUNCE_AXIAL_HEAD_SHARE,
    tailSway: -POUNCE_TAIL_SWAY * air,
    nearLeg: { ...base.nearLeg, lateral: POUNCE_AXIAL_SPLAY * prop.girth * air },
    farLeg: { ...base.farLeg, lateral: -POUNCE_AXIAL_SPLAY * prop.girth * air },
  };
}

/**
 * How much of the leap the head keeps.
 *
 * Not a full cancel — head stabilisation is a *walking* trait. A raptor in the
 * air does not hold its head at standing height, and pinning it there makes the
 * leap read as the body dropping out from under a floating skull.
 */
const POUNCE_AXIAL_HEAD_SHARE = 0.35;
const POUNCE_TAIL_SWAY = deg(9);
const POUNCE_AXIAL_SPLAY = 0.3;

// ── Collapse ─────────────────────────────────────────────────────────────────

const COLLAPSE_SINK_START = 0.02;
const COLLAPSE_SINK_END = 0.68;
const COLLAPSE_SPLAY_START = 0.18;
const COLLAPSE_SPLAY_END = 0.56;
/** How much of his hip height he loses as the legs give out. */
const COLLAPSE_DROP_SHARE = 0.46;
const COLLAPSE_META = deg(27);
const COLLAPSE_FOOT_SPREAD = 0.4;
const COLLAPSE_PITCH = deg(11);
const COLLAPSE_NECK_DROOP = deg(26);
const COLLAPSE_HEAD_DROOP = deg(-32);
/** The tail flops later than the legs buckle, and overshoots slightly on the way. */
const COLLAPSE_TAIL_FLOP_START = 0.25;
const COLLAPSE_TAIL_FLOP_END = 0.8;
const COLLAPSE_PANT = 0.08;
const COLLAPSE_EYE_CLOSE = 0.78;
const COLLAPSE_ARM_UPPER = deg(146);
const COLLAPSE_ARM_SPREAD = 0.75;

function collapseSide(frame: number, prop: MongoProportions): MongoPose {
  const progress = shotProgress(frame, MONGO_COLLAPSE_FRAMES);
  const sink = easeInOut(ramp(progress, COLLAPSE_SINK_START, COLLAPSE_SINK_END));
  const splay = easeInOut(ramp(progress, COLLAPSE_SPLAY_START, COLLAPSE_SPLAY_END));
  const rest = restPose();
  const buckle = (toeBase: number, side: number): LegPose => ({
    toeX: toeBase * prop.femur + side * COLLAPSE_FOOT_SPREAD * prop.femur * splay,
    lift: 0,
    meta: lerp(REST_META_WALK, COLLAPSE_META, sink),
    roll: 0,
    sickle: 0,
    lateral: 0,
    nearness: side > 0 ? 0.75 : 0.3,
  });
  // The tail lies *down*, not out. A stiff tail held at a constant angle through
  // the whole collapse reads as a handle sticking out of a bag — and dropped by
  // a fixed number of degrees instead it drives its own tip through the floor,
  // because how far the tip has to fall depends on how far the hips have fallen.
  const tailLength = prop.tail.reduce((total, segment) => total + segment, 0);
  const hipsAboveFloor = prop.hipHeight * (1 - COLLAPSE_DROP_SHARE);
  const restingTailLift = -Math.asin(Math.min(1, hipsAboveFloor / tailLength));
  const collapsed: MongoPose = {
    ...rest,
    rise:
      prop.hipHeight * COLLAPSE_DROP_SHARE * sink -
      prop.hipHeight * COLLAPSE_SETTLE_RISE * hump(ramp(progress, COLLAPSE_SINK_END, 1)),
    pitch: COLLAPSE_PITCH * sink,
    arch: lerp(IDLE_ARCH, -COLLAPSE_FLATTEN, sink),
    neckCurl: COLLAPSE_NECK_DROOP * sink,
    headTilt: COLLAPSE_HEAD_DROOP * sink,
    gape: COLLAPSE_PANT * sink,
    eyeOpen: 1 - COLLAPSE_EYE_CLOSE * sink,
    tailLift: lerp(
      REST_TAIL_LIFT,
      restingTailLift,
      easeInOut(ramp(progress, COLLAPSE_TAIL_FLOP_START, COLLAPSE_TAIL_FLOP_END)),
    ),
    // A settle after the sink: the last frames were pixel-identical, so a tenth
    // of the death animation was a dead hold on a corpse that had stopped moving
    // before the row ended.
    breathe: -sink + COLLAPSE_SETTLE * hump(ramp(progress, COLLAPSE_SINK_END, 1)),
    nearArm: {
      ...restArm(),
      upper: lerp(restArm().upper, COLLAPSE_ARM_UPPER, splay),
      spread: COLLAPSE_ARM_SPREAD * splay,
    },
    farArm: {
      ...restArm(),
      upper: lerp(restArm().upper, COLLAPSE_ARM_UPPER, splay),
      spread: COLLAPSE_ARM_SPREAD * splay,
    },
    nearLeg: buckle(REST_NEAR_TOE, 1),
    farLeg: buckle(REST_FAR_TOE, -1),
    time: progress,
  };
  // The head rests *on* the floor, not through it. Drooped by a fixed angle it
  // drives the jaw a couple of screen pixels under the ground line, which the
  // frame-0 anchor gate cannot see because the collapse only reaches its lowest
  // pose at the end.
  // The skull is laid *on* the floor, in both directions — pulled down to rest
  // there if the neck's own droop left it high, and lifted off it if the droop
  // drove it through. Clamped one way only, a shallower neck leaves the head
  // floating at back height.
  const headY = measureHead(collapsed, prop).y;
  const floor = GROUND_Y - prop.skullDepth * COLLAPSE_HEAD_CLEARANCE;
  return { ...collapsed, headLift: floor - headY };
}

/** How far the skull's centre stays above the floor when he is down. */
const COLLAPSE_HEAD_CLEARANCE = 0.75;

const COLLAPSE_FLATTEN = 0.4;
/** How much the ribs still move once he is down. */
const COLLAPSE_SETTLE = 0.55;
const COLLAPSE_SETTLE_RISE = 0.03;

// ── Row manifest ─────────────────────────────────────────────────────────────

export type View = 'front' | 'side' | 'back';
export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: View;
  readonly pose: (frame: number, prop: MongoProportions) => MongoPose;
}

export const ROWS: readonly RowSpec[] = [
  { name: 'idle', frameCount: IDLE_FRAMES, kind: 'loop', view: 'front', pose: idleFront },
  { name: 'idle_side', frameCount: IDLE_FRAMES, kind: 'loop', view: 'side', pose: idleSide },
  { name: 'idle_away', frameCount: IDLE_FRAMES, kind: 'loop', view: 'back', pose: idleBack },
  { name: 'walk', frameCount: WALK_FRAMES, kind: 'loop', view: 'front', pose: walkFront },
  { name: 'walk_side', frameCount: WALK_FRAMES, kind: 'loop', view: 'side', pose: walkSide },
  { name: 'walk_away', frameCount: WALK_FRAMES, kind: 'loop', view: 'back', pose: walkBack },
  { name: 'bite', frameCount: MONGO_BITE_FRAMES, kind: 'oneShot', view: 'front', pose: biteFront },
  {
    name: 'bite_side',
    frameCount: MONGO_BITE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: biteSide,
  },
  {
    name: 'bite_away',
    frameCount: MONGO_BITE_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: biteBack,
  },
  {
    name: 'slash',
    frameCount: MONGO_SLASH_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: slashFront,
  },
  {
    name: 'slash_side',
    frameCount: MONGO_SLASH_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: slashSide,
  },
  {
    name: 'slash_away',
    frameCount: MONGO_SLASH_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: slashBack,
  },
  {
    name: 'pounce',
    frameCount: MONGO_POUNCE_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: pounceFront,
  },
  {
    name: 'pounce_side',
    frameCount: MONGO_POUNCE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: pounceSide,
  },
  {
    name: 'pounce_away',
    frameCount: MONGO_POUNCE_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: pounceBack,
  },
  {
    name: 'collapse',
    frameCount: MONGO_COLLAPSE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: collapseSide,
  },
];

export interface PoseSample {
  readonly stage: MongoStage;
  readonly prop: MongoProportions;
  readonly row: RowSpec;
  readonly frame: number;
  readonly pose: MongoPose;
}

/** Every pose the sheets are built from, for the pose-stream gates. */
export function* poseStream(stage?: MongoStage): Generator<PoseSample> {
  const stages = stage === undefined ? MONGO_STAGE_ORDER : [stage];
  for (const name of stages) {
    const prop = MONGO_STAGES[name];
    for (const row of ROWS) {
      for (let frame = 0; frame < row.frameCount; frame++) {
        yield { stage: name, prop, row, frame, pose: row.pose(frame, prop) };
      }
    }
  }
}

// ── Bake ─────────────────────────────────────────────────────────────────────

/** Alpha above which a pixel counts as painted, when measuring ink extents. */
const INK_ALPHA_THRESHOLD = 24;
/** Scratch canvas for measurement; comfortably larger than any cell can be. */
const MEASURE_SIZE = 512;

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

function paintFrame(
  ctx: Ctx,
  originX: number,
  originY: number,
  row: RowSpec,
  frame: number,
  prop: MongoProportions,
): void {
  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  // Scaled about the ground line so a smaller stage still stands on the tile its
  // feet belong to rather than floating above it.
  ctx.translate(0, GROUND_Y);
  ctx.scale(prop.scale, prop.scale);
  ctx.translate(0, -GROUND_Y);
  const pose = row.pose(frame, prop);
  if (row.view === 'front') drawMongoFront(ctx, pose, prop);
  else if (row.view === 'back') drawMongoBack(ctx, pose, prop);
  else drawMongoSide(ctx, pose, prop);
  ctx.restore();
}

interface Extents {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  /** Frames that painted nothing — the signature of a NaN pose. */
  readonly blankFrames: readonly string[];
}

function measure(prop: MongoProportions): Extents {
  const canvas = createCanvas(MEASURE_SIZE, MEASURE_SIZE);
  const ctx = canvas.getContext('2d');
  const originX = MEASURE_SIZE / 2;
  const originY = MEASURE_SIZE / 2;

  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  const blankFrames: string[] = [];

  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      ctx.clearRect(0, 0, MEASURE_SIZE, MEASURE_SIZE);
      paintFrame(ctx, originX, originY, row, frame, prop);
      const box = inkBoxOf(ctx, MEASURE_SIZE, MEASURE_SIZE);
      if (box === null) {
        blankFrames.push(`${row.name}[${frame}]`);
        continue;
      }
      left = Math.max(left, originX - box.minX);
      right = Math.max(right, box.maxX - originX);
      up = Math.max(up, originY - box.minY);
      down = Math.max(down, box.maxY - originY);
    }
  }

  return { left, right, up, down, blankFrames };
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
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const frameWidth = roundUpTo(halfWidth * 2, FRAME_SIZE_QUANTUM);
  const originY = Math.ceil(extents.up + FRAME_PADDING);
  const frameHeight = roundUpTo(originY + extents.down + FRAME_PADDING, FRAME_SIZE_QUANTUM);
  return {
    frameWidth,
    frameHeight,
    tileX: frameWidth / 2 - TILE_SCALE / 2,
    tileY: originY - TILE_SCALE / 2,
  };
}

export interface BakedSheet {
  readonly stage: MongoStage;
  readonly buffer: Buffer;
  readonly geometry: SheetGeometry;
  readonly columns: number;
}

export function bake(stage: MongoStage): BakedSheet {
  const prop = MONGO_STAGES[stage];
  const extents = measure(prop);
  if (extents.blankFrames.length > 0) {
    throw new Error(
      `${stage}: these frames painted nothing, which almost always means a NaN in the pose: ` +
        extents.blankFrames.join(', '),
    );
  }

  const geometry = geometryFor(extents);
  const columns = Math.max(...ROWS.map((row) => row.frameCount));
  const sheet = createCanvas(columns * geometry.frameWidth, ROWS.length * geometry.frameHeight);
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  ROWS.forEach((row, rowIndex) => {
    for (let frame = 0; frame < row.frameCount; frame++) {
      cellCtx.clearRect(0, 0, cell.width, cell.height);
      cellCtx.save();
      cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
      paintFrame(
        cellCtx,
        geometry.frameWidth / 2,
        geometry.tileY + TILE_SCALE / 2,
        row,
        frame,
        prop,
      );
      cellCtx.restore();
      sheetCtx.drawImage(
        cell,
        0,
        0,
        cell.width,
        cell.height,
        frame * geometry.frameWidth,
        rowIndex * geometry.frameHeight,
        geometry.frameWidth,
        geometry.frameHeight,
      );
    }
  });

  return {
    stage,
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry,
    columns,
  };
}

// ── Manifest ─────────────────────────────────────────────────────────────────

export const MANIFEST_PATH = 'src/images/enemies/manifest.json';

export function sheetKeyFor(stage: MongoStage): string {
  return `mongo_${stage}`;
}

export function sheetPathFor(stage: MongoStage): string {
  return `src/images/enemies/${sheetKeyFor(stage)}.png`;
}

interface ManifestStateEntry {
  readonly row: number;
  readonly frameCount: number;
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

function manifestEntryFor(sheet: BakedSheet): ManifestEntry {
  const states: Record<string, ManifestStateEntry> = {};
  ROWS.forEach((row, index) => {
    states[row.name] = { row: index, frameCount: row.frameCount };
  });
  return {
    path: `enemies/${sheetKeyFor(sheet.stage)}.png`,
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

/**
 * A stable string for comparing two manifest entries.
 *
 * Key order in JSON carries no meaning, so a hand-edit that reorders `tileX` and
 * `tileY` must not read as a mismatch.
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
 * Checks `manifest.json` against a bake rather than rewriting it: other agents
 * work in this repo, and a programmatic rewrite of a shared file would clobber
 * their edits. Returns the paste-ready entry on mismatch, or null when in sync.
 */
export function manifestMismatch(sheet: BakedSheet): string | null {
  const required = manifestEntryFor(sheet);
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const key = sheetKeyFor(sheet.stage);
  if (canonicalJson(manifest[key]) === canonicalJson(required)) return null;
  return (
    `${MANIFEST_PATH} is out of sync with the ${sheet.stage} bake. ` +
    `Replace its "${key}" entry with:\n${JSON.stringify({ [key]: required }, null, 2)}`
  );
}
