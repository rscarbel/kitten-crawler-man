/**
 * Lays out a {@link QuestRewardSpec} as a column of blocks, top to bottom, in
 * the screen's design pixels. Measuring and drawing share one layout, so the
 * panel is always exactly as tall as what is drawn in it.
 *
 * Section order is fixed here, not by the caller: the XP and coin chips share
 * one row, then the item lines, then each unlocks section. Every quest's screen
 * therefore reads in the same order.
 */

import { drawBox, drawDivider } from '../Box';
import { drawText, measureTextBox, measureTextWidth } from '../TextBox';
import { drawCoinRewardIcon, drawXpRewardIcon } from '../icons/rewardIcons';
import type {
  IconPainter,
  QuestRewardSection,
  QuestRewardSpec,
  RewardItemLine,
  RewardUnlockCard,
} from './types';

/** What the screen says above every quest's title. */
export const QUEST_REWARD_KICKER = 'QUEST COMPLETE';
/** The heading over the XP, coin and item rewards. */
export const QUEST_REWARD_HEADING = 'REWARDS';

const FULL_TURN = Math.PI * 2;
const TITLE_GLOW_PULSE_HZ = 0.6;
const TITLE_GLOW_MIN_BLUR = 10;
const TITLE_GLOW_BLUR_RANGE = 8;

export const QUEST_REWARD_BRASS = '#d6a64a';
export const QUEST_REWARD_BRASS_GLOW = '#fbbf24';

const ICON_SIZE = 44;
const ICON_GAP = 6;
const KICKER_SIZE = 14;
const KICKER_BLOCK_H = 22;
const KICKER_COLOR = '#a8f070';
const KICKER_GLOW = '#3a6a2a';
const TITLE_MAX_SIZE = 30;
/** Below this the title stops shrinking and wraps instead, so it stays legible. */
const TITLE_MIN_SIZE = 18;
const TITLE_LINE_H_FACTOR = 1.2;
const TITLE_BLOCK_GAP = 10;
const TITLE_COLOR = '#fcd34d';
const TITLE_OUTLINE = '#2a1804';
const TITLE_OUTLINE_WIDTH = 4;
const QUOTE_SIZE = 13;
const QUOTE_LINE_H = 18;
const QUOTE_COLOR = '#e8d9b8';
const SECTION_GAP = 14;
/** How far the divider stops short of each side of the panel's inner box. */
const DIVIDER_INSET = 12;
const DIVIDER_ALPHA = 0.6;
const HEADING_SIZE = 13;
const HEADING_BLOCK_H = 30;
const BLOCK_GAP = 10;

const CHIP_W = 156;
const CHIP_H = 40;
const CHIP_GAP = 10;
const CHIP_RADIUS = 6;
const CHIP_FILL = 'rgba(58, 39, 8, 0.72)';
const CHIP_BORDER = '#8a6a2c';
const CHIP_PAD_X = 8;
const CHIP_ICON_SIZE = 24;
const CHIP_TEXT_GAP = 8;
const CHIP_AMOUNT_SIZE = 15;
const CHIP_AMOUNT_COLOR = '#fef3c7';
/** Where the amount sits when a recipient line is drawn under it. */
const CHIP_AMOUNT_TOP_WITH_RECIPIENT = 5;
const CHIP_RECIPIENT_SIZE = 11;
const CHIP_RECIPIENT_TOP = 23;
const CHIP_RECIPIENT_COLOR = '#c8b48a';

const ITEM_PAD = 8;
const ITEM_ICON_SIZE = 32;
const ITEM_TEXT_GAP = 10;
const ITEM_GAP = 8;
const ITEM_RADIUS = 6;
const ITEM_FILL = 'rgba(58, 39, 8, 0.5)';
const ITEM_BORDER = '#6e5426';
const ITEM_NAME_SIZE = 14;
const ITEM_NAME_LINE_H = 18;
const ITEM_NAME_COLOR = '#fef3c7';
const ITEM_DESC_SIZE = 12;
const ITEM_DESC_LINE_H = 16;
const ITEM_DESC_COLOR = '#e8d9b8';
const ITEM_NOTE_SIZE = 11;
const ITEM_NOTE_LINE_H = 15;
const ITEM_NOTE_COLOR = '#a8f070';

