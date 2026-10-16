/**
 * The openings in a walled area's wall that a quest route has to pass
 * through: the town wall's gates and Briar Hollow's palisade gates. An arrow
 * aimed through a wall points at the one tile run the party cannot walk, so
 * while the route still has a gate ahead of it, the arrow points at the gate.
 */

import type { GameMap } from '../../map/GameMap';
import { tileCoordKey } from '../../map/tileIndex';
import type { TilePoint } from '../../map/town/townPlan';

/** One gate in a wall, as the tiles of its opening and the tile an arrow aims at. */
export interface RoutePortal {
  readonly tiles: readonly TilePoint[];
  readonly centre: TilePoint;
  /** {@link tiles} as `tileCoordKey`s. */
  readonly keys: ReadonlySet<number>;
}

function portalOf(tiles: readonly TilePoint[], centre: TilePoint): RoutePortal {
  return { tiles, centre, keys: new Set(tiles.map((tile) => tileCoordKey(tile.x, tile.y))) };
}

const HALF = 0.5;

function townGatePortals(gameMap: GameMap): RoutePortal[] {
  const plan = gameMap.townPlan;
  if (plan === undefined) return [];
  return plan.gates.map(({ bounds }) => {
    const tiles: TilePoint[] = [];
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.w; x++) tiles.push({ x, y });
    }
    const centre = {
      x: bounds.x + Math.floor(bounds.w * HALF),
      y: bounds.y + Math.floor(bounds.h * HALF),
    };
    return portalOf(tiles, centre);
  });
}

function palisadeGatePortals(gameMap: GameMap): RoutePortal[] {
  const site = gameMap.briarHollow;
  if (site === null) return [];
  const portals: RoutePortal[] = [];
  for (const gate of site.gates) {
    if (gate.tiles.length === 0) continue;
    portals.push(portalOf(gate.tiles, gate.tiles[Math.floor(gate.tiles.length * HALF)]));
  }
  return portals;
}

const portalsByMap = new WeakMap<GameMap, readonly RoutePortal[]>();

/**
 * Every gate on `gameMap` a route can pass through a wall by. Empty on a map
 * with no walled area (a dungeon floor, an interior), which is a valid answer.
 */
export function routePortals(gameMap: GameMap): readonly RoutePortal[] {
  const known = portalsByMap.get(gameMap);
  if (known !== undefined) return known;
  const portals = [...townGatePortals(gameMap), ...palisadeGatePortals(gameMap)];
  portalsByMap.set(gameMap, portals);
  return portals;
}

/**
 * The first gate `chain` passes through, ignoring its first `underfootSteps`
 * tiles so a party already standing in a gate is aimed past it; null when the
 * chain goes through none.
 */
export function firstPortalOnChain(
  chain: readonly TilePoint[],
  portals: readonly RoutePortal[],
  underfootSteps: number,
): RoutePortal | null {
  for (let index = underfootSteps; index < chain.length; index++) {
    const key = tileCoordKey(chain[index].x, chain[index].y);
    const portal = portals.find((candidate) => candidate.keys.has(key));
    if (portal !== undefined) return portal;
  }
  return null;
}
