#!/usr/bin/env tsx
/**
 * Auntie Gorge's review harness. Art has to be judged as an image, by something
 * that only looks at the image — every defect that has ever mattered on a
 * figure in this project was invisible to `typecheck`, `lint` and a code read,
 * and obvious in a render within seconds.
 *
 * The contact sheet is painted from `AUNTIE_GORGE_FIGURE` the way the runtime cache
 * bakes it, and her art gates run as part of the render, so one command answers
 * both "does it still hold together" and "what does it look like".
 *
 *   npm run render:auntie-gorge
 *   npx tsx scripts/render-auntie-gorge.ts --mode=poses --scale=3
 *   npx tsx scripts/render-auntie-gorge.ts --mode=parts --part=head
 *   npx tsx scripts/render-auntie-gorge.ts --mode=gore
 *   npx tsx scripts/render-auntie-gorge.ts --mode=onion --state=walk_side
 *   npx tsx scripts/render-auntie-gorge.ts --mode=delta --state=heave_side
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { auntieGorgeGateFailures } from './gates-auntie-gorge.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  GORE_STATES,
  GROUND_OFFSET_PX,
  AUNTIE_GORGE_FIGURE,
  AUNTIE_GORGE_ROWS,
  TILE_SCALE,
  HEAVE_RELEASE_FRAME,
} from '../src/shelf/auntieGorge/auntieGorgeFigure.js';

const MODES = ['sheet', 'poses', 'parts', 'gore', 'onion', 'delta', 'strip'] as const;
type Mode = (typeof MODES)[number];

const BACKDROP = '#1b1b20';
const PANEL_INK = '#e8e2d4';
const LABEL_INK = '#9d99a8';
const GUIDE = 'rgba(90,220,255,0.6)';
const GROUND_GUIDE = 'rgba(255,120,120,0.5)';
const RELEASE_MARK = 'rgba(255,220,90,0.9)';

const LABEL_FONT = '13px sans-serif';
const TITLE_FONT = 'bold 15px sans-serif';
const LABEL_GUTTER = 120;
const ROW_GAP = 8;
const TOP_MARGIN = 26;
const LABEL_X = 8;
const TITLE_BASELINE = 18;
/** Baseline of a row label under the larger, sheet-style rows. */
const ROW_LABEL_BASELINE = 18;
/** Baseline of a row label under the compact rows, and of a frame's own tag. */
const ROW_TAG_BASELINE = 14;
/** How far a label sits in from the cell edge it names. */
const LABEL_INSET = 4;

/** The size a player actually sees her at. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;

/**
 * Crops as fractions of the cell rather than as pixel boxes: a pose that grows
 * changes the frozen frame size, and a pixel box silently starts cropping the
 * wrong thing the moment it does.
 */
interface PartCrop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const PARTS: ReadonlyMap<string, PartCrop> = new Map(
  Object.entries({
    head: { x: 0.3, y: 0.02, w: 0.4, h: 0.22 },
    torso: { x: 0.14, y: 0.16, w: 0.72, h: 0.4 },
    hands: { x: 0.04, y: 0.3, w: 0.92, h: 0.3 },
    legs: { x: 0.22, y: 0.52, w: 0.56, h: 0.34 },
    feet: { x: 0.2, y: 0.74, w: 0.6, h: 0.24 },
  }),
);

interface Options {
  readonly mode: Mode;
  readonly out: string;
  readonly scale: number;
  readonly part: string;
  readonly state: string;
}

function parseOptions(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z]+)=(.*)$/.exec(arg);
    if (match !== null) flags.set(match[1], match[2]);
  }
  const rawMode = flags.get('mode') ?? 'sheet';
  const mode = MODES.find((candidate) => candidate === rawMode);
  if (mode === undefined) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  const scale = Number(flags.get('scale') ?? DEFAULT_SCALE);
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
    throw new Error(`--scale must be between ${MIN_SCALE} and ${MAX_SCALE}`);
  }
  return {
    mode,
    out: flags.get('out') ?? `${PREVIEW_DIR}/auntie-gorge-review.png`,
    scale,
    part: flags.get('part') ?? 'head',
    state: flags.get('state') ?? 'walk_side',
  };
}

type Ctx = ReturnType<Canvas['getContext']>;