const CARD_GAP = 12;
/** Narrower than this, a section's cards stack instead of standing side by side. */
const CARD_SIDE_BY_SIDE_MIN_WIDTH = 170;
const CARD_RADIUS = 8;
const CARD_FILL = 'rgba(58, 39, 8, 0.72)';
const CARD_BORDER = '#8a6a2c';
const CARD_PAD_X = 10;
const CARD_PAD_TOP = 9;
const CARD_PAD_BOTTOM = 10;
const CARD_ICON_SIZE = 34;
const CARD_ICON_GAP = 6;
const CARD_TITLE_SIZE = 15;
const CARD_TITLE_LINE_H = 19;
const CARD_TITLE_COLOR = '#fef3c7';
const CARD_TITLE_GAP = 4;
const CARD_LINE_SIZE = 12;
const CARD_LINE_H = 16;
const CARD_LINE_GAP = 4;
const CARD_EMPHASIS_COLOR = '#a8f070';
const CARD_PLAIN_COLOR = '#f5d58a';
const CARD_CONDITION_GAP = 6;
const CARD_CONDITION_SIZE = 11;
const CARD_CONDITION_LINE_H = 15;
const CARD_CONDITION_COLOR = '#a8987a';

const FOOTNOTE_SIZE = 11;
const FOOTNOTE_LINE_H = 15;
const FOOTNOTE_PAD_Y = 7;
const FOOTNOTE_COLOR = '#b8a888';

/** Where and how one block is drawn this frame. */
export interface BlockFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  /** The panel's own fade. */
  readonly alpha: number;
  /** How far reveal step `step` has faded in, from 0 to 1, already multiplied by the panel's fade. */
  readonly revealAlpha: (step: number) => number;
  readonly nowSeconds: number;
}

/** One horizontal slice of the panel. */
export interface RewardBlock {
  readonly height: number;
  draw(ctx: CanvasRenderingContext2D, frame: BlockFrame): void;
}

/** The whole column, and how many reveal steps its rewards fade in over. */
export interface QuestRewardLayout {
  readonly blocks: readonly RewardBlock[];
  readonly revealSteps: number;
  /** Total height of the blocks, gaps included. */
  readonly height: number;
}

const spacerBlock = (height: number): RewardBlock => ({ height, draw: () => undefined });

function paintIcon(
  ctx: CanvasRenderingContext2D,
  paint: IconPainter,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  paint(ctx, x, y, size);
  ctx.restore();
}

function lineCount(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  width: number,
  lineHeight: number,
  style: { bold?: boolean; italic?: boolean } = {},
): number {
  return measureTextBox(ctx, text, { size, width, lineHeight, ...style }).lineCount;
}

