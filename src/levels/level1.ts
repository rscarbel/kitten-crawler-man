import type { LevelDef } from './types';

/** Goblin spawn chance (85%). */
const GOBLIN_CHANCE = 0.85;

/** Goblin count range. */
const GOBLIN_MIN = 2;
const GOBLIN_MAX = 4;

/** Goblin level range. */
const GOBLIN_MIN_LEVEL = 1;
const GOBLIN_MAX_LEVEL = 2;

/**
 * Goblin archers, attached to a goblin room and never spawned on their own.
 *
 * Withheld until the post-Hoarder region: the opening stretch is a first-time
 * crawler's first dungeon, and a ranged enemy that punishes standing still is
 * exactly the wrong thing to meet before you have learned to walk. A zero
 * minimum means most rooms still have none — the archer should be a thing you
 * notice arriving, not the new normal.
 */
const ARCHER_MIN_PER_ROOM = 0;
const ARCHER_MAX_PER_ROOM = 1;
/** Region index 1 is the stretch between the Hoarder and the Juicer. */
const ARCHER_FIRST_REGION = 1;
const ARCHER_MIN_LEVEL = 1;
const ARCHER_MAX_LEVEL = 3;

/** Llama spawn chance (15%). */
const LLAMA_CHANCE = 0.15;

/** Llama count range. */
const LLAMA_MIN = 1;
const LLAMA_MAX = 2;

/** Llama level range. */
const LLAMA_MIN_LEVEL = 1;
const LLAMA_MAX_LEVEL = 3;

/** Rat spawn chance (100%). */
const RAT_CHANCE = 1.0;

/** Rat level (always level 1). */
const RAT_LEVEL = 1;

/** Branch count leaving the start room toward the Hoarder's gateway. */
const HOARDER_BRANCH_MIN = 2;
const HOARDER_BRANCH_MAX = 4;

/** Rooms along each pre-Hoarder branch — a short first stretch for a fresh crawler. */
const HOARDER_BRANCH_ROOMS_MIN = 3;
const HOARDER_BRANCH_ROOMS_MAX = 9;

/** Branch count leaving the Hoarder's room toward the Juicer's gateway. */
const JUICER_BRANCH_MIN = 2;
const JUICER_BRANCH_MAX = 3;

/** Rooms along each pre-Juicer branch — noticeably longer than the first stretch. */
const JUICER_BRANCH_ROOMS_MIN = 6;
const JUICER_BRANCH_ROOMS_MAX = 15;

/**
 * Twice the room-count-derived default. The post-Juicer free region is large
 * enough that one stairwell per 50 rooms leaves a first-time crawler wandering.
 */
const LEVEL1_STAIRWELL_MULTIPLIER = 2;

/** Safe rooms scattered through the post-Juicer free-roam region. */
const LEVEL1_SCATTER_SAFE_ROOMS = 2;

/**
 * Extra mobs per room as the floor is cleared. The opening stretch is a fresh
 * crawler's first dungeon and stays exactly as it is; each cleared gauntlet is
 * what puts another body in the rooms beyond it.
 */
const PRE_HOARDER_SPAWN_BONUS = 0;
const POST_HOARDER_SPAWN_BONUS = 1;
const POST_JUICER_SPAWN_BONUS = 2;

/**
 * Where floor 1's XP starts drying up. A crawler who clears both gauntlets
 * lands around level 10, so everything past that is grinding a floor whose
 * mobs the party has already outgrown.
 */
const LEVEL1_XP_HALF_LEVEL = 10;
const LEVEL1_XP_QUARTER_LEVEL = 12;
const LEVEL1_XP_TRICKLE_LEVEL = 15;
const LEVEL1_XP_HALF_MULTIPLIER = 0.5;
const LEVEL1_XP_QUARTER_MULTIPLIER = 0.25;
const LEVEL1_XP_TRICKLE_MULTIPLIER = 0.1;

/**
 * Boss level bands. The first crawler to reach either boss meets it at the
 * band's floor; a party that comes back over-levelled meets it nearer the
 * ceiling, which is what keeps a revisited floor 1 from being a walk without
 * letting a first encounter outgrow its own tuning.
 */
const HOARDER_MIN_LEVEL = 1;
const HOARDER_MAX_LEVEL = 4;
const JUICER_MIN_LEVEL = 3;
const JUICER_MAX_LEVEL = 7;

/**
 * The troglodytes guarding the Juicer's gateway. They used to spawn at level 1,
 * which put weaker creatures outside the second gauntlet boss than inside the
 * rooms leading up to it.
 */
