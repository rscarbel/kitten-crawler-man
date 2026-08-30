/**
 * The rock golems, as painted figures: the choreography, the cell geometry, and
 * the four `FigureDef`s the runtime cache and the review harness draw through —
 * the regular golem, the bounty boss, and the thrown boulder and its burst.
 *
 * One row table for both bodies on purpose: the boss, the regular golem and the
 * hired bruiser share their animations and attacks, and one table is the only
 * way that stays true after the next edit. The boss is the same creature grown
 * half a tile, plus the four boulder-roll rows.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, and the placement of a pose or a rubble piece inside its cell.
 * Anatomy, palette and every stroke of paint live in `rockGolemArt.ts`.
 *
 * Rows:
 *    walk / walk_side / walk_away
 *    idle / idle_side / idle_away
 *    slam / stomp / throw, each in all three views
 *    curl / roll / uncurl / stunned  (boss only)
 *
 * plus one single-frame state per rubble piece, which is how
 * `BodyPartGoreSystem` asks for them.
 *
 * The art invariants live in `scripts/gates-rock-golem.ts`, which the review
 * harness runs: `npm run render:rock-golem`.
 */

import {
  FIGURE_HEIGHT,
  GROUND_Y,
  TWO_PI,
  type BallPose,
  type GolemArmPose,
  type GolemLegPose,
  type GolemPose,
  type RubblePiece,
  type GolemVariant,
  type GolemView,
  clamp01,
  deg,
  drawGolem,
  drawGolemBall,
  drawGolemCurled,
  drawRockBurst,
  drawThrownRock,
  easeIn,
  easeInOut,
  easeOut,
  hump,
  lerp,
  ramp,
  restPose,
  rockGolemRubblePieces,
} from './rockGolemArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
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
} from '../rockGolemTiming';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 40;

interface Pt {
  readonly x: number;
  readonly y: number;
}

function pt(x: number, y: number): Pt {
  return { x, y };
}

/**
 * How tall each variant stands, in tiles. A regular golem is a two-tile slab of
 * a thing; the boss is the same creature grown half a tile, which is as much
 * size difference as reads at a 32 px tile before he stops fitting through gaps.
 */
const VARIANT_TILE_HEIGHT: Record<GolemVariant, number> = { regular: 2, boss: 2.5 };

export function variantScale(variant: GolemVariant): number {
  return VARIANT_TILE_HEIGHT[variant] / FIGURE_HEIGHT;
}

export const WALK_FRAMES = 12;
const IDLE_FRAMES = 8;
const CURL_FRAMES = 8;
const ROLL_FRAMES = 8;
const STUNNED_FRAMES = 8; // ── Pose helpers ─────────────────────────────────────────────────────────────

function leg(fore: number, lift: number, splay = 0): GolemLegPose {
  return { fore, splay, lift };
}

