/**
 * The people who live in the Over City's buildings — named individuals layered
 * on top of the role system in `townDialog.ts` rather than replacing it.
 *
 * A role tells you what someone does for a living; a resident tells you who they
 * are. Street citizens and unnamed occupants keep the role path untouched, but
 * the anchor occupant of a named building — the innkeeper behind that bar, the
 * witch in that cottage — speaks as themselves. `ResidentDef` here is identity
 * only (who they are, what they look like, which building is theirs); their
 * words — ambient chatter, lore and quest-reactive lines — live in
 * `dialog/scripts/residents.ts`, keyed by the same id.
 *
 * Pure data + selection: no rendering, no audio, no scene coupling.
 */

import { isTownInDanger, type TownDialogContext } from './townDialog';
import { dangerBark } from '../dialog/scripts/townsfolk';
import { residentLinesFor } from '../dialog/scripts/residents';
import { rotateLine } from './townServiceUtil';
import type { TownRole } from '../sprites/person/PersonAppearance';
import { transientSpeaker } from '../dialog/line';
import type { CitizenSpeechStyle } from '../dialog/speakers';
import type { DialogLine, Paragraphs } from '../dialog/line';
import type { TownSpecies } from './townSpecies';

export type ResidentId =
  | 'old_hilda'
  | 'brann_cartwright'
  | 'wendell'
  | 'marta_miller'
  | 'apothecary_fen'
  | 'deacon_aviel'
  | 'smith_varga'
  | 'innkeep_ossie'
  | 'innkeep_brend'
  | 'innkeep_marlow'
  | 'sgt_kessler'
  | 'corporal_pell'
  | 'quartermaster_dann'
  | 'tattooist_nim'
  | 'stock_clerk_wick'
  | 'keeper_brenna_kestrel';

export interface ResidentDef {
  readonly id: ResidentId;
  /** Shown as the dialog speaker in place of the role's job title. */
  readonly name: string;
  /** Appearance and voice base; also the fallback when the town is in danger. */
  readonly role: TownRole;
  readonly species: TownSpecies;
  /** The building this resident anchors, keyed by `entry.name` exactly. */
  readonly home: string;
}

const RESIDENT_DEFS: ReadonlyArray<ResidentDef> = [
  {
    id: 'old_hilda',
    name: 'Old Hilda',
    role: 'priest',
    species: 'human',
    home: "Old Hilda's Cottage",
  },
  {
    id: 'brann_cartwright',
    name: 'Brann Cartwright',
    role: 'laborer',
    species: 'skyfowl',
    home: "Cartwright's Workshop",
  },
  { id: 'wendell', name: 'Wendell', role: 'farmer', species: 'human', home: 'Plumbline Farm' },
  {
    id: 'marta_miller',
    name: 'Marta Miller',
    role: 'farmer',
    species: 'human',
    home: "Miller's Farm",
  },
  {
    id: 'apothecary_fen',
    name: 'Apothecary Fen',
    role: 'merchant',
    species: 'human',
    home: 'Herb & Remedy',
  },
  {
    id: 'deacon_aviel',
    name: 'Deacon Aviel',
    role: 'priest',
    species: 'skyfowl',
    home: 'Temple of the Sky',
  },
  {
    id: 'smith_varga',
    name: 'Smith Varga',
    role: 'smith',
    species: 'skyfowl',
    home: 'The Rusty Anvil',
  },
  {
    id: 'innkeep_ossie',
    name: 'Innkeep Ossie',
    role: 'innkeeper',
    species: 'skyfowl',
    home: 'The Sleeping Cat Inn',
  },
  {
    id: 'innkeep_brend',
    name: 'Innkeep Brend',
    role: 'innkeeper',
    species: 'skyfowl',
    home: 'The Horned Flagon',
  },
  {
    id: 'innkeep_marlow',
    name: 'Innkeep Marlow',
    role: 'innkeeper',
    species: 'human',
    home: 'The Sunken Stump Pub',
  },
  {
    id: 'sgt_kessler',
    name: 'Sgt. Kessler',
    role: 'guard',
    species: 'skyfowl',
    home: 'Blackwood Lodge',
  },
  {
    id: 'corporal_pell',
    name: 'Corporal Pell',
    role: 'guard',
    species: 'skyfowl',
    home: 'The Barracks',
  },
  {
    id: 'quartermaster_dann',
    name: 'Quartermaster Dann',
    role: 'merchant',
    species: 'skyfowl',
    home: 'The Barracks',
  },
  {
    id: 'stock_clerk_wick',
    name: 'Wick',
    role: 'commoner',
    species: 'human',
    home: 'General Store',
  },
  {
    id: 'tattooist_nim',
    name: 'Nim',
    role: 'merchant',
    species: 'skyfowl',
    home: 'The Quiet Needle',
  },
  {
    id: 'keeper_brenna_kestrel',
    name: 'Keeper Brenna Kestrel',
    role: 'merchant',
    species: 'skyfowl',
    home: 'General Store',
  },
];

