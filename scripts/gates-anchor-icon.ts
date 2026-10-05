/**
 * Bakes the Wayfinder's Anchor at 24/32/48 px across one animation loop, with
 * its shards and the health potion as a size ruler, into
 * `preview/anchor-icon.png`, plus a frame strip sampled at the game's real
 * frame rate into `preview/anchor-icon-strip.png`. Then checks:
 *
 *  - every frame paints something and nothing outside its own cell;
 *  - the stone and shards fill their cell about as much as other icons do;
 *  - consecutive frames at the real frame rate differ by little, so the
 *    animation can never strobe or pop;
 *  - one repaint costs well under a frame's budget, since the hotbar repaints
 *    it every frame.
 *
 *   npm run gates:anchor-icon
 */

import { pathToFileURL } from 'node:url';

import { createCanvas } from 'canvas';

import { asGameContext, gameContext } from './nodeGameContext.js';
import { writePreviewPng } from './previewOut.js';
import {
  ANCHOR_ICON_LOOP_S,
  drawAnchorShardIcon,
  paintAnchorStoneAt,
} from '../src/ui/icons/anchorStoneIcon.js';
import { drawItemIcon } from '../src/ui/icons/drawItemIcon.js';
import type { InventoryItem } from '../src/core/ItemDefs.js';
import type { Rect } from '../src/ui/core/geom.js';

type TimedDraw = (ctx: CanvasRenderingContext2D, rect: Rect, timeS: number) => void;

interface IconSpec {
  readonly label: string;
  readonly draw: TimedDraw;
  /** Shown for scale only; not held to the fill gate. */
  readonly reference?: true;
}

const REFERENCE_HEALTH_POTION: InventoryItem = {
  id: 'health_potion',
  baseValue: 0,
  name: 'Health Potion',
  quantity: 1,
  stackable: true,
  canHotlist: true,
};

const STONE: IconSpec = { label: 'wayfinders_anchor', draw: paintAnchorStoneAt };
const SHARD: IconSpec = {
  label: 'anchor_shard',
  draw: (ctx, rect) => drawAnchorShardIcon(ctx, rect),
};
const REFERENCE: IconSpec = {
  label: 'reference:health_potion',
  draw: (ctx, rect) => drawItemIcon(ctx, rect, REFERENCE_HEALTH_POTION),
  reference: true,
};
const ALL_ICONS: readonly IconSpec[] = [REFERENCE, STONE, SHARD];

const SIZE_HOTBAR_SLOT = 24;
const SIZE_INVENTORY_GRID = 32;
const SIZE_REWARD_CARD = 48;
const SIZES = [SIZE_HOTBAR_SLOT, SIZE_INVENTORY_GRID, SIZE_REWARD_CARD] as const;
const LOOP_SAMPLES = 8;
const SAMPLE_TIMES: readonly number[] = Array.from(
  { length: LOOP_SAMPLES },
  (_, index) => (index / LOOP_SAMPLES) * ANCHOR_ICON_LOOP_S,
);

/** The render loop runs once per display refresh; 60 Hz is the common case. */
const DISPLAY_REFRESH_HZ = 60;
const REAL_FRAME_S = 1 / DISPLAY_REFRESH_HZ;
const STRIP_FRAMES = 24;
/** The strip starts just before a gleam so it shows the fastest motion the icon makes. */
const STRIP_LEAD_IN_FRAMES = 4;
const STRIP_START_S = ANCHOR_ICON_LOOP_S - REAL_FRAME_S * STRIP_LEAD_IN_FRAMES;
const STRIP_SIZE = 48;

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const SOLID_ALPHA = 40;
const MIN_OPAQUE_FRACTION = 0.03;
const BLEED_ALPHA = 8;
const CELL_PAD = 4;
/** `health_potion` measures 0.71; this is the same floor `gates:village-icons` holds. */
const MIN_BBOX_FRACTION = 0.6;
/**
 * Largest mean per-channel change between two consecutive real-speed frames,
 * as a fraction of full scale. A blink or a mote popping in would jump well
 * past this; a slow breath and a sliding gleam stay far under it.
 */
const MAX_MEAN_FRAME_DELTA = 0.01;
/** Largest single-channel jump a pixel may make between consecutive frames. */
const MAX_PIXEL_FRAME_DELTA = 96;
const BYTE_MAX = 255;
/** Background the strip is judged on: the hotbar slot's own fill. */
const HOTBAR_SLOT_FILL = '#0f172a';

const DELTA_DECIMALS = 4;
const MS_DECIMALS = 3;

const PERF_ITERATIONS = 2000;
/** Generous for node-canvas, which is slower than Chrome's accelerated canvas. */
const MAX_MS_PER_PAINT = 0.5;

