/**
 * The behaviours a levelled mob can learn, and how likely a mob of a given level
 * is to have learned each one.
 *
 * Pure and side-effect-free so `scripts/verify-tactics.ts` can assert against
 * the real table and the real roll rather than a copy of either.
 */

import type { Rng } from '../../sprites/person/rng';

/**
 * Every trait, in the order they are rolled. A trait that needs another (see
 * {@link TraitRamp.requires}) must come after it, so the prerequisite has
 * already been decided by the time the dependent one is considered.
 */
export const TACTICS_TRAITS = ['flank', 'block', 'kite', 'regroup', 'riposte'] as const;

export type TacticsTrait = (typeof TACTICS_TRAITS)[number];

/** How one trait's chance grows with mob level. */
export interface TraitRamp {
  /** The first mob level at which the trait can be rolled at all. */
  readonly unlockLevel: number;
  /** Chance, 0–1, at exactly {@link unlockLevel}. */
  readonly chanceAtUnlock: number;
  /** Chance added for every level past {@link unlockLevel}. */
  readonly chancePerLevel: number;
  /** Hard ceiling on the chance, applied after the difficulty scale. */
  readonly maxChance: number;
  /** A trait this one only makes sense on top of. */
  readonly requires?: TacticsTrait;
}

/**
 * Below this mob level no trait is ever rolled, whatever the table says.
 *
 * The early game is tuned around mobs that stand and trade blows, so this is a
 * floor under the table rather than a consequence of it: retuning one trait's
 * unlock level downward must not be able to reach the first floor.
 */
export const TACTICS_MIN_MOB_LEVEL = 5;

/**
 * The per-trait unlock and chance ramps. Chances are per mob for every trait but `block`, whose chance
 * is also the per-blow chance to turn a hit aside.
 *
 * Unlock levels are packed one per level into the narrow range ambient mobs are
 * actually met at. Each floor's spawn bands clamp its rooms, hallways and camps
 * to a few levels past the minimum, and an on-schedule party meets nearly every
 * mob at the top of its floor's band. Spread wider, the later traits would only
 * ever appear on party-levelled bounty escorts, never on a floor. Packed this
 * way, the second floor's band reaches the first few traits and the third
 * floor's reaches all of them; `verify:tactics` asserts every unlock is met by a
 * shipped ambient spawn that can learn the trait.
 *
 * Because the second floor is the middle of the game, not its end, chances at
 * unlock are kept low and grow slowly, so a mob there is only occasionally
 * clever, and the caps are reached only near the top level, by party-levelled
 * encounters rather than floor mobs.
 */
export const TRAIT_RAMPS: Record<TacticsTrait, TraitRamp> = {
  flank: {
    unlockLevel: TACTICS_MIN_MOB_LEVEL,
    chanceAtUnlock: 0.15,
    chancePerLevel: 0.04,
    maxChance: 0.7,
  },
  block: { unlockLevel: 6, chanceAtUnlock: 0.1, chancePerLevel: 0.015, maxChance: 0.3 },
  kite: { unlockLevel: 7, chanceAtUnlock: 0.12, chancePerLevel: 0.025, maxChance: 0.45 },
  regroup: { unlockLevel: 8, chanceAtUnlock: 0.12, chancePerLevel: 0.025, maxChance: 0.4 },
  riposte: {
    unlockLevel: 9,
    chanceAtUnlock: 0.2,
    chancePerLevel: 0.035,
    maxChance: 0.6,
    requires: 'block',
  },
};

/**
 * The chance a mob of `level` has `trait`, under a difficulty profile's
 * `tacticsChanceScale`. Zero below the trait's unlock level and below
 * {@link TACTICS_MIN_MOB_LEVEL}; never above the trait's `maxChance`.
 */
export function traitChance(trait: TacticsTrait, level: number, chanceScale: number): number {
  const ramp = TRAIT_RAMPS[trait];
  if (level < TACTICS_MIN_MOB_LEVEL || level < ramp.unlockLevel) return 0;
  const levelsPastUnlock = level - ramp.unlockLevel;
  const unscaled = ramp.chanceAtUnlock + ramp.chancePerLevel * levelsPastUnlock;
  return Math.min(ramp.maxChance, Math.max(0, unscaled * chanceScale));
}

/**
 * Decide which of `eligibility` a mob of `level` has.
 *
 * Draws from `rng` only for a trait with a non-zero chance, so a mob below
 * every unlock level consumes nothing from the stream — spawning one leaves
 * the rest of a seeded run's rolls exactly where they were.
 */
export function rollTacticsTraits(
  level: number,
  eligibility: readonly TacticsTrait[],
  chanceScale: number,
  rng: Rng,
): TacticsTrait[] {
  const rolled: TacticsTrait[] = [];
  for (const trait of TACTICS_TRAITS) {
    if (!eligibility.includes(trait)) continue;
    const prerequisite = TRAIT_RAMPS[trait].requires;
    if (prerequisite !== undefined && !rolled.includes(prerequisite)) continue;
    const chance = traitChance(trait, level, chanceScale);
    if (chance <= 0) continue;
    if (rng() < chance) rolled.push(trait);
  }
  return rolled;
}
