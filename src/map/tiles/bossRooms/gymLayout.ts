/**
 * Where everything in the Juicer's gym goes: floor zones, equipment, the mirror
 * and the whiteboard. A pure function of the room's bounds and doorways, so the
 * chunk painter, the room system and the gates all read one answer.
 *
 * Collidable props come from one template authored in the doorway frame (see
 * `rotateTemplate`) and keyed to the widest doorway's side. No seed reaches it.
 * Anything that would land in a doorway's approach lane or the boss's spawn
 * disc is dropped, because a secondary doorway can break through any wall.
 */

import type { TileContent } from '../../tileTypes';
import { JUICER_BOSS_ROOM_FLOOR } from '../../tileTypes';
import { roomDoorways } from '../../roomDoorways';
import {
  approachLaneTiles,
  rotateTemplate,
  spawnClearTiles,
  type BossRoomDoorway,
  type DoorSide,
  type TemplateOffset,
  type TilePoint,
  type TileRect,
} from '../../../systems/bossRooms/bossRoomLayout';

/** A unit step in tiles. */
export interface TileStep {
  readonly dx: number;
  readonly dy: number;
}

/** One treadmill: a belt two tiles long running away from the mirror wall. */
export interface GymTreadmill {
  /** Belt tiles, the wall end first. */
  readonly belt: readonly [TilePoint, TilePoint];
  /** The way the belt carries whatever stands on it: out from the wall, into the room. */
  readonly push: TileStep;
  /** The tile the console stands on: the belt's wall end. */
  readonly console: TilePoint;
}

/** A run of wall tiles dressed as one piece, in order along the wall. */
export interface GymWallRun {
  readonly tiles: readonly TilePoint[];
  /** True when the wall runs along y (a side wall seen from above). */
  readonly alongY: boolean;
}

export interface GymLayout {
  readonly bounds: TileRect;
  readonly side: DoorSide;
  /** One step from the doorway wall into the room. */
  readonly inward: TileStep;
  /** Where the Juicer stands when the fight begins; the platform is centred on it. */
  readonly spawn: TilePoint;
  readonly platform: TileRect;
  /** The sprint lane's tiles, belts excluded. */
  readonly turf: readonly TilePoint[];
  /** Which way the turf's yard lines run across the lane. */
  readonly turfLinesAlongX: boolean;
  readonly racks: readonly TilePoint[];
  readonly squatRacks: readonly TilePoint[];
  readonly cableStacks: readonly TilePoint[];
  readonly treadmills: readonly GymTreadmill[];
  readonly benches: readonly TilePoint[];
  readonly boombox: TilePoint | null;
  /** The wall opposite the doorway, silvered. */
  readonly mirror: GymWallRun;
  readonly whiteboard: GymWallRun | null;
  readonly doorways: readonly BossRoomDoorway[];
}

/** The platform's side in tiles; it spans two tiles either side of the spawn's corner. */
const PLATFORM_TILES = 4;
const PLATFORM_HALF = PLATFORM_TILES / 2;
/** Depth of the sprint lane along the mirror wall, in tiles. */
const TURF_DEPTH_TILES = 2;
/** A treadmill's belt, in tiles along its run. */
const BELT_TILES = 2;
/** The treadmill row: how many, the step between them, and how far in from the right-hand corner. */
const TREADMILL_COUNT = 3;
const TREADMILL_PITCH_TILES = 2;
const TREADMILL_CORNER_GAP_TILES = 2;
/** Turf stops this short of the first treadmill, so the lane and the row read as two things. */
const TURF_TREADMILL_GAP_TILES = 1;
/**
 * Side-wall equipment, as tiles from the dumbbell rack along its wall: squat
 * rack next to it, cable stack next to that. One unbroken run, because a gap
 * between two pieces is a pocket a crawler can pin him in.
 */
const SQUAT_RACK_STEP = 1;
const CABLE_STACK_STEPS = 2;
/** Benches stand two tiles off the side walls, three tiles either side of the middle. */
const BENCH_WALL_GAP_TILES = 2;
const BENCH_DEPTH_OFFSET = 5;
/** The boombox sits on the left wall this far in from the doorway wall. */
const BOOMBOX_DEPTH = 2;
/** The whiteboard is this many tiles long, starting this far from the corner. */
const WHITEBOARD_TILES = 4;
const WHITEBOARD_CORNER_GAP = 2;

function inwardOf(side: DoorSide): TileStep {
  switch (side) {
    case 'south':
      return { dx: 0, dy: -1 };
    case 'north':
      return { dx: 0, dy: 1 };
    case 'east':
      return { dx: -1, dy: 0 };
    case 'west':
      return { dx: 1, dy: 0 };
  }
}

