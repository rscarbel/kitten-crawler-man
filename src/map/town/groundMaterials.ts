/**
 * The overworld's ground materials, and the rules for how they meet.
 *
 * One `GroundPalette` over the generated `ground_overworld` sheet — see
 * `src/map/ground/GroundPalette.ts` for what a palette is and
 * `src/map/ground/groundFrames.ts` for how a tile picks its frame.
 *
 * This module is deliberately free of canvas code — `src/map/tiles/groundTiles.ts`
 * does the drawing.
 */

import type { SpriteStates } from '../../core/SpriteLoader';
import type { GroundPalette, GroundSpill } from '../ground/GroundPalette';
import {
  COBBLE_STREET,
  DIRT_PATCH,
  FloorTypeValue,
  GARDEN_PLANTING,
  GRASSY_WEED,
  LANE_STREET,
  PLAZA_STONE,
  VERGE_GRASS,
  YARD_GRAVEL,
  HIGHLAND_GRASS,
  SCREE,
  WILDFLOWER_TUFT,
  RIVER_ROCK,
} from '../tileTypes';

/** Sheet holding every overworld ground material, one material per row. */
const GROUND_SHEET_KEY = 'ground_overworld';

/**
 * A ground material is exactly a state of the ground sheet, so a material that
 * is not in the manifest is a compile error rather than a blank tile.
 */
export type GroundMaterial = SpriteStates[typeof GROUND_SHEET_KEY];

/**
 * Which material wins where two meet: the higher order bleeds over the lower
 * through the corner masks, so paving encroaches on grass rather than grass
 * creeping over paving. Grass takes its edge back through the scatter pass
 * (`GROUND_SPILL`) instead, which reads as tufts in the gutter rather than as
 * lawn overrunning a street.
 *
 * Also the sheet's row order, which is not a coincidence — the generator lays
 * materials out softest-first.
 */
const GROUND_BLEND_ORDER = {
  // Water is the softest thing on the map, so every kind of land bleeds over it
  // through the corner masks — and that soft, irregular, diagonal-capable edge
  // *is* the riverbank. Nothing else draws one.
  water: 0,
  grass: 1,
  // The two upland bands sit between the field and the town's made surfaces:
  // turf creeps up into the highland and the highland's own rock creeps down
  // over the turf, which is what a hillside does. They never meet the town's
  // materials — the elevation field is flattened inside the safe radius — so
  // their order relative to `verge` and above is unobservable.
  highland: 2,
  scree: 3,
  verge: 4,
  dirt: 5,
  gravel: 6,
  lane: 7,
  cobble: 8,
  plaza: 9,
} as const satisfies Record<GroundMaterial, number>;

/**
 * Colour drawn when the ground sheet has not loaded yet — each material's own
 * mean, sampled from the generated sheet. The first draft guessed, and guessed
 * the retired tileset's palette: mint where the lawn is olive, and up to 60
 * levels too bright.
 */
export const GROUND_FALLBACK_COLOR = {
  water: '#1e434b',
  highland: '#7f7b49',
  scree: '#5b5854',
  grass: '#667435',
  verge: '#6f773a',
  dirt: '#6b543b',
  gravel: '#575049',
  lane: '#826e52',
  cobble: '#746b61',
  plaza: '#8f8679',
} as const satisfies Record<GroundMaterial, string>;

/**
 * What a material scatters onto the paving beside it. Only softer materials
 * spill: a harder neighbour already reaches across the boundary through the
 * corner masks, so giving it scatter as well would double the effect.
 *
 * Colours come from the generated sheet: the two blade colours sit just under
 * their material's mean, so a blade reads as a blade without looking like a
 * different plant, and the two grits sit near the top of their material's range,
 * because loose chip catches the light. The first draft carried the *old*
 * tileset's palette over and put hue-131° tufts on hue-73° grass, which read as
 * teal dashes.
 */
