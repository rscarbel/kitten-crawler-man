import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { AchievementManager } from '../../core/AchievementManager';
import { IS_MOBILE } from '../../core/MobileDetect';
import { menuBtn, type ButtonRect, type PauseTab } from './types';

export function renderMainTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  human: HumanPlayer,
  cat: CatPlayer,
  setTab: (tab: PauseTab) => void,
  close: () => void,
  humanAchievements?: AchievementManager,
  catAchievements?: AchievementManager,
): void {
  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('PAUSED', bx + bw / 2, by + 34);
  ctx.textAlign = 'left';

  const bW = bw - 40;
  const bX = bx + 20;
  const bH = 40;
  let bY = by + 52;

  menuBtn(ctx, buttons, bX, bY, bW, bH, IS_MOBILE ? 'Resume Game' : 'Resume Game  (Esc)', close);
  bY += 50;
  menuBtn(ctx, buttons, bX, bY, bW, bH, 'Inventory', () => setTab('inventory'));
  bY += 50;
  menuBtn(ctx, buttons, bX, bY, bW, bH, 'Stats', () => setTab('stats'));
  bY += 50;

  const unread = (humanAchievements?.unreadCount ?? 0) + (catAchievements?.unreadCount ?? 0);
  const achLabel = unread > 0 ? `Achievements  (${unread} new)` : 'Achievements';
  menuBtn(
    ctx,
    buttons,
    bX,
    bY,
    bW,
    bH,
    achLabel,
    () => setTab('achievements'),
    unread > 0 ? '#1a2a0a' : '#1e293b',
    unread > 0 ? '#86efac' : '#e2e8f0',
  );
  bY += 50;

  const totalPts = human.unspentPoints + cat.unspentPoints;
  if (totalPts > 0) {
    menuBtn(
      ctx,
      buttons,
      bX,
      bY,
      bW,
      bH,
      `Spend Skill Points  (${totalPts})`,
      () => setTab('spend'),
      '#1e3a5f',
      '#fbbf24',
    );
  }
}
