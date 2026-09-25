/**
 * The cows' and calves' review harness.
 *
 * Art has to be judged as an image, by something that only looks at the image:
 * every defect that has mattered on a figure in this project was invisible to
 * typecheck, to lint and to reading the drawing code. Every sheet is painted
 * from the figures the way the runtime cache bakes them, and the art gates run
 * first, so one command answers both "does it still hold together" and "what
 * does it look like".
 *
 *   npm run render:cow                         every sheet: six figures at 3×,
 *                                              the in-game overview, the gore
 *   npx tsx scripts/render-cow.ts --mode=sheet --figure=calf_dun --row=happy_side
 *   npx tsx scripts/render-cow.ts --mode=ingame
 *   npx tsx scripts/render-cow.ts --mode=gore
 *   npx tsx scripts/render-cow.ts --mode=review   the blind-review sheet: one
 *                                              labelled strip per figure at 2×
 *   --skip-gates                               iterate on art without the gates
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { cowGateFailures } from './gates-cow.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  COW_FIGURE_ENTRIES,
  type CowFigureEntry,
  TILE_SCALE,
} from '../src/sprites/art/cowFigure.js';
import { COW_GORE_STATES } from '../src/sprites/art/cowGore.js';

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;
const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 20;
const PADDING = 8;
const BACKDROP = '#3b3b40';
/** The floor-3 grass mid a pasture cow stands on. */
const GRASS = '#637032';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '13px sans-serif';
const LABEL_BASELINE_INSET = 6;
const LABEL_CENTRE_NUDGE = 4;
/** The close-up scale every figure's full sheet is baked at. */
const REVIEW_SCALE = 3;

type Mode = 'all' | 'sheet' | 'ingame' | 'gore' | 'review' | 'grid';
const MODES: ReadonlyArray<Mode> = ['all', 'sheet', 'ingame', 'gore', 'review', 'grid'];

type SheetContext = ReturnType<Canvas['getContext']>;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
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

function parseMode(): Mode {
  const raw = parseFlag('mode', 'all');
  const found = MODES.find((mode) => mode === raw);
  if (found === undefined) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
  return found;
}

function newPanel(
  width: number,
  height: number,
  fill = BACKDROP,
): { canvas: Canvas; ctx: SheetContext } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  return { canvas, ctx };
}

function entriesFor(filter: string): readonly CowFigureEntry[] {
  if (filter === '') return COW_FIGURE_ENTRIES;
  const wanted = filter.split(',');
  const found = COW_FIGURE_ENTRIES.filter((entry) => wanted.includes(entry.figure.id));
  if (found.length === 0) throw new Error(`No figure named "${filter}"`);
  return found;
}

function rowNamesFor(entry: CowFigureEntry, filter: string): string[] {
  const all = entry.rows.map((row) => row.name);
  if (filter === '') return all;
  const wanted = filter.split(',');
  const found = all.filter((name) => wanted.includes(name));
  if (found.length === 0) throw new Error(`No row named "${filter}"`);
  return found;
}

