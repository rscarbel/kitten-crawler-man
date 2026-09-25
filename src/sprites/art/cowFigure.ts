/**
 * Cows and calves as painted figures: the choreography, the cell geometry, and
 * the six `FigureDef`s the runtime cache and the review harness draw through.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, and the placement of a pose or a gore piece inside its cell.
 * Anatomy, colour and every stroke of paint live in `cowArt.ts`, the six looks
 * in `cowLooks.ts`, the severed pieces in `cowGore.ts`.
 *
 * Rows (each in three views — `name`, `name_side`, `name_away` — except the
 * lying rows, which have a front and a side only):
 *
 *    walk      — a lateral-sequence walk, driven by distance
 *    idle      — chewing cud, ear flicks, a tail swish, a weight shift
 *    graze     — head down, a tear and a chew, a shifting forefoot
 *    happy     — the reaction to being petted; a calf's is a bucking zoomie
 *    flinch    — the startle at a nearby blast, leading into the trot
 *    trot      — the panic run, driven by distance
 *    lie       — lying down, held
 *    lie_down  — the transition into it, forequarters first
 *
 * plus one single-frame state per severed piece, which is how
 * `BodyPartGoreSystem` asks for them.
 *
 * The art invariants live in `scripts/gates-cow.ts`, which the review harness
 * runs: `npm run render:cow`.
 */

import {
  type CowBuild,
  type CowFootName,
  cowSideLegs,
  type CowFootPose,
  type CowLook,
  type CowPose,
  type CowView,
  drawCow,
  restCowPose,
} from './cowArt';
import { clamp01, deg, easeInOut, hump, lerp } from './carlArt';
import {
  ADULT_COW_BUILD,
  CALF_BUILD,
  COW_AGES,
  COW_COATS,
  type CowAge,
  type CowCoatId,
  cowFigureId,
  cowLookOf,
} from './cowLooks';
import { type CowGorePiece, cowGorePieces } from './cowGore';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  COW_FLINCH_FRAMES,
  COW_GRAZE_FRAMES,
  COW_HAPPY_FRAMES,
  COW_IDLE_FRAMES,
  COW_LIE_DOWN_FRAMES,
  COW_LIE_FRAMES,
  COW_TROT_FRAMES,
  COW_WALK_FRAMES,
} from '../cowTiming';

const TWO_PI = Math.PI * 2;

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * The cell every pose and gore piece is painted into, and where the animal's
 * own tile sits inside it.
 *
 * Wide because an adult cow is most of two tiles long and the profile is
 * mirrored about the tile's centre, so the cell must clear the muzzle on one
 * side and a raised tail on the other; tall enough for a tossed head with
 * upswept horns. The gates fail anything that paints against an edge, which is
 * what says a pose has outgrown it.
 */
export const COW_FRAME_WIDTH = 160;
export const COW_FRAME_HEIGHT = 112;
export const COW_TILE_X = (COW_FRAME_WIDTH - TILE_SCALE) / 2;
export const COW_TILE_Y = 40;

// ── Pose helpers ─────────────────────────────────────────────────────────────

function wrap01(t: number): number {
  return ((t % 1) + 1) % 1;
}

/** A linear 0→1 progress through a window, clamped. */
function span(t: number, start: number, end: number): number {
  return clamp01((t - start) / (end - start));
}

const BLINK_HOLD = 0.06;

/** A blink centred on `at`, in cycle phase: 1 open, dipping to 0. */
function blink(phase: number, at: number): number {
  const distance = Math.abs(wrap01(phase - at + 0.5) - 0.5);
  return distance < BLINK_HOLD ? clamp01(distance / BLINK_HOLD) : 1;
}

/** A quick flick back of one ear, centred on `at`, as an ear value. */
function earFlick(phase: number, at: number, width: number): number {
  const distance = Math.abs(wrap01(phase - at + 0.5) - 0.5);
  return distance < width ? -0.9 * hump(0.5 + (0.5 * distance) / width) : 0;
}

/**
 * One hoof through a gait cycle: a swing forward over `swingShare` of the
 * cycle, then a stance sliding back at a constant rate.
 *
 * The stance must be linear. A planted hoof is fixed to the ground, the body
 * moves over it at a constant speed, so in the body's frame the hoof slides back
 * at a constant speed too — any easing here is a hoof skating on the grass.
 */
