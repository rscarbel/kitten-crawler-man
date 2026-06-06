// Renders transient System AI messages using the shared DialogBox component.
import { drawText } from '../ui/TextBox';
import { DialogBox } from '../ui/DialogBox';
import type { AudioManager } from '../audio/AudioManager';

interface AIMessage {
  text: string;
  ttl: number;
}

const MIN_DISPLAY_TICKS = 560;
const TICKS_PER_WORD = 15; // ~4 words/sec reading pace at 60fps
const FADE_TICKS = 60;

const ACTION_DISPLAY_TICKS = 210; // 3.5 seconds at 60 fps
const ACTION_FADE_TICKS = 45;

const MAX_ACTIONNOTIFS = 3;
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
  private _dialogBox: DialogBox | null = null;

  /** Wire in audio to enable the DialogBox typing animation for incoming messages. */
  setAudio(audio: AudioManager): void {
    this._dialogBox = new DialogBox(audio, {
      speakerName: '⚙ System AI',
      revealMode: 'sentence',
      showFooterHint: false,
    });
  }

  add(text: string): void {
    const ttl = calcTtl(text);
    // New message immediately replaces any existing ones
    this.messages = [{ text, ttl }];
    this._dialogBox?.show(text);
  }

  addAction(text: string): void {
    this.actionNotifs.push({ text, ttl: ACTION_DISPLAY_TICKS });
    if (this.actionNotifs.length > MAX_ACTIONNOTIFS) {
      this.actionNotifs.shift();
    }
  }

  update(): void {
    this.messages = this.messages.filter((m) => {
      m.ttl--;
      return m.ttl > 0;
    });
    if (this.messages.length === 0) {
      this._dialogBox?.hide();
    }
    this._dialogBox?.update();
    this.actionNotifs = this.actionNotifs.filter((m) => {
      m.ttl--;
      return m.ttl > 0;
    });
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const lastMsg = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
    const alpha = lastMsg !== null && lastMsg.ttl < FADE_TICKS ? lastMsg.ttl / FADE_TICKS : 1;
    this._dialogBox?.render(ctx, canvas, alpha);

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
