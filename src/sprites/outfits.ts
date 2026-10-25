/**
 * Puts an outfit on a crawler's sprite: the one call equipment changes go
 * through to change how a crawler is painted.
 */

import { activeCatLook, setCatOutfit } from './catSprite';
import { activeHumanLook, setHumanOutfit } from './humanSprite';
import type { GarmentWearer, WornGarmentDef } from './garments/garmentDef';
import { outfitOf, type Outfit, type OutfitBase } from './garments/outfit';

const DRESSERS: { readonly [W in GarmentWearer]: (outfit: Outfit<W>) => boolean } = {
  cat: setCatOutfit,
  human: setHumanOutfit,
};

/** What the outfits of the crawler of each kind start from: the look its sprite is painted as. */
const BASES: { readonly [W in GarmentWearer]: () => OutfitBase<W> } = {
  cat: activeCatLook,
  human: activeHumanLook,
};

/**
 * Dresses the sprite of the crawler of kind `wearer` in `garments` over their
 * base garments, releasing the previous outfit's cells when the look changes.
 * Returns whether it changed.
 */
export function setOutfit<W extends GarmentWearer>(
  wearer: W,
  garments: readonly WornGarmentDef<W>[],
): boolean {
  return DRESSERS[wearer](outfitOf(BASES[wearer](), garments));
}
