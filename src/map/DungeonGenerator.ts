import {
  FloorTypeValue,
  type TileContent,
  VOID_TYPE,
  SAFE_ROOM_FLOOR,
  HORDER_BOSS_ROOM_FLOOR,
  JUICER_BOSS_ROOM_FLOOR,
  KRAKAREN_BOSS_ROOM_FLOOR,
  METAL_WALL,
  ARENA_FLOOR,
  FLOOR_GRATE,
  TORCH,
  BARREL,
  BARREL_SIDE,
  CRATE,
  BRAZIER,
  BONES,
  BOOKSHELF,
  SPIDER_LAB_FLOOR,
} from './tileTypes';
import { randomFromArray, randomInt, clamp } from '../utils';

type Room = { x: number; y: number; w: number; h: number; floor: number };
type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Zone = 'entrance' | 'mid' | 'deep';
// narrow = 1-tile wide (default); standard = 3-tile wide (main arteries); nook = narrow + alcove junction
type HallwayKind = 'narrow' | 'standard' | 'nook';

export interface ArenaExterior {
  centre: Point;
  radius: number;
  doorTile: Point;
  /** Tile position for the stairwell placed at the arena centre (initially locked). */
  stairwellTile: Point;
}

export interface QuestRoomData {
  bounds: Rect;
  centre: Point;
  grateTiles: Point[];
  entranceTile: Point;
  npcTile: Point;
  woodPileTile: Point;
}

export interface TreasureRoomData {
  bounds: { x: number; y: number; w: number; h: number };
  centre: { x: number; y: number };
}

export interface SpiderLabRoomData {
  bounds: Rect;
  centre: Point;
  /** South-wall entrance tile (where hallways connect). */
  entranceTile: Point;
  /** Tile where the scientist NPC stands (near entrance). */
  scientistTile: Point;
  /** Tile where the lab computer table is placed. */
  computerTile: Point;
  /** Tile where the spider egg starts (centre of room). */
  spiderEggTile: Point;
  /** Tile positions of the life machines scattered through the room. */
  lifeMachineTiles: Point[];
}

export interface DungeonData {
  grid: TileContent[][];
  startTile: Point;
  safeRooms: Array<{ bounds: Rect; centre: Point }>;
  bossRooms: Array<{ bounds: Rect; centre: Point }>;
  questRooms: QuestRoomData[];
  treasureRooms: TreasureRoomData[];
  spiderLabRoom: SpiderLabRoomData | null;
  mobSpawnPoints: Array<Point & { w: number; h: number }>;
  hallwaySpawnPoints: Point[];
  stairwellTiles: Point[];
  buildingEntries: Array<{ doorTile: Point; name: string; type: 'arena' }>;
  arenaExteriors: ArenaExterior[];
}

// ── Zone helpers ──────────────────────────────────────────────────────────────

const ZONE_ENTRANCE_MAX = 30;
const ZONE_MID_MAX = 60;

// Corridor zone floor probabilities
const MID_ZONE_CONCRETE_PROB = 0.5;
const DEEP_ZONE_TILE_PROB = 0.55;

// Hallway kind probability thresholds by zone
const SPECIAL_CONN_STANDARD_PROB = 0.55;
const ENTRANCE_NARROW_THRESH = 0.48;
const ENTRANCE_STANDARD_THRESH = 0.88;
const MID_NARROW_THRESH = 0.62;
const MID_STANDARD_THRESH = 0.9;
const DEEP_NARROW_THRESH = 0.76;
const DEEP_STANDARD_THRESH = 0.93;

// Room generation scaling: maxRooms ≈ ROOMS_SCALE_FACTOR * (size / SIZE_SCALE_BASE)²
const ROOMS_SCALE_FACTOR = 15;
const SIZE_SCALE_BASE = 100;
const ATTEMPT_MULTIPLIER = 8;
const MIN_PLACEMENT_ATTEMPTS = 80;

// Special room fixed dimensions
const BOSS_ROOM_W = 22;
const BOSS_ROOM_H = 18;
const QUEST_ROOM_W = 14;
const QUEST_ROOM_H = 12;
const SPIDER_LAB_W = 40;
const SPIDER_LAB_H = 32;

const BOSS_MIN_SEPARATION = 60;
const FALLBACK_START_POS = 15;

// Extra loop connections added on top of MST
const EXTRA_LOOP_RATIO = 0.22;
const LOOP_ATTEMPT_FACTOR = 10;
const EXTRA_LOOP_MIN_DIST = 14;
const EXTRA_LOOP_MAX_DIST = 40;

const QUEST_GRATE_WALL_OFFSET = 3;

// Spider lab furniture layout (room is SPIDER_LAB_W × SPIDER_LAB_H tiles)
const LAB_WALL_OFFSET = 3; // items placed 3 tiles inside walls
const LAB_EGG_NEAR_WALL = 4; // egg/computer offset near entrance
const LAB_EGG_FAR_WALL = 5; // egg/computer offset far from entrance
const LAB_MACHINE_SPREAD = 10; // life machine lateral spread from center
const LAB_MACHINE_NS_NEAR_ROW = 12; // near life machine row (N/S entrance)
const LAB_MACHINE_NS_NEAR_FROM_FAR = 13; // same, from far wall
const LAB_MACHINE_EW_NEAR_FROM_FAR = 14; // near life machine col from far wall (E/W)
const LAB_MACHINE_NS_FAR_ROW = 22; // far life machine row (N/S entrance)
const LAB_MACHINE_NS_FAR_FROM_FAR = 23; // same, from far wall
const LAB_MACHINE_EW_FAR_COL = 24; // far life machine column (E/W entrance)
const LAB_MACHINE_EW_FAR_FROM_FAR = 25; // same, from far wall

const ROOMS_PER_STAIRWELL = 50;

// Room decoration placement
const PILLAR_MIN_ROOM_W = 13;
const PILLAR_MIN_ROOM_H = 10;
const DECO_INNER_OFFSET = 3; // decor placed 3 tiles inside walls
const DECO_NEAR_FAR_OFFSET = 4; // far-side column (r.w - DECO_NEAR_FAR_OFFSET)

// Decoration cycle lengths by zone
const ENTRANCE_CYCLE_LEN = 6;
const STANDARD_CYCLE_LEN = 8;

// Per-cycle thresholds and offsets
const CYCLE0_MIN_W = 10;
const CYCLE0_EXTRA_BARREL_MIN_W = 12;
const CYCLE0_EXTRA_BARREL_DX = 5;
const CYCLE1_MIN_W = 8;
const CYCLE3_MIN_SIZE = 7;
const CYCLE4_MIN_W = 9;
const CYCLE5_BONE_COUNT = 3;
const CYCLE5_DEEP_BONE_COUNT = 4;
const CYCLE6_MIN_W = 10;
const CYCLE6_SHELF_DX_END = 4;
const DECO_CYCLE_BRAZIER = 3;
const DECO_CYCLE_CORNER_MIX = 4;
const DECO_CYCLE_BONES = 5;
const DECO_CYCLE_SHELVES = 6;
const DECO_CYCLE_CLUSTER = 7;

const TREASURE_ROOM_RATIO = 0.05;

// Hallway spawn point density: count ≈ HALLWAY_SPAWNS_SCALE * (size / SIZE_SCALE_BASE)²
const HALLWAY_SPAWNS_SCALE = 10;
const HALLWAY_SPAWN_MIN_GAP = 3;

