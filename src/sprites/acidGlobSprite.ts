import { progressFrameIndex, timeFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  ACID_BOLT_STATE,
  ACID_BURST_STATE,
  ACID_GLOB_BOLT_FIGURE,
  ACID_GLOB_BURST_FIGURE,
  ACID_GLOB_PUDDLE_FIGURE,
  ACID_PUDDLE_STATE,
} from './art/acidGlobFigure';
import { GLOB_BOLT_FRAMES, GLOB_BURST_FRAMES, GLOB_PUDDLE_FRAMES } from './art/globEffectKit';

/**
 * Draw wrappers for the three effects an acid glob is made of.
 *
 * Painted at runtime from `src/sprites/art/acidGlobArt.ts` through the figure
 * cache; reviewed with `npm run render:globs`.
 */

/** Frames per second the game loop runs at; the art is timed against it. */
const FRAMES_PER_SECOND = 60;

/**
 * Warms all three rows the moment the thrower starts its wind-up: the glob
 * leaves partway through it and the splat and the puddle follow, so the
 * wind-up is the only lead any of them gets.
 */
export function prewarmAcidGlob(): void {
  prewarmFigureState(ACID_GLOB_BOLT_FIGURE, ACID_BOLT_STATE);
  prewarmFigureState(ACID_GLOB_BURST_FIGURE, ACID_BURST_STATE);
  prewarmFigureState(ACID_GLOB_PUDDLE_FIGURE, ACID_PUDDLE_STATE);
}

/** Loop speed of the glob's wobble. */
const BOLT_FPS = 12;
/**
 * Loop speed of the puddle. Slow: the bubbles have to swell rather than
 * flicker, which is most of the difference between a pool of acid and a fire.
 */
const PUDDLE_FPS = 5;

/**
 * The glob in flight. `heading` is the direction of travel in radians; the art
 * is drawn along +X and rotated here, so the trail always streams behind it.
 *
 * @param sx  glob centre in screen px
 * @param sy  glob centre in screen px
 */
export function drawAcidBolt(
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
    ACID_GLOB_BOLT_FIGURE,
    ACID_BOLT_STATE,
    timeFrameIndex(seconds, BOLT_FPS, GLOB_BOLT_FRAMES),
    sx,
    sy,
    tileSize,
    { rotation: heading },
  );
}

/** The splat. `progress` runs 0 on the frame of impact to 1 on its last frame. */
export function drawAcidBurst(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  drawFigureCached(
    ctx,
    ACID_GLOB_BURST_FIGURE,
    ACID_BURST_STATE,
    progressFrameIndex(progress, GLOB_BURST_FRAMES),
    sx,
    sy,
    tileSize,
  );
}

/**
 * A lingering acid puddle, anchored at its centre on the floor.
 *
 * `seed` staggers the loop per puddle so two pools side by side do not bubble
 * in step.
 */
export function drawAcidPuddle(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  ageFrames: number,
  seed: number,
  alpha: number,
): void {
  const seconds = ageFrames / FRAMES_PER_SECOND;
  const frame =
    (timeFrameIndex(seconds, PUDDLE_FPS, GLOB_PUDDLE_FRAMES) + seed) % GLOB_PUDDLE_FRAMES;
  drawFigureCached(ctx, ACID_GLOB_PUDDLE_FIGURE, ACID_PUDDLE_STATE, frame, sx, sy, tileSize, {
    alpha,
  });
}
