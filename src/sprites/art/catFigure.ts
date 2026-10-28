/**
 * The cat crawler, as a painted figure: the choreography, the cell geometry, and the
 * `FigureDef` the runtime cache and the review harness both draw through.
 *
 * This module is choreography and nothing else: one pose function per animation
 * row, sampled per frame, plus the placement of a pose inside its cell. The
 * anatomy, the fur engine and the palette live in `catArt.ts`.
 *
 * Rows:
 *    walk          — toward the camera, one full gait cycle
 *    walk_side     — profile, facing +X
 *    walk_away     — away from the camera, tail up
 *    idle          — breathing, tail sway, slow blink
 *    idle_side
 *    idle_away
 *    look_around   — idle break: head sweeps left, blinks, sweeps right
 *    groom_paw     — idle break: sits, licks a forepaw, wipes it over her ear
 *    groom_flank   — idle break: sits, hind leg up, works on her flank
 *    swipe         — claw swipe toward the camera
 *    swipe_side
 *    swipe_away
 *    cast          — magic missile: rocks back, charges an orb, throws it
 *    cast_side
 *    cast_away
 *    knocked_out   — down and out, waiting on a revive
 *    dance         — level-up celebration, paws pumping
 *
 * Every profile row has a `_west` twin: the same pose painted facing −X with
 * her left flank's coat. No row is mirrored at runtime, because her
 * tortoiseshell coat is not symmetric and a flipped picture would swap it.
 *
 * The art invariants live in `scripts/gates-cat.ts`, which the review harness
 * runs: `npm run render:cat`.
 */

import {
  GROUND_Y,
  type CatDirection,
  type CatGrip,
  type CatPose,
  type CatSlab,
  type PawPose,
  type Pt,
  type TailPose,
  catMouthFront,
  catMouthSide,
  clamp01,
  deg,
  drawCatBack,
  drawCatFront,
  drawCatSide,
  easeInOut,
  forepawsOnHaft,
  hump,
  legLiftOf,
  lerp,
  ramp,
  restPose,
  rgba,
  TWO_PI,
} from './catArt';
import type { CatDressing } from './catParts';
import {
  blitLayer,
  dilationOffsets,
  inFigureSpace,
  type InkReach,
  keepOpaque,
  layerBounds,
  makeLayer,
  outlineInto,
  scratchPx,
  withComposeLayers,
} from './figureCompose';
import { PLAYER_CAT } from '../../characters/characterLooks';
import type { CatGait, CatLook, CatOutline } from '../looks/catLook';
import { lateralWalkBack, lateralWalkFront, lateralWalkSide } from './catLateralWalk';
import { CARDINAL_VIEWS, type CardinalView } from '../facingView';
import { type FigureDef, figureStates } from '../figure/figureDef';
import { BARE_CAT_OUTFIT, bareCatOutfit, dressCat } from '../garments/cat/catDressing';
import type { GarmentFrameContext } from '../garments/garmentDef';
import type { Outfit } from '../garments/outfit';

// ── Cell geometry ────────────────────────────────────────────────────────────

/**
 * The cell the poses are painted into, and where the cat's own tile sits inside
 * it. 160px leaves three quarters of a tile of clearance on every side, which
 * is what a tail, a raised paw and the claw arc need at full reach.
 *
 * These five numbers are measured off the widest pose plus padding, quantised,
 * and `scripts/parity-figure-sheet.ts` proves the painter still fills
 * exactly that cell. The gates re-check that nothing paints against the edge,
 * which is what would say a pose has outgrown them.
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
/**
 * How much of a tile the cat fills. She is a housecat standing next to goblins
 * and clowns, so she is drawn at two thirds of the anatomy's natural size —
 * scaled about her own ground line, which keeps her paws on the tile they
 * belong to. The frame keeps its full resolution; only she gets smaller.
 */
export const CAT_SCALE = 2 / 3;

export const WALK_FRAMES = 8;
export const IDLE_FRAMES = 8;
export const BREAK_FRAMES = 12;
export const ACTION_FRAMES = 8;
export const KO_FRAMES = 8;
export const DANCE_FRAMES = 12;
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
  return { base, curl, wave, phase, puff, flick, rootX, rootY, reach: 1 };
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

/** Her walk in each view, as a pose for each phase of its cycle. */
type CatWalk = Readonly<Record<CardinalView, (phase: number) => CatPose>>;

/** Each gait's walk, by the gait a look declares. */
const WALKS: Readonly<Record<CatGait, CatWalk>> = {
  trot: { front: walkFront, side: walkSide, back: walkBack },
  lateralWalk: { front: lateralWalkFront, side: lateralWalkSide, back: lateralWalkBack },
};

function walkOf(look: CatLook): CatWalk {
  return WALKS[look.gait];
}

/** Pumpkin's walk in profile: a diagonal trot, the diagonal pairs of paws moving together. */
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

/**
 * The back idle's tail runs this share of a cycle ahead of the rest of her.
 * From behind the tail is the largest thing that moves, and its wave and its
 * flick are both fastest at the start of their cycle: begun there, the row's
 * biggest step falls on the loop's seam and reads as a pop at the wrap.
 */
const IDLE_BACK_TAIL_LEAD = 1 / 8;
/**
 * Standing from behind she lets her tail lean out past her flank: carried
 * upright it lies flush against her dark back and reads as a flat paddle.
 */
const IDLE_BACK_TAIL_BASE = deg(-62);

