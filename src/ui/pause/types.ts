import { drawText } from '../TextBox';
import { drawBox } from '../Box';

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
  drawBox(ctx, { x, y, width: w, height: h, fill: bg, border: '#334155', borderWidth: 1.5 });
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
