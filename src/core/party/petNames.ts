/**
 * The names the player gives the party's pets. A name belongs to the run: a
 * new game asks again, and a death never rewinds one.
 */

import {
  NAME_MAX_CODE_UNITS,
  nameRejection,
  nameRuleMessages,
  normalizeName,
  type NameCaps,
  type NameRejection,
} from '../naming/nameRules';
import { isRecord } from '../util/guards';

export const PET_KINDS = ['deinonychus', 'attackCow'] as const;

export type PetKind = (typeof PET_KINDS)[number];

export function isPetKind(value: string): value is PetKind {
  return PET_KINDS.some((kind) => kind === value);
}

/** The most characters a pet's name may show. */
export const PET_NAME_MAX_LENGTH = 16;

const PET_NAME_CAPS = {
  maxGraphemes: PET_NAME_MAX_LENGTH,
  maxCodeUnits: NAME_MAX_CODE_UNITS,
} as const satisfies NameCaps;

declare const petNameBrand: unique symbol;

/** A name that passed {@link parsePetName}; nothing else can make one. */
export type PetName = string & { readonly [petNameBrand]: true };

function isPetName(normalized: string): normalized is PetName {
  return nameRejection(normalized, PET_NAME_CAPS) === null;
}

/** `raw` as a pet's name, tidied, or null when it breaks a rule. */
export function parsePetName(raw: string): PetName | null {
  const normalized = normalizeName(raw);
  return isPetName(normalized) ? normalized : null;
}

/** The rule `raw` breaks as a pet's name, or null when it is one. */
export function petNameRejection(raw: string): NameRejection | null {
  return nameRejection(normalizeName(raw), PET_NAME_CAPS);
}

/** The line a naming screen shows for each rule a pet's name can break. */
export const PET_NAME_RULE_MESSAGES = nameRuleMessages(PET_NAME_CAPS);

/** Names offered to a player who would rather pick than type. */
export const PET_NAME_SUGGESTIONS = {
  deinonychus: [
    'Talon',
    'Sickle',
    'Pebble',
    'Clementine',
    'Gizmo',
    'Mango',
    'Fern',
    'Ziggy',
    'Sprocket',
    'Juniper',
    'Rascal',
    'Nugget',
  ],
  attackCow: [
    'Bessie',
    'Clover',
    'Daisy',
    'Buttercup',
    'Brisket',
    'Moose',
    'Patty',
    'Tank',
    'Dumpling',
    'Marigold',
    'Wellington',
    'Chuck',
  ],
} as const satisfies Record<PetKind, readonly string[]>;

/** The run's pet names as a save stores them: a pet not yet named is absent. */
export type SavedPetNames = Readonly<Partial<Record<PetKind, PetName>>>;

/**
 * A stored `petNames` record, or undefined when it names a pet this build
 * does not have or holds a name {@link parsePetName} would not have given.
 */
export function parseSavedPetNames(raw: unknown): SavedPetNames | undefined {
  if (!isRecord(raw)) return undefined;
  if (!Object.keys(raw).every(isPetKind)) return undefined;
  const parsed: Partial<Record<PetKind, PetName>> = {};
  for (const kind of PET_KINDS) {
    const stored = raw[kind];
    if (stored === undefined) continue;
    if (typeof stored !== 'string') return undefined;
    const name = parsePetName(stored);
    if (name === null || name !== stored) return undefined;
    parsed[kind] = name;
  }
  return parsed;
}

/** Reads the run's pet names. What systems that say a pet's name are handed. */
export interface PetNames {
  /** The pet's name, or null before the player has named it. */
  nameOf(kind: PetKind): PetName | null;
}

/**
 * The run's pet names, threaded by reference through every scene of the run
 * like the music library, so a death that rewinds the floor keeps them.
 */
export class PetNameBook implements PetNames {
  private readonly names: Partial<Record<PetKind, PetName>>;

  constructor(saved: SavedPetNames = {}) {
    this.names = { ...saved };
  }

  nameOf(kind: PetKind): PetName | null {
    return this.names[kind] ?? null;
  }

  give(kind: PetKind, name: PetName): void {
    this.names[kind] = name;
  }

  saved(): SavedPetNames {
    return { ...this.names };
  }
}

/** How a line of text names a pet: by the name the player gave it, or by its kind until then. */
export interface PetWords {
  /** What the pet is called to, or labelled: "Talon", or "Deinonychus". */
  readonly called: string;
  /** The pet spoken of mid-sentence: "Talon", or "your Deinonychus". */
  readonly referred: string;
  /** {@link referred} opening a sentence: "Talon", or "Your Deinonychus". */
  readonly opening: string;
  /**
   * The pet with its kind, for a reader who has never met it (the AI's party
   * list): "Talon the Deinonychus", or "the Deinonychus".
   */
  readonly described: string;
}

const UNNAMED_PET_WORDS = {
  deinonychus: {
    called: 'Deinonychus',
    referred: 'your Deinonychus',
    opening: 'Your Deinonychus',
    described: 'the Deinonychus',
  },
  attackCow: {
    called: 'Attack Cow',
    referred: 'the attack cow',
    opening: 'The attack cow',
    described: 'the attack cow',
  },
} as const satisfies Record<PetKind, PetWords>;

/** The words for `kind` before the player names it, or wherever a pet's name must not appear. */
export function unnamedPetWords(kind: PetKind): PetWords {
  return UNNAMED_PET_WORDS[kind];
}

/** The words for `kind`, read from the run's names now. */
export function petWords(names: PetNames, kind: PetKind): PetWords {
  const name = names.nameOf(kind);
  if (name === null) return UNNAMED_PET_WORDS[kind];
  return {
    called: name,
    referred: name,
    opening: name,
    described: `${name} ${UNNAMED_PET_WORDS[kind].described}`,
  };
}
