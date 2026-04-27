import type { LootBox, BoxContents } from '../core/AchievementManager';
import { getBoxContents } from '../core/AchievementManager';
import { randomFromArray, randomInt } from '../utils';

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
      this.burstParticles(50);
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
  ): void {
    if (boxes.length === 0) return;
    this.queue = [...boxes].sort((a, b) => (TIER_ORDER[a.tier] ?? 0) - (TIER_ORDER[b.tier] ?? 0));
    this.queueIndex = 0;
    this.playerName = playerName;
    this.onBoxOpened = onBoxOpened;
    this.onAllDone = onAllDone;
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
      if (this.frame % 6 === 0) this.spawnParticle();
    }

    switch (this.phase) {
      case 'shaking':
        if (this.frame >= SHAKE_FRAMES) {
          this.phase = 'opening';
          this.frame = 0;
          this.burstParticles(30);
        }
        break;
      case 'opening':
        if (this.frame >= OPEN_FRAMES) {
          this.phase = 'revealing';
          this.frame = 0;
          this.burstParticles(50);
        }
        break;
      case 'revealing':
        if (this.frame % 4 === 0) this.spawnParticle();
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
    }

    // Animate particles
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.life--;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this.active || !this.box) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const bx = (cw - BOX_W) / 2;
    const by = (ch - BOX_H) / 2;
    const cx = cw / 2;

    // Backdrop
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;

    // Panel
    const tierColor = this.tierColor(this.box.tier);
    ctx.shadowColor = tierColor;
    ctx.shadowBlur = 28;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(bx, by, BOX_W, BOX_H);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = tierColor;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(bx, by, BOX_W, BOX_H);

    // Progress indicator (N of M)
    const total = this.queue.length;
    const current = this.queueIndex + 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`Box ${current} of ${total}`, bx + BOX_W - 12, by + 20);

    // Title
    ctx.fillStyle = tierColor;
    ctx.font = 'bold 17px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.box.tier} ${this.box.category} Box`, cx, by + 36);

    // Player label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText(`for ${this.playerName}`, cx, by + 52);

    // Divider
    ctx.strokeStyle = `${tierColor}55`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + 24, by + 62);
    ctx.lineTo(bx + BOX_W - 24, by + 62);
    ctx.stroke();

    // Draw the animated box graphic
    this.drawAnimatedBox(ctx, cx, ch / 2 - 16, tierColor);

    // Content reveal
    if (this.phase === 'revealing' || this.phase === 'done') {
      const revealAlpha =
        this.phase === 'done' ? 1 : Math.min(1, this.frame / (REVEAL_FRAMES * 0.6));
      ctx.globalAlpha = revealAlpha;
      this.renderContents(ctx, cx, by + 190);
      ctx.globalAlpha = 1;
    }

    // Skip hint
    ctx.fillStyle = '#475569';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      this.phase === 'done' ? 'Click to continue' : 'Click to skip',
      cx,
      by + BOX_H - 30,
    );

    // Auto-advance countdown bar (shown during 'done' phase)
    if (this.phase === 'done' && this.nextTimer > 0) {
      const ratio = this.nextTimer / NEXT_DELAY;
      const barW = BOX_W - 48;
      const barX = bx + 24;
      const barY = by + BOX_H - 18;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(barX, barY, barW, 6);
      ctx.fillStyle = tierColor;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(barX, barY, barW * ratio, 6);
      ctx.globalAlpha = 1;

      // "Next box…" or "Done!" label
      const isLast = this.queueIndex >= this.queue.length - 1;
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(isLast ? 'Done!' : 'Next box…', cx, barY - 4);
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

    ctx.textAlign = 'left';
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
    const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 400;
    const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 300;
    const angle = Math.random() * Math.PI * 2;
    const speed = burst ? 3 + Math.random() * 6 : 1 + Math.random() * 2;
    this.particles.push({
      x: cx + (Math.random() - 0.5) * 80,
      y: cy + (Math.random() - 0.5) * 80,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (burst ? 3 : 0),
      radius: 2 + Math.random() * 4,
      color: randomFromArray(PARTICLE_COLORS),
      life: randomInt(40, 79),
      maxLife: 80,
    });
  }

  private drawAnimatedBox(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    color: string,
  ): void {
    const size = 56;

    let shakeX = 0;
    let shakeY = 0;
    if (this.phase === 'shaking') {
      const t = this.frame / SHAKE_FRAMES;
      const intensity = Math.sin(this.frame * 1.8) * 5 * (1 - t * 0.5);
      shakeX = intensity;
      shakeY = Math.cos(this.frame * 2.1) * 2;
    }

    const bx = cx - size / 2 + shakeX;
    const by = cy - size / 2 + shakeY;

    if (this.phase === 'opening' || this.phase === 'revealing' || this.phase === 'done') {
      // Lid flying open
      const t = this.phase === 'opening' ? Math.min(1, this.frame / OPEN_FRAMES) : 1;
      const lidAngle = t * -0.9;
      ctx.save();
      ctx.translate(bx + size / 2, by + size * 0.15);
      ctx.rotate(lidAngle);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(-size / 2 - 4, -size * 0.18, size + 8, size * 0.18);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(-size / 2 - 4, -size * 0.18, size + 8, size * 0.18);
      ctx.restore();

      // Glow from inside
      {
        ctx.save();
        const glowAlpha =
          this.phase === 'opening' ? Math.min(1, this.frame / OPEN_FRAMES) * 0.6 : 0.6;
        ctx.globalAlpha = glowAlpha;
        ctx.shadowColor = color;
        ctx.shadowBlur = 30;
        ctx.fillStyle = color;
        ctx.fillRect(bx + 4, by + size * 0.2, size - 8, size * 0.6);
        ctx.restore();
      }
    }

    // Box body
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(bx, by + size * 0.15, size, size * 0.85);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(bx, by + size * 0.15, size, size * 0.85);

    if (this.phase === 'shaking') {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(bx - 4, by, size + 8, size * 0.18);
      ctx.globalAlpha = 1;
      ctx.strokeRect(bx - 4, by, size + 8, size * 0.18);
    }

    // Ribbon
    ctx.strokeStyle = `${color}cc`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, by + size * 0.15);
    ctx.lineTo(cx, by + size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx, cy);
    ctx.lineTo(bx + size, cy);
    ctx.stroke();
  }

  private renderContents(ctx: CanvasRenderingContext2D, cx: number, y: number): void {
    if (!this.contents) return;
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#f1f5f9';
    ctx.fillText(`${this.playerName} received:`, cx, y);
    y += 18;
    ctx.font = '12px monospace';
    ctx.fillStyle = '#4ade80';
    ctx.fillText(
      `+${this.contents.potions} Health Potion${this.contents.potions !== 1 ? 's' : ''}`,
      cx,
      y,
    );
    y += 16;
    if (this.contents.coins > 0) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`+${this.contents.coins} Coins`, cx, y);
      y += 16;
    }
    if (this.contents.bonus) {
      ctx.fillStyle = '#fb923c';
      const name = this.contents.bonus.id.replace(/_/g, ' ');
      const bonusRecipient = this.playerName !== 'Human' ? ' → Human' : '';
      ctx.fillText(`+${this.contents.bonus.quantity} ${name}${bonusRecipient}`, cx, y);
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
