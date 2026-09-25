/**
 * Which painted sheets a floor's asset groups stand for.
 *
 * The scenes already say what a floor needs as a list of `AssetGroup`s, and
 * `prewarmGroups` turns that into fetched sheets. This turns the same list into
 * painted ones, so a floor asks for its environment art once and in one
 * vocabulary rather than naming families by hand.
 */

import type { AssetGroup } from '../../core/assetGroups';
import type { TilePoint, TownPlan } from '../../map/town/townPlan';
import {
  BOSS_ROOM_SALT,
  BUILDING_SALT,
  CAMP_SALT,
  PROP_SALT,
  ROCK_SALT,
  TREE_SALT,
  VILLAGE_SALT,
  floorArtSubSeed,
} from '../../map/ground/floorArtSeed';
import { BOSS_ROOM_ASSET_GROUPS, bossRoomSheetPlans } from './bossRoomSheets';
import { campSheetPlans } from './campSheets';
import { requestBuildingSheets } from '../buildinggen/runtimeBuildingSheets';
import { clubFurnitureSheetPlans } from './clubFurnitureSheets';
import { destructiblePropSheetPlans } from './destructiblePropSheets';
import { dungeonSignSheetPlans } from './dungeonSignSheets';
import { overCitySheetPlans } from './overCitySheets';
import { requestPropSheets } from './runtimePropSheets';
import { rockSheetPlans } from './rockSheets';
import { TREE_READY_ROWS, treeSheetPlans } from './treeSheets';
import { townscapeSheetPlans } from './townscapeSheets';
import { villageSheetPlans } from './villageSheets';

/**
 * The art seed the destructible props are painted at: none.
 *
 * They are `core` art — a barrel, a crate and a torch stand on every floor of
 * the game — so their sheets are deliberately kept across a floor change rather
 * than repainted at every set of stairs. A sheet that survives the floor it was
 * painted on cannot honestly carry that floor's seed: it would freeze whichever
 * floor happened to paint it first and wear that look everywhere after. Nothing
 * about a crate reads as belonging to a particular floor, so there is no picture
 * to lose by leaving them at the seed they were reviewed against.
 */
const UNSEEDED_CORE_PROPS = 0;

export interface EnvironmentSheetRequest {
  /** Re-bake the tile chunks that took a fallback colour before a sheet landed. */
  readonly onSheetPainted?: () => void;
  /**
   * The town plan and where the party arrives, so the facades — the only family
   * slow enough for the order to matter — are painted outward from the street
   * the player is standing in.
   */
  readonly town?: { readonly plan: TownPlan; readonly spawnTile: TilePoint };
}

/**
 * Queues the painted environment art the given asset groups stand for.
 *
 * Cheap to call on every floor entry: a sheet already painted or already queued
 * is skipped. Ordered so the art a floor cannot do without arrives first — the
 * furniture every floor carries before the town's, the town's own before its
 * wilderness, and its idle trees before their fire.
 */
export function requestEnvironmentSheetsForGroups(
  groups: ReadonlyArray<AssetGroup>,
  request: EnvironmentSheetRequest = {},
): void {
  const onSheetPainted = request.onSheetPainted;
  const wanted = new Set(groups);
  if (wanted.has('core')) {
    requestPropSheets(destructiblePropSheetPlans(UNSEEDED_CORE_PROPS), {
      variesWithFloorSeed: false,
      onSheetPainted,
    });
    requestPropSheets(dungeonSignSheetPlans(), {
      // The lettering is the same on every floor, so a repaint per floor buys nothing.
      variesWithFloorSeed: false,
      onSheetPainted,
    });
  }
  if (wanted.has('town')) {
    requestPropSheets(clubFurnitureSheetPlans(floorArtSubSeed(PROP_SALT)), {
      // The club's wood tone, awning stripe and felt are seeded, so a town
      // painted under a new art seed gets a club dressed to match it.
      variesWithFloorSeed: true,
      onSheetPainted,
    });
    requestPropSheets([...townscapeSheetPlans(), ...overCitySheetPlans()], {
      // Street furniture carries no floor seed: a lamp is the same lamp
      // wherever it is hung, and the town's own signage is a picture of a place.
      variesWithFloorSeed: false,
      onSheetPainted,
    });
    // Last inside the town, because a facade is twenty times the work of every
    // lamp and stall put together and each one publishes the moment its own
    // stages are done — so the street furniture is up in a fraction of a second
    // and the buildings arrive one at a time behind it.
    requestBuildingSheets(floorArtSubSeed(BUILDING_SALT), {
      plan: request.town?.plan,
      nearestTo: request.town?.spawnTile,
      onSheetPainted,
    });
  }
  if (wanted.has('overworld')) {
    requestPropSheets(treeSheetPlans(floorArtSubSeed(TREE_SALT)), {
      variesWithFloorSeed: true,
      readyRows: TREE_READY_ROWS,
      onSheetPainted,
    });
    requestPropSheets(rockSheetPlans(floorArtSubSeed(ROCK_SALT)), {
      variesWithFloorSeed: true,
      onSheetPainted,
    });
    requestPropSheets(campSheetPlans(floorArtSubSeed(CAMP_SALT)), {
      variesWithFloorSeed: true,
      onSheetPainted,
    });
    // Every floor-3 world has the village, so its furniture is overworld art
    // rather than a group of its own.
    requestPropSheets(villageSheetPlans(floorArtSubSeed(VILLAGE_SALT)), {
      variesWithFloorSeed: true,
      onSheetPainted,
    });
  }
  // Painted when the floor loads rather than when a room seals: a room's
  // dressing is on screen from the doorway, long before the fight starts.
  for (const group of BOSS_ROOM_ASSET_GROUPS) {
    if (!wanted.has(group)) continue;
    requestPropSheets(bossRoomSheetPlans(group, floorArtSubSeed(BOSS_ROOM_SALT)), {
      variesWithFloorSeed: true,
      onSheetPainted,
    });
  }
}
