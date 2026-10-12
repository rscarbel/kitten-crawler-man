/**
 * What the poker table *shows*, as opposed to what the table *is*.
 *
 * The rules engine settles every action the instant it happens; the table on
 * screen catches up through card and chip flights, flips, sweeps and fades.
 * This model drains the engine's events into that catch-up — which cards have
 * landed, which bets sit on the felt, what the pot reads, who is lit up —
 * entirely off the host's own clock, so a frozen or skipped frame never loses
 * a chip. It paints nothing; {@link PokerTableView} reads it.
 */

import { cardId, type Card } from '../../systems/casino/Deck';
import type { PokerActionKind } from '../../systems/casino/poker/bettingRound';
import { evaluateBest } from '../../systems/casino/poker/handEvaluator';
import type {
  BoardStreet,
  PokerBanterTrigger,
  PokerEvent,
  ShownCardIndices,
  TellEventCue,
} from '../../systems/casino/poker/pokerEvents';
import {
  HOLE_CARD_COUNT,
  PLAYER_SEAT,
  POKER_SEAT_COUNT,
  type PokerTable,
} from '../../systems/casino/poker/PokerTable';
import type { BadgeTone } from '../widgets/badge';

/** A place on the table a flight leaves from or lands on, resolved against the live layout. */
export type FlightAnchor =
  | { readonly kind: 'deck' }
  | { readonly kind: 'muck' }
  | { readonly kind: 'pot' }
  | { readonly kind: 'plate'; readonly seat: number }
  /** Where chips coming home to a seat land: beside its plate, never over the name on it. */
  | { readonly kind: 'stack'; readonly seat: number }
  | { readonly kind: 'bet'; readonly seat: number }
  | { readonly kind: 'hole'; readonly seat: number; readonly index: number }
  | { readonly kind: 'board'; readonly index: number };

interface FlightBase {
  readonly from: FlightAnchor;
  readonly to: FlightAnchor;
  readonly startAt: number;
  readonly duration: number;
  readonly onLand: () => void;
}

/** A card face down in the air: dealt, burned or mucked. */
export interface CardFlight extends FlightBase {
  readonly kind: 'card';
}

/** A bet, a sweep or an award on its way. */
export interface ChipFlight extends FlightBase {
  readonly kind: 'chips';
  readonly amount: number;
  /** Chips splashed in rather than pushed neatly: the bet-motion tell. */
  readonly splash: boolean;
}

export type Flight = CardFlight | ChipFlight;

export interface ActionTag {
  readonly label: string;
  readonly tone: BadgeTone;
  /** When the tag began fading because a new street was dealt; `null` while it holds. */
  readonly fadeFrom: number | null;
}

/** How a seat at showdown or after an award is lit. */
export interface SeatResult {
  readonly label: string;
  readonly winner: boolean;
}

/** One seat changing hands: the old regular fades out, then the new one fades in. */
interface SeatChange {
  readonly leaving: string;
  readonly at: number;
}

/** The playback speed the table is shown at; every duration below is divided by it. */
export interface MotionPace {
  readonly fast: boolean;
  /** The player folded and asked to skip: the engine plays at four times speed. */
  readonly skipping: boolean;
  readonly reducedMotion: boolean;
}

// Durations at normal pace, in milliseconds. Each fits inside the engine's own
// beat for the same moment, so the table never runs ahead of its pictures.
export const SHUFFLE_MS = 600;
const HOLE_FLIGHT_MS = 260;
const CHIP_FLIGHT_MS = 300;
const SWEEP_MS = 380;
const AWARD_FLIGHT_MS = 650;
const AWARD_POT_STAGGER_MS = 220;
const BOARD_FLIGHT_MS = 220;
const BOARD_DEAL_STAGGER_MS = 70;
const FLOP_FLIP_STAGGER_MS = 140;
/** The turn and river are held face down for a beat before they turn. */
const SINGLE_CARD_HOLD_MS = 160;
export const FLIP_MS = 300;
const BURN_FLIGHT_MS = 220;
const MUCK_FLIGHT_MS = 260;
export const PUCK_SLIDE_MS = 420;
export const TAG_FADE_MS = 320;
export const SEAT_FADE_MS = 500;
export const TURN_SLIDE_MS = 220;
export const FIDGET_MS = 1400;
export const RECHECK_MS = 1000;
export const BET_POP_MS = 380;
/** One thinking pulse round an acting seat's avatar; a tanking or snapping regular stretches or squeezes it. */
export const ACTING_PULSE_MS = 1100;
const MIN_ACTING_PULSE_MS = 380;
export const WIN_LIFT_MS = 300;
export const TOGGLE_NOTICE_MS = 1600;

