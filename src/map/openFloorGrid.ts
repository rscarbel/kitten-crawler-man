import { FloorTypeValue, type TileContent } from './tileTypes';

/** A square grid of plain dungeon floor, for a map that only needs ground to stand on. */
export function openFloorGrid(size: number): TileContent[][] {
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.tile_floor,
    })),
  );
}
