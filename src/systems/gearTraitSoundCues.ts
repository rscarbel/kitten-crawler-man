/**
 * The sounds worn gear makes, by what they mean rather than by file.
 *
 * `GearSystem` queues a {@link GearSoundCue} wherever a trait's effect happens
 * in the world and the combat kit plays the queue, so the system itself holds
 * no audio. Each play picks one of the cue's takes at random. Gear goes
 * wherever the party does, so every id here is in the `universal` group of
 * `src/audio/sfxGroups.ts`.
 */

import type { SoundId } from '../audio/sounds';

export const GEAR_CUES = {
  /** An Ember Wisp relic loosing its fire bolt. */
  relicBolt: [
    'ember_wisp_bolt_1',
    'ember_wisp_bolt_2',
    'ember_wisp_bolt_3',
    'ember_wisp_bolt_4',
    'ember_wisp_bolt_5',
  ],
  /** A Ward Stone relic swallowing a shot aimed at its wearer. */
  wardBlock: ['ward_stone_block_2', 'ward_stone_block_3'],
  /** The Pot-Lid Buckler turning a shot. */
  bucklerBlock: ['buckler_block_1', 'buckler_block_2', 'buckler_block_3', 'buckler_block_4'],
  /** A Sproutling Seed relic planting its thorn patch. */
  bramble: [
    'bramble_seed_burst_1',
    'bramble_seed_burst_2',
    'bramble_seed_burst_3',
    'bramble_seed_burst_4',
  ],
  /** Sunsteel Talons throwing their slash wave. */
  slashWave: [
    'sunsteel_slash_wave_1',
    'sunsteel_slash_wave_2',
    'sunsteel_slash_wave_3',
    'sunsteel_slash_wave_4',
  ],
  /** An awakened blade's spark jumping to the next enemy, heard where it lands. */
  chainSpark: [
    'last_word_chain_spark_1',
    'last_word_chain_spark_2',
    'last_word_chain_spark_3',
    'last_word_chain_spark_4',
  ],
  /** The Cockscomb Crest making the enemies around its wearer flinch. */
  flinchCrow: ['cockscomb_flinch_crow'],
  /** A downing blow turned aside by the cat's halo. */
  lifeSaved: ['halo_revive'],
  /** A piece of gear awakening. */
  awakened: ['gear_awaken'],
  /** The last piece of a set going on. */
  setShimmer: ['set_bonus_complete'],
  /** The Hourglass Charm slowing the world, and the world snapping back. */
  lastStandBegins: ['hourglass_slow_in'],
  lastStandEnds: ['hourglass_slow_out'],
  /** A Prowler kill hiding the cat. */
  vanish: ['prowler_vanish'],
  /** The paired lockets linking as their wearers come close. */
  partnerLink: ['twin_locket_link'],
} as const satisfies Record<string, readonly SoundId[]>;

/** One gear sound waiting to play, at where it happened in world pixels. */
export interface GearSoundCue {
  readonly takes: readonly SoundId[];
  readonly x: number;
  readonly y: number;
}

/** The quiet hum of a worn relic, heard only by a crawler standing near it. */
export const RELIC_HUM_LOOP = 'relic_hum_loop' satisfies SoundId;
/** Under everything: a hum that runs as long as a relic is worn must never wear on the player. */
export const RELIC_HUM_VOLUME = 0.2;
/** How far from the relic the hum still carries, in tiles. */
export const RELIC_HUM_HEARING_TILES = 3;
