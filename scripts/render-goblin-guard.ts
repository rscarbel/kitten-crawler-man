/**
 * The prison goblins' review harness: the art gates first, then a contact
 * sheet of every row of the patrol guard, the gate guard and the prisoner, an
 * in-game-size strip on the dungeon's floor colours with a pure-black
 * silhouette strip under it, and a line-up beside the plumber and the hostile
 * goblins at in-game size.
 *
 *   npm run render:goblin-guard
 *   npx tsx scripts/render-goblin-guard.ts --scale=8
 */

import { type Canvas, createCanvas } from 'canvas';

import { paintFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { goblinGuardGateFailures } from './gates-goblin-guard.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  GOBLIN_FIGURES,
  GOBLIN_PLUMBER_FIGURE,
  type RowSpec,
} from '../src/sprites/art/goblinFigure.js';
import {
  GOBLIN_GATE_GUARD_FIGURE,
  GOBLIN_GATE_GUARD_ROWS,
  GOBLIN_GUARD_FIGURE,
  GOBLIN_GUARD_ROWS,
  GOBLIN_PRISONER_FIGURE,
  GOBLIN_PRISONER_ROWS,
} from '../src/sprites/art/goblinGuardFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 4;
const MIN_SCALE = 1;
const MAX_SCALE = 16;
/** In-game cells are painted at twice their size and halved, as the cache's supersample does. */
const SUPERSAMPLE = 2;
/** The zoom the in-game strips are shown at so a reviewer can see their pixels. */
const STRIP_ZOOM = 3;
const LINE_UP_ZOOM = 4;
/** Each in-game slot is this many tiles square, with the figure's tile at its foot. */
const SLOT_TILES = 1.75;
const SLOT_FLOOR_MARGIN = 2;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#2a2622';
/** Floor 1 and 2 grounds and a pale stone, for the contrast check. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#6b6259', '#4a4038', '#8a8478', '#3a4a3a'];
const SILHOUETTE_BACKDROP = '#b8b2a8';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
/** Below this alpha a pixel is the soft contact shadow, not the figure. */
const SILHOUETTE_ALPHA_CUTOFF = 40;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const OPAQUE = 255;

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

function silhouetteOf(cell: Canvas): Canvas {
  const shape = createCanvas(cell.width, cell.height);
  const ctx = shape.getContext('2d');
  ctx.drawImage(cell, 0, 0);
  const pixels = ctx.getImageData(0, 0, shape.width, shape.height);
  for (let i = 0; i < pixels.data.length; i += CHANNELS) {
    pixels.data[i] = 0;
    pixels.data[i + 1] = 0;
    pixels.data[i + 2] = 0;
    pixels.data[i + ALPHA_OFFSET] =
      pixels.data[i + ALPHA_OFFSET] > SILHOUETTE_ALPHA_CUTOFF ? OPAQUE : 0;
  }
  ctx.putImageData(pixels, 0, 0);
  return shape;
}

interface SheetEntry {
  readonly def: FigureDef;
  readonly row: RowSpec;
}

const FIGURE_ROWS: ReadonlyArray<readonly [FigureDef, readonly RowSpec[]]> = [
  [GOBLIN_GUARD_FIGURE, GOBLIN_GUARD_ROWS],
  [GOBLIN_GATE_GUARD_FIGURE, GOBLIN_GATE_GUARD_ROWS],
  [GOBLIN_PRISONER_FIGURE, GOBLIN_PRISONER_ROWS],
];

const ENTRIES: readonly SheetEntry[] = FIGURE_ROWS.flatMap(([def, rows]) =>
  rows.map((row) => ({ def, row })),
);

