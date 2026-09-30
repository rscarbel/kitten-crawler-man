/**
 * The goblin mother's and her toddler's choreography, frame counts, playback
 * rates and figure definitions.
 *
 * The mother never walks: she has `idle`, rocking the baby at her chest, and
 * `hurt`, the baby clutched tight while her free arm waves for help. The
 * toddler has `walk`, a waddle home driven by the defend quest's reunion walk,
 * and `idle`, reaching up for her once he is beside her.
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import { hump, lerp } from './carlArt';
import {
  type MotherPose,
  type ToddlerPose,
  drawGoblinMother,
  drawGoblinToddler,
  restingMotherPose,
  restingToddlerPose,
} from './goblinMotherArt';

// ── Rows and timing ──────────────────────────────────────────────────────────

export type MotherRow = 'idle' | 'hurt';
export const MOTHER_ROWS: readonly MotherRow[] = ['idle', 'hurt'];

export type ToddlerRow = 'walk' | 'idle';
export const TODDLER_ROWS: readonly ToddlerRow[] = ['walk', 'idle'];

/** One slow rock of the baby, side to side and back. */
export const MOTHER_IDLE_FRAMES = 12;
/** Two seconds a rock: the pace of a mother soothing, not fidgeting. */
export const MOTHER_IDLE_FPS = 6;
/** One wave of the free arm. */
export const MOTHER_HURT_FRAMES = 8;
/** Quick and ragged: a call for help, well above the rocking's calm pace. */
export const MOTHER_HURT_FPS = 10;

/** One full stride cycle, a step on each foot. */
export const TODDLER_WALK_FRAMES = 8;
/** One bounce of reaching up and back. */
export const TODDLER_IDLE_FRAMES = 8;
export const TODDLER_IDLE_FPS = 7;

const MOTHER_ROW_FRAMES: Readonly<Record<MotherRow, number>> = {
  idle: MOTHER_IDLE_FRAMES,
  hurt: MOTHER_HURT_FRAMES,
};

const TODDLER_ROW_FRAMES: Readonly<Record<ToddlerRow, number>> = {
  walk: TODDLER_WALK_FRAMES,
  idle: TODDLER_IDLE_FRAMES,
};

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Cell pixels per tile. */
export const TILE_SCALE = 64;
/**
 * Both figures stand on the same row of their tile as Carl and Rosemarie, so
 * she and the toddler beside her share one ground line.
 */
const GROUND_ROW_IN_TILE = 58;
export const GROUND_OFFSET_IN_TILE = GROUND_ROW_IN_TILE / TILE_SCALE;

export const MOTHER_FRAME_W = 80;
export const MOTHER_FRAME_H = 80;
/** Headroom above the ground for the scarf's knot and a hand flung up for help. */
const MOTHER_GROUND_ROW = 74;
export const MOTHER_TILE_X = (MOTHER_FRAME_W - TILE_SCALE) / 2;
export const MOTHER_TILE_Y = MOTHER_GROUND_ROW - GROUND_ROW_IN_TILE;

export const TODDLER_FRAME_W = 64;
export const TODDLER_FRAME_H = 64;
const TODDLER_GROUND_ROW = 60;
export const TODDLER_TILE_X = (TODDLER_FRAME_W - TILE_SCALE) / 2;
export const TODDLER_TILE_Y = TODDLER_GROUND_ROW - GROUND_ROW_IN_TILE;

// ── Mother: idle, rocking the baby ───────────────────────────────────────────

const ROCK_SWAY = 0.018;
const ROCK_BUNDLE_SHIFT = 0.022;
const ROCK_BUNDLE_ROLL = 0.14;
const ROCK_DIP = 0.006;
/** The head follows the rock a beat late: that lag is weight, not a slide. */
const HEAD_LAG = 0.12;
const HEAD_ROCK = 0.05;
export const MOTHER_IDLE_BLINK_FRAME = 7;
/** The baby's fist works free of the swaddle across this stretch of the rock. */
const FIST_START = 0.5;
const FIST_LENGTH = 0.45;
/** The baby's own slow blink, on its own beat so the two faces never blink together. */
const BABY_BLINK_FRAME = 2;

