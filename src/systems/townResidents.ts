/**
 * The people who live in Taloncrest's buildings — named individuals layered
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
import { type PlannedBuildingId, mapByBuildingId, type BuildingId } from '../map/buildingIds';
import { RESIDENT_IDS, type ResidentId } from '../core/state/residentIds';

export interface ResidentDef {
  readonly id: ResidentId;
  /** Shown as the dialog speaker in place of the role's job title. */
  readonly name: string;
  /** Appearance and voice base; also the fallback when the town is in danger. */
  readonly role: TownRole;
  readonly species: TownSpecies;
  /** The building this resident anchors. */
  readonly home: PlannedBuildingId;
}

/**
 * Keyed by every `ResidentId`, each entry carrying its own key as its id, so an
 * id without a resident (or a resident without an id) fails to compile rather
 * than parsing from a save and failing at the first lookup.
 */
const RESIDENT_DEFS = {
  old_lori: {
    id: 'old_lori',
    name: 'Old Lori',
    role: 'priest',
    species: 'dwarf',
    home: 'taloncrest_old_lady_cottage',
  },
  steve_cartwright: {
    id: 'steve_cartwright',
    name: 'Steve Cartwright',
    role: 'laborer',
    species: 'otter',
    home: 'taloncrest_crafting_house',
  },
  janitor_puddles: {
    id: 'janitor_puddles',
    name: 'Puddles',
    role: 'laborer',
    species: 'crocodilian',
    home: 'taloncrest_pub',
  },
  janitor_grout: {
    id: 'janitor_grout',
    name: 'Grout',
    role: 'laborer',
    species: 'crocodilian',
    home: 'taloncrest_flagon_tavern',
  },
  wendell: {
    id: 'wendell',
    name: 'Wendell',
    role: 'farmer',
    species: 'human',
    home: 'taloncrest_builder_farm',
  },
  marta_miller: {
    id: 'marta_miller',
    name: 'Marta Miller',
    role: 'farmer',
    species: 'human',
    home: 'taloncrest_mill_farm',
  },
  apothecary_fen: {
    id: 'apothecary_fen',
    name: 'Apothecary Fen',
    role: 'merchant',
    species: 'human',
    home: 'taloncrest_apothecary',
  },
  taloncrest_apothecary_assistant: {
    id: 'taloncrest_apothecary_assistant',
    name: 'Baggi',
    role: 'laborer',
    species: 'orc',
    home: 'taloncrest_apothecary',
  },
  deacon_aviel: {
    id: 'deacon_aviel',
    name: 'Deacon Aviel',
    role: 'priest',
    species: 'hawkfolk',
    home: 'taloncrest_temple',
  },
  smith_varga: {
    id: 'smith_varga',
    name: 'Smith Varga',
    role: 'smith',
    species: 'hawkfolk',
    home: 'taloncrest_smithy',
  },
  innkeep_ossie: {
    id: 'innkeep_ossie',
    name: 'Innkeep Ossie',
    role: 'innkeeper',
    species: 'hawkfolk',
    home: 'taloncrest_inn',
  },
  innkeep_brend: {
    id: 'innkeep_brend',
    name: 'Innkeep Brend',
    role: 'innkeeper',
    species: 'hawkfolk',
    home: 'taloncrest_flagon_tavern',
  },
  innkeep_marlow: {
    id: 'innkeep_marlow',
    name: 'Innkeep Marlow',
    role: 'innkeeper',
    species: 'human',
    home: 'taloncrest_pub',
  },
  sgt_kessler: {
    id: 'sgt_kessler',
    name: 'Sgt. Kessler',
    role: 'guard',
    species: 'hawkfolk',
    home: 'taloncrest_garrison_lodge',
  },
  taloncrest_lodge_cellar_elf: {
    id: 'taloncrest_lodge_cellar_elf',
    name: 'Cellar elf',
    role: 'commoner',
    species: 'elf',
    home: 'taloncrest_garrison_lodge',
  },
  sydney: {
    id: 'sydney',
    name: 'Sydney',
    role: 'merchant',
    species: 'crocodilian',
    home: 'taloncrest_barracks',
  },
  corporal_pell: {
    id: 'corporal_pell',
    name: 'Corporal Pell',
    role: 'guard',
    species: 'hawkfolk',
    home: 'taloncrest_barracks',
  },
  quartermaster_dann: {
    id: 'quartermaster_dann',
    name: 'Quartermaster Dann',
    role: 'merchant',
    species: 'hawkfolk',
    home: 'taloncrest_barracks',
  },
  stock_clerk_wick: {
    id: 'stock_clerk_wick',
    name: 'Wick',
    role: 'commoner',
    species: 'human',
    home: 'taloncrest_general_store',
  },
  tattooist_nim: {
    id: 'tattooist_nim',
    name: 'Nim',
    role: 'merchant',
    species: 'hawkfolk',
    home: 'taloncrest_tattoo_parlor',
  },
  // The club's host, drawn by his own painter, at the front desk by the door.
  brandon: {
    id: 'brandon',
    name: 'Brandon',
    role: 'noble',
    species: 'human',
    home: 'taloncrest_nightclub',
  },
  keeper_brenna_kestrel: {
    id: 'keeper_brenna_kestrel',
    name: 'Keeper Brenna Kestrel',
    role: 'merchant',
    species: 'hawkfolk',
    home: 'taloncrest_general_store',
  },
} as const satisfies { readonly [Id in ResidentId]: ResidentDef & { readonly id: Id } };

