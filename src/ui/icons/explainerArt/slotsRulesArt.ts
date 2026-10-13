/**
 * The slot machine's paytable pages and their illustrations: every symbol's
 * pay at the player's current bet, the wild, the scatter and its pay, the
 * twenty paylines drawn as small diagrams, the progressive jackpot and the
 * win tiers. The numbers are read from the engine's own tables, so the sheet
 * can never disagree with what the machine pays.
 */

import { slotsInk } from '../../theme/slotsInk';
import { UI_FONT_STACK } from '../../theme/fonts';
import { worldText } from '../../world/worldText';
import { paintSlotSymbol } from '../../casino/slots/slotSymbols';
import { PAYLINES } from '../../../systems/casino/slots/slotPaylines';
import { REEL_COUNT, ROW_COUNT } from '../../../systems/casino/slots/slotReels';
import {
  FREE_SPINS_PER_TRIGGER,
  LINE_PAYS,
  PAYING_SYMBOLS,
  SCATTER,
  SCATTER_TRIGGER_COUNT,
  WILD,
  scatterPayFor,
  type PayingSymbol,
} from '../../../systems/casino/slots/slotSymbols';
import {
  BET_LADDER,
  BIG_WIN_TIMES_BET,
  EPIC_WIN_TIMES_BET,
  JACKPOT_CONTRIBUTION_RATE,
  JACKPOT_FLOOR,
  MAX_BET_PER_LINE,
  MEGA_WIN_TIMES_BET,
  totalBetFor,
} from '../../../systems/casino/slots/slotBets';
import type { Rect } from '../../core/geom';

export type SlotsIllustration = 'paytable' | 'wild' | 'scatter' | 'paylines' | 'jackpot' | 'tiers';

export interface SlotsRulesPage {
  readonly title: string;
  readonly body: string;
  readonly illustration: SlotsIllustration;
  /** The height the art asks for, in UI units. */
  readonly height: number;
}

const FOUR = 4;
const FIVE = 5;
const PERCENT = 100;
const HALF = 0.5;
const PAYTABLE_HEIGHT = 240;
const SMALL_ART_HEIGHT = 120;
const PAYLINES_HEIGHT = 230;
const TIERS_HEIGHT = 130;

const coins = (amount: number): string => amount.toLocaleString('en-US');

const scatterPays = [SCATTER_TRIGGER_COUNT, FOUR, FIVE]
  .map((count) => `${count} pay ${scatterPayFor(count)}× your total bet`)
  .join(', ');

export const SLOTS_RULES_PAGES: ReadonlyArray<SlotsRulesPage> = [
  {
    title: 'Paytable',
    body: `Every spin plays all ${PAYLINES.length} lines. A line pays for 3, 4 or 5 matching symbols in a row, starting from the leftmost reel. Pays are shown at your current bet per line; the bet steps through ${BET_LADDER.join(', ')} coins a line.`,
    illustration: 'paytable',
    height: PAYTABLE_HEIGHT,
  },
  {
    title: 'The Sheriff Star',
    body: 'The gold Desperado sheriff star is wild: it stands in for every symbol except the loot box. A line of wilds pays the wild’s own prize when that beats what they would complete, and each line pays only its best reading.',
    illustration: 'wild',
    height: SMALL_ART_HEIGHT,
  },
  {
    title: 'Loot Box Scatter',
    body: `Loot boxes pay anywhere on the glass, no line needed: ${scatterPays}. ${SCATTER_TRIGGER_COUNT} or more also award ${FREE_SPINS_PER_TRIGGER} free spins at the bet that won them, on a purple backing. Free spins can win more free spins.`,
    illustration: 'scatter',
    height: SMALL_ART_HEIGHT,
  },
  {
    title: 'The Twenty Paylines',
    body: 'Each diagram is one line across the five reels, numbered in the order the machine checks them. Wins on different lines are added together.',
    illustration: 'paylines',
    height: PAYLINES_HEIGHT,
  },
  {
    title: 'Desperado Jackpot',
    body: `Five golden 7s on any line at MAX BET (${MAX_BET_PER_LINE} a line, ${coins(totalBetFor(MAX_BET_PER_LINE))} a spin) win the whole progressive jackpot. ${Math.round(JACKPOT_CONTRIBUTION_RATE * PERCENT)}% of every paid bet feeds it, and it starts again at ${coins(JACKPOT_FLOOR)} once it is won. Below max bet, five 7s pay their line prize.`,
    illustration: 'jackpot',
    height: SMALL_ART_HEIGHT,
  },
  {
    title: 'Big Wins, Autospin and Turbo',
    body: `A win of ${BIG_WIN_TIMES_BET}× your total bet is a BIG WIN, ${MEGA_WIN_TIMES_BET}× a MEGA WIN and ${EPIC_WIN_TIMES_BET}× an EPIC WIN. AUTO plays 10, 25 or 50 spins and stops on a BIG WIN or better, on free spins, or when you cannot cover the next bet. TURBO shortens the reels and the celebrations. A tap, click or Space skips a rollup to its final number.`,
    illustration: 'tiers',
    height: TIERS_HEIGHT,
  },
];

