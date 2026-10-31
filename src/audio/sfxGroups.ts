import {
  ELECTRIFIED_JOLT_SOUNDS,
  STREAMING_SOUND_IDS,
  WOOD_SMASHING_SOUNDS,
  type SoundId,
} from './sounds';
import type { BuildingEntry } from '../map/buildingEntry';
import { CONTRACT_CUES } from './contractSoundCues';
import { BATHROOM_CUES } from './bathroomSoundCues';
import { PRISON_CUES } from './prisonSoundCues';
import { SPIDER_QUEST_CUES } from './spiderQuestSoundCues';
import { TUTORIAL_CUES } from './tutorialSoundCues';
import type { LevelId } from '../levels/levelIds';
import { INTERIOR_CUES } from './interiorInteractionSoundCues';
import { INTERIOR_AMBIENCE_CUES } from './interiorAmbienceCues';
import { occupantRoutineSoundIds } from './occupantRoutineCues';
import { POKER_CUES } from './pokerSoundCues';
import { BOMBER_GOBLIN_CUES } from './bomberGoblinSoundCues';
import { ELECTRIC_GOBLIN_CUES } from './bossSoundCues';
import { GENERATOR_RIG_HUM_LOOP } from './loopLevels';
import { FLOODED_PUMP_ROOM_CUES } from './floodedPumpRoomSoundCues';
import { SEWER_CUES } from './sewerSoundCues';
import { CAT_SENSE_CUE } from './catSenseSoundCues';
import { KEY_SOUND_IDS } from './keySoundCues';
import { TOWER_CUES } from './towerSoundCues';
import {
  CAPTURE_CUE,
  MISSING_CATS_CUES,
  REUNION_CUE,
  THIEF_GLIDE_LOOP,
} from './missingCatsSoundCues';
import { STORM_DRAIN_ID, TOWN_TOWER_ID } from '../map/buildingIds';
import { SCRIPTED_DEATH_CUES } from './scriptedDeathCues';
import { starlightTentCueSoundIds } from './starlightTentSoundCues';
import { MUSIC_STEM_SETS } from './music/stemSets';
import { KRAKEN_BATTLE_TRACK } from './music/bossTracks';

/**
 * Every take in a cue table that is decoded into a buffer. A cue table also
 * names its streamed beds, which play through a media element and have no
 * place in a preload group.
 */
function decodedCueIds(cues: Readonly<Record<string, readonly SoundId[]>>): SoundId[] {
  return Object.values(cues)
    .flat()
    .filter((id) => !STREAMING_SOUND_IDS.has(id));
}

/**
 * Where a group of non-streaming sound effects can be heard. The 144
 * non-streamed ids used to be decoded in one `preload()` call at boot; these
 * groups let `AudioManager.preload` be called with only what a
 * floor/boss/quest/interior actually needs.
 *
 * `misc` exists so a sound with no confident home still gets preloaded
 * (see its own doc comment below) rather than silently never loading — a
 * dropped id would still type-check and would only fail at runtime, as a cue
 * that never plays (`AudioManager.play` skips silently on a missing buffer).
 */
export type SfxGroup =
  | 'universal'
  | 'level1'
  | 'level2'
  | 'level3'
  | 'briarHollow'
  | 'briarHollowSiege'
  | 'constructionContracts'
  | 'cloggedBathroom'
  | 'stealthKeySnatch'
  | 'stormDrain'
  | 'towerStoreys'
  | 'spiderQuest'
  | 'bounty'
  | 'starlightTent'
  | 'lichBattle'
  | 'missingCats'
  | 'missingCatsStakeout'
  | 'missingCatsCapture'
  | 'missingCatsReunion'
  | 'floodedPumpRoomMusic'
  | 'trashGremlinMusic'
  | 'wardenRitualMusic'
  | 'towerSplitMusic'
  | 'deinonychusMercenary'
  | 'interiorDoctor'
  | 'dwarfCook'
  | 'interiorCasino'
  | 'interiorCommerce'
  | 'interiorInteractions'
  | 'interiorAmbience'
  | 'interiorRoutines'
  | 'tutorial'
  | 'misc';

/**
 * Every cue the Dynamite and Black Powder Goblins raise (`BOMBER_GOBLIN_CUES`):
 * they spawn on all three floors and march in Briar Hollow's siege waves.
 */
const BOMBER_GOBLIN_SFX_IDS: readonly SoundId[] = decodedCueIds(BOMBER_GOBLIN_CUES);

/** Every take the Kraken's flooded pump room plays (`FLOODED_PUMP_ROOM_CUES`). */
const FLOODED_PUMP_ROOM_SFX_IDS: readonly SoundId[] = decodedCueIds(FLOODED_PUMP_ROOM_CUES);

/** Every take the Current Goblin's cues play (`ELECTRIC_GOBLIN_CUES`), and his generator's hum. */
const ELECTRIC_GOBLIN_SFX_IDS: readonly SoundId[] = [
  ...decodedCueIds(ELECTRIC_GOBLIN_CUES),
  GENERATOR_RIG_HUM_LOOP.id,
];

/**
 * The Acid Llama's spit and its glob's splash. Llamas roam floors 1 and 2 and
 * march in Briar Hollow's siege waves.
 */
const ACID_LLAMA_SFX_IDS: readonly SoundId[] = [
  'acid_glob_spit_1',
  'acid_glob_spit_2',
  'acid_glob_spit_3',
  'acid_glob_splash_1',
  'acid_glob_splash_2',
  'acid_glob_splash_3',
];

/**
 * The Fuzzy Nightmare's growl and its claws on a grate. It comes up through
 * the defense quest's grates on floors 1 and 2 and marches in Briar Hollow's
 * siege waves.
 */
const FUZZY_NIGHTMARE_SFX_IDS: readonly SoundId[] = [
  'fuzzy_nightmare_growl_1',
  'fuzzy_nightmare_growl_2',
  'fuzzy_nightmare_growl_3',
  'fuzzy_nightmare_growl_4',
  'fuzzy_nightmare_growl_5',
  'fuzzy_nightmare_grate_claw_1',
  'fuzzy_nightmare_grate_claw_2',
  'fuzzy_nightmare_grate_claw_3',
  'fuzzy_nightmare_grate_claw_4',
  'fuzzy_nightmare_grate_claw_5',
];

/**
 * Every cue a fairy, its spells or its death can raise. Fairies spawn in rooms
 * on floors 1 and 2, across the floor-3 wilds, and beside hard-mode bosses the
 * quest systems stage, so each of those groups carries the whole set rather
 * than leaning on a sibling group happening to be loaded.
 */
