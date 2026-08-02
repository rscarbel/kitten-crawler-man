/**
 * The blackjack table's whole state machine: chips, hands, phases and payouts.
 *
 * Zero rendering and zero canvas imports, deliberately — the presentation host
 * (`ClubCasinoSystem`) reads this model and animates it, which is what keeps the
 * money invariants verifiable without a canvas.
 *
 * The table is frame-driven: `update(dtMs)` advances the dealing and dealer
 * beats, so the `dealing` and `dealer_turn` phases occupy real time for the
 * animation layer to fill rather than the panel faking a delay.
 */

import type { Player } from '../../Player';
import { Deck, type Card, type ShoeState } from './Deck';
import {
  BLACKJACK_TOTAL,
  dealerShouldHit,
  handValue,
  isBust,
  isNaturalBlackjack,
  isTenValue,
  payoutFor,
  settleRound,
  type RoundOutcome,
} from './blackjackRules';

export type TablePhase =
  'turned_away' | 'betting' | 'dealing' | 'player_turn' | 'dealer_turn' | 'settled';

const CHIP_SMALL = 10;
const CHIP_MEDIUM = 25;
const CHIP_LARGE = 50;
export const CHIP_DENOMINATIONS = [CHIP_SMALL, CHIP_MEDIUM, CHIP_LARGE] as const;
export type ChipDenomination = (typeof CHIP_DENOMINATIONS)[number];

export const TABLE_MINIMUM = 10;
export const TABLE_MAXIMUM = 100;
/**
 * Unlocks only once the free-escort wager gate is already cleared, so a bigger
 * bet can never accelerate the perk economy it would otherwise short-circuit.
 */
export const HIGH_ROLLER_MAXIMUM = 250;
export const HIGH_ROLLER_UNLOCK_WAGERED = 500;

/** How many cards each side takes on the opening deal (P, D, P, D-face-down). */
const OPENING_DEAL_CARDS = 4;
/**
 * Ceiling on the beats it takes to play the dealer out by hand: the hole-card
 * reveal, every draw a hand can take before busting, and the settle.
 */
const MAX_DEALER_RESOLVE_STEPS = 14;

// Beat timings. `DEAL_STAGGER_MS` is aligned to the four-card audio cue so each
// card lands on its own hit rather than drifting against the recording.
const DEAL_STAGGER_MS = 280;
const DEAL_FIRST_CARD_DELAY_MS = 120;
/** A held beat before the hole card turns — the most satisfying moment in the game. */
const HOLE_REVEAL_DELAY_MS = 520;
const DEALER_DRAW_STAGGER_MS = 640;
/** Breath between the dealer's last card and the outcome banner. */
const SETTLE_DELAY_MS = 420;

/** After this many hands Deuce offers to stop calling the plays. */
export const HINTS_AUTO_FADE_HANDS = 15;
/** Deuce marks a long session out loud at this many hands. */
export const LONG_SESSION_HANDS = 20;

/**
 * Things the model did this frame, drained once per frame by the presentation
 * host to spawn animations and fire audio. The model never calls into either.
 */
export type TableEvent =
  | { kind: 'chip_added'; denomination: number }
  | { kind: 'chip_removed'; denomination: number }
  | { kind: 'bet_cleared'; refunded: number }
  | { kind: 'opening_deal_started' }
  | { kind: 'card_dealt'; to: 'player' | 'dealer'; index: number }
  | { kind: 'hole_revealed' }
  | { kind: 'settled'; outcome: RoundOutcome; payout: number; stake: number }
  | { kind: 'reshuffled' };

/** Why an action was refused, surfaced as the panel's feedback line. */
export type TableRefusal = string | null;

export class BlackjackTable {
  private deck: Deck;

  playerHand: Card[] = [];
  dealerHand: Card[] = [];
  /** The dealer's second card is dealt face down and stays hidden until `dealer_turn`. */
  holeCardRevealed = false;

  /** One entry per chip on the felt, in the order they were stacked. */
  pendingBet: number[] = [];
  stake = 0;
  doubled = false;
  outcome: RoundOutcome | null = null;
  phase: TablePhase = 'betting';

  /** Every coin actually staked this visit, including double-down increments. */
  coinsWagered = 0;
  /** Set when a natural wins on a top-tier wager; the host clears it after the achievement. */
  jackpotPending = false;
  handsPlayed = 0;

  /** The last completed stack, for the "Same Bet" button. */
  private lastBet: number[] = [];
  private feedback: TableRefusal = null;
  private beatTimer = 0;
  private cardsDealtThisOpening = 0;
  /** False when the player busted or held a natural — the dealer only reveals and settles. */
  private dealerDrawsThisRound = true;
  private readonly events: TableEvent[] = [];

