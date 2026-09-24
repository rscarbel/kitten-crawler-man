/**
 * The pause menu's Crafts tab: each crawler's Resourcing and Construction
 * progress, side by side, so the two never read as one shared meter.
 *
 * Modelled on `AbilitiesTab`'s scroll plumbing (module-level state, reset and
 * touch handlers `PauseMenu` calls by tab) rather than the per-scene bar
 * `StatsTab`/`SkillsTab` use, since this tab's content is small enough that a
 * self-contained scroll is simpler than threading a new scroll field through
 * `PauseMenu`.
 */

import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { CRAWLER_NAMES } from '../../core/SkillManager';
import { MAX_CRAFT_LEVEL, type CraftSkillId, type CraftSkills } from '../../core/CraftSkills';
import {
  describeConstructionPerk,
  describeResourcingPerk,
  nextConstructionUnlock,
  nextResourcingUnlock,
} from '../../core/craftPerks';
import { drawCraftSkillIcon } from '../icons/craftSkillIcons';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText, measureTextBox } from '../TextBox';
import { drawBox, drawDivider, drawProgressBar, drawScrollbar, PROGRESS_PRESETS } from '../Box';

const CRAFT_SKILL_ORDER: readonly CraftSkillId[] = ['resourcing', 'construction'];

const CRAFT_SKILL_LABELS: Record<CraftSkillId, string> = {
  resourcing: 'Resourcing',
  construction: 'Construction',
};

const TITLE_Y_OFFSET = 22;
const TITLE_Y_ADJUST = 10;
const TITLE_SIZE = 16;

const HEADER_H = 44;
const FOOTER_H = 48;
const COLUMN_GAP = 12;
const COLUMN_PAD = 14;
const SCROLLBAR_W = 6;

const HUMAN_LABEL = CRAWLER_NAMES.human;
const CAT_LABEL = CRAWLER_NAMES.cat;
const HUMAN_COLOR = '#fb923c';
const CAT_COLOR = '#38bdf8';
const COLUMN_HEADER_Y_OFFSET = 16;
const COLUMN_HEADER_SIZE = 13;

const NO_CRAFTS_Y_OFFSET = 20;

const CARD_GAP = 10;
const CARD_PADDING = 10;
const CARD_ICON_SIZE = 28;
const CARD_TITLE_X_OFFSET = 8;
const CARD_TITLE_Y_OFFSET = 4;
const CARD_TITLE_SIZE = 12;
const CARD_LEVEL_Y_OFFSET = 18;
const CARD_LEVEL_SIZE = 10;
const CARD_BAR_Y_OFFSET = 34;
const CARD_BAR_H = 6;
const CARD_XP_LABEL_Y_OFFSET = 46;
const CARD_XP_LABEL_SIZE = 9;
const CARD_PERK_Y_OFFSET = 60;
const CARD_PERK_SIZE = 10;
const CARD_PERK_LINE_H = 12;
const CARD_UNLOCK_GAP = 6;
const CARD_UNLOCK_SIZE = 9;
const CARD_UNLOCK_LINE_H = 11;
const CARD_HOW_BUTTON_GAP = 8;
const CARD_HOW_BUTTON_H = 20;
const CARD_HOW_BUTTON_LABEL_SIZE = 9;
const CARD_BOTTOM_PAD = 8;

const BACK_BUTTON_Y_OFFSET = 7;
const BACK_BUTTON_HEIGHT = 34;
const BACK_BUTTON_MARGIN = 40;
const BACK_BUTTON_X = 20;

const SCROLL_SPEED_MULTIPLIER = 0.5;

let scrollY = 0;
let contentH = 0;
let viewportH = 0;
let touchStartY: number | null = null;
let touchScrollBase = 0;

export function resetCraftsTab(): void {
  scrollY = 0;
  touchStartY = null;
}

export function scrollCraftsTab(deltaY: number): void {
  const maxScroll = Math.max(0, contentH - viewportH);
  scrollY = Math.max(0, Math.min(maxScroll, scrollY + deltaY * SCROLL_SPEED_MULTIPLIER));
}

