/**
 * Headless renderer for Tsarina Signet's summons — the two tattoo forms as
 * pixels, without a browser.
 *
 * The browser harness cannot drive this project (a hidden tab never clears the
 * level-intro banner and never runs `requestAnimationFrame`), so the art has to
 * be judgeable from a still. This runs the real draw function through
 * node-canvas and writes a contact sheet: each form's poses at review scale, a
 * strike strip, and the in-game tile size beside it.
 *
 *   npx tsx scripts/render-summons.ts --out=summons.png --scale=2
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';

import type { InkMarauderForm, InkMarauderPose } from '../src/sprites/inkMarauderSprite';

const {
  drawInkMarauderSprite,
  INK_MARAUDER_HEAD_CLEARANCE,
  INK_MARAUDER_HALF_WIDTH,
  INK_EMERGE_FRAMES,
} = await import('../src/sprites/inkMarauderSprite');

const DEFAULT_REVIEW_TILE_SIZE = 90;
const IN_GAME_TILE_SIZE = 32;
const DEFAULT_SCALE = 2;
const DEFAULT_OUT = 'summons.png';

const CELL_PAD = 12;
const LABEL_BAND = 18;
const SHEET_MARGIN = 24;
const SECTION_GAP = 26;
const STRIKE_STRIP_FRAMES = 6;
const SETTLED_AGE = INK_EMERGE_FRAMES * 4;

const BG = '#141b28';
const LABEL_COLOR = '#e2e8f0';
const LABEL_FONT = 'bold 13px sans-serif';

const FORMS: readonly InkMarauderForm[] = ['ogre', 'shark'];

function restingPose(form: InkMarauderForm): InkMarauderPose {
  return {
    form,
    age: SETTLED_AGE,
    lifeFraction: 1,
    attackProgress: 0,
    facingX: 1,
    walkFrame: 0,
    isMoving: false,
    swimBlend: 0,
  };
}

const POSE_VARIANTS: ReadonlyArray<{ label: string; overrides: Partial<InkMarauderPose> }> = [
  { label: 'idle', overrides: {} },
  { label: 'walking', overrides: { walkFrame: Math.PI / 2, isMoving: true, swimBlend: 1 } },
  { label: 'facing left', overrides: { facingX: -1 } },
  { label: 'emerging', overrides: { age: Math.round(INK_EMERGE_FRAMES * 0.6) } },
  { label: 'fading', overrides: { lifeFraction: 0.5 } },
];

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw.slice(name.length + 3), 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + 3);
}

const scale = intArg('scale', DEFAULT_SCALE);
const outPath = stringArg('out', DEFAULT_OUT);
const reviewTileSize = intArg('tile', DEFAULT_REVIEW_TILE_SIZE);

function headroom(tileSize: number): number {
  return Math.ceil(tileSize * INK_MARAUDER_HEAD_CLEARANCE);
}

function figureWidth(tileSize: number): number {
  return Math.ceil(tileSize * INK_MARAUDER_HALF_WIDTH * 2);
}

/** Left edge of the tile inside a cell, so the figure's full reach fits. */
function tileLeftInCell(cellLeft: number, tileSize: number): number {
  return cellLeft + Math.ceil(tileSize * INK_MARAUDER_HALF_WIDTH) - tileSize / 2;
}

function drawCell(
  ctx: import('canvas').CanvasRenderingContext2D,
  cellLeft: number,
  originY: number,
  tileSize: number,
  pose: InkMarauderPose,
  label: string,
): void {
  const originX = tileLeftInCell(cellLeft, tileSize);
  drawInkMarauderSprite(ctx, originX, originY, tileSize, pose);

  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(originX, originY, tileSize, tileSize);
  ctx.restore();

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(label, originX + tileSize / 2, originY + tileSize + LABEL_BAND);
  ctx.textAlign = 'left';
}

const reviewHeadroom = headroom(reviewTileSize);
const gameHeadroom = headroom(IN_GAME_TILE_SIZE);
const reviewCellWidth = figureWidth(reviewTileSize) + CELL_PAD;
const reviewCellHeight = reviewTileSize + CELL_PAD + LABEL_BAND + reviewHeadroom;
const gameCellWidth = figureWidth(IN_GAME_TILE_SIZE) + CELL_PAD;
const gameCellHeight = IN_GAME_TILE_SIZE + CELL_PAD + LABEL_BAND + gameHeadroom;

const rowsPerForm = 3;
const columns = Math.max(POSE_VARIANTS.length, STRIKE_STRIP_FRAMES);
const sheetWidth = SHEET_MARGIN * 2 + columns * reviewCellWidth;
const sheetHeight =
  SHEET_MARGIN * 2 +
  FORMS.length * (rowsPerForm * SECTION_GAP + reviewCellHeight * 2 + gameCellHeight);

const canvas = createCanvas(sheetWidth * scale, sheetHeight * scale);
const ctx = canvas.getContext('2d');
ctx.scale(scale, scale);
ctx.fillStyle = BG;
ctx.fillRect(0, 0, sheetWidth, sheetHeight);

let rowTop = SHEET_MARGIN;

for (const form of FORMS) {
  POSE_VARIANTS.forEach(({ label, overrides }, index) => {
    drawCell(
      ctx,
      SHEET_MARGIN + index * reviewCellWidth,
      rowTop + reviewHeadroom,
      reviewTileSize,
      { ...restingPose(form), ...overrides },
      `${form} ${label}`,
    );
  });
  rowTop += reviewCellHeight + SECTION_GAP;

  for (let i = 0; i < STRIKE_STRIP_FRAMES; i++) {
    const attackProgress = i / (STRIKE_STRIP_FRAMES - 1);
    drawCell(
      ctx,
      SHEET_MARGIN + i * reviewCellWidth,
      rowTop + reviewHeadroom,
      reviewTileSize,
      { ...restingPose(form), attackProgress },
      `strike ${attackProgress.toFixed(2)}`,
    );
  }
  rowTop += reviewCellHeight + SECTION_GAP;

  POSE_VARIANTS.forEach(({ label, overrides }, index) => {
    drawCell(
      ctx,
      SHEET_MARGIN + index * gameCellWidth,
      rowTop + gameHeadroom,
      IN_GAME_TILE_SIZE,
      { ...restingPose(form), ...overrides },
      `${label} @32`,
    );
  });
  rowTop += gameCellHeight + SECTION_GAP;
}

writeFileSync(outPath, canvas.toBuffer('image/png'));
process.stdout.write(`wrote ${outPath} (${sheetWidth * scale}x${sheetHeight * scale})\n`);
