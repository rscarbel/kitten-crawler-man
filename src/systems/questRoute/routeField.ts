/**
 * Which way to walk toward a quest's destination, from anywhere on a map.
 *
 * One Dijkstra outward from the destination's goal tiles prices every tile
 * the party can stand on with the cost of the cheapest walk from it to the
 * goal. A party that wanders, fights and doubles back then needs no replan:
 * the way on from wherever it stands is just downhill ({@link downhillChain}).
 *
 * Pure: no canvas, no scene. A field is a snapshot of the map's walkability
 * when it was built, and the guide that owns it decides when to build again.
 */

import type { MobilityClass } from '../../map/mobility';
import { MinHeap } from '../../core/util/MinHeap';
import type { GameMap } from '../../map/GameMap';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import { tileCoordKey, tileIndex } from '../../map/tileIndex';
import { HOLLOW_GATE } from '../../map/tileTypes';
import { isPavedTileType } from '../../map/town/tileGrid';
import type { TilePoint } from '../../map/town/townPlan';
import { doorwayKeys } from '../doorwayTiles';
import type { TrackerTarget } from '../questTracker';

/** A step along a road, lane, bridge or the village gate. */
export const QUEST_ROUTE_ROAD_COST = 1;
/**
 * A step over open ground. Only twice a road step, far gentler than the
 * escort's road-hugging price: a player is not to be marched a long way round
 * just to keep to a road.
 */
export const QUEST_ROUTE_OPEN_COST = 2;
/** A step through river water, dear enough that a bridge nearby is always taken. */
export const QUEST_ROUTE_WADE_COST = 10;
/** Added to a tile beside a blocked one, so the route keeps off wall edges. */
export const QUEST_ROUTE_HUG_PENALTY = 0.5;
/**
 * How far round a start tile the walk cannot begin on (a doorway, the tile a
 * body's centre rounds into a wall) a chain looks for one it can, in tiles.
 */
export const QUEST_ROUTE_START_SEARCH_TILES = 3;

const DIAGONAL_STEP_LENGTH = Math.SQRT2;
/** Cost of a tile the field has not reached. */
const UNREACHED = Infinity;
/** A tile's walkability, read from the map the first time the build reaches it. */
const UNREAD = 0;
const PASSABLE = 1;
const NOT_PASSABLE = 2;

const CARDINAL_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** A diagonal step, and the two cardinal steps a body would cut the corner between. */
interface DiagonalStep {
  readonly dx: number;
  readonly dy: number;
}

const DIAGONAL_STEPS: readonly DiagonalStep[] = [
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];

/** A finished field: the cost of the cheapest walk from each tile to the goal. */
export interface RouteField {
  readonly columns: number;
  readonly rows: number;
  /** Per tile, by `tileIndex`: the walk's cost from there, `Infinity` where none reaches. */
  readonly cost: Float32Array;
  /** Per tile: what stepping onto it costs, before any diagonal stretch. */
  readonly stepCost: Float32Array;
  /**
   * Per tile: whether the route may stand there, as the map stood when the
   * build reached it. Read lazily, so a tile nothing reached stays unread.
   */
  readonly passable: Uint8Array;
  /** The goal tiles, as `tileCoordKey`s. */
  readonly goalKeys: ReadonlySet<number>;
  /** The build's open list, kept with the buffers so a rebuild allocates none. */
  readonly heap: MinHeap;
  /** Per tile: 1 once the build has priced it for good. Build scratch, kept for reuse. */
  readonly settled: Uint8Array;
}

function mapColumns(gameMap: GameMap): number {
  return gameMap.structure[0]?.length ?? gameMap.structure.length;
}

function isInside(columns: number, rows: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < columns && y < rows;
}

/** Whether (x, y) is a road surface: a street, a track, a bridge deck or the village gate. */
function isRoadTile(gameMap: GameMap, x: number, y: number): boolean {
  const type = gameMap.structure[y][x].type;
  return isPavedTileType(type) || type === HOLLOW_GATE;
}

/**
 * Whether a quest route may stand on (x, y): walkable, never a stairwell
 * (stepping on one asks to leave the floor), and never a doorway unless it is
 * one of the goal's own, since stepping on a doorway is how the party arrives.
 */
export function isRouteStep(
  gameMap: GameMap,
  x: number,
  y: number,
  doorways: ReadonlySet<number>,
  goalKeys: ReadonlySet<number>,
  mobility: MobilityClass,
): boolean {
  const key = tileCoordKey(x, y);
  if (goalKeys.has(key)) return true;
  if (!gameMap.isWalkable(x, y, mobility) || gameMap.isStairwellTile(x, y)) return false;
  return !doorways.has(key);
}

