/**
 * A cat's moves through the world beyond walking and fighting: hopping up onto
 * a ledge and down off one and flattening through a gap, each in every view
 * she travels in; and, head-on, batting a thing off a ledge with a forepaw,
 * sniffing at a scent, reaching up to work a latch, straining at something for
 * as long as a channel lasts, and talking.
 *
 * A hop's height is the world's: the row is the crouch, the spring, the tuck
 * and the landing, and the draw lifts her from one footing's height to the
 * other across the row's airborne share ({@link HOP_AIRBORNE}).
 */

import {
  type CatPose,
  type PawPose,
  type TailPose,
  clamp01,
  deg,
  easeInOut,
  hump,
  lerp,
  ramp,
  restPose,
  TWO_PI,
} from './catArt';
import type { CardinalView } from '../facingView';

/** The share of a hop's row she is off the ground: the draw moves her between footings across it. */
export const HOP_AIRBORNE = { start: 0.34, end: 0.72 } as const;

/**
 * Tail carriage per view. Curl accumulates clockwise on screen, so a tail that
 * leaves to the right lifts its tip with a negative curl and one that leaves to
 * the left lifts with a positive one.
 */
export const VIEW_TAIL_BASE: Readonly<Record<CardinalView, number>> = {
  front: deg(-20),
  side: deg(-170),
  back: deg(-78),
};
const FRONT_TAIL_BASE = VIEW_TAIL_BASE.front;
const SIDE_TAIL_BASE = VIEW_TAIL_BASE.side;
const BACK_TAIL_BASE = VIEW_TAIL_BASE.back;

function paw(dx: number, dy: number, lift: number, claw = 0): PawPose {
  return { dx, dy, lift, claw };
}

function tail(base: number, curl: number, wave = 0, phase = 0, puff = 0, flick = 0): TailPose {
  return { base, curl, wave, phase, puff, flick, rootX: 0, rootY: 0, reach: 1 };
}

/**
 * The share of her body's bob her head and paws already follow head-on: the
 * painter keeps her feet near the ground through a bob, so a pose that leaves
 * the ground carries her paws and head the rest of the way itself.
 */
const HEAD_BOB_SHARE = 0.6;
const FOREPAW_BOB_SHARE = 0.25;
const HINDPAW_BOB_SHARE = 0.15;
/** Her floor shadow at the height of a hop: smaller and fainter. */
const AIRBORNE_SHADOW_SHRINK = 0.35;
const HOP_TOP_RISE = 0.15;

/** `pose` lifted `rise` tile units clear of the ground, every part of her with it. */
function airborne(pose: CatPose, rise: number, shadowShrink: number): CatPose {
  const lifted = (part: PawPose, share: number): PawPose => ({
    ...part,
    dy: part.dy - rise * (1 - share),
  });
  return {
    ...pose,
    bob: pose.bob - rise,
    headY: pose.headY - rise * (1 - HEAD_BOB_SHARE),
    frontL: lifted(pose.frontL, FOREPAW_BOB_SHARE),
    frontR: lifted(pose.frontR, FOREPAW_BOB_SHARE),
    hindL: lifted(pose.hindL, HINDPAW_BOB_SHARE),
    hindR: lifted(pose.hindR, HINDPAW_BOB_SHARE),
    shadow: pose.shadow * (1 - shadowShrink),
  };
}

// ── Hops ─────────────────────────────────────────────────────────────────────

interface HopShape {
  /** How low she sinks into the crouch before she springs. */
  readonly crouchDrop: number;
  readonly crouchSquash: number;
  /** Her forepaws at the top of the spring: up and reaching for a ledge, or down for the floor. */
  readonly reachDy: number;
  /** How far the landing drives her down into her legs. */
  readonly landDrop: number;
  readonly landSquash: number;
  /** Her head bowed to look where she is going. */
  readonly lookBow: number;
  /** In profile, how far her body tips along the spring: nose up onto a ledge, down off one. */
  readonly launchLean: number;
  /** In profile, her head tipped to eye the footing in the crouch. */
  readonly eyeTilt: number;
}

