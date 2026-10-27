/**
 * The Crocodilians as painted figures: the choreography, the cell geometry and
 * the `FigureDef`s the runtime cache and the review harness draw through —
 * the janitor and Sydney.
 *
 * This module is choreography and nothing else: one pose function per row and
 * the row tables. Anatomy, palette and every stroke of paint live in
 * `crocodilianArt.ts`.
 *
 * The janitor's rows, each in three views (`<row>`, `<row>_side`, `<row>_away`):
 *    idle, walk_mop, mop, wring
 * Sydney's rows, likewise:
 *    idle, walk, talk
 *
 * The art invariants live in `scripts/gates-crocodilian.ts`, which the review
 * harness runs: `npm run render:crocodilian`.
 */

import { clamp01, deg, easeInOut, hump, lerp, type Pt } from './bipedArt';
import {
  BUCKET_REST_HEIGHT,
  JANITOR_BUILD,
  MOP_GRIP_TOP_MARGIN,
  MOP_HANDLE_LENGTH,
  SYDNEY_BUILD,
  type MopPose,
  type ArmAngles,
  type CrocArmPose,
  type CrocBuild,
  type CrocFootPose,
  type CrocPose,
  type CrocView,
  drawCrocodilian,
  ankleUnderHip,
  facingRestFeet,
  groundPointFor,
  mopSocketFor,
  restingPose,
  shoulderJoints,
  skeletonLandmarks,
  wristForGrip,
} from './crocodilianArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  JANITOR_IDLE_FRAMES,
  JANITOR_MOP_FRAMES,
  JANITOR_WALK_MOP_FRAMES,
  JANITOR_WRING_DUNK_FRAME,
  JANITOR_WRING_FRAMES,
  SYDNEY_IDLE_FRAMES,
  SYDNEY_TALK_FRAMES,
  SYDNEY_TALK_PALM_FRAME,
  SYDNEY_WALK_FRAMES,
} from '../crocodilianTiming';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** The ground line's row within the tile, matched to the human crawler's so they stand on one floor. */
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
 * The janitor's cell is wide rather than tall: he is short, but his tail drags
 * half a tile behind him and his mop's strands reach well out in front.
 */
export const JANITOR_CELL: CrocCell = {
  frameWidth: 192,
  frameHeight: 112,
  tileX: 64,
  tileY: 36,
};

