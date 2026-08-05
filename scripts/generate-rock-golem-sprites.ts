#!/usr/bin/env tsx
/**
 * Bakes the two rock-golem sprite sheets — `rock_golem` (the club's bouncers,
 * the hired bruiser and the bounty bodyguard) and `rock_golem_boss` (the bounty
 * target, bigger and with the boulder-roll rows) — plus the thrown-rock effect
 * sheets.
 *
 * The anatomy and the painting live in `scripts/rockGolemArt.ts`; this file is
 * only the choreography, the bake gates and the layout. Both variants come out
 * of one row table on purpose: Ryan's requirement is that the boss, the regular
 * golem and the hired meat shield share their animations and attacks, and one
 * table is the only way that stays true after the next edit.
 *
 * The frame cell is *measured* from the painted ink rather than declared — a
 * golem with both fists overhead is nearly a tile taller than one standing, and
 * a hand-guessed cell is how the top of a raised slam ends up sheared flat.
 *
 * Nothing reaches disk until every gate passes: a sheet whose manifest, anchor
 * or motion is wrong renders as garbage in a way no typecheck can see.
 *
 * Run: npm run gen:rock-golem
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx, type Canvas } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  FIGURE_HEIGHT,
  FIST_RADIUS,
  GROUND_Y,
  SHIN_REACH,
  THIGH_REACH,
  TWO_PI,
  type BallPose,
  type GolemArmPose,
  type GolemLegPose,
  type GolemPose,
  type GolemVariant,
  type GolemView,
  clamp01,
  contactShadowDrop,
  deg,
  drawGolem,
  drawGolemBall,
  drawGolemCurled,
  drawRockBurst,
  drawThrownRock,
  easeIn,
  easeInOut,
  easeOut,
  golemArmChain,
  golemFootPoint,
  golemHipPoint,
  hump,
  lerp,
  ramp,
  restPose,
  rockGolemRubblePieces,
} from './rockGolemArt.js';
// The attack timings are shared with the runtime rather than copied here; see
// that module's header for what breaks when the two drift.
import {
  GOLEM_SLAM_FRAMES,
  GOLEM_SLAM_IMPACT_PROGRESS,
  GOLEM_STOMP_FRAMES,
  GOLEM_STOMP_IMPACT_PROGRESS,
  GOLEM_THROW_FRAMES,
  GOLEM_THROW_RELEASE_PROGRESS,
  golemSlamImpactFrame,
  golemStompImpactFrame,
  golemThrowReleaseFrame,
} from '../src/sprites/rockGolemTiming.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 40;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** Clear pixels kept between the furthest ink and the frame edge. */
const FRAME_PADDING = 5;
/** Frame dimensions are rounded up to this so the sheet stays tidily aligned. */
const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;

/**
 * How tall each variant stands, in tiles. A regular golem is a two-tile slab of
 * a thing; the boss is the same creature grown half a tile, which is as much
 * size difference as reads at a 32 px tile before he stops fitting through gaps.
 */
const VARIANT_TILE_HEIGHT: Record<GolemVariant, number> = { regular: 2, boss: 2.5 };

function variantScale(variant: GolemVariant): number {
  return VARIANT_TILE_HEIGHT[variant] / FIGURE_HEIGHT;
}

const WALK_FRAMES = 12;
const IDLE_FRAMES = 8;
const CURL_FRAMES = 8;
const ROLL_FRAMES = 8;
const STUNNED_FRAMES = 8;

// ── Pose helpers ─────────────────────────────────────────────────────────────

function leg(fore: number, lift: number, splay = 0): GolemLegPose {
  return { fore, splay, lift };
}