  constructor(shoe: ShoeState | null) {
    this.deck = shoe === null ? Deck.fresh() : Deck.fromState(shoe);
  }

  get cardsRemaining(): number {
    return this.deck.remaining;
  }

  shoeState(): ShoeState {
    return this.deck.toState();
  }

  get feedbackMessage(): TableRefusal {
    return this.feedback;
  }

  drainEvents(): ReadonlyArray<TableEvent> {
    const drained = [...this.events];
    this.events.length = 0;
    return drained;
  }

  private emit(event: TableEvent): void {
    this.events.push(event);
  }

  /** The bet ceiling right now: the house cap, raised for a proven high roller. */
  get tableMaximum(): number {
    return this.coinsWagered > HIGH_ROLLER_UNLOCK_WAGERED ? HIGH_ROLLER_MAXIMUM : TABLE_MAXIMUM;
  }

  /** The most that can sit on the felt, also bounded by what the player actually holds. */
  effectiveMaximum(player: Player): number {
    return Math.min(this.tableMaximum, player.coins + this.betTotal);
  }

  get betTotal(): number {
    return this.pendingBet.reduce((sum, chip) => sum + chip, 0);
  }

  get canRepeatLastBet(): boolean {
    return this.lastBet.length > 0;
  }

  // ── Session entry / exit ──────────────────────────────────────────────────

  /** True while a stake is locked on the felt and the hand is still live. */
  private get roundInProgress(): boolean {
    return this.phase === 'dealing' || this.phase === 'player_turn' || this.phase === 'dealer_turn';
  }

  /** Sitting down: a player who cannot cover the minimum is turned away, warmly. */
  sitDown(player: Player): void {
    this.feedback = null;
    // Settle up whatever the last session left — chips on the felt, a hand still
    // live, a payout not yet collected — before wiping the table. Clearing state
    // that still owes the player money is how a stake gets silently pocketed, and
    // doing it here means no caller has to remember.
    this.leaveTable(player);
    this.outcome = null;
    this.playerHand = [];
    this.dealerHand = [];
    this.holeCardRevealed = false;
    this.stake = 0;
    this.doubled = false;
    this.phase = player.coins < TABLE_MINIMUM ? 'turned_away' : 'betting';
  }

  /**
   * Leaving the table. Idempotent, and the felt is the only place a coin can be
   * stranded — every exit the player has (the Leave Table button, the Esc chain,
   * and the interior scene being torn down) routes through here.
   *
   * A hand still in progress is played out rather than abandoned. The table does
   * not survive leaving the club — it is rebuilt with the interior scene — so a
   * stake left locked on the felt is a stake destroyed, which is exactly what
   * walking out mid-hand would otherwise do.
   */
  leaveTable(player: Player): void {
    this.resolveInProgressHand();
    this.refundPendingBet(player);
    this.collectPayout(player);
  }

  /**
   * Fast-forward a live hand to a settled outcome: finish the opening deal, stand
   * the player's hand where it is, then play the dealer out under the usual rules.
   * The player keeps the hand they paid for instead of losing the stake to a
   * closed panel.
   */
  private resolveInProgressHand(): void {
    if (!this.roundInProgress) return;
    // Bounded rather than "loop until the phase changes": a deck fault settles
    // the round from inside these steps, and a guard is a cheaper way to
    // guarantee termination than detecting progress after every call.
    for (let step = 0; step < OPENING_DEAL_CARDS + 1 && this.phase === 'dealing'; step++) {
      this.beatTimer = 0;
      this.advanceOpeningDeal();
    }
    if (this.phase === 'player_turn') this.enterDealerTurn();
    for (let step = 0; step < MAX_DEALER_RESOLVE_STEPS && this.phase === 'dealer_turn'; step++) {
      this.beatTimer = 0;
      this.advanceDealerTurn();
    }
  }

  /** Return anything still on the felt. Idempotent, so no exit can double-refund. */
  refundPendingBet(player: Player): number {
    if (this.pendingBet.length === 0) return 0;
    const refunded = this.betTotal;
    player.coins += refunded;
    this.pendingBet = [];
    this.emit({ kind: 'bet_cleared', refunded });
    return refunded;
  }

  // ── Betting ───────────────────────────────────────────────────────────────

  addChip(denomination: ChipDenomination, player: Player): void {
    if (this.phase !== 'betting') return;
    if (player.coins < denomination) {
      this.feedback = `You're ${denomination - player.coins} coins short of that chip.`;
      return;
    }
    const ceiling = this.effectiveMaximum(player);
    if (this.betTotal + denomination > ceiling) {
      this.feedback = `Table maximum is ${this.tableMaximum}.`;
      return;
    }
    // Coins move the instant a chip leaves the tray — the tray and the felt are
    // the same money, so there is no separate balance that could drift.
    player.coins -= denomination;
    this.pendingBet.push(denomination);
    this.feedback = null;
    this.emit({ kind: 'chip_added', denomination });
  }

