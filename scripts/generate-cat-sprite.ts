#!/usr/bin/env tsx
/**
 * Generates the `cat` sprite sheet — Donut, the chubby long-haired tortoiseshell
 * the player either drives or drags along behind them.
 *
 * The anatomy and the painting live in `scripts/catArt.ts`; this file is only
 * the choreography: one pose function per animation row, sampled per frame.
 *
 * Rows (see the `cat` entry in src/images/characters/manifest.json):
 *    0 walk          — toward the camera, one full gait cycle
 *    1 walk_side     — profile, drawn facing +X and mirrored at runtime
 *    2 walk_away     — away from the camera, tail up
 *    3 idle          — breathing, tail sway, slow blink
 *    4 idle_side
 *    5 idle_away
 *    6 look_around   — idle break: head sweeps left, blinks, sweeps right
 *    7 groom_paw     — idle break: sits, licks a forepaw, wipes it over her ear
 *    8 groom_flank   — idle break: sits, hind leg up, works on her flank
 *    9 swipe         — claw swipe toward the camera
 *   10 swipe_side
 *   11 swipe_away
 *   12 cast          — magic missile: rocks back, charges an orb, throws it
 *   13 cast_side
 *   14 cast_away
 *   15 knocked_out   — down and out, waiting on a revive
 *   16 dance         — level-up celebration, paws pumping
 *
 * Run: npx tsx scripts/generate-cat-sprite.ts
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  GROUND_Y,
  type CatPose,
  type PawPose,
  type TailPose,
  clamp01,
  deg,
  drawCatBack,
  drawCatFront,
  drawCatSide,
  easeInOut,
  hump,
  lerp,
  ramp,
  restPose,
  TWO_PI,
} from './catArt.js';

// ── Sheet geometry (must match the manifest entry) ───────────────────────────

/**
 * 160px leaves three quarters of a tile of clearance on every side, which is
 * what the tail plume, a raised paw and the claw arc need at full reach.
 */
export const FRAME_W = 160;
export const FRAME_H = 160;
/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Top-left of the logical tile within each frame. */
export const TILE_X = (FRAME_W - TILE_SCALE) / 2;
export const TILE_Y = (FRAME_H - TILE_SCALE) / 2;
/** Every painter draws around the centre of the logical tile. */
const ORIGIN_X = TILE_X + TILE_SCALE / 2;
const ORIGIN_Y = TILE_Y + TILE_SCALE / 2;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/**
 * How much of a tile Donut fills. She is a housecat standing next to goblins
 * and clowns, so she is drawn at two thirds of the anatomy's natural size —
 * scaled about her own ground line, which keeps her paws on the tile they
 * belong to. The frame keeps its full resolution; only she gets smaller.
 */
const CAT_SCALE = 2 / 3;

const WALK_FRAMES = 8;
const IDLE_FRAMES = 8;
const BREAK_FRAMES = 12;
const ACTION_FRAMES = 8;
const KO_FRAMES = 8;
const DANCE_FRAMES = 12;

// ── Pose helpers ─────────────────────────────────────────────────────────────

const NO_PAW: PawPose = { dx: 0, dy: 0, lift: 0, claw: 0 };

function paw(dx: number, dy: number, lift: number, claw = 0): PawPose {
  return { dx, dy, lift, claw };
}

/** A foot in a walk cycle: forward reach on the swing, planted on the stance. */
function gaitPaw(phase: number, reach: number, height: number): PawPose {
  const cycle = ((phase % 1) + 1) % 1;
  const swing = cycle < 0.5;
  const t = swing ? cycle / 0.5 : (cycle - 0.5) / 0.5;
  const dx = swing ? lerp(-reach, reach, easeInOut(t)) : lerp(reach, -reach, t);
  const lift = swing ? hump(t) : 0;
  return { dx, dy: -lift * height, lift, claw: 0 };
}

function tail(
  base: number,
  curl: number,
  wave = 0,
  phase = 0,
  puff = 0,
  flick = 0,
  rootX = 0,
  rootY = 0,
): TailPose {
  return { base, curl, wave, phase, puff, flick, rootX, rootY };
}

