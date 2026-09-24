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
/**
 * The stairwell menu's recommended arrival level for floor 3, shown instead
 * of the value the ambient mob bands below would otherwise imply. Raising
 * that implied number the honest way means raising every ambient mob's level
 * cap — nearly doubling them — which is a much bigger difficulty change than
 * the advice text alone was meant to make, so the advice is decoupled here
 * via `recommendedLevelOverride` instead.
 */
const FLOOR3_RECOMMENDED_LEVEL = 24;

/**
 * How high the overworld's ambient mobs may follow a party that out-levels the
 * bands below. A party arrives here already past every band's top, so without
 * this the whole floor met it several levels behind and fell further behind as
 * it grew. Held two levels under the level cap because that is the last level
 * at which every tactics trait is still short of its maximum chance, which is
 * where bounty escorts, not ordinary mobs, are meant to take it.
 */
const FLOOR3_AMBIENT_TRACKING_MAX_LEVEL = 18;
/**
 * How far under the party's earned level the overworld's tracked mobs sit.
 * Stepping onto the overworld is the steepest jump in the game — every band's
 * top is several levels under what the party has earned — so without a step
 * back the first roaming pair a badly built party meets would cost it nearly
 * its whole bar. The gap closes on its own once the party's earned level
 * passes {@link FLOOR3_AMBIENT_TRACKING_MAX_LEVEL} by this much.
 */
const FLOOR3_AMBIENT_TRACKING_LEVELS_BEHIND = 2;

/**
 * The overworld's diminishing-returns curve. Without one, its quests and
 * endlessly repeatable bounties carried a party from the mid-twenties to
 * levels no mob can follow, since tracking stops at
 * {@link FLOOR3_AMBIENT_TRACKING_MAX_LEVEL}. The tiers start a few levels past
 * the point where that ceiling is reached, so the ambient mobs, camps and
 * quests still level a party that plays through them, and grinding past it
 * slows to a crawl.
 */
const FLOOR3_XP_HALF_LEVEL = 30;
const FLOOR3_XP_QUARTER_LEVEL = 32;
const FLOOR3_XP_TENTH_LEVEL = 34;
const FLOOR3_XP_HALF_MULTIPLIER = 0.5;
const FLOOR3_XP_QUARTER_MULTIPLIER = 0.25;
const FLOOR3_XP_TENTH_MULTIPLIER = 0.1;

/**
 * Sky fowl level range, kept in line with the floor's weakest regular so this
 * floor-3 creature isn't as fragile as a floor-1 rat.
 */
const SKY_FOWL_MIN_LEVEL = 5;
const SKY_FOWL_MAX_LEVEL = 7;

/** Ruins ghoul level range — common shambler encountered outside town. */
const RUINS_GHOUL_MIN_LEVEL = 5;
const RUINS_GHOUL_MAX_LEVEL = 8;

/** Krasue level range — uncommon, faster and more dangerous than a ghoul. */
const KRASUE_MIN_LEVEL = 6;
const KRASUE_MAX_LEVEL = 9;

/**
 * The camps' residents.
 *
 * Additions to the floor, not a redistribution of it: `hallwayMobs` and its ~150
 * scatter points are untouched, so ruins ghouls and krasues stay the dominant
 * population and a camp is a landmark you find among them.
 */
const GOBLIN_CAMP_POPULATION = 5;
const GOBLIN_CAMP_ARCHERS = 2;
const GOBLIN_MIN_LEVEL = 5;
const GOBLIN_MAX_LEVEL = 7;
/**
 * Kept small: a troglodyte's cost to the party grows with every other one
 * alive beside it, and the den's size is what keeps it a hard fight rather
 * than one the party cannot finish. `verify:difficulty-curve` prices the den
 * whole.
 */
const TROGLODYTE_DEN_POPULATION = 3;
const TROGLODYTE_MIN_LEVEL = 6;
const TROGLODYTE_MAX_LEVEL = 8;

