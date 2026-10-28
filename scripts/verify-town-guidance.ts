#!/usr/bin/env tsx
/**
 * Headless checks on the town's wayfinding: that every building entrance can be
 * walked into across the whole of its own opening, that the north gate is a
 * gate rather than a hole in a wall, and that the quest route guide aims the
 * objective arrow at the gate a route leaves or enters a walled area by.
 *
 * Both guard failures that are invisible without walking the map. A doorway the
 * entry menu keys off one column of is a building the player stands squarely in
 * front of and is never offered — nothing logs, nothing looks wrong, and the
 * only symptom is a playtester saying the door "sometimes" works. A gate whose
 * corridor is sealed by a prop, or whose opening is not walkable, reads as a
 * gate from either side and is a dead end.
 *
 * Generation is unseeded (`Math.random()` throughout), so the map-shaped checks
 * run over a batch rather than over one lucky draw.
 *
 * Run: npm run verify:town
 */

import { GameMap } from '../src/map/GameMap';
import {
  getSpriteDoorwayByKey,
  type SpriteManifestEntry,
} from '../src/core/spriteAssets/SpriteLoader';
import { createTownPlan, type TileRect, type TownPlan } from '../src/map/town/townPlan';
import { PLANNED_SIGNPOSTS } from '../src/systems/townDecorPlan';
import { TILE_SIZE } from '../src/core/constants';
import buildingManifest from '../src/images/environment/buildings/manifest.json';
import { findNearbyWalkableTile } from '../src/map/findWalkableTile';
import { tileCoordKey } from '../src/map/tileIndex';
import type { TilePoint } from '../src/map/town/townPlan';
import { doorwayKeys } from '../src/systems/doorwayTiles';
import { isInsidePalisade } from '../src/systems/briarHollow/blueprints/escortRoute';
import { doorwayBeaconTarget } from '../src/systems/objectiveBeaconTargets';
import {
  QUEST_ROUTE_CHAIN_MAX_TILES,
  QUEST_ROUTE_PORTAL_UNDERFOOT_STEPS,
  QuestRouteGuide,
} from '../src/systems/questRoute/QuestRouteGuide';
import {
  buildRouteField,
  downhillChain,
  goalTilesForTarget,
  type RouteField,
} from '../src/systems/questRoute/routeField';
import {
  firstPortalOnChain,
  routePortals,
  type RoutePortal,
} from '../src/systems/questRoute/routePortals';
import { crawlerGroundPoint, groundPointOnTile } from '../src/systems/questRoute/routeOrigin';
import { trailPointAt, TrailShaper, type TrailGround } from '../src/systems/questRoute/trailShape';

/** Read straight rather than through `SpriteLoader`, so the gate measures the source. */
const BUILDING_MANIFEST: Readonly<Record<string, SpriteManifestEntry | undefined>> =
  buildingManifest;

/** The size every overworld is generated at, matching floor 3's level def. */
const MAP_SIZE = 280;
/**
 * How many unseeded maps the layout checks are run over.
 *
 * Generation is `Math.random()` throughout and the wilderness passes — rivers,
 * cliffs, forests — are what vary, so a layout accident is rare per draw. A few
 * hundred draws is the honest sample size; this is what the run takes in about a
 * minute, which is the most a gate can cost and still be run.
 */
const MAPS_TO_GENERATE = 200;
/** The gate this plan added, by the `TownPlan`'s own name. */
const NORTH_GATE_NAME = 'north gate';

let failures = 0;
function check(ok: boolean, message: string): void {
  if (!ok) {
    console.log(` FAIL  ${message}`);
    failures++;
    return;
  }
  console.log(`  ok   ${message}`);
}

/** Reports each distinct failure once — a batch would otherwise print N copies. */
const reportedOnce = new Set<string>();
function checkOnce(ok: boolean, message: string): void {
  if (ok) return;
  failures++;
  if (reportedOnce.has(message)) return;
  reportedOnce.add(message);
  console.log(` FAIL  ${message}`);
}

/**
 * The anchor-relative column the sprite's art actually paints its door on,
 * measured straight off the manifest.
 *
 * Deliberately a second, independent implementation of what
 * `SpriteLoader.doorCentreColumnFromRegions` does rather than a call to it: a
 * gate that asks the code under test for the expected answer tests nothing. The
 * arithmetic is small enough that restating it is cheaper than the indirection,
 * and a divergence between the two is exactly the regression worth catching.
 */
