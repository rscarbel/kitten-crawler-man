import { FloorTypeValue, type TileContent } from './tileTypes';
import type { CardinalDirection } from '../utils';
import { buildRoomGraph, corridorComponents, type RoomGraph } from './progressionValidation';
import {
  ROOM_WALL_OUTWARD,
  roomDoorways,
  type Point,
  type Rect,
  type RoomDoorway,
} from './roomDoorways';
import { hasOpenRegion } from './findWalkableTile';
import { tileCoordKey, tileKeyX, tileKeyY } from './tileIndex';
import { findHallwayForks, mouthOnSide, type ForkBranch, type ForkSide } from './hallwayForks';
import { isWalkableTileType } from './walkability';

export type CrawlerSignDirection = Extract<CardinalDirection, 'North' | 'East' | 'South' | 'West'>;

export interface CrawlerSignPlacement {
  readonly tile: Point;
  /** The wall the onward corridor leaves through; what the sign's words say. */
  readonly direction: CrawlerSignDirection;
  /**
   * Bearing from the sign tile's centre to the centre of the first tile of the onward
   * hallway (the corridor tile just outside the onward doorway for a room sign, the
   * branch tile beside the junction for a hallway sign), radians with y down (0 is
   * east). Diagonal when that tile is off-axis; what the painted arrow turns to.
   * Always within a quarter turn of {@link direction}: where the entrance lies
   * beside or behind the sign, the arrow is the direction itself, so the words and
   * the paint agree.
   */
  readonly arrowAngleRadians: number;
}

/** Where a sign stands: on a junction room's floor, or in a wall pocket beside a hallway junction. */
export type CrawlerSignKind = 'room' | 'hallway';

/** A sign as the planner decides it: the placement plus how the generator seats it. */
export interface PlannedCrawlerSign extends CrawlerSignPlacement {
  readonly kind: CrawlerSignKind;
  /**
   * The floor to lay under a sign seated in a wall pocket, or null when it stands
   * on floor that is already there. The pocket adds no walkable tile: the sign is
   * solid, so the hallway's lane is exactly as wide as it was.
   */
  readonly pocketFloor: number | null;
}

/** A room the sign planner may reason about, and whether it may seat a sign in it. */
export interface CrawlerSignRoom extends Rect {
  readonly eligible: boolean;
}

export interface CrawlerSignInput {
  readonly grid: TileContent[][];
  /** Every room in the order the room graph indexes them. */
  readonly rooms: ReadonlyArray<CrawlerSignRoom>;
  readonly startRoom: Rect;
  /**
   * The rooms the player is required to reach, in the order they are required to
   * reach them: each gateway boss in turn, then the arena's antechamber on a floor
   * whose way onward is a forced chain. Signs exist only on the path to these;
   * everything past the last one is territory the player searches for the stairs,
   * and pointing the way there would give the search away.
   */
  readonly goalRooms: ReadonlyArray<Rect>;
  /** Keys (see `tileCoordKey`) of every tile another system has spoken for. */
  readonly claimedTiles: ReadonlySet<number>;
  /** Circles, in tiles, no wall pocket may be cut into. */
  readonly keepClear: ReadonlyArray<{ readonly centre: Point; readonly radius: number }>;
}

/**
 * Distinct rooms a room needs to reach, each down its own plain hallway, before
 * its exits can be a real choice — so three corridors that reach only two
 * neighbours never read as a three-way choice. Counted by neighbouring room,
 * not by wall opening: two of those hallways are free to leave through the same
 * wall run without the fork stopping being a fork.
 */
const MIN_JUNCTION_OPENINGS = 3;

/** Rooms a plain hallway joins; a corridor touching more is itself a junction and blurs which doorway leads where. */
const ROOMS_PER_PLAIN_HALLWAY = 2;

/** How far, in tiles, a sign's base keeps from every doorway of its room. */
const MIN_DOORWAY_CLEARANCE_TILES = 3;

/**
 * Rooms a dead-end region must touch before walking into it counts as a wrong turn
 * worth a sign. One or two rooms is a stub the player sees the end of and backs out
 * of; three or more is a region they can spend real time exploring for nothing.
 */
export const MIN_TRAP_REGION_ROOMS = 3;

/**
 * Tiles a wrong turn must cost before it is worth a sign: how much further a
 * goal-reaching branch is than the best one, or how far a loop walks before it comes
 * back round. Floors whose rooms loop into one another reach the goal down every
 * branch, and one of those branches is usually the long way back past the start: a
 * walk the player cannot tell from the right one until they recognise the rooms
 * again. A short loop is the opposite, a ring the player is round and out of before
 * it could mislead them.
 */
export const MIN_TRAP_DETOUR_TILES = 80;

const UNREACHED = Number.POSITIVE_INFINITY;

const NO_ROOM = -1;

/** Marks a tile a walk from the goal never reached. */
const UNWALKED = -1;

/** Marks a room on no forced stage: the stair-search territory, or a room the player can never reach. */
const NO_STAGE = -1;

