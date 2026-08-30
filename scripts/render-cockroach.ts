#!/usr/bin/env tsx
/**
 * Review harness for the cockroach.
 *
 * Art has to be reviewed as an image, by something that only looks at the image:
 * every defect that has ever mattered on a figure in this project was invisible
 * to `typecheck`, `lint` and reading the drawing code, and visible within
 * seconds in a render. This is how that render gets made.
 *
 * The contact sheet is painted from `COCKROACH_FIGURE` the way the runtime cache
 * bakes it, and the art gates run as part of the render — ahead of the sheet, so
 * nothing is measured on the far side of a many-megapixel allocation.
 *
 *   npm run render:cockroach
 *   npx tsx scripts/render-cockroach.ts --mode=parts --part=shield --scale=6
 *   npx tsx scripts/render-cockroach.ts --mode=gore
 *   npx tsx scripts/render-cockroach.ts --mode=onion --row=skitter_side
 *   npx tsx scripts/render-cockroach.ts --mode=delta --row=skitter_side
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as Ctx } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { cockroachGateFailures } from './gates-cockroach.js';
import {
  COCKROACH_FIGURE,
  GORE_STATES,
  ROWS,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/cockroachFigure.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

const MODES = ['sheet', 'parts', 'gore', 'onion', 'delta'] as const;
type Mode = (typeof MODES)[number];

/** The size the sprite actually renders at in game. */
const IN_GAME_TILE = 32;
const BACKDROP = '#2b2f2c';
const DELTA_BACKDROP = '#0b0d0c';
const GRID_INK = 'rgba(255,255,255,0.09)';
const TILE_GUIDE = 'rgba(80,220,255,0.55)';
const CENTRE_GUIDE = 'rgba(255,120,90,0.7)';
const LABEL_INK = '#e6ede6';
const LABEL_FONT = '13px sans-serif';
const CAPTION_FONT = '12px sans-serif';
const LABEL_GUTTER = 132;
const ROW_GAP = 8;
const PANEL_PAD = 14;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const DEFAULT_SCALE = 3;
/** Comfortably past the longest row, so `--frame` fails loudly on a typo. */
const MAX_FRAME_INDEX = 63;
/** Half a line of type, for nudging a two-line row label apart. */
const LABEL_HALF_LEADING = 8;
const CENTRE_MARK_RADIUS = 3;
const STRIP_LABEL_HEIGHT = 20;
const STRIP_LABEL_BASELINE = 10;
const IN_GAME_STRIP_FRAMES = 4;

const { frameWidth, frameHeight, tileX, tileY } = COCKROACH_FIGURE;

/**
 * Every row of the contact sheet: the pose rows in the figure's own order, then
 * one row per gore piece.
 */
const POSE_STATES: readonly string[] = ROWS.map((row) => row.name);
const SHEET_STATES: readonly string[] = [...POSE_STATES, ...GORE_STATES];
const SHEET_ROW_OF: ReadonlyMap<string, number> = new Map(
  SHEET_STATES.map((state, index) => [state, index]),
);

function sheetRowOf(state: string): number {
  const index = SHEET_ROW_OF.get(state);
  if (index === undefined) throw new Error(`the cockroach paints no state "${state}"`);
  return index;
}

/**
 * Crops as fractions of the cell, one per body region.
 *
 * A whole-animal contact sheet hides exactly the defect that matters most here:
 * the pronotum's mark is five screen pixels across in game and it is the entire
 * species identification, so it gets its own crop.
 *
 * The crops are **positions in the cell**, not body parts, because which end of
 * the cell the head is in depends on the view: `back` and `side` put it at the
 * top and the right, `front` puts it at the bottom.
 */
interface Crop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const PARTS: Record<string, Crop> = {
  shield: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
  headAway: { x: 0.24, y: 0.14, w: 0.52, h: 0.34 },
  headToward: { x: 0.24, y: 0.52, w: 0.52, h: 0.34 },
  legs: { x: 0.08, y: 0.22, w: 0.84, h: 0.56 },
  antennae: { x: 0.02, y: 0.02, w: 0.96, h: 0.96 },
  whole: { x: 0, y: 0, w: 1, h: 1 },
};

function cropPixels(crop: Crop): Crop {
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
  let part = 'shield';

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
  return { mode, out: out ?? `${PREVIEW_DIR}/roach-${mode}.png`, scale, row, frame, part };
}

