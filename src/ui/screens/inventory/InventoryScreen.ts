/**
 * The inventory screen: the Bag tab (category rail, filtered and sorted grid,
 * capacity, the in-panel hotbar row, a detail pane) and the Character tab
 * (paper doll, stats, the gear that fits the chosen slot).
 *
 * This class owns the screen's state and every action it can take; drawing
 * and hit regions live in `renderInventory`. Item actions that belong to the
 * scene (drink, equip from the menu, drop, trade, read) are queued on the
 * host's `InventoryActions` as its `pending*` hand-off for the scene to resolve.
 */

import type { SoundId } from '../../../audio/sounds';
import { type BagSortMode } from '../../../core/bagSort';
import type { Inventory } from '../../../core/Inventory';
import {
  HOTBAR_COUNT,
  QUEST_SLOT_IDX,
  isWearable,
  itemCanHotlist,
  type InventoryItem,
  type ItemId,
} from '../../../core/ItemDefs';
import { HOTBAR_ACTIONS, keybindings } from '../../../core/Keybindings';
import type { Rect } from '../../core/geom';
import type { KeyModifiers, Surface } from '../../core/UiRoot';
import { UI_ERROR_SOUND } from '../../core/UiRoot';
import { DESCRIPTION_ACTION, type MenuEntry, type MenuTarget } from './InventoryActions';
import { SearchInput } from '../../widgets/searchField';
import { ALREADY_WORN_REFUSAL, equipRefusal, slotFitRefusal } from './gearRules';
import {
  NO_RESTRICTIONS,
  type BagFilter,
  type InventoryMember,
  type InventoryRestrictions,
  type InventoryScreenHost,
  type InventoryTab,
  type OpenOptions,
  type StackRef,
} from './inventoryTypes';
import { renderInventory } from './renderInventory';

/** Above this share of slots used, the capacity meter warns. */
export const BAG_NEARLY_FULL_FRACTION = 0.8;

/** Two taps on one slot within this long run its lead action. */
export const DOUBLE_TAP_MS = 350;
/** A touch held still this long on a slot opens its context menu. */
export const LONG_PRESS_MS = 500;
/** A touch must rest this long on a slot before moving it picks the item up rather than scrolling. */
export const TOUCH_PICKUP_HOLD_MS = 200;
/** How long a refusal stays under the item it was about. */
export const NOTICE_MS = 2000;

/** Menu entries every item offers that are never its own lead action. */
const GENERIC_ACTIONS: ReadonlySet<string> = new Set([
  'Move to Bag',
  DESCRIPTION_ACTION,
  'Trade',
  'Drop',
]);

const ARROW_STEPS: ReadonlyMap<string, 'left' | 'right' | 'up' | 'down'> = new Map([
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
  ['ArrowUp', 'up'],
  ['ArrowDown', 'down'],
] as const);

export const WEARABLE_HOTBAR_REASON = 'Gear is worn, not used. Put it on from the Character tab.';
export const UNUSABLE_HOTBAR_REASON = 'Only items you can use go on the hotbar.';
const TUTORIAL_HOTBAR_REASON = 'Not right now.';
const TUTORIAL_LOCK_REASON = 'Finish moving the item first.';

/** Why an item may not go on the hotbar, or null when it may. */
export function hotbarRefusal(item: InventoryItem): string | null {
  if (itemCanHotlist(item.id)) return null;
  return isWearable(item) ? WEARABLE_HOTBAR_REASON : UNUSABLE_HOTBAR_REASON;
}

/**
 * The selected stack, or (with `id` null) the keyboard cursor resting on an
 * empty bag slot.
 */
export interface Selection {
  readonly source: StackRef['source'];
  readonly slotIdx: number;
  readonly id: ItemId | null;
}

/** What a drag picked up, and where from. */
export interface DragState {
  readonly from: 'inv' | 'hotbar' | 'doll';
  readonly slotIdx: number;
  readonly dollKey: string | null;
  readonly item: InventoryItem;
  x: number;
  y: number;
}