function paintedDoorColumn(spriteKey: string): number | undefined {
  const entry = BUILDING_MANIFEST[spriteKey];
  if (entry === undefined) return undefined;
  const regions = entry.blockedRegions;
  if (regions === undefined) return undefined;

  let deepest = -Infinity;
  for (const region of regions) deepest = Math.max(deepest, region.y2);
  // Everything reaching into the bottom tile row, not only what ends level with
  // the deepest pixel: a facade's two flanks are hand-authored and need not
  // finish at the same depth.
  const baseCourse = regions
    .filter((region) => region.y2 >= deepest - entry.tileScale)
    .sort((a, b) => a.x1 - b.x1);
  if (baseCourse.length < 2) return undefined;

  let widestGap = 0;
  let centrePx = 0;
  let reached = baseCourse[0].x2;
  for (let at = 1; at < baseCourse.length; at++) {
    const gap = baseCourse[at].x1 - reached;
    if (gap > widestGap) {
      widestGap = gap;
      centrePx = (reached + baseCourse[at].x1) / 2;
    }
    reached = Math.max(reached, baseCourse[at].x2);
  }
  if (widestGap <= 0) return undefined;
  return Math.floor((centrePx - entry.tileX) / entry.tileScale);
}

const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/**
 * Four-connected flood from `from`, answering only whether `to` was reached.
 *
 * `passable` decides what counts as a step, so a caller can hold the walk inside
 * the walls. Without that, "can the plaza reach the north gate's exit tile" is
 * answered yes by walking out of the *south* gate and round the outside of the
 * town, which is true of a north gate that is bricked up solid.
 */
function reaches(
  size: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  passable: (x: number, y: number) => boolean,
): boolean {
  const seen = new Uint8Array(size * size);
  const start = from.y * size + from.x;
  const target = to.y * size + to.x;
  const queue: number[] = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const key = queue.pop();
    if (key === undefined) break;
    if (key === target) return true;
    const x = key % size;
    const y = Math.floor(key / size);
    for (const [dx, dy] of CARDINAL_STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const nextKey = ny * size + nx;
      if (seen[nextKey] === 1) continue;
      if (!passable(nx, ny)) continue;
      seen[nextKey] = 1;
      queue.push(nextKey);
    }
  }
  return false;
}