/** The states of a figure, laid out as one row of cells each. */
interface Sheet {
  readonly draw: (
    ctx: Ctx,
    row: number,
    frame: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void;
  readonly states: readonly string[];
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly framesOf: (state: string) => number;
}

function sheetOf(def: FigureDef, states: readonly string[]): Sheet {
  const baked = bakeFigureSheet(def, [...states]);
  return {
    states: baked.states,
    frameWidth: baked.frameWidth,
    frameHeight: baked.frameHeight,
    framesOf: (state) => {
      const declared = def.states.get(state);
      if (declared === undefined) throw new Error(`${def.id} declares no state "${state}"`);
      return declared.frames;
    },
    draw: (ctx, row, frame, dx, dy, dw, dh) => {
      ctx.drawImage(
        baked.canvas,
        frame * baked.frameWidth,
        row * baked.frameHeight,
        baked.frameWidth,
        baked.frameHeight,
        dx,
        dy,
        dw,
        dh,
      );
    },
  };
}

const POSE_STATES: readonly string[] = AUNTIE_GORGE_ROWS.map((row) => row.name);
const ALL_STATES: readonly string[] = [...POSE_STATES, ...GORE_STATES];

/** How a row is captioned: a pose row says how it moves, a gore piece says so. */
function labelOf(state: string): string {
  const row = AUNTIE_GORGE_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) return `${state} — gore piece`;
  return `${row.name} (${row.view}, ${row.kind})`;
}

function label(ctx: Ctx, text: string, x: number, y: number, font = LABEL_FONT): void {
  ctx.font = font;
  ctx.fillStyle = font === TITLE_FONT ? PANEL_INK : LABEL_INK;
  ctx.fillText(text, x, y);
}

/** Every frame of every state, one state per row, with the tile guide drawn on. */
function renderSheetPanel(sheet: Sheet, scale: number): Buffer {
  const cellW = sheet.frameWidth * scale;
  const cellH = sheet.frameHeight * scale;
  const columns = Math.max(...sheet.states.map((state) => sheet.framesOf(state)));
  const width = LABEL_GUTTER + columns * cellW;
  const height = TOP_MARGIN + sheet.states.length * (cellH + ROW_GAP);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(
    ctx,
    `Auntie Gorge — ${sheet.frameWidth}x${sheet.frameHeight} cells at ${scale}x`,
    LABEL_X,
    TITLE_BASELINE,
    TITLE_FONT,
  );

  sheet.states.forEach((state, row) => {
    const top = TOP_MARGIN + row * (cellH + ROW_GAP);
    label(ctx, labelOf(state), LABEL_X, top + ROW_LABEL_BASELINE);
    for (let frame = 0; frame < sheet.framesOf(state); frame++) {
      const left = LABEL_GUTTER + frame * cellW;
      sheet.draw(ctx, row, frame, left, top, cellW, cellH);
      ctx.strokeStyle = GUIDE;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        left + AUNTIE_GORGE_FIGURE.tileX * scale,
        top + AUNTIE_GORGE_FIGURE.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
      if (state.startsWith('heave') && frame === HEAVE_RELEASE_FRAME) {
        ctx.strokeStyle = RELEASE_MARK;
        ctx.lineWidth = 2;
        ctx.strokeRect(left + 1, top + 1, cellW - 2, cellH - 2);
      }
    }
  });

  return canvas.toBuffer('image/png');
}

/**
 * The same frames at the size a player sees. A silhouette that reads at 4x and
 * dissolves at 32px is a failure, and this strip is where that gets caught.
 */
function renderStripPanel(sheet: Sheet): Buffer {
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const cellW = sheet.frameWidth * inGameScale;
  const cellH = sheet.frameHeight * inGameScale;
  const columns = Math.max(...sheet.states.map((state) => sheet.framesOf(state)));
  const width = LABEL_GUTTER + columns * cellW;
  const height = TOP_MARGIN + sheet.states.length * (cellH + ROW_GAP);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(ctx, `Auntie Gorge at TILE_SIZE=${IN_GAME_TILE}`, LABEL_X, TITLE_BASELINE, TITLE_FONT);

  sheet.states.forEach((state, row) => {
    const top = TOP_MARGIN + row * (cellH + ROW_GAP);
    label(ctx, state, LABEL_X, top + ROW_TAG_BASELINE);
    for (let frame = 0; frame < sheet.framesOf(state); frame++) {
      sheet.draw(ctx, row, frame, LABEL_GUTTER + frame * cellW, top, cellW, cellH);
    }
  });
  return canvas.toBuffer('image/png');
}

/** Frames worth judging a state on: its rest, its middle, and its extreme. */
const POSE_SAMPLE_EARLY = 0.34;
const POSE_SAMPLE_LATE = 0.58;
const POSE_SAMPLE_EXTREME = 0.84;
const POSE_SAMPLE_SHARES = [0, POSE_SAMPLE_EARLY, POSE_SAMPLE_LATE, POSE_SAMPLE_EXTREME] as const;
const POSE_COLUMNS = POSE_SAMPLE_SHARES.length;

