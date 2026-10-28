/**
 * Evasiveness → dodge chance.
 *
 * Evasiveness approaches a per-crawler soft limit: each point is worth less
 * than the last, and points past about a hundred spent return very little.
 * Flat bonuses (gear, Cat-like Reflexes) land after the curve, so gear can
 * carry a crawler past her soft limit — but never past the hard ceiling,
 * which is what keeps anything able to hit her at all.
 */

import type { CrawlerKind } from '../skills/SkillManager';

/** The dodge chance each crawler's evasiveness approaches but never reaches on its own. */
export const DODGE_SOFT_LIMIT = { human: 0.45, cat: 0.65 } as const satisfies Record<
  CrawlerKind,
  number
>;

/** Share of the soft limit evasiveness of {@link EVASIVENESS_FOR_NEAR_LIMIT} reaches. */
const NEAR_LIMIT_SHARE = 0.95;
/** Evasiveness at which the curve reaches {@link NEAR_LIMIT_SHARE} of the soft limit. */
const EVASIVENESS_FOR_NEAR_LIMIT = 100;
/**
 * The curve's e-folding length: 100 points of evasiveness (100 spent points for
 * the human, 50 for Belle) reach 95% of the soft limit.
 */
const EVASIVENESS_DODGE_SCALE = EVASIVENESS_FOR_NEAR_LIMIT / -Math.log(1 - NEAR_LIMIT_SHARE);

/**
 * No amount of evasiveness, gear, or skill can push dodge past this. Above the
 * cat's soft limit, so gear can still carry her past it.
 */
const DODGE_CHANCE_CAP = 0.75;

/**
 * Probability in [0, DODGE_CHANCE_CAP] that an incoming mob attack misses.
 *
 * @param crawler Whose soft limit the evasiveness approaches.
 * @param evasiveness Effective evasiveness of the defender.
 * @param flatBonus Additive chance from gear and skills, applied after the
 *   curve and before the cap.
 */
export function computeDodgeChance(
  crawler: CrawlerKind,
  evasiveness: number,
  flatBonus = 0,
): number {
  const effectiveEvasiveness = Math.max(0, evasiveness);
  const curved =
    DODGE_SOFT_LIMIT[crawler] * (1 - Math.exp(-effectiveEvasiveness / EVASIVENESS_DODGE_SCALE));
  return Math.min(DODGE_CHANCE_CAP, Math.max(0, curved + flatBonus));
}
