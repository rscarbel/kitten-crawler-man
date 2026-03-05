import {
  FloorTypeValue,
  TileContent,
  VOID_TYPE,
  SAFE_ROOM_FLOOR,
  HORDER_BOSS_ROOM_FLOOR,
  JUICER_BOSS_ROOM_FLOOR,
} from './tileTypes';

type Room = { x: number; y: number; w: number; h: number; floor: number };
type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export interface DungeonData {
  grid: TileContent[][];
  startTile: Point;
  safeRooms: Array<{ bounds: Rect; centre: Point }>;
  safeRoomBounds: Rect | null;
  safeRoomCentre: Point | null;
  bossRooms: Array<{ bounds: Rect; centre: Point }>;
  mobSpawnPoints: Point[];
  hallwaySpawnPoints: Point[];
  stairwellTiles: Point[];
}

export function generateDungeon(
  size: number,
  numBossRooms: number,
  numSafeRooms: number,
  numStairwellsOverride?: number,
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
      if (
        y < BORDER ||
        y >= size - BORDER ||
        x < BORDER ||
        x >= size - BORDER
      ) {
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
        if (
          hy >= BORDER &&
          hy < size - BORDER &&
          grid[hy][hx].type === FloorTypeValue.wall
        ) {
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
        if (
          hx >= BORDER &&
          hx < size - BORDER &&
          grid[hy][hx].type === FloorTypeValue.wall
        ) {
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

  // rooms[0]=start, rooms[1..numSafeRooms]=safe, rooms[numSafeRooms+1..bossRoomEnd-1]=boss
  const safeRoomStart = 1;
  const safeRoomEnd = 1 + numSafeRooms; // exclusive
  const bossRoomStart = safeRoomEnd;
  const bossRoomEnd = safeRoomEnd + numBossRooms;

  // Scale room count and attempts proportionally to map area.
  // At size=100: 15 rooms, ~120 attempts.  At size=450: ~304 rooms, ~2432 attempts.
  const maxRooms = Math.round(15 * (size / 100) ** 2);
  const maxAttempts = Math.max(maxRooms * 8, 80);

  // Fixed max-distance constraints for special rooms (in tiles from start centre).
  const SAFE_MAX_DIST = 50;
  const BOSS_MAX_DIST = 80;
  const SAFE_MIN_SEPARATION = 18; // safe rooms must be this far apart from each other

  for (
    let attempt = 0;
    attempt < maxAttempts && rooms.length < maxRooms;
    attempt++
  ) {
    const isSafeRoom =
      rooms.length >= safeRoomStart && rooms.length < safeRoomEnd;
    const isBossRoom =
      rooms.length >= bossRoomStart && rooms.length < bossRoomEnd;
    const w = isBossRoom
      ? 22
      : MIN_W + Math.floor(Math.random() * (MAX_W - MIN_W + 1));
    const h = isBossRoom
      ? 18
      : MIN_H + Math.floor(Math.random() * (MAX_H - MIN_H + 1));
    const x =
      BORDER + 1 + Math.floor(Math.random() * (size - BORDER * 2 - w - 2));
    const y =
      BORDER + 1 + Math.floor(Math.random() * (size - BORDER * 2 - h - 2));

    const cx = Math.floor(x + w / 2);
    const cy = Math.floor(y + h / 2);

    const overlaps = rooms.some(
      (r) =>
        x < r.x + r.w + GAP &&
        x + w + GAP > r.x &&
        y < r.y + r.h + GAP &&
        y + h + GAP > r.y,
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

    // Safe rooms and boss rooms must stay within a fixed tile-radius of the start room.
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
          : Infinity;
      if (Math.hypot(cx - sc.x, cy - sc.y) > maxDist) tooFarFromStart = true;
    }

    if (
      !overlaps &&
      !tooCloseToBoss &&
      !tooCloseToSafeRoom &&
      !tooFarFromStart
    ) {
      // 0-indexed boss room index
      const bossIdx = rooms.length - bossRoomStart;
      const floor = isSafeRoom
        ? SAFE_ROOM_FLOOR
        : isBossRoom
          ? bossIdx === 0
            ? HORDER_BOSS_ROOM_FLOOR
            : JUICER_BOSS_ROOM_FLOOR
          : DUNGEON_FLOORS[Math.floor(Math.random() * DUNGEON_FLOORS.length)];
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
  // Backward-compat: primary safe room is first entry
  const safeRoomBounds = safeRooms.length > 0 ? safeRooms[0].bounds : null;
  const safeRoomCentre = safeRooms.length > 0 ? safeRooms[0].centre : null;

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

  // Mob spawn points skip start, safe, and all boss rooms
  const mobSpawnPoints = rooms.slice(bossRoomEnd).map((r) => ({
    x: Math.floor(r.x + r.w / 2),
    y: Math.floor(r.y + r.h / 2),
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
      return (
        Math.hypot(rc.x - startCenter.x, rc.y - startCenter.y) >=
        MIN_STAIRWELL_DIST
      );
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
      numStairwellsOverride ??
      Math.max(1, Math.floor(regularRooms.length / 50));
    // Pick every N-th room from the sorted list to spread them out
    const step = Math.max(1, Math.floor(farRooms.length / stairwellCount));
    for (let i = 0; i < stairwellCount; i++) {
      const r = farRooms[i * step];
      if (r) {
        stairwellTiles.push({
          x: Math.floor(r.x + r.w / 2),
          y: Math.floor(r.y + r.h / 2),
        });
      }
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
  const validHallway = hallwayTiles.filter(
    (t) => !nearRoomSet.has(t.y * size + t.x),
  );

  // Fisher-Yates shuffle then pick up to maxHallwaySpawns tiles with ≥3-tile separation.
  for (let i = validHallway.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [validHallway[i], validHallway[j]] = [validHallway[j], validHallway[i]];
  }
  const chosen: Array<{ x: number; y: number }> = [];
  for (const t of validHallway) {
    if (chosen.length >= maxHallwaySpawns) break;
    if (chosen.every((c) => Math.hypot(t.x - c.x, t.y - c.y) >= 3))
      chosen.push(t);
  }
  const hallwaySpawnPoints = chosen;

  return {
    grid,
    startTile,
    safeRooms,
    safeRoomBounds,
    safeRoomCentre,
    bossRooms,
    mobSpawnPoints,
    hallwaySpawnPoints,
    stairwellTiles,
  };
}
