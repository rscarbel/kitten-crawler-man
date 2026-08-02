/**
 * Headless renderer for the Bopca Protector — the sprite as pixels, without a
 * browser.
 *
 * `?bopca` is the interactive review route, but the browser harness cannot drive
 * this project (a hidden tab never clears the level-intro banner and never runs
 * `requestAnimationFrame`), so the art has to be judgeable from a still. This
 * runs the real draw functions through node-canvas and writes a contact sheet:
 * every animation state at review scale, the in-game tile size beside it, and a
 * row of seeded palettes.
 *
 *   npx tsx scripts/render-bopca.ts --out=bopca.png --scale=4 --frame=0
 *
 * `--frame` picks the animation frame, so a sway or a stir can be compared
 * across two stills instead of guessed at.
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';

const { drawBopcaSprite, bopcaPaletteForSeed } = await import('../src/sprites/bopcaSprite');
type BopcaState = Parameters<typeof drawBopcaSprite>[4]['state'];
const {
  BOPCA_FEET_COUNTER_FRACTION,
  counterEdges,
  drawCounterFrontFace,
  drawCounterBackTile,
  drawServedDish,
} = await import('../src/sprites/safeRoomCounter');
const { DUNGEON_GROUND } = await import('../src/map/dungeon/groundMaterials');
type DishVisual = Parameters<typeof drawServedDish>[4]['visual'];
const {
  COUNTER_RUN_BACK_ROW,
  COUNTER_RUN_FRONT_ROW,
  COUNTER_RUN_GALLEY_ROW,
  counterRunStructure,
  DISH_COLUMN_OFFSET_FROM_BOPCA,
} = await import('../src/map/safeRoomCounterLayout');
const { SAFE_ROOM_COUNTER, SAFE_ROOM_COUNTER_BACK } = await import('../src/map/tileTypes');

const STATES: ReadonlyArray<BopcaState> = [
  'idle',
  'cooking',
  'serving',
  'leaning',
  'wipingHands',
  'readingNews',
  'annoyed',
  'pleased',
];

const IN_GAME_TILE_SIZE = 32;
const REVIEW_TILE_SIZE = 96;
const PALETTE_TILE_SIZE = 64;
const PALETTE_VARIANT_COUNT = 5;
const COUNTER_RUN_TILES = 3;

const CELL_PAD = 16;
const LABEL_BAND = 18;
const SHEET_MARGIN = 24;
const SECTION_GAP = 28;

const BG = '#1b2436';
const LABEL_COLOR = '#e2e8f0';
const LABEL_FONT = 'bold 13px sans-serif';

const DEFAULT_SCALE = 2;
const DEFAULT_OUT = 'bopca.png';
const DEFAULT_FRAME = 0;

const PREVIEW_DISH: DishVisual = {
  shape: 'bowl',
  vesselColor: '#e8e0cc',
  contentColor: '#b4762e',
  garnishColor: '#6f9f4a',
};

const FRAMES_PER_SECOND = 60;
const LOOK_CYCLE_RATE = 0.013;
const LOOK_VERTICAL_RATE_RATIO = 0.6;
const BLINK_INTERVAL_FRAMES = 190;
const BLINK_DURATION_FRAMES = 7;

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
const frame = intArg('frame', DEFAULT_FRAME);
const outPath = stringArg('out', DEFAULT_OUT);

/**
 * The real tile grid of a standalone run. Hand-written neighbour flags would show
 * a counter the game never draws — the end caps and side returns are both chosen
 * by looking at neighbours.
 */
const RUN_STRUCTURE = counterRunStructure(COUNTER_RUN_TILES);
const LAST_COLUMN = COUNTER_RUN_TILES - 1;
const GALLEY_COLUMN = Math.floor(COUNTER_RUN_TILES / 2);
const TILE_CENTRE_FRACTION = 0.5;

/**
 * Width and height a single figure-behind-counter cell occupies.
 *
 * Three tile rows tall — back bench, galley strip, front bar — because that is
 * what a counter run actually is. Sizing the cell to the figure instead clipped
 * the bench off the top of every cell.
 */
const COUNTER_ROWS = 3;
function cellSize(ts: number): { w: number; h: number } {
  return {
    w: COUNTER_RUN_TILES * ts + CELL_PAD,
    h: COUNTER_ROWS * ts + CELL_PAD + LABEL_BAND,
  };
}

