import type { ItemId } from '../core/ItemDefs';
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

/** Appends `bookId` to `items` on a rare roll. */
export function maybeDropSkillBook(items: LootDrop['items'], bookId: ItemId): void {
  if (Math.random() < SKILL_BOOK_DROP_CHANCE) items.push({ id: bookId, quantity: 1 });
}
