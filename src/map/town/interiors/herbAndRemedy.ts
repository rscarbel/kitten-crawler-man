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
import { prop, tile, tileRow, type TownInteriorLayoutEntry } from './types';

export function buildHerbAndRemedyLayout(
  w: number,
  h: number,
  floorType: number,
): TownInteriorLayoutEntry[] {
  const westCol = 1;
  const eastCol = w - 2;
  const northRow = 1;
  const southRow = h - 2;

  // Drying room.
  const dryingLastRow = 4;
  const partitionRow = dryingLastRow + 1;
  const doorwayEastCol = eastCol - 1;
  const doorwayWestCol = doorwayEastCol - 1;
  const pottingBenchCol = westCol + 1;
  const dryingRackCol = pottingBenchCol + 2;
  const dryingRackWidth = 5;
  const stillCol = dryingRackCol + dryingRackWidth;
  const stillWidth = 3;
  const stillFuelCol = stillCol + stillWidth;
  const eastWindowCol = stillFuelCol + 1;
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

  const entries: TownInteriorLayoutEntry[] = [];
  // Storeroom offcuts first: the first breakable in placement order is the
  // one the payout gate expects to pay, and shop stock never does.
  entries.push(
    prop(westCol, harvestRow, 'crate'),
    prop(westCol, dryingLastRow, 'sack'),
    prop(stillFuelCol, northRow, 'barrel'),
  );
  entries.push(
    prop(westCol, northRow, 'window_dressing'),
    prop(westCol, northRow + 1, 'live_herb_pots'),
    prop(pottingBenchCol, northRow, 'potting_bench'),
    prop(dryingRackCol, northRow, 'herb_drying_rack'),
    prop(stillCol, northRow, 'still'),
    prop(eastWindowCol, northRow, 'window_dressing'),
    prop(eastCol, northRow, 'live_herb_pots', 1),
    // The day's cut, brought in and waiting to be bunched.
    prop(harvestCol, harvestRow, 'basket'),
    prop(sortingTableCol, harvestRow, 'sorting_table'),
    prop(harvestSackCol, harvestRow, 'sack'),
    prop(stillTenderStoolCol, harvestRow, 'stool'),
    prop(seedDrawerCol, harvestRow, 'drawer_unit'),
    prop(eastCol, harvestRow, 'basket', 1),
  );
  entries.push(...tileRow(partitionRow, westCol, eastCol, INTERIOR_WALL));
  entries.push(
    tile(doorwayWestCol, partitionRow, floorType),
    tile(doorwayEastCol, partitionRow, floorType),
  );

  entries.push(
    prop(cabinetCol, cabinetRow, 'apothecary_drawer_wall'),
    prop(keeperNookCol, cabinetRow, 'drawer_unit'),
    prop(keeperNookCol + 1, cabinetRow, 'crate'),
    // Stock carried through from the drying room, waiting to be shelved.
    prop(eastCol, cabinetRow, 'crate'),
    prop(eastCol, cabinetRow + 1, 'sack'),
    prop(counterWestCol, counterRow, 'apothecary_counter', 0),
    prop(counterEastSectionCol, counterRow, 'apothecary_counter', 1),
    prop(rugCol, firstShopRow, 'rug_large', rugColourway),
    prop(westCol, displayRow, 'remedy_display', 0, { dropsLoot: false }),
    prop(specimenCaseCol, specimenCaseRow, 'specimen_case'),
    prop(westCol, southRow, 'live_herb_pots'),
    prop(eastCol, firstShopRow, 'potted_bay'),
    prop(binsCol, binsRow, 'herb_bins', 0, { dropsLoot: false }),
    prop(waitingBenchCol, southRow, 'bench_seat'),
    prop(eastCol, southRow, 'live_herb_pots', 1),
  );
  return entries;
}