const CELL_GAP = 6;
const PAY_TEXT_FRACTION = 0.2;
const LABEL_SIZE = 12;
const PAY_LINE_SPACING = 1.3;
const NUMBER_SIZE = 10;
const DIAGRAM_COLUMNS = 5;
const DIAGRAM_ROWS = 4;
const DOT_RADIUS = 1.6;
const LINE_WIDTH = 2;

function caption(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  worldText(ctx, text, {
    x,
    y,
    size,
    bold: true,
    color,
    family: UI_FONT_STACK,
    align: 'center',
    baseline: 'middle',
  });
}

function paySummary(symbol: PayingSymbol | typeof WILD, betPerLine: number): string {
  const pays = LINE_PAYS[symbol];
  return `5× ${coins(pays.five * betPerLine)}  4× ${coins(pays.four * betPerLine)}  3× ${coins(pays.three * betPerLine)}`;
}

function drawPaytable(ctx: CanvasRenderingContext2D, area: Rect, betPerLine: number): void {
  const symbols = [...PAYING_SYMBOLS].reverse();
  const columns = area.w >= area.h * 2 ? FOUR : 2;
  const rows = Math.ceil(symbols.length / columns);
  const cellW = (area.w - CELL_GAP * (columns - 1)) / columns;
  const cellH = (area.h - CELL_GAP * (rows - 1)) / rows;
  symbols.forEach((symbol, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = area.x + column * (cellW + CELL_GAP);
    const y = area.y + row * (cellH + CELL_GAP);
    const iconSize = Math.min(cellH, cellW * PAY_TEXT_FRACTION * 2);
    paintSlotSymbol(ctx, symbol, x, y, iconSize, cellH);
    const pays = LINE_PAYS[symbol];
    const lines = [
      `5×  ${coins(pays.five * betPerLine)}`,
      `4×  ${coins(pays.four * betPerLine)}`,
      `3×  ${coins(pays.three * betPerLine)}`,
    ];
    const lineH = Math.min(LABEL_SIZE * PAY_LINE_SPACING, cellH / lines.length);
    const top = y + (cellH - lineH * lines.length) * HALF;
    lines.forEach((line, row) => {
      worldText(ctx, line, {
        x: x + iconSize + CELL_GAP,
        y: top + lineH * (row + HALF),
        size: Math.min(LABEL_SIZE, lineH / PAY_LINE_SPACING),
        bold: row === 0,
        color: row === 0 ? slotsInk.readout.label : slotsInk.readout.value,
        family: UI_FONT_STACK,
        baseline: 'middle',
        tabular: true,
      });
    });
  });
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  area: Rect,
  symbols: ReadonlyArray<Parameters<typeof paintSlotSymbol>[1]>,
  label: string,
): void {
  const labelH = LABEL_SIZE * 2;
  const size = Math.min(area.h - labelH, area.w / symbols.length);
  const startX = area.x + (area.w - size * symbols.length) * HALF;
  symbols.forEach((symbol, index) => {
    paintSlotSymbol(ctx, symbol, startX + index * size, area.y, size, size);
  });
  caption(
    ctx,
    label,
    area.x + area.w * HALF,
    area.y + size + labelH * HALF,
    LABEL_SIZE,
    slotsInk.readout.value,
  );
}

