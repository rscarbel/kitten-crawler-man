/**
 * The electric goblin's review harness: the art gates first, then a contact
 * sheet of every row, every frame at the in-game tile size on the dungeon's
 * floor colours, and a line-up beside the war band at in-game size.
 *
 *   npm run render:electric-goblin
 *   npx tsx scripts/render-electric-goblin.ts --scale=3
 */

import { type Canvas, createCanvas } from 'canvas';

import { paintFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { electricGoblinGateFailures } from './gates-electric-goblin.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  ELECTRIC_GOBLIN_FIGURE,
  ELECTRIC_GOBLIN_ROW_NAMES,
} from '../src/sprites/art/electricGoblinFigure.js';
import { GOBLIN_FIGURES } from '../src/sprites/art/goblinFigure.js';
import { TILE_SIZE } from '../src/core/constants.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

const DEFAULT_SCALE = 2;
const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** In-game cells are painted at twice their size and halved, as the cache's supersample does. */
const SUPERSAMPLE = 2;
/** The zoom the in-game strips are shown at so a reviewer can see their pixels. */
const STRIP_ZOOM = 2;
const LINE_UP_ZOOM = 3;
/** Each in-game slot is this many tiles wide and tall, with the figure's tile at its foot. */
const SLOT_TILES_WIDE = 4.5;
const SLOT_TILES_TALL = 4;
const LINE_UP_SLOT_TILES = 3;
const SLOT_FLOOR_MARGIN = 2;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#2a2622';
/** Floor 1 and 2 grounds and a pale stone, for the contrast check. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#6b6259', '#4a4038', '#8a8478', '#3a4a3a'];
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

type SheetContext = ReturnType<Canvas['getContext']>;

function parseScale(): number {
  const prefix = '--scale=';
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return DEFAULT_SCALE;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_SCALE || value > MAX_SCALE) {
    throw new Error(`--scale=${raw} is not a number in [${MIN_SCALE}, ${MAX_SCALE}]`);
  }
  return value;
}

function framesOf(def: FigureDef, state: string): number {
  const frames = def.states.get(state)?.frames;
  if (frames === undefined) throw new Error(`${def.id} declares no state "${state}"`);
  return frames;
}

function label(ctx: SheetContext, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.fillText(text, x, y + LABEL_HEIGHT - PADDING);
}

/** One cell at the in-game tile size, painted supersampled and halved as the cache does. */
function inGameCell(def: FigureDef, state: string, frame: number): Canvas {
  const density = (TILE_SIZE / def.tileScale) * SUPERSAMPLE;
  const big = paintFigureCell(def, state, frame, density);
  const small = createCanvas(
    Math.ceil(big.width / SUPERSAMPLE),
    Math.ceil(big.height / SUPERSAMPLE),
  );
  const ctx = small.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(big, 0, 0, small.width, small.height);
  return small;
}

function renderSheet(scale: number, rows: readonly string[]): Canvas {
  const def = ELECTRIC_GOBLIN_FIGURE;
  const maxFrames = Math.max(...rows.map((row) => framesOf(def, row)));
  const cellW = def.frameWidth * scale;
  const rowH = def.frameHeight * scale + LABEL_HEIGHT + PADDING;
  const width = PADDING + maxFrames * (cellW + PADDING);
  const height = PADDING + rows.length * rowH;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  rows.forEach((row, rowIndex) => {
    const y = PADDING + rowIndex * rowH;
    const frames = framesOf(def, row);
    label(ctx, `${row} — ${frames} frames`, PADDING, y - PADDING);
    const top = y + LABEL_HEIGHT;
    const swatch = FLOOR_SWATCHES[rowIndex % FLOOR_SWATCHES.length];
    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = swatch;
      ctx.fillRect(x, top, def.frameWidth * scale, def.frameHeight * scale);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        x + def.tileX * scale,
        top + def.tileY * scale,
        def.tileScale * scale,
        def.tileScale * scale,
      );
      ctx.drawImage(paintFigureCell(def, row, frame, scale), x, top);
    }
  });
  return canvas;
}

