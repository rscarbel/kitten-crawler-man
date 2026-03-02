export type ItemId =
  | 'health_potion'
  | 'enchanted_bigboi_boxers'
  | 'scroll_of_confusing_fog';

export type EquipSlot = 'Head' | 'Torso' | 'Legs' | 'Feet' | 'Hands';

export interface InventoryItem {
  id: ItemId;
  name: string;
  quantity: number;
  stackable: boolean;
  /** Only items with an action (e.g. potion, ability) may be placed in the hotbar. */
  canHotlist: boolean;
  type?: 'consumable' | 'armor';
  equipSlot?: EquipSlot;
  equipSubSlot?: string;
  description?: string;
  statBonus?: {
    constitution?: number;
    strength?: number;
    intelligence?: number;
  };
  /** References an active ability this item grants when equipped. */
  abilityId?: string;
}

const ITEM_DEF: Record<ItemId, Omit<InventoryItem, 'quantity'>> = {
  scroll_of_confusing_fog: {
    id: 'scroll_of_confusing_fog',
    name: 'Scroll of Confusing Fog',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'Summons a thick fog cloud around the caster. Any enemy caught inside the fog loses all sense of sight and cannot target any entity. Lasts INT × 5 seconds.',
  },
  health_potion: {
    id: 'health_potion',
    name: 'Health Potion',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
  },
  enchanted_bigboi_boxers: {
    id: 'enchanted_bigboi_boxers',
    name: 'Enchanted BigBoi Boxers',
    stackable: false,
    canHotlist: true,
    type: 'armor',
    equipSlot: 'Legs',
    equipSubSlot: 'Pants',
    statBonus: { constitution: 2 },
    abilityId: 'protective_shell',
    description:
      'Have you ever read an Incredible Hulk comic and thought to yourself, ' +
      'everything rips off of his body except his pants? No way. Well, spoiler alert. ' +
      "You're not wrong. Size-altering and were-creatures, such as the BigBoi are " +
      'required to wear enchanted, self-sizing items lest they wish to turn the dungeon ' +
      'into a nudist colony when they transform. That means everything they wear requires ' +
      'an enchantment. Everything, including their naughty little undies.',
  },
};

export const SLOT_COUNT = 32;
export const HOTBAR_COUNT = 8;
export const SLOTS_PER_PAGE = 16; // 4 × 4 grid

/** Sub-slots available in each equipment slot. */
export const EQUIP_SUBSLOTS: Record<EquipSlot, string[]> = {
  Head: ['Hat', 'Face', 'Neck'],
  Torso: ['Shirt', 'Jacket', 'Back'],
  Legs: ['Pants', 'Knee Pads'],
  Hands: ['Gloves', 'Ring 1', 'Ring 2', 'Ring 3', 'Ring 4'],
  Feet: ['Shoes', 'Toe Ring 1', 'Toe Ring 2', 'Toe Ring 3', 'Toe Ring 4'],
};

export class Inventory {
  readonly slots: (InventoryItem | null)[] = new Array(SLOT_COUNT).fill(null);
  readonly hotbar: (InventoryItem | null)[] = new Array(HOTBAR_COUNT).fill(
    null,
  );

  /**
   * Maps "Slot:SubSlot" key → ItemId of the equipped item.
   * e.g. "Legs:Pants" → 'enchanted_bigboi_boxers'. The item can be anywhere
   * (inventory slot OR hotbar) — getEquippedItem searches both.
   */
  readonly equipped: Map<string, ItemId> = new Map();

