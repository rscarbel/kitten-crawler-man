/**
 * The Cloak & Dagger's Texas Hold'em regulars: who they are and what they look
 * like, never how they play. Play style is rolled per run from the world seed
 * by `rollPokerPersonalities`, so a name says nothing about the player's
 * chances against it.
 *
 * Looks come from the town's closed cast, split roughly two Hawkfolk to one
 * human like the club crowd, and every regular wears a different one so the
 * player can tell the seats apart at a glance.
 */

import type { ClubFigureRef } from '../../../../sprites/clubCastFigure';
import { townCastLook } from '../../../../sprites/person/townCastLooks';

export const REGULAR_IDS = [
  'wren',
  'grizzle',
  'ottoline',
  'pell',
  'dabney',
  'corvina',
  'reverend',
  'malloy',
  'crumb',
  'quillfeather',
  'tuppence',
  'vane',
  'brisket',
  'mags',
] as const;
export type RegularId = (typeof REGULAR_IDS)[number];

export function isRegularId(id: string | null): id is RegularId {
  return REGULAR_IDS.some((regularId) => regularId === id);
}

export interface PokerRegular {
  readonly id: RegularId;
  readonly name: string;
  readonly look: ClubFigureRef;
}

export const POKER_REGULARS: Readonly<Record<RegularId, PokerRegular>> = {
  wren: {
    id: 'wren',
    name: 'Wren Halloway',
    look: { species: 'hawkfolk', lookId: 'merchant_sparrowfleck_slight' },
  },
  grizzle: {
    id: 'grizzle',
    name: 'Grizzle Pott',
    look: { species: 'human', look: townCastLook('adult_smith') },
  },
  ottoline: {
    id: 'ottoline',
    name: 'Lady Ottoline Fairweather',
    look: { species: 'hawkfolk', lookId: 'noble_goldenbarred_heavy' },
  },
  pell: {
    id: 'pell',
    name: 'Sixfinger Pell',
    look: { species: 'hawkfolk', lookId: 'porter_hawkbrown_slight' },
  },
  dabney: {
    id: 'dabney',
    name: 'Nervous Dabney',
    look: { species: 'hawkfolk', lookId: 'clerk_dovegrey_slight' },
  },
  corvina: {
    id: 'corvina',
    name: 'Corvina Lark',
    look: { species: 'hawkfolk', lookId: 'temple_corvidblack_heavy' },
  },
  reverend: {
    id: 'reverend',
    name: 'The Reverend Snake-Eyes',
    look: { species: 'human', look: townCastLook('adult_priest') },
  },
  malloy: {
    id: 'malloy',
    name: 'Odds Malloy',
    look: { species: 'human', look: townCastLook('adult_commoner') },
  },
  crumb: {
    id: 'crumb',
    name: 'Mother Crumb',
    look: { species: 'human', look: townCastLook('adult_innkeeper') },
  },
  quillfeather: {
    id: 'quillfeather',
    name: 'Barnaby Quillfeather',
    look: { species: 'hawkfolk', lookId: 'clerk_dovegrey_standard' },
  },
  tuppence: {
    id: 'tuppence',
    name: 'Tuppence',
    look: { species: 'hawkfolk', lookId: 'porter_sparrowfleck_standard' },
  },
  vane: {
    id: 'vane',
    name: 'Gristle Vane',
    look: { species: 'hawkfolk', lookId: 'laborer_hawkbrown_heavy' },
  },
  brisket: {
    id: 'brisket',
    name: 'Brisket Mulgrew',
    look: { species: 'human', look: townCastLook('adult_noble') },
  },
  mags: {
    id: 'mags',
    name: 'Mags the Molt',
    look: { species: 'hawkfolk', lookId: 'temple_dovegrey_standard' },
  },
};

/** Builds a record with one entry per regular, without losing the key type. */
export function mapRegulars<T>(make: (id: RegularId) => T): Record<RegularId, T> {
  return {
    wren: make('wren'),
    grizzle: make('grizzle'),
    ottoline: make('ottoline'),
    pell: make('pell'),
    dabney: make('dabney'),
    corvina: make('corvina'),
    reverend: make('reverend'),
    malloy: make('malloy'),
    crumb: make('crumb'),
    quillfeather: make('quillfeather'),
    tuppence: make('tuppence'),
    vane: make('vane'),
    brisket: make('brisket'),
    mags: make('mags'),
  };
}