const HOP_UP_SHAPE: HopShape = {
  crouchDrop: 0.09,
  crouchSquash: 0.78,
  reachDy: -0.24,
  landDrop: 0.035,
  landSquash: 0.9,
  lookBow: 0,
  launchLean: deg(-12),
  eyeTilt: deg(-7),
};

const HOP_DOWN_SHAPE: HopShape = {
  crouchDrop: 0.055,
  crouchSquash: 0.84,
  reachDy: 0.04,
  landDrop: 0.09,
  landSquash: 0.76,
  lookBow: 0.55,
  launchLean: deg(13),
  eyeTilt: deg(9),
};

const HOP_STRETCH = 1.12;
const HOP_HIND_TUCK = -0.09;
/** In profile her forepaws reach out ahead of her chest for the footing, and her hind paws drive back off the floor. */
const HOP_SIDE_REACH = 0.13;
const HOP_SIDE_HIND_PUSH = 0.07;
const HOP_SIDE_HIND_TUCK_FORWARD = 0.06;
const HOP_SIDE_CROUCH_SWAY = -0.03;
const HOP_SIDE_STRETCH_SWAY = 0.03;
/**
 * Her body pitches along the spring over the whole flight, starting this share
 * of the row before she leaves the floor, rather than with the launch's brief
 * stretch: tied to that, the pitch comes and goes inside a single frame.
 */
const HOP_SIDE_PITCH_LEAD = 0.1;
/** Her forequarters take the landing, tipping her nose down into it. */
const HOP_SIDE_LAND_LEAN = deg(6);
/** The far forepaw trails the near one a little, so the pair reads as two legs. */
const FAR_PAW_TRAIL = 0.75;

interface HopPhases {
  readonly crouched: number;
  readonly launch: number;
  readonly stretch: number;
  readonly reach: number;
  readonly tuck: number;
  readonly land: number;
  readonly airborneShare: number;
  readonly squash: number;
}

function hopPhases(progress: number, shape: HopShape): HopPhases {
  const crouch = easeInOut(ramp(progress, 0, HOP_AIRBORNE.start - 0.04));
  const launch = ramp(progress, HOP_AIRBORNE.start - 0.06, HOP_AIRBORNE.start + 0.06);
  const flight = ramp(progress, HOP_AIRBORNE.start, HOP_AIRBORNE.end);
  const land = hump(ramp(progress, HOP_AIRBORNE.end - 0.02, 0.96));
  const airborneShare = hump(flight);
  const springing = 1 - ramp(progress, HOP_AIRBORNE.start, HOP_AIRBORNE.start + 0.08);
  const crouched = crouch * springing;
  const stretch = hump(launch) * (1 - flight * 0.6);
  const reach = easeInOut(ramp(progress, HOP_AIRBORNE.start - 0.04, 0.5)) * (1 - land);
  const squash =
    lerp(1, shape.crouchSquash, crouched) *
    lerp(1, HOP_STRETCH, stretch) *
    lerp(1, shape.landSquash, land);
  return { crouched, launch, stretch, reach, tuck: airborneShare, land, airborneShare, squash };
}

/** Everything about a hop that every view shares: the drop into the crouch and landing, her ears and eyes. */
function hopBody(progress: number, shape: HopShape, h: HopPhases): CatPose {
  return {
    ...restPose(),
    bob: shape.crouchDrop * h.crouched + shape.landDrop * h.land,
    squash: h.squash,
    breathe: 0,
    headY: 0.02 * h.crouched - 0.02 * h.stretch,
    headBow: lerp(0.15, shape.lookBow, h.crouched) * (1 - h.stretch) + 0.3 * h.land,
    earL: lerp(0.4, 0.8, h.crouched),
    earR: lerp(0.4, 0.8, h.crouched),
    eyeOpen: 1,
    pupil: lerp(0.55, 0.85, h.crouched),
    time: progress,
  };
}

