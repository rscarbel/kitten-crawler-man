import type { Inventory } from '../core/Inventory';
import type { InventoryItem } from '../core/ItemDefs';
import { platform } from '../core/Platform';
import { pointInRect } from '../utils';
import { drawText } from './TextBox';
import { drawBox, drawDivider } from './Box';
import { drawButton } from './Button';
import { drawItemTooltip } from './ItemTooltip';
import {
  buildEquipSlotInfos,
  equipSectionTopY,
  equipSlotKeyAt,
  EQUIP_PANEL_PAD,
  EQUIP_SLOT_ORDER,
  type EquipSlotInfo,
} from './equipmentLayout';
import { viewportWidth, viewportHeight } from '../core/Viewport';

// Layout constants
const SLOT_SIZE = 46;
const SLOT_GAP = 3;
const PANEL_PAD = EQUIP_PANEL_PAD;
const HEADER_H = 40;

// Toggle button positioning
const TOGGLE_BTN_X_OFFSET = 252;
const TOGGLE_BTN_Y = 8;
const TOGGLE_BTN_W = 76;
const TOGGLE_BTN_H = 28;

// Panel sizing
const MAX_PANEL_HEIGHT = 420;
const PANEL_HEIGHT_MARGIN = 16;
const PANEL_X_MARGIN = 8;
const MIN_PANEL_Y_OFFSET = 8;

// Close button
const CLOSE_BTN_W = 16;
const CLOSE_BTN_H = 16;
const CLOSE_BTN_LABEL_SIZE = 11;
const CLOSE_BTN_X_OFFSET = 20;
const CLOSE_BTN_Y_OFFSET = 8;

// Equipment slot rendering
const ITEM_COLOR_BAR_MARGIN = 4;
const ITEM_COLOR_BAR_W = SLOT_SIZE - ITEM_COLOR_BAR_MARGIN;
const ITEM_COLOR_BAR_H = 3;
const ITEM_COLOR_BAR_X_OFFSET = 2;
const ITEM_COLOR_BAR_Y_OFFSET = 2;
const ITEM_NAME_Y_FRAC = 0.42;
const ITEM_NAME_Y_OFFSET = 6;
const ITEM_NAME_MAX_CHARS = 9;
const ITEM_LABEL_Y_OFFSET = 3;
const LABEL_MAX_CHARS = 7;
const LABEL_SUBSTRING_LEN = 7;

// Text rendering
const HEADER_TEXT_Y_OFFSET = 10;
const HEADER_TEXT_SIZE = 12;
const SLOT_LABEL_Y_FRAC = 0.5;
const SLOT_LABEL_Y_OFFSET = 7;
const SLOT_LABEL_SIZE = 9;
const TEXT_Y_BASELINE = 8;
const SECTION_NAME_SIZE = 9;

// Divider
const DIVIDER_X_OFFSET = 4;
const DIVIDER_WIDTH_OFFSET = 8;

const ITEM_NAME_LINE_HEIGHT_FRAC = 0.15;

/** What a click on the hovered slot will do, shown as the tooltip's last line. */
const TOOLTIP_UNEQUIP_FOOTER = '[Click] Unequip';

export interface GearClickResult {
  consumed: boolean;
  /** Set if clicking an equipped slot should unequip it. */
  unequippedItem?: InventoryItem;
  unequippedKey?: string;
}

export class GearPanel {
  isOpen = false;

  /** Hovered slot key for tooltip, updated in handleMouseMove. */
  private hoveredKey: string | null = null;
  /** Tooltip mouse position. */
  private tooltipMx = 0;
  private tooltipMy = 0;

  toggle(): void {
    this.isOpen = !this.isOpen;
  }

  toggleBtnRect() {
    return {
      x: viewportWidth() - TOGGLE_BTN_X_OFFSET,
      y: TOGGLE_BTN_Y,
      w: TOGGLE_BTN_W,
      h: TOGGLE_BTN_H,
    };
  }

  private panelRect() {
    const w = platform.gearPanelWidth(viewportWidth());
    const h = Math.min(MAX_PANEL_HEIGHT, viewportHeight() - PANEL_HEIGHT_MARGIN);
    const xOffset = platform.gearPanelXOffset;
    const x = Math.max(PANEL_X_MARGIN, Math.floor((viewportWidth() - w) / 2) + xOffset);
    const y = Math.max(MIN_PANEL_Y_OFFSET, Math.floor((viewportHeight() - h) / 2));
    return { x, y, w, h };
  }

  // Render

  render(ctx: CanvasRenderingContext2D, inventory: Inventory, playerName: string): void {
    if (this.isOpen) {
      this.renderPanel(ctx, inventory, playerName);
    }
  }