/** Keeps distance from a run's middle the primary sort and the matching wall only a tiebreak. */
const WALL_TIE_WEIGHT = 2;

/**
 * Every tile a sign anchored at `anchor` stands on and blocks.
 *
 * The one place the sign's size is decided: seating, claiming and the
 * generator's stamping all read this, so a wider base is a change here alone.
 */
export function crawlerSignFootprint(anchor: Point): Point[] {
  return [{ x: anchor.x, y: anchor.y }];
}

function isStrictlyInside(room: Rect, x: number, y: number): boolean {
  return x > room.x && x < room.x + room.w - 1 && y > room.y && y < room.y + room.h - 1;
}

/** Room-step distance from the nearest of `sources` to every room; unreachable rooms stay infinite. */
function roomDistances(graph: RoomGraph, sources: ReadonlyArray<number>): number[] {
  const distance = graph.map(() => UNREACHED);
  const queue: number[] = [];
  for (const source of sources) {
    if (distance[source] === 0) continue;
    distance[source] = 0;
    queue.push(source);
  }
  for (const room of queue) {
    for (const next of graph[room].keys()) {
      if (distance[next] !== UNREACHED) continue;
      distance[next] = distance[room] + 1;
      queue.push(next);
    }
  }
  return distance;
}

/** The wall tile a corridor actually leaves a room through, and the side it leaves toward. */
interface Opening {
  readonly doorway: RoomDoorway;
  readonly tile: Point;
  readonly outward: (typeof ROOM_WALL_OUTWARD)[number];
}

/**
 * Where the corridor tiles in `corridor` open onto the room.
 *
 * Returns the one perimeter tile that touches the corridor, not the doorway's
 * middle: a doorway is a run of perimeter tiles, and a corridor arriving at a
 * corner is grouped with whatever else opens on the neighbouring wall, so the
 * middle of the run can sit on a different corridor altogether. Among matching
 * tiles the one nearest the run's middle wins, and a side matching the run's own
 * wall wins a tie, so ordinary doorways keep their usual seat.
 */
function openingOnto(
  doorways: ReadonlyArray<RoomDoorway>,
  corridor: ReadonlySet<number>,
): Opening | null {
  let best: Opening | null = null;
  let bestScore = UNREACHED;
  for (const doorway of doorways) {
    for (const tile of doorway.tiles) {
      for (const outward of ROOM_WALL_OUTWARD) {
        if (!corridor.has(tileCoordKey(tile.x + outward.dx, tile.y + outward.dy))) continue;
        const offMiddle = Math.abs(tile.x - doorway.tile.x) + Math.abs(tile.y - doorway.tile.y);
        const score = offMiddle * WALL_TIE_WEIGHT + (outward.wall === doorway.wall ? 0 : 1);
        if (score >= bestScore) continue;
        best = { doorway, tile, outward };
        bestScore = score;
      }
    }
  }
  return best;
}

/**
 * The bearing a sign's arrow paints: toward `target`, the first tile of the onward
 * hallway, unless that lies a quarter turn or more away from `facing` (the way the
 * sign's words point). A hallway entrance beside or behind the sign would make the
 * paint contradict the words, so the arrow is then the printed direction itself.
 */
function arrowBearing(from: Point, target: Point, facing: Point): number {
  const towardTarget = { x: target.x - from.x, y: target.y - from.y };
  const alongFacing = towardTarget.x * facing.x + towardTarget.y * facing.y;
  const aim = alongFacing > 0 ? towardTarget : facing;
  return Math.atan2(aim.y, aim.x);
}

/**
 * The interior tile nearest the onward doorway where a sign can stand, or null.
 *
 * Every footprint tile has to be interior floor, clear of every doorway and
 * unclaimed, and the sign must leave whatever borders it somewhere a creature
 * can still operate — the same test the spawner applies to a spawn tile, run
 * with the sign counted as solid. Any tile of the room qualifies rather than
 * only the straight line in from the doorway: a hub room's fixtures and its other
 * doorways routinely rule that one line out while leaving the rest of the room
 * open. Nearness to the doorway keeps the arrow short and steep, and ties fall
 * to the northernmost, then westernmost, tile so a map plans the same every time.
 */
