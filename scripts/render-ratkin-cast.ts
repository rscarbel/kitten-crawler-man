#!/usr/bin/env tsx
/**
 * Review harness for the Briar Hollow ratkin cast.
 *
 * Art is judged as an image. This bakes, from the same `FigureDef`s the runtime
 * cache paints:
 *
 *   preview/ratkin-cast/lineup.png      every character's idle in all three views,
 *                                       at in-game size on village ground and at 3×
 *   preview/ratkin-cast/<id>.png        one character: every row, every frame, at
 *                                       3×, plus each row's first frame at game size
 *   preview/ratkin-cast/blind.png       the in-game lineup, shuffled and numbered
 *                                       (`--blind`), for a reviewer matching roles
 *
 *   npm run render:ratkin-cast
 *   npx tsx scripts/render-ratkin-cast.ts --id=oren
 *   npx tsx scripts/render-ratkin-cast.ts --lineup-only
 *   npx tsx scripts/render-ratkin-cast.ts --blind --seed=7
 *
 * The gates run first, ahead of the multi-megapixel allocations.
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakeFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { ratkinCastGateFailures } from './gates-ratkin-cast.js';
import { TILE_SIZE } from '../src/core/constants.js';
import {
  RATKIN_CAST_TILE_SCALE,
  castRowsFor,
  ratkinCastFigure,
} from '../src/sprites/art/ratkinCastFigure.js';
import { RATKIN_CAST_IDS, type RatkinCastId } from '../src/sprites/art/ratkin/cast.js';
import { thrallFigure } from '../src/sprites/art/thrallFigure.js';
import { drawThrall, THRALL_STATES } from '../src/sprites/thrallSprite.js';
import { asGameContext } from './nodeGameContext.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

const OUT_DIR = `${PREVIEW_DIR}/ratkin-cast`;
const REVIEW_SCALE = 3;
const PADDING = 8;
const LABEL_HEIGHT = 20;
const BACKDROP = '#3b3b40';
/** Packed earth and grass: what a villager actually stands on. */
const VILLAGE_GROUND = '#5d6440';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '13px sans-serif';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const LINEUP_VIEWS = ['idle', 'idle_side', 'idle_away'] as const;
/** Game pixels per art pixel: the cast is painted at 64px tiles, the game draws 32. */
const IN_GAME_SCALE = TILE_SIZE / RATKIN_CAST_TILE_SCALE;
/** Characters per line of the lineup. */
const LINEUP_COLUMNS = 7;

function flag(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? null : match.slice(prefix.length);
}

function isCastId(value: string): value is RatkinCastId {
  return RATKIN_CAST_IDS.some((id) => id === value);
}

const cellCache = new Map<string, Canvas>();

function cell(id: RatkinCastId, state: string, frame: number): Canvas {
  const key = `${id}/${state}/${frame}`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const baked = bakeFigureCell(ratkinCastFigure(id), state, frame);
  cellCache.set(key, baked);
  return baked;
}

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.fillText(text, x, y + LABEL_HEIGHT - PADDING / 2);
}

/** One character's full sheet: every row at 3×, then a game-size strip. */
function renderCharacter(id: RatkinCastId): string {
  const figure = ratkinCastFigure(id);
  const rows = castRowsFor(id);
  const cellSize = figure.frameWidth * IN_GAME_SCALE * REVIEW_SCALE;
  const cellHeight = figure.frameHeight * IN_GAME_SCALE * REVIEW_SCALE;
  const maxFrames = Math.max(...rows.map((row) => row.frameCount));
  const gameCell = figure.frameWidth * IN_GAME_SCALE;
  const gameCellHeight = figure.frameHeight * IN_GAME_SCALE;
  const width = Math.max(
    PADDING + maxFrames * (cellSize + PADDING),
    PADDING + rows.length * (gameCell + PADDING),
  );
  const height =
    PADDING +
    rows.length * (LABEL_HEIGHT + cellHeight + PADDING) +
    LABEL_HEIGHT +
    gameCellHeight +
    PADDING;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;

  let y = PADDING;
  for (const row of rows) {
    const events = row.events === undefined ? '' : ` ${JSON.stringify(row.events)}`;
    label(
      ctx,
      `${id} · ${row.name} — ${row.frameCount} frames${row.loops ? ', loop' : ''}${events}`,
      PADDING,
      y,
    );
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const x = PADDING + frame * (cellSize + PADDING);
      ctx.drawImage(cell(id, row.name, frame), x, y, cellSize, cellHeight);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellSize, cellHeight);
    }
    y += cellHeight + PADDING;
  }
  label(ctx, `in-game size (${TILE_SIZE}px tile), first frame of each row`, PADDING, y);
  y += LABEL_HEIGHT;
  ctx.fillStyle = VILLAGE_GROUND;
  ctx.fillRect(0, y, width, gameCellHeight);
  ctx.imageSmoothingEnabled = true;
  rows.forEach((row, index) => {
    ctx.drawImage(
      cell(id, row.name, 0),
      PADDING + index * (gameCell + PADDING),
      y,
      gameCell,
      gameCellHeight,
    );
  });
  const out = `${OUT_DIR}/${id}.png`;
  writePreviewPng(out, canvas.toBuffer('image/png'));
  return out;
}

/** The classic C-library linear congruential generator: small, and the same on every machine. */
const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MODULUS = 2147483648;

/** A small deterministic shuffle, so a blind round can be reproduced. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  const next = (): number => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return state / LCG_MODULUS;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface LineupOptions {
  readonly ids: readonly RatkinCastId[];
  readonly scale: number;
  /** Replaces each name with its position, for a blind round. */
  readonly anonymous: boolean;
  readonly ground: string;
}

