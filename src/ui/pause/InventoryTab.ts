import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { InventoryItem } from '../../core/ItemDefs';
import type { Inventory } from '../../core/Inventory';
import { QUEST_SLOT_IDX } from '../../core/ItemDefs';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';

const MAX_ITEMS_SHOWN = 5;

// Compact layout, used when the viewport is too short for the full item lists
const COMPACT_SUMMARY_SIZE = 10;
const COMPACT_SUMMARY_Y_SPACING = 16;
const COMPACT_BUTTON_HEIGHT = 36;
const COMPACT_BUTTON_GAP = 8;
const COMPACT_SECTION_GAP = 10;
const COMPACT_EQUIPMENT_LABEL = 'Equipment';
const COMPACT_INVENTORY_LABEL = 'Inventory';

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
/** Gap between the Equipment button and the Inventory button beneath it. */
const EQUIPMENT_BUTTON_Y_SPACING = 34;

const TITLE_Y = 22;
const TITLE_SIZE = 16;
const FIRST_SECTION_Y = 46;
const SECTIONS_SPACING = 4;
const BACK_BUTTON_X = 12;
const BACK_BUTTON_WIDTH_MARGIN = 24;
const BACK_BUTTON_HEIGHT = 30;
const BACK_BUTTON_BOTTOM_PAD = 8;

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
  equipmentLabel: string,
  onManageEquipment: () => void,
  compact: boolean,
): number {
  let y = startY;
  const indentX = bx + SECTION_INDENT_X;
  const contentW = bw - SECTION_CONTENT_WIDTH;

  drawText(ctx, label, { x: indentX, y, bold: true, size: SECTION_LABEL_SIZE, color: labelColor });
  y += SECTION_LABEL_Y_SPACING;

  if (compact) {
    const equippedCount = inventory.equippedItems().length;
    const bagCount =
      nonNullItems(inventory.bag.slots).length +
      nonNullItems(inventory.actionBar.slots.slice(0, QUEST_SLOT_IDX)).length;
    drawText(ctx, `Equipped: ${equippedCount}   Bag: ${bagCount}`, {
      x: indentX,
      y,
      size: COMPACT_SUMMARY_SIZE,
      color: '#94a3b8',
      width: contentW,
    });
    y += COMPACT_SUMMARY_Y_SPACING;

    const halfWidth = (bw - BUTTON_WIDTH_MARGIN - COMPACT_BUTTON_GAP) / 2;
    addButton(ctx, buttons, {
      x: bx + BUTTON_X_OFFSET,
      y,
      width: halfWidth,
      height: COMPACT_BUTTON_HEIGHT,
      label: COMPACT_EQUIPMENT_LABEL,
      ...BUTTON_PRESETS.primary,
      action: onManageEquipment,
    });
    addButton(ctx, buttons, {
      x: bx + BUTTON_X_OFFSET + halfWidth + COMPACT_BUTTON_GAP,
      y,
      width: halfWidth,
      height: COMPACT_BUTTON_HEIGHT,
      label: COMPACT_INVENTORY_LABEL,
      ...BUTTON_PRESETS.primary,
      action: onManage,
    });
    return y + COMPACT_BUTTON_HEIGHT + COMPACT_SECTION_GAP;
  }

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
      const isNew = inventory.unseenUpgrades.has(item.id);
      drawText(ctx, `${isNew ? '\u{1F7E2} ' : '  '}${item.name}${qty}`, {
        x: indentX,
        y,
        size: BAG_ITEM_SIZE,
        color: isNew ? '#86efac' : '#e2e8f0',
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
    label: equipmentLabel,
    ...BUTTON_PRESETS.primary,
    action: onManageEquipment,
  });
  y += EQUIPMENT_BUTTON_Y_SPACING;

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
  bh: number,
  human: HumanPlayer,
  cat: CatPlayer,
  setTab: (tab: PauseTab) => void,
  onManageHuman: () => void,
  onManageCat: () => void,
  onManageHumanEquipment: () => void,
  onManageCatEquipment: () => void,
): void {
  drawText(ctx, 'INVENTORY', {
    x: bx + bw / 2,
    y: by + TITLE_Y,
    bold: true,
    size: TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  const compact = bh < INVENTORY_TAB_BOX_H;
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
    'Manage Human Equipment',
    onManageHumanEquipment,
    compact,
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
    'Manage Cat Equipment',
    onManageCatEquipment,
    compact,
  );

  // Pinned to the box floor rather than flowed after the sections: on a phone
  // too short for the sections, Back is the only way out, so it must never
  // land below the box edge. The sections crowding it is the better failure.
  const flowedBackY = y;
  const pinnedBackY = by + bh - BACK_BUTTON_HEIGHT - BACK_BUTTON_BOTTOM_PAD;
  addButton(ctx, buttons, {
    x: bx + BACK_BUTTON_X,
    y: compact ? pinnedBackY : flowedBackY,
    width: bw - BACK_BUTTON_WIDTH_MARGIN,
    height: BACK_BUTTON_HEIGHT,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: () => setTab('main'),
  });
}

/** Height of title + two player sections + back, not counting the two Equipment buttons each section also draws. */
const BASE_INVENTORY_TAB_BOX_H = 530;

/** Conservative height estimate for the inventory tab modal: title + two player sections + back. */
export const INVENTORY_TAB_BOX_H = BASE_INVENTORY_TAB_BOX_H + EQUIPMENT_BUTTON_Y_SPACING * 2;
