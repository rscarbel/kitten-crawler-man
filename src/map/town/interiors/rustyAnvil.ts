/**
 * A smithy is two rooms, not one: a walled forge hall where the heat and
 * the sparks are, and a small shop across the south end where a customer
 * stands at a counter without walking into the quench. The partition's one
 * doorway lines up with the street door, so the forge hall is still open to
 * anyone who wants to look at it.
 *
 * The forge hall is laid out as a smith works it. The forge stands against
 * the north wall with the bellows slung beside it and the quench trough on
 * its other flank; the anvil is one step south of the fire, with the lane
 * between them where she stands to turn from coals to face; the tool wall
 * and the stock rack are on the same wall within reach. Stock and fuel are
 * stacked down the west wall, the fitting bench and the footlocker down the
 * east.
 *
 * The shop counter is what stations the smith: `InteriorOccupantSystem`
 * anchors her on the room's counter, and every part of the forge's own
 * working triangle is north of the partition, so deleting the counter
 * would put her back in the forge hall and leave the room the player spawns
 * into empty.
 */

import { INTERIOR_WALL } from '../../tileTypes';
import { contractTarget, prop, tile, tileRow, type TownInteriorLayoutEntry } from './types';
import type { ContractAreaRecord } from '../../contractAreas';

const SHOP_DEPTH = 3;
const BAR_STOCK_WIDTH = 2;
const BELLOWS_WIDTH = 2;
const FORGE_WIDTH = 3;
const TOOL_WALL_WIDTH = 4;
const BENCH_WIDTH = 3;
const ANVIL_WIDTH = 2;
/** The delivery cart stands just off the west stock's sacks. */
const DELIVERY_OFFSET_FROM_WALL = 2;
/** The sooted floor starts two tiles west of the forge so the anvil sits in its middle. */
const FORGE_FLOOR_WEST_MARGIN = 2;
const BLADE_RACK_AXES_VARIANT = 1;

const CONTRACT_SITE = 'rusty_anvil';
const SHOP_FLAGS_SPOT_W = 3;
const SHOP_FLAGS_SPOT_H = 2;

/** The partition, its doorway and the shop's rows, shared by the layout and its contract rects. */
function smithyFrame(w: number, h: number) {
  const westCol = 1;
  const eastCol = w - 2;
  const northRow = 1;
  const southRow = h - 2;
  const partitionRow = southRow - SHOP_DEPTH;
  const doorwayWestCol = Math.floor(w / 2) - 1;
  const doorwayEastCol = doorwayWestCol + 1;
  const shopBackRow = partitionRow + 1;
  const counterRow = shopBackRow + 1;
  return {
    westCol,
    eastCol,
    northRow,
    southRow,
    partitionRow,
    doorwayWestCol,
    doorwayEastCol,
    shopBackRow,
    counterRow,
  };
}

/** The Rusty Anvil's floor rects a construction contract can mark, keyed by spot id. */
export function buildRustyAnvilContractAreas(w: number, h: number): ContractAreaRecord {
  const { doorwayWestCol, counterRow } = smithyFrame(w, h);
  return {
    // The customers' side of the shop, between the counter's east end and
    // the street door, in line with the partition doorway.
    shop_flags: {
      kind: 'floor',
      x: doorwayWestCol,
      y: counterRow,
      w: SHOP_FLAGS_SPOT_W,
      h: SHOP_FLAGS_SPOT_H,
    },
  };
}

