/**
 * Review harness for Dave in the world: every frame of his teleport in and
 * out, and every row he walks, stands and talks in, all drawn through
 * `drawDaveSprite`, the game's own path.
 *
 *   npm run render:dave-teleport
 *
 * Writes under `preview/dave-teleport/`:
 *   - `in.png`, `out.png`: every tick of each teleport at the bake's own tile,
 *     then at the 32 px tile on the dungeon floor, and that blown up
 *     nearest-neighbour so the in-game pixels can be judged.
 *   - `rows.png`: idle, walk and talk in every view (the profile again facing
 *     −X), at the bake's tile, then at the 32 px tile and blown up.
 */

import { createCanvas, type Canvas } from 'canvas';
import { join } from 'node:path';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SCALE } from '../src/sprites/art/human/figureScale.js';
import { HUMAN_ROW_TABLE, type HumanRowName } from '../src/sprites/art/humanFigure.js';
import { TICKS_PER_SECOND } from '../src/sprites/art/human/timing.js';
import { rowFrameHolds } from '../src/sprites/humanSprite.js';
import { beginFigureFrame } from '../src/sprites/figure/figureFrameCache.js';
import type { CardinalView } from '../src/sprites/facingView.js';
import {
  DAVE_ROWS,
  type DaveSpriteState,
  drawDaveSprite,
  DRAWN_ROWS,
} from '../src/sprites/daveSprite.js';
import {
  TELEPORT_IN_FRAMES,
  TELEPORT_OUT_FRAMES,
  type TeleportDraw,
} from '../src/sprites/teleportEffect.js';

installCanvasGlobals();

const OUT_DIR = join(PREVIEW_DIR, 'dave-teleport');

const BAKE_TILE = TILE_SCALE;
const SMALL_TILE = 32;
const PIXEL_ZOOM = 3;
const COLUMNS = 12;
const LABEL_HEIGHT = 18;
const LABEL_FONT = '13px sans-serif';
const FRAME_LABEL_FONT = '10px sans-serif';
const LABEL_COLOR = '#e8e2d8';
const BACKDROP = '#3b3b40';
const DUNGEON_FLOOR = '#191720';
const GAP = 8;

/** The window each picture is drawn in, in tiles: wide enough for the motes, tall enough for the column over his head. */
const WINDOW_TILES_W = 2;
const WINDOW_TILES_H = 3.4;
/** His tile's top-left inside that window, in tiles. */
const TILE_LEFT_TILES = 0.5;
const TILE_TOP_TILES = 2.25;

/** Seconds into his breathing loop the stills are drawn at: frame 0, as the teleport cuts its light from. */
const STILL_IDLE_OFFSET = 0;
const FACING_RIGHT = 1;

function standing(teleport: TeleportDraw | null): DaveSpriteState {
  return {
    walkPhase: 0,
    isWalking: false,
    isTalking: false,
    facingX: 0,
    facingY: 1,
    lastHorizontalFacing: FACING_RIGHT,
    idleOffsetSeconds: STILL_IDLE_OFFSET,
    teleport,
  };
}

/** One picture: a window of floor with Dave drawn in it by `draw`. */
function picture(tile: number, floor: string, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = createCanvas(Math.ceil(WINDOW_TILES_W * tile), Math.ceil(WINDOW_TILES_H * tile));
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  beginFigureFrame();
  draw(ctx);
  return canvas;
}

function zoomed(source: Canvas, zoom: number): Canvas {
  const canvas = createCanvas(source.width * zoom, source.height * zoom);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

interface Labelled {
  readonly label: string;
  readonly image: Canvas;
}

/** A grid of labelled pictures, `COLUMNS` to a row. */
function grid(items: readonly Labelled[]): Canvas {
  if (items.length === 0) throw new Error('nothing to lay out');
  const first = items[0];
  const cellW = first.image.width + GAP;
  const cellH = first.image.height + LABEL_HEIGHT + GAP;
  const columns = Math.min(COLUMNS, items.length);
  const rows = Math.ceil(items.length / columns);
  const canvas = createCanvas(columns * cellW + GAP, rows * cellH + GAP);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  items.forEach((item, i) => {
    const x = GAP + (i % columns) * cellW;
    const y = GAP + Math.floor(i / columns) * cellH;
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = FRAME_LABEL_FONT;
    ctx.fillText(item.label, x, y + LABEL_HEIGHT - GAP / 2);
    ctx.drawImage(item.image, x, y + LABEL_HEIGHT);
  });
  return canvas;
}

/** Bands stacked top to bottom under their titles. */
function stack(bands: readonly Labelled[]): Canvas {
  const width = Math.max(...bands.map((band) => band.image.width));
  const height = bands.reduce((sum, band) => sum + LABEL_HEIGHT + band.image.height + GAP, 0);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const band of bands) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = LABEL_FONT;
    ctx.fillText(band.label, GAP, y + LABEL_HEIGHT - GAP / 2);
    y += LABEL_HEIGHT;
    ctx.drawImage(band.image, 0, y);
    y += band.image.height + GAP;
  }
  return canvas;
}