function arm(swing: number, bend: number, flare: number, clench: number): GolemArmPose {
  return { swing, bend, flare, clench };
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

/**
 * Deepest the hips drop in a squat, in tile units. Bounded by leg reach: at the
 * bottom of the crouch the hip-to-ankle span has to stay inside the two bones,
 * and gate G7 proves it does on every frame of every row.
 */
const MAX_CROUCH = 0.5;

// ── Walk ─────────────────────────────────────────────────────────────────────

/**
 * Fraction of the stride a foot spends in the air. Short, because a golem picks
 * a foot up and puts it straight back down — a long float is what makes a heavy
 * figure read as light.
 */
const WALK_SWING_SHARE = 0.34;
const WALK_REACH = 0.19;
const WALK_LIFT = 0.11;
/** How far the body drops onto each footfall. The whole gait is this. */
const WALK_LAND_DROP = 0.035;
/** How long a landing's weight-drop takes to recover, in cycle phase. */
const WALK_LAND_DECAY = 0.24;
const WALK_ARM_SWING = deg(15);
const WALK_LEAN = deg(4);
const WALK_TWIST = 0.35;

function gaitFoot(phase: number, reach: number, lift: number): GolemLegPose {
  const cycle = ((phase % 1) + 1) % 1;
  const swinging = cycle < WALK_SWING_SHARE;
  const t = swinging
    ? cycle / WALK_SWING_SHARE
    : (cycle - WALK_SWING_SHARE) / (1 - WALK_SWING_SHARE);
  // Through stance the planted foot tracks backward at a constant rate, which is
  // the body moving forward over it. Gate G6 holds that monotone.
  const fore = swinging ? lerp(-reach, reach, easeInOut(t)) : lerp(reach, -reach, t);
  return { fore, splay: 0, lift: swinging ? hump(t) * lift : 0 };
}

/** 1 the instant a foot lands, decaying to 0; drives the weight drop and dust. */
function landPulse(phase: number, at: number): number {
  const since = (((phase - at) % 1) + 1) % 1;
  return since < WALK_LAND_DECAY ? 1 - since / WALK_LAND_DECAY : 0;
}

function walkPose(phase: number): GolemPose {
  const legR = gaitFoot(phase, WALK_REACH, WALK_LIFT);
  const legL = gaitFoot(phase + 0.5, WALK_REACH, WALK_LIFT);
  const landR = landPulse(phase, WALK_SWING_SHARE);
  const landL = landPulse(phase, WALK_SWING_SHARE + 0.5);
  const rest = restPose();
  return {
    ...rest,
    // Two drops per cycle, one per footfall: the body falls onto the weight and
    // is shoved back up, rather than floating on a sine wave.
    bob: WALK_LAND_DROP * Math.max(landR, landL),
    lean: WALK_LEAN,
    twist: (WALK_TWIST * (legR.fore - legL.fore)) / (WALK_REACH * 2),
    headSink: 0.5,
    coreGlow: 0.45 + 0.15 * Math.sin(phase * TWO_PI),
    // Arms counterswing their own-side leg; heavy stone arms barely move.
    armR: arm(-WALK_ARM_SWING * (legR.fore / WALK_REACH), deg(16), deg(11), 0.75),
    armL: arm(-WALK_ARM_SWING * (legL.fore / WALK_REACH), deg(16), deg(11), 0.75),
    legR,
    legL,
    dustR: landR,
    dustL: landL,
    time: phase,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

const IDLE_SWAY = 0.018;
const IDLE_BOB = 0.008;
/**
 * The grinding micro-shift. A golem at rest is not breathing — the only thing
 * that separates it from a statue is stone settling against stone, so the idle
 * is a slow weight transfer plus one shoulder grind per cycle.
 */
const IDLE_GRIND_CYCLES = 3;
const IDLE_GRIND_TWIST = 0.14;

function idlePose(phase: number): GolemPose {
  const angle = phase * TWO_PI;
  const rest = restPose();
  const grind = Math.sin(angle * IDLE_GRIND_CYCLES);
  return {
    ...rest,
    sway: IDLE_SWAY * Math.sin(angle),
    bob: IDLE_BOB * (1 - Math.cos(angle)) * 0.5,
    twist: IDLE_GRIND_TWIST * grind,
    headTurn: 0.2 * Math.sin(angle),
    headPitch: deg(2) * grind,
    headSink: 0.35 + 0.1 * Math.sin(angle),
    eyeGlow: 0.85 + 0.15 * Math.sin(angle * 2),
    coreGlow: 0.45 + 0.25 * Math.sin(angle),
    armR: arm(deg(2) * grind, deg(15), deg(10), 0.7),
    armL: arm(-deg(2) * grind, deg(15), deg(11), 0.7),
    legR: leg(0.01 * Math.sin(angle), 0),
    legL: leg(-0.01 * Math.sin(angle), 0),
    time: phase,
  };
}

// ── Slam ─────────────────────────────────────────────────────────────────────

const SLAM_RAISE_END = 0.42;
const SLAM_OVERHEAD_SWING = deg(-155);
/**
 * Where the fists are at impact: nearly straight down, barely ahead of the body.
 * Driven forward instead — which is what this was — the fists stop at chest
 * height and the attack reads as a shove with unexplained dust at the feet.
 */
const SLAM_STRIKE_SWING = deg(14);
const SLAM_RISE = -0.05;
/**
 * How far the hips drop onto the blow. A golem cannot reach the floor standing:
 * shoulder to knuckle is well under its own shoulder height, so the crouch is
 * what actually puts the fists on the ground, and gate G10 measures that it does.
 */
const SLAM_CROUCH = MAX_CROUCH;

function slamPose(progress: number): GolemPose {
  const raise = easeInOut(ramp(progress, 0, SLAM_RAISE_END));
  const drive = easeIn(ramp(progress, SLAM_RAISE_END, GOLEM_SLAM_IMPACT_PROGRESS));
  const recover = easeInOut(ramp(progress, GOLEM_SLAM_IMPACT_PROGRESS, 1));

  const swing = lerp(
    lerp(lerp(0, SLAM_OVERHEAD_SWING, raise), SLAM_STRIKE_SWING, drive),
    0,
    recover,
  );
  const bend = lerp(lerp(lerp(deg(14), deg(-22), raise), deg(6), drive), deg(14), recover);
  // The fists come together on the blow rather than spreading: it is a
  // double-fist slam, and the spread was also costing the reach G10 measures.
  const flare = lerp(lerp(lerp(deg(10), deg(4), raise), deg(8), drive), deg(10), recover);
  const clench = lerp(lerp(0.7, 1, raise), 0.7, recover);
  const impact = drive * (1 - recover);

  const rest = restPose();
  const bothArms = arm(swing, bend, flare, clench);
  return {
    ...rest,
    bob: SLAM_RISE * raise * (1 - drive),
    // The whole mass drops behind the fists rather than the body merely bowing.
    crouch: SLAM_CROUCH * impact,
    lean: lerp(lerp(lerp(0, deg(-11), raise), deg(20), drive), 0, recover),
    squash: 1 + 0.03 * raise * (1 - drive) - 0.03 * impact,
    headSink: lerp(0.2, 0.7, impact),
    headPitch: lerp(deg(-6) * raise, deg(10), drive),
    eyeGlow: lerp(0.9, 1, raise) + 0.4 * impact,
    coreGlow: lerp(0.4, 1, raise * (1 - recover)),
    armL: bothArms,
    armR: bothArms,
    legL: leg(-0.03 * impact, 0, 0.03 * impact),
    legR: leg(0.03 * impact, 0, 0.03 * impact),
    dustL: impact,
    dustR: impact,
    time: progress,
  };
}

// ── Stomp ────────────────────────────────────────────────────────────────────

const STOMP_RAISE_END = 0.42;
const STOMP_KNEE_LIFT = 0.42;
const STOMP_STEP_FORE = 0.12;
const STOMP_BRACE_FLARE = deg(38);

function stompPose(progress: number): GolemPose {
  const raise = easeInOut(ramp(progress, 0, STOMP_RAISE_END));
  const drive = easeIn(ramp(progress, STOMP_RAISE_END, GOLEM_STOMP_IMPACT_PROGRESS));
  const recover = easeInOut(ramp(progress, GOLEM_STOMP_IMPACT_PROGRESS, 1));
  const cocked = raise * (1 - drive);
  const impact = drive * (1 - recover);

  const rest = restPose();
  // The arms fling out for balance rather than doing anything of their own —
  // without them the raised leg reads as a kick instead of as a weight shift.
  const braceArm = (side: number): GolemArmPose =>
    arm(deg(-14) * cocked * side, deg(20 + 26 * cocked), deg(10) + STOMP_BRACE_FLARE * cocked, 0.7);

  return {
    ...rest,
    // The whole body rocks onto the standing leg before the other one comes up.
    sway: -0.07 * cocked,
    bob: -0.03 * cocked + 0.06 * impact,
    lean: deg(-9) * cocked + deg(8) * impact,
    twist: -0.3 * cocked,
    squash: 1 - 0.07 * impact,
    headSink: lerp(0.3, 0.75, impact),
    headPitch: deg(9) * impact,
    eyeGlow: 0.9 + 0.4 * impact,
    coreGlow: lerp(0.4, 0.95, cocked + impact),
    armL: braceArm(-1),
    armR: braceArm(1),
    legL: leg(0, 0, 0.02 * cocked),
    legR: leg(STOMP_STEP_FORE * cocked - 0.04 * impact, STOMP_KNEE_LIFT * cocked),
    dustR: impact,
    dustL: impact * 0.45,
    time: progress,
  };
}

// ── Rock throw ───────────────────────────────────────────────────────────────

const THROW_PICKUP_END = 0.3;
const THROW_RISE_END = 0.56;
const THROW_COCK_START = 0.5;
const THROW_COCK_END = 0.7;
const THROW_WHIP_START = 0.62;
const THROW_WHIP_END = 0.8;

const THROW_REACH_SWING = deg(12);
const THROW_CARRY_SWING = deg(-55);
const THROW_COCK_SWING = deg(-135);
const THROW_RELEASE_SWING = deg(70);
/**
 * How far the arms are drawn together while gripping. The boulder is painted on
 * the midpoint of the two fists, so this is what decides how big a rock the
 * golem can be seen to be holding.
 */
const THROW_GRIP_FLARE = deg(-24);
export const THROWN_ROCK_RADIUS = 0.24;
/**
 * How closed the grip must be before the boulder is drawn. The rock is painted
 * on the midpoint of the two fists, so showing it while the hands are still
 * wide leaves it floating in the gap between them — it appears on the frame the
 * hands close, which is also the readable "he's got it" beat.
 */
const GRIP_CLOSED = 0.92;

function throwPose(progress: number): GolemPose {
  const pickup = easeInOut(ramp(progress, 0, THROW_PICKUP_END));
  const rise = easeInOut(ramp(progress, THROW_PICKUP_END, THROW_RISE_END));
  const cock = easeInOut(ramp(progress, THROW_COCK_START, THROW_COCK_END));
  const whip = easeOut(ramp(progress, THROW_WHIP_START, THROW_WHIP_END));
  const settle = easeInOut(ramp(progress, THROW_WHIP_END, 1));

  const swing = lerp(
    lerp(lerp(lerp(0, THROW_REACH_SWING, pickup), THROW_CARRY_SWING, rise), THROW_COCK_SWING, cock),
    THROW_RELEASE_SWING,
    whip,
  );
  // The grip is held right through the heave and opens only on the follow
  // through — tying it to the whip instead drops the boulder before the frame
  // the runtime spawns the projectile on.
  const clasp = pickup * (1 - settle);
  const rest = restPose();
  const bothArms = arm(
    lerp(swing, 0, settle),
    lerp(lerp(deg(14), deg(-8), pickup), deg(-30), cock),
    lerp(deg(10), THROW_GRIP_FLARE, clasp),
    lerp(0.35, 0.95, clasp),
  );

  return {
    ...rest,
    crouch: MAX_CROUCH * pickup * (1 - rise),
    bob: 0,
    lean: lerp(lerp(lerp(0, deg(24), pickup), deg(-16), cock), deg(22), whip) * (1 - settle),
    squash: 1 - 0.03 * pickup * (1 - rise),
    headSink: lerp(0.35, 0.75, clasp),
    headPitch: deg(16) * pickup * (1 - rise) - deg(10) * cock,
    eyeGlow: 0.85 + 0.3 * whip * (1 - settle),
    coreGlow: 0.4 + 0.5 * cock,
    armL: bothArms,
    armR: bothArms,
    legL: leg(-0.08 * pickup, 0, 0.05 * pickup),
    legR: leg(0.08 * pickup, 0, 0.05 * pickup),
    // The rock is gone the instant the whip passes the shared release fraction,
    // so the sheet and the projectile spawn describe the same moment.
    rockRadius:
      clasp >= GRIP_CLOSED && progress < GOLEM_THROW_RELEASE_PROGRESS ? THROWN_ROCK_RADIUS : 0,
    dustL: 0,
    dustR: 0,
    time: progress,
  };
}

// ── Boss-only: curl, roll, uncurl, stunned ───────────────────────────────────

/** Radius of the curled boss, in the same authored tile units as the figure. */
const BALL_RADIUS = 0.62;
const CURL_SHELL_START = 0.32;

function tuckPose(tuck: number, time: number): GolemPose {
  const rest = restPose();
  const wrapped = arm(deg(34) * tuck, deg(78) * tuck + deg(14), deg(-34) * tuck + deg(10), 1);
  return {
    ...rest,
    crouch: MAX_CROUCH * tuck,
    lean: deg(30) * tuck,
    squash: 1 - 0.08 * tuck,
    headSink: lerp(0.35, 1, tuck),
    headPitch: deg(24) * tuck,
    coreGlow: lerp(0.4, 1, tuck),
    eyeGlow: lerp(1, 0.4, tuck),
    armL: wrapped,
    armR: wrapped,
    legL: leg(-0.09 * tuck, 0, 0.06 * tuck),
    legR: leg(0.09 * tuck, 0, 0.06 * tuck),
    time,
  };
}

function curlBall(progress: number): BallPose {
  return {
    spin: progress * TWO_PI * 0.4,
    closed: easeInOut(ramp(progress, CURL_SHELL_START, 1)),
    radius: BALL_RADIUS,
    debris: 0,
  };
}

function rollBall(phase: number): BallPose {
  return {
    spin: phase * TWO_PI,
    closed: 1,
    radius: BALL_RADIUS,
    // The grit thrown off the contact patch pulses with the rotation, which is
    // most of what stops a spinning symmetric ball reading as a still image.
    debris: 0.6 + 0.4 * Math.abs(Math.sin(phase * TWO_PI)),
  };
}

const STUN_LOLL = deg(18);
const STUN_SPRAWL_FORE = 0.3;

function stunnedPose(phase: number): GolemPose {
  const angle = phase * TWO_PI;
  const rest = restPose();
  const slack = (side: number): GolemArmPose =>
    arm(deg(24) + deg(6) * Math.sin(angle + side), deg(48), deg(26) * side + deg(8), 0.3);
  return {
    ...rest,
    crouch: MAX_CROUCH * 0.92,
    slump: 1,
    lean: deg(-14) + deg(3) * Math.sin(angle),
    squash: 0.94,
    headTurn: 0.5 * Math.sin(angle),
    headPitch: STUN_LOLL + deg(8) * Math.sin(angle * 2),
    headSink: 0.9,
    // The core gutters rather than pulsing: the lights are nearly out.
    eyeGlow: 0.18 + 0.14 * Math.abs(Math.sin(angle * 3)),
    coreGlow: 0.2 + 0.15 * Math.abs(Math.sin(angle * 2)),
    armL: slack(-1),
    armR: slack(1),
    legL: leg(STUN_SPRAWL_FORE, 0, 0.09),
    legR: leg(STUN_SPRAWL_FORE * 0.8, 0, 0.11),
    daze: 1,
    time: phase,
  };
}

// ── Row manifest ─────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: GolemView;
  /** `boss` rows are baked only into the boss sheet. */
  readonly variants: 'both' | 'boss';
  /** Null on rows the default figure painter does not drive (gore, ball). */
  readonly pose: ((t: number) => GolemPose) | null;
  /** Overrides the figure painter; used by the curl/roll/uncurl rows. */
  readonly paint?: (ctx: Ctx, frame: number, variant: GolemVariant) => void;
  /**
   * Frames whose jump from the one before is deliberate, so the continuity gate
   * does not have to be loosened for every row to allow one snap.
   */
  readonly declaredSpikes?: readonly number[];
}

function attackRows(
  base: string,
  frameCount: number,
  pose: (t: number) => GolemPose,
  declaredSpikes?: readonly number[],
): RowSpec[] {
  const views: readonly { suffix: string; view: GolemView }[] = [
    { suffix: '', view: 'front' },
    { suffix: '_side', view: 'side' },
    { suffix: '_away', view: 'back' },
  ];
  return views.map(({ suffix, view }) => ({
    name: `${base}${suffix}`,
    frameCount,
    kind: 'oneShot',
    view,
    variants: 'both',
    pose: (f) => pose(shotProgress(f, frameCount)),
    declaredSpikes,
  }));
}

function loopRows(base: string, frameCount: number, pose: (t: number) => GolemPose): RowSpec[] {
  const views: readonly { suffix: string; view: GolemView }[] = [
    { suffix: '', view: 'front' },
    { suffix: '_side', view: 'side' },
    { suffix: '_away', view: 'back' },
  ];
  return views.map(({ suffix, view }) => ({
    name: `${base}${suffix}`,
    frameCount,
    kind: 'loop',
    view,
    variants: 'both',
    pose: (f) => pose(cyclePhase(f, frameCount)),
  }));
}

const RUBBLE_PIECES = rockGolemRubblePieces();

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = RUBBLE_PIECES.map((piece) => piece.state);

/**
 * The whip and the two impacts are single-frame reversals by design — a slam
 * that eases into the floor has no weight.
 *
 * The frames are resolved through the same shared helpers the runtime lands its
 * damage on, so a timing edit cannot leave the allowlist pointing at one frame
 * while the hit lands on another.
 */
function impactSpikeFrames(landsOn: number): readonly number[] {
  return [Math.max(1, landsOn), Math.max(1, landsOn) + 1];
}

const SLAM_SPIKES = impactSpikeFrames(golemSlamImpactFrame());
const STOMP_SPIKES = impactSpikeFrames(golemStompImpactFrame());
const THROW_SPIKES = impactSpikeFrames(golemThrowReleaseFrame());

export const ROWS: readonly RowSpec[] = [
  ...loopRows('walk', WALK_FRAMES, walkPose),
  ...loopRows('idle', IDLE_FRAMES, idlePose),
  ...attackRows('slam', GOLEM_SLAM_FRAMES, slamPose, SLAM_SPIKES),
  ...attackRows('stomp', GOLEM_STOMP_FRAMES, stompPose, STOMP_SPIKES),
  ...attackRows('throw', GOLEM_THROW_FRAMES, throwPose, THROW_SPIKES),
  {
    name: 'curl',
    frameCount: CURL_FRAMES,
    kind: 'oneShot',
    view: 'front',
    variants: 'boss',
    pose: (f) => tuckPose(easeInOut(shotProgress(f, CURL_FRAMES)), shotProgress(f, CURL_FRAMES)),
    paint: (ctx, frame, variant) => {
      const p = shotProgress(frame, CURL_FRAMES);
      drawGolemCurled(ctx, 'front', tuckPose(easeInOut(p), p), curlBall(p), variant);
    },
  },
  {
    name: 'roll',
    frameCount: ROLL_FRAMES,
    kind: 'loop',
    view: 'front',
    variants: 'boss',
    pose: null,
    paint: (ctx, frame, variant) => {
      drawGolemBall(ctx, rollBall(cyclePhase(frame, ROLL_FRAMES)), variant);
    },
  },
  {
    name: 'uncurl',
    frameCount: CURL_FRAMES,
    kind: 'oneShot',
    view: 'front',
    variants: 'boss',
    pose: (f) => {
      const p = 1 - shotProgress(f, CURL_FRAMES);
      return tuckPose(easeInOut(p), p);
    },
    paint: (ctx, frame, variant) => {
      const p = 1 - shotProgress(frame, CURL_FRAMES);
      drawGolemCurled(ctx, 'front', tuckPose(easeInOut(p), p), curlBall(p), variant);
    },
  },
  {
    name: 'stunned',
    frameCount: STUNNED_FRAMES,
    kind: 'loop',
    view: 'front',
    variants: 'boss',
    pose: (f) => stunnedPose(cyclePhase(f, STUNNED_FRAMES)),
  },
  {
    name: 'gore',
    frameCount: RUBBLE_PIECES.length,
    kind: 'gore',
    view: 'side',
    variants: 'both',
    pose: null,
  },
];

function rowsFor(variant: GolemVariant): readonly RowSpec[] {
  return variant === 'boss' ? ROWS : ROWS.filter((row) => row.variants === 'both');
}

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
   * centre of the cell, so every piece is measured and laid out about one point.
   */
  readonly anchor: 'origin' | 'cellCentre';
  readonly paint: (ctx: Ctx, originX: number, originY: number) => void;
}

/**
 * Extra scale applied to the rubble pieces on top of the figure's own. They are
 * drawn at their own tile-unit sizes rather than sliced off the body, so they do
 * not inherit its scale — but they still have to survive the runtime's downscale.
 */
const GORE_PIECE_SCALE = 1.3;

function buildJobs(
  variant: GolemVariant,
  goreOffsets?: ReadonlyMap<number, Pt>,
): readonly FrameJob[] {
  const scale = variantScale(variant);
  const goreUnit = TILE_SCALE * GORE_PIECE_SCALE;
  const jobs: FrameJob[] = [];

  for (const row of rowsFor(variant)) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      if (row.kind === 'gore') {
        const piece = RUBBLE_PIECES[frame];
        const recentre = goreOffsets?.get(frame) ?? { x: 0, y: 0 };
        jobs.push({
          row,
          frame,
          anchor: 'cellCentre',
          paint: (ctx, originX, originY) => {
            ctx.save();
            ctx.translate(originX + recentre.x * goreUnit, originY + recentre.y * goreUnit);
            ctx.scale(goreUnit, goreUnit);
            piece.paint(ctx, variant);
            ctx.restore();
          },
        });
        continue;
      }

      const { pose, view } = row;
      const paintRow = row.paint;
      jobs.push({
        row,
        frame,
        anchor: 'origin',
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          // Scaled about the ground line so a taller golem still stands on the
          // tile its feet belong to rather than floating above it.
          ctx.translate(0, GROUND_Y);
          ctx.scale(scale, scale);
          ctx.translate(0, -GROUND_Y);
          if (paintRow !== undefined) {
            paintRow(ctx, frame, variant);
          } else if (pose !== null) {
            drawGolem(ctx, view, pose(frame), variant);
          } else {
            throw new Error(`row "${row.name}" has neither a pose nor a painter`);
          }
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

interface Extents {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  readonly goreRadius: number;
  readonly goreOffsets: ReadonlyMap<number, Pt>;
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
      // A broken-off part has its mass well off its construction origin, which
      // would leave it drawn to one side of a cell sized for it.
      goreOffsets.set(job.frame, {
        x: (originX - inkCentreX) / goreUnit,
        y: (originY - inkCentreY) / goreUnit,
      });
      goreRadius = Math.max(
        goreRadius,
        Math.hypot((box.maxX - box.minX) / 2, (box.maxY - box.minY) / 2),
      );
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
  // Both axes have to clear the gore radius: a tumbling piece sweeps the cell's
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
  readonly variant: GolemVariant;
  readonly rows: readonly RowSpec[];
  readonly geometry: SheetGeometry;
  readonly columns: number;
  /** One canvas per painted cell, keyed `row.name`, indexed by frame. */
  readonly cells: ReadonlyMap<string, readonly Canvas[]>;
}

function bakeSheet(variant: GolemVariant): BakedSheet {
  const goreUnit = TILE_SCALE * GORE_PIECE_SCALE;
  // Two passes: the first measures where each rubble piece's ink lands, the
  // second repaints it centred on that measurement.
  const measured = measure(buildJobs(variant), goreUnit);
  const jobs = buildJobs(variant, measured.goreOffsets);
  const extents = measure(jobs, goreUnit);

  if (extents.blankFrames.length > 0) {
    throw new Error(
      `[G2] these frames painted nothing, which almost always means a NaN in the pose: ` +
        extents.blankFrames.join(', '),
    );
  }

  const geometry = geometryFor(extents);
  const rows = rowsFor(variant);
  const columns = Math.max(...rows.map((row) => row.frameCount));

  const cells = new Map<string, Canvas[]>();
  for (const row of rows) cells.set(row.name, []);

  for (const job of jobs) {
    const cell = createCanvas(geometry.frameWidth, geometry.frameHeight);
    const superCell = createCanvas(
      geometry.frameWidth * SUPERSAMPLE,
      geometry.frameHeight * SUPERSAMPLE,
    );
    const superCtx = superCell.getContext('2d');
    superCtx.save();
    superCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    const originY =
      job.anchor === 'cellCentre' ? geometry.frameHeight / 2 : geometry.tileY + TILE_SCALE / 2;
    job.paint(superCtx, geometry.frameWidth / 2, originY);
    superCtx.restore();
    cell
      .getContext('2d')
      .drawImage(superCell, 0, 0, superCell.width, superCell.height, 0, 0, cell.width, cell.height);

    const list = cells.get(job.row.name);
    if (list === undefined) throw new Error(`row "${job.row.name}" is not in ROWS`);
    list[job.frame] = cell;
  }

  return { variant, rows, geometry, columns, cells };
}

function composeSheet(sheet: BakedSheet): Buffer {
  const { geometry, rows, columns } = sheet;
  const canvas = createCanvas(columns * geometry.frameWidth, rows.length * geometry.frameHeight);
  const ctx = canvas.getContext('2d');
  rows.forEach((row, rowIndex) => {
    const cells = sheet.cells.get(row.name) ?? [];
    cells.forEach((cell, frame) => {
      ctx.drawImage(cell, frame * geometry.frameWidth, rowIndex * geometry.frameHeight);
    });
  });
  return canvas.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION });
}

// ── Bake gates ───────────────────────────────────────────────────────────────

const ALPHA_OFFSET = 3;
const CHANNELS = 4;

function alphaOf(cell: Canvas): Uint8ClampedArray {
  const { data } = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height);
  const alpha = new Uint8ClampedArray(cell.width * cell.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  return alpha;
}

/** Mean absolute alpha difference between two cells, 0..255. */
function frameDelta(a: Canvas, b: Canvas): number {
  const alphaA = alphaOf(a);
  const alphaB = alphaOf(b);
  let total = 0;
  for (let i = 0; i < alphaA.length; i++) total += Math.abs(alphaA[i] - alphaB[i]);
  return total / alphaA.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

/** G1 — nothing may touch a cell border, or the neighbouring frame bleeds into it. */
function gateBorderClip(sheet: BakedSheet): void {
  for (const row of sheet.rows) {
    const cells = sheet.cells.get(row.name) ?? [];
    cells.forEach((cell, frame) => {
      const alpha = alphaOf(cell);
      const { width, height } = cell;
      const touch = (x: number, y: number): boolean => alpha[y * width + x] >= INK_ALPHA_THRESHOLD;
      for (let x = 0; x < width; x++) {
        if (touch(x, 0) || touch(x, height - 1)) {
          throw new Error(
            `[G1] ${sheet.variant}/${row.name}[${frame}] paints on the top or bottom cell border ` +
              `at x=${x} — the frame outgrew its ${width}×${height} cell`,
          );
        }
      }
      for (let y = 0; y < height; y++) {
        if (touch(0, y) || touch(width - 1, y)) {
          throw new Error(
            `[G1] ${sheet.variant}/${row.name}[${frame}] paints on a side cell border at y=${y}`,
          );
        }
      }
    });
  }
}

/**
 * G3 — the figure's soles must sit on the tile's bottom edge. Health bars, aggro
 * markers and the Y-sort all key off the tile anchor, and a redraw that moves it
 * is invisible in the sheet but wrong everywhere in play.
 */
const ANCHOR_TOLERANCE_PX = 4;
const ANCHOR_ROWS: readonly string[] = ['idle', 'idle_side', 'idle_away'];

function gateAnchor(sheet: BakedSheet): void {
  // The lowest ink in a standing frame is the ground shadow, not the sole, so
  // the expected floor is the tile bottom plus the shadow's own spill.
  const expectedFloor =
    sheet.geometry.tileY +
    TILE_SCALE +
    contactShadowDrop(sheet.variant) * TILE_SCALE * variantScale(sheet.variant);
  for (const name of ANCHOR_ROWS) {
    const cells = sheet.cells.get(name);
    if (cells === undefined) continue;
    const box = inkBoxOf(cells[0].getContext('2d'), cells[0].width, cells[0].height);
    if (box === null) throw new Error(`[G3] ${sheet.variant}/${name}[0] is blank`);
    const drift = box.maxY - expectedFloor;
    if (Math.abs(drift) > ANCHOR_TOLERANCE_PX) {
      throw new Error(
        `[G3] ${sheet.variant}/${name}[0] has its lowest ink ${drift.toFixed(1)}px from the tile ` +
          `bottom (tileY=${sheet.geometry.tileY}); the limit is ±${ANCHOR_TOLERANCE_PX}px`,
      );
    }
  }
}

/** G4 — a loop whose seam is far bigger than its median step pops once a cycle. */
const LOOP_SEAM_RATIO = 2.6;

function gateLoopClosure(sheet: BakedSheet): void {
  for (const row of sheet.rows) {
    if (row.kind !== 'loop') continue;
    const cells = sheet.cells.get(row.name) ?? [];
    if (cells.length < 3) continue;
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical > 0 && seam > typical * LOOP_SEAM_RATIO) {
      throw new Error(
        `[G4] ${sheet.variant}/${row.name} does not close: the seam step is ${seam.toFixed(1)} ` +
          `against a median of ${typical.toFixed(1)} (limit ${LOOP_SEAM_RATIO}×)`,
      );
    }
  }
}

/** G5 — a step far above the row's median is a snapped joint or a draw-order flip. */
const CONTINUITY_RATIO = 3.8;

function gateContinuity(sheet: BakedSheet): void {
  for (const row of sheet.rows) {
    if (row.kind === 'gore') continue;
    const cells = sheet.cells.get(row.name) ?? [];
    if (cells.length < 4) continue;
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const typical = median(steps);
    if (typical <= 0) continue;
    steps.forEach((step, index) => {
      const frame = index + 1;
      if (row.declaredSpikes?.includes(frame) === true) return;
      if (step > typical * CONTINUITY_RATIO) {
        throw new Error(
          `[G5] ${sheet.variant}/${row.name}[${frame}] jumps ${step.toFixed(1)} against a median ` +
            `of ${typical.toFixed(1)} (limit ${CONTINUITY_RATIO}×) — a snapped joint, or a spike ` +
            `that belongs in declaredSpikes`,
        );
      }
    });
  }
}

/**
 * G6 — a planted foot must track backward monotonically through stance. A foot
 * that reverses mid-stance is the moonwalk, and it is invisible in a still.
 */
function gateFootSlide(): void {
  for (const side of [-1, 1]) {
    let previous: number | null = null;
    let planted = 0;
    for (let frame = 0; frame < WALK_FRAMES; frame++) {
      const pose = walkPose(cyclePhase(frame, WALK_FRAMES));
      const legPose = side < 0 ? pose.legL : pose.legR;
      if (legPose.lift > 0) {
        previous = null;
        continue;
      }
      planted++;
      const foot = golemFootPoint('side', pose, side, 'regular').x;
      if (previous !== null && foot > previous + 1e-6) {
        throw new Error(
          `[G6] the ${side < 0 ? 'left' : 'right'} foot moves forward at walk frame ${frame} ` +
            `while planted (${previous.toFixed(4)} → ${foot.toFixed(4)}) — that is a moonwalk`,
        );
      }
      previous = foot;
    }
    if (planted < 2) throw new Error(`[G6] the walk never plants the ${side} foot for two frames`);
  }
}

/**
 * G7 — hip-to-ankle span must stay inside the two bones on every frame. One
 * clamped frame locks the leg straight and the next tuck snaps it back, which is
 * the hop.
 */
const REACH_HEADROOM = 0.995;

function gateLegReach(): void {
  const limit = (THIGH_REACH + SHIN_REACH) * REACH_HEADROOM;
  for (const row of ROWS) {
    if (row.pose === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      for (const side of [-1, 1]) {
        const foot = golemFootPoint(row.view, pose, side, 'boss');
        const hip = golemHipPoint(row.view, pose, side, 'boss');
        const span = Math.hypot(foot.x - hip.x, foot.y - hip.y);
        if (span > limit) {
          throw new Error(
            `[G7] ${row.name}[${frame}] stretches the ${side < 0 ? 'left' : 'right'} leg to ` +
              `${span.toFixed(3)} against a reach of ${limit.toFixed(3)}`,
          );
        }
      }
    }
  }
}

/**
 * G8 — while the golem is holding a rock, both fists must actually be on it.
 * The painter places the boulder on the fists' midpoint, so this proves the two
 * hands have not drifted so far apart that the rock floats between them.
 */
function gateGrip(): void {
  // Every view, not just one: the fists are furthest apart head-on and nearly
  // coincident in profile, and the boulder is painted on their midpoint in all
  // three — so checking one view proves nothing about the other two.
  for (const row of ROWS.filter((candidate) => candidate.name.startsWith('throw'))) {
    gateGripFor(row);
  }
}

function gateGripFor(throwRow: RowSpec): void {
  if (throwRow.pose === null) throw new Error(`[G8] ${throwRow.name} has no pose`);
  let held = 0;
  for (let frame = 0; frame < throwRow.frameCount; frame++) {
    const pose = throwRow.pose(frame);
    if (pose.rockRadius <= 0) continue;
    held++;
    const left = golemArmChain(throwRow.view, pose, -1, 'regular').fist;
    const right = golemArmChain(throwRow.view, pose, 1, 'regular').fist;
    const centre = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
    const gap = Math.hypot(right.x - centre.x, right.y - centre.y);
    if (gap > pose.rockRadius + FIST_RADIUS) {
      throw new Error(
        `[G8] ${throwRow.name}[${frame}] holds a rock of radius ${pose.rockRadius.toFixed(3)} ` +
          `with fists ${gap.toFixed(3)} from its centre — the boulder floats between the hands`,
      );
    }
  }
  if (held < 2) {
    throw new Error(`[G8] ${throwRow.name} never shows the rock in hand for two frames`);
  }
}

/**
 * G9 — a golem has to read as an assembly of stones. That is measurable: seams
 * are near-black pixels *inside* the silhouette, and a figure painted as one
 * smooth mass has almost none. This is the gate that stops the next edit
 * quietly turning it back into a grey man.
 */
const SEAM_LUMA_MAX = 60;
const MIN_SEAM_FRACTION = 0.04;
const SEAM_GATE_ROWS: readonly string[] = ['idle', 'idle_side'];
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

function gateStoneSeams(sheet: BakedSheet): void {
  for (const name of SEAM_GATE_ROWS) {
    const cells = sheet.cells.get(name);
    if (cells === undefined) continue;
    const cell = cells[0];
    const { data } = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height);
    let body = 0;
    let seam = 0;
    for (let i = 0; i < data.length; i += CHANNELS) {
      if (data[i + ALPHA_OFFSET] < 200) continue;
      body++;
      const luma = data[i] * LUMA_R + data[i + 1] * LUMA_G + data[i + 2] * LUMA_B;
      if (luma <= SEAM_LUMA_MAX) seam++;
    }
    const fraction = body === 0 ? 0 : seam / body;
    if (fraction < MIN_SEAM_FRACTION) {
      throw new Error(
        `[G9] ${sheet.variant}/${name}[0] is only ${(fraction * 100).toFixed(1)}% seam pixels ` +
          `(need ${(MIN_SEAM_FRACTION * 100).toFixed(0)}%) — the stones have merged into one mass`,
      );
    }
  }
}

/**
 * G10 — the impact frame the runtime lands damage on has to be the frame that
 * shows the impact.
 *
 * The old version of this gate compared `ROWS`'s frame counts against the timing
 * module the row table is *built from*, which is `X !== X` and can never fail.
 * It looked like coverage and provided none: a slam whose fists stopped a
 * quarter of the figure's height off the floor shipped straight through it.
 *
 * What is actually checked now: on the declared impact frame both fists are at
 * their lowest of the whole row, and they are within a fist's width of the
 * ground. On the declared release frame the rock has just left the hands.
 */
const SLAM_GROUND_CLEARANCE = FIST_RADIUS * 1.35;

function gateImpactPoses(): void {
  gateSlamReachesGround();
  gateThrowReleasesOnTime();
}

function gateSlamReachesGround(): void {
  for (const row of ROWS.filter((candidate) => candidate.name.startsWith('slam'))) {
    if (row.pose === null) throw new Error(`[G10] ${row.name} has no pose`);
    const impact = golemSlamImpactFrame();
    let lowestFrame = 0;
    let lowest = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      // Both fists, not one. They happen to share a pose object today, so
      // checking either would pass — but the whole attack is named for driving
      // *both* down, and an asymmetric edit would sail past a one-fist check
      // with a hand still in the air.
      const pose = row.pose(frame);
      const highestOfPair = Math.min(
        golemArmChain(row.view, pose, -1, 'regular').fist.y,
        golemArmChain(row.view, pose, 1, 'regular').fist.y,
      );
      if (highestOfPair > lowest) {
        lowest = highestOfPair;
        lowestFrame = frame;
      }
    }
    if (lowestFrame !== impact) {
      throw new Error(
        `[G10] ${row.name} drives its fists lowest on frame ${lowestFrame} but the runtime lands ` +
          `the hit on frame ${impact} — the damage and the pose describe different moments`,
      );
    }
    // GROUND_Y is where the feet are; the fist has to arrive there, not at the
    // chest, or the attack is a shove with dust at the ankles.
    const clearance = -lowest;
    if (clearance > SLAM_GROUND_CLEARANCE) {
      throw new Error(
        `[G10] ${row.name} stops its fists ${clearance.toFixed(3)} tiles above the ground ` +
          `(limit ${SLAM_GROUND_CLEARANCE.toFixed(3)}) — that is not a ground slam`,
      );
    }
  }
}

