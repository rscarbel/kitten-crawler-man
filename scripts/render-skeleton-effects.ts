/**
 * Headless review harness for the Skeleton Lord's effect sheets.
 *
 * The browser harness cannot reliably answer "does this look right" from a
 * still, so the art has to be judgeable offline. This slices each baked sheet
 * into a labelled grid at `--scale=`, and puts a strip of the same frames at the
 * in-game tile size underneath — the strip is the exit criterion, because an
 * effect only has to survive at the size players actually see it.
 *
 *   npx tsx scripts/render-skeleton-effects.ts --out=skel-fx.png --scale=3
 *   npx tsx scripts/render-skeleton-effects.ts --only=hands --scale=6
 *
 * Regenerate the sheets themselves with `npm run gen:skeleton-effects`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The specs come straight from the generator, so a retuned cell size cannot
// desync the only review path this art has.
import { ROWS, SHEET_PATHS, TILE_SCALE } from './generate-skeleton-effects-sprites.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_RATIO = IN_GAME_TILE / TILE_SCALE;

const DEFAULT_SCALE = 3;
const MIN_SCALE = 0.25;
const MAX_SCALE = 12;
const LABEL_HEIGHT = 22;
const PADDING = 8;
/** Two backdrops per row: light art on a dark floor has to work on both. */
const BACKDROP_DARK = '#23232a';
const BACKDROP_LIGHT = '#6b6357';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const ANCHOR_MARK = 'rgba(120,220,255,0.5)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

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

interface LoadedSheet {
  readonly spec: (typeof ROWS)[number];
  readonly image: Image;
}

async function loadSheets(only: string): Promise<readonly LoadedSheet[]> {
  const specs = only === '' ? ROWS : ROWS.filter((row) => row.alias === only);
  if (specs.length === 0) {
    throw new Error(`--only=${only} matches nothing; try ${ROWS.map((r) => r.alias).join('|')}`);
  }
  const loaded: LoadedSheet[] = [];
  for (const spec of specs) {
    const path = SHEET_PATHS[spec.key];
    if (path === undefined) throw new Error(`no baked path for ${spec.key}`);
    loaded.push({ spec, image: await loadImage(resolve(path)) });
  }
  return loaded;
}

function render(sheets: readonly LoadedSheet[], outPath: string, scale: number): void {
  const blockHeightOf = (sheet: LoadedSheet): number =>
    LABEL_HEIGHT + sheet.spec.frameHeight * scale + PADDING + sheet.spec.frameHeight * scale;
  const rowWidthOf = (sheet: LoadedSheet): number =>
    PADDING + sheet.spec.frameCount * (sheet.spec.frameWidth * scale + PADDING);

  const width = Math.max(...sheets.map(rowWidthOf));
  const stripHeight = LABEL_HEIGHT + Math.max(...sheets.map((s) => s.spec.frameHeight)) * 1;
  const height =
    PADDING +
    sheets.reduce((total, sheet) => total + blockHeightOf(sheet) + LABEL_HEIGHT + PADDING, 0) +
    stripHeight +
    PADDING;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP_DARK;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const sheet of sheets) {
    const { spec } = sheet;
    const cellW = spec.frameWidth * scale;
    const cellH = spec.frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${spec.key} — ${spec.frameCount} frames of ${spec.frameWidth}×${spec.frameHeight}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    // The same row twice, on a dark floor and on a pale one. Green light on a
    // near-black backdrop flatters itself; the pale band is where a washed-out
    // core or a missing dark separation line actually shows.
    for (const backdrop of [BACKDROP_DARK, BACKDROP_LIGHT]) {
      for (let frame = 0; frame < spec.frameCount; frame++) {
        const x = PADDING + frame * (cellW + PADDING);
        ctx.fillStyle = backdrop;
        ctx.fillRect(x, y, cellW, cellH);
        ctx.drawImage(
          sheet.image,
          frame * spec.frameWidth,
          0,
          spec.frameWidth,
          spec.frameHeight,
          x,
          y,
          cellW,
          cellH,
        );
        ctx.strokeStyle = GRID_LINE;
        ctx.strokeRect(x, y, cellW, cellH);
        ctx.strokeStyle = ANCHOR_MARK;
        ctx.beginPath();
        ctx.moveTo(x + spec.tileX * scale - PADDING, y + spec.tileY * scale);
        ctx.lineTo(x + spec.tileX * scale + PADDING, y + spec.tileY * scale);
        ctx.moveTo(x + spec.tileX * scale, y + spec.tileY * scale - PADDING);
        ctx.lineTo(x + spec.tileX * scale, y + spec.tileY * scale + PADDING);
        ctx.stroke();
      }
      y += cellH + PADDING;
    }
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    `in-game size (${IN_GAME_TILE}px tile) — judge everything here`,
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;
  let x = PADDING;
  for (const sheet of sheets) {
    const { spec } = sheet;
    const w = spec.frameWidth * IN_GAME_RATIO;
    const h = spec.frameHeight * IN_GAME_RATIO;
    for (let frame = 0; frame < spec.frameCount; frame++) {
      ctx.drawImage(
        sheet.image,
        frame * spec.frameWidth,
        0,
        spec.frameWidth,
        spec.frameHeight,
        x,
        y,
        w,
        h,
      );
      x += w + PADDING / 2;
    }
    x += PADDING * 2;
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

async function main(): Promise<void> {
  const only = parseFlag('only', '');
  const outPath = parseFlag('out', `skeleton-effects${only === '' ? '' : `-${only}`}.png`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  render(await loadSheets(only), outPath, scale);
}

void main();