function renderSheet(scale: number): Canvas {
  const maxFrames = Math.max(...ENTRIES.map(({ row }) => row.frameCount));
  const cellW = Math.max(...ENTRIES.map(({ def }) => def.frameWidth)) * scale;
  const rowHeights = ENTRIES.map(({ def }) => def.frameHeight * scale + LABEL_HEIGHT + PADDING);
  const width = PADDING + maxFrames * (cellW + PADDING);
  const height = PADDING + rowHeights.reduce((sum, rowH) => sum + rowH, 0);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  let y = PADDING;
  ENTRIES.forEach(({ def, row }, rowIndex) => {
    label(ctx, `${def.id}.${row.name} — ${row.frameCount} frames`, PADDING, y - PADDING);
    const top = y + LABEL_HEIGHT;
    const swatch = FLOOR_SWATCHES[rowIndex % FLOOR_SWATCHES.length];
    for (let frame = 0; frame < row.frameCount; frame++) {
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
      ctx.drawImage(paintFigureCell(def, row.name, frame, scale), x, top);
    }
    y += rowHeights[rowIndex];
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
  asSilhouette: boolean,
): void {
  const slot = IN_GAME_TILE * SLOT_TILES;
  ctx.fillStyle = swatch;
  ctx.fillRect(x, y, slot, slot);
  const painted = inGameCell(def, state, frame);
  const cell = asSilhouette ? silhouetteOf(painted) : painted;
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

/** Every frame of every row at the in-game tile size, then the same in pure black. */
function renderInGame(): Canvas {
  const slot = IN_GAME_TILE * SLOT_TILES;
  const maxFrames = Math.max(...ENTRIES.map(({ row }) => row.frameCount));
  const small = createCanvas(maxFrames * slot, ENTRIES.length * 2 * slot);
  const ctx = small.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, small.width, small.height);
  for (const asSilhouette of [false, true]) {
    ENTRIES.forEach(({ def, row }, rowIndex) => {
      const band = asSilhouette ? ENTRIES.length + rowIndex : rowIndex;
      const swatch = asSilhouette
        ? SILHOUETTE_BACKDROP
        : FLOOR_SWATCHES[rowIndex % FLOOR_SWATCHES.length];
      for (let frame = 0; frame < row.frameCount; frame++) {
        placeInGame(ctx, def, row.name, frame, frame * slot, band * slot, swatch, asSilhouette);
      }
    });
  }
  return zoom(small, STRIP_ZOOM);
}

/** The prison goblins beside the plumber and the hostile goblins, on every floor colour. */
function renderLineUp(): Canvas {
  const slot = IN_GAME_TILE * SLOT_TILES;
  const figures = [
    GOBLIN_GUARD_FIGURE,
    GOBLIN_GATE_GUARD_FIGURE,
    GOBLIN_PRISONER_FIGURE,
    GOBLIN_PLUMBER_FIGURE,
    GOBLIN_FIGURES.sword,
    GOBLIN_FIGURES.mace,
  ];
  const bands = [...FLOOR_SWATCHES, SILHOUETTE_BACKDROP];
  const small = createCanvas(figures.length * slot, bands.length * slot);
  const ctx = small.getContext('2d');
  bands.forEach((swatch, rowIndex) => {
    const asSilhouette = swatch === SILHOUETTE_BACKDROP;
    figures.forEach((def, i) => {
      placeInGame(ctx, def, 'idle', 0, i * slot, rowIndex * slot, swatch, asSilhouette);
    });
  });
  return zoom(small, LINE_UP_ZOOM);
}

function main(): void {
  console.log('Goblin guard art gates');
  const ok = reportFigureGates('goblin-guard', goblinGuardGateFailures());
  const outputs: ReadonlyArray<readonly [string, Canvas]> = [
    ['goblin-guard-sheet', renderSheet(parseScale())],
    ['goblin-guard-in-game', renderInGame()],
    ['goblin-guard-line-up', renderLineUp()],
  ];
  for (const [name, canvas] of outputs) {
    const path = writePreviewPng(
      parseFlag(`out-${name}`, `${PREVIEW_DIR}/${name}.png`),
      canvas.toBuffer('image/png'),
    );
    console.log(`Wrote ${path}`);
  }
  if (!ok) process.exitCode = 1;
}

main();
