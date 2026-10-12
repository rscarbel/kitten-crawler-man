/**
 * The Texas Hold'em rules sheet's pages and their illustrations: hands built
 * from the table's own card renders, or its chips, over a caption.
 */

import { measureWorldText, worldText } from '../../world/worldText';
import type { Card, Rank, Suit } from '../../../systems/casino/Deck';
import { CARD_ASPECT, drawCardBack, drawCardFace } from '../../casino/PlayingCard';
import { drawChipStack } from '../../casino/ChipStack';
import { chromeTarget } from '../../screens/dialogs/canvasChrome';
import { CHIP_DENOMINATIONS } from '../../../systems/casino/BlackjackTable';
import { WORLD_TEXT } from '../../theme/worldInk';

/** Room a caption line takes, as a multiple of its type size. */
const CAPTION_LINE_HEIGHT = 1.6;
const CAPTION_GAP = 8;
const HALF = 0.5;
/** Cards in one group sit side by side with a hair of separation. */
const CARD_STEP = 1.08;
/** The gap between groups (hole cards and board, flop and turn), in card widths. */
const GROUP_GAP = 0.45;
/** The share of the band's width a row of cards may fill. */
const ROW_WIDTH_FRACTION = 0.92;
const LOSING_HAND_DIM = 0.45;

export type PokerIllustrationKind =
  | 'hole_and_board'
  | 'rankings_best'
  | 'rankings_rest'
  | 'blinds'
  | 'streets'
  | 'actions'
  | 'showdown'
  | 'your_hand';

/** The ten hands are split over two pages: on a phone, ten rows of five cards cannot be drawn large enough to read. */
type RankingsKind = Extract<PokerIllustrationKind, 'rankings_best' | 'rankings_rest'>;

export interface PokerRulesPage {
  readonly title: string;
  readonly body: string;
  readonly illustration: PokerIllustrationKind;
}

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

export const POKER_RULES_PAGES: ReadonlyArray<PokerRulesPage> = [
  {
    title: 'The Goal',
    body: 'Win chips. You get two cards nobody else sees, and five shared cards land face up in the middle. Your hand is the best five cards out of those seven.\nWin a hand by showing down the best five, or by betting until everyone else folds.',
    illustration: 'hole_and_board',
  },
  {
    title: 'Hand Rankings',
    body: 'The strongest hands, best first. Each beats everything below it.',
    illustration: 'rankings_best',
  },
  {
    title: 'Hand Rankings, Continued',
    body: 'Suits never rank. Same kind of hand? The higher cards win; an exact tie splits the pot.',
    illustration: 'rankings_rest',
  },
  {
    title: 'Button and Blinds',
    body: 'The dealer button acts last on every round after the flop. The two seats to its left post the small blind and the big blind before any cards come, so every pot is worth fighting for.\nThe button moves one seat left every hand.',
    illustration: 'blinds',
  },
  {
    title: 'Four Betting Rounds',
    body: 'Pre-flop: two cards each, then a round of betting. The flop: three shared cards, then betting. The turn: a fourth card, then betting. The river: the fifth, then the last round.\nA round ends when everyone still in has put in the same amount.',
    illustration: 'streets',
  },
  {
    title: 'Your Actions',
    body: 'Check: pass, when nobody has bet. Bet: put chips in first. Call: match the bet. Raise: make it bigger. Fold: give up the hand and what you have put in.\nAll-in: push your whole stack. You can never be made to bet more than you have.',
    illustration: 'actions',
  },
  {
    title: 'Showdown and Side Pots',
    body: 'If two or more players are still in after the river, the hands are turned over and the best five cards win.\nA player who is all-in can only win as much from each opponent as they put in themselves. Chips bet beyond that go into a side pot for the others.',
    illustration: 'showdown',
  },
  {
    title: 'Reading the Table',
    body: 'Each seat plate shows a name, a stack and their last action. The puck marks the button; SB and BB mark the blinds. A glowing ring shows whose turn it is.\nThe "Your hand" line under your cards always names the best hand you hold right now.',
    illustration: 'your_hand',
  },
];

interface CardGroup {
  readonly cards: ReadonlyArray<Card>;
  /** Trailing slots drawn as backs instead of faces. */
  readonly backs?: number;
  readonly dim?: number;
}

interface RowSpec {
  readonly groups: ReadonlyArray<CardGroup>;
  readonly caption: string;
}