const RESIDENTS_BY_ID = new Map<ResidentId, ResidentDef>(RESIDENT_DEFS.map((def) => [def.id, def]));

/** The named resident with this id. */
export function residentById(id: ResidentId): ResidentDef {
  const def = RESIDENTS_BY_ID.get(id);
  if (def === undefined) throw new Error(`Unknown resident id: ${id}`);
  return def;
}

/** Every authored resident, for registries and validation sweeps. */
export function allResidents(): ReadonlyArray<ResidentDef> {
  return RESIDENT_DEFS;
}

/** A named resident's species, for danger-line pool selection and for their figure. */
export function residentSpecies(def: ResidentDef): TownSpecies {
  return def.species;
}

/**
 * A named resident presented as the host of a priced menu: their name for the
 * menu's byline, and one of their own lines in place of the generic role bark.
 * Null for a service run by an unnamed occupant, which keeps its module default.
 */
export interface ResidentHost {
  readonly name: string;
  readonly line: string;
}

export function residentHost(def: ResidentDef | null, turn: number): ResidentHost | null {
  if (def === null) return null;
  return { name: def.name, line: rotateLine(residentLinesFor(def.id).ambient, turn) };
}

/**
 * Builds one conversation line with a named resident — a single `DialogLine`
 * whose pages are the reactive lead (if any) followed by the body.
 *
 * A reactive line leads when the world state has given this person something
 * timely to say. The body of the conversation is the next untold lore entry —
 * `turn` walks the list in order, so the first few talks are a story — and once
 * the list runs out it settles into their personal ambient rotation.
 *
 * @param def  The resident speaking.
 * @param turn How many times the player has already talked to them.
 * @param ctx  Live quest snapshot driving the reactive layer.
 * @param speechStyle The voice the resident speaks in.
 */
export function buildResidentConversation(
  def: ResidentDef,
  turn: number,
  ctx: TownDialogContext,
  speechStyle: CitizenSpeechStyle,
): DialogLine {
  const speak = transientSpeaker(def.name, speechStyle);
  if (isTownInDanger(ctx)) return speak.line(dangerBark(residentSpecies(def), def.role));

  const lines = residentLinesFor(def.id);
  const reactivePool = lines.reactive?.(ctx) ?? null;
  const reactiveLine =
    reactivePool !== null && reactivePool.length > 0 ? rotateLine(reactivePool, turn) : null;

  // `?? null` rather than a bare index: an out-of-range read yields `undefined`,
  // which a `!== null` guard waves through.
  const untoldLore = turn < lines.lore.length ? (lines.lore[turn] ?? null) : null;
  const body: Paragraphs = untoldLore ?? [rotateLine(lines.ambient, turn - lines.lore.length)];

  return speak.line(reactiveLine === null ? body : [reactiveLine, ...body]);
}
