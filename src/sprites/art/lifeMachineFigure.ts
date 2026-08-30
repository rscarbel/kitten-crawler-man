/**
 * The life machine's choreography: what pose each frame of each row holds.
 *
 * Nine rows, seven of them body poses and two of them lamp overlays. The lamps
 * are their own rows because a shut-down machine differs from a running one
 * only by which colour is lit — compositing one lamp row over any body frame is
 * two short rows instead of a second copy of every pose.
 *
 * The painting itself lives in `lifeMachineArt.ts`; nothing here touches a
 * pixel.
 */

import { lifeMachineSacSplitFrame } from '../lifeMachineTiming';
import { figureStates, type FigureDef } from '../figure/figureDef';
import {
  FRAME_H,
  FRAME_W,
  LED_GREEN,
  LED_RED,
  RESTING_POSE,
  TILE_SCALE,
  clamp01,
  drawLifeMachine,
  drawLifeMachineLights,
  easeInOut,
  hump,
  lerp,
  type LifeMachinePose,
} from './lifeMachineArt';

/** The one tile the machine stands on is the frame's bottom tile row. */
const FOOTPRINT_TILE_Y = FRAME_H - TILE_SCALE;
/** The frame is centred on that tile, so the art overhangs half a tile each side. */
const FOOTPRINT_TILE_X = (FRAME_W - TILE_SCALE) / 2;

const IDLE_FRAME_COUNT = 4;
const WARMING_FRAME_COUNT = 4;
const HOT_FRAME_COUNT = 4;
const PRINTING_FRAME_COUNT = 6;
const DISPENSING_FRAME_COUNT = 4;
const PURGING_FRAME_COUNT = 4;
const OFFLINE_FRAME_COUNT = 2;
const LAMP_FRAME_COUNT = 3;

const IDLE_POWER = 0.3;
const RUNNING_POWER = 1;
const IDLE_GAUGE = 0.1;
const RUNNING_GAUGE = 0.82;
const HOPPER_FULL = 0.86;
const HOPPER_SPENT = 0.42;

/** Smallest sac the printing row starts from — a bead, not a bare plate. */
const PRINT_START_GROWTH = 0.08;

const IDLE_GAUGE_FLUTTER = 0.03;
const WARMING_NOZZLE_HEAT = 0.35;
const WARMING_STEAM = 0.6;
const HOT_NOZZLE_HEAT_BASE = 0.6;
const HOT_NOZZLE_HEAT_PULSE = 0.4;
const HOT_EXTRUDE_START = 0.6;
const HOT_GAUGE_PULSE = 0.06;
const HOT_STEAM = 0.25;
/** How far the head is pushed up by a full-height sac, as a share of its travel. */
const PRINT_HEAD_CLIMB = 0.92;
const PRINTING_STEAM = 0.15;
const DISPENSING_NOZZLE_TRAVEL = 0.1;
const DISPENSING_NOZZLE_HEAT = 0.4;
const DISPENSING_SHUTTER_RATE = 2;
const DISPENSING_END_GAUGE = 0.4;
const DISPENSING_STEAM_RATE = 1.4;
const DISPENSING_STEAM = 0.9;
const PURGING_NOZZLE_HEAT = 0.25;
const PURGING_STEAM = 0.35;
/** Growth the abandoned sac was at when the terminal cut the power. */
const OFFLINE_ABANDONED_GROWTH = 0.55;
const OFFLINE_FIRST_FRAME_STEAM = 0.18;
const OFFLINE_SETTLED_STEAM = 0.1;
/** How many lateral passes the head makes over the course of one sac. */
const PRINT_SWEEP_PASSES = 2.5;

type PoseFn = (frameIndex: number, frameCount: number) => LifeMachinePose;

/** 0…1 across a row, so a row's frame count can change without retuning it. */
function rowProgress(frameIndex: number, frameCount: number): number {
  return frameCount <= 1 ? 0 : frameIndex / (frameCount - 1);
}

/** Loop phase for drifting fluid; wraps so the last frame leads back to the first. */
function loopPhase(frameIndex: number, frameCount: number): number {
  return frameIndex / frameCount;
}

const idlePose: PoseFn = (frameIndex, frameCount) => ({
  ...RESTING_POSE,
  power: IDLE_POWER,
  gauge: IDLE_GAUGE + hump(loopPhase(frameIndex, frameCount)) * IDLE_GAUGE_FLUTTER,
  hopperLevel: HOPPER_FULL,
  fluidPhase: loopPhase(frameIndex, frameCount),
});

