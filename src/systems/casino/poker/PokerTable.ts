/**
 * The Texas Hold'em table's whole state machine: seats, button, blinds, the deck
 * for this hand, the board, the pots and the event queue.
 *
 * Zero rendering, canvas, UI or audio imports, deliberately — the presentation
 * host reads this model and animates the events it drains, which is what keeps
 * the money and card invariants checkable headless.
 *
 * The table is frame-driven like `BlackjackTable`: `update(dtMs)` advances
 * dealing, NPC think time and reveals, so each beat occupies real time for the
 * host to fill. NPC choices come from an injected `PokerSeatBrain`, and seat
 * churn between hands from an optional `PokerSeatManager`, so the table owns the
 * rules and nothing about how a regular plays.
 */

import { Deck, LUCKY_RANK, type Card } from '../Deck';
import { NEVER_LUCKY, type LuckCheck } from '../../../core/state/GodMode';
import {
  BettingRound,
  isLegal,
  passiveAction,
  type AppliedAction,
  type BettingSeat,
  type LegalActions,
  type PokerAction,
  type PokerActionKind,
} from './bettingRound';
import { evaluateBest, handRank, type EvaluatedHand } from './handEvaluator';
import type {
  BoardStreet,
  PokerEvent,
  ShownCardIndices,
  Street,
  TellEventCue,
} from './pokerEvents';
import { POKER_STAKES, type PokerStakes, type PokerTierId } from './pokerStakes';
import { awardPots, buildPots, clockwiseFromButton, type PotResult } from './pots';

export const POKER_SEAT_COUNT = 6;
export const PLAYER_SEAT = 0;
export const PLAYER_OCCUPANT_ID = 'player';
export const NPC_SEAT_COUNT = POKER_SEAT_COUNT - 1;
export const HOLE_CARD_COUNT = 2;
/** The fewest seats a hand is dealt to: the player and one regular. */
export const HEADS_UP_SEATS = 2;
const NO_SEAT = -1;
export const FLOP_CARD_COUNT = 3;

// Beat timings. Every delay is scaled by the speed factor; the player's own turn
// has no clock at all.
const FIRST_HAND_DELAY_MS = 500;
const BETWEEN_HANDS_MS = 1400;
const SHUFFLE_MS = 600;
const BLINDS_MS = 350;
const HOLE_CARD_STAGGER_MS = 120;
const ACTION_GAP_MS = 350;
const STREET_SWEEP_MS = 450;
const BURN_MS = 250;
const FLOP_REVEAL_MS = 700;
const SINGLE_CARD_REVEAL_MS = 650;
/** Time to turn every live hand face up before an all-in board runs out. */
const RUNOUT_REVEAL_MS = 900;
/** The held beat after each all-in run-out card, which is where the drama lives. */
const RUNOUT_HOLD_MS = 1200;
const SHOWDOWN_REVEAL_MS = 750;
const AWARD_MS = 1300;
const PASSIVE_THINK_MS = 700;

/** The Fast toggle halves every NPC and dealing delay. */
const FAST_SPEED_FACTOR = 0.5;
/** "Skip to next hand" after the player folds plays the rest at four times speed. */
const SKIP_SPEED_FACTOR = 0.25;

/** Guards a huge `dtMs` (a tab coming back) from spinning through a whole hand in one frame. */
const MAX_STEPS_PER_UPDATE = 64;
/**
 * Ceiling on the beats it takes to finish a hand off-screen: shuffle, blinds,
 * twelve hole cards, four betting rounds of a few laps each, three burns and
 * streets, six reveals and the award, with generous headroom.
 */
const MAX_RESOLVE_STEPS = 600;

export type PokerPhase =
  | 'between_hands'
  | 'shuffling'
  | 'posting_blinds'
  | 'dealing_hole'
  | 'preflop'
  | 'dealing_flop'
  | 'flop'
  | 'dealing_turn'
  | 'turn'
  | 'dealing_river'
  | 'river'
  | 'showdown'
  | 'awarding'
  | 'player_busted'
  /** The player has cashed out; the table no longer runs. */
  | 'left'
  /**
   * No regular is left — each busted out for good or walked out with their
   * chips — so the game is over until the player starts a new one.
   */
  | 'game_over';

const BETTING_PHASE_STREETS: Partial<Record<PokerPhase, Street>> = {
  preflop: 'preflop',
  flop: 'flop',
  turn: 'turn',
  river: 'river',
};

const DEALING_PHASE_STREETS: Partial<Record<PokerPhase, BoardStreet>> = {
  dealing_flop: 'flop',
  dealing_turn: 'turn',
  dealing_river: 'river',
};

const DEALING_PHASE_FOR: Record<BoardStreet, PokerPhase> = {
  flop: 'dealing_flop',
  turn: 'dealing_turn',
  river: 'dealing_river',
};

const NEXT_BOARD_STREET: Record<Street, BoardStreet | null> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
  river: null,
};

/** Phases between the blinds going in and the pot being awarded: the player is "in the hand". */
const LIVE_PHASES: ReadonlySet<PokerPhase> = new Set<PokerPhase>([
  'posting_blinds',
  'dealing_hole',
  'preflop',
  'dealing_flop',
  'flop',
  'dealing_turn',
  'turn',
  'dealing_river',
  'river',
  'showdown',
]);

const RESTING_PHASES: ReadonlySet<PokerPhase> = new Set<PokerPhase>([
  'between_hands',
  'player_busted',
  'left',
  'game_over',
]);

