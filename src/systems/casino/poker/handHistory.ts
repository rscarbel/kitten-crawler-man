/**
 * The table's recent hands as the player saw them: who won what, the board,
 * the player's own two cards and what the hand did to their stack.
 *
 * Built from the events the host drains rather than from the table's live
 * state, because by the time a frame's events are read the table may already
 * have moved on. Hands played out instantly when the player leaves never
 * reach the host, so they are never recorded.
 */

import type { Card } from '../Deck';
import type { PokerEvent } from './pokerEvents';
import { PLAYER_SEAT, type PokerTable } from './PokerTable';

/** Hands the history keeps; older ones fall off the end. */
export const HAND_HISTORY_LIMIT = 20;

/** One pot as it was pushed: the main pot first, then each side pot. */
export interface HandHistoryPot {
  /** Everyone who took a share of this pot; more than one means it was split. */
  readonly winners: ReadonlyArray<string>;
  readonly amount: number;
  readonly side: boolean;
}

export interface HandHistoryEntry {
  readonly handNumber: number;
  /** The player's two cards, or none when the hand ended before they were dealt. */
  readonly playerCards: ReadonlyArray<Card>;
  readonly board: ReadonlyArray<Card>;
  /** Each pot and who took it, main pot first. */
  readonly pots: ReadonlyArray<HandHistoryPot>;
  /** The winning hand's name, or `null` when nobody had to show. */
  readonly winningHand: string | null;
  /** Every chip pushed, across all the pots. */
  readonly pot: number;
  /** The player's chips won minus chips put in. */
  readonly playerNet: number;
}

interface HandInProgress {
  readonly handNumber: number;
  playerCards: ReadonlyArray<Card>;
  readonly board: Card[];
  readonly pots: HandHistoryPot[];
  winningHand: string | null;
  pot: number;
}

export class PokerHandHistory {
  private current: HandInProgress | null = null;
  private readonly finished: HandHistoryEntry[] = [];

  /** @param seatName Who sits in a seat as the table names them, read when they win. */
  constructor(private readonly seatName: (seat: number) => string) {}

  /** Newest first. */
  get entries(): ReadonlyArray<HandHistoryEntry> {
    return this.finished;
  }

  /** Forgets the hand under way: the player stood up before it finished. */
  abandonHand(): void {
    this.current = null;
  }

  observe(event: PokerEvent, table: PokerTable): void {
    if (event.kind === 'shuffled') {
      this.current = {
        handNumber: event.handNumber,
        playerCards: [],
        board: [],
        pots: [],
        winningHand: null,
        pot: 0,
      };
      return;
    }
    const hand = this.current;
    if (hand === null) return;
    if (event.kind === 'hole_dealt') {
      // The table has not moved past this hand while one of its cards is still being reported.
      if (event.seat === PLAYER_SEAT && table.handNumber === hand.handNumber) {
        hand.playerCards = [...table.seats[PLAYER_SEAT].holeCards];
      }
    } else if (event.kind === 'street_dealt') {
      hand.board.push(...event.cards);
    } else if (event.kind === 'pot_awarded') {
      const amount = event.amounts.reduce((sum, share) => sum + share, 0);
      hand.pots.push({
        winners: event.seats.map((seat) => this.seatName(seat)),
        amount,
        side: event.potIndex > 0,
      });
      hand.pot += amount;
      if (event.potIndex === 0) hand.winningHand = event.label;
    } else if (event.kind === 'hand_complete') {
      this.finish(hand, event.netBySeat[PLAYER_SEAT] ?? 0);
    }
  }

  private finish(hand: HandInProgress, playerNet: number): void {
    this.finished.unshift({
      handNumber: hand.handNumber,
      playerCards: hand.playerCards,
      board: [...hand.board],
      pots: [...hand.pots],
      winningHand: hand.winningHand,
      pot: hand.pot,
      playerNet,
    });
    this.finished.length = Math.min(this.finished.length, HAND_HISTORY_LIMIT);
    this.current = null;
  }
}