const warmingPose: PoseFn = (frameIndex, frameCount) => {
  const t = rowProgress(frameIndex, frameCount);
  return {
    ...RESTING_POSE,
    power: lerp(IDLE_POWER, RUNNING_POWER, easeInOut(t)),
    // The head runs down to the plate: the machine is taking up its station.
    nozzleTravel: easeInOut(t),
    nozzleSweep: 0,
    nozzleHeat: t * WARMING_NOZZLE_HEAT,
    gauge: lerp(IDLE_GAUGE, RUNNING_GAUGE, easeInOut(t)),
    hopperLevel: HOPPER_FULL,
    steam: hump(t) * WARMING_STEAM,
    fluidPhase: loopPhase(frameIndex, frameCount),
  };
};

const hotPose: PoseFn = (frameIndex, frameCount) => {
  const t = rowProgress(frameIndex, frameCount);
  const pulse = hump(loopPhase(frameIndex, frameCount));
  return {
    ...RESTING_POSE,
    power: RUNNING_POWER,
    nozzleTravel: 1,
    nozzleSweep: 0,
    nozzleHeat: HOT_NOZZLE_HEAT_BASE + pulse * HOT_NOZZLE_HEAT_PULSE,
    extruding: t > HOT_EXTRUDE_START,
    sacGrowth: t > HOT_EXTRUDE_START ? PRINT_START_GROWTH : 0,
    sacForm: t > HOT_EXTRUDE_START ? 'printing' : 'none',
    gauge: RUNNING_GAUGE + pulse * HOT_GAUGE_PULSE,
    hopperLevel: HOPPER_FULL,
    steam: pulse * HOT_STEAM,
    fluidPhase: loopPhase(frameIndex, frameCount),
  };
};

const printingPose: PoseFn = (frameIndex, frameCount) => {
  const t = rowProgress(frameIndex, frameCount);
  const growth = lerp(PRINT_START_GROWTH, 1, easeInOut(t));
  return {
    ...RESTING_POSE,
    power: RUNNING_POWER,
    // The head climbs as its own work pushes it up — the printer read.
    nozzleTravel: 1 - growth * PRINT_HEAD_CLIMB,
    nozzleSweep: Math.sin(t * Math.PI * 2 * PRINT_SWEEP_PASSES),
    nozzleHeat: 1,
    extruding: true,
    sacGrowth: growth,
    sacForm: 'printing',
    gauge: RUNNING_GAUGE,
    hopperLevel: lerp(HOPPER_FULL, HOPPER_SPENT, t),
    steam: PRINTING_STEAM,
    fluidPhase: loopPhase(frameIndex, frameCount),
  };
};

const dispensingPose: PoseFn = (frameIndex, frameCount) => {
  const t = rowProgress(frameIndex, frameCount);
  const shutter = easeInOut(clamp01(t * DISPENSING_SHUTTER_RATE));
  // Splits only once it is clear of the machine, so the player reads the order
  // of events: printed, delivered, hatched.
  const splitFrame = lifeMachineSacSplitFrame(frameCount);
  const hasSplit = frameIndex >= splitFrame;
  const framesSinceSplit = frameIndex - splitFrame;
  const framesAfterSplit = Math.max(1, frameCount - 1 - splitFrame);
  return {
    ...RESTING_POSE,
    power: RUNNING_POWER,
    nozzleTravel: DISPENSING_NOZZLE_TRAVEL,
    nozzleHeat: DISPENSING_NOZZLE_HEAT * (1 - t),
    sacGrowth: 1,
    sacForm: hasSplit ? 'split' : 'finished',
    sacTear: hasSplit ? clamp01(framesSinceSplit / framesAfterSplit) : 0,
    plateDrop: easeInOut(t),
    shutterOpen: shutter,
    gauge: lerp(RUNNING_GAUGE, DISPENSING_END_GAUGE, t),
    hopperLevel: HOPPER_SPENT,
    steam: hump(clamp01(t * DISPENSING_STEAM_RATE)) * DISPENSING_STEAM,
    fluidPhase: loopPhase(frameIndex, frameCount),
  };
};

