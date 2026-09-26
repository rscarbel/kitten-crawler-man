import type { LootBox, BoxContents } from '../core/AchievementManager';
import { ITEM_DEF, isItemId } from '../core/ItemDefs';
import { randomFromArray, randomInt } from '../utils';
import { drawText } from './TextBox';
import { drawOverlay, drawBox, drawDivider, drawProgressBar } from './Box';
import { suppressMenuFocus } from './Button';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import type { AudioManager } from '../audio/AudioManager';

type ParticleShape = 'circle' | 'confetti';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
  shape: ParticleShape;
  /** Current facing, in radians. Confetti only — circles look the same at any angle. */
  spin: number;
  /** Radians added to `spin` per tick. */
  spinRate: number;
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

const PANEL_MARGIN = 32;

const SPARKLE_INTERVAL = 6;
const REVEAL_SPARKLE_INTERVAL = 4;

const CONTENT_Y_OFFSET_FRACTION = 0.633;

const REVEAL_FADE_FRACTION = 0.6;

const SKIP_HINT_BOTTOM_OFFSET = 52;

const COUNTDOWN_BAR_MARGIN = 24;
const COUNTDOWN_BAR_SIDE_PAD = 48;
const COUNTDOWN_BAR_Y_FROM_BOTTOM = 18;
const COUNTDOWN_BAR_H = 6;
const COUNTDOWN_BAR_ALPHA = 0.7;

const COUNTDOWN_LABEL_Y_ABOVE_BAR = 4;
const COUNTDOWN_LABEL_CORRECTION = 8;

const BOX_ANIM_SIZE = 56;
const BOX_SHAKE_AMPLITUDE_FRAMES = 1.8;
const BOX_SHAKE_COS_FREQ = 2.1;
const BOX_SHAKE_COS_AMP = 2;
const BOX_LID_ANGLE = -0.9;
/** Extra rotation past `BOX_LID_ANGLE`, so the lid overshoots into a blown-off pose rather than settling gently. */
const BOX_LID_SPIN_EXTRA = -0.6;
/** How far the lid lifts as it blows off, in px at the box's own small scale. */
const BOX_LID_FLING_DISTANCE = 10;
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

const CONTENT_LINE_STEP_SMALL = 14;
const CONTENT_LINE_STEP_NORMAL = 16;
const CONTENT_FONT_SMALL = 10;
const CONTENT_FONT_NORMAL = 12;
const CONTENT_FONT_SMALL_THRESHOLD = 3;
const CONTENT_RECEIVED_Y_OFFSET = 10;
const CONTENT_RECEIVED_SIZE = 13;
const CONTENT_ITEM_Y_OFFSET = 10;
const CONTENT_ADVANCE_Y = 18;

const CONTENT_LEFT_PAD = 20;
const CONTENT_WIDTH_REDUCTION = 40;

// Particle spread — centering the random range around zero
const PARTICLE_CENTER_OFFSET = 0.5;

const BURST_COUNT_OPEN = 60;
const BURST_COUNT_REVEAL = 90;
/** Share of a burst that flies as confetti rectangles rather than round sparks. */
const CONFETTI_SHARE = 0.4;
const CONFETTI_SIZE_BASE = 3;
const CONFETTI_SIZE_RANGE = 4;
const CONFETTI_SPIN_RANGE = 0.3;
/** Confetti rectangles are taller than they are wide, so a spin reads as a tumbling ribbon. */
const CONFETTI_ASPECT = 2.2;

const HEADER_PROGRESS_Y_CORRECTION = 9;

/** Ascending rarity order for sorting boxes (lowest first). */
const TIER_ORDER: Record<string, number> = {
  Bronze: 0,
  Silver: 1,
  Gold: 2,
  Legendary: 3,
  Celestial: 4,
};

/**
 * How much bigger a burst reads for a rarer tier: 1x for Bronze up to
 * roughly 3x for Celestial. Every burst-scaled effect below reads this once.
 */
function tierIntensity(tier: string): number {
  const TIER_INTENSITY_STEP = 0.5;
  const BASE_INTENSITY = 1;
  return BASE_INTENSITY + (TIER_ORDER[tier] ?? 0) * TIER_INTENSITY_STEP;
}