const HOLE_KING_HEART = card('K', 'hearts');
const HOLE_SEVEN_CLUB = card('7', 'clubs');
const BOARD: ReadonlyArray<Card> = [
  card('K', 'spades'),
  card('7', 'diamonds'),
  card('2', 'clubs'),
  card('J', 'hearts'),
  card('4', 'spades'),
];

const FLOP_CARDS = 3;
const TURN_CARDS = 1;
const BOARD_FLOP = BOARD.slice(0, FLOP_CARDS);
const BOARD_TURN = BOARD.slice(FLOP_CARDS, FLOP_CARDS + TURN_CARDS);
const BOARD_RIVER = BOARD.slice(FLOP_CARDS + TURN_CARDS);

const ROWS: Readonly<
  Record<Exclude<PokerIllustrationKind, RankingsKind | 'blinds' | 'actions'>, RowSpec>
> = {
  hole_and_board: {
    groups: [{ cards: [HOLE_KING_HEART, HOLE_SEVEN_CLUB] }, { cards: BOARD }],
    caption: 'Your two cards, then the five everyone shares.',
  },
  streets: {
    groups: [
      { cards: [], backs: 2 },
      { cards: BOARD_FLOP },
      { cards: BOARD_TURN },
      { cards: BOARD_RIVER },
    ],
    caption: 'Pre-flop · flop · turn · river',
  },
  showdown: {
    groups: [
      { cards: [card('Q', 'spades'), card('Q', 'diamonds')] },
      { cards: BOARD_FLOP },
      { cards: [card('A', 'clubs'), card('9', 'clubs')], dim: LOSING_HAND_DIM },
    ],
    caption: 'Queens beat ace-high. The best five take the pot.',
  },
  your_hand: {
    groups: [{ cards: [HOLE_KING_HEART, HOLE_SEVEN_CLUB] }, { cards: BOARD_FLOP }],
    caption: 'Your hand: Two pair, kings and sevens',
  },
};

interface RankedHand {
  readonly name: string;
  readonly cards: ReadonlyArray<Card>;
}

/** Best first, as the page lists them. */
const RANKED_HANDS: ReadonlyArray<RankedHand> = [
  {
    name: 'Royal flush',
    cards: [
      card('A', 'spades'),
      card('K', 'spades'),
      card('Q', 'spades'),
      card('J', 'spades'),
      card('10', 'spades'),
    ],
  },
  {
    name: 'Straight flush',
    cards: [
      card('9', 'hearts'),
      card('8', 'hearts'),
      card('7', 'hearts'),
      card('6', 'hearts'),
      card('5', 'hearts'),
    ],
  },
  {
    name: 'Four of a kind',
    cards: [
      card('Q', 'spades'),
      card('Q', 'hearts'),
      card('Q', 'diamonds'),
      card('Q', 'clubs'),
      card('3', 'hearts'),
    ],
  },
  {
    name: 'Full house',
    cards: [
      card('K', 'clubs'),
      card('K', 'hearts'),
      card('K', 'spades'),
      card('7', 'diamonds'),
      card('7', 'clubs'),
    ],
  },
  {
    name: 'Flush',
    cards: [
      card('A', 'diamonds'),
      card('J', 'diamonds'),
      card('8', 'diamonds'),
      card('4', 'diamonds'),
      card('2', 'diamonds'),
    ],
  },
  {
    name: 'Straight',
    cards: [
      card('10', 'clubs'),
      card('9', 'diamonds'),
      card('8', 'spades'),
      card('7', 'hearts'),
      card('6', 'clubs'),
    ],
  },
  {
    name: 'Three of a kind',
    cards: [
      card('8', 'hearts'),
      card('8', 'clubs'),
      card('8', 'spades'),
      card('K', 'diamonds'),
      card('3', 'clubs'),
    ],
  },
  {
    name: 'Two pair',
    cards: [
      card('J', 'spades'),
      card('J', 'diamonds'),
      card('4', 'clubs'),
      card('4', 'hearts'),
      card('A', 'spades'),
    ],
  },
  {
    name: 'One pair',
    cards: [
      card('10', 'hearts'),
      card('10', 'spades'),
      card('K', 'clubs'),
      card('7', 'diamonds'),
      card('3', 'spades'),
    ],
  },
  {
    name: 'High card',
    cards: [
      card('A', 'clubs'),
      card('Q', 'diamonds'),
      card('9', 'hearts'),
      card('5', 'spades'),
      card('2', 'clubs'),
    ],
  },
];

