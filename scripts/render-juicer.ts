/**
 * The Juicer review harness. Art has to be judged as an image, by something
 * that only looks at the image — every defect that has ever mattered on a
 * figure in this project was invisible to `typecheck`, `lint` and a code read.
 *
 * The contact sheet is painted from `JUICER_FIGURE` the way the runtime cache
 * bakes it, and the art gates run as part of the render, so one command answers
 * both "does it still hold together" and "what does it look like".
 *
 *   npm run render:juicer
 *   npx tsx scripts/render-juicer.ts --row=sprint_side --scale=4
 *   npx tsx scripts/render-juicer.ts --part=head --scale=6
 *   npx tsx scripts/render-juicer.ts --row=walk_side --mode=onion --scale=3
 *   npx tsx scripts/render-juicer.ts --row=punch_side --mode=delta --scale=3
 *   npx tsx scripts/render-juicer.ts --row=throw_side --mode=arc --scale=3
 *   npx tsx scripts/render-juicer.ts --mode=gore --scale=4
 *   npx tsx scripts/render-juicer.ts --frame=5 --row=throw_side --scale=8
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { juicerGateFailures } from './gates-juicer.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  GORE_STATES,
  JUICER_FIGURE,
  JUICER_ROWS,
  TILE_SCALE,
} from '../src/sprites/art/juicerFigure.js';

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const BACKDROP = '#3b3b40';
const DUNGEON_FLOOR = '#191720';
const ONION_ALPHA = 0.4;
const ARC_DOT_RADIUS = 2.5;
const ARC_COLOR = 'rgba(255,120,60,0.9)';
const NO_FRAME = -1;
const MAX_FRAME_FLAG = 64;

type Mode = 'sheet' | 'parts' | 'gore' | 'onion' | 'delta' | 'arc';
const MODES: ReadonlyArray<Mode> = ['sheet', 'parts', 'gore', 'onion', 'delta', 'arc'];

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Fractions of the frame rather than pixels, so the table survives the figure
 * re-deriving its own cell size.
 */
const PARTS: Record<string, PartWindow> = {
  head: { x: 0.3, y: 0.02, w: 0.4, h: 0.24 },
  torso: { x: 0.14, y: 0.2, w: 0.72, h: 0.34 },
  arms: { x: 0.02, y: 0.2, w: 0.96, h: 0.42 },
  hands: { x: 0.02, y: 0.4, w: 0.96, h: 0.32 },
  legs: { x: 0.24, y: 0.56, w: 0.52, h: 0.34 },
  feet: { x: 0.2, y: 0.78, w: 0.6, h: 0.2 },
  tail: { x: 0.0, y: 0.4, w: 0.55, h: 0.45 },
};

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

const POSE_STATES: readonly string[] = JUICER_ROWS.map((row) => row.name);
const ALL_STATES: readonly string[] = [...POSE_STATES, ...GORE_STATES];

/** How a row is captioned: a pose row says how it moves, a gore piece says so. */
function labelOf(state: string): string {
  const row = JUICER_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) return `${state} — 1 frame, gore piece`;
  return `${row.name} — ${row.frameCount} frames, ${row.view}, ${row.kind}`;
}

function frameCountOf(state: string): number {
  const declared = JUICER_FIGURE.states.get(state);
  if (declared === undefined) throw new Error(`the juicer declares no state "${state}"`);
  return declared.frames;
}

