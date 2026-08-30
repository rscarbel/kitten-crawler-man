/**
 * The Grotesque Spider's choreography: which pose each frame of each animation
 * holds, and the four figures that carry them.
 *
 * Four figures rather than one because the art shipped as four sheets, and the
 * cache admits a figure one row at a time against a per-figure ceiling: these
 * are the largest cells in the game at 320×384, so a single figure holding
 * locomotion *and* all three attacks would be the one creature able to reach
 * that ceiling while every row of it was still being played. Split, the boss
 * holds its walk row and the one attack it is performing.
 *
 * The `attack_*` rows are all painted facing the camera. The creature is drawn
 * rotated to its facing by its own sprite module, so a turned pose would turn
 * twice.
 */

import { figureStates, type FigureDef } from '../figure/figureDef';
import { drawGrotesqueSpider, type GrotesqueSpiderPose } from './grotesqueSpiderArt';

/**
 * Cell geometry, frozen from the sheets these figures replace. The parity run
 * against those sheets is what proved these five numbers.
 */
const FRAME_W = 320;
const FRAME_H = 384;
const TILE_X = 128;
const TILE_Y = 128;
const TILE_SCALE = 64;

const FACING_DOWN_X = 0;
const FACING_DOWN_Y = 1;
const FACING_UP_Y = -1;
const FACING_SIDE_X = 1;
const FACING_FLAT_Y = 0;

/** Attack rows hold their whole animation in one row, so their clock is progress. */
const ATTACK_CLOCK = 0;
const NO_PROGRESS = 0;

/**
 * Seconds of idle the row spans, one per frame: a whole breath cycle plus the
 * slow independent blinks, sampled coarsely enough that no two frames repeat.
 */
const IDLE_TIMES: readonly number[] = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0];

/**
 * Seconds of walking each frame samples.
 *
 * Spread across several leg-step cycles rather than one: the eight legs step at
 * mutually irrational frequencies, so a single cycle's worth of samples would
 * catch most of them in the same phase and the gait would read as a shuffle.
 */
const WALK_TIMES: readonly number[] = [0.0, 0.38, 0.76, 1.14, 1.52, 1.9, 2.28, 2.66];

const ATTACK_FRAMES = 16;

/** Evenly spaced progress steps 0→1 across an attack row. */
const ATTACK_STEPS: readonly number[] = Array.from(
  { length: ATTACK_FRAMES },
  (_, index) => index / (ATTACK_FRAMES - 1),
);

/**
 * How much faster the eyelids run than the spit wind-up they sit inside.
 *
 * The spit row freezes the body clock so the pose reads as one held breath, but
 * a creature with seven eyes and no blink over sixteen frames reads as dead, so
 * the lids keep their own accelerated clock.
 */
const SPIT_EYE_TIME_SCALE = 3;

/** The pose one frame of one row paints. */
export type PoseFor = (frame: number) => GrotesqueSpiderPose;

function walkRow(facingX: number, facingY: number): PoseFor {
  return (frame) => ({
    time: WALK_TIMES[frame],
    eyeTime: WALK_TIMES[frame],
    facingX,
    facingY,
    state: 'walk',
    stateProgress: NO_PROGRESS,
  });
}

const idleRow: PoseFor = (frame) => ({
  time: IDLE_TIMES[frame],
  eyeTime: IDLE_TIMES[frame],
  facingX: FACING_DOWN_X,
  facingY: FACING_DOWN_Y,
  state: 'idle',
  stateProgress: NO_PROGRESS,
});

const slamRow: PoseFor = (frame) => ({
  time: ATTACK_CLOCK,
  eyeTime: ATTACK_CLOCK,
  facingX: FACING_DOWN_X,
  facingY: FACING_DOWN_Y,
  state: 'attack_slam',
  stateProgress: ATTACK_STEPS[frame],
});

const screechRow: PoseFor = (frame) => ({
  time: ATTACK_CLOCK,
  eyeTime: ATTACK_CLOCK,
  facingX: FACING_DOWN_X,
  facingY: FACING_DOWN_Y,
  state: 'attack_screech',
  stateProgress: ATTACK_STEPS[frame],
});

const spitRow: PoseFor = (frame) => ({
  time: ATTACK_CLOCK,
  eyeTime: ATTACK_STEPS[frame] * SPIT_EYE_TIME_SCALE,
  facingX: FACING_DOWN_X,
  // Pupils dead ahead rather than cast down: over a wind-up this long, eyes
  // tracking the ground read as a creature looking away from its own attack.
  facingY: FACING_FLAT_Y,
  state: 'attack_spit',
  stateProgress: ATTACK_STEPS[frame],
});

