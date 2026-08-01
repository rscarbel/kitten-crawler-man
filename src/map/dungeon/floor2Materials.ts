/**
 * Floor 2's ground materials — "the service level" — and the rules for how they
 * meet.
 *
 * One `GroundPalette` over the generated `ground_floor2` sheet, the sibling of
 * `src/map/dungeon/floor1Materials.ts`; the palette a dungeon tile is drawn
 * through is chosen per floor by `src/map/dungeon/floorTheme.ts`.
 *
 * Where floor 1 is hand-laid and warm, this is poured, pressed and bolted: a
 * concrete slab under most of it, terrazzo and vinyl where it was fitted out,
 * checker plate over the service runs, and painted blockwork holding it up. Every
 * material is cool-toned and machine-exact, which is what tells a player who has
 * just come down the stairs that they are not on floor 1 any more — and all four
 * are building materials, so the floor still reads as indoors.
 *
 * This module is deliberately free of canvas code — `src/map/tiles/groundTiles.ts`
 * does the drawing.
 */

import type { SpriteStates } from '../../core/SpriteLoader';
import type { GroundPalette, GroundSpill } from '../ground/GroundPalette';
import { FloorTypeValue } from '../tileTypes';

/** Sheet holding every floor 2 material, one material per row. */
const GROUND_SHEET_KEY = 'ground_floor2';

/** A material that is not a state of the sheet is a compile error. */
export type Floor2Material = SpriteStates[typeof GROUND_SHEET_KEY];

/**
 * Which material wins where two meet: the higher order bleeds over the lower
 * through the corner masks.
 *
 * Ordered by what was installed on top of what. The slab was poured first, the
 * vinyl and terrazzo were laid on it during fit-out, and the checker plate was
 * bolted down last.
 *
 * `f2_wall` is listed only because the `satisfies` check requires an order for
 * every material on the sheet. Nothing reads it: a wall is never a fringe
 * material, because `floor2MaterialForTileType` does not map
 * `FloorTypeValue.wall` and the fringe treats an occluder as the tile being
 * drawn — see `materialAt` in `src/map/tiles/groundTiles.ts`.
 */
const GROUND_BLEND_ORDER = {
  f2_concrete: 0,
  f2_vinyl: 1,
  f2_terrazzo: 2,
  f2_plate: 3,
  f2_wall: 4,
} as const satisfies Record<Floor2Material, number>;

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
  f2_concrete: '#848a91',
  f2_vinyl: '#526456',
  f2_terrazzo: '#b1b3b0',
  f2_plate: '#666f7b',
  f2_wall: '#313835',
} as const satisfies Record<Floor2Material, string>;

/**
 * A bare slab sheds dust onto whatever was laid beside it, and nothing else on
 * this floor sheds anything: terrazzo, vinyl and steel are all sealed surfaces.
 * Giving them scatter would read as neglect on a level whose whole point is that
 * it was built to a specification.
 */
const GROUND_SPILL = {
  f2_concrete: { kind: 'grit', color: '#a2a8b0' },
  f2_vinyl: null,
  f2_terrazzo: null,
  f2_plate: null,
  f2_wall: null,
} as const satisfies Record<Floor2Material, GroundSpill | null>;

/**
 * Kerbs are a street feature — a raised lip holding a verge off the paving —
 * so both sets are empty and the kerb pass is a no-op indoors.
 */
const KERBED_MATERIALS: ReadonlySet<string> = new Set<string>();
const KERB_SOFT_MATERIALS: ReadonlySet<string> = new Set<string>();

/**
 * What a position with no floor-2 ground counts as inside the fringe — the
 * floor's own bulk material, for the same reason floor 1 stands in with its
 * flagstone.
 */
const FRINGE_STAND_IN_MATERIAL: Floor2Material = 'f2_concrete';

/**
 * The material a tile type stands on, or undefined when it is not floor-2
 * ground.
 *
 * Deliberately the same four tile types floor 1 maps, assigned to the same
 * roles: the generator's bulk floor, its lighter floor, its dark floor and its
 * fourth. A floor's identity is entirely in which materials those roles are
 * filled with, so a new floor is a sheet and a palette and nothing else — the
 * generator does not need to know that floor 2 exists.
 *
 * `FloorTypeValue.wall` is deliberately absent; see `floor1MaterialForTileType`
 * for why, and `DungeonFloorTheme.wallMaterial` for what draws it instead.
 */
function floor2MaterialForTileType(type: number): Floor2Material | undefined {
  switch (type) {
    case FloorTypeValue.concrete:
      return 'f2_concrete';
    case FloorTypeValue.tile_floor:
      return 'f2_terrazzo';
    case FloorTypeValue.carpet:
      return 'f2_plate';
    case FloorTypeValue.wood:
      return 'f2_vinyl';
    default:
      return undefined;
  }
}

export const FLOOR2_GROUND: GroundPalette = {
  sheetKey: GROUND_SHEET_KEY,
  blendOrder: GROUND_BLEND_ORDER,
  fallbackColor: GROUND_FALLBACK_COLOR,
  spill: GROUND_SPILL,
  kerbedMaterials: KERBED_MATERIALS,
  kerbSoftMaterials: KERB_SOFT_MATERIALS,
  fringeStandIn: FRINGE_STAND_IN_MATERIAL,
  materialForTileType: floor2MaterialForTileType,
};

/** The blockwork a floor-2 wall tile is drawn in. */
export const FLOOR2_WALL_MATERIAL: Floor2Material = 'f2_wall';