function seatSign(
  input: CrawlerSignInput,
  room: Rect,
  opening: Opening,
  doorways: ReadonlyArray<RoomDoorway>,
  taken: ReadonlySet<number>,
): Point | null {
  const { grid } = input;
  const rows = grid.length;
  const columns = grid[0]?.length ?? 0;

  const clearOfDoorways = (tile: Point): boolean =>
    doorways.every((other) =>
      other.tiles.every(
        (edge) =>
          Math.max(Math.abs(edge.x - tile.x), Math.abs(edge.y - tile.y)) >=
          MIN_DOORWAY_CLEARANCE_TILES,
      ),
    );

  const isSeatable = (anchor: Point): boolean =>
    crawlerSignFootprint(anchor).every(
      (tile) =>
        isStrictlyInside(room, tile.x, tile.y) &&
        isWalkableTileType(grid[tile.y][tile.x]) &&
        !input.claimedTiles.has(tileCoordKey(tile.x, tile.y)) &&
        !taken.has(tileCoordKey(tile.x, tile.y)) &&
        clearOfDoorways(tile),
    );

  const candidates: Point[] = [];
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      if (isSeatable({ x, y })) candidates.push({ x, y });
    }
  }
  const squaredGap = (tile: Point): number =>
    (tile.x - opening.tile.x) ** 2 + (tile.y - opening.tile.y) ** 2;
  candidates.sort((a, b) => squaredGap(a) - squaredGap(b) || a.y - b.y || a.x - b.x);

  return (
    candidates.find((anchor) => {
      const footprint = crawlerSignFootprint(anchor);
      const footprintKeys = new Set(footprint.map((tile) => tileCoordKey(tile.x, tile.y)));
      const walkableWithSign = (x: number, y: number): boolean =>
        isWalkableTileType(grid[y][x]) && !footprintKeys.has(tileCoordKey(x, y));
      return footprint.every((tile) =>
        ROOM_WALL_OUTWARD.every((side) => {
          const x = tile.x + side.dx;
          const y = tile.y + side.dy;
          if (footprintKeys.has(tileCoordKey(x, y))) return true;
          if (!walkableWithSign(x, y)) return true;
          return hasOpenRegion(walkableWithSign, columns, rows, x, y);
        }),
      );
    }) ?? null
  );
}

/** One leg of the forced path: the rooms a player crosses on the way to one required goal. */
interface ForcedStage {
  readonly goalRoom: number;
  /** Room-steps from every room to this stage's goal; unreachable rooms stay infinite. */
  readonly distance: ReadonlyArray<number>;
}

interface ForcedPath {
  /** The stage each room belongs to, or {@link NO_STAGE} outside the forced path. */
  readonly stageOfRoom: ReadonlyArray<number>;
  readonly stages: ReadonlyArray<ForcedStage>;
}

/**
 * Splits the floor into the legs a player is forced through.
 *
 * A goal room gates everything behind it, so the rooms a player can reach from the
 * start without walking through goal `k` are the ones whose business is getting to
 * goal `k`; each room takes the earliest such goal. What no goal's near side
 * reaches is beyond the last goal, where the player is searching, and stays
 * {@link NO_STAGE}.
 */
function forcedPathOf(
  graph: RoomGraph,
  startIndex: number,
  goalRooms: ReadonlyArray<number>,
): ForcedPath {
  const stageOfRoom = graph.map(() => NO_STAGE);
  const stages: ForcedStage[] = [];
  const reachableFromStart = roomDistances(graph, [startIndex]);
  for (const goalRoom of goalRooms) {
    if (goalRoom === startIndex || reachableFromStart[goalRoom] === UNREACHED) continue;
    const nearSide = new Set<number>([startIndex, goalRoom]);
    const queue: number[] = [startIndex];
    for (const room of queue) {
      for (const next of graph[room].keys()) {
        if (nearSide.has(next)) continue;
        nearSide.add(next);
        queue.push(next);
      }
    }
    const stage = stages.length;
    for (const room of nearSide) {
      if (stageOfRoom[room] === NO_STAGE) stageOfRoom[room] = stage;
    }
    stages.push({ goalRoom, distance: roomDistances(graph, [goalRoom]) });
  }
  return { stageOfRoom, stages };
}

/** What a junction's flood needs to know about the level, apart from the junction itself. */
export interface TrapFloodInput {
  readonly columns: number;
  readonly rows: number;
  readonly walkable: (x: number, y: number) => boolean;
  /** The room index of each tile, or {@link NO_ROOM}; how a region's room count is read. */
  readonly roomAt: ReadonlyArray<ReadonlyArray<number>>;
  /** Tile keys taken out of the level: the junction tile, or every tile of a junction room. */
  readonly removed: ReadonlySet<number>;
  /** The first tile of each exit branch, one per branch. */
  readonly branchSeeds: ReadonlyArray<Point>;
  /** Tile keys of the stage's goal room. Reached but never left: beyond it is stair-search territory. */
  readonly goalTiles: ReadonlySet<number>;
  /** Tile keys of the start room. */
  readonly startTiles: ReadonlySet<number>;
}

/** How one exit branch of a junction fares once the junction itself is taken away. */
export interface BranchVerdict {
  readonly reachesGoal: boolean;
  /** Walking this way costs a loop, a large wasted region, or a long way round. */
  readonly isTrap: boolean;
  /**
   * Tiles further from the goal this branch's first tile is than the best branch's,
   * walking without crossing the junction; infinite when it cannot reach the goal.
   */
  readonly detourTiles: number;
  /**
   * Tiles from this branch's first tile round to another branch's, walking without
   * crossing the junction or entering the goal; infinite when the branch loops nowhere.
   */
  readonly loopTiles: number;
}