  /** Take the top chip back off the stack. */
  removeTopChip(player: Player): void {
    if (this.phase !== 'betting') return;
    const chip = this.pendingBet.pop();
    if (chip === undefined) return;
    player.coins += chip;
    this.feedback = null;
    this.emit({ kind: 'chip_removed', denomination: chip });
  }

  clearBet(player: Player): void {
    if (this.phase !== 'betting') return;
    this.refundPendingBet(player);
    this.feedback = null;
  }

  /** Re-stack the previous hand's chips, dropping any the player can no longer afford. */
  repeatLastBet(player: Player): void {
    if (this.phase !== 'betting') return;
    this.refundPendingBet(player);
    for (const chip of this.lastBet) {
      if (player.coins < chip) break;
      if (this.betTotal + chip > this.effectiveMaximum(player)) break;
      player.coins -= chip;
      this.pendingBet.push(chip);
      this.emit({ kind: 'chip_added', denomination: chip });
    }
    this.feedback = null;
  }

  // ── The round ─────────────────────────────────────────────────────────────

  deal(): void {
    if (this.phase !== 'betting') return;
    const total = this.betTotal;
    if (total < TABLE_MINIMUM) {
      this.feedback = `House minimum is ${TABLE_MINIMUM}.`;
      return;
    }
    // The coins left the tray as each chip landed, so this deducts nothing — it
    // locks the stake. Wagers count here and never on `addChip`: a chip that can
    // still be taken back is not a wager, and counting it would let a player
    // stack and clear their way to the free escort without playing a hand.
    this.stake = total;
    this.lastBet = [...this.pendingBet];
    this.pendingBet = [];
    this.coinsWagered += total;
    this.doubled = false;
    this.outcome = null;
    this.playerHand = [];
    this.dealerHand = [];
    this.holeCardRevealed = false;
    this.dealerDrawsThisRound = true;
    this.cardsDealtThisOpening = 0;
    this.beatTimer = DEAL_FIRST_CARD_DELAY_MS;
    this.feedback = null;
    this.phase = 'dealing';
    this.emit({ kind: 'opening_deal_started' });
  }

  hit(): void {
    if (this.phase !== 'player_turn') return;
    // A move the player actually made supersedes whatever the last refusal said.
    this.feedback = null;
    if (!this.dealToPlayer()) return;
    if (isBust(this.playerHand)) {
      this.dealerDrawsThisRound = false;
      this.enterDealerTurn();
      return;
    }
    if (handValue(this.playerHand).total === BLACKJACK_TOTAL) {
      // Twenty-one is not a bust but there is nothing left to draw for; going
      // straight to the dealer saves a click the player would always make.
      this.stand();
    }
  }

  stand(): void {
    if (this.phase !== 'player_turn') return;
    this.feedback = null;
    this.enterDealerTurn();
  }

  canDoubleDown(player: Player): boolean {
    return (
      this.phase === 'player_turn' &&
      this.playerHand.length === 2 &&
      !this.doubled &&
      player.coins >= this.stake
    );
  }

  doubleDown(player: Player): void {
    if (this.phase !== 'player_turn') return;
    if (!this.canDoubleDown(player)) {
      this.feedback = `Doubling costs another ${this.stake} coins.`;
      return;
    }
    player.coins -= this.stake;
    this.coinsWagered += this.stake;
    this.stake *= 2;
    this.doubled = true;
    this.feedback = null;
    if (!this.dealToPlayer()) return;
    // Exactly one more card, then the hand is over either way.
    this.dealerDrawsThisRound = !isBust(this.playerHand);
    this.enterDealerTurn();
  }

  /** Start the next hand, or show the turn-away screen if the tray is empty. */
  nextHand(player: Player): void {
    if (this.phase !== 'settled') return;
    this.outcome = null;
    this.playerHand = [];
    this.dealerHand = [];
    this.holeCardRevealed = false;
    this.stake = 0;
    this.doubled = false;
    this.feedback = null;
    this.phase = player.coins < TABLE_MINIMUM ? 'turned_away' : 'betting';
  }

  // ── Frame-driven beats ────────────────────────────────────────────────────

  update(dtMs: number): void {
    if (this.phase !== 'dealing' && this.phase !== 'dealer_turn') return;
    this.beatTimer -= dtMs;
    if (this.beatTimer > 0) return;
    if (this.phase === 'dealing') this.advanceOpeningDeal();
    else this.advanceDealerTurn();
  }

