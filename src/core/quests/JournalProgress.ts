/**
 * Cross-scene state for the Journal: which entry the player pinned.
 *
 * One mutable object created by the overworld `DungeonScene` and threaded by
 * reference through every scene reconstruction, for the same reason
 * `BountyProgress` and `AnchorQuestProgress` are. Entering a building replaces
 * the scene outright and the exit callback builds a fresh one, so anything held
 * on the scene alone is re-created empty on the way back out — which would
 * quietly unpin whatever they were following every time they left a shop.
 *
 * Deliberately *not* in `Settings`: a pin belongs to a run, not to a device.
 */

import { resolvePinnedEntry, type TrackerEntry } from '../../systems/questTracker';

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

/** A pin that kept the arrow when another quest asked for it. */
export interface HeldPin {
  readonly pinnedId: string;
  readonly entry: TrackerEntry;
}

/**
 * Pins `questId`, which the party has just started or been told about, as
 * the automatic pin, unless a pin on another quest the Journal can still
 * follow holds the arrow. Returns that pin when it does, so a scene can ask
 * the player whether to switch, and null once `questId` is pinned.
 */
export function autoPinQuest(
  progress: JournalProgress,
  questId: string,
  entries: ReadonlyArray<TrackerEntry>,
): HeldPin | null {
  const pinnedId = progress.pinnedTrackerId;
  if (pinnedId !== null && pinnedId !== questId) {
    const entry = resolvePinnedEntry(pinnedId, entries);
    if (entry !== null) return { pinnedId, entry };
  }
  progress.pinnedTrackerId = questId;
  progress.pinSource = 'auto';
  return null;
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
