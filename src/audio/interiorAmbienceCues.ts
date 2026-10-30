/**
 * The loops a town interior's furniture makes while it works — a fire in its
 * hearth, the smithy's coal bed — by what they mean rather than by file.
 *
 * A prop declares one of these cues as its `ambientSound`, and the room plays
 * it from where the prop stands. The names follow the dungeon's own positional
 * loops (`DUNGEON_CUES`), so a torch indoors and a torch on floor 1 are the
 * same `torchBurn`. A looping cue plays its first take only.
 *
 * The streamed beds here stream; every decoded take is preloaded through the
 * `interiorAmbience` group in `src/audio/sfxGroups.ts`, which every building
 * interior loads.
 */

import type { SoundId } from './sounds';

export const INTERIOR_AMBIENCE_CUES = {
  /** A wood fire in a hearth, a stove or a brazier. */
  fireCrackle: ['ambient_fire_crackling'],
  /** A smith's coal bed under the bellows. */
  forgeRoar: ['ambient_forge'],
  /** A small open flame on a stand: a torchère's candles. */
  torchBurn: ['torch_burn_loop'],
} as const satisfies Record<string, readonly SoundId[]>;

export type InteriorAmbienceCue = keyof typeof INTERIOR_AMBIENCE_CUES;

/** The take a looping cue plays. */
export function interiorAmbienceSound(cue: InteriorAmbienceCue): SoundId {
  return INTERIOR_AMBIENCE_CUES[cue][0];
}
