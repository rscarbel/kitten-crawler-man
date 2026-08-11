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
  | 'grimaldi_redeemed'
  | 'complete';

/** The one building the circus questline holds shut. */
export const BIG_TOP_BUILDING_NAME = 'Big Top';

/** Shown when the player tries the Big Top's door before the final act. */
export const BIG_TOP_SEALED_MESSAGE = 'You may not enter here yet...';

/**
 * Stages at which the Big Top's door opens.
 *
 * The tent is the finale, and Signet never goes inside it — before the assault
 * is broken there is nothing in there but the thing the quest is building
 * toward, and after the cure it is a room the player may revisit.
 */
const BIGTOP_OPEN_STAGES: ReadonlySet<CircusQuestStage> = new Set([
  'bigtop_ready',
  'grimaldi_redeemed',
  'complete',
]);

/**
 * Whether the circus questline's business under the Big Top is finished.
 *
 * The town's noticeboard, its residents and its fortune teller all react to the
 * same moment — the tent going quiet — which is one stage earlier than the
 * quest being formally closed out with Signet.
 */
export function isCircusResolvedStage(stage: CircusQuestStage): boolean {
  return stage === 'grimaldi_redeemed' || stage === 'complete';
}

/** Whether the Big Top refuses entry at this stage. */
export function isBigTopSealed(stage: CircusQuestStage): boolean {
  return !BIGTOP_OPEN_STAGES.has(stage);
}

export interface CircusQuestProgress {
  stage: CircusQuestStage;
  heatherSlain: boolean;
  /** True while Signet holds Mongo as collateral — restored during the resolution. */
  mongoKidnapped: boolean;
  /**
   * Whether Signet has already handed over the potion the tent's last act needs.
   *
   * Her Big Top briefing can be replayed as often as the player walks back to
   * her, and a bottle per retelling would be a potion fountain.
   */
  bigTopPotionGiven: boolean;
}

export function createCircusQuestProgress(): CircusQuestProgress {
  return {
    stage: 'not_started',
    heatherSlain: false,
    mongoKidnapped: false,
    bigTopPotionGiven: false,
  };
}

export interface CircusQuestProgressCheckpoint {
  readonly stage: CircusQuestStage;
  readonly heatherSlain: boolean;
  readonly mongoKidnapped: boolean;
  readonly bigTopPotionGiven: boolean;
}

/** Snapshots questline progress so a safe-room death can rewind the stage. */
export function captureCircusQuestProgress(
  progress: CircusQuestProgress,
): CircusQuestProgressCheckpoint {
  return {
    stage: progress.stage,
    heatherSlain: progress.heatherSlain,
    mongoKidnapped: progress.mongoKidnapped,
    bigTopPotionGiven: progress.bigTopPotionGiven,
  };
}

/**
 * Rewinds progress in place. The same object is threaded by reference through
 * every scene and every scene reconstruction, so it can never be replaced.
 */
export function restoreCircusQuestProgress(
  progress: CircusQuestProgress,
  snapshot: CircusQuestProgressCheckpoint,
): void {
  progress.stage = snapshot.stage;
  progress.heatherSlain = snapshot.heatherSlain;
  progress.mongoKidnapped = snapshot.mongoKidnapped;
  progress.bigTopPotionGiven = snapshot.bigTopPotionGiven;
}
