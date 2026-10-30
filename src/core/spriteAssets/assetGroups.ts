import type { SpriteKey } from './SpriteLoader';
import type { MobKind } from '../../levels/mobKinds';

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
  | 'town_interior'
  | 'overworld'
  | 'dungeon_common'
  | 'floor1_tileset'
  | 'floor2_tileset'
  | 'boss_trash_gremlin'
  | 'boss_big_rooster'
  | 'boss_power_lab'
  | 'boss_flooded_pump_room'
  | 'boss_grotesque_spider';

/**
 * Every creature/effect/environment sheet a group covers.
 *
 * Roughly half of `src/sprites/*` (Raveling, Lemur, Lion,
 * DireBear, RuinsGhoul, Elf,
 * all townsfolk) is procedural canvas drawing with no manifest entry at all — those
 * creatures cost nothing sprite-wise and deliberately have no key anywhere in
 * this file. See `MOB_SPRITE_KEYS` below for the canonical "does this mob type
 * need a sheet" answer that `verify:assets` actually checks against.
 */
export const ASSET_GROUPS: Readonly<Record<AssetGroup, readonly SpriteKey[]>> = {
  // Needed on every floor: player-cast effects usable
  // anywhere, and the generic props/masks that appear in both dungeon rooms and
  // the town. The two player characters are painted rather than baked and hold
  // no key here.
  core: [
    'blood_particle',
    'blood_puddle',
    'magic_missile_icon',
    'seismic_stomp_icon',
    'treasure_chests',
    'stairwell',
    'torch',
    'barrel',
    'barrel_side',
    'crate',
    'bookshelf',
    'brazier',
    'crawler_sign',
    'crawler_sign_arrow',
    'fountain',
    'well',
    'ground_masks',
    // The "find the stairwell" banner shown on entering (or re-entering) any
    // dungeon floor — not a tile sprite, just a full-screen splash image, but
    // tracked through SpriteLoader like every other sheet.
    'find-the-stairwell',
  ],

  // Level 3's town: buildings and street furniture.
  town: [
    'barracks',
    'blackwood_lodge',
    'blacksmith',
    'cartwrights_workshop',
    'cloak_and_dagger',
    'general_store',
    'herb_remedy',
    'loris_cottage',
    'horned_flagon',
    'millers_farm',
    'overworld_main_tower',
    'plumbline_farm',
    'quiet_needle',
    'sleeping_cat_inn',
    'sunken_stump',
    'temple',
    // Each facade's lit windows, smoke and glow, a sheet of their own so a
    // building far from the screen holds only its still frame.
    'barracks_life',
    'blackwood_lodge_life',
    'blacksmith_life',
    'cartwrights_workshop_life',
    'cloak_and_dagger_life',
    'general_store_life',
    'herb_remedy_life',
    'loris_cottage_life',
    'horned_flagon_life',
    'millers_farm_life',
    'plumbline_farm_life',
    'quiet_needle_life',
    'sleeping_cat_inn_life',
    'sunken_stump_life',
    'temple_life',
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
    'town_awning_post',
    'town_bench',
    'town_clutter',
    'town_milking_shed',
    'town_pasture_gate',
    'town_notice_board',
    'town_hawkfolk_perch',
    'taloncrest_fortune_teller',
    'taloncrest_signpost',
    'ground_overworld',
    'modern_decorations',
  ],

  // Drawn only inside the town's buildings: the rooms' floors and walls, the
  // inn's safe-room surfaces (laid on dungeon ground), and the
  // Cloak & Dagger's furniture. Level 3 names it in `interiorSpriteGroups`, so
  // it is painted behind a building's loading card rather than on arrival.
  town_interior: [
    'ground_interior',
    'ground_dungeon',
    'club_bar_counter',
    'club_bar_stool',
    'club_casino_table',
    'club_drink_shelf',
    'club_market_backdrop',
    'club_market_stall',
    'club_poker_table',
    'club_slot_cabinet',
    'club_slot_cabinet_back',
    'club_slot_lights',
    'club_fortune_wheel',
    'club_fortune_wheel_lights',
    'club_croupier_counter',
    'club_stage',
    'club_host_stand',
    'club_standing_table',
  ],

  // Level 3's wilderness: trees, boulders, the goblin camps, Briar Hollow and the circus.
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
    'rock_deposit_a',
    'rock_deposit_b',
    'rock_deposit_c',
    'rock_deposit_dressed_a',
    'rock_deposit_dressed_b',
    'campfire',
    'goblin_tent_a',
    'goblin_tent_b',
    'goblin_tent_c',
    'goblin_tent_d',
    // Scattered through the goblin camps and Briar Hollow's ruins.
    'bone_scatter',
    // Briar Hollow's props.
    'village_1x1',
    'village_1x1_variants',
    'village_1x1_tall',
    'village_2x1',
    'village_2x1_variants',
    'village_3x1',
    'village_4x1',
    'village_1x2',
    'village_2x2',
    'village_2x3',
    // The circus grounds' tents, arch posts, flame lamps, wagons and booths.
    'circus_starlight_tent',
    'circus_pavilion',
    'circus_arch_post',
    'circus_rim_post',
    'circus_wagon',
    'circus_booth',
  ],

  // Shared by every dungeon floor (tutorial, level 1, level 2): the generic
  // dungeon ground.
  // Floor-specific tile *palettes* are their own groups below,
  // since floor 1 and floor 2 share these five tile types but not their look
  // (`src/map/dungeon/floorTheme.ts`).
  dungeon_common: [
    'ground_dungeon',
    // The dead, on any dungeon floor a character or a stamp lays them out on.
    'bone_scatter',
    'bone_pile',
    'slumped_skeleton',
  ],

  floor1_tileset: [
    'ground_floor1',
    'clay_urn',
    'grain_sack',
    'wine_cask',
    'bottle_rack',
    'cellar_table',
    'spear_rack',
    'rubble_heap',
    'rubble_slope',
    'fallen_beam',
    'glow_fungus',
    'candle_cluster',
    'sarcophagus',
    'straw_scatter',
  ],
  floor2_tileset: [
    // The service level's faces of the barrel, crate, bookshelf, torch and
    // brazier tiles: drawn instead of the core sheets while its theme is active.
    'steel_drum',
    'oil_drum',
    'steel_drum_side',
    'plastic_crate',
    'steel_shelving',
    'work_lamp',
    'drum_brazier',
    'ground_floor2',
    'gas_cylinder',
    'locker_bank',
    'filing_cabinet',
    'mop_bucket',
    'pallet_stack',
    'vending_machine',
    'service_desk',
    'locker_bench',
    'boiler',
    'service_decals',
    // The clogged bathroom's fittings: every floor-2 world seats a copy on each
    // gauntlet branch.
    'bathroom_stall',
    'bathroom_pipe_wall',
    'bathroom_sink',
    'bathroom_decals',
  ],

  boss_trash_gremlin: [
    'trash_pile',
    'trash_pile_fill',
    'trash_tower',
    'trash_tower_fall_east',
    'trash_tower_fall_south',
    'trash_tower_fall_north',
    'garbage_bag',
    'trash_gremlin_floor',
    'trash_gremlin_nest',
    'trash_barricade',
  ],
  // Level 2's spider lab: the dressing that only exists because the boss does.
  // The boss herself, her spit, the life machines, the small-spider adds and the
  // hacking mini-game's console are all painted.
  boss_grotesque_spider: [
    'spider_lab_bench',
    'spider_lab_terminal',
    'spider_lab_shelf',
    'spider_lab_egg_sac',
    'spider_lab_cocoon',
    'spider_lab_light_bank',
    'spider_lab_web_growth',
    'spider_lab_remains',
  ],
  // The other boss rooms' painted dressing. Each group also names the sheets
  // `requestEnvironmentSheetsForGroups` paints for it, so a key listed here is
  // one `verify:assets` can see belongs to a floor.
  boss_big_rooster: [
    'gym_rack',
    'gym_squat_rack',
    'gym_cable_stack',
    'gym_belt',
    'gym_console',
    'gym_boombox',
    'gym_shutter',
    'gym_plate',
    'gym_chalk_puff',
    'gym_mirror_crack',
    'gym_pickups',
    'gym_kettlebell_rack',
    'gym_kettlebell',
    'gym_exercise_ball',
  ],
  boss_power_lab: ['power_lab_vat', 'power_lab_console', 'power_lab_fx', 'power_lab_wash'],
  boss_flooded_pump_room: [
    'flooded_pump_raft',
    'flooded_pump_pump',
    'flooded_pump_valve',
    'flooded_pump_chute',
    'flooded_pump_dead_shark',
    'flooded_pump_barrel',
    'flooded_pump_barrel_stack',
    'flooded_pump_drain',
  ],
};