function contains(rect: TileRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/**
 * Every tile the `TownPlan`'s standing props occupy.
 *
 * The generator does not block these — `TownPropSystem` and `TownDecorSystem`
 * block them after the map is built, which is *after* everything the generator's
 * own reachability assertions can see. A torch in the mouth of a gate corridor
 * is therefore exactly the failure a headless check has to reproduce by hand,
 * and the north gate's corridor runs past two of them.
 */
function propTiles(plan: TownPlan): Set<number> {
  const blocked = new Set<number>();
  for (const prop of plan.props) {
    if (prop.kind === 'fountain') {
      for (let y = prop.bounds.y; y < prop.bounds.y + prop.bounds.h; y++) {
        for (let x = prop.bounds.x; x < prop.bounds.x + prop.bounds.w; x++) {
          blocked.add(y * MAP_SIZE + x);
        }
      }
      continue;
    }
    blocked.add(prop.tile.y * MAP_SIZE + prop.tile.x);
  }
  return blocked;
}

console.log('\nDoorway derivation (manifest, no map needed)');
{
  const plan = createTownPlan(MAP_SIZE);
  for (const building of plan.buildings) {
    const doorway = getSpriteDoorwayByKey(building.spriteKey);
    if (doorway === undefined) {
      check(false, `${building.id}: '${building.spriteKey}' derives a doorway`);
      continue;
    }
    // Measured here from the manifest independently of `SpriteLoader`, and
    // compared against what it derived. Checking the derived door tile against
    // the derived opening instead would be checking a clamp against the range it
    // was just clamped into — always true, and blind to whether the tile is
    // actually anchored on the *painted* door rather than on the middle of a
    // tile run biased left of it.
    const painted = paintedDoorColumn(building.spriteKey);
    check(
      painted !== undefined && doorway.dx === painted,
      `${building.id}: door tile dx=${doorway.dx} sits on the painted opening ` +
        `(pixel gap centre column ${painted ?? 'not found'})`,
    );
  }
}

console.log('\nTown plan');
{
  const plan = createTownPlan(MAP_SIZE);
  const northGate = plan.gates.find((gate) => gate.name === NORTH_GATE_NAME);
  check(northGate !== undefined, `the plan has a '${NORTH_GATE_NAME}'`);
  if (northGate !== undefined) {
    check(northGate.bounds.y === plan.wall.y, "the north gate is cut into the wall's north run");
    check(northGate.outward.dy === -1, "the north gate's highway runs north");
  }
  for (const gate of plan.gates) {
    check(
      PLANNED_SIGNPOSTS.some((post) => post.gateName === gate.name),
      `'${gate.name}' has a fingerpost inside it`,
    );
  }
}

console.log(`\nGenerating ${MAPS_TO_GENERATE} overworlds…`);
for (let mapIndex = 0; mapIndex < MAPS_TO_GENERATE; mapIndex++) {
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld', tileHeight: TILE_SIZE });
  const plaza = map.townSquareCentre;
  const plan = map.townPlan;
  if (plaza === undefined || plan === undefined) {
    checkOnce(false, 'a generated overworld reports its town square centre and plan');
    continue;
  }
  const props = propTiles(plan);
  const walkable = (x: number, y: number): boolean =>
    map.isWalkable(x, y) && !props.has(y * MAP_SIZE + x);

  // Every tile of every opening, not just the one the entry menu is keyed on —
  // a doorway several tiles wide must be enterable at any column along it.
  for (const entry of map.buildingEntries) {
    const { x0, width } = entry.doorway;
    for (let x = x0; x < x0 + width; x++) {
      checkOnce(
        map.isWalkable(x, entry.doorTile.y),
        `'${entry.id}': column ${x - x0} of its ${width}-tile doorway is not walkable`,
      );
    }
    // Where `DungeonScene` puts the party when they walk back out of a
    // building. It is one row south of the door rather than on it, so that
    // leaving does not immediately re-open the "Enter this building?" prompt —
    // which makes it a tile nothing else in the generator ever checks, and a
    // solid one there is a player stuck inside a shop.
    checkOnce(
      walkable(entry.doorTile.x, entry.doorTile.y + 1),
      `'${entry.id}': the tile the party is put back on when they leave is not walkable`,
    );
    checkOnce(
      entry.doorTile.x >= x0 && entry.doorTile.x < x0 + width,
      `'${entry.id}': its door tile lies outside its own doorway`,
    );
    checkOnce(
      reaches(MAP_SIZE, plaza, entry.doorTile, walkable),
      `'${entry.id}': its door is walkable from the plaza`,
    );
  }

  const northGate = plan.gates.find((gate) => gate.name === NORTH_GATE_NAME);
  if (northGate === undefined) {
    checkOnce(false, `a generated map carries a '${NORTH_GATE_NAME}'`);
    continue;
  }
  for (let x = northGate.bounds.x; x < northGate.bounds.x + northGate.bounds.w; x++) {
    checkOnce(
      walkable(x, northGate.bounds.y),
      "a column of the north gate's opening is not walkable",
    );
  }
  // Held inside the wall, plus the gate's own opening and the tile beyond it, so
  // the only route this can find is the corridor the gate was cut to serve.
  const insideTownOrThroughTheGate = (x: number, y: number): boolean => {
    if (!walkable(x, y)) return false;
    if (contains(plan.interior, x, y)) return true;
    if (contains(northGate.bounds, x, y)) return true;
    return x === northGate.exit.x && y === northGate.exit.y;
  };
  checkOnce(
    reaches(MAP_SIZE, plaza, northGate.exit, insideTownOrThroughTheGate),
    "the north gate's exit tile is reachable from the plaza without leaving the town",
  );
}
check(reportedOnce.size === 0, `all ${MAPS_TO_GENERATE} generated maps passed`);

/**
 * How many maps the quest route checks run over. Each one builds a route field
 * per gate and per building door, so a handful of maps keeps the gate near a
 * minute while still varying the wilderness the routes cross.
 */
const QUEST_ROUTE_CHECK_MAPS = 10;
/** How far past a town gate's apron the outside target stands, in tiles. */
const BEYOND_APRON_TILES = 4;
/** How far round a wanted tile a check looks for one the party can stand on, in tiles. */
const STAND_SEARCH_TILES = 4;
/** How far outward of a palisade gate's outside tile the route check starts, in tiles. */
const OUTSIDE_PALISADE_START_TILES = 8;

/** The tile the arrow would face: the first gate on the route from `from`, or the destination. */
function firstAimTile(
  field: RouteField,
  map: GameMap,
  from: TilePoint,
  destination: TilePoint,
  portals: readonly RoutePortal[],
): { aim: TilePoint; chain: TilePoint[] } {
  const chain = downhillChain(field, map, from, QUEST_ROUTE_CHAIN_MAX_TILES);
  const portal = firstPortalOnChain(chain, portals, QUEST_ROUTE_PORTAL_UNDERFOOT_STEPS);
  return { aim: portal?.centre ?? destination, chain };
}

function isTileIn(tiles: readonly TilePoint[], tile: TilePoint): boolean {
  return tiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y);
}

