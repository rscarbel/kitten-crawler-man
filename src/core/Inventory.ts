import { ItemBag } from './ItemBag';
import { Hotbar } from './Hotbar';
import { EquipmentManager, type StatBonuses } from './EquipmentManager';
import { SLOT_COUNT, HOTBAR_COUNT, QUEST_SLOT_IDX, ITEM_DEF, itemCanHotlist } from './ItemDefs';
import type { InventoryItem, ItemId } from './ItemDefs';
import type { CrawlerKind } from './SkillManager';

export class Inventory {
  readonly bag: ItemBag;
  readonly actionBar: Hotbar;
  readonly equipment: EquipmentManager;

  constructor(ownerKind: CrawlerKind | null = null) {
    this.bag = new ItemBag(SLOT_COUNT);
    this.actionBar = new Hotbar(HOTBAR_COUNT);
    this.equipment = new EquipmentManager((id) => this.findItemById(id), ownerKind);
  }

  // ── Item storage (delegates to bag + actionBar) ──

  /** Add `quantity` of the given item, stacking into an existing slot when possible. */
  addItem(id: ItemId, quantity: number): void {
    // Quest items always go to the reserved quest slot (last hotbar slot)
    if (ITEM_DEF[id].isQuestItem) {
      this.addToQuestSlot(id, quantity);
      return;
    }
    if (this.actionBar.stackInto(id, quantity)) return;
    if (this.bag.stackInto(id, quantity)) return;
    this.bag.addToEmpty(id, quantity);
  }

  /**
   * Whether {@link addItem} would actually store this item. `addItem` drops
   * silently when there is nowhere to put the thing, so any caller that cannot
   * afford to lose the item has to ask first.
   */
  hasRoomFor(id: ItemId): boolean {
    if (ITEM_DEF[id].isQuestItem) return true;
    if (ITEM_DEF[id].stackable && this.findItemById(id) !== null) return true;
    return this.bag.slots.includes(null);
  }

  /** Place a quest item directly into the reserved quest slot. */
  private addToQuestSlot(id: ItemId, quantity: number): void {
    const slot = this.actionBar.slots[QUEST_SLOT_IDX];
    if (slot?.id === id) {
      // Stack onto existing
      this.actionBar.slots[QUEST_SLOT_IDX] = { ...slot, quantity: slot.quantity + quantity };
    } else {
      // Place fresh
      const def = ITEM_DEF[id];
      this.actionBar.slots[QUEST_SLOT_IDX] = {
        ...def,
        quantity,
      };
    }
  }

  /**
   * Move the held stack of `id` onto `hotbarIdx`, wherever it currently sits.
   * Grants must still go through {@link addItem} — this only relocates what is
   * already held, so a stackable item can never be split into a second stack by
   * a caller that wants it on the bar.
   *
   * @returns false when the item is not held, or the bar refused it.
   */
  placeOnHotbar(id: ItemId, hotbarIdx: number): boolean {
    if (hotbarIdx === QUEST_SLOT_IDX) return false;
    if (this.actionBar.slots[hotbarIdx]?.id === id) return true;

    const barIdx = this.actionBar.slots.findIndex((s) => s?.id === id);
    if (barIdx !== -1) {
      this.swapHotbar(barIdx, hotbarIdx);
    } else {
      const bagIdx = this.bag.slots.findIndex((s) => s?.id === id);
      if (bagIdx === -1) return false;
      this.swapInvToHotbar(bagIdx, hotbarIdx);
    }
    return this.actionBar.slots[hotbarIdx]?.id === id;
  }

  /**
   * Fold every duplicate stack of a stackable item into the first slot holding
   * it, so an id occupies exactly one slot across the hotbar and the bag.
   *
   * Saves written before stacks were kept unique still carry split stacks, and
   * the player has no manual way to rejoin them, so a restore has to repair
   * them on the way in.
   */
  consolidateStacks(): void {
    const firstHome = new Map<ItemId, { slots: (InventoryItem | null)[]; index: number }>();
    for (const slots of [this.actionBar.slots, this.bag.slots]) {
      for (let i = 0; i < slots.length; i++) {
        const item = slots[i];
        if (!item || !ITEM_DEF[item.id].stackable) continue;
        // Quest items are stackable but live in the reserved slot that
        // addToQuestSlot owns; folding them by position could empty it.
        if (ITEM_DEF[item.id].isQuestItem) continue;

        const home = firstHome.get(item.id);
        if (home === undefined) {
          firstHome.set(item.id, { slots, index: i });
          continue;
        }
        const kept = home.slots[home.index];
        if (!kept) continue;
        home.slots[home.index] = { ...kept, quantity: kept.quantity + item.quantity };
        slots[i] = null;
      }
    }
  }

