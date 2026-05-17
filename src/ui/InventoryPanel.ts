import type { Inventory } from '../core/Inventory';
import { HOTBAR_COUNT, SLOTS_PER_PAGE, QUEST_SLOT_IDX } from '../core/ItemDefs';
import type { InventoryItem } from '../core/ItemDefs';
import { drawSpriteKey } from '../core/SpriteRenderer';
import { platform } from '../core/Platform';
import { drawDynamiteInventoryIcon } from '../sprites/dynamiteSprite';
import {
  drawDumbbellInventoryIcon,
  drawBenchPressInventoryIcon,
  drawTreadmillInventoryIcon,
} from '../sprites/gymEquipmentSprite';
import { drawWoodPileSprite } from '../sprites/questNPCSprite';
import { InventoryInteraction } from './InventoryInteraction';
import { drawText } from './TextBox';
import { pointInRect } from '../utils';
import { drawBox, drawDivider, BOX_PRESETS } from './Box';
import { drawButton, BUTTON_PRESETS } from './Button';

// Layout constants
const SLOT_SIZE = 54;
const SLOT_GAP = 4;
const COLS = 4;
const ROWS_PER_PAGE = 4; // 4×4 = 16 slots per page
const PANEL_PAD = 12;
const HEADER_H = 40;
const NAV_H = 28;

const HOTBAR_SLOT_SIZE = 52;
const HOTBAR_GAP = 4;
const HOTBAR_BOTTOM_MARGIN = 12;

/** How many pages are needed for the full slot array. */
function pageCount(slotCount: number): number {
  return Math.max(1, Math.ceil(slotCount / SLOTS_PER_PAGE));
}

export class InventoryPanel {
  isOpen = false;
  private page = 0;

  /** Interaction handler — owns drag, context menu, and pending action state. */
  readonly interaction = new InventoryInteraction();

  private get drag() {
    return this.interaction.drag;
  }
  private get contextMenu() {
    return this.interaction.contextMenu;
  }
  private get contextMenuHover() {
    return this.interaction.contextMenuHover;
  }
  private get dropDialog() {
    return this.interaction.dropDialog;
  }

  cancelDrag(): void {
    this.interaction.cancelDrag();
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
  }

  // Layout helpers

  toggleBtnRect(canvas: HTMLCanvasElement) {
    return { x: canvas.width - 168, y: 8, w: 72, h: 28 };
  }

  /**
   * Optional per-ability cooldown fractions (0=ready, 1=full cooldown).
   * Set by DungeonScene each frame to show cooldown overlays in hotbar.
   */
  abilityCooldowns = new Map<string, { current: number; max: number }>();