/**
 * Classifies every exit branch of a junction by flooding the level with the junction removed.
 *
 * Branches sharing a flood are joined by a route that bypasses the junction. The goal
 * room is terminal, so a branch reaching it is the way onward and nothing beyond it
 * can join branches back together. Of the rest:
 *
 * - Two or more branches in one region form a loop: a wrong turn walks the player
 *   round and back to the junction. This holds for the region containing the start
 *   too, where one of those branches is the way the player arrived and another leads
 *   round to the arrival side again. The loop is a trap only when it is at least
 *   {@link MIN_TRAP_DETOUR_TILES} long.
 * - A goal-reaching branch is a trap when it is at least {@link MIN_TRAP_DETOUR_TILES}
 *   further from the goal than the best branch.
 * - A region holding the start through a single branch is only the arrival itself.
 *   Turning back is not a wrong turn, so it is never a trap.
 * - A lone branch into a region without the start is a dead end. It is a trap only
 *   when it spans {@link MIN_TRAP_REGION_ROOMS} rooms; a smaller stub shows its own
 *   end from the doorway.
 */
export function classifyTrapBranches(input: TrapFloodInput): BranchVerdict[] {
  const { columns, rows, walkable, roomAt } = input;
  const inGrid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < columns && y < rows;
  const open = (x: number, y: number): boolean =>
    inGrid(x, y) && walkable(x, y) && !input.removed.has(tileCoordKey(x, y));

  interface Region {
    reachesGoal: boolean;
    hasStart: boolean;
    readonly rooms: Set<number>;
    branches: number;
  }
  const regions: Region[] = [];
  const regionOfTile = new Map<number, Region>();

  const floodFrom = (seed: Point): Region => {
    const region: Region = {
      reachesGoal: false,
      hasStart: false,
      rooms: new Set<number>(),
      branches: 0,
    };
    regions.push(region);
    const visit = (tile: Point, queue: Point[]): void => {
      const key = tileCoordKey(tile.x, tile.y);
      if (regionOfTile.get(key) === region) return;
      if (input.goalTiles.has(key)) {
        region.reachesGoal = true;
        return;
      }
      regionOfTile.set(key, region);
      if (input.startTiles.has(key)) region.hasStart = true;
      const room = roomAt[tile.y]?.[tile.x] ?? NO_ROOM;
      if (room !== NO_ROOM) region.rooms.add(room);
      queue.push(tile);
    };
    const queue: Point[] = [];
    visit(seed, queue);
    for (const tile of queue) {
      for (const step of ROOM_WALL_OUTWARD) {
        const x = tile.x + step.dx;
        const y = tile.y + step.dy;
        if (open(x, y)) visit({ x, y }, queue);
      }
    }
    return region;
  };

  const goalDistance = new Map<number, number>();
  const goalQueue: Point[] = [];
  for (const key of input.goalTiles) {
    const tile = { x: tileKeyX(key), y: tileKeyY(key) };
    if (!open(tile.x, tile.y)) continue;
    goalDistance.set(key, 0);
    goalQueue.push(tile);
  }
  for (const tile of goalQueue) {
    const here = goalDistance.get(tileCoordKey(tile.x, tile.y)) ?? 0;
    for (const step of ROOM_WALL_OUTWARD) {
      const x = tile.x + step.dx;
      const y = tile.y + step.dy;
      if (!open(x, y) || goalDistance.has(tileCoordKey(x, y))) continue;
      goalDistance.set(tileCoordKey(x, y), here + 1);
      goalQueue.push({ x, y });
    }
  }
  const seedDistance = input.branchSeeds.map(
    (seed) => goalDistance.get(tileCoordKey(seed.x, seed.y)) ?? UNREACHED,
  );
  const bestDistance = Math.min(UNREACHED, ...seedDistance);

  const regionOfSeed = input.branchSeeds.map((seed) => {
    if (!open(seed.x, seed.y)) return null;
    const existing = regionOfTile.get(tileCoordKey(seed.x, seed.y));
    const region = existing ?? floodFrom(seed);
    region.branches++;
    return region;
  });

  const seedKeys = input.branchSeeds.map((seed) => tileCoordKey(seed.x, seed.y));
  const loopLength = (index: number): number => {
    const seed = input.branchSeeds[index];
    const steps = new Map<number, number>([[seedKeys[index], 0]]);
    const queue: Point[] = [seed];
    for (const tile of queue) {
      const here = steps.get(tileCoordKey(tile.x, tile.y)) ?? 0;
      for (const step of ROOM_WALL_OUTWARD) {
        const x = tile.x + step.dx;
        const y = tile.y + step.dy;
        const key = tileCoordKey(x, y);
        if (!open(x, y) || input.goalTiles.has(key) || steps.has(key)) continue;
        if (seedKeys.some((other, otherIndex) => otherIndex !== index && other === key)) {
          return here + 1;
        }
        steps.set(key, here + 1);
        queue.push({ x, y });
      }
    }
    return UNREACHED;
  };

  return regionOfSeed.map((region, index) => {
    const detourTiles = seedDistance[index] - bestDistance;
    if (region === null) {
      return { reachesGoal: false, isTrap: false, detourTiles, loopTiles: UNREACHED };
    }
    if (region.reachesGoal) {
      const isTrap = detourTiles >= MIN_TRAP_DETOUR_TILES;
      return { reachesGoal: true, isTrap, detourTiles, loopTiles: UNREACHED };
    }
    const loopTiles = region.branches >= 2 ? loopLength(index) : UNREACHED;
    const isLongLoop = loopTiles !== UNREACHED && loopTiles >= MIN_TRAP_DETOUR_TILES;
    const isBigDeadEnd = !region.hasStart && region.rooms.size >= MIN_TRAP_REGION_ROOMS;
    return { reachesGoal: false, isTrap: isLongLoop || isBigDeadEnd, detourTiles, loopTiles };
  });
}

