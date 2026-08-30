/**
 * The spider lab's review harness: the Grotesque Spider, her spit effects, and
 * the small spiders that hatch behind her.
 *
 * Art has to be judged as an image, by something that only looks at the image.
 * All three subjects are painted from their figures the way the runtime cache
 * bakes them, and the art gates run first, so one command answers both "does it
 * still hold together" and "what does it look like".
 *
 *   npm run render:spider
 *   npx tsx scripts/render-spider.ts --subject=boss --scale=2
 *   npx tsx scripts/render-spider.ts --subject=spit --row=idle
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { spiderGateFailures } from './gates-spider.js';
import { smallSpiderGateFailures } from './gates-spider-small.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { GROTESQUE_SPIDER_FIGURES } from '../src/sprites/art/grotesqueSpiderFigure.js';
import { GROTESQUE_SPIDER_SPIT_EFFECT_FIGURES } from '../src/sprites/art/grotesqueSpiderSpitFigure.js';
import { SPIDER_FIGURE } from '../src/sprites/art/spiderFigure.js';

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;

const DEFAULT_BOSS_SCALE = 0.5;
const DEFAULT_EFFECT_SCALE = 1;
/**
 * One: the small spider's cell is already four tiles across, so a contact sheet
 * at any magnification is tens of megapixels of mostly empty padding.
 */
const DEFAULT_SMALL_SPIDER_SCALE = 1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#2a2126';
/** The lab floor she is actually seen against, for the contrast check. */
const LAB_FLOOR = '#4a4038';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

type SheetContext = ReturnType<Canvas['getContext']>;

type Subject = 'boss' | 'spit' | 'small';
const SUBJECTS: readonly Subject[] = ['boss', 'spit', 'small'];

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

/** A bad number here silently produces a blank or NaN-sized contact sheet. */
function parseNumberFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

function parseSubjects(): readonly Subject[] {
  const raw = parseFlag('subject', '');
  if (raw === '') return SUBJECTS;
  const found = SUBJECTS.find((subject) => subject === raw);
  if (found === undefined) throw new Error(`--subject=${raw} is not one of ${SUBJECTS.join(', ')}`);
  return [found];
}

function newPanel(width: number, height: number): { canvas: Canvas; ctx: SheetContext } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  return { canvas, ctx };
}

interface Row {
  readonly def: FigureDef;
  readonly state: string;
  readonly frames: number;
}

function rowsOf(defs: readonly FigureDef[], only: string): Row[] {
  const wanted = only === '' ? [] : only.split(',');
  const rows: Row[] = [];
  for (const def of defs) {
    for (const [state, declared] of def.states) {
      if (wanted.length > 0 && !wanted.includes(state)) continue;
      rows.push({ def, state, frames: declared.frames });
    }
  }
  if (rows.length === 0) throw new Error(`No row named "${only}"`);
  return rows;
}

/**
 * One row per state, every frame of it, with the tile the art hangs off drawn
 * over each cell and a strip of first frames at the size the game blits them.
 */
