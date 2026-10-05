/**
 * The quest-complete screen: a brass plaque naming the quest, the giver's
 * line, then what finishing it paid — XP and coin chips, item lines, unlock
 * cards — each fading in on a stagger, and a Continue button.
 *
 * The queue, the open conditions and the reveal timeline belong to
 * {@link QuestRewardScreen}; this surface draws it and advances its timeline
 * one step per render frame.
 *
 * - Band `system`; halts the world and locks the keyboard.
 * - While the reveal is still playing, a tap anywhere but an item slot
 *   finishes it. Once it has settled, only Continue leaves; a tap elsewhere
 *   does nothing.
 * - Enter or Space presses Continue (the primary control). Escape does what
 *   Continue does. Every other key is swallowed.
 * - The click sound comes from the model's `advance`, so no region here plays
 *   one of its own.
 */

import type { QuestRewardScreen } from '../../questReward/QuestRewardScreen';
import { QUEST_REWARD_CONTINUE_LABEL } from '../../questReward/QuestRewardScreen';
import { QUEST_REWARD_HEADING, QUEST_REWARD_KICKER } from '../../questReward/questRewardLayout';
import type {
  IconPainter,
  QuestRewardSection,
  QuestRewardSpec,
  RewardItemLine,
  RewardUnlockCard,
} from '../../questReward/types';
import { centerIn, grid, inset, splitH, splitV, type Rect } from '../../core/geom';
import { ACTIVATE_KEYS, FOCUS_MOVE_KEYS, type Surface, type Ui } from '../../core/UiRoot';
import { drawCoinRewardIcon, drawXpRewardIcon } from '../../icons/rewardIcons';
import { skinsFor, type BrassSkin } from '../../theme/skins';
import { itemSlot } from '../../widgets/itemSlot';
import { fillRounded, roundRectPath, strokeRounded } from '../../widgets/paint';
import { panel, type FooterButton, type PanelOptions } from '../../widgets/panel';
import { lineHeightOf, measureTextHeight, text, type TextOptions } from '../../widgets/text';
import { fitPanelBody } from './endScreenParts';

const QUEST_ICON_SIZE = 44;
const CHIP_MIN_WIDTH = 156;
const CHIP_ICON_SIZE = 24;
const ITEM_SLOT_SIZE = 40;
const CARD_ICON_SIZE = 34;
/** Narrower than this, a section's unlock cards stack instead of standing side by side. */
const CARD_SIDE_BY_SIDE_MIN_WIDTH = 170;
const PLATE_EDGE_WIDTH = 1.5;
/** Where down the plate its gradient passes through the plain brass face. */
const PLATE_FACE_STOP = 0.5;
const BORDER_WIDTH = 1;
/** How far in from the plate's edge the engraved inner line runs. */
const PLATE_ENGRAVE_INSET = 4;
const PLATE_ENGRAVE_WIDTH = 1;
const PLATE_ENGRAVE_ALPHA = 0.5;

/** One horizontal slice of the body; `draw` gets its rect and its reveal alpha. */
interface Block {
  readonly height: number;
  /** The reveal step it fades in on, or null for the header, which fades with the panel. */
  readonly step: number | null;
  draw(rect: Rect): void;
}

interface Layout {
  readonly blocks: readonly Block[];
  readonly height: number;
}

type ChipSection = Extract<QuestRewardSection, { kind: 'xp' | 'coins' }>;

function paintIcon(ui: Ui, paint: IconPainter, rect: Rect): void {
  ui.ctx.save();
  paint(ui.ctx, rect);
  ui.ctx.restore();
}

