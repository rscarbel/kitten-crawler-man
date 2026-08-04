/**
 * Headless review harness for the Brindled Vespa sprite sheet, modelled on
 * `scripts/render-mantid.ts`.
 *
 *   npx tsx scripts/render-vespa.ts --out=vespa-review.png
 *   npx tsx scripts/render-vespa.ts --out=vespa-gore.png --mode=gore
 *   npx tsx scripts/render-vespa.ts --out=windup.png --row=spit_windup_side --scale=4
 *
 * Regenerate the sheet itself with `npm run gen:vespa`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  GORE_STATES,
  TILE_SCALE,
  VARIANT,
  bake,
  type RowSpec,
  type SheetGeometry,
} from './generate-brindled-vespa-sprite.js';

const IN_GAME_TILE = 32;
const GORE_RENDER_SCALE = IN_GAME_TILE / TILE_SCALE;
const GORE_REVIEW_SCALES: readonly number[] = [3, 1, GORE_RENDER_SCALE];

const DEFAULT_SCALE = 4;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

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

function renderGorePanel(
  sheet: Image,
  rows: readonly RowSpec[],
  geometry: SheetGeometry,
  outPath: string,
): void {
  const goreRow = rows.findIndex((row) => row.kind === 'gore');
  if (goreRow < 0) throw new Error('the generator has no gore row');
  const pieceCount = rows[goreRow].frameCount;

  const widths = GORE_REVIEW_SCALES.map((scale) => geometry.frameWidth * scale);
  const width = PADDING + Math.max(...widths.map((w) => pieceCount * (w + PADDING)));
  const height =
    PADDING +
    GORE_REVIEW_SCALES.reduce(
      (total, scale) => total + geometry.frameHeight * scale + LABEL_HEIGHT + PADDING,
      0,
    );

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const scale of GORE_REVIEW_SCALES) {
    const cellW = geometry.frameWidth * scale;
    const cellH = geometry.frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    const caption =
      scale === GORE_RENDER_SCALE
        ? 'at the size it renders in game — name all eight from this row'
        : `${scale}×`;
    ctx.fillText(caption, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let piece = 0; piece < pieceCount; piece++) {
      const x = PADDING + piece * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        piece * geometry.frameWidth,
        goreRow * geometry.frameHeight,
        geometry.frameWidth,
        geometry.frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      if (scale === Math.max(...GORE_REVIEW_SCALES)) {
        ctx.fillStyle = LABEL_COLOR;
        ctx.fillText(GORE_STATES[piece] ?? '?', x, y + cellH + LABEL_HEIGHT - PADDING);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, gore panel)`);
}

function renderSheetPanel(
  sheet: Image,
  rows: readonly RowSpec[],
  geometry: SheetGeometry,
  outPath: string,
  scale: number,
  only: string,
): void {
  const animationRows = rows.filter((row) => row.kind !== 'gore');
  const shownRows = only === '' ? animationRows : rows.filter((row) => row.name === only);
  if (shownRows.length === 0) throw new Error(`No row named "${only}"`);
  const maxCols = Math.max(...shownRows.map((row) => row.frameCount));

  const cellW = geometry.frameWidth * scale;
  const cellH = geometry.frameHeight * scale;
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const inGW = geometry.frameWidth * inGameScale;
  const inGH = geometry.frameHeight * inGameScale;

  const width = Math.max(
    PADDING + maxCols * (cellW + PADDING),
    PADDING + shownRows.length * (inGW + PADDING),
  );
  const height =
    PADDING + shownRows.length * (cellH + LABEL_HEIGHT + PADDING) + (inGH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const spec of shownRows) {
    const rowIndex = rows.findIndex((row) => row.name === spec.name);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${spec.name} — ${spec.frameCount} frames (${spec.view})`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    for (let i = 0; i < spec.frameCount; i++) {
      const x = PADDING + i * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        i * geometry.frameWidth,
        rowIndex * geometry.frameHeight,
        geometry.frameWidth,
        geometry.frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  for (let i = 0; i < shownRows.length; i++) {
    const rowIndex = rows.findIndex((row) => row.name === shownRows[i].name);
    ctx.drawImage(
      sheet,
      0,
      rowIndex * geometry.frameHeight,
      geometry.frameWidth,
      geometry.frameHeight,
      PADDING + i * (inGW + PADDING),
      y,
      inGW,
      inGH,
    );
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

async function main(): Promise<void> {
  const mode = parseFlag('mode', 'sheet');
  const outPath = parseFlag('out', `brindled_vespa-${mode}.png`);
  const sheet = await loadImage(resolve(VARIANT.sheetPath));
  const geometry = bake(VARIANT).geometry;

  if (mode === 'gore') {
    renderGorePanel(sheet, VARIANT.rows, geometry, outPath);
    return;
  }
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  renderSheetPanel(sheet, VARIANT.rows, geometry, outPath, scale, parseFlag('row', ''));
}

void main();
