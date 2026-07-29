import type { StatName } from '../Player';
import { ALL_STATS } from '../Player';
import { ITEM_DEF, isItemId } from './ItemDefs';
import type { InventoryItem, ItemId } from './ItemDefs';

/** Callback to locate an item by ID across all storage (bag + hotbar). */
export type ItemFinder = (id: ItemId) => InventoryItem | null;

/** Summed stat bonuses contributed by everything currently worn. */
export type StatBonuses = Record<StatName, number>;

function emptyStatBonuses(): StatBonuses {
  return { strength: 0, intelligence: 0, constitution: 0, dexterity: 0 };
}

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
   *
   * Private so that snapshot restore and the tutorial reset go through
   * {@link replaceAll} / {@link clear} rather than reaching in.
   */
  private readonly equipped = new Map<string, ItemId>();

  constructor(private readonly findItem: ItemFinder) {}

  /**
   * Equip the given item. Records its ID in the equipped map.
   * Returns the previously equipped item in that sub-slot (or null).
   */
  equip(item: InventoryItem): InventoryItem | null {
    if (item.type !== 'armor' || !item.equipSlot || !item.equipSubSlot) return null;
    // Same reason as `replaceAll`: bag and hotbar slots are restored verbatim
    // from unvalidated save JSON, so an item carrying a since-retired id can
    // reach here through the ordinary equip path and would then crash
    // `getStatBonuses` on the next stat read.
    if (!isItemId(item.id)) return null;
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

  /** Remove every equipped item, leaving the wearer bare. */
  clear(): void {
    this.equipped.clear();
  }

  /** Serialisable view of the equipped set, for snapshots. */
  entries(): [string, ItemId][] {
    return [...this.equipped.entries()];
  }

  /**
   * Replace the whole equipped set from a snapshot's {@link entries} output.
   *
   * Ids are validated here even though the type claims they are `ItemId`: saves
   * arrive as unvalidated server JSON, and this is the one door they come
   * through. An id retired since the save was written would otherwise sit in the
   * map and crash {@link getStatBonuses} — which runs on every stat read — on
   * the next frame.
   */
  replaceAll(entries: ReadonlyArray<readonly [string, ItemId]>): void {
    this.equipped.clear();
    for (const [key, id] of entries) {
      if (isItemId(id)) this.equipped.set(key, id);
    }
  }

  /** The item ID equipped in a sub-slot key, or undefined when the slot is bare. */
  getEquippedId(key: string): ItemId | undefined {
    return this.equipped.get(key);
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

  /** Returns all currently equipped items (skipping any that can no longer be found). */
  equippedItems(): InventoryItem[] {
    const items: InventoryItem[] = [];
    for (const id of this.equipped.values()) {
      const item = this.findItem(id);
      if (item) items.push(item);
    }
    return items;
  }

  /**
   * Sum all stat bonuses from currently equipped items.
   *
   * Read straight from `ITEM_DEF` rather than through {@link findItem}, and
   * recomputed rather than memoised. Both choices are about this being on the
   * hot path: every read of a stat — and so of max HP, several times a frame per
   * crawler — lands here. `findItem` linearly scans the bag and hotbar, which is
   * pure waste given `statBonus` is per-definition and never per-instance; and a
   * cache keyed on the equipped map would go stale, because bag and hotbar slots
   * are written directly in several places (save restore, tutorial reset, the
   * AI's `remove_item`). What remains is a loop over a handful of worn items.
   */
  getStatBonuses(): StatBonuses {
    const totals = emptyStatBonuses();
    for (const id of this.equipped.values()) {
      const bonus = ITEM_DEF[id].statBonus;
      if (!bonus) continue;
      for (const stat of ALL_STATS) {
        totals[stat] += bonus[stat] ?? 0;
      }
    }
    return totals;
  }
}
