/**
 * Which of the town's buildings offer a service, who behind the counter
 * provides it, and what pressing interact on them does.
 *
 * This is its own module rather than a constant inside `BuildingInteriorScene`
 * because two places need it and they must not disagree: the scene, which opens
 * the surface, and `sfxGroups.ts`, which decides whether an interior needs the
 * commerce cue preloaded before the door opens. A building added to one list and
 * not the other is a shop whose purchase chime never arrives.
 *
 * Keyed by `entry.name`, exactly as `BUILDING_OCCUPANTS` is — and a building is
 * only reachable here if its occupant roster actually stations that role.
 */

import type { TownRole } from '../sprites/person/PersonAppearance';

/**
 * Which surface a building's service opens onto. Most are a priced menu; Old
 * Hilda reads instead of selling, and a reading is the fortune panel's shape
 * rather than a shop's.
 */
export type ServiceSurface = 'menu' | 'reading';

export interface InteriorService {
  readonly role: TownRole;
  readonly surface: ServiceSurface;
  /** Interact-prompt verb once this NPC has no story left to tell. */
  readonly verb: string;
}

const INTERIOR_SERVICES: ReadonlyMap<string, InteriorService> = new Map([
  ['The Sunken Stump Pub', { role: 'innkeeper', surface: 'menu', verb: 'Order' }],
  ['The Horned Flagon', { role: 'innkeeper', surface: 'menu', verb: 'Order' }],
  ['The Sleeping Cat Inn', { role: 'innkeeper', surface: 'menu', verb: 'Order' }],
  ['Temple of the Sky', { role: 'priest', surface: 'menu', verb: 'Pray' }],
  ["Signet's Ink", { role: 'merchant', surface: 'menu', verb: 'Get inked' }],
  ['Herb & Remedy', { role: 'merchant', surface: 'menu', verb: 'Buy' }],
  ['The Rusty Anvil', { role: 'smith', surface: 'menu', verb: 'Sharpen' }],
  ["Cartwright's Workshop", { role: 'laborer', surface: 'menu', verb: 'Buy' }],
  ["Miller's Farm", { role: 'farmer', surface: 'menu', verb: 'Eat' }],
  ["Shepherd's Cabin", { role: 'farmer', surface: 'menu', verb: 'Rest' }],
  ["Old Hilda's Cottage", { role: 'priest', surface: 'reading', verb: 'Reading' }],
] satisfies ReadonlyArray<[string, InteriorService]>);

/**
 * Every building this registry names, so a headless check can walk the registry
 * itself rather than only asking each building what it offers. A service keyed
 * to a misspelled building is invisible from that direction — the building
 * simply reports no service, and the gate goes green having measured nothing.
 */
export function interiorServiceBuildings(): ReadonlyArray<string> {
  return [...INTERIOR_SERVICES.keys()];
}

/** The service this building offers, or `undefined` when it offers none. */
export function interiorServiceFor(building: string): InteriorService | undefined {
  return INTERIOR_SERVICES.get(building);
}

/** Whether this building takes coin over a counter, and so needs the purchase cue. */
export function interiorSellsSomething(building: string): boolean {
  return INTERIOR_SERVICES.get(building)?.surface === 'menu';
}
