/**
 * Every sound the slot machine makes, by what happened rather than by file.
 *
 * Play sites raise a cue and never name a `SoundId` directly, so when a
 * recording lands it is registered once and swapped in here. A cue still
 * waiting on its own file stays silent (`null`); its JSDoc names the file it
 * is waiting for. A `SoundId` is never registered before its file exists.
 */

import type { SoundId } from '../../../audio/sounds';

export const SLOTS_CUES = {
  lever_pull: 'slots_lever_pull',
  spin_button: 'slots_spin_button',
  bet_up: 'slots_bet_up',
  bet_down: 'slots_bet_down',
  max_bet: 'slots_max_bet',
  reel_stop: 'slots_reel_stop',
  anticipation_riser: 'slots_anticipation_riser',
  near_miss: 'slots_near_miss',
  line_win_small: 'slots_line_win_small',
  big_win: 'slots_big_win',
  mega_win: 'slots_mega_win',
  epic_win: 'slots_epic_win',
  jackpot_siren: 'slots_jackpot_siren',
  free_spins_trigger: 'slots_free_spins_trigger',
  /** Waiting for `casino/slots/attract_chime.mp3`: the idle machine's occasional jingle. */
  attract_chime: null,
} as const satisfies Record<string, SoundId | null>;

export type SlotsCue = keyof typeof SLOTS_CUES;

/** Cues that loop for as long as their moment lasts, started and stopped by the host. */
export const SLOTS_LOOPS = {
  reels: 'slots_reels_spinning_loop',
  rollup: 'slots_credit_rollup_loop',
  hopper: 'slots_coin_hopper_loop',
} as const satisfies Record<string, SoundId>;

export type SlotsLoop = keyof typeof SLOTS_LOOPS;

/** The first, second and third scatter of a spin, climbing in pitch. */
export const SCATTER_LAND_SOUNDS = [
  'slots_scatter_land_1',
  'slots_scatter_land_2',
  'slots_scatter_land_3',
] as const satisfies readonly SoundId[];

/** Each winning payline traced in turn, climbing. */
export const PAYLINE_TRACE_SOUNDS = [
  'slots_payline_trace_1',
  'slots_payline_trace_2',
  'slots_payline_trace_3',
] as const satisfies readonly SoundId[];

export const CROWD_CHEER_SOUNDS = [
  'slots_crowd_cheer_1',
  'slots_crowd_cheer_2',
  'slots_crowd_cheer_3',
] as const satisfies readonly SoundId[];

/** The sound a cue plays today, or null while it stays silent. */
export function slotsCueSound(cue: SlotsCue): SoundId | null {
  return SLOTS_CUES[cue];
}

/** The `ordinal`th scatter of a spin's landing sound, the third and later sharing the top take. */
export function scatterLandSound(ordinal: number): SoundId {
  const index = Math.max(0, Math.min(SCATTER_LAND_SOUNDS.length - 1, ordinal - 1));
  return SCATTER_LAND_SOUNDS[index] ?? SCATTER_LAND_SOUNDS[0];
}

/** The `index`th traced payline's sound, cycling up the three takes. */
export function paylineTraceSound(index: number): SoundId {
  return PAYLINE_TRACE_SOUNDS[index % PAYLINE_TRACE_SOUNDS.length] ?? PAYLINE_TRACE_SOUNDS[0];
}