function gateThrowReleasesOnTime(): void {
  const release = golemThrowReleaseFrame();
  // A release fraction under half a frame would index frame -1 below, which
  // reads as an empty pose rather than as the nonsense it is.
  if (release < 1) {
    throw new Error(
      `[G10] the throw release resolves to frame ${release}, which has no frame before it`,
    );
  }
  for (const row of ROWS.filter((candidate) => candidate.name.startsWith('throw'))) {
    if (row.pose === null) throw new Error(`[G10] ${row.name} has no pose`);
    if (row.pose(release - 1).rockRadius <= 0) {
      throw new Error(
        `[G10] ${row.name} is already empty-handed on frame ${release - 1}, the frame before the ` +
          `runtime spawns the projectile — the boulder vanishes before it is thrown`,
      );
    }
    if (row.pose(release).rockRadius > 0) {
      throw new Error(
        `[G10] ${row.name} still holds the boulder on frame ${release}, the frame the runtime ` +
          `spawns the projectile — it would be drawn twice`,
      );
    }
  }
}

/** G11 — quiet asset bloat. Reported even when it passes. */
const SHEET_PIXEL_BUDGET = 7_200_000;

function gateTextureBudget(sheet: BakedSheet): void {
  const width = sheet.columns * sheet.geometry.frameWidth;
  const height = sheet.rows.length * sheet.geometry.frameHeight;
  const pixels = width * height;
  if (pixels > SHEET_PIXEL_BUDGET) {
    throw new Error(
      `[G11] the ${sheet.variant} sheet is ${width}×${height} = ${pixels.toLocaleString()}px, ` +
        `over the ${SHEET_PIXEL_BUDGET.toLocaleString()}px budget`,
    );
  }
  console.log(
    `  ${sheet.variant}: ${width}×${height} (${((pixels / SHEET_PIXEL_BUDGET) * 100).toFixed(0)}% of budget)`,
  );
}

