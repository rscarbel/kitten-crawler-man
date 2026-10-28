/**
 * A wheelwright's shop, composed around what he makes and what he keeps.
 *
 * The north wall is the working wall: finished wheels leaning in the corner,
 * the joiner's bench under its tool board, and the spring-pole lathe with
 * its pole bracketed overhead. The east end is walled off into a timber bay
 * racked to the rafters, open along its south side so the stock is behind a
 * wall without being behind a door. The middle of the floor is where the
 * wheels get built — the wheel on its stand, the shaving horse, the sawhorse
 * — each with its shavings lying round it. Below them runs his range: a
 * target board by the east wall with a clear lane west from it, where
 * he stands and shoots between jobs. Along the south wall, beside the
 * door, the long red circus wagon bed sits up on cribbing under a dust
 * sheet, and across the door from it the firewood a wheelwright sells from
 * his offcuts.
 *
 * The lane is load-bearing: the wheelwright is stood a fixed distance west
 * of the board (his roster's `prop` placement), and nothing may be placed on
 * the board's row between it and him, or he would be shooting through it.
 * It runs east of the door's columns so the way in never crosses it, and it
 * runs east-west so he is seen in profile while he shoots.
 */

import { INTERIOR_WALL } from '../../tileTypes';
import {
  contractTarget,
  prop,
  tileColumn,
  type TownInteriorLayoutEntry,
  statefulProp,
  contractTargetId,
} from './types';
import type { ContractAreaRecord } from '../../contractAreas';
import type { PlannedBuildingId } from '../../buildingIds';

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

const CONTRACT_SITE = 'taloncrest_crafting_house' satisfies PlannedBuildingId;
/** The bay's open floor under the rack and the step out of it, two tiles square. */
const BAY_PAD_SPOT_SIZE = 2;

/** The north wall's run and the timber bay, shared by the layout and its contract rects. */
function workshopNorthWall() {
  const westCol = 1;
  const northRow = 1;
  // North wall: wheels, bench, lathe, then the bay.
  const finishedWheelsCol = westCol;
  const benchCol = finishedWheelsCol + FINISHED_WHEELS_WIDTH;
  const latheCol = benchCol + BENCH_WIDTH;
  const bayWallCol = latheCol + LATHE_WIDTH;
  const bayFirstCol = bayWallCol + 1;
  const bayWallLastRow = northRow + BAY_DEPTH_ROWS - 1;
  return {
    westCol,
    northRow,
    finishedWheelsCol,
    benchCol,
    latheCol,
    bayWallCol,
    bayFirstCol,
    bayWallLastRow,
  };
}

/** Cartwright's Workshop's floor and wall rects a construction contract can mark, keyed by spot id. */
export function buildCartwrightsWorkshopContractAreas(_w: number, _h: number): ContractAreaRecord {
  const { bayWallCol, bayFirstCol, bayWallLastRow } = workshopNorthWall();
  return {
    bay_pad: {
      kind: 'floor',
      x: bayFirstCol,
      y: bayWallLastRow,
      w: BAY_PAD_SPOT_SIZE,
      h: BAY_PAD_SPOT_SIZE,
    },
    // The foot of the bay's partition: the north wall is lined wall to wall
    // with the stand, the bench and the lathe, so this is the one stretch of
    // stonework the floor touches.
    north_wall: { kind: 'wall', x: bayWallCol, y: bayWallLastRow, w: 1, h: 1 },
  };
}

export function buildCartwrightsWorkshopLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const {
    westCol,
    northRow,
    finishedWheelsCol,
    benchCol,
    latheCol,
    bayWallCol,
    bayFirstCol,
    bayWallLastRow,
  } = workshopNorthWall();
  const eastCol = w - 2;
  const southRow = h - 2;
  const doorWestCol = Math.floor(w / 2) - 1;
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
  const plankPileRow = sawhorseRow + 1;
  // A column in from the east wall, so the wall's floor stays one open run
  // round it, and a row clear of the plank pile above, so the lane west of it
  // runs open across the floor, east of the door's columns.
  const targetCol = eastCol - 1;
  const targetRow = plankPileRow + 2;

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
  entries.push(
    statefulProp(eastCol, southRow - 1, 'crate', 'crate_1'),
    statefulProp(eastCol, southRow, 'barrel', 'barrel_1', 1),
  );

  entries.push(
    prop(finishedWheelsCol, northRow, 'wheelwright_stand'),
    prop(benchCol, northRow, 'joiner_bench', 0, contractTarget(CONTRACT_SITE, 'joiner_bench')),
    statefulProp(spokeTubCol, aisleRow, 'spoke_tub', 'spoke_tub_1', 0, { dropsLoot: false }),
    prop(latheCol, northRow, 'lathe', 0, contractTarget(CONTRACT_SITE, 'lathe')),
    statefulProp(
      gluePotCol,
      gluePotRow,
      'glue_pot',
      contractTargetId(CONTRACT_SITE, 'glue_hearth'),
      0,
    ),
  );

  entries.push(...tileColumn(bayWallCol, northRow, bayWallLastRow, INTERIOR_WALL));
  entries.push(
    prop(bayFirstCol, northRow, 'timber_rack', 0, contractTarget(CONTRACT_SITE, 'timber_rack')),
    statefulProp(eastCol, bayWallLastRow, 'crate', 'crate_2'),
  );

  entries.push(
    statefulProp(westCol, wheelStandRow, 'barrel', 'barrel_2'),
    statefulProp(westCol, wheelStandRow + 1, 'crate', 'crate_3'),
    prop(
      wheelStandCol,
      wheelStandRow,
      'wheel_build_stand',
      0,
      contractTarget(CONTRACT_SITE, 'wheel_stand'),
    ),
    prop(wheelStandCol, wheelShavingsRow, 'shavings_floor', 1),
    prop(shavingHorseCol, shavingHorseRow, 'shaving_horse'),
    prop(shavingHorseCol, shavingHorseRow + 1, 'shavings_floor', 0),
    prop(axleCol, axleRow, 'axle_set'),
    prop(sawhorseCol, sawhorseRow, 'sawhorse'),
    prop(sawhorseCol, sawhorseRow + 1, 'shavings_floor', 1),
    prop(targetCol, targetRow, 'target_board'),
    prop(plankPileCol, plankPileRow, 'plank_pile'),
  );

  entries.push(
    statefulProp(eastCol, eastStockRow, 'barrel', 'barrel_3'),
    statefulProp(eastCol, eastStockRow + 1, 'crate', 'crate_4'),
    statefulProp(eastCol - 1, eastStockRow, 'spoke_tub', 'spoke_tub_2', 0, { dropsLoot: false }),
  );

  entries.push(
    prop(wagonCol, wagonRow, 'wagon_bed', 0, contractTarget(CONTRACT_SITE, 'wagon_bed')),
    statefulProp(toolboxCol, southRow, 'chest', 'cartwright_toolbox', 0),
    prop(firewoodCol, southRow, 'firewood_stack'),
  );

  return entries;
}