function tileAt(grid: TileContent[][], x: number, y: number): TileContent | undefined {
  const insideGrid = y >= 0 && y < grid.length && x >= 0 && x < (grid[y]?.length ?? 0);
  return insideGrid ? grid[y][x] : undefined;
}

/** Tile keys of every walkable tile of `room`. */
function walkableTileKeys(input: CrawlerSignInput, room: Rect): Set<number> {
  const keys = new Set<number>();
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const tile = tileAt(input.grid, x, y);
      if (tile !== undefined && isWalkableTileType(tile)) keys.add(tileCoordKey(x, y));
    }
  }
  return keys;
}

/**
 * Picks the junction rooms and hallway junctions that get a sign, and where each stands.
 *
 * A room qualifies when it reaches at least {@link MIN_JUNCTION_OPENINGS} distinct
 * rooms, each down a plain hallway that joins only two rooms, it lies on the
 * forced path, and exactly one neighbour is strictly nearer that leg's goal. Two
 * of those hallways are free to leave through the same wall run — a wide
 * doorway that happens to carry two corridors is still two distinct ways out,
 * so counting rooms rather than physical wall openings is what keeps a fork
 * from reading as a plain corridor merely because its mouth is shared — and a
 * second corridor to the same neighbour does not disqualify the room either;
 * the sign names the shorter one. It is signed only if a wrong turn costs
 * something: with the room taken out of the level (see
 * {@link classifyTrapBranches}), some branch must lead round a loop or into a
 * dead-end region of at least {@link MIN_TRAP_REGION_ROOMS} rooms. A junction
 * whose only wrong answers are short stubs — a single dead-end safe-access
 * pocket among them — is left bare, because a sign there points the player
 * away from something they would see the end of anyway (and away from a
 * respawn point, which is never actually a wrong answer). Pure: the grid is
 * read, never written.
 */
