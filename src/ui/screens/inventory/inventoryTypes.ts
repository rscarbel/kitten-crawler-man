/**
 * What the inventory screen needs from the scene that mounts it: whose packs
 * it can show, the coins, cooldowns, the tutorial's restrictions, and the
 * `pending*` hand-off the scene resolves.
 */

import type { InventoryItem, ItemCategory, ItemId } from '../../../core/ItemDefs';
import type { CrawlerKind } from '../../../core/SkillManager';
import type { Player } from '../../../Player';
import type { InventoryActions } from './InventoryActions';

export type InventoryTab = 'bag' | 'character';

/** A crawler whose pack the screen shows. `HumanPlayer` and `CatPlayer` both satisfy it. */
export type InventoryOwner = Pick<
  Player,
  'inventory' | 'strength' | 'intelligence' | 'constitution' | 'dexterity' | 'onEquipmentChanged'
>;

export interface InventoryMember {
  readonly id: CrawlerKind;
  /** What the companion switcher calls them. */
  readonly name: string;
  readonly owner: InventoryOwner;
  /** The weapon in hand, marked as worn in the hotbar row. */
  readonly wieldedWeaponId?: ItemId | null;
}

/**
 * Narrowing a guided tutorial step puts on the bag: the one item that may be
 * dragged, the one hotbar slot it may land in, items that refuse to move at
 * all, and whether the context menu may open.
 */
export interface InventoryRestrictions {
  readonly allowedSource?: ItemId | null;
  readonly allowedHotbarTarget?: number | null;
  readonly blockedItems?: readonly ItemId[];
  readonly contextMenu: boolean;
}

export const NO_RESTRICTIONS: InventoryRestrictions = { contextMenu: true };

/** A cooldown still running on an item's hotbar use, in frames. */
export interface ItemCooldown {
  readonly current: number;
  readonly max: number;
}

export interface InventoryScreenHost {
  /** Holds the `pending*` hand-off and the context-menu entries every item offers. */
  readonly actions: InventoryActions;
  /** The crawlers whose packs can be shown, the active one first. */
  party(): readonly InventoryMember[];
  coins(): number;
  /** Each crawler's share of the coins, shown when the coins are hovered. */
  coinSplit?(): string | null;
  /** The cooldown still running on `item`'s hotbar use, or null when it is ready. */
  cooldownFor?(item: InventoryItem): ItemCooldown | null;
  restrictions?(): InventoryRestrictions;
  /** A blocked item was dragged and let go somewhere other than where it started. */
  onBlockedDrag?(): void;
  /** An item with no hotbar use was offered to the hotbar. */
  onHotbarRefused?(item: InventoryItem, reason: string): void;
  /** An item action queued a `pending*` hand-off for the scene to resolve. */
  onActionQueued?(): void;
  /** The screen closed, by any route. */
  onClosed?(): void;
}

export type BagFilter = 'all' | ItemCategory;

/** Where a selected or dragged stack sits. */
export type StackSource = 'inv' | 'hotbar';

export interface StackRef {
  readonly source: StackSource;
  readonly slotIdx: number;
  /** The item it held when picked, so a stack that has since moved is not acted on. */
  readonly id: ItemId;
}

export interface OpenOptions {
  readonly tab?: InventoryTab;
  /** Whose pack to show; the active crawler when omitted. */
  readonly member?: CrawlerKind;
  /** Draws a back chevron that closes the screen and calls this (the pause menu's entry). */
  readonly onBack?: () => void;
}
