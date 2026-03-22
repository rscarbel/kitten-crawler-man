import { Inventory } from '../core/Inventory';
import { HOTBAR_COUNT, SLOTS_PER_PAGE, QUEST_SLOT_IDX } from '../core/ItemDefs';
import type { InventoryItem, ItemId } from '../core/ItemDefs';

function inRect(
  mx: number,
  my: number,
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}

/** How many pages are needed for the full slot array. */
function pageCount(slotCount: number): number {
  return Math.max(1, Math.ceil(slotCount / SLOTS_PER_PAGE));
}

export interface DragState {
  source: 'inv' | 'hotbar';
  idx: number;
  item: InventoryItem;
  mx: number;
  my: number;
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

  /** Set by context-menu "Equip" selection; DungeonScene reads and clears this. */
  pendingEquipSlot: number | null = null;
  /** Set by context-menu "Unequip" selection; DungeonScene reads and clears this. */
  pendingUnequipSlot: number | null = null;
  /** Set by context-menu "Name"/"Description" selection; DungeonScene reads and clears. */
  pendingInfoItem: InventoryItem | null = null;
  /** Set when the user confirms a drop; DungeonScene reads and clears this. */
  pendingDropItem: { id: ItemId; quantity: number } | null = null;
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

  cancelDrag(): void {
    this.drag = null;
  }

  contextMenuOptions(
    item: InventoryItem,
    source: 'inv' | 'hotbar',
    isEquipped?: boolean,
  ): string[] {
    if (source === 'hotbar') {
      return ['Move to Bag', 'Name', 'Description', 'Drop'];
    }
    if (item.type === 'armor') {
      const label = isEquipped ? 'Unequip' : 'Equip';
      return [label, 'Name', 'Description', 'Drop'];
    }
    return ['Name', 'Description', 'Drop'];
  }

