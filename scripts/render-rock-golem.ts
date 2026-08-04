/**
 * Headless review harness for the rock-golem sprite sheets.
 *
 * A browser cannot answer "does this read as rock" from a still, so the art has
 * to be judgeable offline. This slices a baked sheet into a labelled contact
 * sheet — every animation row at review scale, plus a strip of the same frames
 * blitted at the in-game tile size, which is the size the silhouette actually
 * has to survive.
 *
 *   npx tsx scripts/render-rock-golem.ts --only=regular --out=golem.png --scale=2
 *   npx tsx scripts/render-rock-golem.ts --only=boss --row=throw_side --scale=5
 *   npx tsx scripts/render-rock-golem.ts --only=boss --mode=gore
 *
 * Regenerate the sheets themselves with `npm run gen:rock-golem`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The row order and frame counts come straight from the generator, so a new row
// cannot desync the only review path this art has.
import {
  GORE_STATES,
  SHEET_PATH,
  TILE_SCALE,
  bake,
  type RowSpec,
} from './generate-rock-golem-sprites.js';
import type { GolemVariant } from './rockGolemArt.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;
/** The three sizes a rubble piece has to survive, largest first. */
const GORE_REVIEW_SCALES: readonly number[] = [4, 1, IN_GAME_SCALE];

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

function parseVariant(): GolemVariant {
  const raw = parseFlag('only', 'regular');
  if (raw !== 'regular' && raw !== 'boss') {
    throw new Error(`--only=${raw} is not "regular" or "boss"`);
  }
  return raw;
}

interface Geometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

/**
 * Draws the rubble row at the three sizes that matter. The bottom strip is the
 * exit criterion: name every piece from it, or the set has failed.
 */
function renderGorePanel(
  sheet: Image,
  geometry: Geometry,
  rows: readonly RowSpec[],
  outPath: string,
): void {
  const goreRow = rows.findIndex((row) => row.kind === 'gore');
  if (goreRow < 0) throw new Error('the generator has no gore row');
  const pieceCount = rows[goreRow].frameCount;

  const width =
    PADDING +
    Math.max(
      ...GORE_REVIEW_SCALES.map((scale) => pieceCount * (geometry.frameWidth * scale + PADDING)),
    );
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

  const biggest = Math.max(...GORE_REVIEW_SCALES);
  let y = PADDING;
  for (const scale of GORE_REVIEW_SCALES) {
    const cellW = geometry.frameWidth * scale;
    const cellH = geometry.frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      scale === IN_GAME_SCALE ? 'at the size it renders in game — name every piece' : `${scale}×`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
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
      if (scale === biggest) {
        ctx.fillStyle = LABEL_COLOR;
        ctx.fillText(GORE_STATES[piece] ?? '?', x, y + cellH + LABEL_HEIGHT - PADDING);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, rubble panel)`);
}

function renderSheetPanel(
  sheet: Image,
  geometry: Geometry,
  allRows: readonly RowSpec[],
  outPath: string,
  scale: number,
  only: string,
): void {
  const animationRows = allRows.filter((row) => row.kind !== 'gore');
  const rows = only === '' ? animationRows : allRows.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);

  const cellW = geometry.frameWidth * scale;
  const cellH = geometry.frameHeight * scale;
  const maxCols = Math.max(...rows.map((row) => row.frameCount));
  const inGameW = geometry.frameWidth * IN_GAME_SCALE;
  const inGameH = geometry.frameHeight * IN_GAME_SCALE;

  const stripWidth = PADDING + rows.length * (inGameW + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING + rows.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const spec of rows) {
    const sheetRow = allRows.findIndex((row) => row.name === spec.name);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${spec.name} — ${spec.frameCount} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let col = 0; col < spec.frameCount; col++) {
      const x = PADDING + col * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        col * geometry.frameWidth,
        sheetRow * geometry.frameHeight,
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
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  rows.forEach((spec, index) => {
    const sheetRow = allRows.findIndex((row) => row.name === spec.name);
    ctx.drawImage(
      sheet,
      0,
      sheetRow * geometry.frameHeight,
      geometry.frameWidth,
      geometry.frameHeight,
      PADDING + index * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  });

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

async function main(): Promise<void> {
  const variant = parseVariant();
  const mode = parseFlag('mode', 'sheet');
  const outPath = parseFlag('out', `rock-golem-${variant}-${mode}.png`);
  const image = await loadImage(resolve(SHEET_PATH[variant]));
  // Re-derives the cell size from the generator rather than the manifest, so the
  // harness still works on a bake whose manifest entry has not been pasted yet.
  const baked = bake(variant);

  if (mode === 'gore') {
    renderGorePanel(image, baked.geometry, baked.rows, outPath);
    return;
  }
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  renderSheetPanel(image, baked.geometry, baked.rows, outPath, scale, parseFlag('row', ''));
}

void main();