function townGateTiles(plan: TownPlan): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (const { bounds } of plan.gates) {
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.w; x++) tiles.push({ x, y });
    }
  }
  return tiles;
}

/** The first tile walking `outward` from `start` that is clear of `rect`, plus `extra` more. */
function beyondRect(
  start: TilePoint,
  outward: { dx: number; dy: number },
  rect: TileRect,
  extra: number,
): TilePoint {
  let x = start.x;
  let y = start.y;
  while (contains(rect, x, y)) {
    x += outward.dx;
    y += outward.dy;
  }
  return { x: x + outward.dx * extra, y: y + outward.dy * extra };
}

console.log(`\nQuest route guide over ${QUEST_ROUTE_CHECK_MAPS} overworlds`);
const routeBuildMs: number[] = [];
let routeField: RouteField | null = null;
for (let mapIndex = 0; mapIndex < QUEST_ROUTE_CHECK_MAPS; mapIndex++) {
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld', tileHeight: TILE_SIZE });
  const plaza = map.townSquareCentre;
  const plan = map.townPlan;
  if (plaza === undefined || plan === undefined) {
    checkOnce(false, 'a generated overworld reports its town square centre and plan');
    continue;
  }
  const portals = routePortals(map);
  const gateTiles = townGateTiles(plan);
  const doorways = doorwayKeys(map);

  for (const gate of plan.gates) {
    const wanted = beyondRect(gate.exit, gate.outward, gate.apron, BEYOND_APRON_TILES);
    const outside = findNearbyWalkableTile(map, wanted.x, wanted.y, STAND_SEARCH_TILES);
    if (outside === null) {
      checkOnce(false, `'${gate.name}': open ground stands beyond its apron`);
      continue;
    }
    const goals = goalTilesForTarget(map, { x: outside.x, y: outside.y });
    const started = performance.now();
    routeField = buildRouteField(map, goals, routeField);
    routeBuildMs.push(performance.now() - started);
    const { aim } = firstAimTile(routeField, map, plaza, outside, portals);
    checkOnce(
      isTileIn(gateTiles, aim),
      'from the plaza to open ground beyond a gate, the arrow first aims at a town gate',
    );

    const guide = new QuestRouteGuide();
    guide.updateToTiles(map, groundPointOnTile(plaza), goals);
    const guideAim = guide.aim();
    const guideAimTile =
      guideAim === null
        ? null
        : { x: Math.floor(guideAim.x / TILE_SIZE), y: Math.floor(guideAim.y / TILE_SIZE) };
    checkOnce(
      guideAimTile !== null && isTileIn(gateTiles, guideAimTile),
      'the route guide itself aims from the plaza at a town gate for a target outside the wall',
    );
    guide.dispose();
  }

  for (const entry of map.buildingEntries) {
    const target = doorwayBeaconTarget(entry);
    if (target === null) continue;
    const goals = goalTilesForTarget(map, target);
    if (goals.length === 0) {
      checkOnce(false, `'${entry.id}': its door target has a tile a route can end on`);
      continue;
    }
    routeField = buildRouteField(map, goals, routeField);
    const { aim, chain } = firstAimTile(routeField, map, plaza, entry.doorTile, portals);
    const last = chain[chain.length - 1];
    checkOnce(
      last !== undefined && isTileIn(goals, last),
      `'${entry.id}': the route from the plaza reaches its door`,
    );
    const insideTown = map.isTileInsideTownWall(entry.doorTile.x, entry.doorTile.y);
    checkOnce(
      insideTown ? aim === entry.doorTile : isTileIn(gateTiles, aim),
      insideTown
        ? 'from the plaza to a door inside the town, the arrow aims at the door itself'
        : 'from the plaza to a door outside the town, the arrow first aims at a town gate',
    );
    const goalKeys = new Set(goals.map((goal) => tileCoordKey(goal.x, goal.y)));
    checkOnce(
      chain.every((tile) => {
        const key = tileCoordKey(tile.x, tile.y);
        return goalKeys.has(key) || !doorways.has(key);
      }),
      'no route to a door crosses any other doorway',
    );
  }

  const site = map.briarHollow;
  if (site === null) {
    checkOnce(false, 'a generated overworld carries Briar Hollow');
    continue;
  }
  const palisadeGateTiles = site.gates.flatMap((gate) => gate.tiles);
  const inside = findNearbyWalkableTile(
    map,
    site.centre.x,
    site.centre.y,
    STAND_SEARCH_TILES,
    (x, y) => isInsidePalisade(site, x, y),
  );
  if (inside === null) {
    checkOnce(false, 'Briar Hollow has open ground inside its palisade');
    continue;
  }
  const palisadeField = buildRouteField(map, [inside], routeField);
  routeField = palisadeField;
  // The wilderness is unseeded, and the ring search can settle on a pocket
  // walled in by trees or cliffs; the arrow's aim only means something from
  // ground that can walk to the village at all.
  const reachesTheVillage = (x: number, y: number): boolean =>
    palisadeField.cost[y * palisadeField.columns + x] < Infinity;
  for (const gate of site.gates) {
    const outward = {
      dx: Math.sign(gate.outside.x - gate.inside.x),
      dy: Math.sign(gate.outside.y - gate.inside.y),
    };
    const start = findNearbyWalkableTile(
      map,
      gate.outside.x + outward.dx * OUTSIDE_PALISADE_START_TILES,
      gate.outside.y + outward.dy * OUTSIDE_PALISADE_START_TILES,
      STAND_SEARCH_TILES,
      (x, y) =>
        !isInsidePalisade(site, x, y) && !map.isTileInsideTownWall(x, y) && reachesTheVillage(x, y),
    );
    if (start === null) continue;
    const { aim } = firstAimTile(routeField, map, start, inside, portals);
    checkOnce(
      isTileIn(palisadeGateTiles, aim),
      'from outside Briar Hollow to a tile inside, the arrow first aims at a palisade gate',
    );
  }
}
/** Ticks the guide is given to land its first sliced field before the route is blocked. */
const FIRST_BUILD_TICKS = 120;
/** Ticks the player keeps changing tile after the route is blocked: several whole builds' worth. */
const BLOCKED_ROUTE_TICKS = 180;
/** Which tile of the route ahead is walled off, far enough out to lie inside the painted trail. */
const BLOCKED_ROUTE_INDEX = 10;

