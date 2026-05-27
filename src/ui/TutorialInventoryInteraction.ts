import { InventoryInteraction } from './InventoryInteraction';
import type { Inventory } from '../core/Inventory';
import type { ItemId } from '../core/ItemDefs';
import { SLOTS_PER_PAGE } from '../core/ItemDefs';
import { pointInRect } from '../utils';

/**
 * Restricted inventory interaction for tutorial drag-and-drop steps.
 *
 * Only allows dragging the item returned by getAllowedSourceItemId(), and only
 * permits dropping onto the slot returned by getAllowedTargetHotbarSlot().
 * Context menus are suppressed whenever a drag restriction is active so the
 * player cannot bypass the guided step via right-click.
 *
 * Also supports blocking specific item drags (e.g. the boxers during the
 * equip_boxers step) while playing an error sound via onBlockedDragAttempt.
 */
export class TutorialInventoryInteraction extends InventoryInteraction {
  /** Returns the only item ID the player may drag, or null when unrestricted. */
  getAllowedSourceItemId: () => ItemId | null = () => null;
  /** Returns the only hotbar slot the player may drop onto, or null when unrestricted. */
  getAllowedTargetHotbarSlot: () => number | null = () => null;
  /**
   * Returns an item ID that must NOT be dragged during the current step, or null.
   * When the player attempts to drag this item, the drag is cancelled and
   * onBlockedDragAttempt is fired.
   */
  getBlockedDragItemId: () => ItemId | null = () => null;
  /** Called when the player attempts to drag the blocked item. */
  onBlockedDragAttempt: (() => void) | null = null;

  override handleMouseDown(
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
    super.handleMouseDown(
      mx,
      my,
      canvas,
      inventory,
      isOpen,
      hotbarSlotRect,
      panelRect,
      invSlotRect,
      page,
    );
    const allowed = this.getAllowedSourceItemId();
    if (allowed !== null && this.drag !== null && this.drag.item.id !== allowed) {
      this.drag = null;
    }
  }

  override handleMouseUp(
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
    // Blocked items: let the player drag visually, but cancel on drop and play error sound.
    // Exception: if dropped back on the original source slot (no-op drag), cancel silently.
    const blocked = this.getBlockedDragItemId();
    if (blocked !== null && this.drag !== null && this.drag.item.id === blocked) {
      const src = this.drag;
      this.drag = null;

      const pageStart = page * SLOTS_PER_PAGE;
      const localIdx = src.idx - pageStart;
      const droppedOnSourceSlot =
        src.source === 'inv' &&
        localIdx >= 0 &&
        localIdx < SLOTS_PER_PAGE &&
        pointInRect(mx, my, invSlotRect(localIdx, panelRect));

      if (!droppedOnSourceSlot) {
        this.onBlockedDragAttempt?.();
      }
      return;
    }

    const allowedSlot = this.getAllowedTargetHotbarSlot();
    if (allowedSlot === null) {
      super.handleMouseUp(
        mx,
        my,
        canvas,
        inventory,
        isOpen,
        hotbarSlotRect,
        panelRect,
        invSlotRect,
        page,
      );
      return;
    }

    const src = this.drag;
    if (!src) return;
    this.drag = null;

    const r = hotbarSlotRect(allowedSlot, canvas);
    if (pointInRect(mx, my, r)) {
      if (src.source === 'hotbar') {
        if (src.idx !== allowedSlot) inventory.swapHotbar(src.idx, allowedSlot);
      } else {
        inventory.swapInvToHotbar(src.idx, allowedSlot);
      }
    }
    // Drops anywhere else are silently cancelled — drag is already cleared above
  }

  override openContextMenu(
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
    if (this.getAllowedSourceItemId() !== null) return;
    super.openContextMenu(
      mx,
      my,
      canvas,
      inventory,
      isOpen,
      hotbarSlotRect,
      panelRect,
      invSlotRect,
      page,
    );
  }
}
