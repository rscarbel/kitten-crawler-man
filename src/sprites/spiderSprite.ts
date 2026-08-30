import { walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';
import {
  CROUCH_FRAMES,
  DEATH_FRAMES,
  IDLE_FRAMES,
  POUNCE_FRAMES,
  SPIDER_FIGURE,
  WALK_FRAMES,
} from './art/spiderFigure';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/**
 * Small spider sprite — a top-down figure painted facing north and rotated to
 * the spider's heading, so one orientation covers every direction.
 *
 * The figure's tileX/tileY are the rotation pivot (the cell centre), not a tile
 * top-left, so this sprite must always be drawn through `drawSpiderSprite`,
 * which passes the anchor and rotation the pivot expects.
 *
 * Review it with `npm run render:spider`.
 */

const TILE_CENTER_FRACTION = 0.5;
/** The art faces -Y, so a heading of (1,0) needs a quarter turn to face east. */
const SPRITE_FACING_OFFSET = Math.PI / 2;

export type SpiderDeathStyle = 'death_curl' | 'death_spasm' | 'death_flip';

/**
 * What the spider is doing this frame. Cycles are in radians (a full gait or
 * idle loop is 2π); progresses run 0→1 across a one-shot animation.
 */
export type SpiderAnimation =
  | { readonly kind: 'idle'; readonly cycle: number }
  | { readonly kind: 'walk'; readonly cycle: number }
  | { readonly kind: 'crouch'; readonly progress: number }
  | { readonly kind: 'pounce'; readonly progress: number }
  | { readonly kind: 'dying'; readonly style: SpiderDeathStyle; readonly progress: number };

export function drawSpiderSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  facingX: number,
  facingY: number,
  animation: SpiderAnimation,
  alpha = 1,
): void {
  const anchorX = sx + tileSize * TILE_CENTER_FRACTION;
  const anchorY = sy + tileSize * TILE_CENTER_FRACTION;
  const rotation = Math.atan2(facingY, facingX) + SPRITE_FACING_OFFSET;
  const opts = { rotation, alpha };

  switch (animation.kind) {
    case 'idle':
      drawFigureCached(
        ctx,
        SPIDER_FIGURE,
        'idle',
        walkFrameIndex(animation.cycle, IDLE_FRAMES),
        anchorX,
        anchorY,
        tileSize,
        opts,
      );
      return;
    case 'walk':
      drawFigureCached(
        ctx,
        SPIDER_FIGURE,
        'walk',
        walkFrameIndex(animation.cycle, WALK_FRAMES),
        anchorX,
        anchorY,
        tileSize,
        opts,
      );
      return;
    case 'crouch':
      drawFigureCached(
        ctx,
        SPIDER_FIGURE,
        'crouch',
        progressFrameIndex(animation.progress, CROUCH_FRAMES),
        anchorX,
        anchorY,
        tileSize,
        opts,
      );
      return;
    case 'pounce':
      drawFigureCached(
        ctx,
        SPIDER_FIGURE,
        'pounce',
        progressFrameIndex(animation.progress, POUNCE_FRAMES),
        anchorX,
        anchorY,
        tileSize,
        opts,
      );
      return;
    case 'dying':
      drawFigureCached(
        ctx,
        SPIDER_FIGURE,
        animation.style,
        progressFrameIndex(animation.progress, DEATH_FRAMES),
        anchorX,
        anchorY,
        tileSize,
        opts,
      );
      return;
  }
}

/** The rows a spider draws while it is only walking around and looking. */
export const SPIDER_APPROACH_STATES: ReadonlyArray<string> = ['idle', 'walk'];

/**
 * The rows a spider reaches only once it has a crawler to hunt: the wind-up,
 * the leap, and the three ways it can die.
 *
 * The deaths are in here rather than behind a telegraph of their own because
 * they have none — a killing blow lands on whatever frame it lands on, and a
 * cold death row is a full-cell paint on that frame. Noticing a crawler is the
 * only warning the creature ever gives.
 */
export const SPIDER_COMBAT_STATES: ReadonlyArray<string> = [
  'crouch',
  'pounce',
  'death_curl',
  'death_spasm',
  'death_flip',
];

/** Every state `drawSpiderSprite` can ask the figure for. */
export const SPIDER_STATES: ReadonlyArray<string> = [
  ...SPIDER_APPROACH_STATES,
  ...SPIDER_COMBAT_STATES,
];

/**
 * Warms the rows a spider about to exist will draw.
 *
 * Called where the spawn is *scheduled* — a life machine committing to a print
 * run, or the floor spawner building the level — rather than where the mob
 * first renders. One spider cell is a quarter of a megabyte and costs more to
 * paint than the fallback threshold allows, so every row this creature can
 * reach is warmed rather than left to a direct paint.
 */
export function prewarmSmallSpider(): void {
  for (const state of SPIDER_APPROACH_STATES) prewarmFigureState(SPIDER_FIGURE, state);
}

/** Warms the hunt: called the moment a spider first notices a crawler. */
export function prewarmSmallSpiderCombat(): void {
  for (const state of SPIDER_COMBAT_STATES) prewarmFigureState(SPIDER_FIGURE, state);
}
