/**
 * A short list of actions opened at a point (right-click or long-press on a
 * bag slot). A tap outside dismisses it; choosing an item runs it and then
 * dismisses.
 */

import { centerIn, inset, splitV, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import { skinsFor } from '../theme/skins';
import {
  disabledReason,
  drawFocusRing,
  drawGlass,
  fillRounded,
  hoverAmount,
  isDisabled,
} from './paint';
import { scrollView } from './scrollView';
import { lineHeightOf, measureText, text } from './text';

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: GlyphId;
  readonly danger?: boolean;
  /** `true`, or the reason it can't be used, shown as a caption under the label. */
  readonly disabled?: boolean | string;
  readonly onTap: () => void;
}

export interface ContextMenuOptions {
  readonly id: string;
  /** Where it was opened; the menu's top-left corner goes here when it fits. */
  readonly at: { readonly x: number; readonly y: number };
  readonly title?: string;
  readonly items: readonly ContextMenuItem[];
  readonly onDismiss: () => void;
}

const MIN_MENU_WIDTH = 160;
const HOVER_FILL_ALPHA = 0.07;

/** Draws the menu above everything else in the surface. Returns its frame. */
export function contextMenu(ui: Ui, opts: ContextMenuOptions): Rect {
  const { theme } = ui;
  const { space, size, palette, radius } = theme;
  const skin = skinsFor(theme).panel.popover;
  const pad = space.xs;
  const rowH = size.control;
  const titleH = opts.title === undefined ? 0 : lineHeightOf(ui, 'overline') + space.sm;
  const labelW = Math.max(
    0,
    ...opts.items.map((item) => {
      const reason = disabledReason(item.disabled);
      const label = measureText(ui, item.label, { role: 'label' });
      return Math.max(label, reason === null ? 0 : measureText(ui, reason, { role: 'caption' }));
    }),
  );
  const rowHeights = opts.items.map((item) =>
    disabledReason(item.disabled) === null ? rowH : rowH + lineHeightOf(ui, 'caption'),
  );
  const w = Math.max(MIN_MENU_WIDTH, labelW + size.icon + space.sm * 2 + space.sm + pad * 2);
  const rowsHeight = rowHeights.reduce((sum, rh) => sum + rh, 0);
  const bounds = inset(ui.viewport, space.sm);
  const h = Math.min(pad * 2 + titleH + rowsHeight, bounds.h);
  const opensLeft = opts.at.x + w > bounds.x + bounds.w;
  const left = opensLeft ? opts.at.x - w : opts.at.x;
  const top = Math.min(opts.at.y, bounds.y + bounds.h - h);
  const placed: Rect = {
    x: Math.min(Math.max(left, bounds.x), bounds.x + bounds.w - w),
    y: Math.max(top, bounds.y),
    w,
    h,
  };

  ui.defer(() => {
    ui.layer({ onEscape: () => opts.onDismiss() });
    ui.hit(`${opts.id}/dismiss`, ui.screen, {
      onTap: () => opts.onDismiss(),
      focusable: false,
      sound: null,
    });
    ui.block(placed);
    drawGlass(ui, placed, skin, radius.md);
    const inner = inset(placed, pad);
    if (opts.title !== undefined) {
      text(ui, inset({ ...inner, h: titleH }, { l: space.sm, t: space.xs }), {
        text: opts.title,
        role: 'overline',
        valign: 'top',
      });
    }
    const rowArea = inset(inner, { t: titleH });
    const drawRows = (area: Rect): void => {
      const rows = splitV(area, rowHeights, 0);
      opts.items.forEach((item, index) => {
        const row = rows[index];
        const disabled = isDisabled(item.disabled);
        const state = ui.hit(`${opts.id}/${item.id}`, row, {
          disabled,
          onTap: () => {
            item.onTap();
            opts.onDismiss();
          },
        });
        const hover = hoverAmount(ui, `${opts.id}/${item.id}`, state.hovered && !disabled);
        if (hover > 0 || state.pressed) {
          ui.ctx.save();
          ui.ctx.globalAlpha *= state.pressed ? 1 : hover;
          fillRounded(ui.ctx, row, radius.sm, withAlpha(palette.text.primary, HOVER_FILL_ALPHA));
          ui.ctx.restore();
        }
        const color = disabled
          ? palette.text.disabled
          : item.danger === true
            ? palette.state.danger
            : palette.text.primary;
        const line = { ...row, h: rowH };
        const content = inset(line, { l: space.sm, r: space.sm });
        if (item.icon !== undefined) {
          drawGlyph(
            ui.ctx,
            item.icon,
            centerIn({ ...content, w: size.icon }, size.icon, size.icon),
            {
              color,
            },
          );
        }
        const labelRect = inset(content, { l: size.icon + space.sm });
        text(ui, labelRect, { text: item.label, role: 'label', color });
        const reason = disabledReason(item.disabled);
        if (reason !== null) {
          text(
            ui,
            {
              x: labelRect.x,
              y: row.y + rowH - space.xs,
              w: labelRect.w,
              h: lineHeightOf(ui, 'caption'),
            },
            {
              text: reason,
              role: 'muted',
            },
          );
        }
        if (state.focused) drawFocusRing(ui, row, radius.sm);
      });
    };
    if (rowsHeight > rowArea.h) {
      scrollView(ui, rowArea, { id: `${opts.id}/rows`, contentHeight: rowsHeight, draw: drawRows });
    } else {
      drawRows(rowArea);
    }
  });
  return placed;
}
