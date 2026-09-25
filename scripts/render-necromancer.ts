/**
 * Vordrick Boneharrow's review harness. Runs the art gates first, then bakes a
 * labelled contact sheet from `NECROMANCER_FIGURE` the way the runtime cache
 * bakes it, plus an in-game strip at the real 32 px tile on grass and on
 * dungeon stone.
 *
 *   npm run render:necromancer
 *   npx tsx scripts/render-necromancer.ts --scale=3 --row=cast_raise
 *   npx tsx scripts/render-necromancer.ts --part=head --scale=6
 *   npx tsx scripts/render-necromancer.ts --mode=strip32
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureCell, bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { necromancerGateFailures } from './gates-necromancer.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  NECROMANCER_FIGURE,
  NECROMANCER_ROWS,
  TILE_SCALE,
} from '../src/sprites/art/necromancerFigure.js';

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Windows onto one part, as fractions of the cell so they survive a cell resize. */
const PARTS: ReadonlyMap<string, PartWindow> = new Map([
  ['head', { x: 0.36, y: 0.2, w: 0.3, h: 0.22 }],
  ['lantern', { x: 0.08, y: 0.05, w: 0.84, h: 0.35 }],
  ['hands', { x: 0.2, y: 0.3, w: 0.6, h: 0.3 }],
  ['hem', { x: 0.2, y: 0.72, w: 0.6, h: 0.26 }],
]);

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const GRASS = '#55693f';
const STONE = '#4a4744';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function parseNumberFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

function renderSheet(scale: number, only: string, partName: string): Canvas {
  const rows = only === '' ? NECROMANCER_ROWS : NECROMANCER_ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);
  const part = partName === '' ? null : PARTS.get(partName);
  if (partName !== '' && part === undefined) {
    throw new Error(`--part=${partName} is not one of ${[...PARTS.keys()].join(', ')}`);
  }
  const baked = bakeFigureSheet(
    NECROMANCER_FIGURE,
    rows.map((row) => row.name),
  );
  const frameW = baked.frameWidth;
  const frameH = baked.frameHeight;
  const cropped = part !== null && part !== undefined;
  const srcX = cropped ? Math.round(part.x * frameW) : 0;
  const srcY = cropped ? Math.round(part.y * frameH) : 0;
  const srcW = cropped ? Math.round(part.w * frameW) : frameW;
  const srcH = cropped ? Math.round(part.h * frameH) : frameH;
  const cellW = srcW * scale;
  const cellH = srcH * scale;
  const maxCols = Math.max(...rows.map((row) => row.frameCount));
  const canvas = createCanvas(
    Math.ceil(PADDING + maxCols * (cellW + PADDING)),
    Math.ceil(PADDING + rows.length * (cellH + LABEL_HEIGHT + PADDING)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  let y = PADDING;
  rows.forEach((spec, sheetRow) => {
    const events = Object.entries(spec.eventFrames ?? {})
      .map(([name, frame]) => `${name}@${frame}`)
      .join(' ');
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${spec.name} — ${spec.frameCount} frames, ${spec.kind}` +
        (events === '' ? '' : `, ${events}`) +
        (spec.loopFrom === undefined ? '' : `, loops from ${spec.loopFrom}`),
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    for (let col = 0; col < spec.frameCount; col++) {
      const x = PADDING + col * (cellW + PADDING);
      ctx.drawImage(
        baked.canvas,
        col * frameW + srcX,
        sheetRow * frameH + srcY,
        srcW,
        srcH,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (!cropped) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + NECROMANCER_FIGURE.tileX * scale,
          y + NECROMANCER_FIGURE.tileY * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
    }
    y += cellH + PADDING;
  });
  return canvas;
}

/**
 * Every row's key frames at the in-game 32 px tile, on grass and on stone,
 * with a 2× nearest-neighbour copy beneath. The primary realism judgement:
 * what dies at 32 px counts for nothing.
 */
function renderStrip32(only: string): Canvas {
  const rows = only === '' ? NECROMANCER_ROWS : NECROMANCER_ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);
  const shrink = IN_GAME_TILE / TILE_SCALE;
  const cellW = NECROMANCER_FIGURE.frameWidth * shrink;
  const cellH = NECROMANCER_FIGURE.frameHeight * shrink;
  const framesPerRow = 4;
  const spacing = cellW * STRIP_OVERLAP;
  const groupW = (framesPerRow - 1) * spacing + cellW + PADDING;
  const groupsPerLine = Math.min(rows.length, STRIP_GROUPS_PER_LINE);
  const lines = Math.ceil(rows.length / groupsPerLine);
  const grounds: readonly string[] = [GRASS, STONE];
  const lineH = LABEL_HEIGHT + cellH * grounds.length;
  const width = PADDING + groupsPerLine * groupW;
  const stripH = PADDING + lines * (lineH + PADDING);
  const zoomH = cellH * 2 * grounds.length;
  const canvas = createCanvas(Math.ceil(width), Math.ceil(stripH + zoomH + PADDING));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  rows.forEach((row, index) => {
    const line = Math.floor(index / groupsPerLine);
    const x = PADDING + (index % groupsPerLine) * groupW;
    const top = PADDING + line * (lineH + PADDING);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(row.name, x, top + LABEL_HEIGHT - PADDING);
    grounds.forEach((ground, band) => {
      const y = top + LABEL_HEIGHT + band * cellH;
      ctx.fillStyle = ground;
      ctx.fillRect(x, y, groupW - PADDING, cellH);
      for (let i = 0; i < framesPerRow; i++) {
        const frame = Math.floor((i * row.frameCount) / framesPerRow);
        const cell = bakeFigureCell(NECROMANCER_FIGURE, row.name, frame);
        ctx.drawImage(cell, x + i * spacing, y, cellW, cellH);
      }
    });
  });
  // The first line again at 2×, nearest-neighbour, to see the actual pixels.
  ctx.imageSmoothingEnabled = false;
  const zoomW = Math.min(width, canvas.width / 2);
  ctx.drawImage(
    canvas,
    0,
    PADDING + LABEL_HEIGHT,
    zoomW,
    cellH * grounds.length,
    0,
    stripH,
    zoomW * 2,
    zoomH,
  );
  return canvas;
}

/** How far apart a row's sampled frames are laid, as a share of a cell's width. */
const STRIP_OVERLAP = 0.42;
const STRIP_GROUPS_PER_LINE = 7;

function main(): void {
  const mode = parseFlag('mode', 'sheet');
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');
  const partName = parseFlag('part', '');

  // Gated ahead of the sheet: the sheet is a large allocation, and measuring
  // the art on the far side of one is how a gate starts reporting noise.
  if (process.argv.includes('--no-gates')) {
    console.log('Skipping the necromancer gates (--no-gates)…');
  } else {
    console.log('Gating the necromancer figure…');
    reportFigureGates('necromancer', necromancerGateFailures());
  }

  const canvas = mode === 'strip32' ? renderStrip32(only) : renderSheet(scale, only, partName);
  const fallback = mode === 'strip32' ? 'necromancer-strip32.png' : 'necromancer-review.png';
  const outPath = parseFlag('out', `${PREVIEW_DIR}/${fallback}`);
  const written = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${written} (${canvas.width}×${canvas.height}px)`);
}

main();
