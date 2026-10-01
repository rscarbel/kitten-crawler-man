/**
 *   npm run render:heather-bear
 *   npx tsx scripts/render-heather-bear.ts --scale=4 --row=attack
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureCell, bakeFigureSheet } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  reportFigureGates,
} from './figureGates.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { HEATHER_BEAR_FIGURE, HEATHER_ROWS } from '../src/sprites/art/heatherBearFigure.js';
import { HEATHER_DRAWN_STATES } from '../src/sprites/heatherBearSprite.js';

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 20;
const PADDING = 6;
const BACKDROP = '#55693f';
const LABEL_COLOR = '#f4efe4';
const LABEL_FONT = '13px sans-serif';
const IN_GAME_SHRINK = 0.5;

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
  const rows = only === '' ? HEATHER_ROWS : HEATHER_ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);
  const baked = bakeFigureSheet(
    HEATHER_BEAR_FIGURE,
    rows.map((row) => row.name),
  );
  const fw = baked.frameWidth;
  const fh = baked.frameHeight;
  const cellW = fw * scale;
  const cellH = fh * scale;
  const cols = Math.max(...rows.map((row) => row.frameCount));
  const smallW = fw * IN_GAME_SHRINK;
  const smallH = fh * IN_GAME_SHRINK;
  const height =
    PADDING +
    rows.length * (cellH + LABEL_HEIGHT) +
    rows.length * (smallH + LABEL_HEIGHT) +
    PADDING;
  const width = Math.max(PADDING + cols * (cellW + PADDING), PADDING + cols * smallW);
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
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
  for (const row of rows) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${row.name} at in-game size (32 px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
    for (let f = 0; f < row.frameCount; f++) {
      const cell = bakeFigureCell(HEATHER_BEAR_FIGURE, row.name, f);
      ctx.drawImage(cell, PADDING + f * smallW, y + LABEL_HEIGHT, smallW, smallH);
    }
    y += smallH + LABEL_HEIGHT;
  }
  return canvas;
}

function main(): void {
  if (process.argv.includes('--no-gates')) {
    console.log('Skipping the Heather gates (--no-gates)…');
  } else {
    console.log('Gating the Heather figure…');
    reportFigureGates('heather bear', [
      ...figureStructuralFailures(HEATHER_BEAR_FIGURE),
      ...missingStateFailures(HEATHER_BEAR_FIGURE, HEATHER_DRAWN_STATES, 'heatherBearSprite'),
    ]);
  }
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const out = parseFlag('out', `${PREVIEW_DIR}/heather-bear-review.png`);
  const canvas = render(scale, parseFlag('row', ''));
  console.log(`Wrote ${writePreviewPng(out, canvas.toBuffer('image/png'))}`);
}

main();
