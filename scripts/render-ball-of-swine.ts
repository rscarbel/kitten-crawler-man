#!/usr/bin/env tsx
/**
 * The Ball of Swine's review harness. Art has to be judged as an image, by
 * something that only looks at the image — every defect that has ever mattered
 * on this creature was invisible to `typecheck`, `lint` and a code read.
 *
 * The contact sheet is painted from `BALL_OF_SWINE_FIGURE` the way the runtime
 * cache bakes it, and the art gates run as part of the render, so one command
 * answers both "does it still hold together" and "what does it look like".
 *
 *   npm run render:ball-of-swine
 *   npx tsx scripts/render-ball-of-swine.ts --row=wallow --scale=4
 *   npx tsx scripts/render-ball-of-swine.ts --row=roll --mode=onion --scale=3
 *   npx tsx scripts/render-ball-of-swine.ts --mode=composite --scale=3
 *
 * `composite` is the mode that matters most, and the only one that shows what
 * the game shows: the ground shadow, then a rolling frame rotated to a heading,
 * then the fixed key light on top. Reviewing the `roll` row on its own means
 * reviewing an unlit ball, which is not a thing the player ever sees.
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';

import { bakeFigureSheet, type FigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { ballOfSwineGateFailures } from './gates-ball-of-swine.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  BALL_OF_SWINE_FIGURE,
  BALL_OF_SWINE_ROWS,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/ballOfSwineFigure.js';
import { BOS_ROLL_FRAMES } from '../src/sprites/ballOfSwineSheet.js';
import { ARENA_PLATE_LIGHT } from '../src/map/tiles/specialFloorTiles.js';

type Mode = 'contact' | 'onion' | 'composite';

const DEFAULT_OUT = `${PREVIEW_DIR}/swine-review.png`;
const DEFAULT_SCALE = 2;
/** The size the ball is actually seen at, so the strip is not a lie. */
const IN_GAME_TILE = 32;
const LABEL_HEIGHT = 18;
const MARGIN = 12;
const BACKDROP = '#101218';
/**
 * The arena's own floor colour, imported rather than copied so the backdrop is
 * always the surface the ball is actually seen against.
 */
const ARENA_FLOOR = ARENA_PLATE_LIGHT;
const GRID_LINE = 'rgba(120,160,220,0.28)';
const CENTRE_LINE = 'rgba(255,120,120,0.5)';
const LABEL_COLOR = '#c8d4e4';
const ONION_ALPHA = 0.4;
/** Headings the composite mode rolls the ball along, in eighths of a turn. */
const COMPOSITE_HEADINGS = 8;
/** Rows of in-game-sized strip the contact sheet leaves room for at the bottom. */
const STRIP_TILE_ROWS = 6;

