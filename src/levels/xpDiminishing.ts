/**
 * One step of a floor's diminishing-returns curve: once the character is at
 * least `minPlayerLevel`, XP earned on that floor buys levels at `multiplier`
 * of its face value.
 */
export interface XpDiminishingTier {
  /** Inclusive character level at which this tier takes over. */
  minPlayerLevel: number;
  /** Fraction of the normal award, 0–1. */
  multiplier: number;
}

/** Applied when no tier matches, or when a floor declares no curve at all. */
const FULL_XP_MULTIPLIER = 1;

/**
 * The XP multiplier a character of `playerLevel` earns on a floor with `tiers`.
 *
 * The highest qualifying tier wins, so the tiers may be declared in any order.
 * Grinding an early floor past its curve is meant to feel like nothing changed —
 * nothing surfaces this to the player.
 */
export function xpMultiplierForPlayerLevel(
  tiers: readonly XpDiminishingTier[] | undefined,
  playerLevel: number,
): number {
  if (tiers === undefined) return FULL_XP_MULTIPLIER;
  let multiplier = FULL_XP_MULTIPLIER;
  let matchedLevel = -Infinity;
  for (const tier of tiers) {
    if (playerLevel >= tier.minPlayerLevel && tier.minPlayerLevel > matchedLevel) {
      matchedLevel = tier.minPlayerLevel;
      multiplier = tier.multiplier;
    }
  }
  return multiplier;
}
