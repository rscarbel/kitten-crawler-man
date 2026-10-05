import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import type { Rect } from '../ui/core/geom';
import { inset } from '../ui/core/geom';
import type { KeyModifiers, Surface, Ui } from '../ui/core/UiRoot';
import { skinsFor } from '../ui/theme/skins';
import { worldPalette } from '../ui/theme/worldInk';
import { button, buttonHeight, measureButton } from '../ui/widgets/button';
import { drawGlass, fillRounded, strokeRounded } from '../ui/widgets/paint';
import { measureText, text } from '../ui/widgets/text';
import { measureWorldText, worldText, wrapWorldText } from '../ui/world/worldText';

const BUBBLE_TTL = 300; // 5 s at 60 fps
const BUBBLE_FADE = 60;
const MAX_BUBBLE_W = 180;

const CHAT_TEXT_TRUNCATE_LENGTH = 80;
const CHAT_TEXT_TRUNCATE_SHOW = 77;
const TILE_CENTER_OFFSET = 0.5;

/** Longest line the chat box accepts. */
const CHAT_INPUT_MAX_LENGTH = 120;
const CHAT_PLACEHOLDER = 'Say something...';
const CHAT_FIELD_MAX_WIDTH = 400;
/** Space kept clear on either side of the chat box on a narrow screen. */
const CHAT_SIDE_MARGIN = 20;
const CHAT_FIELD_BORDER_WIDTH = 1.5;
/** The caret is on for half of each blink period. */
const CARET_BLINK_MS = 1000;
const CARET_WIDTH = 1.5;
const CARET_GAP = 1;
/** Padding above, between and below the box's two rows. */
const BOX_GAPS = 3;
const SEND_KEYS_HINT = '[Enter] send  [Esc] cancel';

/**
 * The box types through a focused DOM text field kept off to the side,
 * invisible: the browser then does the text editing (an IME's composed
 * text, AltGr and Option characters, caret moves, paste), and a phone raises
 * its on-screen keyboard for it. Sixteen pixels keeps iOS from zooming the
 * page to it.
 */
const KEYBOARD_SINK_FONT_PX = 16;
const KEYBOARD_SINK_Z_INDEX = 9999;

const CHAT_BUBBLE_BASE_ALPHA = 0.78;
const CHAT_BUBBLE_FONT_SIZE = 11;
const CHAT_BUBBLE_PADDING = 7;
const CHAT_BUBBLE_LINE_HEIGHT = 14;
const CHAT_BUBBLE_MIN_WIDTH = 40;
const CHAT_BUBBLE_CORNER_RADIUS = 5;
const CHAT_BUBBLE_BORDER_WIDTH = 1;
const CHAT_BUBBLE_POINTER_HEIGHT = 7;
const CHAT_BUBBLE_TAIL_X_OFFSET = 5;
const CHAT_BUBBLE_OFFSET_Y_RATIO = 0.35;
const CHAT_BUBBLE_TEXT_Y_OFFSET = 3;
const CHAT_BUBBLE_TEXT_Y_ADJUST = 9;

/** The end of a line too long for its field, so the words being typed stay in view. */
function visibleTail(ui: Ui, line: string, width: number): string {
  let start = 0;
  while (start < line.length && measureText(ui, line.slice(start), { role: 'body' }) > width) {
    start++;
  }
  return line.slice(start);
}

/**
 * The chat box and the bubble that shows what was said. The box draws on the
 * canvas what its hidden DOM field holds. While that field has focus the
 * scene leaves every key to it; when it has lost focus, the surface's `onKey`
 * types instead and hands focus back, so the world never sees those keys.
 */
export class PlayerChatSystem {
  private _isOpen = false;
  private value = '';
  private onSubmit: ((text: string) => void) | null = null;
  private keyboardSink: HTMLInputElement | null = null;
  private bubbleText: string | null = null;
  private bubbleTtl = 0;

