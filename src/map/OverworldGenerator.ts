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
  HIGHLAND_GRASS,
  SCREE,
  BOULDER_SMALL,
  BOULDER_LARGE,
} from './tileTypes';
import { randomInt } from '../utils';
import { TileGrid } from './town/tileGrid';
import {
  createTownPlan,
  type BuildingKind,
  type ShopSignEmblem,
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
import {
  paintVoidBorder,
  scatterGroundCover,
  scatterWildernessGroundCover,
} from './town/paintGround';
import {
  assertYardsStandOnTheirOwnSurface,
  paintYardFences,
  plantGardens,
  yardPlots,
} from './town/paintYards';
import { fountainCentre, paintTownProps } from './town/townProps';
import { ElevationField, type ElevationBand } from './overworld/elevation';
import {
  bridgeMaroonedRegions,
  carveRivers,
  paintRiverCrossings,
  scatterRiverRocks,
  type RiverCourse,
} from './overworld/rivers';
import { Reachability } from './overworld/reachability';
import { hasWaterWithin, paintCamps, type CampSite } from './overworld/camps';
import { openCliffRamps, paintCliffs } from './overworld/cliffs';

export interface BuildingEntry {
  doorTile: TilePoint;
  name: string;
  type: BuildingKind;
  /**
   * Device on the shop sign hanging over this door, when the building has one.
   *
   * Optional because two entries are not shop fronts: the main tower, and the
   * circus's Big Top out beyond the walls. Carried on the entry rather than
   * re-derived by name in the renderer, so the sign is stated once — in the plan
   * — and a building added without one is a compile error there rather than a
   * silently missing sign here.
   */
  sign?: ShopSignEmblem;
  /**
   * Width of the opening in the facade, in tiles.
   *
   * Doorways are **not** all one tile: measured across the thirteen sprites the
   * town uses, six are one tile, five are two, the General Store is three and
   * The Horned Flagon is four. Anything hung beside a door has to know, because
   * `computeDoorway` reports the *centre* of the opening — so for a four-tile
   * front, the tile immediately west of `doorTile` is still doorway.
   *
   * Optional alongside `sign`, and for the same two entries: the tower's door is
   * stated by the plan rather than derived from a manifest, and the Big Top's is
   * a two-tile gap cut into a tile-built tent.
   */
  doorwayWidth?: number;
}

export interface OverworldData {
  grid: TileContent[][];
  /**
   * The plan the town was generated from.
   *
   * Handed back rather than kept private because the town's *systems* need its
   * geometry too — which streets are streets, where the yards and gates are —
   * and every one that has re-derived a coordinate instead has eventually
   * drifted from it: the murder quest anchored a body four tiles west of a door
   * that later stood against the west wall, and the notice board sat due south
   * of centre on a rationale about a tower that had moved. The plan is pure data
   * and already the single source of truth for the layout; a second copy of a
   * coordinate is a second thing to keep in step.
   */
  townPlan: TownPlan;
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
  /** Wilderness clearings where bounty encounters are staged. */
  bountySites: TilePoint[];
  /**
   * The courses the map's rivers were carved along.
   *
   * Carried out of the generator rather than left behind because a course is the
   * only compact description of a river the grid does not already hold — the
   * water tiles themselves are on the grid, but the ordered line through them is
   * what a future pass (a ferry, a fishing spot, a quest that says "follow the
   * river north") would need.
   */
  rivers: RiverCourse[];
  /**
   * The wilderness's enemy camps.
   *
   * Carried out of the generator the way the circus's centre and radius are, and
   * for the same reason: a system that needs to know where a landmark is should
   * read it from the map rather than re-derive it. `spawnForLevel` populates the
   * camps from this, and it is the seam a future quest would use to find one.
   */
  camps: CampSite[];
}

/** Impassable void frame around the whole map. */
const BORDER = 5;

// Circus placement
const CIRCUS_MIN_DIST = 70;
const CIRCUS_DIST_VARIANCE = 20;
const CIRCUS_RADIUS = 14;
/** Tiles of dry ground kept between the fairground's edge and any river. */
const CIRCUS_WATER_CLEARANCE = 8;
const CIRCUS_SITE_ATTEMPTS = 30;

// Ruins ambient-mob spawn scatter
const RUINS_SPAWN_ATTEMPTS = 220;
const RUINS_EDGE_MARGIN = 12;
const RUINS_CIRCUS_BUFFER = 12;
/** Tiles of clear ground kept between a camp and the nearest ambient spawn. */
const RUINS_CAMP_BUFFER = 8;

// Bounty encounter sites — the clearings Shady's marks are found in.
/** How many sites the scatter aims for; the wilderness is big enough for this many well-spread ones. */
const BOUNTY_SITE_TARGET = 8;
/** Sampling attempts spent looking for them. Generous: most candidates fail the open-ground test. */
const BOUNTY_SITE_ATTEMPTS = 600;
/** Extra tiles past the town safe radius before a site may sit — a bounty is out in the wilds. */
const BOUNTY_TOWN_BUFFER = 12;
const BOUNTY_CIRCUS_BUFFER = 16;
const BOUNTY_CAMP_BUFFER = 14;
/** Tiles kept between the outermost site and the map edge. */
const BOUNTY_EDGE_MARGIN = 16;
/** Radius of the clearing a site needs: a boss with a 3-second flurry has to fit. */
const BOUNTY_CLEARANCE_RADIUS_TILES = 6;
/** Fraction of that disc that must be open walkable ground for the site to be usable. */
const BOUNTY_CLEARANCE_MIN_OPEN_FRACTION = 0.8;
/** Minimum spacing between two sites, so "scattered all over the map" is literal. */
const BOUNTY_SITE_MIN_SPACING_TILES = 30;
/** Below this many surviving sites the map is degenerate but still playable — warn, don't throw. */
const BOUNTY_SITE_MIN_ACCEPTABLE = 3;
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

/**
 * Largest seed the elevation field is given. Generation is otherwise unseeded
 * `Math.random()`, so this is drawn per map like everything else — the seed
 * exists so the *field* is reproducible from it, not so the map is.
 */
const ELEVATION_SEED_RANGE = 0x7fffffff;

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

  // The wilderness's shared elevation field, and the band materials derived from
  // it. It runs here — after the town and its highways, before every wilderness
  // pass — for two reasons: the bands must never be painted over town ground,
  // and the circus, the forests, the ruins and the rivers all want to consult
  // the field they are being laid out on.
  const elevation = new ElevationField(randomInt(0, ELEVATION_SEED_RANGE), size, {
    centreTileX: plan.centre.x,
    centreTileY: plan.centre.y,
    safeRadiusTiles: plan.safeRadiusTiles,
  });
  paintElevationBands(grid, elevation);
  // Before the circus, the forests and the ruins, so every one of them sees the
  // channel as solid ground it has to keep off. The bridges are laid much later
  // — see `paintRiverCrossings`.
  const rivers = carveRivers(grid, plan, elevation, BORDER);

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
   * building's art does not cover is still its ground, and the plots are what the
   * yards and gardens are cut from.
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
      sign: planned.sign,
      doorwayWidth: placement.doorwayWidth,
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
  // After the forests and the ruins so a camp can clear its own ground — a camp
  // is a place people have cleared — and before the spawn scatter, which
  // excludes the camps so ambient ghouls do not loiter in somebody else's.
  const camps = paintCamps(
    grid,
    plan,
    elevation,
    { centreX: circus.centre.x, centreY: circus.centre.y, radiusTiles: circus.radius },
    BORDER,
  );
  const hallwaySpawnPoints = scatterRuinsSpawnPoints(grid, plan, circus, camps);

  paintBuildingBypassRoutes(grid, circusStructures, BORDER);
  // After every road pass, and only after: `TileGrid.setPaved` refuses to write
  // over water, so a road laid since the carve stops dead at the bank, and only
  // a pass that runs last can see all of them at once.
  paintRiverCrossings(grid, rivers, BORDER);

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
  scatterWildernessGroundCover(grid, plan, BORDER);
  // After the ground cover, so a boulder is never scattered onto a wildflower
  // clump and never has one scattered onto it.
  scatterBoulders(grid, plan, elevation, buildingEntries);
  // Last of the natural passes: a cliff defers to everything — roads, water,
  // camps, forests, the town — so it runs once all of them are on the grid.
  paintCliffs(grid, plan, elevation, camps, BORDER);
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
  // Last of all, because a bank can be walled off by a forest or a ruin as
  // easily as by the water itself, and only the finished grid shows that.
  bridgeMaroonedRegions(grid, townSquareCentre, BORDER);
  openCliffRamps(grid, townSquareCentre, BORDER);
  // After every deck is down: a rock is not water, so one placed earlier would
  // stop a crossing's span dead in the middle of the channel.
  scatterRiverRocks(grid, rivers, BORDER);
  // Sampled here rather than beside the ambient scatter: a site's whole job is
  // to be somewhere a fight fits, and the cliffs, boulders and river rocks that
  // decide that are only all on the grid once the natural passes have finished.
  const bountySiteCandidates = scatterBountySites(grid, plan, circus, camps);
  const { spawnPoints: reachableSpawnPoints, bountySites } = assertWildernessIsReachable(
    grid,
    townSquareCentre,
    hallwaySpawnPoints,
    bountySiteCandidates,
    buildingEntries,
    circus.centre,
  );

  return {
    grid: grid.cells,
    townPlan: plan,
    // The player arrives in the middle of the plaza, looking down King's Road at
    // the south gate with the tower behind them.
    startTile: townSquareCentre,
    // The overworld's safe room is inside the barracks, handled by BuildingInteriorScene.
    safeRooms: [],
    buildingEntries,
    bossRooms: [],
    mobSpawnPoints: [],
    hallwaySpawnPoints: reachableSpawnPoints,
    stairwellTiles: [],
    mainTowerAnchor,
    doomsdayEscapeTile: plan.doomsdayEscapeTile,
    townSafeRadiusTiles: plan.safeRadiusTiles,
    townSquareCentre,
    fountainCentre: fountainCentre(plan),
    circusCentre: { x: circus.centre.x, y: circus.centre.y },
    circusRadiusTiles: circus.radius,
    bountySites,
    rivers,
    camps,
  };
}

