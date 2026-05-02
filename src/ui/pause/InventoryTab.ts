import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { menuBtn, type ButtonRect, type PauseTab } from './types';
import { drawText } from '../TextBox';

export function renderInventoryTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  human: HumanPlayer,
  cat: CatPlayer,
  setTab: (tab: PauseTab) => void,
): void {
  drawText(ctx, 'INVENTORY', {
    x: bx + bw / 2,
    y: by + 34 - 13,
    bold: true,
    size: 16,
    color: '#f1f5f9',
    align: 'center',
  });

  drawText(ctx, 'Human', { x: bx + 20, y: by + 72 - 10, bold: true, size: 12, color: '#93c5fd' });
  drawText(ctx, `  Health Potions: ${human.healthPotions}`, {
    x: bx + 20,
    y: by + 90 - 9,
    size: 11,
    color: '#e2e8f0',
  });

  drawText(ctx, 'Cat', { x: bx + 20, y: by + 122 - 10, bold: true, size: 12, color: '#fb923c' });
  drawText(ctx, `  Health Potions: ${cat.healthPotions}`, {
    x: bx + 20,
    y: by + 140 - 9,
    size: 11,
    color: '#e2e8f0',
  });

  menuBtn(ctx, buttons, bx + 20, by + 268, bw - 40, 36, 'Back', () => setTab('main'));
}
