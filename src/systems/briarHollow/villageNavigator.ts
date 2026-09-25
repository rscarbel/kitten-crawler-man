/**
 * Pathing for villagers, confined to one rectangle of the map.
 *
 * `GameMap.findPath` searches the whole map, so a route between two points
 * inside the palisade can leave through the gate and come back round when
 * the inside way is blocked — and a villager must never leave. Searching only
 * the village's own tiles makes "never leaves" a property of every route
 * rather than a check on it. The rectangle is small (a few thousand tiles),
 * and a route is searched once per trip and then walked, so a plain
 * breadth-first search is cheap enough.
 *
 * Walkability is read live from the map, so a trebuchet built on a lane or a
 * breach in the wall is seen by the next trip planned.
 */

import type { GameMap } from '../../map/GameMap';
import { HOLLOW_THRESHOLD } from '../../map/tileTypes';
import type { TilePoint, TileRect } from '../../map/town/townPlan';

/** The eight neighbours, cardinals first so a straight step wins a tie. */
const NEIGHBOURS: ReadonlyArray<{ readonly dx: number; readonly dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];

const UNVISITED = -1;

export class VillageNavigator {
  private readonly parents: Int32Array;

  constructor(
    private readonly gameMap: GameMap,
    readonly bounds: TileRect,
  ) {
    this.parents = new Int32Array(bounds.w * bounds.h);
  }

  contains(tileX: number, tileY: number): boolean {
    const { x, y, w, h } = this.bounds;
    return tileX >= x && tileY >= y && tileX < x + w && tileY < y + h;
  }

  /** A tile a villager may walk across. */
  isPassable(tileX: number, tileY: number): boolean {
    return this.contains(tileX, tileY) && this.gameMap.isWalkable(tileX, tileY);
  }

  /** A doorway: a villager crosses it and never stops on it. */
  isThreshold(tileX: number, tileY: number): boolean {
    if (!this.contains(tileX, tileY)) return false;
    return this.gameMap.structure[tileY][tileX].type === HOLLOW_THRESHOLD;
  }

  /** A tile a villager may stop and stand on. */
  isStandable(tileX: number, tileY: number): boolean {
    return this.isPassable(tileX, tileY) && !this.isThreshold(tileX, tileY);
  }

  private indexOf(tileX: number, tileY: number): number {
    return (tileY - this.bounds.y) * this.bounds.w + (tileX - this.bounds.x);
  }

  /**
   * The tiles to walk from `from` to `to`, excluding `from` and ending on
   * `to`; empty when already there, null when there is no way. `avoid`
   * holds tiles to treat as blocked this once — a crawler standing in a
   * doorway. Diagonal steps never cut a wall corner.
   */
  findPath(
    from: TilePoint,
    to: TilePoint,
    avoid: ReadonlySet<number> = new Set(),
  ): TilePoint[] | null {
    if (!this.isPassable(to.x, to.y)) return null;
    if (from.x === to.x && from.y === to.y) return [];
    if (!this.contains(from.x, from.y)) return null;
    const open = (tileX: number, tileY: number): boolean =>
      this.isPassable(tileX, tileY) && !avoid.has(this.indexOf(tileX, tileY));

    this.parents.fill(UNVISITED);
    const start = this.indexOf(from.x, from.y);
    const goal = this.indexOf(to.x, to.y);
    this.parents[start] = start;
    const queue: number[] = [start];
    // Iterating the array it grows: a for-of sees every entry pushed behind it.
    for (const current of queue) {
      if (current === goal) return this.rebuild(start, goal);
      const cx = (current % this.bounds.w) + this.bounds.x;
      const cy = Math.floor(current / this.bounds.w) + this.bounds.y;
      for (const { dx, dy } of NEIGHBOURS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!open(nx, ny)) continue;
        const isDiagonal = dx !== 0 && dy !== 0;
        if (isDiagonal && (!open(cx + dx, cy) || !open(cx, cy + dy))) continue;
        const next = this.indexOf(nx, ny);
        if (this.parents[next] !== UNVISITED) continue;
        this.parents[next] = current;
        queue.push(next);
      }
    }
    return null;
  }

  private rebuild(start: number, goal: number): TilePoint[] {
    const path: TilePoint[] = [];
    for (let at = goal; at !== start; at = this.parents[at]) {
      path.push({
        x: (at % this.bounds.w) + this.bounds.x,
        y: Math.floor(at / this.bounds.w) + this.bounds.y,
      });
    }
    return path.reverse();
  }

  /**
   * The standable tile nearest `anchor` (by steps, through passable ground)
   * that is not already `taken`, within `maxSteps`; null when none is.
   */
  nearestFreeSpot(
    anchor: TilePoint,
    taken: ReadonlySet<number>,
    maxSteps: number,
  ): TilePoint | null {
    if (!this.contains(anchor.x, anchor.y)) return null;
    this.parents.fill(UNVISITED);
    const start = this.indexOf(anchor.x, anchor.y);
    const depth = new Map<number, number>([[start, 0]]);
    this.parents[start] = start;
    const queue: number[] = [start];
    for (const current of queue) {
      const cx = (current % this.bounds.w) + this.bounds.x;
      const cy = Math.floor(current / this.bounds.w) + this.bounds.y;
      if (this.isStandable(cx, cy) && !taken.has(current)) return { x: cx, y: cy };
      const steps = depth.get(current) ?? 0;
      if (steps >= maxSteps) continue;
      for (const { dx, dy } of NEIGHBOURS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.isPassable(nx, ny)) continue;
        const next = this.indexOf(nx, ny);
        if (this.parents[next] !== UNVISITED) continue;
        this.parents[next] = current;
        depth.set(next, steps + 1);
        queue.push(next);
      }
    }
    return null;
  }

  /** The key `findPath`'s `avoid` and `nearestFreeSpot`'s `taken` sets are built from. */
  keyOf(tileX: number, tileY: number): number {
    return this.indexOf(tileX, tileY);
  }
}
