import type { TileContent } from './tileTypes';
import {
  COBBLE_STREET,
  DIRT_PATCH,
  FOUNTAIN,
  FloorTypeValue,
  LANE_STREET,
  PLAZA_STONE,
  SPRITE_BUILDING,
  TORCH,
  TREE,
  VERGE_GRASS,
  WELL,
  YARD_GRAVEL,
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
import { placeSpriteBuilding, towerBasePlot, towerDoorTile } from './town/paintPlots';
import {
  connectSiteToNearestGate,
  paintBuildingBypassRoutes,
  paintDoorApron,
  paintGateHighways,
  paintTownSurfaces,
  paintWallRing,
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

  assertTownPlanIsSane(plan);
  paintVoidBorder(grid, BORDER);
  paintTownSurfaces(grid, plan);
  // After the surfaces, so no street can be painted across the wall, and the
  // gates are then cut back through it.
  paintWallRing(grid, plan);
  paintGateHighways(grid, plan, BORDER);

  const buildingEntries: BuildingEntry[] = [];

  /**
   * The tower writes no tiles but its anchor — it renders entirely from its
   * sprite, and wall or roof tiles beneath it would show through the art's
   * transparent areas. Nothing is reserved for the spire either: it hangs over
   * the fields north of the wall, where the safe radius already keeps the ruins
   * and the forests out. `?townmap` draws the overhang from the sprite footprint
   * (`BuildingPlot.artRect`), not from anything the plan states.
   */
  buildingEntries.push({
    doorTile: towerDoorTile(plan),
    name: plan.tower.name,
    type: plan.tower.kind,
  });

  // Collected so ground scatter can be suppressed beneath each building's art.
  // The tower is deliberately absent: its spire is transparent overhang, and the
  // ground under it should keep whatever the plan painted there.
  const spritePlots: TileRect[] = [];
  const namedPlots: TownPlot[] = [
    // The only plot allowed to stand on the wall: the tower *is* part of it.
    { name: plan.tower.name, rect: towerBasePlot(plan), container: 'north wall' },
  ];
  for (const planned of plan.buildings) {
    const placement = placeSpriteBuilding(grid, plan, planned);
    spritePlots.push(placement.rect);
    namedPlots.push({ name: planned.name, rect: placement.rect, container: 'interior' });
    buildingEntries.push({
      doorTile: placement.doorTile,
      name: planned.name,
      type: planned.kind,
    });
    paintDoorApron(grid, placement);
  }
  assertTownPlotsDoNotOverlap(plan, namedPlots);

  // The circus's tents, and nothing of the town's — see `paintBuildingBypassRoutes`
  // for why the town's own blocks must be left out of bypass routing. The tent
  // placement pass reads this list back as it goes, to keep tents off each other.
  const circusStructures: TileRect[] = [];
  const tracksInTownBefore = countTracksInsideTown(grid, plan);
  const circus = paintCircus(grid, plan, circusStructures, buildingEntries);
  paintForests(grid, plan);
  paintRuins(grid, plan, circus);
  const hallwaySpawnPoints = scatterRuinsSpawnPoints(grid, plan, circus);

  paintBuildingBypassRoutes(grid, circusStructures, BORDER);

  // Placed after bypass routing so road stitching cannot overwrite the anchor.
  const mainTowerAnchor: TilePoint = {
    x: cx + plan.tower.anchor.dx,
    y: cy + plan.tower.anchor.dy,
  };
  grid.set(mainTowerAnchor.x, mainTowerAnchor.y, MAIN_TOWER);

  paintTownProps(grid, plan);
  scatterGroundCover(grid, plan, BORDER, spritePlots);
  // Both checks run over the *finished* grid, which is load-bearing rather than
  // tidy. The scatter pass is itself something that has put the wrong material
  // inside the walls, and `paintTownProps` is the only writer of the wells and the
  // fountain — an earlier draft of the escape-tile guard sat above it and every one
  // of its prop branches was therefore dead code that could never fire.
  assertTownInteriorIsIntact(grid, plan, tracksInTownBefore);
  assertDoomsdayEscapeTileIsClear(grid, plan);

  const townSquareCentre: TilePoint = {
    x: plan.plaza.x + Math.floor(plan.plaza.w / 2),
    y: plan.plaza.y + Math.floor(plan.plaza.h / 2),
  };

  return {
    grid: grid.cells,
    // The player arrives in the middle of the plaza, looking down King's Road at
    // the south gate with the tower behind them.
    startTile: townSquareCentre,
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
    townSquareCentre,
    fountainCentre: fountainCentre(plan),
    circusCentre: { x: circus.centre.x, y: circus.centre.y },
    circusRadiusTiles: circus.radius,
  };
}

/** A named building's ground, and the rectangle it has to fit inside. */
interface TownPlot {
  readonly name: string;
  readonly rect: TileRect;
  readonly container: 'interior' | 'north wall';
}

interface CircusGrounds {
  readonly centre: TilePoint;
  readonly radius: number;
}

/**
 * Fails generation on a malformed town plan, naming the offending surface.
 *
 * Every surface is stated as `span(west, north, east, south)` over inclusive edge
 * offsets, which reads well and silently produces a degenerate rectangle if the
 * two edges are given the wrong way round — a zero-width `w` paints nothing at
 * all, and a negative one is a hole in the town that the next surface may or may
 * not cover. That mistake is easy to make while re-cutting a band and impossible
 * to see afterwards, since the missing surface just shows whatever was underneath
 * it. Checking is the plan's 17 surfaces plus each gate's opening and apron.
 *
 * Surfaces are also required to stay inside the wall's interior. That is
 * containment, not coverage, and it is worth being explicit that it does **not**
 * prove "everything inside the walls is a made surface": deleting the plan's
 * `town interior` entry would pass this check and leave the whole interior as the
 * grid's bare grass fill. `assertTownInteriorIsIntact`, which runs over the
 * finished grid, is what actually holds that property.
 *
 * Gates are checked against the wall too: an opening has to lie *on* the ring or
 * it walls the street in, and an apron has to lie *outside* it or it paves gravel
 * over the town.
 */
function assertTownPlanIsSane(plan: TownPlan): void {
  const { interior } = plan;
  for (const surface of plan.surfaces) {
    const { bounds } = surface;
    if (bounds.w <= 0 || bounds.h <= 0) {
      throw new Error(
        `Town surface '${surface.name}' is ${bounds.w}x${bounds.h} — its edge offsets are` +
          ` the wrong way round`,
      );
    }
    const inside =
      bounds.x >= interior.x &&
      bounds.y >= interior.y &&
      bounds.x + bounds.w <= interior.x + interior.w &&
      bounds.y + bounds.h <= interior.y + interior.h;
    if (!inside) {
      throw new Error(
        `Town surface '${surface.name}' at ${bounds.x},${bounds.y} ${bounds.w}x${bounds.h}` +
          ` extends outside the wall ring`,
      );
    }
  }
  const onWallRing = (rect: TileRect) =>
    rect.x === plan.wall.x ||
    rect.x + rect.w === plan.wall.x + plan.wall.w ||
    rect.y === plan.wall.y ||
    rect.y + rect.h === plan.wall.y + plan.wall.h;
  // Against the wall rather than the interior: an apron is painted *after* the
  // stone, so one overlapping the ring would punch a gravel hole in the wall.
  const overlapsWall = (rect: TileRect) =>
    rect.x < plan.wall.x + plan.wall.w &&
    plan.wall.x < rect.x + rect.w &&
    rect.y < plan.wall.y + plan.wall.h &&
    plan.wall.y < rect.y + rect.h;

  for (const gate of plan.gates) {
    if (gate.bounds.w <= 0 || gate.bounds.h <= 0 || gate.apron.w <= 0 || gate.apron.h <= 0) {
      throw new Error(`Town gate '${gate.name}' has a degenerate opening or apron`);
    }
    if (!onWallRing(gate.bounds)) {
      throw new Error(`Town gate '${gate.name}' does not open through the wall ring`);
    }
    if (overlapsWall(gate.apron)) {
      throw new Error(`Town gate '${gate.name}' has its apron on or inside the wall`);
    }
  }
}

/**
 * Fails generation if the Doomsday finale's escape stairwell would appear on a
 * tile the player cannot stand on.
 *
 * The tile is not painted — the plan puts it on the civic terrace, which is
 * already flagstone, and forcing it to the packed-earth road type (as this did
 * while the tile sat on a road slab) would leave one dirt tile in the middle of
 * the terrace. All it has to be is walkable, and it is not added to
 * `stairwellTiles`: that array feeds StairwellSystem and MiniMapSystem, which
 * would expose and pathing-block the tile floor-wide before the finale starts.
 * `DoomsdayEscapeSystem` reads the dedicated `doomsdayEscapeTile` field instead.
 *
 * `isSolid` alone is not enough. A torch, a well and a fountain are none of them a
 * solid *tile type* as far as `TileGrid` is concerned, yet all three block the
 * player, and the tower's anchor is walkable while its art covers the tile — so
 * this has to run after `paintTownProps`, which is the only pass that writes them.
 * The tower's base is tested as a rectangle for the same reason: only its anchor
 * carries the `MAIN_TOWER` type, while the two rows above it block through
 * `GameMap.extraBlockedTiles`. What this still cannot see is a *sprite* building's
 * base beyond its anchor, which blocks the same way from a set that does not exist
 * yet at generation time.
 */
function assertDoomsdayEscapeTileIsClear(grid: TileGrid, plan: TownPlan): void {
  const { x, y } = plan.doomsdayEscapeTile;
  const type = grid.typeAt(x, y);
  const towerBase = towerBasePlot(plan);
  const underTower =
    x >= towerBase.x &&
    x < towerBase.x + towerBase.w &&
    y >= towerBase.y &&
    y < towerBase.y + towerBase.h;
  const blocked =
    type === undefined ||
    grid.isSolid(x, y) ||
    type === TORCH ||
    type === WELL ||
    type === FOUNTAIN ||
    type === MAIN_TOWER ||
    underTower;
  if (blocked) {
    throw new Error(
      `Doomsday escape tile at ${x},${y} is blocked (tile type ${type}` +
        `${underTower ? ', under the tower base' : ''})`,
    );
  }
}

/**
 * Every tile type the finished town may contain, inside the wall ring: its six
 * surfaces, the worn patches scattered over the tracks, and the things that stand
 * on them.
 *
 * Field grass and `GRASSY_WEED` are deliberately absent, which is what makes the
 * redesign's third principle — bare grass exists only outside the walls — a
 * checked property rather than a claim. So are `TREE`, `RUBBLE` and `RUINED_WALL`:
 * the wilderness passes are supposed to keep clear of the safe radius, and the
 * only evidence that they do is that nothing of theirs is ever found in here.
 */
const TOWN_INTERIOR_TILE_TYPES: ReadonlySet<number> = new Set<number>([
  VERGE_GRASS,
  YARD_GRAVEL,
  LANE_STREET,
  COBBLE_STREET,
  PLAZA_STONE,
  FloorTypeValue.road,
  DIRT_PATCH,
  SPRITE_BUILDING,
  MAIN_TOWER,
  TORCH,
  WELL,
  FOUNTAIN,
]);

/** How many packed-earth track tiles stand inside the wall, worn patches included. */
function countTracksInsideTown(grid: TileGrid, plan: TownPlan): number {
  let count = 0;
  for (let y = plan.interior.y; y < plan.interior.y + plan.interior.h; y++) {
    for (let x = plan.interior.x; x < plan.interior.x + plan.interior.w; x++) {
      const type = grid.typeAt(x, y);
      if (type === FloorTypeValue.road || type === DIRT_PATCH) count++;
    }
  }
  return count;
}

/**
 * Standing check that nothing has written over the town.
 *
 * Two faults, one sweep. An **unexpected type** inside the walls means either that
 * the plan left a tile uncovered — the grid's bare grass showing through — or that
 * a wilderness pass reached inside the safe radius. A **changed track count** means
 * something paved packed earth in here, which is an allowed type in the alleys and
 * nowhere else.
 *
 * This exists because it happened twice. `connectSiteToNearestGate` turned along
 * the circus's own column first and paved a three-tile dirt road from the circus
 * down through the Civic Terrace, the plaza and Market Street's cobble on 10% of
 * seeds, severed at the wall so the circus finished with no road at all; and the
 * scatter pass painted field-grass weeds onto the verge. Neither shows up in the
 * finished map unless you generate the right seed and look in the right place.
 *
 * Warns rather than throws: what reaches inside is a function of the circus's
 * random position, so throwing would fail generation in a player's game, and a
 * stray tile is ugly rather than unplayable.
 */
function assertTownInteriorIsIntact(grid: TileGrid, plan: TownPlan, expectedTracks: number): void {
  let unexpected = 0;
  let firstUnexpected = '';
  for (let y = plan.interior.y; y < plan.interior.y + plan.interior.h; y++) {
    for (let x = plan.interior.x; x < plan.interior.x + plan.interior.w; x++) {
      const type = grid.typeAt(x, y);
      if (type === undefined || TOWN_INTERIOR_TILE_TYPES.has(type)) continue;
      if (unexpected === 0) firstUnexpected = `type ${type} at ${x},${y}`;
      unexpected++;
    }
  }
  if (unexpected > 0) {
    console.warn(
      `[overworld] ${unexpected} tiles inside the town wall are not a town surface — ` +
        `first ${firstUnexpected}`,
    );
  }
  const tracks = countTracksInsideTown(grid, plan);
  if (tracks !== expectedTracks) {
    // Stated as a change, not as an addition: the baseline is taken before the prop
    // pass, so a prop landing on an alley would move this the other way.
    console.warn(
      `[overworld] track tiles inside the town wall changed from ${expectedTracks} to ` +
        `${tracks} after the town was laid out — a later pass is writing over the street plan`,
    );
  }
}

/**
 * Fails generation if two town buildings' plots overlap, or if one has been pushed
 * outside the wall.
 *
 * "Plots" is the sprite buildings' art rects plus the tower's **base**, not its
 * spire: the spire deliberately hangs over the fields north of the wall, so
 * including it would make the tower fail the inside-the-wall test every time. Its
 * base is what stands on the town's ground and is what can collide with a
 * neighbour if either sprite is re-scaled. Sixteen rectangles, one pass.
 *
 * Each plot says where it is allowed to stand, and the wording of that has been
 * wrong twice, in the same way both times: a bound that reads as tighter than it is.
 * First the test was "inside the interior **or** inside the wall ring", which
 * disabled the check for all sixteen plots — the interior is the ring inset by one
 * and therefore implies it, so a sprite building whose art landed on the stone
 * passed. Then `'wall ring'` was implemented as "inside `plan.wall`", which is the
 * wall's whole *bounding rectangle* and contains the interior, so the tower was not
 * constrained to the ring at all and could have sat in the middle of the plaza.
 *
 * A ring plot now has to be inside the wall rectangle **and** have its own north
 * edge on the wall's north line. "Touches any of the four lines" was the first
 * attempt and is the same mistake a third time in miniature: it admits a tower with
 * one column on the west wall and its base sitting in the Cross Lane, which passes a
 * check whose whole purpose is to say the tower is part of the *north* wall.
 *
 * The plan packs buildings shoulder to shoulder against the lanes, and every
 * width comes from a sprite's manifest footprint rather than from a number
 * written next to the anchor. That is the right way round — re-scaling a
 * building re-spaces its own plot — but it also means an art change can silently
 * push a neighbour under a facade or a lane under a roof. Overlapping art is not
 * visible from a screenshot of the finished map: the later sprite simply draws
 * over the earlier one, and what you notice weeks later is a door that opens into
 * a wall. Checking is one pass over sixteen rectangles.
 */
function assertTownPlotsDoNotOverlap(plan: TownPlan, plots: ReadonlyArray<TownPlot>): void {
  const contains = (outer: TileRect, inner: TileRect) =>
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h;
  const standsOnNorthWall = (rect: TileRect) => contains(plan.wall, rect) && rect.y === plan.wall.y;
  const isWhereItBelongs = (rect: TileRect, container: TownPlot['container']) =>
    container === 'north wall' ? standsOnNorthWall(rect) : contains(plan.interior, rect);

  for (let i = 0; i < plots.length; i++) {
    const { name, rect, container } = plots[i];
    if (!isWhereItBelongs(rect, container)) {
      throw new Error(
        `Town plot '${name}' at ${rect.x},${rect.y} ${rect.w}x${rect.h} does not stand on the ` +
          `town's ${container}`,
      );
    }
    for (let j = i + 1; j < plots.length; j++) {
      const other = plots[j].rect;
      const overlaps =
        rect.x < other.x + other.w &&
        other.x < rect.x + rect.w &&
        rect.y < other.y + other.h &&
        other.y < rect.y + rect.h;
      if (overlaps) {
        throw new Error(
          `Town plots '${name}' and '${plots[j].name}' overlap at ${other.x},${other.y}`,
        );
      }
    }
  }
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
  circusStructures: TileRect[],
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
  circusStructures.push(bigTop);
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
    const overlaps = circusStructures.some(
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
    circusStructures.push({ x: tentX, y: tentY, w: tent.w, h: tent.h });
  }

  connectSiteToNearestGate(grid, plan, centre, plan.wall);
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
        if (grid.isPaved(tx, ty)) continue;
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
