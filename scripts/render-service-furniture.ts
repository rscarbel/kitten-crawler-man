/**
 * Review harness for the service level's furniture: bakes every service-level sheet through
 * the same plan the game paints from (failing on any frame that inks its
 * cell's border), then lays every row of every sheet out on both floors'
 * ground colours with Carl standing at the end of each row for scale.
 *
 *   npx tsx scripts/render-service-furniture.ts
 *   npx tsx scripts/render-service-furniture.ts --scale=3 --out=preview/service-furniture-3x.png
 *
 * `--scale` is display pixels per game pixel: 1 is the game's own 32 px tile,
 * where readability is decided.
 */

import { createCanvas } from 'canvas';
import { TILE_SIZE } from '../src/core/constants.js';
import { serviceFurnitureSheetPlans } from '../src/sprites/sheets/serviceFurnitureSheets.js';
import { bakePropFamily, bakePropSheet } from './propSheetBake.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

installCanvasGlobals();
const { drawCarlFront } = await import('../src/sprites/art/carl/figure.js');
const { restingPose } = await import('../src/sprites/art/carl/rig.js');
const { HUMAN_SCALE } = await import('../src/sprites/art/human/figureScale.js');

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const scale = Number(argValue('scale') ?? '1');
const outPath = argValue('out') ?? `${PREVIEW_DIR}/service-furniture-${scale}x.png`;

/** Floor 1's flagstone and floor 2's concrete, as flat swatches under the props. */
const FLOOR_COLOURS = ['#4a4239', '#3b3f44'] as const;
const ROW_GAP_TILES = 0.4;
const CELL_GAP_TILES = 0.15;
const CARL_SPACE_TILES = 1.2;
/** Carl stands in the middle of the tile after the row's last frame. */
const CARL_CENTRE_TILES = 0.5;

const plans = serviceFurnitureSheetPlans();
const problems = bakePropFamily('service_furniture', plans);
if (problems.length > 0) {
  console.error(`\n[service_furniture] FAIL - ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const tile = TILE_SIZE * scale;
const baked = plans.map((plan) => bakePropSheet(plan));
const rows = baked.flatMap((sheet) =>
  sheet.plan.rows.map((row, rowIndex) => ({ sheet, row, rowIndex })),
);
const pxPerSource = (plan: (typeof plans)[number]) => tile / plan.tileScale;
const rowHeight = (plan: (typeof plans)[number]) =>
  plan.frameHeight * pxPerSource(plan) + ROW_GAP_TILES * tile;
const rowWidth = (entry: (typeof rows)[number]) =>
  entry.row.frames.length *
    (entry.sheet.plan.frameWidth * pxPerSource(entry.sheet.plan) + CELL_GAP_TILES * tile) +
  CARL_SPACE_TILES * tile;
const width = Math.ceil(Math.max(...rows.map(rowWidth)));
const floorHeight = rows.reduce((sum, entry) => sum + rowHeight(entry.sheet.plan), 0);
const canvas = createCanvas(width, Math.ceil(floorHeight * FLOOR_COLOURS.length));
const ctx = canvas.getContext('2d');
const gameCtx = asGameContext(ctx);

let y = 0;
for (const floor of FLOOR_COLOURS) {
  for (const { sheet, rowIndex, row } of rows) {
    const { plan } = sheet;
    const k = pxPerSource(plan);
    const height = rowHeight(plan);
    ctx.fillStyle = floor;
    ctx.fillRect(0, y, width, height);
    let x = CELL_GAP_TILES * tile;
    for (let frame = 0; frame < row.frames.length; frame++) {
      ctx.drawImage(
        sheet.canvas,
        frame * plan.frameWidth,
        rowIndex * plan.frameHeight,
        plan.frameWidth,
        plan.frameHeight,
        x,
        y,
        plan.frameWidth * k,
        plan.frameHeight * k,
      );
      x += plan.frameWidth * k + CELL_GAP_TILES * tile;
    }
    const footY = y + (plan.tileY + plan.tileScale) * k;
    ctx.save();
    ctx.translate(x + tile * CARL_CENTRE_TILES, footY);
    ctx.scale(tile, tile);
    ctx.scale(HUMAN_SCALE, HUMAN_SCALE);
    drawCarlFront(gameCtx, restingPose());
    ctx.restore();
    y += height;
  }
}

console.log(writePreviewPng(outPath, canvas.toBuffer('image/png')));
