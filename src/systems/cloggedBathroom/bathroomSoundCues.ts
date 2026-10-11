/**
 * The Clogged Bathroom's sounds, by what they mean rather than by file.
 *
 * Every play site raises a cue from this table, never a raw id, so each
 * recording that lands is its registration in `src/audio/sounds.ts` plus one
 * line here. A cue still waiting on its recording either borrows the nearest
 * sound the game already has or is an empty list — silent — where nothing
 * stands in; each entry's JSDoc names the file it is waiting for.
 *
 * The bathroom only appears on floor 2, so every id here is preloaded through
 * the `cloggedBathroom` group in `src/audio/sfxGroups.ts`, which floor 2
 * loads. `AudioManager.play` returns silently on a buffer that was never
 * preloaded. Streamed ambience ids are listed too: preloading skips them, and
 * they play through a media element instead.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { SoundId } from '../../audio/sounds';

export const BATHROOM_CUES = {
  /** A board tile turned a quarter. */
  pipeTurn: ['pvc_pipe_turn_1', 'pvc_pipe_turn_2', 'pvc_pipe_turn_3'],
  /** A tap on the bolted brass cross that won't budge. */
  pipeBolted: ['pipe_bolted_clunk'],
  /** Water reaching newly connected pipe. */
  waterRush: ['pipe_water_rush_1', 'pipe_water_rush_2', 'pipe_water_rush_3', 'pipe_water_rush_4'],
  /** Water draining out of pipe that was cut off. */
  pipeDrain: ['pipe_drain_gurgle_1', 'pipe_drain_gurgle_2'],
  /** An open pipe end spraying water. */
  leakSprayLoop: ['pipe_leak_spray_loop'],
  /** A fixture filling with water. */
  fixtureFill: ['fixture_fill_ding'],
  /** The pressure surge as the solved board runs. */
  surge: ['plumbing_surge'],
  /** A toilet flushing. */
  flush: ['toilet_flush_1', 'toilet_flush_2', 'toilet_flush_3'],
  /** The board solved. */
  boardSolved: ['plumbing_fixed_sting'],
  /** The broken plumbing groaning in the room until the solve. */
  brokenPipesLoop: ['ambient_broken_plumbing'],
  /** A queue goblin struck. */
  goblinOw: [
    'goblin_ow_1',
    'goblin_ow_2',
    'goblin_ouch_1',
    'goblin_ouch_2',
    'goblin_oof_1',
    'goblin_oof_2',
  ],
  /** A queue goblin complaining. */
  goblinGrumble: ['goblin_impatient_grumble_1', 'goblin_impatient_grumble_2'],
  /** A goblin leaving the line relieved. */
  goblinRelief: ['goblin_relieved_sigh_1'],
  /** A stall door creaking open. */
  stallDoorOpen: ['stall_door_creak'],
  /** A stall door shutting and latching. */
  stallDoorLatch: ['stall_door_latch'],
  /** The crawler stepping out with the buff. */
  refreshed: ['refreshed_sting'],
  /** The music while the pipe board is on screen. */
  plumbingMusic: ['fix_the_plumbing_music'],
  /** A sink tap running. Waits on `sink_tap_running_loop`; `ambient_fountain` stands in. */
  sinkRunning: ['ambient_fountain'],
} as const satisfies Record<string, readonly SoundId[]>;

/** Which cue a play site raises. */
export type BathroomCue = keyof typeof BATHROOM_CUES;

/**
 * One recording behind `cue`, picked by `roll` in [0, 1) among its takes, or
 * null while the cue is silent.
 */
export function bathroomCueSound(cue: BathroomCue, roll = 0): SoundId | null {
  const takes: readonly SoundId[] = BATHROOM_CUES[cue];
  const takeIndex = Math.min(takes.length - 1, Math.floor(roll * takes.length));
  return takes[takeIndex] ?? null;
}

/**
 * Plays a random take of `cue` once through `audio`. Silent for an empty cue
 * or a missing audio manager. The roll is taken only when there is audio to
 * play, so a headless simulation's random stream is untouched.
 */
export function playBathroomCue(audio: Pick<AudioManager, 'play'> | null, cue: BathroomCue): void {
  if (audio === null) return;
  const sound = bathroomCueSound(cue, Math.random());
  if (sound === null) return;
  audio.play(sound);
}