const FAST_PACE = 2;
const SKIP_PACE = 4;
/** Reduced motion keeps every move, but quick enough to read as a cut. */
const REDUCED_MOTION_PACE = 3;

const ACTION_LABELS: Readonly<Record<PokerActionKind, string>> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  bet: 'Bet',
  raise: 'Raise',
  all_in: 'All-in',
};

const ACTION_TONES: Readonly<Record<PokerActionKind, BadgeTone>> = {
  fold: 'neutral',
  check: 'neutral',
  call: 'info',
  bet: 'accent',
  raise: 'accent',
  all_in: 'danger',
};

function coins(amount: number): string {
  return amount.toLocaleString('en-US');
}

/** "Raise to 120", "Call 20", "Check": the words a seat's tag and the dealer's call use. */
export function actionWords(kind: PokerActionKind, amount: number, streetTotal: number): string {
  switch (kind) {
    case 'call':
      return `${ACTION_LABELS.call} ${coins(amount)}`;
    case 'bet':
      return `${ACTION_LABELS.bet} ${coins(streetTotal)}`;
    case 'raise':
      return `${ACTION_LABELS.raise} to ${coins(streetTotal)}`;
    case 'fold':
    case 'check':
    case 'all_in':
      return ACTION_LABELS[kind];
  }
}

function perSeat<T>(make: () => T): T[] {
  return Array.from({ length: POKER_SEAT_COUNT }, make);
}

/** Hooks a later layer (speech bubbles, the chatter tell) listens on; the table itself only shows. */
export interface PokerMotionHooks {
  onBanter: ((seat: number, trigger: PokerBanterTrigger) => void) | null;
  onChatter: ((seat: number, direction: 'up' | 'down') => void) | null;
  /** A line for the dealer's strip: what just happened at the table. */
  onCall: ((line: string) => void) | null;
}

export class PokerMotion {
  private now = 0;
  private pace: MotionPace = { fast: false, skipping: false, reducedMotion: false };
  private flightList: Flight[] = [];

  shuffleAt: number | null = null;
  turnAt: number | null = null;
  /** Hole cards that have landed at each seat. */
  readonly heldCards: number[] = perSeat(() => 0);
  /** When each of the player's two cards turned face up on landing. */
  readonly playerFlipAt: Array<number | null> = Array.from({ length: HOLE_CARD_COUNT }, () => null);
  /** Seats whose cards have gone to the muck: folded, or mucked at showdown. */
  readonly cardsGone: boolean[] = perSeat(() => false);
  /** When each seat's hand turned face up (showdown, run-out, or a winner showing by choice). */
  readonly revealAt: Array<number | null> = perSeat(() => null);
  /** Which hole cards an uncontested winner chose to show; `null` when all show or none. */
  readonly shownOnly: Array<ShownCardIndices | null> = perSeat(() => null);
  readonly boardLandedAt: Array<number | null> = [];
  readonly boardFlipAt: Array<number | null> = [];
  /** Chips standing on each seat's bet spot. */
  readonly feltBets: number[] = perSeat(() => 0);
  /** Each seat's bet this street as the engine has it, landed or still flying. */
  private readonly streetTotals: number[] = perSeat(() => 0);
  /** Chips flying home to each seat, not yet added to the stack it shows. */
  readonly incoming: number[] = perSeat(() => 0);
  potShown = 0;
  private potReadyAt = 0;
  muckCount = 0;
  puckFrom: number | null = null;
  puckTo: number | null = null;
  puckAt = 0;
  readonly tags: Array<ActionTag | null> = perSeat(() => null);
  readonly results: Array<SeatResult | null> = perSeat(() => null);
  /** Every card in a winning five, by `cardId`. */
  readonly winningCards = new Set<string>();
  winnersAt: number | null = null;
  /** A tanking or snapping regular's pulse multiplier, held until their action lands. */
  readonly thinkMultiplier: number[] = perSeat(() => 1);
  readonly splashNext: boolean[] = perSeat(() => false);
  readonly betPopAt: Array<number | null> = perSeat(() => null);
  readonly bigBetNext: boolean[] = perSeat(() => false);
  readonly fidgetAt: Array<number | null> = perSeat(() => null);
  readonly recheckAt: Array<number | null> = perSeat(() => null);
  readonly seatChange: Array<SeatChange | null> = perSeat(() => null);
  readonly busted: boolean[] = perSeat(() => false);
  private street: BoardStreet | 'preflop' = 'preflop';

