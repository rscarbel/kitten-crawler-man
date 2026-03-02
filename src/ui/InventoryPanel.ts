import { Inventory, InventoryItem, HOTBAR_COUNT, SLOTS_PER_PAGE } from '../core/Inventory';

// ── Layout constants ──────────────────────────────────────────────────────────
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

interface DragState {
  source: 'inv' | 'hotbar';
  idx: number;
  item: InventoryItem;
  mx: number;
  my: number;
}

export class InventoryPanel {
  isOpen = false;
  private page = 0;
  private drag: DragState | null = null;

  toggle(): void {
    this.isOpen = !this.isOpen;
  }

  // ── Layout helpers ────────────────────────────────────────────────────────

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
    return { x: Math.floor((canvas.width - w) / 2), y: Math.floor((canvas.height - h) / 2), w, h };
  }

  private hotbarRect(canvas: HTMLCanvasElement) {
    const w = HOTBAR_COUNT * (HOTBAR_SLOT_SIZE + HOTBAR_GAP) - HOTBAR_GAP;
    return {
      x: Math.floor((canvas.width - w) / 2),
      y: canvas.height - HOTBAR_SLOT_SIZE - HOTBAR_BOTTOM_MARGIN,
      w,
      h: HOTBAR_SLOT_SIZE,
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
    return { x: hb.x + i * (HOTBAR_SLOT_SIZE + HOTBAR_GAP), y: hb.y, w: HOTBAR_SLOT_SIZE, h: HOTBAR_SLOT_SIZE };
  }

  // ── Render ────────────────────────────────────────────────────────────────

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
  }

  private renderToggleButton(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
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

  private renderHotbar(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, inventory: Inventory): void {
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
      this.renderSlot(ctx, r.x, r.y, r.w, item, isDragged, false, inventory.isSlotEquipped(slotIdx));
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

    if (item.id === 'enchanted_bigboi_boxers') {
      const cx = x + size * 0.5;
      const cy = y + size * 0.56;
      // Waistband
      ctx.fillStyle = '#1e40af';
      ctx.fillRect(x + size * 0.12, y + size * 0.22, size * 0.76, size * 0.18);
      // Left leg
      ctx.fillStyle = '#1d4ed8';
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
      // Enchantment sparkle
      ctx.fillStyle = '#a5f3fc';
      ctx.font = `bold ${Math.floor(size * 0.22)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('✦', cx, cy - size * 0.04);
      ctx.textAlign = 'left';
      // Blue border glow
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
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

  // ── Interaction ───────────────────────────────────────────────────────────

  /**
   * Returns true if this panel consumed the click (inventory toggle button or
   * close button or pagination). DungeonScene should skip other click handling
   * when this returns true.
   */
  handleClick(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): boolean {
    // Toggle button
    const btn = this.toggleBtnRect(canvas);
    if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
      this.toggle();
      return true;
    }

    if (!this.isOpen) return false;

    const p = this.panelRect(canvas);

    // Close [X] button
    const closeX = p.x + p.w - 20;
    if (mx >= closeX && mx <= closeX + 16 && my >= p.y + 8 && my <= p.y + 24) {
      this.isOpen = false;
      return true;
    }

    // Pagination
    const pages = pageCount(inventory.slots.length);
    if (pages > 1) {
      const navY = p.y + p.h - NAV_H + 6;
      // Prev
      if (my >= navY - 12 && my <= navY + 4) {
        if (mx < p.x + p.w * 0.5 && this.page > 0) {
          this.page--;
          return true;
        }
        if (mx >= p.x + p.w * 0.5 && this.page < pages - 1) {
          this.page++;
          return true;
        }
      }
    }

    // Any click inside the panel suppresses other handlers
    if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) {
      return true;
    }

    return false;
  }

  handleMouseDown(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    // Hotbar slots
    for (let i = 0; i < HOTBAR_COUNT; i++) {
      const r = this.hotbarSlotRect(i, canvas);
      if (inRect(mx, my, r)) {
        const item = inventory.hotbar[i];
        if (item) {
          this.drag = { source: 'hotbar', idx: i, item, mx, my };
          return;
        }
      }
    }

    if (!this.isOpen) return;

    const p = this.panelRect(canvas);
    const pageStart = this.page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      if (slotIdx >= inventory.slots.length) break;
      const r = this.invSlotRect(i, p);
      if (inRect(mx, my, r)) {
        const item = inventory.slots[slotIdx];
        if (item) {
          this.drag = { source: 'inv', idx: slotIdx, item, mx, my };
          return;
        }
      }
    }
  }

  handleMouseMove(mx: number, my: number): void {
    if (this.drag) {
      this.drag.mx = mx;
      this.drag.my = my;
    }
  }

  handleMouseUp(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    const src = this.drag;
    if (!src) return;
    this.drag = null;

    // ── Drop on hotbar ────────────────────────────────────────────────────
    for (let i = 0; i < HOTBAR_COUNT; i++) {
      const r = this.hotbarSlotRect(i, canvas);
      if (inRect(mx, my, r)) {
        if (src.source === 'hotbar') {
          if (src.idx !== i) inventory.swapHotbar(src.idx, i);
        } else {
          inventory.swapInvToHotbar(src.idx, i);
        }
        return;
      }
    }

    if (!this.isOpen) return;

    // ── Drop on inventory slot ────────────────────────────────────────────
    const p = this.panelRect(canvas);
    const pageStart = this.page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      if (slotIdx >= inventory.slots.length) break;
      const r = this.invSlotRect(i, p);
      if (inRect(mx, my, r)) {
        if (src.source === 'hotbar') {
          inventory.swapHotbarToInv(src.idx, slotIdx);
        } else {
          if (src.idx !== slotIdx) inventory.swapSlots(src.idx, slotIdx);
        }
        return;
      }
    }
    // Dropped outside a valid target — item stays in original slot (drag cancelled)
  }
}

function inRect(mx: number, my: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}
