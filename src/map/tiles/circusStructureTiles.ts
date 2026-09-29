/**
 * Renderer for the circus grounds' structures: the Big Top, the side-show
 * pavilions and the entry arch's posts.
 *
 * A structure is stamped as a footprint of blocked tiles. The one tile keyed
 * `circus:<structure>` draws the whole structure from its sheet and sorts on
 * its own foot; every other blocked tile carries `circus_part:<dx>,<dy>` and
 * only blocks. See `circusGroundsLayout.ts` for the keys and the footprints.
 */

import type { TileContent } from '../tileTypes';
import {
  getSpriteDefByKey,
  getSpriteExtentsPxByKey,
  type MapSpriteExtentsPx,
} from '../../core/SpriteLoader';
import { drawSprite } from '../../core/SpriteRenderer';
import {
  circusStructureFromSpriteKey,
  type CircusStructureId,
} from '../overworld/circusGroundsLayout';
import { circusStructureSheet } from '../../sprites/sheets/circusSheets';
import { tileHash } from './hollowTileHash';

/** The structure drawn from this tile, or null when the tile only blocks. */
export function circusStructureDrawnAt(
  structure: TileContent[][],
  tx: number,
  ty: number,
): CircusStructureId | null {
  return circusStructureFromSpriteKey(structure[ty]?.[tx]?.spriteKey);
}

/** Whether a circus structure tile draws anything itself. */
export function circusStructureDrawsAt(
  structure: TileContent[][],
  tx: number,
  ty: number,
): boolean {
  return circusStructureDrawnAt(structure, tx, ty) !== null;
}

const VARIANT_SALT = 0xc12c05;

/** Draws a circus structure from its drawing tile; the rest of the footprint draws nothing. */
export function drawCircusStructureTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const id = circusStructureDrawnAt(structure, tx, ty);
  if (id === null) return;
  const sheet = circusStructureSheet(id);
  const def = getSpriteDefByKey(sheet.key);
  const stateDef = def?.states.get(sheet.state);
  if (def === undefined || stateDef === undefined) return;
  // Fixed by position, so a structure never changes its look on a reload.
  const variant = tileHash(tx, ty, VARIANT_SALT) % Math.max(1, stateDef.frameCount);
  drawSprite(ctx, def, stateDef, variant, sx, sy, ts);
}

const NO_EXTENTS: MapSpriteExtentsPx = { left: 0, up: 0, right: 0, down: 0 };

/** How far a structure tile's art reaches past its own square: the sheet's envelope for the drawing tile, nothing elsewhere. */
export function circusStructureExtentsPx(
  structure: TileContent[][],
  tx: number,
  ty: number,
): MapSpriteExtentsPx {
  const id = circusStructureDrawnAt(structure, tx, ty);
  if (id === null) return NO_EXTENTS;
  return getSpriteExtentsPxByKey(circusStructureSheet(id).key) ?? NO_EXTENTS;
}