// Arena placement
const ARENA_PLACEMENT_ATTEMPTS = 800;
const ARENA_ANGLE_JITTER = 0.3;
const ARENA_MIN_DIST = 20;
const ARENA_DIST_VARIANCE = 70;
const ARENA_CLEARANCE = 3;

function getZone(point: Point, start: Point): Zone {
  const d = Math.hypot(point.x - start.x, point.y - start.y);
  if (d < ZONE_ENTRANCE_MAX) return 'entrance';
  if (d < ZONE_MID_MAX) return 'mid';
  return 'deep';
}

// Zone-weighted floor palettes for regular rooms.
const ZONE_FLOORS: Record<Zone, number[]> = {
  entrance: [FloorTypeValue.concrete, FloorTypeValue.concrete, FloorTypeValue.tile_floor],
  mid: [FloorTypeValue.carpet, FloorTypeValue.wood, FloorTypeValue.tile_floor],
  deep: [FloorTypeValue.wood, FloorTypeValue.concrete, FloorTypeValue.carpet],
};

// Zone-based corridor floor — corridors now visually match their zone theme.
function corridorFloorForZone(zone: Zone): number {
  if (zone === 'entrance') return FloorTypeValue.concrete;
  if (zone === 'mid') {
    return Math.random() < MID_ZONE_CONCRETE_PROB
      ? FloorTypeValue.concrete
      : FloorTypeValue.tile_floor;
  }
  // deep: darker, worn floors
  return Math.random() < DEEP_ZONE_TILE_PROB ? FloorTypeValue.tile_floor : FloorTypeValue.wood;
}

// ── Vignette system ───────────────────────────────────────────────────────────

type Vignette = {
  tiles: ReadonlyArray<ReadonlyArray<number>>;
  minZone?: Zone;
  minRoomW?: number;
  minRoomH?: number;
  weight: number;
};

const ZONE_ORDER: ReadonlyArray<Zone> = ['entrance', 'mid', 'deep'];

// prettier-ignore
const VIGNETTES: ReadonlyArray<Vignette> = [
  {
    weight: 10,
    tiles: [
      [TORCH, 0,     0,       0,     TORCH],
      [0,     CRATE, BRAZIER, CRATE, 0    ],
      [0,     0,     BONES,   0,     0    ],
    ],
    minRoomW: 9, minRoomH: 7,
  },
  {
    weight: 8,
    tiles: [
      [BARREL,      BARREL,      0, CRATE,       CRATE     ],
      [BARREL_SIDE, BARREL_SIDE, 0, BARREL_SIDE, BARREL_SIDE],
    ],
    minRoomW: 9,
  },
  {
    weight: 8,
    tiles: [
      [BARREL, CRATE, TORCH,  CRATE, BARREL],
      [0,      0,     0,      0,     0     ],
      [BONES,  0,     0,      0,     BONES ],
    ],
    minRoomW: 9, minRoomH: 7,
  },
  {
    weight: 9,
    tiles: [
      [BARREL, BARREL_SIDE, BARREL, BARREL_SIDE, BARREL],
    ],
    minRoomW: 9,
  },
  {
    weight: 10,
    tiles: [
      [BONES,       0,           BARREL_SIDE, 0    ],
      [0,           BARREL_SIDE, 0,           BONES],
      [BARREL_SIDE, 0,           BONES,       0    ],
    ],
    minRoomW: 8, minRoomH: 7,
  },
  {
    weight: 7,
    tiles: [
      [BARREL, 0, 0, 0, BARREL],
      [0,      0, 0, 0, 0     ],
      [0,      0, 0, 0, 0     ],
      [0,      0, 0, 0, 0     ],
      [BARREL, 0, 0, 0, BARREL],
    ],
    minRoomW: 9, minRoomH: 9,
  },
  {
    weight: 7,
    tiles: [
      [BARREL, BARREL, CRATE],
      [BARREL, 0,      0    ],
      [CRATE,  CRATE,  0    ],
    ],
    minRoomW: 7,
  },
  {
    weight: 9,
    minZone: 'mid',
    tiles: [
      [TORCH, 0,     0,       0,     TORCH],
      [0,     BONES, 0,       BONES, 0    ],
      [0,     0,     BRAZIER, 0,     0    ],
      [0,     BONES, 0,       BONES, 0    ],
      [TORCH, 0,     0,       0,     TORCH],
    ],
    minRoomW: 9, minRoomH: 9,
  },
  {
    weight: 9,
    minZone: 'mid',
    tiles: [
      [BONES,  BONES, CRATE, BONES, BONES],
      [BONES,  0,     0,     0,     CRATE],
      [CRATE,  0,     0,     0,     BONES],
    ],
    minRoomW: 9,
  },
  {
    weight: 8,
    minZone: 'mid',
    tiles: [
      [CRATE, CRATE, CRATE,  0    ],
      [CRATE, 0,     0,      CRATE],
      [BONES, BONES, 0,      0    ],
    ],
    minRoomW: 8, minRoomH: 7,
  },
  {
    weight: 8,
    minZone: 'deep',
    tiles: [
      [BOOKSHELF, 0,     TORCH,   0,     BOOKSHELF],
      [0,         CRATE, BRAZIER, CRATE, 0        ],
      [BONES,     BONES, 0,       BONES, BONES    ],
    ],
    minRoomW: 9, minRoomH: 7,
  },
  {
    weight: 9,
    minZone: 'deep',
    tiles: [
      [BONES,  BONES,  BRAZIER, BONES,  BONES ],
      [BONES,  0,      0,       0,      BONES ],
      [BARREL, BONES,  BONES,   BONES,  BARREL],
    ],
    minRoomW: 9, minRoomH: 7,
  },
];

function pickVignette(zone: Zone, room: Room): Vignette | null {
  const zi = ZONE_ORDER.indexOf(zone);
  const eligible = VIGNETTES.filter((v) => {
    const vH = v.tiles.length;
    const vW = v.tiles[0]?.length ?? 0;
    if (room.w - 2 < vW || room.h - 2 < vH) return false;
    if (v.minRoomW !== undefined && room.w < v.minRoomW) return false;
    if (v.minRoomH !== undefined && room.h < v.minRoomH) return false;
    if (v.minZone !== undefined && zi < ZONE_ORDER.indexOf(v.minZone)) return false;
    return true;
  });
  if (eligible.length === 0) return null;

  let totalWeight = 0;
  for (const v of eligible) totalWeight += v.weight;
  let pick = Math.random() * totalWeight;
  for (const v of eligible) {
    pick -= v.weight;
    if (pick <= 0) return v;
  }
  return eligible[eligible.length - 1] ?? null;
}

