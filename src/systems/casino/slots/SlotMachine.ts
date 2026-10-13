/**
 * The slot machine's whole state: what phase it is in, the spin in flight, the
 * free-spin feature and a ledger of every coin bet and paid.
 *
 * It holds no coins and no clock. The host takes the bet when a spin reports a
 * charge, pays whatever a `win_paid` event names, and stores the progressive
 * pool it is handed back: the fed pool when a spin starts, and the reset pool
 * on `jackpot_won`, which only fires once the jackpot is actually paid. The
 * meter therefore never drops before the reels land, and a save taken
 * mid-celebration still holds the unpaid jackpot. It also decides when each reel stops and when a
 * celebration ends, so every animation timing lives in the view while the
 * money stays verifiable without a canvas.
 *
 * A spin's result is fixed the moment it starts; the reels only reveal it.
 */

import { mulberry32, type Rng } from '../../../sprites/person/rng';
import {
  isBetPerLine,
  feedJackpotPool,
  normalizeJackpotPool,
  totalBetFor,
  type BetPerLine,
  type WinTier,
} from './slotBets';
import { evaluateSpin, type NearMiss, type SpinOutcome } from './evaluateSpin';
import { findForcedStops, type ForcedOutcome } from './forcedOutcomes';
import {
  REEL_COUNT,
  REEL_STRIPS,
  areValidStops,
  randomStops,
  type ReelStops,
  type ReelStrips,
  type SlotGrid,
} from './slotReels';
import { SCATTER } from './slotSymbols';

/**
 * `free_spins` is the machine at rest inside the feature, waiting for the next
 * free spin; `idle` is at rest outside it.
 */
export type SlotPhase = 'idle' | 'spinning' | 'stopping' | 'celebrating' | 'free_spins';

export interface FreeSpinFeature {
  /** The bet that triggered the feature; every free spin plays at it. */
  readonly betPerLine: BetPerLine;
  readonly remaining: number;
  readonly played: number;
  /** Everything the feature's own spins have paid, not counting the triggering spin. */
  readonly totalWon: number;
}

/**
 * Things the machine did since the host last looked, drained once per frame to
 * drive reels, banners, coins and audio. The machine never calls into any of those.
 */
export type SlotEvent =
  | {
      readonly kind: 'bet_placed';
      readonly betPerLine: BetPerLine;
      readonly totalBet: number;
      readonly jackpotContribution: number;
    }
  | {
      readonly kind: 'spin_started';
      readonly free: boolean;
      readonly stops: ReelStops;
      readonly anticipationReels: ReadonlyArray<number>;
    }
  | { readonly kind: 'free_spin_started'; readonly number: number; readonly remaining: number }
  | {
      readonly kind: 'reel_stopped';
      readonly reel: number;
      readonly stop: number;
      readonly last: boolean;
    }
  | {
      readonly kind: 'scatter_landed';
      readonly reel: number;
      readonly row: number;
      readonly ordinal: number;
    }
  | { readonly kind: 'anticipation_started'; readonly reel: number }
  | { readonly kind: 'near_miss'; readonly miss: NearMiss }
  | { readonly kind: 'spin_settled'; readonly free: boolean; readonly outcome: SpinOutcome }
  | {
      readonly kind: 'jackpot_won';
      /** Whole coins, also included in the `win_paid` that follows. */
      readonly amount: number;
      /** The pool to store now that it has paid out. */
      readonly poolAfter: number;
    }
  | {
      readonly kind: 'win_paid';
      readonly amount: number;
      readonly tier: WinTier;
      readonly free: boolean;
    }
  | {
      readonly kind: 'free_spins_awarded';
      readonly count: number;
      readonly remaining: number;
      readonly retrigger: boolean;
    }
  | { readonly kind: 'free_spins_ended'; readonly totalWon: number; readonly played: number };

export type SlotRefusal = 'busy' | 'invalid_bet';

export interface SlotSpinRequest {
  /** Ignored inside the free-spin feature, which plays at its triggering bet. */
  readonly betPerLine: number;
  /** The stored progressive pool before this spin. */
  readonly jackpotPool: number;
}

export type SpinStart =
  | {
      readonly kind: 'started';
      readonly free: boolean;
      /** Coins the host must take for this spin; zero for a free spin. */
      readonly charged: number;
      /** The pool to store now, with this spin's contribution added; never reset here. */
      readonly jackpotPool: number;
      readonly outcome: SpinOutcome;
    }
  | { readonly kind: 'refused'; readonly reason: SlotRefusal };

export interface SlotMachineOptions {
  /** The stop picker's random source; a seed makes every spin reproducible. */
  readonly random?: Rng;
  readonly seed?: number;
  readonly strips?: ReelStrips;
}

