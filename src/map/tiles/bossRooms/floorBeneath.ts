import type { TileContent } from '../../tileTypes';
import { inferFloorType } from '../helpers';
import { drawTerrainTile } from '../terrainTiles';
import { drawSpecialFloorTile } from '../specialFloorTiles';

/** Paints the floor a flat decal or a prop recorded standing on. */
export function drawFloorBeneath(
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
