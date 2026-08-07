import type { AchievementManager } from '../../core/AchievementManager';
import { ACHIEVEMENT_DEFS, isAchievementId } from '../../core/AchievementManager';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText, TEXT_PRESETS } from '../TextBox';
import { drawBox, drawDivider } from '../Box';

// Layout constants
const ACH_LABEL_Y_ABOVE = 12;
const ACH_LABEL_Y_BASELINE = 10;
const ACH_LABEL_SIZE = 12;
const ACH_FIRST_Y_OFFSET = 20;
const ACH_EMPTY_X_OFFSET = 18;
const ACH_EMPTY_Y_OFFSET = 13;
const ACH_EMPTY_Y_BASELINE = 8;
const ACH_EMPTY_TEXT_SIZE = 10;
const ACH_EMPTY_Y_INCREMENT = 20;
const ACH_BOX_X_OFFSET = 12;
const ACH_BOX_WIDTH_OFFSET = 24;
const ACH_BOX_HEIGHT = 18;
const ACH_BOX_FILL = 'rgba(250,204,21,0.06)';
const ACH_CHECKMARK_X_OFFSET = 18;
const ACH_CHECKMARK_Y_ABOVE = 13;
const ACH_CHECKMARK_Y_BASELINE = 9;
const ACH_CHECKMARK_SIZE = 11;
const ACH_CHECKMARK_COLOR = '#4ade80';
const ACH_NAME_X_OFFSET = 32;
const ACH_NAME_Y_ABOVE = 13;
const ACH_NAME_Y_BASELINE = 8;
const ACH_NAME_SIZE = 10;
const ACH_NAME_WIDTH_OFFSET = 46;
/**
 * Line box for the name, used as both its line height and its clip height. Equal
 * values are what hold a long name to one line: a second line starts at the
 * clip's own bottom edge and so is cut entirely, while the first keeps its
 * descender. The row pitch has no room for a second line, and a wrapped name
 * used to spill out of its own box and over the checkmark of the row beneath it.
 */
