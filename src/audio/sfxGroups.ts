import type { SoundId } from './sounds';
import type { BuildingEntry } from '../systems/BuildingSystem';
import { interiorSellsSomething } from '../systems/townServices';

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
  | 'bounty'
  | 'circusQuest'
  | 'murderMysteryQuest'
  | 'mongoMercenary'
  | 'interiorBopca'
  | 'interiorCasino'
  | 'interiorCommerce'
  | 'misc';

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
    'player_level_up',
    'player_wading',
    'player_walking',
    'potion_drink',
    'quest_complete',
    'reviving_tone',
    'speed_fizz',
    'splat_1',
    'splat_2',
    'splat_3',
    'stat_boost',
    'treasure_chest_reward',
    'troglodyte_tongue',
    'typing_click',
    'wood_breaking_1',
    'wood_breaking_2',
    'wood_breaking_3',
    'wood_smashing_1',
    'wood_smashing_2',
  ],

  /** The Hoarder + Juicer boss rooms, level1's llama/rat, and its dungeon-generated arena. */
  level1: [
    'hoarder_damage_1',
    'hoarder_damage_2',
    'hoarder_damage_3',
    'hoarder_vomit',
    'juicer_throw',
    'llama_fireball',
    'llama_fireball_explosion',
    'massive_strike_with_dirt_impact',
    'metal_winding_up',
    'rat_squeak_1',
    'rat_squeak_2',
    'rat_squeak_3',
    'tuskling_grunt_1',
    'tuskling_grunt_2',
    'tuskling_grunt_3',
    'tuskling_grunt_4',
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
    'krakaren_slam_rise',
    'krakaren_tentacle_death',
    'krakaren_tentacle_emerge',
    'krakaren_tentacle_strike',
    'krakaren_yell',
    'life_machine_powering_on',
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
  ],

  /**
   * The floor-3 overworld/town itself: sky fowl and Krasue in the wilderness,
   * Mongo/mercenary escorts, and the Dark Knight's rumble (shared with
   * `murderMysteryQuest`'s tower confrontation).
   */
  level3: ['skyfowl_1', 'skyfowl_2', 'krasue_attack', 'sword_attack_1', 'rumble'],

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

  /** `CircusQuestSystem` + `BigTopBossSystem` (Grimaldi, Heather the Bear, the clown troupe). */
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
  ],

  /** `MurderMysteryQuestSystem`, `CultHideoutSystem` and the tower's `QuillConfrontationSystem`. */
  murderMysteryQuest: ['krasue_attack', 'rumble'],

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

  /** The Desperado Club's table — `ClubCasinoSystem`. */
  interiorCasino: [
    'casino_blackjack_check',
    'casino_chips_bet_big',
    'casino_chips_bet_small',
    'casino_chips_stack',
    'casino_deal_card',
    'casino_deal_four_cards',
    'casino_shuffle_1',
    'casino_shuffle_2',
    'powering_off',
  ],

  /** Any priced transaction indoors: shops, the tavern, temple, tattoo parlor, mercenary guild, VIP lounge. */
  interiorCommerce: ['purchase_success'],

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
 * mystery questlines and Mongo/mercenary escorts can appear (`BountySystem`,
 * `CircusQuestSystem` etc. are all constructed only for that level def), so
 * its groups are bundled together rather than requiring each system to
 * preload for itself.
 */
const LEVEL3_SFX_GROUPS: readonly SfxGroup[] = [
  'level3',
  'bounty',
  'circusQuest',
  'murderMysteryQuest',
  'mongoMercenary',
];

/** Which `SfxGroup`s a `DungeonScene` should preload for the level it just entered. */
export function sfxGroupsForLevelId(levelId: string): readonly SoundId[] {
  const groups: readonly SfxGroup[] =
    levelId === 'level1'
      ? ['level1']
      : levelId === 'level2'
        ? ['level2']
        : levelId === 'level3'
          ? LEVEL3_SFX_GROUPS
          : // Tutorial and any future level with no dedicated group: universal
            // already covers menu/combat cues, so there is nothing floor-specific
            // to add — falling through to `misc` is deliberate, not a gap.
            ['misc'];
  return groups.flatMap((group) => SFX_GROUPS[group]);
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
    ...(entry.hasSafeRoom === true ? (['interiorBopca'] as const) : []),
    ...(entry.type === 'club' ? (['interiorCasino'] as const) : []),
    ...(sellsSomething ? (['interiorCommerce'] as const) : []),
  ];
  return groups.flatMap((group) => SFX_GROUPS[group]);
}
