// Rows are painted in profile only; the runtime mirrors them.

import { clamp01, easeInOut, easeOut, hump, lerp, type Pt } from './carlArt';
import {
  FORE_FAR_REST,
  FORE_NEAR_REST,
  FORE_TOE_LOCAL,
  HEATHER_GROUND_Y,
  HEATHER_REST_HIP,
  HIND_FAR_REST,
  HIND_NEAR_REST,
  HIND_TOE_LOCAL,
  HEATHER_SHOULDER_LOCAL,
  drawHeatherBear,
  type FootPlacement,
  type HeatherPose,
} from './heatherBearArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;
const MID_FRAME = 0.5;

export const HEATHER_TILE_SCALE = 64;
/** Tall enough for the full rear with paws overhead. */
const FRAME_WIDTH = 208;
const FRAME_HEIGHT = 176;
const TILE_X = (FRAME_WIDTH - HEATHER_TILE_SCALE) / 2;
const TILE_Y = 96;
const ORIGIN_X = TILE_X + HEATHER_TILE_SCALE / 2;
const ORIGIN_Y = TILE_Y + HEATHER_TILE_SCALE / 2;

export const HEATHER_WALK_FRAMES = 12;
export const HEATHER_IDLE_FRAMES = 12;
export const HEATHER_ATTACK_FRAMES = 14;

/** The walk advances by distance moved at this rate, so planted feet do not slide. */
export const HEATHER_TILES_PER_WALK_CYCLE = 0.9;
export const HEATHER_IDLE_TICKS_PER_FRAME = 6;
/** Must match the creature's `attackAnim` split, where 0.5 is the top of the rear. */
export const HEATHER_ATTACK_WINDUP_SHARE = 0.5;

function flat(at: Pt): FootPlacement {
  return { x: at.x, y: at.y, angle: 0 };
}

function restPose(): HeatherPose {
  return {
    hip: HEATHER_REST_HIP,
    pitch: 0,
    neck: 0,
    jaw: 0,
    foreNear: flat(FORE_NEAR_REST),
    foreFar: flat(FORE_FAR_REST),
    hindNear: flat(HIND_NEAR_REST),
    hindFar: flat(HIND_FAR_REST),
    breathe: 0,
    wormPhase: 0,
    swipeTrail: 0,
    swipeFrom: 0,
  };
}

const WALK_DUTY = 0.66;
const STRIKE_HIND_NEAR = 0;
const STRIKE_FORE_NEAR = 0.16;
const STRIKE_HIND_FAR = 0.5;
const STRIKE_FORE_FAR = 0.66;
const CONTACT_SPAN = HEATHER_TILES_PER_WALK_CYCLE * WALK_DUTY;
const ROLL_FROM = 0.68;
const FORE_ROLL = 0.55;
const HIND_ROLL = 0.6;
const FORE_LIFT = 0.13;
const HIND_LIFT = 0.08;
const FORE_CURL = 0.8;
const FORE_REACH = -0.2;
const HIND_HANG = 0.35;
const HIND_REACH = -0.1;
const CURL_PEAK = 0.35;
const REACH_AT = 0.85;

const DIPS_PER_CYCLE = 2;
const WALK_BOB = 0.014;
const WALK_ROLL = 0.03;
const WALK_NECK = 0.1;
const WALK_NOD = 0.07;
const WALK_NOD_LAG = 0.12;
const WORM_WRITHES_PER_LOOP = 2;