function drawCell(
  ctx: import('canvas').CanvasRenderingContext2D,
  originX: number,
  originY: number,
  ts: number,
  state: BopcaState,
  seed: number,
  label: string,
): void {
  const centreX = originX + (COUNTER_RUN_TILES * ts) / 2;
  const frontRowTop = originY + (COUNTER_ROWS - 1) * ts;
  const runLeft = centreX - (COUNTER_RUN_TILES * ts) / 2;

  const drawCounterFronts = (): void => {
    for (let column = 0; column < COUNTER_RUN_TILES; column++) {
      const tileX = runLeft + column * ts;
      if (column === 0 || column === LAST_COLUMN) {
        drawCounterFrontFace(
          ctx,
          tileX,
          frontRowTop - ts,
          ts,
          counterEdges(RUN_STRUCTURE, SAFE_ROOM_COUNTER, column, COUNTER_RUN_GALLEY_ROW),
        );
      }
      drawCounterFrontFace(
        ctx,
        tileX,
        frontRowTop,
        ts,
        counterEdges(RUN_STRUCTURE, SAFE_ROOM_COUNTER, column, COUNTER_RUN_FRONT_ROW),
      );
    }
  };

  for (let column = 0; column < COUNTER_RUN_TILES; column++) {
    const tileX = runLeft + column * ts;
    // The hearth paving goes under all three rows, exactly as `drawInteriorTile`
    // does in the game. Flat here rather than the generated `bopca_hearth` tile:
    // node-canvas has no loaded sprite sheet, so the sheet's own mean for that
    // material is the honest stand-in — and this sheet is judged on the sprite.
    ctx.fillStyle = DUNGEON_GROUND.fallbackColor.bopca_hearth;
    for (const rowTop of [frontRowTop - ts * 2, frontRowTop - ts, frontRowTop]) {
      ctx.fillRect(tileX, rowTop, ts, ts);
    }
    drawCounterBackTile(
      ctx,
      tileX,
      frontRowTop - ts * 2,
      ts,
      counterEdges(RUN_STRUCTURE, SAFE_ROOM_COUNTER_BACK, column, COUNTER_RUN_BACK_ROW),
      column,
    );
  }
  drawCounterFronts();

  const bopcaCentreX = runLeft + (GALLEY_COLUMN + TILE_CENTRE_FRACTION) * ts;
  drawBopcaSprite(ctx, bopcaCentreX, frontRowTop + ts * BOPCA_FEET_COUNTER_FRACTION, ts, {
    state,
    animFrames: frame,
    lookX: Math.sin(frame * LOOK_CYCLE_RATE),
    lookY: Math.sin(frame * LOOK_CYCLE_RATE * LOOK_VERTICAL_RATE_RATIO),
    palette: bopcaPaletteForSeed(seed),
    blinking: frame % BLINK_INTERVAL_FRAMES < BLINK_DURATION_FRAMES,
  });

  drawCounterFronts();

  if (state === 'serving') {
    drawServedDish(
      ctx,
      runLeft + (GALLEY_COLUMN + DISH_COLUMN_OFFSET_FROM_BOPCA) * ts,
      frontRowTop,
      ts,
      {
        visual: PREVIEW_DISH,
        coldness: 0,
        elapsedSeconds: frame / FRAMES_PER_SECOND,
      },
    );
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(label, centreX, frontRowTop + ts + LABEL_BAND);
  ctx.textAlign = 'left';
}

const reviewCell = cellSize(REVIEW_TILE_SIZE);
const gameCell = cellSize(IN_GAME_TILE_SIZE);
const paletteCell = cellSize(PALETTE_TILE_SIZE);

const stateColumns = 4;
const stateRows = Math.ceil(STATES.length / stateColumns);

const sheetWidth =
  SHEET_MARGIN * 2 + Math.max(stateColumns * reviewCell.w, PALETTE_VARIANT_COUNT * paletteCell.w);
const stateBlockHeight = stateRows * reviewCell.h;
const gameBlockHeight = gameCell.h;
const paletteBlockHeight = paletteCell.h;
const sheetHeight =
  SHEET_MARGIN * 2 +
  stateBlockHeight +
  SECTION_GAP +
  gameBlockHeight +
  SECTION_GAP +
  paletteBlockHeight;

const canvas = createCanvas(sheetWidth * scale, sheetHeight * scale);
const ctx = canvas.getContext('2d');
ctx.scale(scale, scale);
ctx.fillStyle = BG;
ctx.fillRect(0, 0, sheetWidth, sheetHeight);

STATES.forEach((state, index) => {
  const column = index % stateColumns;
  const row = Math.floor(index / stateColumns);
  drawCell(
    ctx,
    SHEET_MARGIN + column * reviewCell.w,
    SHEET_MARGIN + row * reviewCell.h,
    REVIEW_TILE_SIZE,
    state,
    0,
    state,
  );
});

const gameRowTop = SHEET_MARGIN + stateBlockHeight + SECTION_GAP;
STATES.forEach((state, index) => {
  drawCell(
    ctx,
    SHEET_MARGIN + index * gameCell.w,
    gameRowTop,
    IN_GAME_TILE_SIZE,
    state,
    0,
    `${state} @32`,
  );
});

const paletteRowTop = gameRowTop + gameBlockHeight + SECTION_GAP;
for (let variant = 0; variant < PALETTE_VARIANT_COUNT; variant++) {
  drawCell(
    ctx,
    SHEET_MARGIN + variant * paletteCell.w,
    paletteRowTop,
    PALETTE_TILE_SIZE,
    'idle',
    variant,
    `seed ${variant}`,
  );
}

writeFileSync(outPath, canvas.toBuffer('image/png'));
process.stdout.write(`wrote ${outPath} (${sheetWidth * scale}x${sheetHeight * scale})\n`);
