/**
 * What each red wedge does to the crawler who spun. Canvas-free: the wheel's
 * host plays the reveal and calls one of these for the effect itself.
 */

import type { DamageSource, Player } from '../../../Player';
import {
  CHILLED_STATUS,
  makeBurn,
  makeDoubleDamage,
  makePoison,
  makeFrozen,
} from '../../../core/combat/StatusEffect';
import { frozenFramesFor } from '../../../core/combat/frostStatus';

const FRAMES_PER_SECOND = 60;

/** Share of max HP Take Damage costs, before any status scales it. */
export const WHEEL_DAMAGE_MAX_HP_SHARE = 0.5;
/** Take Damage is a penalty, never a kill: it leaves at least this much. */
const WHEEL_DAMAGE_HP_FLOOR = 1;
const WHEEL_PENALTY_SOURCE: DamageSource = { kind: 'wheelPenalty' };

const WHEEL_POISON_SECONDS = 120;
/** Far longer than any mob's poison, which is what makes it a wedge rather than a scratch. */
export const WHEEL_POISON_FRAMES = WHEEL_POISON_SECONDS * FRAMES_PER_SECOND;

const WHEEL_FREEZE_SECONDS = 4;
/** Long enough to be seen as frozen solid on the club floor, before ice-resistant gear halves it. */
export const WHEEL_FREEZE_FRAMES = WHEEL_FREEZE_SECONDS * FRAMES_PER_SECOND;

/** Share of carried coins Donald takes from a robbed crawler. */
const WHEEL_ROBBED_COIN_SHARE = 0.5;

/**
 * Half of max HP as a blow, never below 1 HP. Dealt through `takeDamage`, so
 * double damage doubles it and the crawler reacts as to any hit. Returns the
 * HP actually lost.
 */
export function applyWheelDamage(crawler: Player): number {
  const hpBefore = crawler.hp;
  const wound = Math.round(crawler.maxHp * WHEEL_DAMAGE_MAX_HP_SHARE);
  crawler.takeDamage(wound, WHEEL_PENALTY_SOURCE, { floorHp: WHEEL_DAMAGE_HP_FLOOR });
  return Math.max(0, hpBefore - crawler.hp);
}

/** A long ordinary poison, so the apothecary and an inn room can still cure it. */
export function applyWheelPoison(crawler: Player): void {
  crawler.applyStatus(makePoison(null, WHEEL_POISON_FRAMES));
}

/** The incurable double damage, for its full run. */
export function applyWheelDoubleDamage(crawler: Player): void {
  crawler.applyStatus(makeDoubleDamage());
}

export function applyWheelBurn(crawler: Player): void {
  crawler.applyStatus(makeBurn());
}

/**
 * Frozen solid, straight away: no chill first and no grace window, because
 * this is a prize the crawler lost rather than an ice hit to dodge. Call it
 * once the wheel screen has closed, so the freeze is spent on the club floor
 * where it can be seen.
 */
export function applyWheelFreeze(crawler: Player): void {
  if (!crawler.isAlive) return;
  crawler.cureStatuses([CHILLED_STATUS]);
  crawler.applyStatus(makeFrozen(frozenFramesFor(crawler, WHEEL_FREEZE_FRAMES)));
}

/** Half the coins the crawler carries, rounded down, taken. Returns the amount for the coin drain. */
export function applyWheelRobbery(crawler: Player): number {
  const taken = Math.floor(crawler.coins * WHEEL_ROBBED_COIN_SHARE);
  crawler.coins -= taken;
  return taken;
}
