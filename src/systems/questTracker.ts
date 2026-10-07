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
import type { ObjectiveBeaconFootprint } from '../ui/ObjectiveBeacon';

export type TrackerStatus = 'available' | 'active' | 'completed' | 'failed';

/**
 * A tile the Journal can point the player at, and how big the thing on it is.
 *
 * The footprint is inherited from the beacon's own type rather than restated, so
 * a source describing a three-tile doorway cannot describe it in terms the
 * beacon does not read. A source that omits it marks one tile, as every source
 * used to.
 */
export interface TrackerTarget extends ObjectiveBeaconFootprint {
  readonly x: number;
  readonly y: number;
  /**
   * Set for a target that is a character rather than a place.
   *
   * **Rule: the overlay beacon is never drawn over a character.** It is painted
   * after every world entity, so on a person, bear or boss it stands in front of
   * them and washes them out, and it samples a tile that lags their movement.
   * A character marks itself instead: its own render draws `drawQuestBeacon`
   * behind its body, Y-sorted and at its exact position. Build every such target
   * with {@link characterTarget} so the flag cannot be forgotten. The world arrow
   * and the minimap chevron still point at it.
   */
  readonly wearsOwnMarker?: boolean;
  /**
   * The beam stands here only while the player has pinned this entry, never
   * merely because it is on offer. For a giver who waits indoors and wears his
   * own glow there: an unasked-for beam on his door would read as a quest
   * already under way, but once the player picks the entry the door is the
   * answer to where to go.
   */
  readonly litOnlyWhenPinned?: boolean;
  /**
   * The world arrow stands down as soon as the target is anywhere on screen,
   * rather than only once the player is nearly on top of it. For a target
   * that is plain to see from a distance, like an army on the march.
   */
  readonly hidesArrowOnScreen?: boolean;
  /**
   * The beam is drawn in the Y-sorted pass at its own ground line instead of
   * before it, so a building north of it can never cover it. For a beam stood
   * in the street in front of a building rather than on the building itself.
   */
  readonly standsInFront?: boolean;
}

/** A tile target for a character, which the scene will not stand the overlay beacon on. */
export function characterTarget(tile: { readonly x: number; readonly y: number }): TrackerTarget {
  return { x: tile.x, y: tile.y, wearsOwnMarker: true };
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
  /**
   * The id of this entry's quest header, when this entry is one of several
   * live steps within a single quest. The Journal renders it indented under
   * that header rather than as its own top-level row — the anchor questline is
   * the source that needs this: with three shards outstanding it would
   * otherwise print "The Anchor is Broken" three times.
   */
  readonly parentId?: string;
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
 * What separates a quest's own id from the step within it, in a tracker id.
 *
 * The anchor questline is the one that splits: accepted, it stops emitting a
 * single `anchor_shards` row and starts emitting one row per outstanding shard.
 * A pin naming only the quest therefore has to survive the step changing under
 * it, which is the difference between a pin that outlives one shard and a pin
 * that goes dead the moment the player picks one up.
 */
const TRACKER_STEP_SEPARATOR = ':';

/** Whether a pinned id names this entry — either exactly, or as its quest prefix. */
export function pinMatchesEntry(pinnedId: string, entry: TrackerEntry): boolean {
  return entry.id === pinnedId || entry.id.startsWith(`${pinnedId}${TRACKER_STEP_SEPARATOR}`);
}

/** Whether an entry is somewhere the player can actually be sent right now. */
function isFollowable(entry: TrackerEntry): boolean {
  return entry.target !== undefined && isOutstanding(entry.status);
}

/** A tile position, for ranking a header's sub-steps by distance. */
export interface TilePosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Among `header`'s own sub-steps (`parentId === header.id`), the followable one
 * whose target sits closest to `fromTile` — squared distance, since only the
 * ordering matters. Null when the header has no followable sub-steps of its
 * own, which is what lets a plain (non-multi-step) pin fall through unchanged.
 */
function nearestFollowableStep(
  header: TrackerEntry,
  entries: ReadonlyArray<TrackerEntry>,
  fromTile: TilePosition,
): TrackerEntry | null {
  let nearest: TrackerEntry | null = null;
  let nearestDistSq = Infinity;
  for (const entry of entries) {
    if (entry.parentId !== header.id || !isFollowable(entry) || entry.target === undefined) {
      continue;
    }
    const dx = entry.target.x - fromTile.x;
    const dy = entry.target.y - fromTile.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = entry;
    }
  }
  return nearest;
}

/**
 * The entry the world arrow should point at, or null.
 *
 * Resolved against the entries handed in rather than remembered, so a pin on a
 * quest that has since finished — or that this floor does not have — simply
 * stops pointing rather than pointing somewhere stale.
 *
 * An unset pin resolves to nothing, deliberately: it is only ever set when a
 * quest is *accepted* (see the `questStarted` handler), so no pin means no
 * quest has been taken yet, and the world arrow and objective beacon should
 * say exactly that rather than picking one for the player. A quest that has
 * something to offer but has not been accepted advertises itself through
 * {@link availableTargets} instead, which carries no implication that
 * anything is under way.
 *
 * `fromTile`, when given, breaks the tie for a pin that names a multi-step
 * quest's header rather than one of its steps: the header itself is swapped
 * for whichever of its outstanding sub-steps is nearest, so the arrow, the
 * beacon and the minimap chevron all send the player somewhere reachable
 * rather than always the first step in authoring order. Every caller that
 * points at something should pass it; omitting it (as the "is this pin still
 * live" check does) just keeps the header as the answer.
 */
export function resolvePinnedEntry(
  pinnedId: string | null,
  entries: ReadonlyArray<TrackerEntry>,
  fromTile?: TilePosition,
): TrackerEntry | null {
  if (pinnedId === null) return null;
  const pinned = entries.find((entry) => pinMatchesEntry(pinnedId, entry) && isFollowable(entry));
  if (pinned === undefined) return null;
  if (fromTile === undefined) return pinned;
  return nearestFollowableStep(pinned, entries, fromTile) ?? pinned;
}

/**
 * Every quest still on offer, unaccepted — the "point of interest" layer.
 *
 * Independent of the pin: a quest giver with something to offer keeps
 * advertising it whether or not the player has taken any quest at all, which
 * is a different statement from "this is what you are currently doing".
 */
export function availableTargets(
  entries: ReadonlyArray<TrackerEntry>,
): ReadonlyArray<TrackerTarget> {
  const targets: TrackerTarget[] = [];
  for (const entry of entries) {
    if (entry.status !== 'available' || entry.target === undefined) continue;
    targets.push(entry.target);
  }
  return targets;
}

/**
 * Every place that gets the overlay beam this frame, each once: every quest
 * still on offer, then the pinned objective's tile.
 *
 * A pinned quest that is still only on offer is also in the available list;
 * drawing it twice would stack two additive beams at double brightness.
 */
export function objectiveBeamTargets(
  pinned: TrackerTarget | null,
  entries: ReadonlyArray<TrackerEntry>,
): TrackerTarget[] {
  const beams: TrackerTarget[] = [];
  let pinnedAlreadyLit = false;
  for (const target of availableTargets(entries)) {
    if (target.wearsOwnMarker === true || target.litOnlyWhenPinned === true) continue;
    if (pinned !== null && pinned.x === target.x && pinned.y === target.y) {
      pinnedAlreadyLit = true;
    }
    beams.push(target);
  }
  if (pinned !== null && pinned.wearsOwnMarker !== true && !pinnedAlreadyLit) {
    beams.push(pinned);
  }
  return beams;
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