/**
 * Anticipation, spring, tuck and landing: she sinks onto her haunches eyeing
 * the footing, launches long, forepaws reaching, tucks her hind paws under her
 * in the air, lands forepaws first and sinks into the landing before standing.
 */
function hopFront(progress: number, shape: HopShape): CatPose {
  const h = hopPhases(progress, shape);
  const standing: CatPose = {
    ...hopBody(progress, shape, h),
    tail: tail(
      lerp(FRONT_TAIL_BASE, deg(-40), h.stretch),
      lerp(1.4, 0.6, h.stretch),
      0.1,
      0,
      0,
      -0.5 * h.stretch,
    ),
    frontL: paw(-0.01 * h.reach, shape.reachDy * h.reach, h.reach),
    frontR: paw(0.01 * h.reach, shape.reachDy * h.reach, h.reach),
    hindL: paw(0.02 * h.tuck, HOP_HIND_TUCK * h.tuck, h.tuck),
    hindR: paw(-0.02 * h.tuck, HOP_HIND_TUCK * h.tuck, h.tuck),
  };
  return airborne(
    standing,
    HOP_TOP_RISE * h.airborneShare,
    AIRBORNE_SHADOW_SHRINK * h.airborneShare,
  );
}

/**
 * The same hop in profile: weight rocked back over her haunches, eyes on the
 * footing, then the body tips into the spring along the way she is going,
 * forepaws stretched out ahead and hind paws thrown back, tucked under her in
 * the air, and her nose dips as her forepaws take the landing.
 */
function hopSide(progress: number, shape: HopShape): CatPose {
  const h = hopPhases(progress, shape);
  const push = h.launch * (1 - h.tuck);
  const hindDx = -HOP_SIDE_HIND_PUSH * push + HOP_SIDE_HIND_TUCK_FORWARD * h.tuck;
  const hindDy = HOP_HIND_TUCK * h.tuck;
  const foreDx = HOP_SIDE_REACH * h.reach;
  const foreDy = shape.reachDy * h.reach;
  const pitch = hump(ramp(progress, HOP_AIRBORNE.start - HOP_SIDE_PITCH_LEAD, HOP_AIRBORNE.end));
  const standing: CatPose = {
    ...hopBody(progress, shape, h),
    sway: HOP_SIDE_CROUCH_SWAY * h.crouched + HOP_SIDE_STRETCH_SWAY * pitch,
    lean: shape.launchLean * pitch + HOP_SIDE_LAND_LEAN * h.land,
    headTilt: shape.eyeTilt * h.crouched * (1 - h.stretch),
    tail: tail(SIDE_TAIL_BASE, lerp(1.3, 0.85, h.airborneShare), 0.1, 0, 0, 0.2 * h.airborneShare),
    frontR: paw(foreDx, foreDy, h.reach),
    frontL: paw(foreDx * FAR_PAW_TRAIL, foreDy * FAR_PAW_TRAIL, h.reach * FAR_PAW_TRAIL),
    hindR: paw(hindDx, hindDy, h.tuck),
    hindL: paw(hindDx * FAR_PAW_TRAIL, hindDy, h.tuck),
  };
  return airborne(
    standing,
    HOP_TOP_RISE * h.airborneShare,
    AIRBORNE_SHADOW_SHRINK * h.airborneShare,
  );
}

/**
 * From behind her haunches are the largest thing on screen, so the crouch's
 * drop and squash and the spring's stretch read at a fraction of their
 * head-on depth; at full depth the launch is a single-frame jump of her whole
 * rump.
 */
const HOP_BACK_DEPTH_SHARE = 0.5;

/**
 * The hop from behind: the crouch and the landing read in her haunches, her
 * hind paws tuck up under her in the air, and her tail streams up behind.
 * Her forepaws are hidden by her body from here, as in her walk away.
 */
