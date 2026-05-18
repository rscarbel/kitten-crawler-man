import type { AchievementManager } from '../../core/AchievementManager';
import { ACHIEVEMENT_DEFS, isAchievementId } from '../../core/AchievementManager';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText, TEXT_PRESETS } from '../TextBox';
import { drawBox, drawDivider } from '../Box';

function tierColor(tier: string): string {
  switch (tier) {
    case 'Bronze':
      return '#cd7f32';
    case 'Silver':
      return '#c0c0c0';
    case 'Gold':
      return '#ffd700';
    case 'Legendary':
      return '#a855f7';
    case 'Celestial':
      return '#38bdf8';
    default:
      return '#e2e8f0';
  }
}

function renderPlayerAchievements(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  bw: number,
  startY: number,
  label: string,
  labelColor: string,
  manager: AchievementManager | undefined,
  playerTarget: 'human' | 'cat',
  inSafeRoom: boolean,
  onOpenBoxes?: () => void,
): void {
  drawText(ctx, label, {
    x: bx + 16,
    y: startY + 12 - 10,
    bold: true,
    size: 12,
    color: labelColor,
  });
  let oy = startY + 20;

  const relevant = Object.keys(ACHIEVEMENT_DEFS)
    .filter(isAchievementId)
    .filter((id) => {
      const pt = ACHIEVEMENT_DEFS[id].playerType;
      if (pt !== 'both' && pt !== playerTarget) return false;
      return manager?.isUnlocked(id) ?? false;
    });

  if (relevant.length === 0) {
    drawText(ctx, 'No achievements yet...', {
      x: bx + 18,
      y: oy + 13 - 8,
      size: 10,
      color: '#374151',
    });
    oy += 20;
  }

  for (const id of relevant) {
    const def = ACHIEVEMENT_DEFS[id];

    drawBox(ctx, { x: bx + 12, y: oy, width: bw - 24, height: 18, fill: 'rgba(250,204,21,0.06)' });

    drawText(ctx, '✓', { x: bx + 18, y: oy + 13 - 9, size: 11, color: '#4ade80' });
    const tierReserve = def.lootBox ? 110 : 0;
    drawText(ctx, def.name, {
      x: bx + 32,
      y: oy + 13 - 8,
      bold: true,
      size: 10,
      color: '#f1f5f9',
      width: bw - 46 - tierReserve,
      height: 18,
    });

    if (def.lootBox) {
      drawText(ctx, `${def.lootBox.tier} ${def.lootBox.category}`, {
        x: bx + bw - 14,
        y: oy + 13 - 7,
        bold: true,
        size: 9,
        color: tierColor(def.lootBox.tier),
        align: 'right',
      });
    }

    oy += 20;
  }

  const boxCount = manager?.pendingBoxes.length ?? 0;
  if (boxCount > 0) {
    drawText(ctx, `Unopened boxes: ${boxCount}`, {
      x: bx + 18,
      y: oy + 10 - 8,
      ...TEXT_PRESETS.hint,
    });

    if (onOpenBoxes) {
      const btnW = 100;
      const btnX = bx + bw - 20 - btnW;
      addButton(ctx, buttons, {
        x: btnX,
        y: oy,
        width: btnW,
        height: 22,
        label: 'Open Boxes',
        ...BUTTON_PRESETS.success,
        labelSize: 10,
        action: onOpenBoxes,
      });
    } else if (!inSafeRoom) {
      drawText(ctx, '(safe room only)', { x: bx + 140, y: oy + 10 - 7, size: 9, color: '#374151' });
    }
  }
}

export function renderAchievementsTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  setTab: (tab: PauseTab) => void,
  humanAchievements: AchievementManager | undefined,
  catAchievements: AchievementManager | undefined,
  inSafeRoom: boolean,
  onOpenHumanBoxes?: () => void,
  onOpenCatBoxes?: () => void,
): void {
  drawText(ctx, 'ACHIEVEMENTS', {
    x: bx + bw / 2,
    y: by + 28 - 13,
    bold: true,
    size: 16,
    color: '#f1f5f9',
    align: 'center',
  });

  let oy = by + 42;

  renderPlayerAchievements(
    ctx,
    buttons,
    bx,
    bw,
    oy,
    '👤 Human',
    '#93c5fd',
    humanAchievements,
    'human',
    inSafeRoom,
    onOpenHumanBoxes,
  );

  oy += 130;

  drawDivider(ctx, { x: bx + 16, y: oy - 4, length: bw - 32, color: '#1e293b' });

  renderPlayerAchievements(
    ctx,
    buttons,
    bx,
    bw,
    oy,
    '🐱 Cat',
    '#fb923c',
    catAchievements,
    'cat',
    inSafeRoom,
    onOpenCatBoxes,
  );

  addButton(ctx, buttons, {
    x: bx + 20,
    y: by + bh - 44,
    width: bw - 40,
    height: 32,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('main'),
  });
}
