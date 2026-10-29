/**
 * The replay of the fairy rate upgrades of bosses already dead when a floor is
 * rebuilt from a save.
 */

import type { FairySystem } from './FairySystem';

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