function parseFlag(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = parseFlag(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  // Rejected rather than defaulted: a typo'd scale that silently becomes 2
  // wastes a review round, and a NaN one sizes the canvas at NaN and throws
  // deeper in.
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

function parseMode(): Mode {
  const raw = parseFlag('mode');
  if (raw === null) return 'contact';
  if (raw === 'contact' || raw === 'onion' || raw === 'composite') return raw;
  throw new Error(`--mode must be contact, onion or composite (got "${raw}")`);
}

function label(ctx: Ctx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

function stateOf(name: string): RowSpec {
  const row = BALL_OF_SWINE_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    throw new Error(
      `no state named "${name}"; states are ${BALL_OF_SWINE_ROWS.map((r) => r.name).join(', ')}`,
    );
  }
  return row;
}

/** Which row of the baked sheet a state's cells landed on. */
function rowIndexOf(baked: FigureSheet, state: string): number {
  const index = baked.states.indexOf(state);
  if (index < 0) throw new Error(`"${state}" was not baked into this sheet`);
  return index;
}

function blitCell(
  ctx: Ctx,
  baked: FigureSheet,
  state: string,
  frame: number,
  x: number,
  y: number,
  drawn: number,
): void {
  ctx.drawImage(
    baked.canvas,
    frame * baked.frameWidth,
    rowIndexOf(baked, state) * baked.frameHeight,
    baked.frameWidth,
    baked.frameHeight,
    x,
    y,
    drawn,
    drawn,
  );
}

/** One rolling frame as the game composites it: shadow, rotated body, key light. */
function drawComposite(
  ctx: Ctx,
  baked: FigureSheet,
  frame: number,
  heading: number,
  x: number,
  y: number,
  scale: number,
): void {
  const drawn = baked.frameWidth * scale;
  blitCell(ctx, baked, 'shadow', 0, x, y, drawn);
  ctx.save();
  ctx.translate(x + drawn / 2, y + drawn / 2);
  ctx.rotate(heading);
  blitCell(ctx, baked, 'roll', frame, -drawn / 2, -drawn / 2, drawn);
  ctx.restore();
  blitCell(ctx, baked, 'shade', 0, x, y, drawn);
}

function main(): void {
  const outPath = parseFlag('out') ?? DEFAULT_OUT;
  const scale = parseNumberFlag('scale', DEFAULT_SCALE);
  const only = parseFlag('row');
  const mode = parseMode();

  // Ahead of the contact sheet rather than after it. A contact sheet is a
  // tens-of-megapixel allocation, and measuring the art on the far side of one
  // has made a centroid gate report a drift twice its true size — a red gate on
  // art nobody touched is the one thing that teaches an agent to loosen a
  // threshold.
  console.log('Gating the ball-of-swine figure…');
  reportFigureGates('ball_of_swine', ballOfSwineGateFailures());

  const composited = ['roll', 'shade', 'shadow'];
  const rows = only === null ? BALL_OF_SWINE_ROWS : [stateOf(only)];
  const bakedStates =
    mode === 'composite'
      ? composited
      : [...new Set([...rows.map((row) => row.name), ...composited])];
  const baked = bakeFigureSheet(BALL_OF_SWINE_FIGURE, bakedStates);
  const size = baked.frameWidth;
  const drawn = size * scale;

  if (mode === 'composite') {
    const canvas = createCanvas(
      MARGIN * 2 + COMPOSITE_HEADINGS * drawn,
      MARGIN * 2 + LABEL_HEIGHT + drawn,
    );
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = ARENA_FLOOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    label(
      ctx,
      'composite — shadow + roll rotated to heading + shade, on the arena floor',
      MARGIN,
      MARGIN,
    );
    for (let i = 0; i < COMPOSITE_HEADINGS; i++) {
      const heading = (i / COMPOSITE_HEADINGS) * Math.PI * 2;
      drawComposite(
        ctx,
        baked,
        Math.floor((i / COMPOSITE_HEADINGS) * BOS_ROLL_FRAMES),
        heading,
        MARGIN + i * drawn,
        MARGIN + LABEL_HEIGHT,
        scale,
      );
    }
    const written = writePreviewPng(outPath, canvas.toBuffer('image/png'));
    console.log(`→ ${written} (${canvas.width}×${canvas.height})`);
    return;
  }

  const columns = Math.max(...rows.map((row) => row.frameCount));
  const canvas = createCanvas(
    MARGIN * 2 + columns * drawn,
    MARGIN * 2 +
      rows.length * (drawn + LABEL_HEIGHT) +
      LABEL_HEIGHT +
      IN_GAME_TILE * STRIP_TILE_ROWS,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = MARGIN;
  for (const row of rows) {
    label(ctx, `${row.name} — ${row.frameCount} frames, ${row.kind}`, MARGIN, y);
    y += LABEL_HEIGHT;
    for (let col = 0; col < row.frameCount; col++) {
      const x = MARGIN + col * drawn;
      ctx.fillStyle = ARENA_FLOOR;
      ctx.fillRect(x, y, drawn, drawn);
      if (mode === 'onion' && col > 0) {
        ctx.save();
        ctx.globalAlpha = ONION_ALPHA;
        blitCell(ctx, baked, row.name, col - 1, x, y, drawn);
        ctx.restore();
      }
      blitCell(ctx, baked, row.name, col, x, y, drawn);
      ctx.strokeStyle = GRID_LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, drawn - 1, drawn - 1);
      // The anchor crosshair: the rotation pivot, and the thing every rotated
      // state has to be concentric on.
      ctx.strokeStyle = CENTRE_LINE;
      ctx.beginPath();
      ctx.moveTo(x + drawn / 2, y);
      ctx.lineTo(x + drawn / 2, y + drawn);
      ctx.moveTo(x, y + drawn / 2);
      ctx.lineTo(x + drawn, y + drawn / 2);
      ctx.stroke();
    }
    y += drawn;
  }

  label(ctx, `in-game size (${IN_GAME_TILE}px tiles) on the arena floor`, MARGIN, y);
  y += LABEL_HEIGHT;
  const gameScale = IN_GAME_TILE / TILE_SCALE;
  const gameDrawn = size * gameScale;
  ctx.fillStyle = ARENA_FLOOR;
  ctx.fillRect(MARGIN, y, canvas.width - MARGIN * 2, gameDrawn);
  for (let col = 0; col < BOS_ROLL_FRAMES; col++) {
    drawComposite(ctx, baked, col, 0, MARGIN + col * gameDrawn, y, gameScale);
  }

  const written = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`→ ${written} (${canvas.width}×${canvas.height})`);
}

main();
