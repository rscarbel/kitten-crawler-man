import type { TileContent } from './tileTypes';
import {
  FloorTypeValue,
  TORCH,
  TREE,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  MAIN_TOWER,
  BUILDING_WALL,
  RUINED_WALL,
  RUBBLE,
} from './tileTypes';
import { randomInt } from '../utils';
import { TileGrid } from './town/tileGrid';
import {
  createTownPlan,
  type BuildingKind,
  type TilePoint,
  type TileRect,
  type TownPlan,
} from './town/townPlan';
import { placeSpriteBuilding, towerDoorTile, towerPlot } from './town/paintPlots';
import {
  connectDoorToStreet,
  connectSiteToMainRoads,
  paintBuildingBypassRoutes,
  paintMainRoads,
  paintTownSquare,
} from './town/paintStreets';
import { paintVoidBorder, scatterGroundCover } from './town/paintGround';
import { fountainCentre, paintTownProps } from './town/townProps';

export interface BuildingEntry {
  doorTile: TilePoint;
  name: string;
  type: BuildingKind;
}

export interface OverworldData {
  grid: TileContent[][];
  startTile: TilePoint;
  safeRooms: Array<{ bounds: TileRect; centre: TilePoint }>;
  buildingEntries: BuildingEntry[];
  bossRooms: Array<{ bounds: TileRect; centre: TilePoint }>;
  mobSpawnPoints: TilePoint[];
  hallwaySpawnPoints: TilePoint[];
  stairwellTiles: TilePoint[];
  mainTowerAnchor: TilePoint;
  /** Tile where the town's escape route out appears once the Doomsday finale's escape phase begins. */
  doomsdayEscapeTile: TilePoint;
  /** Tiles from map centre inside which the town is safe — no hostile spawns, mobs deaggro. */
  townSafeRadiusTiles: number;
  /** Centre of the town square, in tile coordinates. */
  townSquareCentre: TilePoint;
  /** Centre tile of the town fountain, or undefined if the plan has no fountain. */
  fountainCentre: TilePoint | undefined;
  /** Centre of the circus, in tile coordinates. */
  circusCentre: TilePoint;
  /** Radius (tiles) of the circus grounds around `circusCentre`. */
  circusRadiusTiles: number;
}

/** Impassable void frame around the whole map. */
const BORDER = 5;

// Circus placement
const CIRCUS_MIN_DIST = 70;
const CIRCUS_DIST_VARIANCE = 20;
const CIRCUS_RADIUS = 14;

// Ruins ambient-mob spawn scatter
const RUINS_SPAWN_ATTEMPTS = 220;
const RUINS_EDGE_MARGIN = 12;
const RUINS_CIRCUS_BUFFER = 12;
// Ruined-wall shell scatter
const NUM_RUIN_SHELLS = 26;
const RUIN_SHELL_MIN_SIZE = 4;
const RUIN_SHELL_SIZE_RANGE = 5;
const RUIN_SHELL_BREAK_CHANCE = 0.4;
const RUIN_SHELL_INTERIOR_RUBBLE_CHANCE = 0.5;
const RUBBLE_DENSITY = 0.05;

// Torch angles (60° increments around a full circle)
const TORCH_STEP_DEG = 60;
const HALF_CIRCLE_DEG = 180;

// Forest blobs
const NUM_FORESTS = 30;
const FOREST_MIN_DIST_TILES = 65;
const FOREST_EDGE_MARGIN = 75;
const FOREST_MIN_RADIUS = 8;
const FOREST_MAX_RADIUS = 21;
const FOREST_EDGE_NOISE_RADIUS = 0.7;
const FOREST_EDGE_SKIP_CHANCE = 0.45;

/**
 * Generates the third-floor overworld: a town laid out from a declarative
 * `TownPlan` (see `src/map/town/`), ringed by ruins, forests and the circus.
 *
 * The town is data; everything outside it is scattered at generation time and
 * differs run to run.
 */
