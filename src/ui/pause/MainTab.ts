import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { AchievementManager } from '../../core/AchievementManager';
import { platform } from '../../core/Platform';
import { menuBtn, type ButtonRect, type PauseTab } from './types';
import { drawText } from '../TextBox';

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
  drawText(ctx, 'PAUSED', {
    x: bx + bw / 2,
    y: by + 34 - 14,
    bold: true,
    size: 18,
    color: '#f1f5f9',
    align: 'center',
  });

  const bW = bw - 40;
  const bX = bx + 20;
  const bH = 40;
  let bY = by + 52;

  menuBtn(ctx, buttons, bX, bY, bW, bH, platform.resumeButtonLabel, close);
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

  menuBtn(ctx, buttons, bX, bY, bW, bH, 'Abilities', () => setTab('abilities'));
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
