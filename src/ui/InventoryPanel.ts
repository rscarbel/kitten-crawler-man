import { Inventory, InventoryItem, HOTBAR_COUNT, SLOTS_PER_PAGE } from '../core/Inventory';
import { IS_MOBILE } from '../core/MobileDetect';
import { drawDynamiteInventoryIcon } from '../sprites/dynamiteSprite';
import {
  drawDumbbellInventoryIcon,
  drawBenchPressInventoryIcon,
  drawTreadmillInventoryIcon,
} from '../sprites/gymEquipmentSprite';
import { InventoryInteraction } from './InventoryInteraction';

function inRect(
  mx: number,
  my: number,
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}

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

  // Delegate pending fields to interaction for backward compatibility
  get pendingEquipSlot() {
    return this.interaction.pendingEquipSlot;
  }
  set pendingEquipSlot(v) {
    this.interaction.pendingEquipSlot = v;
  }
  get pendingUnequipSlot() {
    return this.interaction.pendingUnequipSlot;
  }
  set pendingUnequipSlot(v) {
    this.interaction.pendingUnequipSlot = v;
  }
  get pendingInfoItem() {
    return this.interaction.pendingInfoItem;
  }
  set pendingInfoItem(v) {
    this.interaction.pendingInfoItem = v;
  }
  get pendingDropItem() {
    return this.interaction.pendingDropItem;
  }
  set pendingDropItem(v) {
    this.interaction.pendingDropItem = v;
  }

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
  abilityCooldowns: Map<string, { current: number; max: number }> = new Map();

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
      if (slotIdx >= inventory.slots.length) break;
      const r = this.invSlotRect(i, p);
      if (inRect(mx, my, r)) return slotIdx;
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
    return mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h;
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
    if (this.pendingInfoItem) {
      this.renderInfoPopup(ctx, canvas, this.pendingInfoItem);
    }
    if (this.dropDialog) {
      this.renderDropDialog(ctx, canvas);
    }
  }

  private renderContextMenu(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cm = this.contextMenu!;
    const options = this.interaction.contextMenuOptions(cm.item, cm.source, cm.isEquipped);
    const menuW = 120;
    const menuItemH = 22;
    const menuH = options.length * menuItemH + 4;
    const mx = Math.min(cm.x, canvas.width - menuW - 4);
    const my = Math.min(cm.y, canvas.height - menuH - 4);

    ctx.save();
    ctx.fillStyle = 'rgba(10,14,30,0.97)';
    ctx.fillRect(mx, my, menuW, menuH);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, menuW, menuH);

    ctx.font = '11px monospace';
    for (let i = 0; i < options.length; i++) {
      const oy = my + 2 + i * menuItemH;
      if (this.contextMenuHover === i) {
        ctx.fillStyle = 'rgba(59,130,246,0.3)';
        ctx.fillRect(mx + 1, oy, menuW - 2, menuItemH);
      }
      ctx.fillStyle =
        options[i] === 'Equip' ? '#4ade80' : options[i] === 'Unequip' ? '#f87171' : '#e2e8f0';
      ctx.fillText(options[i], mx + 8, oy + 15);
    }
    ctx.restore();
  }

  private renderInfoPopup(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    item: InventoryItem,
  ): void {
    const popW = 280;
    const lineH = 15;
    const pad = 10;
    const lines: string[] = [];

    // Word-wrap description
    if (item.description) {
      const words = item.description.split(' ');
      let cur = '';
      for (const w of words) {
        if ((cur + ' ' + w).trim().length <= 36) {
          cur = (cur + ' ' + w).trim();
        } else {
          lines.push(cur);
          cur = w;
        }
      }
      if (cur) lines.push(cur);
    } else {
      lines.push('No description available.');
    }

    const popH = pad + lineH + pad * 0.5 + lines.length * lineH + pad;
    const px = Math.floor((canvas.width - popW) / 2);
    const py = Math.floor((canvas.height - popH) / 2);

    ctx.save();
    ctx.fillStyle = 'rgba(8,10,20,0.97)';
    ctx.fillRect(px, py, popW, popH);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px, py, popW, popH);

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(item.name, px + pad, py + pad + lineH - 3);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 4, py + pad + lineH + 2);
    ctx.lineTo(px + popW - 4, py + pad + lineH + 2);
    ctx.stroke();

    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], px + pad, py + pad * 1.5 + lineH * 2 + i * lineH - 3);
    }

    ctx.fillStyle = '#475569';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('[Click anywhere to close]', px + popW / 2, py + popH - 4);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  private renderDropDialog(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const dd = this.dropDialog!;
    const dlgW = 200;
    const dlgH = 110;
    const dlgX = Math.floor((canvas.width - dlgW) / 2);
    const dlgY = Math.floor((canvas.height - dlgH) / 2);

    ctx.save();
    // Background
    ctx.fillStyle = 'rgba(8,10,20,0.97)';
    ctx.fillRect(dlgX, dlgY, dlgW, dlgH);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(dlgX, dlgY, dlgW, dlgH);

    // Title
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Drop how many?', dlgX + dlgW / 2, dlgY + 22);

    // Cancel [X]
    ctx.fillStyle = '#374151';
    ctx.fillRect(dlgX + dlgW - 22, dlgY + 6, 16, 16);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('x', dlgX + dlgW - 14, dlgY + 18);

    // [-] button
    const minusBtnX = dlgX + 20;
    const minusBtnY = dlgY + 54;
    ctx.fillStyle = '#334155';
    ctx.fillRect(minusBtnX, minusBtnY, 24, 24);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(minusBtnX, minusBtnY, 24, 24);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText('-', minusBtnX + 12, minusBtnY + 17);

    // [+] button
    const plusBtnX = dlgX + dlgW - 44;
    ctx.fillStyle = '#334155';
    ctx.fillRect(plusBtnX, minusBtnY, 24, 24);
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(plusBtnX, minusBtnY, 24, 24);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText('+', plusBtnX + 12, minusBtnY + 17);

    // Quantity display
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(dd.selectedQty.toString(), dlgX + dlgW / 2, minusBtnY + 18);

    // Max hint
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.fillText(`/ ${dd.maxQty}`, dlgX + dlgW / 2 + 14, minusBtnY + 18);

    // [Drop] confirm button
    const confirmY = dlgY + dlgH - 28;
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(dlgX + 20, confirmY, dlgW - 40, 22);
    ctx.strokeStyle = '#3b82f6';
    ctx.strokeRect(dlgX + 20, confirmY, dlgW - 40, 22);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('Drop', dlgX + dlgW / 2, confirmY + 15);

    ctx.textAlign = 'left';
    ctx.restore();
  }

  private renderToggleButton(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    // On mobile the button is drawn by DungeonScene.renderMobileButtons instead
    if (IS_MOBILE) return;
    const btn = this.toggleBtnRect(canvas);
    ctx.fillStyle = this.isOpen ? 'rgba(59,130,246,0.45)' : 'rgba(0,0,0,0.55)';
    ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
    ctx.strokeStyle = this.isOpen ? '#3b82f6' : '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Bag [I]', btn.x + btn.w / 2, btn.y + btn.h / 2 + 4);
    ctx.textAlign = 'left';
  }

  private renderHotbar(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
  ): void {
    const hb = this.hotbarRect(canvas);
    // Background strip
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(hb.x - 6, hb.y - 6, hb.w + 12, hb.h + 18);

    for (let i = 0; i < HOTBAR_COUNT; i++) {
      const r = this.hotbarSlotRect(i, canvas);
      const isDragged = this.drag?.source === 'hotbar' && this.drag.idx === i;
      this.renderSlot(ctx, r.x, r.y, r.w, inventory.hotbar[i], isDragged, true);
      // Key number label below slot
      ctx.fillStyle = '#64748b';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText((i + 1).toString(), r.x + r.w / 2, r.y + r.h + 11);
      ctx.textAlign = 'left';
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
    ctx.fillStyle = 'rgba(8,10,20,0.93)';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p.x, p.y, p.w, p.h);

    // Header — player name
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`${playerName} Inventory`, p.x + PANEL_PAD, p.y + 25);

    // Coins — sits to the left of the close [X] button
    ctx.fillStyle = '#fbbf24';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`\u{1FA99} ${coins}`, p.x + p.w - 36, p.y + 25);
    ctx.textAlign = 'left';

    // Close [X]
    const closeX = p.x + p.w - 20;
    const closeY = p.y + 8;
    ctx.fillStyle = '#374151';
    ctx.fillRect(closeX, closeY, 16, 16);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('x', closeX + 8, closeY + 12);
    ctx.textAlign = 'left';

    // Divider
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 4, p.y + HEADER_H);
    ctx.lineTo(p.x + p.w - 4, p.y + HEADER_H);
    ctx.stroke();

    // Inventory slots
    const pageStart = this.page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      const item = slotIdx < inventory.slots.length ? inventory.slots[slotIdx] : null;
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
    const pages = pageCount(inventory.slots.length);
    const navY = p.y + p.h - NAV_H + 6;
    ctx.fillStyle = '#475569';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    if (pages > 1) {
      // Prev arrow
      ctx.fillStyle = this.page > 0 ? '#94a3b8' : '#374151';
      ctx.fillText('< Prev', p.x + p.w * 0.25, navY);
      // Next arrow
      ctx.fillStyle = this.page < pages - 1 ? '#94a3b8' : '#374151';
      ctx.fillText('Next >', p.x + p.w * 0.75, navY);
    }
    ctx.fillStyle = '#64748b';
    ctx.fillText(`${this.page + 1} / ${pages}`, p.x + p.w / 2, navY);
    ctx.textAlign = 'left';
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

    ctx.fillStyle = isHotbar ? '#0f172a' : '#1e293b';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = isEquipped ? '#3b82f6' : isHotbar ? '#475569' : '#334155';
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
      // White "E" letter
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.floor(badgeSize * 0.55)}px monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('E', bx + 1, by + 1);
      ctx.textBaseline = 'alphabetic';
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
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `bold ${Math.floor(size * 0.28)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(secs > 99 ? '…' : `${secs}`, x + size / 2, y + size / 2 + 4);
        ctx.textAlign = 'left';
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
    ctx.globalAlpha = (ctx.globalAlpha ?? 1) * alpha;

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
      // Red hearts pattern
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
      // Enchantment rune — golden fist symbol
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

    if (item.id === 'goblin_dynamite') {
      drawDynamiteInventoryIcon(ctx, x, y, size);
    } else if (item.id === 'gym_dumbbell') {
      drawDumbbellInventoryIcon(ctx, x, y, size);
    } else if (item.id === 'gym_bench_press') {
      drawBenchPressInventoryIcon(ctx, x, y, size);
    } else if (item.id === 'gym_treadmill') {
      drawTreadmillInventoryIcon(ctx, x, y, size);
    }

    // Quantity badge (bottom-right)
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
