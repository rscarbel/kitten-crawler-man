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
    swarmKrasueDefeated: 0,
  };
}

export interface MurderQuestProgressCheckpoint {
  readonly stage: MurderQuestStage;
  readonly wellClueFound: boolean;
  readonly homeClueFound: boolean;
  readonly roostClueFound: boolean;
  readonly quillNamed: boolean;
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
  progress.swarmKrasueDefeated = snapshot.swarmKrasueDefeated;
}
