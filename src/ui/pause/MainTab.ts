import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { AchievementManager } from '../../core/AchievementManager';
import { platform } from '../../core/Platform';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
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

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: platform.resumeButtonLabel,
    ...BUTTON_PRESETS.primary,
    action: close,
  });
  bY += 50;
  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Inventory',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('inventory'),
  });
  bY += 50;
  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Stats',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('stats'),
  });
  bY += 50;

  const unread = (humanAchievements?.unreadCount ?? 0) + (catAchievements?.unreadCount ?? 0);
  const achLabel = unread > 0 ? `Achievements  (${unread} new)` : 'Achievements';
  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: achLabel,
    ...BUTTON_PRESETS.primary,
    ...(unread > 0 ? { fill: '#1a2a0a', labelColor: '#86efac' } : {}),
    action: () => setTab('achievements'),
  });
  bY += 50;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Abilities',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('abilities'),
  });
  bY += 50;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Settings',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('settings'),
  });
  bY += 50;

  const totalPts = human.unspentPoints + cat.unspentPoints;
  if (totalPts > 0) {
    addButton(ctx, buttons, {
      x: bX,
      y: bY,
      width: bW,
      height: bH,
      label: `Spend Skill Points  (${totalPts})`,
      ...BUTTON_PRESETS.primary,
      fill: '#1e3a5f',
      labelColor: '#fbbf24',
      action: () => setTab('spend'),
    });
  }
}
