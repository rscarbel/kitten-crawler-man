import type { SpriteKey } from './SpriteLoader';

/**
 * Phase 4 of `docs/asset-management-plan.md`: typed, build-checked declarations
 * of which sprite sheets a floor or system needs. Nothing here changes what
 * loads today — `loadSprites()` still loads every manifest entry at boot
 * (Phase 5 is what makes these groups load-bearing). This file exists so that
 * Phase 5/6 have a shape to build on, and so `npm run verify:assets` can catch
 * a floor/system that grew a new creature without anyone updating its
 * declared coverage.
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
  | 'boss_juicer'
  | 'boss_krakaren'
  | 'boss_ball_of_swine'
  | 'boss_grotesque_spider'
  | 'bounty_evil_clown'
  | 'bounty_mantid'
  | 'bounty_skeleton_lord'
  | 'bounty_dark_knight'
  | 'bounty_rock_golem'
  | 'quest_circus';

/**
 * Every creature/effect/environment sheet a group covers.
 *
 * Roughly half of `src/sprites/*` (Krasue, CircusLemur, MoldLion,
 * RingmasterGrimaldi, MissQuill, Remex, Signet, GumGum, HeatherTheBear,
 * RuinsGhoul, Cockroach, VineTendril, InkMarauder, CityElfCultist, all
 * townsfolk) is procedural canvas drawing with no manifest entry at all — those
 * creatures cost nothing sprite-wise and deliberately have no key anywhere in
 * this file. See `MOB_SPRITE_KEYS` below for the canonical "does this mob type
 * need a sheet" answer that `verify:assets` actually checks against.
 */