/**
 * Ground truth for "does this hostile kind need a sheet, and which one(s)":
 * one entry per `MobKind` (`src/levels/mobKinds.ts`), so a kind added to the
 * registry fails `tsc` here until its sprite needs are declared.
 *
 * An empty array means the creature is procedural canvas art (see the note on
 * `ASSET_GROUPS` above) and needs no group at all.
 */
export const MOB_SPRITE_KEYS: Readonly<Record<MobKind, readonly SpriteKey[]>> = {
  goblin: [],
  goblin_archer: [],
  goblin_dynamiter: [],
  goblin_bombardier: [],
  acid_llama: [],
  rock_golem: [],
  rock_golem_boss: [],
  mantid: [],
  mantis: [],
  rat: [],
  trash_gremlin: [],
  cockroach: [],
  big_rooster: [],
  little_rooster: [],
  slightly_bent_rooster: [],
  lizardman: [],
  wereboar: [],
  kraken: [],
  electric_goblin: [],
  gravedigger_beetle: [],
  giant_wasp: [],
  fuzzy_nightmare: [],
  grotesque_spider: [],
  small_spider: [],
  ruins_ghoul: [],
  raveling: [],
  lemur: [],
  tall_clown: [],
  fat_clown: [],
  evil_clown: [],
  lion: [],
  massive_clown: [],
  elf: [],
  skeleton_sword: [],
  skeleton_archer: [],
  skeleton_lord: [],
  the_lich: [],
  /** The Briar Hollow assault's undead: all three painted, none holds a sheet. */
  necromancer: [],
  raised_ratkin: [],
  grave_bull: [],
  /** Painted by `hawkfolkCastSprite.ts`, one figure per street-tough look. */
  hawkfolk: [],
  /** The five fairies are painted, not baked. */
  fairy_shield: [],
  fairy_healer: [],
  fairy_ice: [],
  fairy_fire: [],
  fairy_necro: [],

  /** `bountyDefs.ts`'s `DARK_KNIGHT_DEF` — painted, not baked. */
  dark_knight: [],
  /** The Dire Bear is painted procedurally, so it holds no sheet. */
  dire_bear: [],
  /** Boss adds and set-piece hostiles, all procedural or painted. */
  kraken_tentacle: [],
  spider_hatchling: [],
  spider_egg: [],
  tutorial_goblin: [],
  shrine_vermin: [],
};