const FAIRY_SFX_IDS: readonly SoundId[] = [
  'fairy_charge_fizz',
  'fairy_death_explosion',
  'fairy_death_flame',
  'fairy_death_pop',
  'fairy_explosion',
  'fairy_fireball_whoosh',
  'fairy_heal_bloom',
  'fairy_heal_wave',
  'fairy_ice_cast',
  'fairy_ice_chill',
  'fairy_ice_cracking',
  'fairy_ice_death',
  'fairy_ice_freeze',
  'fairy_ice_hits_ground',
  'fairy_immune_fizzle',
  'fairy_necro_wail',
  'fairy_raise_call',
  'fairy_resurrection_moan',
  'fairy_shield_cast',
  'fairy_shield_shatter',
  'fairy_telekinetic_thrum',
  'fairy_ward_crush_implode',
];

/**
 * The rank-and-file skeleton's own cues — its swing and its collapse — that no
 * boot-loaded group carries. A necro fairy raises skeletons wherever it spawns,
 * so every floor group it spawns in needs these beside the fairy's own set.
 */
const RAISED_SKELETON_SFX_IDS: readonly SoundId[] = [
  'bones_rattling',
  'slash_strike_1',
  'slash_strike_2',
  'slash_strike_3',
];

/** Household breakables, shared by building interiors and the dungeon. */
const INTERIOR_BREAK_SFX_IDS: readonly SoundId[] = [
  'basket_crunch_1',
  'basket_crunch_2',
  'bottle_shelf_crash_1',
  'bottle_shelf_crash_2',
  'bottle_shelf_crash_3',
  'bottle_shelf_crash_4',
  'clay_pot_break_1',
  'clay_pot_break_2',
  'clay_pot_break_3',
  'clay_pot_break_4',
  'crockery_smash_1',
  'crockery_smash_2',
  'crockery_smash_3',
  'crockery_smash_4',
  'lamp_break_1',
  'lamp_break_2',
  'pans_clatter_1',
  'pans_clatter_2',
  'pans_clatter_3',
  'sack_tear_1',
  'sack_tear_2',
];

/**
 * Sounds `DUNGEON_CUES` (`dungeonSoundCues.ts`) plays that no boot-loaded
 * group carries; every floor dressed as a dungeon (a `groundTheme` on its
 * level) shares it: the tutorial and floors 1 and 2.
 */
const DUNGEON_CUE_SFX_IDS: readonly SoundId[] = [
  'rumble',
  'glass_break_1',
  'glass_break_2',
  'glass_break_3',
  'tech_machinery_running',
  'drum_burst',
  'monitor_pop',
  'fuse_box_short',
  'gas_cylinder_hiss',
  'steam_valve_burst',
  'candle_stand_topple_1',
  'candle_stand_topple_2',
  'banner_rip',
  'bones_clatter_1',
  'bones_clatter_2',
  'bones_clatter_3',
  'bones_clatter_4',
  'chain_rattle_1',
  'chain_rattle_2',
  'chain_rattle_3',
  'coals_scatter',
  'cobweb_tear_1',
  'cobweb_tear_2',
  'fluorescent_hum_loop',
  'torch_burn_loop',
  'steam_leak_loop',
  'water_drip_1',
  'water_drip_2',
  'water_drip_3',
  'water_drip_4',
  'water_drip_5',
  'water_drip_6',
  'metal_dent_1',
  'metal_dent_2',
  'metal_dent_3',
  'oil_fire_ignite_1',
  'oil_fire_ignite_2',
  'oil_fire_ignite_3',
  'oil_fire_ignite_4',
  'rubble_collapse_1',
  'rubble_collapse_2',
  'rubble_collapse_3',
  'torch_extinguish',
  'wine_cask_burst',
  'camera_break',
  'filing_cabinet_crash_1',
  'filing_cabinet_crash_2',
  'grain_spill_1',
  'grain_spill_2',
  'grain_spill_3',
  'locker_burst_1',
  'locker_burst_2',
  'paper_rustle_1',
  'paper_rustle_2',
  'paper_rustle_3',
  'paper_rustle_4',
  'plastic_crack_1',
  'plastic_crack_2',
  'puddle_step_1',
  'puddle_step_2',
  'puddle_step_3',
  'puddle_step_4',
  'puddle_step_5',
  'puddle_step_6',
  'vending_glass_smash_1',
  'vending_glass_smash_2',
  'vending_glass_smash_3',
  'vending_glass_smash_4',
  'wet_sign_skid',
  ...INTERIOR_BREAK_SFX_IDS,
];

/**
 * Taloncrest citizens' voices, spoken through the dialog box when a
 * conversation opens (the `townsfolk*` styles in `src/dialog/speakers.ts`).
 * Streets and every building interior share the floor-3 bundle that carries them.
 */
const TOWN_VOICE_SFX_IDS: readonly SoundId[] = [
  'hawkfolk_chatter_1',
  'hawkfolk_chatter_2',
  'hawkfolk_greeting_1',
  'hawkfolk_greeting_2',
  'hawkfolk_laugh_1',
  'hawkfolk_elder_chatter_1',
  'hawkfolk_elder_chatter_2',
  'hawkfolk_elder_chatter_3',
  'hawkfolk_fledgling_chirp_1',
  'hawkfolk_wing_ruffle_1',
  'hawkfolk_wing_ruffle_2',
  'hawkfolk_talon_steps',
  'townsfolk_tut_1',
  'townsfolk_tut_2',
  'townsfolk_hm_male_1',
  'townsfolk_hm_male_2',
  'townsfolk_hm_male_3',
  'townsfolk_hm_male_4',
  'townsfolk_hm_male_5',
  'townsfolk_hm_female_1',
  'townsfolk_hm_female_2',
  'townsfolk_hm_female_3',
  'townsfolk_hm_female_4',
];

/**
 * Every group's membership. Ids may (and do) repeat across groups — e.g. a
 * bounty boss's attack cue is often a stand-in borrowed from a level1/level2
 * boss (see `GameLoopPhases.playMobAudioCues`), so both the level that
 * introduced the sample and the bounty that reuses it need to preload it.
 * `preload()` already de-dupes against `buffers`, so the repetition costs
 * nothing at runtime.
 */
