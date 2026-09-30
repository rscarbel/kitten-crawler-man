/**
 * Checks for `verify:borrowed-blueprints` on the road Midge is led along:
 *
 * - on a sweep of generated maps the route from Merrit's gate reaches
 *   Garrison Green's cart gate, one walkable step at a time, over road for
 *   nearly all of its length, and never through a doorway;
 * - every waypoint can be walked to in a straight line from the one before
 *   (`hasWalkableLine`), so the arrow aimed at it never points through a
 *   fence, a wall or a tree;
 * - the waypoint in hand moves forward as the party walks the road, holds
 *   still through a step or two of jostling, goes back when Midge is sent
 *   home, and is picked afresh when she is led well off the road;
 * - in a live rig the guidance, the Journal pin and the minimap pip all name
 *   the waypoint, and leading Midge down the road moves it on.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { GameMap } from '../../src/map/GameMap';
import { findNearbyWalkableTile } from '../../src/map/findWalkableTile';
import type { TilePoint } from '../../src/map/town/townPlan';
import {
  ESCORT_WAYPOINT_ARRIVAL_TILES,
  ESCORT_WAYPOINT_MAX_SPACING_TILES,
  EscortRouteProgress,
  escortRouteFor,
  isEscortRoadTile,
  isEscortStep,
  isStraightWalk,
  merritGateTile,
  type EscortRoute,
} from '../../src/systems/briarHollow/blueprints/escortRoute';
import { garrisonGreen } from '../../src/systems/briarHollow/blueprints/garrisonGreen';
import { BLUEPRINTS_QUEST_ID } from '../../src/systems/briarHollow/blueprints/blueprintsProgress';
import { standAt } from '../villageSiegeHarness';
import { blueprintsRig } from './fence';
import type { Check } from './fenna';

/** How many maps the sweep generates; seeds are spread the way `verify:briar-hollow-site` spreads them. */
const ROUTE_SWEEP_MAPS = 40;
const SEED_STRIDE = 7919;
const ROUTE_MAP_SIZE = 280;
/** The least share of the route's tiles that must be road. */
const MIN_ROAD_SHARE = 0.85;
/** How far behind the party Midge walks in the scripted walk, in route tiles. */
const MIDGE_TRAIL_STEPS = 3;
/** How far back the jostle steps Midge and the party, in route tiles. */
const JOSTLE_STEPS = 2;
/** How far off the road the stray probe leads Midge, in tiles: past the progress's off-route distance. */
const STRAY_TILES = 9;
const STRAY_SEARCH_TILES = 3;
/** The least share of the swept maps that must have open ground that far off the road for the stray probe. */
const MIN_STRAY_PROBE_SHARE = 0.5;
/** Route tiles the live rig leads Midge down. */
const LIVE_WALK_TILES = 14;
/** The live party's pace, in pixels per update: under Midge's own, so she keeps up. */
const LIVE_WALK_PX_PER_UPDATE = 0.6;
/** Updates the live rig lets pass for Midge to catch up once the party stops. */
const LIVE_SETTLE_UPDATES = 180;
/** Updates for Midge to answer the party at the gate and go on the lead. */
const LIVE_PICKUP_UPDATES = 30;

function isFourAdjacent(a: TilePoint, b: TilePoint): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function sameTile(a: TilePoint, b: TilePoint): boolean {
  return a.x === b.x && a.y === b.y;
}

interface RouteMap {
  readonly seed: number;
  readonly map: GameMap;
  readonly route: EscortRoute;
}

const sweptMaps: RouteMap[] = [];

function sweepSeeds(): number[] {
  return Array.from({ length: ROUTE_SWEEP_MAPS }, (_, index) => (index + 1) * SEED_STRIDE);
}

