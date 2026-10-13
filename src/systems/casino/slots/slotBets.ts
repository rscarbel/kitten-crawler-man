/**
 * The slot machine's stakes: the bet ladder, the progressive jackpot pool and
 * the win tiers a payout is measured against.
 */

import { PAYLINE_COUNT } from './slotPaylines';

const BET_PENNY = 1;
const BET_LOW = 2;
const BET_MID = 5;
const BET_HIGH = 10;
const BET_TOP = 25;
/** Coins per line, one rung at a time; every spin plays all twenty lines. */
export const BET_LADDER = [BET_PENNY, BET_LOW, BET_MID, BET_HIGH, BET_TOP] as const;
export type BetPerLine = (typeof BET_LADDER)[number];

export const MIN_BET_PER_LINE: BetPerLine = BET_LADDER[0];
export const MAX_BET_PER_LINE: BetPerLine = BET_LADDER[BET_LADDER.length - 1];

export function isBetPerLine(value: number): value is BetPerLine {
  return BET_LADDER.some((rung) => rung === value);
}

export function totalBetFor(betPerLine: BetPerLine): number {
  return betPerLine * PAYLINE_COUNT;
}

/** The rung `steps` above (positive) or below (negative) `betPerLine`, clamped to the ladder. */
export function stepBet(betPerLine: BetPerLine, steps: number): BetPerLine {
  const index = BET_LADDER.indexOf(betPerLine);
  const next = Math.max(0, Math.min(BET_LADDER.length - 1, index + steps));
  return BET_LADDER[next];
}

/** The pool a fresh save starts at, and what it resets to after it is won. */
export const JACKPOT_FLOOR = 5000;
/** The share of every paid bet that feeds the progressive pool, the same at every rung. */
export const JACKPOT_CONTRIBUTION_RATE = 0.02;
/**
 * The pool is kept to thousandths of a coin. Every contribution is a whole
 * multiple of that (a bet is whole coins and the rate is whole hundredths),
 * so rounding to it only scrubs floating-point drift and never loses a slice.
 */
const JACKPOT_POOL_PRECISION = 1000;

/**
 * A stored pool clamped to a sane value: never below the floor, and rounded
 * to the pool's precision. It may hold a fraction of a coin; only whole coins
 * are ever shown or paid (see {@link jackpotPayableCoins}).
 */
export function normalizeJackpotPool(pool: number): number {
  if (!Number.isFinite(pool)) return JACKPOT_FLOOR;
  const rounded = Math.round(pool * JACKPOT_POOL_PRECISION) / JACKPOT_POOL_PRECISION;
  return Math.max(JACKPOT_FLOOR, rounded);
}

/** What a paid bet adds to the pool; it accrues fractionally. */
export function jackpotContributionFor(totalBet: number): number {
  return normalizeJackpotPool(JACKPOT_FLOOR + totalBet * JACKPOT_CONTRIBUTION_RATE) - JACKPOT_FLOOR;
}

/** The pool plus one paid bet's contribution, kept to the pool's precision. */
export function feedJackpotPool(pool: number, totalBet: number): number {
  return normalizeJackpotPool(normalizeJackpotPool(pool) + totalBet * JACKPOT_CONTRIBUTION_RATE);
}

/** The whole coins a pool would pay, and what the meter shows. */
export function jackpotPayableCoins(pool: number): number {
  return Math.floor(normalizeJackpotPool(pool));
}

/**
 * The pool once it has paid out: back at the floor, carrying over the
 * fraction of a coin that could not be paid so no slice is ever lost.
 */
export function jackpotPoolAfterWin(pool: number): number {
  const normalized = normalizeJackpotPool(pool);
  return normalizeJackpotPool(JACKPOT_FLOOR + normalized - jackpotPayableCoins(normalized));
}

export type WinTier = 'none' | 'big' | 'mega' | 'epic' | 'jackpot';

/** Win-to-total-bet ratios at which each banner fires. */
export const BIG_WIN_TIMES_BET = 10;
export const MEGA_WIN_TIMES_BET = 25;
export const EPIC_WIN_TIMES_BET = 50;

/** The banner a win earns against the bet it was won at; the jackpot outranks every ratio. */
export function winTierFor(totalWin: number, totalBet: number, jackpot: boolean): WinTier {
  if (jackpot) return 'jackpot';
  if (totalBet <= 0) return 'none';
  const ratio = totalWin / totalBet;
  if (ratio >= EPIC_WIN_TIMES_BET) return 'epic';
  if (ratio >= MEGA_WIN_TIMES_BET) return 'mega';
  if (ratio >= BIG_WIN_TIMES_BET) return 'big';
  return 'none';
}
