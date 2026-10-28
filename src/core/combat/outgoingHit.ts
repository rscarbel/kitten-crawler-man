/**
 * The one door a crawler's hit passes through on its way out. The stat the
 * hit's delivery grows with is already in the blow it is handed (each
 * delivery's formula in `crawlerFormulas.ts`, chosen by `DELIVERY_STAT`); here
 * every proficiency skill whose tags the hit carries adds its share, and the
 * hit counts as a use of each.
 */

import type { Player } from '../../Player';
import type { DamageTags } from './damageTags';
import {
  BLAST_WARD_SKILL,
  PROFICIENCY_SKILL_IDS,
  proficiencyBoosts,
  proficiencyEffect,
  type ProficiencySkillId,
} from '../skills/proficiency';

/** What the door reads off the crawler landing the hit. */
export type HitDealer = Pick<Player, 'skills' | 'effectiveSkillLevel'>;

/** What a proficiency skill is worth to `dealer` right now, trained levels and worn ones together. */
function proficiencyEffectFor(dealer: HitDealer, skill: ProficiencySkillId): number {
  return proficiencyEffect(dealer.effectiveSkillLevel(skill));
}

/**
 * The fraction every proficiency skill boosting a hit tagged `tags` adds to
 * it. Skills add: a hit carrying two skills' tags gets both shares.
 */
export function proficiencyDamageBonus(dealer: HitDealer, tags: DamageTags): number {
  let bonus = 0;
  for (const skill of PROFICIENCY_SKILL_IDS) {
    if (proficiencyBoosts(skill, tags)) bonus += proficiencyEffectFor(dealer, skill);
  }
  return bonus;
}

/** Whether the hit trains the skills it carries: a target that earns nothing trains nothing. */
export type HitTraining = 'trains' | 'trainsNothing';

/**
 * What a hit worth `damage` lands for once `dealer`'s proficiency skills have
 * weighed in, crediting a use to every one it carries when it `trains`.
 *
 * Damage lands in whole points, so the bonus is paid in whole points too.
 * Rounding it instead would make the first dozen levels worth nothing on a
 * small blow. A blow no skill boosts is returned untouched.
 */
export function outgoingHitDamage(
  dealer: HitDealer,
  damage: number,
  tags: DamageTags,
  training: HitTraining,
  roll: () => number = Math.random,
): number {
  if (training === 'trains') {
    for (const skill of PROFICIENCY_SKILL_IDS) {
      if (proficiencyBoosts(skill, tags)) dealer.skills.recordUse(skill);
    }
  }
  const bonus = proficiencyDamageBonus(dealer, tags);
  if (bonus <= 0 || damage <= 0) return damage;
  return damage + inWholePoints(damage * bonus, roll);
}

/** `points` as whole points, the fraction left over paid as one more point that often. */
function inWholePoints(points: number, roll: () => number): number {
  const whole = Math.floor(points);
  return whole + (roll() < points - whole ? 1 : 0);
}

/**
 * `amount` of harm, softened by `skill` as `bearer` has it: Pyro's Touch on a
 * burn's length, Demolitionist on a friendly blast.
 */
export function proficiencyWardedAmount(
  bearer: HitDealer,
  skill: ProficiencySkillId,
  amount: number,
): number {
  return amount * (1 - proficiencyEffectFor(bearer, skill));
}

/**
 * What a blast `thrower` set off does to a crawler caught in it, either of
 * them: softened by the thrower's Demolitionist, in whole points.
 */
export function friendlyBlastDamage(
  thrower: HitDealer,
  damage: number,
  roll: () => number = Math.random,
): number {
  return inWholePoints(proficiencyWardedAmount(thrower, BLAST_WARD_SKILL, damage), roll);
}

/**
 * {@link outgoingHitDamage} for a hit landing on `target`, which trains the
 * dealer's skills unless the target is one whose blows earn nothing.
 */
export function outgoingHitDamageOn(
  dealer: HitDealer,
  target: Pick<Player, 'blowsEarnNothing'>,
  damage: number,
  tags: DamageTags,
): number {
  const training: HitTraining = target.blowsEarnNothing ? 'trainsNothing' : 'trains';
  return outgoingHitDamage(dealer, damage, tags, training);
}
