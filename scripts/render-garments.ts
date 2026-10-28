/**
 * A garment's review sheet, for either crawler: the garment at the in-game
 * 32 px tile on the dungeon floor across a spread of rows and views (walking,
 * standing, striking, casting and lying, in every view he or she is drawn in),
 * then the standing views large. `--compare` paints each row without the
 * garment beside it. No art gates run here: this is for looking.
 *
 *   npx tsx scripts/render-garments.ts --wear=townsfolk_shoes
 *   npx tsx scripts/render-garments.ts --wear=townsfolk_trousers,townsfolk_shoes --compare
 *   npx tsx scripts/render-garments.ts --wear=townsfolk_shoes --rows=walk_side:0,walk_side:8
 *   npx tsx scripts/render-garments.ts --wear=townsfolk_shoes --out=shoes.png
 *   npx tsx scripts/render-garments.ts --wear=townsfolk_shoes --look=dave
 *
 * A garment is drawn on the look `--look=` names: a cat look for a cat garment
 * (see `catLooks.ts`), a human look for a human one (see `humanLooks.ts`).
 */

import { createCanvas } from 'canvas';
import { catLookFlag } from './catLooks.js';
import { bakeFigureCell } from './figureSheet.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { catFigureFor, TILE_SCALE as CAT_TILE_SCALE } from '../src/sprites/art/catFigure.js';
import { humanFigureFor } from '../src/sprites/art/human/appearance.js';
import { TILE_SCALE as HUMAN_TILE_SCALE } from '../src/sprites/art/human/figureScale.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import type { GarmentWearer, WornGarmentDef } from '../src/sprites/garments/garmentDef.js';
import { wornGarmentsOf } from '../src/sprites/garments/garments.js';
import { outfitOf } from '../src/sprites/garments/outfit.js';
import { humanLookFlag } from './humanLooks.js';

const IN_GAME_TILE = 32;
/** How many times the 32 px strip is blown up, nearest-neighbour, so its pixels can be read. */
const STRIP_UP = 4;
const PER_LINE = 8;
const ZOOM_CELL_PX = 240;
const FLOOR = '#191720';
const BACKDROP = '#3b3b40';

type Sample = readonly [row: string, frame: number];

interface Subject {
  readonly worn: FigureDef;
  readonly bare: FigureDef;
  readonly tileScale: number;
  /** The share of the cell the figure occupies, cropped to for the strip and the zoom. */
  readonly crop: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly strip: readonly Sample[];
  readonly zoom: readonly Sample[];
}

const CAT_STRIP = parseSamples(
  'walk:0,walk:4,walk_side:0,walk_side:4,walk_side_west:0,walk_side_west:4,walk_away:0,walk_away:4,idle:0,idle_side:0,idle_side_west:0,idle_away:0,swipe:4,swipe_side:4,cast:4,cast_side_west:4,look_around:4,groom_paw:6,knocked_out:0,dance:3',
);
const CAT_ZOOM = parseSamples('idle:0,idle_side:0,idle_side_west:0,idle_away:0');

const HUMAN_STRIP = parseSamples(
  'walk:0,walk:8,walk_side:0,walk_side:8,walk_away:0,walk_away:8,run_side:4,run:4,idle:0,idle_side:0,idle_away:0,guard_side:0,cross_side:4,roundhouse_side:4,stomp_down:3,uppercut_up:4,shield_cast:4,build_side:6,knocked_out_side:0,seismic_stomp_side:4',
);
const HUMAN_ZOOM = parseSamples('idle:0,idle_side:0,idle_away:0');

function flag(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? null : match.slice(prefix.length);
}

function parseSamples(raw: string): Sample[] {
  return raw.split(',').map((entry) => {
    const [row, frame = '0'] = entry.split(':');
    return [row, Number(frame)] as const;
  });
}

function wearable<W extends GarmentWearer>(wearer: W, ids: readonly string[]): WornGarmentDef<W>[] {
  return wornGarmentsOf(wearer).filter((garment) => ids.includes(garment.id));
}

