/**
 * Review harness for the prison's key: the pedestal lit with the key floating
 * over it at several points of its turn, the empty pedestal dimmed, at review
 * size and at the in-game tile size, on the prison's dark floor, plus the
 * inventory icon at hotbar and panel sizes.
 *
 *   npm run render:prison-key
 */

import { createCanvas, type Canvas } from 'canvas';

import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  PRISON_KEY_CENTRE_ABOVE_BASE_TILES,
  drawKeyPedestal,
  drawPrisonKey,
} from '../src/sprites/art/prisonKeyArt.js';
import { drawPrisonKeyIcon } from '../src/sprites/art/itemIcons/prisonKeyIcon.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const REVIEW_TILE = 64;
const IN_GAME_ZOOM = 2;
/** Moments of the key's turn to show, in seconds: face-on, turning, edge-on, back, turning back. */
const TURN_MOMENTS: readonly number[] = [0, 0.6, 1.25, 2.5, 3.4];
const SLOT_TILES_WIDE = 2.4;
const SLOT_TILES_TALL = 4.2;
const FLOOR = '#22201f';
const FLOOR_GRID = 'rgba(255,255,255,0.06)';
const ICON_SIZES: readonly number[] = [24, 48, 96];
const ICON_BACKDROP = '#3a3530';
const PADDING = 12;

function paintRow(tile: number): Canvas {
  const slotW = SLOT_TILES_WIDE * tile;
  const slotH = SLOT_TILES_TALL * tile;
  const slots = TURN_MOMENTS.length + 1;
  const canvas = createCanvas(Math.ceil(slotW * slots), Math.ceil(slotH));
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = FLOOR_GRID;
  for (let x = 0; x < canvas.width; x += tile) ctx.strokeRect(x, 0, tile, canvas.height);
  for (let y = 0; y < canvas.height; y += tile) ctx.strokeRect(0, y, canvas.width, tile);
  const baseY = slotH - tile / 2;
  TURN_MOMENTS.forEach((t, i) => {
    const cx = slotW * (i + 0.5);
    drawKeyPedestal(ctx, cx, baseY, true, tile);
    drawPrisonKey(ctx, cx, baseY - PRISON_KEY_CENTRE_ABOVE_BASE_TILES * tile, t, tile);
  });
  drawKeyPedestal(ctx, slotW * (slots - 0.5), baseY, false, tile);
  return canvas;
}

function zoom(small: Canvas, factor: number): Canvas {
  const out = createCanvas(small.width * factor, small.height * factor);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

function paintIcons(): Canvas {
  const width = ICON_SIZES.reduce((sum, size) => sum + size + PADDING, PADDING);
  const height = Math.max(...ICON_SIZES) + PADDING * 2;
  const canvas = createCanvas(width, height);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = ICON_BACKDROP;
  ctx.fillRect(0, 0, width, height);
  let x = PADDING;
  for (const size of ICON_SIZES) {
    drawPrisonKeyIcon(ctx, { x, y: PADDING, w: size, h: size });
    x += size + PADDING;
  }
  return canvas;
}

function main(): void {
  const review = paintRow(REVIEW_TILE);
  const inGame = zoom(paintRow(IN_GAME_TILE), IN_GAME_ZOOM);
  const icons = paintIcons();
  const sheet = createCanvas(
    Math.max(review.width, inGame.width, icons.width),
    review.height + inGame.height + icons.height,
  );
  const ctx = sheet.getContext('2d');
  ctx.drawImage(review, 0, 0);
  ctx.drawImage(inGame, 0, review.height);
  ctx.drawImage(icons, 0, review.height + inGame.height);
  const path = writePreviewPng(`${PREVIEW_DIR}/prison-key.png`, sheet.toBuffer('image/png'));
  console.log(`Wrote ${path}`);
}

main();
