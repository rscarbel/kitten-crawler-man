/**
 * The human crawler's own voice for the moments that are heard rather than
 * written: getting hurt by an effect, being knocked out and being revived.
 * The voice follows the body the player chose.
 */

import type { SoundId } from '../audio/sounds';
import type { CrawlerBody } from './crawlerChoices';
import { playerIdentity } from './playerIdentity';

export interface HumanVocalSounds {
  readonly hurt: readonly SoundId[];
  readonly knockedOut: readonly SoundId[];
  readonly revived: readonly SoundId[];
}

export const HUMAN_VOCAL_SOUNDS = {
  male: {
    hurt: ['human_effect_damage_1', 'human_effect_damage_2'],
    knockedOut: ['human_knocked_out'],
    revived: ['human_revived'],
  },
  female: {
    hurt: [
      'human_female_effect_damage_1',
      'human_female_effect_damage_2',
      'human_female_effect_damage_3',
      'human_female_effect_damage_4',
    ],
    knockedOut: ['human_female_knocked_out'],
    revived: ['human_female_revived'],
  },
} as const satisfies Record<CrawlerBody, HumanVocalSounds>;

/** The voice of the human crawler this run. */
export function humanVocalSounds(): HumanVocalSounds {
  return HUMAN_VOCAL_SOUNDS[playerIdentity().body];
}
