/**
 * Drinks carried out of a bar in a bottle: each mends a share of health and
 * lays on an intoxication. Shared rather than owned by a scene because a
 * crawler can drink one in the dungeon or indoors, and a house special that
 * pours differently depending on the room is a bug nobody would look for.
 */

import type { ItemId } from '../defs/ItemDefs';
import type { Intoxication } from '../../combat/StatusEffect';

export interface IntoxicatingDrink {
  readonly intoxication: Intoxication;
  /** Share of max HP the drink gives back. */
  readonly healFraction: number;
}

/**
 * Half what a health potion gives back: a treat with a drawback attached, not
 * a medicine — matching the pub's Boozy Milk, which is the same trade at a bar
 * you cannot carry home.
 */
const BOTTLED_ROUND_HEAL_FRACTION = 0.25;

export const INTOXICATING_DRINKS: Partial<Record<ItemId, IntoxicatingDrink>> = {
  catnip_tuna_water: { intoxication: 'catnip_buzz', healFraction: BOTTLED_ROUND_HEAL_FRACTION },
};
