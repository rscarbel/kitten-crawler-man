/**
 * The ground Briar Hollow's herd may stand on: the paddock inside its fence,
 * the barn's floor, and the short run of lane between the paddock's gate and
 * the barn's open side.
 *
 * The fence and the barn walls already stop a cow, but the gate gap and that
 * run of lane are ordinary walkable ground — a crawler has to be able to walk
 * through them — so nothing in the map itself keeps a cow from wandering out
 * of the gate and down the lane. The pen is that rule: a cow's own steps, a
 * shove and a panic all refuse to carry its centre off these tiles.
 *
 * Routes are searched only across the pen, four-connected so a cow never cuts
 * the corner of a fence post it cannot actually pass. The pen is a couple of
 * hundred tiles, so a breadth-first search per trip is cheap.
 */

import { TILE_SIZE } from '../../core/constants';
import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite, VillageBuildingDef } from '../../map/overworld/briarHollowSite';
import type { TilePoint, TileRect } from '../../map/town/townPlan';

const TILE_CENTRE = 0.5;
const UNREACHED = -1;
const NO_PARENT = -1;
/** Furthest a paddock gate may be from the barn's open side and still count as leading into it. */
const MAX_GATE_TO_BARN_TILES = 4;

const CARDINALS: ReadonlyArray<TilePoint> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function insideRect(rect: TileRect, tileX: number, tileY: number): boolean {
  return tileX >= rect.x && tileY >= rect.y && tileX < rect.x + rect.w && tileY < rect.y + rect.h;
}

function insetByOne(rect: TileRect): TileRect {
  return { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 };
}

function tilesOf(rect: TileRect): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) tiles.push({ x, y });
  }
  return tiles;
}

