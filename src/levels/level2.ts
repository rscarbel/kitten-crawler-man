import type { LevelDef } from './types';

/** Branch count leaving the start room toward the Krakaren Clone's gateway. */
const KRAKAREN_BRANCH_MIN = 2;
const KRAKAREN_BRANCH_MAX = 3;

/** Rooms along each pre-Krakaren branch. */
const KRAKAREN_BRANCH_ROOMS_MIN = 3;
const KRAKAREN_BRANCH_ROOMS_MAX = 9;

/** Safe rooms scattered through the post-Krakaren free-roam region. */
const LEVEL2_SCATTER_SAFE_ROOMS = 1;

/**
 * Where floor 2's XP starts drying up, set well above floor 1's curve so a
 * party that descends on schedule never notices it.
 */
const LEVEL2_XP_HALF_LEVEL = 19;
const LEVEL2_XP_THIRD_LEVEL = 21;
const LEVEL2_XP_FIFTH_LEVEL = 24;
const LEVEL2_XP_HALF_MULTIPLIER = 0.5;
const LEVEL2_XP_THIRD_MULTIPLIER = 0.3;
const LEVEL2_XP_FIFTH_MULTIPLIER = 0.2;

/**
 * Level 2 — "The Dungeon, Level 2".
 * Runs without a countdown timer and skips treasure-room guards, but is fully
 * populated: troglodytes, llamas and goblins roam it, the Krakaren Clone guards
 * the forced gauntlet, and the Ball of Swine waits in the optional arena.
 */
export const level2: LevelDef = {
  id: 'level2',
  name: 'The Dungeon, Level 2',
  floorNumber: 2,
  music: 'bg_level_2',
  groundTheme: 'service_level',
  mapSize: 260,
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
  progression: {
    gauntlets: [
      {
        bossType: 'krakaren_clone',
        branchCount: { min: KRAKAREN_BRANCH_MIN, max: KRAKAREN_BRANCH_MAX },
        branchRooms: { min: KRAKAREN_BRANCH_ROOMS_MIN, max: KRAKAREN_BRANCH_ROOMS_MAX },
      },
    ],
    scatterSafeRooms: LEVEL2_SCATTER_SAFE_ROOMS,
  },
  hasArena: true,
  hasSpiderLab: true,
  isSafeLevel: true,
  nextLevelId: 'level3',
  numStairwells: 2,
  xpDiminishingTiers: [
    { minPlayerLevel: LEVEL2_XP_HALF_LEVEL, multiplier: LEVEL2_XP_HALF_MULTIPLIER },
    { minPlayerLevel: LEVEL2_XP_THIRD_LEVEL, multiplier: LEVEL2_XP_THIRD_MULTIPLIER },
    { minPlayerLevel: LEVEL2_XP_FIFTH_LEVEL, multiplier: LEVEL2_XP_FIFTH_MULTIPLIER },
  ],
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
    },
  ],
};
