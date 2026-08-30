/**
 * The Tuskling review harness. Art has to be judged as an image, by something
 * that only looks at the image — every defect that has ever mattered on a
 * figure in this project was invisible to `typecheck`, `lint` and a code read.
 *
 * The contact sheet is painted from `TUSKLING_FIGURE` the way the runtime cache
 * bakes it, and the art gates run as part of the render, so one command answers
 * both "does it still hold together" and "what does it look like".
 *
 *   npm run render:tuskling
 *   npx tsx scripts/render-tuskling.ts --row=charge_side --scale=4
 *   npx tsx scripts/render-tuskling.ts --part=head --scale=6
 *   npx tsx scripts/render-tuskling.ts --row=walk_side --mode=onion --scale=3
 *   npx tsx scripts/render-tuskling.ts --mode=gore --scale=4
 */

import { createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { tusklingGateFailures } from './gates-tuskling.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  GORE_STATES,
  TILE_SCALE,
  TUSKLING_FIGURE,
  TUSKLING_ROWS,
} from '../src/sprites/art/tusklingFigure.js';

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

type Mode = 'sheet' | 'gore' | 'onion' | 'delta';
const MODES: ReadonlyArray<Mode> = ['sheet', 'gore', 'onion', 'delta'];

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
  head: { x: 0.24, y: 0.14, w: 0.52, h: 0.36 },
  tusks: { x: 0.28, y: 0.24, w: 0.44, h: 0.26 },
  torso: { x: 0.16, y: 0.34, w: 0.68, h: 0.34 },
  hands: { x: 0.06, y: 0.46, w: 0.88, h: 0.3 },
  legs: { x: 0.24, y: 0.62, w: 0.52, h: 0.3 },
  hooves: { x: 0.24, y: 0.74, w: 0.52, h: 0.22 },
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

const POSE_STATES: readonly string[] = TUSKLING_ROWS.map((row) => row.name);
const ALL_STATES: readonly string[] = [...POSE_STATES, ...GORE_STATES];

/** How a row is captioned: a pose row says how it moves, a gore piece says so. */
function labelOf(state: string): string {
  const row = TUSKLING_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) return `${state} — 1 frame, gore piece`;
  return `${row.name} — ${row.frameCount} frames, ${row.view}, ${row.kind}`;
}

function frameCountOf(state: string): number {
  const declared = TUSKLING_FIGURE.states.get(state);
  if (declared === undefined) throw new Error(`the tuskling declares no state "${state}"`);
  return declared.frames;
}

function main(): void {
  const outPath = parseFlag('out', `${PREVIEW_DIR}/tuskling-review.png`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const mode = parseMode();
  const rowFilter = parseFlag('row', '');
  const partName = parseFlag('part', '');

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

  // Ahead of the contact sheet rather than after it. The sheet is a
  // many-megapixel allocation, and measuring art on the other side of one is
  // what made a sibling figure's centroid gate report a seam at twice its true
  // width every so often — a red gate on art nobody touched, which is the one
  // thing that teaches an agent to loosen a threshold.
  console.log('Gating the tuskling figure…');
  reportFigureGates('tuskling', tusklingGateFailures());

  const baked = bakeFigureSheet(TUSKLING_FIGURE, states);
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

  const maxCols = Math.max(...states.map((state) => frameCountOf(state)));
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

    for (let col = 0; col < frameCount; col++) {
      const x = PADDING + col * (cellW + PADDING);
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
          x + TUSKLING_FIGURE.tileX * scale,
          y + TUSKLING_FIGURE.tileY * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
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

main();
