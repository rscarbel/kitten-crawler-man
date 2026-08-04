#!/usr/bin/env tsx
/**
 * Review harness for the Ball of Swine sheet.
 *
 *   npx tsx scripts/render-ball-of-swine.ts --out=swine-review.png --scale=2
 *   npx tsx scripts/render-ball-of-swine.ts --row=wallow --scale=4
 *   npx tsx scripts/render-ball-of-swine.ts --row=roll --mode=onion --scale=3
 *   npx tsx scripts/render-ball-of-swine.ts --mode=composite --scale=3
 *   npx tsx scripts/render-ball-of-swine.ts --fresh    (review the bake, not the file)
 *
 * `composite` is the mode that matters most, and the only one that shows what
 * the game shows: the ground shadow, then a rolling frame rotated to a heading,
 * then the fixed key light on top. Reviewing the `roll` row on its own means
 * reviewing an unlit ball, which is not a thing the player ever sees.
 */

import { createCanvas, loadImage, type Canvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type BakedSheet,
  ROWS,
  type RowSpec,
  SHEET_PATH,
  TILE_SCALE,
  bake,
} from './generate-ball-of-swine-sprite.js';
import { BOS_ROLL_FRAMES } from '../src/sprites/ballOfSwineSheet.js';
import { ARENA_PLATE_LIGHT } from '../src/map/tiles/specialFloorTiles.js';

type Mode = 'contact' | 'onion' | 'composite';

const DEFAULT_OUT = 'swine-review.png';
const DEFAULT_SCALE = 2;
/** The size the ball is actually seen at, so the strip is not a lie. */
const IN_GAME_TILE = 32;
const LABEL_HEIGHT = 18;
const MARGIN = 12;
const BACKDROP = '#101218';
/**
 * The arena's own floor colour, imported rather than copied so the backdrop is always
 * the surface the ball is actually seen against.
 */
const ARENA_FLOOR = ARENA_PLATE_LIGHT;
const GRID_LINE = 'rgba(120,160,220,0.28)';
const CENTRE_LINE = 'rgba(255,120,120,0.5)';
const LABEL_COLOR = '#c8d4e4';
const ONION_ALPHA = 0.4;
/** Headings the composite mode rolls the ball along, in eighths of a turn. */
const COMPOSITE_HEADINGS = 8;