/**
 * One row per state, a handful of frames each, big enough to actually see. The
 * full contact sheet shows every frame but is the wrong thing to read directly
 * — a hundred and eight cells downscale to nothing.
 */
function renderPosePanel(sheet: Sheet, scale: number): Buffer {
  const cellW = sheet.frameWidth * scale;
  const cellH = sheet.frameHeight * scale;
  const rows = sheet.states.filter((state) => POSE_STATES.includes(state));
  const width = LABEL_GUTTER + POSE_COLUMNS * cellW;
  const height = TOP_MARGIN + rows.length * (cellH + ROW_GAP);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(ctx, `Auntie Gorge — sampled frames at ${scale}x`, LABEL_X, TITLE_BASELINE, TITLE_FONT);

  rows.forEach((state, index) => {
    const top = TOP_MARGIN + index * (cellH + ROW_GAP);
    label(ctx, labelOf(state), LABEL_X, top + ROW_LABEL_BASELINE);
    const frameCount = sheet.framesOf(state);
    POSE_SAMPLE_SHARES.forEach((share, column) => {
      const frame = Math.min(frameCount - 1, Math.round(share * frameCount));
      const left = LABEL_GUTTER + column * cellW;
      sheet.draw(ctx, sheet.states.indexOf(state), frame, left, top, cellW, cellH);
      ctx.strokeStyle = GROUND_GUIDE;
      ctx.lineWidth = 1;
      // The ground line sits inside the tile, not at its bottom edge — it is
      // what the poses anchor on and what the anchor gate measures against.
      const groundY = top + (AUNTIE_GORGE_FIGURE.tileY + GROUND_OFFSET_PX) * scale;
      ctx.beginPath();
      ctx.moveTo(left, groundY);
      ctx.lineTo(left + cellW, groundY);
      ctx.stroke();
      label(ctx, `f${frame}`, left + LABEL_INSET, top + ROW_TAG_BASELINE);
    });
  });
  return canvas.toBuffer('image/png');
}

function renderPartPanel(sheet: Sheet, part: string, scale: number): Buffer {
  const crop = PARTS.get(part);
  if (crop === undefined) {
    throw new Error(`--part must be one of ${[...PARTS.keys()].join(', ')}`);
  }
  const cropX = crop.x * sheet.frameWidth;
  const cropY = crop.y * sheet.frameHeight;
  const cellW = crop.w * sheet.frameWidth * scale;
  const cellH = crop.h * sheet.frameHeight * scale;
  const rows = sheet.states.filter((state) => POSE_STATES.includes(state));
  const columns = Math.max(...rows.map((state) => sheet.framesOf(state)));

  const width = LABEL_GUTTER + columns * cellW;
  const height = TOP_MARGIN + rows.length * (cellH + ROW_GAP);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(ctx, `Auntie Gorge — ${part} at ${scale}x`, LABEL_X, TITLE_BASELINE, TITLE_FONT);

  rows.forEach((state, index) => {
    const top = TOP_MARGIN + index * (cellH + ROW_GAP);
    label(ctx, state, LABEL_X, top + ROW_TAG_BASELINE);
    for (let frame = 0; frame < sheet.framesOf(state); frame++) {
      const left = LABEL_GUTTER + frame * cellW;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, cellW, cellH);
      ctx.clip();
      sheet.draw(
        ctx,
        sheet.states.indexOf(state),
        frame,
        left - cropX * scale,
        top - cropY * scale,
        sheet.frameWidth * scale,
        sheet.frameHeight * scale,
      );
      ctx.restore();
    }
  });
  return canvas.toBuffer('image/png');
}

const GORE_REVIEW_LARGE = 4;
const GORE_REVIEW_MEDIUM = 2;
/** The size the runtime draws a severed piece at. */
const GORE_REVIEW_RUNTIME = 0.5;
const GORE_REVIEW_SCALES = [GORE_REVIEW_LARGE, GORE_REVIEW_MEDIUM, GORE_REVIEW_RUNTIME] as const;

/**
 * Every piece at three sizes, the smallest being what the runtime draws them
 * at. A distinctness gate proves the shapes differ; only naming them from this
 * panel proves they are the right shapes.
 */
