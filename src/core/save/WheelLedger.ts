import { isFiniteNumber, isRecord, parseEvery } from '../util/guards';

/** Which crawler a wheel spin belongs to: the one active when it was spun. */
export type WheelCrawler = 'human' | 'cat';

/**
 * A spin already committed to the save but whose prize has not been handed
 * out yet. A tab closed mid-spin leaves one of these behind, and the next load
 * applies it and clears it, so reloading can never undo a spin.
 */
export interface PendingWheelOutcome {
  /** The wedge the wheel lands in. */
  wedgeId: string;
  /** The prize that wedge pays, or null for an outcome that pays no prize. */
  prizeId: string | null;
  crawler: WheelCrawler;
  /**
   * The crawler the prize goes to: the spinner, except a Legendary Weapon the
   * spinner already has, which pays the other crawler's weapon to them.
   */
  recipient: WheelCrawler;
  /** Coins staked on the spin, already taken from the crawler in the same save. */
  bet: number;
  /** The bet whose board the spin turned on, which a pending Spin Again's free spin keeps. */
  boardBet: number;
}

/**
 * Free spins quests hand out, and the taped chain one of them is playing. A
 * quest's free spin covers the minimum bet, skips the warnings and tapes over
 * Permanent Death, so the wipe cannot be drawn until the spin and every Spin Again
 * it chains into have landed.
 */
export interface WheelQuestFreeSpins {
  /** Every quest that has granted its free spin; a quest is never paid twice. */
  earnedBy: string[];
  /** How many of them have been spun, counted the moment a spin commits. */
  used: number;
  /**
   * A quest's free spin has committed and its chain has not resolved: the owed
   * Spin Again (or the pending outcome) still turns on the taped board.
   */
  tapedChain: boolean;
}

/**
 * What the Wheel of Fortune remembers about the run. Party state rather than
 * floor state, so it is threaded by reference through every scene like the
 * casino state, and saved as top-level fields that survive a floor change.
 */
export interface WheelLedger {
  /**
   * Every good prize the party has won; none of them is ever drawn again. Also
   * holds each crawler's Legendary Weapon claim, which retires no wedge alone.
   */
  prizesWon: string[];
  pendingOutcome: PendingWheelOutcome | null;
  /**
   * The bet whose board a landed Spin Again owes a free spin on, or null. Kept
   * across visits and reloads: the spin that earned it was paid for.
   */
  freeSpinBet: number | null;
  /**
   * The crawler a Get Frozen Solid landing still owes its freeze to: spent on
   * the club floor when the wheel screen closes, or on the next load if the
   * tab closes first.
   */
  owedFreeze: WheelCrawler | null;
  questFreeSpins: WheelQuestFreeSpins;
}

export function createWheelQuestFreeSpins(
  saved: Partial<WheelQuestFreeSpins> = {},
): WheelQuestFreeSpins {
  return {
    earnedBy: [...(saved.earnedBy ?? [])],
    used: saved.used ?? 0,
    tapedChain: saved.tapedChain ?? false,
  };
}

export function createWheelLedger(
  prizesWon: ReadonlyArray<string> = [],
  pendingOutcome: PendingWheelOutcome | null = null,
  freeSpinBet: number | null = null,
  owedFreeze: WheelCrawler | null = null,
  questFreeSpins: Partial<WheelQuestFreeSpins> = {},
): WheelLedger {
  return {
    prizesWon: [...prizesWon],
    pendingOutcome,
    freeSpinBet,
    owedFreeze,
    questFreeSpins: createWheelQuestFreeSpins(questFreeSpins),
  };
}

/** Quest free spins earned and not yet spun. */
export function questFreeSpinsLeft(ledger: WheelLedger): number {
  const spins = ledger.questFreeSpins;
  return Math.max(0, spins.earnedBy.length - spins.used);
}

/**
 * Grants `questId`'s free spin, once: a quest replayed after a death rewind
 * pays everything else again but never a second spin. Returns whether it paid.
 */
export function grantQuestFreeSpin(ledger: WheelLedger, questId: string): boolean {
  const earned = ledger.questFreeSpins.earnedBy;
  if (earned.includes(questId)) return false;
  earned.push(questId);
  return true;
}

/** A taped chain's owed Spin Again, still to be spun. */
export function tapedChainOwed(ledger: WheelLedger): boolean {
  return ledger.questFreeSpins.tapedChain && ledger.freeSpinBet !== null;
}

/** A saved quest free-spin record, or undefined when it is not one this build wrote. */
export function parseWheelQuestFreeSpins(raw: unknown): WheelQuestFreeSpins | undefined {
  if (!isRecord(raw)) return undefined;
  const { used, tapedChain } = raw;
  const earnedBy = parseEvery(raw.earnedBy, (entry) =>
    typeof entry === 'string' ? entry : undefined,
  );
  if (earnedBy === undefined || hasRepeats(earnedBy)) return undefined;
  const usedValid = typeof used === 'number' && Number.isInteger(used) && used >= 0;
  if (!usedValid || used > earnedBy.length || typeof tapedChain !== 'boolean') return undefined;
  return { earnedBy, used, tapedChain };
}

/** A saved free-spin bet: null for none, undefined when it is not a valid bet. */
export function parseWheelFreeSpinBet(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  return isFiniteNumber(raw) && raw > 0 ? raw : undefined;
}

/** A saved owed freeze: null for none, undefined when it names no crawler. */
export function parseWheelOwedFreeze(raw: unknown): WheelCrawler | null | undefined {
  if (raw === null) return null;
  return isWheelCrawler(raw) ? raw : undefined;
}

/** A saved won-prize list, or undefined when it holds a non-string or a repeat. */
export function parseWheelPrizesWon(raw: unknown): string[] | undefined {
  const prizes = parseEvery(raw, (entry) => (typeof entry === 'string' ? entry : undefined));
  if (prizes === undefined || hasRepeats(prizes)) return undefined;
  return prizes;
}

function hasRepeats(entries: readonly string[]): boolean {
  return new Set(entries).size !== entries.length;
}

function isWheelCrawler(value: unknown): value is WheelCrawler {
  return value === 'human' || value === 'cat';
}

/** A saved pending spin: null for none, undefined when it is not one this build wrote. */
export function parsePendingWheelOutcome(raw: unknown): PendingWheelOutcome | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const { wedgeId, prizeId, crawler, recipient, bet, boardBet } = raw;
  if (typeof wedgeId !== 'string') return undefined;
  if (prizeId !== null && typeof prizeId !== 'string') return undefined;
  if (!isWheelCrawler(crawler) || !isWheelCrawler(recipient)) return undefined;
  if (!isFiniteNumber(bet) || bet < 0 || !isFiniteNumber(boardBet) || boardBet <= 0) {
    return undefined;
  }
  return { wedgeId, prizeId, crawler, recipient, bet, boardBet };
}
