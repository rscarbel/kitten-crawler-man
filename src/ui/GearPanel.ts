import type { Inventory } from '../core/Inventory';
import { EQUIP_SUBSLOTS } from '../core/ItemDefs';
import type { EquipSlot, InventoryItem } from '../core/ItemDefs';
import { platform } from '../core/Platform';
import { pointInRect } from '../utils';
import { drawText } from './TextBox';
import { drawBox, drawDivider, BOX_PRESETS } from './Box';
import { drawButton } from './Button';

// Layout constants
const SLOT_SIZE = 46;
const SLOT_GAP = 3;
const PANEL_PAD = 12;
const HEADER_H = 40;
const SECTION_LABEL_W = 52;

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

// Tooltip
const TOOLTIP_WIDTH = 230;
const TOOLTIP_LINE_HEIGHT = 14;
const TOOLTIP_PAD = 12;
const TOOLTIP_X_OFFSET = 10;
const TOOLTIP_Y_OFFSET = 4;
const TOOLTIP_MARGIN = 4;
const TOOLTIP_MARGIN_SMALL = 2;
const TOOLTIP_TEXT_INDENT = 6;
const TOOLTIP_TITLE_Y_OFFSET = 8;
const TOOLTIP_TITLE_SIZE = 10;
const TOOLTIP_BODY_Y_OFFSET = 8;
const TOOLTIP_BODY_SIZE = 10;
const DESC_WRAP_CHARS = 34;
const SECTION_PAD = 8;
const ITEM_NAME_LINE_HEIGHT_FRAC = 0.15;

const SLOT_ORDER: EquipSlot[] = ['Head', 'Torso', 'Legs', 'Hands', 'Feet'];

