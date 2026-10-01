#!/usr/bin/env tsx
/**
 * Review harness for GumGum, the murder mystery's victim: the living orc on
 * Carl's rig and the body found in the alley. Runs the gates first, then
 * writes review sheets:
 *
 *   preview/gumgum/figure.png   every row she paints, enlarged, plus the idle
 *                               at true in-game size beside a street citizen
 *   preview/gumgum/corpse.png   the alley body enlarged, and at true in-game
 *                               size on an alley floor beside her living self
 *
 *   npm run render:gumgum
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakeFigureCell, figureStateNames } from './figureSheet.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { townCastOutfitFigure, townCastStateName } from '../src/sprites/art/townCastFigure.js';
import { townCastLook } from '../src/sprites/person/townCastLooks.js';
import { GUMGUM_FIGURE } from '../src/sprites/art/gumGumFigure.js';
import { GUMGUM_CORPSE_FIGURE, GUMGUM_CORPSE_STATE } from '../src/sprites/art/gumGumCorpseArt.js';
import { GUMGUM_DRAW_SCALE, GUMGUM_STANDING_STATE } from '../src/sprites/gumGumSprite.js';
import { gumGumGateFailures } from './gates-gumgum.js';
import { reportFigureGates } from './figureGates.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

const OUT_DIR = `${PREVIEW_DIR}/gumgum`;
const REVIEW_SCALE = 3;
const PADDING = 12;
const LABEL_HEIGHT = 16;
const BACKDROP = '#3b3b40';
const STREET_GROUND = '#6f675d';
const ALLEY_GROUND = '#4c4842';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '12px sans-serif';
/** Women of the street cast, to calibrate her read against at true size. */
const COMPARISON_LOOK_IDS: readonly string[] = ['resident_marta_miller', 'adult_merchant'];
/** True in-game strip: this many tiles square. */
const IN_GAME_TILES_WIDE = 6;
const IN_GAME_TILES_HIGH = 3;
/** The in-game strip is also shown doubled, nearest-neighbour, so its pixels can be read. */
const IN_GAME_ZOOM = 3;
const GRID_LINE = 'rgba(0,0,0,0.12)';
/** Centres a one-pixel grid line on its pixel. */
const HALF_PIXEL = 0.5;
/** Tile columns the in-game strips stand their figures on. */
const SUBJECT_COLUMN = 2;
const NEIGHBOUR_COLUMN = 4;

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

function sheetOfStates(def: FigureDef, states: readonly string[]): Canvas {
  const cells = states.map((state) => ({ state, cell: bakeFigureCell(def, state, 0) }));
  const cellW = Math.max(...cells.map((c) => c.cell.width)) * REVIEW_SCALE;
  const cellH = Math.max(...cells.map((c) => c.cell.height)) * REVIEW_SCALE;
  const canvas = createCanvas(
    (cellW + PADDING) * cells.length + PADDING,
    cellH + LABEL_HEIGHT + PADDING * 2,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  cells.forEach(({ state, cell }, index) => {
    const x = PADDING + index * (cellW + PADDING);
    ctx.drawImage(cell, x, PADDING, cell.width * REVIEW_SCALE, cell.height * REVIEW_SCALE);
    label(ctx, state, x + cellW / 2, PADDING + cellH + LABEL_HEIGHT - 2);
  });
  return canvas;
}

/** Draws a cell the way `drawFigureCached` does: the def's tile box at `tileSize` px, top-left at (x, y). */
function drawAtTile(
  ctx: NodeCtx,
  def: FigureDef,
  cell: Canvas,
  x: number,
  y: number,
  tileSize: number,
): void {
  const scale = tileSize / def.tileScale;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    cell,
    x - def.tileX * scale,
    y - def.tileY * scale,
    cell.width * scale,
    cell.height * scale,
  );
}

