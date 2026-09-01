import type { TileContent } from './tileTypes';
import { isWalkableTileType } from './walkability';
import type { DungeonData, QuestChokeData } from './DungeonGenerator';
import { QUEST_EXIT_DOOR_CLOSED } from './tileTypes';
import { roomDoorways } from './roomDoorways';
import { tileCoordKey } from './tileIndex';
import { MIN_CHAIN_ROOMS, SPLIT_LANE_MAX_ROOMS } from './spineLayout';
import { arenaReserveRect, ARENA_RADIUS, ARENA_CONCOURSE_REACH } from './arenaGeometry';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export interface InvariantFailure {
  id: string;
  message: string;
}

export interface ProgressionExpectations {
  mapSize: number;
  gauntletCount: number;
  hasArena: boolean;
  /**
   * Whether this floor is supposed to seat the defense quest as a mandatory
   * choke. Stated by the caller rather than read off the layout, so a floor that
   * failed to build one fails red instead of passing vacuously.
   */
  hasQuestChoke: boolean;
  /** Whether this floor replaces its free region with a forced spine. */
  hasSpine: boolean;
  /**
   * The shortest chain the floor's own definition accepts, so a spine that came
   * back four rooms long on a floor that asked for twelve fails rather than
   * clearing a floor-wide constant that only exists to keep the quest room off
   * the ends.
   */
  spineMinRooms: number;
  /**
   * Whether the spider lab is supposed to be a dead end off the forced route.
   *
   * One expectation rather than "has a lab" AND "has a spine" at the use site: a
   * gate whose arming condition is a conjunction is a gate an extra term can
   * only ever switch off, and this one is the only thing proving the floor's one
   * optional room stayed optional.
   */
  spiderLabIsDeadEnd: boolean;
  /**
   * Safe rooms the floor asks for beyond its gateways. Stated so I5 has a
   * subject: every rule it applies is pairwise, and a floor that seated none at
   * all would satisfy all of them by having nothing to compare.
   */
  scatterSafeRooms: number;
}

/** How far `startTile` may sit from the exact map centre (I1). */
const CENTER_SPAWN_TOLERANCE_TILES = 3;
/** Doorways the start room must have so the player can leave in several directions (I2). */
const MIN_START_ROOM_DOORWAYS = 2;
/** Pairwise stairwell distance in the free region (I4). */
export const STAIRWELL_MIN_SEPARATION = 45;
/**
 * Pairwise stairwell distance inside the beyond pocket, on an arena floor (I4).
 *
 * `STAIRWELL_MIN_SEPARATION` was tuned for the whole free region; the pocket
 * behind the arena is only tens of tiles across, far too tight to ever hold two
 * stairwells that far apart.
 */
export const BEYOND_STAIRWELL_MIN_SEPARATION = 20;
/** Stairwell distance from the last gateway boss room's bounds (I4). */
export const STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT = 35;
/**
 * Stairwell distance ceiling from the last gateway boss room's bounds (I4).
 *
 * The minimum keeps the stairs out of sight of the boss door; this ceiling keeps
 * them off the map's perimeter, where maximising distance from the exit parks
 * them by construction. Between the two lies the ring a player actually sweeps
 * first, so the post-gauntlet stretch stays a hunt instead of a grid search.
 */
export const STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT = 90;
/** Pairwise scatter-safe-room distance, and their distance from gateway safe rooms (I5). */
export const SCATTER_SAFE_ROOM_SEPARATION = 30;
/**
 * Room-disjoint routes allowed between two consecutive spine rooms (S2).
 *
 * Two: the chain itself, and at most one alternate lane. A third would make the
 * stretch a free region again, which is the thing the spine replaced.
 */
const MAX_SPINE_ROUTES = 2;
/** In-node and out-node, the two halves every room splits into for the flow. */
const SPLIT_NODES_PER_ROOM = 2;
/**
 * Multiplier packing a node pair into one integer edge key. Comfortably past any
 * split-node id a floor's room count can produce.
 */
const NODE_KEY_STRIDE = 1_000_000;

// ── Geometry helpers ──────────────────────────────────────────────────────────

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from a point to the nearest point of a rectangle (0 when inside). */
export function distanceToRect(point: Point, rect: Rect): number {
  const nearestX = Math.min(Math.max(point.x, rect.x), rect.x + rect.w - 1);
  const nearestY = Math.min(Math.max(point.y, rect.y), rect.y + rect.h - 1);
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h
  );
}

// ── Flood fill ────────────────────────────────────────────────────────────────

const FLOOD_STEPS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

type FloodField = ReadonlyArray<ReadonlyArray<boolean>>;

/**
 * Reachability from `start` over walkable tiles, treating every tile inside a
 * `blockedRects` rectangle — or matched by the optional `isExtraBlocked`
 * predicate — as solid.
 *
 * Every cut-vertex invariant is phrased as "block this room, then check what
 * became unreachable", so blocking is expressed as rectangles rather than by
 * mutating a copy of the grid. The predicate exists for I6d, which has to block
 * an annulus (the concourse ring) rather than anything a rectangle can express.
 */