  readonly hooks: PokerMotionHooks = { onBanter: null, onChatter: null, onCall: null };

  constructor(private readonly seatName: (seat: number) => string) {}

  get flights(): ReadonlyArray<Flight> {
    return this.flightList;
  }

  get time(): number {
    return this.now;
  }

  /** How many times faster than normal the table is being shown. */
  get speed(): number {
    let speed = 1;
    if (this.pace.fast) speed *= FAST_PACE;
    if (this.pace.skipping) speed *= SKIP_PACE;
    if (this.pace.reducedMotion) speed *= REDUCED_MOTION_PACE;
    return speed;
  }

  get reducedMotion(): boolean {
    return this.pace.reducedMotion;
  }

  /** A normal-pace duration at the current pace. */
  scaled(ms: number): number {
    return ms / this.speed;
  }

  setPace(pace: MotionPace): void {
    this.pace = pace;
  }

  /** Moves the clock on and lands every flight that has arrived. */
  advance(now: number): void {
    this.now = now;
    const landed = this.flightList.filter((flight) => flight.startAt + flight.duration <= now);
    if (landed.length === 0) return;
    this.flightList = this.flightList.filter((flight) => flight.startAt + flight.duration > now);
    for (const flight of landed) flight.onLand();
  }

  /** Lands everything at once: the table was left, or the view is starting over. */
  settle(): void {
    const pending = this.flightList;
    this.flightList = [];
    for (const flight of pending) flight.onLand();
  }

  /**
   * Lands every flight and completes every flip, so the table stands still
   * under the bust prompt rather than freezing a card mid-turn behind it.
   */
  private finishShowing(): void {
    this.settle();
    const turned = this.now - this.scaled(FLIP_MS);
    const done = (at: number | null): number | null => (at === null ? null : Math.min(at, turned));
    for (let seat = 0; seat < POKER_SEAT_COUNT; seat++)
      this.revealAt[seat] = done(this.revealAt[seat]);
    this.playerFlipAt.forEach((at, index) => {
      this.playerFlipAt[index] = done(at);
    });
    this.boardFlipAt.forEach((at, index) => {
      this.boardFlipAt[index] = done(at);
    });
  }

  private fly(flight: Flight): void {
    this.flightList.push(flight);
  }

  private chipFlight(
    from: FlightAnchor,
    to: FlightAnchor,
    amount: number,
    ms: number,
    onLand: () => void,
    opts: { readonly startAt?: number; readonly splash?: boolean } = {},
  ): void {
    this.fly({
      kind: 'chips',
      from,
      to,
      amount,
      splash: opts.splash ?? false,
      startAt: opts.startAt ?? this.now,
      duration: this.scaled(ms),
      onLand,
    });
  }

  private cardFlight(
    from: FlightAnchor,
    to: FlightAnchor,
    ms: number,
    onLand: () => void,
    startAt: number = this.now,
  ): void {
    this.fly({ kind: 'card', from, to, startAt, duration: this.scaled(ms), onLand });
  }

