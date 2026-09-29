/**
 * Each named resident's own fixed figure — never randomly picked the way a
 * street citizen's is, so Wick always wears his ledger and Varga always
 * carries her tongs. Species comes from `ResidentDef` itself, never set
 * independently here, so a resident's figure and their dialog can never disagree about what they are.
 */

import { residentById, type ResidentId } from '../systems/townResidents';
import { townCastLook } from '../sprites/person/townCastLooks';
import { skyfowlLookById, type SkyfowlLookId } from '../sprites/art/skyfowl/cast';
import type { CitizenFigure } from './citizenFigure';

/** Every human resident's own look id, from `townCastLooks.ts`'s closed set. */
const HUMAN_RESIDENT_LOOK_ID: Readonly<Record<ResidentId, string | undefined>> = {
  wendell: 'resident_wendell',
  old_hilda: 'resident_old_hilda',
  brann_cartwright: undefined,
  marta_miller: 'resident_marta_miller',
  apothecary_fen: 'resident_apothecary_fen',
  deacon_aviel: undefined,
  smith_varga: undefined,
  innkeep_ossie: undefined,
  innkeep_brend: undefined,
  innkeep_marlow: 'resident_innkeep_marlow',
  sgt_kessler: undefined,
  corporal_pell: undefined,
  quartermaster_dann: undefined,
  tattooist_nim: undefined,
  stock_clerk_wick: 'resident_stock_clerk_wick',
  keeper_brenna_kestrel: undefined,
};

/** Every skyfowl resident's own look id, from `skyfowl/cast.ts`'s resident set. */
const SKYFOWL_RESIDENT_LOOK_ID: Readonly<Record<ResidentId, SkyfowlLookId | undefined>> = {
  wendell: undefined,
  old_hilda: undefined,
  brann_cartwright: 'resident_brann_cartwright',
  marta_miller: undefined,
  apothecary_fen: undefined,
  deacon_aviel: 'resident_deacon_aviel',
  smith_varga: 'resident_smith_varga',
  innkeep_ossie: 'resident_innkeep_ossie',
  innkeep_brend: 'resident_innkeep_brend',
  innkeep_marlow: undefined,
  sgt_kessler: 'resident_sgt_kessler',
  corporal_pell: 'resident_corporal_pell',
  quartermaster_dann: 'resident_quartermaster_dann',
  tattooist_nim: 'resident_tattooist_nim',
  stock_clerk_wick: undefined,
  keeper_brenna_kestrel: 'resident_keeper_brenna_kestrel',
};

/** The fixed figure a named resident always draws with. */
export function residentFigure(id: ResidentId): CitizenFigure {
  const def = residentById(id);
  if (def.species === 'skyfowl') {
    const lookId = SKYFOWL_RESIDENT_LOOK_ID[id];
    if (lookId === undefined) throw new Error(`no skyfowl figure authored for resident "${id}"`);
    return { species: 'skyfowl', look: skyfowlLookById(lookId) };
  }
  const lookId = HUMAN_RESIDENT_LOOK_ID[id];
  if (lookId === undefined) throw new Error(`no human figure authored for resident "${id}"`);
  return { species: 'human', look: townCastLook(lookId) };
}
