import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  CLOWN_GAS_FIGURE,
  CLOWN_SHATTER_FIGURE,
  CLOWN_VIAL_FIGURE,
  GAS_FRAMES,
  GAS_STATE,
  SHATTER_FRAMES,
  SHATTER_STATE,
  VIAL_FRAMES,
  VIAL_STATE,
} from './art/clownGasFigure';

/**
 * Draw wrappers for the three figures the Evil Clown's gas vials are made of.
 *
 * Painted by `clownGasArt.ts`; review them with `npm run render:clowns`.
 */

/** Frames per second the game loop runs at; the rows are timed against it. */
const FRAMES_PER_SECOND = 60;

/** Tumble speed of the thrown bottle. */
const VIAL_FPS = 12;
/** Billow speed of the cloud — slow, so it reads as heavy vapour, not fire. */
const GAS_FPS = 6;

/**
 * Warms all three rows together, on the telegraph that precedes the first
 * throw.
 *
 * One call rather than three hooks because the three play in sequence with no
 * gap wide enough to bake in: the bottle is in the air for a few frames, the
 * shatter is one beat, and the cloud is already billowing behind it. The cloud
 * in particular is the most expensive thing this conversion paints, so it is
 * never allowed to reach the direct-paint fallback.
 */
export function prewarmClownGasRows(): void {
  prewarmFigureState(CLOWN_VIAL_FIGURE, VIAL_STATE);
  prewarmFigureState(CLOWN_SHATTER_FIGURE, SHATTER_STATE);
  prewarmFigureState(CLOWN_GAS_FIGURE, GAS_STATE);
}

/**
 * The bottle in flight, drawn about its own centre.
 *
 * `heightPx` lifts the sprite off the ground without moving the shadow: the
 * vial travels a lobbed arc, and the arc is a visual, so the damage and the
 * cloud still land on the flat world position underneath it.
 */
export function drawClownVial(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  ageFrames: number,
  heightPx: number,
): void {
  const seconds = ageFrames / FRAMES_PER_SECOND;
  drawFigureCached(
    ctx,
    CLOWN_VIAL_FIGURE,
    VIAL_STATE,
    timeFrameIndex(seconds, VIAL_FPS, VIAL_FRAMES),
    sx,
    sy - heightPx,
    tileSize,
    {},
  );
}

/**
 * The shatter. `progress` runs 0 on the frame of impact to 1 on the last frame.
 */
export function drawClownVialShatter(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  drawFigureCached(
    ctx,
    CLOWN_SHATTER_FIGURE,
    SHATTER_STATE,
    progressFrameIndex(progress, SHATTER_FRAMES),
    sx,
    sy,
    tileSize,
    {},
  );
}

/**
 * A lingering cloud.
 *
 * `seed` staggers the loop per cloud: several clouds billowing in step read as
 * one animated texture rather than as separate pockets of gas.
 */
export function drawClownGas(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  ageFrames: number,
  seed: number,
  alpha: number,
): void {
  const seconds = ageFrames / FRAMES_PER_SECOND;
  const frame = (timeFrameIndex(seconds, GAS_FPS, GAS_FRAMES) + seed) % GAS_FRAMES;
  drawFigureCached(ctx, CLOWN_GAS_FIGURE, GAS_STATE, frame, sx, sy, tileSize, { alpha });
}
