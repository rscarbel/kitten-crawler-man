/**
 * The dungeon's ground materials, and the rules for how they meet.
 *
 * One `GroundPalette` over the generated `ground_dungeon` sheet, covering the
 * safe room's floor — and only that. A Bopca station is the same waystation
 * wherever it is found, so it keeps one palette shared by both dungeon floors
 * while the floors themselves are drawn through `FLOOR1_GROUND` and
 * `FLOOR2_GROUND` (`src/map/dungeon/floorTheme.ts`).
 *
 * This module is deliberately free of canvas code — `src/map/tiles/groundTiles.ts`
 * does the drawing.
 */

import type { SpriteStates } from '../../core/SpriteLoader';
import type { GroundPalette, GroundSpill } from '../ground/GroundPalette';
import {
  SAFE_ROOM_COUNTER,
  SAFE_ROOM_COUNTER_BACK,
  SAFE_ROOM_FLOOR,
  SAFE_ROOM_GALLEY_FLOOR,
  SAFE_ROOM_RUG,
  SAFE_ROOM_STOVE,
  SAFE_ROOM_THRESHOLD,
} from '../tileTypes';

/** Sheet holding every dungeon ground material, one material per row. */
const GROUND_SHEET_KEY = 'ground_dungeon';

/** A material that is not a state of the dungeon sheet is a compile error. */
export type DungeonGroundMaterial = SpriteStates[typeof GROUND_SHEET_KEY];

/**
 * The three materials a Bopca station is laid in, softest first.
 *
 * `bopca_scuff` sits lowest so the harder tile bleeds over the traffic band
 * rather than the band eating into the room — a threshold is worn *through* the
 * floor, not laid on top of it. Only these three are ordered because only these
 * three are placed; a dungeon-wide rollout adds the rest here.
 */
const GROUND_BLEND_ORDER = {
  bopca_scuff: 0,
  bopca_hearth: 1,
  bopca_tile: 2,
} as const satisfies Partial<Record<DungeonGroundMaterial, number>>;

/**
 * Each material's own mean, **measured** from the generated sheet rather than
 * guessed from its ramp — see the same note in `floor1Materials.ts`. The
 * guessed values these replace were out by up to 26 levels a channel, all in
 * the direction of the ramp rather than of the art. Re-measure whenever a
 * painter or ramp changes.
 */
const GROUND_FALLBACK_COLOR = {
  bopca_scuff: '#767169',
  bopca_hearth: '#8f6651',
  bopca_tile: '#d1c4a9',
} as const satisfies Partial<Record<DungeonGroundMaterial, string>>;

/**
 * A safe room is swept every day and has no loose material in it, so nothing
 * spills across a joint. The grit that would spill from `bopca_scuff` is already
 * inside its own tile — scattering it onto the glazed tile beside it would read
 * as a dirty floor rather than as a worn threshold.
 */
const GROUND_SPILL = {
  bopca_scuff: null,
  bopca_hearth: null,
  bopca_tile: null,
} as const satisfies Partial<Record<DungeonGroundMaterial, GroundSpill | null>>;

/**
 * Kerbs are a street feature: a raised lip holding a verge back off the paving.
 * Nothing indoors has one, so both sets are empty and the kerb pass is a no-op
 * for this palette.
 */
const KERBED_MATERIALS: ReadonlySet<string> = new Set<string>();
const KERB_SOFT_MATERIALS: ReadonlySet<string> = new Set<string>();

/**
 * What a position with no dungeon ground counts as inside the fringe — the walls
 * around a safe room, and everything past them.
 *
 * The room's own material, so a wall reads as standing *on* the floor rather than
 * as a fourth surface the masks have to blend the other three into.
 */
const FRINGE_STAND_IN_MATERIAL: DungeonGroundMaterial = 'bopca_tile';

/**
 * The material a tile type stands on, or undefined when it is not a safe-room
 * surface.
 *
 * Both counter types report the hearth they are built on rather than nothing at
 * all: the counter run stands on the hearth paving, and a fringe corner with no
 * material is what tears a boundary (see `drawFringe`). The galley strip between
 * them reports the same, so the whole run is one surface.
 *
 * `SAFE_ROOM_THRESHOLD` is the scuffed band inside each doorway;
 * `SAFE_ROOM_FLOOR` is everything else.
 *
 * `SAFE_ROOM_RUG` reports the material it is painted *over*, not one of its own.
 * Give a walkable ground decoration a material and whatever surrounds it wins all
 * four of its corners and the transition masks erase it — which is exactly what
 * happened when the town's scatter pass put `GRASSY_WEED` on the verge. The stove
 * is the opposite case: it is a solid prop, and it reports the hearth paving
 * because the layout deliberately stands it against the counter run's own
 * surface.
 *
 * Every other furnishing is left out. A prop that is not ground is written with
 * `placeProp`, which records the floor it replaced, and `groundMaterialUnder`
 * answers from that record — so the ground under a table is whatever the room
 * laid there rather than something this switch has to guess at.
 */
function dungeonGroundMaterialForTileType(type: number): DungeonGroundMaterial | undefined {
  switch (type) {
    case SAFE_ROOM_FLOOR:
    case SAFE_ROOM_RUG:
      return 'bopca_tile';
    case SAFE_ROOM_GALLEY_FLOOR:
    case SAFE_ROOM_COUNTER:
    case SAFE_ROOM_COUNTER_BACK:
    case SAFE_ROOM_STOVE:
      return 'bopca_hearth';
    case SAFE_ROOM_THRESHOLD:
      return 'bopca_scuff';
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
  fringeStandIn: FRINGE_STAND_IN_MATERIAL,
  materialForTileType: dungeonGroundMaterialForTileType,
};