export function craftsTabTouchStart(y: number): void {
  touchStartY = y;
  touchScrollBase = scrollY;
}

export function craftsTabTouchMove(y: number): void {
  if (touchStartY === null) return;
  const delta = touchStartY - y;
  const maxScroll = Math.max(0, contentH - viewportH);
  scrollY = Math.max(0, Math.min(maxScroll, touchScrollBase + delta));
}

export function craftsTabTouchEnd(): void {
  touchStartY = null;
}

/** True once either crawler has learned at least one craft skill — the tab's visibility gate. */
export function hasAnyCraftSkill(human: HumanPlayer, cat: CatPlayer): boolean {
  return CRAFT_SKILL_ORDER.some(
    (id) => human.craftSkills.isLearned(id) || cat.craftSkills.isLearned(id),
  );
}

interface CardLayout {
  readonly id: CraftSkillId;
  readonly height: number;
  readonly perkText: string;
  readonly perkLines: number;
  readonly unlockText: string;
}

function layoutCard(
  ctx: CanvasRenderingContext2D,
  skills: CraftSkills,
  id: CraftSkillId,
  columnW: number,
): CardLayout {
  const level = skills.getLevel(id);
  const perkText =
    id === 'resourcing' ? describeResourcingPerk(level) : describeConstructionPerk(level);
  const textW = columnW - CARD_PADDING * 2;
  const { lineCount: perkLines } = measureTextBox(ctx, perkText, {
    size: CARD_PERK_SIZE,
    width: textW,
    lineHeight: CARD_PERK_LINE_H,
  });

  const nextUnlock =
    id === 'resourcing' ? nextResourcingUnlock(level) : nextConstructionUnlock(level);
  const unlockText =
    level >= MAX_CRAFT_LEVEL
      ? 'Mastered'
      : nextUnlock === null
        ? 'Mastered'
        : `Next at Lv ${nextUnlock.level}: ${nextUnlock.text}`;
  const { lineCount: unlockLines } = measureTextBox(ctx, unlockText, {
    size: CARD_UNLOCK_SIZE,
    width: textW,
    lineHeight: CARD_UNLOCK_LINE_H,
  });

  const perkBlockH = perkLines * CARD_PERK_LINE_H;
  const unlockBlockH = CARD_UNLOCK_GAP + unlockLines * CARD_UNLOCK_LINE_H;
  const height =
    CARD_PERK_Y_OFFSET +
    perkBlockH +
    unlockBlockH +
    CARD_HOW_BUTTON_GAP +
    CARD_HOW_BUTTON_H +
    CARD_BOTTOM_PAD;

  return { id, height, perkText, perkLines, unlockText };
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  x: number,
  y: number,
  w: number,
  layout: CardLayout,
  skills: CraftSkills,
  onHowCraftWorks: ((id: CraftSkillId) => void) | undefined,
  progressPreset: typeof PROGRESS_PRESETS.resourcing,
  clipTop: number,
  clipBottom: number,
): void {
  const { id, height, perkText, perkLines, unlockText } = layout;
  const level = skills.getLevel(id);
  const xp = skills.getXp(id);
  const xpToNext = skills.xpToNext(id);

  drawBox(ctx, {
    x,
    y,
    width: w,
    height,
    fill: 'rgba(15,23,42,0.6)',
    border: '#334155',
    borderWidth: 1,
    radius: 4,
  });

  drawCraftSkillIcon(ctx, id, x + CARD_PADDING, y + CARD_PADDING, CARD_ICON_SIZE);

  const textX = x + CARD_PADDING + CARD_ICON_SIZE + CARD_TITLE_X_OFFSET;
  drawText(ctx, CRAFT_SKILL_LABELS[id], {
    x: textX,
    y: y + CARD_PADDING + CARD_TITLE_Y_OFFSET,
    bold: true,
    size: CARD_TITLE_SIZE,
    color: '#e2e8f0',
  });
  drawText(ctx, `Level ${level} / ${MAX_CRAFT_LEVEL}`, {
    x: textX,
    y: y + CARD_PADDING + CARD_LEVEL_Y_OFFSET,
    size: CARD_LEVEL_SIZE,
    color: '#94a3b8',
  });

  const barX = x + CARD_PADDING;
  const barW = w - CARD_PADDING * 2;
  const barY = y + CARD_BAR_Y_OFFSET;
  const atMax = level >= MAX_CRAFT_LEVEL;
  const xpFrac = atMax || xpToNext === Infinity || xpToNext <= 0 ? 1 : xp / xpToNext;
  drawProgressBar(ctx, {
    x: barX,
    y: barY,
    width: barW,
    height: CARD_BAR_H,
    value: Math.min(xpFrac, 1),
    ...progressPreset,
  });
  drawText(ctx, atMax ? 'MAX LEVEL' : `${xp} / ${xpToNext} XP`, {
    x: barX,
    y: y + CARD_XP_LABEL_Y_OFFSET,
    size: CARD_XP_LABEL_SIZE,
    color: atMax ? '#fbbf24' : '#64748b',
    bold: atMax,
  });

  drawText(ctx, perkText, {
    x: barX,
    y: y + CARD_PERK_Y_OFFSET,
    size: CARD_PERK_SIZE,
    color: '#cbd5e1',
    width: barW,
    lineHeight: CARD_PERK_LINE_H,
  });

  const unlockY = y + CARD_PERK_Y_OFFSET + perkLines * CARD_PERK_LINE_H + CARD_UNLOCK_GAP;
  drawText(ctx, unlockText, {
    x: barX,
    y: unlockY,
    size: CARD_UNLOCK_SIZE,
    color: '#7dd3fc',
    width: barW,
    lineHeight: CARD_UNLOCK_LINE_H,
  });

  const howBtnY = y + height - CARD_HOW_BUTTON_H;
  // The hit-rect is clamped to what the scroll clip actually shows: a card
  // scrolled half off the visible band must not take clicks meant for
  // whatever real button now occupies the erased pixels above or below it.
  const visibleTop = Math.max(howBtnY, clipTop);
  const visibleBottom = Math.min(howBtnY + CARD_HOW_BUTTON_H, clipBottom);
  if (onHowCraftWorks !== undefined && visibleBottom > visibleTop) {
    addButton(ctx, buttons, {
      x: barX,
      y: howBtnY,
      width: barW,
      height: CARD_HOW_BUTTON_H,
      label: 'How it works',
      labelSize: CARD_HOW_BUTTON_LABEL_SIZE,
      ...BUTTON_PRESETS.primary,
      action: () => onHowCraftWorks(id),
    });
    const hitRect = buttons[buttons.length - 1];
    hitRect.y = visibleTop;
    hitRect.h = visibleBottom - visibleTop;
  } else if (onHowCraftWorks === undefined) {
    drawBox(ctx, {
      x: barX,
      y: howBtnY,
      width: barW,
      height: CARD_HOW_BUTTON_H,
      fill: 'rgba(30,41,59,0.4)',
      border: '#334155',
      borderWidth: 1,
      radius: 3,
    });
    drawText(ctx, 'How it works', {
      x: barX + barW / 2,
      y: howBtnY + CARD_HOW_BUTTON_H / 2 - CARD_HOW_BUTTON_LABEL_SIZE / 2,
      size: CARD_HOW_BUTTON_LABEL_SIZE,
      color: '#475569',
      align: 'center',
    });
  }
}

