/**
 * The Former Circus Lemur as a painted figure: the choreography, the cell
 * geometry and the `FigureDef` the runtime cache and the review harness both
 * draw through. Anatomy and palette live in `circusLemurArt.ts`.
 *
 * Rows (profile only — the creature mirrors left and right):
 *    idle   — a standing breath, tail swaying
 *    walk   — a skittering half-bound: hind pair, then fore pair
 *    attack — the nip: crouch, lunge with the jaws open, recover
 *    throw  — the old knife act: rear up, wind the knife back, whip it forward
 *
 *   npm run render:circus-lemur
 */

import {
  ANKLE_HEIGHT,
  FAR_LIMB_OFFSET,
  FORE_WRIST_REST_DX,
  GROUND_Y,
  HIND_ANKLE_REST_DX,
  REST_HIP,
  REST_PITCH,
  SPINE_LENGTH,
  WRIST_HEIGHT,
  drawLemurSide,
  restLemurPose,
  type LemurPose,
  type LimbTarget,
} from './circusLemurArt';
import { TWO_PI, clamp01, easeInOut, hump, lerp } from './ratArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

export const LEMUR_IDLE_FRAMES = 4;
export const LEMUR_WALK_FRAMES = 8;
export const LEMUR_ATTACK_FRAMES = 6;
export const LEMUR_THROW_FRAMES = 8;

/** How much of the tile the animal fills, scaled about its ground line. */
const LEMUR_SCALE = 0.92;

// ── Idle ─────────────────────────────────────────────────────────────────────

const IDLE_TAIL_SWAY = 0.12;
const IDLE_HEAD_NOD = 0.06;

function idlePose(phase: number): LemurPose {
  const rest = restLemurPose();
  const wave = Math.sin(phase * TWO_PI);
  return {
    ...rest,
    breathe: (wave + 1) / 2,
    headTilt: wave * IDLE_HEAD_NOD,
    tailSway: IDLE_TAIL_SWAY,
    tailPhase: phase,
  };
}

// ── Walk ─────────────────────────────────────────────────────────────────────

const STRIDE = 0.26;
/** Fraction of a leg's cycle spent on the ground. */
const STANCE_SHARE = 0.6;
const FOOT_LIFT = 0.07;
const BOUND_BOB = 0.016;
const BOUND_PITCH = 0.07;
const WALK_TAIL_SWAY = 0.2;
/** Each leg's offset into the cycle: a half-bound, hind pair then fore pair. */
const HIND_NEAR_PHASE = 0;
const HIND_FAR_PHASE = 0.1;
const FORE_NEAR_PHASE = 0.5;
const FORE_FAR_PHASE = 0.6;

function steppingTarget(restX: number, height: number, phase: number): LimbTarget {
  const q = ((phase % 1) + 1) % 1;
  if (q < STANCE_SHARE) {
    const t = q / STANCE_SHARE;
    return { x: restX + lerp(STRIDE / 2, -STRIDE / 2, t), y: GROUND_Y - height, lift: 0 };
  }
  const t = (q - STANCE_SHARE) / (1 - STANCE_SHARE);
  const lift = hump(t);
  return {
    x: restX + lerp(-STRIDE / 2, STRIDE / 2, easeInOut(t)),
    y: GROUND_Y - height - lift * FOOT_LIFT,
    lift,
  };
}

