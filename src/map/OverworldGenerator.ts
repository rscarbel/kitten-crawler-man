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
import { getSpriteDoorwayByKey, getSpriteFootprintByKey } from '../core/SpriteLoader';

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
  /** Centre of the town square, in tile coordinates. */
  townSquareCentre: Point;
  /** Centre tile of the 3×3 town fountain. */
  fountainCentre: Point;
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

  // Half-width of the 5-tile main roads (their near edge sits this many tiles off the centre line).
  const ROAD_HALF = Math.floor(ROAD_WIDTH / 2);

  // Building anchor positions, as signed tile offsets from the town centre (cx, cy).
  // Every sprite building's own footprint and door are derived from its art (see
  // placeSpriteBuilding), so these are just the top-left corner of each PNG.
  //
  // The town reads as two streets ringing the square: the north street carries the
  // store, barracks and cottages, the south street the club, taverns and inn. Every
  // placement dodges the square (±11), the main road bands (±2 around each axis
  // road) and the tower footprint (x −3..+2, y −36..−16), and every door's road
  // stub runs clear of its neighbours.
  const SHEPHERDS_CABIN = { dx: -16, dy: -30 };
  const SHEPHERDS_LEAN_TO = { dx: -23, dy: -30, w: 6, h: 4 };
  const BLACKWOOD_LODGE = { dx: 6, dy: -24 };
  const HILDA_COTTAGE = { dx: -10, dy: -24 };
  const GENERAL_STORE = { dx: -26, dy: -20 };
  const THE_BARRACKS = { dx: 13, dy: -20 };
  const CARTWRIGHT_WORKSHOP = { dx: 34, dy: -20 };
  const CARTWRIGHT_SHED = { dx: 27, dy: -20, w: 6, h: 5 };
  const HERB_AND_REMEDY = { dx: -20, dy: -11 };
  const HORNED_FLAGON = { dx: 20, dy: -10 };
  const TEMPLE_OF_THE_SKY = { dx: -25, dy: 4 };
  const RUSTY_ANVIL = { dx: 21, dy: 6 };
  const SLEEPING_CAT_INN = { dx: -32, dy: 15 };
  const SLEEPING_CAT_STABLE = { dx: -42, dy: 15, w: 8, h: 5 };
  const SUNKEN_STUMP_PUB = { dx: -19, dy: 15 };
  const DESPERADO_CLUB = { dx: 3, dy: 16 };
  const MILLERS_FARM = { dx: -30, dy: 27 };
  const MILLERS_BARN = { dx: -24, dy: 34, w: 8, h: 5 };
  const SIGNETS_INK = { dx: 21, dy: 31 };

  // Widest road stub drawn in front of a door — wider doorways (the mead hall's
  // five-tile front) would otherwise read as a plaza rather than a street.
  const DOOR_ROAD_MAX_WIDTH = 3;

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

  // 6b. Sprite-based building — renders a pre-made PNG instead of procedural tiles.
  //     Footprint and doorway are both derived from the sprite's manifest entry
  //     (frame size and `blockedRegions`), so any art size drops in as data.
  //     Tiles under the art are reserved so ground scatter doesn't paint beneath it.
  interface SpritePlacement {
    doorTile: Point;
    doorwayWidth: number;
    rect: Rect;
  }
  const spriteFootprints: Rect[] = [];
  const placeSpriteBuilding = (
    anchor: { dx: number; dy: number },
    spriteKey: string,
    name: string,
    type: BuildingEntry['type'] = 'house',
  ): SpritePlacement => {
    const bx = cx + anchor.dx;
    const by = cy + anchor.dy;
    // Anchor tile carries the sprite key for rendering.
    grid[by][bx].type = SPRITE_BUILDING;
    grid[by][bx].spriteKey = spriteKey;
    const footprint = getSpriteFootprintByKey(spriteKey);
    const doorway = getSpriteDoorwayByKey(spriteKey);
    if (footprint === undefined || doorway === undefined) {
      throw new Error(`Sprite building '${spriteKey}' is missing a footprint or a doorway`);
    }
    const doorTile: Point = { x: bx + doorway.dx, y: by + doorway.dy };
    set(doorTile.x, doorTile.y, ROAD);
    const rect: Rect = {
      x: bx + footprint.dx,
      y: by + footprint.dy,
      w: footprint.w,
      h: footprint.h,
    };
    buildings.push(rect);
    spriteFootprints.push(rect);
    buildingEntries.push({ doorTile, name, type });
    return { doorTile, doorwayWidth: doorway.width, rect };
  };
  const isUnderSpriteBuilding = (tx: number, ty: number) =>
    spriteFootprints.some((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);

  // 6c. Non-enterable companion structure (shed, stable, barn)
  const placeStructure = (
    anchor: { dx: number; dy: number; w: number; h: number },
    roofTile: number,
  ) => {
    const bx = cx + anchor.dx;
    const by = cy + anchor.dy;
    for (let dy = 0; dy < anchor.h; dy++)
      for (let dx = 0; dx < anchor.w; dx++)
        set(bx + dx, by + dy, dy === 0 || dy === anchor.h - 1 ? BUILDING_WALL : roofTile);
    buildings.push({ x: bx, y: by, w: anchor.w, h: anchor.h });
  };

  /**
   * Draw the street a sprite building's door opens onto. Every building sprite
   * faces south, so the stub always leaves the doorway southward until it clears
   * the art, then either continues to the E-W road (buildings sitting north of it)
   * or turns along the building's frontage to reach the N-S road (buildings south
   * of it). Routing out of the footprint first is what keeps road tiles from being
   * painted through a building's own silhouette.
   */
  const connectDoorToRoad = (placement: SpritePlacement) => {
    const width = Math.min(placement.doorwayWidth, DOOR_ROAD_MAX_WIDTH);
    const startX = placement.doorTile.x - Math.floor((width - 1) / 2);
    const drawRow = (ry: number) => {
      for (let i = 0; i < width; i++) setRoad(startX + i, ry);
    };
    const frontRow = placement.rect.y + placement.rect.h;
    const northRoadEdge = cy - ROAD_HALF;
    const southRoadEdge = cy + ROAD_FAR_SIDE_OFFSET;
    const stubEnd = frontRow < northRoadEdge ? northRoadEdge : frontRow;
    for (let ry = placement.doorTile.y; ry <= stubEnd; ry++) drawRow(ry);
    if (frontRow <= southRoadEdge) return;
    const targetX = placement.doorTile.x < cx ? cx - ROAD_HALF : cx + ROAD_HALF;
    const minX = Math.min(startX, targetX);
    const maxX = Math.max(startX + width - 1, targetX);
    for (let rx = minX; rx <= maxX; rx++) {
      setRoad(rx, frontRow);
      setRoad(rx, frontRow + 1);
    }
  };

  // 7. Named town buildings at fixed positions.
  //    Order is north street → square ring → south street, so the layout below
  //    reads top-to-bottom the way the town does on screen.

  // ── Shepherd's Cabin — north street, outer row: cottage + hay-storage lean-to ──
  connectDoorToRoad(placeSpriteBuilding(SHEPHERDS_CABIN, 'village_house_1', "Shepherd's Cabin"));
  placeStructure(SHEPHERDS_LEAN_TO, ROOF_THATCH);

  // ── Blackwood Lodge — north street, the cult hideout between tower and barracks ──
  connectDoorToRoad(placeSpriteBuilding(BLACKWOOD_LODGE, 'village_house_2', 'Blackwood Lodge'));

  // ── Old Hilda's Cottage — north street, between the store and the tower ──
  connectDoorToRoad(placeSpriteBuilding(HILDA_COTTAGE, 'village_house_3', "Old Hilda's Cottage"));

  // ── General Store — north-west, the town's supply shop ──
  connectDoorToRoad(placeSpriteBuilding(GENERAL_STORE, 'shop', 'General Store', 'store'));

  // ── The Barracks — north-east crawler guildhall; the overworld safe room ──
  connectDoorToRoad(placeSpriteBuilding(THE_BARRACKS, 'barracks', 'The Barracks', 'restaurant'));

  // ── Cartwright's Workshop — far east of the north street: shop + storage shed ──
  placeStructure(CARTWRIGHT_SHED, ROOF_SLATE);
  connectDoorToRoad(
    placeSpriteBuilding(CARTWRIGHT_WORKSHOP, 'village_house_4', "Cartwright's Workshop"),
  );

  // ── Herb & Remedy — apothecary just north-west of the square ──
  connectDoorToRoad(placeSpriteBuilding(HERB_AND_REMEDY, 'village_house_1', 'Herb & Remedy'));

  // ── The Horned Flagon — mead hall fronting the square's east approach ──
  connectDoorToRoad(placeSpriteBuilding(HORNED_FLAGON, 'tavern_2', 'The Horned Flagon'));

  // ── Temple of the Sky — west of the square, facing the plaza ──
  connectDoorToRoad(placeSpriteBuilding(TEMPLE_OF_THE_SKY, 'temple', 'Temple of the Sky'));

  // ── The Rusty Anvil — smithy east of the square; its forges burn in the art ──
  connectDoorToRoad(placeSpriteBuilding(RUSTY_ANVIL, 'blacksmith', 'The Rusty Anvil'));

  // ── The Sleeping Cat Inn — south street, west end: inn + stable beside it ──
  placeStructure(SLEEPING_CAT_STABLE, ROOF_THATCH);
  connectDoorToRoad(placeSpriteBuilding(SLEEPING_CAT_INN, 'small_inn', 'The Sleeping Cat Inn'));

  // ── The Sunken Stump Pub — south street, the cramped dive next to the inn ──
  connectDoorToRoad(placeSpriteBuilding(SUNKEN_STUMP_PUB, 'tavern_1', 'The Sunken Stump Pub'));

  // ── The Desperado Club — the town's south landmark, west wall against the N-S road ──
  connectDoorToRoad(
    placeSpriteBuilding(DESPERADO_CLUB, 'desperado_club', 'The Desperado Club', 'club'),
  );

  // ── Miller's Farm — south street, outer row: farmhouse + large barn behind it ──
  connectDoorToRoad(placeSpriteBuilding(MILLERS_FARM, 'village_house_4', "Miller's Farm"));
  placeStructure(MILLERS_BARN, ROOF_THATCH);

  // ── Signet's Ink — tattoo parlor south of the club, deepest in the nightlife district ──
  connectDoorToRoad(placeSpriteBuilding(SIGNETS_INK, 'tattoo_parlor', "Signet's Ink"));

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
      if (isUnderSpriteBuilding(gx, gy)) continue;
      if (grid[gy][gx].type === GRASS && Math.random() < GRASSY_WEED_DENSITY)
        set(gx, gy, GRASSY_WEED);
    }
  }
  // DIRT_PATCH on road tiles for visual variety
  for (let gy = BORDER + 1; gy < size - BORDER - 1; gy++) {
    for (let gx = BORDER + 1; gx < size - BORDER - 1; gx++) {
      if (isUnderSpriteBuilding(gx, gy)) continue;
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
    townSquareCentre: { x: cx, y: cy },
    fountainCentre: {
      x: cx + FOUNTAIN_SE_OFFSET + Math.floor(FOUNTAIN_SIZE / 2),
      y: cy + FOUNTAIN_SE_OFFSET + Math.floor(FOUNTAIN_SIZE / 2),
    },
    circusCentre: { x: circusCx, y: circusCy },
    circusRadiusTiles: circusRadius,
  };
}
