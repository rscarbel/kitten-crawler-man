import type { StatName } from '../Player';
import { ALL_STATS } from '../Player';
import { EQUIP_SUBSLOTS, ITEM_DEF, isItemId, itemFitsSubSlot } from './ItemDefs';
import type { EquipSlot, InventoryItem, ItemId, ResistanceType, WearableItem } from './ItemDefs';
import type { CrawlerKind, SkillId } from './SkillManager';

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

  constructor(
    private readonly findItem: ItemFinder,
    private readonly ownerKind: CrawlerKind | null = null,
  ) {}

  /**
   * Equip the given item, optionally into a caller-chosen `"Slot:SubSlot"` key.
   * Records its ID in the equipped map.
   * Returns the previously equipped item in that sub-slot (or null).
   */
  equip(item: InventoryItem, targetKey?: string): InventoryItem | null {
    if (!this.canEquip(item)) return null;
    const key = this.resolveSubSlotKey(item, item.equipSlot, item.equipSubSlot, targetKey);
    const prev = this.getEquippedItem(key);
    this.equipped.set(key, item.id);
    return prev;
  }

  /**
   * Whether {@link equip} would actually put this item on.
   *
   * Exists because `equip` returns `null` for two opposite outcomes — nothing was
   * displaced, and nothing was worn — and a caller that reads the second as the
   * first announces a change that never happened. Ask this first when a refusal
   * has to be told apart from a quiet success.
   */
  canEquip(item: InventoryItem): item is WearableItem {
    if (item.type !== 'armor' || !item.equipSlot || !item.equipSubSlot) return false;
    // Same reason as `replaceAll`: bag and hotbar slots are restored verbatim
    // from unvalidated save JSON, so an item carrying a since-retired id can
    // reach here through the ordinary equip path and would then crash
    // `getStatBonuses` on the next stat read.
    if (!isItemId(item.id)) return false;
    if (item.wearer && this.ownerKind !== null && item.wearer !== this.ownerKind) return false;
    // The equipped map is id-keyed, so the same id worn in two ring slots would
    // make every lookup ambiguous and leave one slot un-unequippable.
    return !this.isEquipped(item.id);
  }

  /**
   * The `"Slot:SubSlot"` key this item is actually worn in, or null when it is
   * not worn at all.
   *
   * Read out of the equipped map rather than rebuilt from the item's own
   * `equipSlot`/`equipSubSlot`, because a family item declares the family
   * (`Ring`) and is filed under a member of it (`Ring 2`). Rebuilding the key
   * from the declaration produces one no slot has ever held, so the item could
   * never be taken off again.
   */
  findEquippedKey(itemId: ItemId): string | null {
    for (const [key, id] of this.equipped) {
      if (id === itemId) return key;
    }
    return null;
  }

  /** Take off whichever slot is holding `itemId`. Returns the item removed. */
  unequipById(itemId: ItemId): InventoryItem | null {
    const key = this.findEquippedKey(itemId);
    if (key === null) return null;
    return this.unequip(key);
  }

  /**
   * Decide which sub-slot an item goes into.
   *
   * A caller-named target is honoured only when the item actually fits it, so a
   * mis-aimed drop lands somewhere valid rather than filing a hat under Shoes.
   * Otherwise an empty matching sub-slot wins, so a second ring lands beside the
   * first rather than on top of it; the fall-back to the first match preserves
   * the displace-in-place behaviour single-slot items have always had.
   */
  private resolveSubSlotKey(
    item: InventoryItem,
    slot: EquipSlot,
    declaredSubSlot: string,
    targetKey: string | undefined,
  ): string {
    const candidates = EQUIP_SUBSLOTS[slot].filter((subSlot) => itemFitsSubSlot(item, subSlot));
    if (targetKey !== undefined) {
      const targetSubSlot = candidates.find((subSlot) => `${slot}:${subSlot}` === targetKey);
      if (targetSubSlot !== undefined) return targetKey;
    }
    if (candidates.length === 0) return `${slot}:${declaredSubSlot}`;
    const empty = candidates.find((subSlot) => !this.equipped.has(`${slot}:${subSlot}`));
    return `${slot}:${empty ?? candidates[0]}`;
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

  /** True when anything worn resists the given damage channel. */
  hasResistance(type: ResistanceType): boolean {
    for (const id of this.equipped.values()) {
      if (ITEM_DEF[id].resistances?.includes(type) === true) return true;
    }
    return false;
  }

  /** Summed fraction of incoming mob melee damage sent back at the attacker. */
  getDamageReflectPct(): number {
    let total = 0;
    for (const id of this.equipped.values()) {
      total += ITEM_DEF[id].damageReflectPct ?? 0;
    }
    return total;
  }

  /** True when anything worn cancels momentum-based attacks on contact. */
  getCancelsMomentum(): boolean {
    for (const id of this.equipped.values()) {
      if (ITEM_DEF[id].cancelsMomentum === true) return true;
    }
    return false;
  }

  /** Summed effective-level bonus worn gear grants to the given skill. */
  getSkillLevelBonus(id: SkillId): number {
    let total = 0;
    for (const equippedId of this.equipped.values()) {
      total += ITEM_DEF[equippedId].skillLevelBonus?.[id] ?? 0;
    }
    return total;
  }

  /** Summed stat bonus that counts only toward melee damage, not the stat itself. */
  getMeleeOnlyStatBonus(stat: StatName): number {
    let total = 0;
    for (const id of this.equipped.values()) {
      total += ITEM_DEF[id].meleeOnlyStatBonus?.[stat] ?? 0;
    }
    return total;
  }

  /** Summed chance per landed melee hit to stun the target. */
  getStunOnHitChance(): number {
    let total = 0;
    for (const id of this.equipped.values()) {
      total += ITEM_DEF[id].stunOnHitChance ?? 0;
    }
    return total;
  }
}