function runPoseGates(): void {
  gateImpactPoses();
  gateFootSlide();
  gateLegReach();
  gateGrip();
}

function runPixelGates(sheet: BakedSheet): void {
  gateBorderClip(sheet);
  gateAnchor(sheet);
  gateLoopClosure(sheet);
  gateContinuity(sheet);
  gateStoneSeams(sheet);
  gateTextureBudget(sheet);
}

// ── Thrown-rock effect sheets ────────────────────────────────────────────────

const ROCK_EFFECT_FRAMES = 8;
const ROCK_EFFECT_CELL = 64;
const ROCK_EFFECT_RADIUS = 0.26;
const BURST_EFFECT_FRAMES = 8;
const BURST_EFFECT_CELL = 96;
const BURST_EFFECT_RADIUS = 0.3;

interface EffectSheet {
  readonly key: string;
  readonly file: string;
  readonly cell: number;
  readonly frames: number;
  readonly buffer: Buffer;
}

function bakeEffect(
  key: string,
  file: string,
  cell: number,
  frames: number,
  paint: (ctx: Ctx, progress: number) => void,
): EffectSheet {
  const canvas = createCanvas(cell * frames, cell);
  const ctx = canvas.getContext('2d');
  const cells: Canvas[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const superCell = createCanvas(cell * SUPERSAMPLE, cell * SUPERSAMPLE);
    const superCtx = superCell.getContext('2d');
    superCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    superCtx.translate(cell / 2, cell / 2);
    superCtx.scale(TILE_SCALE, TILE_SCALE);
    paint(superCtx, frame / frames);
    const flat = createCanvas(cell, cell);
    flat
      .getContext('2d')
      .drawImage(superCell, 0, 0, superCell.width, superCell.height, 0, 0, cell, cell);
    cells.push(flat);
    ctx.drawImage(flat, frame * cell, 0);
  }
  const sheet: EffectSheet = {
    key,
    file,
    cell,
    frames,
    buffer: canvas.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
  };
  gateEffectSheet(sheet, cells);
  return sheet;
}

