/**
 * Rasterises the town's surfaces onto the tile grid: the planned yards, alleys,
 * lanes, main streets and plaza; the wall ring and its gates; the highways that
 * leave those gates; the apron in front of each building's door; and the detours
 * that keep a structure from severing a road it happens to sit across.
 *
 * The hierarchy is not encoded here — it is the order of `plan.surfaces`, and
 * this module only replays that order. That is deliberate: which street beats
 * which at a junction is a design decision and belongs in the plan.
 */

import { FloorTypeValue, LANE_STREET, TOWN_WALL, YARD_GRAVEL } from '../tileTypes';
import type { TileGrid } from './tileGrid';
import type { TilePoint, TileRect, TownPlan } from './townPlan';
import type { SpritePlacement } from './paintPlots';

/**
 * Rows of street paved in front of a doorway, counting the door's own row.
 *
 * One is enough: every building is bottom-aligned to its band, so the row below
 * its door is already the band's street. The apron exists to pave the *doorway
 * itself* across its full width — the sprite leaves a four-tile gap in The
 * Horned Flagon's facade and a three-tile gap in the General Store's, and a
 * single paved tile in the middle of one reads as a footpath through a lawn.
 */
const DOOR_APRON_ROWS = 1;

/** Paints every planned surface in order, later surfaces winning. */
export function paintTownSurfaces(grid: TileGrid, plan: TownPlan): void {
  for (const surface of plan.surfaces) grid.fill(surface.bounds, surface.tileType);
}

/**
 * Paints the wall ring, then cuts its gates back open.
 *
 * The order matters and is the whole reason gates are a separate concept from
 * surfaces: the wall goes down *after* the streets so no street can be painted
 * across it, which means the streets that are supposed to leave town have just
 * been walled in. Re-paving the gate openings afterwards is what lets a street
 * be stated as a plain rectangle spanning the interior.
 */
export function paintWallRing(grid: TileGrid, plan: TownPlan): void {
  const { x, y, w, h } = plan.wall;
  for (let dx = 0; dx < w; dx++) {
    grid.set(x + dx, y, TOWN_WALL);
    grid.set(x + dx, y + h - 1, TOWN_WALL);
  }
  for (let dy = 0; dy < h; dy++) {
    grid.set(x, y + dy, TOWN_WALL);
    grid.set(x + w - 1, y + dy, TOWN_WALL);
  }

  for (const gate of plan.gates) {
    grid.fill(gate.bounds, gate.tileType);
    grid.fill(gate.apron, YARD_GRAVEL);
  }
}

/**
 * Paints the road each gate throws out into open country, from the gate's apron
 * to the map's void border.
 *
 * These are what make the town look connected to somewhere, and they are also
 * what outlying sites route to: `connectSiteToNearestGate` joins the circus to a
 * gate exit rather than to the town centre, so an approach road can no longer
 * stop short of a junction it was aiming past.
 */
export function paintGateHighways(grid: TileGrid, plan: TownPlan, borderTiles: number): void {
  const lastOpenTile = grid.size - borderTiles - 1;
  for (const gate of plan.gates) {
    const { outward } = gate;
    // The road out is exactly as wide as the gate it leaves, swept outward from
    // the opening's own tiles. Deriving the width from a centre line and a half
    // width instead cannot represent an even-width gate without landing
    // off-centre by half a tile.
    for (let dy = 0; dy < gate.bounds.h; dy++) {
      for (let dx = 0; dx < gate.bounds.w; dx++) {
        let x = gate.bounds.x + dx + outward.dx;
        let y = gate.bounds.y + dy + outward.dy;
        while (x >= borderTiles && x <= lastOpenTile && y >= borderTiles && y <= lastOpenTile) {
          grid.setPaved(x, y, FloorTypeValue.road);
          x += outward.dx;
          y += outward.dy;
        }
      }
    }
  }
}

/**
 * Paves a sprite building's doorway across its full width, so the opening in the
 * facade reads as a threshold rather than as a gap with lawn in it.
 */
export function paintDoorApron(grid: TileGrid, placement: SpritePlacement): void {
  for (let row = 0; row < DOOR_APRON_ROWS; row++) {
    for (let i = 0; i < placement.doorwayWidth; i++) {
      grid.set(placement.doorwayX + i, placement.doorTile.y + row, LANE_STREET);
    }
  }
}

/**
 * Links an outlying site — today only the circus — to the nearest town gate,
 * with an L-shaped road that runs out along the gate's own axis and then turns
 * into the gate.
 *
 * **The order of the two segments is the whole correctness argument, and getting
 * it the other way round drove a road through the middle of the town.** There is
 * no north gate, so a circus north of the walls routes to a *side* gate, whose
 * exit sits beside Market Street — 9 rows below the town's centre line and well
 * inside its north-south extent. Turning along the site's own column first then
 * paved 3 tiles of packed earth from the circus straight down through the Civic
 * Terrace, the plaza and Market Street's cobble, and `TOWN_WALL` being solid then
 * cut the run at the wall so the circus finished with no road at all: measured
 * over 300 seeds, 10% of maps had the slash and 13% had the circus disconnected,
 * every one of them with the circus to the north.
 *
 * Running along the gate's outward axis *first* puts the corner on the gate's own
 * standoff line — one tile outside the wall — and the perpendicular segment then
 * travels along that line, outside the town by construction. Because the gate is
 * the nearest one, the first segment is always on the town's own side of it: a
 * circus level with the walls is due east or west and takes that side's gate, and
 * a circus north or south of them runs clear of the wall's rows entirely.
 *
 * `keepOut` is the belt to that braces: no tile inside the town is ever paved by
 * this pass, whatever the route. A route that needed it would leave a gap rather
 * than a scar, and `assertTownInteriorIsIntact` in the generator is what notices.
 */