  /**
   * Returns true if this panel consumed the click.
   */
  handleClick(
    mx: number,
    my: number,
    canvas: HTMLCanvasElement,
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
      const dlgW = 200;
      const dlgH = 110;
      const dlgX = Math.floor((canvas.width - dlgW) / 2);
      const dlgY = Math.floor((canvas.height - dlgH) / 2);

      if (mx >= dlgX + dlgW - 22 && mx <= dlgX + dlgW - 6 && my >= dlgY + 6 && my <= dlgY + 22) {
        this.dropDialog = null;
        return true;
      }
      const minusBtnX = dlgX + 20;
      const minusBtnY = dlgY + 54;
      if (mx >= minusBtnX && mx <= minusBtnX + 24 && my >= minusBtnY && my <= minusBtnY + 24) {
        this.dropDialog = { ...dd, selectedQty: Math.max(1, dd.selectedQty - 1) };
        return true;
      }
      const plusBtnX = dlgX + dlgW - 44;
      const plusBtnY = dlgY + 54;
      if (mx >= plusBtnX && mx <= plusBtnX + 24 && my >= plusBtnY && my <= plusBtnY + 24) {
        this.dropDialog = { ...dd, selectedQty: Math.min(dd.maxQty, dd.selectedQty + 1) };
        return true;
      }
      const confirmX = dlgX + 20;
      const confirmY = dlgY + dlgH - 28;
      if (mx >= confirmX && mx <= confirmX + dlgW - 40 && my >= confirmY && my <= confirmY + 22) {
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
      const menuW = 120;
      const menuItemH = 22;
      const menuH = options.length * menuItemH + 4;
      const cmx = Math.min(cm.x, canvas.width - menuW - 4);
      const cmy = Math.min(cm.y, canvas.height - menuH - 4);
      if (mx >= cmx && mx <= cmx + menuW && my >= cmy && my <= cmy + menuH) {
        const idx = Math.floor((my - cmy - 2) / menuItemH);
        if (idx >= 0 && idx < options.length) {
          const action = options[idx];
          if (action === 'Equip') {
            this.pendingEquipSlot = cm.slotIdx;
          } else if (action === 'Unequip') {
            this.pendingUnequipSlot = cm.slotIdx;
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
    if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
      toggleFn();
      return true;
    }

    if (!isOpen) return false;

    const p = panelRect;
    const closeX = p.x + p.w - 20;
    if (mx >= closeX && mx <= closeX + 16 && my >= p.y + 8 && my <= p.y + 24) {
      setOpen(false);
      return true;
    }

    const pages = pageCount(inventory.bag.slots.length);
    if (pages > 1) {
      const NAV_H = 28;
      const navY = p.y + p.h - NAV_H + 6;
      if (my >= navY - 12 && my <= navY + 4) {
        if (mx < p.x + p.w * 0.5 && page > 0) {
          setPage(page - 1);
          return true;
        }
        if (mx >= p.x + p.w * 0.5 && page < pages - 1) {
          setPage(page + 1);
          return true;
        }
      }
    }

    if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) {
      return true;
    }

    return false;
  }

  handleMouseDown(
    mx: number,
    my: number,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    isOpen: boolean,
    hotbarSlotRect: (
      i: number,
      canvas: HTMLCanvasElement,
    ) => { x: number; y: number; w: number; h: number },
    panelRect: { x: number; y: number; w: number; h: number },
    invSlotRect: (
      i: number,
      panel: { x: number; y: number },
    ) => { x: number; y: number; w: number; h: number },
    page: number,
  ): void {
    for (let i = 0; i < HOTBAR_COUNT; i++) {
      if (i === QUEST_SLOT_IDX) continue; // Quest slot is not draggable
      const r = hotbarSlotRect(i, canvas);
      if (inRect(mx, my, r)) {
        const item = inventory.actionBar.slots[i];
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
      if (inRect(mx, my, r)) {
        const item = inventory.bag.slots[slotIdx];
        if (item) {
          this.drag = { source: 'inv', idx: slotIdx, item, mx, my };
          return;
        }
      }
    }
  }

  openContextMenu(
    mx: number,
    my: number,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    isOpen: boolean,
    hotbarSlotRect: (
      i: number,
      canvas: HTMLCanvasElement,
    ) => { x: number; y: number; w: number; h: number },
    panelRect: { x: number; y: number; w: number; h: number },
    invSlotRect: (
      i: number,
      panel: { x: number; y: number },
    ) => { x: number; y: number; w: number; h: number },
    page: number,
  ): void {
    for (let i = 0; i < HOTBAR_COUNT; i++) {
      const r = hotbarSlotRect(i, canvas);
      if (inRect(mx, my, r)) {
        const item = inventory.actionBar.slots[i];
        if (item) {
          this.contextMenu = { source: 'hotbar', slotIdx: i, x: mx, y: my, item };
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
      if (inRect(mx, my, r)) {
        const item = inventory.bag.slots[slotIdx];
        if (item) {
          this.contextMenu = {
            source: 'inv',
            slotIdx,
            x: mx,
            y: my,
            item,
            isEquipped: inventory.isSlotEquipped(slotIdx),
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
      const menuItemH = 22;
      const cmx = this.contextMenu.x;
      const cmy = this.contextMenu.y;
      if (mx >= cmx && mx <= cmx + 120 && my >= cmy && my <= cmy + options.length * menuItemH + 4) {
        this.contextMenuHover = Math.floor((my - cmy - 2) / menuItemH);
      } else {
        this.contextMenuHover = -1;
      }
    }
  }

  handleMouseUp(
    mx: number,
    my: number,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    isOpen: boolean,
    hotbarSlotRect: (
      i: number,
      canvas: HTMLCanvasElement,
    ) => { x: number; y: number; w: number; h: number },
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
      const r = hotbarSlotRect(i, canvas);
      if (inRect(mx, my, r)) {
        if (src.source === 'hotbar') {
          if (src.idx !== i) inventory.swapHotbar(src.idx, i);
        } else {
          inventory.swapInvToHotbar(src.idx, i);
        }
        return;
      }
    }

    if (!isOpen) return;

    const pageStart = page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      if (slotIdx >= inventory.bag.slots.length) break;
      const r = invSlotRect(i, panelRect);
      if (inRect(mx, my, r)) {
        if (src.source === 'hotbar') {
          inventory.swapHotbarToInv(src.idx, slotIdx);
        } else {
          if (src.idx !== slotIdx) inventory.swapSlots(src.idx, slotIdx);
        }
        return;
      }
    }
  }
}
