/**
 * The town's everything-shop, composed around a few big fittings rather than
 * a spread of one-tile furniture: two tall goods walls and a locked potion
 * cabinet along the north face, a long serving counter close to the door so
 * the keeper sees who comes in, a display table either side of the shop
 * floor, and open bins of nails, flour and salt between the counter and the
 * shelves. Barrels, sacks and a barrel of long-handled tools line the side
 * walls. A walled back storeroom in the north-east corner, behind one
 * doorway gap, holds the stock wall, the clerk's high desk, the delivery
 * stack and the one opened crate.
 *
 * Shared by every `store`-kind building (today, only the General Store),
 * which is why the shell dimensions and this layout key off `BuildingKind`
 * rather than a building name the way the thirteen named houses do.
 */

import { INTERIOR_WALL } from '../../tileTypes';
import { prop, tile, tileColumn, tileRow, type TownInteriorLayoutEntry } from './types';

const GOODS_WALL_WIDTH = 4;
const POTION_CABINET_WIDTH = 2;
const COUNTER_WIDTH = 5;
const DISPLAY_TABLE_WIDTH = 3;
const BULK_BINS_WIDTH = 3;
const CLERK_DESK_WIDTH = 2;
const STOCK_STACK_SIZE = 2;
const HAND_CART_LOAD_WIDTH = 3;

/** The storeroom takes the first five columns of the north-west corner. */
const STOREROOM_WIDTH = 5;
/** Rows between the counter and the front wall: a customer's row, the mat, and the door approach. */
const COUNTER_ROWS_FROM_FRONT = 4;
/** The counter's west end sits this far west of the door's east column, so the door opens onto its middle. */
const COUNTER_OFFSET_FROM_DOOR = 3;
/** Floor stock stands three rows out from the north wall, clear of a browsing lane along the shelves. */
const FLOOR_STOCK_ROWS_FROM_NORTH = 3;
/**
 * The keeper's perch, behind the counter's middle. A perch, not a stool:
 * a stool breaks, and one stood beside the delivery would be caught by a
 * swing at the stock and pay out as if it were junk.
 */
const KEEPER_PERCH_OFFSET = 3;
/** Front-wall stock stands this far either side of the door, leaving the approach clear. */
const FRONT_STOCK_DOOR_GAP = 3;

/** `goods_wall` variants, by trade. */
const GOODS_HARDWARE = 0;
const GOODS_PANTRY = 1;
const GOODS_STOCKROOM = 3;
/** `display_table` variants. */
const DISPLAY_HOUSEHOLD = 0;
const DISPLAY_HARDWARE = 1;

