/**
 * Headless renderer for the dwarf cook — the sprite as pixels, without a
 * browser.
 *
 * `?dwarf-cook` is the interactive review route, but the browser harness cannot
 * drive this project (a hidden tab never clears the level-intro banner and never
 * runs `requestAnimationFrame`), so the art has to be judgeable from a still.
 * This runs the real draw function through node-canvas and writes a contact
 * sheet: every animation state at review scale, the in-game tile size beside it,
 * and a row of seeded palettes.
 *
 *   npx tsx scripts/render-dwarf-cook.ts --out=dwarf-cook.png --scale=4 --frame=0
 *
 * `--frame` picks the animation frame, so a sway or a stir can be compared
 * across two stills instead of guessed at.
 */

import { createCanvas } from 'canvas';

import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

const { drawDwarfCookSprite, dwarfCookPaletteForSeed } =
  await import('../src/sprites/dwarfCookSprite');
const { previewInk } = await import('../src/ui/theme/previewInk');
type DwarfCookState = Parameters<typeof drawDwarfCookSprite>[4]['state'];

const STATES: ReadonlyArray<DwarfCookState> = [
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

const CELL_PAD = 16;
const LABEL_BAND = 18;
const SHEET_MARGIN = 24;
const SECTION_GAP = 28;

const BG = '#1b2436';
const LABEL_COLOR = '#e2e8f0';
const LABEL_FONT = 'bold 13px sans-serif';

const DEFAULT_SCALE = 2;
const DEFAULT_OUT = `${PREVIEW_DIR}/dwarf-cook.png`;
const DEFAULT_FRAME = 0;

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

/** Tiles of floor under each figure, and rows of cell height it needs. */
const FLOOR_TILES_WIDE = 1;
const CELL_ROWS = 1;
/** How far above its feet the figure reaches, in tiles, rounded up to whole rows of cell. */
const FIGURE_HEADROOM_ROWS = 1;

function cellSize(ts: number): { w: number; h: number } {
  return {
    w: FLOOR_TILES_WIDE * ts + CELL_PAD,
    h: (CELL_ROWS + FIGURE_HEADROOM_ROWS) * ts + CELL_PAD + LABEL_BAND,
  };
}

function drawCell(
  ctx: import('canvas').CanvasRenderingContext2D,
  originX: number,
  originY: number,
  ts: number,
  state: DwarfCookState,
  seed: number,
  label: string,
): void {
  const centreX = originX + (FLOOR_TILES_WIDE * ts) / 2;
  const feetY = originY + FIGURE_HEADROOM_ROWS * ts;
  // Flat floor: node-canvas has no loaded sprite sheet, and this sheet is
  // judged on the figure, not on paving.
  ctx.fillStyle = previewInk.dwarfCook.floor;
  ctx.fillRect(centreX - (FLOOR_TILES_WIDE * ts) / 2, feetY - ts / 2, FLOOR_TILES_WIDE * ts, ts);

  drawDwarfCookSprite(asGameContext(ctx), centreX, feetY, ts, {
    state,
    animFrames: frame,
    lookX: Math.sin(frame * LOOK_CYCLE_RATE),
    lookY: Math.sin(frame * LOOK_CYCLE_RATE * LOOK_VERTICAL_RATE_RATIO),
    palette: dwarfCookPaletteForSeed(seed),
    blinking: frame % BLINK_INTERVAL_FRAMES < BLINK_DURATION_FRAMES,
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(label, centreX, feetY + ts / 2 + LABEL_BAND);
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

const resolvedOutPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
process.stdout.write(`wrote ${resolvedOutPath} (${sheetWidth * scale}x${sheetHeight * scale})\n`);
