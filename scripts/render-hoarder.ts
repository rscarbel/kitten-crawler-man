#!/usr/bin/env tsx
/**
 * The Hoarder review harness. Art has to be judged as an image, by something
 * that only looks at the image — every defect that has ever mattered on a
 * figure in this project was invisible to `typecheck`, `lint` and a code read,
 * and obvious in a render within seconds.
 *
 * The contact sheet is painted from `HOARDER_FIGURE` the way the runtime cache
 * bakes it, and her art gates run as part of the render, so one command answers
 * both "does it still hold together" and "what does it look like".
 *
 *   npm run render:hoarder
 *   npx tsx scripts/render-hoarder.ts --mode=poses --scale=3
 *   npx tsx scripts/render-hoarder.ts --mode=parts --part=head
 *   npx tsx scripts/render-hoarder.ts --mode=gore
 *   npx tsx scripts/render-hoarder.ts --mode=bile
 *   npx tsx scripts/render-hoarder.ts --mode=onion --state=walk_side
 *   npx tsx scripts/render-hoarder.ts --mode=delta --state=vomit_side
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { hoarderBileGateFailures, hoarderGateFailures } from './gates-hoarder.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  GORE_STATES,
  GROUND_OFFSET_PX,
  HOARDER_FIGURE,
  HOARDER_ROWS,
  TILE_SCALE,
  VOMIT_RELEASE_FRAME,
} from '../src/sprites/art/hoarderFigure.js';
import {
  HOARDER_ACID_FIGURE,
  HOARDER_BILE_ARC_FIGURE,
} from '../src/sprites/art/hoarderBileFigure.js';

const MODES = ['sheet', 'poses', 'parts', 'gore', 'bile', 'onion', 'delta', 'strip'] as const;
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

/** The size a player actually sees her at. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;

/** How the effect panel is scaled, against her own: their cells are far bigger. */
const BILE_PANEL_SCALE = 0.5;

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

const PARTS: Record<string, PartCrop> = {
  head: { x: 0.3, y: 0.02, w: 0.4, h: 0.22 },
  torso: { x: 0.14, y: 0.16, w: 0.72, h: 0.4 },
  hands: { x: 0.04, y: 0.3, w: 0.92, h: 0.3 },
  legs: { x: 0.22, y: 0.52, w: 0.56, h: 0.34 },
  feet: { x: 0.2, y: 0.74, w: 0.6, h: 0.24 },
};

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
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      flags.set(match[1], match[2]);
    }
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
    out: flags.get('out') ?? `${PREVIEW_DIR}/hoarder-review.png`,
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

const POSE_STATES: readonly string[] = HOARDER_ROWS.map((row) => row.name);
const ALL_STATES: readonly string[] = [...POSE_STATES, ...GORE_STATES];

