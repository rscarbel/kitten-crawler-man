import { STREAMING_SOUND_IDS, type SoundId } from './sounds';
import type { BuildingEntry } from '../systems/BuildingSystem';
import { interiorSellsSomething } from '../systems/townServices';
import { CONTRACT_CUES } from '../systems/constructionContracts/contractSoundCues';
import { BATHROOM_CUES } from '../systems/cloggedBathroom/bathroomSoundCues';
import { PRISON_CUES } from '../systems/stealthKeySnatch/prisonSoundCues';
import { SPIDER_QUEST_CUES } from '../systems/spiderQuest/spiderQuestSoundCues';
import { TUTORIAL_CUES } from '../systems/tutorialSoundCues';
import { TUTORIAL_LEVEL_ID } from '../levels/tutorial';
import { INTERIOR_CUES } from '../systems/interiorInteractionSoundCues';
import { POKER_CUES } from '../systems/casino/poker/pokerSoundCues';

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
  | 'constructionContracts'
  | 'cloggedBathroom'
  | 'stealthKeySnatch'
  | 'spiderQuest'
  | 'bounty'
  | 'circusQuest'
  | 'murderMysteryQuest'
  | 'mongoMercenary'
  | 'interiorBopca'
  | 'interiorCasino'
  | 'interiorCommerce'
  | 'interiorInteractions'
  | 'tutorial'
  | 'misc';

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

/** Sounds `DUNGEON_CUES` (`dungeonSoundCues.ts`) plays that no boot-loaded group carries; floors 1 and 2 share it. */
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
  'vending_glass_smash_1',
  'vending_glass_smash_2',
  'vending_glass_smash_3',
  'vending_glass_smash_4',
  'wet_sign_skid',
  ...INTERIOR_BREAK_SFX_IDS,
];

/**
 * Over City citizens' voices, spoken through the dialog box when a
 * conversation opens (the `townsfolk*` styles in `src/dialog/speakers.ts`).
 * Streets and every building interior share the floor-3 bundle that carries them.
 */