  get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * Opens an empty box; `onSubmit` gets the trimmed line when the player
   * sends one. `canvas` places the hidden field the box types through.
   */
  open(canvas: HTMLCanvasElement, onSubmit: (text: string) => void): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.value = '';
    this.onSubmit = onSubmit;
    this.attachKeyboardSink(canvas);
  }

  /**
   * The chat box as a surface. It halts the world and takes every key while
   * open, Space included, so the box can type it; Escape closes it.
   */
  surface(id: string): Surface {
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      takesText: true,
      isOpen: () => this._isOpen,
      render: (ui) => this.renderBox(ui),
      close: () => this.cancel(),
      onKey: (key, mods) => this.handleKey(key, mods),
    };
  }

  cancel(): void {
    this.close();
  }

  /**
   * One key that reached the canvas while the box is up, which happens only
   * when its field has lost focus. Enter sends, Escape cancels, Backspace
   * erases and any printable key types; the field is kept in step and takes
   * focus back. Every key is spent on the box, including one held from before
   * it opened, which was aimed at the world.
   */
  handleKey(key: string, mods: KeyModifiers): boolean {
    if (!this._isOpen) return false;
    if (mods.predatesSurface === true) return true;
    if (key === 'Enter') {
      if (mods.repeat !== true) this.submit();
      return true;
    }
    if (key === 'Escape') {
      this.close();
      return true;
    }
    if (key === 'Backspace') {
      this.value = this.value.slice(0, -1);
    } else if (Array.from(key).length === 1 && this.value.length < CHAT_INPUT_MAX_LENGTH) {
      this.value += key;
    }
    this.refocusKeyboardSink();
    return true;
  }

  /** Where the caret sits in the typed line: the field's own caret, so arrow-key edits show. */
  private caretIndex(): number {
    const caret = this.keyboardSink?.selectionEnd ?? this.value.length;
    return Math.min(Math.max(caret, 0), this.value.length);
  }

  /** The box along the bottom of the screen: the typed line over a hint or, on touch, Send and Cancel. */
  renderBox(ui: Ui): void {
    const { theme, viewport, ctx } = ui;
    const { space, palette, radius, type } = theme;
    const touch = ui.density === 'touch';
    const width = Math.min(CHAT_FIELD_MAX_WIDTH, viewport.w - CHAT_SIDE_MARGIN * 2);
    const fieldHeight = theme.size.control;
    const actionsHeight = touch ? buttonHeight(ui, 'sm') : type.caption.lineHeight;
    const height = space.sm * BOX_GAPS + actionsHeight + fieldHeight;
    const box: Rect = {
      x: viewport.x + (viewport.w - width) / 2,
      y: viewport.y + viewport.h - space.md - height,
      w: width,
      h: height,
    };
    drawGlass(ui, box, skinsFor(theme).panel.hud);
    const content = inset(box, space.sm);
    const actions: Rect = { ...content, h: actionsHeight };
    const field: Rect = { ...content, y: content.y + actionsHeight + space.sm, h: fieldHeight };

    if (touch) this.renderTouchActions(ui, actions);
    else {
      text(ui, actions, { text: SEND_KEYS_HINT, role: 'caption', color: palette.accent.base });
    }

    ui.hit('field', field, { onTap: () => this.keyboardSink?.focus(), sound: null });
    fillRounded(ctx, field, radius.md, palette.surface.sunken);
    strokeRounded(ctx, field, radius.md, palette.accent.base, CHAT_FIELD_BORDER_WIDTH);
    const line = inset(field, { l: space.sm, r: space.sm });
    const hasValue = this.value.length > 0;
    const caret = this.caretIndex();
    const beforeCaret = visibleTail(ui, this.value.slice(0, caret), line.w);
    const shownStart = caret - beforeCaret.length;
    const shown = hasValue ? this.value.slice(shownStart) : CHAT_PLACEHOLDER;
    text(ui, line, {
      text: shown,
      role: 'body',
      color: hasValue ? undefined : palette.text.muted,
    });
    const caretOn = Math.floor(ui.now / (CARET_BLINK_MS / 2)) % 2 === 0;
    if (caretOn) {
      const typedWidth = hasValue
        ? Math.min(line.w, measureText(ui, beforeCaret, { role: 'body' }))
        : 0;
      const caretHeight = type.body.lineHeight;
      ctx.fillStyle = palette.accent.base;
      ctx.fillRect(
        line.x + typedWidth + CARET_GAP,
        field.y + (field.h - caretHeight) / 2,
        CARET_WIDTH,
        caretHeight,
      );
    }
  }

  private renderTouchActions(ui: Ui, row: Rect): void {
    const gap = ui.theme.space.sm;
    const sendWidth = measureButton(ui, { label: 'Send', size: 'sm' });
    const cancelWidth = measureButton(ui, { label: 'Cancel', size: 'sm' });
    const sendX = row.x + row.w - sendWidth;
    button(
      ui,
      { x: sendX - gap - cancelWidth, y: row.y, w: cancelWidth, h: row.h },
      { label: 'Cancel', size: 'sm', variant: 'ghost', onTap: () => this.close() },
    );
    button(
      ui,
      { x: sendX, y: row.y, w: sendWidth, h: row.h },
      { label: 'Send', size: 'sm', variant: 'primary', onTap: () => this.submit() },
    );
  }

  private submit(): void {
    const typed = this.value.trim();
    const onSubmit = this.onSubmit;
    this.close();
    if (typed !== '' && onSubmit !== null) onSubmit(typed);
  }

  private close(): void {
    this._isOpen = false;
    this.value = '';
    this.onSubmit = null;
    this.detachKeyboardSink();
  }

  private attachKeyboardSink(canvas: HTMLCanvasElement): void {
    const sink = document.createElement('input');
    sink.type = 'text';
    sink.maxLength = CHAT_INPUT_MAX_LENGTH;
    const rect = canvas.getBoundingClientRect();
    Object.assign(sink.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      bottom: `${window.innerHeight - rect.bottom}px`,
      width: '1px',
      opacity: '0',
      fontSize: `${KEYBOARD_SINK_FONT_PX}px`,
      pointerEvents: 'none',
      zIndex: `${KEYBOARD_SINK_Z_INDEX}`,
    });
    const readSink = () => {
      this.value = sink.value.slice(0, CHAT_INPUT_MAX_LENGTH);
    };
    sink.addEventListener('input', readSink);
    sink.addEventListener('compositionend', readSink);
    sink.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation();
      // The Enter that commits an IME's composition belongs to the IME.
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        if (!e.repeat) this.submit();
      } else if (e.key === 'Escape') {
        this.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
      }
    });
    document.body.appendChild(sink);
    sink.focus();
    this.keyboardSink = sink;
  }

  private refocusKeyboardSink(): void {
    const sink = this.keyboardSink;
    if (sink === null) return;
    sink.value = this.value;
    sink.setSelectionRange(this.value.length, this.value.length);
    sink.focus();
  }

  private detachKeyboardSink(): void {
    const sink = this.keyboardSink;
    if (sink === null) return;
    this.keyboardSink = null;
    sink.remove();
  }

  showBubble(text: string): void {
    this.bubbleText =
      text.length > CHAT_TEXT_TRUNCATE_LENGTH
        ? `${text.slice(0, CHAT_TEXT_TRUNCATE_SHOW)}...`
        : text;
    this.bubbleTtl = BUBBLE_TTL;
  }

  update(): void {
    if (this.bubbleTtl > 0) this.bubbleTtl--;
  }

  renderBubble(ctx: CanvasRenderingContext2D, camX: number, camY: number, player: Player): void {
    if (!this.bubbleText || this.bubbleTtl <= 0) return;

    const alpha =
      this.bubbleTtl < BUBBLE_FADE ? this.bubbleTtl / BUBBLE_FADE : CHAT_BUBBLE_BASE_ALPHA;
    const ts = TILE_SIZE;
    const centerX = player.x - camX + ts * TILE_CENTER_OFFSET;
    const topY = player.y - camY;

    const font = { size: CHAT_BUBBLE_FONT_SIZE } as const;
    const pad = CHAT_BUBBLE_PADDING;
    const lines = wrapWorldText(ctx, this.bubbleText, MAX_BUBBLE_W - pad * 2, font);
    const lineH = CHAT_BUBBLE_LINE_HEIGHT;
    const measuredW = Math.max(...lines.map((l) => measureWorldText(ctx, l, font).width));
    const boxW = Math.max(CHAT_BUBBLE_MIN_WIDTH, Math.min(MAX_BUBBLE_W, measuredW + pad * 2));
    const boxH = lines.length * lineH + pad * 2;
    const tailH = CHAT_BUBBLE_POINTER_HEIGHT;

    const bx = Math.round(centerX - boxW / 2);
    const by = Math.round(topY - boxH - tailH - ts * CHAT_BUBBLE_OFFSET_Y_RATIO);
    const tailX = Math.round(centerX);

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = worldPalette.chatBubble.fill;
    this.traceBubblePath(ctx, bx, by, boxW, boxH, CHAT_BUBBLE_CORNER_RADIUS, tailX, tailH);
    ctx.fill();

    ctx.strokeStyle = worldPalette.chatBubble.edge;
    ctx.lineWidth = CHAT_BUBBLE_BORDER_WIDTH;
    this.traceBubblePath(ctx, bx, by, boxW, boxH, CHAT_BUBBLE_CORNER_RADIUS, tailX, tailH);
    ctx.stroke();

    worldText(ctx, lines.join('\n'), {
      ...font,
      x: bx + pad,
      y: by + pad + lineH - CHAT_BUBBLE_TEXT_Y_OFFSET - CHAT_BUBBLE_TEXT_Y_ADJUST,
      color: worldPalette.chatBubble.ink,
      lineHeight: lineH,
      alpha,
    });

    ctx.restore();
  }

  private traceBubblePath(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bw: number,
    bh: number,
    r: number,
    tailX: number,
    tailH: number,
  ): void {
    const tailLeft = Math.max(bx + r, tailX - CHAT_BUBBLE_TAIL_X_OFFSET);
    const tailRight = Math.min(bx + bw - r, tailX + CHAT_BUBBLE_TAIL_X_OFFSET);
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(tailRight, by + bh);
    ctx.lineTo(tailX, by + bh + tailH);
    ctx.lineTo(tailLeft, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
  }
}
