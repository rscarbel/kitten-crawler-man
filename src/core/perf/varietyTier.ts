/**
 * How much look variety the game can afford on this device, as one global
 * value read whenever something spawns or a crowd is generated.
 *
 * When a device cannot keep up — it lags, or the browser drops canvases — the
 * game spends variety before smoothness: fewer distinct enemy and townsfolk
 * looks means fewer frames to paint and cache. Fight difficulty is preserved.
 *
 * The tier only ever goes down during a session (its number only rises), so a
 * device that struggled once is never asked to carry the fuller set again.
 * `RenderQualityController` decides when to step; this module only holds the
 * value.
 */

export const FULL_VARIETY_TIER = 0;
export const SHARED_LOOKS_TIER = 1;
export const TRIMMED_VARIETY_TIER = 2;
export const LEAN_VARIETY_TIER = 3;
export const MINIMAL_VARIETY_TIER = 4;

export const VARIETY_TIERS = [
  FULL_VARIETY_TIER,
  SHARED_LOOKS_TIER,
  TRIMMED_VARIETY_TIER,
  LEAN_VARIETY_TIER,
  MINIMAL_VARIETY_TIER,
] as const;

/** `0` Full, `1` Shared looks, `2` Trimmed, `3` Lean, `4` Minimal. */
export type VarietyTier = (typeof VARIETY_TIERS)[number];

let tier: VarietyTier = FULL_VARIETY_TIER;

export function varietyTier(): VarietyTier {
  return tier;
}

/** Narrows an arbitrary number (a URL parameter, a harness argument) to a tier. */
export function asVarietyTier(value: number): VarietyTier | null {
  return VARIETY_TIERS.find((candidate) => candidate === value) ?? null;
}

/**
 * Moves the tier down to `target` unless it is already there or lower.
 * Returns whether the tier changed.
 */
export function lowerVarietyTierTo(target: VarietyTier): boolean {
  if (target <= tier) return false;
  tier = target;
  return true;
}

/** Takes the next tier down. Returns false when already at the minimal tier. */
export function stepVarietyTierDown(): boolean {
  const next = asVarietyTier(tier + 1);
  if (next === null) return false;
  tier = next;
  return true;
}

/**
 * Sets the tier outright, in either direction. Only for the `?variety=` dev
 * override and for harnesses that walk every tier in one process; live play
 * moves through {@link lowerVarietyTierTo} and {@link stepVarietyTierDown}.
 */
export function forceVarietyTier(target: VarietyTier): void {
  tier = target;
}
