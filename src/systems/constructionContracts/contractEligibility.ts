/**
 * Which contract sites may be issued right now, and which are temporarily
 * taken over by a story beat.
 *
 * Taloncrest defers to the same ownership rules the interior scene uses to
 * decide who stands in a room, so a contract is never issued for a room the
 * party would walk into and find held by a fight. No contact resident or
 * villager is ever written out of the world by a story flag (the residents are
 * placed by building, and downed soldiers get back up), so a contact's absence
 * only ever comes from their room being owned.
 */

import type { AnchorQuestProgress } from '../../core/quests/AnchorQuestProgress';
import type { MurderQuestStage } from '../../core/quests/MurderQuestProgress';
import { isVillageUnderSiege, type VillageQuestPhase } from '../../core/quests/villageQuestPhase';
import { lorisWreckMended, interiorRoomOwnedByStory } from '../interiorStoryOwnership';
import type { ContractSiteDef } from './contractCatalog';

/** The world facts eligibility reads; both floor-3 scenes can build one from their threaded state. */
export interface ContractWorld {
  readonly murderStage: MurderQuestStage | undefined;
  readonly anchor: Pick<AnchorQuestProgress, 'temple' | 'loriRepairedTypes'>;
  readonly villagePhase: VillageQuestPhase;
}

/**
 * True while a story state owns the site: a Taloncrest room held by a quest
 * fight, or any Briar Hollow building while the village is under siege. An
 * active contract's spots go inert and its contact waits while this holds.
 */
export function contractSiteOwnedByStory(site: ContractSiteDef, world: ContractWorld): boolean {
  if (site.town === 'briar_hollow') return isVillageUnderSiege(world.villagePhase);
  return interiorRoomOwnedByStory(site.buildingId, world);
}

/** Checked only when a contract is issued; one already issued waits out whatever blocks it. */
export function contractSiteEligible(site: ContractSiteDef, world: ContractWorld): boolean {
  if (contractSiteOwnedByStory(site, world)) return false;
  // Her cottage is the anchor quest's wreck until it is mended, and a contract
  // spot laid over smashed furniture would read as part of that job.
  if (site.town === 'taloncrest' && site.buildingId === 'taloncrest_old_lady_cottage') {
    return lorisWreckMended(world.anchor);
  }
  return true;
}
