import { SOUND_MANIFEST, type SoundId } from './sounds';

/**
 * How a one-shot behaves when it is asked to play: how many copies may sound
 * at once, how close together, what it may steal a voice from, how it varies
 * take to take, whether it ducks the music and how far away it is heard.
 *
 * Traits are looked up per id ({@link soundTraits}): an id's own entry, over
 * its cue family's, over its folder's, over {@link DEFAULT_SOUND_TRAITS}.
 */

/**
 * Which voices a sound may take when every voice is busy: a new sound steals
 * the oldest voice of the lowest priority at or below its own, and is dropped
 * when everything playing outranks it.
 */
export type SoundPriority = 'low' | 'normal' | 'high';

export const SOUND_PRIORITY_RANK = {
  low: 0,
  normal: 1,
  high: 2,
} as const satisfies Record<SoundPriority, number>;

/** How far a sound lowers the music while it plays, and how the music comes back. */
export interface MusicDuckTrait {
  /** The music's level under the sound, in dB below the player's music volume. */
  readonly depthDb: number;
  /** How long the music takes to come back once the sound ends. */
  readonly releaseMs: number;
}

/**
 * A line shown for a cue that carries information the screen may not:
 * `always` shows it every time, `offscreen` only when its `playAt` source is
 * off the camera.
 */
export interface SoundCaption {
  readonly text: string;
  readonly when: 'always' | 'offscreen';
}

/**
 * How a placed sound is heard when its source is off the screen: from
 * further away than its on-screen hearing range, but quieter and with its
 * top end rolled off, so a thing out of sight sounds out of sight.
 */
export interface DistantTreatment {
  /** How far away it is still heard while off screen, in tiles. */
  readonly hearingTiles: number;
  /** The off-screen level, as a share of what distance alone would give. */
  readonly gainScale: number;
  /** The low-pass cut-off it plays through while off screen. */
  readonly lowpassHz: number;
}

export interface SoundTraits {
  /** At most this many copies of the id sound at once; a new one stops the oldest. */
  readonly maxVoices: number;
  /** A second start of the id this soon after the last is dropped. */
  readonly minIntervalMs: number;
  readonly priority: SoundPriority;
  /** Each take's playback rate varies by up to this fraction either way; 0 for none. */
  readonly pitchJitter: number;
  /** Each take's volume varies by up to this fraction either way; 0 for none. */
  readonly volumeJitter: number;
  /** Lowers the music while the sound plays, or null to leave it. */
  readonly duckMusic: MusicDuckTrait | null;
  /** How far away a sound placed in the world with `playAt` is heard, in tiles. */
  readonly hearingTiles: number;
  /**
   * How a `playAt` sound whose source is outside the drawn view is heard
   * instead, or null to hear it the same on screen and off. With no view
   * published every source counts as off screen.
   */
  readonly distantWhenOffscreen: DistantTreatment | null;
  /** What the caption lane says when the sound plays, or null for nothing. */
  readonly caption: SoundCaption | null;
}

export const DEFAULT_SOUND_TRAITS = {
  maxVoices: 4,
  minIntervalMs: 30,
  priority: 'normal',
  pitchJitter: 0,
  volumeJitter: 0,
  duckMusic: null,
  hearingTiles: 14,
  distantWhenOffscreen: null,
  caption: null,
} as const satisfies SoundTraits;

/**
 * Small enough to keep a recording recognisably itself, large enough that ten
 * in a row are heard as ten blows rather than one sample stuttering.
 */
const HIT_PITCH_JITTER = 0.05;
const HIT_VOLUME_JITTER = 0.1;
/** Coins land in streams, so they spread wider than a blow does. */
const COIN_PITCH_JITTER = 0.15;

const VARIED = {
  pitchJitter: HIT_PITCH_JITTER,
  volumeJitter: HIT_VOLUME_JITTER,
} as const satisfies Partial<SoundTraits>;

