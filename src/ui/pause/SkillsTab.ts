import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { SkillState } from '../../core/SkillManager';
import {
  SKILL_IDS,
  getSkillDef,
  isEligible,
  usesToNextLevel,
  type CrawlerKind,
} from '../../core/SkillManager';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';
import { drawDivider, drawProgressBar, drawScrollbar } from '../Box';

// Card geometry
const CARD_H = 84;
const CARD_GAP = 6;
const CARD_BORDER_WIDTH = 3;
const CARD_PADDING = 10;
const CARD_RIGHT_EDGE_OFFSET = 10;
const CARD_NAME_Y = 10;
const CARD_NAME_SIZE = 12;
const CARD_EFFECT_Y = 28;
const CARD_EFFECT_SIZE = 10;
const CARD_FLAVOR_Y = 44;
const CARD_FLAVOR_SIZE = 9;
const CARD_BAR_Y = 62;
const CARD_BAR_H = 6;
const CARD_BAR_LABEL_Y = 78;
const CARD_BAR_LABEL_SIZE = 9;

// Level pips
const PIP_SIZE = 7;
const PIP_GAP = 3;
const PIP_Y_OFFSET = 4;

// Tab header
const TAB_TITLE_Y = 16;
const TAB_TITLE_SIZE = 16;
const TAB_SUBTITLE_Y = 36;
const TAB_SUBTITLE_SIZE = 10;
const TAB_HEADER_DIVIDER_X = 20;
const TAB_HEADER_DIVIDER_Y = 50;
const TAB_HEADER_DIVIDER_LENGTH_MARGIN = 40;

// Scroll area
const SCROLL_TOP_Y = 56;
const BACK_BTN_HEIGHT = 52;
const SECTION_HEADER_H = 20;
const SECTION_GAP = 14;
const CONTENT_START_Y = 8;

// Character section
const CHAR_LABEL_X = 20;
const CHAR_LABEL_SIZE = 13;
const CHAR_COUNT_X_OFFSET = 20;
const CHAR_COUNT_SIZE = 11;
const EMPTY_LINE_SIZE = 10;
const EMPTY_LINE_H = 15;

// Cards
const CARD_X_OFFSET = 16;
const CARD_WIDTH_MARGIN = 32;

// Scrollbar
const SCROLLBAR_X_OFFSET = 7;
const SCROLLBAR_WIDTH = 3;

// Back button
const BACK_BTN_X_MARGIN = 20;
const BACK_BTN_Y_OFFSET = 8;
const BACK_BTN_WIDTH_MARGIN = 40;
const BACK_BTN_CONTENT_H = 36;

const SKILL_ACCENT = '#a78bfa';
const SKILL_DIM_BORDER = 'rgba(167,139,250,0.22)';
const SKILL_CARD_BG = '#100a1e';
const PIP_FILLED_COLOR = '#a78bfa';
const PIP_EMPTY_COLOR = '#312e45';

function renderLevelPips(
  ctx: CanvasRenderingContext2D,
  rightEdge: number,
  y: number,
  level: number,
  maxLevel: number,
): void {
  const totalWidth = maxLevel * PIP_SIZE + (maxLevel - 1) * PIP_GAP;
  let x = rightEdge - totalWidth;
  for (let i = 0; i < maxLevel; i++) {
    ctx.fillStyle = i < level ? PIP_FILLED_COLOR : PIP_EMPTY_COLOR;
    ctx.fillRect(x, y, PIP_SIZE, PIP_SIZE);
    x += PIP_SIZE + PIP_GAP;
  }
}

function renderSkillCard(
  ctx: CanvasRenderingContext2D,
  localX: number,
  localY: number,
  w: number,
  state: SkillState,
): void {
  const def = getSkillDef(state.id);

  ctx.fillStyle = SKILL_CARD_BG;
  ctx.fillRect(localX, localY, w, CARD_H);
  ctx.fillStyle = SKILL_ACCENT;
  ctx.fillRect(localX, localY, CARD_BORDER_WIDTH, CARD_H);
  ctx.strokeStyle = SKILL_DIM_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(localX, localY, w, CARD_H);

  const textX = localX + CARD_BORDER_WIDTH + CARD_PADDING;
  const rightEdge = localX + w - CARD_RIGHT_EDGE_OFFSET;
  const textWidth = rightEdge - textX;

  drawText(ctx, def.name.toUpperCase(), {
    x: textX,
    y: localY + CARD_NAME_Y,
    bold: true,
    size: CARD_NAME_SIZE,
    color: SKILL_ACCENT,
  });
  renderLevelPips(ctx, rightEdge, localY + PIP_Y_OFFSET, state.level, def.maxLevel);

  drawText(ctx, def.describeEffect(state.level), {
    x: textX,
    y: localY + CARD_EFFECT_Y,
    size: CARD_EFFECT_SIZE,
    color: '#cbd5e1',
    width: textWidth,
  });

  drawText(ctx, def.flavor, {
    x: textX,
    y: localY + CARD_FLAVOR_Y,
    size: CARD_FLAVOR_SIZE,
    color: '#64748b',
    width: textWidth,
  });

  const needed = usesToNextLevel(def, state.level);
  const atMax = !Number.isFinite(needed);
  drawProgressBar(ctx, {
    x: textX,
    y: localY + CARD_BAR_Y,
    width: textWidth,
    height: CARD_BAR_H,
    value: atMax ? 1 : state.usesTowardNext / needed,
    fill: atMax ? '#fbbf24' : SKILL_ACCENT,
    background: '#1e1b2e',
  });
  drawText(ctx, atMax ? 'Mastered' : `${state.usesTowardNext} / ${needed} uses to next level`, {
    x: textX,
    y: localY + CARD_BAR_LABEL_Y,
    size: CARD_BAR_LABEL_SIZE,
    color: atMax ? '#fbbf24' : '#475569',
  });
}

