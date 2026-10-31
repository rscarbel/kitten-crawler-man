/**
 * The kinds of key a party can hold, and what each one is for.
 *
 * Data only, with no imports that paint, play or speak, so the save check can
 * read it. Code that needs something about a kind reads it from
 * {@link KEY_KIND_DEFS} rather than comparing the kind's id, so a new kind
 * arrives as one entry here plus its own content. A kind's ink and icon are
 * tables keyed by {@link KeyKind} in the UI, which must be filled in for a new
 * kind before it compiles.
 */

const KEY_KINDS = ['golden'] as const;

export type KeyKind = (typeof KEY_KINDS)[number];

/**
 * What a key is for. Every reader is a switch ending in a `never` check or a
 * `Record` over its `kind`, so a new variant fails to compile until each
 * reader handles it.
 */
export type KeyOpens = { readonly kind: 'floorStairwells' };

/**
 * How long a party keeps a kind of key.
 *
 * - `floor`: dropped when the party arrives on another floor.
 * - `run`: kept from floor to floor.
 */
type KeyScope = 'floor' | 'run';

export interface KeyKindDef {
  /** The key's on-screen name. */
  readonly name: string;
  /** One piece of the key's on-screen name. */
  readonly fragmentName: string;
  readonly opens: KeyOpens;
  readonly scope: KeyScope;
}

const KEY_KIND_DEFS = {
  golden: {
    name: 'Golden Key',
    fragmentName: 'Key Fragment',
    opens: { kind: 'floorStairwells' },
    scope: 'floor',
  },
} as const satisfies Record<KeyKind, KeyKindDef>;

export function keyKindDef(kind: KeyKind): KeyKindDef {
  return KEY_KIND_DEFS[kind];
}

/**
 * Whether two kinds are the same kind. A function rather than `===` at each
 * site because, while only one kind exists, `no-unnecessary-condition` flags
 * every such comparison as always true. Compare kinds only through this.
 */
export function keyKindsMatch(a: KeyKind, b: KeyKind): boolean {
  return Object.is(a, b);
}

export function isKeyKind(value: unknown): value is KeyKind {
  return KEY_KINDS.some((kind) => kind === value);
}

/** Whether a party arriving on another floor keeps what it holds of a key with this scope. */
const KEPT_ACROSS_FLOORS = {
  floor: false,
  run: true,
} as const satisfies Record<KeyScope, boolean>;

/** Whether the party keeps what it holds of `kind` from floor to floor. */
export function keptAcrossFloors(kind: KeyKind): boolean {
  return KEPT_ACROSS_FLOORS[keyKindDef(kind).scope];
}

/** Whether what a key opens includes a floor's stairwells. */
const OPENS_STAIRWELLS = {
  floorStairwells: true,
} as const satisfies Record<KeyOpens['kind'], boolean>;

/** Whether a key of this kind opens a floor's stairwells. */
export function opensStairwells(kind: KeyKind): boolean {
  return OPENS_STAIRWELLS[keyKindDef(kind).opens.kind];
}
