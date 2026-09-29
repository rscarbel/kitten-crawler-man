/**
 * A parlour rather than a shop floor, and three rooms rather than one box: a
 * walled inking alcove to the north-west where the work is done out of
 * sight, a back room to the north-east where the pigment is ground, and a
 * waiting room across the south end under a wall of flash. The privacy is
 * the whole reason the room reads as a parlour — a customer on a bench in the
 * middle of a shop is a shop.
 *
 * Each room is composed around its big pieces rather than dotted with small
 * ones. The alcove is the ink chair on its rug, with the pigment cabinet, the
 * feather-tract charts and a washstand along its wall, the arm lamp at the
 * chair's head and the needle trolley at its foot. The waiting room is the
 * flash — two four-tile runs of it on the partition, broken only where the
 * two doorways need their landing tiles — over a carpet from the street door,
 * with a settee and table in each corner for the two people waiting.
 *
 * The anchors are load-bearing. The chair is the room's only `bench`, so Nim
 * works in the alcove; the pigment cabinet is its only `shelf`, where the
 * slate of rates is propped; and the two waiting-room tables are its only
 * `table`s, so both customers stand on the waiting-room side of the
 * partition, never behind it.
 *
 * The work rooms keep the ink-spattered floor; the waiting room is laid in
 * clean boards, since nobody is inked out there.
 */

import { INTERIOR_INK_FLOOR, INTERIOR_WALL } from '../../tileTypes';
import { TOWN_INTERIOR_PROPS } from '../../../sprites/art/townInterior/townInteriorProps';
import { prop, tile, tileColumn, tileRect, tileRow, type TownInteriorLayoutEntry } from './types';

/** The flash wall's two design sets, so its two runs never repeat a sheet. */
const FLASH_SET_WEST = 0;
const FLASH_SET_EAST = 1;
/** The settees' two upholsteries: the shop's violet and a teal. */
const SETTEE_VIOLET = 0;
const SETTEE_TEAL = 1;
/** Deep sky field, ember border — the waiting-room carpet's colourway. */
const WAITING_CARPET_COLOURWAY = 3;
/** The arm lamp's reach: variant 0 reaches east, over the chair it stands west of. */
const LAMP_REACHES_EAST = 0;

