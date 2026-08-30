/**
 * The Dark Knight review harness.
 *
 * Art has to be judged as an image, by something that only looks at the image:
 * every defect that has ever mattered on a figure in this project was invisible
 * to typecheck, to lint and to reading the drawing code. The contact sheet is
 * painted from `DARK_KNIGHT_FIGURE` the way the runtime cache bakes it, and the
 * art gates run as part of the render, so one command answers both "does it
 * still hold together" and "what does it look like".
 *
 *   npm run render:dark-knight
 *   npx tsx scripts/render-dark-knight.ts --row=slam,slam_side --scale=4
 *   npx tsx scripts/render-dark-knight.ts --mode=parts --part=helm
 *   npx tsx scripts/render-dark-knight.ts --mode=prop
 *   npx tsx scripts/render-dark-knight.ts --mode=gore
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { darkKnightGateFailures } from './gates-dark-knight.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  DARK_KNIGHT_FIGURE,
  DARK_KNIGHT_ROWS,
  GORE_STATES,
  TILE_SCALE,
} from '../src/sprites/art/darkKnightFigure.js';

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
/** The floor tones the knight actually stands on, for the contrast check. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#3b3b40', '#6b5c46', '#243021', '#8a8378'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

type Mode = 'sheet' | 'parts' | 'prop' | 'gore';
const MODES: ReadonlyArray<Mode> = ['sheet', 'parts', 'prop', 'gore'];

type SheetCanvas = ReturnType<Canvas['getContext']>;

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

/**
 * The crops that make a review possible. A whole-figure contact sheet hides
 * exactly the defects that matter most at these sizes — a helm that reads as a
 * bucket, a pauldron that has merged with the arm under it — so each region is
 * pulled out across every frame of a row.
 *
 * Fractions of the cell rather than pixels, so the table survives the figure
 * re-deriving its own cell size.
 */
interface PartCrop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const PART_CROPS: Record<string, PartCrop> = {
  helm: { x: 0.28, y: 0.14, w: 0.44, h: 0.26 },
  torso: { x: 0.16, y: 0.3, w: 0.68, h: 0.3 },
  hands: { x: 0.06, y: 0.34, w: 0.88, h: 0.3 },
  legs: { x: 0.22, y: 0.55, w: 0.56, h: 0.32 },
  feet: { x: 0.2, y: 0.74, w: 0.6, h: 0.22 },
  mace: { x: 0.45, y: 0.1, w: 0.55, h: 0.45 },
};

const POSE_STATES: readonly string[] = DARK_KNIGHT_ROWS.map((row) => row.name);
const { frameWidth, frameHeight } = DARK_KNIGHT_FIGURE;

function backdropFor(index: number): string {
  return FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
}

function frameCountOf(state: string): number {
  const declared = DARK_KNIGHT_FIGURE.states.get(state);
  if (declared === undefined) throw new Error(`the dark knight declares no state "${state}"`);
  return declared.frames;
}

/**
 * One canvas holding the requested states as rows, painted the way the cache
 * bakes them. Row `i` of the returned sheet is `states[i]`.
 */
function sheetOf(states: readonly string[]): Canvas {
  return bakeFigureSheet(DARK_KNIGHT_FIGURE, [...states]).canvas;
}

function newPanel(width: number, height: number): { canvas: Canvas; ctx: SheetCanvas } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  return { canvas, ctx };
}

