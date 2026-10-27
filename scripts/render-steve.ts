/**
 * Steve Cartwright's review harness: the otter's rows and his crossbow bolt.
 *
 * The art gates run first, before anything is baked, and the sheet is painted
 * from the figures the way the runtime cache bakes them — so one command
 * answers both "does it still hold together" and "what does it look like".
 *
 *   npm run render:steve
 *   npx tsx scripts/render-steve.ts --row=walk_side,shoot --scale=4
 *   npx tsx scripts/render-steve.ts --mode=strip32
 *   npx tsx scripts/render-steve.ts --mode=bolt --scale=3
 *   npx tsx scripts/render-steve.ts --row=reload_side --scale=6 --crop=0.3,0.2,0.75,0.9
 *   npx tsx scripts/render-steve.ts --mode=onion --row=walk_side --scale=4
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell, figureStateNames, frameCountOf } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { steveGateFailures } from './gates-steve.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  BOLT_FLY_STATE,
  BOLT_STUCK_STATE,
  STEVE_BOLT_FIGURE,
  STEVE_FIGURE,
  TILE_SCALE,
} from '../src/sprites/art/steveFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;
/** The in-game strip is also shown blown up this much with nearest-neighbour, so its pixels can be read. */
const STRIP_ZOOM = 3;
/** Left margin, the gap between the two strips, and the right margin. */
const STRIP_GUTTERS = 3;
const EAST = 0;
const SOUTH = Math.PI / 2;
const WEST = Math.PI;
const NORTH_EAST = -SOUTH / 2;
/** Headings the bolt is shown turned to. */
const REVIEW_HEADINGS: readonly number[] = [EAST, SOUTH, WEST, NORTH_EAST];
/** Size of the red dot marking the bolt's anchor. */
const ANCHOR_DOT = 4;
const ANCHOR_COLOR = 'rgba(255,80,80,0.9)';
/** The wooden target face the stuck bolt is shown driven into. */
const TARGET_WOOD = '#9a6a3a';
const TARGET_RING = '#5a3a1c';
const TARGET_RING_WIDTH = 2;
/** The ring's radius as a share of the panel. */
const TARGET_RING_SHARE = 0.33;
/** The bolt lands off the target's centre, as a shot does, rather than pinned at it like a clock hand. */
const TARGET_OFF_CENTRE_SHARE = 0.18;
/** The turned bolts' panel, in in-game tiles. */
const TURNED_PANEL_TILES = 1.5;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#2c2c31';
/** Floors to judge him against: stone, grass, dirt and a pale workshop floor. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#3b3b40', '#637032', '#7a6244', '#8c8170'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const ONION_ALPHA = 0.28;

type Mode = 'sheet' | 'strip32' | 'bolt' | 'onion';
const MODES: ReadonlyArray<Mode> = ['sheet', 'strip32', 'bolt', 'onion'];

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

function backdropFor(index: number): string {
  return FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
}

function newPanel(width: number, height: number): { canvas: Canvas; ctx: SheetContext } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  return { canvas, ctx };
}

function selectedStates(def: FigureDef): string[] {
  const all = figureStateNames(def);
  const only = parseFlag('row', '');
  if (only === '') return all;
  const wanted = only.split(',');
  const states = all.filter((state) => wanted.includes(state));
  if (states.length === 0) throw new Error(`No row named "${only}"`);
  return states;
}

/** A labelled grid, one row per state, each cell on a floor swatch with its tile outlined. */
interface Crop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const CROP_FIELDS = 4;

/** `--crop=x0,y0,x1,y1` as fractions of the cell, so a crop survives the cell being resized. */
function parseCrop(def: FigureDef): Crop {
  const raw = parseFlag('crop', '0,0,1,1');
  const parts = raw.split(',').map(Number);
  if (parts.length !== CROP_FIELDS || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`--crop=${raw} is not four fractions x0,y0,x1,y1`);
  }
  const [x0, y0, x1, y1] = parts;
  return {
    x: Math.round(x0 * def.frameWidth),
    y: Math.round(y0 * def.frameHeight),
    width: Math.round((x1 - x0) * def.frameWidth),
    height: Math.round((y1 - y0) * def.frameHeight),
  };
}

