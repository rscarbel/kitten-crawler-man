import { progressFrameIndex, timeFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  FIREBALL_BOLT_FIGURE,
  FIREBALL_BOLT_STATE,
  FIREBALL_BURST_FIGURE,
  FIREBALL_BURST_STATE,
  FIREBALL_FLAME_FIGURE,
  FIREBALL_FLAME_STATE,
} from './art/fireballFigure';
import { GLOB_BOLT_FRAMES, GLOB_BURST_FRAMES, GLOB_PUDDLE_FRAMES } from './art/globEffectKit';
import { WORLD_TICKS_PER_SECOND } from '../core/constants';

/**
 * Draw wrappers for the three effects a fireball is made of.
 *
 * Painted at runtime from `src/sprites/art/fireballArt.ts` through the figure
 * cache; reviewed with `npm run render:globs`.
 */

/**
 * Warms all three rows the moment the thrower starts its wind-up.
 *
 * The ball leaves partway through that animation and the burst and the fire
 * patch follow it, so the wind-up is lead for every one of them — and it is
 * the only telegraph any of them gets.
 */
export function prewarmFireball(): void {
  prewarmFigureState(FIREBALL_BOLT_FIGURE, FIREBALL_BOLT_STATE);
  prewarmFigureState(FIREBALL_BURST_FIGURE, FIREBALL_BURST_STATE);
  prewarmFigureState(FIREBALL_FLAME_FIGURE, FIREBALL_FLAME_STATE);
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
export function drawFireballBolt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  heading: number,
  ageFrames: number,
): void {
  const seconds = ageFrames / WORLD_TICKS_PER_SECOND;
  drawFigureCached(
    ctx,
    FIREBALL_BOLT_FIGURE,
    FIREBALL_BOLT_STATE,
    timeFrameIndex(seconds, BOLT_FPS, GLOB_BOLT_FRAMES),
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
export function drawFireballBurst(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  drawFigureCached(
    ctx,
    FIREBALL_BURST_FIGURE,
    FIREBALL_BURST_STATE,
    progressFrameIndex(progress, GLOB_BURST_FRAMES),
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
export function drawFireballFlame(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  ageFrames: number,
  seed: number,
  alpha: number,
): void {
  const seconds = ageFrames / WORLD_TICKS_PER_SECOND;
  const frame =
    (timeFrameIndex(seconds, FLAME_FPS, GLOB_PUDDLE_FRAMES) + seed) % GLOB_PUDDLE_FRAMES;
  drawFigureCached(ctx, FIREBALL_FLAME_FIGURE, FIREBALL_FLAME_STATE, frame, sx, sy, tileSize, {
    alpha,
  });
}
