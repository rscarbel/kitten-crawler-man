import type { BuildingEntry } from '../map/buildingEntry';
import { tileKey } from './tileKey';

const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/**
 * Every tile no blocking prop may stand on because a building is entered
 * through it: each tile of every doorway, and every tile one cardinal step from
 * the doorway — the approach the player steps in from.
 *
 * A connectivity check alone cannot protect a door. A door tile is a dead end,
 * so a prop on it strands no *other* tile and passes; the building is simply
 * never enterable. Neighbours are taken on all four sides rather than only to
 * the south so the rule holds whichever way a facade faces; the ones that land
 * in a wall are unwalkable anyway and cost nothing.
 */
export function doorwayKeepClearTiles(entries: ReadonlyArray<BuildingEntry>): ReadonlySet<string> {
  const keepClear = new Set<string>();
  for (const entry of entries) {
    const { x0, width } = entry.doorway;
    for (let x = x0; x < x0 + width; x++) {
      const y = entry.doorTile.y;
      keepClear.add(tileKey(x, y));
      for (const [dx, dy] of CARDINAL_STEPS) keepClear.add(tileKey(x + dx, y + dy));
    }
  }
  return keepClear;
}