function renderSheet(
  def: FigureDef,
  states: readonly string[],
  outPath: string,
  scale: number,
): void {
  const crop = parseCrop(def);
  const cellW = crop.width * scale;
  const cellH = crop.height * scale;
  const picked = parseFlag('frames', '');
  const framesOf = (state: string): number[] => {
    const all = Array.from({ length: frameCountOf(def, state) }, (_unused, frame) => frame);
    if (picked === '') return all;
    const wanted = picked.split(',').map(Number);
    return all.filter((frame) => wanted.includes(frame));
  };
  const columns = Math.max(...states.map((state) => framesOf(state).length));
  const { canvas, ctx } = newPanel(
    PADDING + columns * (cellW + PADDING),
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING),
  );
  let y = PADDING;
  states.forEach((state, index) => {
    const frames = frameCountOf(def, state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${state} — ${frames} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    framesOf(state).forEach((frame, column) => {
      const x = PADDING + column * (cellW + PADDING);
      ctx.fillStyle = backdropFor(index);
      ctx.fillRect(x, y, cellW, cellH);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        bakeFigureCell(def, state, frame),
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellW, cellH);
      ctx.clip();
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + (def.tileX - crop.x) * scale,
        y + (def.tileY - crop.y) * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
      ctx.restore();
    });
    y += cellH + PADDING;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

/**
 * Every frame of every row at the size the game blits it, on each floor, with a
 * nearest-neighbour blow-up beside it. Review-scale beauty that dies at 32 px
 * counts for nothing.
 */
function renderStrip32(def: FigureDef, states: readonly string[], outPath: string): void {
  const cellW = Math.ceil(def.frameWidth * IN_GAME_SCALE);
  const cellH = Math.ceil(def.frameHeight * IN_GAME_SCALE);
  const columns = Math.max(...states.map((state) => frameCountOf(def, state)));
  const rowWidth = columns * cellW;
  const { canvas, ctx } = newPanel(
    PADDING * STRIP_GUTTERS + rowWidth * (1 + STRIP_ZOOM),
    PADDING + states.length * (cellH * STRIP_ZOOM + LABEL_HEIGHT + PADDING),
  );
  let y = PADDING;
  states.forEach((state, index) => {
    const frames = frameCountOf(def, state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(state, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    const strip = createCanvas(rowWidth, cellH);
    const stripCtx = strip.getContext('2d');
    stripCtx.fillStyle = backdropFor(index);
    stripCtx.fillRect(0, 0, rowWidth, cellH);
    stripCtx.imageSmoothingEnabled = true;
    for (let frame = 0; frame < frames; frame++) {
      stripCtx.drawImage(bakeFigureCell(def, state, frame), frame * cellW, 0, cellW, cellH);
    }
    ctx.drawImage(strip, PADDING, y);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(strip, PADDING * 2 + rowWidth, y, rowWidth * STRIP_ZOOM, cellH * STRIP_ZOOM);
    ctx.imageSmoothingEnabled = true;
    y += cellH * STRIP_ZOOM + PADDING;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, in-game strip)`);
}

/** Consecutive frames overlaid faintly: a snap or a pop shows as a doubled edge. */
function renderOnion(
  def: FigureDef,
  states: readonly string[],
  outPath: string,
  scale: number,
): void {
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const { canvas, ctx } = newPanel(
    PADDING + states.length * (cellW + PADDING),
    PADDING + cellH + LABEL_HEIGHT + PADDING,
  );
  states.forEach((state, index) => {
    const x = PADDING + index * (cellW + PADDING);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(state, x, PADDING + LABEL_HEIGHT - PADDING);
    ctx.fillStyle = backdropFor(index);
    ctx.fillRect(x, PADDING + LABEL_HEIGHT, cellW, cellH);
    ctx.globalAlpha = ONION_ALPHA;
    for (let frame = 0; frame < frameCountOf(def, state); frame++) {
      ctx.drawImage(bakeFigureCell(def, state, frame), x, PADDING + LABEL_HEIGHT, cellW, cellH);
    }
    ctx.globalAlpha = 1;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, onion)`);
}

/**
 * The bolt: every flying frame and the stuck one at review scale with the
 * anchor marked, then at the in-game size turned to four headings the way the
 * runtime draws them, flying above and stuck in a wooden target face below.
 */
function renderBolt(outPath: string, scale: number): void {
  const def = STEVE_BOLT_FIGURE;
  const cells: ReadonlyArray<readonly [string, number]> = [
    ...Array.from(
      { length: frameCountOf(def, BOLT_FLY_STATE) },
      (_unused, frame) => [BOLT_FLY_STATE, frame] as const,
    ),
    [BOLT_STUCK_STATE, 0],
  ];
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const panel = TURNED_PANEL_TILES * IN_GAME_TILE;
  const zoomedPanel = panel * STRIP_ZOOM;
  const { canvas, ctx } = newPanel(
    PADDING +
      Math.max(cells.length * (cellW + PADDING), REVIEW_HEADINGS.length * (zoomedPanel + PADDING)),
    PADDING + LABEL_HEIGHT + cellH + PADDING + (LABEL_HEIGHT + zoomedPanel + PADDING) * 2,
  );
  let y = PADDING;
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    'bolt: flying frames, then stuck (anchor in red)',
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;
  cells.forEach(([state, frame], index) => {
    const x = PADDING + index * (cellW + PADDING);
    ctx.fillStyle = state === BOLT_STUCK_STATE ? TARGET_WOOD : backdropFor(index);
    ctx.fillRect(x, y, cellW, cellH);
    ctx.drawImage(bakeFigureCell(def, state, frame), x, y, cellW, cellH);
    ctx.fillStyle = ANCHOR_COLOR;
    ctx.fillRect(
      x + def.tileX * scale - ANCHOR_DOT / 2,
      y + def.tileY * scale - ANCHOR_DOT / 2,
      ANCHOR_DOT,
      ANCHOR_DOT,
    );
  });
  y += cellH + PADDING;

  for (const state of [BOLT_FLY_STATE, BOLT_STUCK_STATE]) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${state} at the in-game 32 px tile, turned east, south, west, north-east (shown ${STRIP_ZOOM}×)`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    REVIEW_HEADINGS.forEach((heading, index) => {
      const small = createCanvas(panel, panel);
      const smallCtx = small.getContext('2d');
      smallCtx.fillStyle = state === BOLT_STUCK_STATE ? TARGET_WOOD : backdropFor(index);
      smallCtx.fillRect(0, 0, panel, panel);
      if (state === BOLT_STUCK_STATE) {
        smallCtx.strokeStyle = TARGET_RING;
        smallCtx.lineWidth = TARGET_RING_WIDTH;
        smallCtx.beginPath();
        const ringX = panel / 2 - Math.sin(heading) * panel * TARGET_OFF_CENTRE_SHARE;
        const ringY = panel / 2 + Math.cos(heading) * panel * TARGET_OFF_CENTRE_SHARE;
        smallCtx.arc(ringX, ringY, panel * TARGET_RING_SHARE, 0, Math.PI * 2);
        smallCtx.stroke();
      }
      smallCtx.save();
      smallCtx.translate(panel / 2, panel / 2);
      smallCtx.rotate(heading);
      smallCtx.drawImage(
        bakeFigureCell(def, state, 0),
        -def.tileX * IN_GAME_SCALE,
        -def.tileY * IN_GAME_SCALE,
        def.frameWidth * IN_GAME_SCALE,
        def.frameHeight * IN_GAME_SCALE,
      );
      smallCtx.restore();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, PADDING + index * (zoomedPanel + PADDING), y, zoomedPanel, zoomedPanel);
      ctx.imageSmoothingEnabled = true;
    });
    y += zoomedPanel + PADDING;
  }
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, bolt)`);
}

function main(): void {
  if (!process.argv.includes('--skip-gates')) {
    // Ahead of the sheet: a tens-of-megapixel allocation between painting and
    // measuring has been seen to make a pixel gate misreport.
    console.log('Gating Steve Cartwright…');
    reportFigureGates('steve', steveGateFailures());
  }
  const mode = parseMode();
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  if (mode === 'bolt') {
    renderBolt(parseFlag('out', `${PREVIEW_DIR}/steve-bolt.png`), scale);
    return;
  }
  const states = selectedStates(STEVE_FIGURE);
  if (mode === 'strip32') {
    renderStrip32(STEVE_FIGURE, states, parseFlag('out', `${PREVIEW_DIR}/steve-strip32.png`));
    return;
  }
  if (mode === 'onion') {
    renderOnion(STEVE_FIGURE, states, parseFlag('out', `${PREVIEW_DIR}/steve-onion.png`), scale);
    return;
  }
  renderSheet(STEVE_FIGURE, states, parseFlag('out', `${PREVIEW_DIR}/steve-review.png`), scale);
}

main();
