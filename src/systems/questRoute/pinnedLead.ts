/**
 * Where the Journal's pin leads the party, outdoors and in: the one reading
 * the scenes draw their arrow, beacon, chevron and way-out route from. Pure,
 * so a gate can follow a pin across a save without a scene.
 */

import { TILE_SIZE } from '../../core/constants';
import type { JournalProgress } from '../../core/quests/JournalProgress';
import { resolvePinnedEntry, type TilePosition, type TrackerEntry } from '../questTracker';
import {
  interiorObjectiveRoute,
  type InteriorObjectiveRoute,
  type InteriorStanding,
} from './interiorObjectiveRoute';

type PinnedJournal = Pick<JournalProgress, 'pinnedTrackerId'>;

/** The tile a body in world pixels stands on, as a pinned header's steps are ranked from it. */
export function standingTile(body: { readonly x: number; readonly y: number }): TilePosition {
  return { x: Math.floor(body.x / TILE_SIZE), y: Math.floor(body.y / TILE_SIZE) };
}

/** The Journal entry the street leads the steered crawler to, or null when the pin leads nowhere. */
export function pinnedStreetEntry(
  journal: PinnedJournal,
  entries: ReadonlyArray<TrackerEntry>,
  steered: { readonly x: number; readonly y: number },
): TrackerEntry | null {
  return resolvePinnedEntry(journal.pinnedTrackerId, entries, standingTile(steered));
}

/** The pinned objective as a party indoors is led to it. */
export interface InteriorPinnedLead {
  /** The entry the pin resolves to from the building's street door, or null. */
  readonly entry: TrackerEntry | null;
  readonly route: InteriorObjectiveRoute;
}

/**
 * The pin resolved from the building's street door, since every objective
 * outside is reached through it, and the way to it from the storey the party
 * stands on.
 */
export function pinnedInteriorLead(
  journal: PinnedJournal,
  entries: ReadonlyArray<TrackerEntry>,
  here: InteriorStanding & { readonly doorTile: TilePosition },
): InteriorPinnedLead {
  const entry = resolvePinnedEntry(journal.pinnedTrackerId, entries, here.doorTile);
  return { entry, route: interiorObjectiveRoute(entry?.target, here) };
}
