import { drawSpriteKey, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';

/**
 * Draw wrappers for the three sheets a Lava Llama's spit is made of.
 *
 * Baked by `npm run gen:lava-ball` from `scripts/lavaBallArt.ts`.
 */

/** Frames per second the game loop runs at; the sheets are timed against it. */
const FRAMES_PER_SECOND = 60;

const BOLT_FRAMES = 8;
const BURST_FRAMES = 10;
const FLAME_FRAMES = 8;

/** Loop speed of the churn on the ball's crust. */
const BOLT_FPS = 14;
/** Loop speed of the fire patch. Fast enough to flicker, slow enough to read. */
const FLAME_FPS = 10;

/**
 * The ball in flight.
 *
 * `heading` is the direction of travel in radians; the sheet is drawn pointing
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
  drawSpriteKey(
    ctx,
    'llama_lava_bolt',
    'fly',
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
  drawSpriteKey(
    ctx,
    'llama_lava_burst',
    'burst',
    progressFrameIndex(progress, BURST_FRAMES),
    sx,
    sy,
    tileSize,
    {},
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
  drawSpriteKey(ctx, 'llama_lava_flame', 'burn', frame, sx, sy, tileSize, { alpha });
}
