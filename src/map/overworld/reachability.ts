/**
 * Who can walk to whom, over a whole generated map.
 *
 * `OverworldGenerator`'s older `assertTownIsFullyReachable` only ever looked
 * inside the wall, which was the right scope while nothing outside it could
 * sever anything. A river can, so the river pass needs to *repair* connectivity
 * and the generator needs to *check* it — and both want the same flood fill.
 */

import type { TileGrid } from '../town/tileGrid';
import type { TilePoint } from '../town/townPlan';
import { CLIFF, FloorTypeValue } from '../tileTypes';
import { isWalkableTileType } from '../walkability';

/** Four-connected: a diagonal gap is not a gap the player can walk through. */
const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/** Which walkable tiles a walker starting at one tile can reach. */
export class Reachability {
  private readonly reachedFlags: Uint8Array;
  readonly reachedCount: number;
  readonly walkableCount: number;

  constructor(
    private readonly grid: TileGrid,
    from: TilePoint,
  ) {
    const size = grid.size;
    this.reachedFlags = new Uint8Array(size * size);

    let reached = 0;
    const startKey = from.y * size + from.x;
    const queue: number[] = [startKey];
    this.reachedFlags[startKey] = 1;
    while (queue.length > 0) {
      const key = queue.pop();
      if (key === undefined) break;
      reached++;
      const x = key % size;
      const y = Math.floor(key / size);
      for (const [dx, dy] of CARDINAL_STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!isWalkableAt(grid, nx, ny)) continue;
        const nextKey = ny * size + nx;
        if (this.reachedFlags[nextKey] === 1) continue;
        this.reachedFlags[nextKey] = 1;
        queue.push(nextKey);
      }
    }
    this.reachedCount = reached;

    let walkable = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (isWalkableAt(grid, x, y)) walkable++;
    }
    this.walkableCount = walkable;
  }

  reached(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.grid.size || y >= this.grid.size) return false;
    return this.reachedFlags[y * this.grid.size + x] === 1;
  }

  /** Share of the map's walkable tiles the walker can actually get to. */
  get reachedFraction(): number {
    return this.walkableCount === 0 ? 1 : this.reachedCount / this.walkableCount;
  }

  /**
   * Labels each connected group of walkable tiles the walker could **not**
   * reach, and returns a label grid, each label's tile count, and whether any
   * water touches it.
   *
   * The two border flags are the discriminator between completely different
   * things that show up here. A region cut off by the **river** has water on its
   * border and can be bridged back; one cut off by a **cliff line** has cliff on
   * its border and can have a ramp cut through it. A region a **forest blob**
   * closed around has trees on its border, nothing to span or cut, and has been
   * part of every generated map since long before this plan — one measured at 153
   * tiles with 156 of its 156 border tiles a `TREE`.
   *
   * Without the flags the repair passes waste rounds on pockets they can never
   * fix, and — far worse — the generator's assertion fails maps for a defect this
   * plan did not cause, blaming a river for a hole in a wood.
   */
  marooned(): MaroonedRegions {
    const size = this.grid.size;
    const labels = new Int32Array(size * size).fill(NO_REGION);
    const counts: number[] = [];
    const touchesWater: boolean[] = [];
    const touchesCliff: boolean[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isWalkableAt(this.grid, x, y)) continue;
        if (this.reached(x, y) || labels[y * size + x] !== NO_REGION) continue;
        const label = counts.length;
        let count = 0;
        let bordersWater = false;
        let bordersCliff = false;
        const queue: number[] = [y * size + x];
        labels[queue[0]] = label;
        while (queue.length > 0) {
          const key = queue.pop();
          if (key === undefined) break;
          count++;
          const cx = key % size;
          const cy = Math.floor(key / size);
          for (const [dx, dy] of CARDINAL_STEPS) {
            const nx = cx + dx;
            const ny = cy + dy;
            const neighbourType = this.grid.typeAt(nx, ny);
            if (neighbourType === FloorTypeValue.water) bordersWater = true;
            if (neighbourType === CLIFF) bordersCliff = true;
            if (!isWalkableAt(this.grid, nx, ny)) continue;
            const nextKey = ny * size + nx;
            if (labels[nextKey] !== NO_REGION || this.reached(nx, ny)) continue;
            labels[nextKey] = label;
            queue.push(nextKey);
          }
        }
        counts.push(count);
        touchesWater.push(bordersWater);
        touchesCliff.push(bordersCliff);
      }
    }
    return { labels, counts, touchesWater, touchesCliff };
  }
}

/** One flood-fill's worth of unreachable regions, indexed by label. */
interface MaroonedRegions {
  /** Region label per tile, or `NO_REGION`. */
  readonly labels: Int32Array;
  /** Tile count per label. */
  readonly counts: number[];
  /** Whether any water borders the region — i.e. whether a bridge could reach it. */
  readonly touchesWater: boolean[];
  /** Whether any cliff borders the region — i.e. whether a ramp could open it. */
  readonly touchesCliff: boolean[];
}

/** Label meaning "not part of any marooned region" — reached, or not walkable. */
export const NO_REGION = -1;

/**
 * Whether anything that walks can occupy (x, y).
 *
 * River water reads as walkable here because it *is* walkable — everything
 * wades. That makes a river almost incapable of severing a map, so the marooned
 * regions this still finds are the ones cliffs and dense scenery make, and
 * `bridgeMaroonedRegions` now earns its keep only on those.
 */
function isWalkableAt(grid: TileGrid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return false;
  return isWalkableTileType(grid.cells[y][x]);
}