function main(): void {
  const outPath = parseFlag('out', `${PREVIEW_DIR}/juicer-review.png`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const mode = parseMode();
  const rowFilter = parseFlag('row', '');
  const partName = parseFlag('part', mode === 'parts' ? 'head' : '');
  const frameFilter = Math.round(parseNumberFlag('frame', NO_FRAME, NO_FRAME, MAX_FRAME_FLAG));

  const part = partName === '' ? null : PARTS[partName];
  if (partName !== '' && part === undefined) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PARTS).join(', ')}`);
  }

  const states =
    mode === 'gore'
      ? [...GORE_STATES]
      : rowFilter === ''
        ? [...ALL_STATES]
        : ALL_STATES.filter((state) => state === rowFilter);
  if (states.length === 0) {
    throw new Error(`--row=${rowFilter} is not one of ${ALL_STATES.join(', ')}`);
  }

  // Ahead of the contact sheet rather than after it. The sheet is a thirty
  // megapixel allocation, and measuring the art on the other side of it made
  // the centroid gate report a seam twice its true width every so often — a
  // red gate on art that had not changed, which is the one thing that teaches
  // an agent to loosen a threshold.
  console.log('Gating the juicer figure…');
  reportFigureGates('juicer', juicerGateFailures());

  const baked = bakeFigureSheet(JUICER_FIGURE, states);
  const sheet = baked.canvas;
  const frameW = baked.frameWidth;
  const frameH = baked.frameHeight;

  const cropped = part !== null && part !== undefined;
  const srcW = cropped ? Math.round(part.w * frameW) : frameW;
  const srcH = cropped ? Math.round(part.h * frameH) : frameH;
  const srcOffsetX = cropped ? Math.round(part.x * frameW) : 0;
  const srcOffsetY = cropped ? Math.round(part.y * frameH) : 0;
  const cellW = srcW * scale;
  const cellH = srcH * scale;

  const columnsOf = (frameCount: number): number[] =>
    frameFilter === NO_FRAME
      ? Array.from({ length: frameCount }, (_unused, i) => i)
      : [Math.min(frameCount - 1, Math.max(0, frameFilter))];

  const maxCols = Math.max(...states.map((state) => columnsOf(frameCountOf(state)).length));
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const inGameW = frameW * inGameScale;
  const inGameH = frameH * inGameScale;
  const stripWidth = PADDING + states.length * (inGameW + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  states.forEach((state, sheetRow) => {
    const frameCount = frameCountOf(state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      labelOf(state) + (cropped ? `  [${partName}]` : ''),
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    const cols = columnsOf(frameCount);
    cols.forEach((col, slot) => {
      const x = PADDING + slot * (cellW + PADDING);
      const blit = (frame: number, alpha: number): void => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(
          sheet,
          frame * frameW + srcOffsetX,
          sheetRow * frameH + srcOffsetY,
          srcW,
          srcH,
          x,
          y,
          cellW,
          cellH,
        );
        ctx.restore();
      };
      if (mode === 'delta') {
        // The previous frame is subtracted rather than overlaid, so what is
        // left is only what moved — which is where a continuity gate fired.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellW, cellH);
        ctx.clip();
        blit(col, 1);
        ctx.globalCompositeOperation = 'difference';
        blit((col + frameCount - 1) % frameCount, 1);
        ctx.restore();
      } else {
        if (mode === 'onion') blit((col + frameCount - 1) % frameCount, ONION_ALPHA);
        blit(col, 1);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (!cropped) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + JUICER_FIGURE.tileX * scale,
          y + JUICER_FIGURE.tileY * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
    });

    if (mode === 'arc') {
      // Every frame's ink centroid, laid over the row's first cell: a believable
      // swing traces a smooth arc, and a cornered one is a rig bug.
      drawArc(ctx, sheet, sheetRow, frameCount, frameW, frameH, PADDING, y, scale);
    }
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    'in-game size (32px tile), on the dungeon floor',
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;
  ctx.fillStyle = DUNGEON_FLOOR;
  ctx.fillRect(0, y, canvas.width, inGameH);
  states.forEach((_state, sheetRow) => {
    ctx.drawImage(
      sheet,
      0,
      sheetRow * frameH,
      frameW,
      frameH,
      PADDING + sheetRow * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  });

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(
    `Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×, mode ${mode})`,
  );
}

const ARC_INK_ALPHA = 24;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

/** Traces each frame's ink centroid across a row, drawn over the first cell. */
function drawArc(
  ctx: ReturnType<Canvas['getContext']>,
  sheet: Canvas,
  sheetRow: number,
  frameCount: number,
  frameW: number,
  frameH: number,
  originX: number,
  originY: number,
  scale: number,
): void {
  const probe = createCanvas(frameW, frameH);
  const probeCtx = probe.getContext('2d');
  ctx.fillStyle = ARC_COLOR;
  for (let frame = 0; frame < frameCount; frame++) {
    probeCtx.clearRect(0, 0, frameW, frameH);
    probeCtx.drawImage(
      sheet,
      frame * frameW,
      sheetRow * frameH,
      frameW,
      frameH,
      0,
      0,
      frameW,
      frameH,
    );
    const { data } = probeCtx.getImageData(0, 0, frameW, frameH);
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    for (let py = 0; py < frameH; py++) {
      for (let px = 0; px < frameW; px++) {
        if (data[(py * frameW + px) * CHANNELS + ALPHA_OFFSET] < ARC_INK_ALPHA) continue;
        count++;
        sumX += px;
        sumY += py;
      }
    }
    if (count === 0) continue;
    ctx.beginPath();
    ctx.arc(
      originX + (sumX / count) * scale,
      originY + (sumY / count) * scale,
      ARC_DOT_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

main();
