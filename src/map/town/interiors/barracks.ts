/**
 * The garrison, and three rooms rather than one box: the quartermaster's
 * armoury penned behind its signed-for counter to the west, a sanded drill
 * hall with its dummies, pells and sparring ring to the east, and a muster
 * hall across the south end that both of them open onto.
 *
 * Each room is built around its own big pieces: the armoury around the
 * spear rack, the armour on its plinth and the issue counter; the drill hall
 * around the ring, with every wall lined — practice rack, scoring slate,
 * trough, butt, sandbags, benches — and a line of dummies and pells north
 * and south of the ring; the muster hall around the board and the briefing
 * table, with bunks down both walls.
 *
 * The zone constants are exported for `GameMap` to read: the shell size
 * comes from the same numbers this layout is built from, and a row written
 * twice is a row that comes apart.
 */

import { DRILL_SAND_FLOOR, INTERIOR_WALL } from '../../tileTypes';
import {
  TOWN_INTERIOR_PROPS,
  type TownInteriorPropId,
} from '../../../sprites/art/townInterior/townInteriorProps';
import { prop, tile, tileRect, type TownInteriorLayoutEntry } from './types';

export const BARRACKS_INTERIOR_W = 22;
export const BARRACKS_INTERIOR_H = 18;
/** The wall between the quartermaster's armoury and the drill hall. */
export const BARRACKS_ZONE_DIVIDER_COL = 7;
/** Both upper zones run from the north wall down to the partition. */
export const BARRACKS_UPPER_FIRST_ROW = 1;
export const BARRACKS_UPPER_LAST_ROW = 11;
/** The wall between the two upper zones and the muster hall, pierced twice. */
export const BARRACKS_PARTITION_ROW = 12;
export const BARRACKS_MUSTER_FIRST_ROW = 13;

/** The worn, half-stuffed look for the second dummy and pell of each pair. */
const BATTERED_VARIANT = 1;
/** The practice rack of wasters and staves, as against the spear rack. */
const PRACTICE_RACK_VARIANT = 1;
/** Deep sky field, ember border — the garrison's own blue on the armoury's fitting mat. */
const FITTING_MAT_COLOURWAY = 3;
/** Columns between a dummy and the pell beside it — room to swing at one without striking the other. */
const DRILL_LINE_PITCH = 2;

function widthOf(propId: TownInteriorPropId): number {
  return TOWN_INTERIOR_PROPS[propId].footprint.w;
}

/** A bunk nobody has claimed: upper mattress rolled, lower one bare. */
const UNCLAIMED_BUNK_VARIANT = 1;