/**
 * Largest piece of the map that may be cut off from the plaza before it is worth
 * saying so on the console.
 *
 * §5.7 of the plan asked for this as a *fraction* of walkable tiles, at 0.97.
 * Measurement says a fraction cannot express it: a generated map has always left
 * 400–650 tiny pockets unreachable — the holes a forest blob's ragged edge
 * leaves, the inside of a sealed ruin shell — and they add up to **2.0–2.5% of
 * the map before this plan touched anything**. A 97% floor therefore sits inside
 * the pre-existing noise, and an unlucky map fails the gate having nothing at
 * all wrong with it (measured: one at 96.8%, with no marooned region larger than
 * 75 tiles).
 *
 * Region size separates the two, but only together with **where the region's
 * border is**. Only regions with water on their border are counted: a river can
 * cut one off and `bridgeMaroonedRegions` can put it back, whereas a forest blob
 * closing around a hole leaves a pocket no bridge can ever reach. Counting those
 * too made the generator throw on about one map in a hundred, blaming a river
 * for a hole in a wood — one measured at 153 tiles with all 156 of its border
 * tiles a `TREE` and none of them water.
 *
 * The threshold itself sits well clear of both: after the repair the largest
 * surviving water-bordered region measured under 80 tiles, while a river that
 * genuinely severs the map leaves one of 376–31,910.
 */
