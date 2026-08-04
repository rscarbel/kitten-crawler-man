/**
 * Headless review harness for the Brindle Grub sprite sheets.
 *
 *   npx tsx scripts/render-grub.ts --out=grub-review.png
 *   npx tsx scripts/render-grub.ts --variant=cow_tailed_grub --out=cow-review.png
 *   npx tsx scripts/render-grub.ts --out=bite.png --row=attack_side --scale=4
 *
 * Regenerate the sheets themselves with `npm run gen:grub`.
 */

import { createCanvas, loadImage } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  bake,
  variantById,
  type RowSpec,
  type SheetGeometry,
} from './generate-brindle-grub-sprite.js';

const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 4;
const MIN_SCALE = 0.25;
const MAX_SCALE = 12;
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

function parseNumberFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

async function main(): Promise<void> {
  const variant = variantById(parseFlag('variant', 'brindle_grub'));
  const outPath = parseFlag('out', `${variant.id}-review.png`);
  const sheet = await loadImage(resolve(variant.sheetPath));
  const geometry: SheetGeometry = bake(variant).geometry;
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');

  const rows: readonly RowSpec[] = variant.rows;
  const shownRows = only === '' ? rows : rows.filter((row) => row.name === only);
  if (shownRows.length === 0) throw new Error(`No row named "${only}"`);
  const maxCols = Math.max(...shownRows.map((row) => row.frameCount));

  const cellW = geometry.frameWidth * scale;
  const cellH = geometry.frameHeight * scale;
  const inGameScale = IN_GAME_TILE / 64; // TILE_SCALE the art is drawn at
  const inGW = geometry.frameWidth * inGameScale;
  const inGH = geometry.frameHeight * inGameScale;

  const width = PADDING + maxCols * (cellW + PADDING);
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
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + geometry.tileX * scale,
        y + geometry.tileY * scale,
        64 * scale,
        64 * scale,
      );
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

void main();
