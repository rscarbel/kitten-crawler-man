/**
 * The warm house: three private guest rooms off a landing upstairs, and below
 * the partition a taproom that is also the town's safe room.
 *
 * The taproom is composed around three things a guest walks toward: the
 * sandstone inglenook against the partition, with the cat's stool and the
 * painted sign beside it; Ossie's bar in the north-east corner, back bar and
 * counter with the barkeep's lane between; and the supper tables laid down
 * the south half. The Bopca's counter run lands between the hearth and the
 * bar on its own, and Mordecai and the sleeping bed stand where the safe room
 * puts them — the layout leaves those tiles, and a way round each, open.
 *
 * The three guest rooms differ at a glance, because that difference is what a
 * crawler is choosing between when they pay: cots for the cheap room, a
 * double bed by its own fire for the best one, and a quieter room with a
 * patchwork bed, a shelf of books and a brazier.
 *
 * The shell size and the taproom's row band are exported for `GameMap` to
 * read: the safe-room bounds and the Bopca counter run both need the same
 * numbers this layout is built from, and a row written twice is a row that
 * comes apart.
 */

import { INTERIOR_WALL } from '../../tileTypes';
import { contractTarget, prop, tile, type TownInteriorLayoutEntry } from './types';
import type { ContractAreaRecord } from '../../contractAreas';

export const INN_INTERIOR_W = 24;
export const INN_INTERIOR_H = 19;
/** The guest wing: three private rooms, split by dividing walls. */
export const INN_GUEST_WING_FIRST_ROW = 1;
export const INN_GUEST_WING_LAST_ROW = 4;
/** The wall the three guest rooms open through, one doorway each. */
export const INN_GUEST_WALL_ROW = 5;
/** The landing corridor, running the width of the building. */
export const INN_LANDING_RUG_ROW = 6;
export const INN_LANDING_ROW = 7;
/** The partition between the landing and the taproom, pierced by one archway. */
export const INN_PARTITION_ROW = 8;
export const INN_TAPROOM_FIRST_ROW = 9;
export const INN_TAPROOM_LAST_ROW = 17;

const BLUE_CHECK_QUILT = 0;
const PATCHWORK_QUILT = 1;
const STEW_NIGHT = 0;
const ROAST_NIGHT = 1;
const BEER_ENGINE_SECTION = 0;
const TILL_SECTION = 1;
/** The warm red-fielded runner, not the blue one: the landing belongs to the same house as the taproom. */
const LANDING_RUNNER_COLOURWAY = 1;
/** Back bench, galley strip and front bar: the rows `planSafeRoomCounters` lays the Bopca's run across. */
const SAFE_ROOM_COUNTER_DEPTH_ROWS = 3;

const CONTRACT_SITE = 'sleeping_cat_inn';
const CONTRACT_COT_INDEX = 0;
/** The east supper table's bench, in the open middle of the taproom. */
const CONTRACT_BENCH_TABLE_INDEX = 3;
const HEARTH_APRON_SPOT_W = 1;
const HEARTH_APRON_SPOT_H = 2;

/**
 * The run along the partition from the archway to the inglenook: shared by
 * the layout and by the contract rect laid at the hearth's mouth.
 */
function innHearthSide() {
  /*
   * The archway down to the taproom is deliberately off-centre.
   *
   * The Bopca's counter run is laid against the north wall of the safe
   * room's bounds — this partition row — and centred on the widest span of
   * it that no doorway opens onto, three rows deep including the galley
   * behind. An archway in the middle would sit directly under that run,
   * whose back bench is solid: the guest wing would be sealed off with no
   * error and no log anywhere. Kept hard against the taproom's west end
   * instead, which leaves the span east of it for the run.
   */
  const archwayWestCol = 3;
  const archwayEastCol = 4;
  const taproomNorthRow = INN_TAPROOM_FIRST_ROW;
  const catSignCol = archwayEastCol + 1;
  const logBasketCol = catSignCol + 1;
  /**
   * Flush against the Bopca's back bench: the run lands on columns 10–15,
   * and a hearth stopping one column short of it would leave a one-tile
   * slot behind the counter that only the hearth rug's corner reaches.
   */
  const hearthCol = logBasketCol + 1;
  const catStoolRow = taproomNorthRow + 1;
  return {
    archwayWestCol,
    archwayEastCol,
    taproomNorthRow,
    catSignCol,
    logBasketCol,
    hearthCol,
    catStoolRow,
  };
}