function hopBack(progress: number, shape: HopShape): CatPose {
  const h = hopPhases(progress, shape);
  const body = hopBody(progress, shape, h);
  const standing: CatPose = {
    ...body,
    bob: shape.crouchDrop * h.crouched * HOP_BACK_DEPTH_SHARE + shape.landDrop * h.land,
    squash: lerp(1, body.squash, HOP_BACK_DEPTH_SHARE),
    tail: tail(
      BACK_TAIL_BASE,
      lerp(-0.5, -0.35, h.airborneShare),
      0.1,
      0,
      0.1,
      0.15 * h.airborneShare,
    ),
    hindL: paw(-0.02 * h.tuck, HOP_HIND_TUCK * h.tuck, h.tuck),
    hindR: paw(0.02 * h.tuck, HOP_HIND_TUCK * h.tuck, h.tuck),
  };
  return airborne(
    standing,
    HOP_TOP_RISE * h.airborneShare,
    AIRBORNE_SHADOW_SHRINK * h.airborneShare,
  );
}

/** A move she makes in every view she travels in, by view. */
export type ViewedMove = Readonly<Record<CardinalView, (progress: number) => CatPose>>;

export const HOP_UP: ViewedMove = {
  front: (progress) => hopFront(progress, HOP_UP_SHAPE),
  side: (progress) => hopSide(progress, HOP_UP_SHAPE),
  back: (progress) => hopBack(progress, HOP_UP_SHAPE),
};

export const HOP_DOWN: ViewedMove = {
  front: (progress) => hopFront(progress, HOP_DOWN_SHAPE),
  side: (progress) => hopSide(progress, HOP_DOWN_SHAPE),
  back: (progress) => hopBack(progress, HOP_DOWN_SHAPE),
};

// ── Squeeze ──────────────────────────────────────────────────────────────────

const SQUEEZE_SQUASH = 0.58;
const SQUEEZE_DROP = 0.1;
const SQUEEZE_STEPS = 2;
const SQUEEZE_PAW_LIFT = 0.07;
const SQUEEZE_PAW_SPREAD = 0.03;

/**
 * Flattened belly to the floor, ears pinned, she pulls herself through on
 * her forepaws, one then the other, and rises back to her full height.
 */
function squeezeFront(progress: number): CatPose {
  const flatten = easeInOut(ramp(progress, 0, 0.3)) * (1 - easeInOut(ramp(progress, 0.62, 1)));
  const crawl = ramp(progress, 0.22, 0.7);
  const stroke = crawl * SQUEEZE_STEPS * TWO_PI;
  const leftLift = Math.max(0, Math.sin(stroke)) * flatten;
  const rightLift = Math.max(0, -Math.sin(stroke)) * flatten;
  const rest = restPose();
  return {
    ...rest,
    bob: SQUEEZE_DROP * flatten,
    squash: lerp(1, SQUEEZE_SQUASH, flatten),
    sway: 0.012 * Math.sin(stroke) * flatten,
    breathe: 0,
    headY: 0.07 * flatten,
    headBow: 0.35 * flatten,
    headTilt: deg(3) * Math.sin(stroke) * flatten,
    earL: lerp(0.3, -0.95, flatten),
    earR: lerp(0.3, -0.95, flatten),
    eyeOpen: lerp(1, 0.7, flatten),
    pupil: lerp(0.55, 0.9, flatten),
    tail: tail(lerp(FRONT_TAIL_BASE, deg(10), flatten), lerp(1.4, 0.3, flatten), 0.15, stroke),
    frontL: paw(-SQUEEZE_PAW_SPREAD * flatten, -SQUEEZE_PAW_LIFT * leftLift, leftLift * 0.6),
    frontR: paw(SQUEEZE_PAW_SPREAD * flatten, -SQUEEZE_PAW_LIFT * rightLift, rightLift * 0.6),
    time: progress,
  };
}

/** In profile each forepaw reaches out ahead of her chest and drags her through. */
const SQUEEZE_SIDE_REACH = 0.1;
const SQUEEZE_SIDE_HIND_DRAG = 0.04;

