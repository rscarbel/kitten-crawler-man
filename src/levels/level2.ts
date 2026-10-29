import type { EscortSpawnRule, ExtraSpawnOrigin, FairyRoomRate, LevelDef } from './types';
import { FLOOR_TWO_DEFEND_QUEST_INTENSITY } from './defendQuestIntensity';

const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
const LEVEL2_NIGHTMARE_TIME_LIMIT_MINUTES = 60;
export const LEVEL2_NIGHTMARE_TIME_LIMIT_FRAMES =
  LEVEL2_NIGHTMARE_TIME_LIMIT_MINUTES * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;

/** Branch count leaving the start room toward the Current Goblin's gateway. */
const ELECTRIC_GOBLIN_BRANCH_MIN = 2;
const ELECTRIC_GOBLIN_BRANCH_MAX = 3;

/** Rooms along each branch toward the Current Goblin. */
const ELECTRIC_GOBLIN_BRANCH_ROOMS_MIN = 3;
const ELECTRIC_GOBLIN_BRANCH_ROOMS_MAX = 9;

/**
 * The clogged bathroom seated halfway along each branch toward the Current Goblin. The
 * largest chain room, so it seats at the same pitch as any other room on the
 * branch.
 */
const BATHROOM_ROOM_W = 14;
const BATHROOM_ROOM_H = 12;

/**
 * The stealth gate room halfway along the spine. The largest chain room, so it
 * seats at the spine's pitch and leaves north wall either side of a doorway
 * for the prison door.
 */
const STEALTH_GATE_ROOM_W = 14;
const STEALTH_GATE_ROOM_H = 12;

/**
 * Rooms walked between the Current Goblin's exit and Big Rooster's gateway.
 *
 * The two are only a few dozen tiles apart on a compact floor, so this is a
 * contract about the *walk*: the chain winds to earn its length rather than
 * spanning the distance.
 */
const SPINE_ROOMS_MIN = 12;
const SPINE_ROOMS_MAX = 16;

/**
 * Rooms past Big Rooster's gym: a short stretch to find the floor's two
 * stairwells in, not a second floor's worth of rooms after its last boss.
 */
const FREE_REGION_ROOMS = 18;

/** Places on the chain that fork into a second lane and reconverge. */
const SPINE_SPLITS_MIN = 1;
const SPINE_SPLITS_MAX = 2;

/**
 * Extra mobs per room. Floor 2 is already past the point where a crawler is
 * learning the rules, so even its opening rooms carry a bonus — and the forced
 * chain past the Current Goblin and the rooms past Big Rooster carry the
 * floor's heaviest, which is what keeps a one-way journey of a dozen rooms from
 * thinning out as it goes.
 */
const PRE_ELECTRIC_GOBLIN_SPAWN_BONUS = 1;
const POST_ELECTRIC_GOBLIN_SPAWN_BONUS = 2;
const POST_BIG_ROOSTER_SPAWN_BONUS = 2;

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
 * Level band shared by every ordinary floor-2 mob — lizardmen, acid llamas,
 * goblins and their archer escorts, in rooms and hallways alike. Tuned so
 * the floor's ambient ceiling lands the recommended arrival level at 10.
 */
const AMBIENT_MIN_LEVEL = 4;
const AMBIENT_MAX_LEVEL = 7;

/**
 * Boss and quest XP bring a thorough party down these stairs well past the
 * recommended arrival level, and it keeps growing here while the band above
 * holds every room at level 7. Each few levels it pulls ahead buys each room
 * another body instead, up to a limit that keeps a room a fight rather than
 * a wall.
 */
const OVER_LEVEL_LEVELS_PER_BODY = 3;
const OVER_LEVEL_MAX_BODIES = 3;

/** Goblin archers per goblin room, and the band they spawn in. */
const ARCHER_MIN_PER_ROOM = 1;
const ARCHER_MAX_PER_ROOM = 2;
const ARCHER_MIN_LEVEL = AMBIENT_MIN_LEVEL;
const ARCHER_MAX_LEVEL = AMBIENT_MAX_LEVEL;

/**
 * A goblin room's own melee goblins. The floor plus the room's full back line —
 * both archers and both bombers — fits under the per-room cap, so neither kind
 * of escort is the one silently dropped; in a busy room the reserved escorts
 * crowd the melee count down toward this floor.
 */
