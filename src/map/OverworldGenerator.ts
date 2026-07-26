import type { TileContent } from './tileTypes';
import {
  COBBLE_STREET,
  DIRT_PATCH,
  FENCE,
  FOUNTAIN,
  GARDEN_PLANTING,
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
import { getBlockedTileOffsets, getBlockedTileOffsetsByKey } from '../core/SpriteLoader';
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
import {
  assertYardsStandOnTheirOwnSurface,
  paintYardFences,
  plantGardens,
  yardPlots,
} from './town/paintYards';
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

  // The art rects: what a fence must not be driven through, and what a plot's
  // own back garden is measured against. The tower is deliberately absent — its
  // spire is transparent overhang, and the ground under it should keep whatever
  // the plan painted there.
  const buildingArt: TileRect[] = [];
  /**
   * The whole plot of each building — band top to frontage — which is what ground
   * scatter is suppressed over. Wider than the art on purpose: the ground a
   * building's art does not cover is still its ground, and the redesign's plots
   * are what the yards and gardens are cut from.
   */
  const buildingPlots: TileRect[] = [];
  const namedPlots: TownPlot[] = [
    // The only plot allowed to stand on the wall: the tower *is* part of it.
    { name: plan.tower.name, rect: towerBasePlot(plan), container: 'north wall' },
  ];
  for (const planned of plan.buildings) {
    const placement = placeSpriteBuilding(grid, plan, planned);
    buildingArt.push(placement.rect);
    buildingPlots.push({
      x: placement.rect.x,
      y: plan.centre.y + planned.plotTop,
      w: placement.rect.w,
      h: planned.frontRow - planned.plotTop + 1,
    });
    namedPlots.push({ name: planned.name, rect: placement.rect, container: 'interior' });
    buildingEntries.push({
      doorTile: placement.doorTile,
      name: planned.name,
      type: planned.kind,
    });
    paintDoorApron(grid, placement);
  }
  assertTownPlotsDoNotOverlap(plan, namedPlots);
  assertNoUnusableSlivers(namedPlots);

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
  // The yards go in after every pass that writes town ground unconditionally. An
  // earlier draft ran the surface check before the wilderness and prop passes on
  // the reasoning that fences would otherwise be what it found — which made it
  // blind to the two writers that can actually reach a yard, and it missed the
  // east side-gate torch standing inside Miller's kitchen garden.
  //
  // Three passes still run after it, and each is accounted for rather than
  // assumed harmless: the fence and planting painters, which it exists to
  // protect, and `scatterGroundCover`, which is held off the yards by being
  // passed `yardPlots(plan)` rather than by running later. That last one is a
  // suppression argument, not an ordering guarantee, so it is the one to check
  // if a yard ever grows a weed.
  assertYardsStandOnTheirOwnSurface(grid, plan, buildingArt);
  paintYardFences(grid, plan, buildingArt);
  plantGardens(grid, plan, buildingArt);
  scatterGroundCover(grid, plan, BORDER, [...buildingPlots, ...yardPlots(plan)]);
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
  assertTownIsFullyReachable(grid, plan, townSquareCentre, buildingEntries);

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
  FENCE,
  GARDEN_PLANTING,
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
 * Fails generation if anything inside the walls has been sealed off from the
 * plaza.
 *
 * This is the check that caught the phase's worst defect, and it is here rather
 * than in a scratch script because of what that defect looked like: the Garrison
 * Green's corner post landed in the single-tile gap behind two cottages and
 * stranded **14 walkable tiles** — reachable in the Phase 3 town, dead in the
 * Phase 4 one, and *nothing about the finished map looked wrong*. No screenshot
 * shows it. None of the other five assertions can see it: the plan is sane, the
 * plots do not overlap, no sliver exists, every interior tile is a town surface,
 * and the escape tile is clear. Connectivity is a property of all of them
 * together, so it has to be checked over the finished grid.
 *
 * It is also reachable by an *art* change that never touches the plan, which is
 * the class of failure this phase has hit twice.
 *
 * **The sweep is confined to the wall's interior, and so is the fill**, which makes
 * this a stricter property than "reachable": getting from one part of the town to
 * another must not require leaving it and walking round the outside. It is also
 * what makes throwing safe. Everything blocking movement in here is plan-derived
 * and deterministic — the nearest a circus tent comes to the interior is 23 tiles,
 * measured over 30 generations rather than derived from `CIRCUS_MIN_DIST`, which is
 * a clearance from the town *centre* and not from the wall; the forests keep 65 and
 * skip anything paved; the ruins and rubble need bare grass of which the
 * interior has none, and both scatter passes write walkable decorations — so a
 * failure is a layout bug in the plan rather than a bad roll of the dice.
 *
 * The **Big Top is deliberately not checked**, and the reason is exactly that
 * distinction. It stands outside the walls at a random distance, and below about
 * map size 200 the circus can be placed far enough out to be clipped by the void
 * border: measured over 100 generations, **about half** of them at size 120 and half
 * at size 150 would throw `The door of 'Big Top' cannot be reached from the plaza`.
 * (Two separate 20-sample runs put 120 above and below 150 respectively, so no
 * ordering between the two sizes is claimed — only that it is a coin toss at both.)
 * The only
 * overworld size in the game is 280, where it never fires — but an assertion whose
 * trigger is a dice roll must not be one that crashes generation, and this one is
 * about the *town*.
 *
 * One size limit remains and is worth stating rather than discovering: the town is
 * 55 x 43 and `FOREST_MIN_DIST_TILES` is 65, so below roughly map size 150 the
 * forests are placed *inside* the walls and a tree can strand a tile. Measured,
 * 100/100 generations pass at 150, 200 and 280, and roughly 5 in 6 at 120 — where
 * `assertTownInteriorIsIntact` is already warning about trees in the town, so the
 * map is broken at that size with or without this check.
 *
 * The blocking set has to include the building art, which is not a tile type: a
 * building is one anchor tile, and `GameMap` reconstructs the rest from the sprite
 * manifest into `extraBlockedTiles`. Checking tile types alone would walk straight
 * through every facade in the town.
 *
 * It is rebuilt here the way `GameMap` rebuilds it — from the anchors on the
 * finished grid, by sprite key where there is one and by tile type otherwise —
 * rather than from the art rects the generator already has. Those are two
 * different sets, and the difference is exactly the doorway: the first draft of
 * this check used the art rects and immediately failed with `The door of
 * 'Blackwood Lodge' cannot be reached from the plaza`, because a doorway is inside
 * its building's art and is the one tile of it that is not blocked. A connectivity
 * check that disagrees with the collision model is worse than none — which is also
 * why the type branch is `getBlockedTileOffsets(tile.type)` and not a test for
 * `MAIN_TOWER`: `WELL` declares two blocked offsets of its own, and naming the
 * tower explicitly left the two tiles north of each plaza well walkable here and
 * blocked in the game.
 */
function assertTownIsFullyReachable(
  grid: TileGrid,
  plan: TownPlan,
  from: TilePoint,
  entries: ReadonlyArray<BuildingEntry>,
): void {
  const size = grid.size;
  const { interior } = plan;
  const inTown = (x: number, y: number) =>
    x >= interior.x &&
    y >= interior.y &&
    x < interior.x + interior.w &&
    y < interior.y + interior.h;

  const blockedByArt = new Set<number>();
  for (let y = interior.y; y < interior.y + interior.h; y++) {
    for (let x = interior.x; x < interior.x + interior.w; x++) {
      const tile = grid.cells[y][x];
      const offsets =
        tile.spriteKey !== undefined
          ? getBlockedTileOffsetsByKey(tile.spriteKey)
          : getBlockedTileOffsets(tile.type);
      for (const offset of offsets) blockedByArt.add((y + offset.dy) * size + (x + offset.dx));
    }
  }

  const walkable = (x: number, y: number) => {
    if (!inTown(x, y)) return false;
    const type = grid.typeAt(x, y);
    if (type === undefined || grid.isSolid(x, y)) return false;
    if (type === TORCH || type === WELL || type === FOUNTAIN) return false;
    return !blockedByArt.has(y * size + x);
  };

  const seen = new Set<number>([from.y * size + from.x]);
  const queue: TilePoint[] = [from];
  while (queue.length > 0) {
    const tile = queue.pop();
    if (tile === undefined) break;
    for (const [dx, dy] of CARDINAL_OFFSETS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      const key = y * size + x;
      if (seen.has(key) || !walkable(x, y)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  const reached = (x: number, y: number) => seen.has(y * size + x);

  for (let y = interior.y; y < interior.y + interior.h; y++) {
    for (let x = interior.x; x < interior.x + interior.w; x++) {
      if (!walkable(x, y) || reached(x, y)) continue;
      throw new Error(
        `Tile ${x - plan.centre.x},${y - plan.centre.y} inside the town wall is walkable but ` +
          `cannot be reached from the plaza`,
      );
    }
  }

  // A door and the tile you are returned to on leaving it. A door is not covered
  // by the sweep above — every one of them is blocked art — and a door nobody can
  // walk to is a building nobody can enter.
  for (const entry of entries) {
    const { doorTile } = entry;
    if (!inTown(doorTile.x, doorTile.y)) continue;
    if (!reached(doorTile.x, doorTile.y)) {
      throw new Error(`The door of '${entry.name}' cannot be reached from the plaza`);
    }
    if (!reached(doorTile.x, doorTile.y + 1)) {
      throw new Error(`Leaving '${entry.name}' would put the player on an unreachable tile`);
    }
  }
}

/** Four-neighbourhood, for the flood fill above. */
const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/**
 * How wide a gap between two buildings has to be before it is a place rather
 * than a sliver.
 *
 * Redesign §3.4 states the rule as a pair: neighbours a tile or less apart share
 * a party line, and neighbours three or more apart get a yard. What it does not
 * say, and what this enforces, is that **nothing may land in between**. A two-tile
 * slot between two facades is too narrow to furnish and too wide to read as a
 * shared wall; on the map it is a dead-end corridor the player can walk into and
 * a townsperson can be pathed into, and it is invisible in a screenshot because
 * it looks exactly like the lane it is not.
 *
 * Zero is admitted because that is the party line itself — two facades meeting,
 * which is what Blackwood Lodge and Shepherd's Cabin do today.
 */
const PARTY_LINE_MAX_GAP = 1;
const YARD_MIN_GAP = 3;

/**
 * Fails generation if two buildings in the same band end up a gap apart that the
 * plan has no answer for.
 *
 * Only pairs whose rows overlap are compared: two buildings in different bands
 * always have a street between them, and a gap measured between bands is the
 * width of that street rather than of anything between the two.
 *
 * Every width here comes from a sprite's manifest footprint, so this is one of
 * the failures an *art* change causes without touching a line of the plan — which
 * is exactly the kind that otherwise ships.
 */
function assertNoUnusableSlivers(plots: ReadonlyArray<TownPlot>): void {
  for (let i = 0; i < plots.length; i++) {
    for (let j = i + 1; j < plots.length; j++) {
      const a = plots[i].rect;
      const b = plots[j].rect;
      const rowsOverlap = a.y < b.y + b.h && b.y < a.y + a.h;
      if (!rowsOverlap) continue;
      const gap = a.x < b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
      if (gap <= PARTY_LINE_MAX_GAP || gap >= YARD_MIN_GAP) continue;
      throw new Error(
        `Town plots '${plots[i].name}' and '${plots[j].name}' are ${gap} tiles apart — too wide ` +
          `for a party line and too narrow for a yard`,
      );
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
    // `setStanding`, as every other prop is written: a torch that records the
    // circus's packed earth does not have to have it inferred from a neighbour.
    if (insideBorder && !grid.isSolid(torchX, torchY)) grid.setStanding(torchX, torchY, TORCH);
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