export function buildGeneralStoreLayout(
  w: number,
  h: number,
  floorType: number,
): TownInteriorLayoutEntry[] {
  const westCol = 1;
  const eastCol = w - 2;
  const northRow = 1;
  const southRow = h - 2;
  const merchandise = { dropsLoot: false } as const;

  // ── Storeroom bay: the north-west corner behind one doorway gap ─────────
  // The corner farthest from the street door, so its stock wall is the
  // shelf the clerk's `post: 'back'` roster spec picks.
  const storeroomLastCol = westCol + STOREROOM_WIDTH - 1;
  const storeroomWallCol = storeroomLastCol + 1;
  const storeroomLastRow = 3;
  const storeroomPartitionRow = storeroomLastRow + 1;
  const storeroomDoorRow = northRow + 1;

  // ── The counter, four rows in from the door ────────────────────────────
  const counterRow = southRow - COUNTER_ROWS_FROM_FRONT;
  const counterCol = Math.floor(w / 2) - COUNTER_OFFSET_FROM_DOOR;
  const bellEndCol = counterCol + COUNTER_WIDTH;
  // The keeper stands on the first free tile in rings round the counter's
  // north-west tile, north row first, west to east — so the tile diagonally
  // behind its west end is taken by the dynamite crate, and the search
  // settles on the tile directly behind the counter instead.
  const keeperBlockerCol = counterCol - 1;
  const behindCounterRow = counterRow - 1;

  const entries: TownInteriorLayoutEntry[] = [];

  // Entrance clutter first: `verify:interior-payout` expects the first
  // breakable in placement order to pay, and junk by the door does — the
  // shop's own stock never does. Kept two columns clear of the side walls
  // so one swing at a wall cluster never reaches these too.
  const entranceCrateCol = westCol + 2;
  entries.push(
    prop(entranceCrateCol, southRow, 'crate'),
    prop(entranceCrateCol + 1, southRow, 'crate'),
  );

  // Storeroom partition, its doorway gap, and its contents: the stock wall
  // and a spare shelf, the delivery stack under them, the clerk's desk and
  // the one opened crate.
  entries.push(...tileColumn(storeroomWallCol, northRow, storeroomLastRow, INTERIOR_WALL));
  entries.push(...tileRow(storeroomPartitionRow, westCol, storeroomLastCol, INTERIOR_WALL));
  entries.push(tile(storeroomWallCol, storeroomDoorRow, floorType));
  const stockStackRow = northRow + 1;
  const clerkDeskCol = westCol + STOCK_STACK_SIZE;
  entries.push(
    prop(westCol, northRow, 'goods_wall', GOODS_STOCKROOM, merchandise),
    prop(westCol, stockStackRow, 'stock_stack', 0, merchandise),
    prop(clerkDeskCol, storeroomLastRow, 'clerk_desk'),
    prop(clerkDeskCol + CLERK_DESK_WIDTH, storeroomLastRow, 'open_crate'),
    prop(storeroomLastCol, northRow, 'shelving_unit', 2, merchandise),
  );

  // North wall of the shop: the pantry wall, the price board, the potion
  // cabinet, a window, the hardware wall.
  const pantryWallCol = storeroomWallCol + 1;
  const priceBoardCol = pantryWallCol + GOODS_WALL_WIDTH;
  const potionCabinetCol = priceBoardCol + 1;
  const windowCol = potionCabinetCol + POTION_CABINET_WIDTH;
  const hardwareWallCol = windowCol + 1;
  entries.push(
    prop(pantryWallCol, northRow, 'goods_wall', GOODS_PANTRY, merchandise),
    prop(priceBoardCol, northRow, 'notice_board'),
    prop(potionCabinetCol, northRow, 'potion_cabinet', 0, merchandise),
    prop(windowCol, northRow, 'window_dressing'),
    prop(hardwareWallCol, northRow, 'goods_wall', GOODS_HARDWARE, merchandise),
  );
  if (hardwareWallCol + GOODS_WALL_WIDTH - 1 !== eastCol) {
    throw new Error('generalStore: the north wall fittings must run wall to wall');
  }

  // The morning's delivery, half unpacked in the middle of the floor
  // between the shelves and the counter: the carter's hand cart, a cask and
  // a sack still waiting for shelf room, and the crates stacked beside them.
  const deliveryRow = northRow + FLOOR_STOCK_ROWS_FROM_NORTH;
  const deliveryCol = counterCol + 1;
  const deliveryStackCol = deliveryCol + HAND_CART_LOAD_WIDTH;
  entries.push(
    prop(deliveryCol, deliveryRow, 'hand_cart'),
    prop(deliveryCol + 1, deliveryRow, 'barrel', 1, merchandise),
    prop(deliveryCol + 2, deliveryRow, 'sack', 0, merchandise),
    prop(deliveryStackCol, deliveryRow - 1, 'stock_stack', 0, merchandise),
  );

  // Open bins of nails, flour and salt under the hardware wall.
  const binsCol = eastCol - BULK_BINS_WIDTH;
  const binsRow = northRow + FLOOR_STOCK_ROWS_FROM_NORTH;
  entries.push(
    prop(binsCol, binsRow, 'bulk_bins', 0, merchandise),
    prop(binsCol + BULK_BINS_WIDTH, binsRow, 'sack', 0, merchandise),
  );

  // The counter, its bell end, the dynamite behind it and a perch for the keeper.
  entries.push(
    prop(counterCol, counterRow, 'store_counter'),
    prop(bellEndCol, counterRow, 'counter_bell_end'),
    prop(keeperBlockerCol, behindCounterRow, 'dynamite_crate'),
    prop(counterCol + KEEPER_PERCH_OFFSET, behindCounterRow, 'perch_rail'),
  );
  entries.push(prop(counterCol + 1, counterRow + 1, 'rug_medium', 1));

  // A display table each side of the counter, level with it.
  const westTableCol = westCol + 1;
  const eastTableCol = eastCol - DISPLAY_TABLE_WIDTH;
  const tableRow = counterRow;
  entries.push(
    prop(westTableCol, tableRow, 'display_table', DISPLAY_HOUSEHOLD, merchandise),
    prop(eastTableCol, tableRow, 'display_table', DISPLAY_HARDWARE, merchandise),
  );
  // A one-tile lane between the west table and the dynamite crate keeps the
  // keeper's side of the counter open to the shop floor.
  if (westTableCol + DISPLAY_TABLE_WIDTH >= keeperBlockerCol) {
    throw new Error('generalStore: the west display table walls off the keeper');
  }

  // West wall below the storeroom: tools, a barrel, a basket and crocks.
  // The wall column beside the display table is filled solid, never left
  // with a gap a table and a sack pile would seal off.
  const westFirstRow = storeroomPartitionRow + 1;
  entries.push(
    prop(westCol, westFirstRow, 'tool_barrel', 0, merchandise),
    prop(westCol + 1, westFirstRow, 'barrel', 0, merchandise),
    prop(westCol, westFirstRow + 1, 'basket', 1, merchandise),
    prop(westCol, westFirstRow + 2, 'crock_stack', 0, merchandise),
    prop(westCol, southRow - 2, 'sack_pile', 1, merchandise),
    prop(westCol, southRow - 1, 'coat_hook', 1),
  );

  // Stock stood out along the front wall either side of the door, where a
  // customer walking in sees it first.
  const doorWestCol = Math.floor(w / 2) - 1;
  const frontWestCol = doorWestCol - FRONT_STOCK_DOOR_GAP;
  const frontEastCol = doorWestCol + FRONT_STOCK_DOOR_GAP;
  entries.push(
    prop(frontWestCol, southRow, 'barrel', 0, merchandise),
    prop(frontWestCol + 1, southRow, 'basket', 0, merchandise),
    prop(frontWestCol, southRow - 1, 'sack', 0, merchandise),
    prop(frontEastCol, southRow, 'sack_pile', 1, merchandise),
    prop(frontEastCol + 2, southRow, 'basket', 1, merchandise),
  );

  // East wall: a second tool barrel and crockery under the bins, oil and
  // sacks down to the door.
  const eastStockRow = binsRow + 1;
  entries.push(
    prop(eastCol, eastStockRow, 'tool_barrel', 0, merchandise),
    prop(eastCol, eastStockRow + 1, 'basket', 0, merchandise),
    prop(eastCol, eastStockRow + 2, 'crock_stack', 0, merchandise),
    prop(eastCol - 1, southRow - 2, 'sack_pile', 0, merchandise),
    prop(eastCol, southRow - 1, 'barrel', 0, merchandise),
    prop(eastCol - 1, southRow, 'barrel', 1, merchandise),
    prop(eastCol, southRow, 'crate', 0, merchandise),
  );

  return entries;
}
