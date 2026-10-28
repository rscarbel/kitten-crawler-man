/**
 * Skill-book drops. A creature drops from its pool in `SKILL_BOOK_POOLS`,
 * skipping any book nobody in the party can still learn from (every crawler is
 * maxed in its skill or cannot read it); a pool with nothing useful left is
 * swapped for a random book someone can, and nothing drops once no book could
 * help anyone.
 */
import { ITEM_DEF } from '../core/items/defs/ItemDefs';
import type { ItemDef, ItemId } from '../core/items/defs/ItemDefs';
import type { SkillId } from '../core/skills/SkillManager';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawWeightedBook, SKILL_BOOK_POOLS, type SkillBookPoolId } from '../loot/skillBookPools';

/**
 * Per-kill chance a qualifying regular enemy drops a book from its pool.
 *
 * Same order as the rarest consumables (jugg juice 0.005, stat boost 0.001):
 * a skill book should be an event, not a farm. Deliberately *not* wired into
 * `Mob.rollLootItems` — each book drops only from creatures that lived by that
 * skill, which is what ties the reward to the enemy's identity.
 */
export const SKILL_BOOK_DROP_CHANCE = 0.005;

type SkillBookReader = Pick<Player, 'skills'>;

/**
 * Module state because mobs roll loot without access to the party, the same
 * reason `resourceSessionTally` is module state. Empty means no filter, so
 * headless rigs and dev previews that never register a party drop as before.
 */
let readers: readonly SkillBookReader[] = [];

/** Registers the live party whose skill levels decide which books are still useful. */
export function setSkillBookReaders(next: readonly SkillBookReader[]): void {
  readers = next;
}

function isSkillBookDef(def: ItemDef): def is ItemDef & { skillId: SkillId } {
  return def.skillId !== undefined;
}

/** Every item that teaches a skill when read. */
export const SKILL_BOOK_IDS: readonly ItemId[] = Object.values(ITEM_DEF)
  .filter(isSkillBookDef)
  .map((def) => def.id);

/** True when no registered crawler could gain a level from reading `bookId`. */
export function isSkillBookSpent(bookId: ItemId): boolean {
  if (readers.length === 0) return false;
  const skillId = ITEM_DEF[bookId].skillId;
  if (skillId === undefined) return false;
  return readers.every((reader) => {
    const outcome = reader.skills.previewUnlock(skillId);
    return outcome === 'already_max' || outcome === 'not_eligible';
  });
}

/**
 * `bookId` when someone can still learn from it, otherwise a uniformly random
 * other book someone can, or null when every book is spent.
 */
export function usefulSkillBook(bookId: ItemId): ItemId | null {
  if (!isSkillBookSpent(bookId)) return bookId;
  const alternatives = SKILL_BOOK_IDS.filter((id) => id !== bookId && !isSkillBookSpent(id));
  if (alternatives.length === 0) return null;
  return alternatives[Math.floor(Math.random() * alternatives.length)] ?? null;
}

/**
 * A book from `pool` someone can still learn from, drawn by weight, or null
 * when every book in it is spent.
 */
function usefulPoolBook(pool: SkillBookPoolId, roll: number): ItemId | null {
  const useful = SKILL_BOOK_POOLS[pool].filter((entry) => !isSkillBookSpent(entry.book));
  return drawWeightedBook(useful, roll);
}

/** Appends a book from `pool`, or a still-useful substitute, to `items` on a rare roll. */
export function maybeDropSkillBook(items: LootDrop['items'], pool: SkillBookPoolId): void {
  if (Math.random() >= SKILL_BOOK_DROP_CHANCE) return;
  const fromPool = usefulPoolBook(pool, Math.random());
  const fallback = SKILL_BOOK_POOLS[pool][0].book;
  const book = fromPool ?? usefulSkillBook(fallback);
  if (book !== null) items.push({ id: book, quantity: 1 });
}