export type MenuState =
  | { readonly kind: 'item'; readonly target: MenuTarget; readonly at: Point }
  | { readonly kind: 'sort'; readonly at: Point }
  | { readonly kind: 'party'; readonly at: Point };

export interface Point {
  readonly x: number;
  readonly y: number;
}

interface PressState {
  readonly id: string;
  readonly at: number;
  readonly point: Point;
  fired: boolean;
}

/** Where each control was drawn last frame, for resolving drops and for the tutorial's highlights. */
export interface FrameGeometry {
  /** The panel's outer frame. */
  frame: Rect | null;
  readonly bagCells: Map<number, Rect>;
  readonly hotbarCells: Map<number, Rect>;
  readonly dollCells: Map<string, Rect>;
  grid: Rect | null;
  columns: number;
  /** The grid's cells, in the order shown, by bag slot. */
  order: number[];
}

function emptyGeometry(): FrameGeometry {
  return {
    frame: null,
    bagCells: new Map(),
    hotbarCells: new Map(),
    dollCells: new Map(),
    grid: null,
    columns: 1,
    order: [],
  };
}

export class InventoryScreen {
  readonly surface: Surface;

  /** @internal Read by the renderer. */
  open_ = false;
  tab: InventoryTab = 'bag';
  filter: BagFilter = 'all';
  sort: BagSortMode = 'manual';
  readonly search = new SearchInput();
  selection: Selection | null = null;
  /** The doll cell whose fitting gear the Character grid is narrowed to. */
  dollKey: string | null = null;
  /** The phone's detail sheet is up. */
  sheetOpen = false;
  hotbarPickerOpen = false;
  menu: MenuState | null = null;
  drag: DragState | null = null;
  /** A touch swipe on the grid that scrolls it rather than moving an item. */
  scrollDrag: { from: number } | null = null;
  /** Where the next frame should put the grid's scroll. */
  scrollTarget: number | null = null;
  /** The slot the next frame should scroll into view. */
  reveal: number | null = null;
  /** The grid's scroll offset last frame. */
  gridOffset = 0;
  /** The selection was made from the keyboard, so Enter acts on it. */
  keyboardSelection = false;
  notice: { text: string; until: number; id: ItemId | null } | null = null;
  /** Upgrades not yet looked at in this opening; each keeps its badge until it is. */
  readonly freshUpgrades = new Set<ItemId>();
  geometry: FrameGeometry = emptyGeometry();
  /** Milliseconds, as of the last frame drawn. */
  now = 0;
  /** The density last frame, so input handlers outside render know touch from mouse. */
  touch = false;
  compact = false;
  backHandler: (() => void) | null = null;

  private memberId: InventoryMember['id'] | null = null;
  private seenOpenedAt: number | null = null;
  private seenMember: InventoryMember['id'] | null = null;
  private lastTap: { id: string; at: number } | null = null;
  private press: PressState | null = null;
  private swallowTap = false;
  private pendingSound: SoundId | null = null;

  constructor(readonly host: InventoryScreenHost) {
    const search = this.search;
    this.surface = {
      id: 'inventory',
      band: 'panel',
      haltsWorld: false,
      // While the search field takes keys, the ones it does not use (WASD
      // among them) must not walk the crawler under the query being typed.
      get locksKeyboard(): boolean {
        return search.active;
      },
      isOpen: () => this.open_ && this.member() !== null,
      close: () => this.close(),
      onKey: (key, mods) => this.handleKey(key, mods),
      render: (ui) => renderInventory(ui, this),
    };
  }

  get isOpen(): boolean {
    return this.open_;
  }

  // ── Opening and closing ───────────────────────────────────────────────────

  open(opts: OpenOptions = {}): void {
    const wasOpen = this.open_;
    this.open_ = true;
    this.tab = opts.tab ?? 'bag';
    if (opts.member !== undefined) this.memberId = opts.member;
    else if (!wasOpen) this.memberId = null;
    this.backHandler = opts.onBack ?? (wasOpen ? this.backHandler : null);
    this.clearTransient();
  }

