// Renders transient System AI messages as an overlay banner near the top of the screen.

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
    if (this.actionNotifs.length > 3) {
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

    const maxW = Math.min(canvas.width - 48, 680);
    const padding = 14;
    const fontSize = 13;

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

    const lineH = fontSize + 5;
    const labelH = 18;
    const by = 14;
    const maxBoxH = canvas.height - by - 20;
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
    ctx.globalAlpha = alpha * 0.93;
    ctx.fillStyle = '#0a0a0c';
    roundRect(ctx, bx, by, boxW, boxH, 5);
    ctx.fill();

    // Border — purple glow
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = alpha * 0.8;
    roundRect(ctx, bx, by, boxW, boxH, 5);
    ctx.stroke();

    // Clip all text to the box interior
    roundRect(ctx, bx, by, boxW, boxH, 5);
    ctx.clip();

    const scrolled = msg.scrollY;

    // "⚙ SYSTEM" label
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#a78bfa';
    ctx.font = `bold 10px monospace`;
    ctx.fillText('⚙ SYSTEM AI', bx + padding, by + padding + 4 - scrolled);

    // Separator line
    ctx.strokeStyle = '#3b1d7a';
    ctx.lineWidth = 1;
    ctx.globalAlpha = alpha * 0.5;
    ctx.beginPath();
    ctx.moveTo(bx + padding, by + padding + labelH - 2 - scrolled);
    ctx.lineTo(bx + boxW - padding, by + padding + labelH - 2 - scrolled);
    ctx.stroke();

    // Message body
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#d4d4e8';
    ctx.font = `${fontSize}px monospace`;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(
        lines[i],
        bx + padding,
        by + padding + labelH + i * lineH + fontSize - 1 - scrolled,
      );
    }

    ctx.restore();

    // Action notifications — bottom of screen
    if (this.actionNotifs.length > 0) {
      const notif = this.actionNotifs[this.actionNotifs.length - 1];
      const alpha = notif.ttl < ACTION_FADE_TICKS ? notif.ttl / ACTION_FADE_TICKS : 1;
      const pad = 8;
      const fsize = 11;
      ctx.save();
      ctx.font = `${fsize}px monospace`;
      const label = '⚙ System AI';
      const labelW = ctx.measureText(label).width;
      const textW = ctx.measureText(notif.text).width;
      const pillW = pad * 2 + labelW + 8 + textW;
      const pillH = fsize + pad * 2;
      const px = Math.round((canvas.width - pillW) / 2);
      const py = canvas.height - pillH - 16;

      ctx.globalAlpha = alpha * 0.88;
      ctx.fillStyle = '#0a0a0c';
      roundRect(ctx, px, py, pillW, pillH, pillH / 2);
      ctx.fill();

      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha * 0.7;
      roundRect(ctx, px, py, pillW, pillH, pillH / 2);
      ctx.stroke();

      ctx.globalAlpha = alpha;
      const ty = py + pad + fsize - 1;
      ctx.fillStyle = '#fbbf24';
      ctx.font = `bold ${fsize}px monospace`;
      ctx.fillText(label, px + pad, ty);

      ctx.fillStyle = '#e5e5e5';
      ctx.font = `${fsize}px monospace`;
      ctx.fillText(notif.text, px + pad + labelW + 8, ty);

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
