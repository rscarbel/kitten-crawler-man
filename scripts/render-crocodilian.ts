/**
 * The Crocodilians' review harness: Bucket Boy, Clarabelle, and the Triage
 * sparkle.
 *
 * Art has to be judged as an image. The contact sheet is painted from the
 * figures the way the runtime cache bakes them, and the art gates run first, so
 * one command answers both "does it still hold together" and "what does it look
 * like".
 *
 *   npm run render:crocodilian
 *   npx tsx scripts/render-crocodilian.ts --figure=clarabelle --row=talk,talk_side --scale=5
 *   npx tsx scripts/render-crocodilian.ts --mode=strip32 --figure=bucket_boy
 *   npx tsx scripts/render-crocodilian.ts --mode=lineup
 *   npx tsx scripts/render-crocodilian.ts --mode=head --figure=bucket_boy --scale=8
 *
 * Modes:
 *   sheet    every row of one figure at `--scale`, with the in-game strip below
 *   strip32  every row at the in-game 32px tile on the club floor, with a 2×
 *            nearest-neighbour copy underneath — the size the silhouette has to
 *            survive
 *   lineup   both crocodilians and Carl side by side at in-game size and 3×, so
 *            their heights can be read against the player's
 *   head     the head crop of the first frame of each view, enlarged
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet, bakeFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { crocodilianGateFailures } from './gates-crocodilian.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  BUCKET_BOY_FIGURE,
  CLARABELLE_FIGURE,
  GROUND_OFFSET_IN_TILE,
  TILE_SCALE,
  TRIAGE_SPARKLE_FIGURE,
  originOf,
  BUCKET_BOY_CELL,
  CLARABELLE_CELL,
} from '../src/sprites/art/crocodilianFigure.js';
import { HUMAN_FIGURE } from '../src/sprites/art/humanFigure.js';
import { BUCKET_BOY_BUILD, CLARABELLE_BUILD } from '../src/sprites/art/crocodilianArt.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;
const NEAREST_ZOOM = 2;
const LINEUP_ZOOM = 3;
/** The head crop, in head heights: the snout runs well forward of the skull. */
const HEAD_CROP_WIDTH_HEADS = 3.4;
const HEAD_CROP_HEIGHT_HEADS = 2;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 12;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
/** Grounds a crocodilian stands on: the club's dark floor first, the harness grey, a warm wood. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#221c26', '#3b3b40', '#5a4636', '#6b6f5a'];
const CLUB_FLOOR = '#221c26';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

type Mode = 'sheet' | 'strip32' | 'lineup' | 'head';
const MODES: ReadonlyArray<Mode> = ['sheet', 'strip32', 'lineup', 'head'];

const FIGURES: ReadonlyMap<string, FigureDef> = new Map([
  ['bucket_boy', BUCKET_BOY_FIGURE],
  ['clarabelle', CLARABELLE_FIGURE],
  ['sparkle', TRIAGE_SPARKLE_FIGURE],
]);

type SheetContext = ReturnType<Canvas['getContext']>;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
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

function parseFigure(): { key: string; def: FigureDef } {
  const key = parseFlag('figure', 'bucket_boy');
  const def = FIGURES.get(key);
  if (def === undefined)
    throw new Error(`--figure=${key} is not one of ${[...FIGURES.keys()].join(', ')}`);
  return { key, def };
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

function frameCountOf(def: FigureDef, state: string): number {
  const declared = def.states.get(state);
  if (declared === undefined) throw new Error(`${def.id} declares no state "${state}"`);
  return declared.frames;
}

function selectedStates(def: FigureDef): string[] {
  const all = [...def.states.keys()];
  const only = parseFlag('row', '');
  if (only === '') return all;
  const wanted = only.split(',');
  const states = all.filter((state) => wanted.includes(state));
  if (states.length === 0) throw new Error(`No row named "${only}" on ${def.id}`);
  return states;
}

/** `--frames=0,4,8` limits a sheet to those frames of each row. */
function selectedFrames(def: FigureDef, state: string): number[] {
  const all = Array.from({ length: frameCountOf(def, state) }, (_unused, frame) => frame);
  const only = parseFlag('frames', '');
  if (only === '') return all;
  const wanted = only.split(',').map(Number);
  return all.filter((frame) => wanted.includes(frame));
}

