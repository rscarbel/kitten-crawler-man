import type { AchievementDef } from '../core/AchievementManager';
import { randomFromArray, randomInt, pointInRect } from '../utils';
import { drawText } from './TextBox';
import { drawOverlay, drawBox, drawDivider, BOX_PRESETS } from './Box';
import { drawButton, BUTTON_PRESETS } from './Button';
import type { AudioManager } from '../audio/AudioManager';

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
}

const SPARKLE_COLORS = [
  '#ffd700',
  '#ffec6e',
  '#fffbe6',
  '#fbbf24',
  '#f59e0b',
  '#fff',
  '#e0f2fe',
  '#bae6fd',
];

const BOX_W = 420;
const BOX_H = 280;
const FADE_IN_FRAMES = 18;
const OK_BTN_W = 100;
const OK_BTN_H = 36;

export class AchievementNotification {
  private frame = 0;
  private sparkles: Sparkle[] = [];
  private okRect = { x: 0, y: 0, w: OK_BTN_W, h: OK_BTN_H };
  audio: AudioManager | null = null;

  /** Call once per frame when a notification is visible to advance animation. */
  tick(): void {
    this.frame++;

    // Spawn sparkles continuously during display
    if (this.frame % 3 === 0) {
      this.spawnSparkle();
    }

    // Advance sparkles
    for (const s of this.sparkles) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.08; // gentle gravity
      s.life--;
    }
    this.sparkles = this.sparkles.filter((s) => s.life > 0);
  }

  /** Reset animation state — call this when a new notification starts. */
  reset(): void {
    this.frame = 0;
    this.sparkles = [];
    // Burst of sparkles on appearance
    for (let i = 0; i < 30; i++) this.spawnSparkle(true);
  }

  private spawnSparkle(burst = false): void {
    const angle = Math.random() * Math.PI * 2;
    const speed = burst ? 2 + Math.random() * 5 : 0.5 + Math.random() * 2;
    // Spawn around the edges of the notification box (approximate screen center)
    const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 400;
    const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 300;
    const edgeX = cx + (Math.random() - 0.5) * BOX_W;
    const edgeY = cy + (Math.random() - 0.5) * BOX_H;
    this.sparkles.push({
      x: edgeX,
      y: edgeY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (burst ? 2 : 0),
      radius: 1.5 + Math.random() * 3,
      color: randomFromArray(SPARKLE_COLORS),
      life: randomInt(30, 69),
      maxLife: 70,
    });
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    achievement: AchievementDef,
    player: 'Human' | 'Cat' = 'Human',
  ): void {
    const cw = canvas.width;
    const ch = canvas.height;

    // Fade-in alpha
    const alpha = Math.min(1, this.frame / FADE_IN_FRAMES);

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: alpha * 0.55 });
    ctx.save();
    ctx.globalAlpha = alpha;

    const boxW = Math.min(BOX_W, cw - 32);
    const boxH = Math.min(BOX_H, ch - 32);
    const bx = (cw - boxW) / 2;
    const by = (ch - boxH) / 2;

    // Main box — dark blue-gold gradient feel
    drawBox(ctx, { x: bx, y: by, width: boxW, height: boxH, ...BOX_PRESETS.achievement, alpha });

    // Gold border — double ring (inner decorative ring)
    ctx.strokeStyle = 'rgba(255,215,0,0.3)';
    ctx.lineWidth = 8;
    ctx.strokeRect(bx + 4, by + 4, boxW - 8, boxH - 8);

    // Header: NEW ACHIEVEMENT!
    const pulse = 0.85 + 0.15 * Math.sin(this.frame * 0.12);
    drawText(ctx, 'NEW ACHIEVEMENT!', {
      x: cw / 2,
      y: by + 40 - 18,
      bold: true,
      size: 22,
      color: '#ffd700',
      align: 'center',
      glow: '#ffd700',
      glowBlur: 16,
      alpha: alpha * pulse,
    });

    // Divider line
    drawDivider(ctx, {
      x: bx + 24,
      y: by + 52,
      length: boxW - 48,
      color: 'rgba(255,215,0,0.4)',
      alpha,
    });

    // Achievement name
    drawText(ctx, achievement.name, {
      x: bx + 24,
      y: by + 88 - 14,
      bold: true,
      size: 18,
      color: '#f1f5f9',
      align: 'center',
      width: boxW - 48,
      alpha,
    });

    // Awarded-to label
    const playerColor = player === 'Human' ? '#86efac' : '#93c5fd';
    const playerIcon = player === 'Human' ? '\u{1F9CD}' : '\u{1F431}';
    drawText(ctx, `${playerIcon} Awarded to: ${player}`, {
      x: cw / 2,
      y: by + 107 - 9,
      size: 11,
      color: playerColor,
      align: 'center',
      alpha,
    });

    // Description (word-wrapped)
    drawText(ctx, achievement.description, {
      x: cw / 2 - (boxW - 64) / 2,
      y: by + 126 - 10,
      size: 13,
      color: '#94a3b8',
      align: 'center',
      width: boxW - 64,
      lineHeight: 18,
      alpha,
    });

    // Loot box reward
    if (achievement.lootBox) {
      const { tier, category } = achievement.lootBox;
      const tierColor = this.tierColor(tier);
      drawText(ctx, `REWARD: ${tier} ${category} Box`, {
        x: bx + 24,
        y: by + 185 - 10,
        bold: true,
        size: 13,
        color: tierColor,
        align: 'center',
        width: boxW - 48,
        alpha,
      });

      // Small box icon
      this.drawBoxIcon(ctx, cw / 2 - 12, by + 194, 24, tier);
    }

    // OK button
    const okX = cw / 2 - OK_BTN_W / 2;
    const okY = by + boxH - OK_BTN_H - 18;
    this.okRect = { x: okX, y: okY, w: OK_BTN_W, h: OK_BTN_H };

    drawButton(ctx, {
      x: okX,
      y: okY,
      width: OK_BTN_W,
      height: OK_BTN_H,
      label: 'OK!',
      ...BUTTON_PRESETS.success,
      labelColor: '#4ade80',
      labelSize: 14,
      alpha,
    });

    // Sparkles
    for (const s of this.sparkles) {
      const lifeRatio = s.life / s.maxLife;
      ctx.globalAlpha = alpha * lifeRatio;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius * lifeRatio, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Returns true if the click hit the OK button (notification should be dismissed).
   * Only responds if the notification has fully appeared (past fade-in).
   */
  handleClick(mx: number, my: number): boolean {
    if (this.frame < FADE_IN_FRAMES) return false;
    const r = this.okRect;
    return pointInRect(mx, my, r);
  }

  /** Space bar counts as OK once the notification has fully faded in. */
  handleSpaceBar(): boolean {
    return this.frame >= FADE_IN_FRAMES;
  }

  // Helpers

  private tierColor(tier: string): string {
    switch (tier) {
      case 'Bronze':
        return '#cd7f32';
      case 'Silver':
        return '#c0c0c0';
      case 'Gold':
        return '#ffd700';
      case 'Legendary':
        return '#a855f7';
      case 'Celestial':
        return '#38bdf8';
      default:
        return '#e2e8f0';
    }
  }

  private drawBoxIcon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    tier: string,
  ): void {
    const color = this.tierColor(tier);
    // Box body
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(x, y + size * 0.3, size, size * 0.7);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y + size * 0.3, size, size * 0.7);
    // Lid
    ctx.strokeRect(x - 2, y + size * 0.25, size + 4, size * 0.12);
    // Ribbon
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y + size * 0.25);
    ctx.lineTo(x + size / 2, y + size);
    ctx.stroke();
  }
}
