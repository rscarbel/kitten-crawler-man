import { GameMap } from './GameMap';
import { TILE_SIZE } from '../core/constants';
import { FloorTypeValue, SAFE_ROOM_FLOOR, STAIRS_DOWN, type TileContent } from './tileTypes';

// Map dimensions
const MAP_W = 110;
const MAP_H = 110;

// Spawn positions (tile coords)
const HUMAN_SPAWN_X = 89;
const HUMAN_SPAWN_Y = 8;
const CAT_SPAWN_X = 40;
const CAT_SPAWN_Y = 8;

// Room bounds (inclusive, interior floor tiles)
const CAT_ROOM_X1 = 33;
const CAT_ROOM_X2 = 47;
const CAT_ROOM_Y1 = 3;
const CAT_ROOM_Y2 = 14;

const HUMAN_ROOM_X1 = 82;
const HUMAN_ROOM_X2 = 96;
const HUMAN_ROOM_Y1 = 3;
const HUMAN_ROOM_Y2 = 14;

const TREASURE_ROOM_X1 = 33;
const TREASURE_ROOM_X2 = 50;
const TREASURE_ROOM_Y1 = 23;
const TREASURE_ROOM_Y2 = 37;

const SAFE_ROOM_X1 = 58;
const SAFE_ROOM_X2 = 97;
const SAFE_ROOM_Y1 = 37;
const SAFE_ROOM_Y2 = 57;

const STAIR_ROOM_X1 = 67;
const STAIR_ROOM_X2 = 86;
const STAIR_ROOM_Y1 = 67;
const STAIR_ROOM_Y2 = 78;

// Hallway bounds
const CAT_HALL_X1 = 38;
const CAT_HALL_X2 = 42;
const CAT_HALL_Y1 = 14;
const CAT_HALL_Y2 = 23;

const HUMAN_HALL_X1 = 86;
const HUMAN_HALL_X2 = 90;
const HUMAN_HALL_Y1 = 14;
const HUMAN_HALL_Y2 = 37;

const L_VERT_X1 = 38;
const L_VERT_X2 = 42;
const L_VERT_Y1 = 37;
const L_VERT_Y2 = 52;

const L_HORIZ_X1 = 41;
const L_HORIZ_X2 = 58;
const L_HORIZ_Y1 = 47;
const L_HORIZ_Y2 = 52;

const BELOW_SAFE_X1 = 73;
const BELOW_SAFE_X2 = 77;
const BELOW_SAFE_Y1 = 57;
const BELOW_SAFE_Y2 = 67;

// Stairwell tile
const STAIR_X = 76;
const STAIR_Y = 72;

// Safe room geometry
const SAFE_W = SAFE_ROOM_X2 - SAFE_ROOM_X1 + 1; // 40 tiles
const SAFE_H = SAFE_ROOM_Y2 - SAFE_ROOM_Y1 + 1; // 21 tiles
const SAFE_CENTRE_X = Math.floor(SAFE_ROOM_X1 + SAFE_W / 2); // 48
const SAFE_CENTRE_Y = Math.floor(SAFE_ROOM_Y1 + SAFE_H / 2); // 47

// Gate / ledge blocking rows and columns
const GATE_G1_ROW = 16;
const GATE_G2_ROW = 42;
const GATE_G3_ROW = 59;
const LEDGE_COL = 52;

// Virtual gate / ledge positions (managed by TutorialController)
/** Gate G1: blocks cat from exiting spawn room. Row y=16 in the cat hallway. */
export const TUTORIAL_GATE_G1 = {
  x1: CAT_HALL_X1,
  x2: CAT_HALL_X2,
  y: GATE_G1_ROW,
  /** Max pixel-Y the cat may reach while this gate is closed. */
  clampPxY: (GATE_G1_ROW - 1) * TILE_SIZE,
} as const;

/** Gate G2: blocks cat from exiting below-treasure hallway. Row y=42. */
export const TUTORIAL_GATE_G2 = {
  x1: L_VERT_X1,
  x2: L_VERT_X2,
  y: GATE_G2_ROW,
  clampPxY: (GATE_G2_ROW - 1) * TILE_SIZE,
} as const;

/** Gate G3: blocks access to below-safe hallway. Row y=59. */
export const TUTORIAL_GATE_G3 = {
  x1: BELOW_SAFE_X1,
  x2: BELOW_SAFE_X2,
  y: GATE_G3_ROW,
  clampPxY: (GATE_G3_ROW - 1) * TILE_SIZE,
} as const;

/**
 * Safe-entrance gate: blocks human from entering the safe room until goblin A is defeated.
 * Sits at the bottom of the human hallway where it meets the safe room top (y=37).
 */
export const TUTORIAL_GATE_SAFE_ENTRANCE = {
  x1: HUMAN_HALL_X1,
  x2: HUMAN_HALL_X2,
  y: SAFE_ROOM_Y1,
  clampPxY: (SAFE_ROOM_Y1 - 1) * TILE_SIZE,
} as const;

/**
 * Ledge: blocks human from going west past x=22 in the L-shaped hallway.
 * Guards are at x=21 (just beyond the ledge).
 */
export const TUTORIAL_LEDGE = {
  x: LEDGE_COL,
  y1: L_HORIZ_Y1,
  y2: L_HORIZ_Y2,
  /** Min pixel-X human may reach while ledge is active. */
  clampPxX: (LEDGE_COL + 1) * TILE_SIZE,
} as const;