export interface PokerSeat extends BettingSeat {
  readonly index: number;
  readonly isPlayer: boolean;
  /** Who sits here: a regular's id, `PLAYER_OCCUPANT_ID`, or `null` for an empty chair. */
  occupantId: string | null;
  holeCards: Card[];
  /** Dealt into the current (or last) hand. */
  inHand: boolean;
  /** Hole cards visible to the whole table (showdown, run-out). */
  faceUp: boolean;
  lastAction: PokerActionKind | null;
}

/** One voluntary action, as the table history records it. Blinds are not actions. */
export interface HandActionRecord {
  readonly seat: number;
  readonly street: Street;
  readonly kind: PokerActionKind;
  readonly chipsAdded: number;
  readonly streetTotal: number;
  readonly aggressive: boolean;
}

/** A seat as a strategy may see it: everything public, no hole cards. */
export interface SeatView {
  readonly seat: number;
  readonly occupantId: string | null;
  readonly isPlayer: boolean;
  readonly stack: number;
  readonly streetBet: number;
  readonly contributed: number;
  readonly inHand: boolean;
  readonly folded: boolean;
  readonly allIn: boolean;
  /**
   * Clockwise distance from the button counting only seats dealt in: 0 is the
   * button. Three or more handed, 1 and 2 are the blinds; heads-up the button
   * posts the small blind and 1 is the big blind. Meaningless for an empty chair.
   */
  readonly positionFromButton: number;
}

/** Everything a strategy needs to choose an action for the seat to act. */
export interface PokerDecisionContext {
  readonly seat: number;
  readonly occupantId: string;
  readonly tier: PokerTierId;
  readonly stakes: PokerStakes;
  readonly handNumber: number;
  readonly street: Street;
  readonly holeCards: ReadonlyArray<Card>;
  readonly board: ReadonlyArray<Card>;
  /** Every chip committed this hand, current street bets included. */
  readonly pot: number;
  readonly toCall: number;
  readonly legal: LegalActions;
  /** The smallest increment a raise must add right now. */
  readonly minRaiseIncrement: number;
  readonly buttonSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  /** This seat's {@link SeatView.positionFromButton}. */
  readonly positionFromButton: number;
  readonly seats: ReadonlyArray<SeatView>;
  /** Seats other than this one still holding cards. */
  readonly liveOpponents: number;
  /** Bets and raises made on this street so far. */
  readonly aggressionThisStreet: number;
  readonly history: ReadonlyArray<HandActionRecord>;
  /** `history` split by seat, indexed by seat. */
  readonly actionsBySeat: ReadonlyArray<ReadonlyArray<HandActionRecord>>;
}

/** What a strategy hands back: an action, and how long the seat appears to think about it. */
export interface PokerDecision {
  readonly action: PokerAction;
  readonly thinkMs: number;
  /** Tells the seat shows while it thinks; each becomes a `tell` event as the turn begins. */
  readonly cues?: ReadonlyArray<TellEventCue>;
}

/** Events a brain may add in answer to what it observes; the table emits nothing else for it. */
export type PokerBrainEvent = Extract<PokerEvent, { readonly kind: 'banter' | 'tell' }>;

export interface ShowdownContext {
  readonly seat: number;
  readonly occupantId: string;
  readonly handNumber: number;
  readonly holeCards: ReadonlyArray<Card>;
  readonly board: ReadonlyArray<Card>;
  readonly history: ReadonlyArray<HandActionRecord>;
}

/**
 * How NPC seats play. The table asks once when a seat's turn begins (never per
 * frame), waits out `thinkMs`, then applies the action; an illegal answer is
 * counted and replaced by the cheapest passive action.
 */
export interface PokerSeatBrain {
  decide(context: PokerDecisionContext): PokerDecision;
  /** Whether a seat that lost at showdown turns its cards over instead of mucking. */
  showsLosingHand(context: ShowdownContext): boolean;
  /** Which hole cards an uncontested winner chooses to flip, usually none. */
  uncontestedShow(context: ShowdownContext): ShownCardIndices;
  /**
   * Sees every event the moment the table emits it, so a brain can keep moods
   * and reads current, and answers with any banter or tells to queue right
   * after it. Answers are not observed again.
   */
  observe?(event: PokerEvent, table: PokerTable): ReadonlyArray<PokerBrainEvent>;
}

/**
 * Seat churn between hands: busts, rebuys, hit-and-runs and new arrivals. It runs
 * before the button moves and works through `rebuySeat`, `vacateSeat` and
 * `seatOccupant`; every NPC seat must hold an occupant with chips afterwards.
 */
export interface PokerSeatManager {
  betweenHands(table: PokerTable): void;
}

/** Broken table state that must never ship: thrown so the verify script turns red. */
export class PokerTableInvariantError extends Error {}

/** The stand-in strategy: always checks or calls, never shows a loser. */
export const PASSIVE_BRAIN: PokerSeatBrain = {
  decide: (context) => ({ action: passiveAction(context.legal), thinkMs: PASSIVE_THINK_MS }),
  showsLosingHand: () => false,
  uncontestedShow: () => [],
};

export interface NpcSeating {
  readonly occupantId: string;
  readonly stack: number;
}

export interface PokerTableOptions {
  readonly tier: PokerTierId;
  readonly brain: PokerSeatBrain;
  /** One entry per NPC seat, seats 1–5 in order. */
  readonly npcs: ReadonlyArray<NpcSeating>;
  readonly seatManager?: PokerSeatManager;
  /** Shuffles and the starting button. Play passes nothing; verify scripts pass a seeded stream. */
  readonly random?: () => number;
  /** Defaults to the tier's buy-in. */
  readonly playerStack?: number;
  readonly fast?: boolean;
  /** Read as the player's first hole card is dealt: while true, the player's hole cards hold an Ace. */
  readonly isLucky?: LuckCheck;
}

