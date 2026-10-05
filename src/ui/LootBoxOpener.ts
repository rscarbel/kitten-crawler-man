import type { LootBox, BoxContents } from '../core/AchievementManager';
import { ITEM_DEF, isItemId, type ItemId } from '../core/ItemDefs';
import { randomFromArray, randomInt } from '../utils';
import { inset, type Rect } from './core/geom';
import type { Ui } from './core/UiRoot';
import {
  chromeTheme,
  drawBar,
  drawItemFrame,
  drawRule,
  lootTierColor,
} from './screens/dialogs/canvasChrome';
import { withAlpha } from './theme/color';
import { drawGlyph } from './theme/glyphs';
import { skinsFor } from './theme/skins';
import type { Theme } from './theme/tokens';
import { drawGlass, fillRounded, strokeRounded, type PaintTarget } from './widgets/paint';
import { measureText, text } from './widgets/text';
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

/** The confetti and sparks: every rarity colour plus the accent and the bright states. */
function particleColors(theme: Theme): string[] {
  const { palette } = theme;
  return [
    ...Object.values(palette.tier),
    palette.accent.base,
    palette.accent.hover,
    palette.state.success,
    palette.state.danger,
    palette.state.info,
    palette.text.primary,
  ];
}

/** One line of what a box paid out, with the item it pictures (`'coins'` for coins, `null` for none). */
interface RewardEntry {
  readonly text: string;
  readonly icon: ItemId | 'coins' | null;
  readonly color: string;
}

type Phase = 'shaking' | 'opening' | 'revealing' | 'done';

const BOX_W = 400;
const BOX_H = 390;
const SHAKE_FRAMES = 40;
const OPEN_FRAMES = 30;
const REVEAL_FRAMES = 50;
/** Frames to display the open box before auto-advancing to the next. */
const NEXT_DELAY = 180;

const PANEL_MARGIN = 32;

const SPARKLE_INTERVAL = 6;
const REVEAL_SPARKLE_INTERVAL = 4;

/**
 * How far the box art reaches above and below its centre, as multiples of its
 * size: the blown-off lid flies well above the box, the body sits just below.
 */
const ART_REACH_ABOVE = 1.2;
const ART_REACH_BELOW = 0.5;
/** Smallest the box art is drawn on a short screen, as a fraction of its full size. */
const MIN_ART_SCALE = 0.5;
/** Shortest a reward line gets; past this, lines that do not fit fold into a "+N more" line. */
const MIN_REWARD_ROW_STEP = 22;

const REVEAL_FADE_FRACTION = 0.6;

const COUNTDOWN_BAR_MARGIN = 24;
const COUNTDOWN_BAR_Y_FROM_BOTTOM = 18;
const COUNTDOWN_BAR_H = 6;
const COUNTDOWN_BAR_ALPHA = 0.7;

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

const HEADER_TITLE_X_MARGIN = 16;
const HEADER_DIVIDER_SIDE_PAD = 24;
/** Top of the box's title, below the "Box n of N" counter. */
const HEADER_TITLE_TOP = 22;
const PANEL_GLOW_ALPHA = 0.55;
const PANEL_GLOW_BLUR = 28;
const PANEL_EDGE_ALPHA = 0.7;
const PANEL_EDGE_WIDTH = 1.5;
const RIBBON_ALPHA = 0.8;
/** Height a reward line takes when there is room; tighter lists shrink to fit. */
const REWARD_ROW_STEP = 28;
/** Vertical space between one reward line's icon and the next. */
const REWARD_ROW_GAP = 4;
const COIN_GLYPH_INSET_RATIO = 0.18;

const CONTENT_LEFT_PAD = 20;

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
/**
 * A line enters at full size and fades in under its overshoot, so text in
 * mid-pop is never drawn smaller than its own style.
 */
