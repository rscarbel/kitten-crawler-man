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
} from './tileTypes';
import { randomFromArray, randomInt, clamp } from '../utils';

type Room = { x: number; y: number; w: number; h: number; floor: number };
type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

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

export interface DungeonData {
  grid: TileContent[][];
  startTile: Point;
  safeRooms: Array<{ bounds: Rect; centre: Point }>;
  bossRooms: Array<{ bounds: Rect; centre: Point }>;
  questRooms: QuestRoomData[];
  mobSpawnPoints: Array<Point & { w: number; h: number }>;
  hallwaySpawnPoints: Point[];
  stairwellTiles: Point[];
  buildingEntries: Array<{ doorTile: Point; name: string; type: 'arena' }>;
  arenaExteriors: ArenaExterior[];
}

/** Map boss type string to the floor tile constant for that boss's room. */
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

export function generateDungeon(
  size: number,
  numBossRooms: number,
  numSafeRooms: number,
  numStairwellsOverride?: number,
  hasArena = false,
  bossTypes: string[] = [],
): DungeonData {
  const BORDER = 5;
  const DUNGEON_FLOORS = [
    FloorTypeValue.concrete,
    FloorTypeValue.tile_floor,
    FloorTypeValue.carpet,
    FloorTypeValue.wood,
  ];

  // 1. Fill everything with wall tiles
  const grid: TileContent[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.wall,
    })),
  );

  // 2. Void border around the outside (renders as pure black, not walkable)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (y < BORDER || y >= size - BORDER || x < BORDER || x >= size - BORDER) {
        grid[y][x].type = VOID_TYPE;
      }
    }
  }

  // 3. Room carving helper
  const carveRoom = (r: Room) => {
    for (let ry = r.y; ry < r.y + r.h; ry++) {
      for (let rx = r.x; rx < r.x + r.w; rx++) {
        grid[ry][rx].type = r.floor;
      }
    }
  };

  // Tiles that were wall and got carved into hallway concrete — used for rat placement.
  const hallwayTiles: Array<{ x: number; y: number }> = [];

  // 4. L-shaped 3-tile-wide hallway carver
  const carveHallway = (x1: number, y1: number, x2: number, y2: number) => {
    // Horizontal leg first (y stays at y1)
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (let hx = minX; hx <= maxX; hx++) {
      for (let off = -1; off <= 1; off++) {
        const hy = y1 + off;
        if (hy >= BORDER && hy < size - BORDER && grid[hy][hx].type === FloorTypeValue.wall) {
          grid[hy][hx].type = FloorTypeValue.concrete;
          hallwayTiles.push({ x: hx, y: hy });
        }
      }
    }
    // Vertical leg (x stays at x2)
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (let hy = minY; hy <= maxY; hy++) {
      for (let off = -1; off <= 1; off++) {
        const hx = x2 + off;
        if (hx >= BORDER && hx < size - BORDER && grid[hy][hx].type === FloorTypeValue.wall) {
          grid[hy][hx].type = FloorTypeValue.concrete;
          hallwayTiles.push({ x: hx, y: hy });
        }
      }
    }
  };

  // 5. Place rooms
  const rooms: Room[] = [];
  const MIN_W = 8,
    MAX_W = 16;
  const MIN_H = 7,
    MAX_H = 14;
  const GAP = 3; // minimum tile gap between room edges

  // rooms[0]=start, rooms[1..numSafeRooms]=safe, rooms[safeRoomEnd..bossRoomEnd-1]=boss,
  // rooms[bossRoomEnd]=quest room (1 slot reserved)
  const safeRoomStart = 1;
  const safeRoomEnd = 1 + numSafeRooms; // exclusive
  const bossRoomStart = safeRoomEnd;
  const bossRoomEnd = safeRoomEnd + numBossRooms;
  const questRoomIdx = bossRoomEnd; // exactly 1 quest room
  const regularRoomStart = questRoomIdx + 1;

  // Scale room count and attempts proportionally to map area.
  // At size=100: 15 rooms, ~120 attempts.  At size=450: ~304 rooms, ~2432 attempts.
  const maxRooms = Math.round(15 * (size / 100) ** 2);
  const maxAttempts = Math.max(maxRooms * 8, 80);

  // Fixed max-distance constraints for special rooms (in tiles from start centre).
  const SAFE_MAX_DIST = 50;
  const BOSS_MAX_DIST = 80;
  const SAFE_MIN_SEPARATION = 18; // safe rooms must be this far apart from each other

  for (let attempt = 0; attempt < maxAttempts && rooms.length < maxRooms; attempt++) {
    const isSafeRoom = rooms.length >= safeRoomStart && rooms.length < safeRoomEnd;
    const isBossRoom = rooms.length >= bossRoomStart && rooms.length < bossRoomEnd;
    const isQuestRoom = rooms.length === questRoomIdx;
    const w = isBossRoom ? 22 : isQuestRoom ? 14 : randomInt(MIN_W, MAX_W);
    const h = isBossRoom ? 18 : isQuestRoom ? 12 : randomInt(MIN_H, MAX_H);
    const x = randomInt(BORDER + 1, size - BORDER - w - 2);
    const y = randomInt(BORDER + 1, size - BORDER - h - 2);

    const cx = Math.floor(x + w / 2);
    const cy = Math.floor(y + h / 2);

    const overlaps = rooms.some(
      (r) => x < r.x + r.w + GAP && x + w + GAP > r.x && y < r.y + r.h + GAP && y + h + GAP > r.y,
    );

    // Boss rooms must be at least 60 tiles apart from each other
    const tooCloseToBoss =
      isBossRoom &&
      rooms.slice(bossRoomStart, bossRoomEnd).some((r) => {
        const rc = {
          x: Math.floor(r.x + r.w / 2),
          y: Math.floor(r.y + r.h / 2),
        };
        return Math.hypot(cx - rc.x, cy - rc.y) < 60;
      });

    // Safe rooms must be separated from each other
    const tooCloseToSafeRoom =
      isSafeRoom &&
      rooms.slice(safeRoomStart, safeRoomEnd).some((r) => {
        const rc = {
          x: Math.floor(r.x + r.w / 2),
          y: Math.floor(r.y + r.h / 2),
        };
        return Math.hypot(cx - rc.x, cy - rc.y) < SAFE_MIN_SEPARATION;
      });

    // Safe rooms, boss rooms, and quest rooms must stay within a fixed tile-radius of start.
    const QUEST_MAX_DIST = 60;
    let tooFarFromStart = false;
    if (rooms.length > 0) {
      const sc = {
        x: Math.floor(rooms[0].x + rooms[0].w / 2),
        y: Math.floor(rooms[0].y + rooms[0].h / 2),
      };
      const maxDist = isSafeRoom
        ? SAFE_MAX_DIST
        : isBossRoom
          ? BOSS_MAX_DIST
          : isQuestRoom
            ? QUEST_MAX_DIST
            : Infinity;
      if (Math.hypot(cx - sc.x, cy - sc.y) > maxDist) tooFarFromStart = true;
    }

    if (!overlaps && !tooCloseToBoss && !tooCloseToSafeRoom && !tooFarFromStart) {
      // 0-indexed boss room index
      const bossIdx = rooms.length - bossRoomStart;
      const floor = isSafeRoom
        ? SAFE_ROOM_FLOOR
        : isBossRoom
          ? bossFloorForType(bossTypes[bossIdx] ?? '')
          : isQuestRoom
            ? FloorTypeValue.tile_floor
            : randomFromArray(DUNGEON_FLOORS);
      const room: Room = { x, y, w, h, floor };
      rooms.push(room);
      carveRoom(room);

      // Connect to previous room with a hallway
      if (rooms.length > 1) {
        const prev = rooms[rooms.length - 2];
        carveHallway(
          Math.floor(prev.x + prev.w / 2),
          Math.floor(prev.y + prev.h / 2),
          Math.floor(x + w / 2),
          Math.floor(y + h / 2),
        );
      }
    }
  }

  // 6. Record spawn locations
  let startTile: Point = { x: 15, y: 15 };
  if (rooms.length > 0) {
    const r = rooms[0];
    startTile = {
      x: Math.floor(r.x + r.w / 2),
      y: Math.floor(r.y + r.h / 2),
    };
  }

  // Record all safe rooms (rooms[1..numSafeRooms])
  const safeRooms: Array<{ bounds: Rect; centre: Point }> = [];
  for (let i = safeRoomStart; i < safeRoomEnd && i < rooms.length; i++) {
    const sr = rooms[i];
    safeRooms.push({
      bounds: { x: sr.x, y: sr.y, w: sr.w, h: sr.h },
      centre: {
        x: Math.floor(sr.x + sr.w / 2),
        y: Math.floor(sr.y + sr.h / 2),
      },
    });
  }
  // Record all boss rooms (rooms[bossRoomStart..bossRoomEnd-1])
  const bossRooms: Array<{ bounds: Rect; centre: Point }> = [];
  for (let i = bossRoomStart; i < bossRoomEnd && i < rooms.length; i++) {
    const br = rooms[i];
    bossRooms.push({
      bounds: { x: br.x, y: br.y, w: br.w, h: br.h },
      centre: {
        x: Math.floor(br.x + br.w / 2),
        y: Math.floor(br.y + br.h / 2),
      },
    });
  }

  // Record quest room and carve grate tiles
  const questRooms: QuestRoomData[] = [];
  if (rooms.length > questRoomIdx) {
    const qr = rooms[questRoomIdx];
    const qcx = Math.floor(qr.x + qr.w / 2);
    const qcy = Math.floor(qr.y + qr.h / 2);

    // 4 grate tiles placed symmetrically — 2 tiles inward from walls, near each cardinal edge
    const grateTiles: Point[] = [
      { x: qr.x + 2, y: qcy - 2 }, // left-upper
      { x: qr.x + 2, y: qcy + 2 }, // left-lower
      { x: qr.x + qr.w - 3, y: qcy - 2 }, // right-upper
      { x: qr.x + qr.w - 3, y: qcy + 2 }, // right-lower
    ];
    for (const g of grateTiles) {
      if (g.y >= 0 && g.y < size && g.x >= 0 && g.x < size) {
        grid[g.y][g.x].type = FLOOR_GRATE;
      }
    }

    // Wood pile in the top-left corner of the room interior
    const woodPileTile: Point = { x: qr.x + 1, y: qr.y + 1 };

    // NPC at dead centre
    const npcTile: Point = { x: qcx, y: qcy };

    // Entrance at bottom-centre of room (already open via hallway carving)
    const entranceTile: Point = { x: qcx, y: qr.y + qr.h - 1 };

    questRooms.push({
      bounds: { x: qr.x, y: qr.y, w: qr.w, h: qr.h },
      centre: { x: qcx, y: qcy },
      grateTiles,
      entranceTile,
      npcTile,
      woodPileTile,
    });
  }

  // Place torches and barrels in regular rooms for visual variety.
  // Torches go at 2 opposite corners (alternated by room index).
  // Every 3rd room also gets barrels along the top wall.
  for (let i = regularRoomStart; i < rooms.length; i++) {
    const r = rooms[i];
    // Pick 2 diagonally-opposite corners, alternating by room index so not all rooms match
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
      if (grid[c.y]?.[c.x]?.type === r.floor) {
        grid[c.y][c.x].type = TORCH;
      }
    }
    // Barrels in every 3rd room, near the top wall
    if ((i - regularRoomStart) % 3 === 1 && r.w >= 10) {
      const barrelPositions = [
        { x: r.x + 2, y: r.y + 1 },
        { x: r.x + r.w - 3, y: r.y + 1 },
      ];
      for (const bp of barrelPositions) {
        if (grid[bp.y]?.[bp.x]?.type === r.floor) {
          grid[bp.y][bp.x].type = BARREL;
        }
      }
    }
  }

  // Mob spawn points skip start, safe, boss, and quest rooms
  const mobSpawnPoints = rooms.slice(regularRoomStart).map((r) => ({
    x: Math.floor(r.x + r.w / 2),
    y: Math.floor(r.y + r.h / 2),
    w: r.w,
    h: r.h,
  }));

  // 7. Place stairwells: 1 per 50 regular rooms (min 1), in rooms far from start.
  const stairwellTiles: Point[] = [];
  if (rooms.length > 0) {
    const startCenter = {
      x: Math.floor(rooms[0].x + rooms[0].w / 2),
      y: Math.floor(rooms[0].y + rooms[0].h / 2),
    };
    const MIN_STAIRWELL_DIST = 20; // tiles — must be this far from start
    const regularRooms = rooms.slice(bossRoomEnd);
    const farRooms = regularRooms.filter((r) => {
      const rc = {
        x: Math.floor(r.x + r.w / 2),
        y: Math.floor(r.y + r.h / 2),
      };
      return Math.hypot(rc.x - startCenter.x, rc.y - startCenter.y) >= MIN_STAIRWELL_DIST;
    });
    // Sort farthest-first so stairwells are spread across the far reaches
    farRooms.sort((a, b) => {
      const da = Math.hypot(
        Math.floor(a.x + a.w / 2) - startCenter.x,
        Math.floor(a.y + a.h / 2) - startCenter.y,
      );
      const db = Math.hypot(
        Math.floor(b.x + b.w / 2) - startCenter.x,
        Math.floor(b.y + b.h / 2) - startCenter.y,
      );
      return db - da;
    });
    const stairwellCount =
      numStairwellsOverride ?? Math.max(1, Math.floor(regularRooms.length / 50));
    // Pick every N-th room from the sorted list to spread them out
    const step = Math.max(1, Math.floor(farRooms.length / stairwellCount));
    for (let i = 0; i < stairwellCount; i++) {
      const r = farRooms[i * step];
      stairwellTiles.push({
        x: Math.floor(r.x + r.w / 2),
        y: Math.floor(r.y + r.h / 2),
      });
    }
  }

  // 9. Pick rat spawn points: hallway tiles at least 5 tiles from every room centre.
  // Scale the max rat count proportionally to map area (same density as the base map).
  const maxHallwaySpawns = Math.round(10 * (size / 100) ** 2);

  const roomCenters = rooms.map((r) => ({
    x: Math.floor(r.x + r.w / 2),
    y: Math.floor(r.y + r.h / 2),
  }));
  const MIN_FROM_ROOM = 5;

  // Build a fast lookup of "near-room" tiles to avoid O(tiles × rooms) filtering.
  const nearRoomSet = new Set<number>();
  for (const c of roomCenters) {
    for (let dy = -MIN_FROM_ROOM; dy <= MIN_FROM_ROOM; dy++) {
      for (let dx = -MIN_FROM_ROOM; dx <= MIN_FROM_ROOM; dx++) {
        if (Math.hypot(dx, dy) <= MIN_FROM_ROOM) {
          nearRoomSet.add((c.y + dy) * size + (c.x + dx));
        }
      }
    }
  }
  const validHallway = hallwayTiles.filter((t) => !nearRoomSet.has(t.y * size + t.x));

  // Fisher-Yates shuffle then pick up to maxHallwaySpawns tiles with ≥3-tile separation.
  for (let i = validHallway.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [validHallway[i], validHallway[j]] = [validHallway[j], validHallway[i]];
  }
  const chosen: Array<{ x: number; y: number }> = [];
  for (const t of validHallway) {
    if (chosen.length >= maxHallwaySpawns) break;
    if (chosen.every((c) => Math.hypot(t.x - c.x, t.y - c.y) >= 3)) chosen.push(t);
  }
  const hallwaySpawnPoints = chosen;

  // 10. Place a circular metal arena structure in the dungeon.
  // Attempt to find a position 10–90 tiles from start, away from other boss rooms.
  const ARENA_RADIUS = 15;
  const buildingEntries: Array<{
    doorTile: Point;
    name: string;
    type: 'arena';
  }> = [];
  const arenaExteriors: ArenaExterior[] = [];

  if (hasArena && rooms.length > 0) {
    const startCentre = {
      x: Math.floor(rooms[0].x + rooms[0].w / 2),
      y: Math.floor(rooms[0].y + rooms[0].h / 2),
    };

    let arenaPlaced = false;
    // Indices of special rooms that the arena must not overlap
    const specialRoomIndices = new Set<number>();
    specialRoomIndices.add(0); // start room
    for (let i = safeRoomStart; i < safeRoomEnd && i < rooms.length; i++) specialRoomIndices.add(i);
    for (let i = bossRoomStart; i < bossRoomEnd && i < rooms.length; i++) specialRoomIndices.add(i);

    // Sample candidate positions in a ring 20–90 tiles from start
    for (let attempt = 0; attempt < 800 && !arenaPlaced; attempt++) {
      const angle = (attempt / 800) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 20 + Math.random() * 70;
      const acx = Math.round(startCentre.x + Math.cos(angle) * dist);
      const acy = Math.round(startCentre.y + Math.sin(angle) * dist);

      // Must fit inside the non-void area
      if (
        acx - ARENA_RADIUS - 2 < BORDER ||
        acx + ARENA_RADIUS + 2 >= size - BORDER ||
        acy - ARENA_RADIUS - 2 < BORDER ||
        acy + ARENA_RADIUS + 2 >= size - BORDER
      )
        continue;

      // Must not overlap special rooms (start, safe, boss); regular rooms are OK
      const overlapsSpecial = rooms.some((r, idx) => {
        if (!specialRoomIndices.has(idx)) return false;
        const closestX = clamp(acx, r.x, r.x + r.w - 1);
        const closestY = clamp(acy, r.y, r.y + r.h - 1);
        return Math.hypot(acx - closestX, acy - closestY) < ARENA_RADIUS + 3;
      });
      if (overlapsSpecial) continue;

      // Paint arena: outer ring = METAL_WALL, interior = ARENA_FLOOR
      const ARENA_WALL_THICKNESS = 2;
      for (let dy = -ARENA_RADIUS; dy <= ARENA_RADIUS; dy++) {
        for (let dx = -ARENA_RADIUS; dx <= ARENA_RADIUS; dx++) {
          const r = Math.hypot(dx, dy);
          if (r <= ARENA_RADIUS) {
            const gx = acx + dx;
            const gy = acy + dy;
            if (gy >= 0 && gy < size && gx >= 0 && gx < size) {
              grid[gy][gx].type =
                r > ARENA_RADIUS - ARENA_WALL_THICKNESS ? METAL_WALL : ARENA_FLOOR;
            }
          }
        }
      }

      // Carve a 2-tile wide entrance gap through the 2-tile thick wall at the south
      const doorY = acy + ARENA_RADIUS;
      const doorX = acx;
      for (let wy = 0; wy < ARENA_WALL_THICKNESS; wy++) {
        const ty = doorY - wy;
        if (ty >= 0 && ty < size) {
          grid[ty][doorX - 1].type = FloorTypeValue.concrete;
          grid[ty][doorX].type = FloorTypeValue.concrete;
        }
      }

      // Connect entrance to nearest room with a hallway.
      // Route east past the ring edge first so the vertical leg never intersects
      // METAL_WALL tiles (carveHallway only carves FloorTypeValue.wall tiles).
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

      // Carve guaranteed south exit tiles (just outside the ring).
      if (doorY + 1 < size) {
        grid[doorY + 1][doorX - 1].type = FloorTypeValue.concrete;
        grid[doorY + 1][doorX].type = FloorTypeValue.concrete;
      }

      // Pivot point: one tile south of the ring, then east past the ring's edge.
      // At x = acx + ARENA_RADIUS + 2, any y has r > ARENA_RADIUS so no METAL_WALL.
      const pivotX = Math.min(acx + ARENA_RADIUS + 2, size - BORDER - 1);
      const pivotY = doorY + 1;
      carveHallway(doorX, pivotY, pivotX, pivotY);
      carveHallway(
        pivotX,
        pivotY,
        Math.floor(nearestRoom.x + nearestRoom.w / 2),
        Math.floor(nearestRoom.y + nearestRoom.h / 2),
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

  // Filter out mob spawns and stairwells that fall inside the arena footprint
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
    mobSpawnPoints: filteredMobSpawns,
    hallwaySpawnPoints,
    stairwellTiles: filteredStairwells,
    buildingEntries,
    arenaExteriors,
  };
}
