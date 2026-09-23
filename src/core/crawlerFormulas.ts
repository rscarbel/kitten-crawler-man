/**
 * The crawlers' own stat arithmetic, as pure functions and constants.
 *
 * `HumanPlayer`, `CatPlayer` and `Player` compute their live numbers through
 * these, and `src/core/referenceCrawler.ts` computes an idealised crawler
 * through the same ones — so the difficulty-curve gate measures the formulas the
 * game actually runs rather than a copy of them that could drift.
 */

import type { StatName } from '../Player';

/** Max HP granted by each point of constitution. The single source for this ratio. */
export const CON_HP_BONUS_PER_POINT = 2;

/** Unspent stat points a crawler banks on each level-up. */
export const STAT_POINTS_PER_LEVEL = 1;

/** A crawler's max HP from constitution alone, before gear, boons or overrides. */
export function crawlerMaxHp(baseHpOffset: number, constitution: number): number {
  return baseHpOffset + constitution * CON_HP_BONUS_PER_POINT;
}

/** Species HP floor for the human: 8 + CON 1 × 2 = 10 starting max HP. */
export const HUMAN_BASE_HP_OFFSET = 8;
/** An ordinary human is not especially nimble. */
export const HUMAN_STARTING_DEXTERITY = 2;
/** Frames one punch or kick takes; the attack key cannot start another sooner. */
export const HUMAN_SWING_FRAMES = 18;
/** Damage a punch does before strength, gear, skills or status are counted. */
const BARE_FIST_DAMAGE = 1;

/** A bare-handed punch's damage from strength alone. */
export function bareFistDamage(strength: number): number {
  return BARE_FIST_DAMAGE + strength;
}

/** Species HP floor for the cat: 2 + CON 2 × 2 = 6 starting max HP. She is meant to be fragile. */
export const CAT_BASE_HP_OFFSET = 2;
/** Donut's constitution is fixed at 2 by the enhanced pet biscuit — book canon. */
export const CAT_BASE_CONSTITUTION = 2;
/** The pet biscuit's head start: she is very hard to hit. */
export const CAT_STARTING_DEXTERITY = 8;
/** Dexterity the System hands Donut for free on each level-up (Enhanced Growth). */
export const CAT_DEXTERITY_PER_LEVEL = 1;
/**
 * The stats Donut can never spend a point into: her constitution is fixed by the
 * pet biscuit and her dexterity is auto-allocated by Enhanced Growth.
 */
export const CAT_LOCKED_STATS: readonly StatName[] = ['constitution', 'dexterity'];
/** Frames the claw swipe covers; `CatPlayer` times its hit window and the sprite its animation to this. */
export const CAT_SWIPE_FRAMES = 18;
/** Damage a claw swipe does before strength, gear or status are counted. */
const BARE_CLAW_DAMAGE = 1;
/** A magic missile's damage before intelligence and the spell's own level are counted. */
const MISSILE_BASE_DAMAGE = 2;

/** A claw swipe's damage from strength alone. */
export function bareClawDamage(strength: number): number {
  return BARE_CLAW_DAMAGE + strength;
}

/** A magic missile's damage from intelligence and the spell level's damage multiplier. */
export function missileDamage(intelligence: number, damageMultiplier: number): number {
  return Math.round((MISSILE_BASE_DAMAGE + intelligence) * damageMultiplier);
}

/**
 * Hit points as a player should see them.
 *
 * Levelled mob damage and the difficulty profile's incoming-damage scale are
 * both fractional, so live HP is too; every place that prints HP goes through
 * this so none of them shows floating-point noise. Rounded up, so a crawler
 * clinging on at a fraction of a point never reads as zero.
 */
export function displayHp(hp: number): number {
  return Math.ceil(hp);
}
