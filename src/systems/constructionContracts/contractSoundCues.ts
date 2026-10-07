/**
 * Wendell's construction contracts' sounds, by what they mean rather than by
 * file.
 *
 * Every play site raises a cue from this table, never a raw id, so each
 * recording that lands is its registration in `src/audio/sounds.ts` plus one
 * line here. A cue still waiting on its recording either borrows the nearest
 * sound the game already has or is an empty list — silent — where nothing
 * stands in; each entry's JSDoc names the file it is waiting for.
 *
 * Contract spots sit both on the floor-3 streets and inside buildings, so
 * every id here is preloaded through the `constructionContracts` group in
 * `src/audio/sfxGroups.ts`, which both the overworld's bundle and every
 * interior load. `AudioManager.play` returns silently on a buffer that was
 * never preloaded.
 *
 * The quest-complete fanfare is not a cue here: it plays on `questCompleted`
 * like every quest's.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { SoundId } from '../../audio/sounds';
import type { ContractSpotMaterial } from './contractCatalog';

export const CONTRACT_CUES = {
  /** Wendell issuing a contract. Waits on `contract_signed`; `picking_up_ground_object` stands in. */
  contractSigned: ['picking_up_ground_object'],
  /** The work channel's loop on a wood or rope spot. Final: `repairing_loop`. */
  woodWorkLoop: ['repairing_loop'],
  /** The work channel's loop on a stone or plaster spot. Waits on `masonry_work_loop`; `repairing_loop` stands in. */
  stoneWorkLoop: ['repairing_loop'],
  /** The broken boards and old nails coming out as a wood spot's channel starts. Waits on `old_work_pry`. */
  oldWorkPry: [],
  /** A wood spot finished. Final: `hammer_strike`. */
  woodSpotDone: ['hammer_strike'],
  /** A rope spot finished. Final: `rope_tightening`. */
  ropeSpotDone: ['rope_tightening'],
  /** A stone or plaster spot finished. Waits on `stone_set_mortar`; `hammer_strike` stands in. */
  stoneSpotDone: ['hammer_strike'],
  /** Layered on every spot's own finish cue. Final: `construction_complete`. */
  spotFinished: ['construction_complete'],
  /** The last spot of a contract finished. Waits on `contract_job_done`; `construction_complete` stands in. */
  contractJobDone: ['construction_complete'],
  /** Wendell's follow-up box opening after a contract is paid. Waits on `message_note_arrive`. */
  wendellNote: [],
  /** The client's coins paid into the purse. Final: `coin_pouch`. */
  payout: ['coin_pouch'],
  /**
   * The quest-complete fanfare layered on the payout. `quest_complete` only
   * plays from the reward screen elsewhere, and a repeatable contract skips
   * that screen. Final: `quest_complete`.
   */
  payoutFanfare: ['quest_complete'],
} as const satisfies Record<string, readonly SoundId[]>;

/** Which cue a play site raises. */
export type ContractCue = keyof typeof CONTRACT_CUES;

/** The cues a spot of one material raises over its work channel. */
export interface ContractMaterialCues {
  /** Runs for the whole channel. */
  readonly workLoop: ContractCue;
  /** Plays once as the channel starts, or null where the material has no opening sound. */
  readonly start: ContractCue | null;
  /** Plays once as the channel finishes, under {@link CONTRACT_CUES.spotFinished}. */
  readonly finish: ContractCue;
}

const MATERIAL_CUES: Record<ContractSpotMaterial, ContractMaterialCues> = {
  wood: { workLoop: 'woodWorkLoop', start: 'oldWorkPry', finish: 'woodSpotDone' },
  rope: { workLoop: 'woodWorkLoop', start: null, finish: 'ropeSpotDone' },
  stone: { workLoop: 'stoneWorkLoop', start: null, finish: 'stoneSpotDone' },
  plaster: { workLoop: 'stoneWorkLoop', start: null, finish: 'stoneSpotDone' },
};

/** The work-loop, start and finish cues for a spot made of `material`. */
export function contractMaterialCues(material: ContractSpotMaterial): ContractMaterialCues {
  return MATERIAL_CUES[material];
}

/** The recording behind `cue`, or null while the cue is silent. */
export function contractCueSound(cue: ContractCue): SoundId | null {
  const takes: readonly SoundId[] = CONTRACT_CUES[cue];
  return takes[0] ?? null;
}

/** Plays `cue` once through `audio`. Silent for an empty cue or a missing audio manager. */
export function playContractCue(audio: Pick<AudioManager, 'play'> | null, cue: ContractCue): void {
  const sound = contractCueSound(cue);
  if (audio === null || sound === null) return;
  audio.play(sound);
}

const CONTRACT_WORK_LOOP_VOLUME = 0.7;

/** The slice of `AudioManager` a work loop drives. */
export type ContractLoopAudio = Pick<
  AudioManager,
  'startAmbientLoop' | 'stopAmbientLoop' | 'isAmbientLoopRunning'
>;

/** A running work-channel loop, owned by whoever started it. */
export interface ContractWorkLoopHandle {
  /**
   * Restarts the loop if it was lost under the channel. Call every update
   * while the channel runs: other systems play and stop the same recording,
   * and a locked audio context declines a start until the player's first
   * gesture.
   */
  keepAlive(): void;
  /** Silences the loop. Safe to call more than once. */
  stop(): void;
}

/**
 * Starts the work loop for a spot made of `material`. The returned handle
 * only ever stops a loop it started, so ending a channel never silences a
 * loop another system owns.
 */
export function startContractWorkLoop(
  audio: ContractLoopAudio | null,
  material: ContractSpotMaterial,
): ContractWorkLoopHandle {
  const sound = contractCueSound(contractMaterialCues(material).workLoop);
  let owned = false;
  let stopped = false;
  const keepAlive = (): void => {
    if (audio === null || sound === null || stopped) return;
    if (audio.isAmbientLoopRunning(sound)) return;
    audio.startAmbientLoop(sound, CONTRACT_WORK_LOOP_VOLUME);
    owned = true;
  };
  keepAlive();
  return {
    keepAlive,
    stop: () => {
      stopped = true;
      if (audio === null || sound === null || !owned) return;
      audio.stopAmbientLoop(sound);
      owned = false;
    },
  };
}
