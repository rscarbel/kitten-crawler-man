#!/usr/bin/env tsx
/**
 * The Troglodyte review harness.
 *
 * Art has to be reviewed as an image, by something that only looks at the
 * image: every defect that has ever mattered on a figure in this project was
 * invisible to `typecheck`, `lint` and reading the drawing code, and visible
 * within seconds in a render. This is how that render gets made.
 *
 * The contact sheet is painted from `TROGLODYTE_FIGURE` and
 * `TROGLODYTE_TONGUE_FIGURE` the way the runtime cache bakes them, and the art
 * gates run as part of the render, so one command answers both "does it still
 * hold together" and "what does it look like".
 *
 *   npm run render:troglodyte
 *   npx tsx scripts/render-troglodyte.ts --row=lash_side --scale=5
 *   npx tsx scripts/render-troglodyte.ts --mode=parts --part=head --scale=4
 *   npx tsx scripts/render-troglodyte.ts --mode=gore
 *   npx tsx scripts/render-troglodyte.ts --mode=tongue
 *   npx tsx scripts/render-troglodyte.ts --mode=onion --row=walk_side
 *   npx tsx scripts/render-troglodyte.ts --mode=delta --row=walk_side
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as Ctx } from 'canvas';

import { bakeFigureSheet, type FigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { troglodyteGateFailures } from './gates-troglodyte.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  GORE_STATES,
  TILE_SCALE,
  TONGUE_FRAMES,
  TONGUE_STATE,
  TROGLODYTE_FIGURE,
  TROGLODYTE_ROWS,
  TROGLODYTE_TONGUE_FIGURE,
} from '../src/sprites/art/troglodyteFigure.js';

const MODES = ['sheet', 'parts', 'gore', 'tongue', 'onion', 'delta'] as const;
type Mode = (typeof MODES)[number];

/** The size the sprite actually renders at in game. */
const IN_GAME_TILE = 32;
const BACKDROP = '#2b2f2c';
const GRID_INK = 'rgba(255,255,255,0.09)';
const TILE_GUIDE = 'rgba(80,220,255,0.55)';
const LABEL_INK = '#e6ede6';
const LABEL_FONT = '13px sans-serif';
const CAPTION_FONT = '12px sans-serif';
const LABEL_GUTTER = 132;
const ROW_GAP = 8;
const PANEL_PAD = 14;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const DEFAULT_SCALE = 2;
/** Comfortably past the longest row, so `--frame` fails loudly on a typo. */
const MAX_FRAME_INDEX = 63;
/** Half a line of type, for nudging a two-line row label apart. */
const LABEL_HALF_LEADING = 8;
const DELTA_BACKDROP = '#0b0d0c';
const IN_GAME_STRIP_FRAMES = 4;
const ANCHOR_MARK_RADIUS = 4;
const STRIP_LABEL_HEIGHT = 20;
const STRIP_LABEL_BASELINE = 10;
const TONGUE_STRIP_SPACING = 0.5;

/**
 * Crops as fractions of the cell, one per body part.
 *
 * A whole-figure contact sheet hides exactly the defects that matter most at
 * these sizes — the head and the hands are where a review always finds the
 * most, and on this creature the head is nearly the whole read.
 */
interface Crop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const PARTS: Record<string, Crop> = {
  head: { x: 0.22, y: 0.06, w: 0.56, h: 0.46 },
  torso: { x: 0.18, y: 0.34, w: 0.64, h: 0.41 },
  hands: { x: 0.06, y: 0.48, w: 0.88, h: 0.38 },
  legs: { x: 0.18, y: 0.6, w: 0.64, h: 0.39 },
  feet: { x: 0.1, y: 0.75, w: 0.8, h: 0.25 },
};

