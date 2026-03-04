const FLOOR_TYPES = [
  'grass',
  'road',
  'wall',
  'water',
  'concrete',
  'tile_floor',
  'carpet',
  'wood',
] as const;

/** Tile type for the outer border — renders as pure black and is not walkable. */
const VOID_TYPE = 9;
/** Tile type for the Safe Room floor — warm sanctuary look. */
const SAFE_ROOM_FLOOR = 10;
/** Tile type for the Boss Room floor — grimy, trash-covered look (TheHoarder). */
const HORDER_BOSS_ROOM_FLOOR = 11;
/** Tile type for the Gym Boss Room floor — dark rubber mat look (Juicer). */
const JUICER_BOSS_ROOM_FLOOR = 12;
/** Tile type for outdoor trees — renders as trunk + canopy, not walkable. */
const TREE = 13;
/** Tile type for overworld building exteriors — lighter stone facade look. */
const BUILDING_WALL = 14;
/** Tile type for thatched roofs — warm straw/golden cottage roofs. */
const ROOF_THATCH = 15;
/** Tile type for slate roofs — blue-gray inn/tower roofs. */
const ROOF_SLATE = 16;
/** Tile type for terracotta tile roofs — warm red shop roofs. */
const ROOF_RED = 17;
/** Tile type for mossy green roofs — overgrown hut roofs. */
const ROOF_GREEN = 18;
type FloorTile = (typeof FLOOR_TYPES)[number];

const FloorTypeValue = {
  grass: 0,
  road: 1,
  wall: 2,
  water: 4,
  concrete: 5,
  tile_floor: 6,
  carpet: 7,
  wood: 8,
} as const satisfies Record<FloorTile, number>;

type TileContent = {
  tileId: string;
  type: number;
};

type Room = { x: number; y: number; w: number; h: number; floor: number };

export class GameMap {
  structure: TileContent[][];
  tileHeight: number;
  /** Tile coordinates where the player should spawn (centre of the first room). */
  startTile: { x: number; y: number } = { x: 15, y: 15 };
  /** Tile centres of all rooms except the start and safe rooms — used for mob placement. */
  mobSpawnPoints: Array<{ x: number; y: number }> = [];
  /** Tile coordinates inside hallways (away from rooms) — used for rat spawning. */
  hallwaySpawnPoints: Array<{ x: number; y: number }> = [];
  /** Bounds (in tile coords) of the primary safe room, or null if not enough rooms generated. */
  safeRoomBounds: { x: number; y: number; w: number; h: number } | null = null;
  /** Tile-space centre of the primary safe room, or null if none. */
  safeRoomCentre: { x: number; y: number } | null = null;
  /** All safe rooms on this map (bounds + centre in tile coords). */
  safeRooms: Array<{
    bounds: { x: number; y: number; w: number; h: number };
    centre: { x: number; y: number };
  }> = [];
  /** All boss rooms generated on this map (bounds + centre in tile coords). */
  bossRooms: Array<{
    bounds: { x: number; y: number; w: number; h: number };
    centre: { x: number; y: number };
  }> = [];
  /** Tile-space centres of rooms that contain a stairwell (descent point). */
  stairwellTiles: Array<{ x: number; y: number }> = [];
  /** Door positions for enterable buildings (overworld only). */
  buildingEntries: Array<{
    doorTile: { x: number; y: number };
    name: string;
    type: 'house' | 'tower';
  }> = [];

  constructor(
    mapSize = 100,
    tileHeight = 10,
    numBossRooms = 1,
    numSafeRooms = 2,
    numStairwellsOverride?: number,
    mapType?: 'dungeon' | 'overworld',
  ) {
    this.tileHeight = tileHeight;
    this.structure = this.generate(
      mapSize,
      numBossRooms,
      numSafeRooms,
      numStairwellsOverride,
      mapType,
    );
  }

  private generate(
    size: number,
    numBossRooms: number,
    numSafeRooms: number,
    numStairwellsOverride?: number,
    mapType?: 'dungeon' | 'overworld',
  ): TileContent[][] {
    if (mapType === 'overworld') return this.generateOverworld(size);
    return this.generateDungeon(
      size,
      numBossRooms,
      numSafeRooms,
      numStairwellsOverride,
    );
  }

