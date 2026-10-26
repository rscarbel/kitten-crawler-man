import type { EquipmentManager } from '../equipment/EquipmentManager';
import { wearerAllows, wearerOf, type InventoryItem } from '../defs/ItemDefs';
import { getSkillDef, type CrawlerKind } from '../../skills/SkillManager';

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
 *   item would evict theirs (`Inventory.replaceQuestSlot`), and
 *   the item is tied to whoever is running the quest regardless.
 * - `wearer` restricts gear to one crawler's slots; gear either crawler can
 *   wear moves freely, and comes off its giver first (`MenusKit.tradeItem`).
 * - a cursed piece bound on its wearer stays with her until the binding lifts.
 * - `skillId` restricts a skill book to whichever crawler `eligibleFor` names.
 */
export function itemIsTradable(
  item: InventoryItem,
  toKind: CrawlerKind,
  holderEquipment: Pick<EquipmentManager, 'isRemovalLocked'>,
): boolean {
  if (item.canDrop === false) return false;
  if (holderEquipment.isRemovalLocked(item.id)) return false;
  if (item.isQuestItem === true) return false;
  const wearer = wearerOf(item.id);
  if (wearer !== undefined && !wearerAllows(wearer, toKind)) return false;
  if (item.skillId !== undefined) {
    const eligibleFor = getSkillDef(item.skillId).eligibleFor;
    if (eligibleFor !== 'both' && eligibleFor !== toKind) return false;
  }
  return true;
}
