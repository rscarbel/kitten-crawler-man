#!/usr/bin/env tsx
/**
 * A stairwell belongs to the crawlers. A mob's own steps are refused onto one,
 * so a mob that starts inside a footprint, or is routed or shoved into one,
 * stands there for the rest of the floor.
 *
 * Over many seeded floor-1 and floor-2 maps this checks that:
 * - no mob the floor's spawners place (rooms, hallways, treasure guards,
 *   landmark spawns) starts on a stairwell tile, and the spawn-tile search
 *   finds nothing inside a footprint even when that is all it is offered;
 * - a mob set down inside a footprint walks out of it in every open direction;
 * - a mob walking or shoved at a footprint from outside never ends up in it;
 * - a mob's route past a stairwell goes around the footprint, not through it.
 *
 * Run: npm run verify:stairwell-mobs
 */
import { TILE_SIZE } from '../src/core/constants.js';
import { DIFFICULTY_PROFILES } from '../src/core/difficulty/difficultyProfiles.js';
import type { Mob } from '../src/creatures/Mob.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level1 } from '../src/levels/level1.js';
import { level2 } from '../src/levels/level2.js';
import {
  findWalkableSpawnTile,
  roomSpawnBounds,
  spawnExtraMobs,
  spawnForLevel,
  spawnTreasureRoomMobs,
  type SpawnBounds,
} from '../src/levels/spawner.js';
import { liveSpawnContext, spawnMob } from '../src/levels/spawnFunnel.js';
import type { LevelDef } from '../src/levels/types.js';
import { STAIRWELL_FOOTPRINT_SPAN } from '../src/map/DungeonGenerator.js';
import { GameMap } from '../src/map/GameMap.js';
import { mulberry32 } from '../src/sprites/person/rng.js';

/** Maps generated per floor. */
const RUNS_PER_FLOOR = 30;
/** Keeps floor 2's seeds clear of floor 1's, so a printed seed names one map. */
const SEED_STRIDE_PER_FLOOR = 10_000;
/** Spawn-tile draws per stairwell room: enough that a footprint is hit often if it is allowed. */
const SPAWN_DRAWS_PER_ROOM = 200;
/** Frames a test mob walks or is pushed for. Far longer than crossing a footprint takes. */
const WALK_FRAMES = 600;
/** Pixels asked of each frame's push; `applySeparation` caps it at the mob's own step. */
const PUSH_PX_PER_FRAME = 4;
/** Party level the spawners level against; any level exercises the same placement. */
const SPAWN_PARTY_LEVEL = 1;
/** Tiles beyond a footprint's edge that must be open before an escape that way is fair to ask for. */
const ESCAPE_CLEARANCE_TILES = 2;
const TILE_CENTRE_FRACTION = 0.5;

interface Tile {
  readonly x: number;
  readonly y: number;
}