/** The problems with one map's route, as short phrases; empty when it is sound. */
function routeProblems(map: GameMap, route: EscortRoute, start: TilePoint): string[] {
  const problems: string[] = [];
  const { tiles, waypoints } = route;
  const green = garrisonGreen(map);
  if (!sameTile(tiles[0], start)) problems.push("does not start at Merrit's gate");
  const end = tiles[tiles.length - 1];
  if (green === null || !green.gateTiles.some((gate) => sameTile(gate, end))) {
    problems.push("does not end at Garrison Green's gate");
  }
  const brokenStep = tiles.findIndex(
    (tile, index) => index > 0 && !isFourAdjacent(tiles[index - 1], tile),
  );
  if (brokenStep >= 0) problems.push(`jumps at step ${brokenStep}`);
  const unwalkable = tiles.find((tile) => !isEscortStep(map, tile.x, tile.y));
  if (unwalkable !== undefined)
    problems.push(`steps on (${unwalkable.x},${unwalkable.y}), which Midge cannot`);
  const roadShare =
    tiles.filter((tile) => isEscortRoadTile(map, tile.x, tile.y)).length / tiles.length;
  if (roadShare < MIN_ROAD_SHARE) problems.push(`only ${(roadShare * 100).toFixed(0)}% road`);
  const last = waypoints[waypoints.length - 1];
  if (last === undefined || last.routeIndex !== tiles.length - 1) {
    problems.push('the last waypoint is not the gate');
  }
  let previous = start;
  let previousIndex = 0;
  waypoints.forEach((waypoint, index) => {
    if (
      waypoint.routeIndex <= previousIndex ||
      !sameTile(tiles[waypoint.routeIndex], waypoint.tile)
    ) {
      problems.push(`waypoint ${index} is out of order or off the route`);
    }
    const spacing = Math.hypot(waypoint.tile.x - previous.x, waypoint.tile.y - previous.y);
    if (spacing > ESCORT_WAYPOINT_MAX_SPACING_TILES) {
      problems.push(`waypoint ${index} is ${spacing.toFixed(1)} tiles from the one before`);
    }
    if (!isStraightWalk(map, previous, waypoint.tile)) {
      problems.push(
        `no straight walk from (${previous.x},${previous.y}) to waypoint ${index} (${waypoint.tile.x},${waypoint.tile.y})`,
      );
    }
    previous = waypoint.tile;
    previousIndex = waypoint.routeIndex;
  });
  return problems;
}

/** The route on a sweep of maps: reachable, walkable, on the road, and walkable waypoint to waypoint. */
function verifyRouteSweep(check: Check): void {
  let sound = 0;
  let worstRoadShare = 1;
  for (const seed of sweepSeeds()) {
    const map = new GameMap({
      mapSize: ROUTE_MAP_SIZE,
      mapType: 'overworld',
      worldSeed: seed,
      tileHeight: TILE_SIZE,
    });
    const site = map.briarHollow;
    const start = site === null ? null : merritGateTile(site);
    const route = site === null ? null : escortRouteFor(map, site);
    if (site === null || start === null || route === null) {
      check(false, `seed ${seed}: the escort has a road from Merrit's gate to Garrison Green`);
      continue;
    }
    const problems = routeProblems(map, route, start);
    const roadShare =
      route.tiles.filter((tile) => isEscortRoadTile(map, tile.x, tile.y)).length /
      route.tiles.length;
    worstRoadShare = Math.min(worstRoadShare, roadShare);
    if (problems.length > 0) {
      check(false, `seed ${seed}: the escort's road ${problems.join('; ')}`);
      continue;
    }
    sound++;
    sweptMaps.push({ seed, map, route });
  }
  check(
    sound === ROUTE_SWEEP_MAPS,
    `${sound}/${ROUTE_SWEEP_MAPS} maps: the road starts at Merrit's gate, ends at the pasture's, ` +
      `is walkable for Midge step by step, keeps out of doorways, and every waypoint is a straight walk from the last`,
  );
  check(
    worstRoadShare >= MIN_ROAD_SHARE,
    `the road keeps to road surfaces: at worst ${(worstRoadShare * 100).toFixed(1)}% ` +
      `(at least ${MIN_ROAD_SHARE * 100}%)`,
  );
}

/** The route tile for step `index`, clamped to the route. */
function routeTile(route: EscortRoute, index: number): TilePoint {
  return route.tiles[Math.max(0, Math.min(route.tiles.length - 1, index))];
}

