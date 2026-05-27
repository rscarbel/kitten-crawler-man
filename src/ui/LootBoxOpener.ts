import type { LootBox, BoxContents } from '../core/AchievementManager';
import { getBoxContents } from '../core/AchievementManager';
import { randomFromArray, randomInt } from '../utils';
import { drawText } from './TextBox';
import { drawOverlay, drawBox, drawDivider, drawProgressBar } from './Box';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
}

const PARTICLE_COLORS = [
  '#ffd700',
  '#ff6b6b',
  '#4ade80',
  '#38bdf8',
  '#a855f7',
  '#fb923c',
  '#fff',
  '#fbbf24',
];

type Phase = 'shaking' | 'opening' | 'revealing' | 'done';

const BOX_W = 400;
const BOX_H = 300;
const SHAKE_FRAMES = 40;
const OPEN_FRAMES = 30;
const REVEAL_FRAMES = 50;
/** Frames to display the open box before auto-advancing to the next. */
const NEXT_DELAY = 180;

// Panel margin
const PANEL_MARGIN = 32;

// Ongoing sparkle frequency (every N frames)
const SPARKLE_INTERVAL = 6;
// Reveal sparkle frequency
const REVEAL_SPARKLE_INTERVAL = 4;

// Content reveal layout
const CONTENT_Y_OFFSET_FRACTION = 0.633;

// Reveal opacity transition
const REVEAL_FADE_FRACTION = 0.6;

// Skip hint y from bottom
const SKIP_HINT_BOTTOM_OFFSET = 52;

// Countdown bar layout
const COUNTDOWN_BAR_MARGIN = 24;
const COUNTDOWN_BAR_SIDE_PAD = 48;
const COUNTDOWN_BAR_Y_FROM_BOTTOM = 18;
const COUNTDOWN_BAR_H = 6;
const COUNTDOWN_BAR_ALPHA = 0.7;

// Countdown label y offset above bar
const COUNTDOWN_LABEL_Y_ABOVE_BAR = 4;
const COUNTDOWN_LABEL_CORRECTION = 8;

// Animated box graphic
const BOX_ANIM_SIZE = 56;
const BOX_SHAKE_AMPLITUDE_FRAMES = 1.8;
const BOX_SHAKE_COS_FREQ = 2.1;
const BOX_SHAKE_COS_AMP = 2;
const BOX_LID_ANGLE = -0.9;
const BOX_LID_PAD = 4;
const BOX_LID_HEIGHT_FRAC = 0.18;
const BOX_GLOW_OPEN_ALPHA = 0.6;
const BOX_GLOW_FILL_PAD = 4;
const BOX_GLOW_FILL_W_FRAC = 0.6;
const BOX_BODY_FILL_ALPHA = 0.15;
const BOX_BODY_Y_FRAC = 0.15;
const BOX_BODY_H_FRAC = 0.85;
const BOX_SHAKE_FILL_ALPHA = 0.2;
const BOX_SHAKE_FILL_Y_FRAC = 0.18;
const BOX_RIBBON_Y_FRAC = 0.15;
const BOX_GLOW_FILL_Y_FRAC = 0.2;

// Particle physics
const PARTICLE_GRAVITY = 0.12;
const PARTICLE_BURST_SPEED_BASE = 3;
const PARTICLE_BURST_SPEED_RANGE = 6;
const PARTICLE_IDLE_SPEED_BASE = 1;
const PARTICLE_IDLE_SPEED_RANGE = 2;
const PARTICLE_BURST_SPREAD_X = 80;
const PARTICLE_BURST_LIFT = 3;
const PARTICLE_RADIUS_BASE = 2;
const PARTICLE_RADIUS_RANGE = 4;
const PARTICLE_LIFE_MIN = 40;
const PARTICLE_LIFE_MAX = 79;
const PARTICLE_MAX_LIFE = 80;

