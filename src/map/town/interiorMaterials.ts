/**
 * The materials a town building is finished in, seen from inside.
 *
 * One `GroundPalette` over the generated `ground_interior` sheet — see
 * `src/map/ground/GroundPalette.ts` for what a palette is.
 *
 * It exists because a shop, a house and the tower used to be floored and walled
 * in the *dungeon's* generic tile types, so they wore whichever cellar's art was
 * loaded at the time; see the note above `INTERIOR_BOARD_FLOOR` in
 * `src/map/tileTypes.ts`. The restaurant, the Desperado Club and the Big Top
 * already had floor types of their own and are drawn elsewhere.
 *
 * This module is deliberately free of canvas code — `src/map/tiles/groundTiles.ts`
 * does the drawing.
 */

import type { SpriteStates } from '../../core/SpriteLoader';
import type { GroundPalette, GroundSpill } from '../ground/GroundPalette';
import { INTERIOR_BOARD_FLOOR, INTERIOR_STONE_FLOOR } from '../tileTypes';

/** Sheet holding every town-interior material, one material per row. */
const GROUND_SHEET_KEY = 'ground_interior';

/** A material that is not a state of the sheet is a compile error. */
export type InteriorMaterial = SpriteStates[typeof GROUND_SHEET_KEY];

/**
 * Which material wins where two meet.
 *
 * Nothing here ever actually meets anything: a building interior is floored end
 * to end in one material, and the two solids are drawn without a fringe at all.
 * The order exists because the renderer asks every material for one.
 */
const GROUND_BLEND_ORDER = {
  interior_boards: 0,
  interior_stone: 1,
  interior_plaster: 2,
  interior_counter: 3,
} as const satisfies Record<InteriorMaterial, number>;

/**
 * Each material's own mean, **measured** from the generated sheet rather than
 * guessed from its ramp.
 *
 * Guessing put both dungeon walls at roughly twice their true brightness, so for
 * the frame before the sheet loads a wall painted at about floor brightness —
 * which is the exact failure `CELLAR_WALL_RAMP` and `CINDERBLOCK_RAMP` exist to
 * prevent. Re-measure these whenever a material's painter or ramp changes.
 */
const GROUND_FALLBACK_COLOR = {
  interior_boards: '#9a7448',
  interior_stone: '#97979b',
  interior_plaster: '#b8ab95',
  interior_counter: '#5b3c24',
} as const satisfies Record<InteriorMaterial, string>;

/** A finished room is swept, and none of its surfaces is loose. */
const GROUND_SPILL = {
  interior_boards: null,
  interior_stone: null,
  interior_plaster: null,
  interior_counter: null,
} as const satisfies Record<InteriorMaterial, GroundSpill | null>;

/** Kerbs are a street feature; both sets are empty indoors. */
const KERBED_MATERIALS: ReadonlySet<string> = new Set<string>();
const KERB_SOFT_MATERIALS: ReadonlySet<string> = new Set<string>();

/**
 * What a position with no interior ground counts as inside the fringe — the
 * boards, since every interior this palette draws except the tower is boarded
 * and a stand-in is only ever reached off the edge of the room.
 */
const FRINGE_STAND_IN_MATERIAL: InteriorMaterial = 'interior_boards';

/**
 * The material a tile type stands on, or undefined when it is not an interior
 * surface.
 *
 * `INTERIOR_WALL` and `INTERIOR_COUNTER` are deliberately absent, for the same
 * reason a dungeon wall is absent from its floor's palette: mapping a solid
 * makes it a *fringe* material, and the corner masks would then blend plaster
 * into the boards in front of it as though the two were the same kind of
 * surface. Both are drawn base-only through `drawGroundMaterialTile` against
 * `INTERIOR_WALL_MATERIAL` and `INTERIOR_COUNTER_MATERIAL`.
 */
function interiorMaterialForTileType(type: number): InteriorMaterial | undefined {
  switch (type) {
    case INTERIOR_BOARD_FLOOR:
      return 'interior_boards';
    case INTERIOR_STONE_FLOOR:
      return 'interior_stone';
    default:
      return undefined;
  }
}

export const TOWN_INTERIOR_GROUND: GroundPalette = {
  sheetKey: GROUND_SHEET_KEY,
  blendOrder: GROUND_BLEND_ORDER,
  fallbackColor: GROUND_FALLBACK_COLOR,
  spill: GROUND_SPILL,
  kerbedMaterials: KERBED_MATERIALS,
  kerbSoftMaterials: KERB_SOFT_MATERIALS,
  fringeStandIn: FRINGE_STAND_IN_MATERIAL,
  materialForTileType: interiorMaterialForTileType,
};

/** The plaster an `INTERIOR_WALL` tile is drawn in. */
export const INTERIOR_WALL_MATERIAL: InteriorMaterial = 'interior_plaster';

/** The joinery an `INTERIOR_COUNTER` tile is drawn in. */
export const INTERIOR_COUNTER_MATERIAL: InteriorMaterial = 'interior_counter';
