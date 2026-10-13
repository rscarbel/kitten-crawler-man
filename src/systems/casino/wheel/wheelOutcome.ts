import type { Rng } from '../../../sprites/person/rng';
import type { WheelBoard, WheelPrizeId, WheelWedge } from './wheelBoard';

export interface WheelOutcome {
  readonly wedgeIndex: number;
  readonly wedge: WheelWedge;
}

/**
 * Each wedge's pick weight: its units, or zero for a once-only prize already
 * won. A retired wedge stays on the rim looking exactly like any other, so the
 * red share quietly grows as prizes are claimed.
 */
export function outcomeWeights(board: WheelBoard, wonPrizes: ReadonlySet<WheelPrizeId>): number[] {
  return board.map((wedge) =>
    wedge.prizeId !== null && wonPrizes.has(wedge.prizeId) ? 0 : wedge.units,
  );
}

/**
 * Decides the spin before the wheel moves: a wedge picked by weight from
 * `outcomeWeights`. Red and Spin Again never retire, so there is always
 * something eligible.
 */
export function pickOutcome(
  board: WheelBoard,
  wonPrizes: ReadonlySet<WheelPrizeId>,
  rng: Rng,
): WheelOutcome {
  const weights = outcomeWeights(board, wonPrizes);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const roll = rng() * total;
  let reached = 0;
  let lastEligible = -1;
  for (let index = 0; index < board.length; index++) {
    if (weights[index] <= 0) continue;
    lastEligible = index;
    reached += weights[index];
    if (roll < reached) return { wedgeIndex: index, wedge: board[index] };
  }
  if (lastEligible < 0) throw new Error('wheel board has no eligible wedge');
  // Floating-point sums can leave a roll a hair past the last boundary.
  return { wedgeIndex: lastEligible, wedge: board[lastEligible] };
}
