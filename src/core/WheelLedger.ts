import { isRecord } from './guards';
import { isItemId, type ItemId } from './ItemDefs';

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
 * A prize item a save may hold for a crawler outside the bag. The wheel itself
 * never adds one and saves never write them; one read from a save is put in
 * the crawler's bag when the ledger is settled on load.
 */
export interface OwedWheelItem {
  crawler: WheelCrawler;
  id: ItemId;
  quantity: number;
}

/**
 * What the Wheel of Fortune remembers about the run. Party state rather than
 * floor state, so it is threaded by reference through every scene like the
 * club membership, and saved as top-level fields that survive a floor change.
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
  /** Prize items read from a save, emptied into the bags when the ledger is settled. */
  owedItems: OwedWheelItem[];
}

export function createWheelLedger(
  prizesWon: ReadonlyArray<string> = [],
  pendingOutcome: PendingWheelOutcome | null = null,
  freeSpinBet: number | null = null,
  owedFreeze: WheelCrawler | null = null,
  owedItems: ReadonlyArray<OwedWheelItem> = [],
): WheelLedger {
  return {
    prizesWon: [...prizesWon],
    pendingOutcome,
    freeSpinBet,
    owedFreeze,
    owedItems: owedItems.map((item) => ({ ...item })),
  };
}

/** Saved owed items, screened: anything that is not a known item for a known crawler is dropped. */
export function parseWheelOwedItems(raw: unknown): OwedWheelItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: OwedWheelItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { crawler, id, quantity } = entry;
    if (!isWheelCrawler(crawler) || typeof id !== 'string' || !isItemId(id)) continue;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) continue;
    items.push({ crawler, id, quantity });
  }
  return items;
}

/** A saved free-spin bet, or null when there is none or it cannot be trusted. */
export function parseWheelFreeSpinBet(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** A saved owed freeze, or null when there is none or it cannot be trusted. */
export function parseWheelOwedFreeze(raw: unknown): WheelCrawler | null | undefined {
  if (raw === undefined) return undefined;
  return isWheelCrawler(raw) ? raw : null;
}

/** A saved won-prize list, screened: non-strings and repeats are dropped. */
export function parseWheelPrizesWon(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const prizes = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === 'string') prizes.add(entry);
  }
  return [...prizes];
}

function isWheelCrawler(value: unknown): value is WheelCrawler {
  return value === 'human' || value === 'cat';
}

/** A saved pending spin, or null when there is none or it cannot be trusted. */
export function parsePendingWheelOutcome(raw: unknown): PendingWheelOutcome | null | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) return null;
  const { wedgeId, prizeId, crawler, recipient, bet, boardBet } = raw;
  if (typeof wedgeId !== 'string') return null;
  if (prizeId !== null && typeof prizeId !== 'string') return null;
  if (!isWheelCrawler(crawler)) return null;
  if (typeof bet !== 'number' || !Number.isFinite(bet) || bet < 0) return null;
  // A free spin stakes nothing, so a save without the board's bet falls back to the stake.
  const board =
    typeof boardBet === 'number' && Number.isFinite(boardBet) && boardBet > 0 ? boardBet : bet;
  // A save written without a recipient paid every prize to the spinner.
  const paid = isWheelCrawler(recipient) ? recipient : crawler;
  return { wedgeId, prizeId, crawler, recipient: paid, bet, boardBet: board };
}
