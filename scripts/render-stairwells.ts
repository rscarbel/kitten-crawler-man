/**
 * Review harness for every stairwell in the game: the floor-exit stairwell in
 * each place it is cut into, and the tower's spiral stairs up and down at both
 * the tower's two-tile block and the tutorial's single tile.
 *
 * Each is drawn on a patch of the floor it stands on, once at the game's own
 * 32 px tile, where whether it reads as a staircase is actually decided, and
 * once at 4x, which is only for checking the painting itself.
 *
 * A second pair of sheets shows each floor-exit stairwell's seal in every pose
 * its key takes it through, one row per place, laid over the stairwell it
 * covers. The `runes` pose is shown lit over the sealed one, as it is played.
 *
 *   npx tsx scripts/render-stairwells.ts
 *
 * The stairwells in context — lit, among a floor's props — come from
 * `render-dungeon.ts --stairwell` and `render-interior.ts --kind=tower`.
 */

import { createCanvas, type CanvasRenderingContext2D as NodeContext } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { bakePropFamily, bakePropSheet } from './propSheetBake.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  stairwellSealLockedPlan,
  stairwellSealOpenPlan,
} from '../src/sprites/sheets/stairwellSealSheets.js';
import { STAIRWELL_STYLE_IDS } from '../src/sprites/art/stairwellArt.js';
import { stairwellSheetPlans } from '../src/sprites/sheets/stairwellSheets.js';
import { SEAL_OPEN_FRAME_ORDER, sealOpenCell } from '../src/sprites/art/stairwellSealArt.js';
import { drawTowerStaircaseTile } from '../src/sprites/towerStaircase.js';

const IN_GAME_TILE = 32;
const REVIEW_MULTIPLIER = 4;
/** Floor tiles of margin around each stair, so its rim is seen against floor. */
const MARGIN_TILES = 1;
/** Footprint of a floor-exit stairwell and a tower stair block, in tiles. */
const STAIRWELL_SPAN_TILES = 2;
const TOWER_BLOCK_SPAN_TILES = 2;
const TUTORIAL_STAIR_SPAN_TILES = 1;

/** The unlit floor each stairwell row stands on, sampled from the floors themselves. */
const ROW_FLOORS: Readonly<Record<string, string>> = {
  cellars: '#726b5b',
  service_level: '#4f5d52',
  street: '#8a8985',
};
const TOWER_FLOOR = '#97979d';

await loadGameSpritesInNode();