export const SFX_GROUPS: Record<SfxGroup, readonly SoundId[]> = {
  /**
   * Menu/UI feedback and the human+cat's own combat/movement/item cues —
   * every scene (tutorial, level1-3, every building interior) can trigger
   * these, so they preload at boot rather than at floor entry.
   */
  universal: [
    // Electrified can come from gear on any floor, not only the Current Goblin.
    ...ELECTRIFIED_JOLT_SOUNDS,
    // Any map can lay a sense only the cat perceives.
    ...CAT_SENSE_CUE.takes,
    // Fragments, forging, seals and the floor intros happen on every floor.
    ...KEY_SOUND_IDS,
    'ability_level_up',
    'achievement_awarded',
    // Deinonychus's own three cues. `DungeonScene` constructs `DeinonychusSystem` for every
    // floor, so the pet can be out anywhere the ability is unlocked.
    'bite_1',
    'bite_2',
    'bite_3',
    'deinonychus_released',
    'deinonychus_slash',
    'achievement_unlocked',
    // Chewing solid food: a hamburger is eaten from the bag wherever the party
    // happens to be.
    'eating_chew',
    'boss_defeated',
    'cat_effect_damage_1',
    'cat_effect_damage_2',
    'cat_effect_damage_3',
    'belle_downed',
    'cat_missile_fire',
    'cat_missile_impact',
    'cat_revived',
    'cat_scratch',
    'cat_splash',
    // Caroline's frame chimes as it opens and ticks as her words decode, and she
    // can speak in any scene.
    'caroline_message_chime',
    'caroline_text_tick_1',
    'caroline_text_tick_2',
    'caroline_text_tick_3',
    'caroline_text_tick_4',
    'caroline_text_tick_5',
    'caroline_text_tick_6',
    'caroline_text_tick_7',
    // Dave teleports into the safe room the party walks into, on every floor.
    'dave_teleport_in',
    'dave_teleport_out',
    // The Wayfinder's Anchor's channel start / completion — usable from any
    // scene the item can be carried into, same reasoning as `smoke_cloud_billow`
    // and `speed_fizz` just below.
    'charging_up_1',
    'chest_locked',
    'chest_unlocked_in_treasure_room',
    'coin_pouch',
    // A smoke bomb bursts wherever one can be thrown.
    'smoke_cloud_billow',
    'cooldown_crisp',
    'death_sequence',
    'dynamite_explosion',
    // The party's own dynamite landing and Black Powder Bomb going off, which
    // can be thrown wherever a stick of dynamite can.
    ...BOMBER_GOBLIN_CUES.stickLanded,
    ...BOMBER_GOBLIN_CUES.blackPowderBlast,
    'entered_safe_room',
    'error',
    'error_taking_action',
    // The save indicator can fire from any floor or interior a checkpoint is
    // taken on, so its cue has to be decoded before the first one can play.
    'game_saving',
    'gate_opening',
    // Goblin and lizardman spawn on every one of level1/level2/level3 (see
    // each level's MobSpawnRule table), so their cues live here rather than
    // being duplicated into all three floor groups.
    'goblin_1',
    'goblin_2',
    'goblin_found_you',
    // The goblin archer's bow, and the shaft landing. Same reason as the goblin
    // voices above: he is on the spawn table of all three floors.
    'shooting_an_arrow',
    'arrow_impact',
    'hammer_strike',
    'healing_potion',
    'human_effect_damage_1',
    'human_effect_damage_2',
    'human_knocked_out',
    'human_energy_shield_discharge',
    'human_punch_1',
    'human_punch_2',
    'human_punch_3',
    'human_punch_weak',
    'human_revived',
    'human_female_effect_damage_1',
    'human_female_effect_damage_2',
    'human_female_effect_damage_3',
    'human_female_effect_damage_4',
    'human_female_knocked_out',
    'human_female_revived',
    'human_seismic_stomp',
    'seismic_stomp_quake',
    'human_splash',
    'jugg_juice',
    'level_complete',
    'lizardman_tongue_lash',
    'menu_change_follower',
    'menu_click',
    'menu_drop_item',
    'menu_expand_map',
    'menu_open',
    'menu_skillpoint_spent',
    'mob_splash',
    'new_unlock',
    'objective_complete',
    'reward_chest_land',
    'reward_chest_latch',
    'reward_chest_burst_common',
    'reward_chest_burst_uncommon',
    'reward_chest_burst_rare',
    'reward_chest_burst_epic',
    'reward_chest_burst_legendary',
    'reward_chest_burst_divine',
    'reward_item_pop_1',
    'reward_item_pop_2',
    'reward_item_pop_3',
    'reward_coin_shower_1',
    'reward_coin_shower_2',
    'reward_coin_shower_3',
    'divine_choir_swell',
    'opening_treasure_chest',
    'pickup_1',
    'pickup_2',
    // Lifting a physical thing off the floor by hand — the defend quest's wood
    // pile, gym equipment, anything lying in the world — as opposed to
    // \`pickup_1\`/\`pickup_2\`, which are loot landing in the bag. Those objects
    // lie on every floor, so it boots with the rest.
    'picking_up_ground_object',
    'player_level_up',
    'player_wading',
    'player_walking',
    'potion_drink',
    'quest_complete',
    'reviving_tone',
    'skillpoint_reminder',
    // Eating anything brothy with a spoon. A stew is eaten from the bag
    // wherever the party happens to be, so it can't wait for a floor group.
    'slurping_soup',
    'speed_fizz',
    'splat_1',
    'splat_2',
    'splat_3',
    'stat_boost',
    'teleport',
    'treasure_chest_reward',
    'typing_click',
    'wood_breaking_1',
    'wood_breaking_2',
    'wood_breaking_3',
    ...WOOD_SMASHING_SOUNDS,
    // Reward flow, timers, save chime and the pet's happy squawks: any floor can fire them.
    'coin_land_tick',
    'garbage_bag_burst_1',
    'garbage_bag_burst_2',
    'deinonychus_adult_happy_squawk_1',
    'deinonychus_adult_happy_squawk_2',
    'deinonychus_adult_happy_squawk_3',
    'deinonychus_adult_happy_squawk_4',
    'deinonychus_juvenile_happy_squawk_1',
    'deinonychus_juvenile_happy_squawk_2',
    'deinonychus_juvenile_happy_squawk_3',
    'deinonychus_juvenile_happy_squawk_4',
    'item_bag_pop',
    'level_timer_final_minute_heartbeat',
    'level_timer_warning',
    'attack_cow_arrival',
    'attack_cow_charge',
    'attack_cow_headbutt_1',
    'attack_cow_headbutt_2',
    'attack_cow_headbutt_3',
    // The attack cow travels with the party everywhere, and charges with the
    // herd's angry moo and comes round from a revive with its happy one.
    'cow_angry_moo_1',
    'cow_angry_moo_2',
    'cow_happy_moo',
    'blood_vomit_1',
    'blood_vomit_2',
    'blood_vomit_3',
    'blood_vomit_4',
    // Gear goes wherever the party does.
    'relic_hum_loop',
    'ember_wisp_bolt_1',
    'ember_wisp_bolt_2',
    'ember_wisp_bolt_3',
    'ember_wisp_bolt_4',
    'ember_wisp_bolt_5',
    'ward_stone_block_2',
    'ward_stone_block_3',
    'buckler_block_1',
    'buckler_block_2',
    'buckler_block_3',
    'buckler_block_4',
    'bramble_seed_burst_1',
    'bramble_seed_burst_2',
    'bramble_seed_burst_3',
    'bramble_seed_burst_4',
    'claw_swipe_frost_1',
    'claw_swipe_frost_2',
    'claw_swipe_frost_3',
    'claw_swipe_frost_4',
    'claw_swipe_venom_1',
    'claw_swipe_venom_2',
    'claw_swipe_venom_3',
    'claw_swipe_venom_4',
    'claw_swipe_ink_1',
    'claw_swipe_ink_2',
    'claw_swipe_ink_3',
    'claw_swipe_ink_4',
    'cockscomb_flinch_crow',
    'gear_awaken',
    'halo_revive',
    'hourglass_slow_in',
    'hourglass_slow_out',
    'last_word_chain_spark_1',
    'last_word_chain_spark_2',
    'last_word_chain_spark_3',
    'last_word_chain_spark_4',
    'prowler_vanish',
    'set_bonus_complete',
    'sunsteel_slash_wave_1',
    'sunsteel_slash_wave_2',
    'sunsteel_slash_wave_3',
    'sunsteel_slash_wave_4',
    'twin_locket_link',
    'cursed_bind',
    'kaleidoscope_orb_orbit_loop',
    'kaleidoscope_orb_seek',
    'kaleidoscope_orb_spawn',
    'stormcaller_chain_lightning_1',
    'stormcaller_chain_lightning_2',
    'stormcaller_chain_lightning_3',
    'stormcaller_chain_lightning_4',
    'stormcaller_swing_1',
    'stormcaller_swing_2',
    'stormcaller_swing_3',
    'stormcaller_swing_4',
    'stormcaller_wave_hit_1',
    'stormcaller_wave_hit_2',
    'stormcaller_wave_hit_3',
    'stormcaller_wave_hit_4',
    // The human crawler can draw, swing and land a weapon, and either crawler can put on
    // gear, anywhere.
    'slash_strike_1',
    'slash_strike_2',
    'slash_strike_3',
    'blunt_hit_flesh_1',
    'blunt_hit_flesh_2',
    'blunt_hit_flesh_3',
    // Big Rooster's dumbbell landing, also the stand-in for iron and spade weapons landing.
    'dumbbell_club_impact_1',
    'dumbbell_club_impact_2',
    'dumbbell_club_impact_3',
    'magic_sword_swing_1',
    'magic_sword_swing_2',
    'magic_sword_swing_3',
    'magic_sword_swing_4',
    'swing_heavy_1',
    'swing_heavy_2',
    'swing_heavy_3',
    'swing_heavy_4',
    'swing_two_handed_1',
    'swing_two_handed_2',
    'swing_two_handed_3',
    'weapon_draw_blade_1',
    'weapon_draw_blade_2',
    'weapon_draw_blade_3',
    'weapon_draw_heavy',
    'weapon_stow_blade',
    'weapon_stow_heavy',
    'slingshot_draw_pocket',
    'slingshot_stow_pocket',
    'equip_cloth_1',
    'equip_cloth_2',
    'equip_cloth_3',
    'equip_jewelry_1',
    'equip_jewelry_2',
    'equip_jewelry_3',
    'equip_leather_1',
    'equip_leather_2',
    'equip_leather_3',
    'equip_leather_4',
    'equip_metal_armor_1',
    'equip_metal_armor_2',
    'reward_rarity_stinger',
    'stairwell_save_chime',
    'deinonychus_chitter',
  ],

  /** The Trash Gremlin and the Kraken, and level1's rat. */
  level1: [
    'trash_gremlin_vomit',
    ...FLOODED_PUMP_ROOM_SFX_IDS,
    ...SCRIPTED_DEATH_CUES.sharkBreachBite.takes,
    'kraken_ground_slam',
    'kraken_slam_rise',
    'kraken_tentacle_death',
    'kraken_tentacle_emerge',
    'kraken_tentacle_strike',
    'kraken_yell',
    'trash_gremlin_acid_gurgle_1',
    'trash_gremlin_acid_gurgle_2',
    'trash_gremlin_acid_gurgle_3',
    'trash_gremlin_cackle_1',
    'trash_gremlin_cackle_2',
    'trash_gremlin_cackle_3',
    'trash_gremlin_death',
    'trash_gremlin_hurt_1',
    'trash_gremlin_hurt_2',
    'trash_gremlin_hurt_3',
    'trash_gremlin_hurt_4',
    'trash_gremlin_summon_shriek_1',
    'trash_gremlin_summon_shriek_2',
    'trash_pile_roach_burst_1',
    'trash_pile_roach_burst_2',
    'trash_pile_roach_burst_3',
    'rat_squeak_1',
    'rat_squeak_2',
    'rat_squeak_3',
    'wereboar_grunt_1',
    'wereboar_grunt_2',
    'wereboar_grunt_3',
    'wereboar_grunt_4',
    ...ACID_LLAMA_SFX_IDS,
    ...FUZZY_NIGHTMARE_SFX_IDS,
    ...DUNGEON_CUE_SFX_IDS,
    ...FAIRY_SFX_IDS,
    ...RAISED_SKELETON_SFX_IDS,
    ...BOMBER_GOBLIN_SFX_IDS,
  ],

  /**
   * Floor 2's power lab, Big Rooster's gym, the spider lab quest, the
   * Gravedigger Beetle, the Lizardman's venom, Acid Llamas, the defense
   * quest's Fuzzy Nightmares, and level2's rat.
   */
  level2: [
    'dumbbell_throw',
    'kettlebell_heave',
    'kettlebell_rain_wind_loop',
    'dynamite_kick_1',
    'dynamite_kick_2',
    'dynamite_kick_3',
    'kettlebell_impact_1',
    'kettlebell_impact_2',
    'kettlebell_impact_3',
    'kettlebell_impact_4',
    'exercise_ball_kick',
    'exercise_ball_bounce_1',
    'exercise_ball_bounce_2',
    'exercise_ball_bounce_3',
    'exercise_ball_bounce_4',
    'exercise_ball_bounce_5',
    'bent_rooster_cluck_1',
    'bent_rooster_cluck_2',
    'bent_rooster_cluck_3',
    'big_rooster_crow',
    'big_rooster_death',
    'big_rooster_grunt_1',
    'big_rooster_grunt_2',
    'big_rooster_grunt_3',
    'big_rooster_grunt_4',
    'big_rooster_hurt_1',
    'big_rooster_hurt_2',
    'big_rooster_hurt_3',
    'big_rooster_hurt_4',
    'dumbbell_club_impact_1',
    'dumbbell_club_impact_2',
    'dumbbell_club_impact_3',
    'little_rooster_cluck_1',
    'little_rooster_cluck_2',
    'little_rooster_cluck_3',
    'rooster_feather_ruffle_1',
    'rooster_feather_ruffle_2',
    'rooster_peck_1',
    'rooster_peck_2',
    'rooster_peck_3',
    'rooster_peck_4',
    'rooster_punch_whoosh_1',
    'rooster_punch_whoosh_2',
    'rooster_punch_whoosh_3',
    'rooster_punch_whoosh_4',
    'rooster_talon_step_1',
    'rooster_talon_step_2',
    'rooster_talon_step_3',
    'rooster_talon_step_4',
    'massive_strike_with_dirt_impact',
    'deep_rumbling',
    'flesh_being_sliced',
    'grotesque_spider_screech_attack',
    'grotesque_spider_slam_attack',
    'grotesque_spider_spit_attack',
    'grotesque_spider_spit_landing',
    'keyboard_hero_music_track_1',
    'life_machine_powering_on',
    // The keyboard-hero board's own feedback: the per-hit terminal tick, a
    // firewall pip shattering, and the success stinger. Only the pip's glass is
    // new to this floor; the other two are already boot-loaded by `universal`,
    // and are named here so the board's needs are legible in one place rather
    // than resting on another group happening to carry them.
    'typing_click',
    'glass_break_1',
    'new_unlock',
    'fireball_launch',
    'gravedigger_wing_drone_loop',
    'gravedigger_mandible_snap_1',
    'gravedigger_mandible_snap_2',
    'gravedigger_mandible_snap_3',
    'gravedigger_mandible_snap_4',
    'beetle_pupa_hatch_1',
    'beetle_pupa_hatch_2',
    'beetle_pupa_hatch_3',
    'beetle_pupa_hatch_4',
    'lizardman_venom_numb',
    ...ACID_LLAMA_SFX_IDS,
    ...FUZZY_NIGHTMARE_SFX_IDS,
    'fireball_burst',
    'powering_off',
    'rat_squeak_1',
    'rat_squeak_2',
    'rat_squeak_3',
    'scientist_exclaiming_about_an_escape',
    'scientist_explaining_request',
    'spider_walking',
    'tech_machinery_running',
    'wereboar_grunt_1',
    'wereboar_grunt_2',
    'wereboar_grunt_3',
    'wereboar_grunt_4',
    ...DUNGEON_CUE_SFX_IDS,
    ...FAIRY_SFX_IDS,
    ...RAISED_SKELETON_SFX_IDS,
    ...BOMBER_GOBLIN_SFX_IDS,
    ...ELECTRIC_GOBLIN_SFX_IDS,
  ],

  /**
   * The floor-3 overworld/town itself: Hawkfolk, Ravelings, Giant Wasps and the
   * Lizardman camps' venom in the wilderness,
   * Deinonychus/mercenary escorts, the Dark Knight's rumble, and the paper of the notice
   * boards in the square and in Briar Hollow.
   */
  level3: [
    ...INTERIOR_CUES.noticeUnfold,
    'hawkfolk_1',
    'hawkfolk_2',
    ...TOWN_VOICE_SFX_IDS,
    'candle_stand_topple_1',
    'candle_stand_topple_2',
    ...INTERIOR_BREAK_SFX_IDS,
    'raveling_attack',
    'giant_wasp_buzz_loop',
    'giant_wasp_sting_1',
    'giant_wasp_sting_2',
    'giant_wasp_sting_3',
    'giant_wasp_sting_4',
    'giant_wasp_venom_spit_1',
    'giant_wasp_venom_spit_2',
    'giant_wasp_venom_spit_3',
    'lizardman_venom_numb',
    'sword_attack_1',
    'rumble',
    ...FAIRY_SFX_IDS,
    ...RAISED_SKELETON_SFX_IDS,
    'tree_fall_1',
    'tree_fall_2',
    'tree_fall_3',
    'tree_fall_4',
    ...BOMBER_GOBLIN_SFX_IDS,
    // A hireling's thrown rocks and the earth elemental mercenaries' blows.
    'rock_thud_1',
    'rock_thud_2',
    'rock_thud_3',
    'rock_thud_4',
    // Shady's offer can be taken anywhere he stands; decoded on its first play.
    'accepted_bounty',
    // The Dire Bear roams the forest edges of the whole floor.
    'bear_big_attack',
    'bear_growl_1',
    // Lions hunt the open fields, and join the siege's assault waves.
    'lion_aggro_roar',
    'lion_attack_roar_1',
    'lion_attack_roar_2',
    'lion_attack_roar_3',
    'lion_hurt_1',
    'lion_hurt_2',
    'lion_hurt_3',
    'lion_hurt_4',
  ],

  /**
   * Briar Hollow and the work it runs on: the pasture's cows and calves, petting,
   * felling and mining (which reach every tree and boulder on floor 3, not just
   * the village's), wood processing, and the Resourcing thralls.
   */
  briarHollow: [
    'axe_striking_wood',
    'calf_moo_1',
    'calf_moo_2',
    'calf_moo_3',
    'cow_ambient_moo_1',
    'cow_ambient_moo_2',
    'cow_ambient_moo_3',
    'cow_angry_moo_1',
    'cow_angry_moo_2',
    'cow_happy_moo',
    'found_trap_woodchopping',
    'happy_hearts',
    'loopable_sawing',
    'lucky_refined',
    'pickaxe_strike_stone',
    // The village's shops trade outdoors, where the interior commerce group
    // is never loaded.
    'purchase_success',
    'rock_breaking_1',
    'rock_breaking_2',
    'rope_tightening',
    'thrall_fade_out',
    'thrall_summoned',
    // Library sounds the village still borrows for cues with no recording.
    'deep_rumbling',
    'bones_rattling',
    'fairy_raise_call',
    // Recorded village sounds.
    'anvil_strike_1',
    'anvil_strike_2',
    'anvil_strike_3',
    'doctor_treatment',
    'construction_complete',
    'repairing_loop',
    'ratkin_chatter_1',
    'ratkin_chatter_2',
    'ratkin_chatter_3',
    'ratkin_chatter_4',
    'ratkin_chatter_5',
    'ratkin_chatter_6',
    'spikes_add',
    'structure_dismantle',
    'tool_upgrade',
    'trebuchet_load',
    // The defences the party builds stand anywhere outside the town wall, and
    // fight any hostile; their blows, and a soldier's hurt and fall, play
    // unplaced, so they are heard wherever the party is.
    'boulder_fire_whoosh',
    'boulder_impact_1',
    'boulder_impact_2',
    'boulder_impact_3',
    'boulder_impact_4',
    'miasma_hiss',
    'trebuchet_break',
    'trebuchet_fire_1',
    'trebuchet_fire_2',
    'snare_break',
    'snare_convert',
    'snare_trigger',
    'spikes_impale',
    'fence_break',
    'gate_thud',
    'wall_break_stone',
    'wall_break_wood',
    'wall_hit_stone',
    'wall_hit_wood',
    'ratkin_soldier_down',
    'ratkin_soldier_hurt_1',
    'ratkin_soldier_hurt_2',
    'village_gate_close',
    'village_gate_open',
    'wall_upgrade_stone',
    // The Borrowed Blueprints: Plumbline Farm, the pasture fence, the harvest
    // and Midge's escort.
    'blueprint_unroll',
    'cow_hurt_moo_1',
    'cow_hurt_moo_2',
    'cow_hurt_moo_3',
    'cow_lonely_moo_1',
    'cow_lonely_moo_2',
    'cow_lonely_moo_3',
    'cowbell_clank_1',
    'cowbell_clank_2',
    'cowbell_clank_3',
    'fence_post_set',
    'merrit_whistle',
    'rickety_fence_pull_1',
    'rickety_fence_pull_2',
    'scythe_swing_1',
    'scythe_swing_2',
    'scythe_swing_3',
    'scythe_timing_good',
    'scythe_timing_perfect',
    'scythe_unhook',
    'station_upgrade_flourish',
    ...BOMBER_GOBLIN_SFX_IDS,
  ],

  /**
   * The siege of Briar Hollow and the dead it raises, and the Acid Llamas and
   * Fuzzy Nightmares its waves bring: the bell, the militia's
   * orders and blows, Vordrick and his raised ratkin and grave bulls, the
   * victory. Every one plays only near the village, during a siege or while
   * its dead still stand, or on Midge's escort (whose ambushers are the same
   * dead), so floor 3 decodes it only then (`FloorSfxGates`).
   */
  briarHollowSiege: [
    ...ACID_LLAMA_SFX_IDS,
    ...FUZZY_NIGHTMARE_SFX_IDS,
    'bell_alarm',
    'bell_crack',
    'bell_toll_hit',
    'bell_victory_peal',
    'briar_hollow_victory',
    'firework_burst_1',
    'firework_burst_2',
    'firework_burst_3',
    'firework_burst_4',
    'firework_launch_1',
    'firework_launch_2',
    'firework_launch_3',
    'firework_launch_4',
    'ratkin_soldier_ack_1',
    'ratkin_soldier_ack_2',
    'ratkin_soldier_ack_3',
    'ratkin_soldier_strike_1',
    'ratkin_soldier_strike_2',
    'ratkin_soldier_strike_3',
    'necro_war_horn',
    'necromancer_arrival',
    'necromancer_blink',
    'necromancer_bolt',
    'necromancer_death',
    'necromancer_hurt_1',
    'necromancer_hurt_2',
    'necromancer_hurt_3',
    'necromancer_hurt_4',
    'necromancer_pulse_charge',
    'necromancer_pulse_release',
    'necromancer_raise',
    'grave_bull_bellow',
    'grave_bull_charge',
    'raised_ratkin_death',
    'raised_ratkin_groan',
    // The raised ratkin's squeak layer under its recorded death.
    'rat_squeak_1',
    'rat_squeak_2',
    'rat_squeak_3',
    // Borrowed for the stone wall's break, the necromancer's pulse and the
    // grave bull's collapse.
    'deep_rumbling',
    'bones_rattling',
    // The clowns and lemurs the waves send.
    'clown_burp',
    'clown_come_here',
    'clown_horn',
    'clown_laughing_1',
    'clown_laughing_2',
    'lemur_attack',
    'lemur_sound',
  ],

  /**
   * Every sound behind Wendell's construction contracts (`CONTRACT_CUES`).
   * Contract spots sit on the streets and inside buildings, so the floor-3
   * bundle and every interior load this group rather than trusting the
   * overworld's bundle to still be resident behind a door.
   */
  constructionContracts: decodedCueIds(CONTRACT_CUES),

  /**
   * Every sound behind the Clogged Bathroom (`BATHROOM_CUES`). The bathroom
   * only stands on floor 2's gauntlet branches, so floor 2 loads this group.
   */
  cloggedBathroom: decodedCueIds(BATHROOM_CUES),

  /**
   * Every sound behind the Stealth Key Snatch (`PRISON_CUES`): the gate room
   * on floor 2's spine and the prison behind its door.
   */
  stealthKeySnatch: decodedCueIds(PRISON_CUES),

  /**
   * Every sound behind the storm drain (`SEWER_CUES`): the sewer's sluices
   * and its rats. Only the drain's grate opens onto it, so only its interior
   * loads this group.
   */
  stormDrain: decodedCueIds(SEWER_CUES),

  /**
   * Every sound behind the tower's storey works (`TOWER_CUES`), and the
   * cistern's sluice, which is worked like the sewer's (`SEWER_CUES`). The
   * tower is entered at its door or up the sewer's culvert, so only its
   * interior loads this group.
   */
  towerStoreys: [...decodedCueIds(TOWER_CUES), ...decodedCueIds(SEWER_CUES)],

  /**
   * Every sound behind Pest Control (`SPIDER_QUEST_CUES`): Dr. Moult's calls,
   * Dave's message and the lab hallway's small sounds, all on floor 2.
   */
  spiderQuest: decodedCueIds(SPIDER_QUEST_CUES),

  /**
   * Shady's five bounty bosses (`bountyDefs.ts`/`BountySystem`, floor-3
   * overworld only), plus the bounty hand-off cues themselves. Each boss now
   * owns most of its voice, but the ids still borrowed from a level1/level2
   * boss — see the remaining `[STAND-IN]` comments in
   * `GameLoopPhases.playMobAudioCues` — need their own preload here even though
   * the sample itself "belongs" to another floor.
   *
   * The siege of Briar Hollow fields the same bosses as its bounty marks, so
   * floor 3 holds this group while a bounty is out or a siege is on.
   */
  bounty: [
    'accepted_bounty',
    // The Evil Clown's troupe: its fat clown's burp.
    'clown_burp',
    'bones_rattling',
    'bounty_fight_engaged',
    'clown_horn',
    'clown_laughing_1',
    'clown_laughing_2',
    'dead_hand_wave',
    'gas_cloud',
    'glass_break_1',
    'glass_break_2',
    'glass_break_3',
    'glass_break_4',
    'hammer_strike',
    'dumbbell_throw',
    'knight_magic_windup',
    'laser_1',
    'laser_2',
    'laser_3',
    'magic_ball_impact',
    'magic_ball_launch',
    'mantid_furious',
    'mantid_hiss_1',
    'mantid_hiss_2',
    'mantid_hiss_3',
    'mantid_hiss_4',
    'mantid_hiss_5',
    'massive_metal_hit',
    'massive_strike_with_dirt_impact',
    'massive_weapon_strike',
    'metal_winding_up',
    'prepare_for_magic_strike',
    'rock_golem_death',
    'rock_golem_frustrated',
    'rock_golem_grunt',
    'rock_thud_1',
    'rock_thud_2',
    'rock_thud_3',
    'rock_thud_4',
    'rolling_earth_ball',
    'skeleton_lord_chant',
    'skeleton_lord_death',
    'slash_strike_1',
    'slash_strike_2',
    'slash_strike_3',
    'small_magic_impact_1',
    'small_magic_impact_2',
    'small_magic_impact_3',
    'wood_breaking_1',
    'wood_breaking_2',
  ],

  /**
   * The Kraken's fight music. Its stems change over at one point in a loop
   * and every loop repeats with no gap, which only a decoded buffer does, and
   * decoded they are about 100 MB, so they are held only near her room.
   */
  floodedPumpRoomMusic: [...MUSIC_STEM_SETS.kraken_flooded, KRAKEN_BATTLE_TRACK],
  /**
   * The Trash Gremlin's fight music. A short loop that repeats for the whole
   * fight, so it is decoded to loop with no gap, and held only near his room.
   */
  trashGremlinMusic: ['king_of_the_heap'],
  /**
   * The Warden's fight music at the top of the Town Center Tower. Its two
   * stems change over at one point in the loop, which only a decoded buffer
   * does, so they are held only from the storey below the cattery up, while
   * the ritual is still ahead.
   */
  wardenRitualMusic: [...MUSIC_STEM_SETS.warden_ritual],
  /**
   * The tower's music while the party is split and climbing back up: one
   * stem for Belle's side, one for the human's, and the full mix once they
   * are together. The stems change over at one point in the loop, which only
   * a decoded buffer does, so they are held only inside the tower, from
   * Belle waking in her cage until the Warden is gone.
   */
  towerSplitMusic: [...MUSIC_STEM_SETS.tower_split],
  /**
   * The Starlight Tent maze's cues (`STARLIGHT_TENT_CUES`), the grounds' high striker, the
   * voices of the clowns guarding the finale ring's chest, and the rope ladder out of that
   * ring (`INTERIOR_EXIT_FIXTURES`). Floor 3 holds this group near the circus grounds; the
   * Starlight Tent declares it itself.
   */
  starlightTent: [
    ...starlightTentCueSoundIds(),
    'high_striker_bell',
    'rope_ladder_climb',
    'clown_burp',
    'clown_horn',
    'clown_laughing_1',
    'clown_laughing_2',
  ],

  /**
   * `LichBattleSystem`'s cues at the top of the tower, and the Lich's cast
   * wind-up and death, which it shares with the Skeleton Lord.
   *
   * Listed here even where a cue also lives in `bounty` or `starlightTent`,
   * which floor 3 happens to load as well: `AudioManager.play` returns silently
   * on a buffer that never loaded, so a cue borrowed from an unrelated group is
   * a beat that silently stops happening the day that group drops it.
   * `verify:lich` checks every cue the fight plays is loaded on its floor.
   */
  lichBattle: [
    'rumble',
    'skeleton_lord_chant',
    'dead_hand_wave',
    'magic_ball_launch',
    'magic_ball_impact',
    'fireball_launch',
    'deep_rumbling',
    'powering_off',
    'charging_up_1',
    'prepare_for_magic_strike',
    'skeleton_lord_death',
  ],

  /** "A Cat Always Comes Back"'s cues in town and in its rooms (`MISSING_CATS_CUES`). */
  missingCats: [...decodedCueIds(MISSING_CATS_CUES), THIEF_GLIDE_LOOP.id],
  /**
   * The stakeout and the rooftop chase's music. Its two stems change over at
   * one point in the loop, which only a decoded buffer does, so they are held
   * only near the General Store or while the stakeout or the chase is on.
   */
  missingCatsStakeout: [...MUSIC_STEM_SETS.rooftop_chase],
  /**
   * The capture at the fountain's jingle, which its cutscene's steps are
   * timed to and so must be decoded before Belle sits down: held anywhere
   * from the moment the bait is agreed until she is taken.
   */
  missingCatsCapture: [CAPTURE_CUE],
  /**
   * The jingle of a lost cat coming back: held near the Sleeping Cat Inn and
   * inside it once the cats are walking home, where Pumpkin walks in on Dave.
   */
  missingCatsReunion: [REUNION_CUE],

  /**
   * `MercenarySystem`/`MercenaryGuildSystem` escorts, who are hired in town and
   * so exist only on floor 3. Deinonychus is NOT here despite the pairing the name
   * suggests: `DungeonScene` builds `DeinonychusSystem` unconditionally, so the pet's
   * own cues are universal.
   */
  deinonychusMercenary: [
    // Tumbledown, the golem for hire, fights with the rock golem's voice.
    'massive_strike_with_dirt_impact',
    'rock_golem_grunt',
    'rock_golem_frustrated',
  ],

  /**
   * The town safe room's doctor — `DoctorSystem`. Empty until the doctor's own
   * recordings land: treatment plays `healing_potion`, which boots with the core.
   */
  interiorDoctor: [],

  /**
   * The dwarf cook figure's voice and kitchen, kept with the figure. Nothing
   * places the cook yet, so no scene loads this group.
   */
  dwarfCook: [
    'dwarf_cook_cooking',
    'dwarf_cook_dish_set_down',
    'dwarf_cook_grunt',
    'dwarf_cook_happy_grunt',
  ],

  /** The Cloak & Dagger's casino games: blackjack, poker, slots and Donald's wheel. */
  interiorCasino: [
    ...Object.values(POKER_CUES).flat(),
    'casino_blackjack_check',
    'casino_chips_bet_big',
    'casino_chips_bet_small',
    'casino_chips_stack',
    'casino_deal_card',
    'casino_deal_four_cards',
    'casino_shuffle_1',
    'casino_shuffle_2',
    'powering_off',
    'permanent_death_final_tone',
    'permanent_death_swallow',
    'wheel_light_bulb_dying',
    'slots_anticipation_riser',
    'slots_bet_down',
    'slots_bet_up',
    'slots_big_win',
    'slots_coin_hopper_loop',
    'slots_credit_rollup_loop',
    'slots_crowd_cheer_1',
    'slots_crowd_cheer_2',
    'slots_crowd_cheer_3',
    'slots_epic_win',
    'slots_free_spins_trigger',
    'slots_jackpot_siren',
    'slots_lever_pull',
    'slots_line_win_small',
    'slots_max_bet',
    'slots_mega_win',
    'slots_near_miss',
    'slots_payline_trace_1',
    'slots_payline_trace_2',
    'slots_payline_trace_3',
    'slots_reel_stop',
    'slots_reels_spinning_loop',
    'slots_scatter_land_1',
    'slots_scatter_land_2',
    'slots_scatter_land_3',
    'slots_spin_button',
    'donald_chuckle_1',
    'donald_chuckle_2',
    'donald_chuckle_3',
    'wheel_bet_wedge_flip',
    'wheel_confirm_heartbeat_loop',
    'wheel_hold_charge',
    'wheel_land_bad',
    'wheel_land_good',
    'wheel_launch',
    'wheel_peg_tick_1',
    'wheel_peg_tick_2',
    'wheel_peg_tick_3',
    'wheel_peg_tick_4',
    'wheel_robbed_coin_drain',
    'wheel_slow_creak',
    'wheel_spin_again',
    'wheel_warning_klaxon_loop',
  ],

  /** Any priced transaction indoors: shops, the tavern, temple, tattoo parlor, mercenary guild. */
  interiorCommerce: ['purchase_success'],

  /**
   * Every sound behind a room's interactables (`INTERIOR_CUES`): counter bells
   * and tills, readables, searched containers and used props. Placed props
   * stand in every building, so every interior loads this group.
   */
  interiorInteractions: decodedCueIds(INTERIOR_CUES),

  /**
   * The loops a room's working furniture makes (`INTERIOR_AMBIENCE_CUES`):
   * fires and the forge. Any building can hold a fire, so every interior
   * loads this group.
   */
  interiorAmbience: decodedCueIds(INTERIOR_AMBIENCE_CUES),

  /**
   * What an occupant's routine sounds (`OCCUPANT_ROUTINE_CUES`): a mop, a
   * crossbow at its target. Any building's roster can run a routine, so every
   * interior loads this group.
   */
  interiorRoutines: occupantRoutineSoundIds().filter((id) => !STREAMING_SOUND_IDS.has(id)),

  /**
   * The tutorial's gates (`TUTORIAL_CUES`), which only its hand-built cellar
   * raises, and the dungeon's own cues: its cellar is dressed like floor 1's,
   * so it drips, settles and has torches and candles to smash.
   */
  tutorial: [...decodedCueIds(TUTORIAL_CUES), ...DUNGEON_CUE_SFX_IDS],

  /**
   * No id currently lands here — every non-streaming `SoundId` found a home
   * in one of the groups above. Kept as a documented catch-all so a future id
   * with no obvious floor/boss/quest/interior still has somewhere safe to go
   * instead of being silently dropped.
   */
  misc: [],
};

