/**
 * Splash Zone as painted figures: his choreography, his cell geometry, and the
 * four `FigureDef`s the runtime cache and the review harness draw through — the
 * otter himself, his crossbow bolt, the travelling wave and the splash it
 * breaks into.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, and where a pose sits in its cell. Anatomy, palette and every
 * stroke of paint live in `splashZoneArt.ts` (the otter) and
 * `splashZoneWaterArt.ts` (the effects).
 *
 * Rows, each in three views (`<row>`, `<row>_side`, `<row>_away`):
 *    idle       a bouncy, sociable stance: two hops on his toes a cycle
 *    walk       a waddle-trot, the body rolling over each stance foot
 *    shoot      the hand crossbow raised, fired and re-cocked
 *    cast_wave  water gathered at the paws and flung forward
 *    hurt       a short flinch
 *    death      a stagger and a fall onto his back, paws folded on his chest
 *               the way an otter floats — the last frame is the corpse
 *
 * The art invariants live in `scripts/gates-splash-zone.ts`, which the review
 * harness runs: `npm run render:splash-zone`.
 */

import {
  REST_ARM_L,
  REST_ARM_R,
  REST_CROSSBOW,
  REST_TAIL_SWISH,
  THIGH,
  SHIN,
  LEG_SLACK,
  HIP_Y,
  ANKLE_Y,
  TWO_PI,
  type OtterArmPose,
  type OtterLegPose,
  type OtterPose,
  type OtterView,
  drawOtter,
  restPose,
} from './splashZoneArt';
import { drawBolt, drawSplash, drawWave } from './splashZoneWaterArt';
import { clamp01, deg, easeInOut, easeOut, hump, lerp } from './carlArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  SPLASH_ZONE_BOLT_FRAMES,
  SPLASH_ZONE_CAST_WAVE_FRAMES,
  SPLASH_ZONE_CAST_WAVE_RELEASE_FRAME,
  SPLASH_ZONE_CAST_WAVE_RELEASE_PROGRESS,
  SPLASH_ZONE_DEATH_FRAMES,
  SPLASH_ZONE_HURT_FRAMES,
  SPLASH_ZONE_IDLE_FRAMES,
  SPLASH_ZONE_SHOOT_FRAMES,
  SPLASH_ZONE_SHOOT_RELEASE_FRAME,
  SPLASH_ZONE_SHOOT_RELEASE_PROGRESS,
  SPLASH_ZONE_SPLASH_FRAMES,
  SPLASH_ZONE_WALK_FRAMES,
  SPLASH_ZONE_WAVE_FRAMES,
} from '../splashZoneTiming';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by `tileSize / TILE_SCALE`. */
export const TILE_SCALE = 64;

/**
 * The otter's cell and where his tile sits in it. Wide enough for him lying
 * flat after the fall and for the crossbow at full reach; the ground line is
 * the tile's bottom edge, with a quarter tile below it for the corpse.
 */
export const OTTER_FRAME_WIDTH = 160;
export const OTTER_FRAME_HEIGHT = 112;
export const OTTER_TILE_X = 48;
export const OTTER_TILE_Y = 32;

/**
 * The share of his authored size he is drawn at. Scaled about the point between
 * his feet, so he stays standing on his tile: a shade over a tile tall, which
 * is how "short" reads next to Carl's two.
 */
export const OTTER_BODY_SCALE = 0.88;

/**
 * How far above the top of his tile the tallest standing frame reaches, in
 * tiles: where a health bar or a speech bubble has to clear. Measured off the
 * painted cells, because nothing can measure ink at runtime, and re-measured
 * by `scripts/gates-splash-zone.ts` on every render.
 */
export const SPLASH_ZONE_STANDING_TOP_ABOVE_TILE = 0.0625;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

export function shotProgress(frame: number, frameCount: number): number {
  return (frame + HALF) / frameCount;
}

const HALF = 0.5;

/** 0 before `start`, 1 after `end`, linear between. */
function window01(value: number, start: number, end: number): number {
  return clamp01((value - start) / (end - start));
}

function mod1(value: number): number {
  return ((value % 1) + 1) % 1;
}

function blendArm(a: OtterArmPose, b: OtterArmPose, t: number): OtterArmPose {
  return {
    swing: lerp(a.swing, b.swing, t),
    spread: lerp(a.spread, b.spread, t),
    bend: lerp(a.bend, b.bend, t),
  };
}

