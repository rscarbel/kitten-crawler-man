/**
 * Floor 1's ground materials — "the cellars" — and the rules for how they meet.
 *
 * One `GroundPalette` over the generated `ground_floor1` sheet; see
 * `src/map/ground/GroundPalette.ts` for what a palette is and
 * `src/map/ground/groundFrames.ts` for how a tile picks its frame. The palette a
 * dungeon tile is drawn through is chosen per floor by
 * `src/map/dungeon/floorTheme.ts`.
 *
 * The floor is hand-built and warm: rough limestone slabs over most of it,
 * sandstone flags cut square in the rooms that were finished properly, oak
 * boarding where one was boxed in, and coal ash trodden into the rest. Nothing here is cool-toned, because hue is what a player reads
 * before pattern at 32 px a tile and it is the one thing floor 2's palette must
 * not share.
 *
 * This module is deliberately free of canvas code — `src/map/tiles/groundTiles.ts`
 * does the drawing.
 */

import type { SpriteStates } from '../../core/SpriteLoader';
import type { GroundPalette, GroundSpill } from '../ground/GroundPalette';
import { FloorTypeValue } from '../tileTypes';

/** Sheet holding every floor 1 material, one material per row. */
const GROUND_SHEET_KEY = 'ground_floor1';

/** A material that is not a state of the sheet is a compile error. */
export type Floor1Material = SpriteStates[typeof GROUND_SHEET_KEY];

/**
 * Which material wins where two meet: the higher order bleeds over the lower
 * through the corner masks.
 *
 * Ordered by what physically sits on top of what. The cellar is a stone floor
 * that has been added to: ash settles into it and so sits lowest, the dressed
 * flags were laid over the rough ones, and boarding was laid over that.
 *
 * `f1_wall` is listed only because the `satisfies` check requires an order for
 * every material on the sheet. Nothing reads it: a wall is never a fringe
 * material, because `floor1MaterialForTileType` does not map `FloorTypeValue.wall` and the fringe
 * treats an occluder as the tile being drawn — see `materialAt` in
 * `src/map/tiles/groundTiles.ts`.
 */
const GROUND_BLEND_ORDER = {
  f1_cinder: 0,
  f1_flagstone: 1,
  f1_flags: 2,
  f1_timber: 3,
  f1_wall: 4,
} as const satisfies Record<Floor1Material, number>;

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
  f1_cinder: '#6c6258',
  f1_flagstone: '#7e7463',
  f1_flags: '#b9a175',
  f1_timber: '#87643e',
  f1_wall: '#322a21',
} as const satisfies Record<Floor1Material, string>;

/**
 * Ash is the one loose material down here, so it is the only one that spills.
 * Everything else is laid or nailed: a brick does not shed onto the boards
 * beside it, and giving the harder materials scatter as well would double an
 * effect the corner masks already provide from the other direction.
 */
const GROUND_SPILL = {
  f1_cinder: { kind: 'grit', color: '#8d8478' },
  f1_flagstone: null,
  f1_flags: null,
  f1_timber: null,
  f1_wall: null,
} as const satisfies Record<Floor1Material, GroundSpill | null>;

/**
 * Kerbs are a street feature — a raised lip holding a verge off the paving —
 * so both sets are empty and the kerb pass is a no-op indoors.
 */
const KERBED_MATERIALS: ReadonlySet<string> = new Set<string>();
const KERB_SOFT_MATERIALS: ReadonlySet<string> = new Set<string>();

/**
 * What a position with no floor-1 ground counts as inside the fringe.
 *
 * The floor's own bulk material, so a surface that runs up to something this
 * palette does not know — a safe room, a boss room, the void — meets it as more
 * of itself rather than as a fourth material the masks have to blend in.
 */
const FRINGE_STAND_IN_MATERIAL: Floor1Material = 'f1_flagstone';

/**
 * The material a tile type stands on, or undefined when it is not floor-1
 * ground.
 *
 * The four generic dungeon floor types are what `DungeonGenerator`'s
 * `ZONE_FLOORS` and `corridorFloorForZone` already assign per zone, so the
 * variety on the map is a decision the generator has been making all along —
 * this is only the first palette that draws all four as different surfaces.
 * Their names are vestigial: `carpet` and `wood` have never been carpet or wood,
 * they are the generator's "dark" and "fourth" floors.
 *
 * `FloorTypeValue.wall` is deliberately absent. Mapping it would make a wall a
 * fringe material, and the corner masks would then blend masonry into the floor
 * in front of it as though the two were the same kind of surface. Leaving it out
 * means `groundMaterialUnder` infers the floor beside it instead, which is what
 * a wall standing *on* a floor should report. The wall's own art is drawn by
 * `drawGroundMaterialTile` against `DungeonFloorTheme.wallMaterial`.
 */
function floor1MaterialForTileType(type: number): Floor1Material | undefined {
  switch (type) {
    case FloorTypeValue.concrete:
      return 'f1_flagstone';
    case FloorTypeValue.tile_floor:
      return 'f1_flags';
    case FloorTypeValue.carpet:
      return 'f1_cinder';
    case FloorTypeValue.wood:
      return 'f1_timber';
    default:
      return undefined;
  }
}

export const FLOOR1_GROUND: GroundPalette = {
  sheetKey: GROUND_SHEET_KEY,
  blendOrder: GROUND_BLEND_ORDER,
  fallbackColor: GROUND_FALLBACK_COLOR,
  spill: GROUND_SPILL,
  kerbedMaterials: KERBED_MATERIALS,
  kerbSoftMaterials: KERB_SOFT_MATERIALS,
  fringeStandIn: FRINGE_STAND_IN_MATERIAL,
  materialForTileType: floor1MaterialForTileType,
};

/** The masonry a floor-1 wall tile is drawn in. */
export const FLOOR1_WALL_MATERIAL: Floor1Material = 'f1_wall';
