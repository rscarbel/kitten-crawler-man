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
 *   the waypoint, and leading Midge down the road moves it on;
 * - led out of Briar Hollow through a gate the road does not use, the road is
 *   planned afresh from that gate, never back through the village, a door
 *   carries the new road and a rewind drops it, and Midge can be delivered
 *   along it.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../../src/core/constants';
import { createMidgeEscortCarry } from '../../src/core/midgeEscortCarry';
import { blueprintsPhaseAtLeast } from '../../src/core/blueprintsQuestPhase';
import type { BriarHollowGate, BriarHollowSite } from '../../src/map/overworld/briarHollowSite';
import { ESCORT_WAVE_COUNT } from '../../src/systems/briarHollow/EscortAmbushSystem';
import type { SiegeRig } from '../villageSiegeHarness';
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
  isInsidePalisade,
  isStraightWalk,
  merritGateTile,
  type EscortRoute,
} from '../../src/systems/briarHollow/blueprints/escortRoute';
import {
  garrisonGreen,
  type GarrisonGreen,
} from '../../src/systems/briarHollow/blueprints/garrisonGreen';
import type { BlueprintsQuestSystem } from '../../src/systems/briarHollow/BlueprintsQuestSystem';
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

// ── Out an unexpected gate ─────────────────────────────────────────────────

/** Briar Hollow has a gate in each of its four walls; the road uses one. */
const UNUSED_GATE_COUNT = 3;
/** How far past the unexpected gate's outer apron the party walks before the road is read. */
const PAST_THE_GATE_TILES = 6;
/** The rerouted trail must start within this many tiles of Midge, or of the gate she came out by. */
const TRAIL_START_NEAR_TILES = 3;
/** The party walks on only while Midge is this close behind, so she is never left. */
const WALK_ON_WITHIN_TILES = 3.5;
/** Updates the party gives Midge to catch up and cross the gate after it has. */
const CROSSING_SETTLE_UPDATES = 240;
/** Garrison Green's cart gate is in its south fence: this many tiles north of it is inside. */
const GREEN_INSIDE_TILES = 2;
/** A walk to the green that has not delivered her in this many updates has failed. */
const DELIVERY_UPDATE_BUDGET = 60 * 420;

function liveTileOf(body: { readonly x: number; readonly y: number }): TilePoint {
  return { x: Math.floor(body.x / TILE_SIZE + 0.5), y: Math.floor(body.y / TILE_SIZE + 0.5) };
}

/** The gate the planned road leaves Briar Hollow by. */
function plannedGate(site: BriarHollowSite, route: EscortRoute): BriarHollowGate | null {
  return (
    site.gates.find((gate) =>
      gate.tiles.some((gateTile) => route.tiles.some((tile) => sameTile(tile, gateTile))),
    ) ?? null
  );
}

/** A four-connected walk from `from` to `to` over the tiles `allowed` admits, shortest first; null if none. */
function walkWithin(
  map: GameMap,
  from: TilePoint,
  to: TilePoint,
  allowed: (tile: TilePoint) => boolean,
): TilePoint[] | null {
  const size = map.gridSize;
  const cameFrom = new Int32Array(size * size).fill(-1);
  const startKey = from.y * size + from.x;
  const goalKey = to.y * size + to.x;
  cameFrom[startKey] = startKey;
  const queue = [startKey];
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    if (key === goalKey) break;
    const x = key % size;
    const y = Math.floor(key / size);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { x: x + dx, y: y + dy };
      if (next.x < 0 || next.y < 0 || next.x >= size || next.y >= size) continue;
      const nextKey = next.y * size + next.x;
      if (cameFrom[nextKey] !== -1 || !isEscortStep(map, next.x, next.y) || !allowed(next)) {
        continue;
      }
      cameFrom[nextKey] = key;
      queue.push(nextKey);
    }
  }
  if (cameFrom[goalKey] === -1) return null;
  const walk: TilePoint[] = [];
  for (let key = goalKey; key !== startKey; key = cameFrom[key]) {
    walk.push({ x: key % size, y: Math.floor(key / size) });
  }
  walk.push(from);
  return walk.reverse();
}