const JUICER_GUARD_MIN_LEVEL = 2;
const JUICER_GUARD_MAX_LEVEL = 3;

/** Troglodyte west-northwest offset. */
const TROG_WEST_NW_X = -3;
const TROG_WEST_NW_Y = -2;

/** Troglodyte east-northwest offset. */
const TROG_EAST_NW_X = 3;
const TROG_EAST_NW_Y = -2;

/** Troglodyte south offset. */
const TROG_SOUTH_X = 0;
const TROG_SOUTH_Y = 3;

/**
 * Level 1 — "The Dungeon".
 * Rooms spawn goblins (85 %) or llamas (15 %); hallways spawn rats.
 */
export const level1: LevelDef = {
  id: 'level1',
  music: 'bg_level_1',
  name: 'The Dungeon',
  floorNumber: 1,
  groundTheme: 'cellars',
  mapSize: 450,
  spriteGroups: ['core', 'dungeon_common', 'floor1_tileset', 'boss_hoarder', 'boss_juicer'],
  roomMobs: [
    {
      type: 'goblin',
      chance: GOBLIN_CHANCE,
      minCount: GOBLIN_MIN,
      maxCount: GOBLIN_MAX,
      minLevel: GOBLIN_MIN_LEVEL,
      maxLevel: GOBLIN_MAX_LEVEL,
      escorts: [
        {
          type: 'goblin_archer',
          minCount: ARCHER_MIN_PER_ROOM,
          maxCount: ARCHER_MAX_PER_ROOM,
          minRegion: ARCHER_FIRST_REGION,
          minLevel: ARCHER_MIN_LEVEL,
          maxLevel: ARCHER_MAX_LEVEL,
        },
      ],
    },
    {
      type: 'llama',
      chance: LLAMA_CHANCE,
      minCount: LLAMA_MIN,
      maxCount: LLAMA_MAX,
      minLevel: LLAMA_MIN_LEVEL,
      maxLevel: LLAMA_MAX_LEVEL,
    },
  ],
  hallwayMobs: [{ type: 'rat', chance: RAT_CHANCE, minLevel: RAT_LEVEL, maxLevel: RAT_LEVEL }],
  bossRooms: [
    {
      type: 'the_hoarder',
      minLevel: HOARDER_MIN_LEVEL,
      maxLevel: HOARDER_MAX_LEVEL,
    },
    { type: 'juicer', minLevel: JUICER_MIN_LEVEL, maxLevel: JUICER_MAX_LEVEL },
  ],
  progression: {
    gauntlets: [
      {
        bossType: 'the_hoarder',
        branchCount: { min: HOARDER_BRANCH_MIN, max: HOARDER_BRANCH_MAX },
        branchRooms: { min: HOARDER_BRANCH_ROOMS_MIN, max: HOARDER_BRANCH_ROOMS_MAX },
      },
      {
        bossType: 'juicer',
        branchCount: { min: JUICER_BRANCH_MIN, max: JUICER_BRANCH_MAX },
        branchRooms: { min: JUICER_BRANCH_ROOMS_MIN, max: JUICER_BRANCH_ROOMS_MAX },
      },
    ],
    scatterSafeRooms: LEVEL1_SCATTER_SAFE_ROOMS,
    regionSpawnBonus: [PRE_HOARDER_SPAWN_BONUS, POST_HOARDER_SPAWN_BONUS, POST_JUICER_SPAWN_BONUS],
  },
  hasCollapseTimer: true,
  hasTreasureRoomGuards: true,
  nextLevelId: 'level2',
  stairwellCountMultiplier: LEVEL1_STAIRWELL_MULTIPLIER,
  xpDiminishingTiers: [
    { minPlayerLevel: LEVEL1_XP_HALF_LEVEL, multiplier: LEVEL1_XP_HALF_MULTIPLIER },
    { minPlayerLevel: LEVEL1_XP_QUARTER_LEVEL, multiplier: LEVEL1_XP_QUARTER_MULTIPLIER },
    { minPlayerLevel: LEVEL1_XP_TRICKLE_LEVEL, multiplier: LEVEL1_XP_TRICKLE_MULTIPLIER },
  ],
  extraSpawns: [
    {
      type: 'troglodyte',
      origin: 'bossRoom:1',
      minLevel: JUICER_GUARD_MIN_LEVEL,
      maxLevel: JUICER_GUARD_MAX_LEVEL,
      offsets: [
        [TROG_WEST_NW_X, TROG_WEST_NW_Y],
        [TROG_EAST_NW_X, TROG_EAST_NW_Y],
        [TROG_SOUTH_X, TROG_SOUTH_Y],
      ],
    },
  ],
};
