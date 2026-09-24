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

interface StyleDef {
  size: number;
  color: string;
  bold: boolean;
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
};

interface FloatingLabel {
  worldX: number;
  worldY: number;
  text: string;
  style: FloatingTextStyle;
  framesLeft: number;
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
    this.labels.push({
      worldX: worldX + jitter,
      worldY,
      text,
      style,
      framesLeft: LABEL_FRAMES,
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
      drawText(ctx, label.text, {
        ...TEXT_PRESETS.value,
        x: label.worldX - camX,
        y: label.worldY - camY - TILE_SIZE * LABEL_RISE_TILES * progress,
        size: style.size,
        bold: style.bold,
        color: style.color,
        alpha: 1 - fadeProgress,
        align: 'center',
        outline: true,
      });
    }
  }

  dispose(): void {
    this.labels.length = 0;
    this.lastThrottledShown = new WeakMap();
  }
}
