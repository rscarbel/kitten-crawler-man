import {
  FloorTypeValue,
  TileContent,
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
} from './tileTypes';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export interface BuildingEntry {
  doorTile: Point;
  name: string;
  type: 'house' | 'tower' | 'restaurant' | 'store';
}

export interface OverworldData {
  grid: TileContent[][];
  startTile: Point;
  safeRooms: Array<{ bounds: Rect; centre: Point }>;
  safeRoomBounds: Rect | null;
  safeRoomCentre: Point | null;
  buildingEntries: BuildingEntry[];
  bossRooms: Array<{ bounds: Rect; centre: Point }>;
  mobSpawnPoints: Point[];
  hallwaySpawnPoints: Point[];
  stairwellTiles: Point[];
}

export function generateOverworld(size: number): OverworldData {
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
      t === ROOF_CIRCUS_RED ||
      t === ROOF_CIRCUS_BLUE ||
      t === ROOF_CIRCUS_PURPLE ||
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
      t === ROOF_CIRCUS_PURPLE
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
  fill(BORDER, cy - 2, size - BORDER * 2, 5, ROAD); // E-W
  fill(cx - 2, BORDER, 5, size - BORDER * 2, ROAD); // N-S

  // 4. Town square
  fill(cx - 11, cy - 11, 22, 22, ROAD);

  // 5. Helper: place a building and register its door
  const buildings: Array<{ x: number; y: number; w: number; h: number }> = [];
  const buildingEntries: BuildingEntry[] = [];
  const placeBuilding = (
    bx: number,
    by: number,
    bw: number,
    bh: number,
    type: 'house' | 'tower' | 'restaurant' | 'store',
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

  // 6. Town center tower (14×6, north of town square)
  placeBuilding(cx - 7, cy - 21, 14, 6, 'tower', 'Town Center Tower', ROOF_SLATE);

  // 6b. The Restaurant — safe room building, east of town square, north of E-W road.
  //     Entering triggers a BuildingInteriorScene with a safe-room interior.
  const restW = 14;
  const restH = 5;
  const restX = cx + 14;
  const restY = cy - 16; // bottom wall at cy-7, entirely above E-W road at cy-2
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
  const storeX = cx - 28;
  const storeY = cy - 16;
  placeBuilding(storeX, storeY, storeW, storeH, 'store', 'General Store', ROOF_GREEN);
  // Short road stub south from store door to the E-W road
  const storeDoorX = storeX + Math.floor(storeW / 2) - 1;
  for (let ry = storeY + storeH; ry <= cy - 2; ry++) {
    setRoad(storeDoorX, ry);
    setRoad(storeDoorX + 1, ry);
  }

  // 7. Small houses around town square
  const rng = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
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
    ROOF_THATCH,
    ROOF_RED,
    ROOF_GREEN,
    ROOF_THATCH,
  ];
  const placedHouses: Array<{ x: number; y: number; w: number; h: number }> = [];
  let houseIdx = 0;
  for (let attempt = 0; attempt < 200 && houseIdx < 10; attempt++) {
    const angle = (houseAngles[houseIdx] + rng(-15, 15)) * (Math.PI / 180);
    const dist = rng(16, 40);
    const hw = rng(5, 7);
    const hh = rng(3, 4);
    const hx = cx + Math.round(Math.cos(angle) * dist) - Math.floor(hw / 2);
    const hy = cy + Math.round(Math.sin(angle) * dist) - Math.floor(hh / 2);
    // Check bounds
    if (hx < BORDER + 2 || hx + hw > size - BORDER - 2) continue;
    if (hy < BORDER + 2 || hy + hh > size - BORDER - 2) continue;
    // Collision check with existing buildings and roads near center
    const pad = 3;
    const overlaps = [...buildings, ...placedHouses].some(
      (b) =>
        hx < b.x + b.w + pad && hx + hw + pad > b.x && hy < b.y + b.h + pad && hy + hh + pad > b.y,
    );
    if (overlaps) continue;
    placeBuilding(hx, hy, hw, hh, 'house', 'Enter', houseRoofs[houseIdx]);
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

  // 7b. Circus — cluster of tents 60+ tiles from town center
  {
    // Pick a random angle and distance for circus placement
    const circusAngle = Math.random() * Math.PI * 2;
    const circusDist = 70 + Math.random() * 20; // 60–80 tiles from center
    const circusCx = Math.round(cx + Math.cos(circusAngle) * circusDist);
    const circusCy = Math.round(cy + Math.sin(circusAngle) * circusDist);

    // Circus ground: a roughly circular dirt/road area
    const circusRadius = 14;
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
    const targetRoadY = circusDoorY < cy ? cy - 2 : cy + 4;
    const minRY = Math.min(circusDoorY, targetRoadY);
    const maxRY = Math.max(circusDoorY, targetRoadY);
    for (let ry = minRY; ry <= maxRY; ry++) {
      setRoad(circusCx - 1, ry);
      setRoad(circusCx, ry);
      setRoad(circusCx + 1, ry);
    }
    // Also connect east/west to N-S road
    const targetRoadX = circusCx < cx ? cx - 2 : cx + 4;
    const minRX = Math.min(circusCx, targetRoadX);
    const maxRX = Math.max(circusCx, targetRoadX);
    for (let rx = minRX; rx <= maxRX; rx++) {
      setRoad(rx, circusCy);
      setRoad(rx, circusCy + 1);
    }

    // Torches around the circus perimeter
    const torchAngles = [0, 60, 120, 180, 240, 300];
    for (const deg of torchAngles) {
      const a = (deg * Math.PI) / 180;
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
        if (tx < BORDER || tx >= size - BORDER || ty < BORDER || ty >= size - BORDER) continue;
        if (isSolid(tx, ty)) continue;
        if (grid[ty][tx].type === ROAD) continue; // Don't overwrite roads
        grid[ty][tx].type = TREE;
      }
    }
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

  // 10. Town decorations: fountain, torches, wells, ground scatter
  // Fountain — 3×3 block in the SE quadrant of the town square
  fill(cx + 4, cy + 4, 3, 3, FOUNTAIN);
  // Torches flanking each of the 4 main-road gates into the town square
  set(cx - 3, cy - 11, TORCH);
  set(cx + 3, cy - 11, TORCH); // North gate
  set(cx - 3, cy + 11, TORCH);
  set(cx + 3, cy + 11, TORCH); // South gate
  set(cx - 11, cy - 3, TORCH);
  set(cx - 11, cy + 3, TORCH); // West gate
  set(cx + 11, cy - 3, TORCH);
  set(cx + 11, cy + 3, TORCH); // East gate
  // Torches flanking the tower entrance (one row below the tower's south wall)
  set(cx - 2, cy - 15, TORCH);
  set(cx + 1, cy - 15, TORCH);
  // Wells — SW and NE quadrants of the town square
  set(cx - 7, cy + 7, WELL);
  set(cx + 7, cy - 7, WELL);
  // Scattered GRASSY_WEED on open grass tiles
  for (let gy = BORDER + 1; gy < size - BORDER - 1; gy++) {
    for (let gx = BORDER + 1; gx < size - BORDER - 1; gx++) {
      if (grid[gy][gx].type === GRASS && Math.random() < 0.015) set(gx, gy, GRASSY_WEED);
    }
  }
  // DIRT_PATCH on road tiles for visual variety
  for (let gy = BORDER + 1; gy < size - BORDER - 1; gy++) {
    for (let gx = BORDER + 1; gx < size - BORDER - 1; gx++) {
      if (grid[gy][gx].type === ROAD && Math.random() < 0.06) set(gx, gy, DIRT_PATCH);
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
    safeRoomBounds: null,
    safeRoomCentre: null,
    buildingEntries,
    bossRooms: [],
    mobSpawnPoints: [],
    hallwaySpawnPoints: [],
    stairwellTiles: [],
  };
}
