/**
 * Which painted sheets a floor's asset groups stand for.
 *
 * The scenes already say what a floor needs as a list of `AssetGroup`s, and
 * `prewarmGroups` turns that into fetched sheets. This turns the same list into
 * painted ones, so a floor asks for its environment art once and in one
 * vocabulary rather than naming families by hand.
 */

import { ASSET_GROUPS, type AssetGroup } from '../../core/assetGroups';
import { getManifestEntry, sheetSizePx, type SpriteKey } from '../../core/SpriteLoader';
import {
  BOSS_ROOM_SALT,
  CAMP_SALT,
  PROP_SALT,
  ROCK_SALT,
  TREE_SALT,
  VILLAGE_SALT,
  floorArtSubSeed,
} from '../../map/ground/floorArtSeed';
import { BOSS_ROOM_ASSET_GROUPS, bossRoomSheetPlans } from './bossRoomSheets';
import { bathroomSheetPlans } from './bathroomSheets';
import { campSheetPlans } from './campSheets';
import { cellarPropSheetPlans } from './cellarPropSheets';
import { circusSheetPlans } from './circusSheets';
import { BUILDING_KEYS, buildingLifeKeys } from '../buildinggen/runtimeBuildingSheets';
import { clubFurnitureSheetPlans } from './clubFurnitureSheets';
import { destructiblePropSheetPlans } from './destructiblePropSheets';
import { dungeonSignSheetPlans } from './dungeonSignSheets';
import { overCitySheetPlans } from './overCitySheets';
import { requestPropSheets } from './runtimePropSheets';
import { propSheetSize, type PropSheetPlan } from './propSheetPlan';
import { floorTwoPropVariantSheetPlans } from './propVariantSheets';
import { remainsSheetPlans } from './remainsSheets';
import { rockSheetPlans } from './rockSheets';
import { serviceFurnitureSheetPlans } from './serviceFurnitureSheets';
import { stairwellSheetPlans } from './stairwellSheets';
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
}

/** A family of prop sheets requested together, and how the cache is to hold them. */
interface PropFamily {
  readonly plans: ReadonlyArray<PropSheetPlan>;
  readonly variesWithFloorSeed: boolean;
  readonly readyRows?: number;
}

/**
 * One entry in a floor's paint order: a family of prop sheets, or the town's
 * buildings, which are asked for building by building as the party nears them
 * (`EnvironmentSheetResidentSet`) rather than with the floor.
 */
type EnvironmentFamily =
  { readonly kind: 'props'; readonly family: PropFamily } | { readonly kind: 'facades' };

function props(
  plans: ReadonlyArray<PropSheetPlan>,
  variesWithFloorSeed: boolean,
  readyRows?: number,
): EnvironmentFamily {
  return { kind: 'props', family: { plans, variesWithFloorSeed, readyRows } };
}

/**
 * The painted families the given asset groups stand for, in the order they are
 * painted. Ordered so the art a floor cannot do without arrives first — the
 * furniture every floor carries before the town's, the town's own before its
 * wilderness, and its idle trees before their fire.
 */
