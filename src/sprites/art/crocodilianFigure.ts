/**
 * The Crocodilians as painted figures: the choreography, the cell geometry and
 * the `FigureDef`s the runtime cache and the review harness draw through —
 * Bucket Boy, Clarabelle, and the Triage sparkle that lands on whoever Bucket
 * Boy heals.
 *
 * This module is choreography and nothing else: one pose function per row and
 * the row tables. Anatomy, palette and every stroke of paint live in
 * `crocodilianArt.ts`; the sparkle's paint lives in `triageSparkleArt.ts`.
 *
 * Bucket Boy's rows, each in three views (`<row>`, `<row>_side`, `<row>_away`):
 *    idle, walk, flee, slap, cast_triage, cower, hurt, death
 * Clarabelle's rows, likewise:
 *    idle, walk, talk
 * The sparkle's single row:
 *    sparkle
 *
 * The art invariants live in `scripts/gates-crocodilian.ts`, which the review
 * harness runs: `npm run render:crocodilian`.
 */

import { clamp01, deg, easeInOut, easeOut, hump, lerp, type Pt } from './carlArt';
import {
  BUCKET_BOY_BUILD,
  BUCKET_REST_HEIGHT,
  CLARABELLE_BUILD,
  type ArmAngles,
  type CrocArmPose,
  type CrocBuild,
  type CrocFootPose,
  type CrocPose,
  type CrocView,
  drawCrocodilian,
  ankleUnderHip,
  facingRestFeet,
  restingPose,
  shoulderJoints,
  skeletonLandmarks,
} from './crocodilianArt';
import { drawTriageSparkle } from './triageSparkleArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  BUCKET_BOY_COWER_FRAMES,
  BUCKET_BOY_DEATH_FRAMES,
  BUCKET_BOY_FLEE_FRAMES,
  BUCKET_BOY_HURT_FRAMES,
  BUCKET_BOY_IDLE_FRAMES,
  BUCKET_BOY_SLAP_FRAMES,
  BUCKET_BOY_SLAP_IMPACT_FRAME,
  BUCKET_BOY_TRIAGE_FRAMES,
  BUCKET_BOY_TRIAGE_RELEASE_FRAME,
  BUCKET_BOY_WALK_FRAMES,
  CLARABELLE_IDLE_FRAMES,
  CLARABELLE_TALK_FRAMES,
  CLARABELLE_TALK_PALM_FRAME,
  CLARABELLE_WALK_FRAMES,
  TRIAGE_SPARKLE_FRAMES,
} from '../crocodilianTiming';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** The ground line's row within the tile, matched to Carl's so they stand on one floor. */
const GROUND_ROW_IN_TILE = 58;
export const GROUND_OFFSET_IN_TILE = GROUND_ROW_IN_TILE / TILE_SCALE;

/** One figure's cell: its size and where its tile sits inside it. */
export interface CrocCell {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

/**
 * Bucket Boy's cell is wide rather than tall: he is short, but his corpse lies
 * full length across the floor and his tail drags half a tile behind him.
 */
export const BUCKET_BOY_CELL: CrocCell = {
  frameWidth: 192,
  frameHeight: 112,
  tileX: 64,
  tileY: 36,
};

export const CLARABELLE_CELL: CrocCell = {
  frameWidth: 160,
  frameHeight: 152,
  tileX: 48,
  tileY: 76,
};

export const TRIAGE_SPARKLE_CELL: CrocCell = {
  frameWidth: 96,
  frameHeight: 128,
  tileX: 16,
  tileY: 56,
};

/** The cell pixel a pose's ground point — between the feet — is painted at. */
export function originOf(cell: CrocCell): Pt {
  return { x: cell.tileX + TILE_SCALE / 2, y: cell.tileY + GROUND_ROW_IN_TILE };
}

// ── Pose helpers ─────────────────────────────────────────────────────────────

function pt(x: number, y: number): Pt {
  return { x, y };
}

/** Piecewise linear interpolation through (t, value) keys. */
function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [prevT, prevV] = keys[i - 1];
    const [nextT, nextV] = keys[i];
    if (t <= nextT) return lerp(prevV, nextV, (t - prevT) / (nextT - prevT));
  }
  return keys[keys.length - 1][1];
}

/** Eased interpolation through (t, value) keys: each span eases in and out. */
function keyedSmooth(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [prevT, prevV] = keys[i - 1];
    const [nextT, nextV] = keys[i];
    if (t <= nextT) return lerp(prevV, nextV, easeInOut((t - prevT) / (nextT - prevT)));
  }
  return keys[keys.length - 1][1];
}

const HUMP_PEAK = 0.5;

/**
 * A one-shot bump centred on `at` in cycle phase, peaking exactly there. The
 * half is load-bearing: `hump` is zero at both ends of its interval, so feeding
 * it `1 - distance/width` plays the event inside out.
 */
function pulseAt(phase: number, at: number, width: number): number {
  const distance = Math.abs(((phase - at + 1.5) % 1) - HUMP_PEAK);
  return distance > width ? 0 : hump(HUMP_PEAK * (1 - distance / width));
}

/** Loops sample the cycle evenly, so the last frame does not repeat the first. */
function cyclePhase(frame: number, frames: number): number {
  return frame / frames;
}

/** One-shots run first frame to last, both ends drawn. */
function shotT(frame: number, frames: number): number {
  return frames <= 1 ? 1 : frame / (frames - 1);
}

function wave(phase: number): number {
  return Math.sin(phase * Math.PI * 2);
}

/**
 * How far forward the near arm is, −1 back to +1 forward. Cosine: phase 0 is
 * the near foot's contact, and at contact the same-side arm is furthest back.
 */
function armSwingDrive(phase: number): number {
  return -Math.cos(phase * Math.PI * 2);
}

/** Which side of the drawing a limb is on, head-on. */
const NEAR_SIDE = 1;
const FAR_SIDE = -1;
const ELBOW_BACK = 1;
/** Past halfway through a blend, the target pose's hand shape takes over. */
const HALFWAY = 0.5;
/** A hand hanging from a relaxed arm reaches just short of its full span, so the elbow keeps a soft bend. */
const HANG_REACH_SHARE = 0.95;
const SWING_REACH_SHARE = 0.92;
/** How tightly a hand is closed, 0 open to 1 fist, in the poses that hold one. */
const LIMP_HAND_CURL = 0.3;
const FOLDED_HAND_CURL = 0.85;
const FLINCH_HAND_CURL = 0.6;
const RESTING_HAND_CURL = 0.35;
const CAST_HAND_CURL = 0.1;

function isProfile(view: CrocView): boolean {
  return view === 'side';
}

function armAt(
  hand: Pt,
  bend: number,
  curl: number,
  handAngle: number | null = null,
  behind = false,
): CrocArmPose {
  return { angles: null, hand, bend, curl, handAngle, behind, palmOut: false };
}

function armByAngles(angles: ArmAngles, curl: number, behind = false): CrocArmPose {
  return {
    angles,
    hand: pt(0, 0),
    bend: ELBOW_BACK,
    curl,
    handAngle: null,
    behind,
    palmOut: false,
  };
}

/** A head-on elbow breaks away from the centreline: out toward its own side. */
function facingElbow(side: number): number {
  return -side;
}

/**
 * The same outward elbow for a hand raised above its shoulder. The solver's
 * bend is relative to the shoulder→hand direction, so an arm reaching up needs
 * the opposite sign to keep the elbow out; the hanging sign folds it in across
 * the chest.
 */
function facingElbowFor(side: number, shoulderY: number, handY: number): number {
  return handY < shoulderY ? side : -side;
}

// ── The gait ─────────────────────────────────────────────────────────────────

