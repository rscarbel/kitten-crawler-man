/**
 * The Briar Hollow siege's sounds, by what they mean rather than by file.
 *
 * Each cue names the sounds that voice it; a cue with several takes is
 * rotated by its play site. A cue whose recording does not exist yet names
 * the existing sound standing in for it. Every play site uses the cue, never
 * the raw id, so swapping a recording is its registration and one line here.
 *
 * Every id named here must be preloaded by a group floor 3 loads (the
 * `briarHollow` group, or `universal`), or the cue is silently never heard.
 */

import type { SoundId } from './sounds';

export const VILLAGE_CUES = {
  /** The bell rung in alarm as the countdown starts. */
  bellAlarm: ['bell_alarm'],
  /** An undead's blow landing on the bell. */
  bellTollHit: ['massive_metal_hit'],
  /** The bell beaten to nothing: a broken clang and a split. */
  bellCrack: ['bell_crack'],
  /** The bell pealing for the victory. */
  bellVictoryPeal: ['bell_victory_peal'],
  /** The dead's horn at the start of each wave. */
  necroWarHorn: ['necro_war_horn'],
  /** The necromancer's arrival, under his boss intro. */
  necromancerArrival: ['skeleton_lord_chant'],
} as const satisfies Record<string, readonly SoundId[]>;

export type VillageCue = keyof typeof VILLAGE_CUES;

/** The siege's music, while the countdown runs and the waves come in. */
export const VILLAGE_SIEGE_MUSIC: SoundId = 'siege_theme';

/** The music that plays once the siege is won. */
export const VILLAGE_VICTORY_MUSIC: SoundId = 'briar_hollow_victory';
