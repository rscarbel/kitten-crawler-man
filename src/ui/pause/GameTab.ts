/**
 * The Game tab: everything that describes the run rather than acting on it —
 * the Journal, the stat sheet, abilities, achievements and skills.
 *
 * Its reason for existing is the phone. The main tab had grown to eight
 * full-width buttons, which on a short viewport compresses every one of them
 * toward the minimum legible height; folding the five read-only screens behind
 * one entry gives both levels room to breathe.
 */

import type { AchievementManager } from '../../core/AchievementManager';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';

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
/** Equipment, Stats, Abilities, Achievements, Skills, Back. */
const BUTTON_COUNT_NO_JOURNAL = 6;
/** Plus the Quest Journal button, which only the town floors onward have. */
const BUTTON_COUNT_WITH_JOURNAL = BUTTON_COUNT_NO_JOURNAL + 1;
/** Buttons stay legible even when the pitch is compressed to fit a short window. */
const MIN_BUTTON_HEIGHT = 26;

/** Height this tab wants, so `PauseMenu` can size the modal around it. */
export function gameTabHeight(hasQuestJournal: boolean): number {
  const buttonCount = hasQuestJournal ? BUTTON_COUNT_WITH_JOURNAL : BUTTON_COUNT_NO_JOURNAL;
  return FIRST_BUTTON_Y + buttonCount * BUTTON_SPACING + BOTTOM_MARGIN;
}

export function renderGameTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  setTab: (tab: PauseTab) => void,
  hasQuestJournal: boolean,
  outstandingQuests: number,
  humanAchievements?: AchievementManager,
  catAchievements?: AchievementManager,
): void {
  drawText(ctx, 'GAME', {
    x: bx + bw / 2,
    y: by + TITLE_Y - TITLE_Y_ADJUST,
    bold: true,
    size: TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  const bW = bw - BUTTON_WIDTH_MARGIN;
  const bX = bx + BUTTON_X_OFFSET;

  const buttonCount = hasQuestJournal ? BUTTON_COUNT_WITH_JOURNAL : BUTTON_COUNT_NO_JOURNAL;
  const availableH = bh - FIRST_BUTTON_Y - BOTTOM_MARGIN;
  const spacing = Math.min(BUTTON_SPACING, availableH / buttonCount);
  const bH = Math.max(
    MIN_BUTTON_HEIGHT,
    Math.min(BUTTON_HEIGHT, spacing - (BUTTON_SPACING - BUTTON_HEIGHT)),
  );
  let bY = by + FIRST_BUTTON_Y;

  if (hasQuestJournal) {
    const journalLabel =
      outstandingQuests > 0 ? `Quest Journal  (${outstandingQuests})` : 'Quest Journal';
    addButton(ctx, buttons, {
      x: bX,
      y: bY,
      width: bW,
      height: bH,
      label: journalLabel,
      ...BUTTON_PRESETS.primary,
      ...(outstandingQuests > 0 ? { fill: '#1e3a5f', labelColor: '#7dd3fc' } : {}),
      action: () => setTab('journal'),
    });
    bY += spacing;
  }

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Equipment',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('equipment'),
  });
  bY += spacing;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Stats',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('stats'),
  });
  bY += spacing;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Abilities',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('abilities'),
  });
  bY += spacing;

  const unread =
    (humanAchievements?.menuUnseenCount ?? 0) + (catAchievements?.menuUnseenCount ?? 0);
  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: unread > 0 ? `Achievements  (${unread} new)` : 'Achievements',
    ...BUTTON_PRESETS.primary,
    ...(unread > 0 ? { fill: '#1a2a0a', labelColor: '#86efac' } : {}),
    action: () => setTab('achievements'),
  });
  bY += spacing;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Skills',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('skills'),
  });
  bY += spacing;

  addButton(ctx, buttons, {
    x: bX,
    y: bY,
    width: bW,
    height: bH,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: () => setTab('main'),
  });
}