/** How one build walks. Lengths are shares of the build's own leg, so both bodies share one gait. */
interface Gait {
  /** Half the ground a planted foot slides through, as a share of the leg. */
  readonly strideShare: number;
  readonly stanceFraction: number;
  /** Peak foot lift in swing, as a share of the leg. */
  readonly liftShare: number;
  /** Pelvis drop at each contact, as a share of the leg. */
  readonly dropShare: number;
  readonly toeOffLift: number;
  readonly lean: number;
  readonly armSwing: number;
  /** Head-on: how far the pelvis sways over the stance foot, in tiles per tile of hip width. */
  readonly swayShare: number;
  /** A standing crouch held through the whole cycle, as a share of the leg. */
  readonly crouchShare: number;
}

const BUCKET_BOY_WALK: Gait = {
  strideShare: 0.3,
  stanceFraction: 0.58,
  liftShare: 0.2,
  dropShare: 0.045,
  toeOffLift: deg(26),
  lean: deg(4),
  armSwing: deg(24),
  swayShare: 0.2,
  crouchShare: 0,
};

/**
 * A hunched, quick scurry: shorter duty, higher knees, a deep stoop and a real
 * flight phase. It is a run in everything but dignity.
 */
const BUCKET_BOY_FLEE: Gait = {
  strideShare: 0.33,
  stanceFraction: 0.4,
  liftShare: 0.3,
  dropShare: 0.07,
  toeOffLift: deg(38),
  lean: deg(22),
  armSwing: deg(46),
  swayShare: 0.3,
  crouchShare: 0.05,
};

const CLARABELLE_WALK: Gait = {
  strideShare: 0.27,
  stanceFraction: 0.6,
  liftShare: 0.12,
  dropShare: 0.035,
  toeOffLift: deg(22),
  lean: deg(2),
  armSwing: deg(20),
  swayShare: 0.14,
  crouchShare: 0,
};

function legLength(build: CrocBuild): number {
  return build.thigh + build.shin;
}

/** Half the distance a planted foot slides, in tiles. */
export function strideHalf(build: CrocBuild, gait: Gait): number {
  return legLength(build) * gait.strideShare;
}

/**
 * Tiles covered per full cycle of a gait: two steps, each the whole stance
 * slide. Exported so a kit can pace the walk phase by ground covered, which is
 * the only way a planted foot stays planted.
 */
export function tilesPerCycle(build: CrocBuild, gait: Gait): number {
  const stance = strideHalf(build, gait) * 2;
  return stance / gait.stanceFraction;
}

/** How far forward, in the cycle, the second foot contacts. */
export const CONTRALATERAL_PHASE = 0.5;

interface FootPhase {
  readonly stance: boolean;
  /** 0→1 through whichever of stance or swing the foot is in. */
  readonly t: number;
}

function footPhase(phase: number, gait: Gait): FootPhase {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < gait.stanceFraction;
  const t = stance
    ? cycle / gait.stanceFraction
    : (cycle - gait.stanceFraction) / (1 - gait.stanceFraction);
  return { stance, t };
}

/** Where in stance the heel starts to peel up for the push-off. */
const HEEL_PEEL_STARTS = 0.62;

/** One foot of the profile gait. Phase 0 is this foot's contact. */
function gaitFootSide(build: CrocBuild, gait: Gait, phase: number, lead: number): CrocFootPose {
  const s = strideHalf(build, gait);
  const lift = legLength(build) * gait.liftShare;
  const { stance, t } = footPhase(phase, gait);
  if (stance) {
    return {
      // Planted: the ball holds still on the floor and the body travels over it.
      ball: pt(lead + lerp(s, -s, t), 0),
      heelLift: keyed(t, [
        [0, 0],
        [HEEL_PEEL_STARTS, 0],
        [1, gait.toeOffLift],
      ]),
      kneeBreak: 1,
      foreshorten: 0,
      nearness: 0,
    };
  }
  const x = lerp(-s, s, easeInOut(t));
  return {
    ball: pt(lead + x, -lift * hump(Math.min(1, t * 1.15))),
    heelLift: keyed(t, [
      [0, gait.toeOffLift],
      [0.3, gait.toeOffLift * 0.5],
      [0.75, deg(-12)],
      [1, 0],
    ]),
    kneeBreak: 1,
    foreshorten: 0,
    nearness: 0,
  };
}

/** Head-on, a stride shows only as the foot rising and the shin widening toward the camera. */
const FACING_DRIFT_SHARE = 0.25;

function gaitFootFacing(build: CrocBuild, gait: Gait, phase: number, side: number): CrocFootPose {
  const home = facingRestFeet(build)[side === NEAR_SIDE ? 'near' : 'far'].ball.x;
  const lift = legLength(build) * gait.liftShare;
  const drift = strideHalf(build, gait) * FACING_DRIFT_SHARE;
  const { stance, t } = footPhase(phase, gait);
  if (stance) {
    return {
      ball: pt(home + drift * lerp(1, -1, t), 0),
      heelLift: keyed(t, [
        [0, 0],
        [HEEL_PEEL_STARTS, 0],
        [1, gait.toeOffLift * FACING_HEEL_SHARE],
      ]),
      kneeBreak: 1,
      foreshorten: 1,
      nearness: 0,
    };
  }
  const rise = hump(Math.min(1, t * 1.15));
  return {
    ball: pt(home + drift * lerp(-1, 1, easeInOut(t)), -lift * rise * FACING_LIFT_SHARE),
    heelLift: gait.toeOffLift * FACING_HEEL_SHARE * (1 - t),
    kneeBreak: 1,
    foreshorten: 1,
    nearness: rise,
  };
}

/** Head-on a heel peel is mostly toward the camera; only a share of it shows. */
const FACING_HEEL_SHARE = 0.4;
const FACING_LIFT_SHARE = 1.3;

/** The pelvis drops at each contact; a raised cosine, so it eases through both ends. */
function gaitBob(build: CrocBuild, gait: Gait, phase: number): number {
  const drop = legLength(build) * gait.dropShare;
  return (drop * (1 + Math.cos(phase * Math.PI * 2 * 2))) / 2 + legLength(build) * gait.crouchShare;
}

// ── Arms ─────────────────────────────────────────────────────────────────────

/** The hang both idle and walk centre on, so stepping off never tucks the arms in. */
const ARM_REST_UPPER = deg(-3);
const ARM_REST_FORE = deg(14);
const ARM_BACKSWING_SHARE = 0.6;
const FOREARM_FOLLOW = 0.35;
/** The bucket arm swings less: a full pail is a pendulum on the end of it. */
const BUCKET_ARM_SWING_SHARE = 0.35;

function sideArmAngles(forward: number, amplitude: number): ArmAngles {
  const signed = forward >= 0 ? forward : forward * ARM_BACKSWING_SHARE;
  const swing = signed + (1 - ARM_BACKSWING_SHARE) / 2;
  const upper = ARM_REST_UPPER + swing * amplitude;
  return { upper, fore: upper * FOREARM_FOLLOW + ARM_REST_FORE, foreScale: 1 };
}

/** Head-on the arm hangs slightly out from the hip, elbow broken outward. */
const FACING_UPPER_TILT = deg(9);
const FACING_FORE_TILT = deg(2);
const FACING_UPPER_SWING = deg(5);
const FACING_FORE_SWING = deg(12);
const FACING_FORESHORTEN = 0.14;

function facingArmAngles(
  side: number,
  swing: number,
  forward: number,
  amplitudeShare: number,
): ArmAngles {
  return {
    upper: side * (FACING_UPPER_TILT + swing * FACING_UPPER_SWING * amplitudeShare),
    fore: side * (FACING_FORE_TILT + swing * FACING_FORE_SWING * amplitudeShare),
    foreScale: 1 - forward * FACING_FORESHORTEN * amplitudeShare,
  };
}

/** Swing drive for one head-on arm: `side` +1 swings forward on the beat. */
function facingSwing(phase: number, side: number): { swing: number; forward: number } {
  const own = armSwingDrive(phase) * side;
  const signed = own >= 0 ? own : own * ARM_BACKSWING_SHARE;
  // Remapped, never rectified: folding the back half up doubles the swing's speed.
  return { swing: signed - (1 - ARM_BACKSWING_SHARE) / 2, forward: (own + 1) / 2 };
}

