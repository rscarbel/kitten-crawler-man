/**
 * Mongo's review harness. Art has to be judged as an image, by something that
 * only looks at the image — the browser cannot reliably answer "does this read
 * as a velociraptor" from a still, and every defect that has ever mattered on a
 * figure in this project was invisible to `typecheck`, `lint` and a code read.
 *
 * The contact sheet is painted from the three growth-stage figures the way the
 * runtime cache bakes them, and the art gates run as part of the render, so one
 * command answers both "does it still hold together" and "what does it look
 * like".
 *
 *   npm run render:mongo
 *   npx tsx scripts/render-mongo.ts --stage=adult --scale=2
 *   npx tsx scripts/render-mongo.ts --stage=adult --row=pounce_side --scale=5
 *   npx tsx scripts/render-mongo.ts --mode=stages
 *   npx tsx scripts/render-mongo.ts --stage=adult --mode=onion --row=walk_side
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureSheet, type FigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { mongoGateFailures } from './gates-mongo.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
// The row order and frame counts come straight from the figure, so a new row
// cannot desync the only review path this art has.
import { MONGO_FIGURES, MONGO_ROWS, TILE_SCALE } from '../src/sprites/art/mongoFigure.js';
import { GROUND_Y, MONGO_STAGE_ORDER, type MongoStage } from '../src/sprites/art/mongoArt.js';

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
const GROUND_GUIDE = 'rgba(255,200,120,0.4)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const ONION_ALPHA = 0.34;

/** Where the ground line falls inside the logical tile, measured from its top. */
const GROUND_OFFSET_IN_TILE = 0.5 + GROUND_Y;

type Mode = 'sheet' | 'onion' | 'stages';
const MODES: ReadonlyArray<Mode> = ['sheet', 'onion', 'stages'];

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

function parseMode(): Mode {
  const raw = parseFlag('mode', 'sheet');
  const found = MODES.find((mode) => mode === raw);
  if (found === undefined) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
  return found;
}

function parseStage(): MongoStage {
  const raw = parseFlag('stage', 'adult');
  const found = MONGO_STAGE_ORDER.find((stage) => stage === raw);
  if (found === undefined) {
    throw new Error(`--stage=${raw} is not one of ${MONGO_STAGE_ORDER.join(', ')}`);
  }
  return found;
}

function rowsFiltered(only: string): typeof MONGO_ROWS {
  const rows = only === '' ? MONGO_ROWS : MONGO_ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);
  return rows;
}

type SheetContext = ReturnType<Canvas['getContext']>;

function blit(
  ctx: SheetContext,
  baked: FigureSheet,
  rowIndex: number,
  frame: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.drawImage(
    baked.canvas,
    frame * baked.frameWidth,
    rowIndex * baked.frameHeight,
    baked.frameWidth,
    baked.frameHeight,
    x,
    y,
    w,
    h,
  );
}

