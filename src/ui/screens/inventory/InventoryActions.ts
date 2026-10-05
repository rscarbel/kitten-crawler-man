/**
 * What an item in a crawler's pack offers, and the hand-off its choices leave
 * for the scene: each entry the inventory screen shows for a stack, and the
 * `pending*` fields a pick queues for `MenusKit.resolvePendingInventoryActions`
 * to resolve with the scene's drop target. Holds no layout and no input; the
 * inventory screen does all of that.
 */

import type { Inventory } from '../../../core/Inventory';
import type { InventoryItem, ItemId } from '../../../core/ItemDefs';
import type { SkillId } from '../../../core/SkillManager';

/** One stack in one of a crawler's two containers, and the item it held when picked. */
export interface PendingSlotRef {
  readonly source: 'inv' | 'hotbar';
  readonly slotIdx: number;
  readonly id: ItemId;
}

/**
 * An entry a system adds to an item's menu, beyond the actions every item of
 * its kind has. The bag knows nothing of what it does: the owning system
 * registers a provider, so village logic never lives in the inventory UI.
 */
export interface ExtraContextOption {
  readonly label: string;
  /** When set, the entry is shown disabled with this reason and does nothing when picked. */
  readonly disabledReason?: string;
  readonly run: () => void;
}

/** A skill book the player asked to read, before the prompt has confirmed it. */
export interface SkillBookReadRequest {
  readonly bookId: ItemId;
  readonly skillId: SkillId;
}

/** The stack a menu entry acts on. */
export interface MenuTarget {
  readonly source: 'inv' | 'hotbar';
  readonly slotIdx: number;
  readonly item: InventoryItem;
}

/** One menu entry: what to pass back, what to draw, and why it is disabled when it is. */
export interface MenuEntry {
  readonly action: string;
  readonly label: string;
  readonly disabledReason?: string;
}

/**
 * A Drop or Trade queued against a stack bigger than one, awaiting the
 * quantity the player actually wants. The host asks "how many?" in response
 * and writes the chosen amount back as {@link InventoryActions.pendingDropItem}
 * or {@link InventoryActions.pendingTradeItem}.
 */
export interface PendingQuantityPrompt {
  readonly kind: 'drop' | 'trade';
  readonly id: ItemId;
  readonly itemName: string;
  readonly maxQty: number;
}

/** The entry that only shows the item; it is never a game action. */
export const DESCRIPTION_ACTION = 'Description';

/**
 * The action an extra entry is matched under: its own label, or followed by
 * the reason it is unavailable, so a disabled extra never matches an enabled
 * one of the same name.
 */
function extraOptionAction(option: ExtraContextOption): string {
  return option.disabledReason === undefined
    ? option.label
    : `${option.label} ${option.disabledReason}`;
}

/**
 * The one action an item offers on its own, ahead of the generic entries. An
 * item has at most one: its own `menuUseLabel` (the anchor's Travel), or a
 * skill book is read, a tome is studied, a potion is drunk, a food is eaten;
 * everything else leads with the generic list.
 */
function leadOptionFor(item: InventoryItem): string[] {
  if (item.menuUseLabel !== undefined) return [item.menuUseLabel];
  if (item.skillId !== undefined) return ['Read'];
  if (item.explosivesHandlingLevels !== undefined) return ['Study'];
  if (item.drinkable === true) return ['Drink'];
  if (item.edible === true) return ['Eat'];
  return [];
}

export class InventoryActions {
  /** Set by "Equip"; the scene reads and clears it. */
  pendingEquipSlot: number | null = null;
  /** Which container the pending equip slot refers to. */
  pendingEquipSource: 'inv' | 'hotbar' | null = null;
  /** Set by "Unequip"; the scene reads and clears it. */
  pendingUnequipSlot: number | null = null;
  /** Which container the pending unequip slot refers to. */
  pendingUnequipSource: 'inv' | 'hotbar' | null = null;
  /**
   * A potion the player asked to drink from the bag, so a potion never has to
   * be parked in the hotbar first. Carries the slot, not just the id: the same
   * potion often sits in both containers, and it is the stack the player
   * pointed at that should go down. The scene decides who drinks: the bag on
   * screen is not always the active crawler's.
   */
  pendingDrinkSlot: PendingSlotRef | null = null;
  /** A food the player asked to eat; the same contract as {@link pendingDrinkSlot}. */
  pendingEatSlot: PendingSlotRef | null = null;
  pendingStudySlot: PendingSlotRef | null = null;
  /**
   * An item's own `menuUseLabel` entry. The scene runs whatever a hotbar press
   * of the item would.
   */
  pendingUseSlot: PendingSlotRef | null = null;
  /** A confirmed drop; the scene reads and clears it. */
  pendingDropItem: { id: ItemId; quantity: number } | null = null;
  /** A confirmed trade; the scene reads and clears it. */
  pendingTradeItem: { id: ItemId; quantity: number } | null = null;
  /** A skill book the player asked to read, awaiting the prompt's confirmation. */
  pendingSkillBookRead: SkillBookReadRequest | null = null;
  /** A Drop or Trade of a stack bigger than one, waiting on "how many?". */
  pendingQuantityPrompt: PendingQuantityPrompt | null = null;