/**
 * Walks the human (the cat at his heels) down `walk`, one tile at a time,
 * pausing whenever Midge has fallen behind. Stops early once `done` holds;
 * returns whether it did, or whether the walk was finished when `done` is null.
 */
function leadDown(
  rig: SiegeRig,
  midge: () => { readonly x: number; readonly y: number } | null,
  walk: readonly TilePoint[],
  budget: number,
  done: (() => boolean) | null,
): boolean {
  let index = 0;
  for (let update = 0; update < budget; update++) {
    if (done?.() === true) return true;
    if (index >= walk.length) return done === null;
    const cow = midge();
    const near =
      cow !== null &&
      Math.hypot(cow.x - rig.human.x, cow.y - rig.human.y) / TILE_SIZE <= WALK_ON_WITHIN_TILES;
    if (near) {
      const target = walk[index];
      const targetX = target.x * TILE_SIZE;
      const targetY = target.y * TILE_SIZE;
      const dx = targetX - rig.human.x;
      const dy = targetY - rig.human.y;
      const distance = Math.hypot(dx, dy);
      const stride = Math.min(distance, PLAYER_SPEED);
      if (distance > 0) {
        rig.human.x += (dx / distance) * stride;
        rig.human.y += (dy / distance) * stride;
      }
      if (stride === distance) index++;
    }
    rig.cat.x = rig.human.x;
    rig.cat.y = rig.human.y;
    rig.step();
  }
  return done?.() === true;
}

/**
 * Walks the human down whatever trail the guide shows, a tile at a time and
 * never faster than Midge follows, then into Garrison Green past its gate:
 * whether she was delivered within {@link DELIVERY_UPDATE_BUDGET}, and
 * whether she ever set foot on a tile `offLimits` refuses on the way.
 */
function leadAlongTheGuide(
  rig: SiegeRig,
  blueprints: BlueprintsQuestSystem,
  green: GarrisonGreen | null,
  offLimits: (tile: TilePoint) => boolean,
): { readonly delivered: boolean; readonly trespassed: boolean } {
  let trespassed = false;
  if (green === null) return { delivered: false, trespassed };
  const gate = green.gateTiles[0];
  const inside = { x: gate.x, y: gate.y - GREEN_INSIDE_TILES };
  for (let update = 0; update < DELIVERY_UPDATE_BUDGET; update++) {
    if (blueprintsPhaseAtLeast(blueprints.phase, 'midge_delivered')) {
      return { delivered: true, trespassed };
    }
    const guidance = blueprints.guidance();
    const here = liveTileOf(rig.human);
    let target: TilePoint = sameTile(here, gate) ? inside : gate;
    if (guidance?.kind === 'escort_waypoint' && guidance.trail.length > 0) {
      const trail = guidance.trail;
      let nearest = 0;
      trail.forEach((tile, index) => {
        const best = trail[nearest];
        if (
          Math.hypot(tile.x - here.x, tile.y - here.y) <
          Math.hypot(best.x - here.x, best.y - here.y)
        ) {
          nearest = index;
        }
      });
      target = trail[Math.min(trail.length - 1, nearest + 1)];
    }
    const cow = blueprints.escort.midge;
    if (cow !== null && offLimits(liveTileOf(cow))) trespassed = true;
    const near =
      cow !== null &&
      Math.hypot(cow.x - rig.human.x, cow.y - rig.human.y) / TILE_SIZE <= WALK_ON_WITHIN_TILES;
    if (near) {
      const dx = target.x * TILE_SIZE - rig.human.x;
      const dy = target.y * TILE_SIZE - rig.human.y;
      const distance = Math.hypot(dx, dy);
      const stride = Math.min(distance, PLAYER_SPEED);
      if (distance > 0) {
        rig.human.x += (dx / distance) * stride;
        rig.human.y += (dy / distance) * stride;
      }
    }
    rig.cat.x = rig.human.x;
    rig.cat.y = rig.human.y;
    rig.step();
  }
  return { delivered: blueprintsPhaseAtLeast(blueprints.phase, 'midge_delivered'), trespassed };
}

