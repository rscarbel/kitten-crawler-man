/**
 * The sparkle a hireling's heal leaves on whoever it lands on: a healer's
 * patient, or the hireling itself mending between fights. One figure for every
 * heal a hire gives, so a heal reads the same whoever cast it.
 */

import { progressFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { drawHealSparkle } from './art/healSparkleArt';
import { type FigureDef, figureFrameCount, figureStates } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/** Tile size the art is painted at; the runtime scales by tileSize / this. */
const TILE_SCALE = 64;
/** The ground line's row within the tile, matched to the figures it lands on. */
const GROUND_ROW_IN_TILE = 58;
const HEAL_SPARKLE_FRAME_WIDTH = 96;
/** Tall enough for the motes that rise a body's height off the floor. */
const HEAL_SPARKLE_FRAME_HEIGHT = 128;
const HEAL_SPARKLE_TILE_X = 16;
const HEAL_SPARKLE_TILE_Y = 56;
const HEAL_SPARKLE_FRAMES = 10;
const HALF = 0.5;

/** How long the sparkle plays once a heal lands. */
export const HEAL_SPARKLE_DURATION_MS = 700;

export const HEAL_SPARKLE_STATE = 'sparkle';

/** One-shots run first frame to last, both ends drawn. */
function shotT(frame: number, frames: number): number {
  return frames <= 1 ? 1 : frame / (frames - 1);
}

export const HEAL_SPARKLE_FIGURE: FigureDef = {
  id: 'heal_sparkle',
  frameWidth: HEAL_SPARKLE_FRAME_WIDTH,
  frameHeight: HEAL_SPARKLE_FRAME_HEIGHT,
  tileX: HEAL_SPARKLE_TILE_X,
  tileY: HEAL_SPARKLE_TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates({ [HEAL_SPARKLE_STATE]: HEAL_SPARKLE_FRAMES }),
  paintFrame: (ctx, state, frame) => {
    if (state !== HEAL_SPARKLE_STATE) return;
    ctx.save();
    ctx.translate(
      HEAL_SPARKLE_TILE_X + TILE_SCALE * HALF,
      HEAL_SPARKLE_TILE_Y + GROUND_ROW_IN_TILE,
    );
    ctx.scale(TILE_SCALE, TILE_SCALE);
    drawHealSparkle(ctx, shotT(frame, HEAL_SPARKLE_FRAMES));
    ctx.restore();
  },
};

/**
 * Draws the sparkle on a healed creature's tile. `progress` runs 0 (the heal
 * lands) to 1 (gone), over {@link HEAL_SPARKLE_DURATION_MS}.
 */
export function drawHealSparkleSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  const frames = Math.max(1, figureFrameCount(HEAL_SPARKLE_FIGURE, HEAL_SPARKLE_STATE));
  const frame = progressFrameIndex(progress, frames);
  drawFigureCached(ctx, HEAL_SPARKLE_FIGURE, HEAL_SPARKLE_STATE, frame, sx, sy, tileSize);
}

/** Warmed with the hire, so the first heal it gives is ready when it lands. */
export function prewarmHealSparkle(): void {
  prewarmFigureState(HEAL_SPARKLE_FIGURE, HEAL_SPARKLE_STATE);
}
