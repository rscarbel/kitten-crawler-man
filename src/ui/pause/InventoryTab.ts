import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { InventoryItem } from '../../core/ItemDefs';
import type { Inventory } from '../../core/Inventory';
import { QUEST_SLOT_IDX } from '../../core/ItemDefs';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';

const MAX_ITEMS_SHOWN = 5;

function nonNullItems(slots: ReadonlyArray<InventoryItem | null>): InventoryItem[] {
  return slots.filter((s): s is InventoryItem => s !== null);
}

function renderPlayerSection(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  label: string,
  labelColor: string,
  inventory: Inventory,
  startY: number,
  bx: number,
  bw: number,
  manageLabel: string,
  onManage: () => void,
): number {
  let y = startY;
  const indentX = bx + 14;
  const contentW = bw - 28;

  drawText(ctx, label, { x: indentX, y, bold: true, size: 13, color: labelColor });
  y += 18;

  // Equipped items
  const equipped = inventory.equippedItems();
  drawText(ctx, 'Equipped:', { x: indentX, y, size: 10, color: '#94a3b8' });
  y += 14;
  if (equipped.length === 0) {
    drawText(ctx, '  (nothing equipped)', { x: indentX, y, size: 10, color: '#475569' });
    y += 13;
  } else {
    for (const item of equipped) {
      const slot = item.equipSubSlot ?? item.equipSlot ?? '';
      const slotPrefix = slot ? `[${slot}] ` : '';
      drawText(ctx, `  ${slotPrefix}${item.name}`, {
        x: indentX,
        y,
        size: 10,
        color: '#e2e8f0',
        width: contentW,
      });
      y += 13;
    }
  }

  y += 4;

  // Hotbar items (exclude quest slot and ability-only items)
  const hotbarItems = nonNullItems(inventory.actionBar.slots.slice(0, QUEST_SLOT_IDX)).filter(
    (s) => s.canDrop !== false,
  );
  const bagItems = nonNullItems(inventory.bag.slots);
  const allItems = [...hotbarItems, ...bagItems];
  const questItem = inventory.actionBar.slots[QUEST_SLOT_IDX];

  const countLabel = allItems.length === 1 ? '1 item' : `${allItems.length} items`;
  drawText(ctx, `Bag (${countLabel}):`, { x: indentX, y, size: 10, color: '#94a3b8' });
  y += 14;

  if (allItems.length === 0) {
    drawText(ctx, '  (empty)', { x: indentX, y, size: 10, color: '#475569' });
    y += 13;
  } else {
    const shown = allItems.slice(0, MAX_ITEMS_SHOWN);
    for (const item of shown) {
      const qty = item.quantity > 1 ? ` ×${item.quantity}` : '';
      drawText(ctx, `  ${item.name}${qty}`, {
        x: indentX,
        y,
        size: 10,
        color: '#e2e8f0',
        width: contentW,
      });
      y += 13;
    }
    if (allItems.length > MAX_ITEMS_SHOWN) {
      drawText(ctx, `  … ${allItems.length - MAX_ITEMS_SHOWN} more`, {
        x: indentX,
        y,
        size: 10,
        color: '#64748b',
      });
      y += 13;
    }
  }

  if (questItem !== null) {
    drawText(ctx, `  [Quest] ${questItem.name}`, {
      x: indentX,
      y,
      size: 10,
      color: '#fbbf24',
      width: contentW,
    });
    y += 13;
  }

  y += 6;

  addButton(ctx, buttons, {
    x: bx + 12,
    y,
    width: bw - 24,
    height: 30,
    label: manageLabel,
    ...BUTTON_PRESETS.primary,
    action: onManage,
  });
  y += 38;

  return y;
}

export function renderInventoryTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  human: HumanPlayer,
  cat: CatPlayer,
  setTab: (tab: PauseTab) => void,
  onManageHuman: () => void,
  onManageCat: () => void,
): void {
  drawText(ctx, 'INVENTORY', {
    x: bx + bw / 2,
    y: by + 22,
    bold: true,
    size: 16,
    color: '#f1f5f9',
    align: 'center',
  });

  let y = by + 46;

  y = renderPlayerSection(
    ctx,
    buttons,
    'Human',
    '#93c5fd',
    human.inventory,
    y,
    bx,
    bw,
    'Manage Human Inventory',
    onManageHuman,
  );

  y += 4;

  y = renderPlayerSection(
    ctx,
    buttons,
    'Cat',
    '#fb923c',
    cat.inventory,
    y,
    bx,
    bw,
    'Manage Cat Inventory',
    onManageCat,
  );

  addButton(ctx, buttons, {
    x: bx + 12,
    y,
    width: bw - 24,
    height: 30,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('main'),
  });
}

/** Conservative height estimate for the inventory tab modal: title + two player sections + back. */
export const INVENTORY_TAB_BOX_H = 530;
