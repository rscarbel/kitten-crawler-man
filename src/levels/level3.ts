import type { LevelDef } from './types';

/** SkyFowl spawn position 1 (west-northwest). */
const SKYF_1_X = -8;
const SKYF_1_Y = -5;

/** SkyFowl spawn position 2 (east-northeast). */
const SKYF_2_X = 6;
const SKYF_2_Y = -7;

/** SkyFowl spawn position 3 (west-south). */
const SKYF_3_X = -6;
const SKYF_3_Y = 4;

/** SkyFowl spawn position 4 (east-south). */
const SKYF_4_X = 8;
const SKYF_4_Y = 3;

/** SkyFowl spawn position 5 (west-south). */
const SKYF_5_X = -2;
const SKYF_5_Y = 7;

/** SkyFowl spawn position 6 (east-north). */
const SKYF_6_X = 7;
const SKYF_6_Y = -3;

/** SkyFowl spawn position 7 (west-northwest). */
const SKYF_7_X = -5;
const SKYF_7_Y = -8;

/** SkyFowl spawn position 8 (east-south). */
const SKYF_8_X = 3;
const SKYF_8_Y = 6;

/** SkyFowl spawn position 9 (west-center). */
const SKYF_9_X = -8;
const SKYF_9_Y = 2;

/** SkyFowl spawn position 10 (east-north). */
const SKYF_10_X = 5;
const SKYF_10_Y = -4;

/** SkyFowl spawn position 11 (center-north). */
const SKYF_11_X = 0;
const SKYF_11_Y = -8;

/** SkyFowl spawn position 12 (west-northwest). */
const SKYF_12_X = -4;
const SKYF_12_Y = -4;

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
        [SKYF_1_X, SKYF_1_Y],
        [SKYF_2_X, SKYF_2_Y],
        [SKYF_3_X, SKYF_3_Y],
        [SKYF_4_X, SKYF_4_Y],
        [SKYF_5_X, SKYF_5_Y],
        [SKYF_6_X, SKYF_6_Y],
        [SKYF_7_X, SKYF_7_Y],
        [SKYF_8_X, SKYF_8_Y],
        [SKYF_9_X, SKYF_9_Y],
        [SKYF_10_X, SKYF_10_Y],
        [SKYF_11_X, SKYF_11_Y],
        [SKYF_12_X, SKYF_12_Y],
      ],
    },
  ],
};