interface ShowdownStep {
  readonly seat: number;
  readonly show: boolean;
}

export class PokerTable {
  readonly tier: PokerTierId;
  readonly stakes: PokerStakes;

  private readonly brain: PokerSeatBrain;
  private readonly seatManager: PokerSeatManager | null;
  private readonly random: () => number;
  private readonly isLucky: LuckCheck;
  private readonly seatState: PokerSeat[];
  private readonly events: PokerEvent[] = [];

  private phaseValue: PokerPhase = 'between_hands';
  private button: number;
  private smallBlind = NO_SEAT;
  /** Seat churn already ran when the last hand ended, for a player who busted. */
  private churnedForNextHand = false;
  /** The player is walking away: the hand finishes, but nobody rebuys or leaves for a table that is closing. */
  private leaving = false;
  private bigBlind = NO_SEAT;
  private deck: Deck | null = null;
  private boardCards: Card[] = [];
  private burned: Card[] = [];
  private handHistory: HandActionRecord[] = [];
  private round: BettingRound | null = null;
  private street: Street = 'preflop';
  private holeCardsDealt = 0;
  private dealStage: 'burn' | 'cards' | 'open_betting' = 'burn';
  private runout = false;
  private riverAggressor: number | null = null;
  private showdownQueue: ShowdownStep[] = [];
  private pendingDecision: { readonly seat: number; readonly action: PokerAction } | null = null;
  private awaitingPlayerValue = false;
  private beatTimer = FIRST_HAND_DELAY_MS;
  private fastValue: boolean;
  private skipping = false;
  private handNumberValue = 0;

  /** Turn a losing hand face up at showdown instead of mucking it. */
  showCards = false;
  /** NPC answers that were not legal at the time; must stay 0. */
  illegalNpcActions = 0;
  /** Chips the player has committed to pots this sitting, net of returned uncalled bets. */
  playerCoinsCommitted = 0;

  constructor(options: PokerTableOptions) {
    if (options.npcs.length !== NPC_SEAT_COUNT) {
      throw new PokerTableInvariantError(
        `a table seats ${NPC_SEAT_COUNT} NPCs, got ${options.npcs.length}`,
      );
    }
    this.tier = options.tier;
    this.stakes = POKER_STAKES[options.tier];
    this.brain = options.brain;
    this.seatManager = options.seatManager ?? null;
    this.random = options.random ?? Math.random;
    this.isLucky = options.isLucky ?? NEVER_LUCKY;
    this.fastValue = options.fast ?? false;
    const playerStack = options.playerStack ?? this.stakes.buyIn;
    this.seatState = Array.from({ length: POKER_SEAT_COUNT }, (_, index) => {
      const npc = index === PLAYER_SEAT ? null : options.npcs[index - 1];
      return {
        index,
        isPlayer: index === PLAYER_SEAT,
        occupantId: npc === null ? PLAYER_OCCUPANT_ID : npc.occupantId,
        stack: npc === null ? playerStack : npc.stack,
        streetBet: 0,
        contributed: 0,
        folded: false,
        allIn: false,
        holeCards: [],
        inHand: false,
        faceUp: false,
        lastAction: null,
      };
    });
    // Seeded so the first hand's button move lands on a random seat.
    const firstButton = Math.floor(this.random() * POKER_SEAT_COUNT);
    this.button = (firstButton + POKER_SEAT_COUNT - 1) % POKER_SEAT_COUNT;
  }

  // ── Reading the table ─────────────────────────────────────────────────────

  get phase(): PokerPhase {
    return this.phaseValue;
  }

  get seats(): ReadonlyArray<Readonly<PokerSeat>> {
    return this.seatState;
  }

  get handNumber(): number {
    return this.handNumberValue;
  }

  get buttonSeat(): number {
    return this.button;
  }

  /** The seat posting the small blind this hand; -1 before the first deal. */
  get smallBlindSeat(): number {
    return this.smallBlind;
  }

  /** The seat posting the big blind this hand; -1 before the first deal. */
  get bigBlindSeat(): number {
    return this.bigBlind;
  }

  /** Seats dealt into the current (or last) hand. */
  get seatsDealt(): number {
    return this.seatState.filter((seat) => seat.inHand).length;
  }

  get board(): ReadonlyArray<Card> {
    return this.boardCards;
  }

  /** Cards burned this hand. Never shown; exposed so the deck invariant can be checked. */
  get burnedCards(): ReadonlyArray<Card> {
    return this.burned;
  }

  /** The deck dealing this hand; a new object every hand. */
  get currentDeck(): Deck | null {
    return this.deck;
  }

  get history(): ReadonlyArray<HandActionRecord> {
    return this.handHistory;
  }

  /** Every chip committed this hand, current street bets included. */
  get pot(): number {
    return this.seatState.reduce((sum, seat) => sum + seat.contributed, 0);
  }

  get fast(): boolean {
    return this.fastValue;
  }

  setFast(fast: boolean): void {
    this.fastValue = fast;
  }

  setShowCards(show: boolean): void {
    this.showCards = show;
  }

  get awaitingPlayer(): boolean {
    return this.awaitingPlayerValue;
  }

