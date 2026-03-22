import { TILE_SIZE } from '../core/constants';
import type { ItemId } from '../core/Inventory';
import type { Player } from '../Player';
import type { GameSystem } from './GameSystem';

const SHOP_ITEMS: Array<{
  id: ItemId;
  label: string;
  price: number;
  desc: string;
}> = [
  {
    id: 'health_potion',
    label: 'Health Potion',
    price: 5,
    desc: 'Restores 50% max HP',
  },
  {
    id: 'goblin_dynamite',
    label: 'Goblin Dynamite',
    price: 10,
    desc: 'Throw for AoE damage',
  },
  {
    id: 'scroll_of_confusing_fog',
    label: 'Scroll of Confusing Fog',
    price: 15,
    desc: 'Blinds nearby enemies',
  },
];

export class ShopSystem implements GameSystem {
  shopOpen = false;

  private shopkeeperTileY = 1;
  private wanderX: number;
  private wanderDir = 1;
  private wanderTime = 0;
  private wanderMinX: number;
  private wanderMaxX: number;

  private feedbackMsg = '';
  private feedbackTimer = 0;
  private buyRects: Array<{ x: number; y: number; w: number; h: number }> = [];

  constructor(interiorWidth: number) {
    this.wanderX = Math.floor(interiorWidth / 2) * TILE_SIZE;
    this.wanderMinX = 3 * TILE_SIZE;
    this.wanderMaxX = (interiorWidth - 4) * TILE_SIZE;
  }

  update(): void {
    this.wanderTime++;
    if (this.wanderTime % 200 === 0) {
      this.wanderDir = Math.random() < 0.5 ? -1 : 1;
    }
    this.wanderX += this.wanderDir * 0.4;
    if (this.wanderX < this.wanderMinX) {
      this.wanderX = this.wanderMinX;
      this.wanderDir = 1;
    }
    if (this.wanderX > this.wanderMaxX) {
      this.wanderX = this.wanderMaxX;
      this.wanderDir = -1;
    }
    if (this.feedbackTimer > 0) this.feedbackTimer--;
  }

  isNearShopkeeper(player: Player): boolean {
    const skPx = this.wanderX + TILE_SIZE * 0.5;
    const skPy = this.shopkeeperTileY * TILE_SIZE + TILE_SIZE * 0.5;
    return (
      Math.hypot(player.x + TILE_SIZE * 0.5 - skPx, player.y + TILE_SIZE * 0.5 - skPy) <
      TILE_SIZE * 3.5
    );
  }

  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    const ts = TILE_SIZE;
    const sx = this.wanderX - camX;
    const sy = this.shopkeeperTileY * ts - camY;
    this.drawShopkeeper(ctx, sx, sy, ts, this.wanderTime, this.wanderDir);