/** The range of `along` values that land inside the room, and its depth, for a doorway on `side`. */
function frameExtent(
  side: DoorSide,
  bounds: TileRect,
): { alongMin: number; alongMax: number; depth: number } {
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  const midX = bounds.x + Math.floor(bounds.w / 2);
  const midY = bounds.y + Math.floor(bounds.h / 2);
  switch (side) {
    case 'south':
      return { alongMin: bounds.x - midX, alongMax: lastX - midX, depth: bounds.h };
    case 'north':
      return { alongMin: midX - lastX, alongMax: midX - bounds.x, depth: bounds.h };
    case 'east':
      return { alongMin: midY - lastY, alongMax: midY - bounds.y, depth: bounds.w };
    case 'west':
      return { alongMin: bounds.y - midY, alongMax: lastY - midY, depth: bounds.w };
  }
}

type Kind = 'rack' | 'squat' | 'cable' | 'bench' | 'boombox' | 'turf';
interface Entry extends TemplateOffset {
  kind: Kind;
}

/** The furthest a side wall's kit is slid along its wall to clear a doorway. */
const MAX_WALL_SLIDE_TILES = 6;

/**
 * A side wall's group shifted in depth by the smallest amount that keeps every
 * piece, and the floor tile in front of it, clear of `keepClear` and off the
 * turf rows; unshifted when no shift within reach works, so the drop filter
 * decides.
 */
function slideAlongWall(
  group: readonly Entry[],
  side: DoorSide,
  bounds: TileRect,
  keepClear: ReadonlySet<string>,
  farDepth: number,
): Entry[] {
  const inwardStep = (entry: Entry): number => (entry.along < 0 ? 1 : -1);
  for (let distance = 0; distance <= MAX_WALL_SLIDE_TILES; distance++) {
    for (const shift of distance === 0 ? [0] : [distance, -distance]) {
      const moved = group.map((entry) => ({ ...entry, depth: entry.depth + shift }));
      const lastRoomDepth = farDepth - TURF_DEPTH_TILES;
      if (moved.some((entry) => entry.depth < 0 || entry.depth > lastRoomDepth)) continue;
      const withFronts = moved.flatMap((entry) => [
        entry,
        { ...entry, along: entry.along + inwardStep(entry) },
      ]);
      const placed = rotateTemplate(withFronts, side, bounds);
      if (placed.length !== withFronts.length) continue;
      if (placed.every((tile) => !keepClear.has(key(tile)))) return moved;
    }
  }
  return [...group];
}

/**
 * The nearest depth to `preferred` at least two tiles from every piece of a
 * wall's kit: the kit's tall art rises over anything laid on the floor beside it.
 */
function clearOfKit(preferred: number, kit: readonly Entry[]): number {
  const clear = (depth: number): boolean =>
    kit.every((entry) => Math.abs(entry.depth - depth) > BENCH_KIT_CLEARANCE);
  for (let distance = 0; distance <= MAX_WALL_SLIDE_TILES; distance++) {
    for (const depth of [preferred + distance, preferred - distance]) {
      if (depth >= 0 && clear(depth)) return depth;
    }
  }
  return preferred;
}
/** Tiles of floor, in depth, a bench keeps from its wall's kit. */
const BENCH_KIT_CLEARANCE = 1;

/** The side a doorway's room is keyed to: the widest doorway's. */
function primarySide(doorways: readonly BossRoomDoorway[]): DoorSide {
  return doorways.length === 0 ? 'south' : doorways[0].side;
}

const key = (t: TilePoint): string => `${t.x},${t.y}`;

/**
 * Plans the gym for a room. `doorways` widest first, as `findBossRoomDoorways`
 * returns them; `spawn` is the boss's spawn tile.
 */
