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
 * Sky fowl level range. They spawned at level 1 until the difficulty pass — a
 * floor-3 creature no tougher than a floor-1 rat, on a floor whose weakest
 * regular is level 5.
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
const TROGLODYTE_DEN_POPULATION = 4;
const TROGLODYTE_MIN_LEVEL = 6;
const TROGLODYTE_MAX_LEVEL = 8;

export const level3: LevelDef = {
  id: 'level3',
  name: 'The Overworld',
  floorNumber: 3,
  music: 'bg_level_1',
  mapSize: 280,
  // Deliberately does NOT include the bounty/circus/quill/murder-mystery
  // groups: none of those systems is named anywhere in this def (they key off
  // map features like `gameMap.circusCentre`, not `LevelDef`), so a naive
  // "union every group named in this level's own fields" pass would silently
  // drop their sprite coverage. Their coverage is unioned in by level id from
  // `SYSTEM_ASSET_REQUIREMENTS` instead — see `scripts/verify-assets.ts`.
  // `dungeon_common` covers the goblin weapon-variant sheets — the permanent
  // `campSpawns.goblin` roster below depends on them directly, and that must
  // not ride on `bounty_dark_knight`'s escort-goblin coverage coincidentally
  // overlapping (a future edit to the Dark Knight's own requiredGroups could
  // silently drop it otherwise).
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
