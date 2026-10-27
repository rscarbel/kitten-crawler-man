import type { GameMap } from '../map/GameMap';
import { tileCoordKey } from '../map/tileIndex';

/**
 * Every tile of every building's doorway on `gameMap`, as `tileCoordKey`s:
 * stepping on one takes the party indoors, so a walk planned across the map
 * must never pass over one it is not headed for.
 */
export function doorwayKeys(gameMap: Pick<GameMap, 'buildingEntries'>): ReadonlySet<number> {
  const keys = new Set<number>();
  for (const entry of gameMap.buildingEntries) {
    const { x0, width } = entry.doorway;
    for (let x = x0; x < x0 + width; x++) keys.add(tileCoordKey(x, entry.doorTile.y));
  }
  return keys;
}
