/**
 * A working mill with the family's kitchen on the other side of the wall,
 * composed around three big pieces rather than dotted with small ones.
 *
 * The door opens into the mill room, and the mill is the first thing in
 * front of you: the hurst platform with its stones, hopper and loft chute
 * stands against the partition, flour tracked out across the flagstones in
 * front of it. Sacks are stacked on pallets down the west wall, barrels down
 * the east, and the steelyard the flour is sold by stands beside the stones.
 *
 * Through the partition's east doorway is the kitchen: Marta's brick hearth
 * and bread oven in the middle of the north wall, the plate dresser and the
 * larder either side of it, the family table out on the boards, the
 * kneading trough by the oven, and Corvin's pallet in the far corner under
 * his chalk marks.
 *
 * The doorway sits at the east end rather than the middle so the mill can
 * stand centred against the partition, square to the entrance.
 *
 * The two rooms read as two trades: the kitchen keeps the base board floor
 * a farmhouse walks on, and the mill room overrides its own tiles to
 * flagstone — swept stone under heavy machinery.
 */

import { INTERIOR_WALL, INTERIOR_FLAG_FLOOR } from '../../tileTypes';
import { TOWN_INTERIOR_PROPS } from '../../../sprites/art/townInterior/townInteriorProps';
import {
  contractTarget,
  prop,
  tile,
  tileRect,
  tileRow,
  type TownInteriorLayoutEntry,
} from './types';
import type { ContractAreaRecord } from '../../contractAreas';

/** The flour sack stack's variant with one sack slit open and a scoop in it. */
const OPENED_SACK_VARIANT = 1;
/** Ember field, deep sky border — worn wool by a working fire, not a parlour carpet. */
const HEARTH_RUG_COLOURWAY = 2;
/** A basket with a cloth folded over its rim, so it never reads as a copy of its neighbour. */
const CLOTH_COVERED_BASKET_VARIANT = 1;

const CONTRACT_SITE = 'millers_farm';
const KITCHEN_FLOOR_SPOT_SIZE = 2;
const MILL_FLAGS_SPOT_W = 3;
const MILL_FLAGS_SPOT_H = 2;

/**
 * The kitchen's north wall and the mill's place against the partition:
 * shared by the layout and by the contract rects measured against them.
 */
function farmGeometry(h: number) {
  const westCol = 1;
  const northRow = 1;
  const southRow = h - 2;
  const dresserCol = westCol;
  const coatHookCol = dresserCol + TOWN_INTERIOR_PROPS.farm_dresser.footprint.w;
  const hearthCol = coatHookCol + 2;
  const potRackCol = hearthCol + TOWN_INTERIOR_PROPS.farm_hearth.footprint.w;
  const larderCol = potRackCol + 1;
  // West to east along the partition: sack stacks, the sieve rack, a
  // step of floor, the mill, a step of floor, the steelyard — which ends
  // one column short of the kitchen doorway, so the doorway's landing stays open.
  const sackStackCol = westCol;
  const sieveCol = sackStackCol + TOWN_INTERIOR_PROPS.flour_sack_stack.footprint.w;
  const millCol = sieveCol + 2;
  const broomCol = millCol + 1;
  return {
    westCol,
    northRow,
    southRow,
    dresserCol,
    coatHookCol,
    hearthCol,
    potRackCol,
    larderCol,
    sackStackCol,
    sieveCol,
    millCol,
    broomCol,
  };
}

/** Miller's Farm's floor rects a construction contract can mark, keyed by spot id. */
export function buildMillersFarmContractAreas(_w: number, h: number): ContractAreaRecord {
  const { northRow, southRow, larderCol, broomCol } = farmGeometry(h);
  return {
    // The boards in front of the larder and Corvin's pallet.
    kitchen_floor: {
      kind: 'floor',
      x: larderCol + 1,
      y: northRow + 1,
      w: KITCHEN_FLOOR_SPOT_SIZE,
      h: KITCHEN_FLOOR_SPOT_SIZE,
    },
    // The flags between the broom and the flour sacks, where the street
    // door lets onto the mill.
    mill_flags: {
      kind: 'floor',
      x: broomCol + 1,
      y: southRow - MILL_FLAGS_SPOT_H + 1,
      w: MILL_FLAGS_SPOT_W,
      h: MILL_FLAGS_SPOT_H,
    },
  };
}