function arm(swing: number, bend: number, flare: number, clench: number): GolemArmPose {
  return { swing, bend, flare, clench };
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
export function cyclePhase(frame: number, frameCount: number): number {
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

export function walkPose(phase: number): GolemPose {
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

export type RowKind = 'loop' | 'oneShot';

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
  readonly paint?: (ctx: CanvasRenderingContext2D, frame: number, variant: GolemVariant) => void;
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

export const RUBBLE_PIECES = rockGolemRubblePieces();

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
];

function rowsFor(variant: GolemVariant): readonly RowSpec[] {
  return variant === 'boss' ? ROWS : ROWS.filter((row) => row.variants === 'both');
}
// ── Variants ─────────────────────────────────────────────────────────────────

/**
 * The cell a variant's poses and rubble pieces are painted into, and where its
 * own tile sits inside it.
 *
 * These four numbers per variant were measured by the bake these figures
 * replace — the widest pose plus padding, quantised — and
 * `scripts/parity-figure-sheet.ts` is what proved the painters still fill
 * exactly those cells. The gates re-check that nothing paints against the edge,
 * which is what would say a pose has outgrown them.
 */
interface CellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

const CELL: Record<GolemVariant, CellGeometry> = {
  regular: { frameWidth: 112, frameHeight: 112, tileX: 36, tileY: 55 },
  boss: { frameWidth: 136, frameHeight: 136, tileX: 48, tileY: 77 },
};

/**
 * Extra scale applied to the rubble pieces on top of the figure's own. They are
 * drawn at their own tile-unit sizes rather than sliced off the body, so they do
 * not inherit its scale — but they still have to survive the runtime's downscale.
 */
const GORE_PIECE_SCALE = 1.3;

/** Pixels per tile unit a rubble piece is painted at. */
export const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

/**
 * How far each rubble piece is nudged so that its ink, not its authoring origin,
 * sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own visible pixels,
 * so a piece drawn off-centre in its cell orbits rather than tumbles. The
 * offsets are in the piece's own units, the same ones its `paint` is scaled by,
 * and they were measured from the painted ink of each piece. One table for both
 * variants because the two builds differ only in colour, which the gate proves
 * by re-measuring each variant separately. Measuring is something only an
 * offline pass can do, so the numbers are frozen here and
 * `scripts/gates-rock-golem.ts` re-measures them on every render.
 */
export const GORE_RECENTRE: ReadonlyMap<string, Pt> = new Map([
  ['gore_head', pt(0.028846153846153848, -0.009615384615384616)],
  ['gore_core', pt(0.057692307692307696, 0.009615384615384616)],
  ['gore_fist_left', pt(0, -0.009615384615384616)],
  ['gore_fist_right', pt(-0.009615384615384616, 0.019230769230769232)],
  ['gore_arm', pt(0.028846153846153848, 0.019230769230769232)],
  ['gore_leg', pt(-0.019230769230769232, 0)],
  ['gore_shoulder', pt(0, -0.028846153846153848)],
  ['gore_scatter', pt(0, 0)],
]);

export function golemRowsFor(variant: GolemVariant): readonly RowSpec[] {
  return rowsFor(variant);
}

// ── Painting ─────────────────────────────────────────────────────────────────

function recentreOf(state: string): Pt {
  const offset = GORE_RECENTRE.get(state);
  if (offset === undefined) throw new Error(`no rubble recentring offset for "${state}"`);
  return offset;
}

function pieceOf(state: string): RubblePiece {
  const piece = RUBBLE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no rubble piece for "${state}"`);
  return piece;
}

/**
 * Paints one cell of a golem, in the cell's own pixels.
 *
 * A pose row is anchored at the ground line under the cell's centre, and the
 * variant's height is applied about that ground line so a taller golem still
 * stands on the tile its feet belong to rather than floating above it. A rubble
 * piece is anchored at the cell's centre instead, because the only thing that
 * reads its cell is the spin the gore field applies about that point.
 */
function paintGolemFrame(
  variant: GolemVariant,
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
): void {
  const cell = CELL[variant];
  const row = rowsFor(variant).find((candidate) => candidate.name === state);
  if (row === undefined) {
    const piece = pieceOf(state);
    const recentre = recentreOf(state);
    ctx.save();
    ctx.translate(
      cell.frameWidth / 2 + recentre.x * GORE_UNIT,
      cell.frameHeight / 2 + recentre.y * GORE_UNIT,
    );
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(ctx, variant);
    ctx.restore();
    return;
  }

  const scale = variantScale(variant);
  ctx.save();
  ctx.translate(cell.frameWidth / 2, cell.tileY + TILE_SCALE / 2);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.translate(0, GROUND_Y);
  ctx.scale(scale, scale);
  ctx.translate(0, -GROUND_Y);
  const paintRow = row.paint;
  if (paintRow !== undefined) {
    paintRow(ctx, frame, variant);
  } else if (row.pose !== null) {
    drawGolem(ctx, row.view, row.pose(frame), variant);
  } else {
    throw new Error(`row "${row.name}" has neither a pose nor a painter`);
  }
  ctx.restore();
}

/** Every state a variant declares, pose rows first and then the rubble pieces. */
function stateFramesOf(variant: GolemVariant): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of rowsFor(variant)) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

function figureOf(variant: GolemVariant, id: string): FigureDef {
  const cell = CELL[variant];
  return {
    id,
    frameWidth: cell.frameWidth,
    frameHeight: cell.frameHeight,
    tileX: cell.tileX,
    tileY: cell.tileY,
    tileScale: TILE_SCALE,
    states: figureStates(stateFramesOf(variant)),
    paintFrame: (ctx, state, frame) => {
      paintGolemFrame(variant, ctx, state, frame);
    },
  };
}

export const ROCK_GOLEM_FIGURE: FigureDef = figureOf('regular', 'rock_golem');
export const ROCK_GOLEM_BOSS_FIGURE: FigureDef = figureOf('boss', 'rock_golem_boss');

/** The variant a figure id names, for the gates and the review harness. */
export const GOLEM_FIGURES: Readonly<Record<GolemVariant, FigureDef>> = {
  regular: ROCK_GOLEM_FIGURE,
  boss: ROCK_GOLEM_BOSS_FIGURE,
};

// ── The thrown boulder and its burst ─────────────────────────────────────────

/**
 * The two effect sheets the throw spawns. Their cells are square, hand-declared
 * and generously padded — a boulder is a known size — and they anchor on their
 * own centre rather than on a ground line, so a caller passes the impact point
 * straight through.
 */
const ROCK_EFFECT_FRAMES = 8;
const ROCK_EFFECT_CELL = 64;
const ROCK_EFFECT_RADIUS = 0.26;
const BURST_EFFECT_FRAMES = 8;
const BURST_EFFECT_CELL = 96;
const BURST_EFFECT_RADIUS = 0.3;

/** The single row both effect sheets carry. */
export const ROCK_EFFECT_STATE = 'spin';

function effectFigure(
  id: string,
  cell: number,
  frames: number,
  paint: (ctx: CanvasRenderingContext2D, progress: number) => void,
): FigureDef {
  return {
    id,
    frameWidth: cell,
    frameHeight: cell,
    tileX: cell / 2,
    tileY: cell / 2,
    tileScale: TILE_SCALE,
    states: figureStates({ [ROCK_EFFECT_STATE]: frames }),
    paintFrame: (ctx, state, frame) => {
      if (state !== ROCK_EFFECT_STATE) return;
      ctx.save();
      ctx.translate(cell / 2, cell / 2);
      ctx.scale(TILE_SCALE, TILE_SCALE);
      paint(ctx, frame / frames);
      ctx.restore();
    },
  };
}

export const GOLEM_ROCK_FIGURE: FigureDef = effectFigure(
  'golem_rock',
  ROCK_EFFECT_CELL,
  ROCK_EFFECT_FRAMES,
  (ctx, progress) => {
    drawThrownRock(ctx, ROCK_EFFECT_RADIUS, progress * TWO_PI);
  },
);

export const GOLEM_ROCK_BURST_FIGURE: FigureDef = effectFigure(
  'golem_rock_burst',
  BURST_EFFECT_CELL,
  BURST_EFFECT_FRAMES,
  // Sampled at frame centres so the first frame already shows a shatter rather
  // than the intact rock the projectile has just stopped drawing.
  (ctx, progress) => {
    drawRockBurst(ctx, BURST_EFFECT_RADIUS, clamp01(progress + 0.5 / BURST_EFFECT_FRAMES));
  },
);
