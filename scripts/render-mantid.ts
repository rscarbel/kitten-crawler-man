/**
 * Headless review harness for the Mantid sprite sheets.
 *
 * The browser harness cannot reliably answer "does this look right" from a
 * still, so the art has to be judgeable offline. This slices a baked sheet into
 * a labelled contact sheet: every animation row at review scale, plus a strip of
 * the same frames blitted at the in-game tile size so the silhouette can be
 * checked at the size players actually see.
 *
 *   npx tsx scripts/render-mantid.ts --out=mantid-review.png --scale=1
 *   npx tsx scripts/render-mantid.ts --variant=mantis --out=mantis-review.png
 *   npx tsx scripts/render-mantid.ts --out=mantid-slash.png --row=slash_side --scale=3
 *   npx tsx scripts/render-mantid.ts --out=mantid-gore.png --mode=gore
 *
 * Regenerate the sheets themselves with `npm run gen:mantid`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The row order and frame counts come straight from the generator, so a new row
// cannot desync the only review path this art has.
import {
  GORE_STATES,
  TILE_SCALE,
  bake,
  variantById,
  type RowSpec,
  type SheetGeometry,
} from './generate-mantid-sprite.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
/** What `drawSpriteRotatedCenter` scales a gore piece by in play. */
const GORE_RENDER_SCALE = IN_GAME_TILE / TILE_SCALE;
/** The three sizes a gore piece has to survive, largest first. */
const GORE_REVIEW_SCALES: readonly number[] = [3, 1, GORE_RENDER_SCALE];

const DEFAULT_SCALE = 1;
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

/**
 * Draws the gore row at the three sizes that matter. The bottom strip is the
 * exit criterion: name all eight pieces from it, or the set has failed.
 */
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
  onlyFrame: string,
): void {
  const animationRows = rows.filter((row) => row.kind !== 'gore');
  const shownRows = only === '' ? animationRows : rows.filter((row) => row.name === only);
  if (shownRows.length === 0) throw new Error(`No row named "${only}"`);
  const longestRow = Math.max(...shownRows.map((row) => row.frameCount));
  const firstFrame = onlyFrame === '' ? 0 : parseNumberFlag('frame', 0, 0, longestRow - 1);
  const framesPerRow = (row: RowSpec): number => (onlyFrame === '' ? row.frameCount : 1);

  const cellW = geometry.frameWidth * scale;
  const cellH = geometry.frameHeight * scale;
  const maxCols = Math.max(...shownRows.map(framesPerRow));
  const inGameW = geometry.frameWidth * (IN_GAME_TILE / TILE_SCALE);
  const inGameH = geometry.frameHeight * (IN_GAME_TILE / TILE_SCALE);

  // With --frame the grid is one cell wide, but the in-game strip below it still
  // holds one thumbnail per row, and that is what sets the width.
  const stripWidth = PADDING + shownRows.length * (inGameW + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING +
    shownRows.length * (cellH + LABEL_HEIGHT + PADDING) +
    (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const spec of shownRows) {
    const sheetRow = rows.findIndex((row) => row.name === spec.name);
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
      const x = PADDING + i * (cellW + PADDING);
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
  for (let i = 0; i < shownRows.length; i++) {
    const sheetRow = rows.findIndex((row) => row.name === shownRows[i].name);
    ctx.drawImage(
      sheet,
      firstFrame * geometry.frameWidth,
      sheetRow * geometry.frameHeight,
      geometry.frameWidth,
      geometry.frameHeight,
      PADDING + i * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

async function main(): Promise<void> {
  const variant = variantById(parseFlag('variant', 'mantid'));
  const mode = parseFlag('mode', 'sheet');
  const outPath = parseFlag('out', `${variant.id}-${mode}.png`);
  const sheet = await loadImage(resolve(variant.sheetPath));
  // Re-derives the cell size from the generator rather than the manifest, so the
  // harness still works on a bake whose manifest entry has not been pasted yet.
  const geometry = bake(variant).geometry;

  if (mode === 'gore') {
    renderGorePanel(sheet, variant.rows, geometry, outPath);
    return;
  }
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  renderSheetPanel(
    sheet,
    variant.rows,
    geometry,
    outPath,
    scale,
    parseFlag('row', ''),
    parseFlag('frame', ''),
  );
}

void main();
