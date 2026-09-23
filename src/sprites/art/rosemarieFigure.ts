/**
 * Rosemarie's and Bernie's choreography and figure definitions.
 *
 * Rosemarie has two rows in two views: `idle`, a slow hobble onto her cane and
 * back with a re-plant of the stick, and `coin_toss`, the flick she aims at
 * dancers' eyes. Bernie is a figure of his own with a two-frame snuffle, so his
 * loop runs on its own clock rather than multiplying into hers.
 *
 * Each figure also has a portrait build: the same painter at twice the cell
 * density, for panels that show her far larger than a tile.
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  BERNIE_SNUFFLE_FRAMES,
  ROSEMARIE_COIN_TOSS_FRAMES,
  ROSEMARIE_COIN_TOSS_RELEASE_FRAME,
  ROSEMARIE_IDLE_FRAMES,
} from '../rosemarieTiming';
import { hump, lerp } from './carlArt';
import {
  type HandGrip,
  type RosemariePose,
  type RosemarieView,
  type Vec3,
  drawBernie,
  drawRosemarieFront,
  drawRosemarieSide,
  restingPose,
} from './rosemarieArt';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Cell pixels per tile at the regular build. */
export const TILE_SCALE = 64;
/** The portrait build paints the same cells at this many times the density. */
export const PORTRAIT_DENSITY = 2;

export const FRAME_W = 80;
export const FRAME_H = 80;
export const TILE_X = (FRAME_W - TILE_SCALE) / 2;
/**
 * Her feet sit on a whole cell row near the bottom of her tile, level with
 * where Carl's do, so the desk in front of her tile covers her boots and hem
 * and she peers over it from the knees up.
 */
const GROUND_ROW_IN_TILE = 58;
export const GROUND_OFFSET_IN_TILE = GROUND_ROW_IN_TILE / TILE_SCALE;
/** Cell row of the ground line; everything above it is room for her and her raised hand. */
const GROUND_ROW = 72;
export const TILE_Y = GROUND_ROW - GROUND_ROW_IN_TILE;
const ORIGIN_X = TILE_X + TILE_SCALE / 2;
const ORIGIN_Y = GROUND_ROW;

/** Bernie's cell, with his seat — where his feet grip — as the tile's top-left. */
export const BERNIE_FRAME_W = 32;
export const BERNIE_FRAME_H = 20;
export const BERNIE_SEAT_X = 12;
export const BERNIE_SEAT_Y = 16;

// ── Rows ─────────────────────────────────────────────────────────────────────

export type RosemarieRow = 'idle' | 'coin_toss';
export const ROSEMARIE_ROWS: readonly RosemarieRow[] = ['idle', 'coin_toss'];
export const ROSEMARIE_VIEWS: readonly RosemarieView[] = ['front', 'side'];

/** The state name a row takes in a view: head-on is the bare name, profile adds `_side`. */
export function rosemarieStateName(row: RosemarieRow, view: RosemarieView): string {
  return view === 'side' ? `${row}_side` : row;
}

export const BERNIE_SNUFFLE_STATE = 'snuffle';

const ROW_FRAMES: Readonly<Record<RosemarieRow, number>> = {
  idle: ROSEMARIE_IDLE_FRAMES,
  coin_toss: ROSEMARIE_COIN_TOSS_FRAMES,
};

// ── Idle: the cane hobble ────────────────────────────────────────────────────

/** How far she sways onto the cane and sinks as she leans on it. */
const HOBBLE_SWAY = 0.045;
const HOBBLE_DIP = 0.024;
/** The head follows the body a beat late — that lag is what makes it weight and not a slide. */
const HEAD_LAG = 0.08;
const HEAD_SWAY = 0.012;
const HEAD_ROLL = 0.07;
/** The bad foot eases off the floor as the cane takes her weight. */
const BAD_FOOT_LIFT = 0.018;
/** Late in the cycle, weight off the stick, she lifts it and plants it again a touch further out. */
const CANE_TAP_START = 0.78;
const CANE_TAP_LENGTH = 0.18;
const CANE_TAP_LIFT = 0.035;
const CANE_TAP_OUT = 0.015;
/** One blink per hobble, on a single frame. */
const BLINK_FRAME = 3;

function weightAt(phase: number): number {
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
}

function withBody(hand: Vec3, bodyL: number, dip: number): Vec3 {
  return { l: hand.l + bodyL, y: hand.y + dip, d: hand.d };
}

