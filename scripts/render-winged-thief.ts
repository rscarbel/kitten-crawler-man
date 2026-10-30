/**
 * Review harness for the missing-cats thief over the roofs: every wingbeat
 * frame of both rows at the bake's own size, then the figure drawn through
 * `drawWingedThief`, the game's own path, at the size it flies at over a
 * dusky roofscape, turned to eight headings, and that blown up
 * nearest-neighbour so the in-game pixels can be judged.
 *
 *   npx tsx scripts/render-winged-thief.ts
 *
 * Writes `sheet.png` and `in-game.png` under `preview/missing-cats/rooftop-thief/`.
 */

import { createCanvas, type Canvas } from 'canvas';
import { join } from 'node:path';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { bakeFigureSheet } from './figureSheet.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { beginFigureFrame } from '../src/sprites/figure/figureFrameCache.js';
import {
  drawWingedThief,
  drawWingedThiefShadow,
  wingedThiefFigure,
  WINGED_THIEF_SIZE_TILES,
} from '../src/sprites/art/wingedThiefFigure.js';

installCanvasGlobals();

const OUT_DIR = join(PREVIEW_DIR, 'missing-cats', 'rooftop-thief');
const TILE = 32;
const THIEF_SIZE = TILE * WINGED_THIEF_SIZE_TILES;
/** A share of the flight height, enough to lift it clear of its shadow without leaving its cell. */
const LIFT_TILES = 1.1;
const PIXEL_ZOOM = 3;
const HEADINGS = 8;
const WINGBEAT_FRAMES = 8;
const BACKDROP = '#2a2a33';
const ROOF_A = '#4a3a3a';
const ROOF_B = '#5a4436';
const STREET = '#3a3d44';
const DUSK = 'rgba(40, 30, 70, 0.45)';
const CELL_TILES = 3;
const CELL = TILE * CELL_TILES;
const BLOCK_TILES_X = 4;
const BLOCK_TILES_Y = 3;
const BLOCK_KINDS = 3;
const TURNED_ROWS = 2;
const HEADING_ROW_BEAT = 0.25;
const GROUND_SHARE = 0.85;

function roofscape(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  for (let y = 0; y < height; y += TILE) {
    for (let x = 0; x < width; x += TILE) {
      const block =
        (Math.floor(x / (TILE * BLOCK_TILES_X)) + Math.floor(y / (TILE * BLOCK_TILES_Y))) %
        BLOCK_KINDS;
      ctx.fillStyle = block === 0 ? STREET : block === 1 ? ROOF_A : ROOF_B;
      ctx.fillRect(x, y, TILE, TILE);
    }
  }
  ctx.fillStyle = DUSK;
  ctx.fillRect(0, 0, width, height);
}

function sheet(): void {
  const baked = bakeFigureSheet(wingedThiefFigure());
  const out = createCanvas(baked.canvas.width, baked.canvas.height);
  const ctx = out.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(baked.canvas, 0, 0);
  console.log(writePreviewPng(join(OUT_DIR, 'sheet.png'), out.toBuffer('image/png')));
}

function inGame(): void {
  const rows = TURNED_ROWS * 2;
  const width = HEADINGS * CELL;
  const height = rows * CELL;
  const small = createCanvas(width, height);
  const ctx = asGameContext(small.getContext('2d'));
  roofscape(ctx, width, height);
  for (let row = 0; row < rows; row++) {
    const carrying = row % 2 === 1;
    for (let column = 0; column < HEADINGS; column++) {
      beginFigureFrame();
      const heading = row < TURNED_ROWS ? (column / HEADINGS) * Math.PI * 2 : 0;
      const beat = row < TURNED_ROWS ? HEADING_ROW_BEAT : column / WINGBEAT_FRAMES;
      const groundX = column * CELL + CELL / 2;
      const groundY = row * CELL + CELL * GROUND_SHARE;
      ctx.save();
      ctx.translate(groundX, groundY);
      drawWingedThiefShadow(ctx, THIEF_SIZE);
      ctx.restore();
      ctx.save();
      ctx.translate(groundX, groundY - TILE * LIFT_TILES);
      drawWingedThief(ctx, THIEF_SIZE, heading, beat, carrying);
      ctx.restore();
    }
  }
  console.log(writePreviewPng(join(OUT_DIR, 'in-game.png'), small.toBuffer('image/png')));
  const big: Canvas = createCanvas(width * PIXEL_ZOOM, height * PIXEL_ZOOM);
  const bigCtx = big.getContext('2d');
  bigCtx.imageSmoothingEnabled = false;
  bigCtx.drawImage(small, 0, 0, width * PIXEL_ZOOM, height * PIXEL_ZOOM);
  console.log(writePreviewPng(join(OUT_DIR, 'in-game-zoomed.png'), big.toBuffer('image/png')));
}

sheet();
inGame();