export function strideFoot(
  phase: number,
  offset: number,
  reach: number,
  height: number,
  swingShare: number,
): CowFootPose {
  const cycle = wrap01(phase - offset);
  if (cycle < swingShare) {
    const t = cycle / swingShare;
    const lift = hump(t);
    return { dx: lerp(-reach, reach, easeInOut(t)), dy: -lift * height, lift };
  }
  const t = (cycle - swingShare) / (1 - swingShare);
  return { dx: lerp(reach, -reach, t), dy: 0, lift: 0 };
}

/** Ground covered per cycle by a stride of `reach` either side of the root. */
export function tilesPerCycle(reach: number, swingShare: number): number {
  return (2 * reach) / (1 - swingShare);
}

// ── Walk ─────────────────────────────────────────────────────────────────────

/**
 * The walk's footfall order: left hind, left fore, right hind, right fore.
 *
 * Cattle walk in a lateral sequence — each fore leaves the ground a quarter
 * cycle after the hind on its own side — and it is what makes the gait look
 * like a heavy animal plodding rather than a dog trotting. The gait-order gate
 * holds it.
 */
export const WALK_LIFT_ORDER = { hindL: 0, frontL: 0.25, hindR: 0.5, frontR: 0.75 } as const;

/** Share of the cycle a walking hoof is in the air: a walk never has a flight phase. */
export const WALK_SWING_SHARE = 0.3;
const TROT_SWING_SHARE = 0.42;

interface GaitSize {
  readonly walkReach: number;
  readonly walkLift: number;
  readonly trotReach: number;
  readonly trotLift: number;
}

/**
 * Stride sizes. The reach is the hoof's travel either side of where it rests,
 * kept well inside what the leg can extend to; the ground a cycle covers is
 * derived from it, never chosen, and frozen in `cowTiming.ts` for the runtime.
 */
export const GAIT_SIZES: Readonly<Record<CowAge, GaitSize>> = {
  adult: { walkReach: 0.28, walkLift: 0.07, trotReach: 0.3, trotLift: 0.1 },
  calf: { walkReach: 0.21, walkLift: 0.06, trotReach: 0.22, trotLift: 0.08 },
};

const BUILDS: Readonly<Record<CowAge, CowBuild>> = { adult: ADULT_COW_BUILD, calf: CALF_BUILD };

/** Refinement passes; each one halves what the pitch's own pivot shift leaves behind. */
const PLANTED_DROP_PASSES = 4;
/** Guards a build whose pivots coincide. */
const MIN_PIVOT_SPAN = 1e-3;

/** Kept off a leg's full length, so a planted leg is never solved dead straight. */
const PLANTED_LEG_SLACK = 0.004;

/**
 * How far the body must sink, and pitch, for every planted hoof to stay on the
 * ground within its leg's reach.
 *
 * A walker is an inverted pendulum: the body rides highest over a leg at
 * mid-stance and lowest at double support, when the hooves are spread fore and
 * aft. A stride long enough to cover the ground a cow really covers puts a
 * planted hoof further from its pivot than the leg is long, so without this the
 * leg would stretch, or the walk would have to shorten into a patter.
 *
 * Exported so another bovine's gait rows can keep its own hooves planted.
 */
export function plantedDrop(b: CowBuild, pose: CowPose): { bob: number; pitch: number } {
  const span = Math.max(b.foreRoot.x - b.hindRoot.x, MIN_PIVOT_SPAN);
  let bob = 0;
  let pitch = 0;
  // Solved through the pose's own body frame — its bob, breathing and pitch —
  // and refined, because pitching the body to lower one pair also moves the
  // pivots it is measured from.
  for (let pass = 0; pass < PLANTED_DROP_PASSES; pass++) {
    const legs = cowSideLegs({ ...pose, bob: pose.bob + bob, pitch: pose.pitch + pitch }, b);
    let fore = 0;
    let hind = 0;
    for (const leg of legs) {
      if (pose[leg.foot].lift > 0) continue;
      const reach = leg.length - PLANTED_LEG_SLACK;
      const across = leg.hoof.x - leg.root.x;
      const standing = Math.sqrt(Math.max(0, reach * reach - across * across));
      const drop = Math.max(0, leg.hoof.y - leg.root.y - standing);
      if (leg.foot === 'frontL' || leg.foot === 'frontR') fore = Math.max(fore, drop);
      else hind = Math.max(hind, drop);
    }
    // The body pitches about its centre; a lower forehand tips the nose down.
    bob += (fore + hind) / 2;
    pitch += Math.atan((fore - hind) / span);
  }
  return { bob, pitch };
}

