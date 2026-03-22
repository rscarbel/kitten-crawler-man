import { Player } from '../../Player';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { menuBtn, type ButtonRect, type PauseTab } from './types';

export function renderStatsTab(
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
  ctx.fillText('STATS', bx + bw / 2, by + 34);
  ctx.textAlign = 'left';

  const statLine = (p: Player, startY: number) => {
    ctx.font = '11px monospace';
    ctx.fillStyle = '#e2e8f0';
    const midStat =
      p instanceof HumanPlayer ? `EXP: ${p.explosivesHandling}` : `INT: ${p.intelligence}`;
    ctx.fillText(
      `HP: ${p.hp}/${p.maxHp}   STR: ${p.strength}   ${midStat}   CON: ${p.constitution}`,
      bx + 20,
      startY,
    );
    ctx.fillStyle = '#64748b';
    ctx.fillText(`XP: ${p.xp} / ${p.level * 10}`, bx + 20, startY + 16);
    if (p.unspentPoints > 0) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`Unspent skill pts: ${p.unspentPoints}`, bx + 20, startY + 32);
    }
  };

  ctx.fillStyle = '#93c5fd';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`Human  Lv ${human.level}`, bx + 20, by + 64);
  statLine(human, by + 80);

  ctx.fillStyle = '#fb923c';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`Cat  Lv ${cat.level}`, bx + 20, by + 152);
  statLine(cat, by + 168);

  menuBtn(ctx, buttons, bx + 20, by + 268, bw - 40, 36, 'Back', () => setTab('main'));
}
