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
import type { Rect } from '../../ui/core/geom';
import type { Ui } from '../../ui/core/UiRoot';
import { topBandCard, topBandCardPadding, type TopBandEntry } from '../../ui/hud/topBand';
import { drawResourceIcon } from '../../ui/icons/resourceIcons';
import { badge, badgeSize } from '../../ui/widgets/badge';
import { lineHeightOf, measureText, tabularNumber } from '../../ui/widgets/text';

const TICKS_PER_SECOND = 60;
/** How long the strip stays up after the last harvest, build or repair. */
export const RESOURCE_HUD_LINGER_SECONDS = 10;
const LINGER_TICKS = RESOURCE_HUD_LINGER_SECONDS * TICKS_PER_SECOND;
/** Fade in and out over a quarter of a second. */
const FADE_TICKS = 15;

/** A cell's pulse when its count changes: up to this scale and back. */
const PULSE_TICKS = 18;
const PULSE_PEAK_SCALE = 0.1;

export const RESOURCE_HUD_ENTRY_ID = 'briar-resources';
/** Every cell side by side with the thrall pill beside them. */
const RESOURCE_HUD_MAX_WIDTH = 340;
/** Narrowest a cell is drawn before the cells wrap onto another row. */
const MIN_CELL_WIDTH = 56;
const ICON_SIZE = 22;

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

  /** The strip's card for the HUD's top band, while it is showing at all. */
  topBandEntry(frame: ResourceHudFrame): TopBandEntry | null {
    if (this.fade <= 0) return null;
    return {
      id: RESOURCE_HUD_ENTRY_ID,
      priority: 'banner',
      maxWidth: RESOURCE_HUD_MAX_WIDTH,
      height: (ui, width) =>
        topBandCardPadding(ui) + stripLayout(ui, contentRect(ui, width), thrallLabel(frame)).height,
      render: (ui, rect) => this.render(ui, rect, frame),
    };
  }

  private render(ui: Ui, rect: Rect, frame: ResourceHudFrame): void {
    const { ctx } = ui;
    ctx.save();
    ctx.globalAlpha *= this.fade;
    const inner = topBandCard(ui, rect);
    const pillLabel = thrallLabel(frame);
    const layout = stripLayout(ui, inner, pillLabel);
    for (const cell of layout.cells) this.renderCell(ui, cell.rect, cell.id, frame);
    if (layout.pill !== null && pillLabel !== null) {
      badge(ui, layout.pill, { label: pillLabel, tone: 'success', variant: 'soft' });
    }
    ctx.restore();
  }

  private renderCell(ui: Ui, cell: Rect, id: ResourceId, frame: ResourceHudFrame): void {
    const pulse = (this.pulseTicks.get(id) ?? 0) / PULSE_TICKS;
    const scale = 1 + Math.sin(pulse * Math.PI) * PULSE_PEAK_SCALE;
    const { ctx, theme } = ui;
    const centreX = cell.x + cell.w / 2;
    const centreY = cell.y + cell.h / 2;
    ctx.save();
    ctx.translate(centreX, centreY);
    ctx.scale(scale, scale);
    ctx.translate(-centreX, -centreY);
    const count = String(partyCount(frame.human, frame.cat, id));
    const countLine = lineHeightOf(ui, 'value');
    const countWidth = measureText(ui, count, { role: 'value', tabular: true });
    const groupWidth = Math.min(cell.w, ICON_SIZE + theme.space.xs + countWidth);
    const groupLeft = cell.x + (cell.w - groupWidth) / 2;
    const iconTop = cell.y + (countLine - ICON_SIZE) / 2;
    drawResourceIcon(ctx, { x: groupLeft, y: iconTop, w: ICON_SIZE, h: ICON_SIZE }, id);
    const countLeft = groupLeft + ICON_SIZE + theme.space.xs;
    tabularNumber(
      ui,
      { x: countLeft, y: cell.y, w: Math.max(0, cell.x + cell.w - countLeft), h: countLine },
      { value: count, role: 'value' },
    );
    tabularNumber(
      ui,
      { x: cell.x, y: cell.y + countLine, w: cell.w, h: lineHeightOf(ui, 'caption') },
      {
        value: `+${sessionTallyOf(id)}`,
        role: 'caption',
        color: pulse > 0 ? theme.palette.state.success : theme.palette.text.secondary,
        align: 'center',
      },
    );
    ctx.restore();
  }
}

function thrallLabel(frame: ResourceHudFrame): string | null {
  return frame.thrallSecondsLeft === null ? null : `Thrall ${frame.thrallSecondsLeft}s`;
}

/** The card's inside for a card `width` wide, placed at the origin, for measuring. */
function contentRect(ui: Ui, width: number): Rect {
  return { x: 0, y: 0, w: Math.max(0, width - ui.theme.space.md * 2), h: 0 };
}

interface StripLayout {
  readonly cells: readonly { readonly id: ResourceId; readonly rect: Rect }[];
  readonly pill: Rect | null;
  readonly height: number;
}

/**
 * The cells in as few rows as fit `inner`'s width, and the thrall pill beside
 * them when there is room, else on a row of its own under them.
 */
function stripLayout(ui: Ui, inner: Rect, pillLabel: string | null): StripLayout {
  const gap = ui.theme.space.xs;
  const cellHeight = lineHeightOf(ui, 'value') + lineHeightOf(ui, 'caption');
  const count = RESOURCE_IDS.length;
  const pillSize = pillLabel === null ? null : badgeSize(ui, { label: pillLabel });
  const cellsInOneRow = count * MIN_CELL_WIDTH + (count - 1) * gap;
  const pillBeside = pillSize !== null && inner.w >= cellsInOneRow + gap + pillSize.w;
  const cellsWidth = pillBeside ? inner.w - gap - pillSize.w : inner.w;
  const columns = Math.max(
    1,
    Math.min(count, Math.floor((cellsWidth + gap) / (MIN_CELL_WIDTH + gap))),
  );
  const rows = Math.ceil(count / columns);
  const cellWidth = (cellsWidth - gap * (columns - 1)) / columns;
  const cells = RESOURCE_IDS.map((id, index) => ({
    id,
    rect: {
      x: inner.x + (index % columns) * (cellWidth + gap),
      y: inner.y + Math.floor(index / columns) * (cellHeight + gap),
      w: cellWidth,
      h: cellHeight,
    },
  }));
  const cellsHeight = rows * cellHeight + (rows - 1) * gap;
  if (pillSize === null) return { cells, pill: null, height: cellsHeight };
  if (pillBeside) {
    const pill: Rect = {
      x: inner.x + inner.w - pillSize.w,
      y: inner.y + (cellsHeight - pillSize.h) / 2,
      w: pillSize.w,
      h: pillSize.h,
    };
    return { cells, pill, height: cellsHeight };
  }
  const pill: Rect = {
    x: inner.x + (inner.w - pillSize.w) / 2,
    y: inner.y + cellsHeight + gap,
    w: pillSize.w,
    h: pillSize.h,
  };
  return { cells, pill, height: cellsHeight + gap + pillSize.h };
}
