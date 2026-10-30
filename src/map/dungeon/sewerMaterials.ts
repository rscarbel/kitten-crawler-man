/**
 * The storm drain's ground materials and the rules for how they meet.
 *
 * One `GroundPalette` over three rows of the `ground_interior` sheet: the drain
 * is entered from the town, whose building interiors already have that sheet
 * resident, so it needs no sheet of its own. The palette a dungeon tile is drawn
 * through is chosen by `src/map/dungeon/floorTheme.ts`; this is the `'sewer'`
 * theme's.
 *
 * A wet stone walkway carries the bulk of the floor, the channels it runs beside
 * are bedded in worn brick, and the brick lining is what the dungeon wall
 * painter's faces are laid in.
 *
 * This module is deliberately free of canvas code — `src/map/tiles/groundTiles.ts`
 * does the drawing.
 */

import type { GroundPalette, GroundSpill } from '../ground/GroundPalette';
import { INTERIOR_GROUND_FALLBACK_COLOR, type InteriorMaterial } from '../town/interiorMaterials';
import { FloorTypeValue } from '../tileTypes';

/** Sheet holding the drain's materials alongside the town interiors'. */
const GROUND_SHEET_KEY = 'ground_interior';

/** The drain's rows of the interior sheet; a name that is not one is a compile error. */
export type SewerMaterial = Extract<InteriorMaterial, `sewer_${string}`>;

/**
 * Which material wins where two meet. The walkway is a built ledge standing
 * over the channel, so its edge is drawn over the bed rather than the silt
 * creeping up onto it.
 *
 * `sewer_brick` is listed only because the `satisfies` check requires an order
 * for every material this palette owns; a wall is never a fringe material — see
 * `floor2Materials.ts` for why.
 */
const GROUND_BLEND_ORDER = {
  sewer_channel: 0,
  sewer_walkway: 1,
  sewer_brick: 2,
} as const satisfies Record<SewerMaterial, number>;

/** The sheet's own measured means, held once in the interior palette that owns the sheet. */
const GROUND_FALLBACK_COLOR = {
  sewer_brick: INTERIOR_GROUND_FALLBACK_COLOR.sewer_brick,
  sewer_walkway: INTERIOR_GROUND_FALLBACK_COLOR.sewer_walkway,
  sewer_channel: INTERIOR_GROUND_FALLBACK_COLOR.sewer_channel,
} as const satisfies Record<SewerMaterial, string>;

/**
 * Nothing down here is dry enough to shed: silt stays where the flow left it
 * and the walkway is too wet to throw grit.
 */
const GROUND_SPILL = {
  sewer_brick: null,
  sewer_walkway: null,
  sewer_channel: null,
} as const satisfies Record<SewerMaterial, GroundSpill | null>;

/**
 * A channel is a cut with a built edge: where the walkway meets the bed the
 * joint runs along the tile edge, because a corner-mask fringe would read as
 * the walkway's stone slumping into the channel.
 */
const HARD_EDGE_MATERIALS: ReadonlySet<string> = new Set<SewerMaterial>(['sewer_channel']);

/** Kerbs are a street feature, so both sets are empty and the kerb pass is a no-op. */
const KERBED_MATERIALS: ReadonlySet<string> = new Set<string>();
const KERB_SOFT_MATERIALS: ReadonlySet<string> = new Set<string>();

/** What a position with no drain ground counts as inside the fringe: the bulk walkway. */
const FRINGE_STAND_IN_MATERIAL: SewerMaterial = 'sewer_walkway';

/**
 * The material a tile type stands on, or undefined when it is not drain ground.
 *
 * `wood` and `carpet` are not part of the drain's layout; they fall back to the
 * walkway and the bed so a stray one still draws as the drain rather than as
 * nothing. `FloorTypeValue.wall` is deliberately absent; see
 * `floor1MaterialForTileType` for why, and `DungeonFloorTheme.wallMaterial` for
 * what draws it instead.
 */
function sewerMaterialForTileType(type: number): SewerMaterial | undefined {
  switch (type) {
    case FloorTypeValue.concrete:
    case FloorTypeValue.wood:
      return 'sewer_walkway';
    case FloorTypeValue.tile_floor:
    case FloorTypeValue.carpet:
      return 'sewer_channel';
    default:
      return undefined;
  }
}

export const SEWER_GROUND: GroundPalette = {
  sheetKey: GROUND_SHEET_KEY,
  blendOrder: GROUND_BLEND_ORDER,
  fallbackColor: GROUND_FALLBACK_COLOR,
  spill: GROUND_SPILL,
  kerbedMaterials: KERBED_MATERIALS,
  kerbSoftMaterials: KERB_SOFT_MATERIALS,
  hardEdgeMaterials: HARD_EDGE_MATERIALS,
  fringeStandIn: FRINGE_STAND_IN_MATERIAL,
  materialForTileType: sewerMaterialForTileType,
};

/** The brick a sewer wall tile is drawn in. */
export const SEWER_WALL_MATERIAL: SewerMaterial = 'sewer_brick';
