#!/usr/bin/env tsx
/**
 * Headless review harness for the procedurally drawn gym equipment.
 *
 * The bench and the treadmill have no sprite sheet and no preview route, so the
 * only way to judge them used to be walking to the Juicer's room in a running
 * game. Art has to be reviewed as an image: this renders every draw function at
 * the real tile size on a gym-floor swatch, and again magnified, so proportion
 * defects and 32px silhouette defects are both visible in one picture.
 *
 *   npx tsx scripts/render-gym-equipment.ts --out=gym.png --scale=6
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TILE_SIZE } from '../src/core/constants.js';
import {
  drawBenchPressFloor,
  drawBenchPressInventoryIcon,
  drawDumbbellFloor,
  drawDumbbellInventoryIcon,
  drawTreadmillFloor,
  drawTreadmillInventoryIcon,
} from '../src/sprites/gymEquipmentSprite.js';

/** Each piece overdraws its tile, so every cell is padded out to this many tiles. */
const CELL_TILES = 3;
const CELL_PX = TILE_SIZE * CELL_TILES;
/** Halving a leftover span centres the smaller box inside the larger one. */
const CENTRING_HALF = 0.5;
/** A 1px stroke straddles its path, so guide rects are nudged onto pixel centres. */
const HAIRLINE_INSET = 0.5;
const HAIRLINE_STROKE_PX = 1;
const LABEL_BAND_PX = 14;
const INVENTORY_SLOT_PX = 32;

const GYM_MAT_COLOR = '#3b3a38';
const GYM_MAT_FLECK_COLOR = 'rgba(255,255,255,0.05)';
const GYM_MAT_FLECK_STEP = 6;
const GYM_MAT_FLECK_SIZE = 2;
const SLOT_BACKGROUND = '#1d2026';
const SLOT_BORDER = '#4a5058';
const LABEL_COLOR = '#dfe4ea';
const LABEL_FONT_PX = 10;
const LABEL_LEFT_PAD = 2;
const TILE_GUIDE_COLOR = 'rgba(80,200,255,0.35)';

type FloorPainter = (
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
) => void;
type IconPainter = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) => void;

interface Subject {
  label: string;
  floor: FloorPainter;
  icon: IconPainter;
}

const SUBJECTS: readonly Subject[] = [
  { label: 'bench press', floor: drawBenchPressFloor, icon: drawBenchPressInventoryIcon },
  { label: 'treadmill', floor: drawTreadmillFloor, icon: drawTreadmillInventoryIcon },
  { label: 'dumbbell', floor: drawDumbbellFloor, icon: drawDumbbellInventoryIcon },
];

/** Length of the `--` prefix plus the `=` separator around a flag name. */
const FLAG_SYNTAX_LENGTH = 3;

function parseFlag(name: string, fallback: string): string {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match === undefined ? fallback : match.slice(name.length + FLAG_SYNTAX_LENGTH);
}

const outPath = resolve(parseFlag('out', 'gym-equipment-review.png'));
const scale = Number(parseFlag('scale', '6'));

const sheetWidth = CELL_PX * SUBJECTS.length;
const sheetHeight = CELL_PX + LABEL_BAND_PX + INVENTORY_SLOT_PX + LABEL_BAND_PX;

const canvas = createCanvas(sheetWidth * scale, sheetHeight * scale);
const ctx = canvas.getContext('2d');
ctx.scale(scale, scale);
ctx.imageSmoothingEnabled = false;

ctx.fillStyle = GYM_MAT_COLOR;
ctx.fillRect(0, 0, sheetWidth, sheetHeight);
ctx.fillStyle = GYM_MAT_FLECK_COLOR;
for (let fleckY = 0; fleckY < sheetHeight; fleckY += GYM_MAT_FLECK_STEP) {
  for (let fleckX = 0; fleckX < sheetWidth; fleckX += GYM_MAT_FLECK_STEP) {
    const staggered = (fleckY / GYM_MAT_FLECK_STEP) % 2 === 0 ? 0 : GYM_MAT_FLECK_STEP / 2;
    ctx.fillRect(fleckX + staggered, fleckY, GYM_MAT_FLECK_SIZE, GYM_MAT_FLECK_SIZE);
  }
}

ctx.font = `${LABEL_FONT_PX}px sans-serif`;
ctx.textBaseline = 'top';

SUBJECTS.forEach((subject, column) => {
  const cellLeft = column * CELL_PX;
  const tileLeft = cellLeft + (CELL_PX - TILE_SIZE) * CENTRING_HALF;
  const tileTop = (CELL_PX - TILE_SIZE) * CENTRING_HALF;

  ctx.strokeStyle = TILE_GUIDE_COLOR;
  ctx.lineWidth = HAIRLINE_STROKE_PX;
  ctx.strokeRect(
    tileLeft + HAIRLINE_INSET,
    tileTop + HAIRLINE_INSET,
    TILE_SIZE - HAIRLINE_STROKE_PX,
    TILE_SIZE - HAIRLINE_STROKE_PX,
  );

  subject.floor(ctx, tileLeft, tileTop, TILE_SIZE);

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(subject.label, cellLeft + LABEL_LEFT_PAD, CELL_PX);

  const slotLeft = cellLeft + (CELL_PX - INVENTORY_SLOT_PX) * CENTRING_HALF;
  const slotTop = CELL_PX + LABEL_BAND_PX;
  ctx.fillStyle = SLOT_BACKGROUND;
  ctx.fillRect(slotLeft, slotTop, INVENTORY_SLOT_PX, INVENTORY_SLOT_PX);
  ctx.strokeStyle = SLOT_BORDER;
  ctx.strokeRect(
    slotLeft + HAIRLINE_INSET,
    slotTop + HAIRLINE_INSET,
    INVENTORY_SLOT_PX - HAIRLINE_STROKE_PX,
    INVENTORY_SLOT_PX - HAIRLINE_STROKE_PX,
  );
  subject.icon(ctx, slotLeft, slotTop, INVENTORY_SLOT_PX);

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`icon @${INVENTORY_SLOT_PX}`, cellLeft + LABEL_LEFT_PAD, slotTop + INVENTORY_SLOT_PX);
});

writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(`wrote ${outPath} (${sheetWidth}x${sheetHeight} @${scale}x)`);