export function generateOverworld(size: number): OverworldData {
  const plan = createTownPlan(size);
  const grid = new TileGrid(size, FloorTypeValue.grass);
  const { x: cx, y: cy } = plan.centre;

  paintVoidBorder(grid, BORDER);
  paintMainRoads(grid, plan, BORDER);
  paintTownSquare(grid, plan);

  // Every structure on the map, town and circus alike. Bypass routing walks
  // this list once at the end, so a detour is never drawn through a building
  // that had not been placed yet.
  const structures: TileRect[] = [];
  const buildingEntries: BuildingEntry[] = [];

  /**
   * The tower writes no tiles — it renders entirely from its sprite, and wall
   * or roof tiles beneath it would show through the art's transparent areas.
   * Only its plot is reserved, so roads route around the spire.
   */
  structures.push(towerPlot(plan));
  buildingEntries.push({
    doorTile: towerDoorTile(plan),
    name: plan.tower.name,
    type: plan.tower.kind,
  });

  // Sprite buildings suppress ground scatter beneath their art; the tower plot
  // deliberately does not, matching the spire's transparent overhang.
  const spritePlots: TileRect[] = [];
  for (const planned of plan.buildings) {
    const placement = placeSpriteBuilding(grid, plan, planned);
    structures.push(placement.rect);
    spritePlots.push(placement.rect);
    buildingEntries.push({
      doorTile: placement.doorTile,
      name: planned.name,
      type: planned.kind,
    });
    connectDoorToStreet(grid, plan, placement);
  }

  const circus = paintCircus(grid, plan, structures, buildingEntries);
  paintForests(grid, plan);
  paintRuins(grid, plan, circus);
  const hallwaySpawnPoints = scatterRuinsSpawnPoints(grid, plan, circus);

  paintBuildingBypassRoutes(grid, structures, BORDER);

  // Placed after bypass routing so road stitching cannot overwrite the anchor.
  const mainTowerAnchor: TilePoint = {
    x: cx + plan.tower.anchor.dx,
    y: cy + plan.tower.anchor.dy,
  };
  grid.set(mainTowerAnchor.x, mainTowerAnchor.y, MAIN_TOWER);

  // Not added to `stairwellTiles` — that array feeds StairwellSystem/MiniMapSystem,
  // which would expose and pathing-block this tile floor-wide before the finale
  // even starts. DoomsdayEscapeSystem reads this dedicated field instead.
  grid.set(plan.doomsdayEscapeTile.x, plan.doomsdayEscapeTile.y, FloorTypeValue.road);

  paintTownProps(grid, plan);
  scatterGroundCover(grid, plan, BORDER, spritePlots);

  return {
    grid: grid.cells,
    startTile: { x: cx, y: cy },
    // The overworld's safe room is inside the barracks, handled by BuildingInteriorScene.
    safeRooms: [],
    buildingEntries,
    bossRooms: [],
    mobSpawnPoints: [],
    hallwaySpawnPoints,
    stairwellTiles: [],
    mainTowerAnchor,
    doomsdayEscapeTile: plan.doomsdayEscapeTile,
    townSafeRadiusTiles: plan.safeRadiusTiles,
    townSquareCentre: { x: cx, y: cy },
    fountainCentre: fountainCentre(plan),
    circusCentre: { x: circus.centre.x, y: circus.centre.y },
    circusRadiusTiles: circus.radius,
  };
}

interface CircusGrounds {
  readonly centre: TilePoint;
  readonly radius: number;
}

/**
 * A tile-built structure with a gable facade: north and south rows are wall,
 * the sides and interior take the roof tile, and a two-tile gap in the south
 * face is its door. Used for the circus tents, which have no sprite art.
 */
function placeTileBuilding(
  grid: TileGrid,
  rect: TileRect,
  roofTile: number,
): { readonly doorTile: TilePoint } {
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const isGableRow = dy === 0 || dy === rect.h - 1;
      grid.set(rect.x + dx, rect.y + dy, isGableRow ? BUILDING_WALL : roofTile);
    }
  }
  const doorX = rect.x + Math.floor(rect.w / 2) - 1;
  const doorY = rect.y + rect.h - 1;
  grid.set(doorX, doorY, FloorTypeValue.road);
  grid.set(doorX + 1, doorY, FloorTypeValue.road);
  return { doorTile: { x: doorX, y: doorY } };
}

