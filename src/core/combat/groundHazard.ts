/**
 * What the floor itself hurts a body with for standing on it: current running
 * through a charged puddle or along the floor, and pooled acid. A damage
 * source names its ground hazard so `Player.incomingDamage` can thin it by the
 * share worn gear lets through, for every caller at once.
 */
export type GroundHazard = 'electricity' | 'acid';

export const ALL_GROUND_HAZARDS = [
  'electricity',
  'acid',
] as const satisfies readonly GroundHazard[];

/** Narrows a stored value to a {@link GroundHazard}. */
export function isGroundHazard(value: unknown): value is GroundHazard {
  return ALL_GROUND_HAZARDS.some((hazard) => hazard === value);
}

/** The share of each ground hazard's damage that reaches a body. */
export type GroundHazardShares = Readonly<Record<GroundHazard, number>>;

/** Every ground hazard landing in full. */
export const FULL_GROUND_HAZARD_SHARES: GroundHazardShares = { electricity: 1, acid: 1 };

/** {@link FULL_GROUND_HAZARD_SHARES} with `hazard` cut to `share`. */
export function groundHazardSharesWith(hazard: GroundHazard, share: number): GroundHazardShares {
  const shares: Record<GroundHazard, number> = { ...FULL_GROUND_HAZARD_SHARES };
  shares[hazard] = share;
  return shares;
}

/** Two sets of shares worn together: each hazard's shares multiply. */
export function combineGroundHazardShares(
  a: GroundHazardShares,
  b: GroundHazardShares,
): GroundHazardShares {
  const shares: Record<GroundHazard, number> = { ...a };
  for (const hazard of ALL_GROUND_HAZARDS) shares[hazard] = a[hazard] * b[hazard];
  return shares;
}
