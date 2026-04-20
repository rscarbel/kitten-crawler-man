import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';

const BUBBLE_TTL = 300; // 5 s at 60 fps
const BUBBLE_FADE = 60;
const MAX_BUBBLE_W = 180;

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
    el.maxLength = 120;
    el.placeholder = 'Say something...';

    const rect = canvas.getBoundingClientRect();
    const inputW = Math.min(400, rect.width - 40);
    Object.assign(el.style, {
      position: 'fixed',
      bottom: `${window.innerHeight - rect.bottom + 12}px`,
      left: `${rect.left + rect.width / 2 - inputW / 2}px`,
      width: `${inputW}px`,
      background: 'rgba(10,10,12,0.92)',
      border: '1.5px solid #7c3aed',
      color: '#d4d4e8',
      fontFamily: 'monospace',
      fontSize: '13px',
      padding: '8px 12px',
      borderRadius: '4px',
      outline: 'none',
      zIndex: '9999',
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
    this.bubbleText = text.length > 80 ? `${text.slice(0, 77)}...` : text;
    this.bubbleTtl = BUBBLE_TTL;
  }

  update(): void {
    if (this.bubbleTtl > 0) this.bubbleTtl--;
  }

  renderBubble(ctx: CanvasRenderingContext2D, camX: number, camY: number, player: Player): void {
    if (!this.bubbleText || this.bubbleTtl <= 0) return;

    const alpha = this.bubbleTtl < BUBBLE_FADE ? this.bubbleTtl / BUBBLE_FADE : 0.78;
    const ts = TILE_SIZE;
    const centerX = player.x - camX + ts * 0.5;
    const topY = player.y - camY;

    ctx.save();
    ctx.font = '11px monospace';

    const words = this.bubbleText.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > MAX_BUBBLE_W - 16 && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    const lineH = 14;
    const pad = 7;
    const measuredW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const boxW = Math.max(40, Math.min(MAX_BUBBLE_W, measuredW + pad * 2));
    const boxH = lines.length * lineH + pad * 2;
    const tailH = 7;

    const bx = Math.round(centerX - boxW / 2);
    const by = Math.round(topY - boxH - tailH - ts * 0.35);
    const tailX = Math.round(centerX);

    ctx.globalAlpha = alpha;

    ctx.fillStyle = 'rgba(245,243,255,0.9)';
    this.traceBubblePath(ctx, bx, by, boxW, boxH, 5, tailX, tailH);
    ctx.fill();

    ctx.strokeStyle = 'rgba(100,80,180,0.45)';
    ctx.lineWidth = 1;
    this.traceBubblePath(ctx, bx, by, boxW, boxH, 5, tailX, tailH);
    ctx.stroke();

    ctx.fillStyle = '#18162a';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bx + pad, by + pad + (i + 1) * lineH - 3);
    }

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
    const tailLeft = Math.max(bx + r, tailX - 5);
    const tailRight = Math.min(bx + bw - r, tailX + 5);
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
    ctx.save();
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(167, 139, 250, 0.75)';
    ctx.textAlign = 'center';
    ctx.fillText('[Enter] send  [Esc] cancel', canvas.width / 2, canvas.height - 54);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}