function headerBlocks(
  ctx: CanvasRenderingContext2D,
  spec: QuestRewardSpec,
  innerW: number,
): RewardBlock[] {
  const blocks: RewardBlock[] = [];
  const renderQuestIcon = spec.renderQuestIcon;
  if (renderQuestIcon !== undefined) {
    blocks.push({
      height: ICON_SIZE + ICON_GAP,
      draw: (c, f) =>
        paintIcon(c, renderQuestIcon, f.x + f.width / 2 - ICON_SIZE / 2, f.y, ICON_SIZE, f.alpha),
    });
  }
  blocks.push({
    height: KICKER_BLOCK_H,
    draw: (c, f) =>
      drawText(c, QUEST_REWARD_KICKER, {
        x: f.x + f.width / 2,
        y: f.y,
        size: KICKER_SIZE,
        bold: true,
        color: KICKER_COLOR,
        align: 'center',
        glow: KICKER_GLOW,
        alpha: f.alpha,
      }),
  });

  const titleWidthAtMax = measureTextWidth(ctx, spec.questTitle, {
    size: TITLE_MAX_SIZE,
    bold: true,
  });
  const shrunkSize = Math.floor(TITLE_MAX_SIZE * Math.min(1, innerW / titleWidthAtMax));
  const titleSize = Math.max(TITLE_MIN_SIZE, shrunkSize);
  const titleLineH = Math.ceil(titleSize * TITLE_LINE_H_FACTOR);
  const titleLines = lineCount(ctx, spec.questTitle, titleSize, innerW, titleLineH, {
    bold: true,
  });
  const titleH = Math.max(TITLE_MAX_SIZE, titleLines * titleLineH);
  blocks.push({
    height: titleH + TITLE_BLOCK_GAP,
    draw: (c, f) => {
      const glowPulse = (1 + Math.sin(f.nowSeconds * FULL_TURN * TITLE_GLOW_PULSE_HZ)) / 2;
      drawText(c, spec.questTitle, {
        x: f.x,
        y: f.y + (titleH - titleLines * titleLineH) / 2,
        size: titleSize,
        lineHeight: titleLineH,
        width: f.width,
        bold: true,
        color: TITLE_COLOR,
        align: 'center',
        glow: QUEST_REWARD_BRASS_GLOW,
        glowBlur: TITLE_GLOW_MIN_BLUR + TITLE_GLOW_BLUR_RANGE * glowPulse,
        outline: TITLE_OUTLINE,
        outlineWidth: TITLE_OUTLINE_WIDTH,
        alpha: f.alpha,
      });
    },
  });

  const quote = spec.quote;
  if (quote !== undefined) {
    const quoteText = `"${quote.text}" — ${quote.speaker}`;
    const quoteLines = lineCount(ctx, quoteText, QUOTE_SIZE, innerW, QUOTE_LINE_H, {
      italic: true,
    });
    blocks.push({
      height: quoteLines * QUOTE_LINE_H,
      draw: (c, f) =>
        drawText(c, quoteText, {
          x: f.x,
          y: f.y,
          size: QUOTE_SIZE,
          italic: true,
          color: QUOTE_COLOR,
          align: 'center',
          width: f.width,
          lineHeight: QUOTE_LINE_H,
          alpha: f.alpha,
        }),
    });
  }

  blocks.push({
    height: SECTION_GAP,
    draw: (c, f) =>
      drawDivider(c, {
        x: f.x + DIVIDER_INSET,
        y: f.y + SECTION_GAP / 2,
        length: f.width - DIVIDER_INSET * 2,
        color: QUEST_REWARD_BRASS,
        alpha: f.alpha * DIVIDER_ALPHA,
      }),
  });
  return blocks;
}

function headingBlock(text: string): RewardBlock {
  return {
    height: HEADING_BLOCK_H,
    draw: (c, f) =>
      drawText(c, text, {
        x: f.x + f.width / 2,
        y: f.y + (HEADING_BLOCK_H - HEADING_SIZE) / 2,
        size: HEADING_SIZE,
        bold: true,
        color: TITLE_COLOR,
        align: 'center',
        alpha: f.alpha,
      }),
  };
}

type ChipSection = Extract<QuestRewardSection, { kind: 'xp' | 'coins' }>;

function chipLabel(section: ChipSection): string {
  const amount = section.amount.toLocaleString();
  return section.kind === 'xp' ? `+${amount} XP` : `+${amount} coins`;
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  section: ChipSection,
  x: number,
  y: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  drawBox(ctx, {
    x,
    y,
    width: CHIP_W,
    height: CHIP_H,
    fill: CHIP_FILL,
    border: CHIP_BORDER,
    radius: CHIP_RADIUS,
    alpha,
  });
  const iconY = y + (CHIP_H - CHIP_ICON_SIZE) / 2;
  const paint = section.kind === 'xp' ? drawXpRewardIcon : drawCoinRewardIcon;
  paintIcon(ctx, paint, x + CHIP_PAD_X, iconY, CHIP_ICON_SIZE, alpha);
  const textX = x + CHIP_PAD_X + CHIP_ICON_SIZE + CHIP_TEXT_GAP;
  const textW = CHIP_W - (textX - x) - CHIP_PAD_X;
  const recipient = section.kind === 'xp' ? section.recipient : undefined;
  drawText(ctx, chipLabel(section), {
    x: textX,
    y:
      recipient === undefined
        ? y + (CHIP_H - CHIP_AMOUNT_SIZE) / 2
        : y + CHIP_AMOUNT_TOP_WITH_RECIPIENT,
    size: CHIP_AMOUNT_SIZE,
    bold: true,
    color: CHIP_AMOUNT_COLOR,
    width: textW,
    lineHeight: CHIP_H,
    height: CHIP_H,
    alpha,
  });
  if (recipient !== undefined) {
    drawText(ctx, recipient, {
      x: textX,
      y: y + CHIP_RECIPIENT_TOP,
      size: CHIP_RECIPIENT_SIZE,
      color: CHIP_RECIPIENT_COLOR,
      width: textW,
      lineHeight: CHIP_H,
      height: CHIP_H,
      alpha,
    });
  }
}