interface LiveSpin {
  readonly outcome: SpinOutcome;
  readonly free: boolean;
  reelsStopped: number;
  scattersLanded: number;
}

export class SlotMachine {
  readonly strips: ReelStrips;
  private readonly random: Rng;

  private currentPhase: SlotPhase = 'idle';
  private live: LiveSpin | null = null;
  private lastOutcome: SpinOutcome | null = null;
  private feature: FreeSpinFeature | null = null;
  private forcedStops: ReelStops | null = null;
  private readonly events: SlotEvent[] = [];

  /** Every coin the machine has asked the host to take. */
  totalWagered = 0;
  /** Every coin the machine has told the host to pay. */
  totalPaid = 0;
  paidSpins = 0;
  freeSpinsPlayed = 0;

  constructor(options: SlotMachineOptions = {}) {
    this.strips = options.strips ?? REEL_STRIPS;
    this.random =
      options.random ?? (options.seed === undefined ? Math.random : mulberry32(options.seed));
  }

  get phase(): SlotPhase {
    return this.currentPhase;
  }

  /** The free-spin feature in progress, or null outside it. */
  get freeSpins(): FreeSpinFeature | null {
    return this.feature;
  }

  /** The spin being revealed or celebrated, else the last one settled. */
  get outcome(): SpinOutcome | null {
    return this.live?.outcome ?? this.lastOutcome;
  }

  get grid(): SlotGrid | null {
    return this.outcome?.grid ?? null;
  }

  /** How many reels, from the left, have stopped on the spin in flight. */
  get reelsStopped(): number {
    return this.live?.reelsStopped ?? 0;
  }

  /** True while a spin can be started. */
  get atRest(): boolean {
    return this.currentPhase === 'idle' || this.currentPhase === 'free_spins';
  }

  drainEvents(): ReadonlyArray<SlotEvent> {
    const drained = [...this.events];
    this.events.length = 0;
    return drained;
  }

  private emit(event: SlotEvent): void {
    this.events.push(event);
  }

  private restPhase(): SlotPhase {
    return this.feature === null ? 'idle' : 'free_spins';
  }

  /**
   * Makes the next spin land on stops that produce `kind` at `betPerLine` (or
   * at the feature's bet during free spins). False when no such stops were
   * found, which is always the case for the jackpot below max bet.
   */
  forceNext(kind: ForcedOutcome, betPerLine: BetPerLine, jackpotPool: number): boolean {
    const bet = this.feature?.betPerLine ?? betPerLine;
    const stops = findForcedStops(kind, bet, jackpotPool, this.strips, this.random);
    if (stops === null) return false;
    this.forcedStops = stops;
    return true;
  }

  /** Makes the next spin land exactly on `stops`; false (and nothing forced) if any is off its strip. */
  forceNextStops(stops: ReelStops): boolean {
    if (!areValidStops(this.strips, stops)) return false;
    this.forcedStops = [...stops];
    return true;
  }

  /**
   * Starts a spin: a paid spin at `betPerLine` outside the feature, the next
   * free spin inside it. The result is decided here; call `stopReel` to reveal it.
   */
  spin(request: SlotSpinRequest): SpinStart {
    if (!this.atRest) return { kind: 'refused', reason: 'busy' };
    const feature = this.feature;
    const free = feature !== null;
    let betPerLine: BetPerLine;
    if (feature !== null) {
      betPerLine = feature.betPerLine;
    } else if (isBetPerLine(request.betPerLine)) {
      betPerLine = request.betPerLine;
    } else {
      return { kind: 'refused', reason: 'invalid_bet' };
    }

    const totalBet = totalBetFor(betPerLine);
    const charged = free ? 0 : totalBet;
    const storedPool = normalizeJackpotPool(request.jackpotPool);
    const poolInPlay = free ? storedPool : feedJackpotPool(storedPool, totalBet);
    const contribution = poolInPlay - storedPool;

    if (feature === null) {
      this.totalWagered += charged;
      this.paidSpins++;
      this.emit({ kind: 'bet_placed', betPerLine, totalBet, jackpotContribution: contribution });
    } else {
      const remaining = feature.remaining - 1;
      const played = feature.played + 1;
      this.feature = { ...feature, remaining, played };
      this.freeSpinsPlayed++;
      this.emit({ kind: 'free_spin_started', number: played, remaining });
    }

    const stops = this.forcedStops ?? randomStops(this.strips, this.random);
    this.forcedStops = null;
    const outcome = evaluateSpin({
      stops,
      betPerLine,
      jackpotPool: poolInPlay,
      strips: this.strips,
    });
    this.live = { outcome, free, reelsStopped: 0, scattersLanded: 0 };
    this.currentPhase = 'spinning';
    this.emit({
      kind: 'spin_started',
      free,
      stops: outcome.stops,
      anticipationReels: outcome.anticipationReels,
    });

    return { kind: 'started', free, charged, jackpotPool: poolInPlay, outcome };
  }