/**
 * Fairies beside the wilderness's ambient enemies: one per scatter point that
 * rolls it, and separately a healer. The town and the circus grounds never get
 * one.
 */
const FLOOR3_FAIRY_SCATTER_CHANCE = { easy: 0.23, normal: 0.27, hard: 0.35 } as const;
const FLOOR3_FAIRY_SCATTER_HEALER_CHANCE = 0.2;

export const level3: LevelDef = {
  id: 'level3',
  name: 'The Overworld',
  floorNumber: 3,
  music: 'bg_level_1',
  mapSize: 280,
  recommendedLevelOverride: FLOOR3_RECOMMENDED_LEVEL,
  ambientTracking: {
    maxLevel: FLOOR3_AMBIENT_TRACKING_MAX_LEVEL,
    levelsBehind: FLOOR3_AMBIENT_TRACKING_LEVELS_BEHIND,
  },
  xpDiminishingTiers: [
    { minPlayerLevel: FLOOR3_XP_HALF_LEVEL, multiplier: FLOOR3_XP_HALF_MULTIPLIER },
    { minPlayerLevel: FLOOR3_XP_QUARTER_LEVEL, multiplier: FLOOR3_XP_QUARTER_MULTIPLIER },
    { minPlayerLevel: FLOOR3_XP_TENTH_LEVEL, multiplier: FLOOR3_XP_TENTH_MULTIPLIER },
  ],
  // Deliberately does NOT include the bounty/circus/quill/murder-mystery
  // groups: none of those systems is named anywhere in this def (they key off
  // map features like `gameMap.circusCentre`, not `LevelDef`), so a naive
  // "union every group named in this level's own fields" pass would silently
  // drop their sprite coverage. Their coverage is unioned in by level id from
  // `SYSTEM_ASSET_REQUIREMENTS` instead — see `scripts/verify-assets.ts`.
  spriteGroups: ['core', 'town', 'overworld', 'dungeon_common'],
  roomMobs: [],
  hallwayMobs: [
    {
      type: 'ruins_ghoul',
      chance: 0.75,
      minLevel: RUINS_GHOUL_MIN_LEVEL,
      maxLevel: RUINS_GHOUL_MAX_LEVEL,
    },
    { type: 'krasue', chance: 0.25, minLevel: KRASUE_MIN_LEVEL, maxLevel: KRASUE_MAX_LEVEL },
  ],
  bossRooms: [],
  isOverworld: true,
  slingshotDrops: true,
  fairies: {
    roomRatesByRegion: [],
    roomHealerChance: 0,
    scatterChance: FLOOR3_FAIRY_SCATTER_CHANCE,
    scatterHealerChance: FLOOR3_FAIRY_SCATTER_HEALER_CHANCE,
  },
  campSpawns: {
    goblin: [
      {
        type: 'goblin',
        minLevel: GOBLIN_MIN_LEVEL,
        maxLevel: GOBLIN_MAX_LEVEL,
        minCount: GOBLIN_CAMP_POPULATION,
        maxCount: GOBLIN_CAMP_POPULATION,
      },
      // A camp roster spawns every entry, so the archers are never alone here
      // by construction — the five melee residents above are their line.
      {
        type: 'goblin_archer',
        minCount: GOBLIN_CAMP_ARCHERS,
        maxCount: GOBLIN_CAMP_ARCHERS,
        minLevel: GOBLIN_MIN_LEVEL,
        maxLevel: GOBLIN_MAX_LEVEL,
      },
    ],
    troglodyte: [
      {
        type: 'troglodyte',
        minLevel: TROGLODYTE_MIN_LEVEL,
        maxLevel: TROGLODYTE_MAX_LEVEL,
        minCount: TROGLODYTE_DEN_POPULATION,
        maxCount: TROGLODYTE_DEN_POPULATION,
      },
    ],
  },
  extraSpawns: [
    {
      type: 'sky_fowl',
      origin: 'mapCenter',
      minLevel: SKY_FOWL_MIN_LEVEL,
      maxLevel: SKY_FOWL_MAX_LEVEL,
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
