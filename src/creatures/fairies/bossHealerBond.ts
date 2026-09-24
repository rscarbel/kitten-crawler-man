import type { Mob } from '../Mob';

/**
 * Which boss each hard-mode healer was spawned to keep alive.
 *
 * Kept beside the mobs rather than on them so the boss-room and arena systems
 * can ask about a healer without either class knowing about the other. Weak on
 * both sides: a healer disposed by a checkpoint rewind takes its entry with it,
 * and the rewind keeps the same mob objects for everything that survives it, so
 * a bond made before the checkpoint still holds after one.
 */
const bossOfHealerMap = new WeakMap<Mob, Mob>();

/** Records that `healer` was spawned for `boss`. */
export function bindHealerToBoss(healer: Mob, boss: Mob): void {
  bossOfHealerMap.set(healer, boss);
}

/** The boss `mob` was spawned to heal, or null when it is not a boss healer. */
export function bossOfHealer(mob: Mob): Mob | null {
  return bossOfHealerMap.get(mob) ?? null;
}

/**
 * Whether a living healer spawned for a boss matching `isTheirBoss` is still in
 * `mobs`. Matched on the boss rather than by holding the boss, because a dead
 * boss may already have been compacted out of the roster its healer is still in.
 */
export function hasLivingBossHealer(
  mobs: readonly Mob[],
  isTheirBoss: (boss: Mob) => boolean,
): boolean {
  return mobs.some((mob) => {
    if (!mob.isAlive) return false;
    const boss = bossOfHealer(mob);
    return boss !== null && isTheirBoss(boss);
  });
}