/** Cluster of tents 70+ tiles from the town, well outside the safe radius. */
function paintCircus(
  grid: TileGrid,
  plan: TownPlan,
  structures: TileRect[],
  buildingEntries: BuildingEntry[],
): CircusGrounds {
  const { x: cx, y: cy } = plan.centre;
  const size = grid.size;

  const angle = Math.random() * Math.PI * 2;
  const distance = CIRCUS_MIN_DIST + Math.random() * CIRCUS_DIST_VARIANCE;
  const centre: TilePoint = {
    x: Math.round(cx + Math.cos(angle) * distance),
    y: Math.round(cy + Math.sin(angle) * distance),
  };

  // Circus ground: a roughly circular paved area.
  for (let dy = -CIRCUS_RADIUS; dy <= CIRCUS_RADIUS; dy++) {
    for (let dx = -CIRCUS_RADIUS; dx <= CIRCUS_RADIUS; dx++) {
      if (Math.hypot(dx, dy) > CIRCUS_RADIUS) continue;
      const tx = centre.x + dx;
      const ty = centre.y + dy;
      if (tx < BORDER + 1 || tx >= size - BORDER - 1) continue;
      if (ty < BORDER + 1 || ty >= size - BORDER - 1) continue;
      if (grid.isSolid(tx, ty)) continue;
      grid.set(tx, ty, FloorTypeValue.road);
    }
  }

  const BIG_TOP_WIDTH = 12;
  const BIG_TOP_HEIGHT = 5;
  /** The big top sits north of the circus centre so its forecourt stays open. */
  const BIG_TOP_NORTH_OFFSET = 2;
  const bigTop: TileRect = {
    x: centre.x - Math.floor(BIG_TOP_WIDTH / 2),
    y: centre.y - Math.floor(BIG_TOP_HEIGHT / 2) - BIG_TOP_NORTH_OFFSET,
    w: BIG_TOP_WIDTH,
    h: BIG_TOP_HEIGHT,
  };
  const bigTopPlacement = placeTileBuilding(grid, bigTop, ROOF_CIRCUS_RED);
  structures.push(bigTop);
  buildingEntries.push({ doorTile: bigTopPlacement.doorTile, name: 'Big Top', type: 'house' });

  /** Decorative tents — solid structures with no door, so they are not enterable. */
  const SMALL_TENTS = [
    { dx: -8, dy: -3, w: 6, h: 3, roof: ROOF_CIRCUS_BLUE },
    { dx: 8, dy: -3, w: 6, h: 3, roof: ROOF_CIRCUS_PURPLE },
    { dx: -7, dy: 5, w: 5, h: 3, roof: ROOF_CIRCUS_PURPLE },
    { dx: 7, dy: 5, w: 5, h: 3, roof: ROOF_CIRCUS_BLUE },
    { dx: 0, dy: 7, w: 6, h: 3, roof: ROOF_CIRCUS_RED },
  ] as const;
  /** Tents keep a one-tile gap from anything already standing. */
  const TENT_CLEARANCE = 1;
  const TENT_EDGE_MARGIN = BORDER + 2;

  for (const tent of SMALL_TENTS) {
    const tentX = centre.x + tent.dx - Math.floor(tent.w / 2);
    const tentY = centre.y + tent.dy - Math.floor(tent.h / 2);
    if (tentX < TENT_EDGE_MARGIN || tentX + tent.w > size - TENT_EDGE_MARGIN) continue;
    if (tentY < TENT_EDGE_MARGIN || tentY + tent.h > size - TENT_EDGE_MARGIN) continue;
    const overlaps = structures.some(
      (s) =>
        tentX < s.x + s.w + TENT_CLEARANCE &&
        tentX + tent.w + TENT_CLEARANCE > s.x &&
        tentY < s.y + s.h + TENT_CLEARANCE &&
        tentY + tent.h + TENT_CLEARANCE > s.y,
    );
    if (overlaps) continue;
    for (let dy = 0; dy < tent.h; dy++) {
      for (let dx = 0; dx < tent.w; dx++) {
        const isGableRow = dy === 0 || dy === tent.h - 1;
        grid.set(tentX + dx, tentY + dy, isGableRow ? BUILDING_WALL : tent.roof);
      }
    }
    structures.push({ x: tentX, y: tentY, w: tent.w, h: tent.h });
  }

  connectSiteToMainRoads(grid, plan, centre, CIRCUS_RADIUS);
  paintCircusTorches(grid, centre);

  return { centre, radius: CIRCUS_RADIUS };
}

function paintCircusTorches(grid: TileGrid, centre: TilePoint): void {
  const torchAngles = [
    0,
    TORCH_STEP_DEG,
    TORCH_STEP_DEG * 2,
    HALF_CIRCLE_DEG,
    HALF_CIRCLE_DEG + TORCH_STEP_DEG,
    HALF_CIRCLE_DEG + TORCH_STEP_DEG * 2,
  ];
  for (const degrees of torchAngles) {
    const radians = (degrees * Math.PI) / HALF_CIRCLE_DEG;
    const torchX = Math.round(centre.x + Math.cos(radians) * (CIRCUS_RADIUS - 1));
    const torchY = Math.round(centre.y + Math.sin(radians) * (CIRCUS_RADIUS - 1));
    const insideBorder =
      torchX > BORDER &&
      torchX < grid.size - BORDER &&
      torchY > BORDER &&
      torchY < grid.size - BORDER;
    if (insideBorder && !grid.isSolid(torchX, torchY)) grid.set(torchX, torchY, TORCH);
  }
}