const GOBLIN_ROOM_MIN = 3;
const GOBLIN_ROOM_MAX = 5;

/**
 * The bomber goblins, alongside goblins wherever they spawn: up to one of each
 * with a goblin room or a hallway goblin, so a lone bomber is never what a
 * room is made of.
 */
const BOMBER_MIN_PER_GROUP = 0;
const BOMBER_MAX_PER_GROUP = 1;
const BOMBER_ESCORTS: EscortSpawnRule[] = [
  {
    type: 'goblin_dynamiter',
    minCount: BOMBER_MIN_PER_GROUP,
    maxCount: BOMBER_MAX_PER_GROUP,
    minLevel: AMBIENT_MIN_LEVEL,
    maxLevel: AMBIENT_MAX_LEVEL,
  },
  {
    type: 'goblin_bombardier',
    minCount: BOMBER_MIN_PER_GROUP,
    maxCount: BOMBER_MAX_PER_GROUP,
    minLevel: AMBIENT_MIN_LEVEL,
    maxLevel: AMBIENT_MAX_LEVEL,
  },
];

/**
 * The goblin mother's Fuzzy Nightmare wave on this floor. A choke on the spine past the
 * Current Goblin is crossed by a party well past the level floor 1's nursery is fought
 * at, so the same base-stat body would be a formality here.
 */
const FUZZY_NIGHTMARE_MIN_LEVEL = 4;
const FUZZY_NIGHTMARE_MAX_LEVEL = 7;

/**
 * Boss level bands. The Current Goblin gates the floor's first gauntlet and is
 * levelled to stay tougher than the lizardmen in the rooms leading to it.
 * Big Rooster closes the floor, so his band is the top of its curve.
 */
const ELECTRIC_GOBLIN_MIN_LEVEL = 6;
const ELECTRIC_GOBLIN_MAX_LEVEL = 10;
const BIG_ROOSTER_MIN_LEVEL = 12;
const BIG_ROOSTER_MAX_LEVEL = 15;

/**
 * Little Rooster and Slightly Bent Rooster, guarding Big Rooster's gym, levelled
 * a step under him so the gauntlet boss isn't guarded by creatures stronger
 * than himself, and above the spine leading up to it.
 */
const ROOSTER_FLOCK_LEVELS_UNDER_BOSS = 2;
const ROOSTER_FLOCK_MIN_LEVEL = BIG_ROOSTER_MIN_LEVEL - ROOSTER_FLOCK_LEVELS_UNDER_BOSS;
const ROOSTER_FLOCK_MAX_LEVEL = BIG_ROOSTER_MAX_LEVEL - ROOSTER_FLOCK_LEVELS_UNDER_BOSS;

/** Little Rooster's post, west-northwest of the gym's centre. */
const LITTLE_ROOSTER_OFFSET_X = -3;
const LITTLE_ROOSTER_OFFSET_Y = -2;

/** Slightly Bent Rooster's post, east-northwest of the gym's centre. */
const BENT_ROOSTER_OFFSET_X = 3;
const BENT_ROOSTER_OFFSET_Y = -2;

const BIG_ROOSTER_BOSS_ROOM_ORIGIN = {
  kind: 'bossRoom',
  bossType: 'big_rooster',
} as const satisfies ExtraSpawnOrigin;

/** Fairy count bounds on floor 2, excluding any healer. */
const LEVEL2_FAIRY_MIN = 1;
const LEVEL2_FAIRY_MAX = 2;
const LEVEL2_HARD_FAIRY_MAX = 3;
/**
 * Once Big Rooster is dead, a hard room past his gym holds at least two
 * fairies: a lone one there is no longer possible.
 */
const POST_BIG_ROOSTER_HARD_FAIRY_MIN = 2;