/**
 * Tail carriage per view. Curl accumulates clockwise on screen, so a tail that
 * leaves to the right lifts its tip with a negative curl and one that leaves to
 * the left lifts with a positive one.
 */
const FRONT_TAIL_BASE = deg(-20);
const BACK_TAIL_BASE = deg(-78);
const SIDE_TAIL_BASE = deg(-170);

const BLINK_HOLD = 0.06;

/** A blink centred on `at`, expressed in cycle phase. */
function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 0.5 + 1) % 1) - 0.5);
  return distance < BLINK_HOLD ? clamp01(distance / BLINK_HOLD) : 1;
}

// ── Walk ─────────────────────────────────────────────────────────────────────

const WALK_BOB = 0.016;
const WALK_SWAY = 0.022;
const WALK_REACH_SIDE = 0.11;
/** Foot clearance on the swing, in tile units. */
const WALK_LIFT_SIDE = 0.075;

/**
 * Head-on, a paw does not swing across the body — it lifts, tracks inward under
 * the chest the way a cat's near-single-track walk does, and plants a little
 * further down the screen as it comes toward the camera. Anything more reads as
 * a puppet kicking its legs out sideways.
 */
const WALK_FRONT_LIFT = 0.2;
const WALK_FRONT_TRACK_IN = 0.032;
const WALK_FRONT_PLANT = 0.014;

function frontStep(phase: number, side: number): PawPose {
  const cycle = ((phase % 1) + 1) % 1;
  const swinging = cycle < 0.5;
  const t = swinging ? cycle / 0.5 : (cycle - 0.5) / 0.5;
  const lift = swinging ? hump(t) : 0;
  const trackIn = swinging ? Math.sin(t * Math.PI) : 0;
  // Eased in and out so the seam between swing and stance never pops.
  const plant = swinging ? 0 : WALK_FRONT_PLANT * hump(t);
  return {
    dx: -side * WALK_FRONT_TRACK_IN * trackIn,
    dy: plant - WALK_FRONT_LIFT * lift,
    lift,
    claw: 0,
  };
}

function walkFront(phase: number): CatPose {
  const angle = phase * TWO_PI;
  const sway = WALK_SWAY * Math.sin(angle);
  const rest = restPose();
  return {
    ...rest,
    bob: -WALK_BOB * Math.cos(angle * 2),
    sway,
    lean: deg(3.5) * Math.sin(angle),
    // A cat's head stays level over the centreline while the shoulders roll.
    headX: -sway * 0.65,
    headY: WALK_BOB * 0.3 * Math.cos(angle * 2),
    headTilt: deg(-2.5) * Math.sin(angle),
    earL: 0.35,
    earR: 0.35,
    eyeOpen: blink(phase, 0.7),
    pupil: 0.5,
    tail: tail(FRONT_TAIL_BASE, 1.5, 0.3, angle, 0.1),
    frontL: frontStep(phase, -1),
    frontR: frontStep(phase + 0.5, 1),
    // The hind paws only peek past the flanks head-on. Bobbing them too reads
    // as four balls juggling rather than as a cat walking, so they stay put and
    // the front pair carries the whole rhythm.
    hindL: NO_PAW,
    hindR: NO_PAW,
    breathe: Math.sin(angle * 2),
    time: phase,
  };
}

function walkBack(phase: number): CatPose {
  const angle = phase * TWO_PI;
  const front = walkFront(phase);
  // From behind it is the hind pair that shows, so the step swaps legs.
  return {
    ...front,
    sway: -front.sway,
    headX: -front.headX,
    lean: -front.lean,
    headTilt: -front.headTilt,
    headTurn: 0.08 * Math.sin(angle),
    tail: tail(BACK_TAIL_BASE, -0.5, 0.35, angle, 0.3, 0.25 * Math.sin(angle * 2)),
    frontL: NO_PAW,
    frontR: NO_PAW,
    hindL: frontStep(phase, -1),
    hindR: frontStep(phase + 0.5, 1),
  };
}

