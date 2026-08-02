/**
 * Headless review harness for the Level 3 goblin camp.
 *
 * Art has to be reviewable offline here — the browser harness cannot drive this
 * project well enough to judge a still. Two things are worth seeing, and this
 * draws both:
 *
 *   npx tsx scripts/render-camps.ts --out=rocks.png --scale=3
 *     Contact sheet: every variant at review scale with its anchor tile boxed,
 *     plus the same sheets blitted at the in-game tile size, where the
 *     silhouette is all that survives.
 *
 * Regenerate the sheets with `npm run gen:camps`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../src/images/environment/camp/manifest.json';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 3;
const DEFAULT_OUT = 'camps.png';
const LABEL_HEIGHT = 20;
const PADDING = 6;
const BACKDROP = '#3b3b40';
/** A mid-green so moss and granite are both judged against something like grass. */
const GROUND_SWATCH = '#5c6b34';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '13px sans-serif';
/** In-game strip: how many tiles of ground each prop is shown standing on. */
const STRIP_TILES_PER_PROP = 4;

interface SheetGeometry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw.slice(name.length + 3), 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + 3);
}

const scale = intArg('scale', DEFAULT_SCALE);
const outPath = stringArg('out', DEFAULT_OUT);

const sheets: ReadonlyArray<readonly [string, SheetGeometry]> = Object.entries(manifest);
const images = new Map<string, Image>();
for (const [key, geometry] of sheets) {
  images.set(key, await loadImage(resolve('src/images', geometry.path)));
}

const cellWidth = Math.max(...sheets.map(([, g]) => g.frameWidth)) * scale + PADDING * 2;
const cellHeight = Math.max(...sheets.map(([, g]) => g.frameHeight)) * scale + PADDING * 2;
const stripHeight = IN_GAME_TILE * 3 + LABEL_HEIGHT;

const canvas = createCanvas(cellWidth * sheets.length, cellHeight + LABEL_HEIGHT + stripHeight);
const ctx = canvas.getContext('2d');
ctx.fillStyle = BACKDROP;
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.font = LABEL_FONT;
ctx.imageSmoothingEnabled = false;

sheets.forEach(([key, geometry], index) => {
  const image = images.get(key);
  if (image === undefined) throw new Error(`sheet '${key}' failed to load`);
  const cellX = index * cellWidth;

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(key, cellX + PADDING, LABEL_HEIGHT - PADDING);

  // A patch of ground behind the prop, so the contact shadow and the moss are
  // judged against something the prop will actually stand on rather than
  // against a flat studio grey.
  ctx.fillStyle = GROUND_SWATCH;
  ctx.fillRect(
    cellX + PADDING,
    LABEL_HEIGHT + PADDING,
    geometry.frameWidth * scale,
    geometry.frameHeight * scale,
  );

  ctx.drawImage(
    image,
    0,
    0,
    geometry.frameWidth,
    geometry.frameHeight,
    cellX + PADDING,
    LABEL_HEIGHT + PADDING,
    geometry.frameWidth * scale,
    geometry.frameHeight * scale,
  );

  // The anchor tile: the one tile the prop actually blocks, and the line it
  // Y-sorts against.
  ctx.strokeStyle = TILE_GUIDE;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    cellX + PADDING + geometry.tileX * scale + 0.5,
    LABEL_HEIGHT + PADDING + geometry.tileY * scale + 0.5,
    IN_GAME_TILE * scale - 1,
    IN_GAME_TILE * scale - 1,
  );
});

// The strip: every variant at the size the game actually draws it, where the
// silhouette is the only thing that survives.
const stripTop = cellHeight + LABEL_HEIGHT;
ctx.fillStyle = LABEL_COLOR;
ctx.fillText('in-game scale (32 px a tile)', PADDING, stripTop + LABEL_HEIGHT - PADDING);
const stripGroundTop = stripTop + LABEL_HEIGHT;
ctx.fillStyle = GROUND_SWATCH;
ctx.fillRect(0, stripGroundTop, canvas.width, IN_GAME_TILE * 3);

sheets.forEach(([key, geometry], index) => {
  const image = images.get(key);
  if (image === undefined) throw new Error(`sheet '${key}' failed to load`);
  // Each rock's anchor tile is placed on the same ground line, so the family can
  // be compared for how high it stands and how deep it sits.
  const anchorLeft = index * STRIP_TILES_PER_PROP * IN_GAME_TILE + IN_GAME_TILE;
  const groundLine = stripGroundTop + IN_GAME_TILE * 2;
  ctx.drawImage(
    image,
    0,
    0,
    geometry.frameWidth,
    geometry.frameHeight,
    anchorLeft - geometry.tileX,
    groundLine - geometry.tileY,
    geometry.frameWidth,
    geometry.frameHeight,
  );
});

writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(`${outPath}: ${sheets.length} camp sheet(s) at ${scale}x`);
