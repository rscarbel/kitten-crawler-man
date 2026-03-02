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
    { type: 'goblin', chance: 0.85, minCount: 2, maxCount: 4 },
    { type: 'llama', chance: 0.15, minCount: 1, maxCount: 2 },
  ],
  hallwayMobs: [{ type: 'rat', chance: 1.0 }],
  bossRooms: [{ type: 'the_hoarder' }],
};
