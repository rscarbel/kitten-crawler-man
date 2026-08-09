/**
 * A canvas text field the player types into with the physical keyboard.
 *
 * The keystrokes arrive through `SceneManager`'s capture-phase listener rather
 * than a DOM input, so the registry below has to live apart from any one panel:
 * the listener must be able to ask "is somebody typing?" without importing the
 * bag. It mirrors the rebind-capture module for exactly that reason.
 */

import { drawBox } from './Box';
import { drawText } from './TextBox';
import { pointInRect } from '../utils';

/** Long enough for any item name worth typing, short enough to fit the field. */
const SEARCH_MAX_LENGTH = 24;

/** Frames the caret spends visible, then hidden. */
const SEARCH_CARET_BLINK_FRAMES = 30;

const SEARCH_PLACEHOLDER = 'Search…';
const SEARCH_FONT_SIZE = 11;
const SEARCH_TEXT_PAD_X = 6;
const SEARCH_FILL = '#0f172a';
const SEARCH_BORDER = '#334155';
const SEARCH_BORDER_FOCUSED = '#3b82f6';
const SEARCH_BORDER_WIDTH = 1;
const SEARCH_RADIUS = 2;
const SEARCH_TEXT_COLOR = '#e2e8f0';
const SEARCH_PLACEHOLDER_COLOR = '#64748b';
const SEARCH_CARET_COLOR = '#e2e8f0';
const SEARCH_CARET_WIDTH = 1;
const SEARCH_CARET_INSET_Y = 4;
const SEARCH_CARET_GAP = 1;

const BLINK_PERIOD_FRAMES = SEARCH_CARET_BLINK_FRAMES * 2;

interface FieldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let _capturing: SearchField | null = null;
let _releaseHeldKeys: (() => void) | null = null;

/**
 * Source for {@link SearchField.focusToken}. Global rather than per-instance so
 * two different fields can never collide on the same token, and monotonic so a
 * field re-focused after a blur gets a token distinct from its last focus.
 */
let _nextFocusToken = 1;

/**
 * How this module drops the keys the game thinks are still down. Registered by
 * whoever owns the `InputManager`, because a UI field must not reach for it.
 */
export function setSearchCaptureHeldKeyRelease(release: () => void): void {
  _releaseHeldKeys = release;
}

/** Arm capture for one field. Re-arming moves it rather than stacking. */
export function beginSearchCapture(field: SearchField): void {
  _capturing = field;
  // A key already down when the field takes capture never gets its key-up: this
  // capture swallows the release too, so the polled set would keep reporting a
  // walk the player stopped asking for the moment they clicked the field.
  _releaseHeldKeys?.();
}

export function endSearchCapture(): void {
  _capturing = null;
}

/** The field currently eating keystrokes, or null when nobody is typing. */
export function activeSearchField(): SearchField | null {
  return _capturing;
}

export class SearchField {
  text = '';
  readonly maxLength = SEARCH_MAX_LENGTH;

  /** Set by `render`, so a click can be tested against where the field really is. */
  private lastRect: FieldRect | null = null;
  private caretFrame = 0;

  /** Set on every `focus()`; null while unfocused. See {@link focusToken}. */
  private focusToken_: number | null = null;

  isFocused(): boolean {
    return _capturing === this;
  }

  focus(): void {
    beginSearchCapture(this);
    this.caretFrame = 0;
    this.focusToken_ = _nextFocusToken++;
  }

  /**
   * Changes on every `focus()`, so a caller can tell a key press that predates
   * this focus (an OS auto-repeat from a key held since before the field was
   * clicked) apart from one struck after — the same "a repeat keydown predates
   * its menu" pattern `SceneManager` uses for the focus ring.
   */
  focusToken(): number | null {
    return this.focusToken_;
  }

  /** Releases capture, but only if this field is the one holding it. */
  blur(): void {
    if (this.isFocused()) endSearchCapture();
  }

  clear(): void {
    this.text = '';
  }

  /** The query in the form callers should compare against, or '' for no filter. */
  normalizedQuery(): string {
    return this.text.trim().toLowerCase();
  }

  hasQuery(): boolean {
    return this.normalizedQuery().length > 0;
  }

  handleCapturedKey(key: string): void {
    if (key === 'Escape' || key === 'Enter') {
      this.blur();
      return;
    }
    if (key === 'Backspace') {
      this.text = this.text.slice(0, -1);
      this.caretFrame = 0;
      return;
    }
    // Anything longer than one character is a named key — 'Shift', 'ArrowLeft'
    // and the rest have no printable form to append.
    if (key.length !== 1) return;
    if (this.text.length >= this.maxLength) return;
    this.text += key;
    this.caretFrame = 0;
  }

  render(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    this.lastRect = { x, y, w, h };
    const focused = this.isFocused();

    drawBox(ctx, {
      x,
      y,
      width: w,
      height: h,
      fill: SEARCH_FILL,
      border: focused ? SEARCH_BORDER_FOCUSED : SEARCH_BORDER,
      borderWidth: SEARCH_BORDER_WIDTH,
      radius: SEARCH_RADIUS,
    });

    const showsPlaceholder = this.text.length === 0;
    const textX = x + SEARCH_TEXT_PAD_X;
    const textY = y + Math.round((h - SEARCH_FONT_SIZE) / 2);
    drawText(ctx, showsPlaceholder ? SEARCH_PLACEHOLDER : this.text, {
      x: textX,
      y: textY,
      size: SEARCH_FONT_SIZE,
      color: showsPlaceholder ? SEARCH_PLACEHOLDER_COLOR : SEARCH_TEXT_COLOR,
    });

    if (!focused) return;

    this.caretFrame = (this.caretFrame + 1) % BLINK_PERIOD_FRAMES;
    if (this.caretFrame >= SEARCH_CARET_BLINK_FRAMES) return;

    const typedWidth = showsPlaceholder ? 0 : this.measureTypedWidth(ctx);
    drawBox(ctx, {
      x: textX + typedWidth + SEARCH_CARET_GAP,
      y: y + SEARCH_CARET_INSET_Y,
      width: SEARCH_CARET_WIDTH,
      height: h - SEARCH_CARET_INSET_Y * 2,
      fill: SEARCH_CARET_COLOR,
    });
  }

  /** True when (mx, my) is inside the rect the last `render` drew. */
  hits(mx: number, my: number): boolean {
    const rect = this.lastRect;
    if (rect === null) return false;
    return pointInRect(mx, my, rect);
  }

  /**
   * Measured with the same font `drawText` resolves for these options, so the
   * caret sits against the last glyph rather than near it.
   */
  private measureTypedWidth(ctx: CanvasRenderingContext2D): number {
    ctx.save();
    ctx.font = `${SEARCH_FONT_SIZE}px monospace`;
    const width = ctx.measureText(this.text).width;
    ctx.restore();
    return width;
  }
}
