#!/usr/bin/env tsx
/**
 * Review harness for the closed-set human townsfolk cast.
 *
 *   preview/human-cast/lineup.png    every look's idle in all three views,
 *                                    at in-game size on street ground and at 3x
 *   preview/human-cast/<id>.png      one look: every row's first frame at 3x
 *   preview/human-cast/blind.png     the in-game lineup, shuffled and numbered,
 *                                    for a reviewer matching builds/roles blind
 *   preview/human-cast/compare.png   the cast beside the ratkin cast and Carl
 *
 *   npm run render:human-cast
 *   npx tsx scripts/render-human-cast.ts --id=standard_guard
 *   npx tsx scripts/render-human-cast.ts --lineup-only
 *   npx tsx scripts/render-human-cast.ts --blind --seed=7
 *
 * The gates run first, ahead of the multi-megapixel allocations.
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakeFigureCell, figureStateNames, frameCountOf } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { humanCastGateFailures } from './gates-human-cast.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { mulberry32 } from '../src/sprites/person/rng.js';
import { TOWN_CAST_PAINT_SIZE, townCastFigure } from '../src/sprites/art/townCastFigure.js';
import { TOWN_CAST_LOOKS, type TownCastLook } from '../src/sprites/person/townCastLooks.js';
import { ratkinCastFigure } from '../src/sprites/art/ratkinCastFigure.js';
import { RATKIN_CAST_IDS } from '../src/sprites/art/ratkin/cast.js';
import { HUMAN_FIGURE } from '../src/sprites/art/humanFigure.js';

const OUT_DIR = `${PREVIEW_DIR}/human-cast`;
const REVIEW_SCALE = 3;
const PADDING = 8;
const LABEL_HEIGHT = 20;
const BACKDROP = '#3b3b40';
const STREET_GROUND = '#7c746a';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '13px sans-serif';
const BLIND_NUMBER_FONT = 'bold 16px sans-serif';
const BLIND_NUMBER_X = 6;
const BLIND_NUMBER_Y = 18;
const GRID_LINE = 'rgba(255,255,255,0.12)';
const LINEUP_VIEWS = ['idle', 'idle_side', 'idle_away'] as const;
/** The cast's own cell coordinate system: 64 cell px per tile, matching the ratkin cast's convention. */
const CAST_TILE_SCALE = 64;
/** Game pixels per art pixel: the cast is painted at `CAST_TILE_SCALE`px cells, the game draws at the tile size. */
const IN_GAME_SCALE = TILE_SIZE / CAST_TILE_SCALE;
const LINEUP_COLUMNS = 7;
/** A citizen's full standing height relative to the cast's own paint size, for the lineup card's ground box. */
const LINEUP_CARD_HEIGHT_SHARE = 1.4;
const COMPARE_ROW_BACKDROP = '#5d6440';
const COMPARE_LABEL_Y_MARGIN = 4;
const LOOK_SHEET_COLUMNS = 4;

function flag(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? null : match.slice(prefix.length);
}

const cellCache = new Map<string, Canvas>();

function cell(look: TownCastLook, state: string, frame: number): Canvas {
  const key = `${look.id}/${state}/${frame}`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const baked = bakeFigureCell(townCastFigure(look.id), state, frame);
  cellCache.set(key, baked);
  return baked;
}

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

function stateForView(role: 'idle', view: (typeof LINEUP_VIEWS)[number]): string {
  const suffix = view === 'idle_side' ? '_side' : view === 'idle_away' ? '_away' : '';
  return `${role}${suffix}`;
}

/** One look's idle-in-three-views lineup card. */
function lineupCard(look: TownCastLook): Canvas {
  const cellW = TOWN_CAST_PAINT_SIZE;
  const cellH = TOWN_CAST_PAINT_SIZE * LINEUP_CARD_HEIGHT_SHARE;
  const width = cellW * LINEUP_VIEWS.length * IN_GAME_SCALE + PADDING * 2;
  const height = cellH * IN_GAME_SCALE + LABEL_HEIGHT + PADDING * 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = STREET_GROUND;
  ctx.fillRect(0, 0, width, height);

  LINEUP_VIEWS.forEach((view, i) => {
    const state = stateForView('idle', view);
    const c = cell(look, state, 0);
    const dw = c.width * IN_GAME_SCALE;
    const dh = c.height * IN_GAME_SCALE;
    const x = PADDING + i * cellW * IN_GAME_SCALE;
    ctx.drawImage(c, x, PADDING, dw, dh);
  });
  label(ctx, `${look.id} (${look.build})`, width / 2, height - PADDING / 2);
  return canvas;
}

function drawGrid(canvas: Canvas, cards: readonly Canvas[], columns: number): Canvas {
  const cardW = Math.max(...cards.map((c) => c.width));
  const cardH = Math.max(...cards.map((c) => c.height));
  const rows = Math.ceil(cards.length / columns);
  const width = cardW * columns;
  const height = cardH * rows;
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  cards.forEach((card, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * cardW;
    const y = row * cardH;
    ctx.drawImage(card, x, y);
    ctx.strokeStyle = GRID_LINE;
    ctx.strokeRect(x, y, cardW, cardH);
  });
  return out;
}

function renderLineup(): void {
  const cards = TOWN_CAST_LOOKS.map(lineupCard);
  const grid = drawGrid(createCanvas(1, 1), cards, LINEUP_COLUMNS);
  const path = writePreviewPng(`${OUT_DIR}/lineup.png`, grid.toBuffer('image/png'));
  console.log(`wrote ${path}`);
}