export function idlePose(frame: number): RosemariePose {
  const rest = restingPose();
  const phase = frame / ROSEMARIE_IDLE_FRAMES;
  const weight = weightAt(phase);
  const headWeight = weightAt(phase - HEAD_LAG);
  const tap = hump((phase - CANE_TAP_START) / CANE_TAP_LENGTH);
  const tapping = phase >= CANE_TAP_START && phase <= CANE_TAP_START + CANE_TAP_LENGTH;
  const bodyL = HOBBLE_SWAY * weight;
  const dip = HOBBLE_DIP * weight;
  return {
    ...rest,
    bodyL,
    dip,
    headL: HEAD_SWAY * headWeight,
    headTilt: HEAD_ROLL * (headWeight - 0.5),
    headDip: 0.006 * headWeight,
    rightHand: withBody(rest.rightHand, bodyL, dip),
    flickFrom: withBody(rest.rightHand, bodyL, dip),
    caneFoot: {
      l: rest.caneFoot.l + (tapping ? CANE_TAP_OUT * tap : 0),
      y: rest.caneFoot.y,
      d: rest.caneFoot.d,
    },
    caneLift: tapping ? CANE_TAP_LIFT * tap : 0,
    badFootLift: BAD_FOOT_LIFT * weight,
    squint: frame === BLINK_FRAME ? 1 : 0.15,
    breath: weightAt(phase + 0.25),
  };
}

// ── Coin toss ────────────────────────────────────────────────────────────────

interface TossKey {
  readonly hand: Vec3;
  readonly grip: HandGrip;
  readonly coin: boolean;
  readonly twist: number;
  readonly bodyL: number;
  readonly dip: number;
  readonly headTilt: number;
  readonly headForward: number;
  readonly squint: number;
  readonly grin: number;
  readonly cackle: number;
}

function key(
  hand: Vec3,
  grip: HandGrip,
  coin: boolean,
  body: Partial<Omit<TossKey, 'hand' | 'grip' | 'coin'>> = {},
): TossKey {
  return {
    hand,
    grip,
    coin,
    twist: body.twist ?? 0,
    bodyL: body.bodyL ?? 0,
    dip: body.dip ?? 0,
    headTilt: body.headTilt ?? 0,
    headForward: body.headForward ?? 0,
    squint: body.squint ?? 0.15,
    grin: body.grin ?? 0.35,
    cackle: body.cackle ?? 0,
  };
}

/**
 * One key per frame. The dip to the pocket and the aim are held; the flick
 * itself happens between two frames, which is what makes it a flick: the
 * wrist is cocked beside her ear on one frame and flung out empty on the next.
 */
const TOSS_KEYS: readonly TossKey[] = [
  key({ l: -0.1, y: -0.38, d: 0.18 }, 'rest', false),
  key({ l: -0.085, y: -0.31, d: 0.22 }, 'pocket', false, { dip: 0.01, headTilt: -0.06 }),
  key({ l: -0.12, y: -0.45, d: 0.2 }, 'pinch', true, { headTilt: -0.04, grin: 0.5 }),
  key({ l: -0.17, y: -0.6, d: 0.16 }, 'pinch', true, { twist: 0.15, squint: 0.6, grin: 0.6 }),
  key({ l: -0.25, y: -0.82, d: 0.02 }, 'pinch', true, {
    twist: 0.35,
    bodyL: -0.012,
    headTilt: -0.1,
    squint: 1,
    grin: 0.7,
  }),
  key({ l: -0.27, y: -0.9, d: -0.03 }, 'pinch', true, {
    twist: 0.42,
    bodyL: -0.016,
    dip: 0.006,
    headTilt: -0.12,
    squint: 1,
    grin: 0.75,
  }),
  key({ l: -0.33, y: -0.68, d: 0.27 }, 'open', false, {
    twist: -0.25,
    bodyL: 0.008,
    headForward: 0.02,
    headTilt: -0.04,
    squint: 0.8,
    grin: 1,
  }),
  key({ l: -0.27, y: -0.55, d: 0.3 }, 'open', false, {
    twist: -0.2,
    bodyL: 0.01,
    headForward: 0.015,
    grin: 1,
    cackle: 0.6,
  }),
  key({ l: -0.16, y: -0.46, d: 0.25 }, 'rest', false, {
    twist: -0.05,
    dip: -0.012,
    headTilt: 0.08,
    grin: 1,
    cackle: 1,
    squint: 0.7,
  }),
  key({ l: -0.11, y: -0.4, d: 0.19 }, 'rest', false, { dip: 0.004, grin: 0.6, cackle: 0.2 }),
];

/** How hard she breathes through the toss: calm at rest, heaving on the cackle. */
const TOSS_BREATH_CALM = 0.3;
const TOSS_BREATH_CACKLE = 0.8;

/** The frame before the release, whose hand the flick sweeps away from. */
const WIND_UP_FRAME = ROSEMARIE_COIN_TOSS_RELEASE_FRAME - 1;

