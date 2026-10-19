/**
 * Pictures for the things a shop sells that are not items: a meal, a night's
 * rest, a drill, a blessing, a tattoo, a trip. Painted in the item icons'
 * style so an offer row reads the same whether it sells a thing or a service.
 */

import { CARE_SERVICE_ICONS } from './serviceCareIcons';
import { FOOD_SERVICE_ICONS } from './serviceFoodIcons';
import type { ServiceIconPainter } from './serviceIconKit';
import { PLACE_SERVICE_ICONS } from './servicePlaceIcons';
import { TATTOO_SERVICE_ICONS } from './serviceTattooIcons';
import { TRAINING_SERVICE_ICONS } from './serviceTrainingIcons';

export type { ServiceIconPainter } from './serviceIconKit';

export const SERVICE_ICON_IDS = [
  'antidote',
  'edge',
  'edge_pair',
  'blessing',
  'drill_strength',
  'drill_constitution',
  'drill_dexterity',
  'drill_intelligence',
  'tattoo_coiled_fist',
  'tattoo_iron_ribs',
  'tattoo_third_eye',
  'tattoo_quick_serpent',
  'tattoo_brass_gullet',
  'hot_plate',
  'hayloft',
  'ale',
  'boozy_milk',
  'mead',
  'guild_reserve',
  'honey_bread',
  'stew',
  'nightcap',
  'room_attic',
  'room_hearth',
  'room_cats_own',
  'treatment',
  'travel_town',
  'travel_circus',
  'travel_briar_hollow',
  'vip_recovery',
  'vip_cocktail',
  'vip_escort',
] as const;

export type ServiceIconId = (typeof SERVICE_ICON_IDS)[number];

/** Every service's painter. A `Record`, so an id added above without a painter fails to compile. */
export const SERVICE_ICONS: Readonly<Record<ServiceIconId, ServiceIconPainter>> = {
  ...CARE_SERVICE_ICONS,
  ...TRAINING_SERVICE_ICONS,
  ...TATTOO_SERVICE_ICONS,
  ...FOOD_SERVICE_ICONS,
  ...PLACE_SERVICE_ICONS,
};
