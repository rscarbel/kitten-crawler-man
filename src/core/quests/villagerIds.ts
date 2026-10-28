/**
 * Briar Hollow's named villagers, by id, and the soldiers and shopkeepers
 * among them. Plain data, apart from their scripts
 * (`src/dialog/scripts/briarHollow/`), so the village's save can be checked
 * without loading any dialog.
 */

export const VILLAGER_IDS = [
  'bramblewick',
  'merrit',
  'pipkin',
  'sella',
  'vetch',
  'oren',
  'tikka',
  'fenna',
  'garn',
  'sedge',
  'hobb',
  'marta',
  'pru',
  'nella',
  'cricket',
  'wicker',
  'midge',
] as const;

export type VillagerId = (typeof VILLAGER_IDS)[number];

export const SOLDIER_IDS = [
  'sedge',
  'hobb',
  'marta',
  'pru',
] as const satisfies readonly VillagerId[];

export type SoldierId = (typeof SOLDIER_IDS)[number];

export function isSoldierId(id: VillagerId): id is SoldierId {
  return SOLDIER_IDS.some((soldier) => soldier === id);
}

/**
 * The four who take coin over a counter. All four open their menu with a
 * `shopOpen` bark: the menu-opening line is the same kind of line for every
 * vendor.
 */
export const SHOPKEEPER_IDS = [
  'pipkin',
  'sella',
  'vetch',
  'oren',
] as const satisfies readonly VillagerId[];

export type ShopkeeperId = (typeof SHOPKEEPER_IDS)[number];