/** How a row is captioned: a pose row says how it moves, a gore piece says so. */
function labelOf(state: string): string {
  const row = HOARDER_ROWS.find((candidate) => candidate.name === state);
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
    `hoarder — ${sheet.frameWidth}x${sheet.frameHeight} cells at ${scale}x`,
    8,
    18,
    TITLE_FONT,
  );

  sheet.states.forEach((state, row) => {
    const top = TOP_MARGIN + row * (cellH + ROW_GAP);
    label(ctx, labelOf(state), 8, top + 18);
    for (let frame = 0; frame < sheet.framesOf(state); frame++) {
      const left = LABEL_GUTTER + frame * cellW;
      sheet.draw(ctx, row, frame, left, top, cellW, cellH);
      ctx.strokeStyle = GUIDE;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        left + HOARDER_FIGURE.tileX * scale,
        top + HOARDER_FIGURE.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
      if (state.startsWith('vomit') && frame === VOMIT_RELEASE_FRAME) {
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
  label(ctx, `hoarder at TILE_SIZE=${IN_GAME_TILE}`, 8, 18, TITLE_FONT);

  sheet.states.forEach((state, row) => {
    const top = TOP_MARGIN + row * (cellH + ROW_GAP);
    label(ctx, state, 8, top + 14);
    for (let frame = 0; frame < sheet.framesOf(state); frame++) {
      sheet.draw(ctx, row, frame, LABEL_GUTTER + frame * cellW, top, cellW, cellH);
    }
  });
  return canvas.toBuffer('image/png');
}

/** Frames worth judging a state on: its rest, its middle, and its extreme. */
const POSE_SAMPLE_SHARES = [0, 0.34, 0.58, 0.84] as const;
const POSE_COLUMNS = POSE_SAMPLE_SHARES.length;

/**
 * One row per state, a handful of frames each, big enough to actually see. The
 * full contact sheet is the right thing to hand a blind reviewer and the wrong
 * thing to read directly — a hundred and eight cells downscale to nothing.
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
  label(ctx, `hoarder — sampled frames at ${scale}x`, 8, 18, TITLE_FONT);

  rows.forEach((state, index) => {
    const top = TOP_MARGIN + index * (cellH + ROW_GAP);
    label(ctx, labelOf(state), 8, top + 18);
    const frameCount = sheet.framesOf(state);
    POSE_SAMPLE_SHARES.forEach((share, column) => {
      const frame = Math.min(frameCount - 1, Math.round(share * frameCount));
      const left = LABEL_GUTTER + column * cellW;
      sheet.draw(ctx, sheet.states.indexOf(state), frame, left, top, cellW, cellH);
      ctx.strokeStyle = GROUND_GUIDE;
      ctx.lineWidth = 1;
      // The ground line sits inside the tile, not at its bottom edge — it is
      // what the poses anchor on and what the anchor gate measures against.
      const groundY = top + (HOARDER_FIGURE.tileY + GROUND_OFFSET_PX) * scale;
      ctx.beginPath();
      ctx.moveTo(left, groundY);
      ctx.lineTo(left + cellW, groundY);
      ctx.stroke();
      label(ctx, `f${frame}`, left + 4, top + 14);
    });
  });
  return canvas.toBuffer('image/png');
}

function renderPartPanel(sheet: Sheet, part: string, scale: number): Buffer {
  const crop = PARTS[part];
  if (crop === undefined) {
    throw new Error(`--part must be one of ${Object.keys(PARTS).join(', ')}`);
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
  label(ctx, `hoarder — ${part} at ${scale}x`, 8, 18, TITLE_FONT);

  rows.forEach((state, index) => {
    const top = TOP_MARGIN + index * (cellH + ROW_GAP);
    label(ctx, state, 8, top + 14);
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

const GORE_REVIEW_SCALES = [4, 2, 0.5] as const;

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
    8,
    18,
    TITLE_FONT,
  );

  let top = TOP_MARGIN;
  GORE_REVIEW_SCALES.forEach((scale) => {
    const cellW = sheet.frameWidth * scale;
    const cellH = sheet.frameHeight * scale;
    label(ctx, `${scale}x`, 8, top + 14);
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
        label(ctx, state.replace('gore_', ''), LABEL_GUTTER + index * cellW + 4, top + cellH - 4);
      }
    });
    top += cellH + ROW_GAP;
  });
  return canvas.toBuffer('image/png');
}

/** The bolus and the pool, each figure laid out as its own block of rows. */
function renderBilePanel(): Buffer {
  const blocks = [HOARDER_BILE_ARC_FIGURE, HOARDER_ACID_FIGURE].map((def) => ({
    def,
    sheet: sheetOf(def, [...def.states.keys()]),
  }));
  const blockWidth = ({ sheet }: (typeof blocks)[number]): number => {
    const columns = Math.max(...sheet.states.map((state) => sheet.framesOf(state)));
    return columns * sheet.frameWidth * BILE_PANEL_SCALE;
  };
  const width = LABEL_GUTTER + Math.max(...blocks.map(blockWidth));
  const height =
    TOP_MARGIN +
    blocks.reduce(
      (sum, block) =>
        sum +
        block.sheet.states.length * (block.sheet.frameHeight * BILE_PANEL_SCALE + ROW_GAP) +
        TOP_MARGIN,
      0,
    );

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);

  let top = TOP_MARGIN;
  for (const { def, sheet } of blocks) {
    label(ctx, `${def.id} — ${def.frameWidth}x${def.frameHeight} cells`, 8, top - 6, TITLE_FONT);
    const cellW = sheet.frameWidth * BILE_PANEL_SCALE;
    const cellH = sheet.frameHeight * BILE_PANEL_SCALE;
    sheet.states.forEach((state, row) => {
      label(ctx, state, 8, top + 14);
      for (let frame = 0; frame < sheet.framesOf(state); frame++) {
        sheet.draw(ctx, row, frame, LABEL_GUTTER + frame * cellW, top, cellW, cellH);
      }
      top += cellH + ROW_GAP;
    });
    top += TOP_MARGIN;
  }
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
  label(ctx, `onion — ${state}`, 8, 18, TITLE_FONT);
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
  label(ctx, `delta — ${state}`, 8, 18, TITLE_FONT);

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
  // one made the pilot's centroid gate report a seam twice its true width every
  // so often — a red gate on art that had not changed, which is the one thing
  // that teaches an agent to loosen a threshold.
  console.log('Gating the hoarder figure…');
  const figureClean = reportFigureGates('hoarder', hoarderGateFailures());
  console.log('Gating her bile…');
  const bileClean = reportFigureGates('hoarder bile', hoarderBileGateFailures());
  if (!figureClean || !bileClean) return;

  const sheet = sheetOf(HOARDER_FIGURE, ALL_STATES);

  let buffer: Buffer;
  if (options.mode === 'poses') buffer = renderPosePanel(sheet, options.scale);
  else if (options.mode === 'parts') buffer = renderPartPanel(sheet, options.part, options.scale);
  else if (options.mode === 'gore') buffer = renderGorePanel(sheet);
  else if (options.mode === 'bile') buffer = renderBilePanel();
  else if (options.mode === 'onion') buffer = renderOnionPanel(sheet, options.state, options.scale);
  else if (options.mode === 'delta') buffer = renderDeltaPanel(sheet, options.state, options.scale);
  else if (options.mode === 'strip') buffer = renderStripPanel(sheet);
  else buffer = renderSheetPanel(sheet, options.scale);

  const resolvedPath = writePreviewPng(options.out, buffer);
  console.log(`wrote ${resolvedPath} (${options.mode})`);
}

main();
