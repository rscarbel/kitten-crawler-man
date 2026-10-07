/**
 * The registry `GameMap.generateInterior` reads instead of the old
 * `switch (buildingName)`: one layout builder per named house, tavern or
 * shop, each a pure function of the room's shell (`w`, `h`, `floorType`)
 * returning the list of props and tile writes to apply. Adding a new named
 * interior means adding one file here and one line to this map — never a
 * new branch inside `GameMap`.
 */

import type { TownInteriorLayoutEntry } from './types';
import type { ContractAreaRecord } from '../../contractAreas';
import type { PlannedBuildingName } from '../townPlan';
import { buildPlumblineFarmLayout } from './plumblineFarm';
import { buildBlackwoodLodgeContractAreas, buildBlackwoodLodgeLayout } from './blackwoodLodge';
import {
  buildOldHildasCottageContractAreas,
  buildOldHildasCottageLayout,
} from './oldHildasCottage';
import {
  buildCartwrightsWorkshopContractAreas,
  buildCartwrightsWorkshopLayout,
} from './cartwrightsWorkshop';
import { buildHerbAndRemedyContractAreas, buildHerbAndRemedyLayout } from './herbAndRemedy';
import { buildSleepingCatInnContractAreas, buildSleepingCatInnLayout } from './sleepingCatInn';
import { buildRustyAnvilContractAreas, buildRustyAnvilLayout } from './rustyAnvil';
import { buildMillersFarmContractAreas, buildMillersFarmLayout } from './millersFarm';
import { buildHornedFlagonContractAreas, buildHornedFlagonLayout } from './hornedFlagon';
import { buildSunkenStumpPubContractAreas, buildSunkenStumpPubLayout } from './sunkenStumpPub';
import { buildTempleOfTheSkyContractAreas, buildTempleOfTheSkyLayout } from './templeOfTheSky';
import { buildQuietNeedleContractAreas, buildQuietNeedleLayout } from './quietNeedle';
import { buildBarracksContractAreas, buildBarracksLayout } from './barracks';
import { buildGeneralStoreContractAreas, buildGeneralStoreLayout } from './generalStore';

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
export { buildGeneralStoreLayout, buildGeneralStoreContractAreas };

/** One building's construction-contract rects, computed from the same room shell its layout is. */
export type TownInteriorContractAreasBuilder = (w: number, h: number) => ContractAreaRecord;

/**
 * Every named building's construction-contract rects, keyed exactly as
 * `NAMED_INTERIOR_LAYOUTS`. Each builder lives beside its layout and reads
 * the same derived positions, so a moved fitting carries its rects with it.
 * A building absent here offers no area spots.
 */
export const NAMED_INTERIOR_CONTRACT_AREAS: ReadonlyMap<
  PlannedBuildingName,
  TownInteriorContractAreasBuilder
> = new Map([
  ['Blackwood Lodge', buildBlackwoodLodgeContractAreas],
  ["Old Hilda's Cottage", buildOldHildasCottageContractAreas],
  ["Cartwright's Workshop", buildCartwrightsWorkshopContractAreas],
  ['Herb & Remedy', buildHerbAndRemedyContractAreas],
  ['The Sleeping Cat Inn', buildSleepingCatInnContractAreas],
  ['The Rusty Anvil', buildRustyAnvilContractAreas],
  ["Miller's Farm", buildMillersFarmContractAreas],
  ['The Horned Flagon', buildHornedFlagonContractAreas],
  ['The Sunken Stump Pub', buildSunkenStumpPubContractAreas],
  ['Temple of the Sky', buildTempleOfTheSkyContractAreas],
  ['The Quiet Needle', buildQuietNeedleContractAreas],
  ['The Barracks', buildBarracksContractAreas],
]);

export {
  INN_INTERIOR_W,
  INN_INTERIOR_H,
  INN_TAPROOM_FIRST_ROW,
  INN_TAPROOM_LAST_ROW,
} from './sleepingCatInn';
export { BARRACKS_INTERIOR_W, BARRACKS_INTERIOR_H } from './barracks';