/** A sting holds the music this far down for its length, then lets it back up. */
const STINGER_DUCK = {
  depthDb: -8,
  releaseMs: 300,
} as const satisfies MusicDuckTrait;

const STINGER = {
  priority: 'high',
  duckMusic: STINGER_DUCK,
} as const satisfies Partial<SoundTraits>;

type AudioFolder =
  | 'ambient'
  | 'bosses'
  | 'casino'
  | 'characters'
  | 'combat'
  | 'effects'
  | 'enemies'
  | 'events'
  | 'jingles'
  | 'menu'
  | 'music';

/**
 * What every recording in a folder shares. Menu taps and game events are
 * the interface talking, so they never lose a voice to the world; combat is
 * the most repeated sound in the game, so every take varies.
 */
const FOLDER_TRAITS: Readonly<Partial<Record<AudioFolder, Partial<SoundTraits>>>> = {
  menu: { priority: 'high' },
  events: { priority: 'high' },
  bosses: { priority: 'high' },
  jingles: { priority: 'high' },
  combat: VARIED,
  ambient: { priority: 'low' },
};

const FOOTSTEPS = {
  maxVoices: 2,
  priority: 'low',
  ...VARIED,
} as const satisfies Partial<SoundTraits>;

/** Siege engines are loud enough to carry across the village, but muffled by it. */
const SIEGE_ENGINE_DISTANT = {
  hearingTiles: 40,
  gainScale: 0.35,
  lowpassHz: 900,
} as const satisfies DistantTreatment;

/**
 * Heard across a whole desktop view while on screen, so a trebuchet at the
 * far edge still sounds.
 */
const SIEGE_ENGINE = {
  hearingTiles: 24,
  distantWhenOffscreen: SIEGE_ENGINE_DISTANT,
} as const satisfies Partial<SoundTraits>;

const COINS = {
  maxVoices: 3,
  priority: 'low',
  pitchJitter: COIN_PITCH_JITTER,
} as const satisfies Partial<SoundTraits>;

/** Blows landing and things being struck, wherever their recordings live. */
const IMPACT_IDS = [
  'human_punch_1',
  'human_punch_2',
  'human_punch_3',
  'human_punch_weak',
  'cat_scratch',
  'bite_1',
  'bite_2',
  'bite_3',
  'mongo_slash',
  'slash_strike_1',
  'slash_strike_2',
  'slash_strike_3',
  'splat_1',
  'splat_2',
  'splat_3',
  'rock_thud_1',
  'rock_thud_2',
  'rock_thud_3',
  'rock_thud_4',
  'arrow_impact',
  'cat_missile_impact',
  'magic_ball_impact',
  'small_magic_impact_1',
  'small_magic_impact_2',
  'small_magic_impact_3',
  'boulder_impact_1',
  'boulder_impact_2',
  'boulder_impact_3',
  'boulder_impact_4',
  'massive_strike_with_dirt_impact',
  'massive_metal_hit',
  'hammer_strike',
  'anvil_strike_1',
  'anvil_strike_2',
  'anvil_strike_3',
  'axe_striking_wood',
  'pickaxe_strike_stone',
  'wall_hit_stone',
  'wall_hit_wood',
  'metal_dent_1',
  'metal_dent_2',
  'metal_dent_3',
] as const satisfies readonly SoundId[];

const FOOTSTEP_IDS = [
  'player_walking',
  'player_wading',
  'guard_footsteps_loop',
  'skyfowl_talon_steps',
  'spider_walking',
] as const satisfies readonly SoundId[];

const COIN_IDS = ['coin_land_tick', 'coin_pouch'] as const satisfies readonly SoundId[];

/** Brittle shards under a crawler's step: heard as footfalls, so they share the footstep cap. */
const EGGSHELL_CRUNCH_IDS = [
  'eggshell_crunch_1',
  'eggshell_crunch_2',
  'eggshell_crunch_3',
  'eggshell_crunch_4',
] as const satisfies readonly SoundId[];

