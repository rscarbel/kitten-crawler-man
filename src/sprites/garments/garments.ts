/**
 * Every garment, by wearer and id. Complete by type: an id with no garment,
 * or a garment filed under another garment's id, does not load.
 */

import { CAT_BIGBOI_BOXERS } from './cat/catBigBoiBoxers';
import { CAT_BOOTS } from './cat/catBoots';
import { CAT_BRACERS } from './cat/catBracers';
import { CAT_BUTTERFLY_TALISMAN } from './cat/catButterflyTalisman';
import { CAT_COAT } from './cat/catCoat';
import { CAT_CROWN } from './cat/catCrown';
import { CAT_DEX_BRACELET } from './cat/catDexBracelet';
import { CAT_GAMBESON } from './cat/catGambeson';
import { CAT_KETTLE_HELM } from './cat/catKettleHelm';
import { CAT_SCALE_CRUPPER } from './cat/catScaleCrupper';
import { CAT_SHADES } from './cat/catShades';
import { CAT_TROLLSKIN_SHIRT } from './cat/catTrollskinShirt';
import type { BaseGarmentDef, GarmentDef, GarmentWearer, WornGarmentDef } from './garmentDef';
import type {
  CatBaseGarmentId,
  CatWornGarmentId,
  GarmentIdFor,
  HumanBaseGarmentId,
  HumanWornGarmentId,
  WornGarmentIdFor,
} from './garmentIds';
import { HUMAN_BOOTS } from './human/humanBoots';
import { HUMAN_BRACERS } from './human/humanBracers';
import { HUMAN_CROWN } from './human/humanCrown';
import { HUMAN_GAMBESON } from './human/humanGambeson';
import { HUMAN_KETTLE_HELM } from './human/humanKettleHelm';
import { HUMAN_KNEEPADS } from './human/humanKneepads';
import { HUMAN_CLOAK } from './human/humanCloak';
import { HUMAN_GAUNTLET } from './human/humanGauntlet';
import { DAVE_JACKET } from './human/daveJacket';
import { DAVE_TROUSERS } from './human/daveTrousers';
import { RYAN_BELT, RYAN_CHINOS } from './human/ryanChinos';
import { RYAN_SHIRT } from './human/ryanShirt';
import { RYAN_SNEAKERS } from './human/ryanSneakers';
import { RYAN_WATCH } from './human/ryanWatch';
import { HUMAN_PEDICURE } from './human/humanPedicure';
import { HUMAN_TOE_RING } from './human/humanToeRing';
import { HUMAN_TROLLSKIN_SHIRT } from './human/humanTrollskinShirt';
import { TOWNSFOLK_SHOES, TOWNSFOLK_TROUSERS } from './human/townsfolkLegwear';

const CAT_BASE_GARMENTS: Readonly<Record<CatBaseGarmentId, BaseGarmentDef<'cat'>>> = {
  cat_coat: CAT_COAT,
};

const CAT_WORN_GARMENTS: Readonly<Record<CatWornGarmentId, WornGarmentDef<'cat'>>> = {
  cat_shades: CAT_SHADES,
  cat_crown: CAT_CROWN,
  cat_kettle_helm: CAT_KETTLE_HELM,
  cat_butterfly_talisman: CAT_BUTTERFLY_TALISMAN,
  cat_scale_crupper: CAT_SCALE_CRUPPER,
  cat_dex_bracelet: CAT_DEX_BRACELET,
  cat_trollskin_shirt: CAT_TROLLSKIN_SHIRT,
  cat_gambeson: CAT_GAMBESON,
  cat_bracers: CAT_BRACERS,
  cat_boots: CAT_BOOTS,
  cat_bigboi_boxers: CAT_BIGBOI_BOXERS,
};

const HUMAN_BASE_GARMENTS: Readonly<Record<HumanBaseGarmentId, BaseGarmentDef<'human'>>> = {
  dave_jacket: DAVE_JACKET,
  dave_trousers: DAVE_TROUSERS,
  ryan_shirt: RYAN_SHIRT,
  ryan_belt: RYAN_BELT,
  ryan_chinos: RYAN_CHINOS,
  ryan_sneakers: RYAN_SNEAKERS,
  ryan_watch: RYAN_WATCH,
};

const HUMAN_WORN_GARMENTS: Readonly<Record<HumanWornGarmentId, WornGarmentDef<'human'>>> = {
  human_trollskin_shirt: HUMAN_TROLLSKIN_SHIRT,
  human_gauntlet: HUMAN_GAUNTLET,
  human_cloak: HUMAN_CLOAK,
  human_toe_ring: HUMAN_TOE_RING,
  human_pedicure: HUMAN_PEDICURE,
  human_crown: HUMAN_CROWN,
  human_kettle_helm: HUMAN_KETTLE_HELM,
  human_gambeson: HUMAN_GAMBESON,
  human_kneepads: HUMAN_KNEEPADS,
  human_bracers: HUMAN_BRACERS,
  human_boots: HUMAN_BOOTS,
  townsfolk_trousers: TOWNSFOLK_TROUSERS,
  townsfolk_shoes: TOWNSFOLK_SHOES,
};

const WORN_GARMENTS: {
  readonly [W in GarmentWearer]: Readonly<Record<WornGarmentIdFor<W>, WornGarmentDef<W>>>;
} = {
  cat: CAT_WORN_GARMENTS,
  human: HUMAN_WORN_GARMENTS,
};

const GARMENTS: {
  readonly [W in GarmentWearer]: Readonly<Record<GarmentIdFor<W>, GarmentDef<W>>>;
} = {
  cat: { ...CAT_BASE_GARMENTS, ...CAT_WORN_GARMENTS },
  human: { ...HUMAN_BASE_GARMENTS, ...HUMAN_WORN_GARMENTS },
};

for (const [key, garment] of [...Object.entries(GARMENTS.cat), ...Object.entries(GARMENTS.human)]) {
  if (garment.id !== key) {
    throw new Error(`Garment "${garment.name}" (${garment.id}) is filed under "${key}"`);
  }
}

/** The garment `id` a crawler of kind `wearer` puts on over their base. */
export function wornGarmentOf<W extends GarmentWearer>(
  wearer: W,
  id: WornGarmentIdFor<W>,
): WornGarmentDef<W> {
  return WORN_GARMENTS[wearer][id];
}

/** Every garment a crawler of kind `wearer` can put on over their base. */
export function wornGarmentsOf<W extends GarmentWearer>(wearer: W): readonly WornGarmentDef<W>[] {
  return Object.values<WornGarmentDef<W>>(WORN_GARMENTS[wearer]);
}

/** Every garment a crawler of kind `wearer` can be painted in. */
export function garmentsOf<W extends GarmentWearer>(wearer: W): readonly GarmentDef<W>[] {
  return Object.values<GarmentDef<W>>(GARMENTS[wearer]);
}