  /** I and G: close when already showing `tab`, otherwise show it. */
  toggle(tab: InventoryTab): void {
    if (this.open_ && this.tab === tab) this.close();
    else this.open({ tab, member: this.open_ ? (this.memberId ?? undefined) : undefined });
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.memberId = null;
    this.backHandler = null;
    this.filter = 'all';
    this.search.clear();
    this.search.deactivate();
    this.clearTransient();
    this.host.actions.closeSubmenus();
    this.host.onClosed?.();
  }

  /** The back chevron: close, then return to whatever opened the screen. */
  goBack(): void {
    const back = this.backHandler;
    this.close();
    back?.();
  }

  private clearTransient(): void {
    this.selection = null;
    this.dollKey = null;
    this.sheetOpen = false;
    this.hotbarPickerOpen = false;
    this.menu = null;
    this.drag = null;
    this.scrollDrag = null;
    this.press = null;
    this.notice = null;
    this.keyboardSelection = false;
  }

  /** Whose pack is on screen, or null while closed or showing the active crawler. */
  shownMemberId(): InventoryMember['id'] | null {
    return this.open_ ? this.memberId : null;
  }

  member(): InventoryMember | null {
    const party = this.host.party();
    return party.find((m) => m.id === this.memberId) ?? (party.length > 0 ? party[0] : null);
  }

  switchMember(id: InventoryMember['id']): void {
    if (this.member()?.id === id) return;
    this.memberId = id;
    this.clearTransient();
  }

  setTab(tab: InventoryTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.clearTransient();
  }

  setFilter(filter: BagFilter): void {
    this.filter = filter;
    this.reveal = null;
  }

  // ── Per-frame bookkeeping (called by the renderer) ───────────────────────

  /** @internal */
  beginFrame(now: number, openedAt: number, touch: boolean, compact: boolean): SoundId | null {
    this.now = now;
    this.touch = touch;
    this.compact = compact;
    this.geometry = emptyGeometry();
    const member = this.member();
    if (member !== null) {
      if (this.seenOpenedAt !== openedAt || this.seenMember !== member.id) {
        this.seenOpenedAt = openedAt;
        this.seenMember = member.id;
        this.freshUpgrades.clear();
      }
      // Every frame, not only on opening: an upgrade picked up while the bag
      // is open earns its badge too.
      const unseen = member.owner.inventory.unseenUpgrades;
      for (const id of unseen) this.freshUpgrades.add(id);
      unseen.clear();
    }
    if (this.notice !== null && now >= this.notice.until) this.notice = null;
    if (member !== null) this.revalidateSelection(member.owner.inventory);
    const sound = this.pendingSound;
    this.pendingSound = null;
    return sound;
  }

  /** A selection whose stack has moved follows it; one whose stack is gone is dropped. */
  private revalidateSelection(inventory: Inventory): void {
    const selection = this.selection;
    const id = selection?.id ?? null;
    if (selection === null || id === null) return;
    const slots = selection.source === 'hotbar' ? inventory.actionBar.slots : inventory.bag.slots;
    if (slots[selection.slotIdx]?.id === id) return;
    const moved = slots.findIndex((item) => item?.id === id);
    if (moved !== -1) {
      this.selection = { ...selection, slotIdx: moved };
      return;
    }
    const otherSource = selection.source === 'hotbar' ? 'inv' : 'hotbar';
    const other = otherSource === 'hotbar' ? inventory.actionBar.slots : inventory.bag.slots;
    const elsewhere = other.findIndex((item) => item?.id === id);
    this.selection = elsewhere === -1 ? null : { source: otherSource, slotIdx: elsewhere, id };
    if (this.selection === null) {
      this.sheetOpen = false;
      this.hotbarPickerOpen = false;
    }
  }

  /** The selected stack, read live. */
  selectedItem(inventory: Inventory): InventoryItem | null {
    const selection = this.selection;
    const id = selection?.id ?? null;
    if (selection === null || id === null) return null;
    const slots = selection.source === 'hotbar' ? inventory.actionBar.slots : inventory.bag.slots;
    const item = slots[selection.slotIdx] ?? null;
    return item?.id === selection.id ? item : null;
  }

  restrictions(): InventoryRestrictions {
    return this.host.restrictions?.() ?? NO_RESTRICTIONS;
  }

