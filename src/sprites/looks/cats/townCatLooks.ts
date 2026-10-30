/** How each of Taloncrest's house and shop cats is painted, under her own id. */

import type { CatLook } from '../catLook';
import type { TownCatId } from '../../../core/state/townCatIds';
import { TALONCREST_APOTHECARY_CAT_LOOK } from './taloncrestApothecaryCat';
import { TALONCREST_FLAGON_TAVERN_CAT_LOOK } from './taloncrestFlagonTavernCat';
import { TALONCREST_GENERAL_STORE_CAT_LOOK } from './taloncrestGeneralStoreCat';
import { TALONCREST_INN_CAT_LOOK } from './taloncrestInnCat';
import { TALONCREST_MILL_FARM_CAT_LOOK } from './taloncrestMillFarmCat';
import { TALONCREST_OLD_LADY_COTTAGE_CAT_LOOK } from './taloncrestOldLadyCottageCat';
import { TALONCREST_SMITHY_CAT_LOOK } from './taloncrestSmithyCat';

/** Each town cat's look under her own id, which the look's `id` repeats. */
export const TOWN_CAT_LOOKS = {
  taloncrest_inn_cat: TALONCREST_INN_CAT_LOOK,
  taloncrest_old_lady_cottage_cat: TALONCREST_OLD_LADY_COTTAGE_CAT_LOOK,
  taloncrest_apothecary_cat: TALONCREST_APOTHECARY_CAT_LOOK,
  taloncrest_flagon_tavern_cat: TALONCREST_FLAGON_TAVERN_CAT_LOOK,
  taloncrest_mill_farm_cat: TALONCREST_MILL_FARM_CAT_LOOK,
  taloncrest_smithy_cat: TALONCREST_SMITHY_CAT_LOOK,
  taloncrest_general_store_cat: TALONCREST_GENERAL_STORE_CAT_LOOK,
} as const satisfies { readonly [Id in TownCatId]: CatLook & { readonly id: Id } };
