#!/usr/bin/env tsx
/**
 * Generates the `life_machine` sprite sheet — the floor-2 spider lab's egg-sac
 * bio-printers.
 *
 * The painting lives in `scripts/lifeMachineArt.ts`; this file is the
 * choreography (what pose each frame of each row holds) plus the bake.
 *
 * Rows (see the `life_machine` entry in
 * src/images/bosses/grotesque_spider/manifest.json):
 *   0 idle        — banked down between jobs, chamber empty, chute shut
 *   1 warming     — pumps prime, resin flows, the print head runs down to the plate
 *   2 hot         — nozzle up to temperature, first bead of silk hanging off the tip
 *   3 printing    — the sac builds layer by layer under a climbing print head
 *   4 dispensing  — shutters open and the finished sac rides the plate down the chute
 *   5 purging     — torn husk clears, plate returns, the nozzle spits its purge blob
 *   6 offline     — killed at the terminal: dark, vented, a half-printed sac abandoned
 *   7 green_lights— lamp overlay while the machine is running
 *   8 red_lights  — lamp overlay once it has been shut down
 *
 * The two lamp rows are overlays composited onto whichever body frame is
 * showing, so a lamp colour change never means re-baking every body pose.
 *
 * Run: npm run gen:life-machine
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

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
} from './lifeMachineArt.js';
// The split frame is shared with the runtime rather than copied here; see the
// header of that module for what goes wrong when the two drift.
import { lifeMachineSacSplitFrame } from '../src/sprites/lifeMachineTiming.js';

const SHEET_PATH = 'src/images/bosses/grotesque_spider/life_machine.png';
const MANIFEST_PATH = 'src/images/bosses/grotesque_spider/manifest.json';
const MANIFEST_KEY = 'life_machine';
/** How `SpriteLoader` names the sheet: manifest paths are relative to src/images/. */
const MANIFEST_SHEET_PATH = 'bosses/grotesque_spider/life_machine.png';

/** Frames are painted at this multiple and downsampled, which softens edges. */
const SUPERSAMPLE = 2;

/** The one tile the machine stands on is the frame's bottom tile row. */
const FOOTPRINT_TILE_Y = FRAME_H - TILE_SCALE;
/** The frame is centred on that tile, so the art overhangs half a tile each side. */
const FOOTPRINT_TILE_X = (FRAME_W - TILE_SCALE) / 2;

// ── Row choreography ─────────────────────────────────────────────────────────

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
  gauge: IDLE_GAUGE + hump(loopPhase(frameIndex, frameCount)) * 0.03,
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
    nozzleHeat: t * 0.35,
    gauge: lerp(IDLE_GAUGE, RUNNING_GAUGE, easeInOut(t)),
    hopperLevel: HOPPER_FULL,
    steam: hump(t) * 0.6,
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
    nozzleHeat: 0.6 + pulse * 0.4,
    extruding: t > 0.6,
    sacGrowth: t > 0.6 ? PRINT_START_GROWTH : 0,
    sacForm: t > 0.6 ? 'printing' : 'none',
    gauge: RUNNING_GAUGE + pulse * 0.06,
    hopperLevel: HOPPER_FULL,
    steam: pulse * 0.25,
    fluidPhase: loopPhase(frameIndex, frameCount),
  };
};

/** How many lateral passes the head makes over the course of one sac. */
const PRINT_SWEEP_PASSES = 2.5;

const printingPose: PoseFn = (frameIndex, frameCount) => {
  const t = rowProgress(frameIndex, frameCount);
  const growth = lerp(PRINT_START_GROWTH, 1, easeInOut(t));
  return {
    ...RESTING_POSE,
    power: RUNNING_POWER,
    // The head climbs as its own work pushes it up — the printer read.
    nozzleTravel: 1 - growth * 0.92,
    nozzleSweep: Math.sin(t * Math.PI * 2 * PRINT_SWEEP_PASSES),
    nozzleHeat: 1,
    extruding: true,
    sacGrowth: growth,
    sacForm: 'printing',
    gauge: RUNNING_GAUGE,
    hopperLevel: lerp(HOPPER_FULL, HOPPER_SPENT, t),
    steam: 0.15,
    fluidPhase: loopPhase(frameIndex, frameCount),
  };
};