  /** The seat whose turn it is, or `null` while nobody is deciding. */
  get actingSeat(): number | null {
    if (this.awaitingPlayerValue) return PLAYER_SEAT;
    return this.pendingDecision?.seat ?? null;
  }

  get handInProgress(): boolean {
    return !RESTING_PHASES.has(this.phaseValue);
  }

  get isSeated(): boolean {
    return this.phaseValue !== 'left';
  }

  /** True from the blinds going in until the pot is awarded, unless the player folded. */
  isPlayerLive(): boolean {
    const player = this.seatState[PLAYER_SEAT];
    return player.inHand && !player.folded && LIVE_PHASES.has(this.phaseValue);
  }

  /** Everything the player has put into this hand's pot, blinds included. */
  get playerContribution(): number {
    return this.handInProgress ? this.seatState[PLAYER_SEAT].contributed : 0;
  }

  get playerStack(): number {
    return this.seatState[PLAYER_SEAT].stack;
  }

  playerLegalActions(): LegalActions | null {
    if (!this.awaitingPlayerValue || this.round === null) return null;
    return this.round.legalActions(PLAYER_SEAT);
  }

  /** The player's best hand with the cards out so far, for the "Your hand" line. */
  playerBestHand(): EvaluatedHand | null {
    const player = this.seatState[PLAYER_SEAT];
    if (player.holeCards.length === 0) return null;
    return evaluateBest([...player.holeCards, ...this.boardCards]);
  }

  drainEvents(): ReadonlyArray<PokerEvent> {
    const drained = [...this.events];
    this.events.length = 0;
    return drained;
  }

  private emit(event: PokerEvent): void {
    this.events.push(event);
    const answers = this.brain.observe?.(event, this);
    if (answers !== undefined) this.events.push(...answers);
  }

  // ── Player controls ───────────────────────────────────────────────────────

  /** Acts for the player. Returns why the action was refused, or `null` when it landed. */
  playerAct(action: PokerAction): string | null {
    const round = this.round;
    if (!this.awaitingPlayerValue || round === null) return "It isn't your turn.";
    const legal = round.legalActions(PLAYER_SEAT);
    if (!isLegal(action, legal)) return "That bet isn't allowed right now.";
    this.awaitingPlayerValue = false;
    this.landAction(round.apply(PLAYER_SEAT, action));
    this.beatTimer = 0;
    this.wait(ACTION_GAP_MS);
    return null;
  }

  /** Once the player is out of the hand, play the rest at four times speed. */
  skipToNextHand(): boolean {
    if (!this.handInProgress || this.isPlayerLive()) return false;
    this.skipping = true;
    return true;
  }

  /** Back in at the tier's buy-in after busting. The host takes the coins from the purse. */
  rebuy(): boolean {
    if (this.phaseValue !== 'player_busted') return false;
    const amount = this.stakes.buyIn;
    this.seatState[PLAYER_SEAT].stack = amount;
    this.emit({ kind: 'player_rebuy', amount });
    this.phaseValue = 'between_hands';
    this.beatTimer = 0;
    this.wait(BETWEEN_HANDS_MS);
    return true;
  }

  /**
   * Stands the player up for good. A live hand is folded first — every chip the
   * player put in stays in the pot — and the rest of the hand is played out
   * instantly with its events discarded, so nothing fires into a closed panel.
   * Returns the stack the player walks away with.
   */
  forfeitAndLeave(): number {
    if (this.phaseValue === 'left') return 0;
    this.leaving = true;
    const player = this.seatState[PLAYER_SEAT];
    if (this.isPlayerLive()) {
      player.folded = true;
      this.round?.forceFold(PLAYER_SEAT);
      player.lastAction = 'fold';
      this.awaitingPlayerValue = false;
      // An NPC answer computed before the fold may no longer be its turn.
      this.pendingDecision = null;
      this.resolveHandInstantly();
    } else if (this.phaseValue !== 'shuffling') {
      // Nothing of the player's is at stake, but the hand still finishes so the
      // table is left consistent rather than frozen mid-deal.
      this.resolveHandInstantly();
    }
    const remaining = player.stack;
    player.stack = 0;
    player.occupantId = null;
    this.phaseValue = 'left';
    this.events.length = 0;
    return remaining;
  }

  private resolveHandInstantly(): void {
    for (let step = 0; step < MAX_RESOLVE_STEPS && this.handInProgress; step++) {
      this.beatTimer = 0;
      this.advance();
    }
    if (this.handInProgress) {
      throw new PokerTableInvariantError(`hand ${this.handNumberValue} did not resolve`);
    }
  }

  // ── Seat churn (between hands only) ───────────────────────────────────────

  private churnableSeat(seat: number): PokerSeat | null {
    const outOfRange = !Number.isInteger(seat) || seat < 0 || seat >= POKER_SEAT_COUNT;
    if (this.handInProgress || outOfRange || seat === PLAYER_SEAT) return null;
    return this.seatState[seat];
  }

  /** Tops an NPC seat up by `amount`. */
  rebuySeat(seat: number, amount: number): boolean {
    const target = this.churnableSeat(seat);
    if (target === null || amount <= 0) return false;
    if (target.occupantId === null) return false;
    target.stack += amount;
    this.emit({ kind: 'seat_rebuy', seat, amount });
    return true;
  }

  /** The regular in `seat` stands up; the chair is empty until `seatOccupant` fills it. */
  vacateSeat(seat: number): boolean {
    const target = this.churnableSeat(seat);
    const occupantId = target?.occupantId ?? null;
    if (target === null || occupantId === null) return false;
    const stack = target.stack;
    target.occupantId = null;
    target.stack = 0;
    this.emit({ kind: 'seat_vacated', seat, occupantId, stack });
    return true;
  }

