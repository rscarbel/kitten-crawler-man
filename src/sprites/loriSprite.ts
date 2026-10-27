import { timeFrameIndex, walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { type DrawnFigureRow, drawnFigureRow, figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  LORI_FIGURE,
  LORI_ROW_NAMES,
  LORI_VIEWS,
  type LoriRow,
  loriStateName,
} from './art/loriFigure';
import type { LoriView } from './art/loriArt';
import { LORI_IDLE_FPS } from './loriTiming';

export type { LoriRow } from './art/loriFigure';
export { LORI_TILES_PER_WALK_CYCLE } from './art/loriFigure';

/** Everything the Old Lori sprite needs to pick a cell. */
export interface LoriSpriteState {
  /** `idle` loops on the clock; `walk` plays by `walkPhase`. */
  readonly row: LoriRow;
  /** The way she faces; picks the view, and the profile's mirroring. */
  readonly facingX: number;
  readonly facingY: number;
  /** Walk cycle angle in radians, 0..2π. */
  readonly walkPhase: number;
  /** Seconds on any steady clock; drives the idle loop. */
  readonly timeSeconds: number;
}

/** Views split on whichever axis she faces hardest along. */
function viewFor(facingX: number, facingY: number): LoriView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/**
 * How many frames a state holds, read from the figure that paints it, so a
 * shortened row cannot freeze on a frame the cache clamps to.
 */
function frameCountOf(state: string): number {
  return Math.max(1, figureFrameCount(LORI_FIGURE, state));
}

function frameFor(state: LoriSpriteState, name: string): number {
  const count = frameCountOf(name);
  switch (state.row) {
    case 'idle':
      return timeFrameIndex(state.timeSeconds, LORI_IDLE_FPS, count);
    case 'walk':
      return walkFrameIndex(state.walkPhase, count);
    default: {
      const unhandled: never = state.row;
      throw new Error(`no clock for row ${String(unhandled)}`);
    }
  }
}

/**
 * Draws Old Lori. (sx, sy) is her tile's top-left on screen and `tileSize` the
 * tile size, like every other figure. Returns the row drawn so a caller can
 * hang a label or icon over the art's measured top.
 *
 * Only the profile is mirrored: head-on and from behind she carries the cane
 * in her own left hand, and flipping those views would swap it.
 */
export function drawLoriSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: LoriSpriteState,
): DrawnFigureRow {
  const view = viewFor(state.facingX, state.facingY);
  const name = loriStateName(state.row, view);
  const flipX = view === 'side' && state.facingX < 0;
  drawFigureCached(ctx, LORI_FIGURE, name, frameFor(state, name), sx, sy, tileSize, { flipX });
  return drawnFigureRow(LORI_FIGURE, name);
}

/** Frames in her walk row: the most one tick may advance its cycle is one of them. */
export function loriWalkFrames(): number {
  return frameCountOf(loriStateName('walk', 'side'));
}

/** One facing per 45° sector: every direction a caller can turn her. */
const SAMPLE_FACINGS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/**
 * Every state name the draw path can ask the figure for, composed from every
 * row at every facing through the same view choice the draw call makes, so a
 * view the figure does not paint is reported rather than left out.
 */
export function loriReachableStates(): readonly string[] {
  const names = LORI_ROW_NAMES.flatMap((row) =>
    SAMPLE_FACINGS.map(([facingX, facingY]) => loriStateName(row, viewFor(facingX, facingY))),
  );
  return [...new Set(names)];
}

/** Warms every row in every view, for the moment her cottage is being set up. */
export function prewarmLori(): void {
  for (const row of LORI_ROW_NAMES) {
    for (const view of LORI_VIEWS) prewarmFigureState(LORI_FIGURE, loriStateName(row, view));
  }
}