/** Every id preloaded at boot, before any level has been entered. */
export const CORE_SFX_IDS: readonly SoundId[] = SFX_GROUPS.universal;

/**
 * Floor 3's groups held for as long as the floor is: what can sound anywhere
 * on it, at any moment. The questlines and the siege that can only sound in
 * one place or while they run are {@link GATED_SFX_GROUPS}, held and let go by
 * `FloorSfxGates` as the party nears them or they start.
 */
const LEVEL3_SFX_GROUPS: readonly SfxGroup[] = [
  'level3',
  'briarHollow',
  'constructionContracts',
  'lichBattle',
  'missingCats',
  'deinonychusMercenary',
];

/**
 * Groups decoded only while something can play them (`FloorSfxGates`): floor
 * 3's siege, bounties and circus, and floor 1's Kraken and Trash Gremlin fight music.
 */
export const GATED_SFX_GROUPS = [
  'briarHollowSiege',
  'bounty',
  'starlightTent',
  'floodedPumpRoomMusic',
  'trashGremlinMusic',
  'missingCatsStakeout',
  'missingCatsCapture',
  'missingCatsReunion',
  'wardenRitualMusic',
  'towerSplitMusic',
] as const satisfies readonly SfxGroup[];

export type GatedSfxGroup = (typeof GATED_SFX_GROUPS)[number];

