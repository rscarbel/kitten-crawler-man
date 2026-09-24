/**
 * The fairies' review harness.
 *
 * Art has to be judged as an image, by something that only looks at the image:
 * every defect that has ever mattered on a figure in this project was invisible
 * to typecheck, to lint and to reading the drawing code. Every panel is painted
 * from the kind's `FigureDef` the way the runtime cache bakes it, and the art
 * gates run first, so one command answers both "does it still hold together"
 * and "what does it look like".
 *
 *   npm run render:fairy                                  every kind, contact sheets + strip
 *   npx tsx scripts/render-fairy.ts --kind=ice --scale=4  one kind's sheet
 *   npx tsx scripts/render-fairy.ts --kind=fire --row=cast_lob --scale=6
 *   npx tsx scripts/render-fairy.ts --mode=strip32        every kind and row at 32 px, on three floors
 *   npx tsx scripts/render-fairy.ts --mode=lineup         the five kinds side by side, hover frame 0
 *   npx tsx scripts/render-fairy.ts --mode=onion --kind=healer --row=hover
 *   --out=<path>   write somewhere other than preview/ (a scratchpad, for a review loop)
 *   --no-gates     skip the gates (a review loop that already ran them)
 */

import { type Canvas, createCanvas } from 'canvas';

import { paintFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { fairyGateFailures } from './gates-fairy.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  FAIRY_VIEWS,
  TILE_SCALE,
  fairyFigureOf,
  fairyStateName,
} from '../src/sprites/art/fairyFigure.js';
import {
  FAIRY_KINDS,
  type FairyKind,
  type FairyRow,
  fairyRowFrames,
  fairyRowsOf,
} from '../src/sprites/art/fairyTiming.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_DENSITY = IN_GAME_TILE / TILE_SCALE;
const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 18;
const PADDING = 6;
const BACKDROP = '#3b3b40';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.3)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '12px sans-serif';
/** The strip's zoomed copy, nearest-neighbour, so single pixels can be read. */
const STRIP_ZOOM = 2;
const ONION_ALPHA = 0.35;
const LABEL_COLUMN_WIDTH = 170;
/** Wide enough for "row 12" and nothing that names the row. */
const BLIND_LABEL_COLUMN_WIDTH = 40;

/**
 * The floors a fairy has to read against: the darkest dungeon floor, a
 * mid-value floor-one flagstone, floor two's pale terrazzo, and snow, the
 * brightest ground a floor-three fairy crosses, where a white body and a grey
 * smoke puff live or die on their outlines.
 */
const REVIEW_FLOORS: readonly { readonly name: string; readonly color: string }[] = [
  { name: 'dungeon', color: '#191720' },
  { name: 'flagstone', color: '#7e7463' },
  { name: 'terrazzo', color: '#b1b3b0' },
  { name: 'snow', color: '#e6ebef' },
];

type Mode = 'sheet' | 'strip32' | 'lineup' | 'onion' | 'tiny';
const MODES: readonly Mode[] = ['sheet', 'strip32', 'lineup', 'onion', 'tiny'];
/** How far the tiny mode blows up each 32 px cell, nearest-neighbour. */
const TINY_ZOOM = 4;

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

function parseKinds(): readonly FairyKind[] {
  const raw = parseFlag('kind', '');
  if (raw === '') return FAIRY_KINDS;
  const wanted = raw.split(',');
  const kinds = FAIRY_KINDS.filter((kind) => wanted.includes(kind));
  if (kinds.length !== wanted.length) {
    throw new Error(`--kind=${raw} names a kind not in ${FAIRY_KINDS.join(', ')}`);
  }
  return kinds;
}

function rowsFor(kind: FairyKind): readonly FairyRow[] {
  const raw = parseFlag('row', '');
  const rows = fairyRowsOf(kind);
  if (raw === '') return rows;
  const wanted = raw.split(',');
  return rows.filter((row) => wanted.includes(row));
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

function outPath(fallbackName: string): string {
  return parseFlag('out', `${PREVIEW_DIR}/${fallbackName}`);
}

// ── Sheet ────────────────────────────────────────────────────────────────────

function renderSheet(kind: FairyKind, scale: number, path: string): void {
  const figure = fairyFigureOf(kind);
  const { frameWidth, frameHeight } = figure;
  const states = rowsFor(kind).flatMap((row) =>
    FAIRY_VIEWS.map((view) => ({ row, view, name: fairyStateName(row, view) })),
  );
  if (states.length === 0) throw new Error(`no rows of ${kind} match --row`);
  const cellW = frameWidth * scale;
  const cellH = frameHeight * scale;
  const maxCols = Math.max(...states.map((s) => fairyRowFrames(s.row)));
  const { canvas, ctx } = newPanel(
    PADDING + maxCols * (cellW + PADDING),
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING),
  );
  let y = PADDING;
  for (const state of states) {
    const frames = fairyRowFrames(state.row);
    label(ctx, `${kind} ${state.name} — ${frames} frames`, PADDING, y);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      const cell = paintFigureCell(figure, state.name, frame, scale);
      ctx.drawImage(cell, x, y);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + figure.tileX * scale,
        y + figure.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    }
    y += cellH + PADDING;
  }
  writePreviewPng(path, canvas.toBuffer('image/png'));
  console.log(`Wrote ${path} (${canvas.width}×${canvas.height}px, ${kind}, scale ${scale}×)`);
}