  handle(event: PokerEvent, table: PokerTable): void {
    switch (event.kind) {
      case 'shuffled':
        this.startHand();
        this.call(`Hand ${event.handNumber}. Deuce shuffles up.`);
        return;
      case 'button_moved':
        this.puckFrom = this.puckTo;
        this.puckTo = event.seat;
        this.puckAt = this.now;
        return;
      case 'blind_posted':
        this.betIn(event.seat, event.amount, event.amount, false);
        return;
      case 'hole_dealt':
        this.dealHole(event.seat, event.index);
        return;
      case 'burn':
        this.cardFlight({ kind: 'deck' }, { kind: 'muck' }, BURN_FLIGHT_MS, () => {
          this.muckCount++;
        });
        return;
      case 'street_dealt':
        this.dealStreet(event.street, event.cards.length, table.board.length);
        return;
      case 'action':
        this.landAction(event.seat, event.action, event.amount, event.streetTotal);
        return;
      case 'player_turn':
        this.turnAt = this.now;
        return;
      case 'uncalled_returned':
        this.returnBet(event.seat, event.amount);
        return;
      case 'bets_collected':
        this.collectBets(event.pot);
        return;
      case 'runout_started':
        this.call('All in. Cards up.');
        return;
      case 'showdown_reveal':
        this.revealAt[event.seat] = this.now;
        this.results[event.seat] = { label: event.label, winner: false };
        return;
      case 'muck':
        this.muckSeat(event.seat);
        return;
      case 'uncontested_show':
        this.revealAt[event.seat] = this.now;
        this.shownOnly[event.seat] = event.shown;
        return;
      case 'pot_awarded':
        this.award(table, event.seats, event.amounts, event.potIndex, event.label);
        return;
      case 'seat_busted':
        this.busted[event.seat] = true;
        return;
      case 'seat_vacated':
        this.seatChange[event.seat] = { leaving: event.occupantId, at: this.now };
        this.busted[event.seat] = false;
        // A regular who stands up takes their cards and last call with them;
        // with nobody replacing them the chair would otherwise keep showing both.
        this.heldCards[event.seat] = 0;
        this.revealAt[event.seat] = null;
        this.shownOnly[event.seat] = null;
        this.tags[event.seat] = null;
        this.results[event.seat] = null;
        return;
      case 'tell':
        this.showTell(event.seat, event.cue);
        return;
      case 'banter':
        this.hooks.onBanter?.(event.seat, event.trigger);
        return;
      case 'player_busted':
        this.finishShowing();
        this.call("You're out of chips.");
        return;
      case 'seat_rebuy':
        this.busted[event.seat] = false;
        return;
      case 'seat_replaced':
      case 'player_rebuy':
      case 'hand_complete':
      case 'game_over':
        return;
    }
  }

  private call(line: string): void {
    this.hooks.onCall?.(line);
  }

  /** Forgets everything shown, for a new sitting at a new table. */
  reset(): void {
    this.startHand();
    this.shuffleAt = null;
    this.puckFrom = null;
    this.puckTo = null;
    this.incoming.fill(0);
    this.busted.fill(false);
    this.seatChange.fill(null);
    this.fidgetAt.fill(null);
  }

  private startHand(): void {
    this.settle();
    this.shuffleAt = this.now;
    this.turnAt = null;
    this.street = 'preflop';
    for (let seat = 0; seat < POKER_SEAT_COUNT; seat++) {
      this.heldCards[seat] = 0;
      this.cardsGone[seat] = false;
      this.revealAt[seat] = null;
      this.shownOnly[seat] = null;
      this.feltBets[seat] = 0;
      this.streetTotals[seat] = 0;
      this.tags[seat] = null;
      this.results[seat] = null;
      this.thinkMultiplier[seat] = 1;
      this.splashNext[seat] = false;
      this.bigBetNext[seat] = false;
      this.betPopAt[seat] = null;
      this.recheckAt[seat] = null;
      this.busted[seat] = false;
    }
    this.playerFlipAt.fill(null);
    this.boardLandedAt.length = 0;
    this.boardFlipAt.length = 0;
    this.winningCards.clear();
    this.winnersAt = null;
    this.potShown = 0;
    this.potReadyAt = this.now;
    this.muckCount = 0;
  }