export function connectSiteToNearestGate(
  grid: TileGrid,
  plan: TownPlan,
  site: TilePoint,
  keepOut: TileRect,
): void {
  let gate = plan.gates[0];
  let bestDistance = Infinity;
  for (const candidate of plan.gates) {
    const distance = Math.hypot(candidate.exit.x - site.x, candidate.exit.y - site.y);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    gate = candidate;
  }

  const { exit } = gate;
  if (gate.outward.dx !== 0) {
    paveRowRange(grid, keepOut, site.y, Math.min(site.x, exit.x), Math.max(site.x, exit.x));
    paveColumnRange(grid, keepOut, exit.x, Math.min(site.y, exit.y), Math.max(site.y, exit.y));
  } else {
    paveColumnRange(grid, keepOut, site.x, Math.min(site.y, exit.y), Math.max(site.y, exit.y));
    paveRowRange(grid, keepOut, exit.y, Math.min(site.x, exit.x), Math.max(site.x, exit.x));
  }
}

/** Approach roads are paved this many tiles either side of their centre line. */
const APPROACH_HALF_WIDTH = 1;

function contains(rect: TileRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function paveTrack(grid: TileGrid, keepOut: TileRect, x: number, y: number): void {
  if (contains(keepOut, x, y)) return;
  grid.setPaved(x, y, FloorTypeValue.road);
}

function paveColumnRange(
  grid: TileGrid,
  keepOut: TileRect,
  x: number,
  yFrom: number,
  yTo: number,
): void {
  for (let y = yFrom; y <= yTo; y++) {
    for (let dx = -APPROACH_HALF_WIDTH; dx <= APPROACH_HALF_WIDTH; dx++) {
      paveTrack(grid, keepOut, x + dx, y);
    }
  }
}

function paveRowRange(
  grid: TileGrid,
  keepOut: TileRect,
  y: number,
  xFrom: number,
  xTo: number,
): void {
  for (let x = xFrom; x <= xTo; x++) {
    for (let dy = -APPROACH_HALF_WIDTH; dy <= APPROACH_HALF_WIDTH; dy++) {
      paveTrack(grid, keepOut, x, y + dy);
    }
  }
}

/**
 * Routes a detour around any structure that bisects a road — one with paving on
 * both its north and south sides, or on both its east and west sides.
 *
 * This runs over the **circus** only, not over the town. The circus's tents are
 * scattered at generation time and its approach road is painted afterwards, so a
 * tent genuinely can cut the road in two. The town's buildings cannot: every
 * band is bounded above and below by a street by design, so every town building
 * has paving on both sides and this router would "detour" around all fifteen of
 * them — paving a column straight through the gardens and lanes the plan just
 * laid out. Running it over the town was correct when buildings were dropped on
 * a lawn; under a street plan it is actively wrong.
 */
export function paintBuildingBypassRoutes(
  grid: TileGrid,
  structures: ReadonlyArray<TileRect>,
  borderTiles: number,
): void {
  const lastOpenTile = grid.size - borderTiles;

  for (const building of structures) {
    const rowTop = building.y - 1;
    const rowBottom = building.y + building.h;
    const colLeft = building.x - 1;
    const colRight = building.x + building.w;

    let hasRoadNorth = false;
    let hasRoadSouth = false;
    for (let x = colLeft; x <= colRight; x++) {
      if (x < borderTiles || x >= lastOpenTile) continue;
      if (rowTop >= borderTiles && grid.isPaved(x, rowTop)) hasRoadNorth = true;
      if (rowBottom < lastOpenTile && grid.isPaved(x, rowBottom)) hasRoadSouth = true;
    }
    if (hasRoadNorth && hasRoadSouth) {
      const westClear = colLeft >= borderTiles && isColumnClear(grid, colLeft, rowTop, rowBottom);
      const eastClear = colRight < lastOpenTile && isColumnClear(grid, colRight, rowTop, rowBottom);
      // Route on every available side, then stitch the ends back to the road.
      if (westClear) {
        for (let y = rowTop; y <= rowBottom; y++) grid.setPaved(colLeft, y, FloorTypeValue.road);
        paveRow(grid, colLeft, colRight, rowTop);
        paveRow(grid, colLeft, colRight, rowBottom);
      }
      if (eastClear) {
        for (let y = rowTop; y <= rowBottom; y++) grid.setPaved(colRight, y, FloorTypeValue.road);
        paveRow(grid, colLeft, colRight, rowTop);
        paveRow(grid, colLeft, colRight, rowBottom);
      }
    }

    let hasRoadWest = false;
    let hasRoadEast = false;
    for (let y = rowTop; y <= rowBottom; y++) {
      if (y < borderTiles || y >= lastOpenTile) continue;
      if (colLeft >= borderTiles && grid.isPaved(colLeft, y)) hasRoadWest = true;
      if (colRight < lastOpenTile && grid.isPaved(colRight, y)) hasRoadEast = true;
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
  for (let x = xFrom; x <= xTo; x++) grid.setPaved(x, y, FloorTypeValue.road);
}

function paveColumn(grid: TileGrid, x: number, yFrom: number, yTo: number): void {
  for (let y = yFrom; y <= yTo; y++) grid.setPaved(x, y, FloorTypeValue.road);
}
