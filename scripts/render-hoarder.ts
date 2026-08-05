#!/usr/bin/env tsx
/**
 * Review harness for the Hoarder sheet.
 *
 * Bakes in memory and slices the result into a labelled contact sheet, so a
 * pose change can be judged before the manifest is pasted. This is the only way
 * the art gets looked at: every defect that has ever mattered on a figure in
 * this repo was invisible to typecheck, lint and a code read, and obvious in a
 * render within seconds.
 *
 *   npx tsx scripts/render-hoarder.ts --out=review.png --scale=2
 *   npx tsx scripts/render-hoarder.ts --mode=parts --part=head
 *   npx tsx scripts/render-hoarder.ts --mode=gore
 *   npx tsx scripts/render-hoarder.ts --mode=onion --state=walk_side
 *   npx tsx scripts/render-hoarder.ts --mode=delta --state=vomit_side
 */

import { createCanvas, loadImage, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  GORE_STATES,
  GROUND_OFFSET_PX,
  SEGMENTS,
  TILE_SCALE,
  VOMIT_RELEASE_FRAME,
  bake,
  columnOffsetOf,
  type SegmentSpec,
} from './generate-hoarder-sprite.js';

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
const LABEL_GUTTER = 108;
const ROW_GAP = 8;
const TOP_MARGIN = 26;

