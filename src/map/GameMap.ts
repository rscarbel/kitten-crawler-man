import {
  FloorTypeValue,
  type TileContent,
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
  BARREL_SIDE,
  CRATE,
  BRAZIER,
  MAIN_TOWER,
  SPRITE_BUILDING,
  MODERN_DECORATION,
  WALKABLE_MODERN_DECORATION_VARIANTS,
} from './tileTypes';
import {
  generateDungeon,
  type ArenaExterior,
  type QuestRoomData,
  type TreasureRoomData,
  type SpiderLabRoomData,
} from './DungeonGenerator';
import { generateOverworld } from './OverworldGenerator';
import {
  getBlockedTileOffsets,
  getBlockedTileOffsetsByKey,
  getSpriteDefByKey,
  getSortYAnchorPx,
  getSpriteOverheadPx,
} from '../core/SpriteLoader';
import {
  renderCanvas,
  renderDecorationsOverlay,
  drawDecorationTileFull,
  TileChunkCache,
  OverlayTileCache,
} from './TileRenderer';

// ── Default map construction options ──────────────────────────────────────────
const DEFAULT_MAP_SIZE = 100;
const DEFAULT_TILE_HEIGHT = 10;

// ── Interior building dimensions (width × height in tiles) ────────────────────
const TOWER_INTERIOR_W = 30;
const TOWER_INTERIOR_H = 24;
const RESTAURANT_INTERIOR_W = 22;
const RESTAURANT_INTERIOR_H = 16;
const STORE_INTERIOR_W = 20;
const STORE_INTERIOR_H = 12;
const HOUSE_INTERIOR_W = 18;
const HOUSE_INTERIOR_H = 14;

// ── Floor tile type values used in interior generation ────────────────────────
/** Carpet floor tile (used in tower interiors). */
const CARPET_FLOOR = 7;
/** Wood floor tile (used in house / store interiors). */
const WOOD_FLOOR = 8;
/** Wall tile value, used when filling the outer ring or sealing doors. */
const WALL_TILE = 2;
/** Road tile value (walkable threshold), used for interior exit doors. */
const ROAD_TILE = 1;

// ── Tower stair placement ─────────────────────────────────────────────────────
/** X offset from the east wall for the "stairs up" tile in tower floors. */
const TOWER_STAIR_UP_X_OFFSET = 5;
/** Y row for both stair tiles (near the north wall). */
const TOWER_STAIR_ROW = 2;
/** X column for the "stairs down" tile (near the west wall). */
const TOWER_STAIR_DOWN_COL = 3;
/** Maximum tower floor index — floors 0..3, so the cap is 3. */
const TOWER_TOP_FLOOR = 3;

// ── A* pathfinding constants ──────────────────────────────────────────────────
/** Movement cost for a diagonal step (√2 approximated to 3 decimal places). */
const DIAGONAL_MOVE_COST = 1.414;
/** Maximum A* node expansions per call — keeps per-frame cost bounded. */
const ASTAR_MAX_NODE_EXPANSIONS = 2000;

// ── Line-of-sight sampling ────────────────────────────────────────────────────
/** Fraction of a tile used as the LOS step size (sample every half-tile). */
const LOS_HALF_TILE_FRACTION = 0.5;

/** Options for GameMap construction. */
export interface GameMapOptions {
  mapSize?: number;
  tileHeight?: number;
  numBossRooms?: number;
  numSafeRooms?: number;
  numStairwellsOverride?: number;
  mapType?: 'dungeon' | 'overworld';
  hasArena?: boolean;
  bossTypes?: string[];
  hasSpiderLab?: boolean;
}

export type { SpiderLabRoomData };

export class GameMap {
  structure: TileContent[][];
  tileHeight: number;
  /** Tile coordinates where the player should spawn (centre of the first room). */
  startTile: { x: number; y: number } = { x: 15, y: 15 };
  /** Tile centres of all rooms except the start and safe rooms — used for mob placement. */
  mobSpawnPoints: Array<{ x: number; y: number; w: number; h: number }> = [];
  /** Tile coordinates inside hallways (away from rooms) — used for rat spawning. */
  hallwaySpawnPoints: Array<{ x: number; y: number }> = [];
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
  /** Tile coords of the MAIN_TOWER sprite anchor (overworld only). */
  mainTowerAnchor: { x: number; y: number } | undefined = undefined;
  /** Quest rooms generated in the dungeon (defend-NPC encounters). */
  questRooms: QuestRoomData[] = [];
  /** Spider lab room, if generated (spider quest boss encounter). */
  spiderLabRoom: SpiderLabRoomData | null = null;
  /** Treasure rooms generated in the dungeon (chest encounters). */
  treasureRooms: TreasureRoomData[] = [];
  /** Arena circles generated in the dungeon (one per dungeon map). */
  arenaExteriors: ArenaExterior[] = [];
  /** When true, the arena door gap tiles are treated as unwalkable. */
  arenaDoorLocked = false;
  private arenaDoorTileSet = new Set<string>();
  private extraBlockedTiles = new Set<string>();
  private permanentBlockedTiles = new Set<string>();
  private stairwellBlockedSet = new Set<string>();
  private _chunkCache: TileChunkCache | null = null;
  private _overlayCache: OverlayTileCache | null = null;

  constructor(opts: GameMapOptions = {}) {
    const {
      mapSize = DEFAULT_MAP_SIZE,
      tileHeight = DEFAULT_TILE_HEIGHT,
      numBossRooms = 1,
      numSafeRooms = 2,
      numStairwellsOverride,
      mapType,
      hasArena = false,
      bossTypes = [],
      hasSpiderLab = false,
    } = opts;
    this.tileHeight = tileHeight;
    this.structure = this.generate(
      mapSize,
      numBossRooms,
      numSafeRooms,
      numStairwellsOverride,
      mapType,
      hasArena,
      bossTypes,
      hasSpiderLab,
    );
    this.buildExtraBlockedTiles();
  }

