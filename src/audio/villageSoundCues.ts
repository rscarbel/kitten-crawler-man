/**
 * The Briar Hollow siege's sounds, by what they mean rather than by file.
 *
 * Several of the village's own recordings do not exist yet, so each cue
 * names the existing sound that stands in for it. Every play site uses the
 * cue, never the raw id: when a recording lands, its registration and one line
 * here are the whole change.
 *
 * Every id named here must be preloaded by a group floor 3 loads (the
 * `briarHollow` group, or `universal`), or the cue is silently never heard.
 */

import type { SoundId } from './sounds';

export const VILLAGE_CUES = {
  /** The bell rung in alarm as the countdown starts. */
  bellAlarm: ['level_begins'],
  /** An undead's blow landing on the bell. */
  bellTollHit: ['massive_metal_hit'],
  /** The bell beaten to nothing: a broken clang and a split. */
  bellCrack: ['glass_break_1', 'massive_metal_hit'],
  /** The bell pealing for the victory, which is also the victory's fanfare until it has its own. */
  bellVictoryPeal: ['quest_complete'],
  /** The dead's horn at the start of each wave. */
  necroWarHorn: ['skeleton_lord_chant'],
  /** The necromancer's arrival, under his boss intro. */
  necromancerArrival: ['skeleton_lord_chant'],
} as const satisfies Record<string, readonly SoundId[]>;

export type VillageCue = keyof typeof VILLAGE_CUES;

/** The siege's music, while the countdown runs and the waves come in. */
export const VILLAGE_SIEGE_MUSIC: SoundId = 'defense_quest_music';
