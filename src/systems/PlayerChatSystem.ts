import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { graphemes } from '../core/text/graphemes';
import type { Rect } from '../ui/core/geom';
import { inset } from '../ui/core/geom';
import type { KeyModifiers, Surface, Ui } from '../ui/core/UiRoot';
import { skinsFor } from '../ui/theme/skins';
import { worldPalette } from '../ui/theme/worldInk';
import { button, buttonHeight, measureButton } from '../ui/widgets/button';
import { drawGlass } from '../ui/widgets/paint';
import { text } from '../ui/widgets/text';
import { textField } from '../ui/widgets/textField';
import { TextEntrySink } from '../ui/input/textEntrySink';
import { measureWorldText, worldText, wrapWorldText } from '../ui/world/worldText';

const BUBBLE_TTL = 300; // 5 s at 60 fps
const BUBBLE_FADE = 60;
const MAX_BUBBLE_W = 180;

const CHAT_TEXT_TRUNCATE_LENGTH = 80;
const CHAT_TEXT_TRUNCATE_SHOW = 77;
const TILE_CENTER_OFFSET = 0.5;

/** Longest line the chat box accepts. */
const CHAT_INPUT_MAX_CODE_UNITS = 120;
const CHAT_PLACEHOLDER = 'Say something...';
const CHAT_FIELD_MAX_WIDTH = 400;
/** Space kept clear on either side of the chat box on a narrow screen. */
const CHAT_SIDE_MARGIN = 20;
/** Padding above, between and below the box's two rows. */
const BOX_GAPS = 3;
const SEND_KEYS_HINT = '[Enter] send  [Esc] cancel';

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

/**
 * The chat box and the bubble that shows what was said. The box types
 * through a {@link TextEntrySink} and draws what it holds. While that field has focus the
 * scene leaves every key to it; when it has lost focus, the surface's `onKey`
 * types instead and hands focus back, so the world never sees those keys.
 */
export class PlayerChatSystem {
  private onSubmit: ((text: string) => void) | null = null;
  private sink: TextEntrySink | null = null;
  private bubbleText: string | null = null;
  private bubbleTtl = 0;

  get isOpen(): boolean {
    return this.sink !== null;
  }

  /**
   * Opens an empty box; `onSubmit` gets the trimmed line when the player
   * sends one. `canvas` places the hidden field the box types through.
   */
  open(canvas: HTMLCanvasElement, onSubmit: (text: string) => void): void {
    if (this.sink !== null) return;
    const sink = new TextEntrySink({
      maxCodeUnits: CHAT_INPUT_MAX_CODE_UNITS,
      onEnter: () => this.submit(),
      onEscape: () => this.close(),
    });
    this.sink = sink;
    this.onSubmit = onSubmit;
    sink.attach(canvas);
    sink.focus();
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
      isOpen: () => this.isOpen,
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
    const sink = this.sink;
    if (sink === null) return false;
    if (mods.predatesSurface === true) return true;
    if (key === 'Enter') {
      if (mods.repeat !== true) this.submit();
      return true;
    }
    if (key === 'Escape') {
      this.close();
      return true;
    }
    sink.typeKey(key);
    return true;
  }

  /** The box along the bottom of the screen: the typed line over a hint or, on touch, Send and Cancel. */
  renderBox(ui: Ui): void {
    const sink = this.sink;
    if (sink === null) return;
    const { theme, viewport } = ui;
    const { space, palette, type } = theme;
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

    textField(ui, field, { id: 'field', sink, placeholder: CHAT_PLACEHOLDER, active: true });
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
    const typed = this.sink?.value.trim() ?? '';
    const onSubmit = this.onSubmit;
    this.close();
    if (typed !== '' && onSubmit !== null) onSubmit(typed);
  }

  private close(): void {
    this.sink?.dispose();
    this.sink = null;
    this.onSubmit = null;
  }

  showBubble(text: string): void {
    const clusters = graphemes(text);
    this.bubbleText =
      clusters.length > CHAT_TEXT_TRUNCATE_LENGTH
        ? `${clusters.slice(0, CHAT_TEXT_TRUNCATE_SHOW).join('')}...`
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
