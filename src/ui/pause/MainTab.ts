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
/** Gap between the last button and the bottom of the modal. */
const BOTTOM_MARGIN = 12;
/** Buttons always present, in render order: Resume, Inventory, Game, Settings. */
const BUTTON_COUNT_NO_SPEND = 4;
/** Plus the conditional Spend Skill Points button. */
const BUTTON_COUNT_WITH_SPEND = BUTTON_COUNT_NO_SPEND + 1;
/** Buttons stay legible even when the pitch is compressed to fit a short window. */
const MIN_BUTTON_HEIGHT = 26;

/**
 * Height this tab wants, so `PauseMenu` can size the modal around it. Derived
 * from the same constants the layout uses, so the two can't drift apart.
 */
export function mainTabHeight(hasSpendButton: boolean): number {
  const buttonCount = hasSpendButton ? BUTTON_COUNT_WITH_SPEND : BUTTON_COUNT_NO_SPEND;
  return FIRST_BUTTON_Y + buttonCount * BUTTON_SPACING + BOTTOM_MARGIN;
}

export function renderMainTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
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

  // The modal is clamped to the window, so on a short viewport — a phone in
  // landscape, a small desktop window — the full-pitch column would run off the
  // bottom of its own backdrop. Compress the pitch to fit instead.
  const hasSpendButton = human.unspentPoints + cat.unspentPoints > 0;
  const buttonCount = hasSpendButton ? BUTTON_COUNT_WITH_SPEND : BUTTON_COUNT_NO_SPEND;
  const availableH = bh - FIRST_BUTTON_Y - BOTTOM_MARGIN;
  const spacing = Math.min(BUTTON_SPACING, availableH / buttonCount);
  const bH = Math.max(
    MIN_BUTTON_HEIGHT,
    Math.min(BUTTON_HEIGHT, spacing - (BUTTON_SPACING - BUTTON_HEIGHT)),
  );
  let bY = by + FIRST_BUTTON_Y;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: platform.resumeButtonLabel,
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: close,
  });
  bY += spacing;
  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Inventory',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('inventory'),
  });
  bY += spacing;

  const unread = (humanAchievements?.unreadCount ?? 0) + (catAchievements?.unreadCount ?? 0);
  const gameLabel = unread > 0 ? `Game  (${unread} new)` : 'Game';
  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: gameLabel,
    ...BUTTON_PRESETS.primary,
    ...(unread > 0 ? { fill: '#1a2a0a', labelColor: '#86efac' } : {}),
    action: () => setTab('game'),
  });
  bY += spacing;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Settings',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('settings'),
  });
  bY += spacing;

  if (hasSpendButton) {
    const totalPts = human.unspentPoints + cat.unspentPoints;
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