function drawBrassPlate(ui: Ui, rect: Rect, skin: BrassSkin): void {
  const { ctx } = ui;
  const gradient = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  gradient.addColorStop(0, skin.highlight);
  gradient.addColorStop(PLATE_FACE_STOP, skin.face);
  gradient.addColorStop(1, skin.shadow);
  ctx.save();
  ctx.fillStyle = gradient;
  roundRectPath(ctx, rect, skin.radius);
  ctx.fill();
  ctx.globalAlpha *= PLATE_ENGRAVE_ALPHA;
  strokeRounded(
    ctx,
    inset(rect, PLATE_ENGRAVE_INSET),
    Math.max(0, skin.radius - PLATE_ENGRAVE_INSET),
    skin.engraved,
    PLATE_ENGRAVE_WIDTH,
  );
  ctx.restore();
  strokeRounded(ctx, rect, skin.radius, skin.edge, PLATE_EDGE_WIDTH);
}

function wrapped(ui: Ui, width: number, opts: Omit<TextOptions, 'wrap'>): number {
  return measureTextHeight(ui, width, opts);
}

function headerBlocks(ui: Ui, spec: QuestRewardSpec, width: number): Block[] {
  const { space } = ui.theme;
  const brass = skinsFor(ui.theme).questRewardBrass;
  const blocks: Block[] = [];
  const questIcon = spec.renderQuestIcon;
  if (questIcon !== undefined) {
    blocks.push({
      height: QUEST_ICON_SIZE + space.xs,
      step: null,
      draw: (rect) => paintIcon(ui, questIcon, { ...rect, h: QUEST_ICON_SIZE }),
    });
  }
  const plateInner = width - space.lg * 2;
  const overlineH = lineHeightOf(ui, 'overline');
  const titleH = wrapped(ui, plateInner, { text: spec.questTitle, role: 'heading' });
  blocks.push({
    height: space.md * 2 + overlineH + space.xxs + titleH + space.md,
    step: null,
    draw: (rect) => {
      const plate = { ...rect, h: rect.h - space.md };
      drawBrassPlate(ui, plate, brass);
      const inner = inset(plate, { l: space.lg, r: space.lg, t: space.md, b: space.md });
      const [overRow, titleRow] = splitV(inner, [overlineH, titleH], space.xxs);
      text(ui, overRow, {
        text: QUEST_REWARD_KICKER,
        role: 'overline',
        color: brass.engraved,
        align: 'center',
      });
      text(ui, titleRow, {
        text: spec.questTitle,
        role: 'heading',
        color: brass.text,
        align: 'center',
        wrap: true,
      });
    },
  });
  const quote = spec.quote;
  if (quote !== undefined) {
    const quoteText = `“${quote.text}” — ${quote.speaker}`;
    blocks.push({
      height: wrapped(ui, width, { text: quoteText, role: 'secondary' }) + space.md,
      step: null,
      draw: (rect) =>
        text(ui, rect, { text: quoteText, role: 'secondary', align: 'center', wrap: true }),
    });
  }
  return blocks;
}

function headingBlock(ui: Ui, heading: string): Block {
  const { space } = ui.theme;
  return {
    height: lineHeightOf(ui, 'overline') + space.sm,
    step: null,
    draw: (rect) =>
      text(ui, rect, {
        text: heading,
        role: 'overline',
        color: ui.theme.palette.accent.base,
        align: 'center',
        valign: 'top',
      }),
  };
}

function chipLabel(section: ChipSection): string {
  const amount = section.amount.toLocaleString();
  return section.kind === 'xp' ? `+${amount} XP` : `+${amount} coins`;
}

