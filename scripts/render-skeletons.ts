#!/usr/bin/env tsx
/**
 * Headless review harness for the three skeleton sprite sheets.
 *
 * A still cannot answer "does this move well", but it is the only thing that can
 * answer "does this read as bones" — and that is the question this art lives or
 * dies on. Every row is sliced out at review scale with the tile guide drawn on
 * it, and the same frames are blitted again at the in-game tile size, because a
 * ribcage that reads beautifully at 4× and turns into a white blob at 32 px has
 * failed.
 *
 *   npx tsx scripts/render-skeletons.ts --only=lord --out=lord.png --scale=2
 *   npx tsx scripts/render-skeletons.ts --only=sword --row=slash_side --scale=5
 *   npx tsx scripts/render-skeletons.ts --only=archer --mode=gore
 *
 * Regenerate the sheets themselves with `npm run gen:skeletons`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Row order, frame counts and cell geometry come straight from the generator, so
// a new row cannot desync the only review path this art has.
import {
  SHEETS,
  TILE_SCALE,
  bakeSheet,
  sheetPathFor,
  type RowSpec,
  type SheetGeometry,
  type SheetSpec,
} from './generate-skeleton-sprites.js';
import { SKELETON_GORE_STATES } from './skeletonGore.js';

/** Matches TILE_SIZE in src/core/constants.ts; the sheets are drawn at 2× that. */
const IN_GAME_TILE = 32;
/** What `drawSpriteRotatedCenter` scales a loose bone by in play. */
const GORE_RENDER_SCALE = IN_GAME_TILE / TILE_SCALE;
/** The three sizes a bone has to survive, largest first. */
const GORE_REVIEW_SCALES: readonly number[] = [4, 1, GORE_RENDER_SCALE];

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

function sheetFor(only: string): SheetSpec {
  const found = SHEETS.find((sheet) => sheet.variant === only || sheet.key === only);
  if (found === undefined) {
    throw new Error(
      `--only=${only} is not one of ${SHEETS.map((sheet) => sheet.variant).join(' | ')}`,
    );
  }
  return found;
}

/**
 * The loose bones at the three sizes that matter. The bottom strip is the exit
 * criterion: name all seven from it, or the set has failed.
 */
function renderGorePanel(
  sheet: Image,
  spec: SheetSpec,
  geometry: SheetGeometry,
  outPath: string,
): void {
  const goreRow = spec.rows.findIndex((row) => row.kind === 'gore');
  if (goreRow < 0) throw new Error(`${spec.key} has no gore row`);
  const pieceCount = spec.rows[goreRow].frameCount;

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
        ? `${spec.key} — at the size it renders in game; name all ${pieceCount} from this row`
        : `${spec.key} — ${scale}×`;
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
        ctx.fillText(SKELETON_GORE_STATES[piece] ?? '?', x, y + cellH + LABEL_HEIGHT - PADDING);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, ${spec.key} bones)`);
}

function renderSheetPanel(
  sheet: Image,
  spec: SheetSpec,
  geometry: SheetGeometry,
  outPath: string,
  scale: number,
  only: string,
  onlyFrame: string,
): void {
  const animationRows = spec.rows.filter((row) => row.kind !== 'gore');
  const rows: readonly RowSpec[] =
    only === '' ? animationRows : spec.rows.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`${spec.key} has no row named "${only}"`);
  const longestRow = Math.max(...rows.map((row) => row.frameCount));
  const firstFrame = onlyFrame === '' ? 0 : parseNumberFlag('frame', 0, 0, longestRow - 1);
  const framesPerRow = (row: RowSpec): number => (onlyFrame === '' ? row.frameCount : 1);

  const cellW = geometry.frameWidth * scale;
  const cellH = geometry.frameHeight * scale;
  const maxCols = Math.max(...rows.map(framesPerRow));
  const inGameW = geometry.frameWidth * (IN_GAME_TILE / TILE_SCALE);
  const inGameH = geometry.frameHeight * (IN_GAME_TILE / TILE_SCALE);

  const stripWidth = PADDING + rows.length * (inGameW + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING +
    LABEL_HEIGHT +
    rows.length * (cellH + LABEL_HEIGHT + PADDING) +
    (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`${spec.key} — ${scale}×`, PADDING, PADDING + LABEL_HEIGHT - PADDING);
  let y = PADDING + LABEL_HEIGHT;

  for (const row of rows) {
    const sheetRow = spec.rows.findIndex((candidate) => candidate.name === row.name);
    ctx.fillStyle = LABEL_COLOR;
    const shown = framesPerRow(row);
    const label =
      onlyFrame === ''
        ? `${row.name} — ${row.frameCount} frames`
        : `${row.name} — frame ${firstFrame} of ${row.frameCount}`;
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
  for (let i = 0; i < rows.length; i++) {
    const sheetRow = spec.rows.findIndex((candidate) => candidate.name === rows[i].name);
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
  const mode = parseFlag('mode', 'sheet');
  const spec = sheetFor(parseFlag('only', 'lord'));
  const outPath = parseFlag('out', `skeleton-${spec.variant}-${mode}.png`);
  const sheet = await loadImage(resolve(sheetPathFor(spec.key)));
  // Re-derives the cell size from the generator rather than the manifest, so the
  // harness still works on a bake whose manifest entry has not been pasted yet.
  const geometry = bakeSheet(spec).geometry;

  if (mode === 'gore') {
    renderGorePanel(sheet, spec, geometry, outPath);
    return;
  }
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  renderSheetPanel(
    sheet,
    spec,
    geometry,
    outPath,
    scale,
    parseFlag('row', ''),
    parseFlag('frame', ''),
  );
}

void main();
