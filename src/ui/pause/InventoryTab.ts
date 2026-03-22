import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { menuBtn, type ButtonRect, type PauseTab } from './types';

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
  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('INVENTORY', bx + bw / 2, by + 34);
  ctx.textAlign = 'left';

  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = '#93c5fd';
  ctx.fillText('Human', bx + 20, by + 72);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px monospace';
  ctx.fillText(`  Health Potions: ${human.healthPotions}`, bx + 20, by + 90);

  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = '#fb923c';
  ctx.fillText('Cat', bx + 20, by + 122);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px monospace';
  ctx.fillText(`  Health Potions: ${cat.healthPotions}`, bx + 20, by + 140);

  menuBtn(ctx, buttons, bx + 20, by + 268, bw - 40, 36, 'Back', () => setTab('main'));
}