function progressPresetFor(id: CraftSkillId): typeof PROGRESS_PRESETS.resourcing {
  return id === 'resourcing' ? PROGRESS_PRESETS.resourcing : PROGRESS_PRESETS.construction;
}

export function renderCraftsTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  setTab: (tab: PauseTab) => void,
  human: HumanPlayer,
  cat: CatPlayer,
  onHowCraftWorks?: (id: CraftSkillId) => void,
): void {
  drawText(ctx, 'Crafts', {
    x: bx + bw / 2,
    y: by + TITLE_Y_OFFSET - TITLE_Y_ADJUST,
    bold: true,
    size: TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  const areaTop = by + HEADER_H;
  const areaH = bh - HEADER_H - FOOTER_H;
  viewportH = areaH;

  const columnW = (bw - COLUMN_GAP - COLUMN_PAD * 2) / 2;
  const leftX = bx + COLUMN_PAD;
  const rightX = leftX + columnW + COLUMN_GAP;

  const leftLayouts = CRAFT_SKILL_ORDER.filter((id) => human.craftSkills.isLearned(id)).map((id) =>
    layoutCard(ctx, human.craftSkills, id, columnW - SCROLLBAR_W),
  );
  const rightLayouts = CRAFT_SKILL_ORDER.filter((id) => cat.craftSkills.isLearned(id)).map((id) =>
    layoutCard(ctx, cat.craftSkills, id, columnW - SCROLLBAR_W),
  );

  const leftContentH =
    COLUMN_HEADER_Y_OFFSET + leftLayouts.reduce((sum, l) => sum + l.height + CARD_GAP, 0);
  const rightContentH =
    COLUMN_HEADER_Y_OFFSET + rightLayouts.reduce((sum, l) => sum + l.height + CARD_GAP, 0);
  contentH = Math.max(leftContentH, rightContentH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, areaTop, bw, areaH);
  ctx.clip();

  drawText(ctx, HUMAN_LABEL, {
    x: leftX + columnW / 2,
    y: areaTop - scrollY + COLUMN_HEADER_Y_OFFSET,
    bold: true,
    size: COLUMN_HEADER_SIZE,
    color: HUMAN_COLOR,
    align: 'center',
  });
  drawText(ctx, CAT_LABEL, {
    x: rightX + columnW / 2,
    y: areaTop - scrollY + COLUMN_HEADER_Y_OFFSET,
    bold: true,
    size: COLUMN_HEADER_SIZE,
    color: CAT_COLOR,
    align: 'center',
  });

  drawDivider(ctx, {
    x: leftX + columnW + COLUMN_GAP / 2,
    y: areaTop,
    length: areaH,
    direction: 'vertical',
    color: '#334155',
  });

  let cardY = areaTop - scrollY + COLUMN_HEADER_Y_OFFSET + CARD_GAP;
  if (leftLayouts.length === 0) {
    drawText(ctx, 'No crafts learned yet.', {
      x: leftX + columnW / 2,
      y: cardY + NO_CRAFTS_Y_OFFSET,
      size: 10,
      color: '#475569',
      align: 'center',
      width: columnW,
    });
  } else {
    for (const layout of leftLayouts) {
      drawCard(
        ctx,
        buttons,
        leftX,
        cardY,
        columnW - SCROLLBAR_W,
        layout,
        human.craftSkills,
        onHowCraftWorks,
        progressPresetFor(layout.id),
        areaTop,
        areaTop + areaH,
      );
      cardY += layout.height + CARD_GAP;
    }
  }

  cardY = areaTop - scrollY + COLUMN_HEADER_Y_OFFSET + CARD_GAP;
  if (rightLayouts.length === 0) {
    drawText(ctx, 'No crafts learned yet.', {
      x: rightX + columnW / 2,
      y: cardY + NO_CRAFTS_Y_OFFSET,
      size: 10,
      color: '#475569',
      align: 'center',
      width: columnW,
    });
  } else {
    for (const layout of rightLayouts) {
      drawCard(
        ctx,
        buttons,
        rightX,
        cardY,
        columnW - SCROLLBAR_W,
        layout,
        cat.craftSkills,
        onHowCraftWorks,
        progressPresetFor(layout.id),
        areaTop,
        areaTop + areaH,
      );
      cardY += layout.height + CARD_GAP;
    }
  }

  ctx.restore();

  drawScrollbar(ctx, {
    x: bx + bw - SCROLLBAR_W - 2,
    trackY: areaTop,
    trackH: areaH,
    contentH,
    scrollY,
    width: SCROLLBAR_W,
    thumbColor: '#7c3aed',
  });

  addButton(ctx, buttons, {
    x: bx + BACK_BUTTON_X,
    y: by + bh - FOOTER_H + BACK_BUTTON_Y_OFFSET,
    width: bw - BACK_BUTTON_MARGIN,
    height: BACK_BUTTON_HEIGHT,
    label: '← Back',
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: () => setTab('game'),
  });
}