function withArm(arm: OtterArmPose, extra: Partial<OtterArmPose>): OtterArmPose {
  return {
    swing: arm.swing + (extra.swing ?? 0),
    spread: arm.spread + (extra.spread ?? 0),
    bend: arm.bend + (extra.bend ?? 0),
  };
}

/** The leg's full reach, less the headroom the knee keeps. */
const LEG_REACH = THIGH + SHIN - LEG_SLACK;

// ── Walk ─────────────────────────────────────────────────────────────────────

/**
 * Share of the stride a foot is planted. Over half, so there is a moment of
 * double support every step: a walk, however quick the waddle.
 */
const WALK_STANCE_SHARE = 0.58;
/** How far ahead of the hip a foot lands. Short legs, short steps. */
export const WALK_REACH = 0.09;
const WALK_LIFT = 0.045;
/**
 * The reach the walking pelvis rides on: a little short of full so the knee is
 * never locked through stance, which is what keeps the trot springy.
 */
const WALK_LEG_SPAN = LEG_REACH * 0.95;
/** The extra drop onto each footfall — the trot's bounce. */
const WALK_LAND_DROP = 0.03;
/** The trot's lift over the planted foot between footfalls. */
const WALK_MID_RISE = 0.014;
const WALK_LAND_DECAY = 0.3;
/** The waddle: the body rolls over whichever foot is planted. */
const WALK_ROLL = deg(7);
const WALK_SWAY = 0.016;
const WALK_LEAN = deg(7);
const WALK_ARM_SWING_FREE = deg(26);
/** The crossbow arm barely swings; the weapon is carried, not flung about. */
const WALK_ARM_SWING_CARRY = deg(7);
const WALK_TAIL_WAG = 0.8;
/** Centred, so the wag shows past alternate hips rather than popping out on one side only. */
const WALK_TAIL_REST_SHARE = 0;

export function gaitFoot(phase: number): OtterLegPose {
  const cycle = mod1(phase);
  if (cycle < WALK_STANCE_SHARE) {
    // A planted foot slides back through the cell at a constant rate, which is
    // the body being carried forward over it.
    return { fore: lerp(WALK_REACH, -WALK_REACH, cycle / WALK_STANCE_SHARE), lift: 0 };
  }
  const swing = (cycle - WALK_STANCE_SHARE) / (1 - WALK_STANCE_SHARE);
  return { fore: lerp(-WALK_REACH, WALK_REACH, easeInOut(swing)), lift: hump(swing) * WALK_LIFT };
}

/**
 * Ground one walk cycle covers, in tiles. A planted foot slides back through
 * the stance at exactly the rate the body is carried over it, so this falls out
 * of the stride — twice the reach, over the share of the cycle a foot is down —
 * at the size he is drawn. The runtime advances the walk phase by ground
 * covered against it, which is what keeps the planted foot from skating.
 */
export const SPLASH_ZONE_TILES_PER_WALK_CYCLE =
  ((2 * WALK_REACH) / WALK_STANCE_SHARE) * OTTER_BODY_SCALE;

function landPulse(phase: number, at: number): number {
  // A bell rather than a step: the weight sinks into the landing over a
  // couple of frames instead of dropping all at once on the contact frame.
  const since = mod1(phase - at);
  return since < WALK_LAND_DECAY ? hump(since / WALK_LAND_DECAY) : 0;
}

/**
 * How far the pelvis has to drop for a planted foot to stay reachable: it
 * vaults over the stance leg, lowest at contact when the foot is furthest
 * ahead — which is what a real pelvis does, and why a stride never clamps.
 */
function stanceDrop(foot: OtterLegPose): number {
  if (foot.lift > 0) return 0;
  const standingHeight = Math.sqrt(Math.max(0, WALK_LEG_SPAN ** 2 - foot.fore ** 2));
  return Math.max(0, -HIP_Y + ANKLE_Y - standingHeight);
}

