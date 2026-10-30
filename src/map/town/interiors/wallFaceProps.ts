/**
 * The placement rule for props set into a wall face (`mount: 'wall_face'`):
 * a window or a framed picture whose painter fills its own footprint. Such a
 * prop only reads as hung on the wall when that footprint is the face — wall
 * tiles with open floor directly south of every column, so the face is the
 * side the camera sees. Anywhere else it lies on the boards.
 */

import { INTERIOR_WALL, type TileContent } from '../../tileTypes';
import {
  TOWN_INTERIOR_PROPS,
  type TownInteriorPropId,
} from '../../../sprites/art/townInterior/townInteriorProps';

/** A prop as a layout places it: which one, and its footprint's north-west tile. */
export interface WallFacePlacementProbe {
  readonly propId: TownInteriorPropId;
  readonly x: number;
  readonly y: number;
}

type TileGrid = ReadonlyArray<ReadonlyArray<TileContent>>;

function tileTypeAt(grid: TileGrid, x: number, y: number): number | null {
  const insideGrid = y >= 0 && y < grid.length && x >= 0 && x < grid[y].length;
  return insideGrid ? grid[y][x].type : null;
}

function isWallTile(grid: TileGrid, x: number, y: number): boolean {
  return tileTypeAt(grid, x, y) === INTERIOR_WALL;
}

function isOpenTile(grid: TileGrid, x: number, y: number): boolean {
  const type = tileTypeAt(grid, x, y);
  return type !== null && type !== INTERIOR_WALL;
}

/**
 * Every `wall_face` prop in `placed` whose footprint is not a visible wall
 * face, described for an error or a gate line. Empty when all of them hang
 * where a face is drawn.
 */
export function wallFaceMisplacements(
  grid: TileGrid,
  placed: ReadonlyArray<WallFacePlacementProbe>,
): string[] {
  const misplaced: string[] = [];
  for (const prop of placed) {
    const def = TOWN_INTERIOR_PROPS[prop.propId];
    if (def.mount !== 'wall_face') continue;
    const { w, h } = def.footprint;
    const southOfFootprintRow = prop.y + h;
    let onFace = true;
    for (let dx = 0; dx < w; dx++) {
      const column = prop.x + dx;
      for (let dy = 0; dy < h; dy++) {
        if (!isWallTile(grid, column, prop.y + dy)) onFace = false;
      }
      if (!isOpenTile(grid, column, southOfFootprintRow)) onFace = false;
    }
    if (!onFace) misplaced.push(`'${prop.propId}' at ${prop.x},${prop.y}`);
  }
  return misplaced;
}