const ACH_NAME_LINE_BOX = 14;
const ACH_TIER_RESERVE = 110;
const ACH_TIER_X_OFFSET = 14;
const ACH_TIER_Y_ABOVE = 13;
const ACH_TIER_Y_BASELINE = 7;
const ACH_TIER_SIZE = 9;
const ACH_BOX_COUNT_X_OFFSET = 18;
const ACH_BOX_COUNT_Y_BASELINE = 8;
const ACH_BOX_COUNT_Y_OFFSET = 10;
const OPEN_BOX_BTN_WIDTH = 100;
const OPEN_BOX_BTN_X_OFFSET = 20;
const OPEN_BOX_BTN_HEIGHT = 22;
const OPEN_BOX_BTN_LABEL_SIZE = 10;
const REWARDS_DIRECTIVE_X_OFFSET = 18;
const REWARDS_DIRECTIVE_SIZE = 9;
const REWARDS_DIRECTIVE_COLOR = '#fbbf24';
const REWARDS_DIRECTIVE_WIDTH_OFFSET = 36;
const ACH_ROW_INCREMENT = 20;
const ACH_LABEL_X_OFFSET = 16;
const TAB_TITLE_Y_BASELINE = 13;
const TAB_TITLE_SIZE = 16;
const TAB_TITLE_Y_OFFSET = 28;
const HUMAN_SECTION_Y_OFFSET = 42;
const SECTION_GAP = 130;
const DIVIDER_X_OFFSET = 16;
const DIVIDER_WIDTH_OFFSET = 32;
const DIVIDER_Y_OFFSET = 4;
const BACK_BTN_Y_OFFSET = 44;
const BACK_BTN_X_OFFSET = 20;
const BACK_BTN_WIDTH_OFFSET = 40;
const BACK_BTN_HEIGHT = 32;

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
  onOpenBoxes?: () => void,
): void {
  drawText(ctx, label, {
    x: bx + ACH_LABEL_X_OFFSET,
    y: startY + ACH_LABEL_Y_ABOVE - ACH_LABEL_Y_BASELINE,
    bold: true,
    size: ACH_LABEL_SIZE,
    color: labelColor,
  });
  let oy = startY + ACH_FIRST_Y_OFFSET;

  const relevant = Object.keys(ACHIEVEMENT_DEFS)
    .filter(isAchievementId)
    .filter((id) => {
      const pt = ACHIEVEMENT_DEFS[id].playerType;
      if (pt !== 'both' && pt !== playerTarget) return false;
      return manager?.isUnlocked(id) ?? false;
    });

  if (relevant.length === 0) {
    drawText(ctx, 'No achievements yet...', {
      x: bx + ACH_EMPTY_X_OFFSET,
      y: oy + ACH_EMPTY_Y_OFFSET - ACH_EMPTY_Y_BASELINE,
      size: ACH_EMPTY_TEXT_SIZE,
      color: '#374151',
    });
    oy += ACH_EMPTY_Y_INCREMENT;
  }

  for (const id of relevant) {
    const def = ACHIEVEMENT_DEFS[id];

    drawBox(ctx, {
      x: bx + ACH_BOX_X_OFFSET,
      y: oy,
      width: bw - ACH_BOX_WIDTH_OFFSET,
      height: ACH_BOX_HEIGHT,
      fill: ACH_BOX_FILL,
    });

    drawText(ctx, '✓', {
      x: bx + ACH_CHECKMARK_X_OFFSET,
      y: oy + ACH_CHECKMARK_Y_ABOVE - ACH_CHECKMARK_Y_BASELINE,
      size: ACH_CHECKMARK_SIZE,
      color: ACH_CHECKMARK_COLOR,
    });
    const tierReserve = def.lootBox ? ACH_TIER_RESERVE : 0;
    drawText(ctx, def.name, {
      x: bx + ACH_NAME_X_OFFSET,
      y: oy + ACH_NAME_Y_ABOVE - ACH_NAME_Y_BASELINE,
      bold: true,
      size: ACH_NAME_SIZE,
      color: '#f1f5f9',
      width: bw - ACH_NAME_WIDTH_OFFSET - tierReserve,
      lineHeight: ACH_NAME_LINE_BOX,
      height: ACH_NAME_LINE_BOX,
    });

    if (def.lootBox) {
      drawText(ctx, `${def.lootBox.tier} ${def.lootBox.category}`, {
        x: bx + bw - ACH_TIER_X_OFFSET,
        y: oy + ACH_TIER_Y_ABOVE - ACH_TIER_Y_BASELINE,
        bold: true,
        size: ACH_TIER_SIZE,
        color: tierColor(def.lootBox.tier),
        align: 'right',
      });
    }

    oy += ACH_ROW_INCREMENT;
  }

  const boxCount = manager?.pendingBoxes.length ?? 0;
  if (boxCount > 0) {
    const rewardsLineY = oy + ACH_BOX_COUNT_Y_OFFSET - ACH_BOX_COUNT_Y_BASELINE;
    if (onOpenBoxes) {
      drawText(ctx, `Unopened boxes: ${boxCount}`, {
        x: bx + ACH_BOX_COUNT_X_OFFSET,
        y: rewardsLineY,
        ...TEXT_PRESETS.hint,
      });

      const btnW = OPEN_BOX_BTN_WIDTH;
      const btnX = bx + bw - OPEN_BOX_BTN_X_OFFSET - btnW;
      addButton(ctx, buttons, {
        x: btnX,
        y: oy,
        width: btnW,
        height: OPEN_BOX_BTN_HEIGHT,
        label: 'Open Boxes',
        ...BUTTON_PRESETS.success,
        labelSize: OPEN_BOX_BTN_LABEL_SIZE,
        action: onOpenBoxes,
      });
    } else {
      // Reached both outside a safe room and inside one whose scene cannot run
      // the opener (building interiors), so the directive names the dungeon
      // rather than promising the current room will do.
      const rewardNoun = boxCount === 1 ? 'reward' : 'rewards';
      drawText(ctx, `🎁 ${boxCount} unopened ${rewardNoun} — open at a dungeon safe room`, {
        x: bx + REWARDS_DIRECTIVE_X_OFFSET,
        y: rewardsLineY,
        size: REWARDS_DIRECTIVE_SIZE,
        bold: true,
        color: REWARDS_DIRECTIVE_COLOR,
        width: bw - REWARDS_DIRECTIVE_WIDTH_OFFSET,
      });
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
  onOpenHumanBoxes?: () => void,
  onOpenCatBoxes?: () => void,
): void {
  drawText(ctx, 'ACHIEVEMENTS', {
    x: bx + bw / 2,
    y: by + TAB_TITLE_Y_OFFSET - TAB_TITLE_Y_BASELINE,
    bold: true,
    size: TAB_TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  let oy = by + HUMAN_SECTION_Y_OFFSET;

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
    onOpenHumanBoxes,
  );

  oy += SECTION_GAP;

  drawDivider(ctx, {
    x: bx + DIVIDER_X_OFFSET,
    y: oy - DIVIDER_Y_OFFSET,
    length: bw - DIVIDER_WIDTH_OFFSET,
    color: '#1e293b',
  });

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
    onOpenCatBoxes,
  );

  addButton(ctx, buttons, {
    x: bx + BACK_BTN_X_OFFSET,
    y: by + bh - BACK_BTN_Y_OFFSET,
    width: bw - BACK_BTN_WIDTH_OFFSET,
    height: BACK_BTN_HEIGHT,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: () => setTab('game'),
  });
}