  /** The tutorial lets no menu open while it is steering a drag. */
  menuAllowed(): boolean {
    const r = this.restrictions();
    return r.contextMenu && (r.allowedSource ?? null) === null;
  }

  /** Why item actions are shut while a tutorial step steers a drag, or null when they are open. */
  actionsLockedReason(): string | null {
    return (this.restrictions().allowedSource ?? null) === null ? null : TUTORIAL_LOCK_REASON;
  }

  refuse(text: string, id: ItemId | null): void {
    this.notice = { text, until: this.now + NOTICE_MS, id };
    this.pendingSound = UI_ERROR_SOUND;
  }

  private buzz(): void {
    this.pendingSound = UI_ERROR_SOUND;
  }

  // ── Selection and taps ────────────────────────────────────────────────────

  /** A tap on a stack: select it, or on a quick second tap, run its lead action. */
  tapStack(ref: StackRef, item: InventoryItem): void {
    if (this.swallowTap) {
      this.swallowTap = false;
      return;
    }
    const id = `${ref.source}/${ref.slotIdx}`;
    const last = this.lastTap;
    const isDouble = last !== null && last.id === id && this.now - last.at <= DOUBLE_TAP_MS;
    this.lastTap = isDouble ? null : { id, at: this.now };
    this.freshUpgrades.delete(item.id);
    this.keyboardSelection = false;
    if (this.tab === 'character' && ref.source === 'inv') {
      this.selection = ref;
      this.equipFromGrid(ref.slotIdx, item);
      return;
    }
    const changed = this.selection?.source !== ref.source || this.selection.slotIdx !== ref.slotIdx;
    this.selection = ref;
    if (changed) this.hotbarPickerOpen = false;
    if (this.compact) this.sheetOpen = true;
    if (isDouble) this.runLeadAction();
  }

  /** A tap on an empty bag slot. */
  tapEmpty(slotIdx: number): void {
    this.selection = this.keyboardSelection ? { source: 'inv', slotIdx, id: null } : null;
    this.sheetOpen = false;
    this.hotbarPickerOpen = false;
  }

  deselect(): void {
    this.selection = null;
    this.sheetOpen = false;
    this.hotbarPickerOpen = false;
  }

  // ── Long press ────────────────────────────────────────────────────────────

  /** @internal A press went down on a slot. */
  pressDown(id: string, point: Point): void {
    this.swallowTap = false;
    this.press = { id, at: this.now, point, fired: false };
  }

  /**
   * @internal The press on a slot ended, however it ended. A drag still in
   * hand here lost its region mid-gesture and never heard its own end, so it
   * is settled here instead.
   */
  pressUp(at: Point, cancelled: boolean): void {
    if (this.drag !== null) this.endDrag(at, cancelled);
    this.scrollDrag = null;
    if (this.press?.fired === true) this.swallowTap = true;
    this.press = null;
  }

  /** @internal Called each frame for the slot that is pressed; opens the menu once it is held long enough. */
  checkLongPress(id: string, target: MenuTarget): void {
    const press = this.press;
    if (press?.id !== id || press.fired || !this.touch) return;
    if (this.drag !== null || this.scrollDrag !== null) return;
    if (this.now - press.at < LONG_PRESS_MS) return;
    press.fired = true;
    this.openItemMenu(target, press.point);
  }

  /** @internal Whether a touch on `id` has rested long enough to pick the item up. */
  heldForPickup(id: string): boolean {
    const press = this.press;
    return press !== null && press.id === id && this.now - press.at >= TOUCH_PICKUP_HOLD_MS;
  }

  // ── Menus ─────────────────────────────────────────────────────────────────

  openItemMenu(target: MenuTarget, at: Point): void {
    if (!this.menuAllowed()) return;
    this.freshUpgrades.delete(target.item.id);
    this.menu = { kind: 'item', target, at };
  }

  /** The entries the context menu and the detail pane offer for `target`. */
  entriesFor(target: MenuTarget, inventory: Inventory): MenuEntry[] {
    const equipped = inventory.hasEquipped(target.item.id);
    return this.host.actions.menuEntries(target.item, target.source, equipped);
  }