const MAX_MAROONED_REGION_TILES = 400;

const PERCENT_SCALE = 100;
const PERCENT_DECIMALS = 1;

function asPercent(fraction: number): string {
  return (fraction * PERCENT_SCALE).toFixed(PERCENT_DECIMALS);
}

/**
 * Checks the whole map is still one connected place, and returns the ambient
 * spawn points a player can actually get to.
 *
 * `assertTownIsFullyReachable` only ever looked inside the wall, which was the
 * right scope while nothing outside it could sever anything. A river can.
 *
 * The three parts of this are deliberately different in kind:
 *
 * - The **doors and the circus throw**, like every other validator here. Those
 *   are what make a map playable at all, and neither has ever failed.
 * - A large **marooned region warns**. It used to throw, and that was wrong in
 *   both directions at once. Blaming this plan for any region with a water tile
 *   on its rim rejected about one map in 250 for holes in woods that predate it;
 *   attributing properly by border share fixed that but still left 2 maps in
 *   2,500 with a *genuine* severing — one of 4,914 tiles, 88% of the map still
 *   reachable — that neither repair pass can open, because a composite border of
 *   forest, boulders, cliff and water offers no single tile to bridge or ramp.
 *   Refusing to load the floor one time in 1,250 is a far worse outcome than a
 *   corner of the wilderness the player cannot walk to, especially when the
 *   doors, the circus and every spawn point are separately guaranteed. So it
 *   says so loudly and carries on.
 * - An unreachable **spawn point is pruned, not thrown on**. A generated map has
 *   always sealed a handful of them inside a forest pocket or a ruin shell —
 *   measured at two to eleven per map, and true before this plan touched
 *   anything — so throwing would reject maps for a defect the rivers did not
 *   cause. Dropping them changes nothing a player can observe except that a
 *   ghoul neither of you could ever have reached is no longer spawned.
 */
