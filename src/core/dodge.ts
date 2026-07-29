/**
 * Dexterity → dodge chance.
 *
 * The curve is deliberately diminishing: each extra point of dexterity is worth
 * less than the last, so stacking gear can't trivialise combat. A hard ceiling
 * sits on top of even that, which is what lets flat bonuses (Cat-like Reflexes)
 * exist without ever reaching a state where nothing can hit you.
 */

/** Dexterity at which the curve alone yields a 50% dodge chance. */
export const DODGE_HALF_POINT = 20;

/** No amount of dexterity, gear, or skill can push dodge past this. */
export const DODGE_CHANCE_CAP = 0.6;

/**
 * Probability in [0, DODGE_CHANCE_CAP] that an incoming mob attack misses.
 *
 * @param dexterity Effective dexterity of the defender.
 * @param flatBonus Additive chance from skills, applied after the curve and
 *   before the cap.
 */
export function computeDodgeChance(dexterity: number, flatBonus = 0): number {
  const effectiveDexterity = Math.max(0, dexterity);
  const curved = effectiveDexterity / (effectiveDexterity + DODGE_HALF_POINT);
  return Math.min(DODGE_CHANCE_CAP, Math.max(0, curved + flatBonus));
}