const REVEAL_POP_START_SCALE = 1;
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
  /** Where the box art was last drawn, which bursts fly out of; the screen's centre until then. */
  private artCenter: { x: number; y: number } | null = null;

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

  /** Draws the reveal over a `cw` × `ch` screen. */
  paint(target: PaintTarget & Pick<Ui, 'density'>, cw: number, ch: number): void {
    const box = this.box;
    if (!this.active || box === null) return;
    const { ctx, theme } = target;
    const { palette, type, space } = theme;
    const skins = skinsFor(theme);
    const boxW = Math.min(BOX_W, cw - PANEL_MARGIN);
    const boxH = Math.min(BOX_H, ch - PANEL_MARGIN);
    const bx = (cw - boxW) / 2;
    const by = (ch - boxH) / 2;
    const cx = cw / 2;

    ctx.fillStyle = skins.scrim;
    ctx.fillRect(0, 0, cw, ch);

    if (this.burstFlashFrames > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= (this.burstFlashFrames / BURST_FLASH_FRAMES) * BURST_FLASH_ALPHA;
      ctx.fillStyle = palette.text.primary;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.shakeX, this.shakeY);

    const tierColor = lootTierColor(theme, box.tier);
    const panel: Rect = { x: bx, y: by, w: boxW, h: boxH };
    ctx.save();
    ctx.shadowColor = withAlpha(tierColor, PANEL_GLOW_ALPHA);
    ctx.shadowBlur = PANEL_GLOW_BLUR;
    fillRounded(ctx, panel, theme.radius.lg, palette.surface.sunken);
    ctx.restore();
    drawGlass(target, panel, skins.panel.card);
    strokeRounded(
      ctx,
      panel,
      theme.radius.lg,
      withAlpha(tierColor, PANEL_EDGE_ALPHA),
      PANEL_EDGE_WIDTH,
    );

    const headerRow = (y: number, h: number): Rect => ({
      x: bx + HEADER_TITLE_X_MARGIN,
      y,
      w: boxW - HEADER_TITLE_X_MARGIN * 2,
      h,
    });
    const total = this.queue.length;
    const current = this.queueIndex + 1;
    text(target, headerRow(by + space.sm, type.caption.lineHeight), {
      text: `Box ${current} of ${total}`,
      role: 'muted',
      align: 'right',
      tabular: true,
    });
    text(target, headerRow(by + HEADER_TITLE_TOP, type.heading.lineHeight), {
      text: `${box.tier} ${box.category} Box`,
      style: type.heading,
      color: tierColor,
      align: 'center',
    });
    text(
      target,
      headerRow(by + HEADER_TITLE_TOP + type.heading.lineHeight, type.caption.lineHeight),
      { text: `for ${this.playerName}`, role: 'caption', align: 'center' },
    );
    const dividerFromTop =
      HEADER_TITLE_TOP + type.heading.lineHeight + type.caption.lineHeight + space.xs;
    drawRule(
      target,
      bx + HEADER_DIVIDER_SIDE_PAD,
      by + dividerFromTop,
      boxW - HEADER_DIVIDER_SIDE_PAD * 2,
      tierColor,
    );

    // Top to bottom: header, box art, reward list, skip hint. The list is
    // sized for its lines first and the art takes what is left, so a short
    // screen shrinks the art rather than piling the lines on top of each other.
    const plannedRows = this.rewardEntries(theme).length;
    const contentNeeds =
      type.label.lineHeight + space.xs + plannedRows * MIN_REWARD_ROW_STEP + space.xs;
    const artTop = by + dividerFromTop + space.sm;
    const barY = by + boxH - COUNTDOWN_BAR_Y_FROM_BOTTOM;
    const footerRowY = barY - space.xs - type.caption.lineHeight;
    const footerReserve = by + boxH - footerRowY + space.xs;
    const artRoom = boxH - dividerFromTop - space.sm * 2 - contentNeeds - footerReserve;
    const artSpan = BOX_ANIM_SIZE * (ART_REACH_ABOVE + ART_REACH_BELOW);
    const artScale = Math.max(MIN_ART_SCALE, Math.min(1, artRoom / artSpan));
    const artSize = BOX_ANIM_SIZE * artScale;
    const boxCenterY = artTop + artSize * ART_REACH_ABOVE;
    this.artCenter = { x: cx, y: boxCenterY };
    const contentTop = Math.round(boxCenterY + artSize * ART_REACH_BELOW + space.sm);
    // The burst lights up the art band and the screen around the panel, but
    // never the reward list or the header text.
    const artBand: Rect = {
      x: bx,
      y: artTop,
      w: boxW,
      h: contentTop - space.xs - artTop,
    };
    const clipToBurstArea = (): void => {
      ctx.beginPath();
      ctx.rect(-this.shakeX, -this.shakeY, cw, ch);
      ctx.rect(panel.x, panel.y, panel.w, panel.h);
      ctx.rect(artBand.x, artBand.y, artBand.w, artBand.h);
      ctx.clip('evenodd');
    };
    ctx.save();
    clipToBurstArea();
    if (this.phase === 'opening' || this.phase === 'revealing') {
      this.renderGodRays(ctx, cx, boxCenterY, tierColor);
    }
    if (this.phase === 'opening' && this.frame < SHOCKWAVE_FRAMES) {
      this.renderShockwave(ctx, cx, boxCenterY, tierColor);
    }
    ctx.restore();
    this.drawAnimatedBox(ctx, cx, boxCenterY, artSize, tierColor, palette.text.primary);

    if (this.phase === 'revealing' || this.phase === 'done') {
      const revealAlpha =
        this.phase === 'done'
          ? 1
          : Math.min(1, this.frame / (REVEAL_FRAMES * REVEAL_FADE_FRACTION));
      ctx.save();
      ctx.globalAlpha *= revealAlpha;
      this.renderContents(target, {
        x: bx + CONTENT_LEFT_PAD,
        y: contentTop,
        w: boxW - CONTENT_LEFT_PAD * 2,
        h: footerRowY - space.xs - contentTop,
      });
      ctx.restore();
    }

    const counting = this.phase === 'done' && this.nextTimer > 0;
    const footerRow = headerRow(footerRowY, type.caption.lineHeight);
    text(target, footerRow, {
      text: footerHint(target.density, this.phase === 'done'),
      role: 'muted',
      align: counting ? 'left' : 'center',
    });

    if (counting) {
      const ratio = this.nextTimer / NEXT_DELAY;
      ctx.save();
      ctx.globalAlpha *= COUNTDOWN_BAR_ALPHA;
      drawBar(
        target,
        {
          x: bx + COUNTDOWN_BAR_MARGIN,
          y: barY,
          w: boxW - COUNTDOWN_BAR_MARGIN * 2,
          h: COUNTDOWN_BAR_H,
        },
        { value: ratio, fill: tierColor },
      );
      ctx.restore();

      const isLast = this.queueIndex >= this.queue.length - 1;
      text(target, footerRow, {
        text: isLast ? 'Done!' : 'Next box…',
        role: 'muted',
        align: 'right',
      });
    }

    ctx.save();
    clipToBurstArea();
    for (const p of this.particles) {
      const ratio = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha *= ratio;
      ctx.fillStyle = p.color;
      if (p.shape === 'confetti') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        const size = p.radius * ratio;
        ctx.fillRect(-size / 2, -size / 2, size, size * CONFETTI_ASPECT);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * ratio, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();

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
    this.artCenter = null;
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
    // Particles are drawn onto the canvas, so they spawn in the space the box
    // is laid out in: at the box art, or a spot the caller hands over (a
    // reward card popping in). Before the box has been drawn there is nowhere
    // for them to come from.
    const from = origin ?? this.artCenter;
    if (from === null) return;
    const cx = from.x;
    const cy = from.y;
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
      color: randomFromArray(particleColors(chromeTheme())),
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
    size: number,
    color: string,
    light: string,
  ): void {
    const artScale = size / BOX_ANIM_SIZE;
    const lidPad = BOX_LID_PAD * artScale;
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
      const lidLift = t * BOX_LID_FLING_DISTANCE * artScale;
      ctx.save();
      ctx.translate(bx + size / 2, by + size * BOX_BODY_Y_FRAC - lidLift);
      ctx.rotate(lidAngle);
      ctx.fillStyle = color;
      const LID_FILL_ALPHA = 0.25;
      ctx.globalAlpha = LID_FILL_ALPHA;
      ctx.fillRect(
        -size / 2 - lidPad,
        -size * BOX_LID_HEIGHT_FRAC,
        size + lidPad * 2,
        size * BOX_LID_HEIGHT_FRAC,
      );
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      const BOX_LID_LINE_W = 2;
      ctx.lineWidth = BOX_LID_LINE_W;
      ctx.strokeRect(
        -size / 2 - lidPad,
        -size * BOX_LID_HEIGHT_FRAC,
        size + lidPad * 2,
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
      ctx.fillRect(bx - lidPad, by, size + lidPad * 2, size * BOX_SHAKE_FILL_Y_FRAC);
      ctx.globalAlpha = 1;
      ctx.strokeRect(bx - lidPad, by, size + lidPad * 2, size * BOX_SHAKE_FILL_Y_FRAC);

      // Light leaking from the lid seam, brightening with the shake — the
      // anticipation that something is about to force its way out.
      const seamY = by + size * BOX_SHAKE_FILL_Y_FRAC;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = SEAM_LEAK_ALPHA * shakeCrescendo;
      ctx.fillStyle = light;
      ctx.fillRect(
        bx - lidPad,
        seamY - (size * SEAM_LEAK_HEIGHT_FRAC) / 2,
        size + lidPad * 2,
        size * SEAM_LEAK_HEIGHT_FRAC,
      );
      ctx.restore();
    }

    ctx.strokeStyle = withAlpha(color, RIBBON_ALPHA);
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

  /** What the current box paid out, one entry per reward line. */
  private rewardEntries(theme: Theme): RewardEntry[] {
    const contents = this.contents;
    if (contents === null) return [];
    const { palette } = theme;
    if (contents.displayLines !== undefined) {
      return contents.displayLines.map((line) => ({
        text: line,
        icon: null,
        color: palette.state.success,
      }));
    }
    const entries: RewardEntry[] = [];
    const potionCount = contents.potions ?? 0;
    if (potionCount > 0) {
      entries.push({
        text: `+${potionCount} Health Potion${potionCount !== 1 ? 's' : ''}`,
        icon: 'health_potion',
        color: palette.state.success,
      });
    }
    if (contents.coins > 0) {
      entries.push({ text: `+${contents.coins} Coins`, icon: 'coins', color: palette.accent.base });
    }
    if (contents.bonus) {
      const bonusId = contents.bonus.id;
      const known = isItemId(bonusId);
      const name = known ? ITEM_DEF[bonusId].name : bonusId.replace(/_/g, ' ');
      // The shared tier/category bonus always goes to the human, regardless of
      // which player's box granted it.
      const bonusRecipient = this.playerName !== 'Human' ? ' → Human' : '';
      entries.push({
        text: `+${contents.bonus.quantity} ${name}${bonusRecipient}`,
        icon: known ? bonusId : null,
        color: palette.text.primary,
      });
    }
    for (const { id, quantity } of contents.itemRewards ?? []) {
      entries.push({
        text: `+${quantity} ${ITEM_DEF[id].name}`,
        icon: id,
        color: palette.text.primary,
      });
    }
    return entries;
  }

  /**
   * The "received" heading and the reward lines, laid into `area`. Lines keep
   * a readable height; any that do not fit fold into one "+N more" line.
   */
  private renderContents(target: PaintTarget, area: Rect): void {
    if (!this.contents) return;
    const { type } = target.theme;
    text(
      target,
      { x: area.x, y: area.y, w: area.w, h: type.label.lineHeight },
      { text: `${this.playerName} received:`, role: 'label', align: 'center' },
    );
    const entries = this.rewardEntries(target.theme);
    if (entries.length === 0) return;
    const rowsTop = area.y + type.label.lineHeight + target.theme.space.xs;
    const rowsHeight = Math.max(0, area.y + area.h - rowsTop);
    const rowStep = Math.min(
      REWARD_ROW_STEP,
      Math.max(MIN_REWARD_ROW_STEP, rowsHeight / entries.length),
    );
    const rowsThatFit = Math.max(1, Math.floor(rowsHeight / rowStep));
    const shown =
      entries.length <= rowsThatFit ? entries : foldOverflow(entries, rowsThatFit, target.theme);
    shown.forEach((entry, lineIndex) => {
      this.drawPoppingLine(
        target,
        entry,
        { x: area.x, y: rowsTop + lineIndex * rowStep, w: area.w, h: rowStep },
        lineIndex,
      );
    });
  }

  /**
   * One reward line, popping in with an overshoot scale bounce staggered by
   * `lineIndex` — rarer boxes call this with more lines and bigger bursts
   * around it, which is what makes a Celestial box feel heavier than a Bronze
   * one without this function needing to know about tiers at all.
   */
  private drawPoppingLine(
    target: PaintTarget,
    entry: RewardEntry,
    row: Rect,
    lineIndex: number,
  ): void {
    const scale = this.phase === 'revealing' ? this.revealPopScale(lineIndex) : 1;
    if (scale <= 0) return;
    const { ctx, theme } = target;
    const iconSize = row.h - REWARD_ROW_GAP;
    const textStyle = row.h < REWARD_ROW_STEP ? theme.type.caption : theme.type.body;
    const hasIcon = entry.icon !== null;
    const iconSpan = hasIcon ? iconSize + theme.space.sm : 0;
    const textWidth = Math.min(
      row.w - iconSpan,
      measureText(target, entry.text, { style: textStyle }),
    );
    const left = row.x + (row.w - iconSpan - textWidth) / 2;
    const pivotX = row.x + row.w / 2;
    const pivotY = row.y + row.h / 2;
    if (this.phase === 'revealing' && !this.sparkledLineIndices.has(lineIndex)) {
      const local = this.frame - lineIndex * REVEAL_LINE_STAGGER_FRAMES;
      if (local > 0) {
        this.sparkledLineIndices.add(lineIndex);
        this.burstParticles(CARD_SPARKLE_COUNT, { x: pivotX, y: pivotY });
        this.playCardStinger();
      }
    }
    ctx.save();
    if (this.phase === 'revealing') ctx.globalAlpha *= this.revealPopAlpha(lineIndex);
    ctx.translate(pivotX, pivotY);
    ctx.scale(scale, scale);
    ctx.translate(-pivotX, -pivotY);
    if (entry.icon !== null) {
      const iconRect: Rect = { x: left, y: pivotY - iconSize / 2, w: iconSize, h: iconSize };
      if (entry.icon === 'coins') this.drawCoinFrame(target, iconRect);
      else drawItemFrame(target, iconRect, entry.icon);
    }
    text(
      target,
      { x: left + iconSpan, y: row.y, w: textWidth, h: row.h },
      { text: entry.text, style: textStyle, color: entry.color },
    );
    ctx.restore();
  }

  /** Coins have no item of their own, so their line wears the coin glyph in the same frame. */
  private drawCoinFrame(target: PaintTarget, rect: Rect): void {
    const { ctx, theme } = target;
    const { palette, radius } = theme;
    fillRounded(ctx, rect, radius.sm, palette.surface.sunken);
    drawGlyph(ctx, 'coin', inset(rect, rect.w * COIN_GLYPH_INSET_RATIO), {
      color: palette.accent.base,
    });
    strokeRounded(ctx, rect, radius.sm, palette.border.subtle, PANEL_EDGE_WIDTH);
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

  /** Fade-in for the `lineIndex`-th reveal line, complete at the top of its overshoot. */
  private revealPopAlpha(lineIndex: number): number {
    const local = this.frame - lineIndex * REVEAL_LINE_STAGGER_FRAMES;
    const half = REVEAL_POP_FRAMES / 2;
    return Math.min(1, Math.max(0, local / half));
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
}

function footerHint(density: Ui['density'], waitingToContinue: boolean): string {
  const verb = density === 'touch' ? 'Tap' : 'Click';
  return `${verb} to ${waitingToContinue ? 'continue' : 'skip'}`;
}

/** The first lines that fit, the last slot given to a count of the rest. */
function foldOverflow(entries: RewardEntry[], rows: number, theme: Theme): RewardEntry[] {
  const kept = entries.slice(0, rows - 1);
  const hidden = entries.length - kept.length;
  return [...kept, { text: `+${hidden} more`, icon: null, color: theme.palette.text.secondary }];
}
