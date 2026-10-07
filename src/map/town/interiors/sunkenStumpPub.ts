/**
 * The dive: low, crowded, and never quite clean.
 *
 * Marlow's bar runs along the north-west wall with his crooked bottle
 * shelves behind it, and at the end of his lane is the back door to the
 * service alley, barred with a beam — he can reach it and nobody else can
 * without walking past him. The empties wait stacked beside it for the
 * alley. The north-east corner is the games end: an iron stove, the
 * dartboard and a bare tile of wall beside it, with the throwing lane in
 * front left clear. The bare tile is the only floor touching the games
 * end's plaster, so it is worked from there.
 *
 * The floor is packed tight on purpose: scarred tables and upturned barrels
 * three columns apart, so a crawler crossing the room squeezes past
 * drinkers the whole way, over spills and sawdust nobody has swept. The
 * door's own column is kept clear so the room is enterable.
 */

import { contractTarget, prop, type TownInteriorLayoutEntry } from './types';
import type { ContractAreaRecord } from '../../contractAreas';

const KEG_END = 0;
const TILL_END = 1;
const SPILLED_MUG = 0;
const CRUSTS_AND_CANDLE = 1;
const ALE_SLICK = 0;
const SWEPT_GLASS = 1;
const OLD_STAIN = 2;

const CONTRACT_SITE = 'sunken_stump_pub';
/** The second table of the north rank, in from the west wall. */
const CONTRACT_STUMP_TABLE_INDEX = 1;
const MUD_FLAGS_SPOT_W = 3;
const MUD_FLAGS_SPOT_H = 2;

/** Marlow's bar and the games end along the north wall, shared by the layout and its contract rects. */
function stumpNorthWall() {
  const westCol = 1;
  const northRow = 1;
  // ── Marlow's bar ────────────────────────────────────────────────────────
  const barSectionWidth = 3;
  const barRow = northRow + 2;
  const barTillCol = westCol + barSectionWidth;
  const barEndCol = barTillCol + barSectionWidth - 1;
  const barStoolRow = barRow + 1;
  /** The back door stands at the end of the barkeep's lane, one column past the bar. */
  const backDoorCol = barEndCol + 1;
  const emptiesCol = backDoorCol + 1;
  // ── The games end ───────────────────────────────────────────────────────
  const stoveCol = emptiesCol + 2;
  const dartboardCol = stoveCol + 1;
  const bareWallCol = dartboardCol + 1;
  return {
    westCol,
    northRow,
    barRow,
    barTillCol,
    barEndCol,
    barStoolRow,
    backDoorCol,
    emptiesCol,
    stoveCol,
    dartboardCol,
    bareWallCol,
  };
}

/** The Sunken Stump Pub's floor and wall rects a construction contract can mark, keyed by spot id. */
export function buildSunkenStumpPubContractAreas(_w: number, _h: number): ContractAreaRecord {
  const { northRow, barStoolRow, backDoorCol, dartboardCol, bareWallCol } = stumpNorthWall();
  return {
    // The packed earth south of the empties, between the bar stools and the
    // dartboard's throwing lane.
    mud_flags: {
      kind: 'floor',
      x: backDoorCol,
      y: barStoolRow,
      w: MUD_FLAGS_SPOT_W,
      h: MUD_FLAGS_SPOT_H,
    },
    // Behind the dartboard and the bare tile, well clear of the bolted back door.
    plaster: {
      kind: 'wall',
      x: dartboardCol,
      y: northRow - 1,
      w: bareWallCol - dartboardCol + 1,
      h: 1,
    },
  };
}

export function buildSunkenStumpPubLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const {
    westCol,
    northRow,
    barRow,
    barTillCol,
    barEndCol,
    barStoolRow,
    backDoorCol,
    emptiesCol,
    stoveCol,
    dartboardCol,
  } = stumpNorthWall();
  const eastCol = w - 2;
  const southRow = h - 2;
  const doorCol = Math.floor(w / 2);
  const barStoolPitch = 2;

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
    prop(westCol, northRow, 'stump_back_shelf', 0, contractTarget(CONTRACT_SITE, 'back_shelf')),
    prop(barTillCol, northRow, 'stump_back_shelf', 1),
    prop(westCol, barRow, 'stump_bar', KEG_END, contractTarget(CONTRACT_SITE, 'bar')),
    prop(barTillCol, barRow, 'stump_bar', TILL_END),
    prop(backDoorCol, northRow, 'bolted_door'),
    prop(emptiesCol, northRow, 'keg_stack', 0, contractTarget(CONTRACT_SITE, 'keg_cradle')),
    prop(stoveCol, northRow, 'stump_stove', 0, contractTarget(CONTRACT_SITE, 'stove')),
    prop(stoveCol - 1, barRow, 'barrel_table', 0),
    prop(dartboardCol, northRow, 'dartboard'),
    prop(eastCol, northRow, 'smoky_lamp', 0, contractTarget(CONTRACT_SITE, 'lamp')),
  );
  for (let rx = westCol; rx <= barEndCol; rx += barStoolPitch)
    entries.push(prop(rx, barStoolRow, 'stool', rx % 2));

  const tables = [
    ...northTables.map((table) => ({ ...table, row: northRankRow })),
    ...southTables.map((table) => ({ ...table, row: southRankRow })),
  ];
  const contractTable = tables[CONTRACT_STUMP_TABLE_INDEX];
  for (const table of tables) {
    const tableTarget = table === contractTable ? contractTarget(CONTRACT_SITE, 'stump_table') : {};
    entries.push(
      prop(table.col, table.row, 'stump_table', table.variant, tableTarget),
      prop(table.col, table.row + 1, 'stool'),
      prop(table.col + 1, table.row + 1, 'stool', 1),
    );
  }
  entries.push(
    prop(diceTableCol, northRankRow, 'dice_table', 0, contractTarget(CONTRACT_SITE, 'dice_table')),
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
