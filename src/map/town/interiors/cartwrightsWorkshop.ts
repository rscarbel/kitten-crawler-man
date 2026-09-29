/**
 * A wheelwright's shop, composed around what he makes and what he keeps.
 *
 * The north wall is the working wall: finished wheels leaning in the corner,
 * the joiner's bench under its tool board, and the spring-pole lathe with
 * its pole bracketed overhead. The east end is walled off into a timber bay
 * racked to the rafters, open along its south side so the stock is behind a
 * wall without being behind a door. The middle of the floor is where the
 * wheels get built — the wheel on its stand, the shaving horse, the sawhorse
 * — each with its shavings lying round it. Along the south wall, beside the
 * door, the long red circus wagon bed sits up on cribbing under a dust
 * sheet, and across the door from it the firewood a wheelwright sells from
 * his offcuts.
 *
 * The bench is the room's only `table` anchor, so the wheelwright always
 * stands at it. The corner tiles either side of its west end are blocked on
 * purpose: the stand search tries the tile north-west, then west, then
 * south-west of an anchor before due south, and leaving any of those open
 * would stand him beside his bench instead of at it.
 */

import { INTERIOR_WALL } from '../../tileTypes';
import { prop, tileColumn, type TownInteriorLayoutEntry } from './types';

const BENCH_WIDTH = 5;
const LATHE_WIDTH = 3;
const FINISHED_WHEELS_WIDTH = 2;
const WAGON_WIDTH = 5;
const WAGON_DEPTH = 2;
const WHEEL_STAND_SIZE = 2;
/** Rows the timber bay's partition runs down from the north wall. */
const BAY_DEPTH_ROWS = 3;
/** Open floor rows between the north-wall pieces and the wheel stand — room to stand at the bench. */
const WORK_AISLE_ROWS = 2;
/** Tiles east of the door the firewood starts, leaving a clear approach to the door. */
const FIREWOOD_DOOR_CLEARANCE = 3;

export function buildCartwrightsWorkshopLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const westCol = 1;
  const eastCol = w - 2;
  const northRow = 1;
  const southRow = h - 2;
  const doorWestCol = Math.floor(w / 2) - 1;

  // North wall: wheels, bench, lathe, then the bay.
  const finishedWheelsCol = westCol;
  const benchCol = finishedWheelsCol + FINISHED_WHEELS_WIDTH;
  const latheCol = benchCol + BENCH_WIDTH;
  const bayWallCol = latheCol + LATHE_WIDTH;
  const bayFirstCol = bayWallCol + 1;
  const bayWallLastRow = northRow + BAY_DEPTH_ROWS - 1;
  // South-west of the bench's anchor tile: blocked so the stand search
  // lands on the tile directly in front of the bench instead.
  const spokeTubCol = benchCol - 1;
  const aisleRow = northRow + 1;
  const gluePotCol = bayWallCol - 1;
  const gluePotRow = northRow + WORK_AISLE_ROWS;

  // The working floor: the wheel on its stand, the shaving horse beside it,
  // the sawhorse out towards the bay, shavings lying in front of each.
  const wheelStandCol = westCol + 1;
  const wheelStandRow = northRow + 1 + WORK_AISLE_ROWS;
  const wheelShavingsRow = wheelStandRow + WHEEL_STAND_SIZE;
  const shavingHorseCol = wheelStandCol + WHEEL_STAND_SIZE + 1;
  const shavingHorseRow = wheelStandRow + 1;
  const axleCol = latheCol - 1;
  const axleRow = northRow + WORK_AISLE_ROWS;
  const sawhorseCol = bayWallCol - 1;
  const sawhorseRow = wheelStandRow + 1;
  const plankPileCol = eastCol - 2;
  const plankPileRow = sawhorseRow + 2;

  // South wall: the wagon bed west of the door, firewood east of it.
  const wagonCol = westCol;
  const wagonRow = southRow - WAGON_DEPTH + 1;
  const toolboxCol = wagonCol + WAGON_WIDTH;
  const firewoodCol = doorWestCol + FIREWOOD_DOOR_CLEARANCE;

  // East wall below the bay: spare stock, where the two customers loiter.
  const eastStockRow = bayWallLastRow + 2;

  const entries: TownInteriorLayoutEntry[] = [];

  // Loot-bearing clutter first: the payout gate reads the first breakable
  // in placement order, and the shop's own stock (spokes, timber) never pays.
  entries.push(prop(eastCol, southRow - 1, 'crate'), prop(eastCol, southRow, 'barrel', 1));

  entries.push(
    prop(finishedWheelsCol, northRow, 'wheelwright_stand'),
    prop(benchCol, northRow, 'joiner_bench'),
    prop(spokeTubCol, aisleRow, 'spoke_tub', 0, { dropsLoot: false }),
    prop(latheCol, northRow, 'lathe'),
    prop(gluePotCol, gluePotRow, 'glue_pot'),
  );

  entries.push(...tileColumn(bayWallCol, northRow, bayWallLastRow, INTERIOR_WALL));
  entries.push(prop(bayFirstCol, northRow, 'timber_rack'), prop(eastCol, bayWallLastRow, 'crate'));

  entries.push(
    prop(westCol, wheelStandRow, 'barrel'),
    prop(westCol, wheelStandRow + 1, 'crate'),
    prop(wheelStandCol, wheelStandRow, 'wheel_build_stand'),
    prop(wheelStandCol, wheelShavingsRow, 'shavings_floor', 1),
    prop(shavingHorseCol, shavingHorseRow, 'shaving_horse'),
    prop(shavingHorseCol, shavingHorseRow + 1, 'shavings_floor', 0),
    prop(axleCol, axleRow, 'axle_set'),
    prop(sawhorseCol, sawhorseRow, 'sawhorse'),
    prop(sawhorseCol, sawhorseRow + 1, 'shavings_floor', 1),
    prop(plankPileCol, plankPileRow, 'plank_pile'),
  );

  entries.push(
    prop(eastCol, eastStockRow, 'barrel'),
    prop(eastCol, eastStockRow + 1, 'crate'),
    prop(eastCol - 1, eastStockRow, 'spoke_tub', 0, { dropsLoot: false }),
  );

  entries.push(
    prop(wagonCol, wagonRow, 'wagon_bed'),
    prop(toolboxCol, southRow, 'chest', 0, { id: 'cartwright_toolbox' }),
    prop(firewoodCol, southRow, 'firewood_stack'),
  );

  return entries;
}
