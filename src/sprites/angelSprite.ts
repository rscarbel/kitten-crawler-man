/**
 * Angel, an exotic dancer, drawn through the figure cache: her pole and her
 * routines, played from the loop the sequencer keeps.
 *
 * The figure is anchored at the pole's base: `sx, sy` is the top-left of the
 * pole's tile, and she dances round the pole inside her own cell.
 */

import {
  ANGEL_FIGURE,
  ANGEL_HEAD_CLEARANCE_TILES,
  ANGEL_ROUTINES,
  angelSequenceAt,
  type AngelRoutine,
} from './art/angelFigure';
import { drawFigureCached, prewarmFigureState, touchFigureState } from './figure/figureFrameCache';

/**
 * How far above the top edge of the pole's tile anything floating over her
 * must sit to clear her head — a name plate, a prompt.
 */
export const ANGEL_OVERLAY_CLEARANCE = ANGEL_HEAD_CLEARANCE_TILES;

/** Her routines in the order the loop next plays them, starting with the one playing. */
function routinesFrom(playing: AngelRoutine): AngelRoutine[] {
  const start = ANGEL_ROUTINES.indexOf(playing);
  return ANGEL_ROUTINES.map((_unused, i) => ANGEL_ROUTINES[(start + i) % ANGEL_ROUTINES.length]);
}

/**
 * Holds every routine's row in the cache for as long as she is drawn.
 *
 * A pass of the loop is longer than the cache keeps a row nobody draws, so a
 * routine would be released while the others play and come back cold. A cold
 * cell is drawn as a stand-in — the nearest baked frame, or a frame of another
 * routine — and she appears to jump to another spot on the stage. Touching a
 * whole row keeps it; a row that is not whole is asked for again, the playing
 * one first and urgently so it bakes from the playhead.
 */
function keepAngelWarm(playing: AngelRoutine): void {
  routinesFrom(playing).forEach((routine, order) => {
    if (touchFigureState(ANGEL_FIGURE, routine)) return;
    const urgent = order === 0;
    prewarmFigureState(ANGEL_FIGURE, routine, undefined, urgent);
  });
}

/** Draws the frame of her loop at `sequenceFrame`, the pole's tile at `sx, sy`. */
export function drawAngelSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  sequenceFrame: number,
): void {
  const { routine, frame } = angelSequenceAt(sequenceFrame);
  keepAngelWarm(routine);
  drawFigureCached(ctx, ANGEL_FIGURE, routine, frame, sx, sy, tileSize);
}

/**
 * Queues every routine's cells for baking, in the order the loop plays them.
 * Call when the room she dances in is entered: each frame is too costly to
 * paint on demand.
 */
export function prewarmAngel(): void {
  for (const routine of ANGEL_ROUTINES) prewarmFigureState(ANGEL_FIGURE, routine);
}
