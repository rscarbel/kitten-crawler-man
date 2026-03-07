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
  bossRooms: [],
  hasArena: true,
  isSafeLevel: true,
  nextLevelId: 'level3',
  numStairwells: 2,
};
