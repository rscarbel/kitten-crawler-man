import type { TileContent } from './tileTypes';
import {
  FloorTypeValue,
  VOID_TYPE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  FOUNTAIN,
  TORCH,
  WELL,
  GRASSY_WEED,
  DIRT_PATCH,
  TREE,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  MAIN_TOWER,
  SPRITE_BUILDING,
  RUINED_WALL,
  RUBBLE,
} from './tileTypes';
import { randomInt } from '../utils';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export interface BuildingEntry {
  doorTile: Point;
  name: string;
  type: 'house' | 'tower' | 'restaurant' | 'store' | 'club';
}

export interface OverworldData {
  grid: TileContent[][];
  startTile: Point;
  safeRooms: Array<{ bounds: Rect; centre: Point }>;
  buildingEntries: BuildingEntry[];
  bossRooms: Array<{ bounds: Rect; centre: Point }>;
  mobSpawnPoints: Point[];
  hallwaySpawnPoints: Point[];
  stairwellTiles: Point[];
  mainTowerAnchor: Point;
  /** Tile where the town's escape route out appears once the Doomsday finale's escape phase begins. */
  doomsdayEscapeTile: Point;
  /** Tiles from map centre inside which the town is safe — no hostile spawns, mobs deaggro. */
  townSafeRadiusTiles: number;
  /** Centre of the circus, in tile coordinates. */
  circusCentre: Point;
  /** Radius (tiles) of the circus grounds around `circusCentre`. */
  circusRadiusTiles: number;
}