/** Every row of one figure, every frame, at `scale`, with the tile guide. */
function renderFigureSheet(
  entry: CowFigureEntry,
  outPath: string,
  scale: number,
  rowFilter: string,
): void {
  const def = entry.figure;
  const { frameWidth, frameHeight } = def;
  const states = rowNamesFor(entry, rowFilter);
  const sheet = bakeFigureSheet(def, states).canvas;
  const cellW = frameWidth * scale;
  const cellH = frameHeight * scale;
  const frameFilter = parseFlag('frame', '');
  const onlyFrames = frameFilter === '' ? null : frameFilter.split(',').map(Number);
  const framesOf = (state: string): number[] => {
    const count = def.states.get(state)?.frames ?? 0;
    const all = Array.from({ length: count }, (_unused, i) => i);
    return onlyFrames === null ? all : all.filter((i) => onlyFrames.includes(i));
  };
  const maxCols = Math.max(...states.map((state) => framesOf(state).length));
  const { canvas, ctx } = newPanel(
    PADDING + maxCols * (cellW + PADDING),
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING),
  );
  let y = PADDING;
  states.forEach((state, index) => {
    const row = entry.rows.find((candidate) => candidate.name === state);
    const frames = def.states.get(state)?.frames ?? 0;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${def.id} ${state} — ${frames} frames, ${row?.view ?? '?'}, ${row?.kind ?? '?'}`,
      PADDING,
      y + LABEL_HEIGHT - LABEL_BASELINE_INSET,
    );
    y += LABEL_HEIGHT;
    framesOf(state).forEach((frame, column) => {
      const x = PADDING + column * (cellW + PADDING);
      ctx.fillStyle = GRASS;
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(
        sheet,
        frame * frameWidth,
        index * frameHeight,
        frameWidth,
        frameHeight,
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
    });
    y += cellH + PADDING;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

/**
 * Every figure × every row, every frame, at the size it renders in game, on
 * grass. The primary realism judgement: review-scale beauty that dies at 32 px
 * counts for nothing.
 */
function renderInGame(
  outPath: string,
  entries: readonly CowFigureEntry[],
  rowFilter: string,
): void {
  const first = entries[0];
  const def = first.figure;
  const cellW = def.frameWidth * IN_GAME_SCALE;
  const cellH = def.frameHeight * IN_GAME_SCALE;
  const states = rowNamesFor(first, rowFilter);
  const maxCols = Math.max(...states.map((state) => def.states.get(state)?.frames ?? 0));
  const labelW = 150;
  const blockH = states.length * cellH + LABEL_HEIGHT + PADDING;
  const { canvas, ctx } = newPanel(
    labelW + maxCols * cellW + PADDING,
    PADDING + entries.length * blockH,
    GRASS,
  );
  let y = PADDING;
  for (const entry of entries) {
    const sheet = bakeFigureSheet(entry.figure, states).canvas;
    ctx.fillStyle = '#10140a';
    ctx.fillText(entry.figure.id, PADDING, y + LABEL_HEIGHT - LABEL_BASELINE_INSET);
    y += LABEL_HEIGHT;
    states.forEach((state, index) => {
      ctx.fillStyle = '#1b2210';
      ctx.fillText(state, PADDING, y + cellH / 2 + LABEL_CENTRE_NUDGE);
      const frames = entry.figure.states.get(state)?.frames ?? 0;
      for (let frame = 0; frame < frames; frame++) {
        ctx.drawImage(
          sheet,
          frame * def.frameWidth,
          index * def.frameHeight,
          def.frameWidth,
          def.frameHeight,
          labelW + frame * cellW,
          y,
          cellW,
          cellH,
        );
      }
      y += cellH;
    });
    y += PADDING;
  }
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, in-game size)`);
}

/** The severed pieces at 3×, 1× and in-game size, per figure. */
const GORE_REVIEW_SCALES: ReadonlyArray<number> = [REVIEW_SCALE, 1, IN_GAME_SCALE];

function renderGore(outPath: string, entries: readonly CowFigureEntry[]): void {
  const def = entries[0].figure;
  const pieceCount = COW_GORE_STATES.length;
  const blockH =
    GORE_REVIEW_SCALES.reduce((total, scale) => total + def.frameHeight * scale + PADDING, 0) +
    LABEL_HEIGHT;
  const { canvas, ctx } = newPanel(
    PADDING + pieceCount * (def.frameWidth * GORE_REVIEW_SCALES[0] + PADDING),
    PADDING + entries.length * blockH,
  );
  let y = PADDING;
  for (const entry of entries) {
    const sheet = bakeFigureSheet(entry.figure, [...COW_GORE_STATES]).canvas;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${entry.figure.id} — ${COW_GORE_STATES.join(', ')}`,
      PADDING,
      y + LABEL_HEIGHT - LABEL_BASELINE_INSET,
    );
    y += LABEL_HEIGHT;
    for (const scale of GORE_REVIEW_SCALES) {
      const cellW = def.frameWidth * scale;
      const cellH = def.frameHeight * scale;
      COW_GORE_STATES.forEach((_state, piece) => {
        const x = PADDING + piece * (cellW + PADDING);
        ctx.fillStyle = GRASS;
        ctx.fillRect(x, y, cellW, cellH);
        ctx.drawImage(
          sheet,
          0,
          piece * def.frameHeight,
          def.frameWidth,
          def.frameHeight,
          x,
          y,
          cellW,
          cellH,
        );
        ctx.strokeStyle = GRID_LINE;
        ctx.strokeRect(x, y, cellW, cellH);
      });
      y += cellH + PADDING;
    }
  }
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, gore)`);
}

/**
 * The blind-review sheet: for each figure, every row's frames in a strip at 2×
 * on grass, labelled only by a row number, so a reviewer names the animal and
 * the action without being told either.
 */
