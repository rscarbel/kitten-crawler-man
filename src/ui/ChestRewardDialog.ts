import { ITEM_DEF } from '../core/ItemDefs';
import type { LootDrop } from '../creatures/Mob';
import type { TreasureChest } from '../systems/TreasureChestSystem';
import { chestImage } from '../systems/TreasureChestSystem';
import { drawText, TEXT_PRESETS } from './TextBox';
import { drawBox, drawOverlay, BOX_PRESETS } from './Box';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

const CHEST_OPEN_FRAME = 30;
const PARTICLE_COUNT = 30;
const PARTICLE_COLORS = ['#ffd700', '#facc15', '#fbbf24', '#f59e0b', '#fff', '#a3e635'] as const;

export interface ChestLootSplit {
  humanLoot: LootDrop;
  catLoot: LootDrop;
}

export class ChestRewardDialog {
  private _isOpen = false;
  private frame = 0;
  private chest: TreasureChest | null = null;
  private lootSplit: ChestLootSplit | null = null;
  private onClose: (() => void) | null = null;
  private particles: Particle[] = [];
  private burstSpawned = false;
  rewardSoundPending = false;

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(chest: TreasureChest, lootSplit: ChestLootSplit | null, onClose?: () => void): void {
    this._isOpen = true;
    this.chest = chest;
    this.lootSplit = lootSplit;
    this.onClose = onClose ?? null;
    this.frame = 0;
    this.particles = [];
    this.burstSpawned = false;
    this.rewardSoundPending = false;
  }

  tick(): void {
    if (!this._isOpen) return;

    this.frame++;

    // Spawn particle burst when chest opens
    if (this.frame === CHEST_OPEN_FRAME && !this.burstSpawned) {
      this.burstSpawned = true;
      this.rewardSoundPending = true;
      // Particles are spawned with placeholder origin (0,0); resolved in render on this frame
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
        const speed = 1.5 + Math.random() * 3;
        const colorIdx = Math.floor(Math.random() * PARTICLE_COLORS.length);
        const color = PARTICLE_COLORS[colorIdx] ?? '#ffd700';
        this.particles.push({
          x: 0,
          y: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 40 + Math.floor(Math.random() * 30),
          maxLife: 70,
          color,
        });
      }
    }

