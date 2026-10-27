/**
 * Old Lori's review harness: the art gates first, then a contact sheet of
 * every row in every view with an in-game-size strip, or crops of one part
 * across a row's frames.
 *
 *   npm run render:lori
 *   npx tsx scripts/render-lori.ts --scale=8 --row=walk_side
 *   npx tsx scripts/render-lori.ts --mode=part --part=feet --scale=6
 *   npx tsx scripts/render-lori.ts --mode=part --part=caneHand --row=walk --scale=6
 */

import { type Canvas, createCanvas } from 'canvas';

import { paintFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { loriGateFailures } from './gates-lori.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  FRAME_H,
  FRAME_W,
  GROUND_OFFSET_IN_TILE,
  LORI_FIGURE,
  LORI_ROW_NAMES,
  LORI_VIEWS,
  TILE_SCALE,
  TILE_X,
  TILE_Y,
  loriStateName,
} from '../src/sprites/art/loriFigure.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;
/** The in-game strip is repeated at this nearest-neighbour zoom, so its pixels can be read. */
const IN_GAME_ZOOM = 2;
const DEFAULT_SCALE = 4;
const MIN_SCALE = 1;
const MAX_SCALE = 24;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#2a2230';
/** A cottage's dark boards and two lighter grounds, for the contrast check. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#3a2a20', '#3b3b40', '#5a4a3a'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const GROUND_GUIDE = 'rgba(255,200,120,0.5)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

type Mode = 'sheet' | 'part';
const MODES: ReadonlyArray<Mode> = ['sheet', 'part'];

/** A window on the cell, as fractions of it, so it survives a re-derived cell size. */
interface Crop {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

type Part = 'head' | 'caneHand' | 'feet' | 'back';
const PARTS: Readonly<Record<Part, Crop>> = {
  head: { x0: 0.2, x1: 0.8, y0: 0.0, y1: 0.45 },
  caneHand: { x0: 0.3, x1: 1.0, y0: 0.3, y1: 0.8 },
  feet: { x0: 0.25, x1: 0.95, y0: 0.6, y1: 1.0 },
  back: { x0: 0.15, x1: 0.85, y0: 0.0, y1: 0.75 },
};

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

function parseMode(): Mode {
  const raw = parseFlag('mode', 'sheet');
  const found = MODES.find((mode) => mode === raw);
  if (found === undefined) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
  return found;
}

function parsePart(): Part {
  const raw = parseFlag('part', 'feet');
  const parts = Object.keys(PARTS);
  const found = parts.find((part): part is Part => part === raw);
  if (found === undefined) throw new Error(`--part=${raw} is not one of ${parts.join(', ')}`);
  return found;
}

function allStates(): string[] {
  return LORI_ROW_NAMES.flatMap((row) => LORI_VIEWS.map((view) => loriStateName(row, view)));
}

function selectedStates(): string[] {
  const only = parseFlag('row', '');
  const states = allStates();
  if (only === '') return states;
  if (!states.includes(only)) throw new Error(`--row=${only} is not one of ${states.join(', ')}`);
  return [only];
}

function framesOf(name: string): number {
  const frames = LORI_FIGURE.states.get(name)?.frames;
  if (frames === undefined) throw new Error(`lori declares no state "${name}"`);
  return frames;
}

/** The frames to show, from `--frames=first-last` (inclusive), or every frame of the row. */
function shownFrames(state: string): number[] {
  const all = Array.from({ length: framesOf(state) }, (_unused, frame) => frame);
  const raw = parseFlag('frames', '');
  if (raw === '') return all;
  const [first, last] = raw.split('-').map(Number);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) {
    throw new Error(`--frames=${raw} is not first-last`);
  }
  return all.filter((frame) => frame >= first && frame <= last);
}

function newPanel(width: number, height: number): { canvas: Canvas; ctx: SheetContext } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  return { canvas, ctx };
}

function label(ctx: SheetContext, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(text, x, y + LABEL_HEIGHT - PADDING);
}