/** The XP and coin chips, flowed into as many centred rows as the width needs. */
function chipBlock(chips: readonly ChipSection[], innerW: number, step: number): RewardBlock {
  const perRow = Math.max(1, Math.floor((innerW + CHIP_GAP) / (CHIP_W + CHIP_GAP)));
  const rows = Math.ceil(chips.length / perRow);
  return {
    height: rows * CHIP_H + (rows - 1) * CHIP_GAP,
    draw: (c, f) => {
      const alpha = f.revealAlpha(step);
      for (let row = 0; row < rows; row++) {
        const rowChips = chips.slice(row * perRow, (row + 1) * perRow);
        const rowW = rowChips.length * CHIP_W + (rowChips.length - 1) * CHIP_GAP;
        const rowX = f.x + (f.width - rowW) / 2;
        const rowY = f.y + row * (CHIP_H + CHIP_GAP);
        rowChips.forEach((chip, index) =>
          drawChip(c, chip, rowX + index * (CHIP_W + CHIP_GAP), rowY, alpha),
        );
      }
    },
  };
}

function itemName(item: RewardItemLine): string {
  return item.count > 1 ? `${item.name} ×${item.count}` : item.name;
}

function itemBlock(
  ctx: CanvasRenderingContext2D,
  item: RewardItemLine,
  innerW: number,
  step: number,
): RewardBlock {
  const textW = innerW - ITEM_PAD * 2 - ITEM_ICON_SIZE - ITEM_TEXT_GAP;
  const name = itemName(item);
  const nameH =
    lineCount(ctx, name, ITEM_NAME_SIZE, textW, ITEM_NAME_LINE_H, { bold: true }) *
    ITEM_NAME_LINE_H;
  const description = item.description;
  const descH =
    description === undefined || description === ''
      ? 0
      : lineCount(ctx, description, ITEM_DESC_SIZE, textW, ITEM_DESC_LINE_H) * ITEM_DESC_LINE_H;
  const note = item.note;
  const noteH =
    note === undefined
      ? 0
      : lineCount(ctx, note, ITEM_NOTE_SIZE, textW, ITEM_NOTE_LINE_H, { italic: true }) *
        ITEM_NOTE_LINE_H;
  const textH = nameH + descH + noteH;
  const boxH = Math.max(ITEM_ICON_SIZE, textH) + ITEM_PAD * 2;
  return {
    height: boxH + ITEM_GAP,
    draw: (c, f) => {
      const alpha = f.revealAlpha(step);
      if (alpha <= 0) return;
      drawBox(c, {
        x: f.x,
        y: f.y,
        width: f.width,
        height: boxH,
        fill: ITEM_FILL,
        border: ITEM_BORDER,
        radius: ITEM_RADIUS,
        alpha,
      });
      paintIcon(
        c,
        item.renderIcon,
        f.x + ITEM_PAD,
        f.y + (boxH - ITEM_ICON_SIZE) / 2,
        ITEM_ICON_SIZE,
        alpha,
      );
      const textX = f.x + ITEM_PAD + ITEM_ICON_SIZE + ITEM_TEXT_GAP;
      let textY = f.y + (boxH - textH) / 2;
      drawText(c, name, {
        x: textX,
        y: textY,
        size: ITEM_NAME_SIZE,
        bold: true,
        color: ITEM_NAME_COLOR,
        width: textW,
        lineHeight: ITEM_NAME_LINE_H,
        alpha,
      });
      textY += nameH;
      if (description !== undefined && descH > 0) {
        drawText(c, description, {
          x: textX,
          y: textY,
          size: ITEM_DESC_SIZE,
          color: ITEM_DESC_COLOR,
          width: textW,
          lineHeight: ITEM_DESC_LINE_H,
          alpha,
        });
        textY += descH;
      }
      if (note !== undefined) {
        drawText(c, note, {
          x: textX,
          y: textY,
          size: ITEM_NOTE_SIZE,
          italic: true,
          color: ITEM_NOTE_COLOR,
          width: textW,
          lineHeight: ITEM_NOTE_LINE_H,
          alpha,
        });
      }
    },
  };
}