function label(ctx: Ctx, text: string, x: number, y: number, font = LABEL_FONT): void {
  ctx.fillStyle = LABEL_INK;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** The animation rows, filtered by `--row` if one was named. */
function chosenRows(options: Options): readonly RowSpec[] {
  if (options.row === null) return ROWS;
  const named = ROWS.filter((spec) => spec.name === options.row);
  if (named.length === 0) {
    throw new Error(
      `--row=${options.row} is not an animation row; try ${ROWS.map((r) => r.name).join(', ')}`,
    );
  }
  return named;
}

function blitCell(
  ctx: Ctx,
  image: Canvas,
  column: number,
  rowIndex: number,
  x: number,
  y: number,
  scale: number,
): void {
  ctx.drawImage(
    image,
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

function renderSheetPanel(image: Canvas, options: Options): Canvas {
  const rows = chosenRows(options);
  const cellW = frameWidth * options.scale;
  const cellH = frameHeight * options.scale;
  const columns = Math.max(...rows.map((spec) => (options.frame === null ? spec.frameCount : 1)));

  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const stripH = frameHeight * inGameScale + PANEL_PAD * 2 + STRIP_LABEL_HEIGHT;
  const stripW = rows.length * IN_GAME_STRIP_FRAMES * frameWidth * inGameScale;
  // The strip's width does not shrink with `--scale` or with `--frame`, so the
  // panel has to be at least as wide as it is or the check gets cropped away.
  const width = LABEL_GUTTER + Math.max(columns * cellW, stripW) + PANEL_PAD * 2;
  const height = PANEL_PAD * 2 + rows.length * (cellH + ROW_GAP) + stripH;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  rows.forEach((spec, i) => {
    const rowIndex = sheetRowOf(spec.name);
    const y = PANEL_PAD + i * (cellH + ROW_GAP);
    label(ctx, spec.name, PANEL_PAD, y + cellH / 2 - LABEL_HALF_LEADING);
    label(
      ctx,
      `${spec.frameCount}f ${spec.view} ${spec.kind}`,
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
      blitCell(ctx, image, frame, rowIndex, x, y, options.scale);
      ctx.strokeStyle = GRID_INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
      // The tile the sprite claims to occupy, and the anchor at its centre.
      // Registration is invisible without them and wrong registration is
      // invisible with everything else.
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + tileX * options.scale,
        y + tileY * options.scale,
        TILE_SCALE * options.scale,
        TILE_SCALE * options.scale,
      );
      ctx.strokeStyle = CENTRE_GUIDE;
      ctx.beginPath();
      ctx.arc(x + cellW / 2, y + cellH / 2, CENTRE_MARK_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    });
  });

  // A silhouette that reads at 4x and dissolves at 32 px is a failure, and this
  // strip is the only place that gets caught before it ships.
  const stripY = PANEL_PAD + rows.length * (cellH + ROW_GAP);
  label(
    ctx,
    `at ${IN_GAME_TILE}px — the size it renders in game`,
    PANEL_PAD,
    stripY + STRIP_LABEL_BASELINE,
  );
  rows.forEach((spec, i) => {
    const rowIndex = sheetRowOf(spec.name);
    const frames = Math.min(spec.frameCount, IN_GAME_STRIP_FRAMES);
    for (let frame = 0; frame < frames; frame++) {
      blitCell(
        ctx,
        image,
        frame,
        rowIndex,
        LABEL_GUTTER + (i * IN_GAME_STRIP_FRAMES + frame) * frameWidth * inGameScale,
        stripY + STRIP_LABEL_HEIGHT,
        inGameScale,
      );
    }
  });

  return canvas;
}

function renderPartsPanel(image: Canvas, options: Options): Canvas {
  const crop = cropPixels(PARTS[options.part]);
  const rows = chosenRows(options);
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

  rows.forEach((spec, i) => {
    const rowIndex = sheetRowOf(spec.name);
    const y = PANEL_PAD + i * (cellH + ROW_GAP);
    label(ctx, `${spec.name} · ${options.part}`, PANEL_PAD, y + cellH / 2, CAPTION_FONT);
    for (let frame = 0; frame < spec.frameCount; frame++) {
      ctx.drawImage(
        image,
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
 * The gore pieces at three sizes, ending at the one they actually render at: big
 * enough to judge the drawing, the cell's own size, and the size a player sees.
 */
const GORE_INSPECT_SCALE = 4;
const GORE_SHEET_SCALE = 1;
const GORE_REVIEW_SCALES: readonly number[] = [
  GORE_INSPECT_SCALE,
  GORE_SHEET_SCALE,
  IN_GAME_TILE / TILE_SCALE,
];
const GORE_BAND_STRIDE = ROW_GAP * 3;
const GORE_CAPTION_DROP = ROW_GAP * 2;

function renderGorePanel(image: Canvas): Canvas {
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
    GORE_STATES.forEach((state, piece) => {
      blitCell(ctx, image, 0, sheetRowOf(state), PANEL_PAD + piece * widest, y, scale);
      if (scale === Math.max(...GORE_REVIEW_SCALES)) {
        label(
          ctx,
          state,
          PANEL_PAD + piece * widest,
          y + frameHeight * scale + ROW_GAP,
          CAPTION_FONT,
        );
      }
    });
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

/**
 * Consecutive frames overlaid at low alpha. A snap or a pop shows as a doubled
 * edge; a smooth motion shows as an even smear.
 */
function renderOnionPanel(image: Canvas, options: Options): Canvas {
  const rows = chosenRows(options);
  const cellW = frameWidth * options.scale;
  const cellH = frameHeight * options.scale;

  const canvas = createCanvas(
    Math.ceil(LABEL_GUTTER + cellW + PANEL_PAD * 2),
    Math.ceil(PANEL_PAD * 2 + rows.length * (cellH + ROW_GAP)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  rows.forEach((spec, i) => {
    const rowIndex = sheetRowOf(spec.name);
    const y = PANEL_PAD + i * (cellH + ROW_GAP);
    label(ctx, `${spec.name} onion`, PANEL_PAD, y + cellH / 2, CAPTION_FONT);
    ctx.save();
    ctx.globalAlpha = 1 / spec.frameCount;
    for (let frame = 0; frame < spec.frameCount; frame++) {
      blitCell(ctx, image, frame, rowIndex, LABEL_GUTTER, y, options.scale);
    }
    ctx.restore();
  });
  return canvas;
}

/**
 * Per-frame difference against the previous frame, which locates *where* a
 * continuity problem is rather than only that there is one.
 */
function renderDeltaPanel(image: Canvas, options: Options): Canvas {
  const rows = chosenRows(options);
  const cellW = frameWidth * options.scale;
  const cellH = frameHeight * options.scale;
  const columns = Math.max(...rows.map((spec) => spec.frameCount));

  const canvas = createCanvas(
    Math.ceil(LABEL_GUTTER + columns * cellW + PANEL_PAD * 2),
    Math.ceil(PANEL_PAD * 2 + rows.length * (cellH + ROW_GAP)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = DELTA_BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  rows.forEach((spec, i) => {
    const rowIndex = sheetRowOf(spec.name);
    const y = PANEL_PAD + i * (cellH + ROW_GAP);
    label(ctx, `${spec.name} delta`, PANEL_PAD, y + cellH / 2, CAPTION_FONT);
    for (let frame = 0; frame < spec.frameCount; frame++) {
      const previous = (frame - 1 + spec.frameCount) % spec.frameCount;
      const x = LABEL_GUTTER + frame * cellW;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      blitCell(ctx, image, frame, rowIndex, x, y, options.scale);
      ctx.globalCompositeOperation = 'difference';
      blitCell(ctx, image, previous, rowIndex, x, y, options.scale);
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
  console.log('Gating the cockroach figure…');
  reportFigureGates('cockroach', cockroachGateFailures());

  const image = bakeFigureSheet(COCKROACH_FIGURE, [...SHEET_STATES]).canvas;

  let panel: Canvas;
  if (options.mode === 'gore') panel = renderGorePanel(image);
  else if (options.mode === 'parts') panel = renderPartsPanel(image, options);
  else if (options.mode === 'onion') panel = renderOnionPanel(image, options);
  else if (options.mode === 'delta') panel = renderDeltaPanel(image, options);
  else panel = renderSheetPanel(image, options);

  const outPath = writePreviewPng(options.out, panel.toBuffer('image/png'));
  console.log(`  → ${outPath}  (${panel.width}×${panel.height})`);
}

main();
