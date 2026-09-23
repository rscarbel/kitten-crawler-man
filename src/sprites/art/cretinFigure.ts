/**
 * The Cretins as painted figures: the choreography, the cell geometry, and the
 * `FigureDef`s the runtime cache and the review harness draw through — one per
 * Cretin, plus the amber Shield dome they cast.
 *
 * One row table for all four on purpose. They are one species with one body;
 * what tells Sledge from Bomo from Clay-ton from Very Sullen is paint (stone
 * colour, head shape, eyes, Sledge's hat, boa and button, the Meat Shields
 * armband on the two the desk rents out), and a cell is keyed on figure, state
 * and frame, so each Cretin is its own figure painted from the same rows.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, and where a pose sits in its cell. Anatomy and paint live in
 * `cretinArt.ts` and `cretinShieldArt.ts`.
 *
 * Rows, each in three views (`<row>`, `<row>_side`, `<row>_away`):
 *    idle, walk, punch, cast_shield, robot, hurt, death
 *
 * The art invariants live in `scripts/gates-cretin.ts`, which the review harness
 * runs: `npm run render:cretin`.
 */

import {
  ANKLE_Y,
  CRETIN_VARIANTS,
  HIP_Y,
  LEG_REACH,
  REST_ARM,
  type CretinArmPose,
  type CretinPose,
  type CretinVariant,
  type CretinView,
  drawCretin,
  drawCretinRubble,
  drawCretinShedStones,
  restPose,
} from './cretinArt';
import { type ShieldLook, drawCretinShield } from './cretinShieldArt';
import { clamp01, deg, easeInOut, easeOut, hump, lerp } from './carlArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  CRETIN_CAST_SHIELD_CAST_FRAME,
  CRETIN_CAST_SHIELD_FRAMES,
  CRETIN_DEATH_FRAMES,
  CRETIN_DRAW_SCALE,
  CRETIN_HURT_FRAMES,
  CRETIN_IDLE_BLINK_FRAME,
  CRETIN_IDLE_FRAMES,
  CRETIN_PUNCH_FRAMES,
  CRETIN_PUNCH_IMPACT_FRAME,
  CRETIN_ROBOT_FRAMES,
  CRETIN_SHIELD_APPEAR_FRAMES,
  CRETIN_SHIELD_FADE_FRAMES,
  CRETIN_SHIELD_HOLD_FRAMES,
  CRETIN_WALK_FRAMES,
  CRETIN_WALK_REACH,
  CRETIN_WALK_STANCE_SHARE,
} from '../cretinTiming';

const TWO_PI = Math.PI * 2;

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

export function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

function easeIn(t: number): number {
  const c = clamp01(t);
  return c * c;
}

/** 0 before `start`, 1 after `end`, linear between. */
function span(value: number, start: number, end: number): number {
  return clamp01((value - start) / (end - start));
}

function arm(
  swing: number,
  flare: number,
  bend: number,
  roll: number,
  clench: number,
): CretinArmPose {
  return { swing, flare, bend, roll, clench };
}

function mixArm(a: CretinArmPose, b: CretinArmPose, t: number): CretinArmPose {
  return {
    swing: lerp(a.swing, b.swing, t),
    flare: lerp(a.flare, b.flare, t),
    bend: lerp(a.bend, b.bend, t),
    roll: lerp(a.roll, b.roll, t),
    clench: lerp(a.clench, b.clench, t),
  };
}

// ── Walk ─────────────────────────────────────────────────────────────────────

/** How high a swinging foot clears the floor: a heavy creature barely lifts. */
const WALK_LIFT = 0.13;
/** Arm swing either side of the hang; stone arms are heavy and move little. */
const WALK_ARM_SWING = deg(30);
/** Arms swing further forward than back. */
const WALK_BACKSWING_SHARE = 0.7;
const WALK_ARM_INSWING = deg(7);
const WALK_LEAN = deg(5);
/** The shoulders counter-rotate against the hips. */
const WALK_TWIST = deg(9);
/** The weight rolls over whichever foot is planted. */
const WALK_SWAY = 0.035;
const WALK_TILT = deg(2.5);
/**
 * Headroom kept on every stance leg: a leg dead straight at contact locks, and
 * the next frame's bend snaps it back — the hop.
 */
