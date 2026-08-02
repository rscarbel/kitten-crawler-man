/**
 * The Desperado Club's blackjack shoe: one 52-card deck that never repeats a
 * card until it reshuffles.
 *
 * The deck holds all 52 cards permanently and tracks a draw *cursor* rather
 * than popping from a shrinking array. Popping and pushing back on reshuffle is
 * where "a dealt card resurfaced" bugs come from; with a cursor, everything
 * below it is structurally unreachable until `shuffle()` resets it.
 */

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export const DECK_SIZE = SUITS.length * RANKS.length;

/**
 * Reshuffle once this many cards or fewer are left, checked only between rounds.
 * Comfortably above the ~11 cards a single round can consume, so the shoe can
 * never run dry mid-hand.
 */
export const RESHUFFLE_THRESHOLD = 17;

/** A shoe as a plain value, so it can live on `ClubMembership` across scenes. */
export interface ShoeState {
  readonly cards: ReadonlyArray<Card>;
  readonly cursor: number;
}

function orderedDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) cards.push({ rank, suit });
  }
  return cards;
}

/**
 * Fisher–Yates in place. Mirrors `shuffleTracks` in `audio/AudioManager.ts` for
 * style consistency; randomness is `Math.random()` deliberately — the repo's
 * seeded generator is for things that must reproduce, and a shuffle must not.
 */
function permute(cards: Card[]): void {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
}

/** A fresh, shuffled 52-card shoe. */
export function createShoe(): ShoeState {
  const cards = orderedDeck();
  permute(cards);
  return { cards, cursor: 0 };
}

export class Deck {
  private readonly cards: Card[];
  private cursor: number;

  private constructor(cards: Card[], cursor: number) {
    this.cards = cards;
    this.cursor = cursor;
  }

  static fresh(): Deck {
    return Deck.fromState(createShoe());
  }

  static fromState(state: ShoeState): Deck {
    return new Deck([...state.cards], state.cursor);
  }

  toState(): ShoeState {
    return { cards: [...this.cards], cursor: this.cursor };
  }

  get remaining(): number {
    return this.cards.length - this.cursor;
  }

  /** True once the shoe is short enough to reshuffle. Queried only between rounds. */
  get needsReshuffle(): boolean {
    return this.remaining <= RESHUFFLE_THRESHOLD;
  }

  /**
   * The next card, or `null` when the shoe is exhausted.
   *
   * Deliberately does not throw and does not auto-reshuffle: a mid-round
   * reshuffle would put an already-dealt card back into the live hand, which is
   * the exact failure this deck exists to prevent. Callers treat `null` as a
   * defect-level condition and abort the round.
   */
  draw(): Card | null {
    if (this.cursor >= this.cards.length) return null;
    const card = this.cards[this.cursor];
    this.cursor++;
    return card;
  }

  shuffle(): void {
    this.cursor = 0;
    permute(this.cards);
  }
}

/** Stable identity for a card, for dedupe checks and debug readouts. */
export function cardId(card: Card): string {
  return `${card.rank}${card.suit[0]}`;
}
