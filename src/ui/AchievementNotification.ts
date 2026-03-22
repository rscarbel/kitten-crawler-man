import type { AchievementDef } from '../core/AchievementManager';

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
      color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
      life: 30 + Math.floor(Math.random() * 40),
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

    ctx.save();
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = alpha;

    const bx = (cw - BOX_W) / 2;
    const by = (ch - BOX_H) / 2;

    // Main box — dark blue-gold gradient feel
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 32;
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(bx, by, BOX_W, BOX_H);
    ctx.shadowBlur = 0;

    // Gold border — double ring
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, BOX_W, BOX_H);
    ctx.strokeStyle = 'rgba(255,215,0,0.3)';
    ctx.lineWidth = 8;
    ctx.strokeRect(bx + 4, by + 4, BOX_W - 8, BOX_H - 8);

    // Header: NEW ACHIEVEMENT!
    const pulse = 0.85 + 0.15 * Math.sin(this.frame * 0.12);
    ctx.globalAlpha = alpha * pulse;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 16;
    ctx.fillText('NEW ACHIEVEMENT!', cw / 2, by + 40);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha;

    // Divider line
    ctx.strokeStyle = 'rgba(255,215,0,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + 24, by + 52);
    ctx.lineTo(bx + BOX_W - 24, by + 52);
    ctx.stroke();

    // Achievement name
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(achievement.name, cw / 2, by + 88);

    // Awarded-to label
    const playerColor = player === 'Human' ? '#86efac' : '#93c5fd';
    const playerIcon = player === 'Human' ? '\u{1F9CD}' : '\u{1F431}';
    ctx.fillStyle = playerColor;
    ctx.font = '11px monospace';
    ctx.fillText(`${playerIcon} Awarded to: ${player}`, cw / 2, by + 107);

    // Description
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    // Word-wrap the description
    this.wrapText(ctx, achievement.description, cw / 2, by + 126, BOX_W - 64, 18);

    // Loot box reward
    if (achievement.lootBox) {
      const { tier, category } = achievement.lootBox;
      const tierColor = this.tierColor(tier);
      ctx.fillStyle = tierColor;
      ctx.font = 'bold 13px monospace';
      ctx.fillText(`REWARD: ${tier} ${category} Box`, cw / 2, by + 185);

      // Small box icon
      this.drawBoxIcon(ctx, cw / 2 - 12, by + 194, 24, tier);
    }

    // OK button
    const okX = cw / 2 - OK_BTN_W / 2;
    const okY = by + BOX_H - OK_BTN_H - 18;
    this.okRect = { x: okX, y: okY, w: OK_BTN_W, h: OK_BTN_H };

    ctx.fillStyle = '#1e3a0f';
    ctx.fillRect(okX, okY, OK_BTN_W, OK_BTN_H);
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.strokeRect(okX, okY, OK_BTN_W, OK_BTN_H);
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('OK!', cw / 2, okY + OK_BTN_H / 2 + 5);

    // Sparkles
    ctx.textAlign = 'left';
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
    return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
  }

  // Helpers

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    y: number,
    maxW: number,
    lineH: number,
  ): void {
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx, y);
        line = word;
        y += lineH;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, cx, y);
  }

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
