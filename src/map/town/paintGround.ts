/**
 * Ground passes: the impassable void border and the scatter that breaks up
 * otherwise flat expanses of grass and street.
 *
 * Scatter runs last, after every structure is placed, so it can be suppressed
 * over reserved plots — weeds painted under a building's art would show through
 * nowhere and be wasted, and dirt painted under it would fight the facade.
 */

import { FloorTypeValue, VOID_TYPE, GRASSY_WEED, DIRT_PATCH } from '../tileTypes';
import type { TileGrid } from './tileGrid';
import type { TileRect, TownPlan } from './townPlan';

/** Paints the impassable ring of void that frames the map. */
export function paintVoidBorder(grid: TileGrid, borderTiles: number): void {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      const isBorder =
        y < borderTiles ||
        y >= grid.size - borderTiles ||
        x < borderTiles ||
        x >= grid.size - borderTiles;
      if (isBorder) grid.set(x, y, VOID_TYPE);
    }
  }
}

/**
 * Scatters weeds over open grass and dirt patches over open street.
 *
 * The two passes sweep the map separately rather than deciding both in one
 * sweep so each keeps its own independent density.
 */
export function scatterGroundCover(
  grid: TileGrid,
  plan: TownPlan,
  borderTiles: number,
  reservedPlots: ReadonlyArray<TileRect>,
): void {
  const isReserved = (x: number, y: number) =>
    reservedPlots.some(
      (plot) => x >= plot.x && x < plot.x + plot.w && y >= plot.y && y < plot.y + plot.h,
    );

  const scatter = (sourceType: number, scatterType: number, density: number) => {
    for (let y = borderTiles + 1; y < grid.size - borderTiles - 1; y++) {
      for (let x = borderTiles + 1; x < grid.size - borderTiles - 1; x++) {
        if (isReserved(x, y)) continue;
        if (grid.typeAt(x, y) === sourceType && Math.random() < density) {
          grid.set(x, y, scatterType);
        }
      }
    }
  };

  scatter(FloorTypeValue.grass, GRASSY_WEED, plan.groundCover.weedDensityOnGrass);
  scatter(FloorTypeValue.road, DIRT_PATCH, plan.groundCover.dirtPatchDensityOnRoad);
}
