import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { AchievementManager } from '../../core/AchievementManager';
import { platform } from '../../core/Platform';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';

// Main tab layout
const TITLE_Y = 34;
const TITLE_Y_ADJUST = 14;
const TITLE_SIZE = 18;
const BUTTON_WIDTH_MARGIN = 40;
const BUTTON_X_OFFSET = 20;
const BUTTON_HEIGHT = 40;
const FIRST_BUTTON_Y = 52;
const BUTTON_SPACING = 50;

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
    y: by + TITLE_Y - TITLE_Y_ADJUST,
    bold: true,
    size: TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  const bW = bw - BUTTON_WIDTH_MARGIN;
  const bX = bx + BUTTON_X_OFFSET;
  const bH = BUTTON_HEIGHT;
  let bY = by + FIRST_BUTTON_Y;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: platform.resumeButtonLabel,
    ...BUTTON_PRESETS.primary,
    action: close,
  });
  bY += BUTTON_SPACING;
  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Inventory',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('inventory'),
  });
  bY += BUTTON_SPACING;
  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Stats',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('stats'),
  });
  bY += BUTTON_SPACING;

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
  bY += BUTTON_SPACING;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Abilities',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('abilities'),
  });
  bY += BUTTON_SPACING;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Settings',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('settings'),
  });
  bY += BUTTON_SPACING;

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