/** Locomotion state names, as the base figure declares them. */
export type GrotesqueSpiderBaseState = 'idle' | 'walk_down' | 'walk_up' | 'walk_side';

const BASE_ROWS: ReadonlyMap<string, PoseFor> = new Map<GrotesqueSpiderBaseState, PoseFor>([
  ['idle', idleRow],
  ['walk_down', walkRow(FACING_DOWN_X, FACING_DOWN_Y)],
  ['walk_up', walkRow(FACING_DOWN_X, FACING_UP_Y)],
  ['walk_side', walkRow(FACING_SIDE_X, FACING_FLAT_Y)],
]);

const SLAM_ROWS: ReadonlyMap<string, PoseFor> = new Map([['attack_slam', slamRow]]);
const SCREECH_ROWS: ReadonlyMap<string, PoseFor> = new Map([['attack_screech', screechRow]]);
const SPIT_ROWS: ReadonlyMap<string, PoseFor> = new Map([['attack_spit', spitRow]]);

/**
 * The pose every shipped frame of every shipped row paints.
 *
 * Exported so a gate can measure the poses the game actually plays. A gate that
 * paints the painter with poses of its own can prove the painter draws all
 * eight legs, and still say nothing about a row whose frames never ask it to —
 * a sample table one entry short of its declared frame count hands the painter
 * an undefined time, and the whole creature resolves to NaN on that frame.
 */
export const GROTESQUE_SPIDER_ROW_POSES: ReadonlyMap<string, PoseFor> = new Map([
  ...BASE_ROWS,
  ...SLAM_ROWS,
  ...SCREECH_ROWS,
  ...SPIT_ROWS,
]);

function painterFor(rows: ReadonlyMap<string, PoseFor>) {
  return (ctx: CanvasRenderingContext2D, state: string, frame: number): void => {
    const poseFor = rows.get(state);
    if (poseFor === undefined) return;
    drawGrotesqueSpider(ctx, TILE_X, TILE_Y, TILE_SCALE, poseFor(frame));
  };
}

const LOCOMOTION_FRAMES = 8;

export const GROTESQUE_SPIDER_BASE_FIGURE: FigureDef = {
  id: 'grotesque_spider_base',
  frameWidth: FRAME_W,
  frameHeight: FRAME_H,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates({
    idle: LOCOMOTION_FRAMES,
    walk_down: LOCOMOTION_FRAMES,
    walk_up: LOCOMOTION_FRAMES,
    walk_side: LOCOMOTION_FRAMES,
  }),
  paintFrame: painterFor(BASE_ROWS),
};

export const GROTESQUE_SPIDER_SLAM_FIGURE: FigureDef = {
  id: 'grotesque_spider_slam',
  frameWidth: FRAME_W,
  frameHeight: FRAME_H,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates({ attack_slam: ATTACK_FRAMES }),
  paintFrame: painterFor(SLAM_ROWS),
};

export const GROTESQUE_SPIDER_SCREECH_FIGURE: FigureDef = {
  id: 'grotesque_spider_screech',
  frameWidth: FRAME_W,
  frameHeight: FRAME_H,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates({ attack_screech: ATTACK_FRAMES }),
  paintFrame: painterFor(SCREECH_ROWS),
};

export const GROTESQUE_SPIDER_SPIT_FIGURE: FigureDef = {
  id: 'grotesque_spider_spit',
  frameWidth: FRAME_W,
  frameHeight: FRAME_H,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates({ attack_spit: ATTACK_FRAMES }),
  paintFrame: painterFor(SPIT_ROWS),
};

/** Every figure the spider paints itself out of, for gates and harnesses. */
export const GROTESQUE_SPIDER_FIGURES: readonly FigureDef[] = [
  GROTESQUE_SPIDER_BASE_FIGURE,
  GROTESQUE_SPIDER_SLAM_FIGURE,
  GROTESQUE_SPIDER_SCREECH_FIGURE,
  GROTESQUE_SPIDER_SPIT_FIGURE,
];

export { ATTACK_FRAMES as GROTESQUE_SPIDER_ATTACK_FRAMES };
export { LOCOMOTION_FRAMES as GROTESQUE_SPIDER_LOCOMOTION_FRAMES };