function assertWildernessIsReachable(
  grid: TileGrid,
  from: TilePoint,
  spawnPoints: ReadonlyArray<TilePoint>,
  bountySites: ReadonlyArray<TilePoint>,
  entries: ReadonlyArray<BuildingEntry>,
  circusCentre: TilePoint,
): { spawnPoints: TilePoint[]; bountySites: TilePoint[] } {
  const reachability = new Reachability(grid, from);

  for (const entry of entries) {
    if (reachability.reached(entry.doorTile.x, entry.doorTile.y)) continue;
    throw new Error(`The door of '${entry.name}' is cut off from the town square`);
  }
  if (!reachability.reached(circusCentre.x, circusCentre.y)) {
    throw new Error('The circus is cut off from the town square');
  }
  const { counts, touchesWater, touchesCliff } = reachability.marooned();
  let largestLabel = -1;
  let largestSevered = 0;
  for (let label = 0; label < counts.length; label++) {
    if (counts[label] <= largestSevered) continue;
    largestSevered = counts[label];
    largestLabel = label;
  }
  if (largestLabel >= 0 && largestSevered > MAX_MAROONED_REGION_TILES) {
    const borders: string[] = [];
    if (touchesWater[largestLabel]) borders.push('water');
    if (touchesCliff[largestLabel]) borders.push('cliff');
    // Reports what borders the region rather than naming a culprit. Two earlier
    // versions asserted a cause they could not establish — see
    // `MAX_MAROONED_REGION_TILES`.
    const bordering = borders.length === 0 ? 'no water or cliff' : borders.join(' and ');
    console.warn(
      `A ${largestSevered}-tile region of the map cannot be reached from the town square ` +
        `(${asPercent(reachability.reachedFraction)}% of walkable tiles reachable overall). ` +
        `Its border includes ${bordering}. The repair passes could not open it.`,
    );
  }

  const reachableSites = bountySites.filter((site) => reachability.reached(site.x, site.y));
  if (reachableSites.length < BOUNTY_SITE_MIN_ACCEPTABLE) {
    console.warn(
      `Only ${reachableSites.length} reachable bounty site(s) survived generation ` +
        `(wanted ${BOUNTY_SITE_TARGET}). Bounties will repeat locations.`,
    );
  }

  return {
    spawnPoints: spawnPoints.filter((point) => reachability.reached(point.x, point.y)),
    bountySites: reachableSites,
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
 * Field grass and `GRASSY_WEED` are deliberately absent, which is what makes
 * "bare grass exists only outside the walls" a checked property rather than a
 * claim. So are `TREE`, `RUBBLE` and `RUINED_WALL`:
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
 * This is the check that caught the worst defect the town has had, and it is here
 * rather than in a scratch script because of what that defect looked like: the
 * Garrison Green's corner post landed in the single-tile gap behind two cottages
 * and stranded **14 walkable tiles**, and *nothing about the finished map looked
 * wrong*. No screenshot
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
 * The plot rule is a pair: neighbours a tile or less apart share a party line,
 * and neighbours three or more apart get a yard. What the pair leaves unsaid, and
 * what this enforces, is that **nothing may land in between**. A two-tile
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

/**
 * Where the circus pitches: 70+ tiles from the town, and clear of the rivers.
 *
 * The water check is what keeps the two apart, rather than the river router
 * steering around the circus — the circus is sited *after* the carve, so there
 * is nothing for the router to avoid when it runs. Doing it from this side is
 * also the cheaper half of the problem: re-rolling a circus is one random draw,
 * whereas re-routing a river is a whole walk across the map.
 *
 * Falls back to the last candidate rather than looping: a fairground with a
 * stream through one corner is a much smaller defect than a map that never
 * finishes generating.
 */
function pickCircusCentre(grid: TileGrid, townX: number, townY: number): TilePoint {
  let candidate: TilePoint = { x: townX, y: townY };
  for (let attempt = 0; attempt < CIRCUS_SITE_ATTEMPTS; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = CIRCUS_MIN_DIST + Math.random() * CIRCUS_DIST_VARIANCE;
    candidate = {
      x: Math.round(townX + Math.cos(angle) * distance),
      y: Math.round(townY + Math.sin(angle) * distance),
    };
    if (!hasWaterWithin(grid, candidate, CIRCUS_RADIUS + CIRCUS_WATER_CLEARANCE)) return candidate;
  }
  return candidate;
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

  const centre = pickCircusCentre(grid, cx, cy);

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

/**
 * Per-tile chance of a boulder, by the band it stands in.
 *
 * The gradient across the bands is the point: a rock in an open meadow is a
 * landmark, a slope of them on a ridge is the ground itself. Boulders on scree
 * are common enough to read as the hillside shedding them and no commoner, since
 * every one of them is a tile the player cannot walk through.
 */
const BOULDER_DENSITY_BY_BAND: Readonly<Record<ElevationBand, number>> = {
  lowland: 0.0015,
  meadow: 0.0022,
  highland: 0.012,
  ridge: 0.03,
};

/** Share of boulders that are the two-tile kind, by band. */
const LARGE_BOULDER_SHARE_BY_BAND: Readonly<Record<ElevationBand, number>> = {
  lowland: 0.3,
  meadow: 0.3,
  highland: 0.22,
  ridge: 0.16,
};

/** Tiles of clear ground kept between a boulder and any building's door. */
const BOULDER_DOOR_CLEARANCE_TILES = 4;

/**
 * Scatters boulders across the wilderness, weighted by elevation.
 *
 * Runs late, after every pass that lays ground or structures, because a boulder
 * is only allowed on open wilderness surface: no roads, no water, no forest, no
 * ruin, no camp, nothing inside the town's safe radius. Written with
 * `setStanding` so each rock records the band it sits on and the fringe under it
 * is drawn from the right material.
 */
function scatterBoulders(
  grid: TileGrid,
  plan: TownPlan,
  elevation: ElevationField,
  entries: ReadonlyArray<BuildingEntry>,
): void {
  const nearADoor = (tx: number, ty: number): boolean =>
    entries.some(
      (entry) =>
        Math.hypot(entry.doorTile.x - tx, entry.doorTile.y - ty) <= BOULDER_DOOR_CLEARANCE_TILES,
    );

  for (let ty = BORDER + 1; ty < grid.size - BORDER - 1; ty++) {
    for (let tx = BORDER + 1; tx < grid.size - BORDER - 1; tx++) {
      if (!isOpenWildernessGround(grid.typeAt(tx, ty))) continue;
      if (Math.hypot(tx - plan.centre.x, ty - plan.centre.y) <= plan.safeRadiusTiles) continue;
      const band = elevation.bandAt(tx, ty);
      if (Math.random() >= BOULDER_DENSITY_BY_BAND[band]) continue;
      if (nearADoor(tx, ty)) continue;
      const isLarge = Math.random() < LARGE_BOULDER_SHARE_BY_BAND[band];
      grid.setStanding(tx, ty, isLarge ? BOULDER_LARGE : BOULDER_SMALL);
    }
  }
}

/**
 * Paints the upland bands: `HIGHLAND_GRASS` where the field climbs past the
 * meadow, `SCREE` where it reaches the ridges.
 *
 * Only virgin grass is repainted, so the town's surfaces, its wall and every
 * highway already on the grid are left exactly as they were — the field is
 * flattened over the town as well, so this is belt and braces rather than the
 * only defence.
 *
 * `set` rather than `setStanding` is right here: these tiles *are* ground, not
 * something standing on it, and there is no earlier surface worth recording —
 * they only ever replace the grass the grid was filled with.
 */
function paintElevationBands(grid: TileGrid, elevation: ElevationField): void {
  for (let ty = BORDER; ty < grid.size - BORDER; ty++) {
    for (let tx = BORDER; tx < grid.size - BORDER; tx++) {
      if (grid.typeAt(tx, ty) !== FloorTypeValue.grass) continue;
      const band = elevation.bandAt(tx, ty);
      if (band === 'highland') grid.set(tx, ty, HIGHLAND_GRASS);
      else if (band === 'ridge') grid.set(tx, ty, SCREE);
    }
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
        // Nothing takes root on bare ridge rock. Highland turf is left open to
        // forest on purpose — a wood climbing a hillside is what makes the band
        // read as a slope rather than as a stripe.
        if (grid.typeAt(tx, ty) === SCREE) continue;
        // `setStanding`, as every other prop is written. A tree stands *on* the
        // ground rather than being ground, and now that one can be felled the
        // record is what the tile reverts to. Inference cannot answer this:
        // `inferFloorType` searches three tiles and then gives up and returns
        // dungeon concrete, while a forest blob runs to twenty-one tiles across
        // — so felling a tree anywhere but at the fringe would open a hole of
        // grey concrete in the middle of a wood.
        grid.setStanding(tx, ty, TREE);
      }
    }
  }
}

/**
 * The three open, walkable surfaces the wilderness is made of.
 *
 * The ruins and the ambient spawn scatter both used to test `=== grass`, which
 * was the same question while grass was the only thing out there. Once the
 * elevation bands repaint a third of the map, that test silently confined every
 * ruin and every ghoul to the lowlands — the scatter's ~220 points would have
 * collapsed with it, since a rejected attempt is not retried.
 */
function isOpenWildernessGround(type: number | undefined): boolean {
  return type === FloorTypeValue.grass || type === HIGHLAND_GRASS || type === SCREE;
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
    isOpenWildernessGround(grid.typeAt(tx, ty));

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
        grid.setStanding(tx, ty, RUINED_WALL);
      }
    }
    // Rubble-strewn interior
    for (let dy = 1; dy < h - 1; dy++) {
      for (let dx = 1; dx < w - 1; dx++) {
        if (Math.random() >= RUIN_SHELL_INTERIOR_RUBBLE_CHANCE) continue;
        const tx = shellX + dx;
        const ty = shellY + dy;
        if (!isRuinsGround(tx, ty)) continue;
        grid.setStanding(tx, ty, RUBBLE);
      }
    }
  }

  // Loose rubble across the whole ruins band, outside any shell
  for (let y = BORDER + 1; y < size - BORDER - 1; y++) {
    for (let x = BORDER + 1; x < size - BORDER - 1; x++) {
      if (!isOpenWildernessGround(grid.typeAt(x, y))) continue;
      if (Math.hypot(x - cx, y - cy) <= plan.safeRadiusTiles) continue;
      if (Math.random() < RUBBLE_DENSITY) grid.setStanding(x, y, RUBBLE);
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
  camps: ReadonlyArray<CampSite>,
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
    // Camps keep the ambient population out, so the mobs standing in one are the
    // camp's own. Without this a ghoul spawns among the goblins and the landmark
    // stops reading as anybody's.
    if (
      camps.some(
        (camp) =>
          Math.hypot(tx - camp.centre.x, ty - camp.centre.y) < camp.radiusTiles + RUINS_CAMP_BUFFER,
      )
    )
      continue;
    const type = grid.typeAt(tx, ty);
    if (!isOpenWildernessGround(type) && type !== FloorTypeValue.road && type !== RUBBLE) continue;
    points.push({ x: tx, y: ty });
  }
  return points;
}

