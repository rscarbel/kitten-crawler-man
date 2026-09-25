/**
 * Gates the hamburger that lies on the ground (`src/sprites/art/burgerArt.ts`)
 * and writes `preview/burger-art.png` for a human to look at.
 *
 *  - G1 non-empty: the painter actually paints its cell.
 *  - G2 inside its cell: no solid pixel on the cell's outer ring. The painter
 *    clips itself, so a burger too big for its cell does not bleed — it is cut
 *    off flat at the edge, and that flat edge is what this looks for.
 *  - G3 fills its cell: the burger is as wide as it is meant to be, not a
 *    smudge in the middle of the cell.
 *  - G4 every layer survives the downscale: drawn at the size it is shown in
 *    the game, each of the icon's colour bands (bun, patty, cheese, lettuce)
 *    still has pixels of its own. A burger whose cheese or lettuce averages
 *    away into the bun is no longer recognisable as a burger.
 *
 *   npm run gates:burger-art
 */

import { createCanvas } from 'canvas';

import { asGameContext, asNodeCanvas } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import {
  GROUND_BURGER_BAKE_PX,
  groundBurgerSprite,
  paintBurgerInCell,
} from '../src/sprites/art/burgerArt.js';
import { HAMBURGER_PALETTE } from '../src/ui/icons/foodIcons.js';
import { GROUND_BURGER_DRAW_PX } from '../src/systems/GroundPickupSystem.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
/** Above this a pixel counts as painted rather than anti-aliasing fringe. */
const SOLID_ALPHA = 40;
/** The painter must cover at least this fraction of its cell. */
const MIN_OPAQUE_FRACTION = 0.3;
/** The burger's opaque width must span at least this fraction of the cell. */
const MIN_WIDTH_FRACTION = 0.8;
/**
 * Sizes the painter itself is gated at: the bake, which is the only size the
 * game paints it at, and half that for margin. The in-game size is a downscale
 * of the bake, gated by G4 instead — painted directly at 16 px its one-pixel
 * outline would touch the cell edge on antialiasing alone.
 */
const GATED_SIZES = [GROUND_BURGER_BAKE_PX / 2, GROUND_BURGER_BAKE_PX];
/**
 * How close, per RGB channel on average, a pixel must be to a palette colour to
 * count as that layer. Loose enough for the downscale's blending, tight enough
 * that cheese and bun (both warm yellows) stay apart.
 */
const LAYER_COLOR_TOLERANCE = 22;
/** A layer needs at least this many pixels of its own colour at in-game size. */
const MIN_LAYER_PIXELS = 2;

const PREVIEW_ZOOM = 8;
const PREVIEW_GAP = 12;
const PREVIEW_GRASS = '#4f6b34';
const PREVIEW_DIRT = '#8a7152';
const PREVIEW_PATH = `${PREVIEW_DIR}/burger-art.png`;
const HEX_RADIX = 16;
const HEX_BYTE_CHARS = 2;
const HEX_RED_START = 1;
const HEX_GREEN_START = HEX_RED_START + HEX_BYTE_CHARS;
const HEX_BLUE_START = HEX_GREEN_START + HEX_BYTE_CHARS;
const RGB_CHANNELS = 3;

const failures: string[] = [];

function fail(gate: string, message: string): void {
  failures.push(`${gate}: ${message}`);
}

interface Pixels {
  readonly size: number;
  readonly data: Uint8ClampedArray;
}

function paintAt(size: number): Pixels {
  const canvas = createCanvas(size, size);
  const ctx = asGameContext(canvas.getContext('2d'));
  paintBurgerInCell(ctx, 0, 0, size);
  return { size, data: ctx.getImageData(0, 0, size, size).data };
}

/** The baked sprite downscaled to in-game size, the way the game draws it. */
function inGamePixels(): Pixels {
  const size = GROUND_BURGER_DRAW_PX;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(asNodeCanvas(groundBurgerSprite()), 0, 0, size, size);
  return { size, data: ctx.getImageData(0, 0, size, size).data };
}

function alphaAt(pixels: Pixels, x: number, y: number): number {
  return pixels.data[(y * pixels.size + x) * CHANNELS + ALPHA_OFFSET];
}

function gateNonEmptyAndFilled(): void {
  for (const size of GATED_SIZES) {
    const pixels = paintAt(size);
    let opaque = 0;
    let minX = size;
    let maxX = -1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (alphaAt(pixels, x, y) < SOLID_ALPHA) continue;
        opaque++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    const minOpaque = Math.ceil(size * size * MIN_OPAQUE_FRACTION);
    if (opaque < minOpaque) {
      fail('G1-non-empty', `@${size}px painted ${opaque} solid px, need ${minOpaque}`);
    }
    const width = maxX - minX + 1;
    if (width < size * MIN_WIDTH_FRACTION) {
      fail('G3-fills-cell', `@${size}px is ${width}px wide, need ${size * MIN_WIDTH_FRACTION}`);
    }
  }
}

