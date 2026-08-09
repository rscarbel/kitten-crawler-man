import type { Inventory } from '../core/Inventory';
import { HOTBAR_COUNT, SLOTS_PER_PAGE, QUEST_SLOT_IDX, itemCanHotlist } from '../core/ItemDefs';
import type { InventoryItem, ItemId } from '../core/ItemDefs';
import type { SkillId } from '../core/SkillManager';
import { pointInRect } from '../utils';
import { viewportWidth, viewportHeight } from '../core/Viewport';

// Drop dialog layout dimensions
const DROP_DIALOG_WIDTH = 200;
const DROP_DIALOG_HEIGHT = 110;
const DROP_DIALOG_CLOSE_BTN_RIGHT = 22;
const DROP_DIALOG_CLOSE_BTN_LEFT = 6;
const DROP_DIALOG_CLOSE_BTN_TOP = 6;
const DROP_DIALOG_CLOSE_BTN_HEIGHT = 22;
const DROP_DIALOG_BUTTON_WIDTH = 24;
const DROP_DIALOG_BUTTON_HEIGHT = 24;
const DROP_DIALOG_MINUS_BTN_X = 20;
const DROP_DIALOG_MINUS_BTN_Y = 54;
const DROP_DIALOG_PLUS_BTN_X_OFFSET = 44;
const DROP_DIALOG_PLUS_BTN_Y = 54;
const DROP_DIALOG_CONFIRM_X = 20;
const DROP_DIALOG_CONFIRM_Y_OFFSET = 28;
const DROP_DIALOG_CONFIRM_WIDTH_MARGIN = 40;
const DROP_DIALOG_CONFIRM_HEIGHT = 22;

// Context menu layout
const CONTEXT_MENU_WIDTH = 120;
const CONTEXT_MENU_ITEM_HEIGHT = 22;
const CONTEXT_MENU_PADDING = 4;
const CONTEXT_MENU_MARGIN = 4;
const CONTEXT_MENU_ITEM_Y_OFFSET = 2;

// Panel interaction
const CLOSE_BTN_RIGHT_OFFSET = 20;
const CLOSE_BTN_WIDTH = 16;
const CLOSE_BTN_TOP = 8;
const CLOSE_BTN_HEIGHT = 24;

// Navigation
const INVENTORY_NAV_HEIGHT = 28;
const INVENTORY_NAV_Y_OFFSET = 6;
const INVENTORY_NAV_HOVER_TOP_OFFSET = 12;
const INVENTORY_NAV_HOVER_BOTTOM_OFFSET = 4;
const INVENTORY_NAV_HALF = 0.5;

/**
 * The one action an item offers on its own, ahead of the generic entries. An
 * item has at most one: a skill book is read, a potion is drunk, everything else
 * leads with the generic list.
 */
function leadOptionFor(item: InventoryItem): string[] {
  if (item.skillId !== undefined) return ['Read'];
  if (item.drinkable === true) return ['Drink'];
  return [];
}

/** How many pages are needed for the full slot array. */
function pageCount(slotCount: number): number {
  return Math.max(1, Math.ceil(slotCount / SLOTS_PER_PAGE));
}

/**
 * What a host says when the hotbar refuses a piece of gear. Shared so both
 * scenes name the same screen — the Equipment panel is where the item actually
 * does something, and a refusal that doesn't say so is just a dead end.
 */
export const HOTBAR_REFUSAL_MESSAGE =
  "That can't go on the hotbar — equip it from the Equipment screen.";

export interface DragState {
  source: 'inv' | 'hotbar';
  idx: number;
  item: InventoryItem;
  mx: number;
  my: number;
}

/** A skill book the player asked to read, before the prompt has confirmed it. */
export interface SkillBookReadRequest {
  bookId: ItemId;
  skillId: SkillId;
}

export interface ContextMenu {
  source: 'inv' | 'hotbar';
  slotIdx: number;
  x: number;
  y: number;
  item: InventoryItem;
  isEquipped?: boolean;
}

