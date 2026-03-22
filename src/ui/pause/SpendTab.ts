import { Player } from '../../Player';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { menuBtn, type ButtonRect, type PauseTab } from './types';

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
  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SPEND SKILL POINTS', bx + bw / 2, by + 34);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748b';
  ctx.font = '10px monospace';
  ctx.fillText('STR increases melee damage, CON increases max HP by 2.', bx + 20, by + 52);
  ctx.fillText('Human: EXP increases dynamite damage and throw distance.', bx + 20, by + 64);
  ctx.fillText('Cat: INT increases magic damage.', bx + 20, by + 76);

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
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(
      `${name}  —  ${player.unspentPoints} pt${player.unspentPoints !== 1 ? 's' : ''}`,
      bx + 20,
      oy,
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
    ctx.fillStyle = '#475569';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No unspent points remaining.', bx + bw / 2, oy + 12);
    ctx.textAlign = 'left';
    oy += 28;
  }

  menuBtn(ctx, buttons, bx + 20, oy + 8, bw - 40, 36, 'Back', () => setTab('main'));
}
