/**
 * The Grotesque Spider's eggs, drawn through the figure cache.
 *
 * The painting lives in `art/spiderEggArt.ts`. `incubate` is picked by hatch
 * progress rather than by time, so the countdown the art shows — the quickening
 * pulse, the two cracks, the last-quarter frenzy — is always exactly as far
 * along as the hatch timer.
 */

import { progressFrameIndex } from '../core/SpriteRenderer';
import { SPIDER_EGG_FRAMES, type SpiderEggState } from './art/spiderEggArt';
import { SPIDER_EGG_FIGURE, SPIDER_EGG_STATES } from './art/spiderEggFigure';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

export type { SpiderEggState } from './art/spiderEggArt';

/**
 * Draws an egg on the tile whose top-left is (sx, sy).
 *
 * @param progress 0→1 through the row: hatch progress for `incubate`, and how
 *                 far the landing, hatching or squashing has played otherwise.
 *                 `destroyed` holds its last frame at 1, which is the decal.
 */
export function drawSpiderEggSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  state: SpiderEggState,
  progress: number,
): void {
  const frame = progressFrameIndex(progress, SPIDER_EGG_FRAMES[state]);
  drawFigureCached(ctx, SPIDER_EGG_FIGURE, state, frame, sx, sy, ts);
}

/**
 * Warms every egg row. Called when the lay telegraphs: the eggs land a second
 * later, and the incubate row is the one on screen longest.
 */
export function prewarmSpiderEgg(): void {
  for (const state of SPIDER_EGG_STATES) prewarmFigureState(SPIDER_EGG_FIGURE, state);
}

/** The rows the draw call above can ask for, for the gates to check. */
export const SPIDER_EGG_RUNTIME_ROWS: readonly SpiderEggState[] = SPIDER_EGG_STATES;
