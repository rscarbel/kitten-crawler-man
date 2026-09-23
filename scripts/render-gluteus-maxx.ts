/**
 * Gluteus Maxx's review harness.
 *
 * Art has to be judged as an image, by something that only looks at the
 * image: every defect that has ever mattered on a figure in this project was
 * invisible to typecheck, to lint and to reading the drawing code. The contact
 * sheet is painted from the figure the way the runtime cache bakes it, and the
 * art gates run first, so one command answers both "does it still hold
 * together" and "what does it look like".
 *
 *   npm run render:gluteus-maxx                       every row, every view
 *   npx tsx scripts/render-gluteus-maxx.ts --facing=side --scale=4
 *   npx tsx scripts/render-gluteus-maxx.ts --row=crush --facing=front
 *   npx tsx scripts/render-gluteus-maxx.ts --mode=ingame   every frame at 32 px
 *   npm run gates:gluteus-maxx                        the gates alone
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell, paintFigureCell } from './figureSheet.js';
import { inkBoxOf, reportFigureGates, type InkBox } from './figureGates.js';
import { gluteusMaxxGateFailures } from './gates-gluteus-maxx.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  GROUND_OFFSET_IN_TILE,
  MAXX_FACINGS,
  MAXX_ROW_BASES,
  TILE_SCALE,
  maxxFigureOfState,
  maxxStateName,
  type MaxxFacing,
  type MaxxRowBase,
} from '../src/sprites/art/gluteusMaxxFigure.js';
import {
  GROUND_OFFSET_IN_TILE as HUMAN_GROUND_OFFSET_IN_TILE,
  HUMAN_FIGURE,
} from '../src/sprites/art/humanFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;

const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 20;
const PADDING = 6;
const LABEL_INSET = 3;
/** The grounds he actually stands on: the club's floor, dungeon stone, grass, dirt. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#3b3b40', '#4a3a4e', '#637032', '#7a6244'];
const BACKDROP = '#26262b';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '13px sans-serif';
/** Carl's standing row, for the size comparison. */
const CARL_STATE = 'idle';

type Mode = 'sheet' | 'ingame' | 'gates';
const MODES: ReadonlyArray<Mode> = ['sheet', 'ingame', 'gates'];

type SheetContext = ReturnType<Canvas['getContext']>;

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

function parseChoice<T extends string>(name: string, choices: readonly T[], fallback: string): T[] {
  const raw = parseFlag(name, fallback);
  if (raw === 'all') return [...choices];
  const picked = raw.split(',').map((item) => {
    const found = choices.find((choice) => choice === item);
    if (found === undefined)
      throw new Error(`--${name}=${item} is not one of ${choices.join(', ')}`);
    return found;
  });
  return picked;
}

function newPanel(width: number, height: number): { canvas: Canvas; ctx: SheetContext } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  return { canvas, ctx };
}

function frameCountOf(def: FigureDef, state: string): number {
  const declared = def.states.get(state);
  if (declared === undefined) throw new Error(`${def.id} declares no state "${state}"`);
  return declared.frames;
}

/** The figure that paints a state; the harness only ever names states it built itself. */
function figureFor(state: string): FigureDef {
  const figure = maxxFigureOfState(state);
  if (figure === null) throw new Error(`neither gluteus_maxx figure paints "${state}"`);
  return figure;
}

/** The frames `--frames=0,3,6` asks for, or every frame of the row. */
function framesToShow(frameCount: number): number[] {
  const raw = parseFlag('frames', '');
  const all = Array.from({ length: frameCount }, (_unused, frame) => frame);
  if (raw === '') return all;
  return raw
    .split(',')
    .map(Number)
    .filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < frameCount);
}

/** Clear cell pixels kept round a row's ink when the sheet is cropped to it. */
const CROP_PAD = 6;

/**
 * The part of the cell a row ever paints, padded: the cell is sized for the
 * crush and the fall, and a standing row drawn in all of it is mostly floor.
 */
function rowWindow(def: FigureDef, state: string, frames: readonly number[]): InkBox {
  const boxes = frames
    .map((frame) => inkBoxOf(def, state, frame))
    .filter((box): box is InkBox => box !== null);
  if (boxes.length === 0) return { minX: 0, minY: 0, maxX: def.frameWidth, maxY: def.frameHeight };
  return {
    minX: Math.max(0, Math.min(...boxes.map((b) => b.minX)) - CROP_PAD),
    minY: Math.max(0, Math.min(...boxes.map((b) => b.minY)) - CROP_PAD),
    maxX: Math.min(def.frameWidth, Math.max(...boxes.map((b) => b.maxX)) + CROP_PAD),
    maxY: Math.min(def.frameHeight, Math.max(...boxes.map((b) => b.maxY)) + CROP_PAD),
  };
}

