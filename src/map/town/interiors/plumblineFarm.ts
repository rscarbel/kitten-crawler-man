/**
 * Wendell's house: one room, built by someone who knows exactly how a room
 * should be built, and composed like one — four big pieces along the north
 * wall and everything else squared up against a wall or round a piece of
 * furniture.
 *
 * West to east along the north wall, three lives: the architect's drafting
 * table under its window; the builder's tool wall over his joiner's bench;
 * the hearth he dressed himself, in the middle where the door looks at it;
 * and the dairy wall of the farmer he is trying to be, under a window onto
 * the empty pasture. Below the architect's end stand the plan chest and a bin
 * of rolled drawings, and a door for someone else's house waits on trestles.
 * The good chair sits on the hearth rug. The dairy corner runs down the east
 * wall — churns, the milking stool, feed sacks — and his cot is made up
 * square in the south-west.
 *
 * The drafting table, plan chest and roll bin carry no `interaction` and
 * must never gain one: the drawings on them are art only, because what they
 * are and who gets them belongs to Wendell's own story, not to the room.
 *
 * The hearth's north-west tile is Wendell's anchor. An occupant stands on the
 * first walkable tile in rings round that tile, north row first, so he lands
 * on the tile just west of the hearth's second row, between his tools and
 * his fire. The door column stays clear from the door to the hearth rug: the
 * one walking lane every corner of the room is reached from.
 */

import { TOWN_INTERIOR_PROPS } from '../../../sprites/art/townInterior/townInteriorProps';
import { prop, type TownInteriorLayoutEntry } from './types';

/** `rug_medium`'s warm colourway, the one that sits with timber walls. */
const WARM_RUG_VARIANT = 1;
/** `rug_small`'s ember colourway, under the supper table. */
const SUPPER_RUG_VARIANT = 2;

export function buildPlumblineFarmLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const westCol = 1;
  const eastCol = w - 2;
  const northRow = 1;
  const southRow = h - 2;
  const doorCol = Math.floor(w / 2);

  // North wall, west to east: drafting table, tool wall, hearth, dairy wall.
  const draftingCol = westCol;
  const toolWallCol = draftingCol + TOWN_INTERIOR_PROPS.drafting_table.footprint.w;
  const hearthCol = toolWallCol + TOWN_INTERIOR_PROPS.tool_wall.footprint.w;
  const dairyWallCol = hearthCol + TOWN_INTERIOR_PROPS.builders_hearth.footprint.w;
  const underWallRow = northRow + 1;

  // The architect's corner under the drafting table; the door he is making
  // for someone else's house on trestles in front of his bench.
  const draftingStoolCol = draftingCol + 1;
  // The plan chest stands a row clear of the roll bin: its rack rises more
  // than a tile, and directly behind it the bin would vanish.
  const planChestRow = underWallRow + 2;
  const trestleRow = planChestRow;
  const trestleCol = westCol + TOWN_INTERIOR_PROPS.plan_chest.footprint.w;

  // The fireside: the rug below the hearthstone, the good chair on its east end.
  const hearthRugRow = northRow + TOWN_INTERIOR_PROPS.builders_hearth.footprint.h;
  const goodChairCol = hearthCol + TOWN_INTERIOR_PROPS.rug_medium.footprint.w - 1;

  // The dairy corner down the east wall.
  const churnCol = eastCol - 1;
  const milkingStoolRow = underWallRow + 1;
  const feedRow = milkingStoolRow + 1;
  const feedCol = eastCol - 1;

  // His tool chest, packed for a job, east of the door lane.
  const toolChestRow = feedRow + 2;
  const toolChestCol = feedCol - TOWN_INTERIOR_PROPS.tool_chest.footprint.w;

  // Down the west wall: the washstand, and his supper table on its own rug
  // beside it; the cot in the south-west corner.
  const washstandRow = trestleRow + 2;
  const supperRow = washstandRow;
  const supperCol = westCol + 2;
  const supperStoolCol = supperCol + 1;
  const timberStackCol = doorCol + 2;

  return [
    prop(draftingCol, northRow, 'drafting_table'),
    prop(toolWallCol, northRow, 'tool_wall'),
    prop(hearthCol, northRow, 'builders_hearth'),
    prop(dairyWallCol, northRow, 'dairy_wall'),

    prop(westCol, underWallRow, 'roll_bin'),
    prop(draftingStoolCol, underWallRow, 'stool'),
    prop(westCol, planChestRow, 'plan_chest'),
    prop(trestleCol, trestleRow, 'door_on_trestles'),

    prop(hearthCol, hearthRugRow, 'rug_medium', WARM_RUG_VARIANT),
    prop(goodChairCol, hearthRugRow, 'good_chair'),

    prop(churnCol, underWallRow, 'churn_stand'),
    prop(eastCol, milkingStoolRow, 'milking_stool'),
    prop(feedCol, feedRow, 'feed_stack'),
    prop(eastCol, feedRow + 1, 'sack'),
    prop(eastCol, toolChestRow, 'barrel'),
    prop(toolChestCol, toolChestRow, 'tool_chest'),

    prop(westCol, washstandRow, 'washstand'),
    prop(supperCol, supperRow, 'rug_small', SUPPER_RUG_VARIANT),
    prop(supperCol, supperRow, 'supper_table'),
    prop(supperStoolCol, supperRow + 1, 'stool', 1),
    prop(westCol, southRow, 'made_cot'),
    prop(westCol + TOWN_INTERIOR_PROPS.made_cot.footprint.w, southRow, 'chest'),
    prop(doorCol + 1, southRow, 'coat_hook'),
    prop(timberStackCol, southRow, 'timber_stack'),
    prop(eastCol, southRow, 'crate'),
  ];
}