  /**
   * Stops the leftmost reel still spinning and reports what landed on it.
   * Returns the reel stopped, or null when no spin is revealing.
   */
  stopReel(): number | null {
    const live = this.live;
    if (live === null || (this.currentPhase !== 'spinning' && this.currentPhase !== 'stopping')) {
      return null;
    }
    const reel = live.reelsStopped;
    const { outcome } = live;
    live.reelsStopped++;
    const last = live.reelsStopped >= REEL_COUNT;
    this.currentPhase = 'stopping';
    this.emit({ kind: 'reel_stopped', reel, stop: outcome.stops[reel], last });

    outcome.grid[reel].forEach((symbol, row) => {
      if (symbol !== SCATTER) return;
      live.scattersLanded++;
      this.emit({ kind: 'scatter_landed', reel, row, ordinal: live.scattersLanded });
    });
    for (const miss of outcome.nearMisses) {
      if (miss.reel === reel) this.emit({ kind: 'near_miss', miss });
    }
    const nextReel = reel + 1;
    if (!last && outcome.anticipationReels.includes(nextReel)) {
      this.emit({ kind: 'anticipation_started', reel: nextReel });
    }

    if (last) this.settle(live);
    return reel;
  }

  /** Stops every reel still spinning, left to right, as a skip or in turbo. */
  stopAllReels(): void {
    let stopped = this.stopReel();
    while (stopped !== null) stopped = this.stopReel();
  }

  private settle(live: LiveSpin): void {
    this.emit({ kind: 'spin_settled', free: live.free, outcome: live.outcome });
    const worthCelebrating = live.outcome.totalWin > 0 || live.outcome.scatter.freeSpinsAwarded > 0;
    if (worthCelebrating) {
      this.currentPhase = 'celebrating';
      return;
    }
    this.conclude(live);
  }

  /**
   * Ends the celebration: the win is paid and any free spins it earned are
   * awarded. The host calls this when the rollup lands or is skipped.
   */
  finishCelebration(): void {
    const live = this.live;
    if (live === null || this.currentPhase !== 'celebrating') return;
    this.conclude(live);
  }

  private conclude(live: LiveSpin): void {
    const { outcome } = live;
    if (outcome.jackpot.won) {
      this.emit({
        kind: 'jackpot_won',
        amount: outcome.jackpot.amount,
        poolAfter: outcome.jackpot.poolAfter,
      });
    }
    if (outcome.totalWin > 0) {
      this.totalPaid += outcome.totalWin;
      this.emit({
        kind: 'win_paid',
        amount: outcome.totalWin,
        tier: outcome.tier,
        free: live.free,
      });
    }

    let feature = this.feature;
    if (feature !== null && live.free) {
      feature = { ...feature, totalWon: feature.totalWon + outcome.totalWin };
    }
    const awarded = outcome.scatter.freeSpinsAwarded;
    if (awarded > 0) {
      const retrigger = feature !== null;
      feature =
        feature === null
          ? { betPerLine: outcome.betPerLine, remaining: awarded, played: 0, totalWon: 0 }
          : { ...feature, remaining: feature.remaining + awarded };
      this.emit({
        kind: 'free_spins_awarded',
        count: awarded,
        remaining: feature.remaining,
        retrigger,
      });
    }
    if (feature !== null && feature.remaining <= 0) {
      this.emit({ kind: 'free_spins_ended', totalWon: feature.totalWon, played: feature.played });
      feature = null;
    }
    this.feature = feature;

    this.lastOutcome = outcome;
    this.live = null;
    this.currentPhase = this.restPhase();
  }

  /**
   * Reveals and pays the spin in flight at once, whatever phase it is in.
   * Returns the pool to store when this paid a jackpot, else null.
   */
  settleNow(): number | null {
    const outcome = this.live?.outcome ?? null;
    this.stopAllReels();
    this.finishCelebration();
    return outcome?.jackpot.won === true ? outcome.jackpot.poolAfter : null;
  }

  /**
   * Settles everything the player is still owed: the spin in flight and every
   * remaining free spin, played out instantly. Returns the pool to store. This
   * is the exit path, so leaving mid-feature never forfeits a win.
   */
  settleAll(jackpotPool: number): number {
    let pool = this.settleNow() ?? normalizeJackpotPool(jackpotPool);
    while (this.feature !== null) {
      const start = this.spin({ betPerLine: this.feature.betPerLine, jackpotPool: pool });
      if (start.kind === 'refused') break;
      pool = this.settleNow() ?? start.jackpotPool;
    }
    return pool;
  }
}
