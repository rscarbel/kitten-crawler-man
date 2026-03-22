import type { LevelDef } from './types';

/**
 * Level 1 — "The Dungeon".
 * Rooms spawn goblins (85 %) or llamas (15 %); hallways spawn rats.
 */
export const level1: LevelDef = {
  id: 'level1',
  name: 'The Dungeon',
  mapSize: 450,
  roomMobs: [
    {
      type: 'goblin',
      chance: 0.85,
      minCount: 2,
      maxCount: 4,
      minLevel: 1,
      maxLevel: 2,
    },
    {
      type: 'llama',
      chance: 0.15,
      minCount: 1,
      maxCount: 2,
      minLevel: 1,
      maxLevel: 3,
    },
  ],
  hallwayMobs: [{ type: 'rat', chance: 1.0, minLevel: 1, maxLevel: 1 }],
  bossRooms: [{ type: 'the_hoarder' }, { type: 'juicer' }],
  nextLevelId: 'level2',
  extraSpawns: [
    {
      type: 'troglodyte',
      origin: 'bossRoom:1',
      offsets: [
        [-3, -2],
        [3, -2],
        [0, 3],
      ],
    },
  ],
};