function rotate(p: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function rolledOver(toe: Pt, toeLocal: Pt, angle: number): Pt {
  const r = rotate(toeLocal, angle);
  return { x: toe.x - r.x, y: toe.y - r.y };
}

function swingAngle(v: number, start: number, curl: number, reach: number): number {
  if (v < CURL_PEAK) return lerp(start, curl, easeOut(v / CURL_PEAK));
  if (v < REACH_AT) return lerp(curl, reach, easeInOut((v - CURL_PEAK) / (REACH_AT - CURL_PEAK)));
  return lerp(reach, 0, easeInOut((v - REACH_AT) / (1 - REACH_AT)));
}

function walkFoot(t: number, strike: number, rest: Pt, isFore: boolean): FootPlacement {
  const phase = (((t - strike) % 1) + 1) % 1;
  const toeLocal = isFore ? FORE_TOE_LOCAL : HIND_TOE_LOCAL;
  const roll = isFore ? FORE_ROLL : HIND_ROLL;
  const half = CONTACT_SPAN / 2;
  const plantX = rest.x + half;
  const liftX = rest.x - half;
  if (phase < WALK_DUTY) {
    const u = phase / WALK_DUTY;
    const x = lerp(plantX, liftX, u);
    const angle = u > ROLL_FROM ? roll * easeInOut((u - ROLL_FROM) / (1 - ROLL_FROM)) : 0;
    const toe = { x: x + toeLocal.x, y: HEATHER_GROUND_Y };
    const ankle = rolledOver(toe, toeLocal, angle);
    return { x: ankle.x, y: ankle.y, angle };
  }
  const v = (phase - WALK_DUTY) / (1 - WALK_DUTY);
  const rolled = rolledOver({ x: liftX + toeLocal.x, y: HEATHER_GROUND_Y }, toeLocal, roll);
  const along = easeInOut(v);
  const lift = Math.sin(v * Math.PI) * (isFore ? FORE_LIFT : HIND_LIFT);
  return {
    x: lerp(rolled.x, plantX, along),
    y: lerp(rolled.y, rest.y, along) - lift,
    angle: isFore
      ? swingAngle(v, roll, FORE_CURL, FORE_REACH)
      : swingAngle(v, roll, HIND_HANG, HIND_REACH),
  };
}

export function walkPose(frame: number): HeatherPose {
  const t = (frame + MID_FRAME) / HEATHER_WALK_FRAMES;
  const rest = restPose();
  const bob = Math.cos(t * TWO_PI * DIPS_PER_CYCLE) * WALK_BOB;
  return {
    ...rest,
    hip: { x: rest.hip.x, y: rest.hip.y + bob },
    pitch: Math.sin((t - STRIKE_FORE_NEAR) * TWO_PI) * WALK_ROLL,
    neck:
      WALK_NECK +
      Math.sin((t - STRIKE_FORE_NEAR - WALK_NOD_LAG) * TWO_PI * DIPS_PER_CYCLE) * WALK_NOD,
    foreNear: walkFoot(t, STRIKE_FORE_NEAR, FORE_NEAR_REST, true),
    foreFar: walkFoot(t, STRIKE_FORE_FAR, FORE_FAR_REST, true),
    hindNear: walkFoot(t, STRIKE_HIND_NEAR, HIND_NEAR_REST, false),
    hindFar: walkFoot(t, STRIKE_HIND_FAR, HIND_FAR_REST, false),
    jaw: 0,
    wormPhase: t * TWO_PI * WORM_WRITHES_PER_LOOP,
  };
}

const IDLE_BOB = 0.008;
const IDLE_PITCH = 0.012;
const IDLE_NECK = 0.16;
const IDLE_SWAY = 0.06;
const IDLE_SWAY_LAG = 0.8;
const IDLE_JAW = 0.08;
const IDLE_PANT = 0.1;
const IDLE_PANT_LAG = 1.5;

function pant01(t: number): number {
  const HALF = 0.5;
  return Math.sin(t * TWO_PI + IDLE_PANT_LAG) * HALF + HALF;
}

export function idlePose(frame: number): HeatherPose {
  const t = (frame + MID_FRAME) / HEATHER_IDLE_FRAMES;
  const breath = Math.sin(t * TWO_PI);
  const rest = restPose();
  return {
    ...rest,
    hip: { x: rest.hip.x, y: rest.hip.y - breath * IDLE_BOB },
    pitch: -breath * IDLE_PITCH,
    neck: IDLE_NECK + Math.sin(t * TWO_PI + IDLE_SWAY_LAG) * IDLE_SWAY,
    jaw: IDLE_JAW + pant01(t) * IDLE_PANT,
    breathe: breath,
    wormPhase: t * TWO_PI * WORM_WRITHES_PER_LOOP,
  };
}

const REAR_PITCH = 1.1;
const REAR_HIP_BACK = 0.06;
const REAR_HIP_RISE = 0.1;
const REAR_NECK = 0.72;
const REAR_JAW_FROM = 0.15;

/** Forearm direction (world radians) and reach from the shoulder; negative `paw` shows the claws. */
interface ArmAim {
  readonly angle: number;
  readonly reach: number;
  readonly paw: number;
}
const NEAR_COCKED: ArmAim = { angle: -2.35, reach: 0.48, paw: -2.2 };
const FAR_RAISED: ArmAim = { angle: -0.45, reach: 0.5, paw: -0.8 };
const NEAR_STRUCK: ArmAim = { angle: 1.15, reach: 0.56, paw: 0.6 };
const FAR_STRUCK: ArmAim = { angle: 1.35, reach: 0.52, paw: 0.2 };
const STRIKE_PLANT_AHEAD = 0.16;
const PLANT_FROM = 0.62;
const SWIPE_NECK_DRIVE = 0.18;
const SWIPE_JAW_CLOSE = 0.75;
const TRAIL_START = -2.2;
const TRAIL_FROM = 0.04;
const TRAIL_TO = 0.7;

function shoulderAt(hip: Pt, pitch: number): Pt {
  const r = rotate(HEATHER_SHOULDER_LOCAL, pitch);
  return { x: hip.x + r.x, y: hip.y + r.y };
}

function restAim(shoulder: Pt, rest: Pt): ArmAim {
  return {
    angle: Math.atan2(rest.y - shoulder.y, rest.x - shoulder.x),
    reach: Math.hypot(rest.y - shoulder.y, rest.x - shoulder.x),
    paw: 0,
  };
}

function lerpAim(a: ArmAim, b: ArmAim, t: number): ArmAim {
  return {
    angle: lerp(a.angle, b.angle, t),
    reach: lerp(a.reach, b.reach, t),
    paw: lerp(a.paw, b.paw, t),
  };
}

function aimed(shoulder: Pt, aim: ArmAim): FootPlacement {
  return {
    x: shoulder.x + Math.cos(aim.angle) * aim.reach,
    y: shoulder.y + Math.sin(aim.angle) * aim.reach,
    angle: aim.paw,
  };
}

function blendFoot(a: FootPlacement, b: FootPlacement, t: number): FootPlacement {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), angle: lerp(a.angle, b.angle, t) };
}

