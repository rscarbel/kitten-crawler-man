import type { LevelDef } from './types';

/**
 * Level 2 — "Safe Haven".
 * A peaceful floor with no enemies. The timer is disabled.
 * Players can rest, regroup, and prepare for future floors.
 */
export const level2: LevelDef = {
  id: 'level2',
  name: 'Safe Haven',
  mapSize: 200,
  roomMobs: [],
  hallwayMobs: [],
  bossRooms: [],
  isSafeLevel: true,
  nextLevelId: 'level3',
  numStairwells: 2,
};
