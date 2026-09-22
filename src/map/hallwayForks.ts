import { ROOM_WALL_OUTWARD, type Point } from './roomDoorways';
import { tileCoordKey, tileKeyX, tileKeyY } from './tileIndex';

/** One of the four ways out of a tile, as `ROOM_WALL_OUTWARD` names them. */
export type ForkSide = (typeof ROOM_WALL_OUTWARD)[number];

/**
 * Widest corridor the generator carves, in tiles. A fork is found by removing a
 * square block of corridor as wide as the corridor it sits in, so blocks up to
 * this size are tried.
 */
export const MAX_FORK_BLOCK_TILES = 3;

/**
 * How far, in tiles, around a fork its ways out may join up again and still count
 * as one way out. A wide corridor's side lanes, a doorway's whole room, or two
 * arms that rejoin a few steps on are one choice, not several.
 */
export const FORK_MERGE_WINDOW_TILES = 3;

/** Ways out a place needs before the way onward is a real choice. */
const MIN_FORK_BRANCHES = 3;

/** One way out of a fork: the walkable tiles beside it that lead the same way. */
export interface ForkBranch {
  /** Walkable tiles orthogonally beside the fork, all joined without crossing it. */
  readonly mouth: ReadonlyArray<Point>;
  /** Every side of the fork some tile of the mouth lies on, most tiles first. */
  readonly sides: ReadonlyArray<ForkSide>;
}

/** A place in the corridors where the way splits three or more ways, whatever the corridor's width. */
export interface HallwayFork {
  /** The corridor tiles the choice is made on; taken out, the branches separate. */
  readonly tiles: ReadonlyArray<Point>;
  readonly branches: ReadonlyArray<ForkBranch>;
}

export interface HallwayForkInput {
  readonly columns: number;
  readonly rows: number;
  readonly walkable: (x: number, y: number) => boolean;
  readonly inRoom: (x: number, y: number) => boolean;
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Groups `mouth` into the ways out they are: two tiles are one way when a walk
 * joins them inside `window` without stepping on `removed`.
 */
function groupMouth(
  input: HallwayForkInput,
  mouth: ReadonlyArray<Point>,
  removed: ReadonlySet<number>,
  window: Bounds,
): Point[][] {
  const inWindow = (x: number, y: number): boolean =>
    x >= window.minX && x <= window.maxX && y >= window.minY && y <= window.maxY;
  const open = (x: number, y: number): boolean =>
    inWindow(x, y) && input.walkable(x, y) && !removed.has(tileCoordKey(x, y));
  const groupOf = new Map<number, number>();
  const groups: Point[][] = [];
  const mouthKeys = new Set(mouth.map((tile) => tileCoordKey(tile.x, tile.y)));
  for (const seed of mouth) {
    if (groupOf.has(tileCoordKey(seed.x, seed.y))) continue;
    const group = groups.length;
    const members: Point[] = [];
    groups.push(members);
    const seen = new Set<number>([tileCoordKey(seed.x, seed.y)]);
    const queue: Point[] = [seed];
    for (const tile of queue) {
      const key = tileCoordKey(tile.x, tile.y);
      if (mouthKeys.has(key) && !groupOf.has(key)) {
        groupOf.set(key, group);
        members.push(tile);
      }
      for (const step of ROOM_WALL_OUTWARD) {
        const x = tile.x + step.dx;
        const y = tile.y + step.dy;
        if (!open(x, y) || seen.has(tileCoordKey(x, y))) continue;
        seen.add(tileCoordKey(x, y));
        queue.push({ x, y });
      }
    }
  }
  return groups;
}

/** Walkable tiles orthogonally beside `tiles` and not among them, in scan order. */
function mouthOf(input: HallwayForkInput, tiles: ReadonlySet<number>): Point[] {
  const mouth = new Set<number>();
  for (const key of tiles) {
    for (const step of ROOM_WALL_OUTWARD) {
      const x = tileKeyX(key) + step.dx;
      const y = tileKeyY(key) + step.dy;
      const neighbour = tileCoordKey(x, y);
      if (tiles.has(neighbour) || !input.walkable(x, y)) continue;
      mouth.add(neighbour);
    }
  }
  return [...mouth].sort((a, b) => a - b).map((key) => ({ x: tileKeyX(key), y: tileKeyY(key) }));
}

function boundsOf(tiles: ReadonlySet<number>, margin: number): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const key of tiles) {
    minX = Math.min(minX, tileKeyX(key));
    minY = Math.min(minY, tileKeyY(key));
    maxX = Math.max(maxX, tileKeyX(key));
    maxY = Math.max(maxY, tileKeyY(key));
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

/**
 * Walkable runs around the ring bordering a `size`-wide block at (`x`, `y`) that
 * reach the block itself. A cheap lower bound on the block's ways out: two runs
 * may still join further off, but runs that are one along the ring are one way.
 */
function ringRuns(input: HallwayForkInput, x: number, y: number, size: number): number {
  const ring: Array<{ open: boolean; touchesBlock: boolean }> = [];
  const push = (tx: number, ty: number, isCorner: boolean): void => {
    ring.push({ open: input.walkable(tx, ty), touchesBlock: !isCorner });
  };
  for (let dx = -1; dx <= size; dx++) push(x + dx, y - 1, dx === -1 || dx === size);
  for (let dy = 0; dy <= size; dy++) push(x + size, y + dy, dy === size);
  for (let dx = size - 1; dx >= -1; dx--) push(x + dx, y + size, dx === -1);
  for (let dy = size - 1; dy >= 0; dy--) push(x - 1, y + dy, false);

  const firstClosed = ring.findIndex((cell) => !cell.open);
  if (firstClosed === -1) return 1;
  let runs = 0;
  let runTouches = false;
  for (let step = 1; step <= ring.length; step++) {
    const cell = ring[(firstClosed + step) % ring.length];
    if (cell.open) {
      runTouches ||= cell.touchesBlock;
      continue;
    }
    if (runTouches) runs++;
    runTouches = false;
  }
  return runs;
}

/**
 * Every place the corridors split three or more ways.
 *
 * A one-tile hallway forks at a single tile with three open sides, but a three-wide
 * artery forks across a whole block of floor, and a corridor that splits right
 * outside a doorway forks against the room. So a fork is a square block of corridor
 * (one to {@link MAX_FORK_BLOCK_TILES} wide) whose removal leaves at least three
 * ways out that do not rejoin within {@link FORK_MERGE_WINDOW_TILES}; a room beside
 * the block is simply one of those ways. Overlapping or touching blocks are one fork,
 * and only ways out that reach a room count (see {@link leadsToRoom}).
 */
export function findHallwayForks(input: HallwayForkInput): HallwayFork[] {
  const isCorridor = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < input.columns &&
    y < input.rows &&
    input.walkable(x, y) &&
    !input.inRoom(x, y);
  const isCorridorBlock = (x: number, y: number, size: number): boolean => {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (!isCorridor(x + dx, y + dy)) return false;
      }
    }
    return true;
  };

  const forkTiles = new Set<number>();
  for (let size = 1; size <= MAX_FORK_BLOCK_TILES; size++) {
    for (let y = 1; y + size < input.rows; y++) {
      for (let x = 1; x + size < input.columns; x++) {
        if (!isCorridorBlock(x, y, size)) continue;
        if (ringRuns(input, x, y, size) < MIN_FORK_BRANCHES) continue;
        const block = new Set<number>();
        for (let dy = 0; dy < size; dy++) {
          for (let dx = 0; dx < size; dx++) block.add(tileCoordKey(x + dx, y + dy));
        }
        const branches = groupMouth(
          input,
          mouthOf(input, block),
          block,
          boundsOf(block, FORK_MERGE_WINDOW_TILES),
        );
        if (branches.length < MIN_FORK_BRANCHES) continue;
        for (const key of block) forkTiles.add(key);
      }
    }
  }

  const forks: HallwayFork[] = [];
  const assigned = new Set<number>();
  for (const start of [...forkTiles].sort((a, b) => a - b)) {
    if (assigned.has(start)) continue;
    assigned.add(start);
    const component = new Set<number>([start]);
    const queue = [start];
    for (const key of queue) {
      for (const step of ROOM_WALL_OUTWARD) {
        const next = tileCoordKey(tileKeyX(key) + step.dx, tileKeyY(key) + step.dy);
        if (!forkTiles.has(next) || assigned.has(next)) continue;
        assigned.add(next);
        component.add(next);
        queue.push(next);
      }
    }
    const groups = groupMouth(
      input,
      mouthOf(input, component),
      component,
      boundsOf(component, FORK_MERGE_WINDOW_TILES),
    ).filter((mouth) => leadsToRoom(input, mouth, component));
    if (groups.length < MIN_FORK_BRANCHES) continue;
    forks.push({
      tiles: [...component]
        .sort((a, b) => a - b)
        .map((key) => ({ x: tileKeyX(key), y: tileKeyY(key) })),
      branches: groups.map((mouth) => ({ mouth, sides: sidesOf(mouth, component) })),
    });
  }
  return forks;
}

