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
  extraSpawns: [
    {
      type: 'sky_fowl',
      origin: 'mapCenter',
      offsets: [
        [-8, -5],
        [6, -7],
        [-6, 4],
        [8, 3],
        [-2, 7],
        [7, -3],
        [-5, -8],
        [3, 6],
        [-8, 2],
        [5, -4],
        [0, -8],
        [-4, -4],
      ],
    },
  ],
};
