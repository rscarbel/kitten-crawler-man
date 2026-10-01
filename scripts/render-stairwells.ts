/**
 * Review harness for every stairwell in the game: the floor-exit stairwell in
 * each place it is cut into, and the tower's spiral stairs up and down at both
 * the tower's two-tile block and the tutorial's single tile.
 *
 * Each is drawn on a patch of the floor it stands on, once at the game's own
 * 32 px tile, where whether it reads as a staircase is actually decided, and
 * once at 4x, which is only for checking the painting itself.
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
import { stairwellSheetPlans } from '../src/sprites/sheets/stairwellSheets.js';
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
