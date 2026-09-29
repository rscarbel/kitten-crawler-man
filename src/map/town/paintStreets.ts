/**
 * Rasterises the town's surfaces onto the tile grid: the planned yards, alleys,
 * lanes, main streets and plaza; the wall ring and its gates; the highways that
 * leave those gates; the apron in front of each building's door; and the detours
 * that keep a structure from severing a road it happens to sit across.
 *
 * The hierarchy is not encoded here — it is the order of `plan.surfaces`, and
 * this module only replays that order. That is deliberate: which street beats
 * which at a junction is a design decision and belongs in the `TownPlan`.
 */

import { FloorTypeValue, LANE_STREET, TOWN_WALL, YARD_GRAVEL } from '../tileTypes';
import type { TileGrid } from './tileGrid';
import type { TilePoint, TileRect, TownPlan } from './townPlan';
import type { SpritePlacement } from './paintPlots';

/**
 * Rows of street paved in front of a doorway, counting the door's own row.
 *
 * Two: the doorway itself, and the row of street below it. The doorway row is
 * what stops a four-tile gap in The Horned Flagon's facade reading as a single
 * flagstone in a lawn. The street row is the doorstep — see
 * `DOOR_APRON_SIDE_OVERHANG` for why it is worth paving a material that is
 * already paved.
 */
const DOOR_APRON_ROWS = 2;

/**
 * How far the apron reaches past the doorway on either side.
 *
 * In the doorway's own row this falls under the facade and is invisible, which
 * is deliberate: the row is a run of tiles the sprite covers, and stating the
 * apron as "the doorway plus a tile" rather than "exactly the doorway" means a
 * re-cut facade that widens its opening by a tile still lands on paving.
 *
 * In the street row it is what you actually see. Every band's street is already
 * paved, so the apron's effect there is to lay the *frontage* material across the
 * front of a door: setts in front of the mead hall's four-tile opening where
 * Market Street is cobble, a stone doorstep in front of Blackwood Lodge where its
 * alley is packed earth. A doorstep is a different surface from the roadway, or
 * it is not a doorstep.
 */
const DOOR_APRON_SIDE_OVERHANG = 1;

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
 * what outlying sites route to: the circus approach (`nearestGate`, then
 * `paveApproach`) joins a gate exit rather than the town centre, so an approach
 * road never stops short of a junction it was aiming past.
 */
export function paintGateHighways(grid: TileGrid, plan: TownPlan, borderTiles: number): void {
  for (const tile of gateHighwayTiles(plan, grid.size, borderTiles)) {
    grid.setPaved(tile.x, tile.y, FloorTypeValue.road);
  }
}

/**
 * Every tile the gate highways are laid along on a map of `mapSize` tiles,
 * whatever later passes build over them. A site stamped across a highway
 * asks this rather than the grid, because by then the grid may no longer
 * show where the road ran.
 */
export function gateHighwayTiles(
  plan: TownPlan,
  mapSize: number,
  borderTiles: number,
): TilePoint[] {
  const lastOpenTile = mapSize - borderTiles - 1;
  const tiles: TilePoint[] = [];
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
          tiles.push({ x, y });
          x += outward.dx;
          y += outward.dy;
        }
      }
    }
  }
  return tiles;
}

/**
 * Paves a sprite building's doorway and the doorstep below it, so the opening in
 * the facade reads as a threshold rather than as a gap with lawn in it and the
 * building meets its street rather than sitting on it.
 *
 * `setPaved` rather than `set` is a guard, not a fix for a live case, and the
 * distinction is worth keeping straight: measured across all fifteen buildings,
 * **no apron tile lands on the wall today**. The closest is The Sunken Stump Pub,
 * whose doorway starts at the interior's second column so its apron reaches the
 * westmost interior column and stops one short of the stone. The guard is there
 * because the apron's width is derived from a sprite's facade, so a re-cut door
 * one column further out would reach the ring and punch a hole in it.
 */
export function paintDoorApron(grid: TileGrid, placement: SpritePlacement): void {
  const from = placement.doorwayX - DOOR_APRON_SIDE_OVERHANG;
  const to = placement.doorwayX + placement.doorwayWidth - 1 + DOOR_APRON_SIDE_OVERHANG;
  for (let row = 0; row < DOOR_APRON_ROWS; row++) {
    for (let x = from; x <= to; x++) grid.setPaved(x, placement.doorTile.y + row, LANE_STREET);
  }
}