/**
 * The tiles a walk to `target` ends on: the walkable tiles of its footprint's
 * row, doorway tiles included. Where none of those can be stood on (a
 * character's own tile, a stall's counter), the open tiles round the
 * footprint instead. Empty when nothing round it is open either.
 */
export function goalTilesForTarget(
  gameMap: GameMap,
  target: TrackerTarget,
  mobility: MobilityClass,
): TilePoint[] {
  const width = target.widthTiles ?? 1;
  const footprint: TilePoint[] = [];
  for (let x = target.x; x < target.x + width; x++) {
    if (gameMap.isWalkable(x, target.y, mobility)) footprint.push({ x, y: target.y });
  }
  if (footprint.length > 0) return footprint;

  const doorways = doorwayKeys(gameMap);
  const around: TilePoint[] = [];
  for (let y = target.y - 1; y <= target.y + 1; y++) {
    for (let x = target.x - 1; x <= target.x + width; x++) {
      const onFootprint = y === target.y && x >= target.x && x < target.x + width;
      if (onFootprint) continue;
      if (!isRouteStep(gameMap, x, y, doorways, new Set(), mobility)) continue;
      around.push({ x, y });
    }
  }
  return around;
}

/**
 * A field built a slice at a time: {@link step} expands up to a budget of
 * tiles and says whether the field is done, {@link result} hands it over once
 * it is. Each tile's walkability is read from the map only when the build
 * first reaches it, so no step reads the whole map at once. The buffers it is
 * given are filled in place, so a guide can keep two and swap them rather
 * than allocate a field per build.
 */
export class RouteFieldBuilder {
  private readonly doorways: ReadonlySet<number>;
  private readonly field: RouteField;
  private finished = false;

  constructor(
    private readonly gameMap: GameMap,
    goals: readonly TilePoint[],
    buffers: RouteField,
    private readonly mobility: MobilityClass,
  ) {
    const goalKeys = new Set(goals.map((goal) => tileCoordKey(goal.x, goal.y)));
    this.field = { ...buffers, goalKeys };
    const { columns, rows, cost, passable, heap, settled } = this.field;
    this.doorways = doorwayKeys(gameMap);
    heap.clear();
    settled.fill(0);
    cost.fill(UNREACHED);
    passable.fill(UNREAD);
    for (const goal of goals) {
      if (!isInside(columns, rows, goal.x, goal.y)) continue;
      const index = tileIndex(goal.x, goal.y, columns);
      cost[index] = 0;
      heap.push(index, 0);
    }
  }

  private isPassable(x: number, y: number): boolean {
    const { columns, rows, passable } = this.field;
    if (!isInside(columns, rows, x, y)) return false;
    const index = tileIndex(x, y, columns);
    if (passable[index] === UNREAD) {
      const standable = isRouteStep(
        this.gameMap,
        x,
        y,
        this.doorways,
        this.field.goalKeys,
        this.mobility,
      );
      passable[index] = standable ? PASSABLE : NOT_PASSABLE;
    }
    return passable[index] === PASSABLE;
  }

  private priceStep(x: number, y: number): number {
    const gameMap = this.gameMap;
    const base = gameMap.isWadeable(x, y)
      ? QUEST_ROUTE_WADE_COST
      : isRoadTile(gameMap, x, y)
        ? QUEST_ROUTE_ROAD_COST
        : QUEST_ROUTE_OPEN_COST;
    const besideBlocked = CARDINAL_STEPS.some(([dx, dy]) => !this.isPassable(x + dx, y + dy));
    return base + (besideBlocked ? QUEST_ROUTE_HUG_PENALTY : 0);
  }

  /** Expands up to `budget` tiles; true once every reachable tile is priced. */
  step(budget: number): boolean {
    if (this.finished) return true;
    const { columns, cost, stepCost } = this.field;
    let expanded = 0;
    while (expanded < budget) {
      if (this.field.heap.size === 0) {
        this.finished = true;
        return true;
      }
      const index = this.field.heap.pop();
      if (this.field.settled[index] === 1) continue;
      this.field.settled[index] = 1;
      expanded++;
      const x = index % columns;
      const y = (index - x) / columns;
      stepCost[index] = this.priceStep(x, y);
      const throughHere = cost[index] + stepCost[index];
      const throughHereDiagonally = cost[index] + stepCost[index] * DIAGONAL_STEP_LENGTH;
      for (const [dx, dy] of CARDINAL_STEPS) {
        this.relax(x + dx, y + dy, throughHere);
      }
      for (const { dx, dy } of DIAGONAL_STEPS) {
        if (!cornerIsOpen(this.field, x, y, dx, dy)) continue;
        this.relax(x + dx, y + dy, throughHereDiagonally);
      }
    }
    return false;
  }