export function planGymLayout(
  bounds: TileRect,
  doorways: readonly BossRoomDoorway[],
  spawn: TilePoint,
): GymLayout {
  const side = primarySide(doorways);
  const inward = inwardOf(side);
  const { alongMin, alongMax, depth } = frameExtent(side, bounds);
  const farDepth = depth - 1;
  const midDepth = Math.floor(farDepth / 2);
  // The tall pieces go on the rack's north side where the wall runs north to
  // south: two tiles tall, they would stand in front of it from the south.
  const squatStep = side === 'north' ? -SQUAT_RACK_STEP : SQUAT_RACK_STEP;
  const cableStep = squatStep * CABLE_STACK_STEPS;

  const keepClear = new Set<string>();
  for (const doorway of doorways) {
    for (const tile of approachLaneTiles(doorway, bounds)) keepClear.add(key(tile));
  }
  for (const tile of spawnClearTiles(spawn)) keepClear.add(key(tile));

  // Each side wall's kit is placed as one group and slid along the wall, as a
  // group, to the nearest spot clear of every doorway's approach: the dumbbell
  // rack and the squat rack beside it have to stay neighbours, since standing at
  // the one is what puts him in reach of the other.
  const leftWall = slideAlongWall(
    [
      { kind: 'cable', along: alongMin, depth: midDepth + cableStep },
      { kind: 'rack', along: alongMin, depth: midDepth },
      { kind: 'squat', along: alongMin, depth: midDepth + squatStep },
    ],
    side,
    bounds,
    keepClear,
    farDepth,
  );
  const rightWall = slideAlongWall(
    [
      { kind: 'squat', along: alongMax, depth: midDepth + squatStep },
      { kind: 'rack', along: alongMax, depth: midDepth },
      { kind: 'cable', along: alongMax, depth: midDepth + cableStep },
    ],
    side,
    bounds,
    keepClear,
    farDepth,
  );
  const template: Entry[] = [
    ...leftWall,
    ...rightWall,
    {
      kind: 'bench',
      along: alongMin + BENCH_WALL_GAP_TILES,
      depth: clearOfKit(midDepth - BENCH_DEPTH_OFFSET, leftWall),
    },
    {
      kind: 'bench',
      along: alongMax - BENCH_WALL_GAP_TILES,
      depth: clearOfKit(midDepth + BENCH_DEPTH_OFFSET, rightWall),
    },
  ];
  const kitDepths = new Set(leftWall.map((entry) => entry.depth));
  for (let depth = BOOMBOX_DEPTH; depth < farDepth - TURF_DEPTH_TILES; depth++) {
    const crowded = [depth - 1, depth, depth + 1].some((near) => kitDepths.has(near));
    const spots = rotateTemplate([{ along: alongMin, depth }], side, bounds);
    if (crowded || spots.length === 0 || keepClear.has(key(spots[0]))) continue;
    template.push({ kind: 'boombox', along: alongMin, depth });
    break;
  }

  const firstTreadmillAlong = alongMax - TREADMILL_CORNER_GAP_TILES;
  const treadmillAlongs: number[] = [];
  for (let index = 0; index < TREADMILL_COUNT; index++) {
    treadmillAlongs.push(firstTreadmillAlong - index * TREADMILL_PITCH_TILES);
  }
  const lastTreadmillAlong = firstTreadmillAlong - (TREADMILL_COUNT - 1) * TREADMILL_PITCH_TILES;
  for (let along = alongMin + 1; along < lastTreadmillAlong - TURF_TREADMILL_GAP_TILES; along++) {
    for (let row = 0; row < TURF_DEPTH_TILES; row++) {
      template.push({ kind: 'turf', along, depth: farDepth - row });
    }
  }

  const placed = rotateTemplate(template, side, bounds).filter(
    (entry) => !keepClear.has(key(entry)),
  );
  const ofKind = (kind: Kind): TilePoint[] =>
    placed.filter((entry) => entry.kind === kind).map(({ x, y }) => ({ x, y }));

  const treadmills: GymTreadmill[] = [];
  for (const along of treadmillAlongs) {
    const ends = rotateTemplate(
      [
        { along, depth: farDepth },
        { along, depth: farDepth - 1 },
      ],
      side,
      bounds,
    );
    if (ends.length < BELT_TILES) continue;
    const [wallEnd, roomEnd] = ends;
    if (keepClear.has(key(wallEnd)) || keepClear.has(key(roomEnd))) continue;
    treadmills.push({
      belt: [
        { x: wallEnd.x, y: wallEnd.y },
        { x: roomEnd.x, y: roomEnd.y },
      ],
      push: { dx: -inward.dx, dy: -inward.dy },
      console: { x: wallEnd.x, y: wallEnd.y },
    });
  }

  const boombox = ofKind('boombox')[0] ?? null;
  return {
    bounds,
    side,
    inward,
    spawn,
    platform: {
      x: spawn.x - PLATFORM_HALF,
      y: spawn.y - PLATFORM_HALF,
      w: PLATFORM_TILES,
      h: PLATFORM_TILES,
    },
    turf: ofKind('turf'),
    turfLinesAlongX: inward.dx !== 0,
    racks: ofKind('rack'),
    squatRacks: ofKind('squat'),
    cableStacks: ofKind('cable'),
    treadmills,
    benches: ofKind('bench'),
    boombox,
    mirror: mirrorRun(side, bounds, doorways),
    whiteboard: whiteboardRun(side, bounds, doorways),
    doorways,
  };
}

