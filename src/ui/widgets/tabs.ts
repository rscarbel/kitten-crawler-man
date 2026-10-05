/**
 * A row of mutually exclusive tabs. `segmented` is a sunken track with a
 * raised pill that slides to the chosen tab; `underline` is a row of labels
 * with a gold bar that slides under the chosen one.
 */

import { centerIn, inset, splitH, type Rect } from '../core/geom';
import type { HitState, Ui } from '../core/UiRoot';
import { UiStateSlot } from '../core/uiState';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import { skinsFor } from '../theme/skins';
import { badge, badgeSize } from './badge';
import { drawFocusRing, fillRounded, hoverAmount, isDisabled, strokeRounded } from './paint';
import { measureText, text } from './text';

export interface TabItem {
  /** Unique within the tab row. */
  readonly id: string;
  readonly label: string;
  readonly icon?: GlyphId;
  /** A count shown after the label. */
  readonly badge?: string;
  readonly disabled?: boolean | string;
}

export interface TabsOptions {
  readonly id: string;
  readonly items: readonly TabItem[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
  readonly variant?: 'segmented' | 'underline';
}

const UNDERLINE_THICKNESS = 2;

/** Horizontal scroll of an underline row too wide for its rect; follows the selection. */
const STRIP = new UiStateSlot<{ offset: number; dragFrom: number; selected: string | null }>(
  'tabStrip',
  () => ({ offset: 0, dragFrom: 0, selected: null }),
);
const BORDER_WIDTH = 1;

/** The natural width of one tab's label, icon and badge. */
function tabContentWidth(ui: Ui, item: TabItem): number {
  const { space, size } = ui.theme;
  const style = ui.theme.type.label;
  const icon = item.icon === undefined ? 0 : size.icon + space.xs;
  const count = item.badge === undefined ? 0 : badgeSize(ui, { label: item.badge }).w + space.xs;
  return measureText(ui, item.label, { style }) + icon + count;
}

/** The width the tab row needs to show every label in full. */
export function measureTabs(
  ui: Ui,
  items: readonly TabItem[],
  variant: TabsOptions['variant'] = 'segmented',
): number {
  const pad = ui.theme.space.md * 2;
  const chrome = variant === 'segmented' ? ui.theme.space.xxs * 2 : 0;
  return items.reduce((sum, item) => sum + tabContentWidth(ui, item) + pad, chrome);
}

function tabLabel(ui: Ui, cell: Rect, item: TabItem, color: string): void {
  const { space, size } = ui.theme;
  const contentW = Math.min(cell.w - space.sm * 2, tabContentWidth(ui, item));
  let x = cell.x + (cell.w - contentW) / 2;
  if (item.icon !== undefined) {
    drawGlyph(
      ui.ctx,
      item.icon,
      { x, y: cell.y + (cell.h - size.icon) / 2, w: size.icon, h: size.icon },
      { color },
    );
    x += size.icon + space.xs;
  }
  const countW = item.badge === undefined ? 0 : badgeSize(ui, { label: item.badge }).w + space.xs;
  const labelW = Math.max(0, cell.x + (cell.w + contentW) / 2 - x - countW);
  text(
    ui,
    { x, y: cell.y, w: labelW, h: cell.h },
    { text: item.label, style: ui.theme.type.label, color },
  );
  if (item.badge !== undefined) {
    const pill = badgeSize(ui, { label: item.badge });
    badge(
      ui,
      centerIn({ x: x + labelW + space.xs, y: cell.y, w: pill.w, h: cell.h }, pill.w, pill.h),
      {
        label: item.badge,
        variant: 'soft',
        tone: 'neutral',
      },
    );
  }
}

/**
 * Draws the row and registers one focusable region per enabled tab: the
 * keyboard ring reaches them, and Enter or Space picks the focused one.
 * Returns each tab's state in item order, for screens that track focus.
 */
export function tabs(ui: Ui, rect: Rect, opts: TabsOptions): HitState[] {
  const { theme, ctx } = ui;
  const { palette, space, radius } = theme;
  const variant = opts.variant ?? 'segmented';
  const count = opts.items.length;
  const states: HitState[] = [];
  if (count === 0) return states;
  const selectedIndex = Math.max(
    0,
    opts.items.findIndex((item) => item.id === opts.selected),
  );

  if (variant === 'segmented') {
    fillRounded(ctx, rect, radius.md, palette.surface.sunken);
    strokeRounded(ctx, rect, radius.md, palette.border.subtle, BORDER_WIDTH);
    const track = inset(rect, space.xxs);
    const cells = splitH(
      track,
      opts.items.map((): 'fill' => 'fill'),
      0,
    );
    const cellW = track.w / count;
    const pillX = ui.tween(`${opts.id}/pill`, track.x + selectedIndex * cellW, {
      ms: theme.motion.base,
    });
    const pill: Rect = { x: pillX, y: track.y, w: cellW, h: track.h };
    fillRounded(ctx, pill, radius.md - space.xxs, palette.surface.raised);
    strokeRounded(ctx, pill, radius.md - space.xxs, palette.border.strong, BORDER_WIDTH);
    opts.items.forEach((item, index) => {
      const cell = cells[index];
      const disabled = isDisabled(item.disabled);
      const isSelected = index === selectedIndex;
      const state = ui.hit(`${opts.id}/${item.id}`, cell, {
        onTap: () => opts.onSelect(item.id),
        disabled,
      });
      const hover = hoverAmount(ui, `${opts.id}/${item.id}`, state.hovered && !disabled);
      const color = disabled
        ? palette.text.disabled
        : isSelected
          ? palette.text.primary
          : hover > 0 || state.pressed
            ? palette.text.primary
            : palette.text.secondary;
      tabLabel(ui, cell, item, color);
      if (state.focused) drawFocusRing(ui, cell, radius.md - space.xxs);
      states.push(state);
    });
    return states;
  }

  const widths = opts.items.map((item) => tabContentWidth(ui, item) + space.md * 2);
  const natural = widths.reduce((sum, w) => sum + w, 0);
  const maxOffset = Math.max(0, natural - rect.w);
  const strip = ui.state(STRIP, opts.id);
  if (maxOffset > 0) {
    ui.hit(`${opts.id}/strip`, rect, {
      focusable: false,
      onWheel: (dy) => {
        strip.offset = Math.min(maxOffset, Math.max(0, strip.offset + dy));
      },
      onDrag: {
        onStart: () => {
          strip.dragFrom = strip.offset;
        },
        onMove: (point) => {
          strip.offset = Math.min(maxOffset, Math.max(0, strip.dragFrom - point.dx));
        },
      },
    });
  }
  const unshifted = splitH({ ...rect, w: natural }, widths, 0);
  const chosenAt = unshifted[selectedIndex];
  if (strip.selected !== opts.selected) {
    strip.selected = opts.selected;
    const left = chosenAt.x - rect.x;
    if (left < strip.offset) strip.offset = left;
    else if (left + chosenAt.w > strip.offset + rect.w) strip.offset = left + chosenAt.w - rect.w;
  }
  strip.offset = Math.min(maxOffset, Math.max(0, strip.offset));
  const shift = ui.tween(`${opts.id}/shift`, strip.offset, { ms: theme.motion.fast });
  const cells = unshifted.map((cell) => ({ ...cell, x: cell.x - shift }));
  ui.clip(rect, () => {
    const chosen = cells[selectedIndex];
    const barX = ui.tween(`${opts.id}/barX`, chosen.x + space.md, { ms: theme.motion.base });
    const barW = ui.tween(`${opts.id}/barW`, chosen.w - space.md * 2, { ms: theme.motion.base });
    fillRounded(
      ctx,
      { x: barX, y: rect.y + rect.h - UNDERLINE_THICKNESS, w: barW, h: UNDERLINE_THICKNESS },
      radius.pill,
      palette.accent.base,
    );
    opts.items.forEach((item, index) => {
      const cell = cells[index];
      const disabled = isDisabled(item.disabled);
      const state = ui.hit(`${opts.id}/${item.id}`, cell, {
        onTap: () => opts.onSelect(item.id),
        disabled,
      });
      const hover = hoverAmount(ui, `${opts.id}/${item.id}`, state.hovered && !disabled);
      const color = disabled
        ? palette.text.disabled
        : index === selectedIndex
          ? palette.accent.base
          : hover > 0
            ? palette.text.primary
            : palette.text.secondary;
      tabLabel(ui, inset(cell, { b: UNDERLINE_THICKNESS }), item, color);
      if (state.focused) drawFocusRing(ui, cell, skinsFor(theme).controlSize.sm.radius);
      states.push(state);
    });
  });
  return states;
}
