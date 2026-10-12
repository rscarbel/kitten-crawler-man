/**
 * Everything the poker table did since the host last looked, drained once per
 * frame by the presentation host to drive card and chip flights, reveals,
 * banter and audio. The table never calls into any of those itself.
 */

import type { Card } from '../Deck';
import type { LegalActions, PokerActionKind } from './bettingRound';
import type { TellCue } from './npc/tells';

export type BoardStreet = 'flop' | 'turn' | 'river';
export type Street = 'preflop' | BoardStreet;

export type BlindKind = 'small' | 'big';

/** Moments a seated regular may remark on; the host picks the line. */
export type PokerBanterTrigger =
  | 'sit_down'
  | 'big_pot_win'
  | 'bad_beat'
  | 'bluff_shown'
  | 'got_bluffed'
  | 'fold_to_raise'
  | 'all_in'
  | 'needle_player'
  | 'rebuy'
  | 'leaving'
  | 'tilted'
  | 'card_dead';

/** A visible habit a regular shows; what it means is for the player to work out. */
export type TellEventCue = TellCue;

/** Which hole cards a seat turned over: indices into its two hole cards. */
export type ShownCardIndices = ReadonlyArray<0 | 1>;

export type PokerEvent =
  | {
      readonly kind: 'shuffled';
      readonly handNumber: number;
      /** Every seat's stack as the hand starts, after seat churn and before the blinds. */
      readonly stacks: ReadonlyArray<number>;
      /** Cards left in the fresh deck: all 52. */
      readonly cardsRemaining: number;
      /** Which seats are dealt in; an empty chair, or one with no chips, sits the hand out. */
      readonly dealt: ReadonlyArray<boolean>;
    }
  | { readonly kind: 'button_moved'; readonly seat: number }
  | {
      readonly kind: 'blind_posted';
      readonly seat: number;
      readonly blind: BlindKind;
      readonly amount: number;
    }
  | { readonly kind: 'hole_dealt'; readonly seat: number; readonly index: number }
  | { readonly kind: 'burn'; readonly street: BoardStreet }
  | {
      readonly kind: 'street_dealt';
      readonly street: BoardStreet;
      readonly cards: ReadonlyArray<Card>;
    }
  | {
      readonly kind: 'action';
      readonly seat: number;
      readonly action: PokerActionKind;
      /** Chips the action moved into the pot. */
      readonly amount: number;
      /** The seat's total bet on this street afterwards. */
      readonly streetTotal: number;
    }
  | { readonly kind: 'player_turn'; readonly legal: LegalActions }
  | { readonly kind: 'uncalled_returned'; readonly seat: number; readonly amount: number }
  | { readonly kind: 'bets_collected'; readonly street: Street; readonly pot: number }
  /** No more betting is possible: every live hand turns face up before the board runs out. */
  | { readonly kind: 'runout_started' }
  | {
      readonly kind: 'showdown_reveal';
      readonly seat: number;
      readonly cards: ReadonlyArray<Card>;
      readonly label: string;
    }
  | { readonly kind: 'muck'; readonly seat: number }
  /** An uncontested winner turning over some of their cards by choice. */
  | { readonly kind: 'uncontested_show'; readonly seat: number; readonly shown: ShownCardIndices }
  | {
      readonly kind: 'pot_awarded';
      readonly potIndex: number;
      readonly seats: ReadonlyArray<number>;
      readonly amounts: ReadonlyArray<number>;
      readonly uncontested: boolean;
      /** The winning hand's name; `null` when nobody had to show. */
      readonly label: string | null;
    }
  | {
      readonly kind: 'hand_complete';
      readonly handNumber: number;
      /** Each seat's chips won minus chips put in this hand, indexed by seat. */
      readonly netBySeat: ReadonlyArray<number>;
      /** Every seat's stack once the pots are paid. */
      readonly stacks: ReadonlyArray<number>;
      /** Chips each seat put in this hand, blinds included, after any uncalled bet came back. */
      readonly contributions: ReadonlyArray<number>;
      /** Seats dealt in that never folded: the ones with a claim on the pots. */
      readonly live: ReadonlyArray<boolean>;
      /** Every seat's hole cards, shown or not. */
      readonly holeCards: ReadonlyArray<ReadonlyArray<Card>>;
      readonly board: ReadonlyArray<Card>;
      /** The burned cards, for deck checks only; the host never shows them. */
      readonly burned: ReadonlyArray<Card>;
    }
  | {
      readonly kind: 'seat_busted';
      readonly seat: number;
      /** Who busted, read before any churn can empty the chair. */
      readonly occupantId: string;
    }
  | { readonly kind: 'seat_rebuy'; readonly seat: number; readonly amount: number }
  | {
      readonly kind: 'seat_vacated';
      readonly seat: number;
      readonly occupantId: string;
      /** The chips the regular took with them. */
      readonly stack: number;
    }
  | {
      readonly kind: 'seat_replaced';
      readonly seat: number;
      readonly occupantId: string;
      readonly stack: number;
    }
  | { readonly kind: 'player_busted' }
  /** No regular is left at the table: the game is over. */
  | { readonly kind: 'game_over' }
  | { readonly kind: 'player_rebuy'; readonly amount: number }
  | { readonly kind: 'banter'; readonly seat: number; readonly trigger: PokerBanterTrigger }
  /**
   * A regular shows a tell. Think-pace, bet-size and chip-motion cues arrive
   * as the seat's turn begins and colour the action that follows; fidgets,
   * chatter and card rechecks play while others act (`TELL_MOMENT` says which).
   */
  | { readonly kind: 'tell'; readonly seat: number; readonly cue: TellEventCue };

export type PokerEventKind = PokerEvent['kind'];
