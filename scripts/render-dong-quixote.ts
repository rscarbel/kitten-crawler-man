/**
 * Dong Quixote's review harness.
 *
 * Art has to be judged as an image: every defect that has mattered on a
 * figure in this project was invisible to typecheck, lint and a read of the
 * drawing code. The gates run first, then the contact sheet is baked from the
 * figure exactly the way the runtime cache bakes it.
 *
 *   npm run render:dong-quixote
 *   npx tsx scripts/render-dong-quixote.ts --row=idle,idle_side --scale=4
 *   npx tsx scripts/render-dong-quixote.ts --mode=strip32
 *   npx tsx scripts/render-dong-quixote.ts --mode=onion --row=walk_side --scale=3
 *   npx tsx scripts/render-dong-quixote.ts --part=head --row=idle --scale=8
 *   npx tsx scripts/render-dong-quixote.ts --skip-gates
 *   npx tsx scripts/render-dong-quixote.ts --mode=strip32 --no-labels --zoom=2
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell, frameCountOf } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { dongQuixoteGateFailures } from './gates-dong-quixote.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  DONG_ACTIONS,
  DONG_QUIXOTE_FIGURE,
  DONG_VIEWS,
  FRAME_H,
  FRAME_W,
  ORIGIN_X,
  ORIGIN_Y,
  TILE_SCALE,
  dongStateName,
} from '../src/sprites/art/dongQuixoteFigure.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;
/** The strip is repeated at this nearest-neighbour zoom underneath, so a reviewer can count its pixels. */
const DEFAULT_STRIP_ZOOM = 4;
const MAX_STRIP_ZOOM = 8;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 12;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
/** The grounds he actually stands on: the club's floor, a dungeon floor, grass, flagstone. */
const FLOOR_SWATCHES: readonly string[] = ['#3b3b40', '#4a3a44', '#637032', '#8c8170'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
/** Onion frames are overlaid at this opacity each. */
const ONION_ALPHA = 0.35;

type Mode = 'sheet' | 'strip32' | 'onion';
const MODES: readonly Mode[] = ['sheet', 'strip32', 'onion'];

/** Crop windows as fractions of the cell, so they survive a change of cell size. */
interface CropWindow {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
/**
 * A window around his origin in tiles — across from `left` to `right`, and
 * from `low` to `high` above the floor — as fractions of the cell, so a crop
 * keeps framing the same part of him whatever size the cell is cut to.
 */
interface TileSpan {
  readonly left: number;
  readonly right: number;
  readonly low: number;
  readonly high: number;
}

function tileWindow({ left, right, low, high }: TileSpan): CropWindow {
  const x0 = ORIGIN_X + left * TILE_SCALE;
  const y0 = ORIGIN_Y - high * TILE_SCALE;
  return {
    left: x0 / FRAME_W,
    top: y0 / FRAME_H,
    width: ((right - left) * TILE_SCALE) / FRAME_W,
    height: ((high - low) * TILE_SCALE) / FRAME_H,
  };
}

const PARTS: ReadonlyMap<string, CropWindow> = new Map([
  ['body', tileWindow({ left: -0.9, right: 1.1, low: -0.2, high: 2.2 })],
  ['wide', { left: 0, top: 0, width: 1, height: 1 }],
  ['head', tileWindow({ left: -0.45, right: 0.45, low: 1.3, high: 2.1 })],
  ['torso', tileWindow({ left: -0.6, right: 0.6, low: 0.75, high: 1.6 })],
  ['legs', tileWindow({ left: -0.6, right: 0.6, low: -0.1, high: 0.95 })],
]);

/** The in-game strip shows the whole cell: it is already cut to his widest poses. */
const STRIP_WINDOW: CropWindow = { left: 0, top: 0, width: 1, height: 1 };

type SheetContext = ReturnType<Canvas['getContext']>;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

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

function newPanel(width: number, height: number): { canvas: Canvas; ctx: SheetContext } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  return { canvas, ctx };
}

function allStates(): string[] {
  return DONG_ACTIONS.flatMap((action) => DONG_VIEWS.map((view) => dongStateName(action, view)));
}

function selectedStates(): string[] {
  const only = parseFlag('row', '');
  if (only === '') return allStates();
  const wanted = only.split(',');
  const states = allStates().filter((state) => wanted.includes(state));
  if (states.length === 0) throw new Error(`No row named "${only}"`);
  return states;
}

/** The frames to show, from `--frames=0,4`; every frame when absent. */
function framesOf(state: string): number[] {
  const all = Array.from({ length: frameCountOf(DONG_QUIXOTE_FIGURE, state) }, (_unused, i) => i);
  const raw = parseFlag('frames', '');
  if (raw === '') return all;
  const wanted = raw.split(',').map(Number);
  return all.filter((frame) => wanted.includes(frame));
}

function cropOf(): CropWindow {
  const name = parseFlag('part', '');
  if (name === '') return { left: 0, top: 0, width: 1, height: 1 };
  const crop = PARTS.get(name);
  if (crop === undefined)
    throw new Error(`--part=${name} is not one of ${[...PARTS.keys()].join(', ')}`);
  return crop;
}

/** A labelled grid of rows at review scale, each cell on its own floor swatch. */
function renderSheet(states: readonly string[], outPath: string, scale: number): void {
  const def = DONG_QUIXOTE_FIGURE;
  const crop = cropOf();
  const srcX = crop.left * def.frameWidth;
  const srcY = crop.top * def.frameHeight;
  const srcW = crop.width * def.frameWidth;
  const srcH = crop.height * def.frameHeight;
  const cellW = srcW * scale;
  const cellH = srcH * scale;
  const maxCols = Math.max(...states.map((state) => framesOf(state).length));
  const { canvas, ctx } = newPanel(
    PADDING + maxCols * (cellW + PADDING),
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING),
  );
  let y = PADDING;
  states.forEach((state, index) => {
    const frames = framesOf(state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${state} — frames ${frames.join(',')}`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    frames.forEach((frame, column) => {
      const x = PADDING + column * (cellW + PADDING);
      ctx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(bakeFigureCell(def, state, frame), srcX, srcY, srcW, srcH, x, y, cellW, cellH);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (crop.width === 1) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + def.tileX * scale,
          y + def.tileY * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
    });
    y += cellH + PADDING;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

/**
 * Every frame of every row at the size the game blits it, on the floors he
 * stands on, with a nearest-neighbour zoom of the same pixels under it. This
 * is where a silhouette that reads at review scale and dissolves in game gets
 * caught.
 */
function renderStrip32(states: readonly string[], outPath: string): void {
  const def = DONG_QUIXOTE_FIGURE;
  const STRIP_ZOOM = parseNumberFlag('zoom', DEFAULT_STRIP_ZOOM, 1, MAX_STRIP_ZOOM);
  const crop = parseFlag('part', '') === '' ? STRIP_WINDOW : cropOf();
  const fullW = Math.ceil(def.frameWidth * IN_GAME_SCALE);
  const fullH = Math.ceil(def.frameHeight * IN_GAME_SCALE);
  const srcX = Math.floor(crop.left * fullW);
  const srcY = Math.floor(crop.top * fullH);
  const cellW = Math.ceil(crop.width * fullW);
  const cellH = Math.ceil(crop.height * fullH);
  const maxCols = Math.max(...states.map((state) => framesOf(state).length));
  const rowH = LABEL_HEIGHT + cellH + cellH * STRIP_ZOOM + PADDING * 2;
  const { canvas, ctx } = newPanel(
    PADDING + maxCols * (cellW * STRIP_ZOOM + PADDING),
    PADDING + states.length * rowH,
  );
  let y = PADDING;
  states.forEach((state, index) => {
    ctx.fillStyle = LABEL_COLOR;
    // A blind reviewer is asked to name each action, so the names can be left off.
    if (!process.argv.includes('--no-labels'))
      ctx.fillText(state, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    const small = createCanvas(fullW, fullH);
    const smallCtx = small.getContext('2d');
    framesOf(state).forEach((frame, column) => {
      smallCtx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
      smallCtx.fillRect(0, 0, fullW, fullH);
      smallCtx.drawImage(
        bakeFigureCell(def, state, frame),
        0,
        0,
        def.frameWidth,
        def.frameHeight,
        0,
        0,
        fullW,
        fullH,
      );
      const x = PADDING + column * (cellW * STRIP_ZOOM + PADDING);
      ctx.drawImage(small, srcX, srcY, cellW, cellH, x, y, cellW, cellH);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        small,
        srcX,
        srcY,
        cellW,
        cellH,
        x,
        y + cellH + PADDING,
        cellW * STRIP_ZOOM,
        cellH * STRIP_ZOOM,
      );
      ctx.imageSmoothingEnabled = true;
    });
    y += cellH + cellH * STRIP_ZOOM + PADDING * 2;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, in-game strip)`);
}

/** Every frame of each row overlaid: a snap or a pop shows as a doubled edge. */
function renderOnion(states: readonly string[], outPath: string, scale: number): void {
  const def = DONG_QUIXOTE_FIGURE;
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const { canvas, ctx } = newPanel(
    PADDING + states.length * (cellW + PADDING),
    PADDING + cellH + LABEL_HEIGHT,
  );
  states.forEach((state, index) => {
    const x = PADDING + index * (cellW + PADDING);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(state, x, LABEL_HEIGHT - PADDING / 2);
    ctx.globalAlpha = ONION_ALPHA;
    for (let frame = 0; frame < frameCountOf(def, state); frame++) {
      ctx.drawImage(
        bakeFigureCell(def, state, frame),
        0,
        0,
        def.frameWidth,
        def.frameHeight,
        x,
        LABEL_HEIGHT,
        cellW,
        cellH,
      );
    }
    ctx.globalAlpha = 1;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, onion)`);
}

function main(): void {
  // Ahead of the contact sheet: measuring art on the far side of a
  // tens-of-megapixel allocation has made other figures' gates flicker red on
  // art nobody touched.
  if (!process.argv.includes('--skip-gates')) {
    console.log('Gating Dong Quixote…');
    reportFigureGates('dong quixote', dongQuixoteGateFailures());
  }
  const mode = parseMode();
  const states = selectedStates();
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  if (mode === 'strip32') {
    renderStrip32(states, parseFlag('out', `${PREVIEW_DIR}/dong-quixote-strip32.png`));
    return;
  }
  if (mode === 'onion') {
    renderOnion(states, parseFlag('out', `${PREVIEW_DIR}/dong-quixote-onion.png`), scale);
    return;
  }
  renderSheet(states, parseFlag('out', `${PREVIEW_DIR}/dong-quixote-review.png`), scale);
}

main();
