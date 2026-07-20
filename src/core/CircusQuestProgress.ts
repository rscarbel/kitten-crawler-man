/**
 * Cross-scene state for "The Show Must Go On" (the Vengeance of the Daughter
 * circus questline). One mutable object is created by the overworld
 * DungeonScene and threaded by reference through BuildingInteriorScene and
 * every scene reconstruction, so the quest survives building round-trips.
 *
 * Stages are entry-idempotent: every overworld wave completes before the Big
 * Top unlocks, so no transient combat state ever needs to cross a scene swap.
 */
export type CircusQuestStage =
  | 'not_started'
  | 'ritual_defense'
  | 'heather_hunt'
  | 'assault'
  | 'bigtop_ready'
  | 'grimaldi_slain'
  | 'complete';

export interface CircusQuestProgress {
  stage: CircusQuestStage;
  heatherSlain: boolean;
  /** True while Signet holds Mongo as collateral — restored during the resolution. */
  mongoKidnapped: boolean;
}

export function createCircusQuestProgress(): CircusQuestProgress {
  return { stage: 'not_started', heatherSlain: false, mongoKidnapped: false };
}
