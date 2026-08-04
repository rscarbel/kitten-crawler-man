import { drawSpriteKey, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { getSpriteDefByKey, type SpriteKey, type SpriteStates } from '../core/SpriteLoader';

/**
 * Draw wrappers for the three sheets the Evil Clown's gas vials are made of.
 *
 * Baked by `npm run gen:clown-gas` from `scripts/clownGasArt.ts`.
 */

/** Frames per second the game loop runs at; the sheets are timed against it. */
const FRAMES_PER_SECOND = 60;

/**
 * How many frames a sheet's only row holds, read from the sheet the game loaded.
 *
 * Not a hand-copied table: `drawSprite` *clamps* the frame index, so a sheet
 * that got shorter in a rebake would silently freeze on its last frame rather
 * than throw, and there would be nothing to notice until someone watched that
 * one effect.
 */
function frameCountOf<K extends SpriteKey>(key: K, state: SpriteStates[K]): number {
  return getSpriteDefByKey(key)?.states.get(state)?.frameCount ?? 1;
}

/** Tumble speed of the thrown bottle. */
const VIAL_FPS = 12;
/** Billow speed of the cloud — slow, so it reads as heavy vapour, not fire. */
const GAS_FPS = 6;

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
  drawSpriteKey(
    ctx,
    'evil_clown_vial',
    'fly',
    timeFrameIndex(seconds, VIAL_FPS, frameCountOf('evil_clown_vial', 'fly')),
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
  drawSpriteKey(
    ctx,
    'evil_clown_shatter',
    'shatter',
    progressFrameIndex(progress, frameCountOf('evil_clown_shatter', 'shatter')),
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
  const gasFrames = frameCountOf('evil_clown_gas', 'billow');
  const frame = (timeFrameIndex(seconds, GAS_FPS, gasFrames) + seed) % gasFrames;
  drawSpriteKey(ctx, 'evil_clown_gas', 'billow', frame, sx, sy, tileSize, { alpha });
}
