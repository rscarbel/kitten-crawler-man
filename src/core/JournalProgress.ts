/**
 * Cross-scene state for the Journal: which entry the player pinned.
 *
 * One mutable object created by the overworld `DungeonScene` and threaded by
 * reference through every scene reconstruction, for the same reason
 * `BountyProgress` and `MurderQuestProgress` are. Entering a building replaces
 * the scene outright and the exit callback builds a fresh one, so anything held
 * on the scene alone is re-created empty on the way back out — which would
 * quietly unpin whatever they were following every time they left a shop.
 *
 * Deliberately *not* in `Settings`: a pin belongs to a run, not to a device.
 */

/**
 * Who set the current pin. A player pin (tapped in the Journal) always keeps
 * the world arrow; an auto-pin (set when a quest starts) yields to whichever
 * quest is active and never overrides a player pin that is still outstanding.
 * Meaningless while `pinnedTrackerId` is null.
 */
export type PinSource = 'auto' | 'player';

export interface JournalProgress {
  /** `TrackerEntry.id` of the pinned objective, or null. */
  pinnedTrackerId: string | null;
  pinSource: PinSource | null;
}

export function createJournalProgress(): JournalProgress {
  return { pinnedTrackerId: null, pinSource: null };
}

/**
 * Unpins `questId` if the pin is still the automatic one its start set. A
 * player's own pin is theirs to keep.
 */
export function releaseAutoPin(progress: JournalProgress, questId: string): void {
  if (progress.pinSource !== 'auto' || progress.pinnedTrackerId !== questId) return;
  progress.pinnedTrackerId = null;
  progress.pinSource = null;
}

/** A point-in-time copy, for the in-run safe-room checkpoint. */
export interface JournalProgressCheckpoint {
  readonly pinnedTrackerId: string | null;
  readonly pinSource: PinSource | null;
}

export function captureJournalProgress(progress: JournalProgress): JournalProgressCheckpoint {
  return {
    pinnedTrackerId: progress.pinnedTrackerId,
    pinSource: progress.pinSource,
  };
}

/** Rewinds the record in place — every scene holds this one object by reference. */
export function restoreJournalProgress(
  progress: JournalProgress,
  snapshot: JournalProgressCheckpoint,
): void {
  progress.pinnedTrackerId = snapshot.pinnedTrackerId;
  progress.pinSource = snapshot.pinSource;
}