// Anticipation: the shake crescendos and the lid seams start leaking light.
const SHAKE_CRESCENDO_MIN_SHARE = 0.25;
const SEAM_LEAK_ALPHA = 0.55;
const SEAM_LEAK_HEIGHT_FRAC = 0.05;
/** Volume of the rising hum played once as the shake begins. */
const SHAKE_HUM_VOLUME = 0.4;

// Burst: full-screen flash, screen shake, rotating god rays, shockwave ring.
const BURST_FLASH_FRAMES = 10;
const BURST_FLASH_ALPHA = 0.85;
const BURST_SHAKE_FRAMES = 14;
const BURST_SHAKE_MAGNITUDE_PX = 6;
const GOD_RAY_COUNT = 8;
const GOD_RAY_SPIN_PER_FRAME = 0.012;
const GOD_RAY_LENGTH = 220;
const GOD_RAY_HALF_ANGLE = 0.09;
const GOD_RAY_ALPHA = 0.16;
const SHOCKWAVE_FRAMES = 22;
const SHOCKWAVE_MAX_RADIUS = 170;
const SHOCKWAVE_LINE_WIDTH = 4;
const SHOCKWAVE_ALPHA = 0.55;

// Reveal: each reward line pops in with an overshoot scale bounce.
const REVEAL_LINE_STAGGER_FRAMES = 6;
const REVEAL_POP_FRAMES = 14;
const REVEAL_POP_START_SCALE = 0.2;
const REVEAL_POP_OVERSHOOT_SCALE = 1.25;
/** Sparkle particles fired at a card's own position the instant it starts popping in. */
const CARD_SPARKLE_COUNT = 10;
// One recording serves every tier: a rarer box plays it lower and louder.
const CARD_STINGER_BASE_VOLUME = 0.35;
const CARD_STINGER_VOLUME_PER_INTENSITY = 0.2;
const CARD_STINGER_MAX_VOLUME = 1;
const CARD_STINGER_RATE_DROP_PER_INTENSITY = 0.1;

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
  private getContents: ((box: LootBox) => BoxContents) | null = null;

  private onBoxOpened: ((box: LootBox, contents: BoxContents) => void) | null = null;
  private onAllDone: (() => void) | null = null;
  private onEachBoxOpening: (() => void) | null = null;

  private audio: AudioManager | null = null;
  /** Countdown driving the full-screen flash at the moment the lid blows off. */
  private burstFlashFrames = 0;
  /** Countdown driving the brief screen shake that rides along with the burst. */
  private burstShakeFrames = 0;
  private shakeX = 0;
  private shakeY = 0;
  /** Reward lines that have already fired their pop-in sparkle burst, so a re-render of the same frame can't double it up. */
  private sparkledLineIndices = new Set<number>();

  /** Lets the owner wire a rising hum into the anticipation phase. */
  setAudio(audio: AudioManager | null): void {
    this.audio = audio;
  }

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
   * @param getContents   Resolves what a box holds. Supplied by the caller so a
   *                      box can carry rewards the shared tier/category table
   *                      knows nothing about.
   * @param onBoxOpened   Called once per box when its reveal finishes.
   *                      Caller should grant rewards and remove the box from
   *                      the AchievementManager at this point.
   * @param onAllDone     Called after every box has been opened.
   */
  startQueue(
    boxes: LootBox[],
    playerName: string,
    getContents: (box: LootBox) => BoxContents,
    onBoxOpened: (box: LootBox, contents: BoxContents) => void,
    onAllDone: () => void,
    onEachBoxOpening?: () => void,
  ): void {
    if (boxes.length === 0) return;
    this.getContents = getContents;
    this.queue = [...boxes].sort((a, b) => (TIER_ORDER[a.tier] ?? 0) - (TIER_ORDER[b.tier] ?? 0));
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

    if (this.phase === 'done') {
      if (this.nextTimer > 0) {
        this.nextTimer--;
        if (this.nextTimer === 0) this.advance();
      }
      if (this.frame % SPARKLE_INTERVAL === 0) this.spawnParticle();
    }

    const intensity = tierIntensity(this.box.tier);

    switch (this.phase) {
      case 'shaking':
        if (this.frame >= SHAKE_FRAMES) {
          this.phase = 'opening';
          this.frame = 0;
          this.burstFlashFrames = BURST_FLASH_FRAMES;
          this.burstShakeFrames = BURST_SHAKE_FRAMES;
          this.audio?.play('loot_box_lid_burst');
          this.burstParticles(Math.round(BURST_COUNT_OPEN * intensity));
          this.onEachBoxOpening?.();
          if (!this.rewardGranted && this.onBoxOpened && this.contents) {
            this.rewardGranted = true;
            this.onBoxOpened(this.box, this.contents);
          }
        }
        break;
      case 'opening':
        if (this.frame >= OPEN_FRAMES) {
          this.phase = 'revealing';
          this.frame = 0;
          this.burstParticles(Math.round(BURST_COUNT_REVEAL * intensity));
        }
        break;
      case 'revealing':
        if (this.frame % REVEAL_SPARKLE_INTERVAL === 0) this.spawnParticle();
        if (this.frame >= REVEAL_FRAMES) {
          this.phase = 'done';
          this.frame = 0;
          this.nextTimer = NEXT_DELAY;
        }
        break;
      case 'done':
        break;
    }

    if (this.burstFlashFrames > 0) this.burstFlashFrames--;
    if (this.burstShakeFrames > 0) {
      this.burstShakeFrames--;
      const shakeFalloff = this.burstShakeFrames / BURST_SHAKE_FRAMES;
      this.shakeX =
        (Math.random() - PARTICLE_CENTER_OFFSET) * 2 * BURST_SHAKE_MAGNITUDE_PX * shakeFalloff;
      this.shakeY =
        (Math.random() - PARTICLE_CENTER_OFFSET) * 2 * BURST_SHAKE_MAGNITUDE_PX * shakeFalloff;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += PARTICLE_GRAVITY;
      p.spin += p.spinRate;
      p.life--;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.active || !this.box) return;
    // Owns the screen with nothing to focus, and is opened from the pause menu —
    // without this the menu underneath would keep the live ring.
    suppressMenuFocus('loot-box');

    const cw = viewportWidth();
    const ch = viewportHeight();
    const boxW = Math.min(BOX_W, cw - PANEL_MARGIN);
    const boxH = Math.min(BOX_H, ch - PANEL_MARGIN);
    const bx = (cw - boxW) / 2;
    const by = (ch - boxH) / 2;
    const cx = cw / 2;

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: 0.7 });

    if (this.burstFlashFrames > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawOverlay(ctx, {
        canvasWidth: cw,
        canvasHeight: ch,
        color: '#ffffff',
        alpha: (this.burstFlashFrames / BURST_FLASH_FRAMES) * BURST_FLASH_ALPHA,
      });
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.shakeX, this.shakeY);

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

    drawText(ctx, `for ${this.playerName}`, {
      x: cx,
      y: by + HEADER_PLAYER_Y_FROM_TOP - HEADER_PLAYER_Y_CORRECTION,
      size: HEADER_PLAYER_SIZE,
      color: '#94a3b8',
      align: 'center',
    });

    drawDivider(ctx, {
      x: bx + HEADER_DIVIDER_SIDE_PAD,
      y: by + HEADER_DIVIDER_Y_FROM_TOP,
      length: boxW - COUNTDOWN_BAR_SIDE_PAD,
      color: `${tierColor}55`,
    });

    const boxCenterY = by + boxH / 2 - HEADER_TITLE_FONT_CORRECTION;
    if (this.phase === 'opening' || this.phase === 'revealing') {
      this.renderGodRays(ctx, cx, boxCenterY, tierColor);
    }
    if (this.phase === 'opening' && this.frame < SHOCKWAVE_FRAMES) {
      this.renderShockwave(ctx, cx, boxCenterY, tierColor);
    }
    this.drawAnimatedBox(ctx, cx, boxCenterY, tierColor);

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

      const isLast = this.queueIndex >= this.queue.length - 1;
      drawText(ctx, isLast ? 'Done!' : 'Next box…', {
        x: cx,
        y: barY - COUNTDOWN_LABEL_Y_ABOVE_BAR - COUNTDOWN_LABEL_CORRECTION,
        size: HEADER_PLAYER_SIZE,
        color: '#64748b',
        align: 'center',
      });
    }

    for (const p of this.particles) {
      const ratio = p.life / p.maxLife;
      ctx.globalAlpha = ratio;
      ctx.fillStyle = p.color;
      if (p.shape === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        const size = p.radius * ratio;
        ctx.fillRect(-size / 2, -size / 2, size, size * CONFETTI_ASPECT);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * ratio, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  /** Additive rotating shafts of light behind the box, brightening the burst and reveal. */
  private renderGodRays(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    color: string,
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.frame * GOD_RAY_SPIN_PER_FRAME);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = GOD_RAY_ALPHA;
    ctx.fillStyle = color;
    for (let i = 0; i < GOD_RAY_COUNT; i++) {
      const angle = (i / GOD_RAY_COUNT) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(
        Math.cos(angle - GOD_RAY_HALF_ANGLE) * GOD_RAY_LENGTH,
        Math.sin(angle - GOD_RAY_HALF_ANGLE) * GOD_RAY_LENGTH,
      );
      ctx.lineTo(
        Math.cos(angle + GOD_RAY_HALF_ANGLE) * GOD_RAY_LENGTH,
        Math.sin(angle + GOD_RAY_HALF_ANGLE) * GOD_RAY_LENGTH,
      );
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** A single expanding ring at the instant the lid blows off, in the box's own tier colour. */
  private renderShockwave(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    color: string,
  ): void {
    const t = this.frame / SHOCKWAVE_FRAMES;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = SHOCKWAVE_ALPHA * (1 - t);
    ctx.strokeStyle = color;
    ctx.lineWidth = SHOCKWAVE_LINE_WIDTH;
    ctx.beginPath();
    ctx.arc(cx, cy, SHOCKWAVE_MAX_RADIUS * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private loadCurrent(): void {
    this.box = this.queue[this.queueIndex];
    this.contents = this.getContents?.(this.box) ?? null;
    this.phase = 'shaking';
    this.frame = 0;
    this.nextTimer = 0;
    this.particles = [];
    this.rewardGranted = false;
    this.burstFlashFrames = 0;
    this.burstShakeFrames = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.sparkledLineIndices = new Set();
    this.audio?.play('rumble', { volume: SHAKE_HUM_VOLUME });
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

  private burstParticles(count: number, origin?: { x: number; y: number }): void {
    for (let i = 0; i < count; i++) this.spawnParticle(true, origin);
  }

  private spawnParticle(burst = false, origin?: { x: number; y: number }): void {
    // Particles are drawn onto the canvas, so they spawn in the CSS-pixel
    // viewport the box is laid out in, not in window coordinates — unless a
    // caller hands over a specific spot (a reward card popping in).
    const cx = origin?.x ?? viewportWidth() / 2;
    const cy = origin?.y ?? viewportHeight() / 2;
    const angle = Math.random() * Math.PI * 2;
    const speed = burst
      ? PARTICLE_BURST_SPEED_BASE + Math.random() * PARTICLE_BURST_SPEED_RANGE
      : PARTICLE_IDLE_SPEED_BASE + Math.random() * PARTICLE_IDLE_SPEED_RANGE;
    const isConfetti = burst && Math.random() < CONFETTI_SHARE;
    this.particles.push({
      x: cx + (Math.random() - PARTICLE_CENTER_OFFSET) * PARTICLE_BURST_SPREAD_X,
      y: cy + (Math.random() - PARTICLE_CENTER_OFFSET) * PARTICLE_BURST_SPREAD_X,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (burst ? PARTICLE_BURST_LIFT : 0),
      radius: isConfetti
        ? CONFETTI_SIZE_BASE + Math.random() * CONFETTI_SIZE_RANGE
        : PARTICLE_RADIUS_BASE + Math.random() * PARTICLE_RADIUS_RANGE,
      color: randomFromArray(PARTICLE_COLORS),
      life: randomInt(PARTICLE_LIFE_MIN, PARTICLE_LIFE_MAX),
      maxLife: PARTICLE_MAX_LIFE,
      shape: isConfetti ? 'confetti' : 'circle',
      spin: Math.random() * Math.PI * 2,
      spinRate: (Math.random() - PARTICLE_CENTER_OFFSET) * 2 * CONFETTI_SPIN_RANGE,
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
    // Grows from a fraction of full strength up to full strength, so the shake
    // reads as building tension rather than starting at its final intensity.
    let shakeCrescendo = 0;
    if (this.phase === 'shaking') {
      const t = this.frame / SHAKE_FRAMES;
      shakeCrescendo = SHAKE_CRESCENDO_MIN_SHARE + (1 - SHAKE_CRESCENDO_MIN_SHARE) * t;
      const intensity =
        Math.sin(this.frame * BOX_SHAKE_AMPLITUDE_FRAMES) * PARTICLE_BURST_LIFT * shakeCrescendo;
      shakeX = intensity;
      shakeY = Math.cos(this.frame * BOX_SHAKE_COS_FREQ) * BOX_SHAKE_COS_AMP * shakeCrescendo;
    }

    const bx = cx - size / 2 + shakeX;
    const by = cy - size / 2 + shakeY;

    if (this.phase === 'opening' || this.phase === 'revealing' || this.phase === 'done') {
      const t = this.phase === 'opening' ? Math.min(1, this.frame / OPEN_FRAMES) : 1;
      // The lid overshoots its resting angle and lifts as it blows off, rather
      // than simply rotating open, so the burst reads as an impact.
      const lidAngle = t * (BOX_LID_ANGLE + BOX_LID_SPIN_EXTRA);
      const lidLift = t * BOX_LID_FLING_DISTANCE;
      ctx.save();
      ctx.translate(bx + size / 2, by + size * BOX_BODY_Y_FRAC - lidLift);
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

      // Light leaking from the lid seam, brightening with the shake — the
      // anticipation that something is about to force its way out.
      const seamY = by + size * BOX_SHAKE_FILL_Y_FRAC;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = SEAM_LEAK_ALPHA * shakeCrescendo;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(
        bx - BOX_LID_PAD,
        seamY - (size * SEAM_LEAK_HEIGHT_FRAC) / 2,
        size + BOX_LID_PAD * 2,
        size * SEAM_LEAK_HEIGHT_FRAC,
      );
      ctx.restore();
    }

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

    let lineIndex = 0;

    if (this.contents.displayLines !== undefined) {
      const lines = this.contents.displayLines;
      const itemFontSize =
        lines.length >= CONTENT_FONT_SMALL_THRESHOLD ? CONTENT_FONT_SMALL : CONTENT_FONT_NORMAL;
      const lineStep =
        itemFontSize <= CONTENT_FONT_SMALL ? CONTENT_LINE_STEP_SMALL : CONTENT_LINE_STEP_NORMAL;
      for (const line of lines) {
        this.drawPoppingLine(
          ctx,
          line,
          leftX,
          y - CONTENT_ITEM_Y_OFFSET,
          itemFontSize,
          '#4ade80',
          maxW,
          lineIndex++,
        );
        y += lineStep;
      }
      return;
    }

    // Count distinct reward lines so we can shrink text when there are 3+
    const potionCount = this.contents.potions ?? 0;
    const itemCount =
      (potionCount > 0 ? 1 : 0) +
      (this.contents.coins > 0 ? 1 : 0) +
      (this.contents.bonus ? 1 : 0) +
      (this.contents.itemRewards?.length ?? 0);
    const itemFontSize =
      itemCount >= CONTENT_FONT_SMALL_THRESHOLD ? CONTENT_FONT_SMALL : CONTENT_FONT_NORMAL;
    const lineStep =
      itemFontSize <= CONTENT_FONT_SMALL ? CONTENT_LINE_STEP_SMALL : CONTENT_LINE_STEP_NORMAL;

    if (potionCount > 0) {
      this.drawPoppingLine(
        ctx,
        `+${potionCount} Health Potion${potionCount !== 1 ? 's' : ''}`,
        leftX,
        y - CONTENT_ITEM_Y_OFFSET,
        itemFontSize,
        '#4ade80',
        maxW,
        lineIndex++,
      );
      y += lineStep;
    }
    if (this.contents.coins > 0) {
      this.drawPoppingLine(
        ctx,
        `+${this.contents.coins} Coins`,
        leftX,
        y - CONTENT_ITEM_Y_OFFSET,
        itemFontSize,
        '#fbbf24',
        maxW,
        lineIndex++,
      );
      y += lineStep;
    }
    if (this.contents.bonus) {
      const bonusId = this.contents.bonus.id;
      const name = isItemId(bonusId) ? ITEM_DEF[bonusId].name : bonusId.replace(/_/g, ' ');
      // The shared tier/category bonus always goes to the human, regardless of
      // which player's box granted it.
      const bonusRecipient = this.playerName !== 'Human' ? ' → Human' : '';
      this.drawPoppingLine(
        ctx,
        `+${this.contents.bonus.quantity} ${name}${bonusRecipient}`,
        leftX,
        y - CONTENT_ITEM_Y_OFFSET,
        itemFontSize,
        '#fb923c',
        maxW,
        lineIndex++,
      );
      y += lineStep;
    }
    for (const { id, quantity } of this.contents.itemRewards ?? []) {
      this.drawPoppingLine(
        ctx,
        `+${quantity} ${ITEM_DEF[id].name}`,
        leftX,
        y - CONTENT_ITEM_Y_OFFSET,
        itemFontSize,
        '#fb923c',
        maxW,
        lineIndex++,
      );
      y += lineStep;
    }
  }

  /**
   * One reward line, popping in with an overshoot scale bounce staggered by
   * `lineIndex` — rarer boxes call this with more lines and bigger bursts
   * around it, which is what makes a Celestial box feel heavier than a Bronze
   * one without this function needing to know about tiers at all.
   */
  private drawPoppingLine(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    width: number,
    lineIndex: number,
  ): void {
    const scale = this.phase === 'revealing' ? this.revealPopScale(lineIndex) : 1;
    if (scale <= 0) return;
    // drawText's `align: 'center'` centres the glyphs at x + width/2, not at
    // x — pivoting the scale around x alone made every line slide sideways as
    // it popped in instead of growing in place.
    const pivotX = x + width / 2;
    if (this.phase === 'revealing' && !this.sparkledLineIndices.has(lineIndex)) {
      const local = this.frame - lineIndex * REVEAL_LINE_STAGGER_FRAMES;
      if (local > 0) {
        this.sparkledLineIndices.add(lineIndex);
        this.burstParticles(CARD_SPARKLE_COUNT, { x: pivotX, y });
        this.playCardStinger();
      }
    }
    ctx.save();
    ctx.translate(pivotX, y);
    ctx.scale(scale, scale);
    ctx.translate(-pivotX, -y);
    drawText(ctx, text, { x, y, size, color, align: 'center', width });
    ctx.restore();
  }

  private playCardStinger(): void {
    if (!this.box) return;
    const intensity = tierIntensity(this.box.tier);
    const volume = Math.min(
      CARD_STINGER_MAX_VOLUME,
      CARD_STINGER_BASE_VOLUME + intensity * CARD_STINGER_VOLUME_PER_INTENSITY,
    );
    const playbackRate = 1 - (intensity - 1) * CARD_STINGER_RATE_DROP_PER_INTENSITY;
    this.audio?.play('loot_box_tier_stinger', { volume, playbackRate });
  }

  /** Scale envelope for the `lineIndex`-th reveal line: 0 until its turn, an overshoot bounce, then settles at 1. */
  private revealPopScale(lineIndex: number): number {
    const local = this.frame - lineIndex * REVEAL_LINE_STAGGER_FRAMES;
    if (local <= 0) return 0;
    if (local >= REVEAL_POP_FRAMES) return 1;
    const half = REVEAL_POP_FRAMES / 2;
    if (local < half) {
      const t = local / half;
      return REVEAL_POP_START_SCALE + (REVEAL_POP_OVERSHOOT_SCALE - REVEAL_POP_START_SCALE) * t;
    }
    const t = (local - half) / half;
    return REVEAL_POP_OVERSHOOT_SCALE + (1 - REVEAL_POP_OVERSHOOT_SCALE) * t;
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
