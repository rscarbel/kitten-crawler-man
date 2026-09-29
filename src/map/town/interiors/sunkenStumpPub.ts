/**
 * The dive: low, crowded, and never quite clean.
 *
 * Marlow's bar runs along the north-west wall with his crooked bottle
 * shelves behind it, and at the end of his lane is the back door to the
 * service alley, barred with a beam — he can reach it and nobody else can
 * without walking past him. The empties wait stacked beside it for the
 * alley. The north-east corner is the games end: an iron stove, the
 * dartboard and its chalked scores, with the throwing lane in front left
 * clear.
 *
 * The floor is packed tight on purpose: scarred tables and upturned barrels
 * three columns apart, so a crawler crossing the room squeezes past
 * drinkers the whole way, over spills and sawdust nobody has swept. The
 * door's own column is kept clear so the room is enterable.
 */

import { prop, type TownInteriorLayoutEntry } from './types';

const KEG_END = 0;
const TILL_END = 1;
const SPILLED_MUG = 0;
const CRUSTS_AND_CANDLE = 1;
const ALE_SLICK = 0;
const SWEPT_GLASS = 1;
const OLD_STAIN = 2;

export function buildSunkenStumpPubLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const westCol = 1;
  const eastCol = w - 2;
  const northRow = 1;
  const southRow = h - 2;
  const doorCol = Math.floor(w / 2);

  // ── Marlow's bar ────────────────────────────────────────────────────────
  const barSectionWidth = 3;
  const barRow = northRow + 2;
  const barTillCol = westCol + barSectionWidth;
  const barEndCol = barTillCol + barSectionWidth - 1;
  const barStoolRow = barRow + 1;
  const barStoolPitch = 2;
  /** The back door stands at the end of the barkeep's lane, one column past the bar. */
  const backDoorCol = barEndCol + 1;
  const emptiesCol = backDoorCol + 1;

  // ── The games end ───────────────────────────────────────────────────────
  const stoveCol = emptiesCol + 2;
  const dartboardCol = stoveCol + 1;
  const chalkTallyCol = dartboardCol + 1;

  // ── The floor ───────────────────────────────────────────────────────────
  /*
   * Two ranks, each a row of tables with its stools on the south side and a
   * one-tile lane north of it where the drinkers stand, so nothing on the
   * floor has more than a tile of clearance.
   */
  const northRankRow = barStoolRow + 2;
  /** A table row, its stool row, and the one-tile lane the next rank's drinkers stand in. */
  const rankPitch = 3;
  const southRankRow = northRankRow + rankPitch;
  /** A two-tile table and the one-tile lane beside it. */
  const tablePitch = 3;
  const northTables = [
    { col: westCol, variant: SPILLED_MUG },
    { col: westCol + tablePitch, variant: CRUSTS_AND_CANDLE },
  ];
  const northBarrelCols = [doorCol - 1, doorCol + 1];
  const diceTableCol = doorCol + tablePitch;
  const southTables = [
    { col: westCol + 1, variant: CRUSTS_AND_CANDLE },
    { col: doorCol + 2, variant: SPILLED_MUG },
  ];
  const southWestBarrelCol = westCol + 1 + tablePitch;
  const southBarrelCols = [southWestBarrelCol, eastCol - 1];

  const entries: TownInteriorLayoutEntry[] = [];
  // Loot-bearing junk first: the payout gate expects the first breakable in
  // placement order to pay out.
  entries.push(
    prop(westCol, southRow, 'junk_heap'),
    prop(eastCol, southRow, 'barrel'),
    prop(eastCol, northRankRow, 'barrel', 1),
    prop(eastCol, northRankRow + 1, 'crate'),
  );

  entries.push(
    prop(westCol, northRow, 'stump_back_shelf', 0),
    prop(barTillCol, northRow, 'stump_back_shelf', 1),
    prop(westCol, barRow, 'stump_bar', KEG_END),
    prop(barTillCol, barRow, 'stump_bar', TILL_END),
    prop(backDoorCol, northRow, 'bolted_door'),
    prop(emptiesCol, northRow, 'keg_stack'),
    prop(stoveCol, northRow, 'stump_stove'),
    prop(stoveCol - 1, barRow, 'barrel_table', 0),
    prop(dartboardCol, northRow, 'dartboard'),
    prop(chalkTallyCol, northRow, 'chalk_tally'),
    prop(eastCol, northRow, 'smoky_lamp'),
  );
  for (let rx = westCol; rx <= barEndCol; rx += barStoolPitch)
    entries.push(prop(rx, barStoolRow, 'stool', rx % 2));

  const tables = [
    ...northTables.map((table) => ({ ...table, row: northRankRow })),
    ...southTables.map((table) => ({ ...table, row: southRankRow })),
  ];
  for (const table of tables) {
    entries.push(
      prop(table.col, table.row, 'stump_table', table.variant),
      prop(table.col, table.row + 1, 'stool'),
      prop(table.col + 1, table.row + 1, 'stool', 1),
    );
  }
  entries.push(
    prop(diceTableCol, northRankRow, 'dice_table'),
    prop(diceTableCol, northRankRow + 1, 'stool', 1),
    prop(diceTableCol + 1, northRankRow + 1, 'stool'),
  );
  northBarrelCols.forEach((col, i) => entries.push(prop(col, northRankRow, 'barrel_table', i)));
  southBarrelCols.forEach((col, i) => entries.push(prop(col, southRankRow, 'barrel_table', i + 1)));

  entries.push(
    prop(westCol + 2, northRankRow - 1, 'floor_stain', ALE_SLICK),
    prop(doorCol, southRankRow - 1, 'floor_stain', SWEPT_GLASS),
    prop(dartboardCol, barRow, 'floor_stain', ALE_SLICK),
    prop(southWestBarrelCol, southRow, 'floor_stain', OLD_STAIN),
    prop(barEndCol, barStoolRow, 'floor_stain', SWEPT_GLASS),
    prop(westCol + 2, southRankRow - 1, 'floor_stain', OLD_STAIN),
    prop(eastCol - 2, southRankRow - 1, 'floor_stain', ALE_SLICK),
    prop(eastCol - 1, barRow, 'floor_stain', SWEPT_GLASS),
  );
  return entries;
}