/**
 * One old man's voice. The cap is per take, so replaying a take cuts its own
 * earlier copy; two different takes can still overlap.
 */
const ONE_SPEAKER = { maxVoices: 1 } as const satisfies Partial<SoundTraits>;

const DR_MOULT_VOICE_IDS = [
  'scientist_call_out_1',
  'scientist_call_out_2',
  'scientist_wait_stop',
  'scientist_hey_come_here_1',
  'scientist_hey_come_here_2',
] as const satisfies readonly SoundId[];

/**
 * The spider hallway's small unsettling sounds. They are set dressing behind
 * the player, so any fight noise takes their voice, and each take plays at
 * most one copy: replaying it cuts its earlier copy, though different takes
 * can still overlap.
 */
const HALLWAY_UNEASE = {
  maxVoices: 1,
  priority: 'low',
  ...VARIED,
} as const satisfies Partial<SoundTraits>;

const HALLWAY_UNEASE_IDS = [
  'web_strand_creak_1',
  'web_strand_creak_2',
  'web_strand_creak_3',
  'fluorescent_tube_flicker_1',
  'fluorescent_tube_flicker_2',
] as const satisfies readonly SoundId[];

/** A trebuchet's throw, its boulder's flight and landing, and the cloud an infernal one leaves. */
const SIEGE_ENGINE_IDS = [
  'trebuchet_fire_1',
  'trebuchet_fire_2',
  'boulder_fire_whoosh',
  'boulder_impact_1',
  'boulder_impact_2',
  'boulder_impact_3',
  'boulder_impact_4',
  'miasma_hiss',
] as const satisfies readonly SoundId[];

/**
 * The victory volley sends a rocket up every few frames and its finale six at
 * once, so each take keeps a small cap: a long volley thins to a handful of
 * whistles and booms instead of stacking a voice per rocket.
 */
const FIREWORK_LAUNCH = { maxVoices: 1, ...VARIED } as const satisfies Partial<SoundTraits>;
const FIREWORK_BURST = { maxVoices: 2, ...VARIED } as const satisfies Partial<SoundTraits>;

const FIREWORK_LAUNCH_IDS = [
  'firework_launch_1',
  'firework_launch_2',
  'firework_launch_3',
  'firework_launch_4',
] as const satisfies readonly SoundId[];

const FIREWORK_BURST_IDS = [
  'firework_burst_1',
  'firework_burst_2',
  'firework_burst_3',
  'firework_burst_4',
] as const satisfies readonly SoundId[];

/**
 * A blast is the loudest thing on screen and the reason for the damage the
 * player just took, so it never loses its voice to the fight around it.
 */
const EXPLOSION = { priority: 'high', ...VARIED } as const satisfies Partial<SoundTraits>;

const EXPLOSION_IDS = [
  'dynamite_explosion',
  'black_powder_explosion_1',
  'black_powder_explosion_2',
  'black_powder_explosion_3',
  'black_powder_explosion_4',
] as const satisfies readonly SoundId[];

/** The handling noises of a thrown explosive: lit, tossed, landed. */
const EXPLOSIVE_HANDLING_IDS = [
  'fuse_light_1',
  'fuse_light_2',
  'fuse_light_3',
  'fuse_light_4',
  'bomb_toss_whoosh_1',
  'bomb_toss_whoosh_2',
  'bomb_toss_whoosh_3',
  'bomb_toss_whoosh_4',
  'dynamite_stick_land_1',
  'dynamite_stick_land_2',
  'dynamite_stick_land_3',
] as const satisfies readonly SoundId[];

/**
 * A claw trail sounds on every swipe the cat makes, so it keeps to two voices
 * and sits under the swing it rides on.
 */
const CLAW_SWIPE = {
  maxVoices: 2,
  priority: 'low',
  ...VARIED,
} as const satisfies Partial<SoundTraits>;

