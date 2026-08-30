#!/usr/bin/env tsx
/**
 * Headless review harness for The Lich.
 *
 * A still cannot answer "does this move well", but it is the only thing that can
 * answer the question this art lives or dies on: does a near-black figure still
 * have a silhouette on a dark floor at a 32 px tile. Every panel is therefore
 * drawn twice — once at review scale over a light backdrop, and once at the size
 * it actually renders over the dim tower stone it is actually fought on.
 *
 * The art gates run first, before a contact sheet is baked: a sheet is a
 * tens-of-megapixel allocation, and a gate that measures on the far side of one
 * is a gate that reports seams nobody drew.
 *
 *   npm run render:lich
 *   npx tsx scripts/render-lich.ts --row=cast_side --scale=5
 *   npx tsx scripts/render-lich.ts --mode=parts --part=head --scale=4
 *   npx tsx scripts/render-lich.ts --mode=gore
 */

import { type Canvas, createCanvas } from 'canvas';

// Row order, frame counts and cell geometry come straight from the figure, so a
// new row cannot desync the only review path this art has.
import { bakeFigureCell, bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { lichGateFailures } from './gates-lich.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  GORE_STATES,
  LICH_FIGURE,
  LICH_ROWS,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/lichFigure.js';

const { frameWidth, frameHeight, tileX, tileY } = LICH_FIGURE;

/** The animation rows, in the order the figure declares them. */
const ANIMATION_STATES: string[] = LICH_ROWS.map((row) => row.name);

/** Matches TILE_SIZE in src/core/constants.ts; the sheet is drawn at 2× that. */
const IN_GAME_TILE = 32;
const GORE_RENDER_SCALE = IN_GAME_TILE / TILE_SCALE;
/** The three sizes a bone has to survive, largest first. */
const GORE_REVIEW_SCALES: readonly number[] = [4, 1, GORE_RENDER_SCALE];

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#4a4a50';
/**
 * The tower floor this boss is fought on. The in-game strip sits on this and
 * nothing else: reviewing a near-black figure over a light grey backdrop is how
 * a creature ships that nobody can see in the room it lives in.
 */
const DIM_FLOOR = '#3a3630';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

/**
 * Where each body part sits inside a frame, in frame pixels.
 *
 * A whole-figure contact sheet hides exactly the defects that matter most at
 * these sizes — the hands and the cowl are where a review always finds the most.
 */
interface Crop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const PART_CROPS: Record<string, Crop> = {
  head: { x: 32, y: 8, w: 64, h: 64 },
  chest: { x: 20, y: 50, w: 88, h: 72 },
  hands: { x: 4, y: 60, w: 120, h: 80 },
  hem: { x: 16, y: 130, w: 96, h: 80 },
};

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

function rowIndexOf(name: string): number {
  const index = ANIMATION_STATES.indexOf(name);
  if (index < 0) throw new Error(`the_lich has no row named "${name}"`);
  return index;
}

function rowNamed(name: string): RowSpec {
  const row = LICH_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) throw new Error(`the_lich has no row named "${name}"`);
  return row;
}

/**
 * The loose bones at the three sizes that matter. The bottom strip is the exit
 * criterion: name all seven from it, or the set has failed.
 */
function renderGorePanel(outPath: string): void {
  const pieceCount = GORE_STATES.length;
  if (pieceCount === 0) throw new Error('the_lich paints no loose bones');
  const cells = GORE_STATES.map((state) => bakeFigureCell(LICH_FIGURE, state, 0));

  const widths = GORE_REVIEW_SCALES.map((scale) => frameWidth * scale);
  const width = PADDING + Math.max(...widths.map((w) => pieceCount * (w + PADDING)));
  const height =
    PADDING +
    GORE_REVIEW_SCALES.reduce(
      (total, scale) => total + frameHeight * scale + LABEL_HEIGHT + PADDING,
      0,
    );

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const scale of GORE_REVIEW_SCALES) {
    const cellW = frameWidth * scale;
    const cellH = frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    const caption =
      scale === GORE_RENDER_SCALE
        ? `the_lich — at the size it renders in game; name all ${pieceCount} from this row`
        : `the_lich — ${scale}×`;
    ctx.fillText(caption, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let piece = 0; piece < pieceCount; piece++) {
      const x = PADDING + piece * (cellW + PADDING);
      ctx.drawImage(cells[piece], 0, 0, frameWidth, frameHeight, x, y, cellW, cellH);
      if (scale === Math.max(...GORE_REVIEW_SCALES)) {
        ctx.fillStyle = LABEL_COLOR;
        ctx.fillText(GORE_STATES[piece] ?? '?', x, y + cellH + LABEL_HEIGHT - PADDING);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  }

  const writtenPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${writtenPath} (${canvas.width}×${canvas.height}px, the_lich bones)`);
}

/** One body part cropped across every frame of one row. */
function renderPartsPanel(
  sheet: Canvas,
  outPath: string,
  scale: number,
  partName: string,
  rowName: string,
): void {
  const crop = PART_CROPS[partName];
  if (crop === undefined) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PART_CROPS).join(' | ')}`);
  }
  const row = rowNamed(rowName);
  const cellW = crop.w * scale;
  const cellH = crop.h * scale;
  const canvas = createCanvas(
    Math.ceil(PADDING + row.frameCount * (cellW + PADDING)),
    Math.ceil(PADDING + LABEL_HEIGHT + cellH + PADDING),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = DIM_FLOOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    `the_lich — ${rowName} / ${partName} — ${scale}×`,
    PADDING,
    PADDING + LABEL_HEIGHT - PADDING,
  );

  for (let frame = 0; frame < row.frameCount; frame++) {
    ctx.drawImage(
      sheet,
      frame * frameWidth + crop.x,
      rowIndexOf(rowName) * frameHeight + crop.y,
      crop.w,
      crop.h,
      PADDING + frame * (cellW + PADDING),
      PADDING + LABEL_HEIGHT,
      cellW,
      cellH,
    );
  }
  const writtenPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(
    `Wrote ${writtenPath} (${canvas.width}×${canvas.height}px, ${partName} of ${rowName})`,
  );
}

