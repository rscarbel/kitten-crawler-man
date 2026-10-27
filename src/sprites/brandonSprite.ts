/**
 * Brandon's runtime sprite: picks a row, a view and a frame from the state
 * the resident adapter hands it, and blits the cached cell.
 *
 * Each row advances the way its own table entry says (`BrandonRow.pacing`):
 * the walk by ground covered, the breathing idle by the clock with its
 * per-frame holds, and the salute by the progress of the greeting.
 */

import {
  BRANDON_ACTIONS,
  BRANDON_FIGURE,
  BRANDON_ROWS,
  BRANDON_VIEWS,
  BRANDON_TILES_PER_FIGURE_UNIT,
  BRANDON_WALK_GROUND_PER_CYCLE,
  type BrandonAction,
  brandonStateName,
} from './art/brandonFigure';
import type { BrandonView } from './art/brandonArt';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { drawnFigureRow, type DrawnFigureRow } from './figure/figureDef';
import { BRANDON_IDLE_FRAME_MS, brandonFrameAtProgress } from './brandonTiming';

export type { BrandonAction } from './art/brandonFigure';
export type { BrandonView } from './art/brandonArt';

/** Ground one walk cycle covers, in tiles: advance `progress` by distance over this. */
export const BRANDON_WALK_TILES_PER_CYCLE =
  BRANDON_WALK_GROUND_PER_CYCLE * BRANDON_TILES_PER_FIGURE_UNIT;

export interface BrandonSpriteState {
  /** The way he faces; any length. */
  readonly facingX: number;
  readonly facingY: number;
  readonly action: BrandonAction;
  /**
   * For the walk: the gait's phase in cycles (any real number; only its
   * fraction is used), advanced by ground covered over
   * {@link BRANDON_WALK_TILES_PER_CYCLE}. For the salute: 0 at its start, 1
   * at its end.
   */
  readonly progress: number;
  /**
   * Milliseconds on a clock of the caller's choosing, for the breathing idle.
   * Give each instance its own offset so two of him never breathe in lockstep.
   */
  readonly clockMs: number;
}

/**
 * The view a facing selects: well north of level is drawn from behind, well
 * to either side is drawn in profile, and the rest head-on — the same split
 * the human crawler's sprite uses, so the two turn together.
 */
const AWAY_THRESHOLD = -0.5;
const SIDEWAYS_THRESHOLD = 0.5;

export function brandonViewFor(facingX: number, facingY: number): BrandonView {
  const length = Math.hypot(facingX, facingY);
  const fx = length > 0 ? facingX / length : 0;
  const fy = length > 0 ? facingY / length : 1;
  if (fy < AWAY_THRESHOLD) return 'back';
  if (Math.abs(fx) > SIDEWAYS_THRESHOLD) return 'side';
  return 'front';
}

const IDLE_CYCLE_MS = BRANDON_IDLE_FRAME_MS.reduce((sum, ms) => sum + ms, 0);

/** The idle frame showing at a clock time, honouring each frame's own hold. */
export function brandonIdleFrameAt(clockMs: number): number {
  let into = ((clockMs % IDLE_CYCLE_MS) + IDLE_CYCLE_MS) % IDLE_CYCLE_MS;
  for (let frame = 0; frame < BRANDON_IDLE_FRAME_MS.length; frame++) {
    into -= BRANDON_IDLE_FRAME_MS[frame];
    if (into < 0) return frame;
  }
  return BRANDON_IDLE_FRAME_MS.length - 1;
}

/** The frame of a row a sprite state shows. */
export function brandonFrameFor(state: BrandonSpriteState): number {
  const row = BRANDON_ROWS[state.action];
  switch (row.pacing) {
    case 'clock':
      return brandonIdleFrameAt(state.clockMs);
    case 'ground': {
      const cycle = state.progress - Math.floor(state.progress);
      return Math.min(row.frames - 1, Math.floor(cycle * row.frames));
    }
    case 'progress':
      return brandonFrameAtProgress(row.frames, state.progress);
  }
}

/**
 * Draws Brandon with his tile's top-left at (`sx`, `sy`) on a tile `s`
 * pixels wide, returning the row drawn. Profile rows are painted facing +X
 * and mirrored for a facing to the left.
 */
export function drawBrandonSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: BrandonSpriteState,
): DrawnFigureRow {
  const view = brandonViewFor(state.facingX, state.facingY);
  const name = brandonStateName(state.action, view);
  drawFigureCached(ctx, BRANDON_FIGURE, name, brandonFrameFor(state), sx, sy, s, {
    flipX: view === 'side' && state.facingX < 0,
  });
  return drawnFigureRow(BRANDON_FIGURE, name);
}

/**
 * Every state name the runtime can ask for, composed by the same
 * `brandonStateName` the draw call uses, so the prewarm list, the draw call and
 * the gates can never name different rows.
 */
export function brandonReachableStates(): readonly string[] {
  return BRANDON_ACTIONS.flatMap((action) =>
    BRANDON_VIEWS.map((view) => brandonStateName(action, view)),
  );
}

/** Warms every row he can be drawn in, ahead of his first draw. */
export function prewarmBrandon(): void {
  for (const state of brandonReachableStates()) prewarmFigureState(BRANDON_FIGURE, state);
}