function stampVignette(
  grid: TileContent[][],
  room: Room,
  vignette: Vignette,
  gridSize: number,
  stairwellBlockedSet: Set<string>,
): void {
  const vH = vignette.tiles.length;
  const vW = vignette.tiles[0]?.length ?? 0;
  if (vH === 0 || vW === 0) return;

  const interiorW = room.w - 2;
  const interiorH = room.h - 2;
  const maxOffX = interiorW - vW;
  const maxOffY = interiorH - vH;
  const offX = maxOffX > 0 ? randomInt(0, maxOffX) : 0;
  const offY = maxOffY > 0 ? randomInt(0, maxOffY) : 0;

  const originX = room.x + 1 + offX;
  const originY = room.y + 1 + offY;

  for (let vy = 0; vy < vH; vy++) {
    const vigRow = vignette.tiles[vy];
    for (let vx = 0; vx < vW; vx++) {
      const tileType = vigRow[vx] ?? 0;
      if (tileType === 0) continue;
      const gx = originX + vx;
      const gy = originY + vy;
      if (gy < 0 || gy >= gridSize || gx < 0 || gx >= gridSize) continue;
      if (stairwellBlockedSet.has(`${gx},${gy}`)) continue;
      const existingType = grid[gy][gx].type;
      if (
        existingType === room.floor ||
        existingType === FloorTypeValue.concrete ||
        existingType === FloorTypeValue.tile_floor ||
        existingType === FloorTypeValue.carpet ||
        existingType === FloorTypeValue.wood
      ) {
        grid[gy][gx].type = tileType;
      }
    }
  }
}

const VIGNETTE_CHANCE: Record<Zone, number> = {
  entrance: 0.22,
  mid: 0.38,
  deep: 0.55,
};

// ── Boss floor selection ──────────────────────────────────────────────────────

function bossFloorForType(type: string): number {
  switch (type) {
    case 'the_hoarder':
      return HORDER_BOSS_ROOM_FLOOR;
    case 'juicer':
      return JUICER_BOSS_ROOM_FLOOR;
    case 'krakaren_clone':
      return KRAKAREN_BOSS_ROOM_FLOOR;
    default:
      return HORDER_BOSS_ROOM_FLOOR;
  }
}

// ── Main generator ────────────────────────────────────────────────────────────

