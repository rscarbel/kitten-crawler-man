/**
 * Pest Control's sounds (the floor-2 spider lab quest), by what they mean
 * rather than by file.
 *
 * Every play site raises a cue from this table, never a raw id, so each
 * recording that lands is its registration in `src/audio/sounds.ts` plus one
 * line here. A cue still waiting on its recording either borrows the nearest
 * sound the game already has or is an empty list — silent — where nothing
 * stands in; each entry's JSDoc names the file it is waiting for.
 *
 * The lab, its hallway and the station only exist on floor 2, so every
 * decoded id here is preloaded through the `spiderQuest` group in
 * `src/audio/sfxGroups.ts`, which floor 2 loads. `AudioManager.play` returns
 * silently on a buffer that was never preloaded. The streamed hallway bed is
 * listed too; the group leaves it out, and it plays through a media element.
 *
 * The scientist's older lines (`scientist_exclaiming_about_an_escape`,
 * `scientist_explaining_request`) and the lab's machinery and spider loops
 * keep their own play sites and are not repeated here.
 */

import type { AudioManager, PlayOptions } from '../../audio/AudioManager';
import type { LoopLevel } from '../../audio/loopLevels';
import { AMBIENT_RAMP_MS } from '../../audio/loopLevels';
import type { SoundId } from '../../audio/sounds';
import { MIN_STOP_FADE_MS } from '../../audio/voiceFades';

export const SPIDER_QUEST_CUES = {
  /**
   * Dr. Moult spotting the player across the host room and waving them over.
   * Final: `scientist_call_out_1` … `_2` ("Psst!"). Raised through
   * `SpiderQuestSystem.scientistVoicePending`, which carries where he stands:
   * its caption is off-screen only, so it needs that point.
   */
  callOut: ['scientist_call_out_1', 'scientist_call_out_2'],
  /** Dr. Moult stopping a player who walks into the hallway before talking to him. Final: `scientist_wait_stop`. */
  waitStop: ['scientist_wait_stop'],
  /**
   * Dr. Moult at his lab post, beckoning the player over to the terminal.
   * Final: `scientist_hey_come_here_1` … `_2` ("Hey, come here"). These two
   * read as a louder call than the whispered {@link SPIDER_QUEST_CUES.callOut},
   * so they also suit a second call-out if the player ignores the first.
   */
  labBeckon: ['scientist_hey_come_here_1', 'scientist_hey_come_here_2'],
  /**
   * Dr. Moult running back down the hallway to his lab, a loop. Waits on
   * `scientist_panicked_footsteps_loop`; silent until then.
   */
  panickedFootstepsLoop: [],
  /**
   * The ping as the "Message from Mordecai" box opens. Final:
   * `mordecai_message_chime`. Interface, so play it with `{ bus: 'ui' }`.
   */
  mordecaiMessage: ['mordecai_message_chime'],
  /**
   * The bed under both lab hallways, not the station. Final:
   * `spider_hallway_ambience_loop` (streamed). Start it through
   * `spiderQuestLoop('hallwayBed')`.
   */
  hallwayBed: ['spider_hallway_ambience_loop'],
  /** A heavy web strand straining overhead. Final: `web_strand_creak_1` … `_3`. */
  webCreak: ['web_strand_creak_1', 'web_strand_creak_2', 'web_strand_creak_3'],
  /** A step on the eggshell shards toward the lab end. Final: `eggshell_crunch_1` … `_4`. */
  eggshellCrunch: [
    'eggshell_crunch_1',
    'eggshell_crunch_2',
    'eggshell_crunch_3',
    'eggshell_crunch_4',
  ],
  /** The hallway's dying tube stuttering off and back on. Final: `fluorescent_tube_flicker_1` … `_2`. */
  tubeFlicker: ['fluorescent_tube_flicker_1', 'fluorescent_tube_flicker_2'],
} as const satisfies Record<string, readonly SoundId[]>;

/** Which cue a play site raises. */
export type SpiderQuestCue = keyof typeof SPIDER_QUEST_CUES;

/** The cues that play as continuous loops rather than one-shots. */
export type SpiderQuestLoopCue = Extract<SpiderQuestCue, 'hallwayBed' | 'panickedFootstepsLoop'>;

const HALLWAY_BED_VOLUME = 0.5;
const PANICKED_FOOTSTEPS_VOLUME = 0.45;

/** Each loop cue's level and fades; the id comes from its cue's first take. */
const SPIDER_QUEST_LOOP_LEVELS = {
  hallwayBed: {
    volume: HALLWAY_BED_VOLUME,
    fadeInMs: AMBIENT_RAMP_MS,
    fadeOutMs: AMBIENT_RAMP_MS,
  },
  panickedFootstepsLoop: {
    volume: PANICKED_FOOTSTEPS_VOLUME,
    fadeInMs: MIN_STOP_FADE_MS,
    fadeOutMs: AMBIENT_RAMP_MS,
  },
} as const satisfies Record<SpiderQuestLoopCue, Omit<LoopLevel, 'id'>>;

/**
 * One recording behind `cue`, picked by `roll` in [0, 1) among its takes, or
 * null while the cue is silent.
 */
export function spiderQuestCueSound(cue: SpiderQuestCue, roll = 0): SoundId | null {
  const takes: readonly SoundId[] = SPIDER_QUEST_CUES[cue];
  const takeIndex = Math.min(takes.length - 1, Math.floor(roll * takes.length));
  return takes[takeIndex] ?? null;
}

/**
 * Plays a random take of `cue` once through `audio`. Silent for an empty cue
 * or a missing audio manager. The roll is taken only when there is audio to
 * play, so a headless simulation's random stream is untouched.
 */
export function playSpiderQuestCue(
  audio: Pick<AudioManager, 'play'> | null,
  cue: SpiderQuestCue,
  opts?: PlayOptions,
): void {
  if (audio === null) return;
  const sound = spiderQuestCueSound(cue, Math.random());
  if (sound === null) return;
  audio.play(sound, opts);
}

/** {@link playSpiderQuestCue} from a point in the world, in world pixels. */
export function playSpiderQuestCueAt(
  audio: Pick<AudioManager, 'playAt'> | null,
  cue: SpiderQuestCue,
  worldX: number,
  worldY: number,
  opts?: PlayOptions,
): void {
  if (audio === null) return;
  const sound = spiderQuestCueSound(cue, Math.random());
  if (sound === null) return;
  audio.playAt(sound, worldX, worldY, opts);
}

/**
 * The loop behind `cue` at its fixed level, for `AudioScope.startLoop` /
 * `stopLoop`, or null while the cue is silent.
 */
export function spiderQuestLoop(cue: SpiderQuestLoopCue): LoopLevel | null {
  const id = spiderQuestCueSound(cue);
  if (id === null) return null;
  return { id, ...SPIDER_QUEST_LOOP_LEVELS[cue] };
}
