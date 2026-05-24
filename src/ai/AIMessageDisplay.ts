// Renders transient System AI messages as an overlay banner near the top of the screen.
import { drawText } from '../ui/TextBox';

interface AIMessage {
  text: string;
  ttl: number;
  maxTtl: number;
  scrollY: number;
}

const MIN_DISPLAY_TICKS = 560;
const TICKS_PER_WORD = 15; // ~4 words/sec reading pace at 60fps
const FADE_TICKS = 90;
const SCROLL_DELAY = 90; // ticks before auto-scroll starts
const SCROLL_SPEED = 0.6; // px per tick

const ACTION_DISPLAY_TICKS = 210; // 3.5 seconds at 60 fps
const ACTION_FADE_TICKS = 45;

const MAX_ACTIONNOTIFS = 3;
const MAX_BOX_WIDTH = 680;
const BOX_PADDING = 14;
const FONT_SIZE = 13;
const LINE_HEIGHT = 5;
const BOX_Y = 14;
const BOX_MIN_HEIGHT = 20;
const LABEL_HEIGHT = 18;
const BOX_ALPHA_BACKGROUND = 0.93;
const BORDER_RADIUS = 5;
const BORDER_ALPHA = 0.8;
const BORDER_WIDTH = 1.5;
const SCROLL_START_DELAY_PX = 4;
const LABEL_PADDING_BOTTOM = 2;
const SEPARATOR_LINE_ALPHA = 0.5;
const PADDING_BOTTOM = 20;
const ACTION_PADDING = 8;
const ACTION_FONT_SIZE = 11;
const ACTION_ALPHA_BACKGROUND = 0.88;
const ACTION_BORDER_WIDTH = 1;
const ACTION_BORDER_ALPHA = 0.7;
const ACTION_TEXT_Y_BASELINE_OFFSET = 1;
const ACTION_TEXT_TOP_OFFSET = 9;
const ACTION_TEXT_LABEL_GAP = 8;

function calcTtl(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(MIN_DISPLAY_TICKS, words * TICKS_PER_WORD);
}

export class AIMessageDisplay {
  private messages: AIMessage[] = [];
  private actionNotifs: AIMessage[] = [];

  add(text: string): void {
    const ttl = calcTtl(text);
    // New message immediately replaces any existing ones
    this.messages = [{ text, ttl, maxTtl: ttl, scrollY: 0 }];
  }

  addAction(text: string): void {
    this.actionNotifs.push({
      text,
      ttl: ACTION_DISPLAY_TICKS,
      maxTtl: ACTION_DISPLAY_TICKS,
      scrollY: 0,
    });
    if (this.actionNotifs.length > MAX_ACTIONNOTIFS) {
      this.actionNotifs.shift();
    }
  }

  update(): void {
    this.messages = this.messages.filter((m) => {
      m.ttl--;
      return m.ttl > 0;
    });
    this.actionNotifs = this.actionNotifs.filter((m) => {
      m.ttl--;
      return m.ttl > 0;
    });
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (this.messages.length === 0) return;

    const msg = this.messages[this.messages.length - 1];
    const alpha = msg.ttl < FADE_TICKS ? msg.ttl / FADE_TICKS : 1;

    const maxW = Math.min(canvas.width - BOX_PADDING * 2, MAX_BOX_WIDTH);
    const padding = BOX_PADDING;
    const fontSize = FONT_SIZE;

    ctx.save();
    ctx.font = `${fontSize}px monospace`;

    // Word-wrap the message text
    const words = msg.text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW - padding * 2) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    const lineH = fontSize + LINE_HEIGHT;
    const labelH = LABEL_HEIGHT;
    const by = BOX_Y;
    const maxBoxH = canvas.height - by - BOX_MIN_HEIGHT;
    const fullContentH = labelH + lines.length * lineH + padding * 2;
    const boxH = Math.min(fullContentH, maxBoxH);
    const boxW = maxW;
    const bx = Math.round((canvas.width - boxW) / 2);

    // Advance scroll if content overflows the box
    const overflow = fullContentH - boxH;
    if (overflow > 0 && msg.maxTtl - msg.ttl > SCROLL_DELAY) {
      msg.scrollY = Math.min(msg.scrollY + SCROLL_SPEED, overflow);
    }

