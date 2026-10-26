/**
 * Skill-book drops. A book nobody in the party can still learn from (every
 * crawler is maxed in its skill or cannot read it) is swapped for a random
 * book someone can, and nothing drops once no book could help anyone.
 */
import { ITEM_DEF } from '../core/items/defs/ItemDefs';
import type { ItemDef, ItemId } from '../core/items/defs/ItemDefs';
import type { SkillId } from '../core/skills/SkillManager';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';

/**
 * Per-kill chance a qualifying regular enemy drops its themed skill book.
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

/** Appends `bookId`, or a still-useful substitute, to `items` on a rare roll. */
export function maybeDropSkillBook(items: LootDrop['items'], bookId: ItemId): void {
  if (Math.random() >= SKILL_BOOK_DROP_CHANCE) return;
  const book = usefulSkillBook(bookId);
  if (book !== null) items.push({ id: book, quantity: 1 });
}