  private renderPanel(
    ctx: CanvasRenderingContext2D,
    inventory: Inventory,
    playerName: string,
  ): void {
    const p = this.panelRect();

    // Backdrop
    drawBox(ctx, {
      x: p.x,
      y: p.y,
      width: p.w,
      height: p.h,
      fill: 'rgba(8,10,20,0.93)',
      border: '#334155',
      borderWidth: 1.5,
    });

    // Header
    drawText(ctx, `${playerName} Equipment`, {
      x: p.x + PANEL_PAD,
      y: p.y + HEADER_H - HEADER_TEXT_Y_OFFSET,
      size: HEADER_TEXT_SIZE,
      bold: true,
      color: '#e2e8f0',
    });

    // Close [X]
    const closeX = p.x + p.w - CLOSE_BTN_X_OFFSET;
    const closeY = p.y + CLOSE_BTN_Y_OFFSET;
    drawButton(ctx, {
      x: closeX,
      y: closeY,
      width: CLOSE_BTN_W,
      height: CLOSE_BTN_H,
      label: 'x',
      fill: '#374151',
      border: '#475569',
      borderWidth: 1,
      radius: 2,
      labelSize: CLOSE_BTN_LABEL_SIZE,
      labelColor: '#ef4444',
    });

    // Divider
    drawDivider(ctx, {
      x: p.x + DIVIDER_X_OFFSET,
      y: p.y + HEADER_H,
      length: p.w - DIVIDER_WIDTH_OFFSET,
      color: '#1e293b',
    });

    const infos = this.slotInfos(p);
    let tooltipItem: InventoryItem | null = null;

    for (const slotName of EQUIP_SLOT_ORDER) {
      const sectionTop = equipSectionTopY(infos, slotName, p.y + HEADER_H + PANEL_PAD);
      drawText(ctx, slotName.toUpperCase(), {
        x: p.x + PANEL_PAD,
        y: sectionTop + SLOT_SIZE * SLOT_LABEL_Y_FRAC + SLOT_LABEL_Y_OFFSET - SLOT_LABEL_SIZE,
        size: SECTION_NAME_SIZE,
        bold: true,
        color: '#64748b',
      });
    }

    for (const si of infos) {
      const item = inventory.getEquippedItem(si.key);
      const isHovered = si.key === this.hoveredKey;
      this.renderEquipSlot(ctx, si.x, si.y, item, si.subSlot, isHovered);
      if (item && isHovered) tooltipItem = item;
    }

    if (tooltipItem) {
      drawItemTooltip(ctx, tooltipItem, this.tooltipMx, this.tooltipMy, TOOLTIP_UNEQUIP_FOOTER);
    }
  }

  private slotInfos(p: { x: number; y: number; w: number; h: number }): EquipSlotInfo[] {
    return buildEquipSlotInfos(p.x, p.y + HEADER_H + PANEL_PAD, p.w, SLOT_SIZE, SLOT_GAP);
  }

  private renderEquipSlot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    item: InventoryItem | null,
    label: string,
    hovered: boolean,
  ): void {
    ctx.save();

    // Slot background
    ctx.fillStyle = item ? '#0f1a2e' : '#1e293b';
    ctx.fillRect(x, y, SLOT_SIZE, SLOT_SIZE);
    ctx.strokeStyle = hovered ? '#93c5fd' : item ? '#3b82f6' : '#334155';
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.strokeRect(x, y, SLOT_SIZE, SLOT_SIZE);

    if (item) {
      // Item color indicator at top
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(
        x + ITEM_COLOR_BAR_X_OFFSET,
        y + ITEM_COLOR_BAR_Y_OFFSET,
        ITEM_COLOR_BAR_W,
        ITEM_COLOR_BAR_H,
      );

      // Item name (truncated, 2 lines max)
      const words = item.name.split(' ');
      let line1 = '';
      let line2 = '';
      for (const w of words) {
        if ((line1 + ' ' + w).trim().length <= ITEM_NAME_MAX_CHARS) {
          line1 = (line1 + ' ' + w).trim();
        } else if ((line2 + ' ' + w).trim().length <= ITEM_NAME_MAX_CHARS) {
          line2 = (line2 + ' ' + w).trim();
        }
      }
      const nameLine = line2 ? `${line1}\n${line2}` : line1;
      drawText(ctx, nameLine, {
        x: x + SLOT_SIZE / 2,
        y: y + SLOT_SIZE * ITEM_NAME_Y_FRAC - ITEM_NAME_Y_OFFSET,
        size: 7,
        color: '#94a3b8',
        align: 'center',
        lineHeight: Math.round(SLOT_SIZE * ITEM_NAME_LINE_HEIGHT_FRAC),
      });
    }

    // Sub-slot label at bottom
    const shortLabel =
      label.length > LABEL_MAX_CHARS ? label.substring(0, LABEL_SUBSTRING_LEN) : label;
    drawText(ctx, shortLabel, {
      x: x + SLOT_SIZE / 2,
      y: y + SLOT_SIZE - ITEM_LABEL_Y_OFFSET - TEXT_Y_BASELINE,
      size: 7,
      color: '#475569',
      align: 'center',
    });

    ctx.restore();
  }

  // Interaction

  handleMouseMove(mx: number, my: number): void {
    if (!this.isOpen) return;
    this.tooltipMx = mx;
    this.tooltipMy = my;
    const p = this.panelRect();
    this.hoveredKey = this.slotKeyAt(mx, my, p);
  }

  handleClick(mx: number, my: number, inventory: Inventory): GearClickResult | null {
    if (!this.isOpen) return null;

    const p = this.panelRect();

    // Close [X]
    const closeX = p.x + p.w - CLOSE_BTN_X_OFFSET;
    if (
      mx >= closeX &&
      mx <= closeX + CLOSE_BTN_W &&
      my >= p.y + CLOSE_BTN_Y_OFFSET &&
      my <= p.y + CLOSE_BTN_Y_OFFSET + CLOSE_BTN_H * 2
    ) {
      this.isOpen = false;
      return { consumed: true };
    }

    // Check equipped slot click → unequip
    const key = this.slotKeyAt(mx, my, p);
    if (key) {
      const item = inventory.getEquippedItem(key);
      if (item) {
        inventory.unequip(key);
        return { consumed: true, unequippedItem: item, unequippedKey: key };
      }
      return { consumed: true };
    }

    // Absorb all clicks inside panel
    if (pointInRect(mx, my, p)) {
      return { consumed: true };
    }

    return null;
  }

  private slotKeyAt(
    mx: number,
    my: number,
    p: { x: number; y: number; w: number; h: number },
  ): string | null {
    return equipSlotKeyAt(mx, my, this.slotInfos(p), SLOT_SIZE);
  }
}