export function planCrawlerSigns(input: CrawlerSignInput): PlannedCrawlerSign[] {
  const { grid, rooms } = input;
  const bounds: Rect[] = rooms.map(({ x, y, w, h }) => ({ x, y, w, h }));
  const graph = buildRoomGraph(grid, bounds);

  const sameRect = (a: Rect, b: Rect): boolean =>
    a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  const startIndex = bounds.findIndex((room) => sameRect(room, input.startRoom));
  const goalIndices = input.goalRooms.flatMap((goal) => {
    const index = bounds.findIndex((room) => sameRect(room, goal));
    return index === -1 ? [] : [index];
  });
  if (startIndex === -1 || goalIndices.length === 0) return [];
  const forced = forcedPathOf(graph, startIndex, goalIndices);
  if (forced.stages.length === 0) return [];

  const roomAt = roomIndexGrid(grid, bounds);
  const startTiles = walkableTileKeys(input, input.startRoom);
  const goalTilesOfStage = forced.stages.map(({ goalRoom }) =>
    walkableTileKeys(input, bounds[goalRoom]),
  );
  const floodInput = {
    columns: grid[0]?.length ?? 0,
    rows: grid.length,
    walkable: (x: number, y: number): boolean => {
      const tile = tileAt(grid, x, y);
      return tile !== undefined && isWalkableTileType(tile);
    },
    roomAt,
    startTiles,
  };

  const hallways = corridorComponents(grid, bounds);
  const hallwaysAt = bounds.map((): number[] => []);
  for (const [index, hallway] of hallways.entries()) {
    for (const room of hallway.rooms) hallwaysAt[room].push(index);
  }
  const hasOnlyPlainHallways = (room: number): boolean =>
    hallwaysAt[room].every((index) => hallways[index].rooms.length === ROOMS_PER_PLAIN_HALLWAY);

  const junctions: Array<{ room: number; opening: Opening }> = [];
  for (const [room, neighbours] of graph.entries()) {
    if (!rooms[room].eligible) continue;
    const stage = forced.stageOfRoom[room];
    if (stage === NO_STAGE) continue;
    const toGoal = forced.stages[stage].distance;
    if (neighbours.size < MIN_JUNCTION_OPENINGS) continue;
    if (!hasOnlyPlainHallways(room)) continue;
    const closer = [...neighbours.keys()].filter((neighbour) => toGoal[neighbour] < toGoal[room]);
    const hasWrongAnswer = neighbours.size > closer.length;
    if (closer.length !== 1 || !hasWrongAnswer) continue;

    const roomTiles = walkableTileKeys(input, bounds[room]);
    const branchHallways = hallwaysAt[room];
    const branchSeeds = branchHallways.flatMap((index) => {
      const seed = hallways[index].tiles.find((tile) =>
        ROOM_WALL_OUTWARD.some((side) =>
          roomTiles.has(tileCoordKey(tile.x + side.dx, tile.y + side.dy)),
        ),
      );
      return seed === undefined ? [] : [seed];
    });
    if (branchSeeds.length !== branchHallways.length) continue;
    const verdicts = classifyTrapBranches({
      ...floodInput,
      removed: roomTiles,
      branchSeeds,
      goalTiles: goalTilesOfStage[stage],
    });
    if (!verdicts.some((verdict) => verdict.isTrap)) continue;

    // Two corridors can join the same pair of rooms. Both lead onward, so the sign
    // may name either, but only the shorter is chosen and only when it is clearly
    // the shorter: two equal corridors on different walls would leave the arrow
    // pointing at one of two equally good doorways.
    const onwardOpenings = branchHallways
      .flatMap((hallwayIndex, branch) => {
        const hallway = hallways[hallwayIndex];
        if (!hallway.rooms.includes(closer[0]) || !verdicts[branch].reachesGoal) return [];
        const tiles = new Set(hallway.tiles.map((tile) => tileCoordKey(tile.x, tile.y)));
        const opening = openingOnto(roomDoorways(grid, bounds[room]), tiles);
        return opening === null ? [] : [{ opening, length: hallway.tiles.length }];
      })
      .sort(
        (a, b) =>
          a.length - b.length ||
          a.opening.tile.y - b.opening.tile.y ||
          a.opening.tile.x - b.opening.tile.x,
      );
    if (onwardOpenings.length === 0) continue;
    const best = onwardOpenings[0];
    const hasRunnerUp = onwardOpenings.length > 1;
    const runnerUp = onwardOpenings[1];
    const isAmbiguous =
      hasRunnerUp &&
      runnerUp.length === best.length &&
      runnerUp.opening.outward.wall !== best.opening.outward.wall;
    if (isAmbiguous) continue;
    junctions.push({ room, opening: best.opening });
  }
  junctions.sort((a, b) => a.room - b.room);

  const placements: PlannedCrawlerSign[] = [];
  const taken = new Set<number>();
  for (const { room, opening } of junctions) {
    const doorways = roomDoorways(grid, bounds[room]);

    const anchor = seatSign(input, bounds[room], opening, doorways, taken);
    if (anchor === null) continue;

    const direction = DIRECTION_OF_SIDE[opening.outward.wall];
    const hallwayEntrance = {
      x: opening.tile.x + opening.outward.dx,
      y: opening.tile.y + opening.outward.dy,
    };
    const facing = { x: opening.outward.dx, y: opening.outward.dy };
    const arrowAngleRadians = arrowBearing(anchor, hallwayEntrance, facing);
    placements.push({
      kind: 'room',
      pocketFloor: null,
      tile: anchor,
      direction,
      arrowAngleRadians,
    });
    for (const tile of crawlerSignFootprint(anchor)) {
      taken.add(tileCoordKey(tile.x, tile.y));
    }
  }
  placements.push(...planHallwaySigns(input, bounds, forced, floodInput, goalTilesOfStage));
  return placements;
}

const DIAGONAL_OFFSETS: ReadonlyArray<Point> = [
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

const DIRECTION_OF_SIDE: Readonly<
  Record<(typeof ROOM_WALL_OUTWARD)[number]['wall'], CrawlerSignDirection>
> = {
  north: 'North',
  south: 'South',
  west: 'West',
  east: 'East',
};

function roomIndexGrid(grid: TileContent[][], rooms: ReadonlyArray<Rect>): number[][] {
  const roomAt = grid.map((row) => row.map(() => NO_ROOM));
  for (const [index, room] of rooms.entries()) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const insideGrid = y >= 0 && y < roomAt.length && x >= 0 && x < roomAt[y].length;
        if (insideGrid) roomAt[y][x] = index;
      }
    }
  }
  return roomAt;
}

/** One way out of a hallway fork and what lies down it. */
interface RankedBranch {
  readonly branch: ForkBranch;
  readonly rooms: ReadonlySet<number>;
  /** Fewest room-steps to the leg's goal from any room this branch reaches. */
  readonly hops: number;
  /** Fewest tiles a walker takes from the branch's mouth to the goal room. */
  readonly walk: number;
}

const EIGHT_NEIGHBOURS: ReadonlyArray<Point> = [
  ...ROOM_WALL_OUTWARD.map((side) => ({ x: side.dx, y: side.dy })),
  ...DIAGONAL_OFFSETS,
];