console.log('\nQuest route guide re-routes round a newly blocked tile while the player walks');
{
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld', tileHeight: TILE_SIZE });
  const plaza = map.townSquareCentre;
  const gate = map.townPlan?.gates[0];
  if (plaza === undefined || gate === undefined) {
    check(false, 'a generated overworld reports its plaza and a town gate');
  } else {
    const wanted = beyondRect(gate.exit, gate.outward, gate.apron, BEYOND_APRON_TILES);
    const outside = findNearbyWalkableTile(map, wanted.x, wanted.y, STAND_SEARCH_TILES);
    if (outside === null) {
      check(false, 'open ground stands beyond the first gate');
    } else {
      const target = { x: outside.x, y: outside.y };
      const field = buildRouteField(map, goalTilesForTarget(map, target));
      const chain = downhillChain(field, map, plaza, QUEST_ROUTE_CHAIN_MAX_TILES);
      const guide = new QuestRouteGuide();
      for (let tick = 0; tick < FIRST_BUILD_TICKS; tick++) {
        guide.update(map, groundPointOnTile(plaza), target);
      }
      const blocked = chain[BLOCKED_ROUTE_INDEX];
      map.blockTilePermanently(blocked.x, blocked.y);
      const pacing = [chain[0], chain[1]];
      for (let tick = 0; tick < BLOCKED_ROUTE_TICKS; tick++) {
        guide.update(map, groundPointOnTile(pacing[tick % pacing.length]), target);
      }
      check(
        guide.trail().every((tile) => map.isWalkable(tile.x, tile.y)),
        'a walking player gets a trail round a newly blocked route tile',
      );
      guide.dispose();
    }
  }
}