const PRE_ELECTRIC_GOBLIN_FAIRY_RATE: FairyRoomRate = {
  chance: { easy: 0.45, normal: 0.55, hard: 0.75 },
  minCount: { easy: LEVEL2_FAIRY_MIN, normal: LEVEL2_FAIRY_MIN, hard: LEVEL2_FAIRY_MIN },
  maxCount: { easy: LEVEL2_FAIRY_MAX, normal: LEVEL2_FAIRY_MAX, hard: LEVEL2_FAIRY_MAX },
};
const POST_ELECTRIC_GOBLIN_FAIRY_RATE: FairyRoomRate = {
  chance: { easy: 0.55, normal: 0.65, hard: 0.9 },
  minCount: { easy: LEVEL2_FAIRY_MIN, normal: LEVEL2_FAIRY_MIN, hard: LEVEL2_FAIRY_MIN },
  maxCount: { easy: LEVEL2_FAIRY_MAX, normal: LEVEL2_FAIRY_MAX, hard: LEVEL2_HARD_FAIRY_MAX },
};
const POST_BIG_ROOSTER_FAIRY_RATE: FairyRoomRate = {
  chance: { easy: 0.65, normal: 0.85, hard: 1 },
  minCount: {
    easy: LEVEL2_FAIRY_MIN,
    normal: LEVEL2_FAIRY_MIN,
    hard: POST_BIG_ROOSTER_HARD_FAIRY_MIN,
  },
  maxCount: { easy: LEVEL2_FAIRY_MAX, normal: LEVEL2_FAIRY_MAX, hard: LEVEL2_HARD_FAIRY_MAX },
};
/** Region index 2 is the free region past Big Rooster's gym, where the stairwells are. */
const POST_BIG_ROOSTER_REGION = 2;
/** Flat on every difficulty and in every region, rolled apart from the room's other fairies. */
const LEVEL2_ROOM_HEALER_CHANCE = 0.2;

/**
 * Level 2 — "The Dungeon, Level 2".
 * Timed on Nightmare like floor 1, guards its treasure rooms, and is fully
 * populated besides: lizardmen, acid llamas and goblins roam
 * it, the Current Goblin guards the first gauntlet, and past him a single
 * winding chain of rooms — the goblin mother's nursery among them, and the
 * spider lab hanging off it — runs to Big Rooster's gym, past which lie the
 * stairwells.
 */