function inGameStrip(ground: string, paint: (ctx: NodeCtx) => void): Canvas {
  const width = TILE_SIZE * IN_GAME_TILES_WIDE;
  const height = TILE_SIZE * IN_GAME_TILES_HIGH;
  const strip = createCanvas(width, height);
  const ctx = strip.getContext('2d');
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = GRID_LINE;
  for (let x = 0; x <= width; x += TILE_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x + HALF_PIXEL, 0);
    ctx.lineTo(x + HALF_PIXEL, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += TILE_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y + HALF_PIXEL);
    ctx.lineTo(width, y + HALF_PIXEL);
    ctx.stroke();
  }
  paint(ctx);
  const zoomed = createCanvas(width * (1 + IN_GAME_ZOOM) + PADDING, height * IN_GAME_ZOOM);
  const zctx = zoomed.getContext('2d');
  zctx.fillStyle = BACKDROP;
  zctx.fillRect(0, 0, zoomed.width, zoomed.height);
  zctx.drawImage(strip, 0, 0);
  zctx.imageSmoothingEnabled = false;
  zctx.drawImage(strip, width + PADDING, 0, width * IN_GAME_ZOOM, height * IN_GAME_ZOOM);
  return zoomed;
}

function stack(parts: readonly Canvas[]): Canvas {
  const width = Math.max(...parts.map((p) => p.width));
  const height = parts.reduce((sum, p) => sum + p.height + PADDING, PADDING);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  let y = PADDING;
  for (const part of parts) {
    ctx.drawImage(part, 0, y);
    y += part.height + PADDING;
  }
  return canvas;
}

/** Her living sprite box at `tileSize`, matching `GumGum.drawSelf`. */
function gumGumBoxSize(tileSize: number): number {
  return tileSize * GUMGUM_DRAW_SCALE;
}

function renderFigureSheet(): Canvas {
  const figure = GUMGUM_FIGURE;
  const castIdle = townCastStateName('idle', 'down');
  const rows = sheetOfStates(figure, figureStateNames(figure));
  const strip = inGameStrip(STREET_GROUND, (ctx) => {
    const groundRow = 1;
    const size = gumGumBoxSize(TILE_SIZE);
    const grow = size - TILE_SIZE;
    drawAtTile(
      ctx,
      figure,
      bakeFigureCell(figure, GUMGUM_STANDING_STATE, 0),
      TILE_SIZE * SUBJECT_COLUMN - grow / 2,
      TILE_SIZE * groundRow - grow,
      size,
    );
    COMPARISON_LOOK_IDS.forEach((id, index) => {
      const comparison = townCastOutfitFigure(townCastLook(id));
      drawAtTile(
        ctx,
        comparison,
        bakeFigureCell(comparison, castIdle, 0),
        TILE_SIZE * (SUBJECT_COLUMN + 1 + index),
        TILE_SIZE * groundRow,
        TILE_SIZE,
      );
    });
  });
  return stack([rows, strip]);
}

function renderCorpseSheet(): Canvas {
  const corpse = GUMGUM_CORPSE_FIGURE;
  const living = GUMGUM_FIGURE;
  const big = sheetOfStates(corpse, figureStateNames(corpse));
  const strip = inGameStrip(ALLEY_GROUND, (ctx) => {
    drawAtTile(
      ctx,
      corpse,
      bakeFigureCell(corpse, GUMGUM_CORPSE_STATE, 0),
      TILE_SIZE * SUBJECT_COLUMN,
      TILE_SIZE,
      TILE_SIZE,
    );
    const size = gumGumBoxSize(TILE_SIZE);
    const grow = size - TILE_SIZE;
    drawAtTile(
      ctx,
      living,
      bakeFigureCell(living, GUMGUM_STANDING_STATE, 0),
      TILE_SIZE * NEIGHBOUR_COLUMN - grow / 2,
      TILE_SIZE - grow,
      size,
    );
  });
  return stack([big, strip]);
}

function main(): void {
  const ok = reportFigureGates('gumgum', gumGumGateFailures());
  writePreviewPng(`${OUT_DIR}/figure.png`, renderFigureSheet().toBuffer('image/png'));
  writePreviewPng(`${OUT_DIR}/corpse.png`, renderCorpseSheet().toBuffer('image/png'));
  if (!ok) process.exitCode = 1;
}

main();
