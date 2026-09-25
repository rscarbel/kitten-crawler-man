/**
 * The resource counters: a see-through strip at the top of the screen with the
 * party's wood, stone, boards and rope, each over how much of it the party has
 * gained this session.
 *
 * It is only up while it matters — while resources are being gathered or
 * spent, for a while after, and wherever the owner says resources are the
 * point of being there (the lumber yard, the quarry, the palisade) — and it
 * fades in and out rather than popping.
 */

import { partyCount } from '../../core/partyResources';
import { RESOURCE_IDS, type ResourceId } from '../../core/resourceIds';
import { resetSessionTally, sessionTallyOf } from '../../core/resourceSessionTally';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { BOX_PRESETS, drawBox } from '../../ui/Box';
import { drawText, TEXT_PRESETS } from '../../ui/TextBox';
import { drawResourceIcon } from '../../ui/icons/resourceIcons';
import type { StripSlot } from '../DungeonUIRenderer';
import { HARVEST_BUFF_COLOR } from './HarvestEffects';

const TICKS_PER_SECOND = 60;
/** How long the strip stays up after the last harvest, build or repair. */
export const RESOURCE_HUD_LINGER_SECONDS = 10;
const LINGER_TICKS = RESOURCE_HUD_LINGER_SECONDS * TICKS_PER_SECOND;
/** Fade in and out over a quarter of a second. */
const FADE_TICKS = 15;

/** A cell's pulse when its count changes: up to this scale and back. */
const PULSE_TICKS = 18;
const PULSE_PEAK_SCALE = 0.1;

/** Strip geometry, in unscaled pixels. */
const CELL_W = 56;
const CELL_GAP = 4;
const STRIP_PAD = 6;
const ICON_SIZE = 22;
const ICON_TOP = 4;
const COUNT_TOP = 7;
const ICON_COUNT_GAP = 4;
const COUNT_LEFT = ICON_SIZE + ICON_COUNT_GAP;
const TALLY_TOP = 30;
const STRIP_H = 46;
/** The strip's height, for HUD chrome that stacks under it. */
export const RESOURCE_HUD_HEIGHT = STRIP_H;
export const RESOURCE_HUD_WIDTH =
  RESOURCE_IDS.length * CELL_W + (RESOURCE_IDS.length - 1) * CELL_GAP + STRIP_PAD * 2;
const TALLY_SIZE = 9;
const TALLY_IDLE_COLOR = '#94a3b8';

/** The thrall timer pill beside the strip. */
const PILL_W = 70;
const PILL_H = 22;
const PILL_GAP = 6;
const PILL_TEXT_TOP = 5;
const THRALL_PILL_COLOR = '#86efac';

export interface ResourceHudFrame {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /** Whether the active crawler stands somewhere resources are the point: a work yard, the palisade. */
  readonly inResourceZone: boolean;
  /** Seconds the longest-lived thrall has left, or null with none out. */
  readonly thrallSecondsLeft: number | null;
}

export class ResourceHud {
  private ticksSinceActivity = Number.POSITIVE_INFINITY;
  private fade = 0;
  private readonly lastCounts = new Map<ResourceId, number>();
  private readonly pulseTicks = new Map<ResourceId, number>();

  /**
   * Marks a harvest, build or repair in progress: the strip comes up and
   * stays up for the linger after the last one.
   */
  noteActivity(): void {
    this.ticksSinceActivity = 0;
  }

  /** Whether the strip should be up this tick. */
  shouldShow(frame: ResourceHudFrame): boolean {
    return (
      frame.inResourceZone ||
      frame.thrallSecondsLeft !== null ||
      this.ticksSinceActivity < LINGER_TICKS
    );
  }

