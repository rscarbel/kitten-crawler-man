import type { AchievementManager } from '../../core/AchievementManager';
import { ACHIEVEMENT_DEFS, isAchievementId } from '../../core/AchievementManager';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, drawButton, BUTTON_PRESETS } from '../Button';
import { drawText, measureTextBox, TEXT_PRESETS } from '../TextBox';
import { drawBox, drawDivider, drawScrollbar } from '../Box';

// Layout constants
const TAB_TITLE_SIZE = 16;
const TAB_TITLE_Y = 15;
const SIDE_MARGIN = 12;

/** Top of the scrolling list and the footer it must not run into. */
export const ACHIEVEMENTS_SCROLL_TOP_Y = 44;
export const ACHIEVEMENTS_FOOTER_H = 56;

const SECTION_LABEL_SIZE = 12;
const SECTION_LABEL_X_OFFSET = 16;
const SECTION_LABEL_H = 22;
const SECTION_GAP = 12;
const DIVIDER_X_OFFSET = 16;
const DIVIDER_WIDTH_OFFSET = 32;
const DIVIDER_H = 10;
const LIST_TOP_PAD = 4;

const ROW_GAP = 4;
const ROW_PAD_Y = 5;
const ROW_FILL = 'rgba(250,204,21,0.06)';
const CHECKMARK_X_OFFSET = 18;
const CHECKMARK_SIZE = 11;
const CHECKMARK_COLOR = '#4ade80';
const NAME_X_OFFSET = 32;
const NAME_SIZE = 11;
const NAME_LINE_H = 15;
const TIER_SIZE = 9;
const TIER_LINE_H = 13;
/** Right-hand inset that keeps wrapped names off the scrollbar. */
const NAME_RIGHT_INSET = 16;

const EMPTY_X_OFFSET = 18;
const EMPTY_TEXT_SIZE = 10;
const EMPTY_COLOR = '#64748b';
const EMPTY_H = 22;

const OPEN_BOX_BTN_W = 120;
const OPEN_BOX_BTN_H = 36;
const OPEN_BOX_BTN_LABEL_SIZE = 11;
const OPEN_BOX_ROW_H = 44;
const BOX_COUNT_X_OFFSET = 18;
const DIRECTIVE_SIZE = 10;
const DIRECTIVE_COLOR = '#fbbf24';
const DIRECTIVE_LINE_H = 14;
const DIRECTIVE_PAD = 6;

const SCROLLBAR_X_OFFSET = 7;
const SCROLLBAR_WIDTH = 3;

const BACK_BTN_Y_OFFSET = 8;
const BACK_BTN_X_OFFSET = 20;
const BACK_BTN_WIDTH_OFFSET = 40;
const BACK_BTN_HEIGHT = 40;

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

interface ScrollBand {
  top: number;
  bottom: number;
}

function isWhollyVisible(y: number, height: number, band: ScrollBand): boolean {
  return y >= band.top && y + height <= band.bottom;
}

function isPartlyVisible(y: number, height: number, band: ScrollBand): boolean {
  return y + height > band.top && y < band.bottom;
}

