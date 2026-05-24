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

// Magic number constants
const OVERLAY_ALPHA = 0.55;
const BOX_MARGIN = 32;
const BORDER_WIDTH = 8;
const BORDER_OFFSET = 4;
const PULSE_MIN = 0.85;
const PULSE_RANGE = 0.15;
const PULSE_FREQ = 0.12;
const HEADER_SIZE = 22;
const HEADER_Y_OFFSET = 40;
const HEADER_TEXT_TOP_OFFSET = 18;
const HEADER_GLOW = 16;
const DIVIDER_Y = 52;
const DIVIDER_PADDING = 24;
const DIVIDER_ALPHA = 0.4;
const ACHIEVEMENT_NAME_Y = 88;
const ACHIEVEMENT_NAME_SIZE = 18;
const ACHIEVEMENT_NAME_TOP_OFFSET = 14;
const ACHIEVEMENT_NAME_PADDING = 48;
const PLAYER_Y = 107;
const PLAYER_SIZE = 11;
const PLAYER_TOP_OFFSET = 9;
const DESCRIPTION_Y = 126;
const DESCRIPTION_SIZE = 13;
const DESCRIPTION_TOP_OFFSET = 10;
const DESCRIPTION_LINE_HEIGHT = 18;
const DESCRIPTION_PADDING = 64;
const LOOT_Y = 185;
const LOOT_TEXT_TOP_OFFSET = 10;
const LOOT_SIZE = 13;
const LOOT_PADDING = 48;
const BOX_ICON_Y = 194;
const BOX_ICON_SIZE = 24;
const OK_BTN_Y_OFFSET = 18;
const OK_BTN_LABEL_SIZE = 14;
const SPARKLE_SPAWN_RATE = 3;
const SPARKLE_BURST_MIN_SPEED = 2;
const SPARKLE_BURST_SPEED_RANGE = 5;
const SPARKLE_NORMAL_MIN_SPEED = 0.5;
const SPARKLE_NORMAL_SPEED_RANGE = 2;
const SPARKLE_BURST_GRAVITY = 2;
const SPARKLE_MIN_RADIUS = 1.5;
const SPARKLE_RADIUS_RANGE = 3;
const SPARKLE_LIFE_MIN = 30;
const SPARKLE_LIFE_MAX = 69;
const SPARKLE_TOTAL_LIFE = 70;
const SPARKLE_GRAVITY = 0.08;
const SPARKLE_SPAWN_COUNT = 30;
const SPAWN_OFFSET_RANGE = 0.5;
const DEFAULT_VIEWPORT_WIDTH = 400;
const DEFAULT_VIEWPORT_HEIGHT = 300;
const BOX_ICON_X_OFFSET = 12;
const BOX_BODY_TOP = 0.3;
const BOX_BODY_HEIGHT = 0.7;
const BOX_ICON_LINE_WIDTH = 1.5;
const BOX_LID_OFFSET = 2;
const BOX_LID_WIDTH_ADD = 4;
const BOX_LID_HEIGHT = 0.12;
const BOX_LID_TOP = 0.25;

export class AchievementNotification {
  private frame = 0;
  private sparkles: Sparkle[] = [];
  private okRect = { x: 0, y: 0, w: OK_BTN_W, h: OK_BTN_H };
  audio: AudioManager | null = null;