/** One card's measured text, so drawing never re-wraps what layout already wrapped. */
interface MeasuredCard {
  readonly card: RewardUnlockCard;
  readonly titleH: number;
  readonly bodyHs: readonly number[];
  readonly conditionH: number;
  readonly height: number;
}

function measureCard(
  ctx: CanvasRenderingContext2D,
  card: RewardUnlockCard,
  cardW: number,
): MeasuredCard {
  const textW = cardW - CARD_PAD_X * 2;
  const titleH =
    lineCount(ctx, card.title, CARD_TITLE_SIZE, textW, CARD_TITLE_LINE_H, { bold: true }) *
    CARD_TITLE_LINE_H;
  const bodyHs = card.body.map(
    (line) =>
      lineCount(ctx, line.text, CARD_LINE_SIZE, textW, CARD_LINE_H, {
        bold: line.emphasis === true,
      }) * CARD_LINE_H,
  );
  const bodyH = bodyHs.reduce((total, h) => total + h + CARD_LINE_GAP, 0);
  const condition = card.condition;
  const conditionH =
    condition === undefined
      ? 0
      : lineCount(ctx, condition, CARD_CONDITION_SIZE, textW, CARD_CONDITION_LINE_H, {
          italic: true,
        }) * CARD_CONDITION_LINE_H;
  const height =
    CARD_PAD_TOP +
    CARD_ICON_SIZE +
    CARD_ICON_GAP +
    titleH +
    CARD_TITLE_GAP +
    bodyH +
    (conditionH > 0 ? CARD_CONDITION_GAP + conditionH : 0) +
    CARD_PAD_BOTTOM;
  return { card, titleH, bodyHs, conditionH, height };
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  measured: MeasuredCard,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const { card } = measured;
  drawBox(ctx, {
    x,
    y,
    width,
    height,
    fill: CARD_FILL,
    border: CARD_BORDER,
    radius: CARD_RADIUS,
    alpha,
  });
  const textX = x + CARD_PAD_X;
  const textW = width - CARD_PAD_X * 2;
  let cursor = y + CARD_PAD_TOP;
  paintIcon(
    ctx,
    card.renderIcon,
    x + width / 2 - CARD_ICON_SIZE / 2,
    cursor,
    CARD_ICON_SIZE,
    alpha,
  );
  cursor += CARD_ICON_SIZE + CARD_ICON_GAP;
  drawText(ctx, card.title, {
    x: textX,
    y: cursor,
    size: CARD_TITLE_SIZE,
    bold: true,
    color: CARD_TITLE_COLOR,
    align: 'center',
    width: textW,
    lineHeight: CARD_TITLE_LINE_H,
    alpha,
  });
  cursor += measured.titleH + CARD_TITLE_GAP;
  card.body.forEach((line, index) => {
    const emphasis = line.emphasis === true;
    drawText(ctx, line.text, {
      x: textX,
      y: cursor,
      size: CARD_LINE_SIZE,
      bold: emphasis,
      color: emphasis ? CARD_EMPHASIS_COLOR : CARD_PLAIN_COLOR,
      align: 'center',
      width: textW,
      lineHeight: CARD_LINE_H,
      alpha,
    });
    cursor += (measured.bodyHs[index] ?? 0) + CARD_LINE_GAP;
  });
  const condition = card.condition;
  if (condition !== undefined) {
    drawText(ctx, condition, {
      x: textX,
      y: cursor + CARD_CONDITION_GAP,
      size: CARD_CONDITION_SIZE,
      italic: true,
      color: CARD_CONDITION_COLOR,
      align: 'center',
      width: textW,
      lineHeight: CARD_CONDITION_LINE_H,
      alpha,
    });
  }
}

/**
 * A section's cards, side by side when each still gets a readable width,
 * otherwise stacked. Side by side, every card takes the tallest one's height
 * so the row reads as one.
 */