  update(frame: ResourceHudFrame): void {
    if (this.ticksSinceActivity < LINGER_TICKS) this.ticksSinceActivity += 1;
    const step = 1 / FADE_TICKS;
    const wasVisible = this.fade > 0;
    this.fade = this.shouldShow(frame)
      ? Math.min(1, this.fade + step)
      : Math.max(0, this.fade - step);
    // Reset once the strip is fully hidden, not when it starts fading, so the
    // count doesn't visibly snap to 0 while still on screen.
    if (wasVisible && this.fade === 0) resetSessionTally();

    for (const id of RESOURCE_IDS) {
      const count = partyCount(frame.human, frame.cat, id);
      const previous = this.lastCounts.get(id);
      if (previous !== undefined && previous !== count) this.pulseTicks.set(id, PULSE_TICKS);
      this.lastCounts.set(id, count);
      const pulse = this.pulseTicks.get(id) ?? 0;
      if (pulse > 0) this.pulseTicks.set(id, pulse - 1);
    }
  }

  /** How visible the strip is, 0–1, for tests and for anything laid out around it. */
  get opacity(): number {
    return this.fade;
  }

  render(ctx: CanvasRenderingContext2D, slot: StripSlot, frame: ResourceHudFrame): void {
    if (this.fade <= 0) return;
    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.scale(slot.scale, slot.scale);
    drawBox(ctx, {
      x: 0,
      y: 0,
      width: RESOURCE_HUD_WIDTH,
      height: STRIP_H,
      ...BOX_PRESETS.hudTranslucent,
      alpha: this.fade,
    });
    RESOURCE_IDS.forEach((id, index) => {
      this.renderCell(ctx, id, STRIP_PAD + index * (CELL_W + CELL_GAP), frame);
    });
    if (frame.thrallSecondsLeft !== null) this.renderThrallPill(ctx, frame.thrallSecondsLeft);
    ctx.restore();
  }

  private renderCell(
    ctx: CanvasRenderingContext2D,
    id: ResourceId,
    left: number,
    frame: ResourceHudFrame,
  ): void {
    const pulse = (this.pulseTicks.get(id) ?? 0) / PULSE_TICKS;
    const scale = 1 + Math.sin(pulse * Math.PI) * PULSE_PEAK_SCALE;
    const centreX = left + CELL_W / 2;
    const centreY = STRIP_H / 2;
    ctx.save();
    ctx.translate(centreX, centreY);
    ctx.scale(scale, scale);
    ctx.translate(-centreX, -centreY);
    ctx.globalAlpha = this.fade;
    drawResourceIcon(ctx, id, left, ICON_TOP, ICON_SIZE);
    drawText(ctx, String(partyCount(frame.human, frame.cat, id)), {
      x: left + COUNT_LEFT,
      y: COUNT_TOP,
      ...TEXT_PRESETS.value,
      outline: true,
      alpha: this.fade,
    });
    drawText(ctx, `+${sessionTallyOf(id)}`, {
      x: centreX,
      y: TALLY_TOP,
      ...TEXT_PRESETS.label,
      size: TALLY_SIZE,
      color: pulse > 0 ? HARVEST_BUFF_COLOR : TALLY_IDLE_COLOR,
      align: 'center',
      alpha: this.fade,
    });
    ctx.restore();
  }

  private renderThrallPill(ctx: CanvasRenderingContext2D, secondsLeft: number): void {
    const left = RESOURCE_HUD_WIDTH + PILL_GAP;
    drawBox(ctx, {
      x: left,
      y: 0,
      width: PILL_W,
      height: PILL_H,
      ...BOX_PRESETS.hudTranslucent,
      alpha: this.fade,
    });
    drawText(ctx, `Thrall ${secondsLeft}s`, {
      x: left + PILL_W / 2,
      y: PILL_TEXT_TOP,
      ...TEXT_PRESETS.label,
      color: THRALL_PILL_COLOR,
      align: 'center',
      alpha: this.fade,
    });
  }
}

/** The strip's full width including the thrall pill, for laying it out before it is drawn. */
export function resourceHudFootprintWidth(withThrallPill: boolean): number {
  return withThrallPill ? RESOURCE_HUD_WIDTH + PILL_GAP + PILL_W : RESOURCE_HUD_WIDTH;
}
