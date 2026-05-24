import { ITEM_DEF } from '../core/ItemDefs';
import type { LootDrop } from '../creatures/Mob';
import type { TreasureChest } from '../systems/TreasureChestSystem';
import { chestImage } from '../systems/TreasureChestSystem';
import { drawText, TEXT_PRESETS } from './TextBox';
import { drawBox, drawOverlay, BOX_PRESETS } from './Box';

// Dialog dimensions
const CHEST_DIALOG_MAX_WIDTH = 380;
const CHEST_DIALOG_MAX_HEIGHT = 340;
const CHEST_DIALOG_PADDING = 32;

// Particle effects
const PARTICLE_SPEED_MIN = 1.5;
const PARTICLE_SPEED_VARIANCE = 3;
const PARTICLE_LIFE_MIN = 40;
const PARTICLE_LIFE_VARIANCE = 30;
const PARTICLE_MAX_LIFE = 70;
const PARTICLE_GRAVITY = 0.15;
const PARTICLE_RADIUS = 3;

// Chest sprite
const CHEST_OPEN_FRAME = 30;
const PARTICLE_COUNT = 30;
const PARTICLE_COLORS = ['#ffd700', '#facc15', '#fbbf24', '#f59e0b', '#fff', '#a3e635'] as const;

// Pulse animation
const PULSE_AMPLITUDE = 0.5;
const PULSE_OSCILLATION = 0.08;
const GLOW_BLUR_MIN = 20;
const GLOW_BLUR_VARIANCE = 20;

// Title
const TITLE_Y = 16;
const TITLE_SIZE = 22;
const TITLE_GLOW_BLUR = 18;

// Chest sprite rendering
const CHEST_SPRITE_SIZE = 64;
const CHEST_SPRITE_Y_OFFSET = 52;
const CHEST_SPRITE_SOURCE_WIDTH = 80;
const CHEST_SPRITE_SOURCE_HEIGHT = 80;
const CHEST_WOODEN_OPEN_X = 80;
const CHEST_WOODEN_CLOSED_X = 0;
const CHEST_SILVER_OPEN_X = 240;
const CHEST_SILVER_CLOSED_X = 160;

// Particle rendering
const LOOT_START_Y_OFFSET = 10;

// Continue text
const CONTINUE_TEXT_Y_OFFSET = 28;

// Loot split rendering
const LOOT_COLUMN_PADDING = 6;
const LOOT_COLUMN_HEADER_SIZE = 11;
const LOOT_COLUMN_DIVIDER_Y_OFFSET = 40;
const LOOT_ITEMS_Y_OFFSET = 16;
const LOOT_ITEM_SIZE = 11;