// ── Strip at in-game size ────────────────────────────────────────────────────

/**
 * Every row of every requested kind at the real 32 px tile, first frame to
 * last, on each review floor, with a nearest-neighbour zoom underneath. The
 * primary realism judgement: review-scale beauty that dies at 32 px counts for
 * nothing. Labels are optional so a blind reviewer can be handed the strip
 * without the answers written on it.
 */
function renderStrip(kinds: readonly FairyKind[], path: string, labelled: boolean): void {
  const sample = fairyFigureOf(kinds[0]);
  const cellW = Math.ceil(sample.frameWidth * IN_GAME_DENSITY);
  const cellH = Math.ceil(sample.frameHeight * IN_GAME_DENSITY);
  const view = parseFlag('view', 'front');
  const views = FAIRY_VIEWS.filter((v) => view === 'all' || v === view);
  const rows: { kind: FairyKind; row: FairyRow; state: string }[] = [];
  for (const kind of kinds) {
    for (const row of rowsFor(kind)) {
      for (const v of views) rows.push({ kind, row, state: fairyStateName(row, v) });
    }
  }
  const maxFrames = Math.max(...rows.map((r) => fairyRowFrames(r.row)));
  const floorBandH = cellH * (1 + STRIP_ZOOM) + PADDING;
  const labelW = labelled ? LABEL_COLUMN_WIDTH : BLIND_LABEL_COLUMN_WIDTH;
  const width = labelW + REVIEW_FLOORS.length * (maxFrames * cellW * STRIP_ZOOM + PADDING * 2);
  const { canvas, ctx } = newPanel(width, PADDING + rows.length * (floorBandH + PADDING));
  ctx.imageSmoothingEnabled = false;
  let y = PADDING;
  rows.forEach((entry, index) => {
    label(ctx, labelled ? `${entry.kind} ${entry.state}` : `row ${index + 1}`, PADDING, y);
    const frames = fairyRowFrames(entry.row);
    const figure = fairyFigureOf(entry.kind);
    REVIEW_FLOORS.forEach((floor, floorIndex) => {
      const bandX = labelW + floorIndex * (maxFrames * cellW * STRIP_ZOOM + PADDING * 2);
      ctx.fillStyle = floor.color;
      ctx.fillRect(bandX, y, frames * cellW * STRIP_ZOOM, floorBandH - PADDING);
      for (let frame = 0; frame < frames; frame++) {
        const cell = paintFigureCell(figure, entry.state, frame, IN_GAME_DENSITY);
        ctx.drawImage(cell, bandX + frame * cellW, y);
        ctx.drawImage(
          cell,
          bandX + frame * cellW * STRIP_ZOOM,
          y + cellH,
          cellW * STRIP_ZOOM,
          cellH * STRIP_ZOOM,
        );
      }
    });
    y += floorBandH + PADDING;
  });
  writePreviewPng(path, canvas.toBuffer('image/png'));
  console.log(`Wrote ${path} (${canvas.width}×${canvas.height}px, 32 px strip)`);
}

// ── Line-up ──────────────────────────────────────────────────────────────────

function renderLineup(kinds: readonly FairyKind[], scale: number, path: string): void {
  const sample = fairyFigureOf(kinds[0]);
  const cellW = sample.frameWidth * scale;
  const cellH = sample.frameHeight * scale;
  const wanted = parseFlag('view', 'all');
  const views = FAIRY_VIEWS.filter((v) => wanted === 'all' || v === wanted);
  const { canvas, ctx } = newPanel(
    PADDING + views.length * kinds.length * (cellW + PADDING),
    PADDING * 2 + LABEL_HEIGHT + cellH,
  );
  let x = PADDING;
  for (const view of views) {
    for (const kind of kinds) {
      label(ctx, `${kind} ${view}`, x, PADDING);
      const cell = paintFigureCell(fairyFigureOf(kind), fairyStateName('hover', view), 0, scale);
      ctx.drawImage(cell, x, PADDING + LABEL_HEIGHT);
      x += cellW + PADDING;
    }
  }
  writePreviewPng(path, canvas.toBuffer('image/png'));
  console.log(`Wrote ${path} (${canvas.width}×${canvas.height}px, line-up)`);
}