/** Ground a bounty encounter can be fought on: open wilderness, road or rubble. */
function isBountyFightableGround(type: number | undefined): boolean {
  return isOpenWildernessGround(type) || type === FloorTypeValue.road || type === RUBBLE;
}

/**
 * Fraction of the tiles within `BOUNTY_CLEARANCE_RADIUS_TILES` of (tx, ty) that
 * a boss fight could actually be fought across. Trees, water, cliffs and ruined
 * walls all count against it — an encounter dropped into a forest pocket is one
 * the player cannot circle-strafe, which is the whole counterplay to a flurry.
 */
function openGroundFraction(grid: TileGrid, tx: number, ty: number): number {
  const radius = BOUNTY_CLEARANCE_RADIUS_TILES;
  const radiusSq = radius * radius;
  let inDisc = 0;
  let open = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radiusSq) continue;
      inDisc++;
      if (isBountyFightableGround(grid.typeAt(tx + dx, ty + dy))) open++;
    }
  }
  return inDisc === 0 ? 0 : open / inDisc;
}

/**
 * Clearings out in the wilds where Shady's bounty encounters are staged.
 *
 * Modelled on `scatterRuinsSpawnPoints` — same ring sampling, same town/circus/
 * camp exclusions — with two extra demands an ambient ghoul does not have: room
 * to fight in, and distance from every other site, so consecutive bounties send
 * the player somewhere genuinely new.
 */