export const ASSET_GROUPS: Readonly<Record<AssetGroup, readonly SpriteKey[]>> = {
  // Needed on every floor: the two player characters, the persistent Mongo
  // pet companion (unlockable from level 1 onward), the mercenary "bruiser"
  // template (which draws from the rock golem sheet — see Mercenary.ts),
  // Mordecai (rat_kin, present in every safe room on every dungeon floor),
  // player-cast effects usable anywhere, and the generic props/masks that
  // appear in both dungeon rooms and the town.
  core: [
    'human',
    'cat',
    'rat_kin',
    'mongo_juvenile',
    'mongo_adolescent',
    'mongo_adult',
    'rock_golem',
    'blood_particle',
    'blood_puddle',
    'magic_missile_projectile',
    'magic_missile_explosion',
    'magic_missile_icon',
    'protective_shell',
    'protective_shell_mini',
    'protective_shell_shockwave',
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

  // Level 3's town: buildings, the desperado club interior, street furniture
  // and Shady the bounty giver.
  town: [
    'barracks',
    'blacksmith',
    'desperado_club',
    'overworld_main_tower',
    'shop',
    'small_inn',
    'tattoo_parlor',
    'tavern_1',
    'tavern_2',
    'temple',
    'village_house_1',
    'village_house_2',
    'village_house_3',
    'village_house_4',
    'circus_tent_blue',
    'circus_tent_purple',
    'circus_tent_red',
    'roof_circus_blue',
    'roof_circus_purple',
    'roof_circus_red',
    'wall_circus_blue',
    'wall_circus_purple',
    'wall_circus_red',
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
    'roof_green',
    'roof_red',
    'roof_slate',
    'roof_thatch',
    'wall_cottage',
    'wall_merchant',
    'wall_metal',
    'wall_stone',
    'wall_tower',
    'shady',
    'ground_overworld',
    'modern_decorations',
  ],

  // Level 3's wilderness: trees, boulders, camps, ground scatter, the sky
  // fowl flock, and the ambient nature dressing.
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
    'dirt_patch',
    'grassy_weed',
    'sky_fowl_body',
    'sky_fowl_hat_mask',
    'sky_fowl_pants_mask',
    'sky_fowl_trim_mask',
    'sky_fowl_vest_mask',
    // The troglodyte den camp's residents (`level3.ts`'s `campSpawns.troglodyte`).
    // Also used by level 2 (`dungeon_common`) — duplicated here rather than
    // pulling all of `dungeon_common`'s dungeon tilesets onto the overworld.
    'troglodyte',
    'troglodyte_tongue',
  ],

  // Shared by every dungeon floor (tutorial, level 1, level 2): the generic
  // dungeon/interior ground, and the mob types that show up in more than one
  // floor's spawn tables (goblin's four weapon variants, llama, rat,
  // troglodyte). Floor-specific tile *palettes* are their own groups below,
  // since floor 1 and floor 2 share these five tile types but not their look
  // (`src/map/dungeon/floorTheme.ts`).
  dungeon_common: [
    'ground_dungeon',
    'ground_interior',
    'goblin_axe',
    'goblin_mace',
    'goblin_sword',
    'goblin_warhammer',
    'llama',
    'rat',
    'troglodyte',
    'troglodyte_tongue',
    'tuskling',
    // The defend quest's grate-crawlers, and the shape Mordecai wears on the
    // floor they appear on.
    'bugaboo',
  ],

  floor1_tileset: ['ground_floor1'],
  floor2_tileset: ['ground_floor2'],

  boss_hoarder: ['hoarder', 'hoarder_vomit_arc', 'hoarder_vomit_puddle', 'hoarders_room'],
  boss_juicer: ['juicer'],
  // Includes brindle_grub: level 2's onMobKilledSpawns rule reactively spawns
  // it whenever any mob dies on the floor, not only near the Krakaren Clone —
  // grouped with him because his gauntlet is level 2's only other bespoke
  // group, not because the two are otherwise related.
  boss_krakaren: ['krakaren', 'brindle_grub'],
  boss_ball_of_swine: ['ball_of_swine'],
  // Level 2's spider lab: the boss itself, its small-spider adds (spawned by
  // `SpiderQuestSystem`, not a spawn-table rule), and the lab dressing/minigame
  // art that only exists because the boss does.
  boss_grotesque_spider: [
    'grotesque_spider_base',
    'grotesque_spider_screech',
    'grotesque_spider_slam',
    'grotesque_spider_spit',
    'grotesque_spider_spit_projectile',
    'grotesque_spider_spit_trap',
    'spider',
    'life_machine',
    'lab_tables',
    'scientist',
    'spider-egg',
    'spider_room_floor',
    'keyboard_hero_buttons',
    'keyboard_hero_playing_field',
  ],

  // Bounty encounters (level 3 only — `BountySystem` is only constructed in
  // the town branch of `DungeonScene`'s constructor). Each entry is the named
  // mark plus its escort's sheets; every no-sheet escort member (CircusLemur
  // for the clown troupe) is omitted per the note above.
  bounty_evil_clown: ['evil_clown', 'stilt_clown', 'fat_clown'],
  bounty_mantid: ['mantid', 'mantis'],
  bounty_skeleton_lord: ['skeleton_lord', 'skeleton_sword', 'skeleton_archer'],
  bounty_dark_knight: [
    'dark_knight',
    'goblin_axe',
    'goblin_mace',
    'goblin_sword',
    'goblin_warhammer',
  ],
  bounty_rock_golem: ['rock_golem_boss', 'rock_golem'],

  // The circus quest chain (`CircusQuestSystem` + `BigTopBossSystem`, both
  // level 3 only): only the stilt/fat clowns have sheets — MoldLion,
  // CircusLemur, TerrorTheClown, Signet, HeatherTheBear, InkMarauder,
  // RingmasterGrimaldi and VineTendril are all procedural.
  quest_circus: ['stilt_clown', 'fat_clown'],
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
 * `goblin` needs all four weapon sheets rather than one: `pickGoblinWeapon()`
 * in `src/levels/spawner.ts` rolls the weapon at spawn time, so any floor that
 * can spawn a goblin can produce any of the four.
 */
export const MOB_SPRITE_KEYS: Readonly<Record<string, readonly SpriteKey[]>> = {
  goblin: ['goblin_axe', 'goblin_mace', 'goblin_sword', 'goblin_warhammer'],
  llama: ['llama'],
  rock_golem: ['rock_golem'],
  rock_golem_boss: ['rock_golem_boss'],
  mantid: ['mantid'],
  mantis: ['mantis'],
  rat: ['rat'],
  the_hoarder: ['hoarder', 'hoarder_vomit_arc', 'hoarder_vomit_puddle', 'hoarders_room'],
  cockroach: [],
  juicer: ['juicer'],
  troglodyte: ['troglodyte', 'troglodyte_tongue'],
  tuskling: ['tuskling'],
  ball_of_swine: ['ball_of_swine'],
  krakaren_clone: ['krakaren'],
  brindle_grub: ['brindle_grub'],
  bugaboo: ['bugaboo'],
  grotesque_spider: [
    'grotesque_spider_base',
    'grotesque_spider_screech',
    'grotesque_spider_slam',
    'grotesque_spider_spit',
    'grotesque_spider_spit_projectile',
    'grotesque_spider_spit_trap',
    'life_machine',
    'lab_tables',
    'scientist',
    'spider-egg',
    'spider_room_floor',
    'keyboard_hero_buttons',
    'keyboard_hero_playing_field',
  ],
  small_spider: ['spider'],
  ruins_ghoul: [],
  krasue: [],
  circus_lemur: [],
  stilt_clown: ['stilt_clown'],
  fat_clown: ['fat_clown'],
  evil_clown: ['evil_clown'],
  mold_lion: [],
  terror_the_clown: [],
  ringmaster_grimaldi: [],
  city_elf_cultist: [],
  skeleton_sword: ['skeleton_sword'],
  skeleton_archer: ['skeleton_archer'],
  skeleton_lord: ['skeleton_lord'],
  sky_fowl: [
    'sky_fowl_body',
    'sky_fowl_hat_mask',
    'sky_fowl_pants_mask',
    'sky_fowl_trim_mask',
    'sky_fowl_vest_mask',
  ],

  // Not in MOB_REGISTRY — constructed directly by the systems named in each
  // comment, never via `createMob`.
  /** `bountyDefs.ts`'s `DARK_KNIGHT_DEF`. */
  dark_knight: ['dark_knight'],
  /** `HeatherTheBear`, `Signet`, `MissQuill`, `Remex`, `VineTendril`, `GumGum` — all procedural. */
  heather_the_bear: [],
  signet: [],
  miss_quill: [],
  remex: [],
  vine_tendril: [],
  gum_gum: [],
  /** `MongoSystem` — a persistent companion, not a spawn-table mob. */
  mongo: ['mongo_juvenile', 'mongo_adolescent', 'mongo_adult'],
  /** `MercenarySystem`'s "bruiser" template (`Mercenary.ts`, draws via `drawRockGolemSprite`). */
  mercenary_bruiser: ['rock_golem'],
};
