/**
 * The regulars' out-loud reactions to how a hand ended: a chuckle from a
 * regular whose bluff was turned over and won, a groan from a regular who lost
 * a big pot. Built from the events the host drains rather than the table's
 * live state, because by the time a frame's events are read the table may
 * already have moved on.
 */

import type { Card } from '../Deck';
import { handStrengthNow } from './npc/combos';
import type { PokerEvent } from './pokerEvents';
import { FLOP_CARD_COUNT, HOLE_CARD_COUNT, PLAYER_SEAT, POKER_SEAT_COUNT } from './PokerTable';

/** A bet or raise made while the hand rates below this against one random hand, on the board as it stood, is a bluff. */
export const BLUFF_STRENGTH_BELOW = 0.35;

/** A regular losing this many big blinds in one hand groans out loud. */
export const GROAN_LOSS_BIG_BLINDS = 30;

/** Whose voice a seat's reaction is in; the recordings are one species' each. */
export type ReactionVoice = 'human' | 'hawkfolk';

export type PokerReaction = 'reaction_chuckle' | 'hawkfolk_chuckle' | 'reaction_groan';

/** What a pot winner's hand showed, for judging whether they won it on a bluff. */
export interface ShownBluffFacts {
  /** Both hole cards were turned over, at showdown or by choice. */
  readonly shownBothCards: boolean;
  readonly hole: ReadonlyArray<Card>;
  /** The board as it stood at each of the seat's bets and raises, in order. */
  readonly boardsAtAggression: ReadonlyArray<ReadonlyArray<Card>>;
}

/**
 * A pot winner's shown bluff: both cards were turned over, and at least one of
 * the seat's bets or raises after the flop was made while its hand rated below
 * {@link BLUFF_STRENGTH_BELOW} on the board at that moment. Betting before the
 * flop never counts, so a hand that ended preflop never does either.
 */
export function isShownWinningBluff(facts: ShownBluffFacts): boolean {
  if (!facts.shownBothCards || facts.hole.length < HOLE_CARD_COUNT) return false;
  return facts.boardsAtAggression.some(
    (board) =>
      board.length >= FLOP_CARD_COUNT && handStrengthNow(facts.hole, board) < BLUFF_STRENGTH_BELOW,
  );
}

/**
 * Follows one hand's events and, as it completes, says which reaction it
 * draws. Observe every event, skipped hands included, so a hand picked up
 * part way is never judged on half its betting.
 */
export class PokerHandReactions {
  private voices: ReadonlyArray<ReactionVoice | null> = [];
  private readonly shown = new Set<number>();
  private readonly potWinners = new Set<number>();
  private board: ReadonlyArray<Card> = [];
  private streetHighBet = 0;
  /**
   * Hole cards stay hidden until a showdown, so each post-flop bet or raise
   * keeps the board it was made on and is judged once the cards are known.
   */
  private readonly boardsAtAggression = new Map<number, Array<ReadonlyArray<Card>>>();

  /** @param voiceAt The voice of whoever sits at `seat`, read as each hand is shuffled; `null` for the player and empty chairs. */
  constructor(private readonly voiceAt: (seat: number) => ReactionVoice | null) {}

  observe(event: PokerEvent): void {
    if (event.kind === 'shuffled') {
      this.voices = Array.from({ length: POKER_SEAT_COUNT }, (_, seat) =>
        seat === PLAYER_SEAT ? null : this.voiceAt(seat),
      );
      this.shown.clear();
      this.potWinners.clear();
      this.board = [];
      this.streetHighBet = 0;
      this.boardsAtAggression.clear();
    } else if (event.kind === 'street_dealt') {
      this.board = [...this.board, ...event.cards];
      this.streetHighBet = 0;
    } else if (event.kind === 'action' && this.board.length >= FLOP_CARD_COUNT) {
      // Any action that lifts the street's bet is aggression, an all-in raise included.
      if (event.streetTotal > this.streetHighBet) {
        const boards = this.boardsAtAggression.get(event.seat) ?? [];
        boards.push(this.board);
        this.boardsAtAggression.set(event.seat, boards);
      }
      this.streetHighBet = Math.max(this.streetHighBet, event.streetTotal);
    } else if (event.kind === 'showdown_reveal') {
      this.shown.add(event.seat);
    } else if (event.kind === 'uncontested_show' && event.shown.length >= HOLE_CARD_COUNT) {
      this.shown.add(event.seat);
    } else if (event.kind === 'pot_awarded') {
      for (const seat of event.seats) this.potWinners.add(seat);
    }
  }

  /**
   * The one reaction a completed hand draws: a regular who won any pot on a
   * shown bluff chuckles, in their own species' voice; otherwise the biggest
   * loss at a human regular's seat groans when it reaches
   * {@link GROAN_LOSS_BIG_BLINDS}. The player never reacts, and Hawkfolk have
   * no groan.
   */
  reactionTo(
    complete: Extract<PokerEvent, { kind: 'hand_complete' }>,
    bigBlind: number,
  ): PokerReaction | null {
    for (const seat of this.potWinners) {
      const voice = this.voices[seat] ?? null;
      if (voice === null) continue;
      const bluffWon = isShownWinningBluff({
        shownBothCards: this.shown.has(seat),
        hole: complete.holeCards[seat] ?? [],
        boardsAtAggression: this.boardsAtAggression.get(seat) ?? [],
      });
      if (bluffWon) return voice === 'human' ? 'reaction_chuckle' : 'hawkfolk_chuckle';
    }
    let biggestHumanLoss = 0;
    complete.netBySeat.forEach((net, seat) => {
      if (this.voices[seat] === 'human') biggestHumanLoss = Math.max(biggestHumanLoss, -net);
    });
    const groanAt = GROAN_LOSS_BIG_BLINDS * bigBlind;
    return biggestHumanLoss >= groanAt && biggestHumanLoss > 0 ? 'reaction_groan' : null;
  }
}
