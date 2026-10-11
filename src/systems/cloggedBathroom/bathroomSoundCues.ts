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
  /** A board tile turned a quarter. Waits on `pvc_pipe_turn_1` … `pvc_pipe_turn_3`; `menu_click` stands in. */
  pipeTurn: ['menu_click'],
  /** A tap on the bolted brass cross that won't budge. Waits on `pipe_bolted_clunk`; `error` stands in. */
  pipeBolted: ['error'],
  /** Water reaching newly connected pipe. Waits on `pipe_water_rush`; `player_wading` stands in. */
  waterRush: ['player_wading'],
  /** Water draining out of pipe that was cut off. Waits on `pipe_drain_gurgle`. */
  pipeDrain: [],
  /** An open pipe end spraying water. Waits on `pipe_leak_spray_loop`; `miasma_hiss` stands in. */
  leakSprayLoop: ['miasma_hiss'],
  /** A fixture filling with water. Waits on `fixture_fill_ding`; `objective_complete` stands in. */
  fixtureFill: ['objective_complete'],
  /** The pressure surge as the solved board runs. Waits on `plumbing_surge`; `metal_winding_up` stands in. */
  surge: ['metal_winding_up'],
  /** A toilet flushing. Waits on `toilet_flush_1` … `toilet_flush_3`; `mob_splash` stands in. */
  flush: ['mob_splash'],
  /** The board solved. Waits on `plumbing_fixed_sting`; `quest_complete` stands in. */
  boardSolved: ['quest_complete'],
  /** The broken plumbing groaning in the room until the solve. Waits on `broken_plumbing_loop`. */
  brokenPipesLoop: [],
  /** The queue's impatient murmur. Waits on `goblin_queue_grumble_loop`; `ambient_bar_crowd` stands in. */
  queueMurmurLoop: ['ambient_bar_crowd'],
  /** A queue goblin struck. Waits on `goblin_ow_1` … `goblin_ow_4`; `goblin_1` and `goblin_2` stand in. */
  goblinOw: ['goblin_1', 'goblin_2'],
  /** A queue goblin complaining. Waits on `goblin_impatient_grumble_1` … `goblin_impatient_grumble_3`; `goblin_2` stands in. */
  goblinGrumble: ['goblin_2'],
  /** A goblin leaving the line relieved. Waits on `goblin_relieved_sigh_1` … `goblin_relieved_sigh_2`. */
  goblinRelief: [],
  /** The plumber hitting the pipes. Waits on `wrench_on_pipe_clank_1` … `wrench_on_pipe_clank_2`; `hammer_strike` stands in. */
  plumberWrench: ['hammer_strike'],
  /** A stall door creaking open. Waits on `stall_door_creak`; `gate_opening` stands in. */
  stallDoorOpen: ['gate_opening'],
  /** A stall door shutting and latching. Waits on `stall_door_latch`. */
  stallDoorLatch: [],
  /** The crawler stepping out with the buff. Waits on `refreshed_sting`; `stat_boost` stands in. */
  refreshed: ['stat_boost'],
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
