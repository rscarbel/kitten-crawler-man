/**
 * Frame resolution for the generated ground sheets, shared by every palette.
 *
 * A material is one row of a generated ground sheet (see
 * `scripts/generate-ground-tileset.ts`). Every row is torus-sampled, so any frame
 * of a material butts seamlessly against any other frame of the same material —
 * which is what lets a tile pick its frame from a hash instead of from an
 * adjacency table.
 *
 * Frames are packed **variant-major then row-major within a patch**: a material
 * generated as a 4x4 patch occupies 16 consecutive frames per variant, and a
 * tile has to draw the frame matching its position *inside* the patch or the
 * patch's own internal features tear. `groundFrameIndex` is the one place that
 * ordering is decoded; `TilePreviewScene` resolves frames through it too, so the
 * `?tiles` review route cannot drift from what the game draws.
 *
 * Nothing here knows which sheet it is answering for — that is the palette's job
 * (`GroundPalette`) — so both the overworld and the dungeon run the same code.
 */

import type { SpriteStateDef } from '../../core/SpriteLoader';
import { positiveMod } from '../../utils';

/** Shared corner-transition masks, composited at draw time over any material pair. */
export const GROUND_MASK_SHEET_KEY = 'ground_masks';
export const GROUND_MASK_STATE = 'corner';

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
