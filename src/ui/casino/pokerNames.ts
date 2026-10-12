/**
 * What a regular's plate says when their full name will not fit: the part a
 * table would call them by, never more than eight letters.
 */

import type { RegularId } from '../../systems/casino/poker/npc/regulars';

export const REGULAR_SHORT_NAMES: Readonly<Record<RegularId, string>> = {
  wren: 'Wren',
  grizzle: 'Grizzle',
  ottoline: 'Ottoline',
  pell: 'Pell',
  dabney: 'Dabney',
  corvina: 'Corvina',
  reverend: 'Reverend',
  malloy: 'Malloy',
  crumb: 'Crumb',
  quillfeather: 'Barnaby',
  tuppence: 'Tuppence',
  vane: 'Gristle',
  brisket: 'Brisket',
  mags: 'Mags',
};
