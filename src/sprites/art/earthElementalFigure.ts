/**
 * The Earth Elementals as painted figures: the choreography, the cell geometry, and the
 * `FigureDef`s the runtime cache and the review harness draw through — one per
 * Earth Elemental, plus the amber Shield dome they cast.
 *
 * One row table for both on purpose. They are one species with one body;
 * what tells Crush from Hammer Hands is paint (stone colour, head shape, and
 * what each wears, the mercenary armband among it), and a cell is keyed on figure, state and frame, so each Earth
 * Elemental is its own figure painted from the same rows.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, and where a pose sits in its cell. Anatomy and paint live in
 * `earthElementalArt.ts` and `earthElementalShieldArt.ts`.
 *
 * Rows, each in three views (`<row>`, `<row>_side`, `<row>_away`):
 *    idle, walk, punch, cast_shield, hurt, death
 *
 * The art invariants live in `scripts/gates-earth-elemental.ts`, which the review harness
 * runs: `npm run render:earth-elemental`.
 */

import {
  ANKLE_Y,
  EARTH_ELEMENTAL_VARIANTS,
  HIP_Y,
  LEG_REACH,
  REST_ARM,
  type EarthElementalArmPose,
  type EarthElementalPose,
  type EarthElementalVariant,
  type EarthElementalView,
  drawEarthElemental,
  drawEarthElementalRubble,
  drawEarthElementalShedStones,
  restPose,
} from './earthElementalArt';
import { type ShieldLook, drawEarthElementalShield } from './earthElementalShieldArt';
import { clamp01, deg, easeInOut, easeOut, hump, lerp } from './bipedArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  EARTH_ELEMENTAL_CAST_SHIELD_CAST_FRAME,
  EARTH_ELEMENTAL_CAST_SHIELD_FRAMES,
  EARTH_ELEMENTAL_DEATH_FRAMES,
  EARTH_ELEMENTAL_DRAW_SCALE,
  EARTH_ELEMENTAL_HURT_FRAMES,
  EARTH_ELEMENTAL_IDLE_BLINK_FRAME,
  EARTH_ELEMENTAL_IDLE_FRAMES,
  EARTH_ELEMENTAL_PUNCH_FRAMES,
  EARTH_ELEMENTAL_PUNCH_IMPACT_FRAME,
  EARTH_ELEMENTAL_SHIELD_APPEAR_FRAMES,
  EARTH_ELEMENTAL_SHIELD_FADE_FRAMES,
  EARTH_ELEMENTAL_SHIELD_HOLD_FRAMES,
  EARTH_ELEMENTAL_WALK_FRAMES,
  EARTH_ELEMENTAL_WALK_REACH,
  EARTH_ELEMENTAL_WALK_STANCE_SHARE,
} from '../earthElementalTiming';

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

function arm(swing: number, flare: number, bend: number, clench: number): EarthElementalArmPose {
  return { swing, flare, bend, clench };
}

