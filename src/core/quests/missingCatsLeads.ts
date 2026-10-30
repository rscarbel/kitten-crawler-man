/**
 * Where the investigation of "A Cat Always Comes Back" sends the party next.
 *
 * Each clue is found at one place, declared once here. The party's lines that
 * send them on read the place's name from this table, and the Journal's arrow
 * reads its building, so what the party says and where the arrow points can
 * never name two different doors.
 */

import type { BuildingId } from '../../map/buildingIds';
import {
  CLUE_SITE_CLUES,
  MISSING_CATS_CLUE_SITES,
  clueSiteSolved,
  type MissingCatsClueId,
  type MissingCatsClueSite,
  type MissingCatsProgress,
} from './missingCatsProgress';

/** A place a clue is found: the building, and how the party names it aloud. */
export interface MissingCatsPlace {
  readonly building: BuildingId;
  readonly name: string;
}

const INN_PLACE = {
  building: 'taloncrest_inn',
  name: 'the Sleeping Cat Inn',
} as const satisfies MissingCatsPlace;
const COTTAGE_PLACE = {
  building: 'taloncrest_old_lady_cottage',
  name: "Old Lori's cottage",
} as const satisfies MissingCatsPlace;
const APOTHECARY_PLACE = {
  building: 'taloncrest_apothecary',
  name: 'Herb & Remedy',
} as const satisfies MissingCatsPlace;
const STORE_PLACE = {
  building: 'taloncrest_general_store',
  name: 'the General Store',
} as const satisfies MissingCatsPlace;
const MILL_PLACE = {
  building: 'taloncrest_mill_farm',
  name: "Miller's Farm",
} as const satisfies MissingCatsPlace;

/**
 * Where each clue is found. The inn's is the scent on the street outside its
 * door, which the Journal marks at the trail's start rather than the door.
 */
export const CLUE_PLACES = {
  inn_scent_trail: INN_PLACE,
  cottage_owner_heard: COTTAGE_PLACE,
  cottage_latch: COTTAGE_PLACE,
  apothecary_owner_heard: APOTHECARY_PLACE,
  apothecary_tuna_dish: APOTHECARY_PLACE,
  store_tuna_ledger: STORE_PLACE,
  mill_owner_heard: MILL_PLACE,
  mill_hayloft_feather: MILL_PLACE,
} as const satisfies Record<MissingCatsClueId, MissingCatsPlace>;

/** Which site each clue belongs to, read off {@link CLUE_SITE_CLUES} so the two never disagree. */
function siteOf(clue: MissingCatsClueId): MissingCatsClueSite {
  const site = MISSING_CATS_CLUE_SITES.find((candidate) =>
    CLUE_SITE_CLUES[candidate].some((held) => held === clue),
  );
  if (site === undefined) throw new Error(`the clue ${clue} belongs to no site`);
  return site;
}

/** The first clue at `site` not yet found, or null once the site is solved. */
export function nextClueAtSite(
  progress: Pick<MissingCatsProgress, 'clues'>,
  site: MissingCatsClueSite,
): MissingCatsClueId | null {
  return CLUE_SITE_CLUES[site].find((clue) => !progress.clues.has(clue)) ?? null;
}

function siteStarted(
  progress: Pick<MissingCatsProgress, 'clues'>,
  site: MissingCatsClueSite,
): boolean {
  return CLUE_SITE_CLUES[site].some((clue) => progress.clues.has(clue));
}

/**
 * The clue the story points at next, or null once every clue is in. The site
 * the party last found something at, while it still holds more; then a site
 * they started and left; then the next untouched site in the order the notice
 * board names them. The clue set keeps the order clues were found in, a save
 * included, so "last found" survives a reload.
 */
export function nextInvestigationClue(
  progress: Pick<MissingCatsProgress, 'clues'>,
): MissingCatsClueId | null {
  let lastFound: MissingCatsClueId | null = null;
  for (const clue of progress.clues) lastFound = clue;
  if (lastFound !== null) {
    const lastSite = siteOf(lastFound);
    const stillThere = nextClueAtSite(progress, lastSite);
    if (stillThere !== null) return stillThere;
  }
  const open = MISSING_CATS_CLUE_SITES.filter((site) => !clueSiteSolved(progress, site));
  const resumed = open.find((site) => siteStarted(progress, site));
  if (open.length === 0) return null;
  return nextClueAtSite(progress, resumed ?? open[0]);
}

/**
 * The next clue, when finding `found` moves the story to another place, so
 * the party says where before the Journal points there; null while the next
 * clue is where `found` was, or once none is left.
 */
export function leadMovesOn(
  progress: Pick<MissingCatsProgress, 'clues'>,
  found: MissingCatsClueId,
): MissingCatsClueId | null {
  const next = nextInvestigationClue(progress);
  if (next === null) return null;
  return CLUE_PLACES[next].building === CLUE_PLACES[found].building ? null : next;
}
