/**
 * Wendell's house: one room, built by someone who knows exactly how a room
 * should be built, and composed like one — four big pieces along the north
 * wall and everything else squared up against a wall or round a piece of
 * furniture.
 *
 * Three lives share it. The architect he trained as: the drafting table
 * under its window with a real drawing pinned to it, the framed elevation of
 * a hall nobody built, the T-square and set square on their pegs, the plan
 * chest and the bin of rolled drawings he never throws away. The builder he
 * became: the tool wall with every tool over its painted outline, a door for
 * someone else's house on trestles, the timber stack and the offcut box, and
 * shelves built as a flight of stairs because he could. The farmer he tried
 * to be: the dairy wall with its slate of cows' names struck through, the
 * scoured churns, the stacked empty pails, feed sacks still full, and a
 * cowbell on the peg post by the door.
 *
 * Four props change with Wendell's story rather than the layout, so the room
 * is the same room at every step: see {@link plumblineFarmPropVariants}.
 *
 * The drafting table, plan chest and roll bin carry no `interaction` and
 * must never gain one: the drawings on and in them are Wendell's own story
 * to tell, not the room's.
 *
 * The hearth's north-west tile is Wendell's anchor. An occupant stands on the
 * first walkable tile in rings round that tile, north row first, so he lands
 * on the tile just west of the hearth's second row, between his tools and
 * his fire. The two door columns stay clear from the door to the hearth rug:
 * the one walking lane every corner of the room is reached from.
 */

import { TOWN_INTERIOR_PROPS } from '../../../sprites/art/townInterior/townInteriorProps';
import {
  BOOT_TRAY_VARIANT,
  CHURN_STAND_VARIANT,
  DOOR_PEG_POST_VARIANT,
  PLAN_CHEST_VARIANT,
} from '../../../sprites/art/townInterior/rooms/plumblineFarm';
import { prop, type TownInteriorLayoutEntry } from './types';

/** `rug_medium`'s warm colourway, the one that sits with timber walls. */
const WARM_RUG_VARIANT = 1;
/** `rug_small`'s ember colourway, under the supper table. */
const SUPPER_RUG_VARIANT = 2;

/**
 * What Wendell's story has done to his room, derived by whoever builds the
 * room from the quest's own state.
 */
export interface PlumblineFarmState {
  /** A cow lives in the pasture again: the dairy corner is in use and the cowbell is on her. */
  readonly dairyCornerLive: boolean;
  /** Fenna's blueprints are in Wendell's keeping, so they show in the plan chest's top drawer. */
  readonly blueprintsInPlanChest: boolean;
}

/** The room before anyone has come for the blueprints. */
export const PLUMBLINE_FARM_UNTOUCHED: PlumblineFarmState = {
  dairyCornerLive: false,
  blueprintsInPlanChest: true,
};

/**
 * The placed ids of the props {@link PlumblineFarmState} swaps. Stated rather
 * than left to the `propId@x,y` default, so moving one of them in the layout
 * cannot orphan the swap.
 */
export const PLUMBLINE_FARM_SWAPPED_PROP_IDS = {
  planChest: 'plumbline_plan_chest',
  churnStand: 'plumbline_churn_stand',
  doorPegPost: 'plumbline_door_peg_post',
  bootTray: 'plumbline_boot_tray',
} as const;

/** The variant each swapped prop wears for `state`. */
export function plumblineFarmPropVariants(
  state: PlumblineFarmState,
): ReadonlyArray<{ readonly id: string; readonly variant: number }> {
  const live = state.dairyCornerLive;
  return [
    {
      id: PLUMBLINE_FARM_SWAPPED_PROP_IDS.planChest,
      variant: state.blueprintsInPlanChest
        ? PLAN_CHEST_VARIANT.withBlueprints
        : PLAN_CHEST_VARIANT.empty,
    },
    {
      id: PLUMBLINE_FARM_SWAPPED_PROP_IDS.churnStand,
      variant: live ? CHURN_STAND_VARIANT.inUse : CHURN_STAND_VARIANT.idle,
    },
    {
      id: PLUMBLINE_FARM_SWAPPED_PROP_IDS.doorPegPost,
      variant: live ? DOOR_PEG_POST_VARIANT.bareNail : DOOR_PEG_POST_VARIANT.withCowbell,
    },
    {
      id: PLUMBLINE_FARM_SWAPPED_PROP_IDS.bootTray,
      variant: live ? BOOT_TRAY_VARIANT.withMilkPail : BOOT_TRAY_VARIANT.bootsOnly,
    },
  ];
}

function variantFor(state: PlumblineFarmState, id: string): number {
  return plumblineFarmPropVariants(state).find((entry) => entry.id === id)?.variant ?? 0;
}

