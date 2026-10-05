/**
 * One row of a list: an optional leading picture, a title with an optional
 * subtitle, and an optional trailing value or control. Priced rows, journal
 * entries, follower and mercenary lists are all this.
 */

import type { ItemId } from '../../core/ItemDefs';
import { centerIn, inset, type Rect } from '../core/geom';
import type { HitState, Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import type { TextRole } from '../theme/skins';
import { ITEM_ICONS } from '../icons/itemIcons';
import {
  disabledReason,
  drawFocusRing,
  fillRounded,
  hoverAmount,
  isDisabled,
  strokeRounded,
} from './paint';
import { lineHeightOf, measureText, text } from './text';
import { tooltip } from './tooltip';

/** What sits at the start of a row. */
export type RowLeading =
  | { readonly kind: 'item'; readonly item: ItemId }
  | { readonly kind: 'glyph'; readonly glyph: GlyphId; readonly color?: string }
  | { readonly kind: 'paint'; readonly paint: (ctx: CanvasRenderingContext2D, rect: Rect) => void };

export interface ListRowOptions {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly leading?: RowLeading;
  /** A value on the right: a price, a count, a state. */
  readonly trailing?: string;
  readonly trailingRole?: TextRole;
  readonly trailingColor?: string;
  /** Draws custom content (chips, a button) at the right; gets the space left of `trailing`. */
  readonly trailingWidth?: number;
  readonly trailingContent?: (rect: Rect) => void;
  /** A token colour for the thin bar on the row's left edge (a category). */
  readonly accent?: string;
  readonly selected?: boolean;
  readonly disabled?: boolean | string;
  readonly onTap?: () => void;
  /** How far, in UI units, a press may wander before it drags the list instead of tapping the row. */
  readonly dragSlop?: number;
}

const HOVER_FILL_ALPHA = 0.05;
const PRESS_FILL_ALPHA = 0.5;
const SELECTED_BORDER_ALPHA = 0.25;
const ACCENT_BAR_WIDTH = 3;
const BORDER_WIDTH = 1;

/** A row tall enough for a title and a subtitle. */
export function listRowHeight(ui: Ui, withSubtitle: boolean): number {
  if (!withSubtitle) return ui.theme.size.row;
  const lines = lineHeightOf(ui, 'label') + lineHeightOf(ui, 'caption');
  return Math.max(ui.theme.size.row, lines + ui.theme.space.md * 2);
}

export function listRow(ui: Ui, rect: Rect, opts: ListRowOptions): HitState {
  const { theme, ctx } = ui;
  const { palette, space, radius } = theme;
  const disabled = isDisabled(opts.disabled);
  const interactive = opts.onTap !== undefined || disabled;
  const onTap = opts.onTap;
  const state = interactive
    ? ui.hit(opts.id, rect, {
        onTap: onTap === undefined ? undefined : () => onTap(),
        disabled,
        dragSlop: opts.dragSlop,
      })
    : { hovered: false, pressed: false, focused: false };
  const hover = hoverAmount(ui, opts.id, state.hovered && !disabled && opts.onTap !== undefined);
  const selected = opts.selected === true;

  if (selected) {
    fillRounded(ctx, rect, radius.md, palette.accent.soft);
    strokeRounded(
      ctx,
      rect,
      radius.md,
      withAlpha(palette.accent.base, SELECTED_BORDER_ALPHA),
      BORDER_WIDTH,
    );
  }
  if (hover > 0 || state.pressed) {
    ctx.save();
    ctx.globalAlpha *= state.pressed ? 1 : hover;
    fillRounded(
      ctx,
      rect,
      radius.md,
      state.pressed
        ? withAlpha(palette.surface.sunken, PRESS_FILL_ALPHA)
        : withAlpha(palette.text.primary, HOVER_FILL_ALPHA),
    );
    ctx.restore();
  }
  const barColor = selected ? palette.accent.base : opts.accent;
  if (barColor !== undefined) {
    const barH = rect.h - space.md * 2;
    fillRounded(
      ctx,
      { x: rect.x + space.xxs, y: rect.y + (rect.h - barH) / 2, w: ACCENT_BAR_WIDTH, h: barH },
      radius.pill,
      barColor,
    );
  }

  let content = inset(rect, { l: space.md, r: space.md });
  const titleColor = disabled ? palette.text.disabled : undefined;

  if (opts.leading !== undefined) {
    const side = Math.min(rect.h - space.sm * 2, theme.size.slot);
    const box: Rect = { x: content.x, y: rect.y + (rect.h - side) / 2, w: side, h: side };
    drawLeading(ui, box, opts.leading, disabled);
    content = inset(content, { l: side + space.md });
  }

  if (opts.trailing !== undefined) {
    const role = opts.trailingRole ?? 'label';
    const w = Math.min(content.w / 2, measureText(ui, opts.trailing, { role, tabular: true }));
    text(
      ui,
      { x: content.x + content.w - w, y: rect.y, w, h: rect.h },
      {
        text: opts.trailing,
        role,
        color: disabled ? palette.text.disabled : opts.trailingColor,
        align: 'right',
        tabular: true,
      },
    );
    content = inset(content, { r: w + space.md });
  }
  if (opts.trailingContent !== undefined && opts.trailingWidth !== undefined) {
    const w = Math.min(content.w / 2, opts.trailingWidth);
    opts.trailingContent({ x: content.x + content.w - w, y: rect.y, w, h: rect.h });
    content = inset(content, { r: w + space.md });
  }

  const titleH = lineHeightOf(ui, 'label');
  if (opts.subtitle === undefined) {
    text(
      ui,
      { ...content, y: rect.y, h: rect.h },
      { text: opts.title, role: 'label', color: titleColor },
    );
  } else {
    const subH = lineHeightOf(ui, 'caption');
    const top = rect.y + (rect.h - titleH - subH) / 2;
    text(
      ui,
      { x: content.x, y: top, w: content.w, h: titleH },
      {
        text: opts.title,
        role: 'label',
        color: titleColor,
      },
    );
    text(
      ui,
      { x: content.x, y: top + titleH, w: content.w, h: subH },
      {
        text: opts.subtitle,
        role: 'caption',
        color: disabled ? palette.text.disabled : undefined,
      },
    );
  }

  if (state.focused) drawFocusRing(ui, rect, radius.md);
  const reason = disabledReason(opts.disabled);
  if (reason !== null) {
    tooltip(ui, rect, {
      id: `${opts.id}/reason`,
      text: reason,
      show: state.hovered || state.pressed,
      immediate: state.pressed,
    });
  }
  return state;
}

const DISABLED_ICON_ALPHA = 0.4;
/** The glyph fills this fraction of its leading box. */
const LEADING_GLYPH_SCALE = 0.55;

function drawLeading(ui: Ui, box: Rect, leading: RowLeading, disabled: boolean): void {
  const { ctx, theme } = ui;
  fillRounded(ctx, box, theme.radius.sm, theme.palette.surface.sunken);
  ctx.save();
  if (disabled) ctx.globalAlpha *= DISABLED_ICON_ALPHA;
  const art = inset(box, theme.space.xs);
  switch (leading.kind) {
    case 'item':
      ITEM_ICONS[leading.item](ctx, art);
      break;
    case 'glyph': {
      const side = box.w * LEADING_GLYPH_SCALE;
      drawGlyph(ctx, leading.glyph, centerIn(box, side, side), {
        color: leading.color ?? theme.palette.text.secondary,
      });
      break;
    }
    case 'paint':
      leading.paint(ctx, art);
      break;
  }
  ctx.restore();
}