const GROUND_SPILL = {
  // Water spills nothing. A river has no loose material to throw onto the bank,
  // and the foam where it meets land is `WaterAnimationSystem`'s to draw, in
  // motion, rather than something baked into the static fringe.
  water: null,
  highland: { kind: 'blades', color: '#6f6c3e' },
  scree: { kind: 'grit', color: '#8a877f' },
  grass: { kind: 'blades', color: '#5e702e' },
  verge: { kind: 'blades', color: '#677332' },
  dirt: { kind: 'grit', color: '#7c5c3c' },
  gravel: { kind: 'grit', color: '#8a8377' },
  lane: null,
  cobble: null,
  plaza: null,
} as const satisfies Record<GroundMaterial, GroundSpill | null>;

/**
 * The materials a kerb belongs to, and the ones it is laid against.
 *
 * Every made street gets a lip where it meets **planted** ground, and nowhere
 * else. The three exclusions are each a case the first cut got wrong and a
 * screenshot caught:
 *
 * - `dirt` is `FloorTypeValue.road` — the town's alleys, which the `TownPlan`
 *   calls the lowest rung of the street hierarchy and `TileGrid` counts as paving, plus
 *   every track outside the walls. Kerbing against it drew a closed pale
 *   rectangle around Blackwood Lodge's three-tile doorstep, an island of setts in
 *   packed earth, and put a lip on every gate apron out in open country.
 * - `gravel` is the workyards and the gate aprons, which are made surfaces too;
 *   19 edges of the town's paving met one.
 * - `grass` is the field outside the walls, which no street is kerbed against
 *   because the roads out there are `dirt`.
 *
 * That leaves `verge`, which is what a street verge is: the soft strip a kerb
 * exists to hold back.
 */
const KERBED_MATERIALS: ReadonlySet<GroundMaterial> = new Set<GroundMaterial>([
  'lane',
  'cobble',
  'plaza',
]);
const KERB_SOFT_MATERIALS: ReadonlySet<GroundMaterial> = new Set<GroundMaterial>(['verge']);

/**
 * What a position with no outdoor ground counts as inside the fringe.
 *
 * It exists because the fringe needs *a* material at every corner — see
 * `drawFringe` — not because grass is the right answer there. It is reached for
 * any position whose floor is not an outdoor material: an indoor or dungeon
 * floor, or off-map — but an interior abutting outdoor ground would put grass
 * along that seam, and would want a material of its own rather than a better
 * stand-in. The Desperado Club is exactly that case: `GameMap.generateInterior`
 * floors it in `CLUB_FLOOR`, which this palette does not know, so every
 * outdoor tile beside it falls back to grass here.
 */
const FRINGE_STAND_IN_MATERIAL: GroundMaterial = 'grass';

