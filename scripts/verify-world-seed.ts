/**
 * A save can only resume the floor it was written on if the same seed rebuilds
 * the same floor. Generates each level twice from one seed and once from another,
 * and compares tiles, spawn, and safe rooms.
 *
 *   npx tsx scripts/verify-world-seed.ts
 */

import { GameMap } from '../src/map/GameMap.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level1 } from '../src/levels/level1.js';
import { level2 } from '../src/levels/level2.js';
import { level3 } from '../src/levels/level3.js';
import type { LevelDef } from '../src/levels/types.js';

const SEED = 123456789;
const OTHER_SEED = 987654321;

function fingerprint(levelDef: LevelDef, worldSeed: number): string {
  const map = new GameMap({
    mapSize: levelDef.mapSize,
    mapType: levelDef.isOverworld ? 'overworld' : 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    worldSeed,
  });
  return JSON.stringify([map.structure, map.startTile, map.safeRooms]);
}

let failures = 0;
for (const levelDef of [level1, level2, level3]) {
  const first = fingerprint(levelDef, SEED);
  const replay = fingerprint(levelDef, SEED);
  const other = fingerprint(levelDef, OTHER_SEED);
  const replays = first === replay;
  const varies = first !== other;
  if (!replays || !varies) failures++;
  console.log(`${levelDef.id}: replays=${replays} variesBySeed=${varies}`);
}

if (failures > 0) {
  console.error(`${failures} level(s) failed`);
  process.exit(1);
}
