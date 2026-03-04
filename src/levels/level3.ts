import type { LevelDef } from './types';

/**
 * Level 3 — "The Overworld".
 * An outdoor world with grass, forests, roads, and a town.
 * The town has a large tower and many smaller buildings that can be entered.
 */
export const level3: LevelDef = {
  id: 'level3',
  name: 'The Overworld',
  mapSize: 280,
  roomMobs: [],
  hallwayMobs: [],
  bossRooms: [],
  isSafeLevel: true,
  isOverworld: true,
};
