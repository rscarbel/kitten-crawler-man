import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  BOLT_FRAMES,
  BURST_FRAMES,
  FLAME_FRAMES,
  LLAMA_LAVA_BOLT_FIGURE,
  LLAMA_LAVA_BURST_FIGURE,
  LLAMA_LAVA_FLAME_FIGURE,
} from './art/lavaBallFigure';

/**
 * Draw wrappers for the three effects a Lava Llama's spit is made of.
 *
 * Painted at runtime from `src/sprites/art/lavaBallArt.ts` through the figure
 * cache; reviewed with `npm run render:lava-ball`.
 */

/** Frames per second the game loop runs at; the art is timed against it. */
const FRAMES_PER_SECOND = 60;

const BOLT_STATE = 'fly';
const BURST_STATE = 'burst';
const FLAME_STATE = 'burn';

/**
 * Warms all three rows the moment the llama starts its wind-up.
 *
 * The ball leaves the mouth partway through that animation and the burst and
 * the fire patch follow it, so the wind-up is lead for every one of them — and
 * it is the only telegraph any of them gets.
 */
export function prewarmLavaSpit(): void {
  prewarmFigureState(LLAMA_LAVA_BOLT_FIGURE, BOLT_STATE);
  prewarmFigureState(LLAMA_LAVA_BURST_FIGURE, BURST_STATE);
  prewarmFigureState(LLAMA_LAVA_FLAME_FIGURE, FLAME_STATE);
}

/** Loop speed of the churn on the ball's crust. */
const BOLT_FPS = 14;
/** Loop speed of the fire patch. Fast enough to flicker, slow enough to read. */
const FLAME_FPS = 10;

/**
 * The ball in flight.
 *
 * `heading` is the direction of travel in radians; the art is drawn pointing
 * along +X and the runtime rotates it, so the ember trail always streams out
 * behind the ball rather than sitting at a fixed screen angle.
 *
 * @param sx  ball centre in screen px
 * @param sy  ball centre in screen px
 */
export function drawLavaBolt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  heading: number,
  ageFrames: number,
): void {
  const seconds = ageFrames / FRAMES_PER_SECOND;
  drawFigureCached(
    ctx,
    LLAMA_LAVA_BOLT_FIGURE,
    BOLT_STATE,
    timeFrameIndex(seconds, BOLT_FPS, BOLT_FRAMES),
    sx,
    sy,
    tileSize,
    { rotation: heading },
  );
}

/**
 * The impact explosion. `progress` runs 0 on the frame of impact to 1 on the
 * last frame of the burst.
 */
export function drawLavaBurst(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  drawFigureCached(
    ctx,
    LLAMA_LAVA_BURST_FIGURE,
    BURST_STATE,
    progressFrameIndex(progress, BURST_FRAMES),
    sx,
    sy,
    tileSize,
  );
}

/**
 * A lingering fire patch, anchored at its base so it sits on the floor.
 *
 * `seed` staggers the loop per patch: several patches burning in step read as
 * one animated texture rather than as separate fires.
 */
export function drawLavaFlame(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  ageFrames: number,
  seed: number,
  alpha: number,
): void {
  const seconds = ageFrames / FRAMES_PER_SECOND;
  const frame = (timeFrameIndex(seconds, FLAME_FPS, FLAME_FRAMES) + seed) % FLAME_FRAMES;
  drawFigureCached(ctx, LLAMA_LAVA_FLAME_FIGURE, FLAME_STATE, frame, sx, sy, tileSize, { alpha });
}
