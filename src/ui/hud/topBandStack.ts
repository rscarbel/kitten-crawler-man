/**
 * Builds a top-band entry out of a stack of rows (a line of text, a meter, a
 * custom strip), so every bar in the band shares one card, one rhythm and one
 * reflow rule: rows take the card's whole inner width and the card grows to
 * fit them.
 */

import type { Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import {
  topBandCard,
  topBandCardPadding,
  type TopBandEntry,
  type TopBandPriority,
} from './topBand';
import { skinsFor, type MeterKind, type TextRole } from '../theme/skins';
import { panelWidths, type Theme, type TypeStyle } from '../theme/tokens';
import { meter } from '../widgets/meter';
import { fillRounded } from '../widgets/paint';
import { measureTextHeight, resolveText, text, type TextAlign } from '../widgets/text';

/** How wide a band entry is drawn at most, by how much it has to say. */
export const TOP_BAND_WIDTH = {
  /** A clock or a short readout. */
  narrow: panelWidths.sm / 2,
  /** A health bar with its name and a status line. */
  regular: panelWidths.sm,
  /** A headline banner. */
  wide: panelWidths.md,
} as const;

/** What a row's colour means, resolved against the theme. */
export type BandTone = 'accent' | 'danger' | 'success' | 'warning' | 'info' | 'neutral' | 'muted';

export function bandToneColor(theme: Theme, tone: BandTone): string {
  const { palette } = theme;
  switch (tone) {
    case 'accent':
      return palette.accent.base;
    case 'danger':
      return palette.state.danger;
    case 'success':
      return palette.state.success;
    case 'warning':
      return palette.state.warning;
    case 'info':
      return palette.state.info;
    case 'neutral':
      return palette.text.primary;
    case 'muted':
      return palette.text.muted;
  }
}

export interface BandTextRow {
  readonly kind: 'text';
  readonly text: string;
  readonly role?: TextRole;
  readonly style?: TypeStyle;
  readonly tone?: BandTone;
  /** A colour that is game data (a boss's identity colour); outranks `tone`. */
  readonly color?: string;
  readonly align?: TextAlign;
  /** Equal-width digits, for numbers that change every frame. */
  readonly tabular?: boolean;
  /**
   * Wrap onto further lines rather than ending in an ellipsis. Defaults to
   * true, so a status line on a narrow band keeps its words.
   */
  readonly wrap?: boolean;
  /** With `wrap`, the most lines drawn. Defaults to {@link DEFAULT_TEXT_ROW_MAX_LINES}. */
  readonly maxLines?: number;
  /**
   * This row's opacity, on top of the entry's. A function is read at paint
   * time with the UI clock (`ui.now`, ms), for a row that pulses.
   */
  readonly alpha?: number | ((now: number) => number);
}

export interface BandMeterRow {
  readonly kind: 'meter';
  /** Unique within the surface. */
  readonly id: string;
  readonly value: number;
  readonly max: number;
  readonly meterKind?: MeterKind;
  /** Drawn inside the bar on the right, in tabular digits. */
  readonly valueText?: string;
  /** Drawn inside the bar on the left. */
  readonly label?: string;
  /** Fractions along the bar marked with a thin tick (a phase threshold). */
  readonly marks?: readonly number[];
}

export interface BandCustomRow {
  readonly kind: 'custom';
  height(ui: Ui, width: number): number;
  render(ui: Ui, rect: Rect): void;
}

export type BandRow = BandTextRow | BandMeterRow | BandCustomRow;

export interface StackedBandOptions {
  readonly id: string;
  readonly priority: TopBandPriority;
  readonly maxWidth?: number;
  /** The card's edge colour when it is game data (a boss's identity colour). */
  readonly accent?: string;
  /** The card's edge colour by meaning; the plain glass edge when neither is given. */
  readonly accentTone?: BandTone;
  /** The whole entry's opacity, for an entry fading out. */
  readonly alpha?: number;
  readonly rows: readonly BandRow[];
}

const MARK_WIDTH = 1;

/** A wrapped band line stops here, so one status cannot grow the card down the screen. */
export const DEFAULT_TEXT_ROW_MAX_LINES = 2;

function textRowWraps(row: BandTextRow): boolean {
  return row.wrap ?? true;
}

function textRowMaxLines(row: BandTextRow): number {
  return row.maxLines ?? DEFAULT_TEXT_ROW_MAX_LINES;
}

function meterHeight(ui: Ui, row: BandMeterRow): number {
  const skinHeight = skinsFor(ui.theme).meter[row.meterKind ?? 'progress'].height;
  const carriesText = row.valueText !== undefined || row.label !== undefined;
  if (!carriesText) return skinHeight;
  const textHeight = ui.theme.type.label.lineHeight + ui.theme.space.xxs;
  return Math.max(skinHeight, textHeight);
}

function rowHeight(ui: Ui, width: number, row: BandRow): number {
  switch (row.kind) {
    case 'text':
      if (textRowWraps(row)) {
        return measureTextHeight(ui, width, {
          text: row.text,
          role: row.role,
          style: row.style,
          tabular: row.tabular,
          maxLines: textRowMaxLines(row),
        });
      }
      return resolveText(ui.theme, row).style.lineHeight;
    case 'meter':
      return meterHeight(ui, row);
    case 'custom':
      return row.height(ui, width);
  }
}

function renderTextRow(ui: Ui, rect: Rect, row: BandTextRow): void {
  const color =
    row.color ?? (row.tone === undefined ? undefined : bandToneColor(ui.theme, row.tone));
  const draw = (): void => {
    text(ui, rect, {
      text: row.text,
      role: row.role,
      style: row.style,
      color,
      align: row.align ?? 'center',
      tabular: row.tabular,
      wrap: textRowWraps(row),
      maxLines: textRowMaxLines(row),
    });
  };
  const alpha = typeof row.alpha === 'function' ? row.alpha(ui.now) : row.alpha;
  if (alpha === undefined) {
    draw();
    return;
  }
  const { ctx } = ui;
  ctx.save();
  ctx.globalAlpha *= alpha;
  draw();
  ctx.restore();
}

function renderMeterRow(ui: Ui, rect: Rect, row: BandMeterRow): void {
  meter(ui, rect, {
    id: row.id,
    value: row.value,
    max: row.max,
    kind: row.meterKind,
    label: row.label,
    valueText: row.valueText,
  });
  for (const mark of row.marks ?? []) {
    const x = rect.x + rect.w * mark;
    fillRounded(
      ui.ctx,
      { x, y: rect.y, w: MARK_WIDTH, h: rect.h },
      0,
      ui.theme.palette.border.strong,
    );
  }
}

function renderRow(ui: Ui, rect: Rect, row: BandRow): void {
  switch (row.kind) {
    case 'text':
      renderTextRow(ui, rect, row);
      return;
    case 'meter':
      renderMeterRow(ui, rect, row);
      return;
    case 'custom':
      row.render(ui, rect);
  }
}

/** The card's inner width for an entry `width` wide; matches the side padding {@link topBandCard} applies. */
function innerWidth(ui: Ui, width: number): number {
  return Math.max(0, width - ui.theme.space.md * 2);
}

function stackHeight(ui: Ui, width: number, rows: readonly BandRow[]): number {
  const gap = ui.theme.space.xs;
  const heights = rows.map((row) => rowHeight(ui, width, row));
  return heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, rows.length - 1);
}

/** A top-band entry whose card holds `rows`, stacked top to bottom. */
export function stackedBandEntry(opts: StackedBandOptions): TopBandEntry {
  const { rows } = opts;
  return {
    id: opts.id,
    priority: opts.priority,
    maxWidth: opts.maxWidth ?? TOP_BAND_WIDTH.regular,
    height: (ui, width) => stackHeight(ui, innerWidth(ui, width), rows) + topBandCardPadding(ui),
    render: (ui, rect) => {
      const { ctx } = ui;
      ctx.save();
      if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
      const accent =
        opts.accent ??
        (opts.accentTone === undefined ? undefined : bandToneColor(ui.theme, opts.accentTone));
      const inner = topBandCard(ui, rect, { accent });
      const gap = ui.theme.space.xs;
      let y = inner.y;
      for (const row of rows) {
        const h = rowHeight(ui, inner.w, row);
        renderRow(ui, { x: inner.x, y, w: inner.w, h }, row);
        y += h + gap;
      }
      ctx.restore();
    },
  };
}