  /** Call once per frame when a notification is visible to advance animation. */
  tick(): void {
    this.frame++;

    // Spawn sparkles continuously during display
    if (this.frame % SPARKLE_SPAWN_RATE === 0) {
      this.spawnSparkle();
    }

    // Advance sparkles
    for (const s of this.sparkles) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += SPARKLE_GRAVITY; // gentle gravity
      s.life--;
    }
    this.sparkles = this.sparkles.filter((s) => s.life > 0);
  }

  /** Reset animation state — call this when a new notification starts. */
  reset(): void {
    this.frame = 0;
    this.sparkles = [];
    // Burst of sparkles on appearance
    for (let i = 0; i < SPARKLE_SPAWN_COUNT; i++) this.spawnSparkle(true);
  }

  private spawnSparkle(burst = false): void {
    const angle = Math.random() * Math.PI * 2;
    const speed = burst
      ? SPARKLE_BURST_MIN_SPEED + Math.random() * SPARKLE_BURST_SPEED_RANGE
      : SPARKLE_NORMAL_MIN_SPEED + Math.random() * SPARKLE_NORMAL_SPEED_RANGE;
    // Spawn around the edges of the notification box (approximate screen center)
    const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : DEFAULT_VIEWPORT_WIDTH;
    const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : DEFAULT_VIEWPORT_HEIGHT;
    const edgeX = cx + (Math.random() - SPAWN_OFFSET_RANGE) * BOX_W;
    const edgeY = cy + (Math.random() - SPAWN_OFFSET_RANGE) * BOX_H;
    this.sparkles.push({
      x: edgeX,
      y: edgeY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (burst ? SPARKLE_BURST_GRAVITY : 0),
      radius: SPARKLE_MIN_RADIUS + Math.random() * SPARKLE_RADIUS_RANGE,
      color: randomFromArray(SPARKLE_COLORS),
      life: randomInt(SPARKLE_LIFE_MIN, SPARKLE_LIFE_MAX),
      maxLife: SPARKLE_TOTAL_LIFE,
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

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: alpha * OVERLAY_ALPHA });
    ctx.save();
    ctx.globalAlpha = alpha;

    const boxW = Math.min(BOX_W, cw - BOX_MARGIN);
    const boxH = Math.min(BOX_H, ch - BOX_MARGIN);
    const bx = (cw - boxW) / 2;
    const by = (ch - boxH) / 2;

    // Main box — dark blue-gold gradient feel
    drawBox(ctx, { x: bx, y: by, width: boxW, height: boxH, ...BOX_PRESETS.achievement, alpha });

    // Gold border — double ring (inner decorative ring)
    ctx.strokeStyle = 'rgba(255,215,0,0.3)';
    ctx.lineWidth = BORDER_WIDTH;
    ctx.strokeRect(
      bx + BORDER_OFFSET,
      by + BORDER_OFFSET,
      boxW - BORDER_WIDTH,
      boxH - BORDER_WIDTH,
    );

    // Header: NEW ACHIEVEMENT!
    const pulse = PULSE_MIN + PULSE_RANGE * Math.sin(this.frame * PULSE_FREQ);
    drawText(ctx, 'NEW ACHIEVEMENT!', {
      x: cw / 2,
      y: by + HEADER_Y_OFFSET - HEADER_TEXT_TOP_OFFSET,
      bold: true,
      size: HEADER_SIZE,
      color: '#ffd700',
      align: 'center',
      glow: '#ffd700',
      glowBlur: HEADER_GLOW,
      alpha: alpha * pulse,
    });

    // Divider line
    drawDivider(ctx, {
      x: bx + DIVIDER_PADDING,
      y: by + DIVIDER_Y,
      length: boxW - DIVIDER_PADDING * 2,
      color: `rgba(255,215,0,${DIVIDER_ALPHA})`,
      alpha,
    });

    // Achievement name
    drawText(ctx, achievement.name, {
      x: bx + DIVIDER_PADDING,
      y: by + ACHIEVEMENT_NAME_Y - ACHIEVEMENT_NAME_TOP_OFFSET,
      bold: true,
      size: ACHIEVEMENT_NAME_SIZE,
      color: '#f1f5f9',
      align: 'center',
      width: boxW - ACHIEVEMENT_NAME_PADDING,
      alpha,
    });

    // Awarded-to label
    const playerColor = player === 'Human' ? '#86efac' : '#93c5fd';
    const playerIcon = player === 'Human' ? '\u{1F9CD}' : '\u{1F431}';
    drawText(ctx, `${playerIcon} Awarded to: ${player}`, {
      x: cw / 2,
      y: by + PLAYER_Y - PLAYER_TOP_OFFSET,
      size: PLAYER_SIZE,
      color: playerColor,
      align: 'center',
      alpha,
    });

    // Description (word-wrapped)
    drawText(ctx, achievement.description, {
      x: cw / 2 - (boxW - DESCRIPTION_PADDING) / 2,
      y: by + DESCRIPTION_Y - DESCRIPTION_TOP_OFFSET,
      size: DESCRIPTION_SIZE,
      color: '#94a3b8',
      align: 'center',
      width: boxW - DESCRIPTION_PADDING,
      lineHeight: DESCRIPTION_LINE_HEIGHT,
      alpha,
    });

    // Loot box reward
    if (achievement.lootBox) {
      const { tier, category } = achievement.lootBox;
      const tierColor = this.tierColor(tier);
      drawText(ctx, `REWARD: ${tier} ${category} Box`, {
        x: bx + DIVIDER_PADDING,
        y: by + LOOT_Y - LOOT_TEXT_TOP_OFFSET,
        bold: true,
        size: LOOT_SIZE,
        color: tierColor,
        align: 'center',
        width: boxW - LOOT_PADDING,
        alpha,
      });

      // Small box icon
      this.drawBoxIcon(ctx, cw / 2 - BOX_ICON_X_OFFSET, by + BOX_ICON_Y, BOX_ICON_SIZE, tier);
    }

    // OK button
    const okX = cw / 2 - OK_BTN_W / 2;
    const okY = by + boxH - OK_BTN_H - OK_BTN_Y_OFFSET;
    this.okRect = { x: okX, y: okY, w: OK_BTN_W, h: OK_BTN_H };

    drawButton(ctx, {
      x: okX,
      y: okY,
      width: OK_BTN_W,
      height: OK_BTN_H,
      label: 'OK!',
      ...BUTTON_PRESETS.success,
      labelColor: '#4ade80',
      labelSize: OK_BTN_LABEL_SIZE,
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
    ctx.fillRect(x, y + size * BOX_BODY_TOP, size, size * BOX_BODY_HEIGHT);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = BOX_ICON_LINE_WIDTH;
    ctx.strokeRect(x, y + size * BOX_BODY_TOP, size, size * BOX_BODY_HEIGHT);
    // Lid
    ctx.strokeRect(
      x - BOX_LID_OFFSET,
      y + size * BOX_LID_TOP,
      size + BOX_LID_WIDTH_ADD,
      size * BOX_LID_HEIGHT,
    );
    // Ribbon
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y + size * BOX_LID_TOP);
    ctx.lineTo(x + size / 2, y + size);
    ctx.stroke();
  }
}
