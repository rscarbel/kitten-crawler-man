import type { Player } from '../../Player';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { GameStats } from '../../core/GameStats';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';
import { drawDivider, drawScrollbar } from '../Box';

// Layout constants
const HEADER_Y_OFFSET = 34;
const HEADER_Y_TEXT_OFFSET = 13;
const HEADER_TEXT_SIZE = 16;
const SCROLL_TOP_Y_OFFSET = 50;
const BACK_BTN_H = 52;

// Content layout constants
const CONTENT_START_Y = 14;
const LINE_HEIGHT = 16;
const SECTION_SPACING = 12;
const STAT_BLOCK_X = 20;
const STAT_LABEL_Y_OFFSET = 10;
const STAT_SUBLABEL_SIZE = 11;

// Player section constants
const PLAYER_LABEL_Y_OFFSET = 10;
const PLAYER_LABEL_SIZE = 12;
const PLAYER_SPACING_AFTER_STATS = 10;

// XP display constants
const XP_LABEL_SIZE = 11;
const UNSPENT_POINTS_SIZE = 11;

// Section title constants
const DIVIDER_SPACING_BEFORE = 6;

// Kill stats display
const KILLS_TITLE_Y_OFFSET = 9;
const KILLS_TITLE_SIZE = 11;
const KILL_ENTRY_LABEL_X = 24;
const KILL_ENTRY_Y_OFFSET = 10;
const KILL_ENTRY_SIZE = 12;
const KILL_ENTRY_LINE_HEIGHT = 17;
const NO_KILLS_Y_OFFSET = 9;
const NO_KILLS_SIZE = 11;
const CONTENT_SPACING_END = 4;

// Divider constants
const DIVIDER_X_OFFSET = 20;
const DIVIDER_LENGTH_REDUCTION = 40;
const DIVIDER_Y_AFTER_HEADER = 14;

// Stat display positioning
const STAT_LABEL_X = 20;
const STAT_VALUE_X = 140;
const STAT_VALUE_SIZE = 13;
const SECOND_STAT_Y = 24;
const STAT_SPACING = 20;

// Scrollbar constants
const SCROLLBAR_X_OFFSET = 7;
const SCROLLBAR_WIDTH = 3;

// Back button constants
const BACK_BTN_X_OFFSET = 20;
const BACK_BTN_Y_OFFSET = 8;
const BACK_BTN_WIDTH_REDUCTION = 40;
const BACK_BTN_HEIGHT = 36;

// Stat line section constants
const PLAYER_LEVEL_XP_MULTIPLIER = 10;