function floodFill(
  grid: TileContent[][],
  start: Point,
  blockedRects: ReadonlyArray<Rect>,
  isExtraBlocked?: (point: Point) => boolean,
): FloodField {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));

  const isBlocked = (x: number, y: number): boolean =>
    blockedRects.some((rect) => rectContains(rect, { x, y })) ||
    (isExtraBlocked?.({ x, y }) ?? false);

  const open = (x: number, y: number): boolean => {
    if (y < 0 || y >= height || x < 0 || x >= width) return false;
    if (visited[y][x]) return false;
    if (isBlocked(x, y)) return false;
    return isWalkableTileType(grid[y][x]);
  };

  if (!open(start.x, start.y)) return visited;

  const queue: Point[] = [{ x: start.x, y: start.y }];
  visited[start.y][start.x] = true;
  let head = 0;
  while (head < queue.length) {
    const { x, y } = queue[head];
    head++;
    for (const step of FLOOD_STEPS) {
      const nx = x + step.dx;
      const ny = y + step.dy;
      if (!open(nx, ny)) continue;
      visited[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  return visited;
}

function isReachable(flood: FloodField, point: Point): boolean {
  if (point.y < 0 || point.y >= flood.length) return false;
  const row = flood[point.y];
  if (point.x < 0 || point.x >= row.length) return false;
  return row[point.x];
}

/**
 * The first walkable tile inside a rectangle that the flood never reached, or null
 * if every one of them is reachable.
 *
 * Reports the tile rather than a count so a failure names a coordinate to go and
 * look at: an orphaned band of floor is a geometry bug a few tiles wide, and
 * "somewhere in the arena" is not enough to find it.
 */
function firstUnreachableFloor(grid: TileContent[][], flood: FloodField, rect: Rect): Point | null {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    if (y < 0 || y >= grid.length) continue;
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const row = grid[y];
      if (x < 0 || x >= row.length) continue;
      if (!isWalkableTileType(row[x])) continue;
      if (!isReachable(flood, { x, y })) return { x, y };
    }
  }
  return null;
}

/**
 * Whether any tile of a rectangle was reached. Landmarks are tested by area
 * rather than by their centre tile, because a centre can be occupied by
 * furniture (a boss room's brazier, a stairwell's own footprint) while the room
 * is plainly reachable.
 */
function isRectReachable(flood: FloodField, rect: Rect): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (isReachable(flood, { x, y })) return true;
    }
  }
  return false;
}

// ── Room-adjacency graph ──────────────────────────────────────────────────────

/**
 * Rooms to the rooms they connect to, and how many separate corridors make each
 * connection. The count is what lets a second corridor between the same pair
 * read as a second route rather than as the same one twice.
 */
type RoomGraph = ReadonlyArray<ReadonlyMap<number, number>>;

/**
 * Which rooms the carved map joins to which, read off the finished grid.
 *
 * Built from the tiles rather than from the plan for the reason every other
 * gate here reads the grid: the plan is a statement of intent, and what the
 * player walks is whatever the corridors actually cut. A corridor that strayed a
 * tile too close to a third room joined it, whatever the plan said.
 *
 * Every stretch of walkable floor outside a room is one component; each
 * component makes every room it touches mutually adjacent, which is exactly what
 * a junction does.
 */
