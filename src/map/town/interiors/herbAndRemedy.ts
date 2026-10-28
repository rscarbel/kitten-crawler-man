/**
 * An apothecary is a shop in front of a drying room, and the drying room is
 * the half a customer does not walk into: a copper still working over its
 * firebox, a long rack of bunched herbs hung over trays of petals, a
 * potting bench under the window, out of the light and out of the traffic,
 * behind a stub wall with one doorway at its east end.
 *
 * The shop is composed around two big pieces: a full-height apothecary
 * cabinet against that stub wall, and the counter in front of it. The
 * counter's west end stops short of the wall, and the gap is not
 * decorative — the corner between the cabinet, the wall and the counter's
 * end is where the herbalist's own anchor lands, and a run carried wall to
 * wall would seal her out of it. The cabinet is two rows deep so it sits
 * flush against the counter's middle: a customer anchored there can only
 * stand on the shop side, never behind it.
 */

import { INTERIOR_WALL } from '../../tileTypes';
import {
  contractTarget,
  prop,
  tile,
  tileRow,
  type TownInteriorLayoutEntry,
  statefulProp,
  contractTargetId,
} from './types';
import type { ContractAreaRecord } from '../../contractAreas';
import type { PlannedBuildingId } from '../../buildingIds';

const CONTRACT_SITE = 'taloncrest_apothecary' satisfies PlannedBuildingId;
const DRYING_FLOOR_SPOT_W = 3;
const DRYING_FLOOR_SPOT_H = 2;

/** The drying room's north wall run, shared by the layout and its contract rects. */
function dryingRoomNorthWall() {
  const westCol = 1;
  const northRow = 1;
  const pottingBenchCol = westCol + 1;
  const dryingRackCol = pottingBenchCol + 2;
  const dryingRackWidth = 5;
  const stillCol = dryingRackCol + dryingRackWidth;
  const stillWidth = 3;
  return { westCol, northRow, pottingBenchCol, dryingRackCol, stillCol, stillWidth };
}

/** Herb & Remedy's floor and wall rects a construction contract can mark, keyed by spot id. */
export function buildHerbAndRemedyContractAreas(_w: number, _h: number): ContractAreaRecord {
  const { northRow, pottingBenchCol, stillCol, stillWidth } = dryingRoomNorthWall();
  return {
    // The boards in front of the potting bench, west of the sorting table.
    drying_floor: {
      kind: 'floor',
      x: pottingBenchCol,
      y: northRow + 1,
      w: DRYING_FLOOR_SPOT_W,
      h: DRYING_FLOOR_SPOT_H,
    },
    hearth_wall: { kind: 'wall', x: stillCol, y: northRow - 1, w: stillWidth, h: 1 },
  };
}