function isDoorwayWallTile(
  tile: TilePoint,
  doorways: readonly BossRoomDoorway[],
  bounds: TileRect,
): boolean {
  // A doorway's perimeter tile is inside the room; the wall tile it opens is
  // one step outside it.
  return doorways.some((doorway) =>
    doorway.tiles.some((open) => {
      const outward = outwardWallTile(open, bounds);
      return outward.some((wall) => wall.x === tile.x && wall.y === tile.y);
    }),
  );
}

function outwardWallTile(tile: TilePoint, bounds: TileRect): TilePoint[] {
  const out: TilePoint[] = [];
  if (tile.y === bounds.y) out.push({ x: tile.x, y: tile.y - 1 });
  if (tile.y === bounds.y + bounds.h - 1) out.push({ x: tile.x, y: tile.y + 1 });
  if (tile.x === bounds.x) out.push({ x: tile.x - 1, y: tile.y });
  if (tile.x === bounds.x + bounds.w - 1) out.push({ x: tile.x + 1, y: tile.y });
  return out;
}

/** The wall row just outside `wall`, as a run of tiles along the room's edge. */
function wallRow(wall: DoorSide, bounds: TileRect): GymWallRun {
  const tiles: TilePoint[] = [];
  switch (wall) {
    case 'north':
    case 'south': {
      const y = wall === 'north' ? bounds.y - 1 : bounds.y + bounds.h;
      for (let x = bounds.x; x < bounds.x + bounds.w; x++) tiles.push({ x, y });
      return { tiles, alongY: false };
    }
    case 'east':
    case 'west': {
      const x = wall === 'west' ? bounds.x - 1 : bounds.x + bounds.w;
      for (let y = bounds.y; y < bounds.y + bounds.h; y++) tiles.push({ x, y });
      return { tiles, alongY: true };
    }
  }
}

const OPPOSITE: Readonly<Record<DoorSide, DoorSide>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

function mirrorRun(
  side: DoorSide,
  bounds: TileRect,
  doorways: readonly BossRoomDoorway[],
): GymWallRun {
  const row = wallRow(OPPOSITE[side], bounds);
  return {
    tiles: row.tiles.filter((tile) => !isDoorwayWallTile(tile, doorways, bounds)),
    alongY: row.alongY,
  };
}

/**
 * The whiteboard hangs on a wall that runs along x, where its lettering reads
 * left to right: the doorway wall for a north or south doorway, the north wall
 * otherwise. The first unbroken stretch long enough for it, from the left.
 */
function whiteboardRun(
  side: DoorSide,
  bounds: TileRect,
  doorways: readonly BossRoomDoorway[],
): GymWallRun | null {
  const wall: DoorSide = side === 'north' || side === 'south' ? side : 'north';
  const row = wallRow(wall, bounds).tiles;
  for (let start = WHITEBOARD_CORNER_GAP; start + WHITEBOARD_TILES <= row.length; start++) {
    const run = row.slice(start, start + WHITEBOARD_TILES);
    if (run.every((tile) => !isDoorwayWallTile(tile, doorways, bounds))) {
      return { tiles: run, alongY: false };
    }
  }
  return null;
}

// ── Reading a gym off a finished grid ────────────────────────────────────────

function isGymFloor(tile: TileContent): boolean {
  return tile.type === JUICER_BOSS_ROOM_FLOOR || tile.groundType === JUICER_BOSS_ROOM_FLOOR;
}

const layoutCache = new WeakMap<TileContent[][], GymLayout | null>();

/**
 * The gym on this grid, found by its floor, or null when the grid has none.
 * Cached per grid: a painter asks once per tile it paints, and the gym's shape
 * never changes after the floor is generated.
 */
export function gymLayoutOf(structure: TileContent[][]): GymLayout | null {
  const cached = layoutCache.get(structure);
  if (cached !== undefined) return cached;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  structure.forEach((row, y) =>
    row.forEach((tile, x) => {
      if (!isGymFloor(tile)) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }),
  );
  if (!Number.isFinite(minX)) {
    layoutCache.set(structure, null);
    return null;
  }
  const bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const doorways = roomDoorways(structure, bounds)
    .slice()
    .sort((a, b) => b.tiles.length - a.tiles.length)
    .map((doorway) => ({
      side: doorway.wall,
      tile: { x: doorway.tile.x, y: doorway.tile.y },
      tiles: doorway.tiles.map((t) => ({ x: t.x, y: t.y })),
    }));
  const spawn = { x: Math.floor(minX + bounds.w / 2), y: Math.floor(minY + bounds.h / 2) };
  const layout = planGymLayout(bounds, doorways, spawn);
  layoutCache.set(structure, layout);
  return layout;
}