/** The step that leads out of `rect` through `gate`, a tile on its edge. */
function outwardStep(rect: TileRect, gate: TilePoint): TilePoint {
  if (gate.x === rect.x) return { x: -1, y: 0 };
  if (gate.x === rect.x + rect.w - 1) return { x: 1, y: 0 };
  if (gate.y === rect.y) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

/**
 * The lane tiles between a paddock gate and the barn, walking straight out of
 * the gate, ending on the barn's threshold. Empty when the gate does not face
 * the barn within reach.
 */
function laneToBarn(pasture: TileRect, gate: TilePoint, barn: VillageBuildingDef): TilePoint[] {
  const step = outwardStep(pasture, gate);
  const lane: TilePoint[] = [];
  for (let i = 1; i <= MAX_GATE_TO_BARN_TILES; i++) {
    const tile = { x: gate.x + step.x * i, y: gate.y + step.y * i };
    const isThreshold = barn.doorways.some((door) => door.x === tile.x && door.y === tile.y);
    if (isThreshold) {
      lane.push(tile);
      return lane;
    }
    if (insideRect(barn.rect, tile.x, tile.y)) return [];
    lane.push(tile);
  }
  return [];
}

function unionRect(rects: readonly TileRect[]): TileRect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export class CowPen {
  /** Every pen tile inside the paddock's fence. */
  readonly pastureTiles: readonly TilePoint[];
  /** Every pen tile on the barn's floor, threshold included. */
  readonly barnTiles: readonly TilePoint[];
  private readonly bounds: TileRect;
  private readonly member: Uint8Array;
  private readonly distances: Int32Array;
  private readonly parents: Int32Array;
  private readonly queue: Int32Array;

  constructor(
    private readonly gameMap: GameMap,
    pasture: TileRect,
    gates: readonly TilePoint[],
    barn: VillageBuildingDef | null,
  ) {
    const paddock = tilesOf(insetByOne(pasture));
    const lanes =
      barn === null
        ? []
        : gates.flatMap((gate) => {
            const lane = laneToBarn(pasture, gate, barn);
            return lane.length === 0 ? [] : [gate, ...lane];
          });
    const barnFloor = barn === null || lanes.length === 0 ? [] : tilesOf(barn.interior);
    const thresholds = lanes.filter(
      (tile) => barn !== null && insideRect(barn.rect, tile.x, tile.y),
    );
    this.pastureTiles = paddock;
    this.barnTiles = [...barnFloor, ...thresholds];
    this.bounds = unionRect(barn === null ? [pasture] : [pasture, barn.rect]);
    const cells = this.bounds.w * this.bounds.h;
    this.member = new Uint8Array(cells);
    this.distances = new Int32Array(cells);
    this.parents = new Int32Array(cells);
    this.queue = new Int32Array(cells);
    for (const tile of [...paddock, ...lanes, ...barnFloor]) {
      if (insideRect(this.bounds, tile.x, tile.y)) this.member[this.indexOf(tile.x, tile.y)] = 1;
    }
  }

  /** The pen of a generated village: its paddock, the barn, and the lane between their openings. */
  static forSite(gameMap: GameMap, site: BriarHollowSite): CowPen {
    const barn = site.buildings.find((building) => building.id === 'barn') ?? null;
    return new CowPen(gameMap, site.pasture.rect, site.pasture.fenceGates, barn);
  }

  private indexOf(tileX: number, tileY: number): number {
    return (tileY - this.bounds.y) * this.bounds.w + (tileX - this.bounds.x);
  }

  /** Whether tile (`tileX`, `tileY`) is pen ground, walkable or not. */
  contains(tileX: number, tileY: number): boolean {
    if (!insideRect(this.bounds, tileX, tileY)) return false;
    return this.member[this.indexOf(tileX, tileY)] === 1;
  }

  /** Whether a cow may stand on tile (`tileX`, `tileY`) right now. Read live, so a prop set down is seen. */
  isPassable(tileX: number, tileY: number): boolean {
    return (
      this.contains(tileX, tileY) &&
      this.gameMap.isWalkable(tileX, tileY) &&
      !this.gameMap.isStairwellTile(tileX, tileY)
    );
  }

  /** Whether the world pixel (`px`, `py`) lies on pen ground. */
  containsPoint(px: number, py: number): boolean {
    return this.contains(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
  }

  /** Whether a tile-sized body whose top-left is (`x`, `y`) has its centre on pen ground. */
  holdsBody(x: number, y: number): boolean {
    return this.containsPoint(x + TILE_SIZE * TILE_CENTRE, y + TILE_SIZE * TILE_CENTRE);
  }

  /**
   * The passable pen tile nearest `from` in a straight line — where an animal
   * that has somehow ended up outside the pen walks back in. Null only when
   * the pen has no passable ground at all.
   */
  nearestPassable(from: TilePoint): TilePoint | null {
    let best: TilePoint | null = null;
    let bestDistance = Infinity;
    for (let index = 0; index < this.member.length; index++) {
      if (this.member[index] !== 1) continue;
      const tile = {
        x: this.bounds.x + (index % this.bounds.w),
        y: this.bounds.y + Math.floor(index / this.bounds.w),
      };
      if (!this.isPassable(tile.x, tile.y)) continue;
      const distance = Math.hypot(tile.x - from.x, tile.y - from.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = tile;
      }
    }
    return best;
  }

  /** Whether the tile is on the barn's floor. */
  isBarnTile(tile: TilePoint): boolean {
    return this.barnTiles.some((barnTile) => barnTile.x === tile.x && barnTile.y === tile.y);
  }

  /** The tile under the centre of a tile-sized body whose top-left is (`x`, `y`). */
  static tileOfBody(x: number, y: number): TilePoint {
    return {
      x: Math.floor((x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
      y: Math.floor((y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
    };
  }

  /**
   * Floods the pen from `start`, filling the step counts `stepsTo` reads.
   * Returns false when `start` is not passable pen ground.
   */
  private flood(start: TilePoint): boolean {
    this.distances.fill(UNREACHED);
    this.parents.fill(NO_PARENT);
    if (!this.isPassable(start.x, start.y)) return false;
    let head = 0;
    let tail = 0;
    const startIndex = this.indexOf(start.x, start.y);
    this.distances[startIndex] = 0;
    this.queue[tail++] = startIndex;
    while (head < tail) {
      const index = this.queue[head++];
      const x = this.bounds.x + (index % this.bounds.w);
      const y = this.bounds.y + Math.floor(index / this.bounds.w);
      for (const step of CARDINALS) {
        const nx = x + step.x;
        const ny = y + step.y;
        if (!this.isPassable(nx, ny)) continue;
        const next = this.indexOf(nx, ny);
        if (this.distances[next] !== UNREACHED) continue;
        this.distances[next] = this.distances[index] + 1;
        this.parents[next] = index;
        this.queue[tail++] = next;
      }
    }
    return true;
  }

  /**
   * Every passable pen tile reachable from `start` within `maxSteps`, with its
   * step count. Empty when `start` itself is not passable.
   */
  reachableFrom(
    start: TilePoint,
    maxSteps: number,
  ): Array<{ readonly tile: TilePoint; readonly steps: number }> {
    if (!this.flood(start)) return [];
    const reached: Array<{ tile: TilePoint; steps: number }> = [];
    for (let index = 0; index < this.distances.length; index++) {
      const steps = this.distances[index];
      if (steps === UNREACHED || steps > maxSteps) continue;
      reached.push({
        tile: {
          x: this.bounds.x + (index % this.bounds.w),
          y: this.bounds.y + Math.floor(index / this.bounds.w),
        },
        steps,
      });
    }
    return reached;
  }

  /**
   * The tiles to walk, in order, from `start` to `goal` (excluding `start`),
   * or null when there is no way across the pen.
   */
  route(start: TilePoint, goal: TilePoint): TilePoint[] | null {
    if (!this.isPassable(goal.x, goal.y) || !this.flood(start)) return null;
    let index = this.indexOf(goal.x, goal.y);
    if (this.distances[index] === UNREACHED) return null;
    const path: TilePoint[] = [];
    while (this.distances[index] > 0) {
      path.push({
        x: this.bounds.x + (index % this.bounds.w),
        y: this.bounds.y + Math.floor(index / this.bounds.w),
      });
      index = this.parents[index];
    }
    path.reverse();
    return path;
  }
}
