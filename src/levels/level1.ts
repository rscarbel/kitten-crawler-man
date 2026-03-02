import type { LevelDef } from './types';

/**
 * Level 1 — "The Dungeon".
 * Rooms spawn goblins (85 %) or llamas (15 %); hallways spawn rats.
 */
export const level1: LevelDef = {
  id: 'level1',
  name: 'The Dungeon',
  mapSize: 100,
  roomMobs: [
    { type: 'goblin', chance: 0.85 },
    { type: 'llama', chance: 0.15 },
  ],
  hallwayMobs: [{ type: 'rat', chance: 1.0 }],
};