/**
 * Friendly creatures that systems build themselves (livestock, militia,
 * companions, hirelings). None is a `MobKind`: they never appear in a spawn
 * table, so `SYSTEM_ASSET_REQUIREMENTS` is the only place that names them.
 */
export type FriendlyCreatureKind = 'cow' | 'calf' | 'ratkin_soldier' | 'deinonychus' | 'mercenary';

/** Any creature whose sprite needs `verify:assets` checks. */
export type CreatureKind = MobKind | FriendlyCreatureKind;

/** {@link MOB_SPRITE_KEYS} for the friendly creatures. */
export const FRIENDLY_CREATURE_SPRITE_KEYS: Readonly<
  Record<FriendlyCreatureKind, readonly SpriteKey[]>
> = {
  /** Briar Hollow's herd, painted by `cowSprite.ts`, one figure per coat and age. */
  cow: [],
  calf: [],
  /** Briar Hollow's militia, painted by `ratkinCastSprite.ts` like the rest of the ratkin cast. */
  ratkin_soldier: [],
  /** `DeinonychusSystem` — a persistent companion, not a spawn-table mob; painted. */
  deinonychus: [],
  /** `MercenarySystem`'s hirelings, drawn through `MERCENARY_ART` (`src/sprites/mercenaryArt.ts`); painted. */
  mercenary: [],
};
