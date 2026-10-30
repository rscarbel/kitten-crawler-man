/**
 * The sounds Big Rooster's gym makes for his kettlebell rain and his exercise
 * balls, by what they mean rather than by file.
 *
 * The gym is on floor 2, so every take is in the `level2` group of
 * `src/audio/sfxGroups.ts`.
 */

import type { SoundId } from './sounds';

export const GYM_CUES = {
  /** A whole rack of kettlebells flung into the air at once. */
  kettlebellHeave: { takes: ['kettlebell_heave'] },
  /** A bell slamming into the rubber floor. */
  kettlebellImpact: {
    takes: [
      'kettlebell_impact_1',
      'kettlebell_impact_2',
      'kettlebell_impact_3',
      'kettlebell_impact_4',
    ],
  },
  /** His boot sending an exercise ball off. */
  ballKick: { takes: ['exercise_ball_kick'] },
  /** A rolling ball bouncing off a wall or a crawler. */
  ballBounce: {
    takes: [
      'exercise_ball_bounce_1',
      'exercise_ball_bounce_2',
      'exercise_ball_bounce_3',
      'exercise_ball_bounce_4',
      'exercise_ball_bounce_5',
    ],
  },
  /** Any rooster booting a lit stick away. */
  dynamiteKick: {
    takes: ['dynamite_kick_1', 'dynamite_kick_2', 'dynamite_kick_3'],
  },
} as const satisfies Record<string, { readonly takes: readonly SoundId[] }>;
