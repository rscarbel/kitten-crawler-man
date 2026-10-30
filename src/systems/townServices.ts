/**
 * What an interior occupant offers when talked to, and which buildings take
 * coin over a counter.
 *
 * A service belongs to the person who provides it: it is declared on their
 * `OccupantSpec` in `BUILDING_OCCUPANTS`, and the talk router asks the
 * occupant system which service the person the player walked up to keeps.
 * Two people of the same role in one room can therefore both run a counter.
 *
 * The building-level questions live here rather than in `BuildingInteriorScene`
 * because two places must not disagree about them: the scene, which builds the
 * surfaces, and the preload that decides whether an interior needs the
 * commerce cue decoded before the door opens.
 */

import { BUILDING_OCCUPANTS } from './buildingOccupants';
import type { BuildingId } from '../map/buildingIds';
import type { BuildingEntry } from '../map/buildingEntry';

/**
 * Which priced menu a counter opens. Each one is its own menu builder and
 * purchase handler in `BuildingInteriorScene.openServiceMenu`, which switches
 * on this exhaustively.
 */
export type ServiceCounter =
  | 'tavern'
  | 'inn'
  | 'temple_blessing'
  | 'tattoo_parlour'
  | 'armoury'
  | 'drill_yard'
  | 'apothecary'
  | 'smithy'
  | 'crafting_house'
  | 'mill_kitchen'
  | 'hayloft';

/**
 * A desk with a screen of its own rather than a priced menu: the system behind
 * it is built by the scene for any room whose roster keeps one.
 */
export type ServiceDesk = 'mercenary_guild';

/**
 * What talking to an occupant opens once their story is told. Most keep a
 * priced counter; Old Lori reads instead of selling, and a reading is the
 * fortune panel's shape rather than a shop's. A desk opens its own screen.
 */
export type OccupantService =
  | {
      readonly surface: 'menu';
      readonly counter: ServiceCounter;
      /** Interact-prompt verb once this NPC has no story left to tell. */
      readonly verb: string;
    }
  | { readonly surface: 'reading'; readonly verb: string }
  | { readonly surface: 'desk'; readonly desk: ServiceDesk; readonly verb: string };

/** Every service this building's roster offers, in roster order. Empty when it offers none. */
export function interiorServicesFor(building: BuildingId): ReadonlyArray<OccupantService> {
  return (BUILDING_OCCUPANTS.get(building) ?? []).flatMap((spec) =>
    spec.service === undefined ? [] : [spec.service],
  );
}

/** Whether this building takes coin over any counter or desk, and so needs the purchase cue. */
export function interiorSellsSomething(building: BuildingId): boolean {
  return interiorServicesFor(building).some((service) => service.surface !== 'reading');
}

/** Whether coin changes hands over a counter behind this door: every club and store, and a house whose occupants sell. */
export function buildingEntrySellsSomething(entry: BuildingEntry): boolean {
  return (
    entry.type === 'club' ||
    entry.type === 'store' ||
    (entry.type === 'house' && interiorSellsSomething(entry.id))
  );
}

/** Whether one of this building's occupants keeps `desk`. */
export function interiorKeepsDesk(building: BuildingId, desk: ServiceDesk): boolean {
  const desks = interiorServicesFor(building).flatMap((service) =>
    service.surface === 'desk' ? [service.desk] : [],
  );
  return desks.includes(desk);
}