const WALK_REACH_HEADROOM = 0.985;
const STANDING_HIP_SPAN = ANKLE_Y - HIP_Y;

export interface WalkFoot {
  readonly fore: number;
  readonly lift: number;
  readonly planted: boolean;
}

/** A foot's place in the stride: contact at phase 0, planted through the stance share. */
export function walkFoot(phase: number): WalkFoot {
  const cycle = ((phase % 1) + 1) % 1;
  if (cycle < CRETIN_WALK_STANCE_SHARE) {
    // Through stance the foot slides back at exactly the rate the body is
    // carried over it, which is what holds it still on the floor.
    const t = cycle / CRETIN_WALK_STANCE_SHARE;
    return {
      fore: lerp(CRETIN_WALK_REACH, -CRETIN_WALK_REACH, t),
      lift: 0,
      planted: true,
    };
  }
  const t = (cycle - CRETIN_WALK_STANCE_SHARE) / (1 - CRETIN_WALK_STANCE_SHARE);
  return {
    fore: lerp(-CRETIN_WALK_REACH, CRETIN_WALK_REACH, easeInOut(t)),
    lift: hump(t) * WALK_LIFT,
    planted: false,
  };
}

/**
 * How far the pelvis has to sink so every foot stays inside its leg's reach.
 * The walking pelvis vaults over the planted leg, lowest at contact when the
 * feet are furthest apart — derived here rather than keyed as a bob.
 */
function walkDrop(right: WalkFoot, left: WalkFoot): number {
  const limit = LEG_REACH * WALK_REACH_HEADROOM;
  let ceiling = STANDING_HIP_SPAN;
  for (const foot of [right, left]) {
    const reach = Math.sqrt(Math.max(0, limit * limit - foot.fore * foot.fore));
    ceiling = Math.min(ceiling, foot.lift + reach);
  }
  return STANDING_HIP_SPAN - ceiling;
}

/**
 * How far the body settles onto each footfall beyond the pelvis's own vault,
 * tiles, and how long that takes to recover, in cycle phase. The drop only
 * ever lowers the hips, so it can never ask a leg to reach further.
 */
const WALK_LAND_DROP = 0.022;
const WALK_LAND_DECAY = 0.2;

function landPulse(phase: number, at: number): number {
  const since = (((phase - at) % 1) + 1) % 1;
  return since < WALK_LAND_DECAY ? 1 - since / WALK_LAND_DECAY : 0;
}

function walkArm(drive: number): CretinArmPose {
  const forward = drive >= 0 ? drive : drive * WALK_BACKSWING_SHARE;
  return {
    ...REST_ARM,
    swing: forward * WALK_ARM_SWING,
    // Coming forward the arm swings in across the body and going back it
    // swings out: head-on that sideways travel is all of the swing that shows.
    flare: REST_ARM.flare - drive * WALK_ARM_INSWING,
    bend: REST_ARM.bend + Math.max(0, forward) * deg(12),
  };
}

