import type { SpriteKey } from './SpriteLoader';

/**
 * Typed, build-checked declarations of which sprite sheets a floor or system
 * needs. `loadGroups` (in `SpriteLoader.ts`) uses these to lazy-load only the
 * groups a floor actually needs instead of loading every manifest entry at
 * boot, and `npm run verify:assets` cross-checks a floor/system's declared
 * coverage against what it actually spawns, catching a creature added without
 * updating the group that's supposed to cover it.
 *
 * `ASSET_GROUPS`'s values are `readonly SpriteKey[]`, not `string[]`, so a
 * renamed or deleted manifest entry fails `tsc` here instead of vanishing
 * silently at runtime.
 */
export type AssetGroup =
  | 'core'
  | 'town'
  | 'overworld'
  | 'dungeon_common'
  | 'floor1_tileset'
  | 'floor2_tileset'
  | 'boss_hoarder'
  | 'boss_grotesque_spider';

/**
 * Every creature/effect/environment sheet a group covers.
 *
 * Roughly half of `src/sprites/*` (Krasue, CircusLemur, MoldLion,
 * MissQuill, Remex, Signet, GumGum, HeatherTheBear,
 * RuinsGhoul, GrimaldiVine, InkMarauder, CityElfCultist, all
 * townsfolk) is procedural canvas drawing with no manifest entry at all — those
 * creatures cost nothing sprite-wise and deliberately have no key anywhere in
 * this file. See `MOB_SPRITE_KEYS` below for the canonical "does this mob type
 * need a sheet" answer that `verify:assets` actually checks against.
 */
export const ASSET_GROUPS: Readonly<Record<AssetGroup, readonly SpriteKey[]>> = {
  // Needed on every floor: the mercenary "bruiser" template (which draws from
  // the rock golem sheet — see Mercenary.ts), player-cast effects usable
  // anywhere, and the generic props/masks that appear in both dungeon rooms and
  // the town. The two player characters are painted rather than baked and hold
  // no key here.
  core: [
    'blood_particle',
    'blood_puddle',
    'magic_missile_icon',
    'smush_icon',
    'treasure_chests',
    'stairwell',
    'torch',
    'barrel',
    'barrel_side',
    'crate',
    'bookshelf',
    'brazier',
    'fountain',
    'well',
    'ground_masks',
    // The "find the stairwell" banner shown on entering (or re-entering) any
    // dungeon floor — not a tile sprite, just a full-screen splash image, but
    // tracked through SpriteLoader like everything else per the asset plan.
    'find-the-stairwell',
  ],

  // Level 3's town: buildings, the desperado club interior and street
  // furniture.
  town: [
    'barracks',
    'blackwood_lodge',
    'blacksmith',
    'cartwrights_workshop',
    'desperado_club',
    'general_store',
    'herb_remedy',
    'hildas_cottage',
    'horned_flagon',
    'millers_farm',
    'overworld_main_tower',
    'shepherds_cabin',
    'quiet_needle',
    'sleeping_cat_inn',
    'sunken_stump',
    'temple',
    'club_bar_counter',
    'club_bar_stool',
    'club_casino_table',
    'club_drink_shelf',
    'club_market_backdrop',
    'club_market_stall',
    'club_merc_desk',
    'club_velvet_rope',
    'club_vip_counter',
    'club_weapon_rack',
    'bunting_11',
    'bunting_16',
    'gate_arch_across_2',
    'gate_arch_across_4',
    'gate_arch_along_4',
    'laundry_line_3',
    'market_stall_back',
    'market_stall_canopy',
    'market_stall_front',
    'shop_sign',
    'street_lamp',
    'town_bench',
    'town_clutter',
    'town_notice_board',
    'over_city_fortune_teller',
    'over_city_signpost',
    'ground_overworld',
    'modern_decorations',
  ],

  // Level 3's wilderness: trees, boulders and the goblin camps.
  overworld: [
    'tree_birch_a',
    'tree_birch_b',
    'tree_birch_c',
    'tree_birch_d',
    'tree_oak_a',
    'tree_oak_b',
    'tree_oak_c',
    'tree_oak_d',
    'tree_pine_a',
    'tree_pine_b',
    'tree_pine_c',
    'tree_pine_d',
    'tree_remains',
    'boulder_large_a',
    'boulder_large_b',
    'boulder_large_c',
    'boulder_large_d',
    'boulder_large_e',
    'boulder_large_f',
    'boulder_large_g',
    'boulder_large_h',
    'boulder_small_a',
    'boulder_small_b',
    'boulder_small_c',
    'boulder_small_d',
    'boulder_small_e',
    'boulder_small_f',
    'boulder_small_g',
    'boulder_small_h',
    'campfire',
    'goblin_tent_a',
    'goblin_tent_b',
    'goblin_tent_c',
    'goblin_tent_d',
  ],

  // Shared by every dungeon floor (tutorial, level 1, level 2): the generic
  // dungeon/interior ground, and the mob types that show up in more than one
  // floor's spawn tables.
  // Floor-specific tile *palettes* are their own groups below,
  // since floor 1 and floor 2 share these five tile types but not their look
  // (`src/map/dungeon/floorTheme.ts`).
  dungeon_common: ['ground_dungeon', 'ground_interior'],

  floor1_tileset: ['ground_floor1'],
  floor2_tileset: ['ground_floor2'],

  boss_hoarder: ['hoarders_room'],
  // Level 2's spider lab: the dressing that only exists because the boss does.
  // The boss herself, her spit, the life machines, the small-spider adds and the
  // hacking mini-game's console are all painted.
  boss_grotesque_spider: ['lab_tables', 'scientist', 'spider-egg', 'spider_room_floor'],
};