    // Speech bubble when player is near and shop is closed
    if (!this.shopOpen && this.isNearShopkeeper(active)) {
      const mx = sx + ts * 0.5;
      const my = sy;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.68)';
      const tw = 126;
      const th = 24;
      ctx.fillRect(mx - tw / 2, my - 38, tw, th);
      ctx.fillStyle = '#f0e8d0';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('[Space] Shop', mx, my - 21);
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }

  private drawShopkeeper(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    s: number,
    walkTime: number,
    facingX: number,
  ): void {
    ctx.save();
    const bob = Math.sin(walkTime * 0.08) * s * 0.02;
    const bsy = sy + bob;
    const cx = sx + s * 0.5;

    if (facingX < 0) {
      ctx.translate(sx + s * 0.5, 0);
      ctx.scale(-1, 1);
      ctx.translate(-(sx + s * 0.5), 0);
    }

    // Legs
    ctx.fillStyle = '#3d2a0e';
    ctx.fillRect(cx - s * 0.18, bsy + s * 0.78, s * 0.14, s * 0.18);
    ctx.fillRect(cx + s * 0.04, bsy + s * 0.78, s * 0.14, s * 0.18);

    // Body coat (warm brown)
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(cx - s * 0.23, bsy + s * 0.36, s * 0.46, s * 0.46);

    // Apron (cream)
    ctx.fillStyle = '#e4d8b0';
    ctx.fillRect(cx - s * 0.13, bsy + s * 0.38, s * 0.26, s * 0.4);

    // Arms
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(cx - s * 0.34, bsy + s * 0.38, s * 0.11, s * 0.28);
    ctx.fillRect(cx + s * 0.23, bsy + s * 0.38, s * 0.11, s * 0.28);

    // Hands
    ctx.fillStyle = '#c89068';
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.285, bsy + s * 0.68, s * 0.07, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.285, bsy + s * 0.68, s * 0.07, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();

    // Neck
    ctx.fillStyle = '#c89068';
    ctx.fillRect(cx - s * 0.07, bsy + s * 0.24, s * 0.14, s * 0.13);

    // Head
    ctx.fillStyle = '#c89068';
    ctx.beginPath();
    ctx.ellipse(cx, bsy + s * 0.16, s * 0.15, s * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hat brim
    ctx.fillStyle = '#1e1208';
    ctx.fillRect(cx - s * 0.24, bsy + s * 0.04, s * 0.48, s * 0.05);

    // Hat crown
    ctx.fillRect(cx - s * 0.16, bsy - s * 0.1, s * 0.32, s * 0.15);

    // Hatband
    ctx.fillStyle = '#8b6914';
    ctx.fillRect(cx - s * 0.16, bsy + s * 0.03, s * 0.32, s * 0.03);

    // Eyes
    ctx.fillStyle = '#1a0e04';
    ctx.fillRect(cx - s * 0.08, bsy + s * 0.12, s * 0.04, s * 0.04);
    ctx.fillRect(cx + s * 0.04, bsy + s * 0.12, s * 0.04, s * 0.04);

    // Smile
    ctx.strokeStyle = '#7a4a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, bsy + s * 0.2, s * 0.06, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // Apron pocket
    ctx.strokeStyle = '#c8b880';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - s * 0.08, bsy + s * 0.56, s * 0.16, s * 0.12);

    ctx.restore();
  }

  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, active: Player): void {
    if (this.feedbackTimer > 0) {
      const alpha = Math.min(1, this.feedbackTimer / 30);
      ctx.save();
      ctx.fillStyle = `rgba(10,8,4,${alpha * 0.85})`;
      const tw = 260;
      const th = 28;
      ctx.fillRect(canvas.width / 2 - tw / 2, canvas.height - 68, tw, th);
      ctx.fillStyle = `rgba(220,190,80,${alpha})`;
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.feedbackMsg, canvas.width / 2, canvas.height - 48);
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }

  renderShopPanel(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, active: Player): void {
    if (!this.shopOpen) return;
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, cw, ch);

    const panelW = 400;
    const itemH = 56;
    const panelH = 72 + SHOP_ITEMS.length * itemH + 32;
    const panelX = cw / 2 - panelW / 2;
    const panelY = ch / 2 - panelH / 2;

    // Panel
    ctx.fillStyle = '#120d04';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#c8a840';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    // Inner decorative line
    ctx.strokeStyle = '#6a5420';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX + 5, panelY + 5, panelW - 10, panelH - 10);

    ctx.textAlign = 'center';

    // Title
    ctx.fillStyle = '#f0d870';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('General Store', cw / 2, panelY + 26);

    // Separator
    ctx.strokeStyle = '#6a5420';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelX + 20, panelY + 34);
    ctx.lineTo(panelX + panelW - 20, panelY + 34);
    ctx.stroke();

    // Active player coins
    ctx.fillStyle = '#d4c070';
    ctx.font = '12px monospace';
    ctx.fillText(`Coins: ${active.coins}`, cw / 2, panelY + 52);

    // Item rows
    this.buyRects = [];
    for (let i = 0; i < SHOP_ITEMS.length; i++) {
      const item = SHOP_ITEMS[i];
      const rowY = panelY + 66 + i * itemH;
      const canAfford = active.coins >= item.price;

      // Row background
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,245,200,0.04)' : 'rgba(0,0,0,0.18)';
      ctx.fillRect(panelX + 8, rowY + 2, panelW - 16, itemH - 4);

      // Item name
      ctx.textAlign = 'left';
      ctx.fillStyle = canAfford ? '#e8d898' : '#6a5a40';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(item.label, panelX + 18, rowY + 20);

      // Description
      ctx.fillStyle = canAfford ? '#8a7a50' : '#4a3a28';
      ctx.font = '10px monospace';
      ctx.fillText(item.desc, panelX + 18, rowY + 36);

      // Price
      ctx.textAlign = 'right';
      ctx.fillStyle = canAfford ? '#f0d040' : '#6a5820';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(`${item.price} coins`, panelX + panelW - 90, rowY + 20);

      // Buy button
      const btnW = 68;
      const btnH = 32;
      const btnX = panelX + panelW - btnW - 12;
      const btnY = rowY + (itemH - btnH) / 2;

      ctx.fillStyle = canAfford ? '#14400a' : '#281818';
      ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.strokeStyle = canAfford ? '#5aaa34' : '#3a2020';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(btnX, btnY, btnW, btnH);
      ctx.fillStyle = canAfford ? '#c8e890' : '#5a4040';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Buy', btnX + btnW / 2, btnY + 21);

      this.buyRects.push({ x: btnX, y: btnY, w: btnW, h: btnH });
    }

    // Close hint
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5a4a30';
    ctx.font = '10px monospace';
    ctx.fillText('[Space / Esc]  Close', cw / 2, panelY + panelH - 12);

    ctx.textAlign = 'left';
  }

  handleClick(mx: number, my: number, active: Player): void {
    for (let i = 0; i < this.buyRects.length; i++) {
      const r = this.buyRects[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        this.tryBuy(i, active);
        return;
      }
    }
  }

  private tryBuy(itemIdx: number, player: Player): void {
    const item = SHOP_ITEMS[itemIdx];
    if (!item) return;
    if (player.coins < item.price) {
      this.feedbackMsg = 'Not enough coins!';
      this.feedbackTimer = 100;
      return;
    }
    const before = player.inventory.countOf(item.id);
    player.inventory.addItem(item.id, 1);
    const after = player.inventory.countOf(item.id);
    if (after <= before) {
      // Inventory full — refund not needed since we haven't deducted yet
      this.feedbackMsg = 'Inventory is full!';
      this.feedbackTimer = 100;
      return;
    }
    player.coins -= item.price;
    this.feedbackMsg = `Bought ${item.label}!`;
    this.feedbackTimer = 100;
  }
}