  /**
   * Host-supplied test for whether `item` could be handed to the other
   * crawler right now. Null hides the Trade entry entirely: a bag with no
   * partner to trade with offers no entry with nothing to do.
   */
  canTradeItem: ((item: InventoryItem) => boolean) | null = null;

  /** Extra entries a system offers for an item (a tool's "Summon Thrall"), or null when none registered. */
  extraContextOptions: ((item: InventoryItem) => readonly ExtraContextOption[]) | null = null;

  /** Drops a "how many?" still waiting, so it cannot outlive the screen it was asked from. */
  closeSubmenus(): void {
    this.pendingQuantityPrompt = null;
  }

  private extrasFor(item: InventoryItem): readonly ExtraContextOption[] {
    return this.extraContextOptions?.(item) ?? [];
  }

  /** The action of every entry `item` offers from `source`, in menu order. */
  contextMenuOptions(
    item: InventoryItem,
    source: 'inv' | 'hotbar',
    isEquipped?: boolean,
  ): string[] {
    // The item's own action leads: it is what the player opened the menu for,
    // and putting it anywhere but first would sit Drop next to the common action.
    // A system's extras follow it, ahead of the generic entries, for the same reason.
    const lead = [...leadOptionFor(item), ...this.extrasFor(item).map(extraOptionAction)];
    // Undroppable items (permanent quest gear like the Wayfinder's Anchor, the
    // ability tomes) can still be repositioned freely — only the option to
    // discard them into the world is missing.
    const drop = item.canDrop === false ? [] : ['Drop'];
    const trade = this.canTradeItem?.(item) === true ? ['Trade'] : [];
    const equip = item.type === 'armor' ? [isEquipped === true ? 'Unequip' : 'Equip'] : [];
    const moveToBag = source === 'hotbar' ? ['Move to Bag'] : [];
    return [...lead, ...equip, ...moveToBag, DESCRIPTION_ACTION, ...trade, ...drop];
  }

  /**
   * Every entry {@link contextMenuOptions} offers, with the label it is drawn
   * under kept apart from the reason a system's extra cannot be used right
   * now. `action` is what {@link chooseOption} takes.
   */
  menuEntries(item: InventoryItem, source: 'inv' | 'hotbar', isEquipped?: boolean): MenuEntry[] {
    const extras = this.extrasFor(item);
    return this.contextMenuOptions(item, source, isEquipped).map((action) => {
      const extra = extras.find((option) => extraOptionAction(option) === action);
      return extra === undefined
        ? { action, label: action }
        : { action, label: extra.label, disabledReason: extra.disabledReason };
    });
  }

  /**
   * Acts on one of {@link contextMenuOptions}'s entries for the stack at
   * `target`: queues the matching `pending*` hand-off for the scene to
   * resolve, or, for a system's extra, runs it. Description is the screen's
   * own business and does nothing here.
   */
  chooseOption(action: string, target: MenuTarget, inventory: Inventory): void {
    const { source, slotIdx, item } = target;
    const slotRef: PendingSlotRef = { source, slotIdx, id: item.id };
    const extra = this.extrasFor(item).find((option) => extraOptionAction(option) === action);
    if (extra !== undefined) {
      if (extra.disabledReason === undefined) extra.run();
    } else if (action === item.menuUseLabel) {
      this.pendingUseSlot = slotRef;
    } else if (action === 'Read') {
      if (item.skillId !== undefined) {
        this.pendingSkillBookRead = { bookId: item.id, skillId: item.skillId };
      }
    } else if (action === 'Drink') {
      this.pendingDrinkSlot = slotRef;
    } else if (action === 'Eat') {
      this.pendingEatSlot = slotRef;
    } else if (action === 'Study') {
      this.pendingStudySlot = slotRef;
    } else if (action === 'Equip') {
      this.pendingEquipSlot = slotIdx;
      this.pendingEquipSource = source;
    } else if (action === 'Unequip') {
      this.pendingUnequipSlot = slotIdx;
      this.pendingUnequipSource = source;
    } else if (action === 'Move to Bag') {
      inventory.moveHotbarToFirstEmptySlot(slotIdx);
    } else if (action === 'Drop' || action === 'Trade') {
      const container = source === 'hotbar' ? inventory.actionBar : inventory.bag;
      const live = container.slots[slotIdx] ?? null;
      if (live !== null) this.queueQuantityAction(action === 'Drop' ? 'drop' : 'trade', live);
    }
  }

  /** A Drop or Trade of one goes straight through; a bigger stack asks how many first. */
  private queueQuantityAction(kind: 'drop' | 'trade', item: InventoryItem): void {
    if (item.stackable && item.quantity > 1) {
      this.pendingQuantityPrompt = {
        kind,
        id: item.id,
        itemName: item.name,
        maxQty: item.quantity,
      };
    } else if (kind === 'drop') {
      this.pendingDropItem = { id: item.id, quantity: 1 };
    } else {
      this.pendingTradeItem = { id: item.id, quantity: 1 };
    }
  }
}
