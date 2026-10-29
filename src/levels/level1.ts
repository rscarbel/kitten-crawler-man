import type { FairyRoomRate, LevelDef } from './types';
import { LEARNING_FLOOR_LEVELLED_CURVE } from '../creatures/mobLevelScaling';
import {
  FLOODED_APPROACH_DEFAULT_MIN_LENGTH_TILES,
  WIDE_CORRIDOR_WIDTH_TILES,
} from '../map/floodedApproach';

const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
/** Floor 1 is the shorter of the two timed floors — a first-time crawler's own dungeon. */
const LEVEL1_NIGHTMARE_TIME_LIMIT_MINUTES = 40;
export const LEVEL1_NIGHTMARE_TIME_LIMIT_FRAMES =
  LEVEL1_NIGHTMARE_TIME_LIMIT_MINUTES * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;

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
 * Withheld until the post-Trash Gremlin region: the opening stretch is a first-time
 * crawler's first dungeon, and a ranged enemy that punishes standing still is
 * exactly the wrong thing to meet before you have learned to walk. A zero
 * minimum means most rooms still have none — the archer should be a thing you
 * notice arriving, not the new normal.
 */
const ARCHER_MIN_PER_ROOM = 0;
const ARCHER_MAX_PER_ROOM = 1;
/** Region index 1 is the stretch between the Trash Gremlin and the Kraken. */
const ARCHER_FIRST_REGION = 1;
const ARCHER_MIN_LEVEL = 1;
const ARCHER_MAX_LEVEL = 3;

/**
 * The bomber goblins, attached to a goblin room past the Kraken and never
 * spawned on their own. Their blast takes a large share of a crawler's health,
 * so they wait until the party has had two gauntlets to learn to keep moving,
 * and a room has at most one of each: a bomber should be the thing a room is
 * remembered for, not what every room is made of.
 */
const BOMBER_MIN_PER_ROOM = 0;
const BOMBER_MAX_PER_ROOM = 1;
/** Region index 2 is the free-roam stretch past the Kraken. */
const POST_KRAKEN_REGION = 2;
const BOMBER_MIN_LEVEL = 1;
const BOMBER_MAX_LEVEL = 3;

/** Acid llama spawn chance (15%). */
const ACID_LLAMA_CHANCE = 0.15;

/** Acid llama count range. */
const ACID_LLAMA_MIN = 1;
const ACID_LLAMA_MAX = 2;

/** Acid llama level range. */
const ACID_LLAMA_MIN_LEVEL = 1;
const ACID_LLAMA_MAX_LEVEL = 3;

/** Rat spawn chance (100%). */
const RAT_CHANCE = 1.0;

/** Rat level (always level 1). */
const RAT_LEVEL = 1;

/** Branch count leaving the start room toward the Trash Gremlin's gateway. */
const TRASH_GREMLIN_BRANCH_MIN = 2;
const TRASH_GREMLIN_BRANCH_MAX = 4;

/** Rooms along each pre-Trash Gremlin branch — a short first stretch for a fresh crawler. */
const TRASH_GREMLIN_BRANCH_ROOMS_MIN = 3;
const TRASH_GREMLIN_BRANCH_ROOMS_MAX = 9;

/** Branch count leaving the Trash Gremlin's room toward the Kraken's gateway. */
const KRAKEN_BRANCH_MIN = 2;
const KRAKEN_BRANCH_MAX = 3;

/** Rooms along each branch toward the Kraken — noticeably longer than the first stretch. */
const KRAKEN_BRANCH_ROOMS_MIN = 6;
const KRAKEN_BRANCH_ROOMS_MAX = 15;

/**
 * Twice the room-count-derived default. The free region past the Kraken is large
 * enough that one stairwell per 50 rooms leaves a first-time crawler wandering.
 */
const LEVEL1_STAIRWELL_MULTIPLIER = 2;

/** Safe rooms scattered through the free-roam region past the Kraken. */
const LEVEL1_SCATTER_SAFE_ROOMS = 2;

/**
 * Extra mobs per room as the floor is cleared. The opening stretch is a fresh
 * crawler's first dungeon and stays exactly as it is; each cleared gauntlet is
 * what puts another body in the rooms beyond it.
 */
const PRE_GREMLIN_SPAWN_BONUS = 0;
const POST_GREMLIN_SPAWN_BONUS = 1;
const POST_KRAKEN_SPAWN_BONUS = 2;