  /** The item's own action: what a double tap or Enter does, or null when it has none. */
  leadEntry(target: MenuTarget, inventory: Inventory): MenuEntry | null {
    const entries = this.entriesFor(target, inventory);
    if (entries.length === 0) return null;
    const first = entries[0];
    if (GENERIC_ACTIONS.has(first.action)) return null;
    return first.disabledReason === undefined ? first : null;
  }

  /** Runs one menu entry for `target`. */
  choose(action: string, target: MenuTarget): void {
    const member = this.member();
    if (member === null) return;
    this.menu = null;
    if (action === DESCRIPTION_ACTION) {
      this.selection = { source: target.source, slotIdx: target.slotIdx, id: target.item.id };
      this.sheetOpen = true;
      return;
    }
    const locked = this.actionsLockedReason();
    if (locked !== null) {
      this.refuse(locked, target.item.id);
      return;
    }
    this.host.actions.chooseOption(action, target, member.owner.inventory);
    this.host.onActionQueued?.();
  }

  /** "Assign to hotbar": select the item and open its hotbar slot buttons. */
  openHotbarPicker(target: MenuTarget): void {
    this.menu = null;
    this.selection = { source: target.source, slotIdx: target.slotIdx, id: target.item.id };
    this.sheetOpen = true;
    this.hotbarPickerOpen = true;
  }

  runLeadAction(): void {
    const member = this.member();
    if (member === null || this.actionsLockedReason() !== null) return;
    const inventory = member.owner.inventory;
    const item = this.selectedItem(inventory);
    const selection = this.selection;
    if (item === null || selection === null) return;
    const target: MenuTarget = { source: selection.source, slotIdx: selection.slotIdx, item };
    const lead = this.leadEntry(target, inventory);
    if (lead !== null) this.choose(lead.action, target);
  }

  // ── Bag and hotbar moves ─────────────────────────────────────────────────

  /** Puts `item` (from `source`) in hotbar slot `index`, if every rule allows it. */
  assignToHotbar(
    item: InventoryItem,
    from: Pick<Selection, 'source' | 'slotIdx'>,
    index: number,
  ): void {
    const source = from.source;
    const member = this.member();
    if (member === null || index === QUEST_SLOT_IDX || index < 0 || index >= HOTBAR_COUNT) return;
    const r = this.restrictions();
    if ((r.blockedItems ?? []).includes(item.id)) {
      this.host.onBlockedDrag?.();
      this.buzz();
      return;
    }
    const allowedSource = r.allowedSource ?? null;
    const allowedTarget = r.allowedHotbarTarget ?? null;
    if (
      (allowedSource !== null && item.id !== allowedSource) ||
      (allowedTarget !== null && index !== allowedTarget)
    ) {
      this.refuse(TUTORIAL_HOTBAR_REASON, item.id);
      return;
    }
    if (source === 'inv') {
      const reason = hotbarRefusal(item);
      if (reason !== null) {
        this.host.onHotbarRefused?.(item, reason);
        this.refuse(reason, item.id);
        return;
      }
    }
    // The stack picked, not the first one with its id: a non-stacking item
    // can have a copy on the bar already, and that copy must not be the one moved.
    const inventory = member.owner.inventory;
    if (source === 'inv') inventory.swapInvToHotbar(from.slotIdx, index);
    else if (from.slotIdx !== index) inventory.swapHotbar(from.slotIdx, index);
    this.hotbarPickerOpen = false;
  }

  /** Starts a drag of `item`, unless a tutorial step forbids moving it. */
  beginDrag(
    from: DragState['from'],
    slotIdx: number,
    dollKey: string | null,
    item: InventoryItem,
    at: Point,
  ): void {
    const allowed = this.restrictions().allowedSource ?? null;
    if (allowed !== null && item.id !== allowed) return;
    this.menu = null;
    this.drag = { from, slotIdx, dollKey, item, x: at.x, y: at.y };
  }

  moveDrag(at: Point): void {
    if (this.drag === null) return;
    this.drag.x = at.x;
    this.drag.y = at.y;
  }

