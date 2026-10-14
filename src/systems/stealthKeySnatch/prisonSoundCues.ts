/**
 * The Stealth Key Snatch's sounds, by what they mean rather than by file.
 *
 * Every play site raises a cue from this table, never a raw id, so each
 * recording that lands is its registration in `src/audio/sounds.ts` plus one
 * line here. A cue still waiting on its recording either borrows the nearest
 * sound the game already has or is an empty list — silent — where nothing
 * stands in; each entry's JSDoc names the file it is waiting for.
 *
 * The gate room and the prison only exist on floor 2, so every id here is
 * preloaded through the `stealthKeySnatch` group in `src/audio/sfxGroups.ts`,
 * which floor 2 and the prison's door both load.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { MusicTrackId, SoundId } from '../../audio/sounds';

export const PRISON_CUES = {
  /** The locked gate bumped or tried. */
  gateLocked: [
    'metal_gate_locked_rattle_1',
    'metal_gate_locked_rattle_2',
    'metal_gate_locked_rattle_3',
  ],
  /** The gate guard turning the key. */
  gateUnlock: ['gate_key_unlock'],
  /** The gate raised. Waits on `heavy_metal_gate_raise`; `gate_opening` stands in. */
  gateOpen: ['gate_opening'],
  /** The prison's double door. */
  prisonDoorOpen: ['prison_door_heavy_open'],
  /** Room tone inside the prison. */
  prisonAmbience: ['prison_ambience_loop'],
  /** A spotlight's positional hum. */
  spotlightHum: ['spotlight_hum_loop'],
  /** A spotlight reversing on its track. Waits on `spotlight_motor_turn_1` … `_2`. */
  spotlightTurn: [],
  /** A patrolling guard's positional footsteps. */
  guardFootsteps: ['guard_footsteps_loop'],
  /** A paused guard slapping its baton. Waits on `guard_baton_tap_1` … `_2`. */
  guardBatonTap: [],
  /** A guard muttering on patrol. */
  guardMutter: ['goblin_guard_mutter_1', 'goblin_guard_mutter_2', 'goblin_guard_mutter_3'],
  /** A guard or the gate guard struck; the same goblin voice as the bathroom queue's. */
  guardHit: [
    'goblin_ow_1',
    'goblin_ow_2',
    'goblin_ouch_1',
    'goblin_ouch_2',
    'goblin_oof_1',
    'goblin_oof_2',
  ],
  /** A guard's suspicion starting to rise. */
  guardSuspicious: ['goblin_guard_huh_1', 'goblin_guard_huh_2', 'goblin_guard_huh_3'],
  /** A guard spotting the party. */
  guardHey: [
    'goblin_guard_hey_1',
    'goblin_guard_hey_2',
    'goblin_guard_hey_3',
    'goblin_guard_hey_4',
  ],
  /** A guard going to look at a noise. */
  guardInvestigate: ['goblin_guard_what_was_that_1', 'goblin_guard_what_was_that_2'],
  /** A guard giving up on a noise. */
  guardGivesUp: [
    'goblin_guard_all_clear_1',
    'goblin_guard_all_clear_2',
    'goblin_guard_all_clear_3',
  ],
  /** A light's suspicion climbing. Waits on `stealth_suspicion_heartbeat_loop`; `level_timer_final_minute_heartbeat` stands in. */
  suspicionRising: ['level_timer_final_minute_heartbeat'],
  /** The alarm sting of a capture. */
  caught: ['caught_alarm_sting'],
  /** A holding cell's door slammed on the party. */
  cellDoorSlam: ['cell_door_slam'],
  /** A flimsy cell door broken. */
  cellDoorBreak: [
    'flimsy_cell_door_break_1',
    'flimsy_cell_door_break_2',
    'flimsy_cell_door_break_3',
  ],
  /** A prisoner rattling its bars. */
  prisonerRattle: ['prisoner_bar_rattle_1', 'prisoner_bar_rattle_2', 'prisoner_bar_rattle_3'],
  /** A prisoner heckling. Waits on `prisoner_goblin_heckle_1` … `_3`; `goblin_1` stands in. */
  prisonerHeckle: ['goblin_1'],
  /** The key's shimmer on its pedestal. Waits on `prison_key_shimmer_loop`. */
  keyShimmer: [],
  /** The key lifted. */
  keyPickup: ['prison_key_pickup_fanfare'],
  /** The gate guard's proud talk. */
  gateGuardTalk: [
    'gate_guard_proud_hmph_1',
    'gate_guard_proud_hmph_2',
    'gate_guard_proud_hmph_3',
    'gate_guard_proud_hmph_4',
  ],
} as const satisfies Record<string, readonly SoundId[]>;

/** The prison's sneaking music. */
export const PRISON_MUSIC = 'stealth_music' as const satisfies MusicTrackId;

/** Which cue a play site raises. */
export type PrisonCue = keyof typeof PRISON_CUES;

/**
 * One recording behind `cue`, picked by `roll` in [0, 1) among its takes, or
 * null while the cue is silent.
 */
export function prisonCueSound(cue: PrisonCue, roll = 0): SoundId | null {
  const takes: readonly SoundId[] = PRISON_CUES[cue];
  const takeIndex = Math.min(takes.length - 1, Math.floor(roll * takes.length));
  return takes[takeIndex] ?? null;
}

/**
 * Plays a random take of `cue` once through `audio`. Silent for an empty cue
 * or a missing audio manager. The roll is taken only when there is audio to
 * play, so a headless simulation's random stream is untouched.
 */
export function playPrisonCue(
  audio: Pick<AudioManager, 'play'> | null,
  cue: PrisonCue,
  volume?: number,
): void {
  if (audio === null) return;
  const sound = prisonCueSound(cue, Math.random());
  if (sound === null) return;
  audio.play(sound, volume === undefined ? undefined : { volume });
}