export function generateOverworld(size: number): OverworldData {
  const BORDER = 5;
  const ROAD = FloorTypeValue.road;
  const GRASS = FloorTypeValue.grass;

  // Road geometry
  const ROAD_WIDTH = 5;
  const ROAD_FAR_SIDE_OFFSET = 4;

  // Town square
  const TOWN_SQUARE_HALF = 11;
  const TOWN_SQUARE_SIZE = 22;

  // Tower sprite building footprint (no procedural tiles — sprite overlay)
  const TOWER_SPRITE_DX = 3;
  const TOWER_SPRITE_DY = 36;
  const NORTH_BUILDINGS_Y_OFFSET = 16;

  // Restaurant east of town square
  const REST_X_OFFSET = 14;

  // General Store west of town square
  const STORE_X_OFFSET = 28;

  // Desperado Club — art-deco nightclub south of the square, west wall against the N-S road.
  const CLUB_X_OFFSET = 3;
  const CLUB_Y_OFFSET = 19;
  const CLUB_W = 16;
  const CLUB_H = 6;
  // Half-width of the 5-tile main roads (their near edge sits this many tiles off the centre line).
  const ROAD_HALF = Math.floor(ROAD_WIDTH / 2);

  // Village building positions (offset from town center cx, cy).
  // The town is intentionally compact: buildings form two tight streets
  // ringing the square (rows ~±14–30 tiles from centre) so it reads as a
  // lived-in town rather than scattered homesteads. Placements dodge the
  // square (±11), the main road bands (±2 around each axis road), the tower
  // footprint (x −3..+2, y −36..−16), and the store/restaurant rows
  // (y −16..−12), and every door's L-road to a main road stays unblocked.
  const SHEPHERDS_CABIN_DX = 16;
  const SHEPHERDS_CABIN_DY = 30;
  const SHEPHERDS_LEAN_TO_DX = 23;
  const SHEPHERDS_LEAN_TO_DY = 30;
  const SHEPHERDS_LEAN_TO_W = 6;
  const SHEPHERDS_LEAN_TO_H = 4;
  const BARRACKS_DX = 6;
  const BARRACKS_DY = 24;
  const HILDA_DX = 10;
  const HILDA_DY = 24;
  const CARTWRIGHT_DX = 16;
  const CARTWRIGHT_SHED_DX = 22;
  const CARTWRIGHT_SHED_DY = 10;
  const CARTWRIGHT_SHED_W = 6;
  const CARTWRIGHT_SHED_H = 5;
  const CARTWRIGHT_DY = 10;
  const HERB_DX = 16;
  const HERB_DY = 6;
  const SLEEPING_CAT_DX = 16;
  const SLEEPING_CAT_DY = 14;
  const SLEEPING_CAT_STABLE_DY = 21;
  const SLEEPING_CAT_STABLE_W = 8;
  const SLEEPING_CAT_STABLE_H = 5;
  const RUSTY_ANVIL_DX = 14;
  const RUSTY_ANVIL_DY = 14;
  const RUSTY_ANVIL_FORGE_DX = 21;
  const RUSTY_ANVIL_FORGE_W = 7;
  const RUSTY_ANVIL_FORGE_H = 5;
  const MILLERS_FARM_DX = 24;
  const MILLERS_FARM_DY = 14;
  const MILLERS_FARM_BARN_DX = 25;
  const MILLERS_FARM_BARN_DY = 20;
  const MILLERS_FARM_BARN_W = 8;
  const MILLERS_FARM_BARN_H = 5;
  const WANDERERS_REST_DX = 16;
  const WANDERERS_REST_DY = 6;
  const SUNKEN_STUMP_DX = 10;
  const SUNKEN_STUMP_DY = 14;

  // Circus placement
  const CIRCUS_MIN_DIST = 70;
  const CIRCUS_DIST_VARIANCE = 20;

  // Town safe zone — inside this radius (tiles from map centre) no hostile mobs
  // spawn and hostile mobs won't target players. Comfortably covers every named
  // village building while leaving a ruins buffer before the circus footprint.
  const TOWN_SAFE_RADIUS_TILES = 55;
  // Ruins ambient-mob spawn scatter
  const RUINS_SPAWN_ATTEMPTS = 220;
  const RUINS_EDGE_MARGIN = 12;
  const RUINS_CIRCUS_BUFFER = 12;
  // Ruined-wall shell scatter
  const NUM_RUIN_SHELLS = 26;
  const RUIN_SHELL_MIN_SIZE = 4;
  const RUIN_SHELL_SIZE_RANGE = 5;
  const RUIN_SHELL_BREAK_CHANCE = 0.4;
  const RUBBLE_DENSITY = 0.05;

  // Torch angles (60° increments around a full circle)
  const TORCH_STEP_DEG = 60;
  const HALF_CIRCLE_DEG = 180;

  // Forest blobs
  const FOREST_MIN_DIST_TILES = 65;
  const FOREST_EDGE_MARGIN = 75;
  const FOREST_MIN_RADIUS = 8;
  const FOREST_MAX_RADIUS = 21;
  const FOREST_EDGE_NOISE_RADIUS = 0.7;
  const FOREST_EDGE_SKIP_CHANCE = 0.45;

  // Main tower tile north of town center
  const MAIN_TOWER_NORTH_OFFSET = 15;

  // Town square decorations
  const FOUNTAIN_SE_OFFSET = 4;
  const FOUNTAIN_SIZE = 3;
  const GATE_TORCH_INNER_OFFSET = 3;
  const WELL_DIAGONAL_OFFSET = 7;

  // Escape stairwell — the way down off the floor once the soul crystal goes
  // critical. Sits just inside the town square, south of the tower door.
  const STAIRWELL_SOUTH_OF_TOWER_DOOR = 6;

  // Ground cover probabilities
  const GRASSY_WEED_DENSITY = 0.015;
  const DIRT_PATCH_DENSITY = 0.06;

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
      t === ROOF_CIRCUS_RED ||
      t === ROOF_CIRCUS_BLUE ||
      t === ROOF_CIRCUS_PURPLE ||
      t === SPRITE_BUILDING ||
      t === VOID_TYPE
    )
      return;
    grid[y][x].type = ROAD;
  };
  const fill = (x: number, y: number, w: number, h: number, type: number) => {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set(x + dx, y + dy, type);
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
      t === ROOF_GREEN ||
      t === ROOF_CIRCUS_RED ||
      t === ROOF_CIRCUS_BLUE ||
      t === ROOF_CIRCUS_PURPLE ||
      t === SPRITE_BUILDING
    );
  };

  // 2. Void border
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (y < BORDER || y >= size - BORDER || x < BORDER || x >= size - BORDER)
        grid[y][x].type = VOID_TYPE;

  // 3. Main roads (cross through town)
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);
  fill(BORDER, cy - 2, size - BORDER * 2, ROAD_WIDTH, ROAD); // E-W
  fill(cx - 2, BORDER, ROAD_WIDTH, size - BORDER * 2, ROAD); // N-S

  // 4. Town square
  fill(cx - TOWN_SQUARE_HALF, cy - TOWN_SQUARE_HALF, TOWN_SQUARE_SIZE, TOWN_SQUARE_SIZE, ROAD);

  // 5. Helper: place a building and register its door
  const buildings: Array<{ x: number; y: number; w: number; h: number }> = [];
  const buildingEntries: BuildingEntry[] = [];
  const placeBuilding = (
    bx: number,
    by: number,
    bw: number,
    bh: number,
    type: 'house' | 'tower' | 'restaurant' | 'store' | 'club',
    name: string,
    roofTile: number,
  ) => {
    // North/south rows = BUILDING_WALL (gable + facade), sides + interior = roof tile
    for (let dy = 0; dy < bh; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        const isNorthSouth = dy === 0 || dy === bh - 1;
        set(bx + dx, by + dy, isNorthSouth ? BUILDING_WALL : roofTile);
      }
    }
    // Door: 2-tile gap at south face center
    const doorX = bx + Math.floor(bw / 2) - 1;
    const doorY = by + bh - 1;
    set(doorX, doorY, ROAD);
    set(doorX + 1, doorY, ROAD);
    buildings.push({ x: bx, y: by, w: bw, h: bh });
    buildingEntries.push({
      doorTile: { x: doorX, y: doorY },
      name,
      type,
    });
  };

  // so BUILDING_WALL / ROOF_SLATE tiles are not placed (they would show through transparent sprite areas).
  buildings.push({ x: cx - TOWER_SPRITE_DX, y: cy - TOWER_SPRITE_DY, w: 6, h: 21 });
  buildingEntries.push({
    doorTile: { x: cx - 1, y: cy - NORTH_BUILDINGS_Y_OFFSET },
    name: 'Town Center Tower',
    type: 'tower',
  });

  // 6b. The Restaurant — safe room building, east of town square, north of E-W road.
  //     Entering triggers a BuildingInteriorScene with a safe-room interior.
  const restW = 14;
  const restH = 5;
  const restX = cx + REST_X_OFFSET;
  const restY = cy - NORTH_BUILDINGS_Y_OFFSET;
  placeBuilding(restX, restY, restW, restH, 'restaurant', 'Safe Room', ROOF_RED);
  // Short road stub south from restaurant door to the E-W road
  const restDoorX = restX + Math.floor(restW / 2) - 1;
  for (let ry = restY + restH; ry <= cy - 2; ry++) {
    setRoad(restDoorX, ry);
    setRoad(restDoorX + 1, ry);
  }

  // 6c. General Store — west of town square, mirroring the restaurant on the east side.
  const storeW = 14;
  const storeH = 5;
  const storeX = cx - STORE_X_OFFSET;
  const storeY = cy - NORTH_BUILDINGS_Y_OFFSET;
  placeBuilding(storeX, storeY, storeW, storeH, 'store', 'General Store', ROOF_GREEN);
  // Short road stub south from store door to the E-W road
  const storeDoorX = storeX + Math.floor(storeW / 2) - 1;
  for (let ry = storeY + storeH; ry <= cy - 2; ry++) {
    setRoad(storeDoorX, ry);
    setRoad(storeDoorX + 1, ry);
  }

  // 6d. The Desperado Club — a prominent art-deco club at the town's south edge.
  const clubX = cx + CLUB_X_OFFSET;
  const clubY = cy + CLUB_Y_OFFSET;
  placeBuilding(clubX, clubY, CLUB_W, CLUB_H, 'club', 'The Desperado Club', ROOF_SLATE);
  // Connector: run a road from below the south-facing door west to the N-S main road.
  const clubDoorX = clubX + Math.floor(CLUB_W / 2) - 1;
  const clubConnectorRow = clubY + CLUB_H;
  for (let rx = cx - ROAD_HALF; rx <= clubDoorX + 1; rx++) {
    setRoad(rx, clubConnectorRow);
    setRoad(rx, clubConnectorRow + 1);
  }

  // 6d. Sprite-based house — renders a pre-made PNG instead of procedural tiles.
  //     Footprint: 5 tiles wide × 4 tiles tall. Door at col 2, row 3 (anchor-relative).
  const SPRITE_HOUSE_W = 5;
  const SPRITE_HOUSE_H = 4;
  const SPRITE_DOOR_DX = 2;
  const SPRITE_DOOR_DY = 3;
  const placeSpriteBuilding = (bx: number, by: number, spriteKey: string, name: string) => {
    // Anchor tile carries the sprite key for rendering.
    grid[by][bx].type = SPRITE_BUILDING;
    grid[by][bx].spriteKey = spriteKey;
    // Door tile — walkable entry point.
    set(bx + SPRITE_DOOR_DX, by + SPRITE_DOOR_DY, ROAD);
    buildings.push({ x: bx, y: by, w: SPRITE_HOUSE_W, h: SPRITE_HOUSE_H });
    buildingEntries.push({
      doorTile: { x: bx + SPRITE_DOOR_DX, y: by + SPRITE_DOOR_DY },
      name,
      type: 'house',
    });
  };

  // 7. Named village buildings at fixed positions
  // placeStructure: non-enterable companion structure (shed, stable, barn, forge)
  const placeStructure = (bx: number, by: number, bw: number, bh: number, roofTile: number) => {
    for (let dy = 0; dy < bh; dy++)
      for (let dx = 0; dx < bw; dx++)
        set(bx + dx, by + dy, dy === 0 || dy === bh - 1 ? BUILDING_WALL : roofTile);
    buildings.push({ x: bx, y: by, w: bw, h: bh });
  };

  // connectToRoad: draw an L-shaped 2–3-tile-wide road from a door to the nearest main road
  const connectToRoad = (doorX: number, doorY: number) => {
    const toEW = Math.abs(doorY - cy) <= Math.abs(doorX - cx);
    if (toEW) {
      const targetY = doorY < cy ? cy - 2 : cy + ROAD_FAR_SIDE_OFFSET;
      const minY = Math.min(doorY, targetY);
      const maxY = Math.max(doorY, targetY);
      for (let ry = minY; ry <= maxY; ry++) {
        setRoad(doorX, ry);
        setRoad(doorX + 1, ry);
        setRoad(doorX + 2, ry);
      }
    } else {
      const targetX = doorX < cx ? cx - 2 : cx + ROAD_FAR_SIDE_OFFSET;
      const minX = Math.min(doorX, targetX);
      const maxX = Math.max(doorX, targetX);
      for (let rx = minX; rx <= maxX; rx++) {
        setRoad(rx, doorY);
        setRoad(rx, doorY + 1);
      }
      const minY2 = Math.min(doorY, cy - 2);
      const maxY2 = Math.max(doorY, cy + ROAD_FAR_SIDE_OFFSET);
      for (let ry = minY2; ry <= maxY2; ry++) {
        setRoad(doorX, ry);
        setRoad(doorX + 1, ry);
      }
    }
  };

  // ── Shepherd's Cabin — north street, second row: cottage + hay-storage lean-to ──
  placeSpriteBuilding(
    cx - SHEPHERDS_CABIN_DX,
    cy - SHEPHERDS_CABIN_DY,
    'village_house_1',
    "Shepherd's Cabin",
  );
  placeStructure(
    cx - SHEPHERDS_LEAN_TO_DX,
    cy - SHEPHERDS_LEAN_TO_DY,
    SHEPHERDS_LEAN_TO_W,
    SHEPHERDS_LEAN_TO_H,
    ROOF_THATCH,
  ); // lean-to shed
  connectToRoad(cx - SHEPHERDS_CABIN_DX + SPRITE_DOOR_DX, cy - SHEPHERDS_CABIN_DY + SPRITE_DOOR_DY);

  // ── Blackwood Barracks — north street, between the tower and restaurant ──
  placeSpriteBuilding(cx + BARRACKS_DX, cy - BARRACKS_DY, 'village_house_2', 'Blackwood Barracks');
  connectToRoad(cx + BARRACKS_DX + SPRITE_DOOR_DX, cy - BARRACKS_DY + SPRITE_DOOR_DY);

  // ── Old Hilda's Cottage — north street, between the store and tower ──
  placeSpriteBuilding(cx - HILDA_DX, cy - HILDA_DY, 'village_house_3', "Old Hilda's Cottage");
  connectToRoad(cx - HILDA_DX + SPRITE_DOOR_DX, cy - HILDA_DY + SPRITE_DOOR_DY);

  // ── Cartwright's Workshop — east of the square: main shop + storage shed beside it ──
  placeStructure(
    cx + CARTWRIGHT_SHED_DX,
    cy - CARTWRIGHT_SHED_DY,
    CARTWRIGHT_SHED_W,
    CARTWRIGHT_SHED_H,
    ROOF_SLATE,
  ); // storage shed
  placeSpriteBuilding(
    cx + CARTWRIGHT_DX,
    cy - CARTWRIGHT_DY,
    'village_house_4',
    "Cartwright's Workshop",
  );
  connectToRoad(cx + CARTWRIGHT_DX + SPRITE_DOOR_DX, cy - CARTWRIGHT_DY + SPRITE_DOOR_DY);

  // ── Herb & Remedy — apothecary fronting the square's west edge ──
  placeSpriteBuilding(cx - HERB_DX, cy + HERB_DY, 'village_house_1', 'Herb & Remedy');
  connectToRoad(cx - HERB_DX + SPRITE_DOOR_DX, cy + HERB_DY + SPRITE_DOOR_DY);

  // ── The Sleeping Cat Inn — south street: inn + stable behind it ──
  placeSpriteBuilding(
    cx - SLEEPING_CAT_DX,
    cy + SLEEPING_CAT_DY,
    'village_house_2',
    'The Sleeping Cat Inn',
  );
  placeStructure(
    cx - SLEEPING_CAT_DX,
    cy + SLEEPING_CAT_STABLE_DY,
    SLEEPING_CAT_STABLE_W,
    SLEEPING_CAT_STABLE_H,
    ROOF_THATCH,
  ); // stable
  connectToRoad(cx - SLEEPING_CAT_DX + SPRITE_DOOR_DX, cy + SLEEPING_CAT_DY + SPRITE_DOOR_DY);

  // ── The Rusty Anvil — south street, east side: forge building + work shed ──
  placeSpriteBuilding(
    cx + RUSTY_ANVIL_DX,
    cy + RUSTY_ANVIL_DY,
    'village_house_3',
    'The Rusty Anvil',
  );
  placeStructure(
    cx + RUSTY_ANVIL_FORGE_DX,
    cy + RUSTY_ANVIL_DY,
    RUSTY_ANVIL_FORGE_W,
    RUSTY_ANVIL_FORGE_H,
    ROOF_RED,
  ); // forge shed
  connectToRoad(cx + RUSTY_ANVIL_DX + SPRITE_DOOR_DX, cy + RUSTY_ANVIL_DY + SPRITE_DOOR_DY);

  // ── Miller's Farm — south street, west end: farmhouse + large barn behind it ──
  placeSpriteBuilding(
    cx - MILLERS_FARM_DX,
    cy + MILLERS_FARM_DY,
    'village_house_4',
    "Miller's Farm",
  );
  placeStructure(
    cx - MILLERS_FARM_BARN_DX,
    cy + MILLERS_FARM_BARN_DY,
    MILLERS_FARM_BARN_W,
    MILLERS_FARM_BARN_H,
    ROOF_THATCH,
  ); // barn
  connectToRoad(cx - MILLERS_FARM_DX + SPRITE_DOOR_DX, cy + MILLERS_FARM_DY + SPRITE_DOOR_DY);

  // ── The Wanderer's Rest — dormitory fronting the square's east edge ──
  placeSpriteBuilding(
    cx + WANDERERS_REST_DX,
    cy + WANDERERS_REST_DY,
    'village_house_1',
    "The Wanderer's Rest",
  );
  connectToRoad(cx + WANDERERS_REST_DX + SPRITE_DOOR_DX, cy + WANDERERS_REST_DY + SPRITE_DOOR_DY);

  // ── The Sunken Stump Pub — south street: pub in the alley row beside the inn ──
  placeSpriteBuilding(
    cx - SUNKEN_STUMP_DX,
    cy + SUNKEN_STUMP_DY,
    'village_house_2',
    'The Sunken Stump Pub',
  );
  connectToRoad(cx - SUNKEN_STUMP_DX + SPRITE_DOOR_DX, cy + SUNKEN_STUMP_DY + SPRITE_DOOR_DY);

  // 7b. Circus — cluster of tents 60+ tiles from town center
  let circusCx = cx;
  let circusCy = cy;
  const circusRadius = 14;
  {
    // Pick a random angle and distance for circus placement
    const circusAngle = Math.random() * Math.PI * 2;
    const circusDist = CIRCUS_MIN_DIST + Math.random() * CIRCUS_DIST_VARIANCE;
    circusCx = Math.round(cx + Math.cos(circusAngle) * circusDist);
    circusCy = Math.round(cy + Math.sin(circusAngle) * circusDist);

    // Circus ground: a roughly circular dirt/road area
    for (let dy = -circusRadius; dy <= circusRadius; dy++) {
      for (let dx = -circusRadius; dx <= circusRadius; dx++) {
        if (Math.hypot(dx, dy) > circusRadius) continue;
        const tx = circusCx + dx;
        const ty2 = circusCy + dy;
        if (tx < BORDER + 1 || tx >= size - BORDER - 1) continue;
        if (ty2 < BORDER + 1 || ty2 >= size - BORDER - 1) continue;
        if (isSolid(tx, ty2)) continue;
        grid[ty2][tx].type = ROAD;
      }
    }

    // Big tent (enterable) — 12×5, red & white stripes, centered in circus
    const bigW = 12;
    const bigH = 5;
    const bigX = circusCx - Math.floor(bigW / 2);
    const bigY = circusCy - Math.floor(bigH / 2) - 2; // offset north a bit
    placeBuilding(bigX, bigY, bigW, bigH, 'house', 'Big Top', ROOF_CIRCUS_RED);

    // Small decorative tents (not enterable) — just solid tile structures
    const placeTent = (tentX: number, tentY: number, tw: number, th: number, roofTile: number) => {
      // Bounds check
      if (tentX < BORDER + 2 || tentX + tw > size - BORDER - 2) return;
      if (tentY < BORDER + 2 || tentY + th > size - BORDER - 2) return;
      // Collision check
      const pad = 1;
      const overlaps = buildings.some(
        (b) =>
          tentX < b.x + b.w + pad &&
          tentX + tw + pad > b.x &&
          tentY < b.y + b.h + pad &&
          tentY + th + pad > b.y,
      );
      if (overlaps) return;
      // Place as solid non-enterable structure (all walls + roof, no door)
      for (let dy = 0; dy < th; dy++) {
        for (let dx = 0; dx < tw; dx++) {
          const isEdge = dy === 0 || dy === th - 1;
          set(tentX + dx, tentY + dy, isEdge ? BUILDING_WALL : roofTile);
        }
      }
      buildings.push({ x: tentX, y: tentY, w: tw, h: th });
    };

    const smallTents = [
      { dx: -8, dy: -3, w: 6, h: 3, roof: ROOF_CIRCUS_BLUE },
      { dx: 8, dy: -3, w: 6, h: 3, roof: ROOF_CIRCUS_PURPLE },
      { dx: -7, dy: 5, w: 5, h: 3, roof: ROOF_CIRCUS_PURPLE },
      { dx: 7, dy: 5, w: 5, h: 3, roof: ROOF_CIRCUS_BLUE },
      { dx: 0, dy: 7, w: 6, h: 3, roof: ROOF_CIRCUS_RED },
    ];

    for (const tent of smallTents) {
      const tx2 = circusCx + tent.dx - Math.floor(tent.w / 2);
      const ty2 = circusCy + tent.dy - Math.floor(tent.h / 2);
      placeTent(tx2, ty2, tent.w, tent.h, tent.roof);
    }

    // Road connecting circus to the nearest main road
    // Route south/north to E-W road
    const circusDoorY = circusCy + circusRadius + 1;
    const targetRoadY = circusDoorY < cy ? cy - 2 : cy + ROAD_FAR_SIDE_OFFSET;
    const minRY = Math.min(circusDoorY, targetRoadY);
    const maxRY = Math.max(circusDoorY, targetRoadY);
    for (let ry = minRY; ry <= maxRY; ry++) {
      setRoad(circusCx - 1, ry);
      setRoad(circusCx, ry);
      setRoad(circusCx + 1, ry);
    }
    // Also connect east/west to N-S road
    const targetRoadX = circusCx < cx ? cx - 2 : cx + ROAD_FAR_SIDE_OFFSET;
    const minRX = Math.min(circusCx, targetRoadX);
    const maxRX = Math.max(circusCx, targetRoadX);
    for (let rx = minRX; rx <= maxRX; rx++) {
      setRoad(rx, circusCy);
      setRoad(rx, circusCy + 1);
    }

    // Torches around the circus perimeter
    const torchAngles = [
      0,
      TORCH_STEP_DEG,
      TORCH_STEP_DEG * 2,
      HALF_CIRCLE_DEG,
      HALF_CIRCLE_DEG + TORCH_STEP_DEG,
      HALF_CIRCLE_DEG + TORCH_STEP_DEG * 2,
    ];
    for (const deg of torchAngles) {
      const a = (deg * Math.PI) / HALF_CIRCLE_DEG;
      const torchX = Math.round(circusCx + Math.cos(a) * (circusRadius - 1));
      const torchY = Math.round(circusCy + Math.sin(a) * (circusRadius - 1));
      if (
        torchX > BORDER &&
        torchX < size - BORDER &&
        torchY > BORDER &&
        torchY < size - BORDER &&
        !isSolid(torchX, torchY)
      ) {
        set(torchX, torchY, TORCH);
      }
    }
  }

  // 8. Forest blobs in wilderness (>65 tiles from center, not over roads)
  const NUM_FORESTS = 30;
  for (let f = 0; f < NUM_FORESTS; f++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = FOREST_MIN_DIST_TILES + Math.random() * (size / 2 - FOREST_EDGE_MARGIN);
    const fx = Math.round(cx + Math.cos(angle) * dist);
    const fy = Math.round(cy + Math.sin(angle) * dist);
    const radius = randomInt(FOREST_MIN_RADIUS, FOREST_MAX_RADIUS);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        // Irregular edge via noise
        if (d > radius * FOREST_EDGE_NOISE_RADIUS && Math.random() < FOREST_EDGE_SKIP_CHANCE)
          continue;
        const tx = fx + dx;
        const ty = fy + dy;
        if (tx < BORDER || tx >= size - BORDER || ty < BORDER || ty >= size - BORDER) continue;
        if (isSolid(tx, ty)) continue;
        if (grid[ty][tx].type === ROAD) continue; // Don't overwrite roads
        grid[ty][tx].type = TREE;
      }
    }
  }

  // 8b. Ruins decoration — broken wall shells scattered beyond the town safe zone,
  // reading as the remains of a destroyed city rather than open countryside.
  const RUIN_SHELL_INTERIOR_RUBBLE_CHANCE = 0.5;
  const isRuinsGround = (tx: number, ty: number) =>
    tx > BORDER &&
    tx < size - BORDER &&
    ty > BORDER &&
    ty < size - BORDER &&
    grid[ty][tx].type === GRASS;

  // Shells can be up to RUIN_SHELL_MIN_SIZE + RUIN_SHELL_SIZE_RANGE tiles wide, so
  // start sampling that far past the safe radius to keep their footprint fully outside it.
  const RUIN_SHELL_SAFE_ZONE_CLEARANCE = RUIN_SHELL_MIN_SIZE + RUIN_SHELL_SIZE_RANGE;
  for (let i = 0; i < NUM_RUIN_SHELLS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist =
      TOWN_SAFE_RADIUS_TILES +
      RUIN_SHELL_SAFE_ZONE_CLEARANCE +
      Math.random() *
        (size / 2 -
          BORDER -
          RUINS_EDGE_MARGIN -
          TOWN_SAFE_RADIUS_TILES -
          RUIN_SHELL_SAFE_ZONE_CLEARANCE);
    const shellCx = Math.round(cx + Math.cos(angle) * dist);
    const shellCy = Math.round(cy + Math.sin(angle) * dist);
    if (Math.hypot(shellCx - circusCx, shellCy - circusCy) < circusRadius + RUINS_CIRCUS_BUFFER)
      continue;

    const w = RUIN_SHELL_MIN_SIZE + randomInt(0, RUIN_SHELL_SIZE_RANGE);
    const h = RUIN_SHELL_MIN_SIZE + randomInt(0, RUIN_SHELL_SIZE_RANGE);
    const shellX = shellCx - Math.floor(w / 2);
    const shellY = shellCy - Math.floor(h / 2);

    // Jagged perimeter outline — random tiles knocked out for a "broken" look.
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const isPerimeter = dy === 0 || dy === h - 1 || dx === 0 || dx === w - 1;
        if (!isPerimeter || Math.random() < RUIN_SHELL_BREAK_CHANCE) continue;
        const tx = shellX + dx;
        const ty = shellY + dy;
        if (!isRuinsGround(tx, ty)) continue;
        grid[ty][tx].type = RUINED_WALL;
      }
    }
    // Rubble-strewn interior
    for (let dy = 1; dy < h - 1; dy++) {
      for (let dx = 1; dx < w - 1; dx++) {
        if (Math.random() >= RUIN_SHELL_INTERIOR_RUBBLE_CHANCE) continue;
        const tx = shellX + dx;
        const ty = shellY + dy;
        if (!isRuinsGround(tx, ty)) continue;
        grid[ty][tx].type = RUBBLE;
      }
    }
  }

  // Loose rubble scattered across the whole ruins band, outside any shell
  for (let gy = BORDER + 1; gy < size - BORDER - 1; gy++) {
    for (let gx = BORDER + 1; gx < size - BORDER - 1; gx++) {
      if (grid[gy][gx].type !== GRASS) continue;
      if (Math.hypot(gx - cx, gy - cy) <= TOWN_SAFE_RADIUS_TILES) continue;
      if (Math.random() < RUBBLE_DENSITY) grid[gy][gx].type = RUBBLE;
    }
  }

  // 8c. Ambient ruins-mob spawn points — scattered outside the town safe zone
  // and the circus footprint (the circus questline gates its own mobs separately).
  const hallwaySpawnPoints: Point[] = [];
  for (let i = 0; i < RUINS_SPAWN_ATTEMPTS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist =
      TOWN_SAFE_RADIUS_TILES +
      Math.random() * (size / 2 - BORDER - RUINS_EDGE_MARGIN - TOWN_SAFE_RADIUS_TILES);
    const tx = Math.round(cx + Math.cos(angle) * dist);
    const ty = Math.round(cy + Math.sin(angle) * dist);
    if (tx <= BORDER || tx >= size - BORDER || ty <= BORDER || ty >= size - BORDER) continue;
    if (Math.hypot(tx - circusCx, ty - circusCy) < circusRadius + RUINS_CIRCUS_BUFFER) continue;
    const t = grid[ty][tx].type;
    if (t !== GRASS && t !== ROAD && t !== RUBBLE) continue;
    hallwaySpawnPoints.push({ x: tx, y: ty });
  }

  // 9. Road bypass routing — buildings that sit between two road segments get a detour
  for (const b of buildings) {
    // ── N-S bisection: road exists directly north AND directly south ──
    let hasRoadN = false;
    let hasRoadS = false;
    for (let bx = b.x - 1; bx <= b.x + b.w; bx++) {
      if (bx < BORDER || bx >= size - BORDER) continue;
      if (b.y - 1 >= BORDER && grid[b.y - 1]?.[bx]?.type === ROAD) hasRoadN = true;
      if (b.y + b.h < size - BORDER && grid[b.y + b.h]?.[bx]?.type === ROAD) hasRoadS = true;
    }
    if (hasRoadN && hasRoadS) {
      const rowTop = b.y - 1;
      const rowBot = b.y + b.h;
      let wClear = b.x - 1 >= BORDER;
      if (wClear) {
        for (let ry = rowTop; ry <= rowBot; ry++)
          if (isSolid(b.x - 1, ry)) {
            wClear = false;
            break;
          }
      }
      let eClear = b.x + b.w < size - BORDER;
      if (eClear) {
        for (let ry = rowTop; ry <= rowBot; ry++)
          if (isSolid(b.x + b.w, ry)) {
            eClear = false;
            break;
          }
      }
      // Route on all available sides (west and/or east) + horizontal stitches
      if (wClear) {
        for (let ry = rowTop; ry <= rowBot; ry++) setRoad(b.x - 1, ry);
        for (let rx = b.x - 1; rx <= b.x + b.w; rx++) setRoad(rx, rowTop);
        for (let rx = b.x - 1; rx <= b.x + b.w; rx++) setRoad(rx, rowBot);
      }
      if (eClear) {
        for (let ry = rowTop; ry <= rowBot; ry++) setRoad(b.x + b.w, ry);
        for (let rx = b.x - 1; rx <= b.x + b.w; rx++) setRoad(rx, rowTop);
        for (let rx = b.x - 1; rx <= b.x + b.w; rx++) setRoad(rx, rowBot);
      }
    }

    // ── E-W bisection: road exists directly west AND directly east ──
    let hasRoadW = false;
    let hasRoadE = false;
    for (let bry = b.y - 1; bry <= b.y + b.h; bry++) {
      if (bry < BORDER || bry >= size - BORDER) continue;
      if (b.x - 1 >= BORDER && grid[bry]?.[b.x - 1]?.type === ROAD) hasRoadW = true;
      if (b.x + b.w < size - BORDER && grid[bry]?.[b.x + b.w]?.type === ROAD) hasRoadE = true;
    }
    if (hasRoadW && hasRoadE) {
      const colLeft = b.x - 1;
      const colRight = b.x + b.w;
      let nClear = b.y - 1 >= BORDER;
      if (nClear) {
        for (let rx = colLeft; rx <= colRight; rx++)
          if (isSolid(rx, b.y - 1)) {
            nClear = false;
            break;
          }
      }
      let sClear = b.y + b.h < size - BORDER;
      if (sClear) {
        for (let rx = colLeft; rx <= colRight; rx++)
          if (isSolid(rx, b.y + b.h)) {
            sClear = false;
            break;
          }
      }
      if (nClear) {
        for (let rx = colLeft; rx <= colRight; rx++) setRoad(rx, b.y - 1);
        for (let ry = b.y - 1; ry <= b.y + b.h; ry++) setRoad(colLeft, ry);
        for (let ry = b.y - 1; ry <= b.y + b.h; ry++) setRoad(colRight, ry);
      }
      if (sClear) {
        for (let rx = colLeft; rx <= colRight; rx++) setRoad(rx, b.y + b.h);
        for (let ry = b.y - 1; ry <= b.y + b.h; ry++) setRoad(colLeft, ry);
        for (let ry = b.y - 1; ry <= b.y + b.h; ry++) setRoad(colRight, ry);
      }
    }
  }

  // Place MAIN_TOWER anchor after bypass routing so road stitching cannot overwrite it.
  set(cx, cy - MAIN_TOWER_NORTH_OFFSET, MAIN_TOWER);
  const mainTowerAnchor: Point = { x: cx, y: cy - MAIN_TOWER_NORTH_OFFSET };

  // Not added to `stairwellTiles` — that array feeds StairwellSystem/MiniMapSystem,
  // which would expose and pathing-block this tile floor-wide before the finale
  // even starts. DoomsdayEscapeSystem reads this dedicated field instead.
  const doomsdayEscapeTile: Point = {
    x: cx - 1,
    y: cy - NORTH_BUILDINGS_Y_OFFSET + STAIRWELL_SOUTH_OF_TOWER_DOOR,
  };
  set(doomsdayEscapeTile.x, doomsdayEscapeTile.y, ROAD);

  // 10. Town decorations: fountain, torches, wells, ground scatter
  // Fountain — 3×3 block in the SE quadrant of the town square
  fill(cx + FOUNTAIN_SE_OFFSET, cy + FOUNTAIN_SE_OFFSET, FOUNTAIN_SIZE, FOUNTAIN_SIZE, FOUNTAIN);
  // Torches flanking each of the 4 main-road gates into the town square
  set(cx - GATE_TORCH_INNER_OFFSET, cy - TOWN_SQUARE_HALF, TORCH);
  set(cx + GATE_TORCH_INNER_OFFSET, cy - TOWN_SQUARE_HALF, TORCH); // North gate
  set(cx - GATE_TORCH_INNER_OFFSET, cy + TOWN_SQUARE_HALF, TORCH);
  set(cx + GATE_TORCH_INNER_OFFSET, cy + TOWN_SQUARE_HALF, TORCH); // South gate
  set(cx - TOWN_SQUARE_HALF, cy - GATE_TORCH_INNER_OFFSET, TORCH);
  set(cx - TOWN_SQUARE_HALF, cy + GATE_TORCH_INNER_OFFSET, TORCH); // West gate
  set(cx + TOWN_SQUARE_HALF, cy - GATE_TORCH_INNER_OFFSET, TORCH);
  set(cx + TOWN_SQUARE_HALF, cy + GATE_TORCH_INNER_OFFSET, TORCH); // East gate
  // Torches flanking the tower entrance (one row below the tower's south wall)
  set(cx - 2, cy - MAIN_TOWER_NORTH_OFFSET, TORCH);
  set(cx + 1, cy - MAIN_TOWER_NORTH_OFFSET, TORCH);
  // Wells — SW and NE quadrants of the town square
  set(cx - WELL_DIAGONAL_OFFSET, cy + WELL_DIAGONAL_OFFSET, WELL);
  set(cx + WELL_DIAGONAL_OFFSET, cy - WELL_DIAGONAL_OFFSET, WELL);
  // Scattered GRASSY_WEED on open grass tiles
  for (let gy = BORDER + 1; gy < size - BORDER - 1; gy++) {
    for (let gx = BORDER + 1; gx < size - BORDER - 1; gx++) {
      if (grid[gy][gx].type === GRASS && Math.random() < GRASSY_WEED_DENSITY)
        set(gx, gy, GRASSY_WEED);
    }
  }
  // DIRT_PATCH on road tiles for visual variety
  for (let gy = BORDER + 1; gy < size - BORDER - 1; gy++) {
    for (let gx = BORDER + 1; gx < size - BORDER - 1; gx++) {
      if (grid[gy][gx].type === ROAD && Math.random() < DIRT_PATCH_DENSITY) set(gx, gy, DIRT_PATCH);
    }
  }

  // 11. Map metadata
  // Start in the town square center
  const startTile: Point = { x: cx, y: cy };
  // Safe room is inside the restaurant (handled by BuildingInteriorScene)
  const safeRooms: Array<{
    bounds: { x: number; y: number; w: number; h: number };
    centre: { x: number; y: number };
  }> = [];

  return {
    grid,
    startTile,
    safeRooms,
    buildingEntries,
    bossRooms: [],
    mobSpawnPoints: [],
    hallwaySpawnPoints,
    stairwellTiles: [],
    mainTowerAnchor,
    doomsdayEscapeTile,
    townSafeRadiusTiles: TOWN_SAFE_RADIUS_TILES,
    circusCentre: { x: circusCx, y: circusCy },
    circusRadiusTiles: circusRadius,
  };
}