function renderBlind(seed: number): void {
  const rng = mulberry32(seed);
  const shuffled = [...TOWN_CAST_LOOKS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  const cards = shuffled.map((look, i) => {
    const card = lineupCard(look);
    const out = createCanvas(card.width, card.height);
    const ctx = out.getContext('2d');
    ctx.drawImage(card, 0, 0);
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = BLIND_NUMBER_FONT;
    ctx.fillText(`#${i + 1}`, BLIND_NUMBER_X, BLIND_NUMBER_Y);
    return out;
  });
  const grid = drawGrid(createCanvas(1, 1), cards, LINEUP_COLUMNS);
  const path = writePreviewPng(`${OUT_DIR}/blind.png`, grid.toBuffer('image/png'));
  const key = shuffled.map((look, i) => `#${i + 1} = ${look.id}`).join('\n');
  console.log(`wrote ${path}\nkey (do not look before guessing):\n${key}`);
}

/** One look's every row, first frame, at 3x, in a labelled grid. */
function renderLookSheet(look: TownCastLook): void {
  const figure = townCastFigure(look.id);
  const states = figureStateNames(figure);
  const cards = states.map((state) => {
    const frames = frameCountOf(figure, state);
    const c = cell(look, state, 0);
    const width = c.width * REVIEW_SCALE + PADDING * 2;
    const height = c.height * REVIEW_SCALE + LABEL_HEIGHT + PADDING * 2;
    const card = createCanvas(width, height);
    const ctx = card.getContext('2d');
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(c, PADDING, PADDING, c.width * REVIEW_SCALE, c.height * REVIEW_SCALE);
    label(ctx, `${state} (${frames}f)`, width / 2, height - PADDING / 2);
    return card;
  });
  const grid = drawGrid(createCanvas(1, 1), cards, LOOK_SHEET_COLUMNS);
  const path = writePreviewPng(`${OUT_DIR}/${look.id}.png`, grid.toBuffer('image/png'));
  console.log(`wrote ${path}`);
}

/** The human lineup beside the ratkin lineup and Carl, for direct quality comparison. */
function renderCompare(): void {
  const humanCards = TOWN_CAST_LOOKS.slice(0, LINEUP_COLUMNS).map(lineupCard);
  const ratkinCards = RATKIN_CAST_IDS.slice(0, LINEUP_COLUMNS).map((id) => {
    const c = bakeFigureCell(ratkinCastFigure(id), 'idle', 0);
    const canvas = createCanvas(
      c.width * IN_GAME_SCALE + PADDING * 2,
      c.height * IN_GAME_SCALE + PADDING * 2,
    );
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = COMPARE_ROW_BACKDROP;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(c, PADDING, PADDING, c.width * IN_GAME_SCALE, c.height * IN_GAME_SCALE);
    label(ctx, id, canvas.width / 2, canvas.height - COMPARE_LABEL_Y_MARGIN);
    return canvas;
  });
  const carlCell = bakeFigureCell(HUMAN_FIGURE, 'idle', 0);
  const carlCanvas = createCanvas(
    carlCell.width * IN_GAME_SCALE + PADDING * 2,
    carlCell.height * IN_GAME_SCALE + PADDING * 2,
  );
  const carlCtx = carlCanvas.getContext('2d');
  carlCtx.fillStyle = COMPARE_ROW_BACKDROP;
  carlCtx.fillRect(0, 0, carlCanvas.width, carlCanvas.height);
  carlCtx.drawImage(
    carlCell,
    PADDING,
    PADDING,
    carlCell.width * IN_GAME_SCALE,
    carlCell.height * IN_GAME_SCALE,
  );
  label(carlCtx, 'carl', carlCanvas.width / 2, carlCanvas.height - COMPARE_LABEL_Y_MARGIN);

  const humanRow = drawGrid(createCanvas(1, 1), humanCards, LINEUP_COLUMNS);
  const ratkinRow = drawGrid(createCanvas(1, 1), ratkinCards, LINEUP_COLUMNS);
  const width = Math.max(humanRow.width, ratkinRow.width, carlCanvas.width);
  const height = humanRow.height + ratkinRow.height + carlCanvas.height;
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(humanRow, 0, 0);
  ctx.drawImage(ratkinRow, 0, humanRow.height);
  ctx.drawImage(carlCanvas, 0, humanRow.height + ratkinRow.height);
  const path = writePreviewPng(`${OUT_DIR}/compare.png`, out.toBuffer('image/png'));
  console.log(`wrote ${path}`);
}

function main(): void {
  const ok = reportFigureGates('human-cast', humanCastGateFailures());
  if (!ok) process.exitCode = 1;

  const idFlag = flag('id');
  const lineupOnly = process.argv.includes('--lineup-only');
  const blind = process.argv.includes('--blind');
  const seed = Number(flag('seed') ?? '1');

  if (blind) {
    renderBlind(seed);
    return;
  }
  if (idFlag !== null) {
    const look = TOWN_CAST_LOOKS.find((l) => l.id === idFlag);
    if (look === undefined) throw new Error(`no look "${idFlag}"`);
    renderLookSheet(look);
    return;
  }

  renderLineup();
  renderCompare();
  if (!lineupOnly) {
    for (const look of TOWN_CAST_LOOKS) renderLookSheet(look);
  }
}

main();