  private generateDungeon(
    size: number,
    numBossRooms: number,
    numSafeRooms: number,
    numStairwellsOverride?: number,
  ): TileContent[][] {
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
    if (rooms.length > 0) {
      const r = rooms[0];
      this.startTile = {
        x: Math.floor(r.x + r.w / 2),
        y: Math.floor(r.y + r.h / 2),
      };
    }

    // Record all safe rooms (rooms[1..numSafeRooms])
    for (let i = safeRoomStart; i < safeRoomEnd && i < rooms.length; i++) {
      const sr = rooms[i];
      this.safeRooms.push({
        bounds: { x: sr.x, y: sr.y, w: sr.w, h: sr.h },
        centre: {
          x: Math.floor(sr.x + sr.w / 2),
          y: Math.floor(sr.y + sr.h / 2),
        },
      });
    }
    // Backward-compat: primary safe room is first entry
    if (this.safeRooms.length > 0) {
      this.safeRoomBounds = this.safeRooms[0].bounds;
      this.safeRoomCentre = this.safeRooms[0].centre;
    }

    // Record all boss rooms (rooms[bossRoomStart..bossRoomEnd-1])
    for (let i = bossRoomStart; i < bossRoomEnd && i < rooms.length; i++) {
      const br = rooms[i];
      this.bossRooms.push({
        bounds: { x: br.x, y: br.y, w: br.w, h: br.h },
        centre: {
          x: Math.floor(br.x + br.w / 2),
          y: Math.floor(br.y + br.h / 2),
        },
      });
    }

    // Mob spawn points skip start, safe, and all boss rooms
    this.mobSpawnPoints = rooms.slice(bossRoomEnd).map((r) => ({
      x: Math.floor(r.x + r.w / 2),
      y: Math.floor(r.y + r.h / 2),
    }));

    // 7. Place stairwells: 1 per 50 regular rooms (min 1), in rooms far from start.
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
          this.stairwellTiles.push({
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
    this.hallwaySpawnPoints = chosen;

    return grid;
  }

  /** Generates a small interior room for a building (called externally after construction). */
  generateInterior(buildingType: 'house' | 'tower'): void {
    const isTower = buildingType === 'tower';
    const w = isTower ? 30 : 18;
    const h = isTower ? 24 : 14;
    const floorType = isTower ? 7 /* carpet */ : 8; /* wood */

    const grid: TileContent[][] = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => ({
        tileId: `${x}#${y}`,
        type: 2, // wall
      })),
    );

    // Carve interior floor
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) grid[y][x].type = floorType;

    // Exit door: 2-tile gap at bottom wall center (leave as road = walkable)
    const doorX = Math.floor(w / 2) - 1;
    grid[h - 1][doorX].type = 1; // road (walkable, acts as exit threshold)
    grid[h - 1][doorX + 1].type = 1;

