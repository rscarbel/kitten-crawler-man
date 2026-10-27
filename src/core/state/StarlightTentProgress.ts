/**
 * What the Starlight Tent remembers between performances.
 *
 * Every entry to the tent builds a fresh maze, so a payout the tent may only
 * make once has to be recorded somewhere that outlives the maze. One mutable
 * object is created by the overworld `DungeonScene` and threaded by reference
 * through `BuildingInteriorScene` and every scene reconstruction, like
 * `TownMemory`.
 */

export interface StarlightTentProgress {
  /**
   * Whether the encore star has paid out. The maze is rebuilt with its stars
   * dark on every entry, and a re-lit encore would otherwise pay on every
   * performance.
   */
  encorePaid: boolean;
  /** Whether the finale ring's chest has been opened; later runs leave it open and unguarded. */
  chestClaimed: boolean;
}

export function createStarlightTentProgress(): StarlightTentProgress {
  return { encorePaid: false, chestClaimed: false };
}

export type StarlightTentProgressCheckpoint = Readonly<StarlightTentProgress>;

/** Snapshots the tent's record so a death can rewind it with the rest of the world. */
export function captureStarlightTentProgress(
  progress: StarlightTentProgress,
): StarlightTentProgressCheckpoint {
  return { encorePaid: progress.encorePaid, chestClaimed: progress.chestClaimed };
}

/**
 * Rewinds the record in place. The same object is threaded by reference
 * through every scene, so it can never be replaced.
 */
export function restoreStarlightTentProgress(
  progress: StarlightTentProgress,
  snapshot: StarlightTentProgressCheckpoint,
): void {
  progress.encorePaid = snapshot.encorePaid;
  progress.chestClaimed = snapshot.chestClaimed;
}