/**
 * Handles all InventoryPanel interaction logic: drag-and-drop, click handling,
 * context menus, and drop dialogs. Separated from rendering so each concern
 * can be understood and modified independently.
 */
export class InventoryInteraction {
  drag: DragState | null = null;
  contextMenu: ContextMenu | null = null;
  contextMenuHover = -1;

  /**
   * Fired when a drag of gear with no hotbar action is released over a hotbar
   * slot. The swap already refuses on its own, so the host uses this purely to
   * say so — without it the item just springs home and the refusal is silent.
   */
  onBlockedHotbarDrop: (() => void) | null = null;

  /**
   * Offered every click that reached the open panel's own surface, after the
   * dialogs, the context menu and the nav bar have all declined it and before
   * the panel swallows it as background. Returns true when the host's own header
   * widget took the click.
   */
  claimPanelSurfaceClick: ((mx: number, my: number) => boolean) | null = null;

  /**
   * Asked before a bag slot answers a press of any kind — a drag, a right-click
   * menu. A host that is filtering its slots answers false for an item the
   * filter has faded out: an item the player cannot see is not one they can have
   * meant to act on, whichever button they used.
   */
  canInteractWithBagSlot: ((item: InventoryItem) => boolean) | null = null;

  /** Set by context-menu "Equip" selection; DungeonScene reads and clears this. */
  pendingEquipSlot: number | null = null;
  /** Which container the pending equip slot refers to. */
  pendingEquipSource: 'inv' | 'hotbar' | null = null;
  /** Set by context-menu "Unequip" selection; DungeonScene reads and clears this. */
  pendingUnequipSlot: number | null = null;
  /** Which container the pending unequip slot refers to. */
  pendingUnequipSource: 'inv' | 'hotbar' | null = null;
  /** Set by context-menu "Description" selection; DungeonScene reads and clears. */
  pendingInfoItem: InventoryItem | null = null;
  /**
   * A potion the player asked to drink straight from the menu, so a potion never
   * has to be parked in the hotbar first. Carries the slot, not just the id: the
   * same potion often sits in both containers, and it is the stack the player
   * pointed at that should go down. The scene reads and clears this, and decides
   * who drinks — the bag on screen is not always the active crawler's.
   */
  pendingDrinkSlot: { source: 'inv' | 'hotbar'; slotIdx: number; id: ItemId } | null = null;
  /** Set when the user confirms a drop; DungeonScene reads and clears this. */
  pendingDropItem: { id: ItemId; quantity: number } | null = null;
  /**
   * A skill book the player asked to read, awaiting confirmation. Raised by a
   * plain left click on the slot or by the context menu's Read entry — the
   * scene reads and clears this.
   */
  pendingSkillBookRead: SkillBookReadRequest | null = null;
  /** Active drop-quantity dialog (for stackable items with qty > 1). */
  dropDialog: {
    slotIdx: number;
    id: ItemId;
    maxQty: number;
    selectedQty: number;
  } | null = null;

  get isDragging(): boolean {
    return this.drag !== null;
  }

  /**
   * Queues the read prompt if this slot holds a skill book.
   * @returns whether the click was claimed, so a left click on one opens the
   *   prompt instead of resolving as a same-slot drag.
   */
  private requestSkillBookRead(item: InventoryItem): boolean {
    if (item.skillId === undefined) return false;
    // A menu open at this point belongs to a different slot — `handleMouseDown`
    // refuses to start a drag while one is up, so this can only be a left click
    // elsewhere. Leaving it would let its Drop/Equip act on that other item
    // after the prompt is dismissed.
    this.contextMenu = null;
    this.pendingSkillBookRead = { bookId: item.id, skillId: item.skillId };
    return true;
  }

  cancelDrag(): void {
    this.drag = null;
  }

