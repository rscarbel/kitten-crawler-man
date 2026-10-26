/**
 * Dresses a cat's anatomy in an outfit: the `CatDressing` her painters call at
 * every piece, painting each garment of the outfit that covers that part.
 */

import { playerCharacter } from '../../../characters/characters';
import type { CatDressing } from '../../art/catParts';
import type { CatLook } from '../../looks/catLook';
import type { GarmentFrameContext } from '../garmentDef';
import { outfitOf, paintOutfitPart, type Outfit } from '../outfit';

/** `look`'s base garments and nothing else: how she is painted with nothing on. */
export function bareCatOutfit(look: CatLook): Outfit<'cat'> {
  return outfitOf(look, []);
}

/** The player's cat with nothing on. */
export const BARE_CAT_OUTFIT: Outfit<'cat'> = bareCatOutfit(playerCharacter('cat').look);

/** The dressing that paints `outfit` onto one cell, described by `context`. */
export function dressCat(outfit: Outfit<'cat'>, context: GarmentFrameContext<'cat'>): CatDressing {
  return {
    part: (ctx, part, frame) => paintOutfitPart(ctx, outfit, part, frame, context),
  };
}