/**
 * The material a tile type stands on, or undefined when the tile is not
 * outdoor ground at all (dungeon floors, water, void, building interiors).
 *
 * Walkable ground decorations report the material they are painted over, not
 * the material they *depict*. A `DIRT_PATCH` is a worn patch of the packed-earth
 * track it is scattered on, so it reports `dirt` — the track's own material — and
 * blends into it invisibly. Give a decoration a material of its own and whatever
 * surrounds it wins all four of its corners and the masks erase it: which is what
 * happened when the scatter pass put `GRASSY_WEED`, whose material is `grass`,
 * onto the town's verge.
 *
 * `BRIDGE` is not listed for the same reason, and it is the case that shows why
 * the rule matters: a deck spans the channel *and* lands a tile on each bank, so
 * naming any one material here would be wrong for half of every bridge. Written
 * with `TileGrid.setBridgeDeck`, each deck tile records what it was laid over —
 * water mid-channel, the road or the turf at the abutments — so the planks are
 * drawn over the right thing and the water beside them still fringes against
 * water. **Not** `setStanding`: that records with `??=`, and a water tile
 * already carries the record the carve left on it, so a deck written that way
 * keeps the pre-river surface. That is exactly what the first cut did.
 *
 * `RUBBLE` and `RUINED_WALL` are **not** listed either, for exactly the reason
 * `TREE` is not. They were pinned to `grass` while grass was the only surface
 * outside the walls; the elevation bands made that false, and a ruin shell on a
 * hillside would have drawn a rectangle of lowland turf inside the upland it
 * stands on. Both are now written with `setStanding`, so each records the band
 * it replaced and `groundMaterialUnder` reads it back before inference.
 *
 * `TREE` is deliberately **not** listed, though it used to be. A tree stands on
 * ground rather than being ground, and a few of them stand on a track rather
 * than on grass — pinning them all to `grass` here drew turf under those and
 * then popped the tile to dirt the moment the tree was felled. It was pinned
 * because `groundMaterialUnder`'s *inference* cannot help a tree in the middle
 * of a blob that has nothing but trees for three rings around it; that is no
 * longer the fallback, because `paintForests` now uses `setStanding` and every
 * tree records the surface it replaced, which `groundMaterialUnder` consults
 * before it ever reaches inference.
 *
 * Anything else that *stands on* ground rather than being ground — a torch, a
 * well, a building anchor — is not listed, because outdoors and in a dungeon it
 * stands on different things. `groundMaterialUnder` infers those.
 *
 * `FloorTypeValue.road` is the generic packed-earth surface — alleys inside the
 * walls and every track outside them — and renders as `dirt`, not as the jointed
 * `lane` setts. Laid across a long approach road the setts' joints read as a busy
 * grid rather than a street; `dirt` is the calm, jointless material built for
 * exactly that. The town's paved streets carry their own tile types instead, so
 * a lane, a main street and the plaza are different surfaces on the map rather
 * than one surface the renderer guesses at.
 */
function groundMaterialForTileType(type: number): GroundMaterial | undefined {
  switch (type) {
    case FloorTypeValue.grass:
    case GRASSY_WEED:
    // A wildflower clump is a patch *of* the meadow it grows in, scattered only
    // over field grass, so it reports grass and disappears into it — the same
    // rule `GRASSY_WEED` and `DIRT_PATCH` follow. `PEBBLE_SCATTER` cannot join
    // them and is deliberately absent: it is scattered over both highland turf
    // and scree, so no single answer here is right for it, and it falls through
    // to the surface `setStanding` recorded under it instead.
    case WILDFLOWER_TUFT:
      return 'grass';
    case HIGHLAND_GRASS:
      return 'highland';
    case SCREE:
      return 'scree';
    // A rock in the channel *replaces* a water tile, so unlike a bridge — which
    // spans the water at one end and lands on the bank at the other — there is
    // exactly one right answer for it, and naming it here is simpler than a
    // second unconditional-recording setter. It cannot rely on its record:
    // `setStanding` writes with `??=` and the carve has already recorded the
    // grass or turf the river drowned, so without this case every rock drew a
    // ring of meadow around itself in the middle of the river.
    case FloorTypeValue.water:
    case RIVER_ROCK:
      return 'water';
    case VERGE_GRASS:
    case GARDEN_PLANTING:
      return 'verge';
    case FloorTypeValue.road:
    case DIRT_PATCH:
      return 'dirt';
    case YARD_GRAVEL:
      return 'gravel';
    case LANE_STREET:
      return 'lane';
    case COBBLE_STREET:
      return 'cobble';
    case PLAZA_STONE:
      return 'plaza';
    default:
      return undefined;
  }
}

export const OVERWORLD_GROUND: GroundPalette = {
  sheetKey: GROUND_SHEET_KEY,
  blendOrder: GROUND_BLEND_ORDER,
  fallbackColor: GROUND_FALLBACK_COLOR,
  spill: GROUND_SPILL,
  kerbedMaterials: KERBED_MATERIALS,
  kerbSoftMaterials: KERB_SOFT_MATERIALS,
  fringeStandIn: FRINGE_STAND_IN_MATERIAL,
  materialForTileType: groundMaterialForTileType,
};
