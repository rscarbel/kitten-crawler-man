import type { InventoryItem, ItemId } from './ItemDefs';
import { ITEM_DEF } from './ItemDefs';

/**
 * The action bar — a fixed-size array of hotbar slots.
 * Items here can be activated via number keys during gameplay.
 */
export class Hotbar {
  readonly slots: (InventoryItem | null)[];

  constructor(size: number) {
    this.slots = new Array(size).fill(null);
  }

  /** Try to stack `quantity` of `id` into an existing hotbar slot. Returns true if stacked. */
  stackInto(id: ItemId, quantity: number): boolean {
    if (!ITEM_DEF[id].stackable) return false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        this.slots[i] = { ...s, quantity: s.quantity + quantity };
        return true;
      }
    }
    return false;
  }

  /**
   * Remove up to `qty` of the given item. Returns the number still remaining
   * to remove (0 means fully satisfied).
   */
  removeFrom(id: ItemId, qty: number): number {
    let remaining = qty;
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      if (s.quantity <= remaining) {
        remaining -= s.quantity;
        this.slots[i] = null;
      } else {
        this.slots[i] = { ...s, quantity: s.quantity - remaining };
        remaining = 0;
      }
    }
    return remaining;
  }

  /** Remove one of the given item. Returns true if removed. */
  removeOne(id: ItemId): boolean {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      this.slots[i] = s.quantity > 1 ? { ...s, quantity: s.quantity - 1 } : null;
      return true;
    }
    return false;
  }

  /** Count of the given item across hotbar slots. */
  countOf(id: ItemId): number {
    let n = 0;
    for (const s of this.slots) {
      if (s?.id === id) n += s.quantity;
    }
    return n;
  }

  /** Find the first item with the given ID, or null. */
  findById(id: ItemId): InventoryItem | null {
    return this.slots.find((s) => s?.id === id) ?? null;
  }

  swap(a: number, b: number): void {
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
  }
}
