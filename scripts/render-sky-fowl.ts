/**
 * The Sky Fowl's review harness. Art has to be judged as an image, by something
 * that only looks at the image — every defect that has ever mattered on a figure
 * in this project was invisible to `typecheck`, `lint` and a code read.
 *
 * The contact sheet is painted from the palette figures the way the runtime
 * cache bakes them, and the art gates run as part of the render, so one command
 * answers both "does it still hold together" and "what does it look like".
 *
 * A fowl's clothes are part of its art rather than a tint laid over it, so the
 * sheet shows several palettes: one that looks right in blue and wrong in olive
 * is exactly the failure this creature can have and no other can.
 *
 *   npm run render:sky-fowl
 *   npx tsx scripts/render-sky-fowl.ts --scale=4 --row=walk
 *   npx tsx scripts/render-sky-fowl.ts --palettes=0,1,2,3,4,5,6,7
 */

import { createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { skyFowlGateFailures } from './gates-sky-fowl.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { SKY_FOWL_FIGURES, SKY_FOWL_ROWS, TILE_SCALE } from '../src/sprites/art/skyFowlFigure.js';
import { SKY_FOWL_PALETTES } from '../src/sprites/art/skyFowlArt.js';

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;

/** One hatted and one bare-headed palette, which is the whole structural range. */
const DEFAULT_PALETTES = '0,2';

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

function parsePalettes(): number[] {
  return parseFlag('palettes', DEFAULT_PALETTES)
    .split(',')
    .filter((part) => part !== '')
    .map((part) => {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= SKY_FOWL_FIGURES.length) {
        throw new Error(`--palettes: ${part} is not one of 0..${SKY_FOWL_FIGURES.length - 1}`);
      }
      return index;
    });
}

function main(): void {
  const outPath = parseFlag('out', `${PREVIEW_DIR}/sky-fowl-review.png`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');
  const palettes = parsePalettes();
  if (palettes.length === 0) throw new Error('--palettes selected no palettes');

  const rows = only === '' ? SKY_FOWL_ROWS : SKY_FOWL_ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);

  // Ahead of the contact sheet rather than after it: the sheet is a large
  // allocation, and measuring the art on the far side of one is how a gate
  // starts reporting a fault in art nobody touched.
  console.log('Gating the sky fowl figures…');
  reportFigureGates('sky-fowl', skyFowlGateFailures());

  const cellW = SKY_FOWL_FIGURES[0].frameWidth * scale;
  const cellH = SKY_FOWL_FIGURES[0].frameHeight * scale;
  const maxCols = Math.max(...rows.map((row) => row.frameCount));
  const inGameFrame = SKY_FOWL_FIGURES[0].frameWidth * (IN_GAME_TILE / TILE_SCALE);
  const inGameHeight = SKY_FOWL_FIGURES[0].frameHeight * (IN_GAME_TILE / TILE_SCALE);
  const totalInGameCells = rows.reduce((sum, row) => sum + row.frameCount, 0);

  const width = Math.max(
    PADDING + maxCols * (cellW + PADDING),
    PADDING + totalInGameCells * (inGameFrame + PADDING),
  );
  const perPalette =
    LABEL_HEIGHT +
    rows.length * (cellH + LABEL_HEIGHT + PADDING) +
    LABEL_HEIGHT +
    inGameHeight +
    PADDING;
  const height = PADDING + palettes.length * perPalette;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const paletteIndex of palettes) {
    const figure = SKY_FOWL_FIGURES[paletteIndex];
    const cloth = SKY_FOWL_PALETTES[paletteIndex];
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `palette ${paletteIndex} (${figure.id}) — vest ${cloth.vest}, trousers ${cloth.pants}, ` +
        `trim ${cloth.trim}, hat ${cloth.hat ?? 'none'}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    const baked = bakeFigureSheet(
      figure,
      rows.map((row) => row.name),
    );
    const sheet = baked.canvas;
    const frameW = baked.frameWidth;
    const frameH = baked.frameHeight;

    rows.forEach((spec, sheetRow) => {
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(
        `${spec.name} — ${spec.frameCount} frames, ${spec.loops ? 'loop' : 'one-shot'}`,
        PADDING,
        y + LABEL_HEIGHT - PADDING,
      );
      y += LABEL_HEIGHT;
      for (let col = 0; col < spec.frameCount; col++) {
        const x = PADDING + col * (cellW + PADDING);
        ctx.drawImage(sheet, col * frameW, sheetRow * frameH, frameW, frameH, x, y, cellW, cellH);
        ctx.strokeStyle = GRID_LINE;
        ctx.strokeRect(x, y, cellW, cellH);
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + figure.tileX * scale,
          y + figure.tileY * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
      y += cellH + PADDING;
    });

    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText('in-game size (32px tile)', PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    let column = 0;
    rows.forEach((spec, sheetRow) => {
      for (let col = 0; col < spec.frameCount; col++) {
        ctx.drawImage(
          sheet,
          col * frameW,
          sheetRow * frameH,
          frameW,
          frameH,
          PADDING + column * (inGameFrame + PADDING),
          y,
          inGameFrame,
          inGameHeight,
        );
        column++;
      }
    });
    y += inGameHeight + PADDING;
  }

  const written = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${written} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

main();