/**
 * Whether walking out through `mouth`, never back across `fork`, reaches any room.
 *
 * Open floor wider than the widest block leaves part of itself on one side of a
 * block tucked into its corner, and that part reads as a way out though it is only
 * the rest of the same floor; a dead-end stub reads the same. Neither leads anywhere,
 * so neither is a choice.
 */
function leadsToRoom(
  input: HallwayForkInput,
  mouth: ReadonlyArray<Point>,
  fork: ReadonlySet<number>,
): boolean {
  const seen = new Set<number>(fork);
  const queue: Point[] = [];
  for (const tile of mouth) {
    seen.add(tileCoordKey(tile.x, tile.y));
    queue.push(tile);
  }
  for (const tile of queue) {
    if (input.inRoom(tile.x, tile.y)) return true;
    for (const step of ROOM_WALL_OUTWARD) {
      const x = tile.x + step.dx;
      const y = tile.y + step.dy;
      const key = tileCoordKey(x, y);
      if (seen.has(key) || !input.walkable(x, y)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return false;
}

/** The sides of `fork` the tiles of `mouth` lie on, most tiles first, ties in `ROOM_WALL_OUTWARD` order. */
function sidesOf(mouth: ReadonlyArray<Point>, fork: ReadonlySet<number>): ForkSide[] {
  const counts = ROOM_WALL_OUTWARD.map((side) => ({
    side,
    count: mouth.filter((tile) => fork.has(tileCoordKey(tile.x - side.dx, tile.y - side.dy)))
      .length,
  }));
  return counts
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count)
    .map(({ side }) => side);
}

/**
 * The mouth tiles of `branch` that lie on `side` of `fork`: where a walker leaving
 * that way steps first.
 */
export function mouthOnSide(
  fork: HallwayFork,
  branch: ForkBranch,
  side: ForkSide,
): ReadonlyArray<Point> {
  const forkKeys = new Set(fork.tiles.map((tile) => tileCoordKey(tile.x, tile.y)));
  return branch.mouth.filter((tile) =>
    forkKeys.has(tileCoordKey(tile.x - side.dx, tile.y - side.dy)),
  );
}
