import type { InventoryPanel } from '../ui/InventoryPanel';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { ItemId } from '../core/Inventory';

/**
 * Resolves pending inventory actions (equip, unequip, drop) from the
 * InventoryPanel. Extracted from DungeonScene so it can be shared across
 * scenes.
 *
 * @param onDrop - Optional callback when an item is dropped. If not provided,
 *   drop actions are silently consumed (items removed from inventory with no
 *   world loot spawned).
 */
export function resolvePendingInventoryAction(
  inventoryPanel: InventoryPanel,
  active: HumanPlayer | CatPlayer,
  onDrop?: (x: number, y: number, id: ItemId, quantity: number) => void,
): void {
  if (inventoryPanel.pendingEquipSlot !== null) {
    const slotIdx = inventoryPanel.pendingEquipSlot;
    inventoryPanel.pendingEquipSlot = null;
    const item = active.inventory.slots[slotIdx];
    if (item?.type === 'armor' && item.equipSlot && item.equipSubSlot) {
      const prev = active.inventory.equip(slotIdx);
      if (prev) active.removeItemBonus(prev);
      active.applyItemBonus(item);
    }
  }

  if (inventoryPanel.pendingUnequipSlot !== null) {
    const slotIdx = inventoryPanel.pendingUnequipSlot;
    inventoryPanel.pendingUnequipSlot = null;
    const item = active.inventory.slots[slotIdx];
    if (item?.type === 'armor' && item.equipSlot && item.equipSubSlot) {
      active.inventory.unequip(`${item.equipSlot}:${item.equipSubSlot}`);
      active.removeItemBonus(item);
    }
  }

  if (inventoryPanel.pendingDropItem !== null) {
    const { id, quantity } = inventoryPanel.pendingDropItem;
    inventoryPanel.pendingDropItem = null;
    if (active.inventory.hasEquipped(id)) {
      const item =
        active.inventory.slots.find((s) => s?.id === id) ??
        active.inventory.hotbar.find((s) => s?.id === id) ??
        null;
      if (item?.equipSlot && item?.equipSubSlot) {
        active.inventory.unequip(`${item.equipSlot}:${item.equipSubSlot}`);
        active.removeItemBonus(item);
      }
    }
    active.inventory.removeItems(id, quantity);
    onDrop?.(active.x, active.y, id, quantity);
  }
}