/** A labelled grid, one row per state, at `scale` times the cell, cropped to each row's ink. */
function renderRows(states: readonly string[], outPath: string, scale: number): void {
  const rows = states.map((state) => {
    const def = figureFor(state);
    const shown = framesToShow(frameCountOf(def, state));
    return { state, def, shown, window: rowWindow(def, state, shown) };
  });
  const widthOf = (w: InkBox): number => (w.maxX - w.minX) * scale;
  const heightOf = (w: InkBox): number => (w.maxY - w.minY) * scale;
  const panelWidth = Math.max(
    ...rows.map((row) => PADDING + row.shown.length * (widthOf(row.window) + PADDING)),
  );
  const panelHeight =
    PADDING + rows.reduce((sum, row) => sum + heightOf(row.window) + LABEL_HEIGHT + PADDING, 0);
  const { canvas, ctx } = newPanel(panelWidth, panelHeight);
  let y = PADDING;
  rows.forEach(({ state, def, shown, window }, index) => {
    const cellW = widthOf(window);
    const cellH = heightOf(window);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${state} — ${frameCountOf(def, state)} frames`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    shown.forEach((frame, column) => {
      const x = PADDING + column * (cellW + PADDING);
      ctx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
      ctx.fillRect(x, y, cellW, cellH);
      // Enlarged review cells are painted at their review density rather than
      // blown up from the game-size cell, so the detail being judged is there.
      const density = Math.max(1, scale);
      const cell =
        scale > 1 ? paintFigureCell(def, state, frame, density) : bakeFigureCell(def, state, frame);
      const k = cell.width / def.frameWidth;
      ctx.drawImage(
        cell,
        window.minX * k,
        window.minY * k,
        (window.maxX - window.minX) * k,
        (window.maxY - window.minY) * k,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + (def.tileX - window.minX) * scale,
        y + (def.tileY - window.minY) * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(String(frame), x + LABEL_INSET, y + LABEL_HEIGHT - PADDING);
    });
    y += cellH + PADDING;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

/**
 * Every frame of every requested row at the size the game blits it, on the
 * floors he stands on, with Carl at the head of each line for scale. This is
 * the size the silhouette has to survive, and the size the gauntlets, the
 * armband and the hair have to read at.
 */
function renderInGame(states: readonly string[], outPath: string, zoom: number): void {
  const k = IN_GAME_SCALE * zoom;
  const carlK = (IN_GAME_TILE / HUMAN_FIGURE.tileScale) * zoom;
  const carlGround = HUMAN_FIGURE.tileY + HUMAN_FIGURE.tileScale * HUMAN_GROUND_OFFSET_IN_TILE;
  const carl = bakeFigureCell(HUMAN_FIGURE, CARL_STATE, 0);
  const carlWindow = rowWindow(HUMAN_FIGURE, CARL_STATE, [0]);
  const rows = states.map((state) => {
    const def = figureFor(state);
    const frames = Array.from({ length: frameCountOf(def, state) }, (_unused, frame) => frame);
    const maxxGround = def.tileY + def.tileScale * GROUND_OFFSET_IN_TILE;
    return { state, def, maxxGround, frames, window: rowWindow(def, state, frames) };
  });
  const carlAbove = (carlGround - carlWindow.minY) * carlK;
  const carlWidth = (carlWindow.maxX - carlWindow.minX) * carlK;
  const layout = rows.map((row) => {
    const above = Math.max(carlAbove, (row.maxxGround - row.window.minY) * k);
    const below = Math.max(
      (carlWindow.maxY - carlGround) * carlK,
      (row.window.maxY - row.maxxGround) * k,
    );
    return { ...row, above, height: above + below, width: (row.window.maxX - row.window.minX) * k };
  });
  const panelWidth = Math.max(
    ...layout.map((row) => PADDING * 2 + carlWidth + row.frames.length * (row.width + PADDING)),
  );
  const panelHeight =
    PADDING + layout.reduce((sum, row) => sum + row.height + LABEL_HEIGHT + PADDING, 0);
  const { canvas, ctx } = newPanel(panelWidth, panelHeight);
  let y = PADDING;
  layout.forEach((row, index) => {
    ctx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
    ctx.fillRect(0, y, canvas.width, row.height + LABEL_HEIGHT);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(row.state, PADDING, y + LABEL_HEIGHT - PADDING);
    const groundY = y + LABEL_HEIGHT + row.above;
    ctx.drawImage(
      carl,
      carlWindow.minX,
      carlWindow.minY,
      carlWindow.maxX - carlWindow.minX,
      carlWindow.maxY - carlWindow.minY,
      PADDING,
      groundY - carlAbove,
      carlWidth,
      (carlWindow.maxY - carlWindow.minY) * carlK,
    );
    row.frames.forEach((frame, column) => {
      const x = PADDING * 2 + carlWidth + column * (row.width + PADDING);
      const w = row.window;
      ctx.drawImage(
        bakeFigureCell(row.def, row.state, frame),
        w.minX,
        w.minY,
        w.maxX - w.minX,
        w.maxY - w.minY,
        x,
        groundY - (row.maxxGround - w.minY) * k,
        row.width,
        (w.maxY - w.minY) * k,
      );
    });
    y += row.height + LABEL_HEIGHT + PADDING;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, in-game ×${zoom})`);
}

function main(): void {
  console.log('Gating Gluteus Maxx…');
  reportFigureGates('gluteus maxx', gluteusMaxxGateFailures());

  const mode = parseChoice<Mode>('mode', MODES, 'sheet')[0];
  if (mode === 'gates') return;
  const facings = parseChoice<MaxxFacing>('facing', MAXX_FACINGS, 'all');
  const bases = parseChoice<MaxxRowBase>('row', MAXX_ROW_BASES, 'all');
  const states = bases.flatMap((base) => facings.map((facing) => maxxStateName(base, facing)));
  const suffix = parseFlag('tag', '');
  if (mode === 'ingame') {
    const zoom = parseNumberFlag('zoom', 2, 1, MAX_SCALE);
    renderInGame(states, parseFlag('out', `${PREVIEW_DIR}/gluteus-maxx-ingame${suffix}.png`), zoom);
    return;
  }
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  renderRows(states, parseFlag('out', `${PREVIEW_DIR}/gluteus-maxx-review${suffix}.png`), scale);
}

main();