const TOWN_VOICE_SFX_IDS: readonly SoundId[] = [
  'skyfowl_chatter_1',
  'skyfowl_chatter_2',
  'skyfowl_greeting_1',
  'skyfowl_greeting_2',
  'skyfowl_laugh_1',
  'skyfowl_elder_chatter_1',
  'skyfowl_elder_chatter_2',
  'skyfowl_elder_chatter_3',
  'skyfowl_fledgling_chirp_1',
  'skyfowl_wing_ruffle_1',
  'skyfowl_wing_ruffle_2',
  'skyfowl_talon_steps',
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
    'ability_level_up',
    'achievement_awarded',
    // Mongo's own three cues. `DungeonScene` constructs `MongoSystem` for every
    // floor, so the pet can be out anywhere the ability is unlocked.
    'bite_1',
    'bite_2',
    'bite_3',
    'mongo_released',
    'mongo_slash',
    'achievement_unlocked',
    // Chewing solid food. The Bopca's diners use it indoors, but a hamburger
    // is eaten from the bag wherever the party happens to be.
    'bopca_eating',
    'boss_defeated',
    'cat_effect_damage_1',
    'cat_effect_damage_2',
    'cat_effect_damage_3',
    'cat_knocked_out',
    'cat_missile_fire',
    'cat_missile_impact',
    'cat_revived',
    'cat_scratch',
    'cat_splash',
    // The Wayfinder's Anchor's channel start / completion — usable from any
    // scene the item can be carried into, same reasoning as `confusing_fog`
    // and `speed_fizz` just below.
    'charging_up_1',
    'chest_locked',
    'chest_unlocked_in_treasure_room',
    'coin_pouch',
    'confusing_fog',
    'cooldown_crisp',
    'death_sequence',
    'dynamite_explosion',
    'entered_safe_room',
    'error',
    'error_taking_action',
    // The save indicator can fire from any floor or interior a checkpoint is
    // taken on, so its cue has to be decoded before the first one can play.
    'game_saving',
    'gate_opening',
    // Goblin and troglodyte spawn on every one of level1/level2/level3 (see
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
    'human_protective_shell',
    'human_punch_1',
    'human_punch_2',
    'human_punch_3',
    'human_punch_weak',
    'human_revived',
    'human_smush',
    'human_splash',
    'jugg_juice',
    'level_begins',
    'level_complete',
    'menu_change_follower',
    'menu_click',
    'menu_drop_item',
    'menu_expand_map',
    'menu_open',
    'menu_skillpoint_spent',
    'mob_splash',
    'new_unlock',
    'objective_complete',
    'opening_reward_box',
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
    // Eating anything brothy with a spoon. A safe room's Bopca serves soups and
    // stews on every floor, so it can't wait for a floor group.
    'slurping_soup',
    'speed_fizz',
    'splat_1',
    'splat_2',
    'splat_3',
    'stat_boost',
    'teleport',
    'treasure_chest_reward',
    'troglodyte_tongue',
    'typing_click',
    'wood_breaking_1',
    'wood_breaking_2',
    'wood_breaking_3',
    'wood_smashing_1',
    'wood_smashing_2',
    // Reward flow, timers, save chime and the pet's happy squawks: any floor can fire them.
    'coin_land_tick',
    'garbage_bag_burst_1',
    'garbage_bag_burst_2',
    'happy_adult_mongo_squawk_1',
    'happy_adult_mongo_squawk_2',
    'happy_adult_mongo_squawk_3',
    'happy_adult_mongo_squawk_4',
    'happy_baby_mongo_squawk_1',
    'happy_baby_mongo_squawk_2',
    'happy_baby_mongo_squawk_3',
    'happy_baby_mongo_squawk_4',
    'item_bag_pop',
    'level_timer_final_minute_heartbeat',
    'level_timer_warning',
    'loot_box_lid_burst',
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
    'platinum_box_reveal',
    'splatter_orb_orbit_loop',
    'splatter_orb_seek',
    'splatter_orb_spawn',
    'taranis_chain_lightning_1',
    'taranis_chain_lightning_2',
    'taranis_chain_lightning_3',
    'taranis_chain_lightning_4',
    'taranis_swing_1',
    'taranis_swing_2',
    'taranis_swing_3',
    'taranis_swing_4',
    'taranis_wave_hit_1',
    'taranis_wave_hit_2',
    'taranis_wave_hit_3',
    'taranis_wave_hit_4',
    // Carl can draw, swing and land a weapon, and either crawler can put on
    // gear, anywhere.
    'slash_strike_1',
    'slash_strike_2',
    'slash_strike_3',
    'blunt_hit_flesh_1',
    'blunt_hit_flesh_2',
    'blunt_hit_flesh_3',
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
    'loot_box_tier_stinger',
    'stairwell_save_chime',
    'velociraptor_chitter',
  ],

  /** The Hoarder + Juicer boss rooms, level1's llama/rat, and its dungeon-generated arena. */
  level1: [
    'hoarder_damage_1',
    'hoarder_damage_2',
    'hoarder_damage_3',
    'hoarder_vomit',
    'juicer_grunt',
    'juicer_throw',
    'llama_fireball',
    'llama_fireball_explosion',
    'massive_strike_with_dirt_impact',
    'rat_squeak_1',
    'rat_squeak_2',
    'rat_squeak_3',
    'tuskling_grunt_1',
    'tuskling_grunt_2',
    'tuskling_grunt_3',
    'tuskling_grunt_4',
    ...DUNGEON_CUE_SFX_IDS,
    ...FAIRY_SFX_IDS,
    ...RAISED_SKELETON_SFX_IDS,
  ],

  /** Krakaren clone boss room, Ball of Swine, the spider lab quest, level2's llama/rat/arena. */
  level2: [
    'ball_of_swine_rolling',
    'deep_rumbling',
    'flesh_being_sliced',
    'grotesque_spider_screech_attack',
    'grotesque_spider_slam_attack',
    'grotesque_spider_spit_attack',
    'grotesque_spider_spit_landing',
    'keyboard_hero_music_track_1',
    'krakaren_ground_slam',
    'krakaren_junction_burst',
    'krakaren_junction_dead',
    'krakaren_slam_rise',
    'krakaren_spark_buzz',
    'krakaren_tentacle_death',
    'krakaren_tentacle_emerge',
    'krakaren_tentacle_strike',
    'krakaren_yell',
    'life_machine_powering_on',
    // The keyboard-hero board's own feedback: the per-hit terminal tick, a
    // firewall pip shattering, and the success stinger. Only the pip's glass is
    // new to this floor; the other two are already boot-loaded by `universal`,
    // and are named here so the board's needs are legible in one place rather
    // than resting on another group happening to carry them.
    'typing_click',
    'glass_break_1',
    'new_unlock',
    'llama_fireball',
    'llama_fireball_explosion',
    'powering_off',
    'rat_squeak_1',
    'rat_squeak_2',
    'rat_squeak_3',
    'scientist_exclaiming_about_an_escape',
    'scientist_explaining_request',
    'spider_walking',
    'tech_machinery_running',
    'tuskling_grunt_1',
    'tuskling_grunt_2',
    'tuskling_grunt_3',
    'tuskling_grunt_4',
    // The colosseum's portcullis landing.
    'massive_metal_hit',
    ...DUNGEON_CUE_SFX_IDS,
    ...FAIRY_SFX_IDS,
    ...RAISED_SKELETON_SFX_IDS,
  ],

  /**
   * The floor-3 overworld/town itself: sky fowl and Krasue in the wilderness,
   * Mongo/mercenary escorts, the Dark Knight's rumble (shared with
   * `murderMysteryQuest`'s tower confrontation), and the paper of the notice
   * boards in the square and in Briar Hollow.
   */
  level3: [
    ...INTERIOR_CUES.noticeUnfold,
    'skyfowl_1',
    'skyfowl_2',
    ...TOWN_VOICE_SFX_IDS,
    'candle_stand_topple_1',
    'candle_stand_topple_2',
    ...INTERIOR_BREAK_SFX_IDS,
    'krasue_attack',
    'sword_attack_1',
    'rumble',
    ...FAIRY_SFX_IDS,
    ...RAISED_SKELETON_SFX_IDS,
    'tree_fall_1',
    'tree_fall_2',
    'tree_fall_3',
    'tree_fall_4',
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
    // The raised ratkin's squeak layer under its recorded death.
    'rat_squeak_1',
    'rat_squeak_2',
    'rat_squeak_3',
    'thrall_fade_out',
    'thrall_summoned',
    // Library sounds the village still borrows for cues with no recording: the
    // stone-wall break and the necromancer's pulse release (`deep_rumbling`), the
    // grave bull's collapse and a fairy's raise call.
    'deep_rumbling',
    'bones_rattling',
    'fairy_raise_call',
    // Recorded village sounds.
    'anvil_strike_1',
    'anvil_strike_2',
    'anvil_strike_3',
    'bell_toll_hit',
    'boulder_fire_whoosh',
    'doctor_treatment',
    'miasma_hiss',
    'necromancer_arrival',
    'necromancer_blink',
    'necromancer_hurt_1',
    'necromancer_hurt_2',
    'necromancer_hurt_3',
    'necromancer_hurt_4',
    'ratkin_soldier_ack_1',
    'ratkin_soldier_ack_2',
    'ratkin_soldier_ack_3',
    'ratkin_soldier_down',
    'ratkin_soldier_hurt_1',
    'ratkin_soldier_hurt_2',
    'snare_convert',
    'bell_alarm',
    'bell_crack',
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
    'boulder_impact_1',
    'boulder_impact_2',
    'boulder_impact_3',
    'boulder_impact_4',
    'construction_complete',
    'repairing_loop',
    'fence_break',
    'gate_thud',
    'grave_bull_bellow',
    'grave_bull_charge',
    'necro_war_horn',
    'necromancer_bolt',
    'necromancer_death',
    'necromancer_pulse_charge',
    'necromancer_pulse_release',
    'necromancer_raise',
    'raised_ratkin_death',
    'raised_ratkin_groan',
    'ratkin_chatter_1',
    'ratkin_chatter_2',
    'ratkin_chatter_3',
    'ratkin_chatter_4',
    'ratkin_chatter_5',
    'ratkin_chatter_6',
    'ratkin_soldier_strike_1',
    'ratkin_soldier_strike_2',
    'ratkin_soldier_strike_3',
    'snare_break',
    'snare_trigger',
    'spikes_add',
    'spikes_impale',
    'structure_dismantle',
    'tool_upgrade',
    'trebuchet_break',
    'trebuchet_fire_1',
    'trebuchet_fire_2',
    'trebuchet_load',
    'village_gate_close',
    'village_gate_open',
    'wall_break_stone',
    'wall_break_wood',
    'wall_hit_stone',
    'wall_hit_wood',
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
   * Every sound behind Pest Control (`SPIDER_QUEST_CUES`): Dr. Moult's calls,
   * Mordecai's message and the lab hallway's small sounds, all on floor 2.
   */
  spiderQuest: decodedCueIds(SPIDER_QUEST_CUES),

  /**
   * Shady's five bounty bosses (`bountyDefs.ts`/`BountySystem`, floor-3
   * overworld only), plus the bounty hand-off cues themselves. Each boss now
   * owns most of its voice, but the ids still borrowed from a level1/level2
   * boss — see the remaining `[STAND-IN]` comments in
   * `GameLoopPhases.playMobAudioCues` — need their own preload here even though
   * the sample itself "belongs" to another floor.
   */
  bounty: [
    'accepted_bounty',
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
    'juicer_throw',
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

  /** `CircusQuestSystem` + `BigTopMazeSystem` (Grimaldi, Heather the Bear, the clown troupe), and the grounds' high striker. */
  circusQuest: [
    'bear_big_attack',
    'bear_growl_1',
    'circus_lemur_attack',
    'circus_lemur_sound',
    'clown_burp',
    'clown_come_here',
    'clown_horn',
    'clown_laughing_1',
    'clown_laughing_2',
    'grimaldi_plant_moving_1',
    'grimaldi_plant_moving_2',
    'grimaldi_plant_moving_3',
    'grimaldi_vine_taking_damage',
    // The grounds' high striker (`HighStrikerSystem`).
    'high_striker_bell',
    // The lava llama's spit and burst, for the llamas the Briar Hollow siege
    // sends: floor 3 loads neither the level-1 nor the level-2 group.
    'llama_fireball',
    'llama_fireball_explosion',
    // `BIG_TOP_CUES`, some of them also universal. Declared here so the tent's
    // audio does not hang on another group keeping a sound it borrowed;
    // `verify:bigtop` fails on any cue id missing from this group.
    'cage_door_release',
    'capstan_ratchet',
    'curtain_rise',
    'error',
    'feeding_bell_ring',
    'fire_breather_whoosh_1',
    'fire_breather_whoosh_2',
    'fire_breather_whoosh_3',
    'fire_breather_whoosh_4',
    'fire_breather_whoosh_5',
    'fire_grate_kindle_1',
    'fire_grate_kindle_2',
    'fire_grate_kindle_3',
    'followspot_swing',
    'gate_opening',
    'healing_potion',
    'limelight_ignite',
    'mirror_pivot_1',
    'mirror_pivot_2',
    'mirror_pivot_3',
    'mirror_pivot_4',
    'mirror_pivot_5',
    'phantom_applause_1',
    'phantom_applause_2',
    'phantom_applause_3',
    'reviving_tone',
    'sandbag_drop',
    'slide_whistle_fall',
    'star_target_lit',
    'wood_breaking_1',
    // Heather's and Terror's hard-mode healers.
    ...FAIRY_SFX_IDS,
  ],

  /**
   * `MurderMysteryQuestSystem`, `CultHideoutSystem` and the tower's
   * `QuillConfrontationSystem` — including every cue the systems of the finale
   * play directly.
   *
   * Listed here even where a cue also lives in `bounty` or `circusQuest`, which
   * floor 3 happens to load as well: leaning on that makes this fight's audio
   * correct only for as long as an unrelated group keeps a sound it borrowed,
   * and `AudioManager.play` returns silently on a buffer that never loaded, so
   * the failure is a beat that simply does not happen. Two of these were silent
   * on floor 3 for exactly that reason, one of them the cue that announces the
   * strike window.
   *
   * The Lich's *creature* cues — its damage grunt, its death, its cast wind-up,
   * and its raised skeletons' swings — are played by the shared mob-audio drain
   * rather than from here, and still come from `bounty`. `verify:lich` checks
   * what these systems play; it does not reach that drain.
   */
  murderMysteryQuest: [
    'krasue_attack',
    'rumble',
    'skeleton_lord_chant',
    'dead_hand_wave',
    'magic_ball_launch',
    'magic_ball_impact',
    'llama_fireball',
    'deep_rumbling',
    'powering_off',
    'charging_up_1',
    // Miss Quill's and the Lich's hard-mode healers.
    ...FAIRY_SFX_IDS,
  ],

  /**
   * `MercenarySystem`/`MercenaryGuildSystem` escorts, who are hired in town and
   * so exist only on floor 3. Mongo is NOT here despite the pairing the name
   * suggests: `DungeonScene` builds `MongoSystem` unconditionally, so the pet's
   * own cues are universal.
   */
  mongoMercenary: ['sword_attack_1'],

  /** The town safe room's Bopca cook — `BopcaSystem`. */
  interiorBopca: [
    'bopca_cooking',
    'bopca_dish_set_down',
    'bopca_eating',
    'bopca_grunt',
    'bopca_happy_grunt',
  ],

  /** The Desperado Club's casino games: blackjack, poker, slots and Tito's wheel. */
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
    'nothing_final_tone',
    'nothing_void_swallow',
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
    'tito_chuckle_1',
    'tito_chuckle_2',
    'tito_chuckle_3',
    'tito_stab',
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

  /** Any priced transaction indoors: shops, the tavern, temple, tattoo parlor, mercenary guild, VIP lounge. */
  interiorCommerce: ['purchase_success'],

  /**
   * Every sound behind a room's interactables (`INTERIOR_CUES`): counter bells
   * and tills, readables, searched containers and used props. Placed props
   * stand in every building, so every interior loads this group.
   */
  interiorInteractions: decodedCueIds(INTERIOR_CUES),

  /** The tutorial's gates (`TUTORIAL_CUES`): only its hand-built cellar raises them. */
  tutorial: decodedCueIds(TUTORIAL_CUES),

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
 * The floor-3 overworld is the only place bounty bosses, the circus/murder-
 * mystery questlines, Briar Hollow and Mongo/mercenary escorts can appear (`BountySystem`,
 * `CircusQuestSystem` etc. are all constructed only for that level def), so
 * its groups are bundled together rather than requiring each system to
 * preload for itself.
 */
const LEVEL3_SFX_GROUPS: readonly SfxGroup[] = [
  'level3',
  'briarHollow',
  'constructionContracts',
  'bounty',
  'circusQuest',
  'murderMysteryQuest',
  'mongoMercenary',
];

/** Floor 2's own cues plus the quests that only appear there. */
const LEVEL2_SFX_GROUPS: readonly SfxGroup[] = [
  'level2',
  'cloggedBathroom',
  'stealthKeySnatch',
  'spiderQuest',
];

/** Which `SfxGroup`s a `DungeonScene` should preload for the level it just entered. */
export function sfxGroupsForLevelId(levelId: string): readonly SoundId[] {
  const groups: readonly SfxGroup[] =
    levelId === 'level1'
      ? ['level1']
      : levelId === 'level2'
        ? LEVEL2_SFX_GROUPS
        : levelId === 'level3'
          ? LEVEL3_SFX_GROUPS
          : levelId === TUTORIAL_LEVEL_ID
            ? ['tutorial']
            : // Any future level with no dedicated group: universal already
              // covers menu/combat cues, so there is nothing floor-specific to
              // add — falling through to `misc` is deliberate, not a gap.
              ['misc'];
  return groups.flatMap((group) => SFX_GROUPS[group]);
}

/** {@link sfxGroupsForLevelId} for the floor a building stands on, by its number. */
export function sfxGroupsForFloorNumber(floorNumber: number): readonly SoundId[] {
  return sfxGroupsForLevelId(`level${floorNumber}`);
}

/**
 * Which `SfxGroup`s a `BuildingInteriorScene` should preload for the interior
 * it just entered. Every enterable building is on the floor-3 overworld (see
 * `BuildingInteriorScene`'s own comment to that effect), so `level3`'s bundle
 * is already loaded by the time a door opens — this only adds what is
 * specific to what is *behind* the door.
 */
export function sfxGroupsForBuildingEntry(entry: BuildingEntry): readonly SoundId[] {
  const sellsSomething =
    entry.type === 'club' ||
    entry.type === 'store' ||
    (entry.type === 'house' && interiorSellsSomething(entry.name));
  const groups: readonly SfxGroup[] = [
    'constructionContracts',
    'interiorInteractions',
    ...(entry.hasSafeRoom === true ? (['interiorBopca'] as const) : []),
    ...(entry.type === 'club' ? (['interiorCasino'] as const) : []),
    ...(sellsSomething ? (['interiorCommerce'] as const) : []),
    ...(entry.type === 'prison' ? (['stealthKeySnatch'] as const) : []),
  ];
  return groups.flatMap((group) => SFX_GROUPS[group]);
}