/** Screen rect for a single equipment sub-slot given the panel origin and position. */
interface SlotInfo {
  key: string;
  slot: EquipSlot;
  subSlot: string;
  x: number;
  y: number;
}

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

  toggleBtnRect(canvas: HTMLCanvasElement) {
    return {
      x: canvas.width - TOGGLE_BTN_X_OFFSET,
      y: TOGGLE_BTN_Y,
      w: TOGGLE_BTN_W,
      h: TOGGLE_BTN_H,
    };
  }

  private panelRect(canvas: HTMLCanvasElement) {
    const w = platform.gearPanelWidth(canvas.width);
    const h = Math.min(MAX_PANEL_HEIGHT, canvas.height - PANEL_HEIGHT_MARGIN);
    const xOffset = platform.gearPanelXOffset;
    const x = Math.max(PANEL_X_MARGIN, Math.floor((canvas.width - w) / 2) + xOffset);
    const y = Math.max(MIN_PANEL_Y_OFFSET, Math.floor((canvas.height - h) / 2));
    return { x, y, w, h };
  }

  // Render

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    playerName: string,
  ): void {
    this.renderToggleButton(ctx, canvas);
    if (this.isOpen) {
      this.renderPanel(ctx, canvas, inventory, playerName);
    }
  }

  private renderToggleButton(_ctx: CanvasRenderingContext2D, _canvas: HTMLCanvasElement): void {
    // Gear button removed — gear panel is accessible only from the pause menu
  }

  private renderPanel(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    playerName: string,
  ): void {
    const p = this.panelRect(canvas);

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

    // Render sections
    let currentY = p.y + HEADER_H + PANEL_PAD;
    let tooltipItem: InventoryItem | null = null;
    let tooltipSubSlot = '';

    for (const slotName of SLOT_ORDER) {
      const subSlots = EQUIP_SUBSLOTS[slotName];
      const slotsInfos = this.buildSlotInfos(slotName, subSlots, p.x, currentY, p.w);

      // Section label
      drawText(ctx, slotName.toUpperCase(), {
        x: p.x + PANEL_PAD,
        y: currentY + SLOT_SIZE * SLOT_LABEL_Y_FRAC + SLOT_LABEL_Y_OFFSET - SLOT_LABEL_SIZE,
        size: SECTION_NAME_SIZE,
        bold: true,
        color: '#64748b',
      });

      // Find max row used
      let maxY = currentY;
      for (const si of slotsInfos) {
        const item = inventory.getEquippedItem(si.key);
        const isHovered = si.key === this.hoveredKey;
        this.renderEquipSlot(ctx, si.x, si.y, item, si.subSlot, isHovered);
        if (item && si.key === this.hoveredKey) {
          tooltipItem = item;
          tooltipSubSlot = si.subSlot;
        }
        maxY = Math.max(maxY, si.y + SLOT_SIZE);
      }
      currentY = maxY + SECTION_PAD;
    }

    // Tooltip
    if (tooltipItem) {
      this.renderTooltip(ctx, canvas, tooltipItem, tooltipSubSlot);
    }
  }

  /** Build screen positions for each sub-slot in a section. */
  private buildSlotInfos(
    slotName: EquipSlot,
    subSlots: string[],
    panelX: number,
    startY: number,
    panelW: number,
  ): SlotInfo[] {
    const infos: SlotInfo[] = [];
    const startX = panelX + PANEL_PAD + SECTION_LABEL_W;
    const maxPerRow = Math.floor(
      (panelW - PANEL_PAD * 2 - SECTION_LABEL_W) / (SLOT_SIZE + SLOT_GAP),
    );

    for (let i = 0; i < subSlots.length; i++) {
      const col = i % maxPerRow;
      const row = Math.floor(i / maxPerRow);
      infos.push({
        key: `${slotName}:${subSlots[i]}`,
        slot: slotName,
        subSlot: subSlots[i],
        x: startX + col * (SLOT_SIZE + SLOT_GAP),
        y: startY + row * (SLOT_SIZE + SLOT_GAP),
      });
    }
    return infos;
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

  private renderTooltip(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    item: InventoryItem,
    _subSlot: string,
  ): void {
    const lines: string[] = [item.name];
    if (item.statBonus) {
      const b = item.statBonus;
      if (b.constitution) lines.push(`+${b.constitution} Constitution`);
      if (b.strength) lines.push(`+${b.strength} Strength`);
      if (b.intelligence) lines.push(`+${b.intelligence} Intelligence`);
    }
    lines.push('');
    if (item.description) {
      // Word-wrap description at ~34 chars to fit inside the tooltip box
      const words = item.description.split(' ');
      let cur = '';
      for (const w of words) {
        if ((cur + ' ' + w).trim().length <= DESC_WRAP_CHARS) {
          cur = (cur + ' ' + w).trim();
        } else {
          lines.push(cur);
          cur = w;
        }
      }
      if (cur) lines.push(cur);
    }
    lines.push('');
    lines.push('[Click] Unequip');

    const tw = TOOLTIP_WIDTH;
    const lineH = TOOLTIP_LINE_HEIGHT;
    const th = lines.length * lineH + TOOLTIP_PAD;
    const tx = Math.min(this.tooltipMx + TOOLTIP_X_OFFSET, canvas.width - tw - TOOLTIP_MARGIN);
    let ty = Math.min(this.tooltipMy - th / 2, canvas.height - th - TOOLTIP_MARGIN);
    ty = Math.max(ty, TOOLTIP_Y_OFFSET);

    ctx.save();
    drawBox(ctx, { x: tx, y: ty, width: tw, height: th, ...BOX_PRESETS.tooltip });

    // Clip all text to the tooltip box so nothing overflows
    ctx.beginPath();
    ctx.rect(
      tx + TOOLTIP_MARGIN_SMALL,
      ty + TOOLTIP_MARGIN_SMALL,
      tw - TOOLTIP_MARGIN_SMALL * 2,
      th - TOOLTIP_MARGIN_SMALL * 2,
    );
    ctx.clip();

    // Title line
    drawText(ctx, lines[0] ?? '', {
      x: tx + TOOLTIP_TEXT_INDENT,
      y: ty + TOOLTIP_LINE_HEIGHT - TOOLTIP_TITLE_Y_OFFSET,
      size: TOOLTIP_TITLE_SIZE,
      bold: true,
      color: '#e2e8f0',
    });

    // Body lines (each with per-line color)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      let lineColor: string;
      if (line.startsWith('+')) {
        lineColor = '#4ade80';
      } else if (line.startsWith('Ability:')) {
        lineColor = '#c084fc';
      } else if (line.startsWith('[Click]')) {
        lineColor = '#64748b';
      } else {
        lineColor = '#94a3b8';
      }
      drawText(ctx, line, {
        x: tx + TOOLTIP_TEXT_INDENT,
        y: ty + TOOLTIP_LINE_HEIGHT + i * lineH - TOOLTIP_BODY_Y_OFFSET,
        size: TOOLTIP_BODY_SIZE,
        color: lineColor,
      });
    }
    ctx.restore();
  }

  // Interaction

  handleMouseMove(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    if (!this.isOpen) return;
    this.tooltipMx = mx;
    this.tooltipMy = my;
    const p = this.panelRect(canvas);
    this.hoveredKey = this.slotKeyAt(mx, my, p, inventory);
  }

  handleClick(
    mx: number,
    my: number,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
  ): GearClickResult | null {
    if (!this.isOpen) return null;

    const p = this.panelRect(canvas);

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
    const key = this.slotKeyAt(mx, my, p, inventory);
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
    _inventory: Inventory,
  ): string | null {
    let currentY = p.y + HEADER_H + PANEL_PAD;
    for (const slotName of SLOT_ORDER) {
      const subSlots = EQUIP_SUBSLOTS[slotName];
      const infos = this.buildSlotInfos(slotName, subSlots, p.x, currentY, p.w);
      let maxY = currentY;
      for (const si of infos) {
        if (mx >= si.x && mx <= si.x + SLOT_SIZE && my >= si.y && my <= si.y + SLOT_SIZE) {
          return si.key;
        }
        maxY = Math.max(maxY, si.y + SLOT_SIZE);
      }
      currentY = maxY + SECTION_PAD;
    }
    return null;
  }
}