export function buildPlumblineFarmLayout(
  w: number,
  h: number,
  _floorType?: number,
  state: PlumblineFarmState = PLUMBLINE_FARM_UNTOUCHED,
): TownInteriorLayoutEntry[] {
  const westCol = 1;
  const eastCol = w - 2;
  const northRow = 1;
  const southRow = h - 2;
  // The doorway is two tiles wide; this is its east column.
  const doorCol = Math.floor(w / 2);
  const doorWestCol = doorCol - 1;
  const swapped = PLUMBLINE_FARM_SWAPPED_PROP_IDS;

  // North wall, west to east: drafting table, tool wall, hearth, dairy wall.
  const draftingCol = westCol;
  const toolWallCol = draftingCol + TOWN_INTERIOR_PROPS.drafting_table.footprint.w;
  const hearthCol = toolWallCol + TOWN_INTERIOR_PROPS.tool_wall.footprint.w;
  const dairyWallCol = hearthCol + TOWN_INTERIOR_PROPS.builders_hearth.footprint.w;
  const underWallRow = northRow + 1;

  // The architect's corner under the drafting table; the door he is making
  // for someone else's house on trestles in front of his bench. The plan
  // chest stands a row clear of the roll bin: its rack rises more than a
  // tile, and directly behind it the bin would vanish.
  const draftingStoolCol = draftingCol + 1;
  // A sawhorse standing out in front of the joiner's bench.
  const sawhorseCol = toolWallCol;
  const planChestRow = underWallRow + 2;
  const trestleRow = planChestRow;
  const trestleCol = westCol + TOWN_INTERIOR_PROPS.plan_chest.footprint.w;

  // The fireside: the rug below the hearthstone, the good chair on its east end.
  const hearthRugRow = northRow + TOWN_INTERIOR_PROPS.builders_hearth.footprint.h;
  const goodChairCol = hearthCol + TOWN_INTERIOR_PROPS.rug_medium.footprint.w - 1;

  // The dairy corner down the east wall: churns under the dairy bench, the
  // stacked pails beside them, and the feed below. The column west of them
  // stays open: the good chair closes the rug's east end, and that column is
  // the only way in to the churns.
  const churnCol = eastCol - 1;
  const pailStackRow = underWallRow + 1;
  const feedRow = pailStackRow + 1;

  // The middle of the room: his tool chest packed for a job, and the stair
  // shelves against the east wall beside it.
  const workRow = feedRow + 2;
  const stairShelfCol = eastCol - 1;
  const toolChestCol = stairShelfCol - TOWN_INTERIOR_PROPS.tool_chest.footprint.w;

  // Down the west wall: the washstand, and his supper table on its own rug
  // beside it; the cot in the south-west corner.
  const washstandRow = trestleRow + 2;
  const supperRow = washstandRow;
  const supperCol = westCol + 2;
  const supperStoolCol = supperCol + 1;

  // Either side of the door: his boots on their tray to the west, the peg
  // post with his coat and the cowbell to the east, then the timber stack
  // and the offcut box in the south-east corner.
  // The boot tray stands a tile off the doorway, against the chest, because
  // the supper stool above that tile would otherwise wall it in.
  const bootTrayCol = doorWestCol - 2;
  const pegPostCol = doorCol + 1;
  const timberStackCol = pegPostCol + 1;

  return [
    prop(draftingCol, northRow, 'drafting_table'),
    prop(toolWallCol, northRow, 'tool_wall'),
    prop(hearthCol, northRow, 'builders_hearth'),
    prop(dairyWallCol, northRow, 'dairy_wall'),

    prop(westCol, underWallRow, 'roll_bin'),
    prop(draftingStoolCol, underWallRow, 'stool'),
    prop(sawhorseCol, underWallRow, 'sawhorse'),
    prop(westCol, planChestRow, 'plan_chest', variantFor(state, swapped.planChest), {
      id: swapped.planChest,
    }),
    prop(trestleCol, trestleRow, 'door_on_trestles'),

    prop(hearthCol, hearthRugRow, 'rug_medium', WARM_RUG_VARIANT),
    prop(goodChairCol, hearthRugRow, 'good_chair'),

    prop(churnCol, underWallRow, 'churn_stand', variantFor(state, swapped.churnStand), {
      id: swapped.churnStand,
    }),
    prop(eastCol, pailStackRow, 'pail_stack'),
    prop(churnCol, feedRow, 'feed_stack'),

    prop(toolChestCol, workRow, 'tool_chest'),
    prop(stairShelfCol, workRow, 'stair_shelf'),

    prop(westCol, washstandRow, 'washstand'),
    prop(supperCol, supperRow, 'rug_small', SUPPER_RUG_VARIANT),
    prop(supperCol, supperRow, 'supper_table'),
    prop(supperStoolCol, supperRow + 1, 'stool', 1),
    prop(westCol, southRow, 'made_cot'),
    prop(westCol + TOWN_INTERIOR_PROPS.made_cot.footprint.w, southRow, 'chest'),
    prop(bootTrayCol, southRow, 'boot_tray', variantFor(state, swapped.bootTray), {
      id: swapped.bootTray,
    }),
    prop(pegPostCol, southRow, 'door_peg_post', variantFor(state, swapped.doorPegPost), {
      id: swapped.doorPegPost,
    }),
    prop(timberStackCol, southRow, 'timber_stack'),
    prop(eastCol, southRow, 'offcut_box'),
  ];
}