export function buildRustyAnvilLayout(
  w: number,
  h: number,
  floorType: number,
): TownInteriorLayoutEntry[] {
  const {
    westCol,
    eastCol,
    northRow,
    southRow,
    partitionRow,
    doorwayWestCol,
    doorwayEastCol,
    shopBackRow,
    counterRow,
  } = smithyFrame(w, h);

  // ── North wall: stock rack, bellows, forge, slack tub, tool wall ─────────
  const barStockCol = westCol + 1;
  const bellowsCol = barStockCol + BAR_STOCK_WIDTH;
  const forgeCol = bellowsCol + BELLOWS_WIDTH;
  const forgeLastRow = northRow + 1;
  const slackTubCol = forgeCol + FORGE_WIDTH;
  const toolWallCol = slackTubCol + 1;
  const eastWindowCol = toolWallCol + TOOL_WALL_WIDTH;

  // ── The working triangle ─────────────────────────────────────────────────
  // The quench trough sits against the forge's east flank on the hearth
  // row; the anvil is a row clear of the fire, so the smith has a lane to
  // stand in between coals and face, with the grindstone one step east.
  const quenchCol = slackTubCol;
  const quenchRow = forgeLastRow;
  const workLaneRow = forgeLastRow + 1;
  const anvilRow = workLaneRow + 1;
  const anvilCol = forgeCol;
  const grindstoneCol = anvilCol + ANVIL_WIDTH + 1;
  const coalHeapCol = barStockCol;
  const coalHeapRow = forgeLastRow;

  // ── East side: the fitting bench and its footlocker ──────────────────────
  const benchRow = anvilRow;
  const benchCol = eastCol - BENCH_WIDTH;
  const footlockerBarrelRow = benchRow + 1;
  const lowerRow = partitionRow - 1;

  const entries: TownInteriorLayoutEntry[] = [];

  // Stock against the west wall first: the first breakable in placement
  // order is the one the payout gate expects to pay, and shop stock never
  // does.
  const westStockFirstRow = coalHeapRow + 1;
  for (let row = westStockFirstRow; row <= lowerRow; row++)
    entries.push(prop(westCol, row, row % 2 === 0 ? 'barrel' : 'crate'));
  entries.push(
    prop(westCol + 1, lowerRow, 'sack'),
    prop(westCol + 1, lowerRow - 1, 'sack'),
    prop(westCol, forgeLastRow, 'barrel'),
  );

  entries.push(
    prop(westCol, northRow, 'window_dressing'),
    prop(barStockCol, northRow, 'bar_stock'),
    prop(bellowsCol, northRow, 'smith_bellows', 0, contractTarget(CONTRACT_SITE, 'bellows')),
    prop(forgeCol, northRow, 'forge', 0, contractTarget(CONTRACT_SITE, 'forge')),
    prop(slackTubCol, northRow, 'slack_tub'),
    prop(toolWallCol, northRow, 'smith_tool_wall', 0, contractTarget(CONTRACT_SITE, 'tool_wall')),
    prop(eastWindowCol, northRow, 'window_dressing'),
    prop(coalHeapCol, coalHeapRow, 'coal_heap'),
    prop(quenchCol, quenchRow, 'quench_trough', 0, contractTarget(CONTRACT_SITE, 'quench')),
    prop(anvilCol, anvilRow, 'anvil'),
    prop(grindstoneCol, anvilRow, 'grindstone'),
  );

  // The sooted working floor under the anvil, lit from the hearth.
  entries.push(prop(forgeCol - FORGE_FLOOR_WEST_MARGIN, workLaneRow, 'forge_floor'));

  // A charcoal delivery by the west stock, the cart still loaded, and the
  // mandrel and swage block beside it.
  const deliveryCol = westCol + DELIVERY_OFFSET_FROM_WALL;
  entries.push(
    prop(deliveryCol, lowerRow, 'hand_cart'),
    prop(deliveryCol + 1, lowerRow, 'sack'),
    prop(deliveryCol + 2, lowerRow, 'mandrel_swage'),
  );

  entries.push(
    prop(benchCol, benchRow, 'vice_bench', 0, contractTarget(CONTRACT_SITE, 'vice_bench')),
    prop(eastCol, benchRow, 'chest', 0, { id: 'rusty_anvil_footlocker' }),
    prop(benchCol + 1, lowerRow, 'stool'),
    prop(eastCol, footlockerBarrelRow, 'barrel'),
    prop(eastCol, lowerRow, 'barrel', 1),
    prop(eastCol - 1, lowerRow, 'crate'),
    // Spare stock stood against the partition's forge-hall face.
    prop(grindstoneCol + 1, lowerRow, 'bar_stock'),
  );

  // The partition, pierced once in line with the street door.
  entries.push(...tileRow(partitionRow, westCol, eastCol, INTERIOR_WALL));
  entries.push(
    tile(doorwayWestCol, partitionRow, floorType),
    tile(doorwayEastCol, partitionRow, floorType),
  );

  // ── Shop ─────────────────────────────────────────────────────────────────
  // The counter's north-west tile is its one `counter` anchor, and the stand
  // search walks the row behind it from the diagonal. The west blade rack
  // fills that row up to the counter's second tile, so the smith lands
  // behind the middle of her counter, and the row stays open eastward to
  // the partition door.
  const counterCol = westCol + 2;
  const eastRackCol = doorwayEastCol + 2;
  entries.push(
    prop(westCol, shopBackRow, 'blade_rack', 0, contractTarget(CONTRACT_SITE, 'blade_rack')),
    prop(counterCol, counterRow, 'smith_counter', 0, contractTarget(CONTRACT_SITE, 'counter')),
    prop(westCol, counterRow, 'mail_stand', 0, contractTarget(CONTRACT_SITE, 'mail_stand')),
    prop(westCol + 1, counterRow, 'barrel', 0, { dropsLoot: false }),
    prop(eastRackCol, shopBackRow, 'blade_rack', BLADE_RACK_AXES_VARIANT),
    prop(eastRackCol, southRow, 'ironmongery_table', 0, { dropsLoot: false }),
    prop(eastCol, shopBackRow, 'barrel', 1, { dropsLoot: false }),
    prop(eastCol, counterRow, 'crate', 0, { dropsLoot: false }),
    prop(eastCol, southRow, 'crate', 0, { dropsLoot: false }),
  );

  return entries;
}
