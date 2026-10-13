import type { InventoryItem, ItemId } from './ItemDefs';
import { BAG_PAGE_SLOTS, ITEM_DEF } from './ItemDefs';

function emptyPage(): (InventoryItem | null)[] {
  return new Array<InventoryItem | null>(BAG_PAGE_SLOTS).fill(null);
}

/**
 * Raw item storage: an unbounded bag laid out in pages of
 * {@link BAG_PAGE_SLOTS} slots. Handles stacking, add/remove/count, and slot
 * swaps.
 *
 * The bag always ends in at least one empty slot, so an item always has
 * somewhere to go and a drag always has an empty slot to land on; it grows a
 * page when its last slot fills and sheds trailing pages that hold nothing.
 */
export class ItemBag {
  readonly slots: (InventoryItem | null)[] = emptyPage();

  /** Number of pages the bag spans. */
  get pageCount(): number {
    return Math.ceil(this.slots.length / BAG_PAGE_SLOTS);
  }

  /**
   * Restores the page invariant after the slots were written: a whole number
   * of pages, the last page holding something or being the only one, and at
   * least one empty slot.
   */
  fitPages(): void {
    let usedLength = 0;
    this.slots.forEach((item, index) => {
      if (item !== null) usedLength = index + 1;
    });
    const keptLength = Math.max(1, Math.ceil(usedLength / BAG_PAGE_SLOTS)) * BAG_PAGE_SLOTS;
    if (this.slots.length > keptLength) this.slots.length = keptLength;
    while (this.slots.length < keptLength) this.slots.push(null);
    if (!this.slots.includes(null)) this.slots.push(...emptyPage());
  }

  /** Replaces every slot, as a restore does, keeping any number of pages. */
  replaceAll(items: readonly (InventoryItem | null)[]): void {
    this.slots.length = 0;
    this.slots.push(...items);
    this.fitPages();
  }

  /** Empties the bag down to one blank page. */
  clear(): void {
    this.replaceAll([]);
  }

  /** Puts `item` in the first empty slot and returns that slot. */
  placeInFirstEmpty(item: InventoryItem): number {
    this.fitPages();
    const idx = this.slots.indexOf(null);
    this.slots[idx] = item;
    this.fitPages();
    return idx;
  }

  /** The first empty slot on `page`, or null when that page has none. */
  firstEmptyOnPage(page: number): number | null {
    const pageStart = page * BAG_PAGE_SLOTS;
    const pageEnd = Math.min(this.slots.length, pageStart + BAG_PAGE_SLOTS);
    for (let i = pageStart; i < pageEnd; i++) {
      if (this.slots[i] === null) return i;
    }
    return null;
  }

  /** Try to stack `quantity` of `id` into an existing slot. Returns true if stacked. */
  stackInto(id: ItemId, quantity: number): boolean {
    if (!ITEM_DEF[id].stackable) return false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s?.id === id) {
        this.slots[i] = { ...s, quantity: s.quantity + quantity };
        return true;
      }
    }
    return false;
  }

  /** Adds the item to the first empty slot, growing the bag a page when that was its last. */
  addToEmpty(id: ItemId, quantity: number): void {
    this.placeInFirstEmpty({ ...ITEM_DEF[id], quantity });
  }

  /** Adds `copies` one-item stacks of `id` to empty slots, growing the bag as far as they need. */
  addCopiesToEmpty(id: ItemId, copies: number): void {
    let placed = 0;
    for (let i = 0; i < this.slots.length && placed < copies; i++) {
      if (this.slots[i] !== null) continue;
      this.slots[i] = { ...ITEM_DEF[id], quantity: 1 };
      placed++;
    }
    for (; placed < copies; placed++) this.slots.push({ ...ITEM_DEF[id], quantity: 1 });
    this.fitPages();
  }

  /**
   * Remove up to `qty` of the given item. Returns the number still remaining
   * to remove (0 means fully satisfied).
   */
  removeFrom(id: ItemId, qty: number): number {
    let remaining = qty;
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const s = this.slots[i];
      if (s?.id !== id) continue;
      if (s.quantity <= remaining) {
        remaining -= s.quantity;
        this.slots[i] = null;
      } else {
        this.slots[i] = { ...s, quantity: s.quantity - remaining };
        remaining = 0;
      }
    }
    this.fitPages();
    return remaining;
  }

  /** Remove one of the given item. Returns true if removed. */
  removeOne(id: ItemId): boolean {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s?.id !== id) continue;
      this.slots[i] = s.quantity > 1 ? { ...s, quantity: s.quantity - 1 } : null;
      this.fitPages();
      return true;
    }
    return false;
  }

  /**
   * Remove one from `slotIdx`, but only if that slot still holds `id` — a click
   * and the frame that acts on it are far enough apart for the bag to have moved.
   */
  removeOneAt(slotIdx: number, id: ItemId): boolean {
    const slot = this.slots[slotIdx];
    if (slot?.id !== id) return false;
    this.slots[slotIdx] = slot.quantity > 1 ? { ...slot, quantity: slot.quantity - 1 } : null;
    this.fitPages();
    return true;
  }

  /** Total count of the given item across all slots. */
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

  /** Swaps two slots; an index outside the bag swaps nothing, so a stale one cannot grow it. */
  swap(a: number, b: number): void {
    if (!this.hasSlot(a) || !this.hasSlot(b)) return;
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
    this.fitPages();
  }

  /** Whether `index` names a slot the bag has. */
  hasSlot(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.slots.length;
  }
}