/** Overworlds the standing-below-a-building check is run over. */
const BELOW_BUILDING_MAPS = 3;
/**
 * How far into the tile below a building the sprite's centre sits, in pixels:
 * just past its top edge, the furthest north a wall test lets a body stand,
 * where the top of the sprite hangs over the building's bottom row.
 */
const BELOW_BUILDING_CENTRE_INSET_PX = 1;
/** How far along the shaped trail its heading is read, in pixels: about where its first mark is painted. */
const TRAIL_HEADING_PROBE_PX = TILE_SIZE;

console.log('\nQuest route starts from the feet of a crawler standing just below a building');
{
  let standsChecked = 0;
  let originMisses = 0;
  let leavesBuilding = 0;
  let headsBackward = 0;
  const probe = { x: 0, y: 0 };
  for (let mapIndex = 0; mapIndex < BELOW_BUILDING_MAPS; mapIndex++) {
    const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld', tileHeight: TILE_SIZE });
    const site = map.briarHollow;
    const plaza = map.townSquareCentre;
    if (site === null || plaza === undefined) {
      check(false, 'a generated overworld carries Briar Hollow and a plaza');
      continue;
    }
    const target = { x: plaza.x, y: plaza.y };
    const field = buildRouteField(map, goalTilesForTarget(map, target));
    const costAt = (x: number, y: number): number => field.cost[y * field.columns + x];
    for (const building of site.buildings) {
      const rect = building.rect;
      const bottomRow = rect.y + rect.h - 1;
      const standRow = bottomRow + 1;
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (map.isWalkable(x, bottomRow)) continue;
        if (costAt(x, standRow) === Infinity) continue;
        const body = {
          x: x * TILE_SIZE,
          y: standRow * TILE_SIZE - TILE_SIZE / 2 + BELOW_BUILDING_CENTRE_INSET_PX,
        };
        const ground = crawlerGroundPoint(body);
        const guide = new QuestRouteGuide();
        for (let tick = 0; tick < FIRST_BUILD_TICKS; tick++) guide.update(map, ground, target);
        standsChecked++;
        const trail = guide.trail();
        const origin = trail.length > 0 ? trail[0] : null;
        if (origin?.x !== x || origin.y !== standRow) originMisses++;
        if (trail.some((tile) => contains(rect, tile.x, tile.y))) leavesBuilding++;
        const shape = guide.trailShape(ground);
        if (shape !== null) {
          trailPointAt(shape, TRAIL_HEADING_PROBE_PX, probe);
          const probeTileX = Math.floor(probe.x / TILE_SIZE);
          const probeTileY = Math.floor(probe.y / TILE_SIZE);
          if (
            contains(rect, probeTileX, probeTileY) ||
            costAt(probeTileX, probeTileY) > costAt(x, standRow)
          ) {
            headsBackward++;
          }
        }
        guide.dispose();
      }
    }
  }
  check(
    standsChecked > 0,
    `found tiles to stand on just below Briar Hollow's buildings (${standsChecked})`,
  );
  check(
    originMisses === 0,
    `the route starts on the tile under the feet, not the sprite's top (${originMisses} of ${standsChecked} missed)`,
  );
  check(
    leavesBuilding === 0,
    `the route never begins inside the building the sprite overlaps (${leavesBuilding} of ${standsChecked} did)`,
  );
  check(
    headsBackward === 0,
    `the trail's first stretch leads downhill toward the goal, never back (${headsBackward} of ${standsChecked} did)`,
  );
}

