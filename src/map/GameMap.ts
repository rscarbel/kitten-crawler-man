import {
  FloorTypeValue,
  TileContent,
  VOID_TYPE,
  TREE,
  BUILDING_WALL,
  METAL_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  FOUNTAIN,
  TORCH,
  WELL,
  SAFE_ROOM_FLOOR,
  STAIRS_UP,
  STAIRS_DOWN,
  TABLE,
  BOOKSHELF,
  BED,
  FIREPLACE,
  BARREL,
  RUG,
  CHAIR,
} from './tileTypes';
import { generateDungeon, type ArenaExterior } from './DungeonGenerator';
import { generateOverworld } from './OverworldGenerator';
import { renderCanvas, renderDecorationsOverlay, drawDecorationTileFull } from './TileRenderer';

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
    type: 'house' | 'tower' | 'restaurant' | 'store';
  }> = [];
  /** Arena circles generated in the dungeon (one per dungeon map). */
  arenaExteriors: ArenaExterior[] = [];
  /** When true, the arena door gap tiles are treated as unwalkable. */
  arenaDoorLocked = false;
  private arenaDoorTileSet = new Set<string>();

  constructor(
    mapSize = 100,
    tileHeight = 10,
    numBossRooms = 1,
    numSafeRooms = 2,
    numStairwellsOverride?: number,
    mapType?: 'dungeon' | 'overworld',
    hasArena = false,
    bossTypes: string[] = [],
  ) {
    this.tileHeight = tileHeight;
    this.structure = this.generate(
      mapSize,
      numBossRooms,
      numSafeRooms,
      numStairwellsOverride,
      mapType,
      hasArena,
      bossTypes,
    );
  }

  private generate(
    size: number,
    numBossRooms: number,
    numSafeRooms: number,
    numStairwellsOverride?: number,
    mapType?: 'dungeon' | 'overworld',
    hasArena = false,
    bossTypes: string[] = [],
  ): TileContent[][] {
    if (mapType === 'overworld') {
      const data = generateOverworld(size);
      this.startTile = data.startTile;
      this.safeRooms = data.safeRooms;
      this.safeRoomBounds = data.safeRoomBounds;
      this.safeRoomCentre = data.safeRoomCentre;
      this.buildingEntries = data.buildingEntries;
      this.bossRooms = data.bossRooms;
      this.mobSpawnPoints = data.mobSpawnPoints;
      this.hallwaySpawnPoints = data.hallwaySpawnPoints;
      this.stairwellTiles = data.stairwellTiles;
      return data.grid;
    }

    const data = generateDungeon(
      size,
      numBossRooms,
      numSafeRooms,
      numStairwellsOverride,
      hasArena,
      bossTypes,
    );
    this.startTile = data.startTile;
    this.safeRooms = data.safeRooms;
    this.safeRoomBounds = data.safeRoomBounds;
    this.safeRoomCentre = data.safeRoomCentre;
    this.bossRooms = data.bossRooms;
    this.mobSpawnPoints = data.mobSpawnPoints;
    this.hallwaySpawnPoints = data.hallwaySpawnPoints;
    this.stairwellTiles = data.stairwellTiles;
    this.arenaExteriors = data.arenaExteriors;
    for (const arena of data.arenaExteriors) {
      const { x: doorX, y: doorY } = arena.doorTile;
      for (const dy of [0, -1]) {
        for (const dx of [-1, 0]) {
          this.arenaDoorTileSet.add(`${doorX + dx},${doorY + dy}`);
        }
      }
      // Also cover the south exit tile carved in the generator
      this.arenaDoorTileSet.add(`${doorX - 1},${doorY + 1}`);
      this.arenaDoorTileSet.add(`${doorX},${doorY + 1}`);
    }
    return data.grid;
  }

  /** Locks the arena door so players cannot exit while the fight is active. */
  lockArenaDoor(): void {
    this.arenaDoorLocked = true;
  }

  /** Unlocks the arena door after the fight ends. */
  unlockArenaDoor(): void {
    this.arenaDoorLocked = false;
  }

  /** Adds the arena stairwell to the active stairwell list (call when Ball of Swine is defeated). */
  unlockArenaStairwell(): void {
    for (const arena of this.arenaExteriors) {
      const already = this.stairwellTiles.some(
        (s) => s.x === arena.stairwellTile.x && s.y === arena.stairwellTile.y,
      );
      if (!already) {
        this.stairwellTiles.push(arena.stairwellTile);
      }
    }
  }

  /** Generates a small interior room for a building (called externally after construction).
   *  For towers, pass towerFloor (0-3) to generate per-floor stair layout. */
  generateInterior(
    buildingType: 'house' | 'tower' | 'restaurant' | 'store',
    towerFloor = 0,
    buildingName = '',
  ): void {
    const isTower = buildingType === 'tower';
    const isRestaurant = buildingType === 'restaurant';
    const isStore = buildingType === 'store';
    const isHouse = buildingType === 'house';
    const isCarnival = buildingName === 'Big Top';
    const w = isTower ? 30 : isRestaurant ? 22 : isStore ? 20 : 18;
    const h = isTower ? 24 : isRestaurant ? 16 : isStore ? 12 : 14;
    const floorType = isTower ? 7 /* carpet */ : isRestaurant ? SAFE_ROOM_FLOOR : 8; /* wood */

    const grid: TileContent[][] = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => ({
        tileId: `${x}#${y}`,
        type: 2, // wall
      })),
    );

    // Carve interior floor
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) grid[y][x].type = floorType;

    if (isStore && !isCarnival) {
      // Counter along the north interior (row 2, cols 2–17) — keeps shopkeeper separate
      for (let x = 2; x <= w - 3; x++) grid[2][x].type = FloorTypeValue.wall;
      // Shelving behind counter (row 1 is wall, so place barrels in row 1 area — skip)
      // Barrels behind counter on east side
      grid[3][w - 3].type = BARREL;
      grid[3][w - 4].type = BARREL;
      grid[4][w - 3].type = BARREL;
      // Bookshelf (display shelf) on west wall
      grid[4][1].type = BOOKSHELF;
      grid[5][1].type = BOOKSHELF;
      grid[6][1].type = BOOKSHELF;
      // Barrel cluster near entrance
      grid[h - 3][1].type = BARREL;
      grid[h - 3][w - 2].type = BARREL;
      // Small rug in front of counter
      for (let x = 5; x <= 8; x++) grid[4][x].type = RUG;
      for (let x = 5; x <= 8; x++) grid[5][x].type = RUG;
    }

    if (isRestaurant) {
      // Counter along the north wall (row 2, cols 2–8) — non-walkable wall tiles
      for (let x = 2; x <= 8; x++) grid[2][x].type = FloorTypeValue.wall;
      // Two 2×1 tables in the dining area (rows 5–6, cols 2–3 and 5–6)
      grid[5][2].type = TABLE;
      grid[5][3].type = TABLE;
      grid[6][2].type = CHAIR;
      grid[6][3].type = CHAIR;
      grid[5][5].type = TABLE;
      grid[5][6].type = TABLE;
      grid[6][5].type = CHAIR;
      grid[6][6].type = CHAIR;
      // Two more tables on the east side (rows 5–6, cols 14–15 and 17–18)
      grid[5][14].type = TABLE;
      grid[5][15].type = TABLE;
      grid[6][14].type = CHAIR;
      grid[6][15].type = CHAIR;
      grid[5][17].type = TABLE;
      grid[5][18].type = TABLE;
      grid[6][17].type = CHAIR;
      grid[6][18].type = CHAIR;
      // Two more tables deeper in (rows 9–10)
      grid[9][2].type = TABLE;
      grid[9][3].type = TABLE;
      grid[10][2].type = CHAIR;
      grid[10][3].type = CHAIR;
      grid[9][5].type = TABLE;
      grid[9][6].type = TABLE;
      grid[10][5].type = CHAIR;
      grid[10][6].type = CHAIR;
      // Barrel near kitchen counter
      grid[3][9].type = BARREL;
      grid[3][10].type = BARREL;
    }

    // ── House furniture (skip carnival Big Top) ──
    if (isHouse && !isCarnival) {
      // Fireplace centered on north wall
      grid[1][8].type = FIREPLACE;
      grid[1][9].type = FIREPLACE;
      // Rug in front of fireplace
      for (let x = 7; x <= 10; x++) {
        grid[2][x].type = RUG;
        grid[3][x].type = RUG;
      }
      // Bed in NE corner
      grid[2][15].type = BED;
      grid[2][16].type = BED;
      grid[3][15].type = BED;
      grid[3][16].type = BED;
      // Bookshelf on west wall
      grid[3][1].type = BOOKSHELF;
      grid[4][1].type = BOOKSHELF;
      grid[5][1].type = BOOKSHELF;
      // Dining table with chairs in center-south area
      grid[7][7].type = TABLE;
      grid[7][8].type = TABLE;
      grid[7][9].type = TABLE;
      grid[8][7].type = CHAIR;
      grid[8][9].type = CHAIR;
      // Barrel in SW corner
      grid[11][1].type = BARREL;
      grid[11][2].type = BARREL;
      // Barrel in SE area
      grid[10][16].type = BARREL;
      // Chair by east wall
      grid[6][16].type = CHAIR;
    }

    // Exit door: 2-tile gap at bottom wall center (leave as road = walkable)
    const doorX = Math.floor(w / 2) - 1;
    grid[h - 1][doorX].type = 1; // road (walkable, acts as exit threshold)
    grid[h - 1][doorX + 1].type = 1;

    this.structure = grid;
    this.startTile = { x: Math.floor(w / 2), y: h - 2 };
    this.stairwellTiles = [];
    this.buildingEntries = [];
    this.bossRooms = [];
    this.mobSpawnPoints = [];
    this.hallwaySpawnPoints = [];
    // Only ground floor (towerFloor 0) or non-tower buildings have exit doors
    if (isTower && towerFloor > 0) {
      // Upper floors: wall off the door gap (no exit)
      grid[h - 1][doorX].type = 2;
      grid[h - 1][doorX + 1].type = 2;
      this._interiorExitTiles = [];
    } else {
      this._interiorExitTiles = [
        { x: doorX, y: h - 1 },
        { x: doorX + 1, y: h - 1 },
      ];
    }

    // Tower stair placement per floor
    this._interiorStairUpTiles = [];
    this._interiorStairDownTiles = [];
    if (isTower) {
      // Stairs up: upper-right area (2 tiles wide)
      const upX = w - 5;
      const upY = 2;
      // Stairs down: upper-left area (2 tiles wide)
      const dnX = 3;
      const dnY = 2;

      const hasUp = towerFloor < 3;
      const hasDown = towerFloor > 0;

      if (hasUp) {
        grid[upY][upX].type = STAIRS_UP;
        this._interiorStairUpTiles = [{ x: upX, y: upY }];
      }
      if (hasDown) {
        grid[dnY][dnX].type = STAIRS_DOWN;
        this._interiorStairDownTiles = [{ x: dnX, y: dnY }];
      }

      // ── Tower floor furniture (30×24, carpet) ──
      // Avoid stair tiles at (upX=25,upY=2) and (dnX=3,dnY=2)
      if (towerFloor === 0) {
        // Ground floor: reception hall — large rug, tables, bookshelves, fireplace
        // Fireplace centered on north wall
        grid[1][14].type = FIREPLACE;
        grid[1][15].type = FIREPLACE;
        // Large rug in center
        for (let ry = 8; ry <= 13; ry++) for (let rx = 10; rx <= 19; rx++) grid[ry][rx].type = RUG;
        // Bookshelves along west wall
        for (let ry = 4; ry <= 10; ry++) grid[ry][1].type = BOOKSHELF;
        // Reception table with chairs
        grid[10][6].type = TABLE;
        grid[10][7].type = TABLE;
        grid[10][8].type = TABLE;
        grid[11][6].type = CHAIR;
        grid[11][8].type = CHAIR;
        grid[9][7].type = CHAIR;
        // Barrels near entrance
        grid[h - 3][1].type = BARREL;
        grid[h - 3][2].type = BARREL;
        grid[h - 3][w - 2].type = BARREL;
        // Torch-style decoration on east wall (use barrel as substitute)
        grid[5][w - 2].type = BARREL;
      } else if (towerFloor === 1) {
        // 2nd floor: library — lots of bookshelves + reading tables
        // Bookshelves along west wall
        for (let ry = 4; ry <= 14; ry++) grid[ry][1].type = BOOKSHELF;
        // Bookshelves along east wall
        for (let ry = 4; ry <= 14; ry++) grid[ry][w - 2].type = BOOKSHELF;
        // Center bookshelf island
        for (let rx = 10; rx <= 13; rx++) grid[6][rx].type = BOOKSHELF;
        for (let rx = 16; rx <= 19; rx++) grid[6][rx].type = BOOKSHELF;
        // Reading tables
        grid[10][8].type = TABLE;
        grid[10][9].type = TABLE;
        grid[11][8].type = CHAIR;
        grid[11][9].type = CHAIR;
        grid[10][16].type = TABLE;
        grid[10][17].type = TABLE;
        grid[11][16].type = CHAIR;
        grid[11][17].type = CHAIR;
        // Rug between tables
        for (let rx = 11; rx <= 14; rx++) {
          grid[10][rx].type = RUG;
          grid[11][rx].type = RUG;
        }
      } else if (towerFloor === 2) {
        // 3rd floor: living quarters — beds, tables, personal items
        // Two beds along west wall
        grid[5][1].type = BED;
        grid[5][2].type = BED;
        grid[6][1].type = BED;
        grid[6][2].type = BED;
        grid[9][1].type = BED;
        grid[9][2].type = BED;
        grid[10][1].type = BED;
        grid[10][2].type = BED;
        // Bookshelf between beds
        grid[7][1].type = BOOKSHELF;
        grid[8][1].type = BOOKSHELF;
        // Table and chairs on east side
        grid[8][w - 5].type = TABLE;
        grid[8][w - 4].type = TABLE;
        grid[8][w - 3].type = TABLE;
        grid[9][w - 5].type = CHAIR;
        grid[9][w - 3].type = CHAIR;
        // Barrel storage
        grid[12][w - 2].type = BARREL;
        grid[13][w - 2].type = BARREL;
        // Rug by beds
        for (let rx = 4; rx <= 6; rx++) {
          grid[6][rx].type = RUG;
          grid[7][rx].type = RUG;
          grid[8][rx].type = RUG;
          grid[9][rx].type = RUG;
        }
        // Fireplace on north wall
        grid[1][14].type = FIREPLACE;
        grid[1][15].type = FIREPLACE;
      } else {
        // Top floor: study/throne room — desk, bookshelves, large rug
        // Bookshelves along both walls
        for (let ry = 4; ry <= 12; ry++) grid[ry][1].type = BOOKSHELF;
        for (let ry = 4; ry <= 12; ry++) grid[ry][w - 2].type = BOOKSHELF;
        // Grand desk at north end
        grid[4][12].type = TABLE;
        grid[4][13].type = TABLE;
        grid[4][14].type = TABLE;
        grid[4][15].type = TABLE;
        grid[4][16].type = TABLE;
        grid[5][14].type = CHAIR;
        // Large rug in center
        for (let ry = 8; ry <= 15; ry++) for (let rx = 8; rx <= 21; rx++) grid[ry][rx].type = RUG;
        // Fireplace on north wall
        grid[1][10].type = FIREPLACE;
        grid[1][11].type = FIREPLACE;
        // Barrel in corners
        grid[h - 3][1].type = BARREL;
        grid[h - 3][w - 2].type = BARREL;
      }
    }

    if (isRestaurant) {
      const interior = { x: 1, y: 1, w: w - 2, h: h - 2 };
      this.safeRooms = [
        {
          bounds: interior,
          centre: { x: Math.floor(w / 2), y: Math.floor(h / 2) },
        },
      ];
      this.safeRoomBounds = interior;
      this.safeRoomCentre = this.safeRooms[0].centre;
    } else {
      this.safeRooms = [];
      this.safeRoomBounds = null;
      this.safeRoomCentre = null;
    }
  }

  /** Exit tile positions populated by generateInterior — used by BuildingInteriorScene. */
  _interiorExitTiles: Array<{ x: number; y: number }> = [];
  /** Interior stair-up tile positions (tower floors). */
  _interiorStairUpTiles: Array<{ x: number; y: number }> = [];
  /** Interior stair-down tile positions (tower floors). */
  _interiorStairDownTiles: Array<{ x: number; y: number }> = [];

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
    const h = (x: number, y: number) => Math.abs(x - goalX) + Math.abs(y - goalY);

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
          (!this.isWalkable(best.x + dir.dx, best.y) || !this.isWalkable(best.x, best.y + dir.dy))
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
    if (this.arenaDoorLocked && this.arenaDoorTileSet.has(`${tileX},${tileY}`)) return false;
    return (
      tile.type !== FloorTypeValue.wall &&
      tile.type !== FloorTypeValue.water &&
      tile.type !== VOID_TYPE &&
      tile.type !== TREE &&
      tile.type !== BUILDING_WALL &&
      tile.type !== METAL_WALL &&
      tile.type !== ROOF_THATCH &&
      tile.type !== ROOF_SLATE &&
      tile.type !== ROOF_RED &&
      tile.type !== ROOF_GREEN &&
      tile.type !== ROOF_CIRCUS_RED &&
      tile.type !== ROOF_CIRCUS_BLUE &&
      tile.type !== ROOF_CIRCUS_PURPLE &&
      tile.type !== FOUNTAIN &&
      tile.type !== TORCH &&
      tile.type !== WELL &&
      tile.type !== TABLE &&
      tile.type !== BOOKSHELF &&
      tile.type !== BED &&
      tile.type !== FIREPLACE &&
      tile.type !== BARREL &&
      tile.type !== CHAIR
      // SAFE_ROOM_FLOOR (10), GRASSY_WEED (22), DIRT_PATCH (23), RUG (37) are walkable
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
  ): void {
    renderCanvas(ctx, this.structure, this.tileHeight, cameraX, cameraY, viewW, viewH);
  }

  renderDecorationsOverlay(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ): void {
    renderDecorationsOverlay(ctx, this.structure, this.tileHeight, cameraX, cameraY, viewW, viewH);
  }

  /** Returns tile coords of all visible decoration tiles (TORCH, WELL, TREE, FOUNTAIN). */
  getVisibleDecorationTiles(
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): Array<{ tx: number; ty: number }> {
    const ts = this.tileHeight;
    const rows = this.structure.length;
    const cols = this.structure[0]?.length ?? rows;
    const startX = Math.max(0, Math.floor(camX / ts));
    const startY = Math.max(0, Math.floor(camY / ts));
    const endX = Math.min(cols - 1, Math.ceil((camX + viewW) / ts));
    const endY = Math.min(rows - 1, Math.ceil((camY + viewH) / ts));
    const result: Array<{ tx: number; ty: number }> = [];
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const t = this.structure[y][x].type;
        if (
          t === TREE ||
          t === TORCH ||
          t === WELL ||
          t === FOUNTAIN ||
          t === BUILDING_WALL ||
          t === ROOF_THATCH ||
          t === ROOF_SLATE ||
          t === ROOF_RED ||
          t === ROOF_GREEN ||
          t === ROOF_CIRCUS_RED ||
          t === ROOF_CIRCUS_BLUE ||
          t === ROOF_CIRCUS_PURPLE
        ) {
          result.push({ tx: x, ty: y });
        }
      }
    }
    return result;
  }

  /** Draws a single decoration tile at full fidelity (for z-sorted rendering). */
  drawDecorationAt(
    ctx: CanvasRenderingContext2D,
    tx: number,
    ty: number,
    camX: number,
    camY: number,
  ): void {
    const ts = this.tileHeight;
    drawDecorationTileFull(ctx, this.structure, tx, ty, tx * ts - camX, ty * ts - camY, ts);
  }
}
