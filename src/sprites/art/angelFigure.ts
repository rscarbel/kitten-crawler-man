/**
 * Angel's choreography table and her `FigureDef`.
 *
 * She has one row per routine, and the rows play in a fixed order that loops:
 * each routine opens and closes on the same home pose beside the pole, so the
 * sequence chains without a pop and never visibly restarts. Each cell holds
 * her and her pole, anchored at the pole's base: the stage places the figure
 * by the pole's tile, and she moves round the pole inside her cell.
 *
 * The tables the runtime and the gates share live here: which frames of each
 * routine leave the floor, where a hand is on the pole, and which frames are
 * the routine's big moves for a crowd to answer.
 */

import { drawAngel } from './angel/draw';
import { solveDancePose, type AngelFrame, type DancePose } from './angel/dance/pose';
import {
  HIP_ROLL_FRAMES,
  ROUTINE_FRAMES,
  archFlipLook,
  hipRoll,
  poleWalk,
  swingSquat,
} from './angel/dance/routines';
import { ANGEL_FRAMES_PER_SECOND } from './angel/dance/tempo';
import { figureUnitsToTiles } from './angel/dance/stage';
import { DANCE_POLE_HEIGHT_TILES, DANCE_POLE_RADIUS_TILES } from './dancePole/dancePole';
import { FIGURE_SCALE, FIGURE_TOP_Y, FOOT_Y, TILE_GROUND_Y } from './angel/proportions';
import { type BodySide } from './angel/skeleton';
import { figureStates, type FigureDef } from '../figure/figureDef';

export const ANGEL_ROUTINES = ['hip_roll', 'pole_walk', 'swing_squat', 'arch_flip_look'] as const;
export type AngelRoutine = (typeof ANGEL_ROUTINES)[number];

/** How many frames each routine runs. */
export const ANGEL_ROUTINE_FRAMES: Readonly<Record<AngelRoutine, number>> = {
  hip_roll: HIP_ROLL_FRAMES,
  pole_walk: ROUTINE_FRAMES,
  swing_squat: ROUTINE_FRAMES,
  arch_flip_look: ROUTINE_FRAMES,
};

const ROUTINE_POSES: Readonly<Record<AngelRoutine, (frame: number) => DancePose>> = {
  hip_roll: hipRoll,
  pole_walk: poleWalk,
  swing_squat: swingSquat,
  arch_flip_look: archFlipLook,
};

/** The pose of one frame of a routine, before it is solved. */
export function angelPoseAt(routine: AngelRoutine, frame: number): DancePose {
  return ROUTINE_POSES[routine](frame);
}

/** One frame of a routine, solved for the painter. */
export function angelFrameAt(routine: AngelRoutine, frame: number): AngelFrame {
  return solveDancePose(angelPoseAt(routine, frame));
}

/* ── The sequencer ─────────────────────────────────────────────────────── */

/** The whole loop: every routine once, in order. */
export const ANGEL_SEQUENCE_FRAMES = ANGEL_ROUTINES.reduce(
  (total, routine) => total + ANGEL_ROUTINE_FRAMES[routine],
  0,
);
export { ANGEL_FRAMES_PER_SECOND };

export interface AngelSequenceFrame {
  readonly routine: AngelRoutine;
  readonly frame: number;
}

/**
 * Where the loop is on a given frame of it: which routine, and which frame of
 * that routine. Any integer is accepted and wrapped, so a performer can be
 * started part-way through the loop to keep two stages out of step.
 */
export function angelSequenceAt(sequenceFrame: number): AngelSequenceFrame {
  const wrapped =
    ((Math.floor(sequenceFrame) % ANGEL_SEQUENCE_FRAMES) + ANGEL_SEQUENCE_FRAMES) %
    ANGEL_SEQUENCE_FRAMES;
  let start = 0;
  for (const routine of ANGEL_ROUTINES) {
    const frames = ANGEL_ROUTINE_FRAMES[routine];
    if (wrapped < start + frames) return { routine, frame: wrapped - start };
    start += frames;
  }
  // Unreachable: `wrapped` is below the sum of every routine's frames.
  return { routine: ANGEL_ROUTINES[0], frame: 0 };
}

/** The loop frame playing `seconds` into a performance. */
export function angelSequenceFrameAtSeconds(seconds: number): number {
  return Math.floor(seconds * ANGEL_FRAMES_PER_SECOND);
}

/* ── Authored frame tables ─────────────────────────────────────────────── */

/** `[from, until)` frame ranges of a routine. */
export type FrameSpan = readonly [from: number, until: number];

/** Frames with both feet off the stage: the swing round the pole. */
export const ANGEL_AIRBORNE_FRAMES: Readonly<Record<AngelRoutine, readonly FrameSpan[]>> = {
  hip_roll: [],
  pole_walk: [],
  swing_squat: [[5, 23]],
  arch_flip_look: [],
};

/** Frames on which each hand is closed on the pole. Her left is -1, her right +1. */
export const ANGEL_POLE_CONTACT: Readonly<
  Record<AngelRoutine, Readonly<Record<BodySide, readonly FrameSpan[]>>>