/**
 * Leads Midge out of Briar Hollow through a gate the road does not use: the
 * guide's trail is planned afresh from where she has come out, keeps out of
 * the village, is walkable for her step by step, survives a door and not a
 * rewind, and leads her all the way to Garrison Green.
 */
function verifyRerouteFromUnexpectedGate(check: Check, unusedGateIndex: number): void {
  const carry = createMidgeEscortCarry();
  // The road's ambushes are held elsewhere; here they would only scare her home mid-walk.
  carry.wavesSprung = ESCORT_WAVE_COUNT;
  const { rig, blueprints } = blueprintsRig('escort_midge', carry);
  const { map, site } = rig;
  const route = escortRouteFor(map, site);
  const start = merritGateTile(site);
  const used = route === null ? null : plannedGate(site, route);
  const other = site.gates.filter((gate) => gate !== used)[unusedGateIndex] ?? null;
  if (route === null || start === null || used === null || other === null) {
    check(false, 'the rig map has a road out of one gate, and another gate to leave by');
    rig.dispose();
    return;
  }
  const inVillage = (tile: TilePoint): boolean => isInsidePalisade(site, tile.x, tile.y);
  const gateMiddle = other.tiles[Math.floor(other.tiles.length / 2)];
  const outward = {
    x: Math.sign(other.outside.x - gateMiddle.x),
    y: Math.sign(other.outside.y - gateMiddle.y),
  };
  const beyond: TilePoint[] = [];
  for (let step = 1; step <= PAST_THE_GATE_TILES; step++) {
    const tile = {
      x: other.outside.x + outward.x * step,
      y: other.outside.y + outward.y * step,
    };
    if (!isEscortStep(map, tile.x, tile.y)) break;
    beyond.push(tile);
  }
  const toGate = walkWithin(map, start, other.inside, inVillage);
  if (toGate === null) {
    check(false, `the ${other.facing} gate can be walked to inside the village`);
    rig.dispose();
    return;
  }
  const out = [...toGate, gateMiddle, other.outside, ...beyond];

  standAt(rig.human, start.x, start.y);
  standAt(rig.cat, start.x, start.y);
  for (let update = 0; update < LIVE_PICKUP_UPDATES; update++) rig.step();
  const midge = (): { readonly x: number; readonly y: number } | null => blueprints.escort.midge;
  leadDown(rig, midge, out, DELIVERY_UPDATE_BUDGET, null);
  for (let update = 0; update < CROSSING_SETTLE_UPDATES; update++) rig.step();

  const cow = blueprints.escort.midge;
  const guidance = blueprints.guidance();
  const midgeTile = cow === null ? null : liveTileOf(cow);
  check(
    midgeTile !== null && !inVillage(midgeTile),
    `Midge follows the party out of the ${other.facing} gate (the road uses the ${used.facing})`,
  );
  if (guidance?.kind !== 'escort_waypoint' || midgeTile === null) {
    check(
      false,
      `out of the ${other.facing} gate the guide names a waypoint (${guidance?.kind ?? 'nothing'})`,
    );
    rig.dispose();
    return;
  }
  // Walked straight out past the apron, she may stand a few tiles off a road
  // that turns along the wall; the road then starts at the gate itself.
  const startsFromHerOrHerGate = (tile: TilePoint | undefined): boolean =>
    tile !== undefined &&
    (Math.hypot(tile.x - midgeTile.x, tile.y - midgeTile.y) <= TRAIL_START_NEAR_TILES ||
      other.tiles.some(
        (gateTile) =>
          Math.hypot(tile.x - gateTile.x, tile.y - gateTile.y) <= TRAIL_START_NEAR_TILES,
      ));
  const trail = guidance.trail;
  const trailStart = trail[0];
  check(
    startsFromHerOrHerGate(trailStart),
    `the trail is planned afresh from where she stands or the gate she used (trail starts at ` +
      `(${trailStart?.x ?? '-'},${trailStart?.y ?? '-'}), Midge at (${midgeTile.x},${midgeTile.y}))`,
  );
  check(
    trail.every((tile) => !inVillage(tile)) && !inVillage(guidance.at),
    'the new trail and its waypoint never lead back into the village',
  );
  const brokenStep = trail.findIndex(
    (tile, index) =>
      !isEscortStep(map, tile.x, tile.y) || (index > 0 && !isFourAdjacent(trail[index - 1], tile)),
  );
  check(
    brokenStep < 0,
    `the new trail is a walk Midge can take, step by step (breaks at ${brokenStep})`,
  );
  const green = garrisonGreen(map);
  const greenGate = green?.gateTiles[0] ?? null;
  const tilesToGreen = (tile: TilePoint): number =>
    greenGate === null ? 0 : Math.hypot(tile.x - greenGate.x, tile.y - greenGate.y);
  check(
    isStraightWalk(map, midgeTile, guidance.at) ||
      tilesToGreen(guidance.at) < tilesToGreen(midgeTile),
    'the waypoint in hand is ahead of her, not behind',
  );

  check(carry.midge !== null, 'a door visit here would carry Midge, led, on the new road');
  // A copy, so the rewind below cannot reach the record the walk goes on with.
  const behindTheDoor = blueprintsRig('escort_midge', { ...carry });
  behindTheDoor.rig.human.x = rig.human.x;
  behindTheDoor.rig.human.y = rig.human.y;
  behindTheDoor.rig.cat.x = rig.human.x;
  behindTheDoor.rig.cat.y = rig.human.y;
  behindTheDoor.rig.step();
  const afterDoor = behindTheDoor.blueprints.guidance();
  const afterDoorStart = afterDoor?.kind === 'escort_waypoint' ? afterDoor.trail[0] : undefined;
  check(
    afterDoor?.kind === 'escort_waypoint' &&
      afterDoorStart !== undefined &&
      afterDoor.trail.every((tile) => !inVillage(tile)) &&
      startsFromHerOrHerGate(afterDoorStart),
    'after a door the rebuilt quest still guides along the new road',
  );
  behindTheDoor.blueprints.onRewind();
  standAt(behindTheDoor.rig.human, start.x, start.y);
  standAt(behindTheDoor.rig.cat, start.x, start.y);
  for (let update = 0; update < LIVE_PICKUP_UPDATES; update++) behindTheDoor.rig.step();
  const afterRewind = behindTheDoor.blueprints.guidance();
  check(
    afterRewind?.kind === 'escort_waypoint' &&
      route.waypoints.some((waypoint) => sameTile(waypoint.tile, afterRewind.at)),
    `after a rewind to Merrit's gate the guide is back on the road out of the ${used.facing} gate`,
  );
  behindTheDoor.rig.dispose();

  const { delivered, trespassed } = leadAlongTheGuide(rig, blueprints, green, inVillage);
  check(
    delivered && !trespassed,
    `led along the new road, Midge is delivered to Garrison Green without going back ` +
      `through the village (${blueprints.phase}${trespassed ? ', back through the village' : ''})`,
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
    ...Array.from({ length: UNUSED_GATE_COUNT }, (_, index) => ({
      name: `Midge's road: out unexpected gate ${index + 1} of ${UNUSED_GATE_COUNT}, planned afresh from it`,
      run: () => verifyRerouteFromUnexpectedGate(check, index),
    })),
  ];
}