function renderFigurePanel(
  defs: readonly FigureDef[],
  outPath: string,
  scale: number,
  only: string,
): void {
  const rows = rowsOf(defs, only);
  const sheets = new Map<string, Canvas>();
  for (const def of defs) sheets.set(def.id, bakeFigureSheet(def).canvas);
  const sheetRowIndex = new Map<string, number>();
  for (const def of defs) {
    [...def.states.keys()].forEach((state, index) =>
      sheetRowIndex.set(`${def.id}|${state}`, index),
    );
  }

  const cellWidthOf = (row: Row): number => row.def.frameWidth * scale;
  const cellHeightOf = (row: Row): number => row.def.frameHeight * scale;
  const inGameScale = (row: Row): number => IN_GAME_TILE / row.def.tileScale;

  const gridWidth =
    PADDING + Math.max(...rows.map((row) => row.frames * (cellWidthOf(row) + PADDING)));
  const stripWidth =
    PADDING +
    rows.reduce((total, row) => total + row.def.frameWidth * inGameScale(row) + PADDING, 0);
  const stripHeight = Math.max(...rows.map((row) => row.def.frameHeight * inGameScale(row)));
  const gridHeight = rows.reduce(
    (total, row) => total + cellHeightOf(row) + LABEL_HEIGHT + PADDING,
    PADDING,
  );

  const { canvas, ctx } = newPanel(
    Math.max(gridWidth, stripWidth),
    gridHeight + stripHeight + LABEL_HEIGHT + PADDING,
  );

  let y = PADDING;
  for (const row of rows) {
    const sheet = sheets.get(row.def.id);
    const rowIndex = sheetRowIndex.get(`${row.def.id}|${row.state}`);
    if (sheet === undefined || rowIndex === undefined) {
      throw new Error(`no baked sheet row for ${row.def.id}.${row.state}`);
    }
    const cellW = cellWidthOf(row);
    const cellH = cellHeightOf(row);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${row.def.id} — ${row.state} — ${row.frames} frames`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < row.frames; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = LAB_FLOOR;
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(
        sheet,
        frame * row.def.frameWidth,
        rowIndex * row.def.frameHeight,
        row.def.frameWidth,
        row.def.frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + row.def.tileX * scale,
        y + row.def.tileY * scale,
        row.def.tileScale * scale,
        row.def.tileScale * scale,
      );
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  let stripX = PADDING;
  for (const row of rows) {
    const sheet = sheets.get(row.def.id);
    const rowIndex = sheetRowIndex.get(`${row.def.id}|${row.state}`);
    if (sheet === undefined || rowIndex === undefined) continue;
    const width = row.def.frameWidth * inGameScale(row);
    const height = row.def.frameHeight * inGameScale(row);
    ctx.fillStyle = LAB_FLOOR;
    ctx.fillRect(stripX, y, width, height);
    ctx.drawImage(
      sheet,
      0,
      rowIndex * row.def.frameHeight,
      row.def.frameWidth,
      row.def.frameHeight,
      stripX,
      y,
      width,
      height,
    );
    stripX += width + PADDING;
  }

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

function main(): void {
  // Ahead of the contact sheets rather than after them: a sheet is a
  // tens-of-megapixel allocation, and measuring art on the far side of one is
  // how a gate goes red on art nobody touched.
  console.log('Gating the spider figures…');
  reportFigureGates('grotesque spider', spiderGateFailures());
  reportFigureGates('small spider', smallSpiderGateFailures());

  const subjects = parseSubjects();
  const single = subjects.length === 1;
  // A row filter only makes sense against one subject: applied to all three it
  // would throw on the two that have no row by that name.
  const only = single ? parseFlag('row', '') : '';
  const outFor = (fallback: string): string =>
    single ? parseFlag('out', `${PREVIEW_DIR}/${fallback}`) : `${PREVIEW_DIR}/${fallback}`;

  if (subjects.includes('boss')) {
    renderFigurePanel(
      GROTESQUE_SPIDER_FIGURES,
      outFor('grotesque-spider-review.png'),
      parseNumberFlag('scale', DEFAULT_BOSS_SCALE, MIN_SCALE, MAX_SCALE),
      only,
    );
  }
  if (subjects.includes('spit')) {
    renderFigurePanel(
      GROTESQUE_SPIDER_SPIT_EFFECT_FIGURES,
      outFor('spider-spit-review.png'),
      parseNumberFlag('scale', DEFAULT_EFFECT_SCALE, MIN_SCALE, MAX_SCALE),
      only,
    );
  }
  if (subjects.includes('small')) {
    renderFigurePanel(
      [SPIDER_FIGURE],
      outFor('spider-review.png'),
      parseNumberFlag('scale', DEFAULT_SMALL_SPIDER_SCALE, MIN_SCALE, MAX_SCALE),
      only,
    );
  }
}

main();
