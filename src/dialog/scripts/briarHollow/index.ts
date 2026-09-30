/**
 * Briar Hollow's named villagers, by id: the seventeen residents' scripts,
 * and the ids the role-typed registries in `src/dialog/villagerRegistry.ts`
 * are keyed by. Adding a villager means adding their id here, which the
 * compiler then requires a `VILLAGER_SCRIPTS` entry (and, for a soldier or a
 * vendor, the matching registry) for.
 */

import { BRAMBLEWICK } from './bramblewick';
import { CRICKET } from './cricket';
import { FENNA } from './fenna';
import { GARN } from './garn';
import { HOBB } from './hobb';
import { MARTA } from './marta';
import { MERRIT, MERRIT_BLUEPRINTS_REPLIES } from './merrit';
import { MIDGE } from './midge';
import { NELLA } from './nella';
import { OREN } from './oren';
import { PIPKIN } from './pipkin';
import { PRU } from './pru';
import { SEDGE } from './sedge';
import { SELLA } from './sella';
import { TIKKA } from './tikka';
import { VETCH } from './vetch';
import { WICKER } from './wicker';

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

export const SOLDIER_IDS = ['sedge', 'hobb', 'marta', 'pru'] as const;

export type SoldierId = (typeof SOLDIER_IDS)[number];

export function isSoldierId(id: VillagerId): id is SoldierId {
  return SOLDIER_IDS.some((soldier) => soldier === id);
}

/**
 * The four who take coin over a counter. All four open their menu with a
 * `shopOpen` bark: the menu-opening line is the same kind of line for every
 * vendor.
 */
export const SHOPKEEPER_IDS = ['pipkin', 'sella', 'vetch', 'oren'] as const;

export type ShopkeeperId = (typeof SHOPKEEPER_IDS)[number];

export {
  BRAMBLEWICK,
  CRICKET,
  FENNA,
  GARN,
  HOBB,
  MARTA,
  MERRIT,
  MERRIT_BLUEPRINTS_REPLIES,
  MIDGE,
  NELLA,
  OREN,
  PIPKIN,
  PRU,
  SEDGE,
  SELLA,
  TIKKA,
  VETCH,
  WICKER,
};