function gateInsideCell(): void {
  for (const size of GATED_SIZES) {
    const pixels = paintAt(size);
    const last = size - 1;
    for (let i = 0; i < size; i++) {
      const ring: ReadonlyArray<readonly [number, number]> = [
        [i, 0],
        [i, last],
        [0, i],
        [last, i],
      ];
      for (const [x, y] of ring) {
        if (alphaAt(pixels, x, y) >= SOLID_ALPHA) {
          fail('G2-inside-cell', `@${size}px is cut off by its cell edge at (${x}, ${y})`);
          return;
        }
      }
    }
  }
}

function hexToRgb(hex: string): readonly [number, number, number] {
  return [
    parseInt(hex.slice(HEX_RED_START, HEX_GREEN_START), HEX_RADIX),
    parseInt(hex.slice(HEX_GREEN_START, HEX_BLUE_START), HEX_RADIX),
    parseInt(hex.slice(HEX_BLUE_START, HEX_BLUE_START + HEX_BYTE_CHARS), HEX_RADIX),
  ];
}

function gateLayersSurvive(): void {
  const pixels = inGamePixels();
  const layers: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['bun', [HAMBURGER_PALETTE.bun, HAMBURGER_PALETTE.bunShade]],
    ['patty', [HAMBURGER_PALETTE.patty, HAMBURGER_PALETTE.pattyShade]],
    ['cheese', [HAMBURGER_PALETTE.cheese]],
    ['lettuce', [HAMBURGER_PALETTE.lettuce, HAMBURGER_PALETTE.lettuceShade]],
  ];
  for (const [label, colors] of layers) {
    const targets = colors.map(hexToRgb);
    let count = 0;
    for (let i = 0; i < pixels.data.length; i += CHANNELS) {
      if (pixels.data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      const r = pixels.data[i];
      const g = pixels.data[i + GREEN_OFFSET];
      const b = pixels.data[i + BLUE_OFFSET];
      const matches = targets.some(
        ([tr, tg, tb]) =>
          (Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb)) / RGB_CHANNELS <=
          LAYER_COLOR_TOLERANCE,
      );
      if (matches) count++;
    }
    if (count < MIN_LAYER_PIXELS) {
      fail(
        'G4-layers-survive',
        `at ${GROUND_BURGER_DRAW_PX}px the ${label} has ${count} px of its colour, need ${MIN_LAYER_PIXELS}`,
      );
    }
  }
}

function writePreview(): string {
  const tiles = [GROUND_BURGER_DRAW_PX, ...GATED_SIZES];
  const zoomedSize = GROUND_BURGER_DRAW_PX * PREVIEW_ZOOM;
  const width =
    tiles.reduce((sum, size) => sum + size + PREVIEW_GAP, PREVIEW_GAP) +
    (zoomedSize + PREVIEW_GAP) * 2;
  const height = Math.max(GROUND_BURGER_BAKE_PX, zoomedSize) + PREVIEW_GAP * 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PREVIEW_GRASS;
  ctx.fillRect(0, 0, width, height);

  let x = PREVIEW_GAP;
  for (const size of tiles) {
    paintBurgerInCell(asGameContext(ctx), x, PREVIEW_GAP, size);
    x += size + PREVIEW_GAP;
  }

  // In-game size, blown up without smoothing, on the two grounds it lies on.
  const small = createCanvas(GROUND_BURGER_DRAW_PX, GROUND_BURGER_DRAW_PX);
  const smallCtx = small.getContext('2d');
  smallCtx.drawImage(
    asNodeCanvas(groundBurgerSprite()),
    0,
    0,
    GROUND_BURGER_DRAW_PX,
    GROUND_BURGER_DRAW_PX,
  );
  ctx.imageSmoothingEnabled = false;
  for (const ground of [PREVIEW_GRASS, PREVIEW_DIRT]) {
    ctx.fillStyle = ground;
    ctx.fillRect(x, PREVIEW_GAP, zoomedSize, zoomedSize);
    ctx.drawImage(small, x, PREVIEW_GAP, zoomedSize, zoomedSize);
    x += zoomedSize + PREVIEW_GAP;
  }
  return writePreviewPng(PREVIEW_PATH, canvas.toBuffer('image/png'));
}

installCanvasGlobals();
gateNonEmptyAndFilled();
gateInsideCell();
gateLayersSurvive();
const previewPath = writePreview();
console.log(`preview: ${previewPath}`);

if (failures.length > 0) {
  for (const line of failures) console.log(`FAIL ${line}`);
  console.log(`\n${failures.length} burger-art gate failure(s)`);
  process.exit(1);
}
console.log('burger art: all gates pass');