/** Draws one player's section from `startY` (screen space) and returns the y where it ends. */
function renderPlayerAchievements(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  band: ScrollBand,
  bx: number,
  bw: number,
  startY: number,
  label: string,
  labelColor: string,
  manager: AchievementManager | undefined,
  playerTarget: 'human' | 'cat',
  onOpenBoxes?: () => void,
): number {
  drawText(ctx, label, {
    x: bx + SECTION_LABEL_X_OFFSET,
    y: startY + (SECTION_LABEL_H - SECTION_LABEL_SIZE) / 2,
    bold: true,
    size: SECTION_LABEL_SIZE,
    color: labelColor,
  });
  let oy = startY + SECTION_LABEL_H;

  const relevant = Object.keys(ACHIEVEMENT_DEFS)
    .filter(isAchievementId)
    .filter((id) => {
      const pt = ACHIEVEMENT_DEFS[id].playerType;
      if (pt !== 'both' && pt !== playerTarget) return false;
      return manager?.isUnlocked(id) ?? false;
    });

  if (relevant.length === 0) {
    drawText(ctx, 'No achievements yet...', {
      x: bx + EMPTY_X_OFFSET,
      y: oy,
      size: EMPTY_TEXT_SIZE,
      color: EMPTY_COLOR,
    });
    oy += EMPTY_H;
  }

  const rowW = bw - SIDE_MARGIN * 2;
  const nameW = bw - NAME_X_OFFSET - NAME_RIGHT_INSET;
  for (const id of relevant) {
    const def = ACHIEVEMENT_DEFS[id];
    const nameLines = measureTextBox(ctx, def.name, {
      size: NAME_SIZE,
      bold: true,
      width: nameW,
      lineHeight: NAME_LINE_H,
    }).lineCount;
    const tierH = def.lootBox ? TIER_LINE_H : 0;
    const rowH = ROW_PAD_Y * 2 + nameLines * NAME_LINE_H + tierH;

    if (isPartlyVisible(oy, rowH, band)) {
      drawBox(ctx, { x: bx + SIDE_MARGIN, y: oy, width: rowW, height: rowH, fill: ROW_FILL });
      drawText(ctx, '✓', {
        x: bx + CHECKMARK_X_OFFSET,
        y: oy + ROW_PAD_Y,
        size: CHECKMARK_SIZE,
        color: CHECKMARK_COLOR,
      });
      drawText(ctx, def.name, {
        x: bx + NAME_X_OFFSET,
        y: oy + ROW_PAD_Y,
        bold: true,
        size: NAME_SIZE,
        color: '#f1f5f9',
        width: nameW,
        lineHeight: NAME_LINE_H,
      });
      if (def.lootBox) {
        drawText(ctx, `${def.lootBox.tier} ${def.lootBox.category}`, {
          x: bx + NAME_X_OFFSET,
          y: oy + ROW_PAD_Y + nameLines * NAME_LINE_H,
          bold: true,
          size: TIER_SIZE,
          color: tierColor(def.lootBox.tier),
        });
      }
    }
    oy += rowH + ROW_GAP;
  }

  const boxCount = manager?.pendingBoxes.length ?? 0;
  if (boxCount === 0) return oy;

  if (onOpenBoxes) {
    const btnY = oy + (OPEN_BOX_ROW_H - OPEN_BOX_BTN_H) / 2;
    drawText(ctx, `Unopened boxes: ${boxCount}`, {
      x: bx + BOX_COUNT_X_OFFSET,
      y: oy + (OPEN_BOX_ROW_H - TEXT_PRESETS.hint.size) / 2,
      ...TEXT_PRESETS.hint,
    });
    const openBoxButton = {
      x: bx + bw - SIDE_MARGIN - OPEN_BOX_BTN_W,
      y: btnY,
      width: OPEN_BOX_BTN_W,
      height: OPEN_BOX_BTN_H,
      label: 'Open Boxes',
      ...BUTTON_PRESETS.success,
      labelSize: OPEN_BOX_BTN_LABEL_SIZE,
      action: onOpenBoxes,
    };
    // A half-scrolled button must not keep a hit-rect out under the title or footer.
    if (isWhollyVisible(btnY, OPEN_BOX_BTN_H, band)) {
      addButton(ctx, buttons, openBoxButton);
    } else if (isPartlyVisible(btnY, OPEN_BOX_BTN_H, band)) {
      drawButton(ctx, openBoxButton);
    }
    return oy + OPEN_BOX_ROW_H;
  }

  // Reached both outside a safe room and inside one whose scene cannot run
  // the opener (building interiors), so the directive names the dungeon
  // rather than promising the current room will do.
  const rewardNoun = boxCount === 1 ? 'reward' : 'rewards';
  const directive = `🎁 ${boxCount} unopened ${rewardNoun} — open at a dungeon safe room`;
  const directiveW = bw - BOX_COUNT_X_OFFSET * 2;
  const { totalHeight } = drawText(ctx, directive, {
    x: bx + BOX_COUNT_X_OFFSET,
    y: oy + DIRECTIVE_PAD,
    size: DIRECTIVE_SIZE,
    bold: true,
    color: DIRECTIVE_COLOR,
    width: directiveW,
    lineHeight: DIRECTIVE_LINE_H,
  });
  return oy + totalHeight + DIRECTIVE_PAD * 2;
}

/** Returns total content height so PauseMenu can clamp scroll. */
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
  scrollY: number,
  onOpenHumanBoxes?: () => void,
  onOpenCatBoxes?: () => void,
): number {
  drawText(ctx, 'ACHIEVEMENTS', {
    x: bx + bw / 2,
    y: by + TAB_TITLE_Y,
    bold: true,
    size: TAB_TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  const scrollTop = by + ACHIEVEMENTS_SCROLL_TOP_Y;
  const scrollHeight = Math.max(0, bh - ACHIEVEMENTS_SCROLL_TOP_Y - ACHIEVEMENTS_FOOTER_H);
  const band: ScrollBand = { top: scrollTop, bottom: scrollTop + scrollHeight };
  const contentOriginY = scrollTop - scrollY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, scrollTop, bw, scrollHeight);
  ctx.clip();

  let oy = contentOriginY + LIST_TOP_PAD;
  oy = renderPlayerAchievements(
    ctx,
    buttons,
    band,
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
    y: oy,
    length: bw - DIVIDER_WIDTH_OFFSET,
    color: '#1e293b',
  });
  oy += DIVIDER_H;

  oy = renderPlayerAchievements(
    ctx,
    buttons,
    band,
    bx,
    bw,
    oy,
    '🐱 Cat',
    '#fb923c',
    catAchievements,
    'cat',
    onOpenCatBoxes,
  );
  const contentHeight = oy - contentOriginY + LIST_TOP_PAD;

  ctx.restore();

  drawScrollbar(ctx, {
    x: bx + bw - SCROLLBAR_X_OFFSET,
    trackY: scrollTop,
    trackH: scrollHeight,
    contentH: contentHeight,
    scrollY,
    width: SCROLLBAR_WIDTH,
  });

  addButton(ctx, buttons, {
    x: bx + BACK_BTN_X_OFFSET,
    y: by + bh - ACHIEVEMENTS_FOOTER_H + BACK_BTN_Y_OFFSET,
    width: bw - BACK_BTN_WIDTH_OFFSET,
    height: BACK_BTN_HEIGHT,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: () => setTab('game'),
  });

  return contentHeight;
}