  contextMenuOptions(
    item: InventoryItem,
    source: 'inv' | 'hotbar',
    isEquipped?: boolean,
  ): string[] {
    // The item's own action leads: it is what the player opened the menu for,
    // and putting it anywhere but first would sit Drop next to the common action.
    const lead = leadOptionFor(item);
    // Undroppable items (permanent quest gear like the Wayfinder's Anchor, the
    // ability tomes) can still be repositioned freely — only the option to
    // discard them into the world is missing.
    const drop = item.canDrop === false ? [] : ['Drop'];
    if (source === 'hotbar') {
      if (item.type === 'armor') {
        const label = isEquipped ? 'Unequip' : 'Equip';
        return [...lead, label, 'Move to Bag', 'Description', ...drop];
      }
      return [...lead, 'Move to Bag', 'Description', ...drop];
    }
    if (item.type === 'armor') {
      const label = isEquipped ? 'Unequip' : 'Equip';
      return [...lead, label, 'Description', ...drop];
    }
    return [...lead, 'Description', ...drop];
  }

  /**
   * Returns true if this panel consumed the click.
   */
  handleClick(
    mx: number,
    my: number,
    inventory: Inventory,
    isOpen: boolean,
    toggleFn: () => void,
    toggleBtnRect: { x: number; y: number; w: number; h: number },
    panelRect: { x: number; y: number; w: number; h: number },
    page: number,
    setPage: (p: number) => void,
    setOpen: (o: boolean) => void,
  ): boolean {
    // Drop quantity dialog takes priority
    if (this.dropDialog) {
      const dd = this.dropDialog;
      const dlgW = DROP_DIALOG_WIDTH;
      const dlgH = DROP_DIALOG_HEIGHT;
      const dlgX = Math.floor((viewportWidth() - dlgW) / 2);
      const dlgY = Math.floor((viewportHeight() - dlgH) / 2);

      if (
        mx >= dlgX + dlgW - DROP_DIALOG_CLOSE_BTN_RIGHT &&
        mx <= dlgX + dlgW - DROP_DIALOG_CLOSE_BTN_LEFT &&
        my >= dlgY + DROP_DIALOG_CLOSE_BTN_TOP &&
        my <= dlgY + DROP_DIALOG_CLOSE_BTN_HEIGHT
      ) {
        this.dropDialog = null;
        return true;
      }
      const minusBtnX = dlgX + DROP_DIALOG_MINUS_BTN_X;
      const minusBtnY = dlgY + DROP_DIALOG_MINUS_BTN_Y;
      if (
        mx >= minusBtnX &&
        mx <= minusBtnX + DROP_DIALOG_BUTTON_WIDTH &&
        my >= minusBtnY &&
        my <= minusBtnY + DROP_DIALOG_BUTTON_HEIGHT
      ) {
        this.dropDialog = { ...dd, selectedQty: Math.max(1, dd.selectedQty - 1) };
        return true;
      }
      const plusBtnX = dlgX + dlgW - DROP_DIALOG_PLUS_BTN_X_OFFSET;
      const plusBtnY = dlgY + DROP_DIALOG_PLUS_BTN_Y;
      if (
        mx >= plusBtnX &&
        mx <= plusBtnX + DROP_DIALOG_BUTTON_WIDTH &&
        my >= plusBtnY &&
        my <= plusBtnY + DROP_DIALOG_BUTTON_HEIGHT
      ) {
        this.dropDialog = { ...dd, selectedQty: Math.min(dd.maxQty, dd.selectedQty + 1) };
        return true;
      }
      const confirmX = dlgX + DROP_DIALOG_CONFIRM_X;
      const confirmY = dlgY + dlgH - DROP_DIALOG_CONFIRM_Y_OFFSET;
      if (
        mx >= confirmX &&
        mx <= confirmX + dlgW - DROP_DIALOG_CONFIRM_WIDTH_MARGIN &&
        my >= confirmY &&
        my <= confirmY + DROP_DIALOG_CONFIRM_HEIGHT
      ) {
        this.pendingDropItem = { id: dd.id, quantity: dd.selectedQty };
        this.dropDialog = null;
        return true;
      }
      if (mx >= dlgX && mx <= dlgX + dlgW && my >= dlgY && my <= dlgY + dlgH) {
        return true;
      }
      this.dropDialog = null;
      return true;
    }

    if (this.pendingInfoItem) {
      this.pendingInfoItem = null;
      return true;
    }

    if (this.contextMenu) {
      const cm = this.contextMenu;
      const options = this.contextMenuOptions(cm.item, cm.source, cm.isEquipped);
      const menuW = CONTEXT_MENU_WIDTH;
      const menuItemH = CONTEXT_MENU_ITEM_HEIGHT;
      const menuH = options.length * menuItemH + CONTEXT_MENU_PADDING;
      // Already on-screen: `openContextMenu` resolved the origin once.
      const cmx = cm.x;
      const cmy = cm.y;
      if (mx >= cmx && mx <= cmx + menuW && my >= cmy && my <= cmy + menuH) {
        const idx = Math.floor((my - cmy - CONTEXT_MENU_ITEM_Y_OFFSET) / menuItemH);
        if (idx >= 0 && idx < options.length) {
          const action = options[idx];
          if (action === 'Read') {
            this.requestSkillBookRead(cm.item);
          } else if (action === 'Drink') {
            this.pendingDrinkSlot = { source: cm.source, slotIdx: cm.slotIdx, id: cm.item.id };
          } else if (action === 'Equip') {
            this.pendingEquipSlot = cm.slotIdx;
            this.pendingEquipSource = cm.source;
          } else if (action === 'Unequip') {
            this.pendingUnequipSlot = cm.slotIdx;
            this.pendingUnequipSource = cm.source;
          } else if (action === 'Move to Bag') {
            inventory.moveHotbarToFirstEmptySlot(cm.slotIdx);
          } else if (action === 'Drop') {
            const item =
              cm.source === 'hotbar'
                ? inventory.actionBar.slots[cm.slotIdx]
                : inventory.bag.slots[cm.slotIdx];
            if (item) {
              if (item.stackable && item.quantity > 1) {
                this.dropDialog = {
                  slotIdx: cm.slotIdx,
                  id: item.id,
                  maxQty: item.quantity,
                  selectedQty: 1,
                };
              } else {
                this.pendingDropItem = { id: item.id, quantity: 1 };
              }
            }
          } else {
            this.pendingInfoItem = cm.item;
          }
        }
      }
      this.contextMenu = null;
      return true;
    }

    const btn = toggleBtnRect;
    if (pointInRect(mx, my, btn)) {
      toggleFn();
      return true;
    }

    if (!isOpen) return false;

    const p = panelRect;
    const closeX = p.x + p.w - CLOSE_BTN_RIGHT_OFFSET;
    if (
      mx >= closeX &&
      mx <= closeX + CLOSE_BTN_WIDTH &&
      my >= p.y + CLOSE_BTN_TOP &&
      my <= p.y + CLOSE_BTN_HEIGHT
    ) {
      setOpen(false);
      return true;
    }

    const pages = pageCount(inventory.bag.slots.length);
    if (pages > 1) {
      const NAV_H = INVENTORY_NAV_HEIGHT;
      const navY = p.y + p.h - NAV_H + INVENTORY_NAV_Y_OFFSET;
      if (
        my >= navY - INVENTORY_NAV_HOVER_TOP_OFFSET &&
        my <= navY + INVENTORY_NAV_HOVER_BOTTOM_OFFSET
      ) {
        if (mx < p.x + p.w * INVENTORY_NAV_HALF && page > 0) {
          setPage(page - 1);
          return true;
        }
        if (mx >= p.x + p.w * INVENTORY_NAV_HALF && page < pages - 1) {
          setPage(page + 1);
          return true;
        }
      }
    }

    if (this.claimPanelSurfaceClick?.(mx, my) === true) {
      return true;
    }

    if (pointInRect(mx, my, p)) {
      return true;
    }

    return false;
  }