export function walkPose(phase: number): OtterPose {
  const legR = gaitFoot(phase);
  const legL = gaitFoot(phase + HALF);
  const land = Math.max(landPulse(phase, 0), landPulse(phase, HALF));
  // Right foot plants at phase 0, so its mid-stance is half the stance share later.
  const rollWave = Math.cos(TWO_PI * (phase - WALK_STANCE_SHARE * HALF));
  // Same-side arm furthest back at its own foot's contact.
  const armWave = Math.cos(TWO_PI * phase);
  const rest = restPose();
  return {
    ...rest,
    bob:
      Math.max(stanceDrop(legR), stanceDrop(legL)) +
      WALK_LAND_DROP * land -
      WALK_MID_RISE * (1 - land) * Math.abs(rollWave),
    sway: WALK_SWAY * rollWave,
    roll: WALK_ROLL * rollWave,
    lean: WALK_LEAN,
    headTilt: -WALK_ROLL * rollWave * HALF,
    headPitch: deg(3) * land,
    armR: withArm(REST_ARM_R, { swing: -WALK_ARM_SWING_CARRY * armWave }),
    armL: withArm(REST_ARM_L, { swing: WALK_ARM_SWING_FREE * armWave }),
    legR,
    legL,
    // The tail counterweights the waddle, swinging across behind him each step.
    tailSwish: REST_TAIL_SWISH * WALK_TAIL_REST_SHARE - WALK_TAIL_WAG * rollWave,
    tailLift: 0.02 * land,
    mouthOpen: 0.12,
    time: phase,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/** The hop onto his toes. Two per cycle; bounded by the leg's reach at full stretch. */
const IDLE_BOUNCE = 0.014;
const IDLE_HOPS_PER_CYCLE = 2;
/**
 * The dip into the knees between hops. The rise is capped by the leg's reach,
 * so most of the bounce is this sink, which is free.
 */
const IDLE_DIP = 0.03;
const IDLE_HEAD_TILT = deg(9);
const IDLE_TAIL_WAG = 0.28;
/** The frame the eyes are shut on; the frames either side are half-lidded. */
const IDLE_BLINK_PHASE = 0.75;
const IDLE_BLINK_HALF_WIDTH = 1.5 / SPLASH_ZONE_IDLE_FRAMES;

function idlePose(phase: number): OtterPose {
  const angle = phase * TWO_PI;
  const hop = Math.abs(Math.sin((angle * IDLE_HOPS_PER_CYCLE) / 2));
  const settle = (1 - hop) ** 2;
  const rest = restPose();
  const blinkDistance = Math.abs(phase - IDLE_BLINK_PHASE);
  return {
    ...rest,
    bob: -IDLE_BOUNCE * hop + IDLE_DIP * settle,
    headTilt: IDLE_HEAD_TILT * Math.sin(angle),
    headPitch: deg(-3) * hop,
    lean: deg(2) * Math.sin(angle),
    armL: withArm(REST_ARM_L, { swing: deg(6) * hop, spread: deg(4) * hop }),
    armR: withArm(REST_ARM_R, { swing: deg(3) * hop }),
    tailSwish: REST_TAIL_SWISH + IDLE_TAIL_WAG * Math.sin(angle + 1),
    tailLift: 0.03 * hop,
    blink:
      blinkDistance < IDLE_BLINK_HALF_WIDTH
        ? hump(HALF * (1 - blinkDistance / IDLE_BLINK_HALF_WIDTH))
        : 0,
    mouthOpen: 0.12,
    time: phase,
  };
}

// ── Shoot ────────────────────────────────────────────────────────────────────

const SHOOT_RAISE_END = 0.34;
const SHOOT_RECOIL_END = 0.72;
const SHOOT_RECOVER_START = 0.7;
/** The free paw works the string back to the latch on the way down, so the row hands off loaded. */
const SHOOT_RECOCK_START = 0.78;
const SHOOT_RECOCK_END = 0.95;
/** The shooting arm held straight out along the line of fire. */
const SHOOT_AIM_ARM: OtterArmPose = { swing: deg(80), spread: deg(-3), bend: deg(6) };
/** The free paw comes up under the shooting wrist to steady it. */
const SHOOT_BRACE_ARM: OtterArmPose = { swing: deg(58), spread: deg(-24), bend: deg(46) };
const SHOOT_LEAN = deg(5);
const SHOOT_RECOIL_KICK = deg(22);
/**
 * Squared up on the target but turned a touch outward: aimed dead at the
 * camera the crossbow foreshortens into the paw and the shot cannot be seen.
 */
const SHOOT_AIM_YAW = deg(16);
/** How long the muzzle snap lasts after the release, as a share of the row. */
const SHOOT_FLASH_SHARE = 0.18;

export function shootPose(progress: number): OtterPose {
  const raise = easeInOut(window01(progress, 0, SHOOT_RAISE_END));
  const released = progress >= SPLASH_ZONE_SHOOT_RELEASE_PROGRESS;
  const kick = released
    ? 1 - easeOut(window01(progress, SPLASH_ZONE_SHOOT_RELEASE_PROGRESS, SHOOT_RECOIL_END))
    : 0;
  const recover = easeInOut(window01(progress, SHOOT_RECOVER_START, 1));
  const held = raise * (1 - recover);
  const armR = withArm(blendArm(REST_ARM_R, SHOOT_AIM_ARM, held), {
    swing: SHOOT_RECOIL_KICK * kick,
  });
  const lean = SHOOT_LEAN * held - deg(5) * kick;
  // Level the crossbow along the line of fire whatever the forearm is doing.
  const forearmSwing = armR.swing + armR.bend + lean * HALF;
  const levelPitch = deg(90) - forearmSwing + SHOOT_RECOIL_KICK * kick * HALF;
  const rest = restPose();
  // Re-cocked on the way back down, so the row hands off to a loaded idle.
  const recock = released ? window01(progress, SHOOT_RECOCK_START, SHOOT_RECOCK_END) : 1;
  return {
    ...rest,
    lean,
    bob: 0.01 * held,
    headPitch: deg(4) * held - deg(8) * kick,
    headTilt: deg(-6) * held,
    armR,
    armL: blendArm(REST_ARM_L, SHOOT_BRACE_ARM, held),
    legL: { fore: 0.035 * raise * (1 - recover), lift: 0 },
    legR: { fore: -0.025 * raise * (1 - recover), lift: 0 },
    crossbow: {
      held: true,
      loaded: !released || recock >= 1,
      cocked: released ? recock : 1,
      pitch: lerp(REST_CROSSBOW.pitch, levelPitch, held),
      // Squared up on the target while aiming; carried turned out otherwise.
      yaw: lerp(REST_CROSSBOW.yaw, SHOOT_AIM_YAW, held),
      flash: released
        ? 1 -
          window01(
            progress,
            SPLASH_ZONE_SHOOT_RELEASE_PROGRESS,
            SPLASH_ZONE_SHOOT_RELEASE_PROGRESS + SHOOT_FLASH_SHARE,
          )
        : 0,
    },
    blink: held > 0.8 && !released ? 0.4 : 0,
    tailSwish: REST_TAIL_SWISH - 0.2 * held,
    time: progress,
  };
}

// ── Cast wave ────────────────────────────────────────────────────────────────

const CAST_GATHER_END = 0.42;
const CAST_FOLLOW_END = 0.84;
/** Paws swept low and back, gathering the water. */
const CAST_GATHER_ARM: OtterArmPose = { swing: deg(-38), spread: deg(26), bend: deg(28) };
/**
 * Paws flung out forward and wide as the wave leaves them. The spread is what
 * shows the sweep head-on, where an arm thrust straight at the camera
 * foreshortens to nothing and the pose reads as standing still.
 */
const CAST_THROW_ARM: OtterArmPose = { swing: deg(80), spread: deg(40), bend: deg(6) };
/** The crossbow hangs off its paw, muzzle down, while both paws sweep the water. */
const CAST_CROSSBOW_HANG = deg(-120);
const CAST_STEP = 0.05;
/** The lead foot steps in to brace for the throw, and back once it is done. */
const CAST_STEP_IN_START = 0.05;
const CAST_STEP_IN_END = 0.35;
const CAST_STEP_BACK_START = 0.8;
const CAST_STEP_BACK_END = 0.98;
/** Water starts to gather at the paws once they are on their way back. */
const CAST_WATER_START = 0.1;

export function castWavePose(progress: number): OtterPose {
  const gather = easeInOut(window01(progress, 0, CAST_GATHER_END));
  const sweep = easeOut(
    window01(progress, CAST_GATHER_END, SPLASH_ZONE_CAST_WAVE_RELEASE_PROGRESS),
  );
  const recover = easeInOut(window01(progress, CAST_FOLLOW_END, 1));
  const released = progress >= SPLASH_ZONE_CAST_WAVE_RELEASE_PROGRESS;
  const coil = gather * (1 - sweep);
  const thrown = sweep * (1 - recover);

  const armFor = (rest: OtterArmPose): OtterArmPose =>
    blendArm(
      blendArm(blendArm(rest, CAST_GATHER_ARM, gather), CAST_THROW_ARM, sweep),
      rest,
      recover,
    );

  const stepIn = easeInOut(window01(progress, CAST_STEP_IN_START, CAST_STEP_IN_END));
  const stepBack = easeInOut(window01(progress, CAST_STEP_BACK_START, CAST_STEP_BACK_END));
  const step = stepIn * (1 - stepBack);
  const stepLift =
    hump(window01(progress, CAST_STEP_IN_START, CAST_STEP_IN_END)) +
    hump(window01(progress, CAST_STEP_BACK_START, CAST_STEP_BACK_END));

  const rest = restPose();
  const armR = armFor(REST_ARM_R);
  return {
    ...rest,
    bob: 0.035 * coil - 0.012 * thrown,
    lean: deg(14) * coil - deg(4) * thrown,
    headPitch: deg(10) * coil - deg(10) * thrown,
    armR,
    armL: armFor(REST_ARM_L),
    legL: { fore: CAST_STEP * step, lift: 0.035 * stepLift },
    legR: { fore: -0.02 * step, lift: 0 },
    tailSwish: REST_TAIL_SWISH * (1 - thrown),
    tailLift: 0.1 * thrown,
    mouthOpen: lerp(0.2, 1, thrown),
    crossbow: {
      ...REST_CROSSBOW,
      pitch: lerp(lerp(REST_CROSSBOW.pitch, deg(40), coil), CAST_CROSSBOW_HANG, thrown),
      yaw: lerp(REST_CROSSBOW.yaw, 0, thrown),
    },
    water: released ? 0 : easeInOut(window01(progress, CAST_WATER_START, CAST_GATHER_END)),
    waterThrow: released
      ? 0.08 + 0.92 * window01(progress, SPLASH_ZONE_CAST_WAVE_RELEASE_PROGRESS, 1)
      : 0,
    time: progress * 2,
  };
}

// ── Hurt ─────────────────────────────────────────────────────────────────────

/** How hard the flinch is on each frame: straight in, eased out. */
const FLINCH_RECOVERY_CURVE = 1.5;
/** Where in the row the flinch is deepest, and how deep it already is on the first frame. */
const FLINCH_PEAK = 0.2;
const FLINCH_ON_IMPACT = 0.7;

function flinchAt(progress: number): number {
  // Straight in, then an even recovery: an eased recovery saves its whole
  // drop for the last frame and snaps back to standing.
  return progress < FLINCH_PEAK
    ? lerp(FLINCH_ON_IMPACT, 1, progress / FLINCH_PEAK)
    : 1 - ((progress - FLINCH_PEAK) / (1 - FLINCH_PEAK)) ** FLINCH_RECOVERY_CURVE;
}

function hurtPoseAt(flinch: number, progress: number): OtterPose {
  const rest = restPose();
  return {
    ...rest,
    // Knocked back and buckled: the lean shows in profile, the sideways reel
    // and the sag into the knees show head-on and from behind.
    lean: deg(-22) * flinch,
    roll: deg(-12) * flinch,
    sway: -0.03 * flinch,
    bob: 0.04 * flinch,
    headPitch: deg(-26) * flinch,
    headTilt: deg(16) * flinch,
    wince: flinch,
    mouthOpen: 0.8 * flinch,
    armL: withArm(REST_ARM_L, {
      swing: deg(40) * flinch,
      spread: deg(26) * flinch,
      bend: deg(46) * flinch,
    }),
    armR: withArm(REST_ARM_R, {
      spread: deg(30) * flinch,
      swing: deg(-18) * flinch,
      bend: deg(-20) * flinch,
    }),
    legR: { fore: -0.03 * flinch, lift: 0 },
    tailLift: 0.12 * flinch,
    tailSwish: REST_TAIL_SWISH + 0.25 * flinch,
    time: progress,
  };
}

export function hurtPose(progress: number): OtterPose {
  return hurtPoseAt(flinchAt(progress), progress);
}

// ── Death ────────────────────────────────────────────────────────────────────

const DEATH_STAGGER_END = 0.3;
const DEATH_FALL_START = 0.22;
const DEATH_FALL_END = 0.74;
const DEATH_REBOUND_END = 0.92;
/** How far the rebound off the floor lifts him, as a share of the fall. */
const DEATH_REBOUND = 0.05;
const DEATH_FOLD = deg(-18);
/** Where the fallen body is shifted so it lies over its own tile, in tiles. */
const FALLEN_SLIDE_X = 0.55;
/**
 * Lifts the fallen body so it rests on the ground line instead of straddling
 * it: by the depth of his back in profile, by his half-width lying face-up.
 */
const FALLEN_LIFT: Readonly<Record<OtterView, number>> = { side: 0.12, front: 0.2, away: 0.2 };
/** Paws folded on the chest, the crossbow clutched across it: how an otter floats. */
const FLOAT_ARM: OtterArmPose = { swing: deg(20), spread: deg(-22), bend: deg(84) };
/**
 * The crossbow laid along his chest toward his chin, so it lies flat on the
 * fallen body instead of standing up off it like a raised hand.
 */
const FLOAT_CROSSBOW_PITCH = deg(76);
/** Gravity: the fall accelerates to the floor, eased just short of a pure square so the last step is not a snap. */
const FALL_EXPONENT = 1.6;
/** The limbs are settled by here; after it the corpse holds perfectly still. */
const DEATH_SETTLED = 0.8;

/** Which way each view topples: backward in profile, sideways head-on. */
const TOPPLE_DIRECTION: Readonly<Record<OtterView, number>> = { side: -1, front: 1, away: -1 };

export function deathPose(progress: number, view: OtterView): OtterPose {
  const stagger = easeInOut(window01(progress, 0, DEATH_STAGGER_END));
  const fallT = window01(progress, DEATH_FALL_START, DEATH_FALL_END);
  // Gravity: the fall accelerates all the way to the floor.
  const fall = fallT ** FALL_EXPONENT;
  const rebound = hump(window01(progress, DEATH_FALL_END, DEATH_REBOUND_END)) * DEATH_REBOUND;
  const limp = easeInOut(window01(progress, DEATH_FALL_START, DEATH_SETTLED));
  const hurt = hurtPoseAt(stagger * (1 - limp), progress);
  const direction = TOPPLE_DIRECTION[view];
  const turned = fall - rebound;
  return {
    ...hurt,
    bob: 0.05 * stagger * (1 - fall),
    lean: lerp(hurt.lean, 0, limp),
    headPitch: lerp(hurt.headPitch, deg(-6), limp),
    headTilt: lerp(hurt.headTilt, 0, limp),
    wince: limp > HALF ? 0 : hurt.wince,
    dead: limp > HALF,
    mouthOpen: lerp(hurt.mouthOpen, 0.25, limp),
    armR: blendArm(hurt.armR, FLOAT_ARM, limp),
    armL: blendArm(hurt.armL, FLOAT_ARM, limp),
    legR: { fore: lerp(hurt.legR.fore, 0.07, limp), lift: 0 },
    legL: { fore: lerp(0, 0.04, limp), lift: 0 },
    tailSwish: lerp(hurt.tailSwish, 0.2, limp),
    tailLift: 0,
    tailCurl: fall,
    crossbow: {
      ...REST_CROSSBOW,
      pitch: lerp(REST_CROSSBOW.pitch, FLOAT_CROSSBOW_PITCH, limp),
      yaw: lerp(REST_CROSSBOW.yaw, 0, limp),
    },
    // The upper body lags the fall and catches up on landing, so he folds
    // at the hips going down rather than tipping over like a plank.
    roll: hurt.roll * (1 - limp) + direction * DEATH_FOLD * hump(fallT),
    topple: direction * (Math.PI / 2) * turned,
    slide: { x: -direction * FALLEN_SLIDE_X * fall, y: -FALLEN_LIFT[view] * fall },
    time: progress,
  };
}

// ── Row table ────────────────────────────────────────────────────────────────

export type SplashZoneRow = 'idle' | 'walk' | 'shoot' | 'cast_wave' | 'hurt' | 'death';
export type RowKind = 'loop' | 'oneShot';

export interface SplashZoneRowSpec {
  readonly row: SplashZoneRow;
  readonly frameCount: number;
  readonly kind: RowKind;
  /** The frame the row's event — the bolt or the wave leaving — is drawn on. */
  readonly releaseFrame?: number;
  readonly pose: (t: number, view: OtterView) => OtterPose;
}

export const SPLASH_ZONE_ROWS: readonly SplashZoneRowSpec[] = [
  { row: 'idle', frameCount: SPLASH_ZONE_IDLE_FRAMES, kind: 'loop', pose: (t) => idlePose(t) },
  { row: 'walk', frameCount: SPLASH_ZONE_WALK_FRAMES, kind: 'loop', pose: (t) => walkPose(t) },
  {
    row: 'shoot',
    frameCount: SPLASH_ZONE_SHOOT_FRAMES,
    kind: 'oneShot',
    releaseFrame: SPLASH_ZONE_SHOOT_RELEASE_FRAME,
    pose: (t) => shootPose(t),
  },
  {
    row: 'cast_wave',
    frameCount: SPLASH_ZONE_CAST_WAVE_FRAMES,
    kind: 'oneShot',
    releaseFrame: SPLASH_ZONE_CAST_WAVE_RELEASE_FRAME,
    pose: (t) => castWavePose(t),
  },
  { row: 'hurt', frameCount: SPLASH_ZONE_HURT_FRAMES, kind: 'oneShot', pose: (t) => hurtPose(t) },
  {
    row: 'death',
    frameCount: SPLASH_ZONE_DEATH_FRAMES,
    kind: 'oneShot',
    pose: (t, view) => deathPose(t, view),
  },
];

export const SPLASH_ZONE_VIEWS: readonly OtterView[] = ['front', 'side', 'away'];

/** The state name a row is painted under in a view. */
export function splashZoneStateName(row: SplashZoneRow, view: OtterView): string {
  if (view === 'side') return `${row}_side`;
  if (view === 'away') return `${row}_away`;
  return row;
}

interface ResolvedState {
  readonly spec: SplashZoneRowSpec;
  readonly view: OtterView;
}

const STATE_TABLE: ReadonlyMap<string, ResolvedState> = new Map(
  SPLASH_ZONE_ROWS.flatMap((spec) =>
    SPLASH_ZONE_VIEWS.map((view): [string, ResolvedState] => [
      splashZoneStateName(spec.row, view),
      { spec, view },
    ]),
  ),
);

/** The pose a state's frame is painted from, for the painter and the gates alike. */
export function splashZonePoseAt(state: string, frame: number): OtterPose | null {
  const resolved = STATE_TABLE.get(state);
  if (resolved === undefined) return null;
  const { spec, view } = resolved;
  const t =
    spec.kind === 'loop'
      ? cyclePhase(frame, spec.frameCount)
      : shotProgress(frame, spec.frameCount);
  return spec.pose(t, view);
}

/** The view a state is painted in, or null for a state the figure does not declare. */
export function splashZoneViewOf(state: string): OtterView | null {
  return STATE_TABLE.get(state)?.view ?? null;
}

function paintOtterFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const resolved = STATE_TABLE.get(state);
  const pose = splashZonePoseAt(state, frame);
  if (resolved === undefined || pose === null) return;
  ctx.save();
  try {
    ctx.translate(OTTER_FRAME_WIDTH / 2, OTTER_TILE_Y + TILE_SCALE);
    ctx.scale(TILE_SCALE * OTTER_BODY_SCALE, TILE_SCALE * OTTER_BODY_SCALE);
    drawOtter(ctx, resolved.view, pose);
  } finally {
    ctx.restore();
  }
}

function otterStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const [name, { spec }] of STATE_TABLE) frames[name] = spec.frameCount;
  return frames;
}

