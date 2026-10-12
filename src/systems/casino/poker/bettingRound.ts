/**
 * One No-Limit betting round: who may act, what they may do, and when the round
 * is over.
 *
 * The round mutates the seats it is given (stacks, street bets, contributions,
 * fold and all-in flags) so the table and the round can never disagree about
 * money. Bet and raise amounts are "raise to" totals for the street, never
 * increments, which is how a real table announces them.
 */

export type PokerActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';

export type PokerAction =
  | { readonly kind: 'fold' }
  | { readonly kind: 'check' }
  | { readonly kind: 'call' }
  | { readonly kind: 'bet'; readonly amount: number }
  | { readonly kind: 'raise'; readonly amount: number }
  | { readonly kind: 'all_in' };

/** The money and status of one seat that a betting round reads and updates. */
export interface BettingSeat {
  stack: number;
  /** Chips this seat has put in on the current street. */
  streetBet: number;
  /** Chips this seat has put in across the whole hand, blinds included. */
  contributed: number;
  folded: boolean;
  allIn: boolean;
}

export interface AmountRange {
  /** Smallest legal "raise to" total for the street. */
  readonly min: number;
  /** Largest legal "raise to" total: the seat's whole stack in. */
  readonly max: number;
}

/** What the seat to act may do right now. A `null` field means that action is not available. */
export interface LegalActions {
  readonly seat: number;
  readonly toCall: number;
  readonly canFold: boolean;
  readonly canCheck: boolean;
  /** Chips a call adds; `null` when calling would put the seat all-in (use `allIn`). */
  readonly call: number | null;
  readonly bet: AmountRange | null;
  readonly raise: AmountRange | null;
  /** The street total an all-in reaches; `null` when the seat may not shove (raising is closed). */
  readonly allIn: number | null;
}

/** An action as it landed, normalized: anything that empties the stack is `all_in`. */
export interface AppliedAction {
  readonly seat: number;
  readonly kind: PokerActionKind;
  /** Chips this action moved from stack to pot. */
  readonly chipsAdded: number;
  /** The seat's street total afterwards. */
  readonly streetTotal: number;
  /** True when the action raised the price for everyone else. */
  readonly aggressive: boolean;
}

export interface BettingRoundOptions {
  readonly bigBlind: number;
  /** The price to stay in when the round opens: the big blind pre-flop, 0 after. */
  readonly openingBet: number;
  readonly firstToAct: number;
}

export class IllegalPokerAction extends Error {}

export class BettingRound {
  private readonly seats: BettingSeat[];
  private readonly bigBlind: number;
  private currentBet: number;
  /** The size of the last full bet or raise: the smallest increment a raise may add. */
  private lastFullRaise: number;
  /**
   * The street price each seat last acted at, or `null` before it has acted.
   * A seat may raise again only when the price has risen by a full raise since,
   * which is what keeps a short all-in from reopening the betting.
   */
  private readonly actedAt: Array<number | null>;
  private cursor: number;
  private lastAggressorSeat: number | null = null;

  constructor(seats: BettingSeat[], options: BettingRoundOptions) {
    this.seats = seats;
    this.bigBlind = options.bigBlind;
    this.currentBet = options.openingBet;
    this.lastFullRaise = options.bigBlind;
    this.actedAt = seats.map(() => null);
    this.cursor = options.firstToAct;
  }

  get price(): number {
    return this.currentBet;
  }

  get minRaiseIncrement(): number {
    return this.lastFullRaise;
  }

  /** The last seat to bet or raise this street, for showdown order. */
  get lastAggressor(): number | null {
    return this.lastAggressorSeat;
  }

  private canStillAct(seat: number): boolean {
    const s = this.seats[seat];
    return !s.folded && !s.allIn;
  }

  private needsAction(seat: number): boolean {
    if (!this.canStillAct(seat)) return false;
    return this.actedAt[seat] === null || this.seats[seat].streetBet < this.currentBet;
  }

  get isComplete(): boolean {
    const live = this.seats.filter((seat) => !seat.folded);
    if (live.length <= 1) return true;
    const canAct = live.filter((seat) => !seat.allIn);
    if (canAct.length === 0) return true;
    // The last seat with chips has nobody left to bet against. It owes a
    // decision only if some live all-in still exceeds it; the nominal price can
    // sit above every live bet when a blind posted all-in short, and the excess
    // it has already put in comes back as an uncalled bet.
    const loneSeat = canAct.length === 1 ? canAct[0] : null;
    if (loneSeat !== null) {
      const highestOtherBet = Math.max(
        ...live.filter((seat) => seat !== loneSeat).map((seat) => seat.streetBet),
      );
      if (loneSeat.streetBet >= highestOtherBet) return true;
    }
    return this.seats.every((_, seat) => !this.needsAction(seat));
  }

