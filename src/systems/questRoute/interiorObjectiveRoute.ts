/**
 * Which way a pinned objective sends a party standing inside a building: up
 * or down its stairs, out of its street door, to a tile of the storey they
 * stand on, or nowhere. Pure, so a gate can follow it storey by storey
 * without a scene.
 */

import type { BuildingId } from '../../map/buildingIds';
import type { TrackerTarget } from '../questTracker';

/** Where a party stands indoors, as the way to an objective is read from it. */
export interface InteriorStanding {
  readonly building: BuildingId;
  /** The storey shown, counted from the building's lowest. */
  readonly storey: number;
  readonly isTower: boolean;
  /** Whether this storey has a door out to the street. */
  readonly hasStreetDoor: boolean;
}

export type InteriorObjectiveRoute =
  | { readonly kind: 'none' }
  | { readonly kind: 'stairs'; readonly direction: 'up' | 'down' }
  | { readonly kind: 'street_door' }
  | { readonly kind: 'here'; readonly tile: { readonly x: number; readonly y: number } };

const NO_ROUTE: InteriorObjectiveRoute = { kind: 'none' };

/**
 * The way `target` sends a party standing at `here`. A target inside this
 * building leads up or down to its storey and then to its tile, unless the
 * storey marks that place itself. A target
 * elsewhere leads out: by this storey's street door when it has one, down a
 * tower's stairs toward one otherwise.
 */
export function interiorObjectiveRoute(
  target: TrackerTarget | undefined,
  here: InteriorStanding,
): InteriorObjectiveRoute {
  if (target === undefined) return NO_ROUTE;
  const indoors = target.indoors;
  if (indoors?.building === here.building) {
    if (indoors.storey > here.storey) return { kind: 'stairs', direction: 'up' };
    if (indoors.storey < here.storey) return { kind: 'stairs', direction: 'down' };
    return indoors.lead === 'own_mark' ? NO_ROUTE : { kind: 'here', tile: indoors.tile };
  }
  if (target.building === here.building) return NO_ROUTE;
  if (here.hasStreetDoor || !here.isTower || here.storey <= 0) return { kind: 'street_door' };
  return { kind: 'stairs', direction: 'down' };
}