/** How many hands each rankings page shows. */
const HANDS_PER_RANKINGS_PAGE = 5;
const NUMBERED_HANDS: ReadonlyArray<NumberedHand> = RANKED_HANDS.map((hand, index) => ({
  hand,
  rank: index + 1,
}));
const RANKING_PAGE_HANDS: Readonly<Record<RankingsKind, ReadonlyArray<NumberedHand>>> = {
  rankings_best: NUMBERED_HANDS.slice(0, HANDS_PER_RANKINGS_PAGE),
  rankings_rest: NUMBERED_HANDS.slice(HANDS_PER_RANKINGS_PAGE),
};
const CARDS_PER_HAND = 5;
const RANKING_CELL_GAP = 6;

const CHIP_RADIUS_FRACTION = 0.16;
const CHIP_BASE_FRACTION = 0.82;
/** The blinds sit higher than a lone stack so their SB and BB labels clear the caption. */
const BLINDS_BASE_FRACTION = 0.6;
const BLINDS_RADIUS_FRACTION = 0.2;
/** Where each blind's stack sits across the band. */
const SMALL_BLIND_X_FRACTION = 0.38;
const BIG_BLIND_X_FRACTION = 0.62;
const SMALL_BLIND_STACK: ReadonlyArray<number> = [CHIP_DENOMINATIONS[0]];
const BIG_BLIND_STACK: ReadonlyArray<number> = [CHIP_DENOMINATIONS[0], CHIP_DENOMINATIONS[0]];
const ALL_IN_STACK: ReadonlyArray<number> = [
  CHIP_DENOMINATIONS[2],
  CHIP_DENOMINATIONS[2],
  CHIP_DENOMINATIONS[1],
  CHIP_DENOMINATIONS[1],
  CHIP_DENOMINATIONS[1],
  CHIP_DENOMINATIONS[0],
  CHIP_DENOMINATIONS[0],
];
const SMALL_BLIND_LABEL = 'SB';
const BIG_BLIND_LABEL = 'BB';
const BLINDS_CAPTION = 'The two seats left of the button post the blinds.';
const ACTIONS_CAPTION = 'Check, bet, call, raise, fold, or push it all in.';

function caption(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number): void {
  worldText(ctx, text, { style: 'rulesCaption', x: cx, y, align: 'center' });
}

/**
 * One illustration band: real card renders or chips plus a caption, so the
 * rule on the page is shown with the same art the table uses.
 */
export function drawPokerIllustration(
  ctx: CanvasRenderingContext2D,
  kind: PokerIllustrationKind,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (kind === 'rankings_best' || kind === 'rankings_rest') {
    drawRankings(ctx, kind, x, y, width, height);
    return;
  }
  const captionText =
    kind === 'blinds' ? BLINDS_CAPTION : kind === 'actions' ? ACTIONS_CAPTION : ROWS[kind].caption;
  // An art column beside the text is narrow enough that a caption has to wrap.
  const captionWidth = width - CAPTION_GAP * 2;
  const captionH = measureWorldText(ctx, captionText, {
    style: 'rulesCaption',
    width: captionWidth,
  }).totalHeight;
  const captionY = y + height - captionH - CAPTION_GAP;
  const artHeight = captionY - y - CAPTION_GAP;
  worldText(ctx, captionText, {
    x: x + CAPTION_GAP,
    y: captionY,
    width: captionWidth,
    style: 'rulesCaption',
    align: 'center',
  });

  if (kind === 'blinds' || kind === 'actions') {
    drawChipIllustration(ctx, kind, x, y, width, artHeight);
    return;
  }
  drawGroups(ctx, ROWS[kind].groups, x, y, width, artHeight);
}

