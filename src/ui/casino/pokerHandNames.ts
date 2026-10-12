/**
 * A showdown hand's name, cut to what fits beside a seat: its kind, then
 * what decides it, each short enough for the space the table keeps for it.
 */

const SEPARATOR = ', ';
/** The padding either side of a hand name inside its pill, in UI units. */
export const HAND_NAME_PAD = 4;
/** Lines a hand's name takes at most: its kind, then what decides it. */
export const HAND_NAME_MAX_LINES = 2;
/**
 * A full house's pair, written short: two full houses on the same trips
 * (a board of K K K, or K K x) are told apart by it alone.
 */
const FULL_OF_PAIR = / full of (\w+)$/;

/**
 * The name as up to two lines: "Two Pair" over "Aces & Sevens", "Full House"
 * over "Kings full of 7s". A name with nothing after its kind ("Pair of Kings",
 * "Ace high") is one line. The second line alone still tells two hands of a
 * kind apart.
 */
export function handNameLines(label: string): readonly [string] | readonly [string, string] {
  const comma = label.indexOf(SEPARATOR);
  if (comma < 0) return [label];
  const kind = label.slice(0, comma);
  const decider = label
    .slice(comma + SEPARATOR.length)
    .split(' and ')
    .join(' & ')
    .replace(FULL_OF_PAIR, (_, pair: string) => ` full of ${shorthand(pair)}`);
  return [kind, decider];
}

/**
 * Rank words as a card table writes them in a hurry: numbers for the pip
 * ranks, letters for the court. Aces keep their word; "As" reads as a word.
 */
const RANK_SHORTHAND: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bKings\b/g, 'Ks'],
  [/\bQueens\b/g, 'Qs'],
  [/\bJacks\b/g, 'Js'],
  [/\bTens\b/g, '10s'],
  [/\bNines\b/g, '9s'],
  [/\bEights\b/g, '8s'],
  [/\bSevens\b/g, '7s'],
  [/\bSixes\b/g, '6s'],
  [/\bFives\b/g, '5s'],
  [/\bFours\b/g, '4s'],
  [/\bThrees\b/g, '3s'],
  [/\bTwos\b/g, '2s'],
  [/\bKing\b/g, 'K'],
  [/\bQueen\b/g, 'Q'],
  [/\bJack\b/g, 'J'],
  [/\bTen\b/g, '10'],
  [/\bNine\b/g, '9'],
  [/\bEight\b/g, '8'],
  [/\bSeven\b/g, '7'],
  [/\bSix\b/g, '6'],
  [/\bFive\b/g, '5'],
  [/\bFour\b/g, '4'],
  [/\bThree\b/g, '3'],
  [/\bTwo\b/g, '2'],
];

/** One-line forms by kind, from what decides the hand once in shorthand. */
const SHORT_BY_KIND: Partial<Readonly<Record<string, (decider: string) => string>>> = {
  'Two Pair': (decider) => decider,
  'Three of a Kind': (decider) => `Trip ${decider}`,
  'Four of a Kind': (decider) => `Quad ${decider}`,
  'Full House': (decider) => decider,
  Flush: (decider) => `${highCard(decider)}-high flush`,
  Straight: (decider) => `${highCard(decider)}-high straight`,
  'Straight Flush': (decider) => `${highCard(decider)}-high SF`,
};
const HIGH = / high$/;

/** "Ace high" → "A": the card a flush or straight is named for, as one character or two. */
function highCard(decider: string): string {
  const card = decider.replace(HIGH, '');
  return card === 'Ace' ? 'A' : card;
}

function shorthand(line: string): string {
  return RANK_SHORTHAND.reduce((text, [word, short]) => text.replace(word, short), line);
}

/**
 * The one line a name keeps when there is room for no more, in card
 * shorthand: "7s & 3s", "Ks full of 7s", "Trip 10s", "A-high flush", "Pair of Qs".
 * Two hands of a kind still read apart in the narrowest box.
 */
export function handNameShortLine(label: string): string {
  const lines = handNameLines(label);
  if (lines.length === 1) return shorthand(lines[0]);
  const [kind, decider] = lines;
  const form = SHORT_BY_KIND[kind];
  return form === undefined ? shorthand(decider) : form(shorthand(decider));
}