export function motherIdlePose(frame: number): MotherPose {
  const rest = restingMotherPose();
  const phase = frame / MOTHER_IDLE_FRAMES;
  const rock = Math.sin(phase * Math.PI * 2);
  const headRock = Math.sin((phase - HEAD_LAG) * Math.PI * 2);
  const shift = { x: ROCK_BUNDLE_SHIFT * rock, y: 0 };
  return {
    ...rest,
    bodyX: ROCK_SWAY * rock,
    dip: ROCK_DIP * rock * rock,
    breath: 0.5 - 0.5 * Math.cos((phase + 0.25) * Math.PI * 2),
    headTilt: rest.headTilt + HEAD_ROCK * headRock,
    bundle: { x: rest.bundle.x + shift.x, y: rest.bundle.y },
    bundleRot: rest.bundleRot + ROCK_BUNDLE_ROLL * rock,
    nearHand: { x: rest.nearHand.x + shift.x, y: rest.nearHand.y },
    farHand: { x: rest.farHand.x + shift.x, y: rest.farHand.y },
    eyeOpen: frame === MOTHER_IDLE_BLINK_FRAME ? 0 : rest.eyeOpen,
    baby: {
      eyeOpen: frame === BABY_BLINK_FRAME ? 0 : 1,
      mouthOpen: 0,
      fist: hump((phase - FIST_START) / FIST_LENGTH),
    },
  };
}

// ── Mother: hurt, calling for help ───────────────────────────────────────────

const WAVE_CENTRE = { x: -0.3, y: -0.93 };
const WAVE_SWING = 0.075;
const WAVE_LIFT = 0.025;
const WAVE_ELBOW = { x: -0.33, y: -0.72 };
const TREMBLE = 0.007;
const HURT_HEAD_TILT = -0.06;
const HURT_HEAD_SWING = 0.06;

export function motherHurtPose(frame: number): MotherPose {
  const rest = restingMotherPose();
  const phase = frame / MOTHER_HURT_FRAMES;
  const wave = Math.sin(phase * Math.PI * 2);
  const lift = Math.cos(phase * Math.PI * 2);
  const tremble = frame % 2 === 0 ? TREMBLE : -TREMBLE;
  return {
    ...rest,
    bodyX: tremble,
    dip: 0.004,
    breath: 0.5 + 0.5 * lift,
    headTilt: HURT_HEAD_TILT + HURT_HEAD_SWING * wave,
    // The baby comes up tight under her chin, turned in from the danger.
    bundle: { x: 0.03, y: -0.47 },
    bundleRot: -0.5,
    nearElbow: { x: 0.205, y: -0.43 },
    nearHand: { x: -0.1, y: -0.43 },
    farElbow: { x: WAVE_ELBOW.x + wave * WAVE_SWING * 0.3, y: WAVE_ELBOW.y },
    farHand: { x: WAVE_CENTRE.x + wave * WAVE_SWING, y: WAVE_CENTRE.y + lift * WAVE_LIFT },
    farHandOpen: true,
    eyeOpen: 1.15,
    gaze: { x: lerp(-0.8, 0.8, 0.5 + 0.5 * wave), y: -0.2 },
    worry: 1,
    smile: 0,
    mouthOpen: 0.7 + 0.3 * lift,
    earDroop: 0.3,
    baby: { eyeOpen: 0, mouthOpen: 0.7 + 0.3 * wave, fist: 1 },
  };
}

export function motherPose(row: MotherRow, frame: number): MotherPose {
  return row === 'idle' ? motherIdlePose(frame) : motherHurtPose(frame);
}

// ── Toddler: walk ────────────────────────────────────────────────────────────

const WADDLE_SWAY = 0.018;
const WADDLE_LEAN = 0.09;
const WADDLE_BOB = 0.012;
const FOOT_LIFT = 0.032;
const FOOT_SPREAD = 0.045;
const FOOT_SWING = 0.03;
/** Arms held out from the body for balance, the way a new walker carries them. */
const BALANCE_HAND = { x: 0.13, y: -0.17 };
const BALANCE_SWING = 0.022;