  /** A new regular sits in an empty `seat` with `stack`; dealt in from the next hand, no dead blind. */
  seatOccupant(seat: number, occupantId: string, stack: number): boolean {
    const target = this.churnableSeat(seat);
    const emptyChair = target !== null && target.occupantId === null;
    if (!emptyChair || stack <= 0) return false;
    target.occupantId = occupantId;
    target.stack = stack;
    this.emit({ kind: 'seat_replaced', seat, occupantId, stack });
    return true;
  }

  // ── Frame-driven beats ────────────────────────────────────────────────────

  update(dtMs: number): void {
    if (!this.ticks()) return;
    this.beatTimer -= dtMs;
    for (let step = 0; step < MAX_STEPS_PER_UPDATE && this.beatTimer <= 0 && this.ticks(); step++) {
      this.advance();
    }
  }

  /** False while the player holds the action (no clock) or the table has stopped. */
  private ticks(): boolean {
    if (this.awaitingPlayerValue) return false;
    return (
      this.phaseValue !== 'player_busted' &&
      this.phaseValue !== 'left' &&
      this.phaseValue !== 'game_over'
    );
  }

  private get speedFactor(): number {
    if (this.skipping) return SKIP_SPEED_FACTOR;
    return this.fastValue ? FAST_SPEED_FACTOR : 1;
  }

  private wait(ms: number): void {
    this.beatTimer += ms * this.speedFactor;
  }

  private advance(): void {
    const bettingStreet = BETTING_PHASE_STREETS[this.phaseValue];
    if (bettingStreet !== undefined) {
      this.stepBetting();
      return;
    }
    const dealingStreet = DEALING_PHASE_STREETS[this.phaseValue];
    if (dealingStreet !== undefined) {
      this.stepDealStreet(dealingStreet);
      return;
    }
    switch (this.phaseValue) {
      case 'between_hands':
        this.startHand();
        return;
      case 'shuffling':
        this.postBlinds();
        return;
      case 'posting_blinds':
        this.phaseValue = 'dealing_hole';
        this.holeCardsDealt = 0;
        this.dealHoleCard();
        return;
      case 'dealing_hole':
        this.dealHoleCard();
        return;
      case 'showdown':
        this.stepShowdown();
        return;
      case 'awarding':
        this.finishHand();
        return;
      case 'preflop':
      case 'flop':
      case 'turn':
      case 'river':
      case 'dealing_flop':
      case 'dealing_turn':
      case 'dealing_river':
      case 'player_busted':
      case 'left':
      case 'game_over':
        return;
    }
  }

  // ── The hand ──────────────────────────────────────────────────────────────

  private startHand(): void {
    this.handNumberValue++;
    if (!this.churnedForNextHand) this.churnSeats();
    this.churnedForNextHand = false;
    const dealtIn = this.seatState.map((seat) => seat.occupantId !== null && seat.stack > 0);
    if (this.regularsReady() === 0) {
      // The hand that would have been dealt never was, so its number is not spent.
      this.handNumberValue--;
      this.enterGameOver();
      return;
    }
    this.assertEnoughToDeal(dealtIn);

    this.seatState.forEach((seat, index) => {
      const playing = dealtIn[index];
      seat.holeCards = [];
      seat.inHand = playing;
      // An empty chair counts as folded, so no betting round ever waits on it.
      seat.folded = !playing;
      seat.allIn = false;
      seat.streetBet = 0;
      seat.contributed = 0;
      seat.faceUp = false;
      seat.lastAction = null;
    });
    this.button = this.nextDealtSeat(this.button);
    const headsUp = this.seatsDealt === HEADS_UP_SEATS;
    // Heads-up the button is the small blind: it acts first before the flop
    // and last after it, which is how the betting order below falls out.
    this.smallBlind = headsUp ? this.button : this.nextDealtSeat(this.button);
    this.bigBlind = this.nextDealtSeat(this.smallBlind);
    this.emit({ kind: 'button_moved', seat: this.button });

    this.deck = Deck.fresh(this.random);
    this.boardCards = [];
    this.burned = [];
    this.handHistory = [];
    this.round = null;
    this.street = 'preflop';
    this.runout = false;
    this.riverAggressor = null;
    this.showdownQueue = [];
    this.pendingDecision = null;
    this.phaseValue = 'shuffling';
    this.emit({
      kind: 'shuffled',
      handNumber: this.handNumberValue,
      stacks: this.seatState.map((seat) => seat.stack),
      cardsRemaining: this.deck.remaining,
      dealt: this.seatState.map((seat) => seat.inHand),
    });
    this.wait(SHUFFLE_MS);
  }

  /** Busts, rebuys and departures, between hands. */
  private churnSeats(): void {
    if (this.seatManager === null) this.rebuyBustedNpcs();
    else this.seatManager.betweenHands(this);
  }

  /** Regulars still seated with chips to play. */
  private regularsReady(): number {
    return this.seatState.filter(
      (seat) => !seat.isPlayer && seat.occupantId !== null && seat.stack > 0,
    ).length;
  }

  private enterGameOver(): void {
    this.skipping = false;
    this.phaseValue = 'game_over';
    this.emit({ kind: 'game_over' });
  }

