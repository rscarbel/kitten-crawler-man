import { type Player } from '../../Player';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { menuBtn, type ButtonRect, type PauseTab } from './types';
import { drawText } from '../TextBox';

export function renderSpendTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  human: HumanPlayer,
  cat: CatPlayer,
  setTab: (tab: PauseTab) => void,
): void {
  drawText(ctx, 'SPEND SKILL POINTS', {
    x: bx + bw / 2,
    y: by + 34 - 13,
    bold: true,
    size: 16,
    color: '#f1f5f9',
    align: 'center',
  });
  drawText(ctx, 'STR increases melee damage, CON increases max HP by 2.', {
    x: bx + 20,
    y: by + 52 - 8,
    size: 10,
    color: '#64748b',
  });
  drawText(ctx, 'Human: EXP increases dynamite damage and throw distance.', {
    x: bx + 20,
    y: by + 64 - 8,
    size: 10,
    color: '#64748b',
  });
  drawText(ctx, 'Cat: INT increases magic damage.', {
    x: bx + 20,
    y: by + 76 - 8,
    size: 10,
    color: '#64748b',
  });

  let oy = by + 92;
  const bW = 76;
  const bH = 32;
  const gap = 10;
  const players: [Player, string][] = [
    [human, 'Human'],
    [cat, 'Cat'],
  ];

  for (const [player, name] of players) {
    if (player.unspentPoints <= 0) continue;
    drawText(
      ctx,
      `${name}  —  ${player.unspentPoints} pt${player.unspentPoints !== 1 ? 's' : ''}`,
      { x: bx + 20, y: oy - 10, bold: true, size: 12, color: '#e2e8f0' },
    );
    oy += 14;
    const totalBW = bW * 3 + gap * 2;
    const startX = bx + (bw - totalBW) / 2;
    const midStat = player instanceof HumanPlayer ? '+EXP' : '+INT';
    menuBtn(ctx, buttons, startX, oy, bW, bH, '+STR', () => player.spendPoint('STR'));
    menuBtn(ctx, buttons, startX + bW + gap, oy, bW, bH, midStat, () =>
      player.spendPoint(player instanceof HumanPlayer ? 'EXP' : 'INT'),
    );
    menuBtn(ctx, buttons, startX + (bW + gap) * 2, oy, bW, bH, '+CON', () =>
      player.spendPoint('CON'),
    );
    oy += bH + 22;
  }

  if (human.unspentPoints <= 0 && cat.unspentPoints <= 0) {
    drawText(ctx, 'No unspent points remaining.', {
      x: bx + bw / 2,
      y: oy + 12 - 10,
      size: 12,
      color: '#475569',
      align: 'center',
    });
    oy += 28;
  }

  menuBtn(ctx, buttons, bx + 20, oy + 8, bw - 40, 36, 'Back', () => setTab('main'));
}