function renderGorePanel(sheet: Sheet): Buffer {
  const width = LABEL_GUTTER + GORE_STATES.length * sheet.frameWidth * GORE_REVIEW_SCALES[0];
  const height =
    TOP_MARGIN * 2 +
    GORE_REVIEW_SCALES.reduce((sum, scale) => sum + sheet.frameHeight * scale + ROW_GAP, 0);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(
    ctx,
    `name all ${GORE_STATES.length} of these without reading the labels`,
    LABEL_X,
    TITLE_BASELINE,
    TITLE_FONT,
  );

  let top = TOP_MARGIN;
  GORE_REVIEW_SCALES.forEach((scale) => {
    const cellW = sheet.frameWidth * scale;
    const cellH = sheet.frameHeight * scale;
    label(ctx, `${scale}x`, LABEL_X, top + ROW_TAG_BASELINE);
    GORE_STATES.forEach((state, index) => {
      sheet.draw(
        ctx,
        sheet.states.indexOf(state),
        0,
        LABEL_GUTTER + index * cellW,
        top,
        cellW,
        cellH,
      );
      if (scale === GORE_REVIEW_SCALES[0]) {
        label(
          ctx,
          state.replace('gore_', ''),
          LABEL_GUTTER + index * cellW + LABEL_INSET,
          top + cellH - LABEL_INSET,
        );
      }
    });
    top += cellH + ROW_GAP;
  });
  return canvas.toBuffer('image/png');
}

const ONION_BACKDROP = '#101014';

/** Consecutive frames overlaid: a snap or a pop shows as a doubled edge. */
function renderOnionPanel(sheet: Sheet, state: string, scale: number): Buffer {
  const row = sheet.states.indexOf(state);
  if (row < 0) throw new Error(`--state=${state} is not one of ${sheet.states.join(', ')}`);
  const frameCount = sheet.framesOf(state);
  const width = sheet.frameWidth * scale;
  const height = TOP_MARGIN + sheet.frameHeight * scale;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = ONION_BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(ctx, `onion — ${state}`, LABEL_X, TITLE_BASELINE, TITLE_FONT);
  ctx.globalAlpha = 1 / frameCount;
  for (let frame = 0; frame < frameCount; frame++) {
    sheet.draw(ctx, row, frame, 0, TOP_MARGIN, width, sheet.frameHeight * scale);
  }
  ctx.globalAlpha = 1;
  return canvas.toBuffer('image/png');
}

/** Per-frame difference against the previous frame: locates a continuity spike. */
function renderDeltaPanel(sheet: Sheet, state: string, scale: number): Buffer {
  const row = sheet.states.indexOf(state);
  if (row < 0) throw new Error(`--state=${state} is not one of ${sheet.states.join(', ')}`);
  const frameCount = sheet.framesOf(state);
  const cellW = sheet.frameWidth * scale;
  const cellH = sheet.frameHeight * scale;
  const width = LABEL_GUTTER + frameCount * cellW;
  const height = TOP_MARGIN + cellH;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  label(ctx, `delta — ${state}`, LABEL_X, TITLE_BASELINE, TITLE_FONT);

  for (let frame = 0; frame < frameCount; frame++) {
    const previous = (frame - 1 + frameCount) % frameCount;
    const left = LABEL_GUTTER + frame * cellW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, TOP_MARGIN, cellW, cellH);
    ctx.clip();
    sheet.draw(ctx, row, frame, left, TOP_MARGIN, cellW, cellH);
    ctx.globalCompositeOperation = 'difference';
    sheet.draw(ctx, row, previous, left, TOP_MARGIN, cellW, cellH);
    ctx.restore();
  }
  return canvas.toBuffer('image/png');
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));

  // Ahead of the contact sheet rather than after it. The sheet is a
  // tens-of-megapixel allocation, and measuring the art on the other side of
  // one makes a centroid gate report a seam twice its true width every so
  // often — a red gate on art that had not changed, which is the one thing
  // that teaches an agent to loosen a threshold.
  console.log('Gating the Auntie Gorge figure…');
  const figureClean = reportFigureGates('auntie_gorge', auntieGorgeGateFailures());
  if (!figureClean) return;

  const sheet = sheetOf(AUNTIE_GORGE_FIGURE, ALL_STATES);

  let buffer: Buffer;
  if (options.mode === 'poses') buffer = renderPosePanel(sheet, options.scale);
  else if (options.mode === 'parts') buffer = renderPartPanel(sheet, options.part, options.scale);
  else if (options.mode === 'gore') buffer = renderGorePanel(sheet);
  else if (options.mode === 'onion') buffer = renderOnionPanel(sheet, options.state, options.scale);
  else if (options.mode === 'delta') buffer = renderDeltaPanel(sheet, options.state, options.scale);
  else if (options.mode === 'strip') buffer = renderStripPanel(sheet);
  else buffer = renderSheetPanel(sheet, options.scale);

  const resolvedPath = writePreviewPng(options.out, buffer);
  console.log(`wrote ${resolvedPath} (${options.mode})`);
}

main();
