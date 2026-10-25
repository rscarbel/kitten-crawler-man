import { GameMap, type GameMapOptions } from './GameMap';
import { dressTutorial, type TutorialDressingLayout } from './tutorialDressing';
import { STAIRWELL_FOOTPRINT_SPAN } from './DungeonGenerator';
import { DEFAULT_FLOOR_ART_SEED } from './ground/floorArtSeed';
import { TILE_SIZE } from '../core/constants';
import { mordecaiAndBedTiles } from './safeRoomFixtures';
import { FloorTypeValue, SAFE_ROOM_FLOOR, STAIRS_DOWN, type TileContent } from './tileTypes';

/** A tile rectangle: `x`/`y` is the top-left tile, `w`/`h` count tiles. */
export interface TutorialRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TutorialTile {
  readonly x: number;
  readonly y: number;
}

/**
 * The camera clamps to the map's edges, so solid wall has to extend at least
 * half a wide desktop viewport past every room or the crawler stops being
 * centred near the edge of the layout.
 */
const CAMERA_WALL_MARGIN_TILES = 40;

const HALL_WIDTH_TILES = 3;

const SPAWN_ROOM_W = 9;
const SPAWN_ROOM_H = 7;
const TREASURE_ROOM_W = 11;
const TREASURE_ROOM_H = 9;
const SAFE_ROOM_W = 14;
const SAFE_ROOM_H = 10;
const STAIR_ROOM_W = 9;
const STAIR_ROOM_H = 7;

/** Corridor rows between the cat's spawn room and the treasure room. */
const CAT_HALL_LENGTH_TILES = 3;
/** Corridor rows between the human's spawn room and the safe room. */
const HUMAN_HALL_LENGTH_TILES = 12;
/** Corridor rows between the safe room and the stair room. */
const STAIR_HALL_LENGTH_TILES = 4;

/** Rows into the human's hallway goblin A waits, so he is on screen soon after the human sets off. */
const GOBLIN_A_ROWS_INTO_HALL = 4;
/** Rows into the cat's hallway gate G1 sits, so she can see it from her room. */
const GATE_G1_ROWS_INTO_HALL = 1;
/**
 * Rows below the treasure room gate G2 sits: none, so it stands in the
 * room's doorway and goblin B, just past it, is as far north as he can be.
 * He has to be: the human, held south of goblin B's door, must stand beyond a
 * level-1 Smush's outer blast from him, with room to spare.
 */
const GATE_G2_ROWS_INTO_HALL = 0;
/** Rows past G2 goblin B stands: close enough that the cat, stopped at G2, has him on screen. */
const GOBLIN_B_ROWS_PAST_G2 = 1;
const GATE_G3_ROWS_INTO_HALL = 1;
/** Columns east of the west hallway the smush guards stand. */
const SMUSH_GUARD_COLUMNS_PAST_WEST_HALL = 3;
/**
 * Columns between the smush gate and the safe room's west wall. The human is
 * held one column east of the gate, two from the guards, which keeps both
 * guards inside a level-1 Smush's outer blast.
 */
const SMUSH_GATE_COLUMNS_FROM_SAFE_ROOM = 4;
/**
 * Columns from the safe room's west wall to the centre of the human's doorway. Far
 * enough east that the Bopca counter, which avoids north-wall doorway columns,
 * still gets a full-length run west of the door.
 */
const HUMAN_DOOR_COLUMNS_INTO_SAFE_ROOM = 10;

function centredStart(centre: number, span: number): number {
  return centre - Math.floor(span / 2);
}

