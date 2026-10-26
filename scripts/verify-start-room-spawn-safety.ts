#!/usr/bin/env tsx
/**
 * A crawler must not be pulled into a fight while a floor's arrival beat is
 * still playing. Room-based spawns already respect this — mobs only seed into
 * rooms with role `'regular'`/`'chain'`, never `'start'` — but hallway spawn
 * points used to sit anywhere at least `MIN_FROM_ROOM` tiles from a room's
 * *centre*, which a rectangular start room can fail near its corners while
 * still being only a step off its own wall.
 *
 * This generates many maps for every level and asserts no hallway spawn point
 * lands inside the start room's bounds plus
 * `START_ROOM_HALLWAY_SPAWN_MARGIN_TILES`.
 *
 * The same holds for whatever a hallway point brings with it: every mob
 * `spawnForLevel` sets down outside a populated room — a hallway mob or one
 * of its escorts — must stand outside every room (a boss room, a quest room,
 * a safe room) and outside the start room's margin.
 *
 * Run: npx tsx scripts/verify-start-room-spawn-safety.ts
 */
import {
  generateDungeon,
  START_ROOM_HALLWAY_SPAWN_MARGIN_TILES,
  type DungeonData,
} from '../src/map/DungeonGenerator';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level1 } from '../src/levels/level1';
import { level2 } from '../src/levels/level2';
import type { LevelDef } from '../src/levels/types';
import { GameMap } from '../src/map/GameMap';
import { TILE_SIZE } from '../src/core/constants';
import { DIFFICULTY_PROFILES } from '../src/core/difficulty/difficultyProfiles';
import { roomSpawnBounds, spawnForLevel } from '../src/levels/spawner';
import { mulberry32 } from '../src/sprites/person/rng';

/** Populated maps per floor for the hallway check: generating and filling one is the slow part. */
const POPULATED_MAPS_PER_FLOOR = 25;
/** A mid-floor party, inside every band either floor authors. */
const POPULATED_PARTY_LEVEL = 8;
const POPULATED_SEED_BASE = 0x5a1e;
/** Offset from a body's origin to the tile under its centre, as a share of a tile. */
const BODY_CENTRE_SHARE = 0.5;

/** Maps generated per floor. */
const RUNS_PER_FLOOR = 40;

let failures = 0;

function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

/**
 * The start room's tile bounds. `progressionLayout.startRoom` is set on every
 * forced-progression floor; a free-roam floor's start room is instead the tile
 * neighbourhood around `startTile`, since it carves no rectangular room record
 * of its own.
 */
function startRoomBounds(data: DungeonData): { x: number; y: number; w: number; h: number } {
  if (data.progressionLayout?.startRoom !== undefined) return data.progressionLayout.startRoom;
  const FREE_ROAM_START_HALF_WIDTH = 3;
  return {
    x: data.startTile.x - FREE_ROAM_START_HALF_WIDTH,
    y: data.startTile.y - FREE_ROAM_START_HALF_WIDTH,
    w: FREE_ROAM_START_HALF_WIDTH * 2,
    h: FREE_ROAM_START_HALF_WIDTH * 2,
  };
}

function checkFloor(name: string, levelDef: LevelDef): void {
  const options = { ...dungeonOptionsForLevel(levelDef), size: levelDef.mapSize };
  let violations = 0;
  let generated = 0;
  let generationErrors = 0;
  for (let run = 0; run < RUNS_PER_FLOOR; run++) {
    let data: DungeonData;
    try {
      data = generateDungeon(options);
    } catch {
      // A rejected layout is the generator's own retry budget speaking, not a
      // spawn-safety failure — skip it rather than counting it against this check.
      generationErrors++;
      continue;
    }
    generated++;
    const room = startRoomBounds(data);
    const minX = room.x - START_ROOM_HALLWAY_SPAWN_MARGIN_TILES;
    const maxX = room.x + room.w + START_ROOM_HALLWAY_SPAWN_MARGIN_TILES;
    const minY = room.y - START_ROOM_HALLWAY_SPAWN_MARGIN_TILES;
    const maxY = room.y + room.h + START_ROOM_HALLWAY_SPAWN_MARGIN_TILES;
    for (const point of data.hallwaySpawnPoints) {
      if (point.x >= minX && point.x < maxX && point.y >= minY && point.y < maxY) {
        violations++;
      }
    }
  }
  check(generated > 0, `${name}: at least one seed generated (${generationErrors} rejected)`);
  check(
    violations === 0,
    `${name}: no hallway spawn point lands in the start room plus margin (${violations} found across ${generated} seeds)`,
  );
}

/**
 * Every mob a populated map sets down outside its populated rooms stands
 * outside every room and the start room's margin.
 */
function checkPopulatedFloor(name: string, levelDef: LevelDef, floorIndex: number): void {
  const random = Math.random;
  let outsideRooms = 0;
  let strays = 0;
  for (let run = 0; run < POPULATED_MAPS_PER_FLOOR; run++) {
    Math.random = mulberry32(POPULATED_SEED_BASE + floorIndex * POPULATED_MAPS_PER_FLOOR + run);
    let map: GameMap;
    try {
      map = new GameMap({
        mapSize: levelDef.mapSize,
        tileHeight: TILE_SIZE,
        mapType: 'dungeon',
        dungeon: dungeonOptionsForLevel(levelDef),
      });
    } catch {
      continue;
    }
    const populated = map.mobSpawnPoints.map((point) => roomSpawnBounds(point));
    const [firstRoom] = map.roomBounds;
    const start = map.progressionLayout?.startRoom ?? firstRoom;
    const mobs = spawnForLevel(
      levelDef,
      map,
      POPULATED_PARTY_LEVEL,
      DIFFICULTY_PROFILES.normal,
      new Set(),
      Math.random,
    );
    for (const mob of mobs) {
      const tileX = Math.floor(mob.x / TILE_SIZE + BODY_CENTRE_SHARE);
      const tileY = Math.floor(mob.y / TILE_SIZE + BODY_CENTRE_SHARE);
      const inPopulatedRoom = populated.some(
        (b) => tileX >= b.minTX && tileX <= b.maxTX && tileY >= b.minTY && tileY <= b.maxTY,
      );
      // A boss is set down at its own room's centre on purpose.
      if (inPopulatedRoom || mob.isBoss) continue;
      outsideRooms++;
      const inStartMargin =
        start !== undefined &&
        tileX >= start.x - START_ROOM_HALLWAY_SPAWN_MARGIN_TILES &&
        tileX < start.x + start.w + START_ROOM_HALLWAY_SPAWN_MARGIN_TILES &&
        tileY >= start.y - START_ROOM_HALLWAY_SPAWN_MARGIN_TILES &&
        tileY < start.y + start.h + START_ROOM_HALLWAY_SPAWN_MARGIN_TILES;
      if (inStartMargin || map.roomIndexAt(tileX, tileY) !== -1) strays++;
    }
  }
  Math.random = random;
  check(
    outsideRooms > 0,
    `${name}: hallway mobs were spawned for the check to see (${outsideRooms})`,
  );
  check(
    strays === 0,
    `${name}: no hallway mob or escort stands in a room or the start room's margin (${strays} across ${POPULATED_MAPS_PER_FLOOR} maps)`,
  );
}

checkFloor('level1', level1);
checkFloor('level2', level2);
checkPopulatedFloor('level1', level1, 0);
checkPopulatedFloor('level2', level2, 1);

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