export const level2: LevelDef = {
  id: 'level2',
  name: 'The Dungeon, Level 2',
  floorNumber: 2,
  arrivalLoadingScreen: {
    tips: [
      'A goblin wired to a generator holds the power lab. Stay out of the puddles.',
      'Past the power lab, a long chain of rooms leads to Big Rooster and his gym.',
      'A spider lab hangs off the chain of rooms. Something large has made it home.',
      'Fairies heal the monsters around them. Bring the healer down first.',
      'A safe room saves your run, and a death returns you to your last save.',
    ],
  },
  music: 'bg_level_2',
  groundTheme: 'service_level',
  mapSize: 300,
  overLevelReinforcement: {
    levelsPerBody: OVER_LEVEL_LEVELS_PER_BODY,
    maxBodies: OVER_LEVEL_MAX_BODIES,
  },
  spriteGroups: [
    'core',
    'dungeon_common',
    'floor2_tileset',
    'boss_power_lab',
    'boss_grotesque_spider',
    'boss_big_rooster',
  ],
  // The prison under this floor paints its own ground (`PrisonGround`) from
  // this floor's tileset.
  interiorSpriteGroups: [],
  roomMobs: [
    {
      type: 'lizardman',
      chance: 0.4,
      minCount: 1,
      maxCount: 3,
      minLevel: AMBIENT_MIN_LEVEL,
      maxLevel: AMBIENT_MAX_LEVEL,
    },
    {
      type: 'acid_llama',
      chance: 0.35,
      minCount: 1,
      maxCount: 3,
      minLevel: AMBIENT_MIN_LEVEL,
      maxLevel: AMBIENT_MAX_LEVEL,
    },
    {
      type: 'goblin',
      chance: 0.25,
      minCount: GOBLIN_ROOM_MIN,
      maxCount: GOBLIN_ROOM_MAX,
      minLevel: AMBIENT_MIN_LEVEL,
      maxLevel: AMBIENT_MAX_LEVEL,
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
        ...BOMBER_ESCORTS,
      ],
    },
  ],
  hallwayMobs: [
    { type: 'lizardman', chance: 0.3, minLevel: AMBIENT_MIN_LEVEL, maxLevel: AMBIENT_MAX_LEVEL },
    {
      type: 'goblin',
      chance: 0.3,
      minLevel: AMBIENT_MIN_LEVEL,
      maxLevel: AMBIENT_MAX_LEVEL,
      escorts: BOMBER_ESCORTS,
    },
    { type: 'rat', chance: 0.3, minLevel: AMBIENT_MIN_LEVEL, maxLevel: AMBIENT_MAX_LEVEL },
  ],
  bossRooms: [
    {
      type: 'electric_goblin',
      minLevel: ELECTRIC_GOBLIN_MIN_LEVEL,
      maxLevel: ELECTRIC_GOBLIN_MAX_LEVEL,
    },
    { type: 'big_rooster', minLevel: BIG_ROOSTER_MIN_LEVEL, maxLevel: BIG_ROOSTER_MAX_LEVEL },
  ],
  progression: {
    gauntlets: [
      {
        bossType: 'electric_goblin',
        route: {
          kind: 'branches',
          branchCount: { min: ELECTRIC_GOBLIN_BRANCH_MIN, max: ELECTRIC_GOBLIN_BRANCH_MAX },
          branchRooms: {
            min: ELECTRIC_GOBLIN_BRANCH_ROOMS_MIN,
            max: ELECTRIC_GOBLIN_BRANCH_ROOMS_MAX,
          },
          bathroomChoke: { w: BATHROOM_ROOM_W, h: BATHROOM_ROOM_H },
        },
      },
      {
        bossType: 'big_rooster',
        route: {
          kind: 'spine',
          rooms: { min: SPINE_ROOMS_MIN, max: SPINE_ROOMS_MAX },
          splits: { min: SPINE_SPLITS_MIN, max: SPINE_SPLITS_MAX },
          stealthGate: { w: STEALTH_GATE_ROOM_W, h: STEALTH_GATE_ROOM_H },
        },
      },
    ],
    // No scatterSafeRooms: the spine's safe-access pockets come entirely from
    // its own mandatory pocket count, not a configured minimum.
    freeRegionRooms: FREE_REGION_ROOMS,
    regionSpawnBonus: [
      PRE_ELECTRIC_GOBLIN_SPAWN_BONUS,
      POST_ELECTRIC_GOBLIN_SPAWN_BONUS,
      POST_BIG_ROOSTER_SPAWN_BONUS,
    ],
  },
  hasSpiderLab: true,
  defendQuestWave: { minLevel: FUZZY_NIGHTMARE_MIN_LEVEL, maxLevel: FUZZY_NIGHTMARE_MAX_LEVEL },
  defendQuestIntensity: FLOOR_TWO_DEFEND_QUEST_INTENSITY,
  fairies: {
    roomRatesByRegion: [
      PRE_ELECTRIC_GOBLIN_FAIRY_RATE,
      POST_ELECTRIC_GOBLIN_FAIRY_RATE,
      POST_ELECTRIC_GOBLIN_FAIRY_RATE,
    ],
    roomHealerChance: LEVEL2_ROOM_HEALER_CHANCE,
    upgrades: [
      {
        bossType: 'big_rooster',
        region: POST_BIG_ROOSTER_REGION,
        rate: POST_BIG_ROOSTER_FAIRY_RATE,
        onlyPastItsSafeRoom: true,
      },
    ],
  },
  worldGearDrops: true,
  nightmareTimeLimitFrames: LEVEL2_NIGHTMARE_TIME_LIMIT_FRAMES,
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
      type: 'little_rooster',
      origin: BIG_ROOSTER_BOSS_ROOM_ORIGIN,
      minLevel: ROOSTER_FLOCK_MIN_LEVEL,
      maxLevel: ROOSTER_FLOCK_MAX_LEVEL,
      offsets: [[LITTLE_ROOSTER_OFFSET_X, LITTLE_ROOSTER_OFFSET_Y]],
    },
    {
      type: 'slightly_bent_rooster',
      origin: BIG_ROOSTER_BOSS_ROOM_ORIGIN,
      minLevel: ROOSTER_FLOCK_MIN_LEVEL,
      maxLevel: ROOSTER_FLOCK_MAX_LEVEL,
      offsets: [[BENT_ROOSTER_OFFSET_X, BENT_ROOSTER_OFFSET_Y]],
    },
  ],
  onMobKilledSpawns: [
    {
      type: 'gravedigger_beetle',
      minCount: 1,
      maxCount: 5,
      spreadRadius: 2,
    },
  ],
};