  /** Lets go of the drag at `at`, acting on whatever is beneath. */
  endDrag(at: Point, cancelled: boolean): void {
    const drag = this.drag;
    this.drag = null;
    const member = this.member();
    if (drag === null || cancelled || member === null) return;
    const inventory = member.owner.inventory;
    const geometry = this.geometry;
    const hotbarTarget = findCell(geometry.hotbarCells, at);
    const bagTarget = findCell(geometry.bagCells, at);
    const dollTarget = findCell(geometry.dollCells, at);
    const overGrid = geometry.grid !== null && contains(geometry.grid, at);
    const r = this.restrictions();
    const blocked = (r.blockedItems ?? []).includes(drag.item.id);

    if (drag.from === 'doll') {
      this.dropFromDoll(drag, dollTarget, overGrid, inventory, member);
      return;
    }
    if (dollTarget !== null && drag.from === 'inv') {
      this.equipInto(drag.slotIdx, drag.item, dollTarget, inventory, member);
      return;
    }
    if (blocked) {
      const backHome = drag.from === 'inv' && bagTarget === drag.slotIdx;
      if (!backHome) {
        this.host.onBlockedDrag?.();
        this.buzz();
      }
      return;
    }
    const allowedTarget = r.allowedHotbarTarget ?? null;
    if (allowedTarget !== null) {
      if (hotbarTarget !== allowedTarget) return;
      if (drag.from === 'hotbar') {
        if (drag.slotIdx !== allowedTarget) inventory.swapHotbar(drag.slotIdx, allowedTarget);
      } else {
        inventory.swapInvToHotbar(drag.slotIdx, allowedTarget);
      }
      return;
    }
    if (hotbarTarget !== null && hotbarTarget !== QUEST_SLOT_IDX) {
      if (drag.from === 'hotbar') {
        if (drag.slotIdx !== hotbarTarget) inventory.swapHotbar(drag.slotIdx, hotbarTarget);
        return;
      }
      const reason = hotbarRefusal(drag.item);
      if (reason !== null) {
        this.host.onHotbarRefused?.(drag.item, reason);
        this.refuse(reason, drag.item.id);
        return;
      }
      inventory.swapInvToHotbar(drag.slotIdx, hotbarTarget);
      return;
    }
    if (drag.from === 'hotbar') {
      if (bagTarget !== null && this.isRearrangeable())
        inventory.swapHotbarToInv(drag.slotIdx, bagTarget);
      else if (overGrid) inventory.moveHotbarToFirstEmptySlot(drag.slotIdx);
      return;
    }
    if (bagTarget !== null && bagTarget !== drag.slotIdx && this.isRearrangeable()) {
      inventory.swapSlots(drag.slotIdx, bagTarget);
    }
  }

  private dropFromDoll(
    drag: DragState,
    dollTarget: string | null,
    overGrid: boolean,
    inventory: Inventory,
    member: InventoryMember,
  ): void {
    const fromKey = drag.dollKey;
    if (fromKey === null || dollTarget === fromKey) return;
    if (dollTarget !== null) {
      const refusal = slotFitRefusal(drag.item, dollTarget);
      if (refusal !== null) {
        this.refuse(refusal, drag.item.id);
        return;
      }
      inventory.unequip(fromKey);
      inventory.equipment.equip(drag.item, dollTarget);
      member.owner.onEquipmentChanged();
      return;
    }
    if (!overGrid) return;
    inventory.unequip(fromKey);
    member.owner.onEquipmentChanged();
  }

  /** The grid shows the bag's real slots, so dropping on one rearranges it. */
  isRearrangeable(): boolean {
    return (
      this.tab === 'bag' &&
      this.filter === 'all' &&
      this.sort === 'manual' &&
      this.search.value.trim().length === 0
    );
  }

  tidy(): void {
    const member = this.member();
    if (member === null) return;
    member.owner.inventory.sortBag(this.sort);
    this.sort = 'manual';
    this.selection = null;
  }

  // ── Character tab ─────────────────────────────────────────────────────────

