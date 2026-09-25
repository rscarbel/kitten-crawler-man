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

checkFloor('level1', level1);
checkFloor('level2', level2);

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