//  Tutorial mob and object positions
/** First combat goblin — in human hallway, aggros normally but deals 0 damage. */
export const GOBLIN_A_POS = { x: 88, y: 22 } as const;
/** Magic-missile demo target behind G2. */
export const GOBLIN_B_POS = { x: 40, y: 44 } as const;
/** Two stationary smush-demo guards beyond the ledge. */
export const SMUSH_GUARD_1_POS = { x: 51, y: 49 } as const;
export const SMUSH_GUARD_2_POS = { x: 51, y: 50 } as const;
/** Treasure chest in the treasure room. */
export const TUTORIAL_CHEST_POS = { x: 41, y: 30 } as const;
/** Stairwell tile. */
export const TUTORIAL_STAIR_POS = { x: STAIR_X, y: STAIR_Y } as const;

/** Treasure room bounding box — used when placing the tutorial chest. */
export const TUTORIAL_TREASURE_ROOM_BOUNDS = {
  x: TREASURE_ROOM_X1,
  y: TREASURE_ROOM_Y1,
  w: TREASURE_ROOM_X2 - TREASURE_ROOM_X1 + 1,
  h: TREASURE_ROOM_Y2 - TREASURE_ROOM_Y1 + 1,
} as const;

function makeTile(x: number, y: number, type: number): TileContent {
  return { tileId: `${x}#${y}`, type };
}

function fillRect(
  grid: TileContent[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  type: number,
): void {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      grid[y][x] = makeTile(x, y, type);
    }
  }
}

function buildStructure(): TileContent[][] {
  const WALL = FloorTypeValue.wall;
  const FLOOR = FloorTypeValue.tile_floor;
  const SAFE = SAFE_ROOM_FLOOR;

  // Start fully walled.
  const grid: TileContent[][] = Array.from({ length: MAP_H }, (_, y) =>
    Array.from({ length: MAP_W }, (_, x) => makeTile(x, y, WALL)),
  );

  // Carve rooms.
  fillRect(grid, CAT_ROOM_X1, CAT_ROOM_Y1, CAT_ROOM_X2, CAT_ROOM_Y2, FLOOR);
  fillRect(grid, HUMAN_ROOM_X1, HUMAN_ROOM_Y1, HUMAN_ROOM_X2, HUMAN_ROOM_Y2, FLOOR);
  fillRect(grid, TREASURE_ROOM_X1, TREASURE_ROOM_Y1, TREASURE_ROOM_X2, TREASURE_ROOM_Y2, FLOOR);
  fillRect(grid, SAFE_ROOM_X1, SAFE_ROOM_Y1, SAFE_ROOM_X2, SAFE_ROOM_Y2, SAFE);
  fillRect(grid, STAIR_ROOM_X1, STAIR_ROOM_Y1, STAIR_ROOM_X2, STAIR_ROOM_Y2, FLOOR);

  // Carve hallways.
  fillRect(grid, CAT_HALL_X1, CAT_HALL_Y1, CAT_HALL_X2, CAT_HALL_Y2, FLOOR);
  fillRect(grid, HUMAN_HALL_X1, HUMAN_HALL_Y1, HUMAN_HALL_X2, HUMAN_HALL_Y2, FLOOR);
  fillRect(grid, L_VERT_X1, L_VERT_Y1, L_VERT_X2, L_VERT_Y2, FLOOR);
  fillRect(grid, L_HORIZ_X1, L_HORIZ_Y1, L_HORIZ_X2, L_HORIZ_Y2, FLOOR);
  fillRect(grid, BELOW_SAFE_X1, BELOW_SAFE_Y1, BELOW_SAFE_X2, BELOW_SAFE_Y2, FLOOR);

  // Place the stairwell tile.
  grid[STAIR_Y][STAIR_X] = makeTile(STAIR_X, STAIR_Y, STAIRS_DOWN);

  return grid;
}

/**
 * The hand-crafted tutorial map.
 * Layout: separate cat/human spawn rooms → hallways → treasure room (cat side) →
 * L-shaped connector → safe room → stairwell.
 *
 * Virtual gates and the ledge are enforced by TutorialController by clamping
 * player positions, so ALL tiles are walkable from a type perspective. This lets
 * magic missiles pass through closed gates.
 */
export class TutorialMap extends GameMap {
  /** Tile where the cat spawns (top-left room). */
  readonly catStartTile = { x: CAT_SPAWN_X, y: CAT_SPAWN_Y };
  /** Tile where the human spawns (top-right room). */
  readonly humanStartTile = { x: HUMAN_SPAWN_X, y: HUMAN_SPAWN_Y };

  constructor() {
    super({ prebuiltStructure: buildStructure(), tileHeight: TILE_SIZE });

    this.startTile = { x: HUMAN_SPAWN_X, y: HUMAN_SPAWN_Y };

    this.safeRooms = [
      {
        bounds: { x: SAFE_ROOM_X1, y: SAFE_ROOM_Y1, w: SAFE_W, h: SAFE_H },
        centre: { x: SAFE_CENTRE_X, y: SAFE_CENTRE_Y },
        showBed: false,
      },
    ];

    this.stairwellTiles = [{ x: STAIR_X, y: STAIR_Y }];

    // No mob spawn points — tutorial goblins are placed manually.
    this.mobSpawnPoints = [];
    this.hallwaySpawnPoints = [];
    this.bossRooms = [];
  }
}
