/**
 * Headless review harness for Carl's sprite sheet.
 *
 * The browser harness cannot reliably drive this project, so the art has to be
 * judgeable from a still. This slices `src/images/characters/human.png` into a
 * labelled contact sheet: every animation row at review scale, plus a strip of
 * the same frames blitted at the in-game tile size so the silhouette can be
 * checked at the size players actually see.
 *
 *   npx tsx scripts/render-human.ts --out=human-review.png --scale=2
 *   npx tsx scripts/render-human.ts --out=smush.png --row=smush --scale=4
 *
 * Regenerate the sheet itself with `npm run gen:human`.
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
} from './generate-human-sprite.js';

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Windows onto one body part, in frame pixels, so a reviewer can judge the
 * hands or the face at a scale where they are actually visible. Whole-figure
 * contact sheets hide exactly the defects that matter most at these sizes.
 */
const PARTS: Record<string, PartWindow> = {
  head: { x: 62, y: 62, w: 68, h: 68 },
  torso: { x: 40, y: 60, w: 112, h: 80 },
  hands: { x: 32, y: 90, w: 128, h: 60 },
  legs: { x: 40, y: 120, w: 112, h: 72 },
  feet: { x: 40, y: 150, w: 112, h: 42 },
};

/** Matches TILE_SIZE in src/core/constants.ts; the sheet is drawn at 2× that. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 1.5;
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
  const outPath = parseFlag('out', 'human-review.png');
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

  // A part is judged by looking at it, so the sheet can be cropped to one:
  // `--part=head` at a high scale is how a reviewer sees the face at all.
  const part = PARTS[parseFlag('part', '')] ?? null;
  const srcW = part === null ? FRAME_W : part.w;
  const srcH = part === null ? FRAME_H : part.h;
  const srcOffsetX = part === null ? 0 : part.x;
  const srcOffsetY = part === null ? 0 : part.y;
  const cell = srcW * scale;
  const cellH = srcH * scale;
  const maxCols = Math.max(...rows.map(framesPerRow));
  const inGameFrame = FRAME_W * (IN_GAME_TILE / TILE_SCALE);

  const stripWidth = PADDING + rows.length * (inGameFrame + PADDING);
  const width = Math.max(PADDING + maxCols * (cell + PADDING), stripWidth);
  const height =
    PADDING +
    rows.length * (cellH + LABEL_HEIGHT + PADDING) +
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
        ? `${spec.name} — ${spec.frameCount} frames, ${spec.view}`
        : `${spec.name} — frame ${firstFrame} of ${spec.frameCount}`;
    ctx.fillText(label, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let i = 0; i < shown; i++) {
      const col = firstFrame + i;
      const x = PADDING + i * (cell + PADDING);
      ctx.drawImage(
        sheet,
        col * FRAME_W + srcOffsetX,
        sheetRow * FRAME_H + srcOffsetY,
        srcW,
        srcH,
        x,
        y,
        cell,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cell, cellH);
      if (part === null) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + TILE_X * scale,
          y + TILE_Y * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
    }
    y += cellH + PADDING;
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