function drawChipIllustration(
  ctx: CanvasRenderingContext2D,
  kind: 'blinds' | 'actions',
  x: number,
  y: number,
  width: number,
  artHeight: number,
): void {
  const target = chromeTarget(ctx);
  if (kind === 'actions') {
    const radius = artHeight * CHIP_RADIUS_FRACTION;
    drawChipStack(
      target,
      x + width * HALF,
      y + artHeight * CHIP_BASE_FRACTION,
      radius,
      ALL_IN_STACK,
    );
    return;
  }
  const radius = artHeight * BLINDS_RADIUS_FRACTION;
  const baseY = y + artHeight * BLINDS_BASE_FRACTION;
  const labelY = baseY + radius;
  const smallX = x + width * SMALL_BLIND_X_FRACTION;
  const bigX = x + width * BIG_BLIND_X_FRACTION;
  drawChipStack(target, smallX, baseY, radius, SMALL_BLIND_STACK);
  drawChipStack(target, bigX, baseY, radius, BIG_BLIND_STACK);
  caption(ctx, SMALL_BLIND_LABEL, smallX, labelY);
  caption(ctx, BIG_BLIND_LABEL, bigX, labelY);
}

/** Card widths a row of groups spans, gaps included. */
function rowUnits(groups: ReadonlyArray<CardGroup>): number {
  let slots = 0;
  for (const group of groups) slots += group.cards.length + (group.backs ?? 0);
  const groupGaps = Math.max(0, groups.length - 1) * GROUP_GAP;
  return Math.max(0, slots - 1) * CARD_STEP + 1 + groupGaps;
}

function drawGroups(
  ctx: CanvasRenderingContext2D,
  groups: ReadonlyArray<CardGroup>,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const units = rowUnits(groups);
  const cardW = Math.max(1, Math.min(height / CARD_ASPECT, (width * ROW_WIDTH_FRACTION) / units));
  const top = y + (height - cardW * CARD_ASPECT) * HALF;
  let left = x + (width - units * cardW) * HALF;
  const step = cardW * CARD_STEP;
  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) left += cardW * GROUP_GAP;
    const opts = group.dim === undefined ? {} : { dim: group.dim };
    for (const face of group.cards) {
      drawCardFace(ctx, face, { x: left, y: top, width: cardW }, opts);
      left += step;
    }
    for (let i = 0; i < (group.backs ?? 0); i++) {
      drawCardBack(ctx, { x: left, y: top, width: cardW });
      left += step;
    }
    // The last card of a group ends a full card width on, not a step on.
    left += cardW - step;
  });
}

type RankingLayout =
  | { readonly kind: 'list'; readonly cardW: number; readonly nameW: number }
  | {
      readonly kind: 'grid';
      readonly cardW: number;
      readonly columns: number;
      /** Lines the longest-wrapping hand name takes at this grid's cell width. */
      readonly labelLines: number;
    };

/** A hand name may wrap once under its cards; a third line would crowd the row below. */
const MAX_RANKING_LABEL_LINES = 2;
/**
 * A ranked hand is fanned the way a player holds one, each card covering
 * the right of the one before but leaving its rank and suit in view, so five
 * cards take the width of about three and every card can be drawn larger.
 */
const RANKING_CARD_STEP = 0.6;
const HAND_UNITS = (CARDS_PER_HAND - 1) * RANKING_CARD_STEP + 1;
const RANKING_LABEL_STYLE = 'rulesLabel';
const RANKING_LABEL_LINE = WORLD_TEXT.rulesLabel.size * CAPTION_LINE_HEIGHT;

interface NumberedHand {
  readonly hand: RankedHand;
  /** Place in the full ranking, from 1. */
  readonly rank: number;
}

function rankingLabel(entry: NumberedHand): string {
  return `${entry.rank}. ${entry.hand.name}`;
}

/** How many lines the longest hand name wraps to in a cell `cellW` wide, or null when a word cannot fit at all. */
function rankingLabelLines(
  ctx: CanvasRenderingContext2D,
  hands: ReadonlyArray<NumberedHand>,
  cellW: number,
): number | null {
  let lines = 0;
  for (const entry of hands) {
    const measured = measureWorldText(ctx, rankingLabel(entry), {
      style: RANKING_LABEL_STYLE,
      width: cellW,
    });
    if (measured.width > cellW) return null;
    lines = Math.max(lines, measured.lineCount);
  }
  return lines;
}

function gridLayout(
  ctx: CanvasRenderingContext2D,
  hands: ReadonlyArray<NumberedHand>,
  columns: number,
  width: number,
  height: number,
): RankingLayout | null {
  const rows = Math.ceil(hands.length / columns);
  const cellW = (width - (columns - 1) * RANKING_CELL_GAP) / columns;
  const cellH = (height - (rows - 1) * RANKING_CELL_GAP) / rows;
  const labelLines = rankingLabelLines(ctx, hands, cellW);
  if (labelLines === null || labelLines > MAX_RANKING_LABEL_LINES) return null;
  const labelH = RANKING_LABEL_LINE * labelLines + CAPTION_GAP;
  const cardW = Math.min((cellW * ROW_WIDTH_FRACTION) / HAND_UNITS, (cellH - labelH) / CARD_ASPECT);
  return { kind: 'grid', cardW, columns, labelLines };
}