/** The Sleeping Cat Inn's floor rects a construction contract can mark, keyed by spot id. */
export function buildSleepingCatInnContractAreas(_w: number, _h: number): ContractAreaRecord {
  const { logBasketCol, catStoolRow } = innHearthSide();
  return {
    // The hearth's west flank, under the log basket: the rag rug owns the
    // floor straight in front of the fire, and Mordecai's rug the floor
    // south of that.
    hearth_apron: {
      kind: 'floor',
      x: logBasketCol,
      y: catStoolRow,
      w: HEARTH_APRON_SPOT_W,
      h: HEARTH_APRON_SPOT_H,
    },
  };
}

export function buildSleepingCatInnLayout(
  w: number,
  h: number,
  floorType: number,
): TownInteriorLayoutEntry[] {
  const westCol = 1;
  const eastCol = w - 2;
  const southRow = h - 2;
  const northRow = INN_GUEST_WING_FIRST_ROW;

  // ── Guest wing ──────────────────────────────────────────────────────────
  const cotRoomEastWallCol = 8;
  const bestRoomEastWallCol = 16;
  const guestDividerCols = [cotRoomEastWallCol, bestRoomEastWallCol];
  const cotRoomDoorwayCol = 4;
  const bestRoomDoorwayCol = 12;
  const quietRoomDoorwayCol = 19;
  const guestDoorwayCols = [cotRoomDoorwayCol, bestRoomDoorwayCol, quietRoomDoorwayCol];
  const guestRugRow = INN_GUEST_WING_LAST_ROW - 1;

  const cotCount = 3;
  const cotRoomWashstandCol = westCol + cotCount + 1;
  const cotRoomWindowCol = cotRoomWashstandCol + 1;
  const cotRoomChestCol = cotRoomEastWallCol - 1;
  const cotRoomRugCol = westCol + 1;

  const bestRoomWestCol = cotRoomEastWallCol + 1;
  const bestRoomHearthCol = bestRoomWestCol + 2;
  const bestRoomBedCol = bestRoomEastWallCol - 2;
  const bestRoomWindowCol = bestRoomBedCol - 1;
  const bestRoomSeatRow = northRow + 2;

  const quietRoomWestCol = bestRoomEastWallCol + 1;
  const quietRoomWindowCol = quietRoomWestCol + 2;
  const quietRoomShelfCol = quietRoomWindowCol + 1;
  const quietRoomRugCol = quietRoomWestCol + 1;

  // ── Landing ─────────────────────────────────────────────────────────────
  const landingRugStartCol = 2;
  const landingRugRunnerSpan = 6;
  const landingRugShortSpan = 4;
  const landingRugSecondCol = landingRugStartCol + landingRugRunnerSpan;
  const landingRugThirdCol = landingRugSecondCol + landingRugRunnerSpan;
  const landingRugFourthCol = landingRugThirdCol + landingRugShortSpan;
  const landingBenchCol = 9;
  const landingLinenChestCol = 14;

  // ── Taproom ─────────────────────────────────────────────────────────────
  const {
    archwayWestCol,
    archwayEastCol,
    taproomNorthRow,
    catSignCol,
    logBasketCol,
    hearthCol,
    catStoolRow,
  } = innHearthSide();
  const archwayCols = [archwayWestCol, archwayEastCol];
  const hearthRugRow = taproomNorthRow + 2;
  /** Coats by the foot of the stairs, where a guest coming down takes theirs off. */
  const coatHookRow = taproomNorthRow + 2;
  /**
   * On the rug's second row, not its first: the tile north of it, between
   * the cat's stool, the log basket and the hearth, is otherwise a pocket
   * nothing can walk into.
   */
  const firesideChairRow = hearthRugRow + 1;
  /**
   * Mordecai's corner of the hearth side: the safe room seats him a quarter
   * of the room west of its centre, which lands on this rug's east end.
   */
  const mordecaiRugCol = catSignCol;
  const mordecaiRugRow = firesideChairRow + 1;
  /*
   * Ossie's bar. The counter faces south, so the row behind it is the
   * barkeep's lane and the row behind that the back bar against the
   * partition. The lane opens at its west end only, onto the column between
   * the bar and the Bopca's run: the stove the safe room would like to stand
   * there refuses any tile that strands the lane, so it never can.
   */
  const backBarWidth = 6;
  const backBarCol = eastCol - backBarWidth + 1;
  const barRow = taproomNorthRow + 2;
  const barSectionWidth = 3;
  const barTillCol = backBarCol + barSectionWidth;
  const barStoolRow = barRow + 1;
  const barStoolPitch = 2;
  /** A mat in front of the Bopca's counter, where the queue for supper stands. */
  const galleyRugCol = 10;
  /** One row south of the Bopca's three-row run. */
  const galleyRugRow = taproomNorthRow + SAFE_ROOM_COUNTER_DEPTH_ROWS;

  const tableWidth = 3;
  const westTableCol = westCol;
  const westUpperTableRow = galleyRugRow + 1;
  /** A table, its bench, and a lane for the next table's diners. */
  const tableRowPitch = 3;
  const westLowerTableRow = westUpperTableRow + tableRowPitch;
  const middleTableRow = westLowerTableRow - 1;
  /**
   * Stops a column short of the door's west column so its bench, the row
   * nearest the door, leaves the aisle in from the street open; the gap
   * between it and the east table is that aisle.
   */
  const middleTableCol = 8;
  const eastTableCol = 14;
  const cornerTableCol = eastCol - tableWidth;
  /** Stock against the south wall west of the door, and the corner barrels the sweeping child keeps to. */
  const southStoreCol = 4;

  const entries: TownInteriorLayoutEntry[] = [];

  for (const col of guestDividerCols)
    for (let ry = INN_GUEST_WING_FIRST_ROW; ry <= INN_GUEST_WING_LAST_ROW; ry++)
      entries.push(tile(col, ry, INTERIOR_WALL));
  for (let rx = westCol; rx <= eastCol; rx++) {
    entries.push(tile(rx, INN_GUEST_WALL_ROW, INTERIOR_WALL));
    entries.push(tile(rx, INN_PARTITION_ROW, INTERIOR_WALL));
  }
  for (const col of guestDoorwayCols) entries.push(tile(col, INN_GUEST_WALL_ROW, floorType));
  for (const col of archwayCols) entries.push(tile(col, INN_PARTITION_ROW, floorType));

  // Loot-bearing junk first: the payout gate expects the first breakable in
  // placement order to pay out.
  entries.push(
    prop(cotRoomChestCol, INN_GUEST_WING_LAST_ROW, 'crate'),
    prop(westCol, INN_GUEST_WING_LAST_ROW, 'barrel'),
  );

  // The cheap room: three cots shoulder to shoulder.
  for (let i = 0; i < cotCount; i++) {
    const cotTarget = i === CONTRACT_COT_INDEX ? contractTarget(CONTRACT_SITE, 'cot') : {};
    entries.push(prop(westCol + i, northRow, 'inn_cot', i, cotTarget));
  }
  entries.push(
    prop(cotRoomWashstandCol, northRow, 'washstand'),
    prop(cotRoomWindowCol, northRow, 'window_dressing'),
    prop(cotRoomChestCol, northRow, 'chest'),
    prop(cotRoomRugCol, guestRugRow, 'rag_runner'),
  );

  // The best room: a double bed by its own fire.
  entries.push(
    prop(bestRoomWestCol, northRow, 'drawer_unit'),
    prop(bestRoomHearthCol, northRow, 'hearth_wide', 0, contractTarget(CONTRACT_SITE, 'best_fire')),
    prop(bestRoomWestCol + 1, northRow + 1, 'rag_rug_small'),
    prop(bestRoomWindowCol, northRow, 'window_dressing'),
    prop(
      bestRoomBedCol,
      northRow,
      'inn_guest_bed',
      BLUE_CHECK_QUILT,
      contractTarget(CONTRACT_SITE, 'guest_bed'),
    ),
    prop(bestRoomWindowCol, bestRoomSeatRow, 'fireside_chair'),
    prop(bestRoomWestCol, bestRoomSeatRow + 1, 'washstand'),
    prop(bestRoomBedCol + 1, bestRoomSeatRow, 'chest'),
  );

  // The quiet room: patchwork bed, books, the brazier.
  entries.push(
    prop(quietRoomWestCol, northRow, 'inn_guest_bed', PATCHWORK_QUILT),
    prop(quietRoomWindowCol, northRow, 'window_dressing'),
    prop(quietRoomShelfCol, northRow, 'shelving_unit', 1),
    prop(quietRoomShelfCol + 1, northRow, 'shelving_unit', 2),
    prop(eastCol, northRow, 'forge_brazier'),
    prop(eastCol, northRow + 2, 'washstand'),
    prop(quietRoomWestCol, northRow + 2, 'chest'),
    prop(quietRoomRugCol, guestRugRow, 'rag_runner', 1),
  );

  entries.push(
    prop(landingRugStartCol, INN_LANDING_RUG_ROW, 'rug_runner', LANDING_RUNNER_COLOURWAY),
    prop(landingRugSecondCol, INN_LANDING_RUG_ROW, 'rug_runner', LANDING_RUNNER_COLOURWAY),
    prop(landingRugThirdCol, INN_LANDING_RUG_ROW, 'rug_runner_4', LANDING_RUNNER_COLOURWAY),
    prop(landingRugFourthCol, INN_LANDING_RUG_ROW, 'rug_runner_4', LANDING_RUNNER_COLOURWAY),
    prop(westCol, INN_LANDING_ROW, 'barrel'),
    prop(landingBenchCol, INN_LANDING_ROW, 'inn_bench'),
    prop(landingLinenChestCol, INN_LANDING_ROW, 'chest'),
    prop(eastCol, INN_LANDING_ROW, 'barrel', 1),
  );

  // The hearth side of the taproom.
  entries.push(
    prop(westCol, taproomNorthRow, 'inn_dresser', 0, contractTarget(CONTRACT_SITE, 'dresser')),
    prop(westCol, coatHookRow, 'coat_hook'),
    prop(catSignCol, taproomNorthRow, 'cat_portrait'),
    prop(logBasketCol, taproomNorthRow, 'log_basket'),
    prop(catSignCol, catStoolRow, 'cat_stool'),
    prop(
      hearthCol,
      taproomNorthRow,
      'inn_hearth',
      0,
      contractTarget(CONTRACT_SITE, 'taproom_hearth'),
    ),
    prop(hearthCol, hearthRugRow, 'rag_rug_small'),
    prop(logBasketCol, firesideChairRow, 'fireside_chair'),
    prop(mordecaiRugCol, mordecaiRugRow, 'rag_rug_small', 1),
  );

  // Ossie's bar.
  entries.push(
    prop(backBarCol, taproomNorthRow, 'inn_back_bar'),
    prop(backBarCol, barRow, 'inn_bar', BEER_ENGINE_SECTION, contractTarget(CONTRACT_SITE, 'bar')),
    prop(barTillCol, barRow, 'inn_bar', TILL_SECTION),
    prop(galleyRugCol, galleyRugRow, 'rag_rug', 1),
  );
  for (let rx = backBarCol; rx <= eastCol; rx += barStoolPitch)
    entries.push(prop(rx, barStoolRow, 'stool'));

  // The supper tables, each with its bench on the room side.
  const tables = [
    { col: westTableCol, row: westUpperTableRow, variant: STEW_NIGHT },
    { col: westTableCol, row: westLowerTableRow, variant: ROAST_NIGHT },
    { col: middleTableCol, row: middleTableRow, variant: ROAST_NIGHT },
    { col: eastTableCol, row: middleTableRow, variant: STEW_NIGHT },
    { col: cornerTableCol, row: middleTableRow, variant: ROAST_NIGHT },
  ];
  const contractBenchTable = tables[CONTRACT_BENCH_TABLE_INDEX];
  for (const table of tables) {
    const benchTarget = table === contractBenchTable ? contractTarget(CONTRACT_SITE, 'bench') : {};
    entries.push(
      prop(table.col, table.row, 'inn_table', table.variant),
      prop(table.col, table.row + 1, 'inn_bench', 0, benchTarget),
    );
  }

  entries.push(
    prop(southStoreCol, southRow, 'dairy_churn'),
    prop(southStoreCol + 1, southRow, 'cask_rack', 0, contractTarget(CONTRACT_SITE, 'cask_rack')),
    prop(eastCol - 1, southRow, 'barrel'),
    prop(eastCol, southRow, 'barrel', 1),
  );
  return entries;
}