// Opening animation
const OPENING_ANIMATION_FRAME_STEP = 10;
const OPENING_DOT_CYCLE = 3;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

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
        const speed = PARTICLE_SPEED_MIN + Math.random() * PARTICLE_SPEED_VARIANCE;
        const colorIdx = Math.floor(Math.random() * PARTICLE_COLORS.length);
        const color = PARTICLE_COLORS[colorIdx] ?? '#ffd700';
        this.particles.push({
          x: 0,
          y: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: PARTICLE_LIFE_MIN + Math.floor(Math.random() * PARTICLE_LIFE_VARIANCE),
          maxLife: PARTICLE_MAX_LIFE,
          color,
        });
      }
    }

    // Update particles
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += PARTICLE_GRAVITY;
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

    const boxW = Math.min(CHEST_DIALOG_MAX_WIDTH, cw - CHEST_DIALOG_PADDING);
    const boxH = Math.min(CHEST_DIALOG_MAX_HEIGHT, ch - CHEST_DIALOG_PADDING);
    const boxX = Math.round(cw / 2 - boxW / 2);
    const boxY = Math.round(ch / 2 - boxH / 2);

    const pulse = PULSE_AMPLITUDE + PULSE_AMPLITUDE * Math.sin(this.frame * PULSE_OSCILLATION);
    const glowBlur = GLOW_BLUR_MIN + pulse * GLOW_BLUR_VARIANCE;
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
      y: boxY + TITLE_Y,
      align: 'center',
      size: TITLE_SIZE,
      bold: true,
      color: '#ffd700',
      glow: '#ffd700',
      glowBlur: TITLE_GLOW_BLUR,
      outline: true,
    });

    // Chest sprite — 64×64, centered horizontally
    const chestSpriteSize = CHEST_SPRITE_SIZE;
    const chestSpriteX = Math.round(boxX + (boxW - chestSpriteSize) / 2);
    const chestSpriteY = boxY + CHEST_SPRITE_Y_OFFSET;

    const chestOpened = this.frame >= CHEST_OPEN_FRAME;
    let srcX: number;
    if (this.chest.type === 'wooden') {
      srcX = chestOpened ? CHEST_WOODEN_OPEN_X : CHEST_WOODEN_CLOSED_X;
    } else {
      srcX = chestOpened ? CHEST_SILVER_OPEN_X : CHEST_SILVER_CLOSED_X;
    }

    ctx.drawImage(
      chestImage,
      srcX,
      0,
      CHEST_SPRITE_SOURCE_WIDTH,
      CHEST_SPRITE_SOURCE_HEIGHT,
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
      ctx.arc(p.x, p.y, PARTICLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const lootStartY = chestSpriteY + chestSpriteSize + LOOT_START_Y_OFFSET;

    if (!chestOpened) {
      const dots = '.'.repeat(
        1 + (Math.floor(this.frame / OPENING_ANIMATION_FRAME_STEP) % OPENING_DOT_CYCLE),
      );
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
        y: boxY + boxH - CONTINUE_TEXT_Y_OFFSET,
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
    const dividerX = boxX + boxW / 2;
    const colPad = LOOT_COLUMN_PADDING;
    const colW = Math.floor(boxW / 2) - colPad * 2;
    const leftColX = boxX + colPad;
    const rightColX = dividerX + colPad;

    // Column headers
    drawText(ctx, 'Human', {
      x: leftColX,
      y: lootStartY,
      width: colW,
      align: 'center',
      size: LOOT_COLUMN_HEADER_SIZE,
      bold: true,
      color: '#93c5fd',
    });
    drawText(ctx, 'Cat', {
      x: rightColX,
      y: lootStartY,
      width: colW,
      align: 'center',
      size: LOOT_COLUMN_HEADER_SIZE,
      bold: true,
      color: '#fb923c',
    });

    // Vertical divider
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dividerX, lootStartY);
    ctx.lineTo(dividerX, boxY + boxH - LOOT_COLUMN_DIVIDER_Y_OFFSET);
    ctx.stroke();
    ctx.restore();

    let leftY = lootStartY + LOOT_ITEMS_Y_OFFSET;
    let rightY = lootStartY + LOOT_ITEMS_Y_OFFSET;

    // Human loot
    if (split.humanLoot.coins > 0) {
      const { totalHeight } = drawText(ctx, `${split.humanLoot.coins} coins`, {
        x: leftColX,
        y: leftY,
        width: colW,
        align: 'center',
        ...TEXT_PRESETS.value,
      });
      leftY += totalHeight;
    }
    for (const entry of split.humanLoot.items) {
      const def = ITEM_DEF[entry.id];
      const label = entry.quantity > 1 ? `${entry.quantity}x ${def.name}` : def.name;
      const { totalHeight } = drawText(ctx, label, {
        x: leftColX,
        y: leftY,
        width: colW,
        align: 'center',
        size: LOOT_ITEM_SIZE,
        color: '#e2e8f0',
      });
      leftY += totalHeight;
    }
    if (split.humanLoot.coins === 0 && split.humanLoot.items.length === 0) {
      drawText(ctx, '(empty)', {
        x: leftColX,
        y: leftY,
        width: colW,
        align: 'center',
        ...TEXT_PRESETS.hint,
      });
    }

    // Cat loot
    if (split.catLoot.coins > 0) {
      const { totalHeight } = drawText(ctx, `${split.catLoot.coins} coins`, {
        x: rightColX,
        y: rightY,
        width: colW,
        align: 'center',
        ...TEXT_PRESETS.value,
      });
      rightY += totalHeight;
    }
    for (const entry of split.catLoot.items) {
      const def = ITEM_DEF[entry.id];
      const label = entry.quantity > 1 ? `${entry.quantity}x ${def.name}` : def.name;
      const { totalHeight } = drawText(ctx, label, {
        x: rightColX,
        y: rightY,
        width: colW,
        align: 'center',
        size: LOOT_ITEM_SIZE,
        color: '#e2e8f0',
      });
      rightY += totalHeight;
    }
    if (split.catLoot.coins === 0 && split.catLoot.items.length === 0) {
      drawText(ctx, '(empty)', {
        x: rightColX,
        y: rightY,
        width: colW,
        align: 'center',
        ...TEXT_PRESETS.hint,
      });
    }
  }
}
