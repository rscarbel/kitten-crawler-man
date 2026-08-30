/**
 * Headless review harness for the life machines — the floor-2 spider lab's
 * egg-sac bio-printers.
 *
 * The machines only ever appear deep inside the lab, so the art has to be
 * judgeable offline. Every row is painted from `LIFE_MACHINE_FIGURE` the way
 * the runtime cache bakes it, then the same frames are blitted at the size the
 * game actually draws them (three tiles tall on a 32px tile) with the lamp
 * overlay composited on, because that last strip is the only honest answer to
 * "can a player tell what this machine is doing?". The art gates run first.
 *
 *   npm run render:life-machine
 *   npx tsx scripts/render-life-machine.ts --row=printing --scale=4
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { lifeMachineGateFailures } from './gates-spider.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  LIFE_MACHINE_FIGURE,
  LIFE_MACHINE_ROWS,
  lifeMachineStateName,
} from '../src/sprites/art/lifeMachineFigure.js';

const FRAME_W = LIFE_MACHINE_FIGURE.frameWidth;
const FRAME_H = LIFE_MACHINE_FIGURE.frameHeight;
const TILE_SCALE = LIFE_MACHINE_FIGURE.tileScale;

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
/** The figure is three tiles tall by construction, and drawn at its own scale. */
const IN_GAME_H = FRAME_H * (IN_GAME_TILE / TILE_SCALE);
const IN_GAME_W = FRAME_W * (IN_GAME_TILE / TILE_SCALE);

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
const IN_GAME_LABEL_BASELINE = 14;

const LAMP_ROW_NAMES: readonly string[] = ['green_lights', 'red_lights'];
const BODY_ROWS = LIFE_MACHINE_ROWS.filter((row) => !LAMP_ROW_NAMES.includes(row.name));

/** Every row, in declaration order, as one baked contact sheet. */
const SHEET_STATES = LIFE_MACHINE_ROWS.map((row) => lifeMachineStateName(row.name));

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
  const index = LIFE_MACHINE_ROWS.findIndex((row) => row.name === name);
  if (index < 0) throw new Error(`no such row: ${name}`);
  return index;
}

interface Cell {
  readonly label: string;
  readonly rowIndex: number;
  readonly frameIndex: number;
}

function buildRows(only: string): ReadonlyArray<readonly Cell[]> {
  const rows = only === '' ? LIFE_MACHINE_ROWS : LIFE_MACHINE_ROWS.filter((r) => r.name === only);
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
  ctx: ReturnType<Canvas['getContext']>,
  sheet: Canvas,
  originX: number,
  originY: number,
): void {
  const lampRowIndex = rowIndexOf('green_lights');
  const offlineRowIndex = rowIndexOf('offline');
  const redRowIndex = rowIndexOf('red_lights');
  const lampFrameCount = LIFE_MACHINE_ROWS[lampRowIndex].frameCount;

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

    // A shut-down machine is the only one that shows red, so it is the one the
    // red row is composited onto here.
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
    ctx.fillText(row.name, x, originY + IN_GAME_H + IN_GAME_LABEL_BASELINE);
  });
}

function main(): void {
  // Ahead of the contact sheet rather than after it: a sheet is a
  // multi-megapixel allocation, and measuring art on the far side of one is how
  // a gate goes red on art nobody touched.
  console.log('Gating the life machine…');
  reportFigureGates('life machine', lifeMachineGateFailures());

  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');
  const outPath = parseFlag('out', `${PREVIEW_DIR}/life-machine-review.png`);

  const sheet = bakeFigureSheet(LIFE_MACHINE_FIGURE, SHEET_STATES).canvas;
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
        x + LIFE_MACHINE_FIGURE.tileX * scale + 0.5,
        y + LIFE_MACHINE_FIGURE.tileY * scale + 0.5,
        TILE_SCALE * scale - 1,
        TILE_SCALE * scale - 1,
      );
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = LABEL_FONT;
      ctx.fillText(cell.label, x, y + cellH + LABEL_HEIGHT - PADDING + 1);
    });
  });

  drawInGameStrip(ctx, sheet, PADDING, gridH + PADDING);

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`→ ${outPath} (${canvasW}×${canvasH})`);
}

main();
