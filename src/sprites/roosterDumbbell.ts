/**
 * The dumbbell in Big Rooster's fist, drawn at the hand anchor the figure
 * publishes for that frame.
 *
 * The dumbbell is not baked into any row: he is empty-handed for part of every
 * fight and a cached cell cannot carry a conditional prop. The figure solves
 * where his right fist is and which way it points on every held frame
 * (`BIG_ROOSTER_HAND_ANCHORS` in `art/roosterFigure.ts`), and this draws the
 * gym's own dumbbell there, its bar laid across the fist. Kept apart from the
 * sprite wrapper so the offline review harness draws it exactly as the game
 * does.
 */

import { drawDumbbellHeld } from './gymEquipmentSprite';
import type { HandAnchor } from './art/roosterFigure';
import { TILE_CENTER_OFFSET } from './figure/figureFrameCache';

/** The dumbbell's size against a tile, sized to his fist. */
const DUMBBELL_TILE_SCALE = 1.3;
/** `drawDumbbellHeld` lays its bar level at the middle of its swing; the anchor's angle turns it from there. */
const LEVEL_BAR_PROGRESS = 0.5;

/**
 * Draws the held dumbbell for one frame. `flipX` mirrors it with a profile
 * drawn facing −X, about the tile's centre, the axis the body's cached blit
 * mirrors about.
 */
export function drawRoosterDumbbell(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  anchor: HandAnchor,
  flipX: boolean,
): void {
  ctx.save();
  try {
    if (flipX) {
      const axis = sx + tileSize * TILE_CENTER_OFFSET;
      ctx.translate(axis, 0);
      ctx.scale(-1, 1);
      ctx.translate(-axis, 0);
    }
    ctx.translate(sx + anchor.at.x * tileSize, sy + anchor.at.y * tileSize);
    ctx.rotate(anchor.angle);
    drawDumbbellHeld(ctx, 0, 0, tileSize * DUMBBELL_TILE_SCALE, LEVEL_BAR_PROGRESS);
  } finally {
    ctx.restore();
  }
}