const purgingPose: PoseFn = (frameIndex, frameCount) => {
  const t = rowProgress(frameIndex, frameCount);
  return {
    ...RESTING_POSE,
    power: lerp(RUNNING_POWER, IDLE_POWER, easeInOut(t)),
    nozzleTravel: lerp(DISPENSING_NOZZLE_TRAVEL, 0, easeInOut(t)),
    nozzleHeat: PURGING_NOZZLE_HEAT * (1 - t),
    sacGrowth: 1,
    sacForm: 'husk',
    // A husk stays as torn as it was left; only the shutters are closing.
    sacTear: 1,
    plateDrop: 1,
    shutterOpen: 1 - easeInOut(t),
    gauge: lerp(DISPENSING_END_GAUGE, IDLE_GAUGE, t),
    hopperLevel: lerp(HOPPER_SPENT, HOPPER_FULL, easeInOut(t)),
    steam: (1 - t) * PURGING_STEAM,
    fluidPhase: loopPhase(frameIndex, frameCount),
  };
};

const offlinePose: PoseFn = (frameIndex, frameCount) => ({
  ...RESTING_POSE,
  power: 0,
  nozzleTravel: 1 - OFFLINE_ABANDONED_GROWTH * PRINT_HEAD_CLIMB,
  nozzleHeat: 0,
  sacGrowth: OFFLINE_ABANDONED_GROWTH,
  sacForm: 'dead',
  sacTear: 0,
  plateDrop: 0,
  shutterOpen: 1,
  gauge: 0,
  hopperLevel: HOPPER_SPENT,
  // Barely moving: two frames of settling steam is the only sign of life left.
  steam: frameIndex === 0 ? OFFLINE_FIRST_FRAME_STEAM : OFFLINE_SETTLED_STEAM,
  fluidPhase: loopPhase(frameIndex, frameCount),
});

/**
 * Lamp brightness ring. One lamp bright, one mid, one dim, rotated per frame —
 * a chase around the panel rather than three lamps blinking in step.
 */
const LAMP_CHANNELS: readonly number[] = [1, 0.55, 0.25];

interface LifeMachineRow {
  readonly name: string;
  readonly frameCount: number;
  readonly pose?: PoseFn;
  readonly lampColor?: string;
}

/** The manifest prefixed every row with the sprite's own name; the runtime still asks for those. */
const STATE_PREFIX = 'life_machine_';

export const LIFE_MACHINE_ROWS: readonly LifeMachineRow[] = [
  { name: 'idle', frameCount: IDLE_FRAME_COUNT, pose: idlePose },
  { name: 'warming', frameCount: WARMING_FRAME_COUNT, pose: warmingPose },
  { name: 'hot', frameCount: HOT_FRAME_COUNT, pose: hotPose },
  { name: 'printing', frameCount: PRINTING_FRAME_COUNT, pose: printingPose },
  { name: 'dispensing', frameCount: DISPENSING_FRAME_COUNT, pose: dispensingPose },
  { name: 'purging', frameCount: PURGING_FRAME_COUNT, pose: purgingPose },
  { name: 'offline', frameCount: OFFLINE_FRAME_COUNT, pose: offlinePose },
  { name: 'green_lights', frameCount: LAMP_FRAME_COUNT, lampColor: LED_GREEN },
  { name: 'red_lights', frameCount: LAMP_FRAME_COUNT, lampColor: LED_RED },
];

/** A row's state name, as both the def and every caller spell it. */
export function lifeMachineStateName(row: string): string {
  return `${STATE_PREFIX}${row}`;
}

const ROWS_BY_STATE: ReadonlyMap<string, LifeMachineRow> = new Map(
  LIFE_MACHINE_ROWS.map((row) => [lifeMachineStateName(row.name), row]),
);

export const LIFE_MACHINE_FIGURE: FigureDef = {
  id: 'life_machine',
  frameWidth: FRAME_W,
  frameHeight: FRAME_H,
  tileX: FOOTPRINT_TILE_X,
  tileY: FOOTPRINT_TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(
    Object.fromEntries(
      LIFE_MACHINE_ROWS.map((row) => [lifeMachineStateName(row.name), row.frameCount]),
    ),
  ),
  paintFrame: (ctx, state, frame) => {
    const row = ROWS_BY_STATE.get(state);
    if (row === undefined) return;
    if (row.lampColor !== undefined) {
      drawLifeMachineLights(ctx, row.lampColor, frame, LAMP_CHANNELS);
      return;
    }
    if (row.pose === undefined) return;
    drawLifeMachine(ctx, row.pose(frame, row.frameCount));
  },
};

/** The lamp overlays, which are drawn over a body row rather than instead of one. */
export const LIFE_MACHINE_LAMP_STATES: readonly string[] = [
  lifeMachineStateName('green_lights'),
  lifeMachineStateName('red_lights'),
];