function idleBack(phase: number): CatPose {
  const tailAngle = (phase + IDLE_BACK_TAIL_LEAD) * TWO_PI;
  const front = idleFront(phase);
  return {
    ...front,
    tail: tail(IDLE_BACK_TAIL_BASE, -0.45, 0.3, tailAngle, 0.25, 0.4 * Math.sin(tailAngle * 2)),
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

// ── Working a tool: the two-paw chop and pick ────────────────────────────────

/**
 * One frame of a two-paw swing, in the pose's own frame facing east: where
 * the butt paw is, which way the haft runs and how far toward the camera, how
 * far she leans into it, and which of her slabs the haft passes under.
 */
interface SwingKey {
  readonly butt: Pt;
  readonly angle: number;
  readonly depth: number;
  readonly lean: number;
  readonly under: CatSlab;
}

type SwingKeys = readonly [
  SwingKey,
  SwingKey,
  SwingKey,
  SwingKey,
  SwingKey,
  SwingKey,
  SwingKey,
  SwingKey,
];

/**
 * The frame a work swing bites on. Her swing plays over `CAT_SWIPE_FRAMES`
 * ticks, sampled across `ACTION_FRAMES`, so frame 4 is on screen from the
 * swing's ninth tick. The picture only: a harvest sounds and shows its
 * strike on the tick the swing starts, not on the bite.
 */
export const WORK_IMPACT_FRAME = 4;

/** How far along a haft her second paw closes from the butt paw, pose units. */
const HAFT_PAW_SPACING = 0.12;
/** Paws closed on a haft are lifted off the floor: turned a little toward the camera. */
const HAFT_PAW_LIFT = 0.3;
/** Her pads face the camera on the haft, so the head shows its flat. */
const PADS_TO_CAMERA: CatDirection = { x: 0, y: 0, z: 1 };

function key(
  x: number,
  y: number,
  angle: number,
  depth: number,
  leanDeg: number,
  under: CatSlab,
): SwingKey {
  return { butt: { x, y }, angle, depth, lean: deg(leanDeg), under };
}

/** Profile chop: up and back over her shoulders, then across into the wood ahead of her chest. */
const CHOP_SIDE: SwingKeys = [
  key(0.32, 0.12, -2.2, 0, -2, 'forepaws'),
  key(0.3, 0.0, -2.5, 0, -7, 'forepaws'),
  key(0.27, -0.08, -2.75, 0, -12, 'forepaws'),
  key(0.36, -0.02, -1.4, 0, -3, 'forepaws'),
  key(0.4, 0.12, 0.1, 0, 10, 'forepaws'),
  key(0.4, 0.13, 0.16, 0, 9, 'forepaws'),
  key(0.37, 0.1, -0.9, 0, 3, 'forepaws'),
  key(0.33, 0.12, -1.9, 0, -1, 'forepaws'),
];

/** Profile pick: straight up over her head, then down onto the floor ahead of her. */
const MINE_SIDE: SwingKeys = [
  key(0.32, 0.12, -2.1, 0, -3, 'forepaws'),
  key(0.27, 0.04, -2.4, 0, -9, 'forepaws'),
  key(0.26, -0.13, -2.1, 0, -14, 'forepaws'),
  key(0.42, 0.02, -0.55, 0, -2, 'forepaws'),
  key(0.4, 0.1, 0.36, 0, 11, 'forepaws'),
  key(0.4, 0.11, 0.39, 0, 10, 'forepaws'),
  key(0.36, 0.08, -0.4, 0, 3, 'forepaws'),
  key(0.33, 0.1, -1.7, 0, -1, 'forepaws'),
];

/**
 * Head-on chop: up over her right shoulder (the screen's left) with the head
 * behind her ear, then down and across in front of her toward the camera.
 */
const CHOP_FRONT: SwingKeys = [
  key(-0.06, 0.12, -2.3, -0.2, 0, 'forepaws'),
  key(-0.15, -0.12, -2.3, -0.3, -2, 'head'),
  key(-0.22, -0.3, -2.4, -0.4, -3, 'head'),
  key(-0.12, 0.04, -0.3, 0.5, 1, 'forepaws'),
  key(0.06, 0.18, 0.7, 0.55, 4, 'forepaws'),
  key(0.07, 0.19, 0.75, 0.55, 4, 'forepaws'),
  key(0.0, 0.1, -0.2, 0.3, 1, 'forepaws'),
  key(-0.06, 0.12, -2.2, -0.1, 0, 'forepaws'),
];

/** Head-on pick: up beside her right ear, then straight down onto the floor in front of her. */
const MINE_FRONT: SwingKeys = [
  key(-0.06, 0.12, -2.25, -0.2, 0, 'forepaws'),
  key(-0.2, -0.12, -2.3, -0.4, -2, 'head'),
  key(-0.18, -0.38, -1.95, -0.5, -3, 'head'),
  key(-0.12, 0.0, 0.2, 0.6, 1, 'forepaws'),
  key(0.0, 0.2, 1.4, 0.6, 4, 'forepaws'),
  key(0.0, 0.21, 1.45, 0.6, 4, 'forepaws'),
  key(-0.02, 0.12, -0.15, 0.4, 1, 'forepaws'),
  key(-0.06, 0.12, -2.2, -0.1, 0, 'forepaws'),
];

/**
 * From behind: the tool rises over her head with her paws above her
 * shoulders, then comes down on the far side of her, its head showing past
 * her flank.
 */
const CHOP_BACK: SwingKeys = [
  key(0.05, 0.12, -1.6, 0.3, 0, 'body'),
  key(0.1, -0.25, -1.7, 0.4, 2, 'forepaws'),
  key(0.12, -0.45, -2.0, 0.5, 3, 'forepaws'),
  key(0.06, -0.25, -1.2, 0.0, 0, 'forepaws'),
  key(0.02, 0.05, 0.5, -0.6, -4, 'body'),
  key(0.02, 0.06, 0.55, -0.6, -4, 'body'),
  key(0.06, -0.1, -1.0, 0.2, -1, 'body'),
  key(0.05, 0.08, -1.5, 0.2, 0, 'body'),
];

const MINE_BACK: SwingKeys = [
  key(0.05, 0.12, -1.65, 0.3, 0, 'body'),
  key(0.08, -0.28, -1.65, 0.45, 2, 'forepaws'),
  key(0.08, -0.5, -1.75, 0.55, 3, 'forepaws'),
  key(0.04, -0.25, -1.3, 0.0, 0, 'forepaws'),
  key(0.02, 0.05, 1.0, -0.6, -4, 'body'),
  key(0.02, 0.06, 1.05, -0.6, -4, 'body'),
  key(0.05, -0.1, -0.9, 0.2, -1, 'body'),
  key(0.05, 0.08, -1.5, 0.2, 0, 'body'),
];

/** Her body's own part of a swing: rear up into the wind-up, drive down into the bite, settle. */
function swingBody(frame: number, view: CardinalView, tailBase: number): CatPose {
  const progress = shotProgress(frame, ACTION_FRAMES);
  const windup = easeInOut(ramp(progress, 0, 0.36));
  const strike = easeInOut(ramp(progress, 0.36, 0.56));
  const recover = easeInOut(ramp(progress, 0.7, 1));
  const coil = windup * (1 - strike);
  const drive = strike * (1 - recover);
  const rest = restPose();
  const sideways = view === 'side';
  return {
    ...rest,
    sit: sideways ? 0.15 * coil : 0.35 * coil + 0.1,
    bob: -0.012 * coil + 0.014 * drive,
    squash: 1 - 0.04 * drive,
    headY: -0.01 * coil + 0.012 * drive,
    headX: sideways ? 0.02 * drive : 0,
    headTilt: deg(-4) * coil + deg(5) * drive,
    earL: lerp(0.6, -0.3, drive),
    earR: lerp(0.6, -0.3, drive),
    eyeOpen: lerp(1, 0.6, drive),
    pupil: lerp(0.5, 0.25, coil),
    mouth: 0.35 * drive,
    tail: tail(tailBase, 1.4, 0.5, progress * 6, 0.25 + 0.3 * drive, -0.6 * drive),
    hindL: paw(-0.02 * coil, 0, 0),
    hindR: paw(-0.03 * coil, 0, 0),
    time: progress,
  };
}

const TAIL_BASE_FOR: Readonly<Record<CardinalView, number>> = {
  front: FRONT_TAIL_BASE,
  side: SIDE_TAIL_BASE,
  back: BACK_TAIL_BASE,
};

/**
 * One frame of a two-paw swing in `view` for a cat looking like `look`: her
 * body, and both paws closed on the haft. A cat whose legs hold her higher
 * swings the same arc as high again above the floor, so the haft stays where
 * her chest and head are. Her head rides her legs' lift less the drop of her
 * neck, so a raised swing, which passes between her chest and her chin, rises
 * by the mean of the two lifts: lifted with her chest alone, a low-necked
 * cat's paws close on the haft behind her chin and hide it.
 */
function swingPose(keys: SwingKeys, view: CardinalView, frame: number, look: CatLook): CatPose {
  const at = keys[Math.max(0, Math.min(keys.length - 1, frame))];
  const body = swingBody(frame, view, TAIL_BASE_FOR[view]);
  const leaned: CatPose = { ...body, lean: body.lean + at.lean };
  const grip: CatGrip = {
    under: at.under,
    pawsClosed: true,
    haftAngle: at.angle,
    haftDepth: at.depth,
    padNormal: PADS_TO_CAMERA,
  };
  const raised = clamp01((GROUND_Y - at.butt.y) / SWING_RAISE_SPAN);
  const liftView = liftViewOf(view);
  const chestLift = legLiftOf(leaned, look, liftView);
  const headLift = chestLift - look.proportions.neckDrop[liftView];
  const swingLift = lerp(chestLift, headLift, CHEST_TO_HEAD_SHARE);
  const butt = { x: at.butt.x, y: at.butt.y - swingLift * raised };
  return {
    ...leaned,
    ...forepawsOnHaft(leaned, view, butt, grip, HAFT_PAW_SPACING, HAFT_PAW_LIFT),
    grip,
  };
}

/**
 * A swing key this far above the floor is lifted the whole of her legs'
 * lift; one on the floor (the bite) not at all, so the tool still strikes
 * the ground.
 */
const SWING_RAISE_SPAN = 0.6;
/** A raised swing passes midway between her chest and her chin. */
const CHEST_TO_HEAD_SHARE = 0.5;

function liftViewOf(view: CardinalView): 'headOn' | 'profile' {
  return view === 'side' ? 'profile' : 'headOn';
}

// ── Carrying in her jaws ─────────────────────────────────────────────────────

/**
 * A carried thing lies across her jaws: head-on and from behind cocked a
 * little off level — dead level across her muzzle it reads as a strap
 * muzzling her — and toward the camera in profile.
 */
const MOUTH_ACROSS = deg(-8);
const MOUTH_ACROSS_DEPTH = 0;
/**
 * In profile the thing across her jaws points at the camera, which this
 * view draws down the screen; turned short of end-on, so it shows as more
 * than a dot at her mouth.
 */
const MOUTH_END_ON_ANGLE = deg(80);
const MOUTH_END_ON_DEPTH = 0.45;
/** Jaws closed on something are held a little open, the head a touch higher and prouder. */
const CARRY_JAW = 0.22;
const CARRY_HEAD_RAISE = 0.018;
const CARRY_EARS = 0.55;

function mouthGrip(view: CardinalView): CatGrip {
  const sideways = view === 'side';
  return {
    ...(view === 'back' ? { under: 'head' as const } : {}),
    pawsClosed: false,
    haftAngle: sideways ? MOUTH_END_ON_ANGLE : MOUTH_ACROSS,
    haftDepth: sideways ? MOUTH_END_ON_DEPTH : MOUTH_ACROSS_DEPTH,
    padNormal: PADS_TO_CAMERA,
  };
}

/** `base` with something carried in her jaws: mouth a little open on it, head up, ears forward. */
function carrying(base: CatPose, view: CardinalView): CatPose {
  return {
    ...base,
    headY: base.headY - CARRY_HEAD_RAISE,
    mouth: CARRY_JAW,
    tongue: 0,
    earL: CARRY_EARS,
    earR: CARRY_EARS,
    grip: mouthGrip(view),
  };
}

// ── Throwing from her jaws ───────────────────────────────────────────────────

/**
 * The throw-row frame the thing in her jaws leaves her mouth on. Played over
 * {@link CAT_THROW_TICKS_PER_FRAME}, it goes nine ticks after the release
 * key, as the human's stick leaves his hand: the fuse a player timed burns
 * the same whichever crawler threw it.
 */
export const CAT_THROW_RELEASE_FRAME = 3;
export const CAT_THROW_TICKS_PER_FRAME = 3;
/** The throw-row frame she is drawn back furthest on: she stands in it while she winds up. */
export const CAT_THROW_COCKED_FRAME = 1;

/** Head drawn back and to one side, shoulders dropped behind it. */
const THROW_COCK_END = 0.16;
/** The flick through: head and shoulders snap forward and the jaws open on the release. */
const THROW_FLICK_END = 0.44;
const THROW_RECOVER_START = 0.6;

interface ThrowPhases {
  /** 0→1 drawing back, let go of as the flick goes through. */
  readonly cock: number;
  /** 0→1 through the flick, held into the follow-through. */
  readonly flick: number;
  /** 0→1 settling back into her carrying stance's rest. */
  readonly recover: number;
}

/** The thing in her jaws finishes its swing this far through the throw, ahead of her head. */
const THROW_STICK_FLICK_END = 0.33;

function throwPhases(progress: number, flickEnd = THROW_FLICK_END): ThrowPhases {
  const flick = easeInOut(ramp(progress, THROW_COCK_END, flickEnd));
  return {
    cock: easeInOut(ramp(progress, 0, THROW_COCK_END)) * (1 - flick),
    flick,
    recover: easeInOut(ramp(progress, THROW_RECOVER_START, 1)),
  };
}

/** How wide her jaws open as the thing leaves them, and how far they close after. */
const THROW_JAW_OPEN = 0.4;
const THROW_JAW_AFTER = 0.12;
/** Her front paws stay planted: her chest dips into the cock and lifts a little on the flick. */
const THROW_COCK_CROUCH = 0.022;
const THROW_FLICK_RISE = -0.024;
/**
 * After it goes she follows it with her eyes: a nod after the thing as it
 * flies, then a settle, so the recovery is not a held pose.
 */
const THROW_FOLLOW_DIP = 0.035;
const THROW_FOLLOW_LEAN = deg(5);
const THROW_FOLLOW_BOB = 0.01;
/** Ears laid back as she draws back, pricked after the thing as it flies. */
const THROW_COCK_EARS = -0.4;
const THROW_FLICK_EARS = 0.9;
/** Eyes narrowed through the effort, pupils wide as she watches it go. */
const THROW_SQUINT = 0.65;
const THROW_WATCH_PUPIL = 0.9;
/** The tail lashes with the flick. */
const THROW_TAIL_CURL = 1.4;
const THROW_TAIL_WAVE = 0.6;
const THROW_TAIL_WAVES_PER_THROW = 6;
const THROW_TAIL_LASH = -0.9;
/** Her hind legs brace a touch behind her as she draws back. */
const THROW_HIND_BRACE = -0.03;

/** One view's throw: where the head and the thing in her jaws go at the cock and at the flick. */
interface ThrowKeys {
  readonly tailBase: number;
  readonly cock: ThrowKey;
  readonly flick: ThrowKey;
  /**
   * The thing's lie in her jaws as she sets herself to throw: gripped by one
   * end and angled back along her jaw in profile, its far end out toward the
   * camera head-on, past her cheek from behind. Not her carrying lie, which
   * holds a thing crosswise and reads as a strap on something this long.
   */
  readonly rest: CatGrip;
}

interface ThrowKey {
  readonly headX: number;
  readonly headY: number;
  readonly headTilt: number;
  readonly headTurn: number;
  readonly lean: number;
  readonly sway: number;
  readonly haftAngle: number;
}

/**
 * In profile she pulls her head back and down over her planted paws, the
 * thing in her jaws tipped back toward her chest, then snaps it forward and
 * up, the thing swinging out ahead of her muzzle as it goes.
 */
const THROW_SIDE: ThrowKeys = {
  tailBase: SIDE_TAIL_BASE,
  cock: {
    headX: -0.09,
    headY: 0.07,
    headTilt: deg(24),
    headTurn: 0,
    lean: deg(-11),
    sway: -0.05,
    haftAngle: deg(150),
  },
  flick: {
    headX: 0.1,
    headY: -0.07,
    headTilt: deg(-26),
    headTurn: 0,
    lean: deg(15),
    sway: 0.1,
    haftAngle: deg(-35),
  },
  rest: { pawsClosed: false, haftAngle: deg(160), haftDepth: 0.2, padNormal: PADS_TO_CAMERA },
};

/**
 * Head-on she tosses it the way a cat flings a toy: the head swung round to
 * her right and dipped, shoulders rolled after it, then whipped across to
 * her left, the thing in her jaws swinging through with it.
 */
const THROW_FRONT: ThrowKeys = {
  tailBase: FRONT_TAIL_BASE,
  cock: {
    headX: -0.05,
    headY: 0.035,
    headTilt: deg(-24),
    headTurn: -1,
    lean: deg(-9),
    sway: 0,
    haftAngle: deg(-50),
  },
  flick: {
    headX: 0.05,
    headY: -0.03,
    headTilt: deg(22),
    headTurn: 0.9,
    lean: deg(13),
    sway: 0,
    haftAngle: deg(60),
  },
  rest: { pawsClosed: false, haftAngle: deg(-35), haftDepth: 0.6, padNormal: PADS_TO_CAMERA },
};

/** From behind the same toss: her head swings out past one shoulder, then across past the other. */
const THROW_BACK: ThrowKeys = {
  tailBase: BACK_TAIL_BASE,
  cock: {
    headX: 0.05,
    headY: 0.035,
    headTilt: deg(24),
    headTurn: 1,
    lean: deg(9),
    sway: 0,
    haftAngle: deg(80),
  },
  flick: {
    headX: -0.05,
    headY: -0.03,
    headTilt: deg(-22),
    headTurn: -0.9,
    lean: deg(-9),
    sway: 0,
    haftAngle: deg(-70),
  },
  rest: {
    under: 'head',
    pawsClosed: false,
    haftAngle: deg(20),
    haftDepth: -0.3,
    padNormal: PADS_TO_CAMERA,
  },
};

const THROW_KEYS: Readonly<Record<CardinalView, ThrowKeys>> = {
  front: THROW_FRONT,
  side: THROW_SIDE,
  back: THROW_BACK,
};

/** Where `key`'s value stands at this point of the throw: rest, drawn back, flicked through, settled. */
function throwValue(phases: ThrowPhases, rest: number, cock: number, flick: number): number {
  const swung = rest + (cock - rest) * phases.cock + (flick - rest) * phases.flick;
  return lerp(swung, rest, phases.recover);
}

/** One frame of her throw in `view`, with the thing in her jaws until it goes. */
function throwPose(view: CardinalView, frame: number): CatPose {
  const progress = shotProgress(frame, ACTION_FRAMES);
  const phases = throwPhases(progress);
  const keys = THROW_KEYS[view];
  const base = carrying(idleFront(0), view);
  const released = frame >= CAT_THROW_RELEASE_FRAME;
  const value = (pick: (key: ThrowKey) => number, rest: number): number =>
    throwValue(phases, rest, pick(keys.cock), pick(keys.flick));
  const jaw = released ? lerp(THROW_JAW_OPEN, THROW_JAW_AFTER, phases.recover) : CARRY_JAW;
  const drive = phases.flick * (1 - phases.recover);
  const ears = lerp(lerp(CARRY_EARS, THROW_COCK_EARS, phases.cock), THROW_FLICK_EARS, drive);
  const follow = hump(phases.recover);
  // The thing in her jaws whips through ahead of her head, so it is past
  // hanging straight down by the frame before it goes rather than caught there.
  const stickPhases = throwPhases(progress, THROW_STICK_FLICK_END);
  const leanSign = view === 'back' ? -1 : 1;
  return {
    ...base,
    bob: THROW_COCK_CROUCH * phases.cock + THROW_FLICK_RISE * drive + THROW_FOLLOW_BOB * follow,
    lean: value((key) => key.lean, 0) + leanSign * THROW_FOLLOW_LEAN * follow,
    sway: value((key) => key.sway, 0),
    headX: value((key) => key.headX, 0),
    headY: value((key) => key.headY, base.headY) + THROW_FOLLOW_DIP * follow,
    headTilt: value((key) => key.headTilt, 0),
    headTurn: value((key) => key.headTurn, 0),
    earL: ears,
    earR: ears,
    eyeOpen: lerp(1, THROW_SQUINT, clamp01(phases.cock + drive)),
    pupil: lerp(base.pupil, THROW_WATCH_PUPIL, drive),
    mouth: jaw,
    tail: tail(
      keys.tailBase,
      THROW_TAIL_CURL,
      THROW_TAIL_WAVE,
      progress * THROW_TAIL_WAVES_PER_THROW,
      0,
      THROW_TAIL_LASH * drive,
    ),
    frontL: NO_PAW,
    frontR: NO_PAW,
    hindL: paw(THROW_HIND_BRACE * phases.cock, 0, 0),
    hindR: paw(THROW_HIND_BRACE * phases.cock, 0, 0),
    time: progress,
    grip: {
      ...keys.rest,
      haftAngle: throwValue(
        stickPhases,
        keys.rest.haftAngle,
        keys.cock.haftAngle,
        keys.flick.haftAngle,
      ),
    },
  };
}

/** Whether `row` draws what she holds on `frame`: a throw lets go of it on its release frame. */
export function catRowHoldsAt(row: RowSpec, frame: number): boolean {
  if (row.hold === undefined) return false;
  return row.hold !== 'throw' || frame < CAT_THROW_RELEASE_FRAME;
}

// ── Sheet assembly ───────────────────────────────────────────────────────────

/**
 * A looping row is sampled evenly around its cycle and has to close back on
 * frame 0; a one-shot runs across its frames once and stops. The gates read
 * this to know which continuity rule a row is held to.
 */
type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: CardinalView;
  readonly kind: RowKind;
  /** A profile row painted facing screen −X with her left flank's coat; never mirrored at runtime. */
  readonly facesWest: boolean;
  /** What the row holds, for a row played only while she holds it. */
  readonly hold?: CatHold;
  /**
   * The row's pose on frame `t` for a cat looking like `look`. Two kinds of
   * row differ by look: her walk, whose choreography the look's gait picks,
   * and the tool swings, whose paws rise with her stance.
   */
  readonly pose: (t: number, look: CatLook) => CatPose;
}

/**
 * The things she holds that have rows of their own: a tool she chops wood or
 * mines stone with, both forepaws on its haft, a small thing carried in her
 * jaws, and an explosive carried there to be flung.
 */
export type CatHold = 'chop' | 'mine' | 'carry' | 'throw';

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

/** The suffix each view's row carries after its action's name, head-on carrying none. */
const VIEW_SUFFIX: Readonly<Record<CardinalView, string>> = {
  front: '',
  side: '_side',
  back: '_away',
};

const EAST_ROWS: readonly RowSpec[] = [
  {
    name: 'walk',
    facesWest: false,
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f, look) => walkOf(look).front(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_side',
    facesWest: false,
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f, look) => walkOf(look).side(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    facesWest: false,
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f, look) => walkOf(look).back(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'idle',
    facesWest: false,
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => idleFront(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_side',
    facesWest: false,
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_away',
    facesWest: false,
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'look_around',
    facesWest: false,
    frameCount: BREAK_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => lookAround(shotProgress(f, BREAK_FRAMES)),
  },
  {
    name: 'groom_paw',
    facesWest: false,
    frameCount: BREAK_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => groomPaw(shotProgress(f, BREAK_FRAMES)),
  },
  {
    name: 'groom_flank',
    facesWest: false,
    frameCount: BREAK_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => groomFlank(shotProgress(f, BREAK_FRAMES)),
  },
  {
    name: 'swipe',
    facesWest: false,
    frameCount: ACTION_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => swipeFront(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'swipe_side',
    facesWest: false,
    frameCount: ACTION_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => swipeSide(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'swipe_away',
    facesWest: false,
    frameCount: ACTION_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: (f) => swipeBack(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'cast',
    facesWest: false,
    frameCount: ACTION_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => castFront(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'cast_side',
    facesWest: false,
    frameCount: ACTION_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => castSide(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'cast_away',
    facesWest: false,
    frameCount: ACTION_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: (f) => castBack(shotProgress(f, ACTION_FRAMES)),
  },
  {
    name: 'knocked_out',
    facesWest: false,
    frameCount: KO_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => knockedOut(cyclePhase(f, KO_FRAMES)),
  },
  {
    name: 'dance',
    facesWest: false,
    frameCount: DANCE_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => dance(cyclePhase(f, DANCE_FRAMES)),
  },
  ...swingRows('chop', { front: CHOP_FRONT, side: CHOP_SIDE, back: CHOP_BACK }),
  ...swingRows('mine', { front: MINE_FRONT, side: MINE_SIDE, back: MINE_BACK }),
  ...carryRows(),
  ...throwRows(),
];

function swingRows(
  hold: 'chop' | 'mine',
  keys: Readonly<Record<CardinalView, SwingKeys>>,
): RowSpec[] {
  return CARDINAL_VIEWS.map((view) => ({
    name: `${hold}${VIEW_SUFFIX[view]}`,
    facesWest: false,
    frameCount: ACTION_FRAMES,
    kind: 'oneShot',
    view,
    hold,
    pose: (f, look) => swingPose(keys[view], view, f, look),
  }));
}

/** Her walk and idle with something in her jaws. */
function carryRows(): RowSpec[] {
  const idles: Readonly<Record<CardinalView, (phase: number) => CatPose>> = {
    front: idleFront,
    side: idleSide,
    back: idleBack,
  };
  return CARDINAL_VIEWS.flatMap((view): RowSpec[] => [
    {
      name: `carry_walk${VIEW_SUFFIX[view]}`,
      facesWest: false,
      frameCount: WALK_FRAMES,
      kind: 'loop',
      view,
      hold: 'carry',
      pose: (f, look) => carrying(walkOf(look)[view](cyclePhase(f, WALK_FRAMES)), view),
    },
    {
      name: `carry_idle${VIEW_SUFFIX[view]}`,
      facesWest: false,
      frameCount: IDLE_FRAMES,
      kind: 'loop',
      view,
      hold: 'carry',
      pose: (f) => carrying(idles[view](cyclePhase(f, IDLE_FRAMES)), view),
    },
  ]);
}

/** Her throw of a thing from her jaws, front paws planted. */
function throwRows(): RowSpec[] {
  return CARDINAL_VIEWS.map((view) => ({
    name: `throw${VIEW_SUFFIX[view]}`,
    facesWest: false,
    frameCount: ACTION_FRAMES,
    kind: 'oneShot',
    view,
    hold: 'throw',
    pose: (f) => throwPose(view, f),
  }));
}

/** The suffix a west-facing profile row carries after its east-facing row's name. */
const WEST_SUFFIX = '_west';

/**
 * Every profile row again, facing west: the same poses, painted mirrored with
 * her left flank's coat.
 */
const WEST_ROWS: readonly RowSpec[] = EAST_ROWS.filter((row) => row.view === 'side').map((row) => ({
  ...row,
  name: `${row.name}${WEST_SUFFIX}`,
  facesWest: true,
}));

export const CAT_ROWS: readonly RowSpec[] = [...EAST_ROWS, ...WEST_ROWS];

/**
 * Paints `pose` the way `row` is painted: in the row's view, facing the row's
 * way, looking like `look`. `front` receives the slabs in front of whatever
 * she holds.
 */
export function paintCatPose(
  ctx: CanvasRenderingContext2D,
  look: CatLook,
  row: RowSpec,
  pose: CatPose,
  dressing: CatDressing,
  front: CanvasRenderingContext2D | null = null,
): void {
  if (row.view === 'front') drawCatFront(ctx, pose, dressing, look, front);
  else if (row.view === 'back') drawCatBack(ctx, pose, dressing, look, front);
  else drawCatSide(ctx, pose, dressing, look, row.facesWest ? 'left' : 'right', front);
}

function rowOf(state: string): RowSpec | undefined {
  return CAT_ROWS.find((row) => row.name === state);
}

/** What a garment painted into one cell of `row` sees of it. */
export function catGarmentContext(
  row: RowSpec,
  frame: number,
  pose: CatPose,
): GarmentFrameContext<'cat'> {
  return {
    row: row.name,
    frame,
    frameCount: row.frameCount,
    view: row.view,
    westward: row.facesWest,
    pose,
  };
}

/**
 * Paints one cell of a cat looking like `look`, in the cell's own pixels,
 * dressed by whatever `dressingFor` returns for that cell.
 *
 * Every painter draws around the centre of the logical tile, and she is scaled
 * about her own ground line rather than about that centre, which is what keeps
 * her paws on the tile they belong to while the rest of her shrinks.
 */
export function paintCatCell(
  ctx: CanvasRenderingContext2D,
  look: CatLook,
  state: string,
  frame: number,
  dressingFor: (context: GarmentFrameContext<'cat'>) => CatDressing,
  front: CanvasRenderingContext2D | null = null,
): void {
  const row = rowOf(state);
  if (row === undefined) return;
  const pose = row.pose(frame, look);
  const dressing = dressingFor(catGarmentContext(row, frame, pose));
  const paint = (target: CanvasRenderingContext2D): void =>
    paintCatPose(target, look, row, pose, dressing, front);
  ctx.save();
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.translate(0, GROUND_Y);
  ctx.scale(CAT_SCALE, CAT_SCALE);
  ctx.translate(0, -GROUND_Y);
  if (look.outline === null) paint(ctx);
  else paintOutlined(ctx, look.outline, paint);
  ctx.restore();
}

/** A point of her cell, cell pixels, in her pose space: {@link catPoseToCell} turned round. */
function cellToPose(point: Pt): Pt {
  return {
    x: (point.x - ORIGIN_X) / (TILE_SCALE * CAT_SCALE),
    y: GROUND_Y + ((point.y - ORIGIN_Y) / TILE_SCALE - GROUND_Y) / CAT_SCALE,
  };
}

/** Her whole cell in pose space: everything she paints lies inside it. */
const CELL_IN_POSE_SPACE: InkReach = {
  points: [cellToPose({ x: 0, y: 0 }), cellToPose({ x: FRAME_W, y: FRAME_H })],
  margin: 0,
};
/** Directions her outline is dilated in: enough that a two-pixel line reads round, not octagonal. */
const OUTLINE_SAMPLES = 16;
/**
 * The faintest ink her outline traces round, 0–255: her ground shadow and the
 * soft tips of her fur fall under it, so the line follows her body and not
 * the shadow she stands in.
 */
const OUTLINE_MIN_ALPHA = 128;
/** Her outline leaves the gap between two legs open rather than filling it with line. */
const OUTLINE_CLOSES_GAPS = true;

/**
 * Paints her through `paint` on a layer of her own and lays a line round the
 * finished silhouette: drawn part by part, every leg over her body would get
 * a ring of its own.
 */
function paintOutlined(
  ctx: CanvasRenderingContext2D,
  outline: CatOutline,
  paint: (target: CanvasRenderingContext2D) => void,
): void {
  withComposeLayers(() => {
    const bounds = layerBounds(ctx, [CELL_IN_POSE_SPACE]);
    const body = makeLayer(bounds);
    const silhouette = makeLayer(bounds);
    const out = makeLayer(bounds);
    const scratch = makeLayer(bounds);
    inFigureSpace(body, bounds, paint);
    silhouette.ctx.drawImage(body.surface, 0, 0);
    keepOpaque(silhouette, OUTLINE_MIN_ALPHA);
    const radius = scratchPx(bounds, outline.widthPx, CAT_CELL_PX_PER_POSE_UNIT);
    outlineInto(
      out,
      silhouette,
      scratch,
      dilationOffsets(radius, OUTLINE_SAMPLES),
      outline.colour,
      rgba(outline.colour, outline.alpha),
      OUTLINE_CLOSES_GAPS,
    );
    out.ctx.drawImage(body.surface, 0, 0);
    blitLayer(ctx, out, bounds);
  });
}

/** The row named `state`, or undefined for a name that is no row of hers. */
export function catRowOf(state: string): RowSpec | undefined {
  return rowOf(state);
}

/**
 * Whether a cell of a cat looking like `look` bakes a front layer: a frame of a row she plays
 * holding something, whose held thing lies under one of her slabs.
 */
function catCellIsLayered(look: CatLook, state: string, frame: number): boolean {
  const row = rowOf(state);
  if (row?.hold === undefined) return false;
  return row.pose(frame, look).grip?.under !== undefined;
}

/**
 * A point of her pose space where her cell paints it, cell pixels: the same
 * placement {@link paintCatCell} paints with, scaled about her ground line.
 */
export function catPoseToCell(point: Pt): Pt {
  return {
    x: ORIGIN_X + point.x * TILE_SCALE * CAT_SCALE,
    y: ORIGIN_Y + TILE_SCALE * (GROUND_Y + (point.y - GROUND_Y) * CAT_SCALE),
  };
}

/** Cell pixels per unit of her pose space. */
export const CAT_CELL_PX_PER_POSE_UNIT = TILE_SCALE * CAT_SCALE;

/** The view a row is painted in, or undefined for a name that is no row of hers. */
export function catRowView(state: string): CardinalView | undefined {
  return rowOf(state)?.view;
}

function rowMouth(look: CatLook, row: RowSpec, frame: number): Pt | null {
  if (row.view === 'back') return null;
  const pose = row.pose(frame, look);
  if (row.view === 'front') return catMouthFront(pose, look);
  const east = catMouthSide(pose, look);
  return row.facesWest ? { x: -east.x, y: east.y } : east;
}

/** Whether a row is painted facing screen −X; false for a name that is no row of hers. */
export function catRowFacesWest(state: string): boolean {
  return rowOf(state)?.facesWest ?? false;
}

/** The tile's centre line, which a mirrored cell flips about. */
const TILE_CENTRE_FRACTION = 0.5;

/**
 * Where the mouth of a cat looking like `look` is painted on one cell, in tile fractions from the sprite's
 * tile origin, mirrored with the cell; null for a back view or an unknown row.
 * Mapped through the same placement {@link paintCatFrame} paints with.
 */
export function catMouthInTile(
  look: CatLook,
  state: string,
  frame: number,
  flipX: boolean,
): Pt | null {
  const row = rowOf(state);
  if (row === undefined) return null;
  const mouth = rowMouth(look, row, frame);
  if (mouth === null) return null;
  const tileX = (ORIGIN_X - TILE_X) / TILE_SCALE + mouth.x * CAT_SCALE;
  const tileY = (ORIGIN_Y - TILE_Y) / TILE_SCALE + GROUND_Y + (mouth.y - GROUND_Y) * CAT_SCALE;
  return { x: flipX ? 2 * TILE_CENTRE_FRACTION - tileX : tileX, y: tileY };
}

function catStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of CAT_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

/**
 * The cat crawler's own per-figure cache ceiling, in place of the fleet's 24 MB.
 *
 * Measured at full scale (`bench:turn-residency`): her turning rows in every
 * view are 12.5 MB, 15.75 MB with a tool out. Carrying something in her jaws
 * she also holds her carrying walk and idle in every view, 18.75 MB, and the
 * rows she was drawn in before she picked it up — the swings of the view she
 * faced, the opening swing frames, an idle break — stay until their release
 * window runs out: that peaked at the 24 MB ceiling, whose evictions then
 * drew cold cells as she put the thing down and walked off. Twenty-eight
 * leaves those rows their window; the cache's global ceiling is unchanged.
 * Every cat look shares the same cell and the same rows, so a look's working
 * set is the same bytes whoever she is, and one number serves them all; only
 * the cat being played is ever resident (`setCatLook` releases the other).
 */
const CAT_FIGURE_BUDGET_MEGABYTES = 28;

const CAT_FIGURE_ID_PREFIX = 'cat';

/**
 * A cat figure's id: the look, so two cats never share a cached cell, and
 * after it the garments of any outfit beyond her bare coat.
 */
function catFigureId(look: CatLook, outfit: Outfit<'cat'>): string {
  const bare = `${CAT_FIGURE_ID_PREFIX}:${look.id}`;
  return outfit.key === bareCatOutfit(look).key ? bare : `${bare}:${outfit.key}`;
}

function catFigure(look: CatLook, outfit: Outfit<'cat'>): FigureDef {
  return {
    id: catFigureId(look, outfit),
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: TILE_SCALE,
    states: figureStates(catStateFrames()),
    budgetMegabytes: CAT_FIGURE_BUDGET_MEGABYTES,
    paintFrame: (ctx, state, frame) =>
      paintCatCell(ctx, look, state, frame, (context) => dressCat(outfit, context)),
    heldLayers: {
      layered: (state, frame) => catCellIsLayered(look, state, frame),
      paintLayers: (back, front, state, frame) =>
        paintCatCell(back, look, state, frame, (context) => dressCat(outfit, context), front),
    },
  };
}

/** How the cat the player controls looks. */
export const PLAYER_CAT_LOOK: CatLook = PLAYER_CAT.look;

/** The cat the player controls, with nothing on but her coat. */
export const CAT_FIGURE: FigureDef = catFigure(PLAYER_CAT_LOOK, BARE_CAT_OUTFIT);

/**
 * Built on first use: a `FigureDef` costs nothing resident, but most outfits
 * are never worn in a session.
 */
const figuresById = new Map<string, FigureDef>([[CAT_FIGURE.id, CAT_FIGURE]]);

/**
 * The figure that draws a cat looking like `look` in `outfit`. Each pairing
 * is a figure of its own, because a cell is keyed on figure, state and frame
 * alone and both her coat and her garments are painted into every cell.
 */
export function catFigureFor(look: CatLook, outfit: Outfit<'cat'>): FigureDef {
  const id = catFigureId(look, outfit);
  const known = figuresById.get(id);
  if (known !== undefined) return known;
  const figure = catFigure(look, outfit);
  figuresById.set(id, figure);
  return figure;
}
