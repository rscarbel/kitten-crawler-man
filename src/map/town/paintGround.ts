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
 * Scatters weeds over open grass and worn patches over the packed-earth tracks.
 *
 * The two passes sweep the map separately rather than deciding both in one
 * sweep so each keeps its own independent density.
 *
 * **The verge gets no scatter**, though it is the town's soft ground and looks
 * like the obvious place for weeds. `GRASSY_WEED` reports `grass` as the material
 * under its tufts — correctly, since that is what it is scattered on outdoors —
 * so painted onto a verge it draws the *field grass* row instead of the verge row,
 * and because grass is the softest material in the blend order it also becomes an
 * island the surrounding verge bleeds into through the corner masks, eroding the
 * tuft the tile exists to show. It put about four tiles of the wrong material
 * inside the walls per generation and broke the rule that every surface inside
 * the walls is a decision, in the only place that matters — what gets drawn. The verge material
 * already depicts grass invaded by stone and weeds, so nothing is lost; planting
 * inside the walls is `paintYards`'s job, and any decoration for it needs its own
 * tile type mapping to `verge` rather than a reuse of the outdoor one.
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
  // Only the packed-earth track takes worn patches. The town's paved materials are
  // broken up by the renderer's own world-space tone and by the fringe where they
  // meet, and a scatter of worn dirt across cobble would read as neglect on a
  // street that is supposed to be the town's spine.
  scatter(FloorTypeValue.road, DIRT_PATCH, plan.groundCover.dirtPatchDensityOnRoad);
}
