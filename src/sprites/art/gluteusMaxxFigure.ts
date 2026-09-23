/**
 * Gluteus Maxx as a painted figure: the choreography, the cell geometry and
 * the `FigureDef` the runtime cache and the review harness draw through.
 *
 * This module is choreography and nothing else: one pose function per row,
 * the row table, and where a pose sits in its cell. Anatomy, palette and every
 * stroke of paint live in `gluteusMaxxArt.ts`.
 *
 * Rows, each in three views (`<row>` head-on, `<row>_side`, `<row>_away`):
 *    idle       bouncing on his toes, clanking the gauntlets together
 *    walk       a short-legged, shoulder-rolling scurry
 *    jab_left   a snapped left
 *    jab_right  a snapped right
 *    crush      turns his back, hops onto the target and sits on it
 *    hurt       a flinch
 *    death      staggers, topples backward, and lies there
 *
 * The art invariants live in `scripts/gates-gluteus-maxx.ts`, which the review
 * harness runs: `npm run render:gluteus-maxx`.
 */

import {
  HIP_HEIGHT,
  MAXX_BODY_SCALE,
  TWO_PI,
  drawMaxx,
  restArm,
  restPose,
  shoulderJoint,
  sideSign,
  v3,
  type ArmAngles,
  type ArmPose,
  type Dust,
  type FaceState,
  type LegPose,
  type MaxxPose,
  type MaxxView,
  type Side,
  type Spark,
  type V3,
} from './gluteusMaxxArt';
import { clamp01, deg, easeInOut, hump, lerp } from './carlArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  MAXX_CRUSH_FRAMES,
  MAXX_CRUSH_IMPACT_FRAME,
  MAXX_CRUSH_SEAT_REACH_TILES,
  MAXX_DEATH_FRAMES,
  MAXX_HURT_FRAMES,
  MAXX_IDLE_FRAMES,
  MAXX_JAB_FRAMES,
  MAXX_JAB_IMPACT_FRAME,
  MAXX_WALK_FRAMES,
} from '../gluteusMaxxTiming';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * The ground line's row within the tile, the one Carl and the cat stand on,
 * so a hireling beside the player stands on the same line he does.
 */
const GROUND_ROW_IN_TILE = 58;
export const GROUND_OFFSET_IN_TILE = GROUND_ROW_IN_TILE / TILE_SCALE;

/** Which of his two figures paints a row. */
export type MaxxCell = 'body' | 'finisher';

/**
 * The two cells he is painted into. Standing, walking, jabbing and flinching
 * fit a cell a little over a tile and a half square. The crush carries him
 * most of a tile along his facing — down the screen head-on, up it from
 * behind, sideways edge-on — and the death lays him full length across the
 * floor, so those two rows get a cell of their own: in one shared cell every
 * idle frame would pay for the finisher's room, and the rows the cache has to
 * hold together would outgrow the per-figure budget. The gates fail any pose
 * that paints against an edge of its cell.
 */
export interface MaxxCellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** The cell row his ground line is painted on. */
  readonly originY: number;
}

export const MAXX_CELLS: Readonly<Record<MaxxCell, MaxxCellGeometry>> = {
  body: { frameWidth: 100, frameHeight: 92, originY: 84 },
  finisher: { frameWidth: 168, frameHeight: 200, originY: 131 },
};

function tileXOf(cell: MaxxCellGeometry): number {
  return (cell.frameWidth - TILE_SCALE) / 2;
}

function tileYOf(cell: MaxxCellGeometry): number {
  return cell.originY - GROUND_ROW_IN_TILE;
}