function subjectFor(ids: readonly string[]): Subject {
  const cat = wearable('cat', ids);
  const human = wearable('human', ids);
  if (cat.length > 0 && human.length > 0)
    throw new Error('--wear= names garments of both crawlers');
  if (cat.length + human.length !== ids.length) {
    const known = [...wornGarmentsOf('cat'), ...wornGarmentsOf('human')].map((g) => g.id);
    throw new Error(`--wear= names a garment that is not one of ${known.join(', ')}`);
  }
  if (cat.length > 0) {
    const look = catLookFlag();
    return {
      worn: catFigureFor(look, outfitOf(look, cat)),
      bare: catFigureFor(look, outfitOf(look, [])),
      tileScale: CAT_TILE_SCALE,
      crop: { x: 0.15, y: 0.22, w: 0.7, h: 0.66 },
      strip: CAT_STRIP,
      zoom: CAT_ZOOM,
    };
  }
  const look = humanLookFlag();
  return {
    worn: humanFigureFor(look, outfitOf(look, human), null).def,
    bare: humanFigureFor(look, outfitOf(look, []), null).def,
    tileScale: HUMAN_TILE_SCALE,
    crop: { x: 0.2, y: 0.08, w: 0.6, h: 0.82 },
    strip: HUMAN_STRIP,
    zoom: HUMAN_ZOOM,
  };
}

function main(): void {
  const wear = (flag('wear') ?? '').split(',').filter((id) => id !== '');
  if (wear.length === 0) throw new Error('--wear= names no garment');
  const subject = subjectFor(wear);
  const rows = flag('rows');
  const strip = rows === null ? subject.strip : parseSamples(rows);
  const compare = process.argv.includes('--compare');
  const figures = compare ? [subject.bare, subject.worn] : [subject.worn];
  const { crop } = subject;
  const frameW = subject.worn.frameWidth;
  const frameH = subject.worn.frameHeight;
  const tileW = Math.round((frameW * IN_GAME_TILE) / subject.tileScale);
  const tileH = Math.round((frameH * IN_GAME_TILE) / subject.tileScale);
  const cellW = Math.round(tileW * crop.w);
  const cellH = Math.round(tileH * crop.h);
  const lines = Math.ceil(strip.length / PER_LINE);
  const stripW = Math.min(strip.length, PER_LINE) * cellW;
  const stripH = cellH * figures.length * lines;
  const zoomH = Math.round(ZOOM_CELL_PX * (crop.h / crop.w) * (frameH / frameW));
  const zoomW = subject.zoom.length * figures.length * ZOOM_CELL_PX;
  const width = Math.max(stripW * STRIP_UP, zoomW);
  const height = stripH * STRIP_UP + zoomH;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);

  const small = createCanvas(stripW, stripH);
  const smallCtx = small.getContext('2d');
  smallCtx.fillStyle = FLOOR;
  smallCtx.fillRect(0, 0, stripW, stripH);
  const tile = createCanvas(tileW, tileH);
  const tileCtx = tile.getContext('2d');
  figures.forEach((figure, figureIndex) => {
    strip.forEach(([row, frame], index) => {
      tileCtx.clearRect(0, 0, tileW, tileH);
      tileCtx.drawImage(bakeFigureCell(figure, row, frame), 0, 0, tileW, tileH);
      const line = Math.floor(index / PER_LINE);
      smallCtx.drawImage(
        tile,
        Math.round(crop.x * tileW),
        Math.round(crop.y * tileH),
        cellW,
        cellH,
        (index % PER_LINE) * cellW,
        (line * figures.length + figureIndex) * cellH,
        cellW,
        cellH,
      );
    });
  });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, stripW * STRIP_UP, stripH * STRIP_UP);

  ctx.imageSmoothingEnabled = true;
  let x = 0;
  const y = stripH * STRIP_UP;
  for (const [row, frame] of subject.zoom) {
    for (const figure of figures) {
      ctx.fillStyle = FLOOR;
      ctx.fillRect(x, y, ZOOM_CELL_PX, zoomH);
      ctx.drawImage(
        bakeFigureCell(figure, row, frame),
        frameW * crop.x,
        frameH * crop.y,
        frameW * crop.w,
        frameH * crop.h,
        x,
        y,
        ZOOM_CELL_PX,
        zoomH,
      );
      x += ZOOM_CELL_PX;
    }
  }
  const out = flag('out') ?? `${PREVIEW_DIR}/garments-${wear.join('+')}.png`;
  const written = writePreviewPng(out, canvas.toBuffer('image/png'));
  console.log(`Wrote ${written} (${width}×${height}px)`);
}

main();