function rectFromInclusive(x1: number, y1: number, x2: number, y2: number): TutorialRect {
  return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

function lastX(rect: TutorialRect): number {
  return rect.x + rect.w - 1;
}

function lastY(rect: TutorialRect): number {
  return rect.y + rect.h - 1;
}

function centreTile(rect: TutorialRect): TutorialTile {
  return { x: rect.x + Math.floor(rect.w / 2), y: rect.y + Math.floor(rect.h / 2) };
}

/** Whether a (possibly fractional) tile position lies inside the rect. */
export function isInTutorialRect(rect: TutorialRect, tileX: number, tileY: number): boolean {
  return tileX >= rect.x && tileX < rect.x + rect.w && tileY >= rect.y && tileY < rect.y + rect.h;
}

// The cat's column: her room, her hallway, the treasure room and the west
// hallway all centre on it. The treasure room is the widest, so it sets how far
// the column sits from the west margin.
const CAT_COLUMN_X = CAMERA_WALL_MARGIN_TILES + Math.floor(TREASURE_ROOM_W / 2);
const SPAWN_ROOM_Y1 = CAMERA_WALL_MARGIN_TILES;

export const TUTORIAL_CAT_ROOM_BOUNDS: TutorialRect = {
  x: centredStart(CAT_COLUMN_X, SPAWN_ROOM_W),
  y: SPAWN_ROOM_Y1,
  w: SPAWN_ROOM_W,
  h: SPAWN_ROOM_H,
};

export const TUTORIAL_CAT_HALL_BOUNDS: TutorialRect = {
  x: centredStart(CAT_COLUMN_X, HALL_WIDTH_TILES),
  y: lastY(TUTORIAL_CAT_ROOM_BOUNDS) + 1,
  w: HALL_WIDTH_TILES,
  h: CAT_HALL_LENGTH_TILES,
};

/** Treasure room bounds — used when placing the tutorial chest and to tell when the cat has arrived. */
export const TUTORIAL_TREASURE_ROOM_BOUNDS: TutorialRect = {
  x: centredStart(CAT_COLUMN_X, TREASURE_ROOM_W),
  y: lastY(TUTORIAL_CAT_HALL_BOUNDS) + 1,
  w: TREASURE_ROOM_W,
  h: TREASURE_ROOM_H,
};

const GATE_G2_ROW = lastY(TUTORIAL_TREASURE_ROOM_BOUNDS) + 1 + GATE_G2_ROWS_INTO_HALL;
const GOBLIN_B_Y = GATE_G2_ROW + GOBLIN_B_ROWS_PAST_G2;

const WEST_HALL_X1 = centredStart(CAT_COLUMN_X, HALL_WIDTH_TILES);
const WEST_HALL_X2 = WEST_HALL_X1 + HALL_WIDTH_TILES - 1;
const SMUSH_GUARD_X = WEST_HALL_X2 + SMUSH_GUARD_COLUMNS_PAST_WEST_HALL;
const SMUSH_GATE_COL = SMUSH_GUARD_X + 1;
const SAFE_ROOM_X1 = SMUSH_GATE_COL + SMUSH_GATE_COLUMNS_FROM_SAFE_ROOM;
const HUMAN_COLUMN_X = SAFE_ROOM_X1 + HUMAN_DOOR_COLUMNS_INTO_SAFE_ROOM;

export const TUTORIAL_HUMAN_ROOM_BOUNDS: TutorialRect = {
  x: centredStart(HUMAN_COLUMN_X, SPAWN_ROOM_W),
  y: SPAWN_ROOM_Y1,
  w: SPAWN_ROOM_W,
  h: SPAWN_ROOM_H,
};

export const TUTORIAL_HUMAN_HALL_BOUNDS: TutorialRect = {
  x: centredStart(HUMAN_COLUMN_X, HALL_WIDTH_TILES),
  y: lastY(TUTORIAL_HUMAN_ROOM_BOUNDS) + 1,
  w: HALL_WIDTH_TILES,
  h: HUMAN_HALL_LENGTH_TILES,
};

export const TUTORIAL_SAFE_ROOM_BOUNDS: TutorialRect = {
  x: SAFE_ROOM_X1,
  y: lastY(TUTORIAL_HUMAN_HALL_BOUNDS) + 1,
  w: SAFE_ROOM_W,
  h: SAFE_ROOM_H,
};

/**
 * The connector into the safe room's west wall. It hugs the room's bottom
 * interior row, leaving the rows above it to Mordecai's patch and the counter.
 */
export const TUTORIAL_L_HORIZONTAL_HALL_BOUNDS: TutorialRect = rectFromInclusive(
  WEST_HALL_X2 + 1,
  lastY(TUTORIAL_SAFE_ROOM_BOUNDS) - HALL_WIDTH_TILES,
  TUTORIAL_SAFE_ROOM_BOUNDS.x - 1,
  lastY(TUTORIAL_SAFE_ROOM_BOUNDS) - 1,
);

/** South out of the treasure room, past G2 and goblin B, down to the connector. */
export const TUTORIAL_L_VERTICAL_HALL_BOUNDS: TutorialRect = rectFromInclusive(
  WEST_HALL_X1,
  lastY(TUTORIAL_TREASURE_ROOM_BOUNDS) + 1,
  WEST_HALL_X2,
  lastY(TUTORIAL_L_HORIZONTAL_HALL_BOUNDS),
);

const SAFE_ROOM_CENTRE = centreTile(TUTORIAL_SAFE_ROOM_BOUNDS);

export const TUTORIAL_STAIR_HALL_BOUNDS: TutorialRect = {
  x: centredStart(SAFE_ROOM_CENTRE.x, HALL_WIDTH_TILES),
  y: lastY(TUTORIAL_SAFE_ROOM_BOUNDS) + 1,
  w: HALL_WIDTH_TILES,
  h: STAIR_HALL_LENGTH_TILES,
};

export const TUTORIAL_STAIR_ROOM_BOUNDS: TutorialRect = {
  x: centredStart(SAFE_ROOM_CENTRE.x, STAIR_ROOM_W),
  y: lastY(TUTORIAL_STAIR_HALL_BOUNDS) + 1,
  w: STAIR_ROOM_W,
  h: STAIR_ROOM_H,
};

const TUTORIAL_ROOMS: ReadonlyArray<TutorialRect> = [
  TUTORIAL_CAT_ROOM_BOUNDS,
  TUTORIAL_HUMAN_ROOM_BOUNDS,
  TUTORIAL_TREASURE_ROOM_BOUNDS,
  TUTORIAL_STAIR_ROOM_BOUNDS,
];

const TUTORIAL_HALLS: ReadonlyArray<TutorialRect> = [
  TUTORIAL_CAT_HALL_BOUNDS,
  TUTORIAL_HUMAN_HALL_BOUNDS,
  TUTORIAL_L_VERTICAL_HALL_BOUNDS,
  TUTORIAL_L_HORIZONTAL_HALL_BOUNDS,
  TUTORIAL_STAIR_HALL_BOUNDS,
];

const ALL_CARVED: ReadonlyArray<TutorialRect> = [
  ...TUTORIAL_ROOMS,
  TUTORIAL_SAFE_ROOM_BOUNDS,
  ...TUTORIAL_HALLS,
];

const MAP_W = Math.max(...ALL_CARVED.map((rect) => lastX(rect))) + 1 + CAMERA_WALL_MARGIN_TILES;
const MAP_H = Math.max(...ALL_CARVED.map((rect) => lastY(rect))) + 1 + CAMERA_WALL_MARGIN_TILES;

/** The safe room as `SafeRoomSystem` and the counter/decor stampers read it. */
export const TUTORIAL_SAFE_ROOM = {
  bounds: TUTORIAL_SAFE_ROOM_BOUNDS,
  centre: SAFE_ROOM_CENTRE,
} as const;

/**
 * Mordecai's home tile, from the same fixture geometry `SafeRoomSystem` places
 * him with. He wanders around it, so prefer his live position where one is to hand.
 */
export const TUTORIAL_MORDECAI_HOME_TILE: TutorialTile = mordecaiAndBedTiles(TUTORIAL_SAFE_ROOM)[0];

export const TUTORIAL_CAT_SPAWN_TILE: TutorialTile = centreTile(TUTORIAL_CAT_ROOM_BOUNDS);
export const TUTORIAL_HUMAN_SPAWN_TILE: TutorialTile = centreTile(TUTORIAL_HUMAN_ROOM_BOUNDS);

/** The doorway tile where the human's hallway opens into the safe room. */
export const TUTORIAL_SAFE_ENTRANCE_TILE: TutorialTile = {
  x: HUMAN_COLUMN_X,
  y: TUTORIAL_SAFE_ROOM_BOUNDS.y,
};

// Virtual gates: `TutorialGates` (src/systems/tutorialGates.ts) clamps crawler positions against them.

const GATE_G1_ROW = TUTORIAL_CAT_HALL_BOUNDS.y + GATE_G1_ROWS_INTO_HALL;
const GATE_G3_ROW = TUTORIAL_STAIR_HALL_BOUNDS.y + GATE_G3_ROWS_INTO_HALL;
const SAFE_ENTRANCE_GATE_ROW = lastY(TUTORIAL_HUMAN_HALL_BOUNDS);

/** Gate G1: keeps the cat in her spawn room until the camera pans to her. */
export const TUTORIAL_GATE_G1 = {
  x1: TUTORIAL_CAT_HALL_BOUNDS.x,
  x2: lastX(TUTORIAL_CAT_HALL_BOUNDS),
  y: GATE_G1_ROW,
  /** Max pixel-Y a crawler north of the gate may reach while it is closed. */
  clampPxY: (GATE_G1_ROW - 1) * TILE_SIZE,
} as const;

/**
 * Gate G2: the knee-high fence south of the treasure room that the cat fires
 * Magic Missile over. Its double gate swings open when she is called to the human.
 */
export const TUTORIAL_GATE_G2 = {
  x1: WEST_HALL_X1,
  x2: WEST_HALL_X2,
  y: GATE_G2_ROW,
  /** Max pixel-Y a crawler north of the gate (the cat) may reach while it is closed. */
  clampPxY: (GATE_G2_ROW - 1) * TILE_SIZE,
  /** Min pixel-Y a crawler south of the gate (the human, from the connector) may reach while it is closed. */
  southClampPxY: (GATE_G2_ROW + 1) * TILE_SIZE,
} as const;

/** Gate G3: holds both crawlers in the safe room until Mordecai's farewell has been heard. */
export const TUTORIAL_GATE_G3 = {
  x1: TUTORIAL_STAIR_HALL_BOUNDS.x,
  x2: lastX(TUTORIAL_STAIR_HALL_BOUNDS),
  y: GATE_G3_ROW,
  clampPxY: (GATE_G3_ROW - 1) * TILE_SIZE,
} as const;

/** Safe-entrance gate: in the doorway of the human's hallway, shut until goblin A is defeated. */
export const TUTORIAL_GATE_SAFE_ENTRANCE = {
  x1: TUTORIAL_HUMAN_HALL_BOUNDS.x,
  x2: lastX(TUTORIAL_HUMAN_HALL_BOUNDS),
  y: SAFE_ENTRANCE_GATE_ROW,
  clampPxY: (SAFE_ENTRANCE_GATE_ROW - 1) * TILE_SIZE,
} as const;

/**
 * The row of goblin B's door: the last row of the west hallway before the
 * connector joins it, as far south of him as the hall allows, so the human,
 * coming round from the smush guards, can never reach goblin B and take the
 * cat's Magic Missile lesson from her.
 */
const GOBLIN_B_DOOR_ROW = TUTORIAL_L_HORIZONTAL_HALL_BOUNDS.y - 1;

/**
 * Goblin B's door: a solid cellar door, not a portcullis, so it never looks
 * like the gate the human was taught to Smush through. It shuts goblin B in
 * between the fence and the connector until the cat's missile kills him.
 */
export const TUTORIAL_GOBLIN_B_DOOR = {
  x1: WEST_HALL_X1,
  x2: WEST_HALL_X2,
  y: GOBLIN_B_DOOR_ROW,
  /** Max pixel-Y a crawler north of the door may reach while it is closed. */
  clampPxY: (GOBLIN_B_DOOR_ROW - 1) * TILE_SIZE,
  /** Min pixel-Y a crawler south of the door (the human, from the connector) may reach while it is closed. */
  southClampPxY: (GOBLIN_B_DOOR_ROW + 1) * TILE_SIZE,
} as const;

/** The portcullis across the connector, running north–south, that keeps the human east of the smush guards. */
export const TUTORIAL_GATE_SMUSH = {
  x: SMUSH_GATE_COL,
  y1: TUTORIAL_L_HORIZONTAL_HALL_BOUNDS.y,
  y2: lastY(TUTORIAL_L_HORIZONTAL_HALL_BOUNDS),
  /** Min pixel-X the human may reach while the gate is shut. */
  clampPxX: (SMUSH_GATE_COL + 1) * TILE_SIZE,
} as const;

/** First combat goblin — in the human's hallway, aggros normally but deals 0 damage. */
export const GOBLIN_A_POS: TutorialTile = {
  x: HUMAN_COLUMN_X,
  y: TUTORIAL_HUMAN_HALL_BOUNDS.y + GOBLIN_A_ROWS_INTO_HALL,
};
/** Magic-missile demo target behind G2. */
export const GOBLIN_B_POS: TutorialTile = { x: CAT_COLUMN_X, y: GOBLIN_B_Y };
/** Two stationary smush-demo guards just west of the smush gate, on the connector's outer rows. */
export const SMUSH_GUARD_1_POS: TutorialTile = {
  x: SMUSH_GUARD_X,
  y: TUTORIAL_L_HORIZONTAL_HALL_BOUNDS.y,
};
export const SMUSH_GUARD_2_POS: TutorialTile = {
  x: SMUSH_GUARD_X,
  y: lastY(TUTORIAL_L_HORIZONTAL_HALL_BOUNDS),
};
/** Treasure chest, in the middle of the treasure room and in line with the cat's hallway. */
export const TUTORIAL_CHEST_POS: TutorialTile = centreTile(TUTORIAL_TREASURE_ROOM_BOUNDS);
export const TUTORIAL_STAIR_POS: TutorialTile = centreTile(TUTORIAL_STAIR_ROOM_BOUNDS);
/** Every tile the stairwell covers: it is drawn from {@link TUTORIAL_STAIR_POS} as its top-left. */
export const TUTORIAL_STAIR_FOOTPRINT: TutorialRect = {
  ...TUTORIAL_STAIR_POS,
  w: STAIRWELL_FOOTPRINT_SPAN,
  h: STAIRWELL_FOOTPRINT_SPAN,
};

function makeTile(x: number, y: number, type: number): TileContent {
  return { tileId: `${x}#${y}`, type };
}

function fillRect(grid: TileContent[][], rect: TutorialRect, type: number): void {
  for (let y = rect.y; y <= lastY(rect); y++) {
    for (let x = rect.x; x <= lastX(rect); x++) {
      grid[y][x] = makeTile(x, y, type);
    }
  }
}

function buildStructure(): TileContent[][] {
  const grid: TileContent[][] = Array.from({ length: MAP_H }, (_, y) =>
    Array.from({ length: MAP_W }, (_, x) => makeTile(x, y, FloorTypeValue.wall)),
  );

  for (const rect of [...TUTORIAL_ROOMS, ...TUTORIAL_HALLS]) {
    fillRect(grid, rect, FloorTypeValue.tile_floor);
  }
  fillRect(grid, TUTORIAL_SAFE_ROOM_BOUNDS, SAFE_ROOM_FLOOR);

  grid[TUTORIAL_STAIR_POS.y][TUTORIAL_STAIR_POS.x] = makeTile(
    TUTORIAL_STAIR_POS.x,
    TUTORIAL_STAIR_POS.y,
    STAIRS_DOWN,
  );

  return grid;
}

/** Tiles across a gate's line kept clear: the line itself and one either side. */
const GATE_KEEP_CLEAR_SPAN_TILES = 3;
const GATE_KEEP_CLEAR_MARGIN_TILES = 1;

/** A gate's row across its hall, with the row either side kept clear too. */
function gateRowKeepClear(hall: TutorialRect, row: number): TutorialRect {
  return {
    x: hall.x,
    y: row - GATE_KEEP_CLEAR_MARGIN_TILES,
    w: hall.w,
    h: GATE_KEEP_CLEAR_SPAN_TILES,
  };
}

/** The column from a tile straight down to the last row of its room. */
function columnToRoomBottom(room: TutorialRect, from: TutorialTile): TutorialRect {
  return { x: from.x, y: from.y, w: 1, h: lastY(room) - from.y + 1 };
}

function singleTile(tile: TutorialTile): TutorialRect {
  return { x: tile.x, y: tile.y, w: 1, h: 1 };
}

function tutorialDressingLayout(grid: TileContent[][]): TutorialDressingLayout {
  const smushGateKeepClear: TutorialRect = {
    x: SMUSH_GATE_COL - GATE_KEEP_CLEAR_MARGIN_TILES,
    y: TUTORIAL_L_HORIZONTAL_HALL_BOUNDS.y,
    w: GATE_KEEP_CLEAR_SPAN_TILES,
    h: TUTORIAL_L_HORIZONTAL_HALL_BOUNDS.h,
  };
  const stairApproach: TutorialRect = {
    x: TUTORIAL_STAIR_POS.x,
    y: TUTORIAL_STAIR_ROOM_BOUNDS.y,
    w: 1,
    h: TUTORIAL_STAIR_POS.y - TUTORIAL_STAIR_ROOM_BOUNDS.y,
  };
  return {
    grid,
    rooms: [
      { bounds: TUTORIAL_CAT_ROOM_BOUNDS, kind: 'start', floor: FloorTypeValue.tile_floor },
      { bounds: TUTORIAL_HUMAN_ROOM_BOUNDS, kind: 'start', floor: FloorTypeValue.tile_floor },
      { bounds: TUTORIAL_TREASURE_ROOM_BOUNDS, kind: 'treasure', floor: FloorTypeValue.tile_floor },
      { bounds: TUTORIAL_SAFE_ROOM_BOUNDS, kind: 'safe', floor: SAFE_ROOM_FLOOR },
      { bounds: TUTORIAL_STAIR_ROOM_BOUNDS, kind: 'exit', floor: FloorTypeValue.tile_floor },
    ],
    halls: TUTORIAL_HALLS,
    keepClear: [
      gateRowKeepClear(TUTORIAL_CAT_HALL_BOUNDS, GATE_G1_ROW),
      gateRowKeepClear(TUTORIAL_L_VERTICAL_HALL_BOUNDS, GATE_G2_ROW),
      gateRowKeepClear(TUTORIAL_L_VERTICAL_HALL_BOUNDS, GOBLIN_B_DOOR_ROW),
      gateRowKeepClear(TUTORIAL_STAIR_HALL_BOUNDS, GATE_G3_ROW),
      gateRowKeepClear(TUTORIAL_HUMAN_HALL_BOUNDS, SAFE_ENTRANCE_GATE_ROW),
      smushGateKeepClear,
      columnToRoomBottom(TUTORIAL_CAT_ROOM_BOUNDS, TUTORIAL_CAT_SPAWN_TILE),
      columnToRoomBottom(TUTORIAL_HUMAN_ROOM_BOUNDS, TUTORIAL_HUMAN_SPAWN_TILE),
      columnToRoomBottom(TUTORIAL_TREASURE_ROOM_BOUNDS, {
        x: TUTORIAL_CHEST_POS.x,
        y: TUTORIAL_TREASURE_ROOM_BOUNDS.y,
      }),
      // Mordecai wanders the safe room and its counter and decor are stamped
      // in at runtime, so nothing else is set down in it.
      TUTORIAL_SAFE_ROOM_BOUNDS,
      stairApproach,
      TUTORIAL_STAIR_FOOTPRINT,
      singleTile(GOBLIN_A_POS),
      singleTile(GOBLIN_B_POS),
      singleTile(SMUSH_GUARD_1_POS),
      singleTile(SMUSH_GUARD_2_POS),
    ],
    chestTile: TUTORIAL_CHEST_POS,
    stairTile: TUTORIAL_STAIR_POS,
  };
}

function tutorialMapOptions(): GameMapOptions {
  const grid = buildStructure();
  return {
    prebuiltStructure: grid,
    prebuiltDressing: dressTutorial(tutorialDressingLayout(grid)),
    // A new player's first look at the game is the reviewed art, every time.
    artSeed: DEFAULT_FLOOR_ART_SEED,
    tileHeight: TILE_SIZE,
  };
}

/**
 * The hand-crafted tutorial map.
 * Layout: separate cat/human spawn rooms → hallways → treasure room (cat side) →
 * L-shaped connector → safe room → stair room.
 *
 * Its gates are virtual: `TutorialGates` (src/systems/tutorialGates.ts)
 * clamps crawler positions against them, so every tile is walkable from a type perspective. That lets a Magic
 * Missile fly across a shut gate.
 */
export class TutorialMap extends GameMap {
  readonly catStartTile = TUTORIAL_CAT_SPAWN_TILE;
  readonly humanStartTile = TUTORIAL_HUMAN_SPAWN_TILE;

  constructor() {
    super(tutorialMapOptions());

    this.startTile = { ...TUTORIAL_HUMAN_SPAWN_TILE };

    this.safeRooms = [
      {
        bounds: { ...TUTORIAL_SAFE_ROOM.bounds },
        centre: { ...TUTORIAL_SAFE_ROOM.centre },
        showBed: false,
      },
    ];

    this.setStairwellTiles([{ ...TUTORIAL_STAIR_POS }]);

    // Tutorial goblins are placed by TutorialController, never spawned.
    this.mobSpawnPoints = [];
    this.hallwaySpawnPoints = [];
    this.bossRooms = [];
  }
}