/**
 * G13 — the effect cells get the same border-clip and blank-frame checks the
 * figure sheets do.
 *
 * Their cell sizes are hand-declared rather than measured (they are square and
 * generously padded, and a boulder is a known size), so this is the only thing
 * standing between a widened burst and shards bleeding into the neighbouring
 * frame. Ungated they were the one part of the bake nothing looked at.
 */
function gateEffectSheet(effect: EffectSheet, cells: readonly Canvas[]): void {
  cells.forEach((cell, frame) => {
    const alpha = alphaOf(cell);
    const { width, height } = cell;
    const touch = (x: number, y: number): boolean => alpha[y * width + x] >= INK_ALPHA_THRESHOLD;
    let painted = 0;
    for (const value of alpha) {
      if (value >= INK_ALPHA_THRESHOLD) painted++;
    }
    if (painted === 0) {
      throw new Error(`[G13] ${effect.key}[${frame}] painted nothing — almost always a NaN`);
    }
    for (let x = 0; x < width; x++) {
      if (touch(x, 0) || touch(x, height - 1)) {
        throw new Error(
          `[G13] ${effect.key}[${frame}] paints on the top or bottom cell border at x=${x} — ` +
            `it outgrew its ${width}×${height} cell`,
        );
      }
    }
    for (let y = 0; y < height; y++) {
      if (touch(0, y) || touch(width - 1, y)) {
        throw new Error(`[G13] ${effect.key}[${frame}] paints on a side cell border at y=${y}`);
      }
    }
  });
}