/**
 * The otter composes himself on a scratch surface at whatever density he is
 * painted at and outlines the finished silhouette one pixel wide, so a
 * supersampled bake would only smear that outline — hence `skipSupersample`.
 */
export const SPLASH_ZONE_FIGURE: FigureDef = {
  id: 'splash_zone',
  frameWidth: OTTER_FRAME_WIDTH,
  frameHeight: OTTER_FRAME_HEIGHT,
  tileX: OTTER_TILE_X,
  tileY: OTTER_TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(otterStateFrames()),
  paintFrame: paintOtterFrame,
  skipSupersample: true,
};

// ── Effects ──────────────────────────────────────────────────────────────────

/**
 * Each effect is its own figure because no two cells are alike. The bolt and
 * the wave are directional: painted travelling along +X and rotated by the
 * runtime to their heading, each anchored on its own leading point so the
 * position a caller passes is where it hits. The splash is upright and
 * anchored on the ground under its centre.
 */
export const BOLT_STATE = 'fly';
export const WAVE_STATE = 'roll';
export const SPLASH_STATE = 'burst';

const BOLT_FRAME_WIDTH = 48;
const BOLT_FRAME_HEIGHT = 16;
/** The bolt's tip sits here in its cell: nearly at the front edge, the shaft and streak behind. */
const BOLT_ANCHOR_X = 40;