/** The cell pixel his ground point — between his feet — is painted at. */
export function maxxOrigin(cell: MaxxCellGeometry): { x: number; y: number } {
  return { x: tileXOf(cell) + TILE_SCALE / 2, y: cell.originY };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type MaxxRowBase = 'idle' | 'walk' | 'jab_left' | 'jab_right' | 'crush' | 'hurt' | 'death';
export const MAXX_ROW_BASES: readonly MaxxRowBase[] = [
  'idle',
  'walk',
  'jab_left',
  'jab_right',
  'crush',
  'hurt',
  'death',
];

/** The three viewpoints a facing vector selects, and the suffix each row name takes. */
export type MaxxFacing = 'front' | 'side' | 'away';
export const MAXX_FACINGS: readonly MaxxFacing[] = ['front', 'side', 'away'];

export function maxxStateName(base: MaxxRowBase, facing: MaxxFacing): string {
  if (facing === 'side') return `${base}_side`;
  if (facing === 'away') return `${base}_away`;
  return base;
}

const PAINTER_VIEW: Readonly<Record<MaxxFacing, MaxxView>> = {
  front: 'front',
  side: 'side',
  away: 'back',
};

/** A painted frame: which painter view to use and the pose it paints. */
export interface MaxxFrame {
  readonly view: MaxxView;
  readonly pose: MaxxPose;
}

export interface MaxxRow {
  readonly base: MaxxRowBase;
  readonly cell: MaxxCell;
  readonly frameCount: number;
  readonly kind: 'loop' | 'oneShot';
  readonly frame: (facing: MaxxFacing, frame: number) => MaxxFrame;
}

function inView(facing: MaxxFacing, pose: MaxxPose): MaxxFrame {
  return { view: PAINTER_VIEW[facing], pose };
}

/** Loops sample the cycle evenly, so the last frame hands back to the first. */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function wrap01(t: number): number {
  return ((t % 1) + 1) % 1;
}

// ── Guard and the clank ──────────────────────────────────────────────────────

/**
 * His guard: both steel fists up in front of the chest, elbows out. Wrist
 * targets are in figure space; the elbow is solved toward `guardPole`, out
 * and down, which is what turns the forearms inward so the fists face each
 * other and can be clanked together.
 */
const GUARD_WRIST_HEIGHT = 0.74;
const GUARD_WRIST_FORWARD = 0.19;
/** Where each wrist sits across when the fists are apart, and when they meet. */
const GUARD_WRIST_APART = 0.175;
const GUARD_WRIST_TOGETHER = 0.12;

function guardPole(side: Side): V3 {
  return v3(sideSign(side) * 0.8, 1, -0.3);
}

function guardArm(side: Side, together: number, lift = 0): ArmPose {
  const across = lerp(GUARD_WRIST_APART, GUARD_WRIST_TOGETHER, together);
  return {
    kind: 'reach',
    wrist: v3(sideSign(side) * across, -GUARD_WRIST_HEIGHT - lift, GUARD_WRIST_FORWARD),
    pole: guardPole(side),
  };
}

/** Where the two fists meet when they clank. */
const CLANK_POINT = v3(0, -GUARD_WRIST_HEIGHT - 0.02, GUARD_WRIST_FORWARD + 0.04);
const CLANK_SPARK_SIZE = 0.13;

// ── Idle ─────────────────────────────────────────────────────────────────────

/** Two bounces and two clanks per loop, six frames each: never under Nyquist. */
const IDLE_BOUNCES = 2;
const IDLE_HEEL_LOW = deg(9);
const IDLE_HEEL_HIGH = deg(40);
/** How far the hips rise at the top of a bounce and sink into its landing. */
const IDLE_RISE = 0.055;
const IDLE_SINK = 0.028;
const IDLE_HOP = 0.025;
const IDLE_LEAN = deg(5);
const IDLE_FOOT_SPREAD = 0.11;
const IDLE_FOOT_FORWARD = 0.07;
/** The head lags the body by this share of a bounce, so the landing nods it. */
const IDLE_HEAD_LAG = 0.12;
const IDLE_HEAD_NOD = 0.012;
const IDLE_SHRUG = deg(2.5);
const IDLE_SWAY_SHIFT = 0.014;
const IDLE_SWAY_ROLL = deg(3.5);
const IDLE_SWAY_PHASE = 0.125;

export function idlePose(phase: number): MaxxPose {
  const rest = restPose();
  const bounceAngle = phase * TWO_PI * IDLE_BOUNCES;
  // 0 at a landing (phase 0 and ½), 1 at the top of a bounce.
  const up = 0.5 - 0.5 * Math.cos(bounceAngle);
  const together = 0.5 + 0.5 * Math.cos(bounceAngle);
  const heelLift = lerp(IDLE_HEEL_LOW, IDLE_HEEL_HIGH, up);
  // At the top of each bounce his toes just leave the floor.
  const hop = IDLE_HOP * up * up;
  const hip = HIP_HEIGHT + lerp(-IDLE_SINK, IDLE_RISE, up);
  const headUp = 0.5 - 0.5 * Math.cos(bounceAngle - IDLE_HEAD_LAG * TWO_PI);
  const legs: Record<Side, LegPose> = {
    right: { ball: v3(IDLE_FOOT_SPREAD, -hop, IDLE_FOOT_FORWARD), heelLift },
    left: { ball: v3(-IDLE_FOOT_SPREAD, -hop, IDLE_FOOT_FORWARD), heelLift },
  };
  const clankFrame = together > 0.97;
  const sparkFading = !clankFrame && together > 0.7 && Math.sin(bounceAngle) > 0;
  const sparks: Spark[] = [];
  if (clankFrame) sparks.push({ at: CLANK_POINT, progress: 0.1, size: CLANK_SPARK_SIZE });
  else if (sparkFading) sparks.push({ at: CLANK_POINT, progress: 0.65, size: CLANK_SPARK_SIZE });
  // Once per loop he shifts his weight from foot to foot, so the loop's two
  // bounces are two different pictures rather than one painted twice.
  // Phased off the frame grid by an eighth, so no two frames half a loop
  // apart both land on the sway's zero crossing and paint one picture twice.
  const sway = Math.sin((phase + IDLE_SWAY_PHASE) * TWO_PI);
  return {
    ...rest,
    pelvis: v3(IDLE_SWAY_SHIFT * sway, -hip, 0),
    lean: IDLE_LEAN,
    roll: IDLE_SWAY_ROLL * sway,
    headNod: IDLE_HEAD_NOD * (1 - headUp),
    headTilt: -IDLE_SWAY_SHIFT * sway,
    arms: {
      right: guardArm('right', together, IDLE_SHRUG * up),
      left: guardArm('left', together, IDLE_SHRUG * up),
    },
    legs,
    face: { mouth: 'grin', eyes: 'wide', brow: 0.6 },
    sparks,
  };
}

// ── Walk ─────────────────────────────────────────────────────────────────────

/**
 * The share of the cycle each foot is on the floor. Under a half, so the run
 * has a flight between steps: he is fast for his size, and a short-legged man
 * covering that ground walking would need a cadence the row cannot play.
 */
export const WALK_STANCE_SHARE = 0.36;
/** Where the ball of the foot lands, and leaves, ahead of the hips. */
const WALK_CONTACT_Z = 0.2;
const WALK_TOE_OFF_Z = -0.2;
/**
 * Ground a cycle covers, in tiles: the planted foot sweeps back at exactly the
 * rate he is carried forward, so this follows from the sweep and the stance
 * share and is never chosen.
 */
export const MAXX_WALK_GROUND_PER_CYCLE_TILES =
  ((WALK_CONTACT_Z - WALK_TOE_OFF_Z) / WALK_STANCE_SHARE) * MAXX_BODY_SCALE;
const WALK_FOOT_SPREAD = 0.07;
const WALK_SWING_LIFT = 0.16;
const WALK_TOE_OFF_HEEL = deg(50);
const WALK_KICK_HEEL = deg(75);
/** The hips ride highest in flight and sink over the planted foot. */
const WALK_HIP = 0.485;
const WALK_HIP_DROP = 0.035;
const WALK_LEAN = deg(10);
/** The swagger: a big shoulder roll, a tip over each stance leg, and wide arms. */
const WALK_TWIST = deg(15);
const WALK_ROLL = deg(5);
const WALK_HIP_SHIFT = 0.016;
const WALK_ARM_SWING = deg(28);
const WALK_ARM_ABDUCT = deg(26);
const WALK_ELBOW_BEND = deg(62);
const WALK_FORE_ABDUCT = deg(-6);
const WALK_HEAD_BOB = 0.008;

function walkLeg(side: Side, footPhase: number): LegPose {
  const x = sideSign(side) * WALK_FOOT_SPREAD;
  if (footPhase < WALK_STANCE_SHARE) {
    const t = footPhase / WALK_STANCE_SHARE;
    const z = lerp(WALK_CONTACT_Z, WALK_TOE_OFF_Z, t);
    // The heel stays down through the first half of stance, then peels up.
    const heelLift = WALK_TOE_OFF_HEEL * easeInOut(clamp01((t - 0.45) / 0.55));
    return { ball: v3(x, 0, z), heelLift };
  }
  const u = (footPhase - WALK_STANCE_SHARE) / (1 - WALK_STANCE_SHARE);
  const z = lerp(WALK_TOE_OFF_Z, WALK_CONTACT_Z, easeInOut(u));
  const lift = WALK_SWING_LIFT * hump(clamp01(u * 1.1));
  // The heel flicks up behind, then the foot flattens to paw the floor.
  const heelLift =
    u < 0.3
      ? lerp(WALK_TOE_OFF_HEEL, WALK_KICK_HEEL, u / 0.3)
      : lerp(WALK_KICK_HEEL, 0, easeInOut((u - 0.3) / 0.7));
  return { ball: v3(x, -lift, z), heelLift };
}

export function walkPose(phase: number): MaxxPose {
  const rest = restPose();
  const midStance = phase - WALK_STANCE_SHARE / 2;
  const overRight = Math.cos(midStance * TWO_PI);
  const sink = 0.5 + 0.5 * Math.cos(midStance * 2 * TWO_PI);
  // At its own foot's contact an arm is furthest back: a cosine, not a sine.
  const rightSwing = -WALK_ARM_SWING * Math.cos(phase * TWO_PI);
  const walkArm = (swing: number): ArmPose => ({
    kind: 'angles',
    upperSwing: swing,
    upperAbduct: WALK_ARM_ABDUCT,
    foreSwing: swing + WALK_ELBOW_BEND,
    foreAbduct: WALK_FORE_ABDUCT,
  });
  return {
    ...rest,
    pelvis: v3(WALK_HIP_SHIFT * overRight, -(WALK_HIP - WALK_HIP_DROP * sink), 0),
    lean: WALK_LEAN,
    twist: -WALK_TWIST * Math.cos(phase * TWO_PI),
    roll: WALK_ROLL * overRight,
    headNod: WALK_HEAD_BOB * sink,
    headTilt: -WALK_HIP_SHIFT * overRight * 0.5,
    arms: { right: walkArm(rightSwing), left: walkArm(-rightSwing) },
    legs: { right: walkLeg('right', wrap01(phase)), left: walkLeg('left', wrap01(phase + 0.5)) },
    face: { mouth: 'grin', eyes: 'wide', brow: 0.8 },
  };
}

// ── Jabs ─────────────────────────────────────────────────────────────────────

/** How far out the fist is on each frame: cock, snap out, hold, recoil. */
const JAB_EXTENSION: readonly number[] = [0, -0.18, 0.55, 1, 0.9, 0.45, 0.15, 0];
/**
 * On the way back the fist drops a little under the line it went out on, so
 * the recoil is its own path rather than the snap played backwards.
 */
const JAB_RECOIL_DROP: readonly number[] = [0, 0, 0, 0, 0.03, 0.06, 0.035, 0];
/** He grits his teeth this many frames either side of the one the jab lands on. */
const JAB_GRIT_FRAMES = 1;
const JAB_STREAK: readonly number[] = [0, 0, 0.7, 1, 0.35, 0, 0, 0];
const JAB_TWIST = deg(20);
const JAB_LEAN = deg(8);
const JAB_HIP_FORWARD = 0.035;
/**
 * Where the punching wrist ends up, relative to its own shoulder. From behind
 * the punch is aimed up past the head, or the torso would hide all of it.
 */
function jabReach(facing: MaxxFacing, side: Side): V3 {
  const inward = -sideSign(side);
  if (facing === 'away') return v3(inward * -0.09, -0.03, 0.33);
  if (facing === 'front') return v3(inward * 0.13, 0.1, 0.4);
  return v3(inward * 0.1, 0.03, 0.35);
}

function jabPose(facing: MaxxFacing, side: Side, frame: number): MaxxPose {
  const base = idlePose(0.25 / IDLE_BOUNCES);
  const extension = JAB_EXTENSION[frame];
  const out = Math.max(0, extension);
  const sign = sideSign(side);
  const posed: MaxxPose = {
    ...base,
    pelvis: v3(base.pelvis.x, base.pelvis.y + 0.01 * out, JAB_HIP_FORWARD * out),
    twist: JAB_TWIST * sign * extension,
    lean: IDLE_LEAN + JAB_LEAN * out,
    sparks: [],
  };
  const shoulder = shoulderJoint(posed, side);
  const guard = guardArm(side, 0);
  const guardWrist = guard.kind === 'reach' ? guard.wrist : shoulder;
  const reach = jabReach(facing, side);
  const target = v3(shoulder.x + reach.x, shoulder.y + reach.y, shoulder.z + reach.z);
  const outbound =
    extension >= 0
      ? lerpV3(guardWrist, target, easeInOut(extension))
      : lerpV3(guardWrist, v3(guardWrist.x, guardWrist.y + 0.03, guardWrist.z - 0.06), -extension);
  const wrist = v3(outbound.x, outbound.y + JAB_RECOIL_DROP[frame], outbound.z);
  const punching: ArmPose = { kind: 'reach', wrist, pole: v3(sign * 0.7, 1, -0.3) };
  const other = otherSide(side);
  const arms: Record<Side, ArmPose> =
    side === 'right'
      ? { right: punching, left: guardArm(other, 0, 0.03) }
      : { left: punching, right: guardArm(other, 0, 0.03) };
  const face: FaceState =
    Math.abs(frame - MAXX_JAB_IMPACT_FRAME) <= JAB_GRIT_FRAMES
      ? { mouth: 'grit', eyes: 'squint', brow: -1 }
      : { mouth: 'grin', eyes: 'wide', brow: 0.3 };
  return {
    ...posed,
    arms,
    face,
    jabStreak:
      side === 'right'
        ? { right: JAB_STREAK[frame], left: 0 }
        : { right: 0, left: JAB_STREAK[frame] },
  };
}

function otherSide(side: Side): Side {
  return side === 'right' ? 'left' : 'right';
}

function lerpV3(a: V3, b: V3, t: number): V3 {
  return v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
}

// ── Crush ────────────────────────────────────────────────────────────────────

/**
 * Turned, which of the painter's views faces the other way: head-on he turns
 * his back on the camera, from behind he turns to face it, edge-on he faces
 * −X. The turn between passes through the profile, or head-on for the side
 * row, for one frame.
 */
const TURNED_VIEW: Readonly<Record<MaxxFacing, { view: MaxxView; mirrored: boolean }>> = {
  front: { view: 'back', mirrored: false },
  side: { view: 'side', mirrored: true },
  away: { view: 'front', mirrored: false },
};
const MID_TURN_VIEW: Readonly<Record<MaxxFacing, MaxxView>> = {
  front: 'side',
  side: 'front',
  away: 'side',
};

/** The screen direction he travels to reach the target, per facing. */
const CRUSH_TRAVEL: Readonly<Record<MaxxFacing, { x: number; y: number }>> = {
  front: { x: 0, y: 1 },
  side: { x: 1, y: 0 },
  away: { x: 0, y: -1 },
};

type CrushStance =
  | 'guard'
  | 'bounce'
  | 'settle'
  | 'flex'
  | 'stand'
  | 'crouch'
  | 'push'
  | 'tuck'
  | 'seat'
  | 'rise'
  | 'land';
type CrushFacing = 'start' | 'mid' | 'turned';

interface CrushKey {
  readonly facing: CrushFacing;
  readonly stance: CrushStance;
  /** Share of the way to the target. */
  readonly travel: number;
  /** Height of the hop, in tiles. */
  readonly hop: number;
  readonly squash: number;
  readonly face: FaceState;
  /** Dust and stars progress, or −1 for none. */
  readonly dust: number;
  readonly stars: number;
}

const GRIN: FaceState = { mouth: 'grin', eyes: 'wide', brow: 0.6 };
const SMUG: FaceState = { mouth: 'smug', eyes: 'squint', brow: 0.8 };
const YELL: FaceState = { mouth: 'yell', eyes: 'wide', brow: 1 };

/**
 * The routine, frame by frame: a flex for the crowd, a turn, a hop backward
 * onto the target, the landing — the impact — a smug beat sitting on it, then
 * up, a hop home and a turn back. `MAXX_CRUSH_IMPACT_FRAME` is the seat frame.
 */
const CRUSH_KEYS: readonly CrushKey[] = [
  {
    facing: 'start',
    stance: 'flex',
    travel: 0,
    hop: 0,
    squash: 1,
    face: SMUG,
    dust: -1,
    stars: -1,
  },
  { facing: 'mid', stance: 'flex', travel: 0, hop: 0, squash: 1, face: GRIN, dust: -1, stars: -1 },
  {
    facing: 'turned',
    stance: 'crouch',
    travel: 0,
    hop: 0,
    squash: 1,
    face: GRIN,
    dust: -1,
    stars: -1,
  },
  {
    facing: 'turned',
    stance: 'push',
    travel: 0.18,
    hop: 0.1,
    squash: 1,
    face: YELL,
    dust: -1,
    stars: -1,
  },
  {
    facing: 'turned',
    stance: 'tuck',
    travel: 0.52,
    hop: 0.3,
    squash: 1,
    face: YELL,
    dust: -1,
    stars: -1,
  },
  {
    facing: 'turned',
    stance: 'tuck',
    travel: 0.9,
    hop: 0.08,
    squash: 1,
    face: YELL,
    dust: -1,
    stars: -1,
  },
  {
    facing: 'turned',
    stance: 'seat',
    travel: 1,
    hop: 0,
    squash: 0.8,
    face: YELL,
    dust: 0.05,
    stars: 0,
  },
  {
    facing: 'turned',
    stance: 'seat',
    travel: 1,
    hop: 0,
    squash: 0.95,
    face: SMUG,
    dust: 0.35,
    stars: 0.3,
  },
  {
    facing: 'turned',
    stance: 'seat',
    travel: 1,
    hop: 0,
    squash: 1,
    face: SMUG,
    dust: 0.7,
    stars: 0.6,
  },
  {
    facing: 'turned',
    stance: 'rise',
    travel: 1,
    hop: 0,
    squash: 1,
    face: GRIN,
    dust: -1,
    stars: -1,
  },
  {
    facing: 'turned',
    stance: 'crouch',
    travel: 1,
    hop: 0,
    squash: 1,
    face: GRIN,
    dust: -1,
    stars: -1,
  },
  {
    facing: 'turned',
    stance: 'push',
    travel: 0.55,
    hop: 0.14,
    squash: 1,
    face: GRIN,
    dust: -1,
    stars: -1,
  },
  {
    facing: 'turned',
    stance: 'land',
    travel: 0.05,
    hop: 0,
    squash: 1,
    face: GRIN,
    dust: -1,
    stars: -1,
  },
  { facing: 'mid', stance: 'stand', travel: 0, hop: 0, squash: 1, face: GRIN, dust: -1, stars: -1 },
  {
    facing: 'start',
    stance: 'settle',
    travel: 0,
    hop: 0,
    squash: 1,
    face: SMUG,
    dust: -1,
    stars: -1,
  },
  {
    facing: 'start',
    stance: 'guard',
    travel: 0,
    hop: 0,
    squash: 1,
    face: GRIN,
    dust: -1,
    stars: -1,
  },
];

/** The idle phase the routine settles through on its way back to the guard. */
const SETTLE_IDLE_PHASE = 0.4;
/** Edge-on, the routine opens on the top of a bounce instead of a flex. */
const WIND_UP_IDLE_PHASE = 0.2;

/** Where his hips sit when he is sitting on something. */
const SEAT_HIP_HEIGHT = 0.13;
/** How far behind his hips the seat of the Speedo lands, in his own frame. */
export const MAXX_SEAT_BEHIND_HIPS = 0.14;
const CRUSH_DUST_SPREAD = 0.5;

function flexArms(): Record<Side, ArmPose> {
  const flex = (): ArmPose => ({
    kind: 'angles',
    upperSwing: deg(10),
    upperAbduct: deg(88),
    foreSwing: deg(20),
    foreAbduct: deg(175),
  });
  return { right: flex(), left: flex() };
}

/**
 * Arms flung up as he drops onto the seat. Head-on and from behind they go
 * up and out in a V; edge-on that V would lie across his face, so there they
 * are thrown up and back behind his head.
 */
function tadaArms(facing: MaxxFacing): Record<Side, ArmPose> {
  const edgeOn = facing === 'side';
  const up = (): ArmPose => ({
    kind: 'angles',
    upperSwing: edgeOn ? deg(198) : deg(30),
    upperAbduct: edgeOn ? deg(8) : deg(120),
    foreSwing: edgeOn ? deg(206) : deg(40),
    foreAbduct: edgeOn ? deg(4) : deg(150),
  });
  return { right: up(), left: up() };
}

function crushStancePose(stance: CrushStance, facing: MaxxFacing): MaxxPose {
  const rest = idlePose(0);
  const spread = IDLE_FOOT_SPREAD;
  const foot = (side: Side, z: number, lift = 0, heel = 0): LegPose => ({
    ball: v3(sideSign(side) * spread, -lift, z),
    heelLift: heel,
  });
  switch (stance) {
    case 'guard':
      // The last frame hands back to the idle's first, less its spark.
      return { ...rest, sparks: [] };
    case 'settle':
      return { ...idlePose(SETTLE_IDLE_PHASE), sparks: [] };
    case 'bounce':
      return { ...idlePose(WIND_UP_IDLE_PHASE), sparks: [] };
    case 'flex':
      return {
        ...rest,
        pelvis: v3(0, -HIP_HEIGHT + 0.02, 0),
        lean: deg(-4),
        arms: flexArms(),
        sparks: [],
      };
    case 'stand':
      return {
        ...rest,
        arms: { right: restArm(), left: restArm() },
        sparks: [],
        pelvis: v3(0, -HIP_HEIGHT, 0),
        legs: { right: foot('right', 0.07), left: foot('left', 0.07) },
      };
    case 'crouch':
      return {
        ...rest,
        pelvis: v3(0, -HIP_HEIGHT + 0.09, -0.03),
        lean: deg(18),
        arms: { right: swingArm(deg(-40)), left: swingArm(deg(-40)) },
        legs: { right: foot('right', 0.07), left: foot('left', 0.07) },
        sparks: [],
      };
    case 'push':
      return {
        ...rest,
        pelvis: v3(0, -HIP_HEIGHT - 0.02, -0.02),
        lean: deg(-6),
        arms: { right: pumpArm(), left: pumpArm() },
        legs: { right: foot('right', 0.1, 0, deg(55)), left: foot('left', 0.1, 0, deg(55)) },
        sparks: [],
      };
    case 'tuck':
      return {
        ...rest,
        pelvis: v3(0, -HIP_HEIGHT + 0.02, 0),
        lean: deg(-18),
        arms: tadaArms(facing),
        legs: {
          right: foot('right', 0.36, 0.22, deg(-10)),
          left: foot('left', 0.36, 0.22, deg(-10)),
        },
        sparks: [],
      };
    case 'seat':
      return {
        ...rest,
        pelvis: v3(0, -SEAT_HIP_HEIGHT, 0),
        lean: deg(-10),
        arms: tadaArms(facing),
        legs: {
          right: foot('right', 0.42, 0.03, deg(-25)),
          left: foot('left', 0.42, 0.03, deg(-25)),
        },
        sparks: [],
      };
    case 'rise':
      return {
        ...rest,
        pelvis: v3(0, -0.3, 0.04),
        lean: deg(30),
        arms: {
          right: { kind: 'reach', wrist: v3(0.27, -0.42, 0.08), pole: v3(1, 0, -0.3) },
          left: { kind: 'reach', wrist: v3(-0.27, -0.42, 0.08), pole: v3(-1, 0, -0.3) },
        },
        legs: { right: foot('right', 0.14), left: foot('left', 0.14) },
        sparks: [],
      };
    case 'land':
      return {
        ...rest,
        pelvis: v3(0, -HIP_HEIGHT + 0.06, 0),
        lean: deg(12),
        arms: { right: swingArm(deg(20)), left: swingArm(deg(20)) },
        legs: { right: foot('right', 0.07), left: foot('left', 0.07) },
        sparks: [],
      };
  }
}

/** Arms pumped forward for the take-off, elbows bent, not thrust out stiff. */
function pumpArm(): ArmPose {
  return {
    kind: 'angles',
    upperSwing: deg(35),
    upperAbduct: deg(22),
    foreSwing: deg(95),
    foreAbduct: deg(0),
  };
}

function swingArm(swing: number): ArmPose {
  return {
    kind: 'angles',
    upperSwing: swing,
    upperAbduct: deg(20),
    foreSwing: swing + deg(25),
    foreAbduct: deg(10),
  };
}

/**
 * How far the seat lands behind his hips as the view draws it: edge-on it is
 * sideways screen distance; head-on and from behind it is depth, which only
 * the floor's small foreshortening shows.
 */
function seatScreenLead(facing: MaxxFacing): number {
  return facing === 'side' ? MAXX_SEAT_BEHIND_HIPS * MAXX_BODY_SCALE : 0;
}

export function crushFrame(facing: MaxxFacing, frame: number): MaxxFrame {
  const key = CRUSH_KEYS[frame];
  const travelDir = CRUSH_TRAVEL[facing];
  const hipTravel = MAXX_CRUSH_SEAT_REACH_TILES - seatScreenLead(facing);
  const along = hipTravel * key.travel;
  const offset = { x: travelDir.x * along, y: travelDir.y * along - key.hop };
  // Edge-on a double-biceps flex hides his face behind his own fist; he
  // saves it for the frame where the turn swings him to face the camera.
  const stance =
    facing === 'side' && key.facing === 'start' && key.stance === 'flex' ? 'bounce' : key.stance;
  const base = crushStancePose(stance, facing);
  const dust: Dust[] =
    key.dust < 0
      ? []
      : [
          {
            at: { x: travelDir.x * seatScreenLead(facing), y: 0 },
            progress: key.dust,
            spread: CRUSH_DUST_SPREAD,
          },
        ];
  const stars = key.stars < 0 ? null : { at: v3(0, -0.72, -0.05), progress: key.stars };
  const pose: MaxxPose = {
    ...base,
    face: key.face,
    squash: key.squash,
    offset,
    dust,
    stars,
    mirrored: key.facing === 'turned' && TURNED_VIEW[facing].mirrored,
  };
  if (key.facing === 'start') return { view: PAINTER_VIEW[facing], pose };
  if (key.facing === 'mid') return { view: MID_TURN_VIEW[facing], pose };
  return { view: TURNED_VIEW[facing].view, pose };
}

// ── Hurt ─────────────────────────────────────────────────────────────────────

const HURT_RECOIL: readonly number[] = [0.6, 1, 0.8, 0.5, 0.22, 0.06];
/** The head snaps back first and leads the body's recovery. */
const HURT_HEAD: readonly number[] = [1, 0.85, 0.5, 0.25, 0.08, 0];
const HURT_LEAN = deg(-22);
const HURT_WINCE_RECOIL = 0.6;
const HURT_GRIT_RECOIL = 0.2;
const HURT_PUSH = 0.07;
/** His knees give a little under the blow. */
const HURT_SAG = 0.06;
/** The blow throws his fists up in front of his face, elbows tucked. */
const HURT_COVER_HEIGHT = 0.96;
const HURT_COVER_ACROSS = 0.09;
const HURT_COVER_FORWARD = 0.13;
const HURT_ROLL = deg(13);
const HURT_TWIST = deg(-12);
const HURT_HEAD_SNAP = 0.05;

function hurtArm(side: Side, r: number): ArmPose {
  const guard = guardArm(side, 0);
  if (guard.kind !== 'reach') return guard;
  const w = guard.wrist;
  const cover = v3(sideSign(side) * HURT_COVER_ACROSS, -HURT_COVER_HEIGHT, HURT_COVER_FORWARD);
  return { kind: 'reach', wrist: lerpV3(w, cover, r), pole: v3(sideSign(side) * 0.4, 1, -0.2) };
}

function hurtPose(frame: number): MaxxPose {
  const r = HURT_RECOIL[frame];
  const base = idlePose(0.5 / IDLE_BOUNCES);
  // His face follows the recoil: eyes shut through the worst of it, gritted
  // while he rights himself, and back to the grin once he has.
  const face: FaceState =
    r >= HURT_WINCE_RECOIL
      ? { mouth: 'ouch', eyes: 'shut', brow: -1 }
      : r >= HURT_GRIT_RECOIL
        ? { mouth: 'grit', eyes: 'squint', brow: -0.5 }
        : GRIN;
  return {
    ...base,
    pelvis: v3(0, base.pelvis.y + HURT_SAG * r, -HURT_PUSH * r),
    lean: lerp(IDLE_LEAN, HURT_LEAN, r),
    roll: HURT_ROLL * r,
    twist: HURT_TWIST * r,
    headNod: -HURT_HEAD_SNAP * HURT_HEAD[frame],
    headTilt: HURT_HEAD_SNAP * HURT_HEAD[frame],
    arms: { right: hurtArm('right', r), left: hurtArm('left', r) },
    face,
    sparks: [],
  };
}

// ── Death ────────────────────────────────────────────────────────────────────

/** How far toward lying each frame is, 0 upright to 1 flat. */
const DEATH_FALL: readonly number[] = [0, 0, 0, 0.06, 0.2, 0.45, 0.75, 1, 0.94, 1, 1, 1];
/** How far his knees have given way on each frame before he goes over. */
const DEATH_BUCKLE: readonly number[] = [0, 0.05, 0.1, 0.16, 0.12, 0.06, 0.02, 0, 0, 0, 0, 0];
/** His lean on the staggering frames: rocked back, pitched forward, back again. */
const DEATH_LEAN: readonly number[] = [-22, -10, 12, -4, -8, -8, -8, -8, -8, -8, -8, -8];
/** Where his hips sway along his facing while he staggers. */
const DEATH_STAGGER: readonly number[] = [-0.04, -0.07, 0.02, -0.01, 0, 0, 0, 0, 0, 0, 0, 0];
/** How far the feet slide out as he goes over, so the corpse lies on his own tile. */
const DEATH_SLIDE = 0.55;
const DEATH_TWITCH_FRAME = 10;
const DEATH_TWITCH = 0.09;
/** The frame his back hits the floor, and the dust it raises. */
const DEATH_LANDING_FRAME = 7;
const DEATH_DUST_FRAMES = 3;
/** Where along his fallen body the dust rises from, from where his feet began. */
const DEATH_DUST_ALONG = 0.62;
/** Wide enough that the puffs show round a body lying on top of them. */
const DEATH_DUST_SPREAD = 0.95;

/**
 * How each arm lies on the floor, seen from above: flung out unevenly with
 * the elbows bent, never a matched cross. Edge-on, arms flung out to the sides
 * would lie across his own face, so there they flop down along his flanks.
 */
const CORPSE_ARMS: Readonly<Record<MaxxFacing, Readonly<Record<Side, ArmAngles>>>> = {
  front: {
    right: {
      kind: 'angles',
      upperSwing: deg(-8),
      upperAbduct: deg(58),
      foreSwing: deg(-4),
      foreAbduct: deg(100),
    },
    left: {
      kind: 'angles',
      upperSwing: deg(6),
      upperAbduct: deg(118),
      foreSwing: deg(10),
      foreAbduct: deg(150),
    },
  },
  away: {
    right: {
      kind: 'angles',
      upperSwing: deg(6),
      upperAbduct: deg(112),
      foreSwing: deg(10),
      foreAbduct: deg(145),
    },
    left: {
      kind: 'angles',
      upperSwing: deg(-8),
      upperAbduct: deg(62),
      foreSwing: deg(-4),
      foreAbduct: deg(96),
    },
  },
  side: {
    right: {
      kind: 'angles',
      upperSwing: deg(-10),
      upperAbduct: deg(12),
      foreSwing: deg(-5),
      foreAbduct: deg(20),
    },
    left: {
      kind: 'angles',
      upperSwing: deg(-6),
      upperAbduct: deg(10),
      foreSwing: deg(15),
      foreAbduct: deg(18),
    },
  },
};
/** One knee drawn up, the other leg out straight. */
const CORPSE_BENT_FOOT_LIFT = 0.13;
const CORPSE_FOOT_SPREAD = 0.17;

function blendArm(from: ArmPose, to: ArmAngles, t: number): ArmPose {
  if (from.kind !== 'angles') return t < 0.5 ? from : to;
  return {
    kind: 'angles',
    upperSwing: lerp(from.upperSwing, to.upperSwing, t),
    upperAbduct: lerp(from.upperAbduct, to.upperAbduct, t),
    foreSwing: lerp(from.foreSwing, to.foreSwing, t),
    foreAbduct: lerp(from.foreAbduct, to.foreAbduct, t),
  };
}

function deathPose(facing: MaxxFacing, frame: number): MaxxPose {
  const fall = DEATH_FALL[frame];
  const base = idlePose(0.5 / IDLE_BOUNCES);
  const limp = easeInOut(fall);
  // The first frame is the blow itself: the same cover-up the hurt row peaks on.
  const hit = frame === 0;
  const dropping = restArm();
  const arms: Record<Side, ArmPose> = hit
    ? { right: hurtArm('right', 1), left: hurtArm('left', 1) }
    : {
        right: blendArm(dropping, CORPSE_ARMS[facing].right, limp),
        left: blendArm(dropping, CORPSE_ARMS[facing].left, limp),
      };
  // One last twitch of a foot before the corpse is still.
  const twitch = frame === DEATH_TWITCH_FRAME ? DEATH_TWITCH : 0;
  const legs: Record<Side, LegPose> = {
    right: {
      ball: v3(
        lerp(IDLE_FOOT_SPREAD, CORPSE_FOOT_SPREAD, limp),
        -CORPSE_BENT_FOOT_LIFT * limp,
        IDLE_FOOT_FORWARD + twitch,
      ),
      heelLift: lerp(deg(10), deg(-20), limp),
    },
    left: {
      ball: v3(lerp(-IDLE_FOOT_SPREAD, -CORPSE_FOOT_SPREAD * 0.8, limp), 0, IDLE_FOOT_FORWARD),
      heelLift: lerp(deg(10), 0, limp),
    },
  };
  const face: FaceState = hit
    ? { mouth: 'ouch', eyes: 'shut', brow: -1 }
    : frame < DEATH_LANDING_FRAME
      ? { mouth: 'ouch', eyes: 'cross', brow: 0.5 }
      : { mouth: 'dead', eyes: 'cross', brow: 0 };
  const direction = facing === 'away' ? 1 : -1;
  const dust: Dust[] =
    frame >= DEATH_LANDING_FRAME && frame < DEATH_LANDING_FRAME + DEATH_DUST_FRAMES
      ? [
          {
            at: { x: direction * DEATH_DUST_ALONG, y: 0 },
            progress: (frame - DEATH_LANDING_FRAME) / DEATH_DUST_FRAMES,
            spread: DEATH_DUST_SPREAD,
          },
        ]
      : [];
  return {
    ...base,
    pelvis: v3(0, -HIP_HEIGHT + DEATH_BUCKLE[frame], DEATH_STAGGER[frame]),
    lean: deg(DEATH_LEAN[frame]),
    headNod: hit ? -HURT_HEAD_SNAP : 0,
    arms,
    legs,
    face,
    screenRoll: direction * (Math.PI / 2) * fall,
    offset: { x: -direction * DEATH_SLIDE * fall, y: 0 },
    shadowStretch: fall,
    dust,
    sparks: [],
  };
}

// ── The row table ────────────────────────────────────────────────────────────

export const MAXX_ROWS: readonly MaxxRow[] = [
  {
    base: 'idle',
    cell: 'body',
    frameCount: MAXX_IDLE_FRAMES,
    kind: 'loop',
    frame: (facing, f) => inView(facing, idlePose(cyclePhase(f, MAXX_IDLE_FRAMES))),
  },
  {
    base: 'walk',
    cell: 'body',
    frameCount: MAXX_WALK_FRAMES,
    kind: 'loop',
    frame: (facing, f) => inView(facing, walkPose(cyclePhase(f, MAXX_WALK_FRAMES))),
  },
  {
    base: 'jab_left',
    cell: 'body',
    frameCount: MAXX_JAB_FRAMES,
    kind: 'oneShot',
    frame: (facing, f) => inView(facing, jabPose(facing, 'left', f)),
  },
  {
    base: 'jab_right',
    cell: 'body',
    frameCount: MAXX_JAB_FRAMES,
    kind: 'oneShot',
    frame: (facing, f) => inView(facing, jabPose(facing, 'right', f)),
  },
  {
    base: 'crush',
    cell: 'finisher',
    frameCount: MAXX_CRUSH_FRAMES,
    kind: 'oneShot',
    frame: crushFrame,
  },
  {
    base: 'hurt',
    cell: 'body',
    frameCount: MAXX_HURT_FRAMES,
    kind: 'oneShot',
    frame: (facing, f) => inView(facing, hurtPose(f)),
  },
  {
    base: 'death',
    cell: 'finisher',
    frameCount: MAXX_DEATH_FRAMES,
    kind: 'oneShot',
    frame: (facing, f) => inView(facing, deathPose(facing, f)),
  },
];

/** The impact frame of every attack row, for the gates. */
export const MAXX_IMPACT_FRAMES: ReadonlyMap<MaxxRowBase, number> = new Map<MaxxRowBase, number>([
  ['jab_left', MAXX_JAB_IMPACT_FRAME],
  ['jab_right', MAXX_JAB_IMPACT_FRAME],
  ['crush', MAXX_CRUSH_IMPACT_FRAME],
]);

interface StateEntry {
  readonly row: MaxxRow;
  readonly facing: MaxxFacing;
}

const STATE_TABLE: ReadonlyMap<string, StateEntry> = new Map(
  MAXX_ROWS.flatMap((row) =>
    MAXX_FACINGS.map((facing): [string, StateEntry] => [
      maxxStateName(row.base, facing),
      { row, facing },
    ]),
  ),
);

/** The painted frame a state and frame index name, or null for an unknown state. */
export function maxxFrameOf(state: string, frame: number): MaxxFrame | null {
  const entry = STATE_TABLE.get(state);
  if (entry === undefined) return null;
  const clamped = Math.min(Math.max(0, Math.floor(frame)), entry.row.frameCount - 1);
  return entry.row.frame(entry.facing, clamped);
}

function paintMaxxFrame(
  cell: MaxxCellGeometry,
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
): void {
  const painted = maxxFrameOf(state, frame);
  if (painted === null) throw new Error(`gluteus_maxx paints no state "${state}"`);
  const origin = maxxOrigin(cell);
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  drawMaxx(ctx, painted.view, painted.pose);
  ctx.restore();
}

function stateFrames(cell: MaxxCell): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const [name, entry] of STATE_TABLE) {
    if (entry.row.cell === cell) frames[name] = entry.row.frameCount;
  }
  return frames;
}

