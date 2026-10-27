/**
 * Each named resident's own fixed figure — never randomly picked the way a
 * street citizen's is, so Wick always wears his ledger and Varga always
 * carries her tongs. A cast look must come from the resident's own species'
 * cast, checked against their `ResidentDef` at compile time, so a resident's
 * figure and their dialog can never disagree about what they are; a species
 * with no cast can only be given a bespoke painter.
 */

import type { ResidentId, ResidentSpeciesOf } from '../systems/townResidents';
import type { CrowdSpecies, TownSpecies } from '../systems/townSpecies';
import { townCastLook } from '../sprites/person/townCastLooks';
import { hawkfolkLookById, type HawkfolkLookId } from '../sprites/art/hawkfolk/cast';
import type { CitizenFigure } from './citizenFigure';
import type { BespokeResidentFigureId } from './bespokeResidentFigures';
import type { TownspersonBody } from './townspersonBody';

interface CastLookIdBySpecies {
  /** An id from `townCastLooks.ts`'s closed set. */
  readonly human: string;
  /** An id from `hawkfolk/cast.ts`'s resident set. */
  readonly hawkfolk: HawkfolkLookId;
}

/** A look from one crowd species' cast. */
export type ResidentCastLook = {
  readonly [Species in CrowdSpecies]: {
    readonly kind: 'cast';
    readonly species: Species;
    readonly look: CastLookIdBySpecies[Species];
  };
}[CrowdSpecies];

interface ResidentBespokeLook {
  readonly kind: 'bespoke';
  readonly figure: BespokeResidentFigureId;
}

export type ResidentLook = ResidentCastLook | ResidentBespokeLook;

/** What a resident of `Species` may wear: their own species' cast look, or a bespoke painter. */
type ResidentLookFor<Species extends TownSpecies> =
  ResidentBespokeLook | Extract<ResidentCastLook, { readonly species: Species }>;

const RESIDENT_LOOKS = {
  wendell: { kind: 'cast', species: 'human', look: 'resident_wendell' },
  old_lori: { kind: 'bespoke', figure: 'old_lori' },
  steve_cartwright: { kind: 'bespoke', figure: 'steve_cartwright' },
  marta_miller: { kind: 'cast', species: 'human', look: 'resident_marta_miller' },
  apothecary_fen: { kind: 'cast', species: 'human', look: 'resident_apothecary_fen' },
  deacon_aviel: { kind: 'cast', species: 'hawkfolk', look: 'resident_deacon_aviel' },
  smith_varga: { kind: 'cast', species: 'hawkfolk', look: 'resident_smith_varga' },
  innkeep_ossie: { kind: 'cast', species: 'hawkfolk', look: 'resident_innkeep_ossie' },
  innkeep_brend: { kind: 'cast', species: 'hawkfolk', look: 'resident_innkeep_brend' },
  innkeep_marlow: { kind: 'cast', species: 'human', look: 'resident_innkeep_marlow' },
  sgt_kessler: { kind: 'cast', species: 'hawkfolk', look: 'resident_sgt_kessler' },
  corporal_pell: { kind: 'cast', species: 'hawkfolk', look: 'resident_corporal_pell' },
  quartermaster_dann: { kind: 'cast', species: 'hawkfolk', look: 'resident_quartermaster_dann' },
  tattooist_nim: { kind: 'cast', species: 'hawkfolk', look: 'resident_tattooist_nim' },
  stock_clerk_wick: { kind: 'cast', species: 'human', look: 'resident_stock_clerk_wick' },
  keeper_brenna_kestrel: {
    kind: 'cast',
    species: 'hawkfolk',
    look: 'resident_keeper_brenna_kestrel',
  },
  janitor_puddles: { kind: 'bespoke', figure: 'janitor' },
  janitor_grout: { kind: 'bespoke', figure: 'janitor' },
  sydney: { kind: 'bespoke', figure: 'sydney' },
  brandon: { kind: 'bespoke', figure: 'brandon' },
} as const satisfies { readonly [Id in ResidentId]: ResidentLookFor<ResidentSpeciesOf<Id>> };

/** What a named resident is always drawn as. */
export function residentLook(id: ResidentId): ResidentLook {
  return RESIDENT_LOOKS[id];
}

/** The citizen figure a cast look draws. */
export function castLookFigure(look: ResidentCastLook): CitizenFigure {
  switch (look.species) {
    case 'human':
      return { species: 'human', look: townCastLook(look.look) };
    case 'hawkfolk':
      return { species: 'hawkfolk', look: hawkfolkLookById(look.look) };
    default: {
      const unhandled: never = look;
      throw new Error(`unhandled resident cast look ${JSON.stringify(unhandled)}`);
    }
  }
}

/** The body a named resident's townsperson wears. */
export function residentBody(id: ResidentId): TownspersonBody {
  const look = residentLook(id);
  switch (look.kind) {
    case 'cast':
      return { kind: 'citizen', figure: castLookFigure(look) };
    case 'bespoke':
      return { kind: 'bespoke', id: look.figure };
    default: {
      const unhandled: never = look;
      throw new Error(`unhandled resident look ${JSON.stringify(unhandled)}`);
    }
  }
}
