/**
 * A cast member's face for the conversation panel: their standing,
 * camera-facing cell, cropped to the head.
 *
 * The crop is placed from the rig's proportions rather than from the ink, so
 * a hoe or a spear held above the head never drags it off the face.
 */

import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../core/canvasSurface';
import { RATKIN_BUILDS } from './art/ratkin/outfit';
import { RATKIN_CAST_OUTFITS, type RatkinCastId } from './art/ratkin/cast';
import { drawRatkinCastSprite } from './ratkinCastSprite';
import { onCanvasRecovery } from '../core/canvasRecovery';

/** Side of the portrait, in pixels. Twice the panel's icon, so it stays crisp on a dense screen. */
const PORTRAIT_PX = 40;
/** The head fills this fraction of the portrait. */
const HEAD_FILL = 0.55;
/** A standard ratkin's head, measured on the idle front cell, as a fraction of the tile it stands on. */
const STANDARD_HEAD_TILES = 0.3;
/** Soles, below the tile's top edge, in tiles. */
const SOLE_TILES = 0.96;
/** A standard ratkin's head centre, above the soles, in tiles. */
const STANDARD_HEAD_HEIGHT_TILES = 1.24;
const HALF = 0.5;

const portraits = new Map<RatkinCastId, CanvasSurface>();
onCanvasRecovery(() => {
  for (const portrait of portraits.values()) releaseSurface(portrait);
  portraits.clear();
});

/**
 * A cast member's portrait as a conversation holds it: asked for its picture
 * each time it is drawn, never handed the surface itself. A recovery can then
 * give every painted portrait back at once, and an open conversation draws a
 * fresh one on its next frame rather than the blank it was holding.
 */
export interface RatkinPortraitHandle {
  image(): CanvasSurface;
}

/** The portrait for `id`, painted on first draw and kept until a recovery. */
export function ratkinPortrait(id: RatkinCastId): RatkinPortraitHandle {
  return { image: () => paintedPortrait(id) };
}

function paintedPortrait(id: RatkinCastId): CanvasSurface {
  const cached = portraits.get(id);
  if (cached !== undefined) return cached;
  const build = RATKIN_BUILDS[RATKIN_CAST_OUTFITS[id].build];
  const headTiles = STANDARD_HEAD_TILES * build.headScale * build.scale;
  const tileSize = (PORTRAIT_PX * HEAD_FILL) / headTiles;
  const headCentreBelowTileTop = (SOLE_TILES - STANDARD_HEAD_HEIGHT_TILES * build.scale) * tileSize;
  const surface = allocCanvas('ui', PORTRAIT_PX, PORTRAIT_PX);
  const ctx = surfaceContext(surface);
  const sx = PORTRAIT_PX * HALF - tileSize * HALF;
  const sy = PORTRAIT_PX * HALF - headCentreBelowTileTop;
  drawRatkinCastSprite(ctx, id, sx, sy, tileSize, {
    action: 'idle',
    walkPhase: 0,
    facingX: 0,
    facingY: 1,
    loopOffsetSeconds: 0,
  });
  portraits.set(id, surface);
  return surface;
}
