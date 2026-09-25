/**
 * The Grave Bull's review harness. Runs the art gates first, then bakes a
 * contact sheet of every row, the loose bones, and an in-game strip beside a
 * living cow for scale.
 *
 *   npm run render:grave-bull
 *   npx tsx scripts/render-grave-bull.ts --scale=3 --row=paw_side
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureCell, bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { graveBullGateFailures } from './gates-grave-bull.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { GRAVE_BULL_FIGURE, GRAVE_BULL_ROWS } from '../src/sprites/art/graveBullFigure.js';
import { GRAVE_BULL_GORE_STATES } from '../src/sprites/art/graveBullArt.js';
import { cowFigure } from '../src/sprites/art/cowFigure.js';

const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 20;
const PADDING = 6;
const BACKDROP = '#55693f';
const LABEL_COLOR = '#f4efe4';
const LABEL_FONT = '13px sans-serif';
/** The art is painted at a 64 px tile and played at 32. */
const IN_GAME_SHRINK = 0.5;
const STRIP_STATES: readonly string[] = [
  'idle_side',
  'paw_side',
  'charge_side',
  'idle',
  'charge',
  'walk_away',
];

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function parseNumberFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

function render(scale: number, only: string): Canvas {
  const rows = only === '' ? GRAVE_BULL_ROWS : GRAVE_BULL_ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);
  const baked = bakeFigureSheet(
    GRAVE_BULL_FIGURE,
    rows.map((row) => row.name),
  );
  const fw = baked.frameWidth;
  const fh = baked.frameHeight;
  const cellW = fw * scale;
  const cellH = fh * scale;
  const cols = Math.max(...rows.map((row) => row.frameCount), GRAVE_BULL_GORE_STATES.length);
  const stripH = fh * IN_GAME_SHRINK;
  const height =
    PADDING + (rows.length + 1) * (cellH + LABEL_HEIGHT) + LABEL_HEIGHT + stripH + PADDING;
  const canvas = createCanvas(Math.ceil(PADDING + cols * (cellW + PADDING)), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  let y = PADDING;
  rows.forEach((row, index) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${row.name} — ${row.frameCount} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    for (let f = 0; f < row.frameCount; f++) {
      ctx.drawImage(
        baked.canvas,
        f * fw,
        index * fh,
        fw,
        fh,
        PADDING + f * (cellW + PADDING),
        y + LABEL_HEIGHT,
        cellW,
        cellH,
      );
    }
    y += cellH + LABEL_HEIGHT;
  });
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText('loose bones', PADDING, y + LABEL_HEIGHT - PADDING);
  GRAVE_BULL_GORE_STATES.forEach((state, i) => {
    ctx.drawImage(
      bakeFigureCell(GRAVE_BULL_FIGURE, state, 0),
      PADDING + i * (cellW + PADDING),
      y + LABEL_HEIGHT,
      cellW,
      cellH,
    );
  });
  y += cellH + LABEL_HEIGHT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText('in-game size (32 px tile), with a living cow', PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  const cow = cowFigure('holstein', 'adult');
  // Both stood on one ground line: each cell's tile top sits at its own tileY.
  const ground = y + stripH;
  const cowCell = bakeFigureCell(cow, 'idle_side', 0);
  const cowTop = ground - (cow.tileY + cow.tileScale) * IN_GAME_SHRINK;
  ctx.drawImage(
    cowCell,
    PADDING,
    cowTop,
    cow.frameWidth * IN_GAME_SHRINK,
    cow.frameHeight * IN_GAME_SHRINK,
  );
  STRIP_STATES.forEach((state, i) => {
    const cell = bakeFigureCell(GRAVE_BULL_FIGURE, state, 0);
    const top = ground - (GRAVE_BULL_FIGURE.tileY + GRAVE_BULL_FIGURE.tileScale) * IN_GAME_SHRINK;
    const x = PADDING + (i + 1) * fw * IN_GAME_SHRINK;
    ctx.drawImage(cell, x, top, fw * IN_GAME_SHRINK, fh * IN_GAME_SHRINK);
  });
  return canvas;
}

function main(): void {
  if (process.argv.includes('--no-gates')) {
    console.log('Skipping the Grave Bull gates (--no-gates)…');
  } else {
    console.log('Gating the Grave Bull figure…');
    reportFigureGates('grave bull', graveBullGateFailures());
  }
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const out = parseFlag('out', `${PREVIEW_DIR}/grave-bull-review.png`);
  const canvas = render(scale, parseFlag('row', ''));
  console.log(`Wrote ${writePreviewPng(out, canvas.toBuffer('image/png'))}`);
}

main();