/** The squeeze in profile: flattened along the floor, forepaws reaching out ahead in turn. */
function squeezeSide(progress: number): CatPose {
  const front = squeezeFront(progress);
  const flatten = easeInOut(ramp(progress, 0, 0.3)) * (1 - easeInOut(ramp(progress, 0.62, 1)));
  const stroke = ramp(progress, 0.22, 0.7) * SQUEEZE_STEPS * TWO_PI;
  const nearReach = Math.sin(stroke) * flatten;
  return {
    ...front,
    sway: 0.015 * Math.sin(stroke) * flatten,
    headTilt: 0,
    headBow: 0.2 * flatten,
    tail: tail(SIDE_TAIL_BASE, lerp(1.3, 0.25, flatten), 0.15, stroke),
    frontR: paw(
      SQUEEZE_SIDE_REACH * nearReach,
      -SQUEEZE_PAW_LIFT * Math.max(0, nearReach),
      Math.max(0, nearReach) * 0.6,
    ),
    frontL: paw(
      -SQUEEZE_SIDE_REACH * nearReach,
      -SQUEEZE_PAW_LIFT * Math.max(0, -nearReach),
      Math.max(0, -nearReach) * 0.6,
    ),
    hindR: paw(-SQUEEZE_SIDE_HIND_DRAG * flatten, 0, 0),
    hindL: paw(-SQUEEZE_SIDE_HIND_DRAG * flatten, 0, 0),
  };
}

/** The squeeze from behind: her haunches and tail low, hind paws pushing in turn. */
function squeezeBack(progress: number): CatPose {
  const front = squeezeFront(progress);
  const flatten = easeInOut(ramp(progress, 0, 0.3)) * (1 - easeInOut(ramp(progress, 0.62, 1)));
  const stroke = ramp(progress, 0.22, 0.7) * SQUEEZE_STEPS * TWO_PI;
  const leftLift = Math.max(0, -Math.sin(stroke)) * flatten;
  const rightLift = Math.max(0, Math.sin(stroke)) * flatten;
  return {
    ...front,
    tail: tail(BACK_TAIL_BASE, lerp(-0.5, -0.1, flatten), 0.15, stroke, 0, 0),
    frontL: paw(0, 0, 0),
    frontR: paw(0, 0, 0),
    hindL: paw(-SQUEEZE_PAW_SPREAD * flatten, -SQUEEZE_PAW_LIFT * leftLift, leftLift * 0.6),
    hindR: paw(SQUEEZE_PAW_SPREAD * flatten, -SQUEEZE_PAW_LIFT * rightLift, rightLift * 0.6),
  };
}

export const SQUEEZE: ViewedMove = {
  front: squeezeFront,
  side: squeezeSide,
  back: squeezeBack,
};

// ── Talk ─────────────────────────────────────────────────────────────────────

/** How wide her jaw drops on the strongest syllable: a mew, never a cartoon mouth. */
const TALK_MOUTH_OPEN = 0.62;
/** Syllables per loop of the row. */
const TALK_SYLLABLES = 2;
/** How much weaker the second syllable is than the first, so the loop is not a metronome. */
const TALK_SYLLABLE_ACCENT = 0.3;
const TALK_HEAD_TILT = deg(7);
const TALK_CHIN_LIFT = 0.18;
const TALK_JAW_DIP = 0.008;
const TALK_EAR_REST = 0.45;
const TALK_EAR_FLICK = 0.2;

/**
 * Talking to someone: a slow, curious tilt of the head over the loop, her jaw
 * dropping on two syllables of different weight, chin lifting a little into
 * each, and one ear flicking toward the one she is talking to. Laid over the
 * view's idle, so she keeps breathing and blinking through it.
 */