  private generate(
    size: number,
    numBossRooms: number,
    numSafeRooms: number,
    numStairwellsOverride?: number,
    mapType?: 'dungeon' | 'overworld',
    hasArena = false,
    bossTypes: string[] = [],
    hasSpiderLab = false,
  ): TileContent[][] {
    if (mapType === 'overworld') {
      const data = generateOverworld(size);
      this.startTile = data.startTile;
      this.safeRooms = data.safeRooms;
      this.buildingEntries = data.buildingEntries;
      this.bossRooms = data.bossRooms;
      this.mobSpawnPoints = [];
      this.hallwaySpawnPoints = data.hallwaySpawnPoints;
      this.stairwellTiles = data.stairwellTiles;
      this.buildStairwellBlockedSet(data.stairwellTiles);
      this.mainTowerAnchor = data.mainTowerAnchor;
      return data.grid;
    }

    const data = generateDungeon(
      size,
      numBossRooms,
      numSafeRooms,
      numStairwellsOverride,
      hasArena,
      bossTypes,
      hasSpiderLab,
    );
    this.startTile = data.startTile;
    this.safeRooms = data.safeRooms;
    this.bossRooms = data.bossRooms;
    this.questRooms = data.questRooms;
    this.treasureRooms = data.treasureRooms;
    this.spiderLabRoom = data.spiderLabRoom;
    this.mobSpawnPoints = data.mobSpawnPoints;
    this.hallwaySpawnPoints = data.hallwaySpawnPoints;
    this.stairwellTiles = data.stairwellTiles;
    this.buildStairwellBlockedSet(data.stairwellTiles);
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
        this.addToStairwellBlockedSet(arena.stairwellTile);
      }
    }
  }

  private buildStairwellBlockedSet(tiles: ReadonlyArray<{ x: number; y: number }>): void {
    this.stairwellBlockedSet.clear();
    for (const s of tiles) {
      this.addToStairwellBlockedSet(s);
    }
  }

  private addToStairwellBlockedSet(s: { x: number; y: number }): void {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        this.stairwellBlockedSet.add(`${s.x + dx},${s.y + dy}`);
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
    const w = isTower
      ? TOWER_INTERIOR_W
      : isRestaurant
        ? RESTAURANT_INTERIOR_W
        : isStore
          ? STORE_INTERIOR_W
          : HOUSE_INTERIOR_W;
    const h = isTower
      ? TOWER_INTERIOR_H
      : isRestaurant
        ? RESTAURANT_INTERIOR_H
        : isStore
          ? STORE_INTERIOR_H
          : HOUSE_INTERIOR_H;
    const floorType = isTower ? CARPET_FLOOR : isRestaurant ? SAFE_ROOM_FLOOR : WOOD_FLOOR;

    const grid: TileContent[][] = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => ({
        tileId: `${x}#${y}`,
        type: WALL_TILE,
      })),
    );

    // Carve interior floor
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) grid[y][x].type = floorType;

    if (isStore && !isCarnival) {
      const storeCounterRow = 2;
      const storeBehindCounterRow = 3;
      const storeShelfStartRow = 4;
      const storeShelfEndRow = 6;
      const storeRugStartCol = 5;
      const storeRugEndCol = 8;
      // w - STORE_EAST_WALL_INSET = second column from east inner wall
      const STORE_EAST_WALL_INSET = 3;
      // h - STORE_ENTRANCE_ROW_INSET = rows before the south wall
      const STORE_ENTRANCE_ROW_INSET = 3;
      // Counter along the north interior (row 2, cols 2–17) — keeps shopkeeper separate
      for (let x = 2; x <= w - STORE_EAST_WALL_INSET; x++)
        grid[storeCounterRow][x].type = FloorTypeValue.wall;
      // Barrels behind counter on east side
      grid[storeBehindCounterRow][w - STORE_EAST_WALL_INSET].type = BARREL;
      grid[storeBehindCounterRow][w - STORE_EAST_WALL_INSET - 1].type = BARREL;
      grid[storeShelfStartRow][w - STORE_EAST_WALL_INSET].type = BARREL;
      // Bookshelf (display shelf) on west wall
      grid[storeShelfStartRow][1].type = BOOKSHELF;
      grid[storeShelfStartRow + 1][1].type = BOOKSHELF;
      grid[storeShelfEndRow][1].type = BOOKSHELF;
      // Barrel cluster near entrance
      grid[h - STORE_ENTRANCE_ROW_INSET][1].type = BARREL;
      grid[h - STORE_ENTRANCE_ROW_INSET][w - 2].type = BARREL;
      // Small rug in front of counter
      for (let x = storeRugStartCol; x <= storeRugEndCol; x++)
        grid[storeShelfStartRow][x].type = RUG;
      for (let x = storeRugStartCol; x <= storeRugEndCol; x++)
        grid[storeShelfStartRow + 1][x].type = RUG;
    }

    if (isRestaurant) {
      const restaurantCounterRow = 2;
      const restaurantCounterEndCol = 8;
      const restaurantTableRowA = 5;
      const restaurantChairRowA = 6;
      const restaurantTableCol1 = 2;
      const restaurantTableCol2 = 3;
      const restaurantTableCol3 = 5;
      const restaurantTableCol4 = 6;
      const restaurantEastTableCol1 = 14;
      const restaurantEastTableCol2 = 15;
      const restaurantEastTableCol3 = 17;
      const restaurantEastTableCol4 = 18;
      const restaurantTableRowB = 9;
      const restaurantChairRowB = 10;
      const restaurantBarrelRow = 3;
      const restaurantBarrelCol1 = 9;
      const restaurantBarrelCol2 = 10;
      // Counter along the north wall (row 2, cols 2–8) — non-walkable wall tiles
      for (let x = 2; x <= restaurantCounterEndCol; x++)
        grid[restaurantCounterRow][x].type = FloorTypeValue.wall;
      // Two 2×1 tables in the dining area (rows 5–6, cols 2–3 and 5–6)
      grid[restaurantTableRowA][restaurantTableCol1].type = TABLE;
      grid[restaurantTableRowA][restaurantTableCol2].type = TABLE;
      grid[restaurantChairRowA][restaurantTableCol1].type = CHAIR;
      grid[restaurantChairRowA][restaurantTableCol2].type = CHAIR;
      grid[restaurantTableRowA][restaurantTableCol3].type = TABLE;
      grid[restaurantTableRowA][restaurantTableCol4].type = TABLE;
      grid[restaurantChairRowA][restaurantTableCol3].type = CHAIR;
      grid[restaurantChairRowA][restaurantTableCol4].type = CHAIR;
      // Two more tables on the east side (rows 5–6, cols 14–15 and 17–18)
      grid[restaurantTableRowA][restaurantEastTableCol1].type = TABLE;
      grid[restaurantTableRowA][restaurantEastTableCol2].type = TABLE;
      grid[restaurantChairRowA][restaurantEastTableCol1].type = CHAIR;
      grid[restaurantChairRowA][restaurantEastTableCol2].type = CHAIR;
      grid[restaurantTableRowA][restaurantEastTableCol3].type = TABLE;
      grid[restaurantTableRowA][restaurantEastTableCol4].type = TABLE;
      grid[restaurantChairRowA][restaurantEastTableCol3].type = CHAIR;
      grid[restaurantChairRowA][restaurantEastTableCol4].type = CHAIR;
      // Two more tables deeper in (rows 9–10)
      grid[restaurantTableRowB][restaurantTableCol1].type = TABLE;
      grid[restaurantTableRowB][restaurantTableCol2].type = TABLE;
      grid[restaurantChairRowB][restaurantTableCol1].type = CHAIR;
      grid[restaurantChairRowB][restaurantTableCol2].type = CHAIR;
      grid[restaurantTableRowB][restaurantTableCol3].type = TABLE;
      grid[restaurantTableRowB][restaurantTableCol4].type = TABLE;
      grid[restaurantChairRowB][restaurantTableCol3].type = CHAIR;
      grid[restaurantChairRowB][restaurantTableCol4].type = CHAIR;
      // Barrel near kitchen counter
      grid[restaurantBarrelRow][restaurantBarrelCol1].type = BARREL;
      grid[restaurantBarrelRow][restaurantBarrelCol2].type = BARREL;
    }

    // ── Named building interiors — each has a unique hand-crafted layout ──
    const NAMED_BUILDINGS = [
      "Shepherd's Cabin",
      'Blackwood Barracks',
      "Old Hilda's Cottage",
      "Cartwright's Workshop",
      'Herb & Remedy',
      'The Sleeping Cat Inn',
      'The Rusty Anvil',
      "Miller's Farm",
      "The Wanderer's Rest",
      'The Sunken Stump Pub',
    ] as const;
    const isNamedBuilding = NAMED_BUILDINGS.some((n) => n === buildingName);

    if (isHouse && isNamedBuilding) {
      switch (buildingName) {
        case "Shepherd's Cabin": {
          // Rustic shepherd's dwelling — hearth, simple cot, supply barrels
          const cabinHearth1 = 4;
          const cabinHearth2 = 5;
          const cabinBedNorthRow = 2;
          const cabinBedSouthRow = 3;
          const cabinBedWestCol = 14;
          const cabinBedEastCol = 15;
          const cabinBarrelEndRow = 6;
          const cabinTableRow = 7;
          const cabinTableCol1 = 8;
          const cabinTableCol2 = 9;
          const cabinChairRow = 8;
          const cabinSouthRow = 11;
          const cabinBarrelSideRow = 10;
          grid[1][cabinHearth1].type = FIREPLACE;
          grid[1][cabinHearth2].type = FIREPLACE;
          grid[cabinBedNorthRow][cabinBedWestCol].type = BED;
          grid[cabinBedNorthRow][cabinBedEastCol].type = BED;
          grid[cabinBedSouthRow][cabinBedWestCol].type = BED;
          grid[cabinBedSouthRow][cabinBedEastCol].type = BED;
          grid[cabinHearth1][1].type = BARREL;
          grid[cabinHearth2][1].type = BARREL;
          grid[cabinBarrelEndRow][1].type = BARREL;
          grid[cabinTableRow][cabinTableCol1].type = TABLE;
          grid[cabinTableRow][cabinTableCol2].type = TABLE;
          grid[cabinChairRow][cabinTableCol1].type = CHAIR;
          grid[cabinSouthRow][1].type = CRATE;
          grid[cabinSouthRow][2].type = CRATE;
          grid[cabinBarrelSideRow][cabinBedEastCol].type = BARREL_SIDE;
          break;
        }

        case 'Blackwood Barracks': {
          // Military barracks — rows of bunks, briefing table, crate storage
          const barracksBunkRow1 = 2;
          const barracksBunkRow2 = 3;
          const barracksBunkRow3 = 5;
          const barracksBunkRow4 = 6;
          const barracksEastBedCol1 = 14;
          const barracksEastBedCol2 = 15;
          const barracksBriefingRow = 7;
          const barracksBriefingTableCol1 = 7;
          const barracksBriefingTableCol2 = 8;
          const barracksBriefingTableCol3 = 9;
          const barracksChairRow = 8;
          const barracksCrateRow1 = 10;
          const barracksCrateRow2 = 11;
          grid[barracksBunkRow1][1].type = BED;
          grid[barracksBunkRow1][2].type = BED;
          grid[barracksBunkRow2][1].type = BED;
          grid[barracksBunkRow2][2].type = BED;
          grid[barracksBunkRow3][1].type = BED;
          grid[barracksBunkRow3][2].type = BED;
          grid[barracksBunkRow4][1].type = BED;
          grid[barracksBunkRow4][2].type = BED;
          grid[barracksBunkRow1][barracksEastBedCol1].type = BED;
          grid[barracksBunkRow1][barracksEastBedCol2].type = BED;
          grid[barracksBunkRow2][barracksEastBedCol1].type = BED;
          grid[barracksBunkRow2][barracksEastBedCol2].type = BED;
          grid[barracksBunkRow3][barracksEastBedCol1].type = BED;
          grid[barracksBunkRow3][barracksEastBedCol2].type = BED;
          grid[barracksBunkRow4][barracksEastBedCol1].type = BED;
          grid[barracksBunkRow4][barracksEastBedCol2].type = BED;
          grid[barracksBriefingRow][barracksBriefingTableCol1].type = TABLE;
          grid[barracksBriefingRow][barracksBriefingTableCol2].type = TABLE;
          grid[barracksBriefingRow][barracksBriefingTableCol3].type = TABLE;
          grid[barracksChairRow][barracksBriefingTableCol1].type = CHAIR;
          grid[barracksChairRow][barracksBriefingTableCol3].type = CHAIR;
          grid[barracksCrateRow1][1].type = CRATE;
          grid[barracksCrateRow2][1].type = CRATE;
          grid[barracksCrateRow1][barracksEastBedCol2].type = CRATE;
          grid[barracksCrateRow2][barracksEastBedCol2].type = CRATE;
          grid[barracksCrateRow2][barracksBriefingTableCol2].type = BARREL;
          break;
        }

        case "Old Hilda's Cottage": {
          // Witch's lair — cauldron braziers, dense spell-book shelves, work table
          const hildaBrazierCol1 = 8;
          const hildaBrazierCol2 = 9;
          const hildaWestShelfStartRow = 2;
          const hildaWestShelfEndRow = 7;
          const hildaEastShelfEndRow = 5;
          const hildaEastShelfCol = HOUSE_INTERIOR_W - 2;
          const hildaTableRow = 5;
          const hildaTableCol1 = 7;
          const hildaTableCol2 = 8;
          const hildaChairRow = 6;
          const hildaBarrelRow1 = 8;
          const hildaBarrelRow2 = 9;
          const hildaCrateRow = 11;
          const hildaCrateCol1 = 13;
          const hildaCrateCol2 = 14;
          grid[1][hildaBrazierCol1].type = BRAZIER;
          grid[1][hildaBrazierCol2].type = BRAZIER;
          for (let ry = hildaWestShelfStartRow; ry <= hildaWestShelfEndRow; ry++)
            grid[ry][1].type = BOOKSHELF;
          for (let ry = hildaWestShelfStartRow; ry <= hildaEastShelfEndRow; ry++)
            grid[ry][hildaEastShelfCol].type = BOOKSHELF;
          grid[hildaTableRow][hildaTableCol1].type = TABLE;
          grid[hildaTableRow][hildaTableCol2].type = TABLE;
          grid[hildaChairRow][hildaTableCol1].type = CHAIR;
          grid[hildaBarrelRow1][1].type = BARREL;
          grid[hildaBarrelRow2][1].type = BARREL;
          grid[hildaBarrelRow2][hildaTableCol2].type = BARREL_SIDE;
          grid[hildaBarrelRow2][hildaBrazierCol2].type = BARREL_SIDE;
          grid[hildaCrateRow][hildaCrateCol1].type = CRATE;
          grid[hildaCrateRow][hildaCrateCol2].type = CRATE;
          break;
        }

        case "Cartwright's Workshop": {
          // Builder's shop — dual north workbenches, raw material crates, scattered supplies
          const cartwrightBenchRow = 2;
          const cartwrightBench1StartCol = 3;
          const cartwrightBench1EndCol = 7;
          const cartwrightBench2StartCol = 10;
          const cartwrightBench2EndCol = 14;
          const cartwrightCrateStartRow = 4;
          const cartwrightCrateEndRow = 7;
          const cartwrightEastWallCol = HOUSE_INTERIOR_W - 2;
          const cartwrightBarrelRow = 8;
          const cartwrightBarrelCol1 = 4;
          const cartwrightBarrelCol2 = 5;
          const cartwrightBarrelCol3 = 11;
          const cartwrightBarrelCol4 = 12;
          const cartwrightTableRow = 5;
          const cartwrightTableCol1 = 8;
          const cartwrightTableCol2 = 9;
          const cartwrightSouthRow = 11;
          const cartwrightSouthCrateCol1 = 14;
          const cartwrightSouthCrateCol2 = 15;
          for (let rx = cartwrightBench1StartCol; rx <= cartwrightBench1EndCol; rx++)
            grid[cartwrightBenchRow][rx].type = TABLE;
          for (let rx = cartwrightBench2StartCol; rx <= cartwrightBench2EndCol; rx++)
            grid[cartwrightBenchRow][rx].type = TABLE;
          for (let ry = cartwrightCrateStartRow; ry <= cartwrightCrateEndRow; ry++)
            grid[ry][1].type = CRATE;
          for (let ry = cartwrightCrateStartRow; ry <= cartwrightCrateEndRow - 1; ry++)
            grid[ry][cartwrightEastWallCol].type = BARREL;
          grid[cartwrightBarrelRow][cartwrightBarrelCol1].type = BARREL_SIDE;
          grid[cartwrightBarrelRow][cartwrightBarrelCol2].type = BARREL_SIDE;
          grid[cartwrightBarrelRow][cartwrightBarrelCol3].type = BARREL_SIDE;
          grid[cartwrightBarrelRow][cartwrightBarrelCol4].type = BARREL_SIDE;
          grid[cartwrightTableRow][cartwrightTableCol1].type = TABLE;
          grid[cartwrightTableRow][cartwrightTableCol2].type = TABLE;
          grid[cartwrightTableRow + 1][cartwrightTableCol1].type = CHAIR;
          grid[cartwrightSouthRow][1].type = BARREL;
          grid[cartwrightSouthRow][2].type = BARREL;
          grid[cartwrightSouthRow][cartwrightSouthCrateCol1].type = CRATE;
          grid[cartwrightSouthRow][cartwrightSouthCrateCol2].type = CRATE;
          break;
        }

        case 'Herb & Remedy': {
          // Apothecary — counter, dense ingredient shelves, display table
          const herbCounterRow = 2;
          const herbCounterStartCol = 5;
          const herbCounterEndCol = 13;
          const herbShelfStartRow = 3;
          const herbWestShelfEndRow = 7;
          const herbEastShelfEndRow = 6;
          const herbEastShelfCol = HOUSE_INTERIOR_W - 2;
          const herbBarrelRow1 = 3;
          const herbBarrelRow2 = 4;
          const herbBarrelCol1 = 14;
          const herbBarrelCol2 = 15;
          const herbRugStartCol = 4;
          const herbRugEndCol = 12;
          const herbTableRow = 8;
          const herbTableCol1 = 7;
          const herbTableCol2 = 8;
          const herbBarrelSideCol = 3;
          for (let rx = herbCounterStartCol; rx <= herbCounterEndCol; rx++)
            grid[herbCounterRow][rx].type = FloorTypeValue.wall;
          for (let ry = herbShelfStartRow; ry <= herbWestShelfEndRow; ry++)
            grid[ry][1].type = BOOKSHELF;
          for (let ry = herbShelfStartRow; ry <= herbEastShelfEndRow; ry++)
            grid[ry][herbEastShelfCol].type = BOOKSHELF;
          grid[herbBarrelRow1][herbBarrelCol1].type = BARREL;
          grid[herbBarrelRow1][herbBarrelCol2].type = BARREL;
          grid[herbBarrelRow2][herbBarrelCol1].type = BARREL;
          for (let rx = herbRugStartCol; rx <= herbRugEndCol; rx++) {
            grid[herbBarrelRow2][rx].type = RUG;
            grid[herbBarrelRow2 + 1][rx].type = RUG;
          }
          grid[herbTableRow][herbTableCol1].type = TABLE;
          grid[herbTableRow][herbTableCol2].type = TABLE;
          grid[herbTableRow][herbBarrelSideCol].type = BARREL_SIDE;
          break;
        }

        case 'The Sleeping Cat Inn': {
          // Cozy inn — west & east guest rooms, common dining area, innkeeper desk
          const innFireplaceCol1 = 8;
          const innFireplaceCol2 = 9;
          const innBunkRow1 = 2;
          const innBunkRow2 = 3;
          const innBunkRow3 = 5;
          const innBunkRow4 = 6;
          const innEastBedCol1 = 14;
          const innEastBedCol2 = 15;
          const innRugRow = 4;
          const innRugStartCol = 4;
          const innRugEndCol = 13;
          const innDiningRow = 7;
          const innDiningChairRow = 8;
          const innWestTableCol1 = 4;
          const innWestTableCol2 = 5;
          const innEastTableCol1 = 11;
          const innEastTableCol2 = 12;
          const innCenterTableRow = 6;
          const innCenterTableCol1 = 7;
          const innCenterTableCol2 = 8;
          const innCenterTableCol3 = 9;
          const innSouthRow = 11;
          grid[1][innFireplaceCol1].type = FIREPLACE;
          grid[1][innFireplaceCol2].type = FIREPLACE;
          grid[innBunkRow1][1].type = BED;
          grid[innBunkRow1][2].type = BED;
          grid[innBunkRow2][1].type = BED;
          grid[innBunkRow2][2].type = BED;
          grid[innBunkRow3][1].type = BED;
          grid[innBunkRow3][2].type = BED;
          grid[innBunkRow4][1].type = BED;
          grid[innBunkRow4][2].type = BED;
          grid[innBunkRow1][innEastBedCol1].type = BED;
          grid[innBunkRow1][innEastBedCol2].type = BED;
          grid[innBunkRow2][innEastBedCol1].type = BED;
          grid[innBunkRow2][innEastBedCol2].type = BED;
          grid[innBunkRow3][innEastBedCol1].type = BED;
          grid[innBunkRow3][innEastBedCol2].type = BED;
          grid[innBunkRow4][innEastBedCol1].type = BED;
          grid[innBunkRow4][innEastBedCol2].type = BED;
          for (let rx = innRugStartCol; rx <= innRugEndCol; rx++) grid[innRugRow][rx].type = RUG;
          grid[innDiningRow][innWestTableCol1].type = TABLE;
          grid[innDiningRow][innWestTableCol2].type = TABLE;
          grid[innDiningChairRow][innWestTableCol1].type = CHAIR;
          grid[innDiningChairRow][innWestTableCol2].type = CHAIR;
          grid[innDiningRow][innEastTableCol1].type = TABLE;
          grid[innDiningRow][innEastTableCol2].type = TABLE;
          grid[innDiningChairRow][innEastTableCol1].type = CHAIR;
          grid[innDiningChairRow][innEastTableCol2].type = CHAIR;
          grid[innCenterTableRow][innCenterTableCol1].type = TABLE;
          grid[innCenterTableRow][innCenterTableCol2].type = TABLE;
          grid[innCenterTableRow][innCenterTableCol3].type = TABLE;
          grid[innDiningRow][innCenterTableCol1].type = CHAIR;
          grid[innSouthRow][1].type = BARREL;
          grid[innSouthRow][2].type = BARREL;
          break;
        }

        case 'The Rusty Anvil': {
          // Blacksmith — twin forge braziers, anvil tables, raw material crates
          const anvilWestForgeCol1 = 3;
          const anvilWestForgeCol2 = 4;
          const anvilEastForgeCol1 = 13;
          const anvilEastForgeCol2 = 14;
          const anvilTableRow = 3;
          const anvilCrateStartRow = 5;
          const anvilCrateEndRow = 9;
          const anvilEastWallCol = HOUSE_INTERIOR_W - 2;
          const anvilBarrelSideRow = 5;
          const anvilBarrelSideCol1 = 7;
          const anvilBarrelSideCol2 = 8;
          const anvilBarrelSideCol3 = 9;
          const anvilBarrelSideCol4 = 10;
          const anvilChairRow = 4;
          const anvilSouthRow = 11;
          grid[1][anvilWestForgeCol1].type = BRAZIER;
          grid[1][anvilWestForgeCol2].type = BRAZIER;
          grid[1][anvilEastForgeCol1].type = BRAZIER;
          grid[1][anvilEastForgeCol2].type = BRAZIER;
          grid[anvilTableRow][anvilWestForgeCol1].type = TABLE;
          grid[anvilTableRow][anvilWestForgeCol2].type = TABLE;
          grid[anvilTableRow][anvilEastForgeCol1].type = TABLE;
          grid[anvilTableRow][anvilEastForgeCol2].type = TABLE;
          for (let ry = anvilCrateStartRow; ry <= anvilCrateEndRow; ry++) grid[ry][1].type = CRATE;
          grid[anvilCrateStartRow][anvilEastWallCol].type = BARREL;
          grid[anvilCrateStartRow + 1][anvilEastWallCol].type = BARREL;
          grid[anvilCrateStartRow + 2][anvilEastWallCol].type = BARREL;
          grid[anvilBarrelSideRow][anvilBarrelSideCol1].type = BARREL_SIDE;
          grid[anvilBarrelSideRow][anvilBarrelSideCol2].type = BARREL_SIDE;
          grid[anvilBarrelSideRow][anvilBarrelSideCol3].type = BARREL_SIDE;
          grid[anvilBarrelSideRow][anvilBarrelSideCol4].type = BARREL_SIDE;
          grid[anvilChairRow][anvilBarrelSideCol1].type = CHAIR;
          grid[anvilSouthRow][1].type = CRATE;
          grid[anvilSouthRow][2].type = CRATE;
          grid[anvilSouthRow][anvilEastForgeCol2].type = BARREL;
          grid[anvilSouthRow][anvilEastWallCol - 1].type = BARREL;
          break;
        }

        case "Miller's Farm": {
          // Farmhouse — hearth, single bed, harvest crates along east wall
          const farmHearth1 = 2;
          const farmHearth2 = 3;
          const farmBedNorthRow = 2;
          const farmBedSouthRow = 3;
          const farmBedWestCol = 14;
          const farmBedEastCol = 15;
          const farmEastWallCol = HOUSE_INTERIOR_W - 2;
          const farmCrateStartRow = 4;
          const farmCrateEndRow = 7;
          const farmTableRow = 8;
          const farmTableCol1 = 7;
          const farmTableCol2 = 8;
          const farmBarrelSideRow1 = 10;
          const farmBarrelSideRow2 = 11;
          grid[1][farmHearth1].type = FIREPLACE;
          grid[1][farmHearth2].type = FIREPLACE;
          grid[farmBedNorthRow][farmBedWestCol].type = BED;
          grid[farmBedNorthRow][farmBedEastCol].type = BED;
          grid[farmBedSouthRow][farmBedWestCol].type = BED;
          grid[farmBedSouthRow][farmBedEastCol].type = BED;
          grid[farmCrateStartRow][1].type = BARREL;
          grid[farmCrateStartRow + 1][1].type = BARREL;
          grid[farmCrateStartRow + 2][1].type = BARREL;
          grid[farmCrateStartRow][farmEastWallCol].type = CRATE;
          grid[farmCrateStartRow + 1][farmEastWallCol].type = CRATE;
          grid[farmCrateStartRow + 2][farmEastWallCol].type = CRATE;
          grid[farmCrateEndRow][farmEastWallCol].type = CRATE;
          grid[farmTableRow][farmTableCol1].type = TABLE;
          grid[farmTableRow][farmTableCol2].type = TABLE;
          grid[farmTableRow + 1][farmTableCol1].type = CHAIR;
          grid[farmTableRow + 1][farmTableCol2].type = CHAIR;
          grid[farmBarrelSideRow1][1].type = BARREL_SIDE;
          grid[farmBarrelSideRow2][1].type = BARREL_SIDE;
          break;
        }

        case "The Wanderer's Rest": {
          // Budget dormitory — wall-to-wall bunks, minimal communal table
          const wandererBunkRow1 = 2;
          const wandererBunkRow2 = 3;
          const wandererBunkRow3 = 5;
          const wandererBunkRow4 = 6;
          const wandererBunkRow5 = 8;
          const wandererBunkRow6 = 9;
          const wandererEastBedCol1 = 14;
          const wandererEastBedCol2 = 15;
          const wandererTableRow = 6;
          const wandererTableCol1 = 7;
          const wandererTableCol2 = 8;
          const wandererTableCol3 = 9;
          const wandererChairRow = 7;
          const wandererSouthRow = 11;
          const wandererSouthEastBarrelCol = HOUSE_INTERIOR_W - 2;
          grid[wandererBunkRow1][1].type = BED;
          grid[wandererBunkRow1][2].type = BED;
          grid[wandererBunkRow2][1].type = BED;
          grid[wandererBunkRow2][2].type = BED;
          grid[wandererBunkRow3][1].type = BED;
          grid[wandererBunkRow3][2].type = BED;
          grid[wandererBunkRow4][1].type = BED;
          grid[wandererBunkRow4][2].type = BED;
          grid[wandererBunkRow5][1].type = BED;
          grid[wandererBunkRow5][2].type = BED;
          grid[wandererBunkRow6][1].type = BED;
          grid[wandererBunkRow6][2].type = BED;
          grid[wandererBunkRow1][wandererEastBedCol1].type = BED;
          grid[wandererBunkRow1][wandererEastBedCol2].type = BED;
          grid[wandererBunkRow2][wandererEastBedCol1].type = BED;
          grid[wandererBunkRow2][wandererEastBedCol2].type = BED;
          grid[wandererBunkRow3][wandererEastBedCol1].type = BED;
          grid[wandererBunkRow3][wandererEastBedCol2].type = BED;
          grid[wandererBunkRow4][wandererEastBedCol1].type = BED;
          grid[wandererBunkRow4][wandererEastBedCol2].type = BED;
          grid[wandererTableRow][wandererTableCol1].type = TABLE;
          grid[wandererTableRow][wandererTableCol2].type = TABLE;
          grid[wandererTableRow][wandererTableCol3].type = TABLE;
          grid[wandererChairRow][wandererTableCol1].type = CHAIR;
          grid[wandererChairRow][wandererTableCol3].type = CHAIR;
          grid[wandererSouthRow][1].type = BARREL;
          grid[wandererSouthRow][wandererSouthEastBarrelCol].type = BARREL;
          break;
        }

        case 'The Sunken Stump Pub': {
          // Village pub — bar counter, rows of drinking tables, large floor rug
          const pubCounterRow = 2;
          const pubCounterEndCol = 7;
          const pubBarrelRow1 = 3;
          const pubBarrelRow2 = 4;
          const pubFireplaceCol1 = 14;
          const pubFireplaceCol2 = 15;
          const pubFrontTableRow = 6;
          const pubFrontChairRow = 7;
          const pubWestTableCol1 = 3;
          const pubWestTableCol2 = 4;
          const pubCenterTableCol1 = 8;
          const pubCenterTableCol2 = 9;
          const pubEastFrontTableCol1 = 13;
          const pubEastFrontTableCol2 = 14;
          const pubBackTableRow = 9;
          const pubBackChairRow = 10;
          const pubBackWestTableCol1 = 5;
          const pubBackWestTableCol2 = 6;
          const pubBackEastTableCol1 = 11;
          const pubBackEastTableCol2 = 12;
          const pubRugRow = 5;
          const pubRugStartCol = 3;
          const pubRugEndCol = 15;
          const pubBarChairCol = 8;
          const pubSouthRow = 11;
          for (let rx = 2; rx <= pubCounterEndCol; rx++)
            grid[pubCounterRow][rx].type = FloorTypeValue.wall;
          grid[pubBarrelRow1][1].type = BARREL;
          grid[pubBarrelRow1][2].type = BARREL;
          grid[pubBarrelRow2][1].type = BARREL;
          grid[pubBarrelRow2][2].type = BARREL;
          grid[1][pubFireplaceCol1].type = FIREPLACE;
          grid[1][pubFireplaceCol2].type = FIREPLACE;
          grid[pubFrontTableRow][pubWestTableCol1].type = TABLE;
          grid[pubFrontTableRow][pubWestTableCol2].type = TABLE;
          grid[pubFrontChairRow][pubWestTableCol1].type = CHAIR;
          grid[pubFrontChairRow][pubWestTableCol2].type = CHAIR;
          grid[pubFrontTableRow][pubCenterTableCol1].type = TABLE;
          grid[pubFrontTableRow][pubCenterTableCol2].type = TABLE;
          grid[pubFrontChairRow][pubCenterTableCol1].type = CHAIR;
          grid[pubFrontChairRow][pubCenterTableCol2].type = CHAIR;
          grid[pubFrontTableRow][pubEastFrontTableCol1].type = TABLE;
          grid[pubFrontTableRow][pubEastFrontTableCol2].type = TABLE;
          grid[pubFrontChairRow][pubEastFrontTableCol1].type = CHAIR;
          grid[pubFrontChairRow][pubEastFrontTableCol2].type = CHAIR;
          grid[pubBackTableRow][pubBackWestTableCol1].type = TABLE;
          grid[pubBackTableRow][pubBackWestTableCol2].type = TABLE;
          grid[pubBackChairRow][pubBackWestTableCol1].type = CHAIR;
          grid[pubBackChairRow][pubBackWestTableCol2].type = CHAIR;
          grid[pubBackTableRow][pubBackEastTableCol1].type = TABLE;
          grid[pubBackTableRow][pubBackEastTableCol2].type = TABLE;
          grid[pubBackChairRow][pubBackEastTableCol1].type = CHAIR;
          grid[pubBackChairRow][pubBackEastTableCol2].type = CHAIR;
          for (let rx = pubRugStartCol; rx <= pubRugEndCol; rx++) grid[pubRugRow][rx].type = RUG;
          grid[pubBarrelRow1][pubBarChairCol].type = CHAIR;
          grid[pubSouthRow][pubFireplaceCol1].type = BARREL_SIDE;
          grid[pubSouthRow][pubFireplaceCol2].type = BARREL_SIDE;
          break;
        }
      }
    }

    // ── Generic house furniture (unnamed / unnamed overworld houses) ──
    if (isHouse && !isCarnival && !isNamedBuilding) {
      const genericFireplaceCol1 = 8;
      const genericFireplaceCol2 = 9;
      const genericRugStartCol = 7;
      const genericRugEndCol = 10;
      const genericBedNorthRow = 2;
      const genericBedSouthRow = 3;
      // HOUSE_INTERIOR_W=18: east col=16, second-from-east=15
      const HOUSE_EAST_WALL_COL = HOUSE_INTERIOR_W - 2;
      const HOUSE_SECOND_EAST_COL = HOUSE_INTERIOR_W - 2 - 1;
      // HOUSE_INTERIOR_H=14: south row index=13, pre-south=11, two-before-south=10
      const HOUSE_PRE_SOUTH_ROW = HOUSE_INTERIOR_H - 2 - 1;
      const HOUSE_BARREL_ROW = HOUSE_INTERIOR_H - 2 - 2;
      const genericBedWestCol = HOUSE_SECOND_EAST_COL;
      const genericBedEastCol = HOUSE_EAST_WALL_COL;
      const genericShelfStartRow = 3;
      const genericShelfEndRow = 5;
      const genericTableRow = 7;
      const genericTableCol1 = 7;
      const genericTableCol2 = 8;
      const genericTableCol3 = 9;
      const genericChairRow = 8;
      const genericSouthRow = HOUSE_PRE_SOUTH_ROW;
      const genericEastWallCol = HOUSE_EAST_WALL_COL;
      const genericEastBarrelRow = HOUSE_BARREL_ROW;
      const genericEastChairRow = 6;
      // Fireplace centered on north wall
      grid[1][genericFireplaceCol1].type = FIREPLACE;
      grid[1][genericFireplaceCol2].type = FIREPLACE;
      // Rug in front of fireplace
      for (let x = genericRugStartCol; x <= genericRugEndCol; x++) {
        grid[2][x].type = RUG;
        grid[genericBedSouthRow][x].type = RUG;
      }
      // Bed in NE corner
      grid[genericBedNorthRow][genericBedWestCol].type = BED;
      grid[genericBedNorthRow][genericBedEastCol].type = BED;
      grid[genericBedSouthRow][genericBedWestCol].type = BED;
      grid[genericBedSouthRow][genericBedEastCol].type = BED;
      // Bookshelf on west wall
      grid[genericShelfStartRow][1].type = BOOKSHELF;
      grid[genericShelfStartRow + 1][1].type = BOOKSHELF;
      grid[genericShelfEndRow][1].type = BOOKSHELF;
      // Dining table with chairs in center-south area
      grid[genericTableRow][genericTableCol1].type = TABLE;
      grid[genericTableRow][genericTableCol2].type = TABLE;
      grid[genericTableRow][genericTableCol3].type = TABLE;
      grid[genericChairRow][genericTableCol1].type = CHAIR;
      grid[genericChairRow][genericTableCol3].type = CHAIR;
      // Barrel in SW corner
      grid[genericSouthRow][1].type = BARREL;
      grid[genericSouthRow][2].type = BARREL;
      // Barrel in SE area
      grid[genericEastBarrelRow][genericEastWallCol].type = BARREL;
      // Chair by east wall
      grid[genericEastChairRow][genericEastWallCol].type = CHAIR;
    }

    // Exit door: 2-tile gap at bottom wall center (leave as road = walkable)
    const doorX = Math.floor(w / 2) - 1;
    grid[h - 1][doorX].type = ROAD_TILE;
    grid[h - 1][doorX + 1].type = ROAD_TILE;

    this.structure = grid;
    this.buildExtraBlockedTiles();
    this.startTile = { x: Math.floor(w / 2), y: h - 2 };
    this.stairwellTiles = [];
    this.buildingEntries = [];
    this.bossRooms = [];
    this.mobSpawnPoints = [];
    this.hallwaySpawnPoints = [];
    // Only ground floor (towerFloor 0) or non-tower buildings have exit doors
    if (isTower && towerFloor > 0) {
      // Upper floors: wall off the door gap (no exit)
      grid[h - 1][doorX].type = WALL_TILE;
      grid[h - 1][doorX + 1].type = WALL_TILE;
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
      const upX = w - TOWER_STAIR_UP_X_OFFSET;
      const upY = TOWER_STAIR_ROW;
      // Stairs down: upper-left area (2 tiles wide)
      const dnX = TOWER_STAIR_DOWN_COL;
      const dnY = TOWER_STAIR_ROW;

      const hasUp = towerFloor < TOWER_TOP_FLOOR;
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
      // TOWER_ENTRANCE_ROW_INSET: h - this value = second-to-last interior row (barrel/entrance row)
      const TOWER_ENTRANCE_ROW_INSET = 3;
      const towerFireplaceCol1 = 14;
      const towerFireplaceCol2 = 15;
      const towerShelfStartRow = 4;
      if (towerFloor === 0) {
        // Ground floor: reception hall — large rug, tables, bookshelves, fireplace
        const groundFloorRugStartRow = 8;
        const groundFloorRugEndRow = 13;
        const groundFloorRugStartCol = 10;
        const groundFloorRugEndCol = 19;
        const groundFloorShelfEndRow = 10;
        const groundFloorReceptionRow = 10;
        const groundFloorChairRow = 11;
        const groundFloorReceptionTableCol1 = 6;
        const groundFloorReceptionTableCol2 = 7;
        const groundFloorReceptionTableCol3 = 8;
        const groundFloorEastBarrelRow = 5;
        // Fireplace centered on north wall
        grid[1][towerFireplaceCol1].type = FIREPLACE;
        grid[1][towerFireplaceCol2].type = FIREPLACE;
        // Large rug in center
        for (let ry = groundFloorRugStartRow; ry <= groundFloorRugEndRow; ry++) {
          for (let rx = groundFloorRugStartCol; rx <= groundFloorRugEndCol; rx++)
            grid[ry][rx].type = RUG;
        }
        // Bookshelves along west wall
        for (let ry = towerShelfStartRow; ry <= groundFloorShelfEndRow; ry++)
          grid[ry][1].type = BOOKSHELF;
        // Reception table with chairs
        grid[groundFloorReceptionRow][groundFloorReceptionTableCol1].type = TABLE;
        grid[groundFloorReceptionRow][groundFloorReceptionTableCol2].type = TABLE;
        grid[groundFloorReceptionRow][groundFloorReceptionTableCol3].type = TABLE;
        grid[groundFloorChairRow][groundFloorReceptionTableCol1].type = CHAIR;
        grid[groundFloorChairRow][groundFloorReceptionTableCol3].type = CHAIR;
        grid[groundFloorReceptionRow - 1][groundFloorReceptionTableCol2].type = CHAIR;
        // Barrels near entrance
        grid[h - TOWER_ENTRANCE_ROW_INSET][1].type = BARREL;
        grid[h - TOWER_ENTRANCE_ROW_INSET][2].type = BARREL;
        grid[h - TOWER_ENTRANCE_ROW_INSET][w - 2].type = BARREL;
        // Torch-style decoration on east wall (use barrel as substitute)
        grid[groundFloorEastBarrelRow][w - 2].type = BARREL;
      } else if (towerFloor === 1) {
        // 2nd floor: library — lots of bookshelves + reading tables
        const libraryShelfEndRow = 14;
        const libraryIslandRow = 6;
        const libraryIsland1StartCol = 10;
        const libraryIsland1EndCol = 13;
        const libraryIsland2StartCol = 16;
        const libraryIsland2EndCol = 19;
        const libraryReadingRow = 10;
        const libraryChairRow = 11;
        const libraryWestTableCol1 = 8;
        const libraryWestTableCol2 = 9;
        const libraryEastTableCol1 = 16;
        const libraryEastTableCol2 = 17;
        const libraryRugStartCol = 11;
        const libraryRugEndCol = 14;
        // Bookshelves along west wall
        for (let ry = towerShelfStartRow; ry <= libraryShelfEndRow; ry++)
          grid[ry][1].type = BOOKSHELF;
        // Bookshelves along east wall
        for (let ry = towerShelfStartRow; ry <= libraryShelfEndRow; ry++)
          grid[ry][w - 2].type = BOOKSHELF;
        // Center bookshelf island
        for (let rx = libraryIsland1StartCol; rx <= libraryIsland1EndCol; rx++)
          grid[libraryIslandRow][rx].type = BOOKSHELF;
        for (let rx = libraryIsland2StartCol; rx <= libraryIsland2EndCol; rx++)
          grid[libraryIslandRow][rx].type = BOOKSHELF;
        // Reading tables
        grid[libraryReadingRow][libraryWestTableCol1].type = TABLE;
        grid[libraryReadingRow][libraryWestTableCol2].type = TABLE;
        grid[libraryChairRow][libraryWestTableCol1].type = CHAIR;
        grid[libraryChairRow][libraryWestTableCol2].type = CHAIR;
        grid[libraryReadingRow][libraryEastTableCol1].type = TABLE;
        grid[libraryReadingRow][libraryEastTableCol2].type = TABLE;
        grid[libraryChairRow][libraryEastTableCol1].type = CHAIR;
        grid[libraryChairRow][libraryEastTableCol2].type = CHAIR;
        // Rug between tables
        for (let rx = libraryRugStartCol; rx <= libraryRugEndCol; rx++) {
          grid[libraryReadingRow][rx].type = RUG;
          grid[libraryChairRow][rx].type = RUG;
        }
      } else if (towerFloor === 2) {
        // 3rd floor: living quarters — beds, tables, personal items
        const quartersNorthBedRow1 = 5;
        const quartersNorthBedRow2 = 6;
        const quartersSouthBedRow1 = 9;
        const quartersSouthBedRow2 = 10;
        const quartersShelfRow1 = 7;
        const quartersShelfRow2 = 8;
        const quartersEastTableRow = 8;
        const quartersEastTableCol1 = w - TOWER_STAIR_UP_X_OFFSET;
        const quartersEastTableCol2 = w - TOWER_STAIR_UP_X_OFFSET + 1;
        const quartersEastTableCol3 = w - TOWER_STAIR_UP_X_OFFSET + 2;
        const quartersBarrelRow1 = 12;
        const quartersBarrelRow2 = 13;
        const quartersRugStartCol = 4;
        const quartersRugEndCol = 6;
        // Two beds along west wall
        grid[quartersNorthBedRow1][1].type = BED;
        grid[quartersNorthBedRow1][2].type = BED;
        grid[quartersNorthBedRow2][1].type = BED;
        grid[quartersNorthBedRow2][2].type = BED;
        grid[quartersSouthBedRow1][1].type = BED;
        grid[quartersSouthBedRow1][2].type = BED;
        grid[quartersSouthBedRow2][1].type = BED;
        grid[quartersSouthBedRow2][2].type = BED;
        // Bookshelf between beds
        grid[quartersShelfRow1][1].type = BOOKSHELF;
        grid[quartersShelfRow2][1].type = BOOKSHELF;
        // Table and chairs on east side
        grid[quartersEastTableRow][quartersEastTableCol1].type = TABLE;
        grid[quartersEastTableRow][quartersEastTableCol2].type = TABLE;
        grid[quartersEastTableRow][quartersEastTableCol3].type = TABLE;
        grid[quartersEastTableRow + 1][quartersEastTableCol1].type = CHAIR;
        grid[quartersEastTableRow + 1][quartersEastTableCol3].type = CHAIR;
        // Barrel storage
        grid[quartersBarrelRow1][w - 2].type = BARREL;
        grid[quartersBarrelRow2][w - 2].type = BARREL;
        // Rug by beds
        for (let rx = quartersRugStartCol; rx <= quartersRugEndCol; rx++) {
          grid[quartersNorthBedRow2][rx].type = RUG;
          grid[quartersShelfRow1][rx].type = RUG;
          grid[quartersShelfRow2][rx].type = RUG;
          grid[quartersSouthBedRow1][rx].type = RUG;
        }
        // Fireplace on north wall
        grid[1][towerFireplaceCol1].type = FIREPLACE;
        grid[1][towerFireplaceCol2].type = FIREPLACE;
      } else {
        // Top floor: study/throne room — desk, bookshelves, large rug
        const studyShelfEndRow = 12;
        const studyDeskRow = towerShelfStartRow;
        const studyDeskCol1 = 12;
        const studyDeskCol2 = 13;
        const studyDeskCol3 = towerFireplaceCol1;
        const studyDeskCol4 = towerFireplaceCol2;
        const studyDeskCol5 = 16;
        const studyChairRow = towerShelfStartRow + 1;
        const studyRugStartRow = 8;
        const studyRugEndRow = 15;
        const studyRugStartCol = 8;
        const studyRugEndCol = 21;
        const studyFireplaceCol1 = 10;
        const studyFireplaceCol2 = 11;
        // Bookshelves along both walls
        for (let ry = towerShelfStartRow; ry <= studyShelfEndRow; ry++)
          grid[ry][1].type = BOOKSHELF;
        for (let ry = towerShelfStartRow; ry <= studyShelfEndRow; ry++)
          grid[ry][w - 2].type = BOOKSHELF;
        // Grand desk at north end
        grid[studyDeskRow][studyDeskCol1].type = TABLE;
        grid[studyDeskRow][studyDeskCol2].type = TABLE;
        grid[studyDeskRow][studyDeskCol3].type = TABLE;
        grid[studyDeskRow][studyDeskCol4].type = TABLE;
        grid[studyDeskRow][studyDeskCol5].type = TABLE;
        grid[studyChairRow][studyDeskCol3].type = CHAIR;
        // Large rug in center
        for (let ry = studyRugStartRow; ry <= studyRugEndRow; ry++) {
          for (let rx = studyRugStartCol; rx <= studyRugEndCol; rx++) grid[ry][rx].type = RUG;
        }
        // Fireplace on north wall
        grid[1][studyFireplaceCol1].type = FIREPLACE;
        grid[1][studyFireplaceCol2].type = FIREPLACE;
        // Barrel in corners
        grid[h - TOWER_ENTRANCE_ROW_INSET][1].type = BARREL;
        grid[h - TOWER_ENTRANCE_ROW_INSET][w - 2].type = BARREL;
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
    } else {
      this.safeRooms = [];
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
      { dx: 1, dy: 1, cost: DIAGONAL_MOVE_COST },
      { dx: 1, dy: -1, cost: DIAGONAL_MOVE_COST },
      { dx: -1, dy: 1, cost: DIAGONAL_MOVE_COST },
      { dx: -1, dy: -1, cost: DIAGONAL_MOVE_COST },
    ];

    const MAX_NODES = ASTAR_MAX_NODE_EXPANSIONS;
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

  private buildExtraBlockedTiles(): void {
    this.extraBlockedTiles.clear();
    for (let ty = 0; ty < this.structure.length; ty++) {
      const row = this.structure[ty];
      for (let tx = 0; tx < row.length; tx++) {
        const tile = row[tx];
        const offsets =
          tile.type === SPRITE_BUILDING && tile.spriteKey !== undefined
            ? getBlockedTileOffsetsByKey(tile.spriteKey)
            : getBlockedTileOffsets(tile.type);
        for (const { dx, dy } of offsets) {
          this.extraBlockedTiles.add(`${tx + dx},${ty + dy}`);
        }
      }
    }
  }

  blockTilePermanently(tileX: number, tileY: number): void {
    this.permanentBlockedTiles.add(`${tileX},${tileY}`);
  }

  isWalkable(tileX: number, tileY: number): boolean {
    if (tileY < 0 || tileX < 0 || tileY >= this.structure.length) return false;
    const row = this.structure[tileY];
    if (tileX >= row.length) return false;
    const tile = row[tileX];
    if (this.arenaDoorLocked && this.arenaDoorTileSet.has(`${tileX},${tileY}`)) return false;
    if (this.extraBlockedTiles.has(`${tileX},${tileY}`)) return false;
    if (this.permanentBlockedTiles.has(`${tileX},${tileY}`)) return false;
    if (tile.type === MODERN_DECORATION) {
      return WALKABLE_MODERN_DECORATION_VARIANTS.has(tile.decorationVariant ?? 0);
    }
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
      tile.type !== TABLE &&
      tile.type !== BOOKSHELF &&
      tile.type !== BED &&
      tile.type !== FIREPLACE &&
      tile.type !== BARREL &&
      tile.type !== CHAIR &&
      tile.type !== BARREL_SIDE &&
      tile.type !== CRATE &&
      tile.type !== BRAZIER &&
      tile.type !== SPRITE_BUILDING
      // SAFE_ROOM_FLOOR (10), GRASSY_WEED (22), DIRT_PATCH (23), RUG (37), BONES (43) are walkable
    );
  }

  isStairwellTile(tileX: number, tileY: number): boolean {
    return this.stairwellBlockedSet.has(`${tileX},${tileY}`);
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
    const steps = Math.ceil(dist / (ts * LOS_HALF_TILE_FRACTION));
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
    this._chunkCache ??= new TileChunkCache(this.structure, this.tileHeight);
    renderCanvas(
      ctx,
      this.structure,
      this.tileHeight,
      cameraX,
      cameraY,
      viewW,
      viewH,
      this._chunkCache,
    );
  }

  renderDecorationsOverlay(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ): void {
    this._overlayCache ??= new OverlayTileCache(this.structure, this.tileHeight);
    renderDecorationsOverlay(
      ctx,
      this.structure,
      this.tileHeight,
      cameraX,
      cameraY,
      viewW,
      viewH,
      this._overlayCache,
    );
  }

  /** Returns tile coords of all visible decoration tiles (TORCH, WELL, TREE, FOUNTAIN). */
  getVisibleDecorationTiles(
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): Array<{ tx: number; ty: number; isTree: boolean; sortYAnchorPx: number }> {
    const ts = this.tileHeight;
    const rows = this.structure.length;
    const cols = this.structure[0]?.length ?? rows;
    const startX = Math.max(0, Math.floor(camX / ts));
    const startY = Math.max(0, Math.floor(camY / ts));
    const endX = Math.min(cols - 1, Math.ceil((camX + viewW) / ts));
    // Expand endY so tall sprites (e.g. the tower) whose top is still on-screen
    // aren't culled just because their anchor tile is south of the viewport.
    const maxOverheadTiles = Math.ceil(getSpriteOverheadPx(MAIN_TOWER) / ts);
    const endY = Math.min(rows - 1, Math.ceil((camY + viewH) / ts) + maxOverheadTiles);
    const result: Array<{ tx: number; ty: number; isTree: boolean; sortYAnchorPx: number }> = [];
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const t = this.structure[y][x].type;
        if (
          t === TREE ||
          t === TORCH ||
          t === WELL ||
          t === BRAZIER ||
          t === FOUNTAIN ||
          t === BUILDING_WALL ||
          t === ROOF_THATCH ||
          t === ROOF_SLATE ||
          t === ROOF_RED ||
          t === ROOF_GREEN ||
          t === ROOF_CIRCUS_RED ||
          t === ROOF_CIRCUS_BLUE ||
          t === ROOF_CIRCUS_PURPLE ||
          t === MAIN_TOWER
        ) {
          result.push({
            tx: x,
            ty: y,
            isTree: t === TREE,
            sortYAnchorPx: getSortYAnchorPx(t) ?? ts,
          });
        } else if (t === SPRITE_BUILDING) {
          const tile = this.structure[y][x];
          const def = tile.spriteKey !== undefined ? getSpriteDefByKey(tile.spriteKey) : undefined;
          const sortY =
            def !== undefined ? (def.frameHeight - def.tileY) * (ts / def.tileScale) : ts;
          result.push({ tx: x, ty: y, isTree: false, sortYAnchorPx: sortY });
        } else if (t === MODERN_DECORATION) {
          // modern_decorations: 183×183 at tileScale=183 → renders at 1 tile; anchor at bottom
          result.push({ tx: x, ty: y, isTree: false, sortYAnchorPx: ts });
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
    this._overlayCache ??= new OverlayTileCache(this.structure, ts);
    drawDecorationTileFull(
      ctx,
      this.structure,
      tx,
      ty,
      tx * ts - camX,
      ty * ts - camY,
      ts,
      this._overlayCache,
    );
  }
}
