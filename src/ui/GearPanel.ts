import { Inventory, EQUIP_SUBSLOTS, EquipSlot } from '../core/Inventory';
import type { InventoryItem } from '../core/Inventory';

// ── Layout constants ──────────────────────────────────────────────────────────
const SLOT_SIZE = 46;
const SLOT_GAP = 3;
const PANEL_PAD = 12;
const HEADER_H = 40;
const SECTION_LABEL_W = 52;

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
    return { x: canvas.width - 252, y: 8, w: 76, h: 28 };
  }

  private panelRect(canvas: HTMLCanvasElement) {
    const w = 340;
    const h = 420;
    return {
      x: Math.floor((canvas.width - w) / 2) - 180,
      y: Math.floor((canvas.height - h) / 2),
      w,
      h,
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────

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

  private renderToggleButton(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const btn = this.toggleBtnRect(canvas);
    ctx.fillStyle = this.isOpen ? 'rgba(59,130,246,0.45)' : 'rgba(0,0,0,0.55)';
    ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
    ctx.strokeStyle = this.isOpen ? '#3b82f6' : '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Gear [G]', btn.x + btn.w / 2, btn.y + btn.h / 2 + 4);
    ctx.textAlign = 'left';
  }

  private renderPanel(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    playerName: string,
  ): void {
    const p = this.panelRect(canvas);

    // Backdrop
    ctx.fillStyle = 'rgba(8,10,20,0.93)';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p.x, p.y, p.w, p.h);

    // Header
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`${playerName} Equipment`, p.x + PANEL_PAD, p.y + 25);

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

    // Render sections
    let currentY = p.y + HEADER_H + PANEL_PAD;
    let tooltipItem: InventoryItem | null = null;
    let tooltipSubSlot = '';

    for (const slotName of SLOT_ORDER) {
      const subSlots = EQUIP_SUBSLOTS[slotName];
      const slotsInfos = this.buildSlotInfos(slotName, subSlots, p.x, currentY);

      // Section label
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(
        slotName.toUpperCase(),
        p.x + PANEL_PAD,
        currentY + SLOT_SIZE * 0.5 + 3,
      );

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
      currentY = maxY + 8;
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
  ): SlotInfo[] {
    const infos: SlotInfo[] = [];
    const startX = panelX + PANEL_PAD + SECTION_LABEL_W;
    const maxPerRow = Math.floor(
      (340 - PANEL_PAD * 2 - SECTION_LABEL_W) / (SLOT_SIZE + SLOT_GAP),
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
      ctx.fillRect(x + 2, y + 2, SLOT_SIZE - 4, 3);

      // Item name (truncated, 2 lines max)
      ctx.fillStyle = '#94a3b8';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      const words = item.name.split(' ');
      let line1 = '';
      let line2 = '';
      for (const w of words) {
        if ((line1 + ' ' + w).trim().length <= 9) {
          line1 = (line1 + ' ' + w).trim();
        } else if ((line2 + ' ' + w).trim().length <= 9) {
          line2 = (line2 + ' ' + w).trim();
        }
      }
      ctx.fillText(line1, x + SLOT_SIZE / 2, y + SLOT_SIZE * 0.42);
      if (line2) ctx.fillText(line2, x + SLOT_SIZE / 2, y + SLOT_SIZE * 0.57);
      ctx.textAlign = 'left';
    }

    // Sub-slot label at bottom
    const shortLabel = label.length > 7 ? label.substring(0, 7) : label;
    ctx.fillStyle = '#475569';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(shortLabel, x + SLOT_SIZE / 2, y + SLOT_SIZE - 3);
    ctx.textAlign = 'left';

    ctx.restore();
  }

  private renderTooltip(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    item: InventoryItem,
    subSlot: string,
  ): void {
    const lines: string[] = [item.name];
    if (item.statBonus) {
      const b = item.statBonus;
      if (b.constitution) lines.push(`+${b.constitution} Constitution`);
      if (b.strength) lines.push(`+${b.strength} Strength`);
      if (b.intelligence) lines.push(`+${b.intelligence} Intelligence`);
    }
    if (item.abilityId === 'protective_shell') {
      lines.push('Ability: Protective Shell Spell');
    }
    lines.push('');
    if (item.description) {
      // Word-wrap description at ~34 chars to fit inside the 230px tooltip box
      const words = item.description.split(' ');
      let cur = '';
      for (const w of words) {
        if ((cur + ' ' + w).trim().length <= 34) {
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

    const tw = 230;
    const lineH = 14;
    const th = lines.length * lineH + 12;
    let tx = Math.min(this.tooltipMx + 10, canvas.width - tw - 4);
    let ty = Math.min(this.tooltipMy - th / 2, canvas.height - th - 4);
    ty = Math.max(ty, 4);

    ctx.save();
    ctx.fillStyle = 'rgba(8,10,20,0.96)';
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx, ty, tw, th);

    // Clip all text to the tooltip box so nothing overflows
    ctx.beginPath();
    ctx.rect(tx + 2, ty + 2, tw - 4, th - 4);
    ctx.clip();

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(lines[0], tx + 6, ty + 14);

    ctx.font = '10px monospace';
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('+')) {
        ctx.fillStyle = '#4ade80';
      } else if (line.startsWith('Ability:')) {
        ctx.fillStyle = '#c084fc';
      } else if (line.startsWith('[Click]')) {
        ctx.fillStyle = '#64748b';
      } else {
        ctx.fillStyle = '#94a3b8';
      }
      ctx.fillText(line, tx + 6, ty + 14 + i * lineH);
    }
    ctx.restore();
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  handleMouseMove(
    mx: number,
    my: number,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
  ): void {
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
    const btn = this.toggleBtnRect(canvas);
    if (
      mx >= btn.x &&
      mx <= btn.x + btn.w &&
      my >= btn.y &&
      my <= btn.y + btn.h
    ) {
      this.toggle();
      return { consumed: true };
    }
    if (!this.isOpen) return null;

    const p = this.panelRect(canvas);

    // Close [X]
    const closeX = p.x + p.w - 20;
    if (mx >= closeX && mx <= closeX + 16 && my >= p.y + 8 && my <= p.y + 24) {
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
    if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) {
      return { consumed: true };
    }

    return null;
  }

  private slotKeyAt(
    mx: number,
    my: number,
    p: { x: number; y: number },
    _inventory: Inventory,
  ): string | null {
    let currentY = p.y + HEADER_H + PANEL_PAD;
    for (const slotName of SLOT_ORDER) {
      const subSlots = EQUIP_SUBSLOTS[slotName];
      const infos = this.buildSlotInfos(slotName, subSlots, p.x, currentY);
      let maxY = currentY;
      for (const si of infos) {
        if (
          mx >= si.x &&
          mx <= si.x + SLOT_SIZE &&
          my >= si.y &&
          my <= si.y + SLOT_SIZE
        ) {
          return si.key;
        }
        maxY = Math.max(maxY, si.y + SLOT_SIZE);
      }
      currentY = maxY + 8;
    }
    return null;
  }
}