const FACING_SWING_MIDPOINT = 0.5;
const WALK_HAND_CURL = 0.55;

// ── Shared walk ──────────────────────────────────────────────────────────────

/** How far the hanging bucket lags the arm carrying it, in cycle phase. */
const BUCKET_LAG = 0.15;
const BUCKET_WALK_SWING = deg(9);
const TAIL_WALK_SWING = deg(6);
const BLINK_AT = 0.75;
const BLINK_WIDTH = 0.07;
const WALK_HEAD_NOD = deg(3);

function walkPose(
  build: CrocBuild,
  gait: Gait,
  view: CrocView,
  phase: number,
  hasBucket: boolean,
): CrocPose {
  const pose = restingPose(build);
  pose.lean += gait.lean;
  pose.bob = gaitBob(build, gait, phase);
  pose.blink = pulseAt(phase, BLINK_AT, BLINK_WIDTH);
  pose.tailSwing = wave(phase - BUCKET_LAG) * TAIL_WALK_SWING;
  pose.headPitch += wave(phase * 2) * WALK_HEAD_NOD;
  if (hasBucket)
    pose.bucket = { kind: 'hang', swing: -wave(phase - BUCKET_LAG) * BUCKET_WALK_SWING };

  const nearShare = hasBucket ? BUCKET_ARM_SWING_SHARE : 1;
  if (isProfile(view)) {
    pose.near = gaitFootSide(build, gait, phase, ankleUnderHip(build));
    pose.far = gaitFootSide(build, gait, phase + CONTRALATERAL_PHASE, ankleUnderHip(build));
    const drive = armSwingDrive(phase);
    pose.nearArm = armByAngles(
      sideArmAngles(drive, gait.armSwing * nearShare),
      hasBucket ? 1 : WALK_HAND_CURL,
    );
    pose.farArm = armByAngles(sideArmAngles(-drive, gait.armSwing), WALK_HAND_CURL);
    return pose;
  }
  pose.near = gaitFootFacing(build, gait, phase, NEAR_SIDE);
  pose.far = gaitFootFacing(build, gait, phase + CONTRALATERAL_PHASE, FAR_SIDE);
  // The pelvis rides over whichever foot is planted.
  pose.sway = -wave(phase) * build.legRootHalf * gait.swayShare;
  const away = view === 'away';
  const near = facingSwing(phase, NEAR_SIDE);
  const far = facingSwing(phase, FAR_SIDE);
  pose.nearArm = armByAngles(
    facingArmAngles(NEAR_SIDE, near.swing, near.forward, nearShare),
    hasBucket ? 1 : WALK_HAND_CURL,
    away,
  );
  pose.farArm = armByAngles(
    facingArmAngles(FAR_SIDE, far.swing, far.forward, 1),
    WALK_HAND_CURL,
    away,
  );
  return pose;
}

// ── Bucket Boy: idle ─────────────────────────────────────────────────────────

const IDLE_SWAY = 0.05;
const IDLE_KNEE_PINCH = 0.82;
const IDLE_ROLL = deg(4);
const IDLE_ROCK = deg(2.5);
/** The glance over his shoulder: out at 0.45, held, back by 0.8. */
const GLANCE_KEYS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.38, 0],
  [0.5, 1],
  [0.66, 1],
  [0.8, 0],
  [1, 0],
];
/** Head-on he turns further round toward the profile; edge-on, round toward the camera. */
const FACING_GLANCE_YAW = deg(40);
const PROFILE_GLANCE_YAW = deg(-48);
const GLANCE_LIFT = deg(-8);
const IDLE_BLINK_AT = 0.2;
const IDLE_BLINK_WIDTH = 0.09;
const IDLE_BUCKET_SWING = deg(5);
const IDLE_TAIL_SWING = deg(5);
const IDLE_BREATH_RISE = 0.006;
/** The free hand fidgets — it opens and closes once a cycle. */
const FIDGET_CURL = 0.4;
/** The fidget runs a quarter-cycle behind the sway, so the hand is not in step with the hips. */
const FIDGET_LAG = 0.25;

function bucketBoyIdle(view: CrocView, phase: number): CrocPose {
  const build = BUCKET_BOY_BUILD;
  const pose = restingPose(build);
  const shift = wave(phase);
  const glance = keyedSmooth(phase, GLANCE_KEYS);
  pose.breath = wave(phase * 2);
  pose.bob = IDLE_BREATH_RISE * (1 + wave(phase * 2)) * HUMP_PEAK;
  pose.blink = pulseAt(phase, IDLE_BLINK_AT, IDLE_BLINK_WIDTH);
  pose.bucket = {
    kind: 'hang',
    swing: -Math.sin((phase - BUCKET_LAG) * Math.PI * 2) * IDLE_BUCKET_SWING,
  };
  pose.tailSwing = wave(phase - BUCKET_LAG) * IDLE_TAIL_SWING;
  pose.headPitch += glance * GLANCE_LIFT;

  if (isProfile(view)) {
    pose.lean += shift * IDLE_ROCK;
    pose.headYaw = glance * PROFILE_GLANCE_YAW;
    const drift = shift * 0.12;
    pose.nearArm = armByAngles(sideArmAngles(drift, deg(10)), 1);
    pose.farArm = armByAngles(sideArmAngles(-drift, deg(10)), fidgetCurl(phase));
    // Weight rocks between the feet: the unweighted heel peels a little.
    pose.near = { ...pose.near, heelLift: Math.max(0, -shift) * deg(10) };
    pose.far = { ...pose.far, heelLift: Math.max(0, shift) * deg(10) };
    return pose;
  }
  const feet = facingRestFeet(build);
  // Knees pinched a little toward each other: the timid stance.
  pose.near = {
    ...feet.near,
    heelLift: Math.max(0, -shift) * deg(12),
    kneeBreak: FAR_SIDE,
    foreshorten: IDLE_KNEE_PINCH,
  };
  pose.far = {
    ...feet.far,
    heelLift: Math.max(0, shift) * deg(12),
    kneeBreak: NEAR_SIDE,
    foreshorten: IDLE_KNEE_PINCH,
  };
  pose.sway = shift * IDLE_SWAY;
  pose.roll = -shift * IDLE_ROLL;
  pose.headYaw = glance * FACING_GLANCE_YAW;
  const away = view === 'away';
  pose.nearArm = armByAngles(
    facingArmAngles(NEAR_SIDE, shift * 0.2, FACING_SWING_MIDPOINT, 1),
    1,
    away,
  );
  pose.farArm = armByAngles(
    facingArmAngles(FAR_SIDE, -shift * 0.2, FACING_SWING_MIDPOINT, 1),
    fidgetCurl(phase),
    away,
  );
  return pose;
}

function fidgetCurl(phase: number): number {
  return RESTING_HAND_CURL + FIDGET_CURL * (1 + wave(phase + FIDGET_LAG)) * HUMP_PEAK;
}

// ── Bucket Boy: walk and flee ────────────────────────────────────────────────

function bucketBoyWalk(view: CrocView, phase: number): CrocPose {
  return walkPose(BUCKET_BOY_BUILD, BUCKET_BOY_WALK, view, phase, true);
}

const FLEE_HEAD_PITCH = deg(-10);
const FLEE_JAW = 0.35;

/**
 * The scurry: stooped, the bucket hugged up against his chest by the near arm
 * while the free arm flails, jaw open, eyes wide.
 */
