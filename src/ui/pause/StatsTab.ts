import { Player } from '../../Player';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { GameStats } from '../../core/GameStats';
import { menuBtn, type ButtonRect, type PauseTab } from './types';

/** Returns total content height so PauseMenu can clamp scroll. */
export function renderStatsTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  human: HumanPlayer,
  cat: CatPlayer,
  setTab: (tab: PauseTab) => void,
  gameStats?: GameStats,
  scrollY = 0,
): number {
  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('STATS', bx + bw / 2, by + 34);
  ctx.textAlign = 'left';

  const BACK_BTN_H = 52;
  const scrollTop = by + 50;
  const scrollBot = by + bh - BACK_BTN_H;
  const scrollH = scrollBot - scrollTop;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, scrollTop, bw, scrollH);
  ctx.clip();
  ctx.translate(0, scrollTop - scrollY);

  // local y = 0 maps to scrollTop on screen (minus scrollY offset)
  let y = 14;

  const statBlock = (p: Player): number => {
    ctx.font = '11px monospace';
    ctx.fillStyle = '#e2e8f0';
    const midStat =
      p instanceof HumanPlayer ? `EXP: ${p.explosivesHandling}` : `INT: ${p.intelligence}`;
    ctx.fillText(
      `HP: ${p.hp}/${p.maxHp}   STR: ${p.strength}   ${midStat}   CON: ${p.constitution}`,
      bx + 20,
      y,
    );
    y += 16;
    ctx.fillStyle = '#64748b';
    ctx.fillText(`XP: ${p.xp} / ${p.level * 10}`, bx + 20, y);
    y += 16;
    if (p.unspentPoints > 0) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`Unspent skill pts: ${p.unspentPoints}`, bx + 20, y);
      y += 16;
    }
    return y;
  };

  ctx.fillStyle = '#93c5fd';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`Human  Lv ${human.level}`, bx + 20, y);
  y += 16;
  statBlock(human);
  y += 10;

  ctx.fillStyle = '#fb923c';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`Cat  Lv ${cat.level}`, bx + 20, y);
  y += 16;
  statBlock(cat);

  // ── Kill log ─────────────────────────────────────────────────────
  if (gameStats) {
    y += 12;
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + 20, y);
    ctx.lineTo(bx + bw - 20, y);
    ctx.stroke();
    y += 16;

    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText('Total Kills:', bx + 20, y);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(`${gameStats.totalKills}`, bx + 140, y);
    y += 20;

    ctx.fillStyle = '#e2e8f0';
    ctx.fillText('Potions Used:', bx + 20, y);
    ctx.fillStyle = '#86efac';
    ctx.fillText(`${gameStats.potionsUsed}`, bx + 140, y);
    y += 24;

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('BY ENEMY TYPE', bx + 20, y);
    y += 6;

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + 20, y);
    ctx.lineTo(bx + bw - 20, y);
    ctx.stroke();
    y += 14;

    const entries = [...gameStats.killsByType.entries()].sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      ctx.font = '11px monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText('No kills yet', bx + 20, y);
      y += 17;
    } else {
      ctx.font = '12px monospace';
      for (const [name, count] of entries) {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(name, bx + 24, y);
        ctx.fillStyle = '#fbbf24';
        ctx.textAlign = 'right';
        ctx.fillText(`${count}`, bx + bw - 24, y);
        ctx.textAlign = 'left';
        y += 17;
      }
    }
    y += 4;
  }

  const contentHeight = y;
  ctx.restore();

  // Scrollbar
  if (contentHeight > scrollH) {
    const thumbH = Math.max(20, (scrollH / contentHeight) * scrollH);
    const maxScroll = contentHeight - scrollH;
    const thumbY = scrollTop + (scrollY / maxScroll) * (scrollH - thumbH);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(bx + bw - 7, scrollTop, 3, scrollH);
    ctx.fillStyle = '#64748b';
    ctx.fillRect(bx + bw - 7, thumbY, 3, thumbH);
  }

  menuBtn(ctx, buttons, bx + 20, by + bh - BACK_BTN_H + 8, bw - 40, 36, 'Back', () =>
    setTab('main'),
  );

  return contentHeight;
}