function buildRoomGraph(grid: TileContent[][], rooms: ReadonlyArray<Rect>): RoomGraph {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const NO_ROOM = -1;
  const roomAt = Array.from({ length: height }, () => new Array<number>(width).fill(NO_ROOM));
  for (const [index, room] of rooms.entries()) {
    for (let y = room.y; y < room.y + room.h; y++) {
      if (y < 0 || y >= height) continue;
      for (let x = room.x; x < room.x + room.w; x++) {
        if (x < 0 || x >= width) continue;
        roomAt[y][x] = index;
      }
    }
  }

  const graph = rooms.map(() => new Map<number, number>());
  // Counted rather than merely recorded. Two rooms joined by two *separate*
  // corridors are joined by two genuinely room-disjoint routes, and a set would
  // collapse them onto one edge — so a second corridor cut between the same pair
  // of spine rooms would be a bypass S2 could not see, and the plan's own
  // negative test for it would come back green.
  const join = (a: number, b: number): void => {
    if (a === b) return;
    graph[a].set(b, (graph[a].get(b) ?? 0) + 1);
    graph[b].set(a, (graph[b].get(a) ?? 0) + 1);
  };

  const seen = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
  for (let startY = 0; startY < height; startY++) {
    for (let startX = 0; startX < width; startX++) {
      if (seen[startY][startX]) continue;
      seen[startY][startX] = true;
      if (roomAt[startY][startX] !== NO_ROOM) {
        // Two rooms seated flush against each other are joined directly; the
        // room gap makes that impossible today, and a future layout that
        // stopped keeping it must not read as unconnected.
        for (const step of FLOOD_STEPS) {
          const nx = startX + step.dx;
          const ny = startY + step.dy;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
          if (roomAt[ny][nx] === NO_ROOM) continue;
          if (!isWalkableTileType(grid[startY][startX])) continue;
          if (!isWalkableTileType(grid[ny][nx])) continue;
          join(roomAt[startY][startX], roomAt[ny][nx]);
        }
        continue;
      }
      if (!isWalkableTileType(grid[startY][startX])) continue;

      const touched: number[] = [];
      const queue: Point[] = [{ x: startX, y: startY }];
      let head = 0;
      while (head < queue.length) {
        const { x, y } = queue[head];
        head++;
        for (const step of FLOOD_STEPS) {
          const nx = x + step.dx;
          const ny = y + step.dy;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
          if (!isWalkableTileType(grid[ny][nx])) continue;
          const room = roomAt[ny][nx];
          if (room !== NO_ROOM) {
            touched.push(room);
            continue;
          }
          if (seen[ny][nx]) continue;
          seen[ny][nx] = true;
          queue.push({ x: nx, y: ny });
        }
      }
      // A component can touch one room at several tiles; that is still one
      // corridor, so the pairs are counted once per component.
      const distinct = [...new Set(touched)];
      for (const [index, room] of distinct.entries()) {
        for (const other of distinct.slice(index + 1)) join(room, other);
      }
    }
  }
  return graph;
}

/**
 * How many room-disjoint routes run between two rooms of a graph, capped at
 * `limit`.
 *
 * Unit-capacity max flow over a split-node graph — every intermediate room
 * becomes an in-node and an out-node joined by one unit of capacity, which is
 * the definition of "two routes that do not share a room". Residual edges and
 * all: augmenting paths without them is only a greedy packing, and a first path
 * that takes a room two later ones both needed can never be un-routed, so the
 * count comes back *low*. A low count on a "no more than two" rule is a false
 * green, which is the one direction this gate must not fail in.
 *
 * Capped because the answer only has to settle that rule, and an uncapped search
 * on a floor-sized graph would keep going long after the verdict was decided.
 */
function disjointRouteCount(
  graph: RoomGraph,
  source: number,
  sink: number,
  allowed: ReadonlySet<number>,
  limit: number,
): number {
  // Node ids: a room `r` splits into `r * 2` (in) and `r * 2 + 1` (out). Source
  // and sink are not split — they are the endpoints, and capping them would cap
  // the answer at one.
  const IN = 0;
  const OUT = 1;
  const nodeIn = (room: number): number => room * SPLIT_NODES_PER_ROOM + IN;
  const nodeOut = (room: number): number => room * SPLIT_NODES_PER_ROOM + OUT;
  const capacity = new Map<number, number>();
  const neighbours = new Map<number, Set<number>>();
  const edgeKey = (from: number, to: number): number => from * NODE_KEY_STRIDE + to;

  const addEdge = (from: number, to: number, units: number): void => {
    capacity.set(edgeKey(from, to), (capacity.get(edgeKey(from, to)) ?? 0) + units);
    capacity.set(edgeKey(to, from), capacity.get(edgeKey(to, from)) ?? 0);
    if (!neighbours.has(from)) neighbours.set(from, new Set());
    if (!neighbours.has(to)) neighbours.set(to, new Set());
    neighbours.get(from)?.add(to);
    neighbours.get(to)?.add(from);
  };

  const passable = (room: number): boolean => room === source || room === sink || allowed.has(room);

  // Only the intermediate rooms are capped. The search runs from the source's
  // out-node to the sink's in-node, so neither endpoint's own split edge lies on
  // any path — capping them would cap the answer at one route.
  for (const room of allowed) addEdge(nodeIn(room), nodeOut(room), 1);

  for (let room = 0; room < graph.length; room++) {
    if (!passable(room)) continue;
    for (const [other, corridors] of graph[room]) {
      if (!passable(other)) continue;
      addEdge(nodeOut(room), nodeIn(other), corridors);
    }
  }

  const from = nodeOut(source);
  const to = nodeIn(sink);
  let routes = 0;
  while (routes < limit) {
    const previous = new Map<number, number>();
    previous.set(from, from);
    const queue = [from];
    let head = 0;
    let found = false;
    while (head < queue.length && !found) {
      const node = queue[head];
      head++;
      for (const next of neighbours.get(node) ?? []) {
        if (previous.has(next)) continue;
        if ((capacity.get(edgeKey(node, next)) ?? 0) <= 0) continue;
        previous.set(next, node);
        if (next === to) {
          found = true;
          break;
        }
        queue.push(next);
      }
    }
    if (!found) return routes;
    let node = to;
    while (node !== from) {
      const parent = previous.get(node) ?? from;
      capacity.set(edgeKey(parent, node), (capacity.get(edgeKey(parent, node)) ?? 0) - 1);
      capacity.set(edgeKey(node, parent), (capacity.get(edgeKey(node, parent)) ?? 0) + 1);
      node = parent;
    }
    routes++;
  }
  return routes;
}

