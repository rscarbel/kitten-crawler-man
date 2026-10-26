/**
 * The cat's review harness. Art has to be judged as an image, by something that
 * only looks at the image — every defect that has ever mattered on a figure in
 * this project was invisible to `typecheck`, `lint` and a code read.
 *
 * The contact sheet is painted from `CAT_FIGURE` the way the runtime cache
 * bakes it, and the art gates run as part of the render, so one command answers
 * both "does it still hold together" and "what does it look like".
 *
 *   npm run render:cat
 *   npx tsx scripts/render-cat.ts --row=swipe_side --scale=4
 *   npx tsx scripts/render-cat.ts --row=walk_side,walk_side_west --scale=3
 *   npx tsx scripts/render-cat.ts --part=head --scale=6
 *   npx tsx scripts/render-cat.ts --row=walk_side --mode=onion --scale=3
 *   npx tsx scripts/render-cat.ts --frame=5 --row=cast --scale=8
 *   npx tsx scripts/render-cat.ts --look=pumpkin
 *   npx tsx scripts/render-cat.ts --row=walk_side --mode=strip32
 *
 * `--look=` picks the cat (belle by default; see `catLooks.ts`). `strip32`
 * paints every frame of each row at the in-game 32 px tile on the dungeon
 * floor, with a nearest-neighbour blow-up under it: the size the art is
 * judged at.
 */

import { createCanvas } from 'canvas';

import { CAT_LOOKS, catLookFlag } from './catLooks.js';
import { bakeFigureSheet, paintFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { catGateFailures } from './gates-cat.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { CAT_ROWS, TILE_SCALE, catFigureFor } from '../src/sprites/art/catFigure.js';
import type { WornGarmentDef } from '../src/sprites/garments/garmentDef.js';
import { wornGarmentsOf } from '../src/sprites/garments/garments.js';
import { outfitOf } from '../src/sprites/garments/outfit.js';
import { figureBakeDensity } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const DUNGEON_FLOOR = '#191720';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const ONION_ALPHA = 0.4;
const NO_FRAME = -1;
const MAX_FRAME_FLAG = 64;

type Mode = 'sheet' | 'onion' | 'delta' | 'strip32';
const MODES: ReadonlyArray<Mode> = ['sheet', 'onion', 'delta', 'strip32'];
/** How many times the strip's nearest-neighbour copy blows up the 32 px row. */
const STRIP_BLOW_UP = 3;
/** The share of her cell the strip keeps round its tile: she never reaches the outer margin standing. */
const STRIP_CROP_SHARE = 0.6;

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Windows onto one body part, as fractions of the frame so the table survives
 * the figure re-deriving its own cell size. Whole-figure contact sheets hide
 * exactly the defects that matter most at these sizes.
 */
const PARTS: Record<string, PartWindow> = {
  head: { x: 0.34, y: 0.3, w: 0.32, h: 0.3 },
  body: { x: 0.22, y: 0.36, w: 0.56, h: 0.34 },
  paws: { x: 0.24, y: 0.5, w: 0.52, h: 0.26 },
  tail: { x: 0.04, y: 0.26, w: 0.5, h: 0.46 },
};

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

/** A bad number here silently produces a blank or NaN-sized contact sheet. */
function parseNumberFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

function parseMode(): Mode {
  const raw = parseFlag('mode', 'sheet');
  const found = MODES.find((mode) => mode === raw);
  if (found === undefined) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
  return found;
}

/** What she is drawn wearing: `--wear=` a comma list of her garment ids, or `none`. */
function parseWear(): WornGarmentDef<'cat'>[] {
  const raw = parseFlag('wear', 'none');
  if (raw === 'none') return [];
  const wearable = wornGarmentsOf('cat');
  return raw.split(',').map((id) => {
    const garment = wearable.find((candidate) => candidate.id === id);
    if (garment === undefined) {
      throw new Error(`--wear=${id} is not one of none, ${wearable.map((g) => g.id).join(', ')}`);
    }
    return garment;
  });
}

const CAT_LOOK = catLookFlag();
const WORN = parseWear();
const CAT_FIGURE = catFigureFor(CAT_LOOK, outfitOf(CAT_LOOK, WORN));

function frameCountOf(state: string): number {
  const declared = CAT_FIGURE.states.get(state);
  if (declared === undefined) throw new Error(`The cat declares no state "${state}"`);
  return declared.frames;
}

function labelOf(state: string): string {
  const row = CAT_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) throw new Error(`no row named "${state}"`);
  const westward = row.facesWest ? ' facing west' : '';
  return `${row.name} — ${row.frameCount} frames, ${row.view}${westward}, ${row.kind}`;
}