function bucketBoyFlee(view: CrocView, phase: number): CrocPose {
  const build = BUCKET_BOY_BUILD;
  const pose = walkPose(build, BUCKET_BOY_FLEE, view, phase, true);
  pose.headPitch = FLEE_HEAD_PITCH + wave(phase * 2) * WALK_HEAD_NOD;
  pose.jaw = FLEE_JAW + wave(phase * 2) * 0.1;
  pose.blink = 0;
  pose.tailSwing = wave(phase - BUCKET_LAG) * TAIL_WALK_SWING * 2;
  const shoulders = shoulderJoints(build, pose, view);
  if (isProfile(view)) {
    // The pail clutched to his belly, bail in a fist at the chest.
    pose.nearArm = armAt(
      pt(shoulders.near.x + 0.12, shoulders.near.y + 0.14),
      ELBOW_BACK,
      1,
      deg(-10),
    );
    pose.bucket = { kind: 'hang', swing: -wave(phase - BUCKET_LAG) * BUCKET_WALK_SWING * 0.6 };
    return pose;
  }
  const away = view === 'away';
  pose.nearArm = armAt(
    pt(shoulders.near.x - 0.05, shoulders.near.y + 0.17),
    facingElbow(NEAR_SIDE),
    1,
    deg(100),
    away,
  );
  pose.bucket = { kind: 'hang', swing: -wave(phase - BUCKET_LAG) * BUCKET_WALK_SWING * 0.5 };
  return pose;
}

// ── Bucket Boy: slap ─────────────────────────────────────────────────────────

/**
 * A timid open-handed slap with the free hand: wind back, swat, flinch. His
 * eyes screw shut on the swing — he does not want to see it land.
 */
const SLAP_LUNGE_LEAN = deg(18);
const SLAP_LUNGE_STEP = 0.08;
const SLAP_LUNGE_DROP = 0.03;
const SLAP_STRIKE_DROP = 0.1;
/** How far back along the swing the motion smear trails the palm. */
const SLAP_SMEAR_SWEEP = deg(45);

/** The slap's beats, around its impact frame: wind-up peak, eyes screwed shut, follow-through, rest. */
const SLAP_WINDUP_PEAK = BUCKET_BOY_SLAP_IMPACT_FRAME - 2;
const SLAP_EYES_SHUT = BUCKET_BOY_SLAP_IMPACT_FRAME - 1;
const SLAP_FOLLOW_THROUGH = BUCKET_BOY_SLAP_IMPACT_FRAME + 1;
const SLAP_LAST = BUCKET_BOY_SLAP_FRAMES - 1;

function bucketBoySlap(view: CrocView, frame: number): CrocPose {
  const build = BUCKET_BOY_BUILD;
  const t = frame;
  const impact = BUCKET_BOY_SLAP_IMPACT_FRAME;
  const pose = restingPose(build);
  pose.bucket = {
    kind: 'hang',
    swing: keyed(t, [
      [0, 0],
      [SLAP_WINDUP_PEAK, deg(-6)],
      [impact, deg(10)],
      [SLAP_LAST, 0],
    ]),
  };
  pose.blink = keyed(t, [
    [0, 0],
    [SLAP_WINDUP_PEAK, 0],
    [SLAP_EYES_SHUT, 1],
    [impact + 1, 1],
    [SLAP_LAST, 0],
  ]);
  pose.jaw = keyed(t, [
    [0, 0],
    [impact, 0.25],
    [SLAP_LAST, 0],
  ]);
  const windup = keyedSmooth(t, [
    [0, 0],
    [SLAP_WINDUP_PEAK, 1],
    [impact, 0],
    [SLAP_LAST, 0],
  ]);
  const strike = keyedSmooth(t, [
    [0, 0],
    [SLAP_WINDUP_PEAK, 0],
    [impact, 1],
    [SLAP_FOLLOW_THROUGH, 0.9],
    [SLAP_LAST, 0],
  ]);
  pose.lean += windup * deg(-6) + strike * SLAP_LUNGE_LEAN;
  pose.headPitch = windup * deg(-6) + strike * deg(8);
  pose.smear = keyed(t, [
    [0, 0],
    [impact - 1, 0],
    [impact, 1],
    [impact + 1, 0.35],
    [impact + 2, 0],
    [SLAP_LAST, 0],
  ]);

  const reach = build.upperArm + build.forearm;
  if (isProfile(view)) {
    // A lunge: the near foot steps in and the body pitches after the hand,
    // so the palm lands a forearm past the end of his own snout.
    pose.near = { ...pose.near, ball: pt(pose.near.ball.x + strike * SLAP_LUNGE_STEP, 0) };
    pose.bob = strike * SLAP_LUNGE_DROP;
    const shoulders = shoulderJoints(build, pose, view);
    const back = pt(shoulders.far.x - 0.12, shoulders.far.y - 0.12);
    // Swung low, under the jaw: at head height the palm is lost against his own snout.
    const front = pt(shoulders.far.x + reach, shoulders.far.y + SLAP_STRIKE_DROP);
    const rest = pt(shoulders.far.x - 0.02, shoulders.far.y + reach * SWING_REACH_SHARE);
    const hand = blend3(rest, back, front, windup, strike);
    pose.farArm = armAt(
      hand,
      strike > HALFWAY ? ELBOW_BACK : -ELBOW_BACK,
      0,
      strike > 0.2 ? deg(-70) : null,
    );
    // The swipe came down from over his shoulder: the smear trails up and back.
    pose.smearSweep = -SLAP_SMEAR_SWEEP;
    return pose;
  }
  const shoulders = shoulderJoints(build, pose, view);
  const away = view === 'away';
  pose.roll = windup * deg(5) - strike * deg(6);
  // Head-on the swat is a flat swing across the body at head height: out to
  // his own side, then across in front of his chest.
  const back = pt(shoulders.far.x - 0.2, shoulders.far.y + 0.02);
  const front = pt(shoulders.near.x + 0.04, shoulders.far.y + 0.06);
  const rest = pt(shoulders.far.x - 0.03, shoulders.far.y + reach * SWING_REACH_SHARE);
  const hand = blend3(rest, back, front, windup, strike);
  pose.farArm = armAt(
    hand,
    facingElbowFor(FAR_SIDE, shoulders.far.y, hand.y),
    0,
    strike > 0.2 ? deg(-60) : null,
    false,
  );
  // It came across from his far side: the smear trails back out that way.
  pose.smearSweep = SLAP_SMEAR_SWEEP;
  pose.nearArm = armByAngles(facingArmAngles(NEAR_SIDE, 0, FACING_SWING_MIDPOINT, 1), 1, away);
  const feet = facingRestFeet(build);
  pose.near = feet.near;
  pose.far = feet.far;
  return pose;
}

function blend3(rest: Pt, back: Pt, front: Pt, windup: number, strike: number): Pt {
  const settled = 1 - clamp01(windup + strike);
  return pt(
    rest.x * settled + back.x * windup + front.x * strike,
    rest.y * settled + back.y * windup + front.y * strike,
  );
}

// ── Bucket Boy: Triage ───────────────────────────────────────────────────────

/** Where he sets the pail down: a short step in front of him. */
const TRIAGE_BUCKET_FORWARD = 0.2;
const TRIAGE_BUCKET_FACING_X = 0.13;
const TRIAGE_BUCKET_FACING_Y = 0.035;
/** Frames: squat and set down, let go, raise the hands, the heal, squat and pick up. */
const TRIAGE_SET_DOWN = 2;
const TRIAGE_PICK_UP = 12;
const TRIAGE_SQUAT = 0.13;
const TRIAGE_SQUAT_LEAN = deg(30);
const TRIAGE_WATCH_LIFT = deg(22);
/** Head-on, the squat splays the knees rather than shrinking the legs. */
const TRIAGE_KNEE_SPLAY = 0.6;
/** Head-on the glowing hands are held apart, one either side of his chest, so the glow reads as two hands and not a lamp on his shirt. */
const TRIAGE_FACING_HAND_SPREAD = 0.07;
/** Held out in front of the belly: head-on, hands pushed at the camera draw low on the body, not at the shoulder. */
const TRIAGE_FACING_HAND_DROP = 0.22;

