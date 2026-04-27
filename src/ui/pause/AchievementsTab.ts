import type { AchievementManager } from '../../core/AchievementManager';
import { ACHIEVEMENT_DEFS, isAchievementId } from '../../core/AchievementManager';
import { menuBtn, type ButtonRect, type PauseTab } from './types';

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
  ctx.fillStyle = labelColor;
  ctx.font = 'bold 12px monospace';
  ctx.fillText(label, bx + 16, startY + 12);
  let oy = startY + 20;

  const relevant = Object.keys(ACHIEVEMENT_DEFS)
    .filter(isAchievementId)
    .filter((id) => {
      const pt = ACHIEVEMENT_DEFS[id].playerType;
      if (pt !== 'both' && pt !== playerTarget) return false;
      return manager?.isUnlocked(id) ?? false;
    });

  if (relevant.length === 0) {
    ctx.font = '10px monospace';
    ctx.fillStyle = '#374151';
    ctx.fillText('No achievements yet...', bx + 18, oy + 13);
    oy += 20;
  }

  for (const id of relevant) {
    const def = ACHIEVEMENT_DEFS[id];

    ctx.fillStyle = 'rgba(250,204,21,0.06)';
    ctx.fillRect(bx + 12, oy, bw - 24, 18);

    ctx.font = '11px monospace';
    ctx.fillStyle = '#4ade80';
    ctx.fillText('✓', bx + 18, oy + 13);

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#f1f5f9';
    ctx.fillText(def.name, bx + 32, oy + 13);

    if (def.lootBox) {
      ctx.fillStyle = tierColor(def.lootBox.tier);
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${def.lootBox.tier} ${def.lootBox.category}`, bx + bw - 14, oy + 13);
      ctx.textAlign = 'left';
    }

    oy += 20;
  }

  const boxCount = manager?.pendingBoxes.length ?? 0;
  if (boxCount > 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText(`Unopened boxes: ${boxCount}`, bx + 18, oy + 10);

    if (onOpenBoxes) {
      const btnW = 100;
      const btnX = bx + bw - 20 - btnW;
      menuBtn(ctx, buttons, btnX, oy, btnW, 22, 'Open Boxes', onOpenBoxes, '#14532d', '#4ade80');
    } else if (!inSafeRoom) {
      ctx.fillStyle = '#374151';
      ctx.font = '9px monospace';
      ctx.fillText('(safe room only)', bx + 140, oy + 10);
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
  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ACHIEVEMENTS', bx + bw / 2, by + 28);
  ctx.textAlign = 'left';

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

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx + 16, oy - 4);
  ctx.lineTo(bx + bw - 16, oy - 4);
  ctx.stroke();

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

  menuBtn(ctx, buttons, bx + 20, by + bh - 44, bw - 40, 32, 'Back', () => setTab('main'));
}
