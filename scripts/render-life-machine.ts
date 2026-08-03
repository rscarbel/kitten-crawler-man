/**
 * Headless review harness for the life machine sprite sheet.
 *
 * The machines only ever appear deep inside the floor-2 lab, so the art has to
 * be judgeable offline. This slices the baked sheet into a labelled contact
 * sheet: every row at review scale, then the same frames blitted at the size
 * the game actually draws them (three tiles tall on a 32px tile) with the lamp
 * overlay composited on, because that last strip is the only honest answer to
 * "can a player tell what this machine is doing?"
 *
 *   npx tsx scripts/render-life-machine.ts --out=life-machine.png --scale=2
 *   npx tsx scripts/render-life-machine.ts --row=printing --scale=4
 *
 * Regenerate the sheet itself with `npm run gen:life-machine`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROWS, SHEET_PATH } from './generate-life-machine-sprite.js';
import { FRAME_H, FRAME_W, TILE_SCALE } from './lifeMachineArt.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
/** Matches LIFE_MACHINE_DRAW_HEIGHT in src/systems/SpiderQuestSystem.ts. */
const IN_GAME_DRAW_TILES = 3;
const IN_GAME_H = IN_GAME_TILE * IN_GAME_DRAW_TILES;
const IN_GAME_W = IN_GAME_H * (FRAME_W / FRAME_H);

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#22262a';
const LAB_FLOOR = '#3a3f38';
const GRID_LINE = 'rgba(255,255,255,0.10)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const IN_GAME_STRIP_GAP = 6;

const LAMP_ROW_NAMES: readonly string[] = ['green_lights', 'red_lights'];
const BODY_ROWS = ROWS.filter((row) => !LAMP_ROW_NAMES.includes(row.name));

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

function rowIndexOf(name: string): number {
  const index = ROWS.findIndex((row) => row.name === name);
  if (index < 0) throw new Error(`no such row: ${name}`);
  return index;
}

interface Cell {
  readonly label: string;
  readonly rowIndex: number;
  readonly frameIndex: number;
}

function buildRows(only: string): ReadonlyArray<readonly Cell[]> {
  const rows = only === '' ? ROWS : ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`no such row: ${only}`);
  return rows.map((row) => {
    const rowIndex = rowIndexOf(row.name);
    const cells: Cell[] = [];
    for (let frameIndex = 0; frameIndex < row.frameCount; frameIndex++) {
      cells.push({ label: `${row.name} ${frameIndex}`, rowIndex, frameIndex });
    }
    return cells;
  });
}

/**
 * The strip that decides the art: each body row's mid frame at play size with
 * the lamps lit, on a floor-coloured backdrop.
 */
function drawInGameStrip(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  sheet: Image,
  originX: number,
  originY: number,
): void {
  const lampRowIndex = rowIndexOf('green_lights');
  const offlineRowIndex = rowIndexOf('offline');
  const redRowIndex = rowIndexOf('red_lights');
  const lampFrameCount = ROWS[lampRowIndex].frameCount;

  BODY_ROWS.forEach((row, index) => {
    const rowIndex = rowIndexOf(row.name);
    const frameIndex = Math.floor(row.frameCount / 2);
    const x = originX + index * (IN_GAME_W + IN_GAME_STRIP_GAP);

    ctx.fillStyle = LAB_FLOOR;
    ctx.fillRect(x, originY, IN_GAME_W, IN_GAME_H);
    ctx.drawImage(
      sheet,
      frameIndex * FRAME_W,
      rowIndex * FRAME_H,
      FRAME_W,
      FRAME_H,
      x,
      originY,
      IN_GAME_W,
      IN_GAME_H,
    );

    const lampSource = rowIndex === offlineRowIndex ? redRowIndex : lampRowIndex;
    ctx.drawImage(
      sheet,
      (frameIndex % lampFrameCount) * FRAME_W,
      lampSource * FRAME_H,
      FRAME_W,
      FRAME_H,
      x,
      originY,
      IN_GAME_W,
      IN_GAME_H,
    );

    ctx.strokeStyle = TILE_GUIDE;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      x + (IN_GAME_W - IN_GAME_TILE) / 2 + 0.5,
      originY + IN_GAME_H - IN_GAME_TILE + 0.5,
      IN_GAME_TILE - 1,
      IN_GAME_TILE - 1,
    );

    ctx.fillStyle = LABEL_COLOR;
    ctx.font = LABEL_FONT;
    ctx.fillText(row.name, x, originY + IN_GAME_H + 14);
  });
}

async function main(): Promise<void> {
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');
  const outPath = parseFlag('out', 'life-machine-review.png');

  const sheet = await loadImage(resolve(SHEET_PATH));
  const rows = buildRows(only);

  const cellW = FRAME_W * scale;
  const cellH = FRAME_H * scale;
  const widestRow = rows.reduce((widest, cells) => Math.max(widest, cells.length), 0);
  const gridW = PADDING + widestRow * (cellW + PADDING);
  const stripW = PADDING + BODY_ROWS.length * (IN_GAME_W + IN_GAME_STRIP_GAP) + PADDING;
  const canvasW = Math.max(gridW, stripW);
  const gridH = PADDING + rows.length * (cellH + LABEL_HEIGHT + PADDING);
  const canvasH = gridH + IN_GAME_H + LABEL_HEIGHT + PADDING * 2;

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvasW, canvasH);

  rows.forEach((cells, rowNumber) => {
    const y = PADDING + rowNumber * (cellH + LABEL_HEIGHT + PADDING);
    cells.forEach((cell, columnNumber) => {
      const x = PADDING + columnNumber * (cellW + PADDING);
      ctx.fillStyle = LAB_FLOOR;
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(
        sheet,
        cell.frameIndex * FRAME_W,
        cell.rowIndex * FRAME_H,
        FRAME_W,
        FRAME_H,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + ((FRAME_W - TILE_SCALE) / 2) * scale + 0.5,
        y + (FRAME_H - TILE_SCALE) * scale + 0.5,
        TILE_SCALE * scale - 1,
        TILE_SCALE * scale - 1,
      );
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = LABEL_FONT;
      ctx.fillText(cell.label, x, y + cellH + 15);
    });
  });

  drawInGameStrip(ctx, sheet, PADDING, gridH + PADDING);

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`→ ${outPath} (${canvasW}×${canvasH})`);
}

void main();
