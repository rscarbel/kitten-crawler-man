/**
 * Headless review harness for the spider sprite sheet.
 *
 * The browser harness cannot drive this project (a hidden tab never clears the
 * level-intro banner and never runs `requestAnimationFrame`), so the art has to
 * be judgeable from a still. This slices `src/images/enemies/spider.png` into a
 * labelled contact sheet: every animation row at review scale, plus a strip of
 * the same frames blitted at the in-game tile size so the silhouette can be
 * checked at the size players actually see.
 *
 *   npx tsx scripts/render-spider.ts --out=spider-review.png --scale=3
 *
 * Regenerate the sheet itself with `npx tsx scripts/generate-spider-sprite.ts`.
 */

import { createCanvas, loadImage } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../src/images/enemies/manifest.json';

// Geometry is read from the manifest rather than restated here: a harness that
// silently slices the wrong rectangles is worse than no harness at all.
const SPIDER = manifest.spider;
const SHEET_PATH = `src/images/${SPIDER.path}`;
const FRAME_W = SPIDER.frameWidth;
const FRAME_H = SPIDER.frameHeight;
const SHEET_TILE_SCALE = SPIDER.tileScale;
/** Matches TILE_SIZE in src/core/constants.ts; the sheet is drawn at 2× that. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 3;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

interface RowSpec {
  readonly name: string;
  readonly row: number;
  readonly frameCount: number;
}

const ROWS: readonly RowSpec[] = Object.entries(SPIDER.states)
  .map(([name, state]) => ({ name, row: state.row, frameCount: state.frameCount }))
  .sort((a, b) => a.row - b.row);

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

async function main(): Promise<void> {
  const outPath = parseFlag('out', 'spider-review.png');
  const scale = Number(parseFlag('scale', String(DEFAULT_SCALE)));
  const sheet = await loadImage(resolve(SHEET_PATH));

  const cellW = FRAME_W * scale;
  const cellH = FRAME_H * scale;
  const maxCols = Math.max(...ROWS.map((row) => row.frameCount));
  const inGameW = FRAME_W * (IN_GAME_TILE / SHEET_TILE_SCALE);
  const inGameH = FRAME_H * (IN_GAME_TILE / SHEET_TILE_SCALE);

  const width = PADDING + maxCols * (cellW + PADDING);
  const height =
    PADDING + ROWS.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const spec of ROWS) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${spec.name} — ${spec.frameCount} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let col = 0; col < spec.frameCount; col++) {
      const x = PADDING + col * (cellW + PADDING);
      const srcY = spec.row * FRAME_H;
      ctx.drawImage(sheet, col * FRAME_W, srcY, FRAME_W, FRAME_H, x, y, cellW, cellH);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  ROWS.forEach((spec, i) => {
    const x = PADDING + i * (inGameW + PADDING);
    ctx.drawImage(sheet, 0, spec.row * FRAME_H, FRAME_W, FRAME_H, x, y, inGameW, inGameH);
  });

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${width}×${height}px, scale ${scale}×)`);
}

void main();