/**
 * Ground truth for "does this mob type need a sheet, and which one(s)".
 *
 * Keyed by the same strings `MobSpawnRule['type']`/`MOB_REGISTRY` use, plus a
 * handful of creatures that are only ever constructed directly by a bounty or
 * quest system rather than through `createMob` (`dark_knight`, `mongo`,
 * `mercenary_bruiser`) — those never appear in a `LevelDef`'s spawn tables, so
 * they would otherwise have no ground truth for `verify:assets` to check
 * `requiredGroups` against.
 *
 * An empty array means the creature is procedural canvas art (see the note on
 * `ASSET_GROUPS` above) and needs no group at all.
 *
 */
export const MOB_SPRITE_KEYS: Readonly<Record<string, readonly SpriteKey[]>> = {
  goblin: [],
  goblin_archer: [],
  llama: [],
  rock_golem: [],
  rock_golem_boss: [],
  mantid: [],
  mantis: [],
  rat: [],
  the_hoarder: ['hoarders_room'],
  cockroach: [],
  juicer: [],
  troglodyte: [],
  tuskling: [],
  ball_of_swine: [],
  krakaren_clone: [],
  brindle_grub: [],
  bugaboo: [],
  grotesque_spider: ['lab_tables', 'scientist', 'spider-egg', 'spider_room_floor'],
  small_spider: [],
  ruins_ghoul: [],
  krasue: [],
  circus_lemur: [],
  stilt_clown: [],
  fat_clown: [],
  evil_clown: [],
  mold_lion: [],
  terror_the_clown: [],
  city_elf_cultist: [],
  skeleton_sword: [],
  skeleton_archer: [],
  skeleton_lord: [],
  the_lich: [],
  /** Painted by `skyFowlSprite.ts`, one figure per clothing palette. */
  sky_fowl: [],

  // Not in MOB_REGISTRY — constructed directly by the systems named in each
  // comment, never via `createMob`.
  /** `bountyDefs.ts`'s `DARK_KNIGHT_DEF` — painted, not baked. */
  dark_knight: [],
  /** `HeatherTheBear`, `Signet`, `MissQuill`, `Remex`, `GrimaldiVine`, `GumGum` — all procedural. */
  heather_the_bear: [],
  signet: [],
  miss_quill: [],
  remex: [],
  gum_gum: [],
  /** `MongoSystem` — a persistent companion, not a spawn-table mob; painted. */
  mongo: [],
  /** `MercenarySystem`'s "bruiser" template (`Mercenary.ts`, draws via `drawRockGolemSprite`). */
  mercenary_bruiser: [],
};
