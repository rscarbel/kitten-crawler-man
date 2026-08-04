/**
 * Cross-scene state for "The Krasue Murders" (the town murder-mystery
 * questline). Like CircusQuestProgress, one mutable object is created by the
 * overworld DungeonScene and threaded by reference through
 * BuildingInteriorScene and every scene reconstruction — the cult-hideout and
 * tower-confrontation beats advance the stage from inside interiors.
 *
 * Stages are entry-idempotent: the night-attack swarm respawns in full if the
 * scene is rebuilt mid-stage, so no transient combat state crosses a swap.
 */
export type MurderQuestStage =
  | 'not_started'
  | 'body_waiting'
  | 'investigation'
  | 'night_attack'
  | 'cult_hideout'
  | 'confrontation'
  | 'quill_slain'
  | 'complete';

export interface MurderQuestProgress {
  stage: MurderQuestStage;
  wellClueFound: boolean;
  homeClueFound: boolean;
  roostClueFound: boolean;
  /** True once the hideout letter naming Miss Quill has been shown to the player. */
  quillNamed: boolean;
}

export function createMurderQuestProgress(): MurderQuestProgress {
  return {
    stage: 'not_started',
    wellClueFound: false,
    homeClueFound: false,
    roostClueFound: false,
    quillNamed: false,
  };
}

export interface MurderQuestProgressCheckpoint {
  readonly stage: MurderQuestStage;
  readonly wellClueFound: boolean;
  readonly homeClueFound: boolean;
  readonly roostClueFound: boolean;
  readonly quillNamed: boolean;
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
}