function main(): void {
  const outPath = parseFlag('out', `${PREVIEW_DIR}/cat-review.png`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const mode = parseMode();
  const rowFilter = parseFlag('row', '');
  const partName = parseFlag('part', '');
  const frameFilter = Math.round(parseNumberFlag('frame', NO_FRAME, NO_FRAME, MAX_FRAME_FLAG));

  const knownPart = partName in PARTS;
  if (partName !== '' && !knownPart) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PARTS).join(', ')}`);
  }
  const part = knownPart ? PARTS[partName] : null;

  const allStates = CAT_ROWS.map((row) => row.name);
  const wanted = rowFilter === '' ? allStates : rowFilter.split(',');
  const unknown = wanted.filter((state) => !allStates.includes(state));
  if (unknown.length > 0) {
    throw new Error(`--row=${unknown.join(',')} is not one of ${allStates.join(', ')}`);
  }
  const states = wanted;

  // Ahead of the contact sheet rather than after it: the sheet is a
  // tens-of-megapixel allocation, and measuring art on the far side of one is
  // how a gate goes red on art nobody touched.
  // Every look, not only the one painted: the looks share the rows and the
  // part frames, so a change made for one can break the other.
  for (const look of CAT_LOOKS) {
    console.log(`Gating ${look.id}…`);
    const figure = look === CAT_LOOK ? CAT_FIGURE : catFigureFor(look, outfitOf(look, WORN));
    reportFigureGates(`cat:${look.id}`, catGateFailures(look, figure));
  }

  if (mode === 'strip32') {
    writeStrip32(outPath, states, CAT_FIGURE.frameWidth, CAT_FIGURE.frameHeight, frameFilter);
    return;
  }

  const baked = bakeFigureSheet(CAT_FIGURE, states);
  const sheet = baked.canvas;
  const frameW = baked.frameWidth;
  const frameH = baked.frameHeight;

  const cropped = part !== null;
  const srcW = cropped ? Math.round(part.w * frameW) : frameW;
  const srcH = cropped ? Math.round(part.h * frameH) : frameH;
  const srcOffsetX = cropped ? Math.round(part.x * frameW) : 0;
  const srcOffsetY = cropped ? Math.round(part.y * frameH) : 0;
  const cellW = srcW * scale;
  const cellH = srcH * scale;

  const columnsOf = (frameCount: number): number[] =>
    frameFilter === NO_FRAME
      ? Array.from({ length: frameCount }, (_unused, i) => i)
      : [Math.min(frameCount - 1, Math.max(0, frameFilter))];

  const maxCols = Math.max(...states.map((state) => columnsOf(frameCountOf(state)).length));
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const inGameW = frameW * inGameScale;
  const inGameH = frameH * inGameScale;
  const stripWidth = PADDING + states.length * (inGameW + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  states.forEach((state, sheetRow) => {
    const frameCount = frameCountOf(state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      labelOf(state) + (cropped ? `  [${partName}]` : ''),
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    columnsOf(frameCount).forEach((col, slot) => {
      const x = PADDING + slot * (cellW + PADDING);
      const blit = (frame: number, alpha: number): void => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(
          sheet,
          frame * frameW + srcOffsetX,
          sheetRow * frameH + srcOffsetY,
          srcW,
          srcH,
          x,
          y,
          cellW,
          cellH,
        );
        ctx.restore();
      };
      if (mode === 'delta') {
        // The previous frame is subtracted rather than overlaid, so what is
        // left is only what moved — which is where a continuity gate fires.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellW, cellH);
        ctx.clip();
        blit(col, 1);
        ctx.globalCompositeOperation = 'difference';
        blit((col + frameCount - 1) % frameCount, 1);
        ctx.restore();
      } else {
        if (mode === 'onion') blit((col + frameCount - 1) % frameCount, ONION_ALPHA);
        blit(col, 1);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (!cropped) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + CAT_FIGURE.tileX * scale,
          y + CAT_FIGURE.tileY * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
    });
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    'in-game size (32px tile), on the dungeon floor',
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;
  ctx.fillStyle = DUNGEON_FLOOR;
  ctx.fillRect(0, y, canvas.width, inGameH);
  states.forEach((_state, sheetRow) => {
    ctx.drawImage(
      sheet,
      0,
      sheetRow * frameH,
      frameW,
      frameH,
      PADDING + sheetRow * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  });

  const writtenPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(
    `Wrote ${writtenPath} (${canvas.width}×${canvas.height}px, scale ${scale}×, mode ${mode})`,
  );
}

/**
 * Every frame of each row at the in-game size on the dungeon floor, cropped
 * round her tile, with a nearest-neighbour copy blown up under it.
 */
function writeStrip32(
  outPath: string,
  states: readonly string[],
  frameW: number,
  frameH: number,
  frameFilter: number,
): void {
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const cropW = Math.round(frameW * STRIP_CROP_SHARE);
  const cropH = Math.round(frameH * STRIP_CROP_SHARE);
  const cropX = Math.round((frameW - cropW) / 2);
  const cropY = Math.round((frameH - cropH) / 2);
  const cellW = Math.round(cropW * inGameScale);
  const cellH = Math.round(cropH * inGameScale);
  const framesOf = (state: string): number[] => {
    const count = frameCountOf(state);
    return frameFilter === NO_FRAME
      ? Array.from({ length: count }, (_unused, i) => i)
      : [Math.min(count - 1, Math.max(0, frameFilter))];
  };
  const maxFrames = Math.max(...states.map((state) => framesOf(state).length));
  const small = createCanvas(maxFrames * cellW, states.length * cellH);
  const smallCtx = small.getContext('2d');
  smallCtx.fillStyle = DUNGEON_FLOOR;
  smallCtx.fillRect(0, 0, small.width, small.height);
  // Each cell is painted at the in-game size, supersampled, the way the cache
  // bakes it for a 32 px tile — not shrunk from the full-size sheet — so
  // anything the painter sizes to the surface (her tooth) shows as it does
  // in the game.
  const bakeDensity = inGameScale * figureBakeDensity(CAT_FIGURE);
  states.forEach((state, sheetRow) => {
    framesOf(state).forEach((frame, slot) => {
      const painted = paintFigureCell(CAT_FIGURE, state, frame, bakeDensity);
      smallCtx.drawImage(
        painted,
        cropX * bakeDensity,
        cropY * bakeDensity,
        cropW * bakeDensity,
        cropH * bakeDensity,
        slot * cellW,
        sheetRow * cellH,
        cellW,
        cellH,
      );
    });
  });

  const rowLabelsHeight = LABEL_HEIGHT;
  const blownW = small.width * STRIP_BLOW_UP;
  const blownH = small.height * STRIP_BLOW_UP;
  const canvas = createCanvas(
    Math.max(blownW, small.width) + PADDING * 2,
    rowLabelsHeight + small.height + PADDING + blownH + PADDING * 2,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  // Unlabelled by row: the strip is for judging whether each row reads as its
  // action at game size, and a row's name would answer that for the viewer.
  ctx.fillText(`${states.length} rows — 32px tile`, PADDING, LABEL_HEIGHT - PADDING);
  ctx.drawImage(small, PADDING, rowLabelsHeight);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, PADDING, rowLabelsHeight + small.height + PADDING, blownW, blownH);
  const writtenPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${writtenPath} (${canvas.width}×${canvas.height}px, mode strip32)`);
}

main();