/** How many of a crawler's eligible skills they have yet to discover. */
function undiscoveredCount(kind: CrawlerKind, unlocked: number): number {
  let eligible = 0;
  for (const id of SKILL_IDS) {
    if (isEligible(getSkillDef(id), kind)) eligible++;
  }
  return Math.max(0, eligible - unlocked);
}

/** Returns total content height so PauseMenu can clamp scroll. */
export function renderSkillsTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  human: HumanPlayer,
  cat: CatPlayer,
  setTab: (tab: PauseTab) => void,
  scrollY = 0,
): number {
  drawText(ctx, 'SKILLS', {
    x: bx + bw / 2,
    y: by + TAB_TITLE_Y,
    bold: true,
    size: TAB_TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });
  drawText(ctx, 'Trained by doing. Found in the dungeon.', {
    x: bx + bw / 2,
    y: by + TAB_SUBTITLE_Y,
    size: TAB_SUBTITLE_SIZE,
    color: '#475569',
    align: 'center',
  });

  drawDivider(ctx, {
    x: bx + TAB_HEADER_DIVIDER_X,
    y: by + TAB_HEADER_DIVIDER_Y,
    length: bw - TAB_HEADER_DIVIDER_LENGTH_MARGIN,
  });

  const scrollTop = by + SCROLL_TOP_Y;
  const scrollBot = by + bh - BACK_BTN_HEIGHT;
  const scrollH = scrollBot - scrollTop;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, scrollTop, bw, scrollH);
  ctx.clip();
  ctx.translate(0, scrollTop - scrollY);

  let y = CONTENT_START_Y;

  const sections: Array<[HumanPlayer | CatPlayer, string, string]> = [
    [human, 'Human', '#93c5fd'],
    [cat, 'Cat', '#fb923c'],
  ];

  for (const [player, charName, nameColor] of sections) {
    const states = player.skills.unlockedStates();
    const remaining = undiscoveredCount(player.crawlerKind, states.length);

    drawText(ctx, `${charName}  ·  ${states.length} known`, {
      x: bx + CHAR_LABEL_X,
      y,
      bold: true,
      size: CHAR_LABEL_SIZE,
      color: nameColor,
    });
    if (remaining > 0) {
      drawText(ctx, `${remaining} undiscovered`, {
        x: bx + bw - CHAR_COUNT_X_OFFSET,
        y,
        size: CHAR_COUNT_SIZE,
        color: '#64748b',
        align: 'right',
      });
    }
    y += SECTION_HEADER_H;

    if (states.length === 0) {
      drawText(ctx, 'No skills yet. The dungeon has not offered any.', {
        x: bx + CARD_X_OFFSET,
        y,
        size: EMPTY_LINE_SIZE,
        color: '#64748b',
      });
      y += EMPTY_LINE_H;
      drawText(ctx, 'Skill books drop from the things that lived by them.', {
        x: bx + CARD_X_OFFSET,
        y,
        size: EMPTY_LINE_SIZE,
        color: '#475569',
      });
      y += EMPTY_LINE_H;
    } else {
      const cardX = bx + CARD_X_OFFSET;
      const cardW = bw - CARD_WIDTH_MARGIN;
      for (const state of states) {
        renderSkillCard(ctx, cardX, y, cardW, state);
        y += CARD_H + CARD_GAP;
      }
    }

    if (remaining > 0) {
      // Named skills stay hidden until found — the discovery is the reward.
      drawText(ctx, `Undiscovered skills: ${remaining}. The dungeon provides. Eventually.`, {
        x: bx + CARD_X_OFFSET,
        y,
        size: EMPTY_LINE_SIZE,
        color: '#475569',
      });
      y += EMPTY_LINE_H;
    }

    y += SECTION_GAP;
    drawDivider(ctx, { x: bx + CHAR_LABEL_X, y, length: bw - CARD_WIDTH_MARGIN, color: '#1e293b' });
    y += SECTION_GAP;
  }

  const contentHeight = y;
  ctx.restore();

  drawScrollbar(ctx, {
    x: bx + bw - SCROLLBAR_X_OFFSET,
    trackY: scrollTop,
    trackH: scrollH,
    contentH: contentHeight,
    scrollY,
    width: SCROLLBAR_WIDTH,
  });

  addButton(ctx, buttons, {
    x: bx + BACK_BTN_X_MARGIN,
    y: by + bh - BACK_BTN_HEIGHT + BACK_BTN_Y_OFFSET,
    width: bw - BACK_BTN_WIDTH_MARGIN,
    height: BACK_BTN_CONTENT_H,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: () => setTab('game'),
  });

  return contentHeight;
}