function drawChip(ui: Ui, rect: Rect, section: ChipSection): void {
  const { palette, radius, space } = ui.theme;
  fillRounded(ui.ctx, rect, radius.md, palette.surface.raised);
  strokeRounded(ui.ctx, rect, radius.md, palette.border.strong, BORDER_WIDTH);
  const content = inset(rect, { l: space.sm, r: space.sm });
  const [iconRect, textRect] = splitH(content, [CHIP_ICON_SIZE, 'fill'], space.sm);
  paintIcon(ui, section.kind === 'xp' ? drawXpRewardIcon : drawCoinRewardIcon, iconRect);
  const recipient = section.kind === 'xp' ? section.recipient : undefined;
  if (recipient === undefined) {
    text(ui, textRect, { text: chipLabel(section), role: 'label', tabular: true });
    return;
  }
  const amountH = lineHeightOf(ui, 'label');
  const nameH = lineHeightOf(ui, 'caption');
  const stack = centerIn(textRect, textRect.w, amountH + nameH);
  const [amountRow, nameRow] = splitV(stack, [amountH, nameH], 0);
  text(ui, amountRow, { text: chipLabel(section), role: 'label', tabular: true });
  text(ui, nameRow, { text: recipient, role: 'caption' });
}

function chipBlock(ui: Ui, chips: readonly ChipSection[], width: number, step: number): Block {
  const { space, size } = ui.theme;
  const perRow = Math.max(1, Math.floor((width + space.sm) / (CHIP_MIN_WIDTH + space.sm)));
  const rows = Math.ceil(chips.length / perRow);
  const chipH = size.row;
  return {
    height: rows * chipH + (rows - 1) * space.sm + space.md,
    step,
    draw: (rect) => {
      for (let row = 0; row < rows; row++) {
        const rowChips = chips.slice(row * perRow, (row + 1) * perRow);
        const rowW = rowChips.length * CHIP_MIN_WIDTH + (rowChips.length - 1) * space.sm;
        const rowRect: Rect = {
          x: rect.x + (rect.w - rowW) / 2,
          y: rect.y + row * (chipH + space.sm),
          w: rowW,
          h: chipH,
        };
        const cells = grid(rowRect, rowChips.length, {
          minCell: CHIP_MIN_WIDTH,
          gap: space.sm,
          aspect: CHIP_MIN_WIDTH / chipH,
        });
        rowChips.forEach((chip, index) => {
          drawChip(ui, cells[index], chip);
        });
      }
    },
  };
}

function itemName(item: RewardItemLine): string {
  return item.count > 1 ? `${item.name} ×${item.count}` : item.name;
}

function itemBlock(ui: Ui, item: RewardItemLine, width: number, step: number, id: string): Block {
  const { palette, radius, space } = ui.theme;
  const pad = space.sm;
  const textW = width - pad * 2 - ITEM_SLOT_SIZE - space.md;
  const name = itemName(item);
  const nameH = wrapped(ui, textW, { text: name, role: 'label' });
  const description = item.description ?? '';
  const descH = description === '' ? 0 : wrapped(ui, textW, { text: description, role: 'caption' });
  const note = item.note;
  const noteH = note === undefined ? 0 : wrapped(ui, textW, { text: note, role: 'caption' });
  const textH = nameH + descH + noteH;
  const boxH = Math.max(ITEM_SLOT_SIZE, textH) + pad * 2;
  return {
    height: boxH + space.sm,
    step,
    draw: (rect) => {
      const box = { ...rect, h: boxH };
      fillRounded(ui.ctx, box, radius.md, palette.surface.raised);
      strokeRounded(ui.ctx, box, radius.md, palette.border.subtle, BORDER_WIDTH);
      const inner = inset(box, pad);
      const [slotCol, textCol] = splitH(inner, [ITEM_SLOT_SIZE, 'fill'], space.md);
      const slot = centerIn(slotCol, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE);
      const itemId = item.itemId;
      if (itemId !== undefined) {
        itemSlot(ui, slot, { id, item: itemId, tooltip: descH === 0 });
      } else {
        itemSlot(ui, slot, { id, item: null, categoryAccent: false });
        paintIcon(ui, item.renderIcon, inset(slot, space.xs));
      }
      const textBlock = centerIn(textCol, textCol.w, textH);
      const [nameRow, descRow, noteRow] = splitV(textBlock, [nameH, descH, noteH], 0);
      text(ui, nameRow, { text: name, role: 'label', wrap: true });
      if (descH > 0) text(ui, descRow, { text: description, role: 'caption', wrap: true });
      if (note !== undefined) {
        text(ui, noteRow, {
          text: note,
          role: 'caption',
          color: palette.state.success,
          wrap: true,
        });
      }
    },
  };
}

