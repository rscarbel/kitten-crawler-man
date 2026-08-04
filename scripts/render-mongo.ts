/**
 * Headless review harness for Mongo's three growth-stage sheets.
 *
 * The browser harness cannot reliably answer "does this read as a velociraptor"
 * from a still, so the art has to be judgeable offline. This bakes in memory —
 * so it works before the manifest has been pasted, and before the gates pass —
 * and lays out every animation row at review scale plus a strip of the same
 * frames blitted at the in-game tile size, which is the size the silhouette
 * actually has to survive.
 *
 *   npx tsx scripts/render-mongo.ts --stage=adult --out=mongo-adult.png --scale=2
 *   npx tsx scripts/render-mongo.ts --stage=adult --row=pounce_side --scale=5
 *   npx tsx scripts/render-mongo.ts --mode=stages --out=mongo-stages.png
 *   npx tsx scripts/render-mongo.ts --stage=adult --mode=onion --row=walk_side
 *
 * Regenerate the sheets themselves with `npm run gen:mongo`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Row order and frame counts come straight from the generator, so a new row
// cannot desync the only review path this art has.
import { ROWS, TILE_SCALE, bake, type SheetGeometry } from './generate-mongo-sprites.js';
import { MONGO_STAGE_ORDER, type MongoStage } from './mongoArt.js';

/** Matches TILE_SIZE in src/core/constants.ts; the sheets are drawn at 2× that. */
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

function parseStage(): MongoStage {
  const raw = parseFlag('stage', 'adult');
  const found = MONGO_STAGE_ORDER.find((stage) => stage === raw);
  if (found === undefined) {
    throw new Error(`--stage=${raw} is not one of ${MONGO_STAGE_ORDER.join(', ')}`);
  }
  return found;
}

interface Sheet {
  readonly image: Image;
  readonly geometry: SheetGeometry;
  readonly stage: MongoStage;
}

async function loadStage(stage: MongoStage): Promise<Sheet> {
  const baked = bake(stage);
  return { image: await loadImage(baked.buffer), geometry: baked.geometry, stage };
}

function blit(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  sheet: Sheet,
  rowIndex: number,
  frame: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.drawImage(
    sheet.image,
    frame * sheet.geometry.frameWidth,
    rowIndex * sheet.geometry.frameHeight,
    sheet.geometry.frameWidth,
    sheet.geometry.frameHeight,
    x,
    y,
    w,
    h,
  );
}