function figureOf(id: string, cell: MaxxCell): FigureDef {
  const geometry = MAXX_CELLS[cell];
  return {
    id,
    frameWidth: geometry.frameWidth,
    frameHeight: geometry.frameHeight,
    tileX: tileXOf(geometry),
    tileY: tileYOf(geometry),
    tileScale: TILE_SCALE,
    states: figureStates(stateFrames(cell)),
    paintFrame: (ctx, state, frame) => {
      paintMaxxFrame(geometry, ctx, state, frame);
    },
  };
}

/** Standing, walking, jabbing and flinching. */
export const GLUTEUS_MAXX_FIGURE: FigureDef = figureOf('gluteus_maxx', 'body');
/** The crush and the death, which need room to travel and to lie down. */
export const GLUTEUS_MAXX_FINISHER_FIGURE: FigureDef = figureOf(
  'gluteus_maxx_finisher',
  'finisher',
);

export const GLUTEUS_MAXX_FIGURES: Readonly<Record<MaxxCell, FigureDef>> = {
  body: GLUTEUS_MAXX_FIGURE,
  finisher: GLUTEUS_MAXX_FINISHER_FIGURE,
};

/** The figure that paints a row. */
export function maxxFigureFor(base: MaxxRowBase): FigureDef {
  const row = MAXX_ROWS.find((candidate) => candidate.base === base);
  if (row === undefined) throw new Error(`gluteus_maxx has no row "${base}"`);
  return GLUTEUS_MAXX_FIGURES[row.cell];
}

/** The figure that paints a state name, or null for a state neither paints. */
export function maxxFigureOfState(state: string): FigureDef | null {
  const entry = STATE_TABLE.get(state);
  return entry === undefined ? null : GLUTEUS_MAXX_FIGURES[entry.row.cell];
}