function renderLineup(options: LineupOptions): Canvas {
  const figure = ratkinCastFigure(options.ids[0]);
  const cellWidth = figure.frameWidth * IN_GAME_SCALE * options.scale;
  const cellHeight = figure.frameHeight * IN_GAME_SCALE * options.scale;
  const groupWidth = LINEUP_VIEWS.length * cellWidth + PADDING;
  const lines = Math.ceil(options.ids.length / LINEUP_COLUMNS);
  const width = PADDING + LINEUP_COLUMNS * (groupWidth + PADDING);
  const height = PADDING + lines * (LABEL_HEIGHT + cellHeight + PADDING);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = options.ground;
  ctx.fillRect(0, 0, width, height);
  options.ids.forEach((id, index) => {
    const column = index % LINEUP_COLUMNS;
    const line = Math.floor(index / LINEUP_COLUMNS);
    const x = PADDING + column * (groupWidth + PADDING);
    const y = PADDING + line * (LABEL_HEIGHT + cellHeight + PADDING);
    label(ctx, options.anonymous ? `#${index + 1}` : id, x, y);
    LINEUP_VIEWS.forEach((state, viewIndex) => {
      ctx.drawImage(
        cell(id, state, 0),
        x + viewIndex * cellWidth,
        y + LABEL_HEIGHT,
        cellWidth,
        cellHeight,
      );
    });
  });
  return canvas;
}

/**
 * Both thralls in every row they are drawn in, one frame of each, as the cell
 * paints them and as the runtime shows them — washed and translucent — at the
 * game's own tile size.
 */
function renderThralls(): string {
  // The thrall's translucency is composed on a scratch canvas the runtime allocates.
  installCanvasGlobals();
  const tools = ['axe', 'pickaxe'] as const;
  const figure = thrallFigure('axe');
  const cellWidth = figure.frameWidth * IN_GAME_SCALE * REVIEW_SCALE;
  const cellHeight = figure.frameHeight * IN_GAME_SCALE * REVIEW_SCALE;
  const rowsPerTool = 2;
  const width = PADDING + THRALL_STATES.length * (cellWidth + PADDING);
  const height = PADDING + tools.length * rowsPerTool * (LABEL_HEIGHT + cellHeight + PADDING);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = VILLAGE_GROUND;
  ctx.fillRect(0, 0, width, height);
  const tile = TILE_SIZE * REVIEW_SCALE;
  tools.forEach((tool, toolIndex) => {
    THRALL_STATES.forEach((state, stateIndex) => {
      const x = PADDING + stateIndex * (cellWidth + PADDING);
      const rawY = PADDING + toolIndex * rowsPerTool * (LABEL_HEIGHT + cellHeight + PADDING);
      const ghostY = rawY + LABEL_HEIGHT + cellHeight + PADDING;
      label(ctx, `${tool} ${state}`, x, rawY);
      ctx.drawImage(
        bakeFigureCell(thrallFigure(tool), state, 0),
        x,
        rawY + LABEL_HEIGHT,
        cellWidth,
        cellHeight,
      );
      const look = { tool, state, frame: 0, flipX: false, presence: 1, trailX: 0, trailY: 0 };
      const tileLeft = x + (figure.tileX / figure.tileScale) * tile;
      const tileTop = ghostY + LABEL_HEIGHT + (figure.tileY / figure.tileScale) * tile;
      drawThrall(asGameContext(ctx), look, tileLeft, tileTop, tile);
    });
  });
  const out = `${OUT_DIR}/thralls.png`;
  writePreviewPng(out, canvas.toBuffer('image/png'));
  return out;
}

function main(): void {
  console.log('Gating the ratkin cast…');
  reportFigureGates('ratkin cast', ratkinCastGateFailures());

  const only = flag('id');
  if (only !== null) {
    if (!isCastId(only))
      throw new Error(`--id=${only} is not a cast id: ${RATKIN_CAST_IDS.join(', ')}`);
    console.log(`Wrote ${renderCharacter(only)}`);
    return;
  }

  if (process.argv.includes('--blind')) {
    const seed = Number(flag('seed') ?? '1');
    const order = shuffled(RATKIN_CAST_IDS, seed);
    const blind = renderLineup({ ids: order, scale: 1, anonymous: true, ground: VILLAGE_GROUND });
    writePreviewPng(`${OUT_DIR}/blind.png`, blind.toBuffer('image/png'));
    const close = renderLineup({ ids: order, scale: 2, anonymous: true, ground: VILLAGE_GROUND });
    writePreviewPng(`${OUT_DIR}/blind-2x.png`, close.toBuffer('image/png'));
    console.log(
      `Wrote ${OUT_DIR}/blind.png and blind-2x.png; key: ${order.map((id, i) => `#${i + 1}=${id}`).join(' ')}`,
    );
    return;
  }

  const lineup = renderLineup({
    ids: RATKIN_CAST_IDS,
    scale: 1,
    anonymous: false,
    ground: VILLAGE_GROUND,
  });
  writePreviewPng(`${OUT_DIR}/lineup.png`, lineup.toBuffer('image/png'));
  const close = renderLineup({
    ids: RATKIN_CAST_IDS,
    scale: REVIEW_SCALE,
    anonymous: false,
    ground: BACKDROP,
  });
  writePreviewPng(`${OUT_DIR}/lineup-3x.png`, close.toBuffer('image/png'));
  console.log(`Wrote ${OUT_DIR}/lineup.png and lineup-3x.png`);
  console.log(`Wrote ${renderThralls()}`);
  if (process.argv.includes('--lineup-only')) return;
  for (const id of RATKIN_CAST_IDS) console.log(`Wrote ${renderCharacter(id)}`);
}

main();