/**
 * Levels added to each room band as the floor is cleared.
 *
 * A crawler reaches the Trash Gremlin around level 3 and leaves the Kraken around 7,
 * but a goblin band of 1–2 tops out against a level-3 party — so the whole back
 * half of the floor, the longest stretch of it, was fought against the same
 * level-2 goblin the first room offered. Two steps of one level put the last
 * region within reach of the numbers floor 2 opens with instead of a seven-fold
 * jump at the stairs. The opening stretch keeps its band for the same reason it
 * keeps its spawn count: it is a first-time crawler's first dungeon.
 */
const PRE_GREMLIN_LEVEL_BONUS = 0;
const POST_GREMLIN_LEVEL_BONUS = 1;
const POST_KRAKEN_LEVEL_BONUS = 2;

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
const TRASH_GREMLIN_MIN_LEVEL = 1;
const TRASH_GREMLIN_MAX_LEVEL = 4;
const KRAKEN_MIN_LEVEL = 3;
const KRAKEN_MAX_LEVEL = 7;

/**
 * The goblin mother's Fuzzy Nightmare wave. The nursery sits between the Trash Gremlin and
 * the Kraken, so it is fought by a party around level 3–5 rather than by the
 * level-7 one the encounter was first tuned against.
 */
const FUZZY_NIGHTMARE_MIN_LEVEL = 1;
const FUZZY_NIGHTMARE_MAX_LEVEL = 3;

/**
 * Fairies on the first floor. None before the Trash Gremlin, for the same reason the
 * archers wait: the opening stretch is a first-time crawler's first dungeon. A
 * room that rolls one gets exactly one, and the chance climbs past each boss.
 */
const LEVEL1_FAIRY_COUNT = 1;
const POST_GREMLIN_FAIRY_RATE: FairyRoomRate = {
  chance: { easy: 0.23, normal: 0.3, hard: 0.4 },
  minCount: { easy: LEVEL1_FAIRY_COUNT, normal: LEVEL1_FAIRY_COUNT, hard: LEVEL1_FAIRY_COUNT },
  maxCount: { easy: LEVEL1_FAIRY_COUNT, normal: LEVEL1_FAIRY_COUNT, hard: LEVEL1_FAIRY_COUNT },
};
const POST_KRAKEN_FAIRY_RATE: FairyRoomRate = {
  chance: { easy: 0.3, normal: 0.4, hard: 0.65 },
  minCount: { easy: LEVEL1_FAIRY_COUNT, normal: LEVEL1_FAIRY_COUNT, hard: LEVEL1_FAIRY_COUNT },
  maxCount: { easy: LEVEL1_FAIRY_COUNT, normal: LEVEL1_FAIRY_COUNT, hard: LEVEL1_FAIRY_COUNT },
};
/** Floor 1 never rolls a room healer. */
const LEVEL1_ROOM_HEALER_CHANCE = 0;

/**
 * Level 1 — "The Dungeon".
 * Rooms spawn goblins (85 %) or acid llamas (15 %); hallways spawn rats.
 */
