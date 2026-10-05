/**
 * The siege's card in the HUD's top band: the countdown or the wave as a
 * headline, then the bell's health and the necromancer's and the bounty
 * mark's. A narrow band, or a compact screen where height is scarce, lays
 * the bars side by side on one row under a one-line headline.
 */

import type { Rect } from '../../ui/core/geom';
import type { Ui } from '../../ui/core/UiRoot';
import { topBandCard, topBandCardPadding, type TopBandEntry } from '../../ui/hud/topBand';
import { skinsFor } from '../../ui/theme/skins';
import { meter } from '../../ui/widgets/meter';
import { fillRounded } from '../../ui/widgets/paint';
import { lineHeightOf, measureTextHeight, text } from '../../ui/widgets/text';

export type SiegeHudBarKind = 'hp' | 'boss';

/** One bar in the siege's card. */
export interface SiegeHudBar {
  /** Unique within the card, for the meter's tween. */
  readonly id: string;
  readonly label: string;
  /** 0 to 1. */
  readonly fraction: number;
  readonly kind: SiegeHudBarKind;
  /** How bright the flash over the bar is, 0 to 1: the bell just struck. */
  readonly flash: number;
}

/** What the siege's card shows this frame. */
export interface SiegeHudView {
  readonly headline: string;
  readonly bars: readonly SiegeHudBar[];
}

export const SIEGE_HUD_ENTRY_ID = 'briar-siege';
const SIEGE_HUD_MAX_WIDTH = 360;
/** Narrower than this, a bar per row leaves too little room beside the headline's wrap; the bars share a row. */
const SIEGE_HUD_FULL_LAYOUT_MIN_WIDTH = 280;
const FULL_HEADLINE_MAX_LINES = 2;
const COMPACT_HEADLINE_MAX_LINES = 1;

function isCompact(ui: Ui, width: number): boolean {
  return width < SIEGE_HUD_FULL_LAYOUT_MIN_WIDTH || ui.size === 'compact';
}

function headlineOptions(ui: Ui, view: SiegeHudView, compact: boolean) {
  return {
    text: view.headline,
    role: 'danger',
    style: ui.theme.type.title,
    maxLines: compact ? COMPACT_HEADLINE_MAX_LINES : FULL_HEADLINE_MAX_LINES,
  } as const;
}

function meterHeight(ui: Ui, kind: SiegeHudBarKind): number {
  return skinsFor(ui.theme).meter[kind].height;
}

function barRowHeight(ui: Ui, bars: readonly SiegeHudBar[]): number {
  const tallest = Math.max(0, ...bars.map((bar) => meterHeight(ui, bar.kind)));
  return lineHeightOf(ui, 'caption') + ui.theme.space.xxs + tallest;
}

/** The bars in rows: one each, or all together on a compact card. */
function barRows(view: SiegeHudView, compact: boolean): SiegeHudBar[][] {
  if (view.bars.length === 0) return [];
  return compact ? [[...view.bars]] : view.bars.map((bar) => [bar]);
}

function contentWidth(ui: Ui, width: number): number {
  return Math.max(0, width - ui.theme.space.md * 2);
}

function contentHeight(ui: Ui, view: SiegeHudView, width: number): number {
  const compact = isCompact(ui, width);
  const headline = measureTextHeight(
    ui,
    contentWidth(ui, width),
    headlineOptions(ui, view, compact),
  );
  const rows = barRows(view, compact);
  const gap = ui.theme.space.xs;
  return rows.reduce((total, row) => total + gap + barRowHeight(ui, row), headline);
}

function renderBar(ui: Ui, rect: Rect, bar: SiegeHudBar): void {
  const labelHeight = lineHeightOf(ui, 'caption');
  text(ui, { ...rect, h: labelHeight }, { text: bar.label, role: 'caption' });
  const skin = skinsFor(ui.theme).meter[bar.kind];
  const barRect: Rect = {
    x: rect.x,
    y: rect.y + labelHeight + ui.theme.space.xxs,
    w: rect.w,
    h: skin.height,
  };
  meter(ui, barRect, {
    id: `${SIEGE_HUD_ENTRY_ID}/${bar.id}`,
    value: bar.fraction,
    max: 1,
    kind: bar.kind,
  });
  if (bar.flash <= 0) return;
  const { ctx } = ui;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, bar.flash);
  fillRounded(ctx, barRect, skin.radius, ui.theme.palette.text.primary);
  ctx.restore();
}

function render(ui: Ui, rect: Rect, view: SiegeHudView): void {
  const inner = topBandCard(ui, rect, { accent: ui.theme.palette.state.danger });
  const compact = isCompact(ui, rect.w);
  const headline = headlineOptions(ui, view, compact);
  const headlineHeight = measureTextHeight(ui, inner.w, headline);
  text(ui, { ...inner, h: headlineHeight }, { ...headline, wrap: true, align: 'center' });
  const gap = ui.theme.space.xs;
  let y = inner.y + headlineHeight;
  for (const row of barRows(view, compact)) {
    y += gap;
    const rowHeight = barRowHeight(ui, row);
    const rowRect: Rect = { x: inner.x, y, w: inner.w, h: rowHeight };
    const columnGap = ui.theme.space.sm;
    const columnWidth = (rowRect.w - columnGap * (row.length - 1)) / row.length;
    row.forEach((bar, index) => {
      const cell: Rect = {
        ...rowRect,
        x: rowRect.x + index * (columnWidth + columnGap),
        w: columnWidth,
      };
      renderBar(ui, cell, bar);
    });
    y += rowHeight;
  }
}

/** The siege's card for the top band. */
export function siegeHudEntry(view: SiegeHudView): TopBandEntry {
  return {
    id: SIEGE_HUD_ENTRY_ID,
    priority: 'encounter',
    maxWidth: SIEGE_HUD_MAX_WIDTH,
    height: (ui, width) => topBandCardPadding(ui) + contentHeight(ui, view, width),
    render: (ui, rect) => render(ui, rect, view),
  };
}
