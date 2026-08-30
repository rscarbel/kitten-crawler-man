/**
 * Headless review harness for the rat.
 *
 * The browser harness cannot reliably answer "does this look right" from a
 * still, so the art has to be judgeable offline. This paints every animation row
 * from `RAT_FIGURE` the way the runtime cache bakes it and lays it out as a
 * labelled contact sheet, plus a strip of the same frames blitted at the in-game
 * tile size so the silhouette can be checked at the size players actually see.
 * The art gates run first, before the sheet is allocated.
 *
 *   npm run render:rat
 *   npx tsx scripts/render-rat.ts --row=bite_side --scale=5
 *   npx tsx scripts/render-rat.ts --mode=gore
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { ratGateFailures } from './gates-rat.js';
import { GORE_STATES, RAT_FIGURE, ROWS, TILE_SCALE } from '../src/sprites/art/ratFigure.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;
/** What `drawArtSourceRotatedCenter` scales a gore piece by in play. */
const GORE_RENDER_SCALE = IN_GAME_TILE / TILE_SCALE;

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

/** The three sizes a gore piece has to survive, largest first. */
const GORE_INSPECT_SCALE = 4;
const GORE_SHEET_SCALE = 1;
const GORE_REVIEW_SCALES: readonly number[] = [
  GORE_INSPECT_SCALE,
  GORE_SHEET_SCALE,
  GORE_RENDER_SCALE,
];

const { frameWidth, frameHeight, tileX, tileY } = RAT_FIGURE;

/** Every row of the contact sheet: the pose rows, then one row per gore piece. */
const POSE_STATES: readonly string[] = ROWS.map((row) => row.name);
const SHEET_STATES: readonly string[] = [...POSE_STATES, ...GORE_STATES];
const SHEET_ROW_OF: ReadonlyMap<string, number> = new Map(
  SHEET_STATES.map((state, index) => [state, index]),
);

function sheetRowOf(state: string): number {
  const index = SHEET_ROW_OF.get(state);
  if (index === undefined) throw new Error(`the rat paints no state "${state}"`);
  return index;
}

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
 * Draws the gore pieces at the three sizes that matter. The bottom strip is the
 * exit criterion: name all eight pieces from it, or the set has failed.
 */
function renderGorePanel(sheet: Canvas, outPath: string): void {
  const pieceCount = GORE_STATES.length;
  const widths = GORE_REVIEW_SCALES.map((scale) => frameWidth * scale);
  const width = PADDING + Math.max(...widths.map((w) => pieceCount * (w + PADDING)));
  const height =
    PADDING +
    GORE_REVIEW_SCALES.reduce(
      (total, scale) => total + frameHeight * scale + LABEL_HEIGHT + PADDING,
      0,
    );

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const scale of GORE_REVIEW_SCALES) {
    const cellW = frameWidth * scale;
    const cellH = frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    const caption =
      scale === GORE_RENDER_SCALE
        ? 'at the size it renders in game — name all eight from this row'
        : `${scale}×`;
    ctx.fillText(caption, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    GORE_STATES.forEach((state, piece) => {
      const x = PADDING + piece * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        0,
        sheetRowOf(state) * frameHeight,
        frameWidth,
        frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      if (scale === Math.max(...GORE_REVIEW_SCALES)) {
        ctx.fillStyle = LABEL_COLOR;
        ctx.fillText(state, x, y + cellH + LABEL_HEIGHT - PADDING);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    });
    y += cellH + PADDING;
  }

  const written = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${written} (${canvas.width}×${canvas.height}px, gore panel)`);
}

function renderSheetPanel(
  sheet: Canvas,
  outPath: string,
  scale: number,
  only: string,
  onlyFrame: string,
): void {
  const rows = only === '' ? ROWS : ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);
  const longestRow = Math.max(...rows.map((row) => row.frameCount));
  const firstFrame = onlyFrame === '' ? 0 : parseNumberFlag('frame', 0, 0, longestRow - 1);
  const framesPerRow = (row: (typeof ROWS)[number]): number =>
    onlyFrame === '' ? row.frameCount : 1;

  const cellW = frameWidth * scale;
  const cellH = frameHeight * scale;
  const maxCols = Math.max(...rows.map(framesPerRow));
  const inGameW = frameWidth * (IN_GAME_TILE / TILE_SCALE);
  const inGameH = frameHeight * (IN_GAME_TILE / TILE_SCALE);

  // With --frame the grid is one cell wide, but the in-game strip below it still
  // holds one thumbnail per row, and that is what sets the width.
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
    const row = sheetRowOf(spec.name);
    ctx.fillStyle = LABEL_COLOR;
    const shown = framesPerRow(spec);
    const label =
      onlyFrame === ''
        ? `${spec.name} — ${spec.frameCount} frames, ${spec.view}, ${spec.kind}`
        : `${spec.name} — frame ${firstFrame} of ${spec.frameCount}`;
    ctx.fillText(label, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let i = 0; i < shown; i++) {
      const col = firstFrame + i;
      const x = PADDING + i * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        col * frameWidth,
        row * frameHeight,
        frameWidth,
        frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(x + tileX * scale, y + tileY * scale, TILE_SCALE * scale, TILE_SCALE * scale);
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  rows.forEach((spec, i) => {
    ctx.drawImage(
      sheet,
      firstFrame * frameWidth,
      sheetRowOf(spec.name) * frameHeight,
      frameWidth,
      frameHeight,
      PADDING + i * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  });

  const written = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${written} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

function main(): void {
  const mode = parseFlag('mode', 'sheet');
  const outPath = parseFlag('out', `${PREVIEW_DIR}/rat-${mode}.png`);

  // Ahead of the contact sheet rather than after it. The sheet is a
  // many-megapixel allocation, and measuring art on the other side of one is
  // what made a sibling figure's centroid gate report a seam at twice its true
  // width every so often — a red gate on art nobody touched, which is the one
  // thing that teaches an agent to loosen a threshold.
  console.log('Gating the rat figure…');
  reportFigureGates('rat', ratGateFailures());

  const sheet = bakeFigureSheet(RAT_FIGURE, [...SHEET_STATES]).canvas;

  if (mode === 'gore') {
    renderGorePanel(sheet, outPath);
    return;
  }
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  renderSheetPanel(sheet, outPath, scale, parseFlag('row', ''), parseFlag('frame', ''));
}

main();