type ResidentRecord = (typeof RESIDENT_DEFS)[ResidentId];

/** The species the resident with id `Id` is authored as. */
export type ResidentSpeciesOf<Id extends ResidentId> = Extract<
  ResidentRecord,
  { readonly id: Id }
>['species'];

/** Every building at least one named resident lives in. */
type ResidentHome = ResidentRecord['home'];

/** The ids of the residents who live in `Home`. */
type ResidentOf<Home extends ResidentHome> = Extract<ResidentRecord, { readonly home: Home }>['id'];

/**
 * Who keeps each building a resident lives in: the person the house is
 * theirs, whose species leans its door's frontage crowd. Every resident's home
 * needs an entry, and a keeper can only be someone who lives there.
 */
const BUILDING_KEEPERS = {
  taloncrest_old_lady_cottage: 'old_lori',
  taloncrest_crafting_house: 'steve_cartwright',
  taloncrest_pub: 'innkeep_marlow',
  taloncrest_flagon_tavern: 'innkeep_brend',
  taloncrest_builder_farm: 'wendell',
  taloncrest_mill_farm: 'marta_miller',
  taloncrest_apothecary: 'apothecary_fen',
  taloncrest_temple: 'deacon_aviel',
  taloncrest_smithy: 'smith_varga',
  taloncrest_inn: 'innkeep_ossie',
  taloncrest_garrison_lodge: 'sgt_kessler',
  taloncrest_barracks: 'corporal_pell',
  taloncrest_general_store: 'keeper_brenna_kestrel',
  taloncrest_tattoo_parlor: 'tattooist_nim',
  taloncrest_nightclub: 'brandon',
} as const satisfies { readonly [Home in ResidentHome]: ResidentOf<Home> };

const KEEPER_BY_BUILDING = mapByBuildingId<ResidentId>(BUILDING_KEEPERS);

/** The named resident with this id. */
export function residentById(id: ResidentId): ResidentDef {
  return RESIDENT_DEFS[id];
}

/** Every authored resident, for registries and validation sweeps. */
export function allResidents(): ReadonlyArray<ResidentDef> {
  return RESIDENT_IDS.map(residentById);
}

/** The resident who keeps the building named `buildingId`, or null for a building no resident lives in. */
export function buildingKeeper(buildingId: BuildingId): ResidentDef | null {
  const keeperId = KEEPER_BY_BUILDING.get(buildingId);
  return keeperId === undefined ? null : residentById(keeperId);
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

/** A hosted menu's byline: the host's name, or none for an unnamed occupant. */
export function hostByline(host: ResidentHost | null): string | null {
  return host === null ? null : host.name;
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
