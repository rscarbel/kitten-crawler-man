/**
 * Rasterises the town's streets onto the tile grid: the main crossroads, the
 * plaza slab, the stub of street each building's door opens onto, and the
 * detours that keep a building from severing a road it happens to sit across.
 */

import { FloorTypeValue } from '../tileTypes';
import type { TileGrid } from './tileGrid';
import type { TilePoint, TileRect, TownPlan } from './townPlan';
import type { SpritePlacement } from './paintPlots';

/**
 * Widest street drawn in front of a door. Wider doorways would read as a plaza
 * rather than a street; The Horned Flagon's four-tile front is the only town
 * doorway this actually clamps.
 */
const DOOR_STREET_MAX_WIDTH = 3;

/** Both rows of a frontage run are paved, so the turn reads as a street not a path. */
const FRONTAGE_RUN_ROWS = 2;

/** Approach roads are paved this many tiles either side of their centre line. */
const APPROACH_HALF_WIDTH = 1;

/** Paints the two full-width roads that cross at the town centre. */
export function paintMainRoads(grid: TileGrid, plan: TownPlan, borderTiles: number): void {
  const span = grid.size - borderTiles * 2;
  const halfWidth = Math.floor(plan.mainRoadWidth / 2);
  const eastWest: TileRect = {
    x: borderTiles,
    y: plan.centre.y - halfWidth,
    w: span,
    h: plan.mainRoadWidth,
  };
  const northSouth: TileRect = {
    x: plan.centre.x - halfWidth,
    y: borderTiles,
    w: plan.mainRoadWidth,
    h: span,
  };
  grid.fill(eastWest, FloorTypeValue.road);
  grid.fill(northSouth, FloorTypeValue.road);
}

export function paintTownSquare(grid: TileGrid, plan: TownPlan): void {
  grid.fill(plan.square, FloorTypeValue.road);
}

/**
 * Draws the street a sprite building's door opens onto. Every building sprite
 * faces south, so the stub always leaves the doorway southward until it clears
 * the art, then either continues to the E-W road (buildings sitting north of it)
 * or turns along the building's frontage to reach the N-S road (buildings well
 * south of it). Routing out of the footprint first is what keeps road tiles from
 * being painted through a building's own silhouette.
 *
 * A building that takes neither branch still connects: every sprite's doorway is
 * pinned to the row above its front row, so the stub always paves both of those
 * rows, and for any front row within `frontageTurnThreshold` of the centre that
 * run lands on or against the E-W road band.
 */
export function connectDoorToStreet(
  grid: TileGrid,
  plan: TownPlan,
  placement: SpritePlacement,
): void {
  const width = Math.min(placement.doorwayWidth, DOOR_STREET_MAX_WIDTH);
  const startX = placement.doorTile.x - Math.floor((width - 1) / 2);
  const drawRow = (row: number) => {
    for (let i = 0; i < width; i++) grid.setRoad(startX + i, row);
  };

  const frontRow = placement.rect.y + placement.rect.h;
  const northRoadEdge = plan.centre.y - Math.floor(plan.mainRoadWidth / 2);
  const stubEnd = frontRow < northRoadEdge ? northRoadEdge : frontRow;
  for (let row = placement.doorTile.y; row <= stubEnd; row++) drawRow(row);

  if (frontRow <= plan.centre.y + plan.frontageTurnThreshold) return;

  const halfWidth = Math.floor(plan.mainRoadWidth / 2);
  const targetX =
    placement.doorTile.x < plan.centre.x ? plan.centre.x - halfWidth : plan.centre.x + halfWidth;
  const minX = Math.min(startX, targetX);
  const maxX = Math.max(startX + width - 1, targetX);
  for (let x = minX; x <= maxX; x++) {
    for (let row = 0; row < FRONTAGE_RUN_ROWS; row++) grid.setRoad(x, frontRow + row);
  }
}

/**
 * Links an outlying site — today only the circus — to both arms of the main
 * crossroads: one road south or north from the site's edge, one east or west
 * from its centre.
 */