const DIRECTIONS: readonly Tile[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Individual failures printed before the rest are only counted, so one bad rule cannot bury the summary. */
const MAX_PRINTED_FAILURES = 12;

let failures = 0;
let printedFailures = 0;

function check(ok: boolean, message: string): void {
  if (ok) return;
  failures++;
  if (printedFailures >= MAX_PRINTED_FAILURES) return;
  printedFailures++;
  console.log(` FAIL  ${message}`);
}

function report(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

function centreTileOf(mob: Mob): Tile {
  return {
    x: Math.floor((mob.x + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
    y: Math.floor((mob.y + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
  };
}

function footprintOf(stairwell: Tile): Tile[] {
  const tiles: Tile[] = [];
  for (let dy = 0; dy < STAIRWELL_FOOTPRINT_SPAN; dy++) {
    for (let dx = 0; dx < STAIRWELL_FOOTPRINT_SPAN; dx++) {
      tiles.push({ x: stairwell.x + dx, y: stairwell.y + dy });
    }
  }
  return tiles;
}

function inFootprint(stairwell: Tile, tile: Tile): boolean {
  return (
    tile.x >= stairwell.x &&
    tile.x < stairwell.x + STAIRWELL_FOOTPRINT_SPAN &&
    tile.y >= stairwell.y &&
    tile.y < stairwell.y + STAIRWELL_FOOTPRINT_SPAN
  );
}

function walk(mob: Mob, direction: Tile, onFrame: (mob: Mob) => void): void {
  for (let frame = 0; frame < WALK_FRAMES; frame++) {
    mob.applySeparation(direction.x * PUSH_PX_PER_FRAME, direction.y * PUSH_PX_PER_FRAME);
    onFrame(mob);
  }
}

interface FloorTally {
  spawnedMobs: number;
  mobsOnStairwells: number;
  mobsInStairwellRooms: number;
  spawnDrawsOnStairwells: number;
  footprintOnlySearchesFound: number;
  escapesTried: number;
  escapesFailed: number;
  entriesTried: number;
  entriesSucceeded: number;
  shovesIn: number;
  routesTried: number;
  routesThroughStairwell: number;
  routesMissing: number;
}

function boundsHold(bounds: SpawnBounds, tile: Tile): boolean {
  return (
    tile.x >= bounds.minTX &&
    tile.x <= bounds.maxTX &&
    tile.y >= bounds.minTY &&
    tile.y <= bounds.maxTY
  );
}

function checkSpawns(levelDef: LevelDef, map: GameMap, seed: number, tally: FloorTally): void {
  const profile = DIFFICULTY_PROFILES.normal;
  const mobs = [
    ...spawnForLevel(levelDef, map, SPAWN_PARTY_LEVEL, profile, new Set(), Math.random),
    ...spawnExtraMobs(levelDef, map, SPAWN_PARTY_LEVEL, profile, Math.random),
    ...(levelDef.hasTreasureRoomGuards === true
      ? spawnTreasureRoomMobs(
          map.treasureRooms,
          levelDef,
          map,
          SPAWN_PARTY_LEVEL,
          profile,
          Math.random,
        )
      : []),
  ];
  tally.spawnedMobs += mobs.length;
  const stairwellRooms = map.mobSpawnPoints
    .map((point) => roomSpawnBounds(point))
    .filter((bounds) => map.stairwellTiles.some((stairwell) => boundsHold(bounds, stairwell)));
  for (const mob of mobs) {
    const tile = centreTileOf(mob);
    const onStairwell = map.isStairwellTile(tile.x, tile.y);
    if (onStairwell) tally.mobsOnStairwells++;
    check(
      !onStairwell,
      `seed ${seed}: ${mob.displayName} spawned on stairwell tile (${tile.x},${tile.y})`,
    );
    const besideStairwell = stairwellRooms.some((bounds) => boundsHold(bounds, tile));
    if (besideStairwell) tally.mobsInStairwellRooms++;
  }

  for (const bounds of stairwellRooms) {
    for (let draw = 0; draw < SPAWN_DRAWS_PER_ROOM; draw++) {
      const tile = findWalkableSpawnTile(map, bounds, Math.random);
      if (tile !== null && map.isStairwellTile(tile.x, tile.y)) tally.spawnDrawsOnStairwells++;
    }
  }

  for (const stairwell of map.stairwellTiles) {
    const footprintOnly = {
      minTX: stairwell.x,
      minTY: stairwell.y,
      maxTX: stairwell.x + STAIRWELL_FOOTPRINT_SPAN - 1,
      maxTY: stairwell.y + STAIRWELL_FOOTPRINT_SPAN - 1,
    };
    if (findWalkableSpawnTile(map, footprintOnly, Math.random) !== null)
      tally.footprintOnlySearchesFound++;
  }
}

/** Whether the tiles just past the footprint's edge, on `tile`'s row or column, are open floor. */
function escapeIsOpen(map: GameMap, stairwell: Tile, tile: Tile, direction: Tile): boolean {
  const edgeX =
    direction.x > 0
      ? stairwell.x + STAIRWELL_FOOTPRINT_SPAN - 1
      : direction.x < 0
        ? stairwell.x
        : tile.x;
  const edgeY =
    direction.y > 0
      ? stairwell.y + STAIRWELL_FOOTPRINT_SPAN - 1
      : direction.y < 0
        ? stairwell.y
        : tile.y;
  for (let step = 1; step <= ESCAPE_CLEARANCE_TILES; step++) {
    if (!map.isWalkable(edgeX + direction.x * step, edgeY + direction.y * step)) return false;
  }
  return true;
}

function checkMovement(map: GameMap, seed: number, tally: FloorTally): void {
  for (const stairwell of map.stairwellTiles) {
    for (const tile of footprintOf(stairwell)) {
      for (const direction of DIRECTIONS) {
        if (!escapeIsOpen(map, stairwell, tile, direction)) continue;
        tally.escapesTried++;
        const mob = spawnMob(
          'goblin',
          { x: tile.x, y: tile.y },
          map,
          liveSpawnContext('dev:spawn'),
        );
        walk(mob, direction, () => undefined);
        const end = centreTileOf(mob);
        if (inFootprint(stairwell, end)) {
          tally.escapesFailed++;
          check(
            false,
            `seed ${seed}: a goblin set down on (${tile.x},${tile.y}) walking (${direction.x},${direction.y}) never left the stairwell`,
          );
        }

        const outside = { x: tile.x - direction.x, y: tile.y - direction.y };
        if (inFootprint(stairwell, outside) || !map.isMobSpawnTile(outside.x, outside.y)) continue;
        tally.entriesTried++;
        const walker = spawnMob(
          'goblin',
          { x: outside.x, y: outside.y },
          map,
          liveSpawnContext('dev:spawn'),
        );
        let entered = false;
        walk(walker, direction, (m) => {
          if (map.isStairwellTile(centreTileOf(m).x, centreTileOf(m).y)) entered = true;
        });
        if (entered) {
          tally.entriesSucceeded++;
          check(
            false,
            `seed ${seed}: a goblin walked from (${outside.x},${outside.y}) into the stairwell`,
          );
        }

        const shoved = spawnMob(
          'goblin',
          { x: outside.x, y: outside.y },
          map,
          liveSpawnContext('dev:spawn'),
        );
        shoved.shoveTo(tile.x * TILE_SIZE, tile.y * TILE_SIZE);
        const landing = centreTileOf(shoved);
        if (map.isStairwellTile(landing.x, landing.y)) {
          tally.shovesIn++;
          check(
            false,
            `seed ${seed}: a shove carried a goblin from (${outside.x},${outside.y}) onto the stairwell`,
          );
        }
      }
    }

    const west = { x: stairwell.x - 1, y: stairwell.y };
    const east = { x: stairwell.x + STAIRWELL_FOOTPRINT_SPAN, y: stairwell.y };
    const inside = {
      x: stairwell.x + STAIRWELL_FOOTPRINT_SPAN - 1,
      y: stairwell.y + STAIRWELL_FOOTPRINT_SPAN - 1,
    };
    const northWest = { x: stairwell.x - 1, y: stairwell.y - 1 };
    for (const [from, to] of [
      [west, east],
      [inside, northWest],
    ] as const) {
      if (!map.isMobSpawnTile(to.x, to.y)) continue;
      tally.routesTried++;
      const route = map.findMobPath(from.x, from.y, to.x, to.y, undefined, true);
      if (route.length === 0) {
        tally.routesMissing++;
        check(false, `seed ${seed}: no mob route from (${from.x},${from.y}) to (${to.x},${to.y})`);
        continue;
      }
      const crossesStairwell = route.slice(1).some((step) => map.isStairwellTile(step.x, step.y));
      if (crossesStairwell) {
        tally.routesThroughStairwell++;
        check(
          false,
          `seed ${seed}: the mob route from (${from.x},${from.y}) to (${to.x},${to.y}) crosses the stairwell`,
        );
      }
    }
  }
}

function verifyFloor(levelDef: LevelDef, floorIndex: number): void {
  console.log(`\n── ${levelDef.id} (${levelDef.name}) ──`);
  const tally: FloorTally = {
    spawnedMobs: 0,
    mobsOnStairwells: 0,
    mobsInStairwellRooms: 0,
    spawnDrawsOnStairwells: 0,
    footprintOnlySearchesFound: 0,
    escapesTried: 0,
    escapesFailed: 0,
    entriesTried: 0,
    entriesSucceeded: 0,
    shovesIn: 0,
    routesTried: 0,
    routesThroughStairwell: 0,
    routesMissing: 0,
  };
  let stairwells = 0;
  for (let run = 0; run < RUNS_PER_FLOOR; run++) {
    const seed = floorIndex * SEED_STRIDE_PER_FLOOR + run;
    Math.random = mulberry32(seed);
    const map = new GameMap({
      mapSize: levelDef.mapSize,
      tileHeight: TILE_SIZE,
      mapType: 'dungeon',
      dungeon: dungeonOptionsForLevel(levelDef),
    });
    stairwells += map.stairwellTiles.length;
    checkSpawns(levelDef, map, seed, tally);
    checkMovement(map, seed, tally);
  }

  report(stairwells > 0, `${stairwells} stairwells generated over ${RUNS_PER_FLOOR} seeds`);
  report(
    tally.spawnedMobs > 0 && tally.mobsOnStairwells === 0,
    `no spawned mob starts on a stairwell (${tally.mobsOnStairwells} of ${tally.spawnedMobs})`,
  );
  report(
    tally.mobsInStairwellRooms > 0,
    `mobs were placed beside a stairwell in its own room, so the spawn check saw one (${tally.mobsInStairwellRooms})`,
  );
  report(
    tally.spawnDrawsOnStairwells === 0,
    `the spawn-tile search never picks a stairwell tile in a stairwell room (${tally.spawnDrawsOnStairwells} picks)`,
  );
  report(
    tally.footprintOnlySearchesFound === 0,
    `a search offered only a footprint finds nothing (${tally.footprintOnlySearchesFound} found a tile)`,
  );
  report(
    tally.escapesTried > 0 && tally.escapesFailed === 0,
    `a mob inside a footprint walks out (${tally.escapesFailed} of ${tally.escapesTried} stayed)`,
  );
  report(
    tally.entriesTried > 0 && tally.entriesSucceeded === 0,
    `a mob walking at a footprint never steps in (${tally.entriesSucceeded} of ${tally.entriesTried})`,
  );
  report(tally.shovesIn === 0, `a shove never lands a mob on a stairwell (${tally.shovesIn})`);
  report(
    tally.routesTried > 0 && tally.routesThroughStairwell === 0 && tally.routesMissing === 0,
    `mob routes past a stairwell go around it (${tally.routesThroughStairwell} cross, ${tally.routesMissing} missing, of ${tally.routesTried})`,
  );
}

verifyFloor(level1, 1);
verifyFloor(level2, 2);

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