/** Floor 3's gated groups, whose one-shots a scene keeps compressed (`compressedSfxForLevelId`). */
const LEVEL3_GATED_SFX_GROUPS = [
  'briarHollowSiege',
  'bounty',
  'starlightTent',
] as const satisfies readonly GatedSfxGroup[];

/** Every id in a gated group. */
export const GATED_SFX_IDS: ReadonlySet<SoundId> = new Set(
  GATED_SFX_GROUPS.flatMap((group) => SFX_GROUPS[group]),
);

/**
 * Ids a floor's scenes keep compressed: the gated groups on floor 3, so a cue
 * played while its group is let go decodes on demand rather than going unheard.
 * Floor 1's fight music needs none: a music track missing its buffer is
 * fetched and decoded when it is claimed.
 */
export function compressedSfxForLevelId(levelId: LevelId): readonly SoundId[] {
  return levelId === 'level3' ? LEVEL3_GATED_SFX_GROUPS.flatMap((group) => SFX_GROUPS[group]) : [];
}

/** Floor 2's own cues plus the quests that only appear there. */
const LEVEL2_SFX_GROUPS: readonly SfxGroup[] = [
  'level2',
  'cloggedBathroom',
  'stealthKeySnatch',
  'spiderQuest',
];

/** Which `SfxGroup`s a `DungeonScene` should preload for the level it just entered. */
export function sfxGroupsForLevelId(levelId: LevelId): readonly SoundId[] {
  return sfxGroupsOf(levelId).flatMap((group) => SFX_GROUPS[group]);
}