function renderRows(
  def: FigureDef,
  states: readonly string[],
  outPath: string,
  scale: number,
): void {
  const sheet = bakeFigureSheet(def, [...states]).canvas;
  const { frameWidth, frameHeight } = def;
  const cellW = frameWidth * scale;
  const cellH = frameHeight * scale;
  const maxCols = Math.max(...states.map((state) => selectedFrames(def, state).length));
  const { canvas, ctx } = newPanel(
    PADDING + maxCols * (cellW + PADDING),
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING),
  );
  let y = PADDING;
  states.forEach((state, index) => {
    const frames = frameCountOf(def, state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${state} — ${frames} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    selectedFrames(def, state).forEach((frame, column) => {
      const x = PADDING + column * (cellW + PADDING);
      ctx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
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
 * Every row at the size the game draws it, on the club's floor, and a 2×
 * nearest-neighbour copy underneath so the pixels themselves can be read.
 */
function renderStrip32(def: FigureDef, states: readonly string[], outPath: string): void {
  const sheet = bakeFigureSheet(def, [...states]).canvas;
  const { frameWidth, frameHeight } = def;
  const smallW = frameWidth * IN_GAME_SCALE;
  const smallH = frameHeight * IN_GAME_SCALE;
  const bigW = smallW * NEAREST_ZOOM;
  const bigH = smallH * NEAREST_ZOOM;
  const maxCols = Math.max(...states.map((state) => frameCountOf(def, state)));
  const rowHeight = LABEL_HEIGHT + smallH + bigH + PADDING * 2;
  const { canvas, ctx } = newPanel(
    PADDING + maxCols * (bigW + PADDING),
    PADDING + states.length * rowHeight,
    CLUB_FLOOR,
  );
  let y = PADDING;
  states.forEach((state, index) => {
    const frames = frameCountOf(def, state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(state, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    const small = createCanvas(Math.ceil(smallW), Math.ceil(smallH));
    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (bigW + PADDING);
      const sctx = small.getContext('2d');
      sctx.clearRect(0, 0, small.width, small.height);
      sctx.drawImage(
        sheet,
        frame * frameWidth,
        index * frameHeight,
        frameWidth,
        frameHeight,
        0,
        0,
        smallW,
        smallH,
      );
      ctx.drawImage(small, x, y);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, x, y + smallH + PADDING, bigW, bigH);
      ctx.imageSmoothingEnabled = true;
    }
    y += smallH + bigH + PADDING * 2;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, in-game strip)`);
}

/**
 * Carl, Bucket Boy and Clarabelle on one ground line, first idle frame of each
 * view, so their heights are read against the player's.
 */
function renderLineup(outPath: string): void {
  const entries: ReadonlyArray<{ def: FigureDef; states: readonly string[] }> = [
    { def: HUMAN_FIGURE, states: ['idle', 'idle_side', 'idle_away'] },
    { def: BUCKET_BOY_FIGURE, states: ['idle', 'idle_side', 'idle_away'] },
    { def: CLARABELLE_FIGURE, states: ['idle', 'idle_side', 'idle_away'] },
  ];
  const groundOf = (def: FigureDef): number => def.tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE;
  const headroom = Math.max(...entries.map((e) => groundOf(e.def)));
  const footroom = Math.max(...entries.map((e) => e.def.frameHeight - groundOf(e.def)));
  const cells = entries.flatMap((e) => e.states.map((state) => ({ def: e.def, state })));
  const width = cells.reduce((sum, c) => sum + c.def.frameWidth, 0);
  const height = headroom + footroom;
  const zooms: readonly number[] = [IN_GAME_SCALE, IN_GAME_SCALE * LINEUP_ZOOM];
  const { canvas, ctx } = newPanel(
    PADDING + width * zooms[1] + PADDING,
    PADDING + zooms.reduce((sum, z) => sum + height * z + PADDING, 0),
    CLUB_FLOOR,
  );
  let y = PADDING;
  for (const zoom of zooms) {
    let x = PADDING;
    for (const { def, state } of cells) {
      const cell = bakeFigureCell(def, state, 0);
      const top = y + (headroom - groundOf(def)) * zoom;
      ctx.imageSmoothingEnabled = zoom <= 1;
      ctx.drawImage(cell, x, top, def.frameWidth * zoom, def.frameHeight * zoom);
      x += def.frameWidth * zoom;
    }
    ctx.strokeStyle = TILE_GUIDE;
    ctx.beginPath();
    ctx.moveTo(PADDING, y + headroom * zoom);
    ctx.lineTo(x, y + headroom * zoom);
    ctx.stroke();
    y += height * zoom + PADDING;
  }
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, lineup)`);
}

/** The head of each view's first idle frame, cropped and enlarged. */
function renderHeads(def: FigureDef, outPath: string, scale: number): void {
  const views = ['idle', 'idle_side', 'idle_away'];
  const build = def === CLARABELLE_FIGURE ? CLARABELLE_BUILD : BUCKET_BOY_BUILD;
  const cropW = build.headHeight * HEAD_CROP_WIDTH_HEADS * TILE_SCALE;
  const cropH = build.headHeight * HEAD_CROP_HEIGHT_HEADS * TILE_SCALE;
  const origin = originOf(def === CLARABELLE_FIGURE ? CLARABELLE_CELL : BUCKET_BOY_CELL);
  const headY = origin.y + (build.neckBaseY - build.headRise) * TILE_SCALE;
  const { canvas, ctx } = newPanel(
    PADDING + views.length * (cropW * scale + PADDING),
    PADDING * 2 + cropH * scale,
    CLUB_FLOOR,
  );
  views.forEach((state, i) => {
    const cell = bakeFigureCell(def, state, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      cell,
      origin.x - cropW / 2,
      headY - cropH / 2,
      cropW,
      cropH,
      PADDING + i * (cropW * scale + PADDING),
      PADDING,
      cropW * scale,
      cropH * scale,
    );
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, heads)`);
}

function main(): void {
  if (!hasFlag('skip-gates')) {
    console.log('Gating the crocodilian figures…');
    reportFigureGates('crocodilians', crocodilianGateFailures());
  }
  const mode = parseMode();
  if (mode === 'lineup') {
    renderLineup(parseFlag('out', `${PREVIEW_DIR}/crocodilian-lineup.png`));
    return;
  }
  const { key, def } = parseFigure();
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  if (mode === 'head') {
    renderHeads(def, parseFlag('out', `${PREVIEW_DIR}/crocodilian-${key}-heads.png`), scale);
    return;
  }
  const states = selectedStates(def);
  if (mode === 'strip32') {
    renderStrip32(def, states, parseFlag('out', `${PREVIEW_DIR}/crocodilian-${key}-strip32.png`));
    return;
  }
  renderRows(def, states, parseFlag('out', `${PREVIEW_DIR}/crocodilian-${key}-review.png`), scale);
}

main();