/**
 * How many keys the toss is authored with. It must equal
 * `ROSEMARIE_COIN_TOSS_FRAMES`: a key past the end is never painted, and a
 * missing one would leave a frame with no pose. The gates hold the two equal.
 */
export const COIN_TOSS_KEY_COUNT = TOSS_KEYS.length;
export const IDLE_BLINK_FRAME = BLINK_FRAME;

/** The key authored for `frame`; a frame with no key is an error, never a clamp. */
function tossKeyAt(frame: number): TossKey {
  const found = frame >= 0 && frame < TOSS_KEYS.length ? TOSS_KEYS[frame] : undefined;
  if (found === undefined) {
    throw new Error(`coin_toss has ${TOSS_KEYS.length} keys and no pose for frame ${frame}`);
  }
  return found;
}

export function coinTossPose(frame: number): RosemariePose {
  const rest = restingPose();
  const pose = tossKeyAt(frame);
  const released = frame === ROSEMARIE_COIN_TOSS_RELEASE_FRAME;
  return {
    ...rest,
    bodyL: pose.bodyL,
    dip: pose.dip,
    twist: pose.twist,
    headTilt: pose.headTilt,
    headForward: pose.headForward,
    rightHand: pose.hand,
    grip: pose.grip,
    holdsCoin: pose.coin,
    flick: released ? 1 : 0,
    flickFrom: released ? tossKeyAt(WIND_UP_FRAME).hand : pose.hand,
    squint: pose.squint,
    grin: pose.grin,
    cackle: pose.cackle,
    breath: lerp(TOSS_BREATH_CALM, TOSS_BREATH_CACKLE, pose.cackle),
  };
}

export function rosemariePose(row: RosemarieRow, frame: number): RosemariePose {
  return row === 'idle' ? idlePose(frame) : coinTossPose(frame);
}

// ── Painting ─────────────────────────────────────────────────────────────────

interface ResolvedState {
  readonly row: RosemarieRow;
  readonly view: RosemarieView;
}

function resolveState(state: string): ResolvedState | null {
  for (const row of ROSEMARIE_ROWS) {
    for (const view of ROSEMARIE_VIEWS) {
      if (rosemarieStateName(row, view) === state) return { row, view };
    }
  }
  return null;
}

function paintRosemarie(
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
  density: number,
): void {
  const resolved = resolveState(state);
  if (resolved === null) return;
  const pose = rosemariePose(resolved.row, frame);
  ctx.save();
  ctx.scale(density, density);
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  if (resolved.view === 'front') drawRosemarieFront(ctx, pose);
  else drawRosemarieSide(ctx, pose);
  ctx.restore();
}

function paintBernie(
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
  density: number,
): void {
  if (state !== BERNIE_SNUFFLE_STATE) return;
  ctx.save();
  ctx.scale(density, density);
  ctx.translate(BERNIE_SEAT_X, BERNIE_SEAT_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  drawBernie(ctx, frame);
  ctx.restore();
}

function rosemarieStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of ROSEMARIE_ROWS) {
    for (const view of ROSEMARIE_VIEWS) frames[rosemarieStateName(row, view)] = ROW_FRAMES[row];
  }
  return frames;
}

function rosemarieFigure(id: string, density: number): FigureDef {
  return {
    id,
    frameWidth: FRAME_W * density,
    frameHeight: FRAME_H * density,
    tileX: TILE_X * density,
    tileY: TILE_Y * density,
    tileScale: TILE_SCALE * density,
    states: figureStates(rosemarieStateFrames()),
    paintFrame: (ctx, state, frame) => {
      paintRosemarie(ctx, state, frame, density);
    },
  };
}

function bernieFigure(id: string, density: number): FigureDef {
  return {
    id,
    frameWidth: BERNIE_FRAME_W * density,
    frameHeight: BERNIE_FRAME_H * density,
    tileX: BERNIE_SEAT_X * density,
    tileY: BERNIE_SEAT_Y * density,
    tileScale: TILE_SCALE * density,
    states: figureStates({ [BERNIE_SNUFFLE_STATE]: BERNIE_SNUFFLE_FRAMES }),
    paintFrame: (ctx, state, frame) => {
      paintBernie(ctx, state, frame, density);
    },
  };
}

export const ROSEMARIE_FIGURE: FigureDef = rosemarieFigure('rosemarie', 1);
export const ROSEMARIE_PORTRAIT_FIGURE: FigureDef = rosemarieFigure(
  'rosemarie_portrait',
  PORTRAIT_DENSITY,
);
export const BERNIE_FIGURE: FigureDef = bernieFigure('bernie', 1);
export const BERNIE_PORTRAIT_FIGURE: FigureDef = bernieFigure('bernie_portrait', PORTRAIT_DENSITY);
