/**
 * The colour each tile type takes on a minimap: one table for the dungeon's
 * map and a building's, so a tile type known to one is never the default grey
 * on the other.
 */

import {
  BOULDER_LARGE,
  BOULDER_SMALL,
  BRIDGE,
  CAMPFIRE,
  CIRCUS_LOT,
  CIRCUS_STRUCTURE_LOW,
  CIRCUS_STRUCTURE_TALL,
  CLIFF,
  COBBLE_STREET,
  CROP_FIELD,
  DEN_HOLLOW,
  DRILL_SAND_FLOOR,
  FENCE,
  GARDEN_PLANTING,
  GOBLIN_TENT,
  HIGHLAND_GRASS,
  HOARDER_FLOOR,
  HOLLOW_DECAL,
  HOLLOW_GATE,
  HOLLOW_PALISADE,
  HOLLOW_PALISADE_GAP,
  HOLLOW_PLANK_FLOOR,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_THRESHOLD,
  HOLLOW_WALL,
  INTERIOR_BOARD_FLOOR,
  INTERIOR_COUNTER,
  INTERIOR_EARTH_FLOOR,
  INTERIOR_FLAG_FLOOR,
  INTERIOR_INK_FLOOR,
  INTERIOR_RUSH_FLOOR,
  INTERIOR_STONE_FLOOR,
  INTERIOR_WALL,
  LANE_STREET,
  PASTURE_GRASS,
  PEBBLE_SCATTER,
  PLAZA_STONE,
  RIVER_ROCK,
  ROCK_DEPOSIT,
  SAFE_ROOM_BANNER,
  SAFE_ROOM_FLOOR,
  SAFE_ROOM_HERB_RACK,
  SAFE_ROOM_LANTERN,
  SAFE_ROOM_LARDER,
  SAFE_ROOM_MENU_BOARD,
  SAFE_ROOM_RUG,
  SAFE_ROOM_STOOL,
  SAFE_ROOM_STOVE,
  SAFE_ROOM_TABLE,
  SAFE_ROOM_THRESHOLD,
  SCREE,
  TOWN_WALL,
  TREE,
  VERGE_GRASS,
  VOID_TYPE,
  WILDFLOWER_TUFT,
  YARD_GRAVEL,
  FloorTypeValue,
} from '../../map/tileTypes';
import { bossRoomMinimapColor } from '../../map/tiles/bossRoomTiles';

/** The dots a minimap puts over its tiles, shared by every minimap and edge marker. */
export const MINIMAP_MARKER_COLORS = {
  exit: '#facc15',
  companion: '#60a5fa',
  player: '#4ade80',
  pet: '#f0abfc',
  /** The dark edge round a marker drawn over busy art. */
  outline: '#000000',
} as const;

/** Standing forest, a shade deeper than the grass it grows out of. */
const LIVING_TREE_MINIMAP_COLOR = '#2c5434';