function scatterBountySites(
  grid: TileGrid,
  plan: TownPlan,
  circus: CircusGrounds,
  camps: ReadonlyArray<CampSite>,
): TilePoint[] {
  const size = grid.size;
  const { x: cx, y: cy } = plan.centre;
  const innerRadius = plan.safeRadiusTiles + BOUNTY_TOWN_BUFFER;
  const outerRadius = size / 2 - BORDER - BOUNTY_EDGE_MARGIN;
  const sites: TilePoint[] = [];
  const minSpacingSq = BOUNTY_SITE_MIN_SPACING_TILES * BOUNTY_SITE_MIN_SPACING_TILES;

  for (let i = 0; i < BOUNTY_SITE_ATTEMPTS && sites.length < BOUNTY_SITE_TARGET; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = innerRadius + Math.random() * Math.max(0, outerRadius - innerRadius);
    const tx = Math.round(cx + Math.cos(angle) * distance);
    const ty = Math.round(cy + Math.sin(angle) * distance);
    if (tx <= BORDER || tx >= size - BORDER || ty <= BORDER || ty >= size - BORDER) continue;
    if (
      Math.hypot(tx - circus.centre.x, ty - circus.centre.y) <
      circus.radius + BOUNTY_CIRCUS_BUFFER
    )
      continue;
    if (
      camps.some(
        (camp) =>
          Math.hypot(tx - camp.centre.x, ty - camp.centre.y) <
          camp.radiusTiles + BOUNTY_CAMP_BUFFER,
      )
    )
      continue;
    if (sites.some((site) => (site.x - tx) ** 2 + (site.y - ty) ** 2 < minSpacingSq)) continue;
    if (!isBountyFightableGround(grid.typeAt(tx, ty))) continue;
    if (openGroundFraction(grid, tx, ty) < BOUNTY_CLEARANCE_MIN_OPEN_FRACTION) continue;
    sites.push({ x: tx, y: ty });
  }
  return sites;
}
