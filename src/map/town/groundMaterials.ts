/**
 * The overworld's ground materials, and the rules for how they meet.
 *
 * A material is one row of the generated `ground_overworld` sheet (see
 * `scripts/generate-ground-tileset.ts`). Every row is torus-sampled, so any
 * frame of a material butts seamlessly against any other frame of the same
 * material — which is what lets a tile pick its frame from a hash instead of
 * from an adjacency table.
 *
 * Frames are packed **variant-major then row-major within a patch**: a material
 * generated as a 4x4 patch occupies 16 consecutive frames per variant, and a
 * tile has to draw the frame matching its position *inside* the patch or the
 * patch's own internal features tear. `groundFrameIndex` is the one place that
 * ordering is decoded; `TilePreviewScene` resolves frames through it too, so the
 * `?tiles` review route cannot drift from what the game draws.
 *
 * This module is deliberately free of canvas code — `src/map/tiles/groundTiles.ts`
 * does the drawing.
 */

import type { SpriteStateDef, SpriteStates } from '../../core/SpriteLoader';
import {
  DIRT_PATCH,
  FloorTypeValue,
  GRASSY_WEED,
  RUBBLE,
  RUINED_WALL,
  TREE,
  type TileContent,
} from '../tileTypes';

/** Sheet holding every overworld ground material, one material per row. */
export const GROUND_SHEET_KEY = 'ground_overworld';

/** Shared corner-transition masks, composited at draw time over any material pair. */
export const GROUND_MASK_SHEET_KEY = 'ground_masks';
export const GROUND_MASK_STATE = 'corner';

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
export const GROUND_BLEND_ORDER = {
  grass: 0,
  verge: 1,
  dirt: 2,
  gravel: 3,
  lane: 4,
  cobble: 5,
  plaza: 6,
} as const satisfies Record<GroundMaterial, number>;

/**
 * Colour drawn when the ground sheet has not loaded yet — each material's own
 * mean, sampled from the generated sheet. The first draft guessed, and guessed
 * the retired tileset's palette: mint where the lawn is olive, and up to 60
 * levels too bright.
 */
export const GROUND_FALLBACK_COLOR = {
  grass: '#667435',
  verge: '#6f773a',
  dirt: '#6b543b',
  gravel: '#575049',
  lane: '#826e52',
  cobble: '#746b61',
  plaza: '#8f8679',
} as const satisfies Record<GroundMaterial, string>;

/** How a material's loose material spills onto a harder neighbour. */
export interface GroundSpill {
  readonly kind: 'blades' | 'grit';
  readonly color: string;
}

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
export const GROUND_SPILL = {
  grass: { kind: 'blades', color: '#5e702e' },
  verge: { kind: 'blades', color: '#677332' },
  dirt: { kind: 'grit', color: '#7c5c3c' },
  gravel: { kind: 'grit', color: '#8a8377' },
  lane: null,
  cobble: null,
  plaza: null,
} as const satisfies Record<GroundMaterial, GroundSpill | null>;

/** Corner bits, matching `scripts/tilegen/masks.ts`. */
export const CORNER_NW = 1;
export const CORNER_NE = 2;
export const CORNER_SE = 4;
export const CORNER_SW = 8;

/** Decorrelated multipliers for the per-patch variant hash. */
const VARIANT_HASH_X = 73856093;
const VARIANT_HASH_Y = 19349663;
/** Avalanche constants — see `groundFrameIndex` for why they are not optional. */
const VARIANT_HASH_MIX = 2246822519;
const VARIANT_HASH_SHIFT_A = 15;
const VARIANT_HASH_SHIFT_B = 13;

export function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** How many independent variants a material's row holds. */
export function groundVariantCount(state: SpriteStateDef): number {
  const patchTiles = state.patchTiles ?? 1;
  return Math.max(1, Math.floor(state.frameCount / patchTiles ** 2));
}