function cardBlocks(
  ctx: CanvasRenderingContext2D,
  cards: readonly RewardUnlockCard[],
  innerW: number,
  firstStep: number,
): RewardBlock[] {
  if (cards.length === 0) return [];
  const sideBySideW = (innerW - CARD_GAP * (cards.length - 1)) / cards.length;
  if (sideBySideW >= CARD_SIDE_BY_SIDE_MIN_WIDTH) {
    const measured = cards.map((card) => measureCard(ctx, card, sideBySideW));
    const rowH = Math.max(...measured.map((card) => card.height));
    return [
      {
        height: rowH,
        draw: (c, f) =>
          measured.forEach((card, index) =>
            drawCard(
              c,
              card,
              f.x + index * (sideBySideW + CARD_GAP),
              f.y,
              sideBySideW,
              rowH,
              f.revealAlpha(firstStep + index),
            ),
          ),
      },
    ];
  }
  return cards.map((card, index) => {
    const measured = measureCard(ctx, card, innerW);
    const isLast = index === cards.length - 1;
    return {
      height: measured.height + (isLast ? 0 : CARD_GAP),
      draw: (c, f) =>
        drawCard(c, measured, f.x, f.y, f.width, measured.height, f.revealAlpha(firstStep + index)),
    };
  });
}

function footnoteBlock(
  ctx: CanvasRenderingContext2D,
  footnote: string,
  innerW: number,
): RewardBlock {
  const lines = lineCount(ctx, footnote, FOOTNOTE_SIZE, innerW, FOOTNOTE_LINE_H);
  return {
    height: lines * FOOTNOTE_LINE_H + FOOTNOTE_PAD_Y * 2,
    draw: (c, f) =>
      drawText(c, footnote, {
        x: f.x,
        y: f.y + FOOTNOTE_PAD_Y,
        size: FOOTNOTE_SIZE,
        color: FOOTNOTE_COLOR,
        align: 'center',
        width: f.width,
        lineHeight: FOOTNOTE_LINE_H,
        alpha: f.alpha,
      }),
  };
}

/**
 * How many staggered steps `spec`'s rewards fade in over: the chip row is one,
 * and every item line and every unlock card is one more.
 */
export function questRewardRevealSteps(spec: QuestRewardSpec): number {
  let hasChips = false;
  let steps = 0;
  for (const section of spec.sections) {
    if (section.kind === 'xp' || section.kind === 'coins') hasChips = true;
    else if (section.kind === 'items') steps += section.items.length;
    else steps += section.cards.length;
  }
  return steps + (hasChips ? 1 : 0);
}

/** Lays `spec` out at an inner panel width of `innerW` design pixels. */
export function layoutQuestReward(
  ctx: CanvasRenderingContext2D,
  spec: QuestRewardSpec,
  innerW: number,
): QuestRewardLayout {
  const blocks: RewardBlock[] = headerBlocks(ctx, spec, innerW);
  let step = 0;

  const chips: ChipSection[] = [];
  const items: RewardItemLine[] = [];
  const unlocks: Extract<QuestRewardSection, { kind: 'unlocks' }>[] = [];
  for (const section of spec.sections) {
    if (section.kind === 'xp' || section.kind === 'coins') chips.push(section);
    else if (section.kind === 'items') items.push(...section.items);
    else unlocks.push(section);
  }

  if (chips.length > 0 || items.length > 0) {
    blocks.push(headingBlock(QUEST_REWARD_HEADING));
    if (chips.length > 0) {
      blocks.push(chipBlock(chips, innerW, step));
      step++;
      blocks.push(spacerBlock(BLOCK_GAP));
    }
    for (const item of items) {
      blocks.push(itemBlock(ctx, item, innerW, step));
      step++;
    }
  }

  for (const section of unlocks) {
    blocks.push(headingBlock(section.heading));
    blocks.push(...cardBlocks(ctx, section.cards, innerW, step));
    step += section.cards.length;
    blocks.push(spacerBlock(BLOCK_GAP));
  }

  const footnote = spec.footnote;
  if (footnote !== undefined) blocks.push(footnoteBlock(ctx, footnote, innerW));

  const height = blocks.reduce((total, block) => total + block.height, 0);
  return { blocks, revealSteps: step, height };
}