  /** Without a seat manager a busted regular simply buys back in, so the table stays full. */
  private rebuyBustedNpcs(): void {
    for (const seat of this.seatState) {
      if (seat.isPlayer || seat.occupantId === null || seat.stack > 0) continue;
      seat.stack = this.stakes.buyIn;
      this.emit({ kind: 'seat_rebuy', seat: seat.index, amount: this.stakes.buyIn });
    }
  }

  /** A hand needs the player and at least one regular with chips; anything less is a broken table. */
  private assertEnoughToDeal(dealtIn: ReadonlyArray<boolean>): void {
    const ready = dealtIn.filter(Boolean).length;
    if (!dealtIn[PLAYER_SEAT] || ready < HEADS_UP_SEATS) {
      throw new PokerTableInvariantError(
        `hand ${this.handNumberValue} would deal ${ready} seats${dealtIn[PLAYER_SEAT] ? '' : ' without the player'}`,
      );
    }
  }

  /** The first seat clockwise after `from` that is dealt into this hand. */
  private nextDealtSeat(from: number): number {
    for (let offset = 1; offset <= POKER_SEAT_COUNT; offset++) {
      const seat = (from + offset) % POKER_SEAT_COUNT;
      if (this.seatState[seat].inHand) return seat;
    }
    return from;
  }

  private postBlinds(): void {
    this.postBlind(this.smallBlindSeat, 'small', this.stakes.smallBlind);
    this.postBlind(this.bigBlindSeat, 'big', this.stakes.bigBlind);
    this.phaseValue = 'posting_blinds';
    this.wait(BLINDS_MS);
  }

  private postBlind(seatIndex: number, blind: 'small' | 'big', size: number): void {
    const seat = this.seatState[seatIndex];
    const amount = Math.min(size, seat.stack);
    seat.stack -= amount;
    seat.streetBet += amount;
    seat.contributed += amount;
    if (seat.stack === 0) seat.allIn = true;
    if (seat.isPlayer) this.playerCoinsCommitted += amount;
    this.emit({ kind: 'blind_posted', seat: seatIndex, blind, amount });
  }

  private draw(): Card {
    const card = this.deck?.draw() ?? null;
    // A hand draws at most 23 of 52 cards even six-handed, so this cannot happen
    // unless the deck itself is broken.
    if (card === null) throw new PokerTableInvariantError('the deck ran out mid-hand');
    return card;
  }

  /** Two passes clockwise from the small blind over the seats dealt in, one card per beat. */
  private dealHoleCard(): void {
    const order = this.dealOrder();
    const total = order.length * HOLE_CARD_COUNT;
    if (this.holeCardsDealt >= total) {
      this.beginBettingRound('preflop');
      return;
    }
    const pass = Math.floor(this.holeCardsDealt / order.length);
    const seatIndex = order[this.holeCardsDealt % order.length];
    const seat = this.seatState[seatIndex];
    const playerStillOwedLuck =
      seat.isPlayer && this.isLucky() && !seat.holeCards.some((card) => card.rank === LUCKY_RANK);
    if (playerStillOwedLuck) this.deck?.stackNext(LUCKY_RANK);
    seat.holeCards.push(this.draw());
    this.holeCardsDealt++;
    this.emit({ kind: 'hole_dealt', seat: seatIndex, index: pass });
    this.wait(HOLE_CARD_STAGGER_MS);
  }

  /** Seats dealt in, clockwise from the small blind. */
  private dealOrder(): number[] {
    return Array.from(
      { length: POKER_SEAT_COUNT },
      (_, offset) => (this.smallBlind + offset) % POKER_SEAT_COUNT,
    ).filter((seat) => this.seatState[seat].inHand);
  }

  private beginBettingRound(street: Street): void {
    this.street = street;
    this.phaseValue = street;
    const preflop = street === 'preflop';
    this.round = new BettingRound(this.seatState, {
      bigBlind: this.stakes.bigBlind,
      openingBet: preflop ? this.stakes.bigBlind : 0,
      firstToAct: preflop
        ? (this.bigBlindSeat + 1) % POKER_SEAT_COUNT
        : (this.button + 1) % POKER_SEAT_COUNT,
    });
    this.stepBetting();
  }

  private stepBetting(): void {
    const round = this.round;
    if (round === null) return;
    const pending = this.pendingDecision;
    if (pending !== null) {
      this.pendingDecision = null;
      const legal = round.legalActions(pending.seat);
      let action = pending.action;
      if (!isLegal(action, legal)) {
        this.illegalNpcActions++;
        action = passiveAction(legal);
      }
      this.landAction(round.apply(pending.seat, action));
      this.wait(ACTION_GAP_MS);
      return;
    }

    const next = round.nextToAct();
    if (next === null) {
      if (this.street === 'river') this.riverAggressor = round.lastAggressor;
      this.endStreet();
      return;
    }
    if (next === PLAYER_SEAT) {
      this.awaitingPlayerValue = true;
      this.beatTimer = 0;
      this.emit({ kind: 'player_turn', legal: round.legalActions(PLAYER_SEAT) });
      return;
    }
    const decision = this.brain.decide(this.decisionContext(next, round));
    for (const cue of decision.cues ?? []) {
      this.emit({ kind: 'tell', seat: next, cue });
    }
    this.pendingDecision = { seat: next, action: decision.action };
    // A NaN or infinite think time would leave the beat timer unable to expire
    // and freeze the table, so it counts as an instant answer.
    const thinkMs = Number.isFinite(decision.thinkMs) ? Math.max(0, decision.thinkMs) : 0;
    this.wait(thinkMs);
  }

