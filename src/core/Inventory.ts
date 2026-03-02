export type ItemId = 'health_potion' | 'enchanted_bigboi_boxers';

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
  statBonus?: { constitution?: number; strength?: number; intelligence?: number };
  /** References an active ability this item grants when equipped. */
  abilityId?: string;
}

const ITEM_DEF: Record<ItemId, Omit<InventoryItem, 'quantity'>> = {
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
      "Have you ever read an Incredible Hulk comic and thought to yourself, " +
      "everything rips off of his body except his pants? No way. Well, spoiler alert. " +
      "You're not wrong. Size-altering and were-creatures, such as the BigBoi are " +
      "required to wear enchanted, self-sizing items lest they wish to turn the dungeon " +
      "into a nudist colony when they transform. That means everything they wear requires " +
      "an enchantment. Everything, including their naughty little undies.",
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
  Hands: ['Gloves', ...Array.from({ length: 10 }, (_, i) => `Ring ${i + 1}`)],
  Feet: ['Shoes', ...Array.from({ length: 10 }, (_, i) => `Toe Ring ${i + 1}`)],
};

export class Inventory {
  readonly slots: (InventoryItem | null)[] = new Array(SLOT_COUNT).fill(null);
  readonly hotbar: (InventoryItem | null)[] = new Array(HOTBAR_COUNT).fill(null);

  /**
   * Maps "Slot:SubSlot" key → inventory slot index.
   * e.g. "Legs:Pants" → 1 means slots[1] is equipped in the Pants sub-slot.
   */
  readonly equipped: Map<string, number> = new Map();

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
    // Update equipped references
    for (const [key, idx] of this.equipped) {
      if (idx === a) this.equipped.set(key, b);
      else if (idx === b) this.equipped.set(key, a);
    }
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
  }

  swapHotbarToInv(hotbarIdx: number, slotIdx: number): void {
    const hot = this.hotbar[hotbarIdx];
    const inv = this.slots[slotIdx];
    if (inv && !inv.canHotlist) return;
    this.slots[slotIdx] = hot;
    this.hotbar[hotbarIdx] = inv;
  }

  // ── Equipment ─────────────────────────────────────────────────────────────

  /**
   * Equip the item at `slotIdx`. Returns the previously equipped item in that
   * sub-slot (or null), so the caller can handle stat swaps.
   */
  equip(slotIdx: number): InventoryItem | null {
    const item = this.slots[slotIdx];
    if (!item || item.type !== 'armor' || !item.equipSlot || !item.equipSubSlot) return null;
    const key = `${item.equipSlot}:${item.equipSubSlot}`;
    const prev = this.getEquippedItem(key);
    this.equipped.set(key, slotIdx);
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

  /** Get the item currently equipped in a sub-slot key ("Slot:SubSlot"). */
  getEquippedItem(key: string): InventoryItem | null {
    const idx = this.equipped.get(key);
    if (idx === undefined) return null;
    return this.slots[idx] ?? null;
  }

  /** True if the given inventory slot index is currently equipped somewhere. */
  isSlotEquipped(slotIdx: number): boolean {
    for (const [, idx] of this.equipped) {
      if (idx === slotIdx) return true;
    }
    return false;
  }

  /** True if any item with the given id is currently equipped. */
  hasEquipped(itemId: ItemId): boolean {
    for (const [, idx] of this.equipped) {
      if (this.slots[idx]?.id === itemId) return true;
    }
    return false;
  }

  /** Sum all stat bonuses from currently equipped items. */
  getEquippedStatBonus(): { constitution: number; strength: number; intelligence: number } {
    let constitution = 0, strength = 0, intelligence = 0;
    for (const [, idx] of this.equipped) {
      const item = this.slots[idx];
      if (item?.statBonus) {
        constitution += item.statBonus.constitution ?? 0;
        strength += item.statBonus.strength ?? 0;
        intelligence += item.statBonus.intelligence ?? 0;
      }
    }
    return { constitution, strength, intelligence };
  }
}