/** A diagonal (trotting) gait: it reads far more clearly than a lateral walk at tile size. */
function walkSide(phase: number): CatPose {
  const angle = phase * TWO_PI;
  const rest = restPose();
  return {
    ...rest,
    bob: -WALK_BOB * Math.cos(angle * 2),
    lean: deg(1.5) * Math.sin(angle * 2),
    headY: WALK_BOB * 0.5 * Math.cos(angle * 2 + Math.PI),
    headX: 0.012 * Math.sin(angle),
    earL: 0.4,
    earR: 0.45,
    eyeOpen: blink(phase, 0.35),
    pupil: 0.5,
    tail: tail(SIDE_TAIL_BASE, 1.3, 0.4, angle, 0.1, 0.3 * Math.sin(angle)),
    frontR: gaitPaw(phase, WALK_REACH_SIDE, WALK_LIFT_SIDE),
    frontL: gaitPaw(phase + 0.5, WALK_REACH_SIDE, WALK_LIFT_SIDE),
    hindR: gaitPaw(phase + 0.5, WALK_REACH_SIDE * 0.85, WALK_LIFT_SIDE * 0.85),
    hindL: gaitPaw(phase, WALK_REACH_SIDE * 0.85, WALK_LIFT_SIDE * 0.85),
    breathe: Math.sin(angle * 2),
    time: phase,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

const IDLE_BREATH = 0.006;

function idleFront(phase: number): CatPose {
  const angle = phase * TWO_PI;
  const rest = restPose();
  return {
    ...rest,
    bob: IDLE_BREATH * Math.sin(angle),
    breathe: Math.sin(angle),
    headY: -IDLE_BREATH * 0.5 * Math.sin(angle),
    headTilt: deg(1.5) * Math.sin(angle * 0.5),
    earL: 0.25 + 0.15 * Math.sin(angle * 2),
    earR: 0.25 - 0.15 * Math.sin(angle * 2),
    eyeOpen: blink(phase, 0.55),
    pupil: 0.6,
    tail: tail(FRONT_TAIL_BASE, 1.45, 0.28, angle, 0, 0.35 * Math.sin(angle * 2)),
    time: phase,
  };
}

function idleBack(phase: number): CatPose {
  const angle = phase * TWO_PI;
  const front = idleFront(phase);
  return {
    ...front,
    tail: tail(BACK_TAIL_BASE, -0.45, 0.3, angle, 0.25, 0.4 * Math.sin(angle * 2)),
  };
}

function idleSide(phase: number): CatPose {
  const angle = phase * TWO_PI;
  const front = idleFront(phase);
  return {
    ...front,
    headX: 0.004 * Math.sin(angle),
    tail: tail(SIDE_TAIL_BASE, 1.25, 0.35, angle, 0, 0.45 * Math.sin(angle * 2)),
  };
}

// ── Idle breaks ──────────────────────────────────────────────────────────────

/** Head sweeps to one side, blinks, sweeps to the other, then settles. */
function lookAround(progress: number): CatPose {
  const left = easeInOut(ramp(progress, 0.06, 0.26));
  const right = easeInOut(ramp(progress, 0.42, 0.62));
  const home = easeInOut(ramp(progress, 0.78, 0.96));
  const turn = -left + right * 2 - home;
  const angle = progress * TWO_PI;
  const rest = restPose();
  return {
    ...rest,
    breathe: Math.sin(angle),
    headTurn: turn,
    headTilt: deg(4) * turn,
    headX: turn * 0.02,
    earL: 0.5 - turn * 0.5,
    earR: 0.5 + turn * 0.5,
    eyeOpen: Math.min(blink(progress, 0.36), blink(progress, 0.72)),
    pupil: 0.7,
    tail: tail(FRONT_TAIL_BASE, 1.45, 0.3, angle, 0, 0.6 * Math.sin(angle * 3)),
    time: progress,
  };
}

const GROOM_LICK_RATE = 5;
/** The paw has to come all the way up to the muzzle, not just off the floor. */
const GROOM_PAW_LICK_HEIGHT = -0.52;
const GROOM_PAW_WIPE_HEIGHT = -0.74;
/** The hoisted hind leg swings out and up into the classic grooming pose. */
const GROOM_HIND_SWING = 0.07;
const GROOM_HIND_LIFT = -0.3;

/** Sits, brings a forepaw up to be licked, then wipes it over her ear. */
function groomPaw(progress: number): CatPose {
  const raise = easeInOut(ramp(progress, 0.04, 0.24));
  const lickWindow = ramp(progress, 0.22, 0.3) * (1 - ramp(progress, 0.5, 0.58));
  const wipe = ramp(progress, 0.56, 0.7) * (1 - ramp(progress, 0.86, 0.98));
  const wipeSweep = hump(ramp(progress, 0.56, 0.98));
  const settle = 1 - easeInOut(ramp(progress, 0.88, 1));

  const pawUp = raise * settle;
  const pawX = lerp(-0.04, 0.075, wipeSweep) * pawUp;
  const pawY = lerp(GROOM_PAW_LICK_HEIGHT, GROOM_PAW_WIPE_HEIGHT, wipe) * pawUp;

  const rest = restPose();
  return {
    ...rest,
    sit: 1,
    breathe: Math.sin(progress * TWO_PI),
    headBow: lerp(0.8, 0.25, wipe) * pawUp,
    headTilt: deg(-8) * wipe * pawUp,
    headTurn: -0.25 * pawUp,
    earL: -0.2 * wipe,
    earR: 0.2,
    eyeOpen: lerp(0.35, 0.15, lickWindow),
    pupil: 0.75,
    mouth: 0.25 * lickWindow,
    tongue: lickWindow * (0.55 + 0.45 * Math.sin(progress * TWO_PI * GROOM_LICK_RATE)),
    tail: tail(FRONT_TAIL_BASE, 1.1, 0.15, progress * TWO_PI, 0, 0.3),
    frontR: paw(pawX, pawY, pawUp),
    frontL: paw(0.01, 0, 0),
    time: progress,
  };
}

/** The yoga pose: hind leg hoisted, nose buried in the flank. */
function groomFlank(progress: number): CatPose {
  const raise = easeInOut(ramp(progress, 0.05, 0.28));
  const settle = 1 - easeInOut(ramp(progress, 0.85, 1));
  const active = raise * settle;
  const lick = ramp(progress, 0.3, 0.4) * (1 - ramp(progress, 0.74, 0.84));
  const rest = restPose();
  return {
    ...rest,
    sit: 1,
    breathe: Math.sin(progress * TWO_PI),
    bob: 0.01 * active,
    headBow: 0.85 * active,
    headTurn: 0.55 * active,
    headTilt: deg(16) * active,
    headX: 0.07 * active,
    headY: 0.14 * active,
    earL: -0.35 * active,
    earR: -0.15 * active,
    eyeOpen: lerp(0.5, 0.12, active),
    pupil: 0.8,
    mouth: 0.3 * lick,
    tongue: lick * (0.5 + 0.5 * Math.sin(progress * TWO_PI * GROOM_LICK_RATE)),
    tail: tail(FRONT_TAIL_BASE, 1.9, 0.1, 0, 0, 0),
    hindR: paw(GROOM_HIND_SWING * active, GROOM_HIND_LIFT * active, active),
    frontL: paw(-0.01, 0, 0),
    frontR: paw(0.02, 0.01 * active, 0),
    time: progress,
  };
}

// ── Claw swipe ───────────────────────────────────────────────────────────────

const SWIPE_WINDUP_END = 0.34;
const SWIPE_STRIKE_END = 0.62;

interface SwipePhases {
  readonly windup: number;
  readonly strike: number;
  readonly recover: number;
  readonly slash: number | null;
}

function swipePhases(progress: number): SwipePhases {
  const windup = easeInOut(ramp(progress, 0, SWIPE_WINDUP_END));
  const strike = easeInOut(ramp(progress, SWIPE_WINDUP_END, SWIPE_STRIKE_END));
  const recover = easeInOut(ramp(progress, SWIPE_STRIKE_END, 1));
  const slashProgress = ramp(progress, SWIPE_WINDUP_END, 0.92);
  return {
    windup,
    strike,
    recover,
    slash: progress > SWIPE_WINDUP_END && progress < 0.95 ? slashProgress : null,
  };
}

function swipeFront(progress: number): CatPose {
  const s = swipePhases(progress);
  const armX = lerp(0.13, -0.19, s.strike) * (1 - s.recover * 0.7);
  const armY = lerp(-0.44, -0.28, s.strike) * (1 - s.recover * 0.8);
  const rest = restPose();
  return {
    ...rest,
    bob: lerp(0.014, -0.016, s.strike) * (1 - s.recover),
    lean: deg(-5) * s.windup + deg(9) * s.strike,
    squash: 1 - 0.05 * s.strike,
    headY: -0.012 * s.windup + 0.016 * s.strike,
    headTilt: deg(-6) * s.strike,
    headTurn: -0.2 * s.windup + 0.25 * s.strike,
    earL: -0.6,
    earR: -0.45,
    eyeOpen: lerp(1, 0.55, s.windup),
    pupil: lerp(0.5, 0.15, s.windup),
    mouth: lerp(0.15, 0.85, s.windup) * (1 - s.recover * 0.8),
    tail: tail(FRONT_TAIL_BASE, 1.2, 0.9, s.strike * 6, 0.55, -1.1 * s.strike),
    frontR: paw(armX, armY, 1 - s.recover * 0.9, lerp(0.4, 1, s.windup) * (1 - s.recover)),
    frontL: paw(-0.02, -0.02 * s.strike, 0.1),
    hindL: NO_PAW,
    hindR: NO_PAW,
    slash: s.slash,
    time: progress,
  };
}

function swipeSide(progress: number): CatPose {
  const s = swipePhases(progress);
  const rest = restPose();
  return {
    ...rest,
    bob: lerp(0.012, -0.014, s.strike) * (1 - s.recover),
    sway: lerp(-0.03, 0.05, s.strike) * (1 - s.recover * 0.6),
    lean: deg(-6) * s.windup + deg(8) * s.strike,
    squash: 1 - 0.04 * s.strike,
    headX: lerp(-0.02, 0.035, s.strike),
    headTilt: deg(-10) * s.windup + deg(6) * s.strike,
    earL: -0.6,
    earR: -0.6,
    eyeOpen: lerp(1, 0.5, s.windup),
    pupil: lerp(0.5, 0.15, s.windup),
    mouth: lerp(0.1, 0.9, s.windup) * (1 - s.recover * 0.8),
    tail: tail(SIDE_TAIL_BASE, 1.6, 1.1, s.strike * 6, 0.6, -1.2 * s.strike),
    frontR: paw(
      lerp(-0.12, 0.29, s.strike) * (1 - s.recover * 0.8),
      lerp(-0.3, -0.1, s.strike) * (1 - s.recover * 0.8),
      1 - s.recover * 0.9,
      lerp(0.4, 1, s.windup) * (1 - s.recover),
    ),
    frontL: paw(0.02 * s.strike, 0, 0),
    hindR: paw(-0.03 * s.windup, 0, 0),
    hindL: paw(-0.02 * s.windup, 0, 0),
    slash: s.slash,
    time: progress,
  };
}

function swipeBack(progress: number): CatPose {
  const s = swipePhases(progress);
  const rest = restPose();
  return {
    ...rest,
    bob: lerp(0.014, -0.02, s.strike) * (1 - s.recover),
    lean: deg(4) * s.windup - deg(6) * s.strike,
    squash: 1 - 0.05 * s.strike,
    headY: -0.02 * s.strike,
    earL: -0.8,
    earR: -0.8,
    eyeOpen: 1,
    tail: tail(BACK_TAIL_BASE, 0.5, 1.2, s.strike * 6, 0.6, -1.4 * s.strike),
    frontR: paw(0.08, lerp(-0.26, -0.36, s.strike), 1 - s.recover * 0.9),
    frontL: paw(-0.05, -0.05 * s.strike, 0.3),
    slash: s.slash,
    time: progress,
  };
}

// ── Magic missile ────────────────────────────────────────────────────────────

const CAST_CHARGE_END = 0.58;
const CAST_RELEASE_START = 0.62;

interface CastPhases {
  readonly rear: number;
  readonly charge: number;
  readonly release: number;
  readonly thrust: number;
}

function castPhases(progress: number): CastPhases {
  return {
    rear: easeInOut(ramp(progress, 0.02, 0.35)) * (1 - easeInOut(ramp(progress, 0.8, 1)) * 0.8),
    charge: easeInOut(ramp(progress, 0.08, CAST_CHARGE_END)),
    release: ramp(progress, CAST_RELEASE_START, 0.85),
    thrust: hump(ramp(progress, CAST_RELEASE_START - 0.06, 0.95)),
  };
}

function castFront(progress: number): CatPose {
  const c = castPhases(progress);
  const lift = c.rear;
  const rest = restPose();
  return {
    ...rest,
    sit: 0.55 * c.rear,
    bob: -0.01 * c.rear + 0.012 * c.thrust,
    lean: deg(-4) * c.rear + deg(6) * c.thrust,
    headY: -0.01 * c.rear,
    headTilt: deg(3) * c.thrust,
    earL: 1,
    earR: 1,
    eyeOpen: lerp(1, 1.15, c.charge),
    pupil: lerp(0.6, 1, c.charge),
    mouth: 0.25 * c.charge,
    tail: tail(FRONT_TAIL_BASE, 1.35, 0.5, progress * 8, 0.35 + 0.4 * c.charge, 0.4 * c.thrust),
    frontL: paw(0.06 * lift + 0.02 * c.thrust, -0.32 * lift - 0.05 * c.thrust, lift),
    frontR: paw(-0.06 * lift - 0.02 * c.thrust, -0.32 * lift - 0.05 * c.thrust, lift),
    cast: c.charge,
    castRelease: c.release,
    time: progress,
  };
}

function castSide(progress: number): CatPose {
  const c = castPhases(progress);
  const lift = c.rear;
  const rest = restPose();
  return {
    ...rest,
    sit: 0.4 * c.rear,
    bob: -0.012 * c.rear,
    sway: -0.03 * c.rear + 0.05 * c.thrust,
    lean: deg(-7) * c.rear + deg(7) * c.thrust,
    headX: 0.015 * c.thrust,
    earL: 1,
    earR: 1,
    eyeOpen: lerp(1, 1.15, c.charge),
    pupil: lerp(0.6, 1, c.charge),
    mouth: 0.25 * c.charge,
    tail: tail(SIDE_TAIL_BASE, 1.45, 0.6, progress * 8, 0.35 + 0.4 * c.charge, 0.5 * c.thrust),
    frontR: paw(0.05 * lift + 0.08 * c.thrust, -0.2 * lift - 0.03 * c.thrust, lift),
    frontL: paw(0.03 * lift + 0.05 * c.thrust, -0.16 * lift, lift * 0.8),
    cast: c.charge,
    castRelease: c.release,
    time: progress,
  };
}

function castBack(progress: number): CatPose {
  const c = castPhases(progress);
  const rest = restPose();
  return {
    ...rest,
    sit: 0.5 * c.rear,
    bob: -0.012 * c.rear + 0.01 * c.thrust,
    lean: deg(3) * c.rear - deg(5) * c.thrust,
    earL: 1,
    earR: 1,
    tail: tail(BACK_TAIL_BASE, 0.6, 0.55, progress * 8, 0.35 + 0.4 * c.charge, 0.5 * c.thrust),
    frontL: paw(-0.05, -0.3 * c.rear, c.rear),
    frontR: paw(0.05, -0.3 * c.rear, c.rear),
    cast: c.charge,
    castRelease: c.release,
    time: progress,
  };
}

// ── Down and out ─────────────────────────────────────────────────────────────

/**
 * Seen from the game's high angle, a cat collapsed on her side is the profile
 * silhouette tipped a little and pressed flat, not turned on its head — the
 * roll stays small and the drop does the work.
 */
const KO_ROLL = deg(20);
/** How far the body sinks toward the floor once the legs give out. */
const KO_BODY_DROP = 0.07;
const KO_FLATTEN = 0.87;
/** Curled hard so the limp tail stays inside the frame instead of running off it. */
const KO_TAIL_CURL = -1.55;
const KO_BREATH_CYCLES = 1;

function knockedOut(phase: number): CatPose {
  const breath = Math.sin(phase * TWO_PI * KO_BREATH_CYCLES);
  const rest = restPose();
  return {
    ...rest,
    roll: KO_ROLL,
    sway: 0.02,
    bob: KO_BODY_DROP,
    squash: KO_FLATTEN + 0.012 * breath,
    breathe: breath,
    headX: -0.05,
    headY: 0.115,
    headTilt: deg(32),
    headBow: 0.15,
    earL: -1,
    earR: -1,
    eyeOpen: 0,
    pupil: 0.2,
    mouth: 0.12,
    tongue: 0.4 + 0.05 * breath,
    tail: tail(SIDE_TAIL_BASE, KO_TAIL_CURL, 0.12, phase * TWO_PI, 0, 0.12 * breath),
    frontR: paw(0.14, 0.015 + 0.004 * breath, 0),
    frontL: paw(0.19, -0.01, 0),
    hindR: paw(0.02, 0.02 + 0.004 * breath, 0),
    hindL: paw(0.07, -0.005, 0),
    shadow: 1.25,
    time: phase,
  };
}

// ── Level-up dance ───────────────────────────────────────────────────────────

const DANCE_BOUNCES = 2;
const DANCE_PAW_RISE = 0.42;
/** Paws pump outward as well as up, clear of the cream bib. */
const DANCE_PAW_SPREAD = 0.09;
/** Roots the raised tail outboard of the flank so it clears the silhouette. */
const DANCE_TAIL_ROOT_X = 0.11;

function dance(phase: number): CatPose {
  const angle = phase * TWO_PI * DANCE_BOUNCES;
  const up = Math.sin(angle);
  const rest = restPose();
  const leftLift = clamp01(up);
  const rightLift = clamp01(-up);
  return {
    ...rest,
    bob: -0.022 * Math.abs(up),
    sway: 0.016 * up,
    lean: deg(4) * up,
    squash: 1 - 0.05 * clamp01(-Math.abs(up) + 0.35),
    headY: -0.01 * Math.abs(up),
    headTilt: deg(7) * up,
    headTurn: 0.12 * up,
    earL: 1,
    earR: 1,
    eyeOpen: 0.45 + 0.12 * Math.abs(up),
    pupil: 0.95,
    mouth: 0.35,
    tongue: 0.2,
    tail: tail(deg(-62), -0.3, 0.5, angle * 2, 0.6, 0.5 * Math.sin(angle * 3), DANCE_TAIL_ROOT_X),
    frontL: paw(-DANCE_PAW_SPREAD * leftLift, -DANCE_PAW_RISE * leftLift, leftLift),
    frontR: paw(DANCE_PAW_SPREAD * rightLift, -DANCE_PAW_RISE * rightLift, rightLift),
    hindL: paw(0, -0.01 * rightLift, 0),
    hindR: paw(0, -0.01 * leftLift, 0),
    sparkle: 1,
    time: phase,
  };
}

// ── Sheet assembly ───────────────────────────────────────────────────────────

type View = 'front' | 'side' | 'back';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: View;
  readonly pose: (t: number) => CatPose;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

export const ROWS: readonly RowSpec[] = [
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    view: 'front',
    pose: (f) => walkFront(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_side',
    frameCount: WALK_FRAMES,
    view: 'side',
    pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: WALK_FRAMES,
    view: 'back',
    pose: (f) => walkBack(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'idle',
    frameCount: IDLE_FRAMES,
    view: 'front',
    pose: (f) => idleFront(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_side',
    frameCount: IDLE_FRAMES,
    view: 'side',
    pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_away',
    frameCount: IDLE_FRAMES,
    view: 'back',
    pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'look_around',
    frameCount: BREAK_FRAMES,
    view: 'front',
    pose: (f) => lookAround(shotProgress(f, BREAK_FRAMES)),
  },
  {
    name: 'groom_paw',
    frameCount: BREAK_FRAMES,
    view: 'front',
    pose: (f) => groomPaw(shotProgress(f, BREAK_FRAMES)),
  },
  {
    name: 'groom_flank',
    frameCount: BREAK_FRAMES,
    view: 'front',
    pose: (f) => groomFlank(shotProgress(f, BREAK_FRAMES)),
  },
  {
    name: 'swipe',
    frameCount: ACTION_FRAMES,
    view: 'front',
    pose: (f) => swipeFront(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'swipe_side',
    frameCount: ACTION_FRAMES,
    view: 'side',
    pose: (f) => swipeSide(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'swipe_away',
    frameCount: ACTION_FRAMES,
    view: 'back',
    pose: (f) => swipeBack(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'cast',
    frameCount: ACTION_FRAMES,
    view: 'front',
    pose: (f) => castFront(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'cast_side',
    frameCount: ACTION_FRAMES,
    view: 'side',
    pose: (f) => castSide(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'cast_away',
    frameCount: ACTION_FRAMES,
    view: 'back',
    pose: (f) => castBack(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'knocked_out',
    frameCount: KO_FRAMES,
    view: 'side',
    pose: (f) => knockedOut(cyclePhase(f, KO_FRAMES)),
  },
  {
    name: 'dance',
    frameCount: DANCE_FRAMES,
    view: 'front',
    pose: (f) => dance(cyclePhase(f, DANCE_FRAMES)),
  },
];

function drawView(ctx: Ctx, view: View, pose: CatPose): void {
  if (view === 'front') drawCatFront(ctx, pose);
  else if (view === 'back') drawCatBack(ctx, pose);
  else drawCatSide(ctx, pose);
}

function renderSheet(): Buffer {
  const cols = Math.max(...ROWS.map((r) => r.frameCount));
  const sheet = createCanvas(cols * FRAME_W, ROWS.length * FRAME_H);
  const sheetCtx = sheet.getContext('2d');

  const frame = createCanvas(FRAME_W * SUPERSAMPLE, FRAME_H * SUPERSAMPLE);
  const frameCtx = frame.getContext('2d');

  for (let row = 0; row < ROWS.length; row++) {
    const spec = ROWS[row];
    for (let col = 0; col < spec.frameCount; col++) {
      frameCtx.clearRect(0, 0, frame.width, frame.height);
      frameCtx.save();
      frameCtx.translate(ORIGIN_X * SUPERSAMPLE, ORIGIN_Y * SUPERSAMPLE);
      frameCtx.scale(TILE_SCALE * SUPERSAMPLE, TILE_SCALE * SUPERSAMPLE);
      frameCtx.translate(0, GROUND_Y);
      frameCtx.scale(CAT_SCALE, CAT_SCALE);
      frameCtx.translate(0, -GROUND_Y);
      drawView(frameCtx, spec.view, spec.pose(col));
      frameCtx.restore();
      sheetCtx.drawImage(
        frame,
        0,
        0,
        frame.width,
        frame.height,
        col * FRAME_W,
        row * FRAME_H,
        FRAME_W,
        FRAME_H,
      );
    }
  }

  return sheet.toBuffer('image/png');
}

export const SHEET_PATH = 'src/images/characters/cat.png';

function writeSheet(): void {
  const outPath = resolve(SHEET_PATH);
  console.log(
    `Generating cat sprite sheet (${FRAME_W}×${FRAME_H}px frames, tileScale=${TILE_SCALE})…`,
  );
  writeFileSync(outPath, renderSheet());

  const cols = Math.max(...ROWS.map((r) => r.frameCount));
  console.log(`  → ${outPath}`);
  console.log(
    `  → ${cols * FRAME_W}×${ROWS.length * FRAME_H}px  (${ROWS.length} rows × ${cols} cols)`,
  );
  ROWS.forEach((r, i) => {
    console.log(`     row ${i}: ${r.name} (${r.frameCount} frames, ${r.view})`);
  });
  console.log(`tileX=${TILE_X}  tileY=${TILE_Y}  tileScale=${TILE_SCALE}`);
}

// The review harness imports ROWS from here, so painting the sheet has to be
// something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheet();
}
