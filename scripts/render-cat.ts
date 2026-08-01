/**
 * Headless review harness for the cat sprite sheet.
 *
 * The browser harness cannot drive this project (a hidden tab never clears the
 * level-intro banner and never runs `requestAnimationFrame`), so the art has to
 * be judgeable from a still. This slices `src/images/characters/cat.png` into a
 * labelled contact sheet: every animation row at review scale, plus a strip of
 * the same frames blitted at the in-game tile size so the silhouette can be
 * checked at the size players actually see.
 *
 *   npx tsx scripts/render-cat.ts --out=cat-review.png --scale=2
 *   npx tsx scripts/render-cat.ts --out=cat-walk.png --row=walk --scale=5
 *
 * Regenerate the sheet itself with `npx tsx scripts/generate-cat-sprite.ts`.
 */

import { createCanvas, loadImage } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The row order and frame counts come straight from the generator, so a new row
// cannot desync the only review path this art has.
import {
  FRAME_H,
  FRAME_W,
  ROWS,
  SHEET_PATH,
  TILE_SCALE,
  TILE_X,
  TILE_Y,
} from './generate-cat-sprite.js';

/** Matches TILE_SIZE in src/core/constants.ts; the sheet is drawn at 2× that. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

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

async function main(): Promise<void> {
  const outPath = parseFlag('out', 'cat-review.png');
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');
  const sheet = await loadImage(resolve(SHEET_PATH));

  const onlyFrame = parseFlag('frame', '');
  const rows = only === '' ? ROWS : ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);
  const longestRow = Math.max(...rows.map((row) => row.frameCount));
  const firstFrame = onlyFrame === '' ? 0 : parseNumberFlag('frame', 0, 0, longestRow - 1);
  const framesPerRow = (row: (typeof ROWS)[number]): number =>
    onlyFrame === '' ? row.frameCount : 1;

  const cell = FRAME_W * scale;
  const maxCols = Math.max(...rows.map(framesPerRow));
  const inGameFrame = FRAME_W * (IN_GAME_TILE / TILE_SCALE);

  // With --frame the grid is one cell wide, but the in-game strip below it still
  // holds one thumbnail per row, and that is what sets the width.
  const stripWidth = PADDING + rows.length * (inGameFrame + PADDING);
  const width = Math.max(PADDING + maxCols * (cell + PADDING), stripWidth);
  const height =
    PADDING +
    rows.length * (cell + LABEL_HEIGHT + PADDING) +
    (inGameFrame + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const spec of rows) {
    const sheetRow = ROWS.findIndex((row) => row.name === spec.name);
    ctx.fillStyle = LABEL_COLOR;
    const shown = framesPerRow(spec);
    const label =
      onlyFrame === ''
        ? `${spec.name} — ${spec.frameCount} frames`
        : `${spec.name} — frame ${firstFrame} of ${spec.frameCount}`;
    ctx.fillText(label, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let i = 0; i < shown; i++) {
      const col = firstFrame + i;
      const x = PADDING + i * (cell + PADDING);
      ctx.drawImage(sheet, col * FRAME_W, sheetRow * FRAME_H, FRAME_W, FRAME_H, x, y, cell, cell);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cell, cell);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + TILE_X * scale,
        y + TILE_Y * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    }
    y += cell + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText('in-game size (32px tile)', PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  for (let i = 0; i < rows.length; i++) {
    const sheetRow = ROWS.findIndex((row) => row.name === rows[i].name);
    const x = PADDING + i * (inGameFrame + PADDING);
    ctx.drawImage(
      sheet,
      firstFrame * FRAME_W,
      sheetRow * FRAME_H,
      FRAME_W,
      FRAME_H,
      x,
      y,
      inGameFrame,
      inGameFrame,
    );
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${width}×${height}px, scale ${scale}×)`);
}

void main();