    // Update particles
    const gravity = 0.15;
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += gravity;
      p.life--;
    }
  }

  handleClick(_mx: number, _my: number): boolean {
    return this.dismiss();
  }

  handleKeyDown(): boolean {
    return this.dismiss();
  }

  private dismiss(): boolean {
    if (!this._isOpen || this.frame < CHEST_OPEN_FRAME) return false;
    this._isOpen = false;
    if (this.onClose !== null) {
      this.onClose();
    }
    return true;
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this._isOpen || this.chest === null) return;

    const cw = canvas.width;
    const ch = canvas.height;

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: 0.7 });

    const boxW = 380;
    const boxH = 300;
    const boxX = Math.round(cw / 2 - boxW / 2);
    const boxY = Math.round(ch / 2 - boxH / 2);

    const pulse = 0.5 + 0.5 * Math.sin(this.frame * 0.08);
    const glowBlur = 20 + pulse * 20;
    const borderColor = this.chest.type === 'silver' ? '#c0c0c0' : '#8b5e3c';
    const glowColor = this.chest.type === 'silver' ? '#c0c0c0' : '#d4a17a';

    drawBox(ctx, {
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      ...BOX_PRESETS.modal,
      border: borderColor,
      borderWidth: 3,
      glow: glowColor,
      glowBlur,
      radius: 8,
      padding: 20,
    });

    drawText(ctx, 'TREASURE!', {
      x: boxX + boxW / 2,
      y: boxY + 16,
      align: 'center',
      size: 22,
      bold: true,
      color: '#ffd700',
      glow: '#ffd700',
      glowBlur: 18,
      outline: true,
    });

    // Chest sprite — 64×64, centered horizontally
    const chestSpriteSize = 64;
    const chestSpriteX = Math.round(boxX + (boxW - chestSpriteSize) / 2);
    const chestSpriteY = boxY + 52;

    const chestOpened = this.frame >= CHEST_OPEN_FRAME;
    let srcX: number;
    if (this.chest.type === 'wooden') {
      srcX = chestOpened ? 80 : 0;
    } else {
      srcX = chestOpened ? 240 : 160;
    }

    ctx.drawImage(
      chestImage,
      srcX,
      0,
      80,
      80,
      chestSpriteX,
      chestSpriteY,
      chestSpriteSize,
      chestSpriteSize,
    );

    // Resolve particle origin to chest sprite center on the burst frame
    const particleCenterX = chestSpriteX + chestSpriteSize / 2;
    const particleCenterY = chestSpriteY + chestSpriteSize / 2;
    if (this.burstSpawned && this.frame === CHEST_OPEN_FRAME) {
      for (const p of this.particles) {
        p.x = particleCenterX;
        p.y = particleCenterY;
      }
    }

    ctx.save();
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const lootStartY = chestSpriteY + chestSpriteSize + 10;

    if (!chestOpened) {
      const dots = '.'.repeat(1 + (Math.floor(this.frame / 10) % 3));
      drawText(ctx, `Opening${dots}`, {
        x: boxX + boxW / 2,
        y: lootStartY,
        align: 'center',
        ...TEXT_PRESETS.hint,
      });
    } else if (this.lootSplit === null) {
      drawText(ctx, 'The chest is empty.', {
        x: boxX + boxW / 2,
        y: lootStartY,
        align: 'center',
        ...TEXT_PRESETS.hint,
      });
    } else {
      this.renderLootSplit(ctx, boxX, boxW, boxH, boxY, lootStartY, this.lootSplit);
    }

    // Only show "click to continue" after the chest has opened
    if (chestOpened) {
      drawText(ctx, 'Press any key or click to continue', {
        x: boxX + boxW / 2,
        y: boxY + boxH - 28,
        align: 'center',
        ...TEXT_PRESETS.controls,
      });
    }
  }

  private renderLootSplit(
    ctx: CanvasRenderingContext2D,
    boxX: number,
    boxW: number,
    boxH: number,
    boxY: number,
    lootStartY: number,
    split: ChestLootSplit,
  ): void {
    const leftX = Math.round(boxX + boxW / 4);
    const rightX = Math.round(boxX + (3 * boxW) / 4);
    const dividerX = boxX + boxW / 2;

    // Column headers
    drawText(ctx, 'Human', {
      x: leftX,
      y: lootStartY,
      align: 'center',
      size: 11,
      bold: true,
      color: '#93c5fd',
    });
    drawText(ctx, 'Cat', {
      x: rightX,
      y: lootStartY,
      align: 'center',
      size: 11,
      bold: true,
      color: '#fb923c',
    });

    // Vertical divider
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dividerX, lootStartY);
    ctx.lineTo(dividerX, boxY + boxH - 40);
    ctx.stroke();
    ctx.restore();

    let leftY = lootStartY + 16;
    let rightY = lootStartY + 16;

    // Human loot
    if (split.humanLoot.coins > 0) {
      drawText(ctx, `${split.humanLoot.coins} coins`, {
        x: leftX,
        y: leftY,
        align: 'center',
        ...TEXT_PRESETS.value,
      });
      leftY += 15;
    }
    for (const entry of split.humanLoot.items) {
      const def = ITEM_DEF[entry.id];
      const label = entry.quantity > 1 ? `${entry.quantity}x ${def.name}` : def.name;
      drawText(ctx, label, { x: leftX, y: leftY, align: 'center', size: 11, color: '#e2e8f0' });
      leftY += 15;
    }
    if (split.humanLoot.coins === 0 && split.humanLoot.items.length === 0) {
      drawText(ctx, '(empty)', { x: leftX, y: leftY, align: 'center', ...TEXT_PRESETS.hint });
    }

    // Cat loot
    if (split.catLoot.coins > 0) {
      drawText(ctx, `${split.catLoot.coins} coins`, {
        x: rightX,
        y: rightY,
        align: 'center',
        ...TEXT_PRESETS.value,
      });
      rightY += 15;
    }
    for (const entry of split.catLoot.items) {
      const def = ITEM_DEF[entry.id];
      const label = entry.quantity > 1 ? `${entry.quantity}x ${def.name}` : def.name;
      drawText(ctx, label, { x: rightX, y: rightY, align: 'center', size: 11, color: '#e2e8f0' });
      rightY += 15;
    }
    if (split.catLoot.coins === 0 && split.catLoot.items.length === 0) {
      drawText(ctx, '(empty)', { x: rightX, y: rightY, align: 'center', ...TEXT_PRESETS.hint });
    }
  }
}
