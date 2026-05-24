import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { InventoryItem } from '../../core/ItemDefs';
import type { Inventory } from '../../core/Inventory';
import { QUEST_SLOT_IDX } from '../../core/ItemDefs';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';

const MAX_ITEMS_SHOWN = 5;

// Player section layout
const SECTION_INDENT_X = 14;
const SECTION_CONTENT_WIDTH = 28;
const SECTION_LABEL_SIZE = 13;
const SECTION_LABEL_Y_SPACING = 18;
const EQUIPPED_LABEL_SIZE = 10;
const EQUIPPED_LABEL_Y_SPACING = 14;
const EQUIPPED_ITEM_SIZE = 10;
const EQUIPPED_ITEM_Y_SPACING = 13;
const SECTION_SPACING = 4;
const BAG_LABEL_SIZE = 10;
const BAG_LABEL_Y_SPACING = 14;
const EMPTY_BAG_SIZE = 10;
const EMPTY_BAG_Y_SPACING = 13;
const BAG_ITEM_SIZE = 10;
const BAG_ITEM_Y_SPACING = 13;
const MORE_ITEMS_SIZE = 10;
const MORE_ITEMS_Y_SPACING = 13;
const QUEST_ITEM_SIZE = 10;
const QUEST_ITEM_Y_SPACING = 13;
const FINAL_SPACING = 6;
const BUTTON_X_OFFSET = 12;
const BUTTON_WIDTH_MARGIN = 24;
const BUTTON_HEIGHT = 30;
const BUTTON_Y_SPACING = 38;

// Tab layout
const TITLE_Y = 22;
const TITLE_SIZE = 16;
const FIRST_SECTION_Y = 46;
const SECTIONS_SPACING = 4;
const BACK_BUTTON_X = 12;
const BACK_BUTTON_WIDTH_MARGIN = 24;
const BACK_BUTTON_HEIGHT = 30;

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
  const indentX = bx + SECTION_INDENT_X;
  const contentW = bw - SECTION_CONTENT_WIDTH;

  drawText(ctx, label, { x: indentX, y, bold: true, size: SECTION_LABEL_SIZE, color: labelColor });
  y += SECTION_LABEL_Y_SPACING;

  // Equipped items
  const equipped = inventory.equippedItems();
  drawText(ctx, 'Equipped:', { x: indentX, y, size: EQUIPPED_LABEL_SIZE, color: '#94a3b8' });
  y += EQUIPPED_LABEL_Y_SPACING;
  if (equipped.length === 0) {
    drawText(ctx, '  (nothing equipped)', {
      x: indentX,
      y,
      size: EQUIPPED_ITEM_SIZE,
      color: '#475569',
    });
    y += EQUIPPED_ITEM_Y_SPACING;
  } else {
    for (const item of equipped) {
      const slot = item.equipSubSlot ?? item.equipSlot ?? '';
      const slotPrefix = slot ? `[${slot}] ` : '';
      drawText(ctx, `  ${slotPrefix}${item.name}`, {
        x: indentX,
        y,
        size: EQUIPPED_ITEM_SIZE,
        color: '#e2e8f0',
        width: contentW,
      });
      y += EQUIPPED_ITEM_Y_SPACING;
    }
  }

  y += SECTION_SPACING;

  // Hotbar items (exclude quest slot and ability-only items)
  const hotbarItems = nonNullItems(inventory.actionBar.slots.slice(0, QUEST_SLOT_IDX)).filter(
    (s) => s.canDrop !== false,
  );
  const bagItems = nonNullItems(inventory.bag.slots);
  const allItems = [...hotbarItems, ...bagItems];
  const questItem = inventory.actionBar.slots[QUEST_SLOT_IDX];

  const countLabel = allItems.length === 1 ? '1 item' : `${allItems.length} items`;
  drawText(ctx, `Bag (${countLabel}):`, { x: indentX, y, size: BAG_LABEL_SIZE, color: '#94a3b8' });
  y += BAG_LABEL_Y_SPACING;

  if (allItems.length === 0) {
    drawText(ctx, '  (empty)', { x: indentX, y, size: EMPTY_BAG_SIZE, color: '#475569' });
    y += EMPTY_BAG_Y_SPACING;
  } else {
    const shown = allItems.slice(0, MAX_ITEMS_SHOWN);
    for (const item of shown) {
      const qty = item.quantity > 1 ? ` ×${item.quantity}` : '';
      drawText(ctx, `  ${item.name}${qty}`, {
        x: indentX,
        y,
        size: BAG_ITEM_SIZE,
        color: '#e2e8f0',
        width: contentW,
      });
      y += BAG_ITEM_Y_SPACING;
    }
    if (allItems.length > MAX_ITEMS_SHOWN) {
      drawText(ctx, `  … ${allItems.length - MAX_ITEMS_SHOWN} more`, {
        x: indentX,
        y,
        size: MORE_ITEMS_SIZE,
        color: '#64748b',
      });
      y += MORE_ITEMS_Y_SPACING;
    }
  }

  if (questItem !== null) {
    drawText(ctx, `  [Quest] ${questItem.name}`, {
      x: indentX,
      y,
      size: QUEST_ITEM_SIZE,
      color: '#fbbf24',
      width: contentW,
    });
    y += QUEST_ITEM_Y_SPACING;
  }

  y += FINAL_SPACING;

  addButton(ctx, buttons, {
    x: bx + BUTTON_X_OFFSET,
    y,
    width: bw - BUTTON_WIDTH_MARGIN,
    height: BUTTON_HEIGHT,
    label: manageLabel,
    ...BUTTON_PRESETS.primary,
    action: onManage,
  });
  y += BUTTON_Y_SPACING;

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
    y: by + TITLE_Y,
    bold: true,
    size: TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  let y = by + FIRST_SECTION_Y;

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

  y += SECTIONS_SPACING;

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
    x: bx + BACK_BUTTON_X,
    y,
    width: bw - BACK_BUTTON_WIDTH_MARGIN,
    height: BACK_BUTTON_HEIGHT,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('main'),
  });
}

/** Conservative height estimate for the inventory tab modal: title + two player sections + back. */
export const INVENTORY_TAB_BOX_H = 530;
