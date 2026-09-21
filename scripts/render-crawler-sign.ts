/**
 * Review harness for the crawler signboard: the board with its arrow turned to a
 * spread of bearings (diagonals and off-axis ones included), baked
 * twice into `preview/` — once at the game's own 32 px tile, where legibility is
 * actually decided, and once at 4x, which flatters everything and is only for
 * checking the painting itself.
 */

import { createCanvas } from 'canvas';
import { SIGN_ARROW_CENTRE_Y_TILES } from '../src/sprites/art/crawlerSignArt.js';
import { dungeonSignSheetPlans } from '../src/sprites/sheets/dungeonSignSheets.js';
import { bakePropFamily, bakePropSheet } from './propSheetBake.js';
import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import type { PropSheetPlan } from '../src/sprites/sheets/propSheetPlan.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

const IN_GAME_TILE = 32;
const REVIEW_MULTIPLIER = 4;
const FLOOR_COLOR = '#2e2a33';
const TILE_GUIDE = 'rgba(120, 220, 255, 0.35)';
const PADDING_TILES = 0.25;
const BOARD_CENTRE_X_TILES = 0.5;
const DEGREES_TO_RADIANS = Math.PI / 180;
const PREVIEW_BEARINGS_DEGREES: ReadonlyArray<number> = [0, 25, 45, 90, 135, 180, -45, -110];

await loadGameSpritesInNode();

const plans = dungeonSignSheetPlans();
const boardPlan = plans.find((plan) => plan.key === 'crawler_sign');
const arrowPlan = plans.find((plan) => plan.key === 'crawler_sign_arrow');
if (boardPlan === undefined || arrowPlan === undefined) throw new Error('sign plans missing');
const problems = bakePropFamily('crawler_sign', plans);
if (problems.length > 0) {
  console.error(`\n[crawler_sign] FAIL - ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

function bakeContactSheet(
  boardPlan: PropSheetPlan,
  arrowPlan: PropSheetPlan,
  tileSize: number,
  outPath: string,
): void {
  const board = bakePropSheet(boardPlan);
  const arrow = bakePropSheet(arrowPlan);
  const pixelsPerSource = tileSize / boardPlan.tileScale;
  const cellWidth = boardPlan.frameWidth * pixelsPerSource;
  const cellHeight = boardPlan.frameHeight * pixelsPerSource;
  const padding = Math.round(tileSize * PADDING_TILES);
  const canvas = createCanvas(
    PREVIEW_BEARINGS_DEGREES.length * (cellWidth + padding) + padding,
    cellHeight + padding * 2,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = FLOOR_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  PREVIEW_BEARINGS_DEGREES.forEach((degrees, index) => {
    const cellX = padding + index * (cellWidth + padding);
    ctx.drawImage(
      board.canvas,
      0,
      0,
      boardPlan.frameWidth,
      boardPlan.frameHeight,
      cellX,
      padding,
      cellWidth,
      cellHeight,
    );
    ctx.strokeStyle = TILE_GUIDE;
    ctx.strokeRect(
      cellX + boardPlan.tileX * pixelsPerSource + 0.5,
      padding + boardPlan.tileY * pixelsPerSource + 0.5,
      tileSize - 1,
      tileSize - 1,
    );
    ctx.save();
    ctx.translate(
      cellX + boardPlan.tileX * pixelsPerSource + tileSize * BOARD_CENTRE_X_TILES,
      padding + boardPlan.tileY * pixelsPerSource + tileSize * SIGN_ARROW_CENTRE_Y_TILES,
    );
    ctx.rotate(degrees * DEGREES_TO_RADIANS);
    const arrowSize = arrowPlan.frameWidth * pixelsPerSource;
    ctx.drawImage(
      arrow.canvas,
      0,
      0,
      arrowPlan.frameWidth,
      arrowPlan.frameHeight,
      -arrowPlan.tileX * pixelsPerSource,
      -arrowPlan.tileY * pixelsPerSource,
      arrowSize,
      arrowSize,
    );
    ctx.restore();
  });
  console.log(`${writePreviewPng(outPath, canvas.toBuffer('image/png'))}: ${canvas.width}px wide`);
}

bakeContactSheet(boardPlan, arrowPlan, IN_GAME_TILE, `${PREVIEW_DIR}/crawler-sign-game.png`);
bakeContactSheet(
  boardPlan,
  arrowPlan,
  IN_GAME_TILE * REVIEW_MULTIPLIER,
  `${PREVIEW_DIR}/crawler-sign-4x.png`,
);
