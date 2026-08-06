/**
 * Cross-scene state for the Journal: which Town Guide stops the player has been
 * to, and which entry they pinned.
 *
 * One mutable object created by the overworld `DungeonScene` and threaded by
 * reference through every scene reconstruction, for the same reason
 * `BountyProgress` and `MurderQuestProgress` are. Entering a building replaces
 * the scene outright and the exit callback builds a fresh one, so anything held
 * on the scene alone is re-created empty on the way back out — which would put
 * "Read the town notice board" back in the Journal every time the player walked
 * out of a shop, and quietly unpin whatever they were following.
 *
 * Deliberately *not* in `Settings`: both of these belong to a run, not to a
 * device. A new game should have its own town to find its way around.
 */

/** The stops the Town Guide can point at, by the ids `TownGuideSystem` states. */
export interface JournalProgress {
  /** Guide stop ids the player has stood near. */
  visitedGuideStops: Set<string>;
  /** `TrackerEntry.id` of the pinned objective, or null. */
  pinnedTrackerId: string | null;
}

export function createJournalProgress(): JournalProgress {
  return { visitedGuideStops: new Set<string>(), pinnedTrackerId: null };
}

/** A point-in-time copy, for the in-run safe-room checkpoint. */
export interface JournalProgressCheckpoint {
  readonly visitedGuideStops: ReadonlyArray<string>;
  readonly pinnedTrackerId: string | null;
}

export function captureJournalProgress(progress: JournalProgress): JournalProgressCheckpoint {
  return {
    visitedGuideStops: [...progress.visitedGuideStops],
    pinnedTrackerId: progress.pinnedTrackerId,
  };
}

/**
 * Rewinds the record in place — every scene holds this one object by reference.
 *
 * Rewinding the visits as well as the pin is deliberate, and is what makes a
 * death against a checkpoint cost the player the exploring they did after it:
 * the Journal comes back saying the same things it said when they last sat down
 * with Mordecai, which is the state the rest of the world has been put back to.
 */
export function restoreJournalProgress(
  progress: JournalProgress,
  snapshot: JournalProgressCheckpoint,
): void {
  progress.visitedGuideStops = new Set(snapshot.visitedGuideStops);
  progress.pinnedTrackerId = snapshot.pinnedTrackerId;
}