export const level1: LevelDef = {
  id: 'level1',
  music: 'bg_level_1',
  name: 'The Dungeon',
  floorNumber: 1,
  arrivalLoadingScreen: {
    tips: [
      'The Trash Gremlin and then the Kraken stand between you and the stairwells.',
      'Something big has flooded the pump room. Wade carefully, and watch the water.',
      'A safe room saves your run, and a death returns you to your last save.',
      'The doctor in each safe room patches you up for free: full health, ailments cured.',
      'Other crawlers have painted signs on the walls. They point toward the stairwell.',
      'Treasure rooms are guarded. Clear the guards before you reach for the chest.',
    ],
  },
  groundTheme: 'cellars',
  mapSize: 450,
  spriteGroups: [
    'core',
    'dungeon_common',
    'floor1_tileset',
    'boss_trash_gremlin',
    'boss_flooded_pump_room',
  ],
  interiorSpriteGroups: [],
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
        {
          type: 'goblin_dynamiter',
          minCount: BOMBER_MIN_PER_ROOM,
          maxCount: BOMBER_MAX_PER_ROOM,
          minRegion: POST_KRAKEN_REGION,
          minLevel: BOMBER_MIN_LEVEL,
          maxLevel: BOMBER_MAX_LEVEL,
        },
        {
          type: 'goblin_bombardier',
          minCount: BOMBER_MIN_PER_ROOM,
          maxCount: BOMBER_MAX_PER_ROOM,
          minRegion: POST_KRAKEN_REGION,
          minLevel: BOMBER_MIN_LEVEL,
          maxLevel: BOMBER_MAX_LEVEL,
        },
      ],
    },
    {
      type: 'acid_llama',
      chance: ACID_LLAMA_CHANCE,
      minCount: ACID_LLAMA_MIN,
      maxCount: ACID_LLAMA_MAX,
      minLevel: ACID_LLAMA_MIN_LEVEL,
      maxLevel: ACID_LLAMA_MAX_LEVEL,
    },
  ],
  hallwayMobs: [{ type: 'rat', chance: RAT_CHANCE, minLevel: RAT_LEVEL, maxLevel: RAT_LEVEL }],
  bossRooms: [
    {
      type: 'trash_gremlin',
      minLevel: TRASH_GREMLIN_MIN_LEVEL,
      maxLevel: TRASH_GREMLIN_MAX_LEVEL,
    },
    { type: 'kraken', minLevel: KRAKEN_MIN_LEVEL, maxLevel: KRAKEN_MAX_LEVEL },
  ],
  progression: {
    gauntlets: [
      {
        bossType: 'trash_gremlin',
        route: {
          kind: 'branches',
          branchCount: { min: TRASH_GREMLIN_BRANCH_MIN, max: TRASH_GREMLIN_BRANCH_MAX },
          branchRooms: { min: TRASH_GREMLIN_BRANCH_ROOMS_MIN, max: TRASH_GREMLIN_BRANCH_ROOMS_MAX },
        },
      },
      {
        bossType: 'kraken',
        route: {
          kind: 'branches',
          branchCount: { min: KRAKEN_BRANCH_MIN, max: KRAKEN_BRANCH_MAX },
          branchRooms: { min: KRAKEN_BRANCH_ROOMS_MIN, max: KRAKEN_BRANCH_ROOMS_MAX },
        },
        // The goblin mother's nursery is the one room every crawler crosses
        // between the Trash Gremlin and the Kraken, on the sealed stem out of
        // the Trash Gremlin's room: the flooded approach leaves no room for it
        // in front of the Kraken's door.
        questChoke: true,
        approach: {
          kind: 'flooded',
          minLengthTiles: FLOODED_APPROACH_DEFAULT_MIN_LENGTH_TILES,
          widthTiles: WIDE_CORRIDOR_WIDTH_TILES,
        },
      },
    ],
    scatterSafeRooms: LEVEL1_SCATTER_SAFE_ROOMS,
    outskirtsSafeRoomHops: true,
    regionSpawnBonus: [PRE_GREMLIN_SPAWN_BONUS, POST_GREMLIN_SPAWN_BONUS, POST_KRAKEN_SPAWN_BONUS],
    regionLevelBonus: [PRE_GREMLIN_LEVEL_BONUS, POST_GREMLIN_LEVEL_BONUS, POST_KRAKEN_LEVEL_BONUS],
  },
  defendQuestWave: { minLevel: FUZZY_NIGHTMARE_MIN_LEVEL, maxLevel: FUZZY_NIGHTMARE_MAX_LEVEL },
  fairies: {
    roomRatesByRegion: [null, POST_GREMLIN_FAIRY_RATE, POST_KRAKEN_FAIRY_RATE],
    roomHealerChance: LEVEL1_ROOM_HEALER_CHANCE,
  },
  // Floor 1 keeps the curve it was tuned on when the shared one was flattened
  // for the deeper floors, so none of its fights got easier with them.
  levelledCurve: LEARNING_FLOOR_LEVELLED_CURVE,
  nightmareTimeLimitFrames: LEVEL1_NIGHTMARE_TIME_LIMIT_FRAMES,
  hasTreasureRoomGuards: true,
  nextLevelId: 'level2',
  stairwellCountMultiplier: LEVEL1_STAIRWELL_MULTIPLIER,
  xpDiminishingTiers: [
    { minPlayerLevel: LEVEL1_XP_HALF_LEVEL, multiplier: LEVEL1_XP_HALF_MULTIPLIER },
    { minPlayerLevel: LEVEL1_XP_QUARTER_LEVEL, multiplier: LEVEL1_XP_QUARTER_MULTIPLIER },
    { minPlayerLevel: LEVEL1_XP_TRICKLE_LEVEL, multiplier: LEVEL1_XP_TRICKLE_MULTIPLIER },
  ],
};