  private betIn(seat: number, amount: number, streetTotal: number, splash: boolean): void {
    if (amount <= 0) return;
    this.streetTotals[seat] = streetTotal;
    this.chipFlight(
      { kind: 'plate', seat },
      { kind: 'bet', seat },
      amount,
      CHIP_FLIGHT_MS,
      () => {
        this.feltBets[seat] = Math.max(
          this.feltBets[seat],
          Math.min(streetTotal, this.streetTotals[seat]),
        );
      },
      { splash },
    );
  }

  private dealHole(seat: number, index: number): void {
    this.cardFlight({ kind: 'deck' }, { kind: 'hole', seat, index }, HOLE_FLIGHT_MS, () => {
      this.heldCards[seat] = Math.max(this.heldCards[seat], index + 1);
      if (seat === PLAYER_SEAT) this.playerFlipAt[index] = this.now;
    });
  }

  private dealStreet(street: BoardStreet, count: number, boardLength: number): void {
    this.street = street;
    for (const tag of this.tags.keys()) {
      const held = this.tags[tag];
      if (held !== null && held.fadeFrom === null) this.tags[tag] = { ...held, fadeFrom: this.now };
    }
    const first = boardLength - count;
    for (let offset = 0; offset < count; offset++) {
      const index = first + offset;
      const startAt = this.now + this.scaled(BOARD_DEAL_STAGGER_MS * offset);
      const hold = count > 1 ? FLOP_FLIP_STAGGER_MS * offset : SINGLE_CARD_HOLD_MS;
      this.boardLandedAt[index] = null;
      this.boardFlipAt[index] = null;
      this.cardFlight(
        { kind: 'deck' },
        { kind: 'board', index },
        BOARD_FLIGHT_MS,
        () => {
          this.boardLandedAt[index] = this.now;
          this.boardFlipAt[index] = this.now + this.scaled(hold);
        },
        startAt,
      );
    }
  }

  private landAction(
    seat: number,
    kind: PokerActionKind,
    amount: number,
    streetTotal: number,
  ): void {
    this.tags[seat] = {
      label: actionWords(kind, amount, streetTotal),
      tone: ACTION_TONES[kind],
      fadeFrom: null,
    };
    this.call(`${this.seatName(seat)}: ${actionWords(kind, amount, streetTotal)}.`);
    this.thinkMultiplier[seat] = 1;
    const splash = this.splashNext[seat];
    this.splashNext[seat] = false;
    if (this.bigBetNext[seat] && amount > 0)
      this.betPopAt[seat] = this.now + this.scaled(CHIP_FLIGHT_MS);
    this.bigBetNext[seat] = false;
    if (kind === 'fold') {
      this.muckSeat(seat);
      return;
    }
    this.betIn(seat, amount, streetTotal, splash);
  }

  /** The seat's cards slide face down to the muck pile. */
  private muckSeat(seat: number): void {
    const held = this.heldCards[seat];
    this.cardsGone[seat] = true;
    for (let index = 0; index < held; index++) {
      this.cardFlight({ kind: 'hole', seat, index }, { kind: 'muck' }, MUCK_FLIGHT_MS, () => {
        this.muckCount++;
      });
    }
  }

  private returnBet(seat: number, amount: number): void {
    this.streetTotals[seat] = Math.max(0, this.streetTotals[seat] - amount);
    this.feltBets[seat] = Math.max(0, this.feltBets[seat] - amount);
    this.incoming[seat] += amount;
    this.chipFlight({ kind: 'bet', seat }, { kind: 'stack', seat }, amount, CHIP_FLIGHT_MS, () => {
      this.incoming[seat] = Math.max(0, this.incoming[seat] - amount);
    });
  }