// Panel header layout
const HEADER_PROGRESS_RIGHT_MARGIN = 12;
const HEADER_PROGRESS_Y_FROM_TOP = 20;
const HEADER_TITLE_X_MARGIN = 16;
const HEADER_TITLE_Y_FROM_TOP = 36;
const HEADER_TITLE_SIZE = 17;
const HEADER_TITLE_FONT_CORRECTION = 14;
const HEADER_PLAYER_Y_FROM_TOP = 52;
const HEADER_PLAYER_Y_CORRECTION = 9;
const HEADER_PLAYER_SIZE = 11;
const HEADER_DIVIDER_Y_FROM_TOP = 62;
const HEADER_DIVIDER_SIDE_PAD = 24;

// Content rendering layout
const CONTENT_LINE_STEP_SMALL = 14;
const CONTENT_LINE_STEP_NORMAL = 16;
const CONTENT_FONT_SMALL = 10;
const CONTENT_FONT_NORMAL = 12;
const CONTENT_FONT_SMALL_THRESHOLD = 3;
const CONTENT_RECEIVED_Y_OFFSET = 10;
const CONTENT_RECEIVED_SIZE = 13;
const CONTENT_ITEM_Y_OFFSET = 10;
const CONTENT_ADVANCE_Y = 18;

// Content reveal position
const CONTENT_LEFT_PAD = 20;
const CONTENT_WIDTH_REDUCTION = 40;

// Particle spread — centering the random range around zero
const PARTICLE_CENTER_OFFSET = 0.5;

// Burst particle counts
const BURST_COUNT_OPEN = 30;
const BURST_COUNT_REVEAL = 50;

// Header progress bar correction
const HEADER_PROGRESS_Y_CORRECTION = 9;

/** Ascending rarity order for sorting boxes (lowest first). */
const TIER_ORDER: Record<string, number> = {
  Bronze: 0,
  Silver: 1,
  Gold: 2,
  Legendary: 3,
  Celestial: 4,
};

export class LootBoxOpener {
  private active = false;
  private queue: LootBox[] = [];
  private queueIndex = 0;
  private phase: Phase = 'shaking';
  private frame = 0;
  /** Countdown after 'done' before auto-advancing. */
  private nextTimer = 0;
  private particles: Particle[] = [];
  private box: LootBox | null = null;
  private contents: BoxContents | null = null;
  private rewardGranted = false;
  private playerName = '';

  private onBoxOpened: ((box: LootBox, contents: BoxContents) => void) | null = null;
  private onAllDone: (() => void) | null = null;
  private onEachBoxOpening: (() => void) | null = null;

  /** True while the opener is running through its queue. */
  get isOpen(): boolean {
    return this.active;
  }

  /**
   * Skip the current animation.
   * - During shaking/opening/revealing: jumps straight to the done/reveal state.
   * - During done (waiting for auto-advance): immediately advances to the next box.
   */
  skip(): void {
    if (!this.active || !this.box) return;
    if (this.phase === 'done') {
      this.nextTimer = 0;
      this.advance();
    } else {
      this.phase = 'done';
      this.frame = 0;
      this.nextTimer = NEXT_DELAY;
      this.burstParticles(BURST_COUNT_REVEAL);
      if (!this.rewardGranted && this.onBoxOpened && this.contents) {
        this.rewardGranted = true;
        this.onBoxOpened(this.box, this.contents);
      }
    }
  }

  /**
   * Sort boxes by ascending rarity (Bronze first, Celestial last) and begin
   * opening them one by one automatically.
   *
   * @param boxes         Boxes to open (will be shallow-copied and sorted).
   * @param onBoxOpened   Called once per box when its reveal finishes.
   *                      Caller should grant rewards and remove the box from
   *                      the AchievementManager at this point.
   * @param onAllDone     Called after every box has been opened.
   */
  startQueue(
    boxes: LootBox[],
    playerName: string,
    onBoxOpened: (box: LootBox, contents: BoxContents) => void,
    onAllDone: () => void,
    onEachBoxOpening?: () => void,
  ): void {
    if (boxes.length === 0) return;
    this.queue = [...boxes].sort((a, b) => (TIER_ORDER[a.tier] ?? 0) - (TIER_ORDER[b.tier] ?? 0)); // ascending rarity
    this.queueIndex = 0;
    this.playerName = playerName;
    this.onBoxOpened = onBoxOpened;
    this.onAllDone = onAllDone;
    this.onEachBoxOpening = onEachBoxOpening ?? null;
    this.active = true;
    this.loadCurrent();
  }

