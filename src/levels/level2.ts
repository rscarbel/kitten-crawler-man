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
 * Extra mobs per room. Floor 2 is already past the point where a crawler is
 * learning the rules, so even its opening rooms carry a bonus — and the
 * free-roam region past the Krakaren carries the floor's heaviest.
 */
const PRE_KRAKAREN_SPAWN_BONUS = 1;
const POST_KRAKAREN_SPAWN_BONUS = 2;

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

/** Goblin archers per goblin room, and the band they spawn in. */
const ARCHER_MIN_PER_ROOM = 1;
const ARCHER_MAX_PER_ROOM = 2;
const ARCHER_MIN_LEVEL = 3;
const ARCHER_MAX_LEVEL = 6;

/**
 * Boss level bands. Both bosses spawned at base stats before this — a Krakaren
 * Clone gating the floor's only forced gauntlet was weaker than the troglodytes
 * in the rooms leading to it.
 */
const KRAKAREN_MIN_LEVEL = 6;
const KRAKAREN_MAX_LEVEL = 10;
/**
 * The Ball of Swine is a level-15 borough boss in the source, and borough bosses
 * are meant to be tougher than anything else on their floor. It is also entirely
 * optional, so it is the one fight on floor 2 that can afford to sit above the
 * party's own level rather than tracking it.
 */
const BALL_OF_SWINE_MIN_LEVEL = 14;
const BALL_OF_SWINE_MAX_LEVEL = 16;

/**
 * Level 2 — "The Dungeon, Level 2".
 * Runs against the same collapse countdown as floor 1 and guards its treasure
 * rooms, and is fully populated besides: troglodytes, llamas and goblins roam
 * it, the Krakaren Clone guards the forced gauntlet, and the Ball of Swine waits
 * in the optional arena.
 */
export const level2: LevelDef = {
  id: 'level2',
  name: 'The Dungeon, Level 2',
  floorNumber: 2,
  music: 'bg_level_2',
  groundTheme: 'service_level',
  mapSize: 260,
  spriteGroups: [
    'core',
    'dungeon_common',
    'floor2_tileset',
    'boss_krakaren',
    'boss_ball_of_swine',
    'boss_grotesque_spider',
  ],
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
      // Floor 2's goblin rooms always carry archers, and up to two of them: by
      // here the player has met one and knows what it does, so the question the
      // room asks is whether they can reach it through the melee line.
      escorts: [
        {
          type: 'goblin_archer',
          minCount: ARCHER_MIN_PER_ROOM,
          maxCount: ARCHER_MAX_PER_ROOM,
          minLevel: ARCHER_MIN_LEVEL,
          maxLevel: ARCHER_MAX_LEVEL,
        },
      ],
    },
  ],
  hallwayMobs: [
    { type: 'troglodyte', chance: 0.3, minLevel: 3, maxLevel: 6 },
    { type: 'goblin', chance: 0.3, minLevel: 3, maxLevel: 6 },
    { type: 'rat', chance: 0.3, minLevel: 3, maxLevel: 6 },
  ],
  bossRooms: [
    { type: 'krakaren_clone', minLevel: KRAKAREN_MIN_LEVEL, maxLevel: KRAKAREN_MAX_LEVEL },
  ],
  progression: {
    gauntlets: [
      {
        bossType: 'krakaren_clone',
        branchCount: { min: KRAKAREN_BRANCH_MIN, max: KRAKAREN_BRANCH_MAX },
        branchRooms: { min: KRAKAREN_BRANCH_ROOMS_MIN, max: KRAKAREN_BRANCH_ROOMS_MAX },
      },
    ],
    scatterSafeRooms: LEVEL2_SCATTER_SAFE_ROOMS,
    regionSpawnBonus: [PRE_KRAKAREN_SPAWN_BONUS, POST_KRAKAREN_SPAWN_BONUS],
  },
  hasArena: true,
  hasSpiderLab: true,
  slingshotDrops: true,
  hasCollapseTimer: true,
  hasTreasureRoomGuards: true,
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
      minLevel: BALL_OF_SWINE_MIN_LEVEL,
      maxLevel: BALL_OF_SWINE_MAX_LEVEL,
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