/**
 * Adds the pendulum sink and pitch a gait pose needs to keep its planted hooves
 * down, then lifts any swinging hoof the leg still cannot reach — near the ends
 * of a long swing the hoof is barely off the ground and a stride's length from
 * its pivot, and it clears the grass a little higher rather than stretching the
 * leg to it.
 */
function withPlantedHooves(pose: CowPose, age: CowAge): CowPose {
  const build = BUILDS[age];
  const drop = plantedDrop(build, pose);
  const sunk: CowPose = { ...pose, bob: pose.bob + drop.bob, pitch: pose.pitch + drop.pitch };
  const lifted: Partial<Record<CowFootName, CowFootPose>> = {};
  for (const leg of cowSideLegs(sunk, build)) {
    const foot = sunk[leg.foot];
    if (foot.lift <= 0) continue;
    const reach = leg.length - PLANTED_LEG_SLACK;
    const across = leg.hoof.x - leg.root.x;
    const standing = Math.sqrt(Math.max(0, reach * reach - across * across));
    const excess = leg.hoof.y - leg.root.y - standing;
    if (excess > 0) lifted[leg.foot] = { ...foot, dy: foot.dy - excess };
  }
  return { ...sunk, ...lifted };
}

const WALK_BOB = 0.008;
const WALK_NOD = deg(5);
/** The fore hooves plant at these phases; the head nods down with each. */
const FORE_PLANT_PHASE = WALK_LIFT_ORDER.frontR + WALK_SWING_SHARE - 1;

function walkPose(phase: number, age: CowAge): CowPose {
  const size = GAIT_SIZES[age];
  const angle = phase * TWO_PI;
  const nod = Math.cos(2 * TWO_PI * (phase - FORE_PLANT_PHASE));
  const foot = (offset: number): CowFootPose =>
    strideFoot(phase, offset, size.walkReach, size.walkLift, WALK_SWING_SHARE);
  return {
    ...restCowPose(),
    bob: WALK_BOB * nod,
    sway: 0.012 * Math.sin(angle),
    roll: deg(2) * Math.sin(angle),
    pitch: deg(0.8) * nod,
    neck: WALK_NOD * nod,
    headPitch: deg(2) * Math.sin(2 * angle),
    headTurn: 0.1 * Math.sin(angle),
    earL: 0.15 * Math.sin(angle * 2),
    earR: -0.15 * Math.sin(angle * 2),
    eyeOpen: blink(phase, 0.62),
    tailSwing: 0.35 * Math.sin(angle),
    hindL: foot(WALK_LIFT_ORDER.hindL),
    frontL: foot(WALK_LIFT_ORDER.frontL),
    hindR: foot(WALK_LIFT_ORDER.hindR),
    frontR: foot(WALK_LIFT_ORDER.frontR),
    breathe: Math.sin(angle),
    time: phase,
  };
}

// ── Trot ─────────────────────────────────────────────────────────────────────

