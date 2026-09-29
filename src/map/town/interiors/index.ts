/**
 * The registry `GameMap.generateInterior` reads instead of the old
 * `switch (buildingName)`: one layout builder per named house, tavern or
 * shop, each a pure function of the room's shell (`w`, `h`, `floorType`)
 * returning the list of props and tile writes to apply. Adding a new named
 * interior means adding one file here and one line to this map — never a
 * new branch inside `GameMap`.
 */

import type { TownInteriorLayoutEntry } from './types';
import { buildPlumblineFarmLayout } from './plumblineFarm';
import { buildBlackwoodLodgeLayout } from './blackwoodLodge';
import { buildOldHildasCottageLayout } from './oldHildasCottage';
import { buildCartwrightsWorkshopLayout } from './cartwrightsWorkshop';
import { buildHerbAndRemedyLayout } from './herbAndRemedy';
import { buildSleepingCatInnLayout } from './sleepingCatInn';
import { buildRustyAnvilLayout } from './rustyAnvil';
import { buildMillersFarmLayout } from './millersFarm';
import { buildHornedFlagonLayout } from './hornedFlagon';
import { buildSunkenStumpPubLayout } from './sunkenStumpPub';
import { buildTempleOfTheSkyLayout } from './templeOfTheSky';
import { buildQuietNeedleLayout } from './quietNeedle';
import { buildBarracksLayout } from './barracks';
import { buildGeneralStoreLayout } from './generalStore';

export type TownInteriorLayoutBuilder = (
  w: number,
  h: number,
  floorType: number,
) => TownInteriorLayoutEntry[];

/**
 * Named-building layouts, keyed exactly as `buildingEntries` names them
 * (a renamed building silently loses its layout otherwise). `GameMap` falls back to the generic house furniture pass for
 * any `house`-kind building not listed here.
 */
export const NAMED_INTERIOR_LAYOUTS: ReadonlyMap<string, TownInteriorLayoutBuilder> = new Map([
  ['Plumbline Farm', buildPlumblineFarmLayout],
  ['Blackwood Lodge', buildBlackwoodLodgeLayout],
  ["Old Hilda's Cottage", buildOldHildasCottageLayout],
  ["Cartwright's Workshop", buildCartwrightsWorkshopLayout],
  ['Herb & Remedy', buildHerbAndRemedyLayout],
  ['The Sleeping Cat Inn', buildSleepingCatInnLayout],
  ['The Rusty Anvil', buildRustyAnvilLayout],
  ["Miller's Farm", buildMillersFarmLayout],
  ['The Horned Flagon', buildHornedFlagonLayout],
  ['The Sunken Stump Pub', buildSunkenStumpPubLayout],
  ['Temple of the Sky', buildTempleOfTheSkyLayout],
  ['The Quiet Needle', buildQuietNeedleLayout],
  ['The Barracks', buildBarracksLayout],
]);

/** The `store`-kind layout (today: only the General Store), applied by building type rather than name. */
export { buildGeneralStoreLayout };

export {
  INN_INTERIOR_W,
  INN_INTERIOR_H,
  INN_TAPROOM_FIRST_ROW,
  INN_TAPROOM_LAST_ROW,
} from './sleepingCatInn';
export { BARRACKS_INTERIOR_W, BARRACKS_INTERIOR_H } from './barracks';