export function toddlerWalkPose(frame: number): ToddlerPose {
  const rest = restingToddlerPose();
  const phase = frame / TODDLER_WALK_FRAMES;
  const side = Math.sin(phase * Math.PI * 2);
  const reach = Math.cos(phase * Math.PI * 2);
  return {
    ...rest,
    bodyX: WADDLE_SWAY * side,
    lean: WADDLE_LEAN * side,
    bob: WADDLE_BOB * Math.abs(side),
    backFoot: { x: -FOOT_SPREAD + FOOT_SWING * reach, y: -FOOT_LIFT * Math.max(0, side) },
    frontFoot: { x: FOOT_SPREAD - FOOT_SWING * reach, y: -FOOT_LIFT * Math.max(0, -side) },
    backHand: { x: -BALANCE_HAND.x, y: BALANCE_HAND.y + BALANCE_SWING * side },
    frontHand: { x: BALANCE_HAND.x, y: BALANCE_HAND.y - BALANCE_SWING * side },
    headTilt: rest.headTilt - WADDLE_LEAN * 0.6 * side,
    mouthOpen: 0.5,
  };
}

// ── Toddler: idle, reaching up for her ───────────────────────────────────────

const REACH_BOUNCE = 0.016;
const REACH_FRONT = { x: 0.21, y: -0.37 };
const REACH_BACK = { x: -0.15, y: -0.4 };
const REACH_GRAB = 0.025;
const REACH_HEAD_TILT = 0.1;
const REACH_LEAN = 0.08;
export const TODDLER_IDLE_BLINK_FRAME = 5;

export function toddlerIdlePose(frame: number): ToddlerPose {
  const rest = restingToddlerPose();
  const phase = frame / TODDLER_IDLE_FRAMES;
  const bounce = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  const grab = Math.sin(phase * Math.PI * 2);
  return {
    ...rest,
    bob: REACH_BOUNCE * bounce,
    lean: REACH_LEAN,
    bodyX: 0.01,
    frontHand: { x: REACH_FRONT.x, y: REACH_FRONT.y - REACH_GRAB * grab - REACH_BOUNCE * bounce },
    backHand: { x: REACH_BACK.x, y: REACH_BACK.y + REACH_GRAB * grab - REACH_BOUNCE * bounce },
    headTilt: REACH_HEAD_TILT,
    eyeOpen: frame === TODDLER_IDLE_BLINK_FRAME ? 0 : 1,
    mouthOpen: 0.9,
  };
}

export function toddlerPose(row: ToddlerRow, frame: number): ToddlerPose {
  return row === 'walk' ? toddlerWalkPose(frame) : toddlerIdlePose(frame);
}

// ── Figures ──────────────────────────────────────────────────────────────────

function motherRowOf(state: string): MotherRow | null {
  return MOTHER_ROWS.find((row) => row === state) ?? null;
}

function toddlerRowOf(state: string): ToddlerRow | null {
  return TODDLER_ROWS.find((row) => row === state) ?? null;
}

export const GOBLIN_MOTHER_FIGURE: FigureDef = {
  id: 'goblin_mother',
  frameWidth: MOTHER_FRAME_W,
  frameHeight: MOTHER_FRAME_H,
  tileX: MOTHER_TILE_X,
  tileY: MOTHER_TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(MOTHER_ROW_FRAMES),
  paintFrame: (ctx, state, frame) => {
    const row = motherRowOf(state);
    if (row === null) return;
    ctx.save();
    ctx.translate(MOTHER_TILE_X + TILE_SCALE / 2, MOTHER_GROUND_ROW);
    ctx.scale(TILE_SCALE, TILE_SCALE);
    drawGoblinMother(ctx, motherPose(row, frame));
    ctx.restore();
  },
};

export const GOBLIN_TODDLER_FIGURE: FigureDef = {
  id: 'goblin_toddler',
  frameWidth: TODDLER_FRAME_W,
  frameHeight: TODDLER_FRAME_H,
  tileX: TODDLER_TILE_X,
  tileY: TODDLER_TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(TODDLER_ROW_FRAMES),
  paintFrame: (ctx, state, frame) => {
    const row = toddlerRowOf(state);
    if (row === null) return;
    ctx.save();
    ctx.translate(TODDLER_TILE_X + TILE_SCALE / 2, TODDLER_GROUND_ROW);
    ctx.scale(TILE_SCALE, TILE_SCALE);
    drawGoblinToddler(ctx, toddlerPose(row, frame));
    ctx.restore();
  },
};