/** A crop resolved against the figure's declared cell. */
function cropPixels(crop: Crop): Crop {
  const { frameWidth, frameHeight } = TROGLODYTE_FIGURE;
  return {
    x: Math.round(crop.x * frameWidth),
    y: Math.round(crop.y * frameHeight),
    w: Math.round(crop.w * frameWidth),
    h: Math.round(crop.h * frameHeight),
  };
}

interface Options {
  readonly mode: Mode;
  readonly out: string;
  readonly scale: number;
  readonly row: string | null;
  readonly frame: number | null;
  readonly part: string;
}

function parseNumberFlag(raw: string, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number between ${min} and ${max}`);
  }
  return value;
}

function isMode(value: string): value is Mode {
  return MODES.some((mode) => mode === value);
}

function parseArgs(argv: readonly string[]): Options {
  let mode: Mode = 'sheet';
  let out: string | null = null;
  let scale = DEFAULT_SCALE;
  let row: string | null = null;
  let frame: number | null = null;
  let part = 'head';

  for (const arg of argv) {
    const [flag, raw] = arg.split('=');
    if (raw === undefined) continue;
    if (flag === '--mode') {
      if (!isMode(raw)) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
      mode = raw;
    } else if (flag === '--out') out = raw;
    else if (flag === '--scale') scale = parseNumberFlag(raw, 'scale', MIN_SCALE, MAX_SCALE);
    else if (flag === '--row') row = raw;
    else if (flag === '--frame') frame = parseNumberFlag(raw, 'frame', 0, MAX_FRAME_INDEX);
    else if (flag === '--part') part = raw;
  }

  if (!(part in PARTS)) {
    throw new Error(`--part=${part} is not one of ${Object.keys(PARTS).join(', ')}`);
  }
  return { mode, out: out ?? `${PREVIEW_DIR}/trog-${mode}.png`, scale, row, frame, part };
}

function label(ctx: Ctx, text: string, x: number, y: number, font = LABEL_FONT): void {
  ctx.fillStyle = LABEL_INK;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** The animation rows, filtered by `--row` if one was named. */
function chosenRows(options: Options): typeof TROGLODYTE_ROWS {
  if (options.row === null) return TROGLODYTE_ROWS;
  const named = TROGLODYTE_ROWS.filter((spec) => spec.name === options.row);
  if (named.length === 0) {
    throw new Error(
      `--row=${options.row} is not an animation row; try ` +
        TROGLODYTE_ROWS.map((spec) => spec.name).join(', '),
    );
  }
  return named;
}

/** The cells of the named states, laid out one state per sheet row. */
function bakedRows(states: readonly string[]): FigureSheet {
  return bakeFigureSheet(TROGLODYTE_FIGURE, [...states]);
}

function blitCell(
  ctx: Ctx,
  sheet: FigureSheet,
  column: number,
  rowIndex: number,
  x: number,
  y: number,
  scale: number,
): void {
  const { frameWidth, frameHeight } = sheet;
  ctx.drawImage(
    sheet.canvas,
    column * frameWidth,
    rowIndex * frameHeight,
    frameWidth,
    frameHeight,
    x,
    y,
    frameWidth * scale,
    frameHeight * scale,
  );
}

function renderSheetPanel(options: Options): Canvas {
  const rows = chosenRows(options);
  const sheet = bakedRows(rows.map((spec) => spec.name));
  const { frameWidth, frameHeight } = sheet;
  const { tileX, tileY } = TROGLODYTE_FIGURE;
  const cellW = frameWidth * options.scale;
  const cellH = frameHeight * options.scale;
  const columns = Math.max(...rows.map((spec) => (options.frame === null ? spec.frameCount : 1)));

  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const stripH = frameHeight * inGameScale + PANEL_PAD * 2;
  const stripW = rows.length * IN_GAME_STRIP_FRAMES * frameWidth * inGameScale;
  // The strip's width does not shrink with `--scale` or with `--frame`, so the
  // panel has to be at least as wide as it is or the check gets cropped away.
  const width = LABEL_GUTTER + Math.max(columns * cellW, stripW) + PANEL_PAD * 2;
  const height = PANEL_PAD * 2 + rows.length * (cellH + ROW_GAP) + stripH;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  rows.forEach((spec, rowIndex) => {
    const y = PANEL_PAD + rowIndex * (cellH + ROW_GAP);
    label(ctx, spec.name, PANEL_PAD, y + cellH / 2 - LABEL_HALF_LEADING);
    label(
      ctx,
      `${spec.frameCount}f ${spec.view}`,
      PANEL_PAD,
      y + cellH / 2 + LABEL_HALF_LEADING,
      CAPTION_FONT,
    );

    const frames =
      options.frame === null
        ? Array.from({ length: spec.frameCount }, (_unused, f) => f)
        : [Math.min(options.frame, spec.frameCount - 1)];
    frames.forEach((frame, column) => {
      const x = LABEL_GUTTER + column * cellW;
      blitCell(ctx, sheet, frame, rowIndex, x, y, options.scale);
      ctx.strokeStyle = GRID_INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
      // The tile the sprite claims to stand on. Registration is invisible
      // without it and wrong registration is invisible with everything else.
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + tileX * options.scale,
        y + tileY * options.scale,
        TILE_SCALE * options.scale,
        TILE_SCALE * options.scale,
      );
    });
  });

  // A silhouette that reads at 4× and dissolves at 32 px is a failure, and this
  // strip is the only place that gets caught before it ships.
  const stripY = PANEL_PAD + rows.length * (cellH + ROW_GAP);
  label(
    ctx,
    `at ${IN_GAME_TILE}px — the size it renders in game`,
    PANEL_PAD,
    stripY + STRIP_LABEL_BASELINE,
  );
  rows.forEach((spec, rowIndex) => {
    const frames = Math.min(spec.frameCount, IN_GAME_STRIP_FRAMES);
    for (let frame = 0; frame < frames; frame++) {
      blitCell(
        ctx,
        sheet,
        frame,
        rowIndex,
        LABEL_GUTTER + (rowIndex * IN_GAME_STRIP_FRAMES + frame) * frameWidth * inGameScale,
        stripY + PANEL_PAD,
        inGameScale,
      );
    }
  });

  return canvas;
}

function renderPartsPanel(options: Options): Canvas {
  const crop = cropPixels(PARTS[options.part]);
  const rows = chosenRows(options);
  const sheet = bakedRows(rows.map((spec) => spec.name));
  const { frameWidth, frameHeight } = sheet;
  const cellW = crop.w * options.scale;
  const cellH = crop.h * options.scale;
  const columns = Math.max(...rows.map((spec) => spec.frameCount));

  const canvas = createCanvas(
    Math.ceil(LABEL_GUTTER + columns * cellW + PANEL_PAD * 2),
    Math.ceil(PANEL_PAD * 2 + rows.length * (cellH + ROW_GAP)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  rows.forEach((spec, rowIndex) => {
    const y = PANEL_PAD + rowIndex * (cellH + ROW_GAP);
    label(ctx, `${spec.name} · ${options.part}`, PANEL_PAD, y + cellH / 2);
    for (let frame = 0; frame < spec.frameCount; frame++) {
      ctx.drawImage(
        sheet.canvas,
        frame * frameWidth + crop.x,
        rowIndex * frameHeight + crop.y,
        crop.w,
        crop.h,
        LABEL_GUTTER + frame * cellW,
        y,
        cellW,
        cellH,
      );
    }
  });
  return canvas;
}

/**
 * The severed pieces at three sizes, ending at the one they actually render at:
 * big enough to judge the drawing, the cell's own size, and the size a player
 * sees.
 */
const GORE_INSPECT_SCALE = 4;
const GORE_SHEET_SCALE = 1;
const GORE_REVIEW_SCALES: readonly number[] = [
  GORE_INSPECT_SCALE,
  GORE_SHEET_SCALE,
  IN_GAME_TILE / TILE_SCALE,
];
/** Vertical stride between the gore panel's three size bands. */
const GORE_BAND_STRIDE = ROW_GAP * 3;
/** Where the "at in-game size" caption sits under its band. */
const GORE_CAPTION_DROP = ROW_GAP * 2;

function renderGorePanel(): Canvas {
  // One state per piece, so the gore "row" is a column walk over the sheet's
  // own rows rather than over one row's frames.
  const sheet = bakedRows(GORE_STATES);
  const { frameWidth, frameHeight } = sheet;
  const pieces = GORE_STATES.length;

  const widest = Math.max(...GORE_REVIEW_SCALES) * frameWidth;
  const canvas = createCanvas(
    Math.ceil(PANEL_PAD * 2 + pieces * widest),
    Math.ceil(
      PANEL_PAD * 2 +
        GORE_REVIEW_SCALES.reduce((sum, scale) => sum + frameHeight * scale + GORE_BAND_STRIDE, 0),
    ),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = PANEL_PAD;
  for (const scale of GORE_REVIEW_SCALES) {
    for (let piece = 0; piece < pieces; piece++) {
      blitCell(ctx, sheet, 0, piece, PANEL_PAD + piece * widest, y, scale);
      if (scale === Math.max(...GORE_REVIEW_SCALES)) {
        label(
          ctx,
          GORE_STATES[piece],
          PANEL_PAD + piece * widest,
          y + frameHeight * scale + ROW_GAP,
          CAPTION_FONT,
        );
      }
    }
    if (scale === Math.min(...GORE_REVIEW_SCALES)) {
      label(
        ctx,
        `at the size it renders in game — name all ${GORE_STATES.length} from this row`,
        PANEL_PAD,
        y + frameHeight * scale + GORE_CAPTION_DROP,
        CAPTION_FONT,
      );
    }
    y += frameHeight * scale + GORE_BAND_STRIDE;
  }
  return canvas;
}

function renderTonguePanel(options: Options): Canvas {
  const sheet = bakeFigureSheet(TROGLODYTE_TONGUE_FIGURE, [TONGUE_STATE]);
  const { frameWidth, frameHeight } = sheet;
  const { tileX, tileY } = TROGLODYTE_TONGUE_FIGURE;
  const cellH = frameHeight * options.scale;
  const inGameScale = IN_GAME_TILE / TILE_SCALE;

  const stripStep = frameHeight * inGameScale * TONGUE_STRIP_SPACING;
  const stripHeight =
    STRIP_LABEL_HEIGHT + (TONGUE_FRAMES - 1) * stripStep + frameHeight * inGameScale;
  const canvas = createCanvas(
    Math.ceil(PANEL_PAD * 2 + LABEL_GUTTER + frameWidth * options.scale),
    Math.ceil(PANEL_PAD * 2 + TONGUE_FRAMES * (cellH + ROW_GAP) + stripHeight),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let frame = 0; frame < TONGUE_FRAMES; frame++) {
    const y = PANEL_PAD + frame * (cellH + ROW_GAP);
    label(ctx, `extend ${frame}`, PANEL_PAD, y + cellH / 2, CAPTION_FONT);
    blitCell(ctx, sheet, frame, 0, LABEL_GUTTER, y, options.scale);
    // The mouth anchor: everything about this figure is wrong if the root of
    // the tongue is not exactly here.
    ctx.strokeStyle = TILE_GUIDE;
    ctx.beginPath();
    ctx.arc(
      LABEL_GUTTER + tileX * options.scale,
      y + tileY * options.scale,
      ANCHOR_MARK_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }

  const stripY = PANEL_PAD + TONGUE_FRAMES * (cellH + ROW_GAP);
  label(ctx, `at ${IN_GAME_TILE}px`, PANEL_PAD, stripY + STRIP_LABEL_BASELINE, CAPTION_FONT);
  for (let frame = 0; frame < TONGUE_FRAMES; frame++) {
    blitCell(
      ctx,
      sheet,
      frame,
      0,
      LABEL_GUTTER,
      stripY + STRIP_LABEL_HEIGHT + frame * stripStep,
      inGameScale,
    );
  }
  return canvas;
}

/**
 * Consecutive frames overlaid at low alpha. A snap or a pop shows as a doubled
 * edge; a smooth motion shows as an even smear.
 */
function renderOnionPanel(options: Options): Canvas {
  const rows = chosenRows(options);
  const sheet = bakedRows(rows.map((spec) => spec.name));
  const cellW = sheet.frameWidth * options.scale;
  const cellH = sheet.frameHeight * options.scale;

  const canvas = createCanvas(
    Math.ceil(LABEL_GUTTER + cellW + PANEL_PAD * 2),
    Math.ceil(PANEL_PAD * 2 + rows.length * (cellH + ROW_GAP)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  rows.forEach((spec, rowIndex) => {
    const y = PANEL_PAD + rowIndex * (cellH + ROW_GAP);
    label(ctx, `${spec.name} onion`, PANEL_PAD, y + cellH / 2, CAPTION_FONT);
    ctx.save();
    ctx.globalAlpha = 1 / spec.frameCount;
    for (let frame = 0; frame < spec.frameCount; frame++) {
      blitCell(ctx, sheet, frame, rowIndex, LABEL_GUTTER, y, options.scale);
    }
    ctx.restore();
  });
  return canvas;
}

/**
 * Per-frame difference against the previous frame, which locates *where* a
 * continuity problem is rather than only that there is one.
 */
function renderDeltaPanel(options: Options): Canvas {
  const rows = chosenRows(options);
  const sheet = bakedRows(rows.map((spec) => spec.name));
  const cellW = sheet.frameWidth * options.scale;
  const cellH = sheet.frameHeight * options.scale;
  const columns = Math.max(...rows.map((spec) => spec.frameCount));

  const canvas = createCanvas(
    Math.ceil(LABEL_GUTTER + columns * cellW + PANEL_PAD * 2),
    Math.ceil(PANEL_PAD * 2 + rows.length * (cellH + ROW_GAP)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = DELTA_BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  rows.forEach((spec, rowIndex) => {
    const y = PANEL_PAD + rowIndex * (cellH + ROW_GAP);
    label(ctx, `${spec.name} delta`, PANEL_PAD, y + cellH / 2, CAPTION_FONT);
    for (let frame = 0; frame < spec.frameCount; frame++) {
      const previous = (frame - 1 + spec.frameCount) % spec.frameCount;
      const x = LABEL_GUTTER + frame * cellW;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      blitCell(ctx, sheet, frame, rowIndex, x, y, options.scale);
      ctx.globalCompositeOperation = 'difference';
      blitCell(ctx, sheet, previous, rowIndex, x, y, options.scale);
      ctx.restore();
    }
  });
  return canvas;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  // Ahead of the contact sheet rather than after it. The sheet is a
  // many-megapixel allocation, and measuring art on the other side of one is
  // what made a sibling figure's centroid gate report a seam at twice its true
  // width every so often — a red gate on art nobody touched, which is the one
  // thing that teaches an agent to loosen a threshold.
  console.log('Gating the troglodyte figure…');
  reportFigureGates('troglodyte', troglodyteGateFailures());

  let panel: Canvas;
  if (options.mode === 'tongue') panel = renderTonguePanel(options);
  else if (options.mode === 'gore') panel = renderGorePanel();
  else if (options.mode === 'parts') panel = renderPartsPanel(options);
  else if (options.mode === 'onion') panel = renderOnionPanel(options);
  else if (options.mode === 'delta') panel = renderDeltaPanel(options);
  else panel = renderSheetPanel(options);

  const outPath = writePreviewPng(options.out, panel.toBuffer('image/png'));
  console.log(`  → ${outPath}  (${panel.width}×${panel.height})`);
}

main();