  /**
   * Pour the source slot into the destination when both hold the same stackable
   * item, leaving the source empty. Returns false when the two cannot combine,
   * in which case the caller should fall back to swapping them.
   */
  private mergeStacks(
    from: (InventoryItem | null)[],
    fromIdx: number,
    to: (InventoryItem | null)[],
    toIdx: number,
  ): boolean {
    // A slot dropped back onto itself would double its own count and then null
    // the slot out, so the identity case has to be refused before anything else.
    if (from === to && fromIdx === toIdx) return false;
    const source = from[fromIdx];
    const dest = to[toIdx];
    if (!source || !dest) return false;
    if (source.id !== dest.id || !ITEM_DEF[source.id].stackable) return false;
    to[toIdx] = { ...dest, quantity: dest.quantity + source.quantity };
    from[fromIdx] = null;
    return true;
  }

  /** Clear the reserved quest slot (call when quest ends). */
  clearQuestSlot(): void {
    this.actionBar.slots[QUEST_SLOT_IDX] = null;
  }

  /**
   * Remove up to `qty` of the given item across hotbar and slots.
   * Removes from hotbar first, then inventory slots.
   */
  removeItems(id: ItemId, qty: number): void {
    const remaining = this.actionBar.removeFrom(id, qty);
    if (remaining > 0) {
      this.bag.removeFrom(id, remaining);
    }
  }

  /**
   * Remove one of the given item, checking the hotbar before inventory.
   * Returns true if an item was successfully consumed.
   */
  removeOne(id: ItemId): boolean {
    return this.actionBar.removeOne(id) || this.bag.removeOne(id);
  }

  /**
   * Remove one from the exact slot the player pointed at, rather than the first
   * copy anywhere. Without this, using a bag stack while the same potion also
   * sits in the hotbar would silently drain the hotbar one instead.
   *
   * @returns false when that slot no longer holds `id`.
   */
  removeOneFromSlot(source: 'inv' | 'hotbar', slotIdx: number, id: ItemId): boolean {
    return source === 'hotbar'
      ? this.actionBar.removeOneAt(slotIdx, id)
      : this.bag.removeOneAt(slotIdx, id);
  }

  /** Total count across all inventory slots and hotbar. */
  countOf(id: ItemId): number {
    return this.bag.countOf(id) + this.actionBar.countOf(id);
  }

  // ── Slot management ──

  swapSlots(a: number, b: number): void {
    if (this.mergeStacks(this.bag.slots, a, this.bag.slots, b)) return;
    this.bag.swap(a, b);
  }

  swapHotbar(a: number, b: number): void {
    // Block swapping into or out of the quest slot
    if (a === QUEST_SLOT_IDX || b === QUEST_SLOT_IDX) return;
    if (this.mergeStacks(this.actionBar.slots, a, this.actionBar.slots, b)) return;
    this.actionBar.swap(a, b);
  }

  swapInvToHotbar(slotIdx: number, hotbarIdx: number): void {
    // Block swapping into the quest slot
    if (hotbarIdx === QUEST_SLOT_IDX) return;
    const inv = this.bag.slots[slotIdx];
    if (inv && !itemCanHotlist(inv.id)) return;
    if (this.mergeStacks(this.bag.slots, slotIdx, this.actionBar.slots, hotbarIdx)) return;
    const hot = this.actionBar.slots[hotbarIdx];
    this.actionBar.slots[hotbarIdx] = inv;
    this.bag.slots[slotIdx] = hot;
  }

  swapHotbarToInv(hotbarIdx: number, slotIdx: number): void {
    // Block swapping out of the quest slot
    if (hotbarIdx === QUEST_SLOT_IDX) return;
    // No itemCanHotlist guard here: the player is dragging OUT of the hotbar,
    // and grandfathered gear that predates the hotlist restriction must stay
    // freely movable off the hotbar even when the bag slot it lands on is
    // occupied by another non-hotlistable item swapping back in as a side
    // effect. Only the deliberate bag→hotbar direction (swapInvToHotbar)
    // refuses.
    if (this.mergeStacks(this.actionBar.slots, hotbarIdx, this.bag.slots, slotIdx)) return;
    const hot = this.actionBar.slots[hotbarIdx];
    const inv = this.bag.slots[slotIdx];
    this.bag.slots[slotIdx] = hot;
    this.actionBar.slots[hotbarIdx] = inv;
  }