const failures: string[] = [];
function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

interface Pixels {
  readonly width: number;
  readonly data: Uint8ClampedArray;
}

function paint(
  spec: IconSpec,
  size: number,
  timeS: number,
  offset: number,
  canvasSize: number,
  background?: string,
): Pixels {
  const ctx = gameContext(canvasSize, canvasSize);
  if (background !== undefined) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvasSize, canvasSize);
  }
  spec.draw(ctx, { x: offset, y: offset, w: size, h: size }, timeS);
  return { width: canvasSize, data: ctx.getImageData(0, 0, canvasSize, canvasSize).data };
}

function alphaAt(pixels: Pixels, x: number, y: number): number {
  return pixels.data[(y * pixels.width + x) * CHANNELS + ALPHA_OFFSET] ?? 0;
}

function gateFrames(): void {
  for (const spec of ALL_ICONS) {
    for (const size of SIZES) {
      for (const timeS of SAMPLE_TIMES) {
        const where = `${spec.label}@${size}px t=${timeS.toFixed(2)}s`;
        const canvasSize = size + CELL_PAD * 2;
        const pixels = paint(spec, size, timeS, CELL_PAD, canvasSize);
        let opaque = 0;
        let minX = canvasSize;
        let maxX = -1;
        let minY = canvasSize;
        let maxY = -1;
        let bleed: string | null = null;
        for (let py = 0; py < canvasSize; py++) {
          for (let px = 0; px < canvasSize; px++) {
            const alpha = alphaAt(pixels, px, py);
            const insideCell =
              px >= CELL_PAD && px < CELL_PAD + size && py >= CELL_PAD && py < CELL_PAD + size;
            if (!insideCell) {
              if (alpha > BLEED_ALPHA && bleed === null) {
                bleed = `(${px - CELL_PAD}, ${py - CELL_PAD})`;
              }
              continue;
            }
            if (alpha < SOLID_ALPHA) continue;
            opaque++;
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
          }
        }
        if (bleed !== null) fail('no-bleed', `${where} painted outside its cell at ${bleed}`);
        const minOpaque = Math.ceil(size * size * MIN_OPAQUE_FRACTION);
        if (opaque < minOpaque) {
          fail('non-empty', `${where} painted ${opaque} opaque px, need ${minOpaque}`);
          continue;
        }
        if (spec.reference === true) continue;
        const bboxFraction = Math.max(maxX - minX + 1, maxY - minY + 1) / size;
        if (bboxFraction < MIN_BBOX_FRACTION) {
          fail(
            'min-fill',
            `${where} bounding box covers ${bboxFraction.toFixed(2)} of the cell, need ${MIN_BBOX_FRACTION}`,
          );
        }
      }
    }
  }
}

/** Walks a whole loop at the real frame rate, at every size, comparing neighbours. */
function gateSmoothMotion(): void {
  const framesPerLoop = Math.round(ANCHOR_ICON_LOOP_S / REAL_FRAME_S);
  for (const size of SIZES) {
    let previous: Pixels | null = null;
    let worstMean = 0;
    let worstMeanAt = 0;
    let worstPixel = 0;
    let worstPixelAt = 0;
    for (let frame = 0; frame <= framesPerLoop; frame++) {
      const timeS = frame * REAL_FRAME_S;
      const current = paint(STONE, size, timeS, 0, size, HOTBAR_SLOT_FILL);
      if (previous !== null) {
        let total = 0;
        let peak = 0;
        for (let index = 0; index < current.data.length; index++) {
          if (index % CHANNELS === ALPHA_OFFSET) continue;
          const delta = Math.abs((current.data[index] ?? 0) - (previous.data[index] ?? 0));
          total += delta;
          peak = Math.max(peak, delta);
        }
        const colourChannels = (current.data.length / CHANNELS) * (CHANNELS - 1);
        const mean = total / colourChannels / BYTE_MAX;
        if (mean > worstMean) {
          worstMean = mean;
          worstMeanAt = timeS;
        }
        if (peak > worstPixel) {
          worstPixel = peak;
          worstPixelAt = timeS;
        }
      }
      previous = current;
    }
    console.log(
      `  ${size}px: worst mean frame delta ${worstMean.toFixed(DELTA_DECIMALS)} at ${worstMeanAt.toFixed(2)}s, worst pixel ${worstPixel} at ${worstPixelAt.toFixed(2)}s`,
    );
    if (worstMean > MAX_MEAN_FRAME_DELTA) {
      fail(
        'smooth-motion',
        `${size}px mean frame-to-frame change ${worstMean.toFixed(DELTA_DECIMALS)} at ${worstMeanAt.toFixed(2)}s exceeds ${MAX_MEAN_FRAME_DELTA}`,
      );
    }
    if (worstPixel > MAX_PIXEL_FRAME_DELTA) {
      fail(
        'smooth-motion',
        `${size}px a pixel jumped ${worstPixel} in one frame at ${worstPixelAt.toFixed(2)}s, limit ${MAX_PIXEL_FRAME_DELTA}`,
      );
    }
  }
}

