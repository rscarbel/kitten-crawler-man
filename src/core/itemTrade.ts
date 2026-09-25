import type { InventoryItem } from './ItemDefs';
import { getSkillDef, type CrawlerKind } from './SkillManager';

/**
 * Whether `item` could be handed to the other crawler — derived from the same
 * data that already governs whether that crawler could ever hold or use it,
 * rather than a second hand-maintained list:
 *
 * - `canDrop: false` marks an item as permanently bound to whoever holds it
 *   (an ability tome, the Wayfinder's Anchor); the same rule that keeps it out
 *   of the world keeps it out of a partner's pack.
 * - `isQuestItem` items live in the single reserved quest hotbar slot, keyed
 *   by id: handing one to a partner who already holds a *different* quest
 *   item would silently overwrite theirs (`Inventory.addToQuestSlot`), and
 *   the item is tied to whoever is running the quest regardless.
 * - `wearer` restricts armour to one crawler's gear slots.
 * - `skillId` restricts a skill book to whichever crawler `eligibleFor` names.
 */
export function itemIsTradable(item: InventoryItem, toKind: CrawlerKind): boolean {
  if (item.canDrop === false) return false;
  if (item.isQuestItem === true) return false;
  if (item.wearer !== undefined && item.wearer !== toKind) return false;
  if (item.skillId !== undefined) {
    const eligibleFor = getSkillDef(item.skillId).eligibleFor;
    if (eligibleFor !== 'both' && eligibleFor !== toKind) return false;
  }
  return true;
}