/** The panic run: diagonal pairs, head up, ears back, tail out. */
function trotPose(phase: number, age: CowAge): CowPose {
  const size = GAIT_SIZES[age];
  const angle = phase * TWO_PI;
  const bounce = Math.abs(Math.sin(angle * 2 - 0.4));
  const foot = (offset: number): CowFootPose =>
    strideFoot(phase, offset, size.trotReach, size.trotLift, TROT_SWING_SHARE);
  return {
    ...restCowPose(),
    bob: -0.025 * bounce,
    sway: 0.018 * Math.sin(angle),
    roll: deg(3) * Math.sin(angle),
    pitch: deg(2) * Math.cos(angle * 2),
    neck: deg(-14) + deg(4) * Math.cos(angle * 2),
    headPitch: deg(-10) + deg(3) * Math.sin(angle * 2),
    headTurn: 0.08 * Math.sin(angle),
    earL: -0.7,
    earR: -0.6,
    tailLift: 0.45 + 0.1 * Math.sin(angle * 2),
    tailSwing: 0.5 * Math.sin(angle),
    frontL: foot(0),
    hindR: foot(0),
    frontR: foot(0.5),
    hindL: foot(0.5),
    breathe: Math.sin(angle * 2),
    time: phase,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/**
 * Chewing cycles per idle loop. Every sub-cycle in the idle divides the twelve
 * frames evenly — three chews of four frames, one swish and one weight shift of
 * twelve — so the loop closes with every motion in phase, and nothing runs
 * under four frames a cycle, below which it aliases into a strobe.
 */
const IDLE_CHEWS = 3;
const CHEW_DEPTH = 0.55;

function idlePose(phase: number): CowPose {
  const angle = phase * TWO_PI;
  const chew = 0.5 - 0.5 * Math.cos(angle * IDLE_CHEWS);
  return {
    ...restCowPose(),
    bob: 0.004 * Math.sin(angle),
    sway: 0.01 * Math.sin(angle),
    roll: deg(1.2) * Math.sin(angle),
    breathe: Math.sin(angle),
    neck: deg(3) * Math.sin(angle),
    headPitch: deg(2) * Math.cos(angle),
    headTurn: 0.25 * Math.sin(angle),
    headTilt: deg(3) * Math.sin(angle),
    jaw: CHEW_DEPTH * chew,
    jawSide: Math.sin(angle * IDLE_CHEWS),
    earL: earFlick(phase, 0.25, 0.13) + 0.1,
    earR: earFlick(phase, 0.7, 0.13) - 0.05,
    eyeOpen: blink(phase, 0.5),
    tailLift: 0.08,
    tailSwing: 0.8 * Math.sin(angle),
    time: phase,
  };
}

// ── Graze ────────────────────────────────────────────────────────────────────

/** How far the neck swings down from its carriage to reach the grass. */
const GRAZE_NECK = deg(66);
const GRAZE_PITCH = deg(4);
/** The tear takes the first third of the loop; two chews fill the rest. */
const GRAZE_TEAR_END = 1 / 3;
const GRAZE_CHEWS = 2;

function grazePose(phase: number, age: CowAge): CowPose {
  const angle = phase * TWO_PI;
  const tear = hump(span(phase, 0.02, GRAZE_TEAR_END));
  const chewing = span(phase, GRAZE_TEAR_END, 1);
  const chew = 0.5 - 0.5 * Math.cos(TWO_PI * GRAZE_CHEWS * chewing);
  const step = hump(span(phase, 0.42, 0.72));
  const reach = GAIT_SIZES[age].walkReach;
  return {
    ...restCowPose(),
    pitch: GRAZE_PITCH + deg(1.5) * Math.sin(angle),
    bob: 0.01 + 0.006 * Math.sin(angle),
    lunge: 0.01,
    breathe: Math.sin(angle),
    // The tear: the muzzle jerks up and to the side, pulling the grass.
    neck: GRAZE_NECK - deg(10) * tear,
    headPitch: deg(8) - deg(22) * tear,
    headTilt: deg(10) * tear,
    // A grazing cow sweeps its muzzle across the sward as it goes; head-on
    // and from behind that sweep and the weight shift are most of the motion.
    headTurn: 0.35 * tear + 0.3 * Math.sin(angle),
    sway: 0.014 * Math.sin(angle),
    roll: deg(1.5) * Math.sin(angle),
    jaw: chewing > 0 ? 0.5 * chew : 0.3 * tear,
    jawSide: Math.sin(TWO_PI * GRAZE_CHEWS * chewing),
    earL: 0.15 + earFlick(phase, 0.6, 0.12),
    earR: 0.1,
    eyeOpen: blink(phase, 0.85),
    tailLift: 0.05,
    tailSwing: 0.9 * Math.sin(angle + 1),
    // A forefoot shifts forward and settles back: the step a grazing cow takes
    // to reach the next mouthful.
    frontL: { dx: reach * 0.4 * step, dy: -0.05 * step, lift: step },
    frontR: { dx: reach * 0.25, dy: 0, lift: 0 },
    hindL: { dx: -reach * 0.1, dy: 0, lift: 0 },
    time: phase,
  };
}

// ── Happy ────────────────────────────────────────────────────────────────────

/** How long the row eases in and out of the rest pose it starts and ends on. */
function happyEnvelope(t: number): number {
  return easeInOut(span(t, 0, 0.12)) * (1 - easeInOut(span(t, 0.84, 1)));
}

/**
 * The petted cow: a little bounce on the forelegs, the tail up and wagging, the
 * ears perked forward, one toss of the head, and the eyes shut into a content
 * squint. Four wags over sixteen frames keeps each one four frames long.
 */
function happyAdult(t: number): CowPose {
  const on = happyEnvelope(t);
  const squint = easeInOut(span(t, 0.08, 0.22)) * (1 - easeInOut(span(t, 0.8, 0.95)));
  const hopA = hump(span(t, 0.12, 0.36));
  const hopB = 0.7 * hump(span(t, 0.4, 0.6));
  const hop = hopA + hopB;
  // A small kick of the heels as the forequarters come down: a grown cow's
  // frolic is a bounce and a skip, never the calf's full buck.
  const kick = hump(span(t, 0.3, 0.52));
  const toss = hump(span(t, 0.26, 0.58));
  const nod = hump(span(t, 0.58, 0.8));
  const WAGS = 4;
  const front = (side: number): CowFootPose => ({
    dx: 0.03 * hop * side,
    dy: -0.12 * hop,
    lift: clamp01(hop),
  });
  return {
    ...restCowPose(),
    bob: -0.035 * hop,
    pitch: -deg(11) * hop + deg(6) * kick,
    neck: -deg(24) * toss + deg(8) * nod,
    headPitch: -deg(22) * toss + deg(12) * nod,
    headTilt: deg(10) * toss,
    headTurn: 0.3 * toss,
    earL: on,
    earR: on * 0.9,
    eyeOpen: 1 - 0.95 * squint,
    // The tail comes up over the first few frames rather than snapping out.
    tailLift: 0.7 * easeInOut(span(t, 0.04, 0.3)) * on,
    tailSwing: Math.sin(TWO_PI * WAGS * t) * on,
    frontL: front(1),
    frontR: front(0.5),
    hindL: { dx: -0.06 * kick, dy: -0.07 * kick, lift: kick },
    time: t,
  };
}

/**
 * The petted calf: a bucking zoomie. A crouch, a leap with all four hooves off
 * the ground at its peak, the rump kicked up and the hind legs thrown back, a
 * landing, and a smaller second hop.
 */
function happyCalf(t: number): CowPose {
  const on = happyEnvelope(t);
  const crouch = hump(span(t, 0.02, 0.2)) + 0.6 * hump(span(t, 0.5, 0.6));
  const leap = hump(span(t, 0.16, 0.52));
  const buck = hump(span(t, 0.34, 0.58));
  const hop = 0.55 * hump(span(t, 0.58, 0.84));
  const squint = easeInOut(span(t, 0.1, 0.24)) * (1 - easeInOut(span(t, 0.82, 0.96)));
  const rise = 0.16 * leap + 0.07 * hop;
  const airborne = clamp01((leap + hop) * 1.4);
  // Every hoof leaves the ground, and rises further than the body does, so the
  // legs fold up under it rather than hanging at full stretch.
  const tuck = 0.09 * leap + 0.04 * hop;
  const hindKick = 0.13 * buck;
  const WAGS = 5;
  return {
    ...restCowPose(),
    bob: 0.03 * crouch - rise,
    pitch: deg(13) * buck - deg(8) * leap * (1 - buck),
    neck: deg(4) * buck - deg(12) * hop - deg(8) * leap,
    headPitch: deg(10) * buck - deg(16) * hop,
    headTilt: deg(10) * hop,
    earL: lerp(on, -0.5, buck),
    earR: lerp(on, 0.2, buck),
    eyeOpen: 1 - 0.7 * squint,
    tailLift: 0.9 * easeInOut(span(t, 0.04, 0.3)) * on,
    tailSwing: Math.sin(TWO_PI * WAGS * t) * on * 0.6,
    frontL: { dx: 0.03 * leap, dy: -(rise + tuck), lift: airborne },
    frontR: { dx: 0.01 * leap, dy: -(rise + tuck), lift: airborne },
    hindL: { dx: -hindKick, dy: -(rise + tuck) - 0.06 * buck, lift: airborne },
    hindR: { dx: -hindKick * 0.8, dy: -(rise + tuck) - 0.05 * buck, lift: airborne },
    time: t,
  };
}

// ── Flinch ───────────────────────────────────────────────────────────────────

/**
 * The startle at a nearby blast: the body jerks back and down, the head flies
 * up, the ears pin, the tail clamps, and a forefoot comes up — ending weighted
 * forward and head-high, the way the trot starts, so the hand-off does not pop.
 */
function flinchPose(t: number): CowPose {
  const jolt = easeInOut(span(t, 0, 0.35));
  const crouch = hump(span(t, 0, 0.55));
  const recover = easeInOut(span(t, 0.55, 1));
  const paw = hump(span(t, 0.25, 0.85));
  return {
    ...restCowPose(),
    lunge: -0.06 * jolt * (1 - recover) + 0.02 * recover,
    bob: 0.02 * crouch,
    pitch: -deg(4) * crouch,
    neck: lerp(-deg(14) * jolt, deg(-12), recover),
    headPitch: lerp(-deg(12) * jolt, deg(-10), recover),
    earL: -jolt,
    earR: -jolt * 0.9,
    tailLift: 0.35 * jolt,
    tailSwing: -0.5 * jolt,
    frontL: { dx: -0.05 * paw, dy: -0.07 * paw, lift: paw },
    hindL: { dx: -0.03 * jolt, dy: 0, lift: 0 },
    hindR: { dx: 0.02 * jolt, dy: 0, lift: 0 },
    time: t,
  };
}

// ── Lying ────────────────────────────────────────────────────────────────────

function liePose(): CowPose {
  return {
    ...restCowPose(),
    lowerFore: 1,
    lowerHind: 1,
    neck: deg(-4),
    headPitch: deg(-4),
    eyeOpen: 0.55,
    earL: -0.15,
    earR: 0.1,
    tailSwing: 0.4,
    time: 0,
  };
}

/**
 * Down onto the knees first, then the hindquarters — the order cattle always
 * lie down in, and the order that tells a viewer what they are watching.
 */
function lieDownPose(t: number): CowPose {
  const rest = liePose();
  const sniff = hump(span(t, 0, 0.6));
  const settle = easeInOut(span(t, 0.6, 1));
  return {
    ...restCowPose(),
    lowerFore: easeInOut(span(t, 0.1, 0.55)),
    lowerHind: easeInOut(span(t, 0.45, 0.95)),
    neck: deg(28) * sniff + rest.neck * settle,
    headPitch: deg(10) * sniff + rest.headPitch * settle,
    eyeOpen: lerp(1, rest.eyeOpen, settle),
    earL: rest.earL * settle,
    earR: rest.earR * settle,
    tailSwing: rest.tailSwing * settle,
    time: t,
  };
}

// ── Row manifest ─────────────────────────────────────────────────────────────

/** What the animal is doing; the state names are this plus a view suffix. */
export type CowAction =
  'walk' | 'idle' | 'graze' | 'happy' | 'flinch' | 'trot' | 'lie' | 'lie_down';

export type RowKind = 'loop' | 'oneShot' | 'hold';

export interface CowRowSpec {
  readonly name: string;
  readonly action: CowAction;
  readonly view: CowView;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly pose: (frame: number) => CowPose;
}

/** Views every action is painted in; the lying rows have no rear view. */
export const COW_VIEWS_BY_ACTION: Readonly<Record<CowAction, readonly CowView[]>> = {
  walk: ['front', 'side', 'back'],
  idle: ['front', 'side', 'back'],
  graze: ['front', 'side', 'back'],
  happy: ['front', 'side', 'back'],
  flinch: ['front', 'side', 'back'],
  trot: ['front', 'side', 'back'],
  lie: ['front', 'side'],
  lie_down: ['front', 'side'],
};

export const COW_ACTIONS: readonly CowAction[] = [
  'walk',
  'idle',
  'graze',
  'happy',
  'flinch',
  'trot',
  'lie',
  'lie_down',
];

/** The state name for an action seen from a view. */
export function cowStateName(action: CowAction, view: CowView): string {
  if (view === 'side') return `${action}_side`;
  if (view === 'back') return `${action}_away`;
  return action;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

/** A transition samples its own end on its last frame, so it hands over to the held pose. */
function transitionProgress(frame: number, frameCount: number): number {
  return (frame + 1) / frameCount;
}

interface ActionSpec {
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly pose: (frame: number, age: CowAge) => CowPose;
}

const ACTION_SPECS: Readonly<Record<CowAction, ActionSpec>> = {
  walk: {
    frameCount: COW_WALK_FRAMES,
    kind: 'loop',
    pose: (f, age) => withPlantedHooves(walkPose(cyclePhase(f, COW_WALK_FRAMES), age), age),
  },
  idle: {
    frameCount: COW_IDLE_FRAMES,
    kind: 'loop',
    pose: (f) => idlePose(cyclePhase(f, COW_IDLE_FRAMES)),
  },
  graze: {
    frameCount: COW_GRAZE_FRAMES,
    kind: 'loop',
    pose: (f, age) => grazePose(cyclePhase(f, COW_GRAZE_FRAMES), age),
  },
  happy: {
    frameCount: COW_HAPPY_FRAMES,
    kind: 'oneShot',
    // Through the same planted-hoof solve as the gaits: the adult's bounce
    // pitches the body over hind legs that stay on the ground.
    pose: (f, age) =>
      withPlantedHooves(
        age === 'adult'
          ? happyAdult(shotProgress(f, COW_HAPPY_FRAMES))
          : happyCalf(shotProgress(f, COW_HAPPY_FRAMES)),
        age,
      ),
  },
  flinch: {
    frameCount: COW_FLINCH_FRAMES,
    kind: 'oneShot',
    pose: (f, age) => withPlantedHooves(flinchPose(shotProgress(f, COW_FLINCH_FRAMES)), age),
  },
  trot: {
    frameCount: COW_TROT_FRAMES,
    kind: 'loop',
    pose: (f, age) => withPlantedHooves(trotPose(cyclePhase(f, COW_TROT_FRAMES), age), age),
  },
  lie: { frameCount: COW_LIE_FRAMES, kind: 'hold', pose: () => liePose() },
  lie_down: {
    frameCount: COW_LIE_DOWN_FRAMES,
    kind: 'oneShot',
    pose: (f) => lieDownPose(transitionProgress(f, COW_LIE_DOWN_FRAMES)),
  },
};

/**
 * Per-view adjustments to a pose. The axial views have no stride to show, so a
 * walking cow head-on sways and turns its head; a rear view keeps the head
 * still, because only its ear tips show over the rump and a turning head there
 * just shimmers.
 */
function poseForView(pose: CowPose, view: CowView): CowPose {
  if (view === 'side') return pose;
  if (view === 'back')
    return { ...pose, headTurn: 0, headTilt: 0, sway: -pose.sway, roll: -pose.roll };
  return pose;
}

/**
 * Every row a cow or calf paints, for one age. Exported so another bovine can
 * start from the same rows — drop the ones it does not play, add its own.
 */
export function cowRowsFor(age: CowAge): readonly CowRowSpec[] {
  return COW_ACTIONS.flatMap((action) => {
    const spec = ACTION_SPECS[action];
    return COW_VIEWS_BY_ACTION[action].map((view) => ({
      name: cowStateName(action, view),
      action,
      view,
      frameCount: spec.frameCount,
      kind: spec.kind,
      pose: (frame: number) => poseForView(spec.pose(frame, age), view),
    }));
  });
}

// ── Gore placement ───────────────────────────────────────────────────────────

/**
 * Pixels per piece unit a gore piece is painted at, for an adult; a calf's are
 * scaled by its build's `goreScale`.
 *
 * Larger than the animal's own tile scale: the runtime draws a piece at half
 * size, and held at 1 the smaller ones come out a handful of pixels across,
 * below the size one shape can be told from another.
 */
export const COW_GORE_UNIT = TILE_SCALE * 1.6;

// ── Figures ──────────────────────────────────────────────────────────────────

export interface CowFigureSpec {
  readonly id: string;
  readonly look: CowLook;
  readonly rows: readonly CowRowSpec[];
  readonly gore: readonly CowGorePiece[];
  /**
   * The cell, in pixels at `TILE_SCALE`. Default 160 × 112, which fits an
   * adult cow with about 12 px to spare on each side and 9 px above.
   *
   * A bigger animal must declare its own. Size it from the widest pose's reach
   * from the tile centre: `frameWidth = 2 × (sideways reach + 6)`, because the
   * profile is mirrored about the tile centre. Size `tileY` from the upward
   * reach: `tileY = upward reach − TILE_SCALE / 2 + 6`. Size
   * `frameHeight = tileY + TILE_SCALE + 14`, which clears the hooves and the
   * ground shadow. A 1.2× dun bull — `ADULT_COW_BUILD` scaled 1.2 about
   * `GROUND_Y` (every length and point, angles and `goreScale` kept) with its
   * horns scaled 1.2 too — needs about 200 × 134 with `tileY` 56, measured:
   * its raised tail in `happy_side` clips a 180-wide cell, and its tossed horns
   * clip a `tileY` of 50. Run `figureStructuralFailures` from `scripts/figureGates.ts`
   * over the new figure, as `scripts/gates-cow.ts` C1 does for the cattle: it
   * fails any pose that touches the edge of the cell the figure declares.
   */
  readonly frameWidth?: number;
  readonly frameHeight?: number;
  /** Offset from the cell's top edge to the tile's top edge; the tile is always centred across. */
  readonly tileY?: number;
}

/**
 * Builds a `FigureDef` from a look, a set of rows and a set of gore pieces.
 * Every cow and calf is one of these; a new bovine that paints through
 * `drawCow` can be too, in a cell of its own size (see {@link CowFigureSpec}).
 * The pose origin — the centre of the animal's tile — is derived from the
 * cell, and gore pieces are centred in it.
 */
export function makeCowFigure(spec: CowFigureSpec): FigureDef {
  const frameWidth = spec.frameWidth ?? COW_FRAME_WIDTH;
  const frameHeight = spec.frameHeight ?? COW_FRAME_HEIGHT;
  const tileY = spec.tileY ?? COW_TILE_Y;
  const tileX = (frameWidth - TILE_SCALE) / 2;
  const poseOriginX = frameWidth / 2;
  const poseOriginY = tileY + TILE_SCALE / 2;
  const rowsByName = new Map(spec.rows.map((row) => [row.name, row]));
  const goreByName = new Map(spec.gore.map((piece) => [piece.state, piece]));
  const goreUnit = COW_GORE_UNIT * spec.look.build.goreScale;
  const frames: Record<string, number> = {};
  for (const row of spec.rows) frames[row.name] = row.frameCount;
  for (const piece of spec.gore) frames[piece.state] = 1;

  const paintFrame = (ctx: CanvasRenderingContext2D, state: string, frame: number): void => {
    const row = rowsByName.get(state);
    if (row !== undefined) {
      ctx.save();
      try {
        ctx.translate(poseOriginX, poseOriginY);
        ctx.scale(TILE_SCALE, TILE_SCALE);
        drawCow(ctx, row.view, row.pose(frame), spec.look);
      } finally {
        ctx.restore();
      }
      return;
    }
    const piece = goreByName.get(state);
    if (piece === undefined) throw new Error(`${spec.id} paints no state "${state}"`);
    // A piece is spun about the centre of its own ink, so it is placed with that
    // centre on the cell's; one parked off-centre would orbit rather than tumble.
    ctx.save();
    try {
      ctx.translate(frameWidth / 2, frameHeight / 2);
      ctx.scale(goreUnit, goreUnit);
      ctx.translate(-piece.centre.x, -piece.centre.y);
      piece.paint(ctx);
    } finally {
      ctx.restore();
    }
  };

  return {
    id: spec.id,
    frameWidth,
    frameHeight,
    tileX,
    tileY,
    tileScale: TILE_SCALE,
    states: figureStates(frames),
    paintFrame,
  };
}

/** One entry per coat and age: the set the runtime chooses from. */
export interface CowFigureEntry {
  readonly coat: CowCoatId;
  readonly age: CowAge;
  readonly look: CowLook;
  readonly rows: readonly CowRowSpec[];
  readonly gore: readonly CowGorePiece[];
  readonly figure: FigureDef;
}

export const COW_FIGURE_ENTRIES: readonly CowFigureEntry[] = COW_AGES.flatMap((age) =>
  COW_COATS.map((coat) => {
    const look = cowLookOf(coat, age);
    const rows = cowRowsFor(age);
    const gore = cowGorePieces(look);
    return {
      coat,
      age,
      look,
      rows,
      gore,
      figure: makeCowFigure({ id: cowFigureId(coat, age), look, rows, gore }),
    };
  }),
);

/** The figure for a coat and an age. */
export function cowFigure(coat: CowCoatId, age: CowAge): FigureDef {
  const entry = COW_FIGURE_ENTRIES.find((e) => e.coat === coat && e.age === age);
  if (entry === undefined) throw new Error(`no cow figure for ${coat} ${age}`);
  return entry.figure;
}