  moveHotbarToFirstEmptySlot(hotbarIdx: number): boolean {
    const item = this.actionBar.slots[hotbarIdx];
    if (!item) return false;
    // A bag stack of the same thing is a better home than an empty slot: two
    // stacks of one id is a state the player cannot undo by hand.
    const sameStackIdx = this.bag.slots.findIndex((s) => s?.id === item.id);
    if (this.mergeStacks(this.actionBar.slots, hotbarIdx, this.bag.slots, sameStackIdx))
      return true;
    const emptyIdx = this.bag.slots.indexOf(null);
    if (emptyIdx === -1) return false;
    this.bag.slots[emptyIdx] = item;
    this.actionBar.slots[hotbarIdx] = null;
    return true;
  }

  // ── Equipment (delegates to EquipmentManager) ──

  /** Find an item by ID across both bag and hotbar. */
  private findItemById(id: ItemId): InventoryItem | null {
    return this.bag.findById(id) ?? this.actionBar.findById(id) ?? null;
  }

  /**
   * Equip the item at `slotIdx` in the bag. Records the item's ID in the
   * equipped map so it stays equipped regardless of physical location.
   *
   * `targetKey` names the `"Slot:SubSlot"` the player aimed at, for a screen
   * where they can point at one ring finger rather than any of them; it is
   * honoured only when the item actually fits there.
   *
   * Returns the previously equipped item in that sub-slot (or null).
   */
  equip(slotIdx: number, targetKey?: string): InventoryItem | null {
    const item = this.bag.slots[slotIdx];
    if (!item) return null;
    return this.equipment.equip(item, targetKey);
  }

  /**
   * Equip the item at `hotbarIdx` in the action bar. The item stays in the
   * hotbar; equipped state is tracked by item ID, not slot location.
   * Returns the previously equipped item in that sub-slot (or null).
   */
  equipHotbarSlot(hotbarIdx: number): InventoryItem | null {
    const item = this.actionBar.slots[hotbarIdx];
    if (!item) return null;
    return this.equipment.equip(item);
  }

  /** Equip the first instance of `itemId` found in bag slots. */
  equipByItemId(itemId: ItemId): InventoryItem | null {
    const idx = this.bag.slots.findIndex((s) => s?.id === itemId);
    if (idx === -1) return null;
    return this.equip(idx);
  }

  /** Unequip the item in the given sub-slot key. Returns the unequipped item. */
  unequip(key: string): InventoryItem | null {
    return this.equipment.unequip(key);
  }

  /**
   * Take off whichever slot is holding `itemId`. Returns the item removed, or
   * null when it was not worn.
   */
  unequipById(itemId: ItemId): InventoryItem | null {
    return this.equipment.unequipById(itemId);
  }

  /** Whether {@link equip} on this bag slot would actually put the item on. */
  canEquipSlot(slotIdx: number): boolean {
    const item = this.bag.slots[slotIdx];
    if (!item) return false;
    return this.equipment.canEquip(item);
  }

  /** Whether {@link equipHotbarSlot} would actually put the item on. */
  canEquipHotbarSlot(hotbarIdx: number): boolean {
    const item = this.actionBar.slots[hotbarIdx];
    if (!item) return false;
    return this.equipment.canEquip(item);
  }

  /** Get the item currently equipped in a sub-slot key ("Slot:SubSlot"). */
  getEquippedItem(key: string): InventoryItem | null {
    return this.equipment.getEquippedItem(key);
  }

  /** True if the item at the given inventory slot index is currently equipped. */
  isSlotEquipped(slotIdx: number): boolean {
    const item = this.bag.slots[slotIdx];
    if (!item) return false;
    return this.equipment.isEquipped(item.id);
  }

  /** True if any item with the given id is currently equipped. */
  hasEquipped(itemId: ItemId): boolean {
    return this.equipment.hasEquipped(itemId);
  }

  /** Returns all currently equipped items. */
  equippedItems(): InventoryItem[] {
    return this.equipment.equippedItems();
  }

  /** Sum all stat bonuses from currently equipped items. */
  getEquippedStatBonus(): StatBonuses {
    return this.equipment.getStatBonuses();
  }
}