function environmentFamilies(groups: ReadonlyArray<AssetGroup>): EnvironmentFamily[] {
  const wanted = new Set(groups);
  const wantedKeys = new Set<SpriteKey>(groups.flatMap((group) => ASSET_GROUPS[group]));
  const families: EnvironmentFamily[] = [];
  if (wanted.has('core')) {
    families.push(props(destructiblePropSheetPlans(UNSEEDED_CORE_PROPS), false));
    // The lettering is the same on every floor, so a repaint per floor buys nothing.
    families.push(props(dungeonSignSheetPlans(), false));
    // Each place's stairwell is its own row, picked at the draw site, so the
    // sheet is the same whichever floor painted it.
    families.push(props(stairwellSheetPlans(), false));
  }
  // A skull is the same skull on every floor; its looks are picked per tile.
  // Only the sheets the groups list: the overworld scatters loose bones but
  // never lays out a skeleton.
  const remains = remainsSheetPlans().filter((plan) => wantedKeys.has(plan.key));
  if (remains.length > 0) families.push(props(remains, false));
  if (wanted.has('floor1_tileset')) {
    // A cask is the same cask on every run; its variants are picked per tile
    // at draw time, so the sheet carries no floor seed.
    families.push(props(cellarPropSheetPlans(), false));
  }
  if (wanted.has('floor2_tileset')) {
    // The steel drum and its kin stand in for the core props on this floor,
    // and a locker is the same locker on every run: their looks are picked per
    // tile, so the sheets carry no floor seed.
    families.push(props(floorTwoPropVariantSheetPlans(), false));
    families.push(props(serviceFurnitureSheetPlans(), false));
    // Every copy of the clogged bathroom is fitted out alike, on every run.
    families.push(props(bathroomSheetPlans(), false));
  }
  if (wanted.has('town_interior')) {
    // The club's wood tone, awning stripe and felt are seeded, so a town
    // painted under a new art seed gets a club dressed to match it.
    families.push(props(clubFurnitureSheetPlans(floorArtSubSeed(PROP_SALT)), true));
  }
  if (wanted.has('town')) {
    // Street furniture carries no floor seed: a lamp is the same lamp
    // wherever it is hung, and the town's own signage is a picture of a place.
    families.push(props([...townscapeSheetPlans(), ...overCitySheetPlans()], false));
    families.push({ kind: 'facades' });
  }
  if (wanted.has('overworld')) {
    families.push(props(treeSheetPlans(floorArtSubSeed(TREE_SALT)), true, TREE_READY_ROWS));
    families.push(props(rockSheetPlans(floorArtSubSeed(ROCK_SALT)), true));
    families.push(props(campSheetPlans(floorArtSubSeed(CAMP_SALT)), true));
    // Every floor-3 world has the village, so its furniture is overworld art
    // rather than a group of its own.
    families.push(props(villageSheetPlans(floorArtSubSeed(VILLAGE_SALT)), true));
    // Every floor-3 world has the circus. Its tents carry no floor seed: a tent
    // is the same tent wherever it is pitched, so it survives the stairs.
    families.push(props(circusSheetPlans(), false));
  }
  // Painted when the floor loads rather than when a room seals: a room's
  // dressing is on screen from the doorway, long before the fight starts.
  for (const group of BOSS_ROOM_ASSET_GROUPS) {
    if (!wanted.has(group)) continue;
    families.push(props(bossRoomSheetPlans(group, floorArtSubSeed(BOSS_ROOM_SALT)), true));
  }
  return families;
}

/**
 * Queues the painted environment art the given asset groups stand for, except
 * the buildings, which a floor's resident set asks for as the party nears
 * them: a city's every facade painted on arrival would be its whole floor's
 * worth, most of it let go again before it was seen.
 *
 * Cheap to call on every floor entry: a sheet already painted, already queued,
 * or let go and owed when next wanted is skipped.
 */
export function requestEnvironmentSheetsForGroups(
  groups: ReadonlyArray<AssetGroup>,
  request: EnvironmentSheetRequest = {},
): void {
  const onSheetPainted = request.onSheetPainted;
  for (const entry of environmentFamilies(groups)) {
    if (entry.kind === 'props') {
      requestPropSheets(entry.family.plans, {
        variesWithFloorSeed: entry.family.variesWithFloorSeed,
        readyRows: entry.family.readyRows,
        onSheetPainted,
      });
    }
  }
}

/** A painted sheet's key and its size at full density, before any low-end-device downscale. */
export interface PlannedSheetSize {
  readonly key: SpriteKey;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Every sheet {@link requestEnvironmentSheetsForGroups} would paint for the
 * given groups, with its size, worked out from the plans without painting or
 * allocating anything. The ground sheets are `requestGroundSheets`' and are not
 * among them.
 */
export function plannedEnvironmentSheetSizes(
  groups: ReadonlyArray<AssetGroup>,
): PlannedSheetSize[] {
  const sizes: PlannedSheetSize[] = [];
  for (const entry of environmentFamilies(groups)) {
    if (entry.kind === 'props') {
      for (const plan of entry.family.plans) sizes.push({ key: plan.key, ...propSheetSize(plan) });
      continue;
    }
    for (const key of [...BUILDING_KEYS, ...buildingLifeKeys()]) {
      sizes.push({ key, ...sheetSizePx(getManifestEntry(key)) });
    }
  }
  return sizes;
}
