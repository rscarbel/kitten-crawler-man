/**
 * Draws the cellars' furniture and floor dressing.
 *
 * Solid pieces are drawn twice like every Y-sorted prop: the chunk bake paints
 * only the floor under them, and the overlay pass paints the piece over it, in
 * its wear state, at the variant its tile hashes to. A two-tile piece's part
 * tile is baked as bare floor by the service level's renderer and its anchor
 * draws the whole piece. The straw is baked flat into the floor; the candles
 * and fungus stand in the overlay pass over the floor the bake gave them.
 */

import { getManifestEntry, type MapSpriteExtentsPx } from '../../core/SpriteLoader';
import { drawSpriteKey, timeFrameIndex } from '../../core/SpriteRenderer';
import { CANDLE_FLAME_FRAMES } from '../../sprites/art/cellarProps/candleFlame';
import { CELLAR_PROP_VARIANTS, type CellarPropKey } from '../../sprites/sheets/cellarPropSheets';
import { frameTime } from '../../utils';
import { CELLAR_FLAT_DECAL_TILE_TYPES } from '../cellarProps';
import {
  BOTTLE_RACK,
  CANDLE_CLUSTER,
  CELLAR_TABLE,
  CLAY_URN,
  FALLEN_BEAM,
  GLOW_FUNGUS,
  GRAIN_SACK,
  RUBBLE_HEAP,
  RUBBLE_SLOPE,
  SARCOPHAGUS,
  SPEAR_RACK,
  STRAW_SCATTER,
  WINE_CASK,
  propSpriteState,
  type TileContent,
} from '../tileTypes';
import { inferFloorType } from './helpers';
import { drawSpecialFloorTile } from './specialFloorTiles';
import { drawTerrainTile } from './terrainTiles';
import { tileHash } from './hollowTileHash';

/** The sheet each cellar tile type is drawn from. */
export const CELLAR_SHEET_BY_TILE_TYPE: ReadonlyMap<number, CellarPropKey> = new Map<
  number,
  CellarPropKey
>([
  [CLAY_URN, 'clay_urn'],
  [GRAIN_SACK, 'grain_sack'],
  [WINE_CASK, 'wine_cask'],
  [BOTTLE_RACK, 'bottle_rack'],
  [CELLAR_TABLE, 'cellar_table'],
  [SPEAR_RACK, 'spear_rack'],
  [RUBBLE_HEAP, 'rubble_heap'],
  [RUBBLE_SLOPE, 'rubble_slope'],
  [FALLEN_BEAM, 'fallen_beam'],
  [SARCOPHAGUS, 'sarcophagus'],
  [CANDLE_CLUSTER, 'candle_cluster'],
  [STRAW_SCATTER, 'straw_scatter'],
  [GLOW_FUNGUS, 'glow_fungus'],
]);

/** Salt keeping the variant hash apart from every other per-tile hash. */
const VARIANT_SALT = 0xce11;
/** How fast a candle's flame sways through its loop. */
const CANDLE_FLAME_FPS = 5;

/** Which of a sheet's seeded looks the piece on this tile wears, standing or broken. */
export function cellarPropVariant(key: CellarPropKey, tx: number, ty: number): number {
  return tileHash(tx, ty, VARIANT_SALT) % CELLAR_PROP_VARIANTS[key];
}

function drawFloorUnder(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const floorType = inferFloorType(structure, tx, ty);
  if (!drawTerrainTile(ctx, structure, floorType, sx, sy, ts, tx, ty)) {
    drawSpecialFloorTile(ctx, structure, floorType, sx, sy, ts, tx, ty);
  }
}

/**
 * Draws a cellar tile, or returns false for any other type. With `baseOnly`,
 * a piece in the overlay pass draws only the floor it stands on.
 */
export function drawCellarPropTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  baseOnly: boolean,
): boolean {
  const key = CELLAR_SHEET_BY_TILE_TYPE.get(type);
  if (key === undefined) return false;
  const variant = cellarPropVariant(key, tx, ty);
  if (CELLAR_FLAT_DECAL_TILE_TYPES.has(type)) {
    drawFloorUnder(ctx, structure, sx, sy, ts, tx, ty);
    drawSpriteKey(ctx, 'straw_scatter', 'idle', variant, sx, sy, ts);
    return true;
  }
  if (baseOnly) {
    drawFloorUnder(ctx, structure, sx, sy, ts, tx, ty);
    return true;
  }
  const state = propSpriteState(structure[ty]?.[tx]?.damageStage);
  if (key === 'candle_cluster') {
    const phase = timeFrameIndex(frameTime, CANDLE_FLAME_FPS, CANDLE_FLAME_FRAMES);
    drawSpriteKey(ctx, key, state, variant * CANDLE_FLAME_FRAMES + phase, sx, sy, ts);
    return true;
  }
  if (key === 'sarcophagus') {
    drawSpriteKey(ctx, key, 'idle', variant, sx, sy, ts);
    return true;
  }
  drawSpriteKey(ctx, key, state, variant, sx, sy, ts);
  return true;
}

/**
 * How far a cellar piece's art reaches past its anchor tile, read off its
 * sheet's envelope so culling and the sheet cannot disagree.
 */
export function cellarPropExtentsPx(type: number, ts: number): MapSpriteExtentsPx | null {
  const key = CELLAR_SHEET_BY_TILE_TYPE.get(type);
  if (key === undefined) return null;
  const entry = getManifestEntry(key);
  const scale = ts / entry.tileScale;
  return {
    left: entry.tileX * scale,
    up: entry.tileY * scale,
    right: (entry.frameWidth - entry.tileX) * scale - ts,
    down: (entry.frameHeight - entry.tileY) * scale - ts,
  };
}