function bucketBoyTriage(view: CrocView, frame: number): CrocPose {
  const build = BUCKET_BOY_BUILD;
  const release = BUCKET_BOY_TRIAGE_RELEASE_FRAME;
  const last = BUCKET_BOY_TRIAGE_FRAMES - 1;
  const pose = restingPose(build);
  const squat = keyedSmooth(frame, [
    [0, 0.15],
    [TRIAGE_SET_DOWN, 1],
    [TRIAGE_SET_DOWN + 2, 0.15],
    [release, 0],
    [release + 2, 0.2],
    [TRIAGE_PICK_UP, 1],
    [last, 0.1],
  ]);
  const raise = keyedSmooth(frame, [
    [0, 0],
    [TRIAGE_SET_DOWN + 1, 0],
    [release - 1, 0.8],
    [release, 1],
    [release + 1, 0.8],
    [release + 3, 0],
    [last, 0],
  ]);
  pose.glow = keyed(frame, [
    [0, 0],
    [TRIAGE_SET_DOWN + 1, 0],
    [release - 2, 0.55],
    [release, 1],
    [release + 2, 0.3],
    [release + 3, 0],
    [last, 0],
  ]);
  pose.bob = squat * TRIAGE_SQUAT;
  pose.lean += squat * TRIAGE_SQUAT_LEAN - raise * deg(4);
  // Picking the pail back up he keeps his eyes on the patient, not the floor.
  const watching = frame > release ? TRIAGE_WATCH_LIFT : 0;
  pose.headPitch = squat * deg(10) - raise * deg(10) - watching * squat;
  pose.blink = frame === release ? 0.5 : 0;
  pose.jaw = raise * 0.2;
  const profile = isProfile(view);
  const away = view === 'away';
  const feet = profile ? { near: pose.near, far: pose.far } : facingRestFeet(build);
  // A squat breaks the knees forward edge-on and splays them head-on.
  pose.near = {
    ...feet.near,
    foreshorten: profile ? 0 : 1 - squat * TRIAGE_KNEE_SPLAY,
    kneeBreak: profile ? 1 : NEAR_SIDE,
  };
  pose.far = {
    ...feet.far,
    foreshorten: profile ? 0 : 1 - squat * TRIAGE_KNEE_SPLAY,
    kneeBreak: profile ? 1 : FAR_SIDE,
  };

  const bucketCentre = profile
    ? pt(TRIAGE_BUCKET_FORWARD, -BUCKET_REST_HEIGHT)
    : pt(TRIAGE_BUCKET_FACING_X, TRIAGE_BUCKET_FACING_Y - BUCKET_REST_HEIGHT);
  const onFloor = frame > TRIAGE_SET_DOWN && frame < TRIAGE_PICK_UP;
  const bailTop = pt(bucketCentre.x, bucketCentre.y - BUCKET_BAIL_ABOVE_CENTRE);
  const shoulders = shoulderJoints(build, pose, view);

  // The bucket hand: carrying, reaching down to the floor, or free.
  const toFloor = keyedSmooth(frame, [
    [0, 0],
    [TRIAGE_SET_DOWN, 1],
    [TRIAGE_SET_DOWN + 1, 1],
    [TRIAGE_SET_DOWN + 2, 0],
    [release + 2, 0],
    [TRIAGE_PICK_UP - 1, 1],
    [TRIAGE_PICK_UP, 1],
    [last, 0],
  ]);
  const hangHand = pt(
    shoulders.near.x + (profile ? 0.03 : 0),
    shoulders.near.y + (build.upperArm + build.forearm) * HANG_REACH_SHARE,
  );
  const castHand = profile
    ? pt(shoulders.near.x + 0.26 + raise * 0.05, shoulders.near.y + 0.08 - raise * 0.04)
    : pt(TRIAGE_FACING_HAND_SPREAD, shoulders.near.y + TRIAGE_FACING_HAND_DROP - raise * 0.06);
  const carrying = !onFloor;
  const nearHandBase = carrying ? hangHand : castHand;
  const nearHand = lerpPt(nearHandBase, bailTop, toFloor);
  const castShare = carrying ? 0 : clamp01(raise * 1.4);
  const nearTarget = lerpPt(nearHand, castHand, castShare);
  pose.nearArm = armAt(
    nearTarget,
    profile ? ELBOW_BACK : facingElbow(NEAR_SIDE),
    carrying ? 1 : CAST_HAND_CURL,
    carrying ? null : profile ? deg(-70) : deg(-95),
    false,
  );
  pose.bucket = onFloor
    ? { kind: 'placed', centre: bucketCentre, tilt: 0, inverted: false, front: !profile }
    : { kind: 'hang', swing: 0 };

  const farCast = profile
    ? pt(shoulders.far.x + 0.24 + raise * 0.05, shoulders.far.y + 0.12 - raise * 0.04)
    : pt(-TRIAGE_FACING_HAND_SPREAD, shoulders.far.y + TRIAGE_FACING_HAND_DROP - raise * 0.06);
  const farRest = pt(
    shoulders.far.x - (profile ? 0.02 : 0.03),
    shoulders.far.y + (build.upperArm + build.forearm) * HANG_REACH_SHARE,
  );
  const farShare = clamp01(onFloor ? 0.35 + raise : squat * 0.3);
  pose.farArm = armAt(
    lerpPt(farRest, farCast, farShare),
    profile ? ELBOW_BACK : facingElbow(FAR_SIDE),
    lerp(HALFWAY, CAST_HAND_CURL, farShare),
    farShare > HALFWAY ? (profile ? deg(-70) : deg(-85)) : null,
    away,
  );
  if (away) pose.nearArm = { ...pose.nearArm, behind: false };
  return pose;
}

/** The bail's top, above the bucket's centre, where a hand picks it up. */
const BUCKET_BAIL_ABOVE_CENTRE = 0.14;

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
}

// ── Bucket Boy: cower ────────────────────────────────────────────────────────

const COWER_CROUCH = 0.1;
const COWER_LEAN = deg(20);
const COWER_SHIVER = 0.006;
const COWER_JAW = 1;
const COWER_KNEE_PINCH = 0.55;
/**
 * An eighth of a frame off the cycle's zero. A sine sampled six times from zero
 * lands on mirrored pairs — frames 1 and 2 paint the same picture — and this
 * offset is the smallest that makes all six samples distinct.
 */
const COWER_SHIVER_OFFSET = 1 / 24;
/**
 * How far down the skull the upturned pail sits, in head heights above the
 * skull's centre. Low enough to cover the crown and the eyes like a helmet;
 * held any higher it reads as something he is showing off rather than hiding in.
 */
const COWER_BUCKET_RISE = 0.6;
/** Head-on it rides higher, so the shrieking jaw and the eyes show under it. */
const COWER_BUCKET_RISE_FACING = 0.55;
/** The hands grip the pail's sides, just outside its rim. */
const COWER_GRIP_OUT = 0.07;
const COWER_GRIP_DROP = 0.02;

/**
 * The shriek: knees together, crouched, the upturned pail jammed down over his
 * head like a helmet and held there with both hands, jaw wide, tail wrapped
 * round his feet.
 */