  tick(): void {
    if (!this.active || !this.box) return;
    this.frame++;

    // Auto-advance countdown while in 'done' phase
    if (this.phase === 'done') {
      if (this.nextTimer > 0) {
        this.nextTimer--;
        if (this.nextTimer === 0) this.advance();
      }
      // Gentle ongoing sparkles while waiting
      if (this.frame % SPARKLE_INTERVAL === 0) this.spawnParticle();
    }

    switch (this.phase) {
      case 'shaking':
        if (this.frame >= SHAKE_FRAMES) {
          this.phase = 'opening';
          this.frame = 0;
          this.burstParticles(BURST_COUNT_OPEN);
          this.onEachBoxOpening?.();
        }
        break;
      case 'opening':
        if (this.frame >= OPEN_FRAMES) {
          this.phase = 'revealing';
          this.frame = 0;
          this.burstParticles(BURST_COUNT_REVEAL);
        }
        break;
      case 'revealing':
        if (this.frame % REVEAL_SPARKLE_INTERVAL === 0) this.spawnParticle();
        if (this.frame >= REVEAL_FRAMES) {
          this.phase = 'done';
          this.frame = 0;
          this.nextTimer = NEXT_DELAY;
          // Grant reward exactly once per box
          if (!this.rewardGranted && this.onBoxOpened && this.contents) {
            this.rewardGranted = true;
            this.onBoxOpened(this.box, this.contents);
          }
        }
        break;
      case 'done':
        break;
    }

    // Animate particles
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += PARTICLE_GRAVITY;
      p.life--;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this.active || !this.box) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const boxW = Math.min(BOX_W, cw - PANEL_MARGIN);
    const boxH = Math.min(BOX_H, ch - PANEL_MARGIN);
    const bx = (cw - boxW) / 2;
    const by = (ch - boxH) / 2;
    const cx = cw / 2;

