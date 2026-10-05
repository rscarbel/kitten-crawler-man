/**
 * What a job needs against what the party holds, as a row of chips — each
 * green with a tick once covered and red while short, so the moment the last
 * one is met reads as a change of colour rather than sums to compare. A
 * covered entry shows its need as its count ("30/30", never "41/30").
 */

import type { ItemId } from '../../core/ItemDefs';
import { centerIn, inset, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import { ITEM_ICONS } from '../icons/itemIcons';
import { fillRounded } from './paint';
import { measureText, text } from './text';

/** One thing a job needs. An `item` or a `glyph` adds an icon before its name. */
export interface CostEntry {
  readonly label: string;
  readonly have: number;
  readonly need: number;
  readonly item?: ItemId;
  readonly glyph?: GlyphId;
}

export interface CostChipsOptions {
  readonly costs: readonly CostEntry[];
  readonly align?: 'left' | 'center' | 'right';
}

const CHIP_FILL_ALPHA = 0.12;

function isMet(cost: CostEntry): boolean {
  return cost.have >= cost.need;
}

function countText(cost: CostEntry): string {
  return `${Math.min(cost.have, cost.need)}/${cost.need}`;
}

function hasIcon(cost: CostEntry): boolean {
  return cost.item !== undefined || cost.glyph !== undefined;
}

interface ChipMetrics {
  readonly h: number;
  readonly icon: number;
  readonly widths: readonly number[];
}

function metrics(ui: Ui, costs: readonly CostEntry[]): ChipMetrics {
  const { space, type } = ui.theme;
  const h = type.label.lineHeight + space.xs * 2;
  const icon = type.label.lineHeight;
  const widths = costs.map((cost) => {
    const label = measureText(ui, `${cost.label} `, { role: 'label' });
    const count = measureText(ui, countText(cost), { role: 'label', tabular: true });
    const lead = hasIcon(cost) ? icon + space.xs : 0;
    const tick = isMet(cost) ? icon + space.xxs : 0;
    return Math.ceil(space.sm * 2 + lead + label + count + tick);
  });
  return { h, icon, widths };
}

function rowsFor(widths: readonly number[], maxWidth: number, gap: number): number[][] {
  const rows: number[][] = [];
  let current: number[] = [];
  let used = 0;
  widths.forEach((w, index) => {
    const needed = current.length === 0 ? w : used + gap + w;
    if (needed > maxWidth && current.length > 0) {
      rows.push(current);
      current = [index];
      used = w;
    } else {
      current.push(index);
      used = needed;
    }
  });
  if (current.length > 0) rows.push(current);
  return rows;
}

/** The size the chips take when wrapped to `maxWidth`. */
export function measureCostChips(
  ui: Ui,
  costs: readonly CostEntry[],
  maxWidth: number,
): { w: number; h: number } {
  const m = metrics(ui, costs);
  const gap = ui.theme.space.xs;
  const rows = rowsFor(m.widths, maxWidth, gap);
  const rowWidth = (row: readonly number[]): number =>
    row.reduce((sum, index) => sum + (m.widths[index] ?? 0), 0) + gap * Math.max(0, row.length - 1);
  return {
    w: Math.max(0, ...rows.map(rowWidth)),
    h: rows.length * m.h + gap * Math.max(0, rows.length - 1),
  };
}

/** Draws the chips from the top of `rect`, wrapping onto new rows as needed. */
export function costChips(ui: Ui, rect: Rect, opts: CostChipsOptions): void {
  const { theme, ctx } = ui;
  const { palette, space, radius } = theme;
  const m = metrics(ui, opts.costs);
  const gap = space.xs;
  const rows = rowsFor(m.widths, rect.w, gap);
  rows.forEach((row, rowIndex) => {
    const rowW =
      row.reduce((sum, index) => sum + (m.widths[index] ?? 0), 0) + gap * (row.length - 1);
    const align = opts.align ?? 'left';
    let x =
      align === 'left'
        ? rect.x
        : align === 'right'
          ? rect.x + rect.w - rowW
          : rect.x + (rect.w - rowW) / 2;
    const y = rect.y + rowIndex * (m.h + gap);
    for (const index of row) {
      const cost = opts.costs[index];
      const w = m.widths[index] ?? 0;
      const met = isMet(cost);
      const tone = met ? palette.state.success : palette.state.danger;
      const chip: Rect = { x, y, w, h: m.h };
      fillRounded(ctx, chip, radius.pill, withAlpha(tone, CHIP_FILL_ALPHA));
      let cursor = chip.x + space.sm;
      const iconBox: Rect = { x: cursor, y: chip.y, w: m.icon, h: chip.h };
      if (cost.item !== undefined) {
        ITEM_ICONS[cost.item](ctx, centerIn(iconBox, m.icon, m.icon));
        cursor += m.icon + space.xs;
      } else if (cost.glyph !== undefined) {
        drawGlyph(ctx, cost.glyph, centerIn(iconBox, m.icon, m.icon), {
          color: palette.text.secondary,
        });
        cursor += m.icon + space.xs;
      }
      const label = `${cost.label} `;
      const labelW = measureText(ui, label, { role: 'label' });
      text(
        ui,
        { x: cursor, y: chip.y, w: labelW, h: chip.h },
        { text: label, role: 'label', color: palette.text.secondary },
      );
      cursor += labelW;
      const count = countText(cost);
      const countW = measureText(ui, count, { role: 'label', tabular: true });
      text(
        ui,
        { x: cursor, y: chip.y, w: countW, h: chip.h },
        { text: count, role: 'label', color: tone, tabular: true },
      );
      cursor += countW + space.xxs;
      if (met) {
        drawGlyph(
          ctx,
          'check',
          inset(
            centerIn({ x: cursor, y: chip.y, w: m.icon, h: chip.h }, m.icon, m.icon),
            space.xxs,
          ),
          {
            color: tone,
          },
        );
      }
      x += w + gap;
    }
  });
}