function renderPartsPanel(outPath: string, partName: string, scale: number): void {
  const crop = PART_CROPS[partName];
  if (crop === undefined) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PART_CROPS).join(', ')}`);
  }
  const sheet = sheetOf(POSE_STATES);
  const cropW = frameWidth * crop.w;
  const cropH = frameHeight * crop.h;
  const cellW = cropW * scale;
  const cellH = cropH * scale;
  const maxCols = Math.max(...POSE_STATES.map((state) => frameCountOf(state)));

  const { canvas, ctx } = newPanel(
    PADDING + maxCols * (cellW + PADDING),
    PADDING + POSE_STATES.length * (cellH + LABEL_HEIGHT + PADDING),
  );

  let y = PADDING;
  POSE_STATES.forEach((state, index) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${state} — ${partName}`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frameCountOf(state); frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = backdropFor(index);
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(
        sheet,
        frame * frameWidth + frameWidth * crop.x,
        index * frameHeight + frameHeight * crop.y,
        cropW,
        cropH,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  });

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, ${partName} crops)`);
}

/**
 * The mace alone, at the three sizes it has to survive. The exit criterion is a
 * blind naming test: shown this strip with no context, the shape has to be
 * called a mace. A distinctness gate proves shapes differ; only a naming test
 * proves they are the right shapes.
 */
const PROP_SCALES: ReadonlyArray<number> = [4, 2, IN_GAME_TILE / TILE_SCALE];

/**
 * The carry frame, plus the slam's raise and the sweep's level pass — the three
 * places the head is fully clear of the body.
 */
const PROP_SAMPLES: ReadonlyArray<readonly [string, number]> = [
  ['idle_side', 0],
  ['walk_side', 4],
  ['sweep_side', 13],
  ['slam_side', 15],
];

function renderPropPanel(outPath: string): void {
  const states = PROP_SAMPLES.map(([state]) => state);
  const sheet = sheetOf(states);
  const crop = PART_CROPS.mace;
  const cropW = frameWidth * crop.w;
  const cropH = frameHeight * crop.h;

  const { canvas, ctx } = newPanel(
    PADDING + PROP_SAMPLES.length * (cropW * Math.max(...PROP_SCALES) + PADDING),
    PADDING + PROP_SCALES.reduce((total, s) => total + cropH * s + LABEL_HEIGHT + PADDING, 0),
  );

  let y = PADDING;
  for (const scale of PROP_SCALES) {
    const cellW = cropW * scale;
    const cellH = cropH * scale;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      scale === Math.min(...PROP_SCALES) ? 'at the size it renders in game' : `${scale}×`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    PROP_SAMPLES.forEach(([, frame], index) => {
      const x = PADDING + index * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        frame * frameWidth + frameWidth * crop.x,
        index * frameHeight + frameHeight * crop.y,
        cropW,
        cropH,
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

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, prop panel)`);
}

/**
 * The severed pieces at the three sizes that matter. The bottom strip is the
 * exit criterion: name all seven from it, or the set has failed.
 */
const GORE_REVIEW_SCALES: ReadonlyArray<number> = [4, 1, IN_GAME_TILE / TILE_SCALE];

function renderGorePanel(outPath: string): void {
  const sheet = sheetOf(GORE_STATES);
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
        ? 'at the size it renders in game — name all seven from this row'
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
  const wanted = only === '' ? [] : only.split(',');
  const states = wanted.length === 0 ? POSE_STATES : POSE_STATES.filter((s) => wanted.includes(s));
  if (states.length === 0) throw new Error(`No row named "${only}"`);
  const sheet = sheetOf(states);

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
    const frames = frameCountOf(state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${state} — ${frames} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = backdropFor(index);
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
        x + DARK_KNIGHT_FIGURE.tileX * scale,
        y + DARK_KNIGHT_FIGURE.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    }
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
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
  const mode = parseMode();
  const outPath = parseFlag(
    'out',
    mode === 'sheet'
      ? `${PREVIEW_DIR}/dark-knight-review.png`
      : `${PREVIEW_DIR}/dark-knight-${mode}.png`,
  );
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);

  // Ahead of the contact sheet rather than after it. The sheet is a
  // tens-of-megapixel allocation, and measuring the art on the other side of
  // one made the pilot's centroid gate report a seam at twice its true width
  // every so often — a red gate on art nobody touched, which is the one thing
  // that teaches an agent to loosen a threshold.
  console.log('Gating the dark knight figure…');
  reportFigureGates('dark_knight', darkKnightGateFailures());

  if (mode === 'parts') {
    renderPartsPanel(outPath, parseFlag('part', 'helm'), scale);
    return;
  }
  if (mode === 'gore') {
    renderGorePanel(outPath);
    return;
  }
  if (mode === 'prop') {
    renderPropPanel(outPath);
    return;
  }
  renderSheetPanel(outPath, scale, parseFlag('row', ''));
}

main();
