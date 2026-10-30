/**
 * Wendell's construction contracts' sounds, by what they mean rather than by
 * file.
 *
 * Every play site raises a cue from this table, never a raw id, so each
 * recording that lands is its registration in `src/audio/sounds.ts` plus one
 * line here. A cue with several takes plays a random one each time; a loop
 * cue plays its first.
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

import type { AudioManager } from './AudioManager';
import type { SoundId } from './sounds';

export const CONTRACT_CUES = {
  /** Wendell issuing a contract. */
  contractSigned: ['contract_signed'],
  /** A work order's strip torn off the notice board, layered on {@link CONTRACT_CUES.contractSigned}. */
  noticeTearOff: ['notice_tear_off_1', 'notice_tear_off_2', 'notice_tear_off_3'],
  /** The work channel's loop on a wood or rope spot. Final: `repairing_loop`. */
  woodWorkLoop: ['repairing_loop'],
  /** The work channel's loop on a stone or plaster spot. */
  stoneWorkLoop: ['masonry_work_loop'],
  /** The broken boards and old nails coming out as a wood spot's channel starts. */
  oldWorkPry: ['old_work_pry_1', 'old_work_pry_2', 'old_work_pry_3', 'old_work_pry_4'],
  /** A wood spot finished. Final: `hammer_strike`. */
  woodSpotDone: ['hammer_strike'],
  /** A rope spot finished. Final: `rope_tightening`. */
  ropeSpotDone: ['rope_tightening'],
  /** A stone or plaster spot finished: the last stone set home. */
  stoneSpotDone: ['stone_set_mortar_1', 'stone_set_mortar_2', 'stone_set_mortar_3'],
  /** Layered on every spot's own finish cue. Final: `construction_complete`. */
  spotFinished: ['construction_complete'],
  /** The last spot of a contract finished. */
  contractJobDone: ['contract_job_done'],
  /** Wendell's follow-up box opening after a contract is paid. */
  wendellNote: ['message_note_arrive'],
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

/** The first recording behind `cue`, or null while the cue is silent. */
export function contractCueSound(cue: ContractCue): SoundId | null {
  const takes: readonly SoundId[] = CONTRACT_CUES[cue];
  return takes[0] ?? null;
}

/** Plays one take of `cue` through `audio`. Silent for an empty cue or a missing audio manager. */
export function playContractCue(
  audio: Pick<AudioManager, 'playRandom'> | null,
  cue: ContractCue,
): void {
  audio?.playRandom(CONTRACT_CUES[cue]);
}