function bucketBoyCower(view: CrocView, phase: number): CrocPose {
  const build = BUCKET_BOY_BUILD;
  const pose = restingPose(build);
  const shiver = wave(phase + COWER_SHIVER_OFFSET);
  // The shudder's second axis runs a quarter-cycle behind the first; folding
  // the first with an absolute value would double its rate and alias it.
  const shudder = Math.cos((phase + COWER_SHIVER_OFFSET) * Math.PI * 2);
  pose.bob = COWER_CROUCH + (1 + shudder) * COWER_SHIVER * 0.25;
  pose.lean += COWER_LEAN;
  pose.jaw = COWER_JAW - (1 + shudder) * 0.05;
  pose.blink = 1;
  pose.headPitch = deg(-18);
  pose.tailCurl = deg(40);
  pose.tailSwing = deg(-12) + shiver * deg(3);
  const profile = isProfile(view);
  if (!profile) {
    const feet = facingRestFeet(build);
    // Knock-kneed: the knees pinch in, which is what fear looks like head-on.
    pose.near = { ...feet.near, kneeBreak: FAR_SIDE, foreshorten: COWER_KNEE_PINCH };
    pose.far = { ...feet.far, kneeBreak: NEAR_SIDE, foreshorten: COWER_KNEE_PINCH };
    pose.sway = shiver * COWER_SHIVER;
  }
  const head = skeletonLandmarks(build, pose, view).headCentre;
  const rise = profile ? COWER_BUCKET_RISE : COWER_BUCKET_RISE_FACING;
  const bucket = pt(head.x + shiver * COWER_SHIVER, head.y - build.headHeight * rise);
  pose.bucket = {
    kind: 'placed',
    centre: bucket,
    tilt: shiver * deg(3),
    inverted: true,
    front: true,
  };
  const gripY = bucket.y + COWER_GRIP_DROP;
  if (profile) {
    pose.nearArm = armAt(pt(bucket.x, gripY), ELBOW_BACK, 1, deg(-90));
    pose.farArm = armAt(pt(bucket.x - COWER_GRIP_OUT * 0.5, gripY), ELBOW_BACK, 1, deg(-90));
  } else {
    pose.nearArm = armAt(
      pt(bucket.x + COWER_GRIP_OUT, gripY),
      facingElbowFor(NEAR_SIDE, 0, -1),
      1,
      deg(-70),
    );
    pose.farArm = armAt(
      pt(bucket.x - COWER_GRIP_OUT, gripY),
      facingElbowFor(FAR_SIDE, 0, -1),
      1,
      deg(-110),
    );
  }
  return pose;
}

// ── Bucket Boy: hurt ─────────────────────────────────────────────────────────

/** The flinch, sharpest on the first frame so the hit reads the tick it lands. */
const HURT_KEYS: readonly number[] = [0.9, 1, 0.5, 0.15];
/** The eyes squeeze shut through the sharp part of the flinch. */
const HURT_EYES_SHUT_ABOVE = 0.4;

function hurtAmount(frame: number): number {
  return HURT_KEYS[Math.min(HURT_KEYS.length - 1, frame)];
}

function bucketBoyHurt(view: CrocView, frame: number): CrocPose {
  const build = BUCKET_BOY_BUILD;
  const amount = hurtAmount(frame);
  const pose = restingPose(build);
  pose.lean += amount * deg(-12);
  pose.headPitch = amount * deg(-22);
  pose.blink = amount > HURT_EYES_SHUT_ABOVE ? 1 : 0;
  pose.jaw = amount * 0.55;
  pose.bob = amount * 0.02;
  pose.tailSwing = amount * deg(8);
  pose.bucket = { kind: 'hang', swing: amount * deg(14) };
  const shoulders = shoulderJoints(build, pose, view);
  if (isProfile(view)) {
    pose.farArm = armAt(
      pt(shoulders.far.x + 0.1, shoulders.far.y + 0.12),
      ELBOW_BACK,
      FLINCH_HAND_CURL,
    );
    pose.nearArm = armAt(
      pt(shoulders.near.x + 0.02 + amount * 0.06, shoulders.near.y + 0.3 - amount * 0.08),
      ELBOW_BACK,
      1,
    );
    return pose;
  }
  const feet = facingRestFeet(build);
  pose.near = feet.near;
  pose.far = feet.far;
  pose.roll = amount * deg(-7);
  pose.sway = amount * -0.02;
  const away = view === 'away';
  pose.farArm = armAt(
    pt(shoulders.far.x + 0.1 * amount, shoulders.far.y + 0.26 - amount * 0.1),
    facingElbow(FAR_SIDE),
    FLINCH_HAND_CURL,
    null,
    away,
  );
  pose.nearArm = armByAngles(
    facingArmAngles(NEAR_SIDE, amount * 0.6, FACING_SWING_MIDPOINT, 1),
    1,
    away,
  );
  return pose;
}

// ── Bucket Boy: death ────────────────────────────────────────────────────────

const DEATH_LAST = BUCKET_BOY_DEATH_FRAMES - 1;
/** He hits the floor two frames before the end, rebounds a touch, and settles on the last. */
const DEATH_LANDS = DEATH_LAST - 2;
const DEATH_REBOUND = DEATH_LAST - 1;
/** Frames: the hit, the buckle, the fall, the corpse. */
const DEATH_BUCKLE_END = 3;
const DEATH_LET_GO = 2;
/** The corpse lies on its back edge-on, on its side head-on, raised by its own half-thickness. */
const DEATH_LIFT_PROFILE = 0.045;
const DEATH_LIFT_FACING = 0.1;
/** The pail bounces off and rolls clear. */
const DEATH_BUCKET_ROLL = 0.14;
/** The pail hits the floor and hops once, on this frame, by this much. */
const DEATH_BUCKET_BOUNCE_FRAME = DEATH_LET_GO + 3;
const DEATH_BUCKET_BOUNCE = 0.03;
const DEATH_HEAD_LOLL = deg(78);
/** The head goes limp ahead of the body's fall, so it never points straight up on the way down. */
const DEATH_LOLL_LEAD = 1.5;
const DEATH_FRONT_HEAD_TURN = deg(32);
const DEATH_AWAY_HEAD_TURN = deg(-56);

function bucketBoyDeath(view: CrocView, frame: number): CrocPose {
  const build = BUCKET_BOY_BUILD;
  const pose = restingPose(build);
  const profile = isProfile(view);
  const hit = keyed(frame, [
    [0, 1],
    [DEATH_LET_GO, 0.6],
    [DEATH_BUCKLE_END, 0.2],
    [DEATH_LAST, 0],
  ]);
  // The knees buckle, then straighten as he lands flat.
  const buckle = keyedSmooth(frame, [
    [0, 0],
    [DEATH_BUCKLE_END, 1],
    [DEATH_LANDS - 1, 0.7],
    [DEATH_LAST, 0.2],
  ]);

  const fall = keyed(frame, [
    [0, 0],
    [DEATH_BUCKLE_END, 0],
    [DEATH_LANDS, 1],
    [DEATH_REBOUND, 0.94],
    [DEATH_LAST, 1],
  ]);
  const fallEase = clamp01(fall) < 1 ? easeInSquare(fall) : fall;
  pose.lean += hit * deg(-10) + buckle * deg(-8);
  pose.headPitch = hit * deg(-24) + buckle * deg(10);
  // The head lolls back as he goes over, until the snout lies along the floor
  // past the crown: a snout left pointing at the ceiling reads as a box.
  pose.headRoll = -clamp01(fall * DEATH_LOLL_LEAD) * DEATH_HEAD_LOLL;
  pose.jaw = keyed(frame, [
    [0, 0.7],
    [DEATH_BUCKLE_END, 0.4],
    [DEATH_LAST, 0.25],
  ]);
  pose.blink = frame >= 1 ? 1 : 0.6;
  pose.bob = buckle * 0.09;
  pose.topple = -HALF_TURN_OVER * fallEase;
  pose.toppleLift = (profile ? DEATH_LIFT_PROFILE : DEATH_LIFT_FACING) * fallEase;
  pose.toppleAt = pt(profile ? -0.05 : -0.06, 0);
  // Lying on his side head-on, his head rolls into profile on the floor; a
  // turned head seen lying down reads as a box.
  if (!profile)
    pose.headYaw = fallEase * (view === 'away' ? DEATH_AWAY_HEAD_TURN : DEATH_FRONT_HEAD_TURN);
  // Lying down, the tail runs on along the floor past the pelvis.
  pose.tailSwing = fallEase * (profile ? deg(-26) : deg(-20));
  // Straightened out along the floor rather than curling down through it.
  pose.tailCurl = fallEase * deg(-50);

  if (!profile) {
    const feet = facingRestFeet(build);
    pose.near = { ...feet.near, foreshorten: 1 - buckle * 0.5, kneeBreak: NEAR_SIDE };
    pose.far = { ...feet.far, foreshorten: 1 - buckle * 0.5, kneeBreak: FAR_SIDE };
    pose.roll = hit * deg(-6);
  }
  const shoulders = shoulderJoints(build, pose, view);
  const reach = (build.upperArm + build.forearm) * HANG_REACH_SHARE;
  const away = view === 'away';
  // Arms fly up at the hit and go limp through the fall.
  const flail = hit * (1 - fallEase);
  // Limp arms lie close along the body; flung wide they read as spikes.
  const limpFar = pt(shoulders.far.x - (profile ? 0.08 : 0.06), shoulders.far.y + reach * 0.9);
  const limpNear = pt(shoulders.near.x + (profile ? 0.08 : 0.06), shoulders.near.y + reach * 0.9);
  pose.farArm = armAt(
    lerpPt(limpFar, pt(shoulders.far.x + (profile ? 0.08 : -0.1), shoulders.far.y - 0.05), flail),
    profile ? ELBOW_BACK : facingElbow(FAR_SIDE),
    LIMP_HAND_CURL,
    null,
    away,
  );
  pose.nearArm = armAt(
    lerpPt(limpNear, pt(shoulders.near.x + 0.1, shoulders.near.y + 0.05), flail),
    profile ? ELBOW_BACK : facingElbow(NEAR_SIDE),
    frame < DEATH_LET_GO ? 1 : LIMP_HAND_CURL,
    null,
    away,
  );

  if (frame < DEATH_LET_GO) {
    pose.bucket = { kind: 'hang', swing: deg(18) * frame };
  } else {
    const hands = handPositionAtLetGo(view);
    const roll = keyed(frame, [
      [DEATH_LET_GO, 0],
      [DEATH_BUCKET_BOUNCE_FRAME, 0.7],
      [DEATH_LAST, 1],
    ]);
    const drop = easeOut(
      keyed(frame, [
        [DEATH_LET_GO, 0],
        [DEATH_BUCKET_BOUNCE_FRAME - 1, 1],
        [DEATH_LAST, 1],
      ]),
    );
    const restY = -BUCKET_LYING_HEIGHT;
    const x = lerp(hands.x, hands.x + DEATH_BUCKET_ROLL, roll);
    const bounce = frame === DEATH_BUCKET_BOUNCE_FRAME ? -DEATH_BUCKET_BOUNCE : 0;
    pose.bucket = {
      kind: 'placed',
      centre: pt(x, lerp(hands.y + BUCKET_HANG_BELOW_GRIP, restY, drop) + bounce),
      tilt: roll * deg(100),
      inverted: false,
      front: false,
    };
  }
  return pose;
}