  private landAction(applied: AppliedAction): void {
    const seat = this.seatState[applied.seat];
    seat.lastAction = applied.kind;
    if (seat.isPlayer) this.playerCoinsCommitted += applied.chipsAdded;
    this.handHistory.push({
      seat: applied.seat,
      street: this.street,
      kind: applied.kind,
      chipsAdded: applied.chipsAdded,
      streetTotal: applied.streetTotal,
      aggressive: applied.aggressive,
    });
    this.emit({
      kind: 'action',
      seat: applied.seat,
      action: applied.kind,
      amount: applied.chipsAdded,
      streetTotal: applied.streetTotal,
    });
  }

  private liveSeats(): PokerSeat[] {
    return this.seatState.filter((seat) => seat.inHand && !seat.folded);
  }

  /**
   * A bet nobody matched goes back to whoever made it before the chips are
   * swept — unless that seat folded. The only way the top bettor can be folded
   * is the player walking away with a bet out, and those chips stay in the pot.
   */
  private returnUncalledBet(): void {
    const ordered = [...this.seatState].sort((a, b) => b.streetBet - a.streetBet);
    const top = ordered[0];
    const runnerUp = ordered[1];
    const uncalled = top.streetBet - runnerUp.streetBet;
    if (uncalled <= 0 || top.folded) return;
    top.streetBet -= uncalled;
    top.contributed -= uncalled;
    top.stack += uncalled;
    if (top.stack > 0) top.allIn = false;
    if (top.isPlayer) this.playerCoinsCommitted -= uncalled;
    this.emit({ kind: 'uncalled_returned', seat: top.index, amount: uncalled });
  }

  private endStreet(): void {
    this.returnUncalledBet();
    for (const seat of this.seatState) seat.streetBet = 0;
    this.round = null;
    this.emit({ kind: 'bets_collected', street: this.street, pot: this.pot });

    const live = this.liveSeats();
    if (live.length === 1) {
      this.awardUncontested(live[0]);
      return;
    }
    const nextStreet = NEXT_BOARD_STREET[this.street];
    if (nextStreet === null) {
      this.beginShowdown();
      return;
    }
    const seatsWithChips = live.filter((seat) => !seat.allIn).length;
    if (seatsWithChips < 2 && !this.runout) {
      this.runout = true;
      this.emit({ kind: 'runout_started' });
      for (const seat of live) this.revealSeat(seat);
      this.enterDealing(nextStreet);
      this.wait(RUNOUT_REVEAL_MS);
      return;
    }
    this.enterDealing(nextStreet);
    this.wait(STREET_SWEEP_MS);
  }

  /** Burn, then the street's cards, then the betting opens — each on its own beat. */
  private stepDealStreet(street: BoardStreet): void {
    switch (this.dealStage) {
      case 'burn':
        this.burned.push(this.draw());
        this.dealStage = 'cards';
        this.emit({ kind: 'burn', street });
        this.wait(BURN_MS);
        return;
      case 'cards':
        this.dealBoardCards(street);
        return;
      case 'open_betting':
        this.beginBettingRound(street);
        return;
    }
  }

  private dealBoardCards(street: BoardStreet): void {
    const count = street === 'flop' ? FLOP_CARD_COUNT : 1;
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) cards.push(this.draw());
    this.boardCards.push(...cards);
    this.street = street;
    this.emit({ kind: 'street_dealt', street, cards });

