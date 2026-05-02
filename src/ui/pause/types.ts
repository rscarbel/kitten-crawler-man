import { drawText } from '../TextBox';

export type PauseTab = 'main' | 'inventory' | 'stats' | 'spend' | 'achievements' | 'abilities';

export type ButtonRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
};

/**
 * Draws a standard menu button and pushes its hit-rect into the provided array.
 */
export function menuBtn(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  action: () => void,
  bg = '#1e293b',
  fg = '#e2e8f0',
): void {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  drawText(ctx, label, {
    x: x + w / 2,
    y: y + h / 2 + 5 - 10,
    bold: true,
    size: 13,
    color: fg,
    align: 'center',
  });
  buttons.push({ x, y, w, h, action });
}