    this.structure = grid;
    this.startTile = { x: Math.floor(w / 2), y: h - 2 };
    this.stairwellTiles = [];
    this.buildingEntries = [];
    this.safeRooms = [];
    this.bossRooms = [];
    this.mobSpawnPoints = [];
    this.hallwaySpawnPoints = [];
    this._interiorExitTiles = [
      { x: doorX, y: h - 1 },
      { x: doorX + 1, y: h - 1 },
    ];
  }

  /** Exit tile positions populated by generateInterior — used by BuildingInteriorScene. */
  _interiorExitTiles: Array<{ x: number; y: number }> = [];

  /**
   * A* pathfinding on the tile grid. Returns an ordered array of tile
   * coordinates from start to goal (inclusive), or an empty array if no path
   * exists. Diagonals are allowed but blocked when they cut through a wall
   * corner. Capped at MAX_NODES expansions for predictable per-frame cost.
   */
  findPath(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
  ): Array<{ x: number; y: number }> {
    if (!this.isWalkable(goalX, goalY)) return [];
    if (startX === goalX && startY === goalY) return [{ x: goalX, y: goalY }];

    type Node = {
      x: number;
      y: number;
      g: number;
      f: number;
      parent: Node | null;
    };
    const size = this.structure.length;
    const key = (x: number, y: number) => y * size + x;
    const h = (x: number, y: number) =>
      Math.abs(x - goalX) + Math.abs(y - goalY);

    const openMap = new Map<number, Node>();
    const closedSet = new Set<number>();
    openMap.set(key(startX, startY), {
      x: startX,
      y: startY,
      g: 0,
      f: h(startX, startY),
      parent: null,
    });

    const dirs = [
      { dx: 1, dy: 0, cost: 1 },
      { dx: -1, dy: 0, cost: 1 },
      { dx: 0, dy: 1, cost: 1 },
      { dx: 0, dy: -1, cost: 1 },
      { dx: 1, dy: 1, cost: 1.414 },
      { dx: 1, dy: -1, cost: 1.414 },
      { dx: -1, dy: 1, cost: 1.414 },
      { dx: -1, dy: -1, cost: 1.414 },
    ];

    const MAX_NODES = 600;
    let expanded = 0;

    while (openMap.size > 0 && expanded < MAX_NODES) {
      // Find lowest-f node (linear scan — fine for dungeon-scale maps)
      let best: Node | null = null;
      for (const n of openMap.values()) {
        if (!best || n.f < best.f) best = n;
      }
      if (!best) break;
      openMap.delete(key(best.x, best.y));

      if (best.x === goalX && best.y === goalY) {
        const path: Array<{ x: number; y: number }> = [];
        let node: Node | null = best;
        while (node) {
          path.unshift({ x: node.x, y: node.y });
          node = node.parent;
        }
        return path;
      }

      closedSet.add(key(best.x, best.y));
      expanded++;

      for (const dir of dirs) {
        const nx = best.x + dir.dx;
        const ny = best.y + dir.dy;
        const nk = key(nx, ny);
        if (closedSet.has(nk)) continue;
        if (!this.isWalkable(nx, ny)) continue;
        // Block diagonal moves that cut through wall corners
        if (
          dir.cost > 1 &&
          (!this.isWalkable(best.x + dir.dx, best.y) ||
            !this.isWalkable(best.x, best.y + dir.dy))
        )
          continue;

        const g = best.g + dir.cost;
        const existing = openMap.get(nk);
        if (existing && existing.g <= g) continue;
        openMap.set(nk, { x: nx, y: ny, g, f: g + h(nx, ny), parent: best });
      }
    }

    return [];
  }

  isWalkable(tileX: number, tileY: number): boolean {
    const row = this.structure[tileY];
    if (!row) return false;
    const tile = row[tileX];
    if (!tile) return false;
    return (
      tile.type !== FloorTypeValue.wall &&
      tile.type !== FloorTypeValue.water &&
      tile.type !== VOID_TYPE &&
      tile.type !== TREE &&
      tile.type !== BUILDING_WALL &&
      tile.type !== ROOF_THATCH &&
      tile.type !== ROOF_SLATE &&
      tile.type !== ROOF_RED &&
      tile.type !== ROOF_GREEN
      // SAFE_ROOM_FLOOR (10) is walkable — falls through as "not excluded"
    );
  }

  /**
   * Returns true if there is a clear line of sight between two pixel-space
   * points — i.e. no non-walkable tiles cross the line segment.
   * Samples every half-tile along the line for accuracy.
   */
  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const ts = this.tileHeight;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist === 0) return true;
    const steps = Math.ceil(dist / (ts * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = Math.floor((x1 + (x2 - x1) * t) / ts);
      const ty = Math.floor((y1 + (y2 - y1) * t) / ts);
      if (!this.isWalkable(tx, ty)) return false;
    }
    return true;
  }

  renderCanvas(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ) {
    const rows = this.structure.length;
    const cols = this.structure[0]?.length ?? rows;
    const ts = this.tileHeight;
    const startX = Math.max(0, Math.floor(cameraX / ts));
    const startY = Math.max(0, Math.floor(cameraY / ts));
    const endX = Math.min(cols - 1, Math.ceil((cameraX + viewW) / ts));
    const endY = Math.min(rows - 1, Math.ceil((cameraY + viewH) / ts));

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const tile = this.structure[y][x];
        const sx = x * ts - cameraX;
        const sy = y * ts - cameraY;
        this.drawTile(ctx, tile.type, sx, sy, ts, x, y);
      }
    }
  }

  private drawTile(
    ctx: CanvasRenderingContext2D,
    type: number,
    sx: number,
    sy: number,
    ts: number,
    tx: number,
    ty: number,
  ) {
    switch (type) {
      // Void (outer border)
      case VOID_TYPE: {
        ctx.fillStyle = '#000000';
        ctx.fillRect(sx, sy, ts, ts);
        break;
      }

      // Outdoors
      case FloorTypeValue.grass: {
        ctx.fillStyle = '#6de89d';
        ctx.fillRect(sx, sy, ts, ts);
        break;
      }
      case FloorTypeValue.road: {
        ctx.fillStyle = '#bc926b';
        ctx.fillRect(sx, sy, ts, ts);
        break;
      }
      case FloorTypeValue.water: {
        ctx.fillStyle = '#2ac6ff';
        ctx.fillRect(sx, sy, ts, ts);
        break;
      }

      // Dungeon wall
      case FloorTypeValue.wall: {
        // Dark brick/concrete base
        ctx.fillStyle = '#2e2420';
        ctx.fillRect(sx, sy, ts, ts);
        // Lit top face — simulates overhead light catching the wall top
        ctx.fillStyle = '#4e3e34';
        ctx.fillRect(sx, sy, ts, 3);
        // Subtle left edge highlight
        ctx.fillStyle = '#3c3028';
        ctx.fillRect(sx, sy, 2, ts);
        // Horizontal mortar seam in the middle
        ctx.fillStyle = '#1c1814';
        ctx.fillRect(sx, sy + Math.floor(ts / 2), ts, 1);
        // Staggered vertical mortar (brick bond pattern)
        const brickOff = ty % 2 === 0 ? 0 : Math.floor(ts / 2);
        const vx = sx + (brickOff % ts);
        if (vx >= sx && vx < sx + ts) {
          ctx.fillRect(vx, sy + 3, 1, Math.floor(ts / 2) - 3);
        }
        break;
      }

      // Dungeon floors

      // Poured concrete — hallways, utility rooms
      case FloorTypeValue.concrete: {
        const shade = (tx + ty) % 2 === 0 ? '#b4b0ab' : '#aaa7a2';
        ctx.fillStyle = shade;
        ctx.fillRect(sx, sy, ts, ts);
        // Expansion-joint seams every 2 tiles
        ctx.fillStyle = '#909088';
        if (tx % 2 === 0) ctx.fillRect(sx, sy, 1, ts);
        if (ty % 2 === 0) ctx.fillRect(sx, sy, ts, 1);
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }

      // Ceramic tile — offices, bathrooms
      case FloorTypeValue.tile_floor: {
        const even = (tx + ty) % 2 === 0;
        ctx.fillStyle = even ? '#d8d0b8' : '#cac2aa';
        ctx.fillRect(sx, sy, ts, ts);
        // Grout lines
        ctx.fillStyle = '#9c9078';
        ctx.fillRect(sx + ts - 1, sy, 1, ts);
        ctx.fillRect(sx, sy + ts - 1, ts, 1);
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }

      // Carpet — conference rooms, executive offices
      case FloorTypeValue.carpet: {
        const even = (tx + ty) % 2 === 0;
        ctx.fillStyle = even ? '#6e2418' : '#7a2c1e';
        ctx.fillRect(sx, sy, ts, ts);
        // Weave texture: thin cross-lines
        ctx.fillStyle = 'rgba(0,0,0,0.14)';
        ctx.fillRect(sx, sy, 1, ts);
        ctx.fillRect(sx, sy, ts, 1);
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }

      // Safe Room floor — warm sanctuary
      case SAFE_ROOM_FLOOR: {
        // Alternating warm cream tiles
        const safeBase = (tx + ty) % 2 === 0 ? '#f0e4c8' : '#e8d8b8';
        ctx.fillStyle = safeBase;
        ctx.fillRect(sx, sy, ts, ts);
        // Soft golden grout lines
        ctx.fillStyle = '#c8b890';
        ctx.fillRect(sx + ts - 1, sy, 1, ts);
        ctx.fillRect(sx, sy + ts - 1, ts, 1);
        // Subtle warm glow dot at tile corners
        if (tx % 4 === 0 && ty % 4 === 0) {
          ctx.fillStyle = 'rgba(255,200,80,0.25)';
          ctx.beginPath();
          ctx.arc(sx, sy, ts * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }

      // Boss Room floor — grimy, trash-covered
      case HORDER_BOSS_ROOM_FLOOR: {
        // Dark yellowish-brown base with alternating grime variation
        const bossBase = (tx + ty) % 2 === 0 ? '#2e2010' : '#281c0c';
        ctx.fillStyle = bossBase;
        ctx.fillRect(sx, sy, ts, ts);
        // Dark cracked grout lines
        ctx.fillStyle = '#1a1208';
        ctx.fillRect(sx + ts - 1, sy, 1, ts);
        ctx.fillRect(sx, sy + ts - 1, ts, 1);
        // Puke/grime stain blotches scattered across floor
        if ((tx * 3 + ty * 7) % 5 === 0) {
          ctx.fillStyle = 'rgba(120,140,20,0.28)';
          ctx.beginPath();
          ctx.ellipse(
            sx + ts * 0.4,
            sy + ts * 0.5,
            ts * 0.35,
            ts * 0.22,
            0.8,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        if ((tx * 5 + ty * 3) % 7 === 0) {
          ctx.fillStyle = 'rgba(80,60,10,0.35)';
          ctx.beginPath();
          ctx.ellipse(
            sx + ts * 0.65,
            sy + ts * 0.35,
            ts * 0.2,
            ts * 0.14,
            -0.5,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }

      // Juicer Gym floor — dark rubber mat
      case JUICER_BOSS_ROOM_FLOOR: {
        // Very dark grey rubber base
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(sx, sy, ts, ts);
        // Subtle grid lines every tile
        ctx.fillStyle = '#222';
        ctx.fillRect(sx + ts - 1, sy, 1, ts);
        ctx.fillRect(sx, sy + ts - 1, ts, 1);
        // Rubber texture dots (deterministic pattern)
        if ((tx + ty) % 3 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.beginPath();
          ctx.arc(sx + ts * 0.5, sy + ts * 0.5, ts * 0.18, 0, Math.PI * 2);
          ctx.fill();
        }
        // Orange gym line markings every 4 tiles
        if (tx % 4 === 0) {
          ctx.fillStyle = 'rgba(249,115,22,0.18)';
          ctx.fillRect(sx, sy, 2, ts);
        }
        if (ty % 4 === 0) {
          ctx.fillStyle = 'rgba(249,115,22,0.18)';
          ctx.fillRect(sx, sy, ts, 2);
        }
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }

      // Hardwood — break rooms, reception
      case FloorTypeValue.wood: {
        const plankGroup = Math.floor(ty / 2) % 3;
        const plankColors = ['#9e6e3a', '#8e6030', '#aa7840'] as const;
        ctx.fillStyle = plankColors[plankGroup];
        ctx.fillRect(sx, sy, ts, ts);
        // Left plank seam
        ctx.fillStyle = '#5a3818';
        ctx.fillRect(sx, sy, 1, ts);
        // Horizontal wood grain
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        for (let g = 6; g < ts; g += 7) {
          ctx.fillRect(sx + 1, sy + g, ts - 1, 1);
        }
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }

      // Outdoor tree — brown trunk, layered green canopy
      case TREE: {
        // Grass base underneath
        ctx.fillStyle = '#5cc87a';
        ctx.fillRect(sx, sy, ts, ts);
        // Trunk
        const trunkW = Math.max(3, Math.floor(ts * 0.16));
        const trunkH = Math.floor(ts * 0.32);
        const trunkX = sx + Math.floor((ts - trunkW) / 2);
        const trunkY = sy + ts - trunkH;
        ctx.fillStyle = '#5c3a1e';
        ctx.fillRect(trunkX, trunkY, trunkW, trunkH);
        // Dark green canopy shadow layer
        const cr = Math.floor(ts * 0.38);
        const cx = sx + Math.floor(ts / 2);
        const cy = sy + Math.floor(ts * 0.44);
        ctx.fillStyle = '#1e4d1e';
        ctx.beginPath();
        ctx.arc(cx + 2, cy + 2, cr, 0, Math.PI * 2);
        ctx.fill();
        // Main canopy
        ctx.fillStyle = '#2d6a2d';
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fill();
        // Highlight
        ctx.fillStyle = '#3d8b3d';
        ctx.beginPath();
        ctx.arc(
          cx - Math.floor(cr * 0.35),
          cy - Math.floor(cr * 0.3),
          Math.floor(cr * 0.45),
          0,
          Math.PI * 2,
        );
        ctx.fill();
        break;
      }

      // Overworld building wall — context-aware facade rendering
      case BUILDING_WALL: {
        // Check if adjacent tiles are roof (interior) to determine wall facing
        const isRoof = (nx: number, ny: number) => {
          const t = this.structure[ny]?.[nx]?.type;
          return (
            t === ROOF_THATCH ||
            t === ROOF_SLATE ||
            t === ROOF_RED ||
            t === ROOF_GREEN
          );
        };
        const intN = isRoof(tx, ty - 1); // interior to north → this is the south-facing wall
        const intS = isRoof(tx, ty + 1); // interior to south → north-facing wall
        const intE = isRoof(tx + 1, ty); // interior to east → west-facing wall
        const intW = isRoof(tx - 1, ty); // interior to west → east-facing wall

        if (intN) {
          // South-facing wall — visible facade, lightest
          ctx.fillStyle = '#c0ae98';
          ctx.fillRect(sx, sy, ts, ts);
          // Horizontal mortar courses (staggered brick bond)
          ctx.fillStyle = '#8a7a68';
          ctx.fillRect(sx, sy + Math.floor(ts * 0.35), ts, 2);
          ctx.fillRect(sx, sy + Math.floor(ts * 0.68), ts, 2);
          const bOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
          ctx.fillStyle = '#9a8878';
          ctx.fillRect(
            sx + ((Math.floor(ts * 0.5) + bOff) % ts),
            sy,
            1,
            Math.floor(ts * 0.35),
          );
          ctx.fillRect(
            sx + (bOff % ts),
            sy + Math.floor(ts * 0.35) + 2,
            1,
            Math.floor(ts * 0.33) - 2,
          );
          // Window on non-corner tiles (both E and W neighbors are also walls)
          const wallE = this.structure[ty]?.[tx + 1]?.type === BUILDING_WALL;
          const wallW = this.structure[ty]?.[tx - 1]?.type === BUILDING_WALL;
          if (wallE && wallW && tx % 2 === 0) {
            const ww = Math.floor(ts * 0.5);
            const wh = Math.floor(ts * 0.38);
            const wx = sx + Math.floor((ts - ww) / 2);
            const wy = sy + Math.floor((ts - wh) / 2) - 2;
            ctx.fillStyle = '#2a3a50'; // dark frame
            ctx.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
            ctx.fillStyle = '#b0cce0'; // glass pane
            ctx.fillRect(wx, wy, ww, wh);
            ctx.fillStyle = '#6a8aa0'; // pane divider
            ctx.fillRect(wx + Math.floor(ww / 2), wy, 1, wh);
            ctx.fillRect(wx, wy + Math.floor(wh / 2), ww, 1);
          }
          // Lit top edge
          ctx.fillStyle = '#d4c2ac';
          ctx.fillRect(sx, sy, ts, 2);
        } else if (intS) {
          // North-facing wall — dark, shadowed
          ctx.fillStyle = '#6a5e52';
          ctx.fillRect(sx, sy, ts, ts);
          ctx.fillStyle = '#5a4e42';
          ctx.fillRect(sx, sy + Math.floor(ts * 0.5), ts, 1);
          ctx.fillStyle = '#7a6e62';
          ctx.fillRect(sx, sy, ts, 2);
        } else if (intE || intW) {
          // East or west-facing side wall
          ctx.fillStyle = '#9a8e82';
          ctx.fillRect(sx, sy, ts, ts);
          ctx.fillStyle = '#7a6e60';
          ctx.fillRect(sx, sy + Math.floor(ts * 0.35), ts, 1);
          ctx.fillRect(sx, sy + Math.floor(ts * 0.68), ts, 1);
          ctx.fillStyle = '#aea298';
          ctx.fillRect(sx, sy, ts, 2);
        } else {
          // Corner or isolated wall — general stone
          ctx.fillStyle = '#8a7e72';
          ctx.fillRect(sx, sy, ts, ts);
          ctx.fillStyle = '#7a6e62';
          ctx.fillRect(sx, sy + Math.floor(ts * 0.35), ts, 1);
          ctx.fillRect(sx, sy + Math.floor(ts * 0.68), ts, 1);
          ctx.fillStyle = '#9a8e82';
          ctx.fillRect(sx, sy, ts, 2);
        }
        break;
      }

      // Thatched roof — warm straw/golden cottage
      case ROOF_THATCH: {
        ctx.fillStyle = '#c89840';
        ctx.fillRect(sx, sy, ts, ts);
        // Horizontal straw bands
        ctx.fillStyle = '#a87c28';
        for (let gy = 3; gy < ts; gy += 5) {
          ctx.fillRect(sx, sy + gy, ts, 2);
        }
        // Sparse vertical dividers (straw bundles)
        ctx.fillStyle = '#b88830';
        const bx2 = (((tx * 7) % ts) + ts) % ts;
        ctx.fillRect(sx + bx2, sy, 1, ts);
        // Highlight: lighter top-left area (lit from above)
        ctx.fillStyle = 'rgba(255,220,80,0.18)';
        ctx.fillRect(sx, sy, ts, Math.floor(ts * 0.4));
        break;
      }

      // Slate roof — blue-gray inn/tower
      case ROOF_SLATE: {
        const slateBase = ty % 2 === 0 ? '#7a8898' : '#828fa0';
        ctx.fillStyle = slateBase;
        ctx.fillRect(sx, sy, ts, ts);
        // Horizontal slate tile rows
        ctx.fillStyle = '#606e80';
        for (let gy = 4; gy < ts; gy += 6) {
          ctx.fillRect(sx, sy + gy, ts, 1);
        }
        // Staggered vertical seams
        const slateOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
        ctx.fillStyle = '#6a7888';
        ctx.fillRect(sx + ((Math.floor(ts * 0.5) + slateOff) % ts), sy, 1, ts);
        // Lit top edge
        ctx.fillStyle = '#9aaabb';
        ctx.fillRect(sx, sy, ts, 2);
        break;
      }

      // Terracotta tile roof — warm red shop
      case ROOF_RED: {
        const redBase = ty % 2 === 0 ? '#b84838' : '#c05040';
        ctx.fillStyle = redBase;
        ctx.fillRect(sx, sy, ts, ts);
        // Horizontal tile rows with curved highlight
        for (let gy = 0; gy < ts; gy += 7) {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(sx, sy + gy, ts, 2);
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.fillRect(sx, sy + gy + 5, ts, 2);
        }
        // Vertical grout
        ctx.fillStyle = '#8a3028';
        const rOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
        ctx.fillRect(sx + ((Math.floor(ts * 0.5) + rOff) % ts), sy, 1, ts);
        // Warm highlight top
        ctx.fillStyle = 'rgba(255,160,80,0.2)';
        ctx.fillRect(sx, sy, ts, Math.floor(ts * 0.35));
        break;
      }

      // Mossy green roof — overgrown hut
      case ROOF_GREEN: {
        ctx.fillStyle = '#4a7040';
        ctx.fillRect(sx, sy, ts, ts);
        // Moss texture variation
        if ((tx * 7 + ty * 11) % 5 === 0) {
          ctx.fillStyle = '#3a5c30';
          ctx.beginPath();
          ctx.arc(
            sx + Math.floor(ts * 0.4),
            sy + Math.floor(ts * 0.5),
            Math.floor(ts * 0.3),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        if ((tx * 3 + ty * 13) % 7 === 0) {
          ctx.fillStyle = '#5a8850';
          ctx.beginPath();
          ctx.arc(
            sx + Math.floor(ts * 0.65),
            sy + Math.floor(ts * 0.3),
            Math.floor(ts * 0.22),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        // Subtle horizontal moss ridges
        ctx.fillStyle = '#3e6036';
        ctx.fillRect(sx, sy + Math.floor(ts * 0.45), ts, 1);
        // Lit top
        ctx.fillStyle = 'rgba(120,200,80,0.15)';
        ctx.fillRect(sx, sy, ts, Math.floor(ts * 0.4));
        break;
      }
    }
  }

  private generateOverworld(size: number): TileContent[][] {
    const BORDER = 5;
    const ROAD = FloorTypeValue.road;
    const GRASS = FloorTypeValue.grass;

    // 1. Fill with grass
    const grid: TileContent[][] = Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => ({
        tileId: `${x}#${y}`,
        type: GRASS,
      })),
    );

    const set = (x: number, y: number, type: number) => {
      if (x >= 0 && x < size && y >= 0 && y < size) grid[y][x].type = type;
    };
    const setRoad = (x: number, y: number) => {
      if (x < 0 || x >= size || y < 0 || y >= size) return;
      const t = grid[y][x].type;
      if (
        t === BUILDING_WALL ||
        t === ROOF_THATCH ||
        t === ROOF_SLATE ||
        t === ROOF_RED ||
        t === ROOF_GREEN ||
        t === VOID_TYPE
      )
        return;
      grid[y][x].type = ROAD;
    };
    const fill = (x: number, y: number, w: number, h: number, type: number) => {
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) set(x + dx, y + dy, type);
    };
    const isSolid = (x: number, y: number) => {
      if (x < 0 || x >= size || y < 0 || y >= size) return true;
      const t = grid[y][x].type;
      return (
        t === BUILDING_WALL ||
        t === VOID_TYPE ||
        t === ROOF_THATCH ||
        t === ROOF_SLATE ||
        t === ROOF_RED ||
        t === ROOF_GREEN
      );
    };

    // 2. Void border
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (
          y < BORDER ||
          y >= size - BORDER ||
          x < BORDER ||
          x >= size - BORDER
        )
          grid[y][x].type = VOID_TYPE;

    // 3. Main roads (cross through town)
    const cx = Math.floor(size / 2);
    const cy = Math.floor(size / 2);
    fill(BORDER, cy - 2, size - BORDER * 2, 5, ROAD); // E-W
    fill(cx - 2, BORDER, 5, size - BORDER * 2, ROAD); // N-S

    // 4. Town square
    fill(cx - 11, cy - 11, 22, 22, ROAD);

    // 5. Helper: place a building and register its door
    const buildings: Array<{ x: number; y: number; w: number; h: number }> = [];
    const placeBuilding = (
      bx: number,
      by: number,
      bw: number,
      bh: number,
      type: 'house' | 'tower',
      name: string,
      roofTile: number,
    ) => {
      // Perimeter = stone walls, interior = roof tile
      for (let dy = 0; dy < bh; dy++) {
        for (let dx = 0; dx < bw; dx++) {
          const isPerimeter =
            dy === 0 || dy === bh - 1 || dx === 0 || dx === bw - 1;
          set(bx + dx, by + dy, isPerimeter ? BUILDING_WALL : roofTile);
        }
      }
      // Door: 2-tile gap at south face center
      const doorX = bx + Math.floor(bw / 2) - 1;
      const doorY = by + bh - 1;
      set(doorX, doorY, ROAD);
      set(doorX + 1, doorY, ROAD);
      buildings.push({ x: bx, y: by, w: bw, h: bh });
      this.buildingEntries.push({
        doorTile: { x: doorX, y: doorY },
        name,
        type,
      });
    };

    // 6. Town center tower (14×12, north of town square)
    placeBuilding(
      cx - 7,
      cy - 27,
      14,
      12,
      'tower',
      'Town Center Tower',
      ROOF_SLATE,
    );

    // 7. Small houses around town square
    const rng = (min: number, max: number) =>
      Math.floor(Math.random() * (max - min + 1)) + min;
    const houseAngles = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];
    const houseRoofs = [
      ROOF_THATCH,
      ROOF_RED,
      ROOF_GREEN,
      ROOF_THATCH,
      ROOF_RED,
      ROOF_GREEN,
      ROOF_THATCH,
      ROOF_RED,
      ROOF_GREEN,
      ROOF_THATCH,
    ];
    const placedHouses: Array<{ x: number; y: number; w: number; h: number }> =
      [];
    let houseIdx = 0;
    for (let attempt = 0; attempt < 200 && houseIdx < 10; attempt++) {
      const angle = (houseAngles[houseIdx] + rng(-15, 15)) * (Math.PI / 180);
      const dist = rng(16, 40);
      const hw = rng(5, 7);
      const hh = rng(5, 7);
      const hx = cx + Math.round(Math.cos(angle) * dist) - Math.floor(hw / 2);
      const hy = cy + Math.round(Math.sin(angle) * dist) - Math.floor(hh / 2);
      // Check bounds
      if (hx < BORDER + 2 || hx + hw > size - BORDER - 2) continue;
      if (hy < BORDER + 2 || hy + hh > size - BORDER - 2) continue;
      // Collision check with existing buildings and roads near center
      const pad = 3;
      const overlaps = [...buildings, ...placedHouses].some(
        (b) =>
          hx < b.x + b.w + pad &&
          hx + hw + pad > b.x &&
          hy < b.y + b.h + pad &&
          hy + hh + pad > b.y,
      );
      if (overlaps) continue;
      placeBuilding(
        hx,
        hy,
        hw,
        hh,
        'house',
        `House ${houseIdx + 1}`,
        houseRoofs[houseIdx],
      );
      placedHouses.push({ x: hx, y: hy, w: hw, h: hh });

      // Minor branch road connecting house door to nearest main road (L-shape, 3 wide)
      const doorX = hx + Math.floor(hw / 2) - 1;
      const doorY = hy + hh - 1;
      // Determine whether to route toward E-W or N-S road
      const toEW = Math.abs(doorY - cy) < Math.abs(doorX - cx);
      if (toEW) {
        // Go south/north to the E-W road
        const targetY = doorY < cy ? cy - 2 : cy + 4;
        const minY = Math.min(doorY, targetY);
        const maxY = Math.max(doorY, targetY);
        for (let ry = minY; ry <= maxY; ry++) {
          setRoad(doorX, ry);
          setRoad(doorX + 1, ry);
          setRoad(doorX + 2, ry);
        }
      } else {
        // Go east/west to the N-S road
        const targetX = doorX < cx ? cx - 2 : cx + 4;
        const minX = Math.min(doorX, targetX);
        const maxX = Math.max(doorX, targetX);
        for (let rx = minX; rx <= maxX; rx++) {
          setRoad(rx, doorY);
          setRoad(rx, doorY + 1);
        }
        // Then jog to doorY
        const minY2 = Math.min(doorY, cy - 2);
        const maxY2 = Math.max(doorY, cy + 4);
        for (let ry = minY2; ry <= maxY2; ry++) {
          setRoad(doorX, ry);
          setRoad(doorX + 1, ry);
        }
      }

      houseIdx++;
    }

    // 8. Forest blobs in wilderness (>65 tiles from center, not over roads)
    const NUM_FORESTS = 30;
    for (let f = 0; f < NUM_FORESTS; f++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 65 + Math.random() * (size / 2 - 75);
      const fx = Math.round(cx + Math.cos(angle) * dist);
      const fy = Math.round(cy + Math.sin(angle) * dist);
      const radius = 8 + Math.floor(Math.random() * 14);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > radius) continue;
          // Irregular edge via noise
          if (d > radius * 0.7 && Math.random() < 0.45) continue;
          const tx = fx + dx;
          const ty = fy + dy;
          if (
            tx < BORDER ||
            tx >= size - BORDER ||
            ty < BORDER ||
            ty >= size - BORDER
          )
            continue;
          if (isSolid(tx, ty)) continue;
          if (grid[ty][tx].type === ROAD) continue; // Don't overwrite roads
          grid[ty][tx].type = TREE;
        }
      }
    }

    // 9. Map metadata
    this.startTile = { x: cx, y: cy };
    // Expose town square as a "safe room" so SafeRoomSystem can mark it explored
    this.safeRooms = [
      {
        bounds: { x: cx - 11, y: cy - 11, w: 22, h: 22 },
        centre: { x: cx, y: cy },
      },
    ];
    this.safeRoomBounds = this.safeRooms[0].bounds;
    this.safeRoomCentre = this.safeRooms[0].centre;
    // No stairwells or mob spawns on overworld (dead-end level for now)
    this.stairwellTiles = [];
    this.mobSpawnPoints = [];
    this.hallwaySpawnPoints = [];
    this.bossRooms = [];

    return grid;
  }

  /** Draws a shadow strip on floor tiles directly below or right of a wall/building/tree. */
  private drawWallShadow(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    ts: number,
    tx: number,
    ty: number,
  ) {
    const SHADOW_TYPES = new Set([
      FloorTypeValue.wall,
      BUILDING_WALL,
      TREE,
      ROOF_THATCH,
      ROOF_SLATE,
      ROOF_RED,
      ROOF_GREEN,
    ]);
    const above = this.structure[ty - 1]?.[tx];
    if (above && SHADOW_TYPES.has(above.type)) {
      ctx.fillStyle = 'rgba(0,0,0,0.40)';
      ctx.fillRect(sx, sy, ts, 8);
    }
    const left = this.structure[ty]?.[tx - 1];
    if (left && SHADOW_TYPES.has(left.type)) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(sx, sy, 6, ts);
    }
  }
}
