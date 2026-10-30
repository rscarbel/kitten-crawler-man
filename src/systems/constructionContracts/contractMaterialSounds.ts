/**
 * Which contract cues a spot raises for the material it is made of, and the
 * work-channel loop that runs while a crawler works it.
 */

import type { AudioScope } from '../../audio/AudioScope';
import { contractCueSound, type ContractCue } from '../../audio/contractSoundCues';
import type { ContractSpotMaterial } from './contractCatalog';

/** The cues a spot of one material raises over its work channel. */
export interface ContractMaterialCues {
  /** Runs for the whole channel. */
  readonly workLoop: ContractCue;
  /** Plays once as the channel starts, or null where the material has no opening sound. */
  readonly start: ContractCue | null;
  /** Plays once as the channel finishes, under the `spotFinished` cue. */
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

const CONTRACT_WORK_LOOP_VOLUME = 0.7;

/** The slice of the scene's `AudioScope` a work loop drives. */
export type ContractLoopAudio = Pick<
  AudioScope,
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
