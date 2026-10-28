/**
 * The slot machine's symbols and what a line of them pays.
 *
 * Every pay is a multiple of the coin value per line, so a pay reads the same
 * at every rung of the bet ladder. `npm run report:slots-rtp` prints the
 * return to player this table adds up to.
 */

/** Paying symbols, low to high. */
export const PAYING_SYMBOLS = [
  'cherries',
  'lemon',
  'bell',
  'bar',
  'deinonychus',
  'tiara',
  'boots',
  'seven',
] as const;

export type PayingSymbol = (typeof PAYING_SYMBOLS)[number];

/** The gold dagger seal: stands in for every symbol but the scatter. */
export const WILD = 'wild';
/** The glowing loot box: pays anywhere on the glass, not along a line. */
export const SCATTER = 'scatter';

export const SLOT_SYMBOLS = [...PAYING_SYMBOLS, WILD, SCATTER] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

/** A line pays for 3, 4 or 5 matching symbols counted from the leftmost reel. */
export const MIN_LINE_MATCH = 3;
const FOUR_OF_A_KIND = 4;
const FIVE_OF_A_KIND = 5;

/** Line pays in coins per coin bet on the line, for a run of 3, 4 and 5. */
export interface LinePay {
  readonly three: number;
  readonly four: number;
  readonly five: number;
}

export const LINE_PAYS: Readonly<Record<PayingSymbol | typeof WILD, LinePay>> = {
  cherries: { three: 12, four: 30, five: 75 },
  lemon: { three: 12, four: 30, five: 75 },
  bell: { three: 18, four: 45, five: 125 },
  bar: { three: 22, four: 60, five: 150 },
  deinonychus: { three: 30, four: 100, five: 250 },
  tiara: { three: 40, four: 125, five: 400 },
  boots: { three: 50, four: 200, five: 600 },
  seven: { three: 75, four: 300, five: 1250 },
  wild: { three: 125, four: 500, five: 2000 },
};

/** What a run of `count` matching symbols pays per coin on the line; zero below three. */
export function linePayFor(symbol: PayingSymbol | typeof WILD, count: number): number {
  const pays = LINE_PAYS[symbol];
  if (count >= FIVE_OF_A_KIND) return pays.five;
  if (count === FOUR_OF_A_KIND) return pays.four;
  if (count === MIN_LINE_MATCH) return pays.three;
  return 0;
}

/** Scatters anywhere on the glass that trigger the free-spin feature. */
export const SCATTER_TRIGGER_COUNT = 3;
/** Free spins awarded by each trigger, including a re-trigger inside the feature. */
export const FREE_SPINS_PER_TRIGGER = 10;

/** Scatter pays in multiples of the whole bet, paid alongside the free spins. */
const SCATTER_PAY_THREE = 2;
const SCATTER_PAY_FOUR = 10;
const SCATTER_PAY_FIVE = 50;

/** What `count` scatters pay, as a multiple of the total bet; zero below the trigger. */
export function scatterPayFor(count: number): number {
  if (count >= FIVE_OF_A_KIND) return SCATTER_PAY_FIVE;
  if (count === FOUR_OF_A_KIND) return SCATTER_PAY_FOUR;
  if (count === SCATTER_TRIGGER_COUNT) return SCATTER_PAY_THREE;
  return 0;
}

/**
 * Symbols whose near miss is worth a shimmer: missing a fifth cherry is not a
 * moment, missing a fifth golden 7 is.
 */
export const NEAR_MISS_SYMBOLS: ReadonlySet<PayingSymbol | typeof WILD> = new Set([
  'tiara',
  'boots',
  'seven',
  WILD,
]);

export function isPayingSymbol(symbol: SlotSymbol): symbol is PayingSymbol {
  return symbol !== WILD && symbol !== SCATTER;
}
