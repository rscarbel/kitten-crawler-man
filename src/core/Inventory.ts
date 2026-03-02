export type ItemId = 'health_potion';

export interface InventoryItem {
  id: ItemId;
  name: string;
  quantity: number;
  stackable: boolean;
  /** Only items with an action (e.g. potion) may be placed in the hotbar. */
  canHotlist: boolean;
}

const ITEM_DEF: Record<ItemId, Omit<InventoryItem, 'quantity'>> = {
  health_potion: {
    id: 'health_potion',
    name: 'Health Potion',
    stackable: true,
    canHotlist: true,
  },
};

export const SLOT_COUNT = 32;
export const HOTBAR_COUNT = 8;
export const SLOTS_PER_PAGE = 16; // 4 × 4 grid

export class Inventory {
  readonly slots: (InventoryItem | null)[] = new Array(SLOT_COUNT).fill(null);
  readonly hotbar: (InventoryItem | null)[] = new Array(HOTBAR_COUNT).fill(null);

  /** Add `quantity` of the given item, stacking into an existing slot when possible. */
  addItem(id: ItemId, quantity: number): void {
    // Try to stack with existing item in inventory slots first, then hotbar
    for (const arr of [this.slots, this.hotbar] as (InventoryItem | null)[][]) {
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (s && s.id === id && ITEM_DEF[id].stackable) {
          arr[i] = { ...s, quantity: s.quantity + quantity };
          return;
        }
      }
    }
    // Place in first empty inventory slot
    const empty = this.slots.findIndex((s) => s === null);
    if (empty !== -1) {
      this.slots[empty] = { ...ITEM_DEF[id], quantity };
    }
    // If inventory is full the item is silently lost — expand SLOT_COUNT if needed
  }

  /**
   * Remove one of the given item, checking the hotbar before inventory.
   * Returns true if an item was successfully consumed.
   */
  removeOne(id: ItemId): boolean {
    for (const arr of [this.hotbar, this.slots] as (InventoryItem | null)[][]) {
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (!s || s.id !== id) continue;
        arr[i] = s.quantity > 1 ? { ...s, quantity: s.quantity - 1 } : null;
        return true;
      }
    }
    return false;
  }

  /** Total count across all inventory slots and hotbar. */
  countOf(id: ItemId): number {
    let n = 0;
    for (const s of [...this.slots, ...this.hotbar]) {
      if (s?.id === id) n += s.quantity;
    }
    return n;
  }

  swapSlots(a: number, b: number): void {
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
  }

  swapHotbar(a: number, b: number): void {
    [this.hotbar[a], this.hotbar[b]] = [this.hotbar[b], this.hotbar[a]];
  }

  /**
   * Swap an inventory slot with a hotbar slot.
   * Refuses if the inventory item cannot be hotlisted.
   */
  swapInvToHotbar(slotIdx: number, hotbarIdx: number): void {
    const inv = this.slots[slotIdx];
    if (inv && !inv.canHotlist) return;
    const hot = this.hotbar[hotbarIdx];
    this.hotbar[hotbarIdx] = inv;
    this.slots[slotIdx] = hot;
  }

  /** Swap a hotbar slot back to an inventory slot (reverse of swapInvToHotbar). */
  swapHotbarToInv(hotbarIdx: number, slotIdx: number): void {
    const hot = this.hotbar[hotbarIdx];
    const inv = this.slots[slotIdx];
    // If the inventory item can't go into the hotbar, don't allow the swap
    if (inv && !inv.canHotlist) return;
    this.slots[slotIdx] = hot;
    this.hotbar[hotbarIdx] = inv;
  }
}
