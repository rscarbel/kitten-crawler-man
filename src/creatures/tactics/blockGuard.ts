/**
 * The rules for which incoming blows a mob with the `block` trait may turn
 * aside, and what turning one aside costs it.
 *
 * Pure, so `scripts/verify-tactics.ts` can check the classification directly as
 * well as through a real mob. Deliberately separate from the boss shields
 * (`Mob.isDamageImmune` / `Mob.onDamageBlocked`): those refuse everything for
 * as long as a mechanic is up; a guard is one roll against one blow.
 */

import type { PlayerDamageType } from '../Mob';

/**
 * The weapons a guard can meet: a swung fist, claw or blade, and a stone from
 * the sling. Everything else is refused — a spell reads as going straight
 * through a raised guard, a blast or a shove from a shell has no single edge
 * to catch, and a `null` type is a status tick nobody swung.
 */
export const GUARDABLE_DAMAGE_TYPES: readonly PlayerDamageType[] = ['melee', 'slingshot'];

/**
 * At or below this share of its max HP a mob never guards. A mob one hit from
 * death that turns the blow aside reads as a stolen kill, not as a good fighter.
 */
export const GUARD_LOW_HP_FRACTION = 0.25;

/**
 * The shortest gap between two guards by the same mob, in frames. Paired with
 * the rule that an unguarded hit must land in between, so a player hitting
 * quickly and a player hitting slowly both see a streak broken.
 */
export const GUARD_COOLDOWN_FRAMES = 90;

/** How far a guard shoves the mob away from whoever struck it, in tiles. */
export const GUARD_KNOCKBACK_TILES = 1.5;

/** Frames the shove is spread over, eased out like a crawler's own stagger. */
export const GUARD_KNOCKBACK_FRAMES = 12;

/** The facts about one incoming blow that decide whether it can be guarded. */
export interface IncomingBlow {
  readonly amount: number;
  readonly damageType: PlayerDamageType | null;
  /**
   * Whether the creature that actually struck is one of the two crawlers —
   * not whoever is credited with the kill. A pet, a hireling or another mob
   * striking this one is a fight between creatures, not the player being
   * out-fought.
   */
  readonly fromCrawler: boolean;
  readonly hp: number;
  readonly maxHp: number;
}

/** Whether `blow` is the kind of hit a guard is allowed to meet at all. */
export function isGuardableBlow(blow: IncomingBlow): boolean {
  if (blow.amount <= 0 || !blow.fromCrawler) return false;
  if (blow.damageType === null || !GUARDABLE_DAMAGE_TYPES.includes(blow.damageType)) return false;
  if (blow.maxHp <= 0) return false;
  const hpFraction = blow.hp / blow.maxHp;
  return hpFraction > GUARD_LOW_HP_FRACTION;
}
