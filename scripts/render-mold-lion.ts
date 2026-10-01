/**
 * Mold Lion review harness.
 *
 *   npm run render:mold-lion
 *   npx tsx scripts/render-mold-lion.ts --scale=5 --out=preview/lion.png
 */

import { createCanvas } from 'canvas';

import { TILE_SIZE } from '../src/core/constants.js';

import { bakeFigureCell, frameCountOf } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  reportFigureGates,
} from './figureGates.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { MOLD_LION_FIGURE, TILE_SCALE } from '../src/sprites/art/moldLionFigure.js';
import { MOLD_LION_STATES } from '../src/sprites/moldLionSprite.js';

const IN_GAME_SCALE = TILE_SIZE / TILE_SCALE;
const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const LABEL_BASELINE_INSET = 6;
const BACKDROP = '#3b3b40';
const GROUND = '#5b4a35';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const PIXEL_ZOOM = 3;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function parseScale(): number {
  const raw = parseFlag('scale', String(DEFAULT_SCALE));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_SCALE || value > MAX_SCALE) {
    throw new Error(`--scale=${raw} is not a number in [${MIN_SCALE}, ${MAX_SCALE}]`);
  }
  return value;
}

function main(): void {
  const scale = parseScale();
  const def = MOLD_LION_FIGURE;
  const states = [...def.states.keys()];
  const columns = Math.max(...states.map((state) => frameCountOf(def, state)));
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const smallW = def.frameWidth * IN_GAME_SCALE;
  const smallH = def.frameHeight * IN_GAME_SCALE;

  const sheetHeight = states.length * (cellH + LABEL_HEIGHT);
  const stripHeight = (LABEL_HEIGHT + smallH * PIXEL_ZOOM) * states.length;
  const width = PADDING * 2 + Math.max(columns * cellW, columns * smallW * PIXEL_ZOOM);
  const canvas = createCanvas(Math.ceil(width), Math.ceil(PADDING * 3 + sheetHeight + stripHeight));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const state of states) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${state} @ ${scale}×`, PADDING, y + LABEL_HEIGHT - LABEL_BASELINE_INSET);
    y += LABEL_HEIGHT;
    const frames = frameCountOf(def, state);
    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * cellW;
      ctx.fillStyle = GROUND;
      ctx.fillRect(x, y, cellW - 1, cellH - 1);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + def.tileX * scale,
        y + def.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
      ctx.drawImage(bakeFigureCell(def, state, frame), x, y, cellW, cellH);
    }
    y += cellH;
  }

  y += PADDING;
  for (const state of states) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${state} at in-game size (${TILE_SIZE}px tile), pixels zoomed ${PIXEL_ZOOM}×`,
      PADDING,
      y + LABEL_HEIGHT - LABEL_BASELINE_INSET,
    );
    y += LABEL_HEIGHT;
    const frames = frameCountOf(def, state);
    for (let frame = 0; frame < frames; frame++) {
      const small = createCanvas(Math.ceil(smallW), Math.ceil(smallH));
      const smallCtx = small.getContext('2d');
      smallCtx.fillStyle = GROUND;
      smallCtx.fillRect(0, 0, small.width, small.height);
      smallCtx.drawImage(bakeFigureCell(def, state, frame), 0, 0, smallW, smallH);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        small,
        PADDING + frame * smallW * PIXEL_ZOOM,
        y,
        small.width * PIXEL_ZOOM,
        small.height * PIXEL_ZOOM,
      );
      ctx.imageSmoothingEnabled = true;
    }
    y += smallH * PIXEL_ZOOM;
  }

  const outPath = writePreviewPng(
    parseFlag('out', `${PREVIEW_DIR}/mold-lion.png`),
    canvas.toBuffer('image/png'),
  );
  console.log(`wrote ${outPath}`);

  const pixelCache = new Map<string, Uint8ClampedArray>();
  const pixelsOf = (state: string, frame: number): Uint8ClampedArray => {
    const key = `${state}:${frame}`;
    const cached = pixelCache.get(key);
    if (cached !== undefined) return cached;
    const cell = bakeFigureCell(def, state, frame);
    const data = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height).data;
    pixelCache.set(key, data);
    return data;
  };
  reportFigureGates('structure', figureStructuralFailures(def));
  reportFigureGates('distinct frames', distinctFrameFailures(def, pixelsOf).failures);
  reportFigureGates(
    'runtime states',
    missingStateFailures(def, MOLD_LION_STATES, 'drawMoldLionSprite'),
  );
}

main();