function bakeEffects(): readonly EffectSheet[] {
  return [
    bakeEffect(
      'golem_rock',
      'src/images/effects/golem_rock.png',
      ROCK_EFFECT_CELL,
      ROCK_EFFECT_FRAMES,
      (ctx, progress) => drawThrownRock(ctx, ROCK_EFFECT_RADIUS, progress * TWO_PI),
    ),
    bakeEffect(
      'golem_rock_burst',
      'src/images/effects/golem_rock_burst.png',
      BURST_EFFECT_CELL,
      BURST_EFFECT_FRAMES,
      // Sampled at frame centres so the first frame already shows a shatter
      // rather than the intact rock the projectile has just stopped drawing.
      (ctx, progress) =>
        drawRockBurst(ctx, BURST_EFFECT_RADIUS, clamp01(progress + 0.5 / BURST_EFFECT_FRAMES)),
    ),
  ];
}

// ── Manifests ────────────────────────────────────────────────────────────────

export const SHEET_PATH: Record<GolemVariant, string> = {
  regular: 'src/images/enemies/rock_golem.png',
  boss: 'src/images/enemies/rock_golem_boss.png',
};

const MANIFEST_KEY: Record<GolemVariant, string> = {
  regular: 'rock_golem',
  boss: 'rock_golem_boss',
};

