/**
 * The Brindled Vespa's review harness.
 *
 * Art has to be judged as an image, by something that only looks at the image:
 * every defect that has ever mattered on a figure in this project was invisible
 * to typecheck, to lint and to reading the drawing code. The contact sheet is
 * painted from `BRINDLED_VESPA_FIGURE` the way the runtime cache bakes it, and the art
 * gates run as part of the render, so one command answers both "does it still
 * hold together" and "what does it look like".
 *
 *   npm run render:vespa
 *   npx tsx scripts/render-vespa.ts --row=spit_windup_side --scale=4
 *   npx tsx scripts/render-vespa.ts --mode=gore
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { vespaGateFailures } from './gates-vespa.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  GORE_STATES,
  BRINDLED_VESPA_FIGURE,
  BRINDLED_VESPA_ROWS,
  TILE_SCALE,
} from '../src/sprites/art/brindledVespaFigure.js';

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const DUNGEON_FLOOR = '#191720';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

type Mode = 'sheet' | 'gore';
const MODES: ReadonlyArray<Mode> = ['sheet', 'gore'];

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

function frameCountOf(state: string): number {
  const declared = BRINDLED_VESPA_FIGURE.states.get(state);
  if (declared === undefined) throw new Error(`the brindled vespa declares no state "${state}"`);
  return declared.frames;
}

/**
 * The severed pieces at the three sizes that matter. The bottom strip is the
 * exit criterion: name all eight from it, or the set has failed.
 */
const GORE_REVIEW_SCALES: ReadonlyArray<number> = [4, 1, IN_GAME_TILE / TILE_SCALE];

function renderGorePanel(outPath: string): void {
  const { frameWidth, frameHeight } = BRINDLED_VESPA_FIGURE;
  const sheet = bakeFigureSheet(BRINDLED_VESPA_FIGURE, [...GORE_STATES]).canvas;
  const pieceCount = GORE_STATES.length;
  const widths = GORE_REVIEW_SCALES.map((scale) => frameWidth * scale);

  const { canvas, ctx } = newPanel(
    PADDING + Math.max(...widths.map((w) => pieceCount * (w + PADDING))),
    PADDING +
      GORE_REVIEW_SCALES.reduce(
        (total, scale) => total + frameHeight * scale + LABEL_HEIGHT + PADDING,
        0,
      ),
  );

  let y = PADDING;
  for (const scale of GORE_REVIEW_SCALES) {
    const cellW = frameWidth * scale;
    const cellH = frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      scale === Math.min(...GORE_REVIEW_SCALES)
        ? 'at the size it renders in game — name all eight from this row'
        : `${scale}×`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    GORE_STATES.forEach((state, piece) => {
      const x = PADDING + piece * (cellW + PADDING);
      ctx.drawImage(sheet, 0, piece * frameHeight, frameWidth, frameHeight, x, y, cellW, cellH);
      if (scale === Math.max(...GORE_REVIEW_SCALES)) {
        ctx.fillStyle = LABEL_COLOR;
        ctx.fillText(state, x, y + cellH + LABEL_HEIGHT - PADDING);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    });
    y += cellH + PADDING;
  }

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, gore panel)`);
}

function renderSheetPanel(outPath: string, scale: number, only: string): void {
  const { frameWidth, frameHeight } = BRINDLED_VESPA_FIGURE;
  const poseStates = BRINDLED_VESPA_ROWS.map((row) => row.name);
  const wanted = only === '' ? [] : only.split(',');
  const states = wanted.length === 0 ? poseStates : poseStates.filter((s) => wanted.includes(s));
  if (states.length === 0) throw new Error(`No row named "${only}"`);
  const sheet = bakeFigureSheet(BRINDLED_VESPA_FIGURE, states).canvas;

  const cellW = frameWidth * scale;
  const cellH = frameHeight * scale;
  const maxCols = Math.max(...states.map((state) => frameCountOf(state)));
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const inGameW = frameWidth * inGameScale;
  const inGameH = frameHeight * inGameScale;

  const stripWidth = PADDING + states.length * (inGameW + PADDING);
  const { canvas, ctx } = newPanel(
    Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth),
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING),
  );

  let y = PADDING;
  states.forEach((state, index) => {
    const row = BRINDLED_VESPA_ROWS.find((candidate) => candidate.name === state);
    const frames = frameCountOf(state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${state} — ${frames} frames, ${row?.view ?? '?'}, ${row?.kind ?? '?'}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
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
        x + BRINDLED_VESPA_FIGURE.tileX * scale,
        y + BRINDLED_VESPA_FIGURE.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    }
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    `in-game size (${IN_GAME_TILE}px tile), on the dungeon floor`,
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;
  ctx.fillStyle = DUNGEON_FLOOR;
  ctx.fillRect(0, y, canvas.width, inGameH);
  states.forEach((_state, index) => {
    ctx.drawImage(
      sheet,
      0,
      index * frameHeight,
      frameWidth,
      frameHeight,
      PADDING + index * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  });

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

function main(): void {
  // Ahead of the contact sheet rather than after it. The sheet is a
  // tens-of-megapixel allocation, and measuring the art on the other side of one
  // made the pilot's centroid gate report a seam at twice its true width every
  // so often — a red gate on art nobody touched, which is the one thing that
  // teaches an agent to loosen a threshold.
  console.log('Gating the brindled vespa figure…');
  reportFigureGates('brindled_vespa', vespaGateFailures());

  const mode = parseMode();
  const outPath = parseFlag(
    'out',
    mode === 'sheet' ? `${PREVIEW_DIR}/vespa-review.png` : `${PREVIEW_DIR}/vespa-gore.png`,
  );
  if (mode === 'gore') {
    renderGorePanel(outPath);
    return;
  }
  renderSheetPanel(
    outPath,
    parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE),
    parseFlag('row', ''),
  );
}

main();
