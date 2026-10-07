/**
 * Who pays out a construction contract, by name.
 *
 * Read from the contact's own record (a Skyfowl Town resident's def, a Briar
 * Hollow villager's speaker) rather than written into the catalogue, so a
 * renamed resident or villager is renamed in every contract line too.
 */

import { SPEAKERS } from '../../dialog/speakers';
import { residentById } from '../townResidents';
import type { ContractSiteDef } from './contractCatalog';

/** The name a site's contact goes by in Wendell's lines, the Journal and the toasts. */
export function contractContactName(site: ContractSiteDef): string {
  return site.town === 'skyfowl' ? residentById(site.contact).name : SPEAKERS[site.contact].name;
}
