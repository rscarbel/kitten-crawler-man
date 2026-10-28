/**
 * The registry `GameMap.generateInterior` reads: one layout builder per house,
 * tavern or shop, each a pure function of the room's shell (`w`, `h`, `floorType`)
 * returning the list of props and tile writes to apply. Adding a new named
 * interior means adding one file here and one line to this map — never a
 * new branch inside `GameMap`.
 */

import type { TownInteriorLayoutEntry } from './types';
import type { ContractAreaRecord } from '../../contractAreas';
import type { PlannedBuildingId, BuildingId } from '../../buildingIds';
import { buildPlumblineFarmLayout } from './plumblineFarm';
import { buildBlackwoodLodgeContractAreas, buildBlackwoodLodgeLayout } from './blackwoodLodge';
import { buildOldLorisCottageContractAreas, buildOldLorisCottageLayout } from './oldLorisCottage';
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
 * Each building's own layout. `GameMap` falls back to the generic house
 * furniture pass for any `house`-kind building not listed here.
 */
export const INTERIOR_LAYOUTS_BY_BUILDING: ReadonlyMap<BuildingId, TownInteriorLayoutBuilder> =
  new Map([
    ['taloncrest_builder_farm', buildPlumblineFarmLayout],
    ['taloncrest_garrison_lodge', buildBlackwoodLodgeLayout],
    ['taloncrest_old_lady_cottage', buildOldLorisCottageLayout],
    ['taloncrest_crafting_house', buildCartwrightsWorkshopLayout],
    ['taloncrest_apothecary', buildHerbAndRemedyLayout],
    ['taloncrest_inn', buildSleepingCatInnLayout],
    ['taloncrest_smithy', buildRustyAnvilLayout],
    ['taloncrest_mill_farm', buildMillersFarmLayout],
    ['taloncrest_flagon_tavern', buildHornedFlagonLayout],
    ['taloncrest_pub', buildSunkenStumpPubLayout],
    ['taloncrest_temple', buildTempleOfTheSkyLayout],
    ['taloncrest_tattoo_parlor', buildQuietNeedleLayout],
    ['taloncrest_barracks', buildBarracksLayout],
  ]);

/** The `store`-kind layout (today: only the General Store), applied by building type rather than name. */
export { buildGeneralStoreLayout, buildGeneralStoreContractAreas };

/** One building's construction-contract rects, computed from the same room shell its layout is. */
export type TownInteriorContractAreasBuilder = (w: number, h: number) => ContractAreaRecord;

/**
 * Each building's construction-contract rects, beside
 * `INTERIOR_LAYOUTS_BY_BUILDING`. Each builder lives beside its layout and reads
 * the same derived positions, so a moved fitting carries its rects with it.
 * A building absent here offers no area spots.
 */
export const INTERIOR_CONTRACT_AREAS_BY_BUILDING: ReadonlyMap<
  PlannedBuildingId,
  TownInteriorContractAreasBuilder
> = new Map([
  ['taloncrest_garrison_lodge', buildBlackwoodLodgeContractAreas],
  ['taloncrest_old_lady_cottage', buildOldLorisCottageContractAreas],
  ['taloncrest_crafting_house', buildCartwrightsWorkshopContractAreas],
  ['taloncrest_apothecary', buildHerbAndRemedyContractAreas],
  ['taloncrest_inn', buildSleepingCatInnContractAreas],
  ['taloncrest_smithy', buildRustyAnvilContractAreas],
  ['taloncrest_mill_farm', buildMillersFarmContractAreas],
  ['taloncrest_flagon_tavern', buildHornedFlagonContractAreas],
  ['taloncrest_pub', buildSunkenStumpPubContractAreas],
  ['taloncrest_temple', buildTempleOfTheSkyContractAreas],
  ['taloncrest_tattoo_parlor', buildQuietNeedleContractAreas],
  ['taloncrest_barracks', buildBarracksContractAreas],
]);

export {
  INN_INTERIOR_W,
  INN_INTERIOR_H,
  INN_TAPROOM_FIRST_ROW,
  INN_TAPROOM_LAST_ROW,
} from './sleepingCatInn';
export { BARRACKS_INTERIOR_W, BARRACKS_INTERIOR_H } from './barracks';