interface MeasuredCard {
  readonly card: RewardUnlockCard;
  readonly titleH: number;
  readonly bodyHs: readonly number[];
  readonly conditionH: number;
  readonly height: number;
}

function cardLineRole(emphasis: boolean): 'label' | 'caption' {
  return emphasis ? 'label' : 'caption';
}

function measureCard(ui: Ui, card: RewardUnlockCard, cardW: number): MeasuredCard {
  const { space } = ui.theme;
  const textW = cardW - space.md * 2;
  const titleH = wrapped(ui, textW, { text: card.title, role: 'title' });
  const bodyHs = card.body.map((line) =>
    wrapped(ui, textW, { text: line.text, role: cardLineRole(line.emphasis === true) }),
  );
  const bodyH = bodyHs.reduce((total, h) => total + h + space.xxs, 0);
  const condition = card.condition;
  const conditionH =
    condition === undefined ? 0 : wrapped(ui, textW, { text: condition, role: 'muted' });
  const height =
    space.md +
    CARD_ICON_SIZE +
    space.xs +
    titleH +
    space.xs +
    bodyH +
    (conditionH > 0 ? space.xs + conditionH : 0) +
    space.md;
  return { card, titleH, bodyHs, conditionH, height };
}

function drawCard(ui: Ui, measured: MeasuredCard, rect: Rect): void {
  const { palette, radius, space } = ui.theme;
  const { card } = measured;
  fillRounded(ui.ctx, rect, radius.md, palette.surface.raised);
  strokeRounded(ui.ctx, rect, radius.md, palette.border.strong, BORDER_WIDTH);
  const inner = inset(rect, { l: space.md, r: space.md, t: space.md });
  let y = inner.y;
  paintIcon(ui, card.renderIcon, { x: inner.x, y, w: inner.w, h: CARD_ICON_SIZE });
  y += CARD_ICON_SIZE + space.xs;
  text(
    ui,
    { x: inner.x, y, w: inner.w, h: measured.titleH },
    {
      text: card.title,
      role: 'title',
      align: 'center',
      wrap: true,
    },
  );
  y += measured.titleH + space.xs;
  card.body.forEach((line, index) => {
    const h = measured.bodyHs[index] ?? 0;
    const emphasis = line.emphasis === true;
    text(
      ui,
      { x: inner.x, y, w: inner.w, h },
      {
        text: line.text,
        role: cardLineRole(emphasis),
        color: emphasis ? palette.state.success : undefined,
        align: 'center',
        wrap: true,
      },
    );
    y += h + space.xxs;
  });
  const condition = card.condition;
  if (condition !== undefined) {
    text(
      ui,
      { x: inner.x, y: y + space.xs, w: inner.w, h: measured.conditionH },
      {
        text: condition,
        role: 'muted',
        align: 'center',
        wrap: true,
      },
    );
  }
}

function cardBlocks(
  ui: Ui,
  cards: readonly RewardUnlockCard[],
  width: number,
  firstStep: number,
): Block[] {
  if (cards.length === 0) return [];
  const { space } = ui.theme;
  const sideBySideW = (width - space.md * (cards.length - 1)) / cards.length;
  if (sideBySideW >= CARD_SIDE_BY_SIDE_MIN_WIDTH) {
    const measured = cards.map((card) => measureCard(ui, card, sideBySideW));
    const rowH = Math.max(...measured.map((card) => card.height));
    const lastIndex = measured.length - 1;
    // Every card but the last takes no height, so the row's cards share one top and each keeps its own reveal step.
    return measured.map((card, index) => ({
      height: index === lastIndex ? rowH + space.md : 0,
      step: firstStep + index,
      draw: (rect) =>
        drawCard(ui, card, {
          x: rect.x + index * (sideBySideW + space.md),
          y: rect.y,
          w: sideBySideW,
          h: rowH,
        }),
    }));
  }
  return cards.map((card, index) => {
    const measured = measureCard(ui, card, width);
    return {
      height: measured.height + space.md,
      step: firstStep + index,
      draw: (rect) => drawCard(ui, measured, { ...rect, h: measured.height }),
    };
  });
}

