/** The Cloak & Dagger's Texas Hold'em regulars, by id: plain data, apart from their looks in `regulars.ts`. */

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