/**
 * A scripted walk down every swept map's road, the party in front and Midge
 * a few tiles behind: the waypoint only ever moves forward, the one in hand
 * is always ahead of the party, and the walk ends with every waypoint reached.
 */
function verifyWaypointsAdvance(check: Check): void {
  let forwardOnly = 0;
  let alwaysAhead = 0;
  let finished = 0;
  let jostleHeld = 0;
  let homeResets = 0;
  let strayProbes = 0;
  let strayRepicks = 0;
  for (const { seed, map, route } of sweptMaps) {
    const progress = new EscortRouteProgress(route);
    let lastWaypoint = 0;
    let movedBack = false;
    let fellBehind = false;
    for (let step = 0; step < route.tiles.length; step++) {
      const leader = routeTile(route, step);
      progress.update(routeTile(route, step - MIDGE_TRAIL_STEPS), leader);
      const current = progress.currentWaypoint;
      if (progress.currentWaypointIndex < lastWaypoint) movedBack = true;
      lastWaypoint = progress.currentWaypointIndex;
      if (current !== null && current.routeIndex <= step) fellBehind = true;
    }
    if (!movedBack) forwardOnly++;
    if (!fellBehind) alwaysAhead++;
    if (progress.currentWaypoint === null && progress.guidance() === null) finished++;

    const middle = Math.floor(route.tiles.length / 2);
    const jostled = new EscortRouteProgress(route);
    jostled.update(routeTile(route, middle - MIDGE_TRAIL_STEPS), routeTile(route, middle));
    const before = jostled.currentWaypointIndex;
    jostled.update(
      routeTile(route, middle - MIDGE_TRAIL_STEPS - JOSTLE_STEPS),
      routeTile(route, middle - JOSTLE_STEPS),
    );
    if (jostled.currentWaypointIndex === before) jostleHeld++;

    jostled.update(routeTile(route, 0), routeTile(route, 0));
    if (jostled.currentWaypointIndex <= 1) homeResets++;

    const onRoad = routeTile(route, middle);
    const strayed = findNearbyWalkableTile(
      map,
      onRoad.x + STRAY_TILES,
      onRoad.y + STRAY_TILES,
      STRAY_SEARCH_TILES,
      (x, y) => route.tiles.every((tile) => Math.hypot(tile.x - x, tile.y - y) > STRAY_TILES - 1),
    );
    if (strayed === null) continue;
    strayProbes++;
    const astray = new EscortRouteProgress(route);
    astray.update(
      routeTile(route, route.tiles.length - 1),
      routeTile(route, route.tiles.length - 1),
    );
    astray.update(strayed, strayed);
    const repicked = astray.currentWaypoint;
    const nearestIndex = route.tiles.reduce(
      (best, tile, index) =>
        Math.hypot(tile.x - strayed.x, tile.y - strayed.y) <
        Math.hypot(route.tiles[best].x - strayed.x, route.tiles[best].y - strayed.y)
          ? index
          : best,
      0,
    );
    if (repicked !== null && repicked.routeIndex > nearestIndex) strayRepicks++;
    else
      check(
        false,
        `seed ${seed}: led off the road, the waypoint is picked afresh past where she stands`,
      );
  }
  const maps = sweptMaps.length;
  check(
    maps > 0 && forwardOnly === maps,
    `${forwardOnly}/${maps} walks: the waypoint only ever moves forward`,
  );
  check(
    maps > 0 && alwaysAhead === maps,
    `${alwaysAhead}/${maps} walks: the waypoint in hand is always ahead of the party`,
  );
  check(
    maps > 0 && finished === maps,
    `${finished}/${maps} walks: at the gate every waypoint is reached`,
  );
  check(
    maps > 0 && jostleHeld === maps,
    `${jostleHeld}/${maps}: stepping back ${JOSTLE_STEPS} tiles does not step the waypoint back`,
  );
  check(
    maps > 0 && homeResets === maps,
    `${homeResets}/${maps}: Midge sent home takes the waypoint home with her`,
  );
  check(
    strayProbes >= maps * MIN_STRAY_PROBE_SHARE && strayRepicks === strayProbes,
    `${strayRepicks}/${strayProbes} maps with open ground off the road: led well off it, the waypoint is picked afresh ahead of her`,
  );
}

