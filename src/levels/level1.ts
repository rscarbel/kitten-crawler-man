import type { LevelDef } from './types';

/** Goblin spawn chance (85%). */
const GOBLIN_CHANCE = 0.85;

/** Goblin count range. */
const GOBLIN_MIN = 2;
const GOBLIN_MAX = 4;

/** Goblin level range. */
const GOBLIN_MIN_LEVEL = 1;
const GOBLIN_MAX_LEVEL = 2;

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

/** Safe rooms scattered through the post-Juicer free-roam region. */
const LEVEL1_SCATTER_SAFE_ROOMS = 2;

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
  mapSize: 450,
  roomMobs: [
    {
      type: 'goblin',
      chance: GOBLIN_CHANCE,
      minCount: GOBLIN_MIN,
      maxCount: GOBLIN_MAX,
      minLevel: GOBLIN_MIN_LEVEL,
      maxLevel: GOBLIN_MAX_LEVEL,
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
  bossRooms: [{ type: 'the_hoarder' }, { type: 'juicer' }],
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
  },
  nextLevelId: 'level2',
  extraSpawns: [
    {
      type: 'troglodyte',
      origin: 'bossRoom:1',
      offsets: [
        [TROG_WEST_NW_X, TROG_WEST_NW_Y],
        [TROG_EAST_NW_X, TROG_EAST_NW_Y],
        [TROG_SOUTH_X, TROG_SOUTH_Y],
      ],
    },
  ],
};
