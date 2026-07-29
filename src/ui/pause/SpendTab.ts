import { type Player, type StatName, CON_HP_BONUS_PER_POINT } from '../../Player';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, drawButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';
import { drawDivider, drawScrollbar } from '../Box';

// Stat card layout
const CARD_H = 70;
const CARD_GAP = 6;
const BTN_W = 32;
const BTN_H = 26;
const CARD_BORDER_WIDTH = 3;
const CARD_PADDING = 10;
const CARD_RIGHT_EDGE_OFFSET = 8;
const CARD_NAME_Y = 9;
const CARD_NAME_SIZE = 12;
const CARD_LEVEL_LABEL_Y = 9;
const CARD_LEVEL_LABEL_SIZE = 8;
const CARD_LEVEL_VALUE_Y = 22;
const CARD_LEVEL_VALUE_SIZE = 13;
const CARD_DESC_Y = 40;
const CARD_DESC_SIZE = 10;
const CARD_DESC_WIDTH_BTN_OFFSET = 24;
const CARD_BTN_X_OFFSET = 8;
const CARD_BTN_Y_OFFSET = 40;

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
const SCROLL_ITEM_MARGIN_Y = 20;
const SCROLL_ITEM_EXTRA_SPACE = 14;

// Character section
const CHAR_LABEL_X = 20;
const CHAR_LABEL_SIZE = 13;
const CHAR_POINTS_LABEL_X_OFFSET = 20;
const CHAR_POINTS_LABEL_SIZE = 11;
const CHAR_NO_POINTS_Y_OFFSET = 1;
const CHAR_NO_POINTS_SIZE = 10;

// Stat cards layout
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

type StatDef = {
  /** Stat this card invests in; null for the human-only Explosives Handling track. */
  statName: StatName | null;
  name: string;
  description: string;
  /**
   * Shown in place of the description when the System refuses to allocate points
   * into this stat for this crawler.
   */
  lockedNote?: string;
  accent: string;
  dimBorder: string;
  cardBg: string;
  getValue: (p: Player) => number;
  /** Invests one banked level-up point into this card's stat. */
  spend: (p: Player) => void;
};

const spendStrength = (p: Player): void => p.spendPoint('strength');
const spendIntelligence = (p: Player): void => p.spendPoint('intelligence');
const spendConstitution = (p: Player): void => p.spendPoint('constitution');
const spendDexterity = (p: Player): void => p.spendPoint('dexterity');
const spendExplosivesHandling = (p: Player): void => {
  if (p instanceof HumanPlayer) p.spendPoint('explosivesHandling');
};

const HUMAN_STAT_DEFS: StatDef[] = [
  {
    statName: 'strength',
    name: 'Strength',
    description: 'Hit harder. Each point raises melee damage by 1.',
    accent: '#f97316',
    dimBorder: 'rgba(249,115,22,0.22)',
    cardBg: '#160b02',
    getValue: (p) => p.strength,
    spend: spendStrength,
  },
  {
    statName: null,
    name: 'Explosives Handling',
    description: 'Bigger booms. Boosts dynamite damage & throw range.',
    accent: '#fbbf24',
    dimBorder: 'rgba(251,191,36,0.22)',
    cardBg: '#16110a',
    getValue: (p) => (p instanceof HumanPlayer ? p.explosivesHandling : 0),
    spend: spendExplosivesHandling,
  },
  {
    statName: 'constitution',
    name: 'Constitution',
    description: `Toughen up. Each point grants +${CON_HP_BONUS_PER_POINT} maximum HP.`,
    accent: '#4ade80',
    dimBorder: 'rgba(74,222,128,0.22)',
    cardBg: '#031208',
    getValue: (p) => p.constitution,
    spend: spendConstitution,
  },
  {
    statName: 'dexterity',
    name: 'Dexterity',
    description: 'Stay untouched. Each point improves your chance to dodge an attack.',
    accent: '#22d3ee',
    dimBorder: 'rgba(34,211,238,0.22)',
    cardBg: '#04141a',
    getValue: (p) => p.dexterity,
    spend: spendDexterity,
  },
];

