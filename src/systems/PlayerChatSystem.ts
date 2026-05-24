import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { drawText } from '../ui/TextBox';

const BUBBLE_TTL = 300; // 5 s at 60 fps
const BUBBLE_FADE = 60;
const MAX_BUBBLE_W = 180;

const CHAT_TEXT_TRUNCATE_LENGTH = 80;
const CHAT_TEXT_TRUNCATE_SHOW = 77;
const TILE_CENTER_OFFSET = 0.5;

// Chat input styling
const CHAT_INPUT_MAX_WIDTH = 400;
const CHAT_INPUT_MARGIN_H = 40;
const CHAT_INPUT_BOTTOM_OFFSET = 12;
const CHAT_INPUT_BG_ALPHA = 0.92;
const CHAT_INPUT_BORDER_WIDTH = 1.5;
const CHAT_INPUT_PADDING = 8;
const CHAT_INPUT_PADDING_H = 12;
const CHAT_INPUT_BORDER_RADIUS = 4;
const CHAT_INPUT_FONT_SIZE = 13;
const CHAT_INPUT_MAX_LENGTH = 120;
const CHAT_INPUT_Z_INDEX = 9999;

// Chat bubble styling
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
const CHAT_BUBBLE_BG_ALPHA = 0.9;
const CHAT_BUBBLE_BORDER_ALPHA = 0.45;
const CHAT_BUBBLE_TEXT_Y_OFFSET = 3;
const CHAT_BUBBLE_TEXT_Y_ADJUST = 9;

// Chat hint
const CHAT_HINT_Y_OFFSET = 54;
const CHAT_HINT_Y_MARGIN = 8;
const CHAT_HINT_FONT_SIZE = 10;

export class PlayerChatSystem {
  private _isOpen = false;
  private inputEl: HTMLInputElement | null = null;
  private bubbleText: string | null = null;
  private bubbleTtl = 0;

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(canvas: HTMLCanvasElement, onSubmit: (text: string) => void): void {
    if (this._isOpen) return;
    this._isOpen = true;

    const el = document.createElement('input');
    el.type = 'text';
    el.maxLength = CHAT_INPUT_MAX_LENGTH;
    el.placeholder = 'Say something...';

    const rect = canvas.getBoundingClientRect();
    const inputW = Math.min(CHAT_INPUT_MAX_WIDTH, rect.width - CHAT_INPUT_MARGIN_H);
    Object.assign(el.style, {
      position: 'fixed',
      bottom: `${window.innerHeight - rect.bottom + CHAT_INPUT_BOTTOM_OFFSET}px`,
      left: `${rect.left + rect.width / 2 - inputW / 2}px`,
      width: `${inputW}px`,
      background: `rgba(10,10,12,${CHAT_INPUT_BG_ALPHA})`,
      border: `${CHAT_INPUT_BORDER_WIDTH}px solid #7c3aed`,
      color: '#d4d4e8',
      fontFamily: 'monospace',
      fontSize: `${CHAT_INPUT_FONT_SIZE}px`,
      padding: `${CHAT_INPUT_PADDING}px ${CHAT_INPUT_PADDING_H}px`,
      borderRadius: `${CHAT_INPUT_BORDER_RADIUS}px`,
      outline: 'none',
      zIndex: `${CHAT_INPUT_Z_INDEX}`,
      boxSizing: 'border-box',
    });

    el.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = el.value.trim();
        this.close();
        if (text) onSubmit(text);
      } else if (e.key === 'Escape') {
        this.close();
      }
    });

    document.body.appendChild(el);
    el.focus();
    this.inputEl = el;
  }

  cancel(): void {
    this.close();
  }

  private close(): void {
    this._isOpen = false;
    if (this.inputEl) {
      document.body.removeChild(this.inputEl);
      this.inputEl = null;
    }
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

    ctx.save();
    ctx.font = `${CHAT_BUBBLE_FONT_SIZE}px monospace`;

    const words = this.bubbleText.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > MAX_BUBBLE_W - CHAT_BUBBLE_PADDING * 2 && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    const lineH = CHAT_BUBBLE_LINE_HEIGHT;
    const pad = CHAT_BUBBLE_PADDING;
    const measuredW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const boxW = Math.max(CHAT_BUBBLE_MIN_WIDTH, Math.min(MAX_BUBBLE_W, measuredW + pad * 2));
    const boxH = lines.length * lineH + pad * 2;
    const tailH = CHAT_BUBBLE_POINTER_HEIGHT;

    const bx = Math.round(centerX - boxW / 2);
    const by = Math.round(topY - boxH - tailH - ts * CHAT_BUBBLE_OFFSET_Y_RATIO);
    const tailX = Math.round(centerX);

    ctx.globalAlpha = alpha;

    ctx.fillStyle = `rgba(245,243,255,${CHAT_BUBBLE_BG_ALPHA})`;
    this.traceBubblePath(ctx, bx, by, boxW, boxH, CHAT_BUBBLE_CORNER_RADIUS, tailX, tailH);
    ctx.fill();

    ctx.strokeStyle = `rgba(100,80,180,${CHAT_BUBBLE_BORDER_ALPHA})`;
    ctx.lineWidth = CHAT_BUBBLE_BORDER_WIDTH;
    this.traceBubblePath(ctx, bx, by, boxW, boxH, CHAT_BUBBLE_CORNER_RADIUS, tailX, tailH);
    ctx.stroke();

    drawText(ctx, lines.join('\n'), {
      x: bx + pad,
      y: by + pad + lineH - CHAT_BUBBLE_TEXT_Y_OFFSET - CHAT_BUBBLE_TEXT_Y_ADJUST,
      size: CHAT_BUBBLE_FONT_SIZE,
      color: '#18162a',
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

  renderChatHint(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this._isOpen) return;
    drawText(ctx, '[Enter] send  [Esc] cancel', {
      x: canvas.width / 2,
      y: canvas.height - CHAT_HINT_Y_OFFSET - CHAT_HINT_Y_MARGIN,
      size: CHAT_HINT_FONT_SIZE,
      color: 'rgba(167, 139, 250, 0.75)',
      align: 'center',
    });
  }
}