    // Background
    ctx.globalAlpha = alpha * BOX_ALPHA_BACKGROUND;
    ctx.fillStyle = '#0a0a0c';
    roundRect(ctx, bx, by, boxW, boxH, BORDER_RADIUS);
    ctx.fill();

    // Border — purple glow
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = BORDER_WIDTH;
    ctx.globalAlpha = alpha * BORDER_ALPHA;
    roundRect(ctx, bx, by, boxW, boxH, BORDER_RADIUS);
    ctx.stroke();

    // Clip all text to the box interior
    roundRect(ctx, bx, by, boxW, boxH, BORDER_RADIUS);
    ctx.clip();

    const scrolled = msg.scrollY;

    // "⚙ SYSTEM" label
    // baseline was by + padding + 4 - scrolled; top = baseline - round(10 * 0.8) = baseline - 8
    drawText(ctx, '⚙ SYSTEM AI', {
      x: bx + padding,
      y: by + padding + SCROLL_START_DELAY_PX - scrolled - ACTION_TEXT_TOP_OFFSET,
      size: 10,
      bold: true,
      color: '#a78bfa',
      alpha,
    });

    // Separator line
    ctx.strokeStyle = '#3b1d7a';
    ctx.lineWidth = 1;
    ctx.globalAlpha = alpha * SEPARATOR_LINE_ALPHA;
    ctx.beginPath();
    ctx.moveTo(bx + padding, by + padding + labelH - LABEL_PADDING_BOTTOM - scrolled);
    ctx.lineTo(bx + boxW - padding, by + padding + labelH - LABEL_PADDING_BOTTOM - scrolled);
    ctx.stroke();

    // Message body
    // baseline was by + padding + labelH + i * lineH + fontSize - 1 - scrolled
    // top = baseline - round(fontSize * 0.8) = baseline - 10 (fontSize=13)
    for (let i = 0; i < lines.length; i++) {
      const baselineY =
        by + padding + labelH + i * lineH + fontSize - ACTION_TEXT_Y_BASELINE_OFFSET - scrolled;
      drawText(ctx, lines[i], {
        x: bx + padding,
        y: baselineY - ACTION_TEXT_TOP_OFFSET,
        size: fontSize,
        color: '#d4d4e8',
        alpha,
      });
    }

    ctx.restore();

    // Action notifications — bottom of screen
    if (this.actionNotifs.length > 0) {
      const notif = this.actionNotifs[this.actionNotifs.length - 1];
      const actionAlpha = notif.ttl < ACTION_FADE_TICKS ? notif.ttl / ACTION_FADE_TICKS : 1;
      const pad = ACTION_PADDING;
      const fsize = ACTION_FONT_SIZE;
      ctx.save();
      ctx.font = `${fsize}px monospace`;
      const label = '⚙ System AI';
      const labelW = ctx.measureText(label).width;
      const textW = ctx.measureText(notif.text).width;
      const pillW = pad * 2 + labelW + ACTION_TEXT_LABEL_GAP + textW;
      const pillH = fsize + pad * 2;
      const px = Math.round((canvas.width - pillW) / 2);
      const py = canvas.height - pillH - PADDING_BOTTOM;

      ctx.globalAlpha = actionAlpha * ACTION_ALPHA_BACKGROUND;
      ctx.fillStyle = '#0a0a0c';
      roundRect(ctx, px, py, pillW, pillH, pillH / 2);
      ctx.fill();

      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = ACTION_BORDER_WIDTH;
      ctx.globalAlpha = actionAlpha * ACTION_BORDER_ALPHA;
      roundRect(ctx, px, py, pillW, pillH, pillH / 2);
      ctx.stroke();

      // baseline was ty = py + pad + fsize - 1; top = baseline - round(11 * 0.8) = baseline - 9
      const ty = py + pad + fsize - ACTION_TEXT_Y_BASELINE_OFFSET;
      drawText(ctx, label, {
        x: px + pad,
        y: ty - ACTION_TEXT_TOP_OFFSET,
        size: fsize,
        bold: true,
        color: '#fbbf24',
        alpha: actionAlpha,
      });

      drawText(ctx, notif.text, {
        x: px + pad + labelW + ACTION_TEXT_LABEL_GAP,
        y: ty - ACTION_TEXT_TOP_OFFSET,
        size: fsize,
        color: '#e5e5e5',
        alpha: actionAlpha,
      });

      ctx.restore();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