  private relax(x: number, y: number, total: number): void {
    if (!this.isPassable(x, y)) return;
    const next = tileIndex(x, y, this.field.columns);
    if (total >= this.field.cost[next]) return;
    this.field.cost[next] = total;
    this.field.heap.push(next, total);
  }

  /** The field once {@link step} has reported it done; null before. */
  result(): RouteField | null {
    return this.finished ? this.field : null;
  }
}

/**
 * Whether a diagonal step from (x, y) cuts no wall corner: both cardinal
 * tiles beside it are open. Asked only of tiles whose cardinal neighbours
 * the build has already read.
 */
function cornerIsOpen(field: RouteField, x: number, y: number, dx: number, dy: number): boolean {
  const { columns, rows, passable } = field;
  if (!isInside(columns, rows, x + dx, y) || !isInside(columns, rows, x, y + dy)) return false;
  return (
    passable[tileIndex(x + dx, y, columns)] === PASSABLE &&
    passable[tileIndex(x, y + dy, columns)] === PASSABLE
  );
}

/** Buffers for one field over `gameMap`, reused from `reuse` when it is the right size. */
export function routeFieldBuffers(gameMap: GameMap, reuse: RouteField | null): RouteField {
  const columns = mapColumns(gameMap);
  const rows = gameMap.structure.length;
  const tileCount = columns * rows;
  if (reuse?.columns === columns && reuse.rows === rows) return reuse;
  return {
    columns,
    rows,
    cost: new Float32Array(tileCount),
    stepCost: new Float32Array(tileCount),
    passable: new Uint8Array(tileCount),
    goalKeys: new Set(),
    heap: new MinHeap(tileCount),
    settled: new Uint8Array(tileCount),
  };
}

/** A whole field toward `goals`, built at once. */
export function buildRouteField(
  gameMap: GameMap,
  goals: readonly TilePoint[],
  mobility: MobilityClass,
  reuse: RouteField | null = null,
): RouteField {
  const builder = new RouteFieldBuilder(
    gameMap,
    goals,
    routeFieldBuffers(gameMap, reuse),
    mobility,
  );
  builder.step(Infinity);
  const field = builder.result();
  if (field === null) throw new Error('a route field built without a budget did not finish');
  return field;
}

function costAt(field: RouteField, x: number, y: number): number {
  if (!isInside(field.columns, field.rows, x, y)) return UNREACHED;
  return field.cost[tileIndex(x, y, field.columns)];
}

/**
 * The tile walk from `from` toward the field's goal, each step to whichever
 * neighbour makes the rest of the walk cheapest. Stops on a goal tile, at a
 * tile with nowhere cheaper to go, or after `maxTiles` steps. Where `from`
 * itself is not on the field (a doorway, a rounding into a wall), the walk
 * starts from the nearest tile round it that is. Empty when there is none.
 */
export function downhillChain(
  field: RouteField,
  gameMap: GameMap,
  from: TilePoint,
  maxTiles: number,
): TilePoint[] {
  const isOnField = (x: number, y: number): boolean => costAt(field, x, y) < UNREACHED;
  const start = isOnField(from.x, from.y)
    ? from
    : findNearbyWalkableTile(gameMap, from.x, from.y, QUEST_ROUTE_START_SEARCH_TILES, isOnField);
  if (start === null) return [];
  const chain: TilePoint[] = [{ x: start.x, y: start.y }];
  let x = start.x;
  let y = start.y;
  while (chain.length <= maxTiles && !field.goalKeys.has(tileCoordKey(x, y))) {
    const here = costAt(field, x, y);
    let bestX = x;
    let bestY = y;
    let bestCost = UNREACHED;
    for (const [dx, dy] of CARDINAL_STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      const via = costAt(field, nx, ny);
      if (via >= here) continue;
      const total = via + field.stepCost[tileIndex(nx, ny, field.columns)];
      if (total < bestCost) {
        bestCost = total;
        bestX = nx;
        bestY = ny;
      }
    }
    for (const { dx, dy } of DIAGONAL_STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!cornerIsOpen(field, x, y, dx, dy)) continue;
      const via = costAt(field, nx, ny);
      if (via >= here) continue;
      const total = via + field.stepCost[tileIndex(nx, ny, field.columns)] * DIAGONAL_STEP_LENGTH;
      if (total < bestCost) {
        bestCost = total;
        bestX = nx;
        bestY = ny;
      }
    }
    if (bestX === x && bestY === y) break;
    x = bestX;
    y = bestY;
    chain.push({ x, y });
  }
  return chain;
}