function mixArm(
  a: EarthElementalArmPose,
  b: EarthElementalArmPose,
  t: number,
): EarthElementalArmPose {
  return {
    swing: lerp(a.swing, b.swing, t),
    flare: lerp(a.flare, b.flare, t),
    bend: lerp(a.bend, b.bend, t),
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
  if (cycle < EARTH_ELEMENTAL_WALK_STANCE_SHARE) {
    // Through stance the foot slides back at exactly the rate the body is
    // carried over it, which is what holds it still on the floor.
    const t = cycle / EARTH_ELEMENTAL_WALK_STANCE_SHARE;
    return {
      fore: lerp(EARTH_ELEMENTAL_WALK_REACH, -EARTH_ELEMENTAL_WALK_REACH, t),
      lift: 0,
      planted: true,
    };
  }
  const t = (cycle - EARTH_ELEMENTAL_WALK_STANCE_SHARE) / (1 - EARTH_ELEMENTAL_WALK_STANCE_SHARE);
  return {
    fore: lerp(-EARTH_ELEMENTAL_WALK_REACH, EARTH_ELEMENTAL_WALK_REACH, easeInOut(t)),
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

function walkArm(drive: number): EarthElementalArmPose {
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

export function walkPose(phase: number): EarthElementalPose {
  const right = walkFoot(phase);
  const left = walkFoot(phase + 0.5);
  const angle = phase * TWO_PI;
  // Same-side arm is furthest back at that foot's contact: a cosine of the
  // gait phase, never a sine, or the arms run a quarter cycle late.
  const rightDrive = -Math.cos(angle);
  const stanceCentre = (EARTH_ELEMENTAL_WALK_STANCE_SHARE / 2) * TWO_PI;
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
    time: phase,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/** How far the shoulders lift on each breath, tiles: a pixel at the game's tile. */
const IDLE_RISE = 0.032;
const IDLE_ARM_FLARE = deg(2.5);

/**
 * The chest fills a quarter of a breath before the shoulders lift with it,
 * so no two frames either side of the breath's turn paint the same picture.
 */
const IDLE_FILL_LEAD = Math.PI / 2;

/**
 * Standing still: the breath swells his chest, flares his arms and lifts his
 * shoulders, and nothing moves sideways. A sway, a tilt or a head turning to
 * and fro once a breath reads as a figure dancing on the spot.
 */
function idlePose(phase: number, frame: number): EarthElementalPose {
  const angle = phase * TWO_PI;
  const lift = 0.5 - 0.5 * Math.cos(angle);
  const fill = 0.5 - 0.5 * Math.cos(angle + IDLE_FILL_LEAD);
  return {
    ...restPose(),
    breathe: fill,
    rise: IDLE_RISE * lift,
    armR: { ...REST_ARM, flare: REST_ARM.flare + IDLE_ARM_FLARE * fill },
    armL: { ...REST_ARM, flare: REST_ARM.flare + IDLE_ARM_FLARE * fill },
    blink: frame === EARTH_ELEMENTAL_IDLE_BLINK_FRAME ? 1 : 0,
    time: phase,
  };
}

// ── Punch ────────────────────────────────────────────────────────────────────

/** Progress at which the fist lands: the middle of the impact frame. */
export const PUNCH_IMPACT_PROGRESS = shotProgress(
  EARTH_ELEMENTAL_PUNCH_IMPACT_FRAME,
  EARTH_ELEMENTAL_PUNCH_FRAMES,
);
const PUNCH_COCK_END = 0.34;
/** Raises the impact burst to a power so it flashes on the impact frame and is nearly gone by the next. */
const PUNCH_BURST_SHARPNESS = 4;

const PUNCH_COCKED = arm(deg(-40), deg(26), deg(118), 1);
/**
 * Crossing in toward the centre line at full extension: a straight right lands
 * in front of the chest, and head-on a fist out beside the head reads as a
 * wave rather than a punch.
 */
const PUNCH_EXTENDED = arm(deg(86), deg(-14), deg(6), 1);
const GUARD = arm(deg(32), deg(14), deg(112), 1);

function punchPose(progress: number): EarthElementalPose {
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
    time: progress,
  };
}

// ── Shield cast ──────────────────────────────────────────────────────────────

export const CAST_PROGRESS = shotProgress(
  EARTH_ELEMENTAL_CAST_SHIELD_CAST_FRAME,
  EARTH_ELEMENTAL_CAST_SHIELD_FRAMES,
);
const CAST_RAISE_END = 0.5;
/** How quickly the glyph goes out after the cast, as row progress: gone before the hands come down. */
const CAST_GLYPH_FADE = 0.2;

const CAST_RAISED = arm(deg(152), deg(24), deg(22), 0.1);

function castPose(progress: number): EarthElementalPose {
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

// ── Hurt ─────────────────────────────────────────────────────────────────────

const HURT_PEAK = 0.32;

function hurtPose(progress: number): EarthElementalPose {
  const flinch =
    progress < HURT_PEAK
      ? easeOut(progress / HURT_PEAK)
      : 1 - easeInOut((progress - HURT_PEAK) / (1 - HURT_PEAK));
  // The arms recoil back and out with the body, away from the blow; thrown
  // forward they read as a reach.
  const flinchArm = arm(deg(-22), deg(30), deg(55), 1);
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

function deathSagPose(progress: number): EarthElementalPose {
  const sag = easeInOut(span(progress, 0, DEATH_BREAK_PROGRESS));
  const slack = arm(deg(24), deg(18), deg(24), 0.4);
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
  view: EarthElementalView,
  variant: EarthElementalVariant,
  frame: number,
): void {
  const progress = shotProgress(frame, EARTH_ELEMENTAL_DEATH_FRAMES);
  if (progress < DEATH_BREAK_PROGRESS) {
    drawEarthElemental(ctx, view, deathSagPose(progress), variant);
    const shed = span(progress, DEATH_SHED_START, DEATH_BREAK_PROGRESS);
    if (shed > 0) drawEarthElementalShedStones(ctx, view, variant, shed);
    return;
  }
  const fall = span(progress, DEATH_BREAK_PROGRESS, DEATH_SETTLED_PROGRESS);
  const dust = 1 - span(progress, DEATH_BREAK_PROGRESS, DEATH_DUST_CLEAR_PROGRESS);
  drawEarthElementalRubble(ctx, view, variant, fall, dust);
}

// ── Row table ────────────────────────────────────────────────────────────────

export type EarthElementalRowKind = 'loop' | 'oneShot';

/** Every row an Earth Elemental has, in each of its three views. */
export type EarthElementalAction = 'idle' | 'walk' | 'punch' | 'cast_shield' | 'hurt' | 'death';

export const EARTH_ELEMENTAL_ACTIONS: readonly EarthElementalAction[] = [
  'idle',
  'walk',
  'punch',
  'cast_shield',
  'hurt',
  'death',
];

export interface EarthElementalRowSpec {
  readonly action: EarthElementalAction;
  readonly frameCount: number;
  readonly kind: EarthElementalRowKind;
  /** The frame the row's event lands on — the hit, the cast, the corpse — or null. */
  readonly eventFrame: number | null;
  /** The pose a frame shows; null on rows that are not a posed body throughout (the death). */
  readonly pose: ((frame: number) => EarthElementalPose) | null;
}

export const EARTH_ELEMENTAL_ROWS: Readonly<Record<EarthElementalAction, EarthElementalRowSpec>> = {
  idle: {
    action: 'idle',
    frameCount: EARTH_ELEMENTAL_IDLE_FRAMES,
    kind: 'loop',
    eventFrame: null,
    pose: (f) => idlePose(cyclePhase(f, EARTH_ELEMENTAL_IDLE_FRAMES), f),
  },
  walk: {
    action: 'walk',
    frameCount: EARTH_ELEMENTAL_WALK_FRAMES,
    kind: 'loop',
    eventFrame: null,
    pose: (f) => walkPose(cyclePhase(f, EARTH_ELEMENTAL_WALK_FRAMES)),
  },
  punch: {
    action: 'punch',
    frameCount: EARTH_ELEMENTAL_PUNCH_FRAMES,
    kind: 'oneShot',
    eventFrame: EARTH_ELEMENTAL_PUNCH_IMPACT_FRAME,
    pose: (f) => punchPose(shotProgress(f, EARTH_ELEMENTAL_PUNCH_FRAMES)),
  },
  cast_shield: {
    action: 'cast_shield',
    frameCount: EARTH_ELEMENTAL_CAST_SHIELD_FRAMES,
    kind: 'oneShot',
    eventFrame: EARTH_ELEMENTAL_CAST_SHIELD_CAST_FRAME,
    pose: (f) => castPose(shotProgress(f, EARTH_ELEMENTAL_CAST_SHIELD_FRAMES)),
  },
  hurt: {
    action: 'hurt',
    frameCount: EARTH_ELEMENTAL_HURT_FRAMES,
    kind: 'oneShot',
    eventFrame: null,
    pose: (f) => hurtPose(shotProgress(f, EARTH_ELEMENTAL_HURT_FRAMES)),
  },
  death: {
    action: 'death',
    frameCount: EARTH_ELEMENTAL_DEATH_FRAMES,
    kind: 'oneShot',
    eventFrame: EARTH_ELEMENTAL_DEATH_FRAMES - 1,
    pose: null,
  },
};

/** The pose a death frame shows while the body is still whole; null once it is rubble. */
export function deathPoseAt(frame: number): EarthElementalPose | null {
  const progress = shotProgress(frame, EARTH_ELEMENTAL_DEATH_FRAMES);
  return progress < DEATH_BREAK_PROGRESS ? deathSagPose(progress) : null;
}

export const EARTH_ELEMENTAL_VIEWS: readonly EarthElementalView[] = ['front', 'side', 'away'];

/** The state name a row takes in a view. */
export function earthElementalStateName(
  action: EarthElementalAction,
  view: EarthElementalView,
): string {
  if (view === 'side') return `${action}_side`;
  if (view === 'away') return `${action}_away`;
  return action;
}

interface ResolvedState {
  readonly row: EarthElementalRowSpec;
  readonly view: EarthElementalView;
}

const STATE_INDEX: ReadonlyMap<string, ResolvedState> = new Map(
  EARTH_ELEMENTAL_ACTIONS.flatMap((action) =>
    EARTH_ELEMENTAL_VIEWS.map((view): [string, ResolvedState] => [
      earthElementalStateName(action, view),
      { row: EARTH_ELEMENTAL_ROWS[action], view },
    ]),
  ),
);

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 48;

/**
 * The cell every Earth Elemental pose is painted into. Wide enough for the punch at
 * full extension edge-on; tall
 * enough for the shield cast's glyph over the raised hands. The structural gate
 * fails any pose that reaches an edge.
 */
export const EARTH_ELEMENTAL_FRAME_WIDTH = 140;
export const EARTH_ELEMENTAL_FRAME_HEIGHT = 180;
/** The cell row the soles stand on. */
export const EARTH_ELEMENTAL_GROUND_ROW = 168;
export const EARTH_ELEMENTAL_TILE_X = (EARTH_ELEMENTAL_FRAME_WIDTH - TILE_SCALE) / 2;
export const EARTH_ELEMENTAL_TILE_Y = EARTH_ELEMENTAL_GROUND_ROW - TILE_SCALE;

function paintEarthElementalFrame(
  variant: EarthElementalVariant,
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
): void {
  const resolved = STATE_INDEX.get(state);
  if (resolved === undefined) return;
  ctx.save();
  try {
    ctx.translate(EARTH_ELEMENTAL_FRAME_WIDTH / 2, EARTH_ELEMENTAL_GROUND_ROW);
    ctx.scale(TILE_SCALE * EARTH_ELEMENTAL_DRAW_SCALE, TILE_SCALE * EARTH_ELEMENTAL_DRAW_SCALE);
    const { row, view } = resolved;
    if (row.action === 'death') {
      paintDeath(ctx, view, variant, frame);
      return;
    }
    if (row.pose === null) return;
    drawEarthElemental(ctx, view, row.pose(frame), variant);
  } finally {
    ctx.restore();
  }
}

function earthElementalFigureOf(variant: EarthElementalVariant): FigureDef {
  const frames: Record<string, number> = {};
  for (const [state, { row }] of STATE_INDEX) frames[state] = row.frameCount;
  return {
    id: `earth_elemental_${variant}`,
    frameWidth: EARTH_ELEMENTAL_FRAME_WIDTH,
    frameHeight: EARTH_ELEMENTAL_FRAME_HEIGHT,
    tileX: EARTH_ELEMENTAL_TILE_X,
    tileY: EARTH_ELEMENTAL_TILE_Y,
    tileScale: TILE_SCALE,
    states: figureStates(frames),
    paintFrame: (ctx, state, frame) => {
      paintEarthElementalFrame(variant, ctx, state, frame);
    },
  };
}

export const EARTH_ELEMENTAL_FIGURES: Readonly<Record<EarthElementalVariant, FigureDef>> = {
  crush: earthElementalFigureOf('crush'),
  hammer_hands: earthElementalFigureOf('hammer_hands'),
};

export { EARTH_ELEMENTAL_VARIANTS };

// ── The Shield dome ──────────────────────────────────────────────────────────

export type EarthElementalShieldRow = 'appear' | 'hold' | 'fade';

export const EARTH_ELEMENTAL_SHIELD_ROWS: Readonly<Record<EarthElementalShieldRow, number>> = {
  appear: EARTH_ELEMENTAL_SHIELD_APPEAR_FRAMES,
  hold: EARTH_ELEMENTAL_SHIELD_HOLD_FRAMES,
  fade: EARTH_ELEMENTAL_SHIELD_FADE_FRAMES,
};

function shieldLook(row: EarthElementalShieldRow, frame: number): ShieldLook {
  if (row === 'appear') {
    const p = shotProgress(frame, EARTH_ELEMENTAL_SHIELD_APPEAR_FRAMES);
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
    const p = cyclePhase(frame, EARTH_ELEMENTAL_SHIELD_HOLD_FRAMES);
    const beat = 0.5 + 0.5 * Math.cos(p * TWO_PI);
    return { rise: 1, strength: 0.88 + 0.12 * beat, phase: p, breakup: 0, flash: 0, pulse: beat };
  }
  const p = shotProgress(frame, EARTH_ELEMENTAL_SHIELD_FADE_FRAMES);
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

export const EARTH_ELEMENTAL_SHIELD_FIGURE: FigureDef = {
  id: 'earth_elemental_shield',
  frameWidth: SHIELD_FRAME_WIDTH,
  frameHeight: SHIELD_FRAME_HEIGHT,
  tileX: (SHIELD_FRAME_WIDTH - TILE_SCALE) / 2,
  tileY: SHIELD_GROUND_ROW - TILE_SCALE,
  tileScale: TILE_SCALE,
  states: figureStates(EARTH_ELEMENTAL_SHIELD_ROWS),
  paintFrame: (ctx, state, frame) => {
    const row = (['appear', 'hold', 'fade'] as const).find((name) => name === state);
    if (row === undefined) return;
    ctx.save();
    try {
      ctx.translate(SHIELD_FRAME_WIDTH / 2, SHIELD_GROUND_ROW);
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawEarthElementalShield(ctx, shieldLook(row, frame));
    } finally {
      ctx.restore();
    }
  },
};