  /**
   * Returns the inventory slot index if (mx, my) is on an inventory slot in the
   * currently-visible page, or null otherwise. Used by DungeonScene for equip-on-click.
   */
  getClickedInventorySlot(
    mx: number,
    my: number,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
  ): number | null {
    if (!this.isOpen) return null;
    const p = this.panelRect(canvas);
    const pageStart = this.page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      if (slotIdx >= inventory.bag.slots.length) break;
      const r = this.invSlotRect(i, p);
      if (pointInRect(mx, my, r)) return slotIdx;
    }
    return null;
  }

  private panelRect(canvas: HTMLCanvasElement) {
    const innerW = COLS * (SLOT_SIZE + SLOT_GAP) - SLOT_GAP;
    const innerH = ROWS_PER_PAGE * (SLOT_SIZE + SLOT_GAP) - SLOT_GAP;
    const w = innerW + PANEL_PAD * 2;
    const h = HEADER_H + PANEL_PAD + innerH + PANEL_PAD + NAV_H;
    return {
      x: Math.floor((canvas.width - w) / 2),
      y: Math.floor((canvas.height - h) / 2),
      w,
      h,
    };
  }

  private computedHotbarSlotSize(canvas: HTMLCanvasElement): number {
    const margin = 20;
    const available = canvas.width - margin * 2 - HOTBAR_GAP * (HOTBAR_COUNT - 1);
    return Math.min(HOTBAR_SLOT_SIZE, Math.floor(available / HOTBAR_COUNT));
  }

  private hotbarRect(canvas: HTMLCanvasElement) {
    const s = this.computedHotbarSlotSize(canvas);
    const w = HOTBAR_COUNT * (s + HOTBAR_GAP) - HOTBAR_GAP;
    return {
      x: Math.floor((canvas.width - w) / 2),
      y: canvas.height - s - HOTBAR_BOTTOM_MARGIN,
      w,
      h: s,
      slotSize: s,
    };
  }

  /** Screen rect for a slot in the paginated grid. `i` is position on current page (0–15). */
  private invSlotRect(i: number, panel: { x: number; y: number }) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return {
      x: panel.x + PANEL_PAD + col * (SLOT_SIZE + SLOT_GAP),
      y: panel.y + HEADER_H + PANEL_PAD + row * (SLOT_SIZE + SLOT_GAP),
      w: SLOT_SIZE,
      h: SLOT_SIZE,
    };
  }

  private hotbarSlotRect(i: number, canvas: HTMLCanvasElement) {
    const hb = this.hotbarRect(canvas);
    return {
      x: hb.x + i * (hb.slotSize + HOTBAR_GAP),
      y: hb.y,
      w: hb.slotSize,
      h: hb.slotSize,
    };
  }

  /** Returns hotbar slot index (0–7) if (mx, my) hits a slot, else -1. */
  getHotbarTappedIndex(mx: number, my: number, canvas: HTMLCanvasElement): number {
    const hb = this.hotbarRect(canvas);
    if (my < hb.y - 12 || my > hb.y + hb.h + 12) return -1;
    for (let i = 0; i < HOTBAR_COUNT; i++) {
      const r = this.hotbarSlotRect(i, canvas);
      if (mx >= r.x && mx <= r.x + r.w) return i;
    }
    return -1;
  }

  /** True if (mx, my) is within the open inventory panel area. */
  hitsPanel(mx: number, my: number, canvas: HTMLCanvasElement): boolean {
    if (!this.isOpen) return false;
    const p = this.panelRect(canvas);
    return pointInRect(mx, my, p);
  }

  /** True while an item is being dragged. */
  get isDragging(): boolean {
    return this.drag !== null;
  }

  // Render

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    playerName: string,
    coins: number,
  ): void {
    this.renderToggleButton(ctx, canvas);
    this.renderHotbar(ctx, canvas, inventory);
    if (this.isOpen) {
      this.renderPanel(ctx, canvas, inventory, playerName, coins);
    }
    // Dragged item floats on top of everything
    if (this.drag) {
      const s = SLOT_SIZE;
      this.renderItemIcon(ctx, this.drag.item, this.drag.mx - s / 2, this.drag.my - s / 2, s, 0.75);
    }

    // Context menu and info popup render above everything else
    if (this.contextMenu) {
      this.renderContextMenu(ctx, canvas);
    }
    if (this.interaction.pendingInfoItem) {
      this.renderInfoPopup(ctx, canvas, this.interaction.pendingInfoItem);
    }
    if (this.dropDialog) {
      this.renderDropDialog(ctx, canvas);
    }
  }

  private renderContextMenu(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cm = this.contextMenu;
    if (!cm) return;
    const options = this.interaction.contextMenuOptions(cm.item, cm.source, cm.isEquipped);
    const menuW = 120;
    const menuItemH = 22;
    const menuH = options.length * menuItemH + 4;
    const mx = Math.min(cm.x, canvas.width - menuW - 4);
    const my = Math.min(cm.y, canvas.height - menuH - 4);

    ctx.save();
    drawBox(ctx, {
      x: mx,
      y: my,
      width: menuW,
      height: menuH,
      fill: 'rgba(10,14,30,0.97)',
      border: '#475569',
      borderWidth: 1,
    });

    for (let i = 0; i < options.length; i++) {
      const oy = my + 2 + i * menuItemH;
      if (this.contextMenuHover === i) {
        ctx.fillStyle = 'rgba(59,130,246,0.3)';
        ctx.fillRect(mx + 1, oy, menuW - 2, menuItemH);
      }
      const color =
        options[i] === 'Equip' ? '#4ade80' : options[i] === 'Unequip' ? '#f87171' : '#e2e8f0';
      // baseline_y=oy+15, size=11 → top_y = oy+15-9 = oy+6
      drawText(ctx, options[i], { x: mx + 8, y: oy + 6, size: 11, color });
    }
    ctx.restore();
  }

  private renderInfoPopup(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    item: InventoryItem,
  ): void {
    const popW = Math.min(280, canvas.width - 32);
    const lineH = 15;
    const pad = 10;

    const descText = item.description ?? 'No description available.';

    // Estimate popup height: title line + divider space + description lines + hint
    // Use a rough line estimate for pre-draw sizing (similar to original)
    const approxDescLines = Math.ceil(descText.length / 36) || 1;
    const popH = pad + lineH + pad * 0.5 + approxDescLines * lineH + pad;
    const px = Math.floor((canvas.width - popW) / 2);
    const py = Math.floor((canvas.height - popH) / 2);

    ctx.save();
    drawBox(ctx, {
      x: px,
      y: py,
      width: popW,
      height: popH,
      ...BOX_PRESETS.tooltip,
      borderWidth: 1.5,
    });

    // Title: baseline_y = py+pad+lineH-3, size=11 → top_y = baseline_y - 9
    drawText(ctx, item.name, {
      x: px + pad,
      y: py + pad + lineH - 3 - 9,
      bold: true,
      size: 11,
      color: '#e2e8f0',
    });

    // Divider
    drawDivider(ctx, { x: px + 4, y: py + pad + lineH + 2, length: popW - 8, color: '#1e293b' });

    // Description with built-in word-wrap
    // baseline_y = py+pad*1.5+lineH*2-3, size=10 → top_y = baseline_y - 8
    drawText(ctx, descText, {
      x: px + pad,
      y: py + pad * 1.5 + lineH * 2 - 3 - 8,
      size: 10,
      color: '#94a3b8',
      width: popW - pad * 2,
      lineHeight: lineH,
    });

    // Close hint: baseline_y = py+popH-4, size=9 → top_y = baseline_y - 7
    drawText(ctx, '[Click anywhere to close]', {
      x: px + popW / 2,
      y: py + popH - 4 - 7,
      size: 9,
      color: '#475569',
      align: 'center',
    });

    ctx.restore();
  }

  private renderDropDialog(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const dd = this.dropDialog;
    if (!dd) return;
    const dlgW = Math.min(200, canvas.width - 32);
    const dlgH = 110;
    const dlgX = Math.floor((canvas.width - dlgW) / 2);
    const dlgY = Math.floor((canvas.height - dlgH) / 2);

    ctx.save();
    // Background
    drawBox(ctx, {
      x: dlgX,
      y: dlgY,
      width: dlgW,
      height: dlgH,
      fill: 'rgba(8,10,20,0.97)',
      border: '#475569',
      borderWidth: 1.5,
    });

    // Title: baseline_y=dlgY+22, size=11 → top_y = dlgY+22-9 = dlgY+13
    drawText(ctx, 'Drop how many?', {
      x: dlgX + dlgW / 2,
      y: dlgY + 13,
      size: 11,
      bold: true,
      color: '#e2e8f0',
      align: 'center',
    });

    // Cancel [X]
    drawButton(ctx, {
      x: dlgX + dlgW - 22,
      y: dlgY + 6,
      width: 16,
      height: 16,
      label: 'x',
      fill: '#374151',
      border: '#475569',
      borderWidth: 1,
      radius: 2,
      labelSize: 11,
      labelColor: '#ef4444',
    });

    // [-] button
    const minusBtnX = dlgX + 20;
    const minusBtnY = dlgY + 54;
    drawButton(ctx, {
      x: minusBtnX,
      y: minusBtnY,
      width: 24,
      height: 24,
      label: '-',
      ...BUTTON_PRESETS.primary,
      border: '#475569',
      labelSize: 11,
    });

    // [+] button
    const plusBtnX = dlgX + dlgW - 44;
    drawButton(ctx, {
      x: plusBtnX,
      y: minusBtnY,
      width: 24,
      height: 24,
      label: '+',
      ...BUTTON_PRESETS.primary,
      border: '#475569',
      labelSize: 11,
    });

    // Quantity display: baseline_y=minusBtnY+18, size=16 → top_y = minusBtnY+18-13 = minusBtnY+5
    drawText(ctx, dd.selectedQty.toString(), {
      x: dlgX + dlgW / 2,
      y: minusBtnY + 5,
      size: 16,
      bold: true,
      color: '#fbbf24',
      align: 'center',
    });

    // Max hint: baseline_y=minusBtnY+18, size=9 → top_y = minusBtnY+18-7 = minusBtnY+11
    drawText(ctx, `/ ${dd.maxQty}`, {
      x: dlgX + dlgW / 2 + 14,
      y: minusBtnY + 11,
      size: 9,
      color: '#64748b',
    });

    // [Drop] confirm button
    const confirmY = dlgY + dlgH - 28;
    drawButton(ctx, {
      x: dlgX + 20,
      y: confirmY,
      width: dlgW - 40,
      height: 22,
      label: 'Drop',
      fill: '#1d4ed8',
      border: '#3b82f6',
      borderWidth: 1.5,
      radius: 4,
      labelSize: 11,
    });

    ctx.restore();
  }

  private renderToggleButton(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    // On mobile the button is drawn by MobileHUDSystem instead
    if (!platform.showDesktopToggleButtons) return;
    const btn = this.toggleBtnRect(canvas);
    drawButton(ctx, {
      x: btn.x,
      y: btn.y,
      width: btn.w,
      height: btn.h,
      label: 'Bag [I]',
      ...(this.isOpen ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
    });
  }

  private renderHotbar(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
  ): void {
    const hb = this.hotbarRect(canvas);
    // Background strip
    drawBox(ctx, {
      x: hb.x - 6,
      y: hb.y - 6,
      width: hb.w + 12,
      height: hb.h + 18,
      fill: 'rgba(0,0,0,0.65)',
    });

    for (let i = 0; i < HOTBAR_COUNT; i++) {
      const r = this.hotbarSlotRect(i, canvas);
      const isDragged = this.drag?.source === 'hotbar' && this.drag.idx === i;
      this.renderSlot(ctx, r.x, r.y, r.w, inventory.actionBar.slots[i], isDragged, true);

      // Separator line before quest slot
      if (i === QUEST_SLOT_IDX) {
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x - 2, r.y + 2);
        ctx.lineTo(r.x - 2, r.y + r.h - 2);
        ctx.stroke();
      }

      // Key label below slot — "Q" for quest slot, number for the rest
      const keyLabel = i === QUEST_SLOT_IDX ? 'Q' : (i + 1).toString();
      const keyColor = i === QUEST_SLOT_IDX ? '#fbbf24' : '#64748b';
      // baseline_y = r.y+r.h+11, size=9 → top_y = baseline_y - 7 = r.y+r.h+4
      drawText(ctx, keyLabel, {
        x: r.x + r.w / 2,
        y: r.y + r.h + 4,
        size: 9,
        color: keyColor,
        align: 'center',
      });
    }
  }

  private renderPanel(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    playerName: string,
    coins: number,
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

    // Header — player name: baseline_y=p.y+25, size=12 → top_y = p.y+25-10 = p.y+15
    drawText(ctx, `${playerName} Inventory`, {
      x: p.x + PANEL_PAD,
      y: p.y + 15,
      bold: true,
      size: 12,
      color: '#e2e8f0',
    });

    // Coins: baseline_y=p.y+25, size=11 → top_y = p.y+25-9 = p.y+16
    drawText(ctx, `\u{1FA99} ${coins}`, {
      x: p.x + p.w - 36,
      y: p.y + 16,
      size: 11,
      color: '#fbbf24',
      align: 'right',
    });

    // Close [X]
    const closeX = p.x + p.w - 20;
    const closeY = p.y + 8;
    drawButton(ctx, {
      x: closeX,
      y: closeY,
      width: 16,
      height: 16,
      label: 'x',
      fill: '#374151',
      border: '#475569',
      borderWidth: 1,
      radius: 2,
      labelSize: 11,
      labelColor: '#ef4444',
    });

    // Divider
    drawDivider(ctx, { x: p.x + 4, y: p.y + HEADER_H, length: p.w - 8, color: '#1e293b' });

    // Inventory slots
    const pageStart = this.page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      const item = slotIdx < inventory.bag.slots.length ? inventory.bag.slots[slotIdx] : null;
      const isDragged = this.drag?.source === 'inv' && this.drag.idx === slotIdx;
      const r = this.invSlotRect(i, p);
      this.renderSlot(
        ctx,
        r.x,
        r.y,
        r.w,
        item,
        isDragged,
        false,
        inventory.isSlotEquipped(slotIdx),
      );
    }

    // Pagination bar
    const pages = pageCount(inventory.bag.slots.length);
    const navY = p.y + p.h - NAV_H + 6;
    // baseline_y=navY, size=11 → top_y = navY - 9
    const navTopY = navY - 9;
    if (pages > 1) {
      // Prev arrow
      drawText(ctx, '< Prev', {
        x: p.x + p.w * 0.25,
        y: navTopY,
        size: 11,
        color: this.page > 0 ? '#94a3b8' : '#374151',
        align: 'center',
      });
      // Next arrow
      drawText(ctx, 'Next >', {
        x: p.x + p.w * 0.75,
        y: navTopY,
        size: 11,
        color: this.page < pages - 1 ? '#94a3b8' : '#374151',
        align: 'center',
      });
    }
    drawText(ctx, `${this.page + 1} / ${pages}`, {
      x: p.x + p.w / 2,
      y: navTopY,
      size: 11,
      color: '#64748b',
      align: 'center',
    });
  }

  private renderSlot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    item: InventoryItem | null,
    dimmed: boolean,
    isHotbar: boolean,
    isEquipped = false,
  ): void {
    ctx.save();
    if (dimmed) ctx.globalAlpha = 0.25;

    const isQuestItem = isHotbar && item?.isQuestItem;
    ctx.fillStyle = isQuestItem ? '#1a2940' : isHotbar ? '#0f172a' : '#1e293b';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = isQuestItem
      ? '#fbbf24'
      : isEquipped
        ? '#3b82f6'
        : isHotbar
          ? '#475569'
          : '#334155';
    ctx.lineWidth = isEquipped ? 2 : 1;
    ctx.strokeRect(x, y, size, size);

    if (item && !dimmed) {
      this.renderItemIcon(ctx, item, x, y, size, 1);
    } else if (item && dimmed) {
      ctx.globalAlpha = 0.25;
      this.renderItemIcon(ctx, item, x, y, size, 1);
    }

    // Equipped icon badge (top-left corner)
    if (isEquipped && item && !dimmed) {
      ctx.save();
      ctx.globalAlpha = 1;
      const badgeSize = Math.floor(size * 0.3);
      const bx = x + 1;
      const by = y + 1;
      // Green badge background
      ctx.fillStyle = 'rgba(16,185,129,0.9)';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + badgeSize, by);
      ctx.lineTo(bx, by + badgeSize);
      ctx.closePath();
      ctx.fill();
      // White "E" letter — original used textBaseline='top' so y=by+1 is already the top
      drawText(ctx, 'E', {
        x: bx + 1,
        y: by + 1,
        size: Math.floor(badgeSize * 0.55),
        bold: true,
        color: '#fff',
        align: 'left',
      });
      ctx.restore();
    }

    // Ability cooldown overlay on hotbar
    if (isHotbar && item?.abilityId) {
      const cd = this.abilityCooldowns.get(item.abilityId);
      if (cd && cd.current > 0) {
        const frac = cd.current / cd.max;
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(x, y + size * (1 - frac), size, size * frac);
        ctx.globalAlpha = 1;
        // Remaining seconds
        const secs = Math.ceil(cd.current / 60);
        const cdFontSize = Math.floor(size * 0.28);
        // baseline_y = y+size/2+4, cdFontSize → top_y = baseline_y - Math.round(cdFontSize*0.8)
        const cdTopY = y + size / 2 + 4 - Math.round(cdFontSize * 0.8);
        drawText(ctx, secs > 99 ? '…' : `${secs}`, {
          x: x + size / 2,
          y: cdTopY,
          size: cdFontSize,
          bold: true,
          color: '#e2e8f0',
          align: 'center',
        });
      }
    }

    ctx.restore();
  }

  private renderItemIcon(
    ctx: CanvasRenderingContext2D,
    item: InventoryItem,
    x: number,
    y: number,
    size: number,
    alpha: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * alpha;

    if (item.id === 'health_potion') {
      const cx = x + size * 0.5;
      const cy = y + size * 0.58;
      const r = size * 0.27;
      // Flask body
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // Liquid fill
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.15, r * 0.78, 0, Math.PI * 2);
      ctx.fill();
      // Flask neck
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(cx - size * 0.08, y + size * 0.22, size * 0.16, size * 0.2);
      // Cork stopper
      ctx.fillStyle = '#92400e';
      ctx.fillRect(cx - size * 0.1, y + size * 0.17, size * 0.2, size * 0.08);
      // Shine highlight
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.3, cy - r * 0.3, r * 0.22, r * 0.13, -0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (item.id === 'scroll_of_confusing_fog') {
      const cx = x + size * 0.5;
      const cy = y + size * 0.55;
      const sw = size * 0.52;
      const sh = size * 0.42;
      // Parchment body
      ctx.fillStyle = '#d4b483';
      ctx.fillRect(cx - sw / 2, cy - sh / 2, sw, sh);
      ctx.strokeStyle = '#8b6914';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - sw / 2, cy - sh / 2, sw, sh);
      // Rolled top and bottom edges
      ctx.fillStyle = '#c49a40';
      ctx.fillRect(cx - sw / 2 - 3, cy - sh / 2 - 2, sw + 6, 6);
      ctx.fillRect(cx - sw / 2 - 3, cy + sh / 2 - 4, sw + 6, 6);
      // Fog squiggle lines
      ctx.strokeStyle = '#1e3a5f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let row = 0; row < 3; row++) {
        const ly = cy - sh / 2 + 8 + row * 9;
        ctx.moveTo(cx - sw * 0.35, ly);
        ctx.bezierCurveTo(cx - sw * 0.1, ly - 4, cx + sw * 0.1, ly + 4, cx + sw * 0.35, ly);
      }
      ctx.stroke();
      // Green fog tint glow
      ctx.fillStyle = 'rgba(60,200,140,0.28)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, sw * 0.45, sh * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (item.id === 'magic_missile_tome') {
      drawSpriteKey(ctx, 'magic_missile_icon', 'standard', 0, x, y, size);
    }

    if (item.id === 'smush_tome') {
      drawSpriteKey(ctx, 'smush_icon', 'standard', 0, x, y, size);
    }

    if (item.id === 'enchanted_bigboi_boxers') {
      const cx = x + size * 0.5;
      const cy = y + size * 0.56;
      // Waistband — white/light grey
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(x + size * 0.12, y + size * 0.22, size * 0.76, size * 0.18);
      // Left leg — near-white
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.32, y + size * 0.38);
      ctx.lineTo(cx - size * 0.38, y + size * 0.72);
      ctx.lineTo(cx - size * 0.05, y + size * 0.72);
      ctx.lineTo(cx, y + size * 0.38);
      ctx.closePath();
      ctx.fill();
      // Right leg
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.32, y + size * 0.38);
      ctx.lineTo(cx + size * 0.38, y + size * 0.72);
      ctx.lineTo(cx + size * 0.05, y + size * 0.72);
      ctx.lineTo(cx, y + size * 0.38);
      ctx.closePath();
      ctx.fill();
      // Red hearts pattern — sprite icon text, leave as ctx.fillText
      ctx.fillStyle = '#ef4444';
      ctx.font = `bold ${Math.floor(size * 0.18)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('♥', cx - size * 0.16, cy - size * 0.08);
      ctx.fillText('♥', cx + size * 0.16, cy - size * 0.08);
      ctx.fillText('♥', cx, cy + size * 0.08);
      ctx.textAlign = 'left';
      // Red border glow
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }

    if (item.id === 'trollskin_shirt') {
      const cx = x + size * 0.5;
      const cy = y + size * 0.52;
      // Shirt body — mossy green (trollskin)
      ctx.fillStyle = '#4a7c59';
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.3, cy - size * 0.14);
      ctx.lineTo(cx + size * 0.3, cy - size * 0.14);
      ctx.lineTo(cx + size * 0.28, cy + size * 0.28);
      ctx.lineTo(cx - size * 0.28, cy + size * 0.28);
      ctx.closePath();
      ctx.fill();
      // Sleeves
      ctx.fillStyle = '#3d6b4a';
      // Left sleeve
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.3, cy - size * 0.14);
      ctx.lineTo(cx - size * 0.42, cy + size * 0.04);
      ctx.lineTo(cx - size * 0.32, cy + size * 0.08);
      ctx.lineTo(cx - size * 0.26, cy - size * 0.02);
      ctx.closePath();
      ctx.fill();
      // Right sleeve
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.3, cy - size * 0.14);
      ctx.lineTo(cx + size * 0.42, cy + size * 0.04);
      ctx.lineTo(cx + size * 0.32, cy + size * 0.08);
      ctx.lineTo(cx + size * 0.26, cy - size * 0.02);
      ctx.closePath();
      ctx.fill();
      // Collar
      ctx.fillStyle = '#2d5a3a';
      ctx.beginPath();
      ctx.ellipse(cx, cy - size * 0.16, size * 0.1, size * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      // Enchantment rune — golden fist symbol (sprite icon text, leave as ctx.fillText)
      ctx.fillStyle = '#ffd700';
      ctx.font = `bold ${Math.floor(size * 0.22)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('\u{270A}', cx, cy + size * 0.14);
      ctx.textAlign = 'left';
      // Golden border glow
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }

    if (item.id === 'enchanted_crown_sepsis_whore') {
      const cx = x + size * 0.5;
      const cy = y + size * 0.48;
      // Crown base band — deep purple
      ctx.fillStyle = '#581c87';
      ctx.beginPath();
      ctx.ellipse(cx, cy + size * 0.08, size * 0.34, size * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      // Crown body — royal purple
      ctx.fillStyle = '#7c3aed';
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.32, cy + size * 0.04);
      ctx.lineTo(cx - size * 0.28, cy - size * 0.18);
      ctx.lineTo(cx - size * 0.14, cy - size * 0.06);
      ctx.lineTo(cx, cy - size * 0.24);
      ctx.lineTo(cx + size * 0.14, cy - size * 0.06);
      ctx.lineTo(cx + size * 0.28, cy - size * 0.18);
      ctx.lineTo(cx + size * 0.32, cy + size * 0.04);
      ctx.closePath();
      ctx.fill();
      // Crown rim highlight
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Gems — sickly green (sepsis theme)
      ctx.fillStyle = '#bef264';
      ctx.shadowColor = '#65a30d';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(cx, cy - size * 0.16, size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a3e635';
      ctx.beginPath();
      ctx.arc(cx - size * 0.2, cy - size * 0.08, size * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + size * 0.2, cy - size * 0.08, size * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Purple border glow
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }

    if (item.id === 'quest_wood_board') {
      drawWoodPileSprite(ctx, x, y, size, false);
    }

    if (item.id === 'goblin_dynamite') {
      drawDynamiteInventoryIcon(ctx, x, y, size);
    } else if (item.id === 'gym_dumbbell') {
      drawDumbbellInventoryIcon(ctx, x, y, size);
    } else if (item.id === 'gym_bench_press') {
      drawBenchPressInventoryIcon(ctx, x, y, size);
    } else if (item.id === 'gym_treadmill') {
      drawTreadmillInventoryIcon(ctx, x, y, size);
    }

    // Quantity badge (bottom-right) — sprite icon text, leave as ctx.fillText
    // Uses textAlign='right' where x is the RIGHT edge; dynamic font size
    if (item.quantity > 1) {
      const fontSize = Math.max(7, Math.floor(size * 0.22));
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.fillText(item.quantity.toString(), x + size - 3, y + size - 3);
      ctx.textAlign = 'left';
    }

    ctx.restore();
  }

  // Interaction

  handleClick(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): boolean {
    return this.interaction.handleClick(
      mx,
      my,
      canvas,
      inventory,
      this.isOpen,
      () => this.toggle(),
      this.toggleBtnRect(canvas),
      this.panelRect(canvas),
      this.page,
      (p) => {
        this.page = p;
      },
      (o) => {
        this.isOpen = o;
      },
    );
  }

  handleMouseDown(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    this.interaction.handleMouseDown(
      mx,
      my,
      canvas,
      inventory,
      this.isOpen,
      (i, c) => this.hotbarSlotRect(i, c),
      this.panelRect(canvas),
      (i, p) => this.invSlotRect(i, p),
      this.page,
    );
  }

  openContextMenu(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    this.interaction.openContextMenu(
      mx,
      my,
      canvas,
      inventory,
      this.isOpen,
      (i, c) => this.hotbarSlotRect(i, c),
      this.panelRect(canvas),
      (i, p) => this.invSlotRect(i, p),
      this.page,
    );
  }

  handleMouseMove(mx: number, my: number): void {
    this.interaction.handleMouseMove(mx, my);
  }

  handleMouseUp(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    this.interaction.handleMouseUp(
      mx,
      my,
      canvas,
      inventory,
      this.isOpen,
      (i, c) => this.hotbarSlotRect(i, c),
      this.panelRect(canvas),
      (i, p) => this.invSlotRect(i, p),
      this.page,
    );
  }
}