const plans = stairwellSheetPlans();
const problems = bakePropFamily('stairwell', plans);
if (problems.length > 0) {
  console.error(`\n[stairwell] FAIL - ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
const [plan] = plans;
const sheet = bakePropSheet(plan);
const sheetCanvas = createCanvas(sheet.pixels.width, sheet.pixels.height);
sheetCanvas.getContext('2d').putImageData(sheet.pixels, 0, 0);

/** Each place's two seal sheets, baked: its locked pose and the poses it opens through. */
const sealSheets = STAIRWELL_STYLE_IDS.map((style) => {
  const locked = stairwellSealLockedPlan(style);
  const open = stairwellSealOpenPlan(style);
  const problems = bakePropFamily('stairwell_seal', [locked, open]);
  if (problems.length > 0) {
    console.error(`\n[stairwell_seal ${style}] FAIL - ${problems.length} problems`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  const canvasOf = (sealPlanOf: typeof locked): ReturnType<typeof createCanvas> => {
    const baked = bakePropSheet(sealPlanOf);
    const bakedCanvas = createCanvas(baked.pixels.width, baked.pixels.height);
    bakedCanvas.getContext('2d').putImageData(baked.pixels, 0, 0);
    return bakedCanvas;
  };
  return { style, locked: canvasOf(locked), open: canvasOf(open) };
});
const sealPlan = stairwellSealOpenPlan('cellars');

/** Where an exhibit paints: the node context for compositing sheets, the game's for its painters. */
interface Surfaces {
  readonly node: NodeContext;
  readonly game: CanvasRenderingContext2D;
}

interface Exhibit {
  readonly floor: string;
  readonly spanTiles: number;
  readonly paint: (surfaces: Surfaces, x: number, y: number, tile: number) => void;
}

const exhibits: Exhibit[] = [
  ...plan.rows.map((row, rowIndex): Exhibit => ({
    floor: ROW_FLOORS[row.state] ?? TOWER_FLOOR,
    spanTiles: STAIRWELL_SPAN_TILES,
    paint: ({ node }, x, y, tile) => {
      const size = tile * STAIRWELL_SPAN_TILES;
      node.drawImage(
        sheetCanvas,
        0,
        rowIndex * plan.frameHeight,
        plan.frameWidth,
        plan.frameHeight,
        x,
        y,
        size,
        size,
      );
    },
  })),
  ...[true, false].flatMap((isUp) =>
    [TOWER_BLOCK_SPAN_TILES, TUTORIAL_STAIR_SPAN_TILES].map((span): Exhibit => ({
      floor: TOWER_FLOOR,
      spanTiles: span,
      paint: ({ game }, x, y, tile) => {
        for (let ty = 0; ty < span; ty++) {
          for (let tx = 0; tx < span; tx++) {
            drawTowerStaircaseTile(
              game,
              isUp,
              { x: 0, y: 0, span },
              x + tx * tile,
              y + ty * tile,
              tile,
              tx,
              ty,
            );
          }
        }
      },
    })),
  ),
];

function contactSheet(tile: number, outPath: string): void {
  const cells = exhibits.map((exhibit) => (exhibit.spanTiles + MARGIN_TILES * 2) * tile);
  const width = cells.reduce((total, cell) => total + cell, 0);
  const height = Math.max(...cells);
  const canvas = createCanvas(width, height);
  const node = canvas.getContext('2d');
  const game = asGameContext(node);
  let cellX = 0;
  exhibits.forEach((exhibit, index) => {
    const cell = cells[index];
    node.fillStyle = exhibit.floor;
    node.fillRect(cellX, 0, cell, height);
    exhibit.paint({ node, game }, cellX + MARGIN_TILES * tile, MARGIN_TILES * tile, tile);
    cellX += cell;
  });
  console.log(writePreviewPng(outPath, canvas.toBuffer('image/png')));
}

contactSheet(IN_GAME_TILE, `${PREVIEW_DIR}/stairwells/stairwells-1x.png`);
contactSheet(IN_GAME_TILE * REVIEW_MULTIPLIER, `${PREVIEW_DIR}/stairwells/stairwells-4x.png`);

/** Every style's seal in every pose, each over its stairwell on its floor. */
function sealContactSheet(tile: number, outPath: string): void {
  const footprint = tile * STAIRWELL_SPAN_TILES;
  const scale = footprint / sealPlan.tileScale;
  const cellW = Math.round(sealPlan.frameWidth * scale);
  const cellH = Math.round(sealPlan.frameHeight * scale);
  const offsetX = Math.round(sealPlan.tileX * scale);
  const offsetY = Math.round(sealPlan.tileY * scale);
  const poses = ['sealed', ...SEAL_OPEN_FRAME_ORDER] as const;
  const canvas = createCanvas(cellW * poses.length, cellH * sealSheets.length);
  const node = canvas.getContext('2d');
  sealSheets.forEach((seal, rowIndex) => {
    const stairRow = plan.rows.findIndex((stairs) => stairs.state === seal.style);
    if (stairRow < 0) {
      console.error(`[stairwell_seal] no stairwell row for "${seal.style}"`);
      process.exit(1);
    }
    const pose = (frame: (typeof poses)[number], x: number, y: number): void => {
      const source = frame === 'sealed' ? seal.locked : seal.open;
      const sheetPlan =
        frame === 'sealed'
          ? stairwellSealLockedPlan(seal.style)
          : stairwellSealOpenPlan(seal.style);
      const cell = frame === 'sealed' ? { row: 'sealed', column: 0 } : sealOpenCell(frame);
      const row = sheetPlan.rows.findIndex((candidate) => candidate.state === cell.row);
      if (row < 0) {
        console.error(`[stairwell_seal] ${sheetPlan.key} has no "${cell.row}" row`);
        process.exit(1);
      }
      node.drawImage(
        source,
        cell.column * sealPlan.frameWidth,
        row * sealPlan.frameHeight,
        sealPlan.frameWidth,
        sealPlan.frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
    };
    poses.forEach((frame, frameIndex) => {
      const x = frameIndex * cellW;
      const y = rowIndex * cellH;
      node.fillStyle = ROW_FLOORS[seal.style] ?? TOWER_FLOOR;
      node.fillRect(x, y, cellW, cellH);
      node.drawImage(
        sheetCanvas,
        0,
        stairRow * plan.frameHeight,
        plan.frameWidth,
        plan.frameHeight,
        x + offsetX,
        y + offsetY,
        footprint,
        footprint,
      );
      if (frame === 'runes') {
        // Laid over the turned padlock as added light, as the game plays it.
        pose('turnFull', x, y);
        node.save();
        node.globalCompositeOperation = 'lighter';
        pose(frame, x, y);
        node.restore();
        return;
      }
      pose(frame, x, y);
    });
  });
  console.log(writePreviewPng(outPath, canvas.toBuffer('image/png')));
}

sealContactSheet(IN_GAME_TILE, `${PREVIEW_DIR}/stairwells/seals-1x.png`);
sealContactSheet(IN_GAME_TILE * REVIEW_MULTIPLIER, `${PREVIEW_DIR}/stairwells/seals-4x.png`);
