/**
 * How often the regulars speak. Every moment worth a remark is offered here
 * first; at most one ordinary line is spoken per hand, ordinary remarks wait a few hands
 * after the last one, and a quiet regular passes on most of their chances, so
 * the table is lively without ever being noisy.
 */

import type { PokerBanterTrigger } from '../pokerEvents';

export interface BanterPaceState {
  /** The hand the last line was spoken in, or null before anyone has spoken. */
  readonly lastSpokenHand: number | null;
}

export const QUIET_TABLE: BanterPaceState = { lastSpokenHand: null };

/** Ordinary remarks wait this many hands after the last line, table-wide. */
export const BANTER_GAP_HANDS = 3;

/**
 * Moments that explain a seat changing hands: neither the gap nor the
 * one-line-a-hand limit applies, since the player should hear why a chair
 * emptied or filled even right after a big pot was remarked on.
 */
const SEAT_CHANGE_TRIGGERS: ReadonlySet<PokerBanterTrigger> = new Set<PokerBanterTrigger>([
  'sit_down',
  'rebuy',
  'leaving',
]);

/** How keen anyone is to speak at each moment, multiplied by the regular's chattiness. */
const TRIGGER_EAGERNESS: Readonly<Record<PokerBanterTrigger, number>> = {
  sit_down: 0.6,
  big_pot_win: 1,
  bad_beat: 1,
  bluff_shown: 1,
  got_bluffed: 1,
  fold_to_raise: 0.35,
  all_in: 0.8,
  needle_player: 1,
  rebuy: 1,
  leaving: 1,
  tilted: 1,
  card_dead: 0.7,
};

export interface BanterOffer {
  readonly trigger: PokerBanterTrigger;
  readonly handNumber: number;
  /** The regular's chattiness in [0, 1]. */
  readonly chattiness: number;
}

/**
 * Whether an offered line is spoken, given a uniform `roll` in [0, 1), and the
 * pacing state afterwards.
 */
export function paceBanter(
  state: BanterPaceState,
  offer: BanterOffer,
  roll: number,
): { readonly speak: boolean; readonly state: BanterPaceState } {
  const last = state.lastSpokenHand;
  const spokeThisHand = last === offer.handNumber;
  const gapOpen = last === null || offer.handNumber - last >= BANTER_GAP_HANDS;
  const seatChange = SEAT_CHANGE_TRIGGERS.has(offer.trigger);
  if ((spokeThisHand || !gapOpen) && !seatChange) return { speak: false, state };
  const eager = roll < offer.chattiness * TRIGGER_EAGERNESS[offer.trigger];
  const speak = eager || offer.trigger === 'leaving';
  return { speak, state: speak ? { lastSpokenHand: offer.handNumber } : state };
}
