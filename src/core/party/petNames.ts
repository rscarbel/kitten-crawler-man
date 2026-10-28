/**
 * The names the player gives the party's pets. A name belongs to the run: a
 * new game asks again, and a death never rewinds one.
 */

import { isRecord } from '../util/guards';

export const PET_KINDS = ['deinonychus', 'attackCow'] as const;

export type PetKind = (typeof PET_KINDS)[number];

export function isPetKind(value: string): value is PetKind {
  return PET_KINDS.some((kind) => kind === value);
}

/** The longest name a pet takes, in characters. */
export const PET_NAME_MAX_LENGTH = 16;

declare const petNameBrand: unique symbol;

/** A name that passed {@link parsePetName}; nothing else can make one. */
export type PetName = string & { readonly [petNameBrand]: true };

/**
 * Letters (with the marks some scripts build them from), digits, spaces,
 * apostrophes and hyphens, in any script.
 */
const LEGAL_PET_NAME = /^[\p{L}\p{M}\p{Nd} '-]+$/u;
/** A name is more than punctuation: it holds at least one letter or digit. */
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;
const SPACE_RUNS = /\s+/g;
/**
 * Phone keyboards type a curly apostrophe by default, which reads as the
 * same mark to the player.
 */
const TYPOGRAPHIC_APOSTROPHES = /[\u2018\u2019\u02BC]/g;

function isPetName(normalized: string): normalized is PetName {
  const length = Array.from(normalized).length;
  return (
    length > 0 &&
    length <= PET_NAME_MAX_LENGTH &&
    LEGAL_PET_NAME.test(normalized) &&
    HAS_LETTER_OR_DIGIT.test(normalized)
  );
}

/**
 * `raw` as a pet's name: trimmed, with runs of spaces collapsed, or null when
 * what is left is empty, too long, holds a character a name may not, or has
 * no letter or digit at all.
 */
export function parsePetName(raw: string): PetName | null {
  const normalized = raw.replace(TYPOGRAPHIC_APOSTROPHES, "'").replace(SPACE_RUNS, ' ').trim();
  return isPetName(normalized) ? normalized : null;
}

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
