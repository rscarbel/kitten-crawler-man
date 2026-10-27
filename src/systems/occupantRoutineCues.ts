/**
 * The sounds an interior occupant's routine makes — a janitor's mop, a
 * marksman's crossbow — by what they mean rather than by file. A routine
 * raises a cue from this table and the room plays one of its takes from where
 * the routine is, so each recording that lands is its registration in
 * `src/audio/sounds.ts` plus its slot here.
 *
 * Every decoded take is preloaded through the `interiorRoutines` group in
 * `src/audio/sfxGroups.ts`, which every building interior loads.
 */

import type { CueSlot } from '../audio/cueSlot';
import type { SoundId } from '../audio/sounds';

/** The recordings the routine slots are waiting for. */
type WantedRoutineSound =
  'mop_swish' | 'mop_bucket_slosh' | 'crossbow_crank_reload' | 'crossbow_bolt_thunk_wood';

export const OCCUPANT_ROUTINE_CUES = {
  /** One stroke of a wet mop across the floor. */
  mopSwish: { takes: [], standInFor: 'mop_swish' },
  /** The mop dunked into its bucket to be wrung. */
  mopSlosh: { takes: [], standInFor: 'mop_bucket_slosh' },
  /** A crossbow loosing its bolt. */
  crossbowRelease: { takes: ['shooting_an_arrow'] },
  /** A crossbow cranked back and a bolt seated. */
  crossbowReload: { takes: [], standInFor: 'crossbow_crank_reload' },
  /** A bolt driving into a wooden target. */
  boltThunk: { takes: [], standInFor: 'crossbow_bolt_thunk_wood' },
} as const satisfies Record<string, CueSlot<WantedRoutineSound>>;

export type OccupantRoutineCue = keyof typeof OCCUPANT_ROUTINE_CUES;

/** Every take a routine can play, for the preload group. */
export function occupantRoutineSoundIds(): readonly SoundId[] {
  return Object.values(OCCUPANT_ROUTINE_CUES).flatMap((slot) => slot.takes);
}