  handleMouseDown(
    mx: number,
    my: number,
    inventory: Inventory,
    isOpen: boolean,
    hotbarSlotRect: (i: number) => { x: number; y: number; w: number; h: number },
    panelRect: { x: number; y: number; w: number; h: number },
    invSlotRect: (
      i: number,
      panel: { x: number; y: number },
    ) => { x: number; y: number; w: number; h: number },
    page: number,
  ): void {
    // The menu is drawn at the click point, so it covers the slot it belongs to.
    // A press while it is up is aimed at one of its options: starting a drag
    // would let the mouse-up resolve first and swallow the selection, and for a
    // skill book that mouse-up opens the read prompt instead of Drop.
    if (this.contextMenu !== null) return;

    for (let i = 0; i < HOTBAR_COUNT; i++) {
      if (i === QUEST_SLOT_IDX) continue; // Quest slot is not draggable
      const r = hotbarSlotRect(i);
      if (pointInRect(mx, my, r)) {
        const item = inventory.actionBar.slots[i];
        // Undroppable is not the same as unmovable: the Wayfinder's Anchor and
        // the ability tomes can't be discarded, but a player still needs to be
        // able to rearrange the hotbar around them like any other item.
        if (item) {
          this.drag = { source: 'hotbar', idx: i, item, mx, my };
          return;
        }
      }
    }

    if (!isOpen) return;

    const pageStart = page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      if (slotIdx >= inventory.bag.slots.length) break;
      const r = invSlotRect(i, panelRect);
      if (pointInRect(mx, my, r)) {
        const item = inventory.bag.slots[slotIdx];
        if (item) {
          if (!this.bagSlotIsInteractive(item)) return;
          this.drag = { source: 'inv', idx: slotIdx, item, mx, my };
          return;
        }
      }
    }
  }

  /**
   * True when no host filter is refusing this slot's item. Public so a scene's
   * own click routing (the gear-panel equip path, which never goes through
   * `handleMouseDown`) can honor the same search filter as drag and the
   * context menu.
   */
  bagSlotIsInteractive(item: InventoryItem): boolean {
    return this.canInteractWithBagSlot === null || this.canInteractWithBagSlot(item);
  }

  /**
   * Where a menu opened at (mx, my) will actually be drawn, pulled back on
   * screen when it would overhang. Resolved once at open time rather than at
   * every read, so hit-testing, hover highlighting, and the renderer can never
   * disagree about a menu that had to slide.
   */
  private clampMenuOrigin(
    mx: number,
    my: number,
    item: InventoryItem,
    source: 'inv' | 'hotbar',
    isEquipped: boolean,
  ): { x: number; y: number } {
    const optionCount = this.contextMenuOptions(item, source, isEquipped).length;
    const menuH = optionCount * CONTEXT_MENU_ITEM_HEIGHT + CONTEXT_MENU_PADDING;
    return {
      x: Math.min(mx, viewportWidth() - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN),
      y: Math.min(my, viewportHeight() - menuH - CONTEXT_MENU_MARGIN),
    };
  }

  openContextMenu(
    mx: number,
    my: number,
    inventory: Inventory,
    isOpen: boolean,
    hotbarSlotRect: (i: number) => { x: number; y: number; w: number; h: number },
    panelRect: { x: number; y: number; w: number; h: number },
    invSlotRect: (
      i: number,
      panel: { x: number; y: number },
    ) => { x: number; y: number; w: number; h: number },
    page: number,
  ): void {
    for (let i = 0; i < HOTBAR_COUNT; i++) {
      if (i === QUEST_SLOT_IDX) continue; // Quest slot has no menu — it can't be moved or dropped.
      const r = hotbarSlotRect(i);
      if (pointInRect(mx, my, r)) {
        const item = inventory.actionBar.slots[i];
        if (item) {
          const isEquipped = inventory.hasEquipped(item.id);
          const origin = this.clampMenuOrigin(mx, my, item, 'hotbar', isEquipped);
          this.contextMenu = {
            source: 'hotbar',
            slotIdx: i,
            x: origin.x,
            y: origin.y,
            item,
            isEquipped,
          };
          this.contextMenuHover = -1;
          return;
        }
      }
    }

    if (!isOpen) return;
    const pageStart = page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      if (slotIdx >= inventory.bag.slots.length) break;
      const r = invSlotRect(i, panelRect);
      if (pointInRect(mx, my, r)) {
        const item = inventory.bag.slots[slotIdx];
        if (item) {
          if (!this.bagSlotIsInteractive(item)) return;
          const isEquipped = inventory.isSlotEquipped(slotIdx);
          const origin = this.clampMenuOrigin(mx, my, item, 'inv', isEquipped);
          this.contextMenu = {
            source: 'inv',
            slotIdx,
            x: origin.x,
            y: origin.y,
            item,
            isEquipped,
          };
          this.contextMenuHover = -1;
          return;
        }
      }
    }
    this.contextMenu = null;
  }

  handleMouseMove(mx: number, my: number): void {
    if (this.drag) {
      this.drag.mx = mx;
      this.drag.my = my;
    }
    if (this.contextMenu) {
      const options = this.contextMenuOptions(
        this.contextMenu.item,
        this.contextMenu.source,
        this.contextMenu.isEquipped,
      );
      const menuItemH = CONTEXT_MENU_ITEM_HEIGHT;
      const cmx = this.contextMenu.x;
      const cmy = this.contextMenu.y;
      if (
        mx >= cmx &&
        mx <= cmx + CONTEXT_MENU_WIDTH &&
        my >= cmy &&
        my <= cmy + options.length * menuItemH + CONTEXT_MENU_PADDING
      ) {
        this.contextMenuHover = Math.floor((my - cmy - CONTEXT_MENU_ITEM_Y_OFFSET) / menuItemH);
      } else {
        this.contextMenuHover = -1;
      }
    }
  }

  handleMouseUp(
    mx: number,
    my: number,
    inventory: Inventory,
    isOpen: boolean,
    hotbarSlotRect: (i: number) => { x: number; y: number; w: number; h: number },
    panelRect: { x: number; y: number; w: number; h: number },
    invSlotRect: (
      i: number,
      panel: { x: number; y: number },
    ) => { x: number; y: number; w: number; h: number },
    page: number,
  ): void {
    const src = this.drag;
    if (!src) return;
    this.drag = null;

    for (let i = 0; i < HOTBAR_COUNT; i++) {
      if (i === QUEST_SLOT_IDX) continue; // Can't drop onto quest slot
      const r = hotbarSlotRect(i);
      if (pointInRect(mx, my, r)) {
        // Released on the slot it came from: a plain left click, not a drag.
        // Skill books answer that with the read prompt; everything else is a
        // no-op swap, which is what dropping an item back where it was means.
        // Checked ahead of the hotlist guard so legacy gear parked in a slot
        // answers a click with silence rather than a refusal it didn't ask for.
        if (src.source === 'hotbar' && src.idx === i) {
          this.requestSkillBookRead(src.item);
          return;
        }
        // A hotbar→hotbar drag is a reorder, not a new placement: the item is
        // already on the hotbar, so the hotlist restriction — which exists to
        // stop new gear from entering — has nothing to say about it.
        if (src.source === 'hotbar') {
          inventory.swapHotbar(src.idx, i);
          return;
        }
        if (!itemCanHotlist(src.item.id)) {
          this.onBlockedHotbarDrop?.();
          return;
        }
        inventory.swapInvToHotbar(src.idx, i);
        return;
      }
    }

    if (!isOpen) return;

    const pageStart = page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      if (slotIdx >= inventory.bag.slots.length) break;
      const r = invSlotRect(i, panelRect);
      if (pointInRect(mx, my, r)) {
        if (src.source === 'hotbar') {
          inventory.swapHotbarToInv(src.idx, slotIdx);
        } else if (src.idx === slotIdx) {
          this.requestSkillBookRead(src.item);
        } else {
          inventory.swapSlots(src.idx, slotIdx);
        }
        return;
      }
    }
  }
}
