/**
 * The level Briar Hollow's siege is fought at: the band the floor's own
 * undead roam in, tracked to the party the way every ambient spawn on the
 * floor is. The militia are levelled to it so they neither make the siege
 * trivial nor fold at the first wave.
 */

import type { DifficultyProfile } from '../../core/difficultyProfiles';
import { resolveAmbientLevel } from '../../levels/spawner';
import type { LevelDef, MobLevelRange } from '../../levels/types';

/** The ruins ghouls' band on the overworld — the undead the necromancer's army is drawn from. */
export const VILLAGE_ASSAULT_LEVEL_BAND: MobLevelRange = { minLevel: 5, maxLevel: 8 };

/** One roll of the siege's level for a party at `partyLevel`. */
export function resolveVillageAssaultLevel(
  def: Pick<LevelDef, 'ambientTracking'>,
  partyLevel: number,
  profile: DifficultyProfile,
): number {
  return resolveAmbientLevel(VILLAGE_ASSAULT_LEVEL_BAND, def, partyLevel, profile);
}