function placeInGame(
  ctx: SheetContext,
  def: FigureDef,
  state: string,
  frame: number,
  slot: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  swatch: string,
): void {
  ctx.fillStyle = swatch;
  ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
  const cell = inGameCell(def, state, frame);
  const cellScale = TILE_SIZE / def.tileScale;
  const tileLeft = slot.x + (slot.w - TILE_SIZE) / 2;
  const tileTop = slot.y + slot.h - TILE_SIZE - SLOT_FLOOR_MARGIN;
  ctx.drawImage(cell, tileLeft - def.tileX * cellScale, tileTop - def.tileY * cellScale);
}

function zoom(small: Canvas, factor: number): Canvas {
  const zoomed = createCanvas(small.width * factor, small.height * factor);
  const ctx = zoomed.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, zoomed.width, zoomed.height);
  return zoomed;
}

/** Every frame of every row at the in-game tile size, one floor colour per row. */
function renderInGame(): Canvas {
  const def = ELECTRIC_GOBLIN_FIGURE;
  const w = TILE_SIZE * SLOT_TILES_WIDE;
  const h = TILE_SIZE * SLOT_TILES_TALL;
  const rows = ELECTRIC_GOBLIN_ROW_NAMES;
  const maxFrames = Math.max(...rows.map((row) => framesOf(def, row)));
  const small = createCanvas(maxFrames * w, rows.length * h);
  const ctx = small.getContext('2d');
  rows.forEach((row, rowIndex) => {
    const swatch = FLOOR_SWATCHES[rowIndex % FLOOR_SWATCHES.length];
    for (let frame = 0; frame < framesOf(def, row); frame++) {
      placeInGame(ctx, def, row, frame, { x: frame * w, y: rowIndex * h, w, h }, swatch);
    }
  });
  return zoom(small, STRIP_ZOOM);
}

/** Him beside each of the war band at in-game size, on every floor colour. */
function renderLineUp(): Canvas {
  const slot = TILE_SIZE * LINE_UP_SLOT_TILES;
  const enemies = Object.values(GOBLIN_FIGURES);
  const columns = 1 + enemies.length;
  const small = createCanvas(columns * slot, FLOOR_SWATCHES.length * slot);
  const ctx = small.getContext('2d');
  FLOOR_SWATCHES.forEach((swatch, rowIndex) => {
    const y = rowIndex * slot;
    placeInGame(ctx, ELECTRIC_GOBLIN_FIGURE, 'idle', 0, { x: 0, y, w: slot, h: slot }, swatch);
    enemies.forEach((def, i) => {
      placeInGame(ctx, def, 'idle', 0, { x: (1 + i) * slot, y, w: slot, h: slot }, swatch);
    });
  });
  return zoom(small, LINE_UP_ZOOM);
}

function main(): void {
  console.log('Electric goblin art gates');
  const ok = reportFigureGates('electric-goblin', electricGoblinGateFailures());
  const scale = parseScale();
  const rowsFlag = process.argv.find((arg) => arg.startsWith('--rows='));
  const rows =
    rowsFlag === undefined
      ? ELECTRIC_GOBLIN_ROW_NAMES
      : rowsFlag.slice('--rows='.length).split(',');
  const outputs: ReadonlyArray<readonly [string, Canvas]> = [
    ['electric-goblin-sheet.png', renderSheet(scale, rows)],
    ['electric-goblin-in-game.png', renderInGame()],
    ['electric-goblin-line-up.png', renderLineUp()],
  ];
  for (const [name, canvas] of outputs) {
    console.log(`Wrote ${writePreviewPng(`${PREVIEW_DIR}/${name}`, canvas.toBuffer('image/png'))}`);
  }
  if (!ok) process.exitCode = 1;
}

main();
