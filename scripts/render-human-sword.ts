/**
 * Review harness for the Fury of Taranis in Carl's hand: his standing rows and
 * every hand-thrown blow in all three views, with the sword drawn over them
 * exactly as the game draws it.
 *
 *   npm run render:human-sword
 *   npx tsx scripts/render-human-sword.ts --out=preview/human-sword.png
 *
 * Bakes one sheet: each row large (mirrored profile rows included, which is
 * how he faces west), then every row at the 32 px tile on a dungeon floor and
 * the same strip blown up nearest-neighbour so a reviewer can judge the
 * in-game pixels. No gates: the sword adds no cells to his figure, and his own
 * gates run under `render:human`.
 */

import { createCanvas, type Canvas } from 'canvas';
import { asGameContext, type NodeContext } from './nodeGameContext.js';
import { bakeFigureCell } from './figureSheet.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  eventFrame,
  FRAME_H,
  FRAME_W,
  HUMAN_FIGURE,
  HUMAN_ROW_TABLE,
  type HumanRowName,
  TILE_X,
  TILE_Y,
} from '../src/sprites/art/humanFigure.js';
import { TILE_SCALE } from '../src/sprites/art/human/figureScale.js';
import { drawHeldSword, heldSwordOf } from '../src/sprites/taranisSwordSprite.js';
import { SWORD_CRACKLE_PHASES } from '../src/sprites/art/carl/props/sword.js';

const DEFAULT_OUT = `${PREVIEW_DIR}/human-sword.png`;
const LABEL_FONT = '13px sans-serif';
const LABEL_HEIGHT = 18;
const LABEL_COLOR = '#e8e8e8';
const SHEET_BACKGROUND = '#34363c';
/** The in-game strips sit on dungeon flagstone, where most of his fights are. */
const FLOOR = '#4a4640';
const IN_GAME_TILE = 32;
const BLOW_UP = 3;
const LARGE_CROP_TOP = 10;
const LARGE_CROP_HEIGHT = 180;
const GAP = 6;
const SECTION_GAPS = 3;
/**
 * The large cells are spaced wider than the cell: a blade held out at full
 * reach runs past the cell's edge, which the game never clips.
 */
const LARGE_COLUMN_SPREAD = 1.6;

const REVIEW_ROWS: readonly HumanRowName[] = [
  'idle',
  'idle_side',
  'idle_away',
  'guard_side',
  'run_side',
  'jab_side',
  'cross_side',
  'hook_side',
  'roundhouse_side',
  'uppercut_up',
  'overhand_up',
  'hammer_fist_up',
  'hammer_down',
  'punt_down',
];

function parseOut(): string {
  const prefix = '--out=';
  const flag = process.argv.find((arg) => arg.startsWith(prefix));
  return flag === undefined ? DEFAULT_OUT : flag.slice(prefix.length);
}

function label(ctx: NodeContext, text: string, x: number, y: number): void {
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

const cellCache = new Map<string, Canvas>();

function cellOf(row: HumanRowName, frame: number): Canvas {
  const cacheKey = `${row}:${frame}`;
  const known = cellCache.get(cacheKey);
  if (known !== undefined) return known;
  const cell = bakeFigureCell(HUMAN_FIGURE, row, frame);
  cellCache.set(cacheKey, cell);
  return cell;
}

function frameCount(row: HumanRowName): number {
  return HUMAN_ROW_TABLE[row].frameCount;
}

/** One frame with the sword in hand, the cell's top-left at (`x`, `y`), mirrored when `flipX`. */
function drawArmedCell(
  ctx: NodeContext,
  row: HumanRowName,
  frame: number,
  x: number,
  y: number,
  scale: number,
  flipX: boolean,
): void {
  const placement = heldSwordOf({ row, frame, flipX });
  const tileSize = TILE_SCALE * scale;
  const sx = x + TILE_X * scale;
  const sy = y + TILE_Y * scale;
  const game = asGameContext(ctx);
  const phase = frame % SWORD_CRACKLE_PHASES;
  if (placement?.behindFigure === true) drawHeldSword(game, placement, sx, sy, tileSize, phase);
  ctx.save();
  if (flipX) {
    ctx.translate(x + (FRAME_W * scale) / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(x + (FRAME_W * scale) / 2), 0);
  }
  ctx.drawImage(cellOf(row, frame), x, y, FRAME_W * scale, FRAME_H * scale);
  ctx.restore();
  if (placement?.behindFigure === false) drawHeldSword(game, placement, sx, sy, tileSize, phase);
}

function render(): Canvas {
  const largeRows: { row: HumanRowName; flipX: boolean }[] = [];
  for (const row of REVIEW_ROWS) {
    largeRows.push({ row, flipX: false });
    if (HUMAN_ROW_TABLE[row].mirrorable && row === 'cross_side')
      largeRows.push({ row, flipX: true });
  }
  const maxFrames = Math.max(...REVIEW_ROWS.map(frameCount));
  const smallScale = IN_GAME_TILE / TILE_SCALE;
  const smallCellW = FRAME_W * smallScale;
  const smallCellH = FRAME_H * smallScale;
  const largeColumnW = FRAME_W * LARGE_COLUMN_SPREAD;
  const width = Math.max(maxFrames * largeColumnW, maxFrames * smallCellW * BLOW_UP) + GAP * 2;
  const largeBandH = LABEL_HEIGHT + LARGE_CROP_HEIGHT;
  const blowBandH = LABEL_HEIGHT + smallCellH * BLOW_UP;
  const height =
    largeRows.length * largeBandH + REVIEW_ROWS.length * blowBandH + SECTION_GAPS * GAP;

  const sheet = createCanvas(width, height);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = SHEET_BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  let y = GAP;
  for (const { row, flipX } of largeRows) {
    label(ctx, `${row}${flipX ? ' (facing −X)' : ''} — impact frame marked *`, GAP, y);
    y += LABEL_HEIGHT;
    const impact = eventFrame(row, 'impact') ?? HUMAN_ROW_TABLE[row].impactFrames[0];
    for (let frame = 0; frame < frameCount(row); frame++) {
      const x = GAP + frame * largeColumnW;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, largeColumnW, LARGE_CROP_HEIGHT);
      ctx.clip();
      drawArmedCell(ctx, row, frame, x, y - LARGE_CROP_TOP, 1, flipX);
      ctx.restore();
      label(ctx, frame === impact ? `${frame}*` : `${frame}`, x + GAP, y);
    }
    y += LARGE_CROP_HEIGHT;
  }

  y += GAP;
  for (const row of REVIEW_ROWS) {
    label(ctx, `${row} at the 32 px tile, blown up ${BLOW_UP}×`, GAP, y);
    y += LABEL_HEIGHT;
    const strip = createCanvas(frameCount(row) * smallCellW, smallCellH);
    const stripCtx = strip.getContext('2d');
    stripCtx.fillStyle = FLOOR;
    stripCtx.fillRect(0, 0, strip.width, strip.height);
    for (let frame = 0; frame < frameCount(row); frame++) {
      drawArmedCell(stripCtx, row, frame, frame * smallCellW, 0, smallScale, false);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(strip, GAP, y, strip.width * BLOW_UP, strip.height * BLOW_UP);
    ctx.imageSmoothingEnabled = true;
    y += smallCellH * BLOW_UP;
  }
  return sheet;
}

const written = writePreviewPng(parseOut(), render().toBuffer('image/png'));
console.log(`Wrote ${written}`);
