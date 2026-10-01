/**
 * The Former Circus Lemur's review harness.
 *
 * Paints every row of `CIRCUS_LEMUR_FIGURE` the way the runtime cache bakes
 * it, enlarged, then the same frames at true in-game size (a 32 px tile) on the
 * grounds the lemur is met on, and that in-game strip blown up pixel-for-pixel
 * so the read at tile size can be judged rather than guessed.
 *
 *   npm run render:circus-lemur
 *   npx tsx scripts/render-circus-lemur.ts --row=throw --scale=6
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet, frameCountOf, paintFigureCell } from './figureSheet.js';
import { figureStructuralFailures, reportFigureGates } from './figureGates.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  CIRCUS_LEMUR_FIGURE,
  LEMUR_ROWS,
  TILE_SCALE,
} from '../src/sprites/art/circusLemurFigure.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 3;
const MIN_SCALE = 1;
const MAX_SCALE = 12;
/** The in-game strip is blown up this much with no smoothing, to show real pixels. */
const PIXEL_ZOOM = 4;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
/** Circus sawdust, Big Top boards, a dark maze floor and grass. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#b89a6a', '#6a4a32', '#1c1a22', '#4f6a3a'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
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

/** One cell at in-game size: painted at twice the density, then halved, as the cache does. */
function inGameCell(state: string, frame: number): Canvas {
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const supersample = 2;
  const painted = paintFigureCell(CIRCUS_LEMUR_FIGURE, state, frame, inGameScale * supersample);
  const width = Math.ceil(CIRCUS_LEMUR_FIGURE.frameWidth * inGameScale);
  const height = Math.ceil(CIRCUS_LEMUR_FIGURE.frameHeight * inGameScale);
  const cell = createCanvas(width, height);
  cell.getContext('2d').drawImage(painted, 0, 0, width, height);
  return cell;
}

function renderInGameStrip(states: readonly string[]): Canvas {
  const def = CIRCUS_LEMUR_FIGURE;
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const cellW = Math.ceil(def.frameWidth * inGameScale);
  const cellH = Math.ceil(def.frameHeight * inGameScale);
  const columns = Math.max(...states.map((state) => frameCountOf(def, state)));
  const strip = createCanvas(columns * cellW, states.length * FLOOR_SWATCHES.length * cellH);
  const ctx = strip.getContext('2d');
  states.forEach((state, stateIndex) => {
    FLOOR_SWATCHES.forEach((floor, floorIndex) => {
      const y = (stateIndex * FLOOR_SWATCHES.length + floorIndex) * cellH;
      ctx.fillStyle = floor;
      ctx.fillRect(0, y, strip.width, cellH);
      for (let frame = 0; frame < frameCountOf(def, state); frame++) {
        ctx.drawImage(inGameCell(state, frame), frame * cellW, y);
      }
    });
  });
  return strip;
}

function render(outPath: string, scale: number, only: string): void {
  const def = CIRCUS_LEMUR_FIGURE;
  const all = LEMUR_ROWS.map((row) => row.name);
  const wanted = only === '' ? all : all.filter((state) => only.split(',').includes(state));
  if (wanted.length === 0) throw new Error(`No row named "${only}"`);
  const sheet = bakeFigureSheet(def, wanted).canvas;
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const columns = Math.max(...wanted.map((state) => frameCountOf(def, state)));
  const strip = renderInGameStrip(wanted);

  const width = Math.max(
    PADDING + columns * (cellW + PADDING),
    PADDING * 2 + strip.width * PIXEL_ZOOM + PADDING + strip.width,
  );
  const height =
    PADDING +
    wanted.length * (cellH + LABEL_HEIGHT + PADDING) +
    LABEL_HEIGHT +
    strip.height * PIXEL_ZOOM +
    PADDING;
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx: SheetContext = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  wanted.forEach((state, index) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${state} — ${frameCountOf(def, state)} frames`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frameCountOf(def, state); frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(
        sheet,
        frame * def.frameWidth,
        index * def.frameHeight,
        def.frameWidth,
        def.frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + def.tileX * scale,
        y + def.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    }
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    `in-game (${IN_GAME_TILE}px tile): ${PIXEL_ZOOM}× pixel zoom, then true size`,
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(strip, PADDING, y, strip.width * PIXEL_ZOOM, strip.height * PIXEL_ZOOM);
  ctx.drawImage(strip, PADDING * 2 + strip.width * PIXEL_ZOOM, y);

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

function main(): void {
  console.log('Gating the circus lemur figure…');
  reportFigureGates('circus lemur', figureStructuralFailures(CIRCUS_LEMUR_FIGURE));
  render(
    parseFlag('out', `${PREVIEW_DIR}/circus-lemur-review.png`),
    parseScale(),
    parseFlag('row', ''),
  );
}

main();