/** Rooms lying on some route between two rooms, ignoring the rest of the chain. */
function roomsBetween(
  graph: RoomGraph,
  source: number,
  sink: number,
  allowed: ReadonlySet<number>,
): Set<number> {
  const fromSource = reachableWithin(graph, source, allowed);
  const fromSink = reachableWithin(graph, sink, allowed);
  const between = new Set<number>();
  for (const room of fromSource) {
    if (fromSink.has(room)) between.add(room);
  }
  return between;
}

function reachableWithin(
  graph: RoomGraph,
  start: number,
  allowed: ReadonlySet<number>,
): Set<number> {
  const seen = new Set<number>();
  const queue: number[] = [];
  for (const next of graph[start].keys()) {
    if (!allowed.has(next) || seen.has(next)) continue;
    seen.add(next);
    queue.push(next);
  }
  let head = 0;
  while (head < queue.length) {
    const room = queue[head];
    head++;
    for (const next of graph[room].keys()) {
      if (!allowed.has(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

// ── Invariants ────────────────────────────────────────────────────────────────

function isSameTile(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function stairwellFootprint(tile: Point): Rect {
  return { x: tile.x, y: tile.y, w: 1, h: 1 };
}

/**
 * Checks every topology invariant the forced-progression design depends on.
 * Pure: grid and layout data in, a list of failures out. Run both by the
 * generator's retry loop and by the offline verification harness.
 */
export function validateProgression(
  data: DungeonData,
  expectations: ProgressionExpectations,
): InvariantFailure[] {
  const failures: InvariantFailure[] = [];
  const fail = (id: string, message: string): void => {
    failures.push({ id, message });
  };

  const { grid, startTile, safeRooms, bossRooms, questRooms, stairwellTiles } = data;
  const {
    mapSize,
    gauntletCount,
    hasArena,
    hasQuestChoke,
    hasSpine,
    spiderLabIsDeadEnd,
    spineMinRooms,
    scatterSafeRooms: expectedScatterSafeRooms,
  } = expectations;
  const layout = data.progressionLayout;

  const fullFlood = floodFill(grid, startTile, []);

  // I7 — everything the floor advertises is reachable with nothing removed.
  for (const [index, room] of bossRooms.entries()) {
    if (!isRectReachable(fullFlood, room.bounds)) {
      fail('I7', `boss room ${index} is unreachable from the start tile`);
    }
  }
  for (const [index, room] of safeRooms.entries()) {
    if (!isRectReachable(fullFlood, room.bounds)) {
      fail('I7', `safe room ${index} is unreachable from the start tile`);
    }
  }
  for (const [index, room] of questRooms.entries()) {
    if (!isRectReachable(fullFlood, room.bounds)) {
      fail('I7', `quest room ${index} is unreachable from the start tile`);
    }
  }
  if (data.spiderLabRoom !== null && !isRectReachable(fullFlood, data.spiderLabRoom.bounds)) {
    fail('I7', 'spider lab is unreachable from the start tile');
  }
  for (const [index, tile] of stairwellTiles.entries()) {
    if (!isReachable(fullFlood, tile)) {
      fail('I7', `stairwell ${index} at (${tile.x},${tile.y}) is unreachable from the start tile`);
    }
  }

  if (gauntletCount === 0) return failures;

  if (layout === undefined) {
    fail('I8', 'progression floor generated without gauntlet layout data');
    return failures;
  }

  // I1 — the player spawns at the middle of the map, inside the start room.
  const mapCentre: Point = { x: Math.floor(mapSize / 2), y: Math.floor(mapSize / 2) };
  const centreOffset = pointDistance(startTile, mapCentre);
  if (centreOffset > CENTER_SPAWN_TOLERANCE_TILES) {
    fail('I1', `start tile is ${centreOffset.toFixed(1)} tiles from the map centre`);
  }
  if (!rectContains(layout.startRoom, startTile)) {
    fail('I1', 'start tile lies outside the start room');
  }

  // I2 — the start room can be left in more than one direction.
  const startDoorways = roomDoorways(grid, layout.startRoom).length;
  if (startDoorways < MIN_START_ROOM_DOORWAYS) {
    fail(
      'I2',
      `start room has ${startDoorways} distinct doorways, expected at least ${MIN_START_ROOM_DOORWAYS}`,
    );
  }

  // I8 — one boss room per gauntlet, index-aligned.
  if (bossRooms.length < gauntletCount) {
    fail('I8', `${bossRooms.length} boss rooms for ${gauntletCount} gauntlets`);
    return failures;
  }
  if (safeRooms.length < gauntletCount) {
    fail('I8', `${safeRooms.length} safe rooms for ${gauntletCount} gauntlets`);
    return failures;
  }

  const gatewaySafeRooms = safeRooms.slice(0, gauntletCount);
  const otherSafeRooms = safeRooms.slice(gauntletCount);
  const antechamber = otherSafeRooms.find((room) => room.guardsBossType !== undefined);
  const scatterSafeRooms = otherSafeRooms.filter((room) => room.guardsBossType === undefined);

  for (const [index, room] of gatewaySafeRooms.entries()) {
    if (room.guardsBossType === undefined) {
      fail('I8', `gateway safe room ${index} carries no guardsBossType`);
    }
  }

  const lastBossRoom = bossRooms[gauntletCount - 1];
  const arena = data.arenaExteriors.length > 0 ? data.arenaExteriors[0] : null;
  const arenaDoorTile = data.arenaDoorTile;
  const questChoke = layout.questChoke;

  /** What a choke room stands between the player and, as a rectangle to test. */
  const chokeBlocks = (choke: QuestChokeData): Rect | null => {
    if (choke.blocks === 'gatewaySafeRoom')
      return gatewaySafeRooms[choke.gauntletIndex]?.bounds ?? null;
    if (choke.blocks === 'gatewayBossRoom') return bossRooms[choke.gauntletIndex]?.bounds ?? null;
    return antechamber?.bounds ?? null;
  };

  // I3 — each gateway safe room and its boss room are cut vertices: nothing past
  // them survives their removal.
  for (let k = 0; k < gauntletCount; k++) {
    const gatewaySafe = gatewaySafeRooms[k];
    const gatewayBoss = bossRooms[k];

    const laterLandmarks: Array<{ label: string; rect: Rect }> = [];
    for (let later = k + 1; later < gauntletCount; later++) {
      laterLandmarks.push({
        label: `gateway safe room ${later}`,
        rect: gatewaySafeRooms[later].bounds,
      });
      laterLandmarks.push({ label: `gateway boss room ${later}`, rect: bossRooms[later].bounds });
    }
    for (const [index, tile] of stairwellTiles.entries()) {
      laterLandmarks.push({ label: `stairwell ${index}`, rect: stairwellFootprint(tile) });
    }
    if (hasArena && arenaDoorTile !== undefined) {
      laterLandmarks.push({ label: 'arena door', rect: stairwellFootprint(arenaDoorTile) });
    }

    // A quest room seated as a choke is not automatically past every gateway: on
    // floor 1 it sits between the two bosses, so it is a later landmark for the
    // first gauntlet and an earlier one for the second. And the two halves of a
    // gateway hide different things — an approach choke sits behind its own
    // gateway's safe room but in front of that gateway's boss room, so it must
    // vanish with the safe room and survive the boss room.
    const afterBossRoom = questChoke === null || k < questChoke.rank;
    const afterSafeRoom =
      questChoke === null ||
      (questChoke.blocks === 'gatewayBossRoom' ? k <= questChoke.rank : k < questChoke.rank);
    const questLandmarks = questRooms.map((room, index) => ({
      label: `quest room ${index}`,
      rect: room.bounds,
    }));

    // I3a — remove the gateway safe room.
    const withoutSafe = floodFill(grid, startTile, [gatewaySafe.bounds]);
    if (isRectReachable(withoutSafe, gatewayBoss.bounds)) {
      fail('I3a', `gauntlet ${k}: boss room is reachable without its gateway safe room`);
    }
    const safeSideLandmarks = afterSafeRoom
      ? [...laterLandmarks, ...questLandmarks]
      : laterLandmarks;
    for (const landmark of safeSideLandmarks) {
      if (isRectReachable(withoutSafe, landmark.rect)) {
        fail('I3a', `gauntlet ${k}: ${landmark.label} is reachable without the gateway safe room`);
      }
    }

    // I3b — remove the gateway boss room.
    const withoutBoss = floodFill(grid, startTile, [gatewayBoss.bounds]);
    if (!isRectReachable(withoutBoss, gatewaySafe.bounds)) {
      fail('I3b', `gauntlet ${k}: gateway safe room became unreachable without the boss room`);
    }
    const bossSideLandmarks = afterBossRoom
      ? [...laterLandmarks, ...questLandmarks]
      : laterLandmarks;
    for (const landmark of bossSideLandmarks) {
      if (isRectReachable(withoutBoss, landmark.rect)) {
        fail('I3b', `gauntlet ${k}: ${landmark.label} is reachable without the gateway boss room`);
      }
    }
  }

  // I4 — stairwells are spread out, well past the last boss's exit, and never
  // sitting inside a gauntlet.
  //
  // On an arena floor every stairwell seats inside the beyond pocket, which is
  // far tighter than the free region `STAIRWELL_MIN_SEPARATION` was tuned for —
  // so the pairwise check uses the pocket's own, tighter minimum there instead.
  const stairwellSeparationMin = hasArena
    ? BEYOND_STAIRWELL_MIN_SEPARATION
    : STAIRWELL_MIN_SEPARATION;
  if (stairwellTiles.length === 0) {
    fail('I4', 'the floor has no stairwell down');
  }
  for (let i = 0; i < stairwellTiles.length; i++) {
    const tile = stairwellTiles[i];
    const distFromExit = distanceToRect(tile, lastBossRoom.bounds);
    if (!layout.stairwellSpacingWaived && distFromExit < STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT) {
      fail(
        'I4',
        `stairwell ${i} is ${distFromExit.toFixed(1)} tiles from the last boss room (min ${STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT})`,
      );
    }
    // The ceiling governs a stairwell that came from the banded pool. The rest
    // came from the widened fallback, which only ever guaranteed the minimum:
    // the band is too thin to hold a whole floor's set at the required spacing,
    // so demanding the ceiling of those stairwells would reject every map.
    const cameFromBand = layout.bandedStairwellTiles.some((banded) => isSameTile(banded, tile));
    if (
      cameFromBand &&
      !layout.stairwellSpacingWaived &&
      distFromExit > STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT
    ) {
      fail(
        'I4',
        `stairwell ${i} is ${distFromExit.toFixed(1)} tiles from the last boss room (max ${STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT})`,
      );
    }
    for (let j = i + 1; j < stairwellTiles.length; j++) {
      const separation = pointDistance(tile, stairwellTiles[j]);
      if (separation < stairwellSeparationMin) {
        fail(
          'I4',
          `stairwells ${i} and ${j} are ${separation.toFixed(1)} tiles apart (min ${stairwellSeparationMin})`,
        );
      }
    }
    for (const gauntletRooms of layout.gauntletRoomBounds) {
      if (gauntletRooms.some((rect) => rectContains(rect, tile))) {
        fail('I4', `stairwell ${i} sits inside a gauntlet room`);
      }
    }
  }

  // I5 — the floor has the scatter safe rooms it asked for, they never cluster,
  // and they never crowd a gateway.
  if (scatterSafeRooms.length < expectedScatterSafeRooms) {
    fail(
      'I5',
      `${scatterSafeRooms.length} scatter safe rooms, expected ${expectedScatterSafeRooms}`,
    );
  }
  for (let i = 0; i < scatterSafeRooms.length; i++) {
    for (let j = i + 1; j < scatterSafeRooms.length; j++) {
      const separation = pointDistance(scatterSafeRooms[i].centre, scatterSafeRooms[j].centre);
      if (separation < SCATTER_SAFE_ROOM_SEPARATION) {
        fail(
          'I5',
          `scatter safe rooms ${i} and ${j} are ${separation.toFixed(1)} tiles apart (min ${SCATTER_SAFE_ROOM_SEPARATION})`,
        );
      }
    }
    for (const [gatewayIndex, gateway] of gatewaySafeRooms.entries()) {
      const separation = pointDistance(scatterSafeRooms[i].centre, gateway.centre);
      if (separation < SCATTER_SAFE_ROOM_SEPARATION) {
        fail(
          'I5',
          `scatter safe room ${i} is ${separation.toFixed(1)} tiles from gateway safe room ${gatewayIndex} (min ${SCATTER_SAFE_ROOM_SEPARATION})`,
        );
      }
    }
  }

  // S4 — the defense quest's room is a choke the player cannot walk around, and
  // S5 — walking through it is the whole of what it asks. The wave inside is
  // the goblin mother's to offer and the player's to decline, so nothing about
  // the room may be generated shut.
  //
  // Both gates prove their subject exists first. A floor that failed to seat a
  // choke has to fail red: a check phrased only as "removing X strands Y"
  // passes on its own when there is no X to remove.
  if (hasQuestChoke) {
    const blockedRect = questChoke === null ? null : chokeBlocks(questChoke);
    if (questChoke === null) {
      fail('S4', 'this floor expects a mandatory quest choke and generated none');
    } else if (questRooms.length === 0) {
      fail('S4', 'a quest choke was planned but no quest room was built');
    } else if (blockedRect === null) {
      fail('S4', `quest choke names a ${questChoke.blocks} that this floor does not have`);
    } else {
      const questRoom = questRooms[0];
      const withoutChoke = floodFill(grid, startTile, [questRoom.bounds]);
      if (isRectReachable(withoutChoke, blockedRect)) {
        fail('S4', `the ${questChoke.blocks} is reachable without passing through the quest room`);
      }

      if (questRoom.exitDoorTiles.length === 0) {
        fail('S5', 'the quest room has no onward doorway');
      }
      // Stated separately from the tile checks below because the two failures
      // are opposite, and only one of them is loud: a doorway list that is too
      // short leaves a way past the room, while one that swallowed the entrance
      // hands the goblin mother the way *in* to bar, and shuts the party out of
      // a room they are meant to walk through.
      const onwardTiles = new Set(
        questRoom.exitDoorTiles.map((tile) => tileCoordKey(tile.x, tile.y)),
      );
      if (onwardTiles.has(tileCoordKey(questRoom.entranceTile.x, questRoom.entranceTile.y))) {
        fail('S5', 'the quest room’s own entrance is listed among its ways onward');
      }
      for (const tile of questRoom.exitDoorTiles) {
        const doorTile = grid[tile.y][tile.x];
        // The boarded state exists, and is written by the quest at runtime for
        // the length of a wave the player accepted. Baked into the grid it
        // would be a toll gate again, which is the one thing this room is not.
        if (doorTile.type === QUEST_EXIT_DOOR_CLOSED) {
          fail('S5', `the onward doorway at (${tile.x},${tile.y}) generates boarded shut`);
        } else if (!isWalkableTileType(doorTile)) {
          fail('S5', `the onward doorway at (${tile.x},${tile.y}) generates unwalkable`);
        }
      }
    }
  }

  // S1–S3 — the forced spine past the last gateway boss.
  //
  // Armed from the floor's own definition rather than from what got built, so a
  // floor that fell back to a free region fails red here instead of skipping
  // three gates in silence.
  //
  // The room-adjacency graph is built once here rather than inside a gate,
  // because two of them need it and building it twice would be two walks of the
  // whole map for one answer.
  const roomGraph = hasSpine || spiderLabIsDeadEnd ? buildRoomGraph(grid, layout.roomBounds) : null;
  const roomIndexOf = (rect: Rect): number =>
    layout.roomBounds.findIndex(
      (bounds) =>
        bounds.x === rect.x && bounds.y === rect.y && bounds.w === rect.w && bounds.h === rect.h,
    );

  if (hasSpine) {
    const spine = layout.spine;
    if (spine === null) {
      fail('S1', 'this floor expects a forced spine and generated none');
    } else if (antechamber === undefined) {
      fail('S1', 'a spine was built but the floor has no antechamber for it to end at');
    } else {
      const antechamberBounds = antechamber.bounds;
      const shortestChain = Math.max(MIN_CHAIN_ROOMS, spineMinRooms);
      if (spine.chain.length < shortestChain) {
        fail(
          'S1',
          `the spine holds ${spine.chain.length} rooms, too few to be a forced journey ` +
            `(min ${shortestChain})`,
        );
      }

      // S1 — every chain room is a cut vertex: the antechamber is unreachable
      // without it. This is what "one way through" means, measured room by room.
      for (const [index, room] of spine.chain.entries()) {
        const withoutRoom = floodFill(grid, startTile, [room]);
        if (isRectReachable(withoutRoom, antechamberBounds)) {
          fail('S1', `the antechamber is reachable without spine room ${index}`);
        }
      }

      // S2 — at most two routes between consecutive chain rooms, and any second
      // one holds at most `SPLIT_LANE_MAX_ROOMS`. Measured on the carved map's
      // room graph, not on the plan: the plan can be wrong about what got cut.
      const graph = roomGraph ?? [];
      const chainIndices = spine.chain.map(roomIndexOf);
      if (chainIndices.some((index) => index < 0)) {
        fail('S2', 'a spine chain room is missing from the floor’s room list');
      } else {
        const chainSet = new Set(chainIndices);
        for (let step = 0; step + 1 < chainIndices.length; step++) {
          const fromRoom = chainIndices[step];
          const toRoom = chainIndices[step + 1];
          // Every room but the rest of the chain, so a route that leaves the pair
          // and rejoins further along counts as the bypass it would be.
          const allowed = new Set<number>();
          for (let room = 0; room < layout.roomBounds.length; room++) {
            if (room === fromRoom || room === toRoom) continue;
            if (chainSet.has(room)) continue;
            allowed.add(room);
          }
          const routes = disjointRouteCount(graph, fromRoom, toRoom, allowed, MAX_SPINE_ROUTES + 1);
          if (routes > MAX_SPINE_ROUTES) {
            fail(
              'S2',
              `spine rooms ${step} and ${step + 1} have ${routes} separate routes between them`,
            );
          }
          const lane = roomsBetween(graph, fromRoom, toRoom, allowed);
          if (lane.size > SPLIT_LANE_MAX_ROOMS) {
            fail(
              'S2',
              `the lane between spine rooms ${step} and ${step + 1} holds ${lane.size} rooms ` +
                `(max ${SPLIT_LANE_MAX_ROOMS})`,
            );
          }
        }
      }
    }
  }

  // S3 — the spider lab hangs off the route as a dead end, so walking past its
  // doorway is a choice rather than a detour the route makes for you.
  if (spiderLabIsDeadEnd) {
    if (data.spiderLabRoom === null) {
      fail('S3', 'this floor expects a spider lab and generated none');
    } else {
      const labBounds = data.spiderLabRoom.bounds;
      const labDoorways = roomDoorways(grid, labBounds);
      if (labDoorways.length !== 1) {
        fail('S3', `the spider lab has ${labDoorways.length} doorways, expected exactly 1`);
      }

      // A leaf on the room graph, measured on the carved map. Sealing the lab's
      // own doorway tiles and checking it went unreachable would prove nothing:
      // those tiles are every perimeter tile with open floor outside it, so
      // sealing them disconnects *any* rectangle from *anything*, and the check
      // could not fail however many ways in the room had. Counting the rooms it
      // reaches is the property the plan actually asks for — and it is the one
      // that fails on a lab standing in open ground, which the doorway count
      // deliberately reports as a single very wide opening.
      const labIndex = roomIndexOf(labBounds);
      if (labIndex < 0 || roomGraph === null) {
        fail('S3', 'the spider lab is missing from the floor’s room list');
      } else {
        const neighbours = roomGraph[labIndex];
        if (neighbours.size !== 1) {
          fail(
            'S3',
            `the spider lab connects to ${neighbours.size} rooms, expected exactly 1 — it is a ` +
              'stop on the route rather than a dead end off it',
          );
        }
        for (const [neighbour, corridors] of neighbours) {
          if (corridors > 1) {
            fail(
              'S3',
              `the spider lab is joined to room ${neighbour} by ${corridors} separate corridors`,
            );
          }
        }
      }
    }
  }

  // I6 — the arena is only reachable through its antechamber, and skipping both
  // still leaves the rest of the floor open.
  if (hasArena) {
    if (antechamber === undefined) {
      fail('I6', 'arena floor generated without an antechamber safe room');
    } else if (arenaDoorTile === undefined || arena === null) {
      fail('I6', 'arena floor generated without an arena door tile');
    } else {
      const withoutAntechamber = floodFill(grid, startTile, [antechamber.bounds]);
      if (isReachable(withoutAntechamber, arenaDoorTile)) {
        fail('I6', 'the arena door is reachable without passing through the antechamber');
      }

      // I6c — every stairwell now lives behind the arena, so blocking only the
      // antechamber has to strand every one of them, not just the door. This is
      // the inverse of the check this design replaces: the old I6 proved a
      // stairwell survived without the arena, which was exactly the proof that
      // the floor was skippable. `withoutAntechamber` already blocks the
      // antechamber alone, so it is reused rather than flooded twice.
      for (const [index, tile] of stairwellTiles.entries()) {
        if (isReachable(withoutAntechamber, tile)) {
          fail(
            'I6c',
            `stairwell ${index} at (${tile.x},${tile.y}) is reachable without the antechamber`,
          );
        }
      }

      // I6d — the viewing walk itself. I6c alone would pass a future corridor
      // that slipped from the antechamber straight into the beyond pocket
      // without ever touching the ring; blocking the ring instead makes the
      // half-circuit — the stretch of route with the drum on screen — the thing
      // that is machine-checked. Same annulus-minus-antechamber predicate the
      // concourse-ring carve uses, so drift between carving and checking is
      // impossible by construction.
      const isConcourseRingTile = (point: Point): boolean => {
        const radius = Math.hypot(point.x - arena.centre.x, point.y - arena.centre.y);
        if (radius <= ARENA_RADIUS || radius > ARENA_CONCOURSE_REACH) return false;
        return !rectContains(antechamber.bounds, point);
      };
      const withoutConcourseRing = floodFill(grid, startTile, [], isConcourseRingTile);
      for (const [index, tile] of stairwellTiles.entries()) {
        if (isReachable(withoutConcourseRing, tile)) {
          fail(
            'I6d',
            `stairwell ${index} at (${tile.x},${tile.y}) is reachable without crossing the concourse ring`,
          );
        }
      }

      // I6b — nothing the arena carves is orphaned.
      //
      // Measured against the same `fullFlood` every other unblocked check uses: a
      // second identical BFS is not only a wasted walk of the whole map, it is a
      // second definition of "reachable with nothing blocked" that can drift.
      //
      // The concourse is a ring of floor inside reserved rock whose only ways in
      // are two links down into the antechamber. Get those wrong by a tile and it
      // becomes a band of floor nothing in the game can ever walk on — invisible
      // in a screenshot, invisible in the invariants above, and exactly the failure
      // the outer ring used to be suppressed to avoid. So the whole footprint is
      // walked: every carved tile the arena owns has to be reachable.
      const orphan = firstUnreachableFloor(grid, fullFlood, arenaReserveRect(arena.centre));
      if (orphan !== null) {
        fail(
          'I6b',
          `the arena carves floor at ${orphan.x},${orphan.y} that nothing can reach — the ` +
            `concourse is not joined to the antechamber`,
        );
      }
    }
  }

  return failures;
}