/** Forest blobs in the wilderness, well outside town and never over a road. */
function paintForests(grid: TileGrid, plan: TownPlan): void {
  const size = grid.size;
  for (let i = 0; i < NUM_FORESTS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = FOREST_MIN_DIST_TILES + Math.random() * (size / 2 - FOREST_EDGE_MARGIN);
    const fx = Math.round(plan.centre.x + Math.cos(angle) * distance);
    const fy = Math.round(plan.centre.y + Math.sin(angle) * distance);
    const radius = randomInt(FOREST_MIN_RADIUS, FOREST_MAX_RADIUS);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        // Irregular edge — outer tiles drop out at random.
        if (d > radius * FOREST_EDGE_NOISE_RADIUS && Math.random() < FOREST_EDGE_SKIP_CHANCE)
          continue;
        const tx = fx + dx;
        const ty = fy + dy;
        if (tx < BORDER || tx >= size - BORDER || ty < BORDER || ty >= size - BORDER) continue;
        if (grid.isSolid(tx, ty)) continue;
        if (grid.isRoad(tx, ty)) continue;
        grid.set(tx, ty, TREE);
      }
    }
  }
}

/**
 * Broken wall shells and loose rubble beyond the town's safe zone, so the land
 * outside the walls reads as a destroyed city rather than open countryside.
 */
function paintRuins(grid: TileGrid, plan: TownPlan, circus: CircusGrounds): void {
  const size = grid.size;
  const { x: cx, y: cy } = plan.centre;
  const isRuinsGround = (tx: number, ty: number) =>
    tx > BORDER &&
    tx < size - BORDER &&
    ty > BORDER &&
    ty < size - BORDER &&
    grid.typeAt(tx, ty) === FloorTypeValue.grass;

  // Shells can be up to RUIN_SHELL_MIN_SIZE + RUIN_SHELL_SIZE_RANGE tiles wide, so
  // start sampling that far past the safe radius to keep their footprint fully outside it.
  const shellClearance = RUIN_SHELL_MIN_SIZE + RUIN_SHELL_SIZE_RANGE;
  for (let i = 0; i < NUM_RUIN_SHELLS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance =
      plan.safeRadiusTiles +
      shellClearance +
      Math.random() *
        (size / 2 - BORDER - RUINS_EDGE_MARGIN - plan.safeRadiusTiles - shellClearance);
    const shellCx = Math.round(cx + Math.cos(angle) * distance);
    const shellCy = Math.round(cy + Math.sin(angle) * distance);
    if (
      Math.hypot(shellCx - circus.centre.x, shellCy - circus.centre.y) <
      circus.radius + RUINS_CIRCUS_BUFFER
    )
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
        grid.set(tx, ty, RUINED_WALL);
      }
    }
    // Rubble-strewn interior
    for (let dy = 1; dy < h - 1; dy++) {
      for (let dx = 1; dx < w - 1; dx++) {
        if (Math.random() >= RUIN_SHELL_INTERIOR_RUBBLE_CHANCE) continue;
        const tx = shellX + dx;
        const ty = shellY + dy;
        if (!isRuinsGround(tx, ty)) continue;
        grid.set(tx, ty, RUBBLE);
      }
    }
  }

  // Loose rubble across the whole ruins band, outside any shell
  for (let y = BORDER + 1; y < size - BORDER - 1; y++) {
    for (let x = BORDER + 1; x < size - BORDER - 1; x++) {
      if (grid.typeAt(x, y) !== FloorTypeValue.grass) continue;
      if (Math.hypot(x - cx, y - cy) <= plan.safeRadiusTiles) continue;
      if (Math.random() < RUBBLE_DENSITY) grid.set(x, y, RUBBLE);
    }
  }
}

/**
 * Ambient ruins-mob spawn points, scattered outside the town safe zone and the
 * circus footprint — the circus questline gates its own mobs separately.
 */
function scatterRuinsSpawnPoints(
  grid: TileGrid,
  plan: TownPlan,
  circus: CircusGrounds,
): TilePoint[] {
  const size = grid.size;
  const { x: cx, y: cy } = plan.centre;
  const points: TilePoint[] = [];
  for (let i = 0; i < RUINS_SPAWN_ATTEMPTS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance =
      plan.safeRadiusTiles +
      Math.random() * (size / 2 - BORDER - RUINS_EDGE_MARGIN - plan.safeRadiusTiles);
    const tx = Math.round(cx + Math.cos(angle) * distance);
    const ty = Math.round(cy + Math.sin(angle) * distance);
    if (tx <= BORDER || tx >= size - BORDER || ty <= BORDER || ty >= size - BORDER) continue;
    if (
      Math.hypot(tx - circus.centre.x, ty - circus.centre.y) <
      circus.radius + RUINS_CIRCUS_BUFFER
    )
      continue;
    const type = grid.typeAt(tx, ty);
    if (type !== FloorTypeValue.grass && type !== FloorTypeValue.road && type !== RUBBLE) continue;
    points.push({ x: tx, y: ty });
  }
  return points;
}