export function buildMillersFarmLayout(
  w: number,
  h: number,
  floorType: number,
): TownInteriorLayoutEntry[] {
  const {
    westCol,
    northRow,
    southRow,
    dresserCol,
    coatHookCol,
    hearthCol,
    potRackCol,
    larderCol,
    sackStackCol,
    sieveCol,
    millCol,
    broomCol,
  } = farmGeometry(h);
  const eastCol = w - 2;
  const partitionRow = 6;
  const doorwayWestCol = eastCol - 2;
  const doorwayEastCol = doorwayWestCol + 1;

  // ── Kitchen (north of the partition) ──
  const palletCol = larderCol + TOWN_INTERIOR_PROPS.larder_shelf.footprint.w;
  const hearthFrontRow = northRow + TOWN_INTERIOR_PROPS.farm_hearth.footprint.h;
  const tableCol = westCol + 1;
  const tableRow = hearthFrontRow;
  const tableEndCol = tableCol + TOWN_INTERIOR_PROPS.farm_table.footprint.w;
  const hearthRugEastCol = hearthCol + TOWN_INTERIOR_PROPS.rug_medium.footprint.w;
  const troughCol = potRackCol;
  const troughRow = hearthFrontRow;
  const kitchenSouthRow = partitionRow - 1;
  const churnCol = potRackCol;

  // ── Mill room (south of the partition) ──
  const millRoomFirstRow = partitionRow + 1;
  const millFrontRow = millRoomFirstRow + TOWN_INTERIOR_PROPS.millstone.footprint.h;
  const scaleCol = millCol + TOWN_INTERIOR_PROPS.millstone.footprint.w + 1;
  const eastCrateCol = eastCol - 1;

  const entries: TownInteriorLayoutEntry[] = [
    prop(dresserCol, northRow, 'farm_dresser'),
    prop(coatHookCol, northRow, 'coat_hook'),
    prop(coatHookCol + 1, northRow, 'basket', CLOTH_COVERED_BASKET_VARIANT),
    prop(hearthCol, northRow, 'farm_hearth', 0, contractTarget(CONTRACT_SITE, 'hearth')),
    prop(potRackCol, northRow, 'pot_rack', 0, contractTarget(CONTRACT_SITE, 'pot_rack')),
    prop(larderCol, northRow, 'larder_shelf', 0, contractTarget(CONTRACT_SITE, 'larder_shelf')),
    prop(palletCol, northRow, 'corvin_pallet'),
    // Corvin's corner: his scraps at the foot of the pallet.
    prop(eastCol, northRow + 1, 'crawler_scraps'),

    // A rag rug on the boards in front of the fire, with a chair drawn up to it.
    prop(hearthCol, hearthFrontRow, 'rug_medium', HEARTH_RUG_COLOURWAY),
    prop(hearthRugEastCol, hearthFrontRow, 'chair'),
    prop(tableCol, tableRow, 'farm_table', 0, contractTarget(CONTRACT_SITE, 'farm_table')),
    prop(tableEndCol, tableRow + 1, 'stool'),
    prop(troughCol, troughRow, 'bake_trough'),
    prop(eastCol, troughRow + 1, 'flour_bin'),

    prop(westCol, kitchenSouthRow, 'barrel'),
    prop(westCol + 1, kitchenSouthRow, 'sack'),
    prop(tableEndCol + 2, kitchenSouthRow, 'basket'),
    prop(churnCol, kitchenSouthRow, 'dairy_churn'),
    prop(churnCol + 1, kitchenSouthRow, 'crate'),
    prop(eastCol, kitchenSouthRow, 'barrel', 1),
  ];

  entries.push(...tileRow(partitionRow, westCol, eastCol, INTERIOR_WALL));
  entries.push(
    tile(doorwayWestCol, partitionRow, floorType),
    tile(doorwayEastCol, partitionRow, floorType),
  );
  // The mill room's own floor: swept flagstone under heavy machinery,
  // distinct from the kitchen's boards on the other side of the partition.
  entries.push(...tileRect(westCol, millRoomFirstRow, eastCol, southRow, INTERIOR_FLAG_FLOOR));

  entries.push(
    prop(millCol, millRoomFirstRow, 'millstone', 0, contractTarget(CONTRACT_SITE, 'millstone')),
    prop(millCol, millFrontRow, 'flour_drift'),
    // Flour walked from the stones to the kitchen door, and on through it.
    prop(millCol + TOWN_INTERIOR_PROPS.millstone.footprint.w, millFrontRow, 'flour_drift'),
    prop(doorwayWestCol - 1, kitchenSouthRow - 1, 'flour_drift'),
    prop(scaleCol, millRoomFirstRow, 'grain_scale'),
    prop(sieveCol, millRoomFirstRow, 'sieve_rack', 0, contractTarget(CONTRACT_SITE, 'sieve_rack')),

    prop(sackStackCol, millRoomFirstRow, 'flour_sack_stack'),
    prop(sackStackCol, millRoomFirstRow + 1, 'flour_sack_stack', OPENED_SACK_VARIANT),
    prop(westCol, millFrontRow, 'flour_bin'),
    prop(sieveCol, millFrontRow + 1, 'hand_cart'),
    prop(broomCol, southRow, 'broom'),
    prop(westCol, southRow - 1, 'crate'),
    prop(westCol, southRow, 'crate'),
    prop(westCol + 1, southRow, 'crate'),
    prop(westCol + 2, southRow, 'basket'),

    prop(eastCol, millRoomFirstRow, 'barrel'),
    prop(eastCol, millRoomFirstRow + 1, 'barrel', 1),
    prop(eastCol, millRoomFirstRow + 2, 'barrel'),
    prop(scaleCol, millFrontRow - 1, 'grain_bin', 0, contractTarget(CONTRACT_SITE, 'grain_bin')),
    prop(eastCrateCol, millFrontRow, 'crate'),
    prop(eastCol, millFrontRow, 'barrel', 1),
    prop(scaleCol, millFrontRow + 1, 'flour_sack_stack', OPENED_SACK_VARIANT),
    prop(scaleCol, southRow, 'sack'),
    prop(eastCol - 1, southRow, 'crate'),
    prop(eastCol, southRow, 'crate'),
  );
  return entries;
}