const ENEMY_MANIFEST_PATH = 'src/images/enemies/manifest.json';
const EFFECT_MANIFEST_PATH = 'src/images/effects/manifest.json';

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

function manifestEntryFor(sheet: BakedSheet): ManifestEntry {
  const states: Record<string, ManifestStateEntry> = {};
  sheet.rows.forEach((row, index) => {
    if (row.kind === 'gore') {
      GORE_STATES.forEach((state, column) => {
        states[state] = { row: index, colOffset: column, frameCount: 1 };
      });
      return;
    }
    states[row.name] = { row: index, frameCount: row.frameCount };
  });
  return {
    path: `enemies/${MANIFEST_KEY[sheet.variant]}.png`,
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

/**
 * Both effect sheets anchor on the *centre* of their cell rather than its corner.
 *
 * A boulder in flight is positioned by where it is, not by a tile it stands on,
 * and the cells are square and generously padded — so with a corner anchor the
 * caller has to subtract half the *scaled* frame, which is not half the tile and
 * put the rock most of a tile off its own impact point.
 */
function effectManifestEntry(effect: EffectSheet): ManifestEntry {
  const centre = effect.cell / 2;
  return {
    path: `effects/${effect.key}.png`,
    frameWidth: effect.cell,
    frameHeight: effect.cell,
    tileX: centre,
    tileY: centre,
    tileScale: TILE_SCALE,
    states: { spin: { row: 0, frameCount: effect.frames } },
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

function readManifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(path), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${path} is not an object`);
  return { ...parsed };
}

/**
 * Checks the manifests against the bake rather than rewriting them: other agents
 * work in this repo, and a programmatic rewrite of a shared file would clobber
 * their edits. A mismatch prints the entry to paste and fails the run — a sheet
 * on disk that its manifest does not describe renders as garbage.
 */
function verifyManifests(sheets: readonly BakedSheet[], effects: readonly EffectSheet[]): boolean {
  let ok = true;
  const check = (path: string, key: string, required: ManifestEntry): void => {
    const manifest = readManifest(path);
    if (canonicalJson(manifest[key]) === canonicalJson(required)) return;
    console.error(
      `\n${path} is out of sync with the bake. Set its "${key}" entry to:\n` +
        `${JSON.stringify({ [key]: required }, null, 2)}\n`,
    );
    ok = false;
  };
  for (const sheet of sheets) {
    check(ENEMY_MANIFEST_PATH, MANIFEST_KEY[sheet.variant], manifestEntryFor(sheet));
  }
  for (const effect of effects) {
    check(EFFECT_MANIFEST_PATH, effect.key, effectManifestEntry(effect));
  }
  if (ok) console.log('  manifests: in sync');
  return ok;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function bake(variant: GolemVariant): BakedSheet {
  return bakeSheet(variant);
}

function writeAll(): void {
  console.log(`Baking rock golem sheets (tileScale=${TILE_SCALE})…`);
  runPoseGates();

  const variants: readonly GolemVariant[] = ['regular', 'boss'];
  const sheets = variants.map((variant) => {
    const sheet = bakeSheet(variant);
    runPixelGates(sheet);
    return sheet;
  });
  const effects = bakeEffects();

  for (const sheet of sheets) {
    writeFileSync(resolve(SHEET_PATH[sheet.variant]), composeSheet(sheet));
    console.log(`  → ${SHEET_PATH[sheet.variant]}`);
    console.log(
      `     ${sheet.rows.length} rows × ${sheet.columns} cols of ` +
        `${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight}, ` +
        `tileX=${sheet.geometry.tileX} tileY=${sheet.geometry.tileY}`,
    );
  }
  for (const effect of effects) {
    writeFileSync(resolve(effect.file), effect.buffer);
    console.log(`  → ${effect.file} (${effect.frames} × ${effect.cell}px)`);
  }

  if (!verifyManifests(sheets, effects)) process.exitCode = 1;
}

// The review harness imports ROWS from here, so painting the sheets has to be
// something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeAll();
}