// ── Tiny ─────────────────────────────────────────────────────────────────────

/**
 * One frame of every requested kind and view at the in-game 32 px size, blown
 * up nearest-neighbour on each review floor: the in-game pixels, big enough to
 * point at.
 */
function renderTiny(kinds: readonly FairyKind[], path: string): void {
  const row = rowsFor(kinds[0])[0] ?? 'hover';
  const frame = parseNumberFlag('frame', 0, 0, fairyRowFrames(row) - 1);
  const sample = fairyFigureOf(kinds[0]);
  const cellW = Math.ceil(sample.frameWidth * IN_GAME_DENSITY);
  const cellH = Math.ceil(sample.frameHeight * IN_GAME_DENSITY);
  const columns = kinds.length * FAIRY_VIEWS.length;
  const { canvas, ctx } = newPanel(
    PADDING + columns * (cellW * TINY_ZOOM + PADDING),
    PADDING + REVIEW_FLOORS.length * (cellH * TINY_ZOOM + PADDING),
  );
  ctx.imageSmoothingEnabled = false;
  REVIEW_FLOORS.forEach((floor, floorIndex) => {
    const y = PADDING + floorIndex * (cellH * TINY_ZOOM + PADDING);
    let x = PADDING;
    for (const kind of kinds) {
      for (const view of FAIRY_VIEWS) {
        ctx.fillStyle = floor.color;
        ctx.fillRect(x, y, cellW * TINY_ZOOM, cellH * TINY_ZOOM);
        const cell = paintFigureCell(
          fairyFigureOf(kind),
          fairyStateName(row, view),
          frame,
          IN_GAME_DENSITY,
        );
        ctx.drawImage(cell, x, y, cellW * TINY_ZOOM, cellH * TINY_ZOOM);
        x += cellW * TINY_ZOOM + PADDING;
      }
    }
  });
  writePreviewPng(path, canvas.toBuffer('image/png'));
  console.log(`Wrote ${path} (${canvas.width}×${canvas.height}px, ${row}[${frame}] at 32 px)`);
}

// ── Onion ────────────────────────────────────────────────────────────────────

/** Every frame of a row overlaid at low alpha: a snap or a pop shows as a doubled edge. */
function renderOnion(kind: FairyKind, scale: number, path: string): void {
  const figure = fairyFigureOf(kind);
  const rows = rowsFor(kind);
  const cellW = figure.frameWidth * scale;
  const cellH = figure.frameHeight * scale;
  const { canvas, ctx } = newPanel(
    PADDING + FAIRY_VIEWS.length * (cellW + PADDING),
    PADDING + rows.length * (cellH + LABEL_HEIGHT + PADDING),
  );
  let y = PADDING;
  for (const row of rows) {
    FAIRY_VIEWS.forEach((view, column) => {
      const x = PADDING + column * (cellW + PADDING);
      const state = fairyStateName(row, view);
      label(ctx, `${kind} ${state} onion`, x, y);
      ctx.globalAlpha = ONION_ALPHA;
      for (let frame = 0; frame < fairyRowFrames(row); frame++) {
        ctx.drawImage(paintFigureCell(figure, state, frame, scale), x, y + LABEL_HEIGHT);
      }
      ctx.globalAlpha = 1;
    });
    y += cellH + LABEL_HEIGHT + PADDING;
  }
  writePreviewPng(path, canvas.toBuffer('image/png'));
  console.log(`Wrote ${path} (${canvas.width}×${canvas.height}px, onion)`);
}

function main(): void {
  if (!process.argv.includes('--no-gates')) {
    console.log('Gating the fairy figures…');
    reportFigureGates('fairies', fairyGateFailures());
  }
  const mode = parseMode();
  const kinds = parseKinds();
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  if (mode === 'strip32') {
    renderStrip(kinds, outPath('fairy-strip32.png'), !process.argv.includes('--blind'));
    return;
  }
  if (mode === 'tiny') {
    renderTiny(kinds, outPath('fairy-tiny.png'));
    return;
  }
  if (mode === 'lineup') {
    renderLineup(kinds, scale, outPath('fairy-lineup.png'));
    return;
  }
  if (mode === 'onion') {
    for (const kind of kinds) renderOnion(kind, scale, outPath(`fairy-${kind}-onion.png`));
    return;
  }
  for (const kind of kinds) {
    const fallback = `fairy-${kind}-review.png`;
    const path =
      kinds.length === 1 ? outPath(fallback) : `${parseFlag('out-dir', PREVIEW_DIR)}/${fallback}`;
    renderSheet(kind, scale, path);
  }
  renderStrip(kinds, `${parseFlag('out-dir', PREVIEW_DIR)}/fairy-strip32.png`, true);
}

main();