/**
 * Paves an outlying site's road — today only the circus's — along `centreLine`
 * at the approach's full width. The centre line is an L from
 * `approachCentreLine`, which carries the argument for its shape.
 *
 * `keepOut` is the belt to that braces: no tile inside the town is ever paved by
 * this pass, whatever the route. A route that needed it would leave a gap rather
 * than a scar, and `assertTownInteriorIsIntact` in the generator is what notices.
 */
export function paveApproach(
  grid: TileGrid,
  centreLine: ReadonlyArray<ApproachCentreTile>,
  keepOut: TileRect,
): void {
  for (const tile of widenApproach(centreLine)) paveTrack(grid, keepOut, tile.x, tile.y);
}

/** Every tile a road along `centreLine` covers at the approach's full width. */
export function widenApproach(centreLine: ReadonlyArray<ApproachCentreTile>): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (const tile of centreLine) {
    for (let offset = -APPROACH_HALF_WIDTH; offset <= APPROACH_HALF_WIDTH; offset++) {
      tiles.push(
        tile.alongX ? { x: tile.x, y: tile.y + offset } : { x: tile.x + offset, y: tile.y },
      );
    }
  }
  return tiles;
}

/** One tile of an approach road's centre line, and which way the road runs through it. */
export interface ApproachCentreTile extends TilePoint {
  /** True where the road runs east–west, so its width spreads north and south. */
  readonly alongX: boolean;
}

/**
 * The centre line of an outlying site's road to its nearest town gate, walked
 * from the site out to the gate: an L that runs out along the gate's own axis
 * first and then turns into the gate.
 *
 * **The order of the two segments is the whole correctness argument, and getting
 * it the other way round drove a road through the middle of the town.** The
 * gate chosen is the nearest by straight line, and a site off the town's
 * diagonals picks one whose exit is deep inside the town's extent on the other
 * axis. Turning along the site's own column first paved 3 tiles of packed earth
 * from the circus straight down through the Civic Terrace, the plaza and Market
 * Street's cobble, and `TOWN_WALL` being solid then cut the run at the wall so
 * the circus finished with no road at all: measured over 300 seeds, 10% of maps
 * had the slash and 13% had the circus disconnected, every one of them with the
 * circus to the north.
 *
 * Running along the gate's outward axis *first* puts the corner on the gate's own
 * standoff line — one tile outside the wall — and the perpendicular segment then
 * travels along that line, outside the town by construction. Because the gate is
 * the nearest one, the first segment is always on the town's own side of it: a
 * site level with the walls is due east or west and takes that side's gate, and
 * a site north or south of them runs clear of the wall's rows entirely. The gate is the one nearest `site`; the road starts at
 * `start`, which is the site itself unless the site's own centre is not where
 * a road can begin (the circus's Big Top stands on it, so its road begins on
 * the forecourt, or round the tent's flank).
 */
export function approachCentreLine(
  plan: TownPlan,
  site: TilePoint,
  start: TilePoint = site,
): ApproachCentreTile[] {
  const gate = nearestGate(plan, site);
  const { exit } = gate;
  const line: ApproachCentreTile[] = [];
  const stepX = Math.sign(exit.x - start.x);
  const stepY = Math.sign(exit.y - start.y);
  if (gate.outward.dx !== 0) {
    for (let x = start.x; ; x += stepX) {
      line.push({ x, y: start.y, alongX: true });
      if (x === exit.x) break;
    }
    for (let y = start.y; ; y += stepY) {
      line.push({ x: exit.x, y, alongX: false });
      if (y === exit.y) break;
    }
  } else {
    for (let y = start.y; ; y += stepY) {
      line.push({ x: start.x, y, alongX: false });
      if (y === exit.y) break;
    }
    for (let x = start.x; ; x += stepX) {
      line.push({ x, y: exit.y, alongX: true });
      if (x === exit.x) break;
    }
  }
  return line;
}

/** The town gate whose exit is nearest a site: the one its approach road runs to. */
export function nearestGate(plan: TownPlan, site: TilePoint): TownPlan['gates'][number] {
  let gate = plan.gates[0];
  let bestDistance = Infinity;
  for (const candidate of plan.gates) {
    const distance = Math.hypot(candidate.exit.x - site.x, candidate.exit.y - site.y);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    gate = candidate;
  }
  return gate;
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