/** The colour tile `type` is drawn in on a minimap. */
export function minimapTileColor(type: number): string {
  switch (type) {
    case VOID_TYPE:
      return '#000000';
    case FloorTypeValue.wall:
      return '#3a3028';
    case FloorTypeValue.grass:
      return '#3a7040';
    case FloorTypeValue.road:
      return '#6a5040';
    case FloorTypeValue.water:
      return '#1a6880';
    case FloorTypeValue.concrete:
      return '#606060';
    case FloorTypeValue.tile_floor:
      return '#707070';
    case FloorTypeValue.carpet:
      return '#503030';
    case FloorTypeValue.wood:
      return '#704030';
    case SAFE_ROOM_FLOOR:
    // A minimap is a floor plan, so the runner the player walks straight over
    // is the floor.
    case SAFE_ROOM_RUG:
      return '#8a7040';
    case SAFE_ROOM_THRESHOLD:
      return '#7a6a4c'; // the worn band inside a safe room's doorways
    // The eight solid furnishings share one furniture tone rather than each
    // becoming a stray grey pixel from the default case.
    case SAFE_ROOM_MENU_BOARD:
    case SAFE_ROOM_HERB_RACK:
    case SAFE_ROOM_BANNER:
    case SAFE_ROOM_LANTERN:
    case SAFE_ROOM_STOVE:
    case SAFE_ROOM_TABLE:
    case SAFE_ROOM_STOOL:
    case SAFE_ROOM_LARDER:
      return '#5c4a2c';
    case HOARDER_FLOOR:
      return '#2a1808';
    case TOWN_WALL:
      return '#8a8175';
    case VERGE_GRASS:
      return '#4c6338'; // street verge — greener than a street, duller than field grass
    case YARD_GRAVEL:
      return '#6e685e';
    case LANE_STREET:
      return '#7a6448';
    case COBBLE_STREET:
      return '#8e7a5c'; // the two main streets, lighter so the spine reads at a glance
    case PLAZA_STONE:
      return '#a89c86';
    case GARDEN_PLANTING:
      return '#5f7a34'; // planted bed — a shade greener than the verge it sits on
    case FENCE:
      return '#6a5334'; // yard fence, in its own timber colour
    case TREE:
      return LIVING_TREE_MINIMAP_COLOR;
    // Town building interiors. Without these the room's floor, walls and
    // counter all fall to the default grey, and its minimap is a flat square.
    case INTERIOR_WALL:
      return '#3a3028';
    case INTERIOR_BOARD_FLOOR:
      return '#6a4a30';
    case INTERIOR_STONE_FLOOR:
      return '#585860';
    case INTERIOR_RUSH_FLOOR:
      return '#7a5f3c';
    case INTERIOR_EARTH_FLOOR:
      return '#4a3e30';
    case INTERIOR_FLAG_FLOOR:
      return '#5e5850';
    case INTERIOR_INK_FLOOR:
      return '#6a5138';
    case DRILL_SAND_FLOOR:
      return '#8a7448';
    case INTERIOR_COUNTER:
      return '#4a3020';
    // The floor-3 wilderness. Every one of these needs an entry here and in
    // `TownMapScene`'s table — a type known to one and not the other draws as
    // the default grey, which is how a whole river or a whole camp can vanish
    // from one map and not the next.
    case HIGHLAND_GRASS:
      return '#6f7048'; // upland turf — drier and paler than field grass
    case SCREE:
      return '#6a6660';
    case WILDFLOWER_TUFT:
      return '#4a7a48';
    case PEBBLE_SCATTER:
      return '#787268';
    case BRIDGE:
      return '#8a6a44'; // timber, and lighter than the water it spans
    case RIVER_ROCK:
      return '#4a5a60';
    case BOULDER_SMALL:
    case BOULDER_LARGE:
      return '#6e6a64';
    case CLIFF:
      return '#57534c';
    case CAMPFIRE:
      return '#d07a2c';
    case GOBLIN_TENT:
      return '#7a5f3a';
    case DEN_HOLLOW:
      return '#2e2a26';
    // Briar Hollow. Every one of these needs an entry here and in
    // `TownMapScene`'s table — a type known to one and not the other draws as
    // the default grey, or magenta in the schematic view.
    case HOLLOW_WALL:
      return '#8a7458';
    case HOLLOW_PLANK_FLOOR:
      return '#8a6a42';
    case HOLLOW_THRESHOLD:
      return '#7a6248';
    case HOLLOW_PROP_LOW:
      return '#9a7850';
    case HOLLOW_PROP_TALL:
      return '#6a5238';
    case HOLLOW_DECAL:
      return '#6e7a3c';
    case HOLLOW_PALISADE:
      return '#8a6a3c';
    case HOLLOW_PALISADE_GAP:
      return '#5c5548';
    case HOLLOW_GATE:
      return '#6b5636';
    case ROCK_DEPOSIT:
      return '#726a5e';
    case PASTURE_GRASS:
      return '#5c8048';
    case CROP_FIELD:
      return '#6e5636';
    // The circus grounds. Like Briar Hollow's types, each needs an entry in
    // `TownMapScene`'s table as well.
    case CIRCUS_LOT:
      return '#6a6240';
    case CIRCUS_STRUCTURE_TALL:
      return '#a0433c';
    case CIRCUS_STRUCTURE_LOW:
      return '#b89a6a';
    default:
      return bossRoomMinimapColor(type) ?? '#555555';
  }
}
