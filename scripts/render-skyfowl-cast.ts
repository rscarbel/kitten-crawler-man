#!/usr/bin/env tsx
/**
 * Review harness for the skyfowl street cast.
 *
 * Art is judged as an image. This bakes, from the same `FigureDef`s the
 * runtime cache paints:
 *
 *   preview/skyfowl-cast/lineup.png       every civilian look's idle in all three
 *                                         views, at in-game size on plaza ground and 3x
 *   preview/skyfowl-cast/<id>.png         one look: every row, every frame, at 3x,
 *                                         plus each row's first frame at game size
 *   preview/skyfowl-cast/blind.png        the in-game lineup, shuffled and numbered
 *                                         (`--blind`), for a reviewer matching roles
 *   preview/skyfowl-cast/mixed.png        civilian looks beside the street-tough
 *                                         family, for spotting the fightable ones
 *
 *   npm run render:skyfowl-cast
 *   npx tsx scripts/render-skyfowl-cast.ts --id=guard_hawkbrown_standard
 *   npx tsx scripts/render-skyfowl-cast.ts --lineup-only
 *   npx tsx scripts/render-skyfowl-cast.ts --blind --seed=7
 *
 * The gates run first, ahead of the multi-megapixel allocations.
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakeFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { skyfowlCastGateFailures } from './gates-skyfowl-cast.js';
import { TILE_SIZE } from '../src/core/constants.js';
import {
  SKYFOWL_CAST_TILE_SCALE,
  castRowsFor,
  skyfowlCastFigure,
} from '../src/sprites/art/skyfowlCastFigure.js';
import {
  SKYFOWL_CIVILIAN_LOOKS,
  SKYFOWL_LOOKS,
  SKYFOWL_TOUGH_LOOKS,
  type SkyfowlLookId,
} from '../src/sprites/art/skyfowl/cast.js';

const OUT_DIR = `${PREVIEW_DIR}/skyfowl-cast`;
const REVIEW_SCALE = 3;
const PADDING = 8;
const LABEL_HEIGHT = 20;
/** A cool neutral, deliberately far from both the warm plumage browns/golds and the guard/clerk blues, so neither camouflages against it. */
const BACKDROP = '#4a4e58';
/** Flagstone plaza, two value steps so the sheet reads as ground rather than a flat backdrop. */
const PLAZA_GROUND_A = '#5f6670';
const PLAZA_GROUND_B = '#5a6069';
const GROUND_TILE_PX = 24;

function paintGroundTile(ctx: NodeCtx, x: number, y: number, width: number, height: number): void {
  for (let ty = 0; ty < height; ty += GROUND_TILE_PX) {
    for (let tx = 0; tx < width; tx += GROUND_TILE_PX) {
      const even = (Math.floor(tx / GROUND_TILE_PX) + Math.floor(ty / GROUND_TILE_PX)) % 2 === 0;
      ctx.fillStyle = even ? PLAZA_GROUND_A : PLAZA_GROUND_B;
      ctx.fillRect(
        x + tx,
        y + ty,
        Math.min(GROUND_TILE_PX, width - tx),
        Math.min(GROUND_TILE_PX, height - ty),
      );
    }
  }
}
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '13px sans-serif';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const LINEUP_VIEWS = ['idle', 'idle_side', 'idle_away'] as const;
/** Game pixels per art pixel: the cast is painted at 64px tiles, the game draws 32. */
const IN_GAME_SCALE = TILE_SIZE / SKYFOWL_CAST_TILE_SCALE;
const LINEUP_COLUMNS = 6;

function flag(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? null : match.slice(prefix.length);
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isLookId(value: string): value is SkyfowlLookId {
  return SKYFOWL_LOOKS.some((look) => look.id === value);
}

const cellCache = new Map<string, Canvas>();

function cell(id: SkyfowlLookId, state: string, frame: number): Canvas {
  const key = `${id}/${state}/${frame}`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const baked = bakeFigureCell(skyfowlCastFigure(id), state, frame);
  cellCache.set(key, baked);
  return baked;
}

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.fillText(text, x, y + LABEL_HEIGHT - PADDING / 2);
}

/** One look's full sheet: every row at 3x, then a game-size strip. */
function renderLook(id: SkyfowlLookId): string {
  const figure = skyfowlCastFigure(id);
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
  paintGroundTile(ctx, 0, y, width, gameCellHeight);
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

const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MODULUS = 2147483648;

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
  readonly ids: readonly SkyfowlLookId[];
  readonly scale: number;
  readonly anonymous: boolean;
  readonly columns: number;
}

function renderLineup(options: LineupOptions): Canvas {
  const figure = skyfowlCastFigure(options.ids[0]);
  const cellWidth = figure.frameWidth * IN_GAME_SCALE * options.scale;
  const cellHeight = figure.frameHeight * IN_GAME_SCALE * options.scale;
  const groupWidth = LINEUP_VIEWS.length * cellWidth + PADDING;
  const lines = Math.ceil(options.ids.length / options.columns);
  const width = PADDING + options.columns * (groupWidth + PADDING);
  const height = PADDING + lines * (LABEL_HEIGHT + cellHeight + PADDING);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  paintGroundTile(ctx, 0, 0, width, height);
  options.ids.forEach((id, index) => {
    const column = index % options.columns;
    const line = Math.floor(index / options.columns);
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

function main(): void {
  const gateFailures = skyfowlCastGateFailures();
  reportFigureGates('skyfowl-cast', gateFailures);

  const seed = Number(flag('seed') ?? '11');
  const onlyId = flag('id');

  if (onlyId !== null) {
    if (!isLookId(onlyId)) throw new Error(`no skyfowl look "${onlyId}"`);
    const out = renderLook(onlyId);
    console.log(`wrote ${out}`);
    return;
  }

  if (has('blind')) {
    const shuffledIds = shuffled(
      SKYFOWL_LOOKS.map((look) => look.id),
      seed,
    );
    const canvas = renderLineup({
      ids: shuffledIds,
      scale: 1,
      anonymous: true,
      columns: LINEUP_COLUMNS,
    });
    const out = writePreviewPng(`${OUT_DIR}/blind.png`, canvas.toBuffer('image/png'));
    console.log(`wrote ${out} (seed=${seed}); answer key:`);
    shuffledIds.forEach((id, index) => console.log(`  #${index + 1} ${id}`));
    return;
  }

  const lineupCanvas = renderLineup({
    ids: SKYFOWL_CIVILIAN_LOOKS.map((look) => look.id),
    scale: REVIEW_SCALE,
    anonymous: false,
    columns: LINEUP_COLUMNS,
  });
  const lineupOut = writePreviewPng(`${OUT_DIR}/lineup.png`, lineupCanvas.toBuffer('image/png'));
  console.log(`wrote ${lineupOut}`);

  const mixedCanvas = renderLineup({
    ids: [...SKYFOWL_CIVILIAN_LOOKS, ...SKYFOWL_TOUGH_LOOKS].map((look) => look.id),
    scale: REVIEW_SCALE,
    anonymous: false,
    columns: LINEUP_COLUMNS,
  });
  const mixedOut = writePreviewPng(`${OUT_DIR}/mixed.png`, mixedCanvas.toBuffer('image/png'));
  console.log(`wrote ${mixedOut}`);

  if (has('lineup-only')) return;

  for (const look of SKYFOWL_LOOKS) {
    const out = renderLook(look.id);
    console.log(`wrote ${out}`);
  }
}

main();