const dispensingPose: PoseFn = (frameIndex, frameCount) => {
  const t = rowProgress(frameIndex, frameCount);
  const shutter = easeInOut(clamp01(t * 2));
  // Splits only once it is clear of the machine, so the player reads the order
  // of events: printed, delivered, hatched.
  const splitFrame = lifeMachineSacSplitFrame(frameCount);
  const hasSplit = frameIndex >= splitFrame;
  const framesSinceSplit = frameIndex - splitFrame;
  const framesAfterSplit = Math.max(1, frameCount - 1 - splitFrame);
  return {
    ...RESTING_POSE,
    power: RUNNING_POWER,
    nozzleTravel: 0.1,
    nozzleHeat: 0.4 * (1 - t),
    sacGrowth: 1,
    sacForm: hasSplit ? 'split' : 'finished',
    sacTear: hasSplit ? clamp01(framesSinceSplit / framesAfterSplit) : 0,
    plateDrop: easeInOut(t),
    shutterOpen: shutter,
    gauge: lerp(RUNNING_GAUGE, 0.4, t),
    hopperLevel: HOPPER_SPENT,
    steam: hump(clamp01(t * 1.4)) * 0.9,
    fluidPhase: loopPhase(frameIndex, frameCount),
  };
};

const purgingPose: PoseFn = (frameIndex, frameCount) => {
  const t = rowProgress(frameIndex, frameCount);
  return {
    ...RESTING_POSE,
    power: lerp(RUNNING_POWER, IDLE_POWER, easeInOut(t)),
    nozzleTravel: lerp(0.1, 0, easeInOut(t)),
    nozzleHeat: 0.25 * (1 - t),
    sacGrowth: 1,
    sacForm: 'husk',
    // A husk stays as torn as it was left; only the shutters are closing.
    sacTear: 1,
    plateDrop: 1,
    shutterOpen: 1 - easeInOut(t),
    gauge: lerp(0.4, IDLE_GAUGE, t),
    hopperLevel: lerp(HOPPER_SPENT, HOPPER_FULL, easeInOut(t)),
    steam: (1 - t) * 0.35,
    fluidPhase: loopPhase(frameIndex, frameCount),
  };
};

/** Growth the abandoned sac was at when the terminal cut the power. */
const OFFLINE_ABANDONED_GROWTH = 0.55;

const offlinePose: PoseFn = (frameIndex, frameCount) => ({
  ...RESTING_POSE,
  power: 0,
  nozzleTravel: 1 - OFFLINE_ABANDONED_GROWTH * 0.92,
  nozzleHeat: 0,
  sacGrowth: OFFLINE_ABANDONED_GROWTH,
  sacForm: 'dead',
  sacTear: 0,
  plateDrop: 0,
  shutterOpen: 1,
  gauge: 0,
  hopperLevel: HOPPER_SPENT,
  // Barely moving: two frames of settling steam is the only sign of life left.
  steam: frameIndex === 0 ? 0.18 : 0.1,
  fluidPhase: loopPhase(frameIndex, frameCount),
});

/**
 * Lamp brightness ring. One lamp bright, one mid, one dim, rotated per frame —
 * a chase around the panel rather than three lamps blinking in step.
 */
const LAMP_CHANNELS: readonly number[] = [1, 0.55, 0.25];

interface Row {
  readonly name: string;
  readonly frameCount: number;
  readonly pose?: PoseFn;
  readonly lampColor?: string;
}

export const ROWS: readonly Row[] = [
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

// ── Bake ─────────────────────────────────────────────────────────────────────

export interface SheetGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly columns: number;
}

export function geometry(): SheetGeometry {
  return {
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    tileX: FOOTPRINT_TILE_X,
    tileY: FOOTPRINT_TILE_Y,
    tileScale: TILE_SCALE,
    columns: ROWS.reduce((widest, row) => Math.max(widest, row.frameCount), 0),
  };
}

