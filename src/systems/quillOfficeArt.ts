/**
 * The office's reveal lighting: the room falling dark and a pool of lamplight
 * closing on the magistrate's desk. World art, drawn with the room.
 */

import { TILE_SIZE } from '../core/constants';
import { drawRadialGlow } from '../sprites/radialGlow';
import { worldTint } from '../ui/world/worldShapes';

/** How far the room dims while the light is on the corpse. */
const REVEAL_DIM_ALPHA = 0.62;
const REVEAL_DIM_COLOR = '#04060a';
const REVEAL_SPOTLIGHT_RADIUS_TILES = 3.4;
/** A flat bright centre, so the light reads as a pool rather than a point. */
const REVEAL_SPOTLIGHT_CORE_FRACTION = 0.3;
const REVEAL_SPOTLIGHT_RGB = '236, 226, 190';
const REVEAL_SPOTLIGHT_ALPHA = 0.3;

/**
 * Dims the room and lights the desk, `fade` (0–1) of the way in, with the
 * pool centred on screen point (`centreX`, `centreY`).
 */
export function paintRevealLighting(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  fade: number,
): void {
  worldTint(ctx, REVEAL_DIM_COLOR, REVEAL_DIM_ALPHA * fade);
  drawRadialGlow(
    ctx,
    centreX,
    centreY,
    TILE_SIZE * REVEAL_SPOTLIGHT_RADIUS_TILES,
    [
      { offset: 0, color: `rgba(${REVEAL_SPOTLIGHT_RGB}, ${REVEAL_SPOTLIGHT_ALPHA})` },
      { offset: 1, color: `rgba(${REVEAL_SPOTLIGHT_RGB}, 0)` },
    ],
    REVEAL_SPOTLIGHT_CORE_FRACTION,
  );
}