  /** Add `quantity` of the given item, stacking into an existing slot when possible. */
  addItem(id: ItemId, quantity: number): void {
    for (const arr of [this.slots, this.hotbar] as (InventoryItem | null)[][]) {
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (s && s.id === id && ITEM_DEF[id].stackable) {
          arr[i] = { ...s, quantity: s.quantity + quantity };
          return;
        }
      }
    }
    const empty = this.slots.findIndex((s) => s === null);
    if (empty !== -1) {
      this.slots[empty] = { ...ITEM_DEF[id], quantity };
    }
  }

  /**
   * Remove up to `qty` of the given item across hotbar and slots.
   * Removes from hotbar first, then inventory slots.
   */
  removeItems(id: ItemId, qty: number): void {
    let remaining = qty;
    for (const arr of [this.hotbar, this.slots] as (InventoryItem | null)[][]) {
      for (let i = 0; i < arr.length && remaining > 0; i++) {
        const s = arr[i];
        if (!s || s.id !== id) continue;
        if (s.quantity <= remaining) {
          remaining -= s.quantity;
          arr[i] = null;
        } else {
          arr[i] = { ...s, quantity: s.quantity - remaining };
          remaining = 0;
        }
      }
    }
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
    // No equipped-map update needed — equipped tracks by ItemId, not slot index.
  }

  swapHotbar(a: number, b: number): void {
    [this.hotbar[a], this.hotbar[b]] = [this.hotbar[b], this.hotbar[a]];
  }

  swapInvToHotbar(slotIdx: number, hotbarIdx: number): void {
    const inv = this.slots[slotIdx];
    if (inv && !inv.canHotlist) return;
    const hot = this.hotbar[hotbarIdx];
    this.hotbar[hotbarIdx] = inv;
    this.slots[slotIdx] = hot;
    // No equipped-map update needed — item keeps its equipped status by ID.
  }

  swapHotbarToInv(hotbarIdx: number, slotIdx: number): void {
    const hot = this.hotbar[hotbarIdx];
    const inv = this.slots[slotIdx];
    if (inv && !inv.canHotlist) return;
    this.slots[slotIdx] = hot;
    this.hotbar[hotbarIdx] = inv;
  }

  // ── Equipment ─────────────────────────────────────────────────────────────

  /** Find an item by ID across both slots and hotbar. */
  private findItemById(id: ItemId): InventoryItem | null {
    return (
      this.slots.find((s) => s?.id === id) ??
      this.hotbar.find((s) => s?.id === id) ??
      null
    );
  }

  /**
   * Equip the item at `slotIdx`. Records the item's ID in the equipped map so
   * it stays equipped regardless of where it is physically moved (slots/hotbar).
   * Returns the previously equipped item in that sub-slot (or null).
   */
  equip(slotIdx: number): InventoryItem | null {
    const item = this.slots[slotIdx];
    if (!item || item.type !== 'armor' || !item.equipSlot || !item.equipSubSlot)
      return null;
    const key = `${item.equipSlot}:${item.equipSubSlot}`;
    const prev = this.getEquippedItem(key);
    this.equipped.set(key, item.id);
    return prev;
  }

  /** Equip the first instance of `itemId` found in slots. */
  equipByItemId(itemId: ItemId): InventoryItem | null {
    const idx = this.slots.findIndex((s) => s?.id === itemId);
    if (idx === -1) return null;
    return this.equip(idx);
  }

  /** Unequip the item in the given sub-slot key. Returns the unequipped item. */
  unequip(key: string): InventoryItem | null {
    const prev = this.getEquippedItem(key);
    this.equipped.delete(key);
    return prev;
  }

  /**
   * Get the item currently equipped in a sub-slot key ("Slot:SubSlot").
   * Searches both slots and hotbar so the item can be moved freely.
   */
  getEquippedItem(key: string): InventoryItem | null {
    const id = this.equipped.get(key);
    if (id === undefined) return null;
    return this.findItemById(id);
  }

  /** True if the item at the given inventory slot index is currently equipped. */
  isSlotEquipped(slotIdx: number): boolean {
    const item = this.slots[slotIdx];
    if (!item) return false;
    for (const id of this.equipped.values()) {
      if (id === item.id) return true;
    }
    return false;
  }

  /** True if any item with the given id is currently equipped. */
  hasEquipped(itemId: ItemId): boolean {
    for (const id of this.equipped.values()) {
      if (id === itemId) return true;
    }
    return false;
  }

  /** Sum all stat bonuses from currently equipped items. */
  getEquippedStatBonus(): {
    constitution: number;
    strength: number;
    intelligence: number;
  } {
    let constitution = 0,
      strength = 0,
      intelligence = 0;
    for (const id of this.equipped.values()) {
      const item = this.findItemById(id);
      if (item?.statBonus) {
        constitution += item.statBonus.constitution ?? 0;
        strength += item.statBonus.strength ?? 0;
        intelligence += item.statBonus.intelligence ?? 0;
      }
    }
    return { constitution, strength, intelligence };
  }
}