export function buildHerbAndRemedyLayout(
  w: number,
  h: number,
  floorType: number,
): TownInteriorLayoutEntry[] {
  const { westCol, northRow, pottingBenchCol, dryingRackCol, stillCol, stillWidth } =
    dryingRoomNorthWall();
  const eastCol = w - 2;
  const southRow = h - 2;

  // Drying room.
  const dryingLastRow = 4;
  const partitionRow = dryingLastRow + 1;
  const doorwayEastCol = eastCol - 1;
  const doorwayWestCol = doorwayEastCol - 1;
  // Left bare: the only floor touching the hearth wall, so it is worked from here.
  const stillStepCol = stillCol + stillWidth;
  const eastWindowCol = stillStepCol + 1;
  const harvestRow = northRow + 2;
  const harvestCol = dryingRackCol + 1;
  const sortingTableCol = harvestCol + 1;
  const seedDrawerCol = doorwayEastCol;

  // Shop front.
  const cabinetRow = partitionRow + 1;
  const counterRow = cabinetRow + 2;
  const counterWestCol = westCol + 2;
  const counterSectionWidth = 4;
  const counterEastSectionCol = counterWestCol + counterSectionWidth;
  const cabinetCol = counterWestCol + 2;
  const keeperNookCol = westCol;
  const firstShopRow = counterRow + 1;
  // A square mat from the counter to the door, under the customer's feet.
  const rugCol = counterEastSectionCol - 1;
  const rugColourway = 2;
  const displayRow = firstShopRow + 1;
  const specimenCaseCol = counterWestCol + 1;
  const specimenCaseRow = displayRow + 1;
  const binsCol = eastCol - 2 - 1;
  const binsRow = displayRow;
  const waitingBenchCol = binsCol;
  const harvestSackCol = sortingTableCol + 2;
  const stillTenderStoolCol = stillCol + 1;
  // The still's fuel stands at its firebox, beside the tender's stool.
  const fuelBarrelCol = stillCol;

  const entries: TownInteriorLayoutEntry[] = [];
  // Storeroom offcuts first: the first breakable in placement order is the
  // one the payout gate expects to pay, and shop stock never does.
  entries.push(
    statefulProp(westCol, harvestRow, 'crate', 'crate_1'),
    statefulProp(westCol, dryingLastRow, 'sack', 'sack_1'),
    statefulProp(fuelBarrelCol, harvestRow, 'barrel', 'still_fuel_barrel'),
  );
  entries.push(
    prop(westCol, northRow, 'window_dressing'),
    statefulProp(westCol, northRow + 1, 'live_herb_pots', 'live_herb_pots_1'),
    statefulProp(
      pottingBenchCol,
      northRow,
      'potting_bench',
      contractTargetId(CONTRACT_SITE, 'potting_bench'),
      0,
    ),
    prop(
      dryingRackCol,
      northRow,
      'herb_drying_rack',
      0,
      contractTarget(CONTRACT_SITE, 'drying_rack'),
    ),
    prop(stillCol, northRow, 'still', 0, contractTarget(CONTRACT_SITE, 'still')),
    prop(eastWindowCol, northRow, 'window_dressing'),
    statefulProp(eastCol, northRow, 'live_herb_pots', 'live_herb_pots_2', 1),
    // The day's cut, brought in and waiting to be bunched.
    statefulProp(harvestCol, harvestRow, 'basket', 'basket_1'),
    statefulProp(
      sortingTableCol,
      harvestRow,
      'sorting_table',
      contractTargetId(CONTRACT_SITE, 'sorting_table'),
      0,
    ),
    statefulProp(harvestSackCol, harvestRow, 'sack', 'sack_2'),
    statefulProp(stillTenderStoolCol, harvestRow, 'stool', 'stool'),
    statefulProp(seedDrawerCol, harvestRow, 'drawer_unit', 'drawer_unit_1'),
    statefulProp(eastCol, harvestRow, 'basket', 'basket_2', 1),
  );
  entries.push(...tileRow(partitionRow, westCol, eastCol, INTERIOR_WALL));
  entries.push(
    tile(doorwayWestCol, partitionRow, floorType),
    tile(doorwayEastCol, partitionRow, floorType),
  );

  entries.push(
    prop(cabinetCol, cabinetRow, 'apothecary_drawer_wall'),
    statefulProp(keeperNookCol, cabinetRow, 'drawer_unit', 'drawer_unit_2'),
    statefulProp(keeperNookCol + 1, cabinetRow, 'crate', 'crate_2'),
    // Stock carried through from the drying room, waiting to be shelved.
    statefulProp(eastCol, cabinetRow, 'crate', 'crate_3'),
    statefulProp(eastCol, cabinetRow + 1, 'sack', 'sack_3'),
    prop(counterWestCol, counterRow, 'apothecary_counter', 0),
    prop(
      counterEastSectionCol,
      counterRow,
      'apothecary_counter',
      1,
      contractTarget(CONTRACT_SITE, 'counter'),
    ),
    prop(rugCol, firstShopRow, 'rug_large', rugColourway),
    statefulProp(westCol, displayRow, 'remedy_display', 'remedy_display', 0, { dropsLoot: false }),
    prop(
      specimenCaseCol,
      specimenCaseRow,
      'specimen_case',
      0,
      contractTarget(CONTRACT_SITE, 'specimen_case'),
    ),
    statefulProp(
      westCol,
      southRow,
      'live_herb_pots',
      contractTargetId(CONTRACT_SITE, 'planters'),
      0,
    ),
    statefulProp(eastCol, firstShopRow, 'potted_bay', 'potted_bay'),
    statefulProp(binsCol, binsRow, 'herb_bins', 'herb_bins', 0, { dropsLoot: false }),
    prop(waitingBenchCol, southRow, 'bench_seat'),
    statefulProp(eastCol, southRow, 'live_herb_pots', 'live_herb_pots_4', 1),
  );
  return entries;
}
