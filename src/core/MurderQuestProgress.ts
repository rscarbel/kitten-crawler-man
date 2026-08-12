/**
 * Cross-scene state for "The Krasue Murders" (the town murder-mystery
 * questline). Like CircusQuestProgress, one mutable object is created by the
 * overworld DungeonScene and threaded by reference through
 * BuildingInteriorScene and every scene reconstruction — the cult-hideout and
 * tower-confrontation beats advance the stage from inside interiors.
 *
 * Stages are entry-idempotent: a scene rebuild mid-attack resumes the
 * night-attack swarm rather than respawning it in full — `swarmKrasueDefeated`
 * is what survives the rebuild to make that possible, since the live `Krasue`
 * instances themselves do not.
 */
import type { ItemId } from './ItemDefs';

export type MurderQuestStage =
  | 'not_started'
  | 'body_waiting'
  | 'investigation'
  | 'night_attack'
  | 'cult_hideout'
  | 'confrontation'
  /** Quill and Remex are down and the thing wearing the magistracy has shown itself. */
  | 'quill_slain'
  | 'lich_slain'
  | 'complete';

export interface MurderQuestProgress {
  stage: MurderQuestStage;
  wellClueFound: boolean;
  homeClueFound: boolean;
  roostClueFound: boolean;
  /** True once the hideout letter naming Miss Quill has been shown to the player. */
  quillNamed: boolean;
  /**
   * True once the party has walked into the magistrate's office and heard Miss
   * Quill turn them away.
   *
   * The scene is worth exactly one viewing: it opens the fight, and a party that
   * died to that fight and climbed back up has already met her. Kept here rather
   * than on the confrontation system because that system is rebuilt from nothing
   * every time the tower is re-entered, which is precisely the case it exists to
   * answer.
   */
  officeSceneSeen: boolean;
  /**
   * Papers taken off GumGum's body that have not reached a bag yet.
   *
   * Cross-scene for the same reason `officeSceneSeen` is: the grant happens once,
   * behind a stage advance that never runs again, and a full pack at that moment
   * would otherwise lose both items the instant the player stepped through a
   * door and the quest system was rebuilt — while the investigation's own hint
   * goes on describing a letter in a pack that never got one.
   */
  evidenceOwed: ItemId[];
  /**
   * How many of the night-attack swarm have already fallen. A scene rebuild
   * (including a death respawn) loses the live `Krasue` instances, so this is
   * what lets the resumed fight spawn only the krasue still owed rather than
   * the full ring on top of a player who just respawned.
   */
  swarmKrasueDefeated: number;
}

export function createMurderQuestProgress(): MurderQuestProgress {
  return {
    stage: 'not_started',
    wellClueFound: false,
    homeClueFound: false,
    roostClueFound: false,
    quillNamed: false,
    officeSceneSeen: false,
    evidenceOwed: [],
    swarmKrasueDefeated: 0,
  };
}

export interface MurderQuestProgressCheckpoint {
  readonly stage: MurderQuestStage;
  readonly wellClueFound: boolean;
  readonly homeClueFound: boolean;
  readonly roostClueFound: boolean;
  readonly quillNamed: boolean;
  readonly officeSceneSeen: boolean;
  readonly evidenceOwed: ReadonlyArray<ItemId>;
  readonly swarmKrasueDefeated: number;
}

/** Snapshots questline progress so a safe-room death can rewind the stage and the clues. */
export function captureMurderQuestProgress(
  progress: MurderQuestProgress,
): MurderQuestProgressCheckpoint {
  return {
    stage: progress.stage,
    wellClueFound: progress.wellClueFound,
    homeClueFound: progress.homeClueFound,
    roostClueFound: progress.roostClueFound,
    quillNamed: progress.quillNamed,
    officeSceneSeen: progress.officeSceneSeen,
    evidenceOwed: [...progress.evidenceOwed],
    swarmKrasueDefeated: progress.swarmKrasueDefeated,
  };
}

/**
 * Rewinds progress in place. The same object is threaded by reference through
 * every scene and every scene reconstruction, so it can never be replaced.
 */
export function restoreMurderQuestProgress(
  progress: MurderQuestProgress,
  snapshot: MurderQuestProgressCheckpoint,
): void {
  progress.stage = snapshot.stage;
  progress.wellClueFound = snapshot.wellClueFound;
  progress.homeClueFound = snapshot.homeClueFound;
  progress.roostClueFound = snapshot.roostClueFound;
  progress.quillNamed = snapshot.quillNamed;
  progress.officeSceneSeen = snapshot.officeSceneSeen;
  progress.evidenceOwed = [...snapshot.evidenceOwed];
  progress.swarmKrasueDefeated = snapshot.swarmKrasueDefeated;
}