    if (!this.runout) {
      this.dealStage = 'open_betting';
      this.wait(street === 'flop' ? FLOP_REVEAL_MS : SINGLE_CARD_REVEAL_MS);
      return;
    }
    const nextStreet = NEXT_BOARD_STREET[street];
    if (nextStreet === null) this.beginShowdown();
    else this.enterDealing(nextStreet);
    this.wait(RUNOUT_HOLD_MS);
  }

  private enterDealing(street: BoardStreet): void {
    this.phaseValue = DEALING_PHASE_FOR[street];
    this.dealStage = 'burn';
  }

  private revealSeat(seat: PokerSeat): void {
    if (seat.faceUp) return;
    seat.faceUp = true;
    const hand = evaluateBest([...seat.holeCards, ...this.boardCards]);
    this.emit({
      kind: 'showdown_reveal',
      seat: seat.index,
      cards: seat.holeCards,
      label: hand.label,
    });
  }

  private showdownRanks(): Array<number | null> {
    return this.seatState.map((seat) =>
      seat.inHand && !seat.folded ? handRank([...seat.holeCards, ...this.boardCards]) : null,
    );
  }

  private computeAward(): PotResult {
    const pots = buildPots(
      this.seatState.map((seat) => seat.contributed),
      this.seatState.map((seat) => !seat.inHand || seat.folded),
    );
    return awardPots(pots, this.showdownRanks(), this.button, this.stakes.chipUnit);
  }

  private showdownContext(seat: PokerSeat): ShowdownContext {
    return {
      seat: seat.index,
      occupantId: seat.occupantId ?? '',
      handNumber: this.handNumberValue,
      holeCards: seat.holeCards,
      board: this.boardCards,
      history: this.handHistory,
    };
  }

  /**
   * The river's last aggressor shows first; a checked-down river starts with the
   * first live seat clockwise of the button. After the first hand is shown, a
   * seat that wins nothing may muck.
   */
  private beginShowdown(): void {
    this.phaseValue = 'showdown';
    this.showdownQueue = [];
    if (this.runout) return;
    const live = new Set(this.liveSeats().map((seat) => seat.index));
    const clockwise = clockwiseFromButton(this.button, POKER_SEAT_COUNT).filter((seat) =>
      live.has(seat),
    );
    const opener =
      this.riverAggressor !== null && live.has(this.riverAggressor)
        ? this.riverAggressor
        : clockwise[0];
    const start = clockwise.indexOf(opener);
    const order = [...clockwise.slice(start), ...clockwise.slice(0, start)];
    const winnings = this.computeAward().perSeat;
    order.forEach((seatIndex, position) => {
      const seat = this.seatState[seatIndex];
      const mustShow = position === 0 || winnings[seatIndex] > 0;
      const show =
        mustShow ||
        (seat.isPlayer ? this.showCards : this.brain.showsLosingHand(this.showdownContext(seat)));
      this.showdownQueue.push({ seat: seatIndex, show });
    });
  }

  private stepShowdown(): void {
    const next = this.showdownQueue.shift();
    if (next === undefined) {
      this.award(false);
      return;
    }
    const seat = this.seatState[next.seat];
    if (next.show) this.revealSeat(seat);
    else this.emit({ kind: 'muck', seat: next.seat });
    this.wait(SHOWDOWN_REVEAL_MS);
  }

  private awardUncontested(winner: PokerSeat): void {
    if (!winner.isPlayer) {
      const shown = this.brain.uncontestedShow(this.showdownContext(winner));
      if (shown.length > 0) this.emit({ kind: 'uncontested_show', seat: winner.index, shown });
    }
    this.award(true);
  }

  private award(uncontested: boolean): void {
    const result = this.computeAward();
    for (const award of result.awards) {
      const firstWinner = this.seatState[award.winners[0]];
      const label = uncontested
        ? null
        : evaluateBest([...firstWinner.holeCards, ...this.boardCards]).label;
      this.emit({
        kind: 'pot_awarded',
        potIndex: award.potIndex,
        seats: award.winners,
        amounts: award.amounts,
        uncontested,
        label,
      });
    }
    result.perSeat.forEach((amount, seat) => {
      this.seatState[seat].stack += amount;
    });
    this.emit({
      kind: 'hand_complete',
      handNumber: this.handNumberValue,
      netBySeat: this.seatState.map((seat, index) => result.perSeat[index] - seat.contributed),
      stacks: this.seatState.map((seat) => seat.stack),
      contributions: this.seatState.map((seat) => seat.contributed),
      live: this.seatState.map((seat) => seat.inHand && !seat.folded),
      holeCards: this.seatState.map((seat) => [...seat.holeCards]),
      board: [...this.boardCards],
      burned: [...this.burned],
    });
    this.phaseValue = 'awarding';
    this.wait(AWARD_MS);
  }

  private finishHand(): void {
    this.skipping = false;
    let playerBusted = false;
    for (const seat of this.seatState) {
      if (!seat.inHand || seat.stack > 0) continue;
      if (seat.isPlayer) playerBusted = true;
      else this.emit({ kind: 'seat_busted', seat: seat.index, occupantId: seat.occupantId ?? '' });
    }
    if (playerBusted && !this.leaving) {
      // Busts and walk-outs settle before the rebuy is offered, so a player
      // is never asked to buy into a table the last regular just left.
      this.phaseValue = 'between_hands';
      this.churnSeats();
      this.churnedForNextHand = true;
      if (this.regularsReady() === 0) {
        this.enterGameOver();
        return;
      }
      this.phaseValue = 'player_busted';
      this.emit({ kind: 'player_busted' });
      return;
    }
    this.phaseValue = 'between_hands';
    this.wait(BETWEEN_HANDS_MS);
  }

  // ── Decision context ──────────────────────────────────────────────────────

  /** Clockwise distance from the button counting only seats dealt in; an empty chair has no position. */
  private positionOf(seat: number): number {
    let position = 0;
    for (
      let offset = 1;
      offset <= (seat - this.button + POKER_SEAT_COUNT) % POKER_SEAT_COUNT;
      offset++
    ) {
      if (this.seatState[(this.button + offset) % POKER_SEAT_COUNT].inHand) position++;
    }
    return position;
  }

  private decisionContext(seatIndex: number, round: BettingRound): PokerDecisionContext {
    const seat = this.seatState[seatIndex];
    const legal = round.legalActions(seatIndex);
    const seats = this.seatState.map((s) => ({
      seat: s.index,
      occupantId: s.occupantId,
      isPlayer: s.isPlayer,
      stack: s.stack,
      streetBet: s.streetBet,
      contributed: s.contributed,
      inHand: s.inHand,
      folded: s.folded,
      allIn: s.allIn,
      positionFromButton: this.positionOf(s.index),
    }));
    const actionsBySeat = this.seatState.map((s) =>
      this.handHistory.filter((record) => record.seat === s.index),
    );
    return {
      seat: seatIndex,
      occupantId: seat.occupantId ?? '',
      tier: this.tier,
      stakes: this.stakes,
      handNumber: this.handNumberValue,
      street: this.street,
      holeCards: seat.holeCards,
      board: this.boardCards,
      pot: this.pot,
      toCall: legal.toCall,
      legal,
      minRaiseIncrement: round.minRaiseIncrement,
      buttonSeat: this.button,
      smallBlindSeat: this.smallBlindSeat,
      bigBlindSeat: this.bigBlindSeat,
      positionFromButton: this.positionOf(seatIndex),
      seats,
      liveOpponents: this.liveSeats().length - 1,
      aggressionThisStreet: this.handHistory.filter(
        (record) => record.street === this.street && record.aggressive,
      ).length,
      history: this.handHistory,
      actionsBySeat,
    };
  }
}
