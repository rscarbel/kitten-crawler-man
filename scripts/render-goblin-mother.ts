/**
 * The goblin mother's and her toddler's review harness: the art gates first,
 * then a contact sheet of every row, an in-game-size strip on the dungeon's
 * floor colours, and a line-up beside the enemy goblins at in-game size so the
 * two can be told apart at a glance.
 *
 *   npm run render:goblin-mother
 *   npx tsx scripts/render-goblin-mother.ts --scale=8
 */

import { type Canvas, createCanvas } from 'canvas';

import { paintFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { goblinMotherGateFailures } from './gates-goblin-mother.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  GOBLIN_MOTHER_FIGURE,
  GOBLIN_TODDLER_FIGURE,
  MOTHER_ROWS,
  TODDLER_ROWS,
} from '../src/sprites/art/goblinMotherFigure.js';
import { GOBLIN_FIGURES } from '../src/sprites/art/goblinFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 4;
const MIN_SCALE = 1;
const MAX_SCALE = 16;
/** In-game cells are painted at twice their size and halved, as the cache's supersample does. */
const SUPERSAMPLE = 2;
/** The zoom the in-game strips are shown at so a reviewer can see their pixels. */
const STRIP_ZOOM = 2;
const LINE_UP_ZOOM = 4;
/** Each in-game slot is this many tiles square, with the figure's tile at its foot. */
const SLOT_TILES = 1.5;
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

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function parseScale(): number {
  const raw = parseFlag('scale', String(DEFAULT_SCALE));
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

interface Row {
  readonly def: FigureDef;
  readonly state: string;
}

const ROWS: readonly Row[] = [
  ...MOTHER_ROWS.map((state) => ({ def: GOBLIN_MOTHER_FIGURE, state })),
  ...TODDLER_ROWS.map((state) => ({ def: GOBLIN_TODDLER_FIGURE, state })),
];

function label(ctx: SheetContext, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.fillText(text, x, y + LABEL_HEIGHT - PADDING);
}

/** One cell at the in-game tile size, painted supersampled and halved as the cache does. */
function inGameCell(def: FigureDef, state: string, frame: number): Canvas {
  const density = (IN_GAME_TILE / def.tileScale) * SUPERSAMPLE;
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

function renderSheet(scale: number): Canvas {
  const maxFrames = Math.max(...ROWS.map((row) => framesOf(row.def, row.state)));
  const cellW = Math.max(...ROWS.map((row) => row.def.frameWidth)) * scale;
  const rowH = (row: Row): number => row.def.frameHeight * scale + LABEL_HEIGHT + PADDING;
  const width = PADDING + maxFrames * (cellW + PADDING);
  const height = PADDING + ROWS.reduce((sum, row) => sum + rowH(row), 0);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  let y = PADDING;
  ROWS.forEach((row, rowIndex) => {
    const frames = framesOf(row.def, row.state);
    label(ctx, `${row.def.id}.${row.state} — ${frames} frames`, PADDING, y - PADDING);
    const top = y + LABEL_HEIGHT;
    const swatch = FLOOR_SWATCHES[rowIndex % FLOOR_SWATCHES.length];
    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = swatch;
      ctx.fillRect(x, top, row.def.frameWidth * scale, row.def.frameHeight * scale);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        x + row.def.tileX * scale,
        top + row.def.tileY * scale,
        row.def.tileScale * scale,
        row.def.tileScale * scale,
      );
      ctx.drawImage(paintFigureCell(row.def, row.state, frame, scale), x, top);
    }
    y += rowH(row);
  });
  return canvas;
}

/** Where one figure's tile sits in a slot of the in-game strips. */
function placeInGame(
  ctx: SheetContext,
  def: FigureDef,
  state: string,
  frame: number,
  x: number,
  y: number,
  swatch: string,
): void {
  const slot = IN_GAME_TILE * SLOT_TILES;
  ctx.fillStyle = swatch;
  ctx.fillRect(x, y, slot, slot);
  const cell = inGameCell(def, state, frame);
  const cellScale = IN_GAME_TILE / def.tileScale;
  const tileLeft = x + (slot - IN_GAME_TILE) / 2;
  const tileTop = y + slot - IN_GAME_TILE - SLOT_FLOOR_MARGIN;
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
  const slot = IN_GAME_TILE * SLOT_TILES;
  const maxFrames = Math.max(...ROWS.map((row) => framesOf(row.def, row.state)));
  const small = createCanvas(maxFrames * slot, ROWS.length * slot);
  const ctx = small.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, small.width, small.height);
  ROWS.forEach((row, rowIndex) => {
    const swatch = FLOOR_SWATCHES[rowIndex % FLOOR_SWATCHES.length];
    const frames = framesOf(row.def, row.state);
    for (let frame = 0; frame < frames; frame++) {
      placeInGame(ctx, row.def, row.state, frame, frame * slot, rowIndex * slot, swatch);
    }
  });
  return zoom(small, STRIP_ZOOM);
}

/** The mother, her toddler and each enemy archetype side by side on every floor colour. */
function renderLineUp(): Canvas {
  const slot = IN_GAME_TILE * SLOT_TILES;
  const enemies = Object.values(GOBLIN_FIGURES);
  const columns = 2 + enemies.length;
  const small = createCanvas(columns * slot, FLOOR_SWATCHES.length * slot);
  const ctx = small.getContext('2d');
  FLOOR_SWATCHES.forEach((swatch, rowIndex) => {
    const y = rowIndex * slot;
    placeInGame(ctx, GOBLIN_MOTHER_FIGURE, 'idle', 0, 0, y, swatch);
    placeInGame(ctx, GOBLIN_TODDLER_FIGURE, 'idle', 0, slot, y, swatch);
    enemies.forEach((def, i) => {
      placeInGame(ctx, def, 'idle', 0, (2 + i) * slot, y, swatch);
    });
  });
  return zoom(small, LINE_UP_ZOOM);
}

function main(): void {
  console.log('Goblin mother art gates');
  const ok = reportFigureGates('goblin-mother', goblinMotherGateFailures());
  const scale = parseScale();
  const sheetPath = writePreviewPng(
    `${PREVIEW_DIR}/goblin-mother-sheet.png`,
    renderSheet(scale).toBuffer('image/png'),
  );
  console.log(`Wrote ${sheetPath}`);
  const stripPath = writePreviewPng(
    `${PREVIEW_DIR}/goblin-mother-in-game.png`,
    renderInGame().toBuffer('image/png'),
  );
  console.log(`Wrote ${stripPath}`);
  const lineUpPath = writePreviewPng(
    `${PREVIEW_DIR}/goblin-mother-line-up.png`,
    renderLineUp().toBuffer('image/png'),
  );
  console.log(`Wrote ${lineUpPath}`);
  if (!ok) process.exitCode = 1;
}

main();