export function walkPose(phase: number): CretinPose {
  const right = walkFoot(phase);
  const left = walkFoot(phase + 0.5);
  const angle = phase * TWO_PI;
  // Same-side arm is furthest back at that foot's contact: a cosine of the
  // gait phase, never a sine, or the arms run a quarter cycle late.
  const rightDrive = -Math.cos(angle);
  const stanceCentre = (CRETIN_WALK_STANCE_SHARE / 2) * TWO_PI;
  return {
    ...restPose(),
    drop:
      walkDrop(right, left) + WALK_LAND_DROP * Math.max(landPulse(phase, 0), landPulse(phase, 0.5)),
    sway: WALK_SWAY * Math.cos(angle - stanceCentre),
    tilt: -WALK_TILT * Math.cos(angle - stanceCentre),
    lean: WALK_LEAN,
    twist: -WALK_TWIST * Math.cos(angle),
    headTurn: 0,
    headPitch: deg(3),
    armR: walkArm(rightDrive),
    armL: walkArm(-rightDrive),
    legR: { fore: right.fore, lift: right.lift, splay: 0 },
    legL: { fore: left.fore, lift: left.lift, splay: 0 },
    boaLag: 0.03 + 0.02 * Math.cos(angle * 2),
    time: phase,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

const IDLE_SWAY = 0.018;
/** How far the shoulders lift on each breath, tiles: a pixel at the game's tile. */
const IDLE_RISE = 0.032;
const IDLE_HEAD_TURN = 0.18;

function idlePose(phase: number, frame: number): CretinPose {
  const angle = phase * TWO_PI;
  const breath = 0.5 - 0.5 * Math.cos(angle);
  return {
    ...restPose(),
    breathe: breath,
    rise: IDLE_RISE * breath,
    sway: IDLE_SWAY * Math.sin(angle),
    tilt: deg(0.8) * Math.sin(angle),
    headTurn: IDLE_HEAD_TURN * Math.sin(angle),
    headPitch: deg(-2) * breath,
    armR: {
      ...REST_ARM,
      flare: REST_ARM.flare + deg(2.5) * breath,
      swing: deg(1.5) * Math.sin(angle),
    },
    armL: {
      ...REST_ARM,
      flare: REST_ARM.flare + deg(2.5) * breath,
      swing: -deg(1.5) * Math.sin(angle),
    },
    boaLag: 0.01 * Math.sin(angle),
    blink: frame === CRETIN_IDLE_BLINK_FRAME ? 1 : 0,
    time: phase,
  };
}

// ── Punch ────────────────────────────────────────────────────────────────────

/** Progress at which the fist lands: the middle of the impact frame. */
export const PUNCH_IMPACT_PROGRESS = shotProgress(CRETIN_PUNCH_IMPACT_FRAME, CRETIN_PUNCH_FRAMES);
const PUNCH_COCK_END = 0.34;
/** Raises the impact burst to a power so it flashes on the impact frame and is nearly gone by the next. */
const PUNCH_BURST_SHARPNESS = 4;

const PUNCH_COCKED = arm(deg(-40), deg(26), deg(118), 0, 1);
/**
 * Crossing in toward the centre line at full extension: a straight right lands
 * in front of the chest, and head-on a fist out beside the head reads as a
 * wave rather than a punch.
 */
const PUNCH_EXTENDED = arm(deg(86), deg(-14), deg(6), 0, 1);
const GUARD = arm(deg(32), deg(14), deg(112), 0, 1);

function punchPose(progress: number): CretinPose {
  const cock = easeInOut(span(progress, 0, PUNCH_COCK_END));
  const drive = easeIn(span(progress, PUNCH_COCK_END, PUNCH_IMPACT_PROGRESS));
  const recover = easeInOut(span(progress, PUNCH_IMPACT_PROGRESS, 1));
  const guardIn = cock * (1 - recover);
  const impact = drive * (1 - recover);
  const cocked = cock * (1 - drive);
  const rightArm = mixArm(
    mixArm(mixArm(REST_ARM, PUNCH_COCKED, cock), PUNCH_EXTENDED, drive),
    REST_ARM,
    recover,
  );
  return {
    ...restPose(),
    drop: 0.035 * guardIn,
    // The whole body turns into the blow: shoulders wound back, then thrown.
    twist: deg(-24) * cocked + deg(26) * impact,
    lean: deg(-4) * cocked + deg(12) * impact,
    sway: 0.03 * impact,
    headPitch: deg(6) * guardIn,
    armR: rightArm,
    armL: mixArm(REST_ARM, GUARD, guardIn),
    // The lead foot steps into it as the fist travels.
    legL: {
      fore: 0.12 * easeOut(span(progress, 0.2, PUNCH_IMPACT_PROGRESS)) * (1 - recover),
      lift: 0.04 * hump(span(progress, 0.2, 0.5)),
      splay: 0,
    },
    legR: { fore: -0.06 * impact, lift: 0, splay: 0 },
    dust: 0.35 * impact,
    impact: impact ** PUNCH_BURST_SHARPNESS,
    boaLag: -0.04 * impact + 0.03 * cocked,
    time: progress,
  };
}

// ── Shield cast ──────────────────────────────────────────────────────────────

export const CAST_PROGRESS = shotProgress(CRETIN_CAST_SHIELD_CAST_FRAME, CRETIN_CAST_SHIELD_FRAMES);
const CAST_RAISE_END = 0.5;
/** How quickly the glyph goes out after the cast, as row progress: gone before the hands come down. */
const CAST_GLYPH_FADE = 0.2;

const CAST_RAISED = arm(deg(152), deg(24), deg(22), 0, 0.1);

function castPose(progress: number): CretinPose {
  const raise = easeInOut(span(progress, 0, CAST_RAISE_END));
  const lower = easeInOut(span(progress, CAST_PROGRESS, 1));
  const up = raise * (1 - lower);
  // The glyph kindles as the hands come up, peaks on the cast frame, and is gone
  // by the time they are down.
  const kindle = span(progress, CAST_RAISE_END * 0.6, CAST_PROGRESS);
  const glyph = kindle * (1 - span(progress, CAST_PROGRESS, CAST_PROGRESS + CAST_GLYPH_FADE));
  return {
    ...restPose(),
    breathe: up,
    lean: deg(-6) * up,
    headPitch: deg(-16) * up,
    drop: 0.02 * up,
    armR: mixArm(REST_ARM, CAST_RAISED, up),
    armL: mixArm(REST_ARM, CAST_RAISED, up),
    glyph: easeOut(glyph),
    time: progress,
  };
}

// ── Robot ────────────────────────────────────────────────────────────────────

/** Upper arm held out level, forearm folded straight up: the goalpost. */
const ROBOT_UP = arm(0, deg(90), deg(90), deg(90), 1);
/** Upper arm out level, forearm folded straight down. */
const ROBOT_DOWN = arm(0, deg(90), deg(90), deg(-90), 1);
/** Arm hanging dead straight at the side: the robot's locked-down beat. */
const ROBOT_HANG = arm(0, deg(6), 0, 0, 1);

interface RobotKey {
  readonly left: CretinArmPose;
  readonly right: CretinArmPose;
  readonly head: number;
  readonly twist: number;
}

const ROBOT_KEYS: readonly RobotKey[] = [
  { left: ROBOT_UP, right: ROBOT_UP, head: 0, twist: 0 },
  { left: ROBOT_UP, right: ROBOT_DOWN, head: 0.9, twist: deg(8) },
  { left: ROBOT_DOWN, right: ROBOT_UP, head: -0.9, twist: deg(-8) },
  { left: ROBOT_HANG, right: ROBOT_UP, head: 0, twist: 0 },
  { left: ROBOT_UP, right: ROBOT_HANG, head: 0.9, twist: 0 },
  { left: ROBOT_DOWN, right: ROBOT_DOWN, head: -0.9, twist: deg(12) },
];

/** How far the snap frame overshoots the pose it is snapping to: the servo judder. */
const ROBOT_OVERSHOOT = 1.12;
const ROBOT_SNAP_DROP = 0.065;
const ROBOT_HOLD_DROP = 0.018;

function robotPose(frame: number): CretinPose {
  const keyIndex = Math.floor(frame / 2) % ROBOT_KEYS.length;
  const snapping = frame % 2 === 0;
  const key = ROBOT_KEYS[keyIndex];
  const previous = ROBOT_KEYS[(keyIndex + ROBOT_KEYS.length - 1) % ROBOT_KEYS.length];
  const t = snapping ? ROBOT_OVERSHOOT : 1;
  return {
    ...restPose(),
    armL: mixArm(previous.left, key.left, t),
    armR: mixArm(previous.right, key.right, t),
    headTurn: lerp(previous.head, key.head, t),
    twist: lerp(previous.twist, key.twist, t),
    drop: snapping ? ROBOT_SNAP_DROP : ROBOT_HOLD_DROP,
    // Knees pumping in time: the hips tick side to side on every snap.
    sway: (keyIndex % 2 === 0 ? 1 : -1) * (snapping ? 0.02 : 0.012),
    time: frame / CRETIN_ROBOT_FRAMES,
  };
}

// ── Hurt ─────────────────────────────────────────────────────────────────────

const HURT_PEAK = 0.32;

function hurtPose(progress: number): CretinPose {
  const flinch =
    progress < HURT_PEAK
      ? easeOut(progress / HURT_PEAK)
      : 1 - easeInOut((progress - HURT_PEAK) / (1 - HURT_PEAK));
  // The arms recoil back and out with the body, away from the blow; thrown
  // forward they read as a reach.
  const flinchArm = arm(deg(-22), deg(30), deg(55), 0, 1);
  return {
    ...restPose(),
    lean: deg(-20) * flinch,
    chips: flinch,
    headPitch: deg(-22) * flinch,
    headRoll: deg(6) * flinch,
    drop: 0.02 * flinch,
    twist: deg(-6) * flinch,
    armR: mixArm(REST_ARM, flinchArm, flinch),
    armL: mixArm(REST_ARM, flinchArm, flinch * 0.7),
    hatHop: 0.07 * flinch,
    blink: flinch > 0.6 ? 1 : 0,
    time: progress,
  };
}

// ── Death ────────────────────────────────────────────────────────────────────

/** Where in the row the body stops sagging and comes apart. */
export const DEATH_BREAK_PROGRESS = 0.42;
/** Where the rubble has settled. */
const DEATH_SETTLED_PROGRESS = 0.8;
/** Where the dust has cleared, before the last frame so the corpse frame is clean. */
const DEATH_DUST_CLEAR_PROGRESS = 0.85;
const DEATH_SAG_DROP = 0.38;
/** When in the sag the first stones break off the shoulders, and when they are down. */
const DEATH_SHED_START = 0.18;

function deathSagPose(progress: number): CretinPose {
  const sag = easeInOut(span(progress, 0, DEATH_BREAK_PROGRESS));
  const slack = arm(deg(24), deg(18), deg(24), 0, 0.4);
  return {
    ...restPose(),
    drop: DEATH_SAG_DROP * sag,
    lean: deg(26) * sag,
    headPitch: deg(22) * sag,
    headRoll: deg(-8) * sag,
    armR: mixArm(REST_ARM, slack, sag),
    armL: mixArm(REST_ARM, { ...slack, swing: deg(12) }, sag),
    legL: { fore: 0.08 * sag, lift: 0, splay: 0.03 * sag },
    legR: { fore: -0.04 * sag, lift: 0, splay: 0.03 * sag },
    cracks: span(progress, 0.2, DEATH_BREAK_PROGRESS) * 3,
    dust: 0.4 * span(progress, 0.25, DEATH_BREAK_PROGRESS),
    blink: sag > 0.5 ? 1 : 0,
    time: progress,
  };
}

function paintDeath(
  ctx: CanvasRenderingContext2D,
  view: CretinView,
  variant: CretinVariant,
  frame: number,
): void {
  const progress = shotProgress(frame, CRETIN_DEATH_FRAMES);
  if (progress < DEATH_BREAK_PROGRESS) {
    drawCretin(ctx, view, deathSagPose(progress), variant);
    const shed = span(progress, DEATH_SHED_START, DEATH_BREAK_PROGRESS);
    if (shed > 0) drawCretinShedStones(ctx, view, variant, shed);
    return;
  }
  const fall = span(progress, DEATH_BREAK_PROGRESS, DEATH_SETTLED_PROGRESS);
  const dust = 1 - span(progress, DEATH_BREAK_PROGRESS, DEATH_DUST_CLEAR_PROGRESS);
  drawCretinRubble(ctx, view, variant, fall, dust);
}

// ── Row table ────────────────────────────────────────────────────────────────

export type CretinRowKind = 'loop' | 'oneShot';

/** Every row a Cretin has, in each of its three views. */
export type CretinAction = 'idle' | 'walk' | 'punch' | 'cast_shield' | 'robot' | 'hurt' | 'death';

export const CRETIN_ACTIONS: readonly CretinAction[] = [
  'idle',
  'walk',
  'punch',
  'cast_shield',
  'robot',
  'hurt',
  'death',
];

export interface CretinRowSpec {
  readonly action: CretinAction;
  readonly frameCount: number;
  readonly kind: CretinRowKind;
  /** The frame the row's event lands on — the hit, the cast, the corpse — or null. */
  readonly eventFrame: number | null;
  /** The pose a frame shows; null on rows that are not a posed body throughout (the death). */
  readonly pose: ((frame: number) => CretinPose) | null;
}

export const CRETIN_ROWS: Readonly<Record<CretinAction, CretinRowSpec>> = {
  idle: {
    action: 'idle',
    frameCount: CRETIN_IDLE_FRAMES,
    kind: 'loop',
    eventFrame: null,
    pose: (f) => idlePose(cyclePhase(f, CRETIN_IDLE_FRAMES), f),
  },
  walk: {
    action: 'walk',
    frameCount: CRETIN_WALK_FRAMES,
    kind: 'loop',
    eventFrame: null,
    pose: (f) => walkPose(cyclePhase(f, CRETIN_WALK_FRAMES)),
  },
  punch: {
    action: 'punch',
    frameCount: CRETIN_PUNCH_FRAMES,
    kind: 'oneShot',
    eventFrame: CRETIN_PUNCH_IMPACT_FRAME,
    pose: (f) => punchPose(shotProgress(f, CRETIN_PUNCH_FRAMES)),
  },
  cast_shield: {
    action: 'cast_shield',
    frameCount: CRETIN_CAST_SHIELD_FRAMES,
    kind: 'oneShot',
    eventFrame: CRETIN_CAST_SHIELD_CAST_FRAME,
    pose: (f) => castPose(shotProgress(f, CRETIN_CAST_SHIELD_FRAMES)),
  },
  robot: {
    action: 'robot',
    frameCount: CRETIN_ROBOT_FRAMES,
    kind: 'loop',
    eventFrame: null,
    pose: robotPose,
  },
  hurt: {
    action: 'hurt',
    frameCount: CRETIN_HURT_FRAMES,
    kind: 'oneShot',
    eventFrame: null,
    pose: (f) => hurtPose(shotProgress(f, CRETIN_HURT_FRAMES)),
  },
  death: {
    action: 'death',
    frameCount: CRETIN_DEATH_FRAMES,
    kind: 'oneShot',
    eventFrame: CRETIN_DEATH_FRAMES - 1,
    pose: null,
  },
};

/** The pose a death frame shows while the body is still whole; null once it is rubble. */
export function deathPoseAt(frame: number): CretinPose | null {
  const progress = shotProgress(frame, CRETIN_DEATH_FRAMES);
  return progress < DEATH_BREAK_PROGRESS ? deathSagPose(progress) : null;
}

export const CRETIN_VIEWS: readonly CretinView[] = ['front', 'side', 'away'];

/** The state name a row takes in a view. */
export function cretinStateName(action: CretinAction, view: CretinView): string {
  if (view === 'side') return `${action}_side`;
  if (view === 'away') return `${action}_away`;
  return action;
}

interface ResolvedState {
  readonly row: CretinRowSpec;
  readonly view: CretinView;
}

const STATE_INDEX: ReadonlyMap<string, ResolvedState> = new Map(
  CRETIN_ACTIONS.flatMap((action) =>
    CRETIN_VIEWS.map((view): [string, ResolvedState] => [
      cretinStateName(action, view),
      { row: CRETIN_ROWS[action], view },
    ]),
  ),
);

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 48;

/**
 * The cell every Cretin pose is painted into. Wide enough for the robot's arm
 * held straight out to the side and the punch at full extension edge-on; tall
 * enough for the shield cast's glyph over the raised hands. The structural gate
 * fails any pose that reaches an edge.
 */
export const CRETIN_FRAME_WIDTH = 140;
export const CRETIN_FRAME_HEIGHT = 180;
/** The cell row the soles stand on. */
export const CRETIN_GROUND_ROW = 168;
export const CRETIN_TILE_X = (CRETIN_FRAME_WIDTH - TILE_SCALE) / 2;
export const CRETIN_TILE_Y = CRETIN_GROUND_ROW - TILE_SCALE;

function paintCretinFrame(
  variant: CretinVariant,
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
): void {
  const resolved = STATE_INDEX.get(state);
  if (resolved === undefined) return;
  ctx.save();
  try {
    ctx.translate(CRETIN_FRAME_WIDTH / 2, CRETIN_GROUND_ROW);
    ctx.scale(TILE_SCALE * CRETIN_DRAW_SCALE, TILE_SCALE * CRETIN_DRAW_SCALE);
    const { row, view } = resolved;
    if (row.action === 'death') {
      paintDeath(ctx, view, variant, frame);
      return;
    }
    if (row.pose === null) return;
    drawCretin(ctx, view, row.pose(frame), variant);
  } finally {
    ctx.restore();
  }
}

function cretinFigureOf(variant: CretinVariant): FigureDef {
  const frames: Record<string, number> = {};
  for (const [state, { row }] of STATE_INDEX) frames[state] = row.frameCount;
  return {
    id: `cretin_${variant}`,
    frameWidth: CRETIN_FRAME_WIDTH,
    frameHeight: CRETIN_FRAME_HEIGHT,
    tileX: CRETIN_TILE_X,
    tileY: CRETIN_TILE_Y,
    tileScale: TILE_SCALE,
    states: figureStates(frames),
    paintFrame: (ctx, state, frame) => {
      paintCretinFrame(variant, ctx, state, frame);
    },
  };
}

export const CRETIN_FIGURES: Readonly<Record<CretinVariant, FigureDef>> = {
  sledge: cretinFigureOf('sledge'),
  bomo: cretinFigureOf('bomo'),
  clayton: cretinFigureOf('clayton'),
  very_sullen: cretinFigureOf('very_sullen'),
};

export { CRETIN_VARIANTS };

// ── The Shield dome ──────────────────────────────────────────────────────────

export type CretinShieldRow = 'appear' | 'hold' | 'fade';

export const CRETIN_SHIELD_ROWS: Readonly<Record<CretinShieldRow, number>> = {
  appear: CRETIN_SHIELD_APPEAR_FRAMES,
  hold: CRETIN_SHIELD_HOLD_FRAMES,
  fade: CRETIN_SHIELD_FADE_FRAMES,
};

function shieldLook(row: CretinShieldRow, frame: number): ShieldLook {
  if (row === 'appear') {
    const p = shotProgress(frame, CRETIN_SHIELD_APPEAR_FRAMES);
    return {
      rise: easeOut(p),
      strength: lerp(0.5, 1, p),
      phase: p * 0.5,
      breakup: 0,
      flash: 1 - p,
      pulse: 0,
    };
  }
  if (row === 'hold') {
    const p = cyclePhase(frame, CRETIN_SHIELD_HOLD_FRAMES);
    const beat = 0.5 + 0.5 * Math.cos(p * TWO_PI);
    return { rise: 1, strength: 0.88 + 0.12 * beat, phase: p, breakup: 0, flash: 0, pulse: beat };
  }
  const p = shotProgress(frame, CRETIN_SHIELD_FADE_FRAMES);
  // Down to a trace on the last frame, so whatever follows it — nothing — is
  // not a visible pop.
  const strength = clamp01((1 - p) * SHIELD_FADE_TAIL);
  return { rise: 1 + 0.04 * p, strength, phase: p * 0.5, breakup: p, flash: 0, pulse: 0 };
}

/** Scales the fade so it reaches full strength a little before its first frame and a trace on its last. */
const SHIELD_FADE_TAIL = 1.1;

/** The dome's cell, in its own cell pixels: sized to the dome plus its flash ring. */
const SHIELD_FRAME_WIDTH = 96;
const SHIELD_FRAME_HEIGHT = 112;
const SHIELD_GROUND_ROW = 100;

export const CRETIN_SHIELD_FIGURE: FigureDef = {
  id: 'cretin_shield',
  frameWidth: SHIELD_FRAME_WIDTH,
  frameHeight: SHIELD_FRAME_HEIGHT,
  tileX: (SHIELD_FRAME_WIDTH - TILE_SCALE) / 2,
  tileY: SHIELD_GROUND_ROW - TILE_SCALE,
  tileScale: TILE_SCALE,
  states: figureStates(CRETIN_SHIELD_ROWS),
  paintFrame: (ctx, state, frame) => {
    const row = (['appear', 'hold', 'fade'] as const).find((name) => name === state);
    if (row === undefined) return;
    ctx.save();
    try {
      ctx.translate(SHIELD_FRAME_WIDTH / 2, SHIELD_GROUND_ROW);
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawCretinShield(ctx, shieldLook(row, frame));
    } finally {
      ctx.restore();
    }
  },
};