/**
 * Rare turns in a fight that the player must hear over it: a life saved, the
 * world slowing, gear awakening or binding, a set completed, and the cat
 * going down.
 */
const GEAR_MOMENT_IDS = [
  'halo_revive',
  'hourglass_slow_in',
  'hourglass_slow_out',
  'gear_awaken',
  'cursed_bind',
  'set_bonus_complete',
  'belle_downed',
] as const satisfies readonly SoundId[];

const GEAR_MOMENT = { priority: 'high' } as const satisfies Partial<SoundTraits>;

/**
 * Both crawlers' lockets link on the same frame, and a pair walking along the
 * edge of the link's range would chime at every step across it.
 */
const PARTNER_LINK_MIN_INTERVAL_MS = 4000;
const PARTNER_LINK = {
  maxVoices: 1,
  minIntervalMs: PARTNER_LINK_MIN_INTERVAL_MS,
} as const satisfies Partial<SoundTraits>;

const CLAW_SWIPE_IDS = [
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
] as const satisfies readonly SoundId[];

/** What a relic throws (a bolt, a ward catching a shot, a bramble planted) and what a blade throws. */
const RELIC_EFFECT_IDS = [
  'sunsteel_slash_wave_1',
  'sunsteel_slash_wave_2',
  'sunsteel_slash_wave_3',
  'sunsteel_slash_wave_4',
  'last_word_chain_spark_1',
  'last_word_chain_spark_2',
  'last_word_chain_spark_3',
  'last_word_chain_spark_4',
  'ember_wisp_bolt_1',
  'ember_wisp_bolt_2',
  'ember_wisp_bolt_3',
  'ember_wisp_bolt_4',
  'ember_wisp_bolt_5',
  'ward_stone_block_2',
  'ward_stone_block_3',
  'bramble_seed_burst_1',
  'bramble_seed_burst_2',
  'bramble_seed_burst_3',
  'bramble_seed_burst_4',
] as const satisfies readonly SoundId[];

/**
 * A bomber goblin's voice. A pack throws together, so each take sounds once
 * at a time and a repeat inside the gap is dropped rather than stacked.
 */
const BOMBER_VOICE = {
  maxVoices: 1,
  minIntervalMs: 600,
  ...VARIED,
} as const satisfies Partial<SoundTraits>;

/** Longer than a giggle, so a second goblin lighting just after the first stays quiet. */
const BOMBER_CACKLE = {
  ...BOMBER_VOICE,
  minIntervalMs: 2000,
} as const satisfies Partial<SoundTraits>;

const BOMBER_GRUNT_IDS = [
  'goblin_bomber_throw_grunt_1',
  'goblin_bomber_throw_grunt_2',
  'goblin_bomber_throw_grunt_3',
] as const satisfies readonly SoundId[];

const BOMBER_CACKLE_IDS = [
  'goblin_bomber_cackle_1',
  'goblin_bomber_cackle_2',
  'goblin_bomber_cackle_3',
  'goblin_bomber_cackle_4',
  'goblin_bomber_cackle_5',
] as const satisfies readonly SoundId[];

const FIRE_IN_THE_HOLE_IDS = [
  'goblin_fire_in_the_hole_1',
  'goblin_fire_in_the_hole_2',
  'goblin_fire_in_the_hole_3',
  'goblin_fire_in_the_hole_4',
] as const satisfies readonly SoundId[];

const BOMBS_AWAY_IDS = [
  'goblin_bombs_away_1',
  'goblin_bombs_away_2',
  'goblin_bombs_away_3',
  'goblin_bombs_away_4',
] as const satisfies readonly SoundId[];

function isImpactId(id: SoundId): boolean {
  return IMPACT_IDS.some((impact) => impact === id);
}

/**
 * Fanfares that announce a moment. Each ducks the music under it, and none
 * varies: a sting is recognised by being the same every time.
 */