function footnoteBlock(ui: Ui, footnote: string, width: number): Block {
  return {
    height: wrapped(ui, width, { text: footnote, role: 'muted' }) + ui.theme.space.sm,
    step: null,
    draw: (rect) =>
      text(ui, inset(rect, { t: ui.theme.space.sm }), {
        text: footnote,
        role: 'muted',
        align: 'center',
        wrap: true,
      }),
  };
}

function layout(ui: Ui, spec: QuestRewardSpec, width: number): Layout {
  const blocks: Block[] = headerBlocks(ui, spec, width);
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
    blocks.push(headingBlock(ui, QUEST_REWARD_HEADING));
    if (chips.length > 0) {
      blocks.push(chipBlock(ui, chips, width, step));
      step++;
    }
    items.forEach((item, index) => {
      blocks.push(itemBlock(ui, item, width, step, `item-${index}`));
      step++;
    });
  }
  for (const section of unlocks) {
    blocks.push(headingBlock(ui, section.heading));
    blocks.push(...cardBlocks(ui, section.cards, width, step));
    step += section.cards.length;
  }
  const footnote = spec.footnote;
  if (footnote !== undefined) blocks.push(footnoteBlock(ui, footnote, width));
  const height = blocks.reduce((total, block) => total + block.height, 0);
  return { blocks, height };
}

function render(ui: Ui, model: QuestRewardScreen): void {
  const spec = model.showing;
  if (spec === null) return;
  model.advanceFrame();
  const footer: FooterButton[] = [
    {
      id: 'continue',
      label: QUEST_REWARD_CONTINUE_LABEL,
      variant: 'primary',
      primary: true,
      sound: null,
      onTap: () => model.advance(),
    },
  ];
  const panelOpts: Pick<PanelOptions, 'width' | 'footer' | 'footerSize'> = {
    width: 'md',
    footer,
    footerSize: 'lg',
  };
  const fit = fitPanelBody(ui, panelOpts, (width) => layout(ui, spec, width).height);
  const finishReveal = model.isSettled ? undefined : (): void => model.advance();
  ui.ctx.globalAlpha *= model.fadeIn;
  panel(ui, {
    ...panelOpts,
    id: 'quest-reward',
    height: 'content',
    contentHeight: fit.contentHeight,
    footerLayout: 'fill',
    scrollBody: fit.scroll,
    onScrimTap: finishReveal,
    onCardTap: finishReveal,
    content: (body) => {
      const laid = layout(ui, spec, body.w);
      let y = body.y;
      for (const block of laid.blocks) {
        const rect: Rect = { x: body.x, y, w: body.w, h: block.height };
        y += block.height;
        const alpha = block.step === null ? 1 : model.revealProgress(block.step);
        if (alpha <= 0) continue;
        ui.ctx.save();
        ui.ctx.globalAlpha *= alpha;
        block.draw(rect);
        ui.ctx.restore();
      }
    },
  });
}

/** The quest-complete screen over the scene's one `QuestRewardScreen`. */
export function questRewardSurface(
  model: QuestRewardScreen,
  opts: { readonly id?: string } = {},
): Surface {
  return {
    id: opts.id ?? 'quest-reward',
    band: 'system',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: () => model.isOpen,
    onKey: (key, mods) =>
      ACTIVATE_KEYS.has(key) || FOCUS_MOVE_KEYS.has(key)
        ? false
        : model.handleKeyDown(key, mods.repeat === true),
    render: (ui) => render(ui, model),
  };
}
