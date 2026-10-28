/**
 * The human crawler's looks: one per body and complexion the player can
 * choose, keyed by the template id the pair names.
 */

import type { HumanLook } from '../sprites/looks/humanLook';
import type { HumanCrawlerLookId } from './crawlerChoices';
import { FEMALE_DARK_LOOK } from '../sprites/looks/humans/femaleDark';
import { FEMALE_LIGHT_LOOK } from '../sprites/looks/humans/femaleLight';
import { MALE_DARK_LOOK } from '../sprites/looks/humans/maleDark';
import { MALE_LIGHT_LOOK } from '../sprites/looks/humans/maleLight';

/** A look whose id is the template id it is filed under. */
type HumanCrawlerLookTable = {
  readonly [Id in HumanCrawlerLookId]: HumanLook & { readonly id: Id };
};

export const HUMAN_CRAWLER_LOOKS = {
  male_light: MALE_LIGHT_LOOK,
  male_dark: MALE_DARK_LOOK,
  female_light: FEMALE_LIGHT_LOOK,
  female_dark: FEMALE_DARK_LOOK,
} as const satisfies HumanCrawlerLookTable;

const MALE_CLOTHES =
  'He wears a light-blue chambray button-up with the sleeves rolled, over a white V-neck; a ' +
  'black belt with a silver buckle; charcoal slim chinos; black knit sneakers with white soles; ' +
  'and a silver smartwatch on his left wrist.';

const FEMALE_CLOTHES =
  'She wears a fitted, cropped wine-red twill jacket closed at the waist by a slim cognac belt, ' +
  'open at the neck over an ivory crew-neck top; a small teal silk scarf knotted at the throat; ' +
  'stone high-waisted tapered trousers; flat chocolate-brown leather ankle boots; and a slim ' +
  'gold watch on her left wrist.';

/**
 * How each look appears, in words, for the AI's session context. The prompts
 * shared by every player never describe the human crawler, so this is the only
 * place the AI learns what the player's chosen crawler looks like.
 */
export const HUMAN_CRAWLER_APPEARANCE = {
  male_light:
    'About six feet tall, slim and lean, with short medium-brown hair swept up and back, a ' +
    `short full ginger-brown beard and light blue-grey eyes. ${MALE_CLOTHES}`,
  male_dark:
    'About six feet tall, slim and lean, with deep brown skin, black hair in a short, ' +
    `tight-curl cut, a short black beard and dark brown eyes. ${MALE_CLOTHES}`,
  female_light:
    'About five foot six, with fair skin, chestnut-brown hair pulled back into a low ponytail ' +
    `and blue-grey eyes. ${FEMALE_CLOTHES}`,
  female_dark:
    'About five foot six, with deep brown skin, black hair worn close to the head and drawn ' +
    `back into a single low braid, and dark brown eyes. ${FEMALE_CLOTHES}`,
} as const satisfies Record<HumanCrawlerLookId, string>;
