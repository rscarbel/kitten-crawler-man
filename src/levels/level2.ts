import type { LevelDef } from './types';

/**
 * Level 2 — "Safe Haven".
 * A peaceful floor with no enemies. The timer is disabled.
 * Players can rest, regroup, and prepare for future floors.
 */
export const level2: LevelDef = {
  id: 'level2',
  name: 'The Dungeon, Level 2',
  mapSize: 200,
  roomMobs: [
    {
      type: 'troglodyte',
      chance: 0.4,
      minCount: 1,
      maxCount: 3,
      minLevel: 3,
      maxLevel: 6,
    },
    {
      type: 'llama',
      chance: 0.35,
      minCount: 1,
      maxCount: 3,
      minLevel: 3,
      maxLevel: 6,
    },
    {
      type: 'goblin',
      chance: 0.25,
      minCount: 3,
      maxCount: 5,
      minLevel: 3,
      maxLevel: 6,
    },
  ],
  hallwayMobs: [
    { type: 'troglodyte', chance: 0.3, minLevel: 3, maxLevel: 6 },
    { type: 'goblin', chance: 0.3, minLevel: 3, maxLevel: 6 },
    { type: 'rat', chance: 0.3, minLevel: 3, maxLevel: 6 },
  ],
  bossRooms: [{ type: 'krakaren_clone' }],
  hasArena: true,
  isSafeLevel: true,
  nextLevelId: 'level3',
  numStairwells: 2,
  extraSpawns: [
    {
      type: 'ball_of_swine',
      origin: 'arena:0',
      offsets: [[0, 0]],
      setup: 'setupBallOfSwine',
    },
  ],
  onMobKilledSpawns: [
    {
      type: 'brindle_grub',
      minCount: 1,
      maxCount: 5,
      spreadRadius: 2,
      excludeKilledTypes: ['BrindleGrub'],
    },
  ],
};
