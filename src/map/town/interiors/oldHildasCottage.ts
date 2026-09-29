/**
 * A hedge-witch's one room, crowded in clusters rather than dotted with
 * clutter: the north wall is three big pieces side by side — her jar
 * dresser, the hearth with the cauldron out on its stone, and a drying beam
 * hung end to end with herbs over a bench of cut stems — and everything
 * else in the room heaps up against a wall or around a piece of furniture:
 * the cat's armchair and a footstool on the hearth rug, books piled against
 * the east wall, the worktable with its baskets and jars along the west,
 * sacks and barrels stacked into both south corners. The middle of the room
 * stays a clear path from the door to the fire.
 *
 * The hearth is a real hearth prop because the cottage's second occupant —
 * the customer waiting on a charm — is anchored to a hearth, and the dresser
 * carries the `shelf` anchor Hilda herself browses: an anchor group that
 * matches nothing drops its occupant with no error at all.
 *
 * Her actual worktable, chair and "shelf over on the side" — the three
 * pieces her anchor-quest text has the kids break — are placed here as the
 * raw `TABLE`/`CHAIR`/`BOOKSHELF` tile types rather than as props:
 * `AnchorInteriorSystem.pickRepairableFurnishings` finds its wreck by
 * scanning the grid for those exact tile types, and a prop instance never
 * writes one (see `applyTownInteriorLayout`) — an all-prop room would leave
 * that scan empty and the whole repair errand silently unplayable. Nothing
 * else in the room may use those three tile types, or the scan would pick
 * the wrong piece.
 */

import { BOOKSHELF, CHAIR, TABLE } from '../../tileTypes';
import { TOWN_INTERIOR_PROPS } from '../../../sprites/art/townInterior/townInteriorProps';
import { prop, tile, type TownInteriorLayoutEntry } from './types';

/** Deep sky field, ember border — the reading-table rug, told apart from the hearth rug's ember field. */
const READING_RUG_COLOURWAY = 3;

export function buildOldHildasCottageLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const westCol = 1;
  const eastCol = w - 2;
  const northRow = 1;
  const southRow = h - 2;

  // North wall, west to east: dresser (3 wide), hearth (3 wide, 2 deep),
  // the birdcage stand, then the drying beam into the east corner.
  const dresserCol = westCol;
  const hearthCol = dresserCol + TOWN_INTERIOR_PROPS.jar_dresser.footprint.w;
  const birdcageCol = hearthCol + TOWN_INTERIOR_PROPS.witch_hearth.footprint.w;
  const dryingBeamCol = birdcageCol + 1;

  // The hearth rug and its seating, just south of the fire.
  const hearthRugRow = northRow + 2;
  const hearthRugCol = hearthCol;
  const armchairCol = birdcageCol;
  const armchairRow = hearthRugRow;
  const footstoolRow = armchairRow + 1;
  const bookHeapCol = eastCol - 1;
  const bookHeapRow = hearthRugRow;
  const eastShelfRow = bookHeapRow + 2;

  // Her worktable stands just south of the hearth rug, a stool pulled up to
  // it and baskets of what she is working through at either end.
  const worktableRow = hearthRugRow + 2;
  const worktableCol = hearthCol;
  const workStoolRow = worktableRow + 1;
  const workStoolCol = worktableCol + 1;

  // The mended-furniture corner on the west wall: the "shelf over on the
  // side" against the wall, the table and chair in front of it. Nothing else
  // in the room uses these tile types, so the repair scan finds exactly these.
  const wreckShelfRow = worktableRow + 1;
  const wreckTableRow = wreckShelfRow + 1;
  const wreckTableCol1 = westCol;
  const wreckTableCol2 = wreckTableCol1 + 1;
  const wreckChairCol = wreckTableCol2 + 1;

  // The kitchen table she reads for customers at, on its own rug in the
  // middle of the room with a stool either side.
  const readingRugRow = wreckTableRow;
  const readingRugCol = wreckChairCol + 2;
  const readingTableCol = readingRugCol + 1;

  const storeRow = southRow - 1;
  // The door is two columns wide with its east column on the room's centre
  // line (see `generateInterior`); the broom leans against the wall just west
  // of it, off both columns, so it never snags the player stepping in.
  const doorEastCol = Math.floor(w / 2);
  const doorWestCol = doorEastCol - 1;
  const broomCol = doorWestCol - 1;

  return [
    prop(dresserCol, northRow, 'jar_dresser'),
    prop(hearthCol, northRow, 'witch_hearth'),
    prop(birdcageCol, northRow, 'birdcage_stand'),
    prop(dryingBeamCol, northRow, 'drying_beam'),
    prop(eastCol, northRow + 1, 'mushroom_basket'),
    prop(eastCol - 1, northRow + 1, 'basket', 1),

    // Colourway 2 (ember field, deep sky border) reads as worn wool rather
    // than the sky-blue/ember default's shop-carpet brightness.
    prop(hearthRugCol, hearthRugRow, 'rug_medium', 2),
    prop(armchairCol, armchairRow, 'cat_armchair'),
    prop(armchairCol, footstoolRow, 'hedge_stool'),
    prop(bookHeapCol, bookHeapRow, 'book_heap'),

    prop(westCol, hearthRugRow, 'crock_cluster'),
    prop(westCol + 1, hearthRugRow, 'sack'),
    prop(westCol, worktableRow, 'crock_cluster', 1),
    prop(worktableCol - 1, worktableRow, 'mushroom_basket'),
    prop(worktableCol, worktableRow, 'witch_worktable'),
    prop(workStoolCol, workStoolRow, 'stool'),
    prop(worktableCol + TOWN_INTERIOR_PROPS.witch_worktable.footprint.w, worktableRow, 'basket', 1),

    tile(westCol, wreckShelfRow, BOOKSHELF),
    tile(wreckTableCol1, wreckTableRow, TABLE),
    tile(wreckTableCol2, wreckTableRow, TABLE),
    tile(wreckChairCol, wreckTableRow, CHAIR),

    prop(eastCol, eastShelfRow, 'crockery_shelf'),
    prop(eastCol, eastShelfRow + 1, 'crock_cluster', 1),
    prop(eastCol - 1, eastShelfRow, 'oil_lamp'),

    prop(readingRugCol, readingRugRow, 'rug_medium', READING_RUG_COLOURWAY),
    prop(readingTableCol - 1, readingRugRow, 'stool', 1),
    prop(readingTableCol, readingRugRow, 'table_small', 1),
    prop(readingTableCol + 1, readingRugRow, 'stool'),

    // Her bed along the south wall's west end, a chest at its foot.
    prop(westCol, southRow, 'cottage_bed'),
    prop(westCol + 2, southRow, 'chest'),
    prop(westCol, storeRow, 'basket'),

    // Stores stacked into the corner by the door.
    prop(eastCol, storeRow - 2, 'barrel'),
    prop(eastCol, storeRow - 1, 'sack'),
    prop(eastCol, storeRow, 'barrel', 1),
    prop(eastCol, southRow, 'crate'),
    prop(eastCol - 1, southRow, 'crate'),
    prop(broomCol, southRow, 'broom'),
  ];
}
