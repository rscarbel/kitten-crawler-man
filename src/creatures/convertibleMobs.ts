/**
 * Which creatures a level-15 snare may turn to the party's side.
 *
 * An allow-list rather than a rule, because a converted mob keeps running its
 * own `updateAI` against the enemies it is handed, and some creatures' attacks
 * assume their target is a crawler — a projectile resolved by a system that
 * only hits the party, a grab that reads crawler-only state. Only the
 * creatures `verify:siege-engines` proves fight cleanly on the party's side
 * are listed; anything else a snare catches is rooted instead.
 *
 * Skeleton Archers are left out on purpose: their arrows fly in
 * `SkeletonProjectileSystem`, which aims at the party.
 */

import type { Mob } from './Mob';
import { SkeletonWarrior } from './SkeletonWarrior';
import { RuinsGhoul } from './RuinsGhoul';
import { Goblin } from './Goblin';
import { Troglodyte } from './Troglodyte';
import { RaisedRatkin } from './RaisedRatkin';

/** A creature class, as `instanceof` needs it. */
export type MobClass = abstract new (...args: never[]) => Mob;

export const CONVERTIBLE_MOB_TYPES: readonly MobClass[] = [
  RaisedRatkin,
  SkeletonWarrior,
  RuinsGhoul,
  Goblin,
  Troglodyte,
];

/**
 * The listed creatures that are undead, which crumble to dust when their
 * borrowed life runs out rather than simply fading away.
 */
export const UNDEAD_CONVERTIBLE_TYPES: readonly MobClass[] = [RaisedRatkin, SkeletonWarrior];

/** Whether a snare may convert `mob`: an allow-listed creature that `canBeConverted` also accepts. */
export function isConvertible(mob: Mob): boolean {
  return mob.canBeConverted() && CONVERTIBLE_MOB_TYPES.some((type) => mob instanceof type);
}

export function isUndeadConvertible(mob: Mob): boolean {
  return UNDEAD_CONVERTIBLE_TYPES.some((type) => mob instanceof type);
}