const HALF_TURN_OVER = Math.PI / 2;
/** A pail lying on its side rests on its widest radius. */
const BUCKET_LYING_HEIGHT = 0.072;
/** From a carrying fist to the pail's centre: bail, then half the pail. */
const BUCKET_HANG_BELOW_GRIP = 0.14;

function easeInSquare(t: number): number {
  const c = clamp01(t);
  return c * c;
}

/** Where the near hand is on the frame he lets go of the pail, so it falls from there. */
function handPositionAtLetGo(view: CrocView): Pt {
  const pose = bucketBoyDeath(view, DEATH_LET_GO - 1);
  return skeletonLandmarks(BUCKET_BOY_BUILD, pose, view).nearHand;
}

// ── Clarabelle ───────────────────────────────────────────────────────────────

const CLARA_BREATH_RISE = 0.01;
const CROSSED_ARMS_DROP = 0.4;
const CROSSED_HAND_REACH = 0.12;
const CLARA_IDLE_ROLL = deg(1.2);
const CLARA_BLINK_AT = 0.625;
const CLARA_BLINK_WIDTH = 0.13;
const CLARA_TAIL_SWING = deg(4);

/**
 * Arms folded across the chest: the far forearm under, the near one over it,
 * each hand tucked against the opposite upper arm.
 */
function crossedArms(
  build: CrocBuild,
  pose: CrocPose,
  view: CrocView,
): { near: CrocArmPose; far: CrocArmPose } {
  const marks = skeletonLandmarks(build, pose, view);
  // Folded low across the chest, not tucked under the chin, where the
  // forearms read as shoulder pads.
  const chest = lerpPt(marks.chest, marks.waist, CROSSED_ARMS_DROP);
  if (isProfile(view)) {
    const front = build.profileTorso.chestLead;
    return {
      near: armAt(
        pt(chest.x + front * 1.05, chest.y + 0.04),
        ELBOW_BACK,
        FOLDED_HAND_CURL,
        deg(-5),
      ),
      far: armAt(pt(chest.x + front * 0.95, chest.y + 0.0), ELBOW_BACK, FOLDED_HAND_CURL, deg(-5)),
    };
  }
  const span = build.facingTorso.chestLead;
  return {
    // A forearm is not as long as the shoulders are wide: folded, each hand
    // only just crosses the midline, and the elbows stay out at the sides.
    near: armAt(
      pt(chest.x - span * CROSSED_HAND_REACH, chest.y + 0.08),
      facingElbow(NEAR_SIDE),
      FOLDED_HAND_CURL,
      deg(185),
    ),
    far: armAt(
      pt(chest.x + span * CROSSED_HAND_REACH, chest.y + 0.03),
      facingElbow(FAR_SIDE),
      FOLDED_HAND_CURL,
      deg(-5),
    ),
  };
}

function clarabelleIdle(view: CrocView, phase: number): CrocPose {
  const build = CLARABELLE_BUILD;
  const pose = restingPose(build);
  const breath = wave(phase);
  pose.breath = breath;
  pose.bob = CLARA_BREATH_RISE * (1 + breath) * HUMP_PEAK;
  pose.blink = pulseAt(phase, CLARA_BLINK_AT, CLARA_BLINK_WIDTH);
  pose.tailSwing = wave(phase - 0.2) * CLARA_TAIL_SWING;
  pose.headPitch += breath * deg(1.5);
  if (!isProfile(view)) {
    const feet = facingRestFeet(build);
    pose.near = feet.near;
    pose.far = feet.far;
    pose.roll = wave(phase) * CLARA_IDLE_ROLL;
    // A bored half-turn of the head, back and forth, never through square.
    pose.headYaw = wave(phase + 0.25) * deg(6);
  }
  const arms = crossedArms(build, pose, view);
  pose.nearArm = arms.near;
  pose.farArm = arms.far;
  return pose;
}

function clarabelleWalk(view: CrocView, phase: number): CrocPose {
  return walkPose(CLARABELLE_BUILD, CLARABELLE_WALK, view, phase, false);
}

/**
 * Arms crossed, then the near hand comes out palm-first — "pay up" — and goes
 * back. The jaw works twice while the hand is out.
 */
/** How long her arms take to uncross into the palm, and how long the palm is held out. */
const TALK_UNCROSS_FRAMES = 3;
const TALK_PALM_HOLD_FRAMES = 3;

function clarabelleTalk(view: CrocView, frame: number): CrocPose {
  const build = CLARABELLE_BUILD;
  const palm = CLARABELLE_TALK_PALM_FRAME;
  const frames = CLARABELLE_TALK_FRAMES;
  const pose = restingPose(build);
  const out = keyedSmooth(frame, [
    [0, 0],
    [palm - TALK_UNCROSS_FRAMES, 0],
    [palm, 1],
    [palm + TALK_PALM_HOLD_FRAMES, 1],
    [frames - 1, 0.1],
  ]);
  const phase = frame / frames;
  pose.jaw = clamp01(Math.sin(phase * Math.PI * 4)) * 0.35 * clamp01(out * 1.5);
  pose.headPitch += -out * deg(5);
  pose.breath = wave(phase);
  pose.tailSwing = wave(phase) * CLARA_TAIL_SWING;
  const profile = isProfile(view);
  if (!profile) {
    const feet = facingRestFeet(build);
    pose.near = feet.near;
    pose.far = feet.far;
    pose.roll = out * deg(2.5);
    pose.headYaw = out * deg(-8);
  }
  const arms = crossedArms(build, pose, view);
  const shoulders = shoulderJoints(build, pose, view);
  // Elbow at the chest, forearm up, the palm turned to whoever is at the door.
  const palmOut = profile
    ? armAt(pt(shoulders.near.x + 0.4, shoulders.near.y + 0.16), ELBOW_BACK, 0, deg(-80))
    : armAt(pt(shoulders.near.x + 0.16, shoulders.near.y + 0.04), ELBOW_BACK, 0, deg(-92));
  pose.nearArm = {
    ...palmOut,
    hand: lerpPt(arms.near.hand, palmOut.hand, out),
    curl: lerp(arms.near.curl, 0, out),
    handAngle: out > HALFWAY ? palmOut.handAngle : arms.near.handAngle,
    palmOut: out > HALFWAY,
  };
  pose.farArm = arms.far;
  return pose;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: CrocView;
  /** Loops wrap; one-shots play first frame to last. */
  readonly loops: boolean;
  /** Travelling rows cover ground, which the foot-slide gate checks. */
  readonly gait: Gait | null;
  readonly pose: (frame: number) => CrocPose;
}

