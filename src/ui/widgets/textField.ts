/**
 * A one-line free-text field drawn on the canvas over a {@link TextEntrySink},
 * which holds the text and does the editing. A tap on the field focuses the
 * sink inside that tap, which is what makes a phone raise its keyboard.
 *
 * ```ts
 * textField(ui, rect, { id: 'name', sink, placeholder: 'Type a name' });
 * ```
 */

import { inset, type Rect } from '../core/geom';
import type { HitState, Ui } from '../core/UiRoot';
import type { TextEntrySink } from '../input/textEntrySink';
import { drawFocusRing, fillRounded, hoverAmount, strokeRounded } from './paint';
import { measureText, text } from './text';

export interface TextFieldOptions {
  readonly id: string;
  readonly sink: TextEntrySink;
  readonly placeholder: string;
  /**
   * Draws the field as taking keys: the accent edge and the blinking caret.
   * Defaults to whether the sink has focus; a box whose surface types every
   * key it is offered into the field says so whatever the focus.
   */
  readonly active?: boolean;
}

const BORDER_WIDTH = 1;
const ACTIVE_BORDER_WIDTH = 1.5;
/** The caret is on for half of each blink period. */
const CARET_BLINK_MS = 1000;
const CARET_WIDTH = 1.5;
const CARET_GAP = 1;

/** The end of a line too long for its field, so the words being typed stay in view. */
function visibleTail(ui: Ui, line: string, width: number): string {
  let start = 0;
  while (start < line.length && measureText(ui, line.slice(start), { role: 'body' }) > width) {
    start++;
  }
  return line.slice(start);
}

export function textField(ui: Ui, rect: Rect, opts: TextFieldOptions): HitState {
  const { theme, ctx } = ui;
  const { palette, radius, space, type } = theme;
  const { sink } = opts;
  const state = ui.hit(opts.id, rect, { onTap: () => sink.focus(), sound: null });
  const active = opts.active ?? sink.focused;
  const hover = hoverAmount(ui, opts.id, state.hovered);
  fillRounded(ctx, rect, radius.md, palette.surface.sunken);
  strokeRounded(
    ctx,
    rect,
    radius.md,
    active ? palette.accent.base : hover > 0 ? palette.border.strong : palette.border.subtle,
    active ? ACTIVE_BORDER_WIDTH : BORDER_WIDTH,
  );

  const line = inset(rect, { l: space.sm, r: space.sm });
  const value = sink.value;
  const hasValue = value.length > 0;
  const caret = sink.caretIndex();
  const beforeCaret = visibleTail(ui, value.slice(0, caret), line.w);
  const shownStart = caret - beforeCaret.length;
  text(ui, line, {
    text: hasValue ? value.slice(shownStart) : opts.placeholder,
    role: 'body',
    color: hasValue ? undefined : palette.text.muted,
  });
  const caretOn = active && Math.floor(ui.now / (CARET_BLINK_MS / 2)) % 2 === 0;
  if (caretOn) {
    const typedWidth = hasValue
      ? Math.min(line.w, measureText(ui, beforeCaret, { role: 'body' }))
      : 0;
    const caretHeight = type.body.lineHeight;
    ctx.fillStyle = palette.accent.base;
    ctx.fillRect(
      line.x + typedWidth + CARET_GAP,
      rect.y + (rect.h - caretHeight) / 2,
      CARET_WIDTH,
      caretHeight,
    );
  }
  if (state.focused) drawFocusRing(ui, rect, radius.md);
  return state;
}