function paintFrame(ctx: Ctx, row: Row, frameIndex: number): void {
  if (row.lampColor !== undefined) {
    drawLifeMachineLights(ctx, row.lampColor, frameIndex, LAMP_CHANNELS);
    return;
  }
  if (row.pose === undefined) return;
  drawLifeMachine(ctx, row.pose(frameIndex, row.frameCount));
}

export function bake(): Buffer {
  const { columns } = geometry();
  const sheet = createCanvas(columns * FRAME_W, ROWS.length * FRAME_H);
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(FRAME_W * SUPERSAMPLE, FRAME_H * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  ROWS.forEach((row, rowIndex) => {
    for (let frameIndex = 0; frameIndex < row.frameCount; frameIndex++) {
      cellCtx.save();
      cellCtx.clearRect(0, 0, cell.width, cell.height);
      cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
      paintFrame(cellCtx, row, frameIndex);
      cellCtx.restore();

      sheetCtx.drawImage(
        cell,
        0,
        0,
        cell.width,
        cell.height,
        frameIndex * FRAME_W,
        rowIndex * FRAME_H,
        FRAME_W,
        FRAME_H,
      );
    }
  });

  return sheet.toBuffer('image/png');
}

// ── Manifest gate ────────────────────────────────────────────────────────────

/**
 * The plinth is the only part of the machine a player can collide with; the
 * chamber and head hang over the tiles behind it, which stay walkable.
 */
function blockedRegions(): ReadonlyArray<Record<string, number>> {
  return [
    {
      x1: FOOTPRINT_TILE_X,
      y1: FOOTPRINT_TILE_Y,
      x2: FOOTPRINT_TILE_X + TILE_SCALE,
      y2: FRAME_H,
    },
  ];
}

function manifestEntry(): Record<string, unknown> {
  const geo = geometry();
  const states: Record<string, Record<string, number>> = {};
  ROWS.forEach((row, rowIndex) => {
    states[`${MANIFEST_KEY}_${row.name}`] = { row: rowIndex, frameCount: row.frameCount };
  });
  return {
    path: MANIFEST_SHEET_PATH,
    frameWidth: geo.frameWidth,
    frameHeight: geo.frameHeight,
    tileX: geo.tileX,
    tileY: geo.tileY,
    tileScale: geo.tileScale,
    blockedRegions: blockedRegions(),
    states,
  };
}

/** Key order is not meaningful in JSON, so compare sorted. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return nested;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(nested).sort()) {
      sorted[key] = Object.getOwnPropertyDescriptor(nested, key)?.value;
    }
    return sorted;
  });
}

/**
 * Checks `manifest.json` against the bake rather than rewriting it: other agents
 * work in this repo, and a programmatic rewrite of a shared file would clobber
 * their edits. A mismatch prints the entry to paste and fails the run — a sheet
 * on disk that its manifest does not describe renders as garbage.
 */
function verifyManifest(): void {
  const required = manifestEntry();
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  if (canonicalJson(manifest[MANIFEST_KEY]) !== canonicalJson(required)) {
    console.error(
      `\n${MANIFEST_PATH} is out of sync with the bake. Replace its "${MANIFEST_KEY}" entry with:\n` +
        `${JSON.stringify(required, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

function writeSheet(): void {
  const geo = geometry();
  console.log(`Generating life machine sprite sheet (tileScale=${TILE_SCALE})…`);
  writeFileSync(resolve(SHEET_PATH), bake());
  console.log(`  → ${SHEET_PATH}`);
  console.log(
    `  → ${geo.columns * FRAME_W}×${ROWS.length * FRAME_H}px ` +
      `(${ROWS.length} rows × ${geo.columns} cols of ${FRAME_W}×${FRAME_H})`,
  );
  ROWS.forEach((row, index) => {
    console.log(`     row ${index}: ${row.name} (${row.frameCount} frames)`);
  });
  verifyManifest();
}

// The review harness imports ROWS from here, so painting the sheet has to be
// something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheet();
}

export { SHEET_PATH, TILE_SCALE };