/**
 * Signs for hallway forks (see {@link findHallwayForks}): places on the forced path
 * where the corridors split three or more ways, however wide, and a wrong turn
 * costs a loop or a large wasted region.
 *
 * Whether a branch is such a trap is decided by {@link classifyTrapBranches} with
 * the fork's tiles removed; a fork whose wrong branches are all short stubs, or
 * that has none, is left bare.
 *
 * The sign goes in a wall pocket touching the fork rather than on its floor, so no
 * branch is ever narrowed; a pocket beside the fork's side walls is preferred to
 * one at its corner. The arrow points down the goal-reaching branch that has the
 * fewest room-steps to the leg's goal; branches that meet again further on tie on
 * that measure and the shorter walk decides. The words name a side of the fork, so
 * the side must be one no other branch also leaves by. A pocket beside a second
 * fork would leave its arrow ambiguous, so each fork takes a pocket touching only
 * itself.
 */
function planHallwaySigns(
  input: CrawlerSignInput,
  bounds: ReadonlyArray<Rect>,
  forced: ForcedPath,
  floodInput: Omit<TrapFloodInput, 'removed' | 'branchSeeds' | 'goalTiles'>,
  goalTilesOfStage: ReadonlyArray<ReadonlySet<number>>,
): PlannedCrawlerSign[] {
  const { grid } = input;
  const { roomAt } = floodInput;
  const rows = grid.length;
  const columns = grid[0]?.length ?? 0;

  const inGrid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < columns && y < rows;
  const walkable = (x: number, y: number): boolean =>
    inGrid(x, y) && isWalkableTileType(grid[y][x]);
  const inRoom = (x: number, y: number): boolean => inGrid(x, y) && roomAt[y][x] !== NO_ROOM;
  const claimed = (x: number, y: number): boolean => input.claimedTiles.has(tileCoordKey(x, y));

  const walkFromGoal = new Map<number, Int32Array>();
  const walkDistances = (stage: number): Int32Array => {
    const cached = walkFromGoal.get(stage);
    if (cached !== undefined) return cached;
    const distance = new Int32Array(rows * columns).fill(UNWALKED);
    const goal = bounds[forced.stages[stage].goalRoom];
    const queue: Point[] = [];
    for (let y = goal.y; y < goal.y + goal.h; y++) {
      for (let x = goal.x; x < goal.x + goal.w; x++) {
        if (!walkable(x, y)) continue;
        distance[y * columns + x] = 0;
        queue.push({ x, y });
      }
    }
    for (const tile of queue) {
      const here = distance[tile.y * columns + tile.x];
      for (const step of ROOM_WALL_OUTWARD) {
        const x = tile.x + step.dx;
        const y = tile.y + step.dy;
        if (!walkable(x, y) || distance[y * columns + x] !== UNWALKED) continue;
        distance[y * columns + x] = here + 1;
        queue.push({ x, y });
      }
    }
    walkFromGoal.set(stage, distance);
    return distance;
  };

  /** Rooms a branch reaches by corridor alone, a mouth that opens straight into a room included. */
  const roomsDownBranch = (forkKeys: ReadonlySet<number>, branch: ForkBranch): Set<number> => {
    const rooms = new Set<number>();
    const seen = new Set<number>(forkKeys);
    const queue: Point[] = [];
    for (const tile of branch.mouth) {
      if (inRoom(tile.x, tile.y)) {
        rooms.add(roomAt[tile.y][tile.x]);
        continue;
      }
      seen.add(tileCoordKey(tile.x, tile.y));
      queue.push(tile);
    }
    for (const tile of queue) {
      for (const step of ROOM_WALL_OUTWARD) {
        const x = tile.x + step.dx;
        const y = tile.y + step.dy;
        if (!walkable(x, y)) continue;
        if (inRoom(x, y)) {
          rooms.add(roomAt[y][x]);
          continue;
        }
        const key = tileCoordKey(x, y);
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ x, y });
      }
    }
    return rooms;
  };

  const isPlainWall = (x: number, y: number): boolean =>
    inGrid(x, y) && grid[y][x].type === FloorTypeValue.wall && !claimed(x, y);

  const pocketFits = (pocket: Point): boolean => {
    if (!isPlainWall(pocket.x, pocket.y)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!inGrid(pocket.x + dx, pocket.y + dy)) return false;
        if (inRoom(pocket.x + dx, pocket.y + dy)) return false;
      }
    }
    return input.keepClear.every(
      ({ centre, radius }) => Math.hypot(pocket.x - centre.x, pocket.y - centre.y) > radius,
    );
  };

  const forks = findHallwayForks({ columns, rows, walkable, inRoom });
  const forkOfTile = new Map<number, number>();
  for (const [index, fork] of forks.entries()) {
    for (const tile of fork.tiles) forkOfTile.set(tileCoordKey(tile.x, tile.y), index);
  }
  const forksBeside = (pocket: Point): Set<number> => {
    const beside = new Set<number>();
    for (const offset of EIGHT_NEIGHBOURS) {
      const fork = forkOfTile.get(tileCoordKey(pocket.x + offset.x, pocket.y + offset.y));
      if (fork !== undefined) beside.add(fork);
    }
    return beside;
  };

  /** Wall tiles touching the fork: those beside its sides first, then its corners, each in scan order. */
  const pocketCandidates = (forkKeys: ReadonlySet<number>): Point[] => {
    const touching = (offsets: ReadonlyArray<Point>): number[] => {
      const found = new Set<number>();
      for (const key of forkKeys) {
        for (const offset of offsets) {
          const x = tileKeyX(key) + offset.x;
          const y = tileKeyY(key) + offset.y;
          if (!forkKeys.has(tileCoordKey(x, y))) found.add(tileCoordKey(x, y));
        }
      }
      return [...found].sort((a, b) => a - b);
    };
    const besideSides = touching(ROOM_WALL_OUTWARD.map((side) => ({ x: side.dx, y: side.dy })));
    const atCorners = touching(DIAGONAL_OFFSETS).filter((key) => !besideSides.includes(key));
    return [...besideSides, ...atCorners].map((key) => ({ x: tileKeyX(key), y: tileKeyY(key) }));
  };

  const placements: PlannedCrawlerSign[] = [];
  const takenPockets = new Set<number>();
  for (const [forkIndex, fork] of forks.entries()) {
    const forkKeys = new Set(fork.tiles.map((tile) => tileCoordKey(tile.x, tile.y)));
    const reached = fork.branches.map((branch) => roomsDownBranch(forkKeys, branch));
    const stagesReached = new Set<number>();
    for (const rooms of reached) {
      for (const room of rooms) stagesReached.add(forced.stageOfRoom[room]);
    }
    // A fork with a room of the stair search down one branch, or one that lies
    // between two legs, has no single goal its arrow could honestly name.
    if (stagesReached.size !== 1) continue;
    const [stage] = stagesReached;
    if (stage === NO_STAGE) continue;

    const toGoal = forced.stages[stage].distance;
    const walkDistance = walkDistances(stage);
    const branches: RankedBranch[] = fork.branches.map((branch, index) => {
      const walked = branch.mouth
        .map((tile) => walkDistance[tile.y * columns + tile.x])
        .filter((distance) => distance !== UNWALKED);
      return {
        branch,
        rooms: reached[index],
        hops: Math.min(UNREACHED, ...[...reached[index]].map((room) => toGoal[room])),
        walk: Math.min(UNREACHED, ...walked),
      };
    });
    const verdicts = classifyTrapBranches({
      ...floodInput,
      removed: forkKeys,
      branchSeeds: branches.map(({ branch }) => branch.mouth[0]),
      goalTiles: goalTilesOfStage[stage],
    });
    if (!verdicts.some((verdict) => verdict.isTrap)) continue;
    const ranked = branches
      .filter((_, index) => verdicts[index].reachesGoal && !verdicts[index].isTrap)
      .sort((a, b) => a.hops - b.hops || a.walk - b.walk);
    const best = ranked.length > 0 ? ranked[0] : undefined;
    if (best === undefined || best.hops === UNREACHED) continue;
    const tiedForBest = ranked.filter(
      (candidate) => candidate.hops === best.hops && candidate.walk === best.walk,
    );
    const exclusiveSideOf = (candidate: RankedBranch): ForkSide | undefined =>
      candidate.branch.sides.find((side) =>
        branches.every((other) => other === candidate || !other.branch.sides.includes(side)),
      );
    const onward = tiedForBest
      .map((candidate) => ({ candidate, side: exclusiveSideOf(candidate) }))
      .find((choice) => choice.side !== undefined);
    if (onward?.side === undefined) continue;
    const onwardSide = onward.side;

    const pocket = pocketCandidates(forkKeys).find((candidate) => {
      if (takenPockets.has(tileCoordKey(candidate.x, candidate.y))) return false;
      if (!pocketFits(candidate)) return false;
      const beside = forksBeside(candidate);
      return beside.size === 1 && beside.has(forkIndex);
    });
    if (pocket === undefined) continue;
    const floorUnderPocket = EIGHT_NEIGHBOURS.map((offset) => ({
      x: pocket.x + offset.x,
      y: pocket.y + offset.y,
    })).find((tile) => forkKeys.has(tileCoordKey(tile.x, tile.y)));
    if (floorUnderPocket === undefined) continue;

    const entrances = mouthOnSide(fork, onward.candidate.branch, onwardSide);
    const branchEntrance = entrances[Math.floor(entrances.length / 2)];
    placements.push({
      kind: 'hallway',
      pocketFloor: grid[floorUnderPocket.y][floorUnderPocket.x].type,
      tile: pocket,
      direction: DIRECTION_OF_SIDE[onwardSide.wall],
      arrowAngleRadians: arrowBearing(pocket, branchEntrance, {
        x: onwardSide.dx,
        y: onwardSide.dy,
      }),
    });
    takenPockets.add(tileCoordKey(pocket.x, pocket.y));
  }
  return placements;
}