  /** A tap on a doll cell: take off what is worn there, or narrow the grid to what fits. */
  tapDollSlot(key: string): void {
    const member = this.member();
    if (member === null) return;
    const inventory = member.owner.inventory;
    if (inventory.getEquippedItem(key) !== null) {
      inventory.unequip(key);
      member.owner.onEquipmentChanged();
      this.dollKey = null;
      return;
    }
    this.dollKey = this.dollKey === key ? null : key;
  }

  private equipFromGrid(slotIdx: number, item: InventoryItem): void {
    const member = this.member();
    if (member === null) return;
    const inventory = member.owner.inventory;
    if (inventory.hasEquipped(item.id)) {
      this.refuse(ALREADY_WORN_REFUSAL, item.id);
      return;
    }
    this.equipInto(slotIdx, item, this.dollKey, inventory, member);
  }

  private equipInto(
    slotIdx: number,
    item: InventoryItem,
    targetKey: string | null,
    inventory: Inventory,
    member: InventoryMember,
  ): void {
    const refusal = equipRefusal(item, targetKey, inventory);
    if (refusal !== null) {
      this.refuse(refusal, item.id);
      return;
    }
    inventory.equip(slotIdx, targetKey ?? undefined);
    member.owner.onEquipmentChanged();
    this.dollKey = null;
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  private handleKey(key: string, mods: KeyModifiers): boolean {
    if (this.search.handleKey(key, mods.repeat === true)) return true;
    if (mods.predatesSurface === true) return false;
    const member = this.member();
    if (member === null) return false;
    const inventory = member.owner.inventory;

    if (key === 'Escape') {
      if (this.menu !== null) {
        this.menu = null;
        return true;
      }
      if (this.compact && this.sheetOpen) {
        this.sheetOpen = false;
        return true;
      }
      return false;
    }

    if (key === 'Enter') {
      if (this.selection === null || !this.keyboardSelection) return false;
      if (mods.repeat === true) return true;
      if (this.tab === 'character') {
        const item = this.selectedItem(inventory);
        if (item !== null && this.selection.source === 'inv')
          this.equipFromGrid(this.selection.slotIdx, item);
      } else {
        this.runLeadAction();
      }
      return true;
    }

    const step = ARROW_STEPS.get(key);
    if (step !== undefined) {
      if (this.selection?.source !== 'inv') return false;
      this.moveSelection(step, inventory);
      return true;
    }

    const action = keybindings.actionFor(key);
    const hotbarIndex = HOTBAR_ACTIONS.findIndex((hotbarAction) => hotbarAction === action);
    if (hotbarIndex !== -1 && hotbarIndex !== QUEST_SLOT_IDX && this.tab === 'bag') {
      const item = this.selectedItem(inventory);
      const selection = this.selection;
      if (item === null || selection === null) return false;
      if (mods.repeat === true) return true;
      this.assignToHotbar(item, selection, hotbarIndex);
      return true;
    }
    return false;
  }

  private selectByKeyboard(slotIdx: number, inventory: Inventory): void {
    const item = inventory.bag.slots[slotIdx] ?? null;
    this.selection = { source: 'inv', slotIdx, id: item?.id ?? null };
    this.keyboardSelection = true;
    this.hotbarPickerOpen = false;
    this.reveal = slotIdx;
    if (item !== null) this.freshUpgrades.delete(item.id);
  }

  private moveSelection(step: 'left' | 'right' | 'up' | 'down', inventory: Inventory): void {
    const order = this.geometry.order;
    const selection = this.selection;
    if (order.length === 0 || selection === null) return;
    const at = Math.max(0, order.indexOf(selection.slotIdx));
    const columns = Math.max(1, this.geometry.columns);
    const delta = step === 'left' ? -1 : step === 'right' ? 1 : step === 'up' ? -columns : columns;
    const next = Math.min(order.length - 1, Math.max(0, at + delta));
    this.selectByKeyboard(order[next], inventory);
  }
}

function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

function findCell<K>(cells: ReadonlyMap<K, Rect>, at: Point): K | null {
  for (const [key, rect] of cells) {
    if (contains(rect, at)) return key;
  }
  return null;
}