function walkPose(phase: number): LemurPose {
  const rest = restLemurPose();
  // Two lifts a cycle — one off the hind push, one off the fore — and the
  // rump rises as the hind pair drives.
  const bob = Math.sin(phase * TWO_PI * 2) * BOUND_BOB;
  const rock = Math.sin(phase * TWO_PI) * BOUND_PITCH;
  const hip = { x: REST_HIP.x, y: REST_HIP.y - Math.abs(bob) };
  const hindRest = REST_HIP.x + HIND_ANKLE_REST_DX;
  const foreRest = REST_HIP.x + FORE_WRIST_REST_DX;
  return {
    ...rest,
    hip,
    pitch: REST_PITCH + rock,
    headTilt: -rock * 0.6,
    hindNear: steppingTarget(hindRest, ANKLE_HEIGHT, phase + HIND_NEAR_PHASE),
    hindFar: steppingTarget(hindRest + FAR_LIMB_OFFSET.x, ANKLE_HEIGHT, phase + HIND_FAR_PHASE),
    foreNear: steppingTarget(foreRest, WRIST_HEIGHT, phase + FORE_NEAR_PHASE),
    foreFar: steppingTarget(foreRest + FAR_LIMB_OFFSET.x, WRIST_HEIGHT, phase + FORE_FAR_PHASE),
    tailSway: WALK_TAIL_SWAY,
    tailPhase: phase,
  };
}

// ── Nip ──────────────────────────────────────────────────────────────────────

const NIP_CROUCH_END = 0.3;
const NIP_STRIKE_END = 0.6;
const NIP_CROUCH_DROP = 0.025;
const NIP_LUNGE = 0.07;
const NIP_LUNGE_PITCH = 0.18;
const NIP_HEAD_DIP = 0.2;

function nipPose(t: number): LemurPose {
  const rest = restLemurPose();
  const crouch =
    easeInOut(t / NIP_CROUCH_END) * (1 - easeInOut((t - NIP_CROUCH_END) / NIP_CROUCH_END));
  const strike =
    easeInOut((t - NIP_CROUCH_END) / (NIP_STRIKE_END - NIP_CROUCH_END)) *
    (1 - easeInOut((t - NIP_STRIKE_END) / (1 - NIP_STRIKE_END)));
  return {
    ...rest,
    hip: {
      x: REST_HIP.x - crouch * NIP_LUNGE * 0.3 + strike * NIP_LUNGE,
      y: REST_HIP.y + crouch * NIP_CROUCH_DROP,
    },
    pitch: REST_PITCH + strike * NIP_LUNGE_PITCH,
    headTilt: -crouch * NIP_HEAD_DIP + strike * NIP_HEAD_DIP,
    jaw: clamp01(crouch * 0.4 + strike),
    earsBack: clamp01(crouch + strike),
    tailSway: WALK_TAIL_SWAY,
    tailPhase: t,
  };
}

// ── Knife throw ──────────────────────────────────────────────────────────────

/** The knife comes off the hip once the arm has started back, not while it hangs. */
const KNIFE_DRAWN = 0.12;
const REAR_END = 0.3;
const RELEASE = 0.5;
const SETTLE_START = 0.72;
const REAR_PITCH = -1.0;
const REAR_HIP_BACK = 0.05;
const REAR_HIP_DROP = 0.03;
/** The throwing arm starts hanging down-forward, where a walking forelimb is. */
const ARM_START_ANGLE = 0.9;
const WINDUP_ANGLE = -1.9;
const WINDUP_ELBOW = -0.9;
const RELEASE_ANGLE = -0.15;
const RELEASE_ELBOW = 0.05;
const FOLLOW_ANGLE = 0.55;
const FOLLOW_ELBOW = 0.25;
/** Where the free hand tucks against the chest while the lemur rears, from the shoulder. */
const TUCKED_HAND = { dx: 0.07, dy: 0.15 };

