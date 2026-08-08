/**
 * Draws one piece of Desperado Club furniture from the generated sprite sheets.
 *
 * The sheets store each variant as a frame of a single `idle` state, so a prop's
 * `variant` is the frame index and nothing here animates.
 */

import { TILE_SIZE } from '../core/constants';
import { drawSpriteKey } from '../core/SpriteRenderer';
import type { ClubProp } from '../core/clubProps';

/** Draws `prop` at its layout tile, offset by the camera and by any art shift. */
export function drawClubProp(
  ctx: CanvasRenderingContext2D,
  prop: ClubProp,
  camX: number,
  camY: number,
): void {
  const artTileX = prop.tile.x + (prop.artShiftTilesX ?? 0);
  drawSpriteKey(
    ctx,
    prop.sprite,
    'idle',
    prop.variant,
    artTileX * TILE_SIZE - camX,
    prop.tile.y * TILE_SIZE - camY,
    TILE_SIZE,
  );
}