> = {
  hip_roll: { [-1]: [[0, HIP_ROLL_FRAMES]], [1]: [] },
  pole_walk: { [-1]: [[0, 64]], [1]: [] },
  swing_squat: { [-1]: [[0, 64]], [1]: [[4, 19]] },
  arch_flip_look: {
    [-1]: [
      [0, 33],
      [58, 64],
    ],
    [1]: [[12, 33]],
  },
};

/**
 * The beats a crowd answers: the top of the swing, the bottom of the squat
 * with knees apart, the whip of the hair flip and the peak of the arch.
 */
export const ANGEL_BIG_MOVE_FRAMES: Readonly<Record<AngelRoutine, readonly number[]>> = {
  hip_roll: [],
  pole_walk: [],
  swing_squat: [13, 46],
  arch_flip_look: [13, 29],
};

export function inSpans(spans: readonly FrameSpan[], frame: number): boolean {
  return spans.some(([from, until]) => frame >= from && frame < until);
}

/* ── Cell geometry ─────────────────────────────────────────────────────── */

const TILE_SCALE = 64;
/** Cell pixels per figure unit. */
const CELL_PX_PER_UNIT = TILE_SCALE * FIGURE_SCALE;
const TILE_HALF = 0.5;
/** Where the stage floor sits inside the pole's tile, as a share of the tile from its top. */
export const ANGEL_GROUND_IN_TILE = TILE_HALF + TILE_GROUND_Y;
const GROUND_OFFSET_PX = Math.round(ANGEL_GROUND_IN_TILE * TILE_SCALE);

/**
 * Her cell about the pole's base, in tiles: she circles the pole and swings
 * out from it to either side, the pole rises above her reach, and walking
 * round in front of it her feet come down the screen below its base. Measured
 * from every painted cell with a few pixels of margin; the structural gate
 * fails a pose that reaches the edge, and the frozen-extent gate re-measures it.
 */
export const ANGEL_CELL_HALF_WIDTH_TILES = 1.11;
export const ANGEL_CELL_ABOVE_GROUND_TILES = 2.7;
export const ANGEL_CELL_BELOW_GROUND_TILES = 0.58;

const CELL_HALF_WIDTH_PX = Math.ceil(ANGEL_CELL_HALF_WIDTH_TILES * TILE_SCALE);
const CELL_GROUND_ROW = Math.ceil(ANGEL_CELL_ABOVE_GROUND_TILES * TILE_SCALE);

function paintAngelFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const routine = ANGEL_ROUTINES.find((candidate) => candidate === state);
  if (routine === undefined) return;
  ctx.save();
  try {
    ctx.translate(CELL_HALF_WIDTH_PX, CELL_GROUND_ROW);
    ctx.scale(CELL_PX_PER_UNIT, CELL_PX_PER_UNIT);
    ctx.translate(0, -FOOT_Y);
    drawAngel(ctx, angelFrameAt(routine, frame));
  } finally {
    ctx.restore();
  }
}

export const ANGEL_FIGURE: FigureDef = {
  id: 'angel',
  frameWidth: CELL_HALF_WIDTH_PX * 2,
  frameHeight: CELL_GROUND_ROW + Math.ceil(ANGEL_CELL_BELOW_GROUND_TILES * TILE_SCALE),
  tileX: CELL_HALF_WIDTH_PX - TILE_SCALE / 2,
  tileY: CELL_GROUND_ROW - GROUND_OFFSET_PX,
  tileScale: TILE_SCALE,
  states: figureStates(ANGEL_ROUTINE_FRAMES),
  paintFrame: paintAngelFrame,
  // She composes her silhouette shading on a scratch surface at whatever
  // density she is painted at, with bands sized in whole pixels of it.
  skipSupersample: true,
};

/** Cell pixels per figure unit, for gates measuring the art in figure units. */
export const ANGEL_CELL_PX_PER_UNIT = CELL_PX_PER_UNIT;
/** Where the pole's base sits in her cell, in cell pixels. */
export const ANGEL_POLE_BASE_IN_CELL = { x: CELL_HALF_WIDTH_PX, y: CELL_GROUND_ROW } as const;

/* ── The pole, for the stage ───────────────────────────────────────────── */

/**
 * The pole, in tiles, relative to the figure's tile: it stands on the stage
 * floor at the tile's centre and rises `heightTiles` above it. The stage owns
 * the pole's footprint for collision; the dancer's painter owns its pixels.
 */
export const ANGEL_POLE = {
  centreInTileX: TILE_HALF,
  floorInTileY: ANGEL_GROUND_IN_TILE,
  heightTiles: DANCE_POLE_HEIGHT_TILES,
  radiusTiles: DANCE_POLE_RADIUS_TILES,
} as const;

/** How far above the top edge of the pole's tile her head reaches standing, in tiles. */
export const ANGEL_HEAD_CLEARANCE_TILES =
  figureUnitsToTiles(FOOT_Y - FIGURE_TOP_Y) - ANGEL_GROUND_IN_TILE;