export function buildBarracksLayout(
  w: number,
  h: number,
  floorType: number,
): TownInteriorLayoutEntry[] {
  const eastWallCol = w - 2;
  const southWallRow = h - 2;
  const armouryFirstCol = 1;
  const armouryLastCol = BARRACKS_ZONE_DIVIDER_COL - 1;
  const drillFirstCol = BARRACKS_ZONE_DIVIDER_COL + 1;
  const northRow = BARRACKS_UPPER_FIRST_ROW;

  /*
   * Two archways rather than one, and neither of them centred.
   *
   * The armoury and the drill hall share no wall of their own, so each
   * needs its own way down into the muster hall or one of the two is a
   * room the player can see and never enter — a sealed wing throws nothing
   * and logs nothing. The eastern archway is kept one column west of the
   * lane the muster hall keeps clear, so the walk from the door to the
   * drill hall never crosses the briefing table.
   */
  const armouryArchwayCol = 3;
  const drillArchwayCol = 14;
  /** The north-south lane the muster hall keeps free of furniture, joining the entrance to both archways. */
  const musterLaneCol = 13;

  // ── Armoury ──
  const armourRowCol = armouryFirstCol + widthOf('garrison_weapon_rack');
  const stockAlleyRow = northRow + 1;
  /*
   * The counter stops one column short of the divider wall, and the gap it
   * leaves is a flap rather than a decoration: it is the only way into the
   * stock alley the counter pens off along the north wall. The one barrel in
   * that alley sits in its west corner, which is also what stands Dann one
   * tile along it — the stand search tries the tile north of the counter's
   * anchor first.
   */
  const counterRow = stockAlleyRow + 1;
  const footlockerRow = counterRow + 1;
  const issueCrateFirstRow = footlockerRow + 1;
  const fittingBenchRow = issueCrateFirstRow + 2;
  const fittingBenchCol = armouryFirstCol + 1;
  const issueShelfRow = fittingBenchRow + 1;
  const issueStackRow = BARRACKS_UPPER_LAST_ROW;

  // ── Drill hall ──
  // 9 columns × 4 rows — exactly the `sparring_ring` prop's own footprint.
  const ringFirstRow = 5;
  const ringFirstCol = 10;
  const ringLastCol = ringFirstCol + widthOf('sparring_ring') - 1;
  const ringLastRow = ringFirstRow + TOWN_INTERIOR_PROPS.sparring_ring.footprint.h - 1;
  const drillNorthLineRow = ringFirstRow - DRILL_LINE_PITCH;
  const drillSouthLineRow = ringLastRow + DRILL_LINE_PITCH;
  // The north wall runs rack, slate, a gap, trough, a gap, butt — the gaps
  // are where a recruit steps up to the trough or the butt from.
  const drillSlateCol = drillFirstCol + widthOf('garrison_weapon_rack');
  const drillTroughCol = drillSlateCol + widthOf('drill_slate') + 1;
  const drillButtCol = drillTroughCol + widthOf('water_trough') + 1;
  const pellWestCol = ringFirstCol;
  const dummyWestCol = pellWestCol + DRILL_LINE_PITCH;
  const dummyEastCol = ringLastCol;
  const pellEastCol = dummyEastCol - DRILL_LINE_PITCH;
  const drillBenchEastCol = drillArchwayCol + 1;
  const drillSouthWallRow = BARRACKS_UPPER_LAST_ROW;

  // ── Muster hall ──
  const musterNorthRow = BARRACKS_MUSTER_FIRST_ROW;
  const boardCol = 5;
  const briefingRow = musterNorthRow + 2;
  const briefingCol = 5;
  const briefingWidth = widthOf('briefing_table');
  const boardEndCol = boardCol + widthOf('muster_board');
  const southBrazierWestCol = armouryFirstCol + widthOf('bunk_bed');

  const entries: TownInteriorLayoutEntry[] = [];
  for (let ry = BARRACKS_UPPER_FIRST_ROW; ry <= BARRACKS_UPPER_LAST_ROW; ry++)
    entries.push(tile(BARRACKS_ZONE_DIVIDER_COL, ry, INTERIOR_WALL));
  for (let rx = 1; rx <= eastWallCol; rx++)
    entries.push(tile(rx, BARRACKS_PARTITION_ROW, INTERIOR_WALL));
  entries.push(
    tile(armouryArchwayCol, BARRACKS_PARTITION_ROW, floorType),
    tile(drillArchwayCol, BARRACKS_PARTITION_ROW, DRILL_SAND_FLOOR),
  );

  // Raked sand over the whole drill hall, laid before its furniture so the
  // dummies and the ring stamp over it rather than under it.
  entries.push(
    ...tileRect(
      drillFirstCol,
      BARRACKS_UPPER_FIRST_ROW,
      eastWallCol,
      BARRACKS_UPPER_LAST_ROW,
      DRILL_SAND_FLOOR,
    ),
  );

  // Armoury: the rack and the issued armour along the north wall, the
  // stock alley behind the counter, and the kit waiting to be signed for
  // stacked down both walls of the customer side.
  entries.push(
    prop(armouryFirstCol, northRow, 'garrison_weapon_rack'),
    prop(armourRowCol, northRow, 'armour_stand_row'),
    prop(armouryFirstCol, stockAlleyRow, 'barrel'),
    prop(armouryFirstCol, counterRow, 'issue_counter'),
    prop(armouryFirstCol, footlockerRow, 'chest', 0, { id: 'barracks_footlocker' }),
    prop(armouryFirstCol, issueCrateFirstRow, 'crate'),
    prop(armouryFirstCol, issueCrateFirstRow + 1, 'open_crate'),
    prop(armouryFirstCol, issueCrateFirstRow + 2, 'barrel', 1),
    // Not on the footlocker row: the tile south of the counter flap is the
    // flap's only way out, so the stock alley and Dann with it hang on it.
    prop(armouryLastCol, issueCrateFirstRow, 'armour_stand'),
    prop(armouryLastCol, issueCrateFirstRow + 1, 'crate'),
    prop(armouryLastCol, issueCrateFirstRow + 2, 'crate'),
    // Where a crawler tries a helm on before signing for it: a worn mat, a
    // bench, a stand to hang it on and the stone to take the burr off.
    prop(fittingBenchCol, fittingBenchRow, 'rug_medium', FITTING_MAT_COLOURWAY),
    prop(fittingBenchCol, fittingBenchRow, 'bench_seat'),
    prop(fittingBenchCol + 2, fittingBenchRow, 'armour_stand'),
    prop(fittingBenchCol + 2, fittingBenchRow + 2, 'grindstone'),
    prop(armouryFirstCol, issueShelfRow, 'shelving_unit'),
    prop(armouryFirstCol, issueShelfRow + 1, 'barrel'),
    prop(armouryLastCol, issueShelfRow, 'shelving_unit', 1),
    prop(armouryLastCol, issueShelfRow + 1, 'barrel', 1),
  );
  for (let rx = armouryFirstCol; rx <= armouryLastCol; rx++) {
    const besideTheArchway = rx === armouryArchwayCol || rx === armouryArchwayCol + 1;
    if (besideTheArchway) continue;
    entries.push(prop(rx, issueStackRow, rx % 2 === 0 ? 'barrel' : 'crate'));
  }

  // Drill hall. The sand inside the walls stays open for drilling — the one
  // legitimate open floor in the building — so the dressing lines the walls
  // instead, and the dummies and pells stand in two lines either side of
  // the ring where a recruit can swing at them without crossing the bout.
  entries.push(prop(ringFirstCol, ringFirstRow, 'sparring_ring'));
  entries.push(
    prop(drillFirstCol, northRow, 'garrison_weapon_rack', PRACTICE_RACK_VARIANT),
    prop(drillSlateCol, northRow, 'drill_slate'),
    prop(drillTroughCol, northRow, 'water_trough'),
    prop(drillButtCol, northRow, 'archery_butt'),
    prop(eastWallCol - 1, northRow, 'sandbags'),
  );
  entries.push(
    prop(pellWestCol, drillNorthLineRow, 'pell_post'),
    prop(dummyWestCol, drillNorthLineRow, 'straw_dummy'),
    prop(pellEastCol, drillNorthLineRow, 'pell_post', BATTERED_VARIANT),
    prop(dummyEastCol, drillNorthLineRow, 'straw_dummy', BATTERED_VARIANT),
    prop(dummyWestCol, drillSouthLineRow, 'straw_dummy'),
    prop(pellEastCol, drillSouthLineRow, 'pell_post'),
  );
  // West and east flanks of the sand: water barrels and spare kit.
  entries.push(
    prop(drillFirstCol, ringFirstRow - 1, 'barrel'),
    prop(drillFirstCol, ringFirstRow, 'crate'),
    prop(drillFirstCol, ringFirstRow + 1, 'open_crate'),
    prop(drillFirstCol, ringLastRow, 'armour_stand'),
    prop(drillFirstCol, drillSouthLineRow, 'barrel', 1),
    prop(eastWallCol, ringFirstRow - 1, 'barrel'),
    prop(eastWallCol, ringFirstRow, 'barrel', 1),
    prop(eastWallCol, ringLastRow - 1, 'barrel', 1),
    prop(eastWallCol, ringLastRow, 'crate'),
    prop(eastWallCol - 1, drillSouthLineRow, 'sandbags', 1),
  );
  // South wall of the hall (the partition's north face): a trough, benches
  // for the recruits waiting their turn, sandbags — and the tile north of
  // the drill archway left clear.
  entries.push(
    prop(drillFirstCol, drillSouthWallRow, 'water_trough'),
    prop(drillFirstCol + widthOf('water_trough'), drillSouthWallRow, 'bench_seat'),
    prop(drillBenchEastCol, drillSouthWallRow, 'bench_seat'),
    prop(drillBenchEastCol + widthOf('bench_seat'), drillSouthWallRow, 'sandbags', 1),
    prop(eastWallCol - 1, drillSouthWallRow, 'barrel'),
    prop(eastWallCol, drillSouthWallRow, 'crate'),
  );

  // Muster hall. The board and the bunks along the partition, the briefing
  // table with its stools in the west half, and more bunks and benches
  // down the south wall. The barrel beside the board keeps whoever reads it
  // off the armoury archway's own landing tile.
  entries.push(
    prop(armouryFirstCol, musterNorthRow, 'bunk_bed'),
    prop(boardCol - 1, musterNorthRow, 'barrel'),
    prop(boardCol, musterNorthRow, 'muster_board'),
    prop(boardEndCol, musterNorthRow, 'bunk_bed', UNCLAIMED_BUNK_VARIANT),
    prop(boardEndCol + widthOf('bunk_bed'), musterNorthRow, 'bunk_bed'),
    prop(drillArchwayCol + 1, musterNorthRow, 'bunk_bed', UNCLAIMED_BUNK_VARIANT),
    prop(drillArchwayCol + 1 + widthOf('bunk_bed'), musterNorthRow, 'bunk_bed'),
    prop(eastWallCol - 1, musterNorthRow, 'bunk_bed', UNCLAIMED_BUNK_VARIANT),
  );
  entries.push(
    prop(armouryFirstCol, briefingRow - 1, 'barrel'),
    prop(armouryFirstCol, briefingRow, 'crate'),
    prop(briefingCol - 1, briefingRow, 'stool'),
    prop(briefingCol, briefingRow, 'briefing_table'),
    prop(briefingCol + briefingWidth, briefingRow, 'stool', 1),
    prop(eastWallCol, briefingRow - 1, 'barrel'),
    prop(eastWallCol, briefingRow, 'crate'),
  );
  entries.push(
    prop(armouryFirstCol, southWallRow, 'bunk_bed'),
    prop(southBrazierWestCol, southWallRow, 'forge_brazier'),
    prop(southBrazierWestCol + 1, southWallRow, 'bench_seat'),
    prop(drillArchwayCol, southWallRow, 'forge_brazier'),
    prop(drillArchwayCol + 1, southWallRow, 'bench_seat'),
    prop(
      drillArchwayCol + 1 + widthOf('bench_seat'),
      southWallRow,
      'bunk_bed',
      UNCLAIMED_BUNK_VARIANT,
    ),
    prop(eastWallCol - 1, southWallRow, 'bunk_bed'),
  );
  const doorRugCol = Math.floor(w / 2) - 2;
  entries.push(prop(doorRugCol, southWallRow, 'rug_runner_4'));

  // Cleared last, after every fitting above it. The lane is what joins the
  // entrance to both archways, so a prop that grew into it would cut the
  // drill hall or the armoury off with no symptom anyone could report —
  // only a room the player can see and never enter.
  for (let ry = BARRACKS_MUSTER_FIRST_ROW; ry <= southWallRow; ry++)
    entries.push(tile(musterLaneCol, ry, floorType));

  return entries;
}