function listLayout(
  ctx: CanvasRenderingContext2D,
  hands: ReadonlyArray<NumberedHand>,
  width: number,
  height: number,
): RankingLayout {
  const widestName = Math.max(
    ...hands.map(
      (entry) => measureWorldText(ctx, rankingLabel(entry), { style: RANKING_LABEL_STYLE }).width,
    ),
  );
  const nameW = widestName + CAPTION_GAP * 2;
  const rowH = (height - (hands.length - 1) * RANKING_CELL_GAP) / hands.length;
  const cardW = Math.min(rowH / CARD_ASPECT, ((width - nameW) * ROW_WIDTH_FRACTION) / HAND_UNITS);
  return { kind: 'list', cardW, nameW };
}

/**
 * Whichever arrangement draws the cards largest in the band it is given: one
 * hand per row with its name beside it, or a grid of any column count with
 * each name under its hand. A grid is only offered when every name fits its
 * cell in at most two lines, since names run into each other otherwise.
 */
function rankingLayout(
  ctx: CanvasRenderingContext2D,
  hands: ReadonlyArray<NumberedHand>,
  width: number,
  height: number,
): RankingLayout {
  let best = listLayout(ctx, hands, width, height);
  for (let columns = 1; columns <= hands.length; columns++) {
    const grid = gridLayout(ctx, hands, columns, width, height);
    if (grid !== null && grid.cardW > best.cardW) best = grid;
  }
  return best;
}

function drawRankings(
  ctx: CanvasRenderingContext2D,
  kind: RankingsKind,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const hands = RANKING_PAGE_HANDS[kind];
  const top = y + RANKING_CELL_GAP;
  const innerHeight = height - RANKING_CELL_GAP * 2;
  const layout = rankingLayout(ctx, hands, width, innerHeight);
  const cardW = layout.cardW;
  if (cardW <= 0) return;
  const cardH = cardW * CARD_ASPECT;
  const step = cardW * RANKING_CARD_STEP;
  const handW = (CARDS_PER_HAND - 1) * step + cardW;
  const drawHand = (entry: NumberedHand, left: number, handTop: number): void => {
    entry.hand.cards.forEach((face, i) => {
      drawCardFace(ctx, face, { x: left + step * i, y: handTop, width: cardW });
    });
  };

  if (layout.kind === 'list') {
    const rowH = (innerHeight - (hands.length - 1) * RANKING_CELL_GAP) / hands.length;
    const blockLeft = x + (width - (layout.nameW + handW)) * HALF;
    hands.forEach((entry, index) => {
      const rowTop = top + index * (rowH + RANKING_CELL_GAP);
      worldText(ctx, rankingLabel(entry), {
        style: RANKING_LABEL_STYLE,
        x: blockLeft,
        y: rowTop + rowH * HALF,
        baseline: 'middle',
      });
      drawHand(entry, blockLeft + layout.nameW, rowTop + (rowH - cardH) * HALF);
    });
    return;
  }

  const { columns, labelLines } = layout;
  const labelH = RANKING_LABEL_LINE * labelLines + CAPTION_GAP;
  const rows = Math.ceil(hands.length / columns);
  const cellW = (width - (columns - 1) * RANKING_CELL_GAP) / columns;
  const cellH = (innerHeight - (rows - 1) * RANKING_CELL_GAP) / rows;
  const blockH = cardH + labelH;
  hands.forEach((entry, index) => {
    const cellX = x + (index % columns) * (cellW + RANKING_CELL_GAP);
    const cellY = top + Math.floor(index / columns) * (cellH + RANKING_CELL_GAP);
    const handTop = cellY + (cellH - blockH) * HALF;
    drawHand(entry, cellX + (cellW - handW) * HALF, handTop);
    worldText(ctx, rankingLabel(entry), {
      style: RANKING_LABEL_STYLE,
      x: cellX,
      y: handTop + cardH + CAPTION_GAP,
      width: cellW,
      align: 'center',
    });
  });
}