function renderSheetPanel(
  def: FigureDef,
  stage: MongoStage,
  outPath: string,
  scale: number,
  only: string,
): void {
  const rows = rowsFiltered(only);
  const baked = bakeFigureSheet(
    def,
    rows.map((row) => row.name),
  );

  const cellW = baked.frameWidth * scale;
  const cellH = baked.frameHeight * scale;
  const maxCols = Math.max(...rows.map((row) => row.frameCount));
  const inGameW = (baked.frameWidth * IN_GAME_TILE) / TILE_SCALE;
  const inGameH = (baked.frameHeight * IN_GAME_TILE) / TILE_SCALE;

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
  rows.forEach((spec, sheetRow) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${spec.name} — ${spec.frameCount} frames, ${spec.view}, ${spec.kind}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    for (let frame = 0; frame < spec.frameCount; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      blit(ctx, baked, sheetRow, frame, x, y, cellW, cellH);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + def.tileX * scale,
        y + def.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
      // The declared ground line: every stance foot should sit on it.
      ctx.strokeStyle = GROUND_GUIDE;
      ctx.beginPath();
      const groundY = y + (def.tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE) * scale;
      ctx.moveTo(x, groundY);
      ctx.lineTo(x + cellW, groundY);
      ctx.stroke();
    }
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  rows.forEach((_spec, sheetRow) => {
    blit(ctx, baked, sheetRow, 0, PADDING + sheetRow * (inGameW + PADDING), y, inGameW, inGameH);
  });

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, ${stage}, ${scale}×)`);
}

/**
 * Consecutive frames overlaid at low alpha: a snap or a pop shows as a doubled
 * edge, which is the one thing a side-by-side contact sheet cannot show.
 */
function renderOnionPanel(
  def: FigureDef,
  stage: MongoStage,
  outPath: string,
  scale: number,
  only: string,
): void {
  const rows = rowsFiltered(only);
  const baked = bakeFigureSheet(
    def,
    rows.map((row) => row.name),
  );

  const cellW = baked.frameWidth * scale;
  const cellH = baked.frameHeight * scale;
  const canvas = createCanvas(
    Math.ceil(PADDING * 2 + cellW),
    Math.ceil(PADDING + rows.length * (cellH + LABEL_HEIGHT + PADDING)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  rows.forEach((spec, sheetRow) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${spec.name} — all frames overlaid`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    ctx.save();
    ctx.globalAlpha = ONION_ALPHA;
    for (let frame = 0; frame < spec.frameCount; frame++) {
      blit(ctx, baked, sheetRow, frame, PADDING, y, cellW, cellH);
    }
    ctx.restore();
    ctx.strokeStyle = GRID_LINE;
    ctx.strokeRect(PADDING, y, cellW, cellH);
    y += cellH + PADDING;
  });

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, onion, ${stage})`);
}

/**
 * The three stages side by side on one ground line, at review scale and at the
 * in-game tile size. This is the panel the growth read is judged from: juvenile
 * endearing, adult menacing, and all three obviously the same animal.
 */
const COMPARED_ROWS: readonly string[] = ['idle_side', 'walk_side', 'bite_side'];

function renderStagesPanel(outPath: string, scale: number): void {
  const baked = MONGO_STAGE_ORDER.map((stage) =>
    bakeFigureSheet(MONGO_FIGURES[stage], [...COMPARED_ROWS]),
  );

  const cellWidths = baked.map((sheet) => sheet.frameWidth * scale);
  const cellHeights = baked.map((sheet) => sheet.frameHeight * scale);
  const tallestCell = Math.max(...cellHeights);
  const rowHeight = tallestCell + LABEL_HEIGHT + PADDING;
  const width = PADDING + cellWidths.reduce((total, w) => total + w + PADDING, 0);
  const inGameHeight =
    Math.max(...baked.map((sheet) => (sheet.frameHeight * IN_GAME_TILE) / TILE_SCALE)) +
    LABEL_HEIGHT +
    PADDING;
  const height = PADDING + COMPARED_ROWS.length * rowHeight + inGameHeight;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  COMPARED_ROWS.forEach((rowName, sheetRow) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${rowName} — juvenile / adolescent / adult`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    let x = PADDING;
    baked.forEach((sheet, index) => {
      const cellW = cellWidths[index];
      const cellH = cellHeights[index];
      // Bottom-aligned on one shared baseline, which is what makes the size
      // difference between the stages legible at a glance.
      const top = y + tallestCell - cellH;
      blit(ctx, sheet, sheetRow, 0, x, top, cellW, cellH);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, top, cellW, cellH);
      x += cellW + PADDING;
    });
    y += tallestCell + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  let x = PADDING;
  const idleRow = COMPARED_ROWS.indexOf('idle_side');
  for (const sheet of baked) {
    const w = (sheet.frameWidth * IN_GAME_TILE) / TILE_SCALE;
    const h = (sheet.frameHeight * IN_GAME_TILE) / TILE_SCALE;
    blit(ctx, sheet, idleRow, 0, x, y, w, h);
    x += w + PADDING;
  }

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, stage comparison)`);
}

function main(): void {
  const mode = parseMode();
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const outPath = parseFlag('out', `${PREVIEW_DIR}/mongo-${mode}.png`);

  // Ahead of the contact sheet rather than after it. A contact sheet is a
  // tens-of-megapixel allocation, and measuring the art on the far side of one
  // has made a centroid gate report a seam at twice its true width — a red gate
  // on art nobody touched is the one thing that teaches an agent to loosen a
  // threshold.
  console.log('Gating the mongo figures…');
  reportFigureGates('mongo', mongoGateFailures());

  if (mode === 'stages') {
    renderStagesPanel(outPath, scale);
    return;
  }

  const stage = parseStage();
  const def = MONGO_FIGURES[stage];
  const only = parseFlag('row', '');
  if (mode === 'onion') {
    renderOnionPanel(def, stage, outPath, scale, only);
    return;
  }
  renderSheetPanel(def, stage, outPath, scale, only);
}

main();