/** The side of the open square the trail-shape cases are laid out on, in tiles. */
const STUB_GROUND_TILES = 40;
/** How far any painted point of a trail may stand from the walk it follows, in tiles. */
const TRAIL_MAX_OFF_WALK_TILES = 1.5;
/** Where the trail-shape cases' walks start and turn, in tiles. */
const STUB_WALK_START = { x: 3, y: 2 };
const STUB_WALK_BEND_ROW = 12;
const STUB_RIVER_COLUMN = 5;
const STUB_FAR_BANK_COLUMN = 7;
const STUB_ROAD_END_COLUMN = 12;
/** How far into the walk's first tile the feet stand, as a share of a tile: just south of its middle. */
const STUB_FEET_DEPTH = 0.7;

/** An open square of dry ground, with river water down `riverColumn` save where `bridgeRow` crosses it. */
function stubGround(
  river: { readonly column: number; readonly bridgeRow: number } | null,
): TrailGround {
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < STUB_GROUND_TILES && y < STUB_GROUND_TILES;
  return {
    isWalkable: inside,
    isWadeable: (x, y) =>
      river !== null && inside(x, y) && x === river.column && y !== river.bridgeRow,
    isStairwellTile: () => false,
    buildingEntries: [],
  };
}

/** The furthest any painted point of `walk`'s trail, led from just inside its first tile, strays from the walk, in tiles. */
const TILE_CENTRE_OFFSET = 0.5;
const TRAIL_POINT_STRIDE = 2;

function trailStrayTiles(ground: TrailGround, walk: readonly TilePoint[]): number {
  const shaper = new TrailShaper();
  shaper.setWalk(ground, walk);
  const shape = shaper.shape({
    unit: 'px',
    x: (walk[0].x + TILE_CENTRE_OFFSET) * TILE_SIZE,
    y: (walk[0].y + STUB_FEET_DEPTH) * TILE_SIZE,
  });
  if (shape === null) return Infinity;
  let worst = 0;
  for (let index = 0; index < shape.count; index++) {
    const x = shape.points[index * TRAIL_POINT_STRIDE] / TILE_SIZE - TILE_CENTRE_OFFSET;
    const y = shape.points[index * TRAIL_POINT_STRIDE + 1] / TILE_SIZE - TILE_CENTRE_OFFSET;
    const nearest = Math.min(...walk.map((tile) => Math.hypot(tile.x - x, tile.y - y)));
    worst = Math.max(worst, nearest);
  }
  return worst;
}

console.log(
  '\nThe trail follows the walk round a bend, never cutting across what the route went round',
);
{
  const down: TilePoint[] = [];
  for (let y = STUB_WALK_START.y; y <= STUB_WALK_BEND_ROW; y++)
    down.push({ x: STUB_WALK_START.x, y });
  const toBridge = [...down];
  for (let x = STUB_WALK_START.x + 1; x <= STUB_FAR_BANK_COLUMN; x++) {
    toBridge.push({ x, y: STUB_WALK_BEND_ROW });
  }
  for (let y = STUB_WALK_BEND_ROW - 1; y >= STUB_WALK_START.y; y--) {
    toBridge.push({ x: STUB_FAR_BANK_COLUMN, y });
  }
  const riverStray = trailStrayTiles(
    stubGround({ column: STUB_RIVER_COLUMN, bridgeRow: STUB_WALK_BEND_ROW }),
    toBridge,
  );
  check(
    riverStray <= TRAIL_MAX_OFF_WALK_TILES,
    `a walk down a bank to a bridge and back is not cut across the river (strays ${riverStray.toFixed(1)} tiles)`,
  );
  const lRoad = [...down];
  for (let x = STUB_WALK_START.x + 1; x <= STUB_ROAD_END_COLUMN; x++) {
    lRoad.push({ x, y: STUB_WALK_BEND_ROW });
  }
  const bendStray = trailStrayTiles(stubGround(null), lRoad);
  check(
    bendStray <= TRAIL_MAX_OFF_WALK_TILES,
    `an L-shaped road is not cut across the grass inside its bend (strays ${bendStray.toFixed(1)} tiles)`,
  );
}

const meanBuildMs =
  routeBuildMs.reduce((sum, ms) => sum + ms, 0) / Math.max(1, routeBuildMs.length);
console.log(
  `  info full overworld route field build: ${meanBuildMs.toFixed(1)} ms mean over ${routeBuildMs.length} builds`,
);
check(reportedOnce.size === 0, `all ${QUEST_ROUTE_CHECK_MAPS} quest route maps passed`);

console.log(
  failures === 0 ? '\nAll town guidance checks passed.\n' : `\n${failures} failure(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
