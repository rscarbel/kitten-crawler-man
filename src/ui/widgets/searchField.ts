/**
 * A one-line text filter. The field never listens to the keyboard itself:
 * the surface that owns it delegates its `onKey` to {@link SearchInput.handleKey},
 * so typing reaches the field only while that surface is on top.
 *
 * ```ts
 * readonly search = new SearchInput();
 * onKey(key: string): boolean { return this.search.handleKey(key); }
 * render(ui: Ui) { searchField(ui, rect, { id: 'search', input: this.search }); }
 * ```
 */

import { centerIn, inset, type Rect } from '../core/geom';
import type { HitState, Ui } from '../core/UiRoot';
import { drawGlyph } from '../theme/glyphs';
import { drawFocusRing, fillRounded, hoverAmount, strokeRounded } from './paint';
import { iconButton } from './iconButton';
import { measureText, text } from './text';

/** Longest query the field accepts. */
export const SEARCH_MAX_LENGTH = 40;

/** The query and whether the field is taking keys. Owned by the surface. */
export class SearchInput {
  value = '';
  /** Taking typed keys. */
  active = false;
  /** When the surface showing the field last opened; a reopened surface starts with the field idle. */
  private shownSince: number | null = null;
  /**
   * Keys struck since the field started taking keys. An auto-repeat of any
   * other key is a key held from before (walking with W into a tap on the
   * field), not typing, and would otherwise spell "wwww…".
   */
  private readonly struckWhileActive = new Set<string>();

  /** @internal Called by the widget each frame it is drawn. */
  noteShown(openedAt: number): void {
    if (this.shownSince !== null && this.shownSince !== openedAt) this.active = false;
    this.shownSince = openedAt;
  }

  activate(): void {
    if (!this.active) this.struckWhileActive.clear();
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
  }

  clear(): void {
    this.value = '';
  }

  /**
   * Feeds one key from the surface's `onKey`. While active, printable keys
   * type, Backspace erases, and Enter or Escape stop typing (Escape is spent
   * on the field, not on closing the surface). An auto-repeat of a key held
   * since before the field took keys is swallowed. Returns whether it used the key.
   */
  handleKey(key: string, repeat = false): boolean {
    if (!this.active) return false;
    if (repeat && !this.struckWhileActive.has(key)) return true;
    if (!repeat) this.struckWhileActive.add(key);
    if (key === 'Escape' || key === 'Enter') {
      this.active = false;
      return true;
    }
    if (key === 'Backspace') {
      this.value = this.value.slice(0, -1);
      return true;
    }
    if (Array.from(key).length === 1) {
      if (this.value.length < SEARCH_MAX_LENGTH) this.value += key;
      return true;
    }
    return false;
  }
}

export interface SearchFieldOptions {
  readonly id: string;
  readonly input: SearchInput;
  readonly placeholder?: string;
}

const BORDER_WIDTH = 1;
const ACTIVE_BORDER_WIDTH = 1.5;
/** The caret is on for half of each blink period. */
const CARET_BLINK_MS = 1000;
const CARET_WIDTH = 1.5;
const CARET_GAP = 1;

export function searchField(ui: Ui, rect: Rect, opts: SearchFieldOptions): HitState {
  const { theme, ctx } = ui;
  const { palette, radius, space, size } = theme;
  const input = opts.input;
  input.noteShown(ui.openedAt);
  const state = ui.hit(opts.id, rect, {
    onTap: () => input.activate(),
    onOutsideDown: () => input.deactivate(),
    sound: null,
  });
  const hover = hoverAmount(ui, opts.id, state.hovered);
  fillRounded(ctx, rect, radius.md, palette.surface.sunken);
  strokeRounded(
    ctx,
    rect,
    radius.md,
    input.active ? palette.accent.base : hover > 0 ? palette.border.strong : palette.border.subtle,
    input.active ? ACTIVE_BORDER_WIDTH : BORDER_WIDTH,
  );
  const iconSide = size.icon;
  const iconRect = centerIn(
    { x: rect.x + space.sm, y: rect.y, w: iconSide, h: rect.h },
    iconSide,
    iconSide,
  );
  drawGlyph(ctx, 'search', iconRect, {
    color: input.active ? palette.accent.base : palette.text.muted,
  });

  const clearSide = rect.h - space.xs * 2;
  const hasValue = input.value.length > 0;
  const field = inset(rect, {
    l: space.sm * 2 + iconSide,
    r: hasValue ? clearSide + space.xs : space.sm,
  });
  if (hasValue) {
    text(ui, field, { text: input.value, role: 'body' });
  } else {
    text(ui, field, {
      text: opts.placeholder ?? 'Search',
      role: 'body',
      color: palette.text.muted,
    });
  }
  const caretOn = input.active && Math.floor(ui.now / (CARET_BLINK_MS / 2)) % 2 === 0;
  if (caretOn) {
    const typedW = hasValue ? Math.min(field.w, measureText(ui, input.value, { role: 'body' })) : 0;
    const caretH = theme.type.body.lineHeight;
    ctx.fillStyle = palette.accent.base;
    ctx.fillRect(field.x + typedW + CARET_GAP, rect.y + (rect.h - caretH) / 2, CARET_WIDTH, caretH);
  }
  if (hasValue) {
    iconButton(
      ui,
      {
        x: rect.x + rect.w - clearSide - space.xs,
        y: rect.y + space.xs,
        w: clearSide,
        h: clearSide,
      },
      {
        id: `${opts.id}/clear`,
        icon: 'close',
        label: 'Clear search',
        size: 'sm',
        tooltip: false,
        onTap: () => input.clear(),
      },
    );
  }
  if (state.focused) drawFocusRing(ui, rect, radius.md);
  return state;
}