export const STINGER_IDS = [
  'boss_defeated',
  'level_complete',
  'quest_complete',
  'objective_complete',
  'player_level_up',
  'achievement_unlocked',
  'new_unlock',
  'briar_hollow_victory',
] as const satisfies readonly SoundId[];

/** One id's own departures from its folder. */
/** Every rooster's talons on the gym floor. */
const ROOSTER_STEP_IDS = [
  'rooster_talon_step_1',
  'rooster_talon_step_2',
  'rooster_talon_step_3',
  'rooster_talon_step_4',
] as const satisfies readonly SoundId[];

/** A rooster's beak, fist or swung dumbbell, struck many times a fight. */
const ROOSTER_BLOW_IDS = [
  'rooster_peck_1',
  'rooster_peck_2',
  'rooster_peck_3',
  'rooster_peck_4',
  'rooster_punch_whoosh_1',
  'rooster_punch_whoosh_2',
  'rooster_punch_whoosh_3',
  'rooster_punch_whoosh_4',
  'dumbbell_club_impact_1',
  'dumbbell_club_impact_2',
  'dumbbell_club_impact_3',
] as const satisfies readonly SoundId[];

/**
 * A minion clucks when it notices, winds up and is hit, so a scrap can raise
 * them back to back; one voice per take keeps a flurry from stacking up.
 */
const ROOSTER_CLUCK_IDS = [
  'little_rooster_cluck_1',
  'little_rooster_cluck_2',
  'little_rooster_cluck_3',
  'bent_rooster_cluck_1',
  'bent_rooster_cluck_2',
  'bent_rooster_cluck_3',
] as const satisfies readonly SoundId[];

const ID_TRAITS: Readonly<Partial<Record<SoundId, Partial<SoundTraits>>>> = {
  ...Object.fromEntries(IMPACT_IDS.map((id) => [id, VARIED])),
  ...Object.fromEntries(FOOTSTEP_IDS.map((id) => [id, FOOTSTEPS])),
  ...Object.fromEntries(COIN_IDS.map((id) => [id, COINS])),
  ...Object.fromEntries(EGGSHELL_CRUNCH_IDS.map((id) => [id, FOOTSTEPS])),
  ...Object.fromEntries(DR_MOULT_VOICE_IDS.map((id) => [id, ONE_SPEAKER])),
  ...Object.fromEntries(HALLWAY_UNEASE_IDS.map((id) => [id, HALLWAY_UNEASE])),
  ...Object.fromEntries(STINGER_IDS.map((id) => [id, STINGER])),
  ...Object.fromEntries(FIREWORK_LAUNCH_IDS.map((id) => [id, FIREWORK_LAUNCH])),
  ...Object.fromEntries(FIREWORK_BURST_IDS.map((id) => [id, FIREWORK_BURST])),
  ...Object.fromEntries(EXPLOSION_IDS.map((id) => [id, EXPLOSION])),
  ...Object.fromEntries(EXPLOSIVE_HANDLING_IDS.map((id) => [id, VARIED])),
  ...Object.fromEntries(ROOSTER_STEP_IDS.map((id) => [id, FOOTSTEPS])),
  ...Object.fromEntries(ROOSTER_BLOW_IDS.map((id) => [id, VARIED])),
  ...Object.fromEntries(ROOSTER_CLUCK_IDS.map((id) => [id, ONE_SPEAKER])),
  ...Object.fromEntries(CLAW_SWIPE_IDS.map((id) => [id, CLAW_SWIPE])),
  ...Object.fromEntries(RELIC_EFFECT_IDS.map((id) => [id, VARIED])),
  ...Object.fromEntries(GEAR_MOMENT_IDS.map((id) => [id, GEAR_MOMENT])),
  twin_locket_link: PARTNER_LINK,
  ...Object.fromEntries(BOMBER_GRUNT_IDS.map((id) => [id, BOMBER_VOICE])),
  ...Object.fromEntries(FIRE_IN_THE_HOLE_IDS.map((id) => [id, BOMBER_VOICE])),
  ...Object.fromEntries(BOMBS_AWAY_IDS.map((id) => [id, BOMBER_VOICE])),
  ...Object.fromEntries(BOMBER_CACKLE_IDS.map((id) => [id, BOMBER_CACKLE])),
  ...Object.fromEntries(
    SIEGE_ENGINE_IDS.map((id) => [id, { ...(isImpactId(id) ? VARIED : {}), ...SIEGE_ENGINE }]),
  ),
};