/**
 * Resolves which frame of a material's row map tile (tx, ty) draws.
 *
 * The variant is hashed per *patch* rather than per tile so a whole patch keeps
 * one variant and its internal features stay continuous; the phase within the
 * patch comes from the tile's position, so neighbouring patches line up.
 *
 * The avalanche step is load-bearing, not hygiene. `variant` reads the *low*
 * bits of the mixed word, and without a finalising mix those bits of
 * `x*A ^ y*B` are a linear function of the patch coordinates: with an even
 * variant count the selection collapses into a Latin square. Measured before
 * the mix was added — a 4-variant material laid out `0123 / 3210 / 2301 / 1032`,
 * repeating exactly every 4 patches on both axes, which for 2x2-patch grass is a
 * literal 8-tile repeat; 2-variant materials came out a checkerboard.
 */
export function groundFrameIndex(
  patchTiles: number,
  variantCount: number,
  tx: number,
  ty: number,
): number {
  const patchX = Math.floor(tx / patchTiles);
  const patchY = Math.floor(ty / patchTiles);
  const mixed = Math.imul(patchX, VARIANT_HASH_X) ^ Math.imul(patchY, VARIANT_HASH_Y);
  const avalanched = Math.imul(mixed ^ (mixed >>> VARIANT_HASH_SHIFT_A), VARIANT_HASH_MIX);
  const hash = (avalanched ^ (avalanched >>> VARIANT_HASH_SHIFT_B)) >>> 0;
  const variant = hash % variantCount;
  const phase = positiveMod(ty, patchTiles) * patchTiles + positiveMod(tx, patchTiles);
  return variant * patchTiles * patchTiles + phase;
}

/**
 * The material a tile type stands on, or undefined when the tile is not
 * outdoor ground at all (dungeon floors, water, void, building interiors).
 *
 * Walkable ground decorations report the material they are painted over, not
 * the material they *depict*: a `DIRT_PATCH` is a worn patch drawn on top of a
 * lane, and calling it `dirt` here would let the surrounding lane bleed over it
 * through the corner masks until nothing of the patch was left.
 *
 * `TREE` is listed for the same reason `RUBBLE` and `RUINED_WALL` are — it only
 * ever stands outdoors, on grass — and because it is the one type that must not
 * be left to `groundMaterialUnder`'s inference: a tree in the middle of a forest
 * has nothing but trees for three rings around it.
 *
 * Anything else that *stands on* ground rather than being ground — a torch, a
 * well, a building anchor — is not listed, because outdoors and in a dungeon it
 * stands on different things. `groundMaterialUnder` infers those.
 *
 * Only `grass` and `dirt` are produced today. The other five materials arrive
 * with the street plan in Phase 3 of the town redesign; the renderer already
 * blends all seven.
 *
 * Roads render as `dirt` rather than the jointed `lane` sett pattern: laid
 * across every road tile in town (not just an edge or threshold), the setts'
 * joints and weed scatter read as a busy grid rather than a street. `dirt` is
 * the calm, jointless material built for exactly this — long stretches of
 * loose ground with nothing to tile against.
 */
export function groundMaterialForTileType(type: number): GroundMaterial | undefined {
  switch (type) {
    case FloorTypeValue.grass:
    case GRASSY_WEED:
    case RUBBLE:
    case RUINED_WALL:
    case TREE:
      return 'grass';
    case FloorTypeValue.road:
    case DIRT_PATCH:
      return 'dirt';
    default:
      return undefined;
  }
}

/** The material at a map position, or undefined off-map or on non-ground tiles. */
export function groundMaterialAt(
  structure: TileContent[][],
  tx: number,
  ty: number,
): GroundMaterial | undefined {
  if (ty < 0 || ty >= structure.length) return undefined;
  const row = structure[ty];
  if (tx < 0 || tx >= row.length) return undefined;
  return groundMaterialForTileType(row[tx].type);
}