function parseFlag(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = parseFlag(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  // Rejected rather than defaulted: a typo'd scale that silently becomes 2 wastes
  // a review round, and a NaN one sizes the canvas at NaN and throws deeper in.
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

function parseMode(): Mode {
  const raw = parseFlag('mode');
  if (raw === null) return 'contact';
  if (raw === 'contact' || raw === 'onion' || raw === 'composite') return raw;
  throw new Error(`--mode must be contact, onion or composite (got "${raw}")`);
}

async function loadSheet(baked: BakedSheet | null): Promise<Canvas> {
  if (baked !== null) {
    const image = await loadImage(baked.buffer);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas;
  }
  const path = resolve(SHEET_PATH);
  if (!existsSync(path)) throw new Error(`${SHEET_PATH} does not exist; run npm run gen:ball-of-swine`);
  const image = await loadImage(readFileSync(path));
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

function label(ctx: Ctx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

function stateOf(name: string): RowSpec {
  const row = ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    throw new Error(`no state named "${name}"; states are ${ROWS.map((r) => r.name).join(', ')}`);
  }
  return row;
}

/** One rolling frame as the game composites it: shadow, rotated body, key light. */
interface CompositeStates {
  readonly roll: RowSpec;
  readonly shade: RowSpec;
  readonly shadow: RowSpec;
}

function drawComposite(
  ctx: Ctx,
  sheet: Canvas,
  size: number,
  states: CompositeStates,
  frame: number,
  heading: number,
  x: number,
  y: number,
  scale: number,
): void {
  const drawn = size * scale;
  const blit = (state: RowSpec): void => {
    ctx.drawImage(
      sheet,
      state.colOffset * size,
      state.sheetRow * size,
      size,
      size,
      x,
      y,
      drawn,
      drawn,
    );
  };
  blit(states.shadow);
  ctx.save();
  ctx.translate(x + drawn / 2, y + drawn / 2);
  ctx.rotate(heading);
  ctx.drawImage(
    sheet,
    (states.roll.colOffset + frame) * size,
    states.roll.sheetRow * size,
    size,
    size,
    -drawn / 2,
    -drawn / 2,
    drawn,
    drawn,
  );
  ctx.restore();
  blit(states.shade);
}

function compositeStates(): CompositeStates {
  return { roll: stateOf('roll'), shade: stateOf('shade'), shadow: stateOf('shadow') };
}

async function main(): Promise<void> {
  const outPath = parseFlag('out') ?? DEFAULT_OUT;
  const scale = parseNumberFlag('scale', DEFAULT_SCALE);
  const only = parseFlag('row');
  const mode = parseMode();
  const fresh = process.argv.includes('--fresh');

  const baked = bake();
  const sheet = await loadSheet(fresh ? baked : null);
  const size = baked.geometry.frameSize;
  if (sheet.width % size !== 0 || sheet.height % size !== 0) {
    console.warn(
      `warning: ${SHEET_PATH} is ${sheet.width}×${sheet.height}, which is not a whole number of ` +
        `${size}px cells — the file is from an older bake. Pass --fresh.`,
    );
  }

  if (mode === 'composite') {
    const drawn = size * scale;
    const canvas = createCanvas(
      MARGIN * 2 + COMPOSITE_HEADINGS * drawn,
      MARGIN * 2 + LABEL_HEIGHT + drawn,
    );
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = ARENA_FLOOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    label(ctx, `composite — shadow + roll rotated to heading + shade, on the arena floor`, MARGIN, MARGIN);
    const states = compositeStates();
    for (let i = 0; i < COMPOSITE_HEADINGS; i++) {
      const heading = (i / COMPOSITE_HEADINGS) * Math.PI * 2;
      drawComposite(
        ctx,
        sheet,
        size,
        states,
        Math.floor((i / COMPOSITE_HEADINGS) * BOS_ROLL_FRAMES),
        heading,
        MARGIN + i * drawn,
        MARGIN + LABEL_HEIGHT,
        scale,
      );
    }
    writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
    console.log(`→ ${outPath} (${canvas.width}×${canvas.height})`);
    return;
  }

  const rows = only === null ? ROWS : [stateOf(only)];
  const columns = Math.max(...rows.map((row) => row.frameCount));
  const drawn = size * scale;
  const canvas = createCanvas(
    MARGIN * 2 + columns * drawn,
    MARGIN * 2 + rows.length * (drawn + LABEL_HEIGHT) + LABEL_HEIGHT + IN_GAME_TILE * 6,
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
      const sourceY = row.sheetRow * size;
      ctx.fillStyle = ARENA_FLOOR;
      ctx.fillRect(x, y, drawn, drawn);
      if (mode === 'onion' && col > 0) {
        ctx.save();
        ctx.globalAlpha = ONION_ALPHA;
        ctx.drawImage(
          sheet,
          (row.colOffset + col - 1) * size,
          sourceY,
          size,
          size,
          x,
          y,
          drawn,
          drawn,
        );
        ctx.restore();
      }
      ctx.drawImage(sheet, (row.colOffset + col) * size, sourceY, size, size, x, y, drawn, drawn);
      ctx.strokeStyle = GRID_LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, drawn - 1, drawn - 1);
      // The anchor crosshair: the rotation pivot, and the thing every row has to
      // be concentric on.
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
  const states = compositeStates();
  for (let col = 0; col < BOS_ROLL_FRAMES; col++) {
    drawComposite(
      ctx,
      sheet,
      size,
      states,
      col,
      0,
      MARGIN + col * gameDrawn,
      y,
      gameScale,
    );
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`→ ${outPath} (${canvas.width}×${canvas.height})`);
}

void main();