function renderReview(
  outPath: string,
  entries: readonly CowFigureEntry[],
  scale: number,
  rowFilter: string,
): void {
  const def = entries[0].figure;
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const states = rowNamesFor(entries[0], rowFilter);
  const frameFilter = parseFlag('frame', '');
  const onlyFrames = frameFilter === '' ? null : frameFilter.split(',').map(Number);
  const framesOf = (state: string): number[] => {
    const count = def.states.get(state)?.frames ?? 0;
    const all = Array.from({ length: count }, (_unused, i) => i);
    return onlyFrames === null ? all : all.filter((i) => onlyFrames.includes(i));
  };
  const maxCols = Math.max(...states.map((state) => framesOf(state).length));
  const labelW = 70;
  const { canvas, ctx } = newPanel(
    labelW + maxCols * cellW + PADDING,
    PADDING + entries.length * (states.length * cellH + LABEL_HEIGHT + PADDING),
    GRASS,
  );
  let y = PADDING;
  entries.forEach((entry, figureIndex) => {
    const sheet = bakeFigureSheet(entry.figure, states).canvas;
    ctx.fillStyle = '#10140a';
    ctx.fillText(
      `Animal ${String.fromCharCode(parseFlag('first-letter', 'A').charCodeAt(0) + figureIndex)}`,
      PADDING,
      y + LABEL_HEIGHT - LABEL_BASELINE_INSET,
    );
    y += LABEL_HEIGHT;
    states.forEach((state, index) => {
      ctx.fillStyle = '#1b2210';
      ctx.fillText(`row ${index + 1}`, PADDING, y + cellH / 2 + LABEL_CENTRE_NUDGE);
      framesOf(state).forEach((frame, column) => {
        ctx.drawImage(
          sheet,
          frame * def.frameWidth,
          index * def.frameHeight,
          def.frameWidth,
          def.frameHeight,
          labelW + column * cellW,
          y,
          cellW,
          cellH,
        );
      });
      y += cellH;
    });
    y += PADDING;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, review)`);
}

/**
 * One figure per line, with every chosen (row, frame) cell across it: the
 * side-by-side comparison of the six coats and ages at one moment.
 */
function renderGrid(
  outPath: string,
  entries: readonly CowFigureEntry[],
  scale: number,
  rowFilter: string,
): void {
  const def = entries[0].figure;
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const states = rowNamesFor(entries[0], rowFilter);
  const frameFilter = parseFlag('frame', '0');
  const wanted = frameFilter.split(',').map(Number);
  const cells: Array<readonly [string, number]> = [];
  for (const state of states) {
    const count = def.states.get(state)?.frames ?? 0;
    for (const frame of wanted) if (frame < count) cells.push([state, frame]);
  }
  const { canvas, ctx } = newPanel(
    cells.length * cellW,
    LABEL_HEIGHT + entries.length * cellH,
    GRASS,
  );
  cells.forEach(([state, frame], column) => {
    ctx.fillStyle = '#10140a';
    ctx.fillText(
      `${state}[${frame}]`,
      column * cellW + LABEL_CENTRE_NUDGE,
      LABEL_HEIGHT - LABEL_BASELINE_INSET,
    );
  });
  entries.forEach((entry, line) => {
    cells.forEach(([state, frame], column) => {
      const cell = bakeFigureSheet(entry.figure, [state]).canvas;
      ctx.drawImage(
        cell,
        frame * def.frameWidth,
        0,
        def.frameWidth,
        def.frameHeight,
        column * cellW,
        LABEL_HEIGHT + line * cellH,
        cellW,
        cellH,
      );
    });
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, grid)`);
}

function main(): void {
  if (!hasFlag('skip-gates')) {
    console.log('Gating the cow figures…');
    reportFigureGates('cow', cowGateFailures());
  }
  const mode = parseMode();
  const entries = entriesFor(parseFlag('figure', ''));
  const rowFilter = parseFlag('row', '');
  const out = parseFlag('out', '');
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  if (mode === 'sheet' || mode === 'all') {
    const sheetScale = mode === 'all' ? REVIEW_SCALE : scale;
    for (const entry of entries) {
      const path =
        out !== '' && entries.length === 1 ? out : `${PREVIEW_DIR}/cow-${entry.figure.id}.png`;
      renderFigureSheet(entry, path, sheetScale, rowFilter);
    }
  }
  if (mode === 'ingame' || mode === 'all') {
    renderInGame(
      out !== '' && mode === 'ingame' ? out : `${PREVIEW_DIR}/cow-ingame.png`,
      entries,
      rowFilter,
    );
  }
  if (mode === 'gore' || mode === 'all') {
    renderGore(out !== '' && mode === 'gore' ? out : `${PREVIEW_DIR}/cow-gore.png`, entries);
  }
  if (mode === 'grid') {
    renderGrid(out !== '' ? out : `${PREVIEW_DIR}/cow-grid.png`, entries, scale, rowFilter);
  }
  if (mode === 'review') {
    renderReview(out !== '' ? out : `${PREVIEW_DIR}/cow-review.png`, entries, scale, rowFilter);
  }
}

main();