  private advanceOpeningDeal(): void {
    if (this.cardsDealtThisOpening < OPENING_DEAL_CARDS) {
      const toPlayer = this.cardsDealtThisOpening % 2 === 0;
      const dealt = toPlayer ? this.dealToPlayer() : this.dealToDealer();
      if (!dealt) return;
      this.cardsDealtThisOpening++;
      this.beatTimer = DEAL_STAGGER_MS;
      return;
    }
    if (isNaturalBlackjack(this.playerHand)) {
      // Nothing left to decide: the dealer only needs to check for a natural of
      // their own, which is a push rather than a 3:2 win.
      this.dealerDrawsThisRound = false;
      this.enterDealerTurn();
      return;
    }
    if (this.dealerPeeksNatural()) {
      // The house peeks on a ten or an ace, exactly as a real table does. Without
      // it the player can be invited to double into a hand that was already lost
      // before they acted, and lose twice the stake for it.
      this.dealerDrawsThisRound = false;
      this.enterDealerTurn();
      return;
    }
    this.phase = 'player_turn';
  }

  /**
   * The up card is worth checking under, and the hole card completes a natural.
   * Only reachable once the opening deal has finished, so the up card is there.
   */
  private dealerPeeksNatural(): boolean {
    const upCard = this.dealerHand[0];
    if (upCard.rank !== 'A' && !isTenValue(upCard)) return false;
    return isNaturalBlackjack(this.dealerHand);
  }

  private advanceDealerTurn(): void {
    if (!this.holeCardRevealed) {
      this.holeCardRevealed = true;
      this.emit({ kind: 'hole_revealed' });
      this.beatTimer = this.dealerDrawsThisRound ? DEALER_DRAW_STAGGER_MS : SETTLE_DELAY_MS;
      return;
    }
    if (this.dealerDrawsThisRound && dealerShouldHit(this.dealerHand)) {
      if (!this.dealToDealer()) return;
      this.beatTimer = DEALER_DRAW_STAGGER_MS;
      return;
    }
    this.settle();
  }

  private enterDealerTurn(): void {
    this.phase = 'dealer_turn';
    this.beatTimer = HOLE_REVEAL_DELAY_MS;
  }

  private dealToPlayer(): boolean {
    const card = this.deck.draw();
    if (card === null) return this.faultDeck();
    this.playerHand.push(card);
    this.emit({ kind: 'card_dealt', to: 'player', index: this.playerHand.length - 1 });
    return true;
  }

  private dealToDealer(): boolean {
    const card = this.deck.draw();
    if (card === null) return this.faultDeck();
    this.dealerHand.push(card);
    this.emit({ kind: 'card_dealt', to: 'dealer', index: this.dealerHand.length - 1 });
    return true;
  }

  /**
   * Unreachable in practice — the reshuffle threshold leaves far more cards than
   * a round can consume — but the type says `Card | null`, so this makes the
   * impossible case safe rather than asserting it away.
   */
  private faultDeck(): boolean {
    this.feedback = 'Deuce pauses. "Bad shoe — that one\'s on the house." Bet refunded.';
    // The stake is already off the tray, so the abort owes it straight back.
    this.pendingPayout += this.stake;
    this.deck.shuffle();
    this.emit({ kind: 'reshuffled' });
    this.playerHand = [];
    this.dealerHand = [];
    this.holeCardRevealed = false;
    this.outcome = null;
    this.phase = 'settled';
    this.stake = 0;
    return false;
  }

  /**
   * Coins the house owes but has not yet handed over, because the model never
   * touches `player` outside an action the player took. The host collects it as
   * the payout animation runs.
   */
  private pendingPayout = 0;

  private settle(): void {
    const outcome = settleRound(this.playerHand, this.dealerHand);
    this.outcome = outcome;
    this.phase = 'settled';
    this.handsPlayed++;
    const payout = payoutFor(outcome, this.stake);
    this.pendingPayout += payout;
    if (outcome.kind === 'player_blackjack' && this.stake >= TABLE_MAXIMUM) {
      this.jackpotPending = true;
    }
    this.emit({ kind: 'settled', outcome, payout, stake: this.stake });
    // Reshuffle only at round end, once the hand's cards are already spent.
    if (this.deck.needsReshuffle) {
      this.deck.shuffle();
      this.emit({ kind: 'reshuffled' });
    }
  }

  /**
   * Credit whatever the house owes and clear it, so a payout lands exactly once
   * no matter how many frames pass before the host collects it.
   */
  collectPayout(player: Player): number {
    const owed = this.pendingPayout;
    this.pendingPayout = 0;
    player.coins += owed;
    return owed;
  }
}
