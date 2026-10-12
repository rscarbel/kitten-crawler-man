/**
 * Main and side pots, and how they are split.
 *
 * Pure functions over per-seat contributions, so every all-in arrangement can be
 * checked headless. Amounts are whole coins throughout; a split that does not
 * divide evenly hands the leftover out one smallest chip at a time, starting from the
 * first winner clockwise of the button.
 */

export interface Pot {
  readonly amount: number;
  /** Seats that can win this pot, ascending. */
  readonly eligibleSeats: ReadonlyArray<number>;
}

export interface PotAward {
  readonly potIndex: number;
  readonly amount: number;
  readonly winners: ReadonlyArray<number>;
  /** Coins each winner takes from this pot, parallel to `winners`. */
  readonly amounts: ReadonlyArray<number>;
}

export interface PotResult {
  readonly awards: ReadonlyArray<PotAward>;
  /** Total coins each seat collects, indexed by seat. */
  readonly perSeat: ReadonlyArray<number>;
}

/**
 * Splits the hand's contributions into a main pot and side pots.
 *
 * Each pot's ceiling is one live seat's total contribution, so a seat is
 * eligible for exactly the pots it matched. Folded seats' chips stay in the
 * pots they reached but make them eligible for nothing.
 */
export function buildPots(
  contributions: ReadonlyArray<number>,
  folded: ReadonlyArray<boolean>,
): Pot[] {
  const liveLevels = [
    ...new Set(contributions.filter((amount, seat) => !folded[seat] && amount > 0)),
  ].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previousLevel = 0;
  for (const level of liveLevels) {
    let amount = 0;
    for (const contributed of contributions) {
      amount += Math.min(contributed, level) - Math.min(contributed, previousLevel);
    }
    const eligibleSeats = contributions
      .map((contributed, seat) => ({ contributed, seat }))
      .filter(({ contributed, seat }) => !folded[seat] && contributed >= level)
      .map(({ seat }) => seat);
    pots.push({ amount, eligibleSeats });
    previousLevel = level;
  }

  // Folded chips above every live seat's total can only exist when an uncalled
  // bet was not returned; they still belong in the pot rather than vanishing.
  const stranded = contributions.reduce(
    (sum, contributed) => sum + Math.max(0, contributed - previousLevel),
    0,
  );
  if (stranded > 0) {
    const last = pots.pop();
    pots.push(
      last === undefined
        ? { amount: stranded, eligibleSeats: [] }
        : { amount: last.amount + stranded, eligibleSeats: last.eligibleSeats },
    );
  }
  return pots;
}

/** Seats ordered clockwise starting from the seat after the button. */
export function clockwiseFromButton(buttonSeat: number, seatCount: number): number[] {
  return Array.from({ length: seatCount }, (_, offset) => (buttonSeat + 1 + offset) % seatCount);
}

/**
 * Awards every pot to its best eligible hand(s).
 *
 * `showdownRanks[seat]` is that seat's hand value, or `null` when the seat holds
 * no claim (folded, or not shown because the pot was uncontested). A pot with
 * a single eligible seat goes to it without comparing anything.
 *
 * A split is made in `chipUnit`s, the table's smallest chip, because the felt
 * cannot hand out a fraction of one. What does not divide goes out a chip at a
 * time clockwise from the button, and a remainder smaller than a chip goes to
 * the next winner in that order, so every coin is still awarded.
 */
export function awardPots(
  pots: ReadonlyArray<Pot>,
  showdownRanks: ReadonlyArray<number | null>,
  buttonSeat: number,
  chipUnit = 1,
): PotResult {
  const seatCount = showdownRanks.length;
  const perSeat = new Array<number>(seatCount).fill(0);
  const order = clockwiseFromButton(buttonSeat, seatCount);
  const awards: PotAward[] = [];

  pots.forEach((pot, potIndex) => {
    const winners = winnersOf(pot, showdownRanks, order);
    if (winners.length === 0) return;
    const share = Math.floor(pot.amount / (winners.length * chipUnit)) * chipUnit;
    const amounts = winners.map(() => share);
    let leftover = pot.amount - share * winners.length;
    for (let i = 0; leftover > 0; i++) {
      const chip = Math.min(chipUnit, leftover);
      amounts[i % winners.length] += chip;
      leftover -= chip;
    }
    winners.forEach((seat, i) => {
      perSeat[seat] += amounts[i];
    });
    awards.push({ potIndex, amount: pot.amount, winners, amounts });
  });

  return { awards, perSeat };
}

/** The pot's winning seats, ordered clockwise from the button so the odd chip lands right. */
function winnersOf(
  pot: Pot,
  showdownRanks: ReadonlyArray<number | null>,
  clockwiseOrder: ReadonlyArray<number>,
): number[] {
  const eligible = clockwiseOrder.filter((seat) => pot.eligibleSeats.includes(seat));
  if (eligible.length <= 1) return eligible;
  let best = -1;
  for (const seat of eligible) best = Math.max(best, showdownRanks[seat] ?? -1);
  if (best < 0) return [];
  return eligible.filter((seat) => showdownRanks[seat] === best);
}
