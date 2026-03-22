import type { InventoryItem, ItemId } from './ItemDefs';

/** Callback to locate an item by ID across all storage (bag + hotbar). */
export type ItemFinder = (id: ItemId) => InventoryItem | null;

/**
 * Manages equipment slots and stat bonuses.
 * Equipment is tracked by ItemId, not by physical slot position,
 * so items can be freely moved between bag/hotbar without losing
 * their equipped status.
 */
export class EquipmentManager {
  /**
   * Maps "Slot:SubSlot" key → ItemId of the equipped item.
   * e.g. "Legs:Pants" → 'enchanted_bigboi_boxers'.
   */
  readonly equipped: Map<string, ItemId> = new Map();

  constructor(private readonly findItem: ItemFinder) {}

  /**
   * Equip the given item. Records its ID in the equipped map.
   * Returns the previously equipped item in that sub-slot (or null).
   */
  equip(item: InventoryItem): InventoryItem | null {
    if (item.type !== 'armor' || !item.equipSlot || !item.equipSubSlot) return null;
    const key = `${item.equipSlot}:${item.equipSubSlot}`;
    const prev = this.getEquippedItem(key);
    this.equipped.set(key, item.id);
    return prev;
  }

  /** Equip by looking up an item ID via the item finder. */
  equipById(itemId: ItemId): InventoryItem | null {
    const item = this.findItem(itemId);
    if (!item) return null;
    return this.equip(item);
  }

  /** Unequip the item in the given sub-slot key. Returns the unequipped item. */
  unequip(key: string): InventoryItem | null {
    const prev = this.getEquippedItem(key);
    this.equipped.delete(key);
    return prev;
  }

  /**
   * Get the item currently equipped in a sub-slot key ("Slot:SubSlot").
   */
  getEquippedItem(key: string): InventoryItem | null {
    const id = this.equipped.get(key);
    if (id === undefined) return null;
    return this.findItem(id);
  }

  /** True if any item with the given id is currently equipped. */
  hasEquipped(itemId: ItemId): boolean {
    for (const id of this.equipped.values()) {
      if (id === itemId) return true;
    }
    return false;
  }

  /** True if the given item ID is currently equipped in any slot. */
  isEquipped(itemId: ItemId): boolean {
    return this.hasEquipped(itemId);
  }

  /** Sum all stat bonuses from currently equipped items. */
  getStatBonuses(): {
    constitution: number;
    strength: number;
    intelligence: number;
  } {
    let constitution = 0,
      strength = 0,
      intelligence = 0;
    for (const id of this.equipped.values()) {
      const item = this.findItem(id);
      if (item?.statBonus) {
        constitution += item.statBonus.constitution ?? 0;
        strength += item.statBonus.strength ?? 0;
        intelligence += item.statBonus.intelligence ?? 0;
      }
    }
    return { constitution, strength, intelligence };
  }
}