export function attackPose(frame: number): HeatherPose {
  const p = (frame + MID_FRAME) / HEATHER_ATTACK_FRAMES;
  const rest = restPose();
  const restShoulder = shoulderAt(rest.hip, 0);
  const nearRestAim = restAim(restShoulder, FORE_NEAR_REST);
  const farRestAim = restAim(restShoulder, FORE_FAR_REST);

  if (p < HEATHER_ATTACK_WINDUP_SHARE) {
    const w = easeInOut(p / HEATHER_ATTACK_WINDUP_SHARE);
    const hip = { x: rest.hip.x - REAR_HIP_BACK * w, y: rest.hip.y - REAR_HIP_RISE * w };
    const pitch = -REAR_PITCH * w;
    const shoulder = shoulderAt(hip, pitch);
    return {
      ...rest,
      hip,
      pitch,
      neck: REAR_NECK * w,
      jaw: lerp(REAR_JAW_FROM, 1, w),
      foreNear: aimed(shoulder, lerpAim(nearRestAim, NEAR_COCKED, w)),
      foreFar: aimed(shoulder, lerpAim(farRestAim, FAR_RAISED, w)),
      wormPhase: p * TWO_PI * WORM_WRITHES_PER_LOOP,
    };
  }

  const s = (p - HEATHER_ATTACK_WINDUP_SHARE) / (1 - HEATHER_ATTACK_WINDUP_SHARE);
  const fall = easeInOut(s);
  const strike = easeOut(clamp01(s / PLANT_FROM));
  const hip = {
    x: rest.hip.x - REAR_HIP_BACK * (1 - fall),
    y: rest.hip.y - REAR_HIP_RISE * (1 - fall),
  };
  const pitch = -REAR_PITCH * (1 - fall);
  const shoulder = shoulderAt(hip, pitch);
  const plant = easeInOut(clamp01((s - PLANT_FROM) / (1 - PLANT_FROM)));
  const nearSwing = aimed(shoulder, lerpAim(NEAR_COCKED, NEAR_STRUCK, strike));
  const farSwing = aimed(shoulder, lerpAim(FAR_RAISED, FAR_STRUCK, strike));
  const nearPlanted = flat({ x: FORE_NEAR_REST.x + STRIKE_PLANT_AHEAD, y: FORE_NEAR_REST.y });
  const trailWindow = clamp01((s - TRAIL_FROM) / (TRAIL_TO - TRAIL_FROM));
  return {
    ...rest,
    hip,
    pitch,
    neck: REAR_NECK * (1 - fall) + hump(s) * SWIPE_NECK_DRIVE,
    jaw: 1 - SWIPE_JAW_CLOSE * s,
    foreNear: blendFoot(nearSwing, nearPlanted, plant),
    foreFar: blendFoot(farSwing, flat(FORE_FAR_REST), plant),
    wormPhase: p * TWO_PI * WORM_WRITHES_PER_LOOP,
    swipeTrail: s < TRAIL_TO ? hump(trailWindow) : 0,
    swipeFrom: TRAIL_START,
  };
}

export type HeatherAction = 'walk' | 'idle' | 'attack';

export interface HeatherRowSpec {
  readonly name: HeatherAction;
  readonly frameCount: number;
  readonly loops: boolean;
  readonly pose: (frame: number) => HeatherPose;
}

export const HEATHER_ROWS: readonly HeatherRowSpec[] = [
  { name: 'walk', frameCount: HEATHER_WALK_FRAMES, loops: true, pose: walkPose },
  { name: 'idle', frameCount: HEATHER_IDLE_FRAMES, loops: true, pose: idlePose },
  { name: 'attack', frameCount: HEATHER_ATTACK_FRAMES, loops: false, pose: attackPose },
];

function paintHeatherFrame(ctx: Ctx, state: string, frame: number): void {
  const row = HEATHER_ROWS.find((r) => r.name === state);
  if (row === undefined) return;
  ctx.save();
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(HEATHER_TILE_SCALE, HEATHER_TILE_SCALE);
  drawHeatherBear(ctx, row.pose(frame));
  ctx.restore();
}

function heatherStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of HEATHER_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

export const HEATHER_BEAR_FIGURE: FigureDef = {
  id: 'heather_bear',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: HEATHER_TILE_SCALE,
  states: figureStates(heatherStateFrames()),
  paintFrame: paintHeatherFrame,
};
