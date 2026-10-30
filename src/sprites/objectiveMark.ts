/**
 * The mark over a world object the party has to go and deal with — a prize
 * on a pedestal, a machine to shut down: a quest beacon standing behind it
 * and a bouncing `!` hung over it, both in the objective gold.
 *
 * It marks a thing, not a person. A quest giver's beacon and glyph come from
 * its own marker state (`NpcQuestMarker`); an objective has no such
 * state, it is simply there to be done until its owner stops drawing the mark.
 */

import { worldPalette } from '../ui/theme/worldInk';
import { drawQuestBeacon } from './questBeacon';
import { drawQuestMarker } from './questNPCSprite';

/** Where a marked object stands this frame, in screen pixels. */
export interface ObjectiveMarkPlacement {
  /** The left edge of the tile the object stands on. */
  readonly tileLeft: number;
  /** The top edge of the tile the object stands on; the beam stands on its bottom. */
  readonly tileTop: number;
  readonly tileSize: number;
  /** The camera, which turns the tile back into a world position for the beam's nearness fade. */
  readonly camX: number;
  readonly camY: number;
  /** The highest pixel the object and anything over it paints; the `!` hangs clear above it. */
  readonly artTop: number;
  readonly timeMs: number;
}

const OBJECTIVE_MARK_GLYPH = '!';

/**
 * Paints the mark round `paintObject`: the beam first so it stands behind the
 * object, then the object, then the `!`. Call it from the object's own place
 * in the Y-sorted pass; the `!` defers itself above the darkness.
 */
export function drawObjectiveMark(
  ctx: CanvasRenderingContext2D,
  placement: ObjectiveMarkPlacement,
  paintObject: () => void,
): void {
  const { tileLeft, tileTop, tileSize, camX, camY, artTop, timeMs } = placement;
  const color = worldPalette.objective.ready;
  drawQuestBeacon(ctx, tileLeft, tileTop, tileSize, camX, camY, timeMs, color);
  paintObject();
  drawQuestMarker(ctx, tileLeft, artTop, tileSize, OBJECTIVE_MARK_GLYPH, color);
}