function teleportFrame(
  direction: TeleportDraw['direction'],
  elapsedFrames: number,
  tile: number,
): Canvas {
  return picture(tile, DUNGEON_FLOOR, (ctx) => {
    drawDaveSprite(
      ctx,
      TILE_LEFT_TILES * tile,
      TILE_TOP_TILES * tile,
      tile,
      standing({ direction, elapsedFrames }),
    );
  });
}

function teleportSheet(direction: TeleportDraw['direction'], frames: number): Canvas {
  const ticks = Array.from({ length: frames + 1 }, (_, tick) => tick);
  const large = ticks.map((tick) => ({
    label: `${direction} ${tick}`,
    image: teleportFrame(direction, tick, BAKE_TILE),
  }));
  const small = ticks.map((tick) => ({
    label: `${tick}`,
    image: teleportFrame(direction, tick, SMALL_TILE),
  }));
  const blown = small.map((item) => ({ label: item.label, image: zoomed(item.image, PIXEL_ZOOM) }));
  return stack([
    {
      label: `teleport ${direction}, every tick from the first to the last, at the bake's tile`,
      image: grid(large),
    },
    { label: `at the 32 px tile`, image: grid(small) },
    { label: `at the 32 px tile ×${PIXEL_ZOOM}`, image: grid(blown) },
  ]);
}

const VIEWS: readonly CardinalView[] = ['front', 'side', 'back'];
const FACINGS: Readonly<Record<CardinalView, { readonly x: number; readonly y: number }>> = {
  front: { x: 0, y: 1 },
  side: { x: 1, y: 0 },
  back: { x: 0, y: -1 },
};
const FULL_TURN = Math.PI * 2;

/** The state that draws `frame` of `row` in `view`, mirrored when `west`. */
function rowState(
  row: (typeof DRAWN_ROWS)[number],
  name: HumanRowName,
  view: CardinalView,
  frame: number,
  west: boolean,
): DaveSpriteState {
  const meta = HUMAN_ROW_TABLE[name];
  const facing = FACINGS[view];
  const sign = west ? -1 : 1;
  const heldTicks = rowFrameHolds(meta)
    .slice(0, frame)
    .reduce((sum, ticks) => sum + ticks, 0);
  return {
    walkPhase: ((frame + 1 / 2) / meta.frameCount) * FULL_TURN,
    isWalking: row === 'walk',
    isTalking: row === 'talk',
    facingX: facing.x * sign,
    facingY: facing.y,
    lastHorizontalFacing: sign,
    idleOffsetSeconds:
      (heldTicks + HALF_TICK) / TICKS_PER_SECOND - performance.now() / MS_PER_SECOND,
    teleport: null,
  };
}
const MS_PER_SECOND = 1000;
/**
 * His sprite reads the breathing and talking loops off the clock, so a still
 * of one frame is drawn by setting his clock offset to the middle of that
 * frame's first tick, clear of the clock moving on between here and the draw.
 */
const HALF_TICK = 0.5;

function rowStrip(
  row: (typeof DRAWN_ROWS)[number],
  view: CardinalView,
  west: boolean,
  tile: number,
): Canvas {
  const name = DAVE_ROWS[row][view];
  const frames = HUMAN_ROW_TABLE[name].frameCount;
  const pictures = Array.from({ length: frames }, (_, frame) =>
    picture(tile, tile === BAKE_TILE ? BACKDROP : DUNGEON_FLOOR, (ctx) => {
      drawDaveSprite(
        ctx,
        TILE_LEFT_TILES * tile,
        TILE_TOP_TILES * tile,
        tile,
        rowState(row, name, view, frame, west),
      );
    }),
  );
  const width = pictures.reduce((sum, image) => sum + image.width, 0);
  const canvas = createCanvas(width, pictures.length === 0 ? 1 : pictures[0].height);
  const ctx = canvas.getContext('2d');
  let x = 0;
  for (const image of pictures) {
    ctx.drawImage(image, x, 0);
    x += image.width;
  }
  return canvas;
}

function rowsSheet(): Canvas {
  const bands: Labelled[] = [];
  for (const row of DRAWN_ROWS) {
    for (const view of VIEWS) {
      const name = DAVE_ROWS[row][view];
      bands.push({ label: `${row} — ${name}`, image: rowStrip(row, view, false, BAKE_TILE) });
      if (view === 'side')
        bands.push({
          label: `${row} — ${name} facing −X`,
          image: rowStrip(row, view, true, BAKE_TILE),
        });
    }
  }
  for (const row of DRAWN_ROWS) {
    for (const view of VIEWS) {
      const small = rowStrip(row, view, false, SMALL_TILE);
      bands.push({ label: `${DAVE_ROWS[row][view]} at the 32 px tile`, image: small });
      bands.push({ label: `  (×${PIXEL_ZOOM})`, image: zoomed(small, PIXEL_ZOOM) });
    }
  }
  return stack(bands);
}

for (const [name, image] of [
  ['in', teleportSheet('in', TELEPORT_IN_FRAMES)],
  ['out', teleportSheet('out', TELEPORT_OUT_FRAMES)],
  ['rows', rowsSheet()],
] as const) {
  console.log(`  wrote ${writePreviewPng(join(OUT_DIR, `${name}.png`), image.toBuffer())}`);
}