const CAT_STAT_DEFS: StatDef[] = [
  {
    statName: 'strength',
    name: 'Strength',
    description: 'Sharper claws. Each point raises claw attack damage.',
    accent: '#f97316',
    dimBorder: 'rgba(249,115,22,0.22)',
    cardBg: '#160b02',
    getValue: (p) => p.strength,
    spend: spendStrength,
  },
  {
    statName: 'intelligence',
    name: 'Intelligence',
    description: 'Think bigger. Amplifies magic missile power & range.',
    accent: '#818cf8',
    dimBorder: 'rgba(129,140,248,0.22)',
    cardBg: '#08061a',
    getValue: (p) => p.intelligence,
    spend: spendIntelligence,
  },
  {
    statName: 'constitution',
    name: 'Constitution',
    description: `Nine lives. Each point grants +${CON_HP_BONUS_PER_POINT} maximum HP.`,
    lockedNote:
      'Attribute locked by the System. Pet biscuit enhancement is permanent and non-negotiable.',
    accent: '#4ade80',
    dimBorder: 'rgba(74,222,128,0.22)',
    cardBg: '#031208',
    getValue: (p) => p.constitution,
    spend: spendConstitution,
  },
  {
    statName: 'dexterity',
    name: 'Dexterity',
    description: 'Feline grace. Each point improves your chance to dodge an attack.',
    lockedNote: 'Auto-allocated by Enhanced Growth on level-up. No input required.',
    accent: '#22d3ee',
    dimBorder: 'rgba(34,211,238,0.22)',
    cardBg: '#04141a',
    getValue: (p) => p.dexterity,
    spend: spendDexterity,
  },
];

function renderStatCard(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  localX: number,
  localY: number,
  scrollTop: number,
  scrollY: number,
  scrollH: number,
  w: number,
  stat: StatDef,
  player: Player,
  hasPoints: boolean,
  onSpend?: () => void,
): void {
  // Locked cards read like the dimmed no-points state — the difference is that
  // no amount of banked points will ever open them.
  const isLocked = stat.statName !== null && !player.canSpendPointInto(stat.statName);
  const canInvest = hasPoints && !isLocked;

  ctx.fillStyle = canInvest ? stat.cardBg : '#0c1118';
  ctx.fillRect(localX, localY, w, CARD_H);

  ctx.fillStyle = canInvest ? stat.accent : '#475569';
  ctx.fillRect(localX, localY, CARD_BORDER_WIDTH, CARD_H);

  ctx.strokeStyle = canInvest ? stat.dimBorder : 'rgba(51,65,85,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(localX, localY, w, CARD_H);

  const textX = localX + CARD_BORDER_WIDTH + CARD_PADDING;
  const accentColor = canInvest ? stat.accent : '#64748b';
  const rightEdge = localX + w - CARD_RIGHT_EDGE_OFFSET;

  drawText(ctx, isLocked ? `\u{1F512} ${stat.name.toUpperCase()}` : stat.name.toUpperCase(), {
    x: textX,
    y: localY + CARD_NAME_Y,
    bold: true,
    size: CARD_NAME_SIZE,
    color: accentColor,
  });

  drawText(ctx, 'Current level', {
    x: rightEdge,
    y: localY + CARD_LEVEL_LABEL_Y,
    size: CARD_LEVEL_LABEL_SIZE,
    color: canInvest ? '#475569' : '#64748b',
    align: 'right',
  });

  drawText(ctx, String(stat.getValue(player)), {
    x: rightEdge,
    y: localY + CARD_LEVEL_VALUE_Y,
    bold: true,
    size: CARD_LEVEL_VALUE_SIZE,
    color: accentColor,
    align: 'right',
  });

  const descMaxW =
    w -
    (CARD_BORDER_WIDTH + CARD_PADDING) -
    (canInvest ? BTN_W + CARD_DESC_WIDTH_BTN_OFFSET : CARD_PADDING);
  drawText(ctx, isLocked ? (stat.lockedNote ?? stat.description) : stat.description, {
    x: textX,
    y: localY + CARD_DESC_Y,
    size: CARD_DESC_SIZE,
    color: isLocked ? '#7c6f4a' : canInvest ? '#64748b' : '#475569',
    width: descMaxW,
  });

  if (canInvest) {
    const btnLocalX = localX + w - BTN_W - CARD_BTN_X_OFFSET;
    const btnLocalY = localY + CARD_BTN_Y_OFFSET;
    const btnScreenY = btnLocalY + scrollTop - scrollY;

    drawButton(ctx, {
      x: btnLocalX,
      y: btnLocalY,
      width: BTN_W,
      height: BTN_H,
      label: '+',
      fill: stat.cardBg,
      border: stat.accent,
      borderWidth: 1.5,
      radius: 4,
      labelSize: 14,
      labelColor: stat.accent,
    });

    if (btnLocalY + BTN_H > scrollY && btnLocalY < scrollY + scrollH) {
      buttons.push({
        x: btnLocalX,
        y: btnScreenY,
        w: BTN_W,
        h: BTN_H,
        action: () => {
          stat.spend(player);
          onSpend?.();
        },
      });
    }
  }
}