export const SYDNEY_CELL: CrocCell = {
  frameWidth: 192,
  frameHeight: 184,
  tileX: 64,
  tileY: 104,
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
/** How tightly a folded arm's hand is closed, 0 open to 1 fist. */
const FOLDED_HAND_CURL = 0.85;

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

const SYDNEY_WALK: Gait = {
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

// ── The janitor: the mop in hand ─────────────────────────────────────────────

/** Where on the floor the mop and the pail are, in the body's ground frame: across toward his left, and ahead. */
interface GroundSpot {
  readonly lateral: number;
  readonly forward: number;
}

/**
 * The mop standing at his right side while he waits, its strands on the floor
 * by his right foot. Edge-on it stands further out ahead of him, so his body
 * leaning over it to set the pail down or pick it up does not hide it.
 */
const MOP_AT_REST: Readonly<Record<CrocView, GroundSpot>> = {
  front: { lateral: -0.2, forward: 0.3 },
  side: { lateral: -0.2, forward: 0.42 },
  away: { lateral: -0.2, forward: 0.3 },
};

/** A mop lying still on its strands: no drag, no splay, no twist, dry of drips. */
function restingMop(spot: GroundSpot): MopPose {
  return {
    lateral: spot.lateral,
    forward: spot.forward,
    lift: 0,
    twoHanded: false,
    dragLateral: 0,
    dragForward: 0,
    splay: 0,
    twist: 0,
    drip: 0,
    dripPhase: 0,
    inPail: false,
  };
}

/**
 * A fist closed across the handle: the knuckles point square off it, out from
 * the body on whichever side `outward` names, so the fingers wrap the wood.
 */
function gripAngle(socket: Pt, grip: Pt, outward: number): number {
  const handle = Math.atan2(grip.y - socket.y, grip.x - socket.x);
  const square = handle + HALF_TURN_SQUARE;
  return Math.cos(square) * outward >= 0 ? square : square + Math.PI;
}

/** An arm whose fist closes on the mop handle at `grip`. */
function gripArm(
  build: CrocBuild,
  socket: Pt,
  grip: Pt,
  bend: number,
  outward: number,
  behind = false,
  turn = 0,
): CrocArmPose {
  const angle = gripAngle(socket, grip, outward) + turn;
  return armAt(wristForGrip(build, grip, angle), bend, 1, angle, behind);
}

/**
 * The point on the handle nearest a shoulder, where that arm can reach it:
 * anywhere from a little above the clamp to just under the handle's top,
 * below the far fist or above it.
 */
function nearestOnHandle(socket: Pt, grip: Pt, shoulder: Pt): Pt {
  const length = Math.hypot(grip.x - socket.x, grip.y - socket.y);
  if (length === 0) return grip;
  const ux = (grip.x - socket.x) / length;
  const uy = (grip.y - socket.y) / length;
  const along = (shoulder.x - socket.x) * ux + (shoulder.y - socket.y) * uy;
  const lowest = length * NEAR_GRIP_LOWEST_SHARE;
  const highest = MOP_HANDLE_LENGTH - MOP_GRIP_TOP_MARGIN - NEAR_GRIP_BELOW_TOP;
  const at = Math.min(highest, Math.max(lowest, along));
  return pt(socket.x + ux * at, socket.y + uy * at);
}

/** Head-on the knuckles of the right hand point in across the body; edge-on they point ahead. */
function outwardFor(view: CrocView): number {
  return isProfile(view) ? 1 : NEAR_SIDE;
}

/**
 * The far fist's grip relative to the far shoulder, per view. From behind, a
 * fist held out ahead of him is further off, so it sits higher in the picture
 * than the same grip head-on.
 */
type GripOffset = Readonly<Record<CrocView, Pt>>;

function farGripFor(build: CrocBuild, pose: CrocPose, view: CrocView, offset: GripOffset): Pt {
  const shoulder = shoulderJoints(build, pose, view).far;
  return pt(shoulder.x + offset[view].x, shoulder.y + offset[view].y);
}

/** Puts the mop in the far hand, gripped at `grip`. */
function holdMop(build: CrocBuild, pose: CrocPose, view: CrocView, mop: MopPose, grip: Pt): void {
  pose.mop = mop;
  // From behind, the tail would lie across the mop's side; it swings the other way.
  if (view === 'away') pose.tailSwing += AWAY_TAIL_CLEAR_OF_MOP;
  const socket = mopSocketFor(view, mop);
  pose.farArm = gripArm(
    build,
    socket,
    grip,
    isProfile(view) ? ELBOW_BACK : facingElbow(FAR_SIDE),
    outwardFor(view),
    view === 'away',
  );
}

const HALF_TURN_SQUARE = Math.PI / 2;
const AWAY_TAIL_CLEAR_OF_MOP = deg(-65);

// ── The janitor: idle ────────────────────────────────────────────────────────

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
const IDLE_ARM_DRIFT = 0.12;
const IDLE_ARM_SWING = deg(10);
const IDLE_FACING_ARM_DRIFT = 0.2;
const IDLE_HEEL_PEEL_SIDE = deg(10);
const IDLE_HEEL_PEEL_FACING = deg(12);
/** The resting grip: a bent arm holding the upright handle at his waist. */
const IDLE_GRIP: GripOffset = {
  front: pt(-0.075, 0.26),
  side: pt(0.08, 0.15),
  away: pt(-0.075, 0.18),
};
/** The fist rocks with his weight while the strands stay put, so the handle tips a little. */
const IDLE_GRIP_ROCK = 0.012;

function janitorIdle(view: CrocView, phase: number): CrocPose {
  const build = JANITOR_BUILD;
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
    const drift = shift * IDLE_ARM_DRIFT;
    pose.nearArm = armByAngles(sideArmAngles(drift, IDLE_ARM_SWING), 1);
    // Weight rocks between the feet: the unweighted heel peels a little.
    pose.near = { ...pose.near, heelLift: Math.max(0, -shift) * IDLE_HEEL_PEEL_SIDE };
    pose.far = { ...pose.far, heelLift: Math.max(0, shift) * IDLE_HEEL_PEEL_SIDE };
  } else {
    const feet = facingRestFeet(build);
    // Knees pinched a little toward each other: the timid stance.
    pose.near = {
      ...feet.near,
      heelLift: Math.max(0, -shift) * IDLE_HEEL_PEEL_FACING,
      kneeBreak: FAR_SIDE,
      foreshorten: IDLE_KNEE_PINCH,
    };
    pose.far = {
      ...feet.far,
      heelLift: Math.max(0, shift) * IDLE_HEEL_PEEL_FACING,
      kneeBreak: NEAR_SIDE,
      foreshorten: IDLE_KNEE_PINCH,
    };
    pose.sway = shift * IDLE_SWAY;
    pose.roll = -shift * IDLE_ROLL;
    pose.headYaw = glance * FACING_GLANCE_YAW;
    pose.nearArm = armByAngles(
      facingArmAngles(NEAR_SIDE, shift * IDLE_FACING_ARM_DRIFT, FACING_SWING_MIDPOINT, 1),
      1,
      view === 'away',
    );
  }
  const grip = farGripFor(build, pose, view, IDLE_GRIP);
  holdMop(
    build,
    pose,
    view,
    restingMop(MOP_AT_REST[view]),
    pt(grip.x + shift * IDLE_GRIP_ROCK, grip.y),
  );
  return pose;
}

// ── The janitor: walk_mop ────────────────────────────────────────────────────

/** Short, careful steps, leaning into the handle. */
const JANITOR_WALK_MOP: Gait = {
  strideShare: 0.26,
  stanceFraction: 0.6,
  liftShare: 0.16,
  dropShare: 0.04,
  toeOffLift: deg(24),
  lean: deg(9),
  armSwing: deg(22),
  swayShare: 0.18,
  crouchShare: 0.02,
};

/**
 * The strands slide ahead of him. Head-on they run in front of his middle, so
 * the handle slants down across him; from behind they run out past his right
 * leg, where they are not lost behind his body.
 */
const WALK_MOP_LATERAL: Readonly<Record<CrocView, number>> = {
  front: -0.06,
  side: -0.13,
  away: -0.22,
};
const WALK_MOP_FORWARD = 0.44;
/** Each step leans into the handle: the head surges ahead and eases back twice a cycle. */
const WALK_MOP_PUSH = 0.06;
/**
 * Head-on and from behind a push toward or away from the camera barely moves
 * in the picture, so the head swishes side to side with his steps as well.
 */
const WALK_MOP_SWISH = 0.06;
/** The fist follows the swish a little, steering the handle. */
const WALK_MOP_SWISH_HAND_SHARE = 0.4;
/** Pushed along the floor the strands trail back under the clamp. */
const WALK_MOP_DRAG = -0.035;
const WALK_MOP_SPLAY = 0.35;
/** The pushing grip: the arm reaching out and down to the handle ahead of him. */
const WALK_MOP_GRIP: GripOffset = {
  front: pt(-0.03, 0.27),
  side: pt(0.13, 0.17),
  away: pt(-0.03, 0.19),
};

function janitorWalkMop(view: CrocView, phase: number): CrocPose {
  const build = JANITOR_BUILD;
  const pose = walkPose(build, JANITOR_WALK_MOP, view, phase, true);
  const push = wave(phase * 2) * WALK_MOP_PUSH;
  const swish = isProfile(view) ? 0 : wave(phase) * WALK_MOP_SWISH;
  const mop: MopPose = {
    ...restingMop({ lateral: WALK_MOP_LATERAL[view] + swish, forward: WALK_MOP_FORWARD + push }),
    dragForward: WALK_MOP_DRAG,
    splay: WALK_MOP_SPLAY,
  };
  const grip = farGripFor(build, pose, view, WALK_MOP_GRIP);
  // The fist rides out with the push, along the line the handle runs.
  const pushed = groundPointFor(view, swish * WALK_MOP_SWISH_HAND_SHARE, push);
  holdMop(build, pose, view, mop, pt(grip.x + pushed.x, grip.y + pushed.y));
  return pose;
}

// ── The janitor: mop ─────────────────────────────────────────────────────────

/**
 * The stroke swings the strands round an arc in front of him, out to his right
 * and across to his left and back. The phase is the row's progress, so the
 * fastest point of each stroke — where its swish sounds — falls exactly at a
 * quarter and three quarters.
 */
const MOP_STROKE_SWING = deg(52);
const MOP_STROKE_RADIUS = 0.3;
/**
 * Where the stroke's arc is centred. From behind, strands swung across in
 * front of him are hidden by his body, so that view keeps the arc out past
 * his right leg, where it shows.
 */
const MOP_STROKE_CENTRE: Readonly<Record<CrocView, GroundSpot>> = {
  front: { lateral: -0.04, forward: 0.2 },
  side: { lateral: -0.04, forward: 0.1 },
  away: { lateral: -0.2, forward: 0.1 },
};
/** How far the strands trail behind the head at the stroke's fastest point. */
const MOP_STROKE_DRAG = 0.05;
/** At each end of a stroke the head eases off the floor a hair as he turns it. */
const MOP_STROKE_TURN_LIFT = 0.012;
const MOP_STROKE_GRIP: GripOffset = {
  front: pt(-0.04, 0.31),
  side: pt(0.1, 0.18),
  away: pt(-0.04, 0.19),
};
/** The fist swings the opposite way to the head, a lever about the hand. */
const MOP_STROKE_GRIP_COUNTER = 0.07;
const MOP_STROKE_ROLL = deg(4);
const MOP_STROKE_SWAY = 0.02;
const MOP_STROKE_HEAD_FOLLOW = deg(12);
const MOP_STROKE_LEAN = deg(6);
const MOP_STROKE_HEEL_PEEL = deg(9);

function janitorMop(view: CrocView, phase: number): CrocPose {
  const build = JANITOR_BUILD;
  const pose = restingPose(build);
  const across = -Math.cos(phase * Math.PI * 2);
  const speed = Math.sin(phase * Math.PI * 2);
  const angle = across * MOP_STROKE_SWING;
  pose.lean += MOP_STROKE_LEAN;
  pose.headPitch += MOP_STROKE_LEAN;
  pose.blink = pulseAt(phase, IDLE_BLINK_AT, IDLE_BLINK_WIDTH);
  pose.tailSwing = wave(phase - BUCKET_LAG) * IDLE_TAIL_SWING;
  pose.bucket = { kind: 'hang', swing: -wave(phase - BUCKET_LAG) * IDLE_BUCKET_SWING };
  pose.breath = wave(phase * 2);
  pose.headYaw = -across * MOP_STROKE_HEAD_FOLLOW * (isProfile(view) ? 0 : 1);

  if (isProfile(view)) {
    pose.nearArm = armByAngles(sideArmAngles(0, IDLE_ARM_SWING), 1);
  } else {
    const feet = facingRestFeet(build);
    // His weight follows the stroke: the heel on the far side of it lifts.
    pose.near = { ...feet.near, heelLift: Math.max(0, -across) * MOP_STROKE_HEEL_PEEL };
    pose.far = { ...feet.far, heelLift: Math.max(0, across) * MOP_STROKE_HEEL_PEEL };
    pose.roll = -across * MOP_STROKE_ROLL;
    pose.sway = across * MOP_STROKE_SWAY;
    pose.nearArm = armByAngles(
      facingArmAngles(NEAR_SIDE, 0, FACING_SWING_MIDPOINT, 1),
      1,
      view === 'away',
    );
  }
  const mop: MopPose = {
    ...restingMop({
      lateral: MOP_STROKE_CENTRE[view].lateral + Math.sin(angle) * MOP_STROKE_RADIUS,
      forward: MOP_STROKE_CENTRE[view].forward + Math.cos(angle) * MOP_STROKE_RADIUS,
    }),
    lift: (1 - Math.abs(speed)) * MOP_STROKE_TURN_LIFT,
    dragLateral: -speed * MOP_STROKE_DRAG,
    splay: Math.abs(speed),
  };
  const grip = farGripFor(build, pose, view, MOP_STROKE_GRIP);
  const counter = groundPointFor(view, -across * MOP_STROKE_GRIP_COUNTER, 0);
  holdMop(build, pose, view, mop, pt(grip.x + counter.x, grip.y + counter.y));
  return pose;
}

// ── The janitor: wring ───────────────────────────────────────────────────────

/** The pail goes down a short step ahead of him and to his left, clear of the mop at his right. */
/** From behind, the pail goes down further out to his left, so his body does not hide it and the mop going into it. */
const WRING_PAIL_SPOT: Readonly<Record<CrocView, GroundSpot>> = {
  front: { lateral: 0.1, forward: 0.24 },
  side: { lateral: 0.1, forward: 0.22 },
  away: { lateral: 0.26, forward: 0.2 },
};
/** Frames of the one-shot: the pail set down, the mop over it, the dunk, out, wrung, set back, the pail picked up. */
const WRING_PAIL_DOWN = 3;
const WRING_LIFT_CLEAR = 4;
const WRING_OVER_PAIL = 5;
const WRING_PLUNGE = JANITOR_WRING_DUNK_FRAME + 1;
const WRING_LIFTED_OUT = 9;
const WRING_HAND_ON_STRANDS = 10;
const WRING_TWISTED = 12;
const WRING_UNTWISTED = 14;
const WRING_SWUNG_BACK = 15;
const WRING_MOP_DOWN = 16;
const WRING_PAIL_UP = 18;
/** Clamp heights over its resting height: clear of the rim, down in the water, and the plunge's bottom. */
const WRING_CLEAR_LIFT = 0.28;
const WRING_DUNK_LIFT = 0.12;
const WRING_PLUNGE_LIFT = 0.095;
const WRING_CROUCH = 0.08;
/** Wringing he straightens up, his snout lifted clear of the handle he holds at his chest. */
const WRING_UPRIGHT_STOOP = 0.15;
/** He picks the pail back up with less of a stoop than he set it down with: the job is done. */
const WRING_PICK_UP_STOOP = 0.75;
const WRING_DUNK_CROUCH = 0.05;
const WRING_PLUNGE_CROUCH = 0.07;
const WRING_LEAN = deg(16);
const WRING_PROFILE_LEAN_SHARE = 0.6;
/** The near fist closes on the handle no lower than this share of the way from the clamp up to the far fist. */
const NEAR_GRIP_LOWEST_SHARE = 0.3;
/** How far under the topmost grip the near fist stays, so the handle shows above it. */
const NEAR_GRIP_BELOW_TOP = 0.05;
/** Wringing pulls the strands up as it coils them. */
const WRING_TWIST_RISE = 0.04;
/** Held up to wring, the strands hang at his chest, where the near fist can close round them. */
const WRING_HELD_UP_LIFT = 0.42;
/** The near fist closes this far down the strands from the clamp. */
const WRING_STRAND_GRIP_DROP = 0.05;
const WRING_AWAY_REACH_OUT = 0.2;
/** Held up, the upper fist drops this share of the extra lift as the handle slides through it. */
const WRING_HELD_UP_GRIP_DROP = 0.3;
/** Wringing, the lower fist rolls round the handle against the upper one. */
const WRING_FIST_TURN = deg(55);
/** From behind the pail is out to his left, so the upper fist reaches across to hold the handle upright over it. */
const WRING_FAR_GRIP: GripOffset = {
  front: pt(0.09, 0.12),
  side: pt(-0.03, 0.06),
  away: pt(0.24, 0.04),
};
const WRING_DRIP_CYCLES = 2;
/** Swinging back to his side, the mop is still this much of the way over the pail. */
const WRING_SWUNG_BACK_OVER = 0.15;
/** Unwrung, he gives the mop one last shake up over the pail before swinging it back. */
const WRING_SHAKE_RISE = 0.07;
/** He lowers the mop as he swings it back, so its head comes down beside his leg rather than behind his back. */
const WRING_SWUNG_BACK_LIFT_SHARE = 0.35;

function wringKeys(frame: number, keys: readonly (readonly [number, number])[]): number {
  return keyedSmooth(frame, keys);
}

function janitorWring(view: CrocView, frame: number): CrocPose {
  const build = JANITOR_BUILD;
  const last = JANITOR_WRING_FRAMES - 1;
  const profile = isProfile(view);
  const pose = restingPose(build);
  const stoop = wringKeys(frame, [
    [0, 0],
    [WRING_PAIL_DOWN, 1],
    [JANITOR_WRING_DUNK_FRAME, 1],
    [WRING_LIFTED_OUT, WRING_UPRIGHT_STOOP],
    [WRING_UNTWISTED, WRING_UPRIGHT_STOOP],
    [WRING_PAIL_UP, WRING_PICK_UP_STOOP],
    [last, 0],
  ]);
  // He bobs down after the mop as he plunges it, so both fists ride the handle into the water.
  const plunge = wringKeys(frame, [
    [0, 0],
    [WRING_OVER_PAIL, 0],
    [JANITOR_WRING_DUNK_FRAME, WRING_DUNK_CROUCH],
    [WRING_PLUNGE, WRING_PLUNGE_CROUCH],
    [WRING_LIFTED_OUT, 0],
    [last, 0],
  ]);
  pose.bob = stoop * WRING_CROUCH + plunge;
  // Edge-on he leans less, so his snout stays back from the handle over the pail.
  const leanShare = profile ? WRING_PROFILE_LEAN_SHARE : 1;
  pose.lean += stoop * WRING_LEAN * leanShare;
  pose.headPitch += stoop * WRING_LEAN * leanShare;
  pose.tailSwing = stoop * IDLE_TAIL_SWING;
  if (!profile) {
    const feet = facingRestFeet(build);
    pose.near = { ...feet.near, kneeBreak: NEAR_SIDE, foreshorten: 1 - stoop * WRING_KNEE_SPLAY };
    pose.far = { ...feet.far, kneeBreak: FAR_SIDE, foreshorten: 1 - stoop * WRING_KNEE_SPLAY };
  }

  // Over the pail: 0 at rest at his side, 1 hanging over the pail's mouth.
  const over = wringKeys(frame, [
    [0, 0],
    [WRING_LIFT_CLEAR, 0],
    [WRING_OVER_PAIL, 1],
    [WRING_UNTWISTED, 1],
    [WRING_SWUNG_BACK, WRING_SWUNG_BACK_OVER],
    [WRING_MOP_DOWN, 0],
    [last, 0],
  ]);
  const lift = wringKeys(frame, [
    [0, 0],
    [WRING_PAIL_DOWN, 0],
    [WRING_LIFT_CLEAR, WRING_CLEAR_LIFT],
    [WRING_OVER_PAIL, WRING_CLEAR_LIFT],
    [JANITOR_WRING_DUNK_FRAME, WRING_DUNK_LIFT],
    [WRING_PLUNGE, WRING_PLUNGE_LIFT],
    [WRING_LIFTED_OUT, WRING_CLEAR_LIFT],
    [WRING_HAND_ON_STRANDS, WRING_HELD_UP_LIFT],
    [WRING_TWISTED, WRING_HELD_UP_LIFT + WRING_TWIST_RISE],
    [WRING_UNTWISTED, WRING_CLEAR_LIFT + WRING_SHAKE_RISE],
    [WRING_SWUNG_BACK, WRING_CLEAR_LIFT * WRING_SWUNG_BACK_LIFT_SHARE],
    [WRING_MOP_DOWN, 0],
    [last, 0],
  ]);
  const twist = wringKeys(frame, [
    [0, 0],
    [WRING_HAND_ON_STRANDS, 0],
    [WRING_TWISTED, 1],
    [WRING_UNTWISTED, 0],
    [last, 0],
  ]);
  const wet = keyed(frame, [
    [0, 0],
    [JANITOR_WRING_DUNK_FRAME, 0],
    [WRING_LIFTED_OUT, 1],
    [WRING_UNTWISTED, 1],
    [WRING_SWUNG_BACK, 0],
    [last, 0],
  ]);
  const inPail = frame >= JANITOR_WRING_DUNK_FRAME && frame < WRING_LIFTED_OUT;
  const mop: MopPose = {
    ...restingMop({
      lateral: lerp(MOP_AT_REST[view].lateral, WRING_PAIL_SPOT[view].lateral, over),
      forward: lerp(MOP_AT_REST[view].forward, WRING_PAIL_SPOT[view].forward, over),
    }),
    lift,
    twoHanded: frame > WRING_PAIL_DOWN && frame <= WRING_UNTWISTED,
    twist,
    // Under the water nothing drips; it runs off once the strands are out.
    drip: inPail ? 0 : wet,
    dripPhase: (frame / JANITOR_WRING_FRAMES) * WRING_DRIP_CYCLES,
    inPail,
  };

  const pailSpot = WRING_PAIL_SPOT[view];
  const pailGround = groundPointFor(view, pailSpot.lateral, pailSpot.forward);
  const pailCentre = pt(pailGround.x, pailGround.y - BUCKET_REST_HEIGHT);
  const pailDown = frame >= WRING_PAIL_DOWN && frame < WRING_PAIL_UP;
  pose.bucket = pailDown
    ? { kind: 'placed', centre: pailCentre, tilt: 0, front: view === 'front' }
    : { kind: 'hang', swing: 0 };

  const restGrip = farGripFor(build, pose, view, IDLE_GRIP);
  const raised = farGripFor(build, pose, view, WRING_FAR_GRIP);
  // The hands ride down with the mop into the water. Held up to wring, the
  // handle slides up through the upper fist, which drops to his chest, so
  // the handle's top stays clear of his face.
  const rideDown = Math.max(0, WRING_CLEAR_LIFT - lift);
  const slideDown = Math.max(0, lift - WRING_CLEAR_LIFT) * WRING_HELD_UP_GRIP_DROP;
  const highGrip = pt(raised.x, raised.y + rideDown + slideDown);
  const carried = lerpPt(restGrip, highGrip, over);
  // Lifted at his side before it swings over, the mop rises in his fist.
  const farGrip = pt(carried.x, carried.y - lift * (1 - over));
  holdMop(build, pose, view, mop, farGrip);
  const socket = mopSocketFor(view, mop);

  // The near hand: carrying the pail, down to its bail, across to the handle, and back.
  const shoulders = shoulderJoints(build, pose, view);
  const hang = pt(
    shoulders.near.x,
    shoulders.near.y + (build.upperArm + build.forearm) * HANG_REACH_SHARE,
  );
  const bail = pt(pailCentre.x, pailCentre.y - BUCKET_BAIL_ABOVE_CENTRE);
  const toBail = wringKeys(frame, [
    [0, 0],
    [WRING_PAIL_DOWN, 1],
    [WRING_PAIL_DOWN + 1, 0],
    [WRING_MOP_DOWN, 0],
    [WRING_PAIL_UP, 1],
    [last, 0],
  ]);
  const nearElbow = profile ? ELBOW_BACK : facingElbow(NEAR_SIDE);
  if (mop.twoHanded) {
    // Wringing, the near fist leaves the handle for the strands and twists them.
    // From behind, a fist on the handle next to his body is hidden by it; he
    // reaches out over the pail instead, where the fist shows past his side.
    const reachOut = view === 'away' ? WRING_AWAY_REACH_OUT : 0;
    const reachFrom = pt(shoulders.near.x + reachOut, shoulders.near.y);
    const onHandle = nearestOnHandle(socket, farGrip, reachFrom);
    const onStrands = pt(socket.x, socket.y + WRING_STRAND_GRIP_DROP);
    const handOnStrands = wringKeys(frame, [
      [0, 0],
      [WRING_LIFTED_OUT, 0],
      [WRING_HAND_ON_STRANDS, 1],
      [WRING_TWISTED, 1],
      [WRING_UNTWISTED, 0],
      [last, 0],
    ]);
    pose.nearArm = gripArm(
      build,
      socket,
      lerpPt(onHandle, onStrands, handOnStrands),
      nearElbow,
      outwardFor(view),
      false,
      twist * WRING_FIST_TURN,
    );
  } else {
    pose.nearArm = armAt(lerpPt(hang, bail, toBail), nearElbow, 1, null, false);
  }
  return pose;
}

/** Head-on, the stoop over the pail splays the knees rather than shrinking the legs. */
const WRING_KNEE_SPLAY = 0.25;
/** The bail's top, above the bucket's centre, where a hand picks it up. */
const BUCKET_BAIL_ABOVE_CENTRE = 0.14;

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
}

