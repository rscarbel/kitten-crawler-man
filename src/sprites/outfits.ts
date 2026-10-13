/**
 * Puts an outfit on a crawler's sprite: the one call equipment changes go
 * through to change how a crawler is painted.
 */

import { setCatOutfit } from './catSprite';
import { setHumanOutfit } from './humanSprite';
import type { GarmentDef, GarmentWearer } from './garments/garmentDef';
import { outfitOf, type Outfit } from './garments/outfit';

const DRESSERS: { readonly [W in GarmentWearer]: (outfit: Outfit<W>) => boolean } = {
  cat: setCatOutfit,
  human: setHumanOutfit,
};

/**
 * Dresses the sprite of the crawler of kind `wearer` in `garments` over their
 * base garments, releasing the previous outfit's cells when the look changes.
 * Returns whether it changed.
 */
export function setOutfit<W extends GarmentWearer>(
  wearer: W,
  garments: readonly GarmentDef<W>[],
): boolean {
  return DRESSERS[wearer](outfitOf(wearer, garments));
}