export function connectSiteToMainRoads(
  grid: TileGrid,
  plan: TownPlan,
  site: TilePoint,
  siteRadius: number,
): void {
  const { x: cx, y: cy } = plan.centre;
  const halfRoad = Math.floor(plan.mainRoadWidth / 2);

  const gateY = site.y + siteRadius + 1;
  const targetRoadY = gateY < cy ? cy - halfRoad : cy + plan.approachRoadStopOffset;
  for (let y = Math.min(gateY, targetRoadY); y <= Math.max(gateY, targetRoadY); y++) {
    for (let dx = -APPROACH_HALF_WIDTH; dx <= APPROACH_HALF_WIDTH; dx++) {
      grid.setRoad(site.x + dx, y);
    }
  }

  const targetRoadX = site.x < cx ? cx - halfRoad : cx + plan.approachRoadStopOffset;
  for (let x = Math.min(site.x, targetRoadX); x <= Math.max(site.x, targetRoadX); x++) {
    grid.setRoad(x, site.y);
    grid.setRoad(x, site.y + 1);
  }
}

/**
 * Routes a detour around any building that bisects a road — one with road on
 * both its north and south sides, or on both its east and west sides. Without
 * this a building dropped across a street would cut the street in two.
 *
 * Runs after every structure on the map is placed, town and circus alike, so
 * that a detour is never drawn through a building placed later.
 */
export function paintBuildingBypassRoutes(
  grid: TileGrid,
  buildings: ReadonlyArray<TileRect>,
  borderTiles: number,
): void {
  const lastOpenTile = grid.size - borderTiles;

  for (const building of buildings) {
    const rowTop = building.y - 1;
    const rowBottom = building.y + building.h;
    const colLeft = building.x - 1;
    const colRight = building.x + building.w;

    let hasRoadNorth = false;
    let hasRoadSouth = false;
    for (let x = colLeft; x <= colRight; x++) {
      if (x < borderTiles || x >= lastOpenTile) continue;
      if (rowTop >= borderTiles && grid.isRoad(x, rowTop)) hasRoadNorth = true;
      if (rowBottom < lastOpenTile && grid.isRoad(x, rowBottom)) hasRoadSouth = true;
    }
    if (hasRoadNorth && hasRoadSouth) {
      const westClear = colLeft >= borderTiles && isColumnClear(grid, colLeft, rowTop, rowBottom);
      const eastClear = colRight < lastOpenTile && isColumnClear(grid, colRight, rowTop, rowBottom);
      // Route on every available side, then stitch the ends back to the road.
      if (westClear) {
        for (let y = rowTop; y <= rowBottom; y++) grid.setRoad(colLeft, y);
        paveRow(grid, colLeft, colRight, rowTop);
        paveRow(grid, colLeft, colRight, rowBottom);
      }
      if (eastClear) {
        for (let y = rowTop; y <= rowBottom; y++) grid.setRoad(colRight, y);
        paveRow(grid, colLeft, colRight, rowTop);
        paveRow(grid, colLeft, colRight, rowBottom);
      }
    }

    let hasRoadWest = false;
    let hasRoadEast = false;
    for (let y = rowTop; y <= rowBottom; y++) {
      if (y < borderTiles || y >= lastOpenTile) continue;
      if (colLeft >= borderTiles && grid.isRoad(colLeft, y)) hasRoadWest = true;
      if (colRight < lastOpenTile && grid.isRoad(colRight, y)) hasRoadEast = true;
    }
    if (hasRoadWest && hasRoadEast) {
      const northClear = rowTop >= borderTiles && isRowClear(grid, rowTop, colLeft, colRight);
      const southClear = rowBottom < lastOpenTile && isRowClear(grid, rowBottom, colLeft, colRight);
      if (northClear) {
        paveRow(grid, colLeft, colRight, rowTop);
        paveColumn(grid, colLeft, rowTop, rowBottom);
        paveColumn(grid, colRight, rowTop, rowBottom);
      }
      if (southClear) {
        paveRow(grid, colLeft, colRight, rowBottom);
        paveColumn(grid, colLeft, rowTop, rowBottom);
        paveColumn(grid, colRight, rowTop, rowBottom);
      }
    }
  }
}

function isColumnClear(grid: TileGrid, x: number, yFrom: number, yTo: number): boolean {
  for (let y = yFrom; y <= yTo; y++) if (grid.isSolid(x, y)) return false;
  return true;
}

function isRowClear(grid: TileGrid, y: number, xFrom: number, xTo: number): boolean {
  for (let x = xFrom; x <= xTo; x++) if (grid.isSolid(x, y)) return false;
  return true;
}

function paveRow(grid: TileGrid, xFrom: number, xTo: number, y: number): void {
  for (let x = xFrom; x <= xTo; x++) grid.setRoad(x, y);
}

function paveColumn(grid: TileGrid, x: number, yFrom: number, yTo: number): void {
  for (let y = yFrom; y <= yTo; y++) grid.setRoad(x, y);
}