// ── Sydney ───────────────────────────────────────────────────────────────

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

function sydneyIdle(view: CrocView, phase: number): CrocPose {
  const build = SYDNEY_BUILD;
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

function sydneyWalk(view: CrocView, phase: number): CrocPose {
  return walkPose(SYDNEY_BUILD, SYDNEY_WALK, view, phase, false);
}

/**
 * Arms crossed, then the near hand comes out palm-first — "pay up" — and goes
 * back. The jaw works twice while the hand is out.
 */
/** How long her arms take to uncross into the palm, and how long the palm is held out. */
const TALK_UNCROSS_FRAMES = 3;
const TALK_PALM_HOLD_FRAMES = 3;

function sydneyTalk(view: CrocView, frame: number): CrocPose {
  const build = SYDNEY_BUILD;
  const palm = SYDNEY_TALK_PALM_FRAME;
  const frames = SYDNEY_TALK_FRAMES;
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
  // Elbow at the chest, forearm up, the palm turned to whoever is across the desk.
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

export const JANITOR_ROWS: readonly RowSpec[] = expand([
  {
    base: 'idle',
    frameCount: JANITOR_IDLE_FRAMES,
    loops: true,
    gait: null,
    pose: janitorIdle,
    byFrame: false,
  },
  {
    base: 'walk_mop',
    frameCount: JANITOR_WALK_MOP_FRAMES,
    loops: true,
    gait: JANITOR_WALK_MOP,
    pose: janitorWalkMop,
    byFrame: false,
  },
  {
    base: 'mop',
    frameCount: JANITOR_MOP_FRAMES,
    loops: true,
    gait: null,
    pose: janitorMop,
    byFrame: false,
  },
  {
    base: 'wring',
    frameCount: JANITOR_WRING_FRAMES,
    loops: false,
    gait: null,
    pose: janitorWring,
    byFrame: true,
  },
]);

export const SYDNEY_ROWS: readonly RowSpec[] = expand([
  {
    base: 'idle',
    frameCount: SYDNEY_IDLE_FRAMES,
    loops: true,
    gait: null,
    pose: sydneyIdle,
    byFrame: false,
  },
  {
    base: 'walk',
    frameCount: SYDNEY_WALK_FRAMES,
    loops: true,
    gait: SYDNEY_WALK,
    pose: sydneyWalk,
    byFrame: false,
  },
  {
    base: 'talk',
    frameCount: SYDNEY_TALK_FRAMES,
    loops: true,
    gait: null,
    pose: sydneyTalk,
    byFrame: true,
  },
]);

/** Tiles covered per walk cycle, for a kit pacing the walk phase by ground covered. */
export const JANITOR_TILES_PER_WALK_CYCLE = tilesPerCycle(JANITOR_BUILD, JANITOR_WALK_MOP);
export const SYDNEY_TILES_PER_WALK_CYCLE = tilesPerCycle(SYDNEY_BUILD, SYDNEY_WALK);

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

export const JANITOR_FIGURE: FigureDef = {
  id: 'crocodilian_janitor',
  ...JANITOR_CELL,
  tileScale: TILE_SCALE,
  states: figureStates(stateFrames(JANITOR_ROWS)),
  paintFrame: crocPainter(JANITOR_BUILD, JANITOR_ROWS, JANITOR_CELL),
};

export const SYDNEY_FIGURE: FigureDef = {
  id: 'crocodilian_sydney',
  ...SYDNEY_CELL,
  tileScale: TILE_SCALE,
  states: figureStates(stateFrames(SYDNEY_ROWS)),
  paintFrame: crocPainter(SYDNEY_BUILD, SYDNEY_ROWS, SYDNEY_CELL),
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

export { JANITOR_WALK_MOP, SYDNEY_WALK, type Gait };