function always(text: string): SoundCaption {
  return { text, when: 'always' };
}

function offscreen(text: string): SoundCaption {
  return { text, when: 'offscreen' };
}

/** Every take of one sound, all under one caption, so their repeats merge. */
function takes(
  ids: readonly SoundId[],
  caption: SoundCaption,
): Partial<Record<SoundId, SoundCaption>> {
  return Object.fromEntries(ids.map((id) => [id, caption]));
}

/**
 * Captions, by the rule that a cue gets one when it carries gameplay
 * information the screen does not show at that moment. Alarms, warnings,
 * traps and the stealth guards' calls are `always`: nothing on screen says
 * them. A creature's cry is `offscreen`: in view, the creature shows it.
 * Interface taps, the party's own attacks and hits, music and ambience never
 * get one, and neither do shared impact takes that the party also makes.
 * The spider's skitter is a loop with no place in the world, so it cannot be
 * judged off screen, and it only plays with the spider close by.
 */
const SOUND_CAPTIONS: Readonly<Partial<Record<SoundId, SoundCaption>>> = {
  bell_alarm: always('Alarm bell rings'),
  bell_toll_hit: always('Clocktower struck'),
  caught_alarm_sting: always('Alarm blares'),
  wheel_warning_klaxon_loop: always('Warning klaxon blares'),
  level_timer_warning: always('Collapse warning sounds'),
  level_timer_final_minute_heartbeat: always('Heartbeat pounds'),
  nothing_void_swallow: always('The Nothing arrives'),
  snare_trigger: always('Snare snaps shut'),
  necro_war_horn: always('War horn sounds'),
  gate_opening: always('Gate opens'),
  heavy_metal_gate_raise: always('Gate opens'),
  ...takes(
    ['goblin_guard_hey_1', 'goblin_guard_hey_2', 'goblin_guard_hey_3', 'goblin_guard_hey_4'],
    always('Guard shouts'),
  ),
  ...takes(
    ['goblin_guard_huh_1', 'goblin_guard_huh_2', 'goblin_guard_huh_3'],
    always('Guard grows suspicious'),
  ),
  ...takes(
    ['goblin_guard_what_was_that_1', 'goblin_guard_what_was_that_2'],
    always('Guard goes to look'),
  ),
  ...takes(
    ['goblin_guard_all_clear_1', 'goblin_guard_all_clear_2', 'goblin_guard_all_clear_3'],
    always('Guard gives up the search'),
  ),
  ...takes(['goblin_1', 'goblin_2'], offscreen('Goblin snarls')),
  ...takes(FIRE_IN_THE_HOLE_IDS, offscreen('Fire in the hole!')),
  ...takes(BOMBS_AWAY_IDS, offscreen('Bombs away!')),
  ...takes(['rat_squeak_1', 'rat_squeak_2', 'rat_squeak_3'], offscreen('Rat squeaks')),
  ...takes(
    ['tuskling_grunt_1', 'tuskling_grunt_2', 'tuskling_grunt_3', 'tuskling_grunt_4'],
    offscreen('Tuskling grunts'),
  ),
  ...takes(['skyfowl_1', 'skyfowl_2'], offscreen('Skyfowl screeches')),
  troglodyte_tongue: offscreen('Tongue lashes'),
  bear_big_attack: offscreen('Bear roars'),
  bear_growl_1: offscreen('Bear growls'),
  ...takes(['clown_laughing_1', 'clown_laughing_2'], offscreen('Clown laughs')),
  clown_horn: offscreen('Clown horn honks'),
  clown_burp: offscreen('Clown burps'),
  krasue_attack: offscreen('Krasue shrieks'),
  ...takes(['circus_lemur_attack', 'circus_lemur_sound'], offscreen('Lemur chatters')),
  llama_fireball: offscreen('Fireball whooshes'),
  fairy_fireball_whoosh: offscreen('Fireball whooshes'),
  bones_rattling: offscreen('Bones rattle'),
  raised_ratkin_groan: offscreen('Undead groans'),
  grave_bull_bellow: offscreen('Grave bull bellows'),
  grave_bull_charge: offscreen('Grave bull charges'),
  ...takes(
    ['mantid_hiss_1', 'mantid_hiss_2', 'mantid_hiss_3', 'mantid_hiss_4', 'mantid_hiss_5'],
    offscreen('Mantid hisses'),
  ),
  mantid_furious: offscreen('Mantid screeches'),
  krakaren_yell: offscreen('Krakaren roars'),
  krakaren_tentacle_emerge: offscreen('Tentacle bursts up'),
  rock_golem_grunt: offscreen('Golem grunts'),
  rolling_earth_ball: offscreen('Boulder rolls'),
  trash_gremlin_vomit: offscreen('Trash Gremlin retches'),
  skeleton_lord_chant: offscreen('Dark chanting'),
  prepare_for_magic_strike: offscreen('Magic gathers'),
  knight_magic_windup: offscreen('Magic gathers'),
  ball_of_swine_rolling: offscreen('Swine ball rolls'),
  deep_rumbling: offscreen('Deep rumbling'),
  ...takes(
    ['grimaldi_plant_moving_1', 'grimaldi_plant_moving_2', 'grimaldi_plant_moving_3'],
    offscreen('Vines rustle'),
  ),
  necromancer_raise: offscreen('The dead rise'),
  fairy_raise_call: offscreen('Fairy calls up the dead'),
  fairy_resurrection_moan: offscreen('The dead stir'),
  fairy_ice_cast: offscreen('Ice spell crackles'),
  fairy_shield_cast: offscreen('Fairy casts a ward'),
  fairy_telekinetic_thrum: offscreen('Force spell hums'),
  ...takes(['scientist_call_out_1', 'scientist_call_out_2'], offscreen('Someone whispers "Psst!"')),
};