function renderSheetPanel(
  sheet: Canvas,
  outPath: string,
  scale: number,
  only: string,
  onlyFrame: string,
): void {
  const rows: readonly RowSpec[] =
    only === '' ? LICH_ROWS : LICH_ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`the_lich has no row named "${only}"`);
  const longestRow = Math.max(...rows.map((row) => row.frameCount));
  const firstFrame = onlyFrame === '' ? 0 : parseNumberFlag('frame', 0, 0, longestRow - 1);
  const framesPerRow = (row: RowSpec): number => (onlyFrame === '' ? row.frameCount : 1);

  const cellW = frameWidth * scale;
  const cellH = frameHeight * scale;
  const maxCols = Math.max(...rows.map(framesPerRow));
  const inGameW = frameWidth * (IN_GAME_TILE / TILE_SCALE);
  const inGameH = frameHeight * (IN_GAME_TILE / TILE_SCALE);

  const stripWidth = PADDING + rows.length * (inGameW + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING +
    LABEL_HEIGHT +
    rows.length * (cellH + LABEL_HEIGHT + PADDING) +
    (inGameH + LABEL_HEIGHT + PADDING) * 2;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`the_lich — ${scale}×`, PADDING, PADDING + LABEL_HEIGHT - PADDING);
  let y = PADDING + LABEL_HEIGHT;

  for (const row of rows) {
    const sheetRow = rowIndexOf(row.name);
    ctx.fillStyle = LABEL_COLOR;
    const shown = framesPerRow(row);
    ctx.fillText(
      onlyFrame === ''
        ? `${row.name} — ${row.frameCount} frames`
        : `${row.name} — frame ${firstFrame} of ${row.frameCount}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    for (let i = 0; i < shown; i++) {
      const col = firstFrame + i;
      const x = PADDING + i * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        col * frameWidth,
        sheetRow * frameHeight,
        frameWidth,
        frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(x + tileX * scale, y + tileY * scale, TILE_SCALE * scale, TILE_SCALE * scale);
    }
    y += cellH + PADDING;
  }

  // The two strips that decide it: the same frames at the size they render, once
  // over the review backdrop and once over the floor of the room they are fought
  // in. If the second strip is a smudge, the art has failed however good the
  // panels above it look.
  const strips: ReadonlyArray<readonly [string, string]> = [
    [`in-game size (${IN_GAME_TILE}px tile)`, BACKDROP],
    [`in-game size on the tower floor (${DIM_FLOOR})`, DIM_FLOOR],
  ];
  for (const [caption, background] of strips) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(caption, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    ctx.fillStyle = background;
    ctx.fillRect(0, y, canvas.width, inGameH);
    for (let i = 0; i < rows.length; i++) {
      ctx.drawImage(
        sheet,
        firstFrame * frameWidth,
        rowIndexOf(rows[i].name) * frameHeight,
        frameWidth,
        frameHeight,
        PADDING + i * (inGameW + PADDING),
        y,
        inGameW,
        inGameH,
      );
    }
    y += inGameH + PADDING;
  }

  const writtenPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${writtenPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

function main(): void {
  const mode = parseFlag('mode', 'sheet');
  const outPath = parseFlag('out', `${PREVIEW_DIR}/lich-${mode}.png`);

  // Gates before the contact sheet, always. A sheet is a tens-of-megapixel
  // allocation, and measuring the art on the far side of one is how a gate
  // starts reporting defects nobody drew.
  reportFigureGates('the_lich', lichGateFailures());

  if (mode === 'gore') {
    renderGorePanel(outPath);
    return;
  }
  const sheet = bakeFigureSheet(LICH_FIGURE, ANIMATION_STATES).canvas;
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  if (mode === 'parts') {
    renderPartsPanel(sheet, outPath, scale, parseFlag('part', 'head'), parseFlag('row', 'idle'));
    return;
  }
  renderSheetPanel(sheet, outPath, scale, parseFlag('row', ''), parseFlag('frame', ''));
}

main();
