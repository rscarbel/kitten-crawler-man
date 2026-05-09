import type { Player } from '../../Player';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { GameStats } from '../../core/GameStats';
import { menuBtn, type ButtonRect, type PauseTab } from './types';
import { drawText } from '../TextBox';
import { drawDivider, drawScrollbar } from '../Box';

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
  drawText(ctx, 'STATS', {
    x: bx + bw / 2,
    y: by + 34 - 13,
    bold: true,
    size: 16,
    color: '#f1f5f9',
    align: 'center',
  });

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
    const midStat =
      p instanceof HumanPlayer ? `EXP: ${p.explosivesHandling}` : `INT: ${p.intelligence}`;
    drawText(
      ctx,
      `HP: ${p.hp}/${p.maxHp}   STR: ${p.strength}   ${midStat}   CON: ${p.constitution}`,
      { x: bx + 20, y: y - 9, size: 11, color: '#e2e8f0' },
    );
    y += 16;
    drawText(ctx, `XP: ${p.xp} / ${p.level * 10}`, {
      x: bx + 20,
      y: y - 9,
      size: 11,
      color: '#64748b',
    });
    y += 16;
    if (p.unspentPoints > 0) {
      drawText(ctx, `Unspent skill pts: ${p.unspentPoints}`, {
        x: bx + 20,
        y: y - 9,
        size: 11,
        color: '#fbbf24',
      });
      y += 16;
    }
    return y;
  };

  drawText(ctx, `Human  Lv ${human.level}`, {
    x: bx + 20,
    y: y - 10,
    bold: true,
    size: 12,
    color: '#93c5fd',
  });
  y += 16;
  statBlock(human);
  y += 10;

  drawText(ctx, `Cat  Lv ${cat.level}`, {
    x: bx + 20,
    y: y - 10,
    bold: true,
    size: 12,
    color: '#fb923c',
  });
  y += 16;
  statBlock(cat);

  if (gameStats) {
    y += 12;
    drawDivider(ctx, { x: bx + 20, y, length: bw - 40 });
    y += 16;

    drawText(ctx, 'Total Kills:', {
      x: bx + 20,
      y: y - 10,
      bold: true,
      size: 13,
      color: '#e2e8f0',
    });
    drawText(ctx, `${gameStats.totalKills}`, {
      x: bx + 140,
      y: y - 10,
      bold: true,
      size: 13,
      color: '#fbbf24',
    });
    y += 20;

    drawText(ctx, 'Potions Used:', {
      x: bx + 20,
      y: y - 10,
      bold: true,
      size: 13,
      color: '#e2e8f0',
    });
    drawText(ctx, `${gameStats.potionsUsed}`, {
      x: bx + 140,
      y: y - 10,
      bold: true,
      size: 13,
      color: '#86efac',
    });
    y += 24;

    drawText(ctx, 'ENEMIES KILLED', {
      x: bx + 20,
      y: y - 9,
      bold: true,
      size: 11,
      color: '#94a3b8',
    });
    y += 6;

    drawDivider(ctx, { x: bx + 20, y, length: bw - 40 });
    y += 14;

    const entries = [...gameStats.killsByType.entries()].sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      drawText(ctx, 'No kills yet', { x: bx + 20, y: y - 9, size: 11, color: '#64748b' });
      y += 17;
    } else {
      for (const [name, count] of entries) {
        drawText(ctx, name, { x: bx + 24, y: y - 10, size: 12, color: '#cbd5e1' });
        drawText(ctx, `${count}`, {
          x: bx + bw - 24,
          y: y - 10,
          size: 12,
          color: '#fbbf24',
          align: 'right',
        });
        y += 17;
      }
    }
    y += 4;
  }

  const contentHeight = y;
  ctx.restore();

  // Scrollbar
  drawScrollbar(ctx, {
    x: bx + bw - 7,
    trackY: scrollTop,
    trackH: scrollH,
    contentH: contentHeight,
    scrollY,
    width: 3,
  });

  menuBtn(ctx, buttons, bx + 20, by + bh - BACK_BTN_H + 8, bw - 40, 36, 'Back', () =>
    setTab('main'),
  );

  return contentHeight;
}