function renderSheetPanel(sheet: Sheet, outPath: string, scale: number, only: string): void {
  const rows = only === '' ? ROWS : ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);

  const cellW = sheet.geometry.frameWidth * scale;
  const cellH = sheet.geometry.frameHeight * scale;
  const maxCols = Math.max(...rows.map((row) => row.frameCount));
  const inGameW = (sheet.geometry.frameWidth * IN_GAME_TILE) / TILE_SCALE;
  const inGameH = (sheet.geometry.frameHeight * IN_GAME_TILE) / TILE_SCALE;

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
    const sheetRow = ROWS.findIndex((row) => row.name === spec.name);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${spec.name} — ${spec.frameCount} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let frame = 0; frame < spec.frameCount; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      blit(ctx, sheet, sheetRow, frame, x, y, cellW, cellH);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + sheet.geometry.tileX * scale,
        y + sheet.geometry.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
      // The declared ground line: every stance foot should sit on it.
      ctx.strokeStyle = GROUND_GUIDE;
      ctx.beginPath();
      const groundY = y + (sheet.geometry.tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE) * scale;
      ctx.moveTo(x, groundY);
      ctx.lineTo(x + cellW, groundY);
      ctx.stroke();
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  for (let i = 0; i < rows.length; i++) {
    const sheetRow = ROWS.findIndex((row) => row.name === rows[i].name);
    blit(ctx, sheet, sheetRow, 0, PADDING + i * (inGameW + PADDING), y, inGameW, inGameH);
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, ${sheet.stage}, ${scale}×)`);
}

/**
 * Where the ground line falls inside the logical tile, matching `GROUND_Y` in
 * `mongoArt.ts` measured from the tile's top edge.
 */
const GROUND_OFFSET_IN_TILE = 0.9;

/**
 * Consecutive frames overlaid at low alpha: a snap or a pop shows as a doubled
 * edge, which is the one thing a side-by-side contact sheet cannot show.
 */
function renderOnionPanel(sheet: Sheet, outPath: string, scale: number, only: string): void {
  const rows = only === '' ? ROWS : ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);

  const cellW = sheet.geometry.frameWidth * scale;
  const cellH = sheet.geometry.frameHeight * scale;
  const canvas = createCanvas(
    Math.ceil(PADDING * 2 + cellW),
    Math.ceil(PADDING + rows.length * (cellH + LABEL_HEIGHT + PADDING)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const spec of rows) {
    const sheetRow = ROWS.findIndex((row) => row.name === spec.name);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${spec.name} — all frames overlaid`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    ctx.save();
    ctx.globalAlpha = ONION_ALPHA;
    for (let frame = 0; frame < spec.frameCount; frame++) {
      blit(ctx, sheet, sheetRow, frame, PADDING, y, cellW, cellH);
    }
    ctx.restore();
    ctx.strokeStyle = GRID_LINE;
    ctx.strokeRect(PADDING, y, cellW, cellH);
    y += cellH + PADDING;
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, onion, ${sheet.stage})`);
}

/**
 * The three stages side by side on one ground line, at review scale and at the
 * in-game tile size. This is the panel the growth read is judged from: juvenile
 * endearing, adult menacing, and all three obviously the same animal.
 */
async function renderStagesPanel(outPath: string, scale: number): Promise<void> {
  const sheets = await Promise.all(MONGO_STAGE_ORDER.map((stage) => loadStage(stage)));
  const compared = ['idle_side', 'walk_side', 'bite_side'] as const;

  const cellWidths = sheets.map((sheet) => sheet.geometry.frameWidth * scale);
  const cellHeights = sheets.map((sheet) => sheet.geometry.frameHeight * scale);
  const rowHeight = Math.max(...cellHeights) + LABEL_HEIGHT + PADDING;
  const width = PADDING + cellWidths.reduce((total, w) => total + w + PADDING, 0);
  const inGameHeight =
    Math.max(...sheets.map((s) => (s.geometry.frameHeight * IN_GAME_TILE) / TILE_SCALE)) +
    LABEL_HEIGHT +
    PADDING;
  const height = PADDING + compared.length * rowHeight + inGameHeight;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const rowName of compared) {
    const sheetRow = ROWS.findIndex((row) => row.name === rowName);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${rowName} — juvenile / adolescent / adult`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    let x = PADDING;
    sheets.forEach((sheet, index) => {
      const cellW = cellWidths[index];
      const cellH = cellHeights[index];
      // Bottom-aligned on one shared baseline, which is what makes the size
      // difference between the stages legible at a glance.
      const top = y + Math.max(...cellHeights) - cellH;
      blit(ctx, sheet, sheetRow, 0, x, top, cellW, cellH);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, top, cellW, cellH);
      x += cellW + PADDING;
    });
    y += Math.max(...cellHeights) + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  let x = PADDING;
  const idleRow = ROWS.findIndex((row) => row.name === 'idle_side');
  for (const sheet of sheets) {
    const w = (sheet.geometry.frameWidth * IN_GAME_TILE) / TILE_SCALE;
    const h = (sheet.geometry.frameHeight * IN_GAME_TILE) / TILE_SCALE;
    blit(ctx, sheet, idleRow, 0, x, y, w, h);
    x += w + PADDING;
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, stage comparison)`);
}

async function main(): Promise<void> {
  const mode = parseFlag('mode', 'sheet');
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const outPath = parseFlag('out', `mongo-${mode}.png`);

  if (mode === 'stages') {
    await renderStagesPanel(outPath, scale);
    return;
  }

  const sheet = await loadStage(parseStage());
  const only = parseFlag('row', '');
  if (mode === 'onion') {
    renderOnionPanel(sheet, outPath, scale, only);
    return;
  }
  renderSheetPanel(sheet, outPath, scale, only);
}

void main();