  /** The seat whose turn it is, or `null` once the round is over. */
  nextToAct(): number | null {
    if (this.isComplete) return null;
    for (let offset = 0; offset < this.seats.length; offset++) {
      const seat = (this.cursor + offset) % this.seats.length;
      if (this.needsAction(seat)) return seat;
    }
    return null;
  }

  private raiseRightsOpen(seat: number): boolean {
    const actedAt = this.actedAt[seat];
    return actedAt === null || this.currentBet - actedAt >= this.lastFullRaise;
  }

  legalActions(seat: number): LegalActions {
    const s = this.seats[seat];
    const toCall = Math.max(0, this.currentBet - s.streetBet);
    const allInTotal = s.streetBet + s.stack;
    const open = this.raiseRightsOpen(seat);
    const noBetYet = this.currentBet === 0;

    const bet =
      noBetYet && allInTotal >= this.bigBlind ? { min: this.bigBlind, max: allInTotal } : null;
    const minRaiseTo = this.currentBet + this.lastFullRaise;
    const raise =
      !noBetYet && open && allInTotal >= minRaiseTo ? { min: minRaiseTo, max: allInTotal } : null;
    const shoveOnlyCalls = allInTotal <= this.currentBet;
    const allIn = s.stack > 0 && (shoveOnlyCalls || noBetYet || open) ? allInTotal : null;

    return {
      seat,
      toCall,
      canFold: toCall > 0,
      canCheck: toCall === 0,
      call: toCall > 0 && s.stack > toCall ? toCall : null,
      bet,
      raise,
      allIn,
    };
  }

  /** Applies the action for `seat`, throwing `IllegalPokerAction` when it is not its turn or not legal. */
  apply(seat: number, action: PokerAction): AppliedAction {
    if (this.nextToAct() !== seat) throw new IllegalPokerAction(`seat ${seat} acted out of turn`);
    const legal = this.legalActions(seat);
    if (!isLegal(action, legal)) {
      throw new IllegalPokerAction(`seat ${seat} cannot ${describeAction(action)}`);
    }
    const s = this.seats[seat];
    let target = s.streetBet;
    switch (action.kind) {
      case 'fold':
        s.folded = true;
        break;
      case 'check':
        break;
      case 'call':
        target = this.currentBet;
        break;
      case 'bet':
      case 'raise':
        target = action.amount;
        break;
      case 'all_in':
        target = s.streetBet + s.stack;
        break;
    }
    const chipsAdded = target - s.streetBet;
    s.stack -= chipsAdded;
    s.streetBet = target;
    s.contributed += chipsAdded;
    if (s.stack === 0 && !s.folded) s.allIn = true;

    const aggressive = target > this.currentBet;
    if (aggressive) {
      const increment = target - this.currentBet;
      if (increment >= this.lastFullRaise) this.lastFullRaise = increment;
      this.currentBet = target;
      this.lastAggressorSeat = seat;
    }
    this.actedAt[seat] = this.currentBet;
    this.cursor = (seat + 1) % this.seats.length;

    return {
      seat,
      kind: s.allIn && chipsAdded > 0 ? 'all_in' : action.kind,
      chipsAdded,
      streetTotal: s.streetBet,
      aggressive,
    };
  }

  /**
   * Folds a seat whether or not it is that seat's turn: the player walking away
   * from the table mid-hand. The seat's chips stay where they are.
   */
  forceFold(seat: number): void {
    this.seats[seat].folded = true;
    this.actedAt[seat] = this.currentBet;
  }
}

export function isLegal(action: PokerAction, legal: LegalActions): boolean {
  switch (action.kind) {
    case 'fold':
      return legal.canFold;
    case 'check':
      return legal.canCheck;
    case 'call':
      return legal.call !== null;
    case 'bet':
      return inRange(action.amount, legal.bet);
    case 'raise':
      return inRange(action.amount, legal.raise);
    case 'all_in':
      return legal.allIn !== null;
  }
}

function inRange(amount: number, range: AmountRange | null): boolean {
  return range !== null && Number.isInteger(amount) && amount >= range.min && amount <= range.max;
}

export function describeAction(action: PokerAction): string {
  switch (action.kind) {
    case 'bet':
    case 'raise':
      return `${action.kind} to ${action.amount}`;
    case 'fold':
    case 'check':
    case 'call':
    case 'all_in':
      return action.kind;
  }
}

/** The cheapest passive action available: check when free, otherwise call (or call all-in). */
export function passiveAction(legal: LegalActions): PokerAction {
  if (legal.canCheck) return { kind: 'check' };
  if (legal.call !== null) return { kind: 'call' };
  if (legal.allIn !== null) return { kind: 'all_in' };
  return { kind: 'fold' };
}
