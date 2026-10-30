/**
 * The one door a crawler's hit passes through on its way out. A hit site
 * describes the hit as a {@link CrawlerHit}; {@link resolveCrawlerHit} reads
 * the stat its delivery grows with (`DELIVERY_STAT`) off the dealer, sizes the
 * blow at it, lets every proficiency skill whose tags the hit carries add its
 * share, and counts the hit as a use of each. What comes out is a
 * {@link ResolvedHit}, the only thing `Mob.takeHit` lands, so no crawler hit
 * can reach a creature without passing through here.
 */

import type { Player } from '../../Player';
import type { PlayerDamageType } from '../../creatures/Mob';
import type { WeaponDelivery } from '../items/equipment/weapons';
import { DELIVERY_STAT } from '../party/stats';
import type { DamageTags } from './damageTags';
import {
  BLAST_WARD_SKILL,
  PROFICIENCY_SKILL_IDS,
  proficiencyBoosts,
  proficiencyEffect,
  type ProficiencySkillId,
} from '../skills/proficiency';

/** What a proficiency skill is read off: the crawler landing a hit, or one a harm is softened for. */
type ProficiencyHolder = Pick<Player, 'skills' | 'effectiveSkillLevel'>;

/**
 * A crawler landing a hit. The two crawler classes answer `isCrawler` with the
 * literal `true`, so a hireling, a pet or any other mob cannot be named here.
 */
export type CrawlerDealer = Player & { readonly isCrawler: true };

/** Whether `body` is one of the two crawlers, and so can deal a crawler hit. */
export function isCrawlerDealer(body: Player): body is CrawlerDealer {
  return body.isCrawler;
}

/** What a proficiency skill is worth to `holder` right now, trained levels and worn ones together. */
function proficiencyEffectFor(holder: ProficiencyHolder, skill: ProficiencySkillId): number {
  return proficiencyEffect(holder.effectiveSkillLevel(skill));
}

/**
 * The fraction every proficiency skill boosting a hit tagged `tags` adds to
 * it. Skills add: a hit carrying two skills' tags gets both shares.
 */
export function proficiencyDamageBonus(holder: ProficiencyHolder, tags: DamageTags): number {
  let bonus = 0;
  for (const skill of PROFICIENCY_SKILL_IDS) {
    if (proficiencyBoosts(skill, tags)) bonus += proficiencyEffectFor(holder, skill);
  }
  return bonus;
}

/** Whether the hit trains the skills it carries: a target that earns nothing trains nothing. */
export type HitTraining = 'trains' | 'trainsNothing';

/** How a hit on `target` trains: not at all when the target's blows earn nothing. */
export function hitTrainingOn(target: Pick<Player, 'blowsEarnNothing'>): HitTraining {
  return target.blowsEarnNothing ? 'trainsNothing' : 'trains';
}

/**
 * The stat a delivery grows with, as a crawler had it when it set a hit going
 * that lands later: a stick of dynamite keeps its thrower's Explosives Handling
 * from the moment it is lit, whoever's chain it goes off in. Only
 * {@link captureDeliveryStat} makes one, so the value always comes from the
 * stat `DELIVERY_STAT` names.
 */
class CapturedStat {
  declare private readonly madeByCapture: true;

  constructor(readonly value: number) {}
}

export type { CapturedStat };

/** `dealer`'s stat for `delivery` as it stands now, kept for a hit that lands later. */
export function captureDeliveryStat(dealer: CrawlerDealer, delivery: WeaponDelivery): CapturedStat {
  return new CapturedStat(dealer.statValue(DELIVERY_STAT[delivery]));
}

/** Reads a stat a hit captured when it was set going. */
type CapturedStatReader = (captured: CapturedStat) => number;

/** How a hit grows with its dealer's stats. */
type HitBlow =
  | {
      /** How the hit leaves the crawler, which names the stat it grows with through `DELIVERY_STAT`. */
      readonly delivery: WeaponDelivery;
      /** What the hit is worth with that stat at `stat`, before any proficiency skill. */
      readonly blowAt: (stat: number) => number;
    }
  | {
      /**
       * A hit whose stats were captured when it was set going, one per part of
       * it: every stick in a chain sized by its own thrower's handling.
       */
      readonly delivery: 'captured';
      readonly blowAt: (statOf: CapturedStatReader) => number;
    }
  | {
      /**
       * A hit no stat grows: a status bite, a share of a blow already resolved,
       * a spell pulse of fixed strength.
       */
      readonly delivery: 'unscaled';
      readonly blow: number;
    };

/**
 * What delivered a hit, which is what a guard is judged against: the crawler's
 * own body, or something nothing can guard — a relic's bolt, a gear spark, a
 * thrown slash — which also cannot count as the clean hit that ends a run of
 * guards.
 */
type HitStriker = 'dealer' | 'unguardable';

/** One hit a crawler lands, as the site landing it describes it. */
export type CrawlerHit = HitBlow & {
  readonly dealer: CrawlerDealer;
  readonly tags: DamageTags;
  readonly training: HitTraining;
  /** The weapon the hit is struck with; null for harm nothing swung, such as a status bite. */
  readonly damageType: PlayerDamageType | null;
  readonly struckBy: HitStriker;
};

/**
 * A crawler's hit as {@link resolveCrawlerHit} sized it. Only the type leaves
 * this module, never the class, so nothing else can make one.
 */
class ResolvedHit {
  constructor(
    readonly dealer: CrawlerDealer,
    private readonly landed: number,
    readonly damageType: PlayerDamageType | null,
    readonly struckBy: HitStriker,
  ) {}

  /** What the hit lands for, its stat and every proficiency skill counted. */
  get damage(): number {
    return this.landed;
  }
}

export type { ResolvedHit };

const capturedValue: CapturedStatReader = (captured) => captured.value;

/** What `hit` is worth at its dealer's stat, before any proficiency skill. */
function grownBlow(hit: CrawlerHit): number {
  if (hit.delivery === 'unscaled') return hit.blow;
  if (hit.delivery === 'captured') return hit.blowAt(capturedValue);
  return hit.blowAt(hit.dealer.statValue(DELIVERY_STAT[hit.delivery]));
}

/**
 * Sizes `hit` once its dealer's stat and proficiency skills have weighed in,
 * crediting a use to every skill it carries when it `trains`.
 *
 * Damage lands in whole points, so the skills' bonus is paid in whole points
 * too. Rounding it instead would make the first dozen levels worth nothing on
 * a small blow. A blow no skill boosts lands as the stat sized it.
 */
export function resolveCrawlerHit(hit: CrawlerHit, roll: () => number = Math.random): ResolvedHit {
  const { dealer, tags } = hit;
  if (hit.training === 'trains') {
    for (const skill of PROFICIENCY_SKILL_IDS) {
      if (proficiencyBoosts(skill, tags)) dealer.skills.recordUse(skill);
    }
  }
  const blow = grownBlow(hit);
  const bonus = proficiencyDamageBonus(dealer, tags);
  const landed = bonus <= 0 || blow <= 0 ? blow : blow + inWholePoints(blow * bonus, roll);
  return new ResolvedHit(dealer, landed, hit.damageType, hit.struckBy);
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
  bearer: ProficiencyHolder,
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
  thrower: ProficiencyHolder,
  damage: number,
  roll: () => number = Math.random,
): number {
  return inWholePoints(proficiencyWardedAmount(thrower, BLAST_WARD_SKILL, damage), roll);
}