export function renderSpendTab(
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
  onSpend?: () => void,
): number {
  drawText(ctx, 'SPEND SKILL POINTS', {
    x: bx + bw / 2,
    y: by + TAB_TITLE_Y,
    bold: true,
    size: TAB_TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });
  drawText(ctx, 'Grow stronger between battles', {
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

  let y = 8;

  const pairs: [Player, string, StatDef[], string][] = [
    [human, 'Human', HUMAN_STAT_DEFS, '#93c5fd'],
    [cat, 'Cat', CAT_STAT_DEFS, '#fb923c'],
  ];

  for (const [player, charName, statDefs, nameColor] of pairs) {
    const hasPoints = player.unspentPoints > 0;

    drawText(ctx, `${charName}  ·  Level ${player.level}`, {
      x: bx + CHAR_LABEL_X,
      y: y,
      bold: true,
      size: CHAR_LABEL_SIZE,
      color: nameColor,
    });

    if (hasPoints) {
      const pts = player.unspentPoints;
      const ptsLabel = `${pts} point${pts !== 1 ? 's' : ''} to spend`;
      drawText(ctx, ptsLabel, {
        x: bx + bw - CHAR_POINTS_LABEL_X_OFFSET,
        y: y,
        bold: true,
        size: CHAR_POINTS_LABEL_SIZE,
        color: '#fbbf24',
        align: 'right',
      });
    } else {
      drawText(ctx, 'no points available', {
        x: bx + bw - CHAR_POINTS_LABEL_X_OFFSET,
        y: y + CHAR_NO_POINTS_Y_OFFSET,
        size: CHAR_NO_POINTS_SIZE,
        color: '#64748b',
        align: 'right',
      });
    }

    y += SCROLL_ITEM_MARGIN_Y;

    const cardX = bx + CARD_X_OFFSET;
    const cardW = bw - CARD_WIDTH_MARGIN;
    for (const stat of statDefs) {
      renderStatCard(
        ctx,
        buttons,
        cardX,
        y,
        scrollTop,
        scrollY,
        scrollH,
        cardW,
        stat,
        player,
        hasPoints,
        onSpend,
      );
      y += CARD_H + CARD_GAP;
    }

    y += SCROLL_ITEM_EXTRA_SPACE;

    drawDivider(ctx, { x: bx + CHAR_LABEL_X, y, length: bw - CARD_WIDTH_MARGIN, color: '#1e293b' });

    y += SCROLL_ITEM_EXTRA_SPACE;
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

  const btnY = by + bh - BACK_BTN_HEIGHT + BACK_BTN_Y_OFFSET;
  addButton(ctx, buttons, {
    x: bx + BACK_BTN_X_MARGIN,
    y: btnY,
    width: bw - BACK_BTN_WIDTH_MARGIN,
    height: BACK_BTN_CONTENT_H,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('main'),
  });

  return contentHeight;
}
