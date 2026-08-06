/**
 * The seam between "a quest system knows what it is doing" and "the Journal can
 * say so".
 *
 * Deliberately *not* a global `QuestManager`. Three of the five questlines own a
 * `QuestManager` privately, and the other two do not use one at all — the spider
 * lab only emits events, and Shady's bounties run off their own phase record.
 * Centralising the state would mean rewriting all five; asking each of them the
 * same question means adding one getter to each, next to the `questMarkers`
 * getter that already answers the minimap's version of it.
 *
 * A tracker entry is a *statement about right now*, rebuilt every frame from
 * whatever the system's own state machine says. Nothing here is stored, so
 * nothing here can go stale.
 */

/**
 * The four states a journal line can be in. Deliberately the same union as
 * `QuestStatus`, since three of the five sources answer straight out of a
 * `QuestManager` — but restated rather than imported, because the other two have
 * no `QuestManager` to take it from and would otherwise be importing a type from
 * a class they never touch.
 */
export type TrackerStatus = 'available' | 'active' | 'completed' | 'failed';

/** A tile the Journal can point the player at. */
export interface TrackerTarget {
  readonly x: number;
  readonly y: number;
}

export interface TrackerEntry {
  /** Stable across frames — this is what a pin is remembered by. */
  readonly id: string;
  readonly name: string;
  readonly status: TrackerStatus;
  /** What to do next, in one line: "Survive the assault (18s left)". */
  readonly objective: string;
  /** Where to find it, when that is not obvious: "Shady lurks by the notice board". */
  readonly hint?: string;
  /** Tile to point a chevron and the world arrow at. */
  readonly target?: TrackerTarget;
}

/** Anything the scene can ask for journal lines. */
export interface TrackerSource {
  trackerEntries(): ReadonlyArray<TrackerEntry>;
}

/**
 * Reading order: what needs doing, then what could be started, then what went
 * wrong, then what is done.
 *
 * A number per status rather than a comparator chain, so the order is a list
 * that can be read rather than a series of pairwise rules.
 */
const STATUS_ORDER: Record<TrackerStatus, number> = {
  active: 0,
  available: 1,
  failed: 2,
  completed: 3,
};

/** Whether a status counts toward the Journal button's badge number. */
export function isOutstanding(status: TrackerStatus): boolean {
  return status === 'active' || status === 'available';
}

/**
 * The entry the world arrow should point at, or null.
 *
 * Resolved against the entries handed in rather than remembered, so a pin on a
 * quest that has since finished — or that this floor does not have — simply
 * stops pointing rather than pointing somewhere stale.
 */
export function resolvePinnedEntry(
  pinnedId: string | null,
  entries: ReadonlyArray<TrackerEntry>,
): TrackerEntry | null {
  if (pinnedId === null) return null;
  const pinned = entries.find((entry) => entry.id === pinnedId);
  if (pinned?.target === undefined) return null;
  if (!isOutstanding(pinned.status)) return null;
  return pinned;
}

/**
 * Merges every source's entries into one list in reading order.
 *
 * A stable sort by status only — within a status the sources' own order stands,
 * which is the order the scene lists them in and therefore roughly the order the
 * player meets them.
 */
export function collectTrackerEntries(
  sources: ReadonlyArray<TrackerSource | null | undefined>,
): TrackerEntry[] {
  const entries: TrackerEntry[] = [];
  for (const source of sources) {
    if (source === null || source === undefined) continue;
    entries.push(...source.trackerEntries());
  }
  entries.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  return entries;
}

/** Seconds a frame count stands for, for objective lines that count one down. */
const FRAMES_PER_SECOND = 60;

/** "18s" for a countdown stated in frames, so every objective line phrases one the same way. */
export function secondsLabel(frames: number): string {
  return `${Math.max(0, Math.ceil(frames / FRAMES_PER_SECOND))}s`;
}
