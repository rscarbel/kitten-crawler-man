/**
 * Which skill books each kind of book-dropping creature can leave behind, and
 * how likely each is. A pool is about the creature's identity: what it lived
 * by, so the book it drops is the one it would have read.
 *
 * A pool decides only *which* book drops. Whether one drops at all is the
 * single per-kill chance in `skillBookDrop.ts`, so adding a book to a pool
 * never makes books more common.
 */

import type { ItemId } from '../core/items/defs/ItemDefs';
import type { SkillId } from '../core/skills/SkillManager';

/** Every item that teaches a skill. */
export type SkillBookId = Extract<ItemId, `skill_book_${SkillId}`>;

/** One book in a pool, and its share of the pool's draws relative to the others. */
export interface WeightedSkillBook {
  readonly book: SkillBookId;
  readonly weight: number;
}

/** The kinds of creature that drop a skill book, by what they lived by. */
export type SkillBookPoolId =
  | 'vermin'
  | 'glutton'
  | 'brawler'
  | 'armouredFighter'
  | 'stoneFist'
  | 'archer'
  | 'bomber'
  | 'hawkfolk'
  | 'mantid'
  | 'skitterer';

export const SKILL_BOOK_POOLS = {
  vermin: [{ book: 'skill_book_nine_lives', weight: 1 }],
  glutton: [{ book: 'skill_book_iron_stomach', weight: 1 }],
  brawler: [
    { book: 'skill_book_pugilism', weight: 3 },
    { book: 'skill_book_blunt_proficiency', weight: 1 },
  ],
  armouredFighter: [
    { book: 'skill_book_pugilism', weight: 2 },
    { book: 'skill_book_swordsmanship', weight: 2 },
    { book: 'skill_book_blunt_proficiency', weight: 1 },
  ],
  stoneFist: [
    { book: 'skill_book_pugilism', weight: 1 },
    { book: 'skill_book_mechanical_fist', weight: 1 },
  ],
  archer: [
    { book: 'skill_book_archery', weight: 2 },
    { book: 'skill_book_warp_speed', weight: 1 },
  ],
  bomber: [
    { book: 'skill_book_demolitionist', weight: 2 },
    { book: 'skill_book_pyros_touch', weight: 1 },
    { book: 'skill_book_warp_speed', weight: 1 },
  ],
  hawkfolk: [
    { book: 'skill_book_warp_speed', weight: 2 },
    { book: 'skill_book_archery', weight: 1 },
    { book: 'skill_book_magic_eye', weight: 1 },
  ],
  mantid: [
    { book: 'skill_book_warp_speed', weight: 2 },
    { book: 'skill_book_clawmanship', weight: 2 },
  ],
  skitterer: [
    { book: 'skill_book_warp_speed', weight: 2 },
    { book: 'skill_book_clawmanship', weight: 1 },
  ],
} as const satisfies Record<SkillBookPoolId, readonly WeightedSkillBook[]>;

/**
 * A book drawn from `books` by weight, or null for an empty list. `roll` is a
 * number in [0, 1).
 */
export function drawWeightedBook(
  books: readonly WeightedSkillBook[],
  roll: number,
): SkillBookId | null {
  const total = books.reduce((sum, entry) => sum + entry.weight, 0);
  let remaining = roll * total;
  for (const entry of books) {
    remaining -= entry.weight;
    if (remaining < 0) return entry.book;
  }
  return books[books.length - 1]?.book ?? null;
}