export function talkOver(idle: CatPose, phase: number): CatPose {
  const angle = phase * TWO_PI;
  const syllable = 0.5 - 0.5 * Math.cos(angle * TALK_SYLLABLES);
  const accent = 1 - TALK_SYLLABLE_ACCENT + TALK_SYLLABLE_ACCENT * Math.sin(angle);
  const open = syllable * accent;
  const flick = Math.max(0, Math.sin(angle)) ** 2;
  return {
    ...idle,
    headTilt: TALK_HEAD_TILT * Math.sin(angle),
    headBow: -TALK_CHIN_LIFT * open,
    headY: idle.headY + TALK_JAW_DIP * open,
    earL: TALK_EAR_REST + TALK_EAR_FLICK * flick,
    earR: TALK_EAR_REST - TALK_EAR_FLICK * 0.5 * flick,
    mouth: TALK_MOUTH_OPEN * open,
  };
}

// ── Paw bat ──────────────────────────────────────────────────────────────────

const BAT_RAISED_Y = -0.6;
const BAT_REACH_X = 0.2;
const BAT_SWAT_X = -0.2;
const BAT_SWAT_Y = -0.42;

/**
 * Sat up, eyes on the thing, she raises a forepaw high, gives it a trial tap,
 * then swats it hard across and lets the paw drop.
 */
export function pawBat(progress: number): CatPose {
  const sitUp = easeInOut(ramp(progress, 0, 0.2)) * (1 - easeInOut(ramp(progress, 0.88, 1)));
  const raise = easeInOut(ramp(progress, 0.06, 0.3));
  const tap = hump(ramp(progress, 0.32, 0.46));
  const swat = easeInOut(ramp(progress, 0.52, 0.66));
  const drop = easeInOut(ramp(progress, 0.7, 0.92));
  const up = raise * (1 - drop);
  const pawX = lerp(lerp(0.03, BAT_REACH_X, raise) + 0.03 * tap, BAT_SWAT_X, swat) * (1 - drop);
  const pawY = lerp(BAT_RAISED_Y + 0.06 * tap, BAT_SWAT_Y, swat) * up;
  const rest = restPose();
  return {
    ...rest,
    sit: 0.7 * sitUp,
    breathe: 0,
    lean: deg(-3) * raise + deg(7) * swat * (1 - drop),
    headTilt: deg(10) * raise * (1 - swat) - deg(6) * swat * (1 - drop),
    headTurn: 0.3 * up - 0.5 * swat * (1 - drop),
    headBow: 0.2 * up,
    earL: 0.9 * up,
    earR: 0.9 * up,
    eyeOpen: 1,
    pupil: lerp(0.55, 1, up),
    tail: tail(FRONT_TAIL_BASE, 1.2, 0.5, progress * TWO_PI * 2, 0, 0.8 * tap - 0.6 * swat),
    frontR: paw(pawX, pawY, up, lerp(0.2, 1, swat) * up),
    frontL: paw(-0.01, 0, 0),
    time: progress,
  };
}

// ── Sniff ────────────────────────────────────────────────────────────────────

const SNIFF_TWITCH_RATE = 9;
const SNIFF_SWEEP_RATE = 1.5;

/**
 * Nose down to the floor, she works the scent with quick twitches of the
 * muzzle and a slow sweep side to side, then lifts her head.
 */
export function sniff(progress: number): CatPose {
  const down = easeInOut(ramp(progress, 0, 0.2)) * (1 - easeInOut(ramp(progress, 0.84, 1)));
  const working = ramp(progress, 0.18, 0.84);
  const twitch = Math.max(0, Math.sin(progress * TWO_PI * SNIFF_TWITCH_RATE)) * down;
  const sweep = Math.sin(working * TWO_PI * SNIFF_SWEEP_RATE) * down;
  const rest = restPose();
  return {
    ...rest,
    bob: 0.025 * down,
    lean: deg(2) * sweep,
    breathe: twitch,
    headBow: 0.95 * down,
    headY: 0.09 * down + 0.006 * twitch,
    headX: 0.03 * sweep,
    headTurn: 0.25 * sweep,
    headTilt: deg(5) * sweep,
    earL: lerp(0.3, 0.75, down),
    earR: lerp(0.3, 0.75, down),
    eyeOpen: lerp(1, 0.55, down),
    pupil: 0.6,
    mouth: 0.05 * twitch,
    tail: tail(
      FRONT_TAIL_BASE,
      1.5,
      0.2,
      progress * TWO_PI,
      0,
      0.4 * Math.sin(progress * TWO_PI * 2),
    ),
    frontL: paw(-0.01 * down, 0, 0),
    frontR: paw(0.01 * down, 0, 0),
    time: progress,
  };
}