/** Returns total content height so PauseMenu can clamp scroll. */
export function renderStatsTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  human: HumanPlayer,
  cat: CatPlayer,
  setTab: (tab: PauseTab) => void,
  gameStats?: GameStats,
  scrollY = 0,
): number {
  drawText(ctx, 'STATS', {
    x: bx + bw / 2,
    y: by + HEADER_Y_OFFSET - HEADER_Y_TEXT_OFFSET,
    bold: true,
    size: HEADER_TEXT_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  const scrollTop = by + SCROLL_TOP_Y_OFFSET;
  const scrollBot = by + bh - BACK_BTN_H;
  const scrollH = scrollBot - scrollTop;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, scrollTop, bw, scrollH);
  ctx.clip();
  ctx.translate(0, scrollTop - scrollY);

  // local y = 0 maps to scrollTop on screen (minus scrollY offset)
  let y = CONTENT_START_Y;

  const statBlock = (p: Player): number => {
    const midStat =
      p instanceof HumanPlayer ? `EXP: ${p.explosivesHandling}` : `INT: ${p.intelligence}`;
    drawText(
      ctx,
      `HP: ${p.hp}/${p.maxHp}   STR: ${p.strength}   ${midStat}   CON: ${p.constitution}`,
      {
        x: bx + STAT_BLOCK_X,
        y: y - STAT_LABEL_Y_OFFSET,
        size: STAT_SUBLABEL_SIZE,
        color: '#e2e8f0',
      },
    );
    y += LINE_HEIGHT;
    drawText(ctx, `XP: ${p.xp} / ${p.level * PLAYER_LEVEL_XP_MULTIPLIER}`, {
      x: bx + STAT_BLOCK_X,
      y: y - STAT_LABEL_Y_OFFSET,
      size: XP_LABEL_SIZE,
      color: '#64748b',
    });
    y += LINE_HEIGHT;
    if (p.unspentPoints > 0) {
      drawText(ctx, `Unspent skill pts: ${p.unspentPoints}`, {
        x: bx + STAT_BLOCK_X,
        y: y - STAT_LABEL_Y_OFFSET,
        size: UNSPENT_POINTS_SIZE,
        color: '#fbbf24',
      });
      y += LINE_HEIGHT;
    }
    return y;
  };

  drawText(ctx, `Human  Lv ${human.level}`, {
    x: bx + STAT_BLOCK_X,
    y: y - PLAYER_LABEL_Y_OFFSET,
    bold: true,
    size: PLAYER_LABEL_SIZE,
    color: '#93c5fd',
  });
  y += LINE_HEIGHT;
  statBlock(human);
  y += PLAYER_SPACING_AFTER_STATS;

  drawText(ctx, `Cat  Lv ${cat.level}`, {
    x: bx + STAT_BLOCK_X,
    y: y - PLAYER_LABEL_Y_OFFSET,
    bold: true,
    size: PLAYER_LABEL_SIZE,
    color: '#fb923c',
  });
  y += LINE_HEIGHT;
  statBlock(cat);

  if (gameStats) {
    y += SECTION_SPACING;
    drawDivider(ctx, { x: bx + DIVIDER_X_OFFSET, y, length: bw - DIVIDER_LENGTH_REDUCTION });
    y += DIVIDER_Y_AFTER_HEADER;

    drawText(ctx, 'Total Kills:', {
      x: bx + STAT_LABEL_X,
      y: y - PLAYER_LABEL_Y_OFFSET,
      bold: true,
      size: STAT_VALUE_SIZE,
      color: '#e2e8f0',
    });
    drawText(ctx, `${gameStats.totalKills}`, {
      x: bx + STAT_VALUE_X,
      y: y - PLAYER_LABEL_Y_OFFSET,
      bold: true,
      size: STAT_VALUE_SIZE,
      color: '#fbbf24',
    });
    y += STAT_SPACING;

    drawText(ctx, 'Potions Used:', {
      x: bx + STAT_LABEL_X,
      y: y - PLAYER_LABEL_Y_OFFSET,
      bold: true,
      size: STAT_VALUE_SIZE,
      color: '#e2e8f0',
    });
    drawText(ctx, `${gameStats.potionsUsed}`, {
      x: bx + STAT_VALUE_X,
      y: y - PLAYER_LABEL_Y_OFFSET,
      bold: true,
      size: STAT_VALUE_SIZE,
      color: '#86efac',
    });
    y += SECOND_STAT_Y;

    drawText(ctx, 'ENEMIES KILLED', {
      x: bx + STAT_LABEL_X,
      y: y - KILLS_TITLE_Y_OFFSET,
      bold: true,
      size: KILLS_TITLE_SIZE,
      color: '#94a3b8',
    });
    y += DIVIDER_SPACING_BEFORE;

    drawDivider(ctx, { x: bx + DIVIDER_X_OFFSET, y, length: bw - DIVIDER_LENGTH_REDUCTION });
    y += DIVIDER_Y_AFTER_HEADER;

    const entries = [...gameStats.killsByType.entries()].sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      drawText(ctx, 'No kills yet', {
        x: bx + STAT_LABEL_X,
        y: y - NO_KILLS_Y_OFFSET,
        size: NO_KILLS_SIZE,
        color: '#64748b',
      });
      y += KILL_ENTRY_LINE_HEIGHT;
    } else {
      for (const [name, count] of entries) {
        drawText(ctx, name, {
          x: bx + KILL_ENTRY_LABEL_X,
          y: y - KILL_ENTRY_Y_OFFSET,
          size: KILL_ENTRY_SIZE,
          color: '#cbd5e1',
        });
        drawText(ctx, `${count}`, {
          x: bx + bw - KILL_ENTRY_LABEL_X,
          y: y - KILL_ENTRY_Y_OFFSET,
          size: KILL_ENTRY_SIZE,
          color: '#fbbf24',
          align: 'right',
        });
        y += KILL_ENTRY_LINE_HEIGHT;
      }
    }
    y += CONTENT_SPACING_END;
  }

  const contentHeight = y;
  ctx.restore();

  // Scrollbar
  drawScrollbar(ctx, {
    x: bx + bw - SCROLLBAR_X_OFFSET,
    trackY: scrollTop,
    trackH: scrollH,
    contentH: contentHeight,
    scrollY,
    width: SCROLLBAR_WIDTH,
  });

  addButton(ctx, buttons, {
    x: bx + BACK_BTN_X_OFFSET,
    y: by + bh - BACK_BTN_H + BACK_BTN_Y_OFFSET,
    width: bw - BACK_BTN_WIDTH_REDUCTION,
    height: BACK_BTN_HEIGHT,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('main'),
  });

  return contentHeight;
}