/** The size a player actually sees her at. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;

/**
 * Crops as fractions of the cell rather than as pixel boxes: a pose that grows
 * changes the measured frame size, and a pixel box silently starts cropping the
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
    out: flags.get('out') ?? 'hoarder-review.png',
    scale,
    part: flags.get('part') ?? 'head',
    state: flags.get('state') ?? 'walk_side',
  };
}

function segmentByName(name: string): SegmentSpec {
  const found = SEGMENTS.find((segment) => segment.name === name);
  if (found === undefined) {
    throw new Error(`no state "${name}"; try one of ${SEGMENTS.map((s) => s.name).join(', ')}`);
  }
  return found;
}

interface Baked {
  readonly draw: (
    ctx: Ctx,
    row: number,
    column: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

async function bakeForReview(): Promise<Baked> {
  const sheet = bake();
  const image = await loadImage(sheet.buffer);
  const { frameWidth, frameHeight, tileX, tileY } = sheet.geometry;
  return {
    frameWidth,
    frameHeight,
    tileX,
    tileY,
    draw: (ctx, row, column, dx, dy, dw, dh) => {
      ctx.drawImage(
        image,
        column * frameWidth,
        row * frameHeight,
        frameWidth,
        frameHeight,
        dx,
        dy,
        dw,
        dh,
      );
    },
  };
}

function label(ctx: Ctx, text: string, x: number, y: number, font = LABEL_FONT): void {
  ctx.font = font;
  ctx.fillStyle = font === TITLE_FONT ? PANEL_INK : LABEL_INK;
  ctx.fillText(text, x, y);
}

/** Every frame of every state, one state per row, with the tile guide drawn on. */
function renderSheetPanel(baked: Baked, scale: number): Buffer {
  const cellW = baked.frameWidth * scale;
  const cellH = baked.frameHeight * scale;
  const columns = Math.max(...SEGMENTS.map((segment) => segment.frameCount));
  const width = LABEL_GUTTER + columns * cellW;
  const height = TOP_MARGIN + SEGMENTS.length * (cellH + ROW_GAP);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(
    ctx,
    `hoarder — ${baked.frameWidth}x${baked.frameHeight} cells at ${scale}x`,
    8,
    18,
    TITLE_FONT,
  );

  SEGMENTS.forEach((segment, index) => {
    const top = TOP_MARGIN + index * (cellH + ROW_GAP);
    label(ctx, `${segment.name} (${segment.view})`, 8, top + 18);
    const base = columnOffsetOf(segment.name);
    for (let frame = 0; frame < segment.frameCount; frame++) {
      const left = LABEL_GUTTER + frame * cellW;
      baked.draw(ctx, segment.row, base + frame, left, top, cellW, cellH);
      ctx.strokeStyle = GUIDE;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        left + baked.tileX * scale,
        top + baked.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
      if (segment.name.startsWith('vomit') && frame === VOMIT_RELEASE_FRAME) {
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
function renderStripPanel(baked: Baked): Buffer {
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const cellW = baked.frameWidth * inGameScale;
  const cellH = baked.frameHeight * inGameScale;
  const columns = Math.max(...SEGMENTS.map((segment) => segment.frameCount));
  const width = LABEL_GUTTER + columns * cellW;
  const height = TOP_MARGIN + SEGMENTS.length * (cellH + ROW_GAP);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(ctx, `hoarder at TILE_SIZE=${IN_GAME_TILE}`, 8, 18, TITLE_FONT);

  SEGMENTS.forEach((segment, index) => {
    const top = TOP_MARGIN + index * (cellH + ROW_GAP);
    label(ctx, segment.name, 8, top + 14);
    const base = columnOffsetOf(segment.name);
    for (let frame = 0; frame < segment.frameCount; frame++) {
      baked.draw(ctx, segment.row, base + frame, LABEL_GUTTER + frame * cellW, top, cellW, cellH);
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
function renderPosePanel(baked: Baked, scale: number): Buffer {
  const rows = SEGMENTS.filter((segment) => segment.kind !== 'gore');
  const cellW = baked.frameWidth * scale;
  const cellH = baked.frameHeight * scale;
  const width = LABEL_GUTTER + POSE_COLUMNS * cellW;
  const height = TOP_MARGIN + rows.length * (cellH + ROW_GAP);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(ctx, `hoarder — sampled frames at ${scale}x`, 8, 18, TITLE_FONT);

  rows.forEach((segment, index) => {
    const top = TOP_MARGIN + index * (cellH + ROW_GAP);
    label(ctx, `${segment.name} (${segment.view})`, 8, top + 18);
    const base = columnOffsetOf(segment.name);
    POSE_SAMPLE_SHARES.forEach((share, column) => {
      const frame = Math.min(segment.frameCount - 1, Math.round(share * segment.frameCount));
      const left = LABEL_GUTTER + column * cellW;
      baked.draw(ctx, segment.row, base + frame, left, top, cellW, cellH);
      ctx.strokeStyle = GROUND_GUIDE;
      ctx.lineWidth = 1;
      // The ground line sits inside the tile, not at its bottom edge — it is
      // what the bake anchors on and what the anchor gate measures against.
      const groundY = top + (baked.tileY + GROUND_OFFSET_PX) * scale;
      ctx.beginPath();
      ctx.moveTo(left, groundY);
      ctx.lineTo(left + cellW, groundY);
      ctx.stroke();
      label(ctx, `f${frame}`, left + 4, top + 14);
    });
  });
  return canvas.toBuffer('image/png');
}

function renderPartPanel(baked: Baked, part: string, scale: number): Buffer {
  const crop = PARTS[part];
  if (crop === undefined) {
    throw new Error(`--part must be one of ${Object.keys(PARTS).join(', ')}`);
  }
  const cropX = crop.x * baked.frameWidth;
  const cropY = crop.y * baked.frameHeight;
  const cropW = crop.w * baked.frameWidth;
  const cropH = crop.h * baked.frameHeight;
  const cellW = cropW * scale;
  const cellH = cropH * scale;
  const rows = SEGMENTS.filter((segment) => segment.kind !== 'gore');
  const columns = Math.max(...rows.map((segment) => segment.frameCount));

  const width = LABEL_GUTTER + columns * cellW;
  const height = TOP_MARGIN + rows.length * (cellH + ROW_GAP);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(ctx, `hoarder — ${part} at ${scale}x`, 8, 18, TITLE_FONT);

  rows.forEach((segment, index) => {
    const top = TOP_MARGIN + index * (cellH + ROW_GAP);
    label(ctx, segment.name, 8, top + 14);
    const base = columnOffsetOf(segment.name);
    for (let frame = 0; frame < segment.frameCount; frame++) {
      const left = LABEL_GUTTER + frame * cellW;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, cellW, cellH);
      ctx.clip();
      baked.draw(
        ctx,
        segment.row,
        base + frame,
        left - cropX * scale,
        top - cropY * scale,
        baked.frameWidth * scale,
        baked.frameHeight * scale,
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
function renderGorePanel(baked: Baked): Buffer {
  const goreSegment = segmentByName('gore');
  const base = columnOffsetOf('gore');
  const rowHeights = GORE_REVIEW_SCALES.map((scale) => baked.frameHeight * scale + ROW_GAP);
  const width =
    LABEL_GUTTER + GORE_STATES.length * baked.frameWidth * Math.max(...GORE_REVIEW_SCALES);
  const height = TOP_MARGIN * 2 + rowHeights.reduce((sum, value) => sum + value, 0);

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
    const cellW = baked.frameWidth * scale;
    const cellH = baked.frameHeight * scale;
    label(ctx, `${scale}x`, 8, top + 14);
    GORE_STATES.forEach((state, index) => {
      baked.draw(
        ctx,
        goreSegment.row,
        base + index,
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

const ONION_BACKDROP = '#101014';

/** Consecutive frames overlaid: a snap or a pop shows as a doubled edge. */
function renderOnionPanel(baked: Baked, state: string, scale: number): Buffer {
  const segment = segmentByName(state);
  const base = columnOffsetOf(state);
  const width = baked.frameWidth * scale;
  const height = TOP_MARGIN + baked.frameHeight * scale;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = ONION_BACKDROP;
  ctx.fillRect(0, 0, width, height);
  label(ctx, `onion — ${state}`, 8, 18, TITLE_FONT);
  ctx.globalAlpha = 1 / segment.frameCount;
  for (let frame = 0; frame < segment.frameCount; frame++) {
    baked.draw(ctx, segment.row, base + frame, 0, TOP_MARGIN, width, baked.frameHeight * scale);
  }
  ctx.globalAlpha = 1;
  return canvas.toBuffer('image/png');
}

/** Per-frame difference against the previous frame: locates a continuity spike. */
function renderDeltaPanel(baked: Baked, state: string, scale: number): Buffer {
  const segment = segmentByName(state);
  const base = columnOffsetOf(state);
  const cellW = baked.frameWidth * scale;
  const cellH = baked.frameHeight * scale;
  const width = LABEL_GUTTER + segment.frameCount * cellW;
  const height = TOP_MARGIN + cellH;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  label(ctx, `delta — ${state}`, 8, 18, TITLE_FONT);

  for (let frame = 0; frame < segment.frameCount; frame++) {
    const previous = (frame - 1 + segment.frameCount) % segment.frameCount;
    const left = LABEL_GUTTER + frame * cellW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, TOP_MARGIN, cellW, cellH);
    ctx.clip();
    baked.draw(ctx, segment.row, base + frame, left, TOP_MARGIN, cellW, cellH);
    ctx.globalCompositeOperation = 'difference';
    baked.draw(ctx, segment.row, base + previous, left, TOP_MARGIN, cellW, cellH);
    ctx.restore();
  }
  return canvas.toBuffer('image/png');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const baked = await bakeForReview();

  let buffer: Buffer;
  if (options.mode === 'poses') buffer = renderPosePanel(baked, options.scale);
  else if (options.mode === 'parts') buffer = renderPartPanel(baked, options.part, options.scale);
  else if (options.mode === 'gore') buffer = renderGorePanel(baked);
  else if (options.mode === 'onion') buffer = renderOnionPanel(baked, options.state, options.scale);
  else if (options.mode === 'delta') buffer = renderDeltaPanel(baked, options.state, options.scale);
  else if (options.mode === 'strip') buffer = renderStripPanel(baked);
  else buffer = renderSheetPanel(baked, options.scale);

  writeFileSync(resolve(options.out), buffer);
  console.log(`wrote ${options.out} (${options.mode})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
