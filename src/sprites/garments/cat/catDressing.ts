/**
 * Dresses Donut's anatomy in an outfit: the `CatDressing` her painters call at
 * every piece, painting each garment of the outfit that covers that part.
 */

import type { CatDressing } from '../../art/catParts';
import type { GarmentFrameContext } from '../garmentDef';
import { outfitOf, paintOutfitPart, type Outfit } from '../outfit';

/** Her coat and nothing else: how she is painted with nothing on. */
export const BARE_CAT_OUTFIT: Outfit<'cat'> = outfitOf('cat', []);

/** The dressing that paints `outfit` onto one cell, described by `context`. */
export function dressCat(outfit: Outfit<'cat'>, context: GarmentFrameContext<'cat'>): CatDressing {
  return {
    part: (ctx, part, frame) => paintOutfitPart(ctx, outfit, part, frame, context),
    hides: (feature) => outfit.hidden.has(feature),
  };
}