export function buildQuietNeedleLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const westCol = 1;
  const eastWallCol = w - 2;
  const southRow = h - 2;
  const northRow = 1;
  const partitionRow = 6;
  const workroomLastRow = partitionRow - 1;
  const waitingFirstRow = partitionRow + 1;
  const zoneDividerCol = 8;
  const backRoomFirstCol = zoneDividerCol + 1;

  const alcoveDoorwayCol = 5;
  const backRoomDoorwayCol = 10;

  // ── The alcove ──
  const cabinetCol = westCol;
  const chartCol = cabinetCol + TOWN_INTERIOR_PROPS.pigment_cabinet.footprint.w + 1;
  const chairRow = northRow + 2;
  const chairCol = westCol + 1;
  const chairWidth = TOWN_INTERIOR_PROPS.ink_chair.footprint.w;
  const lampCol = westCol;
  const trolleyCol = chairCol + chairWidth;
  // Pushed back against the wall between the cabinet and the charts, not
  // drawn up to the chair: the strip behind the chair is the alcove's only
  // way to its west end, and a stool on it would wall that end off.
  const nimStoolCol = chartCol - 1;
  const nimStoolRow = northRow;
  const alcoveEastCol = zoneDividerCol - 1;

  // ── The back room ──
  const grindingBenchCol = backRoomFirstCol;
  const grinderStoolRow = northRow + 1;
  const grinderStoolCol = grindingBenchCol + 1;

  // ── The waiting room ──
  const westFlashCol = westCol;
  const eastFlashCol = alcoveDoorwayCol + 1;
  const eastFlashLastCol = eastFlashCol + TOWN_INTERIOR_PROPS.flash_wall.footprint.w - 1;
  const settingRow = waitingFirstRow + 2;
  const tableRow = settingRow + 1;
  const westSetteeCol = westCol;
  const westTableCol = westSetteeCol + 1;
  const eastSetteeCol = eastWallCol - TOWN_INTERIOR_PROPS.settee.footprint.w;
  const eastTableCol = eastSetteeCol + 1;
  const carpetCol = alcoveDoorwayCol;
  const carpetRow = southRow - 2;

  const entries: TownInteriorLayoutEntry[] = [];
  entries.push(...tileRect(westCol, northRow, eastWallCol, workroomLastRow, INTERIOR_INK_FLOOR));
  entries.push(...tileColumn(zoneDividerCol, northRow, workroomLastRow, INTERIOR_WALL));
  entries.push(...tileRow(partitionRow, westCol, eastWallCol, INTERIOR_WALL));
  entries.push(
    tile(alcoveDoorwayCol, partitionRow, INTERIOR_INK_FLOOR),
    tile(backRoomDoorwayCol, partitionRow, INTERIOR_INK_FLOOR),
  );

  entries.push(
    prop(cabinetCol, northRow, 'pigment_cabinet'),
    prop(chartCol, northRow, 'feather_chart'),
    prop(alcoveEastCol, northRow, 'crock_cluster', 1),
    prop(chairCol, chairRow, 'rug_medium', 2),
    prop(chairCol, chairRow, 'ink_chair'),
    prop(lampCol, chairRow, 'arm_lamp', LAMP_REACHES_EAST),
    prop(trolleyCol, chairRow, 'needle_tray'),
    prop(nimStoolCol, nimStoolRow, 'stool'),
    // The stand the design book is left open on, beside the chair: the one
    // alcove table sits furthest from the south wall, so both waiting
    // customers (posted south) still take the waiting-room tables first.
    prop(alcoveEastCol, chairRow, 'side_table'),
    prop(alcoveEastCol, workroomLastRow, 'drawer_unit'),
    prop(alcoveEastCol - 1, workroomLastRow, 'basket', 1),
    prop(westCol, workroomLastRow, 'jars'),
  );

  entries.push(
    prop(grindingBenchCol, northRow, 'grinding_bench'),
    prop(grinderStoolCol, grinderStoolRow, 'stool'),
    prop(eastWallCol - 1, northRow, 'potion_shelf'),
    prop(eastWallCol, northRow, 'barrel'),
    prop(eastWallCol, workroomLastRow - 2, 'sack'),
    prop(eastWallCol, workroomLastRow - 1, 'sack', 1),
    prop(eastWallCol, workroomLastRow, 'barrel', 1),
    prop(backRoomFirstCol, workroomLastRow, 'crate'),
    prop(backRoomFirstCol, workroomLastRow - 1, 'jars', 1),
    prop(eastWallCol - 1, workroomLastRow - 1, 'open_crate'),
  );

  entries.push(
    prop(westFlashCol, waitingFirstRow, 'flash_wall', FLASH_SET_WEST),
    prop(eastFlashCol, waitingFirstRow, 'flash_wall', FLASH_SET_EAST),
    prop(eastFlashLastCol + 2, waitingFirstRow, 'potted_bay'),
    prop(eastWallCol, waitingFirstRow, 'coat_stand'),
    prop(carpetCol, carpetRow, 'rug_large', WAITING_CARPET_COLOURWAY),
    prop(westSetteeCol, settingRow, 'settee', SETTEE_VIOLET),
    prop(westTableCol, tableRow, 'low_table'),
    prop(eastSetteeCol, settingRow, 'settee', SETTEE_TEAL),
    prop(eastTableCol, tableRow, 'side_table'),
    prop(eastWallCol, settingRow, 'potted_bay'),
    prop(westSetteeCol + TOWN_INTERIOR_PROPS.settee.footprint.w, settingRow, 'arm_lamp', 1),
    prop(eastWallCol, southRow, 'barrel'),
  );

  return entries;
}