const WAVE_FRAME_WIDTH = 112;
const WAVE_FRAME_HEIGHT = 112;
/** The crest's apex; the wash trails back behind it. */
const WAVE_ANCHOR_X = 88;

const SPLASH_FRAME_WIDTH = 112;
const SPLASH_FRAME_HEIGHT = 112;
/** Ground point under the splash; the spray rises well above it. */
const SPLASH_ANCHOR_Y = 76;

/**
 * The wave's authored width across its direction of travel, in tiles. The
 * runtime stretches the cell across its heading to sweep a wider or narrower
 * cone; this is the width a stretch of 1 draws.
 */
export const WAVE_AUTHORED_WIDTH_TILES = 1.2;
/** The bolt's authored length, tip to fletching, in tiles. */
export const BOLT_LENGTH_TILES = 0.4;

function effectFigure(
  id: string,
  state: string,
  frames: number,
  size: {
    readonly width: number;
    readonly height: number;
    readonly anchorX: number;
    readonly anchorY: number;
  },
  paint: (ctx: CanvasRenderingContext2D, frame: number) => void,
): FigureDef {
  return {
    id,
    frameWidth: size.width,
    frameHeight: size.height,
    tileX: size.anchorX,
    tileY: size.anchorY,
    tileScale: TILE_SCALE,
    states: figureStates({ [state]: frames }),
    paintFrame: (ctx, painted, frame) => {
      if (painted !== state) return;
      ctx.save();
      try {
        ctx.translate(size.anchorX, size.anchorY);
        ctx.scale(TILE_SCALE, TILE_SCALE);
        paint(ctx, frame);
      } finally {
        ctx.restore();
      }
    },
  };
}

