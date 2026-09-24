/**
 * The bosses whose deaths raise a floor's fairy rates, read off the systems
 * that record those deaths, and the replay of their upgrades on a reload.
 */

import type { ArenaSystem } from './ArenaSystem';
import type { BossRoomSystem } from './BossRoomSystem';
import type { FairySystem } from './FairySystem';

const SWINE_BOSS_TYPE = 'ball_of_swine';

/**
 * Bosses whose death raises this floor's fairy rates and that are dead in the
 * world as it stands. The Ball of Swine is the only such boss, and its death
 * is recorded as the arena's second phase rather than in a boss room.
 */
export function deadFairyUpgradeBosses(
  bossRoom: Pick<BossRoomSystem, 'defeatedBossTypes'>,
  arena: Pick<ArenaSystem, 'phase2Active'>,
): ReadonlySet<string> {
  const dead = new Set(bossRoom.defeatedBossTypes);
  if (arena.phase2Active) dead.add(SWINE_BOSS_TYPE);
  return dead;
}

/**
 * Tops up the rooms each dead boss's upgrade would have, for a floor rebuilt
 * from a save: the upgrade's own event fired in a session the rebuilt floor
 * never saw.
 */
export function replayFairyRateUpgrades(
  fairies: Pick<FairySystem, 'applyRateUpgrade'>,
  deadBosses: ReadonlySet<string>,
): void {
  for (const bossType of deadBosses) fairies.applyRateUpgrade(bossType);
}