export function generateDungeon(
  size: number,
  numBossRooms: number,
  numSafeRooms: number,
  numStairwellsOverride?: number,
  hasArena = false,
  bossTypes: string[] = [],
  hasSpiderLab = false,
): DungeonData {
  const BORDER = 5;

  // 1. Fill everything with wall tiles
  const grid: TileContent[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.wall,
    })),
  );

  // 2. Void border
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (y < BORDER || y >= size - BORDER || x < BORDER || x >= size - BORDER) {
        grid[y][x].type = VOID_TYPE;
      }
    }
  }

  // Tiles carved as hallway — tracked for rat spawn placement
  const hallwayTiles: Array<{ x: number; y: number }> = [];

  // ── Hallway carvers ───────────────────────────────────────────────────────
  //
  // L-shaped path: horizontal leg at y=y1, then vertical leg at x=x2.
  // halfWidth=0 → 1-tile wide (default); halfWidth=1 → 3-tile wide (main arteries).
  // Corridors only carve through existing wall tiles, so they don't overwrite rooms.

  const carveHallwayCore = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    halfWidth: number,
    floorType: number,
  ) => {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (let hx = minX; hx <= maxX; hx++) {
      for (let off = -halfWidth; off <= halfWidth; off++) {
        const hy = y1 + off;
        if (hy >= BORDER && hy < size - BORDER && grid[hy][hx].type === FloorTypeValue.wall) {
          grid[hy][hx].type = floorType;
          hallwayTiles.push({ x: hx, y: hy });
        }
      }
    }
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (let hy = minY; hy <= maxY; hy++) {
      for (let off = -halfWidth; off <= halfWidth; off++) {
        const hx = x2 + off;
        if (hx >= BORDER && hx < size - BORDER && grid[hy][hx].type === FloorTypeValue.wall) {
          grid[hy][hx].type = floorType;
          hallwayTiles.push({ x: hx, y: hy });
        }
      }
    }
  };

  // Small 5×5 alcove at the L-bend, creating an interesting junction pocket.
  const carveNookAt = (cx: number, cy: number, floorType: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= BORDER && nx < size - BORDER && ny >= BORDER && ny < size - BORDER) {
          if (grid[ny][nx].type === FloorTypeValue.wall) {
            grid[ny][nx].type = floorType;
            hallwayTiles.push({ x: nx, y: ny });
          }
        }
      }
    }
  };

  const carveHallway = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    kind: HallwayKind,
    floorType: number,
  ) => {
    const halfWidth = kind === 'standard' ? 1 : 0;
    carveHallwayCore(x1, y1, x2, y2, halfWidth, floorType);
    if (kind === 'nook') {
      carveNookAt(x2, y1, floorType);
    }
  };

  // Picks corridor kind based on zone. Most corridors are 1-tile narrow — rooms
  // become clearly distinct from the passages connecting them.
  const selectHallwayKind = (zone: Zone, isSpecial: boolean): HallwayKind => {
    if (isSpecial) {
      // Connections to/from safe rooms, boss rooms, and the first hub connections
      // get a wider passage so key areas feel accessible.
      return Math.random() < SPECIAL_CONN_STANDARD_PROB ? 'standard' : 'narrow';
    }
    const r = Math.random();
    if (zone === 'entrance') {
      if (r < ENTRANCE_NARROW_THRESH) return 'narrow';
      if (r < ENTRANCE_STANDARD_THRESH) return 'standard';
      return 'nook';
    } else if (zone === 'mid') {
      if (r < MID_NARROW_THRESH) return 'narrow';
      if (r < MID_STANDARD_THRESH) return 'standard';
      return 'nook';
    } else {
      if (r < DEEP_NARROW_THRESH) return 'narrow';
      if (r < DEEP_STANDARD_THRESH) return 'standard';
      return 'nook';
    }
  };

  // 3. Place rooms
  const rooms: Room[] = [];
  const MIN_W = 8,
    MAX_W = 16;
  const MIN_H = 7,
    MAX_H = 14;
  const GAP = 3;

  const safeRoomStart = 1;
  const safeRoomEnd = 1 + numSafeRooms;
  const bossRoomStart = safeRoomEnd;
  const bossRoomEnd = safeRoomEnd + numBossRooms;
  const questRoomIdx = bossRoomEnd;
  const spiderLabRoomIdx = hasSpiderLab ? questRoomIdx + 1 : -1;
  const regularRoomStart = hasSpiderLab ? questRoomIdx + 2 : questRoomIdx + 1;

  const maxRooms = Math.round(ROOMS_SCALE_FACTOR * (size / SIZE_SCALE_BASE) ** 2);
  const maxAttempts = Math.max(maxRooms * ATTEMPT_MULTIPLIER, MIN_PLACEMENT_ATTEMPTS);

  const SAFE_MAX_DIST = 50;
  const BOSS_MAX_DIST = 80;
  const SAFE_MIN_SEPARATION = 18;

  let startCenter: Point | null = null;

  for (let attempt = 0; attempt < maxAttempts && rooms.length < maxRooms; attempt++) {
    const isSafeRoom = rooms.length >= safeRoomStart && rooms.length < safeRoomEnd;
    const isBossRoom = rooms.length >= bossRoomStart && rooms.length < bossRoomEnd;
    const isQuestRoom = rooms.length === questRoomIdx;
    const isSpiderLabRoom = spiderLabRoomIdx >= 0 && rooms.length === spiderLabRoomIdx;
    const w = isBossRoom
      ? BOSS_ROOM_W
      : isQuestRoom
        ? QUEST_ROOM_W
        : isSpiderLabRoom
          ? SPIDER_LAB_W
          : randomInt(MIN_W, MAX_W);
    const h = isBossRoom
      ? BOSS_ROOM_H
      : isQuestRoom
        ? QUEST_ROOM_H
        : isSpiderLabRoom
          ? SPIDER_LAB_H
          : randomInt(MIN_H, MAX_H);
    const x = randomInt(BORDER + 1, size - BORDER - w - 2);
    const y = randomInt(BORDER + 1, size - BORDER - h - 2);

    const cx = Math.floor(x + w / 2);
    const cy = Math.floor(y + h / 2);

    const overlaps = rooms.some(
      (r) => x < r.x + r.w + GAP && x + w + GAP > r.x && y < r.y + r.h + GAP && y + h + GAP > r.y,
    );

    const tooCloseToBoss =
      isBossRoom &&
      rooms.slice(bossRoomStart, bossRoomEnd).some((r) => {
        const rc = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
        return Math.hypot(cx - rc.x, cy - rc.y) < BOSS_MIN_SEPARATION;
      });

    const tooCloseToSafeRoom =
      isSafeRoom &&
      rooms.slice(safeRoomStart, safeRoomEnd).some((r) => {
        const rc = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
        return Math.hypot(cx - rc.x, cy - rc.y) < SAFE_MIN_SEPARATION;
      });

    const QUEST_MAX_DIST = 60;
    const SPIDER_LAB_MIN_DIST = 30;
    const SPIDER_LAB_MAX_DIST = 90;
    let tooFarFromStart = false;
    if (rooms.length > 0) {
      const sc = startCenter ?? {
        x: Math.floor(rooms[0].x + rooms[0].w / 2),
        y: Math.floor(rooms[0].y + rooms[0].h / 2),
      };
      if (isSpiderLabRoom) {
        const d = Math.hypot(cx - sc.x, cy - sc.y);
        if (d < SPIDER_LAB_MIN_DIST || d > SPIDER_LAB_MAX_DIST) tooFarFromStart = true;
      } else {
        const maxDist = isSafeRoom
          ? SAFE_MAX_DIST
          : isBossRoom
            ? BOSS_MAX_DIST
            : isQuestRoom
              ? QUEST_MAX_DIST
              : Infinity;
        if (Math.hypot(cx - sc.x, cy - sc.y) > maxDist) tooFarFromStart = true;
      }
    }

    if (!overlaps && !tooCloseToBoss && !tooCloseToSafeRoom && !tooFarFromStart) {
      const roomCentre: Point = { x: cx, y: cy };
      const zone: Zone = startCenter !== null ? getZone(roomCentre, startCenter) : 'entrance';

      const bossIdx = rooms.length - bossRoomStart;
      const floor = isSafeRoom
        ? SAFE_ROOM_FLOOR
        : isBossRoom
          ? bossFloorForType(bossTypes[bossIdx] ?? '')
          : isQuestRoom
            ? FloorTypeValue.tile_floor
            : isSpiderLabRoom
              ? SPIDER_LAB_FLOOR
              : randomFromArray(ZONE_FLOORS[zone]);

      rooms.push({ x, y, w, h, floor });
      if (rooms.length === 1) startCenter = { x: cx, y: cy };

      // Carve room floor
      for (let ry = y; ry < y + h; ry++) {
        for (let rx = x; rx < x + w; rx++) {
          grid[ry][rx].type = floor;
        }
      }
    }
  }

  // ── Hallway connectivity via MST (Prim's algorithm) ───────────────────────
  //
  // Rather than connecting rooms in placement order (a single spaghetti chain),
  // Prim's builds a spanning tree by always attaching the nearest unconnected
  // room to the already-connected set. This naturally creates hub rooms (rooms
  // with several connections) and dead-end rooms (one connection), giving the
  // dungeon a real branching structure to explore.

  const sc = startCenter ?? {
    x: rooms[0]?.x ?? FALLBACK_START_POS,
    y: rooms[0]?.y ?? FALLBACK_START_POS,
  };

  // Track which rooms are "special" (safe, boss, quest) for corridor width decisions.
  const specialRoomIdxSet = new Set<number>();
  specialRoomIdxSet.add(0); // start room
  for (let i = safeRoomStart; i < safeRoomEnd; i++) specialRoomIdxSet.add(i);
  for (let i = bossRoomStart; i < bossRoomEnd; i++) specialRoomIdxSet.add(i);
  specialRoomIdxSet.add(questRoomIdx);
  if (spiderLabRoomIdx >= 0) specialRoomIdxSet.add(spiderLabRoomIdx);

  type Edge = { from: number; to: number };
  const mstEdges: Edge[] = [];

  if (rooms.length > 1) {
    const connected = new Set<number>([0]);
    // minDist[i] = distance from room i to its current closest connected room
    const minDist = rooms.map((r, i) => {
      if (i === 0) return 0;
      const r0 = rooms[0];
      return Math.hypot(
        Math.floor(r.x + r.w / 2) - Math.floor(r0.x + r0.w / 2),
        Math.floor(r.y + r.h / 2) - Math.floor(r0.y + r0.h / 2),
      );
    });
    const closestTo = new Array<number>(rooms.length).fill(0);

    while (connected.size < rooms.length) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < rooms.length; i++) {
        if (connected.has(i)) continue;
        if (minDist[i] < bestDist) {
          bestDist = minDist[i];
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;

      mstEdges.push({ from: closestTo[bestIdx], to: bestIdx });
      connected.add(bestIdx);

      // Update distances for remaining unconnected rooms
      const newR = rooms[bestIdx];
      const newCx = Math.floor(newR.x + newR.w / 2);
      const newCy = Math.floor(newR.y + newR.h / 2);
      for (let i = 0; i < rooms.length; i++) {
        if (connected.has(i)) continue;
        const r = rooms[i];
        const d = Math.hypot(Math.floor(r.x + r.w / 2) - newCx, Math.floor(r.y + r.h / 2) - newCy);
        if (d < minDist[i]) {
          minDist[i] = d;
          closestTo[i] = bestIdx;
        }
      }
    }
  }

  // Carve all MST hallways
  for (const edge of mstEdges) {
    const from = rooms[edge.from];
    const to = rooms[edge.to];
    const fc = { x: Math.floor(from.x + from.w / 2), y: Math.floor(from.y + from.h / 2) };
    const tc = { x: Math.floor(to.x + to.w / 2), y: Math.floor(to.y + to.h / 2) };
    const isSpecial = specialRoomIdxSet.has(edge.from) || specialRoomIdxSet.has(edge.to);
    const zone = getZone(tc, sc);
    const kind = selectHallwayKind(zone, isSpecial);
    const floorType = corridorFloorForZone(zone);
    carveHallway(fc.x, fc.y, tc.x, tc.y, kind, floorType);
  }

  // ── Dead-end rescue connections ───────────────────────────────────────────
  //
  // Leaf rooms (MST degree 1) that are far from the start have only one exit.
  // Walking in and hitting a dead end forces long backtracking through already-
  // cleared areas. For each distant leaf we carve a narrow shortcut to the
  // nearest other regular room, converting the dead end into a loop.

  const mstDegree = new Array<number>(rooms.length).fill(0);
  for (const edge of mstEdges) {
    mstDegree[edge.from]++;
    mstDegree[edge.to]++;
  }
  const mstParentOf = new Map<number, number>();
  for (const edge of mstEdges) {
    mstParentOf.set(edge.to, edge.from);
  }

  const DEADEND_MIN_DIST_FROM_START = 18;
  const DEADEND_SHORTCUT_MIN = 10;
  const DEADEND_SHORTCUT_MAX = 65;

  for (let i = regularRoomStart; i < rooms.length; i++) {
    if (mstDegree[i] !== 1) continue;
    const r = rooms[i];
    const rc = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
    if (Math.hypot(rc.x - sc.x, rc.y - sc.y) < DEADEND_MIN_DIST_FROM_START) continue;

    const parent = mstParentOf.get(i);
    let bestDist = Infinity;
    let bestTargetIdx = -1;

    for (let j = regularRoomStart; j < rooms.length; j++) {
      if (j === i || j === parent) continue;
      const tr = rooms[j];
      const tc = { x: Math.floor(tr.x + tr.w / 2), y: Math.floor(tr.y + tr.h / 2) };
      const dist = Math.hypot(rc.x - tc.x, rc.y - tc.y);
      if (dist >= DEADEND_SHORTCUT_MIN && dist <= DEADEND_SHORTCUT_MAX && dist < bestDist) {
        bestDist = dist;
        bestTargetIdx = j;
      }
    }

    if (bestTargetIdx !== -1) {
      const tr = rooms[bestTargetIdx];
      const tc = { x: Math.floor(tr.x + tr.w / 2), y: Math.floor(tr.y + tr.h / 2) };
      const zone = getZone(tc, sc);
      const floorType = corridorFloorForZone(zone);
      carveHallway(rc.x, rc.y, tc.x, tc.y, 'narrow', floorType);
    }
  }

  // ── Extra loop connections ────────────────────────────────────────────────
  //
  // Adding ~20% more edges on top of the MST creates loops, giving the player
  // shortcuts and alternative routes — making exploration rewarding rather than
  // mandatory backtracking through dead ends.

  const regularRooms = rooms.slice(regularRoomStart);
  const extraTarget = Math.max(1, Math.floor(regularRooms.length * EXTRA_LOOP_RATIO));
  let extraAdded = 0;
  const maxLoopAttempts = extraTarget * LOOP_ATTEMPT_FACTOR;

  for (let attempt = 0; attempt < maxLoopAttempts && extraAdded < extraTarget; attempt++) {
    const r1Idx = randomInt(regularRoomStart, rooms.length - 1);
    const r2Idx = randomInt(regularRoomStart, rooms.length - 1);
    if (r1Idx === r2Idx) continue;

    const r1 = rooms[r1Idx];
    const r2 = rooms[r2Idx];
    const c1 = { x: Math.floor(r1.x + r1.w / 2), y: Math.floor(r1.y + r1.h / 2) };
    const c2 = { x: Math.floor(r2.x + r2.w / 2), y: Math.floor(r2.y + r2.h / 2) };
    const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);

    // Target spatially nearby but not immediately adjacent rooms.
    // Corridors that are too short just look like alcoves; too long = big gray passages.
    if (dist >= EXTRA_LOOP_MIN_DIST && dist <= EXTRA_LOOP_MAX_DIST) {
      const zone = getZone(c2, sc);
      const floorType = corridorFloorForZone(zone);
      // Loop connections are always narrow — they're secondary routes, not main arteries.
      carveHallway(c1.x, c1.y, c2.x, c2.y, 'narrow', floorType);
      extraAdded++;
    }
  }

  // 6. Record spawn locations
  let startTile: Point = { x: 15, y: 15 };
  if (rooms.length > 0) {
    const r = rooms[0];
    startTile = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
  }

  const safeRooms: Array<{ bounds: Rect; centre: Point }> = [];
  for (let i = safeRoomStart; i < safeRoomEnd && i < rooms.length; i++) {
    const sr = rooms[i];
    safeRooms.push({
      bounds: { x: sr.x, y: sr.y, w: sr.w, h: sr.h },
      centre: { x: Math.floor(sr.x + sr.w / 2), y: Math.floor(sr.y + sr.h / 2) },
    });
  }

  const bossRooms: Array<{ bounds: Rect; centre: Point }> = [];
  for (let i = bossRoomStart; i < bossRoomEnd && i < rooms.length; i++) {
    const br = rooms[i];
    bossRooms.push({
      bounds: { x: br.x, y: br.y, w: br.w, h: br.h },
      centre: { x: Math.floor(br.x + br.w / 2), y: Math.floor(br.y + br.h / 2) },
    });
  }

  const questRooms: QuestRoomData[] = [];
  if (rooms.length > questRoomIdx) {
    const qr = rooms[questRoomIdx];
    const qcx = Math.floor(qr.x + qr.w / 2);
    const qcy = Math.floor(qr.y + qr.h / 2);
    const grateTiles: Point[] = [
      { x: qr.x + 2, y: qcy - 2 },
      { x: qr.x + 2, y: qcy + 2 },
      { x: qr.x + qr.w - QUEST_GRATE_WALL_OFFSET, y: qcy - 2 },
      { x: qr.x + qr.w - QUEST_GRATE_WALL_OFFSET, y: qcy + 2 },
    ];
    for (const g of grateTiles) {
      if (g.y >= 0 && g.y < size && g.x >= 0 && g.x < size) {
        grid[g.y][g.x].type = FLOOR_GRATE;
      }
    }
    questRooms.push({
      bounds: { x: qr.x, y: qr.y, w: qr.w, h: qr.h },
      centre: { x: qcx, y: qcy },
      grateTiles,
      entranceTile: { x: qcx, y: qr.y + qr.h - 1 },
      npcTile: { x: qcx, y: qcy },
      woodPileTile: { x: qr.x + 1, y: qr.y + 1 },
    });
  }

  // Spider lab room data
  let spiderLabRoom: SpiderLabRoomData | null = null;
  if (spiderLabRoomIdx >= 0 && rooms.length > spiderLabRoomIdx) {
    const slr = rooms[spiderLabRoomIdx];
    const slcx = Math.floor(slr.x + slr.w / 2);
    const slcy = Math.floor(slr.y + slr.h / 2);

    // Determine which wall the MST hallway enters from so we can place the
    // scientist and computer near the entrance and push the egg + machines far away.
    const slabEdge = mstEdges.find((e) => e.to === spiderLabRoomIdx);
    let entranceWall: 'north' | 'south' | 'east' | 'west' = 'south';
    if (slabEdge !== undefined) {
      const otherRoom = rooms[slabEdge.from];
      const oc = {
        x: Math.floor(otherRoom.x + otherRoom.w / 2),
        y: Math.floor(otherRoom.y + otherRoom.h / 2),
      };
      // L-shape: horizontal at y=oc.y → vertical at x=slcx.
      // If oc.y is within the room's y range, the horizontal leg approaches
      // from east or west.  Otherwise the vertical crosses north/south.
      if (oc.y >= slr.y && oc.y <= slr.y + slr.h - 1) {
        entranceWall = oc.x > slcx ? 'east' : 'west';
      } else {
        entranceWall = oc.y < slr.y ? 'north' : 'south';
      }
    }

    let entranceTile: Point;
    let scientistTile: Point;
    let computerTile: Point;
    let spiderEggTile: Point;
    let lifeMachineTiles: Point[];

    if (entranceWall === 'south') {
      entranceTile = { x: slcx, y: slr.y + slr.h - 1 };
      scientistTile = { x: slcx - 1, y: slr.y + slr.h - LAB_WALL_OFFSET };
      computerTile = { x: slcx + 2, y: slr.y + slr.h - LAB_EGG_NEAR_WALL };
      spiderEggTile = { x: slcx, y: slr.y + LAB_EGG_NEAR_WALL };
      lifeMachineTiles = [
        { x: slr.x + 2, y: slr.y + 2 },
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + 2 },
        { x: slcx - LAB_MACHINE_SPREAD, y: slr.y + LAB_MACHINE_NS_NEAR_ROW },
        { x: slcx + LAB_MACHINE_SPREAD, y: slr.y + LAB_MACHINE_NS_NEAR_ROW },
        { x: slr.x + 2, y: slr.y + LAB_MACHINE_NS_FAR_ROW },
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + LAB_MACHINE_NS_FAR_ROW },
      ];
    } else if (entranceWall === 'north') {
      entranceTile = { x: slcx, y: slr.y };
      scientistTile = { x: slcx - 1, y: slr.y + 2 };
      computerTile = { x: slcx + 2, y: slr.y + LAB_WALL_OFFSET };
      spiderEggTile = { x: slcx, y: slr.y + slr.h - LAB_EGG_FAR_WALL };
      lifeMachineTiles = [
        { x: slr.x + 2, y: slr.y + slr.h - LAB_WALL_OFFSET },
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + slr.h - LAB_WALL_OFFSET },
        { x: slcx - LAB_MACHINE_SPREAD, y: slr.y + slr.h - LAB_MACHINE_NS_NEAR_FROM_FAR },
        { x: slcx + LAB_MACHINE_SPREAD, y: slr.y + slr.h - LAB_MACHINE_NS_NEAR_FROM_FAR },
        { x: slr.x + 2, y: slr.y + slr.h - LAB_MACHINE_NS_FAR_FROM_FAR },
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + slr.h - LAB_MACHINE_NS_FAR_FROM_FAR },
      ];
    } else if (entranceWall === 'east') {
      entranceTile = { x: slr.x + slr.w - 1, y: slcy };
      scientistTile = { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slcy - 1 };
      computerTile = { x: slr.x + slr.w - LAB_EGG_FAR_WALL, y: slcy + 2 };
      spiderEggTile = { x: slr.x + LAB_EGG_NEAR_WALL, y: slcy };
      lifeMachineTiles = [
        { x: slr.x + 2, y: slr.y + 2 },
        { x: slr.x + 2, y: slr.y + slr.h - LAB_WALL_OFFSET },
        { x: slr.x + LAB_MACHINE_NS_NEAR_FROM_FAR, y: slcy - LAB_MACHINE_SPREAD },
        { x: slr.x + LAB_MACHINE_NS_NEAR_FROM_FAR, y: slcy + LAB_MACHINE_SPREAD },
        { x: slr.x + LAB_MACHINE_EW_FAR_COL, y: slr.y + 2 },
        { x: slr.x + LAB_MACHINE_EW_FAR_COL, y: slr.y + slr.h - LAB_WALL_OFFSET },
      ];
    } else {
      // west
      entranceTile = { x: slr.x, y: slcy };
      scientistTile = { x: slr.x + 2, y: slcy - 1 };
      computerTile = { x: slr.x + LAB_EGG_NEAR_WALL, y: slcy + 2 };
      spiderEggTile = { x: slr.x + slr.w - LAB_EGG_FAR_WALL, y: slcy };
      lifeMachineTiles = [
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + 2 },
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + slr.h - LAB_WALL_OFFSET },
        { x: slr.x + slr.w - LAB_MACHINE_EW_NEAR_FROM_FAR, y: slcy - LAB_MACHINE_SPREAD },
        { x: slr.x + slr.w - LAB_MACHINE_EW_NEAR_FROM_FAR, y: slcy + LAB_MACHINE_SPREAD },
        { x: slr.x + slr.w - LAB_MACHINE_EW_FAR_FROM_FAR, y: slr.y + 2 },
        { x: slr.x + slr.w - LAB_MACHINE_EW_FAR_FROM_FAR, y: slr.y + slr.h - LAB_WALL_OFFSET },
      ];
    }

    spiderLabRoom = {
      bounds: { x: slr.x, y: slr.y, w: slr.w, h: slr.h },
      centre: { x: slcx, y: slcy },
      entranceTile,
      scientistTile,
      computerTile,
      spiderEggTile,
      lifeMachineTiles,
    };
  }

  // 7. Stairwells
  const stairwellTiles: Point[] = [];
  if (rooms.length > 0) {
    const MIN_STAIRWELL_DIST = 20;
    const farRooms = regularRooms.filter((r) => {
      const rc = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
      return Math.hypot(rc.x - sc.x, rc.y - sc.y) >= MIN_STAIRWELL_DIST;
    });
    farRooms.sort((a, b) => {
      const da = Math.hypot(Math.floor(a.x + a.w / 2) - sc.x, Math.floor(a.y + a.h / 2) - sc.y);
      const db = Math.hypot(Math.floor(b.x + b.w / 2) - sc.x, Math.floor(b.y + b.h / 2) - sc.y);
      return db - da;
    });
    const stairwellCount =
      numStairwellsOverride ?? Math.max(1, Math.floor(regularRooms.length / ROOMS_PER_STAIRWELL));
    const step = Math.max(1, Math.floor(farRooms.length / stairwellCount));
    for (let i = 0; i < stairwellCount; i++) {
      const r = farRooms[i * step];
      stairwellTiles.push({
        x: Math.floor(r.x + r.w / 2),
        y: Math.floor(r.y + r.h / 2),
      });
    }
  }

  const stairwellBlockedSet = new Set<string>();
  for (const s of stairwellTiles) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        stairwellBlockedSet.add(`${s.x + dx},${s.y + dy}`);
      }
    }
  }

  // ── Room decorations ──────────────────────────────────────────────────────

  for (let i = regularRoomStart; i < rooms.length; i++) {
    const r = rooms[i];
    const roomCentre: Point = {
      x: Math.floor(r.x + r.w / 2),
      y: Math.floor(r.y + r.h / 2),
    };
    const zone = getZone(roomCentre, sc);

    // Torches always in 2 diagonally-opposite corners
    const corners =
      i % 2 === 0
        ? [
            { x: r.x + 1, y: r.y + 1 },
            { x: r.x + r.w - 2, y: r.y + r.h - 2 },
          ]
        : [
            { x: r.x + r.w - 2, y: r.y + 1 },
            { x: r.x + 1, y: r.y + r.h - 2 },
          ];
    for (const c of corners) {
      if (grid[c.y]?.[c.x]?.type === r.floor && !stairwellBlockedSet.has(`${c.x},${c.y}`)) {
        grid[c.y][c.x].type = TORCH;
      }
    }

    // Large rooms get barrel pillars that create lanes and break up open space.
    // Placed near inner corners, 3 tiles from each wall.
    if (r.w >= PILLAR_MIN_ROOM_W && r.h >= PILLAR_MIN_ROOM_H) {
      const pillarPositions = [
        { x: r.x + DECO_INNER_OFFSET, y: r.y + DECO_INNER_OFFSET },
        { x: r.x + r.w - DECO_NEAR_FAR_OFFSET, y: r.y + DECO_INNER_OFFSET },
      ];
      for (const p of pillarPositions) {
        if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`)) {
          grid[p.y][p.x].type = BARREL;
        }
      }
    }

    // Vignette chance scales with zone depth
    const useVignette = Math.random() < VIGNETTE_CHANCE[zone];
    if (useVignette) {
      const vignette = pickVignette(zone, r);
      if (vignette !== null) {
        stampVignette(grid, r, vignette, size, stairwellBlockedSet);
        continue;
      }
    }

    // ── Cycle-based decoration (zone-aware) ──────────────────────────────
    const cycleLen = zone === 'entrance' ? ENTRANCE_CYCLE_LEN : STANDARD_CYCLE_LEN;
    const cycle = (i - regularRoomStart) % cycleLen;

    if (cycle === 0 && r.w >= CYCLE0_MIN_W) {
      const positions = [
        { x: r.x + 2, y: r.y + 1 },
        { x: r.x + r.w - DECO_INNER_OFFSET, y: r.y + 1 },
      ];
      if (zone !== 'entrance' && r.w >= CYCLE0_EXTRA_BARREL_MIN_W)
        positions.push({ x: r.x + CYCLE0_EXTRA_BARREL_DX, y: r.y + 1 });
      for (const p of positions) {
        if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
          grid[p.y][p.x].type = BARREL;
      }
    }

    if (cycle === 1 && r.w >= CYCLE1_MIN_W) {
      const positions = [
        { x: r.x + 2, y: r.y + r.h - 2 },
        { x: r.x + r.w - DECO_INNER_OFFSET, y: r.y + r.h - 2 },
      ];
      for (const p of positions) {
        if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
          grid[p.y][p.x].type = BARREL_SIDE;
      }
      if (zone !== 'entrance') {
        const bp = { x: r.x + 2, y: r.y + r.h - DECO_INNER_OFFSET };
        if (grid[bp.y]?.[bp.x]?.type === r.floor && !stairwellBlockedSet.has(`${bp.x},${bp.y}`))
          grid[bp.y][bp.x].type = BONES;
      }
    }

    if (cycle === 2) {
      const cx2 = i % 2 === 0 ? r.x + r.w - 2 : r.x + 1;
      const cy2 = r.y + 1;
      if (grid[cy2]?.[cx2]?.type === r.floor && !stairwellBlockedSet.has(`${cx2},${cy2}`))
        grid[cy2][cx2].type = CRATE;
      const cx3 = cx2 + (i % 2 === 0 ? -1 : 1);
      if (grid[cy2]?.[cx3]?.type === r.floor && !stairwellBlockedSet.has(`${cx3},${cy2}`))
        grid[cy2][cx3].type = CRATE;
    }

    if (cycle === DECO_CYCLE_BRAZIER && r.w >= CYCLE3_MIN_SIZE && r.h >= CYCLE3_MIN_SIZE) {
      const bx = Math.floor(r.x + r.w / 2);
      const by = Math.floor(r.y + r.h / 2);
      if (grid[by]?.[bx]?.type === r.floor && !stairwellBlockedSet.has(`${bx},${by}`))
        grid[by][bx].type = BRAZIER;
      if (zone === 'deep') {
        const ring = [
          { x: bx - 1, y: by },
          { x: bx + 1, y: by },
          { x: bx, y: by - 1 },
          { x: bx, y: by + 1 },
        ];
        for (const p of ring) {
          if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
            grid[p.y][p.x].type = BONES;
        }
      }
    }

    if (cycle === DECO_CYCLE_CORNER_MIX && r.w >= CYCLE4_MIN_W) {
      const positions: Array<{ x: number; y: number; type: number }> = [
        { x: r.x + 1, y: r.y + 1, type: BARREL },
        { x: r.x + 2, y: r.y + 1, type: CRATE },
        { x: r.x + r.w - 2, y: r.y + 1, type: CRATE },
      ];
      for (const p of positions) {
        if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
          grid[p.y][p.x].type = p.type;
      }
    }

    if (cycle === DECO_CYCLE_BONES) {
      const boneCount = zone === 'deep' ? CYCLE5_DEEP_BONE_COUNT : CYCLE5_BONE_COUNT;
      const spots = [
        { x: r.x + 2, y: r.y + 2 },
        { x: r.x + r.w - DECO_INNER_OFFSET, y: r.y + 2 },
        { x: r.x + 2, y: r.y + r.h - DECO_INNER_OFFSET },
        { x: r.x + r.w - DECO_INNER_OFFSET, y: r.y + r.h - DECO_INNER_OFFSET },
      ].slice(0, boneCount);
      for (const p of spots) {
        if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
          grid[p.y][p.x].type = BONES;
      }
    }

    if (cycle === DECO_CYCLE_SHELVES && r.w >= CYCLE6_MIN_W) {
      const shelfY = r.y + 1;
      for (let sx = r.x + 2; sx <= r.x + CYCLE6_SHELF_DX_END && sx < r.x + r.w - 2; sx++) {
        if (grid[shelfY]?.[sx]?.type === r.floor && !stairwellBlockedSet.has(`${sx},${shelfY}`))
          grid[shelfY][sx].type = BOOKSHELF;
      }
    }

    if (cycle === DECO_CYCLE_CLUSTER) {
      const clusters: Array<Array<{ x: number; y: number; type: number }>> = [
        [
          { x: r.x + 1, y: r.y + r.h - 2, type: BARREL_SIDE },
          { x: r.x + 2, y: r.y + r.h - 2, type: CRATE },
        ],
        [
          { x: r.x + r.w - 2, y: r.y + 1, type: BARREL },
          { x: r.x + r.w - DECO_INNER_OFFSET, y: r.y + 1, type: BARREL_SIDE },
        ],
      ];
      for (const cluster of clusters) {
        for (const p of cluster) {
          if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
            grid[p.y][p.x].type = p.type;
        }
      }
    }
  }

  // 9. Mob spawn points
  const mobSpawnPoints = regularRooms.map((r) => ({
    x: Math.floor(r.x + r.w / 2),
    y: Math.floor(r.y + r.h / 2),
    w: r.w,
    h: r.h,
  }));

  // Select treasure rooms from eligible regular rooms — 5% of total rooms, at least 1
  const MIN_ROOM_SIZE = 7;
  const treasureRoomTarget = Math.max(1, Math.round(regularRooms.length * TREASURE_ROOM_RATIO));

  const eligibleRegularRooms = regularRooms.filter(
    (r) => r.w >= MIN_ROOM_SIZE && r.h >= MIN_ROOM_SIZE,
  );
  // Fisher-Yates shuffle for a uniform distribution
  const shuffledEligible = [...eligibleRegularRooms];
  for (let i = shuffledEligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledEligible[i], shuffledEligible[j]] = [shuffledEligible[j], shuffledEligible[i]];
  }
  const selectedTreasureRooms = shuffledEligible.slice(0, treasureRoomTarget);

  const treasureRooms: TreasureRoomData[] = selectedTreasureRooms.map((r) => {
    const cx = Math.floor(r.x + r.w / 2);
    const cy = Math.floor(r.y + r.h / 2);
    // Clear the chest tile so decorations stamped earlier don't overlap the chest.
    grid[cy][cx].type = r.floor;
    return {
      bounds: { x: r.x, y: r.y, w: r.w, h: r.h },
      centre: { x: cx, y: cy },
    };
  });

  // 10. Rat spawn points in hallway tiles
  const maxHallwaySpawns = Math.round(HALLWAY_SPAWNS_SCALE * (size / SIZE_SCALE_BASE) ** 2);
  const roomCenters = rooms.map((r) => ({
    x: Math.floor(r.x + r.w / 2),
    y: Math.floor(r.y + r.h / 2),
  }));
  const MIN_FROM_ROOM = 5;
  const nearRoomSet = new Set<number>();
  for (const centre of roomCenters) {
    for (let dy = -MIN_FROM_ROOM; dy <= MIN_FROM_ROOM; dy++) {
      for (let dx = -MIN_FROM_ROOM; dx <= MIN_FROM_ROOM; dx++) {
        if (Math.hypot(dx, dy) <= MIN_FROM_ROOM) {
          nearRoomSet.add((centre.y + dy) * size + (centre.x + dx));
        }
      }
    }
  }
  const validHallway = hallwayTiles.filter((t) => !nearRoomSet.has(t.y * size + t.x));
  for (let i = validHallway.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [validHallway[i], validHallway[j]] = [validHallway[j], validHallway[i]];
  }
  const chosen: Array<{ x: number; y: number }> = [];
  for (const t of validHallway) {
    if (chosen.length >= maxHallwaySpawns) break;
    if (chosen.every((c) => Math.hypot(t.x - c.x, t.y - c.y) >= HALLWAY_SPAWN_MIN_GAP))
      chosen.push(t);
  }
  const hallwaySpawnPoints = chosen;

  // 11. Arena
  const ARENA_RADIUS = 15;
  const buildingEntries: Array<{ doorTile: Point; name: string; type: 'arena' }> = [];
  const arenaExteriors: ArenaExterior[] = [];

  if (hasArena && rooms.length > 0) {
    const startCentre = sc;
    let arenaPlaced = false;

    for (let attempt = 0; attempt < ARENA_PLACEMENT_ATTEMPTS && !arenaPlaced; attempt++) {
      const angle =
        (attempt / ARENA_PLACEMENT_ATTEMPTS) * Math.PI * 2 + Math.random() * ARENA_ANGLE_JITTER;
      const dist = ARENA_MIN_DIST + Math.random() * ARENA_DIST_VARIANCE;
      const acx = Math.round(startCentre.x + Math.cos(angle) * dist);
      const acy = Math.round(startCentre.y + Math.sin(angle) * dist);

      if (
        acx - ARENA_RADIUS - ARENA_CLEARANCE < BORDER ||
        acx + ARENA_RADIUS + ARENA_CLEARANCE >= size - BORDER ||
        acy - ARENA_RADIUS - ARENA_CLEARANCE < BORDER ||
        acy + ARENA_RADIUS + ARENA_CLEARANCE >= size - BORDER
      )
        continue;

      const overlapsSpecial = rooms.some((r, idx) => {
        if (!specialRoomIdxSet.has(idx)) return false;
        const closestX = clamp(acx, r.x, r.x + r.w - 1);
        const closestY = clamp(acy, r.y, r.y + r.h - 1);
        return Math.hypot(acx - closestX, acy - closestY) < ARENA_RADIUS + ARENA_CLEARANCE;
      });
      if (overlapsSpecial) continue;

      const ARENA_WALL_THICKNESS = 2;
      for (let dy = -ARENA_RADIUS; dy <= ARENA_RADIUS; dy++) {
        for (let dx = -ARENA_RADIUS; dx <= ARENA_RADIUS; dx++) {
          const rad = Math.hypot(dx, dy);
          if (rad <= ARENA_RADIUS) {
            const gx = acx + dx;
            const gy = acy + dy;
            if (gy >= 0 && gy < size && gx >= 0 && gx < size) {
              grid[gy][gx].type =
                rad > ARENA_RADIUS - ARENA_WALL_THICKNESS ? METAL_WALL : ARENA_FLOOR;
            }
          }
        }
      }

      const doorY = acy + ARENA_RADIUS;
      const doorX = acx;
      for (let wy = 0; wy < ARENA_WALL_THICKNESS; wy++) {
        const ty = doorY - wy;
        if (ty >= 0 && ty < size) {
          grid[ty][doorX - 1].type = FloorTypeValue.concrete;
          grid[ty][doorX].type = FloorTypeValue.concrete;
        }
      }

      // Carve a 2-tile-wide walkable ring just outside the arena wall so the arena
      // never severs existing corridors — every part of the dungeon stays reachable.
      for (let ry = -(ARENA_RADIUS + 2); ry <= ARENA_RADIUS + 2; ry++) {
        for (let rx = -(ARENA_RADIUS + 2); rx <= ARENA_RADIUS + 2; rx++) {
          const rad = Math.hypot(rx, ry);
          if (rad > ARENA_RADIUS && rad <= ARENA_RADIUS + 2) {
            const gx = acx + rx;
            const gy = acy + ry;
            if (gy >= 0 && gy < size && gx >= 0 && gx < size) {
              grid[gy][gx].type = FloorTypeValue.concrete;
            }
          }
        }
      }

      const nearestRoom = rooms.reduce((best, r) => {
        const rcx = Math.floor(r.x + r.w / 2);
        const rcy = Math.floor(r.y + r.h / 2);
        const d = Math.hypot(acx - rcx, acy - rcy);
        const bd = Math.hypot(
          acx - Math.floor(best.x + best.w / 2),
          acy - Math.floor(best.y + best.h / 2),
        );
        return d < bd ? r : best;
      }, rooms[0]);

      if (doorY + 1 < size) {
        grid[doorY + 1][doorX - 1].type = FloorTypeValue.concrete;
        grid[doorY + 1][doorX].type = FloorTypeValue.concrete;
      }

      const pivotX = Math.min(acx + ARENA_RADIUS + 2, size - BORDER - 1);
      const pivotY = doorY + 1;
      carveHallway(doorX, pivotY, pivotX, pivotY, 'standard', FloorTypeValue.concrete);
      carveHallway(
        pivotX,
        pivotY,
        Math.floor(nearestRoom.x + nearestRoom.w / 2),
        Math.floor(nearestRoom.y + nearestRoom.h / 2),
        'standard',
        FloorTypeValue.concrete,
      );

      buildingEntries.push({
        doorTile: { x: doorX, y: doorY },
        name: 'The Iron Colosseum',
        type: 'arena',
      });
      arenaExteriors.push({
        centre: { x: acx, y: acy },
        radius: ARENA_RADIUS,
        doorTile: { x: doorX, y: doorY },
        stairwellTile: { x: acx - 1, y: acy - 1 },
      });
      arenaPlaced = true;
    }
  }

  const filteredMobSpawns =
    arenaExteriors.length > 0
      ? mobSpawnPoints.filter((p) => {
          const a = arenaExteriors[0];
          return Math.hypot(p.x - a.centre.x, p.y - a.centre.y) > ARENA_RADIUS + 2;
        })
      : mobSpawnPoints;

  const filteredStairwells =
    arenaExteriors.length > 0
      ? stairwellTiles.filter((p) => {
          const a = arenaExteriors[0];
          return Math.hypot(p.x - a.centre.x, p.y - a.centre.y) > ARENA_RADIUS + 2;
        })
      : stairwellTiles;

  return {
    grid,
    startTile,
    safeRooms,
    bossRooms,
    questRooms,
    treasureRooms,
    spiderLabRoom,
    mobSpawnPoints: filteredMobSpawns,
    hallwaySpawnPoints,
    stairwellTiles: filteredStairwells,
    buildingEntries,
    arenaExteriors,
  };
}
