/** The Mold Lion figure. Profile only; the runtime mirrors it to face left. */

import { clamp01, deg, easeInOut, hump, lerp } from './carlArt';
import { type LionPose, type PawPose, drawMoldLionSide, restLionPose, TWO_PI } from './moldLionArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/** Wide for the pounce and tail, tall for the mane's fruiting bodies. */
const FRAME_WIDTH = 144;
const FRAME_HEIGHT = 112;
const TILE_X = 40;
const TILE_Y = 36;

const POSE_ORIGIN_X = TILE_X + TILE_SCALE / 2;
const POSE_ORIGIN_Y = TILE_Y + TILE_SCALE / 2;

export const IDLE_FRAMES = 8;
export const WALK_FRAMES = 8;
export const ATTACK_FRAMES = 10;

const BLINK_HOLD = 0.07;

function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 0.5 + 1) % 1) - 0.5);
  return distance < BLINK_HOLD ? clamp01(distance / BLINK_HOLD) : 1;
}

/** Under a half so a walking cat keeps three paws down. */
const SWING_SHARE = 0.36;

function gaitPaw(phase: number, reach: number, height: number): PawPose {
  const cycle = ((phase % 1) + 1) % 1;
  const swinging = cycle < SWING_SHARE;
  const t = swinging ? cycle / SWING_SHARE : (cycle - SWING_SHARE) / (1 - SWING_SHARE);
  const dx = swinging ? lerp(-reach, reach, easeInOut(t)) : lerp(reach, -reach, t);
  return { dx, lift: swinging ? hump(t) * height : 0 };
}

const IDLE_TAIL_SWING = 0.8;
const IDLE_HEAD_BOB = 0.008;
const IDLE_BLINK_AT = 0.62;

function idlePose(frame: number): LionPose {
  const phase = frame / IDLE_FRAMES;
  const angle = phase * TWO_PI;
  return {
    ...restLionPose(),
    breathe: Math.sin(angle),
    bodyY: -0.004 * Math.sin(angle),
    headY: IDLE_HEAD_BOB * Math.sin(angle - Math.PI / 3),
    headPitch: deg(2) * Math.sin(angle * 2),
    tailSwing: IDLE_TAIL_SWING * Math.sin(angle),
    tailLift: 0.3 + 0.15 * Math.sin(angle + 1),
    maneSwell: 0.5 + 0.5 * Math.sin(angle),
    eyeOpen: blink(phase, IDLE_BLINK_AT),
    sporePhase: phase,
  };
}

const WALK_REACH = 0.085;
const WALK_LIFT_FORE = 0.075;
const WALK_LIFT_HIND = 0.06;
const WALK_BOB = 0.012;
const WALK_HEAD_DROP = 0.02;
const WALK_HEAD_NOD = 0.01;

function walkPose(frame: number): LionPose {
  const phase = frame / WALK_FRAMES;
  const angle = phase * TWO_PI;
  return {
    ...restLionPose(),
    bodyY: -WALK_BOB * Math.cos(angle * 2),
    pitch: deg(1.2) * Math.sin(angle),
    headY: WALK_HEAD_DROP + WALK_HEAD_NOD * Math.cos(angle * 2 + 0.6),
    headPitch: deg(4) + deg(2) * Math.sin(angle * 2),
    hindNear: gaitPaw(phase, WALK_REACH, WALK_LIFT_HIND),
    foreNear: gaitPaw(phase - 0.25, WALK_REACH, WALK_LIFT_FORE),
    hindFar: gaitPaw(phase - 0.5, WALK_REACH, WALK_LIFT_HIND),
    foreFar: gaitPaw(phase - 0.75, WALK_REACH, WALK_LIFT_FORE),
    breathe: Math.sin(angle * 2),
    tailSwing: Math.sin(angle + 0.5),
    tailLift: 0.25 + 0.1 * Math.sin(angle),
    maneSwell: 0.5 + 0.3 * Math.sin(angle),
    sporePhase: phase,
  };
}

const GATHER_END = 0.3;
const STRIKE_END = 0.6;
const CROUCH_BACK = 0.05;
const CROUCH_DOWN = 0.035;
const LUNGE_FORWARD = 0.14;
const STRIKE_REACH = 0.09;
const STRIKE_RAISE = 0.14;

function attackPose(frame: number): LionPose {
  const t = frame / (ATTACK_FRAMES - 1);
  const gather = easeInOut(clamp01(t / GATHER_END));
  const strike = easeInOut(clamp01((t - GATHER_END) / (STRIKE_END - GATHER_END)));
  const recover = easeInOut(clamp01((t - STRIKE_END) / (1 - STRIKE_END)));
  const out = strike * (1 - recover);
  const coiled = gather * (1 - strike);
  const rest = restLionPose();
  const pawStrike = hump(clamp01((t - GATHER_END) / (1 - GATHER_END)));
  return {
    ...rest,
    bodyX: -CROUCH_BACK * coiled + LUNGE_FORWARD * out,
    bodyY: CROUCH_DOWN * coiled - 0.02 * out,
    pitch: deg(6) * coiled - deg(7) * out,
    headX: 0.02 * out,
    headY: 0.015 * coiled - 0.01 * out,
    headPitch: deg(3) * coiled - deg(14) * out,
    jawOpen: clamp01(gather * 0.4 + out),
    foreNear: {
      dx: -LUNGE_FORWARD * out + CROUCH_BACK * coiled,
      lift: STRIKE_RAISE * pawStrike,
      strike: STRIKE_REACH * pawStrike,
    },
    foreFar: { dx: -LUNGE_FORWARD * out * 0.5 + CROUCH_BACK * coiled, lift: 0 },
    hindNear: { dx: CROUCH_BACK * coiled - LUNGE_FORWARD * out * 0.9, lift: 0 },
    hindFar: { dx: CROUCH_BACK * coiled - LUNGE_FORWARD * out, lift: 0 },
    tailSwing: -0.8 * coiled + 0.9 * out,
    tailLift: 0.3 + 0.5 * out,
    maneSwell: 0.5 + 0.5 * out,
    eyeOpen: 1,
    sporePhase: t,
  };
}

const POSES: ReadonlyMap<string, (frame: number) => LionPose> = new Map([
  ['idle', idlePose],
  ['walk', walkPose],
  ['attack', attackPose],
]);

function paintFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const poseOf = POSES.get(state);
  if (poseOf === undefined) return;
  ctx.save();
  try {
    ctx.translate(POSE_ORIGIN_X, POSE_ORIGIN_Y);
    ctx.scale(TILE_SCALE, TILE_SCALE);
    drawMoldLionSide(ctx, poseOf(frame));
  } finally {
    ctx.restore();
  }
}

export const MOLD_LION_FIGURE: FigureDef = {
  id: 'mold_lion',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates({ idle: IDLE_FRAMES, walk: WALK_FRAMES, attack: ATTACK_FRAMES }),
  paintFrame,
};
