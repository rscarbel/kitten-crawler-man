import { progressFrameIndex } from '../core/SpriteRenderer';
import { figureFrameCount, type FigureDef } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  GOLEM_ROCK_BURST_FIGURE,
  GOLEM_ROCK_FIGURE,
  ROCK_EFFECT_STATE,
} from './art/rockGolemFigure';

/**
 * How much bigger than a tile each figure is drawn. Both anchor on their own
 * cell centre, so the caller passes the impact point straight through and does
 * no offset arithmetic of its own — which is where a half-tile shift used to
 * creep in, because half the scaled frame is not half a tile.
 */
const ROCK_DRAW_TILES = 1;
const BURST_DRAW_TILES = 1.6;

function frameCountOf(figure: FigureDef): number {
  return Math.max(1, figureFrameCount(figure, ROCK_EFFECT_STATE));
}

/**
 * Warms both effect rows when a golem starts a throw.
 *
 * The projectile and its burst are two frames apart in play — the rock lands
 * and shatters in the same beat — so warming them together is the only way the
 * shatter is ready when the rock arrives.
 */
export function prewarmGolemRock(): void {
  prewarmFigureState(GOLEM_ROCK_FIGURE, ROCK_EFFECT_STATE);
  prewarmFigureState(GOLEM_ROCK_BURST_FIGURE, ROCK_EFFECT_STATE);
}

const FULL_TURN = Math.PI * 2;

/** The thrown boulder, tumbling. `spin` is its accumulated rotation in radians. */
export function drawGolemRock(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tileSize: number,
  spin: number,
): void {
  const size = tileSize * ROCK_DRAW_TILES;
  const turn = ((spin % FULL_TURN) + FULL_TURN) % FULL_TURN;
  drawFigureCached(
    ctx,
    GOLEM_ROCK_FIGURE,
    ROCK_EFFECT_STATE,
    progressFrameIndex(turn / FULL_TURN, frameCountOf(GOLEM_ROCK_FIGURE)),
    cx,
    cy,
    size,
  );
}

/** The rubble burst where a rock shattered. `progress` runs 0 → 1 across it. */
export function drawGolemRockBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tileSize: number,
  progress: number,
): void {
  const size = tileSize * BURST_DRAW_TILES;
  drawFigureCached(
    ctx,
    GOLEM_ROCK_BURST_FIGURE,
    ROCK_EFFECT_STATE,
    progressFrameIndex(progress, frameCountOf(GOLEM_ROCK_BURST_FIGURE)),
    cx,
    cy,
    size,
  );
}
