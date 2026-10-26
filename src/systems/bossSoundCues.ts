/**
 * Which recordings play for each sound Big Rooster's flock and the Trash
 * Gremlin raise. Each play picks one of the cue's takes at random; a cue with
 * no takes is silent for that creature. Both bosses live on floor 1, so every
 * id here is in the `level1` group of `src/audio/sfxGroups.ts`.
 */

import type { SoundId } from '../audio/sounds';
import type { RoosterSoundCue, TrashGremlinSoundCue } from '../creatures/creatureSoundCues';
import type { RoosterBuild } from '../sprites/roosterSprite';

const ROOSTER_PECKS = [
  'rooster_peck_1',
  'rooster_peck_2',
  'rooster_peck_3',
  'rooster_peck_4',
] as const satisfies readonly SoundId[];
const ROOSTER_WHOOSHES = [
  'rooster_punch_whoosh_1',
  'rooster_punch_whoosh_2',
  'rooster_punch_whoosh_3',
  'rooster_punch_whoosh_4',
] as const satisfies readonly SoundId[];
const ROOSTER_RUFFLES = [
  'rooster_feather_ruffle_1',
  'rooster_feather_ruffle_2',
] as const satisfies readonly SoundId[];
const ROOSTER_STEPS = [
  'rooster_talon_step_1',
  'rooster_talon_step_2',
  'rooster_talon_step_3',
  'rooster_talon_step_4',
] as const satisfies readonly SoundId[];
const LITTLE_CLUCKS = [
  'little_rooster_cluck_1',
  'little_rooster_cluck_2',
  'little_rooster_cluck_3',
] as const satisfies readonly SoundId[];
const BENT_CLUCKS = [
  'bent_rooster_cluck_1',
  'bent_rooster_cluck_2',
  'bent_rooster_cluck_3',
] as const satisfies readonly SoundId[];

/** Every rooster's beak, fists and feet sound alike; a minion's voice is one cluck for everything. */
function minionCues(
  clucks: readonly SoundId[],
): Readonly<Record<RoosterSoundCue, readonly SoundId[]>> {
  return {
    crow: [],
    effort: clucks,
    hurt: clucks,
    notice: clucks,
    peck: ROOSTER_PECKS,
    swing: ROOSTER_WHOOSHES,
    clubImpact: [],
    ruffle: ROOSTER_RUFFLES,
    step: ROOSTER_STEPS,
  } satisfies Record<RoosterSoundCue, readonly SoundId[]>;
}

export const ROOSTER_CUES = {
  big: {
    crow: ['big_rooster_crow'],
    effort: [
      'big_rooster_grunt_1',
      'big_rooster_grunt_2',
      'big_rooster_grunt_3',
      'big_rooster_grunt_4',
    ],
    hurt: ['big_rooster_hurt_1', 'big_rooster_hurt_2', 'big_rooster_hurt_3', 'big_rooster_hurt_4'],
    notice: [],
    peck: ROOSTER_PECKS,
    swing: ROOSTER_WHOOSHES,
    clubImpact: ['dumbbell_club_impact_1', 'dumbbell_club_impact_2', 'dumbbell_club_impact_3'],
    ruffle: ROOSTER_RUFFLES,
    step: ROOSTER_STEPS,
  },
  little: minionCues(LITTLE_CLUCKS),
  bent: minionCues(BENT_CLUCKS),
} as const satisfies Record<RoosterBuild, Readonly<Record<RoosterSoundCue, readonly SoundId[]>>>;

/**
 * The talon step is a layer under a minion's footfall but the whole of Big
 * Rooster's, which is what makes his tread read as the heavier one.
 */
export const ROOSTER_STEP_VOLUME: Readonly<Record<RoosterBuild, number>> = {
  big: 1,
  little: 0.55,
  bent: 0.55,
};

export const TRASH_GREMLIN_CUES = {
  hurt: [
    'trash_gremlin_hurt_1',
    'trash_gremlin_hurt_2',
    'trash_gremlin_hurt_3',
    'trash_gremlin_hurt_4',
  ],
  gurgle: [
    'trash_gremlin_acid_gurgle_1',
    'trash_gremlin_acid_gurgle_2',
    'trash_gremlin_acid_gurgle_3',
  ],
  shriek: ['trash_gremlin_summon_shriek_1', 'trash_gremlin_summon_shriek_2'],
  cackle: ['trash_gremlin_cackle_1', 'trash_gremlin_cackle_2', 'trash_gremlin_cackle_3'],
} as const satisfies Record<TrashGremlinSoundCue, readonly SoundId[]>;

/** A trash pile bursting open as its roach comes out, played at the pile. */
export const TRASH_PILE_ROACH_BURST = [
  'trash_pile_roach_burst_1',
  'trash_pile_roach_burst_2',
  'trash_pile_roach_burst_3',
] as const satisfies readonly SoundId[];
