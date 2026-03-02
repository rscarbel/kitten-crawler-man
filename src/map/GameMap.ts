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
/** Tile type for the Boss Room floor — grimy, trash-covered look. */
const HORDER_BOSS_ROOM_FLOOR = 11;
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
  /** Bounds (in tile coords) of the safe room, or null if not enough rooms generated. */
  safeRoomBounds: { x: number; y: number; w: number; h: number } | null = null;
  /** Tile-space centre of the safe room, or null if none. */
  safeRoomCentre: { x: number; y: number } | null = null;
  /** All boss rooms generated on this map (bounds + centre in tile coords). */
  bossRooms: Array<{
    bounds: { x: number; y: number; w: number; h: number };
    centre: { x: number; y: number };
  }> = [];

  constructor(mapSize = 100, tileHeight = 10, numBossRooms = 1) {
    this.tileHeight = tileHeight;
    this.structure = this.generate(mapSize, numBossRooms);
  }

  private generate(size: number, numBossRooms: number): TileContent[][] {
    return this.generateDungeon(size, numBossRooms);
  }

  private generateDungeon(size: number, numBossRooms: number): TileContent[][] {
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

    // rooms[0]=start, rooms[1]=safe, rooms[2..2+numBossRooms-1]=boss rooms
    const bossRoomEnd = 2 + numBossRooms;

    // Scale room count and attempts proportionally to map area.
    // At size=100: 15 rooms, ~120 attempts.  At size=450: ~304 rooms, ~2432 attempts.
    const maxRooms = Math.round(15 * (size / 100) ** 2);
    const maxAttempts = Math.max(maxRooms * 8, 80);

    // Fixed max-distance constraints for special rooms (in tiles from start centre).
    // Keeps the safe room and boss room "nearby" regardless of how big the map grows.
    const SAFE_MAX_DIST = 50; // rooms[1] — safe room
    const BOSS_MAX_DIST = 80; // rooms[2+] — boss rooms

    for (
      let attempt = 0;
      attempt < maxAttempts && rooms.length < maxRooms;
      attempt++
    ) {
      const isBossRoom = rooms.length >= 2 && rooms.length < bossRoomEnd;
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

      // Boss rooms must be at least 25 tiles apart from each other
      const tooCloseToBoss =
        isBossRoom &&
        rooms.slice(2, bossRoomEnd).some((r) => {
          const rc = {
            x: Math.floor(r.x + r.w / 2),
            y: Math.floor(r.y + r.h / 2),
          };
          return Math.hypot(cx - rc.x, cy - rc.y) < 25;
        });

      // Safe room and boss rooms must stay within a fixed tile-radius of the start
      // room so they remain "near" even on very large maps.
      let tooFarFromStart = false;
      if (rooms.length > 0) {
        const sc = {
          x: Math.floor(rooms[0].x + rooms[0].w / 2),
          y: Math.floor(rooms[0].y + rooms[0].h / 2),
        };
        const maxDist =
          rooms.length === 1
            ? SAFE_MAX_DIST
            : isBossRoom
              ? BOSS_MAX_DIST
              : Infinity;
        if (Math.hypot(cx - sc.x, cy - sc.y) > maxDist) tooFarFromStart = true;
      }

      if (!overlaps && !tooCloseToBoss && !tooFarFromStart) {
        const floor =
          rooms.length === 1
            ? SAFE_ROOM_FLOOR
            : isBossRoom
              ? HORDER_BOSS_ROOM_FLOOR
              : DUNGEON_FLOORS[
                  Math.floor(Math.random() * DUNGEON_FLOORS.length)
                ];
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

    // rooms[1] is the Safe Room — record its bounds and exclude from mob spawns
    if (rooms.length > 1) {
      const sr = rooms[1];
      this.safeRoomBounds = { x: sr.x, y: sr.y, w: sr.w, h: sr.h };
      this.safeRoomCentre = {
        x: Math.floor(sr.x + sr.w / 2),
        y: Math.floor(sr.y + sr.h / 2),
      };
    }

    // Record all boss rooms (rooms[2..2+numBossRooms-1])
    for (let i = 2; i < bossRoomEnd && i < rooms.length; i++) {
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

    // 7. Pick rat spawn points: hallway tiles at least 5 tiles from every room centre.
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
      tile.type !== VOID_TYPE
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
    const size = this.structure.length;
    const ts = this.tileHeight;
    const startX = Math.max(0, Math.floor(cameraX / ts));
    const startY = Math.max(0, Math.floor(cameraY / ts));
    const endX = Math.min(size - 1, Math.ceil((cameraX + viewW) / ts));
    const endY = Math.min(size - 1, Math.ceil((cameraY + viewH) / ts));

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
      // ── Void (outer border) ───────────────────────────────────────────────
      case VOID_TYPE: {
        ctx.fillStyle = '#000000';
        ctx.fillRect(sx, sy, ts, ts);
        break;
      }

      // ── Outdoors ─────────────────────────────────────────────────────────
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

      // ── Dungeon wall ──────────────────────────────────────────────────────
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

      // ── Dungeon floors ────────────────────────────────────────────────────

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

      // ── Safe Room floor — warm sanctuary ──────────────────────────────────
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

      // ── Boss Room floor — grimy, trash-covered ────────────────────────────
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
    }
  }

  /** Draws a shadow strip on floor tiles directly below or right of a wall. */
  private drawWallShadow(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    ts: number,
    tx: number,
    ty: number,
  ) {
    const above = this.structure[ty - 1]?.[tx];
    if (above && above.type === FloorTypeValue.wall) {
      ctx.fillStyle = 'rgba(0,0,0,0.40)';
      ctx.fillRect(sx, sy, ts, 8);
    }
    const left = this.structure[ty]?.[tx - 1];
    if (left && left.type === FloorTypeValue.wall) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(sx, sy, 6, ts);
    }
  }
}
