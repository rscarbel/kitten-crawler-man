/**
 * Shady's review harness. Art has to be judged as an image, by something that
 * only looks at the image — every defect that has ever mattered on a figure in
 * this project was invisible to `typecheck`, `lint` and a code read.
 *
 * The contact sheet is painted from `SHADY_FIGURE` the way the runtime cache
 * bakes it, and the art gates run as part of the render, so one command answers
 * both "does it still hold together" and "what does it look like".
 *
 *   npm run render:shady
 *   npx tsx scripts/render-shady.ts --scale=3 --row=scratch
 *   npx tsx scripts/render-shady.ts --part=hood --scale=6
 */

import { createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { shadyGateFailures } from './gates-shady.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { SHADY_FIGURE, SHADY_ROWS, TILE_SCALE } from '../src/sprites/art/shadyFigure.js';

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Windows onto one part of the figure, in frame pixels. A whole-figure contact
 * sheet hides exactly what matters most here — whether the cowl is a void and
 * whether the hands read as hands.
 */
const PARTS: Record<string, PartWindow> = {
  hood: { x: 40, y: 20, w: 48, h: 48 },
  hands: { x: 32, y: 56, w: 64, h: 44 },
  hem: { x: 32, y: 84, w: 64, h: 40 },
};

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
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

function main(): void {
  const outPath = parseFlag('out', `${PREVIEW_DIR}/shady-review.png`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');

  const rows = only === '' ? SHADY_ROWS : SHADY_ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);

  const partName = parseFlag('part', '');
  const part = partName === '' ? null : PARTS[partName];
  if (partName !== '' && part === undefined) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PARTS).join(', ')}`);
  }

  // Ahead of the contact sheet rather than after it: the sheet is a large
  // allocation, and measuring the art on the far side of one is how a gate
  // starts reporting a fault in art nobody touched.
  console.log('Gating the shady figure…');
  reportFigureGates('shady', shadyGateFailures());

  const baked = bakeFigureSheet(
    SHADY_FIGURE,
    rows.map((row) => row.name),
  );
  const sheet = baked.canvas;
  const frameW = baked.frameWidth;
  const frameH = baked.frameHeight;

  const cropped = part !== null && part !== undefined;
  const srcW = cropped ? part.w : frameW;
  const srcH = cropped ? part.h : frameH;
  const srcOffsetX = cropped ? part.x : 0;
  const srcOffsetY = cropped ? part.y : 0;
  const cellW = srcW * scale;
  const cellH = srcH * scale;
  const maxCols = Math.max(...rows.map((row) => row.frameCount));
  const inGameFrame = frameW * (IN_GAME_TILE / TILE_SCALE);

  const stripWidth = PADDING + rows.length * (inGameFrame + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING +
    rows.length * (cellH + LABEL_HEIGHT + PADDING) +
    (inGameFrame + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  rows.forEach((spec, sheetRow) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${spec.name} — ${spec.frameCount} frames, ${spec.loops ? 'loop' : 'one-shot'}` +
        (cropped ? `  [${partName}]` : ''),
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    for (let col = 0; col < spec.frameCount; col++) {
      const x = PADDING + col * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        col * frameW + srcOffsetX,
        sheetRow * frameH + srcOffsetY,
        srcW,
        srcH,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (!cropped) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + SHADY_FIGURE.tileX * scale,
          y + SHADY_FIGURE.tileY * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
    }
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText('in-game size (32px tile)', PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  rows.forEach((_spec, sheetRow) => {
    ctx.drawImage(
      sheet,
      0,
      sheetRow * frameH,
      frameW,
      frameH,
      PADDING + sheetRow * (inGameFrame + PADDING),
      y,
      inGameFrame,
      inGameFrame,
    );
  });

  const written = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${written} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

main();