// ── Latch paw ────────────────────────────────────────────────────────────────

const LATCH_REACH_Y = -0.86;
const LATCH_REACH_X = 0.17;
const LATCH_TUG_Y = 0.07;
const LATCH_TUGS = 2;

/**
 * Up on her hind legs against whatever holds the latch, one forepaw stretched
 * as high as it goes, claws hooked, and two tugs down on it before she drops.
 */
export function latchPaw(progress: number): CatPose {
  const rise = easeInOut(ramp(progress, -0.04, 0.36)) * (1 - easeInOut(ramp(progress, 0.66, 1.04)));
  const working = ramp(progress, 0.34, 0.66);
  const tug = Math.max(0, Math.sin(working * TWO_PI * LATCH_TUGS)) * rise;
  const rest = restPose();
  return {
    ...rest,
    sit: 0.85 * rise,
    bob: -0.04 * rise + 0.015 * tug,
    lean: deg(-4) * rise,
    squash: lerp(1, 1.08, rise),
    breathe: 0,
    headY: -0.03 * rise + 0.01 * tug,
    headTilt: deg(-8) * rise,
    headTurn: 0.15 * rise,
    earL: 0.7 * rise,
    earR: 0.7 * rise,
    eyeOpen: 1,
    pupil: lerp(0.55, 0.8, rise),
    tail: tail(FRONT_TAIL_BASE, lerp(1.4, 1.9, rise), 0.25, progress * TWO_PI, 0, 0.3 * tug),
    frontR: paw(LATCH_REACH_X * rise, (LATCH_REACH_Y + LATCH_TUG_Y * tug) * rise, rise, rise),
    frontL: paw(-0.02 * rise, -0.18 * rise, 0.5 * rise, 0.3 * rise),
    time: progress,
  };
}

// ── Channel ──────────────────────────────────────────────────────────────────

const CHANNEL_QUIVER_RATE = 4;
const CHANNEL_QUIVER = 0.006;
const CHANNEL_DROP = 0.045;
const CHANNEL_SQUASH = 0.88;

/**
 * Braced low, forepaws planted wide and claws dug in, ears back and eyes
 * screwed up, her whole body trembling with the strain. A loop: she holds it
 * for as long as the channel runs.
 */
export function channel(phase: number): CatPose {
  const angle = phase * TWO_PI;
  const quiver = Math.sin(angle * CHANNEL_QUIVER_RATE);
  const heave = 0.5 + 0.5 * Math.sin(angle);
  const rest = restPose();
  return {
    ...rest,
    bob: CHANNEL_DROP + 0.01 * heave,
    sway: CHANNEL_QUIVER * quiver,
    squash: CHANNEL_SQUASH - 0.03 * heave,
    breathe: heave,
    headY: 0.03,
    headBow: 0.4 + 0.1 * heave,
    headTilt: deg(2) * quiver,
    earL: -0.75,
    earR: -0.75,
    eyeOpen: lerp(0.3, 0.15, heave),
    pupil: 0.3,
    mouth: 0.25 + 0.15 * heave,
    tail: tail(FRONT_TAIL_BASE, 0.9, 0.1, angle, clamp01(0.5 + 0.2 * heave), 0.2 * quiver),
    frontL: paw(-0.05, 0.02, 0.1, 1),
    frontR: paw(0.05, 0.02, 0.1, 1),
    hindL: paw(-0.02, 0, 0),
    hindR: paw(0.02, 0, 0),
    time: phase,
  };
}