function drawPaylines(ctx: CanvasRenderingContext2D, area: Rect): void {
  const cellW = (area.w - CELL_GAP * (DIAGRAM_COLUMNS - 1)) / DIAGRAM_COLUMNS;
  const cellH = (area.h - CELL_GAP * (DIAGRAM_ROWS - 1)) / DIAGRAM_ROWS;
  PAYLINES.forEach((line, index) => {
    const x = area.x + (index % DIAGRAM_COLUMNS) * (cellW + CELL_GAP);
    const y = area.y + Math.floor(index / DIAGRAM_COLUMNS) * (cellH + CELL_GAP);
    const numberW = NUMBER_SIZE * 2;
    ctx.fillStyle = slotsInk.readout.face;
    ctx.fillRect(x, y, cellW, cellH);
    caption(
      ctx,
      `${index + 1}`,
      x + numberW * HALF,
      y + cellH * HALF,
      NUMBER_SIZE,
      slotsInk.readout.label,
    );
    const gridX = x + numberW;
    const gridW = cellW - numberW - CELL_GAP * HALF;
    const stepX = gridW / REEL_COUNT;
    const stepY = cellH / ROW_COUNT;
    ctx.fillStyle = slotsInk.reel.divider;
    for (let reel = 0; reel < REEL_COUNT; reel++) {
      for (let row = 0; row < ROW_COUNT; row++) {
        ctx.beginPath();
        ctx.arc(
          gridX + (reel + HALF) * stepX,
          y + (row + HALF) * stepY,
          DOT_RADIUS,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.strokeStyle = slotsInk.paylines[index % slotsInk.paylines.length] ?? slotsInk.frame.winCell;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    line.forEach((row, reel) => {
      const px = gridX + (reel + HALF) * stepX;
      const py = y + (row + HALF) * stepY;
      if (reel === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  });
}

function drawTiers(ctx: CanvasRenderingContext2D, area: Rect): void {
  const tiers = [
    { label: `BIG WIN  ${BIG_WIN_TIMES_BET}×`, color: slotsInk.tier.big },
    { label: `MEGA WIN  ${MEGA_WIN_TIMES_BET}×`, color: slotsInk.tier.mega },
    { label: `EPIC WIN  ${EPIC_WIN_TIMES_BET}×`, color: slotsInk.tier.epic },
    { label: 'JACKPOT', color: slotsInk.tier.jackpot },
  ];
  const rowH = area.h / tiers.length;
  tiers.forEach((tier, index) => {
    const size = Math.min(rowH * HALF, LABEL_SIZE + index * 2 + 2);
    worldText(ctx, tier.label, {
      x: area.x + area.w * HALF,
      y: area.y + rowH * (index + HALF),
      size,
      bold: true,
      color: tier.color,
      outline: slotsInk.tier.outline,
      family: UI_FONT_STACK,
      align: 'center',
      baseline: 'middle',
    });
  });
}

export function drawSlotsIllustration(
  ctx: CanvasRenderingContext2D,
  kind: SlotsIllustration,
  area: Rect,
  betPerLine: number,
): void {
  switch (kind) {
    case 'paytable':
      drawPaytable(ctx, area, betPerLine);
      return;
    case 'wild':
      drawRow(ctx, area, ['seven', WILD, 'seven', WILD, WILD], paySummary(WILD, betPerLine));
      return;
    case 'scatter':
      drawRow(
        ctx,
        area,
        [SCATTER, SCATTER, SCATTER],
        `${FREE_SPINS_PER_TRIGGER} FREE SPINS + ${coins(scatterPayFor(SCATTER_TRIGGER_COUNT) * betPerLine * PAYLINES.length)}`,
      );
      return;
    case 'paylines':
      drawPaylines(ctx, area);
      return;
    case 'jackpot':
      drawRow(
        ctx,
        area,
        ['seven', 'seven', 'seven', 'seven', 'seven'],
        'AT MAX BET: THE WHOLE POOL',
      );
      return;
    case 'tiers':
      drawTiers(ctx, area);
      return;
  }
}
