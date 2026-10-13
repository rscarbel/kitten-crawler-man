/**
 * Every garment, by wearer and id. Complete by type: an id with no garment,
 * or a garment filed under another garment's id, does not load.
 */

import { CAT_BUTTERFLY_TALISMAN } from './cat/catButterflyTalisman';
import { CAT_COAT } from './cat/catCoat';
import { CAT_CROWN } from './cat/catCrown';
import { CAT_DEX_BRACELET } from './cat/catDexBracelet';
import { CAT_KETTLE_HELM } from './cat/catKettleHelm';
import { CAT_SCALE_CRUPPER } from './cat/catScaleCrupper';
import { CAT_SHADES } from './cat/catShades';
import type { GarmentDef, GarmentWearer } from './garmentDef';
import type { CatGarmentId, GarmentIdFor, HumanGarmentId } from './garmentIds';
import { CARL_BOOTS } from './human/carlBoots';
import { CARL_BOXERS } from './human/carlBoxers';
import { CARL_BRACERS } from './human/carlBracers';
import { CARL_CROWN } from './human/carlCrown';
import { CARL_GAMBESON } from './human/carlGambeson';
import { CARL_KETTLE_HELM } from './human/carlKettleHelm';
import { CARL_KNEEPADS } from './human/carlKneepads';
import { CARL_CLOAK } from './human/carlCloak';
import { CARL_GAUNTLET } from './human/carlGauntlet';
import { CARL_JACKET } from './human/carlJacket';
import { CARL_PEDICURE } from './human/carlPedicure';
import { CARL_TOE_RING } from './human/carlToeRing';
import { CARL_TROLLSKIN_SHIRT } from './human/carlTrollskinShirt';

export const CAT_GARMENTS: Readonly<Record<CatGarmentId, GarmentDef<'cat'>>> = {
  cat_coat: CAT_COAT,
  cat_shades: CAT_SHADES,
  cat_crown: CAT_CROWN,
  cat_kettle_helm: CAT_KETTLE_HELM,
  cat_butterfly_talisman: CAT_BUTTERFLY_TALISMAN,
  cat_scale_crupper: CAT_SCALE_CRUPPER,
  cat_dex_bracelet: CAT_DEX_BRACELET,
};

export const HUMAN_GARMENTS: Readonly<Record<HumanGarmentId, GarmentDef<'human'>>> = {
  carl_jacket: CARL_JACKET,
  carl_boxers: CARL_BOXERS,
  carl_trollskin_shirt: CARL_TROLLSKIN_SHIRT,
  carl_gauntlet: CARL_GAUNTLET,
  carl_cloak: CARL_CLOAK,
  carl_toe_ring: CARL_TOE_RING,
  carl_pedicure: CARL_PEDICURE,
  carl_crown: CARL_CROWN,
  carl_kettle_helm: CARL_KETTLE_HELM,
  carl_gambeson: CARL_GAMBESON,
  carl_kneepads: CARL_KNEEPADS,
  carl_bracers: CARL_BRACERS,
  carl_boots: CARL_BOOTS,
};

const GARMENTS: {
  readonly [W in GarmentWearer]: Readonly<Record<GarmentIdFor<W>, GarmentDef<W>>>;
} = {
  cat: CAT_GARMENTS,
  human: HUMAN_GARMENTS,
};

for (const [key, garment] of [...Object.entries(CAT_GARMENTS), ...Object.entries(HUMAN_GARMENTS)]) {
  if (garment.id !== key) {
    throw new Error(`Garment "${garment.name}" (${garment.id}) is filed under "${key}"`);
  }
}

/** The garment `id` of a crawler of kind `wearer`. */
export function garmentOf<W extends GarmentWearer>(wearer: W, id: GarmentIdFor<W>): GarmentDef<W> {
  return GARMENTS[wearer][id];
}

/** Every garment a crawler of kind `wearer` can be painted in. */
export function garmentsOf<W extends GarmentWearer>(wearer: W): readonly GarmentDef<W>[] {
  return Object.values<GarmentDef<W>>(GARMENTS[wearer]);
}

/** The garments every outfit of a crawler of kind `wearer` starts from. */
export function baseGarmentsOf<W extends GarmentWearer>(wearer: W): readonly GarmentDef<W>[] {
  return garmentsOf(wearer).filter((garment) => garment.base);
}