const VIEWS: readonly CrocView[] = ['front', 'side', 'away'];

function viewSuffix(view: CrocView): string {
  if (view === 'side') return '_side';
  if (view === 'away') return '_away';
  return '';
}

/** The state name of a row in a view: the runtime composes names the same way. */
export function crocStateName(base: string, view: CrocView): string {
  return `${base}${viewSuffix(view)}`;
}

interface RowTemplate {
  readonly base: string;
  readonly frameCount: number;
  readonly loops: boolean;
  readonly gait: Gait | null;
  readonly pose: (view: CrocView, frameOrPhase: number) => CrocPose;
  /** Loops take a cycle phase; one-shots take the frame index itself. */
  readonly byFrame: boolean;
}

function expand(templates: readonly RowTemplate[]): RowSpec[] {
  return templates.flatMap((template) =>
    VIEWS.map((view) => ({
      name: crocStateName(template.base, view),
      frameCount: template.frameCount,
      view,
      loops: template.loops,
      gait: template.gait,
      pose: (frame: number) =>
        template.pose(view, template.byFrame ? frame : cyclePhase(frame, template.frameCount)),
    })),
  );
}

export const BUCKET_BOY_ROWS: readonly RowSpec[] = expand([
  {
    base: 'idle',
    frameCount: BUCKET_BOY_IDLE_FRAMES,
    loops: true,
    gait: null,
    pose: bucketBoyIdle,
    byFrame: false,
  },
  {
    base: 'walk',
    frameCount: BUCKET_BOY_WALK_FRAMES,
    loops: true,
    gait: BUCKET_BOY_WALK,
    pose: bucketBoyWalk,
    byFrame: false,
  },
  {
    base: 'flee',
    frameCount: BUCKET_BOY_FLEE_FRAMES,
    loops: true,
    gait: BUCKET_BOY_FLEE,
    pose: bucketBoyFlee,
    byFrame: false,
  },
  {
    base: 'slap',
    frameCount: BUCKET_BOY_SLAP_FRAMES,
    loops: false,
    gait: null,
    pose: bucketBoySlap,
    byFrame: true,
  },
  {
    base: 'cast_triage',
    frameCount: BUCKET_BOY_TRIAGE_FRAMES,
    loops: false,
    gait: null,
    pose: bucketBoyTriage,
    byFrame: true,
  },
  {
    base: 'cower',
    frameCount: BUCKET_BOY_COWER_FRAMES,
    loops: true,
    gait: null,
    pose: bucketBoyCower,
    byFrame: false,
  },
  {
    base: 'hurt',
    frameCount: BUCKET_BOY_HURT_FRAMES,
    loops: false,
    gait: null,
    pose: bucketBoyHurt,
    byFrame: true,
  },
  {
    base: 'death',
    frameCount: BUCKET_BOY_DEATH_FRAMES,
    loops: false,
    gait: null,
    pose: bucketBoyDeath,
    byFrame: true,
  },
]);

export const CLARABELLE_ROWS: readonly RowSpec[] = expand([
  {
    base: 'idle',
    frameCount: CLARABELLE_IDLE_FRAMES,
    loops: true,
    gait: null,
    pose: clarabelleIdle,
    byFrame: false,
  },
  {
    base: 'walk',
    frameCount: CLARABELLE_WALK_FRAMES,
    loops: true,
    gait: CLARABELLE_WALK,
    pose: clarabelleWalk,
    byFrame: false,
  },
  {
    base: 'talk',
    frameCount: CLARABELLE_TALK_FRAMES,
    loops: true,
    gait: null,
    pose: clarabelleTalk,
    byFrame: true,
  },
]);

/** Tiles covered per walk cycle, for a kit pacing the walk phase by ground covered. */
export const BUCKET_BOY_TILES_PER_WALK_CYCLE = tilesPerCycle(BUCKET_BOY_BUILD, BUCKET_BOY_WALK);
export const BUCKET_BOY_TILES_PER_FLEE_CYCLE = tilesPerCycle(BUCKET_BOY_BUILD, BUCKET_BOY_FLEE);
export const CLARABELLE_TILES_PER_WALK_CYCLE = tilesPerCycle(CLARABELLE_BUILD, CLARABELLE_WALK);

// ── Painting ─────────────────────────────────────────────────────────────────

function rowTable(rows: readonly RowSpec[]): ReadonlyMap<string, RowSpec> {
  return new Map(rows.map((row) => [row.name, row]));
}

function stateFrames(rows: readonly RowSpec[]): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  return frames;
}

function crocPainter(build: CrocBuild, rows: readonly RowSpec[], cell: CrocCell) {
  const table = rowTable(rows);
  const origin = originOf(cell);
  return (ctx: CanvasRenderingContext2D, state: string, frame: number): void => {
    const row = table.get(state);
    if (row === undefined) return;
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(TILE_SCALE, TILE_SCALE);
    drawCrocodilian(ctx, build, row.view, row.pose(frame));
    ctx.restore();
  };
}

export const BUCKET_BOY_FIGURE: FigureDef = {
  id: 'crocodilian_bucket_boy',
  ...BUCKET_BOY_CELL,
  tileScale: TILE_SCALE,
  states: figureStates(stateFrames(BUCKET_BOY_ROWS)),
  paintFrame: crocPainter(BUCKET_BOY_BUILD, BUCKET_BOY_ROWS, BUCKET_BOY_CELL),
};

export const CLARABELLE_FIGURE: FigureDef = {
  id: 'crocodilian_clarabelle',
  ...CLARABELLE_CELL,
  tileScale: TILE_SCALE,
  states: figureStates(stateFrames(CLARABELLE_ROWS)),
  paintFrame: crocPainter(CLARABELLE_BUILD, CLARABELLE_ROWS, CLARABELLE_CELL),
};

export const TRIAGE_SPARKLE_STATE = 'sparkle';

export const TRIAGE_SPARKLE_FIGURE: FigureDef = {
  id: 'triage_sparkle',
  ...TRIAGE_SPARKLE_CELL,
  tileScale: TILE_SCALE,
  states: figureStates({ [TRIAGE_SPARKLE_STATE]: TRIAGE_SPARKLE_FRAMES }),
  paintFrame: (ctx, state, frame) => {
    if (state !== TRIAGE_SPARKLE_STATE) return;
    const origin = originOf(TRIAGE_SPARKLE_CELL);
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(TILE_SCALE, TILE_SCALE);
    drawTriageSparkle(ctx, shotT(frame, TRIAGE_SPARKLE_FRAMES));
    ctx.restore();
  },
};

/** Every pose a figure's rows are built from, in row-then-frame order. */
export function poseStream(
  rows: readonly RowSpec[],
): { row: RowSpec; frame: number; pose: CrocPose }[] {
  return rows.flatMap((row) =>
    Array.from({ length: row.frameCount }, (_unused, frame) => ({
      row,
      frame,
      pose: row.pose(frame),
    })),
  );
}

export { BUCKET_BOY_WALK, BUCKET_BOY_FLEE, CLARABELLE_WALK, type Gait };