function sfxGroupsOf(levelId: LevelId): readonly SfxGroup[] {
  switch (levelId) {
    case 'tutorial':
      return ['tutorial'];
    case 'level1':
      return ['level1'];
    case 'level2':
      return LEVEL2_SFX_GROUPS;
    case 'level3':
      return LEVEL3_SFX_GROUPS;
    default: {
      const unhandled: never = levelId;
      return unhandled;
    }
  }
}

/**
 * Which `SfxGroup`s a `BuildingInteriorScene` should preload for the interior
 * it just entered. Every enterable building is on the floor-3 overworld (see
 * `BuildingInteriorScene`'s own comment to that effect), so `level3`'s bundle
 * is already loaded by the time a door opens — this only adds what is
 * specific to what is *behind* the door. `sellsSomething` is whether coin
 * changes hands over a counter in there, which decides the commerce cues.
 */
export function sfxGroupsForBuildingEntry(
  entry: BuildingEntry,
  { sellsSomething }: { readonly sellsSomething: boolean },
): readonly SoundId[] {
  const groups: readonly SfxGroup[] = [
    'constructionContracts',
    'interiorInteractions',
    'interiorAmbience',
    'interiorRoutines',
    ...(entry.hasSafeRoom === true ? (['interiorDoctor'] as const) : []),
    ...(entry.type === 'club' ? (['interiorCasino'] as const) : []),
    ...(sellsSomething ? (['interiorCommerce'] as const) : []),
    ...(entry.type === 'prison' ? (['stealthKeySnatch'] as const) : []),
    ...(entry.id === STORM_DRAIN_ID ? (['stormDrain'] as const) : []),
    ...(entry.id === TOWN_TOWER_ID ? (['towerStoreys'] as const) : []),
  ];
  return groups.flatMap((group) => SFX_GROUPS[group]);
}