    // Backdrop
    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: 0.7 });

    // Panel
    const tierColor = this.tierColor(this.box.tier);
    drawBox(ctx, {
      x: bx,
      y: by,
      width: boxW,
      height: boxH,
      fill: '#0f172a',
      border: tierColor,
      borderWidth: 2.5,
      glow: tierColor,
      glowBlur: 28,
    });

    // Progress indicator (N of M)
    const total = this.queue.length;
    const current = this.queueIndex + 1;
    drawText(ctx, `Box ${current} of ${total}`, {
      x: bx + boxW - HEADER_PROGRESS_RIGHT_MARGIN,
      y: by + HEADER_PROGRESS_Y_FROM_TOP - HEADER_PROGRESS_Y_CORRECTION,
      size: HEADER_PLAYER_SIZE,
      color: '#64748b',
      align: 'right',
    });

    drawText(ctx, `${this.box.tier} ${this.box.category} Box`, {
      x: bx + HEADER_TITLE_X_MARGIN,
      y: by + HEADER_TITLE_Y_FROM_TOP - HEADER_TITLE_FONT_CORRECTION,
      bold: true,
      size: HEADER_TITLE_SIZE,
      color: tierColor,
      align: 'center',
      width: boxW - PANEL_MARGIN,
    });

    // Player label
    drawText(ctx, `for ${this.playerName}`, {
      x: cx,
      y: by + HEADER_PLAYER_Y_FROM_TOP - HEADER_PLAYER_Y_CORRECTION,
      size: HEADER_PLAYER_SIZE,
      color: '#94a3b8',
      align: 'center',
    });

    // Divider
    drawDivider(ctx, {
      x: bx + HEADER_DIVIDER_SIDE_PAD,
      y: by + HEADER_DIVIDER_Y_FROM_TOP,
      length: boxW - COUNTDOWN_BAR_SIDE_PAD,
      color: `${tierColor}55`,
    });

    // Draw the animated box graphic
    this.drawAnimatedBox(ctx, cx, by + boxH / 2 - HEADER_TITLE_FONT_CORRECTION, tierColor);

    // Content reveal
    if (this.phase === 'revealing' || this.phase === 'done') {
      const revealAlpha =
        this.phase === 'done'
          ? 1
          : Math.min(1, this.frame / (REVEAL_FRAMES * REVEAL_FADE_FRACTION));
      ctx.globalAlpha = revealAlpha;
      // Pass left edge of content area so drawText centers within the dialog box
      this.renderContents(
        ctx,
        bx + CONTENT_LEFT_PAD,
        by + Math.round(boxH * CONTENT_Y_OFFSET_FRACTION),
        boxW - CONTENT_WIDTH_REDUCTION,
      );
      ctx.globalAlpha = 1;
    }

    // Skip hint — raised to avoid overlapping the countdown label
    drawText(ctx, this.phase === 'done' ? 'Click to continue' : 'Click to skip', {
      x: cx,
      y: by + boxH - SKIP_HINT_BOTTOM_OFFSET,
      size: HEADER_PLAYER_SIZE,
      color: '#475569',
      align: 'center',
    });

    // Auto-advance countdown bar (shown during 'done' phase)
    if (this.phase === 'done' && this.nextTimer > 0) {
      const ratio = this.nextTimer / NEXT_DELAY;
      const barW = boxW - COUNTDOWN_BAR_SIDE_PAD;
      const barX = bx + COUNTDOWN_BAR_MARGIN;
      const barY = by + boxH - COUNTDOWN_BAR_Y_FROM_BOTTOM;
      drawProgressBar(ctx, {
        x: barX,
        y: barY,
        width: barW,
        height: COUNTDOWN_BAR_H,
        value: ratio,
        fill: tierColor,
        background: '#1e293b',
        alpha: COUNTDOWN_BAR_ALPHA,
      });

      // "Next box…" or "Done!" label
      const isLast = this.queueIndex >= this.queue.length - 1;
      drawText(ctx, isLast ? 'Done!' : 'Next box…', {
        x: cx,
        y: barY - COUNTDOWN_LABEL_Y_ABOVE_BAR - COUNTDOWN_LABEL_CORRECTION,
        size: HEADER_PLAYER_SIZE,
        color: '#64748b',
        align: 'center',
      });
    }

    // Particles
    for (const p of this.particles) {
      const ratio = p.life / p.maxLife;
      ctx.globalAlpha = ratio;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * ratio, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // Private helpers

  private loadCurrent(): void {
    this.box = this.queue[this.queueIndex];
    this.contents = getBoxContents(this.box.tier, this.box.category);
    this.phase = 'shaking';
    this.frame = 0;
    this.nextTimer = 0;
    this.particles = [];
    this.rewardGranted = false;
  }

  private advance(): void {
    this.queueIndex++;
    if (this.queueIndex >= this.queue.length) {
      this.active = false;
      this.box = null;
      this.queue = [];
      this.onAllDone?.();
    } else {
      this.loadCurrent();
    }
  }

  private burstParticles(count: number): void {
    for (let i = 0; i < count; i++) this.spawnParticle(true);
  }

  private spawnParticle(burst = false): void {
    const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : BOX_W / 2;
    const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : BOX_H / 2;
    const angle = Math.random() * Math.PI * 2;
    const speed = burst
      ? PARTICLE_BURST_SPEED_BASE + Math.random() * PARTICLE_BURST_SPEED_RANGE
      : PARTICLE_IDLE_SPEED_BASE + Math.random() * PARTICLE_IDLE_SPEED_RANGE;
    this.particles.push({
      x: cx + (Math.random() - PARTICLE_CENTER_OFFSET) * PARTICLE_BURST_SPREAD_X,
      y: cy + (Math.random() - PARTICLE_CENTER_OFFSET) * PARTICLE_BURST_SPREAD_X,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (burst ? PARTICLE_BURST_LIFT : 0),
      radius: PARTICLE_RADIUS_BASE + Math.random() * PARTICLE_RADIUS_RANGE,
      color: randomFromArray(PARTICLE_COLORS),
      life: randomInt(PARTICLE_LIFE_MIN, PARTICLE_LIFE_MAX),
      maxLife: PARTICLE_MAX_LIFE,
    });
  }

  private drawAnimatedBox(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    color: string,
  ): void {
    const size = BOX_ANIM_SIZE;

    let shakeX = 0;
    let shakeY = 0;
    if (this.phase === 'shaking') {
      const t = this.frame / SHAKE_FRAMES;
      const intensity =
        Math.sin(this.frame * BOX_SHAKE_AMPLITUDE_FRAMES) * PARTICLE_BURST_LIFT +
        2 * (1 - t * REVEAL_FADE_FRACTION);
      shakeX = intensity;
      shakeY = Math.cos(this.frame * BOX_SHAKE_COS_FREQ) * BOX_SHAKE_COS_AMP;
    }

    const bx = cx - size / 2 + shakeX;
    const by = cy - size / 2 + shakeY;

    if (this.phase === 'opening' || this.phase === 'revealing' || this.phase === 'done') {
      // Lid flying open
      const t = this.phase === 'opening' ? Math.min(1, this.frame / OPEN_FRAMES) : 1;
      const lidAngle = t * BOX_LID_ANGLE;
      ctx.save();
      ctx.translate(bx + size / 2, by + size * BOX_BODY_Y_FRAC);
      ctx.rotate(lidAngle);
      ctx.fillStyle = color;
      const LID_FILL_ALPHA = 0.25;
      ctx.globalAlpha = LID_FILL_ALPHA;
      ctx.fillRect(
        -size / 2 - BOX_LID_PAD,
        -size * BOX_LID_HEIGHT_FRAC,
        size + BOX_LID_PAD * 2,
        size * BOX_LID_HEIGHT_FRAC,
      );
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      const BOX_LID_LINE_W = 2;
      ctx.lineWidth = BOX_LID_LINE_W;
      ctx.strokeRect(
        -size / 2 - BOX_LID_PAD,
        -size * BOX_LID_HEIGHT_FRAC,
        size + BOX_LID_PAD * 2,
        size * BOX_LID_HEIGHT_FRAC,
      );
      ctx.restore();

      // Glow from inside
      {
        ctx.save();
        const glowAlpha =
          this.phase === 'opening'
            ? Math.min(1, this.frame / OPEN_FRAMES) * BOX_GLOW_OPEN_ALPHA
            : BOX_GLOW_OPEN_ALPHA;
        ctx.globalAlpha = glowAlpha;
        ctx.shadowColor = color;
        const BOX_GLOW_BLUR = 30;
        ctx.shadowBlur = BOX_GLOW_BLUR;
        ctx.fillStyle = color;
        ctx.fillRect(
          bx + BOX_GLOW_FILL_PAD,
          by + size * BOX_GLOW_FILL_Y_FRAC,
          size - BOX_GLOW_FILL_PAD * 2,
          size * BOX_GLOW_FILL_W_FRAC,
        );
        ctx.restore();
      }
    }

    // Box body
    ctx.fillStyle = color;
    ctx.globalAlpha = BOX_BODY_FILL_ALPHA;
    ctx.fillRect(bx, by + size * BOX_BODY_Y_FRAC, size, size * BOX_BODY_H_FRAC);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    const BOX_BODY_LINE_W = 2.5;
    ctx.lineWidth = BOX_BODY_LINE_W;
    ctx.strokeRect(bx, by + size * BOX_BODY_Y_FRAC, size, size * BOX_BODY_H_FRAC);

    if (this.phase === 'shaking') {
      ctx.fillStyle = color;
      ctx.globalAlpha = BOX_SHAKE_FILL_ALPHA;
      ctx.fillRect(bx - BOX_LID_PAD, by, size + BOX_LID_PAD * 2, size * BOX_SHAKE_FILL_Y_FRAC);
      ctx.globalAlpha = 1;
      ctx.strokeRect(bx - BOX_LID_PAD, by, size + BOX_LID_PAD * 2, size * BOX_SHAKE_FILL_Y_FRAC);
    }

    // Ribbon
    ctx.strokeStyle = `${color}cc`;
    const RIBBON_LINE_W = 2;
    ctx.lineWidth = RIBBON_LINE_W;
    ctx.beginPath();
    ctx.moveTo(cx, by + size * BOX_RIBBON_Y_FRAC);
    ctx.lineTo(cx, by + size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx, cy);
    ctx.lineTo(bx + size, cy);
    ctx.stroke();
  }

  private renderContents(
    ctx: CanvasRenderingContext2D,
    leftX: number,
    y: number,
    maxW: number,
  ): void {
    if (!this.contents) return;

    drawText(ctx, `${this.playerName} received:`, {
      x: leftX,
      y: y - CONTENT_RECEIVED_Y_OFFSET,
      bold: true,
      size: CONTENT_RECEIVED_SIZE,
      color: '#f1f5f9',
      align: 'center',
      width: maxW,
    });
    y += CONTENT_ADVANCE_Y;

    if (this.contents.displayLines !== undefined) {
      const lines = this.contents.displayLines;
      const itemFontSize =
        lines.length >= CONTENT_FONT_SMALL_THRESHOLD ? CONTENT_FONT_SMALL : CONTENT_FONT_NORMAL;
      const lineStep =
        itemFontSize <= CONTENT_FONT_SMALL ? CONTENT_LINE_STEP_SMALL : CONTENT_LINE_STEP_NORMAL;
      for (const line of lines) {
        drawText(ctx, line, {
          x: leftX,
          y: y - CONTENT_ITEM_Y_OFFSET,
          size: itemFontSize,
          color: '#4ade80',
          align: 'center',
          width: maxW,
        });
        y += lineStep;
      }
      return;
    }

    // Count distinct reward lines so we can shrink text when there are 3+
    const potionCount = this.contents.potions ?? 0;
    const itemCount =
      (potionCount > 0 ? 1 : 0) + (this.contents.coins > 0 ? 1 : 0) + (this.contents.bonus ? 1 : 0);
    const itemFontSize =
      itemCount >= CONTENT_FONT_SMALL_THRESHOLD ? CONTENT_FONT_SMALL : CONTENT_FONT_NORMAL;
    const lineStep =
      itemFontSize <= CONTENT_FONT_SMALL ? CONTENT_LINE_STEP_SMALL : CONTENT_LINE_STEP_NORMAL;

    if (potionCount > 0) {
      drawText(ctx, `+${potionCount} Health Potion${potionCount !== 1 ? 's' : ''}`, {
        x: leftX,
        y: y - CONTENT_ITEM_Y_OFFSET,
        size: itemFontSize,
        color: '#4ade80',
        align: 'center',
        width: maxW,
      });
      y += lineStep;
    }
    if (this.contents.coins > 0) {
      drawText(ctx, `+${this.contents.coins} Coins`, {
        x: leftX,
        y: y - CONTENT_ITEM_Y_OFFSET,
        size: itemFontSize,
        color: '#fbbf24',
        align: 'center',
        width: maxW,
      });
      y += lineStep;
    }
    if (this.contents.bonus) {
      const name = this.contents.bonus.id.replace(/_/g, ' ');
      const bonusRecipient = this.playerName !== 'Human' ? ' → Human' : '';
      drawText(ctx, `+${this.contents.bonus.quantity} ${name}${bonusRecipient}`, {
        x: leftX,
        y: y - CONTENT_ITEM_Y_OFFSET,
        size: itemFontSize,
        color: '#fb923c',
        align: 'center',
        width: maxW,
      });
    }
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
}
