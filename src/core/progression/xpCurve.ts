/**
 * Shared XP-threshold curve for any per-level progression that grows the same
 * way abilities do: a geometric ramp from level to level, with a steeper final
 * step so the last level feels earned.
 *
 * XP required to advance from level N → N+1:
 *   base * growthRate^(N-1),
 *   except the final level transition uses finalLevelMultiplier instead of growthRate.
 */

export const DEFAULT_XP_GROWTH_RATE = 1.3;
export const DEFAULT_FINAL_LEVEL_MULTIPLIER = 1.8;

/** XP needed to advance from `currentLevel` to the next, or Infinity at the ceiling. */
export function computeXpToNextLevel(
  currentLevel: number,
  base: number,
  growthRate: number,
  finalLevelMultiplier: number,
  maxLevel: number,
): number {
  if (currentLevel >= maxLevel) return Infinity;
  let xp = base;
  for (let i = 1; i < currentLevel; i++) {
    // The final transition (maxLevel-1 → maxLevel) uses its own multiplier.
    xp = i === maxLevel - 2 ? Math.round(xp * finalLevelMultiplier) : Math.round(xp * growthRate);
  }
  return xp;
}