function throwPose(t: number): LemurPose {
  const rest = restLemurPose();
  const rear = easeInOut(t / REAR_END) * (1 - easeInOut((t - SETTLE_START) / (1 - SETTLE_START)));
  const hip = { x: REST_HIP.x - rear * REAR_HIP_BACK, y: REST_HIP.y + rear * REAR_HIP_DROP };
  const pitch = lerp(REST_PITCH, REAR_PITCH, rear);

  let shoulderAngle: number;
  let elbowBend: number;
  if (t < RELEASE) {
    const windup = easeInOut(t / REAR_END);
    const whip = easeInOut((t - REAR_END) / (RELEASE - REAR_END));
    // The arm draws back and up behind the body, not up across the face: the
    // windup angle is approached from the far side of the circle.
    const raised = lerp(ARM_START_ANGLE, WINDUP_ANGLE + TWO_PI, windup);
    shoulderAngle = lerp(raised - TWO_PI, RELEASE_ANGLE, whip);
    elbowBend = lerp(lerp(0, WINDUP_ELBOW, windup), RELEASE_ELBOW, whip);
  } else {
    const follow = easeInOut((t - RELEASE) / (1 - RELEASE));
    shoulderAngle = lerp(RELEASE_ANGLE, FOLLOW_ANGLE, follow);
    elbowBend = lerp(RELEASE_ELBOW, FOLLOW_ELBOW, follow);
  }

  const shoulder = {
    x: hip.x + Math.cos(pitch) * SPINE_LENGTH,
    y: hip.y + Math.sin(pitch) * SPINE_LENGTH,
  };
  const tucked: LimbTarget = {
    x: lerp(rest.foreFar.x, shoulder.x + TUCKED_HAND.dx, rear),
    y: lerp(rest.foreFar.y, shoulder.y + TUCKED_HAND.dy, rear),
    lift: rear,
  };
  return {
    ...rest,
    hip,
    pitch,
    headTilt: -pitch * 0.35,
    foreFar: tucked,
    foreNear: tucked,
    throwArm: { shoulderAngle, elbowBend, holdingKnife: t >= KNIFE_DRAWN && t < RELEASE },
    jaw: hump(clamp01((t - REAR_END) / (SETTLE_START - REAR_END))) * 0.5,
    tailSway: WALK_TAIL_SWAY,
    tailPhase: t,
  };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly pose: (frame: number) => LemurPose;
}

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

export const LEMUR_ROWS: readonly RowSpec[] = [
  {
    name: 'idle',
    frameCount: LEMUR_IDLE_FRAMES,
    pose: (f) => idlePose(cyclePhase(f, LEMUR_IDLE_FRAMES)),
  },
  {
    name: 'walk',
    frameCount: LEMUR_WALK_FRAMES,
    pose: (f) => walkPose(cyclePhase(f, LEMUR_WALK_FRAMES)),
  },
  {
    name: 'attack',
    frameCount: LEMUR_ATTACK_FRAMES,
    pose: (f) => nipPose(shotProgress(f, LEMUR_ATTACK_FRAMES)),
  },
  {
    name: 'throw',
    frameCount: LEMUR_THROW_FRAMES,
    pose: (f) => throwPose(shotProgress(f, LEMUR_THROW_FRAMES)),
  },
];

/**
 * The cell the poses are painted into, and where the lemur's own tile sits in
 * it. Measured from the tallest pose (the reared throw, tail and all) plus
 * padding; `render-circus-lemur.ts` re-checks that nothing touches the edge.
 */
const CELL = { frameWidth: 82, frameHeight: 78, tileX: 12, tileY: 15 };

function paintLemurFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = LEMUR_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) return;
  ctx.save();
  ctx.translate(CELL.tileX + TILE_SCALE / 2, CELL.tileY + TILE_SCALE / 2);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.translate(0, GROUND_Y);
  ctx.scale(LEMUR_SCALE, LEMUR_SCALE);
  ctx.translate(0, -GROUND_Y);
  drawLemurSide(ctx, row.pose(frame));
  ctx.restore();
}

function stateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of LEMUR_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

export const CIRCUS_LEMUR_FIGURE: FigureDef = {
  id: 'circus_lemur',
  frameWidth: CELL.frameWidth,
  frameHeight: CELL.frameHeight,
  tileX: CELL.tileX,
  tileY: CELL.tileY,
  tileScale: TILE_SCALE,
  states: figureStates(stateFrames()),
  paintFrame: paintLemurFrame,
};
