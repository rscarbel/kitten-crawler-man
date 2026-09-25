/**
 * The level the village's defences are sized against: how hard a trebuchet
 * boulder hits.
 *
 * It reads the same band the siege's mobs are levelled in
 * (`VILLAGE_ASSAULT_LEVEL_BAND`), because a boulder is sized to kill the mobs
 * it will actually meet — two bands would let a retune of one leave the
 * other killing nothing. Where `resolveVillageAssaultLevel` rolls one spawn
 * somewhere in that band, this takes the top of it as the floor's ambient
 * tracking slides it for the party, so every mob the siege can field is at or
 * under it and the boulder's kill guarantees cover them all.
 */

import type { DifficultyProfile } from '../../core/difficultyProfiles';
import { partyTrackedBand } from '../../levels/spawner';
import { level3 } from '../../levels/level3';
import { VILLAGE_ASSAULT_LEVEL_BAND } from './villageAssaultLevel';

/** The level the village's siege is fought at, for a party at `partyLevel` on `profile`. */
export function resolveSiegeLevel(partyLevel: number, profile: DifficultyProfile): number {
  const band = partyTrackedBand(VILLAGE_ASSAULT_LEVEL_BAND, level3, partyLevel, profile);
  return band.maxLevel ?? band.minLevel ?? 1;
}