export const SPLASH_ZONE_BOLT_FIGURE: FigureDef = effectFigure(
  'splash_zone_bolt',
  BOLT_STATE,
  SPLASH_ZONE_BOLT_FRAMES,
  {
    width: BOLT_FRAME_WIDTH,
    height: BOLT_FRAME_HEIGHT,
    anchorX: BOLT_ANCHOR_X,
    anchorY: BOLT_FRAME_HEIGHT / 2,
  },
  (ctx, frame) => {
    drawBolt(ctx, BOLT_LENGTH_TILES, cyclePhase(frame, SPLASH_ZONE_BOLT_FRAMES));
  },
);

export const SPLASH_ZONE_WAVE_FIGURE: FigureDef = effectFigure(
  'splash_zone_wave',
  WAVE_STATE,
  SPLASH_ZONE_WAVE_FRAMES,
  {
    width: WAVE_FRAME_WIDTH,
    height: WAVE_FRAME_HEIGHT,
    anchorX: WAVE_ANCHOR_X,
    anchorY: WAVE_FRAME_HEIGHT / 2,
  },
  (ctx, frame) => {
    drawWave(ctx, WAVE_AUTHORED_WIDTH_TILES, cyclePhase(frame, SPLASH_ZONE_WAVE_FRAMES));
  },
);

export const SPLASH_ZONE_SPLASH_FIGURE: FigureDef = effectFigure(
  'splash_zone_splash',
  SPLASH_STATE,
  SPLASH_ZONE_SPLASH_FRAMES,
  {
    width: SPLASH_FRAME_WIDTH,
    height: SPLASH_FRAME_HEIGHT,
    anchorX: SPLASH_FRAME_WIDTH / 2,
    anchorY: SPLASH_ANCHOR_Y,
  },
  (ctx, frame) => {
    drawSplash(ctx, shotProgress(frame, SPLASH_ZONE_SPLASH_FRAMES));
  },
);

export const SPLASH_ZONE_EFFECT_FIGURES: readonly FigureDef[] = [
  SPLASH_ZONE_BOLT_FIGURE,
  SPLASH_ZONE_WAVE_FIGURE,
  SPLASH_ZONE_SPLASH_FIGURE,
];