const AUDIO_PATH_PREFIX = './src/audio/';

function folderOf(id: SoundId): AudioFolder | null {
  const folder = SOUND_MANIFEST[id].slice(AUDIO_PATH_PREFIX.length).split('/')[0];
  return isAudioFolder(folder) ? folder : null;
}

const AUDIO_FOLDERS: ReadonlySet<string> = new Set<AudioFolder>([
  'ambient',
  'bosses',
  'casino',
  'characters',
  'combat',
  'effects',
  'enemies',
  'events',
  'jingles',
  'menu',
  'music',
]);

function isAudioFolder(folder: string | undefined): folder is AudioFolder {
  return folder !== undefined && AUDIO_FOLDERS.has(folder);
}

const resolved = new Map<SoundId, SoundTraits>();

/** Every trait of `id`, its own entry over its folder's over the defaults. */
export function soundTraits(id: SoundId): SoundTraits {
  const cached = resolved.get(id);
  if (cached !== undefined) return cached;
  const folder = folderOf(id);
  const traits: SoundTraits = {
    ...DEFAULT_SOUND_TRAITS,
    ...(folder === null ? {} : FOLDER_TRAITS[folder]),
    ...ID_TRAITS[id],
    caption: SOUND_CAPTIONS[id] ?? null,
  };
  resolved.set(id, traits);
  return traits;
}
