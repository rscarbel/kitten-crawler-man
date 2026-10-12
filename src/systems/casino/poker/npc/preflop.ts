/**
 * Starting-hand strength for all 169 hold'em classes (pairs, suited, offsuit),
 * as the share of dealt hands that are no stronger.
 */

import type { Card, Rank } from '../../Deck';
import { rankValue } from './boardRead';

/**
 * Strongest first. Ordered by Monte Carlo all-in equity against two random
 * hands (80,000 deals per class), the six-handed table's typical multiway pot.
 */
export const PREFLOP_RANKING = [
  'AA',
  'KK',
  'QQ',
  'JJ',
  'TT',
  '99',
  'AKs',
  '88',
  'AQs',
  'AJs',
  'AKo',
  'KQs',
  '77',
  'AQo',
  'ATs',
  'KJs',
  'AJo',
  'KTs',
  'KQo',
  'A9s',
  'ATo',
  'QJs',
  'A8s',
  '66',
  'KJo',
  'QTs',
  'K9s',
  'A7s',
  'KTo',
  'JTs',
  'A5s',
  'A9o',
  'QJo',
  'A6s',
  'Q9s',
  'A8o',
  'A4s',
  'QTo',
  'K8s',
  '55',
  'A3s',
  'J9s',
  'K7s',
  'JTo',
  'A7o',
  'K9o',
  'A2s',
  'T9s',
  'Q8s',
  'A5o',
  'K6s',
  'A6o',
  'Q9o',
  'K5s',
  'J8s',
  'A4o',
  'K8o',
  '44',
  'T8s',
  'K4s',
  'Q7s',
  'J9o',
  'A3o',
  'K7o',
  '98s',
  'Q6s',
  'Q8o',
  'K3s',
  'T9o',
  'J7s',
  'A2o',
  'K2s',
  'K6o',
  'Q5s',
  'T7s',
  'Q4s',
  '97s',
  'J8o',
  '33',
  'K5o',
  '87s',
  'J6s',
  'Q3s',
  'Q7o',
  'T8o',
  'K4o',
  '98o',
  'Q2s',
  'T6s',
  'Q6o',
  'J5s',
  'J7o',
  'K3o',
  '86s',
  'J4s',
  '76s',
  '96s',
  'Q5o',
  'J3s',
  'K2o',
  'T7o',
  'T5s',
  '97o',
  '22',
  'J2s',
  'Q4o',
  '95s',
  '75s',
  'J6o',
  '85s',
  '65s',
  '87o',
  'T4s',
  'Q3o',
  'T3s',
  'J5o',
  'T6o',
  '54s',
  'Q2o',
  '64s',
  '76o',
  'T2s',
  'J4o',
  '74s',
  '96o',
  '86o',
  '94s',
  '93s',
  '84s',
  '53s',
  'J3o',
  '92s',
  'T5o',
  '65o',
  '75o',
  'J2o',
  '63s',
  '85o',
  '43s',
  '73s',
  '83s',
  'T4o',
  '95o',
  '82s',
  'T3o',
  '52s',
  '54o',
  '72s',
  '42s',
  'T2o',
  '74o',
  '62s',
  '64o',
  '94o',
  '84o',
  '93o',
  '32s',
  '53o',
  '92o',
  '63o',
  '73o',
  '43o',
  '83o',
  '82o',
  '52o',
  '62o',
  '42o',
  '72o',
  '32o',
] as const;
export type HandClass = (typeof PREFLOP_RANKING)[number];

const PAIR_COMBOS = 6;
const SUITED_COMBOS = 4;
const OFFSUIT_COMBOS = 12;
const TOTAL_COMBOS = 1326;

const CLASS_LETTER: Readonly<Record<Rank, string>> = {
  A: 'A',
  K: 'K',
  Q: 'Q',
  J: 'J',
  '10': 'T',
  '9': '9',
  '8': '8',
  '7': '7',
  '6': '6',
  '5': '5',
  '4': '4',
  '3': '3',
  '2': '2',
};

function combosIn(handClass: HandClass): number {
  if (handClass.endsWith('s')) return SUITED_COMBOS;
  if (handClass.endsWith('o')) return OFFSUIT_COMBOS;
  return PAIR_COMBOS;
}

interface ClassShare {
  /** Share of all 1,326 starting combos strictly stronger than this class. */
  readonly stronger: number;
  /** Share of all 1,326 starting combos that belong to this class. */
  readonly own: number;
}

const CLASS_SHARES: ReadonlyMap<string, ClassShare> = (() => {
  const shares = new Map<string, ClassShare>();
  let stronger = 0;
  for (const handClass of PREFLOP_RANKING) {
    const combos = combosIn(handClass);
    shares.set(handClass, { stronger: stronger / TOTAL_COMBOS, own: combos / TOTAL_COMBOS });
    stronger += combos;
  }
  return shares;
})();

const UNRANKED: ClassShare = { stronger: 1, own: 0 };

/** The class name of two hole cards, e.g. `AKs`, `T9o`, `77`. */
export function handClassOf(first: Card, second: Card): string {
  const firstIsHigher = rankValue(first.rank) >= rankValue(second.rank);
  const high = firstIsHigher ? first : second;
  const low = firstIsHigher ? second : first;
  const letters = `${CLASS_LETTER[high.rank]}${CLASS_LETTER[low.rank]}`;
  if (high.rank === low.rank) return letters;
  return `${letters}${high.suit === low.suit ? 's' : 'o'}`;
}

function shareOf(first: Card, second: Card): ClassShare {
  return CLASS_SHARES.get(handClassOf(first, second)) ?? UNRANKED;
}

/**
 * The share of starting hands at least as strong as this one: about 0.005 for
 * aces, 1 for the very worst. A "top 15%" range is every hand with a value of
 * 0.15 or less.
 */
export function preflopTopFraction(first: Card, second: Card): number {
  const share = shareOf(first, second);
  return share.stronger + share.own;
}

/** Starting-hand strength in [0, 1]: 1 for aces, near 0 for seven-deuce offsuit. */
export function preflopStrength(first: Card, second: Card): number {
  return 1 - shareOf(first, second).stronger;
}
