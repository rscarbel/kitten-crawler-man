/**
 * The dungeon's ground materials, and the rules for how they meet.
 *
 * One `GroundPalette` over the generated `ground_dungeon` sheet, covering only
 * the dungeon's safe rooms: the safe room's floor and the spider lab's field
 * station. A safe room is the same waystation wherever it is found, so it
 * keeps one palette shared by both dungeon floors while the floors
 * themselves are drawn through `FLOOR1_GROUND` and `FLOOR2_GROUND`
 * (`src/map/dungeon/floorTheme.ts`).
 *
 * This module is deliberately free of canvas code — `src/map/tiles/groundTiles.ts`
 * does the drawing.
 */

import type { SpriteStates } from '../../core/spriteAssets/SpriteLoader';
import type { GroundPalette, GroundSpill } from '../ground/GroundPalette';
import {
  SAFE_ROOM_FLOOR,
  SAFE_ROOM_RUG,
  SAFE_ROOM_THRESHOLD,
  LAB_STATION_FLOOR,
  LAB_STATION_THRESHOLD,
} from '../tileTypes';

/** Sheet holding every dungeon ground material, one material per row. */
const GROUND_SHEET_KEY = 'ground_dungeon';

/** A material that is not a state of the dungeon sheet is a compile error. */
export type DungeonGroundMaterial = SpriteStates[typeof GROUND_SHEET_KEY];

/**
 * The materials a safe room and a field station are laid in, softest first.
 *
 * `safe_room_scuff` sits lowest so the harder tile bleeds over the traffic band
 * rather than the band eating into the room — a threshold is worn *through* the
 * floor, not laid on top of it. Only these are ordered because only these are
 * placed; a dungeon-wide rollout adds the rest here.
 */
const GROUND_BLEND_ORDER = {
  safe_room_scuff: 0,
  safe_room_tile: 1,
  station_stripe: 2,
  station_plate: 3,
} as const satisfies Partial<Record<DungeonGroundMaterial, number>>;

/**
 * Each material's own mean, **measured** from the generated sheet rather than
 * guessed from its ramp — see the same note in `floor1Materials.ts`. The
 * guessed values these replace were out by up to 26 levels a channel, all in
 * the direction of the ramp rather than of the art. Re-measure whenever a
 * painter or ramp changes.
 */
const GROUND_FALLBACK_COLOR = {
  safe_room_scuff: '#767169',
  safe_room_tile: '#d1c4a9',
  station_plate: '#939ca1',
  station_stripe: '#a09f8b',
} as const satisfies Partial<Record<DungeonGroundMaterial, string>>;

/**
 * A safe room is swept every day and has no loose material in it, so nothing
 * spills across a joint. The grit that would spill from `safe_room_scuff` is already
 * inside its own tile — scattering it onto the glazed tile beside it would read
 * as a dirty floor rather than as a worn threshold.
 */
const GROUND_SPILL = {
  safe_room_scuff: null,
  safe_room_tile: null,
  station_plate: null,
  station_stripe: null,
} as const satisfies Partial<Record<DungeonGroundMaterial, GroundSpill | null>>;

/**
 * Kerbs are a street feature: a raised lip holding a verge back off the paving.
 * Nothing indoors has one, so both sets are empty and the kerb pass is a no-op
 * for this palette.
 */
const KERBED_MATERIALS: ReadonlySet<string> = new Set<string>();
const KERB_SOFT_MATERIALS: ReadonlySet<string> = new Set<string>();

/**
 * The field station's decking is laid steel and its stripe is painted on, so
 * both meet everything at a straight tile edge: a mask-blended wedge of
 * stripe, or of the corridor's concrete, in a steel deck reads as a tear.
 */
const HARD_EDGE_MATERIALS: ReadonlySet<string> = new Set<DungeonGroundMaterial>([
  'station_plate',
  'station_stripe',
]);

/**
 * What a position with no dungeon ground counts as inside the fringe — the walls
 * around a safe room, and everything past them.
 *
 * The room's own material, so a wall reads as standing *on* the floor rather than
 * as a fourth surface the masks have to blend the other three into.
 */
const FRINGE_STAND_IN_MATERIAL: DungeonGroundMaterial = 'safe_room_tile';

/**
 * The material a tile type stands on, or undefined when it is not a safe-room
 * surface.
 *
 * `SAFE_ROOM_THRESHOLD` is the scuffed band inside each doorway;
 * `SAFE_ROOM_FLOOR` is everything else.
 *
 * `SAFE_ROOM_RUG` reports the material it is painted *over*, not one of its own.
 * Give a walkable ground decoration a material and whatever surrounds it wins all
 * four of its corners and the transition masks erase it — which is exactly what
 * happened when the town's scatter pass put `GRASSY_WEED` on the verge.
 *
 * Every furnishing, and the doctor's cabinet, is left out. A prop that is not ground is written with
 * `placeProp`, which records the floor it replaced, and `groundMaterialUnder`
 * answers from that record — so the ground under a table is whatever the room
 * laid there rather than something this switch has to guess at.
 */
function dungeonGroundMaterialForTileType(type: number): DungeonGroundMaterial | undefined {
  switch (type) {
    case SAFE_ROOM_FLOOR:
    case SAFE_ROOM_RUG:
      return 'safe_room_tile';
    case SAFE_ROOM_THRESHOLD:
      return 'safe_room_scuff';
    case LAB_STATION_FLOOR:
      return 'station_plate';
    case LAB_STATION_THRESHOLD:
      return 'station_stripe';
    default:
      return undefined;
  }
}

export const DUNGEON_GROUND: GroundPalette = {
  sheetKey: GROUND_SHEET_KEY,
  blendOrder: GROUND_BLEND_ORDER,
  fallbackColor: GROUND_FALLBACK_COLOR,
  spill: GROUND_SPILL,
  kerbedMaterials: KERBED_MATERIALS,
  kerbSoftMaterials: KERB_SOFT_MATERIALS,
  hardEdgeMaterials: HARD_EDGE_MATERIALS,
  fringeStandIn: FRINGE_STAND_IN_MATERIAL,
  materialForTileType: dungeonGroundMaterialForTileType,
};
