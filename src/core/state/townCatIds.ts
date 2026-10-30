/**
 * The cats that live in Taloncrest's houses and shops, by their functional
 * ids: plain data, apart from how each is painted
 * (`src/sprites/looks/cats/townCatLooks.ts`), so a save that names them can be
 * checked without loading any art.
 */
export const TOWN_CAT_IDS = [
  'taloncrest_inn_cat',
  'taloncrest_old_lady_cottage_cat',
  'taloncrest_apothecary_cat',
  'taloncrest_flagon_tavern_cat',
  'taloncrest_mill_farm_cat',
  'taloncrest_smithy_cat',
  'taloncrest_general_store_cat',
] as const;

export type TownCatId = (typeof TOWN_CAT_IDS)[number];