  /** Every bet on the felt sweeps into the pot; the pot reads its new total as the last one lands. */
  private collectBets(pot: number): void {
    const sweeping = this.streetTotals.map((total, seat) => Math.max(total, this.feltBets[seat]));
    this.flightList = this.flightList.filter(
      (flight) => !(flight.kind === 'chips' && flight.to.kind === 'bet'),
    );
    const swept = sweeping.filter((amount) => amount > 0).length;
    sweeping.forEach((amount, seat) => {
      this.feltBets[seat] = 0;
      this.streetTotals[seat] = 0;
      if (amount <= 0) return;
      this.chipFlight({ kind: 'bet', seat }, { kind: 'pot' }, amount, SWEEP_MS, () => {
        this.potShown = Math.max(this.potShown, pot);
      });
    });
    if (swept === 0) this.potShown = pot;
    this.potReadyAt = this.now + (swept > 0 ? this.scaled(SWEEP_MS) : 0);
  }

  private award(
    table: PokerTable,
    seats: ReadonlyArray<number>,
    amounts: ReadonlyArray<number>,
    potIndex: number,
    label: string | null,
  ): void {
    const startAt =
      Math.max(this.now, this.potReadyAt) + this.scaled(AWARD_POT_STAGGER_MS * potIndex);
    seats.forEach((seat, index) => {
      const amount = amounts[index] ?? 0;
      this.incoming[seat] += amount;
      this.chipFlight(
        { kind: 'pot' },
        { kind: 'stack', seat },
        amount,
        AWARD_FLIGHT_MS,
        () => {
          this.incoming[seat] = Math.max(0, this.incoming[seat] - amount);
          this.potShown = Math.max(0, this.potShown - amount);
        },
        { startAt },
      );
      const held = table.seats[seat].holeCards;
      const best = label === null ? null : evaluateBest([...held, ...table.board]);
      this.results[seat] = { label: best?.label ?? '', winner: true };
      if (best !== null) for (const card of best.best5) this.winningCards.add(cardId(card));
    });
    this.winnersAt ??= startAt;
    const names = seats.map((seat) => this.seatName(seat)).join(' and ');
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    const verb = seats.length > 1 ? 'split' : seats[0] === PLAYER_SEAT ? 'win' : 'wins';
    const hand = label === null ? '' : ` with ${label}`;
    const pot = potIndex === 0 ? 'the pot' : 'a side pot';
    this.call(`${names} ${verb} ${pot} of ${coins(total)}${hand}.`);
  }

  private showTell(seat: number, cue: TellEventCue): void {
    switch (cue.kind) {
      case 'think_time':
        this.thinkMultiplier[seat] = cue.thinkMultiplier;
        return;
      case 'bet_size':
        this.bigBetNext[seat] = cue.betMultiplier > 1;
        return;
      case 'bet_motion':
        this.splashNext[seat] = cue.style === 'splash';
        return;
      case 'chip_fidget':
        this.fidgetAt[seat] = this.now;
        return;
      case 'card_recheck':
        this.recheckAt[seat] = this.now;
        return;
      case 'chatter':
        this.hooks.onChatter?.(seat, cue.direction);
        return;
    }
  }

  /** How long one thinking pulse takes at `seat` right now. */
  actingPulseMs(seat: number): number {
    return Math.max(MIN_ACTING_PULSE_MS, ACTING_PULSE_MS * this.thinkMultiplier[seat]);
  }

  /** 0→1 through `ms` (at the current pace) since `since`, or `null` when it has not started or is over. */
  progress(since: number | null, ms: number): number | null {
    if (since === null) return null;
    const elapsed = this.now - since;
    const duration = this.scaled(ms);
    if (elapsed < 0 || elapsed >= duration) return null;
    return elapsed / duration;
  }

  /** 0→1 through `ms` since `since`, held at 1 once over; 0 before it starts or when it never did. */
  settled(since: number | null, ms: number): number {
    if (since === null) return 0;
    const elapsed = this.now - since;
    if (elapsed <= 0) return 0;
    return Math.min(1, elapsed / this.scaled(ms));
  }

  get currentStreet(): BoardStreet | 'preflop' {
    return this.street;
  }

  /** Board cards that have turned face up. */
  boardShownCount(): number {
    let count = 0;
    for (const at of this.boardFlipAt) {
      if (at === null || at > this.now) break;
      count++;
    }
    return count;
  }

  isWinningCard(card: Card): boolean {
    return (
      this.winnersAt !== null && this.now >= this.winnersAt && this.winningCards.has(cardId(card))
    );
  }
}