function gateCost(): void {
  const size = SIZES[SIZES.length - 1];
  const ctx = gameContext(size, size);
  const started = performance.now();
  for (let iteration = 0; iteration < PERF_ITERATIONS; iteration++) {
    paintAnchorStoneAt(ctx, { x: 0, y: 0, w: size, h: size }, iteration * REAL_FRAME_S);
  }
  const msPerPaint = (performance.now() - started) / PERF_ITERATIONS;
  console.log(`  cost: ${msPerPaint.toFixed(MS_DECIMALS)} ms per ${size}px paint (node-canvas)`);
  if (msPerPaint > MAX_MS_PER_PAINT) {
    fail('cost', `${msPerPaint.toFixed(MS_DECIMALS)} ms per paint exceeds ${MAX_MS_PER_PAINT} ms`);
  }
}

/** Runs every gate and returns one message per failure. */
export function anchorIconGateFailures(): string[] {
  failures.length = 0;
  gateFrames();
  gateSmoothMotion();
  gateCost();
  return [...failures];
}

const PREVIEW_PAD = 8;
const PREVIEW_LABEL_WIDTH = 180;
const PREVIEW_LABEL_FONT = '12px monospace';
const PREVIEW_BACKGROUND = '#20242c';
const PREVIEW_LABEL_COLOR = '#e8ecf2';

/** One row per icon per size; one column per sampled moment of the loop. */
function bakeLoopSheet(): string {
  const maxSize = SIZES[SIZES.length - 1];
  const cell = maxSize + PREVIEW_PAD * 2;
  const rows = ALL_ICONS.flatMap((spec) => SIZES.map((size) => ({ spec, size })));
  const width = PREVIEW_LABEL_WIDTH + cell * SAMPLE_TIMES.length;
  const height = cell * rows.length;
  const canvas = createCanvas(width, height);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = PREVIEW_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  ctx.font = PREVIEW_LABEL_FONT;
  ctx.textBaseline = 'middle';

  rows.forEach(({ spec, size }, row) => {
    const top = row * cell;
    ctx.fillStyle = PREVIEW_LABEL_COLOR;
    ctx.fillText(`${spec.label} ${size}px`, PREVIEW_PAD, top + cell / 2);
    SAMPLE_TIMES.forEach((timeS, column) => {
      const iconX = PREVIEW_LABEL_WIDTH + column * cell + (cell - size) / 2;
      const iconY = top + (cell - size) / 2;
      ctx.fillStyle = HOTBAR_SLOT_FILL;
      ctx.fillRect(iconX, iconY, size, size);
      spec.draw(ctx, { x: iconX, y: iconY, w: size, h: size }, timeS);
    });
  });
  return writePreviewPng('preview/anchor-icon.png', canvas.toBuffer('image/png'));
}

/** Consecutive real-speed frames, so a reviewer sees exactly what one refresh changes. */
function bakeStrip(): string {
  const cell = STRIP_SIZE + PREVIEW_PAD;
  const width = cell * STRIP_FRAMES + PREVIEW_PAD;
  const height = cell + PREVIEW_PAD;
  const canvas = createCanvas(width, height);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = PREVIEW_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  for (let frame = 0; frame < STRIP_FRAMES; frame++) {
    const iconX = PREVIEW_PAD + frame * cell;
    ctx.fillStyle = HOTBAR_SLOT_FILL;
    ctx.fillRect(iconX, PREVIEW_PAD, STRIP_SIZE, STRIP_SIZE);
    const stripCell = { x: iconX, y: PREVIEW_PAD, w: STRIP_SIZE, h: STRIP_SIZE };
    paintAnchorStoneAt(ctx, stripCell, STRIP_START_S + frame * REAL_FRAME_S);
  }
  return writePreviewPng('preview/anchor-icon-strip.png', canvas.toBuffer('image/png'));
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invokedDirectly) {
  console.log(`Baked ${bakeLoopSheet()}`);
  console.log(`Baked ${bakeStrip()}`);
  const results = anchorIconGateFailures();
  if (results.length === 0) {
    console.log('  ok   anchor-icon');
  } else {
    for (const failure of results) console.error(`  FAIL anchor-icon: ${failure}`);
    process.exitCode = 1;
  }
}
