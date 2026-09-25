import type { GameSystem, SystemContext } from './GameSystem';
import type { Player } from '../Player';
import type { Mob } from '../creatures/Mob';
import type { FloatingTextRequest, FloatingTextStyle } from '../core/FloatingText';
import { TILE_SIZE } from '../core/constants';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';

/** Frames a floating label stays on screen, rising and fading. */
export const FLOATING_LABEL_FRAMES = 55;
const LABEL_FRAMES = FLOATING_LABEL_FRAMES;
/** Tiles the label travels upward over its lifetime. */
const LABEL_RISE_TILES = 1.3;
/** Fraction of the lifetime spent fully opaque before the fade begins. */
const LABEL_HOLD_FRACTION = 0.45;
/** Half-width of the horizontal jitter that keeps stacked labels legible. */
const LABEL_JITTER_PX = 5;
/** Centres the jitter range on zero. */
const JITTER_CENTRE = 0.5;
/** Vertical gap between labels that spawn at the same origin in the same stretch of frames. */
const LABEL_STACK_OFFSET_PX = 14;
/** Origins round to this many pixels, so two labels over the same body always share a stack. */
const ORIGIN_GRID_PX = 4;

interface StyleDef {
  size: number;
  color: string;
  bold: boolean;
  /** Flanking glyph drawn on both sides of the word, in the label's own colour. */
  icon?: 'shield';
}

const STYLE_DEFS: Record<FloatingTextStyle, StyleDef> = {
  miss: { size: 11, color: '#cbd5e1', bold: true },
  buff: { size: 12, color: '#22d3ee', bold: true },
  trigger: { size: 16, color: '#f97316', bold: true },
  // Steel blue: a guard is a clang, and it must not be mistaken for the grey
  // of a crawler's own dodge happening in the same melee.
  block: { size: 12, color: '#60a5fa', bold: true },
  // Gold and larger than any hit label: a blow landed in a boss's punish
  // window, and it matches the halo she wears while that window is open.
  exposed: { size: 18, color: '#facc15', bold: true },
  // Ward blue/white and the biggest hit label of the lot: a mob wearing a
  // shield fairy's ward is not merely dodging, it cannot be touched at all,
  // and the flanking shields say why without the player having to notice the
  // ward's tether.
  immune: { size: 15, color: '#bfe3ff', bold: true, icon: 'shield' },
};

/** Gap between the word and each flanking icon, in pixels. */
const ICON_GAP_PX = 7;
/**
 * Flanking icon size, in pixels. Sized to read as a shield at the game's own
 * pixel density, not just at a zoomed-in review size — anything much smaller
 * than this collapses to an unreadable dot at 1x.
 */
const ICON_SIZE_PX = 16;

/** Where the shield's shoulders flare out to, as a fraction of its half-height above centre. */
const SHIELD_SHOULDER_FRACTION = 0.55;
/** Where the shield's sides start curving in to its point, as a fraction of its half-height below centre. */
const SHIELD_TAPER_FRACTION = 0.15;
/** Outline width as a fraction of the icon's size, so it scales with {@link ICON_SIZE_PX}. */
const SHIELD_OUTLINE_WIDTH_SHARE = 0.18;
/** The pale vertical spine painted down the shield's face, as a fraction of its half-width. */
const SHIELD_SPINE_HALF_WIDTH_SHARE = 0.12;

/**
 * Paints a small shield glyph centred on `(cx, cy)`, for a flanking icon. A
 * heavy dark outline and a pale spine down the middle are what keep the shape
 * reading as a shield rather than a blob at the size a floating label draws
 * it — both scale with `size`, so a bigger icon in a future style still
 * reads the same way.
 */
function drawShieldIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
  alpha: number,
): void {
  const halfW = size / 2;
  const halfH = size / 2;
  const shoulderY = cy - halfH * SHIELD_SHOULDER_FRACTION;
  const taperY = cy + halfH * SHIELD_TAPER_FRACTION;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(cx, cy - halfH);
  ctx.lineTo(cx + halfW, shoulderY);
  ctx.lineTo(cx + halfW, taperY);
  ctx.quadraticCurveTo(cx + halfW, cy + halfH, cx, cy + halfH);
  ctx.quadraticCurveTo(cx - halfW, cy + halfH, cx - halfW, taperY);
  ctx.lineTo(cx - halfW, shoulderY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = size * SHIELD_OUTLINE_WIDTH_SHARE;
  ctx.strokeStyle = 'rgba(8, 18, 38, 0.95)';
  ctx.stroke();

  const spineHalfWidth = halfW * SHIELD_SPINE_HALF_WIDTH_SHARE;
  ctx.beginPath();
  ctx.moveTo(cx - spineHalfWidth, cy - halfH);
  ctx.lineTo(cx + spineHalfWidth, cy - halfH);
  ctx.lineTo(cx + spineHalfWidth, cy + halfH);
  ctx.lineTo(cx - spineHalfWidth, cy + halfH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fill();
  ctx.restore();
}

interface FloatingLabel {
  worldX: number;
  worldY: number;
  text: string;
  style: FloatingTextStyle;
  framesLeft: number;
  /** Rounded spawn point, so labels sharing an origin can be told apart from ones that don't. */
  originKey: string;
}

/**
 * Rising, fading labels anchored to a world position.
 *
 * Players and mobs queue requests on themselves (`Player.queueFloatingText`)
 * because the code that raises one — `takeDamage`, a level-up, a mob guarding a
 * blow — has no scene in scope. This is purely cosmetic: gameplay signals ride
 * their own counters on `Player` and are drained by `SystemNoticeSystem`, which
 * unlike this exists in every scene.
 */
export class FloatingCombatTextSystem implements GameSystem {
  private readonly labels: FloatingLabel[] = [];
  /** Frames this system has aged its labels through; the clock throttled labels are timed on. */
  private frame = 0;
  /** Per body, the frame each throttled text was last shown over it. */
  private lastThrottledShown = new WeakMap<Player, Map<string, number>>();

  /** Add a label at a world position. Also usable directly by systems. */
  spawn(worldX: number, worldY: number, text: string, style: FloatingTextStyle): void {
    const jitter = (Math.random() - JITTER_CENTRE) * 2 * LABEL_JITTER_PX;
    const originKey = `${Math.round(worldX / ORIGIN_GRID_PX)},${Math.round(worldY / ORIGIN_GRID_PX)}`;
    const stackIndex = this.labels.reduce(
      (count, label) => (label.originKey === originKey ? count + 1 : count),
      0,
    );
    this.labels.push({
      worldX: worldX + jitter,
      worldY: worldY - stackIndex * LABEL_STACK_OFFSET_PX,
      text,
      style,
      framesLeft: LABEL_FRAMES,
      originKey,
    });
  }

  update(ctx: SystemContext): void {
    this.updateFor(ctx.human, ctx.cat, ctx.roster.mobs);
  }

  /**
   * Drain both crawlers and every mob, and age the live labels. Building
   * interiors without an encounter never build a `SystemContext`, but a
   * level-up still happens there.
   */
  updateFor(human: Player, cat: Player, mobs: readonly Mob[]): void {
    this.frame++;
    this.drainPlayer(human);
    this.drainPlayer(cat);
    for (const mob of mobs) this.drainPlayer(mob);

    let kept = 0;
    for (const label of this.labels) {
      label.framesLeft--;
      if (label.framesLeft > 0) {
        this.labels[kept] = label;
        kept++;
      }
    }
    this.labels.length = kept;
  }

  private drainPlayer(player: Player): void {
    const queue = player.pendingFloatingText;
    if (queue.length === 0) return;
    for (const request of queue) {
      if (this.isThrottled(player, request)) continue;
      this.spawn(player.x + TILE_SIZE / 2, player.y, request.text, request.style);
    }
    queue.length = 0;
  }

  /** True when a throttled request repeats a label still inside its quiet window; records it otherwise. */
  private isThrottled(player: Player, request: FloatingTextRequest): boolean {
    const { throttleFrames } = request;
    if (throttleFrames === undefined) return false;
    let shownAt = this.lastThrottledShown.get(player);
    if (shownAt === undefined) {
      shownAt = new Map();
      this.lastThrottledShown.set(player, shownAt);
    }
    const lastShown = shownAt.get(request.text);
    if (lastShown !== undefined && this.frame - lastShown < throttleFrames) return true;
    shownAt.set(request.text, this.frame);
    return false;
  }

  /** Draws every live label in world space. Call during the effects pass. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const label of this.labels) {
      const style = STYLE_DEFS[label.style];
      const progress = 1 - label.framesLeft / LABEL_FRAMES;
      const fadeProgress = Math.max(0, progress - LABEL_HOLD_FRACTION) / (1 - LABEL_HOLD_FRACTION);
      const alpha = 1 - fadeProgress;
      const screenX = label.worldX - camX;
      const screenY = label.worldY - camY - TILE_SIZE * LABEL_RISE_TILES * progress;
      drawText(ctx, label.text, {
        ...TEXT_PRESETS.value,
        x: screenX,
        y: screenY,
        size: style.size,
        bold: style.bold,
        color: style.color,
        alpha,
        align: 'center',
        outline: true,
        glow: style.icon !== undefined ? style.color : false,
      });

      if (style.icon === 'shield') {
        ctx.save();
        ctx.font = `${style.bold ? 'bold ' : ''}${style.size}px monospace`;
        const halfTextWidth = ctx.measureText(label.text).width / 2;
        ctx.restore();
        const iconOffset = halfTextWidth + ICON_GAP_PX + ICON_SIZE_PX / 2;
        drawShieldIcon(ctx, screenX - iconOffset, screenY, ICON_SIZE_PX, style.color, alpha);
        drawShieldIcon(ctx, screenX + iconOffset, screenY, ICON_SIZE_PX, style.color, alpha);
      }
    }
  }

  dispose(): void {
    this.labels.length = 0;
    this.lastThrottledShown = new WeakMap();
  }
}