/**
 * In a live rig: with Midge on the lead the guidance, the Journal pin and the
 * minimap pip all name the waypoint, and leading her down the road moves it on.
 */
function verifyLiveGuidance(check: Check): void {
  const { rig, blueprints } = blueprintsRig('escort_midge');
  const route = escortRouteFor(rig.map, rig.site);
  if (route === null) {
    check(false, 'the rig map has a road for the escort');
    rig.dispose();
    return;
  }
  const start = route.tiles[0];
  standAt(rig.human, start.x, start.y);
  standAt(rig.cat, start.x, start.y);
  for (let update = 0; update < LIVE_PICKUP_UPDATES; update++) rig.step();
  const guidance = blueprints.guidance();
  const tracked = blueprints
    .trackerEntries()
    .find((entry) => entry.id === BLUEPRINTS_QUEST_ID)?.target;
  const pip = blueprints.questMarkers[0];
  check(
    guidance?.kind === 'escort_waypoint',
    `led, the guide names a waypoint (${guidance?.kind ?? 'nothing'})`,
  );
  if (guidance?.kind !== 'escort_waypoint') {
    rig.dispose();
    return;
  }
  check(
    tracked !== undefined && sameTile(tracked, guidance.at) && tracked.wearsOwnMarker === true,
    'the Journal pin points at the waypoint, which marks itself',
  );
  check(pip !== undefined && sameTile(pip, guidance.at), 'the minimap pip stands on the waypoint');
  check(
    guidance.trail.length > 0 && guidance.ahead.length > 0,
    'the trail runs down the road, with waypoints still ahead',
  );
  const firstIndex = route.waypoints.findIndex((waypoint) => sameTile(waypoint.tile, guidance.at));

  let highest = firstIndex;
  let movedBack = false;
  const walkTo = Math.min(route.tiles.length - 1, LIVE_WALK_TILES);
  for (let step = 1; step <= walkTo; step++) {
    const target = route.tiles[step];
    const targetX = target.x * TILE_SIZE;
    const targetY = target.y * TILE_SIZE;
    while (rig.human.x !== targetX || rig.human.y !== targetY) {
      const dx = targetX - rig.human.x;
      const dy = targetY - rig.human.y;
      rig.human.x += Math.sign(dx) * Math.min(Math.abs(dx), LIVE_WALK_PX_PER_UPDATE);
      rig.human.y += Math.sign(dy) * Math.min(Math.abs(dy), LIVE_WALK_PX_PER_UPDATE);
      rig.step();
      const now = blueprints.guidance();
      if (now?.kind !== 'escort_waypoint') continue;
      const index = route.waypoints.findIndex((waypoint) => sameTile(waypoint.tile, now.at));
      if (index < highest) movedBack = true;
      highest = Math.max(highest, index);
    }
  }
  for (let update = 0; update < LIVE_SETTLE_UPDATES; update++) rig.step();
  const passed = route.waypoints.filter(
    (waypoint) =>
      waypoint.routeIndex <= walkTo &&
      Math.hypot(waypoint.tile.x - route.tiles[walkTo].x, waypoint.tile.y - route.tiles[walkTo].y) >
        ESCORT_WAYPOINT_ARRIVAL_TILES,
  ).length;
  check(
    !movedBack && highest >= passed,
    `leading Midge ${walkTo} tiles down the road moves the waypoint on (waypoint ${firstIndex} → ${highest}, ${passed} passed) and never back`,
  );
  rig.dispose();
}

export function escortRouteSections(
  check: Check,
): ReadonlyArray<{ readonly name: string; readonly run: () => void }> {
  return [
    {
      name: "Midge's road: planned on the road, walkable waypoint to waypoint",
      run: () => verifyRouteSweep(check),
    },
    {
      name: "Midge's road: the waypoint in hand moves with the escort",
      run: () => verifyWaypointsAdvance(check),
    },
    {
      name: "Midge's road: the guide, the pin and the pip agree",
      run: () => verifyLiveGuidance(check),
    },
  ];
}