function renderSheet(scale: number, outPath: string): void {
  const states = selectedStates();
  const cellW = FRAME_W * scale;
  const cellH = FRAME_H * scale;
  const maxCols = Math.max(...states.map((state) => shownFrames(state).length));
  const inGameW = FRAME_W * IN_GAME_SCALE;
  const inGameH = FRAME_H * IN_GAME_SCALE;
  const zoomW = inGameW * IN_GAME_ZOOM;
  const zoomH = inGameH * IN_GAME_ZOOM;
  const { canvas, ctx } = newPanel(
    PADDING + Math.max(maxCols * (cellW + PADDING), maxCols * (zoomW + PADDING)),
    PADDING +
      states.length * (cellH + LABEL_HEIGHT + PADDING) +
      LABEL_HEIGHT +
      states.length * (inGameH + zoomH + PADDING * 2),
  );
  let y = PADDING;
  states.forEach((state, index) => {
    label(ctx, `${state} — ${framesOf(state)} frames`, PADDING, y);
    y += LABEL_HEIGHT;
    shownFrames(state).forEach((frame, column) => {
      const x = PADDING + column * (cellW + PADDING);
      ctx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(paintFigureCell(LORI_FIGURE, state, frame, scale), x, y);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + TILE_X * scale,
        y + TILE_Y * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    });
    y += cellH + PADDING;
  });

  label(ctx, `in-game size (${IN_GAME_TILE}px tile), then ${IN_GAME_ZOOM}× nearest`, PADDING, y);
  y += LABEL_HEIGHT;
  for (const state of states) {
    shownFrames(state).forEach((frame, column) => {
      // Baked at cell density and blitted down, as the cache does.
      const small = createCanvas(inGameW, inGameH);
      const sctx = small.getContext('2d');
      sctx.fillStyle = FLOOR_SWATCHES[0];
      sctx.fillRect(0, 0, inGameW, inGameH);
      sctx.drawImage(paintFigureCell(LORI_FIGURE, state, frame, 1), 0, 0, inGameW, inGameH);
      ctx.drawImage(small, PADDING + column * (inGameW + PADDING), y);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        small,
        PADDING + column * (zoomW + PADDING),
        y + inGameH + PADDING,
        zoomW,
        zoomH,
      );
      ctx.imageSmoothingEnabled = true;
    });
    y += inGameH + zoomH + PADDING * 2;
  }

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

function renderPart(part: Part, scale: number, outPath: string): void {
  const crop = PARTS[part];
  const states = selectedStates();
  const cropW = (crop.x1 - crop.x0) * FRAME_W * scale;
  const cropH = (crop.y1 - crop.y0) * FRAME_H * scale;
  const maxCols = Math.max(...states.map((state) => shownFrames(state).length));
  const { canvas, ctx } = newPanel(
    PADDING + maxCols * (cropW + PADDING),
    PADDING + states.length * (cropH + LABEL_HEIGHT + PADDING),
  );
  const groundShare = (TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE) / FRAME_H;
  const groundInCrop = ((groundShare - crop.y0) / (crop.y1 - crop.y0)) * cropH;
  let y = PADDING;
  for (const state of states) {
    label(ctx, `${state} — ${part}`, PADDING, y);
    y += LABEL_HEIGHT;
    shownFrames(state).forEach((frame, column) => {
      const cell = paintFigureCell(LORI_FIGURE, state, frame, scale);
      const x = PADDING + column * (cropW + PADDING);
      ctx.fillStyle = FLOOR_SWATCHES[0];
      ctx.fillRect(x, y, cropW, cropH);
      ctx.drawImage(
        cell,
        crop.x0 * cell.width,
        crop.y0 * cell.height,
        cropW,
        cropH,
        x,
        y,
        cropW,
        cropH,
      );
      if (groundInCrop > 0 && groundInCrop < cropH) {
        ctx.strokeStyle = GROUND_GUIDE;
        ctx.beginPath();
        ctx.moveTo(x, y + groundInCrop);
        ctx.lineTo(x + cropW, y + groundInCrop);
        ctx.stroke();
      }
    });
    y += cropH + PADDING;
  }
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath}`);
}

function main(): void {
  console.log('Old Lori art gates');
  const clean = reportFigureGates('lori', loriGateFailures());
  if (!clean) console.error('Rendering anyway so the failures can be looked at.');
  const mode = parseMode();
  const scale = parseScale();
  if (mode === 'sheet') {
    renderSheet(scale, parseFlag('out', `${PREVIEW_DIR}/lori/sheet.png`));
    return;
  }
  const part = parsePart();
  renderPart(part, scale, parseFlag('out', `${PREVIEW_DIR}/lori/${part}.png`));
}

main();
